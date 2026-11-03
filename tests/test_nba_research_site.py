"""The NBA prop research pages (site/nba/points / threes / rebounds / assists .html on research.js,
2026-11-03) on hand-made data.

The owner, 2026-11-03: projections on incomplete info (rest days, late scratches, a team going in
with six players) aren't fair to members, so the NBA side is research: "click into betting
categories, like assists and rebounds, and get information and data that relates to those
categories and see available bets and lines". What is pinned: no model anywhere on the page (no
Edge, Fair, Rating, projection, plays or record); each player with a line shows the main line, the
best Over / Under across the member's books, his average and minutes, hit rates over tonight's line
("x of y"), what tonight's defense allows his position (with its rank), and his numbers in the games
each teammate on tonight's injury report missed, colored only at 3+ games; Every Player adds the
rotation players with no line; each page reads its own stat; the menu lists the four under Prop
Research and the retired pages forward."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

FIELDS = ["date", "game", "opp", "home", "min", "pts", "fg3m", "reb", "ast"]
DAY = "2099-01-01"  # always ahead of today, so it is the slate the page opens on
GAME = {"game_id": "900", "date": DAY, "time": "19:30", "start_utc": f"{DAY}T23:30Z", "away": "AAA", "home": "BBB", "status": "scheduled",
        "home_team_spread": -3.5, "total_line": 225.0}


def log(rows):
    return [[f"2026-10-{20 + i:02d}", str(g), opp, i % 2, mins, pts, 2, reb, ast] for i, (g, opp, mins, pts, reb, ast) in enumerate(rows)]


# Player One (AAA, PG): 15 points in the 3 games Player Two played, 25 in the 3 he sat.
ONE = log([(1, "CCC", 34, 15, 4, 6), (2, "CCC", 34, 15, 4, 6), (3, "CCC", 34, 15, 4, 6),
           (4, "CCC", 36, 25, 6, 9), (5, "CCC", 36, 25, 6, 9), (6, "CCC", 36, 25, 6, 9)])
TWO = log([(1, "CCC", 31, 20, 10, 2), (2, "CCC", 31, 20, 10, 2), (3, "CCC", 31, 20, 10, 2)])
# Player Three (AAA, SG): sat games 5 and 6 only (2 games: a Small Sample, never colored)
THREE = log([(1, "CCC", 28, 12, 3, 3), (2, "CCC", 28, 12, 3, 3), (3, "CCC", 28, 12, 3, 3), (4, "CCC", 28, 12, 3, 3)])
# a PG who faced BBB twice (30 and 14 points: BBB allows 22 a game to PGs, the most)
FOUR = log([(7, "BBB", 33, 30, 4, 7), (8, "BBB", 33, 14, 4, 7)])
# a bench forward on AAA with no line (Every Player only)
FIVE = log([(1, "CCC", 22, 8, 5, 1), (2, "CCC", 22, 8, 5, 1)])
PROPS = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": {
    "1": {"name": "Player One", "team": "AAA", "pos": "PG", "log": ONE},
    "2": {"name": "Player Two", "team": "AAA", "pos": "C", "log": TWO},
    "3": {"name": "Player Three", "team": "AAA", "pos": "SG", "log": THREE},
    "4": {"name": "Player Four", "team": "CCC", "pos": "PG", "log": FOUR},
    "5": {"name": "Player Five", "team": "AAA", "pos": "SF", "log": FIVE},
}, "out": {"AAA": {"4": [["2", "injury"]], "5": [["2", "injury"], ["3", "rest"]], "6": [["2", "injury"], ["3", "rest"]]}}}},
    # the research panel (research.py): One's game 4 line was 19.5; Two set up 5 of his 20 makes
    "research": {"players": {"1": {"q": [30, 30, 30, 30], "trans": [12, 120], "units": [40, 30, 160, 90], "feed": [20, [["2", 5], ["3", 2]]],
                                   "rot": [6] * 12 + [3] * 12 + [6] * 12 + [4] * 12, "rot5": [5] * 48, "rotn": [6, 5], "q4": [4, 40.0, 2, 12.0],
                                   "foul": ["2"], "lines": {"4": 19.5}, "pz": [30, 10, 60, 20]}},
                 "teams": {"BBB": [50, 60, 150, 160]},
                 # BBB vs PGs: [threes, mid, paint, FT points, makes, assisted, transition, points, shots]; every shot against BBB
                 "defpos": {"BBB": {"PG": [18, 2, 16, 8, 16, 10, 6, 44, 30]}, "CCC": {"PG": [9, 6, 20, 5, 15, 7, 4, 40, 33]}}, "deffga": {"BBB": 100, "CCC": 110}, "games": {str(g): [100.0 + g, 220.0 + g, -4.5] for g in range(1, 7)}, "spots": {}}}
PROPS["seasons"]["2027"]["players"]["1"]["with"] = {"2": [60.0, 30, 25, 150.0, 100, 70], "3": [100.0, 50, 40, 110.0, 80, 55]}


def quotes(line, over_dk=-110, over_fd=100):
    return [["draftkings", "o", line, over_dk, ""], ["fanduel", "o", line, over_fd, ""], ["draftkings", "u", line, -110, ""], ["fanduel", "u", line, -125, ""]]


DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "identity": None, "generated_at": "2026-11-03T18:00:00Z",
        "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB", "CCC")},
        "injuries": {"AAA": [{"id": "2", "name": "Player Two", "status": "Out"}, {"id": "3", "name": "Player Three", "status": "Questionable"},
                             {"id": "1", "name": "Player One", "status": "Day-To-Day"}]},
        "book_odds": {"AAA_BBB": {"props": {"points": {"1": {"name": "Player One", "q": quotes(20.5)}},
                                            "rebounds": {"1": {"name": "Player One", "q": quotes(4.5)}}}}}}


def setUpModule():
    global SITE
    SITE = SiteBrowser()
    SITE.nba, SITE.nba_props = DATA, PROPS


def tearDownModule():
    if SITE:
        SITE.close()


def rows(page):
    return page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim()))")


def head(page):
    return page.evaluate("() => [...document.querySelectorAll('#rs-list thead tr:last-child th')].map((th) => th.textContent.replace(/[\\u25b4\\u25be]/g, '').trim())")


class Points(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    def test_no_model_on_the_page(self):
        self.assertEqual(SITE.errors, [])
        self.assertEqual(head(self.page), ["Player", "Line", "Over", "Under", "Avg", "Min", "L5", "L10", "Season", "Home", "Away", "Opp Allows", "Teammates On The Report"])
        text = self.page.inner_text("main")
        for word in ("Edge", "Fair", "Rating", "Strong", "Projection", "Plays Only", "Model Performance", "10,000"):
            self.assertNotIn(word, text)

    def test_the_row(self):
        [one] = rows(self.page)
        self.assertIn("Player One", one[0])
        self.assertIn("DTD", one[0])  # his own injury report status
        self.assertEqual(one[1], "20.5")
        self.assertIn("+100", one[2])  # the best Over across the books (FanDuel)
        self.assertIn("-110", one[3])  # the best Under
        self.assertEqual(one[4], "20.0 L5 21.0")  # 15, 15, 15, 25, 25, 25 / the last 5
        self.assertEqual(one[5], "35.0 L5 35.2")
        self.assertEqual(one[6:9], ["60% 3 of 5", "50% 3 of 6", "50% 3 of 6"])
        self.assertEqual(one[11], "22.0 1st · PG")  # BBB: 30 + 14 to PGs in 2 games, the most

    def test_teammates_on_the_report(self):
        pills = self.page.evaluate("() => [...document.querySelectorAll('#rs-list .sim-rtag')].map((t) => [t.textContent, t.className])")
        two, three = pills
        self.assertEqual(two[0], "No Two: 25.0 (+10.0) · 3 G")  # Out: 25 without him, 15 with
        self.assertIn("good", two[1])
        self.assertTrue(three[0].startswith("If No Three: 25.0"))  # Questionable: the games he sat
        self.assertIn("· 2 G", three[0])
        self.assertNotIn("good", three[1])  # 2 games: too few to color
        self.assertIn("rs-maybe", three[1])

    def test_every_player_adds_the_rotation(self):
        self.page.click("[data-list-every='true']")
        names = [r[0] for r in rows(self.page)]
        self.assertTrue(any("Player Five" in n for n in names))
        self.assertFalse(any("Player Two" in n for n in names))  # Out tonight: not listed
        self.assertIn("No Line", [r[1] for r in rows(self.page) if "Player Five" in r[0]][0])
        self.page.click("[data-list-every='false']")
        self.assertEqual(len(rows(self.page)), 1)

    def test_the_name_opens_the_player_card(self):
        self.page.click("#rs-list .player-click[data-nba-player='1']")
        self.page.wait_for_selector("#player-card-modal:not([hidden]) .pc-name")
        self.page.keyboard.press("Escape")
        self.assertEqual(SITE.errors, [])


class Panel(unittest.TestCase):
    """Clicking a Points row (not its name or a price) opens the research dashboard under it."""
    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    def open(self):
        if self.page.locator("#rs-list .rs-panel").count():
            return
        self.page.click("#rs-list tr.rs-click td.rs-line")
        self.page.wait_for_selector("#rs-list .rs-panel")

    def test_the_tiles(self):
        self.open()
        titles = self.page.evaluate("() => [...document.querySelectorAll('.rs-tile h4 > span:first-child')].map((h) => h.textContent.trim())")
        self.assertEqual(titles, ["Rotation", "Points Vs The Line", "Recent Form", "How He Scores", "Teammates On The Floor", "Matchup Angles", "Tonight's Game Script"])
        # every grid is the League Stats Chart's (colored bands over filled tiles)
        self.assertGreater(self.page.locator(".rs-panel table.od-grid .od-ggroups").count(), 6)
        # his 6 games against tonight's 20.5: 3 over (the 25s), 3 under; game 4's line (19.5) a dot he cleared
        self.assertEqual(self.page.locator(".rs-bar.over").count(), 3)
        self.assertEqual(self.page.locator(".rs-bar.under").count(), 3)
        self.assertEqual(self.page.locator(".rs-then-dot.hit").count(), 1)
        self.assertEqual(self.page.locator(".rs-then-t").first.text_content(), "19.5")
        # teammates: most minutes together first, F. Last names, his points a 36 with / without, Two's assists
        mates = self.page.evaluate("""() => { const t = [...document.querySelectorAll('.rs-tile')].find((s) => s.textContent.startsWith('Teammates'));
            return [...t.querySelectorAll('tr:not(.od-ggroups):not(.od-glabels)')].map((tr) => [...tr.children].filter((c) => !c.classList.contains('od-ggap')).map((c) => c.innerText.trim())); }""")
        self.assertTrue(mates[0][0].startswith("P. Three"), mates)
        self.assertTrue(mates[1][0].startswith("P. Two"), mates)
        self.assertEqual(mates[1][2:5], ["15.0", "16.8", "+1.8"])  # shots first: 25 in 60 min, 70 in 150 min
        self.assertEqual(mates[1][5:8], ["18.0", "24.0", "+6.0"])  # then points: 30 in 60 min, 100 in 150 min
        colored = self.page.evaluate("() => [...document.querySelectorAll('.rs-panel tr.rs-out .od-tile')].map((t) => Boolean(t.getAttribute('style')))")
        self.assertEqual(colored[1:3], [True, True])  # With AND Without both colored, never one side only
        self.assertEqual(mates[1][-1], "5")
        self.assertEqual(self.page.locator(".rs-panel tr.rs-out").count(), 1)  # Two is Out tonight
        # the rotation strip: 48 minutes, a game count in every hover
        self.assertEqual(self.page.locator(".rs-rot-row:first-child .rs-rot i").count(), 48)
        self.assertIn("6 of 6 games", self.page.get_attribute(".rs-rot-row:first-child .rs-rot i", "title"))
        self.assertEqual(SITE.errors, [])
        text = self.page.inner_text(".rs-panel")
        for word in ("Edge", "Fair", "Projection", "Model"):
            self.assertNotIn(word, text)

    def test_game_script_ranges_and_the_defense_columns(self):
        self.open()
        script = self.page.evaluate("""() => { const t = [...document.querySelectorAll('.rs-tile')].find((s) => s.textContent.startsWith("Tonight's Game Script"));
            return [...t.querySelectorAll('table.rs-grid > tbody > tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim())); }""")
        labels = [r[0] for r in script]
        # One is on the road: +3.5 tonight, his games within 5 either way; the total 225 +- 5
        self.assertEqual(labels[:3], ["All His Games", "Spread -1.5 To +8.5", "Total 220.0 To 230.0"])
        self.assertEqual(script[1][1], "3")  # his road games had +4.5 (home games -4.5: 8 away)
        self.assertEqual(script[2][1], "6")
        self.assertIn("+3.5", self.page.inner_text(".rs-now"))
        self.assertIn("DEF VS PGS", self.page.inner_text(".rs-panel").upper())

    def test_how_he_scores_beside_the_defense(self):
        self.open()
        tile = "[...document.querySelectorAll('.rs-tile')].find((s) => s.textContent.startsWith('How He Scores'))"
        rows = self.page.evaluate(f"() => [...{tile}.querySelectorAll('table.rs-grid > tbody > tr')].map((tr) => [...tr.children].filter((c) => !c.classList.contains('od-ggap')).map((c) => c.innerText.replace(/\s+/g, ' ').trim()))")
        self.assertEqual(rows[0][0], "Shot Share")
        self.assertTrue(rows[0][3].startswith("30%"), rows)  # BBB: 30 of the 100 shots against them by PGs
        self.assertTrue(rows[1][3].startswith("63%"), rows)  # 10 of 16 PG makes assisted
        # where his points come from: two bars, his and BBB's, the four parts named inside, on the scale
        bars = self.page.evaluate(f"() => [...{tile}.querySelectorAll('.rs-bar-row .rs-stack')].map((b) => [...b.children].map((p) => [p.textContent, Boolean(p.style.background)]))")
        self.assertEqual([t for t, _ in bars[0]], ["3PT 25%", "MID 8%", "PAINT 50%", "FT 17%"])  # 30 / 10 / 60 / 20 of 120
        self.assertEqual([t for t, _ in bars[1]], ["3PT 41%", "", "PAINT 36%", "FT 18%"])  # 18 / 2 / 16 / 8 of 44 (5%: too thin for text, hover only)
        self.assertTrue(all(c for _, c in bars[1]))  # the defense's parts colored by rank

    def test_matchup_angles_allowed_or_rank(self):
        self.open()
        self.page.click("[data-rs-rank='true']")
        self.assertIn("of", self.page.inner_text(".rs-panel .rs-toggle >> xpath=../.."))
        self.page.click("[data-rs-rank='false']")
        self.assertEqual(SITE.errors, [])

    def test_click_again_closes_and_the_name_still_opens_the_card(self):
        self.open()
        self.page.click("#rs-list tr.rs-click td.rs-line")
        self.assertEqual(self.page.locator("#rs-list .rs-panel").count(), 0)
        self.page.click("#rs-list tr.rs-click .player-click")
        self.page.wait_for_selector("#player-card-modal:not([hidden]) .pc-name")
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.locator("#rs-list .rs-panel").count(), 0)

    def test_other_markets_have_no_panel_yet(self):
        page = SITE.open("nba/rebounds.html")
        page.wait_for_selector("#rs-list tr.sim-row")
        self.assertEqual(page.locator("#rs-list tr.rs-click").count(), 0)


class OtherMarkets(unittest.TestCase):
    def test_rebounds_reads_rebounds(self):
        page = SITE.open("nba/rebounds.html")
        page.wait_for_selector("#rs-list tr.sim-row")
        [one] = rows(page)
        self.assertEqual(one[1], "4.5")
        self.assertEqual(one[4], "5.0 L5 5.2")  # 4, 4, 4, 6, 6, 6
        self.assertIn("REBOUNDS RESEARCH", page.inner_text(".rs-intro").upper())
        self.assertEqual(SITE.errors, [])

    def test_no_line_yet(self):
        page = SITE.open("nba/assists.html")
        page.wait_for_selector("#rs-list .sim-noplay")
        self.assertIn("haven't posted", page.inner_text("#rs-list"))
        self.assertEqual(SITE.errors, [])


class Pages(unittest.TestCase):
    def test_four_tabs_and_the_retired_pages_forward(self):
        site = ROOT / "nfl_tool" / "site" / "nba"
        for name in ("points", "threes", "rebounds", "assists"):
            html = (site / f"{name}.html").read_text(encoding="utf-8")
            self.assertIn(f'data-market="{name}"', html)
            self.assertIn('<script src="research.js"></script>', html)
            self.assertNotIn("best.html", html)
        self.assertIn("url=points.html", (site / "best.html").read_text(encoding="utf-8"))
        self.assertIn("url=league.html", (site / "game-predictions.html").read_text(encoding="utf-8"))
        for gone in ("sim-board.js", "predict-view.js", "best.js", "game-predictions.js"):
            self.assertFalse((site / gone).exists(), gone)


if __name__ == "__main__":
    unittest.main()
