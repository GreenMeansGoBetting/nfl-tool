"""The NBA Points page (site/nba/points.html + points.js) on hand-made data.

What is pinned: every priced player gets a row with the line, the best price
from the books, the projection (and "= line" before his first game this
season), hit rates against tonight's line as "x of y"; a player listed Out
sorts last and is grayed; the player view's game log marks each game over /
under, the alt-line ladder counts round lines, and with / without splits
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
}
QUOTES = lambda line: [["draftkings", "o", line, -110, ""], ["fanduel", "o", line, 105, ""], ["draftkings", "u", line, -110, ""]]  # noqa: E731
# Tonight's defense (BBB) allows 65% at the rim (league 58%: softer) and 40% mid-range (league 45%: tougher).
ZONE_KEYS = ("rim", "short", "mid", "corner3", "above3")
IDENTITY = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "team_games": 5,
            "teams": {"BBB": {f"def_{z}_pct": v for z, v in zip(ZONE_KEYS, (0.65, 0.50, 0.40, 0.38, 0.35))}},
            "league": {f"def_{z}_pct": {"avg": v, "sd": 0.02} for z, v in zip(ZONE_KEYS, (0.58, 0.50, 0.45, 0.38, 0.35))}}}}
DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "injuries": {}, "identity": IDENTITY,
        "teams": {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB")},
        "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                  "props": {"points": {"1": {"name": "Player One", "q": QUOTES(19.5)}, "3": {"name": "Player Three", "q": QUOTES(9.5)}}}}}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, PROPS
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
        self.assertEqual(c[3], "21.0 25% ours")
        # over 19.5: last 5 = 21, 24, 12, 26, 19 -> 3; last 10 -> 6; road (home 0) games 1,3,5,7,9 -> 25, 30, 15, 24, 26 -> 4
        self.assertEqual(c[4], "60% 3 of 5")
        self.assertEqual(c[5], "60% 6 of 10")
        self.assertEqual(c[6], "60% 6 of 10")
        self.assertEqual(c[7], "80% 4 of 5")
        self.assertEqual(c[8], "60% 6 of 10")  # all against BBB
        self.assertEqual(cells(1)[3], "9.5 = line")


class PlayerView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PAGE.click("[data-key='900:1'] .pts-player")
        PAGE.wait_for_selector(".pts-open")

    def test_log_marks_each_game_and_the_ladder_counts_lines(self):
        results = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view > div:first-child tbody tr')].map((tr) => tr.lastElementChild.innerText.trim())")
        self.assertEqual(results[:3], ["U", "O", "U"])  # newest first: 19, 26, 12
        ladder = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view > div:nth-child(3) > table tbody tr')].map((tr) => [tr.children[0].innerText.split(' ')[0], tr.children[2].innerText])")
        self.assertIn(["19.5+", "6 of 10"], ladder)
        self.assertIn(["24.5+", "3 of 10"], ladder)

    def test_no_name_banner_over_the_books(self):
        # the open row already says who it is (the owner, 2026-10-20); the books themselves still show
        self.assertFalse(PAGE.is_visible(".pts-view .bo-banner"))
        self.assertTrue(PAGE.is_visible(".pts-view .bo-table"))

    def test_the_zone_chart_reads_his_shots_and_tonights_defense(self):
        rows = PAGE.evaluate("""() => [...document.querySelectorAll('.pts-zone-table tbody tr')]
            .map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim()).concat(tr.lastElementChild.className))""")
        by = {r[0]: r for r in rows}
        self.assertEqual(len(rows), 5)
        self.assertEqual(by["Rim"][1:4], ["30%", "62% 45", "65%"])
        self.assertIn("tier-good", by["Rim"][4])  # softer than the league at the rim
        self.assertIn("tier-bad", by["Mid-range"][4])  # tougher mid-range
        self.assertEqual(by["Corner 3"][2], "--")  # no shots there
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.pts-court text.pts-zone-share').length"), 6)

    def test_with_and_without_by_reason_and_on_the_floor(self):
        def table():
            return PAGE.evaluate("() => [...document.querySelectorAll('.pts-view > div:nth-child(4) tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()))")
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
