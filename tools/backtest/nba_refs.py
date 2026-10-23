"""Save each NBA game's referee crew from ESPN's game summary, for the points replay.

    py tools/backtest/nba_refs.py --season 2026 --data-dir data/nba

Writes <data-dir>/officials_<season>.json = {game id: [referee names]}, adding only
games it doesn't have yet (finished regular-season games in team_box_<season>.parquet).
ESPN lists the crew in `gameInfo.officials` (three referees, crew chief first).
"""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
REGULAR_SEASON = 2


def crew(game_id: str):
    for _ in range(3):
        try:
            r = requests.get(URL, params={"event": game_id}, timeout=20)
            if r.ok:
                offs = (r.json().get("gameInfo") or {}).get("officials") or []
                return game_id, [o.get("displayName") or o.get("fullName") for o in sorted(offs, key=lambda o: o.get("order", 9))]
        except requests.RequestException:
            pass
    return game_id, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    args = ap.parse_args()
    d = Path(args.data_dir)
    out = d / f"officials_{args.season}.json"
    have = json.loads(out.read_text()) if out.exists() else {}
    box = pd.read_parquet(d / f"team_box_{args.season}.parquet")
    games = sorted({str(g) for g in box.loc[box["season_type"] == REGULAR_SEASON, "game_id"]} - set(have))
    with ThreadPoolExecutor(8) as ex:
        for gid, names in ex.map(crew, games):
            if names:
                have[gid] = names
    out.write_text(json.dumps(have, indent=0, sort_keys=True))
    print(f"{len(have)} games with a crew ({len(games)} asked for)")


if __name__ == "__main__":
    main()
