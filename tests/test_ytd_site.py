"""Every YTD Model Performance popup on every sport is the shared tracker (site/ytd.js).

The owner, 2026-10-22: "streamline all the YTD model performance functions to be
identical with filters and sliders. Make this standard in the files so when we add
new NBA or NFL tools, this happens automatically." So any page whose HTML or own
scripts mention a YTD record must load ../ytd.js and draw it with ytdTracker, and
no page may build its own time-window chips. The tracker itself is exercised on
NHL Best Plays (test_nhl_best_site.py) and NBA First Basket (test_nba_first_basket.py).
"""

import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "nfl_tool" / "site"


def local_scripts(html_path: Path) -> list:
    """The page's own scripts (not shared ones like sync.js), as files."""
    out = []
    for src in re.findall(r'<script src="([^"]+)"', html_path.read_text(encoding="utf-8")):
        if src.startswith("http"):
            continue
        path = (html_path.parent / src).resolve()
        if path.exists():
            out.append(path)
    return out


class SharedTracker(unittest.TestCase):
    def test_every_ytd_page_uses_the_shared_tracker(self):
        pages = 0
        for html in sorted(SITE.rglob("*.html")):
            scripts = local_scripts(html)
            own = [s for s in scripts if s.name not in ("sync.js", "common.js", "book-odds.js", "teams.js", "ytd.js", "nhl-common.js")]
            text = html.read_text(encoding="utf-8") + "".join(s.read_text(encoding="utf-8") for s in own)
            if "YTD" not in text:
                continue
            pages += 1
            with self.subTest(page=str(html.relative_to(SITE))):
                self.assertIn("ytd.js", [s.name for s in scripts], "a page with a YTD record must load ../ytd.js")
                self.assertIn("ytdTracker", text + "".join(s.read_text(encoding="utf-8") for s in scripts if s.name == "nhl-common.js"))
        # NHL Best Plays, Shots, Goals, Points, Saves and NBA First Basket at least.
        self.assertGreaterEqual(pages, 6)

    def test_no_page_builds_its_own_windows(self):
        for js in sorted(SITE.rglob("*.js")):
            if js.name == "ytd.js":
                continue
            with self.subTest(file=str(js.relative_to(SITE))):
                self.assertNotRegex(js.read_text(encoding="utf-8"), r"(?i)\"last (3|7|15|30) days\"")

    def test_one_button_name(self):
        """Every record opens from a button worded "YTD Model Performance"."""
        for path in sorted(list(SITE.rglob("*.html")) + list(SITE.rglob("*.js"))):
            for label in re.findall(r">\s*(YTD[^<]*)<", path.read_text(encoding="utf-8")):
                with self.subTest(file=str(path.relative_to(SITE)), label=label):
                    self.assertTrue(label.startswith("YTD Model Performance"), label)


if __name__ == "__main__":
    unittest.main()
