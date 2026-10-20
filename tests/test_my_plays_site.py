"""My Plays (site/my-plays.js) and the NHL pages' save box (nhl/nhl-common.js),
run in a real browser on the saved NFL and NHL samples.

What is pinned (the owner, 2026-10-20: "a checkbox to all plays across the site",
every sport's plays in one tab by Promo Tools, self-grading, nothing saved before
changing): the NFL list stays where it was and shows up here as it is; an NHL
play saved from a page grades itself from the team's box score (shots, goals,
points, saves, Line Stacks; a player who didn't play is a Void); the sport filter
and the record; a hand result beats the grade; a stack's price can be typed in;
the NHL box saves the play without opening the row; and My Plays is its own
button in the top menu."""
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None
# OTT @ NJD on 2026-10-12, final 4-1 (the NHL sample). NJD's file has:
# 8479996: 0 G, 0 A, 3 SOG; 8480002: 0 G, 0 A, 3 SOG; goalie 8482076: 19 shots, 3 goals (16 saves);
# 8476474 didn't play that night.
GAME = {"date": "2026-10-12", "game_id": "2026020088", "matchup": "OTT @ NJD", "sport": "nhl", "team": "NJD"}
NHL_PLAYS = [
    {**GAME, "id": "nhl:sog:2026020088:8479996", "market": "sog", "category": "Shots on goal", "player_id": "8479996", "side": "over", "line": 2.5, "odds": -120, "description": "A Over 2.5 SOG"},
    {**GAME, "id": "nhl:pts:2026020088:8479996", "market": "pts", "category": "Points", "player_id": "8479996", "side": "over", "line": 0.5, "odds": 110, "description": "A Over 0.5 points"},
    {**GAME, "id": "nhl:saves:2026020088:8482076", "market": "saves", "category": "Saves", "player_id": "8482076", "side": "under", "line": 22.5, "odds": -110, "description": "G Under 22.5 saves"},
    {**GAME, "id": "nhl:goal:2026020088:8476474", "market": "goal", "category": "Anytime goal", "player_id": "8476474", "odds": 300, "description": "C anytime goal"},
    {**GAME, "id": "nhl:stack:2026020088:8479996-8480002", "market": "stack", "category": "Line stack", "player_id": None, "odds": None,
     "description": "A + B (1+ point each)", "legs": [{"id": "8479996", "name": "A", "team": "NJD"}, {"id": "8480002", "name": "B", "team": "NJD"}]},
]
NFL_PLAYS = [
    {"id": "Josh Allen_Anytime TD_99", "week": 99, "matchup": "BUF @ KC", "category": "Anytime TD", "team": "BUF",
     "description": "Josh Allen", "odds": "+200", "book": None, "result": "win", "result_source": "manual"},
]
RESULTS = """() => Object.fromEntries([...loadPossiblePlays(), ...loadNhlPlays()].map((p) => [p.id, p.result || null]))"""


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


def open_my_plays():
    page = SITE.open("my-plays.html")
    page.evaluate("""([nfl, nhl]) => { localStorage.setItem('nfl-tool.possible-plays.v1', JSON.stringify(nfl)); localStorage.setItem('nfl-tool.nhl-plays.v1', JSON.stringify(nhl)); }""", [NFL_PLAYS, NHL_PLAYS])
    page.reload()
    page.wait_for_function("() => loadNhlPlays().some((p) => p.result)")
    page.wait_for_selector(".mp-table")
    return page


class MyPlays(unittest.TestCase):
    def test_nhl_plays_grade_from_the_box_score(self):
        page = open_my_plays()
        try:
            results = page.evaluate(RESULTS)
            self.assertEqual(results["nhl:sog:2026020088:8479996"], "win")  # 3 shots over 2.5
            self.assertEqual(results["nhl:pts:2026020088:8479996"], "loss")  # no points
            self.assertEqual(results["nhl:saves:2026020088:8482076"], "win")  # 16 saves under 22.5
            self.assertEqual(results["nhl:goal:2026020088:8476474"], "void")  # didn't play
            self.assertEqual(results["nhl:stack:2026020088:8479996-8480002"], "loss")
            self.assertEqual(results["Josh Allen_Anytime TD_99"], "win")  # the NFL list, as it was
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])

    def test_sport_filter_record_and_hand_results(self):
        page = open_my_plays()
        try:
            self.assertEqual(page.locator(".mp-table tbody tr").count(), 6)
            page.click('.mp-sport[data-sport="nhl"]')
            self.assertEqual(page.locator(".mp-table tbody tr").count(), 5)
            # 2-2 (the stack has no price yet, so no units for it), the void apart.
            summary = page.inner_text(".mp-summary")
            self.assertIn("2-2-1", summary)
            # A hand result beats the grade; clicking it again gives the grade back.
            sel = '.result-override-btn[data-id="nhl%3Apts%3A2026020088%3A8479996"][data-result="win"]'
            page.click(sel)
            self.assertEqual(page.evaluate(RESULTS)["nhl:pts:2026020088:8479996"], "win")
            page.click(sel)
            self.assertEqual(page.evaluate(RESULTS)["nhl:pts:2026020088:8479996"], "loss")
            # The stack's price, typed in, counts in the units.
            page.fill(".mp-price", "+450")
            page.press(".mp-price", "Enter")
            self.assertEqual(page.evaluate("() => loadNhlPlays().find((p) => p.market === 'stack').odds"), 450)
            # Photo Export: the same card, the NHL plays with their results.
            page.click("#photo-export-btn")
            self.assertTrue(page.is_checked("#pe-show-results"))
            self.assertEqual(page.locator("#plays-export-card .pe-row").count(), 5)
            self.assertEqual(page.locator("#plays-export-card .pe-row-win").count(), 2)
            self.assertIn("NHL", page.inner_text("#plays-export-card .pe-title"))
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])

    def test_my_plays_is_its_own_button(self):
        page = open_my_plays()
        try:
            self.assertEqual(page.evaluate("() => [...document.querySelectorAll('.page-nav .page-nav-current')].map((a) => a.dataset.sport)"), ["mine"])
            self.assertEqual(page.get_attribute(".page-nav .mine-trigger", "href"), "/my-plays.html")
        finally:
            page.close()


class SaveBox(unittest.TestCase):
    def test_the_goals_page_box_saves_the_play_without_opening_the_row(self):
        page = SITE.open("nhl/goals.html")
        try:
            page.wait_for_function("() => typeof GOALS !== 'undefined' && GOALS !== null && !document.getElementById('shots-app').hidden")
            page.evaluate("() => { dayIndex = days().indexOf('2026-10-13'); render(); }")  # tonight in the sample: priced, not started
            page.evaluate("() => localStorage.removeItem('nfl-tool.nhl-plays.v1')")
            box = page.locator(".nhl-play-toggle").first
            row_key = box.evaluate("(b) => b.closest('.shots-row').dataset.row")
            box.click()
            saved = page.evaluate("() => loadNhlPlays()")
            self.assertEqual(len(saved), 1)
            game_id, player_id = row_key.split(":")
            self.assertEqual(saved[0]["id"], f"nhl:goal:{game_id}:{player_id}")
            self.assertEqual((saved[0]["sport"], saved[0]["market"], saved[0]["game_id"]), ("nhl", "goal", game_id))
            self.assertIsNotNone(saved[0]["odds"])
            self.assertEqual(page.evaluate("() => goalsView.open"), None)
            box.click()
            self.assertEqual(page.evaluate("() => loadNhlPlays()"), [])
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
