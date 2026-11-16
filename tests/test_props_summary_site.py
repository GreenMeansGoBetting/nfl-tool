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


class BestBookPrices(unittest.TestCase):
    # The owner, 2026-11-16: the Props Summary's pick list and Prop Picks rail showed Novig's
    # price on every line, while the Player Props page showed the best price across the books.
    # Now each row carries the best price across the member's books at Novig's line, the book's
    # name, and Novig's own price for the model math; Novig's stays when no book has the line.
    def test_rows_take_the_best_book_price_at_novigs_line(self):
        page = SITE.open("player-props.html")
        try:
            page.wait_for_function("() => typeof propTeamLines === 'function' && typeof DATA !== 'undefined' && DATA")
            got = page.evaluate("""() => {
                const markets = DATA.player_prop_markets;
                const both = (l) => l.over_odds !== null && l.over_odds !== undefined && l.under_odds !== null && l.under_odds !== undefined;
                const team = Object.keys(markets.receiving_yards).find((t) => markets.receiving_yards[t].some(both)
                    && DATA.schedule.some((g) => g.away === t || g.home === t));
                const game = DATA.schedule.find((g) => g.away === team || g.home === team);
                const opp = game.away === team ? game.home : game.away;
                const line = markets.receiving_yards[team].find(both);
                const q = (book, side, at, odds) => [book, side, at, odds, ""];
                DATA.book_odds = { [`${game.away}_${game.home}`]: { props: { receiving_yards: { [normName(line.name)]: { q: [
                    q("draftkings", "o", line.line, 130), q("fanduel", "o", line.line, 125), q("underdog_dfs", "o", line.line, 200),
                    q("fanduel", "o", line.line + 5, 300), q("draftkings", "u", line.line, -150), q("fanduel", "u", line.line, -140),
                ] } } } } };
                const rows = propTeamLines(team, opp, game.week, game);
                const r = rows.find((x) => x.marketKey === 'receiving_yards' && x.name === line.name);
                const other = rows.find((x) => x.marketKey !== 'receiving_yards');
                const cell = document.createElement('div');
                cell.innerHTML = propPriceSource(r);
                return { r, novig: [line.over_odds, line.under_odds], src: cell.textContent,
                         other: other ? [other.over === other.nvOver, other.overBook, propPriceSource(other).startsWith('Novig') || propPriceSource(other) === 'Books'] : null };
            }""")
            r = got["r"]
            self.assertEqual((r["over"], r["overBook"]), (130, "draftkings"))  # not Underdog's pick'em +200, not another line's +300
            self.assertEqual((r["under"], r["underBook"]), (-140, "fanduel"))
            self.assertEqual([r["nvOver"], r["nvUnder"]], got["novig"])  # Novig's kept for the model
            self.assertEqual(got["src"], "DK / FD")
            if got["other"]:
                self.assertEqual(got["other"], [True, None, True])  # no book has it: Novig's price and label
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])
