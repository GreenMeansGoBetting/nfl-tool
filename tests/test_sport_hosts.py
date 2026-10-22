"""Every root file an NBA or NHL page loads is one its own address can serve.

nba.gmgsports.org/x and nhl.gmgsports.org/x are served from the site's nba/ and
nhl/ folders, except the root files listed in SHARED_FILES (functions/
_middleware.js). Local tests and the site check serve the folders directly,
with no login gate, so a page loading "../new-file.js" works everywhere but the
real address. On 2026-10-22 the NHL prop pages started loading ../ytd.js
without it being listed: on nhl.gmgsports.org it came back missing and Shots
and Best Plays drew no plays at all."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "nfl_tool" / "site"
MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"


def shared_files() -> set:
    text = MIDDLEWARE.read_text(encoding="utf-8")
    listed = re.search(r"const SHARED_FILES = \[([^\]]*)\]", text).group(1)
    return set(re.findall(r'"(/[^"]+)"', listed))


class SportHosts(unittest.TestCase):
    def test_every_root_file_a_sport_page_loads_is_shared(self):
        shared = shared_files()
        checked = 0
        for sport in ("nba", "nhl"):
            for page in sorted((SITE / sport).rglob("*.html")):
                text = page.read_text(encoding="utf-8")
                for ref in re.findall(r'(?:src|href)="\.\./([^"?#]+)', text):
                    checked += 1
                    # Links to NFL pages are sent to nfl.gmgsports.org (NFL_PAGES); only
                    # what the page loads (scripts, styles, data) has to be served here.
                    if ref.startswith("brand/") or not ref.endswith((".js", ".css", ".json")):
                        continue
                    with self.subTest(page=str(page.relative_to(SITE)), file=ref):
                        self.assertIn(f"/{ref}", shared, f"{ref} is loaded from the root but nhl./nba.gmgsports.org can't serve it: add it to SHARED_FILES")
        self.assertGreater(checked, 10)

    def test_the_shared_tracker_is_shared(self):
        self.assertIn("/ytd.js", shared_files())


if __name__ == "__main__":
    unittest.main()
