"""Download the LIVE site's data files into the checkout, for the scheduled
site check (.github/workflows/site-check.yml).

    python tools/fetch_live_data.py

Writes nfl_tool/site/data.json and the NBA and NHL data files exactly as
members are being served them, so the check runs against what is live. The
site sits behind the member login; this proves itself the same way the data
build does (a key derived from DISCORD_BOT_TOKEN, which only CI holds).

It refuses to overwrite a data file that already exists, so running it by
accident never replaces a locally built one.
"""
import hashlib
import hmac
import json
import os
import sys
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "nfl_tool" / "site"
LIVE = "https://nfl.gmgsports.org"
FILES = ["data.json", "nba/data.json", "nhl/data.json"]


def nhl_player_files():
    """The NHL page's per-team player files (the player card's game logs and
    shot areas), named by the teams in the NHL data file just downloaded."""
    try:
        teams = json.loads((SITE / "nhl" / "data.json").read_text(encoding="utf-8")).get("teams") or {}
    except (OSError, ValueError):
        return []
    return [f"nhl/players/{abbr}.json" for abbr in sorted(teams)]


def download(rel, headers):
    """True if the file is in place afterwards."""
    target = SITE / rel
    if target.exists():
        print(f"{rel} already exists here; leaving it alone.")
        return True
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{LIVE}/{rel}", headers=headers), timeout=60) as resp:
            body = resp.read()
    except Exception as e:
        print(f"Couldn't download {rel}: {e}")
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    print(f"{rel}: {len(body) // 1024} KB")
    return True


def main():
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        print("DISCORD_BOT_TOKEN isn't set; this only runs in GitHub Actions.")
        return 2
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; gmg-site-check/1.0)",
        "X-GMG-Build": hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest(),
    }
    for rel in FILES:
        if not download(rel, headers) and rel == "data.json":
            return 1  # the NFL data is the one file the check can't run without
    for rel in nhl_player_files():
        download(rel, headers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
