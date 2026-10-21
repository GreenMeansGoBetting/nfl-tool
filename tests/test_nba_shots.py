"""NBA shot charts' data (nfl_tool/nba/shots.py -> site/nba/shots.json) on a hand-made game.

What is pinned (the owner, 2026-10-21: shot charts for THIS season, "frequency and success"):
each shot keeps ESPN's spot as given (x below 25 = the shooter's left, checked against NBA.com),
made / three, its game (oldest first), the 1st-quarter and first-3-minutes flags and how the shot
came; free throws, heaves (35+ ft) and preseason games are left out; the league table adds up
every shot by spot."""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import shots  # noqa: E402


def play(game, date, period, minutes, seconds, player, kind, x, y, made, pts, season_type=2, shooting=True):
    return {"game_id": game, "game_date": date, "season_type": season_type, "period_number": period,
            "clock_minutes": minutes, "clock_seconds": seconds, "athlete_id_1": player, "type_text": kind,
            "shooting_play": shooting, "coordinate_x_raw": x, "coordinate_y_raw": y, "scoring_play": made,
            "points_attempted": pts}


PBP = pd.DataFrame([
    play(20, "2026-10-22", 1, 11, 30, 7, "Driving Layup Shot", 25, 1, True, 2),  # opening minutes
    play(20, "2026-10-22", 1, 5, 0, 7, "Jump Shot", 3, 2, False, 3),  # left corner 3, catch and shoot
    play(20, "2026-10-22", 3, 8, 0, 7, "Pullup Jump Shot", 40, 20, True, 3),
    play(20, "2026-10-22", 2, 1, 0, 7, "Free Throw - 1 of 2", 25, 0, True, 1),  # free throw: out
    play(20, "2026-10-22", 2, 0, 1, 8, "Jump Shot", 25, 40, False, 3),  # heave: out
    play(10, "2026-10-20", 2, 6, 0, 8, "Driving Layup Shot", 25, 1, False, 2),  # the older game comes first
    play(5, "2026-10-10", 1, 11, 0, 8, "Jump Shot", 25, 25, True, 3, season_type=1),  # preseason: out
])


class ShotsFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.block = shots.season_block(PBP, "2026-27")

    def test_games_oldest_first(self):
        self.assertEqual(self.block["games"], [10, 20])

    def test_each_shot(self):
        self.assertEqual(self.block["players"]["7"], [
            [25, 1, 1, 0, 1, 3, 3],  # game index 1, 1st quarter + first 3 minutes, a drive
            [3, 2, 0, 1, 1, 1, 2],  # the shooter's left corner, catch and shoot
            [40, 20, 1, 1, 1, 0, 1],  # 3rd quarter pull-up
        ])
        self.assertEqual(self.block["players"]["8"], [[25, 1, 0, 0, 0, 0, 3]])

    def test_league_adds_up_by_spot(self):
        self.assertIn([25, 1, 0, 1, 2], self.block["league"])  # two layups there, one made
        self.assertEqual(sum(s[4] for s in self.block["league"]), 4)

    def test_no_shots_no_block(self):
        self.assertIsNone(shots.season_block(PBP[PBP["season_type"] == 1], "2026-27"))


if __name__ == "__main__":
    unittest.main()
