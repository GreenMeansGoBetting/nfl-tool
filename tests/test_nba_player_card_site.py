"""The NBA player card (site/nba/nba-card.js) on hand-made data, opened from the Points page.

What is pinned (the owner, 2026-10-21: the NBA card like the NFL and NHL ones, "game log and odds
for all markets with checkboxes", game logs "only for this season, do not add past years"): a
player's name opens the card (not the Points row under it); the Game Log is this season's games
only, newest first, with a per-game row on top; the Odds tab lists every market a book prices
(main line, best price per side, how often he cleared the line this season) plus First Basket;
a box saves the side to My Plays at the best price, and checking the other side switches the
play; the card also opens from the other NBA pages. The Shot Chart tab (2026-10-21, the owner:
"both with toggle is great as well as filters", this season only): zones named by the shooter's
side (x below 25 = left), Zones / Heat Map, and every filter."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta",
          "fgm", "ftm", "reb", "ast", "stl", "blk", "tov", "pf", "pm", "score", "opp_score"]


def row(day, game, pts, reb, ast, start=1):
    return [f"2026-10-{day:02d}", game, "CCC", game % 2, start, 30, pts, 15, 2, 5, 4, 7, 3, reb, ast, 1, 0, 2, 2, 4, 110, 100 + game]


GAME = {"game_id": "900", "date": "2026-10-25", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled"}
# This season: three games (points 25, 18, 30; rebounds 6, 9, 4; assists 5, 7, 3).
P1 = {"name": "Player One", "team": "AAA", "pos": "PG", "share": 0.3, "zones": {}, "kinds": {}, "with": {},
      "log": [row(20, 1, 25, 6, 5), row(21, 2, 18, 9, 7, start=0), row(23, 3, 30, 4, 3)]}
LAST_SEASON = {"name": "Player One", "team": "AAA", "pos": "PG", "log": [["2026-03-01", 500, "CCC", 1, 1, 30, 40, 15, 2, 5, 4]] * 20}
LAD = [20, [1000, 500, 500, 500, 500, 500, 500, 500, 500, 0]]  # sim.ladder: half 20, half 28
PROPS = {
    "default": "2027",
    "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": {"1": P1}, "out": {}},
                "2026": {"label": "2025-26", "fields": FIELDS[:11], "players": {"1": LAST_SEASON}, "out": {}}},
    # the Points page's game sim: Player One in game 900
    "sim": {"900": {"date": "2026-10-25", "home": "BBB", "away": "AAA", "margin": 2.0, "total": 220.0, "scripts": {"away": 0.2, "close": 0.6, "home": 0.2},
                    "base": {"away": 0.2, "close": 0.6, "home": 0.2}, "dials": {"away": [], "home": []}, "starters": {"away": ["1"], "home": []}, "lineup": False,
                    "players": {"1": {"team": "away", "min": 30.0, "name": "Player One",
                                      "pts": {"med": {"all": 24, "away": 24, "close": 24, "home": 24}, "mean": 24, "lad": {"all": LAD}},
                                      "fg3m": {"med": {"all": 2, "away": 2, "close": 2, "home": 2}, "mean": 2, "lad": {"all": [0, [1000]]}}}}}},
    "sim_plays": {"points": [], "threes": []}, "sim_record": {}, "sim_meta": {"dials": {}},
}


def quotes(line, over_dk=-110, over_fd=105):
    return [["draftkings", "o", line, over_dk, ""], ["fanduel", "o", line, over_fd, ""], ["draftkings", "u", line, -110, ""], ["fanduel", "u", line, -125, ""]]


DATA = {"season": 2027, "season_label": "2026-27", "schedule": [GAME], "injuries": {}, "identity": None,
        "teams": {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in ("AAA", "BBB", "CCC")},
        "players": {"AAA": [{"id": "1", "name": "Player One", "position": "PG"}]},
        "book_odds": {"AAA_BBB": {"kickoff": "2026-10-25T23:30:00Z", "td": {}, "lines": {}, "props": {
            "points": {"1": {"name": "Player One", "q": quotes(24.5)}},
            # one book a point off: the line most books hang is the one shown
            "rebounds": {"1": {"name": "Player One", "q": quotes(6.5) + [["betmgm", "o", 7.5, 120, ""]]}},
            "pra": {"1": {"name": "Player One", "q": quotes(38.5)}},
            "first_basket": {"1": {"name": "Player One", "q": [["draftkings", "o", None, 600, ""]]}},
        }}}}


# shots.json: [x, y, made, three, game index, flags (1 = 1st qtr, 2 = first 3 min), kind (1 self, 2 catch, 3 drive)]
SHOTS = {"season": 2027, "label": "2026-27", "games": [11, 12, 13, 14, 15, 16], "players": {"1": [
    [25, 1, 1, 0, 0, 3, 3], [25, 2, 0, 0, 1, 1, 3],  # at the rim, the first in the game's first 3 minutes
    [3, 2, 1, 1, 2, 0, 2], [2, 4, 0, 1, 3, 0, 2],  # left corner 3s (x below 25 = the shooter's left)
    [47, 3, 1, 1, 4, 0, 2],  # right corner 3
    [25, 26, 1, 1, 5, 0, 1], [25, 27, 0, 1, 5, 0, 1],  # top 3s, self-created, in the newest game
    [12, 4, 0, 0, 5, 0, 1],  # left baseline mid-range
]}, "league": [[25, 1, 0, 60, 100], [3, 2, 1, 40, 100], [47, 3, 1, 40, 100], [25, 26, 1, 35, 100], [12, 4, 0, 40, 100]]}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_props, SITE.nba_shots = DATA, PROPS, SHOTS
        PAGE = SITE.open("nba/points.html")
        PAGE.wait_for_function("() => !document.getElementById('sim-app').hidden")
        PAGE.evaluate("() => localStorage.removeItem('nfl-tool.nba-plays.v1')")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def open_card(tab=None):
    PAGE.click(".sim-table .player-click[data-nba-player='1']")
    PAGE.wait_for_selector("#player-card-modal:not([hidden]) .pc-name")
    if tab:
        PAGE.click(f"#player-card-modal .nba-pc-tab[data-tab='{tab}']")


def close_card():
    PAGE.keyboard.press("Escape")


def table(selector):
    return PAGE.evaluate(f"() => [...document.querySelectorAll('{selector} tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim()))")


class GameLog(unittest.TestCase):
    def test_the_name_opens_the_card_not_the_row(self):
        open_card()
        try:
            self.assertEqual(PAGE.text_content("#player-card-modal .pc-name"), "Player One")
        finally:
            close_card()
        self.assertEqual(SITE.errors, [])

    def test_this_season_only_newest_first_with_a_per_game_row(self):
        open_card()
        try:
            rows = table(".nba-pc-log")
            self.assertEqual(len(rows), 4)  # per game + three games; last season's 20 never show
            self.assertEqual(rows[0][0], "Per Game (3)")
            # Min, Pts, Reb, Ast after the colspan cell
            self.assertEqual(rows[0][1:5], ["30.0", "24.3", "6.3", "5.0"])
            self.assertEqual([r[0] for r in rows[1:]], ["Oct 23", "Oct 21", "Oct 20"])
            game3 = rows[1]
            self.assertEqual(game3[2], "W 110-103")
            self.assertEqual(game3[4:8], ["30", "4", "3", "2"])  # pts, reb, ast, 3PM
            self.assertIn("B", rows[2][3])  # Oct 21: off the bench
            self.assertIn("7-15", game3)  # FG made - tried
            tiles = PAGE.evaluate("() => [...document.querySelectorAll('.nba-pc-tiles .nba-tile b')].map((b) => b.textContent)")
            self.assertEqual(tiles[:3], ["3", "30.0", "24.3"])
        finally:
            close_card()


class Odds(unittest.TestCase):
    def test_every_priced_market_with_best_prices_and_hit_rates(self):
        open_card("odds")
        try:
            rows = {r[0]: r[1:] for r in table(".nba-pc-odds")}
            self.assertEqual(list(rows), ["Points", "Rebounds", "Pts + Reb + Ast", "First Basket"])
            line, over, under, season = rows["Points"]
            self.assertEqual(line, "24.5")
            self.assertIn("+105", over)  # FanDuel's Over
            self.assertIn("-110", under)  # DraftKings' Under
            self.assertEqual(season, "2 of 3")  # 25 and 30 over 24.5
            self.assertEqual(rows["Rebounds"][0], "6.5")  # BetMGM's 7.5 is the odd one out
            self.assertEqual(rows["Rebounds"][3], "1 of 3")
            self.assertEqual(rows["Pts + Reb + Ast"][3], "0 of 3")  # 36, 34, 37 against 38.5
        finally:
            close_card()

    def test_a_box_saves_the_side_and_the_other_side_switches_it(self):
        open_card("odds")
        try:
            boxes = PAGE.locator(".nba-pc-odds tbody tr:first-child .nba-pc-toggle")
            boxes.nth(0).check()
            saved = PAGE.evaluate("() => loadNbaPlays()")
            self.assertEqual(len(saved), 1)
            play = saved[0]
            self.assertEqual((play["id"], play["market"], play["side"], play["line"], play["book"], play["odds"]),
                             ("nba:points:900:1", "points", "over", 24.5, "fanduel", 105))
            self.assertEqual(play["description"], "Player One Over 24.5 points")
            PAGE.locator(".nba-pc-odds tbody tr:first-child .nba-pc-toggle").nth(1).check()
            saved = PAGE.evaluate("() => loadNbaPlays()")
            self.assertEqual([(p["side"], p["odds"]) for p in saved], [("under", -110)])
            self.assertFalse(PAGE.locator(".nba-pc-odds tbody tr:first-child .nba-pc-toggle").nth(0).is_checked())
            # First Basket saves like the First Basket page does
            PAGE.locator(".nba-pc-odds tbody tr:last-child .nba-pc-toggle").check()
            fb = [p for p in PAGE.evaluate("() => loadNbaPlays()") if p["market"] == "first_basket"]
            self.assertEqual((fb[0]["id"], fb[0]["side"], fb[0]["line"], fb[0]["odds"]), ("nba:fb:900:1", None, None, 600))
        finally:
            PAGE.evaluate("() => localStorage.removeItem('nfl-tool.nba-plays.v1')")
            close_card()
        self.assertEqual(SITE.errors, [])


class ShotChart(unittest.TestCase):
    def zones(self):
        """{"Zone|Group": "made/tried"} from the zone table."""
        return PAGE.evaluate("""() => {
            const out = {};
            let group = "";
            document.querySelectorAll('#player-card-modal .nba-shot-table tbody tr').forEach((tr) => {
              if (tr.classList.contains('nba-shot-group')) group = tr.textContent.trim();
              else out[`${tr.cells[0].textContent}|${group}`] = tr.cells[1].textContent;
            });
            return out;
          }""")

    def pick(self, key, value):
        PAGE.click(f"#player-card-modal .nba-shot-opt[data-shot-key='{key}'][data-shot-value='{value}']")
        PAGE.wait_for_selector(f"#player-card-modal .nba-shot-opt.active[data-shot-key='{key}'][data-shot-value='{value}']")

    def shots(self):
        return PAGE.inner_text("#player-card-modal .nba-shot-sum b")

    def test_zones_heat_map_and_filters(self):
        open_card("shots")
        try:
            PAGE.wait_for_selector("#player-card-modal .nba-shot-table")
            z = self.zones()
            self.assertEqual(z["At The Rim|Close"], "1/2")
            self.assertEqual(z["Left Corner|Threes"], "1/2")  # x 2-3: the shooter's left
            self.assertEqual(z["Right Corner|Threes"], "1/1")
            self.assertEqual(z["Top|Threes"], "1/2")
            self.assertEqual(z["Left Baseline|Mid-Range"], "0/1")
            self.assertEqual(z["Right Wing|Threes"], "--")
            self.assertEqual(self.shots(), "8")
            # Heat Map: one hexagon a spot here, the zone table stays
            self.pick("view", "heat")
            self.assertEqual(PAGE.locator("#player-card-modal .nba-shot-hex").count(), 8)
            self.pick("view", "zones")
            self.pick("pts", "3")
            self.assertEqual(self.shots(), "5")
            self.pick("pts", "all")
            self.pick("kind", "1")
            self.assertEqual(self.shots(), "3")
            self.pick("kind", "all")
            self.pick("time", "open")
            self.assertEqual(self.shots(), "1")
            self.pick("time", "q1")
            self.assertEqual(self.shots(), "2")
            self.pick("time", "all")
            self.pick("games", "5")  # his last 5 games: indexes 1-5
            self.assertEqual(self.shots(), "7")
            self.pick("games", "all")
        finally:
            close_card()
        self.assertEqual(SITE.errors, [])


class OtherPages(unittest.TestCase):
    def test_every_nba_page_with_players_loads_the_card(self):
        for page in ("index.html", "points.html", "first-basket.html", "promo-tools.html", "shot-charts.html"):
            html = (ROOT / "nfl_tool" / "site" / "nba" / page).read_text(encoding="utf-8")
            self.assertIn('<script src="shot-chart.js"></script>\n<script src="nba-card.js"></script>', html, page)
            self.assertIn('<script src="../book-odds.js"></script>', html, page)


if __name__ == "__main__":
    unittest.main()
