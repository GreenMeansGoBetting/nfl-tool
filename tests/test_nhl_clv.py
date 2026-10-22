"""Closing line value on Novig's own prices (build_nhl.py: clv_move, 2026-10-22).

Since 2026-10-17 every record grades wins and units at the best price across
books, and CLV compared the best price at the first look with the best across
many more books at the lock: it read "drifted" by construction (Goals: 145
drifted, 6 shortened). What is pinned:
  * Novig's own prices are what CLV reads (`nv_*` over the best book's price),
    both sides with the cut taken out; one side alone when the other is
    missing at either look; a moved line by direction; nothing without both looks.
  * Each board row carries Novig's first look (`first_nv`) from the live file
    and its price now (`nv`); a record row saves both (`nv`, CLV_COLS).
  * Rows from BEST_PRICES_FROM on with no `nv` are left out; rows before it
    (Novig's prices both ends) count as they are.
"""
import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (first: puts nfl_tool/nhl on the import path)

import build_nhl
from test_nhl_saves_page import crease_row, days

nv = lambda a, b: build_nhl.break_even(a) / (build_nhl.break_even(a) + build_nhl.break_even(b))


class NovigsPrices(unittest.TestCase):
    def test_novigs_own_price_not_the_best_books(self):
        swapped = {"line": 2.5, "over": 140, "under": -150, "nv_over": 120, "nv_under": -140, "over_book": "fanduel"}
        self.assertEqual(build_nhl.novig_prices(swapped), {"line": 2.5, "over": 120, "under": -140})
        self.assertEqual(build_nhl.novig_prices({"line": 1.5, "over": -110, "under": None}), {"line": 1.5, "over": -110, "under": None})
        self.assertIsNone(build_nhl.novig_prices({"line": None}))
        self.assertEqual(build_nhl.novig_goal_prices({"odds": 350, "nv_odds": 300, "no_odds": -400}), {"yes": 300, "no": -400})

    def test_the_move_is_the_no_vig_chance(self):
        first, lock = {"line": 2.5, "over": 120, "under": -140}, {"line": 2.5, "over": -110, "under": -110}
        moved, same = build_nhl.clv_move(first, lock, "over", "under")
        self.assertTrue(same)
        self.assertAlmostEqual(moved, nv(-110, -110) - nv(120, -140))
        self.assertAlmostEqual(build_nhl.clv_move(first, lock, "under", "over")[0], -moved)
        # A cut that changes without the market moving is not a move.
        self.assertAlmostEqual(build_nhl.clv_move({"line": 0.5, "over": -105, "under": -105}, {"line": 0.5, "over": -115, "under": -115}, "over", "under")[0], 0.0)
        # One side missing at either look: that side's own price both times.
        self.assertAlmostEqual(build_nhl.clv_move({"line": 0.5, "over": 300}, {"line": 0.5, "over": 250, "under": -350}, "over", "under")[0],
                               build_nhl.break_even(250) - build_nhl.break_even(300))
        # A moved line counts by direction only; nothing without both looks.
        self.assertEqual(build_nhl.clv_move({"line": 2.5, "over": -110}, {"line": 3.5, "over": -110}, "over", "under"), (1.0, False))
        self.assertEqual(build_nhl.clv_move({"line": 2.5, "over": -110}, {"line": 3.5, "over": -110}, "under", "over"), (-1.0, False))
        self.assertEqual(build_nhl.clv_move(None, lock, "over", "under"), (None, False))
        self.assertEqual(build_nhl.clv_move({"line": 2.5, "over": None, "under": -110}, lock, "over", "under"), (None, False))


class TheRecords(unittest.TestCase):
    def summary(self, date, rows, fn=build_nhl.shots_record_summary):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "2026-10.json").write_text(json.dumps({"games": {"9": {"date": date, "away": "AAA", "home": "BBB", "plays": rows}}}))
            return fn(Path(tmp))["clv"]

    def test_novig_not_the_best_price(self):
        """The best price drifted from -110 to +130 (more books by puck drop); Novig shortened. CLV says shortened."""
        row = ["a", "A", "AAA", 2.5, 130, -150, 3.4, 0.66, 4, 3.0, None, 2.5, -110, -110, None, [2.5, -115, -105, -125, 105]]
        clv = self.summary("2026-10-20", [row])
        self.assertEqual((clv["plays"], clv["priced"], clv["shortened"], clv["drifted"], clv["since"]), (1, 1, 1, 0, "2026-10-20"))
        self.assertAlmostEqual(clv["points"], round(nv(-125, 105) - nv(-115, -105), 4))

    def test_best_price_rows_without_novigs_are_left_out(self):
        row = ["a", "A", "AAA", 2.5, 130, -150, 3.4, 0.66, 4, 3.0, None, 2.5, -110, -110, None]
        self.assertEqual(self.summary("2026-10-20", [row])["plays"], 0)
        self.assertEqual(self.summary("2026-10-20", [[*row, [None, None, None, 130, -150]]])["plays"], 0)  # no first Novig look
        self.assertEqual(self.summary("2026-10-16", [row])["plays"], 1)  # before best prices: Novig's own

    def test_points_goals_and_saves_read_the_same_column(self):
        points = ["p", "P", "AAA", 0.5, 120, -150, 0.9, 0.6, 0.6, 1, 0.5, None, 0.5, 110, -140, None, [0.5, 130, -160, 110, -140]]
        clv = self.summary("2026-10-20", [points], build_nhl.points_record_summary)
        self.assertEqual((clv["plays"], clv["shortened"]), (1, 1))
        self.assertAlmostEqual(clv["points"], round(nv(110, -140) - nv(130, -160), 4))
        goal = ["g", "G", "AAA", 0.32, 0.39, 300, 300, False, None, 1, None, None, [350, -500, 300, -450]]  # strong: edge 7
        clv = self.summary("2026-10-20", [goal], build_nhl.goals_record_summary)
        self.assertEqual((clv["plays"], clv["shortened"]), (1, 1))
        self.assertAlmostEqual(clv["points"], round(nv(300, -450) - nv(350, -500), 4))
        saves = ["s", "S", "AAA", 26.5, -110, -110, 25.4, 0.40, 26.4, 24, 26.0, 26.5, -110, -110, None, [26.5, -105, -115, -125, 105]]
        clv = self.summary("2026-10-20", [saves], build_nhl.saves_record_summary)
        self.assertEqual((clv["plays"], clv["drifted"]), (1, 1))  # an under whose Novig price got longer
        self.assertAlmostEqual(clv["points"], round(nv(105, -125) - nv(-115, -105), 4))


class TheBoard(unittest.TestCase):
    def test_the_first_novig_look_is_carried(self):
        row = crease_row(over=120, under=-150, nv_over=-105, nv_under=-115)
        board = build_nhl.saves_board(days(row), None, [])["9001"]["goalies"][0]
        self.assertEqual(board["nv"], {"line": 26.5, "over": -105, "under": -115})
        self.assertEqual(board["first_nv"], board["nv"])
        previous = {"games": {"9001": {"goalies": [{"team": "AAA", "name": "Al Goalie", "first": {"line": 26.5, "over": 100, "under": -120}, "first_nv": {"line": 26.5, "over": 100, "under": -120}}]}}}
        later = build_nhl.saves_board(days(row), previous, [])["9001"]["goalies"][0]
        self.assertEqual((later["first_nv"], later["nv"]["over"]), ({"line": 26.5, "over": 100, "under": -120}, -105))
        self.assertEqual(build_nhl.ou_nv_col(later), [26.5, 100, -120, -105, -115])
        swapped = build_nhl.saves_board(days(crease_row(id="g2", name="Bo Backup", nv_over=-105, nv_under=-115)), previous, [])["9001"]["goalies"][0]
        self.assertEqual(swapped["first_nv"], swapped["nv"])  # another goalie: a fresh first look


if __name__ == "__main__":
    unittest.main()
