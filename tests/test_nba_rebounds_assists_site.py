"""The NBA Rebounds and Assists pages (site/nba/rebounds.html / assists.html
+ rebounds.js / assists.js on the game sim's shared sim-board.js, 2026-10-28)
on test_nba_points_site's hand-made data, in rebounds / assists.

What is pinned: the play reads in that stat ("o0.5", the Ladder tag's "3+"),
the hit rates count his rebounds / assists from the game log, the open row
speaks of them, the board's ladder is 4+ to 14+ / 2+ to 12+, the tags
(Glass Fit and Misses Coming from the sim's numbers, Ball Movement Fit from
Team Identity), both pages and Best Plays' four markets are in the NBA menu
and tabs."""
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402
from test_nba_points_site import build  # noqa: E402


def page_data(market, stat):
    data, props = build(market, stat, 0.5, 2.5, "3+")  # the threes-shaped numbers: 66% over 0.5, 36% for 3+
    block = props["seasons"]["2027"]
    i = block["fields"].index("fg3m")
    block["fields"] = block["fields"] + [stat]
    for p in block["players"].values():
        p["log"] = [r + [r[i]] for r in p["log"]]  # his rebounds / assists = the threes the log already has
    return data, props


class Market(unittest.TestCase):
    market = stat = unit = None
    rungs = []

    @classmethod
    def setUpClass(cls):
        if cls.market is None:
            raise unittest.SkipTest("base class")
        cls.site = SiteBrowser()
        try:
            cls.site.nba, cls.site.nba_props = cls.data()
            cls.page = cls.site.open(f"nba/{cls.market}.html")
            cls.page.wait_for_function("() => !document.getElementById('sim-app').hidden")
        except Exception:
            cls.site.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.site.close()

    @classmethod
    def data(cls):
        return page_data(cls.market, cls.stat)

    def test_the_play_in_this_stat(self):
        self.assertEqual(self.site.errors, [])
        row = self.page.inner_text("#sim-list tr.sim-row")
        self.assertIn("o0.5", row)
        self.assertIn("LADDER 3+ +300 +11.0", " ".join(row.upper().split()))
        self.assertIn(f"HIT RATE - BASED ON OVER {self.unit.upper()}", self.page.inner_text("#sim-list thead").upper())
        self.assertIn("80%", row)  # last 5 games over 0.5: 4 of 5, from his own log's field
        self.page.click("#sim-list tr.sim-row .sim-rank")
        try:
            self.assertIn(f"HIS {self.unit.upper()} IN THE 10,000 GAMES", self.page.inner_text("#sim-list tr.sim-detail").upper())
        finally:
            self.page.click("#sim-list tr.sim-row .sim-rank")

    def test_the_ladder_columns(self):
        self.page.click("[data-view='matchup']")
        self.page.click("[data-ladder='away']")
        try:
            heads = self.page.evaluate("() => [...document.querySelectorAll(\".sim-tcard[data-team='away'] tr.sim-thead th\")].map((th) => th.innerText.trim())")
            self.assertEqual(heads[-6:], [f"{n}+" for n in self.rungs])
        finally:
            self.page.click("[data-ladder='away']")
            self.page.click("[data-view='player']")

    def test_in_the_menu_and_the_tabs(self):
        links = self.page.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        for f in ("rebounds", "assists"):
            self.assertTrue(any(h and h.endswith(f"nba/{f}.html") for h in links), links)
        self.assertEqual(self.page.inner_text(".sim-tabs").upper().split(), ["BEST", "PLAYS", "POINTS", "THREES", "REBOUNDS", "ASSISTS"])
        self.assertEqual(self.page.inner_text(".sim-tabs a.on").upper(), self.unit.upper())

    def test_every_tag_of_this_market_in_the_tag_menu(self):
        # the owner, 2026-10-28: "add the new tags to reb and assist drop down menus" (even on a night no row has one)
        opts = self.page.evaluate("() => [...document.querySelectorAll('select[data-list=tag] option')].map((o) => o.textContent)")
        for label in self.menu_tags:
            self.assertIn(label, opts)

    def tag_text(self):
        return " ".join(self.page.inner_text("#sim-list tr.sim-row").upper().split())


class Rebounds(Market):
    market, stat, unit, rungs = "rebounds", "reb", "Rebounds", [4, 6, 8, 10, 12, 14]
    menu_tags = ["Glass Fit", "Tough Glass", "Misses Coming", "Hot Run", "Cold Run"]

    @classmethod
    def data(cls):
        data, props = page_data(cls.market, cls.stat)
        # his position gets 25% more of the boards against BBB, and he rebounds like his position;
        # BBB misses 52 shots a game in tonight's sims against the league's 48
        props["sim"]["900"]["players"]["1"]["glass"] = [1.25, 1.0]
        props["sim"]["900"]["misses"] = {"home": 52.0, "away": 47.0}
        props["sim_meta"]["miss_pg"] = 48.0
        return data, props

    def test_glass_fit_and_misses_coming(self):
        tags = self.tag_text()
        self.assertIn("GLASS FIT", tags)
        self.assertIn("MISSES COMING", tags)


class Assists(Market):
    market, stat, unit, rungs = "assists", "ast", "Assists", [2, 4, 6, 8, 10, 12]
    menu_tags = ["Ball Movement Fit", "Tough Passing D", "Hot Run", "Cold Run"]

    @classmethod
    def data(cls):
        data, props = page_data(cls.market, cls.stat)
        data["identity"] = {"default": "2027", "seasons": {"2027": {"teams": {"BBB": {"def_assisted": 0.72}, "AAA": {"off_assisted": 0.62}},
                                                                    "league": {"def_assisted": {"avg": 0.62, "sd": 0.04},
                                                                               "off_assisted": {"avg": 0.62, "sd": 0.04}}}}}
        return data, props

    def test_ball_movement_fit(self):
        self.assertIn("BALL MOVEMENT FIT", self.tag_text())


class BestPlays(unittest.TestCase):
    """Best Plays reads all four markets: a Rebounds play sorts in with the rest."""

    def test_four_markets(self):
        data, props = page_data("rebounds", "reb")
        site = SiteBrowser()
        try:
            site.nba, site.nba_props = data, props
            page = site.open("nba/best.html")
            page.wait_for_function("() => !document.getElementById('sim-app').hidden")
            self.assertEqual(site.errors, [])
            self.assertIn("REBOUNDS", page.inner_text("#sim-list tr.sim-row").upper())
        finally:
            site.close()




if __name__ == "__main__":
    unittest.main()
