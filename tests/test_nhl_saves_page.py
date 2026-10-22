"""The Saves page's data (saves_row, saves_board, the Saves record and
saves_file in build_nhl.py), on hand-made King of the Crease rows and the
saved crease sample.

What is pinned: the chance of the over is the saves model's at his main line
(and at each of its other lines), rounded once so the page and the record
grade the same number; the play is the better side at Novig's price with the
Points page's buckets, plus "check" when the model is 4+ saves from what the
line says; a goalie with no line has no play; the first line and prices seen
are carried while the row names the same goalie and start over when the
starter changes; a goalie who didn't start is void and never graded; the
record is written once and summed (buckets, overs / unders, closing line
value, said vs went over); the sample builds."""
import json
import tempfile
import unittest
from pathlib import Path

from helpers import nhl_crease, nhl_saves  # first: puts the build's folders on the import path

import build_nhl
import saves_model


def crease_row(**over):
    """A King of the Crease row as crease_row writes it (only what the Saves page reads)."""
    row = {
        "game_id": "9001", "team": "AAA", "opp": "BBB", "home": True, "locked": False,
        "id": "g1", "name": "Al Goalie", "source": "both", "other": None, "doubt": False,
        "starts": 5, "saves_avg": 26.0, "sv_pct": 0.91, "high": 33,
        "opp_shots": 30.0, "opp_shots_rank": 8, "allowed": 29.0, "allowed_rank": 10, "b2b": False, "opp_b2b": False,
        "shots": 28.0, "mean": 25.4, "lift": {"off": 1.03, "def": 1.02, "home": 0.97, "b2b": 1.0, "opp_b2b": 1.0, "sv": 1.0},
        "line": 26.5, "over": -110, "under": -110, "thin": False, "alts": [[28.5, 150]],
        "mkt_mean": 26.4, "blend": 26.1, "weight": 0.2, "check": False, "big": 0.1, "top": 0.1, "mkt_top": 0.1, "value": 1.0, "tags": [],
    }
    row.update(over)
    return row


def days(*rows, date="2026-10-20"):
    return {date: {"goalies": list(rows), "starters": len(rows), "final": False, "best": None}}


class Row(unittest.TestCase):
    def test_the_chance_and_the_play(self):
        r = build_nhl.saves_row(crease_row(), None)
        self.assertEqual(r["chance_over"], round(saves_model.chance_over(25.4, 26.5), 3))
        self.assertEqual(r["side"], "under")
        self.assertEqual(r["price"], -110)
        self.assertAlmostEqual(r["edge"], 1 - r["chance_over"] - build_nhl.break_even(-110), places=3)
        self.assertEqual(r["size"], build_nhl.shots_play(r["chance_over"], 26.5, -110, -110, 26.0, None, build_nhl.SAVES_EDGES)["size"])
        self.assertEqual(r["fair"], build_nhl.shots_model.fair_american(1 - r["chance_over"]))
        self.assertEqual(r["alts"], [[28.5, 150, round(saves_model.chance_over(25.4, 28.5), 3)]])
        self.assertEqual(r["gap"], -1.0)
        # King of the Crease's own numbers stay on crease.json.
        for key in build_nhl.CREASE_ONLY_KEYS:
            self.assertNotIn(key, r)

    def test_a_model_far_from_the_line_is_check(self):
        # A steep under price, so the edge is only a lean's: the gap alone sets it apart.
        need = 1 - saves_model.chance_over(22.0, 26.5) - 0.05
        under = round(-100 * need / (1 - need))
        r = build_nhl.saves_row(crease_row(mean=22.0, mkt_mean=26.4, over=None, under=under), None)
        self.assertGreaterEqual(r["edge"], build_nhl.SAVES_EDGES["lean"])
        self.assertLess(r["edge"], build_nhl.SAVES_EDGES["check"])
        self.assertEqual(r["size"], "check")
        # The same play without the gap is an ordinary bucket.
        self.assertIn(build_nhl.saves_play(r["chance_over"], 26.5, None, under, 26.0, 22.0, 24.0)["size"], ("strong", "lean"))

    def test_no_line_no_play(self):
        r = build_nhl.saves_row(crease_row(line=None, over=None, under=None, mkt_mean=None, alts=[]), None)
        for key in ("chance_over", "side", "price", "edge", "size", "fair", "gap", "first"):
            self.assertIsNone(r[key], key)

    def test_a_line_with_no_price_has_a_chance_but_no_play(self):
        r = build_nhl.saves_row(crease_row(over=None, under=None), None)
        self.assertIsNotNone(r["chance_over"])
        self.assertIsNone(r["side"])

    def test_someone_else_starting_is_void(self):
        self.assertTrue(build_nhl.saves_row(crease_row(actual=30, started="Bo Backup"), None)["void"])
        self.assertFalse(build_nhl.saves_row(crease_row(actual=30, started="Al Goalié"), None)["void"])
        self.assertFalse(build_nhl.saves_row(crease_row(), None)["void"])


class Board(unittest.TestCase):
    def test_first_seen_is_carried_for_the_same_goalie_only(self):
        board = build_nhl.saves_board(days(crease_row()), None, [])
        self.assertEqual(board["9001"]["goalies"][0]["first"], {"line": 26.5, "over": -110, "under": -110})
        previous = {"games": {"9001": {"goalies": [{"team": "AAA", "name": "Al Goalie", "first": {"line": 25.5, "over": 120, "under": -150}}]}}}
        moved = build_nhl.saves_board(days(crease_row()), previous, [])
        self.assertEqual(moved["9001"]["goalies"][0]["first"], {"line": 25.5, "over": 120, "under": -150})
        swapped = build_nhl.saves_board(days(crease_row(id="g2", name="Bo Backup")), previous, [])
        self.assertEqual(swapped["9001"]["goalies"][0]["first"], {"line": 26.5, "over": -110, "under": -110})

    def test_grouped_by_game_best_edge_first_and_final_from_the_records(self):
        rows = [crease_row(), crease_row(team="BBB", opp="AAA", home=False, id="g2", name="Bo Two", mean=30.0, mkt_mean=27.0),
                crease_row(game_id="9002", team="CCC", line=None, over=None, under=None, mkt_mean=None, alts=[])]
        board = build_nhl.saves_board(days(*rows), None, [{"id": 9002}])
        self.assertEqual([r["team"] for r in board["9001"]["goalies"]], ["BBB", "AAA"])
        self.assertEqual(board["9001"]["date"], "2026-10-20")
        self.assertFalse(board["9001"]["final"])
        self.assertTrue(board["9002"]["final"])


class Record(unittest.TestCase):
    def test_written_once_and_summed(self):
        played = [
            crease_row(locked=True, actual=22, started="Al Goalie"),  # an under at 26.5: won
            crease_row(team="BBB", opp="AAA", home=False, id="g2", name="Bo Two", mean=30.0, mkt_mean=29.5, line=27.5, locked=True, actual=31, started="Bo Two"),  # over: won
        ]
        void = crease_row(game_id="9002", team="CCC", id="g3", name="Cy Three", locked=True, actual=40, started="Dee Other")
        board = build_nhl.saves_board(days(*played, void), None, [{"id": 9001}, {"id": 9002}])
        games = [{"game_id": "9001", "date": "2026-10-20", "away": "BBB", "home": "AAA"}, {"game_id": "9002", "date": "2026-10-20", "away": "DDD", "home": "CCC"}]
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            self.assertEqual(build_nhl.record_saves_games(folder, board, games), 1)  # the void game has nobody to grade
            self.assertEqual(build_nhl.record_saves_games(folder, board, games), 0)
            saved = json.loads((folder / "2026-10.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["cols"], list(build_nhl.SAVES_RECORD_COLS))
            plays = saved["games"]["9001"]["plays"]
            self.assertEqual(len(plays), 2)
            self.assertEqual(len(plays[0][-2]), len(build_nhl.SAVES_FACTORS))  # [-1] = Novig's prices (nv)
            summary = build_nhl.saves_record_summary(folder)
        self.assertEqual((summary["games"], summary["goalies"]), (1, 2))
        rows = {r["id"]: r for r in board["9001"]["goalies"]}
        called = [r for r in rows.values() if r["size"] in ("strong", "lean")]
        self.assertEqual(sum(summary[k]["wins"] + summary[k]["losses"] for k in ("strong", "lean")), len(called))
        self.assertEqual(sum(summary[k]["losses"] for k in ("strong", "lean", "none", "check")), 0)
        self.assertEqual(sum(b["goalies"] for b in summary["honest"]), 2)
        self.assertEqual(summary["clv"]["plays"], len(called))
        self.assertEqual(len(summary["ledger"]), len([r for r in rows.values() if r["size"] != "none"]))


class Sample(unittest.TestCase):
    def test_the_crease_sample_builds(self):
        saves = nhl_saves()
        crease = nhl_crease()
        self.assertEqual(sum(len(g["goalies"]) for g in saves["games"].values()), sum(len(d["goalies"]) for d in crease["days"].values()))
        priced = [r for g in saves["games"].values() for r in g["goalies"] if r["side"]]
        self.assertTrue(priced)
        for r in priced:
            self.assertEqual(r["size"], build_nhl.saves_play(r["chance_over"], r["line"], r["over"], r["under"], r["saves_avg"], r["mean"], r["mkt_mean"])["size"])
        self.assertEqual(saves["record"]["games"], 0)


if __name__ == "__main__":
    unittest.main()
