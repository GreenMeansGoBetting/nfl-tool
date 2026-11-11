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
import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
from site_browser import SiteBrowser  # noqa: E402
import zone_matchups  # noqa: E402
from helpers import SAMPLE_BUILT_UTC  # noqa: E402

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
PROPS["seasons"]["2027"]["players"]["1"]["share"] = 0.28  # his share of AAA's shots on the floor (props.py)
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
    return page.evaluate("() => [...document.querySelectorAll('#rs-list thead tr:last-child th')].map((th) => th.innerHTML.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/[\\u25b4\\u25be]/g, '').trim())")


class Points(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    def test_no_model_on_the_page(self):
        self.assertEqual(SITE.errors, [])
        self.assertEqual(head(self.page), ["Player", "Line", "Over", "Under", "Avg", "Min", "Volume", "Last Game", "L5", "L10", "Season", "Home", "Away", "Opp Allows", "Type Matchup", "O", "U", "Pace", "Spread", "Total", "Teammates On The Report"])
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
        # the owner, 2026-11-04: no last-5 line under Avg / Min (cluttered); Volume = his shot share
        self.assertEqual(one[4], "20.0")  # 15, 15, 15, 25, 25, 25
        self.assertEqual(one[5], "35.0")
        self.assertEqual(one[6], "28%")
        # a member, 2026-11-09: his last game and its gap from his average (25 vs 20)
        self.assertEqual(one[7], "25 +5.0")
        self.assertEqual(one[8:11], ["60% 3 of 5", "50% 3 of 6", "50% 3 of 6"])
        # defenses ranked from the defense (the owner, 2026-11-06: "bad defense is red"): the most = last of 2, red
        self.assertEqual(one[13], "22.0 2nd · PG")  # BBB: 30 + 14 to PGs in 2 games, the most
        self.assertEqual(one[14], "--")  # Type Matchup: no Player Types in this sample
        self.assertEqual(one[18], "+3.5 AAA")  # tonight's game: his team's spread (on the road, BBB -3.5)
        self.assertEqual(one[19], "225.0 O/U")
        self.assertRegex(self.page.inner_text("#rs-list .rs-price"), r"(FD|DK)")  # two-letter book codes

    def test_the_line_is_the_books_main_line(self):
        # 2026-11-06: the page took the middle of every line listed, so the exchanges' side lines made
        # Holiday's threes 3.5 at +400 (main line 2.5). The page, the card and the build share one rule.
        from test_nba_research import HOLIDAY_THREES, SION_JAMES_POINTS
        page = self.page
        got = page.evaluate("""(q) => {
            const row = DATA.book_odds.AAA_BBB.props.points["1"], keep = row.q;
            row.q = q;
            try { return mainLine({ away: "AAA", home: "BBB" }, "1"); } finally { row.q = keep; }
        }""", HOLIDAY_THREES)
        self.assertEqual(got, 2.5)
        samples = [HOLIDAY_THREES, SION_JAMES_POINTS, quotes(20.5), quotes(20.5) + quotes(21.5)[:2], [["novig", "o", 3.5, 400, ""]], []]
        self.assertEqual(page.evaluate("(all) => all.map((q) => nbaCardMainLine(q))", samples), [zone_matchups.main_line(q) for q in samples])

    def test_a_price_in_the_popup_saves_the_play(self):
        # The owner, 2026-11-04: no check box in the row; a price in the every-book popup saves it at that price.
        page = self.page
        self.assertEqual(page.locator("#rs-list input[type=checkbox]").count(), 0)
        plays = "() => JSON.parse(localStorage.getItem('nfl-tool.nba-plays.v1') || '[]').map((p) => [p.side, p.line, p.book, p.odds])"
        try:
            page.click("#rs-list tr.sim-row td.rs-price >> nth=0 >> .bo-pill")
            page.wait_for_selector("#book-odds-modal:not([hidden]) .bo-save")
            page.click("#book-odds-modal .bo-save:has-text('+100')")
            self.assertEqual(page.evaluate(plays), [["over", 20.5, "fanduel", 100]])
            self.assertIn("saved", page.inner_text("#book-odds-modal .bo-saved").lower())
            # the Under tab saves the Under: the same play switches sides
            page.click("#book-odds-modal .bo-tab:not(.bo-on)")
            page.click("#book-odds-modal .bo-save:has-text('-110')")
            self.assertEqual(page.evaluate(plays), [["under", 20.5, "draftkings", -110]])
            page.keyboard.press("Escape")
            marks = page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row td.rs-price')].map((td) => !!td.querySelector('.rs-saved'))")
            self.assertEqual(marks, [False, True])
        finally:
            page.evaluate("() => { localStorage.removeItem('nfl-tool.nba-plays.v1'); const m = document.getElementById('book-odds-modal'); if (m) m.hidden = true; renderList(); }")
        self.assertEqual(SITE.errors, [])

    def test_an_alt_line_marks_the_row(self):
        # A member, 2026-11-09: an alt line saved from the card's ladder left no mark on the prop page.
        page = self.page
        try:
            page.evaluate("""() => {
                const g = DATA.schedule.find((x) => x.away === 'AAA' && x.home === 'BBB');
                const e = nbaCardEntry('points', g, { id: '1', name: 'Player One', team: 'AAA' }, 'o', 24.5, ['fanduel', null, null, 180], true);
                localStorage.setItem('nfl-tool.nba-plays.v1', JSON.stringify([e]));
                renderList();
            }""")
            marks = page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row td.rs-price')].map((td) => td.querySelector('.rs-saved-alt') ? td.querySelector('.rs-saved-alt').title : '')")
            self.assertIn("Over 24.5", marks[0])
            self.assertEqual(marks[1], "")  # the Under side stays clear
        finally:
            page.evaluate("() => { localStorage.removeItem('nfl-tool.nba-plays.v1'); renderList(); }")
        self.assertEqual(SITE.errors, [])

    def test_reads_count_every_read_in_the_panel(self):
        # The owner, 2026-11-04: O and U columns right of Opp Allows, "x/y" with the letter as the header,
        # colored by the share; every player on a page out of the same number (every Read tile on it).
        page = self.page
        self.assertEqual(page.evaluate("() => document.querySelector('#rs-list .rs-readgroup').textContent"), "Reads")
        o, u = page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row td.rs-read')].map((td) => td.textContent)")
        try:
            page.click("#rs-list tr.sim-row td.rs-line")  # opens his panel
            page.wait_for_selector("#rs-list .rs-panel")
            seen = {"Over": 0, "Under": 0, "all": 0}
            for tab in ("Form", "Scoring", "Matchup"):
                page.click(f"#rs-list [data-rs-tab='left:{tab}']")
                tiles = page.evaluate("() => { const g = [...document.querySelectorAll('#rs-list .rs-sb[data-side=left] .rs-t')].map((t) => t.textContent.trim()); const w = g.indexOf('Read') + 1; const out = []; for (let i = w; i + w <= g.length; i += w) out.push([g[i], g[i + w - 1]]); return out; }")
                for label, read in tiles:
                    if label and not (tab == "Form" and label == "MIN"):  # minutes has no defense side: never a read
                        seen["all"] += 1
                        seen[read] = seen.get(read, 0) + 1
            self.assertEqual(seen["all"], 17)
            self.assertEqual([o, u], [f"{seen['Over']}/17", f"{seen['Under']}/17"])
        finally:
            page.evaluate("() => { OPEN = null; renderList(); }")
        # sorting on O puts the biggest share first
        self.assertIn("ro", page.evaluate("() => Object.keys(SORTS)"))
        self.assertEqual(SITE.errors, [])

    def test_the_name_sits_over_his_position_and_logos(self):
        # The owner, 2026-11-04: the name column was too wide; the name on top, position / status / logos
        # under it, long names cut with "..." (full name on hover), the row height unchanged.
        got = self.page.evaluate("""() => { const c = document.querySelector('#rs-list tr.sim-row .rs-pl-txt');
            const sub = c.querySelector('.rs-pl-sub');
            return [c.title, sub.textContent.includes('PG'), sub.querySelectorAll('.sim-vs').length, !!sub.querySelector('.rs-inj, [class*=status]') || sub.textContent.includes('DTD'),
                    getComputedStyle(c.querySelector('.player-click')).textOverflow, c.querySelector('.player-click').getBoundingClientRect().bottom <= sub.getBoundingClientRect().top + 1]; }""")
        self.assertEqual(got, ["Player One", True, 1, True, "ellipsis", True])

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
        self.assertEqual(tabs, [["Form", "Scoring", "Matchup", "Game Script"], ["Vs The Line", "Rotation", "Teammates", "Type Matchup", "Shot Fit"]])
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
        # the owner, 2026-11-04: a Read where the +/- columns were (him 3 / defense 3 / read, like Scoring)
        self.assertEqual(rows[0][1:], ["Season", "L10", "L5", "Season", "L10", "L5", "Read"])
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
        self.assertEqual(self.page.locator(f"{box} .rs-band").count(), 3)  # him / the defense / the read shaded
        self.assertEqual(rows[1][4:7], ["22.0", "22.0", "22.0"])  # BBB allow PGs 22 a game (2 games: every window)
        self.assertEqual(rows[2][4:], ["--", "--", "--", "--"])  # minutes: his only, so no read
        self.assertIn("no defense side", self.page.get_attribute(f"{box} .rs-g > .rs-t:nth-child(24)", "title"))

    def test_click_again_closes_and_the_name_still_opens_the_card(self):
        self.open()
        self.page.click("#rs-list tr.rs-click td.rs-line")
        self.assertEqual(self.page.locator("#rs-list .rs-panel").count(), 0)
        self.page.click("#rs-list tr.rs-click .player-click")
        self.page.wait_for_selector("#player-card-modal:not([hidden]) .pc-name")
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.locator("#rs-list .rs-panel").count(), 0)


def threes_props():
    """The same slate with threes in every log (fga, fg3a added after the first fields) and Player
    One's threes data for the Threes panel (research.py `t3`, `q3`, `feed3`, `w3`, `lines3`, `def3`)."""
    import copy
    props = copy.deepcopy(PROPS)
    block = props["seasons"]["2027"]
    block["fields"] = FIELDS + ["fga", "fg3a"]
    made, tried = [0, 1, 2, 3, 4, 2], [5, 6, 7, 8, 9, 6]  # One: 12 of 41
    for pid, p in block["players"].items():
        for i, r in enumerate(p["log"]):
            if pid == "1":
                r[6] = made[i]
            r += [15, tried[i] if pid == "1" else 5]
    rs = props["research"]
    rs["players"]["1"].update({
        "t3": [6, 20, 3, 10, 1, 5, 2, 6, 1, 4, 12, 41], "q3": [2, 8, 3, 9, 4, 10, 3, 14], "feed3": [12, [["2", 4]]],
        "w3": {"2": [6, 20, 6, 21], "3": [5, 15, 7, 26]}, "lines3": {"4": 2.5}})
    # BBB vs PGs: 30 of their 40 threes catch-and-shoot (75%, the most); CCC 20 of 30
    rs["def3"] = {"BBB": {"PG": [10, 30, 2, 6, 1, 3, 3, 8, 2, 5, 14, 40]}, "CCC": {"PG": [6, 20, 2, 5, 1, 2, 1, 3, 1, 2, 9, 30]}}
    return props


# One's three threes (two made) and Four's (a PG) threes against BBB: one made of two, and a two
SHOTS = {"teams": ["AAA", "BBB", "CCC"], "league": [[25, 25, 1, 35, 100], [10, 20, 1, 36, 100]],
         "players": {"1": [[25, 26, 1, 1, 0, 0, 2, 0, 2], [10, 22, 1, 1, 1, 0, 1, 0, 2], [40, 22, 0, 1, 2, 0, 2, 0, 2]],
                     "4": [[25, 27, 1, 1, 0, 0, 2, 2, 1], [5, 3, 0, 1, 1, 0, 2, 2, 1], [25, 5, 1, 0, 1, 0, 3, 2, 1]]}}


class Threes(unittest.TestCase):
    """The Threes page's panel (the owner, 2026-11-04): Form (3PM, 3PA, 3P%, 3PA Rate: no FGA, no
    minutes), Shooting (how he gets his threes), Shot Map (his threes and his position's against
    tonight's defense), Game Script (3PA and 3P% for minutes and shots), Vs The Line (makes / tries
    on the bars, a night with none a red chip), Ladder (how often he hit each number, around
    tonight's line), Rotation (threes made and tried a quarter) and Teammates (threes with /
    without). Every tab the same box. The list's Min column is 3PA."""
    @classmethod
    def setUpClass(cls):
        cls.saved = (SITE.nba, SITE.nba_props, SITE.nba_shots)
        data = dict(DATA)
        data["book_odds"] = {"AAA_BBB": {"props": {"threes": {"1": {"name": "Player One", "q": quotes(2.5)}}}}}
        SITE.nba, SITE.nba_props, SITE.nba_shots = data, threes_props(), SHOTS
        cls.page = SITE.open("nba/threes.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")
        cls.page.click("#rs-list tr.rs-click td.rs-line")
        cls.page.wait_for_selector("#rs-list .rs-panel")

    @classmethod
    def tearDownClass(cls):
        SITE.nba, SITE.nba_props, SITE.nba_shots = cls.saved

    tab = Panel.tab
    cells = Panel.cells
    open = Panel.open

    def test_the_list_shows_threes_tried(self):
        self.assertEqual(head(self.page)[4:7], ["Avg", "3PA", "Volume"])
        [one] = rows(self.page)
        self.assertEqual(one[4:7], ["2.0", "6.8", "46%"])  # 12 made, 41 tried in 6 games; 41 of his 90 shots threes

    def test_eight_tabs_every_one_the_same_box(self):
        tabs = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb')].map((b) => [...b.querySelectorAll('.rs-tabs button')].map((t) => t.textContent))")
        self.assertEqual(tabs, [["Form", "Shooting", "Shot Map", "Game Script"], ["Vs The Line", "Ladder", "Rotation", "Teammates", "Type Matchup", "Shot Fit"]])
        sizes = set()
        for side, names in (("left", tabs[0]), ("right", tabs[1])):
            for name in names:
                box = self.tab(side, name)
                sizes.add(tuple(self.page.evaluate(f"() => {{ const b = document.querySelector(\"{box}\"); const s = b.querySelector('.rs-sbody'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), s.scrollHeight <= s.clientHeight + 1]; }}")))
        self.assertEqual(sizes, {(600, 312, True)})  # every tab the same box, nothing spilling out
        self.assertEqual(SITE.errors, [])
        text = self.page.inner_text(".rs-panel")
        for word in ("Edge", "Fair", "Projection", "Model"):
            self.assertNotIn(word, text)

    def test_form(self):
        rows = self.cells(self.tab("left", "Form"))
        self.assertEqual([r[0] for r in rows[1:]], ["3PM", "3PA", "3P%", "3PA Rate"])  # four rows grow to fill the box
        self.assertEqual(rows[1][1], "2.0")
        self.assertEqual(rows[3][1], "29")  # 12 of 41
        self.assertEqual(rows[4][1], "46")  # 41 of 90 shots

    def test_shooting(self):
        rows = self.cells(self.tab("left", "Shooting"))
        self.assertEqual(rows[0][1:], ["Share", "Rank", "3PM / G", "Allowed", "Rank", "3PM / G", "Read"])
        self.assertEqual([r[0] for r in rows[1:]], ["Catch & Shoot", "Pull-Up", "Step-Back", "Transition", "Second Chance"])
        self.assertEqual(rows[1][1], "49%")  # 20 of his 41
        self.assertEqual(rows[1][3], "1.0")  # 6 made in 6 games
        self.assertEqual(rows[1][4:6], ["75%", "2nd"])  # BBB: 30 of 40, the most = last of 2 (ranked from the defense)
        # the owner, 2026-11-06 (LAL 4th-most catch-and-shoot threes allowed showed green): "bad defense is
        # red". The defense's tiles are drawn from the defense; his own stay green = good for him.
        styles = self.page.evaluate("""() => { const g = document.querySelector(".rs-sb[data-side='left'] .rs-g");
            const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length; const row = [...g.children].slice(cols, 2 * cols);
            return { def: [4, 5, 6].map((i) => row[i].getAttribute('style')), red: stepStyle(-1), read: row[7].textContent.trim() }; }""")
        self.assertEqual(styles["def"], [styles["red"]] * 3, styles)
        self.assertNotEqual(styles["read"], "Under")  # the read still takes the defense giving up the most as good for him
        # the read in betting words (the owner, 2026-11-04): Over / Under / Even, never More / Fewer
        self.assertTrue({r[7] for r in rows[1:]} <= {"Over", "Under", "Even", "--"}, rows)

    def test_shot_map(self):
        box = self.tab("left", "Shot Map")
        heads = self.page.evaluate(f"() => [...document.querySelectorAll(\"{box} .rs-maph\")].map((h) => h.textContent.replace(/\\s+/g, ' ').trim())")
        self.assertEqual(heads, ["7His Threes2/367%", "Allowed To PGs1/250%"])  # threes only: Four's two against BBB is left out
        self.assertEqual(self.page.locator(f"{box} svg.nba-shot-svg").count(), 2)
        self.assertGreater(self.page.locator(f"{box} .nba-shot-hex").count(), 2)
        # the defense's map is drawn as a defense (red = more makes against them), so the key shows both
        # scales; it stays one line inside the box
        keys = self.page.evaluate(f"""() => [...document.querySelectorAll("{box} .rs-map-key")].map((k) => ({{ text: k.textContent, fits: k.scrollWidth <= k.clientWidth, h: Math.round(k.getBoundingClientRect().height),
            right: getComputedStyle(k.querySelectorAll('path')[4]).fill }}))""")
        self.assertEqual([k["text"] for k in keys], ["ColderHotter", "Fewer MakesMore Makes"])
        self.assertTrue(all(k["fits"] and k["h"] < 24 for k in keys), keys)  # one line each
        self.assertNotEqual(keys[0]["right"], keys[1]["right"], keys)  # his right end green, the defense's red

    def test_game_script(self):
        rows = self.cells(self.tab("left", "Game Script"))
        self.assertEqual(rows[0][1:], ["Games", "3PM", "+/-", "3PA", "3P%", "Over 2.5", "Hit %"])
        self.assertEqual(rows[1][1:7], ["6", "2.0", "--", "6.8", "29", "2 of 6"])

    def test_vs_the_line(self):
        box = self.tab("right", "Vs The Line")
        bars = self.page.evaluate(f"() => [...document.querySelectorAll(\"{box} .rs-vbar b\")].map((b) => b.textContent)")
        self.assertEqual(bars, ["1/6", "2/7", "3/8", "4/9", "2/6"])  # makes / tries
        self.assertEqual(self.page.inner_text(f"{box} .rs-vday.zero"), "0/5")  # a night with none
        self.assertEqual(self.page.locator(f"{box} .rs-vbar.over").count(), 2)  # over 2.5: the 3 and the 4
        self.assertEqual(self.page.locator(f"{box} .rs-vdot.hit").count(), 1)  # game 4's line 2.5: he made 3

    def test_ladder(self):
        box = self.tab("right", "Ladder")
        rows = self.cells(box)
        self.assertEqual(rows[0][1:], ["None", "1+", "2+", "3+", "4+", "5+", "6+"])
        self.assertIn("rs-rd", self.page.get_attribute(f"{box} .rs-h[title^=\"Tonight's Over\"]", "class"))
        self.assertEqual(self.page.locator(f"{box} .rs-h.rs-rd").count(), 1)  # 3+ = tonight's Over 2.5
        self.assertTrue(rows[1][0].startswith("Season"))
        self.assertEqual(rows[1][1:5], ["17%", "83%", "67%", "33%"])  # 0, 1, 2, 3, 4, 2
        labels = [r[0] for r in rows[1:]]
        for label, start in zip(labels, ["Season", "Last 10", "Last 5", "Road", "Spread +3.5", "Vs Like BBB"]):
            self.assertTrue(label.startswith(start), labels)
        self.assertEqual(len(labels), 6)

    def test_rotation(self):
        box = self.tab("right", "Rotation")
        # 2 of 8 in the 1st over 6 games
        self.assertEqual(self.page.locator(f"{box} .rs-qt").first.text_content(), "1st Qtr0.3 3PM · 1.3 3PA")

    def test_teammates(self):
        rows = self.cells(self.tab("right", "Teammates"))
        self.assertEqual(rows[0][1:], ["Together", "3PA With", "3PA W/O", "3PM With", "3PM W/O", "Change", "Assists"])
        two = next(r for r in rows if r[0].startswith("P. Two"))
        self.assertEqual(two[2:8], ["12.0", "5.0", "3.6", "1.4", "−2.2", "4"])  # 20 / 21 tries, 6 / 6 makes in 60 / 150 min


def rebounds_props():
    """The same slate with defensive / offensive rebounds in every log and Player One's rebounding
    data for the Rebounds panel (research.py `rb`, `rz`, `qr`, `rcg`, `wr`; `rbt`, `mz` per team)."""
    import copy
    props = copy.deepcopy(PROPS)
    block = props["seasons"]["2027"]
    block["fields"] = FIELDS + ["oreb", "dreb"]
    for p in block["players"].values():
        for r in p["log"]:
            r += [1, r[7] - 1]
    rs = props["research"]
    rs["players"]["1"].update({
        "rb": [100, 20, 90, 6, 7200], "rz": [10, 2, 3, 1, 4, 0], "qr": [8, 2, 7, 1, 8, 2, 7, 1],
        "rcg": {str(g): 58 + 2 * g for g in range(1, 7)}, "wr": {"2": [10, 50, 20, 100], "3": [15, 70, 15, 80]}, "linesr": {"4": 4.5}})
    # BBB leave 45 misses a game (the most), crash on 50 of their 180 misses, allow 150 of 330 shots
    rs["rbt"] = {"BBB": [4, 180, 50, 170, 120, 150, 330], "CCC": [5, 200, 60, 210, 150, 190, 400]}
    rs["mz"] = {"BBB": [60, 20, 30, 20, 40, 10], "CCC": [50, 30, 40, 20, 50, 10]}
    return props


class Rebounds(unittest.TestCase):
    """The Rebounds page's panel (the owner, 2026-11-04): Form (REB, DREB, OREB, MIN), Rebounding
    (chances and his share of them at both ends, beside the opponent, the read), Miss Zones (where
    the misses he grabs come from beside where the opponent misses), Game Script (MIN and Chances),
    Vs The Line, Ladder, Rotation (REB and OREB a quarter) and Teammates (rebounds and his share
    with / without, their own rebounds). The list's Volume = his share of the rebounds there."""
    @classmethod
    def setUpClass(cls):
        cls.saved = (SITE.nba, SITE.nba_props)
        SITE.nba, SITE.nba_props = DATA, rebounds_props()
        cls.page = SITE.open("nba/rebounds.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")
        cls.page.click("#rs-list tr.rs-click td.rs-line")
        cls.page.wait_for_selector("#rs-list .rs-panel")

    @classmethod
    def tearDownClass(cls):
        SITE.nba, SITE.nba_props = cls.saved

    tab = Panel.tab
    cells = Panel.cells
    open = Panel.open

    def test_the_list(self):
        self.assertEqual(head(self.page)[4:7], ["Avg", "Min", "Volume"])
        [one] = rows(self.page)
        self.assertEqual(one[4:7], ["5.0", "35.0", "14%"])  # 26 of the 190 rebounds there to get

    def test_eight_tabs_every_one_the_same_box(self):
        tabs = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb')].map((b) => [...b.querySelectorAll('.rs-tabs button')].map((t) => t.textContent))")
        self.assertEqual(tabs, [["Form", "Rebounding", "Miss Zones", "Game Script"], ["Vs The Line", "Ladder", "Rotation", "Teammates"]])
        sizes = set()
        for side, names in (("left", tabs[0]), ("right", tabs[1])):
            for name in names:
                box = self.tab(side, name)
                sizes.add(tuple(self.page.evaluate(f"() => {{ const b = document.querySelector(\"{box}\"); const s = b.querySelector('.rs-sbody'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), s.scrollHeight <= s.clientHeight + 1]; }}")))
        self.assertEqual(sizes, {(600, 312, True)})
        self.assertEqual(SITE.errors, [])

    def test_form(self):
        rows = self.cells(self.tab("left", "Form"))
        self.assertEqual([r[0] for r in rows[1:]], ["REB", "DREB", "OREB", "MIN"])
        self.assertEqual(rows[1][1], "5.0")
        self.assertEqual(rows[3][1], "1.0")
        self.assertEqual(rows[4][7], "--")  # minutes: no defense side, no read

    def test_rebounding(self):
        rows = self.cells(self.tab("left", "Rebounding"))
        self.assertEqual([r[0] for r in rows[1:]], ["Defensive Chances", "Defensive Rate", "Offensive Chances", "Offensive Rate", "Pace"])
        self.assertEqual(rows[1][1], "30.0")  # 100 chances in 120 minutes, a 36
        self.assertEqual(rows[1][3:5], ["45.0", "2nd"])  # BBB leave 180 misses in 4 games, the most (last of 2: ranked from the defense)
        self.assertEqual(rows[2][1], "20%")  # 20 of 100
        self.assertEqual(rows[3][3], "45%")  # BBB allow 150 of 330

    def test_miss_zones(self):
        rows = self.cells(self.tab("left", "Miss Zones"))
        self.assertEqual(rows[0][1:], ["Share", "Rank", "DREB / G", "Misses", "Rank", "Per G", "Read"])
        self.assertEqual([r[0] for r in rows[1:]], ["Rim", "Paint", "Mid-Range", "Corner 3", "Above-Break 3", "Free Throws"])
        self.assertEqual(rows[1][1], "50%")  # 10 of his 20
        self.assertEqual(rows[1][3], "1.7")  # 10 in 6 games
        self.assertEqual(rows[1][4:7], ["33%", "2nd", "15.0"])  # BBB: 60 of 180 at the rim, 4 games (the most = last of 2)

    def test_game_script(self):
        rows = self.cells(self.tab("left", "Game Script"))
        self.assertEqual(rows[0][1:], ["Games", "REB", "+/-", "MIN", "Chances", "Over 4.5", "Hit %"])
        self.assertEqual(rows[1][5], "65.0")  # 60 to 70 a game

    def test_vs_the_line_and_ladder(self):
        box = self.tab("right", "Vs The Line")
        self.assertEqual(self.page.locator(f"{box} .rs-vbar").count(), 6)
        self.assertIn("defensive", self.page.get_attribute(f"{box} .rs-vbar", "title"))
        rows = self.cells(self.tab("right", "Ladder"))
        self.assertEqual(rows[0][1:], ["2+", "3+", "4+", "5+", "6+", "7+", "8+"])  # around tonight's 4.5
        self.assertEqual(rows[1][4:6], ["50%", "50%"])  # 5+ and 6+: the three 6s

    def test_rotation(self):
        box = self.tab("right", "Rotation")
        self.assertEqual(self.page.locator(f"{box} .rs-qt").first.text_content(), "1st Qtr1.3 REB · 0.3 OREB")

    def test_teammates(self):
        rows = self.cells(self.tab("right", "Teammates"))
        self.assertEqual(rows[0][1:], ["Together", "REB With", "REB W/O", "Share With", "Share W/O", "Change", "Their REB"])
        two = next(r for r in rows if r[0].startswith("P. Two"))
        self.assertEqual(two[2:8], ["6.0", "4.8", "20%", "20%", "−1.2", "11.6"])  # 10 / 20 boards in 60 / 150 min; Two: 10 in 31


def assists_props():
    """The same slate with Player One's passing data for the Assists panel (research.py `ap`, `az`,
    `qa`, `acg`, `wa`, `to`, `daz`; `rb` for his seconds on the floor, `rbt` for the shooting allowed)."""
    import copy
    props = copy.deepcopy(PROPS)
    rs = props["research"]
    rs["players"]["1"].update({
        "ap": [120, 30, 6], "az": [10, 5, 3, 4, 8], "qa": [8, 7, 8, 7], "rb": [100, 20, 90, 6, 7200],
        "acg": {str(g): [20, 5, 0, 2, 1, 1, 1] for g in range(1, 7)}, "wa": {"2": [10, 40, 20, 80], "3": [12, 50, 18, 70]}, "to": {"2": 9}, "linesa": {"4": 6.5}})
    rs["rbt"] = {"BBB": [4, 180, 50, 170, 120, 150, 330], "CCC": [5, 200, 60, 210, 150, 190, 400]}
    rs["daz"] = {"BBB": [20, 10, 5, 5, 10], "CCC": [15, 10, 10, 5, 10]}
    # assisted baskets against each defense by the shooter's position, a game: BBB give SGs 6, CCC 4
    rs["dag"] = {"BBB": {str(g): [3, 6, 4, 3, 2] for g in (7, 8)}, "CCC": {str(g): [2, 4, 5, 3, 3] for g in range(1, 7)}}
    return props


class Assists(unittest.TestCase):
    """The Assists page's panel (the owner, 2026-11-04; no turnovers: "too noisy"): Form (AST,
    AST / 36, MIN), Playmaking (his teammates' makes while he's on the floor and his share of them,
    beside the shooting the defense allows, how much of it is assisted, transition, pace), Assist
    Zones, Game Script (MIN and Chances), Vs The Line (the hover: that night's chances and rate),
    Ladder, Rotation (assists a quarter) and Teammates (assists and rate with / without, To Him)."""
    @classmethod
    def setUpClass(cls):
        cls.saved = (SITE.nba, SITE.nba_props)
        SITE.nba, SITE.nba_props = DATA, assists_props()
        cls.page = SITE.open("nba/assists.html")
        cls.page.wait_for_selector("#rs-list [data-list-every='true']")
        cls.page.click("#rs-list [data-list-every='true']")
        cls.page.wait_for_selector("#rs-list tr.sim-row")
        cls.page.click("#rs-list tr.rs-click:has-text('Player One') td.rs-line")
        cls.page.wait_for_selector("#rs-list .rs-panel")

    @classmethod
    def tearDownClass(cls):
        SITE.nba, SITE.nba_props = cls.saved

    tab = Panel.tab
    cells = Panel.cells

    def open(self):
        pass

    def test_the_list(self):
        self.assertEqual(head(self.page)[4:7], ["Avg", "Min", "Volume"])
        one = next(r for r in rows(self.page) if "Player One" in r[0])
        self.assertEqual(one[4:7], ["7.5", "35.0", "25%"])  # 6, 6, 6, 9, 9, 9; 30 of 120 teammate makes

    def test_eight_tabs_every_one_the_same_box(self):
        tabs = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb')].map((b) => [...b.querySelectorAll('.rs-tabs button')].map((t) => t.textContent))")
        self.assertEqual(tabs, [["Form", "Playmaking", "Assist Zones", "Game Script"], ["Vs The Line", "Ladder", "Rotation", "Teammates"]])
        sizes = set()
        for side, names in (("left", tabs[0]), ("right", tabs[1])):
            for name in names:
                box = self.tab(side, name)
                sizes.add(tuple(self.page.evaluate(f"() => {{ const b = document.querySelector(\"{box}\"); const s = b.querySelector('.rs-sbody'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), s.scrollHeight <= s.clientHeight + 1]; }}")))
        self.assertEqual(sizes, {(600, 312, True)})
        self.assertEqual(SITE.errors, [])
        self.assertNotIn("TOV", self.page.inner_text(".rs-panel"))  # no turnovers anywhere

    def test_form(self):
        # the owner, 2026-11-04: his AST, then his assists to each OTHER position beside the assisted
        # baskets the defense gives up to that position (no AST / 36, no minutes)
        rows = self.cells(self.tab("left", "Form"))
        self.assertEqual([r[0] for r in rows[1:]], ["AST", "To SG", "To SF", "To PF", "To C"])  # One is a PG
        self.assertEqual(rows[2][1:4], ["2.0", "2.0", "2.0"])  # 2 a game to SGs
        self.assertEqual(rows[2][4:7], ["6.0", "6.0", "6.0"])  # BBB give SGs 6 assisted baskets a game
        self.assertIn(rows[2][7], ("Over", "Under", "Even", "--"))

    def test_playmaking(self):
        rows = self.cells(self.tab("left", "Playmaking"))
        self.assertEqual([r[0] for r in rows[1:]], ["Assist Chances", "Assist Rate", "Transition", "Pace"])
        self.assertEqual(rows[1][1], "36.0")  # 120 teammate makes in 120 minutes, a 36
        self.assertEqual(rows[1][3], "45%")  # BBB allow 150 of 330
        self.assertEqual(rows[2][1], "25%")
        self.assertEqual(rows[2][3:5], ["63%", "2nd"])  # 10 of the 16 PG makes against BBB assisted (the most = last of 2)

    def test_assist_zones(self):
        rows = self.cells(self.tab("left", "Assist Zones"))
        self.assertEqual([r[0] for r in rows[1:]], ["Rim", "Paint", "Mid-Range", "Corner 3", "Above-Break 3"])
        self.assertEqual(rows[1][1], "33%")  # 10 of his 30
        self.assertEqual(rows[1][4:7], ["40%", "2nd", "5.0"])  # BBB: 20 of 50 at the rim, 4 games (the most = last of 2)

    def test_game_script_and_the_line(self):
        rows = self.cells(self.tab("left", "Game Script"))
        self.assertEqual(rows[0][2:6], ["AST", "+/-", "MIN", "Chances"])
        self.assertEqual(rows[1][5], "20.0")
        box = self.tab("right", "Vs The Line")
        self.assertIn("teammates made 20 shots with him on the floor", self.page.get_attribute(f"{box} .rs-vbar", "title"))

    def test_rotation(self):
        box = self.tab("right", "Rotation")
        self.assertEqual(self.page.locator(f"{box} .rs-qt").first.text_content(), "1st Qtr1.3 AST")

    def test_teammates(self):
        rows = self.cells(self.tab("right", "Teammates"))
        self.assertEqual(rows[0][1:], ["Together", "AST With", "AST W/O", "Rate With", "Rate W/O", "Change", "To Him"])
        two = next(r for r in rows if r[0].startswith("P. Two"))
        self.assertEqual(two[2:8], ["6.0", "4.8", "25%", "25%", "−1.2", "9"])  # 10 / 20 assists in 60 / 150 min


class OtherMarkets(unittest.TestCase):
    def test_rebounds_reads_rebounds(self):
        page = SITE.open("nba/rebounds.html")
        page.wait_for_selector("#rs-list tr.sim-row")
        [one] = rows(page)
        self.assertEqual(one[1], "4.5")
        self.assertEqual(one[4], "5.0")  # 4, 4, 4, 6, 6, 6
        self.assertIn("REBOUNDS RESEARCH", page.inner_text(".rs-intro").upper())
        self.assertEqual(SITE.errors, [])

    def test_no_line_yet(self):
        page = SITE.open("nba/assists.html")
        page.wait_for_selector("#rs-list .sim-noplay")
        self.assertIn("haven't posted", page.inner_text("#rs-list"))
        self.assertEqual(SITE.errors, [])


class AllProps(unittest.TestCase):
    """The owner, 2026-11-04: every stat's lines on one list for members who "don't care about what stats
    they are"; only the columns that mean the same for every stat, a Stat pill, sorted by O."""

    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/all-props.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    def reads_on(self, market):
        page = SITE.open(f"nba/{market}.html")
        try:
            page.wait_for_selector("#rs-list tr.sim-row")
            return page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row td.rs-read')].map((td) => td.textContent)")
        finally:
            page.close()

    def test_one_row_per_player_and_stat_with_the_stat_pages_reads(self):
        page = self.page
        heads = head(page)
        self.assertEqual(heads[:3], ["Player", "Stat", "Line"])
        for gone in ("Min", "3PA", "Volume"):
            self.assertNotIn(gone, heads)
        self.assertIn("O", heads)
        got = page.evaluate("() => [...document.querySelectorAll('#rs-list tr.sim-row')].map((tr) => [tr.querySelector('.rs-stat-pill').textContent, tr.querySelector('.rs-stat-pill').getAttribute('href'), [...tr.querySelectorAll('td.rs-read')].map((td) => td.textContent)])")
        by = {stat: (href, reads) for stat, href, reads in got}
        self.assertEqual(sorted(by), ["Points", "Rebounds"])  # Player One has a points and a rebounds line
        self.assertEqual(by["Points"], ("points.html", self.reads_on("points")))
        self.assertEqual(by["Rebounds"], ("rebounds.html", self.reads_on("rebounds")))
        # sorted by the O share, the biggest first
        shares = [int(r[2][0].split("/")[0]) / int(r[2][0].split("/")[1]) for r in got]
        self.assertEqual(shares, sorted(shares, reverse=True))
        self.assertIn("across Points, Threes, Assists and Rebounds", page.inner_text("#rs-note"))
        self.assertEqual(SITE.errors, [])

    def test_a_row_opens_its_own_stats_panel_and_saves_its_own_stat(self):
        page = self.page
        try:
            page.click("#rs-list tr.sim-row:has(.rs-stat-pill:text-is('Rebounds')) td.rs-line")
            page.wait_for_selector("#rs-list .rs-panel")
            tabs = page.evaluate("() => [...document.querySelectorAll('#rs-list .rs-sb[data-side=left] [data-rs-tab]')].map((b) => b.textContent)")
            self.assertEqual(tabs, ["Form", "Rebounding", "Miss Zones", "Game Script"])
            page.click("#rs-list tr.sim-row:has(.rs-stat-pill:text-is('Points')) td.rs-line")
            page.wait_for_selector("#rs-list .rs-sb [data-rs-tab='left:Scoring']")
            page.click("#rs-list tr.sim-row:has(.rs-stat-pill:text-is('Rebounds')) td.rs-price >> nth=0 >> .bo-pill")
            page.wait_for_selector("#book-odds-modal:not([hidden]) .bo-save")
            page.click("#book-odds-modal .bo-save >> nth=0")
            saved = page.evaluate("() => JSON.parse(localStorage.getItem('nfl-tool.nba-plays.v1') || '[]').map((p) => [p.market, p.side, p.line])")
            self.assertEqual(saved, [["rebounds", "over", 4.5]])
        finally:
            page.evaluate("() => { localStorage.removeItem('nfl-tool.nba-plays.v1'); const m = document.getElementById('book-odds-modal'); if (m) m.hidden = true; OPEN = ''; renderList(); }")
        self.assertEqual(SITE.errors, [])

    def test_a_tab_only_one_stat_has_opens(self):
        # The owner, 2026-11-04: Braun's Shot Map (a Threes-only tab) wouldn't open on All Props; every redraw
        # switched through Points first, which has no such tab, and that reset the click.
        page = self.page
        try:
            page.click("#rs-list tr.sim-row:has(.rs-stat-pill:text-is('Rebounds')) td.rs-line")
            page.wait_for_selector("#rs-list [data-rs-tab='left:Miss Zones']")
            page.click("#rs-list [data-rs-tab='left:Miss Zones']")
            on = page.evaluate("() => document.querySelector('#rs-list .rs-sb[data-side=left] .rs-tabs .on').textContent")
            self.assertEqual(on, "Miss Zones")
            page.evaluate("() => renderList()")  # a redraw (a sort, a save) keeps it
            self.assertEqual(page.evaluate("() => document.querySelector('#rs-list .rs-sb[data-side=left] .rs-tabs .on').textContent"), "Miss Zones")
        finally:
            page.evaluate("() => { RSV.left = 'Form'; OPEN = ''; renderList(); }")
        self.assertEqual(SITE.errors, [])

    def test_in_the_menu_and_a_tab_on_every_research_page(self):
        site = ROOT / "nfl_tool" / "site" / "nba"
        for name in ("points", "threes", "rebounds", "assists"):
            self.assertIn('<a href="all-props.html">All Props</a>', (site / f"{name}.html").read_text(encoding="utf-8"))
        self.assertIn('data-market="all"', (site / "all-props.html").read_text(encoding="utf-8"))


class Filters(unittest.TestCase):
    """The owner, 2026-11-04: a min and a max for every number in the list and every panel row with a Read
    (the defense as a rank AND its raw number), the right unit on each, combos saved to the account;
    the fold-open panel picked from two mock-ups, stacked tight."""

    @classmethod
    def setUpClass(cls):
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")
        cls.page.click("[data-list-every='true']")
        cls.page.wait_for_selector("#rs-filters [data-rf-toggle]")

    def names(self):
        return [r[0].split(" PG")[0].split(" SF")[0].split(" SG")[0].strip() for r in rows(self.page)]

    def set_box(self, field, which, value):
        box = self.page.locator(f"#rs-filters [data-rf-id='{field}'] .rf-in[data-rf-which='{which}']")
        box.fill(str(value))
        box.dispatch_event("change")

    def tearDown(self):
        self.page.evaluate("() => { RF.on = []; RF.stats = []; RF.open = false; localStorage.removeItem('nfl-tool.nba-screens.v1'); renderList(); rfRender(true); }")

    def test_every_number_has_a_min_and_max_with_its_unit(self):
        page = self.page
        page.click("#rs-filters [data-rf-toggle]")
        heads = page.evaluate("() => [...document.querySelectorAll('#rs-filters .rf-bhead')].map((h) => h.textContent)")
        for g in ("The Line", "His Numbers", "Defense", "Reads", "Tonight's Game", "Form", "Scoring", "Matchup"):
            self.assertIn(g, heads)
        unit = lambda fid: page.evaluate(f"() => document.querySelector(\"#rs-filters [data-rf-id='{fid}'] .rf-unit\").textContent")  # noqa: E731
        self.assertEqual(unit("vol"), "%")           # a share
        self.assertEqual(unit("allowRank"), "rank")  # a rank of 30
        self.assertEqual(unit("allow"), "")          # a raw number
        self.assertEqual(unit("p|Scoring|Paint|def"), "%")
        # the panel rows: his number, his rank, the defense's number and its rank, each a min and a max
        self.assertEqual(page.locator("#rs-filters [data-rf-id^='p|Matchup|Points|'] .rf-in").count(), 8)
        self.assertEqual(SITE.errors, [])

    def test_list_and_panel_filters_narrow_the_list(self):
        page = self.page
        page.click("#rs-filters [data-rf-toggle]")
        before = self.names()
        self.assertGreater(len(before), 1)
        self.set_box("avg", "min", 15)  # Player One 20 a game; the others under 15
        self.assertEqual(self.names(), ["Player One"])
        self.assertIn("Avg", page.inner_text("#rs-filters .rf-chip"))
        page.click("#rs-filters [data-rf-clear]")
        self.assertEqual(len(self.names()), len(before))
        self.set_box("p|Form|PTS|him", "min", 15)  # the same through his Form panel row
        self.assertEqual(self.names(), ["Player One"])
        self.set_box("p|Form|PTS|him", "max", 10)  # nobody: 15 or more AND 10 or less
        self.assertIn("No player matches these filters", page.inner_text("#rs-list"))
        page.click("[data-rf-clear-list]")
        self.assertEqual(len(self.names()), len(before))
        self.assertEqual(SITE.errors, [])

    def test_a_screen_saves_to_the_account_and_comes_back(self):
        page = self.page
        page.click("#rs-filters [data-rf-toggle]")
        self.set_box("avg", "min", 15)
        page.click("#rs-filters [data-rf-naming]")
        page.fill("#rf-name", "Big Scorers")
        page.click("#rs-filters [data-rf-save]")
        saved = page.evaluate("() => JSON.parse(localStorage.getItem('nfl-tool.nba-screens.v1'))")
        self.assertEqual([(s["page"], s["name"], s["filters"]) for s in saved], [("points", "Big Scorers", [{"id": "avg", "min": 15, "max": None}])])
        page.click("#rs-filters [data-rf-clear]")
        page.click("#rs-filters [data-rf-load]")
        self.assertEqual(self.names(), ["Player One"])
        # synced like saved plays: in sync.js KEYS and the middleware's SYNC_KEYS
        for f in ("nfl_tool/site/sync.js", "nfl_tool/functions/_middleware.js"):
            self.assertIn('"nfl-tool.nba-screens.v1"', (ROOT / f).read_text(encoding="utf-8"))
        self.assertEqual(SITE.errors, [])

    def test_all_props_has_the_list_numbers_and_stat_toggles(self):
        page = SITE.open("nba/all-props.html")
        try:
            page.wait_for_selector("#rs-list tr.sim-row")
            page.click("#rs-filters [data-rf-toggle]")
            self.assertEqual(page.locator("#rs-filters .rf-grid").count(), 0)  # no panel rows: they differ by stat
            self.assertEqual(page.locator("#rs-filters [data-rf-id='vol']").count(), 0)
            stats = lambda: page.evaluate("() => [...document.querySelectorAll('#rs-list .rs-stat-pill')].map((p) => p.textContent).sort()")  # noqa: E731
            self.assertEqual(stats(), ["Points", "Rebounds"])
            page.click("#rs-filters [data-rf-stat='points']")  # Points off
            self.assertEqual(stats(), ["Rebounds"])
            page.click("#rs-filters [data-rf-stat='points']")  # back on
            self.assertEqual(stats(), ["Points", "Rebounds"])
        finally:
            page.close()
        self.assertEqual(SITE.errors, [])


class PastNights(unittest.TestCase):
    """The owner, 2026-11-05: "go back days like the other tools and see how things did ... remove the
    teammates on report section and replace with a column that says over or under and then what the
    total of the stat was", colored like the stat column. A past night: his line that night (the line
    history), every number from the games before it, no prices, and Result."""

    @classmethod
    def setUpClass(cls):
        # his Reads and Volume for game 4 as the deploy saved them before tip (reads_record.py)
        props = copy.deepcopy(PROPS)
        props["research"]["frozen"] = {"4": {"date": "2026-10-23", "tabs": {"points": ["Form", "Scoring"]},
                                             "m": {"points": {"1": [5, 1, 8, 0.31, [[2, 0, 3, 1], [3, 1, 5, 0]]]}}}}
        SITE.nba, SITE.nba_props = DATA, props
        SITE.context.clock.set_fixed_time("2026-11-05T17:00:00Z")  # the sample's October nights are in the past
        cls.page = SITE.open("nba/points.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")

    @classmethod
    def tearDownClass(cls):
        SITE.context.clock.set_fixed_time(SAMPLE_BUILT_UTC)
        SITE.nba_props = PROPS

    def go(self, day):
        self.page.fill(".sim-day-pick", day)
        self.page.wait_for_function("(d) => document.querySelector('.sim-day-pick').value === d", arg=day)

    def test_opens_on_tonight_and_steps_back_to_opening_night(self):
        self.go(DAY)
        self.assertIn("Teammates On The Report", head(self.page))
        self.page.click("#day-prev")  # the last night in the logs
        self.assertFalse(self.page.is_disabled("#day-prev"))
        self.go("2026-10-20")
        self.assertTrue(self.page.is_disabled("#day-prev"))  # opening night is the first day
        self.go(DAY)
        self.assertEqual(SITE.errors, [])

    def test_a_past_night(self):
        self.go("2026-10-23")  # game 4: his line was 19.5 and he scored 25
        self.assertEqual(head(self.page), ["Player", "Line", "Avg", "Min", "Volume", "Last Game", "L5", "L10", "Season", "Home", "Away", "Opp Allows", "Type Matchup", "O", "U", "Pace", "Spread", "Total", "Result"])
        [one] = rows(self.page)
        self.assertIn("Player One", one[0])
        self.assertNotIn("DTD", one[0])  # tonight's injury report doesn't belong on a past night
        self.assertEqual(one[1], "19.5")
        self.assertEqual(one[2], "15.0")  # only the three games before it (15 each)
        self.assertEqual(one[5], "15 0.0")  # his last game before that night, right on his average
        self.assertEqual(one[6], "0% 0 of 3")
        self.assertEqual(one[4], "31%")  # Volume as saved before tip
        self.assertEqual(one[13:15], ["5/8", "1/8"])  # the O / U Reads as they stood before tip (the owner, 2026-11-05)
        self.assertEqual(one[17], "224.0 O/U")  # that game's total (research `games`)
        self.assertEqual(one[18], "OVER 25")
        self.assertIn("1 Over, 0 Under", self.page.inner_text("#rs-note"))
        # the number is colored like Avg (against his position), the call on the hit colors
        styled = self.page.evaluate("() => [...document.querySelectorAll('#rs-list .rs-res-call, #rs-list .rs-res-num')].map((t) => t.getAttribute('style') || '')")
        self.assertTrue(styled[0])
        self.assertFalse(self.page.query_selector("#rs-list tr.rs-click"))  # no research panel on a past night
        self.assertIn("Final", self.page.inner_text("#matchup-row"))
        self.assertEqual(SITE.errors, [])

    def test_every_player_on_a_past_night(self):
        self.go("2026-10-23")
        self.page.click("[data-list-every='true']")
        got = {r[0].split(" ")[0] + " " + r[0].split(" ")[1]: r for r in rows(self.page)}
        self.assertEqual(got["Player Three"][18], "12")  # he played (no line: no call)
        self.assertEqual(got["Player Three"][13:15], ["--", "--"])  # nothing saved for him: never today's Reads
        self.assertNotIn("Player Five", got)  # didn't play that night
        self.page.click("[data-list-every='false']")
        self.go(DAY)

    def test_the_capture_reads_tonights_untipped_games(self):
        # what the deploy saves (tools/nba_reads_capture.py): every market's Reads and Volume per player with a line
        self.go(DAY)
        cap = self.page.evaluate("() => rsCapture()")
        self.assertEqual(list(cap), ["900"])
        self.assertEqual(cap["900"]["date"], DAY)
        self.assertEqual(sorted(cap["900"]["m"]), ["points", "rebounds"])  # the books' lines for Player One
        o, u, n, vol, by = cap["900"]["m"]["points"]["1"]
        self.assertGreater(n, 0)
        self.assertEqual(vol, 0.28)
        self.assertEqual(len(by), len(cap["900"]["tabs"]["points"]))
        self.assertEqual(self.page.evaluate("() => MK.market"), "points")  # the page keeps its own stat
        self.assertIn("Teammates On The Report", head(self.page))
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


def spots_slate():
    """Assist Spots (2026-11-05): Player One (AAA, PG) has a 6.5 assists line against BBB. He sends half his
    assists to Player Three (SG; BBB give SGs 8 assisted baskets a game, the league 6) and Three is newly Out
    (he played all of AAA's last 3): One sets up 40% of the makes with him on the floor, 14% without, 25% on
    the season. So Targets pull Over and Lineup Under: Mixed, both on the row."""
    props = assists_props()
    rs = props["research"]
    props["seasons"]["2027"]["players"]["3"]["log"] = log([(g, "CCC", 28, 12, 3, 3) for g in range(1, 7)])
    rs["players"]["1"].update({"af": [12, 6, 6, 3, 3], "ag": {"3": [12, 1, 1, 1, 0], "2": [0, 3, 5, 1, 0]},
                               "wa": {"2": [10, 40, 20, 80], "3": [20, 50, 10, 70]}, "k3g": {"6": [4, 10]}})
    rs["dag"] = {"BBB": {str(g): [3, 8, 4, 3, 3] for g in (7, 8)}, "CCC": {str(g): [2, 4, 5, 3, 3] for g in range(1, 7)}}
    # shots against each defense by type (kick-out 3, drive, cut / lob, dribble 3, mid) and its possessions
    rs["dfa"] = {"BBB": [40, 20, 30, 10, 50, 400], "CCC": [30, 20, 30, 10, 50, 400]}
    rs["tm"] = {t: [400, 160, 400, 165, 340, 150, 55, 50, 345, 150] for t in ("AAA", "BBB", "CCC")}
    # the reads saved before tip: an Over at 6.5 on 10/23 (he had 9: a hit), an Under at 8.5 on 10/24 (9: a miss)
    rs["players"]["1"]["linesa"] = {"4": 6.5, "5": 8.5}
    rs["spots_frozen"] = {"4": {"date": "2026-10-23", "m": {"1": [1, 1.2, 0.3, None, 6.5]}},
                          "5": {"date": "2026-10-24", "m": {"1": [-1, None, -1.1, None, 8.5]}}}
    data = copy.deepcopy(DATA)
    data["book_odds"]["AAA_BBB"]["props"]["assists"] = {"1": {"name": "Player One", "q": quotes(6.5)}}
    data["injuries"]["AAA"][1]["status"] = "Out"  # Player Three
    return data, props


class AssistSpots(unittest.TestCase):
    """The owner's Assist Spots (mock-ups 1-5, 2026-11-05): the Prop Research list and panel with the Reads
    as columns (Targets, Types, Lineup, the Read) and six tabs; every factor in its own row so one never
    hides another; defense ranks read from the defense (30th = allows the most)."""

    @classmethod
    def setUpClass(cls):
        cls.saved = (SITE.nba, SITE.nba_props)
        SITE.nba, SITE.nba_props = spots_slate()
        cls.page = SITE.open("nba/assist-spots.html")
        cls.page.wait_for_selector("#rs-list tr.sim-row")
        cls.page.click("#rs-list tr.rs-click:has-text('Player One') td.rs-line")
        cls.page.wait_for_selector("#rs-list .rs-panel")

    @classmethod
    def tearDownClass(cls):
        SITE.nba, SITE.nba_props = cls.saved

    tab = Panel.tab
    cells = Panel.cells

    def open(self):
        pass

    def test_the_list_reads_every_factor(self):
        self.assertEqual(head(self.page), ["Player", "Line", "Over", "Under", "Avg", "Rate", "L5", "Season", "Targets", "Types", "Lineup", "Read", "Chances", "Volume"])
        one = next(r for r in rows(self.page) if "Player One" in r[0])
        self.assertEqual(one[1], "6.5")
        self.assertEqual(one[6], "60% 3 of 5")  # 6, 9, 9, 9 over 6.5 in his last 5 (6, 6, 9, 9, 9)
        self.assertEqual((one[8], one[10], one[11]), ("Over", "Under", "Mixed"))  # Targets Over, Three newly Out: Under
        self.assertEqual(SITE.errors, [])
        self.assertIn("Assist Spots", self.page.text_content(".sim-tabs"))

    def test_six_tabs_every_one_the_same_box(self):
        tabs = self.page.evaluate("() => [...document.querySelectorAll('.rs-sb')].map((b) => [...b.querySelectorAll('.rs-tabs button')].map((t) => t.textContent))")
        self.assertEqual(tabs, [["Who He Assists", "Assist Types", "Game Log"], ["The Read", "Vs The Line", "Lineup"]])
        sizes = set()
        for side, names in (("left", tabs[0]), ("right", tabs[1])):
            for name in names:
                box = self.tab(side, name)
                sizes.add(tuple(self.page.evaluate(f"() => {{ const b = document.querySelector(\"{box}\"); const s = b.querySelector('.rs-sbody'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), s.scrollHeight <= s.clientHeight + 1]; }}")))
        self.assertEqual(sizes, {(600, 312, True)})
        self.assertEqual(SITE.errors, [])

    def test_who_he_assists(self):
        rows = self.cells(self.tab("left", "Who He Assists"))
        self.assertEqual(rows[0][1:], ["Kick-Out 3", "Drive", "Cut / Lob", "Dribble 3", "Mid", "Total", "Vs Pos"])
        three = rows[1]
        self.assertTrue(three[0].startswith("P. Three"), three)
        # his assists to Three by type, 15 of his 30, and BBB's rank vs SGs read from the defense: allows the most of 2 = #2
        self.assertEqual(three[1:], ["12", "1", "1", "1", "0", "50%", "#2"])
        total = next(r for r in rows if r[0] == "Total")
        self.assertEqual(total[1], "40%")
        allows = next(r for r in rows if r[0] == "BBB Allows")
        self.assertEqual(allows[1], "#2")  # BBB allow more kick-out 3s than CCC: the bad one is the last rank

    def test_the_read_shows_every_factor(self):
        rows = self.cells(self.tab("right", "The Read"))
        self.assertEqual([r[0] for r in rows[1:]], ["Chances", "Targets", "Assist Types", "Lineup", "Volume", "The Read"])
        self.assertEqual(rows[2][3], "Over")
        self.assertEqual(rows[4][3], "Under")
        self.assertTrue(rows[6][1].startswith("Mixed: Targets Over"), rows[6])

    def test_lineup_and_game_log(self):
        rows = self.cells(self.tab("right", "Lineup"))
        three = next(r for r in rows if r[0].startswith("P. Three"))
        self.assertEqual(three[1:], ["40%", "14%", "−11", "3/3", "Out (New)"])
        log_rows = self.cells(self.tab("left", "Game Log"))
        self.assertEqual(log_rows[0][1:], ["Min", "Chances", "Share", "C&S 3s", "AST", "Line", "Vs Tonight"])
        self.assertEqual(log_rows[1][4], "4/10")  # his newest game: teammates 4 of 10 on catch-and-shoot threes

    def test_how_the_reads_did(self):
        # graded against his line then with his assists that night; the pull = the votes that leaned that way
        self.assertEqual(self.page.evaluate("() => spotLedger()"), [["2026-10-23", 1.2, 1, None, ["over"]], ["2026-10-24", 1.1, 0, None, ["under"]]])
        self.assertEqual(self.page.evaluate("() => spotTally('2026-10-24')"), {"over": [0, 0], "under": [0, 1]})
        SITE.context.clock.set_fixed_time("2026-11-05T17:00:00Z")  # the sample's October nights are in the past
        page = SITE.open("nba/assist-spots.html")
        try:
            page.wait_for_selector("#rs-list tr.sim-row, #rs-list .sim-noplay")
            page.click("#sp-ytd")
            page.wait_for_selector("#sp-ytd-modal .sp-ytd-tracker")
            self.assertIn("1-1", page.inner_text("#sp-ytd-modal"))
            page.keyboard.press("Escape")
            # the past night: the read as it stood before tip, Hit under it, the night's tally in the note
            page.evaluate("() => { const b = document.querySelector('.sim-day-pick'); b.value = '2026-10-23'; b.dispatchEvent(new Event('change')); }")
            page.wait_for_selector("#rs-list td.sp-call small")
            self.assertEqual(page.inner_text("#rs-list td.sp-call").split(), ["Over", "HIT"])
            self.assertIn("Reads that night: Over 1-0, Under 0-0", page.inner_text("#rs-note"))
            self.assertEqual(SITE.errors, [])
        finally:
            page.close()
            SITE.context.clock.set_fixed_time(SAMPLE_BUILT_UTC)

    def test_the_reads_are_saved_before_tip(self):
        got = self.page.evaluate("() => spotsCapture()")
        call, tg, ty, lu, line = got["900"]["m"]["1"]
        self.assertEqual((call, line), (2, 6.5))
        self.assertGreater(tg, 0)
        self.assertLess(lu, 0)


if __name__ == "__main__":
    unittest.main()
