"""Past days on the NHL prop pages (the owner, 2026-11-03: "go back to or pick
any date that has already happened to see how those performed").

The build turns each page's record into nhl/past_<market>.json (build_nhl.past_file):
every priced row, filed by today's rules, biggest edge first. The pages
(nhl-common.js nhlRenderPast) add those days to the day arrows and the date
picker; a day the live board still has is drawn as before.

What is pinned: the build files a row the way the page and the record do
(goals_play / shots_play), leaves out unpriced rows, keeps a push; a page
steps back to a past day, shows Plays Only first and Every Player on the
switch, grades each row (W / L / P and units), filters one game from the
strip, jumps there from the date box; Best Plays lists every market's plays."""
import json
import tempfile
import unittest
from pathlib import Path

from helpers import nhl_game  # first: puts the build's folders on the import path

import build_nhl
from site_browser import SiteBrowser

PAST_DAY = "2026-10-10"  # before the saved sample's schedule
LIVE_DAY = "2026-10-13"


class Build(unittest.TestCase):
    def write(self, folder, cols, games):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "2026-10.json").write_text(json.dumps({"cols": cols, "games": games}), encoding="utf-8")

    def test_goals_rows_are_filed_by_the_pages_rule(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            row = lambda pid, chance, odds, actual, move=None: [pid, f"P{pid}", "NJD", chance, 0.4, odds, odds, False, None, actual, move, None, None]
            self.write(folder, build_nhl.GOALS_RECORD_COLS, {"g1": {"date": PAST_DAY, "away": "NJD", "home": "DET", "plays": [
                row("1", 0.30, 300, 0), row("2", 0.45, 200, 1), row("3", 0.40, None, 1), row("4", 0.45, 200, 0, "down")]}})
            blob = build_nhl.past_file("goals", folder, build_nhl.GOALS_RECORD_COLS)
        self.assertEqual(blob["games"], {"g1": ["NJD", "DET"]})
        rows = [dict(zip(blob["cols"], r)) for r in blob["days"][PAST_DAY]]
        self.assertEqual([r["id"] for r in rows], ["2", "4", "1"], "biggest edge first; no price = left out")
        for r in rows:
            self.assertEqual(r["size"], build_nhl.goals_play(r["chance"], r["price"], "down" if r["id"] == "4" else None)["size"])
        self.assertEqual(rows[1]["size"], "check", "moved down a line is set apart, as on the page")
        self.assertEqual((rows[0]["side"], rows[0]["line"], rows[0]["actual"]), ("yes", 0.5, 1))

    def test_shots_keeps_a_push_and_takes_the_better_side(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            row = lambda pid, line, over, under, chance_over, actual: [pid, f"P{pid}", "NJD", line, over, under, 2.0, chance_over, actual, 2.0, None]
            self.write(folder, build_nhl.SHOTS_RECORD_COLS, {"g1": {"date": PAST_DAY, "away": "NJD", "home": "DET", "plays": [
                row("1", 2.5, -110, -110, 0.62, 3), row("2", 1.5, -150, 120, 0.40, 2), row("3", 2.0, -110, -110, 0.5, 2)]}})
            blob = build_nhl.past_file("shots", folder, build_nhl.SHOTS_RECORD_COLS)
        rows = {r[1]: dict(zip(blob["cols"], r)) for r in blob["days"][PAST_DAY]}
        self.assertEqual(set(rows), {"1", "2", "3"}, "a push is still shown")
        self.assertEqual((rows["1"]["side"], rows["1"]["size"]), ("over", "play"))
        self.assertEqual(rows["2"]["side"], "under")
        self.assertAlmostEqual(rows["2"]["chance"], 0.6)

    def test_a_damaged_record_costs_only_its_own_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad, good, site = Path(tmp) / "bad", Path(tmp) / "good", Path(tmp) / "site"
            bad.mkdir()
            (bad / "2026-10.json").write_text("{not json", encoding="utf-8")
            site.mkdir()
            build_nhl.write_past_files(site, {"shots": (bad, build_nhl.SHOTS_RECORD_COLS), "saves": (good, build_nhl.SAVES_RECORD_COLS)})
            self.assertIn("error", json.loads((site / "past_shots.json").read_text()))
            self.assertEqual(json.loads((site / "past_saves.json").read_text())["days"], {})


def past_blob(rows):
    return {"cols": list(build_nhl.PAST_COLS), "games": {"g1": ["NJD", "DET"], "g2": ["BOS", "TOR"]}, "days": {PAST_DAY: rows}}


GOALS_PAST = past_blob([
    ["g1", "1", "Alpha One", "NJD", 0.5, "yes", 200, 0.42, 0.087, "lean", 1],
    ["g2", "5", "Echo Five", "BOS", 0.5, "yes", 300, 0.40, 0.15, "check", 0],
    ["g1", "2", "Bravo Two", "DET", 0.5, "yes", 150, 0.30, -0.1, "none", 0],
])
SHOTS_PAST = past_blob([
    ["g2", "3", "Charlie Three", "TOR", 2.5, "under", 120, 0.55, 0.095, "play", 2],
    ["g2", "4", "Delta Four", "BOS", 2.0, "over", -110, 0.5, -0.024, "none", 2],
])

SITE = None
ROWS = """() => [...document.querySelectorAll('#shots-content .nhl-past-row, #best-content .nhl-past-row')].map((tr) => {
  const heads = [...tr.closest('table').querySelectorAll('thead th')].map((th) => ((th.childNodes[0] || {}).textContent || '').trim());
  const cell = (label) => tr.children[heads.indexOf(label)].textContent.trim().replace(/\\s+/g, ' ');
  return { name: tr.querySelector('.player-click, b').textContent.trim(), play: cell('Play'), rating: cell('Rating'), result: cell('Result'), units: cell('Units'),
           market: heads.includes('Market') ? cell('Market') : null };
})"""


def setUpModule():
    global SITE
    SITE = SiteBrowser()
    SITE.nhl_past = {"goals": GOALS_PAST, "shots": SHOTS_PAST}


def tearDownModule():
    if SITE:
        SITE.close()


def open_page(path):
    page = SITE.open(path)
    page.wait_for_function(f"() => days().includes('{PAST_DAY}')", timeout=20000)
    return page


def go(page, day, **view):
    page.evaluate("([day, view]) => { Object.assign(nhlPastView, { every: false, minEdge: 'all' }, view); gameId = null; selectDay(days().indexOf(day)); }", [day, view])
    return page.evaluate(ROWS)


class Pages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.goals = open_page("nhl/goals.html")

    def test_the_arrows_reach_a_day_the_live_board_no_longer_has(self):
        self.assertEqual(self.goals.evaluate("() => days()[0]"), PAST_DAY)
        rows = go(self.goals, PAST_DAY)
        self.assertEqual([r["name"] for r in rows], ["Alpha One", "Echo Five"], "plays, then Check First; no-edge rows hidden")
        self.assertIn("Final", self.goals.inner_text("#matchup-row"))
        self.assertEqual(self.goals.evaluate("() => document.getElementById('day-prev').disabled"), True)

    def test_every_player_adds_the_rest_and_each_row_is_graded(self):
        rows = {r["name"]: r for r in go(self.goals, PAST_DAY, every=True)}
        self.assertEqual(set(rows), {"Alpha One", "Bravo Two", "Echo Five"})
        self.assertEqual((rows["Alpha One"]["rating"], rows["Alpha One"]["result"], rows["Alpha One"]["units"]), ("Lean", "W 1", "+2.00"))
        self.assertEqual((rows["Bravo Two"]["result"], rows["Bravo Two"]["units"]), ("L 0", "-1.00"))
        self.assertEqual(rows["Echo Five"]["rating"], "Check")
        self.assertIn("Yes", rows["Alpha One"]["play"])

    def test_the_switch_and_menu_redraw_the_past_day(self):
        go(self.goals, PAST_DAY)
        self.goals.click("#shots-toolbar [data-past='every'][data-value='true']")
        self.assertEqual(len(self.goals.evaluate(ROWS)), 3)
        self.goals.select_option("#shots-toolbar .nhl-past-select", "10")
        self.assertEqual([r["name"] for r in self.goals.evaluate(ROWS)], ["Echo Five"])

    def test_a_game_card_shows_only_that_game(self):
        go(self.goals, PAST_DAY, every=True)
        self.goals.click("#matchup-row .matchup-card[data-game='g1']")
        self.assertEqual({r["name"] for r in self.goals.evaluate(ROWS)}, {"Alpha One", "Bravo Two"})

    def test_the_date_box_jumps_to_a_day(self):
        go(self.goals, LIVE_DAY)
        self.assertTrue(self.goals.evaluate("() => document.querySelectorAll('.shots-row').length > 0"), "a live day draws the live table")
        # 10-11 had no games: the closest day before it.
        self.goals.evaluate("() => { const box = document.querySelector('#schedule-scroller .nhl-day-pick'); box.value = '2026-10-11'; box.dispatchEvent(new Event('change')); }")
        self.assertEqual(self.goals.evaluate("() => days()[dayIndex]"), PAST_DAY)
        self.assertEqual(len(self.goals.evaluate(ROWS)), 2)

    def test_shots_grades_an_under(self):
        page = open_page("nhl/shots.html")
        rows = go(page, PAST_DAY, every=True)
        page.close()
        self.assertEqual(rows[0]["name"], "Charlie Three")
        self.assertEqual((rows[0]["play"], rows[0]["rating"], rows[0]["result"]), ("u2.5+120", "Play", "W 2"))
        self.assertEqual(rows[1]["result"], "P 2", "a push")

    def test_best_plays_lists_every_markets_plays(self):
        page = open_page("nhl/best.html")
        rows = go(page, PAST_DAY)
        toggles = page.evaluate("() => document.querySelectorAll(\"#best-toolbar [data-past='every']\").length")
        page.close()
        self.assertEqual([(r["name"], r["market"]) for r in rows], [("Charlie Three", "Shots"), ("Alpha One", "Goals"), ("Echo Five", "Goals")])
        self.assertEqual(toggles, 0, "Best Plays is plays only")

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
