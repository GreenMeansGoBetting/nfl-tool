"""GMG NHL points model: each skater's chance of 1+ point (a goal or an assist) tonight.

    expected points = his expected goals (the Goals model, as shipped)
                    + his expected assists
    expected assists = the expected goals his TEAMMATES make while he is on the
                       ice, a minute (even strength and power play apart)
                       x the share of their goals he has assisted on
                       x his minutes tonight x tonight's matchup
    chance of 1+    = 1 - e^(-expected points), re-scaled a touch (CALIBRATION)

  * On the ice: from the league's shift charts and the Goals model's
    expected-goals table, so a lucky run of goals doesn't swing his number
    the way it swings his assists. 50 / 15 minutes (EV / PP) of an average
    skater with his ice time mixed in.
  * His share: assists on his teammates' on-ice goals, 10 / 6 goals of his
    position's average mixed in.
  * Minutes, line, home ice and rest: the shots model's. The matchup: the
    other defense's expected goals allowed and tonight's goalie (the Goals
    model's numbers). `spread`: the replay's chances were a touch bunched.

Every piece and weight came from the replay (tools/backtest/nhl_points.py
chose the approach, nhl_points_check.py fits these weights through this
file): fitted on 2024-25, confirmed on 2025-26, each season replayed on its
own games only. What did NOT earn a place: his own team's strength, tonight's
linemates beyond his line (kept as a TRACKED factor, `mates`: right direction
both seasons, too small to prove), and a second assist counted for less.

This season's games only (the owner's rule for the NHL prop tools).

Standard library only: the deploy runs this without numpy.
"""
import math
from collections import Counter

PARAMS = {
    "decay": 0.985,      # each game further back counts this much of the one after it (the Goals model's)
    "pad_minutes": 50,   # EV minutes of an average skater with his ice time mixed into his on-ice rate
    "pp_pad": 15,        # PP minutes of an average skater mixed into his PP on-ice rate
    "share_pad": {"ev": 10, "pp": 6},  # teammates' on-ice goals of his position's average assist share
    "mates_cap": 0.7,    # tonight's linemates against his usual ones, at most about 2x either way
}
# The assists half's fitted exponents (tools/backtest/nhl_points_check.py:
# both seasons together, after 2025-26 was scored with 2024-25's alone: log
# loss 0.59527, 0.59496 re-scaled, against 0.60284 for his points a game).
# For the middle 80% of players: the defense moves the expected assists -8%
# to +9%, `spread` -7% to +5%, the goalie and the line about 4% either way;
# home +7%, a back-to-back -6%, the other team on one +4%.
WEIGHTS = {"scale": 0.041, "opp": 1.354, "goalie": 0.341, "line": 0.206, "home": 0.072, "b2b": -0.06, "opp_b2b": 0.04, "spread": 0.091}
# `spread` reads log(his assists number / this): the replay's average.
SPREAD_MEAN = 0.2675
# The chance of 1+ point, re-scaled on the logit: a + b x logit(1 - e^-mean).
CALIBRATION = (0.036, 1.086)
KEYS = ("toi", "pp_toi", "ev_toi", "ev_pts", "ev_a", "pp_a", "ev_xgo", "pp_xgo", "ev_go", "pp_go", "oi_ev_toi", "oi_pp_toi")


def logit(p):
    return math.log(p / (1 - p))


def chance_at_least(mean, points=1, calibration=None):
    """The chance of `points` or more when `mean` are expected: 1+ re-scaled
    (CALIBRATION, fitted on the replay); 2+ and up a plain count (the replay:
    2+ said 9.1%, got 9.2%)."""
    if mean <= 0:
        return 0.0
    if points <= 1:
        a, b = calibration or CALIBRATION
        p = min(max(1 - math.exp(-mean), 1e-6), 1 - 1e-6)
        return 1 / (1 + math.exp(-(a + b * logit(p))))
    return 1 - sum(math.exp(-mean) * mean ** k / math.factorial(k) for k in range(points))


def chance_over(mean, line, calibration=None):
    """The chance of going over a points line (0.5 -> 1+, 1.5 -> 2+)."""
    return chance_at_least(mean, int(math.floor(line)) + 1, calibration)


class PointsModel:
    """Feed it this season's finished games in date order (add_game), AFTER
    the Goals model has taken the same game (its expected-goals table scores
    the shots); then project() reads everything added so far.

    `goals` = the Goals model (and through it the shots model)."""

    def __init__(self, goals, params=None, weights=None, calibration=None):
        self.goals = goals
        self.p = {**PARAMS, **(params or {})}
        self.w = {**WEIGHTS, **(weights or {})}
        self.calibration = calibration or CALIBRATION
        self.players, self.league = {}, Counter()

    def _player(self, pid):
        return self.players.setdefault(pid, {**{k: 0.0 for k in KEYS}, "with": Counter(), "season": Counter()})

    # ---- taking in games ----
    def mate_rate(self, pid, pos):
        """A skater's even-strength points a minute so far, with 50 minutes
        of his position's average mixed in (what `mates` compares). None
        before the league has any."""
        g = group(pos)
        lg_toi = self.league[f"{g}_ev_toi"]
        lg_rate = self.league[f"{g}_ev_pts"] / lg_toi * 60 if lg_toi else 0.0
        if not lg_rate:
            return None
        q = self.players.get(pid) or {}
        pad = self.p["pad_minutes"]
        return (q.get("ev_pts", 0.0) + pad * lg_rate) / (q.get("ev_toi", 0.0) / 60 + pad)

    def add_game(self, record):
        d = self.p["decay"]
        skaters = record["skaters"]
        pts = {pid: Counter() for pid in skaters}
        on = {pid: Counter() for pid in skaters}
        for g in record.get("goal_events") or []:
            kind = "pp" if g["pp"] else "ev"
            for pid in [g["scorer"], *g["assists"]]:
                if pid in pts:
                    pts[pid][f"{kind}_pts"] += 1
            for pid in g["assists"]:
                if pid in pts:
                    pts[pid][f"{kind}_a"] += 1
            for pid in g["on"] or []:
                if pid in on and pid != g["scorer"]:
                    on[pid][f"{kind}_go"] += 1
        charted = any(s.get("on") is not None for s in record.get("shots") or [])
        for s in record.get("shots") or []:
            kind = "pp" if s["pp"] else "ev"
            for pid in s.get("on") or []:
                if pid in on and pid != s["shooter"]:
                    on[pid][f"{kind}_xgo"] += s["xg"]
        # Who he played with tonight (the shift chart's lines).
        played_with = {pid: [q for q, other in skaters.items() if q != pid and other["team"] == line["team"] and other.get("slot") == line["slot"]]
                       for pid, line in skaters.items() if line.get("slot")}
        for pid, line in skaters.items():
            p = self._player(pid)
            g = group(line["pos"])
            pp_secs = line.get("pp_toi")
            if pp_secs is None:
                pp_secs = line["toi"] * (p["pp_toi"] / p["toi"]) if p["toi"] else 0.0
            ev_secs = line["toi"] - pp_secs
            mine = pts[pid]
            values = {"toi": line["toi"], "pp_toi": pp_secs, "ev_toi": ev_secs, "ev_pts": mine["ev_pts"],
                      # On-ice numbers come only from games with a shift chart (and so do their minutes).
                      "ev_a": mine["ev_a"] if charted else 0, "pp_a": mine["pp_a"] if charted else 0,
                      "ev_xgo": on[pid]["ev_xgo"], "pp_xgo": on[pid]["pp_xgo"], "ev_go": on[pid]["ev_go"], "pp_go": on[pid]["pp_go"],
                      "oi_ev_toi": ev_secs if charted else 0, "oi_pp_toi": pp_secs if charted else 0}
            for key, val in values.items():
                p[key] = p.get(key, 0.0) * d + val
                self.league[f"{g}_{key}"] += val
            if played_with.get(pid):
                for q in p["with"]:
                    p["with"][q] *= d
                for q in played_with[pid]:
                    p["with"][q] += 1
            p["pos"] = line["pos"]
            p["season"].update(games=1, goals=line["g"], assists=line["a"], points=line["g"] + line["a"])

    # ---- the pieces ----
    def linemates(self, pid):
        """{player id: how often he has played on this player's line or pair}
        (recent games counting more): who he usually plays with."""
        return dict((self.players.get(pid) or {}).get("with") or {})

    def mates(self, pid, linemates):
        """Tonight's projected linemates [(id, position)] against the ones he
        has played with, both read by their EV points a minute today (1.2 =
        20% more productive; the same linemates = 1.0). Tracked in the
        record; NOT in the number."""
        p = self.players.get(pid)
        if not p or not p["with"] or not linemates:
            return None
        rates = [r for r in (self.mate_rate(q, pos) for q, pos in linemates) if r]
        usual = [(w, self.mate_rate(q, (self.players.get(q) or {}).get("pos"))) for q, w in p["with"].items()]
        usual = [(w, r) for w, r in usual if r]
        if not rates or not usual:
            return None
        before = sum(w * r for w, r in usual) / sum(w for w, _ in usual)
        cap = self.p["mates_cap"]
        return math.exp(max(-cap, min(cap, math.log(sum(rates) / len(rates) / before))))

    def assists_parts(self, pid, gp):
        """His assists number before the weights, from the Goals model's parts (`gp`)."""
        p = self.players.get(pid)
        if not p or not p["toi"]:
            return None
        g, lg = gp["group"], lambda key: self.league[f"{gp['group']}_{key}"]
        role = self.goals.shots.role(g, gp["minutes"])
        total = 0.0
        for kind, minutes, pad, scale in (("ev", gp["ev_min"], self.p["pad_minutes"], role), ("pp", gp["pp_min"], self.p["pp_pad"], 1.0)):
            lg_toi = lg(f"oi_{kind}_toi")
            lg_rate = lg(f"{kind}_xgo") / lg_toi * 60 if lg_toi else 0.0
            rate = (p[f"{kind}_xgo"] + pad * lg_rate * scale) / (p[f"oi_{kind}_toi"] / 60 + pad)
            k = self.p["share_pad"][kind]
            lg_share = lg(f"{kind}_a") / lg(f"{kind}_go") if lg(f"{kind}_go") else 0.0
            share = (p[f"{kind}_a"] + k * lg_share) / (p[f"{kind}_go"] + k)
            total += rate * share * minutes
        return total

    def parts(self, pid, opp, home, rest=None, opp_rest=None, team=None, slot=None, goalie=None):
        """Everything a projection is made of, before the assists weights."""
        gp = self.goals.project(pid, opp, home, rest, opp_rest, team, slot, goalie)
        if gp is None:
            return None
        base = self.assists_parts(pid, gp)
        if not base or base <= 0:
            return None
        x = {key: gp["x"][key] for key in ("opp", "goalie", "line", "home", "b2b", "opp_b2b")}
        x["spread"] = math.log(base / SPREAD_MEAN)
        return {"goals": gp, "base": base, "x": x, "season": dict((self.players.get(pid) or {}).get("season") or {})}

    def project(self, pid, opp, home, rest=None, opp_rest=None, team=None, slot=None, goalie=None):
        """parts() plus the projection: `goals` / `assists` / `mean` expected
        tonight, `chance` of 1+ point, and what each assists piece did
        (`lift`: 1.06 = 6% more)."""
        parts = self.parts(pid, opp, home, rest, opp_rest, team, slot, goalie)
        if parts is None:
            return None
        lift = {key: math.exp(self.w[key] * x) for key, x in parts["x"].items()}
        assists = parts["base"] * math.exp(self.w["scale"])
        for value in lift.values():
            assists *= value
        goals = parts["goals"]["mean"]
        mean = goals + assists
        return {**parts, "lift": lift, "goals_mean": goals, "assists_mean": assists, "mean": mean,
                "chance": chance_at_least(mean, 1, self.calibration)}


def group(pos):
    return "D" if pos == "D" else "F"
