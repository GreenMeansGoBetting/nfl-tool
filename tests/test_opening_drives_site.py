"""The Opening Drive Tool page (site/opening-drives.js), in a real browser on
the saved sample with hand-made drives (the sample predates the tool).

Pinned (the owner, 2026-10-29): a defense is read from its opponents' first
drives; Fair = the offense and the other team's defense averaged, raw (no
pull toward league average), as an American price; Both Fair multiplies the
two teams' chances; Last N games and the First Half / Full Game samples
change every number; primetime games carry a tag in the schedule strip."""
import unittest

from helpers import site_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = PAGE = None

# (week, team, opponent, outcome): every game listed from both sides.
GAMES = [
    (1, "ATL", "CAR", "punt"), (1, "CAR", "ATL", "punt"), (1, "NO", "TB", "fg"), (1, "TB", "NO", "td"),
    (2, "ATL", "TB", "punt"), (2, "TB", "ATL", "other"), (2, "NO", "CAR", "punt"), (2, "CAR", "NO", "td"),
    (3, "ATL", "NO", "td"), (3, "NO", "ATL", "punt"),
    (4, "ATL", "CAR", "punt"), (4, "CAR", "ATL", "punt"), (4, "NO", "TB", "other"), (4, "TB", "NO", "fg"),
]


def drives():
    teams = {}
    for week, team, opp, out in GAMES:
        gid = f"2026_0{week}_{'_'.join(sorted((team, opp)))}"
        teams.setdefault(team, []).append({"game_id": gid, "week": week, "opp": opp, "home": team < opp, "out": out,
                                           "plays": 3, "yards": 10, "three_out": out == "punt", "received": team < opp,
                                           "half": [1, 1, 1, 1], "game": [1, 1, 1, 1]})
    return {"teams": teams}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("opening-drives.html")
        PAGE.evaluate("() => localStorage.removeItem('nfl-tool.opening-drives-view.v1')")
        PAGE.reload()
        PAGE.wait_for_selector("#od-app:not([hidden])", timeout=20000)
        PAGE.evaluate("(d) => { DATA.opening_drives = d; renderOd(); }", drives())
        PAGE.select_option("#away-select", "ATL")
        PAGE.select_option("#home-select", "NO")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def punt_row():
    return PAGE.evaluate("() => [...document.querySelectorAll('.od-punt-row .od-fair')].map((c) => c.textContent.trim())")


class OpeningDriveTool(unittest.TestCase):
    def setUp(self):
        PAGE.click('#od-toolbar [data-sample="open"]')
        PAGE.select_option("#od-last", "0")

    def test_fair_prices_average_offense_and_the_other_defense(self):
        # ATL punts 3/4, NO's opponents punted 0/4: 37.5% = +167.
        # NO punts 2/4, ATL's opponents punted 3/4: 62.5% = -167. Both: 23.4% = +327.
        self.assertEqual(punt_row(), ["+167", "-167", "+327"])

    def test_last_games_filter(self):
        PAGE.select_option("#od-last", "3")
        # ATL 2/3, NO's opponents 0/3: 33.3% = +200.
        self.assertEqual(punt_row()[0], "+200")

    def test_full_game_sample(self):
        PAGE.click('#od-toolbar [data-sample="game"]')
        self.assertEqual(punt_row()[:2], ["+300", "+300"])
        self.assertIn("Full Game", PAGE.text_content(".od-all thead"))

    def test_all_teams_table_and_sort(self):
        names = PAGE.evaluate("() => [...document.querySelectorAll('.od-all tbody tr .od-team b')].map((b) => b.textContent)")
        self.assertEqual(names[0], "ATL")  # most punts first
        self.assertEqual(sorted(names), ["ATL", "CAR", "NO", "TB"])
        PAGE.click('.od-all th[data-sort="team"]')
        names = PAGE.evaluate("() => [...document.querySelectorAll('.od-all tbody tr .od-team b')].map((b) => b.textContent)")
        self.assertEqual(names, ["ATL", "CAR", "NO", "TB"])

    def test_primetime_tag(self):
        tagged = PAGE.evaluate("""() => [...document.querySelectorAll('#matchup-row .matchup-card')].map((c) => {
            const g = DATA.schedule.find((x) => x.week === scheduleWeek && x.away === c.dataset.away && x.home === c.dataset.home);
            return [!!c.querySelector('.od-prime'), g.weekday !== 'Sunday' || g.time >= '19:00'];
        })""")
        self.assertTrue(any(t for t, _ in tagged))
        self.assertTrue(all(t == prime for t, prime in tagged))

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
