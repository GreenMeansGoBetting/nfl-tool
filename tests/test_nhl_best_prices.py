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


SAVES = {"g1": {"AAA": [{"id": "77", "name": "Goalie One", "line": 26.5, "over": -115, "under": -105, "chance": 0.52, "thin": False, "alts": []},
                        {"id": None, "name": "Unknown Two", "line": 24.5, "over": 100, "under": -120, "chance": 0.48, "thin": False, "alts": []}]}}
SAVE_BOOKS = {"AAA_BBB": {"props": {"saves": {
    "77": {"q": [["fanduel", "o", 26.5, -108, None], ["draftkings", "o", 27.5, 120, None], ["betmgm", "u", 26.5, -110, None]]},
}}}}


class BestSavesPrices(unittest.TestCase):
    """The owner, 2026-10-20: SmartStake has "Player Saves" too, so the Saves page shops like the others."""

    def test_best_price_at_novigs_line_and_novigs_fair_chance_kept(self):
        out = build_nhl.best_saves_prices(SAVES, SAVE_BOOKS, GAMES)["g1"]["AAA"]
        one, two = out
        self.assertEqual((one["over"], one["over_book"]), (-108, "fanduel"))  # not the 27.5 line's +120
        self.assertEqual(one["under"], -105)  # Novig's -105 beats the book's -110
        self.assertNotIn("under_book", one)
        self.assertEqual((one["nv_over"], one["chance"]), (-115, 0.52))  # King of the Crease's market number is Novig's
        self.assertEqual((two["over"], two.get("over_book")), (100, None))  # a goalie the site doesn't know: Novig's
        self.assertEqual(build_nhl.best_saves_prices(build_nhl.best_saves_prices(SAVES, SAVE_BOOKS, GAMES), SAVE_BOOKS, GAMES)["g1"]["AAA"], out)
        self.assertEqual(SAVES["g1"]["AAA"][0]["over"], -115)
        self.assertIs(build_nhl.best_saves_prices(SAVES, None, GAMES), SAVES)

    def test_the_saves_market_is_found_by_name_never_guessed(self):
        import smartstake
        listed = [{"key": "hockey_player_saves", "name": "Player Saves"}, {"key": "hockey_period_1_player_saves", "name": "1st Period Player Saves"},
                  {"key": "hockey_team_saves", "name": "Team Saves"}, {"key": "hockey_player_shots_on_goal", "name": "Player Shots On Goal"}]
        self.assertEqual(smartstake.saves_market_keys(listed), ["hockey_player_saves"])
        self.assertEqual(smartstake.saves_market_keys(None), [])


if __name__ == "__main__":
    unittest.main()
