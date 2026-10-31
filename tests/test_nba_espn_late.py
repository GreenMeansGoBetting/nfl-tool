"""Last night's NBA games before hoopR has them (nfl_tool/nba/espn_late.py, 2026-10-31).

hoopR's files land about 7:30 am Eastern, so three mornings running last
night's plays sat ungraded. The build now takes a finished game straight from
ESPN's summary. What is pinned: ESPN's copy of a real game (CHA @ WSH,
2026-10-30, the summary saved in fixtures) gives hoopR's own rows for it
(play-by-play, player and team box scores) in every column the site reads,
and the engine's game logs and First Basket result from it are hoopR's; a game
hoopR already has is never added twice; the schedule marks a final; an old
season (the backtests) never asks ESPN; a failure leaves hoopR's file as it is."""
import gzip
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import espn_late as L  # noqa: E402
import first_basket  # noqa: E402
import zone_matchups  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
GID = 401909277
NOW = datetime(2026, 10, 31, 5, 0)
# not read by anything on the site: the betting spread (hoopR's own source) and where the row came from
NOT_READ = {"game_spread", "home_favorite", "game_spread_available", "home_team_spread", "score_source"}


def hoopr(kind):
    return pd.read_parquet(FIX / f"nba_hoopr_{kind}_2026-10-30.parquet")


def patched(kind, summary=None):
    """hoopR's file without the game, then espn_late.patch with ESPN's summary for it."""
    real = hoopr(kind)
    with gzip.open(FIX / f"nba_espn_summary_{GID}.json.gz") as f:
        s = json.load(f) if summary is None else summary
    L._CACHE["finals"] = {GID: {"season": {"year": 2027}}}
    L._CACHE["summaries"] = {GID: s}
    return real, L.patch(kind, real[real["game_id"] != GID].reset_index(drop=True), 2027, NOW)


class SameAsHoopR(unittest.TestCase):
    def tearDown(self):
        L._CACHE.update(finals=None, summaries={})

    def check(self, kind, keys):
        real, mine = patched(kind)
        want = real[real["game_id"] == GID].reset_index(drop=True)
        got = mine[mine["game_id"] == GID].reset_index(drop=True)
        self.assertGreater(len(real[real["game_id"] != GID]), 0, "the fixture keeps a second game as hoopR's frame")
        self.assertEqual(len(got), len(want))
        self.assertEqual(list(mine.columns), list(real.columns))
        m = want.merge(got, on=keys, suffixes=("", "_espn"))
        self.assertEqual(len(m), len(want))
        for col in real.columns:
            if col in keys or col in NOT_READ:
                continue
            a, b = m[col], m[col + "_espn"]
            same = (a.astype(str) == b.astype(str)) | (a.isna() & b.isna())
            if a.dtype.kind in "if" and b.dtype.kind in "if":
                same |= (a - b).abs() < 1e-9
            self.assertTrue(same.all(), f"{kind}.{col}: {m.loc[~same, [col, col + '_espn']].head(3).values.tolist()}")
        return real, mine

    def test_play_by_play(self):
        real, mine = self.check("pbp", ["game_id", "id"])
        # the engine reads them in game_play_number order: ESPN's order, as hoopR's
        self.assertEqual(list(mine[mine.game_id == GID].sort_values("game_play_number")["id"]),
                         list(real[real.game_id == GID].sort_values("game_play_number")["id"]))
        teams = set(real["home_team_abbrev"]) | set(real["away_team_abbrev"])
        self.assertEqual([o for o in first_basket.game_openings(mine, teams) if o["game_id"] == GID],
                         [o for o in first_basket.game_openings(real, teams) if o["game_id"] == GID])

    def test_player_box(self):
        real, mine = self.check("player_box", ["game_id", "athlete_id"])
        self.assertEqual(zone_matchups.box_logs(mine), zone_matchups.box_logs(real))

    def test_team_box(self):
        self.check("team_box", ["game_id", "team_id"])


class Patch(unittest.TestCase):
    def tearDown(self):
        L._CACHE.update(finals=None, summaries={})

    def test_a_game_hoopr_has_is_never_added_twice(self):
        real = hoopr("player_box")
        L._CACHE["finals"] = {GID: {"season": {"year": 2027}}}
        self.assertIs(L.patch("player_box", real, 2027, NOW), real)

    def test_the_schedule_marks_a_final(self):
        sched = pd.DataFrame({"game_id": [GID, 1], "status_type_completed": [False, False], "home_score": [0, 0],
                              "away_score": [0, 0], "status_type_name": ["STATUS_SCHEDULED"] * 2})
        L._CACHE["finals"] = {GID: {"season": {"year": 2027}, "competitions": [{"competitors": [
            {"homeAway": "home", "score": "95"}, {"homeAway": "away", "score": "79"}]}]}}
        got = L.patch("schedule", sched, 2027, NOW)
        self.assertEqual(got.iloc[0][["status_type_completed", "home_score", "away_score", "status_type_name"]].tolist(),
                         [True, 95, 79, "STATUS_FINAL"])
        self.assertFalse(got.iloc[1]["status_type_completed"])

    def test_an_old_season_never_asks_espn(self):
        L._CACHE["finals"] = None
        real = hoopr("player_box")
        self.assertIs(L.patch("player_box", real, 2026, NOW), real)
        self.assertIsNone(L._CACHE["finals"])

    def test_a_failure_leaves_hoopr_as_it_is(self):
        real, mine = patched("pbp", summary={"header": {}, "plays": [{"id": "1"}]})  # a summary that can't be read
        self.assertEqual(len(mine), len(real[real["game_id"] != GID]))


if __name__ == "__main__":
    unittest.main()
