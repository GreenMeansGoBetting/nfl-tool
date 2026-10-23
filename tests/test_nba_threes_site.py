"""The NBA Threes page (site/nba/threes.html + threes.js) on hand-made data.

What is pinned: every player with a threes line gets a row with the line,
the best price, the projection (threes made, and the side our chance leans
off the books' by how many points; "No Games Yet" before his first game),
his tries and make rate, hit rates on threes made against tonight's line,
his threes tried a game; the two-sided tags (3s Allowed needs this defense
to give up threes AND him to shoot them); the testing banner with the record
in units; the drop down's with / without on threes, every book, and the
ladder showing only rungs a book prices; the page is in the NBA menu."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta"]


def log(made, opp="BBB", start_game=1):
    # alternating home / road; 30 minutes, 6 threes tried each
    return [[f"2026-10-{10 + i:02d}", start_game + i, opp, i % 2, 1, 30, 12, 12, m, 6, 2] for i, m in enumerate(made)]


GAME = {"game_id": "900", "date": "2026-10-21", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled"}
# P1 (AAA): 10 games, 6 over 1.5; teammate P2 sat games 3 (rest) and 4 (injured).
P1 = {"name": "Player One", "team": "AAA", "pos": "SG", "log": log([3, 1, 4, 2, 0, 2, 3, 1, 2, 1]), "share": 0.2,
      "zones": {"rim": 0.2, "short": 0.05, "mid": 0.05, "corner3": 0.3, "above3": 0.4},
      "kinds": {"self": 0.2, "catch": 0.6, "drive": 0.2, "other": 0.0}, "with": {}}
P2 = {"name": "Player Two", "team": "AAA", "pos": "C", "log": [r for r in log([0] * 10) if r[1] not in (3, 4)], "share": 0.2,
      "zones": {"rim": 0.8, "short": 0.2, "mid": 0, "corner3": 0, "above3": 0}, "kinds": {"self": 0, "catch": 0, "drive": 1, "other": 0}, "with": {}}
PROPS = {
    "default": "2027",
    "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": {"1": P1, "2": P2},
                         "out": {"AAA": {"3": [["2", "rest"]], "4": [["2", "injury"]]}}}},
    "slate": {},
    "threes_slate": {"900": {
        "1": {"line": 1.5, "proj": 2.03, "w": 0.25, "ours": 2.4, "tries": 6.4, "pct": 0.351, "p_over": 0.571, "p_mkt": 0.524,
              "edge": 0.047, "ladder": [0.84, 0.571, 0.33, 0.16, 0.07], "best_o": 105, "best_u": -110, "games": 10, "out": False,
              "missing": 0, "share": 0.2, "luck": -0.7, "spread": 7.5, "min_ratio": 1.0},
        "2": {"line": 0.5, "proj": 0.6, "w": 0.0, "ours": None, "tries": None, "pct": None, "p_over": 0.45, "p_mkt": 0.45,
              "edge": 0.0, "ladder": [0.45, 0.13, 0.03, 0.01, 0.0], "best_o": 120, "best_u": -150, "games": 0, "out": True,
              "missing": 0, "share": 0.2, "luck": None, "spread": 7.5, "min_ratio": None},
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
DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "injuries": {}, "identity": IDENTITY,
        "teams": {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB")},
        "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                  "props": {"threes": {"1": {"name": "Player One", "q": MAIN},
                                                       "2": {"name": "Player Two", "q": [["draftkings", "o", 0.5, 120, ""]]}},
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


def cells(i):
    return PAGE.evaluate("(i) => [...document.querySelectorAll('#pts-table tbody tr[data-key]')[i].children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim())", i)


class Board(unittest.TestCase):
    def test_rows_draw_with_no_script_errors_and_out_sorts_last(self):
        self.assertEqual(SITE.errors, [])
        keys = PAGE.evaluate("() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')].map((tr) => tr.dataset.key)")
        self.assertEqual(keys, ["900:1", "900:2"])

    def test_play_fair_odds_good_to_and_edge_the_nhl_way(self):
        # Player One: our 57.1% Over. Over's best is +105 (needs 48.8%): +8.3; Under's -110 (needs 52.4%
        # for our 42.9%): worse. So the play is o1.5 at +105.
        c = cells(0)
        self.assertEqual(c[1].upper(), "O1.5 THREES")
        self.assertEqual(c[2], "2.03")
        self.assertEqual(c[3], "-133")  # 57.1% with no cut
        self.assertIn("+105", c[4])
        self.assertIn("FANDUEL", c[4].upper())
        self.assertEqual(c[5], "-118")  # 54.1% (3 points under ours)
        self.assertEqual(c[6], "+8.3")
        self.assertIn("tier-good", PAGE.evaluate("() => document.querySelector('#pts-table tbody tr[data-key] .th-edge').className"))
        # Player Two: only an Over price, and no edge at it: shown, not green
        c2 = cells(1)
        self.assertEqual(c2[1].upper(), "O0.5 THREES")
        self.assertEqual(c2[2], "0.60 No Games Yet")
        self.assertEqual(c2[6], "-0.5")

    def test_tries_and_hit_rates(self):
        c = cells(0)
        self.assertEqual(c[7], "6.4 35% Make")
        # over 1.5 (2+ made): last 5 = 2, 3, 1, 2, 1 -> 3; all 10 -> 3,4,2,2,3,2 = 6; road (home 0) games 1,3,5,7,9 -> 3,4,0,3,2 -> 4
        self.assertEqual(c[8], "60% 3 of 5")
        self.assertEqual(c[9], "60% 6 of 10")
        self.assertEqual(c[11], "80% 4 of 5")
        self.assertEqual(c[14], "6.0 L5 6.0")  # threes tried a game

    def test_two_sided_tags(self):
        tags = cells(0)[15].upper()
        self.assertIn("3S ALLOWED", tags)  # BBB gives up threes and 70% of his shots are threes
        self.assertNotIn("HELP D", tags)  # BBB's catch share is average
        self.assertIn("UNDERDOG +7.5", tags)
        self.assertIn("COLD RUN", tags)
        self.assertNotIn("3S ALLOWED", cells(1)[15].upper())  # a center who doesn't shoot them

    def test_every_tag_one_look(self):
        # the owner, 2026-10-23: Hot Run next to TOUGH 3s D was a different font, size and shape
        looks = PAGE.evaluate("""() => [...document.querySelectorAll('#pts-table tbody tr[data-key]')[0].querySelectorAll('.pts-tags > span')].map((t) => {
            const s = getComputedStyle(t);
            return [s.fontSize, s.fontWeight, s.height, s.borderRadius, s.textTransform, s.fontFamily].join('|');
        })""")
        self.assertGreaterEqual(len(looks), 3)
        self.assertEqual(len(set(looks)), 1, looks)


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
        self.assertTrue(tiles[0].startswith("THREES PROJECTION 1-1"), tiles)
        self.assertIn("1-0", next(t for t in tiles if t.startswith("UNDERDOGS")))
        self.assertIn("1-0", next(t for t in tiles if t.startswith("COLD RUN")))
        self.assertEqual(SITE.errors, [])


class PlayerView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PAGE.click("[data-key='900:1'] .pts-player")
        PAGE.wait_for_selector(".pts-open")

    def test_the_sections(self):
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.pts-view h4')].map((h) => h.firstChild.textContent.trim())")
        self.assertEqual(heads[:3], ["With / Without", "Every Book", "The Ladder"])
        self.assertEqual(heads[3], "Shot Zones: Player One vs BBB Defense")

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
        on = PAGE.evaluate("() => document.querySelector('.pts-view .nba-shot-opt[data-shot-key=\"pts\"].active, .pts-view .nba-shot-opt[data-shot-key=\"pts\"][aria-pressed=\"true\"]')?.dataset.shotValue")
        self.assertEqual(on, "3")
        self.assertEqual(SITE.errors, [])


class Menu(unittest.TestCase):
    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/threes.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
