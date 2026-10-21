"""The NHL Line Matchups page (site/nhl/lines.js), run in a real browser on the
saved NHL data and the Line Matchups sample (built at test time from the saved
FLA @ BUF game with its shift chart: helpers.nhl_lines).

What is pinned: a game shows both teams' forward lines and defense pairs with
their numbers together, as the build sent them (the page does no counting);
a team with no games yet says so; the tags (Strong / Weak only past the
minutes the build's rules ask for, Small Sample and New Together otherwise;
Hot / Cold from the last three games); Likely Matchups from the home coach's
habit, with mixed groups said; the note for a started game; names open the
player card; never the word "confirmed"; the Line Matchups link in the menu
and no Line Stacks anywhere."""
import unittest
from pathlib import Path

from helpers import nhl_lines  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
DAY = "2026-10-13"
FLA_CBJ = "2026020091"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/lines.html")
        PAGE.wait_for_function("() => typeof LINES !== 'undefined' && LINES !== null && !document.getElementById('lines-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def show(game=FLA_CBJ, day=DAY):
    PAGE.evaluate(
        """([day, game]) => {
            closePlayerCard();
            LINES = JSON.parse(JSON.stringify(window.__lines || (window.__lines = LINES)));
            dayIndex = days().indexOf(day);
            gameId = game;
            render();
        }""",
        [day, game],
    )


TILES = """(side) => [...document.querySelectorAll('.ln-side')[side].querySelectorAll('.ln-tile')].map((t) => ({
    slot: t.dataset.slot,
    names: [...t.querySelectorAll('.ln-name')].map((n) => n.textContent.trim()),
    stats: [...t.querySelectorAll('.ln-stat b')].map((b) => b.textContent.trim()),
    tag: (t.querySelector('.ln-tag') || {}).textContent || '',
}))"""


class Game(unittest.TestCase):
    def test_both_teams_lines_as_sent(self):
        show()
        board = nhl_lines()["games"][FLA_CBJ]
        fla = PAGE.evaluate(TILES, 0)
        self.assertEqual([t["slot"] for t in fla], ["F1", "F2", "F3", "F4", "D1", "D2", "D3"])
        units = board["teams"]["FLA"]["lines"] + board["teams"]["FLA"]["pairs"]
        for tile, u in zip(fla, units):
            self.assertEqual(tile["names"], [board["players"][p][0] for p in u["ids"]])
            share = round(100 * u["cf"] / (u["cf"] + u["ca"]))
            self.assertEqual(tile["stats"][:3], [str(round(u["toi"] / 60)), f"{share}%", f"{u['gf']}-{u['ga']}"])
            self.assertEqual(tile["tag"], "Small Sample")  # one game: under 20 minutes together
        banners = PAGE.locator(".ln-side .team-banner").all_inner_texts()
        self.assertIn("Usual Lines", banners[0])
        # Columbus has no game with a shift chart in the sample.
        self.assertEqual(PAGE.evaluate(TILES, 1), [])
        self.assertIn("No lines yet", PAGE.locator(".ln-side").nth(1).inner_text())
        self.assertIn("No CBJ Home Games Yet", PAGE.locator(".ln-mid").inner_text())
        self.assertIn("First Meeting This Season", PAGE.locator(".ln-mid").inner_text())
        self.assertIn("Usual lines over each team's last five games", PAGE.locator("#lines-source").inner_text())

    def test_the_tags(self):
        show()
        got = PAGE.evaluate("""() => {
            const u = (toi, cf, ca, gp = 4, l3 = null) => ({ gp, toi, cf, ca, gf: 0, ga: 0, l3 });
            const tag = (x) => (strengthTag(x).match(/>([^<]+)</) || [0, ''])[1];
            return {
                strong: tag(u(1500, 60, 40)), weak: tag(u(1500, 40, 60)), even: tag(u(1500, 50, 50)),
                small: tag(u(1100, 90, 10)), fresh: tag(u(0, 0, 0, 0)),
                hot: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 900, cf: 30, ca: 20, gf: 0, ga: 0 })),
                hotGoals: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 900, cf: 25, ca: 25, gf: 2, ga: 0 })),
                cold: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 900, cf: 20, ca: 30, gf: 0, ga: 0 })),
                steady: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 900, cf: 25, ca: 25, gf: 1, ga: 1 })),
                split: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 900, cf: 30, ca: 20, gf: 0, ga: 2 })),
                tooFew: formWord(u(1500, 50, 50, 4, { gp: 3, toi: 500, cf: 30, ca: 10, gf: 3, ga: 0 })),
            };
        }""")
        self.assertEqual(got, {"strong": "Strong", "weak": "Weak", "even": "", "small": "Small Sample", "fresh": "New Together",
                               "hot": "hot", "hotGoals": "hot", "cold": "cold", "steady": "steady", "split": "steady", "tooFew": None})

    def test_likely_matchups(self):
        show()
        PAGE.evaluate("""(game) => {
            LINES.games[game].matchups = { games: 3, rows: [{ their: 1, ours: 2, share: 0.4, mixed: 0.3, secs: 900 }] };
            LINES.games[game].teams.CBJ.lines = LINES.games[game].teams.FLA.lines.map((u) => ({ ...u }));
            render();
        }""", FLA_CBJ)
        mid = PAGE.locator(".ln-mid").inner_text()
        self.assertIn("CBJ Has Last Change", mid)
        self.assertIn("From 3 CBJ Home Games", mid)
        mu = PAGE.locator(".ln-mu").first.inner_text()
        self.assertIn("FLA Line 1", mu)
        self.assertIn("CBJ Line 2", mu)
        self.assertIn("40% of the time", mu)
        self.assertIn("Mixed 30%", mu)

    def test_a_started_game(self):
        show()
        PAGE.evaluate("(game) => { LINES.games[game].locked = true; render(); }", FLA_CBJ)
        self.assertIn("has started", PAGE.locator("#lines-source").inner_text())

    def test_a_name_opens_the_player_card(self):
        show()
        PAGE.locator(".ln-side .ln-name .player-click").first.click()
        self.assertTrue(PAGE.locator("#player-card-modal").is_visible())
        PAGE.evaluate("closePlayerCard()")


class Words(unittest.TestCase):
    def test_no_confirmed_and_no_stacks(self):
        site = Path(__file__).resolve().parents[1] / "nfl_tool" / "site"
        self.assertNotIn("confirmed", (site / "nhl" / "lines.js").read_text(encoding="utf-8").lower())
        self.assertFalse((site / "nhl" / "stacks.html").exists())
        for page in ("sync.js", "nhl/nhl-common.js", "nhl/points.js"):
            self.assertNotIn("stacks.html", (site / page).read_text(encoding="utf-8"), page)

    def test_the_menu(self):
        PAGE.click(".page-nav .nhl-trigger")
        items = PAGE.evaluate("() => [...document.querySelectorAll('.nhl-menu a')].map((a) => [a.textContent, a.classList.contains('promo-current')])")
        self.assertEqual(items[:2], [["Game Previews", False], ["Line Matchups", True]])
        PAGE.keyboard.press("Escape")


if __name__ == "__main__":
    unittest.main()
