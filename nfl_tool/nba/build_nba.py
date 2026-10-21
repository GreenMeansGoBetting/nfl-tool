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

Game Previews carries both seasons' stats (stat_seasons, the page's season
buttons): last season's with players moved onto this season's rosters, and
this season's once it has games. The page opens on this season once the
middle team has played THIS_SEASON_DEFAULT_AT games (stats_default).

Team keys are ESPN's abbreviations (NY, GS, SA, NO, UTAH, WSH ...).
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
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
import smartstake  # noqa: E402
import identity  # noqa: E402
import kotc  # noqa: E402
import positions  # noqa: E402

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


def stats_default(season: int, blocks: dict) -> int:
    """This season once the middle team has THIS_SEASON_DEFAULT_AT games, else last season."""
    this = blocks.get(season)
    return season if this and this["team_games"] >= THIS_SEASON_DEFAULT_AT else season - 1


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


def fetch_previous() -> dict | None:
    """The deployed nba/data.json (behind the member login; the build proves
    itself the same way build_stats.py does). None on any failure."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(LIVE_DATA_URL, headers=headers), timeout=20) as resp:
            return json.load(resp)
    except Exception as e:
        print(f"NOTE: no previous NBA data to carry lines from ({e}).", file=sys.stderr)
        return None


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
THIS_SEASON_DEFAULT_AT = 4  # team games played (median) before a page opens on this season
KOTC_RECORD_TOP = 30


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


def compute_kotc(season: int, data_dir: Path, force: bool, teams: dict, rosters, injuries: dict, games: list, now_utc: datetime) -> dict:
    """Both seasons' boards (the page's season toggle), the next few nights'
    slates projected from each, and the record of each night's board."""
    blocks = {}
    prev_box = fetch_file("player_box", season - 1, data_dir, False)
    if prev_box is not None:
        pg = kotc.player_games(prev_box, teams)
        blocks[season - 1] = kotc.season_block(pg, kotc_lines(season - 1, games), season_label(season - 1))
    cur_box = fetch_file("player_box", season, data_dir, force)
    if cur_box is not None:
        pg = kotc.player_games(cur_box, teams)
        if len(pg):
            prior = blocks[season - 1]["players"] if season - 1 in blocks else None
            blocks[season] = kotc.season_block(pg, kotc_lines(season, games), season_label(season), prior)

    roster_team = {}
    if rosters is not None:
        roster_team = {str(r.athlete_id): r.team_abbreviation for r in rosters.itertuples(index=False)}
    out_ids = {p["id"] for team in injuries.values() for p in team if p["status"] == "Out"}
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]

    slates = {}
    for s, block in blocks.items():
        # Last season's players sit on this season's roster; anyone not on one is gone.
        teams_now = {pid: roster_team.get(pid) for pid in block["players"]} if s != season and roster_team else roster_team
        slates[s] = kotc.slate(block, games, teams_now, out_ids, dates)

    default = season - 1
    if season in blocks:
        played = sorted(d["games"] for d in blocks[season]["defense"].values())
        if played and played[len(played) // 2] >= THIS_SEASON_DEFAULT_AT:
            default = season

    record = kotc_record(season, slates.get(default, {}), default, blocks.get(default), games, now_utc)
    for block in blocks.values():
        block.pop("_league", None)
    return {
        "default": str(default),
        "weights": kotc.WEIGHTS,
        "thresholds": list(kotc.THRESHOLDS),
        "seasons": {str(s): b for s, b in blocks.items()},
        "slates": {str(s): v for s, v in slates.items()},
        "record": record,
    }


def compute_identity(season: int, data_dir: Path, force: bool) -> dict:
    """Team Identity (identity.py): last season from its saved file (finished,
    so it never changes), this season from the engine on every build. The page
    opens on this season once the middle team has THIS_SEASON_DEFAULT_AT games."""
    blocks = {}
    saved = Path(str(identity.REFERENCE).format(season=season - 1))
    if saved.exists():
        blocks[season - 1] = json.loads(saved.read_text(encoding="utf-8"))
    pbp = fetch_file("pbp", season, data_dir, force)
    box = fetch_file("player_box", season, data_dir, force)
    if pbp is not None and box is not None:
        block = identity.season_block(pbp, box, season_label(season))
        if block:
            blocks[season] = block
    this = blocks.get(season)
    default = season if this and this["team_games"] >= THIS_SEASON_DEFAULT_AT else season - 1
    return {"default": str(default), "seasons": {str(s): b for s, b in blocks.items()}}


def compute_first_basket(season: int, data_dir: Path, force: bool, teams: dict, rosters, injuries: dict, games: list, now_utc: datetime,
                         book_odds: dict | None = None) -> dict:
    """First Basket: both seasons' numbers (the page's season buttons) and the
    next few nights' games (likely starters, jumpers, the fair-price guess)
    from each."""
    blocks = {}
    jumps = []  # this season's jump balls: the tip chance (NBA rule: this season decides)
    openings = {}  # this season's games' firsts: grades the Value record
    for s in (season - 1, season):
        fresh = force and s == season
        pbp = fetch_file("pbp", s, data_dir, fresh)
        box = fetch_file("player_box", s, data_dir, fresh)
        if pbp is not None and box is not None:
            block = first_basket.season_block(pbp, box, teams, season_label(s))
            if block["games"]:
                blocks[s] = block
            if s == season:
                jumps = first_basket.jump_balls(pbp, box)
                openings = {o["game_id"]: o for o in first_basket.game_openings(pbp, teams)}
    heights = {}
    if rosters is not None:
        heights = {str(r.athlete_id): h for r in rosters.itertuples(index=False) if (h := first_basket.inches(r.height))}
    tip = first_basket.tip_block(jumps, heights)
    roster_team = {}
    if rosters is not None:
        roster_team = {str(r.athlete_id): r.team_abbreviation for r in rosters.itertuples(index=False)}
    # Players sit on today's roster; last season's players not on one are gone.
    for s, block in blocks.items():
        if s != season and roster_team:
            block["players"] = {pid: {**p, "team": roster_team[pid]} for pid, p in block["players"].items() if pid in roster_team}
    out_ids = {p["id"] for team in injuries.values() for p in team if p["status"] == "Out"}
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]
    now = blocks[season]["players"] if season in blocks else {}  # the Fair: this season's starts only
    slates = {str(s): first_basket.slate(b, games, {}, out_ids, dates, tip, now) for s, b in blocks.items()}
    default = season if season in blocks and blocks[season]["games"] * 2 / max(1, len(teams)) >= THIS_SEASON_DEFAULT_AT else season - 1
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
    by_id = {g["game_id"]: g for g in games}
    changed = False
    for gid, game in slate.items():
        g = by_id.get(gid)
        if not g or g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
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
        for pid, (name, _, price, is_value, *_) in r["players"].items():
            if is_value and price is not None:
                hit = res["scorer"] == pid
                plays += 1
                won += hit
                total += first_basket.units(price, hit)
                value.append([pid, name, price, hit])
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


def nba_book_odds(teams: dict, rosters, games: list, previous: dict | None, now_utc: datetime) -> tuple:
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
                                          (previous or {}).get("book_odds"), now_utc.strftime("%Y-%m-%dT%H:%MZ"), keep)


def points_line(book_odds: dict, game: dict, pid: str):
    """The middle main points line across the books for one player, or None."""
    row = (((book_odds.get(f"{game['away']}_{game['home']}") or {}).get("props") or {}).get("points") or {}).get(pid)
    ls = sorted(q[2] for q in (row or {}).get("q", []) if q[2] is not None)
    return ls[len(ls) // 2] if ls else None


def props_lines_record(season: int, slate: dict, games: list, now_utc: datetime) -> dict:
    """model_history/nba_props/lines_<season>.json: {game id: {player id:
    [line, projection, our number, weight on ours]}} as the last build before
    tip-off had them (a started game is never rewritten): the line history,
    and what the projection is graded against."""
    path = PROPS_RECORD_DIR / f"lines_{season}.json"
    record = json.loads(path.read_text()) if path.exists() else {}
    changed = False
    for g in games:
        if datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        rows = {pid: [r["line"], r["proj"], r["ours"], r["w"]] for pid, r in (slate.get(g["game_id"]) or {}).items() if r["line"] is not None}
        if rows and record.get(g["game_id"]) != rows:
            record[g["game_id"]] = rows
            changed = True
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, indent=1, sort_keys=True))
    return record


def compute_props(season: int, data_dir: Path, rosters, book_odds=None, games=(), identity_blob=None,
                  injuries=None, now_utc=None) -> dict:
    """site/nba/props.json (props.py): last season from its saved file on
    today's rosters, this season from the engine; `default` this season once
    the middle team has THIS_SEASON_DEFAULT_AT games; `slate` = the next few
    nights' points projections (props.project_points), this season only."""
    roster_team = {}
    if rosters is not None:
        roster_team = {str(r.athlete_id): r.team_abbreviation for r in rosters.itertuples(index=False)}
    blocks = {}
    saved = Path(str(props.REFERENCE).format(season=season - 1))
    if saved.exists():
        block = json.loads(saved.read_text(encoding="utf-8"))
        for pid, p in block["players"].items():  # saved with ESPN's G / F / C
            p["pos"] = POSITION_TABLE.get(pid) or kotc.POS_GROUP.get(p.get("pos"), p.get("pos"))
        blocks[season - 1] = props.on_rosters(block, roster_team) if roster_team else block
    # First Basket has just downloaded this season's files (see compute_identity).
    pbp = fetch_file("pbp", season, data_dir, False)
    box = fetch_file("player_box", season, data_dir, False)
    if pbp is not None and box is not None:
        block = props.season_block(pbp, box, season_label(season))
        if block:
            blocks[season] = block
    this = blocks.get(season)
    team_games = 0
    if this:
        per_team = {}
        for p in this["players"].values():
            per_team.setdefault(p["team"], set()).update(row[1] for row in p["log"])
        counts = sorted(len(v) for v in per_team.values())
        team_games = counts[len(counts) // 2] if counts else 0
    default = season if team_games >= THIS_SEASON_DEFAULT_AT else season - 1
    return {"default": str(default), "seasons": {str(s): b for s, b in blocks.items()},
            "slate": points_slate(season, this, book_odds or {}, list(games), identity_blob, injuries or {}, roster_team, now_utc),
            "proj": {"k": props.PROJ_K, "max": props.PROJ_MAX, "last": props.PROJ_LAST}}


def points_slate(season, this, book_odds, games, identity_blob, injuries, roster_team, now_utc) -> dict:
    """{game id: {player id: {line, proj, w, ours, min, ppm, games, out}}} for
    every player with a books' points line in the next KOTC_SLATE_NIGHTS
    nights. Our number is this season's only; no games = the line."""
    if now_utc is None:
        return {}
    ident = ((identity_blob or {}).get("seasons") or {}).get(str(season)) or {}
    out_ids = {p["id"] for team in injuries.values() for p in team if p["status"] == "Out"}
    today = eastern(now_utc.strftime("%Y-%m-%dT%H:%MZ")).strftime("%Y-%m-%d")
    dates = sorted({g["date"] for g in games if g["date"] >= today})[:KOTC_SLATE_NIGHTS]
    players = (this or {}).get("players") or {}
    fields = (this or {}).get("fields") or props.LOG_FIELDS
    rnd = lambda v, d=1: None if v is None else round(v, d)  # noqa: E731
    # each player's season shot share of his team (for teammates listed Out),
    # rotation players only (20+ minutes a game)
    # (a team-game is its game + opponent: a traded player's old games stay with his old team)
    i_fga, i_game, i_min, i_opp = fields.index("fga"), fields.index("game"), fields.index("min"), fields.index("opp")
    team_fga = {}
    for p in players.values():
        for r in p["log"]:
            team_fga[(r[i_game], r[i_opp])] = team_fga.get((r[i_game], r[i_opp]), 0) + r[i_fga]
    shot_share = {}
    for pid, p in players.items():
        tf = sum(team_fga.get((r[i_game], r[i_opp]), 0) for r in p["log"])
        if p["log"] and tf and sum(r[i_min] for r in p["log"]) / len(p["log"]) >= 20:
            shot_share[pid] = sum(r[i_fga] for r in p["log"]) / tf
    out_by_team = {}
    for pid in out_ids:
        team = roster_team.get(pid) or (players.get(pid) or {}).get("team")
        if team and pid in shot_share:
            out_by_team[team] = out_by_team.get(team, 0.0) + shot_share[pid]
    slate = {}
    for g in games:
        if g["date"] not in dates:
            continue
        priced = ((book_odds.get(f"{g['away']}_{g['home']}") or {}).get("props") or {}).get("points") or {}
        rows = {}
        for pid in priced:
            team = roster_team.get(pid) or (players.get(pid) or {}).get("team")
            opp = g["home"] if team == g["away"] else g["away"]
            log = (players.get(pid) or {}).get("log") or []
            teams_now = ident.get("teams") or {}
            missing = out_by_team.get(team, 0.0) - (shot_share.get(pid, 0.0) if pid in out_ids else 0.0)
            ours, minutes, ppm = props.our_points(log, fields, teams_now.get(team), teams_now.get(opp), ident.get("league"), missing)
            line = points_line(book_odds, g, pid)
            proj, w = props.project_points(line, len(log), ours)
            rows[pid] = {"line": line, "proj": rnd(proj), "w": round(w, 3), "ours": rnd(ours), "min": rnd(minutes),
                         "ppm": rnd(ppm, 3), "games": len(log), "out": pid in out_ids, "missing": rnd(missing, 3)}
        if rows:
            slate[g["game_id"]] = rows
    return slate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    parser.add_argument("--cached", action="store_true", help="Reuse downloaded files (local testing)")
    args = parser.parse_args()
    force = not args.cached
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
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

    # Both seasons' stats (the page's season buttons); last season's players on today's rosters.
    stat_seasons = {}
    for s in (args.season - 1, args.season):
        fresh = force and s == args.season
        team_box = fetch_file("team_box", s, args.data_dir, fresh)
        player_box = fetch_file("player_box", s, args.data_dir, fresh)
        if team_box is not None and player_box is not None:
            block = stats_block(s, team_box, player_box, teams, rosters if s != args.season else None)
            if block:
                stat_seasons[s] = block
    if not stat_seasons:
        sys.exit("No box scores available for this or last season.")
    stats_season = stats_default(args.season, stat_seasons)
    if stats_season not in stat_seasons:
        stats_season = max(stat_seasons)
    shown = stat_seasons[stats_season]

    games = compute_schedule(schedule, now_utc)
    novig, novig_debug = fetch_novig_lines(games, teams)
    previous = fetch_previous()
    apply_lines(games, novig, previous, now_utc)
    book_odds, book_odds_debug = nba_book_odds(teams, rosters, games, previous, now_utc)
    print(f"SmartStake NBA: {json.dumps(book_odds_debug)}")
    injury_list = compute_injuries(injuries, abbr_by_id)

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
    # Nor may First Basket.
    try:
        blob["first_basket"] = compute_first_basket(args.season, args.data_dir, force, teams, rosters, injury_list, games, now_utc, book_odds)
    except Exception as ex:
        print(f"WARNING: First Basket failed ({ex!r}).", file=sys.stderr)
        blob["first_basket"] = None
    # Nor Team Identity.
    try:
        # First Basket has just downloaded this season's play-by-play: reuse it (a
        # fresh CI run has no older copy, so this is never stale there).
        blob["identity"] = compute_identity(args.season, args.data_dir, False)
    except Exception as ex:
        print(f"WARNING: Team Identity failed ({ex!r}).", file=sys.stderr)
        blob["identity"] = None
    # Player props (props.json, its own file: every player's game log is too
    # big for data.json). A failure leaves the file out; the pages say so.
    try:
        blob_props = compute_props(args.season, args.data_dir, rosters, book_odds, games, blob.get("identity"), injury_list, now_utc)
        props_lines_record(args.season, blob_props["slate"], games, now_utc)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        (args.out.parent / "props.json").write_text(json.dumps(blob_props, separators=(",", ":")), encoding="utf-8")
    except Exception as ex:
        print(f"WARNING: NBA props failed ({ex!r}).", file=sys.stderr)
    # Shot charts (shots.json, its own file, read only when a card's Shot Chart
    # tab opens): THIS season's shots only (the owner, 2026-10-21).
    try:
        pbp = fetch_file("pbp", args.season, args.data_dir, False)
        block = shots.season_block(pbp, season_label(args.season), fetch_file("player_box", args.season, args.data_dir, False)) if pbp is not None else None
        args.out.parent.mkdir(parents=True, exist_ok=True)
        (args.out.parent / "shots.json").write_text(json.dumps({"season": args.season, **(block or {"label": season_label(args.season), "games": [], "players": {}, "league": []})}, separators=(",", ":")), encoding="utf-8")
    except Exception as ex:
        print(f"WARNING: NBA shots failed ({ex!r}).", file=sys.stderr)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    print(f"Wrote {args.out} -- {args.season} schedule ({len(games)} games), stats from {stats_season}, lines for {novig_debug['matched']} games")


if __name__ == "__main__":
    main()
