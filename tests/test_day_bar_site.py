"""The day bar over the NBA / NHL pages' games and the game-day label (sync.js
gmgDayBar / gmgDayLabel, 2026-11-23): one copy, where the same lines had been
pasted into 14 pages and the label's date format into 24 places.

What is pinned: the bar's label and buttons for the first, a middle and the
last day, and with no days; and no page pastes its own copy again."""
import re
import unittest
from pathlib import Path

import helpers  # noqa: F401 -- first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE_DIR = Path(__file__).resolve().parent.parent / "nfl_tool" / "site"
SITE = PAGE = None


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/index.html")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def bar(days, index, opts=None):
    return PAGE.evaluate(
        """([days, index, opts]) => {
            const date = gmgDayBar(days, index, opts || undefined);
            const $ = (id) => document.getElementById(id);
            return [date ?? null, $("day-label").textContent, $("day-prev").disabled, $("day-next").disabled, $("schedule-scroller").hidden];
        }""",
        [days, index, opts],
    )


class DayBar(unittest.TestCase):
    DAYS = ["2026-11-21", "2026-11-22", "2026-11-23"]

    def test_label_and_buttons(self):
        label = PAGE.evaluate("() => gmgDayLabel('2026-11-23')")
        self.assertIn("23", label)
        self.assertIn("Nov", label)
        self.assertEqual(PAGE.evaluate("() => gmgDayLabel('')"), "")
        self.assertEqual(bar(self.DAYS, 0), ["2026-11-21", PAGE.evaluate("() => gmgDayLabel('2026-11-21')"), True, False, False])
        self.assertEqual(bar(self.DAYS, 1)[2:4], [False, False])
        self.assertEqual(bar(self.DAYS, 2)[2:4], [False, True])

    def test_no_days(self):
        self.assertEqual(bar([], 0), [None, "", True, True, True])
        # A page that keeps the bar showing and says so (Prop Research).
        PAGE.evaluate("() => { document.getElementById('schedule-scroller').hidden = false; }")
        self.assertEqual(bar([], 0, {"empty": "No games", "scroller": False}), [None, "No games", True, True, False])

    def test_no_page_pastes_its_own_copy(self):
        pasted = []
        for path in SITE_DIR.rglob("*.js"):
            if path.name == "sync.js":
                continue
            text = path.read_text(encoding="utf-8")
            if 'el("day-prev").disabled' in text or re.search(r'toLocaleDateString\(undefined, \{ weekday: "short", month: "short", day: "numeric" \}\)', text):
                pasted.append(path.relative_to(SITE_DIR).as_posix())
        self.assertEqual(pasted, [], "use gmgDayBar / gmgDayLabel (sync.js)")


if __name__ == "__main__":
    unittest.main()
