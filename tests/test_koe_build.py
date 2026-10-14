"""King of the Endzone in the NFL build (nfl_tool/build_stats.py): each
finished game's longest TD (koe_game_results) and the boards as they stood
going into each week (koe_week_boards), on hand-made plays.

Pinned: an offensive TD counts its gain and a return TD (kick, punt,
interception) is the D/ST's at its return length; a tie names everyone; a
two-point try is never a TD; names are the roster's full names; week 1 has no
board; a week's board is saved only once every earlier game is final, and is
read back instead of rebuilt."""
import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from helpers import ROOT  # first: puts tools/ on the import path

import importlib.util

spec = importlib.util.spec_from_file_location("build_stats", ROOT / "nfl_tool" / "build_stats.py")
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

NAMES = {"00-1": "Bijan Robinson", "00-2": "Drake London", "00-3": "Alvin Kamara"}


def lookup(pid, week):
    return ("RB", None, NAMES.get(pid))


def play(**kw):
    base = {"game_id": "2026_04_ATL_NO", "week": 4, "touchdown": 1, "td_team": "ATL", "posteam": "ATL", "two_point_attempt": 0,
            "return_touchdown": 0, "return_yards": 0, "fumble_recovery_1_yards": None, "td_player_id": "00-1", "td_player_name": "B.Robinson", "yards_gained": 4}
    return {**base, **kw}


class Results(unittest.TestCase):
    def results(self, plays):
        return bs.koe_game_results(pd.DataFrame(plays), lookup)

    def test_the_longest_offensive_td_with_full_names(self):
        got = self.results([play(yards_gained=59), play(td_player_id="00-2", td_player_name="D.London", yards_gained=31), play(yards_gained=4)])
        res = got["2026_04_ATL_NO"]
        self.assertEqual(res["longest"], 59)
        self.assertEqual(res["winners"], [{"name": "Bijan Robinson", "team": "ATL", "yds": 59}])
        self.assertEqual(res["tds"], [["Bijan Robinson", "ATL", 59], ["Drake London", "ATL", 31]])  # each scorer's longest

    def test_return_tds_are_the_dsts_at_their_return_length(self):
        kick = play(td_team="NO", posteam="NO", return_touchdown=1, return_yards=98, yards_gained=0, td_player_id="00-3")
        pick = play(td_team="NO", posteam="ATL", return_touchdown=1, return_yards=40, yards_gained=-2, td_player_id="00-3")
        res = self.results([play(yards_gained=59), kick, pick])["2026_04_ATL_NO"]
        self.assertEqual(res["winners"], [{"name": "NO D/ST", "team": "NO", "yds": 98}])
        fumble = play(td_team="NO", posteam="ATL", return_touchdown=1, return_yards=0, fumble_recovery_1_yards=77, yards_gained=0)
        self.assertEqual(self.results([fumble])["2026_04_ATL_NO"]["longest"], 77)

    def test_a_tie_names_both_and_a_two_point_try_is_no_td(self):
        res = self.results([play(yards_gained=40), play(td_player_id="00-2", yards_gained=40), play(td_player_id="00-3", td_team="NO", posteam="NO", yards_gained=2, two_point_attempt=1)])["2026_04_ATL_NO"]
        self.assertEqual({w["name"] for w in res["winners"]}, {"Bijan Robinson", "Drake London"})
        self.assertNotIn("Alvin Kamara", [n for n, _, _ in res["tds"]])


class Boards(unittest.TestCase):
    def setUp(self):
        self.real = bs.compute_koe
        bs.compute_koe = lambda pbp, pos: {"through": int(pbp["week"].max()) if len(pbp) else 0}
        self.pbp = pd.DataFrame({"week": [1, 2, 3, 4]})

    def tearDown(self):
        bs.compute_koe = self.real

    def schedule(self, open_weeks=()):
        return [{"week": w, "status": "scheduled" if w in open_weeks else "final"} for w in (1, 2, 3, 4, 5)]

    def test_each_week_from_the_games_before_it_and_no_week_1(self):
        boards = bs.koe_week_boards(self.pbp, None, self.schedule(open_weeks=(5,)), None, 2026)
        self.assertEqual(sorted(boards, key=int), ["2", "3", "4", "5"])
        self.assertEqual(boards["4"], {"through": 3})

    def test_saved_once_final_and_read_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            bs.koe_week_boards(self.pbp, None, self.schedule(open_weeks=(4, 5)), folder, 2026)
            saved = sorted(p.name for p in (folder / "2026").glob("*.json"))
            self.assertEqual(saved, ["week-02.json", "week-03.json", "week-04.json"])  # week 4's board needs weeks 1-3 final
            (folder / "2026" / "week-02.json").write_text(json.dumps({"kept": True}))
            boards = bs.koe_week_boards(self.pbp, None, self.schedule(open_weeks=(4, 5)), folder, 2026)
            self.assertEqual(boards["2"], {"kept": True})  # read back, not rebuilt

    def test_nothing_before_the_first_final_game(self):
        self.assertEqual(bs.koe_week_boards(self.pbp, None, [{"week": 1, "status": "scheduled"}], None, 2026), {})


if __name__ == "__main__":
    unittest.main()
