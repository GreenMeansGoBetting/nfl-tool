"""The NBA refresh's watch (2026-10-25). The owner: "Within 5 minutes of a
player being ruled out for their team, sims rerun and give new lines with the
more accurate game."

Every build writes data.json `watch` (version.json `nba.watch`): tonight's
teams that haven't tipped and two short fingerprints of what the sim read
about them, ESPN's injury statuses (`inj`) and the NBA's posted starting
fives (`lu`). The Cloudflare timer (workers/nhl-timer/watch.js) reads the
same two sources every minute, works out the same fingerprints, and when one
differs starts .github/workflows/nba-refresh.yml. The two sides must agree to
the letter (tests/test_nba_watch.py runs both on the same sample): a
fingerprint that never matches would refresh every few minutes all night.
"""
import hashlib
import json
import re

LISTED = ("Confirmed", "Expected")  # a lineupStatus that counts as the posted five (sim.lineup_starters)


def digest(rows: list) -> str:
    """16 hex characters of SHA-1 over the sorted rows, one a line (UTF-8)."""
    return hashlib.sha1("\n".join(sorted(rows)).encode("utf-8")).hexdigest()[:16]


def injury_rows(body, team_ids) -> list:
    """"<ESPN athlete id>:<status>" for every player on ESPN's injury list
    (site.api.espn.com/.../nba/injuries) on one of these teams (ESPN ids)."""
    rows = []
    for t in (body or {}).get("injuries") or []:
        try:
            tid = int(t.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if tid not in team_ids:
            continue
        for i in t.get("injuries") or []:
            found = re.search(r"/athletes/(\d+)", json.dumps(i.get("athlete") or {}))
            if found:
                rows.append(f"{found.group(1)}:{i.get('status') or ''}")
    return rows


def lineup_rows(day, abbrs) -> list:
    """"<NBA abbreviation>=<the five names, sorted, | between>" for each of
    these teams in the NBA's lineups file for the night (as the sim reads it:
    not Inactive, Confirmed or Expected, the first five)."""
    rows = []
    for g in (day or {}).get("games") or []:
        for side in ("homeTeam", "awayTeam"):
            t = g.get(side) or {}
            abbr = t.get("teamAbbreviation")
            if abbr not in abbrs:
                continue
            names = [str(x.get("playerName") or "") for x in t.get("players") or []
                     if x.get("rosterStatus") != "Inactive" and x.get("lineupStatus") in LISTED][:5]
            rows.append(f"{abbr}=" + "|".join(sorted(names)))
    return rows


def block(games: list, teams: dict, nba_abbr: dict, today: str, now: str, injury_body, lineups_today) -> dict:
    """data.json `watch`. games = the build's schedule (start_utc "YYYY-MM-DDTHH:MMZ"),
    teams = {abbr: {id}}, nba_abbr = sim.NBA_ABBR (the NBA's abbreviation ->
    ESPN's), today = the Eastern date, now = the build's time like start_utc.
    `inj` is None when ESPN's live list couldn't be read (the timer then
    refreshes until it can)."""
    tonight = [g for g in games if g["date"] == today and g.get("start_utc", "") > now]
    abbrs = sorted({g[k] for g in tonight for k in ("home", "away")})
    to_nba = {espn: nba for nba, espn in nba_abbr.items()}
    team_ids = sorted(int(teams[a]["id"]) for a in abbrs if a in teams)
    nba = sorted(to_nba.get(a, a) for a in abbrs)
    return {"day": today.replace("-", ""), "teams": team_ids, "nba": nba,
            "inj": digest(injury_rows(injury_body, set(team_ids))) if injury_body is not None else None,
            "lu": digest(lineup_rows(lineups_today, set(nba)))}


def waiting(games: list, today: str) -> list:
    """watch.grade: [[game id, "YYYYMMDD"], ...] for the games from the last two nights through
    tonight that weren't final when this build ran. The timer reads ESPN's scoreboard for those
    dates every minute and presses a grading refresh as soon as one is final (2026-10-31: three
    mornings running, last night's plays were still ungraded; the box scores come from ESPN the
    minute a game ends, espn_late.py). A build after the final leaves it off, so once a game."""
    from datetime import datetime, timedelta
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%d")
    return [[str(g["game_id"]), g["date"].replace("-", "")] for g in games
            if since <= g["date"] <= today and g.get("status") != "final"]


# ---- waiting on the market (2026-10-28) ----
# The owner, the night Luka was ruled out: the refresh ran within a minute of
# the news, but the books hadn't moved yet (Reaves 23.5 on our page, 26.5 on
# FanDuel minutes later), so the sim (up on him without Luka) read the stale
# line as a big over. Data.json `market_watch` remembers, from build to build,
# when each 20+ minute player was first seen Out and when each of tonight's
# main lines was first seen at its number. A teammate's line taken before he
# was ruled Out that hasn't moved since is held (not a play, not saved) for
# HOLD_MINUTES; the timer re-runs the odds RECHECK_MINUTES after the news.
STAR_MINUTES = 20  # an Out player who moves his teammates' lines (his minutes a game)
HOLD_MINUTES = 40  # a line that still hasn't moved after this: the books have had their say
RECHECK_MINUTES = (10, 25, 40)  # the odds again this long after a ruling, news or not


def _minutes(a: str, b: str) -> float:
    """b - a in minutes, both like "YYYY-MM-DDTHH:MMZ"."""
    from datetime import datetime
    f = "%Y-%m-%dT%H:%MZ"
    return (datetime.strptime(b, f) - datetime.strptime(a, f)).total_seconds() / 60


def market_watch(prev: dict | None, outs: dict, lines: dict, now: str) -> dict:
    """outs = {pid: team} tonight's 20+ minute players Out; lines = {"game:market:pid": main line}.
    Each keeps the time it was first seen (an Out on a new team, or a line at a new number, is new)."""
    po, pl = (prev or {}).get("outs") or {}, (prev or {}).get("lines") or {}
    return {"outs": {pid: {"team": team, "at": po[pid]["at"] if (po.get(pid) or {}).get("team") == team else now}
                     for pid, team in outs.items()},
            "lines": {k: [v, pl[k][1] if k in pl and pl[k][0] == v else now] for k, v in lines.items()}}


def held_by(mw: dict, key: str, team: str, now: str) -> list:
    """The Out teammates (pids) holding this line: ruled Out after the line was taken, under HOLD_MINUTES ago."""
    line = (mw.get("lines") or {}).get(key)
    if not line:
        return []
    return sorted(pid for pid, o in (mw.get("outs") or {}).items()
                  if o["team"] == team and o["at"] > line[1] and _minutes(o["at"], now) < HOLD_MINUTES)


def recheck(mw: dict, now: str) -> str | None:
    """watch.recheck: the next time the timer re-runs the odds (RECHECK_MINUTES after a ruling), or None."""
    from datetime import datetime, timedelta
    f = "%Y-%m-%dT%H:%MZ"
    due = [(datetime.strptime(o["at"], f) + timedelta(minutes=m)).strftime(f)
           for o in (mw.get("outs") or {}).values() for m in RECHECK_MINUTES]
    later = sorted(t for t in due if t > now)
    return later[0] if later else None
