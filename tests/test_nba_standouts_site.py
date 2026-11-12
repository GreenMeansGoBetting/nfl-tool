"""NBA Slate Standouts (site/nba/standouts.html + standouts.js) on hand-made data.json.

Pinned (the owner, 2026-11-11): every mismatch of a night in one place, by category, Standouts and
Tough Spots. Team rows are Matchup Keys' own keys (keys.js); player rows are his type's results
against tonight's defense over their own averages, at the owner's cutoffs (+2.5 points / +0.7
threes, beat it 55% of the time, 6+ games, and he does the thing himself); Stacked marks a player
and a team spot pointing the same way; a team or a game opens Matchup Keys on that game."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

TEAMS = ["AAA", "BBB", "CCC"]
DAY = "2099-01-10"


def row(o3, d3):
    return {"games": 10, "o_3pm": o3, "d_3pm": d3}


TABLE = {"AAA": row(16, 12), "BBB": row(12, 16), "CCC": row(11, 11)}  # AAA makes the most threes, BBB allows the most


def log(defense, players, pts, m3, n=6):
    return [[f"2099-01-0{1 + i % 8}", defense, p, 20, 2, pts, m3, f"g{i}"] for i in range(n) for p in players][:n]


def player(name, team, t, avg):
    return {"name": name, "team": team, "pos": "SG", "type": t, "lean": t, "fit": 0.2, "border": False, "n": 80,
            "mix": [15, 40, 30, 20, 5, 5, 1, 20, 5, 5, 10], "avg": avg}


SHOT_TYPES = {
    "drawn": "2099-01-01", "fields": [], "min_shots": 50, "border": 0.5, "split": 0.2, "defense": {"teams": {}, "league": {}, "team_games": 1},
    "players": {"1": player("Shooter One", "AAA", "C", [10, 18.0, 2.4]), "2": player("Other C", "CCC", "C", [10, 14.0, 2.0]),
                "3": player("Big Three", "BBB", "K", [10, 15.0, 0.1]), "4": player("Other K", "CCC", "K", [10, 12.0, 0.0]),
                "5": player("Bench Guy", "AAA", "C", [10, 6.0, 0.4]), "6": player("Hurt Guy", "AAA", "C", [10, 20.0, 2.5])},
    "log_fields": ["date", "def", "player", "pts", "m3", "pts_diff", "m3_diff", "game"],
    # type C against BBB: +4 points and +1 three over their own averages in every game; type K against AAA: -4 points
    "log": log("BBB", ["2"], 4.0, 1.0) + log("AAA", ["4"], -4.0, 0.0),
}
DATA = {"season": 2027, "season_label": "2026-27", "players": {}, "shot_types": SHOT_TYPES,
        "injuries": {"AAA": [{"id": "6", "name": "Hurt Guy", "status": "Out"}]},
        "schedule": [{"game_id": "900", "date": DAY, "time": "19:00", "away": "AAA", "home": "BBB", "status": "scheduled"}],
        "league_chart": {"season": TABLE, "10": TABLE},
        "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        # that night's lines (props.json research): Other C's points line in game g0 was 18.5 (he scored 20: Over)
        SITE.nba, SITE.nba_props = DATA, {"default": "2027", "seasons": {}, "research": {"players": {"2": {"lines": {"g0": 18.5, "g1": 22.5}}}}}
        PAGE = SITE.open("nba/standouts.html")
        PAGE.wait_for_selector("#ss-body .ss-grid")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def lists():
    """{Standouts / Tough Spots: [row text]}."""
    return PAGE.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.ss-box')].map((box) =>
        [box.querySelector('.ss-title').textContent, [...box.querySelectorAll('tbody tr[data-game]')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))]))""")


class SlateStandouts(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { ssView.cat = 'all'; ssView.open = ''; ssView.dtab = 'like'; ssView.byGame = false; ssRender(); const m = document.getElementById('mb-who-modal'); if (m) m.hidden = true; }")

    def test_team_rows_are_matchup_keys_edges(self):
        self.assertTrue(any("AAA Offense: Threes" in r for r in lists()["Standouts"]))

    def test_player_rows_read_his_type_against_tonights_defense(self):
        out = lists()
        shooter = [r for r in out["Standouts"] if "Shooter One" in r]
        self.assertEqual(len(shooter), 2)  # points and threes
        self.assertTrue(any("+4.0" in r and "6/6" in r for r in shooter))
        self.assertTrue(any("Big Three" in r and "-4.0" in r for r in out["Tough Spots"]))

    def test_players_come_before_teams_in_each_category(self):
        kinds = PAGE.evaluate("""() => [...document.querySelectorAll('.ss-box')][0].querySelectorAll('tbody tr')""" + """.length && [...[...document.querySelectorAll('.ss-box')][0].querySelectorAll('tbody tr')].map((tr) => tr.classList.contains('ss-cat') ? '|' : tr.classList.contains('ss-p') ? 'p' : 't').join('')""")
        for block in kinds.split('|'):
            self.assertEqual(block, ''.join(sorted(block)), kinds)  # every p before every t

    def test_he_must_do_it_himself_and_be_playing(self):
        text = " ".join(sum(lists().values(), []))
        self.assertNotIn("Bench Guy", text)  # 6 points a game: not a scorer
        self.assertNotIn("Hurt Guy", text)  # Out tonight

    def test_stacked_marks_a_player_spot_beside_a_team_spot(self):
        stacked = PAGE.evaluate("() => [...document.querySelectorAll('.ss-stack')].map((s) => s.closest('tr').innerText.replace(/\\s+/g, ' '))")
        self.assertTrue(any("Shooter One" in r and "Threes" in r for r in stacked))

    def test_the_owners_cutoffs(self):
        self.assertEqual(PAGE.evaluate("() => [SS_PLAYER.points[3], SS_PLAYER.threes[3], SS_HIT_HI, SS_MIN_GAMES]"), [2.5, 0.7, 0.55, 6])

    def test_a_player_tile_opens_players_like_him_with_their_lines(self):
        # the owner, 2026-11-11: "the players in question, what their line was, and what they scored that night"
        PAGE.evaluate("() => { ssView.cat = 'points'; ssView.open = ''; ssView.dtab = 'like'; ssRender(); }")
        PAGE.click(".ss-grid tr.ss-p [data-dd] >> nth=0")
        PAGE.wait_for_selector(".ss-drop .ss-dgrid tbody tr")
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.ss-drop .ss-dgrid tbody tr')].map((tr) => [...tr.cells].map((c) => c.innerText.trim()))")
        lined = [r for r in rows if r[2] != "--"]
        self.assertEqual([r[2:5] for r in lined], [["22.5", "20", "Under"], ["18.5", "20", "Over"]])  # newest first
        self.assertIn("went over their line in 1 of 2", PAGE.inner_text(".ss-drop .ss-dsum"))
        PAGE.click('.ss-dtabs [data-dtab="def"]')
        self.assertIn("bbb vs every type", PAGE.inner_text(".ss-dtabs").lower())
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.ss-drop .ss-dgrid tbody tr').length"), 2)  # +/- and Beat Avg
        PAGE.evaluate("() => { ssView.cat = 'all'; ssView.open = ''; ssView.dtab = 'like'; ssRender(); }")

    def test_a_team_rank_tile_opens_whos_behind_it(self):
        PAGE.click(".ss-grid tr.ss-t [data-who] >> nth=0")
        PAGE.wait_for_selector("#mb-who-modal:not([hidden])")
        self.assertIn("threes: who's behind it", PAGE.inner_text("#mb-who-modal").lower())  # the tile's own topic
        # Allowed By Type beside Allowed By Position (the owner, 2026-11-11): the offense's letters, its shot share
        html = PAGE.evaluate("() => whoTypeBox('BBB', 'AAA', 'scoring', { date: '2099-01-10' })")
        self.assertIn("Allowed By Type", html)
        self.assertIn("+4.0", html)  # type C against BBB: +4 points over their own averages
        self.assertIn("AAA Shots", html)
        PAGE.evaluate("() => { document.getElementById('mb-who-modal').hidden = true; }")

    def test_headliners_keep_the_strongest_player_and_team_spots(self):
        # the owner's pick, 2026-11-12: the night's biggest spots up top; neither kind may crowd the other out
        heroes = PAGE.evaluate("() => [...document.querySelectorAll('.ss-hero-col.ss-more .ss-hero-card')].map((c) => c.innerText.replace(/\\s+/g, ' '))")
        self.assertTrue(any("Shooter One" in h for h in heroes), heroes)
        self.assertTrue(any("AAA Offense" in h for h in heroes), heroes)
        self.assertLessEqual(len(heroes), 3)
        self.assertTrue(PAGE.evaluate("() => document.querySelectorAll('.ss-hero-col.ss-less .ss-hero-card').length") >= 1)

    def test_sort_by_game_shows_every_row_in_its_games_card(self):
        # the owner, 2026-11-12: "for SGP bettors" a Sort By Game toggle switches the lists to game cards
        rows = len(sum(lists().values(), []))
        PAGE.click("#ss-bar [data-bygame]")
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.ss-gcard').length"), 1)
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.ss-gcard .ss-crow').length"), rows)
        self.assertEqual(PAGE.evaluate("() => localStorage.getItem('nba-tool.ss-bygame.v1')"), "1")
        PAGE.click(".ss-gcard .ss-crow.ss-p [data-dd] >> nth=0")  # a player's drop-down opens inside the card
        PAGE.wait_for_selector(".ss-gcard .ss-drop .ss-dtabs")
        PAGE.click("#ss-bar [data-bygame]")
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.ss-gcard').length"), 0)
        self.assertEqual(PAGE.evaluate("() => localStorage.getItem('nba-tool.ss-bygame.v1')"), "0")

    def test_a_team_opens_its_game_on_matchup_keys(self):
        page = SITE.open("nba/standouts.html")  # its own page: the click leaves it
        page.wait_for_selector("#ss-body .ss-grid")
        page.click(".ss-grid tr[data-game] .ss-open >> nth=0")
        page.wait_for_url("**/matchup-keys.html")
        self.assertEqual(page.evaluate("() => localStorage.getItem('nba-tool.game.v1')"), "900")
        page.close()
        self.assertFalse([e for e in SITE.errors if "standouts" in e], SITE.errors)


if __name__ == "__main__":
    unittest.main()
