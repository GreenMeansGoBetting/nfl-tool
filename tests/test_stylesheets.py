"""The NFL stylesheets: one shared style.css plus one file per page group (2026-11-23).

style.css was 4,400 lines of every NFL page's rules stacked on each other. It was split so each
page loads the shared look plus only its own rules (styles.md, "One stylesheet per sport"). These
pin the links (shared file first, the page's own file right after it, nothing another page owns)
and that a page file holds only rules for its own pages: a rule there must name a class or id
that only that group's pages use, or members on another page would lose it."""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "nfl_tool" / "site"

# page file -> the pages that load it
PAGE_FILES = {
    "game-previews.css": ["game-overview.html"],
    "td-data.css": ["index.html", "opening-drives.html"],
    "player-props.css": ["player-props.html", "best-plays.html"],
    "my-plays.css": ["my-plays.html"],
    "promos.css": ["promo-tools.html", "contest.html"],
    "support.css": ["support.html"],
    "activity.css": ["activity.html"],
    "nfl-vs-position.css": ["nfl-vs-position.html"],
}
OWNER = {page: css for css, pages in PAGE_FILES.items() for page in pages}


def stylesheets(html: str) -> list:
    return re.findall(r'<link rel="stylesheet" href="([^"]+\.css)">', html)


def page_code(page: str) -> str:
    """A page's HTML and every local script it loads."""
    html = (SITE / page).read_text(encoding="utf-8")
    parts = [html]
    for src in re.findall(r'<script[^>]*src="([^"]+)"', html):
        if not src.startswith("http"):
            parts.append((SITE / page).parent.joinpath(src).read_text(encoding="utf-8"))
    return "\n".join(parts)


def selectors(css: str) -> list:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"@media[^{]*\{", "", css)
    return [s.strip() for block in re.findall(r"([^{}]+)\{[^{}]*\}", css) for s in block.split(",") if s.strip()]


def names(selector: str) -> list:
    """The classes / ids a selector needs (not the ones inside :not(), :is(), ...)."""
    depth, plain = 0, ""
    for ch in selector:
        depth += ch == "("
        if not depth:
            plain += ch
        depth -= ch == ")"
    return re.findall(r"[.#](-?[A-Za-z_][\w-]*)", plain)


def named(name: str, text: str) -> bool:
    return re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", text) is not None


class Stylesheets(unittest.TestCase):
    def test_every_nfl_page_loads_the_shared_file_then_its_own(self):
        for page in sorted(p.name for p in SITE.glob("*.html")):
            sheets = stylesheets((SITE / page).read_text(encoding="utf-8"))
            if not sheets:
                continue  # a page that only forwards
            want = ["style.css"] + ([OWNER[page]] if page in OWNER else [])
            self.assertEqual(sheets, want, page)

    def test_the_sport_pages_never_load_an_nfl_page_file(self):
        for page in list(SITE.glob("nba/*.html")) + list(SITE.glob("nhl/*.html")):
            for sheet in stylesheets(page.read_text(encoding="utf-8")):
                self.assertNotIn(Path(sheet).name, PAGE_FILES, page.name)

    def test_a_page_file_only_styles_its_own_pages(self):
        """Every rule in a page file names something the other pages don't have (or nothing
        on the site has at all: an old rule left with its section)."""
        code = {page: page_code(page) for page in OWNER}
        others = "\n".join(p.read_text(encoding="utf-8") for d in ("nba", "nhl") for p in (SITE / d).glob("*") if p.suffix in (".js", ".html"))
        for css, pages in PAGE_FILES.items():
            elsewhere = others + "\n".join(t for p, t in code.items() if p not in pages)
            mine = "\n".join(code[p] for p in pages)
            for sel in selectors((SITE / css).read_text(encoding="utf-8")):
                tokens = names(sel)
                own = [t for t in tokens if named(t, mine) and not named(t, elsewhere)]
                unused = [t for t in tokens if not named(t, mine) and not named(t, elsewhere)]
                self.assertTrue(own or unused, f"{css}: `{sel}` styles other pages too; it belongs in style.css")

    def test_the_shared_file_is_still_the_one_the_sport_pages_get(self):
        middleware = (SITE.parent / "functions" / "_middleware.js").read_text(encoding="utf-8")
        self.assertIn('"/style.css"', middleware)
        for css in PAGE_FILES:
            self.assertNotIn(f'"/{css}"', middleware)


if __name__ == "__main__":
    unittest.main()
