"""The NBA Player Types page (site/nba/types.html + types.js) on hand-made data.json.

Pinned (the owner, 2026-11-11): types are letters on rainbow badges (A red ... K purple), a
borderline player shows two letters, filtering to a type lists its own players first and then the
ones only leaning into it, names open the player card, and Defense Vs Type ranks from the
defense's side (30th = allows the most = red) with thin samples faded and unranked."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

TEAMS = ["AAA", "BBB", "CCC"]
MIX = [15.0, 40, 30, 20, 5, 5, 1, 20, 5, 5, 10]


def player(name, team, t, lean, border, n=80, mix=MIX):
    return {"name": name, "team": team, "pos": "SG", "type": t, "lean": lean, "fit": 0.6 if border else 0.2, "border": border, "n": n, "mix": mix}


SHOT_TYPES = {
    "drawn": "2026-11-11", "stability": {"players": 3, "same": 0.5, "same_or_lean": 0.9}, "moved": None,
    "fields": ["dist", "three", "catch", "pullup", "fade", "float", "post", "drive", "cut", "lob", "fast"],
    "min_shots": 50, "border": 0.5, "split": 0.2,
    "players": {"1": player("Deep Guy", "AAA", "A", "B", False, 120), "2": player("Edge Guy", "BBB", "B", "A", True),
                "3": player("Big Guy", "CCC", "K", "J", False, 60, [4.0, 5, 8, 1, 2, 8, 7, 13, 30, 30, 9])},
    "defense": {"team_games": 30, "league": {"A": [300, 120, 300, 60], "K": [90, 60, 120, 0]},
                "teams": {"AAA": {"games": 10, "vs": {"A": [100, 30, 80, 10], "K": [10, 5, 10, 0]}},
                          "BBB": {"games": 10, "vs": {"A": [100, 45, 120, 20]}},
                          "CCC": {"games": 10, "vs": {"A": [100, 45, 100, 15]}}}},
}
DATA = {"season": 2027, "season_label": "2026-27", "players": {}, "schedule": [], "shot_types": SHOT_TYPES,
        "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, {"default": "2027", "seasons": {}}
        PAGE = SITE.open("nba/types.html#players")
        PAGE.wait_for_selector("#pt-body table")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def names():
    return PAGE.evaluate("() => [...document.querySelectorAll('#pt-body td.pt-name .player-click')].map((e) => e.textContent)")


class Players(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { ptView.type = ''; ptView.sort = 'type'; ptView.dir = 1; ptSetTab('players'); }")

    def test_every_player_with_letters_and_a_borderline_pair(self):
        self.assertEqual(sorted(names()), ["Big Guy", "Deep Guy", "Edge Guy"])
        edge = PAGE.evaluate("() => [...document.querySelectorAll('#pt-body tr')].find((tr) => tr.textContent.includes('Edge Guy')).querySelectorAll('.pt-letter').length")
        self.assertEqual(edge, 2)

    def test_letters_are_a_rainbow_from_red_to_purple(self):
        self.assertEqual(PAGE.evaluate("() => [ptHue('A'), ptHue('K')]"), [0, 280])

    def test_filtering_to_a_type_lists_its_own_players_then_the_leaners(self):
        PAGE.evaluate("() => { ptView.type = 'A'; ptView.sort = 'n'; ptSetTab('players'); }")
        self.assertEqual(names(), ["Deep Guy", "Edge Guy"])
        PAGE.evaluate("() => { ptView.type = ''; ptRender(); }")

    def test_a_name_opens_the_player_card(self):
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('#pt-body .player-click[data-nba-player=\"1\"]')"))


class DefenseVsType(unittest.TestCase):
    def test_ranked_from_the_defense_side_and_thin_samples_faded(self):
        PAGE.evaluate("() => { ptView.stat = 'pts'; ptSetTab('defense'); }")
        cells = PAGE.evaluate("""() => [...document.querySelectorAll('#pt-body tbody tr')].slice(1).map((tr) =>
            [...tr.querySelectorAll('.pt-tile')].map((t) => [t.textContent, t.classList.contains('pt-thin'), t.getAttribute('title')]))""")
        a = [row[0] for row in cells]  # AAA, BBB, CCC against type A
        self.assertEqual([x[0] for x in a], ["8.0", "12.0", "10.0"])
        self.assertIn("1st-least of 3", a[0][2])  # allows the fewest
        self.assertIn("3rd-least of 3", a[1][2])  # allows the most: 30th of 30 on a full league
        self.assertTrue(cells[0][1][1])  # AAA vs K: 10 shots, faded
        self.assertFalse(SITE.errors, SITE.errors)


if __name__ == "__main__":
    unittest.main()
