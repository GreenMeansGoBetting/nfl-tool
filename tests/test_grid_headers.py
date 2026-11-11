"""The grid header is ONE block on every page (style.css `.od-grid`).

The owner, 2026-11-03 (NBA Points panel) and again 2026-11-11 (Player Types): a group band with a
label row under it, each with its own rounded corners and a shadow between, "look so stupid", and
"every new page we have to sort this out". The fix lives in style.css, the default every grid gets,
so these pin it there and stop a page from putting the second set of corners back."""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "nfl_tool" / "site"
CSS = (SITE / "style.css").read_text(encoding="utf-8")


def rule(selector_part: str) -> str:
    """The body of the style.css rule whose selector contains `selector_part`."""
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS):
        if selector_part in sel:
            return body
    raise AssertionError(f"no style.css rule for {selector_part}")


class OneBlockHeader(unittest.TestCase):
    def test_the_band_has_no_shadow_and_rounds_only_on_top(self):
        band = rule(".od-ggroups th:is(.od-g0, .od-g1, .od-g2, .od-g3)")
        self.assertIn("box-shadow: none", band)
        self.assertIn("border-radius: 10px 10px 0 0", band)

    def test_the_label_row_shares_the_bands_shade_and_has_no_corners(self):
        band = rule(".od-ggroups th:is(.od-g0, .od-g1, .od-g2, .od-g3)")
        labels = rule(".od-glabels th.od-gt")
        shade = lambda body: re.search(r"background-color:[^;]*,\s*([\d.]+)\)", body).group(1)
        self.assertEqual(shade(band), shade(labels))
        self.assertIn("border-radius: 0", labels)

    def test_no_page_puts_rounded_corners_back_on_the_label_row(self):
        for path in list(SITE.rglob("*.css")) + list(SITE.rglob("*.js")) + list(SITE.rglob("*.html")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
                if ".od-glabels" in sel and re.search(r"border-top-(left|right)-radius:\s*[1-9]", body):
                    self.fail(f"{path.relative_to(SITE)} rounds the label row under a band: {sel.strip()[:80]}")


if __name__ == "__main__":
    unittest.main()
