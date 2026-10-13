"""Download the LIVE site's data files into the checkout.

    python tools/fetch_live_data.py                             # everything: the daily site check
    python tools/fetch_live_data.py --only nfl nba --strict     # the hockey-only refresh
    python tools/fetch_live_data.py --only nhl --need nhl       # the deploy, reusing a suite's data

Writes nfl_tool/site/data.json and the NBA and NHL data files exactly as
members are being served them. Three jobs use it:

  * the site check (.github/workflows/site-check.yml) runs against what is live;
  * the hockey-only refresh (nhl-refresh.yml) rebuilds the NHL files and
    publishes the rest of the site's data untouched (--only nfl nba --strict);
  * the deploy (deploy.yml) takes a suite's data as it is live when a push
    didn't change that suite's build code, instead of rebuilding it
    (--only SUITE --need SUITE: exit 1, so the deploy builds it after all,
    unless every one of the suite's files arrived).

The site sits behind the member login; this proves itself the same way the
data build does (a key derived from DISCORD_BOT_TOKEN, which only CI holds).

Whatever is downloaded here may be published again, so a file is only kept
if it is real JSON. A wrong key gets the login page back with a 200, and that
must never be saved as data.json.

It refuses to overwrite a data file that already exists, so running it by
accident never replaces a locally built one.
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "nfl_tool" / "site"
LIVE = "https://nfl.gmgsports.org"
# Every data file a build writes into the site folder (they are not in git:
# see .gitignore). The NHL suite also has one players file per team, named by
# the teams in its data file. A test checks this list against .gitignore, so
# a new generated file can't be left out of a republish.
SUITES = {
    "nfl": ["data.json"],
    "nba": ["nba/data.json"],
    "nhl": ["nhl/data.json", "nhl/shots.json"],
}
NHL_PLAYERS = "nhl/players/"
TRIES = 3


def nhl_player_files():
    """The NHL page's per-team player files (the player card's game logs and
    shot areas), named by the teams in the NHL data file just downloaded."""
    try:
        teams = json.loads((SITE / "nhl" / "data.json").read_text(encoding="utf-8")).get("teams") or {}
    except (OSError, ValueError):
        return []
    return [f"{NHL_PLAYERS}{abbr}.json" for abbr in sorted(teams)]


def download(rel, headers, pause=2.0):
    """"ok" if the file is in place afterwards, "missing" if the live site
    doesn't have it (a 404), "failed" for anything else (after a few tries)."""
    target = SITE / rel
    if target.exists():
        print(f"{rel} already exists here; leaving it alone.")
        return "ok"
    why = ""
    for attempt in range(TRIES):
        if attempt:
            time.sleep(pause)
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{LIVE}/{rel}", headers=headers), timeout=60) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 404:
                print(f"{rel}: not on the live site.")
                return "missing"
            why = f"HTTP {e.code}"
            continue
        except Exception as e:
            why = str(e)
            continue
        try:
            if not isinstance(json.loads(body), dict):
                raise ValueError
        except ValueError:
            why = "what came back isn't the data file (the login page?)"
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        print(f"{rel}: {len(body) // 1024} KB")
        return "ok"
    print(f"Couldn't download {rel}: {why}")
    return "failed"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Download the live site's data files into the checkout.")
    parser.add_argument("--only", nargs="+", choices=sorted(SUITES), metavar="SUITE", help="just these suites' files (default: all of nfl nba nhl)")
    parser.add_argument("--need", nargs="+", choices=sorted(SUITES), default=[], metavar="SUITE", help="exit 1 unless every file of these suites arrived")
    parser.add_argument("--strict", action="store_true", help="exit 1 if any file failed for a reason other than not being on the live site")
    args = parser.parse_args(argv)
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        print("DISCORD_BOT_TOKEN isn't set; this only runs in GitHub Actions.")
        return 2
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; gmg-site-check/1.0)",
        "X-GMG-Build": hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest(),
    }
    wanted = args.only or sorted(SUITES)
    results = {}
    for suite in ("nfl", "nba", "nhl"):
        if suite not in wanted:
            continue
        got = [download(rel, headers) for rel in SUITES[suite]]
        if suite == "nhl" and got[0] == "ok":
            players = nhl_player_files()
            got += [download(rel, headers) for rel in players] or ["missing"]
        results[suite] = got
    if results.get("nfl", ["ok"]) != ["ok"]:
        return 1  # the NFL data is the one file nothing can run without
    if any(set(results.get(suite, ["missing"])) != {"ok"} for suite in args.need):
        return 1
    if args.strict and any("failed" in got for got in results.values()):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
