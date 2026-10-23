"""NFL prices from SmartStake (every US book) after SGO was removed
(2026-10-23, the owner: SmartStake "will always reign supreme").

Anytime TD: build_stats.book_td_odds + merge_td_odds. The schedule's
spread / total / moneyline: apply_book_schedule_lines. The bug behind it:
Jaleel McLaughlin showed +154 (an SGO "fair value" stand-in) on the TD
Summary while FanDuel had +600."""
import unittest

import helpers  # noqa: F401  first: puts nfl_tool/ on the import path

import build_stats

ROSTER = {"Jaleel McLaughlin": {"DEN"}, "Bo Nix": {"DEN"}, "Trey McBride": {"ARI"}}
POS = {"Jaleel McLaughlin": "RB", "Bo Nix": "QB", "Trey McBride": "TE"}


def td(name, *quotes):
    return {"name": name, "q": [[book, side, 0.5, odds, ""] for book, side, odds in quotes]}


BOOKS = {"DEN_ARI": {"kickoff": "2026-10-25T20:05:00Z", "props": {}, "lines": {}, "td": {
    "jaleelmclaughlin": td("Jaleel McLaughlin", ("fanduel", "o", 600), ("draftkings", "o", 450), ("draftkings", "u", -800), ("offshorebook", "o", 900)),
    "bonix": td("Bo Nix", ("fanduel", "o", 320)),
    "treymcbride": td("Trey McBride", ("betmgm", "o", 120), ("betmgm", "u", -150)),
    "nobody": td("Practice Squad Guy", ("fanduel", "o", 2500)),
}}}


class BookTdOdds(unittest.TestCase):
    def setUp(self):
        self.rows = build_stats.book_td_odds(BOOKS, ROSTER, POS, unavailable=set())
        self.by = {r["name"]: r for rows in self.rows.values() for r in rows}

    def test_best_us_book_price(self):
        mcl = self.by["Jaleel McLaughlin"]
        self.assertEqual((mcl["best_odds"], mcl["best_book"]), (600, "FanDuel"))  # not the offshore +900
        self.assertEqual(mcl["position"], "RB")

    def test_each_player_on_his_roster_team(self):
        self.assertEqual({r["name"] for r in self.rows["DEN"]}, {"Jaleel McLaughlin", "Bo Nix"})
        self.assertEqual([r["name"] for r in self.rows["ARI"]], ["Trey McBride"])
        self.assertNotIn("Practice Squad Guy", self.by)  # on neither roster

    def test_no_vig_chance(self):
        # Two-sided DraftKings: +450 / -800 -> 0.1818 / (0.1818 + 0.8889).
        self.assertAlmostEqual(self.by["Jaleel McLaughlin"]["implied_prob"], 0.17, places=2)
        # One-sided: the Yes chance x 0.9.
        self.assertAlmostEqual(self.by["Bo Nix"]["implied_prob"], round(100 / 420 * 0.9, 3))

    def test_ruled_out_players_left_off(self):
        rows = build_stats.book_td_odds(BOOKS, ROSTER, POS, unavailable={"Bo Nix"})
        self.assertEqual([r["name"] for r in rows["DEN"]], ["Jaleel McLaughlin"])


class MergeWithNovig(unittest.TestCase):
    def test_book_price_leads_and_novig_chance_stays(self):
        novig = {"DEN": [{"name": "Bo Nix", "position": "QB", "best_odds": 300, "best_book": "Novig", "implied_prob": 0.22}],
                 "ARI": [{"name": "Marvin Harrison Jr.", "position": "WR", "best_odds": 200, "best_book": "Novig", "implied_prob": 0.31}]}
        merged = build_stats.merge_td_odds(build_stats.book_td_odds(BOOKS, ROSTER, POS, set()), novig)
        by = {r["name"]: r for rows in merged.values() for r in rows}
        self.assertEqual((by["Bo Nix"]["best_odds"], by["Bo Nix"]["best_book"], by["Bo Nix"]["implied_prob"]), (320, "FanDuel", 0.22))
        self.assertEqual(by["Jaleel McLaughlin"]["best_odds"], 600)  # books only
        self.assertEqual(by["Marvin Harrison Jr."]["best_book"], "Novig")  # Novig only
        self.assertEqual([r["name"] for r in merged["DEN"]], ["Bo Nix", "Jaleel McLaughlin"])  # most likely first


class ScheduleLines(unittest.TestCase):
    def game(self):
        return {"away": "DEN", "home": "ARI", "spread_line": 1.0, "away_team_spread": 1.0, "home_team_spread": -1.0,
                "total_line": 44.0, "away_moneyline": 100, "home_moneyline": -120}

    def test_consensus_line_at_its_best_price(self):
        lines = {"spread": [["fanduel", "away", 2.5, -110, ""], ["draftkings", "away", 2.5, -105, ""], ["betmgm", "away", 3.0, -125, ""],
                            ["fanduel", "home", -2.5, -110, ""], ["draftkings", "home", -2.5, -115, ""], ["betmgm", "home", -3.0, 105, ""]],
                 "total": [["fanduel", "o", 45.5, -110, ""], ["draftkings", "o", 45.5, -108, ""], ["fanduel", "u", 45.5, -110, ""], ["draftkings", "u", 45.5, -112, ""]],
                 "ml": [["fanduel", "away", 120, ""], ["draftkings", "away", 125, ""], ["fanduel", "home", -140, ""], ["draftkings", "home", -145, ""]]}
        lines["ml"] = [[b, s, None, o, u] for b, s, o, u in lines["ml"]]
        g = self.game()
        build_stats.apply_book_schedule_lines([g], {"DEN_ARI": {"lines": lines}})
        self.assertEqual((g["spread_line"], g["away_team_spread"], g["home_team_spread"]), (2.5, 2.5, -2.5))
        self.assertEqual((g["away_spread_odds"], g["home_spread_odds"]), (-105, -110))
        self.assertEqual((g["total_line"], g["over_odds"], g["under_odds"]), (45.5, -108, -110))
        self.assertEqual((g["away_moneyline"], g["home_moneyline"]), (125, -140))
        self.assertAlmostEqual(g["away_ml_implied_prob"] + g["home_ml_implied_prob"], 1.0, places=2)

    def test_no_book_lines_keeps_the_schedule_line(self):
        g = self.game()
        build_stats.apply_book_schedule_lines([g], {})
        self.assertEqual(g, self.game())


if __name__ == "__main__":
    unittest.main()
