"""NBA Dunk Digest (site/nba/dunk-digest.html + dunk-digest.js) on the Slate Standouts test's data.

Pinned (the owner, 2026-11-18): the night game by game in tip order, each game top to bottom: Matchup
Summary, both Edges side by side, Both Teams, Player Types, its Standouts, its Tough Spots under them, Narrative.
Owner only for now. Every box stays clickable, and nothing on the Narrative is made up."""
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402
from test_nba_standouts_site import DATA as STANDOUTS_DATA, DAY  # noqa: E402

DATA = copy.deepcopy(STANDOUTS_DATA)
# a later game listed first: the page goes by tip time
DATA["schedule"] = [{"game_id": "901", "date": DAY, "time": "21:00", "away": "CCC", "home": "BBB", "status": "scheduled"}] + DATA["schedule"]
DATA["book_odds"] = {"AAA_BBB": {"props": {"points": {"1": {"q": [["draftkings", "o", 18.5, -110, ""], ["draftkings", "u", 18.5, -110, ""]]}}}}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, {"default": "2027", "seasons": {}, "research": {"players": {}}}
        PAGE = SITE.open("nba/dunk-digest.html")
        PAGE.wait_for_selector("#dd-body .dd-game")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


FIRST = '.dd-game[data-game="900"]'


class DunkDigest(unittest.TestCase):
    def test_games_run_in_tip_order(self):
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.dd-game')].map((g) => g.dataset.game)"), ["900", "901"])
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.dd-rg')].map((g) => g.dataset.rail)"), ["900", "901"])

    def test_each_game_reads_top_to_bottom(self):
        tops = PAGE.evaluate("""(g) => ['.mks-card', '.dd-edges', '.mk-both', '.mk-types', '.dd-ss', '.dd-story']
            .map((s) => document.querySelector(`${g} ${s}`).getBoundingClientRect().top)""", FIRST)
        self.assertEqual(tops, sorted(tops))

    def boxes(self, selector):
        return PAGE.evaluate("([g, s]) => [...document.querySelectorAll(`${g} ${s}`)].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, text: b.innerText }; })", [FIRST, selector])

    def test_edges_sit_side_by_side(self):
        left, right = self.boxes(".dd-edges > .mk-edges")
        self.assertLess(left["left"], right["left"])
        self.assertEqual(left["top"], right["top"])

    def test_tough_spots_stack_under_standouts_at_full_width(self):
        # the owner, 2026-11-18: "stacked good first then bad and take up the width"
        good, bad = self.boxes(".dd-ss > .ss-gcard")
        self.assertIn("STANDOUTS", good["text"].upper())
        self.assertIn("TOUGH SPOTS", bad["text"].upper())
        self.assertLessEqual(good["bottom"], bad["top"])
        whole = self.boxes(".dd-ss")[0]
        self.assertAlmostEqual(good["width"], whole["width"], delta=1)
        self.assertAlmostEqual(bad["width"], whole["width"], delta=1)

    def test_every_team_number_box_has_a_title(self):
        # the owner, 2026-11-18: "its not clear what these are"
        titles = PAGE.evaluate("(g) => [...document.querySelector(`${g} .dd-nums`).querySelectorAll('.dd-num > span')].map((s) => s.textContent)", FIRST)
        self.assertEqual(titles, ["Net Rating", "Avg Margin", "Avg Total", "Points Per Game", "ATS Record", "O/U Record", "Transition Pts", "Ball Movement"])

    def test_standouts_are_this_games_own(self):
        self.assertIn("Shooter One", PAGE.inner_text(f"{FIRST} .dd-ss"))
        self.assertNotIn("Shooter One", PAGE.inner_text('.dd-game[data-game="901"] .dd-ss'))

    def test_narrative_shows_no_made_up_stories(self):
        self.assertEqual(PAGE.evaluate("(g) => [...document.querySelectorAll(`${g} .dd-tale span`)].map((s) => s.textContent)", FIRST), ["No Data Yet"] * 3)

    def test_narrative_shows_the_saved_stories(self):
        # the owner, 2026-11-18: real storylines; Out players off, an empty spot says so, no data stays "No Data Yet"
        who = {"id": "1", "name": "Shooter One", "pos": "SG", "team": "AAA"}
        benched = {"id": "77", "name": "Sits Tonight", "pos": "C", "team": "AAA"}
        data = copy.deepcopy(DATA)
        data["injuries"] = {**(data.get("injuries") or {}), "AAA": [{"id": "77", "name": "Sits Tonight", "status": "Out"}]}
        data["narrative"] = {"games": {"900": {
            "revenge": [{**who, "opp": "BBB", "gp": 212, "span": "2022-23 To 2025-26", "ago": "Last Season", "tag": "First Game Back"}, {**benched, "opp": "BBB", "gp": 90, "span": "2025-26", "tag": None}],
            "hometown": [{**benched, "place": "Akron, OH", "school": None}],
            "college": [{**who, "school": "Duke", "years": "2019-2020", "place": "Durham, North Carolina"}]}}}
        SITE.nba = data
        page = SITE.open("nba/dunk-digest.html")
        try:
            page.wait_for_selector(f"{FIRST} .dd-tale-on")
            tales = page.locator(f"{FIRST} .dd-tale")
            revenge = tales.nth(0).inner_text()
            for text in ("Shooter One", "212 Games", "2022-23 To 2025-26", "Last Season", "First Game Back"):
                self.assertIn(text, revenge)
            self.assertNotIn("Sits Tonight", revenge)
            self.assertIn("None Tonight", tales.nth(1).inner_text())  # his only story, and he's Out
            self.assertIn("Duke", tales.nth(2).inner_text())
            self.assertEqual(page.locator(f"{FIRST} .dd-story .player-click").count(), 2)
            self.assertEqual(page.evaluate("() => [...document.querySelectorAll('.dd-game[data-game=\"901\"] .dd-tale span')].map((s) => s.textContent)"), ["No Data Yet"] * 3)
        finally:
            page.close()
            SITE.nba = DATA

    def test_a_matchup_tile_opens_whos_behind_it(self):
        PAGE.click(f"{FIRST} .mks-grid [data-who] >> nth=0")
        PAGE.wait_for_selector("#mb-who-modal:not([hidden])")
        PAGE.evaluate("() => { document.getElementById('mb-who-modal').hidden = true; }")

    def test_a_standouts_drop_down_keeps_the_page_in_place(self):
        PAGE.evaluate("(g) => document.querySelector(`${g} .dd-ss`).scrollIntoView()", FIRST)
        before = PAGE.evaluate("() => scrollY")
        PAGE.click(f"{FIRST} .dd-ss [data-dd] >> nth=0")
        PAGE.wait_for_selector(f"{FIRST} .ss-drop .ss-dtabs")
        self.assertEqual(PAGE.evaluate("() => scrollY"), before)
        self.assertEqual(PAGE.locator(".mks-card").count(), 2)  # only the Standouts boxes were redrawn
        PAGE.click(f"{FIRST} .dd-ss [data-dd] >> nth=0")

    def test_a_players_line_opens_every_book(self):
        PAGE.click(f'{FIRST} .dd-ss [data-ss-line="1|points|900"]')
        PAGE.wait_for_function("() => /draftkings/i.test(document.body.innerText)")
        PAGE.keyboard.press("Escape")

    def test_only_the_owner_sees_it(self):
        page = SITE.open("nba/dunk-digest.html")
        page.wait_for_selector("#dd-body .dd-game")
        seen = "() => [getComputedStyle(document.querySelector('.dd-wrap')).display, getComputedStyle(document.querySelector('.dd-locked')).display]"
        self.assertNotEqual(page.evaluate(seen)[0], "none")
        self.assertEqual(page.evaluate(seen)[1], "none")
        page.evaluate("() => document.documentElement.classList.remove('local-dev')")  # a member's view
        self.assertEqual(page.evaluate(seen)[0], "none")
        self.assertNotEqual(page.evaluate(seen)[1], "none")
        pill = page.evaluate("() => getComputedStyle(document.querySelector('a.nav-pill[href$=\"dunk-digest.html\"]')).display")
        self.assertEqual(pill, "none")
        page.close()

    def test_no_script_errors(self):
        self.assertFalse([e for e in SITE.errors if "digest" in e or "standouts" in e or "matchup-keys" in e], SITE.errors)


if __name__ == "__main__":
    unittest.main()
