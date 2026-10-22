"""NFL Best Plays' graded record (nfl_tool/best_plays_record.py), on the saved sample.

The owner, 2026-10-22: Best Plays saved nothing, so it had no record. The deploy
now reads the page's own play list (what members see) and keeps it. Pinned:
- odds lock at kickoff: a started game's plays never change, a later capture
  before kickoff replaces the game's list, the first price seen is kept;
- a capture that came back empty for a game keeps that game's plays;
- grading from the play-by-play numbers (props over/under, Anytime TD,
  First TD); a player who didn't play is a void, never a loss;
- the season ledger in ytd.js's row format, and the page's capture itself."""
import unittest
from datetime import datetime, timezone

from helpers import site_data  # first: puts tools/ on the import path

import best_plays_record as bpr

# The sample: Week 5, built 2026-10-12 12:19 UTC. TB @ DAL (Thursday) is final;
# BUF @ LA kicks off that Monday at 8:15 PM Eastern.
BEFORE = datetime(2026, 10, 12, 12, 19, tzinfo=timezone.utc)
AFTER = datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc)


def play(**over):
    p = {"game": "BUF_LA", "game_id": None, "week": 5, "date": "2026-10-12", "team": "BUF", "opp": "LA",
         "name": "Khalil Shakir", "position": "WR", "group": "rec", "market": "receiving_yards",
         "bet": "Over 60.5 Rec Yds", "side": "over", "line": 60.5, "price": -110, "book": "fanduel",
         "edge": 0.05, "chance": 0.57, "rating": "Lean"}
    p.update(over)
    return p


def tb_dal(**over):
    return play(game="TB_DAL", date="2026-10-08", team="TB", opp="DAL", **over)


class Capture(unittest.TestCase):
    def setUp(self):
        self.data = site_data()

    def test_a_capture_before_kickoff_is_kept_and_the_first_price_stays(self):
        rec = bpr.merge_capture({}, {"games": ["BUF_LA_5"], "plays": [play()]}, self.data, BEFORE)
        rec = bpr.merge_capture(rec, {"games": ["BUF_LA_5"], "plays": [play(price=-125, book="draftkings", edge=0.04)]}, self.data, BEFORE)
        (p,) = rec["plays"].values()
        self.assertEqual((p["price"], p["book"], p["first_price"], p["first_book"]), (-125, "draftkings", -110, "fanduel"))

    def test_odds_lock_at_kickoff(self):
        rec = bpr.merge_capture({}, {"games": ["BUF_LA_5"], "plays": [play()]}, self.data, BEFORE)
        rec = bpr.merge_capture(rec, {"games": ["BUF_LA_5"], "plays": [play(price=+300, edge=0.4)]}, self.data, AFTER)
        (p,) = rec["plays"].values()
        self.assertEqual(p["price"], -110)
        # A final game is never added to either, whatever a capture says.
        rec = bpr.merge_capture(rec, {"games": ["TB_DAL_5"], "plays": [tb_dal()]}, self.data, BEFORE)
        self.assertEqual(len(rec["plays"]), 1)

    def test_a_play_the_page_dropped_is_dropped_but_an_empty_game_is_kept(self):
        other = play(name="Dalton Kincaid", bet="Over 50.5 Rec Yds", line=50.5)
        rec = bpr.merge_capture({}, {"games": ["BUF_LA_5"], "plays": [play(), other]}, self.data, BEFORE)
        rec = bpr.merge_capture(rec, {"games": ["BUF_LA_5"], "plays": [other]}, self.data, BEFORE)
        self.assertEqual([p["name"] for p in rec["plays"].values()], ["Dalton Kincaid"])
        rec = bpr.merge_capture(rec, {"games": ["BUF_LA_5"], "plays": []}, self.data, BEFORE)
        self.assertEqual([p["name"] for p in rec["plays"].values()], ["Dalton Kincaid"])


class Grading(unittest.TestCase):
    def setUp(self):
        self.data = site_data()

    def test_props_over_and_under(self):
        # Emeka Egbuka, TB @ DAL: 6 catches for 38 yards.
        self.assertEqual(bpr.grade_play(tb_dal(name="Emeka Egbuka", line=45.5), self.data), 0)
        self.assertEqual(bpr.grade_play(tb_dal(name="Emeka Egbuka", line=45.5, side="under"), self.data), 1)
        self.assertEqual(bpr.grade_play(tb_dal(name="Emeka Egbuka", market="receiving_receptions", line=5.5), self.data), 1)
        self.assertEqual(bpr.grade_play(tb_dal(name="Bucky Irving", group="rush", market="rushing_yards", line=79.5), self.data), 1)

    def test_tds(self):
        self.assertEqual(bpr.grade_play(tb_dal(name="Bucky Irving", group="any", market="anytime_td", side="yes", line=0.5), self.data), 1)
        self.assertEqual(bpr.grade_play(tb_dal(name="Cade Otton", group="any", market="anytime_td", side="yes", line=0.5), self.data), 0)
        # DAL scored first (Javonte Williams): every TB First TD play loses.
        self.assertEqual(bpr.grade_play(tb_dal(name="Bucky Irving", group="first", market="first_td", side="yes", line=None), self.data), 0)

    def test_a_player_who_did_not_play_is_a_void_not_a_loss(self):
        # Baker Mayfield had no Week 5 snap.
        self.assertIsNone(bpr.grade_play(tb_dal(name="Baker Mayfield", group="pass", market="passing_yards", line=230.5), self.data))
        self.assertIsNone(bpr.grade_play(tb_dal(name="Baker Mayfield", group="any", market="anytime_td", side="yes", line=0.5), self.data))

    def test_a_game_not_final_is_not_graded(self):
        self.assertIsNone(bpr.grade_play(play(), self.data))

    def test_the_ledger_is_ytd_rows(self):
        rec = {"plays": {"a": tb_dal(name="Emeka Egbuka", line=45.5, side="under", price=+120, rating="Strong", edge=0.081),
                         "b": tb_dal(name="Cade Otton", group="any", market="anytime_td", side="yes", line=0.5, price=+250, rating="Check"),
                         "c": play()}}
        led = bpr.ledger(bpr.grade(rec, self.data))
        self.assertEqual(led["rec"], [["2026-10-08", 0.081, 1, 1.2, ["rec", "under", "strong"]]])
        self.assertEqual(led["any"], [["2026-10-08", 0.05, 0, -1.0, ["any", "yes", "check"]]])
        self.assertEqual(led["first"], [])
        self.assertEqual(len(bpr.site_file(rec)["plays"]), 2)


class PageCapture(unittest.TestCase):
    """bpCapture() in a real browser: what the deploy saves is the page's own list."""

    @classmethod
    def setUpClass(cls):
        from site_browser import SiteBrowser

        cls.site = SiteBrowser()
        cls.page = cls.site.open("best-plays.html")
        cls.page.wait_for_selector("#bp-app:not([hidden])", timeout=20000)

    @classmethod
    def tearDownClass(cls):
        cls.site.close()

    def test_every_play_on_the_page_is_captured_and_kept(self):
        got = self.page.evaluate("() => bpCapture()")
        self.assertEqual(len(got["plays"]), self.page.evaluate("() => bpRows.length"))
        self.assertNotIn("TB_DAL_5", got["games"])  # final: not the page's
        for p in got["plays"]:
            self.assertIn(p["group"], bpr.GROUPS)
            self.assertIn(p["side"], ("over", "under", "yes"))
            self.assertTrue(p["market"] in bpr.PROP_STATS or p["market"] in ("anytime_td", "first_td"), p["market"])
            self.assertIsNotNone(p["price"])
        rec = bpr.merge_capture({}, got, site_data(), BEFORE)
        self.assertEqual(len(rec["plays"]), len(got["plays"]))


if __name__ == "__main__":
    unittest.main()
