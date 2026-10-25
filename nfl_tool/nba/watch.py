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
