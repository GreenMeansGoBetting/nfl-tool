"""The NBA Threes page (site/nba/threes.html + threes.js on the shared
props-board.js) on hand-made data.

What is pinned: the play reads like the NHL pages (Play chip "o1.5 3PM", Proj
Att, Proj, GMG Fair, Odds with the book, Good To, Edge), sorted by Edge by
default and by any column clicked; 3PA / 3PM a game; the hit rates under one
"Hit Rate" header with Home and Away apart; the two-sided tags in one look,
and the tag filter; minutes tags from the injury report (a teammate at his
spot Out = Min up; one back from sitting the last game = Min down); the
testing banner with the record in units; the drop down's with / without on
threes, every book, and the ladder showing only rungs a book prices; the page
is in the NBA menu."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta"]


def log(made, opp="BBB", start_game=1, tried=6, minutes=30):
    # alternating home / road (odd games at home)
    return [[f"2026-10-{10 + i:02d}", start_game + i, opp, i % 2, 1, minutes, 12, 12, m, tried, 2] for i, m in enumerate(made)]


GAME = {"game_id": "900", "date": "2026-10-21", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled"}
# P1 (AAA): 10 games, 6 over 1.5; teammate P2 (a guard too) sat games 3 (rest) and 4 (injured) and is Out
# tonight; guard P5 sat AAA's last game (10) and isn't listed Out tonight.
P1 = {"name": "Player One", "team": "AAA", "pos": "SG", "log": log([3, 1, 4, 2, 0, 2, 3, 1, 2, 1]), "share": 0.2,
      "zones": {"rim": 0.2, "short": 0.05, "mid": 0.05, "corner3": 0.3, "above3": 0.4},
      "kinds": {"self": 0.2, "catch": 0.6, "drive": 0.2, "other": 0.0}, "with": {}}
P2 = {"name": "Player Two", "team": "AAA", "pos": "PG", "log": [r for r in log([0] * 10) if r[1] not in (3, 4)], "share": 0.2,
      "zones": {"rim": 0.8, "short": 0.2, "mid": 0, "corner3": 0, "above3": 0}, "kinds": {"self": 0, "catch": 0, "drive": 1, "other": 0}, "with": {}}
P3 = {"name": "Player Three", "team": "BBB", "pos": "SF", "log": log([3] * 5, opp="AAA", start_game=50, tried=8), "share": 0.2,
      "zones": {"rim": 0.3, "short": 0.1, "mid": 0.1, "corner3": 0.2, "above3": 0.3}, "kinds": {"self": 0.3, "catch": 0.5, "drive": 0.2, "other": 0}, "with": {}}
P5 = {"name": "Player Five", "team": "AAA", "pos": "PG", "log": log([1] * 5, minutes=25), "share": 0.15, "zones": {}, "kinds": {}, "with": {}}
PROPS = {
    "default": "2027",
    "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": {"1": P1, "2": P2, "3": P3, "5": P5},
                         "out": {"AAA": {"3": [["2", "rest"]], "4": [["2", "injury"]], "10": [["5", "rest"]]}}}},
    "slate": {},
    "threes_slate": {"900": {
        "1": {"line": 1.5, "proj": 2.03, "w": 0.25, "ours": 2.4, "tries": 6.4, "pct": 0.351, "p_over": 0.571, "p_mkt": 0.524,
              "edge": 0.047, "ladder": [0.84, 0.571, 0.33, 0.16, 0.07], "best_o": 105, "best_u": -110, "games": 10, "out": False,
              "missing": 0, "share": 0.2, "luck": -0.7, "spread": 7.5, "min_ratio": 1.0},
        "2": {"line": 0.5, "proj": 0.6, "w": 0.0, "ours": None, "tries": None, "pct": None, "p_over": 0.45, "p_mkt": 0.47,
              "edge": -0.02, "ladder": [0.45, 0.13, 0.03, 0.01, 0.0], "best_o": 120, "best_u": -150, "games": 0, "out": True,
              "missing": 0, "share": 0.2, "luck": None, "spread": 7.5, "min_ratio": None},
        "3": {"line": 2.5, "proj": 2.9, "w": 0.2, "ours": 3.1, "tries": 8.0, "pct": 0.36, "p_over": 0.5, "p_mkt": 0.48,
              "edge": 0.02, "ladder": [0.9, 0.75, 0.5, 0.3, 0.15], "best_o": 100, "best_u": -120, "games": 5, "out": False,
              "missing": 0, "share": 0.2, "luck": 0.0, "spread": -7.5, "min_ratio": 1.0},
    }},
    # two graded: one Over won at +110, one Under lost
    "threes_record": {"ledger": [["2026-10-20", 0.06, 1, 1.1, ["over", "dog", "cold"]], ["2026-10-20", 0.05, 0, -1.0, ["under"]]]},
}
MAIN = [["draftkings", "o", 1.5, -110, ""], ["fanduel", "o", 1.5, 105, ""], ["draftkings", "u", 1.5, -110, ""]]
# the alternate ladder: 1+ and 3+ priced, 2+ only on the main line, 4+ / 5+ nowhere
ALT = [["draftkings", "o", 0.5, -500, ""], ["fanduel", "o", 2.5, 260, ""]]
# Tonight's defense (BBB) gives up threes (1.5 spreads above the league) with an average catch share.
IDENTITY = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "team_games": 5,
            "teams": {"BBB": {"def_three_pp": 0.41, "def_catch3": 0.6}},
            "league": {"def_three_pp": {"avg": 0.38, "sd": 0.02}, "def_catch3": {"avg": 0.6, "sd": 0.03}}}}}
DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "identity": IDENTITY,
        "injuries": {"AAA": [{"id": "2", "name": "Player Two", "status": "Out"}]},
        "teams": {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB")},
        "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                  "props": {"threes": {"1": {"name": "Player One", "q": MAIN},
                                                       "2": {"name": "Player Two", "q": [["draftkings", "o", 0.5, 120, ""], ["draftkings", "u", 0.5, -150, ""]]},
                                                       "3": {"name": "Player Three", "q": [["draftkings", "o", 2.5, 100, ""], ["draftkings", "u", 2.5, -120, ""]]}},
                                            "threes_alt": {"1": {"name": "Player One", "q": ALT}}}}}}
SHOTS = {"season": 2027, "label": "2026-27", "games": list(range(100, 110)), "teams": ["AAA", "BBB"],
         "players": {"1": [[3, 2, i % 2, 1, i % 5, 0, 2, 0, 1] for i in range(10)]},
         "who": {"1": ["Player One", "AAA"]}, "league": [[3, 2, 1, 40, 100]]}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props, SITE.nba_shots = DATA, PROPS, SHOTS
        PAGE = SITE.open("nba/threes.html")
        PAGE.wait_for_function("() => !document.getElementById('pts-board').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def keys():
    return PAGE.evaluate("() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')].map((tr) => tr.dataset.key)")


def row(pid):
    return PAGE.evaluate("(pid) => [...document.querySelector(`#pts-table tbody tr[data-key='900:${pid}']`).children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim())", pid)


def heads():
    return PAGE.evaluate("() => [...document.querySelectorAll('#pts-table thead tr:last-child th')].map((th) => th.firstChild.textContent.trim())")


class Board(unittest.TestCase):
    def test_columns_in_order_with_the_hit_rate_group(self):
        self.assertEqual(SITE.errors, [])
        self.assertEqual(heads(), ["Player", "Play", "Proj Att", "Proj", "GMG Fair", "Odds", "Good To", "Edge", "3PA", "3PM",
                                   "L5", "L10", "Season", "Home", "Away", "vs", "Tags"])
        group = PAGE.evaluate("() => [...document.querySelectorAll('#pts-table .pb-group-row th')].map((th) => [th.colSpan, th.innerText.trim().toUpperCase()])")
        self.assertIn([6, "HIT RATE"], group)

    def test_sorted_by_edge_by_default_out_last(self):
        self.assertEqual(keys(), ["900:1", "900:3", "900:2"])  # +8.3, 0.0, then Out

    def test_play_fair_odds_good_to_and_edge_the_nhl_way(self):
        # Player One: our 57.1% Over. Over's best is +105 (needs 48.8%): +8.3; Under's -110 (needs 52.4%
        # for our 42.9%): worse. So the play is o1.5 at +105.
        c = row(1)
        self.assertEqual(c[1].upper(), "O1.5 3PM")
        self.assertEqual(c[2], "6.4")  # Proj Att, no subtext
        self.assertEqual(c[3], "2.03")
        self.assertEqual(c[4], "-133")  # 57.1% with no cut
        self.assertIn("+105", c[5])
        self.assertIn("FANDUEL", c[5].upper())
        self.assertEqual(c[6], "-118")  # 54.1% (3 points under ours)
        self.assertEqual(c[7], "+8.3")
        self.assertIn("tier-good", PAGE.evaluate("() => document.querySelector(\"tr[data-key='900:1'] .th-edge\").className"))
        self.assertEqual((c[8], c[9]), ("6.0", "1.9"))  # 3PA / 3PM a game
        # Player Two (Pippen's case, the owner 2026-10-23): we lean Under (45% Over vs the books' 47%).
        # The Over's +120 is the less-bad price (-0.5), but the play is our side: Under at -150 (needs 60%
        # for our 55%) = -5.0, red, no Good To.
        c2 = row(2)
        self.assertEqual(c2[1].upper(), "U0.5 3PM")
        self.assertEqual(c2[3], "0.60 No Games")
        self.assertEqual((c2[6], c2[7]), ("--", "-5.0"))
        self.assertIn("tier-bad", PAGE.evaluate("() => document.querySelector(\"tr[data-key='900:2'] .th-edge\").className"))
        self.assertEqual(row(3)[6], "--")  # an edge of 0.0: not a play either

    def test_hit_rates_home_and_away_apart_colored_by_the_percentage(self):
        c = row(1)
        # over 1.5: last 5 = 2, 3, 1, 2, 1 -> 3; all 10 -> 6; home (odd games) 1,2,2,1,1 -> 2; road 3,4,0,3,2 -> 4
        self.assertEqual(c[10:16], ["60% 3 of 5", "60% 6 of 10", "60% 6 of 10", "40% 2 of 5", "80% 4 of 5", "60% 6 of 10"])
        colors = PAGE.evaluate("() => [...document.querySelectorAll(\"tr[data-key='900:1'] .pts-hit\")].map((td) => td.style.background)")
        self.assertTrue(all(colors), colors)
        # every cell, however few games (Player Three's 2 home games too)
        self.assertTrue(PAGE.evaluate("() => [...document.querySelectorAll(\"tr[data-key='900:3'] .pts-hit\")].every((td) => td.style.background)"))
        self.assertEqual(len(set(colors[3:5])), 2)  # 40% and 80% differ

    def test_every_column_sorts_and_flips(self):
        PAGE.click("#pts-table th[data-sort='att']")
        self.assertEqual(keys()[:2], ["900:3", "900:1"])  # 8.0 tries before 6.4
        PAGE.click("#pts-table th[data-sort='att']")
        self.assertEqual(keys()[:2], ["900:1", "900:3"])
        PAGE.click("#pts-table th[data-sort='name']")
        self.assertEqual(keys()[:2], ["900:1", "900:3"])  # A-Z
        n = PAGE.evaluate("() => document.querySelectorAll('#pts-table thead tr:last-child th[data-sort]').length")
        self.assertEqual(n, len(heads()))
        PAGE.click("#pts-table th[data-sort='edge']")
        self.assertEqual(keys(), ["900:1", "900:3", "900:2"])

    def test_two_sided_tags_in_one_look(self):
        tags = row(1)[16].upper()
        self.assertIn("3S ALLOWED", tags)  # BBB gives up threes and 70% of his shots are threes
        self.assertNotIn("HELP D", tags)  # BBB's catch share is average
        self.assertIn("UNDERDOG +7.5", tags)
        self.assertIn("COLD RUN", tags)
        self.assertNotIn("3S ALLOWED", row(3)[16].upper())  # AAA's defense: no numbers
        looks = PAGE.evaluate("""() => [...document.querySelectorAll("tr[data-key='900:1'] .pts-tags > span")].map((t) => {
            const s = getComputedStyle(t);
            return [s.fontSize, s.fontWeight, s.height, s.borderRadius, s.textTransform, s.fontFamily].join('|');
        })""")
        self.assertGreaterEqual(len(looks), 3)
        self.assertEqual(len(set(looks)), 1, looks)

    def test_minutes_tags_from_the_injury_report(self):
        tags = row(1)[16].upper()
        self.assertIn("MIN ↑", tags)  # Player Two (a guard) is listed Out tonight
        self.assertIn("MIN ↓", tags)  # Player Five sat the last game and isn't listed Out
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.pts-min').length"), 0)  # no Min column

    def test_the_tag_filter(self):
        options = PAGE.evaluate("() => [...document.querySelectorAll('#pts-tag option')].map((o) => o.value)")
        self.assertIn("allowed", options)
        PAGE.select_option("#pts-tag", "allowed")
        self.assertEqual(keys(), ["900:1"])
        PAGE.select_option("#pts-tag", "")
        self.assertEqual(len(keys()), 3)
        self.assertEqual(SITE.errors, [])


class TestingBanner(unittest.TestCase):
    def test_banner_says_tries_not_makes_and_shows_the_record_in_units(self):
        text = PAGE.evaluate("() => document.getElementById('pts-testing').innerText.replace(/\\s+/g, ' ')")
        self.assertIn("We can predict how many threes a player will try, but not how many he'll make", text)
        self.assertIn("1-1", text)
        self.assertIn("+0.1u", text)

    def test_ytd_tracker_has_the_idea_splits(self):
        PAGE.click("#pts-ytd")
        tiles = PAGE.evaluate("() => [...document.querySelectorAll('#pts-ytd-modal .ytd-tile')].map((t) => t.innerText.replace(/\\s+/g, ' ').trim())")
        PAGE.click("#pts-ytd-modal .modal-close")
        self.assertTrue(tiles[0].startswith("THREES PLAYS 1-1"), tiles)
        self.assertIn("1-0", next(t for t in tiles if t.startswith("UNDERDOGS")))
        self.assertIn("1-0", next(t for t in tiles if t.startswith("COLD RUN")))
        self.assertEqual(SITE.errors, [])


class PlayerView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PAGE.click("[data-key='900:1'] .pts-player")
        PAGE.wait_for_selector(".pts-open")

    def test_the_sections(self):
        h = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view h4')].map((h) => h.firstChild.textContent.trim())")
        self.assertEqual(h, ["With / Without", "Every Book", "The Ladder", "Shot Zones: Player One vs BBB Defense"])

    def test_the_ladder_shows_only_priced_rungs(self):
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.th-ladder tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim()))")
        self.assertEqual([r[0] for r in rows], ["1+ Threes", "2+ Threes", "3+ Threes"])
        self.assertEqual(rows[1][2], "+105 FanDuel")  # the main line's best
        self.assertEqual(rows[2][1], "+203 33%")  # our fair for 3+
        self.assertEqual(rows[2][3], "+5%")  # 33% vs +260's 27.8%

    def test_with_and_without_on_threes(self):
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view-left > div:nth-child(1) tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()))")
        self.assertEqual(rows[0][:4], ["Played", "8", "1.6", "6.0"])  # games 1, 2, 5-10: 3+1+0+2+3+1+2+1 = 13
        self.assertEqual(rows[1][:3], ["Out", "2", "3.0"])  # games 3 (4) and 4 (2)

    def test_shot_zones_open_on_threes(self):
        PAGE.wait_for_selector(".pts-zone-pair .nba-shot-chart")
        on = PAGE.evaluate("() => document.querySelector('.pts-view .nba-shot-opt[data-shot-key=\"pts\"].active').dataset.shotValue")
        self.assertEqual(on, "3")
        self.assertEqual(SITE.errors, [])


class Menu(unittest.TestCase):
    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/threes.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
