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
import os
import sys
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "nfl_tool" / "site"
LIVE = "https://nfl.gmgsports.org"
FILES = ["data.json", "nba/data.json", "nhl/data.json"]


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
        target = SITE / rel
        if target.exists():
            print(f"{rel} already exists here; leaving it alone.")
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{LIVE}/{rel}", headers=headers), timeout=60) as resp:
                body = resp.read()
        except Exception as e:
            if rel == "data.json":
                print(f"Couldn't download {rel}: {e}")
                return 1
            print(f"Skipping {rel}: {e}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        print(f"{rel}: {len(body) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
