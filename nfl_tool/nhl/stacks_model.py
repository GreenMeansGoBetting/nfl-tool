"""GMG NHL line stacks: the chance that 2, 3 or 4 "1+ point" legs on players
who are on the ice together ALL hit tonight, and its fair parlay price.

    each leg       = the Points model's chance of 1+ point (as shipped)
    shared goals   = a team's goals come one at a time and each gives a point
                     to a scorer and up to two assisters, so two legs hit
                     together whenever one goal gives both a point. A pair's
                     shared rate = rho x sqrt(rate1 x rate2) (rate = -ln(1 -
                     his chance)), a trio's the same with the cube root.
                     rho is one number per relation (same line, D pair, a
                     forward and his line's pair, ...), with the pair's own
                     shared points this season mixed in (K points of rho).
    all legs hit   = follows exactly from those rates (inclusion-exclusion)
    then           + the legs' combined expected goals and the power-play
                     minutes they have played together (logit; both passed
                     the replay's bar)

Every number came from the replay (tools/backtest/nhl_stacks.py chose the
approach, nhl_stacks_check.py fits these numbers through this file): fitted
on 2024-25, confirmed on 2025-26, each season replayed on its own games
only. On 2025-26 with 2024-25's numbers: log loss 0.36474 (the legs
multiplied 0.37544); said vs hit within a point in nearly every bin, but the
surest pairs (said 45%+) hit 48.5% when 51.1% was said, and 4 legs said
15-20% hit 14.4% (said 17.0%). A re-scaling per number of legs didn't fix
them and gained under the bar, so it was left out; the record will watch
them. What did
NOT earn a place: the team total, the defense and the goalie beyond the
legs' own chances, even-strength time together, and his usual linemates
(tonight's projected line named the line that played 74% of the time, his
usual trio 31%). Stacks are made only from a posted projected lineup.

Kinds: line_pair, line_trio, d_pair, line_fd (a forward + a D of his line's
pair: the pair that has shared the most even-strength ice with that line),
line_pair_d, line_trio_d, line_pair_dd, pp_pair (two of the team's usual
first power-play unit who are not on the same line or pair). Forwards on
different lines and players on opposite teams were left out: their points
barely move together (1.05-1.12x and 1.03x).

This season's games only (the owner's rule for the NHL prop tools).

Standard library only: the deploy runs this without numpy.
"""
import math
from collections import Counter
from itertools import combinations

DECAY = 0.985     # each team game further back counts this much (the other models')
PP_UNIT = 5       # his team's first power-play unit: the 5 with the most PP minutes a game
K = 32            # shared points of the relation's rho mixed into a pair's own
# rho per relation (nhl_stacks_check.py, both seasons together, on the stacks
# the site shows). FF_cross, FD_other and DD_cross come only from power-play
# pairs (teammates on the first unit but not the same line or pair).
RHO = {"FF_line": 0.432, "DD_pair": 0.182, "FD_match": 0.143, "FF_cross": 0.177, "FD_other": 0.261, "DD_cross": 0.124,
       "FFF_line": 0.193, "FFD_match": 0.035, "FDD_match": 0.016}
# The two factors on the logit (both seasons together; +/- 0.023, 0.033,
# 0.026): xg = log(the legs' expected goals / XG_AVG for that many legs),
# pp = log(1 + PP minutes together a game, pairs averaged).
WEIGHTS = {"const": -0.08, "xg": 0.069, "pp": 0.125}
XG_AVG = {2: 0.378, 3: 0.56, 4: 0.691}
KINDS = {
    "line_pair": "Line pair", "line_trio": "Full line", "d_pair": "D pair", "line_fd": "Forward + D",
    "line_pair_d": "Line pair + D", "line_trio_d": "Line + D", "line_pair_dd": "Line pair + D pair", "pp_pair": "Power play",
}


# ---- one game's shared ice (from the shift chart) ----
def phases(marks: list, span: int) -> tuple:
    """marks = [(game second, home state, away state)] in order, state = the
    team's strength ("5v5", "ev", "pp", ...) from that play to the next ->
    (even-strength intervals, {"home": PP intervals, "away": PP intervals})."""
    even, pp = [], {"home": [], "away": []}
    for (t, h, a), nxt in zip(marks, [m[0] for m in marks[1:]] + [span]):
        if nxt <= t:
            continue
        if h in ("5v5", "ev"):
            even.append((t, nxt))
        if h == "pp":
            pp["home"].append((t, nxt))
        if a == "pp":
            pp["away"].append((t, nxt))
    return merge(even), {k: merge(v) for k, v in pp.items()}


def merge(spans: list) -> list:
    out = []
    for a, z in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], z))
        elif z > a:
            out.append((a, z))
    return out


def overlap(x: list, y: list) -> list:
    """The intervals two sorted, non-overlapping lists share."""
    out, i, j = [], 0, 0
    while i < len(x) and j < len(y):
        a, z = max(x[i][0], y[j][0]), min(x[i][1], y[j][1])
        if z > a:
            out.append((a, z))
        if x[i][1] < y[j][1]:
            i += 1
        else:
            j += 1
    return out


def seconds(spans: list) -> int:
    return sum(z - a for a, z in spans)


def shared_ice(spans: dict, even: list, pp: list) -> dict:
    """One team's night: spans = {player id: [(start, end) game seconds]}
    -> {"toi": {id: [EV secs, PP secs]}, "pairs": {(p, q): [EV, PP] shared}}
    (p < q). `even` = both sides at even strength; `pp` = this team a man up."""
    ev_on = {p: overlap(merge(s), even) for p, s in spans.items()}
    pp_on = {p: overlap(merge(s), pp) for p, s in spans.items()}
    ids = sorted(spans)
    out = {"toi": {p: [seconds(ev_on[p]), seconds(pp_on[p])] for p in ids}, "pairs": {}}
    for p, q in combinations(ids, 2):
        e, w = seconds(overlap(ev_on[p], ev_on[q])), seconds(overlap(pp_on[p], pp_on[q]))
        if e or w:
            out["pairs"][(p, q)] = [e, w]
    return out


# ---- what each team knows before tonight ----
class StacksHistory:
    """Feed it this season's finished games in date order (add_game). A game
    record is reduce_game's, with `ice` = {team: shared_ice(...)} (None
    without a shift chart). Everything is per team and counts each team game
    further back DECAY as much, so a traded player starts fresh with his new
    linemates."""

    def __init__(self):
        self.teams = {}

    def team(self, team: str) -> dict:
        return self.teams.setdefault(team, {k: Counter() for k in ("ev", "pp", "ev_toi", "pp_toi", "ice_games", "pts", "co")})

    def add_game(self, record: dict):
        for team in (record["home"], record["away"]):
            t = self.team(team)
            for c in t.values():
                for k in c:
                    c[k] *= DECAY
            for pid, s in record["skaters"].items():
                if s["team"] == team:
                    t["pts"][pid] += s["g"] + s["a"]
            for g in record.get("goal_events") or []:
                if g["team"] == team:
                    got = sorted({g["scorer"], *g["assists"]})
                    for n in (2, 3):
                        for sub in combinations(got, n):
                            t["co"][frozenset(sub)] += 1
            ice = (record.get("ice") or {}).get(team)
            if ice:
                for pid, (ev, pp) in ice["toi"].items():
                    t["ev_toi"][pid] += ev
                    t["pp_toi"][pid] += pp
                    t["ice_games"][pid] += 1
                for pair, (ev, pp) in ice["pairs"].items():
                    t["ev"][tuple(sorted(pair))] += ev
                    t["pp"][tuple(sorted(pair))] += pp

    def shared(self, team, p, q, pp=False) -> float:
        return self.team(team)["pp" if pp else "ev"][tuple(sorted((p, q)))]

    def pp_unit(self, team: str, ids: list) -> set:
        """His team's usual first power-play unit among tonight's players."""
        t = self.team(team)
        per_game = {p: t["pp_toi"][p] / t["ice_games"][p] for p in ids if t["ice_games"][p] > 0 and t["pp_toi"][p] > 0}
        return set(sorted(per_game, key=lambda p: (-per_game[p], p))[:PP_UNIT])

    def pp_minutes(self, team: str, p, q) -> float:
        """PP minutes p and q have played together a game (games with a chart)."""
        t = self.team(team)
        games = min(t["ice_games"][p], t["ice_games"][q])
        return t["pp"][tuple(sorted((p, q)))] / 60 / games if games > 0 else 0.0


# ---- the joint chance ----
def pair_relation(sa: str, sb: str, match: dict) -> str:
    """Two teammates' slots ("F1".."F4", "D1".."D3") -> their relation;
    match = {forward line: its D pair}."""
    if not sa or not sb:
        return "other"  # no rho: shares nothing (stacks always have slots)
    if sa[0] == "F" and sb[0] == "F":
        return "FF_line" if sa == sb else "FF_cross"
    if sa[0] == "D" and sb[0] == "D":
        return "DD_pair" if sa == sb else "DD_cross"
    f, d = (sa, sb) if sa[0] == "F" else (sb, sa)
    return "FD_match" if match.get(f) == d else "FD_other"


def trio_relation(slots: list, match: dict) -> str:
    if any(not s for s in slots):
        return "trio_other"
    f = [s for s in slots if s[0] == "F"]
    d = [s for s in slots if s[0] == "D"]
    if len(f) == 3 and len(set(f)) == 1:
        return "FFF_line"
    if len(f) == 2 and f[0] == f[1] and match.get(f[0]) == d[0]:
        return "FFD_match"
    if len(f) == 1 and len(d) == 2 and d[0] == d[1] and match.get(f[0]) == d[0]:
        return "FDD_match"
    return "trio_other"


def shared_rate(rel: str, rates: list, co: float, base: float, rho=None, k=None) -> float:
    """Goals expected tonight that give every one of these legs a point."""
    rho, k = rho or RHO, K if k is None else k
    r0 = rho.get(rel, 0.0)
    r = r0 if math.isinf(k) else (co + k * r0) / (base + k)
    return r * math.prod(rates) ** (1 / len(rates))


def joint_chance(chances: list, shared: dict) -> float:
    """The chance every leg gets a point. chances = each leg's; shared =
    {(i, j): rate, (i, j, k): rate} by leg index (pairs and trios; four can't
    share one goal). Each leg's points are a count at rate -ln(1 - chance)."""
    n = len(chances)
    lam = [-math.log(1 - min(max(p, 1e-9), 1 - 1e-9)) for p in chances]
    l2 = {pq: min(shared.get(pq, 0.0), 0.9 * min(lam[pq[0]], lam[pq[1]])) for pq in combinations(range(n), 2)}
    l3 = {t: min(shared.get(t, 0.0), 0.9 * min(l2[pq] for pq in combinations(t, 2))) for t in combinations(range(n), 3)}
    total = 1.0
    for size in range(1, n + 1):
        for A in combinations(range(n), size):
            U = sum(lam[i] for i in A) - sum(l2[pq] for pq in combinations(A, 2)) + sum(l3[t] for t in combinations(A, 3))
            total += (-1) ** size * math.exp(-U)
    return min(max(total, 1e-6), min(chances))


def adjust(chance: float, legs: int, xg: float, pp: float, ceiling: float, weights=None) -> float:
    """The joint chance with the two factors that passed (on the logit)."""
    w = weights or WEIGHTS
    z = math.log(chance / (1 - chance)) + w["const"] + w["xg"] * math.log(xg / XG_AVG[legs]) + w["pp"] * pp
    return min(1 / (1 + math.exp(-z)), ceiling)


def fair_american(chance: float) -> int | None:
    """The price with no cut at which a bet on this chance breaks even."""
    if chance is None or chance <= 0 or chance >= 1:
        return None
    return int(round(-100 * chance / (1 - chance))) if chance >= 0.5 else int(round(100 * (1 - chance) / chance))


def stack_chance(team: str, legs: list, slots: dict, match: dict, proj: dict, history: StacksHistory) -> dict:
    """One stack: legs = player ids; slots = tonight's {id: slot}; proj = {id:
    {"chance", "goals"}} (the Points page's 1+ chance and the Goals page's
    expected goals)."""
    t = history.team(team)
    chances = [proj[p]["chance"] for p in legs]
    rates = [-math.log(1 - c) for c in chances]
    shared = {}
    for size in (2, 3):
        for idx in combinations(range(len(legs)), size):
            ids = [legs[i] for i in idx]
            rel = pair_relation(slots.get(ids[0]), slots.get(ids[1]), match) if size == 2 else trio_relation([slots.get(p) for p in ids], match)
            base = math.prod(t["pts"][p] for p in ids) ** (1 / size)
            shared[idx] = shared_rate(rel, [rates[i] for i in idx], t["co"][frozenset(ids)], base)
    joint = joint_chance(chances, shared)
    xg = sum(proj[p]["goals"] for p in legs)
    pp = math.log1p(sum(history.pp_minutes(team, p, q) for p, q in combinations(legs, 2)) / math.comb(len(legs), 2))
    chance = adjust(joint, len(legs), xg, pp, min(chances))
    indep = math.prod(chances)
    return {"legs": list(legs), "chances": chances, "joint": joint, "chance": chance, "indep": indep,
            "lift": chance / indep, "fair": fair_american(chance), "factors": {"xg": xg, "pp": pp}}


def team_stacks(team: str, slots: dict, proj: dict, history: StacksHistory) -> list:
    """Every stack for one team tonight, from its posted projected lineup
    (slots = {id: "F1".."F4" / "D1".."D3"}). Legs must be projected (proj)."""
    lines = {}
    for p, s in slots.items():
        if s:
            lines.setdefault(s, []).append(p)
    lines = {s: sorted(g) for s, g in lines.items()}
    pairs_d = {s: g for s, g in lines.items() if s[0] == "D" and len(g) == 2}
    match = {}
    for s, g in lines.items():
        if s[0] == "F" and pairs_d:
            match[s] = max(sorted(pairs_d), key=lambda d: (sum(history.shared(team, f, x) for f in g for x in pairs_d[d]), -int(d[1:])))
    out = []

    def add(kind, legs, line):
        if len(set(legs)) == len(legs) and all(p in proj for p in legs):
            out.append({"kind": kind, "line": line, **stack_chance(team, list(legs), slots, match, proj, history)})

    for s in sorted(lines):
        g = lines[s]
        if s[0] == "D":
            if len(g) == 2:
                add("d_pair", g, s)
            continue
        dp = lines.get(match.get(s), [])
        tag = f"{s}+{match[s]}" if s in match else s
        for pair in combinations(g, 2):
            add("line_pair", pair, s)
            for d in dp:
                add("line_pair_d", (*pair, d), tag)
            if len(dp) == 2:
                add("line_pair_dd", (*pair, *dp), tag)
        if len(g) == 3:
            add("line_trio", g, s)
            for d in dp:
                add("line_trio_d", (*g, d), tag)
        for f in g:
            for d in dp:
                add("line_fd", (f, d), tag)
    unit = sorted(history.pp_unit(team, list(slots)))
    for p, q in combinations(unit, 2):
        if slots.get(p) and slots.get(q) and slots[p] != slots[q]:
            add("pp_pair", (p, q), "PP1")
    return out
