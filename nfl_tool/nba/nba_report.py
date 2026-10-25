"""The NBA's official injury report (2026-10-25), the sim's second injury
source beside ESPN's live list. The owner wanted the fastest free source
("maybe also work in nbas report if thats faster"): on 10-25 its 1:00 pm
report had Embiid Out 8 minutes before ESPN.

The league posts a PDF every 15 minutes through the day at a fixed address
(REPORT_URL, Eastern time). Each row: game date, time, matchup, team, player
("Last, First"), current status (Out / Doubtful / Questionable / Probable /
Available), reason. The text is read by column position (the team and the
name share a line, so plain text runs them together): a fragment is in the
Player Name column if it starts between that header and the Current Status
header, and so on.

    py nfl_tool/nba/nba_report.py              # the latest report's rows
"""
import io
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REPORT_URL = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_{day}_{hh}_{mm}{ampm}.pdf"
STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
EASTERN = ZoneInfo("America/New_York")
LOOK_BACK = 12  # 15-minute slots (3 hours) to step back for the newest posted report
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def slot_url(at: datetime) -> str:
    """The report address for the 15-minute slot at or before `at` (any time zone)."""
    et = at.astimezone(EASTERN)
    et = et.replace(minute=et.minute - et.minute % 15, second=0, microsecond=0)
    return REPORT_URL.format(day=et.strftime("%Y-%m-%d"), hh=et.strftime("%I"), mm=et.strftime("%M"), ampm=et.strftime("%p"))


def fetch_latest(now_utc: datetime, get=None) -> tuple:
    """(pdf bytes, url) of the newest posted report, stepping back from now a
    slot at a time; (None, None) if none in LOOK_BACK slots. get(url) -> bytes
    or None (tests stand in for the NBA)."""
    get = get or _get
    at = now_utc.replace(tzinfo=timezone.utc) if now_utc.tzinfo is None else now_utc
    for k in range(LOOK_BACK):
        url = slot_url(at - timedelta(minutes=15 * k))
        body = get(url)
        if body:
            return body, url
    return None, None


def _get(url: str):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=20) as resp:
            body = resp.read()
        return body if body[:4] == b"%PDF" else None
    except Exception:
        return None


def fragments(pdf: bytes) -> list:
    """[(page, x, y, text)] of every piece of text, in reading order."""
    import pypdf
    out = []
    for n, page in enumerate(pypdf.PdfReader(io.BytesIO(pdf)).pages):
        got = []

        def visit(text, cm, tm, font, size, got=got):
            if text and text.strip():
                got.append((round(tm[4] * cm[0] + cm[4], 1), round(tm[5] * cm[3] + cm[5], 1), text.strip()))
        page.extract_text(visitor_text=visit)
        out += [(n, x, y, t) for x, y, t in sorted(got, key=lambda f: (-f[1], f[0]))]
    return out


def rows(frags: list) -> tuple:
    """(report time "HH:MM AM/PM" or None, [(name "First Last", status)]) in the
    report's order. Columns come from each page's header row."""
    stamp, out = None, []
    cols = None  # (name x, status x, reason x, header y): the first page's header; later pages have none
    for n in sorted({p for p, *_ in frags}):
        page = [(x, y, t) for p, x, y, t in frags if p == n]
        if stamp is None:
            words = [t for _, y, t in page if y == max(yy for _, yy, _ in page)]
            found = re.search(r"(\d{1,2}:\d{2})\s*(AM|PM)", " ".join(words))
            stamp = f"{found.group(1)} {found.group(2)}" if found else None
        head_y = next((y for x, y, t in page if t == "Player"), None)
        if head_y is not None:
            col = {t: x for x, y, t in page if y == head_y}
            if None not in (col.get("Player"), col.get("Current"), col.get("Reason")):
                cols = (col["Player"], col["Current"], col["Reason"], head_y)
        if cols is None:
            continue
        name_x, status_x, reason_x = cols[:3]
        top = head_y if head_y is not None else max(y for _, y, _ in page) - 1  # under the page title
        lines = {}
        for x, y, t in page:
            if y < top:
                lines.setdefault(y, []).append((x, t))
        for y in sorted(lines, reverse=True):
            parts = sorted(lines[y])
            name = " ".join(t for x, t in parts if name_x - 5 <= x < status_x - 5)
            status = " ".join(t for x, t in parts if status_x - 5 <= x < reason_x - 5)
            if "," not in name or status not in STATUSES:
                continue
            last, first = name.rsplit(",", 1)
            out.append((re.sub(r"\s+", " ", f"{first.strip()} {last.strip()}").strip(), status))
    return stamp, out


def statuses(report_rows: list, players: dict, teams: set) -> dict:
    """{ESPN id: status} for the report's rows of players on these teams
    (players = {id: (name, team)}, today's rosters), each player's first row
    (the report runs in game order: tonight's game before tomorrow's). A name
    matching no one, or two players, is left out."""
    from sim import name_key
    by_name = {}
    for pid, (name, team) in players.items():
        if team in teams:
            by_name.setdefault(name_key(name), []).append(str(pid))
    out = {}
    for name, status in report_rows:
        ids = by_name.get(name_key(name)) or []
        if len(ids) == 1 and ids[0] not in out:
            out[ids[0]] = status
    return out


def slot_utc(url: str) -> str | None:
    """The report's slot as "YYYY-MM-DDTHH:MMZ" (UTC) from its address."""
    found = re.search(r"Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf", url or "")
    if not found:
        return None
    et = datetime.strptime(" ".join(found.groups()), "%Y-%m-%d %I %M %p").replace(tzinfo=EASTERN)
    return et.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def players_of(data: dict) -> dict:
    """{ESPN id: (name, team)} from an NBA data.json's `players` (each team's rotation)."""
    return {str(p["id"]): (p.get("name") or "", team) for team, ps in (data.get("players") or {}).items() for p in ps or []}


def tonight(pdf: bytes | None, players: dict, teams: set) -> dict:
    """{ESPN id: status} for tonight's teams from a report (empty without one)."""
    if not pdf:
        return {}
    return statuses(rows(fragments(pdf))[1], players, teams)


def digest(found: dict) -> str:
    """The watch fingerprint of tonight's report rows (watch.py's digest)."""
    import watch
    return watch.digest([f"{pid}:{status}" for pid, status in found.items()])


def changed(version: dict, data: dict, pdf: bytes | None, url: str | None) -> tuple:
    """(changed?, why) for nba-refresh.yml's first step when the watch pressed
    it for a new report: the report's rows for tonight's teams against the
    live build's (version.json nba.watch.rep). Anything unknown = changed."""
    w = ((version or {}).get("nba") or {}).get("watch") or {}
    if pdf is None:
        return False, "no report posted in the last 3 hours"
    if not w.get("rep") or not data:
        return True, "the live build has no report fingerprint to compare"
    abbr = {int(t["id"]): a for a, t in (data.get("teams") or {}).items() if t.get("id") is not None}
    teams = {abbr[i] for i in w.get("teams") or [] if i in abbr}
    now = digest(tonight(pdf, players_of(data), teams))
    if now == w["rep"]:
        return False, f"{url.rsplit('/', 1)[-1]}: nothing changed for tonight's teams"
    return True, f"{url.rsplit('/', 1)[-1]}: tonight's statuses changed"


def main(argv=None):
    import argparse
    import json
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--changed", action="store_true", help="nba-refresh.yml: go=yes only if tonight's rows changed since the live build")
    args = parser.parse_args(argv)
    pdf, url = fetch_latest(datetime.now(timezone.utc))
    if not args.changed:
        if pdf is None:
            sys.exit("No report in the last 3 hours.")
        stamp, got = rows(fragments(pdf))
        print(url, stamp, len(got))
        for r in got:
            print(*r)
        return 0
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_nba
    version = None
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://nfl.gmgsports.org/version.json?t={int(datetime.now().timestamp())}", headers={"User-Agent": USER_AGENT}), timeout=20) as resp:
            version = json.load(resp)
    except Exception as e:
        print(f"version.json not read ({e})")
    go, why = changed(version, build_nba.fetch_previous(), pdf, url)
    print(f"Report check: {'go' if go else 'stop'} ({why}).")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"go={'yes' if go else 'no'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
