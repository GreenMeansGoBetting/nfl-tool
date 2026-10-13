"""GMG NHL Suite data build -> nfl_tool/site/nhl/data.json.

The NHL twin of nba/build_nba.py, started 2026-10-13. Sources (all free, no key):
  * The NHL's own public feed (api-web.nhle.com and api.nhle.com/stats/rest):
    schedule, standings, every finished game's play-by-play (each shot with
    its spot on the ice) and box score, and the league's season reports for
    power play, penalty kill and ice time.
  * ESPN -- injuries.
  * Novig -- game lines, the same public feed the NFL and NBA builds read
    (league=NHL), pregame numbers only.

Hockey has no ready-made season files (nothing like nflverse or hoopR), so
finished games are downloaded one at a time and kept in --data-dir
(games/<season>/<id>.json.gz). A build only downloads the games it doesn't
have yet; the deploy keeps that folder between runs.

Last season's numbers come from a small saved file next to this script
(prior_<season>.json.gz, written once with --write-prior), so the page can
show them while this season's sample is small without downloading 1,300
games on every cold start.

Seasons are named by the year they END, like the NBA build (2027 = 2026-27).
Team keys are the NHL's own abbreviations (TBL, NJD, SJS, LAK, UTA ...).
"""
import argparse
import gzip
import hashlib
import hmac
import json
import os
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://api-web.nhle.com/v1"
REST = "https://api.nhle.com/stats/rest/en"
ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
REGULAR_SEASON = 2  # the NHL's gameType
FINISHED_STATES = (6, 7)  # the season list's gameStateId: FINAL, OFF (official)
SCHEDULE_DAYS_AHEAD = 14
RECENT_GAMES = 10
FORWARDS_SHOWN = 12
DEFENSE_SHOWN = 6
# Until the middle team has played this many games, the page opens on last
# season's numbers (a handful of games can be one hot goalie).
MIN_GAMES_FOR_CURRENT = 10
FETCH_WORKERS = 6
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nhl/1.0)"
PRIOR_DIR = Path(__file__).parent

NOVIG_EVENTS_URL = "https://api.novig.us/v3/public/catalog/events?league=NHL"
NOVIG_GRAPHQL_URL = "https://api.novig.us/v1/graphql"
NOVIG_QUERY_PATH = Path(__file__).parent.parent / "novig_event_markets.graphql"
# Same market filter the NFL and NBA builds send (build_stats.py NOVIG_MARKET_FILTER).
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
LIVE_DATA_URL = "https://nfl.gmgsports.org/nhl/data.json"
LINE_FIELDS = (
    "away_team_spread", "home_team_spread", "away_spread_odds", "home_spread_odds", "total_line",
    "over_odds", "under_odds", "away_moneyline", "home_moneyline", "away_ml_implied_prob", "home_ml_implied_prob",
)

# Banner colors (ESPN's team colors, read 2026-10-13). Teams whose main color
# is black or near it use their second color, so the tint shows on a dark page.
TEAM_COLORS = {
    "ANA": "fc4c02", "BOS": "fdb71a", "BUF": "00468b", "CGY": "dd1a32", "CAR": "e30426", "CHI": "e31937", "COL": "860038",
    "CBJ": "002d62", "DAL": "20864c", "DET": "e30526", "EDM": "ff4c00", "FLA": "e51937", "LAK": "a2aaad", "MIN": "124734",
    "MTL": "c41230", "NSH": "fdba31", "NJD": "e30b2b", "NYI": "00529b", "NYR": "0056ae", "OTT": "dd1a32", "PHI": "fe5823",
    "PIT": "fdb71a", "SJS": "00788a", "SEA": "a3dce4", "STL": "0070b9", "TBL": "003e7e", "TOR": "003e7e", "UTA": "7ab2e1",
    "VAN": "008752", "VGK": "b4975a", "WSH": "d71830", "WPG": "002d62",
}

# ---- the rink ----
# Shot spots are in feet from center ice: x runs the length of the rink (the
# goal lines are at +/-89, the blue lines at +/-25), y the width (+/-42.5).
# normalize_xy turns every shot so the net being attacked is at x = +89 and
# the shooter's left is +y. The areas, from the net out:
#   low_slot  the box right in front of the net (to the faceoff dots, 9 ft
#             either side of center) -- the "high danger" area
#   slot      the rest of the "home plate": from the posts out to the faceoff
#             dots, then straight up to the top of the circles
#   left / right  beside the home plate, below the top of the circles
#             (the circles' outer halves, the boards, behind the goal line)
#   point     from the top of the circles back to the blue line
#   long      outside the offensive zone
AREAS = ("low_slot", "slot", "left", "right", "point", "long")
GOAL_LINE_X = 89
BLUE_LINE_X = 25
CIRCLE_TOP_X = 54
DOT_X = 69
DOT_Y = 22
POST_Y = 3.5
LOW_SLOT_Y = 9
SHOT_EVENTS = ("goal", "shot-on-goal", "missed-shot", "blocked-shot")


def shot_area(x: float, y: float) -> str:
    side = "left" if y > 0 else "right"
    if x < BLUE_LINE_X:
        return "long"
    if x > GOAL_LINE_X:
        return side
    if x >= DOT_X and abs(y) <= LOW_SLOT_Y:
        return "low_slot"
    if x >= CIRCLE_TOP_X:
        half_width = DOT_Y if x <= DOT_X else POST_Y + (GOAL_LINE_X - x) * (DOT_Y - POST_Y) / (GOAL_LINE_X - DOT_X)
        return "slot" if abs(y) <= half_width else side
    return "point"


def strength(code: str | None, is_home: bool) -> str:
    """The shooting team's manpower from the feed's situationCode, four
    digits: away goalie, away skaters, home skaters, home goalie ("1551" =
    five a side, both goalies in). 5v5 / ev (4v4, 3v3) / pp / sh / en
    (shooting at an empty net) / extra (own goalie pulled) / ps (penalty shot)."""
    if not code or len(code) != 4 or not code.isdigit():
        return "5v5"
    away_goalie, away_skaters, home_skaters, home_goalie = (int(c) for c in code)
    own, opp = (home_skaters, away_skaters) if is_home else (away_skaters, home_skaters)
    own_goalie, opp_goalie = (home_goalie, away_goalie) if is_home else (away_goalie, home_goalie)
    if {own, opp} == {0, 1}:
        return "ps"
    if not opp_goalie:
        return "en"
    if not own_goalie:
        return "extra"
    if own == opp:
        return "5v5" if own == 5 else "ev"
    return "pp" if own > opp else "sh"


def attack_directions(plays: list, team_of: dict, home_id: int) -> dict:
    """{(period, team id): +1 or -1}: +1 when that team shoots toward +x in
    that period. The feed says which end the home team defends; a period
    without it is read from where the team's own shots were taken (nearly all
    shots come from the attacking half)."""
    out, votes = {}, {}
    for p in plays:
        d = p.get("details") or {}
        period = (p.get("periodDescriptor") or {}).get("number")
        side = p.get("homeTeamDefendingSide")
        if side in ("left", "right"):
            for team in set(team_of.values()):
                out.setdefault((period, team), (1 if side == "left" else -1) * (1 if team == home_id else -1))
        if p.get("typeDescKey") in ("goal", "shot-on-goal", "missed-shot") and d.get("xCoord"):
            team = d.get("eventOwnerTeamId")
            votes.setdefault((period, team), []).append(1 if d["xCoord"] > 0 else -1)
    for key, signs in votes.items():
        if key not in out and len(signs) >= 3:
            out[key] = 1 if sum(signs) > 0 else -1
    return out


def normalize_xy(details: dict, direction: int | None):
    """(x, y) with the attacked net at x = +89 and the shooter's left at +y,
    or None when the feed has no spot for the play."""
    x, y = details.get("xCoord"), details.get("yCoord")
    if x is None or y is None or direction is None:
        return None
    return (x, y) if direction > 0 else (-x, -y)


def clock_seconds(text: str | None) -> int:
    if not text or ":" not in text:
        return 0
    minutes, seconds = text.split(":")[:2]
    return int(minutes) * 60 + int(seconds)


def person_name(spot: dict) -> str:
    return f"{(spot.get('firstName') or {}).get('default', '')} {(spot.get('lastName') or {}).get('default', '')}".strip()


# ---- one game ----
def reduce_game(raw: dict) -> dict:
    """One finished game's play-by-play and box score boiled down to what the
    season totals need: each team's counts (goals, shots, attempts, where the
    shots came from), and each skater's and goalie's line. Shootouts are left
    out of everything except the final score."""
    pbp, box = raw["pbp"], raw["box"]
    home, away = pbp["homeTeam"], pbp["awayTeam"]
    abbr = {home["id"]: home["abbrev"], away["id"]: away["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    spots = {r["playerId"]: r for r in pbp.get("rosterSpots") or []}
    directions = attack_directions(pbp.get("plays") or [], team_of, home["id"])
    teams = {home["abbrev"]: Counter(), away["abbrev"]: Counter()}
    skater_extra, goalie_extra = {}, {}

    for p in pbp.get("plays") or []:
        kind = p.get("typeDescKey")
        d = p.get("details") or {}
        period = p.get("periodDescriptor") or {}
        if period.get("periodType") == "SO":
            continue
        owner = d.get("eventOwnerTeamId")
        if kind in SHOT_EVENTS:
            shooter = d.get("scoringPlayerId") or d.get("shootingPlayerId")
            team_id = team_of.get(shooter, owner)
            if team_id not in abbr:
                continue
            t = teams[abbr[team_id]]
            man = strength(p.get("situationCode"), team_id == home["id"])
            even = man == "5v5"
            mine = skater_extra.setdefault(shooter, Counter())
            t["att"] += 1
            t["att_5v5"] += even
            mine["att"] += 1
            if kind == "blocked-shot":
                teams[abbr[away["id"] if team_id == home["id"] else home["id"]]]["blk"] += 1
                continue
            t["unb"] += 1
            t["unb_5v5"] += even
            on_goal = kind in ("goal", "shot-on-goal")
            if on_goal:
                t["sog"] += 1
                t["sog_5v5"] += even
            if kind == "goal":
                t["g"] += 1
                t[f"g_{man}"] += 1
                if man == "pp":
                    for key in ("scoringPlayerId", "assist1PlayerId", "assist2PlayerId"):
                        if d.get(key):
                            skater_extra.setdefault(d[key], Counter())["ppp"] += 1
            if man in ("en", "ps"):
                continue  # no goalie to beat, or a penalty shot: not part of where a team shoots from
            spot = normalize_xy(d, directions.get((period.get("number"), team_id)))
            if spot is None:
                continue
            area = shot_area(*spot)
            t[f"a_{area}"] += 1
            t[f"ag_{area}"] += kind == "goal"
            mine[f"a_{area}"] += 1
            goalie = d.get("goalieInNetId")
            if on_goal and goalie and area == "low_slot":
                faced = goalie_extra.setdefault(goalie, Counter())
                faced["hd_sa"] += 1
                faced["hd_ga"] += kind == "goal"
        elif owner in abbr:
            t = teams[abbr[owner]]
            if kind == "hit":
                t["hits"] += 1
            elif kind == "giveaway":
                t["give"] += 1
            elif kind == "takeaway":
                t["take"] += 1
            elif kind == "faceoff":
                t["fo_won"] += 1
                for team in teams.values():
                    team["fo"] += 1
            elif kind == "penalty":
                t["pim"] += d.get("duration") or 0

    skaters, goalies = {}, {}
    for side in ("homeTeam", "awayTeam"):
        team = box[side]["abbrev"]
        stats = (box.get("playerByGameStats") or {}).get(side) or {}
        for group in ("forwards", "defense"):
            for s in stats.get(group) or []:
                pid = s["playerId"]
                extra = skater_extra.get(pid, {})
                spot = spots.get(pid, {})
                skaters[str(pid)] = {
                    "team": team, "name": person_name(spot) or s["name"]["default"], "pos": "D" if group == "defense" else s.get("position") or "F",
                    "headshot": spot.get("headshot"), "toi": clock_seconds(s.get("toi")), "g": s.get("goals", 0), "a": s.get("assists", 0),
                    "sog": s.get("sog", 0), "hits": s.get("hits", 0), "blk": s.get("blockedShots", 0), "att": extra.get("att", 0),
                    "hd": extra.get("a_low_slot", 0), "ppp": extra.get("ppp", 0),
                }
        for s in stats.get("goalies") or []:
            toi = clock_seconds(s.get("toi"))
            if not toi:
                continue  # dressed, didn't play
            pid = s["playerId"]
            extra = goalie_extra.get(pid, {})
            spot = spots.get(pid, {})
            goalies[str(pid)] = {
                "team": team, "name": person_name(spot) or s["name"]["default"], "headshot": spot.get("headshot"), "toi": toi,
                "sa": s.get("shotsAgainst", 0), "ga": s.get("goalsAgainst", 0), "start": bool(s.get("starter")), "dec": s.get("decision"),
                "hd_sa": extra.get("hd_sa", 0), "hd_ga": extra.get("hd_ga", 0),
            }
    return {
        "id": pbp["id"],
        "date": pbp["gameDate"],
        "home": home["abbrev"],
        "away": away["abbrev"],
        "score": {home["abbrev"]: box["homeTeam"].get("score", 0), away["abbrev"]: box["awayTeam"].get("score", 0)},
        "ended": (pbp.get("gameOutcome") or {}).get("lastPeriodType") or "REG",
        "teams": {k: dict(v) for k, v in teams.items()},
        "skaters": skaters,
        "goalies": goalies,
    }


# ---- downloading ----
def _request(url: str, body: dict | None = None, headers: dict | None = None, tries: int = 3):
    data = json.dumps(body).encode() if body is not None else None
    head = {"accept": "*/*", "User-Agent": USER_AGENT, **(headers or {})}
    if data is not None:
        head["content-type"] = "application/json"
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=head), timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 * (attempt + 1))


def game_path(data_dir: Path, season: int, game_id: int) -> Path:
    return data_dir / "games" / str(season) / f"{game_id}.json.gz"


def load_game(game_id: int, season: int, data_dir: Path) -> tuple:
    """(raw game, downloaded?). A game is kept on disk once the league marks
    it official ("OFF": the scorers' corrections are in); until then it is
    downloaded again on the next build."""
    path = game_path(data_dir, season, game_id)
    if path.exists():
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                return json.load(f), False
        except (OSError, ValueError):
            path.unlink()  # a half-written file: fetch it again
    raw = {"pbp": _request(f"{API}/gamecenter/{game_id}/play-by-play"), "box": _request(f"{API}/gamecenter/{game_id}/boxscore")}
    if raw["pbp"].get("gameState") == "OFF":
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump(raw, f, separators=(",", ":"))
        tmp.replace(path)
    return raw, True


def load_games(game_ids: list, season: int, data_dir: Path) -> tuple:
    """(reduced games in date order, debug). A game that can't be read is
    left out and counted; the build goes on with the rest."""
    debug = {"games_wanted": len(game_ids), "games_loaded": 0, "games_downloaded": 0, "errors": []}

    def one(game_id):
        try:
            raw, downloaded = load_game(game_id, season, data_dir)
            if raw["pbp"].get("gameState") not in ("FINAL", "OFF"):
                return None, downloaded, None
            return reduce_game(raw), downloaded, None
        except Exception as e:  # network or an odd game: skip it, keep building
            return None, False, f"{game_id}: {e}"

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        results = list(pool.map(one, game_ids))
    records = []
    for record, downloaded, error in results:
        debug["games_downloaded"] += downloaded
        if record:
            records.append(record)
        if error and len(debug["errors"]) < 5:
            debug["errors"].append(error)
    debug["games_loaded"] = len(records)
    records.sort(key=lambda r: (r["date"], r["id"]))
    return records, debug


def season_id(season: int) -> str:
    return f"{season - 1}{season}"


def fetch_report(report: str, season: int, key: str = "teamId") -> dict:
    """One of the league's season reports as {team or player id: row}; {} if it can't be read."""
    try:
        url = f"{REST}/{report}?limit=-1&cayenneExp=seasonId={season_id(season)}%20and%20gameTypeId={REGULAR_SEASON}"
        return {row[key]: row for row in _request(url).get("data") or []}
    except Exception as e:
        print(f"WARNING: NHL report {report} failed ({e}).", file=sys.stderr)
        return {}


# ---- season totals ----
def num(value, digits=2):
    return None if value is None else round(float(value), digits)


def ratio(a, b, digits=4):
    return round(a / b, digits) if b else None


def record_text(wins, losses, ot_losses):
    return f"{wins}-{losses}-{ot_losses}"


def compute_team_stats(records: list, standings: dict, reports: dict, team_ids: dict) -> dict:
    """Season totals turned into rates. Every stat has the offense's number
    (off_*) and the matching number the defense allows (def_*), so matchups
    can read both sides. Goals and shots leave out shootouts; the "where
    shots come from" areas also leave out empty-net shots and blocked shots
    (a blocked shot is logged where it was blocked, not where it was taken)."""
    own, opp, games = {}, {}, Counter()
    for r in records:
        for team, other in ((r["home"], r["away"]), (r["away"], r["home"])):
            own.setdefault(team, Counter()).update(r["teams"][team])
            opp.setdefault(team, Counter()).update(r["teams"][other])
            games[team] += 1
    out = {}
    for team, gp in games.items():
        f, a = own[team], opp[team]
        stats = {"games_played": gp}
        for side, c in (("off", f), ("def", a)):
            stats[f"{side}_gpg"] = num(c["g"] / gp)
            stats[f"{side}_sog_pg"] = num(c["sog"] / gp, 1)
            stats[f"{side}_att_pg"] = num(c["att_5v5"] / gp, 1)
            stats[f"{side}_hd_pg"] = num(c["a_low_slot"] / gp)
            stats[f"{side}_sh_pct"] = ratio(c["g_5v5"], c["sog_5v5"])
            located = sum(c[f"a_{area}"] for area in AREAS)
            for area in AREAS:
                stats[f"{side}_{area}_pg"] = num(c[f"a_{area}"] / gp)
                stats[f"{side}_{area}_share"] = ratio(c[f"a_{area}"], located)
                stats[f"{side}_{area}_g"] = c[f"ag_{area}"]
        stats["att_share"] = ratio(f["att_5v5"], f["att_5v5"] + a["att_5v5"])
        stats["hd_share"] = ratio(f["a_low_slot"], f["a_low_slot"] + a["a_low_slot"])
        stats["goal_diff_pg"] = num((f["g"] - a["g"]) / gp)
        stats["fo_pct"] = ratio(f["fo_won"], f["fo"])
        stats["hits_pg"] = num(f["hits"] / gp, 1)
        stats["pim_pg"] = num(f["pim"] / gp, 1)
        team_id = team_ids.get(team)
        pp, pk = reports.get("powerplay", {}).get(team_id), reports.get("penaltykill", {}).get(team_id)
        stats["off_pp_pct"] = num(pp["powerPlayPct"], 4) if pp else None
        stats["off_pp_opp_pg"] = num(pp["ppOpportunitiesPerGame"]) if pp else None
        # What the penalty kill allows is the other side of a power play row.
        stats["def_pp_pct"] = num(1 - pk["penaltyKillPct"], 4) if pk and pk.get("penaltyKillPct") is not None else None
        stats["def_pp_opp_pg"] = num(pk["timesShorthandedPerGame"]) if pk else None
        stats["pk_pct"] = num(pk["penaltyKillPct"], 4) if pk else None
        s = standings.get(team)
        if s:
            stats.update({
                "wins": s["wins"], "losses": s["losses"], "ot_losses": s["otLosses"], "points": s["points"],
                "home_record": record_text(s["homeWins"], s["homeLosses"], s["homeOtLosses"]),
                "away_record": record_text(s["roadWins"], s["roadLosses"], s["roadOtLosses"]),
                "last10": record_text(s["l10Wins"], s["l10Losses"], s["l10OtLosses"]),
                "streak": f"{s.get('streakCode') or ''}{s.get('streakCount') or ''}" or None,
            })
        out[team] = stats
    return out


def result_for(record: dict, team: str) -> str:
    other = record["away"] if team == record["home"] else record["home"]
    if record["score"][team] > record["score"][other]:
        return "W"
    return "L" if record["ended"] == "REG" else "OTL"


def compute_recent_games(records: list) -> dict:
    out = {}
    for r in records:
        for team, other in ((r["home"], r["away"]), (r["away"], r["home"])):
            starter = next((g["name"] for g in r["goalies"].values() if g["team"] == team and g["start"]), None)
            out.setdefault(team, []).append({
                "date": r["date"], "opp": other, "home": team == r["home"], "gf": r["score"][team], "ga": r["score"][other],
                "result": result_for(r, team), "ended": r["ended"], "sog": r["teams"][team].get("sog", 0), "sog_against": r["teams"][other].get("sog", 0),
                "goalie": starter,
            })
    return {team: games[-RECENT_GAMES:] for team, games in out.items()}


def compute_skaters(records: list, toi_report: dict) -> dict:
    """{player id: season line}. A player belongs to the team of his latest game."""
    games = {}
    for r in records:
        for pid, line in r["skaters"].items():
            games.setdefault(pid, []).append(line)
    out = {}
    for pid, lines in games.items():
        last, gp = lines[-1], len(lines)
        total = lambda key, rows=lines: sum(row[key] for row in rows)
        last5 = lines[-5:]
        report = toi_report.get(int(pid)) or {}
        out[pid] = {
            "id": pid, "name": last["name"], "team": last["team"], "pos": last["pos"], "headshot": last["headshot"],
            "shoots": report.get("shootsCatches"), "games": gp, "toi": num(total("toi") / gp / 60, 1),
            "g": total("g"), "a": total("a"), "p": total("g") + total("a"), "ppp": total("ppp"),
            "sog_pg": num(total("sog") / gp), "att_pg": num(total("att") / gp), "hd": total("hd"),
            "hits_pg": num(total("hits") / gp, 1), "blk_pg": num(total("blk") / gp, 1),
            "pp_toi": num(report["ppTimeOnIcePerGame"] / 60, 1) if report.get("ppTimeOnIcePerGame") is not None else None,
            "l5_sog_pg": num(total("sog", last5) / len(last5)), "l5_p": total("g", last5) + total("a", last5),
            "l5_toi": num(total("toi", last5) / len(last5) / 60, 1),
        }
    return out


def compute_goalies(records: list) -> dict:
    """{player id: season line}, shootouts left out (as the league counts saves)."""
    games = {}
    for r in records:
        for pid, line in r["goalies"].items():
            games.setdefault(pid, []).append(line)
    out = {}
    for pid, lines in games.items():
        last = lines[-1]
        total = lambda key, rows=lines: sum(row[key] for row in rows)
        starts = [row for row in lines if row["start"]]
        last5 = starts[-5:]
        decisions = Counter(row["dec"] for row in lines)
        out[pid] = {
            "id": pid, "name": last["name"], "team": last["team"], "headshot": last["headshot"], "games": len(lines), "starts": len(starts),
            "record": record_text(decisions["W"], decisions["L"], decisions["O"]),
            "sv_pct": ratio(total("sa") - total("ga"), total("sa")), "gaa": num(total("ga") * 3600 / total("toi")) if total("toi") else None,
            "sa_pg": num(total("sa", starts) / len(starts), 1) if starts else None,
            "hd_sv_pct": ratio(total("hd_sa") - total("hd_ga"), total("hd_sa")), "hd_sa": total("hd_sa"),
            "l5_sv_pct": ratio(total("sa", last5) - total("ga", last5), total("sa", last5)) if last5 else None,
        }
    return out


def lineup(skaters: dict, team_games: Counter) -> dict:
    """{team: forwards then defensemen, most ice time first}. Ice time is
    discounted for a player with only a game or two, so a one-night fill-in
    doesn't jump the list."""
    by_team = {}
    for s in skaters.values():
        by_team.setdefault(s["team"], []).append(s)
    out = {}
    for team, rows in by_team.items():
        full = min(10, max(1, team_games.get(team, 1))) / 2
        rank = lambda s: -(s["toi"] or 0) * min(1, s["games"] / full)
        forwards = sorted((s for s in rows if s["pos"] != "D"), key=rank)[:FORWARDS_SHOWN]
        defense = sorted((s for s in rows if s["pos"] == "D"), key=rank)[:DEFENSE_SHOWN]
        out[team] = forwards + defense
    return out


# ---- injuries ----
def plain(text: str) -> str:
    """Lowercase with accents dropped, for matching ESPN's names to the NHL's."""
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c)).lower().strip()


def fetch_injuries(teams: dict, skaters: dict, goalies: dict) -> tuple:
    """({team: [players]}, error). Never raises: the page just shows nobody listed."""
    try:
        by_name = {plain(t["name"]): abbr for abbr, t in teams.items()}
        ids = {(p["team"], plain(p["name"])): pid for pid, p in {**skaters, **goalies}.items()}
        order = {"Out": 0, "Injured Reserve": 0, "Suspension": 1, "Day-To-Day": 2}
        out = {}
        for group in _request(ESPN_INJURIES_URL).get("injuries") or []:
            team = by_name.get(plain(group.get("displayName")))
            if not team:
                continue
            for row in group.get("injuries") or []:
                athlete = row.get("athlete") or {}
                details = row.get("details") or {}
                out.setdefault(team, []).append({
                    "id": ids.get((team, plain(athlete.get("displayName")))),
                    "name": athlete.get("displayName"),
                    "position": (athlete.get("position") or {}).get("abbreviation"),
                    "status": row.get("status"),
                    "injury": details.get("type"),
                    "return_date": details.get("returnDate"),
                    "note": row.get("shortComment"),
                })
            out[team].sort(key=lambda p: (order.get(p["status"], 3), p["name"] or ""))
        return out, None
    except Exception as e:
        print(f"WARNING: ESPN NHL injuries failed ({e}).", file=sys.stderr)
        return {}, str(e)


# ---- schedule + lines ----
def utc_text(iso: str) -> str:
    """The feed's "2026-10-13T23:00:00Z" as the "2026-10-13T23:00Z" the page and the lock use."""
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").strftime("%Y-%m-%dT%H:%MZ")


def eastern(iso: str, offset: str) -> datetime:
    """A start time in Eastern, using the offset the feed gives for that game ("-04:00")."""
    sign = -1 if offset.startswith("-") else 1
    hours, minutes = offset.lstrip("+-").split(":")
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ") + sign * timedelta(hours=int(hours), minutes=int(minutes))


def fetch_schedule(now_utc: datetime) -> list:
    """Regular-season games from yesterday through the next SCHEDULE_DAYS_AHEAD days."""
    start = (now_utc - timedelta(hours=4, days=1)).strftime("%Y-%m-%d")
    last = (now_utc + timedelta(days=SCHEDULE_DAYS_AHEAD)).strftime("%Y-%m-%d")
    games, day = [], start
    for _ in range(4):  # the feed answers a week at a time
        week = _request(f"{API}/schedule/{day}")
        for d in week.get("gameWeek") or []:
            for g in d.get("games") or []:
                if g.get("gameType") != REGULAR_SEASON or g.get("gameScheduleState") != "OK":
                    continue
                et = eastern(g["startTimeUTC"], g.get("easternUTCOffset") or "-04:00")
                final = g.get("gameState") in ("FINAL", "OFF")
                national = [b["network"] for b in g.get("tvBroadcasts") or [] if b.get("market") == "N" and b.get("countryCode") == "US"]
                games.append({
                    "game_id": str(g["id"]),
                    "date": et.strftime("%Y-%m-%d"),
                    "time": et.strftime("%H:%M"),
                    "start_utc": utc_text(g["startTimeUTC"]),
                    "away": g["awayTeam"]["abbrev"],
                    "home": g["homeTeam"]["abbrev"],
                    "status": "final" if final else "scheduled",
                    "away_score": g["awayTeam"].get("score") if final else None,
                    "home_score": g["homeTeam"].get("score") if final else None,
                    "ended": (g.get("gameOutcome") or {}).get("lastPeriodType") if final else None,
                    "tv": ", ".join(national) or None,
                })
        day = week.get("nextStartDate")
        if not day or day > last:
            break
    seen, out = set(), []
    for g in sorted(games, key=lambda g: (g["start_utc"], g["game_id"])):
        if g["game_id"] not in seen and start <= g["date"] <= last:
            seen.add(g["game_id"])
            out.append(g)
    return out


def add_rest(games: list, season_games: list, abbr_by_id: dict) -> None:
    """Days since each team's last game (1 = played yesterday, the second
    night of a back-to-back). None for a team's first game."""
    dates = {}
    for g in season_games:
        for key in ("homeTeamId", "visitingTeamId"):
            dates.setdefault(abbr_by_id.get(g[key]), set()).add(g["gameDate"])
    for g in games:
        day = datetime.strptime(g["date"], "%Y-%m-%d")
        for side in ("away", "home"):
            earlier = [d for d in dates.get(g[side], ()) if d < g["date"]]
            g[f"{side}_rest"] = (day - datetime.strptime(max(earlier), "%Y-%m-%d")).days if earlier else None


def price_to_american(p):
    """Novig prices an outcome as the cost of a $1 contract (0.535 = 53.5%)."""
    if p is None or p <= 0 or p >= 1:
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def lines_from_event(ev: dict) -> dict:
    """One Novig event's main lines: the moneyline, the puck line (the
    "spread", almost always 1.5) and the total."""
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
    return lines


def fetch_novig_lines(games: list, teams: dict) -> tuple:
    """({game_id: lines}, debug). Pregame events only -- Novig keeps quoting
    in-game lines after puck drop, and those must never be shown as the line
    (the NFL site learned that on 2026-10-11). Never raises."""
    debug = {"events": 0, "matched": 0, "error": None}
    out = {}
    try:
        query = NOVIG_QUERY_PATH.read_text(encoding="utf-8").rstrip("\n")
        by_matchup = {}
        for g in games:
            by_matchup.setdefault((plain(teams[g["away"]]["mascot"]), plain(teams[g["home"]]["mascot"])), []).append(g)
        events = [e for e in _request(NOVIG_EVENTS_URL).get("items", []) if e.get("status") == "OPEN_PREGAME" and " @ " in (e.get("description") or "")]
        debug["events"] = len(events)
        for e in events:
            away_name, home_name = (plain(part) for part in e["description"].split(" @ ", 1))
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
            lines = lines_from_event(rows[0])
            if lines:
                out[game["game_id"]] = lines
                debug["matched"] += 1
    except Exception as ex:  # network, JSON, or a changed query -- the page just shows no lines
        debug["error"] = str(ex)
        print(f"WARNING: Novig NHL fetch failed ({ex}).", file=sys.stderr)
    return out, debug


def fetch_previous() -> dict | None:
    """The deployed nhl/data.json (behind the member login; the build proves
    itself the same way build_stats.py does). None on any failure."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(LIVE_DATA_URL, headers=headers), timeout=20) as resp:
            return json.load(resp)
    except Exception as e:
        print(f"NOTE: no previous NHL data to carry lines from ({e}).", file=sys.stderr)
        return None


def apply_lines(games: list, novig: dict, previous: dict | None, now_utc: datetime) -> None:
    """Fresh Novig lines for games that haven't started; a game that has
    started keeps whatever the last build before puck drop stored."""
    prev = {g["game_id"]: g for g in (previous or {}).get("schedule") or []}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        source = prev.get(g["game_id"], {}) if started else novig.get(g["game_id"]) or prev.get(g["game_id"], {})
        for field in LINE_FIELDS:
            if source.get(field) is not None:
                g[field] = source[field]
        g["lines_locked"] = started


# ---- putting it together ----
def season_label(season: int) -> str:
    return f"{season - 1}-{str(season)[2:]}"


def fetch_teams() -> tuple:
    """({abbr: team}, {abbr: standings row}) for today's 32 teams."""
    ids = {t["triCode"]: t["id"] for t in _request(f"{REST}/team").get("data") or []}
    teams, standings = {}, {}
    for s in _request(f"{API}/standings/now").get("standings") or []:
        abbr = s["teamAbbrev"]["default"]
        teams[abbr] = {
            "name": s["teamName"]["default"],
            "short": s["placeName"]["default"],
            "mascot": s["teamCommonName"]["default"],
            "color": TEAM_COLORS.get(abbr, "555555"),
            "logo": f"https://assets.nhle.com/logos/nhl/svg/{abbr}_light.svg",
            "logo_dark": f"https://assets.nhle.com/logos/nhl/svg/{abbr}_dark.svg",
            "id": ids.get(abbr),
        }
        standings[abbr] = s
    return teams, standings


def season_stats(season: int, data_dir: Path, standings: dict, team_ids: dict) -> dict:
    """Everything worked out from one season's finished games."""
    listing = _request(f"{REST}/game?cayenneExp=season={season_id(season)}%20and%20gameType={REGULAR_SEASON}").get("data") or []
    finished = sorted(g["id"] for g in listing if g.get("gameStateId") in FINISHED_STATES)
    records, debug = load_games(finished, season, data_dir)
    reports = {"powerplay": fetch_report("team/powerplay", season), "penaltykill": fetch_report("team/penaltykill", season)}
    return {
        "listing": listing,
        "records": records,
        "debug": debug,
        "team_stats": compute_team_stats(records, standings, reports, team_ids),
        "skaters": compute_skaters(records, fetch_report("skater/timeonice", season, "playerId")),
        "goalies": compute_goalies(records),
    }


def prior_path(season: int) -> Path:
    return PRIOR_DIR / f"prior_{season}.json.gz"


def write_prior(season: int, data_dir: Path, out: Path) -> None:
    """Save a finished season's team and player numbers (run once per season)."""
    teams, _ = fetch_teams()
    ends = next(s["standingsEnd"] for s in _request(f"{API}/standings-season")["seasons"] if str(s["id"]) == season_id(season))
    standings = {s["teamAbbrev"]["default"]: s for s in _request(f"{API}/standings/{ends}").get("standings") or []}
    stats = season_stats(season, data_dir, standings, {abbr: t["id"] for abbr, t in teams.items()})
    blob = {"season": season, "season_label": season_label(season), "team_stats": stats["team_stats"], "skaters": stats["skaters"], "goalies": stats["goalies"]}
    with gzip.open(out, "wt", encoding="utf-8") as f:
        json.dump(blob, f, separators=(",", ":"))
    print(f"Wrote {out} -- {season_label(season)}: {stats['debug']['games_loaded']} of {stats['debug']['games_wanted']} games, {len(stats['skaters'])} skaters, {len(stats['goalies'])} goalies")
    if stats["debug"]["errors"]:
        print("  errors:", stats["debug"]["errors"])


def load_prior(season: int) -> dict | None:
    path = prior_path(season)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, help="Where to write data.json")
    parser.add_argument("--data-dir", type=Path, default=Path("data/nhl"), help="Where finished games are kept between builds")
    parser.add_argument("--write-prior", type=Path, metavar="FILE", help="Instead of data.json, save this (finished) season's numbers for next season's build")
    args = parser.parse_args()
    if args.write_prior:
        return write_prior(args.season, args.data_dir, args.write_prior)
    if not args.out:
        parser.error("--out is required")
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    teams, standings = fetch_teams()
    team_ids = {abbr: t["id"] for abbr, t in teams.items()}
    abbr_by_id = {v: k for k, v in team_ids.items()}
    stats = season_stats(args.season, args.data_dir, standings, team_ids)
    prior = load_prior(args.season - 1) or {}

    played = [s["games_played"] for s in stats["team_stats"].values()]
    middle_games = statistics.median(played) if played else 0
    default_view = "season" if middle_games >= MIN_GAMES_FOR_CURRENT or not prior else "prev"

    # Last season's line rides along on each player, so the page can show
    # either season for the same lineup (players are on their current team).
    for group, key in ((stats["skaters"], "skaters"), (stats["goalies"], "goalies")):
        for pid, row in group.items():
            row["prev"] = (prior.get(key) or {}).get(pid)
    team_games = Counter({team: s["games_played"] for team, s in stats["team_stats"].items()})
    goalies = {}
    for g in sorted(stats["goalies"].values(), key=lambda g: -g["starts"]):
        goalies.setdefault(g["team"], []).append(g)

    games = fetch_schedule(now_utc)
    add_rest(games, stats["listing"], abbr_by_id)
    novig, novig_debug = fetch_novig_lines(games, teams)
    apply_lines(games, novig, fetch_previous(), now_utc)
    injuries, injuries_error = fetch_injuries(teams, stats["skaters"], stats["goalies"])

    blob = {
        "season": args.season,
        "season_label": season_label(args.season),
        "prev_season_label": prior.get("season_label"),
        "default_view": default_view,
        "middle_games_played": middle_games,
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%MZ"),
        "areas": list(AREAS),
        "teams": teams,
        "team_stats": stats["team_stats"],
        "team_stats_prev": prior.get("team_stats") or {},
        "recent_games": compute_recent_games(stats["records"]),
        "skaters": lineup(stats["skaters"], team_games),
        "goalies": goalies,
        "injuries": injuries,
        "schedule": games,
        "novig_debug": novig_debug,
        "feed_debug": {**stats["debug"], "injuries_error": injuries_error},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    d = stats["debug"]
    print(f"Wrote {args.out} -- {season_label(args.season)}: {d['games_loaded']} of {d['games_wanted']} finished games ({d['games_downloaded']} downloaded), {len(games)} on the schedule, lines for {novig_debug['matched']}")
    if d["errors"]:
        print("  game errors:", d["errors"], file=sys.stderr)


if __name__ == "__main__":
    main()
