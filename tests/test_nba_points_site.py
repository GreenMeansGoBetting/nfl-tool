"""The NBA Points page (site/nba/points.html + points.js on the game sim's
shared sim-board.js, 2026-10-24) on hand-made data.

What is pinned: Tonight's Plays (the Top Play's card: the play as a rung
"30+ Points", the best price across the member's books with its book, Hit In
x of 10,000, GMG Fair, the edge at that price, the three scripts against what
the price needs, the Chaos tag, the histogram; My Books changes the price and
the edge; a game with no play is named); the record tiles (Yesterday / Top
Plays / Season, units) and the Model Performance popup's splits; the game
picker (a card per game, "Play" on the game with one); the game board (both
teams, minutes, medians by script, the main line, every rung with our chance
and the best price, tonight's play outlined) and the Script Picker re-pricing
the rungs from one script's games; the page is in the NBA menu."""
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
    play = {"game": "900", "date": "2026-10-21", "pid": "1", "team": "AAA", "opp": "BBB", "stat": market, "side": "o", "line": rung_line,
            "price": 300, "book": "draftkings", "chance": 0.36, "edge": 0.11, "main": False, "tier": "top", "kind": "chaos",
            "scripts": {"away": 0.36, "close": 0.30, "home": 0.60}, "dials": ["rest_edge"], "med": 20}
    props = {
        "default": "2027",
        "seasons": {"2027": {"label": "2026-27", "fields": [], "players": {"1": {"name": "Player One", "team": "AAA", "pos": "SF", "log": []},
                                                                            "2": {"name": "Player Two", "team": "BBB", "pos": "C", "log": []}}, "out": {}}},
        "sim": {"900": game, "901": quiet},
        "sim_plays": {market: [play], ("threes" if market == "points" else "points"): []},
        "sim_record": {market: {"ledger": [["2026-10-11", 0.08, 1, 3.0, ["top", "over", "alt", "chaos"]],
                                           ["2026-10-05", 0.05, 0, -1.0, ["strong", "under", "main", "proof"]]]}},
        # a past night (2026-10-25): the saved plays graded, reached with the day arrows
        "sim_past": {market: [{**play, "game": "800", "date": "2026-10-20", "price": 150, "book": "fanduel", "opp": "BBB", "home": False,
                               "got": 31 if stat == "pts" else 4, "result": "won", "locked": True},
                              {**play, "game": "801", "date": "2026-10-20", "pid": "2", "team": "BBB", "opp": "CCC", "home": True, "tier": "strong",
                               "kind": "proof", "side": "u", "line": 12.5, "main": True, "price": -110, "got": 15 if stat == "pts" else 3,
                               "result": "lost", "dials": [], "locked": True}],
                     ("threes" if market == "points" else "points"): []},
        "sim_meta": {"n": 10000, "script_margin": 10, "min_edge": 0.04, "max_plays": 8,
                     "dials": {"rest_edge": ["Rest Edge", -0.72, 1.89], "b2b": ["Back-To-Back", -0.84, 0.58]}},
    }
    main_q = [["draftkings", "o", line, -110], ["draftkings", "u", line, -110], ["fanduel", "o", line, -105]]
    alt_q = [["draftkings", "o", rung_line, 300], ["fanduel", "o", rung_line, 280]]
    data = {"season": 2027, "season_label": "2026-27", "injuries": {}, "players": {},
            "schedule": [{"game_id": "900", "date": "2026-10-21", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled",
                          "home_team_spread": -4.5, "total_line": 221.5},
                         {"game_id": "901", "date": "2026-10-21", "time": "20:00", "away": "CCC", "home": "DDD", "status": "scheduled"}],
            "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB", "CCC", "DDD")},
            "book_odds": {"AAA_BBB": {"kickoff": "2026-10-21T23:30:00Z", "td": {}, "lines": {},
                                      "props": {market: {"1": {"name": "Player One", "q": main_q}},
                                                f"{market}_alt": {"1": {"name": "Player One", "q": alt_q}}}}}}
    return data, props


DATA, PROPS = build("points", "pts", 19.5, 29.5, "30+")


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props = DATA, PROPS
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


class Plays(unittest.TestCase):
    def test_the_top_play_card(self):
        self.assertEqual(SITE.errors, [])
        cards = text(".sim-play")
        self.assertEqual(len(cards), 1)
        card = cards[0].upper()
        self.assertIn("TOP PLAY", card)
        self.assertIn("30+ POINTS", card)
        self.assertIn("+300", card)  # DraftKings' +300 beats FanDuel's +280
        self.assertIn("DK", card)
        self.assertIn("3,600 OF 10,000", card)
        self.assertIn("+178", card)  # 36% with no cut
        self.assertIn("+11.0", card)  # 36% - the 25% +300 needs
        self.assertIn("AAA BLOWOUT 36%", card)
        self.assertIn("CLOSE GAME 30%", card)
        self.assertIn("BBB BLOWOUT 60%", card)
        self.assertIn("CHAOS PLAY", card)
        self.assertIn("AAA REST EDGE", card)  # whose dial it is
        self.assertTrue(PAGE.evaluate("() => document.querySelectorAll('.sim-play.top .sim-hist div').length > 3"))
        self.assertIn("CCC @ DDD", text("#sim-plays")[0])  # the game with no play

    def test_my_books_set_the_price_and_the_edge(self):
        PAGE.evaluate("() => { localStorage.setItem('nfl-tool.my-books.v1', JSON.stringify({hidden: ['draftkings']})); render(); }")
        try:
            card = text(".sim-play")[0]
            self.assertIn("+280", card)
            self.assertIn("+9.7", card)  # 36% - the 26.3% +280 needs
        finally:
            PAGE.evaluate("() => { localStorage.removeItem('nfl-tool.my-books.v1'); render(); }")


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
        self.assertIn("O 19.5 · 66%", one)  # 66% over 19.5 at -105: the better side
        self.assertIn("36%", one)  # 30+
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.sim-table td.sim-rung.pick')"))  # tonight's play outlined
        self.assertIn("+300", PAGE.inner_text(".sim-table td.sim-rung.pick"))

    def test_the_script_picker_reprices_from_one_script(self):
        PAGE.click("[data-script='home']")
        try:
            self.assertIn("60%", PAGE.inner_text(".sim-table td.sim-rung.pick"))  # BBB blowouts only
            self.assertIn("BBB BLOWOUTS ONLY", PAGE.inner_text(".sim-table thead").upper())
        finally:
            PAGE.click("[data-script='all']")
        self.assertIn("36%", PAGE.inner_text(".sim-table td.sim-rung.pick"))

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
            self.assertEqual(PAGE.text_content("#sim-plays-title"), "Results")
            night = text(".sim-night")[0].upper()
            self.assertIn("1-1", night)
            self.assertIn("+0.50U", night)  # +1.50 at +150, -1 at -110
            self.assertIn("TOP PLAY HIT", night)
            cards = [c.upper() for c in text(".sim-play")]
            self.assertEqual(len(cards), 2)
            self.assertIn("HIT", cards[0])
            self.assertIn("+150", cards[0])  # the price locked at tip, not tonight's
            self.assertIn("AAA @ BBB", cards[0])
            self.assertIn("MISS", cards[1])
            self.assertIn("UNDER 12.5", cards[1])
            self.assertTrue(PAGE.evaluate("() => document.querySelector('.sim-play.past').classList.contains('won')"))
            self.assertIn("upcoming games", PAGE.inner_text("#sim-board"))
            self.assertEqual(SITE.errors, [])
        finally:
            PAGE.click("#day-next")
        self.assertEqual(PAGE.text_content("#sim-plays-title"), "Tonight's Plays")


class Menu(unittest.TestCase):
    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/points.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
