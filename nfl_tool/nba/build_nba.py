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
import first_basket  # noqa: E402
import kotc  # noqa: E402

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
LINE_FIELDS = (
    "away_team_spread", "home_team_spread", "away_spread_odds", "home_spread_odds", "total_line",
    "over_odds", "under_odds", "away_moneyline", "home_moneyline", "away_ml_implied_prob", "home_ml_implied_prob",
)


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
    return pd.read_parquet(path)


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
            "position": clean(r.athlete_position),
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


def compute_first_basket(season: int, data_dir: Path, force: bool, teams: dict, rosters, injuries: dict, games: list, now_utc: datetime) -> dict:
    """First Basket: both seasons' numbers (the page's season buttons) and the
    next few nights' games (likely starters, jumpers, the fair-price guess)
    from each."""
    blocks = {}
    for s in (season - 1, season):
        fresh = force and s == season
        pbp = fetch_file("pbp", s, data_dir, fresh)
        box = fetch_file("player_box", s, data_dir, fresh)
        if pbp is not None and box is not None:
            block = first_basket.season_block(pbp, box, teams, season_label(s))
            if block["games"]:
                blocks[s] = block
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
    slates = {str(s): first_basket.slate(b, games, {}, out_ids, dates) for s, b in blocks.items()}
    default = season if season in blocks and blocks[season]["games"] * 2 / max(1, len(teams)) >= THIS_SEASON_DEFAULT_AT else season - 1
    # Every rostered player (the page matches the NBA's lineup names to these),
    # and the NBA's lineup files as of this build: the page reads them live
    # (/api/nba-lineups) and falls back to these copies.
    roster = {}
    if rosters is not None:
        for r in rosters.itertuples(index=False):
            roster[str(r.athlete_id)] = [r.display_name, r.team_abbreviation, first_basket.POS_GROUP.get(r.position_abbreviation, "F")]
    lineups = {}
    for d in dates:
        got = fetch_nba_lineups(d)
        if got is not None:
            lineups[d] = got
    return {
        "default": str(default), "seasons": {str(s): b for s, b in blocks.items()}, "slates": slates,
        "roster": roster, "lineups": lineups, "fair_weights": first_basket.fair_weights(),
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    parser.add_argument("--cached", action="store_true", help="Reuse downloaded files (local testing)")
    args = parser.parse_args()
    force = not args.cached
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

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
    apply_lines(games, novig, fetch_previous(), now_utc)
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
    }
    # A King of the Court failure must not take Game Previews down with it.
    try:
        blob["kotc"] = compute_kotc(args.season, args.data_dir, force, teams, rosters, injury_list, games, now_utc)
    except Exception as ex:
        print(f"WARNING: King of the Court failed ({ex!r}).", file=sys.stderr)
        blob["kotc"] = None
    # Nor may First Basket.
    try:
        blob["first_basket"] = compute_first_basket(args.season, args.data_dir, force, teams, rosters, injury_list, games, now_utc)
    except Exception as ex:
        print(f"WARNING: First Basket failed ({ex!r}).", file=sys.stderr)
        blob["first_basket"] = None
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    print(f"Wrote {args.out} -- {args.season} schedule ({len(games)} games), stats from {stats_season}, lines for {novig_debug['matched']} games")


if __name__ == "__main__":
    main()
