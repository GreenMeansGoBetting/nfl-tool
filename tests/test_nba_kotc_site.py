"""The NBA Promo Tools page (site/nba/kotc.js: King of the Court) in a real
browser, on a hand-made nba/data.json built by kotc.py's own functions from
test_nba_kotc's small season.

What is pinned: the page shows the build's projections and chances and does
no math of its own; best chance first, Out players last with no chance; every
column sorts; the season switch (a disabled 2026-27 until it has games); the
defense board lists every team and dims the ones not playing; the nightly
leaders list; the Historical Data popup; the Promo Tools menu links here."""
import unittest

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path

from site_browser import SiteBrowser
from test_nba_kotc import LINES, SEASON, TEAMS, kotc

SITE = PAGE = None
NIGHT = "2026-10-20"


def nba_data(with_this_season=False):
    old = kotc.MIN_GAMES
    kotc.MIN_GAMES = 1
    try:
        pg = kotc.player_games(SEASON, TEAMS)
        blocks = {"2026": kotc.season_block(pg, LINES, "2025-26")}
        if with_this_season:
            blocks["2027"] = kotc.season_block(pg, LINES, "2026-27", blocks["2026"]["players"])
        games = [
            {"game_id": "9", "date": NIGHT, "time": "19:30", "start_utc": "2026-10-20T23:30Z", "away": "BBB", "home": "AAA", "status": "scheduled",
             "home_team_spread": -4.0, "away_team_spread": 4.0, "total_line": 232.0},
            {"game_id": "8", "date": "2026-10-21", "time": "19:00", "start_utc": "2026-10-21T23:00Z", "away": "DDD", "home": "CCC", "status": "scheduled"},
        ]
        teams_now = {"10": "AAA", "11": "AAA", "20": "BBB", "21": "BBB", "30": "CCC", "40": "DDD"}
        slates = {s: kotc.slate(b, games, teams_now, {"11"}, [NIGHT, "2026-10-21"]) for s, b in blocks.items()}
    finally:
        kotc.MIN_GAMES = old
    for b in blocks.values():
        b.pop("_league")
    teams = {t: {"name": t, "short": t, "logo": "", "color": "555555"} for t in TEAMS}
    return {
        "season": 2027, "season_label": "2026-27", "teams": teams, "schedule": games, "team_stats": {}, "players": {}, "injuries": {},
        "kotc": {"default": "2026", "weights": kotc.WEIGHTS, "thresholds": list(kotc.THRESHOLDS), "seasons": blocks, "slates": slates, "record": {}},
    }


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba = nba_data()
        PAGE = SITE.open("nba/promo-tools.html")
        PAGE.wait_for_function("() => KOTC && document.querySelector('.kotc-table')")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


ROWS = """() => [...document.querySelectorAll('#kotc-players tbody tr[data-player]')].map((tr) => ({
    id: tr.dataset.player, out: tr.classList.contains('kotc-out'), lead: tr.children[2].textContent.trim(), proj: tr.children[3].textContent.trim() }))"""


class Board(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { Object.assign(playerSort, { key: 'lead', dir: -1 }); dayIndex = days().indexOf('2026-10-20'); render(); }")

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_shows_the_builds_numbers_best_chance_first_out_last(self):
        rows = PAGE.evaluate(ROWS)
        built = {r["id"]: r for r in SITE.nba["kotc"]["slates"]["2026"][NIGHT]}
        self.assertEqual({r["id"] for r in rows}, set(built))
        live = [r for r in rows if not r["out"]]
        self.assertEqual([r["id"] for r in live], [r["id"] for r in sorted((b for b in built.values() if not b["out"]), key=lambda b: -b["lead"])])
        for r in live:
            self.assertEqual(r["proj"], f"{built[r['id']]['proj']:.1f}")
        self.assertEqual([r["id"] for r in rows if r["out"]], ["11"])
        self.assertEqual(rows[-1], {"id": "11", "out": True, "lead": "--", "proj": rows[-1]["proj"]})

    def test_every_column_sorts(self):
        for key in ("name", "proj", "pra", "l10", "b0", "b4", "score", "opp", "matchup", "vspos", "total", "spread"):
            PAGE.evaluate(f"() => document.querySelector('[data-sort=\"{key}\"]').click()")
            rows = PAGE.evaluate(ROWS)
            self.assertEqual(len(rows), len(SITE.nba["kotc"]["slates"]["2026"][NIGHT]), key)
            self.assertEqual(rows[-1]["id"], "11", key)  # Out stays last whatever the sort
        self.assertEqual(SITE.errors, [])

    def test_season_switch_waits_for_this_seasons_games(self):
        buttons = PAGE.evaluate("() => [...document.querySelectorAll('#kotc-seasons button')].map((b) => [b.textContent, b.disabled])")
        self.assertEqual(buttons, [["2025-26", False], ["2026-27", True]])


class DefenseAndHistory(unittest.TestCase):
    def test_defense_board_lists_every_team_and_dims_idle_ones(self):
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.kotc-def-table tbody tr')].map((tr) => [tr.querySelector('b').textContent, tr.classList.contains('kotc-playing')])")
        self.assertEqual(sorted(t for t, _ in rows), sorted(TEAMS))
        self.assertEqual(sorted(t for t, playing in rows if playing), ["AAA", "BBB"])

    def test_hide_teams_not_playing_and_back(self):
        teams = "() => [...document.querySelectorAll('.kotc-def-table tbody .kotc-team b')].map((b) => b.textContent)"
        PAGE.click("#kotc-def-playing")
        self.assertEqual(sorted(PAGE.evaluate(teams)), ["AAA", "BBB"])
        PAGE.click("#kotc-def-playing")
        self.assertEqual(sorted(PAGE.evaluate(teams)), sorted(TEAMS))

    def test_targets_list_the_top_players_on_the_defense_they_face(self):
        cells = PAGE.evaluate("() => Object.fromEntries([...document.querySelectorAll('.kotc-def-table tbody tr')].map((tr) => [tr.querySelector('.kotc-team b').textContent, [...tr.querySelectorAll('.kotc-targets span')].map((s) => s.title)]))")
        rows = [r for r in SITE.nba["kotc"]["slates"]["2026"][NIGHT] if not r.get("out")]  # fewer than 100: every one listed
        names = SITE.nba["kotc"]["seasons"]["2026"]["players"]
        for d in TEAMS:
            self.assertEqual(sorted(cells[d]), sorted(names[r["id"]]["name"] for r in rows if r["opp"] == d), d)

    def test_nightly_leaders_newest_first_with_ties(self):
        names = PAGE.evaluate("() => [...document.querySelectorAll('.kotc-night .koe-win-names')].map((e) => e.textContent)")
        self.assertEqual(names[0], "Star A / Star C")
        self.assertEqual(names[1], "Star A")

    def test_historical_data_opens_and_closes(self):
        PAGE.click("#kotc-history-btn")
        self.assertFalse(PAGE.evaluate("() => document.getElementById('kotc-history-modal').hidden"))
        self.assertIn("2025-26", PAGE.inner_text("#kotc-hist-season"))
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.kotc-hist-tile').length"), 4)
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('kotc-history-modal').hidden"))

    def test_promo_menu_links_here(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.promo-menu a')].map((a) => a.getAttribute('href'))")
        self.assertIn("/nba/promo-tools.html", links)


class ThisSeason(unittest.TestCase):
    def test_switching_to_this_season_and_back(self):
        page = SITE.context.new_page()
        SITE.nba = nba_data(with_this_season=True)
        try:
            page.goto(f"{SITE.origin}/nba/promo-tools.html")
            page.wait_for_function("() => KOTC && document.querySelector('.kotc-table')")
            page.click("#kotc-seasons [data-season='2027']")
            self.assertEqual(page.evaluate("() => season"), "2027")
            self.assertIn("2026-27 numbers", page.inner_text("#kotc-note"))
            page.click("#kotc-seasons [data-season='2026']")
            self.assertEqual(page.evaluate("() => season"), "2026")
        finally:
            page.evaluate("() => localStorage.clear()")
            page.close()
            SITE.nba = nba_data()


if __name__ == "__main__":
    unittest.main()
