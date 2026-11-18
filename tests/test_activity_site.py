"""Member Activity, the page (nfl_tool/site/activity.html + activity.js, 2026-11-18): the owner's DAU
and MAU. Pinned: the summary numbers, today left out of the averages and colors (the day isn't
over), the closed message for anyone else, and the account-menu link only the owner sees."""
import json
import unittest

from site_browser import SiteBrowser


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    SITE.close()


DATA = {
    "today": "2026-11-18", "first": "2026-10-01", "window": 30,
    "days": [
        {"day": "2026-11-18", "dau": 4, "mau": 30},
        {"day": "2026-11-17", "dau": 20, "mau": 28},
        {"day": "2026-11-16", "dau": 10, "mau": 25},
    ],
}
FILLING = {**DATA, "first": "2026-11-16"}  # counting began three days ago


def open_page(status=200, body=None):
    page = SITE.context.new_page()
    page.on("pageerror", lambda err: SITE.errors.append(str(err)))
    page.route("**/api/activity", lambda r: r.fulfill(status=status, content_type="application/json", body=json.dumps(DATA if body is None else body)))
    page.goto(f"{SITE.origin}/activity.html")
    page.wait_for_function("() => !document.querySelector('#act-body').textContent.includes('Loading')")
    return page


class Page(unittest.TestCase):
    def setUp(self):
        SITE.errors.clear()
        SITE.user = None

    def tearDown(self):
        self.assertEqual(SITE.errors, [])

    def test_the_summary_leaves_today_out_of_the_averages(self):
        page = open_page()
        tiles = page.locator(".act-grid").first.locator(".act-tile b").all_inner_texts()
        # Today 4, Yesterday 20, average of the finished days 15, MAU 30, 15 / yesterday's MAU 28
        self.assertEqual(tiles, ["4", "20", "15.0", "30", "54%"])
        page.close()

    def test_today_is_never_colored_but_finished_days_are(self):
        page = open_page()
        rows = page.locator(".act-grid").nth(1).locator("tbody tr")
        self.assertEqual(rows.count(), 3)
        self.assertEqual(rows.nth(0).locator(".act-day").inner_text(), "Today")
        self.assertEqual(rows.nth(0).locator(".act-tile[style]").count(), 0)
        self.assertEqual(rows.nth(1).locator(".act-tile[style]").count(), 3)
        page.close()

    def test_while_mau_fills_up_it_says_so_and_shows_no_ratio(self):
        page = open_page(body=FILLING)
        self.assertIn("MAU covers 3 of 30 days", page.inner_text(".act-note"))
        self.assertEqual(page.locator(".act-grid").first.locator(".act-tile b").all_inner_texts(), ["4", "20", "15.0", "30", "--"])
        finished = page.locator(".act-grid").nth(1).locator("tbody tr").nth(1)
        self.assertEqual(finished.locator(".act-tile b").all_inner_texts(), ["20", "28", "--"])
        self.assertEqual(finished.locator(".act-tile[style]").count(), 1)  # DAU only
        page.close()

    def test_no_visits_yet(self):
        page = open_page(body={"today": "2026-11-18", "first": None, "window": 30, "days": []})
        self.assertIn("No visits counted yet", page.inner_text("#act-body"))
        self.assertEqual(page.locator(".act-grid").count(), 0)
        page.close()

    def test_anyone_else_sees_no_numbers(self):
        page = open_page(status=403, body={"error": "owner only"})
        self.assertIn("This page isn't open", page.inner_text("#act-body"))
        self.assertEqual(page.locator(".act-grid").count(), 0)
        page.close()

    def test_only_the_owner_gets_the_menu_link(self):
        for owner in (True, False):
            SITE.user = {"name": "Pat Lee", "owner": owner}
            page = open_page()
            page.wait_for_selector("#acct-chip")
            self.assertEqual(page.locator('.acct-menu a[href$="activity.html"]').count(), 1 if owner else 0)
            page.close()


if __name__ == "__main__":
    unittest.main()
