"""Freeze the NBA Prop Research Reads before tip (the owner, 2026-11-05), run by deploy.yml and
nba-refresh.yml after the NBA data is in place.

    python tools/nba_reads_capture.py --season 2027

Opens site/nba/all-props.html in a headless browser on the fresh data and reads the page's own
O / U counts for every game that hasn't tipped (`rsCapture()` in research.js), exactly what a
member sees, then keeps them in model_history/nba_reads/<season>.json until tip
(nfl_tool/nba/reads_record.py has the rules). The next build puts the file into props.json, so a
past night shows the Reads as they stood before that game. Never allowed to block a deploy: the
workflow steps run it with continue-on-error, and a failure only leaves the record as it was.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "tools"))

import reads_record  # noqa: E402

SITE = ROOT / "nfl_tool" / "site"


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
            page.set_default_timeout(120000)
            page.goto(f"http://127.0.0.1:{server.server_address[1]}/nba/all-props.html")
            page.wait_for_function("() => typeof rsCapture === 'function' && DATA && PROPS", timeout=90000)
            result = page.evaluate("() => rsCapture()")
            browser.close()
    finally:
        server.shutdown()
    if errors:
        print("Page errors while reading All Props:", *errors[:5], sep="\n  ")
    return result or {}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--season", type=int, required=True)
    args = parser.parse_args(argv)
    data = json.loads((SITE / "nba" / "data.json").read_text(encoding="utf-8"))
    record = reads_record.load(args.season)
    got = capture()
    changed = reads_record.merge(record, got, data.get("schedule") or [], datetime.now(timezone.utc).replace(tzinfo=None))
    if changed:
        reads_record.save(record, args.season)
    players = sum(len(by) for e in got.values() for by in (e.get("m") or {}).values())
    print(f"NBA Reads: {len(got)} games not yet tipped on the page ({players} player lines), {changed} saved or updated; {len(record)} games kept.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never block a deploy
        print(f"NBA Reads capture failed: {e}")
        sys.exit(1)
