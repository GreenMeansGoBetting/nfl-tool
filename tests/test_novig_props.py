"""Novig TD odds (build_stats.extract_novig_props), read from a saved game.

Most Novig First TD markets are one-sided (a Yes price, nobody selling No).
They used to be dropped, leaving 2-5 First TD prices a game. Every believable
Yes price is kept now, junk quotes are dropped, and a game's First TD chances
add up to about 100%."""
import copy
import unittest

from helpers import novig_event  # first: puts nfl_tool/ on the import path

import build_stats

TEAMS = ["HOU", "JAX"]
MARKETS = novig_event()["event"]["markets"]


def read(markets, unavailable=()):
    """(anytime rows, first TD rows) for the one game, both teams together."""
    _, anytime, first = build_stats.extract_novig_props({("HOU", "JAX"): markets}, TEAMS, {}, set(unavailable))
    return anytime["HOU"] + anytime["JAX"], first["HOU"] + first["JAX"]


def by_name(rows):
    return {r["name"]: r for r in rows}


def sample_market(mtype):
    return next(m for m in MARKETS if m["type"] == mtype and m["is_consensus"] and m.get("player"))


def td_market(name, mtype, yes, no=None, team="HOU", strike=None, consensus=True):
    """A made-up market in exactly the shape Novig sends (copied from a real one)."""
    m = copy.deepcopy(sample_market(mtype))
    m["player"]["full_name"] = name
    m["player"]["player_competitors"][0]["competitor"]["symbol"] = team
    m["is_consensus"] = consensus
    if strike is not None:
        m["strike"] = strike
    for outcome in m["outcomes"]:
        side = outcome["description"].split(" ")[0].lower()
        outcome["available"] = yes if side in ("yes", "over") else no
    return m


def first_td(name, yes, no=None, **kw):
    return td_market(name, "FIRST_TOUCHDOWN_SCORER", yes, no, **kw)


def anytime_td(name, yes, no=None, **kw):
    return td_market(name, "TOUCHDOWNS", yes, no, **kw)


class SavedGame(unittest.TestCase):
    """HOU @ JAX as Novig listed it on 2026-10-13: 29 First TD markets, every
    one of them one-sided, one with no price at all."""

    def setUp(self):
        self.anytime, self.first = read(copy.deepcopy(MARKETS))

    def priced(self, mtype, side):
        out = []
        for m in MARKETS:
            if m["type"] == mtype and m["is_consensus"] and m.get("player") and (mtype != "TOUCHDOWNS" or m["strike"] == 0.5):
                prices = {o["description"].split(" ")[0].lower(): o["available"] for o in m["outcomes"]}
                if prices.get(side):
                    out.append(m["player"]["full_name"])
        return out

    def test_one_sided_first_td_prices_are_kept(self):
        priced = self.priced("FIRST_TOUCHDOWN_SCORER", "yes")
        self.assertEqual(len(priced), 28)
        self.assertEqual(self.priced("FIRST_TOUCHDOWN_SCORER", "no"), [], "the saved game should have no two-sided First TD market")
        self.assertEqual(sorted(by_name(self.first)), sorted(priced))
        for row in self.first:
            self.assertTrue(row["thin"], row["name"])
            self.assertEqual(row["best_book"], "Novig")
            self.assertIsNotNone(row["best_odds"])
            self.assertIsNotNone(row["fair_odds"])

    def test_first_td_chances_sum_to_about_100(self):
        total = sum(r["implied_prob"] for r in self.first)
        self.assertAlmostEqual(total, 1.0, delta=0.02)

    def test_a_market_with_no_price_is_dropped(self):
        self.assertNotIn("Jared Wayne", by_name(self.first))
        self.assertNotIn("Jared Wayne", by_name(self.anytime))

    def test_anytime_td_prices_are_kept(self):
        self.assertEqual(sorted(by_name(self.anytime)), sorted(self.priced("TOUCHDOWNS", "over")))
        self.assertEqual(len(self.anytime), 28)
        two_sided = by_name(self.anytime)["Ameer Abdullah"]  # Yes 6.0c, No 96.0c
        self.assertFalse(two_sided["thin"])
        self.assertEqual(two_sided["implied_prob"], round(0.06 / (0.06 + 0.96), 3))
        for row in self.anytime:
            self.assertTrue(0 < row["implied_prob"] < 1, row)

    def test_players_land_on_their_own_team(self):
        _, anytime, first = build_stats.extract_novig_props({("HOU", "JAX"): copy.deepcopy(MARKETS)}, TEAMS, {}, set())
        self.assertIn("Nico Collins", by_name(first["HOU"]))
        self.assertIn("Trevor Lawrence", by_name(first["JAX"]))
        self.assertIn("Nico Collins", by_name(anytime["HOU"]))


class JunkQuotes(unittest.TestCase):
    def test_junk_quotes_are_dropped(self):
        anytime, first = read([
            first_td("Real Starter", 0.20),
            first_td("Both Sides Maxed", 0.999, 0.999),  # the backup-TE case: 99.9c on both sides
            first_td("Over Half", 0.60),  # no First TD favorite is above 50%
            first_td("No Price", None),
            anytime_td("Real Runner", 0.45, 0.60),
            anytime_td("Sure Thing", 0.97),
            anytime_td("Sides Too Far Apart", 0.70, 0.90),
        ])
        self.assertEqual(sorted(by_name(first)), ["Real Starter"])
        self.assertEqual(sorted(by_name(anytime)), ["Real Runner"])

    def test_only_the_main_line_for_this_weeks_teams(self):
        anytime, first = read([
            first_td("Main Line", 0.20),
            first_td("Alternate Line", 0.20, consensus=False),
            first_td("Other Game", 0.20, team="DAL"),
            anytime_td("Scores Once", 0.30),
            anytime_td("Scores Twice", 0.10, strike=1.5),  # 2+ TDs is a different bet
        ])
        self.assertEqual(sorted(by_name(first)), ["Main Line"])
        self.assertEqual(sorted(by_name(anytime)), ["Scores Once"])

    def test_a_player_ruled_out_is_left_off(self):
        markets = [first_td(f"Player {i}", 0.30) for i in range(4)] + [anytime_td("Player 0", 0.40)]
        anytime, first = read(markets, unavailable={"Player 0"})
        self.assertEqual(sorted(by_name(first)), ["Player 1", "Player 2", "Player 3"])
        self.assertEqual(anytime, [])
        # ...and his price no longer counts toward the game's 100%.
        self.assertEqual({r["implied_prob"] for r in first}, {0.3})


class FirstTdChances(unittest.TestCase):
    def test_a_full_list_is_scaled_down_to_100(self):
        _, first = read([first_td(f"Player {i}", 0.30) for i in range(4)])  # Yes prices add to 120%
        self.assertEqual([r["implied_prob"] for r in first], [0.25] * 4)
        self.assertEqual({r["fair_odds"] for r in first}, {300})
        self.assertEqual({r["best_odds"] for r in first}, {233})

    def test_a_short_list_is_never_scaled_up(self):
        _, first = read([first_td("Only One", 0.10), first_td("And Another", 0.15)])
        self.assertEqual(sorted(r["implied_prob"] for r in first), [0.1, 0.15])

    def test_two_sided_first_td_is_not_flagged_thin(self):
        _, first = read([first_td("Two Sided", 0.20, 0.85), first_td("One Sided", 0.10)])
        self.assertFalse(by_name(first)["Two Sided"]["thin"])
        self.assertTrue(by_name(first)["One Sided"]["thin"])


class AnytimeChances(unittest.TestCase):
    def test_two_sided_uses_both_prices(self):
        anytime, _ = read([anytime_td("Two Sided", 0.40, 0.65)])
        self.assertEqual(anytime[0]["implied_prob"], round(0.40 / 1.05, 3))

    def test_one_sided_borrows_the_games_usual_markdown(self):
        anytime, _ = read([
            anytime_td("A", 0.40, 0.65),  # fair / Yes = 1 / 1.05
            anytime_td("B", 0.30, 0.80),  # 1 / 1.10  <- the game's middle
            anytime_td("C", 0.20, 0.95),  # 1 / 1.15
            anytime_td("One Sided", 0.50),
        ])
        self.assertEqual(by_name(anytime)["One Sided"]["implied_prob"], round(0.50 / 1.10, 3))
        self.assertTrue(by_name(anytime)["One Sided"]["thin"])


class Prices(unittest.TestCase):
    def test_price_to_american_odds(self):
        cases = {0.5: -100, 0.25: 300, 0.75: -300, 0.535: -115, 0.014: 7043, None: None, 0: None, 1: None, 1.2: None}
        for price, odds in cases.items():
            self.assertEqual(build_stats.novig_price_to_american(price), odds, price)


if __name__ == "__main__":
    unittest.main()
