"""The Opening Drive Tool's data (compute_opening_drives in
nfl_tool/build_stats.py), on hand-made plays.

Pinned (the owner, 2026-10-29: graded the way the book grades a first drive,
Off TD / FG Att / Punt / Any Other): a kickoff returned for a TD isn't the
offense's first drive; a missed or blocked field goal is FG Att; a turnover
is Any Other; a punt with no first down is a 3 & out; the team whose offense
had the ball first is marked; first-half and full-game drives are counted
by outcome."""
import unittest

import pandas as pd

from helpers import ROOT  # first: puts tools/ on the import path

import importlib.util

spec = importlib.util.spec_from_file_location("build_stats", ROOT / "nfl_tool" / "build_stats.py")
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

PLAY_ID = iter(range(1, 1000))


def play(team, drive, kind, result, qtr=1, yards=0, first_downs=0, transition=None):
    return {"game_id": "2026_05_ATL_NO", "week": 5, "home_team": "NO", "away_team": "ATL", "posteam": team,
            "fixed_drive": drive, "play_type": kind, "yards_gained": yards, "qtr": qtr, "play_id": next(PLAY_ID),
            "fixed_drive_result": result, "drive_end_transition": transition, "drive_first_downs": first_downs}


def game():
    return pd.DataFrame([
        play("NO", 1, "kickoff", "Touchdown", yards=0),  # a return TD: not NO's first drive
        play("ATL", 2, "run", "Punt", yards=2), play("ATL", 2, "pass", "Punt", yards=3), play("ATL", 2, "punt", "Punt"),
        play("NO", 3, "pass", "Missed field goal", yards=10, first_downs=1), play("NO", 3, "field_goal", "Missed field goal", first_downs=1),
        play("ATL", 4, "run", "Turnover on downs", qtr=2, yards=4), play("ATL", 4, "field_goal", "Turnover on downs", qtr=2, transition="BLOCKED_FG"),
        play("NO", 5, "pass", "Turnover", qtr=3, yards=-1),
    ])


class OpeningDrives(unittest.TestCase):
    def setUp(self):
        self.teams = bs.compute_opening_drives(game())["teams"]

    def test_the_first_offensive_drive_and_its_detail(self):
        atl = self.teams["ATL"][0]
        self.assertEqual((atl["out"], atl["three_out"], atl["received"], atl["plays"], atl["yards"], atl["opp"], atl["home"]),
                         ("punt", True, True, 2, 5, "NO", False))

    def test_a_return_td_is_skipped_and_a_missed_fg_is_a_fg_attempt(self):
        no = self.teams["NO"][0]
        self.assertEqual((no["out"], no["received"], no["three_out"]), ("fg", False, False))

    def test_first_half_and_full_game_counts(self):
        # [td, fg, punt, other]: a blocked FG is FG Att, a turnover Any Other.
        self.assertEqual(self.teams["ATL"][0]["half"], [0, 1, 1, 0])
        self.assertEqual(self.teams["NO"][0]["half"], [0, 1, 0, 0])
        self.assertEqual(self.teams["NO"][0]["game"], [0, 1, 0, 1])

    def test_outcome_names(self):
        self.assertEqual(bs._drive_outcome("Touchdown", None), "td")
        self.assertEqual(bs._drive_outcome("Opp touchdown", "FUMBLE"), "other")
        self.assertEqual(bs._drive_outcome("Safety", "SAFETY"), "other")
        self.assertEqual(bs._drive_outcome("Opp touchdown", "BLOCKED_PUNT"), "punt")


if __name__ == "__main__":
    unittest.main()
