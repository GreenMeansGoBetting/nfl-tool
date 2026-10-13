"""The GMG score model in the build (nfl_tool/gmg_model.py): its score for the
sample game, the 4-point pick rule, and the lock at kickoff."""
import unittest
from datetime import datetime
from unittest import mock

from helpers import SAMPLE_BUILT_ET, site_data  # first: puts nfl_tool/ on the import path

import gmg_model

BUF_LA = "2026_05_BUF_LA"  # the one game in the sample that hasn't kicked off
MODEL_NUMBERS = ("away_pts", "home_pts", "spread", "spread_pick", "spread_edge", "total", "total_pick", "total_edge", "qb_out")


def run_model(blob, previous, now=SAMPLE_BUILT_ET):
    with mock.patch.object(gmg_model, "eastern_now", return_value=now):
        return gmg_model.compute_gmg_model(blob, previous)


def tiny_blob(*games):
    """Just enough of a data blob for games the model only locks or grades."""
    return {"teams": [], "team_stats": {}, "current_week": 5, "schedule": list(games)}


def game(**fields):
    base = {"game_id": "g1", "week": 5, "away": "AAA", "home": "HHH", "date": "2026-10-11", "time": "13:00", "status": "scheduled", "home_score": None, "away_score": None}
    return {**base, **fields}


class SampleGameScore(unittest.TestCase):
    def test_buf_at_la_score(self):
        """The model's whole answer for one real game. These are the numbers the
        live build locked for it on 2026-10-12 (model_history/gmg_model.json).
        If the model was changed on purpose, update them here; if not, the math
        moved by accident (this is the check that splitting files changes nothing)."""
        entry = run_model(site_data(), None)[BUF_LA]
        self.assertEqual(
            {k: entry.get(k) for k in MODEL_NUMBERS},
            {"away_pts": 24.7, "home_pts": 27.6, "spread": -3.5, "spread_pick": "away", "spread_edge": 0.6, "total": 54.5, "total_pick": "under", "total_edge": 2.2, "qb_out": []},
        )

    def test_only_this_weeks_unstarted_games_are_projected(self):
        """A started game with no earlier copy is left out, never projected
        after the fact; next week's games wait for their own week."""
        self.assertEqual(set(run_model(site_data(), None)), {BUF_LA})


class PickRule(unittest.TestCase):
    def test_a_pick_needs_four_points_from_the_line(self):
        # The browser's copy (GS_MODEL_EDGE) is checked against this in test_site_js.py.
        self.assertEqual(gmg_model.EDGE_POINTS, 4.0)

    def test_edge_is_the_distance_from_the_line(self):
        blob = site_data()
        entry = run_model(blob, None)[BUF_LA]
        margin = entry["home_pts"] - entry["away_pts"]
        self.assertAlmostEqual(entry["spread_edge"], abs(margin + entry["spread"]), places=6)
        self.assertEqual(entry["spread_pick"], "home" if margin + entry["spread"] > 0 else "away")
        points = entry["home_pts"] + entry["away_pts"]
        self.assertAlmostEqual(entry["total_edge"], abs(points - entry["total"]), places=6)
        self.assertEqual(entry["total_pick"], "over" if points > entry["total"] else "under")


class LockAtKickoff(unittest.TestCase):
    def test_kickoff_decides_started(self):
        g = game()
        self.assertFalse(gmg_model.game_has_started(g, datetime(2026, 10, 11, 12, 59)))
        self.assertTrue(gmg_model.game_has_started(g, datetime(2026, 10, 11, 13, 0)))
        self.assertTrue(gmg_model.game_has_started(game(status="final"), datetime(2026, 10, 1, 0, 0)))
        self.assertTrue(gmg_model.game_has_started(game(home_score=0), datetime(2026, 10, 1, 0, 0)))

    def test_started_games_keep_their_stored_entry(self):
        blob = site_data()
        stored = blob["gmg_model"]
        started = [gid for gid in stored if gid != BUF_LA]
        self.assertGreaterEqual(len(started), 10)
        out = run_model(blob, stored)
        for gid in started:
            self.assertTrue(out[gid]["frozen"], gid)
            for key in MODEL_NUMBERS + ("updated",):
                self.assertEqual(out[gid].get(key), stored[gid].get(key), f"{gid} {key} changed after kickoff")

    def test_a_locked_entry_is_not_re_run_with_the_game_inside_the_stats(self):
        """The check above would pass by luck if a re-run gave the same numbers.
        On the sample it doesn't: those games are now inside the stats."""
        blob = site_data()
        grades = gmg_model._Grades(blob)
        moved = 0
        for g in blob["schedule"]:
            stored = blob["gmg_model"].get(g["game_id"])
            again = gmg_model._project(blob, grades, g) if stored and stored.get("frozen") else None
            if again:
                moved += (again["away_pts"], again["home_pts"]) != (stored["away_pts"], stored["home_pts"])
        self.assertGreaterEqual(moved, 5)

    def test_a_game_locks_the_moment_it_kicks_off(self):
        blob = site_data()
        before = run_model(blob, None)[BUF_LA]
        g = next(x for x in blob["schedule"] if x["game_id"] == BUF_LA)
        g["novig"] = {**(g.get("novig") or {}), "home_team_spread": 6.5, "total_line": 61.5}  # in-game numbers
        after = run_model(blob, {BUF_LA: before}, now=datetime(2026, 10, 12, 21, 0))[BUF_LA]
        self.assertTrue(after["frozen"])
        for key in MODEL_NUMBERS:
            self.assertEqual(after[key], before[key], key)


class Grading(unittest.TestCase):
    ENTRY = {"week": 5, "away": "AAA", "home": "HHH", "away_pts": 20.0, "home_pts": 25.0, "spread": -3.5, "spread_pick": "home", "spread_edge": 1.5, "total": 44.5, "total_pick": "over", "total_edge": 0.5}

    def grade(self, away_score, home_score, **entry):
        # The schedule's own line has moved to -9.5 / 60: grading must ignore it.
        final = game(status="final", away_score=away_score, home_score=home_score, home_team_spread=-9.5, total_line=60)
        return run_model(tiny_blob(final), {"g1": {**self.ENTRY, **entry}})["g1"]

    def test_graded_against_the_line_the_pick_was_made_at(self):
        out = self.grade(20, 27)  # home by 7 covers -3.5 (not -9.5); 47 points is over 44.5 (not 60)
        self.assertEqual((out["spread_result"], out["total_result"], out["final"]), ("win", "win", [20, 27]))

    def test_losses_and_pushes(self):
        out = self.grade(20, 23)  # home by 3 doesn't cover -3.5; 43 points is under 44.5
        self.assertEqual((out["spread_result"], out["total_result"]), ("loss", "loss"))
        out = self.grade(20, 27, spread=-7, total=47)
        self.assertEqual((out["spread_result"], out["total_result"]), ("push", "push"))
        out = self.grade(20, 23, spread_pick="away", total_pick="under")
        self.assertEqual((out["spread_result"], out["total_result"]), ("win", "win"))

    def test_no_result_until_the_game_is_final(self):
        live = game(status="scheduled")  # kicked off, no score yet
        out = run_model(tiny_blob(live), {"g1": dict(self.ENTRY)})["g1"]
        self.assertTrue(out["frozen"])
        self.assertNotIn("spread_result", out)


if __name__ == "__main__":
    unittest.main()
