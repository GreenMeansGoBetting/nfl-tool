"""First Basket (NBA): the pieces behind who scores a game's first points.

Asked 2026-10-20 (opening night). The owner wanted "the pieces of the puzzle
with data for users to solve", not a pick board: who wins the tip, who scores
first after winning or losing it (home / away), how many trips each offense
needs for its first points and how many each defense allows, the first field
goal each defense allows by position, and which starters shoot before anyone
scores. A rough fair price sits at the bottom of each game and is labeled a
guess.

Most books now settle First Basket on ANY first points, free throws included
(the owner), so "scored first" counts free throws; "first field goal allowed"
is field goals only, as asked.

Everything comes from hoopR's play-by-play (espn_nba_pbp). The opening
`Jumpball` names both jumpers and its team_id is the team that got the ball.
2025-26: the tip winner scored first 66.5% of 1,230 games; a free throw was
the first score in 9%.

Possessions are counted from the plays: a team starts a new possession on its
first shot, turnover or rebound after the other team's. Fouls with no shot
don't start one, so the count is a hair low on whistle-heavy openings.
"""
from collections import defaultdict

import pandas as pd

# PG / SG / SF / PF / C (positions.py: the build reads every box score with
# ESPN's depth-chart positions); a bare G / F left over counts as SG / SF.
POSITIONS = ("PG", "SG", "SF", "PF", "C")
POS_GROUP = {**{p: p for p in POSITIONS}, "G": "SG", "F": "SF"}
STARTERS = 5
MIN_JUMPS = 2  # fewer jumps than this and a player isn't a team's jumper (low: a new season has few)
# The fair-price guess: each jumper's tip rate is steadied with TIP_PRIOR
# coin-flip jumps; each starter's first-score rate with SHARE_PRIOR starts at
# the starters' average; BENCH_SHARE of first scores go to non-starters.
TIP_PRIOR = 6
SHARE_PRIOR = 10
BENCH_SHARE = 0.04


def num(value, digits=3):
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def _mean(values, digits=3):
    values = [v for v in values if v is not None]
    return num(sum(values) / len(values), digits) if values else None


def game_openings(pbp: pd.DataFrame, teams) -> list:
    """One record per regular-season game: the tip, who scored first, each
    team's possessions and seconds to its first points, the first field goal
    each team made, every shot taken before the game's first points, and the
    first quarter's margin."""
    plays = pbp[(pbp["season_type"] == 2) & (pbp["period_number"] == 1)].sort_values(["game_id", "sequence_number"])
    out = []
    for game_id, g in plays.groupby("game_id", sort=False):
        r = g.iloc[0]
        home, away = r.home_team_abbrev, r.away_team_abbrev
        if home not in teams or away not in teams:
            continue  # All-Star and exhibition sides
        side = {r.home_team_id: home, r.away_team_id: away}
        tip_rows = g[g["type_text"] == "Jumpball"]
        tip = jumpers = None
        if not tip_rows.empty and tip_rows.iloc[0].team_id in side:
            j = tip_rows.iloc[0]
            tip = side[j.team_id]
            jumpers = [int(a) for a in (j.athlete_id_1, j.athlete_id_2) if not pd.isna(a)]
        owner, poss = None, {home: 0, away: 0}
        first_pts, first_fg = {}, {}
        first_team = first_scorer = None
        first_ft = False
        early_shots = []  # shooters before the game's first points, in order
        for p in g.itertuples(index=False):
            team = side.get(p.team_id)
            if team is None:
                continue
            kind = str(p.type_text)
            free_throw = "Free Throw" in kind
            if p.shooting_play == True or "Turnover" in kind or kind.endswith("Rebound"):  # noqa: E712
                if team != owner:
                    owner = team
                    poss[team] += 1
            if p.shooting_play == True and first_team is None and not free_throw and not pd.isna(p.athlete_id_1):  # noqa: E712
                early_shots.append(int(p.athlete_id_1))
            if p.scoring_play == True:  # noqa: E712
                secs = 720 - p.start_quarter_seconds_remaining if not pd.isna(p.start_quarter_seconds_remaining) else None
                if first_team is None:
                    first_team = team
                    first_scorer = None if pd.isna(p.athlete_id_1) else int(p.athlete_id_1)
                    first_ft = free_throw
                first_pts.setdefault(team, (poss[team], secs))
                if not free_throw and not pd.isna(p.athlete_id_1):
                    first_fg.setdefault(team, int(p.athlete_id_1))
            if len(first_pts) == 2 and len(first_fg) == 2:
                break
        if first_team is None:
            continue
        last = g.iloc[-1]
        out.append({
            "game_id": str(game_id), "home": home, "away": away, "tip": tip, "jumpers": jumpers,
            "first_team": first_team, "first_scorer": first_scorer, "first_ft": first_ft, "first_pts": first_pts, "first_fg": first_fg,
            "early_shots": early_shots, "q1_margin": int(last.home_score) - int(last.away_score),
        })
    return out


def team_numbers(openings: list, positions: dict) -> tuple:
    """({team: numbers}, league numbers). positions = {athlete id: PG/SG/SF/PF/C}."""
    rows = defaultdict(lambda: defaultdict(list))
    for o in openings:
        for team, opp, where in ((o["home"], o["away"], "home"), (o["away"], o["home"], "away")):
            d = rows[team]
            first = o["first_team"] == team
            d["first"].append(first)
            d[f"first_{where}"].append(first)
            d["q1_margin"].append(o["q1_margin"] if where == "home" else -o["q1_margin"])
            if o["tip"]:
                won = o["tip"] == team
                d["tip"].append(won)
                d[f"tip_{where}"].append(won)
                d["first_won_tip" if won else "first_lost_tip"].append(first)
            if team in o["first_pts"]:
                d["poss"].append(o["first_pts"][team][0])
                d["secs"].append(o["first_pts"][team][1])
            if opp in o["first_pts"]:
                d["opp_poss"].append(o["first_pts"][opp][0])
                d["opp_secs"].append(o["first_pts"][opp][1])
            if opp in o["first_fg"]:
                d["fg_pos"].append(positions.get(o["first_fg"][opp], "SF"))
            if team in o["first_fg"]:
                d["fg_own"].append(positions.get(o["first_fg"][team], "SF"))
    teams = {}
    for team, d in rows.items():
        t = {"games": len(d["first"])}
        for key in ("first", "first_home", "first_away", "tip", "tip_home", "tip_away", "first_won_tip", "first_lost_tip"):
            t[key] = _mean(d[key])
            t[f"{key}_n"] = len(d[key])
        for key, digits in (("poss", 2), ("secs", 0), ("opp_poss", 2), ("opp_secs", 0), ("q1_margin", 1)):
            t[key] = _mean(d[key], digits)
        n = len(d["fg_pos"])
        t["fg_allowed"] = {p: num(d["fg_pos"].count(p) / n) if n else None for p in POSITIONS}
        n = len(d["fg_own"])
        t["fg_made"] = {p: num(d["fg_own"].count(p) / n) if n else None for p in POSITIONS}
        teams[team] = t
    games = [o for o in openings if o["tip"]]
    fg_all = [positions.get(pid, "SF") for o in openings for pid in o["first_fg"].values()]
    league = {
        "games": len(openings),
        "first_won_tip": num(sum(o["tip"] == o["first_team"] for o in games) / len(games)) if games else None,
        "poss": _mean([t["poss"] for t in teams.values()], 2),
        "secs": _mean([t["secs"] for t in teams.values()], 0),
        "fg_allowed": {p: num(fg_all.count(p) / len(fg_all)) if fg_all else None for p in POSITIONS},
        "free_throw_first": num(sum(o["first_ft"] for o in openings) / len(openings)) if openings else None,
    }
    return teams, league


def player_numbers(openings: list, player_box: pd.DataFrame) -> dict:
    """{athlete id: games and minutes a game (every game he played), starts, shot_early (starts with a shot before the game's
    first points), first_shot (took the game's first shot), first_pts (scored
    the game's first points), jumps, tips_won} over his starts."""
    box = player_box[(player_box["season_type"] == 2) & (player_box["starter"] == True)]  # noqa: E712
    starts = defaultdict(set)
    for r in box[["game_id", "athlete_id"]].itertuples(index=False):
        starts[int(r.athlete_id)].add(str(r.game_id))
    team_of = {(str(r.game_id), int(r.athlete_id)): r.team_abbreviation for r in player_box[["game_id", "athlete_id", "team_abbreviation"]].itertuples(index=False)}
    out = defaultdict(lambda: {"games": 0, "min": 0.0, "starts": 0, "shot_early": 0, "first_shot": 0, "first_pts": 0, "jumps": 0, "tips_won": 0})
    for pid, games in starts.items():
        out[pid]["starts"] = len(games)
    played = player_box[(player_box["season_type"] == 2) & (pd.to_numeric(player_box["minutes"], errors="coerce") > 0)]
    for pid, g in played.groupby("athlete_id"):
        out[int(pid)]["games"] = len(g)
        out[int(pid)]["min"] = round(float(pd.to_numeric(g["minutes"], errors="coerce").mean()), 1)
    for o in openings:
        gid = o["game_id"]
        for pid in set(o["early_shots"]):
            if gid in starts.get(pid, ()):
                out[pid]["shot_early"] += 1
        if o["early_shots"]:
            out[o["early_shots"][0]]["first_shot"] += 1
        if o["first_scorer"] is not None:
            out[o["first_scorer"]]["first_pts"] += 1
        for pid in o["jumpers"] or ():
            out[pid]["jumps"] += 1
            if team_of.get((gid, pid)) == o["tip"]:
                out[pid]["tips_won"] += 1
    return dict(out)


def season_block(pbp: pd.DataFrame, player_box: pd.DataFrame, teams, label: str) -> dict:
    """One season's numbers. Players carry their name, position and headshot
    from his last game in the box scores; the build moves them to today's team."""
    box = player_box[(player_box["season_type"] == 2) & player_box["athlete_id"].notna()].sort_values("game_date")
    last = box.drop_duplicates("athlete_id", keep="last")
    positions = {int(r.athlete_id): POS_GROUP.get(r.athlete_position_abbreviation, "SF") for r in last.itertuples(index=False)}
    openings = game_openings(pbp, teams)
    team_rows, league = team_numbers(openings, positions)
    players = {}
    for pid, p in player_numbers(openings, box).items():
        row = last[last["athlete_id"] == pid]
        if row.empty:
            continue
        r = row.iloc[0]
        head = r.athlete_headshot_href
        players[str(pid)] = {
            "name": r.athlete_display_name,
            "pos": positions.get(pid, "SF"),
            "team": r.team_abbreviation,
            "headshot": None if head is None or (isinstance(head, float) and pd.isna(head)) else head,
            **p,
        }
    return {"label": label, "games": len(openings), "league": league, "teams": team_rows, "players": players}


def american(p):
    if not p or p <= 0 or p >= 1:
        return None
    return round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def _tip_rate(player: dict | None) -> float:
    if not player:
        return 0.5
    return (player["tips_won"] + TIP_PRIOR * 0.5) / (player["jumps"] + TIP_PRIOR)


def game_side(block: dict, team: str, team_of: dict, out_ids: set) -> dict:
    """A team's likely starters and its jumper (most jumps among them, else
    among the whole team). Starters: on the team today, not listed Out,
    starting in at least half the games he played, most minutes first; a
    star who missed a month still starts (ranking by start counts dropped
    Wembanyama from the 2025-26 Spurs)."""
    mine = [(pid, p) for pid, p in block["players"].items() if team_of.get(pid, p["team"]) == team and pid not in out_ids]
    regular = lambda p: p["games"] and p["starts"] / p["games"] >= 0.5
    starters = sorted((x for x in mine if x[1]["starts"]), key=lambda x: (not regular(x[1]), -x[1]["min"], x[1]["name"]))[:STARTERS]
    pool = [x for x in starters if x[1]["jumps"] >= MIN_JUMPS] or [x for x in mine if x[1]["jumps"] >= MIN_JUMPS]
    jumper = max(pool, key=lambda x: x[1]["jumps"])[0] if pool else None
    return {"starters": [pid for pid, _ in starters], "jumper": jumper}


def fair_prices(block: dict, away: dict, home: dict) -> dict:
    """The rough guess at the bottom of a game: the tip from the two jumpers
    (each steadied toward 50%), the first score from the tip and the league's
    tip-winner rate, each starter's share from his first scores per start
    (steadied toward the starters' average)."""
    players = block["players"]
    a, h = _tip_rate(players.get(away["jumper"])), _tip_rate(players.get(home["jumper"]))
    tip_home = h * (1 - a) / (h * (1 - a) + a * (1 - h))
    lead = block["league"]["first_won_tip"] or 0.66
    first_home = tip_home * lead + (1 - tip_home) * (1 - lead)
    out = {"tip_home": num(tip_home), "first_home": num(first_home), "players": {}}
    for side, p_team in ((away, 1 - first_home), (home, first_home)):
        rows = [players[pid] for pid in side["starters"]]
        if not rows:
            continue
        avg = sum(r["first_pts"] for r in rows) / max(1, sum(r["starts"] for r in rows))
        weights = [(r["first_pts"] + SHARE_PRIOR * avg) / (r["starts"] + SHARE_PRIOR) for r in rows]
        total = sum(weights) or 1
        for pid, w in zip(side["starters"], weights):
            p = p_team * (1 - BENCH_SHARE) * w / total
            out["players"][pid] = {"p": num(p), "fair": american(p)}
    return out


def fair_weights() -> dict:
    """The fair guess's settings, for the page: it redoes the guess in the
    browser when the NBA's real lineup differs from the likely starters."""
    return {"tip_prior": TIP_PRIOR, "share_prior": SHARE_PRIOR, "bench_share": BENCH_SHARE, "min_jumps": MIN_JUMPS}


def slate(block: dict, games: list, team_of: dict, out_ids: set, dates: list) -> dict:
    """{game id: {away, home, fair}} for the games on `dates`."""
    out = {}
    for g in games:
        if g["date"] not in dates:
            continue
        away = game_side(block, g["away"], team_of, out_ids)
        home = game_side(block, g["home"], team_of, out_ids)
        out[g["game_id"]] = {"away": away, "home": home, "fair": fair_prices(block, away, home)}
    return out
