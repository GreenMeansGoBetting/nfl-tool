"""The Props Summary card's package headers (props-summary.js propPackageHtml),
run in a real browser.

What is pinned (the owner, 2026-10-24): in a saved image, the QB package's
last market chip ("Long Comp") sat on top of the player line below it.
Save image (html-to-image) freezes every box at its on-screen size and text
can draw a hair wider in the copy, so a chip row that hugged its chips had
0px to spare and wrapped its last chip into a box one line tall. The chip
row now takes the rest of the header's width, and no chip, name or player
can break inside its own box."""
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class PackageHeaders(unittest.TestCase):
    def test_chip_rows_fill_the_header_and_nothing_breaks_inside_its_box(self):
        page = SITE.open("player-props.html#summary")
        try:
            page.wait_for_selector("#summary-card .ps-pk-mkts", state="attached", timeout=20000)
            rows = page.evaluate("""() => [...document.querySelectorAll('#summary-card .ps-pk-mkts')].map((m) => {
                const head = m.parentElement.getBoundingClientRect();
                return { name: m.parentElement.querySelector('.ps-pk-name').textContent, gap: head.right - m.getBoundingClientRect().right };
            })""")
            self.assertTrue(rows, "no packages on the sample's Props Summary")
            for row in rows:
                self.assertLess(row["gap"], 1, f"{row['name']}: the chip row hugs its chips, so a saved image can wrap the last one")
            loose = page.evaluate("""() => [...document.querySelectorAll('#summary-card .ps-pk-name, #summary-card .ps-pk-mkts span, #summary-card .ps-pk-player, #summary-card .ps-pk-tags span')]
                .filter((e) => getComputedStyle(e).whiteSpace !== 'nowrap').map((e) => e.textContent)""")
            self.assertEqual(loose, [])
        finally:
            page.close()

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()


class PlayerCardHitRate(unittest.TestCase):
    # A member, 2026-11-09: the NFL card's Odds tab gets the NBA card's "6 of 8" hit rate per prop.
    def test_hit_rate_counts_his_games_over_the_line(self):
        page = SITE.open("player-props.html")
        try:
            page.wait_for_function("() => typeof pcHitCell === 'function'")
            got = page.evaluate("""() => {
                const weeks = [{ rec_yards: 80, rec_td: 1 }, { rec_yards: 40 }, { rec_yards: 70 }, { week: 4 }];
                const text = (html) => { const t = document.createElement('table'); t.innerHTML = `<tr>${html}</tr>`; const td = t.querySelector('td'); return [td.textContent, td.className]; };
                return [text(pcHitCell('receiving_yards', 54.5, weeks)), text(pcHitCell('anytime_td', 0.5, weeks)), text(pcHitCell('fantasyScore', 10.5, weeks))];
            }""")
            self.assertEqual(got[0][0], "2 of 4")  # a no-touch week he played counts as 0
            self.assertEqual(got[1][0], "1 of 4")
            self.assertIn("tier-bad", got[1][1])
            self.assertEqual(got[2][0], "--")  # the logs don't carry fantasy points
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])
