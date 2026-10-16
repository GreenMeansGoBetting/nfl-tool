"""Writes tests/fixtures/nhl_points.json.gz: the Points page's sample, built
the way the build would have from the same games and prices as the NHL data
sample (tests/fixtures/nhl_data.json.gz). As of 2026-10-12 14:00 UTC, then
2026-10-13 14:12 with that file as the live one, so 10/12's games are locked
and final (graded in the record) and 10/13's are open with Novig's points
prices, like the Goals sample.

    python tools/make_nhl_points_sample.py

Needs this season's kept games in data/nhl/games/2027 (any local NHL build
leaves them there). Only for the tests; the site never runs it.
"""
import gzip
import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
sys.path.insert(0, str(ROOT / "tests"))
import build_nhl as b  # noqa: E402
import helpers  # noqa: E402

STEPS = (("2026-10-12", datetime(2026, 10, 12, 14, 0)), ("2026-10-13", datetime(2026, 10, 13, 14, 12)))


def main():
    data = helpers.nhl_data()
    games_dir = ROOT / "data" / "nhl" / "games" / "2027"
    records = []
    for path in sorted(games_dir.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        if raw["pbp"].get("gameState") in ("FINAL", "OFF"):
            records.append(b.reduce_game(raw))
    records.sort(key=lambda r: (r["date"], r["id"]))
    lineups = data["skaters"]
    skaters = {p["id"]: p for team in lineups.values() for p in team}
    previous = None
    with tempfile.TemporaryDirectory() as record_dir:
        for day, now in STEPS:
            so_far = [r for r in records if r["date"] < day]
            schedule = [{**g, "status": "scheduled"} if g["date"] >= day else g for g in data["schedule"]]
            shots = b.shots_model_for(so_far)
            goals = b.goals_model_for(so_far, shots, b.goals_hand(skaters))
            out = b.points_file(2027, now.strftime("%Y-%m-%dT%H:%MZ"), so_far, goals, schedule, lineups, data["injuries"], previous, now,
                                None, skaters, data["goalies"], data["player_odds"], Path(record_dir))
            previous = out
    path = ROOT / "tests" / "fixtures" / "nhl_points.json.gz"
    path.write_bytes(gzip.compress(json.dumps(out, separators=(",", ":")).encode("utf-8"), mtime=0))
    finals = sum(1 for g in out["games"].values() if g.get("final"))
    priced = sum(1 for g in out["games"].values() for r in g["players"] if r["line"] is not None)
    print(f"Wrote {path.name}: {len(out['games'])} games ({finals} final), {priced} priced players, record {out['record']['games']} games")


if __name__ == "__main__":
    main()
