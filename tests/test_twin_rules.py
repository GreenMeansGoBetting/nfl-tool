"""Rules written twice, once in the build (Python) and once in a page (JavaScript),
because the page works them out again in the browser. Each pair must agree; this
file pins the pairs nothing else checked (2026-11-23, cleanup item 4).

Already pinned elsewhere: the GMG model's weights, grade recipes, edge and scores
(test_site_js.py ModelMatchesTheBuild); the NBA books' main line
(test_nba_research_site.py); the NHL Shots / Points / Saves plays, read from each
file's own `bar` / `edges` / `unsure` (test_nhl_shots_site.py and friends).

Pinned here:
  * NFL grade letters: line_grades.py GRADE_BANDS / _grade / _score and
    game-overview.js GRADE_BANDS / gradeForZ / trenchesScoreStyle (the 0-100
    score's color must agree with its letter: A/B green, C yellow, D/F red).
  * NBA zone score: zone_matchups.py zone_effect and zones.js zmZoneEffect.
  * NFL run lanes and pass depths: nfl_props.py RUSH_ZONES / nfl_common.py
    PASS_DEPTH_BUCKETS and player-card.js RUSH_ZONES / PASS_ZONE_ROWS."""
import sys
import unittest

from helpers import ROOT  # first: puts nfl_tool/ on the import path

sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import line_grades  # noqa: E402
import nfl_common  # noqa: E402
import nfl_props  # noqa: E402
import zone_matchups  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402

SITE = GAME = ZONES = None


def setUpModule():
    global SITE, GAME, ZONES
    SITE = SiteBrowser()
    try:
        GAME = SITE.open("game-overview.html")
        ZONES = SITE.open("nba/zones.html")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


# Every z from -3.00 to 3.00 by hundredths, plus each band's edge and a hair either side.
ZS = sorted({round(-3 + i / 100, 2) for i in range(601)} | {b + d for b, _ in line_grades.GRADE_BANDS for d in (-1e-9, 0.0, 1e-9)})
COLOR = {"A": "tier-good", "B": "tier-good", "C": "tier-mid", "D": "tier-bad", "F": "tier-bad"}


class GradeLetters(unittest.TestCase):
    def test_same_letter_for_every_z(self):
        js = GAME.evaluate("(zs) => zs.map((z) => gradeForZ(z))", ZS)
        build = [line_grades._grade(z) for z in ZS]
        wrong = [(z, b, j) for z, b, j in zip(ZS, build, js) if b != j]
        self.assertEqual(wrong, [], "(z, build letter, page letter)")
        self.assertIsNone(GAME.evaluate("() => gradeForZ(null)"))
        self.assertIsNone(line_grades._grade(None))

    def test_the_score_color_agrees_with_the_letter(self):
        """The cell is tinted by its letter's color: the 0-100 score is rounded, so right at
        the C cut it read 34 or 66 and turned a C red or green (found by this test)."""
        scores = [line_grades._score(z) for z in ZS]
        pairs = [[s, line_grades._grade(z)] for s, z in zip(scores, ZS)]
        js = GAME.evaluate("(pairs) => pairs.map(([s, g]) => trenchesScoreStyle(s, g).cls)", pairs)
        wrong = [(z, s, line_grades._grade(z), cls) for z, s, cls in zip(ZS, scores, js) if cls != COLOR[line_grades._grade(z)]]
        self.assertEqual(wrong, [], "(z, 0-100 score, letter, page color)")


class NbaZoneScore(unittest.TestCase):
    def test_same_effect(self):
        cap = zone_matchups.VOL_CAP
        zones = [{"vol": v, "fg": f, "lg": lg} for v in (None, -0.6, 0.0, 0.35, cap, cap * 3) for f in (None, -0.12, 0.0, 0.08) for lg in (None, 0, 0.45)]
        # The page reads the cap from the build's file (vol_cap); with none it uses 1.
        self.assertEqual(ZONES.evaluate("() => zmVol({ vol: 99 })"), cap)
        js = ZONES.evaluate("(zones) => zones.map((z) => zmZoneEffect(z))", zones)
        for z, j in zip(zones, js):
            b = zone_matchups.zone_effect(z)
            if b is None:
                self.assertIsNone(j, z)
            else:
                self.assertAlmostEqual(j, b, places=12, msg=z)


class NflLanesAndDepths(unittest.TestCase):
    def test_run_lanes(self):
        self.assertEqual(GAME.evaluate("() => RUSH_ZONES.map((z) => z.key)"), nfl_props.RUSH_ZONES)

    def test_pass_depths(self):
        rows = GAME.evaluate("() => PASS_ZONE_ROWS.map((r) => [r.key, r.short])")
        buckets = {key: (lo, hi) for key, lo, hi in nfl_common.PASS_DEPTH_BUCKETS}
        self.assertEqual(sorted(k for k, _ in rows), sorted(buckets))
        for key, short in rows:
            lo, hi = buckets[key]
            want = "SCR" if lo < 0 else f"{lo}+" if hi >= 9999 else f"{lo}-{hi}"
            self.assertEqual(short, want, key)
        self.assertEqual(GAME.evaluate("() => PASS_ZONE_COLS"), nfl_common.PASS_LOCATIONS)


if __name__ == "__main__":
    unittest.main()
