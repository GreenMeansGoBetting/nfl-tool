"""The NBA Points page (site/nba/points.html + points.js) on hand-made data.

What is pinned: every priced player gets a row with the line, the best price
from the books, the projection (and "= line" before his first game this
season), hit rates against tonight's line as "x of y"; a player listed Out
sorts last and is grayed; the player view (with / without and every book's
price only, the owner's cut on 2026-10-20) splits
his games by whether a teammate played (and why he sat) and his minutes by
whether the teammate was on the floor; the page is in the NBA menu."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta"]


def log(points, opp="BBB", start_game=1):
    # alternating home / road; 30 minutes each
    return [[f"2026-10-{10 + i:02d}", start_game + i, opp, i % 2, 1, 30, p, 15, 2, 5, 4] for i, p in enumerate(points)]


GAME = {"game_id": "900", "date": "2026-10-21", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled"}
# P1 (AAA): 10 games, 6 over 19.5; his teammate P2 sat games 3 and 4 (rest, then injured).
P1 = {"name": "Player One", "team": "AAA", "pos": "G", "log": log([25, 18, 30, 22, 15, 21, 24, 12, 26, 19]),
      "share": 0.31, "zones": {"rim": 0.3, "short": 0.1, "mid": 0.2, "corner3": 0.1, "above3": 0.3},
      "kinds": {"self": 0.4, "catch": 0.3, "drive": 0.3, "other": 0.0}, "assisted": 0.4,
      "zone_pct": {"rim": [0.62, 45], "mid": [0.41, 30], "above3": [0.36, 44]},
      "with": {"2": [200.0, 100, 80, 100.0, 70, 50]}}
P2 = {"name": "Player Two", "team": "AAA", "pos": "C", "log": [r for r in log([10] * 10) if r[1] not in (3, 4)], "share": 0.2,
      "zones": {"rim": 0.8, "short": 0.2, "mid": 0, "corner3": 0, "above3": 0}, "kinds": {"self": 0, "catch": 0, "drive": 1, "other": 0}, "with": {}}
P3 = {"name": "Player Three", "team": "BBB", "pos": "F", "log": log([8, 9, 10], opp="AAA", start_game=50), "share": 0.15,
      "zones": {"rim": 0.5, "short": 0, "mid": 0.5, "corner3": 0, "above3": 0}, "kinds": {"self": 0, "catch": 1, "drive": 0, "other": 0}, "with": {}}
PROPS = {
    "default": "2027",
    "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": {"1": P1, "2": P2, "3": P3},
                         "out": {"AAA": {"3": [["2", "rest"]], "4": [["2", "injury"]]}}}},
    "slate": {"900": {
        "1": {"line": 19.5, "proj": 21.0, "w": 0.25, "ours": 25.5, "min": 30, "ppm": 0.7, "games": 10, "out": False, "missing": 0},
        "3": {"line": 9.5, "proj": 9.5, "w": 0.0, "ours": None, "min": None, "ppm": None, "games": 0, "out": True, "missing": 0},
    }},
    "proj": {"k": 10, "max": 0.5, "last": 5},
    # three graded projections: 2-1, one an Over on a star line
    "record": {"ledger": [["2026-10-20", 1.2, 1, None, ["over", "star"]], ["2026-10-20", 0.4, 0, None, ["under"]],
                          ["2026-10-21", 0.8, 1, None, ["under", "dip"]]]},
}
QUOTES = lambda line: [["draftkings", "o", line, -110, ""], ["fanduel", "o", line, 105, ""], ["draftkings", "u", line, -110, ""],  # noqa: E731
                       ["betmgm", "o", line + 1, 120, ""]]  # an other line: behind "Show Other Lines"
# Tonight's defense (BBB) allows 65% at the rim (league 58%: softer) and 40% mid-range (league 45%: tougher).
ZONE_KEYS = ("rim", "short", "mid", "corner3", "above3")
IDENTITY = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "team_games": 5,
            "teams": {"BBB": {f"def_{z}_pct": v for z, v in zip(ZONE_KEYS, (0.65, 0.50, 0.40, 0.38, 0.35))}},
            "league": {f"def_{z}_pct": {"avg": v, "sd": 0.02} for z, v in zip(ZONE_KEYS, (0.58, 0.50, 0.45, 0.38, 0.35))}}}}
DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "injuries": {}, "identity": IDENTITY,
        "teams": {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB")},
        "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                  "props": {"points": {"1": {"name": "Player One", "q": QUOTES(19.5)}, "3": {"name": "Player Three", "q": QUOTES(9.5)}}}}}}


# shots.json for the open row's Shot Zones: Player One (AAA) is hot at the rim and cold in the left
# corner against BBB; Player Nine (CCC) shot the same way against BBB, so BBB allows the rim and holds the corner.
def spot(where, made, tries, team, defense):
    x, y, three = where
    return [[x, y, 1 if i < made else 0, three, i % 5, 0, 2, team, defense] for i in range(tries)]


RIM, CORNER = (25, 1, 0), (3, 2, 1)
SHOTS = {"season": 2027, "label": "2026-27", "games": list(range(100, 110)), "teams": ["AAA", "BBB", "CCC"],
         "players": {"1": spot(RIM, 9, 10, 0, 1) + spot(CORNER, 1, 10, 0, 1), "9": spot(RIM, 8, 10, 2, 1) + spot(CORNER, 1, 10, 2, 1)},
         "who": {"1": ["Player One", "AAA"], "9": ["Player Nine", "CCC"]},
         "league": [[25, 1, 0, 60, 100], [3, 2, 1, 40, 100]]}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props, SITE.nba_shots = DATA, PROPS, SHOTS
        PAGE = SITE.open("nba/points.html")
        PAGE.wait_for_function("() => !document.getElementById('pts-board').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def cells(i):
    return PAGE.evaluate("(i) => [...document.querySelectorAll('#pts-table tbody tr[data-key]')[i].children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim())", i)


class Board(unittest.TestCase):
    def test_rows_draw_with_no_script_errors_and_out_sorts_last(self):
        self.assertEqual(SITE.errors, [])
        keys = PAGE.evaluate("() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')].map((tr) => tr.dataset.key)")
        self.assertEqual(keys, ["900:1", "900:3"])
        self.assertIn("pts-row-out", PAGE.evaluate("() => document.querySelectorAll('#pts-table tbody tr[data-key]')[1].className"))

    def test_line_best_price_projection_and_hit_rates(self):
        c = cells(0)
        self.assertEqual(c[1], "19.5")
        self.assertIn("+105", c[2])  # the best Over (FanDuel)
        self.assertEqual(c[3], "21.0 Over 1.5")  # shown since 2026-10-23, in testing
        self.assertEqual(cells(1)[3], "9.5 No Games Yet")  # no games this season = the line
        # over 19.5: last 5 = 21, 24, 12, 26, 19 -> 3; last 10 -> 6; road (home 0) games 1,3,5,7,9 -> 25, 30, 15, 24, 26 -> 4
        self.assertEqual(c[4], "60% 3 of 5")
        self.assertEqual(c[5], "60% 6 of 10")
        self.assertEqual(c[6], "60% 6 of 10")
        self.assertEqual(c[7], "80% 4 of 5")
        self.assertEqual(c[8], "60% 6 of 10")  # all against BBB
        prices = PAGE.evaluate("() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')[0].querySelectorAll('.pts-price')].map((d) => d.innerText.replace(/\s+/g, ' ').trim())")
        self.assertEqual(len(prices), 2)  # Over on top of Under
        self.assertTrue(prices[0].startswith("O") and prices[1].startswith("U"), prices)


class Mix(unittest.TestCase):
    def test_three_pills_ranked_on_a_1_to_100_scale(self):
        pills = PAGE.evaluate("() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')[0].querySelectorAll('.pts-mix-pill')].map((p) => [p.innerText.replace(/\\s+/g, ' ').trim().toUpperCase(), p.title, p.style.background])")
        self.assertEqual([p[0] for p in pills], ["RIM 30", "3S 40", "SELF 40"])
        # Player One takes the most 3s of the three players (P2 and P3 take none): 67 of 100, colored
        self.assertIn("(67 of 100", pills[1][1])
        self.assertTrue(all(p[2] for p in pills))


class TestingBanner(unittest.TestCase):
    """The owner, 2026-10-23: a large header until mid-November, with the live record."""

    def test_banner_shows_the_record_so_far(self):
        text = PAGE.evaluate("() => document.getElementById('pts-testing').innerText.replace(/\\s+/g, ' ')")
        self.assertIn("Projections In Testing Until Mid-November", text)
        self.assertIn("2-1", text)
        self.assertIn("67%", text)

    def test_ytd_tracker_has_the_idea_splits(self):
        PAGE.click("#pts-ytd")
        tiles = PAGE.evaluate("() => [...document.querySelectorAll('#pts-ytd-modal .ytd-tile')].map((t) => t.innerText.replace(/\\s+/g, ' ').trim())")
        PAGE.click("#pts-ytd-modal .modal-close")
        self.assertTrue(tiles[0].startswith("POINTS PROJECTION 2-1"), tiles)
        star = next(t for t in tiles if t.startswith("STAR LINES"))
        self.assertIn("1-0", star)
        dip = next(t for t in tiles if t.startswith("MINUTES DIP"))
        self.assertIn("1-0", dip)
        self.assertEqual(SITE.errors, [])


class PlayerView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PAGE.click("[data-key='900:1'] .pts-player")
        PAGE.wait_for_selector(".pts-open")

    def test_with_without_and_the_books_stacked_then_the_zones(self):
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view h4')].map((h) => h.textContent)")
        self.assertEqual(heads, ["With / Without", "Every Book", "Shot Zones: Player One vs BBB Defense"])
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.pts-view-left h4').length"), 2)

    def test_main_lines_only_until_show_other_lines(self):
        self.assertFalse(PAGE.is_visible(".pts-view .bo-others tr"))
        btn = ".pts-view [data-bo-others]"
        self.assertEqual(PAGE.inner_text(btn).upper(), "SHOW OTHER LINES (1)")
        PAGE.click(btn)
        self.assertTrue(PAGE.is_visible(".pts-view .bo-others tr"))
        self.assertEqual(PAGE.inner_text(btn).upper(), "HIDE OTHER LINES (1)")
        PAGE.click(btn)
        self.assertFalse(PAGE.is_visible(".pts-view .bo-others tr"))

    def test_his_zones_next_to_the_defense_with_both_sided_calls(self):
        PAGE.wait_for_selector(".pts-zone-pair .nba-shot-chart")
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.pts-zone-pair .nba-shot-chart').length"), 2)
        calls = PAGE.evaluate("() => [...document.querySelectorAll('.pts-zone-call')].map((c) => c.textContent)")
        self.assertEqual(calls, ["Target: At The Rim", "Tough: Left Corner 3"])
        self.assertIn("shot-charts.html#p=1&d=BBB", PAGE.get_attribute(".pts-zone-more", "href"))
        PAGE.click(".pts-view .nba-shot-opt[data-shot-value='heat']")
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.pts-zone-pair .nba-shot-chart').length"), 2)
        PAGE.click(".pts-view .nba-shot-opt[data-shot-value='zones']")
        self.assertEqual(SITE.errors, [])

    def test_no_name_banner_over_the_books(self):
        # the open row already says who it is (the owner, 2026-10-20); the books themselves still show
        self.assertFalse(PAGE.is_visible(".pts-view .bo-banner"))
        self.assertTrue(PAGE.is_visible(".pts-view .bo-table"))

    def test_with_and_without_by_reason_and_on_the_floor(self):
        def table():
            return PAGE.evaluate("() => [...document.querySelectorAll('.pts-view-left > div:nth-child(1) tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()))")
        rows = table()
        self.assertEqual(rows[0][:3], ["Played", "8", "20.0"])  # games 1, 2, 5-10
        self.assertEqual(rows[1][:3], ["Out", "2", "26.0"])  # games 3 (30) and 4 (22)
        PAGE.click("[data-ww-mode=rest]")
        self.assertEqual(table()[1][:3], ["Out: rest", "1", "30.0"])
        PAGE.click("[data-ww-mode=injury]")
        self.assertEqual(table()[1][:3], ["Out: injured", "1", "22.0"])
        PAGE.click("[data-ww-mode=floor]")
        rows = table()
        self.assertEqual(rows[0], ["On the floor", "200", "18.0", "14.4"])
        self.assertEqual(rows[1], ["Off the floor", "100", "25.2", "18.0"])
        self.assertEqual(SITE.errors, [])


class Menu(unittest.TestCase):
    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/points.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
