"""Possible Plays' Photo Export (site/possible-plays.js), run in a real browser.

What is pinned (2026-10-20, a member: his saved card "is basically just listing
all my bets", he wanted the greens and reds and the units): once a week's plays
are graded, "Show results" is on, each row is shaded by its result with its units,
and the title bar carries the record. A total names its game ("BUF @ KC Over
54.5"), never a bare "Over 54.5"."""
import json
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None
PLAYS = [
    {"id": "2026_99_BUF_KC_total_over", "week": 99, "matchup": "BUF @ KC", "category": "Total",
     "description": "Over 54.5", "odds": "-110", "book": None, "result": "win", "result_source": "manual"},
    {"id": "2026_99_BUF_KC_spread_home", "week": 99, "matchup": "BUF @ KC", "category": "Spread",
     "description": "KC -2.5", "odds": "-110", "book": None},
    {"id": "Josh Allen_Anytime TD_99", "week": 99, "matchup": "BUF @ KC", "category": "Anytime TD", "team": "BUF",
     "description": "Josh Allen", "odds": "+200", "book": None, "result": "loss", "result_source": "manual"},
]


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class PhotoExport(unittest.TestCase):
    def open_export(self):
        page = SITE.open("possible-plays.html")
        page.evaluate("(plays) => localStorage.setItem('nfl-tool.possible-plays.v1', JSON.stringify(plays))", PLAYS)
        page.reload()
        page.wait_for_function("() => typeof DATA !== 'undefined' && DATA !== null")
        page.evaluate("() => { exportWeek = 99; exportCats = new Set(['Total', 'Spread', 'Anytime TD']); openExportModal(); }")
        return page

    def test_graded_week_shows_results_and_record(self):
        page = self.open_export()
        try:
            self.assertTrue(page.is_checked("#pe-show-results"))
            rows = page.evaluate("() => [...document.querySelectorAll('#plays-export-card .pe-row')].map((r) => [r.className.split(' ').pop(), r.querySelector('.pe-play').textContent, r.querySelector('.pe-units').textContent])")
            by_play = {play: (cls, units) for cls, play, units in rows}
            self.assertEqual(by_play["BUF @ KC Over 54.5"], ("pe-row-win", "+0.91u"))
            self.assertEqual(by_play["Josh Allen"], ("pe-row-loss", "-1.00u"))
            self.assertEqual(by_play["KC -2.5"], ("pe-row-pending", "Pending"))
            self.assertEqual(page.inner_text("#plays-export-card .pe-record").split(), ["1-1", "-0.09u"])
            self.assertIn("pe-record-down", page.get_attribute("#plays-export-card .pe-record", "class"))
            self.assertIn("1 pending", page.inner_text("#plays-export-card .pe-head").lower())
            # The total shows both teams' logos, the spread its side's.
            logos = page.evaluate("() => [...document.querySelectorAll('#plays-export-card .pe-row')].map((r) => [r.querySelector('.pe-play').textContent, [...r.querySelectorAll('.pe-logo img')].map((i) => i.alt).join(',')])")
            self.assertIn(["BUF @ KC Over 54.5", "BUF,KC"], logos)
            self.assertIn(["KC -2.5", "KC"], logos)
            # Unchecking goes back to the plain list.
            page.click("#pe-show-results")
            self.assertEqual(page.locator("#plays-export-card .pe-units").count(), 0)
            self.assertIn("3 plays", page.inner_text("#plays-export-card .pe-head").lower())
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
