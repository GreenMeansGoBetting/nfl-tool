"""NBA Player Types (nfl_tool/nba/shot_types.py) on made-up players.

Pinned (the owner and Claude's audit, 2026-11-11): every ESPN shot label sits in one group and an
unknown one stops the step; the bigs who take under 20% threes split into their own type; borderline
players carry a lean; a redraw keeps every group's letter; each shot counts against the defense the shooter faced.
2026-11-13 (the owner): the second-deepest group splits at 35% of threes off the dribble (B pull-up, C
catch: twelve types, A-L); the groups are frozen (only redrawn by hand); letters are checked once a day."""
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "nfl_tool" / "nba"))
import shot_types as S  # noqa: E402

# Ten made-up kinds of shooter (the "pullup" kind splits by its threes off the dribble, `p3`): [dist, three, catch, pullup, fade, float, post, drive, cut, lob, fast]
KINDS = {
    "deep": [22, .80, .65, .20, .02, .02, 0, .06, .02, .02, .18], "pullup": [18, .55, .35, .35, .04, .07, 0, .14, .03, .02, .12],
    "spot": [17, .62, .60, .05, .03, .05, .02, .12, .06, .07, .10], "float": [15, .42, .22, .32, .04, .22, .01, .18, .01, .01, .10],
    "fade": [14.5, .35, .25, .28, .16, .07, .01, .15, .04, .03, .11], "wing": [14.4, .47, .40, .13, .04, .05, .01, .24, .07, .06, .19],
    "bigs": [11.5, .32, .33, .05, .06, .07, .08, .13, .13, .16, .08], "drive": [11.3, .30, .22, .18, .05, .11, .01, .36, .04, .04, .16],
    "slash": [7, .11, .13, .04, .05, .19, .04, .25, .16, .15, .11], "rim": [4.5, .07, .09, .01, .02, .08, .07, .13, .30, .30, .09],
}


def make_profiles(per=12, seed=1, low_three_bigs=4):
    rng = np.random.default_rng(seed)
    rows, idx = [], []
    for k, (name, mix) in enumerate(KINDS.items()):
        for j in range(per):
            v = np.array(mix, dtype=float) * (1 + rng.normal(0, 0.04, len(mix)))
            if name == "bigs" and j < low_three_bigs:
                v[1] = 0.12  # a post big: under 20% threes
            rows.append(v)
            idx.append(1000 * (k + 1) + j)
    prof = pd.DataFrame(rows, columns=S.F, index=idx)
    prof["n"] = 80
    # threes off the dribble: the pull-up kind half over the 35% line, half under; one on the line
    prof["p3"] = 0.15
    prof.loc[[2000 + j for j in range(6)], "p3"] = 0.50
    prof.loc[2011, "p3"] = 0.34
    return prof


class Labels(unittest.TestCase):
    def test_every_known_label_has_one_group(self):
        seen = [label for labels in S.LABELS.values() for label in labels]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(S.unsorted(seen + list(S.LEFT_OUT)), [])

    def test_a_new_espn_label_is_caught(self):
        self.assertEqual(S.unsorted(["Jump Shot", "Spinning Scoop Shot"]), ["Spinning Scoop Shot"])

    def test_running_jumpers_are_catch_and_shoot_and_plain_layups_are_cuts(self):
        # 2026-11-11: Running Jump Shot is 95% assisted when made; plain Layup / Dunk Shot 82-87%
        self.assertEqual(S.GROUP_OF["Running Jump Shot"], "catch")
        self.assertEqual(S.GROUP_OF["Layup Shot"], "cut")
        self.assertEqual(S.GROUP_OF["Driving Layup Shot"], "drive")


class Groups(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prof = make_profiles()
        cls.groups = S.draw(cls.prof)
        cls.typed = S.assign(cls.prof, cls.groups)

    def test_twelve_types_lettered_deepest_first(self):
        self.assertEqual(sorted(set(self.typed["type"])), list("ABCDEFGHIJKL"))
        deep = self.typed.loc[[1000 + j for j in range(12)], "type"]
        rim = self.typed.loc[[10000 + j for j in range(12)], "type"]
        self.assertEqual(set(deep), {"A"})
        self.assertEqual(set(rim), {"L"})

    def test_the_second_group_splits_by_threes_off_the_dribble(self):
        # 2026-11-13: B = 35%+ of his threes off the dribble, C = under; on the line = both letters
        self.assertEqual(self.groups["pull"], {"from": "B", "to": "C", "cut": 0.35})
        kind = self.typed.loc[[2000 + j for j in range(12)]]
        self.assertEqual(set(kind.iloc[:6]["type"]), {"B"})
        self.assertEqual(set(kind.iloc[6:]["type"]), {"C"})
        line = kind.loc[2011]
        self.assertEqual((line["type"], line["lean"], bool(line["border"])), ("C", "B", True))

    def test_bigs_under_twenty_percent_threes_split_off_and_lean_back(self):
        split = self.groups["split"]
        bigs = self.typed.loc[[7000 + j for j in range(12)]]
        self.assertEqual(set(bigs.iloc[:4]["type"]), {split["to"]})
        self.assertEqual(set(bigs.iloc[:4]["lean"]), {split["from"]})
        self.assertEqual(set(bigs.iloc[4:]["type"]), {split["from"]})

    def test_a_redraw_keeps_every_groups_letter(self):
        again = S.draw(make_profiles(seed=2), self.groups)
        retyped = S.assign(self.prof, again)
        self.assertGreater((retyped["type"] == self.typed["type"]).mean(), 0.95)
        self.assertEqual(again["split"], self.groups["split"])
        self.assertEqual(again["pull"], self.groups["pull"])

    def test_borderline_is_the_fit_line(self):
        on_line = pd.Series(False, index=self.typed.index)
        on_line[2011] = True  # the B / C line
        self.assertTrue((((self.typed["fit"] >= S.BORDER) | on_line) == self.typed["border"]).all())


class Redraw(unittest.TestCase):
    def shots(self):
        """Made-up shots whose players' mixes are make_profiles()'s."""
        rows = []
        for pid, r in make_profiles().iterrows():
            for g in range(10):
                for s in range(8):
                    row = {"player": pid, "game_id": g, "dist": r["dist"], "team": 1, "made": s % 2 == 0}
                    row.update({k: bool((s + g) % 10 < round(r[k] * 10)) for k in S.F[1:]})
                    rows.append(row)
        return pd.DataFrame(rows)

    def test_groups_are_frozen_and_redrawn_only_by_hand(self):
        # 2026-11-13 (the owner): a letter is a fixed type; a from-scratch redraw moved Edwards without a game
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "2027.json"
            sh = self.shots()
            first = S.groups_for(sh, 2027, date(2026, 11, 11), path)
            self.assertEqual(first["drawn"], "2026-11-11")
            self.assertEqual(S.groups_for(sh, 2027, date(2027, 2, 1), path)["drawn"], "2026-11-11")
            self.assertEqual(S.groups_for(sh, 2027, date(2027, 2, 1), path, force=True)["drawn"], "2027-02-01")
            saved = json.loads(path.read_text())
            self.assertIn("stability", saved)
            self.assertIn("moved", saved)

    def test_letters_are_checked_once_a_day(self):
        # the first build of an Eastern day sets that day's letters; later builds keep them, a new player is added
        typed = pd.DataFrame({"type": ["A", "B"], "lean": ["B", "C"], "fit": [0.2, 0.3], "border": [False, False]}, index=[1, 2])
        with tempfile.TemporaryDirectory() as d:
            lp = Path(d) / "2027_letters.json"
            S.daily_letters(typed, 2027, date(2026, 11, 14), lp)
            later = typed.copy()
            later.loc[2, "type"] = "D"
            later.loc[3] = ["L", "K", 0.1, False]
            same_day = S.daily_letters(later, 2027, date(2026, 11, 14), lp)
            self.assertEqual(list(same_day["type"]), ["A", "B", "L"])  # 2 keeps B all day; 3 is new
            next_day = S.daily_letters(later, 2027, date(2026, 11, 15), lp)
            self.assertEqual(list(next_day["type"]), ["A", "D", "L"])
            self.assertEqual(json.loads(lp.read_text())["day"], "2026-11-15")


class Baseline(unittest.TestCase):
    def test_each_night_is_measured_against_his_other_games(self):
        # 2026-11-11, the owner: "avg over baseline"; leave-one-out so a big night can't lift its own baseline
        box = pd.DataFrame([
            {"athlete_id": 7.0, "game_id": 101.0, "game_date": "2026-11-01", "opponent_team_abbreviation": "BBB", "points": 30, "three_point_field_goals_made": 5, "minutes": 34, "did_not_play": False},
            {"athlete_id": 7.0, "game_id": 102.0, "game_date": "2026-11-03", "opponent_team_abbreviation": "CCC", "points": 10, "three_point_field_goals_made": 1, "minutes": 30, "did_not_play": False},
            {"athlete_id": 7.0, "game_id": 103.0, "game_date": "2026-11-05", "opponent_team_abbreviation": "DDD", "points": 20, "three_point_field_goals_made": 3, "minutes": 32, "did_not_play": False},
            {"athlete_id": 7.0, "game_id": 104.0, "game_date": "2026-11-07", "opponent_team_abbreviation": "EEE", "points": 0, "three_point_field_goals_made": 0, "minutes": 0, "did_not_play": True},
            {"athlete_id": 8.0, "game_id": 101.0, "game_date": "2026-11-01", "opponent_team_abbreviation": "AAA", "points": 12, "three_point_field_goals_made": 2, "minutes": 20, "did_not_play": False},
        ])
        # assisted makes (2026-11-13, Assist Spots' Vs Type): 6 off a pass at BBB, none at CCC, 3 at DDD
        rows, avg = S.baseline_log(box, {"7", "8"}, {("7", "101"): 6, ("7", "103"): 3, ("7", "104"): 9})
        self.assertEqual(avg["7"], [3, 20.0, 3.0, 3.0])
        mine = {r[1]: r for r in rows if r[2] == "7"}
        self.assertEqual(mine["BBB"][5:], [15.0, 3.0, "101", 6, 4.5])  # 30 vs (10 + 20) / 2; 5 vs (1 + 3) / 2; 6 vs (0 + 3) / 2
        self.assertEqual(mine["CCC"][5:], [-15.0, -3.0, "102", 0, -4.5])
        self.assertNotIn("EEE", mine)  # a game he sat out isn't a night (his 9 there never counts)
        sh = pd.DataFrame([{"player": 7, "game_id": 101, "made": True, "assist": 5.0}, {"player": 7, "game_id": 101, "made": True, "assist": None},
                           {"player": 7, "game_id": 101, "made": False, "assist": None}, {"player": 7, "game_id": 103, "made": True, "assist": 9.0}])
        self.assertEqual(S.assisted_makes(sh), {("7", "101"): 1, ("7", "103"): 1})  # a self-created make or a miss isn't one
        self.assertFalse([r for r in rows if r[2] == "8"])  # one game: nothing to measure it against


class Defense(unittest.TestCase):
    def test_each_shot_counts_against_the_defense_he_faced(self):
        sh = pd.DataFrame([
            {"player": 1, "game_id": 10, "team": 100, "made": True, "three": True},
            {"player": 1, "game_id": 10, "team": 100, "made": False, "three": False},
            {"player": 2, "game_id": 10, "team": 200, "made": True, "three": False},
            {"player": 1, "game_id": 11, "team": 100, "made": True, "three": False},
            {"player": 3, "game_id": 11, "team": 300, "made": False, "three": False},
        ])
        out = S.defense(sh, pd.Series({1: "A", 2: "K", 3: "B"}), {100: "AAA", 200: "BBB", 300: "CCC"})
        self.assertEqual(out["teams"]["BBB"], {"games": 1, "vs": {"A": [2, 1, 3, 1]}})
        self.assertEqual(out["teams"]["CCC"]["vs"]["A"], [1, 1, 2, 0])
        self.assertEqual(out["teams"]["AAA"]["vs"], {"K": [1, 1, 2, 0], "B": [1, 0, 0, 0]})
        self.assertEqual(out["teams"]["AAA"]["games"], 2)
        self.assertEqual(out["league"]["A"], [3, 2, 5, 1])



class ShotKinds(unittest.TestCase):
    def test_every_shot_a_defense_faced_counts_by_kind(self):
        # Shot Fit (2026-11-11): typed or not, every shooter's shots count, so the samples are big early
        sh = pd.DataFrame([
            {"player": 1, "game_id": 10, "team": 100, "made": True, "three": True, "catch": True, "drive": False},
            {"player": 9, "game_id": 10, "team": 100, "made": False, "three": False, "catch": False, "drive": True},
            {"player": 2, "game_id": 10, "team": 200, "made": True, "three": False, "catch": False, "drive": True},
        ])
        out = S.defense(sh, pd.Series({1: "A", 2: "K"}), {100: "AAA", 200: "BBB"})
        self.assertEqual(out["kinds"]["BBB"]["catch"], [1, 1, 3])
        self.assertEqual(out["kinds"]["BBB"]["drive"], [1, 0, 0])  # player 9 has no type and still counts
        self.assertEqual(out["kinds"]["AAA"]["drive"], [1, 1, 2])
        self.assertEqual(out["league_kinds"]["drive"], [2, 1, 2])

if __name__ == "__main__":
    unittest.main()
