"""NHL Line Stacks: the model (nfl_tool/nhl/stacks_model.py) and its half of
the build (build_nhl.py), on the saved game (with its shift chart) and
hand-made ones.

What is pinned: shared ice (even strength and power play) read from the
shift chart; the joint chance (no shared goals = the legs multiplied, shared
goals = more, never above the weakest leg); every stack kind from a posted
lineup, power-play pairs only across lines; the Score (50 = no edge against
the market's legs; the market read off the 0.5 or the 1.5 line); the board
(ONLY a posted projected lineup makes stacks, the lock, a finished game's
hits and void legs); the record (one file per game, written once; said vs
hit, voids left out)."""
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

    def test_the_saved_game(self):
        raw = helpers.nhl_game()
        raw["shifts"] = helpers.nhl_game_shifts()
        ice = build_nhl.reduce_game(raw)["ice"]
        self.assertEqual(set(ice), {"FLA", "BUF"})
        for team in ice.values():
            self.assertGreaterEqual(len(team["toi"]), 18)
            for ev, pp in team["toi"].values():
                self.assertLessEqual(ev + pp, 30 * 60)
            self.assertTrue(any(pp for _, pp in team["pairs"].values()))
        self.assertIsNone(build_nhl.reduce_game(helpers.nhl_game())["ice"])  # no shift chart


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
                                 "line_pair_dd": 12, "pp_pair": 0})  # no power-play history yet
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


class Board(unittest.TestCase):
    def game(self, gid="1", start="2026-10-16T23:00Z", status="scheduled"):
        return {"game_id": gid, "date": "2026-10-16", "away": "AAA", "home": "BBB", "start_utc": start, "status": status}

    def rows(self, posted=True):
        out = []
        for team, home in (("AAA", False), ("BBB", True)):
            ids, slots = lineup(team)
            out += [row(p, team, slots[p] if posted else None, home=home) for p in ids]
        return out

    def test_only_a_posted_lineup_makes_stacks(self):
        now = datetime(2026, 10, 16, 15)
        board = build_nhl.stacks_board({"1": {"players": self.rows(posted=False)}}, [self.game()], [], None, now, km.StacksHistory())
        self.assertEqual(board["1"], {"locked": False, "posted": False, "players": {}, "stacks": []})
        board = build_nhl.stacks_board({"1": {"players": self.rows()}}, [self.game()], [], None, now, km.StacksHistory())
        self.assertTrue(board["1"]["posted"])
        self.assertEqual(len(board["1"]["stacks"]), 2 * 87)
        self.assertEqual([s["score"] for s in board["1"]["stacks"]], sorted((s["score"] for s in board["1"]["stacks"]), reverse=True))

    def test_the_lock_and_the_grades(self):
        now = datetime(2026, 10, 16, 15)
        live = build_nhl.stacks_board({"1": {"players": self.rows()}}, [self.game()], [], None, now, km.StacksHistory())
        later = datetime(2026, 10, 17, 3)
        # Started with nothing saved: nothing shown, never numbers made after puck drop.
        self.assertEqual(build_nhl.stacks_board({"1": {"players": self.rows()}}, [self.game()], [], None, later, km.StacksHistory()), {})
        kept = build_nhl.stacks_board({}, [self.game()], [], {"games": live}, later, km.StacksHistory())
        self.assertTrue(kept["1"]["locked"])
        self.assertEqual(kept["1"]["stacks"], live["1"]["stacks"])
        played = {p: {"g": 1 if p in ("AAAf0", "AAAf1") else 0, "a": 0} for p in live["1"]["players"] if p != "AAAf2"}
        final = build_nhl.stacks_board({}, [self.game(status="final")], [{"id": 1, "skaters": played}], {"games": live}, later, km.StacksHistory())["1"]
        self.assertTrue(final["final"])
        by_legs = {tuple(s["legs"]): s["hit"] for s in final["stacks"]}
        self.assertIs(by_legs[("AAAf0", "AAAf1")], True)
        self.assertIs(by_legs[("AAAf0", "AAAd0")], False)
        self.assertIsNone(by_legs[("AAAf0", "AAAf1", "AAAf2")])  # AAAf2 didn't play: void

    def test_the_score_and_the_market(self):
        self.assertEqual(build_nhl.stack_score(0.2, 0.2), 50)
        self.assertEqual(build_nhl.stack_score(0.22, 0.2), 60)
        self.assertEqual(build_nhl.stack_score(0.01, 0.9), 1)
        self.assertAlmostEqual(build_nhl.market_point_chance({"line": 0.5, "over": -110, "under": -110}), 0.5)
        lo = build_nhl.market_point_chance({"line": 1.5, "over": 200, "under": -250})
        hi = build_nhl.market_point_chance({"line": 1.5, "over": 120, "under": -150})
        self.assertTrue(0.5 < lo < hi < 0.9)
        self.assertIsNone(build_nhl.market_point_chance({"line": None}))


class Record(unittest.TestCase):
    def test_one_file_a_game_written_once(self):
        stacks = helpers.nhl_stacks()
        final = {gid: g for gid, g in stacks["games"].items() if g.get("final")}
        games = [{"game_id": gid, "date": "2026-10-12", "away": "X", "home": "Y"} for gid in final]
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            self.assertEqual(build_nhl.record_stack_games(folder, stacks["games"], games), len(final))
            self.assertEqual(build_nhl.record_stack_games(folder, stacks["games"], games), 0)
            files = sorted(folder.glob("2026-10/*.json"))
            self.assertEqual([f.stem for f in files], sorted(final))
            saved = json.loads(files[0].read_text(encoding="utf-8"))
            self.assertEqual(saved["cols"], list(build_nhl.STACKS_RECORD_COLS))
            summary = build_nhl.stacks_record_summary(folder)
        graded = [s for g in final.values() for s in g["stacks"] if s["hit"] is not None]
        self.assertEqual(summary["stacks"], len(graded))
        self.assertEqual(summary["games"], len(final))
        self.assertEqual(sum(b["hit"] for b in summary["kinds"].values()), sum(s["hit"] for s in graded))
        self.assertAlmostEqual(sum(b["said"] for b in summary["scores"]), sum(s["chance"] for s in graded), places=1)


if __name__ == "__main__":
    unittest.main()
