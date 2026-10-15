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

This season only (the owner, 2026-10-13: "Let's scrap all of last year's
data on the site"). Nothing from an earlier season is read or written here;
the replays in tools/backtest download a past season's games when they need one.

The Shots page's projections (site/nhl/shots.json) are worked out here
too, by shots_model.py, from the same finished games, and so is the Promo
Tools page's King of the Crease board (site/nhl/crease.json, saves_model.py).

Seasons are named by the year they END, like the NBA build (2027 = 2026-27).
Team keys are the NHL's own abbreviations (TBL, NJD, SJS, LAK, UTA ...).
"""
import argparse
import gzip
import hashlib
import hmac
import json
import math
import os
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import goals_model
import saves_model
import shots_model

sys.path.insert(1, str(Path(__file__).resolve().parent.parent))  # nfl_tool/, for smartstake.py
import smartstake  # noqa: E402

API ="https://api-web.nhle.com/v1"
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
FETCH_WORKERS = 6
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nhl/1.0)"

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
# The NHL's own "projected lineups" story for each game (NHL.com's game
# preview: tonight's forward lines, defense pairs, goalies, scratches and
# injuries), usually posted around midday Eastern on game day.
STORIES = "https://forge-dapi.d3.nhle.com/v2/content/en-us/stories"
LIVE_DATA_URL = "https://nfl.gmgsports.org/nhl/data.json"
LIVE_SHOTS_URL = "https://nfl.gmgsports.org/nhl/shots.json"
LIVE_CREASE_URL = "https://nfl.gmgsports.org/nhl/crease.json"
LIVE_GOALS_URL = "https://nfl.gmgsports.org/nhl/goals.json"
LIVE_ICEBREAKER_URL = "https://nfl.gmgsports.org/nhl/icebreaker.json"
# The Shots page projects games through this many days out (books post
# shots-on-goal lines about a day ahead) and keeps the chance of 1+ ... 8+.
SHOTS_DAYS_AHEAD = 2
SHOTS_LADDER = 8
# Injury statuses that mean "not playing" (everything but day-to-day).
OUT_STATUSES = ("Out", "Injured Reserve", "Suspension")
# An edge is the model's chance minus the chance the price needs to break
# even. The page colors a play from "lean", and sets a play at "check" or more
# apart: a gap that big is more often news the model can't see than a gift.
SHOTS_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
# The Shots page lists the graded plays of the latest days that have any (the
# buckets and the day-by-day line cover the whole season; listing every play
# of a season would make shots.json a megabyte heavier by spring).
SHOTS_RECORD_DAYS = 14
# Every graded play, one file a month (2026-10.json ...), committed by the
# deploy like the NFL model's record so it survives anything the site loses.
SHOTS_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_shots"
# The Goals page (anytime goal scorer): edges in points of chance, the Shots
# page's buckets. Goal prices are long (most +150 to +900), so a 3-point edge
# at 25% is about a 12% return; telling that from luck takes ~900 plays, which
# is why the record also grades closing line value (goals_record_summary).
GOALS_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
GOALS_RECORD_DAYS = 14
GOALS_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_goals"
GOALS_HONEST = (0.0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 1.01)  # the record's "said vs scored" buckets
# King of the Crease (DraftKings' promo: the goalie with the most saves of the
# day wins). The board covers the same days as the Shots page.
#   blend   how far a goalie's chance to lead the day leans on the model's own
#           projection once the season has depth; the rest is the book's
#           line, which knows things the model can't (who is hurt, what a
#           team was before this season)
#   full_games  ...reached when both teams have played this many games. Before
#           that the model counts for less, in step: in the replay its edge
#           over "every goalie is average" was a quarter of its full size in
#           a season's first two weeks and whole by about game 20.
#   value   the Value tag: his chance to lead the day is at least this many
#           times what it would be if he were exactly what his line says
#   floor   ...and at least this share of an even split of the day (half of
#           1 in 20 on a ten-game day), so a no-hoper doubling to 2% isn't one
#   check   model and line this many saves apart: more often news the model
#           can't see than a gift. Marked, never tagged.
#   upside  the Upside tag: the day's best chances, this many at most (one
#           for every four starters on a short slate)
#   big_night  the save total the "big night" chance is quoted at (the day's
#           best averaged 36.7 saves in the replay)
CREASE_RULES = {"blend": 0.5, "full_games": 20, "value": 1.15, "floor": 0.5, "check": 4.0, "upside": 3, "big_night": 35}
# Every finished day, one file a month, committed by the deploy like the Shots record.
CREASE_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_crease"
CREASE_RECORD_COLS = ("id", "name", "team", "opp", "mean", "line", "over", "under", "mkt_mean", "blend", "top", "mkt_top", "tags", "actual")
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
EARLY_SECONDS = 300  # "fast start" shots: the first five minutes of the 1st period
# The feed's shot types, grouped for the player card (anything else is "other").
SHOT_TYPES = {"wrist": "wrist", "snap": "snap", "slap": "slap", "backhand": "backhand", "tip-in": "tip", "deflected": "tip"}
# One row per game in a player's log (the player files, see write_player_files).
SKATER_LOG_COLS = ("toi", "g", "a", "sog", "att", "hits", "blk", "pm", "pim", "ppp", "slot")
GOALIE_LOG_COLS = ("start", "dec", "toi", "sa", "ga", "hd_sa", "hd_ga")


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


def game_shots(raw: dict) -> list:
    """Every unblocked shot with a goalie in net (no empty nets, penalty
    shots, own goalie pulled or shootouts), with what the goals model's
    expected-goals table reads (goals_model.py): where (`area`, `dist` and
    `angle` to the net, `y` = his side), how (`type`), a `rebound` (his
    team shot within 3 seconds), a `rush` (the play before, within 4
    seconds, was outside his team's attacking zone), `pp` / `sh`, `goal`."""
    pbp = raw["pbp"]
    home, away = pbp["homeTeam"], pbp["awayTeam"]
    abbr = {home["id"]: home["abbrev"], away["id"]: away["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    plays = sorted(pbp.get("plays") or [], key=lambda p: p.get("sortOrder", 0))
    directions = attack_directions(plays, team_of, home["id"])
    out, prev = [], None
    for p in plays:
        period = p.get("periodDescriptor") or {}
        if period.get("periodType") == "SO":
            continue
        d = p.get("details") or {}
        kind = p.get("typeDescKey")
        t = (period.get("number") or 0) * 1200 + clock_seconds(p.get("timeInPeriod"))
        owner = d.get("eventOwnerTeamId")
        if kind in ("goal", "shot-on-goal", "missed-shot"):
            shooter = d.get("scoringPlayerId") or d.get("shootingPlayerId")
            team_id = team_of.get(shooter, owner)
            man = strength(p.get("situationCode"), team_id == home["id"])
            spot = normalize_xy(d, directions.get((period.get("number"), team_id)))
            if team_id in abbr and man not in ("en", "ps", "extra") and spot:
                x, y = spot
                rebound = rush = False
                if prev and prev["period"] == period.get("number") and t - prev["t"] <= 4:
                    rebound = prev["shot"] and prev["team"] == team_id and t - prev["t"] <= 3
                    # The play before was outside his team's attacking zone (the
                    # rink's x read from his end): a rush.
                    rush = not prev["shot"] and prev["x"] is not None and prev["x"] * directions.get((period.get("number"), team_id), 1) < BLUE_LINE_X
                out.append({
                    "shooter": str(shooter), "team": abbr[team_id], "goalie": str(d.get("goalieInNetId")),
                    "area": shot_area(x, y), "y": y, "dist": math.hypot(GOAL_LINE_X - x, y),
                    "angle": abs(math.degrees(math.atan2(y, GOAL_LINE_X - x))) if x <= GOAL_LINE_X else 90.0,
                    "type": SHOT_TYPES.get(d.get("shotType"), "other"), "rebound": rebound, "rush": rush,
                    "pp": man == "pp", "sh": man == "sh", "goal": kind == "goal",
                })
        if kind in ("goal", "shot-on-goal", "missed-shot", "blocked-shot", "hit", "giveaway", "takeaway", "faceoff"):
            prev = {"t": t, "period": period.get("number"), "team": owner, "x": d.get("xCoord"),
                    "shot": kind in ("goal", "shot-on-goal", "missed-shot", "blocked-shot")}  # a blocked shot's owner is the shooting team
    return out


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
    # Icebreaker (fast starts): each team's first goal, in seconds from the
    # opening faceoff, and the game's first goal with its scorer.
    first_goals, first_goal = {}, None

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
            t["unb_pp"] += man == "pp"
            mine["unb"] += 1
            mine["pp_unb"] += man == "pp"
            on_goal = kind in ("goal", "shot-on-goal")
            if on_goal:
                t["sog"] += 1
                t["sog_5v5"] += even
                if period.get("number") == 1 and clock_seconds(p.get("timeInPeriod")) < EARLY_SECONDS:
                    t["sog_early"] += 1
            if kind == "goal":
                t["g"] += 1
                elapsed = ((period.get("number") or 1) - 1) * 1200 + clock_seconds(p.get("timeInPeriod"))
                first_goals.setdefault(abbr[team_id], elapsed)
                if first_goal is None:
                    first_goal = {"t": elapsed, "team": abbr[team_id], "id": str(shooter) if shooter else None, "name": person_name(spots.get(shooter, {}))}
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
            scored = kind == "goal"
            t[f"a_{area}"] += 1
            t[f"as_{area}"] += on_goal
            t[f"ag_{area}"] += scored
            mine[f"a_{area}"] += 1
            mine[f"s_{area}"] += on_goal
            mine[f"g_{area}"] += scored
            shot_type = SHOT_TYPES.get(d.get("shotType"), "other")
            mine[f"t_{shot_type}"] += 1
            mine[f"tg_{shot_type}"] += scored
            goalie = d.get("goalieInNetId")
            if on_goal and goalie:
                faced = goalie_extra.setdefault(goalie, Counter())
                faced[f"s_{area}"] += 1
                faced[f"g_{area}"] += scored
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
    on_pp = raw.get("pp_toi")  # {player id: power-play seconds}, the league's report (fetch_pp_toi)
    lines = game_lines(raw)  # {player id: "L1".."D3"}, the line he played on (shift chart)
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
                    "hd": extra.get("a_low_slot", 0), "ppp": extra.get("ppp", 0), "pm": s.get("plusMinus", 0), "pim": s.get("pim", 0),
                    "unb": extra.get("unb", 0), "pp_unb": extra.get("pp_unb", 0),
                    "slot": lines.get(str(pid)),
                    # Seconds on the power play (the league's per-game report); None when the game has none.
                    "pp_toi": on_pp.get(str(pid), 0) if on_pp is not None else None,
                    # Where he shot from: {area: [shots (on goal or wide), on goal, goals]}, and by shot type: {type: [shots, goals]}.
                    "areas": {a: [extra[f"a_{a}"], extra.get(f"s_{a}", 0), extra.get(f"g_{a}", 0)] for a in AREAS if extra.get(f"a_{a}")},
                    "types": {k: [extra[f"t_{k}"], extra.get(f"tg_{k}", 0)] for k in (*dict.fromkeys(SHOT_TYPES.values()), "other") if extra.get(f"t_{k}")},
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
                "hd_sa": extra.get("s_low_slot", 0), "hd_ga": extra.get("g_low_slot", 0),
                # Shots on goal he faced from each area: {area: [shots, goals]}.
                "areas": {a: [extra[f"s_{a}"], extra.get(f"g_{a}", 0)] for a in AREAS if extra.get(f"s_{a}")},
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
        # Every unblocked shot on a goalie, for the goals model (game_shots).
        "shots": game_shots(raw),
        "first_goal": first_goal,
        "first_goals": first_goals,
    }


# ---- downloading ----
def _request(url: str, body: dict | None = None, headers: dict | None = None, tries: int = 3, timeout: int = 30):
    data = json.dumps(body).encode() if body is not None else None
    head = {"accept": "*/*", "User-Agent": USER_AGENT, **(headers or {})}
    if data is not None:
        head["content-type"] = "application/json"
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=head), timeout=timeout) as resp:
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


def fetch_pp_toi(game_id: int) -> dict | None:
    """{player id: seconds on the power play} for a finished game, from the
    league's per-game time-on-ice report (official; the shift charts it
    replaced are missing for some games and read about 15% short). None if
    it can't be read (asked for again next build)."""
    try:
        rows = _request(f"{REST}/skater/timeonice?isAggregate=false&isGame=true&limit=-1&cayenneExp=gameId={game_id}", tries=2).get("data") or []
    except Exception:
        return None
    return {str(r["playerId"]): r.get("ppTimeOnIce") or 0 for r in rows} or None


def save_raw(path: Path, raw: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(raw, f, separators=(",", ":"))
    tmp.replace(path)


def fetch_shifts(game_id: int) -> list | None:
    """Every shift of a finished game, [player id, team, period, "mm:ss" on,
    "mm:ss" off], from the league's shift chart (typeCode 517 = a shift; the
    rest are goal markers). For who played with whom (game_lines), not for
    ice time: the chart can run short. None if it can't be read (asked for
    again next build); [] when the league has no chart for the game (games 6
    to 52 of 2026-27 have none)."""
    try:
        rows = _request(f"{REST}/shiftcharts?cayenneExp=gameId={game_id}", tries=2).get("data") or []
    except Exception:
        return None
    return [[r["playerId"], r.get("teamAbbrev"), r["period"], r["startTime"], r["endTime"]]
            for r in rows if r.get("typeCode") == 517 and r.get("startTime") and r.get("endTime")]


SHIFTS_GIVE_UP_DAYS = 3  # a game this old with no shift chart is marked as having none


def keep_shifts(raw: dict, shifts: list | None) -> bool:
    """Puts a fetched shift chart on the kept game; an empty one only once the
    game is SHIFTS_GIVE_UP_DAYS old (the league posts late), so it isn't asked
    for on every build forever. True if the game changed."""
    if shifts is None:
        return False
    played = (raw.get("pbp") or {}).get("gameDate")
    old = bool(played) and (datetime.now(timezone.utc).date() - datetime.strptime(played, "%Y-%m-%d").date()).days >= SHIFTS_GIVE_UP_DAYS
    if shifts or old:
        raw["shifts"] = shifts
        return True
    return False


def game_lines(raw: dict) -> dict:
    """{player id: "L1".."L4" for forwards, "D1".."D3" for defensemen}: the
    line he actually played on that night. From the shift chart: the forward
    with the most ice time and the two he shared the most of it with are a
    line, then the next, and so on (pairs for defensemen); lines are numbered
    by their ice time. {} when the game has no shift chart."""
    shifts = raw.get("shifts")
    box = raw.get("box") or {}
    if not shifts:
        return {}
    kind_of = {}
    for side in ("homeTeam", "awayTeam"):
        team = (box.get(side) or {}).get("abbrev")
        stats = (box.get("playerByGameStats") or {}).get(side) or {}
        for group, kind in (("forwards", "F"), ("defense", "D")):
            for p in stats.get(group) or []:
                kind_of[str(p["playerId"])] = (team, kind)
    spans = {}
    for pid, _team, period, on, off in shifts:
        start, end = (period - 1) * 1200 + clock_seconds(on), (period - 1) * 1200 + clock_seconds(off)
        if end > start:
            spans.setdefault(str(pid), []).append((start, end))
    toi = {pid: sum(b - a for a, b in spans[pid]) for pid in spans}
    shared = {}

    def together(p, q):
        key = (p, q) if p < q else (q, p)
        if key not in shared:
            shared[key] = sum(max(0, min(b1, b2) - max(a1, a2)) for a1, b1 in spans[p] for a2, b2 in spans[q])
        return shared[key]

    out = {}
    for team in {team for team, _ in kind_of.values()}:
        for kind, size, prefix, most in (("F", 3, "L", 4), ("D", 2, "D", 3)):
            left = sorted((pid for pid, tk in kind_of.items() if tk == (team, kind) and pid in spans), key=lambda pid: -toi[pid])
            groups = []
            while left:
                lead = left.pop(0)
                mates = sorted(left, key=lambda q: -together(lead, q))[:size - 1]
                for m in mates:
                    left.remove(m)
                groups.append([lead, *mates])
            groups.sort(key=lambda g: -sum(toi[p] for p in g) / len(g))
            for i, g in enumerate(groups):
                for p in g:
                    out[p] = f"{prefix}{min(i + 1, most)}"
    return out


def load_game(game_id: int, season: int, data_dir: Path) -> tuple:
    """(raw game, downloaded?). A game is kept on disk once the league marks
    it official ("OFF": the scorers' corrections are in); until then it is
    downloaded again on the next build. A kept game also keeps each
    skater's power-play seconds (`pp_toi`, for the goals model); one saved
    before those were kept gets them the next time it is read."""
    path = game_path(data_dir, season, game_id)
    raw = None
    if path.exists():
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            path.unlink()  # a half-written file: fetch it again
    if raw is not None:
        changed = False
        if "pp_toi" not in raw:
            pp_toi = fetch_pp_toi(game_id)
            if pp_toi:
                raw["pp_toi"] = pp_toi
                changed = True
        if "shifts" not in raw:  # a game kept before the shift chart was
            changed = keep_shifts(raw, fetch_shifts(game_id)) or changed
        if changed:
            save_raw(path, raw)
        return raw, False
    raw = {"pbp": _request(f"{API}/gamecenter/{game_id}/play-by-play"), "box": _request(f"{API}/gamecenter/{game_id}/boxscore")}
    if raw["pbp"].get("gameState") == "OFF":
        pp_toi = fetch_pp_toi(game_id)
        if pp_toi:
            raw["pp_toi"] = pp_toi
        keep_shifts(raw, fetch_shifts(game_id))
        save_raw(path, raw)
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


# ---- the player card's data ----
def add_counts(total: dict, part: dict) -> None:
    """Adds {key: [numbers]} into a running total of the same shape."""
    for key, values in part.items():
        have = total.setdefault(key, [0] * len(values))
        for i, v in enumerate(values):
            have[i] += v


def compute_player_details(records: list) -> dict:
    """What the player card shows beyond the season line: every game's box
    score line, where a skater's shots came from and with what kind of shot,
    and where the shots a goalie faced came from. Log rows point at a shared
    list of games so the saved last-season file stays small."""
    games = {str(r["id"]): [r["date"], r["home"], r["away"], r["score"][r["home"]], r["score"][r["away"]], r["ended"]] for r in records}
    skaters, goalies = {}, {}
    for r in records:
        game = str(r["id"])
        for pid, line in r["skaters"].items():
            d = skaters.setdefault(pid, {"log": [], "areas": {}, "types": {}, "unb": 0, "pp_unb": 0})
            d["log"].append([game, line["team"], *(line[c] for c in SKATER_LOG_COLS)])
            add_counts(d["areas"], line["areas"])
            add_counts(d["types"], line["types"])
            d["unb"] += line["unb"]
            d["pp_unb"] += line["pp_unb"]
        for pid, line in r["goalies"].items():
            d = goalies.setdefault(pid, {"log": [], "areas": {}})
            d["log"].append([game, line["team"], *(int(line[c]) if isinstance(line[c], bool) else line[c] for c in GOALIE_LOG_COLS)])
            add_counts(d["areas"], line["areas"])
    return {"games": games, "skaters": skaters, "goalies": goalies}


def league_areas(records: list) -> dict:
    """The whole league's numbers for each rink area, the yardstick on the
    player card: the share of shots taken there and how often a shot on goal
    from there goes in."""
    total = Counter()
    for r in records:
        for counts in r["teams"].values():
            total.update(counts)
    located = sum(total[f"a_{a}"] for a in AREAS)
    return {a: {"share": ratio(total[f"a_{a}"], located), "sh_pct": ratio(total[f"ag_{a}"], total[f"as_{a}"])} for a in AREAS}


def player_file(detail: dict | None, pid: str) -> dict | None:
    """One player's card data with each log row spelled out: [date, opponent,
    at home (1/0), goals for, goals against, how it ended, then the stat columns]."""
    for group in ("skaters", "goalies"):
        d = ((detail or {}).get(group) or {}).get(pid)
        if not d:
            continue
        rows = []
        for game, team, *numbers in d["log"]:
            date, home, away, home_score, away_score, ended = detail["games"][game]
            mine, theirs = (home_score, away_score) if team == home else (away_score, home_score)
            rows.append([date, away if team == home else home, int(team == home), mine, theirs, ended, *numbers])
        return {**d, "log": rows}
    return None


def write_player_files(folder: Path, teams: dict, stats: dict, generated_at: str) -> int:
    """site/nhl/players/<TEAM>.json: the card data for everyone on that team,
    this season. The page loads a team's file only when one of its
    games is opened, so data.json stays small."""
    folder.mkdir(parents=True, exist_ok=True)
    on_team = {}
    for group in ("skaters", "goalies"):
        for pid, row in stats[group].items():
            on_team.setdefault(row["team"], {}).setdefault(group, []).append(pid)
    for abbr in teams:
        blob = {"team": abbr, "generated_at": generated_at, "log_lead": ["date", "opp", "home", "gf", "ga", "ended"], "skater_cols": list(SKATER_LOG_COLS), "goalie_cols": list(GOALIE_LOG_COLS)}
        for group in ("skaters", "goalies"):
            blob[group] = {pid: {"season": player_file(stats["detail"], pid)} for pid in on_team.get(abbr, {}).get(group, [])}
        with open(folder / f"{abbr}.json", "w") as f:
            json.dump(blob, f, separators=(",", ":"))
    return len(teams)


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


# Novig's player markets, as the site names them. The main (consensus) line of
# each becomes a row on the player card; goals at 0.5 is the anytime goal.
PLAYER_OU_MARKETS = {"SHOTS_ON_GOAL": "sog", "POINTS": "points", "ASSISTS": "assists"}
# Highest believable Yes price (same guard as the NFL build's TD markets).
GOAL_YES_MAX = 0.95
# Novig's first-goal book is mostly placeholder asks: on 2026-10-13 it quoted
# 27 of 31 skaters in a game at 21-27% to score first, depth defensemen
# included, with nobody on the other side. A player can't score first without
# scoring, so a one-sided first-goal price is only believed when it is at
# most this share of his own anytime-goal price.
FIRST_GOAL_MAX_SHARE = 0.5


def player_finder(skaters: dict, goalies: dict):
    """Returns find(team, name) -> the NHL's player id or None. Books spell
    names their own way, so after an exact match (accents dropped) it tries
    the same last name and first initial on that team, then a name only one
    player in the league has (a player who just changed teams)."""
    exact, loose, league = {}, {}, {}
    for pid, p in {**goalies, **skaters}.items():
        name = plain(p["name"])
        first, _, last = name.partition(" ")
        exact.setdefault((p["team"], name), set()).add(pid)
        loose.setdefault((p["team"], last, first[:1]), set()).add(pid)
        league.setdefault(name, set()).add(pid)

    def find(team, name):
        name = plain(name)
        first, _, last = name.partition(" ")
        for ids in (exact.get((team, name)), loose.get((team, last, first[:1])), league.get(name)):
            if ids:
                # Two players it could be (Vancouver has had two Elias Petterssons): no guess.
                return next(iter(ids)) if len(ids) == 1 else None
        return None

    return find


def player_odds_from_event(ev: dict, team_of_name, find) -> dict:
    """{player id: odds} from one Novig event. Main lines only for the
    over/unders; the other shots-on-goal and goals lines ride along as
    ladders (sog_alts, goal_alts). Like the NFL build's TD odds, one-sided
    prices are kept and junk quotes dropped; a first-goal price also has to
    make sense next to the player's own anytime price (FIRST_GOAL_MAX_SHARE)."""
    out, goal_rows, first_rows = {}, [], []

    def entry(m):
        player = m.get("player") or {}
        comps = player.get("player_competitors") or []
        team = team_of_name((comps[0].get("competitor") or {}).get("name")) if comps else None
        pid = find(team, player.get("full_name")) if team else None
        return out.setdefault(pid, {"name": player.get("full_name"), "team": team}) if pid else None

    for m in ev.get("markets") or []:
        if not m.get("player"):
            continue
        kind = m.get("type")
        prices = {(o.get("description") or "").split(" ")[0].lower(): o.get("available") for o in m.get("outcomes") or []}
        strike = m.get("strike")
        if kind in PLAYER_OU_MARKETS and strike is not None:
            over, under = prices.get("over"), prices.get("under")
            if m.get("is_consensus"):
                if price_to_american(over) is None and price_to_american(under) is None:
                    continue
                row = entry(m)
                if row is not None:
                    # Barely traded: one side missing, or the two asks adding well past 100%.
                    thin = not over or not under or over + under > 1.15
                    row[PLAYER_OU_MARKETS[kind]] = {"line": float(strike), "over": price_to_american(over), "under": price_to_american(under), "chance": round(over / (over + under), 3) if over and under else None, "thin": thin}
            elif kind == "SHOTS_ON_GOAL" and price_to_american(over) is not None:
                row = entry(m)
                if row is not None:
                    row.setdefault("sog_alts", []).append([float(strike), price_to_american(over)])
        elif kind == "PLAYER_GOALS" and strike is not None:
            yes, no = prices.get("over"), prices.get("under")
            if price_to_american(yes) is None:
                continue
            if float(strike) != 0.5:
                row = entry(m)
                if row is not None:
                    row.setdefault("goal_alts", []).append([float(strike), price_to_american(yes)])
            elif m.get("is_consensus") and yes <= GOAL_YES_MAX and not (no and yes + no > 1.5):
                row = entry(m)
                if row is not None:
                    row["goal"] = {"odds": price_to_american(yes), "no_odds": price_to_american(no), "thin": not no}
                    goal_rows.append((row["goal"], yes, no))
        elif kind == "FIRST_GOAL_SCORER" and m.get("is_consensus"):
            yes, no = prices.get("yes"), prices.get("no")
            if price_to_american(yes) is None or (no and yes + no > 1.5):
                continue
            row = entry(m)
            if row is not None:
                first_rows.append((row, yes, no))

    # Chances, once the whole game is read: Yes/(Yes+No) when both sides
    # trade; a one-sided price gets the game's median fair/Yes ratio.
    def fair(rows):
        ratios = sorted((yes / (yes + no)) / yes for _, yes, no in rows if no)
        typical = ratios[len(ratios) // 2] if ratios else 0.9
        return lambda yes, no: yes / (yes + no) if no else min(yes * typical, 0.99)

    chance = fair(goal_rows)
    anytime_yes = {}
    for goal, yes, no in goal_rows:
        goal["chance"] = round(chance(yes, no), 3)
        anytime_yes[id(goal)] = yes
    chance = fair(first_rows)
    kept = []
    for row, yes, no in first_rows:
        ceiling = anytime_yes.get(id(row.get("goal")))
        if not no and (ceiling is None or yes > FIRST_GOAL_MAX_SHARE * ceiling):
            continue  # a placeholder ask, not a price
        row["first_goal"] = {"odds": price_to_american(yes), "thin": not no}
        kept.append((row["first_goal"], chance(yes, no)))
    # One goal comes first: the chances can add up to less than 1 (not every
    # player is priced) but never more.
    over = max(sum(c for _, c in kept), 1.0)
    for first, c in kept:
        first["chance"] = round(c / over, 3)
    for row in out.values():
        for key in ("sog_alts", "goal_alts"):
            if key in row:
                row[key].sort()
    # A player whose only quote was dropped has nothing left but his name.
    return {pid: row for pid, row in out.items() if len(row) > 2}


# Novig's goalie saves book is thin: often the line with one price, or none
# yet. A lone ask sits about this far above the fair price (where both sides
# trade, the two asks add to about 1.05).
SAVES_OVERROUND = 1.05
# The furthest a price can pull the line off 50/50: a thin ask is not a forecast.
SAVES_CHANCE_RANGE = (0.35, 0.65)


def saves_over_chance(over, under) -> float:
    """The chance the book gives the over at its main line, its cut taken
    out, from Novig's prices (0-1; either can be missing)."""
    over = over if over and 0 < over < 1 else None
    under = under if under and 0 < under < 1 else None
    if over and under and over + under > 1.5:
        over = under = None  # junk quotes (99 cents a side)
    if over and under:
        chance = over / (over + under)
    elif over:
        chance = over / SAVES_OVERROUND
    elif under:
        chance = 1 - under / SAVES_OVERROUND
    else:
        chance = 0.5
    return round(min(SAVES_CHANCE_RANGE[1], max(SAVES_CHANCE_RANGE[0], chance)), 3)


def saves_lines_from_event(ev: dict, team_of_name, find) -> dict:
    """{team: [goalie]} for every goalie Novig lists a main saves line for:
    {"id" (None for a goalie who hasn't played this season), "name", "line",
    "over", "under", "chance" (of the over, the cut taken out), "thin" (a
    side isn't priced), "alts" ([line, over price] for its other lines)}.
    The line is kept even with no price on it: it still says where the
    market is."""
    out = {}
    for m in ev.get("markets") or []:
        player = m.get("player") or {}
        if m.get("type") != "SAVES" or not player.get("full_name") or m.get("strike") is None:
            continue
        comps = player.get("player_competitors") or []
        team = team_of_name((comps[0].get("competitor") or {}).get("name")) if comps else None
        if not team:
            continue
        name = player["full_name"]
        row = out.setdefault(team, {}).setdefault(plain(name), {"id": find(team, name) if find else None, "name": name, "alts": []})
        prices = {(o.get("description") or "").split(" ")[0].lower(): o.get("available") for o in m.get("outcomes") or []}
        over, under = prices.get("over"), prices.get("under")
        if m.get("is_consensus"):
            row.update(line=float(m["strike"]), over=price_to_american(over), under=price_to_american(under), chance=saves_over_chance(over, under))
            row["thin"] = row["over"] is None or row["under"] is None
        elif price_to_american(over) is not None:
            row["alts"].append([float(m["strike"]), price_to_american(over)])
    listed = {}
    for team, rows in out.items():
        for row in rows.values():
            if "line" in row:
                row["alts"].sort()
                listed.setdefault(team, []).append(row)
    return listed


def fetch_novig_lines(games: list, teams: dict, find=None) -> tuple:
    """({game_id: lines}, {game_id: {player id: odds}}, {game_id: {team:
    [goalie saves lines]}}, debug). Pregame events only -- Novig keeps
    quoting in-game lines after puck drop, and those must never be shown as
    the line (the NFL site learned that on 2026-10-11). Never raises."""
    debug = {"events": 0, "matched": 0, "players": 0, "saves": 0, "error": None}
    out, players, saves = {}, {}, {}
    team_of_name = team_namer(teams)
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
            if find:
                odds = player_odds_from_event(rows[0], team_of_name, find)
                goalie_lines = saves_lines_from_event(rows[0], team_of_name, find)
                if goalie_lines:
                    saves[game["game_id"]] = goalie_lines
                    debug["saves"] += sum(len(listed) for listed in goalie_lines.values())
                # A goalie the site knows gets his saves line on the player card too.
                for team, listed in goalie_lines.items():
                    for row in listed:
                        if row["id"]:
                            card = odds.setdefault(row["id"], {"name": row["name"], "team": team})
                            card["saves"] = {key: row[key] for key in ("line", "over", "under", "chance", "thin")}
                            if row["alts"]:
                                card["saves_alts"] = row["alts"]
                if odds:
                    players[game["game_id"]] = odds
                    debug["players"] += len(odds)
    except Exception as ex:  # network, JSON, or a changed query -- the page just shows no lines
        debug["error"] = str(ex)
        print(f"WARNING: Novig NHL fetch failed ({ex}).", file=sys.stderr)
    return out, players, saves, debug


def team_namer(teams: dict):
    """Returns f(a book's team name) -> the NHL abbreviation ("Detroit Red Wings" -> DET)."""
    by_mascot = {plain(t["mascot"]): abbr for abbr, t in teams.items()}
    return lambda name: next((abbr for mascot, abbr in by_mascot.items() if plain(name).endswith(mascot)), None)


def fetch_previous(url: str = LIVE_DATA_URL) -> dict | None:
    """The deployed nhl/data.json or shots.json (behind the member login; the
    build proves itself the same way build_stats.py does). None on any failure."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as resp:
            return json.load(resp)
    except Exception as e:
        print(f"NOTE: no previous {url.rsplit('/', 1)[-1]} to carry locked numbers from ({e}).", file=sys.stderr)
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


def locked_player_odds(games: list, fresh: dict, previous: dict | None, now_utc: datetime) -> dict:
    """{game_id: {player id: odds}} for the games on the schedule, under the
    same lock as the game lines: a game that has started keeps the player
    odds of the last build before puck drop, never this run's."""
    prev = (previous or {}).get("player_odds") or {}
    out = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        odds = prev.get(g["game_id"]) if started else fresh.get(g["game_id"]) or prev.get(g["game_id"])
        if odds:
            out[g["game_id"]] = odds
    return out


# ---- tonight's lines (the NHL's projected lineups) ----
def parse_lineups(markdown: str) -> dict:
    """The NHL's "projected lineups" story as {team label: lineup}. The story
    is plain text: a "<Team> projected lineup" heading, then one line of text
    per forward line ("A -- B -- C") and defense pair ("A -- B"), then the
    goalies one to a line (the first is the expected starter), then
    "Scratched:" and "Injured:". A lineup is {"groups": [[names]], "goalies":
    [names], "scratched": [names], "injured": [names]}."""
    out, team = {}, None
    # The story is typed by hand: non-breaking spaces, curly apostrophes and
    # long dashes turn up where plain ones are meant.
    tidy = markdown.replace("\u00a0", " ").replace("\u2019", "'").replace("\u2018", "'")
    tidy = re.sub("\\s+[\u2013\u2014]\\s+", " -- ", tidy)
    for raw in tidy.splitlines():
        text = re.sub(r"[*#_]", "", raw).strip()
        if not text:
            continue
        heading = re.match(r"^(.+?) projected lineup$", text, re.IGNORECASE)
        if heading:
            team = out.setdefault(heading.group(1).strip(), {"groups": [], "goalies": [], "scratched": [], "injured": []})
        elif re.match(r"^status report", text, re.IGNORECASE):
            team = None
        elif team is not None:
            label, colon, rest = text.partition(":")
            if colon and label.strip().lower() in ("scratched", "injured", "suspended"):
                # "Kirby Dach (broken foot), Alex Newhook (broken ankle)": the reasons go, the names stay.
                names = [n.strip() for n in re.sub(r"\([^)]*\)", "", rest).split(",") if n.strip() and n.strip().lower() != "none"]
                team["scratched" if label.strip().lower() == "scratched" else "injured"].extend(names)
            elif "--" in text:
                # Split on the dashes alone: the story is typed by hand ("Tony DeAngelo --Scott Mayfield").
                team["groups"].append([n.strip() for n in text.split("--") if n.strip()])
            elif not colon and len(text.split()) <= 4:
                team["goalies"].append(text)
    return out


def lineup_slots(lineup: dict, team: str, find, positions: dict) -> dict:
    """One team's parsed lineup with the NHL's player ids: {"skaters":
    {player id: slot}, ...}. A slot is "F1" (first line) to "F4" or "D1"
    (first pair) to "D3", read from the order the story lists them. A group
    is a defense pair if its players are defensemen (by this season's
    position; two names nobody knows yet count as a pair, three as a line).

    Names on a line of their own are the two goalies, starter first, but not
    always only them: a team dressing seven defensemen lists the seventh on
    his own line above the goalies ("Victor Hedman", Tampa Bay, 2026-10-13).
    A lone name the site knows as a skater, or any lone name before the last
    two, is a skater in the lineup with no line or pair (slot None)."""
    skaters, unknown, counts = {}, [], {"F": 0, "D": 0}
    alone = [(find(team, name), name) for name in lineup["goalies"]]
    in_net = [(pid, name) for pid, name in alone if pid not in positions]
    extra = [(pid, name) for pid, name in alone if pid in positions] + in_net[:-2]
    in_net = in_net[-2:]
    for names in lineup["groups"]:
        ids = [find(team, name) for name in names]
        known = [positions[pid] for pid in ids if pid in positions]
        defense = sum(pos == "D" for pos in known) > len(known) / 2 if known else len(names) == 2
        kind = "D" if defense else "F"
        counts[kind] += 1
        for pid, name in zip(ids, names):
            if pid:
                skaters[pid] = f"{kind}{counts[kind]}"
            else:
                unknown.append(name)
    for pid, name in extra:
        if pid:
            skaters.setdefault(pid, None)
        else:
            unknown.append(name)
    return {
        "skaters": skaters, "unknown": unknown, "lines": lineup["groups"],
        "goalie": (in_net[0][0] or in_net[0][1]) if in_net else None,
        "scratched": lineup["scratched"], "injured": lineup["injured"],
        "out": [pid for pid in (find(team, name) for name in lineup["scratched"] + lineup["injured"]) if pid],
    }


def fetch_lineup_story(game_id) -> dict | None:
    """{"posted", "markdown"} for one game's projected-lineups story, or None
    if it isn't up yet. Short waits: this is asked for every game on the
    slate, and a slow day at NHL.com must not hold up the deploy."""
    listing = _request(f"{STORIES}?tags.slug=gameid-{game_id}&tags.slug=game-preview&context.slug=nhl&$limit=5", tries=2, timeout=12)
    for item in listing.get("items") or []:
        story = _request(item["selfUrl"], tries=2, timeout=12)
        text = "\n".join(part.get("content") or "" for part in story.get("parts") or [] if part.get("type") == "markdown")
        if "projected lineup" in text.lower():
            return {"posted": utc_text((item.get("lastUpdatedDate") or item["contentDate"])[:19] + "Z"), "markdown": text}
    return None


def fetch_lineups(games: list, teams: dict, find, positions: dict, now_utc: datetime) -> tuple:
    """({game id: {"posted", team: lineup_slots(...)}}, error) for games that
    haven't started and are close enough to have a story. Never raises: with
    no story the Shots page falls back to each player's recent minutes."""
    team_of = team_namer(teams)
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=1)).strftime("%Y-%m-%d")
    out, error, failed = {}, None, 0
    for g in games:
        if g["status"] == "final" or g["date"] > last_day or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        if failed >= 2:
            break  # the stories aren't answering: stop asking, the rest fall back too
        try:
            story = fetch_lineup_story(g["game_id"])
            failed = 0
            if not story:
                continue
            entry = {"posted": story["posted"]}
            for label, lineup in parse_lineups(story["markdown"]).items():
                team = team_of(label)
                if team in (g["away"], g["home"]) and lineup["groups"]:
                    entry[team] = lineup_slots(lineup, team, find, positions)
            if len(entry) > 1:
                out[g["game_id"]] = entry
        except Exception as e:  # one game's story must never cost the others theirs
            error, failed = f"{g['game_id']}: {e}", failed + 1
    return out, error


def lineups_for_page(tonight: dict, goalies: dict) -> dict:
    """Tonight's lines as posted, for the page to show a player's linemates,
    who is hurt or scratched, and who is expected in net: {game id:
    {"posted", team: {"lines": [[names]], "goalie", "scratched", "injured"}}}."""
    name = lambda who: (goalies.get(who) or {}).get("name") or who
    return {
        gid: {"posted": entry["posted"], **{team: {"lines": posted["lines"], "goalie": name(posted["goalie"]), "scratched": posted["scratched"], "injured": posted["injured"]} for team, posted in entry.items() if team != "posted"}}
        for gid, entry in tonight.items()
    }


# ---- the Shots page ----
def shots_model_for(records: list):
    """The shots-on-goal model fed every finished game of this season, and
    nothing from last season (the owner's rule: see shots_model.py)."""
    model = shots_model.ShotsModel()
    for record in records:
        model.add_game(record)
    return model


def line_move(slot: str | None, usual_slot: str | None) -> str | None:
    """"up" when tonight's line is above the one his own minutes say he has
    been on ("F1" against "F3"), "down" when below, None when it is the same
    or no lineup is posted."""
    if not slot or not usual_slot or slot[0] != usual_slot[0] or slot[1:] == usual_slot[1:]:
        return None
    return "up" if int(slot[1:]) < int(usual_slot[1:]) else "down"


def shot_row(model, player: dict, opp: str, home: bool, rest, opp_rest, out: bool, slot: str | None = None) -> dict | None:
    """One skater's projection for one game, with what it is made of. `slot`
    = his line or pair in the NHL's projected lineup ("F1" ... "D3"), when
    one is posted: the projection then moves with tonight's line."""
    proj = model.project(player["id"], opp, home, rest, opp_rest, player["team"], slot)
    if proj is None:
        return None
    usual = proj["base"] * math.exp(model.w["scale"])
    games = proj["games"]
    usual_slot = model.usual_slot(player["id"], player["team"])
    return {
        "id": player["id"], "name": player["name"], "team": player["team"], "opp": opp, "home": home, "pos": player["pos"], "out": out,
        # What his game log says, plain: shots on goal a game this season.
        "games": games, "avg": round(proj["season"]["sog"] / games, 2) if games else None,
        # mean = usual x matchup: his shot rate in tonight's minutes, then what tonight changes.
        "mean": round(proj["mean"], 2), "usual": round(usual, 2), "matchup": round(proj["mean"] / usual, 3) if usual else 1.0,
        # Tonight's line, the one his own minutes say he has been on, what tonight's line
        # plays, and whether that is a move up or down.
        "slot": slot, "usual_slot": usual_slot, "line_minutes": num(proj["line_minutes"], 1), "move": line_move(slot, usual_slot),
        "minutes": round(proj["minutes"], 1), "rate60": round(proj["rate"]["per_min"] * 60, 2), "att60": round(proj["rate"]["attempts"] * 60, 1),
        "thru": round(proj["rate"]["thru"], 3), "pp_share": round(proj["pp_share"], 3),
        "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "shares": {area: round(share, 3) for area, share in proj["shares"].items()},
        # The chance of 1 or more, 2 or more ... shots on goal.
        "chances": [round(shots_model.chance_at_least(proj["mean"], n), 3) for n in range(1, SHOTS_LADDER + 1)],
    }


def shots_defense(model, teams) -> dict:
    """{team: {stat: what its defense allows a game}} for the stats the
    model reads: this season's number and where it ranks (`season_rank`,
    1 = allows the most), the steadied number the model uses (`blend`: this
    season mixed with a league-average defense, and its `rank`), and the
    league's number."""
    stats = ["sog", "f_sog", "d_sog", "pp_unb", *(f"a_{area}" for area in AREAS)]
    out = {team: {key: model.allowed(team, key) for key in stats} for team in teams}
    games_played = {team: (model.teams.get(team) or {}).get("games", 0) for team in teams}
    for key in stats:
        order = sorted(out, key=lambda team: -out[team][key]["blend"])
        # The rank a person would quote: this season's own number, most allowed first.
        plain = sorted(out, key=lambda team: -(out[team][key]["season"] or 0))
        for team in out:
            row = out[team][key]
            out[team][key] = {
                "season": num(row["season"]), "blend": num(row["blend"]), "league": num(row["league"]),
                "factor": num(row["factor"], 3), "rank": order.index(team) + 1, "season_rank": plain.index(team) + 1, "games": games_played[team],
            }
    return out


def shots_board(model, games: list, lineups: dict, injuries: dict, records: list, previous: dict | None, now_utc: datetime, tonight: dict | None = None, skaters: dict | None = None, player_odds: dict | None = None) -> dict:
    """{game id: {"locked", "players": [rows]}} for the Shots page. A game
    that hasn't started gets fresh projections; one that has started keeps
    the last build's (the same lock as the lines: a projection made after
    puck drop would already know the game), and a finished one gets each
    player's real shots on goal next to it.

    Who is projected: the skaters in the NHL's projected lineup for the game
    (`tonight`: fetch_lineups), each on the line it lists him on. Until that
    is posted: the team's usual lineup by ice time (`lineups`), less anyone
    ESPN lists as out.

    `first_sog` = the first main line and prices the site saw for him
    ({line, over, under}, carried from the live shots.json), for the
    record's closing line value."""
    prev_games = (previous or {}).get("games") or {}
    finished = {str(r["id"]): r for r in records}
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    out = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        if started:
            kept = prev_games.get(g["game_id"])
            if not kept:
                continue
            entry = {**kept, "locked": True}
            record = finished.get(g["game_id"])
            if record:
                entry["final"] = True
                entry["players"] = [{**row, "actual": (record["skaters"].get(row["id"]) or {}).get("sog")} for row in kept["players"]]
            out[g["game_id"]] = entry
            continue
        if g["date"] > last_day:
            continue
        rows, posted = [], (tonight or {}).get(g["game_id"]) or {}
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            slots = (posted.get(team) or {}).get("skaters")
            if slots:
                # The lineup is posted: exactly the skaters it lists (a scratch or an injury isn't in it).
                dressed = [(skaters[pid], slot, False) for pid, slot in slots.items() if pid in (skaters or {})]
            else:
                out_ids = {p["id"] for p in injuries.get(team) or [] if p.get("id") and p.get("status") in OUT_STATUSES}
                dressed = [(player, None, player["id"] in out_ids) for player in lineups.get(team) or []]
            seen = {row["id"]: row.get("first_sog") for row in (prev_games.get(g["game_id"]) or {}).get("players") or []}
            for player, slot, is_out in dressed:
                row = shot_row(model, {**player, "team": team}, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), is_out, slot)
                if row:
                    market = (((player_odds or {}).get(g["game_id"]) or {}).get(player["id"]) or {}).get("sog")
                    row["first_sog"] = seen.get(player["id"]) or ({k: market.get(k) for k in ("line", "over", "under")} if market else None)
                    rows.append(row)
        if rows:
            out[g["game_id"]] = {"locked": False, "posted": posted.get("posted"), "players": sorted(rows, key=lambda row: -row["mean"])}
    return out


# ---- the Shots record ----
def break_even(american: int) -> float:
    """The chance a price needs to break even (-150 -> 0.6, +150 -> 0.4)."""
    return -american / (100 - american) if american < 0 else 100 / (american + 100)


def shots_play(chance_over: float, line: float, over, under, avg=None, move=None) -> dict | None:
    """The side of a main line the model likes more, at the book's price
    (the page's "Best side": shots.js pickSide).
    `fade` = the play goes against his own season average (an under on a line
    he averages more than, or the other way round): the model thinks a small
    sample has run hot or cold.
    `size` = how the page files it: "strong" / "lean" / "none" by the edge, or
    "check" (set apart, not a play) when the gap is too big to take at face
    value OR the play goes against tonight's line change: an under on a
    player moved up a line (`move` "up"), an over on one moved down. His games
    so far don't describe the role he has tonight, and the book knows it."""
    sides = [(side, price, chance) for side, price, chance in (("over", over, chance_over), ("under", under, 1 - chance_over)) if price is not None]
    if not sides:
        return None
    side, price, chance = max(sides, key=lambda x: x[2] - break_even(x[1]))
    edge = chance - break_even(price)
    fade = avg is not None and (avg > line if side == "under" else avg < line)
    against_move = move == ("up" if side == "under" else "down")
    size = next((key for key in ("check", "strong", "lean") if edge >= SHOTS_EDGES[key]), "none")
    if against_move and size != "none":
        size = "check"
    return {"side": side, "line": line, "price": price, "chance": chance, "edge": edge, "fade": fade, "against_move": against_move, "size": size}


def record_finished_games(folder: Path, board: dict, player_odds: dict, games: list) -> int:
    """Adds each newly finished game to the record: every player who had a
    main shots-on-goal line and played, with the projection and the prices
    that were locked before puck drop and his real shots on goal. A game is
    written once and never changed. Returns how many were added."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = []
            for row in entry["players"]:
                market = ((player_odds.get(g["game_id"]) or {}).get(row["id"]) or {}).get("sog")
                need = math.floor(market["line"]) + 1 if market else 0
                if not market or row.get("actual") is None or not 1 <= need <= len(row["chances"]):
                    continue
                first = row.get("first_sog") or {}
                plays.append([row["id"], row["name"], row["team"], market["line"], market.get("over"), market.get("under"), row["mean"], row["chances"][need - 1], row["actual"], row.get("avg"), row.get("move"),
                              first.get("line"), first.get("over"), first.get("under")])
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "plays": plays}
        if len(saved["games"]) > before:
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def shots_record_summary(folder: Path) -> dict:
    """The record so far, by how big the edge was when the game locked:
    wins, losses and units won risking 1 unit a play at the locked price.
    `fade` / `with` split the called plays by whether they went against the
    player's own season average: the record of "the model doesn't believe his
    hot (or cold) start" next to everything else.

    Also the plays themselves (the owner, 2026-10-13: "a way to see plays that
    declared any edge and have a record of it, possibly grouped into buckets"):
    `days` = every day's tally of the plays with an edge (lean + strong),
    oldest first, and `plays` = each graded play that declared an edge
    (lean, strong or check) on the latest SHOTS_RECORD_DAYS days, newest day
    first and biggest edge first within a day."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "check": tally(), "strong": tally(), "lean": tally(), "none": tally(), "over": tally(), "under": tally(), "fade": tally(), "with": tally(),
           "clv": {"plays": 0, "points": 0.0, "priced": 0, "shortened": 0, "drifted": 0}}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, line, over, under, mean, chance_over, actual, *rest in game["plays"]:
                # Rows saved before these were kept have none of them.
                avg, move, first_line, first_over, first_under = (*rest, None, None, None, None, None)[:5]
                play = shots_play(chance_over, line, over, under, avg, move)
                if play is None or actual == line:
                    continue
                won = (actual > line) == (play["side"] == "over")
                units = (100 / -play["price"] if play["price"] < 0 else play["price"] / 100) if won else -1.0
                size = play["size"]
                # Overs against unders, and plays against his season average
                # ("fade") against plays with it: only the plays the page calls an edge.
                called = [play["side"], "fade" if play["fade"] else "with"] if size in ("strong", "lean") else []
                for key in (size, *called):
                    out[key]["wins" if won else "losses"] += 1
                    out[key]["units"] = round(out[key]["units"] + units, 2)
                if size == "none":
                    continue
                if called and first_line is not None:
                    # Closing line value: from the first line and price the site saw to the locked one.
                    # Same line: how far the play's price moved, in points of chance (+ = shortened,
                    # the market moved to the model). A moved line counts by direction only (an over
                    # whose line went up, an under whose line went down: the market agreed).
                    clv = out["clv"]
                    clv["plays"] += 1
                    first_price = first_over if play["side"] == "over" else first_under
                    moved = None
                    if first_line == line and first_price is not None:
                        moved = break_even(play["price"]) - break_even(first_price)
                        clv["priced"] += 1
                        clv["points"] += moved
                    elif first_line != line:
                        moved = (line - first_line) * (1 if play["side"] == "over" else -1)
                    if moved is not None and abs(moved) > 0.0005:
                        clv["shortened" if moved > 0 else "drifted"] += 1
                if called:
                    day = days.setdefault(game["date"], tally())
                    day["wins" if won else "losses"] += 1
                    day["units"] = round(day["units"] + units, 2)
                plays.append({
                    "date": game["date"], "id": pid, "name": name, "team": team, "opp": game["home"] if team == game["away"] else game["away"], "home": team == game["home"],
                    "side": play["side"], "line": line, "price": play["price"], "edge": round(play["edge"], 3), "size": size, "fade": play["fade"],
                    "mean": mean, "actual": actual, "won": won, "units": round(units, 2),
                })
    out["clv"]["points"] = round(out["clv"]["points"] / out["clv"]["priced"], 4) if out["clv"]["priced"] else None  # average, per play on an unmoved line
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    latest = set(sorted({play["date"] for play in plays})[-SHOTS_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out


# ---- Goals (anytime goal scorer; goals_model.py) ----
def goals_model_for(records: list, shots: "shots_model.ShotsModel", hand: dict) -> "goals_model.GoalsModel":
    """The goals model on this season's games only: both expected-goals
    tables fitted on this season's shots, then every game added."""
    model = goals_model.GoalsModel(shots, hand)
    model.fit(records)
    for record in records:
        model.add_game(record)
    return model


def expected_goalie(team: str, posted: dict, goalies: dict) -> str | None:
    """Tonight's goalie for `team`: the NHL's projected lineup's when it is
    posted (a projection, never called confirmed), else the team's busiest
    starter this season."""
    goalie = (posted.get(team) or {}).get("goalie")
    if goalie and str(goalie).isdigit():
        return str(goalie)
    listed = goalies.get(team) or []
    return str(listed[0]["id"]) if listed and listed[0].get("id") else None


def goals_play(chance: float, odds, move=None) -> dict | None:
    """The anytime goal at the book's Yes price: the edge (model chance minus
    the chance the price needs to break even) and how the page files it,
    the Shots page's way: "strong" / "lean" / "none", or "check" (set
    apart) when the gap is too big to take at face value or he has been
    moved DOWN a line tonight (his games so far describe a bigger role)."""
    if odds is None or chance is None:
        return None
    edge = chance - break_even(odds)
    size = next((key for key in ("check", "strong", "lean") if edge >= GOALS_EDGES[key]), "none")
    against_move = move == "down"
    if against_move and size != "none":
        size = "check"
    return {"price": odds, "chance": chance, "edge": edge, "size": size, "against_move": against_move}


def goal_row(model, player: dict, opp: str, home: bool, rest, opp_rest, out: bool, slot, goalie, ranks: dict, odds: dict | None, first_odds) -> dict | None:
    """One skater's anytime-goal projection for one game, what it is made
    of, the Zone Match tag, and the book's price (with the first price seen)."""
    proj = model.project(player["id"], opp, home, rest, opp_rest, player["team"], slot, goalie)
    if proj is None:
        return None
    usual_slot = model.shots.usual_slot(player["id"], player["team"])
    move = line_move(slot, usual_slot)
    season = proj["season"]
    price = (odds or {}).get("odds")
    play = goals_play(proj["chance"], price, move)
    return {
        "id": player["id"], "name": player["name"], "team": player["team"], "opp": opp, "home": home, "pos": player["pos"], "out": out,
        "slot": slot, "usual_slot": usual_slot, "move": move, "goalie": goalie,
        # What his season says, plain.
        "games": season.get("games", 0), "goals": season.get("goals", 0), "xg": round(season.get("xg", 0.0), 2), "shots": season.get("shots", 0),
        "minutes": round(proj["minutes"], 1), "ev_min": round(proj["ev_min"], 1), "pp_min": round(proj["pp_min"], 1), "xg60": round(proj["rate60"], 3),
        # Tonight: expected goals, the chance of 1+, its fair price, what each piece did.
        "mean": round(proj["mean"], 3), "chance": round(proj["chance"], 3), "fair": shots_model.fair_american(proj["chance"]),
        "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "shares": {area: round(share, 3) for area, share in proj["shares"].items()},
        "zone": model.zone_match(player["id"], opp, ranks),
        "odds": price, "no_odds": (odds or {}).get("no_odds"), "thin": (odds or {}).get("thin"),
        "first_odds": first_odds if first_odds is not None else price,
        "edge": round(play["edge"], 3) if play else None, "size": play["size"] if play else None,
    }


def goals_board(model, games: list, lineups: dict, injuries: dict, records: list, previous: dict | None, now_utc: datetime,
                tonight: dict | None, skaters: dict | None, goalies: dict, player_odds: dict) -> dict:
    """{game id: {"locked", "players": [rows]}} for the Goals page: the same
    games, players and lock as the Shots page (shots_board). Every skater is
    projected, with a price or not (the owner: Novig has no liquidity on
    every player; the fair price is there to shop). A started game keeps the
    last build's rows; a finished one gets each player's real goals."""
    prev_games = (previous or {}).get("games") or {}
    finished = {str(r["id"]): r for r in records}
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    ranks = {area: model.area_ranks(area) for area in goals_model.ZONE["areas"]}
    out = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        if started:
            kept = prev_games.get(g["game_id"])
            if not kept:
                continue
            entry = {**kept, "locked": True}
            record = finished.get(g["game_id"])
            if record:
                entry["final"] = True
                entry["players"] = [{**row, "actual": (record["skaters"].get(row["id"]) or {}).get("g")} for row in kept["players"]]
            out[g["game_id"]] = entry
            continue
        if g["date"] > last_day:
            continue
        posted = (tonight or {}).get(g["game_id"]) or {}
        seen = {row["id"]: row for row in (prev_games.get(g["game_id"]) or {}).get("players") or []}
        odds = player_odds.get(g["game_id"]) or {}
        rows = []
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            slots = (posted.get(team) or {}).get("skaters")
            if slots:
                dressed = [(skaters[pid], slot, False) for pid, slot in slots.items() if pid in (skaters or {})]
            else:
                out_ids = {p["id"] for p in injuries.get(team) or [] if p.get("id") and p.get("status") in OUT_STATUSES}
                dressed = [(player, None, player["id"] in out_ids) for player in lineups.get(team) or []]
            goalie = expected_goalie(opp, posted, goalies)
            for player, slot, is_out in dressed:
                mine = (odds.get(player["id"]) or {}).get("goal")
                first = (seen.get(player["id"]) or {}).get("first_odds")
                row = goal_row(model, {**player, "team": team}, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), is_out, slot, goalie, ranks, mine, first)
                if row:
                    rows.append(row)
        if rows:
            out[g["game_id"]] = {"locked": False, "posted": posted.get("posted"), "players": sorted(rows, key=lambda row: -row["chance"])}
    return out


GOALS_RECORD_COLS = ("id", "name", "team", "chance", "mean", "odds", "first_odds", "thin", "zone", "actual", "move")


def record_goal_games(folder: Path, board: dict, games: list) -> int:
    """Adds each newly finished game to the Goals record: every projected
    player who played (priced or not, so the chances and the Zone Match tag
    can be graded on everyone), with the chance and the prices locked before
    puck drop, the first price the site saw (for closing line value), and
    the game's locked total and moneylines (to test the market as an anchor
    later). Written once, never changed. Returns how many games were added."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": GOALS_RECORD_COLS, "games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = [[row["id"], row["name"], row["team"], row["chance"], row["mean"], row.get("odds"), row.get("first_odds"), row.get("thin"),
                      (row.get("zone") or {}).get("area"), row["actual"], row.get("move")] for row in entry["players"] if row.get("actual") is not None]
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"],
                                                "market": {k: g.get(k) for k in ("total_line", "away_ml_implied_prob", "home_ml_implied_prob")}, "plays": plays}
        if len(saved["games"]) > before:
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def goals_record_summary(folder: Path) -> dict:
    """The Goals record so far.
      * By edge bucket (strong / lean / none / check), the Zone Match tag
        (`zone`) and thin prices (`thin`): wins, losses and units risking 1
        a play at the locked Yes price.
      * `clv`: closing line value on the called plays (lean + strong): how
        far the price moved from the first one the site saw to the locked one,
        in points of chance (+ = shortened, the market moved to the model).
        Hundreds of plays say more here than a season of wins and losses.
      * `honest`: every graded player (priced or not) by what the model said
        against how often he scored; `zone_all` the same for every tagged player.
      * `days` and `plays` (latest GOALS_RECORD_DAYS days), as the Shots record."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "players": 0, **{k: tally() for k in ("strong", "lean", "none", "check", "zone", "thin")},
           "clv": {"plays": 0, "points": 0.0, "shortened": 0, "drifted": 0},
           "honest": [{"lo": lo, "hi": hi, "players": 0, "said": 0.0, "scored": 0} for lo, hi in zip(GOALS_HONEST, GOALS_HONEST[1:])],
           "zone_all": {"players": 0, "said": 0.0, "scored": 0}}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, chance, mean, odds, first_odds, thin, zone, actual, move in game["plays"]:
                scored = actual > 0
                out["players"] += 1
                for bucket in out["honest"]:
                    if bucket["lo"] <= chance < bucket["hi"]:
                        bucket["players"] += 1
                        bucket["said"] += chance
                        bucket["scored"] += scored
                if zone:
                    out["zone_all"]["players"] += 1
                    out["zone_all"]["said"] += chance
                    out["zone_all"]["scored"] += scored
                play = goals_play(chance, odds, move)
                if play is None:
                    continue
                units = (100 / -odds if odds < 0 else odds / 100) if scored else -1.0
                size = play["size"]
                for key in (size, *(["zone"] if zone else []), *(["thin"] if thin else [])):
                    out[key]["wins" if scored else "losses"] += 1
                    out[key]["units"] = round(out[key]["units"] + units, 2)
                if size == "none":
                    continue
                if size in ("strong", "lean"):
                    day = days.setdefault(game["date"], tally())
                    day["wins" if scored else "losses"] += 1
                    day["units"] = round(day["units"] + units, 2)
                    if first_odds is not None:
                        moved = break_even(odds) - break_even(first_odds)
                        out["clv"]["plays"] += 1
                        out["clv"]["points"] += moved
                        if moved > 0.0005:
                            out["clv"]["shortened"] += 1
                        elif moved < -0.0005:
                            out["clv"]["drifted"] += 1
                plays.append({
                    "date": game["date"], "id": pid, "name": name, "team": team, "opp": game["home"] if team == game["away"] else game["away"], "home": team == game["home"],
                    "price": odds, "first": first_odds, "chance": chance, "edge": round(play["edge"], 3), "size": size, "zone": zone, "thin": thin,
                    "actual": actual, "won": scored, "units": round(units, 2),
                })
    for bucket in out["honest"]:
        bucket["said"] = round(bucket["said"], 2)
    out["zone_all"]["said"] = round(out["zone_all"]["said"], 2)
    n = out["clv"]["plays"]
    out["clv"]["points"] = round(out["clv"]["points"] / n, 4) if n else None  # average, per play
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    latest = set(sorted({play["date"] for play in plays})[-GOALS_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out


def goals_defense(model, teams) -> dict:
    """{team: what its defense allows: expected goals a game (`season`, the
    steadied `blend` the model reads, `factor` against the league, `rank`
    1 = allows the most), and shots a game from the low slot and the slot with
    their ranks (what the Zone Match tag reads)}."""
    out = {team: {"xg": model.allowed(team, "xg")} for team in teams}
    order = sorted(out, key=lambda team: -out[team]["xg"]["blend"])
    for area in goals_model.ZONE["areas"]:
        ranks = model.area_ranks(area)
        for team in out:
            t = model.teams.get(team) or {}
            out[team][area] = {"season": num(t.get(f"n_{area}", 0) / t["games"]) if t.get("games") else None, "rank": ranks.get(team)}
    for team in out:
        row = out[team]["xg"]
        out[team]["xg"] = {"season": num(row["season"]), "blend": num(row["blend"]), "factor": num(row["factor"], 3), "rank": order.index(team) + 1}
    return out


def goals_file(season: int, generated_at: str, records: list, shots, games: list, lineups: dict, injuries: dict, previous: dict | None,
               now_utc: datetime, tonight: dict | None, skaters: dict, goalies: dict, player_odds: dict, record_dir: Path) -> dict:
    """site/nhl/goals.json: the board, the rules, the expected-goals tables and the record."""
    hand = {pid: s.get("shoots") for pid, s in skaters.items() if s.get("shoots")}
    model = goals_model_for(records, shots, hand)
    board = goals_board(model, games, lineups, injuries, records, previous, now_utc, tonight, skaters, goalies, player_odds)
    try:
        record_goal_games(record_dir, board, games)
        record = goals_record_summary(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Goals record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    lg = model.league
    return {
        "season": season, "generated_at": generated_at, "weights": model.w, "edges": GOALS_EDGES, "zone": goals_model.ZONE,
        "xg": {"names": goals_model.XG_NAMES, "base": model.xg[False], "wing": model.xg[True], "shots": sum(lg[f"n_{a}"] for a in AREAS)},
        "league": {"goals_per_shot": num(lg["g"] / sum(lg[f"n_{a}"] for a in AREAS), 4) if lg["g"] else None, "xg_per_team_game": num(lg["xg"] / lg["team_games"]) if lg["team_games"] else None},
        "games": board, "defense": goals_defense(model, list(model.teams)), "record": record,
    }


# ---- King of the Crease (the Promo Tools page) ----
def saves_model_for(records: list):
    """The saves model fed every finished game of this season, and nothing
    from last season (the owner's rule for the NHL prop tools)."""
    model = saves_model.SavesModel()
    for record in records:
        model.add_game(record)
    return model


def last_starters(records: list) -> dict:
    """{team: the id of the goalie who started its latest game}."""
    out = {}
    for record in records:  # in date order
        for pid, line in record["goalies"].items():
            if line["start"]:
                out[line["team"]] = pid
    return out


def crease_starter(posted: dict | None, listed: list, team_goalies: list, all_goalies: dict, rest, last_start) -> dict:
    """Who should start in net for a team tonight. NOTHING the site can read
    is a confirmation: starters are official at warmups, and no feed carries
    that. There are two outside sources, and each is one opinion:
      * the first goalie in the NHL's projected lineup for the game. Right
        92% of the time in 2025-26 (2,378 of 2,583), written around midday,
        sometimes with no morning skate to go on. When it named the goalie
        who had started the night before, it was right 55% of the time.
      * the goalie the book has a saves line for. Books post the expected
        starter and take the line down when that changes.
    `source` says how much stands behind the name:
      "both"    the two agree (the page's check mark)
      "split"   they name different goalies: the book's is shown, since it
                is the later and the one with money behind it, and `other`
                carries the name the NHL's lineup has (Jake Allen against
                Nico Daws, New Jersey, 2026-10-13: the book was right)
      "lineup" / "market"   only one of them has spoken
      "usual"   neither: the goalie with the most starts this season, or the
                other one on the second night of a back-to-back he started
                the first night of
    `doubt` = the lineup alone names the goalie who started last night.
    Returns {"id" (None for a goalie with no game this season), "name" (None
    when nobody can be named), "source", "other", "doubt"}. The promo moves a
    pick to whoever does start for the team, so a wrong name never changes
    whose saves count; it must still never be shown as settled."""
    usual = team_goalies[0] if team_goalies else None
    if usual and rest == 1 and last_start == usual["id"] and len(team_goalies) > 1:
        usual = team_goalies[1]

    def named(who, name=None):
        """{"id", "name"} for an id the site knows, or a goalie it doesn't (by the name given)."""
        known = all_goalies.get(who)
        return {"id": known["id"] if known else None, "name": known["name"] if known else name or who}

    same = lambda a, b: bool(a and b) and ((a["id"] and a["id"] == b["id"]) or plain(a["name"]) == plain(b["name"]))
    lineup = named(posted["goalie"]) if posted and posted.get("goalie") else None
    # Two goalies listed for one team: the one the lineup has, else the usual starter, else the first.
    priced = [named(row["id"], row["name"]) for row in listed]
    market = next((g for g in priced if same(g, lineup)), None) or next((g for g in priced if usual and g["id"] == usual["id"]), None) or (priced[0] if priced else None)
    if lineup and market:
        if same(lineup, market):
            return {**market, "source": "both", "other": None, "doubt": False}
        return {**market, "source": "split", "other": lineup["name"], "doubt": False}
    if lineup:
        return {**lineup, "source": "lineup", "other": None, "doubt": rest == 1 and bool(lineup["id"]) and lineup["id"] == last_start}
    if market:
        return {**market, "source": "market", "other": None, "doubt": False}
    return {"id": usual["id"] if usual else None, "name": usual["name"] if usual else None, "source": "usual", "other": None, "doubt": False}


def crease_line(starter: dict, listed: list) -> dict | None:
    """The book's saves line for that goalie, if it lists him."""
    for row in listed:
        if (starter["id"] and row["id"] == starter["id"]) or (starter["name"] and plain(row["name"]) == plain(starter["name"])):
            return row
    return None


def crease_team_ranks(model) -> dict:
    """{team: {"shots": rank, "allowed": rank}}: where each team ranks this
    season for shots on goal a game (1 = the most) and for shots on goal
    allowed a game (1 = allows the most). Either way 1 = more work for a goalie."""
    out = {team: {} for team in model.teams}
    for key, side in (("shots", "for"), ("allowed", "against")):
        order = sorted(model.teams, key=lambda team: -(model.team_rate(team, side, "sog")["season"] or 0))
        for team in out:
            out[team][key] = order.index(team) + 1
    return out


def crease_row(model, g: dict, team: str, opp: str, side: str, other: str, starter: dict, line: dict | None, ranks: dict) -> dict | None:
    """One team's starter for one game: his season so far, both sides of the
    matchup, the model's projection, the book's line, and the two blended."""
    proj = model.project(team, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), starter["id"])
    if proj is None:
        return None
    mean = proj["mean"]
    # The saves the book expects: its line and price turned back into a projection.
    mkt_mean = saves_model.mean_for_chance(line["line"], line["chance"]) if line else None
    # What his chance to lead the day is worked out from: the line, moved toward
    # the model by as much as the season so far has earned (CREASE_RULES).
    weight = CREASE_RULES["blend"] * min(1.0, min(proj["team_games"], proj["opp_games"]) / CREASE_RULES["full_games"])
    blend = weight * mean + (1 - weight) * mkt_mean if line else mean
    starts = proj["starts"]
    return {
        "game_id": g["game_id"], "team": team, "opp": opp, "home": side == "home", "locked": False,
        "id": starter["id"], "name": starter["name"], "source": starter["source"], "other": starter["other"], "doubt": starter["doubt"],
        # His season so far, as his game log says it.
        "starts": starts, "saves_avg": num(proj["start_saves"] / starts, 1) if starts else None, "sv_pct": ratio(proj["sa"] - proj["ga"], proj["sa"]), "high": proj["high"] or None,
        # Both sides of the matchup: what the other team puts on net a game, and what his own team gives up.
        "opp_shots": num(proj["off"]["season"], 1), "opp_shots_rank": (ranks.get(opp) or {}).get("shots"),
        "allowed": num(proj["def"]["season"], 1), "allowed_rank": (ranks.get(team) or {}).get("allowed"),
        "b2b": g.get(f"{side}_rest") == 1, "opp_b2b": g.get(f"{other}_rest") == 1,
        "shots": num(proj["shots"], 1), "mean": num(mean), "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "line": line["line"] if line else None, "over": line["over"] if line else None, "under": line["under"] if line else None,
        "thin": line["thin"] if line else None, "alts": line["alts"] if line else [],
        "mkt_mean": num(mkt_mean), "blend": num(blend), "weight": round(weight, 3) if line else None,
        # Model and line too far apart to take at face value.
        "check": bool(line) and abs(mean - mkt_mean) >= CREASE_RULES["check"],
        "big": round(saves_model.chance_at_least(blend, CREASE_RULES["big_night"]), 3),
    }


def crease_chances(rows: list) -> None:
    """Each open row's chance to finish with the day's most saves (`top`),
    what that chance would be if he were exactly what his line says against
    the same field (`mkt_top`), and the first over the second (`value`: above
    1, the market may be underselling him). Only his own number changes
    between the two, so a value can't come from the rest of the day's goalies.
    A goalie whose game is final counts as what he made, so a late game's
    chance is the chance to catch the leader; a started game's rows keep the
    numbers they locked with."""
    spreads = [saves_model.known_spread(row["actual"]) if row.get("actual") is not None else saves_model.save_spread(row["blend"]) for row in rows]
    ceilings = [saves_model.at_most(spread) for spread in spreads]
    for i, row in enumerate(rows):
        if row["locked"]:
            continue
        field = ceilings[:i] + ceilings[i + 1:]
        chance = saves_model.lead_chance(spreads[i], field)
        line_chance = saves_model.lead_chance(saves_model.save_spread(row["mkt_mean"]), field) if row["line"] is not None else None
        row["top"] = round(chance, 4)
        row["mkt_top"] = round(line_chance, 4) if line_chance is not None else None
        row["value"] = round(chance / line_chance, 3) if line_chance else None


def crease_tags(rows: list) -> None:
    """The two tags, on the rows still open:
      "upside"  the best chances to lead the day (CREASE_RULES "upside", one
                for every four starters on a short slate)
      "value"   his chance is well above what his line alone says ("value"),
                he has a real chance to begin with ("floor"), and the gap
                isn't one to check for news first ("check")"""
    open_rows = [row for row in rows if not row["locked"]]
    best = sorted(open_rows, key=lambda row: -row["top"])[:max(1, min(CREASE_RULES["upside"], round(len(open_rows) / 4)))]
    floor = CREASE_RULES["floor"] / len(rows) if rows else 0
    for row in open_rows:
        tags = ["upside"] if any(row is top for top in best) else []
        if row["value"] is not None and row["value"] >= CREASE_RULES["value"] and row["top"] >= floor and not row["check"]:
            tags.append("value")
        row["tags"] = tags


def crease_board(model, games: list, tonight: dict | None, saves_lines: dict | None, goalies: dict, records: list, previous: dict | None, now_utc: datetime) -> dict:
    """{date: {"goalies": [rows], "final", "best"}} for King of the Crease:
    one row per team playing that day, named for its expected starter. Same
    lock as the lines: a game that has started keeps the rows of the last
    build before puck drop (with nothing saved it has no rows, never ones
    made after the puck dropped), and a finished one gets `actual`: the saves
    of the goalie who did start, which is who the promo counts. Once every
    game of a day is final, `best` is the day's top total and `led` marks who
    made it."""
    all_goalies = {row["id"]: row for rows in goalies.values() for row in rows}
    kept_rows = {(row["game_id"], row["team"]): row for day in ((previous or {}).get("days") or {}).values() for row in day.get("goalies") or []}
    finished = {str(r["id"]): r for r in records}
    last_start = last_starters(records)
    ranks = crease_team_ranks(model)
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    starters_in = lambda record: [line for line in record["goalies"].values() if line["start"]]
    days = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        if not started and g["date"] > last_day:
            continue
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            if started:
                kept = kept_rows.get((g["game_id"], team))
                if not kept:
                    continue
                row = {**kept, "locked": True}
                played = next((line for line in starters_in(finished[g["game_id"]]) if line["team"] == team), None) if g["game_id"] in finished else None
                if played:
                    row["actual"], row["started"] = played["sa"] - played["ga"], played["name"]
            else:
                listed = ((saves_lines or {}).get(g["game_id"]) or {}).get(team) or []
                starter = crease_starter(((tonight or {}).get(g["game_id"]) or {}).get(team), listed, goalies.get(team) or [], all_goalies, g.get(f"{side}_rest"), last_start.get(team))
                # Tomorrow's second night of a back-to-back reads tonight's expected starter.
                last_start[team] = starter["id"]
                row = crease_row(model, g, team, opp, side, other, starter, crease_line(starter, listed), ranks)
                if not row:
                    continue
            days.setdefault(g["date"], []).append(row)
    out = {}
    for date, rows in days.items():
        crease_chances(rows)
        crease_tags(rows)
        day_games = [g for g in games if g["date"] == date]
        final = all(g["game_id"] in finished for g in day_games)
        best = max((line["sa"] - line["ga"] for g in day_games for line in starters_in(finished[g["game_id"]])), default=None) if final else None
        if final:
            for row in rows:
                if row.get("actual") is not None:
                    row["led"] = row["actual"] == best
        out[date] = {"goalies": sorted(rows, key=lambda row: -(row.get("top") or 0)), "starters": 2 * len(day_games), "final": final, "best": best}
    return out


def record_crease_days(folder: Path, board: dict) -> int:
    """Adds each finished day to the record: every goalie who had a row and
    started, with the projection, the line and the chances that were locked
    before puck drop, and what he made. A day is written once and never
    changed. Returns how many were added."""
    added = 0
    for month in sorted({date[:7] for date, day in board.items() if day["final"]}):
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": list(CREASE_RECORD_COLS), "days": {}}
        before = len(saved["days"])
        for date, day in sorted(board.items()):
            if not day["final"] or date[:7] != month or date in saved["days"]:
                continue
            rows = [[row.get(col) for col in saved["cols"]] for row in day["goalies"] if row.get("actual") is not None and row.get("top") is not None]
            if rows:
                saved["days"][date] = {"best": day["best"], "starters": day["starters"], "goalies": rows}
        if len(saved["days"]) > before:
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["days"]) - before
    return added


def crease_record_summary(folder: Path) -> dict:
    """The record so far, in the promo's own terms:
      favorite  the day's highest chance: how often he led (or tied for) the
                day, next to how often his chances said he would (`said`)
      upside    the Upside tags: days one of them led, of the days recorded
      value     the Value tags: how many led, next to what the chances said
                (`said`) and what their lines alone said (`line_said`)
      miss      on goalies with a line, the average miss in saves of the
                model, of the line, and of the two blended"""
    out = {
        "since": None, "through": None, "days": 0,
        "favorite": {"led": 0, "said": 0.0}, "upside": {"days_led": 0, "tagged": 0, "led": 0, "said": 0.0},
        "value": {"tagged": 0, "led": 0, "said": 0.0, "line_said": 0.0}, "miss": {"goalies": 0, "model": 0.0, "line": 0.0, "blend": 0.0},
    }
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in sorted(saved["days"].items()):
            rows = [dict(zip(saved["cols"], values)) for values in day["goalies"]]
            if not rows:
                continue
            out["days"] += 1
            out["since"] = min(out["since"] or date, date)
            out["through"] = max(out["through"] or date, date)
            led = lambda row: row["actual"] == day["best"]
            favorite = max(rows, key=lambda row: row["top"])
            out["favorite"]["led"] += led(favorite)
            out["favorite"]["said"] += favorite["top"]
            tagged = [row for row in rows if "upside" in (row["tags"] or [])]
            out["upside"]["days_led"] += any(led(row) for row in tagged)
            for key, group in (("upside", tagged), ("value", [row for row in rows if "value" in (row["tags"] or [])])):
                out[key]["tagged"] += len(group)
                out[key]["led"] += sum(led(row) for row in group)
                out[key]["said"] += sum(row["top"] for row in group)
            out["value"]["line_said"] += sum(row["mkt_top"] or 0 for row in rows if "value" in (row["tags"] or []))
            for row in rows:
                if row["mkt_mean"] is not None:
                    out["miss"]["goalies"] += 1
                    for key, col in (("model", "mean"), ("line", "mkt_mean"), ("blend", "blend")):
                        out["miss"][key] += abs(row["actual"] - row[col])
    n = out["miss"]["goalies"]
    for key in ("model", "line", "blend"):
        out["miss"][key] = round(out["miss"][key] / n, 2) if n else None
    for group in ("favorite", "upside", "value"):
        for key in ("said", "line_said"):
            if key in out[group]:
                out[group][key] = round(out[group][key], 2)
    return out


CREASE_HISTORY_COLS = ("id", "name", "team", "line", "top", "actual")


def crease_history(folder: Path) -> dict:
    """Every recorded day for the page's Winners list: `best`, `starters`
    and each goalie as `CREASE_HISTORY_COLS`, highest pregame chance first
    (so his place in the list is his pregame rank). The payouts DraftKings
    showed are typed in by the owner on the page (D1 `crease_payouts`), not
    here."""
    out = {}
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in saved["days"].items():
            rows = sorted((dict(zip(saved["cols"], values)) for values in day["goalies"]), key=lambda row: -(row["top"] or 0))
            if rows:
                out[date] = {"best": day["best"], "starters": day["starters"], "goalies": [[row.get(col) for col in CREASE_HISTORY_COLS] for row in rows]}
    return {"cols": list(CREASE_HISTORY_COLS), "days": dict(sorted(out.items()))}


def crease_file(season: int, generated_at: str, records: list, games: list, tonight: dict | None, saves_lines: dict | None, goalies: dict, previous: dict | None, now_utc: datetime, record_dir: Path) -> dict:
    """site/nhl/crease.json: the board, the rules it was tagged by, the
    league's yardsticks and the record."""
    model = saves_model_for(records)
    board = crease_board(model, games, tonight, saves_lines, goalies, records, previous, now_utc)
    try:
        record_crease_days(record_dir, board)
        record = crease_record_summary(record_dir)
        history = crease_history(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the King of the Crease record couldn't be updated ({e}).", file=sys.stderr)
        record, history = None, None
    return {
        "season": season, "generated_at": generated_at, "weights": model.w, "rules": CREASE_RULES,
        "league": {"saves": num(model.base(), 1), "sv": num(model.league_sv(), 4), "shots": num(model.per_game("sog"), 1)},
        "days": board, "record": record, "history": history,
    }




# ---- SportsGameOdds: is DraftKings' first goal scorer price there? ----
# The owner, 2026-10-15, after SmartStake turned out to have no NHL first
# goal scorer market: "check sgo for dk first goal prices". SGO's docs list a
# hockey statID `firstToScore` by player; whether its FREE tier carries
# DraftKings' price for it is what this finds out. SGO bills per EVENT
# returned and the free tier's 2,500 a month is shared with the NFL build, so
# this asks for ONE event, and none at all once a build has seen a DraftKings
# price (that answer rides forward in the live data.json). Only the deploy's
# NHL step has the key, not the hourly refresh.
SGO_EVENTS_URL = "https://api.sportsgameodds.com/v2/events"


def sgo_first_goal_summary(event: dict) -> dict:
    """What one SGO event says about player first goal prices: how many
    players are priced, by which books, and a few of DraftKings' prices."""
    odds = [o for o in (event.get("odds") or {}).values() if o.get("statID") == "firstToScore" and o.get("playerID") and o.get("sideID") == "yes"]
    priced = lambda o, book: ((o.get("byBookmaker") or {}).get(book) or {})
    books = Counter(book for o in odds for book, info in (o.get("byBookmaker") or {}).items() if info.get("available") and info.get("odds") is not None)
    dk = [[o["playerID"], priced(o, "draftkings")["odds"]] for o in odds if priced(o, "draftkings").get("available") and priced(o, "draftkings").get("odds") is not None]
    return {"event": event.get("eventID"), "players": len(odds), "books": dict(books.most_common()), "draftkings": len(dk), "sample": dk[:3]}


def probe_sgo_first_goal(api_key: str | None, previous: dict | None) -> dict:
    """book_odds_debug["sgo_first_goal"]: the answer so far (see above)."""
    seen = ((previous or {}).get("book_odds_debug") or {}).get("sgo_first_goal") or {}
    if seen.get("draftkings"):
        return seen
    if not api_key:
        return {"skipped": "no SGO_API_KEY"}
    try:
        query = urllib.parse.urlencode({"leagueID": "NHL", "oddsAvailable": "true", "limit": 1, "apiKey": api_key})
        req = urllib.request.Request(f"{SGO_EVENTS_URL}?{query}", headers={"User-Agent": "Mozilla/5.0 (compatible; nfl-tool/1.0)"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
        events = payload.get("data") or []
        if not payload.get("success") or not events:
            return {"note": str(payload.get("notice") or "no NHL events with odds")[:200]}
        return sgo_first_goal_summary(events[0])
    except Exception as e:  # never the URL: it carries the key
        return {"error": f"{type(e).__name__}: {getattr(e, 'code', '')} {getattr(e, 'reason', '')}"[:200]}


# ---- Icebreaker (the Promo Tools page) ----
# DraftKings' promo: everyone with a qualifying first goal scorer bet on the
# player who scores the QUICKEST goal of the 7:00 PM ET slate (game clock, not
# wall clock) splits $250K. A replay of 2024-25 and 2025-26
# (tools/backtest/nhl_icebreaker.py) found that who scores early is who scores:
# a player's scoring rate x his ice time beat every "fast start" number, his
# early shots and the first shift. Under a steady scoring rate, a player's
# chance to score the slate's first goal is his expected goals tonight over
# everyone's, so `rate` is the Goals model's mean, moved toward his anytime
# price the way King of the Crease leans on the saves line. The page divides
# by the games the member picks. The fast-start numbers are shown, never used.
ICEBREAKER_RULES = {"blend": 0.5, "full_games": 20, "slot": "19:00"}
ICEBREAKER_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_icebreaker"
ICEBREAKER_RECORD_COLS = ("id", "name", "team", "rate", "mean", "mkt_mean", "fg")


def fast_starts(records: list) -> dict:
    """{team: {"gp", "first" (games it scored the game's first goal),
    "first_time" (the middle game's time of its own first goal, in seconds;
    None when it went scoreless in more than half), "sog5" / "sog5_against"
    (shots on goal a game in the first five minutes, and allowed)}}.
    This season's games; shown on the page, never in the chances."""
    teams = {}
    for r in records:
        first = r.get("first_goal")
        for team, opp in ((r["home"], r["away"]), (r["away"], r["home"])):
            row = teams.setdefault(team, {"gp": 0, "first": 0, "times": [], "sog5": 0, "sog5_against": 0})
            row["gp"] += 1
            row["first"] += bool(first) and first["team"] == team
            row["times"].append((r.get("first_goals") or {}).get(team))
            row["sog5"] += (r["teams"].get(team) or {}).get("sog_early", 0)
            row["sog5_against"] += (r["teams"].get(opp) or {}).get("sog_early", 0)
    out = {}
    for team, row in teams.items():
        times = sorted(row["times"], key=lambda t: float("inf") if t is None else t)
        out[team] = {
            "gp": row["gp"], "first": row["first"], "first_time": times[(len(times) - 1) // 2],
            "sog5": num(row["sog5"] / row["gp"]), "sog5_against": num(row["sog5_against"] / row["gp"]),
        }
    return out


def first_goal_prices(book_odds: dict, game: dict, pid: str) -> dict:
    """His first goal scorer prices from SmartStake: DraftKings' (the promo's
    book) and the best US price with its book."""
    entry = ((((book_odds or {}).get(f"{game['away']}_{game['home']}") or {}).get("props") or {}).get("first_goal") or {}).get(pid)
    quotes = [q for q in (entry or {}).get("q") or [] if q[1] == "o"]
    if not quotes:
        return {"fg": None, "fg_best": None}
    dk = next((q[3] for q in quotes if q[0] == "draftkings"), None)
    best = max(quotes, key=lambda q: q[3])
    return {"fg": dk, "fg_best": [smartstake.US_BOOKS.get(best[0], best[0]), best[3]]}


def icebreaker_row(goal_row: dict, game: dict, odds: dict | None, book_odds: dict, games_played: int) -> dict:
    """One skater's row: the Goals model's expected goals (`mean`), the
    market's (`mkt_mean`, from Novig's anytime price), and `rate` = the
    market moved toward the model by as much as the season has earned
    (ICEBREAKER_RULES, as King of the Crease); the model alone without a price."""
    chance = ((odds or {}).get("goal") or {}).get("chance")
    mkt = round(-math.log(1 - chance), 4) if chance and 0 < chance < 1 else None
    weight = ICEBREAKER_RULES["blend"] * min(1.0, games_played / ICEBREAKER_RULES["full_games"])
    rate = goal_row["mean"] if mkt is None else mkt + weight * (goal_row["mean"] - mkt)
    keep = ("id", "name", "team", "opp", "home", "pos", "slot", "usual_slot", "move", "games", "goals", "xg", "minutes")
    return {
        **{k: goal_row.get(k) for k in keep}, "game_id": game["game_id"],
        "mean": goal_row["mean"], "mkt_mean": mkt, "rate": round(rate, 4),
        **first_goal_prices(book_odds, game, goal_row["id"]),
    }


def icebreaker_board(goals_games: dict, games: list, records: list, player_odds: dict, book_odds: dict, previous: dict | None, now_utc: datetime) -> dict:
    """{date: {"games": [...], "players": [rows]}} for the Goals page's days.
    Same lock as everything else: a started game keeps the last build's rows
    (none saved = no rows, never ones made after puck drop). A finished
    game's entry gets `first`: its first goal's time and scorer."""
    kept = {}
    for day in ((previous or {}).get("days") or {}).values():
        for row in day.get("players") or []:
            kept.setdefault(row["game_id"], []).append(row)
    finished = {str(r["id"]): r for r in records}
    team_games = Counter()
    for r in records:
        team_games[r["home"]] += 1
        team_games[r["away"]] += 1
    days = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        entry = goals_games.get(g["game_id"])
        if started:
            rows = kept.get(g["game_id"]) or []
        elif entry:
            played = min(team_games[g["away"]], team_games[g["home"]])
            odds = player_odds.get(g["game_id"]) or {}
            rows = [icebreaker_row(row, g, odds.get(row["id"]), book_odds, played) for row in entry["players"] if not row.get("out")]
        else:
            continue
        if not rows and not started:
            continue
        record = finished.get(g["game_id"])
        info = {
            "game_id": g["game_id"], "away": g["away"], "home": g["home"], "time": g["time"], "start_utc": g["start_utc"],
            "locked": started, "final": bool(record), "first": record.get("first_goal") if record else None,
        }
        day = days.setdefault(g["date"], {"games": [], "players": []})
        day["games"].append(info)
        day["players"] += rows
    for day in days.values():
        day["players"].sort(key=lambda row: -row["rate"])
    return days


def icebreaker_slate(day: dict) -> dict | None:
    """The promo's own slate for a finished day: the 7:00 PM ET games
    (ICEBREAKER_RULES "slot"), each player's chance among them, and who broke
    the ice (ties: everyone on the quickest time). None until every one of
    those games is final."""
    games = [g for g in day["games"] if g["time"] == ICEBREAKER_RULES["slot"]]
    if not games or not all(g["final"] for g in games):
        return None
    ids = {g["game_id"] for g in games}
    rows = [row for row in day["players"] if row["game_id"] in ids]
    total = sum(row["rate"] for row in rows)
    firsts = [g["first"] for g in games if g.get("first")]
    if not rows or not total or not firsts:
        return None
    quickest = min(f["t"] for f in firsts)
    return {"games": len(games), "time": quickest, "winners": [f for f in firsts if f["t"] == quickest], "rows": rows, "total": total}


def record_icebreaker_days(folder: Path, board: dict) -> int:
    """Adds each finished 7:00 slate to the record once: every player's
    locked rate and price, and who broke the ice. Returns how many were added."""
    added = 0
    for date, day in sorted(board.items()):
        slate = icebreaker_slate(day)
        if not slate:
            continue
        path = folder / f"{date[:7]}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": list(ICEBREAKER_RECORD_COLS), "days": {}}
        if date in saved["days"]:
            continue
        saved["days"][date] = {
            "games": slate["games"], "time": slate["time"], "winners": slate["winners"],
            "players": [[row.get(col) for col in saved["cols"]] for row in slate["rows"]],
        }
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
        added += 1
    return added


def icebreaker_history(folder: Path) -> list:
    """Every recorded slate for the page's Winners list, newest first: who
    broke the ice and when, his place before puck drop by chance (`rank` of
    `players`), that chance, his DraftKings first goal price, and our top
    pick. A winner the page didn't list (a late call-up) has no rank."""
    out = []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in saved["days"].items():
            rows = sorted((dict(zip(saved["cols"], values)) for values in day["players"]), key=lambda row: -row["rate"])
            if not rows:
                continue
            total = sum(row["rate"] for row in rows) or 1
            order = [row["id"] for row in rows]
            winners = []
            for w in day["winners"]:
                row = rows[order.index(w["id"])] if w.get("id") in order else None
                winners.append({**w, "rank": order.index(w["id"]) + 1 if row else None, "chance": round(row["rate"] / total, 4) if row else None, "fg": row["fg"] if row else None})
            top = rows[0]
            out.append({
                "date": date, "games": day["games"], "time": day["time"], "players": len(rows), "winners": winners,
                "top": {"id": top["id"], "name": top["name"], "team": top["team"], "chance": round(top["rate"] / total, 4)},
            })
    return sorted(out, key=lambda d: d["date"], reverse=True)


def icebreaker_file(season: int, generated_at: str, records: list, goals_games: dict, games: list, player_odds: dict, book_odds: dict,
                    previous: dict | None, now_utc: datetime, record_dir: Path) -> dict:
    """site/nhl/icebreaker.json: the board, every team's fast starts and the Winners history."""
    board = icebreaker_board(goals_games, games, records, player_odds, book_odds, previous, now_utc)
    try:
        record_icebreaker_days(record_dir, board)
        history = icebreaker_history(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Icebreaker record couldn't be updated ({e}).", file=sys.stderr)
        history = None
    return {"season": season, "generated_at": generated_at, "rules": ICEBREAKER_RULES, "days": board, "fast": fast_starts(records), "history": history}


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
        "detail": compute_player_details(records),
        "league": league_areas(records),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, required=True, help="Where to write data.json")
    parser.add_argument("--data-dir", type=Path, default=Path("data/nhl"), help="Where finished games are kept between builds")
    parser.add_argument("--record-dir", type=Path, default=SHOTS_RECORD_DIR, help="Where the Shots page's graded plays are kept")
    parser.add_argument("--crease-record-dir", type=Path, default=CREASE_RECORD_DIR, help="Where King of the Crease's finished days are kept")
    parser.add_argument("--goals-record-dir", type=Path, default=GOALS_RECORD_DIR, help="Where the Goals page's graded players are kept")
    parser.add_argument("--icebreaker-record-dir", type=Path, default=ICEBREAKER_RECORD_DIR, help="Where Icebreaker's finished slates are kept")
    args = parser.parse_args()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    teams, standings = fetch_teams()
    team_ids = {abbr: t["id"] for abbr, t in teams.items()}
    abbr_by_id = {v: k for k, v in team_ids.items()}
    stats = season_stats(args.season, args.data_dir, standings, team_ids)

    played = [s["games_played"] for s in stats["team_stats"].values()]
    middle_games = statistics.median(played) if played else 0
    team_games = Counter({team: s["games_played"] for team, s in stats["team_stats"].items()})
    goalies = {}
    for g in sorted(stats["goalies"].values(), key=lambda g: -g["starts"]):
        goalies.setdefault(g["team"], []).append(g)

    games = fetch_schedule(now_utc)
    add_rest(games, stats["listing"], abbr_by_id)
    novig, novig_players, novig_saves, novig_debug = fetch_novig_lines(games, teams, player_finder(stats["skaters"], stats["goalies"]))
    previous = fetch_previous()
    apply_lines(games, novig, previous, now_utc)
    injuries, injuries_error = fetch_injuries(teams, stats["skaters"], stats["goalies"])
    generated_at = now_utc.strftime("%Y-%m-%dT%H:%MZ")
    lineups = lineup(stats["skaters"], team_games)
    player_odds = locked_player_odds(games, novig_players, previous, now_utc)
    # Every US book's price (SmartStake) for the Shots and Goals rows' odds
    # panel. Optional: no key or a failed fetch = Novig's price only, as before.
    find = player_finder(stats["skaters"], stats["goalies"])
    book_odds, book_odds_debug = smartstake.fetch_nhl_book_odds(
        os.environ.get("SMARTSTAKE_API_KEY"), team_namer(teams),
        lambda name, away, home: find(away, name) or find(home, name),
        (previous or {}).get("book_odds"), now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        keep={f"{g['away']}_{g['home']}" for g in games})
    book_odds_debug["sgo_first_goal"] = probe_sgo_first_goal(os.environ.get("SGO_API_KEY"), previous)
    # Tonight's lines, as the NHL posts them. Everyone in one is on the page's
    # skater list too, so a call-up on the top line still opens the player card.
    tonight, lineups_error = fetch_lineups(games, teams, player_finder(stats["skaters"], stats["goalies"]), {pid: s["pos"] for pid, s in stats["skaters"].items()}, now_utc)
    for entry in tonight.values():
        for team, posted in entry.items():
            if team in lineups:
                listed = {p["id"] for p in lineups[team]}
                lineups[team].extend(stats["skaters"][pid] for pid in posted["skaters"] if pid in stats["skaters"] and pid not in listed)

    blob = {
        "season": args.season,
        "season_label": season_label(args.season),
        "middle_games_played": middle_games,
        "generated_at": generated_at,
        "areas": list(AREAS),
        "league": {"season": stats["league"]},
        "teams": teams,
        "team_stats": stats["team_stats"],
        "recent_games": compute_recent_games(stats["records"]),
        "skaters": lineups,
        "goalies": goalies,
        "injuries": injuries,
        "schedule": games,
        "player_odds": player_odds,
        "book_odds": book_odds,
        "book_odds_debug": book_odds_debug,
        "novig_debug": novig_debug,
        "feed_debug": {**stats["debug"], "injuries_error": injuries_error, "lineups": len(tonight), "lineups_error": lineups_error},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    write_player_files(args.out.parent / "players", teams, stats, generated_at)
    model = shots_model_for(stats["records"])
    board = shots_board(model, games, lineups, injuries, stats["records"], fetch_previous(LIVE_SHOTS_URL), now_utc, tonight, stats["skaters"], player_odds)
    try:
        record_finished_games(args.record_dir, board, player_odds, games)
        record = shots_record_summary(args.record_dir)
    except Exception as e:  # a damaged record file must never cost the page its projections
        print(f"WARNING: the Shots record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    shots = {
        "season": args.season, "generated_at": generated_at, "weights": model.w, "dispersion": shots_model.DISPERSION, "edges": SHOTS_EDGES,
        "games": board, "defense": shots_defense(model, teams), "record": record, "lineups": lineups_for_page(tonight, stats["goalies"]),
    }
    with open(args.out.parent / "shots.json", "w") as f:
        json.dump(shots, f, separators=(",", ":"))
    try:
        crease = crease_file(args.season, generated_at, stats["records"], games, tonight, novig_saves, goalies, fetch_previous(LIVE_CREASE_URL), now_utc, args.crease_record_dir)
        with open(args.out.parent / "crease.json", "w") as f:
            json.dump(crease, f, separators=(",", ":"))
    except Exception as e:  # King of the Crease must never cost the other NHL pages their data
        print(f"WARNING: King of the Crease couldn't be built ({e}).", file=sys.stderr)
    try:
        goals = goals_file(args.season, generated_at, stats["records"], model, games, lineups, injuries, fetch_previous(LIVE_GOALS_URL), now_utc,
                           tonight, stats["skaters"], goalies, player_odds, args.goals_record_dir)
    except Exception as e:  # Goals must never cost the other NHL pages their data
        print(f"WARNING: the Goals page couldn't be built ({e}).", file=sys.stderr)
        goals = {"season": args.season, "generated_at": generated_at, "games": {}, "record": None, "error": str(e)[:200]}
    with open(args.out.parent / "goals.json", "w") as f:
        json.dump(goals, f, separators=(",", ":"))
    try:
        icebreaker = icebreaker_file(args.season, generated_at, stats["records"], goals.get("games") or {}, games, player_odds, book_odds,
                                     fetch_previous(LIVE_ICEBREAKER_URL), now_utc, args.icebreaker_record_dir)
    except Exception as e:  # Icebreaker must never cost the other NHL pages their data
        print(f"WARNING: Icebreaker couldn't be built ({e}).", file=sys.stderr)
        icebreaker = {"season": args.season, "generated_at": generated_at, "days": {}, "fast": {}, "history": None, "error": str(e)[:200]}
    with open(args.out.parent / "icebreaker.json", "w") as f:
        json.dump(icebreaker, f, separators=(",", ":"))
    d = stats["debug"]
    print(f"Wrote {args.out} -- {season_label(args.season)}: {d['games_loaded']} of {d['games_wanted']} finished games ({d['games_downloaded']} downloaded), {len(games)} on the schedule, lines for {novig_debug['matched']}")
    if d["errors"]:
        print("  game errors:", d["errors"], file=sys.stderr)


if __name__ == "__main__":
    main()
