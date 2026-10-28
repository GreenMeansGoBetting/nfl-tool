"""NBA Matchup Breakdown's season numbers (build_nba.py stats_block, Recent
Games' lines).

What is pinned: the build keeps each season's numbers apart (last season's
players on today's rosters, this season's on their box score team); a season
with no regular-season game has no block; the build never reads last season;
Recent Games carries each game's line at tip from the team's side. (The
page's season buttons came off with Matchup Breakdown, 2026-10-28: the NBA is
this season only.)"""
import sys
import unittest
from pathlib import Path

import pandas as pd

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path


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


class RecentLines(unittest.TestCase):
    def test_each_game_gets_its_line_from_the_teams_side(self):
        rows = build_nba.compute_recent_games(build_nba.team_game_rows(team_box(2)))
        self.assertEqual([r["game_id"] for r in rows["AAA"]], ["0", "1"])
        # game 0: total 214.5, home (AAA) -6.5; game 1 has no saved line
        build_nba.add_recent_lines(rows, {"0": [214.5, -6.5]})
        self.assertEqual((rows["AAA"][0]["total"], rows["AAA"][0]["spread"]), (214.5, -6.5))
        self.assertEqual((rows["BBB"][0]["total"], rows["BBB"][0]["spread"]), (214.5, 6.5))
        self.assertNotIn("spread", rows["AAA"][1])


if __name__ == "__main__":
    unittest.main()
