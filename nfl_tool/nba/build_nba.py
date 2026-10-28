"""GMG NBA Suite data build -> nfl_tool/site/nba/data.json.

The NBA twin of build_stats.py, started 2026-10-11. Sources (all free):
  * sportsdataverse / hoopR -- the basketball sister project of nflverse.
    Season files (named by the year the season ENDS: 2027 = 2026-27) are
    published as GitHub release assets and refreshed daily in season:
    schedule, team and player box scores, play-by-play (with shot
    coordinates), rosters, depth charts and injuries, all scraped from ESPN.
    https://github.com/sportsdataverse/sportsdataverse-data/releases
  * Novig -- game lines, the same public feed the NFL build reads
    (league=NBA), pregame numbers only.

Every page shows THIS season only (the owner, 2026-10-23: "i do not want
flawed data entering this seasons numbers"). Last season's files stay in
nfl_tool/nba/ for the backtests, never on the site.

Team keys are ESPN's abbreviations (NY, GS, SA, NO, UTAH, WSH ...).
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(1, str(Path(__file__).resolve().parent.parent))  # nfl_tool/, for smartstake.py
import first_basket  # noqa: E402
import props  # noqa: E402
import shots  # noqa: E402
import zone_matchups  # noqa: E402
import smartstake  # noqa: E402
import identity  # noqa: E402
import kotc  # noqa: E402
import positions  # noqa: E402
import possessions as P  # noqa: E402
import sim  # noqa: E402
import watch  # noqa: E402
import nba_report  # noqa: E402

RELEASES = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
FILES = {
    "schedule": "espn_nba_schedules/nba_schedule_{season}.parquet",
    "team_box": "espn_nba_team_boxscores/team_box_{season}.parquet",
    "player_box": "espn_nba_player_boxscores/player_box_{season}.parquet",
    "rosters": "espn_nba_rosters/rosters_{season}.parquet",
    "injuries": "espn_nba_injuries/injuries_{season}.parquet",
    "pbp": "espn_nba_pbp/play_by_play_{season}.parquet",
}
REGULAR_SEASON = 2  # ESPN season_type
SCHEDULE_DAYS_AHEAD = 14
RECENT_GAMES = 10
ROTATION_PLAYERS = 12
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nba/1.0)"

NOVIG_EVENTS_URL = "https://api.novig.us/v3/public/catalog/events?league=NBA"
NOVIG_GRAPHQL_URL = "https://api.novig.us/v1/graphql"
NOVIG_QUERY_PATH = Path(__file__).parent.parent / "novig_event_markets.graphql"
# Same market filter the NFL build sends (build_stats.py NOVIG_MARKET_FILTER).
NOVIG_MARKET_FILTER = {
    "_and": [
        {"status": {"_eq": "OPEN"}},
        {"_or": [{"is_consensus": {"_eq": True}}, {"outcomes": {"available": {"_is_null": False}}}]},
        {"_and": [
            {"_not": {"market_locks": {"_and": [{"deleted_at": {"_is_null": True}}]}}},
            {"event": {"_not": {"event_locks": {"_and": [{"deleted_at": {"_is_null": True}}]}}}},
        ]},
    ]
}
LIVE_DATA_URL = "https://nfl.gmgsports.org/nba/data.json"
# first_basket: {player name: Novig's First Basket "Yes" price, American};
# locked at tip like the lines (First Basket's Novig column).
LINE_FIELDS = (
    "first_basket", "away_team_spread", "home_team_spread", "away_spread_odds", "home_spread_odds", "total_line",
    "over_odds", "under_odds", "away_moneyline", "home_moneyline", "away_ml_implied_prob", "home_ml_implied_prob",
)


# PG / SG / SF / PF / C by player (positions.py), set by main(); every box
# score and roster file is read with these in place of ESPN's G / F / C.
POSITION_TABLE: dict = {}


# ---- files ----
def fetch_file(kind: str, season: int, data_dir: Path, force: bool) -> pd.DataFrame | None:
    """One season file as a DataFrame, or None if hoopR hasn't published it
    (a 404 before the season's first game). Cached in data_dir unless force."""
    rel = FILES[kind].format(season=season)
    path = data_dir / rel.split("/")[-1]
    if force or not path.exists():
        try:
            req = urllib.request.Request(f"{RELEASES}/{rel}", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
    frame = pd.read_parquet(path)
    if kind == "player_box":
        frame = positions.relabel(frame, POSITION_TABLE)
    elif kind == "rosters":
        frame = positions.relabel(frame, POSITION_TABLE, pos_col="position_abbreviation")
    return frame


def num(value, digits=1):
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


# ---- team stats ----
def team_game_rows(team_box: pd.DataFrame) -> pd.DataFrame:
    """One row per team per regular-season game, with the opponent's box
    score alongside and both teams' possessions."""
    box = team_box[team_box["season_type"] == REGULAR_SEASON].copy()
    for col in ("fast_break_points", "points_in_paint", "turnover_points"):
        box[col] = pd.to_numeric(box[col], errors="coerce")
    # ESPN's "turnovers" leaves out team turnovers (shot clock, 5 seconds).
    box["tov"] = box["total_turnovers"].fillna(box["turnovers"])
    keep = [
        "game_id", "game_date", "team_abbreviation", "team_home_away", "team_score", "team_winner",
        "field_goals_made", "field_goals_attempted", "three_point_field_goals_made", "three_point_field_goals_attempted",
        "free_throws_made", "free_throws_attempted", "offensive_rebounds", "defensive_rebounds", "assists",
        "steals", "blocks", "tov", "fast_break_points", "points_in_paint", "turnover_points", "opponent_team_abbreviation",
    ]
    box = box[keep]
    opp = box.drop(columns=["game_date", "team_home_away", "team_winner", "opponent_team_abbreviation"]).rename(
        columns=lambda c: c if c == "game_id" else f"opp_{c}"
    )
    rows = box.merge(opp, on="game_id")
    rows = rows[rows["team_abbreviation"] != rows["opp_team_abbreviation"]].copy()
    poss = lambda p: rows[f"{p}field_goals_attempted"] - rows[f"{p}offensive_rebounds"] + rows[f"{p}tov"] + 0.44 * rows[f"{p}free_throws_attempted"]
    rows["poss"] = (poss("") + poss("opp_")) / 2  # both teams get the same count
    return rows.sort_values(["game_date", "game_id"])


def compute_team_stats(rows: pd.DataFrame) -> dict:
    """Season totals turned into rates. Every stat has the offense's number
    and the matching number the defense allows (opp_*), so matchups can read
    both sides. Ratings are per 100 possessions."""
    out = {}
    for team, g in rows.groupby("team_abbreviation"):
        s = g.sum(numeric_only=True)
        games = len(g)
        side = lambda p: {
            "ppg": s[f"{p}team_score"] / games,
            "rating": 100 * s[f"{p}team_score"] / s["poss"],
            "efg": (s[f"{p}field_goals_made"] + 0.5 * s[f"{p}three_point_field_goals_made"]) / s[f"{p}field_goals_attempted"],
            "tov_pct": s[f"{p}tov"] / s["poss"],
            "ft_rate": s[f"{p}free_throws_attempted"] / s[f"{p}field_goals_attempted"],
            "three_rate": s[f"{p}three_point_field_goals_attempted"] / s[f"{p}field_goals_attempted"],
            "three_pct": s[f"{p}three_point_field_goals_made"] / s[f"{p}three_point_field_goals_attempted"],
            "threes_pg": s[f"{p}three_point_field_goals_made"] / games,
            "paint_pg": s[f"{p}points_in_paint"] / games,
            "fast_break_pg": s[f"{p}fast_break_points"] / games,
            # ESPN's turnover_points is what a team GAVE UP off its own turnovers,
            # so a side's points off turnovers are the other side's number.
            "pts_off_tov_pg": s[f"{'opp_' if not p else ''}turnover_points"] / games,
            "ast_pg": s[f"{p}assists"] / games,
            "reb_pg": (s[f"{p}offensive_rebounds"] + s[f"{p}defensive_rebounds"]) / games,
        }
        off, dfn = side(""), side("opp_")
        wins = int(g["team_winner"].sum())
        home = g[g["team_home_away"] == "home"]
        last = g.tail(RECENT_GAMES)
        stats = {
            "games_played": games,
            "wins": wins,
            "losses": games - wins,
            "home_record": f"{int(home['team_winner'].sum())}-{len(home) - int(home['team_winner'].sum())}",
            "away_record": f"{wins - int(home['team_winner'].sum())}-{(games - len(home)) - (wins - int(home['team_winner'].sum()))}",
            "last10": f"{int(last['team_winner'].sum())}-{len(last) - int(last['team_winner'].sum())}",
            "pace": num(s["poss"] / games),
            "net_rating": num(off["rating"] - dfn["rating"]),
            "oreb_pct": num(s["offensive_rebounds"] / (s["offensive_rebounds"] + s["opp_defensive_rebounds"]), 4),
            "opp_oreb_pct": num(s["opp_offensive_rebounds"] / (s["opp_offensive_rebounds"] + s["defensive_rebounds"]), 4),
        }
        for key, value in off.items():
            stats[f"off_{key}"] = num(value, 4 if value < 1 else 1)
        for key, value in dfn.items():
            stats[f"def_{key}"] = num(value, 4 if value < 1 else 1)
        out[team] = stats
    return out


def compute_recent_games(rows: pd.DataFrame) -> dict:
    out = {}
    for team, g in rows.groupby("team_abbreviation"):
        out[team] = [
            {
                "game_id": str(r.game_id),
                "date": str(r.game_date),
                "opp": r.opponent_team_abbreviation,
                "home": r.team_home_away == "home",
                "pf": int(r.team_score),
                "pa": int(r.opp_team_score),
                "win": bool(r.team_winner),
                "pace": num(r.poss),
            }
            for r in g.tail(RECENT_GAMES).itertuples(index=False)
        ]
    return out


# ---- players ----
def compute_players(player_box: pd.DataFrame, rosters: pd.DataFrame | None) -> dict:
    """{team: rotation players}, per-game numbers from the stats season.
    A player sits on the team this season's roster file lists him with (so a
    summer trade shows up before any game is played), else his last team."""
    box = player_box[(player_box["season_type"] == REGULAR_SEASON) & (player_box["did_not_play"] != True)].copy()  # noqa: E712
    box["minutes"] = pd.to_numeric(box["minutes"], errors="coerce")
    box = box[box["minutes"] > 0].sort_values("game_date")
    current = {}
    if rosters is not None:
        current = {str(r.athlete_id): r for r in rosters.itertuples(index=False)}
    stat_cols = {
        "minutes": "min", "points": "pts", "rebounds": "reb", "assists": "ast", "three_point_field_goals_made": "threes",
        "steals": "stl", "blocks": "blk", "turnovers": "tov", "field_goals_attempted": "fga", "free_throws_attempted": "fta",
    }
    out = {}
    for athlete_id, g in box.groupby("athlete_id"):
        athlete_id = int(athlete_id)
        last = g.iloc[-1]
        roster = current.get(str(athlete_id))
        if rosters is not None and roster is None:
            continue  # not on any roster this season
        team = roster.team_abbreviation if roster is not None else last["team_abbreviation"]
        games = len(g)
        row = {
            "id": str(athlete_id),
            "name": roster.display_name if roster is not None else last["athlete_display_name"],
            "position": (roster.position_abbreviation if roster is not None else last["athlete_position_abbreviation"]) or "",
            "headshot": (roster.headshot_href if roster is not None else last["athlete_headshot_href"]) or None,
            "games": games,
            "starts": int(g["starter"].sum()),
            "prev_team": last["team_abbreviation"] if last["team_abbreviation"] != team else None,
        }
        for col, key in stat_cols.items():
            row[key] = num(g[col].sum() / games)
        last5 = g.tail(5)
        for col, key in (("minutes", "min"), ("points", "pts"), ("rebounds", "reb"), ("assists", "ast"), ("three_point_field_goals_made", "threes")):
            row[f"l5_{key}"] = num(last5[col].sum() / len(last5))
        for key in ("headshot", "position"):
            if isinstance(row[key], float) and pd.isna(row[key]):
                row[key] = None
        out.setdefault(team, []).append(row)
    for team in out:
        out[team] = sorted(out[team], key=lambda p: -(p["min"] or 0) * min(1, p["games"] / 10))[:ROTATION_PLAYERS]
    return out


def stats_block(season: int, team_box: pd.DataFrame, player_box: pd.DataFrame, teams: dict, rosters: pd.DataFrame | None) -> dict | None:
    """One season's Game Previews numbers, or None before it has a regular-season
    game. rosters = this season's roster file, to move last season's players
    onto their current teams (None for this season: the box score team is current)."""
    # All-Star and exhibition sides show up in the box scores; only real teams count.
    rows = team_game_rows(team_box[team_box["team_abbreviation"].isin(teams) & team_box["opponent_team_abbreviation"].isin(teams)])
    if rows.empty:
        return None
    team_stats = compute_team_stats(rows)
    played = sorted(s["games_played"] for s in team_stats.values())
    return {
        "label": season_label(season),
        "team_games": played[len(played) // 2],  # the middle team's games played
        "team_stats": team_stats,
        "recent_games": compute_recent_games(rows),
        "players": compute_players(player_box, rosters),
    }


# ---- injuries ----
def compute_injuries(injuries: pd.DataFrame | None, abbr_by_id: dict) -> dict:
    """{team: [players]} from the newest daily snapshot."""
    if injuries is None or injuries.empty:
        return {}
    latest = injuries[injuries["as_of_date"] == injuries["as_of_date"].max()]
    out = {}
    clean = lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) else v
    for r in latest.itertuples(index=False):
        team = abbr_by_id.get(int(r.team_id))
        if not team:
            continue
        out.setdefault(team, []).append({
            "id": str(r.athlete_id),
            "name": r.athlete_display_name,
            "position": POSITION_TABLE.get(str(r.athlete_id)) or clean(r.athlete_position),
            "status": r.status,
            "injury": " ".join(str(x) for x in (clean(r.detail_side), clean(r.detail_type)) if x) or None,
            "return_date": clean(r.detail_return_date),
            "note": clean(r.short_comment),
        })
    for team in out:
        out[team].sort(key=lambda p: (p["status"] != "Out", p["name"]))
    return out


ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"


LAST_INJURY_BODY = {}  # ESPN's list as live_injuries read it: the refresh's watch fingerprints it (watch.py)


def live_injuries(abbr_by_id: dict) -> dict | None:
    """{team: [players]} from ESPN's live injury list, the same shape as
    compute_injuries: the hoopR file is a daily snapshot, too slow for a game
    sim that has to know who sits tonight (the owner, 2026-10-24: "if lebron
    is ruled out at 3pm"). None if it can't be read (the build falls back to
    the file)."""
    import re
    LAST_INJURY_BODY.clear()
    try:
        req = urllib.request.Request(ESPN_INJURIES_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read())
    except Exception as ex:
        print(f"NOTE: ESPN live injuries not read ({ex!r}); using the daily file.", file=sys.stderr)
        return None
    LAST_INJURY_BODY["body"] = body
    out = {}
    for t in body.get("injuries") or []:
        team = abbr_by_id.get(int(t.get("id") or 0))
        if not team:
            continue
        for i in t.get("injuries") or []:
            found = re.search(r"/athletes/(\d+)", json.dumps(i.get("athlete") or {}))
            if not found:
                continue
            pid = found.group(1)
            d = i.get("details") or {}
            out.setdefault(team, []).append({
                "id": pid,
                "name": (i.get("athlete") or {}).get("displayName"),
                "position": POSITION_TABLE.get(pid) or ((i.get("athlete") or {}).get("position") or {}).get("abbreviation"),
                "status": i.get("status"),
                "injury": " ".join(str(x) for x in (d.get("side"), d.get("type")) if x) or None,
                "return_date": d.get("returnDate"),
                "note": i.get("shortComment"),
                "updated": i.get("date"),  # when ESPN last changed it: the newer of ESPN and the NBA's report wins (add_report)
            })
    for team in out:
        out[team].sort(key=lambda p: (p["status"] != "Out", p["name"] or ""))
    return out if out else None


# ---- schedule + lines ----
def eastern(utc_iso: str) -> datetime:
    """ESPN's UTC start time as a naive Eastern datetime. UTC-4 is exact
    until November and an hour off after -- times then read an hour late
    until this learns the DST switch (fine for dates, noted in CLAUDE.md)."""
    return datetime.strptime(utc_iso, "%Y-%m-%dT%H:%MZ") - timedelta(hours=4)


def compute_schedule(schedule: pd.DataFrame, now_utc: datetime) -> list:
    """Games from yesterday through the next SCHEDULE_DAYS_AHEAD days; before
    opening night that window slides to start at the first game."""
    sched = schedule[(schedule["home_abbreviation"] != "TBD") & (schedule["away_abbreviation"] != "TBD")].copy()
    sched["start"] = pd.to_datetime(sched["date"], format="%Y-%m-%dT%H:%MZ")
    sched = sched.sort_values("start")
    first = sched["start"].min()
    window_start = max(now_utc - timedelta(days=1), first - timedelta(hours=12))
    window = sched[(sched["start"] >= window_start) & (sched["start"] <= window_start + timedelta(days=SCHEDULE_DAYS_AHEAD + 1))]
    games = []
    for r in window.itertuples(index=False):
        et = eastern(r.date)
        final = bool(r.status_type_completed)
        games.append({
            "game_id": str(r.game_id),
            "date": et.strftime("%Y-%m-%d"),
            "time": et.strftime("%H:%M"),
            "start_utc": r.date,
            "away": r.away_abbreviation,
            "home": r.home_abbreviation,
            "status": "final" if final else "scheduled",
            "away_score": int(r.away_score) if final else None,
            "home_score": int(r.home_score) if final else None,
            "tv": r.broadcast_name or None,
        })
    return games


def _request(url: str, body: dict | None = None, headers: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    head = {"accept": "*/*", "User-Agent": USER_AGENT, **(headers or {})}
    if data is not None:
        head["content-type"] = "application/json"
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=head), timeout=30) as resp:
        return json.load(resp)


def price_to_american(p):
    """Novig prices an outcome as the cost of a $1 contract (0.535 = 53.5%)."""
    if p is None or p <= 0 or p >= 1:
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def fetch_novig_lines(games: list, teams: dict) -> tuple:
    """({game_id: lines}, debug). Pregame events only -- Novig keeps quoting
    in-game lines after tip-off, and those must never be shown as the line
    (the NFL site learned that on 2026-10-11). Never raises."""
    debug = {"events": 0, "matched": 0, "error": None}
    out = {}
    try:
        query = NOVIG_QUERY_PATH.read_text(encoding="utf-8").rstrip("\n")
        by_matchup = {}
        for g in games:
            by_matchup.setdefault((teams[g["away"]]["mascot"], teams[g["home"]]["mascot"]), []).append(g)
        events = [e for e in _request(NOVIG_EVENTS_URL).get("items", []) if e.get("status") == "OPEN_PREGAME" and " @ " in (e.get("description") or "")]
        debug["events"] = len(events)
        for e in events:
            away_name, home_name = e["description"].split(" @ ", 1)
            match = next((k for k in by_matchup if away_name.endswith(k[0]) and home_name.endswith(k[1])), None)
            if not match:
                continue
            # Same two teams can meet twice in the window: take the game closest to this event's start.
            starts = datetime.fromtimestamp(e["startsTs"] / 1000, tz=timezone.utc).replace(tzinfo=None)
            game = min(by_matchup[match], key=lambda g: abs(datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") - starts))
            if abs(datetime.strptime(game["start_utc"], "%Y-%m-%dT%H:%MZ") - starts) > timedelta(hours=12):
                continue
            resp = _request(NOVIG_GRAPHQL_URL, {
                "operationName": "EventMarkets_Query",
                "variables": {"eventId": e["eventId"], "marketVisibleWhere": NOVIG_MARKET_FILTER},
                "query": query,
            })
            if resp.get("errors"):
                debug["error"] = str(resp["errors"][0].get("message"))
                continue
            rows = (resp.get("data") or {}).get("event") or []
            if not rows or not rows[0].get("game"):
                continue
            ev = rows[0]
            sides = {ev["game"]["awayTeam"]["symbol"]: "away", ev["game"]["homeTeam"]["symbol"]: "home"}
            lines = {}
            for m in ev.get("markets") or []:
                # First Basket: one Yes / No market per player (any first points).
                if m.get("type") == "FIRST_BASKET" and m.get("player"):
                    yes = next((o for o in m.get("outcomes") or [] if (o.get("description") or "").lower() == "yes"), None)
                    price = price_to_american(yes.get("available")) if yes else None
                    if price is not None:
                        lines.setdefault("first_basket", {})[m["player"].get("full_name") or ""] = price
                    continue
                if not m.get("is_consensus") or m.get("player"):
                    continue
                outs = m.get("outcomes") or []
                if m.get("type") == "SPREAD":
                    for o in outs:
                        side = sides.get((o.get("competitor") or {}).get("symbol"))
                        try:
                            line = float((o.get("description") or "").split()[-1])
                        except (ValueError, IndexError):
                            continue
                        if side:
                            lines[f"{side}_team_spread"] = line
                            lines[f"{side}_spread_odds"] = price_to_american(o.get("available"))
                elif m.get("type") == "TOTAL" and m.get("strike") is not None:
                    lines["total_line"] = float(m["strike"])
                    for o in outs:
                        word = (o.get("description") or "").split(" ")[0].lower()
                        if word in ("over", "under"):
                            lines[f"{word}_odds"] = price_to_american(o.get("available"))
                elif m.get("type") == "MONEY":
                    prices = {}
                    for o in outs:
                        side = sides.get((o.get("competitor") or {}).get("symbol"))
                        if side:
                            lines[f"{side}_moneyline"] = price_to_american(o.get("available"))
                            prices[side] = o.get("available")
                    if prices.get("away") and prices.get("home"):
                        total = prices["away"] + prices["home"]
                        lines["away_ml_implied_prob"] = round(prices["away"] / total, 3)
                        lines["home_ml_implied_prob"] = round(prices["home"] / total, 3)
            if lines:
                out[game["game_id"]] = lines
                debug["matched"] += 1
    except Exception as ex:  # network, JSON, or a changed query -- the page just shows no lines
        debug["error"] = str(ex)
        print(f"WARNING: Novig NBA fetch failed ({ex}).", file=sys.stderr)
    return out, debug


def split_ladders(book_odds: dict) -> tuple:
    """(book_odds without the alt ladders, {game: {"props": {"points_alt": ...}}}):
    the ladders are most of the NBA's quotes (72,000 of ~110,000 on 2026-10-28)
    and go in their own nba/ladders.json, read only by the sim pages, so
    data.json stays well under Cloudflare's 25 MB a file."""
    main, ladders = {}, {}
    for key, game in (book_odds or {}).items():
        props = game.get("props") or {}
        alt = {m: v for m, v in props.items() if m.endswith("_alt")}
        main[key] = {**game, "props": {m: v for m, v in props.items() if m not in alt}}
        if alt:
            ladders[key] = {"props": alt}
    return main, ladders


def merge_ladders(book_odds: dict | None, ladders: dict | None) -> dict | None:
    """split_ladders undone: ladders.json's markets back into book_odds."""
    for key, game in (ladders or {}).items():
        if book_odds is not None and key in book_odds:
            book_odds[key].setdefault("props", {}).update(game.get("props") or {})
    return book_odds


def fetch_previous() -> dict | None:
    """The deployed nba/data.json (behind the member login; the build proves
    itself the same way build_stats.py does), its ladders.json merged back
    into book_odds (the injury refresh carries them, and started games keep
    them locked). None on any failure."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(LIVE_DATA_URL, headers=headers), timeout=20) as resp:
            previous = json.load(resp)
    except Exception as e:
        print(f"NOTE: no previous NBA data to carry lines from ({e}).", file=sys.stderr)
        return None
    try:
        url = LIVE_DATA_URL.rsplit("/", 1)[0] + "/ladders.json"
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as resp:
            merge_ladders(previous.get("book_odds"), json.load(resp))
    except Exception as e:  # before the first build that wrote one, the ladders were inside data.json
        print(f"NOTE: no previous NBA ladders file ({e}).", file=sys.stderr)
    return previous


MARKED_OUT_URL = "https://nfl.gmgsports.org/api/nba-outs?day={day}"


def fetch_marked_out(day: str) -> list:
    """The owner's Mark Out list for an Eastern date (the Matchup View's Out
    button, /api/nba-outs in the login middleware): [{pid, name, team}]. Empty
    on any failure (the injury report stands)."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(MARKED_OUT_URL.format(day=day), headers=headers), timeout=20) as resp:
            return list(json.load(resp).get("outs") or [])
    except Exception as e:
        print(f"NOTE: the owner's Mark Out list not read ({e}).", file=sys.stderr)
        return []


def add_report(injuries: dict, report: dict, at: str | None, players: dict) -> dict:
    """The injury list with the NBA's official report (nba_report.py; report
    = {id: status} for tonight's teams, at = its slot, players = {id: (name,
    team)}): where the report is newer than ESPN's entry (or ESPN has none)
    its status wins; Available takes a player off the list; Probable adds no
    one. The owner's marks come after (add_marked_out)."""
    for pid, status in report.items():
        name, team = players.get(pid, (None, None))
        if not team:
            continue
        rows = injuries.setdefault(team, [])
        row = next((r for r in rows if str(r["id"]) == pid), None)
        if row is not None and row.get("updated") and at and row["updated"] > at:
            continue  # ESPN changed it after this report
        if status == "Available":
            if row is not None:
                rows.remove(row)
            continue
        if row is None:
            if status == "Probable":
                continue
            row = {"id": pid, "name": name, "position": POSITION_TABLE.get(pid), "status": status, "injury": None,
                   "return_date": None, "note": f"NBA injury report: {status}"}
            rows.append(row)
        row.update(status=status, source="nba")
        rows.sort(key=lambda p: (p["status"] != "Out", p["name"] or ""))
    return injuries


def add_marked_out(injuries: dict, marked: list) -> dict:
    """The injury list with the owner's marks as Out (`marked`: the page shows
    the owner an Undo), whatever ESPN says."""
    for m in marked:
        pid, team = str(m.get("pid") or ""), m.get("team")
        if not pid or not team:
            continue
        rows = injuries.setdefault(team, [])
        row = next((r for r in rows if str(r["id"]) == pid), None)
        if row is None:
            row = {"id": pid, "name": m.get("name"), "position": POSITION_TABLE.get(pid), "status": "Out", "injury": None,
                   "return_date": None, "note": None}
            rows.append(row)
        row.update(status="Out", marked=True, note=row.get("note") or "Marked out by GMG")
        rows.sort(key=lambda p: (p["status"] != "Out", p["name"] or ""))
    return injuries


def apply_lines(games: list, novig: dict, previous: dict | None, now_utc: datetime) -> None:
    """Fresh Novig lines for games that haven't tipped; a game that has
    started keeps whatever the last build before tip-off stored."""
    prev = {g["game_id"]: g for g in (previous or {}).get("schedule") or []}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        source = prev.get(g["game_id"], {}) if started else novig.get(g["game_id"]) or prev.get(g["game_id"], {})
        for field in LINE_FIELDS:
            if source.get(field) is not None:
                g[field] = source[field]
        g["lines_locked"] = started


# ---- King of the Court (kotc.py) ----
KOTC_SLATE_NIGHTS = 3
KOTC_RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_kotc"
KOTC_RECORD_TOP = 60  # 30 until 2026-10-22: payouts on longer shots need their pregame chance


def season_label(season: int) -> str:
    return f"{season - 1}-{str(season)[2:]}"


def kotc_lines(season: int, games: list) -> dict:
    """{game_id: [total, home spread]} for a season. Last season's are a saved
    file (DraftKings' numbers from ESPN, nba/lines_<season>.json). This
    season's are the Novig lines each game had at tip-off, kept in
    model_history/nba_kotc/lines_<season>.json as games start."""
    saved = Path(__file__).parent / f"lines_{season}.json"
    if saved.exists():
        return json.loads(saved.read_text())
    path = KOTC_RECORD_DIR / f"lines_{season}.json"
    lines = json.loads(path.read_text()) if path.exists() else {}
    changed = False
    for g in games:
        if g.get("lines_locked") and g["game_id"] not in lines and (g.get("total_line") or g.get("home_team_spread") is not None):
            lines[g["game_id"]] = [g.get("total_line"), g.get("home_team_spread")]
            changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(lines, indent=0, sort_keys=True))
    return lines


def add_recent_lines(recent: dict, lines: dict) -> None:
    """Each recent game gets its line at tip: `spread` (the team's own) and `total`."""
    for rows in recent.values():
        for r in rows:
            line = lines.get(r.get("game_id"))
            if line:
                total, home_spread = line
                r["total"] = total
                r["spread"] = None if home_spread is None else (home_spread if r["home"] else -home_spread)


def compute_kotc(season: int, data_dir: Path, force: bool, teams: dict, rosters, injuries: dict, games: list, now_utc: datetime) -> dict:
    """This season's board (the page shows this season only since 2026-10-22,
    the owner: "by next week, we will have every team with data for this
    season"), the next few nights' slates, every finished night as its
    pregame board had it (`past`). Historical Data is this season's too
    (last season's reference numbers came off 2026-10-23)."""
    blocks, pg_now = {}, None
    cur_box = fetch_file("player_box", season, data_dir, force)
    if cur_box is not None:
        pg_now = kotc.player_games(cur_box, teams)
        if len(pg_now):
            blocks[season] = kotc.season_block(pg_now, kotc_lines(season, games), season_label(season))

    roster_team = {}
    if rosters is not None:
        roster_team = {str(r.athlete_id): r.team_abbreviation for r in rosters.itertuples(index=False)}
    out_ids = {p["id"] for team in injuries.values() for p in team if p["status"] == "Out"}
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]
    slates = {s: kotc.slate(block, games, roster_team, out_ids, dates) for s, block in blocks.items()}

    record = kotc_record(season, slates.get(season, {}), season, blocks.get(season), games, now_utc)
    for block in blocks.values():
        block.pop("_league", None)
    return {
        "default": str(season),
        "weights": kotc.WEIGHTS,
        "thresholds": list(kotc.THRESHOLDS),
        "seasons": {str(s): b for s, b in blocks.items()},
        "slates": {str(s): v for s, v in slates.items()},
        "past": kotc.past_nights(pg_now, record, today),
        "record": record,
    }


def compute_identity(season: int, data_dir: Path, force: bool) -> dict:
    """Team Identity (identity.py): this season from the engine on every build
    (last season's saved file is for the backtests only)."""
    blocks = {}
    pbp = fetch_file("pbp", season, data_dir, force)
    box = fetch_file("player_box", season, data_dir, force)
    schedule = fetch_file("schedule", season, data_dir, force)
    if pbp is not None and box is not None:
        block = identity.season_block(pbp, box, season_label(season), schedule)
        if block:
            blocks[season] = block
    return {"default": str(season), "seasons": {str(s): b for s, b in blocks.items()}}


def compute_first_basket(season: int, data_dir: Path, force: bool, teams: dict, rosters, injuries: dict, games: list, now_utc: datetime,
                         book_odds: dict | None = None) -> dict:
    """First Basket: this season's numbers and the next few nights' games
    (likely starters, jumpers, the fair-price guess)."""
    blocks = {}
    jumps = []  # this season's jump balls: the tip chance (NBA rule: this season decides)
    openings = {}  # this season's games' firsts: grades the Value record
    pbp = fetch_file("pbp", season, data_dir, force)
    box = fetch_file("player_box", season, data_dir, force)
    if pbp is not None and box is not None:
        block = first_basket.season_block(pbp, box, teams, season_label(season))
        if block["games"]:
            blocks[season] = block
        jumps = first_basket.jump_balls(pbp, box)
        openings = {o["game_id"]: o for o in first_basket.game_openings(pbp, teams)}
    heights = {}
    if rosters is not None:
        heights = {str(r.athlete_id): h for r in rosters.itertuples(index=False) if (h := first_basket.inches(r.height))}
    tip = first_basket.tip_block(jumps, heights)
    out_ids = {p["id"] for team in injuries.values() for p in team if p["status"] == "Out"}
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]
    now = blocks[season]["players"] if season in blocks else {}  # the Fair: this season's starts only
    slates = {str(s): first_basket.slate(b, games, {}, out_ids, dates, tip, now) for s, b in blocks.items()}
    default = season
    # Every rostered player (the page matches the NBA's lineup names to these),
    # and the NBA's lineup files as of this build: the page reads them live
    # (/api/nba-lineups) and falls back to these copies.
    roster = {}
    if rosters is not None:
        for r in rosters.itertuples(index=False):
            roster[str(r.athlete_id)] = [r.display_name, r.team_abbreviation, r.position_abbreviation]
    names = {pid: p["name"] for b in blocks.values() for pid, p in b["players"].items()}
    names.update({pid: r[0] for pid, r in roster.items()})
    record = first_basket_record(season, slates.get(str(default), {}), names, games, openings, now_utc, book_odds)
    lineups = {}
    for d in dates:
        got = fetch_nba_lineups(d)
        if got is not None:
            lineups[d] = got
    return {
        "default": str(default), "seasons": {str(s): b for s, b in blocks.items()}, "slates": slates,
        "roster": roster, "lineups": lineups, "fair_weights": first_basket.fair_weights(), "tip": tip, "record": record,
        # Who scored each of this season's games first (My Plays grades First Basket plays with it).
        "results": {gid: None if o["first_scorer"] is None else str(o["first_scorer"]) for gid, o in openings.items()},
    }


NBA_LINEUPS_URL = "https://stats.nba.com/js/data/leaders/00_daily_lineups_{day}.json"


def fetch_nba_lineups(date: str) -> dict | None:
    """The NBA's daily lineups file for an Eastern date (YYYY-MM-DD), or None
    (not posted yet, or the NBA turned the request away)."""
    url = NBA_LINEUPS_URL.format(day=date.replace("-", ""))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Referer": "https://www.nba.com/"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
    except Exception as ex:
        print(f"NOTE: NBA lineups for {date} not read ({ex!r}).", file=sys.stderr)
        return None
    return {"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "games": data.get("games") or []}


FB_RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_first_basket"
FB_RECORD_START = "2026-10-23"  # the First Basket record's first night (this season's numbers only)


def first_basket_record(season: int, slate: dict, names: dict, games: list, openings: dict, now_utc: datetime,
                        book_odds: dict | None = None) -> dict:
    """model_history/nba_first_basket/<season>.json: each game's ten starters
    as the last build before tip had them ({game id: {date, away, home,
    first_home, tip_home, jumpers: [[id, name] away, home], players: {id:
    [name, our chance, best price, Value, book]}}}; best price = the best Yes
    across SmartStake's books, else Novig's; a started game is never
    rewritten), graded once its play-by-play is in (`result`: the team that
    won the opening tip, the team and player who scored first). Returns the
    Value record for the page (every Value tag bet one unit at its best
    price) and `history`, every graded game newest first, for its YTD
    Performance window. tip_home / jumpers are saved from 2026-10-21 on."""
    path = FB_RECORD_DIR / f"{season}.json"
    record = json.loads(path.read_text()) if path.exists() else {}
    # The record starts clean on FB_RECORD_START (the owner, 2026-10-23: the earlier nights' picks
    # leaned on last season's numbers; "start fresh tonight" now that it's this season only).
    kept = {gid: r for gid, r in record.items() if r.get("date", "") >= FB_RECORD_START}
    changed = len(kept) != len(record)
    record = kept
    by_id = {g["game_id"]: g for g in games}
    for gid, game in slate.items():
        g = by_id.get(gid)
        if not g or g["date"] < FB_RECORD_START or g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        rows = {}
        for pid, f in game["fair"]["players"].items():
            name = names.get(pid, pid)
            price, book = first_basket.best_price((book_odds or {}).get(f"{g['away']}_{g['home']}"), pid,
                                                  first_basket.book_price(g.get("first_basket"), name))
            rows[pid] = [name, f["p"], price, first_basket.is_value(f["p"], price), book]
        jumpers = [[j, names.get(j, j)] if j else None for j in (game["away"]["jumper"], game["home"]["jumper"])]
        record[gid] = {"date": g["date"], "away": g["away"], "home": g["home"], "first_home": game["fair"]["first_home"],
                       "tip_home": game["fair"]["tip_home"], "jumpers": jumpers, "players": rows}
        changed = True
    for gid, r in record.items():
        o = openings.get(gid)
        if not o:
            continue
        if "result" not in r:
            r["result"] = {"team": o["first_team"], "scorer": None if o["first_scorer"] is None else str(o["first_scorer"]), "tip": o.get("tip")}
            changed = True
        elif "tip" not in r["result"]:  # graded before the tip winner was kept
            r["result"]["tip"] = o.get("tip")
            changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=1, sort_keys=True))
    plays = won = 0
    total = 0.0
    history = []
    for gid, r in sorted(record.items(), key=lambda x: (x[1]["date"], x[0]), reverse=True):
        if "result" not in r:
            continue
        res = r["result"]
        value = []
        for pid, (name, chance, price, is_value, *_) in r["players"].items():
            if is_value and price is not None:
                hit = res["scorer"] == pid
                plays += 1
                won += hit
                total += first_basket.units(price, hit)
                # The edge (our chance over the price's, less 1) feeds the YTD tracker's slider.
                value.append([pid, name, price, hit, round(chance / first_basket.implied(price) - 1, 3)])
        scorer = res["scorer"]
        history.append({"game_id": gid, "date": r["date"], "away": r["away"], "home": r["home"],
                        "tip_home": r.get("tip_home"), "jumpers": r.get("jumpers"), "tip": res.get("tip"),
                        "first_home": r.get("first_home"), "first": res["team"],
                        "scorer": [scorer, (r["players"].get(scorer) or [names.get(scorer, scorer)])[0]] if scorer else None,
                        "value": value})
    return {"plays": plays, "won": won, "units": round(total, 2), "games": len(history), "history": history}


def kotc_record(season: int, slate: dict, used: int, block: dict | None, games: list, now_utc: datetime) -> dict:
    """model_history/nba_kotc/<season>.json: each night's board as the last
    build before its first tip-off had it (a night that has started is never
    rewritten), so the page can show where each night's leader ranked."""
    path = KOTC_RECORD_DIR / f"{season}.json"
    record = json.loads(path.read_text()) if path.exists() else {}
    first_tip = {}
    for g in games:
        first_tip[g["date"]] = min(first_tip.get(g["date"], g["start_utc"]), g["start_utc"])
    changed = False
    for date, rows in slate.items():
        if not rows or not block or datetime.strptime(first_tip[date], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        live = sorted((r for r in rows if not r["out"]), key=lambda r: -r.get("lead", 0))[:KOTC_RECORD_TOP]
        record[date] = {
            "season_used": season_label(used),
            "board": [{"id": r["id"], "name": block["players"][r["id"]]["name"], "team": r["team"], "proj": r["proj"], "lead": r.get("lead")} for r in live],
        }
        changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=1, sort_keys=True))
    return record


PROPS_RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_props"


def nba_book_odds(teams: dict, rosters, games: list, previous: dict | None, now_utc: datetime, fast: bool = False) -> tuple:
    """Every US book's NBA points prices from SmartStake (smartstake.py), keyed
    "AWAY_HOME" with players by ESPN id; a started game keeps the last pregame
    copy (odds lock at tip-off). Never raises."""
    by_mascot = sorted(((t["mascot"].lower(), abbr) for abbr, t in teams.items()), key=lambda x: -len(x[0]))

    def team_of(full):
        text = (full or "").lower()
        return next((abbr for mascot, abbr in by_mascot if text.endswith(mascot)), None)

    ids = {}
    if rosters is not None:
        for r in rosters.itertuples(index=False):
            ids.setdefault((smartstake.norm_player(r.display_name), r.team_abbreviation), str(r.athlete_id))

    def player_key(name, away, home):
        n = smartstake.norm_player(name)
        return ids.get((n, away)) or ids.get((n, home))

    keep = {f"{g['away']}_{g['home']}" for g in games}
    return smartstake.fetch_nba_book_odds(os.environ.get("SMARTSTAKE_API_KEY"), team_of, player_key,
                                          (previous or {}).get("book_odds"), now_utc.strftime("%Y-%m-%dT%H:%MZ"), keep, fast=fast)


def compute_props(season: int, data_dir: Path, rosters, book_odds=None, games=(), injuries=None, now_utc=None,
                  lineups=None, market_prev=None) -> dict:
    """site/nba/props.json: this season's block (props.py: every player's game
    log, shot mix, with / without) and the game sim (sim.py, `compute_sim`:
    Points and Threes, since 2026-10-24). Last season's saved file is for the
    backtests only."""
    roster_team = {}
    if rosters is not None:
        roster_team = {str(r.athlete_id): r.team_abbreviation for r in rosters.itertuples(index=False)}
    blocks = {}
    out = {"default": str(season), "seasons": blocks}
    # First Basket has just downloaded this season's files (see compute_identity).
    pbp = fetch_file("pbp", season, data_dir, False)
    box = fetch_file("player_box", season, data_dir, False)
    if pbp is None or box is None:
        return out
    engine = P.Season(pbp, box)
    block = props.season_block(pbp, box, season_label(season), engine)
    if block:
        blocks[str(season)] = block
    # The sim (its own try: a failure leaves Points and Threes empty, never the game logs).
    # This season only: last season's starting point (2026-10-25) came off on
    # 2026-10-27 (the owner: "stop using last seasons data").
    try:
        out.update(compute_sim(season, sim.season_inputs(engine, box), block, book_odds or {}, list(games),
                               injuries or {}, roster_team, now_utc, lineups or {}, market_prev))
    except Exception as ex:
        print(f"WARNING: NBA game sim failed ({ex!r}).", file=sys.stderr)
    return out


SIM_BASE_N = 3000  # the same game without the dials, for "a normal night" (fewer games: a comparison only)


def compute_sim(season: int, inputs: dict, block: dict | None, book_odds: dict, games: list, injuries: dict,
                roster_team: dict, now_utc: datetime, lineups: dict | None = None, market_prev: dict | None = None) -> dict:
    """props.json `sim` ({game id: the game's 10,000 (sim.summary) + date,
    teams and `base`, the script shares without the dials}), `sim_plays`
    ({market: [play]}: tonight's plays, sim.pick_plays) and `sim_record`
    ({market: {ledger}}) for the next KOTC_SLATE_NIGHTS nights. lineups =
    {date: the NBA's lineups file} (First Basket's copies), for the starting
    fives. The plays are saved at tip-off in model_history/nba_props/sim_<season>.json.
    market_prev = the live data.json `market_watch`: a line taken before a
    20+ minute teammate was ruled Out that hasn't moved goes to `sim_held`
    (Waiting On Market, watch.held_by), not the plays."""
    if now_utc is None:
        return {}
    out_ids = {str(p["id"]) for team in injuries.values() for p in team if p["status"] == "Out"}
    # on the report but not Out: sits if he usually starts and isn't in the NBA's posted five (sim.game)
    hurt = {str(p["id"]) for team in injuries.values() for p in team if p["status"] not in ("Out", "Probable", "Available")}
    status = {str(p["id"]): p["status"] for team in injuries.values() for p in team}  # each one's chance to play (sim.PLAY_CHANCE)
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]
    names = {pid: p["name"] for pid, p in inputs["players"].items()}
    played = {str(pid): len(p["dates"]) for pid, p in inputs["players"].items()}
    sims = {}
    for g in games:
        if g["date"] not in dates:
            continue
        day = (lineups or {}).get(g["date"])
        run = sim.game(inputs, g["home"], g["away"], g["date"], out_ids, roster_team, seed=int(g["game_id"]) % (2 ** 31), lineups=day, hurt=hurt, status=status)
        row = sim.summary(run, names)
        base = row["scripts"]
        if run["home_dials"] or run["away_dials"]:
            plain = sim.game(inputs, g["home"], g["away"], g["date"], out_ids, roster_team, n=SIM_BASE_N, seed=1, dials=False, lineups=day, hurt=hurt, status=status)
            base = {k: round(float(m.mean()), 3) for k, m in sim.scripts(plain["margin"]).items() if k != "all"}
        sims[g["game_id"]] = {**row, "date": g["date"], "home": g["home"], "away": g["away"], "base": base,
                              "starters": {k: sorted(str(p) for p, st in zip(run[k]["s"]["pids"], run[k]["s"]["starter"]) if st)
                                           for k in ("home", "away")},
                              "out": {k: [str(p) for p in run["sat"][k]] for k in ("home", "away")},
                              "lineup": bool(sim.lineup_starters(day, g["home"], g["home"], g["away"],
                                                                 sim.team_now(inputs, g["home"], g["date"], roster_team)))}
        # start from the line (2026-10-28): each player's outcomes centered near his main line
        sim.nudge_to_line(sims[g["game_id"]], (book_odds.get(f"{g['away']}_{g['home']}") or {}).get("props") or {})

    path = PROPS_RECORD_DIR / f"sim_{season}.json"
    record = json.loads(path.read_text()) if path.exists() else {}
    started = {g["game_id"] for g in games if datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc}
    # waiting on the market (2026-10-28, Luka ruled out, Reaves' line still 23.5): who's Out with
    # 20+ minutes on tonight's untipped teams, and each untipped game's main lines, first-seen times kept
    now_iso = now_utc.strftime("%Y-%m-%dT%H:%MZ")
    open_games = [g for g in games if g["game_id"] in sims and g["game_id"] not in started]
    tonight_teams = {g[k] for g in open_games if g["date"] == today for k in ("home", "away")}
    outs = {}
    for team, rows in injuries.items():
        for p in rows:
            mins = (inputs["players"].get(int(p["id"])) or {}).get("min") or [] if str(p["id"]).isdigit() else []
            if team in tonight_teams and p["status"] == "Out" and mins and sum(mins) / len(mins) >= watch.STAR_MINUTES:
                outs[str(p["id"])] = team
    lines = {}
    for g in open_games:
        props_now = (book_odds.get(f"{g['away']}_{g['home']}") or {}).get("props") or {}
        for market in sim.STATS:
            for pid, v in (props_now.get(market) or {}).items():
                line = sim.middle_line((v or {}).get("q") or [])
                if line is not None:
                    lines[f"{g['game_id']}:{market}:{pid}"] = line
    mw = watch.market_watch(market_prev, outs, lines, now_iso)
    plays = {m: [] for m in sim.STATS}
    held = {m: [] for m in sim.STATS}
    changed = False
    for date in dates:
        tonight = [g for g in games if g["date"] == date and g["game_id"] in sims]
        for market in sim.STATS:
            locked = []
            for g in tonight:
                if g["game_id"] in started:
                    for r in (record.get(g["game_id"]) or {}).get(market) or []:
                        locked.append(locked_play(dict(zip(sim.PLAY_FIELDS, r)), g, market, sims[g["game_id"]]))
            cands = []
            for g in tonight:
                if g["game_id"] not in started:
                    props_now = (book_odds.get(f"{g['away']}_{g['home']}") or {}).get("props") or {}
                    for c in sim.game_candidates(g["game_id"], g, sims[g["game_id"]], props_now, played, market):
                        by = watch.held_by(mw, f"{g['game_id']}:{market}:{c['pid']}", c["team"], now_iso)
                        if by:  # not a play and not saved: the line hasn't caught up with the news
                            held[market].append({**c, "out": [names.get(int(b), b) for b in by]})
                        else:
                            cands.append(c)
            picked = sim.pick_plays(cands)
            plays[market] += locked + picked
            for g in tonight:
                if g["game_id"] in started:
                    continue
                rows = [[p[k] for k in sim.PLAY_FIELDS] for p in picked if p["game"] == g["game_id"]]
                saved = record.setdefault(g["game_id"], {"date": g["date"]})
                if saved.get(market, []) != rows:
                    saved[market] = rows
                    changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=1, sort_keys=True))
    logs = {m: {} for m in sim.STATS}
    if block:
        f = {k: i for i, k in enumerate(block.get("fields") or props.LOG_FIELDS)}
        for pid, p in block["players"].items():
            for r in p.get("log") or []:
                for market, stat in sim.STATS.items():  # the sim's stat = the log's field
                    if stat in f and r[f[stat]] is not None:
                        logs[market][(str(r[f["game"]]), pid)] = r[f[stat]]
    return {"sim": sims, "sim_plays": plays, "sim_held": held, "market_watch": mw,
            "sim_record": {m: {"ledger": sim.ledger(record, logs[m], m)} for m in sim.STATS},
            "sim_past": {m: past_plays(record, logs[m], m, today, block) for m in sim.STATS},
            "sim_meta": {"n": sim.N_SIMS, "script_margin": sim.SCRIPT_MARGIN, "min_edge": sim.MIN_EDGE, "line_nudge": sim.LINE_NUDGE,
                         "miss_pg": round(float(inputs["league"].get("miss_pg") or 0), 1),  # the Misses Coming tag's yardstick
                         "dials": {k: [label, own, opp] for k, (label, own, opp) in sim.DIAL_INFO.items()}}}


def past_plays(record: dict, logs: dict, market: str, today: str, block: dict | None) -> list:
    """props.json `sim_past` {market: [play]}: every saved play from the nights
    before today, as locked at tip, with `got` (his stat, None until the box
    score has the game) and `result` won / lost / push / sat / None (waiting),
    so the page's day arrows can step back and show how each one did (the
    owner, 2026-10-25: "I have no way to go back and see how anything performed")."""
    players = (block or {}).get("players") or {}
    f = {k: i for i, k in enumerate((block or {}).get("fields") or props.LOG_FIELDS)}
    rows = {}  # (game, player) -> his log row, for the opponent and home / road
    for pid, p in players.items():
        for r in p.get("log") or []:
            rows[(str(r[f["game"]]), pid)] = r
    boxed = {gid for gid, _ in logs}
    out = []
    for gid, g in record.items():
        if g.get("date", today) >= today:
            continue
        for row in g.get(market) or []:
            p = dict(zip(sim.PLAY_FIELDS, row))
            pid = str(p["pid"])
            got = logs.get((str(gid), pid))
            if got is not None:
                result = "push" if got == p["line"] else "won" if (got > p["line"]) == (p["side"] == "o") else "lost"
            else:
                result = "sat" if str(gid) in boxed else None
            log = rows.get((str(gid), pid))
            out.append({**p, "pid": pid, "game": str(gid), "date": g["date"], "stat": market,
                        "team": (players.get(pid) or {}).get("team"), "opp": log[f["opp"]] if log else None,
                        "home": bool(log[f["home"]]) if log else None, "got": got, "result": result, "locked": True,
                        "tier": "strong"})  # a 10-24 / 10-25 Top Play too (the owner, 2026-10-26: "just call everything STRONG")
    return sorted(out, key=lambda p: (p["date"], -p["edge"]))


def ungraded(sim_past: dict | None, today: str) -> int:
    """version.json nba.watch.ungraded: plays from the last two nights still
    waiting on the box score (older ones never press the timer again: a game
    the box scores never get can't keep a refresh running every hour)."""
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%d")
    return sum(1 for plays in (sim_past or {}).values() for p in plays if p.get("result") is None and p.get("date", "") >= since)


def locked_play(p: dict, g: dict, market: str, sim_game: dict) -> dict:
    """A play saved at tip-off, with what the page shows next to it."""
    row = sim_game["players"].get(str(p["pid"])) or {}
    side_key = row.get("team")
    team = g["home"] if side_key == "home" else g["away"]
    lad = (row.get(sim.STATS[market]) or {}).get("lad") or {}
    return {**p, "pid": str(p["pid"]), "game": g["game_id"], "date": g["date"], "stat": market, "team": team,
            "opp": g["away"] if team == g["home"] else g["home"], "med": ((row.get(sim.STATS[market]) or {}).get("med") or {}).get("all"),
            "scripts": {k: (round(sim.side_chance(lad[k], p["side"], p["line"]), 4) if k in lad else None) for k in ("away", "close", "home")},
            "locked": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    parser.add_argument("--cached", action="store_true", help="Reuse downloaded files (local testing)")
    parser.add_argument("--fast-odds", action="store_true", help="The injury refresh: only the sim's markets' odds fresh (Points / Threes / Rebounds / Assists), the rest from the live build")
    args = parser.parse_args()
    force = not args.cached
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    # Seconds each part took (data.json `timing`, version.json nba.timing): the
    # injury refresh (nba-refresh.yml) has minutes, not hours, to work in.
    timing, clock = {}, [time.time()]

    def lap(name):
        timing[name] = round(time.time() - clock[0], 1)
        clock[0] = time.time()
    POSITION_TABLE.update(positions.load())

    schedule = fetch_file("schedule", args.season, args.data_dir, force)
    if schedule is None:
        sys.exit(f"No schedule published for {args.season} yet.")
    rosters = fetch_file("rosters", args.season, args.data_dir, force)
    injuries = fetch_file("injuries", args.season, args.data_dir, force)

    home = schedule.drop_duplicates("home_abbreviation")
    teams = {
        r.home_abbreviation: {
            "name": r.home_display_name,
            "short": r.home_short_display_name,
            "mascot": r.home_name,
            "color": r.home_color,
            "alt_color": r.home_alternate_color,
            "logo": f"https://a.espncdn.com/i/teamlogos/nba/500/{r.home_abbreviation.lower()}.png",
            "id": int(r.home_id),
        }
        for r in home.itertuples(index=False)
        if r.home_abbreviation != "TBD"
    }
    abbr_by_id = {t["id"]: abbr for abbr, t in teams.items()}

    # This season's stats only (the owner, 2026-10-23: no last-season data on the site).
    stat_seasons = {}
    team_box = fetch_file("team_box", args.season, args.data_dir, force)
    player_box = fetch_file("player_box", args.season, args.data_dir, force)
    if team_box is not None and player_box is not None:
        block = stats_block(args.season, team_box, player_box, teams, None)
        if block:
            stat_seasons[args.season] = block
    if not stat_seasons:
        sys.exit("No box scores available for this season yet.")
    lap("files")
    stats_season = args.season
    shown = stat_seasons[stats_season]

    games = compute_schedule(schedule, now_utc)
    novig, novig_debug = fetch_novig_lines(games, teams)
    previous = fetch_previous()
    apply_lines(games, novig, previous, now_utc)
    lap("lines")
    book_odds, book_odds_debug = nba_book_odds(teams, rosters, games, previous, now_utc, fast=args.fast_odds)
    print(f"SmartStake NBA: {json.dumps(book_odds_debug)}")
    lap("smartstake")
    injury_list = live_injuries(abbr_by_id) or compute_injuries(injuries, abbr_by_id)
    lap("injuries")
    # The NBA's official report (a PDF every 15 minutes; it had Embiid Out 8 minutes before ESPN on 10-25)
    now_iso = now_utc.strftime("%Y-%m-%dT%H:%MZ")
    today = eastern(now_iso).strftime("%Y-%m-%d")
    tonight_teams = {g[k] for g in games if g["date"] == today and g.get("start_utc", "") > now_iso for k in ("home", "away")}
    report_pdf, report_url = None, None
    try:
        report_pdf, report_url = nba_report.fetch_latest(now_utc)
        report = nba_report.tonight(report_pdf, nba_report.players_of(shown), tonight_teams)
    except Exception as ex:
        print(f"WARNING: the NBA injury report wasn't read ({ex!r}).", file=sys.stderr)
        report = {}
    injury_list = add_report(injury_list, report, nba_report.slot_utc(report_url), nba_report.players_of(shown))
    lap("nba_report")
    injury_list = add_marked_out(injury_list, fetch_marked_out(eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")))

    blob = {
        "season": args.season,
        "season_label": f"{args.season - 1}-{str(args.season)[2:]}",
        "stats_season": stats_season,
        "stats_season_label": season_label(stats_season),
        "is_fallback_season": stats_season != args.season,
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%MZ"),
        "teams": teams,
        # The season the page opens on, plus every season for its buttons.
        "team_stats": shown["team_stats"],
        "recent_games": shown["recent_games"],
        "players": shown["players"],
        "stat_seasons": {str(s): b for s, b in stat_seasons.items()},
        "injuries": injury_list,
        "schedule": games,
        "novig_debug": novig_debug,
        "book_odds": book_odds,
        "book_odds_debug": book_odds_debug,
    }
    # A King of the Court failure must not take Game Previews down with it.
    try:
        blob["kotc"] = compute_kotc(args.season, args.data_dir, force, teams, rosters, injury_list, games, now_utc)
    except Exception as ex:
        print(f"WARNING: King of the Court failed ({ex!r}).", file=sys.stderr)
        blob["kotc"] = None
    lap("kotc")
    # Recent Games' closing line (Matchup Breakdown colors covers and overs), from the
    # lines King of the Court saves at tip; never blocks the build.
    try:
        add_recent_lines(shown["recent_games"], kotc_lines(args.season, games))
    except Exception as ex:
        print(f"WARNING: Recent Games lines failed ({ex!r}).", file=sys.stderr)
    # Nor may First Basket.
    try:
        blob["first_basket"] = compute_first_basket(args.season, args.data_dir, force, teams, rosters, injury_list, games, now_utc, book_odds)
    except Exception as ex:
        print(f"WARNING: First Basket failed ({ex!r}).", file=sys.stderr)
        blob["first_basket"] = None
    lap("first_basket")
    # Nor Team Identity.
    try:
        # First Basket has just downloaded this season's play-by-play: reuse it (a
        # fresh CI run has no older copy, so this is never stale there).
        blob["identity"] = compute_identity(args.season, args.data_dir, False)
    except Exception as ex:
        print(f"WARNING: Team Identity failed ({ex!r}).", file=sys.stderr)
        blob["identity"] = None
    lap("identity")
    # Player props (props.json, its own file: every player's game log is too
    # big for data.json). A failure leaves the file out; the pages say so.
    blob_props = {}
    try:
        blob_props = compute_props(args.season, args.data_dir, rosters, book_odds, games, injury_list, now_utc,
                                   (blob.get("first_basket") or {}).get("lineups"), (previous or {}).get("market_watch"))
        # build to build (data.json, read back by fetch_previous): when each Out and each line was first seen
        blob["market_watch"] = blob_props.pop("market_watch", None)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        (args.out.parent / "props.json").write_text(json.dumps(blob_props, separators=(",", ":")), encoding="utf-8")
    except Exception as ex:
        print(f"WARNING: NBA props failed ({ex!r}).", file=sys.stderr)
    lap("props_and_sim")
    # Shot charts (shots.json, its own file, read only when a card's Shot Chart
    # tab opens): THIS season's shots only (the owner, 2026-10-21).
    try:
        pbp = fetch_file("pbp", args.season, args.data_dir, False)
        block = shots.season_block(pbp, season_label(args.season), fetch_file("player_box", args.season, args.data_dir, False)) if pbp is not None else None
        # Zone Matchup Targets (zones.html): tonight's players' shot diets against the
        # defense they face; its own try so a failure never costs the shot charts.
        try:
            if block:
                block["matchups"] = zone_matchups.block(block, POSITION_TABLE, games, book_odds, today, now_iso)
                # the record: reads locked at tip, graded from the box scores (deploy bot commits model_history/)
                rec = zone_matchups.update_record(args.season, block["matchups"])
                logs = zone_matchups.box_logs(player_box)
                if block["matchups"]:
                    block["matchups"]["record"] = {m: {"ledger": zone_matchups.ledger(rec, logs[m], m)} for m in zone_matchups.MARKETS}
                    block["matchups"]["past"] = zone_matchups.past(rec, logs, block["matchups"]["date"])  # the day arrows
        except Exception as ex:
            print(f"WARNING: NBA zone matchups failed ({ex!r}).", file=sys.stderr)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        (args.out.parent / "shots.json").write_text(json.dumps({"season": args.season, **(block or {"label": season_label(args.season), "games": [], "players": {}, "league": []})}, separators=(",", ":")), encoding="utf-8")
    except Exception as ex:
        print(f"WARNING: NBA shots failed ({ex!r}).", file=sys.stderr)
    lap("shots")
    # What tonight's sims read about who plays: the Cloudflare timer compares it
    # with ESPN and the NBA every minute and starts nba-refresh.yml on a change.
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    blob["watch"] = watch.block(games, teams, sim.NBA_ABBR, today, now_utc.strftime("%Y-%m-%dT%H:%MZ"), LAST_INJURY_BODY.get("body"),
                                ((blob.get("first_basket") or {}).get("lineups") or {}).get(today))
    # the NBA report the sims read: the watch presses a refresh for a newer one, whose first step
    # (nba_report.py --changed) compares tonight's rows with `rep`
    blob["watch"].update(rep=nba_report.digest(report), rep_at=nba_report.slot_utc(report_url))
    # last night's plays still waiting on a box score: the box scores land about 7:35 am Eastern and
    # nothing else rebuilt the NBA until the injury news started (10-25's plays sat ungraded all
    # morning, 2026-10-26), so the timer presses a refresh while this is above 0
    blob["watch"]["ungraded"] = ungraded((blob_props or {}).get("sim_past"), today)
    # the odds again 10 / 25 / 40 minutes after a 20+ minute player is ruled Out, news or not (2026-10-28:
    # the refresh ran before the books moved, and nothing fetched the odds again)
    blob["watch"]["recheck"] = watch.recheck(blob.get("market_watch") or {}, now_utc.strftime("%Y-%m-%dT%H:%MZ"))
    blob["timing"] = timing
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # compact, like props.json, and the alt ladders in their own file: with every market's odds and
    # ladders the indented file reached 27.8 MB (2026-10-28) and Cloudflare Pages takes at most 25 MB
    # a file (ci_steps.py sizes)
    blob["book_odds"], ladders = split_ladders(blob.get("book_odds") or {})
    with open(args.out, "w") as f:
        json.dump(blob, f, separators=(",", ":"))
    (args.out.parent / "ladders.json").write_text(json.dumps(ladders, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.out} -- {args.season} schedule ({len(games)} games), stats from {stats_season}, lines for {novig_debug['matched']} games")


if __name__ == "__main__":
    main()
