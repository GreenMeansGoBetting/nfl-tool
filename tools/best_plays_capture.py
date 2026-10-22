"""NFL Best Plays' graded record, run by the deploy after the NFL data is in place.

    python tools/best_plays_capture.py --season 2026

1. Opens site/best-plays.html in a headless browser on the fresh data.json and
   reads the page's own play list (`bpCapture()` in best-plays.js), exactly what
   a member sees. A fresh browser has no member, so no My Books: the best price
   is across every US book.
2. Adds it to model_history/nfl_best_plays/<season>.json (games not yet
   started only; nfl_tool/best_plays_record.py has the rules), grades every
   finished game and writes site/best_plays_record.json for the page's
   YTD Model Performance popup.

If the page can't be read the record is still graded and the site file still
written; the run then exits 1 so the step shows the failure.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "nfl_tool"))
sys.path.insert(0, str(ROOT / "tools"))

import best_plays_record as bpr  # noqa: E402

SITE = ROOT / "nfl_tool" / "site"
OUT = SITE / "best_plays_record.json"


def capture() -> dict:
    from playwright.sync_api import sync_playwright

    from check_site import start_server

    server = start_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0]))
            page.goto(f"http://127.0.0.1:{server.server_address[1]}/best-plays.html")
            page.wait_for_selector("#bp-app:not([hidden])", timeout=60000)
            result = page.evaluate("() => bpCapture()")
            browser.close()
    finally:
        server.shutdown()
    if errors:
        print("Page errors while reading Best Plays:", *errors[:5], sep="\n  ")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--no-capture", action="store_true", help="grade only (no browser)")
    args = parser.parse_args(argv)
    data = json.loads((SITE / "data.json").read_text(encoding="utf-8"))
    record = bpr.load(args.season)
    ok = True
    if not args.no_capture:
        try:
            got = capture()
            bpr.merge_capture(record, got, data, datetime.now(timezone.utc))
            print(f"Best Plays: {len(got.get('plays') or [])} plays on the page across {len(got.get('games') or [])} games not yet started.")
        except Exception as e:  # the grading below still runs
            print(f"Couldn't read the Best Plays page: {e}")
            ok = False
    bpr.grade(record, data)
    bpr.save(record, args.season)
    site = bpr.site_file(record)
    OUT.write_text(json.dumps(site, separators=(",", ":")), encoding="utf-8")
    graded = sum(len(rows) for rows in site["ledger"].values())
    print(f"Best Plays record: {len(record['plays'])} plays kept, {graded} graded.")
    return 0 if ok else 1


def safe_main(argv=None) -> int:
    """main(), but the site file is always left in place: the page check before
    a publish fails on a missing file, and the record must never block a deploy."""
    try:
        return main(argv)
    except Exception as e:
        print(f"Best Plays record failed: {e}")
        if not OUT.exists():
            OUT.write_text(json.dumps({"season": None, "ledger": {g: [] for g in bpr.GROUPS}, "plays": []}), encoding="utf-8")
        return 1


if __name__ == "__main__":
    sys.exit(safe_main())
