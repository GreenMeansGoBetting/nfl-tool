"""The NHL points model (nfl_tool/nhl/points_model.py) and the Points page's
half of the build (build_nhl.py), on the saved game (with its shift chart)
and hand-made ones.

What is pinned: every goal kept with its scorer, assists and who was on the
ice, and each shot with its shooting team on the ice (None without a shift
chart); expected points = the Goals model's goals + assists from teammates'
on-ice chances x his share of their goals x each piece; the 1+ chance is
re-scaled and 2+ a plain count; assists from a game with no shift chart
don't count against on-ice numbers it doesn't have; THIS SEASON ONLY;
tonight's linemates are tracked, never in the number; the better side of
the points line at the Points buckets; the board (the Goals page's games
and lock, the first line seen carried, real points on a finished game); the
record (written once, the parts behind each priced player's number, buckets,
closing line value, said vs got)."""
import inspect
import json
import math
import tempfile
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl
import points_model

BENSON = "8484145"  # Zach Benson, BUF forward, in the saved game (FLA 3 @ BUF 5)


def charted_game():
    raw = helpers.nhl_game()
    raw["shifts"] = helpers.nhl_game_shifts()
    return raw


class TheGame(unittest.TestCase):
    """game_goals and game_shots' on-ice players on the saved game."""

    @classmethod
    def setUpClass(cls):
        cls.plain = build_nhl.reduce_game(helpers.nhl_game())
        cls.game = build_nhl.reduce_game(charted_game())

    def test_every_goal_with_its_points(self):
        goals = self.game["goal_events"]
        self.assertEqual(len(goals), 8)
        self.assertEqual(Counter(g["team"] for g in goals), Counter(BUF=5, FLA=3))
        # Every point in the box score is a scorer or an assist here.
        self.assertEqual(sum(1 + len(g["assists"]) for g in goals), sum(s["g"] + s["a"] for s in self.game["skaters"].values()))
        self.assertEqual(sum(g["pp"] for g in goals), 4)

    def test_who_was_on_the_ice(self):
        for g in self.game["goal_events"]:
            self.assertIn(g["scorer"], g["on"])
            self.assertTrue(set(g["assists"]) <= set(g["on"]))
        self.assertTrue(all(s["shooter"] in s["on"] for s in self.game["shots"]))
        # No shift chart: nobody is placed on the ice.
        self.assertTrue(all(g["on"] is None for g in self.plain["goal_events"]))
        self.assertTrue(all(s["on"] is None for s in self.plain["shots"]))

    def test_a_goal_belongs_to_the_shift_it_ended(self):
        find = build_nhl.on_ice_finder({"shifts": [[1, "BUF", 1, "00:00", "01:00"], [2, "BUF", 1, "01:00", "02:00"]]})
        self.assertEqual(find("BUF", 1, "01:00"), ["1"])
        self.assertEqual(find("BUF", 1, 61), ["2"])
        self.assertIsNone(build_nhl.on_ice_finder({"shifts": []}))


class Chances(unittest.TestCase):
    def test_one_or_more_is_rescaled_two_or_more_is_a_plain_count(self):
        a, b = points_model.CALIBRATION
        p = 1 - math.exp(-0.5)
        self.assertAlmostEqual(points_model.chance_at_least(0.5), 1 / (1 + math.exp(-(a + b * math.log(p / (1 - p))))), places=12)
        self.assertAlmostEqual(points_model.chance_at_least(0.5, 1, (0.0, 1.0)), p, places=12)
        self.assertAlmostEqual(points_model.chance_at_least(0.5, 2), 1 - math.exp(-0.5) * 1.5, places=12)
        self.assertEqual(points_model.chance_over(0.5, 0.5), points_model.chance_at_least(0.5, 1))
        self.assertEqual(points_model.chance_over(0.5, 1.5), points_model.chance_at_least(0.5, 2))
        self.assertEqual(points_model.chance_at_least(0), 0.0)


class Projection(unittest.TestCase):
    """The saved game played five times (on five days): enough games to project."""

    @classmethod
    def setUpClass(cls):
        cls.records = []
        for n in range(5):
            r = build_nhl.reduce_game(charted_game())
            r["date"] = f"2026-10-0{n + 1}"
            r["id"] = 100 + n
            cls.records.append(r)
        cls.shots = build_nhl.shots_model_for(cls.records)
        cls.goals = build_nhl.goals_model_for(cls.records, cls.shots, {})
        cls.model = build_nhl.points_model_for(cls.records, cls.goals)

    def test_expected_points_are_goals_plus_assists(self):
        p = self.model.project(BENSON, "FLA", True)
        self.assertAlmostEqual(p["goals_mean"], self.goals.project(BENSON, "FLA", True)["mean"], places=12)
        assists = p["base"] * math.exp(points_model.WEIGHTS["scale"])
        for value in p["lift"].values():
            assists *= value
        self.assertAlmostEqual(p["assists_mean"], assists, places=12)
        self.assertAlmostEqual(p["mean"], p["goals_mean"] + p["assists_mean"], places=12)
        self.assertAlmostEqual(p["chance"], points_model.chance_at_least(p["mean"]), places=12)
        self.assertEqual(set(p["lift"]), set(points_model.WEIGHTS) - {"scale"})
        self.assertEqual(p["season"], {"games": 5, "goals": 0, "assists": self.records[0]["skaters"][BENSON]["a"] * 5,
                                       "points": self.records[0]["skaters"][BENSON]["a"] * 5})

    def test_a_playmaker_out_projects_a_depth_player(self):
        # The game's busiest assister against a skater with no points in it.
        skaters = self.records[0]["skaters"]
        assister = max(skaters, key=lambda pid: (skaters[pid]["a"], skaters[pid]["toi"]))
        quiet = next(pid for pid, s in skaters.items() if s["team"] == skaters[assister]["team"] and s["g"] + s["a"] == 0 and s["pos"] != "D")
        opp = "FLA" if skaters[assister]["team"] == "BUF" else "BUF"
        self.assertGreater(self.model.project(assister, opp, True)["assists_mean"], self.model.project(quiet, opp, True)["assists_mean"])

    def test_a_game_with_no_shift_chart_adds_no_on_ice_numbers(self):
        plain = build_nhl.reduce_game(helpers.nhl_game())
        model = points_model.PointsModel(self.goals)
        model.add_game(plain)
        p = model.players[BENSON]
        self.assertEqual((p["oi_ev_toi"], p["ev_xgo"], p["ev_go"], p["ev_a"], p["pp_a"]), (0, 0, 0, 0, 0))
        self.assertGreater(p["toi"], 0)
        self.assertEqual(p["season"]["games"], 1)

    def test_tonights_linemates_are_tracked_not_in_the_number(self):
        self.assertNotIn("mates", points_model.WEIGHTS)
        skaters = self.records[0]["skaters"]
        mine = [(q, s["pos"]) for q, s in skaters.items() if q != BENSON and s["team"] == "BUF" and s["slot"] == skaters[BENSON]["slot"]]
        self.assertEqual(len(mine), 2)
        self.assertAlmostEqual(self.model.mates(BENSON, mine), 1.0, places=9)  # the same linemates as every game so far
        self.assertIsNone(self.model.mates(BENSON, []))

    def test_the_site_never_gives_the_model_last_season(self):
        self.assertEqual(list(inspect.signature(build_nhl.points_model_for).parameters), ["records", "goals"])
        self.assertNotIn("prior", inspect.signature(points_model.PointsModel).parameters)


class Board(unittest.TestCase):
    """build_nhl.points_board with the saved game (and its shift chart) as the season so far."""

    NOW = datetime(2026, 10, 13, 14, 0)

    @classmethod
    def setUpClass(cls):
        cls.record = build_nhl.reduce_game(charted_game())
        cls.shots = build_nhl.shots_model_for([cls.record])
        cls.goals = build_nhl.goals_model_for([cls.record], cls.shots, {})
        cls.model = build_nhl.points_model_for([cls.record], cls.goals)
        cls.skaters = build_nhl.compute_skaters([cls.record], {})
        cls.lineups = build_nhl.lineup(cls.skaters, Counter(BUF=1, FLA=1))
        cls.goalies = {}
        for g in build_nhl.compute_goalies([cls.record]).values():
            cls.goalies.setdefault(g["team"], []).append(g)

    def schedule(self, **changes):
        return [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 2, "home_rest": 2, **changes}]

    def board(self, games=None, records=(), previous=None, now=None, odds=None):
        odds = {"77": {BENSON: {"points": {"line": 0.5, "over": 150, "under": -190, "thin": False}}}} if odds is None else odds
        return build_nhl.points_board(self.model, games or self.schedule(), self.lineups, {}, list(records), previous, now or self.NOW, None, self.skaters, self.goalies, odds)

    def test_every_skater_priced_or_not(self):
        entry = self.board()["77"]
        rows = entry["players"]
        self.assertEqual(Counter(r["team"] for r in rows), Counter(BUF=18, FLA=18))
        self.assertEqual([r["chance"] for r in rows], sorted((r["chance"] for r in rows), reverse=True))
        benson = next(r for r in rows if r["id"] == BENSON)
        self.assertEqual((benson["line"], benson["over"], benson["under"], benson["first"]), (0.5, 150, -190, {"line": 0.5, "over": 150, "under": -190}))
        self.assertAlmostEqual(benson["mean"], benson["g_mean"] + benson["a_mean"], delta=0.002)
        # The play is the Shots page's better side filed by the Points bar, on the row's own rounded chance.
        play = build_nhl.points_play(benson["chance_over"], 0.5, 150, -190, benson["avg"], benson["move"])
        self.assertEqual((benson["side"], benson["price"], benson["size"]), (play["side"], play["price"], play["size"]))
        self.assertAlmostEqual(benson["edge"], play["edge"], places=3)
        self.assertEqual(benson["chance_over"], benson["chance"])  # a 0.5 line is 1+ point
        unpriced = [r for r in rows if r["id"] != BENSON]
        self.assertTrue(all(r["line"] is None and r["edge"] is None and r["first"] is None and r["fair"] for r in unpriced))
        json.dumps(entry)

    def test_the_first_line_seen_is_kept(self):
        before = self.board()
        later = self.board(previous={"games": before}, odds={"77": {BENSON: {"points": {"line": 0.5, "over": 120, "under": -160}}}})
        benson = next(r for r in later["77"]["players"] if r["id"] == BENSON)
        self.assertEqual((benson["over"], benson["first"]["over"]), (120, 150))

    def test_a_game_that_has_started_keeps_the_last_builds_numbers(self):
        kept = json.loads(json.dumps(self.board()))
        kept["77"]["players"][0]["chance"] = 0.99
        after = self.board(previous={"games": kept}, now=datetime(2026, 10, 13, 23, 30))
        self.assertTrue(after["77"]["locked"])
        self.assertEqual(after["77"]["players"][0]["chance"], 0.99)
        self.assertEqual(self.board(now=datetime(2026, 10, 13, 23, 30)), {})

    def test_a_finished_game_gets_each_players_real_points(self):
        final = {**self.record, "id": 77}
        entry = self.board(self.schedule(status="final"), records=[final], previous={"games": self.board()})["77"]
        actual = {r["id"]: r["actual"] for r in entry["players"]}
        self.assertEqual(sum(v for v in actual.values() if v), 23)
        self.assertEqual(actual[BENSON], self.record["skaters"][BENSON]["a"])


class Record(unittest.TestCase):
    def entry(self, rows):
        return {"77": {"locked": True, "final": True, "players": rows}}

    def row(self, pid, chance, line, over, under, actual, first=None, avg=0.5, move=None):
        priced = line is not None
        return {"id": pid, "name": f"P{pid}", "team": "BUF", "pos": "C", "home": False, "games": 6, "avg": avg, "mean": -math.log(1 - chance), "chance": chance,
                "chance_over": chance if priced else None, "line": line, "over": over, "under": under, "actual": actual, "move": move,
                "first": first if first is not None else ({"line": line, "over": over, "under": under} if priced else None),
                "g_mean": 0.2, "a_mean": 0.3, "ev_min": 14.0, "pp_min": 2.0, "slot": "F1", "mates": 1.1,
                "lift": {"opp": 1.05, "goalie": 0.98, "line": 1.0, "home": 1.0, "b2b": 1.0, "opp_b2b": 1.0, "spread": 1.02},
                "g_lift": {"opp": 1.04, "goalie": 0.99, "finish": 1.01, "split": 1.0, "low": 0.97}}

    def games(self):
        return [{"game_id": "77", "date": "2026-10-13", "away": "BUF", "home": "FLA"}]

    def test_a_finished_game_is_written_once_with_the_parts_behind_each_priced_number(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            rows = [self.row("1", 0.6, 0.5, 100, -120, 1), self.row("2", 0.3, None, None, None, 0), self.row("3", 0.4, 0.5, 120, -140, None)]
            self.assertEqual(build_nhl.record_point_games(folder, self.entry(rows), self.games()), 1)
            self.assertEqual(build_nhl.record_point_games(folder, self.entry([self.row("1", 0.9, 0.5, 100, -120, 0)]), self.games()), 0)
            saved = json.loads((folder / "2026-10.json").read_text(encoding="utf-8"))
            self.assertEqual((saved["cols"], saved["factors"]), (list(build_nhl.POINTS_RECORD_COLS), list(build_nhl.POINTS_FACTORS)))
            plays = saved["games"]["77"]["plays"]
            self.assertEqual([p[0] for p in plays], ["1", "2"])  # the scratch is left out, the unpriced player kept
            factors = dict(zip(build_nhl.POINTS_FACTORS, plays[0][-2]))  # [-1] = Novig's prices (nv)
            self.assertEqual((factors["pos"], factors["slot"], factors["mates"], factors["a_opp"], factors["g_low"], factors["home"]), ("C", "F1", 1.1, 1.05, 0.97, 0))
            self.assertEqual(plays[1][-2:], [None, None])  # no price: no factors, no Novig prices

    def test_the_record(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            rows = [
                self.row("1", 0.60, 0.5, 100, -120, 1, first={"line": 0.5, "over": 120, "under": -140}),  # over, edge 10: a play, won +1, shortened 120 -> 100
                self.row("2", 0.30, 0.5, 100, -130, 0, avg=0.8),   # under (needs 56.5%, has 70%): a play (no more "check" at 12+), won
                self.row("3", 0.47, 0.5, -105, -115, 0),           # under 53% vs 53.5% needed: no edge
                self.row("4", 0.25, None, None, None, 1),          # no price: graded for honesty only
                self.row("5", 0.62, 0.5, 100, -120, 0, move="down"),  # over, edge 12, on a player moved DOWN a line: not a play
                self.row("6", 0.25, 1.5, 120, -150, 1),            # under 1.5, edge 15: the 1.5 line is not a play
            ]
            build_nhl.record_point_games(folder, self.entry(rows), self.games())
            r = build_nhl.points_record_summary(folder)
            self.assertEqual((r["games"], r["players"]), (1, 6))
            self.assertNotIn("strong", r)
            self.assertEqual(r["play"], {"wins": 2, "losses": 0, "units": 1.77})
            self.assertEqual((r["none"]["wins"], r["none"]["losses"]), (2, 1))
            self.assertEqual((r["over"]["wins"], r["under"]["wins"], r["with"]["wins"], r["fade"]["wins"]), (1, 1, 1, 1))
            self.assertEqual((r["clv"]["plays"], r["clv"]["priced"], r["clv"]["shortened"]), (2, 2, 1))
            # Before BEST_PRICES_FROM the saved prices were Novig's: both sides, the cut taken out.
            nv = lambda a, b: build_nhl.break_even(a) / (build_nhl.break_even(a) + build_nhl.break_even(b))
            self.assertAlmostEqual(r["clv"]["points"], (nv(100, -120) - nv(120, -140)) / 2, places=4)
            self.assertEqual(sum(b["players"] for b in r["honest"]), 6)
            self.assertEqual(sum(b["got"] for b in r["honest"]), 3)
            self.assertEqual([p["id"] for p in r["plays"]], ["2", "1"])  # only the plays, biggest edge first
            self.assertEqual([row[:4] for row in r["ledger"]], sorted([["2026-10-13", p["edge"], int(p["won"]), p["units"]] for p in r["plays"]], key=lambda x: -x[1]))
            self.assertEqual(r["days"], [{"date": "2026-10-13", "wins": 2, "losses": 0, "units": 1.77}])

    def test_the_points_bar(self):
        """The owner, 2026-10-22, after the first six nights (Check 49-71, the 1.5 lines 8-20, edges of
        3-6 92-102): a Points play is the 0.5 line, an edge of POINTS_BAR (6) or more, never against
        tonight's line change. Everything else is "none"; 25+ is still "unsure"."""
        size = lambda chance, line=0.5, move=None: build_nhl.points_play(chance, line, -110, -110, None, move)["size"]
        self.assertEqual(build_nhl.POINTS_BAR, 0.06)
        self.assertEqual(size(0.60), "play")                  # over, edge 7.6
        self.assertEqual(size(0.40), "play")                  # under, edge 7.6
        self.assertEqual(size(0.56), "none")                  # edge 3.6: under the bar (no more "lean")
        self.assertEqual(size(0.33), "play")                  # edge 14.6: no more "check" at 12+
        self.assertEqual(size(0.60, move="down"), "none")     # an over on a player moved down
        self.assertEqual(size(0.40, move="up"), "none")       # an under on a player moved up
        self.assertEqual((size(0.60, move="up"), size(0.40, move="down")), ("play", "play"))  # with the move
        self.assertEqual((size(0.60, 1.5), size(0.40, 1.5)), ("none", "none"))  # the 1.5 line
        self.assertEqual(size(0.20), "unsure")


if __name__ == "__main__":
    unittest.main()
