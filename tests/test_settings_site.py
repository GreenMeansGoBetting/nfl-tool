"""The Settings gear (site/sync.js), run in a real browser on the saved NHL data.

What is pinned (the owner, 2026-10-15): one gear beside the account chip on
every page opens Settings with the odds format, the color set and My Books; a
member can read every price as American (the default), decimal or percent,
and saved plays keep American; the standard colors draw exactly as before and
another set repaints the red-to-green shades; no "New Jersey" anywhere (bet
links open fine in every state, and the note confused members)."""
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = PAGE = None
KEY = "nfl-tool.settings.v1"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/best.html")
        PAGE.wait_for_function("() => typeof GOALS !== 'undefined' && GOALS !== null && !document.getElementById('best-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def with_settings(value, script):
    """Run `script` (a JS expression) with these settings, then put them back."""
    return PAGE.evaluate(
        """([key, value, script]) => {
            const before = localStorage.getItem(key);
            localStorage.setItem(key, JSON.stringify(value));
            gmgSettingsCache = null;
            try { return eval(script); } finally {
                before === null ? localStorage.removeItem(key) : localStorage.setItem(key, before);
                gmgSettingsCache = null;
            }
        }""",
        [KEY, value, script],
    )


class OddsFormat(unittest.TestCase):
    PRICES = "[-110, 150, '+150', '-250', 100, null, 'EVEN'].map(showOdds)"

    def test_american_is_the_default(self):
        self.assertEqual(with_settings({}, self.PRICES), ["-110", "+150", "+150", "-250", "+100", "", "EVEN"])

    def test_decimal(self):
        self.assertEqual(with_settings({"odds": "decimal"}, self.PRICES), ["1.91", "2.50", "2.50", "1.40", "2.00", "", "EVEN"])

    def test_percent_is_the_chance_the_price_implies(self):
        self.assertEqual(with_settings({"odds": "percent"}, self.PRICES), ["52.4%", "40.0%", "40.0%", "71.4%", "50.0%", "", "EVEN"])

    def test_the_page_draws_prices_in_the_members_format(self):
        # The sample's game day (test_nhl_best_site.py's TONIGHT).
        script = "(dayIndex = days().indexOf('2026-10-13'), render(), [...document.querySelectorAll('.best-odds')].map((e) => e.textContent.trim()))"
        american = with_settings({}, script)
        decimal = with_settings({"odds": "decimal"}, script)
        PAGE.evaluate("render()")
        self.assertTrue(american)
        self.assertTrue(all(o.startswith(("+", "-")) for o in american), american[:5])
        self.assertTrue(all(o.replace(".", "", 1).isdigit() and "." in o for o in decimal), decimal[:5])


class Colors(unittest.TestCase):
    def test_standard_colors_draw_exactly_as_before(self):
        self.assertEqual(with_settings({}, "[scaleHsla(120, 70, 45, 0.22), scaleHsla(0, 78, 48)]"), ["hsla(120,70%,45%,0.22)", "hsl(0,78%,48%)"])
        self.assertEqual(with_settings({}, "document.getElementById('gmg-color-set')"), None)

    def test_another_set_repaints_both_ends_of_the_scale(self):
        good, mid, bad = with_settings({"colors": "blueorange"}, "[scaleHsla(135, 70, 45, 0.5), scaleHsla(60, 70, 45, 0.5), scaleHsla(0, 70, 45, 0.5)]")
        self.assertEqual(good, "rgba(59,130,246,0.5)")  # blue
        self.assertEqual(mid, "rgba(234,179,8,0.5)")  # the site's yellow stays the middle
        self.assertEqual(bad, "rgba(226,83,29,0.5)")  # orange

    def test_a_set_repaints_the_tier_tokens_in_both_themes(self):
        css = with_settings({"colors": "custom", "custom": {"good": "#0000ff", "mid": "#eab308", "bad": "#ff00ff"}}, "(applyGmgColors(), document.getElementById('gmg-color-set').textContent)")
        PAGE.evaluate("applyGmgColors()")
        self.assertIn("--good-rgb:0, 0, 255", css)
        self.assertIn("--bad-rgb:255, 0, 255", css)
        self.assertIn('html:root[data-theme="light"]', css)


class SettingsWindow(unittest.TestCase):
    def test_gear_opens_odds_colors_and_my_books(self):
        text = PAGE.evaluate("""() => {
            document.getElementById('settings-btn').click();
            const box = document.getElementById('settings-modal');
            const text = box.textContent;
            box.querySelector('.modal-close').click();
            return text;
        }""")
        for part in ("Odds format", "American", "Decimal", "Percent", "Colors", "Blue / Orange", "My Books", "DraftKings"):
            self.assertIn(part, text)
        self.assertNotIn("New Jersey", text)

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
