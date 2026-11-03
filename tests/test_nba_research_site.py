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
    "1": {"name": "Player One", "team": "AAA", "pos": "PG", "num": "7", "log": ONE},
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
        self.assertEqual(head(self.page), ["Player", "Line", "Over", "Under", "Avg", "Min", "L5", "L10", "Season", "Home", "Away", "Opp Allows", "Pace", "Spread", "Total", "Teammates On The Report"])
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
        self.assertEqual(one[13], "+3.5 AAA")  # tonight's game: his team's spread (on the road, BBB -3.5)
        self.assertEqual(one[14], "225.0 O/U")
        self.assertRegex(self.page.inner_text("#rs-list .rs-price"), r"(FD|DK)")  # two-letter book codes

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
    """Clicking a Points row (not its name or a price) opens the research panel under it: two boxes
    of the same size, each with tabs, every tab the same grid (a header row, six rows, a label and
    seven columns: the owner approved it 2026-11-03)."""
    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    def open(self):
        if self.page.locator("#rs-list .rs-panel").count():
            return
        self.page.click("#rs-list tr.rs-click td.rs-line")
        self.page.wait_for_selector("#rs-list .rs-panel")

    def tab(self, side, name):
        self.open()
        self.page.click(f"[data-rs-tab='{side}:{name}']")
        box = f".rs-sb[data-side='{side}']"
        self.page.wait_for_selector(f"{box} button.on:text-is('{name}')")
        return box

    def cells(self, box):
        """Every row of the box's grid as its tiles' text (the header row first)."""
        return self.page.evaluate(f"""() => {{ const g = document.querySelector("{box} .rs-g"); const kids = [...g.children]; const rows = []; let row = [], used = 0;
            const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
            for (const k of kids) {{ const span = k.classList.contains('rs-s7') ? 7 : k.classList.contains('rs-s3') ? 3 : k.classList.contains('rs-s2') ? 2 : 1;
              row.push(k.textContent.replace(/\\s+/g, ' ').trim()); used += span; if (used >= cols) {{ rows.push(row); row = []; used = 0; }} }} return rows; }}""")

    def test_two_boxes_every_tab_the_same_shape(self):
        self.open()
        tabs = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb')].map((b) => [...b.querySelectorAll('.rs-tabs button')].map((t) => t.textContent))")
        self.assertEqual(tabs, [["Form", "Scoring", "Matchup", "Game Script"], ["Vs The Line", "Rotation", "Teammates"]])
        sizes = set()
        for side, names in (("left", tabs[0]), ("right", tabs[1])):
            for name in names:
                box = self.tab(side, name)
                sizes.add(tuple(self.page.evaluate(f"() => {{ const b = document.querySelector(\"{box}\").getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }}")))
                if name == "Rotation":
                    self.assertEqual(len(self.cells(box)), 4)  # the quarter headers + three tall strips
                elif name != "Vs The Line":
                    self.assertEqual(len(self.cells(box)), 7, name)  # a header row + six rows, always
        self.assertEqual(len(sizes), 1, sizes)  # every tab the same box
        self.assertEqual(SITE.errors, [])
        text = self.page.inner_text(".rs-panel")
        for word in ("Edge", "Fair", "Projection", "Model"):
            self.assertNotIn(word, text)

    def test_vs_the_line(self):
        self.tab("right", "Vs The Line")
        # his 6 games against tonight's 20.5: 3 over (the 25s), 3 under; game 4's line (19.5) a dot he cleared
        self.assertEqual(self.page.locator(".rs-vbar.over").count(), 3)
        self.assertEqual(self.page.locator(".rs-vbar.under").count(), 3)
        self.assertEqual(self.page.locator(".rs-vdot.hit").count(), 1)
        self.assertEqual(self.page.locator(".rs-vdot em").first.text_content(), "19.5")
        # a slot a day: his six straight days, no OFF / OUT between them, and no strip under the chart
        self.assertEqual(self.page.locator(".rs-vx span").count(), 6)
        self.assertEqual(self.page.locator(".rs-vday").count(), 0)
        self.assertEqual(self.page.locator(".rs-vfoot").count(), 0)

    def test_teammates(self):
        rows = self.cells(self.tab("right", "Teammates"))
        self.assertEqual(rows[0][1:], ["Together", "Shots With", "Shots W/O", "Pts With", "Pts W/O", "Change", "Assists"])
        self.assertTrue(rows[1][0].startswith("P. Three"), rows)  # most minutes together first
        self.assertTrue(rows[2][0].startswith("P. Two"), rows)
        self.assertEqual(rows[2][2:8], ["15.0", "16.8", "18.0", "24.0", "+6.0", "5"])  # 25 / 70 shots and 30 / 100 points in 60 / 150 min
        colored = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb[data-side=right] .rs-g > .rs-t:not(.rs-h):not(.rs-l):not(.rs-corner)')].slice(7, 14).map((t) => Boolean(t.getAttribute('style')))")
        self.assertEqual(colored[1:5], [True, True, True, True])  # With AND Without both colored, never one side only
        self.assertEqual(self.page.locator(".rs-sb[data-side=right] .rs-l.rs-out").count(), 1)  # Two is Out tonight

    def test_rotation(self):
        box = self.tab("right", "Rotation")
        self.assertEqual(self.page.locator(f"{box} .rs-strip").first.locator("i").count(), 48)
        self.assertIn("6 of 6 games", self.page.get_attribute(f"{box} .rs-strip i", "title"))
        # his points by quarter ride in the quarter headers (30 a quarter over 6 games = 5.0)
        self.assertEqual(self.page.locator(f"{box} .rs-qt").first.text_content(), "1st Qtr5.0 Pts")
        self.assertNotIn("Close", self.page.inner_text(box))

    def test_game_script_ranges(self):
        rows = self.cells(self.tab("left", "Game Script"))
        labels = [r[0] for r in rows[1:]]
        # One is on the road: +3.5 tonight, his games within 5 either way; the total 225 +- 5
        self.assertEqual(labels[:5], ["All Games", "Spread +3.5", "Total 225.0", "Road Games", "Last 10"])  # no schedule spots
        self.assertEqual(rows[2][1], "3")  # his road games had +4.5 (home games -4.5: 8 away)
        self.assertEqual(rows[3][1], "6")
        self.assertEqual(rows[0][1:4], ["Games", "PTS", "+/-"])

    def test_matchup(self):
        rows = self.cells(self.tab("left", "Matchup"))
        self.assertEqual(rows[0][1:], ["7", "Rank", "Allows", "Rank", "Read"])  # no average columns
        self.assertEqual([len(r) for r in rows], [6] * 7)  # a header + six rows of a label and five tiles

    def test_scoring_beside_the_defense(self):
        rows = self.cells(self.tab("left", "Scoring"))
        self.assertEqual(rows[0][1:], ["Share", "Rank", "Pts / G", "Allowed", "Rank", "Pts / G", "Read"])
        self.assertEqual([r[0] for r in rows[1:]], ["Shot Share", "Assisted", "Threes", "Mid-Range", "Paint", "Free Throws"])
        self.assertEqual(rows[1][4], "30%")  # BBB: 30 of the 100 shots against them by PGs
        self.assertEqual(rows[2][4], "63%")  # 10 of 16 PG makes assisted
        self.assertEqual(rows[3][1], "25%")  # his points: 30 of 120 from threes

    def test_form_beside_the_defense(self):
        box = self.tab("left", "Form")
        rows = self.cells(box)
        self.assertEqual(rows[0][1:], ["Season", "L10", "L5", "+/-", "Season", "L5", "+/-"])
        self.assertEqual(self.page.inner_text(f"{box} .rs-corner .rs-jersey"), "7")  # the key: his jersey number
        self.assertIn("vs PGs", rows[0][0])  # ... and the defense vs his position
        self.assertEqual(rows[1][:2], ["PTS", "20.0"])
        # L10 / L5 colored against HIS season: 6 games, so his L10 is his season = a plain tile;
        # his L5 (21.0) up 5% on his 20.0 gets a color; MIN L5 35.2 vs 35.0 (under 1%) stays plain
        tiles = self.page.evaluate(f"() => [...document.querySelectorAll(\"{box} .rs-g > .rs-t\")].slice(9, 12).map((t) => t.getAttribute('style'))")
        self.assertIsNone(tiles[1])
        self.assertIsNotNone(tiles[2])
        mins = self.page.evaluate(f"() => [...document.querySelectorAll(\"{box} .rs-g > .rs-t\")][19].getAttribute('style')")
        self.assertIsNone(mins)
        self.assertEqual(self.page.locator(f"{box} .rs-band").count(), 2)  # him / the defense shaded
        self.assertEqual(rows[1][5], "22.0")  # BBB allow PGs 22 a game
        self.assertEqual(rows[2][5:], ["--", "--", "--"])  # minutes: his only

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
