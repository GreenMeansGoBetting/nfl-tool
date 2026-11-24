"""Game data from the NHL's own feed for the NHL build: the season's finished games
(kept in data/nhl between builds), each game's play-by-play reduced to what the
pages use, shift charts, power-play time, teams, the schedule and injuries.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import gzip
import json
import math
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import lines_model

API ="https://api-web.nhle.com/v1"
REST = "https://api.nhle.com/stats/rest/en"
ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
REGULAR_SEASON = 2  # the NHL's gameType
FINISHED_STATES = (6, 7)  # the season list's gameStateId: FINAL, OFF (official)
SCHEDULE_DAYS_AHEAD = 14
# Until the middle team has played this many games, the page opens on last
# season's numbers (a handful of games can be one hot goalie).
FETCH_WORKERS = 6
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nhl/1.0)"
# Injury statuses that mean "not playing" (everything but day-to-day).
OUT_STATUSES = ("Out", "Injured Reserve", "Suspension")
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
FIRST_TEN = 600  # Icebreaker's player columns: the first ten minutes of the 1st period
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


def on_ice_finder(raw: dict):
    """find(team, period, "mm:ss" or seconds) -> sorted ids of that team's
    players on the ice at that moment (goalie included), from the kept shift
    chart; None when the game has no chart. A shift counts from just after it
    starts to the moment it ends, so a goal belongs to the players it ended
    the shift for, not the ones who came on for the faceoff after it."""
    shifts = raw.get("shifts")
    if not shifts:
        return None
    spans = {}
    for pid, team, period, on, off in shifts:
        spans.setdefault((team, period), []).append((clock_seconds(on), clock_seconds(off), str(pid)))

    def find(team, period, when):
        t = clock_seconds(when) if isinstance(when, str) else when
        return sorted({pid for a, z, pid in spans.get((team, period), []) if a < t <= z})

    return find


def first_ten_toi(raw: dict) -> dict | None:
    """{player id: seconds on the ice in the first ten minutes of the 1st
    period}, from the kept shift chart; None when the game has no chart."""
    shifts = raw.get("shifts")
    if not shifts:
        return None
    out = Counter()
    for pid, team, period, on, off in shifts:
        if period == 1:
            out[str(pid)] += max(0, min(clock_seconds(off), FIRST_TEN) - min(clock_seconds(on), FIRST_TEN))
    return out


def game_goals(raw: dict) -> list:
    """Every goal but shootout goals, for the points model (points_model.py):
    `team`, `pp` (scored on the power play), the `scorer`, `assists` (first
    assist first) and `on` (the scoring team's players on the ice, None
    without a shift chart). Empty-net and short-handed goals count: points
    props pay on them."""
    pbp = raw["pbp"]
    home = pbp["homeTeam"]
    abbr = {home["id"]: home["abbrev"], pbp["awayTeam"]["id"]: pbp["awayTeam"]["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    find = on_ice_finder(raw)
    out = []
    for p in sorted(pbp.get("plays") or [], key=lambda p: p.get("sortOrder", 0)):
        period = p.get("periodDescriptor") or {}
        if p.get("typeDescKey") != "goal" or period.get("periodType") == "SO":
            continue
        d = p.get("details") or {}
        team_id = team_of.get(d.get("scoringPlayerId"), d.get("eventOwnerTeamId"))
        if team_id not in abbr or not d.get("scoringPlayerId"):
            continue
        out.append({
            "team": abbr[team_id], "pp": strength(p.get("situationCode"), team_id == home["id"]) == "pp",
            "scorer": str(d["scoringPlayerId"]), "assists": [str(d[k]) for k in ("assist1PlayerId", "assist2PlayerId") if d.get(k)],
            "on": find(abbr[team_id], period.get("number"), p.get("timeInPeriod")) if find else None,
        })
    return out


def game_shots(raw: dict) -> list:
    """Every unblocked shot with a goalie in net (no empty nets, penalty
    shots, own goalie pulled or shootouts), with what the goals model's
    expected-goals table reads (goals_model.py): where (`area`, `dist` and
    `angle` to the net, `y` = his side), how (`type`), a `rebound` (his
    team shot within 3 seconds), a `rush` (the play before, within 4
    seconds, was outside his team's attacking zone), `pp` / `sh`, `goal`;
    and `on`, the shooting team's players on the ice (None without a shift
    chart), for the points model's on-ice expected goals."""
    pbp = raw["pbp"]
    find = on_ice_finder(raw)
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
                    "on": find(abbr[team_id], period.get("number"), p.get("timeInPeriod")) if find else None,
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
        if kind == "faceoff":  # faceoffs taken, won or lost: who really plays center (playing_positions)
            for key in ("winningPlayerId", "losingPlayerId"):
                if d.get(key):
                    skater_extra.setdefault(d[key], Counter())["fo"] += 1
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
                if period.get("number") == 1 and clock_seconds(p.get("timeInPeriod")) < FIRST_TEN:
                    mine["sog10"] += 1
                    mine["g10"] += kind == "goal"
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
    toi10 = first_ten_toi(raw)  # {player id: seconds in the first ten minutes}, None without a chart
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
                    "unb": extra.get("unb", 0), "pp_unb": extra.get("pp_unb", 0), "fo": extra.get("fo", 0),
                    "slot": lines.get(str(pid)),
                    # Seconds on the power play (the league's per-game report); None when the game has none.
                    "pp_toi": on_pp.get(str(pid), 0) if on_pp is not None else None,
                    # The first ten minutes of the 1st period (Icebreaker): goals, shots on goal, seconds on the ice (None without a shift chart).
                    "g10": extra.get("g10", 0), "sog10": extra.get("sog10", 0), "toi10": toi10.get(str(pid), 0) if toi10 is not None else None,
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
        # Every goal with its points and who was on the ice, for the points model (game_goals).
        "goal_events": game_goals(raw),
        # Every forward line and defense pair at 5-on-5, and trio against trio (Line Matchups).
        "lines5": lines_model.game_units(raw),
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
