"""Walk-forward replay for NHL Line Stacks: 2, 3 or 4 "1+ point" legs on
players who are on the ice together (2026-10-16; step 1, no model yet).

The idea (the owner): when one player on a line scores, his linemates usually
get the assists, so the legs win together far more often than separate bets
would. If we can tell which stacks are most likely to hit, that's the edge.

Every skater in every game of 2024-25 and 2025-26 is projected ONLY from that
season's games before it, through the SHIPPED Points model
(nfl_tool/nhl/points_model.py on top of the shipped Goals and Shots models,
exactly as nhl_points_check.py replays it). 2024-25 fits, 2025-26 checks.
Stacks need every leg projected (5+ games, like the Points replay).

Written down BEFORE the first run: the questions, the candidates, the bar.

The stacks, per team and game, from the NHL's projected-lineups story
(F1-F4 lines, D1-D3 pairs; "matched pair" = the pair that has shared the
most even-strength ice with that line this season, from the shift charts):
  line_pair    two forwards on the same line            (2 legs)
  line_trio    the whole line                           (3 legs)
  d_pair       a defense pair                           (2 legs)
  line_fd      a forward + a D of his line's pair       (2 legs)
  line_pair_d  two linemates + a D of their pair        (3 legs)
  line_trio_d  the line + a D of its pair               (4 legs)
  line_pair_dd two linemates + their D pair             (4 legs)
  cross_line   two forwards on different lines (1-3)    (2 legs)
  pp_cross     two of the team's usual first power-play unit (top 5 by PP
               minutes a game) who are NOT on the same line or pair (2 legs)
  opp_top      one first-liner from each team           (2 legs)
  u_line_pair / u_line_trio: the same as line_pair / line_trio, but the line
               is his USUAL one (shift charts so far: the busiest forward and
               the two he has shared the most even-strength ice with, and so
               on), not tonight's projected one.

Q1. How much more often do linemates' points come together than chance?
    For each kind: the real rate of "all legs hit" against the Points model's
    chances multiplied together (lift = real / multiplied), both seasons,
    with a standard error that treats each game as one draw.
Q2. Does tonight's projected line pick stacks better than his usual
    linemates? (a) Which one names the trio that actually played together
    (the shift chart's line that night)? (b) The lift of each one's trios and
    pairs. (c) Where they disagree: the projected trio that isn't a usual one,
    and the usual trio that was broken up.
Q3. What predicts which stacks hit, BEYOND the joint chance (Q4's winner)?
    One logistic fit with the joint chance as the starting point, game-
    clustered standard errors, same-team stacks:
      xg      the legs' combined expected goals tonight (log, vs average)
      team    his team's expected goals tonight (all its projected players)
      opp     the other defense's expected goals allowed (the Goals piece)
      goalie  tonight's goalie (the Goals piece)
      pp_tog  power-play minutes the legs have played together a game
      ev_tog  the share of their even-strength ice they have shared
      agree   tonight's projected line is also his usual one
Q4. The joint chance, and is it honest? Candidates, each on 2025-26 with
    every number fitted on 2024-25:
      M0  the legs multiplied (no correlation)
      M1  M0 x one lift per kind (Q1's 2024-25 lift)
      M2  "shared goals": a team's goals come one at a time and each gives
          points to a scorer and up to two assisters, so two legs hit
          together whenever one goal gives both a point. Each leg's points
          are a count with rate -ln(1 - his chance); a pair's shared rate is
          rho x sqrt(rate1 x rate2), a trio's the same with the cube root,
          rho one number per relation (same line, D pair, line + its pair,
          cross line, other), fitted by matching the shared points actually
          seen in 2024-25. The chance all hit then follows exactly
          (inclusion-exclusion). Opposite teams can't share a goal: M0.
      M3  M2 with each pair's / trio's own shared points this season mixed
          in (K points of the relation's rho; K picked on 2024-25)
      M4  the better of M2 / M3, re-scaled on the logit per number of legs
          (a + b x logit), like the Points model's CALIBRATION
    Honest = said vs hit in bins (0-3%, 3-6, 6-10, 10-15, 15-20, 20-30,
    30-45, 45+).

The bar, set before the first run:
  * Correlation is real for a kind when its lift is 2+ standard errors from
    1 on BOTH seasons.
  * The joint model: the lowest 2025-26 log loss on "all legs hit" over all
    same-team stacks wins, and it must beat M0 and M1. The simpler one wins
    within 0.0002. It must also be honest: every bin with 500+ stacks within
    2 points or 2 standard errors of what it said.
  * A Q3 factor counts only at 2+ (clustered) standard errors on 2024-25,
    the same sign fitted on 2025-26 alone, and the passing factors together
    must lower 2025-26's log loss.
  * Q2: the one that names the real line more often AND has the higher
    trio lift on both seasons is the one to build on; a split is reported
    and the owner decides.

Step 1 found (2026-10-16, first run):
  Q1. Linemates' points DO come together: a whole line hit all three legs
      16.2% / 15.7% of the time against 7.7% / 8.2% multiplied (lift 2.09 /
      1.91, +/-0.05); line pairs 1.44 / 1.35, D pairs 1.30 / 1.36, line + D
      1.16, line pair + D 1.64 / 1.59, line + D (4 legs) 2.35 / 2.20, line
      pair + D pair 2.04 / 2.16. Smaller but real: first power-play unit
      across lines 1.21 / 1.19, forwards on different lines 1.12 / 1.05.
      Opposite teams: 1.04 / 1.03 +/-0.03 (nothing). The lower the line,
      the bigger the lift (2025-26 trios: L1 1.64, L2 2.00, L3 2.23, L4 4.6).
  Q2. Tonight's projected line wins on both counts, both seasons: its trios
      actually played together 75% / 74% of the time (usual linemates 33% /
      31%) and their lift is higher (2.09 / 1.91 vs 1.79 / 1.58). A
      projected trio that isn't a usual one still lifts 2.15 / 1.97; a usual
      trio broken up tonight 1.61 / 1.42.
  Q4. M3 wins (2025-26 log loss 0.39803; M0 0.40649, M1 0.39992, M2
      0.39830; M4 ties M3, so the simpler M3). K = 32 (a pair's own shared
      points matter only after a lot of them). rho on 2024-25: same line
      0.44, D pair 0.18, forward + his line's pair 0.14, the line's trio
      0.19. (FD_other, DD_cross and "other" come only from the power-play
      stacks: a forward and a D, or two D, on PP1 but not the same line.)
      Honest: every bin within 1 point (3-legs "3-6%" hit 3.9% said 4.6%).
      A middle first-line trio (legs 53%, 54%, 51%): multiplied 14.5%
      (+591), joint 24.5% (+308).
  Q3. Two factors pass: power-play minutes together (z 4.5, same sign
      2025-26) and the legs' combined expected goals (z 2.2); together they
      lower 2025-26's log loss 0.39803 -> 0.39776 (about +5% / +4% a
      standard deviation). The team total, the defense, the goalie, even-
      strength time together and "projected = usual" add nothing beyond M3.

What it can NOT say: whether any stack beats the price. There is no free
history of same-game parlay prices (and each book prices its own
correlation into its builder), so the record will grade that live. Nor can
it test tonight's real power-play units (nhl.md, "Power-play units").

    python tools/backtest/nhl_stacks.py                  (about 6 minutes)
    python tools/backtest/nhl_stacks.py --rows <folder>  (keeps the replay's rows there; a second run reads them)

Needs data/nhl/games, shifts, previews and pp_toi for 2025 and 2026.
"""
import argparse
import gzip
import json
import math
import pickle
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nhl_goals import DATA, b, sm  # noqa: E402
from nhl_goals_check import np_fit  # noqa: E402
from nhl_shots import game_slots, load_previews  # noqa: E402
import goals_model as gm  # noqa: E402
import points_model as pm  # noqa: E402

FIT, TEST = 2025, 2026
MIN_GAMES = 5
REFIT_DAYS = 7
DECAY = 0.985          # each team game further back counts this much (the models' own)
PERIOD = 1200
SPAN = 4 * PERIOD      # three periods and overtime, in seconds
PP_UNIT = 5
K_GRID = (1, 2, 4, 8, 16, 32, 64, math.inf)
BINS = (0, .03, .06, .10, .15, .20, .30, .45, 1.01)
FACTORS = ("xg", "team", "opp", "goalie", "pp_tog", "ev_tog", "agree")
KINDS = ("line_pair", "line_trio", "d_pair", "line_fd", "line_pair_d", "line_trio_d", "line_pair_dd",
         "cross_line", "pp_cross", "opp_top", "u_line_pair", "u_line_trio")
PAIR_RELS = ("FF_line", "DD_pair", "FD_match", "FD_other", "FF_cross", "DD_cross", "other")
TRIO_RELS = ("FFF_line", "FFD_match", "FDD_match", "trio_other")


# ---- one game: who shared the ice, at even strength and on the power play ----
def shared_ice(raw: dict, rec: dict) -> dict | None:
    """{team: (ids, even-strength seconds shared, power-play seconds shared)}:
    two square tables (the diagonal = his own seconds). None without a chart."""
    shifts = raw.get("shifts")
    if not shifts:
        return None
    pbp = raw["pbp"]
    marks = []
    for p in sorted(pbp.get("plays") or [], key=lambda p: p.get("sortOrder", 0)):
        per = p.get("periodDescriptor") or {}
        if per.get("periodType") == "SO" or not per.get("number") or per["number"] > 4:
            continue
        marks.append(((per["number"] - 1) * PERIOD + b.clock_seconds(p.get("timeInPeriod")), p.get("situationCode")))
    even = np.zeros(SPAN, dtype=np.float32)
    pp = {rec["home"]: np.zeros(SPAN, dtype=np.float32), rec["away"]: np.zeros(SPAN, dtype=np.float32)}
    for (t, code), (nxt, _) in zip(marks, marks[1:] + [(SPAN, None)]):
        if nxt <= t:
            continue
        h, a = b.strength(code, True), b.strength(code, False)
        if h in ("5v5", "ev"):
            even[t:nxt] = 1
        if h == "pp":
            pp[rec["home"]][t:nxt] = 1
        if a == "pp":
            pp[rec["away"]][t:nxt] = 1
    out = {}
    for team in (rec["home"], rec["away"]):
        ids = [pid for pid, s in rec["skaters"].items() if s["team"] == team]
        index = {pid: i for i, pid in enumerate(ids)}
        on = np.zeros((len(ids), SPAN), dtype=np.float32)
        for pid, _team, per, start, end in shifts:
            i = index.get(str(pid))
            if i is None or per > 4:
                continue
            a, z = (per - 1) * PERIOD + b.clock_seconds(start), (per - 1) * PERIOD + b.clock_seconds(end)
            on[i, a:z] = 1
        out[team] = (ids, (on * even) @ on.T, (on * pp[team]) @ on.T)
    return out


def load(season: int) -> list:
    """The season's games as the build reads them (power-play seconds and the
    shift chart attached), each with its shared-ice tables."""
    with gzip.open(DATA / "pp_toi" / f"{season}.json.gz", "rt", encoding="utf-8") as f:
        pp = json.load(f)
    games = []
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        raw.setdefault("pp_toi", pp.get(path.name.split(".")[0]))
        sp = DATA / "shifts" / str(season) / path.name
        if "shifts" not in raw and sp.exists():
            with gzip.open(sp, "rt", encoding="utf-8") as f:
                raw["shifts"] = json.load(f)
        rec = b.reduce_game(raw)
        rec["ice"] = shared_ice(raw, rec)
        games.append(rec)
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


# ---- what each team knows before tonight (decayed by team game) ----
class Team:
    def __init__(self):
        self.ev, self.pp = Counter(), Counter()          # (p, q) sorted: seconds shared
        self.ev_toi, self.pp_toi, self.games = Counter(), Counter(), Counter()
        self.pts, self.co = Counter(), Counter()          # points; frozenset of 2-3: goals where all got a point

    def decay(self):
        for c in (self.ev, self.pp, self.ev_toi, self.pp_toi, self.games, self.pts, self.co):
            for k in c:
                c[k] *= DECAY

    def add(self, rec: dict, team: str):
        self.decay()
        for pid, s in rec["skaters"].items():
            if s["team"] == team:
                self.games[pid] += 1
                self.pts[pid] += s["g"] + s["a"]
        for g in rec["goal_events"]:
            if g["team"] != team:
                continue
            got = sorted({g["scorer"], *g["assists"]})
            for n in (2, 3):
                for sub in combinations(got, n):
                    self.co[frozenset(sub)] += 1
        ice = (rec.get("ice") or {}).get(team)
        if ice:
            ids, ev, pp = ice
            for i, p in enumerate(ids):
                self.ev_toi[p] += float(ev[i, i])
                self.pp_toi[p] += float(pp[i, i])
                for j in range(i + 1, len(ids)):
                    key = tuple(sorted((p, ids[j])))
                    if ev[i, j]:
                        self.ev[key] += float(ev[i, j])
                    if pp[i, j]:
                        self.pp[key] += float(pp[i, j])

    def shared(self, p, q, pp=False):
        return (self.pp if pp else self.ev)[tuple(sorted((p, q)))]

    def usual_lines(self, ids: list, size: int) -> list:
        """His usual lines (size 3) or pairs (size 2) among tonight's players:
        the busiest and the ones he has shared the most even-strength ice
        with, then the next. Players with no ice so far are left out."""
        left = sorted((p for p in ids if self.ev_toi[p] > 0), key=lambda p: -self.ev_toi[p] / max(self.games[p], 1e-9))
        groups = []
        while len(left) >= size:
            lead = left.pop(0)
            mates = sorted(left, key=lambda q: -self.shared(lead, q))[:size - 1]
            for m in mates:
                left.remove(m)
            groups.append([lead, *mates])
        return groups

    def pp_unit(self, ids: list) -> set:
        per_game = {p: self.pp_toi[p] / self.games[p] for p in ids if self.games[p] > 0 and self.pp_toi[p] > 0}
        return set(sorted(per_game, key=lambda p: -per_game[p])[:PP_UNIT])


# ---- one game's stacks ----
def game_stacks(r: dict, slots: dict, proj: dict, teams: dict, gidx: int, out: dict, subsets: dict):
    """Adds the game's stacks to `out` (column lists) and their pairs / trios
    to `subsets` (one row per pair or trio a game)."""
    pts = {pid: s["g"] + s["a"] for pid, s in r["skaters"].items()}
    actual = {pid: s.get("slot") for pid, s in r["skaters"].items()}
    shared_pts = Counter()
    for g in r["goal_events"]:
        got = sorted({g["scorer"], *g["assists"]})
        for n in (2, 3):
            for sub in combinations(got, n):
                shared_pts[frozenset(sub)] += 1
    local = {}
    per_team = {}
    for team in (r["home"], r["away"]):
        st = teams[team]
        ids = [pid for pid, s in r["skaters"].items() if s["team"] == team]
        fwd = [p for p in ids if r["skaters"][p]["pos"] != "D"]
        dmen = [p for p in ids if r["skaters"][p]["pos"] == "D"]
        posted = any(slots.get(p) for p in ids)
        lines = {}
        if posted:
            for p in ids:
                if slots.get(p):
                    lines.setdefault(slots[p], []).append(p)
        u_lines = st.usual_lines(fwd, 3)
        u_pairs = st.usual_lines(dmen, 2)
        u_slot = {p: f"F{i + 1}" for i, g in enumerate(u_lines) for p in g}
        u_slot.update({p: f"D{i + 1}" for i, g in enumerate(u_pairs) for p in g})
        if not posted:  # no story: tonight's lines are his usual ones
            lines = {f"F{i + 1}": g for i, g in enumerate(u_lines)}
            lines.update({f"D{i + 1}": g for i, g in enumerate(u_pairs)})
        slot_of = {p: k for k, g in lines.items() for p in g}
        pairs_d = {k: g for k, g in lines.items() if k.startswith("D") and len(g) == 2}
        match = {}
        for k, g in lines.items():
            if k.startswith("F") and pairs_d:
                best = max(pairs_d, key=lambda d: (sum(st.shared(f, x) for f in g for x in pairs_d[d]), -int(d[1:])))
                match[k] = best
        team_xg = sum(v["g"] for pid, v in proj.items() if v["team"] == team)
        per_team[team] = dict(st=st, lines=lines, slot_of=slot_of, match=match, posted=posted, u_lines=u_lines,
                              u_slot=u_slot, pp1=st.pp_unit(ids), team_xg=team_xg, ids=ids)

    def relation(sub):
        team = proj[sub[0]]["team"]
        if any(proj[p]["team"] != team for p in sub):
            return "opp"
        t = per_team[team]
        so = [t["slot_of"].get(p) for p in sub]
        if any(s is None for s in so):
            return "other" if len(sub) == 2 else "trio_other"
        f = [s for s in so if s.startswith("F")]
        d = [s for s in so if s.startswith("D")]
        if len(sub) == 2:
            if len(f) == 2:
                return "FF_line" if f[0] == f[1] else "FF_cross"
            if len(d) == 2:
                return "DD_pair" if d[0] == d[1] else "DD_cross"
            return "FD_match" if t["match"].get(f[0]) == d[0] else "FD_other"
        if len(f) == 3 and len(set(f)) == 1:
            return "FFF_line"
        if len(f) == 2 and f[0] == f[1] and t["match"].get(f[0]) == d[0]:
            return "FFD_match"
        if len(f) == 1 and len(d) == 2 and d[0] == d[1] and t["match"].get(f[0]) == d[0]:
            return "FDD_match"
        return "trio_other"

    def subset_index(sub):
        key = frozenset(sub)
        if key in local:
            return local[key]
        rel = relation(sub)
        st = per_team[proj[sub[0]]["team"]]["st"]
        lam = [proj[p]["lam"] for p in sub]
        local[key] = len(subsets["rel"])
        subsets["rel"].append(rel)
        subsets["size"].append(len(sub))
        subsets["co"].append(st.co[key] if rel != "opp" else 0.0)
        subsets["base"].append(float(np.prod([st.pts[p] for p in sub])) ** (1 / len(sub)) if rel != "opp" else 0.0)
        subsets["geolam"].append(float(np.prod(lam)) ** (1 / len(sub)))
        subsets["y"].append(shared_pts[key])
        subsets["game"].append(gidx)
        return local[key]

    def add(kind, legs, line_no=0, together=None):
        legs = list(legs)
        if len(legs) < 2 or len(set(legs)) < len(legs) or any(p not in proj for p in legs):
            return
        team = proj[legs[0]]["team"]
        same = all(proj[p]["team"] == team for p in legs)
        t = per_team[team]
        pairs = list(combinations(legs, 2))
        idx2 = [subset_index(s) for s in pairs] + [-1] * (6 - len(pairs))
        idx3 = [subset_index(s) for s in combinations(legs, 3)] + [-1] * (4 - math.comb(len(legs), 3))
        fwd = [p for p in legs if r["skaters"][p]["pos"] != "D"]
        out["kind"].append(kind)
        out["game"].append(gidx)
        out["n"].append(len(legs))
        out["p"].append([proj[p]["p"] for p in legs] + [np.nan] * (4 - len(legs)))
        out["hit"].append(all(pts[p] > 0 for p in legs))
        out["idx2"].append(idx2)
        out["idx3"].append(idx3)
        out["line_no"].append(line_no)
        out["together"].append(-1 if together is None else int(together))
        # Q3's factors (same-team stacks).
        if same:
            ev = [t["st"].shared(p, q) / max(min(t["st"].ev_toi[p], t["st"].ev_toi[q]), 1.0) for p, q in pairs]
            ppm = [t["st"].shared(p, q, True) / 60 / max(min(t["st"].games[p], t["st"].games[q]), 1e-9) for p, q in pairs]
            us = {t["u_slot"].get(p) for p in fwd}
            ts = {t["slot_of"].get(p) for p in fwd}
            row = [sum(proj[p]["g"] for p in legs), t["team_xg"], np.mean([proj[p]["opp"] for p in legs]),
                   np.mean([proj[p]["goalie"] for p in legs]), math.log1p(np.mean(ppm)), float(np.mean(ev)),
                   float(len(fwd) >= 2 and len(us) == 1 and None not in us and len(ts) == 1 and t["posted"])]
        else:
            row = [np.nan] * len(FACTORS)
        out["x"].append(row)

    def played_together(group):
        s = {actual.get(p) for p in group}
        return None if None in s else len(s) == 1

    for team, t in per_team.items():
        lines = t["lines"]
        for k in sorted(lines):
            g = lines[k]
            if k.startswith("F"):
                n = int(k[1:])
                tog = played_together(g) if len(g) == 3 else None
                for pair in combinations(g, 2):
                    add("line_pair", pair, n, played_together(pair))
                if len(g) == 3:
                    add("line_trio", g, n, tog)
                dp = lines.get(t["match"].get(k), [])
                for f in g:
                    for d in dp:
                        add("line_fd", (f, d), n)
                for pair in combinations(g, 2):
                    for d in dp:
                        add("line_pair_d", (*pair, d), n)
                    if len(dp) == 2:
                        add("line_pair_dd", (*pair, *dp), n)
                if len(g) == 3:
                    for d in dp:
                        add("line_trio_d", (*g, d), n)
            elif len(g) == 2:
                add("d_pair", g, int(k[1:]), played_together(g))
        top = [k for k in ("F1", "F2", "F3") if k in lines]
        for a, z in combinations(top, 2):
            for p in lines[a]:
                for q in lines[z]:
                    add("cross_line", (p, q), 0)
        pp1 = sorted(t["pp1"])
        for p, q in combinations(pp1, 2):
            sp, sq = t["slot_of"].get(p), t["slot_of"].get(q)
            if sp and sq and sp != sq:
                add("pp_cross", (p, q), 0)
        if t["posted"]:
            for i, g in enumerate(t["u_lines"]):
                n = i + 1
                for pair in combinations(g, 2):
                    add("u_line_pair", pair, n, played_together(pair))
                add("u_line_trio", g, n, played_together(g))
    h, a = per_team[r["home"]]["lines"].get("F1", []), per_team[r["away"]]["lines"].get("F1", [])
    for p in h:
        for q in a:
            add("opp_top", (p, q), 1)
    # Q2 (c): projected trios that aren't a usual line, usual ones broken up tonight.
    for team, t in per_team.items():
        if not t["posted"]:
            continue
        usual = {frozenset(g) for g in t["u_lines"]}
        for k, g in t["lines"].items():
            if k.startswith("F") and len(g) == 3:
                out["q2"].append(("proj_new" if frozenset(g) not in usual else "proj_same", tuple(g), gidx))
        proj_sets = {frozenset(g) for k, g in t["lines"].items() if k.startswith("F")}
        for g in t["u_lines"]:
            if frozenset(g) not in proj_sets:
                out["q2"].append(("usual_broken", tuple(g), gidx))


def replay(games: list, previews: dict, hand: dict) -> dict:
    shots = sm.ShotsModel()
    goals = gm.GoalsModel(shots, hand)
    points = pm.PointsModel(goals)
    teams = defaultdict(Team)
    history, last_fit, last_played = [], None, {}
    out = {k: [] for k in ("kind", "game", "n", "p", "hit", "idx2", "idx3", "line_no", "together", "x", "q2")}
    subsets = {k: [] for k in ("rel", "size", "co", "base", "geolam", "y", "game")}
    q2_hits = {}
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    gidx = 0
    for date in sorted(by_date):
        day = np.datetime64(date)
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(REFIT_DAYS, "D")):
            for s in history:
                s["offwing"] = gm.off_wing(s, hand)
            goals.xg = {False: np_fit(history, False), True: np_fit(history, True)}
            last_fit = day
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            proj = {}
            for pid, line in r["skaters"].items():
                p = points.players.get(pid)
                if not p or p["season"]["games"] < MIN_GAMES:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                pr = points.project(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid), starters.get(opp))
                if pr is None:
                    continue
                proj[pid] = {"p": pr["chance"], "lam": -math.log(1 - pr["chance"]), "g": pr["goals_mean"],
                             "opp": pr["goals"]["x"]["opp"], "goalie": pr["goals"]["x"]["goalie"], "team": team}
            game_stacks(r, slots, proj, teams, gidx, out, subsets)
            q2_hits[gidx] = {pid: s["g"] + s["a"] > 0 for pid, s in r["skaters"].items()}
            q2_hits[gidx]["_p"] = {pid: v["p"] for pid, v in proj.items()}
            q2_hits[gidx]["_slot"] = {pid: s.get("slot") for pid, s in r["skaters"].items()}
            gidx += 1
        for r in by_date[date]:
            shots.add_game(r)
            goals.add_game(r)
            points.add_game(r)
            for team in (r["home"], r["away"]):
                teams[team].add(r, team)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
    rows = {k: np.array(v, dtype=object if k in ("kind", "q2") else float) for k, v in out.items() if k != "q2"}
    rows["kind"] = np.array(out["kind"])
    rows["idx2"] = rows["idx2"].astype(int)
    rows["idx3"] = rows["idx3"].astype(int)
    rows["n"] = rows["n"].astype(int)
    rows["game"] = rows["game"].astype(int)
    sub = {k: np.array(v, dtype=float) for k, v in subsets.items() if k != "rel"}
    sub["rel"] = np.array(subsets["rel"])
    return {"stacks": rows, "subsets": sub, "q2": out["q2"], "q2_hits": q2_hits}


# ---- the joint chance ----
def clip(p):
    return np.clip(p, 1e-6, 1 - 1e-6)


def logit(p):
    p = clip(p)
    return np.log(p / (1 - p))


def logloss(y, p):
    p = clip(p)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def rho_fit(sub: dict, K: float) -> dict:
    """rho per relation, matching the shared points actually seen (closed form)."""
    out = {}
    for rel in np.unique(sub["rel"]):
        m = sub["rel"] == rel
        if rel == "opp":
            out[rel] = 0.0
            continue
        g, co, base, y = sub["geolam"][m], sub["co"][m], sub["base"][m], sub["y"][m]
        if math.isinf(K):
            out[rel] = max(0.0, y.sum() / g.sum())
        else:
            own = (g * co / (base + K)).sum()
            out[rel] = max(0.0, (y.sum() - own) / (g * K / (base + K)).sum())
    return out


def subset_lam(sub: dict, rho: dict, K: float) -> np.ndarray:
    r0 = np.array([rho.get(rel, 0.0) for rel in sub["rel"]])
    r = r0 if math.isinf(K) else (sub["co"] + K * r0) / (sub["base"] + K)
    return r * sub["geolam"]


def joint(st: dict, lamB: np.ndarray) -> np.ndarray:
    """The chance every leg hits, when each leg's points are a count and a
    pair / trio share goals at the rates lamB (inclusion-exclusion)."""
    out = np.zeros(len(st["n"]))
    for n in (2, 3, 4):
        m = st["n"] == n
        if not m.any():
            continue
        p = st["p"][m][:, :n]
        lam = -np.log(1 - p)
        pairs = list(combinations(range(n), 2))
        trios = list(combinations(range(n), 3))
        l2 = lamB[st["idx2"][m][:, :len(pairs)]] if pairs else np.zeros((m.sum(), 0))
        for c, (i, j) in enumerate(pairs):
            l2[:, c] = np.minimum(l2[:, c], 0.9 * np.minimum(lam[:, i], lam[:, j]))
        l3 = lamB[st["idx3"][m][:, :len(trios)]] if trios else np.zeros((m.sum(), 0))
        for c, tr in enumerate(trios):
            cap = np.min([l2[:, pairs.index(pq)] for pq in combinations(tr, 2)], axis=0)
            l3[:, c] = np.minimum(l3[:, c], 0.9 * cap)
        total = np.ones(m.sum())
        for size in range(1, n + 1):
            for A in combinations(range(n), size):
                U = lam[:, list(A)].sum(axis=1)
                U -= sum(l2[:, c] for c, pq in enumerate(pairs) if set(pq) <= set(A)) if size >= 2 else 0
                U += sum(l3[:, c] for c, tr in enumerate(trios) if set(tr) <= set(A)) if size >= 3 else 0
                total += (-1) ** size * np.exp(-U)
        out[m] = np.minimum(np.maximum(total, 1e-6), p.min(axis=1))
    return out


def product(st):
    return np.nanprod(st["p"], axis=1)


def lift_se(y, p, game):
    """real / said, with a standard error that treats each game as one draw."""
    Y = np.bincount(game, weights=y)
    P = np.bincount(game, weights=p)
    R = Y.sum() / P.sum()
    return R, math.sqrt(((Y - R * P) ** 2).sum()) / P.sum()


def logistic(X, y, off, game):
    w = np.zeros(X.shape[1])
    for _ in range(40):
        p = 1 / (1 + np.exp(-(off + X @ w)))
        H = X.T @ (X * (p * (1 - p))[:, None])
        step = np.linalg.solve(H, X.T @ (y - p))
        w += step
        if np.abs(step).max() < 1e-9:
            break
    p = 1 / (1 + np.exp(-(off + X @ w)))
    s = np.zeros((game.max() + 1, X.shape[1]))
    np.add.at(s, game, X * (y - p)[:, None])
    Hi = np.linalg.inv(X.T @ (X * (p * (1 - p))[:, None]))
    return w, np.sqrt(np.diag(Hi @ (s.T @ s) @ Hi))


def honest(y, p, label):
    print(f"   {label}")
    for lo, hi in zip(BINS, BINS[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum() >= 100:
            got, said = y[m].mean(), p[m].mean()
            se = math.sqrt(said * (1 - said) / m.sum())
            flag = "" if m.sum() < 500 or abs(got - said) <= max(0.02, 2 * se) else "   <-- off"
            print(f"     {100 * lo:4.0f}-{100 * min(hi, 1):<4.0f}% {int(m.sum()):>8,}  hit {100 * got:5.1f}%  (said {100 * said:5.1f}%){flag}")


def american(p):
    return f"+{100 * (1 - p) / p:,.0f}" if p < 0.5 else f"-{100 * p / (1 - p):,.0f}"


# ---- the report ----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", help="folder to keep (and later read) each season's replay rows")
    args = ap.parse_args()
    data = {}
    hand = None
    for season in (FIT, TEST):
        path = Path(args.rows) / f"stacks_{season}.pkl" if args.rows else None
        if path and path.exists():
            with open(path, "rb") as f:
                data[season] = pickle.load(f)
            continue
        if hand is None:
            hand = {}
            for s in (FIT, TEST):
                for pid, row in b.fetch_report("skater/timeonice", s, "playerId").items():
                    if row.get("shootsCatches"):
                        hand[str(pid)] = row["shootsCatches"]
        print(f"Replaying {b.season_label(season)}...", flush=True)
        games = load(season)
        data[season] = replay(games, load_previews(season, games), hand)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "wb") as f:
                pickle.dump(data[season], f)

    for season in (FIT, TEST):
        st = data[season]["stacks"]
        st["prod"] = product(st)
        st["hit"] = st["hit"].astype(float)

    # Q1
    print("\nQ1. All legs hit: real vs the Points model's chances multiplied (lift = real / multiplied)")
    print(f"   {'kind':<13} {'legs':>4} | {'2024-25: stacks':>15} {'said':>6} {'real':>6} {'lift':>12} | {'2025-26: stacks':>15} {'said':>6} {'real':>6} {'lift':>12}")
    lifts = {}
    for kind in KINDS:
        cells = []
        for season in (FIT, TEST):
            st = data[season]["stacks"]
            m = st["kind"] == kind
            if not m.any():
                cells.append(" " * 50)
                continue
            R, se = lift_se(st["hit"][m], st["prod"][m], st["game"][m])
            if season == FIT:
                lifts[kind] = R
            cells.append(f"{int(m.sum()):>15,} {100 * st['prod'][m].mean():5.1f}% {100 * st['hit'][m].mean():5.1f}% {R:6.2f} ±{se:4.2f}")
            legs = int(st["n"][m][0])
        print(f"   {kind:<13} {legs:>4} | {cells[0]} | {cells[1]}")
    print("   By line (line_trio / line_pair, 2025-26):")
    st = data[TEST]["stacks"]
    for kind in ("line_trio", "line_pair", "d_pair"):
        parts = []
        for n in (1, 2, 3, 4):
            m = (st["kind"] == kind) & (st["line_no"] == n)
            if m.sum() > 100:
                R, se = lift_se(st["hit"][m], st["prod"][m], st["game"][m])
                parts.append(f"{n}: {100 * st['hit'][m].mean():4.1f}% hit, lift {R:.2f}±{se:.2f}")
        print(f"     {kind:<10} " + " | ".join(parts))

    # Q2
    print("\nQ2. Tonight's projected line vs his usual linemates (games with a posted lineup)")
    for season in (FIT, TEST):
        st = data[season]["stacks"]
        print(f"   {b.season_label(season)}:")
        for a, z in (("line_trio", "u_line_trio"), ("line_pair", "u_line_pair")):
            for kind in (a, z):
                m = (st["kind"] == kind) & (st["together"] >= 0)
                mm = st["kind"] == kind
                R, se = lift_se(st["hit"][mm], st["prod"][mm], st["game"][mm])
                print(f"     {kind:<12} played together that night {100 * st['together'][m].mean():5.1f}%   all hit {100 * st['hit'][mm].mean():5.1f}% (said {100 * st['prod'][mm].mean():4.1f}%)  lift {R:.2f}±{se:.2f}")
        hits = data[season]["q2_hits"]
        for label in ("proj_same", "proj_new", "usual_broken"):
            ys, ps, gs, tg = [], [], [], []
            for lab, g, gidx in data[season]["q2"]:
                if lab != label:
                    continue
                h = hits[gidx]
                if not all(p in h["_p"] for p in g):
                    continue
                ys.append(all(h.get(p) for p in g))
                ps.append(np.prod([h["_p"][p] for p in g]))
                gs.append(gidx)
                s = {h["_slot"].get(p) for p in g}
                tg.append(None not in s and len(s) == 1)
            if ys:
                R, se = lift_se(np.array(ys, float), np.array(ps), np.array(gs))
                print(f"     {label:<13} {len(ys):>6,} trios  played together {100 * np.mean(tg):5.1f}%  all hit {100 * np.mean(ys):4.1f}% (said {100 * np.mean(ps):4.1f}%)  lift {R:.2f}±{se:.2f}")

    # Q4: the joint models
    print("\nQ4. The joint chance, fitted on 2024-25, scored on 2025-26 (same-team stacks)")
    f, t = data[FIT], data[TEST]
    same_f = np.array([k != "opp_top" for k in f["stacks"]["kind"]])
    same_t = np.array([k != "opp_top" for k in t["stacks"]["kind"]])
    yf, yt = f["stacks"]["hit"], t["stacks"]["hit"]
    models = {}
    models["M0"] = (f["stacks"]["prod"], t["stacks"]["prod"])
    lf = np.array([lifts[k] for k in f["stacks"]["kind"]])
    lt = np.array([lifts[k] for k in t["stacks"]["kind"]])
    models["M1"] = (np.minimum(f["stacks"]["prod"] * lf, np.nanmin(f["stacks"]["p"], axis=1)),
                    np.minimum(t["stacks"]["prod"] * lt, np.nanmin(t["stacks"]["p"], axis=1)))
    rho2 = rho_fit(f["subsets"], math.inf)
    models["M2"] = (joint(f["stacks"], subset_lam(f["subsets"], rho2, math.inf)), joint(t["stacks"], subset_lam(t["subsets"], rho2, math.inf)))
    best_k, best = None, None
    for K in K_GRID[:-1]:
        rho = rho_fit(f["subsets"], K)
        pf = joint(f["stacks"], subset_lam(f["subsets"], rho, K))
        score = logloss(yf[same_f], pf[same_f])
        print(f"   M3 K={K:<3} 2024-25 log loss {score:.5f}")
        if best is None or score < best:
            best, best_k = score, K
    rho3 = rho_fit(f["subsets"], best_k)
    models["M3"] = (joint(f["stacks"], subset_lam(f["subsets"], rho3, best_k)), joint(t["stacks"], subset_lam(t["subsets"], rho3, best_k)))
    print(f"   M2 rho: {({k: round(v, 3) for k, v in rho2.items()})}")
    print(f"   M3 K = {best_k}, rho: {({k: round(v, 3) for k, v in rho3.items()})}")
    base = "M2" if logloss(yf[same_f], models["M2"][0][same_f]) <= logloss(yf[same_f], models["M3"][0][same_f]) else "M3"
    cal = {}
    pf, pt = models[base][0].copy(), models[base][1].copy()
    for n in (2, 3, 4):
        m = (f["stacks"]["n"] == n) & same_f
        X = np.column_stack([np.ones(m.sum()), logit(pf[m])])
        c = np.array([0.0, 1.0])
        for _ in range(30):
            q = 1 / (1 + np.exp(-(X @ c)))
            c += np.linalg.solve(X.T @ (X * (q * (1 - q))[:, None]), X.T @ (yf[m] - q))
        cal[n] = c
        for arr, st in ((pf, f["stacks"]), (pt, t["stacks"])):
            mm = st["n"] == n
            arr[mm] = 1 / (1 + np.exp(-(c[0] + c[1] * logit(arr[mm]))))
    models["M4"] = (pf, pt)
    print(f"   M4 = {base} re-scaled: " + ", ".join(f"{n} legs a={c[0]:+.3f} b={c[1]:.3f}" for n, c in cal.items()))
    print(f"\n   {'model':<5} {'2024-25':>9} {'2025-26':>9}   (log loss on all legs hit, same-team stacks)")
    scores = {}
    for name, (a, z) in models.items():
        scores[name] = logloss(yt[same_t], z[same_t])
        print(f"   {name:<5} {logloss(yf[same_f], a[same_f]):9.5f} {scores[name]:9.5f}")
    print("\n   By kind, 2025-26 log loss (M0 / M1 / M2 / M3 / M4) and what each said vs real:")
    for kind in KINDS:
        m = t["stacks"]["kind"] == kind
        if not m.any():
            continue
        ll = " / ".join(f"{logloss(yt[m], models[k][1][m]):.4f}" for k in models)
        said = " / ".join(f"{100 * models[k][1][m].mean():4.1f}" for k in models)
        print(f"     {kind:<13} {ll}   said {said}%  real {100 * yt[m].mean():4.1f}%")
    win = min(scores, key=lambda k: (round(scores[k] / 0.0002), ["M0", "M1", "M2", "M3", "M4"].index(k)))
    print(f"\n   Winner by the bar: {win}")
    for n in (2, 3, 4):
        m = (t["stacks"]["n"] == n) & same_t
        honest(yt[m], models[win][1][m], f"{win}, {n} legs, 2025-26:")
    m = t["stacks"]["kind"] == "opp_top"
    honest(yt[m], models["M0"][1][m], "opposite teams (M0), 2025-26:")

    # What the correlation adds, in prices
    print("\n   What the correlation adds (2025-26, the winner over the legs multiplied):")
    for kind in KINDS:
        m = t["stacks"]["kind"] == kind
        if m.any():
            ratio = models[win][1][m] / t["stacks"]["prod"][m]
            top = m & (models[win][1] >= np.percentile(models[win][1][m], 90))
            print(f"     {kind:<13} x{np.median(ratio):.2f} (middle 80% x{np.percentile(ratio, 10):.2f}-x{np.percentile(ratio, 90):.2f});"
                  f"  top 10% said {100 * models[win][1][top].mean():4.1f}% hit {100 * yt[top].mean():4.1f}%")
    m = (t["stacks"]["kind"] == "line_trio") & (t["stacks"]["line_no"] == 1)
    i = np.argsort(t["stacks"]["prod"][m])[m.sum() // 2]
    legs = t["stacks"]["p"][m][i][:3]
    print(f"     A middle first-line trio: legs {', '.join(f'{100 * x:.0f}%' for x in legs)} -> multiplied {100 * t['stacks']['prod'][m][i]:.1f}% ({american(t['stacks']['prod'][m][i])})"
          f", joint {100 * models[win][1][m][i]:.1f}% ({american(models[win][1][m][i])})")

    # Q3
    print(f"\nQ3. What predicts a hit beyond {win} (logistic, game-clustered standard errors, same-team stacks)")
    fits = {}
    for season, d, pw in ((FIT, f, models[win][0]), (TEST, t, models[win][1])):
        st = d["stacks"]
        m = same_t if season == TEST else same_f
        X = st["x"][m].astype(float).copy()
        if season == FIT:
            n_legs = st["n"][m]
            xg_avg = {n: X[n_legs == n, 0].mean() for n in (2, 3, 4)}
            team_avg = X[:, 1].mean()
        n_legs = st["n"][m]
        X[:, 0] = np.log(X[:, 0] / np.array([xg_avg[n] for n in n_legs]))
        X[:, 1] = np.log(X[:, 1] / team_avg)
        if season == FIT:
            mu, sd = X.mean(axis=0), X.std(axis=0)
        Xs = (X - mu) / sd
        Xc = np.column_stack([np.ones(len(Xs)), Xs])
        w, se = logistic(Xc, st["hit"][m], logit(pw[m]), st["game"][m])
        fits[season] = (w, se, Xc, st["hit"][m], logit(pw[m]))
    print(f"   {'factor':<8} {'2024-25 weight':>15} {'z':>6} {'2025-26 weight':>15}   (per standard deviation of the factor)")
    passed = []
    for i, name in enumerate(("const",) + FACTORS):
        wf, sf = fits[FIT][0][i], fits[FIT][1][i]
        wt = fits[TEST][0][i]
        ok = name != "const" and abs(wf / sf) >= 2 and np.sign(wf) == np.sign(wt)
        if ok:
            passed.append(i)
        print(f"   {name:<8} {wf:+15.3f} {wf / sf:+6.1f} {wt:+15.3f}{'   passes' if ok else ''}")
    if passed:
        cols = [0] + passed
        _, _, Xc, y, off = fits[FIT]
        w, _ = logistic(Xc[:, cols], y, off, f["stacks"]["game"][same_f])
        _, _, Xt, yt2, offt = fits[TEST]
        p_new = 1 / (1 + np.exp(-(offt + Xt[:, cols] @ w)))
        print(f"   With the passing factors (fitted on 2024-25): 2025-26 log loss {logloss(yt2, p_new):.5f} against {logloss(yt2, 1 / (1 + np.exp(-offt))):.5f}")


if __name__ == "__main__":
    main()
