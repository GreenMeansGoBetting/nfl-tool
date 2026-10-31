"""Last night's NBA games before hoopR has them (2026-10-31).

The owner, the third morning running that last night's plays sat ungraded:
"by 6am the following morning, all nba plays are graded". Every grade on the
site (the sims, Zone Matchup Targets, First Basket, King of the Court, Game
Predictions, My Plays) reads hoopR's season files, and hoopR publishes them
once a day, about 7:30 am Eastern (10-31: 7:32). So nothing could be graded
before then, however often the timer pressed.

hoopR's files are ESPN's game summaries, flattened. This reads the same
summaries straight from ESPN for every game that is final on ESPN's
scoreboard (the last LOOKBACK_DAYS Eastern dates) but not yet in hoopR's
file, turns each into hoopR's rows (schedule, player and team box scores,
play-by-play; the same columns and types), and adds them to the frame
fetch_file returns. When hoopR's copy lands, its rows are used and these are
not added again. tests/test_nba_espn_late.py checks a game against hoopR's own
rows for it, column by column.

Never allowed to break a build: anything that fails leaves hoopR's frame as it is.
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day}"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={gid}"
EASTERN = ZoneInfo("America/New_York")
LOOKBACK_DAYS = 2  # today and the two nights before (Eastern): what the grading counts (build_nba.ungraded)
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nba/1.0)"

# one build reads each scoreboard and summary once (fetch_file is called many times)
_CACHE = {"finals": None, "summaries": {}}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


# ---- which games ----
def finals(now_utc: datetime | None = None) -> dict:
    """{game id: scoreboard event} for every game final on ESPN on the last few Eastern dates."""
    if _CACHE["finals"] is None:
        now = (now_utc or datetime.now(timezone.utc).replace(tzinfo=None)).replace(tzinfo=timezone.utc)
        today = now.astimezone(EASTERN).date()
        out = {}
        for back in range(LOOKBACK_DAYS + 1):
            day = (today - timedelta(days=back)).strftime("%Y%m%d")
            try:
                for e in _get(SCOREBOARD.format(day=day)).get("events") or []:
                    if ((e.get("status") or {}).get("type") or {}).get("completed"):
                        out[int(e["id"])] = e
            except Exception as ex:
                print(f"NOTE: ESPN's NBA scoreboard for {day} not read ({ex!r}).", file=sys.stderr)
        _CACHE["finals"] = out
    return _CACHE["finals"]


def summary(gid: int) -> dict | None:
    if gid not in _CACHE["summaries"]:
        try:
            _CACHE["summaries"][gid] = _get(SUMMARY.format(gid=gid))
        except Exception as ex:
            print(f"NOTE: ESPN's summary for NBA game {gid} not read ({ex!r}).", file=sys.stderr)
            _CACHE["summaries"][gid] = None
    return _CACHE["summaries"][gid]


# ---- one summary as hoopR's rows ----
def _competition(s: dict) -> dict:
    return s["header"]["competitions"][0]


def _sides(s: dict) -> dict:
    """{"home" / "away": the header competitor}."""
    return {c["homeAway"]: c for c in _competition(s)["competitors"]}


def _start(s: dict):
    """(Eastern date, Eastern start as a pandas Timestamp)."""
    at = pd.Timestamp(_competition(s)["date"]).tz_convert(EASTERN)
    return at.date(), at


def _split(v):
    """"5-11" -> (5.0, 11.0)."""
    try:
        a, b = str(v).split("-")
        return float(a), float(b)
    except (TypeError, ValueError):
        return float("nan"), float("nan")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _team_cols(prefix: str, t: dict) -> dict:
    logo = t.get("logo") or next((lg.get("href") for lg in t.get("logos") or []), None)
    return {f"{prefix}_id": int(t["id"]), f"{prefix}_uid": t.get("uid"), f"{prefix}_slug": t.get("slug"),
            f"{prefix}_location": t.get("location"), f"{prefix}_name": t.get("name"),
            f"{prefix}_abbreviation": t.get("abbreviation"), f"{prefix}_display_name": t.get("displayName"),
            f"{prefix}_short_display_name": t.get("shortDisplayName"), f"{prefix}_color": t.get("color"),
            f"{prefix}_alternate_color": t.get("alternateColor"), f"{prefix}_logo": logo}


def _box_teams(s: dict) -> dict:
    """{team id: the boxscore's team block (slug, short name, logo)}, falling back to the header's."""
    out = {int(c["team"]["id"]): dict(c["team"]) for c in _competition(s)["competitors"]}
    for b in (s.get("boxscore") or {}).get("players") or []:
        out[int(b["team"]["id"])] = {**out.get(int(b["team"]["id"]), {}), **b["team"]}
    for b in (s.get("boxscore") or {}).get("teams") or []:
        out[int(b["team"]["id"])] = {**b["team"], **out.get(int(b["team"]["id"]), {})}
    return out


def _game_cols(s: dict) -> dict:
    date, at = _start(s)
    season = s["header"]["season"]
    return {"game_id": int(s["header"]["id"]), "season": int(season["year"]), "season_type": int(season["type"]),
            "game_date": date, "game_date_time": at}


def player_box(s: dict) -> pd.DataFrame:
    sides = _sides(s)
    teams = _box_teams(s)
    side_of = {int(c["team"]["id"]): c for c in sides.values()}
    rows = []
    for b in (s.get("boxscore") or {}).get("players") or []:
        tid = int(b["team"]["id"])
        me = side_of[tid]
        opp = next(c for c in sides.values() if int(c["team"]["id"]) != tid)
        team = _team_cols("team", teams[tid])
        other = {k: v for k, v in _team_cols("opponent_team", teams[int(opp["team"]["id"])]).items()
                 if k not in ("opponent_team_uid", "opponent_team_slug", "opponent_team_short_display_name")}
        stat = (b.get("statistics") or [{}])[0]
        keys = stat.get("keys") or []
        for a in stat.get("athletes") or []:
            v = dict(zip(keys, a.get("stats") or []))
            fgm, fga = _split(v.get("fieldGoalsMade-fieldGoalsAttempted"))
            tpm, tpa = _split(v.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
            ftm, fta = _split(v.get("freeThrowsMade-freeThrowsAttempted"))
            ath = a.get("athlete") or {}
            pos = ath.get("position") or {}
            rows.append({
                **_game_cols(s), "athlete_id": int(ath["id"]), "athlete_display_name": ath.get("displayName"),
                "team_id": tid, "team_name": team["team_name"], "team_location": team["team_location"],
                "team_short_display_name": team["team_short_display_name"],
                "minutes": _num(v.get("minutes")), "field_goals_made": fgm, "field_goals_attempted": fga,
                "three_point_field_goals_made": tpm, "three_point_field_goals_attempted": tpa,
                "free_throws_made": ftm, "free_throws_attempted": fta,
                "offensive_rebounds": _num(v.get("offensiveRebounds")), "defensive_rebounds": _num(v.get("defensiveRebounds")),
                "rebounds": _num(v.get("rebounds")), "assists": _num(v.get("assists")), "steals": _num(v.get("steals")),
                "blocks": _num(v.get("blocks")), "turnovers": _num(v.get("turnovers")), "fouls": _num(v.get("fouls")),
                "plus_minus": v.get("plusMinus"), "points": _num(v.get("points")),
                "starter": bool(a.get("starter")), "ejected": bool(a.get("ejected")), "did_not_play": bool(a.get("didNotPlay")),
                "reason": a.get("reason"), "active": bool(a.get("active")), "athlete_jersey": ath.get("jersey"),
                "athlete_short_name": ath.get("shortName"), "athlete_headshot_href": (ath.get("headshot") or {}).get("href"),
                "athlete_position_name": pos.get("name"), "athlete_position_abbreviation": pos.get("abbreviation"),
                **{k: team[k] for k in ("team_display_name", "team_uid", "team_slug", "team_logo", "team_abbreviation",
                                         "team_color", "team_alternate_color")},
                "home_away": me["homeAway"], "team_winner": bool(me.get("winner")), "team_score": int(me.get("score") or 0),
                **other, "opponent_team_score": int(opp.get("score") or 0),
            })
    return pd.DataFrame(rows)


def _snake(name: str) -> str:
    return "".join("_" + ch.lower() if ch.isupper() else ch for ch in name)


def team_box(s: dict) -> pd.DataFrame:
    sides = _sides(s)
    teams = _box_teams(s)
    side_of = {int(c["team"]["id"]): c for c in sides.values()}
    rows = []
    for b in (s.get("boxscore") or {}).get("teams") or []:
        tid = int(b["team"]["id"])
        me = side_of[tid]
        opp = next(c for c in sides.values() if int(c["team"]["id"]) != tid)
        row = {**_game_cols(s), **_team_cols("team", teams[tid]), "team_home_away": me["homeAway"],
               "team_score": int(me.get("score") or 0), "team_winner": bool(me.get("winner"))}
        for st in b.get("statistics") or []:
            name, value = st.get("name") or "", st.get("displayValue")
            if "-" in name:
                made, tried = _split(value)
                a, b2 = (_snake(x) for x in name.split("-"))
                row[a], row[b2] = made, tried
            else:
                key = {"fieldGoalPct": "field_goal_pct", "freeThrowPct": "free_throw_pct",
                       "threePointFieldGoalPct": "three_point_field_goal_pct"}.get(name, _snake(name))
                row[key] = value
        row.update(_team_cols("opponent_team", teams[int(opp["team"]["id"])]))
        row["opponent_team_score"] = int(opp.get("score") or 0)
        rows.append(row)
    return pd.DataFrame(rows)


def _clock(display: str):
    """"11:40" -> (11, 40.0); "45.2" -> (0, 45.2) (hoopR shows it "0:45.2")."""
    text = str(display or "0:00")
    if ":" in text:
        m, sec = text.split(":", 1)
        return int(m), float(sec)
    return 0, float(text)


def _period_secs(period: int) -> int:
    return 720 if period <= 4 else 300


def pbp(s: dict) -> pd.DataFrame:
    plays = s.get("plays") or []
    if not plays:
        return pd.DataFrame()
    sides = _sides(s)
    home, away = sides["home"]["team"], sides["away"]["team"]
    hid, aid = int(home["id"]), int(away["id"])
    names = {}
    for b in (s.get("boxscore") or {}).get("players") or []:
        for a in ((b.get("statistics") or [{}])[0].get("athletes") or []):
            names[int(a["athlete"]["id"])] = a["athlete"].get("displayName")
    game = _game_cols(s)
    rows = []
    for p in plays:  # ESPN's order, as hoopR keeps it (not always the sequence numbers')
        period = int((p.get("period") or {}).get("number") or 0)
        display = (p.get("clock") or {}).get("displayValue")
        mins, secs = _clock(display)
        display = display if ":" in str(display) else f"0:{display}"
        left = mins * 60 + secs
        ids = [int(x["athlete"]["id"]) for x in p.get("participants") or [] if (x.get("athlete") or {}).get("id")]
        ids += [None] * (3 - len(ids))
        team = (p.get("team") or {}).get("id")
        team = float(team) if team not in (None, "") else float("nan")
        kind = (p.get("type") or {}).get("text")
        xr = _num((p.get("coordinate") or {}).get("x"))
        yr = _num((p.get("coordinate") or {}).get("y"))
        if str(kind or "").startswith("Free Throw"):
            xr, yr = 25.0, 13.75  # hoopR puts every free throw at the line (ESPN sends no spot)
        at_home = team == hid
        # hoopR's court: the team's own basket on the left, feet from center court
        cx = (41.75 - yr) if at_home else (yr - 41.75)
        cy = (25 - xr) if at_home else (xr - 25)
        half = 1 if period <= 2 else 2
        rows.append({
            "id": int(p["id"]), "sequence_number": int(p.get("sequenceNumber") or 0),
            "type_id": int((p.get("type") or {}).get("id") or 0), "type_text": kind, "text": p.get("text"),
            "away_score": int(p.get("awayScore") or 0), "home_score": int(p.get("homeScore") or 0),
            "period_number": period, "period_display_value": (p.get("period") or {}).get("displayValue"),
            "clock_display_value": display, "scoring_play": bool(p.get("scoringPlay")),
            "score_value": int(p.get("scoreValue") or 0), "team_id": team,
            "athlete_id_1": ids[0], "athlete_id_2": ids[1], "athlete_id_3": ids[2],
            "wallclock": p.get("wallclock"), "shooting_play": bool(p.get("shootingPlay")),
            "coordinate_x_raw": xr, "coordinate_y_raw": yr, "points_attempted": int(p.get("pointsAttempted") or 0),
            "short_description": p.get("shortDescription"),
            "game_id": game["game_id"], "season": game["season"], "season_type": game["season_type"],
            "home_team_id": hid, "home_team_name": home.get("location"), "home_team_mascot": home.get("name"),
            "home_team_abbrev": home.get("abbreviation"), "home_team_name_alt": home.get("location"),
            "away_team_id": aid, "away_team_name": away.get("location"), "away_team_mascot": away.get("name"),
            "away_team_abbrev": away.get("abbreviation"), "away_team_name_alt": away.get("location"),
            "qtr": period, "time": display, "clock_minutes": mins, "clock_seconds": secs,
            "home_timeout_called": bool(kind and "Timeout" in kind and team == hid),
            "away_timeout_called": bool(kind and "Timeout" in kind and team == aid),
            "half": half, "game_half": half,
            "start_quarter_seconds_remaining": left,
            "start_half_seconds_remaining": left + (720 if period in (1, 3) else 0),
            "start_game_seconds_remaining": left + 720 * max(4 - period, 0),
            "period": period, "coordinate_x": cx, "coordinate_y": cy,
            "game_date": game["game_date"], "game_date_time": game["game_date_time"], "score_source": "espn",
            "athlete_name_1": names.get(ids[0]), "athlete_name_2": names.get(ids[1]), "athlete_name_3": names.get(ids[2]),
            "type_abbreviation": None, "home_favorite": False, "game_spread_available": False,
        })
    out = pd.DataFrame(rows)
    out.insert(0, "game_play_number", range(1, len(out) + 1))
    for col in ("qtr", "half"):
        out[f"lag_{col}"] = out[col].shift(1)
        out[f"lead_{col}"] = out[col].shift(-1)
    # the clock at the next play; at a quarter's (half's) last play 0, as hoopR has it
    for part, unit in (("quarter", "qtr"), ("half", "half"), ("game", None)):
        nxt = out[f"start_{part}_seconds_remaining"].shift(-1)
        lead = out[f"lead_{unit}"] if unit else None
        out[f"end_{part}_seconds_remaining"] = nxt if unit is None else nxt.where(lead.isna() | (lead == out[unit]), 0.0)
    return out


# ---- into hoopR's frames ----
def _like(new: pd.DataFrame, frame: pd.DataFrame) -> pd.DataFrame:
    """new with frame's columns (missing ones empty) and, where they convert, its types."""
    new = new.reindex(columns=frame.columns)
    for col in frame.columns:
        try:
            if frame[col].dtype == object and len(frame) and isinstance(frame[col].dropna().iloc[0], str):
                new[col] = new[col].map(lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) else str(v))
            elif new[col].notna().all() or frame[col].dtype.kind in "fOUS" or str(frame[col].dtype).startswith(("str", "string")):
                new[col] = new[col].astype(frame[col].dtype)
        except (TypeError, ValueError):
            pass
    return new


ROWS = {"player_box": player_box, "team_box": team_box, "pbp": pbp}


def patch(kind: str, frame: pd.DataFrame | None, season: int, now_utc: datetime | None = None) -> pd.DataFrame | None:
    """hoopR's season file plus every game final on ESPN that it doesn't have yet (schedule: those
    games marked final with their scores). Any failure leaves the frame as it is."""
    if frame is None or kind not in (*ROWS, "schedule"):
        return frame
    now = now_utc or datetime.now(timezone.utc).replace(tzinfo=None)
    if season != now.year + (1 if now.month >= 9 else 0):
        return frame  # an old season (the backtests): nothing late, nothing asked of ESPN
    try:
        done = {gid: e for gid, e in finals(now_utc).items() if int((e.get("season") or {}).get("year") or 0) == season}
        if not done:
            return frame
        if kind == "schedule":
            return _mark_final(frame, done)
        have = set(pd.to_numeric(frame["game_id"], errors="coerce").dropna().astype(int))
        add = []
        for gid in sorted(set(done) - have):
            s = summary(gid)
            rows = ROWS[kind](s) if s else None
            if rows is not None and len(rows):
                if kind == "pbp":  # hoopR's short names ("Golden St", "LA"), from its own rows for the team
                    for side in ("home", "away"):
                        alt = dict(zip(frame[f"{side}_team_id"], frame[f"{side}_team_name_alt"]))
                        rows[f"{side}_team_name_alt"] = rows[f"{side}_team_id"].map(alt).fillna(rows[f"{side}_team_name_alt"])
                add.append(_like(rows, frame))
        if not add:
            return frame
        print(f"NOTE: {kind}: {len(add)} game(s) from ESPN that hoopR doesn't have yet.", file=sys.stderr)
        return pd.concat([frame, *add], ignore_index=True)
    except Exception as ex:
        print(f"WARNING: ESPN's late games weren't added to {kind} ({ex!r}).", file=sys.stderr)
        return frame


def _mark_final(frame: pd.DataFrame, done: dict) -> pd.DataFrame:
    gids = pd.to_numeric(frame["game_id"], errors="coerce")
    todo = frame.index[gids.isin(list(done)) & ~frame["status_type_completed"].astype(bool)]
    if not len(todo):
        return frame
    frame = frame.copy()
    for i in todo:
        e = done[int(gids[i])]
        score = {c["homeAway"]: int(c.get("score") or 0) for c in e["competitions"][0]["competitors"]}
        frame.at[i, "status_type_completed"] = True
        frame.at[i, "home_score"], frame.at[i, "away_score"] = score.get("home", 0), score.get("away", 0)
        for col, val in (("status_type_name", "STATUS_FINAL"), ("status_type_state", "post"), ("status_type_description", "Final"),
                         ("status_type_detail", "Final"), ("status_type_short_detail", "Final"), ("status_type_id", 3)):
            if col in frame.columns:
                frame.at[i, col] = val
    print(f"NOTE: schedule: {len(todo)} game(s) final on ESPN that hoopR hasn't marked yet.", file=sys.stderr)
    return frame
