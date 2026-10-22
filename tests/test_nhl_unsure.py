"""Jake Sanderson's night (2026-10-21) and the two guards built after it.

He left Ottawa's opener hurt after 4:29, missed 8 games, and came back on the
top pair. That one game was his whole season to the models, so Shots had him
at 0.07 shots and Points at a 1% chance of a point: u2.5 shots at +37.7 and
u0.5 points at +47.3, both listed as plays, both lost (4 shots, 2 points).

What is pinned:
  * A game cut short before he has three (under half the league's last line
    or pair) is not his role: his minutes come from his full games; with none,
    from tonight's line or pair in the posted lineup, and with no lineup he has
    no number at all. The goals model (and Points on top of it) does the same
    with his EV / PP minutes. A player who plays that little every night is
    still read at his own minutes once he has three games.
  * The safety net: an edge of UNSURE_EDGE (25 points) or more is "unsure" on
    every NHL prop, never a play, and in the record only in its own bucket.
"""
import json
import math
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl
import goals_model
import shots_model


def line(team, pos="C", toi=1080, sog=2, pp_toi=60):
    """One skater's line the way reduce_game writes it."""
    return {"team": team, "pos": pos, "toi": toi, "g": 0, "sog": sog, "att": sog + 1, "unb": sog, "pp_unb": 0,
            "areas": {"slot": [sog, sog, 0]}, "pp_toi": pp_toi}


def shot(shooter, team):
    return {"shooter": shooter, "team": team, "goalie": "99", "area": "slot", "y": 5.0, "dist": 25.0, "angle": 10.0,
            "type": "wrist", "rebound": False, "rush": False, "pp": False, "sh": False, "goal": False}


def game(n, skaters):
    teams = {"OTT": Counter(), "FLA": Counter()}
    for ln in skaters.values():
        teams[ln["team"]].update(sog=ln["sog"], att=ln["att"], unb_pp=0)
    shots = [shot(pid, ln["team"]) for pid, ln in skaters.items() for _ in range(ln["sog"])]
    return {"id": 100 + n, "date": f"2026-10-{n:02d}", "home": "OTT", "away": "FLA", "teams": {t: dict(c) for t, c in teams.items()},
            "skaters": skaters, "goalies": {}, "shots": shots}


def season():
    """Six games. OTT's lines play 20 / 15 / 12 / 10 minutes and its pairs 23 / 18 / 15. In game 1 "sand" takes
    the top pair's place and leaves after 4:29; then "top" is back. "late" is
    hurt in his first game and plays full games after it; "goon" plays four
    minutes every night."""
    records = []
    for n in range(1, 7):
        skaters = {f"d{i}": line("OTT", "D", toi) for i, toi in enumerate((1380, 1080, 1080, 900, 900), 2)}
        skaters["top"] = line("OTT", "D", 1380)
        skaters.update({f"f{i}": line("OTT", "C", toi) for i, toi in enumerate((1200,) * 3 + (900,) * 3 + (720,) * 3 + (600,) * 3)})
        skaters["late"] = line("OTT", "C", 200 if n == 1 else 1000, sog=0 if n == 1 else 2)
        skaters["goon"] = line("OTT", "C", 240, sog=0, pp_toi=0)
        skaters["opp"] = line("FLA")
        if n == 1:
            del skaters["top"]
            skaters["sand"] = line("OTT", "D", 269, sog=0, pp_toi=0)
        records.append(game(n, skaters))
    return records


class TheInjuryGame(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = season()
        cls.shots = build_nhl.shots_model_for(cls.records)
        cls.goals = build_nhl.goals_model_for(cls.records, cls.shots, {})
        cls.old = shots_model.ShotsModel(params={"short_first": 0.0})  # the rule before 2026-10-22
        for r in cls.records:
            cls.old.add_game(r)

    def test_the_game_he_left_hurt_is_set_apart(self):
        self.assertIn((101, "sand"), self.shots.short)
        self.assertIn((101, "late"), self.shots.short)
        self.assertNotIn((101, "f6"), self.shots.short)

    def test_with_no_lineup_he_has_no_number(self):
        self.assertIsNone(self.shots.project("sand", "FLA", True))
        self.assertIsNone(self.shots.project("sand", "FLA", True, team="OTT"))
        self.assertIsNone(self.goals.project("sand", "FLA", True))

    def test_on_the_top_pair_he_gets_the_top_pairs_minutes(self):
        p = self.shots.project("sand", "FLA", True, team="OTT", slot="D1")
        self.assertEqual(p["minutes_from"], "line")
        self.assertAlmostEqual(p["minutes"], self.shots.slot_minutes("OTT", "D1"))
        self.assertEqual(p["lift"]["line"], 1.0)
        # The old way read him as a 4.5-minute defenseman, the line move capped at +80%.
        old = self.old.project("sand", "FLA", True, team="OTT", slot="D1")
        self.assertAlmostEqual(old["minutes"], 269 / 60)
        self.assertGreater(p["mean"], 3 * old["mean"])

    def test_his_full_games_are_his_role(self):
        p = self.shots.project("late", "FLA", True)
        self.assertEqual(p["minutes_from"], "his")
        self.assertAlmostEqual(p["minutes"], 1000 / 60)

    def test_a_player_who_plays_that_little_every_night_is_read_at_his_own_minutes(self):
        p = self.shots.project("goon", "FLA", True)
        self.assertEqual(p["minutes_from"], "his")
        self.assertAlmostEqual(p["minutes"], 4.0)

    def test_the_goals_model_gives_him_the_lines_minutes_too(self):
        p = self.goals.project("sand", "FLA", True, team="OTT", slot="D1")
        minutes = self.shots.slot_minutes("OTT", "D1")
        lg = self.goals.league
        self.assertAlmostEqual(p["ev_min"] + p["pp_min"], minutes)
        self.assertAlmostEqual(p["pp_min"], minutes * lg["D_pp_toi"] / lg["D_toi"])
        # And "late"'s EV / PP minutes skip the night he was hurt, as his shots minutes do.
        late = self.goals.project("late", "FLA", True)
        self.assertAlmostEqual(late["ev_min"] + late["pp_min"], 1000 / 60)


class TheSafetyNet(unittest.TestCase):
    def test_sandersons_plays_are_unsure(self):
        self.assertEqual(build_nhl.UNSURE_EDGE, 0.25)
        # His locked rows: points 0.5 at -103 / -107, the model's over 1%; shots 2.5 at +153 / -165, the over 0%.
        pts = build_nhl.shots_play(0.01, 0.5, -103, -107, 0.0, "up", build_nhl.POINTS_EDGES)
        self.assertEqual((pts["side"], pts["size"]), ("under", "unsure"))
        self.assertAlmostEqual(pts["edge"], 0.473, places=3)
        sog = build_nhl.shots_play(0.0, 2.5, 153, -165, 0.0, "up")
        self.assertEqual((sog["side"], sog["size"]), ("under", "unsure"))

    def test_every_prop_uses_it(self):
        # Just under the net is still a play (Shots) / a check (Points); from it, unsure.
        self.assertEqual(build_nhl.shots_play(0.27, 1.5, -110, -110)["size"], "play")      # edge 20.6
        self.assertEqual(build_nhl.shots_play(0.22, 1.5, -110, -110)["size"], "unsure")    # edge 25.6
        self.assertEqual(build_nhl.shots_play(0.22, 0.5, -110, -110, None, None, build_nhl.POINTS_EDGES)["size"], "unsure")
        self.assertEqual(build_nhl.shots_play(0.22, 0.5, -110, -110, None, "down", build_nhl.POINTS_EDGES)["size"], "unsure")
        self.assertEqual(build_nhl.goals_play(0.45, 300)["size"], "check")                  # +300 needs 25%: edge 20
        self.assertEqual(build_nhl.goals_play(0.52, 300)["size"], "unsure")
        self.assertEqual(build_nhl.saves_play(0.2, 26.5, -110, -110, 25, 22.0, 26.5)["size"], "unsure")

    def test_the_record_keeps_it_out_of_the_plays(self):
        cols = build_nhl.POINTS_RECORD_COLS
        row = lambda pid, chance_over, actual, move: [pid, pid, "OTT", 0.5, -103, -107, 0.5, chance_over, chance_over, actual, 0.0, move, 0.5, -104, -105, None]
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "2026-10.json").write_text(json.dumps({"cols": list(cols), "games": {"1": {"date": "2026-10-21", "away": "FLA", "home": "OTT", "plays": [
                row("sanderson", 0.01, 2, "up"),  # edge 47: unsure, lost
                row("strong", 0.40, 0, None),     # under, edge 8: strong, won
            ]}}}), encoding="utf-8")
            summary = build_nhl.points_record_summary(Path(tmp))
        self.assertEqual(summary["unsure"], {"wins": 0, "losses": 1, "units": -1.0})
        self.assertEqual((summary["strong"]["wins"], summary["strong"]["losses"]), (1, 0))
        self.assertEqual(summary["under"]["losses"], 0)
        self.assertEqual([p["name"] for p in summary["plays"]], ["strong"])
        self.assertEqual(len(summary["ledger"]), 1)

    def test_every_file_says_where_the_net_is(self):
        source = Path(build_nhl.__file__).read_text(encoding="utf-8")
        self.assertEqual(source.count('"unsure": UNSURE_EDGE'), 4)  # shots, goals, points, saves.json


if __name__ == "__main__":
    unittest.main()
