"""NHL Line Stacks' model (nfl_tool/nhl/stacks_model.py), kept for the replays
(tools/backtest/nhl_stacks*.py) after the page was retired on 2026-10-21 for
Line Matchups. Hand-made lineups only.

What is pinned: shared ice (even strength and power play); the joint chance
(no shared goals = the legs multiplied, shared goals = more, never above the
weakest leg); every stack kind from a posted lineup, power-play pairs only
across lines, power-play trios of the unit (not one the lines already built)."""
import json
import math
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl
import stacks_model as km


def lineup(team="AAA", f=12, d=6):
    ids = [f"{team}f{i}" for i in range(f)] + [f"{team}d{i}" for i in range(d)]
    slots = {p: f"F{i // 3 + 1}" for i, p in enumerate(ids[:f])}
    slots.update({p: f"D{i // 2 + 1}" for i, p in enumerate(ids[f:])})
    return ids, slots


def row(pid, team, slot, chance=0.4, home=False, line=None, over=None, under=None):
    return {"id": pid, "name": f"Player {pid}", "team": team, "pos": "D" if "d" in pid[3:] else "C", "slot": slot, "usual_slot": slot,
            "chance": chance, "g_mean": 0.15, "fair": km.fair_american(chance), "home": home, "out": False,
            "line": line, "over": over, "under": under}


class SharedIce(unittest.TestCase):
    def test_phases_and_overlap(self):
        even, pp = km.phases([(0, "5v5", "5v5"), (100, "pp", "sh"), (220, "5v5", "5v5")], 400)
        self.assertEqual(even, [(0, 100), (220, 400)])
        self.assertEqual(pp, {"home": [(100, 220)], "away": []})
        ice = km.shared_ice({"a": [(0, 150)], "b": [(50, 300)]}, even, pp["home"])
        self.assertEqual(ice["toi"], {"a": [100, 50], "b": [130, 120]})
        self.assertEqual(ice["pairs"][("a", "b")], [50, 50])


class JointChance(unittest.TestCase):
    def test_nothing_shared_is_the_legs_multiplied(self):
        self.assertAlmostEqual(km.joint_chance([0.4, 0.5, 0.3], {}), 0.4 * 0.5 * 0.3, places=12)

    def test_shared_goals_lift_it_but_never_past_the_weakest_leg(self):
        lam = [-math.log(1 - p) for p in (0.4, 0.5)]
        shared = km.shared_rate("FF_line", lam, 0, 0)
        joint = km.joint_chance([0.4, 0.5], {(0, 1): shared})
        self.assertGreater(joint, 0.2)
        self.assertLessEqual(km.joint_chance([0.4, 0.5], {(0, 1): 10.0}), 0.4)

    def test_a_pair_s_own_shared_points_count_after_k(self):
        self.assertAlmostEqual(km.shared_rate("FF_line", [0.5, 0.5], 0, 0), km.RHO["FF_line"] * 0.5)
        self.assertGreater(km.shared_rate("FF_line", [0.5, 0.5], 40, 40), km.shared_rate("FF_line", [0.5, 0.5], 0, 40))
        self.assertEqual(km.shared_rate("opp", [0.5, 0.5], 0, 0), 0.0)


class TeamStacks(unittest.TestCase):
    def test_every_kind_from_the_lineup(self):
        ids, slots = lineup()
        proj = {p: {"chance": 0.4, "goals": 0.15} for p in ids}
        stacks = km.team_stacks("AAA", slots, proj, km.StacksHistory())
        kinds = {k: sum(s["kind"] == k for s in stacks) for k in km.KINDS}
        self.assertEqual(kinds, {"line_pair": 12, "line_trio": 4, "d_pair": 3, "line_fd": 24, "line_pair_d": 24, "line_trio_d": 8,
                                 "line_pair_dd": 12, "pp_pair": 0, "pp_trio": 0})  # no power-play history yet
        trio = next(s for s in stacks if s["kind"] == "line_trio")
        self.assertGreater(trio["chance"], trio["indep"])
        self.assertEqual(trio["fair"], km.fair_american(trio["chance"]))

    def test_power_play_pairs_are_across_lines(self):
        ids, slots = lineup()
        history = km.StacksHistory()
        unit = ["AAAf0", "AAAf1", "AAAf3", "AAAd0", "AAAd2"]
        spans = {p: [(0, 1200)] if p in unit else [(1200, 2400)] for p in ids}
        ice = km.shared_ice(spans, [], [(0, 1200)])
        history.add_game({"home": "AAA", "away": "BBB", "skaters": {p: {"team": "AAA", "g": 0, "a": 0} for p in ids}, "goal_events": [],
                          "ice": {"AAA": ice}})
        stacks = km.team_stacks("AAA", slots, {p: {"chance": 0.4, "goals": 0.15} for p in ids}, history)
        pairs = [set(s["legs"]) for s in stacks if s["kind"] == "pp_pair"]
        self.assertEqual(len(pairs), 9)  # 10 pairs of the unit, less the one on the same line (f0 + f1)
        self.assertNotIn({"AAAf0", "AAAf1"}, pairs)

    def test_power_play_trios_of_the_first_unit(self):
        # The owner, 2026-10-16: Rakell (line 1), Kindel (line 3) and Karlsson (pair 1) are all on PIT's
        # first unit and came as two pairs, never as the three together.
        ids, slots = lineup()
        history = km.StacksHistory()
        unit = ["AAAf0", "AAAf1", "AAAf3", "AAAd0", "AAAd2"]
        spans = {p: [(0, 1200)] if p in unit else [(1200, 2400)] for p in ids}
        history.add_game({"home": "AAA", "away": "BBB", "skaters": {p: {"team": "AAA", "g": 0, "a": 0} for p in ids}, "goal_events": [],
                          "ice": {"AAA": km.shared_ice(spans, [], [(0, 1200)])}})
        stacks = km.team_stacks("AAA", slots, {p: {"chance": 0.4, "goals": 0.15} for p in ids}, history)
        trios = [s for s in stacks if s["kind"] == "pp_trio"]
        self.assertIn({"AAAf0", "AAAf3", "AAAd0"}, [set(s["legs"]) for s in trios])
        self.assertEqual(len(trios), 9)  # 10 trios of the unit, less f0 + f1 + d0: already their line pair + D
        self.assertEqual([s["kind"] for s in stacks if set(s["legs"]) == {"AAAf0", "AAAf1", "AAAd0"}], ["line_pair_d"])
        for s in trios:
            self.assertGreater(s["chance"], s["indep"])  # its pairs share power-play goals
            self.assertLessEqual(s["chance"], 0.4)


if __name__ == "__main__":
    unittest.main()
