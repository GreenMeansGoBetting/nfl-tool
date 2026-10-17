"""Best book prices (build_nhl.best_book_prices): the owner, 2026-10-17: edges,
plays and the record are figured on the best price any US book quotes at the
same line, not Novig's alone."""

import unittest

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl

GAMES = [{"game_id": "g1", "away": "AAA", "home": "BBB"}]
ODDS = {"g1": {"p1": {
    "sog": {"line": 2.5, "over": 110, "under": -130, "chance": 0.4, "thin": False},
    "goal": {"odds": 250, "no_odds": -300, "thin": False, "chance": 0.28},
    "points": {"line": 0.5, "over": -110, "under": None, "chance": 0.5, "thin": True},
}}}
BOOKS = {"AAA_BBB": {"props": {
    "sog": {"p1": {"q": [["novig", "o", 2.5, 110, None], ["draftkings", "o", 2.5, 125, None], ["fanduel", "o", 3.5, 300, None], ["fanduel", "u", 2.5, -120, None]]}},
    "goals": {"p1": {"q": [["bet365", "o", 0.5, 240, None]]}},
    "points": {"p1": {"q": [["caesars", "o", 0.5, -105, None], ["caesars", "u", 0.5, -125, None]]}},
}}}


class BestPrices(unittest.TestCase):
    def test_best_price_at_the_same_line_and_the_book_it_came_from(self):
        out = build_nhl.best_book_prices(ODDS, BOOKS, GAMES)["g1"]["p1"]
        self.assertEqual((out["sog"]["over"], out["sog"]["over_book"]), (125, "draftkings"))  # not the 3.5 line's +300
        self.assertEqual((out["sog"]["under"], out["sog"]["under_book"]), (-120, "fanduel"))
        self.assertEqual(out["sog"]["nv_over"], 110)
        self.assertEqual(out["goal"]["odds"], 250)  # Novig's +250 beats the book's +240
        self.assertNotIn("book", out["goal"])
        self.assertEqual((out["points"]["over"], out["points"]["over_book"]), (-105, "caesars"))
        self.assertEqual((out["points"]["under"], out["points"]["under_book"]), (-125, "caesars"))  # Novig had none
        self.assertEqual(out["sog"]["chance"], 0.4)  # the chances are left alone

    def test_idempotent_and_leaves_the_input_alone(self):
        once = build_nhl.best_book_prices(ODDS, BOOKS, GAMES)
        self.assertEqual(build_nhl.best_book_prices(once, BOOKS, GAMES), once)
        self.assertEqual(ODDS["g1"]["p1"]["sog"]["over"], 110)

    def test_no_book_prices_means_novigs_untouched(self):
        self.assertIs(build_nhl.best_book_prices(ODDS, None, GAMES), ODDS)
        self.assertEqual(build_nhl.best_book_prices(ODDS, {}, GAMES), ODDS)


if __name__ == "__main__":
    unittest.main()
