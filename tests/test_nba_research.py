"""NBA Prop Research panel data (nfl_tool/nba/research.py, props.json `research`, 2026-11-03).

What is pinned on the engine's hand-made game (one quarter): a player's points by quarter and
on transition add up to his points; the rotation strip marks the minutes he was on the floor;
possessions vs bench / starter units come from that night's starters; the defense numbers sit
under the team's abbreviation, never ESPN's team number; and the line history keeps the main
line (the one most books hang) of untipped games only."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
sys.path.insert(0, str(ROOT / "tests"))
import possessions as P  # noqa: E402
import props  # noqa: E402
import research  # noqa: E402
import zone_matchups  # noqa: E402
from test_nba_possessions import EVENTS, game  # noqa: E402
from test_nba_props import full_box  # noqa: E402


class Block(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pbp, box = game([dict(e) for e in EVENTS]), full_box()
        engine = P.Season(pbp, box)
        block = props.season_block(pbp, box, "x", engine)
        cls.rs = research.block(engine, box, block["players"], {"9": [221.5, -3.5]})
        cls.p = cls.rs["players"]

    def test_quarters_and_transition_add_up(self):
        q, trans = self.p["15"]["q"], self.p["15"]["trans"]
        self.assertEqual(q, [2, 0, 0, 0])  # his layup, in the 1st
        self.assertEqual(trans[1], sum(q))
        self.assertLessEqual(trans[0], trans[1])

    def test_rotation_strip(self):
        # 15 played the whole (only) quarter: on the floor minutes 1-12, nothing after
        self.assertEqual(self.p["15"]["rotn"], [1, 1])
        self.assertEqual(self.p["15"]["rot"][:12], [1] * 12)
        self.assertEqual(sum(self.p["15"]["rot"][12:]), 0)
        self.assertEqual(self.p["15"]["rot1"], [1] * 12 + [0] * 36)  # his last game, minute by minute

    def test_units_and_team_keys(self):
        # every possession had the other team's starters on the floor: none vs a bench unit
        units = self.p["15"]["units"]
        self.assertEqual(units[0], 0)
        self.assertGreater(units[2], 0)
        self.assertEqual(sorted(self.rs["teams"]), ["AAA", "BBB"])

    def test_game_pace_and_line(self):
        pace, total, spread = self.rs["games"]["9"]
        self.assertGreater(pace, 0)
        self.assertEqual((total, spread), (221.5, -3.5))


class LineHistory(unittest.TestCase):
    def test_main_lines_until_tip(self):
        q = lambda *ls: [["dk", "o", line, -110, ""] for line in ls]  # noqa: E731
        odds = {"A_B": {"props": {"points": {"1": {"q": q(20.5, 20.5, 21.5)}}, "threes": {"1": {"q": q(2.5)}}}},
                "C_D": {"props": {"points": {"2": {"q": q(10.5)}}}}}
        games = [{"game_id": "1", "date": "2026-11-03", "away": "A", "home": "B", "started": False},
                 {"game_id": "2", "date": "2026-11-03", "away": "C", "home": "D", "started": True}]
        record = {"2": {"date": "2026-11-03", "lines": {"2": [9.5, None, None, None]}}}
        changed = research.line_record(record, odds, games, lambda g: g["started"], zone_matchups.main_line)
        self.assertTrue(changed)
        self.assertEqual(record["1"]["lines"]["1"], [20.5, 2.5, None, None])  # most books' line
        self.assertEqual(record["2"]["lines"]["2"], [9.5, None, None, None])  # tipped: never rewritten
        self.assertFalse(research.line_record(record, odds, games, lambda g: g["started"], zone_matchups.main_line))


if __name__ == "__main__":
    unittest.main()
