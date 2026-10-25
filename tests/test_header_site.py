"""The top menu (site/sync.js addTopMenu), run in a real browser.

What is pinned (the owner, 2026-10-17: the header was too wide on a small laptop):
four buttons in the middle, NFL, NBA, NHL and Promo Tools, each a list of its
pages; everything personal (feature requests, What's new, Settings, Support,
Log out) in the account button's menu; "Odds powered by SmartStake" stays by
the logo; no Update Odds button; the menu stays centered and one list is open
at a time."""
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None
LINKS = "() => [...document.querySelectorAll('%s a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('promo-current')])"


def setUpModule():
    global SITE
    SITE = SiteBrowser()
    SITE.user = {"name": "Pat Lee", "owner": False}


def tearDownModule():
    if SITE:
        SITE.close()


class TopMenu(unittest.TestCase):
    def test_four_buttons_centered_with_the_credit_and_no_update_odds(self):
        page = SITE.open("game-overview.html")
        try:
            page.wait_for_selector(".acct-chip")
            self.assertEqual(page.evaluate(r"() => [...document.querySelectorAll('.page-nav > a')].map((a) => a.textContent.replace(/\W/g, '').trim())"), ["NFL", "NBA", "NHL", "PromoTools", "MyPlays"])
            mid = page.evaluate("() => { const r = document.querySelector('.page-nav').getBoundingClientRect(); return [r.left + r.width / 2, innerWidth / 2]; }")
            self.assertAlmostEqual(mid[0], mid[1], delta=1)
            self.assertEqual(page.evaluate("() => !!document.querySelector('.odds-credit')"), True)
            self.assertEqual(page.evaluate("() => document.querySelectorAll('.update-odds-link').length"), 0)
            self.assertEqual(page.inner_text(".brand-name").upper(), "SPORTS DATA SUITE")
        finally:
            page.close()

    def test_each_sport_lists_its_pages_and_marks_the_one_you_are_on(self):
        page = SITE.open("game-overview.html")
        try:
            page.click(".page-nav .nfl-trigger")
            self.assertEqual(page.evaluate(LINKS % ".nfl-menu"), [["Game Previews", "/game-overview.html", True], ["TD Data", "/index.html", False], ["Best Plays", "/best-plays.html", False], ["Receiving", "/player-props.html#receiving", False], ["Rushing", "/player-props.html#rushing", False], ["Passing", "/player-props.html#passing", False]])
            self.assertIn("player props", page.inner_text(".nfl-menu").lower())
            self.assertTrue(page.evaluate("() => document.querySelector('.nfl-trigger').classList.contains('page-nav-current')"))
            page.click(".page-nav .nba-trigger")
            self.assertTrue(page.locator(".nfl-menu").is_hidden())  # one list at a time
            self.assertEqual(page.evaluate(LINKS % ".nba-menu"), [["Game Previews", "/nba/", False], ["Team Identity", "/nba/identity.html", False], ["Shot Charts", "/nba/shot-charts.html", False], ["Best Plays", "/nba/best.html", False], ["Points", "/nba/points.html", False], ["Threes", "/nba/threes.html", False], ["First Basket", "/nba/first-basket.html", False]])
            page.click(".page-nav .nhl-trigger")
            self.assertEqual([x[0] for x in page.evaluate(LINKS % ".nhl-menu")], ["Game Previews", "Line Matchups", "Best Plays", "Shots", "Goals", "Points", "Saves"])
            self.assertIn("player props", page.inner_text(".nhl-menu").lower())
            page.keyboard.press("Escape")
            self.assertTrue(page.locator(".nhl-menu").is_hidden())
        finally:
            page.close()

    def test_nfl_prop_types_open_their_own_tab_and_mark_it(self):
        # The owner, 2026-10-20: Receiving / Rushing / Passing as their own rows, like NBA and NHL.
        page = SITE.open("player-props.html#rushing")
        try:
            page.wait_for_selector('.props-view-toggle-btn.active[data-view="rushing"]')
            self.assertFalse(page.locator("#section-rushing").is_hidden())
            self.assertEqual([x[0] for x in page.evaluate(LINKS % ".nfl-menu") if x[2]], ["Rushing"])
            page.click(".page-nav .nfl-trigger")
            page.click('.nfl-menu a[data-view="passing"]')  # same page: only the #view changes
            page.wait_for_selector('.props-view-toggle-btn.active[data-view="passing"]')
            self.assertEqual([x[0] for x in page.evaluate(LINKS % ".nfl-menu") if x[2]], ["Passing"])
            page.click('.props-view-toggle-btn[data-view="receiving"]')  # the tab buttons keep the address in step
            self.assertEqual(page.evaluate("() => location.hash"), "#receiving")
            self.assertEqual([x[0] for x in page.evaluate(LINKS % ".nfl-menu") if x[2]], ["Receiving"])
        finally:
            page.close()

    def test_promo_tools_page_highlights_promo_tools_not_a_sport(self):
        page = SITE.open("promo-tools.html")
        try:
            self.assertEqual(page.evaluate("() => [...document.querySelectorAll('.page-nav .page-nav-current')].map((a) => a.dataset.sport)"), ["promo"])
        finally:
            page.close()

    def test_account_menu_holds_everything_personal(self):
        page = SITE.open("game-overview.html")
        try:
            page.wait_for_selector(".acct-chip")
            self.assertEqual(page.inner_text(".acct-avatar"), "PL")
            self.assertTrue(page.locator(".acct-menu").is_hidden())
            page.click(".acct-chip")
            text = page.inner_text(".acct-menu")
            for word in ("Pat Lee", "Request a feature", "What's new", "Settings", "Support", "Log out"):
                self.assertIn(word, text)
            self.assertNotIn("Manage membership", text)  # a Discord member
            # What's new opens its popup and closes the menu.
            page.click(".acct-menu [data-act=updates]")
            self.assertTrue(page.locator(".acct-menu").is_hidden())
            self.assertFalse(page.evaluate("() => document.getElementById('updates-modal').hidden"))
            page.keyboard.press("Escape")
            # A fresh browser has seen no update, so the newest one with a
            # "Before you go" note (GMG_UPDATES `after`) adds it: close it too.
            if page.evaluate("() => GMG_UPDATES.some((u) => u.after !== undefined)"):
                self.assertFalse(page.evaluate("() => document.getElementById('after-note-modal').hidden"))
                page.keyboard.press("Escape")
            page.click(".acct-chip")
            page.click(".acct-menu [data-act=request]")
            self.assertTrue(page.evaluate("() => !document.getElementById('feature-request-modal').hidden"))
            page.keyboard.press("Escape")
        finally:
            page.close()

    def test_the_menu_fits_a_small_laptop_and_a_phone(self):
        for width in (1100, 390):
            page = SITE.open("game-overview.html")
            try:
                page.set_viewport_size({"width": width, "height": 800})
                page.wait_for_selector(".acct-chip")
                self.assertEqual(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), True, width)
                page.click(".acct-chip")
                box = page.evaluate("() => { const r = document.querySelector('.acct-menu').getBoundingClientRect(); return [r.left, r.right, innerWidth]; }")
                self.assertGreaterEqual(box[0], 0)
                self.assertLessEqual(box[1], box[2])
            finally:
                page.close()

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
