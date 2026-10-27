"""NBA Game Previews' season buttons (build_nba.py stats_block / stats_default,
site/nba/nba.js renderSeasons / setSeason).

What is pinned: the build keeps each season's numbers apart (last season's
players on today's rosters, this season's on their box score team); a season
with no regular-season game has no block; the page opens on last season until
the middle team has played THIS_SEASON_DEFAULT_AT games, then on this one; the
buttons switch every number on the page; a member's pick is remembered only
until the build's default changes; a data.json without stat_seasons still
shows its one season."""
import sys
import unittest
from pathlib import Path

import pandas as pd

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402

TEAMS = {"AAA": {}, "BBB": {}}


def team_box(games, season_type=2):
    """Two teams playing each other `games` times; AAA scores 110 + game, BBB 100."""
    rows = []
    for g in range(games):
        for team, opp, home, pts in (("AAA", "BBB", "home", 110 + g), ("BBB", "AAA", "away", 100)):
            rows.append({
                "game_id": g, "game_date": f"2026-10-{21 + g}", "team_abbreviation": team, "opponent_team_abbreviation": opp,
                "team_home_away": home, "team_score": pts, "team_winner": team == "AAA", "season_type": season_type,
                "field_goals_made": 40, "field_goals_attempted": 88, "three_point_field_goals_made": 12, "three_point_field_goals_attempted": 35,
                "free_throws_made": 18, "free_throws_attempted": 22, "offensive_rebounds": 10, "defensive_rebounds": 33, "assists": 25,
                "steals": 7, "blocks": 5, "turnovers": 13, "total_turnovers": 14, "fast_break_points": "12", "points_in_paint": "48", "turnover_points": "15",
            })
    return pd.DataFrame(rows)


def player_box(team):
    return pd.DataFrame([{
        "athlete_id": 7, "athlete_display_name": "Pat Lee", "athlete_position_abbreviation": "G", "athlete_headshot_href": None,
        "team_abbreviation": team, "game_date": "2026-10-21", "season_type": 2, "did_not_play": False, "starter": True,
        "minutes": 34, "points": 25, "rebounds": 5, "assists": 6, "three_point_field_goals_made": 3, "steals": 1, "blocks": 0,
        "turnovers": 2, "field_goals_attempted": 18, "free_throws_attempted": 6,
    }])


ROSTERS = pd.DataFrame([{"athlete_id": 7, "team_abbreviation": "BBB", "display_name": "Pat Lee", "position_abbreviation": "G", "headshot_href": None}])


class Build(unittest.TestCase):
    def test_a_season_without_regular_season_games_has_no_block(self):
        self.assertIsNone(build_nba.stats_block(2027, team_box(2, season_type=1), player_box("AAA"), TEAMS, None))

    def test_each_season_keeps_its_own_numbers_and_players(self):
        last = build_nba.stats_block(2026, team_box(6), player_box("AAA"), TEAMS, ROSTERS)
        this = build_nba.stats_block(2027, team_box(1), player_box("AAA"), TEAMS, None)
        self.assertEqual((last["label"], last["team_games"], last["team_stats"]["AAA"]["wins"]), ("2025-26", 6, 6))
        self.assertEqual((this["label"], this["team_games"], this["team_stats"]["AAA"]["wins"]), ("2026-27", 1, 1))
        self.assertIn("BBB", last["players"])  # last season's players sit on today's roster
        self.assertIn("AAA", this["players"])  # this season's on the team he played for

    def test_the_site_never_reads_last_season(self):
        # The owner, 2026-10-23: "i do not want flawed data entering this seasons numbers".
        # Last season's files (box scores, saved identity / props / lines) are for backtests only.
        # The game sim's per-player starting point from last season (2026-10-25) came off on
        # 2026-10-27 (the owner: "stop using last seasons data i've told you 10000 times").
        src = (Path(build_nba.__file__)).read_text(encoding="utf-8")
        self.assertEqual(src.replace('f"{season - 1}-', "").replace('f"{args.season - 1}-', "").count("season - 1}"), 0)
        self.assertNotIn("sim_prior", src)
        self.assertNotIn("prior=", src)
        for bad in ("season - 1, ", "season - 1)", "REFERENCE", "lines_2026", "stats_default"):
            self.assertNotIn(bad, src.replace('f"{season - 1}-', "").replace('f"{args.season - 1}-', ""), bad)


SITE = None


def stats(wins, games):
    ts = {t: {"games_played": games, "wins": wins if t == "AAA" else games - wins, "losses": games - wins if t == "AAA" else wins,
              "net_rating": 1.0, "off_rating": 110.0, "def_rating": 109.0, "pace": 99.0, "home_record": "0-0", "away_record": "0-0", "last10": "0-0"}
          for t in ("AAA", "BBB", "CCC")}
    return ts


def nba_data(default, with_this_season=True, legacy=False):
    seasons = {"2026": {"label": "2025-26", "team_games": 82, "team_stats": stats(60, 82), "recent_games": {}, "players": {}}}
    if with_this_season:
        seasons["2027"] = {"label": "2026-27", "team_games": 2, "team_stats": stats(2, 2), "recent_games": {}, "players": {}}
    shown = seasons[default]
    data = {
        "season": 2027, "season_label": "2026-27", "stats_season": int(default), "stats_season_label": shown["label"],
        "is_fallback_season": default != "2027", "teams": {t: {"name": t, "short": t, "logo": "", "color": "555555"} for t in ("AAA", "BBB", "CCC")},
        "schedule": [{"game_id": "9", "date": "2026-10-21", "time": "19:30", "away": "BBB", "home": "AAA", "status": "scheduled"}],
        "team_stats": shown["team_stats"], "recent_games": {}, "players": {}, "injuries": {}, "kotc": None,
    }
    if not legacy:
        data["stat_seasons"] = seasons
    return data


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class Page(unittest.TestCase):
    def open(self, data):
        SITE.nba = data
        page = SITE.open("nba/")
        page.wait_for_function("() => STATS && document.querySelector('#nba-seasons button')")
        return page

    def record(self, page):
        """The home team's (AAA's) record on its banner."""
        return page.evaluate("() => document.querySelectorAll('#teams-content .team-banner')[1].querySelector('.nba-banner-right').textContent.trim()")

    def buttons(self, page):
        return page.evaluate("() => [...document.querySelectorAll('#nba-seasons button')].map((b) => [b.textContent, b.classList.contains('active'), b.disabled])")

    def test_opens_on_the_builds_default_and_the_buttons_switch_every_number(self):
        page = self.open(nba_data("2026"))
        try:
            page.evaluate("() => localStorage.removeItem(NBA_SEASON_KEY)")
            page.reload()
            page.wait_for_function("() => STATS && document.querySelector('#nba-seasons button')")
            self.assertEqual(self.buttons(page), [["2025-26", True, False], ["2026-27", False, False]])
            self.assertEqual(self.record(page), "60-22")
            page.click("#nba-seasons [data-season='2027']")
            self.assertEqual(self.record(page), "2-0")
            self.assertIn("2 games a team so far", page.inner_text("#fallback-note"))
            # Remembered on reload while the build's default is the same ...
            page.reload()
            page.wait_for_function("() => STATS && document.querySelector('#nba-seasons button')")
            self.assertEqual(self.record(page), "2-0")
        finally:
            page.close()
        # ... and dropped once the default moves, so nobody is stuck on an old pick.
        page = self.open(nba_data("2027"))
        try:
            page.evaluate("() => localStorage.setItem(NBA_SEASON_KEY, JSON.stringify({ season: '2026', default: '2026' }))")
            page.reload()
            page.wait_for_function("() => STATS && document.querySelector('#nba-seasons button')")
            self.assertEqual(self.buttons(page), [["2025-26", False, False], ["2026-27", True, False]])
            self.assertEqual(self.record(page), "2-0")
            self.assertEqual(SITE.errors, [])
        finally:
            page.evaluate("() => localStorage.removeItem(NBA_SEASON_KEY)")
            page.close()

    def test_before_the_first_games_this_season_is_a_disabled_button(self):
        page = self.open(nba_data("2026", with_this_season=False))
        try:
            self.assertEqual(self.buttons(page), [["2025-26", True, False], ["2026-27", False, True]])
            self.assertIn("start after the first games", page.inner_text("#fallback-note"))
        finally:
            page.close()

    def test_matchup_extremes_show_only_tonights_types_that_are_far_from_normal(self):
        # BBB is a fast team and a 3-point team; AAA allows 9 more points a 100 to fast
        # teams than usual (league +1 = gap +8, red) but nothing much to 3-point teams.
        # AAA is a fouling defense: BBB scored 12 more against them, but in only 2 games
        # (under EX_MIN_GP), so it isn't colored or shown.
        cell = lambda pts: {"n": 3, "pts": [120.0, pts], "pace": [101.0, 2.0], "fg3m": [13.0, 0.0], "fta": [20.0, 0.0], "tov": [14.0, 0.0]}
        lg = {"pts": 1.0, "pace": 0.5, "fg3m": 0.0, "fta": 0.0, "tov": 0.0}
        ex = {"types": [{"key": "fast", "label": "Fast Teams", "side": "off", "teams": ["BBB"]},
                        {"key": "threes", "label": "High 3-Point Volume", "side": "off", "teams": ["BBB"]},
                        {"key": "foulers", "label": "Defenses That Foul", "side": "def", "teams": ["AAA"]}],
              "league": {"fast": lg, "threes": lg, "foulers": lg},
              "teams": {"AAA": {"fast": cell(9.0), "threes": cell(2.0), "foulers": cell(0.0)},
                        "BBB": {"fast": cell(0.0), "threes": cell(0.0), "foulers": {**cell(13.0), "n": 2}}}}
        data = nba_data("2027")
        # Schedule Spots: AAA is on a back-to-back tonight and scores 10 fewer a 100 on them
        # (league -2: gap -8, red); BBB's spot tonight (a long road trip) is close to normal.
        spot = lambda pts: {"n": 3, "pts": [105.0, pts], "opp": [112.0, 0.0], "pace": [99.0, 0.0]}
        slg = {"pts": -2.0, "opp": 0.0, "pace": 0.0}
        spots = {"types": [{"key": "b2b", "label": "Back-To-Back (2nd Night)"}, {"key": "road_long", "label": "Road Trip: Game 4+"}],
                 "league": {"b2b": slg, "road_long": slg},
                 "teams": {"AAA": {"b2b": spot(-10.0), "road_long": spot(-10.0)}, "BBB": {"b2b": spot(0.0), "road_long": spot(0.0)}},
                 "tonight": {"9": {"AAA": ["b2b"], "BBB": ["road_long"]}}}
        data["identity"] = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "teams": {}, "league": {}, "extremes": ex, "spots": spots}}}
        page = self.open(data)
        try:
            rows = page.evaluate("""() => [...document.querySelectorAll('#extremes-content .nba-box')].map((b) =>
                [...b.querySelectorAll('tbody tr:not(.id-group)')].map((r) => [...r.children].map((td) => td.innerText.trim())))""")
            self.assertEqual(rows[1], [["Fast Teams WEAK SPOT", "3", "+8.0", "+1.5", "0.0", "0.0", "0.0"], ["Back-To-Back (2nd Night) WEAK SPOT", "3", "-8.0", "0.0", "0.0"]])  # AAA, the home team
            self.assertEqual(rows[0], [])
            self.assertIn("Nothing far from normal", page.inner_text("#extremes-content"))
            self.assertIn("tier-bad", page.evaluate("() => document.querySelectorAll('#extremes-content .nba-box')[1].querySelector('tbody tr:not(.id-group) td:nth-child(3)').className"))
            # the hover in plain words (AAA allowed 120 points a 100 to fast teams, 9 over its usual)
            hover = page.evaluate("() => document.querySelectorAll('#extremes-content .nba-box')[1].querySelector('tbody tr:not(.id-group) td:nth-child(3)').title")
            self.assertEqual(hover, "Vs Fast Teams (3 games): AAA allowed 120.0 points per 100 possessions, 9.0 more than its usual. "
                                    "The average team allows 1.0 more than usual vs them. Net: AAA 8.0 worse than the average team vs them.")
            self.assertEqual(SITE.errors, [])
        finally:
            page.close()

    def test_an_old_data_file_shows_its_one_season(self):
        page = self.open(nba_data("2026", legacy=True))
        try:
            self.assertEqual(self.record(page), "60-22")
            self.assertEqual(SITE.errors, [])
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main()
