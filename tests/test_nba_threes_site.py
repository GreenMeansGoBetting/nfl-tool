"""The NBA Threes page (site/nba/threes.html + threes.js on the game sim's
shared sim-board.js, 2026-10-24) on hand-made data (test_nba_points_site's,
in threes).

What is pinned: the play reads in threes (the list's "o0.5", the Ladder
tag's "3+"), the open row speaks of threes, the board's ladder is 1+ to 6+,
the numbers come out the same as Points', and the page is in the NBA menu."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402
from test_nba_points_site import build  # noqa: E402

DATA, PROPS = build("threes", "fg3m", 0.5, 2.5, "3+")  # 66% over 0.5, 36% for 3+


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, PROPS
        PAGE = SITE.open("nba/threes.html")
        PAGE.wait_for_function("() => !document.getElementById('sim-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Threes(unittest.TestCase):
    def test_the_play_in_threes(self):
        self.assertEqual(SITE.errors, [])
        row = PAGE.inner_text("#sim-list tr.sim-row")
        self.assertIn("o0.5", row)
        self.assertIn("3+ +300 +11.0", " ".join(row.split()))
        self.assertIn("+6.0", row)
        PAGE.click("#sim-list tr.sim-row .sim-rank")
        try:
            self.assertIn("HIS THREES IN THE 10,000 GAMES", PAGE.inner_text("#sim-list tr.sim-detail").upper())
        finally:
            PAGE.click("#sim-list tr.sim-row .sim-rank")

    def test_the_ladder_is_one_to_six(self):
        PAGE.click("[data-view='matchup']")
        try:
            heads = PAGE.evaluate("() => [...document.querySelectorAll('.sim-table thead tr:last-child th')].map((th) => th.innerText.trim())")
            self.assertEqual(heads[-6:], ["1+", "2+", "3+", "4+", "5+", "6+"])
            self.assertIn("-150", PAGE.inner_text(".sim-table td.sim-rung.pick"))
        finally:
            PAGE.click("[data-view='player']")

    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/threes.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
