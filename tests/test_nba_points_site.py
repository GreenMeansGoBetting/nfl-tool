"""The NBA Points page (site/nba/points.html + points.js on the game sim's
shared sim-board.js, 2026-10-24; Player View / Matchup View 2026-10-25) on
hand-made data.

What is pinned: the Beta banner with the record tiles (Yesterday / Top Plays /
Season, units) and the Model Performance popup's splits; Player View, the NHL
pages' list (the owner, 2026-10-25): opens on the plays only, each at his main
line ("o19.5") with the best price across the member's books and its book,
Top Play, Fair, Edge, the hit rates (L5 / L10 / Season / Home / Away over
tonight's line, "x of y") and the tags (the Ladder: a rung on the same side
with more edge, "30+ +300 +11.0"; Script-Proof; whose dial); Every Player adds the rest under
their own heading; a click opens The Model (Hit In x of 10,000, what the
price needs, the scripts, Script-Proof, whose dial, Starting, the histogram,
the ladder with the main line and the tagged rung) and the Shot Chart tab (his
chart beside what tonight's defense allows);
My Books changes the price and the edge; a game card narrows the list; a
past night lists its plays graded. Matchup View: the game picker (a card per
game) and the game board (both teams, minutes, medians by script, the main
line, every rung with our chance and the best price, tonight's play
outlined) and the Script Picker re-pricing from one script's games; the page
is in the NBA menu."""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import sim  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402


def lad(values):
    return sim.ladder(np.array(values))


def stat_row(all_values, home_values, med):
    """A player's stat in the sim: the same ladder in every script but the
    home blowout's (home_values), medians by script."""
    return {"med": {"all": med, "away": med - 3, "close": med, "home": med + 2}, "mean": med,
            "lad": {"all": lad(all_values), "away": lad(all_values), "close": lad(all_values), "home": lad(home_values)}}


def build(market, stat, line, rung_line, play_name_line):
    # player 1 (AAA, away): 36% for the rung, 60% when BBB blows them out (home script)
    one_all = [10] * 34 + [20] * 30 + [30] * 36 if stat == "pts" else [0] * 34 + [1] * 30 + [3] * 36
    one_home = [10] * 20 + [20] * 20 + [30] * 60 if stat == "pts" else [0] * 20 + [1] * 20 + [3] * 60
    two = [10] * 50 + [15] * 50 if stat == "pts" else [0] * 50 + [2] * 50
    other = "fg3m" if stat == "pts" else "pts"
    blank = {"med": {"all": 0, "away": 0, "close": 0, "home": 0}, "mean": 0, "lad": {"all": [0, [1000]]}}
    game = {"date": "2026-10-21", "home": "BBB", "away": "AAA", "margin": 4.0, "total": 224.0, "margin_mean": 4.1, "total_mean": 224.3,
            "scripts": {"away": 0.15, "close": 0.55, "home": 0.30}, "base": {"away": 0.2, "close": 0.55, "home": 0.25},
            "dials": {"away": ["rest_edge"], "home": []}, "starters": {"away": ["1"], "home": ["2"]}, "lineup": True,
            "players": {"1": {"team": "away", "min": 34.5, "name": "Player One", stat: stat_row(one_all, one_home, 20), other: blank},
                        "2": {"team": "home", "min": 30.0, "name": "Player Two", stat: stat_row(two, two, 12), other: blank}}}
    quiet = {**game, "home": "DDD", "away": "CCC", "dials": {"away": [], "home": []}, "players": {}}
    # tonight's play: his main line (2026-10-25: a rung is never the play), 66% at FanDuel's -150 (needs 60%)
    play = {"game": "900", "date": "2026-10-21", "pid": "1", "team": "AAA", "opp": "BBB", "stat": market, "side": "o", "line": line,
            "price": -150, "book": "fanduel", "chance": 0.66, "edge": 0.06, "main": True, "tier": "top", "kind": "proof",
            "scripts": {"away": 0.66, "close": 0.66, "home": 0.80}, "dials": ["rest_edge"], "med": 20}
    props = {
        "default": "2027",
        # player one's games: points 10, 25, 30, 15, 22, 18 (home, road, ...); threes 0, 1, 2, 0, 1, 3
        "seasons": {"2027": {"label": "2026-27", "fields": ["game", "home", "min", "pts", "fg3m", "fg3a"],
                             "players": {"1": {"name": "Player One", "team": "AAA", "pos": "SF",
                                               "log": [[str(700 + i), 1 - i % 2, 34, pts, m, m + 3] for i, (pts, m) in enumerate(zip([10, 25, 30, 15, 22, 18], [0, 1, 2, 0, 1, 3]))]},
                                                                            "2": {"name": "Player Two", "team": "BBB", "pos": "C", "log": []}}, "out": {}}},
        "sim": {"900": game, "901": quiet},
        "sim_plays": {market: [play], ("threes" if market == "points" else "points"): []},
        "sim_record": {market: {"ledger": [["2026-10-11", 0.08, 1, 3.0, ["top", "over", "alt", "chaos"]],
                                           ["2026-10-05", 0.05, 0, -1.0, ["strong", "under", "main", "proof"]]]}},
        # a past night (2026-10-25): the saved plays graded, reached with the day arrows
        "sim_past": {market: [{**play, "game": "800", "date": "2026-10-20", "line": rung_line, "main": False, "price": 150, "book": "fanduel", "opp": "BBB", "home": False,
                               "got": 31 if stat == "pts" else 4, "result": "won", "locked": True},
                              {**play, "game": "801", "date": "2026-10-20", "pid": "2", "team": "BBB", "opp": "CCC", "home": True, "tier": "strong",
                               "kind": "proof", "side": "u", "line": 12.5, "main": True, "price": -110, "got": 15 if stat == "pts" else 3,
                               "result": "lost", "dials": [], "locked": True}],
                     ("threes" if market == "points" else "points"): []},
        "sim_meta": {"n": 10000, "script_margin": 10, "min_edge": 0.04,
                     "dials": {"rest_edge": ["Rest Edge", -0.72, 1.89], "b2b": ["Back-To-Back", -0.84, 0.58]}},
    }
    main_q = [["draftkings", "o", line, -160], ["draftkings", "u", line, 130], ["fanduel", "o", line, -150]]
    two_line = 12.5 if stat == "pts" else 1.5  # player two: 50/50, -110 both sides (not a play)
    two_q = [["draftkings", "o", two_line, -110], ["draftkings", "u", two_line, -110]]
    alt_q = [["draftkings", "o", rung_line, 300], ["fanduel", "o", rung_line, 280]]
    data = {"season": 2027, "season_label": "2026-27", "injuries": {}, "players": {},
            "schedule": [{"game_id": "900", "date": "2026-10-21", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled",
                          "home_team_spread": -4.5, "total_line": 221.5},
                         {"game_id": "901", "date": "2026-10-21", "time": "20:00", "away": "CCC", "home": "DDD", "status": "scheduled"}],
            "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB", "CCC", "DDD")},
            "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                      "props": {market: {"1": {"name": "Player One", "q": main_q}, "2": {"name": "Player Two", "q": two_q}},
                                                f"{market}_alt": {"1": {"name": "Player One", "q": alt_q}}}}}}
    return data, props


DATA, PROPS = build("points", "pts", 19.5, 29.5, "30+")


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, PROPS
        # one shot for player one: the Shot Chart tab has something to draw
        SITE.nba_shots = {"games": ["900"], "teams": ["AAA", "BBB"], "players": {"1": [[25, 5, 1, 0, 0, 0, 1, 0, 1]]}, "who": {}, "league": []}
        PAGE = SITE.open("nba/points.html")
        PAGE.wait_for_function("() => !document.getElementById('sim-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def text(sel):
    return PAGE.evaluate("(s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())", sel)


def rows():
    return text("#sim-list tr.sim-row")


class Plays(unittest.TestCase):
    def test_opens_on_the_plays_only(self):
        self.assertEqual(SITE.errors, [])
        self.assertIn("PROJECTIONS IN TESTING", PAGE.inner_text("#sim-testing").upper())  # the Beta banner
        self.assertFalse(PAGE.is_hidden("#sim-player"))
        self.assertTrue(PAGE.is_hidden("#sim-matchup"))
        self.assertEqual(len(rows()), 1)
        row = rows()[0]
        self.assertIn("Player One", row)
        self.assertIn("o19.5 -150 FD", row)  # FanDuel's -150 beats DraftKings' -160
        self.assertIn("TOP PLAY", row.upper())
        self.assertIn("-194", row)  # 66% with no cut
        self.assertIn("+6.0", row)
        heads = text("#sim-list thead tr:last-child th")
        self.assertEqual(heads[:5], ["#", "PLAYER", "PLAY", "RATING", "FAIR"])
        self.assertTrue(heads[5].startswith("EDGE"), heads)
        self.assertEqual(heads[6:], ["L5", "L10", "SEASON", "HOME", "AWAY", "TAGS"])
        self.assertIn("HIT RATE - BASED ON OVER POINTS", PAGE.inner_text("#sim-list thead").upper())
        # over 19.5: last 5 (25, 30, 15, 22, 18) 3 of 5; last 10 = the season, 3 of 6; home (10, 30, 22) 2 of 3; road 1 of 3
        cells = PAGE.evaluate("() => [...document.querySelectorAll('#sim-list tr.sim-row td.sim-hit')].map((td) => td.innerText.replace(/\\s+/g, ' '))")
        self.assertEqual(cells, ["60% 3 of 5", "50% 3 of 6", "50% 3 of 6", "67% 2 of 3", "33% 1 of 3"])
        tags = " ".join(text("#sim-list tr.sim-row .sim-rtag")).upper()
        self.assertIn("LADDER 30+ +300 +11.0", tags)  # 36% at +300 beats the main line's +6.0
        self.assertIn("SCRIPT-PROOF", tags)  # 66 / 66 / 80% against the 60% -150 needs
        self.assertIn("AAA REST EDGE", tags)

    def test_every_player_adds_the_rest(self):
        PAGE.click("[data-list-every='true']")
        try:
            self.assertEqual(len(rows()), 2)
            self.assertIn("Player Two", rows()[1])
            self.assertIn("NOT PLAYS", PAGE.inner_text("#sim-list tr.sim-group").upper())
            self.assertNotIn("TOP PLAY", rows()[1].upper())
        finally:
            PAGE.click("[data-list-every='false']")
        self.assertEqual(len(rows()), 1)

    def test_a_click_opens_the_model(self):
        PAGE.click("#sim-list tr.sim-row .sim-rank")
        try:
            box = PAGE.inner_text("#sim-list tr.sim-detail").upper()
            self.assertIn("6,600", box)
            self.assertIn("OF 10,000", box)
            self.assertIn("NEEDS 60.0%", box)
            self.assertIn("AAA BLOWOUT\n66%", box)
            self.assertIn("BBB BLOWOUT\n80%", box)
            self.assertIn("SCRIPT-PROOF", box)
            self.assertIn("AAA REST EDGE", box)  # whose dial it is
            self.assertIn("STARTING", box)
            self.assertTrue(PAGE.evaluate("() => document.querySelectorAll('#sim-list .sim-hist div').length > 3"))
            ladder = text("#sim-list .sim-ladt tbody tr")
            self.assertEqual([r.replace("MAIN", " ").split()[:2] for r in ladder], [["Over", "19.5"], ["Over", "29.5"], ["Under", "19.5"]])
            self.assertIn("MAIN", ladder[0].upper())
            self.assertIn("+11.0", PAGE.inner_text("#sim-list .sim-ladt tr.best"))
            PAGE.click("[data-sim-tab='shots']")
            PAGE.wait_for_function("() => document.querySelector('#sim-list .sim-zone-pair')")
            heads = [h.upper() for h in text("#sim-list .sim-zone-head")]
            self.assertEqual(len(heads), 2)  # his chart, then what BBB's defense allows
            self.assertIn("1 SHOTS", heads[0])
            self.assertIn("BBB DEFENSE ALLOWS", heads[1])
            self.assertEqual(PAGE.query_selector("#sim-list .nba-shot-table"), None)  # no zone table under the chart
            PAGE.click("[data-sim-tab='model']")
        finally:
            PAGE.click("#sim-list tr.sim-row .sim-rank")
        self.assertEqual(PAGE.query_selector("#sim-list tr.sim-detail"), None)
        self.assertEqual(SITE.errors, [])

    def test_thin_columns_and_tags_on_one_line(self):
        # the owner, 2026-10-25: "every column to always be a thin comfortable overhang ... I NEVER want
        # tags to stack ... just do a +1 or +2 etc tag that can be hovered over"
        PAGE.set_viewport_size({"width": 1400, "height": 900})
        PAGE.click("[data-list-every='true']")
        PAGE.evaluate("""() => { const old = tagsFor; window.tagsFor = (x) => [...old(x), ...['One Long Tag Here', 'Another Long Tag', 'Tough 3s D', 'Help D', 'More Words In A Tag']
            .map((l) => ({key: l, label: l, title: l, cls: '', filter: l}))]; render(); }""")
        try:
            widths = PAGE.evaluate("() => [...document.querySelectorAll('#sim-list thead tr:last-child th')].map((th) => th.getBoundingClientRect().width)")
            self.assertLess(widths[0], 40)  # "#": its digits plus the padding, never the spare width
            self.assertLess(max(widths[6:11]), 75)  # the hit rates
            self.assertGreater(widths[-1], 300)  # Tags takes the spare width
            heights = PAGE.evaluate("() => [...document.querySelectorAll('#sim-list tr.sim-row')].map((tr) => Math.round(tr.getBoundingClientRect().height))")
            self.assertEqual(len(set(heights)), 1, heights)  # no row taller from stacked tags
            more = PAGE.query_selector("#sim-list .sim-rtag.more")
            self.assertIsNotNone(more)
            self.assertRegex(more.inner_text(), r"^\+\d+$")
            self.assertIn("More Words In A Tag", more.get_attribute("title"))
        finally:
            PAGE.evaluate("() => { window.tagsFor = undefined; }")
            PAGE.reload()
            PAGE.wait_for_function("() => !document.getElementById('sim-app').hidden")

    def test_the_tag_menu(self):
        PAGE.select_option("[data-list='tag']", "proof")
        try:
            self.assertEqual(len(rows()), 1)
        finally:
            PAGE.select_option("[data-list='tag']", "")

    def test_my_books_set_the_price_and_the_edge(self):
        PAGE.evaluate("() => { localStorage.setItem('nfl-tool.my-books.v1', JSON.stringify({hidden: ['fanduel']})); render(); }")
        try:
            row = rows()[0]
            self.assertIn("o19.5 -160 DK", row)
            self.assertIn("+4.5", row)  # 66% - the 61.5% -160 needs
        finally:
            PAGE.evaluate("() => { localStorage.removeItem('nfl-tool.my-books.v1'); render(); }")

    def test_a_game_card_narrows_the_list(self):
        PAGE.click("#matchup-row [data-game='901']")
        try:
            self.assertEqual(rows(), [])
            self.assertIn("NO PLAYS IN THIS GAME", PAGE.inner_text("#sim-list").upper())
        finally:
            PAGE.click("#matchup-row [data-game='901']")
        self.assertEqual(len(rows()), 1)


class Record(unittest.TestCase):
    def test_tiles_and_the_popup(self):
        tiles = text("#sim-record > div")
        self.assertTrue(tiles[0].endswith("1-0 +3.0u"), tiles)  # yesterday
        self.assertTrue(tiles[1].endswith("1-0 +3.0u"), tiles)  # Top Plays
        self.assertTrue(tiles[2].endswith("1-1 +2.0u"), tiles)  # season
        PAGE.click("#sim-ytd")
        PAGE.wait_for_selector("#sim-ytd-modal:not([hidden]) .ytd-box, #sim-ytd-modal:not([hidden]) .sim-ytd-tracker")
        body = PAGE.inner_text("#sim-ytd-modal").upper()
        for split in ("TOP PLAY", "STRONG PLAYS", "SCRIPT-PROOF", "CHAOS PLAYS", "NEEDS A CLOSE GAME", "LADDER RUNGS", "SPOT DIALS"):
            self.assertIn(split, body)
        PAGE.evaluate("() => { document.getElementById('sim-ytd-modal').hidden = true; }")


class Board(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        PAGE.click("[data-view='matchup']")

    @classmethod
    def tearDownClass(cls):
        PAGE.click("[data-view='player']")

    def test_the_game_picker(self):
        cards = text("#matchup-row .matchup-card")
        self.assertEqual(len(cards), 2)
        self.assertIn("Play", cards[0])
        self.assertNotIn("Play", cards[1])

    def test_both_teams_medians_main_line_and_rungs(self):
        heads = text(".sim-table thead tr:last-child th")
        self.assertEqual(heads, ["NAME", "MIN", "MEDIAN", "AAA BY 10+", "CLOSE", "BBB BY 10+", "MAIN LINE", "10+", "15+", "20+", "25+", "30+", "35+", "40+"])
        rows = text(".sim-table tbody tr")
        self.assertIn("TEAM AAA", rows[0].upper())
        self.assertIn("REST EDGE", rows[0].upper())
        one = PAGE.evaluate("() => [...document.querySelectorAll('.sim-table tbody tr')][1].innerText.replace(/\\s+/g, ' ')")
        self.assertIn("Player One", one)
        self.assertIn("34.5 20 17 20 22", one)  # minutes, median, then by script
        self.assertIn("O 19.5 · 66%", one)  # 66% over 19.5 at -150: the better side
        self.assertIn("36%", one)  # 30+
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.sim-table td.sim-rung.main.pick')"))  # tonight's play outlined
        self.assertIn("-150", PAGE.inner_text(".sim-table td.sim-rung.pick"))

    def test_the_script_picker_reprices_from_one_script(self):
        PAGE.click("[data-script='home']")
        try:
            self.assertIn("80%", PAGE.inner_text(".sim-table td.sim-rung.pick"))  # BBB blowouts only
            self.assertIn("BBB BLOWOUTS ONLY", PAGE.inner_text(".sim-table thead").upper())
        finally:
            PAGE.click("[data-script='all']")
        self.assertIn("66%", PAGE.inner_text(".sim-table td.sim-rung.pick"))

    def test_another_game(self):
        PAGE.click("#matchup-row [data-game='901']")
        try:
            self.assertIn("Team CCC", PAGE.inner_text(".sim-gbar"))
        finally:
            PAGE.click("#matchup-row [data-game='900']")


class PastNight(unittest.TestCase):
    def test_the_arrows_step_back_to_a_graded_night(self):
        PAGE.click("#day-prev")
        try:
            self.assertIn("RESULTS", PAGE.inner_text("#sim-list-note").upper())
            night = text(".sim-night")[0].upper()
            self.assertIn("1-1", night)
            self.assertIn("+0.50U", night)  # +1.50 at +150, -1 at -110
            self.assertIn("TOP PLAY HIT", night)
            past = [r.upper() for r in rows()]
            self.assertEqual(len(past), 2)
            self.assertIn("HIT 31", past[0])
            self.assertIn("30+ +150", past[0])  # the price locked at tip, not tonight's
            self.assertIn("+1.50U", past[0])
            self.assertIn("MISS 15", past[1])
            self.assertIn("U12.5 -110", past[1])
            self.assertTrue(PAGE.evaluate("() => document.querySelector('#sim-list tr.sim-row.past').classList.contains('won')"))
            self.assertEqual(SITE.errors, [])
        finally:
            PAGE.click("#day-next")
        self.assertNotIn("RESULTS", PAGE.inner_text("#sim-list-note").upper())


class Menu(unittest.TestCase):
    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/points.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
