"""NFL Best Plays (site/best-plays.js), run in a real browser on the saved sample.

What is pinned (the owner, 2026-10-20: members wanted "top plays" for props and
TDs, with a warning that a few games is a small sample):
- the page draws this week's plays with the small-sample warning on top;
- a play never contradicts itself: an Over's projection sits above the line,
  an Under's below, and its rating matches its edge;
- each market's lean across the whole week comes off before plays are picked
  (Week 7 2026: the projection engine had receptions above the books on 47 of
  58 players, which is the engine, not 47 edges);
- the filters and the sort work."""
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


class BestPlays(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("best-plays.html")
        cls.page.evaluate("() => localStorage.removeItem('nfl-tool.best-plays-view.v1')")
        cls.page.reload()
        cls.page.wait_for_selector("#bp-app:not([hidden])", timeout=20000)

    @classmethod
    def tearDownClass(cls):
        cls.page.close()

    def test_draws_plays_under_the_small_sample_warning(self):
        self.assertIn("Small sample", self.page.inner_text("#bp-warning"))
        self.assertGreater(self.page.evaluate("() => bpRows.length"), 0)
        self.assertGreater(self.page.locator(".bp-table tbody tr").count(), 0)
        self.assertEqual(SITE.errors, [])

    def test_every_play_agrees_with_itself(self):
        bad = self.page.evaluate("""() => bpRows.flatMap((r) => {
          const out = [];
          const e = BP_EDGES[r.kind];
          if (r.edge < e.lean) out.push(`${r.name} ${r.bet}: edge under the bar`);
          if (r.rating === 'Strong' && !(r.edge >= e.strong)) out.push(`${r.name}: Strong below its bar`);
          if (r.rating === 'Lean' && r.edge >= e.strong) out.push(`${r.name}: Lean above Strong's bar`);
          if (r.kind === 'prop') {
            const line = Number(r.bet.split(' ')[1]);
            const proj = parseFloat(r.gmg);
            if (r.bet.startsWith('Over') && !(proj >= line - 0.05)) out.push(`${r.name} ${r.bet}: projection ${r.gmg}`);
            if (r.bet.startsWith('Under') && !(proj <= line + 0.05)) out.push(`${r.name} ${r.bet}: projection ${r.gmg}`);          }
          return out;
        })""")
        self.assertEqual(bad, [])

    def test_a_market_wide_lean_comes_off(self):
        # Ten lines the engine puts 20 points over the books: that is the
        # engine leaning, so none of them should be left far over the market.
        out = self.page.evaluate("""() => {
          const lines = Array.from({ length: 10 }, (_, i) => ({ r: { marketKey: 'receiving_receptions', pOver: 0.7, mktOver: 0.5, line: 4.5, proj: 5.5, over: -110, under: -110 } }));
          lines[0].r.pOver = 0.85;
          bpCalibrate(lines);
          return lines.map(({ r }) => [r.pOver, r.side]);
        }""")
        self.assertTrue(all(abs(p - 0.5) < 0.03 for p, _ in out[1:]), out)
        self.assertGreater(out[0][0], out[1][0])  # the one rated above the rest stays above
        self.assertEqual(out[0][1], "over")

    def test_filters_and_sort(self):
        page = self.page
        groups = page.evaluate("() => [...new Set(bpRows.map((r) => r.group))]")
        first = groups[0]
        label = dict(page.evaluate("() => BP_GROUPS"))[first]
        shown = lambda: page.evaluate("() => document.querySelectorAll('.bp-table tbody tr').length")  # noqa: E731
        before = shown()
        page.click(f'.bp-group[data-group="{first}"]')
        hidden = page.evaluate(f"() => bpRows.filter((r) => r.group === '{first}').length")
        after = page.evaluate("() => document.querySelectorAll('.bp-table tbody tr').length")
        self.assertEqual(after, before - hidden, label)
        page.click(f'.bp-group[data-group="{first}"]')
        self.assertEqual(shown(), before)
        page.click('.bp-sort[data-sort="chance"]')
        chances = page.evaluate("() => [...document.querySelectorAll('.bp-table tbody tr td:nth-child(5)')].map((td) => parseFloat(td.textContent))")
        self.assertEqual(chances, sorted(chances, reverse=True))
        page.click('.bp-sort[data-sort="edge"]')
        # The Rating menu (the owner, 2026-10-23): only that rating's plays.
        for rating in ("Strong", "Lean", "Check"):
            page.select_option("#bp-rating", rating)
            ratings = page.evaluate("() => [...document.querySelectorAll('.bp-table tbody tr .bp-rating')].map((s) => s.textContent)")
            self.assertEqual(set(ratings) - {rating}, set(), rating)
            self.assertEqual(len(ratings), page.evaluate(f"() => bpRows.filter((r) => r.rating === '{rating}').length"), rating)
        page.select_option("#bp-rating", "")
        self.assertEqual(shown(), before)

    def test_ytd_model_performance(self):
        """The graded record (2026-10-22): the shared tracker, a tile per market
        plus All Plays, Overs / Unders on the props, and the list under it kept
        to the tracker's window and sliders."""
        import json

        record = {"season": 2026, "ledger": {
            "rec": [["2026-10-08", 0.081, 1, 1.2, ["rec", "under", "strong"]], ["2026-10-08", 0.045, 0, -1.0, ["rec", "over", "lean"]]],
            "rush": [], "pass": [],
            "any": [["2026-10-08", 0.05, 0, -1.0, ["any", "yes", "strong"]]], "first": []},
            "plays": [
                {"date": "2026-10-08", "team": "TB", "opp": "DAL", "name": "Emeka Egbuka", "position": "WR", "group": "rec", "bet": "Under 45.5 Rec Yds", "side": "under", "price": 120, "book": "fanduel", "edge": 0.081, "rating": "Strong", "won": 1},
                {"date": "2026-10-08", "team": "TB", "opp": "DAL", "name": "Cade Otton", "position": "TE", "group": "rec", "bet": "Over 30.5 Rec Yds", "side": "over", "price": -110, "book": "draftkings", "edge": 0.045, "rating": "Lean", "won": 0},
                {"date": "2026-10-08", "team": "TB", "opp": "DAL", "name": "Bucky Irving", "position": "RB", "group": "any", "bet": "Anytime TD", "side": "yes", "price": 150, "book": "fanduel", "edge": 0.05, "rating": "Strong", "won": 0},
            ]}
        page = SITE.open("best-plays.html")
        page.route("**/best_plays_record.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(record)))
        page.evaluate("() => localStorage.removeItem('nfl-tool.ytd.nfl-best-plays.v1')")
        page.reload()
        page.wait_for_selector("#bp-ytd:not([hidden])", timeout=20000)
        page.click("#bp-ytd")
        modal = "#bp-ytd-modal:not([hidden])"
        page.wait_for_selector(modal, timeout=5000)
        self.assertIn("Small Sample", page.inner_text(modal))
        labels = page.eval_on_selector_all(f"{modal} .ytd-label", "els => els.map((e) => e.textContent)")
        self.assertEqual(labels, ["All Plays", "Receiving", "Overs", "Unders", "Rushing", "Overs", "Unders", "Passing", "Overs", "Unders", "Anytime TD", "First TD"])
        body = lambda key: page.inner_text(f'{modal} [data-ytd-body="{key}"] b')  # noqa: E731
        self.assertEqual((body("__all"), body("rec"), body("rec:under"), body("any")), ("1-2", "1-1", "1-0", "0-1"))
        self.assertEqual(page.locator(f"{modal} .bp-ytd-table tbody tr").count(), 3)
        # Receiving's slider past the Lean play: the tile and the list both drop it.
        page.eval_on_selector(f'{modal} [data-ytd-min="rec"]', "el => { el.value = 6; el.dispatchEvent(new Event('input', { bubbles: true })); }")
        self.assertEqual(body("rec"), "1-0")
        self.assertEqual(page.locator(f"{modal} .bp-ytd-table tbody tr").count(), 2)
        self.assertEqual(SITE.errors, [])
        page.close()

    def test_no_record_no_button(self):
        page = SITE.open("best-plays.html")
        page.route("**/best_plays_record.json", lambda r: r.fulfill(status=404, body=""))
        page.reload()
        page.wait_for_selector("#bp-app:not([hidden])", timeout=20000)
        self.assertTrue(page.locator("#bp-ytd").is_hidden())
        page.close()

    def test_a_name_opens_the_player_card(self):
        # Best Plays loads props-summary.js and app.js for their math, and both
        # read the Player Props / TD Data game picker this page doesn't have:
        # the card threw before it opened (the owner, 2026-10-21).
        page = self.page
        name = page.inner_text(".bp-player .player-click")
        page.click(".bp-player .player-click")
        page.wait_for_selector("#player-card-modal:not([hidden])", timeout=5000)
        self.assertIn(name.upper(), page.inner_text("#player-card-modal").upper())
        self.assertEqual(page.locator("#player-card-modal .ps-add-btn").count(), 0)
        self.assertEqual(SITE.errors, [])
        page.click("#player-card-modal .modal-close")


if __name__ == "__main__":
    unittest.main()
