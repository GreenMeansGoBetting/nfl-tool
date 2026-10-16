"""tools/nhl_factor_report.py: the three NHL records grouped by the factors
saved with each graded play (the owner's "learning which factors win")."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  first: puts nfl_tool/nhl on the import path

import build_nhl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import nhl_factor_report as report  # noqa: E402


def shots_factors(**values):
    return [values.get(k) for k in build_nhl.SHOTS_FACTORS]


class FactorReport(unittest.TestCase):
    def history(self, tmp):
        root = Path(tmp)
        for name in ("nhl_shots", "nhl_goals", "nhl_points"):
            (root / name).mkdir()
        shots = [
            # A strong over (edge 7.5) that won, his line's lift pushing toward it, an L1 home player.
            ["a", "A", "AAA", 2.5, -120, 100, 2.9, 0.62, 3, 3.0, None, None, None, None,
             shots_factors(pos="C", slot="F1", home=1, rest=2, l_opp=1.06, l_line=1.0, games=10)],
            # A strong under (edge 7.6) that lost, the defense's lift pushing AGAINST it (more shots).
            ["c", "C", "AAA", 2.5, 100, -110, 2.0, 0.40, 3, 2.8, None, None, None, None,
             shots_factors(pos="D", slot="D1", home=0, rest=1, l_opp=1.05, l_line=1.0, games=4)],
            # Saved before the factors: still counted by its line move and season average.
            ["d", "D", "AAA", 2.5, -118, 100, 2.7, 0.58, 4, 2.2, "up"],
            # No edge: left out unless --every.
            ["e", "E", "AAA", 2.5, -115, -105, 2.6, 0.55, 3, 2.5],
        ]
        (root / "nhl_shots" / "2026-10.json").write_text(json.dumps({"factors": build_nhl.SHOTS_FACTORS, "games": {
            "9": {"date": "2026-10-13", "away": "AAA", "home": "BBB", "plays": shots}}}))
        goals = [
            ["1", "P1", "BUF", 0.32, 0.386, 300, 350, False, "low_slot", 1, None, [None] * len(build_nhl.GOALS_FACTORS)],
            ["2", "P2", "BUF", 0.29, 0.342, 300, 250, False, None, 0, None],  # an old row
            ["3", "P3", "BUF", 0.10, 0.105, None, None, False, None, 0, None, None],  # unpriced: never a play
        ]
        (root / "nhl_goals" / "2026-10.json").write_text(json.dumps({"factors": build_nhl.GOALS_FACTORS, "games": {
            "77": {"date": "2026-10-13", "away": "BUF", "home": "FLA", "plays": goals}}}))
        return root

    def test_groups_graded_plays_by_each_factor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.history(tmp)
            shots = report.factor_report(report.shots_plays(root / "nhl_shots"), "shots", 100)
            every = report.shots_plays(root / "nhl_shots", every=True)
            goals = report.factor_report(report.goals_plays(root / "nhl_goals"), "goals", 2)
            points = report.factor_report(report.points_plays(root / "nhl_points"), "points", 100)
        # The same plays and units as the build's own record: a, c and d (e has no edge).
        self.assertEqual((shots["total"]["plays"], shots["total"]["wins"], shots["total"]["units"]), (3, 2, round(100 / 120 - 1 + 100 / 118, 2)))
        self.assertEqual(len(every), 4)
        f = {name: {r["group"]: r for r in rows} for name, rows in shots["factors"].items()}
        # A lift reads against the play's side: +6% on an over is toward it, +5% on an under against it.
        self.assertEqual((f["l_opp"]["toward the play"]["wins"], f["l_opp"]["against the play"]["losses"]), (1, 1))
        self.assertNotIn("l_line", f)  # 1.0 for both: one group says nothing
        # The old row has no position, but its line move still counts.
        self.assertEqual(sum(r["plays"] for r in f["pos"].values()), 2)
        self.assertEqual({k: r["plays"] for k, r in f["move"].items()}, {"no move": 2, "up": 1})
        self.assertEqual(set(f["rest"]), {"b2b (1 day)", "2 days"})
        self.assertTrue(all(r["early"] for rows in shots["factors"].values() for r in rows))
        # Tonight's number against his season average, from the play's side: a (2.9 vs 3.0) about it,
        # c (an under at 2.0 vs 2.8) toward it, d (an over at 2.7 vs 2.2) toward it.
        self.assertEqual({k: r["plays"] for k, r in f["vs_avg"].items()}, {"about his average": 1, "toward the play": 2})
        # Goals: the two priced plays (strong and lean), the Zone Match tag from its own column.
        g = {name: {r["group"]: r for r in rows} for name, rows in goals["factors"].items()}
        self.assertEqual(goals["total"]["plays"], 2)
        self.assertEqual({k: (r["plays"], r["early"]) for k, r in g["zone"].items()}, {"low_slot": (1, True), "no tag": (1, True)})
        self.assertEqual(points["total"]["plays"], 0)

    def test_the_command_runs_on_the_real_records(self):
        """Every record the deploy has committed reads (old rows and new)."""
        reports = report.main(["--min", "100"])
        self.assertEqual([r["market"] for r in reports], ["shots", "goals", "points"])
        for r in reports:
            for rows in r["factors"].values():
                self.assertEqual(sum(x["plays"] for x in rows) <= r["total"]["plays"], True)


if __name__ == "__main__":
    unittest.main()
