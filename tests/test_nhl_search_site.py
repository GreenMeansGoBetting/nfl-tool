"""The player search in the Player header of every NHL prop table (nhl-common.js
nameSearchBox; the owner, 2026-10-16: "if i start typing in GEE it will only show
names of players with that"), in a real browser on the saved samples.

What is pinned, on Shots, Goals, Points, Best Plays and Line Stacks: typing keeps
only rows whose player name contains the text (case and accents don't matter;
on Line Stacks, a stack with any matching leg); the box keeps its cursor while
the table redraws; a search that matches nobody keeps the table and the box,
with a "No players match" line; clearing it brings every row back."""
import unicodedata
import unittest

import helpers  # noqa: F401  (first: puts tools/ on the import path)

from site_browser import SiteBrowser

SITE = None
PAGES = {
    # page: (the global its data loads into, how a row's player names are read)
    "nhl/shots.html": ("SHOTS", "(tr) => [tr.querySelector('.shots-player span').textContent]"),
    "nhl/goals.html": ("GOALS", "(tr) => [tr.querySelector('.shots-player span').textContent]"),
    "nhl/points.html": ("POINTS", "(tr) => [tr.querySelector('.shots-player span').textContent]"),
    "nhl/best.html": ("SHOTS", "(tr) => [tr.querySelector('.shots-player span').textContent]"),
    "nhl/stacks.html": ("STACKS", "(tr) => [...tr.querySelectorAll('.stk-leg .player-click span')].map((s) => s.textContent)"),
}


def plain(text):
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower()


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class PlayerSearch(unittest.TestCase):
    def test_every_prop_page(self):
        for path, (loaded, names) in PAGES.items():
            with self.subTest(path):
                page = SITE.open(path)
                page.wait_for_function(f"() => typeof {loaded} !== 'undefined' && {loaded} !== null", timeout=20000)
                # 10/13: the sample's day with open games and prices on every page.
                page.evaluate("() => { dayIndex = days().indexOf('2026-10-13'); render(); }")
                page.wait_for_function("() => document.querySelector('.nhl-name-search')")
                rows = f"() => [...document.querySelectorAll('.shots-row')].map({names})"
                before = page.evaluate(rows)
                self.assertTrue(before, path)
                # Three letters from the middle of the first row's (first) name, typed in capitals.
                name = before[0][0]
                bit = plain(name.split(" ")[-1])[1:4].upper()
                box = page.locator(".nhl-name-search")
                box.click()
                box.press_sequentially(bit)
                after = page.evaluate(rows)
                self.assertTrue(after)
                self.assertTrue(all(any(bit.lower() in plain(n) for n in r) for r in after), (path, bit, after[:3]))
                self.assertLessEqual(len(after), len(before))
                self.assertTrue(page.evaluate("() => document.activeElement.classList.contains('nhl-name-search')"), path)
                self.assertEqual(page.input_value(".nhl-name-search"), bit)
                # Nobody matches: the table and the box stay, with a note.
                box.press_sequentially("zzq")
                self.assertEqual(page.evaluate(rows), [])
                self.assertIn("No players match", page.inner_text(".nhl-name-miss"))
                self.assertEqual(page.locator(".nhl-name-search").count(), 1)
                # Cleared: everything is back.
                page.fill(".nhl-name-search", "")
                page.dispatch_event(".nhl-name-search", "input")
                self.assertEqual(len(page.evaluate(rows)), len(before))
                page.close()
        self.assertEqual(SITE.errors, [])

    def test_accents_do_not_matter(self):
        page = SITE.open("nhl/points.html")
        page.wait_for_function("() => typeof POINTS !== 'undefined' && POINTS !== null")
        self.assertTrue(page.evaluate("() => { NAME_SEARCH = 'stutzle'; return nameMatches('Tim Stützle') && !nameMatches('Brady Tkachuk'); }"))
        page.close()


if __name__ == "__main__":
    unittest.main()
