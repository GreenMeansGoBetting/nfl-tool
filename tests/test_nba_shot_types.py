"""NBA Player Types (nfl_tool/nba/shot_types.py) on made-up players.

Pinned (the owner and Claude's audit, 2026-11-11): every ESPN shot label sits in one group and an
unknown one stops the step; the bigs who take under 20% threes split into their own type; borderline
players carry a lean; a redraw keeps every group's letter; groups are redrawn only once a week; each
shot counts against the defense the shooter faced."""
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

# Eleven made-up kinds of shooter: [dist, three, catch, pullup, fade, float, post, drive, cut, lob, fast]
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

    def test_eleven_types_lettered_deepest_first(self):
        self.assertEqual(sorted(set(self.typed["type"])), list("ABCDEFGHIJK"))
        deep = self.typed.loc[[1000 + j for j in range(12)], "type"]
        rim = self.typed.loc[[10000 + j for j in range(12)], "type"]
        self.assertEqual(set(deep), {"A"})
        self.assertEqual(set(rim), {"K"})

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

    def test_borderline_is_the_fit_line(self):
        self.assertTrue(((self.typed["fit"] >= S.BORDER) == self.typed["border"]).all())


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

    def test_groups_are_redrawn_once_a_week(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "2027.json"
            sh = self.shots()
            first = S.groups_for(sh, 2027, date(2026, 11, 11), path)
            self.assertEqual(first["drawn"], "2026-11-11")
            self.assertEqual(S.groups_for(sh, 2027, date(2026, 11, 17), path)["drawn"], "2026-11-11")
            self.assertEqual(S.groups_for(sh, 2027, date(2026, 11, 18), path)["drawn"], "2026-11-18")
            saved = json.loads(path.read_text())
            self.assertIn("stability", saved)
            self.assertIn("moved", saved)


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


if __name__ == "__main__":
    unittest.main()
