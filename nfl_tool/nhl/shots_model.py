"""GMG NHL shots-on-goal model: how many shots on goal each skater should
have tonight, and the chance he clears each line.

One projection is three things multiplied together:

    shots per minute  x  minutes tonight  x  tonight's matchup

  * Shots per minute: his own shots on goal for every minute he has played
    this season, recent games counting a little more, with a slice of a
    league-average skater at his position mixed in so a hot week can't run
    away with it. Most of it is read from his shot ATTEMPTS (on goal, wide or
    blocked): attempts settle down sooner than shots on goal do.
  * Minutes tonight: his recent ice time (the last few games count most),
    leaving out nights he left early.
  * Tonight's matchup: what the other team allows (shots on goal a game, to
    his position, and from the parts of the ice he shoots from), home ice,
    and the power-play shots the other team gives up for a power-play shooter.

How much each piece counts (WEIGHTS) was fitted on a replay of 2025-26, every
game projected only from the games before it (tools/backtest/nhl_shots.py).
The chance of clearing a line treats shots as a count that is a little
streakier than pure chance (DISPERSION, fitted on the same replay).

This season's games only: the owner's rule for the NHL prop tools. The
"average skater" a small sample is mixed with is this season's too, and one
with HIS ice time: a 21-minute forward is measured against other big-minute
forwards, not against a fourth-liner.

Standard library only: the deploy runs this without numpy.
"""
import math
from collections import Counter

FORWARD, DEFENSE = "F", "D"
# THIS SEASON ONLY. The owner's rule (2026-10-13, said twice) for the NHL prop
# tools: "a small sample of current form and style is more accurate than a
# previous season with bad data", and no gradual fade-out of last season
# either. The build gives the model this season's games and nothing else.
# The class still accepts last season's summary (`prior`), but only so the
# replay (tools/backtest/nhl_shots.py --last-season) can measure what the
# rule costs. What it measured, and the owner was told: with a handful of
# games the model has no other way to know a volume shooter, so the 66
# players who averaged 2.5+ shots a game the year before were projected about
# 0.1 shots low through their first 20 games (0.5 low before the ice-time
# guard below), and all players' projections missed by about 2% more over
# their first ten games. From 20 games on there was no difference.
PARAMS = {
    # ---- his shot rate ----
    "decay": 0.985,        # each game further back counts this much of the one after it
    "prev_weight": 0.5,    # (replay only, when a prior is given) last season's minutes count this much of this season's
    "pad_minutes": 50,     # minutes of a league-average skater at his position mixed in...
    "role_power": 1.0,     # ...scaled for his ice time: (his minutes / the position's average) to this power
    "attempt_blend": 0.75, # share of the rate read from shot attempts instead of shots on goal
    "thru_pad": 150,       # attempts at the league's on-goal rate mixed into his own
    # ---- his minutes ----
    "toi_decay": 0.8,
    "toi_prev_games": 1.5,  # last season's average ice time counts as this many recent games
    "short_night": 0.6,     # a game under this share of his usual ice time is "left early"
    # ---- what a defense allows ----
    "team_prev_games": 12,  # (replay only, when a prior is given) a defense's last season counts as this many games
    "team_pad_games": 20,   # a league-average defense counts as this many games
    "area_pad": 40,         # shots at his position's usual spots mixed into where he shoots from
    "pp_pad": 40,
}
# How much each matchup piece moves the projection (the fitted exponents; 1.0
# means "take the number at face value").
# Fitted on 2025-26 replayed with that season's games only (44,496
# skater-games) and rounded; each held its sign in both halves of the season.
# In plain terms, for most players: the defense's overall number moves a
# projection about 6% either way, position 2%, the parts of the ice 1%, the
# power play 1%, home ice +3%, the second night of a back-to-back -3.5% (and
# +3.5% against a team on one). "scale" trims the whole projection 4%: the
# minutes leave out nights a player left early, so on their own they run a
# touch high.
WEIGHTS = {"opp": 1.0, "pos": 0.5, "area": 0.5, "pp": 0.6, "home": 0.03, "b2b": -0.035, "opp_b2b": 0.035, "scale": -0.04}
# Shots on goal are a bit streakier than a pure count: the spread around a
# projection m is m + DISPERSION * m^2.
DISPERSION = 0.07

TEAM_KEYS = ("sog", "f_sog", "d_sog", "att", "pp_unb", "located")


def group(pos: str | None) -> str:
    return DEFENSE if pos == "D" else FORWARD


def allowed_in(record: dict, team: str) -> Counter:
    """What `team` allowed in one finished game (reduce_game's record): shots
    on goal in all, to forwards and to defensemen, attempts, power-play
    shots, and the shots from each part of the ice."""
    other = record["away"] if team == record["home"] else record["home"]
    theirs = record["teams"][other]
    out = Counter(sog=theirs.get("sog", 0), att=theirs.get("att", 0), pp_unb=theirs.get("unb_pp", 0), games=1)
    for line in record["skaters"].values():
        if line["team"] == other:
            out["f_sog" if group(line["pos"]) == FORWARD else "d_sog"] += line["sog"]
            for area, counts in line["areas"].items():
                out[f"a_{area}"] += counts[0]
                out["located"] += counts[0]
    return out


def season_summary(records: list) -> dict:
    """A finished season boiled down to what next season's model starts
    from: each skater's totals and each team's totals allowed."""
    players, teams, league = {}, {}, Counter()
    for r in records:
        for team in (r["home"], r["away"]):
            teams.setdefault(team, Counter()).update(allowed_in(r, team))
        for pid, line in r["skaters"].items():
            p = players.setdefault(pid, {"pos": line["pos"], "games": 0, "toi": 0, "sog": 0, "att": 0, "unb": 0, "pp_unb": 0, "areas": {}})
            p["pos"] = line["pos"]
            p["games"] += 1
            for key in ("toi", "sog", "att", "unb", "pp_unb"):
                p[key] += line[key]
            for area, counts in line["areas"].items():
                p["areas"][area] = p["areas"].get(area, 0) + counts[0]
    for p in players.values():
        g = group(p["pos"])
        for key in ("games", "toi", "sog", "att", "unb", "pp_unb"):
            league[f"{g}_{key}"] += p[key]
        for area, n in p["areas"].items():
            league[f"{g}_a_{area}"] += n
    return {"players": players, "teams": {t: dict(c) for t, c in teams.items()}, "league": dict(league)}


class ShotsModel:
    """Feed it this season's finished games in date order (add_game);
    project() reads everything added so far. `prior` (a season_summary of
    the season before) is for the replay's comparison only: the site never
    passes one."""

    def __init__(self, prior: dict | None = None, params: dict | None = None, weights: dict | None = None):
        self.p = {**PARAMS, **(params or {})}
        self.w = {**WEIGHTS, **(weights or {})}
        prior = prior or {}
        self.prior_players = prior.get("players") or {}
        self.prior_teams = prior.get("teams") or {}
        self.players = {}
        self.teams = {}
        # The league's yardsticks: every game added so far (plus last season's
        # totals, when a prior is given).
        self.league = Counter(prior.get("league") or {})
        self.league_allowed = Counter()
        for c in self.prior_teams.values():
            self.league_allowed.update(c)

    # ---- taking in games ----
    def _player(self, pid: str, pos: str) -> dict:
        s = self.players.get(pid)
        if s is None:
            before = self.prior_players.get(pid)
            s = self.players[pid] = {
                "pos": pos, "games": 0, "prev_games": before["games"] if before else 0, "prev": before,
                "toi": 0.0, "sog": 0.0, "att": 0.0, "unb": 0.0, "pp_unb": 0.0, "areas": {},
                "toi_num": 0.0, "toi_den": 0.0, "season": Counter(), "recent": [],
            }
            if before and before["games"]:
                s["toi_num"] = self.p["toi_prev_games"] * before["toi"] / before["games"]
                s["toi_den"] = self.p["toi_prev_games"]
        s["pos"] = pos
        return s

    def add_game(self, record: dict) -> None:
        decay = self.p["decay"]
        for team in (record["home"], record["away"]):
            allowed = allowed_in(record, team)
            self.teams.setdefault(team, Counter()).update(allowed)
            self.league_allowed.update(allowed)
        for pid, line in record["skaters"].items():
            s = self._player(pid, line["pos"])
            g = group(line["pos"])
            self.league[f"{g}_games"] += 1
            for key in ("toi", "sog", "att", "unb", "pp_unb"):
                s[key] = s[key] * decay + line[key]
                self.league[f"{g}_{key}"] += line[key]
            for area in set(s["areas"]) | set(line["areas"]):
                s["areas"][area] = s["areas"].get(area, 0) * decay + (line["areas"].get(area) or [0])[0]
            for area, counts in line["areas"].items():
                self.league[f"{g}_a_{area}"] += counts[0]
            usual = s["toi_num"] / s["toi_den"] if s["toi_den"] else None
            # A night he left early says nothing about his role.
            if not (usual and s["games"] + s["prev_games"] >= 3 and line["toi"] < self.p["short_night"] * usual):
                s["toi_num"] = s["toi_num"] * self.p["toi_decay"] + line["toi"]
                s["toi_den"] = s["toi_den"] * self.p["toi_decay"] + 1
            s["games"] += 1
            s["season"].update(toi=line["toi"], sog=line["sog"], att=line["att"])
            s["recent"] = (s["recent"] + [(line["toi"], line["sog"], line["att"])])[-10:]

    # ---- the pieces ----
    def totals(self, s: dict) -> dict:
        """His (recency-weighted) totals this season (plus last season's at
        prev_weight, when a prior was given)."""
        before = s["prev"] or {}
        w = self.p["prev_weight"] * self.p["decay"] ** s["games"] if before else 0.0
        out = {key: s[key] + w * before.get(key, 0) for key in ("toi", "sog", "att", "unb", "pp_unb")}
        old_areas = before.get("areas") or {}
        out["areas"] = {a: s["areas"].get(a, 0) + w * old_areas.get(a, 0) for a in set(s["areas"]) | set(old_areas)}
        return out

    def league_rate(self, g: str, key: str = "sog") -> float:
        """A league-average skater's shots per minute at this position."""
        return self.league[f"{g}_{key}"] / self.league[f"{g}_toi"] * 60 if self.league[f"{g}_toi"] else 0.0

    def role(self, g: str, minutes: float | None) -> float:
        """How a skater with his ice time compares with the position's
        average skater, per minute: players who are given more minutes shoot
        more often in each of them (1.0 = the average skater's ice time)."""
        games = self.league[f"{g}_games"]
        if not games or not minutes or not self.p["role_power"]:
            return 1.0
        usual = self.league[f"{g}_toi"] / games / 60
        return (minutes / usual) ** self.p["role_power"] if usual else 1.0

    def rate(self, s: dict) -> dict:
        """His shots on goal per minute, two ways (see the top of the file)."""
        g = group(s["pos"])
        t = self.totals(s)
        pad = self.p["pad_minutes"] * 60
        minutes = (t["toi"] + pad) / 60
        role = self.role(g, self.minutes(s))
        direct = (t["sog"] + pad / 60 * self.league_rate(g) * role) / minutes
        attempts = (t["att"] + pad / 60 * self.league_rate(g, "att") * role) / minutes
        league_thru = self.league[f"{g}_sog"] / self.league[f"{g}_att"] if self.league[f"{g}_att"] else 0.5
        thru = (t["sog"] + self.p["thru_pad"] * league_thru) / (t["att"] + self.p["thru_pad"])
        blend = self.p["attempt_blend"]
        return {"direct": direct, "attempts": attempts, "thru": thru, "per_min": (1 - blend) * direct + blend * attempts * thru}

    def minutes(self, s: dict) -> float | None:
        return s["toi_num"] / s["toi_den"] / 60 if s["toi_den"] else None

    def allowed(self, team: str, key: str) -> dict:
        """What a defense allows a game this season, steadied with a
        league-average defense (team_pad_games), and that number against the league."""
        now, before = self.teams.get(team) or Counter(), self.prior_teams.get(team) or {}
        league = self.league_allowed[key] / self.league_allowed["games"] if self.league_allowed["games"] else 0.0
        games = now["games"]
        k_prev = self.p["team_prev_games"] if before.get("games") else 0
        k_pad = self.p["team_pad_games"]
        prev_pg = before.get(key, 0) / before["games"] if before.get("games") else 0.0
        blended = (now[key] + k_prev * prev_pg + k_pad * league) / (games + k_prev + k_pad) if games + k_prev + k_pad else league
        return {
            "season": now[key] / games if games else None, "prev": prev_pg if before.get("games") else None,
            "blend": blended, "league": league, "factor": blended / league if league else 1.0,
        }

    def area_shares(self, s: dict) -> dict:
        """Where his shots come from, as shares, with his position's usual spots mixed in."""
        g = group(s["pos"])
        league_total = sum(v for k, v in self.league.items() if k.startswith(f"{g}_a_"))
        areas = {k[len(g) + 3:] for k in self.league if k.startswith(f"{g}_a_")} | set(s["areas"])
        mine = self.totals(s)["areas"]
        areas |= set(mine)
        pad = self.p["area_pad"]
        total = sum(mine.values()) + pad
        return {a: (mine.get(a, 0) + pad * (self.league[f"{g}_a_{a}"] / league_total if league_total else 0)) / total for a in areas} if total else {}

    def pp_share(self, s: dict) -> float:
        """Share of his shots that come on the power play."""
        g = group(s["pos"])
        league = self.league[f"{g}_pp_unb"] / self.league[f"{g}_unb"] if self.league[f"{g}_unb"] else 0.0
        t = self.totals(s)
        return (t["pp_unb"] + self.p["pp_pad"] * league) / (t["unb"] + self.p["pp_pad"])

    def parts(self, pid: str, opp: str, home: bool, rest: int | None = None, opp_rest: int | None = None) -> dict | None:
        """Everything a projection is made of, before the weights (the
        replay fits the weights on these)."""
        s = self.players.get(pid)
        if s is None:
            before = self.prior_players.get(pid)
            if not before:
                return None
            s = self._player(pid, before["pos"])
        minutes = self.minutes(s)
        if not minutes:
            return None
        g = group(s["pos"])
        rate = self.rate(s)
        overall = self.allowed(opp, "sog")
        position = self.allowed(opp, "f_sog" if g == FORWARD else "d_sog")
        located = self.allowed(opp, "located")
        shares = self.area_shares(s)
        by_area = {a: self.allowed(opp, f"a_{a}") for a in shares}
        fit = sum(share * by_area[a]["factor"] for a, share in shares.items())
        pp = self.allowed(opp, "pp_unb")
        pp_share = self.pp_share(s)
        return {
            "pos": s["pos"], "group": g, "games": s["games"], "prev_games": s["prev_games"],
            "minutes": minutes, "rate": rate, "base": rate["per_min"] * minutes,
            "opp": overall, "position": position, "areas": by_area, "shares": shares, "pp": pp, "pp_share": pp_share,
            # The logs the weights multiply. Position and area are measured
            # against the defense's overall number, so each one only carries
            # what the overall number doesn't already say.
            "x": {
                "opp": math.log(overall["factor"]),
                "pos": math.log(position["factor"] / overall["factor"]),
                "area": math.log(fit / located["factor"]) if fit > 0 else 0.0,
                "pp": pp_share * math.log(pp["factor"]),
                "home": 1.0 if home else 0.0,
                "b2b": 1.0 if rest == 1 else 0.0,
                "opp_b2b": 1.0 if opp_rest == 1 else 0.0,
            },
            "season": dict(s["season"]), "recent": list(s["recent"]),
        }

    def project(self, pid: str, opp: str, home: bool, rest: int | None = None, opp_rest: int | None = None) -> dict | None:
        """parts() plus the projection: `mean` shots on goal and what each
        piece did to it (`lift`: 1.06 = 6% more than his usual)."""
        parts = self.parts(pid, opp, home, rest, opp_rest)
        if parts is None:
            return None
        lift = {key: math.exp(self.w[key] * x) for key, x in parts["x"].items()}
        matchup = math.exp(self.w["scale"])
        for value in lift.values():
            matchup *= value
        return {**parts, "lift": lift, "matchup": matchup, "mean": parts["base"] * matchup}


# ---- from a projection to a price ----
def chance_at_least(mean: float, shots: int, dispersion: float | None = None) -> float:
    """The chance of `shots` or more shots on goal when `mean` are expected.
    A count with a spread of mean + dispersion * mean^2 (negative binomial;
    plain Poisson when dispersion is 0)."""
    k = DISPERSION if dispersion is None else dispersion
    if shots <= 0:
        return 1.0
    if mean <= 0:
        return 0.0
    below = 0.0
    if k <= 1e-9:
        term = math.exp(-mean)
        for n in range(shots):
            below += term
            term *= mean / (n + 1)
    else:
        size = 1 / k
        p = size / (size + mean)
        term = p ** size
        for n in range(shots):
            below += term
            term *= (n + size) / (n + 1) * (1 - p)
    return min(1.0, max(0.0, 1 - below))


def chance_over(mean: float, line: float, dispersion: float | None = None) -> float:
    """Over 2.5 = 3 or more."""
    return chance_at_least(mean, math.floor(line) + 1, dispersion)


def fair_american(chance: float) -> int | None:
    """The price with no cut at which a bet on this chance breaks even."""
    if chance is None or chance <= 0 or chance >= 1:
        return None
    return int(round(-100 * chance / (1 - chance))) if chance >= 0.5 else int(round(100 * (1 - chance) / chance))
