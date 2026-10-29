"""The Time Zone setting (site/sync.js), run in a real browser on the saved NHL data.

What is pinned (the owner, 2026-10-29: "a setting ... that allows users to
adjust their time zones or have it auto adjust based on where they are
located"): the Settings gear has a Time Zone menu, "Auto (Detect My
Location)" by default (the browser's own zone) or a US zone picked by hand;
the pick is saved in the synced settings; every game time is drawn in that
zone with its letters (ET / CT / PT...), across the November clock change;
and the NBA build's Eastern times follow the real clock (a fixed UTC-4 read
an hour late all winter)."""
import sys
import unittest
from datetime import datetime
from pathlib import Path

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402

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


class GameTimes(unittest.TestCase):
    # Eastern wall-clock times, before and after the clock change (Nov 1, 2026).
    TIMES = "[gmgGameTime({date: '2026-10-13', time: '19:00'}), gmgGameTime({date: '2026-11-08', time: '13:00'}), gmgGameTime({date: '2026-11-08', time: '20:20'}, false)]"

    def test_eastern(self):
        self.assertEqual(with_settings({"tz": "America/New_York"}, self.TIMES), ["7:00 PM ET", "1:00 PM ET", "8:20 PM"])

    def test_central_and_pacific(self):
        self.assertEqual(with_settings({"tz": "America/Chicago"}, self.TIMES), ["6:00 PM CT", "12:00 PM CT", "7:20 PM"])
        self.assertEqual(with_settings({"tz": "America/Los_Angeles"}, self.TIMES), ["4:00 PM PT", "10:00 AM PT", "5:20 PM"])

    def test_arizona_and_hawaii_skip_daylight_time(self):
        # Arizona reads like Pacific in October and like Mountain after the change.
        self.assertEqual(with_settings({"tz": "America/Phoenix"}, self.TIMES), ["4:00 PM MST", "11:00 AM MST", "6:20 PM"])
        self.assertEqual(with_settings({"tz": "Pacific/Honolulu"}, self.TIMES), ["1:00 PM HST", "8:00 AM HST", "3:20 PM"])

    def test_true_utc_start_wins(self):
        # NBA / NHL games carry start_utc; it is used over the Eastern text.
        script = "gmgGameTime({date: '2026-11-08', time: '20:00', start_utc: '2026-11-09T00:30Z'})"
        self.assertEqual(with_settings({"tz": "America/Chicago"}, script), "6:30 PM CT")

    def test_auto_is_the_browsers_own_zone(self):
        own = PAGE.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
        self.assertEqual(with_settings({}, "gmgTimeZone()"), own)
        self.assertEqual(with_settings({"tz": "auto"}, "gmgTimeZone()"), own)
        self.assertEqual(with_settings({"tz": "Mars/Base"}, "gmgTimeZone()"), own)  # an unknown pick falls back

    def test_the_page_draws_game_times_in_the_members_zone(self):
        script = "(dayIndex = days().indexOf('2026-10-13'), render(), [...document.querySelectorAll('.matchup-date')].map((e) => e.textContent.trim()))"
        eastern = with_settings({"tz": "America/New_York"}, script)
        pacific = with_settings({"tz": "America/Los_Angeles"}, script)
        PAGE.evaluate("render()")
        self.assertTrue(eastern)
        self.assertEqual(eastern[0], "6:00 PM")
        self.assertEqual(pacific[0], "3:00 PM")
        self.assertEqual(len(eastern), len(pacific))


class SettingsWindow(unittest.TestCase):
    def test_time_zone_menu_saves_and_syncs(self):
        got = PAGE.evaluate("""() => {
            const before = localStorage.getItem('nfl-tool.settings.v1');
            const pushed = [];
            const sync = window.NFLSync;
            window.NFLSync = { ...(sync || {}), push: (k, v) => pushed.push([k, v]) };
            try {
                document.getElementById('settings-btn').click();
                const box = document.getElementById('settings-modal');
                const menu = box.querySelector('[data-time-zone]');
                const options = [...menu.options].map((o) => o.textContent);
                const first = menu.value;
                menu.value = 'America/Chicago';
                menu.dispatchEvent(new Event('change', { bubbles: true }));
                const saved = gmgSettings().tz;
                const shown = box.querySelector('[data-time-zone]').value;
                const text = box.textContent;
                box.hidden = true; // closed without the reload
                return { options, first, saved, shown, text, pushed };
            } finally {
                window.NFLSync = sync;
                before === null ? localStorage.removeItem('nfl-tool.settings.v1') : localStorage.setItem('nfl-tool.settings.v1', before);
                gmgSettingsCache = null;
            }
        }""")
        self.assertEqual(got["first"], "auto")
        self.assertEqual(got["options"][0], "Auto (Detect My Location)")
        for name in ("Eastern (ET)", "Central (CT)", "Mountain (MT)", "Arizona (MST)", "Pacific (PT)", "Alaska (AKT)", "Hawaii (HST)"):
            self.assertIn(name, got["options"])
        self.assertIn("Time Zone", got["text"])
        self.assertEqual(got["saved"], "America/Chicago")
        self.assertEqual(got["shown"], "America/Chicago")
        self.assertEqual(got["pushed"][-1][0], KEY)
        self.assertEqual(got["pushed"][-1][1]["tz"], "America/Chicago")

    def test_settings_key_is_synced_both_sides(self):
        middleware = (ROOT / "nfl_tool" / "functions" / "_middleware.js").read_text(encoding="utf-8")
        sync = (ROOT / "nfl_tool" / "site" / "sync.js").read_text(encoding="utf-8")
        self.assertIn(f'"{KEY}"', middleware[middleware.index("SYNC_KEYS"):][:3000])
        self.assertIn("GMG_SETTINGS_KEY,", sync[sync.index("const KEYS = ["):][:2000])

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


class NbaBuildEastern(unittest.TestCase):
    def test_eastern_follows_the_clock_change(self):
        self.assertEqual(build_nba.eastern("2026-10-30T23:30Z"), datetime(2026, 10, 30, 19, 30))  # EDT
        self.assertEqual(build_nba.eastern("2026-11-05T00:30Z"), datetime(2026, 11, 4, 19, 30))  # EST, not 8:30


if __name__ == "__main__":
    unittest.main()
