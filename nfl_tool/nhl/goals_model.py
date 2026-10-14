"""GMG NHL anytime-goal model: each skater's chance to score tonight.

    expected goals tonight = his expected goals a minute x his minutes x tonight's matchup
    chance to score        = 1 - e^(-expected goals)

  * Expected goals (xG): what a shot is worth from where and how it was taken
    (distance, angle, rink area, shot type, rebound, rush, power play / short
    handed, and whether it came from the off wing: a right-handed shot from
    the left side, the one-timer side). A logistic table fitted on THIS
    season's shots only, refitted every build.
  * His rate: his expected goals for every minute he has played this season
    (recent games counting a little more), with 50 minutes of an average
    skater WITH HIS ICE TIME mixed in, the same guard as the shots model.
    Even strength and the power play are read apart (power-play seconds from
    the league's per-game time-on-ice report): his EV rate x his EV minutes
    + his PP rate x his PP minutes.
  * His minutes, tonight's line, home ice and rest: the shots model's.
  * The matchup: the other defense's expected goals allowed, tonight's goalie
    (goals allowed against his expected goals), his own finishing (goals over
    expected goals, pulled hard to average), and a trim for net-front
    shooters (step 1 found heavy low-slot shooters scored 5-10% under).

Every piece and weight came from the replay (tools/backtest/nhl_goals.py,
nhl_goals_ideas.py, and nhl_goals_check.py for these exact weights): fitted
on 2024-25 and confirmed on 2025-26, each season replayed on its own games
only. What did NOT earn a place: the areas he shoots from against what the
defense allows from them (the owner's Zone Match idea: kept as a TAG, shown
and graded, not in the number), empty-net goals, the penalty matchup, a
backup goalie beyond his own record, and team strength.

This season's games only (the owner's rule for the NHL prop tools), the
league's yardsticks and the expected-goals table included.

Standard library only: the deploy runs this without numpy.
"""
import math
from collections import Counter

FORWARD, DEFENSE = "F", "D"
AREAS = ("low_slot", "slot", "left", "right", "point", "long")
TYPES = ("wrist", "snap", "slap", "backhand", "tip", "other")
XG_NAMES = ("const", "log dist", "angle/45", *(f"area {a}" for a in AREAS[1:]), *(f"type {t}" for t in TYPES[1:]),
            "rebound", "rush", "pp", "sh", "off wing")
XG_RIDGE = 1.0

PARAMS = {
    "decay": 0.985,       # each game further back counts this much of the one after it
    "pad_minutes": 50,    # minutes of an average skater with his ice time mixed into his rate
    "pp_pad": 15,         # power-play minutes of an average skater mixed into his PP rate
    "toi_decay": 0.8,     # his EV / PP minutes, as the shots model reads minutes
    "team_pad_games": 20, # games of a league-average defense mixed into a defense's numbers
    "goalie_pad_xg": 25,  # expected goals of an average goalie mixed into a goalie's record
    "finish_pad_xg": 8,   # expected goals of an average finisher mixed into his goals / expected goals
    "area_pad": 40,       # shots at his position's usual spots mixed into where he shoots from
}
# The fitted exponents (1.0 = take the number at face value), from
# tools/backtest/nhl_goals_check.py: both seasons together, after the bar was
# cleared on 2025-26 with weights from 2024-25 alone (log loss 0.39625 against
# 0.39691 for step 1's pieces; power-play time from the league's report). For
# the middle 80% of players: the defense moves the expected goals -7% to +9%,
# his finishing and the low-slot trim about 7% either way, EV / PP apart -6%
# to +4%, the goalie and the line about 4%, the off wing about 2.5%; home +7%,
# a back-to-back -7%, the other team on one +4%.
WEIGHTS = {"scale": 0.06, "opp": 1.269, "goalie": 0.289, "finish": 0.438, "line": 0.204, "home": 0.074,
           "b2b": -0.071, "opp_b2b": 0.036, "split": 1.077, "onetimer": 2.601, "low": -1.039}
# The Zone Match tag (the owner's idea, 2026-10-14; shown and graded, NOT in
# the number: the replay found tagged players scored what the model already
# expected): 35%+ more of his located shots from the low slot or the slot
# than his position takes from there (15+ located shots), against a defense
# in the league's top 10 for shots allowed from that area this season (and
# above the league's average there: what "a weakness" means in any league).
# Shots allowed, not goals allowed: a defense's low-slot shots allowed after
# 6 games carried over to the rest of the season (0.42-0.45), its goals
# allowed did not (0.0).
ZONE = {"heavy": 1.35, "min_shots": 15, "rank": 10, "areas": ("low_slot", "slot")}


def group(pos):
    return DEFENSE if pos == "D" else FORWARD


# ---- expected goals ----
def off_wing(shot, hand):
    """A right-handed shot from the left side (as he sees it) or a left-handed one from the right."""
    h = hand.get(shot["shooter"]) if hand else None
    return bool(h and shot["area"] not in ("point", "long") and ((h == "R" and shot["y"] > 0) or (h == "L" and shot["y"] < 0)))


def xg_features(shot, with_wing):
    """The shot as (index, value) pairs: most of the 18 columns are zero."""
    f = [(0, 1.0), (1, math.log(max(shot["dist"], 1.0))), (2, shot["angle"] / 45)]
    if shot["area"] != AREAS[0]:
        f.append((2 + AREAS.index(shot["area"]), 1.0))
    if shot["type"] != TYPES[0]:
        f.append((7 + TYPES.index(shot["type"]), 1.0))
    for i, key in ((13, "rebound"), (14, "rush"), (15, "pp"), (16, "sh")):
        if shot[key]:
            f.append((i, 1.0))
    if with_wing and shot.get("offwing"):
        f.append((17, 1.0))
    return f


def _solve(a, b):
    """a x = b for a small symmetric matrix (Gaussian elimination with pivoting)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        if abs(m[c][c]) < 1e-12:
            continue
        for r in range(c + 1, n):
            f = m[r][c] / m[c][c]
            if f:
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (m[r][n] - sum(m[r][k] * x[k] for k in range(r + 1, n))) / m[r][r] if abs(m[r][r]) > 1e-12 else 0.0
    return x


def fit_xg(shots, with_wing, start=None, iterations=25):
    """Logistic regression of goal on the shot (Newton's method, a touch of
    ridge on everything but the constant). `start` (last build's table) only
    makes it converge sooner: the answer is the same from anywhere."""
    k = 18 if with_wing else 17
    rows = [(xg_features(s, with_wing), 1.0 if s["goal"] else 0.0) for s in shots]
    if not rows:
        return None
    rate = sum(y for _, y in rows) / len(rows)
    w = list(start[:k]) if start and len(start) >= k else [math.log(max(rate, 1e-3) / max(1 - rate, 1e-3))] + [0.0] * (k - 1)
    for _ in range(iterations):
        grad = [0.0] * k
        hess = [[0.0] * k for _ in range(k)]
        for f, y in rows:
            z = sum(w[i] * v for i, v in f)
            p = 1 / (1 + math.exp(-z)) if z > -30 else 0.0
            q = p * (1 - p)
            for a, (i, vi) in enumerate(f):
                grad[i] += (y - p) * vi
                qi = q * vi
                row = hess[i]
                for j, vj in f[a:]:
                    row[j] += qi * vj
        for i in range(k):
            for j in range(i):
                hess[i][j] = hess[j][i] = hess[i][j] + hess[j][i]
            if i:
                hess[i][i] += XG_RIDGE
                grad[i] -= XG_RIDGE * w[i]
        step = _solve(hess, grad)
        w = [a + s for a, s in zip(w, step)]
        if max(abs(s) for s in step) < 1e-6:
            break
    return w


def xg_of(shot, w, with_wing):
    z = sum(w[i] * v for i, v in xg_features(shot, with_wing))
    return 1 / (1 + math.exp(-z))


class GoalsModel:
    """Feed it this season's finished games in date order (add_game) after
    the expected-goals tables are set (fit, or `xg` from the replay); then
    project() reads everything added so far.

    `shots` = the shots model with the same games added (its minutes, role,
    tonight's line, home ice and rest are this model's too). `hand` = {player
    id: "L" / "R"} for the off-wing column."""

    def __init__(self, shots, hand=None, params=None, weights=None):
        self.shots = shots
        self.hand = hand or {}
        self.p = {**PARAMS, **(params or {})}
        self.w = {**WEIGHTS, **(weights or {})}
        self.xg = {False: None, True: None}  # {with the off wing?: table}
        self.players, self.teams, self.goalies = {}, {}, {}
        self.league = Counter()

    # ---- the tables ----
    def fit(self, records, start=None):
        """Fits both expected-goals tables (without and with the off wing) on
        these games' shots. `start` = {"base": [...], "wing": [...]} from the
        last build, to converge sooner."""
        shots = [s for r in records for s in r.get("shots") or []]
        for s in shots:
            s["offwing"] = off_wing(s, self.hand)
        start = start or {}
        self.xg = {False: fit_xg(shots, False, start.get("base")), True: fit_xg(shots, True, start.get("wing"))}
        return self.xg

    def score(self, record):
        """Each shot's expected goals by both tables (0.07 a shot before there is a table)."""
        for s in record.get("shots") or []:
            s["offwing"] = off_wing(s, self.hand)
            s["xg"] = xg_of(s, self.xg[False], False) if self.xg[False] else 0.07
            s["xg_ow"] = xg_of(s, self.xg[True], True) if self.xg[True] else 0.07

    # ---- taking in games ----
    def _player(self, pid):
        return self.players.setdefault(pid, {
            "pos": None, "toi": 0.0, "xg": 0.0, "xg_ow": 0.0, "g": 0.0, "pp_xg": 0.0, "pp_toi": 0.0,
            "ev_num": 0.0, "pp_num": 0.0, "min_den": 0.0, "areas": Counter(), "raw_areas": Counter(), "season": Counter(),
        })

    def add_game(self, record):
        """Scores the game's shots with the current tables and adds them up."""
        self.score(record)
        d, lg = self.p["decay"], self.league
        by_shooter = {}
        for s in record.get("shots") or []:
            by_shooter.setdefault(s["shooter"], []).append(s)
            other = record["away"] if s["team"] == record["home"] else record["home"]
            for c in (self.teams.setdefault(other, Counter()), lg):
                c["xg"] += s["xg"]
                c["g"] += s["goal"]
                c[f"n_{s['area']}"] += 1
                c[f"xg_{s['area']}"] += s["xg"]
                c["pp_xg"] += s["xg"] if s["pp"] else 0.0
            g = self.goalies.setdefault(s["goalie"], Counter())
            g["xg"] += s["xg"]
            g["g"] += s["goal"]
        for team in (record["home"], record["away"]):
            self.teams.setdefault(team, Counter())["games"] += 1
            lg["team_games"] += 1
        for pid, line in record["skaters"].items():
            p = self._player(pid)
            grp = group(line["pos"])
            mine = by_shooter.get(pid, [])
            xg, xg_ow = sum(s["xg"] for s in mine), sum(s["xg_ow"] for s in mine)
            pp_xg = sum(s["xg"] for s in mine if s["pp"])
            # His power-play time from the league's report; a game without it
            # (not read yet) is read at his own share so far.
            pp_secs = line.get("pp_toi")
            if pp_secs is None:
                pp_secs = line["toi"] * (p["pp_toi"] / p["toi"]) if p["toi"] else 0.0
            for key, val in (("toi", line["toi"]), ("xg", xg), ("xg_ow", xg_ow), ("g", sum(s["goal"] for s in mine)), ("pp_xg", pp_xg), ("pp_toi", pp_secs)):
                p[key] = p[key] * d + val
                lg[f"{grp}_{key}"] += val
            t = self.p["toi_decay"]
            p["ev_num"] = p["ev_num"] * t + (line["toi"] - pp_secs)
            p["pp_num"] = p["pp_num"] * t + pp_secs
            p["min_den"] = p["min_den"] * t + 1
            for a in list(p["areas"]):
                p["areas"][a] *= d
            for s in mine:
                p["areas"][s["area"]] += 1
                p["raw_areas"][s["area"]] += 1
                lg[f"{grp}_a_{s['area']}"] += 1
            p["pos"] = line["pos"]
            p["season"].update(games=1, goals=line["g"], xg=xg, toi=line["toi"], shots=len(mine))

    # ---- the pieces ----
    def allowed(self, team, key):
        """What a defense allows a game this season, steadied with a league-average defense, against the league."""
        t = self.teams.get(team) or Counter()
        games = self.league["team_games"]
        league = self.league[key] / games if games else 0.0
        k = self.p["team_pad_games"]
        blend = (t[key] + k * league) / (t["games"] + k)
        return {"season": t[key] / t["games"] if t["games"] else None, "blend": blend, "league": league, "factor": blend / league if league else 1.0}

    def goalie_factor(self, goalie):
        """His goals allowed against his expected goals, with an average goalie mixed in (1.0 = average, 1.1 = 10% leakier)."""
        g = self.goalies.get(goalie) or Counter()
        lg = self.league["g"] / self.league["xg"] if self.league["xg"] else 1.0
        k = self.p["goalie_pad_xg"]
        return (g["g"] + k * lg) / (g["xg"] + k) / lg

    def league_share(self, grp, area):
        total = sum(self.league[f"{grp}_a_{a}"] for a in AREAS)
        return self.league[f"{grp}_a_{area}"] / total if total else 0.0

    def shares(self, p, grp):
        """Where his shots come from, with his position's usual spots mixed in."""
        pad = self.p["area_pad"]
        total = sum(p["areas"].values()) + pad
        return {a: (p["areas"][a] + pad * self.league_share(grp, a)) / total for a in AREAS}

    def area_ranks(self, area):
        """{team: rank} for shots allowed a game from this area this season (1 = the most)."""
        rows = sorted(((t[f"n_{area}"] / t["games"], team) for team, t in self.teams.items() if t["games"]), reverse=True)
        return {team: i + 1 for i, (_, team) in enumerate(rows)}

    def zone_match(self, pid, opp, ranks=None):
        """The Zone Match tag: his heavy area against a defense that allows a lot from it, or None."""
        p = self.players.get(pid)
        if not p:
            return None
        grp = group(p["pos"])
        total = sum(p["raw_areas"].values())
        if total < ZONE["min_shots"]:
            return None
        best = None
        for area in ZONE["areas"]:
            lg_share = self.league_share(grp, area)
            share = p["raw_areas"][area] / total
            rank = (ranks or {}).get(area, {}).get(opp) if ranks else self.area_ranks(area).get(opp)
            t = self.teams.get(opp) or Counter()
            allows = t[f"n_{area}"] / t["games"] if t["games"] else 0.0
            league = self.league[f"n_{area}"] / self.league["team_games"] if self.league["team_games"] else 0.0
            if lg_share and share >= ZONE["heavy"] * lg_share and rank and rank <= ZONE["rank"] and allows > league:
                tag = {"area": area, "share": round(share, 3), "lg_share": round(lg_share, 3), "opp_pg": round(allows, 2), "lg_pg": round(league, 2), "opp_rank": rank}
                if not best or share / lg_share > best["share"] / best["lg_share"]:
                    best = tag
        return best

    def parts(self, pid, opp, home, rest=None, opp_rest=None, team=None, slot=None, goalie=None):
        """Everything a projection is made of, before the weights."""
        p = self.players.get(pid)
        sp = self.shots.parts(pid, opp, home, rest, opp_rest, team, slot)
        if not p or sp is None or not p["toi"]:
            return None
        grp, minutes = sp["group"], sp["minutes"]
        role = self.shots.role(grp, minutes)
        lg = lambda key: self.league[f"{grp}_{key}"]
        pad = self.p["pad_minutes"]
        lg_rate = lg("xg") / lg("toi") * 60 if lg("toi") else 0.0
        rate = (p["xg"] + pad * lg_rate * role) / (p["toi"] / 60 + pad)
        base = rate * minutes
        if base <= 0:
            return None
        opp_f = self.allowed(opp, "xg")["factor"]
        finish = (p["g"] + self.p["finish_pad_xg"]) / (p["xg"] + self.p["finish_pad_xg"])
        lg_ow = lg("xg_ow") / lg("toi") * 60 if lg("toi") else lg_rate
        ow_rate = (p["xg_ow"] + pad * lg_ow * role) / (p["toi"] / 60 + pad)
        ev_lg = (lg("xg") - lg("pp_xg")) / max(lg("toi") - lg("pp_toi"), 1) * 60
        pp_lg = lg("pp_xg") / max(lg("pp_toi"), 1) * 60
        ev_min = p["ev_num"] / p["min_den"] / 60 if p["min_den"] else minutes
        pp_min = p["pp_num"] / p["min_den"] / 60 if p["min_den"] else 0.0
        ev_rate = (p["xg"] - p["pp_xg"] + pad * ev_lg * role) / ((p["toi"] - p["pp_toi"]) / 60 + pad)
        pp_rate = (p["pp_xg"] + self.p["pp_pad"] * pp_lg) / (p["pp_toi"] / 60 + self.p["pp_pad"])
        split = ev_rate * ev_min + pp_rate * pp_min
        goalie_f = self.goalie_factor(goalie) if goalie else 1.0
        x = {
            "opp": math.log(opp_f), "goalie": math.log(goalie_f), "finish": math.log(finish),
            "line": sp["x"]["line"], "home": sp["x"]["home"], "b2b": sp["x"]["b2b"], "opp_b2b": sp["x"]["opp_b2b"],
            "split": math.log(split / base) if split > 0 else 0.0,
            "onetimer": math.log(ow_rate / rate) if ow_rate > 0 else 0.0,
            "low": self.shares(p, grp)["low_slot"] - self.league_share(grp, "low_slot"),
        }
        return {
            "group": grp, "pos": p["pos"], "minutes": minutes, "line_minutes": sp["line_minutes"], "base": base, "rate60": rate * 60,
            "ev_min": ev_min, "pp_min": pp_min, "finish": finish, "goalie": goalie_f, "opp_factor": opp_f, "x": x,
            "season": dict(p["season"]), "shares": self.shares(p, grp),
        }

    def project(self, pid, opp, home, rest=None, opp_rest=None, team=None, slot=None, goalie=None):
        """parts() plus the projection: `mean` expected goals tonight, `chance`
        to score, and what each piece did (`lift`: 1.06 = 6% more)."""
        parts = self.parts(pid, opp, home, rest, opp_rest, team, slot, goalie)
        if parts is None:
            return None
        lift = {key: math.exp(self.w[key] * x) for key, x in parts["x"].items()}
        mean = parts["base"] * math.exp(self.w["scale"])
        for value in lift.values():
            mean *= value
        return {**parts, "lift": lift, "mean": mean, "chance": chance_to_score(mean)}


def chance_to_score(mean):
    """1 or more goals when `mean` are expected (a plain count: the replay's chances were honest)."""
    return 1 - math.exp(-mean) if mean > 0 else 0.0
