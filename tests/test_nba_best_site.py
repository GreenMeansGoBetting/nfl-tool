"""The NBA Best Plays page (site/nba/best.html + best.js on the game sim's
shared sim-board.js, 2026-10-25) on test_nba_points_site's hand-made data,
Points and Threes together.

What is pinned (the owner: "Keep the consistency present in those individual
categories, but sort the best plays by edge, aggregating from these two
categories"): both markets' plays in one list, biggest edge first, each with
its Market, its own play chip, hit rates over its own stat and its own tags;
a Market switch takes one out (the last one stays on); the open row speaks of
its own market; the record and the YTD popup count both; there is no Matchup
View; past nights list both markets' plays; the page is in the NBA menu and
Points / Threes link to it."""
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402
from test_nba_points_site import build  # noqa: E402


def merged():
    data, props = build("points", "pts", 19.5, 29.5, "30+")
    tdata, tprops = build("threes", "fg3m", 0.5, 2.5, "3+")
    props = copy.deepcopy(props)
    for gid, game in props["sim"].items():
        for pid, r in game["players"].items():
            r["fg3m"] = tprops["sim"][gid]["players"][pid]["fg3m"]
    for key in ("sim_plays", "sim_record", "sim_past"):
        props[key]["threes"] = tprops[key]["threes"]
    t = tdata["book_odds"]["AAA_BBB"]["props"]
    # Threes' o0.5 at FanDuel -130 (needs 56.5%): 9.5 points of edge, more than Points' 6.0
    t["threes"]["1"]["q"] = [q if q[0] != "fanduel" else ["fanduel", "o", 0.5, -130] for q in t["threes"]["1"]["q"]]
    data["book_odds"]["AAA_BBB"]["props"].update(t)
    return data, props


DATA, PROPS = merged()


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, PROPS
        PAGE = SITE.open("nba/best.html")
        PAGE.wait_for_function("() => !document.getElementById('sim-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def rows():
    return PAGE.evaluate("() => [...document.querySelectorAll('#sim-list tr.sim-row')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())")


class BestPlays(unittest.TestCase):
    def test_both_markets_by_edge(self):
        self.assertEqual(SITE.errors, [])
        self.assertIn("PROJECTIONS IN TESTING", PAGE.inner_text("#sim-testing").upper())
        self.assertIn("MODEL BEING TESTED AGAINST ITS RECORD", PAGE.inner_text("#sim-testing").upper())  # 2026-10-28: start from the line
        got = rows()
        self.assertEqual(len(got), 2, got)
        self.assertIn("THREES", got[0].upper())
        self.assertIn("o0.5 -130 FD", got[0])
        self.assertIn("+9.5", got[0])
        self.assertIn("80%", got[0])  # last 5 games over 0.5 threes: 4 of 5
        self.assertIn("LADDER 3+", got[0].upper())
        self.assertIn("POINTS", got[1].upper())
        self.assertIn("o19.5 -150 FD", got[1])
        self.assertIn("+6.0", got[1])
        self.assertIn("LADDER 30+", got[1].upper())
        self.assertIn("HIT RATE - BASED ON OVER HIS LINE", PAGE.inner_text("#sim-list thead").upper())
        self.assertIn("2 Plays", PAGE.inner_text("#matchup-row"))

    def test_no_matchup_view(self):
        self.assertEqual(PAGE.locator("[data-view='matchup']").count(), 0)
        self.assertEqual(PAGE.locator("#sim-matchup").count(), 0)

    def test_a_market_switch(self):
        PAGE.click("[data-list-market='threes']")
        try:
            got = rows()
            self.assertEqual(len(got), 1, got)
            self.assertIn("POINTS", got[0].upper())
            PAGE.click("[data-list-market='points']")  # the last one on stays on
            self.assertEqual(len(rows()), 1)
        finally:
            PAGE.click("[data-list-market='threes']")
        self.assertEqual(len(rows()), 2)

    def test_the_open_row_is_its_own_market(self):
        PAGE.click("#sim-list tr.sim-row .sim-rank >> nth=1")
        try:
            self.assertIn("HIS POINTS IN THE 10,000 GAMES", PAGE.inner_text("#sim-list tr.sim-detail").upper())
        finally:
            PAGE.click("#sim-list tr.sim-row .sim-rank >> nth=1")
        PAGE.click("#sim-list tr.sim-row .sim-rank >> nth=0")
        try:
            self.assertIn("HIS THREES IN THE 10,000 GAMES", PAGE.inner_text("#sim-list tr.sim-detail").upper())
        finally:
            PAGE.click("#sim-list tr.sim-row .sim-rank >> nth=0")

    def test_the_record_counts_both(self):
        # each market's ledger: 1-1 +2.0u, so the season is 2-2 +4.0u
        self.assertIn("2-2", PAGE.inner_text("#sim-record"))
        self.assertIn("+4.0u", PAGE.inner_text("#sim-record"))
        PAGE.click("#sim-ytd")
        try:
            box = PAGE.inner_text("#sim-ytd-modal").upper()
            for label in ("ALL PLAYS", "POINTS PLAYS", "THREES PLAYS"):
                self.assertIn(label, box)
        finally:
            PAGE.evaluate("() => { document.getElementById('sim-ytd-modal').hidden = true; }")

    def test_a_past_night_lists_both(self):
        PAGE.click("#day-prev")
        try:
            got = rows()
            self.assertEqual(len(got), 4, got)
            self.assertEqual(sum("THREES" in r.upper() for r in got), 2)
        finally:
            PAGE.click("#day-next")

    def test_linked(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/best.html") for h in links), links)
        self.assertIn("BEST PLAYS", PAGE.inner_text(".sim-tabs").upper())


if __name__ == "__main__":
    unittest.main()
