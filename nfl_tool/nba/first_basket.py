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
import math
from collections import defaultdict

import pandas as pd

# PG / SG / SF / PF / C (positions.py: the build reads every box score with
# ESPN's depth-chart positions); a bare G / F left over counts as SG / SF.
POSITIONS = ("PG", "SG", "SF", "PF", "C")
POS_GROUP = {**{p: p for p in POSITIONS}, "G": "SG", "F": "SF"}
STARTERS = 5
MIN_JUMPS = 2  # fewer jumps than this and a player isn't a team's jumper (low: a new season has few)
# Tip win chance (the owner, 2026-10-21: a jumper who only met Wembanyama and
# one who only met guards can't be read off Tips Won): each jumper gets a
# rating from every jump ball of the season (opening tips, held balls,
# overtimes), counting who he jumped against, starting from his height.
# A replay of 2025-26 (each tip predicted from the jumps before it) picked
# the winner 64% of the time (log loss 0.628) against 61% (0.644) for the old
# steadied Tips Won and 60% for height alone. TIP_PER_INCH: rating per inch
# of height (5+ inches taller won 84% of 2025-26's tips, 1 inch 50%);
# TIP_PULL: how hard the jumps have to argue to move a rating off its height.
TIP_PER_INCH = 0.15
TIP_PULL = 3.0
TIP_MID_HEIGHT = 81  # 6'9": a rating of 0; only the difference between two jumpers matters
# The Fair price (rebuilt 2026-10-21 on a 2025-26 replay, each team-game
# predicted from the games before it). A team scores first: its jumper's tip
# chance x TIP_WINNER_SCORES (2025-26: the tip winner scored first 66.6%);
# trips to score / allow and after-tip rates added nothing once the tip was
# known. A starter's share of his team's first points: half his shot volume
# a start (field goal tries + 0.44 x free throw tries) to the USAGE_POWER,
# half his Team Share (his team's first points a start) steadied with
# TEAM_SHARE_PRIOR starts at his teammates' rate. Who scores a team's first
# points is close to random among its five: this blend picked him 25% of the
# time (20% blind) with the best fit; the old Fair (the GAME's first points
# a start) fit worse than an even split, and position vs the defense made
# every version worse. BENCH_SHARE of first points go to non-starters.
# Everything comes from this season's games (NBA rule), so early on the five
# sit close to even. VALUE_EDGE: our chance this far above Novig's = Value.
TIP_WINNER_SCORES = 0.666
USAGE_POWER = 0.5
TEAM_SHARE_PRIOR = 20
BENCH_SHARE = 0.04
VALUE_EDGE = 0.10


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
        team_shot, team_scorer = {}, {}  # each team's first shooter / first scorer
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
            if p.shooting_play == True and not free_throw and not pd.isna(p.athlete_id_1):  # noqa: E712
                if first_team is None:
                    early_shots.append(int(p.athlete_id_1))
                team_shot.setdefault(team, int(p.athlete_id_1))
            if p.scoring_play == True:  # noqa: E712
                secs = 720 - p.start_quarter_seconds_remaining if not pd.isna(p.start_quarter_seconds_remaining) else None
                if first_team is None:
                    first_team = team
                    first_scorer = None if pd.isna(p.athlete_id_1) else int(p.athlete_id_1)
                    first_ft = free_throw
                first_pts.setdefault(team, (poss[team], secs))
                if not pd.isna(p.athlete_id_1):
                    team_scorer.setdefault(team, int(p.athlete_id_1))
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
            "early_shots": early_shots, "team_shot": team_shot, "team_scorer": team_scorer, "q1_margin": int(last.home_score) - int(last.away_score),
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
    the game's first points), shots (field goal tries + 0.44 x free throw
    tries), team_first_shot / team_first_pts (took his
    team's first shot / scored its first points), jumps, tips_won} over his starts."""
    box = player_box[(player_box["season_type"] == 2) & (player_box["starter"] == True)]  # noqa: E712
    starts = defaultdict(set)
    for r in box[["game_id", "athlete_id"]].itertuples(index=False):
        starts[int(r.athlete_id)].add(str(r.game_id))
    team_of = {(str(r.game_id), int(r.athlete_id)): r.team_abbreviation for r in player_box[["game_id", "athlete_id", "team_abbreviation"]].itertuples(index=False)}
    out = defaultdict(lambda: {"games": 0, "min": 0.0, "starts": 0, "shots": 0.0, "shot_early": 0, "first_shot": 0, "first_pts": 0,
                               "team_first_shot": 0, "team_first_pts": 0, "jumps": 0, "tips_won": 0})
    for pid, games in starts.items():
        out[pid]["starts"] = len(games)
    # Shot volume over his starts (the Fair's usage half).
    col = lambda name: pd.to_numeric(box[name], errors="coerce").fillna(0) if name in box else pd.Series(0.0, index=box.index)
    tries = col("field_goals_attempted") + 0.44 * col("free_throws_attempted")
    for pid, total in tries.groupby(box["athlete_id"]).sum().items():
        out[int(pid)]["shots"] = round(float(total), 2)
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
        # Team Share: his own team's first shot and first points (the owner, 2026-10-21).
        for pid in o["team_shot"].values():
            if gid in starts.get(pid, ()):
                out[pid]["team_first_shot"] += 1
        for pid in o["team_scorer"].values():
            if gid in starts.get(pid, ()):
                out[pid]["team_first_pts"] += 1
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


def inches(height) -> int | None:
    """ESPN's roster height (6' 11") in inches."""
    try:
        feet, rest = str(height).replace('"', "").split("'")
        return int(feet) * 12 + int(rest)
    except (TypeError, ValueError):
        return None


def jump_balls(pbp: pd.DataFrame, player_box: pd.DataFrame) -> list:
    """(winner id, loser id) for every regular-season jump ball, opening tips,
    held balls and overtimes alike. The play's team_id is the side that got
    the ball; the jumper on that side won it."""
    box = player_box.dropna(subset=["athlete_id"])
    team_of = {(str(r.game_id), int(r.athlete_id)): r.team_abbreviation for r in box[["game_id", "athlete_id", "team_abbreviation"]].itertuples(index=False)}
    jumps = pbp[(pbp["season_type"] == 2) & (pbp["type_text"] == "Jumpball")].sort_values(["game_id", "sequence_number"])
    out = []
    for r in jumps.itertuples(index=False):
        if pd.isna(r.athlete_id_1) or pd.isna(r.athlete_id_2) or pd.isna(r.team_id):
            continue
        got = {r.home_team_id: r.home_team_abbrev, r.away_team_id: r.away_team_abbrev}.get(r.team_id)
        a, b = int(r.athlete_id_1), int(r.athlete_id_2)
        ta, tb = team_of.get((str(r.game_id), a)), team_of.get((str(r.game_id), b))
        if got is None or ta == tb or got not in (ta, tb):
            continue
        out.append((a, b) if got == ta else (b, a))
    return out


def tip_ratings(jumps: list, heights: dict) -> dict:
    """{player id: rating} from (winner, loser) jump balls: a win over a big
    rating counts for more than a win over a guard. Each rating starts at
    TIP_PER_INCH a inch from TIP_MID_HEIGHT and the jumps pull it away
    (TIP_PULL: the pull back to height). One jumper beats another
    1 / (1 + e^-(his rating - the other's))."""
    ids = sorted({x for j in jumps for x in j})
    start = {pid: height_rating(heights.get(str(pid))) for pid in ids}
    rating = dict(start)
    for _ in range(100):
        grad = {pid: -TIP_PULL * (rating[pid] - start[pid]) for pid in ids}
        curve = dict.fromkeys(ids, TIP_PULL)
        for win, lose in jumps:
            p = 1 / (1 + math.exp(rating[lose] - rating[win]))
            grad[win] += 1 - p
            grad[lose] -= 1 - p
            curve[win] += p * (1 - p)
            curve[lose] += p * (1 - p)
        rating = {pid: rating[pid] + grad[pid] / curve[pid] for pid in ids}
    return {str(pid): round(r, 3) for pid, r in rating.items()}


def tip_block(jumps: list, heights: dict) -> dict:
    """data.json first_basket.tip: this season's ratings, every rostered
    player's height (a jumper with no jumps yet goes by it) and each jumper's
    jump balls won / jumped (opening tips, held balls, overtimes)."""
    record = defaultdict(lambda: [0, 0])
    for win, lose in jumps:
        record[str(win)][0] += 1
        record[str(win)][1] += 1
        record[str(lose)][1] += 1
    return {"ratings": tip_ratings(jumps, heights), "heights": heights, "record": dict(record), "jumps": len(jumps)}


def height_rating(height: int | None) -> float:
    return TIP_PER_INCH * (height - TIP_MID_HEIGHT) if height else 0.0


def tip_chance(tip: dict, away_jumper, home_jumper) -> float:
    """The home jumper's chance to win the tip (0.5 when either is unknown)."""
    if not away_jumper or not home_jumper:
        return 0.5
    rating = lambda pid: tip["ratings"].get(str(pid), height_rating(tip["heights"].get(str(pid))))
    return 1 / (1 + math.exp(rating(away_jumper) - rating(home_jumper)))


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


def team_chance(tip_home: float) -> float:
    """The home team's chance to score first."""
    return tip_home * TIP_WINNER_SCORES + (1 - tip_home) * (1 - TIP_WINNER_SCORES)


def first_shares(players: dict, starters: list) -> list:
    """Each starter's share of his team's first points among the five (adds
    to 1). players = this season's numbers; a starter with no starts takes
    his teammates' shot volume and the steadied team rate."""
    blank = {"starts": 0, "shots": 0.0, "team_first_pts": 0}
    rows = [players.get(pid) or blank for pid in starters]
    starts = sum(r["starts"] for r in rows)
    avg = sum(r["team_first_pts"] for r in rows) / starts if starts else 1 / max(1, len(rows))
    vol = [r["shots"] / r["starts"] for r in rows if r["starts"]]
    vol_avg = sum(vol) / len(vol) if vol else 10.0
    usage = [((r["shots"] / r["starts"]) if r["starts"] else vol_avg) ** USAGE_POWER for r in rows]
    team = [(r["team_first_pts"] + TEAM_SHARE_PRIOR * avg) / (r["starts"] + TEAM_SHARE_PRIOR) for r in rows]
    weights = [u / (sum(usage) or 1) + t / (sum(team) or 1) for u, t in zip(usage, team)]
    total = sum(weights) or 1
    return [w / total for w in weights]


def name_key(name) -> str:
    """A name for matching across sources (the page's nameKey)."""
    import re
    import unicodedata
    n = unicodedata.normalize("NFD", str(name or ""))
    n = "".join(c for c in n if unicodedata.category(c) != "Mn").lower()
    n = re.sub(r"[^a-z0-9 ]", "", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def book_price(prices: dict, name: str):
    """Novig's First Basket price for a player, matched by name."""
    want = name_key(name)
    return next((v for k, v in (prices or {}).items() if name_key(k) == want), None)


def units(price, won: bool) -> float:
    """One unit bet at an American price."""
    if not won:
        return -1.0
    return price / 100 if price > 0 else 100 / -price


def implied(price) -> float | None:
    """A price's chance (American)."""
    if price is None:
        return None
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def is_value(p: float, price) -> bool:
    """Value: our chance at least VALUE_EDGE above the book's."""
    book = implied(price)
    return book is not None and p > book * (1 + VALUE_EDGE)


def fair_prices(players: dict, away: dict, home: dict, tip: dict) -> dict:
    """Fair prices for a game's ten starters: the team's chance to score
    first (team_chance, from the jumpers' tip chance) x his share of his
    team's first points (first_shares) x (1 - BENCH_SHARE). players = this
    season's numbers (NBA rule: this season decides)."""
    tip_home = tip_chance(tip, away["jumper"], home["jumper"])
    first_home = team_chance(tip_home)
    out = {"tip_home": num(tip_home), "first_home": num(first_home), "players": {}}
    for side, p_team in ((away, 1 - first_home), (home, first_home)):
        for pid, share in zip(side["starters"], first_shares(players, side["starters"])):
            p = p_team * (1 - BENCH_SHARE) * share
            out["players"][pid] = {"p": num(p), "fair": american(p)}
    return out


def fair_weights() -> dict:
    """The Fair's settings, for the page: it redoes the Fair in the browser
    when the NBA's real lineup differs from the likely starters."""
    return {"tip_winner_scores": TIP_WINNER_SCORES, "usage_power": USAGE_POWER, "team_share_prior": TEAM_SHARE_PRIOR,
            "bench_share": BENCH_SHARE, "value_edge": VALUE_EDGE, "min_jumps": MIN_JUMPS,
            "tip_per_inch": TIP_PER_INCH, "tip_mid_height": TIP_MID_HEIGHT}


def slate(block: dict, games: list, team_of: dict, out_ids: set, dates: list, tip: dict, now: dict) -> dict:
    """{game id: {away, home, fair}} for the games on `dates`: the likely
    starters from `block` (the season shown), the Fair from this season's
    tip (`tip`) and players (`now`) in every season's view."""
    out = {}
    for g in games:
        if g["date"] not in dates:
            continue
        away = game_side(block, g["away"], team_of, out_ids)
        home = game_side(block, g["home"], team_of, out_ids)
        out[g["game_id"]] = {"away": away, "home": home, "fair": fair_prices(now, away, home, tip)}
    return out
