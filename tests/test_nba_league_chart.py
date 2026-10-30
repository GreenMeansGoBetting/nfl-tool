"""NBA League Stats Chart (site/nba/league.html + league.js; build_nba.py league_chart, 2026-10-30).

What is pinned: the build's windows (season, last 10 / 5 / 3: each team's own last games), the ATS
and over / under records against the line at tip, offense and defense read from the same games;
the page: every stat column one width (the owner: "I JUST WANT COLUMNS ALL equal"), whole numbers
only, green = good for that team (defense: allowing the least), sorting best first then worst
first, Show Rank, Today's Teams Only, a game card pulling its two teams to the top (again = back),
the window buttons, and a logo opening that team's game in Matchup Breakdown."""
import json
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402


def box_row(gid, date, team, opp, home, pts, opp_pts, threes):
    return {"game_id": gid, "game_date": date, "season_type": build_nba.REGULAR_SEASON, "team_abbreviation": team,
            "opponent_team_abbreviation": opp, "team_home_away": "home" if home else "away", "team_score": pts,
            "team_winner": pts > opp_pts, "field_goals_made": 40, "field_goals_attempted": 88,
            "three_point_field_goals_made": threes, "three_point_field_goals_attempted": 36, "free_throws_made": 18,
            "free_throws_attempted": 22, "offensive_rebounds": 10, "defensive_rebounds": 33, "assists": 25, "steals": 7,
            "blocks": 5, "turnovers": 13, "total_turnovers": 14, "fast_break_points": "12", "points_in_paint": "48",
            "turnover_points": "15"}


def game(gid, date, away, home, away_pts, home_pts, away_3s=12, home_3s=12):
    return [box_row(gid, date, away, home, False, away_pts, home_pts, away_3s),
            box_row(gid, date, home, away, True, home_pts, away_pts, home_3s)]


class Build(unittest.TestCase):
    def setUp(self):
        # BOS plays four games; its threes climb, so its last 3 differ from its season.
        rows = (game(1, "2026-10-21", "BOS", "NY", 110, 100, 10, 12) + game(2, "2026-10-23", "NY", "BOS", 120, 100, 14, 12)
                + game(3, "2026-10-25", "BOS", "NY", 105, 104, 15, 9) + game(4, "2026-10-27", "NY", "BOS", 99, 121, 8, 19))
        self.rows = build_nba.team_game_rows(pd.DataFrame(rows))
        # [total, home spread] at tip; game 4 has no line
        self.lines = {"1": [205.5, -3.0], "2": [215.0, 2.0], "3": [209.0, 1.0]}

    def test_ats_and_over_under_read_the_line_from_each_side(self):
        recs = build_nba.ats_records(self.rows, self.lines)
        # BOS: g1 away +3 won by 10 (cover); g2 home +2 lost by 20 (miss); g3 away -1 won by 1 (push)
        self.assertEqual(recs["BOS"]["ats"], [1, 1, 1])
        self.assertEqual(recs["NY"]["ats"], [1, 1, 1])
        # totals: 210 over 205.5, 220 over 215, 209 push on 209
        self.assertEqual(recs["BOS"]["ou"], [2, 0, 1])

    def test_windows_are_each_teams_last_games(self):
        chart = build_nba.league_chart(self.rows, self.lines, None)
        self.assertEqual(set(chart), {"season", "10", "5", "3"})
        self.assertEqual(chart["season"]["BOS"]["games"], 4)
        self.assertEqual(chart["3"]["BOS"]["games"], 3)
        self.assertEqual(chart["season"]["BOS"]["o_3pm"], 14.0)  # (10 + 12 + 15 + 19) / 4
        self.assertAlmostEqual(chart["3"]["BOS"]["o_3pm"], 15.3, places=1)  # (12 + 15 + 19) / 3
        # its defense is its opponents' offense in the same games
        self.assertEqual(chart["season"]["BOS"]["d_3pm"], chart["season"]["NY"]["o_3pm"])
        self.assertEqual(chart["season"]["BOS"]["d_ppg"], chart["season"]["NY"]["o_ppg"])
        self.assertAlmostEqual(chart["season"]["BOS"]["margin"], 3.25, delta=0.06)  # (10 - 20 + 1 + 22) / 4
        self.assertEqual(chart["season"]["BOS"]["total"], round((210 + 220 + 209 + 220) / 4, 1))
        # the last 3 games' records skip the one without a line
        self.assertEqual(chart["3"]["BOS"]["ats"], [0, 1, 1])
        # the paint / mid-range / transition / ball movement numbers come from the engine when it has them
        self.assertIsNone(chart["season"]["BOS"]["o_paint_share"])
        ident = {"teams": {"BOS": {"off_paint_share": 0.41}}, "recent": {"3": {"BOS": {"off_paint_share": 0.45}}}}
        chart = build_nba.league_chart(self.rows, self.lines, ident)
        self.assertEqual(chart["season"]["BOS"]["o_paint_share"], 0.41)
        self.assertEqual(chart["3"]["BOS"]["o_paint_share"], 0.45)
        self.assertGreater(chart["season"]["BOS"]["d_reb"], 0.5)  # its defensive rebound rate, not the opponents' offensive one


def chart_row(i, **kw):
    """A team's numbers; i spreads them out so every column ranks differently."""
    row = {"games": 5, "pace": 98.0 + i, "net": 5.0 - i, "margin": 6.0 - i, "total": 220.0 + i, "ats": [3 - i % 3, 2, 0], "ou": [2, 3, 0],
           "o_reb": 0.25 + i / 100, "d_reb": 0.70 + i / 100}
    for side in ("o", "d"):
        row.update({f"{side}_ppg": 110.4 + i, f"{side}_rtg": 112.6 + i, f"{side}_3pm": 12.4 + i, f"{side}_3par": 0.40 + i / 100,
                    f"{side}_ftr": 0.25 + i / 100, f"{side}_tov": 0.13 + i / 100, f"{side}_paint_share": 0.38, f"{side}_paint_pct": 0.56,
                    f"{side}_mid_share": 0.15, f"{side}_mid_pct": 0.42, f"{side}_trans_freq": 0.15, f"{side}_trans_ppp": 1.12 + i / 100,
                    f"{side}_ball_move": 0.5})
    row.update(kw)
    return row


TEAMS = ("BOS", "NY", "DET", "MIA")


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS}
        season = {t: chart_row(i) for i, t in enumerate(TEAMS)}
        season["DET"]["d_ppg"] = 101.2  # the league's stingiest defense
        last3 = {t: chart_row(3 - i) for i, t in enumerate(TEAMS)}
        today = __import__("datetime").date.today().isoformat()
        schedule = [{"game_id": "77", "date": today, "time": "19:30", "start_utc": f"{today}T23:30Z", "away": "DET", "home": "MIA", "status": "scheduled"}]
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": schedule,
                    "league_chart": {"season": season, "10": season, "5": season, "3": last3}}
        PAGE = SITE.open("nba/league.html")
        PAGE.wait_for_function("() => document.querySelectorAll('.lsc-grid tbody tr').length === 4")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


ORDER = "() => [...document.querySelectorAll('.lsc-grid tbody tr:not(.lsc-spacer) .lsc-logo')].map((b) => b.dataset.team)"


def cell(team, key):
    """{text, title} of a team's cell in column `key`."""
    return PAGE.evaluate("""([team, key]) => {
        const keys = [...document.querySelectorAll('.lsc-grid .od-glabels th')].map((th) => th.dataset.sort || '');
        const tr = document.querySelector(`.lsc-logo[data-team="${team}"]`).closest('tr');
        const td = tr.children[keys.indexOf(key)];
        const tile = td.querySelector('.lsc-tile');
        return {text: tile.textContent.trim(), title: tile.title};
    }""", [team, key])


class Page(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("""() => {
            Object.assign(view, {window: 'season', rank: false, today: false, sort: 'net', dir: 1});
            pinned = null;
            render();
        }""")

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_every_stat_column_is_one_width(self):
        widths = PAGE.evaluate("() => [...document.querySelectorAll('.lsc-grid .od-glabels th.lsc-sort')].map((th) => th.offsetWidth)")
        self.assertEqual(len(widths), 34)
        self.assertEqual(len(set(widths)), 1, widths)
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.lsc-grid .od-ggroups th')].map((th) => th.textContent.trim()).filter(Boolean)")
        self.assertEqual(heads, ["Offense", "Defense (Allowed)", "Game & Betting"])

    def test_whole_numbers_and_green_is_good_for_that_team(self):
        texts = PAGE.evaluate("() => [...document.querySelectorAll('.lsc-tile b')].map((b) => b.textContent)")
        self.assertFalse([t for t in texts if "." in t])
        self.assertEqual(cell("BOS", "o_ppg")["text"], "110")
        self.assertEqual(cell("BOS", "o_3par")["text"], "40")  # a percent
        self.assertEqual(cell("BOS", "o_trans_ppp")["text"], "112")  # a 100 possessions
        self.assertEqual(cell("BOS", "net")["text"], "+5")
        self.assertEqual(cell("BOS", "ats")["text"], "3-2")
        self.assertIn("110.4", cell("BOS", "o_ppg")["title"])  # the exact number in the hover
        # offense: the most is 1st; defense: allowing the least is 1st; forced turnovers: the most
        self.assertIn("1st of 4", cell("MIA", "o_3pm")["title"])
        self.assertIn("1st of 4", cell("DET", "d_ppg")["title"])
        self.assertIn("1st of 4", cell("MIA", "d_tov")["title"])
        self.assertIn("1st of 4", cell("BOS", "o_tov")["title"])  # its own turnovers: the fewest

    def test_sorting_best_first_then_worst_first(self):
        self.assertEqual(PAGE.evaluate(ORDER), ["BOS", "NY", "DET", "MIA"])  # opens on Net Rating, best first
        PAGE.click('th[data-sort="d_ppg"]')
        self.assertEqual(PAGE.evaluate(ORDER)[0], "DET")
        PAGE.click('th[data-sort="o_3pm"]')
        self.assertEqual(PAGE.evaluate(ORDER), ["MIA", "DET", "NY", "BOS"])
        PAGE.click('th[data-sort="o_3pm"]')
        self.assertEqual(PAGE.evaluate(ORDER), ["BOS", "NY", "DET", "MIA"])

    def test_show_rank_and_the_window_buttons(self):
        PAGE.click("#lsc-rank")
        self.assertEqual(cell("MIA", "o_3pm")["text"], "1st")
        PAGE.click("#lsc-rank")
        PAGE.click('[data-window="3"]')
        self.assertEqual(cell("BOS", "o_ppg")["text"], "113")  # last 3: chart_row(3)
        self.assertTrue(PAGE.evaluate("() => document.querySelector('[data-window=\"3\"]').classList.contains('active')"))

    def test_todays_teams_only(self):
        PAGE.click("#lsc-today")
        self.assertEqual(sorted(PAGE.evaluate(ORDER)), ["DET", "MIA"])

    def test_a_game_card_pulls_its_teams_to_the_top_and_back(self):
        PAGE.click('.matchup-card[data-game="77"]')
        self.assertEqual(PAGE.evaluate(ORDER), ["DET", "MIA", "BOS", "NY"])
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('tr.lsc-top').length"), 2)
        # everyone else goes gray (the owner: "too busy with all the colors")
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('tr.lsc-dim').length"), 2)
        self.assertEqual(PAGE.evaluate("() => getComputedStyle(document.querySelector('tr.lsc-dim .lsc-tile')).filter"), "grayscale(1)")
        self.assertEqual(PAGE.evaluate("() => getComputedStyle(document.querySelector('tr.lsc-top .lsc-tile')).filter"), "none")
        self.assertTrue(PAGE.evaluate("() => document.querySelector('.matchup-card[data-game=\"77\"]').classList.contains('selected')"))
        PAGE.click('.matchup-card[data-game="77"]')
        self.assertEqual(PAGE.evaluate(ORDER), ["BOS", "NY", "DET", "MIA"])
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('tr.lsc-top, tr.lsc-dim').length"), 0)

    def test_no_outline_on_any_tile(self):
        # the owner, 2026-10-30, on a green ring around the tiles: "i hate it"
        PAGE.click('.matchup-card[data-game="77"]')
        shown = PAGE.evaluate("""() => [...document.querySelectorAll('.lsc-tile')].map((t) => {
            const s = getComputedStyle(t);
            return [s.borderTopWidth, s.boxShadow].join(' ');
        })""")
        self.assertEqual(set(shown), {"0px none"})

    def test_a_logo_opens_that_teams_game_in_matchup_breakdown(self):
        before = list(SITE.errors)  # Matchup Breakdown on this thin data.json isn't what's tested here
        PAGE.click('.lsc-logo[data-team="MIA"]')
        PAGE.wait_for_url("**/nba/")
        self.assertEqual(PAGE.evaluate("() => localStorage.getItem('nba-tool.game.v1')"), "77")
        PAGE.goto(PAGE.url + "league.html")
        PAGE.wait_for_function("() => document.querySelectorAll('.lsc-grid tbody tr').length === 4")
        SITE.errors[:] = before


if __name__ == "__main__":
    unittest.main()
