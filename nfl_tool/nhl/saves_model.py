"""GMG NHL saves model: how many saves tonight's starting goalie should
make, and the chance he finishes with the most saves of the day (DraftKings'
"King of the Crease" promo pays on exactly that).

A goalie's saves are mostly decided by the two teams, not by him:

    saves  =  a league-average start
              x  how much the other team shoots
              x  how many shots his own team gives up
              x  home or away, rest
              x  his own save rate (a small piece)

  * The other team's shooting and his own team's shots allowed are read from
    shots on goal and, for a quarter, from shot ATTEMPTS. Each is this
    season's games mixed with a slice of a league-average team, so one wild
    night can't run away with it.
  * Home or away: the road goalie sees more shots. Rest: a team on the second
    night of a back-to-back gives up more, and shoots less.
  * His save rate, pulled hard toward the league's: over a handful of starts
    it is mostly luck.

How much each piece counts (WEIGHTS) was fitted on a replay of 2024-25 and
2025-26, every start projected only from that season's games before it
(tools/backtest/nhl_saves.py). What it found, in plain terms: the two teams'
shot volume is nearly all of it (each moves a projection about 6% either
way); home ice, and each team's rest, about 3%; his own save rate about 1%.
Team strength and recent form added nothing. In a season's first two weeks
the projection is only a hair better than calling every goalie average.

The chance of a save total (save_spread) is a count that is a little
streakier than pure chance, plus a slice for the nights a starter doesn't
finish: about 1 start in 20 ends early, at around 12 saves. The chance to
lead the day puts every starter's spread side by side (top_chances). On the
replay those chances were honest: goalies given 10 to 14% led their day 10%
of the time, the model's favorite led 18% of days (a random pick: 8%), and
its top three had the leader on 42%.

This season's games only: the owner's rule for the NHL prop tools.

Standard library only: the deploy runs this without numpy.
"""
import math
from collections import Counter

PARAMS = {
    "team_decay": 1.0,       # each game further back counts this much of the one after it (1.0: recent form added nothing)
    "team_pad_games": 10,    # a league-average team counts as this many games
    "attempt_blend": 0.25,   # share of a team's shot volume read from attempts instead of shots on goal
    "sv_pad_shots": 600,     # shots at the league's save rate mixed into a goalie's own
}
# How much each piece moves the projection (the fitted exponents; 1.0 = take
# the number at face value). Fitted on 5,034 starts over two seasons and
# rounded; each held its sign in both. "off" = how much the other team shoots
# (1.01 +/- 0.07), "def" = what his own team gives up (0.86 +/- 0.08), "home"
# = he is at home (-3%), "b2b" = his team played yesterday (+3%), "opp_b2b" =
# the other team did (-3%). "sv" is plain arithmetic (saves = shots x save
# rate); the replay couldn't tell it from 1 (1.2 +/- 0.6).
WEIGHTS = {"off": 1.0, "def": 0.85, "home": -0.03, "b2b": 0.03, "opp_b2b": -0.03, "sv": 1.0, "scale": 0.0}
# The spread around a projection m. Most starts: a count with a spread of
# m' + DISPERSION * m'^2. PULLED_SHARE of starts end early (the starter is
# pulled or hurt) at about PULLED_SAVES saves, widely spread; m' is set so the
# two together still average m. Checked on the same replay from 15 saves to
# 43: within a point of what happened at every mark (35 or more: said 7.4%,
# was 7.2%; 40 or more: 1.9% and 1.7%).
DISPERSION = 0.02
PULLED_SHARE = 0.05
PULLED_SAVES = 12.0
PULLED_DISPERSION = 0.25
# The longest save total the chances are worked out to.
MAX_SAVES = 80

TEAM_KEYS = ("sog", "att")


class SavesModel:
    """Feed it this season's finished games in date order (add_game);
    project() reads everything added so far."""

    def __init__(self, params: dict | None = None, weights: dict | None = None):
        self.p = {**PARAMS, **(params or {})}
        self.w = {**WEIGHTS, **(weights or {})}
        self.teams = {}    # team -> Counter of what it took (for_*) and allowed (against_*), and games
        self.goalies = {}  # goalie id -> Counter(starts, saves in starts, shots and goals in every game)
        self.league = Counter()

    # ---- taking in games ----
    def add_game(self, record: dict) -> None:
        decay = self.p["team_decay"]
        for team, other in ((record["home"], record["away"]), (record["away"], record["home"])):
            t = self.teams.setdefault(team, Counter())
            for key in list(t):
                t[key] *= decay
            mine, theirs = record["teams"][team], record["teams"][other]
            t["games"] += 1
            self.league["team_games"] += 1
            for key in TEAM_KEYS:
                t[f"for_{key}"] += mine.get(key, 0)
                t[f"against_{key}"] += theirs.get(key, 0)
                self.league[key] += mine.get(key, 0)
        for pid, line in record["goalies"].items():
            g = self.goalies.setdefault(pid, Counter())
            g["sa"] += line["sa"]
            g["ga"] += line["ga"]
            g["games"] += 1
            self.league["goalie_sa"] += line["sa"]
            self.league["goalie_ga"] += line["ga"]
            if line["start"]:
                saves = line["sa"] - line["ga"]
                g["starts"] += 1
                g["start_saves"] += saves
                g["high"] = max(g["high"], saves)
                self.league["starts"] += 1
                self.league["start_saves"] += saves

    # ---- the pieces ----
    def per_game(self, key: str) -> float:
        """What a league-average team does a game."""
        return self.league[key] / self.league["team_games"] if self.league["team_games"] else 0.0

    def team_rate(self, team: str, side: str, key: str) -> dict:
        """One team's number a game this season (side "for" or "against"),
        steadied with a league-average team, and that against the league."""
        t = self.teams.get(team) or Counter()
        league = self.per_game(key)
        pad = self.p["team_pad_games"]
        games = t["games"]
        blend = (t[f"{side}_{key}"] + pad * league) / (games + pad) if games + pad else league
        return {"season": t[f"{side}_{key}"] / games if games else None, "blend": blend, "league": league, "factor": blend / league if league else 1.0}

    def volume(self, team: str, side: str) -> float:
        """How much a team shoots (side "for") or gives up ("against") against
        the league, read partly from attempts."""
        blend = self.p["attempt_blend"]
        return self.team_rate(team, side, "sog")["factor"] ** (1 - blend) * self.team_rate(team, side, "att")["factor"] ** blend

    def league_sv(self) -> float:
        return 1 - self.league["goalie_ga"] / self.league["goalie_sa"] if self.league["goalie_sa"] else 0.9

    def save_rate(self, goalie: str | None) -> float:
        """His save rate this season with the league's mixed in (sv_pad_shots)."""
        g = self.goalies.get(goalie) or Counter()
        pad = self.p["sv_pad_shots"]
        league = self.league_sv()
        return (g["sa"] - g["ga"] + pad * league) / (g["sa"] + pad) if g["sa"] + pad else league

    def base(self) -> float | None:
        """A league-average start: saves by starters, a start."""
        return self.league["start_saves"] / self.league["starts"] if self.league["starts"] else None

    def parts(self, team: str, opp: str, home: bool, rest: int | None = None, opp_rest: int | None = None, goalie: str | None = None) -> dict | None:
        """Everything a projection is made of, before the weights (the replay
        fits the weights on these). `team` is the goalie's own."""
        base = self.base()
        if not base:
            return None
        sv, league_sv = self.save_rate(goalie), self.league_sv()
        g = self.goalies.get(goalie) or Counter()
        return {
            "base": base, "sv": sv, "league_sv": league_sv,
            "off": self.team_rate(opp, "for", "sog"), "def": self.team_rate(team, "against", "sog"),
            "off_att": self.team_rate(opp, "for", "att"), "def_att": self.team_rate(team, "against", "att"),
            "team_games": (self.teams.get(team) or Counter())["games"], "opp_games": (self.teams.get(opp) or Counter())["games"],
            "starts": g["starts"], "start_saves": g["start_saves"], "high": g["high"], "sa": g["sa"], "ga": g["ga"],
            "x": {
                "off": math.log(self.volume(opp, "for")),
                "def": math.log(self.volume(team, "against")),
                "home": 1.0 if home else 0.0,
                "b2b": 1.0 if rest == 1 else 0.0,
                "opp_b2b": 1.0 if opp_rest == 1 else 0.0,
                "sv": math.log(sv / league_sv) if league_sv else 0.0,
            },
        }

    def project(self, team: str, opp: str, home: bool, rest: int | None = None, opp_rest: int | None = None, goalie: str | None = None) -> dict | None:
        """parts() plus the projection: `mean` saves, the shots on goal that
        goes with it, and what each piece did (`lift`: 1.06 = 6% more)."""
        parts = self.parts(team, opp, home, rest, opp_rest, goalie)
        if parts is None:
            return None
        lift = {key: math.exp(self.w[key] * x) for key, x in parts["x"].items()}
        mean = parts["base"] * math.exp(self.w["scale"])
        for value in lift.values():
            mean *= value
        return {**parts, "lift": lift, "mean": mean, "shots": mean / parts["sv"] if parts["sv"] else None}


# ---- from a projection to a chance ----
def count_spread(mean: float, dispersion: float, top: int) -> list:
    """[chance of exactly 0, 1 ... `top`] for a count with a spread of
    mean + dispersion * mean^2 (negative binomial; plain Poisson at 0)."""
    if mean <= 0:
        return [1.0] + [0.0] * top
    out = []
    if dispersion <= 1e-9:
        term = math.exp(-mean)
        for n in range(top + 1):
            out.append(term)
            term *= mean / (n + 1)
    else:
        size = 1 / dispersion
        p = size / (size + mean)
        term = p ** size
        for n in range(top + 1):
            out.append(term)
            term *= (n + size) / (n + 1) * (1 - p)
    return out


def save_spread(mean: float, top: int = MAX_SAVES) -> list:
    """[chance of exactly 0 saves, 1 save ... `top` saves] for a starter
    projected for `mean`: a full night most of the time, an early exit
    PULLED_SHARE of the time, averaging `mean` between them."""
    if mean <= 0:
        return [1.0] + [0.0] * top
    share = PULLED_SHARE if mean > PULLED_SAVES else 0.0
    full = count_spread((mean - share * PULLED_SAVES) / (1 - share), DISPERSION, top)
    if not share:
        return full
    early = count_spread(PULLED_SAVES, PULLED_DISPERSION, top)
    return [share * a + (1 - share) * b for a, b in zip(early, full)]


def chance_at_least(mean: float, saves: int) -> float:
    """The chance of `saves` or more."""
    if saves <= 0:
        return 1.0
    return min(1.0, max(0.0, 1 - sum(save_spread(mean, saves - 1))))


def chance_over(mean: float, line: float) -> float:
    """Over 27.5 = 28 or more."""
    return chance_at_least(mean, math.floor(line) + 1)


def mean_for_chance(line: float, chance: float) -> float:
    """The projection at which the chance of going over `line` is `chance`:
    a book's line and price turned back into the saves it expects."""
    lo, hi = PULLED_SAVES + 0.5, float(MAX_SAVES - 20)
    for _ in range(40):
        mid = (lo + hi) / 2
        if chance_over(mid, line) < chance:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def known_spread(saves: int, top: int = MAX_SAVES) -> list:
    """A night that is already over: all of the chance on what he made."""
    return [1.0 if n == min(saves, top) else 0.0 for n in range(top + 1)]


def top_chances(means: list) -> list:
    """For each projection, the chance that goalie finishes with the most
    saves of the group, ties included."""
    return lead_chances([save_spread(m) for m in means])


def at_most(spread: list) -> list:
    """[the chance of k saves or fewer, for every k] from a spread."""
    total, out = 0.0, []
    for p in spread:
        total += p
        out.append(min(1.0, total))
    return out


def lead_chance(spread: list, field: list) -> float:
    """The chance a goalie with this spread finishes with at least as many
    saves as everyone in `field` (their at_most lists): the day's most, ties
    included (the promo pays everyone on a tied goalie). Each goalie's night
    is treated as its own draw."""
    chance = 0.0
    for k, p in enumerate(spread):
        if p < 1e-12:
            continue
        for other in field:
            p *= other[k]
        chance += p
    return chance


def lead_chances(spreads: list) -> list:
    """lead_chance for each goalie's spread (save_spread, or known_spread
    once his game is final) against all the others."""
    ceilings = [at_most(spread) for spread in spreads]
    return [lead_chance(spread, ceilings[:i] + ceilings[i + 1:]) for i, spread in enumerate(spreads)]
