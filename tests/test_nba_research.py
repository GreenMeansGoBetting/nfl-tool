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


class Threes(unittest.TestCase):
    """The Threes panel's data (2026-11-04): threes by how they came, by quarter, who set them up,
    with / without each teammate, and what each defense allowed each position from three. The
    hand-made game with home 14's put-back turned into a made catch-and-shoot three right after his
    own team's offensive rebound: a second-chance three."""
    @classmethod
    def setUpClass(cls):
        events = [dict(e) for e in EVENTS]
        tip = next(i for i, e in enumerate(events) if e["type_text"] == "Tip Shot")
        events[tip].update(type_text="Jump Shot", text="P14 makes 24-foot three point jumper", value=3, points_attempted=3,
                           score=(5, 0), coordinate_x=30, coordinate_y=20)
        for e in events[tip + 1:]:  # every later home score one point higher
            if e["score"]:
                e["score"] = (e["score"][0] + 1, e["score"][1])
        pbp, box = game(events), full_box()
        engine = P.Season(pbp, box)
        block = props.season_block(pbp, box, "x", engine)
        cls.rs = research.block(engine, box, block["players"])
        cls.p = cls.rs["players"]

    def test_second_chance_and_catch(self):
        # [catch, pull-up, step-back, transition, second chance, all] as made / tried
        self.assertEqual(self.p["14"]["t3"], [1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
        self.assertEqual(self.p["14"]["q3"], [1, 1, 0, 0, 0, 0, 0, 0])

    def test_step_back_and_the_misses(self):
        self.assertEqual(self.p["23"]["t3"][4:6], [1, 1])  # his step-back three
        self.assertEqual(self.p["23"]["t3"][8:], [0, 0, 1, 1])  # no offensive rebound before it
        self.assertEqual(self.p["21"]["t3"][:2], [0, 1])  # a missed plain jumper = catch and shoot
        self.assertEqual(self.p["23"]["feed3"], [1, []])  # unassisted

    def test_what_each_defense_allowed(self):
        made = tried = 0
        for team, by in self.rs["def3"].items():
            self.assertIn(team, ("AAA", "BBB"))  # abbreviations, never ESPN's team number
            for row in by.values():
                made, tried = made + row[10], tried + row[11]
        self.assertEqual((made, tried), (2, 4))  # 14 and 23 made; 21 and 12 missed

    def test_with_and_without(self):
        for mate, (om, oa, fm, fa) in self.p["14"].get("w3", {}).items():
            self.assertEqual((om + fm, oa + fa), (1, 1), mate)  # on + off = all his threes


class Rebounds(unittest.TestCase):
    """The Rebounds panel's data (2026-11-04) on the hand-made game: four player rebounds. Home 12
    takes away 21's missed three, home 14 grabs 13's miss (offensive), home 13 takes away 24's miss,
    away 21 takes away 12's missed three. Home's 12, 13, 14, 15 are on the floor for all of them."""
    @classmethod
    def setUpClass(cls):
        pbp, box = game([dict(e) for e in EVENTS]), full_box()
        engine = P.Season(pbp, box)
        block = props.season_block(pbp, box, "x", engine)
        cls.rs = research.block(engine, box, block["players"])
        cls.p = cls.rs["players"]

    def test_chances_and_his_boards(self):
        # [defensive chances, DREB, offensive chances, OREB, seconds]: away missed twice, home twice
        self.assertEqual(self.p["13"]["rb"][:4], [2, 1, 2, 0])
        self.assertEqual(self.p["14"]["rb"][:4], [2, 0, 2, 1])
        self.assertEqual(self.p["21"]["rb"][:4], [2, 1, 2, 0])
        self.assertEqual(sum(self.p["13"]["rcg"].values()), 4)  # every rebound while he played

    def test_where_the_miss_came_from(self):
        zones = research.MISS_ZONES
        self.assertEqual(self.p["13"]["rz"][zones.index("mid")], 1)  # 24's 15-footer
        self.assertEqual(sum(self.p["12"]["rz"][zones.index("corner3"):zones.index("above3") + 1]), 1)  # 21's three
        self.assertEqual(sum(self.rs["mz"]["AAA"]), 2)  # home's two rebounded misses
        self.assertEqual(self.p["14"]["qr"], [1, 1, 0, 0, 0, 0, 0, 0])  # his offensive board, 1st quarter

    def test_each_team_on_the_glass(self):
        # [games, rebounds off their misses, their OREB, off the other team's misses, their DREB, made / shots allowed]
        self.assertEqual(self.rs["rbt"]["AAA"], [1, 2, 1, 2, 2, 1, 3])  # away made 1 of 3 shots
        self.assertEqual(sorted(self.rs["rbt"]), ["AAA", "BBB"])

    def test_with_and_without(self):
        for mate, (r_on, c_on, r_off, c_off) in self.p["13"].get("wr", {}).items():
            self.assertEqual((r_on + r_off, c_on + c_off), (1, 4), mate)


class Assists(unittest.TestCase):
    """The Assists panel's data (2026-11-04) on the hand-made game with home 15's fast-break layup
    (3 seconds after his steal) assisted by home 13. An assist chance = a teammate's made shot while
    he's on the floor: 13 saw three (11's jumper, 14's tip-in, 15's layup)."""
    @classmethod
    def setUpClass(cls):
        events = [dict(e) for e in EVENTS]
        lay = next(i for i, e in enumerate(events) if e["type_text"] == "Driving Layup Shot")
        events[lay].update(text="P15 makes driving layup (P13 assists)", athlete_id_2=13)
        pbp, box = game(events), full_box()
        engine = P.Season(pbp, box)
        block = props.season_block(pbp, box, "x", engine)
        cls.rs = research.block(engine, box, block["players"])
        cls.p = cls.rs["players"]

    def test_chances_and_his_assists(self):
        self.assertEqual(self.p["13"]["ap"], [3, 1, 1])  # 3 teammate makes, 1 assist, on the fast break
        # [chances, assists, then assists to a PG, SG, SF, PF, C]: the hand-made box says only "G"
        self.assertEqual(self.p["13"]["acg"], {"9": [3, 1, 0, 0, 0, 0, 0]})
        self.assertEqual(self.p["13"]["qa"], [1, 0, 0, 0])
        self.assertEqual(self.p["13"]["az"][research.ASSIST_ZONES.index("rim")], 1)
        self.assertEqual(self.p["15"]["ap"][1], 0)  # the shooter isn't credited

    def test_what_each_defense_gave_up(self):
        self.assertEqual(self.rs["daz"]["BBB"][research.ASSIST_ZONES.index("rim")], 1)  # the layup, against away
        self.assertNotIn("AAA", self.rs["daz"])  # away's only make (23's step-back) was unassisted


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
