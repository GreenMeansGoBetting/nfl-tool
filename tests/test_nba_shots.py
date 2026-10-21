"""NBA shot charts' data (nfl_tool/nba/shots.py -> site/nba/shots.json) on a hand-made game.

What is pinned (the owner, 2026-10-21: shot charts for THIS season, "frequency and success"):
each shot keeps ESPN's spot as given (x below 25 = the shooter's left, checked against NBA.com),
made / three, its game (oldest first), the 1st-quarter and first-3-minutes flags and how the shot
came; free throws, heaves (35+ ft) and preseason games are left out; the league table adds up
every shot by spot. For the Shot Charts page (2026-10-21, the owner: "pick an offensive player and
then a defensive team to compare"): each shot carries the shooter's team and the defense, taken
from his BOX-SCORE team (ESPN's play team_id is sometimes the wrong side), the play's side only
when the box score lacks him; All-Star sides are left out; `who` = his name and latest team."""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import shots  # noqa: E402


SIDES = {20: (1, "BOS", 2, "NY"), 10: (2, "NY", 3, "SA"), 5: (1, "BOS", 2, "NY"), 30: (8, "STARS", 9, "WORLD"),
         40: (1, "BOS", 3, "SA"), 50: (2, "NY", 1, "BOS")}


def play(game, date, period, minutes, seconds, player, kind, x, y, made, pts, season_type=2, shooting=True, team=None):
    home_id, home, away_id, away = SIDES[game]
    return {"game_id": game, "game_date": date, "season_type": season_type, "period_number": period,
            "clock_minutes": minutes, "clock_seconds": seconds, "athlete_id_1": player, "type_text": kind,
            "shooting_play": shooting, "coordinate_x_raw": x, "coordinate_y_raw": y, "scoring_play": made,
            "points_attempted": pts, "team_id": home_id if team is None else team, "home_team_id": home_id,
            "away_team_id": away_id, "home_team_abbrev": home, "away_team_abbrev": away}


def box(game, player, team, opp, name):
    return {"game_id": game, "athlete_id": player, "team_abbreviation": team, "opponent_team_abbreviation": opp, "athlete_display_name": name}


PBP = pd.DataFrame([
    play(20, "2026-10-22", 1, 11, 30, 7, "Driving Layup Shot", 25, 1, True, 2),  # opening minutes
    play(20, "2026-10-22", 1, 5, 0, 7, "Jump Shot", 3, 2, False, 3),  # left corner 3, catch and shoot
    play(20, "2026-10-22", 3, 8, 0, 7, "Pullup Jump Shot", 40, 20, True, 3, team=2),  # ESPN's team_id says NY: the box score wins
    play(20, "2026-10-22", 2, 1, 0, 7, "Free Throw - 1 of 2", 25, 0, True, 1),  # free throw: out
    play(20, "2026-10-22", 2, 0, 1, 8, "Jump Shot", 25, 40, False, 3),  # heave: out
    play(10, "2026-10-20", 2, 6, 0, 8, "Driving Layup Shot", 25, 1, False, 2),  # the older game comes first
    play(10, "2026-10-20", 2, 5, 0, 9, "Jump Shot", 25, 15, True, 2, team=3),  # not in the box score: the play's side (SA)
    play(5, "2026-10-10", 1, 11, 0, 8, "Jump Shot", 25, 25, True, 3, season_type=1),  # preseason: out
])
BOX = pd.DataFrame([box(20, 7, "BOS", "NY", "Player Seven"), box(20, 8, "NY", "BOS", "Player Eight"),
                    box(10, 8, "SA", "NY", "Player Eight")])  # 8 moved: his latest team is NY


class ShotsFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.block = shots.season_block(PBP, "2026-27", BOX)

    def test_games_oldest_first(self):
        self.assertEqual(self.block["games"], [10, 20])

    def test_each_shot(self):
        self.assertEqual(self.block["players"]["7"], [
            [25, 1, 1, 0, 1, 3, 3, 0, 1],  # game index 1, 1st quarter + first 3 minutes, a drive; BOS on NY
            [3, 2, 0, 1, 1, 1, 2, 0, 1],  # the shooter's left corner, catch and shoot
            [40, 20, 1, 1, 1, 0, 1, 0, 1],  # 3rd quarter pull-up; still BOS on NY (the box score's team)
        ])
        self.assertEqual(self.block["players"]["8"], [[25, 1, 0, 0, 0, 0, 3, 2, 1]])  # SA on NY

    def test_teams(self):
        self.assertEqual(self.block["teams"], ["BOS", "NY", "SA"])
        self.assertEqual(self.block["players"]["9"], [[25, 15, 1, 0, 0, 0, 2, 2, 1]])  # the play's side: SA on NY
        self.assertEqual(self.block["games"], [10, 20])

    def test_all_star_sides_left_out(self):
        """A side with under half the games of the most-played team (the engine's rule) is an All-Star side."""
        extra = pd.DataFrame([play(40, "2026-10-24", 1, 5, 0, 7, "Jump Shot", 25, 15, True, 2),
                              play(50, "2026-10-26", 1, 5, 0, 7, "Jump Shot", 25, 15, True, 2),
                              play(30, "2027-02-15", 1, 5, 0, 7, "Jump Shot", 25, 15, True, 2)])
        block = shots.season_block(pd.concat([PBP, extra]), "2026-27", BOX)
        self.assertEqual(block["teams"], ["BOS", "NY", "SA"])
        self.assertNotIn(30, block["games"])
        self.assertEqual(len(block["players"]["7"]), 5)

    def test_who(self):
        self.assertEqual(self.block["who"], {"7": ["Player Seven", "BOS"], "8": ["Player Eight", "NY"]})  # 9 is in no box score: his shots count against the defense, but he is not in the picker

    def test_league_adds_up_by_spot(self):
        self.assertIn([25, 1, 0, 1, 2], self.block["league"])  # two layups there, one made
        self.assertEqual(sum(s[4] for s in self.block["league"]), 5)

    def test_no_shots_no_block(self):
        self.assertIsNone(shots.season_block(PBP[PBP["season_type"] == 1], "2026-27"))


if __name__ == "__main__":
    unittest.main()
