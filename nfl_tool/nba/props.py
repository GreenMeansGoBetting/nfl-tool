"""NBA player props data (site/nba/props.json): what the Points and Threes pages (and
later Rebounds / Assists) show: the data, plus the projections below.

Per season (`seasons[<year>]`):
- `players[<espn id>]`: name, team (today's roster team for a past season),
  position, and
  - `log`: one row a game, `LOG_FIELDS` order (date, game id, opponent,
    home 1/0, starter 1/0, minutes, points, shots, 3s made, 3s tried, free
    throws tried, then for the player card: shots made, free throws made,
    rebounds, assists, steals, blocks, turnovers, fouls, plus / minus, his
    team's score, the other team's score; None where the box score lacks one);
  - `share`: his share of his team's shots while he's on the floor;
  - `zones` / `kinds`: where his shots come from (rim, short, mid, corner3,
    above3) and how they're made; `zone_pct[zone]`: [his make rate, shots] (self = pull-up / step-back / fade, catch,
    drive, other); `assisted`: share of his makes assisted;
  - `with[<teammate id>]`: [minutes with him on the floor, points then,
    shots then, minutes with him OFF the floor, points then, shots then],
    for the "off the floor" filter.
- `out[<team>][<game id>]`: teammates who didn't play, [id, why]: "rest",
  "injury" or "coach" (from the box score's DNP reason).

A finished season never changes, so 2025-26 is saved once in
props_2026.json (rebuilding it would add over a minute to every deploy);
re-save after changing a formula:
    py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write
"""
from __future__ import annotations

import argparse
import math
import json
from pathlib import Path

import pandas as pd

import possessions as P

LOG_FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta",
              # the player card's game log (2026-10-21): kept after the first eleven so older files still read
              "fgm", "ftm", "reb", "ast", "stl", "blk", "tov", "pf", "pm", "score", "opp_score"]
SELF_MADE = ("pullup", "stepback", "fade")
REST_WORDS = ("REST", "LOAD", "MANAGEMENT")
MIN_TOGETHER = 20  # minutes on the floor together before a teammate gets a with / without row
REFERENCE = Path(__file__).parent / "props_{season}.json"


def why_out(reason) -> str:
    text = str(reason or "").upper()
    if "COACH" in text:
        return "coach"
    if any(w in text for w in REST_WORDS):
        return "rest"
    return "injury"


# The box score columns behind the log's later fields, in LOG_FIELDS order.
BOX_EXTRA = ("field_goals_made", "free_throws_made", "rebounds", "assists", "steals", "blocks", "turnovers", "fouls",
             "plus_minus", "team_score", "opponent_team_score")


def num(v):
    """A box score count as an int, None when the box score doesn't have it."""
    if v is None or isinstance(v, str) and not v.strip():
        return None
    try:
        return None if pd.isna(v) else int(round(float(v)))
    except (TypeError, ValueError):
        return None


def r3(v):
    return None if v is None or pd.isna(v) else round(float(v), 3)


def season_block(pbp: pd.DataFrame, box: pd.DataFrame, label: str) -> dict | None:
    season = P.Season(pbp, box)
    if season.possessions.empty:
        return None
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    games = set(season.possessions["game_id"].unique())
    reg = reg[reg["game_id"].isin(games)]
    abbr = dict(zip(reg["team_id"].astype(int), reg["team_abbreviation"]))
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    played = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)]

    players = {}
    for pid, rows in played.sort_values("date").groupby("athlete_id"):
        last = rows.iloc[-1]
        players[str(int(pid))] = {
            "name": last["athlete_display_name"], "team": last["team_abbreviation"],
            "pos": last.get("athlete_position_abbreviation") or "",
            "log": [[r.date, int(r.game_id), r.opponent_team_abbreviation, int(r.home_away == "home"), int(bool(r.starter)),
                     int(round(r.minutes or 0)), int(r.points or 0), int(r.field_goals_attempted or 0),
                     int(r.three_point_field_goals_made or 0), int(r.three_point_field_goals_attempted or 0),
                     int(r.free_throws_attempted or 0),
                     *(num(getattr(r, c, None)) for c in BOX_EXTRA)] for r in rows.itertuples(index=False)],
        }

    acts = season.actions
    shots = acts[acts["kind"] == "shot"]
    # his share of his team's shots while he's on the floor
    team_shots_on = {}
    for five in shots["with"]:
        for p in five:
            team_shots_on[p] = team_shots_on.get(p, 0) + 1
    own = shots.groupby("player")
    for pid, g in own:
        p = players.get(str(int(pid)))
        if p is None:
            continue
        n = len(g)
        p["share"] = r3(n / team_shots_on[pid]) if team_shots_on.get(pid) else None
        p["zones"] = {z: r3((g["zone"] == z).mean()) for z in ("rim", "short", "mid", "corner3", "above3")}
        # his make rate in each zone and how many shots it's from (the player view's zone chart)
        p["zone_pct"] = {z: [r3(g.loc[g["zone"] == z, "made"].mean()), int((g["zone"] == z).sum())]
                         for z in ("rim", "short", "mid", "corner3", "above3") if (g["zone"] == z).any()}
        kinds = g["kind2"]
        p["kinds"] = {"self": r3(kinds.isin(SELF_MADE).mean()), "catch": r3((kinds == "catch").mean()),
                      "drive": r3(kinds.isin(("drive", "cut", "floater", "lob", "putback")).mean()),
                      "other": r3(kinds.isin(("post", "other")).mean())}
        makes = g[g["made"]]
        p["assisted"] = r3(makes["assist"].notna().mean()) if len(makes) else None

    # with / without each teammate on the floor: minutes from the stints,
    # points and shots from his own actions (who was on the floor at the time)
    mins, mins_with = {}, {}
    for st in season.stints.itertuples(index=False):
        secs = st.t1 - st.t0
        for p in st.five:
            mins[p] = mins.get(p, 0.0) + secs
            row = mins_with.setdefault(p, {})
            for q in st.five:
                if q != p:
                    row[q] = row.get(q, 0.0) + secs
    pts, pts_with, fga, fga_with = {}, {}, {}, {}
    scoring = acts[acts["kind"].isin(("shot", "ft")) & acts["player"].notna()]
    for player, kind, got, five in zip(scoring["player"], scoring["kind"], scoring["pts"], scoring["with"]):
        p = int(player)
        pts[p] = pts.get(p, 0) + got
        is_shot = int(kind == "shot")
        fga[p] = fga.get(p, 0) + is_shot
        pw, fw = pts_with.setdefault(p, {}), fga_with.setdefault(p, {})
        for q in five:
            if q != p:
                pw[q] = pw.get(q, 0) + got
                fw[q] = fw.get(q, 0) + is_shot
    for pid, row in mins_with.items():
        p = players.get(str(int(pid)))
        if p is None:
            continue
        total_m, total_p, total_f = mins.get(pid, 0) / 60, pts.get(pid, 0), fga.get(pid, 0)
        out = {}
        for q, secs in row.items():
            if secs < 60 * MIN_TOGETHER:
                continue
            m_on = secs / 60
            p_on = pts_with.get(pid, {}).get(q, 0)
            f_on = fga_with.get(pid, {}).get(q, 0)
            out[str(int(q))] = [round(m_on, 1), p_on, f_on, round(total_m - m_on, 1), total_p - p_on, total_f - f_on]
        p["with"] = out

    out_by_team = {}
    dnp = reg[reg["did_not_play"].astype(bool)]
    for r in dnp.itertuples(index=False):
        out_by_team.setdefault(abbr.get(int(r.team_id), str(r.team_id)), {}).setdefault(str(int(r.game_id)), []).append(
            [str(int(r.athlete_id)), why_out(r.reason)])
    return {"label": label, "fields": LOG_FIELDS, "players": players, "out": out_by_team}


# ---- the points projection: the line, moved toward our number ----
# The owner, 2026-10-20: "I would like projections to start day one - even if
# its weighing heavily towards the line. I want the framework in." So the
# projection starts AT the line (no games = the line) and moves toward ours as
# this season's games come in: weight = PROJ_MAX x games / (games + PROJ_K).
# Ours: expected minutes (last 5) x points a minute (season), then each factor
# the 2025-26 replay kept (tools/backtest/nba_points.py), at its weight: the
# game's pace, what the other defense allows a possession, its transition
# share allowed (each against the league, this season), and teammates listed
# Out (their shot share); the base's own 3% lean is taken off. Zone fit, free
# throws and turnovers forced added nothing in the replay: tags only.
# PROJ_MAX stays at half until a replay on this season's saved tip-off lines
# says ours deserves more (or less).
# 2026-10-23 (the owner: "start projecting today using what we know to be true
# + what we think might be an edge ... then track to see real time if we are
# onto something"): the replay's two new finds are in, refitted with the rest
# on all of 2025-26: last-5 minutes overshoot (x (last 5 / season)^W_MIN: a
# dip bounces back, a rise mostly sticks), and teammates' missing shots go to
# role players (bump = W_OUT - W_OUT_SHARE x his shot share / 0.2, never
# below 0: a 10% shooter gets +0.77 x the missing share, an 18%+ shooter
# none; the replay had too few stars in that spot to cut theirs). The other
# team's missing shot share (W_OPP_OUT, t +2.1) is in as a "might be true".
# Graded live against the tip-off lines (props.json `record`, the Points
# page's YTD Model Performance).
PROJ_K = 10
PROJ_MAX = 0.5
PROJ_LAST = 5
W_PACE = 0.9
W_DEF = 0.56
W_TRANS = 0.2
W_OUT = 1.68
W_OUT_SHARE = 1.83
W_OPP_OUT = 0.1
W_MIN = -0.365
LEAN = -0.015


def our_points(log: list, fields: list, team: dict | None, opp: dict | None, league: dict | None, out_share: float = 0.0,
               share: float = 0.0, opp_out: float = 0.0):
    """(our points number, expected minutes, points a minute), or Nones
    before he has played this season. out_share: the season shot share of
    rotation teammates listed Out tonight; share: his own season shot share
    of his team (FGA / team FGA in his games); opp_out: the other team's
    out_share."""
    if not log:
        return None, None, None
    i_min, i_pts = fields.index("min"), fields.index("pts")
    total_min = sum(r[i_min] for r in log)
    if total_min <= 0:
        return None, None, None
    ppm = sum(r[i_pts] for r in log) / total_min
    recent = log[-PROJ_LAST:]
    minutes = sum(r[i_min] for r in recent) / len(recent)
    pace_f = def_f = trans_f = 1.0
    if team and opp and league:
        lg_pace = (league.get("off_pace") or {}).get("avg")
        lg_ppp = (league.get("def_ppp") or {}).get("avg")
        lg_trans = (league.get("def_trans_freq") or {}).get("avg")
        if lg_pace and team.get("off_pace") and opp.get("off_pace"):
            pace_f = (team["off_pace"] + opp["off_pace"]) / 2 / lg_pace
        if lg_ppp and opp.get("def_ppp"):
            def_f = opp["def_ppp"] / lg_ppp
        if lg_trans and opp.get("def_trans_freq"):
            trans_f = opp["def_trans_freq"] / lg_trans
    season_min = total_min / len(log)
    min_f = (minutes / season_min) ** W_MIN if minutes > 0 else 1.0
    out_w = max(0.0, W_OUT - W_OUT_SHARE * share / 0.2)
    ours = (minutes * ppm * (1 + LEAN) * pace_f ** W_PACE * def_f ** W_DEF * trans_f ** W_TRANS
            * min_f * (1 + out_w * out_share) * (1 + W_OPP_OUT * opp_out))
    return ours, minutes, ppm


def project_points(line, games: int, ours):
    """(projection, weight on ours): the line, moved toward ours by weight."""
    if line is None:
        return None, 0.0
    if ours is None or games <= 0:
        return float(line), 0.0
    w = PROJ_MAX * games / (games + PROJ_K)
    return line + w * (ours - line), w


# A night's points spread around the projection (fitted on 2025-26's replay,
# tools/backtest/nba_points.py's player-games: sd 5.6 at 8 points, 8.7 at 32):
# sd = POINTS_SD_A + POINTS_SD_B x sqrt(projection), a normal count. It turns
# the projection into a chance of the Over, so Points shows its play the NHL
# pages' way (Play, GMG Fair, Odds, Good To, Edge; the owner, 2026-10-23).
POINTS_SD_A = 2.73
POINTS_SD_B = 1.07


def points_chance(proj, line) -> float | None:
    """Chance of going over the line (a whole-number line's push left out)."""
    if proj is None or line is None:
        return None
    sd = POINTS_SD_A + POINTS_SD_B * math.sqrt(max(proj, 0.0))
    cdf = lambda x: 0.5 * (1 + math.erf((x - proj) / (sd * math.sqrt(2))))  # noqa: E731
    if float(line).is_integer():
        under, push = cdf(line - 0.5), cdf(line + 0.5) - cdf(line - 0.5)
        return (1 - under - push) / max(1 - push, 1e-9)
    return 1 - cdf(line)


# ---- the live record: every projection graded against its tip-off line ----
# The owner, 2026-10-23: "start projecting today ... then track to see real
# time if we are onto something. We can adjust after a month." A play = the
# side the projection leans from the line (no lean = no play); a push or a
# player who didn't play doesn't count. The split tags test each idea on its
# own: STAR_LINE (the public's overs push stars' lines up, the owner's idea C),
# a minutes dip (last 5 at DIP_RATIO of his season or less), a role player
# with teammates Out (ROLE_MISSING of the team's shots out, his own share
# under ROLE_SHARE), the other team missing OPP_MISSING of its shots.
# The record starts the night this projection went on the page (earlier rows
# were the pre-2026-10-23 formula, kept in the lines file but not graded here).
RECORD_START = "2026-10-23"
STAR_LINE = 24.5
DIP_RATIO = 0.85
ROLE_MISSING = 0.1
ROLE_SHARE = 0.15
OPP_MISSING = 0.15


def record_ledger(lines: dict, block: dict | None) -> list:
    """The shared YTD tracker's rows (site ytd.js): [date, edge (our chance of
    the play minus what its best price needs), won 1/0, units at that price,
    tags], oldest first: the NHL pages' play rule (`threes_play`) since
    2026-10-23, the same as Threes. A row saved without our chance and the
    prices (before that change) isn't graded. `lines` =
    model_history/nba_props/lines_<season>.json; `block` = this season's props
    block (the results)."""
    if not block:
        return []
    f = {k: i for i, k in enumerate(block.get("fields") or LOG_FIELDS)}
    played = {}
    for pid, p in (block.get("players") or {}).items():
        for r in p.get("log") or []:
            played[(str(r[f["game"]]), pid)] = (r[f["date"]], r[f["pts"]])
    out = []
    for gid, rows in lines.items():
        for pid, row in rows.items():
            line = row[0]
            p_over, best_o, best_u = (list(row[8:11]) + [None] * 3)[:3]
            got = played.get((str(gid), pid))
            play = threes_play(p_over, best_o, best_u)
            if got is None or got[0] < RECORD_START or line is None or play is None or got[1] == line:
                continue
            side, edge, price = play
            over = side == "over"
            tags = ["over" if over else "under"]
            extra = (list(row[4:8]) + [None] * 4)[:4]
            min_ratio, missing, share, opp_missing = extra
            if line >= STAR_LINE:
                tags.append("star")
            if min_ratio is not None and min_ratio <= DIP_RATIO:
                tags.append("dip")
            if missing is not None and share is not None and missing >= ROLE_MISSING and share < ROLE_SHARE:
                tags.append("role")
            if opp_missing is not None and opp_missing >= OPP_MISSING:
                tags.append("opp_out")
            won = (got[1] > line) == over
            out.append([got[0], round(edge, 4), int(won), units(price, won), tags])
    return sorted(out, key=lambda r: (r[0], -r[1]))


# ---- the threes projection (built 2026-10-23 from tools/backtest/nba_threes.py) ----
# Threes made = threes TRIED x make rate, kept apart because tries are steady
# and make rate is mostly a night's luck (the replay: the tries number improves
# 2% with the factors below, makes 0.4%; the owner: "we can predict how many
# threes a player will try, but not how many he'll make"). Tries = last-5
# minutes x season threes tried a minute, then the factors that held on
# 2025-26 (refitted together on the whole season): the game's pace, the other
# defense's threes allowed a possession and its catch-and-shoot share of them
# (help defense leaving shooters), his team's spread (underdogs shoot more), a
# minutes dip bouncing back, a cold / hot last 5 (makes above or below his own
# rate: a cold run trims his tries a little), and teammates listed Out (their
# shots go to role players). Make rate = his season's, pulled THREES_K tries
# toward the league's (the replay's best). A night's count spreads
# THREES_SPREAD x wider than Poisson (the replay: 1.2-1.4), so every chance
# is a negative binomial: 1+ / 2+ hit less often and 3+ / 4+ more often than
# a plain Poisson count.
# Anchored to the market from day one like Points: the books' no-vig chance of
# the Over at the middle line is turned into the number of makes it implies,
# the projection moves PROJ_MAX x games / (games + PROJ_K) of the way to ours,
# and the edge is our chance of the Over minus the books'.
THREES_K = 200
THREES_SPREAD = 1.25
T_PACE = 1.43
T_DEF3 = 0.52
T_CATCH3 = 0.59
T_DOG = 0.037      # a 10 points of spread
T_LUCK = 0.05      # a make a game above / below his own rate, last 5
T_MIN = -0.446
T_OUT = 1.51
T_OUT_SHARE = 1.725
T_LEAN = -0.006
LADDER = (1, 2, 3, 4, 5)


def nb_pmf(mean: float, k: int, spread: float = THREES_SPREAD) -> float:
    """Chance of exactly k makes when a night averages `mean` and spreads
    `spread` x wider than Poisson (negative binomial)."""
    if mean <= 0:
        return 1.0 if k == 0 else 0.0
    r = mean / (spread - 1)
    p = 1 / spread
    return math.exp(math.lgamma(k + r) - math.lgamma(r) - math.lgamma(k + 1) + r * math.log(p) + k * math.log(1 - p))


def chance_over(mean: float, line: float) -> float:
    """Chance of going over the line (a whole-number line's push left out)."""
    below = sum(nb_pmf(mean, k) for k in range(int(math.floor(line)) + 1))
    if float(line).is_integer():
        push = nb_pmf(mean, int(line))
        return (1 - below) / max(1 - push, 1e-9)
    return 1 - below


def mean_for(chance: float, line: float) -> float:
    """The average makes that gives this chance of the Over."""
    lo, hi = 0.01, 15.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if chance_over(mid, line) < chance:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def implied(price) -> float | None:
    if price is None:
        return None
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def market_chance(quotes: list, line) -> float | None:
    """The books' no-vig chance of the Over at this line: every book's Over
    and Under prices there averaged, the vig split off. One side only: its
    price less a 4.5% vig."""
    o = [implied(q[3]) for q in quotes if q[1] == "o" and q[2] == line]
    u = [implied(q[3]) for q in quotes if q[1] == "u" and q[2] == line]
    if o and u:
        po, pu = sum(o) / len(o), sum(u) / len(u)
        return po / (po + pu)
    if o:
        return min(0.99, sum(o) / len(o) / 1.045)
    if u:
        return max(0.01, 1 - sum(u) / len(u) / 1.045)
    return None


def our_threes(log: list, fields: list, team: dict | None, opp: dict | None, league: dict | None, league_pct: float,
               out_share: float = 0.0, share: float = 0.0, spread: float | None = None) -> dict | None:
    """{tries, pct, makes, luck} (our numbers, before the market anchor), or
    None before he has played this season. spread: his team's (+ = underdog)."""
    if not log:
        return None
    f = {k: i for i, k in enumerate(fields)}
    total_min = sum(r[f["min"]] for r in log)
    if total_min <= 0:
        return None
    tried = sum(r[f["fg3a"]] for r in log)
    made = sum(r[f["fg3m"]] for r in log)
    rate = tried / total_min
    pct = (made + THREES_K * league_pct) / (tried + THREES_K)
    recent = log[-PROJ_LAST:]
    minutes = sum(r[f["min"]] for r in recent) / len(recent)
    luck = sum(r[f["fg3m"]] - r[f["fg3a"]] * pct for r in recent) / len(recent)
    factor = 1 + T_LEAN
    if team and opp and league:
        lg = lambda k: (league.get(k) or {}).get("avg")  # noqa: E731
        if lg("off_pace") and team.get("off_pace") and opp.get("off_pace"):
            factor *= ((team["off_pace"] + opp["off_pace"]) / 2 / lg("off_pace")) ** T_PACE
        if lg("def_three_pp") and opp.get("def_three_pp"):
            factor *= (opp["def_three_pp"] / lg("def_three_pp")) ** T_DEF3
        if lg("def_catch3") and opp.get("def_catch3"):
            factor *= (opp["def_catch3"] / lg("def_catch3")) ** T_CATCH3
    season_min = total_min / len(log)
    if minutes > 0:
        factor *= (minutes / season_min) ** T_MIN
    if spread is not None:
        factor *= 1 + T_DOG * spread / 10
    factor *= 1 + T_LUCK * luck
    factor *= 1 + max(0.0, T_OUT - T_OUT_SHARE * share / 0.2) * out_share
    tries = minutes * rate * factor
    return {"tries": tries, "pct": pct, "makes": tries * pct, "luck": luck, "min": minutes, "min_ratio": minutes / season_min}


def project_threes(line, quotes: list, games: int, ours: float | None) -> dict:
    """{proj (makes), w, p_over (ours), p_mkt (the books'), edge, ladder}: the
    market's number moved toward ours by the weight. No price = the line read
    as a coin flip."""
    if line is None:
        return {"proj": None, "w": 0.0, "p_over": None, "p_mkt": None, "edge": None, "ladder": None}
    p_mkt = market_chance(quotes, line)
    market = mean_for(p_mkt if p_mkt is not None else 0.5, line)
    w = PROJ_MAX * games / (games + PROJ_K) if ours is not None and games > 0 else 0.0
    proj = market + w * ((ours if ours is not None else market) - market)
    p_over = chance_over(proj, line)
    return {"proj": proj, "w": w, "p_over": p_over, "p_mkt": p_mkt, "edge": None if p_mkt is None else p_over - p_mkt,
            "ladder": [round(chance_over(proj, k - 0.5), 3) for k in LADDER]}


def best_price(quotes: list, side: str, line):
    prices = [q[3] for q in quotes if q[1] == side and q[2] == line]
    return max(prices, key=lambda a: (1 / implied(a))) if prices else None


def units(price, won: bool) -> float | None:
    if price is None:
        return None
    if not won:
        return -1.0
    return price / 100 if price > 0 else 100 / -price


def threes_play(p_over, best_o, best_u):
    """(side "over" / "under", edge, price) of the side our chance beats its
    best price by more (the NHL pages' rule: our chance minus the chance the
    price needs to break even), or None with no price or no positive edge."""
    if p_over is None:
        return None
    sides = [(side, chance - implied(price), price) for side, chance, price in (("over", p_over, best_o), ("under", 1 - p_over, best_u))
             if price is not None]
    best = max(sides, key=lambda x: x[1], default=None)
    return best if best and best[1] > 0 else None


# The threes record (changed 2026-10-23 to the NHL pages' play rule, the
# owner: "mimic the other tools in form and function"): the side our chance
# beats its best price by more, graded only on a positive edge, at that best
# price at tip-off, 1 unit. The split tags test each
# idea on its own: a minutes dip, a role player with teammates Out, an
# underdog of THREES_DOG+, a cold / hot last 5 (THREES_STREAK makes a game off
# his own rate), and the 0.5 line (one make = Over).
THREES_RECORD_START = "2026-10-23"
THREES_DOG = 6
THREES_STREAK = 0.6


def threes_ledger(lines: dict, block: dict | None) -> list:
    """The shared YTD tracker's rows: [date, edge (our chance of the side
    minus what its best price needs), won 1/0, units, tags], oldest first. `lines` =
    model_history/nba_props/threes_<season>.json."""
    if not block:
        return []
    f = {k: i for i, k in enumerate(block.get("fields") or LOG_FIELDS)}
    played = {}
    for pid, p in (block.get("players") or {}).items():
        for r in p.get("log") or []:
            played[(str(r[f["game"]]), pid)] = (r[f["date"]], r[f["fg3m"]])
    out = []
    for gid, rows in lines.items():
        for pid, row in rows.items():
            line, p_over, best_o, best_u = row[0], row[4], row[6], row[7]
            got = played.get((str(gid), pid))
            play = threes_play(p_over, best_o, best_u)
            if got is None or got[0] < THREES_RECORD_START or line is None or play is None or got[1] == line:
                continue
            side, edge, price = play
            over = side == "over"
            won = (got[1] > line) == over
            min_ratio, missing, share, luck, spread = (list(row[8:13]) + [None] * 5)[:5]
            tags = ["over" if over else "under"]
            if min_ratio is not None and min_ratio <= DIP_RATIO:
                tags.append("dip")
            if missing is not None and share is not None and missing >= ROLE_MISSING and share < ROLE_SHARE:
                tags.append("role")
            if spread is not None and spread >= THREES_DOG:
                tags.append("dog")
            if luck is not None and luck <= -THREES_STREAK:
                tags.append("cold")
            if luck is not None and luck >= THREES_STREAK:
                tags.append("hot")
            if line == 0.5:
                tags.append("half")
            out.append([got[0], round(edge, 4), int(won), units(price, won), tags])
    return sorted(out, key=lambda r: (r[0], -r[1]))


def on_rosters(block: dict, roster_team: dict) -> dict:
    """A past season's players on the team today's roster lists them with;
    anyone on no roster is left out (the same rule as King of the Court)."""
    players = {pid: {**p, "team": roster_team[pid]} for pid, p in block["players"].items() if pid in roster_team}
    return {**block, "players": players}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--label", default="2025-26")
    ap.add_argument("--player", default="Payton Pritchard")
    ap.add_argument("--write", action="store_true", help="save the finished season as nfl_tool/nba/props_<season>.json")
    args = ap.parse_args()
    d = Path(args.data_dir)
    block = season_block(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"),
                         pd.read_parquet(d / f"player_box_{args.season}.parquet"), args.label)
    if args.write:
        out = Path(str(REFERENCE).format(season=args.season))
        out.write_text(json.dumps(block, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    for pid, p in block["players"].items():
        if p["name"] == args.player:
            print(pid, p["name"], p["team"], len(p["log"]), "games; share", p.get("share"), p.get("kinds"), p.get("assisted"))
            names = {k: v["name"] for k, v in block["players"].items()}
            for q, w in sorted(p.get("with", {}).items(), key=lambda kv: -kv[1][0])[:5]:
                print(f"  with {names.get(q, q):24} on {w[0]:6.0f} min {w[1] / max(w[0], 1) * 36:5.1f} pts/36 | off {w[3]:6.0f} min {w[4] / max(w[3], 1) * 36:5.1f} pts/36")


if __name__ == "__main__":
    main()
