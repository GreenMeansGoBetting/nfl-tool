"""The line a skater played on each night (build_nhl.game_lines, the player
card's Line column).

What is pinned: forwards who share the most ice form a line and lines are
numbered by ice time (L1 most), the same for defense pairs (D1..D3); a game
with no shift chart gives no lines; and an empty chart is only recorded as
"none" once the game is a few days old (the league posts late).
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "nfl_tool" / "nhl"))
import build_nhl  # noqa: E402


def game(shifts):
    forwards = [{"playerId": i} for i in range(1, 7)]
    defense = [{"playerId": i} for i in (11, 12, 13, 14)]
    box = {"homeTeam": {"abbrev": "MTL"}, "awayTeam": {"abbrev": "WSH"},
           "playerByGameStats": {"homeTeam": {"forwards": forwards, "defense": defense}, "awayTeam": {}}}
    return {"box": box, "shifts": shifts}


def shift(pid, start, end):
    return [pid, "MTL", 1, f"{start // 60:02d}:{start % 60:02d}", f"{end // 60:02d}:{end % 60:02d}"]


class GameLines(unittest.TestCase):
    def test_linemates_make_a_line_and_ice_time_numbers_it(self):
        shifts = []
        for t in range(0, 1200, 120):  # 1-2-3 skate 60s of every 120s, 4-5-6 40s; pairs 11-12 and 13-14
            shifts += [shift(p, t, t + 60) for p in (1, 2, 3, 11, 12)]
            shifts += [shift(p, t + 60, t + 100) for p in (4, 5, 6, 13, 14)]
        lines = build_nhl.game_lines(game(shifts))
        self.assertEqual({p: lines[str(p)] for p in (1, 2, 3, 4, 5, 6)}, {1: "L1", 2: "L1", 3: "L1", 4: "L2", 5: "L2", 6: "L2"})
        self.assertEqual({p: lines[str(p)] for p in (11, 12, 13, 14)}, {11: "D1", 12: "D1", 13: "D2", 14: "D2"})

    def test_no_shift_chart_no_lines(self):
        self.assertEqual(build_nhl.game_lines(game(None)), {})

    def test_an_empty_chart_is_kept_only_once_the_game_is_old(self):
        today = datetime.now(timezone.utc).date()
        fresh = {"pbp": {"gameDate": today.isoformat()}}
        old = {"pbp": {"gameDate": (today - timedelta(days=build_nhl.SHIFTS_GIVE_UP_DAYS)).isoformat()}}
        self.assertFalse(build_nhl.keep_shifts(fresh, []))
        self.assertNotIn("shifts", fresh)
        self.assertTrue(build_nhl.keep_shifts(old, []))
        self.assertEqual(old["shifts"], [])
        self.assertFalse(build_nhl.keep_shifts(old, None))


if __name__ == "__main__":
    unittest.main()
