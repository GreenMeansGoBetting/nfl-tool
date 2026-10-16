"""The NHL anytime-goal model (nfl_tool/nhl/goals_model.py) and the Goals
page's half of the build (build_nhl.py), on the saved game and hand-made ones.

What is pinned: the shots the expected-goals table reads (no empty nets or
own-goalie-pulled shots, every goal kept); the plain-Python logistic fit
(the answer doesn't depend on where it starts, closer shots score more); the
off wing; power-play seconds from the league's report; a projection is his
usual times each piece and the chance is 1 - e^-mean; THIS SEASON ONLY; the
Zone Match tag (heavy area AND a top-10 defense for shots allowed there,
never in the number); how a price is filed (and a player moved down a line
set apart); the board (the Shots page's games and lock, the first price seen
carried, real goals on a finished game) and the record (written once, buckets,
closing line value, said vs scored)."""
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
import goals_model
import shots_model

BENSON = "8484145"  # Zach Benson, BUF forward, in the saved game (FLA @ BUF)


def shot(shooter, team, area="slot", dist=20.0, goal=False, y=5.0, pp=False, goalie="99"):
    return {"shooter": shooter, "team": team, "goalie": goalie, "area": area, "y": y, "dist": dist, "angle": 10.0,
            "type": "wrist", "rebound": False, "rush": False, "pp": pp, "sh": False, "goal": goal}


def line(team, pos="C", toi=1080, g=0, sog=2, pp_toi=60):
    return {"team": team, "pos": pos, "toi": toi, "g": g, "sog": sog, "att": sog + 1, "unb": sog, "pp_unb": 0, "areas": {"slot": [sog, sog, g]}, "pp_toi": pp_toi}


def game(date, home, away, skaters, shots, game_id=1):
    teams = {home: Counter(), away: Counter()}
    for ln in skaters.values():
        teams[ln["team"]].update(sog=ln["sog"], att=ln["att"], unb_pp=0)
    return {"id": game_id, "date": date, "home": home, "away": away, "teams": {t: dict(c) for t, c in teams.items()},
            "skaters": skaters, "goalies": {}, "shots": shots}


class TheShots(unittest.TestCase):
    """build_nhl.game_shots on the saved game (FLA 3 @ BUF 5)."""

    @classmethod
    def setUpClass(cls):
        cls.raw = helpers.nhl_game()
        cls.game = build_nhl.reduce_game(cls.raw)

    def test_every_unblocked_shot_on_a_goalie(self):
        shots = self.game["shots"]
        self.assertEqual(Counter(s["team"] for s in shots), Counter(FLA=44, BUF=42))
        # Every goal is in (none went into an empty net).
        self.assertEqual(sum(s["goal"] for s in shots), 8)
        # Florida's two shots with its own goalie pulled are left out (the rink areas keep them).
        self.assertEqual(sum(self.game["teams"]["FLA"][f"a_{a}"] for a in build_nhl.AREAS if f"a_{a}" in self.game["teams"]["FLA"]), 46)
        self.assertEqual({s["area"] for s in shots} <= set(goals_model.AREAS), True)
        self.assertEqual(sum(s["rebound"] for s in shots), 10)
        self.assertEqual(sum(s["pp"] for s in shots), 22)

    def test_a_shot_reads_where_and_how(self):
        first = [s for s in self.game["shots"] if s["shooter"] == BENSON][0]
        self.assertEqual((first["area"], first["dist"], first["angle"], first["type"], first["rebound"]), ("low_slot", 9.0, 0.0, "snap", True))

    def test_power_play_seconds_from_the_leagues_report(self):
        self.assertIsNone(self.game["skaters"][BENSON]["pp_toi"])  # a game without the report
        with_report = build_nhl.reduce_game({**self.raw, "pp_toi": {BENSON: 95}})
        self.assertEqual(with_report["skaters"][BENSON]["pp_toi"], 95)
        self.assertEqual(next(v["pp_toi"] for k, v in with_report["skaters"].items() if k != BENSON), 0)


class ExpectedGoals(unittest.TestCase):
    def shots(self):
        # Close shots score 3 in 10, far ones 1 in 20.
        out = []
        for n in range(400):
            close = n % 2 == 0
            out.append(shot("1", "BUF", "low_slot" if close else "point", 8.0 if close else 55.0, goal=(n % 20 < 6) if close else (n % 40 == 1)))
        return out

    def test_closer_shots_are_worth_more_and_the_fit_is_honest(self):
        shots = self.shots()
        w = goals_model.fit_xg(shots, False)
        close = goals_model.xg_of(shots[0], w, False)
        far = goals_model.xg_of(shots[1], w, False)
        self.assertGreater(close, far)
        # A logistic fit's chances add up to the goals (the ridge leaves the constant alone).
        self.assertAlmostEqual(sum(goals_model.xg_of(s, w, False) for s in shots), sum(s["goal"] for s in shots), delta=0.05)

    def test_where_the_fit_starts_does_not_change_the_answer(self):
        shots = self.shots()
        cold = goals_model.fit_xg(shots, True)
        warm = goals_model.fit_xg(shots, True, start=[v + 0.3 for v in cold])
        self.assertEqual(len(cold), 18)
        for a, b in zip(cold, warm):
            self.assertAlmostEqual(a, b, places=6)

    def test_the_off_wing(self):
        hand = {"R": "R", "L": "L"}
        self.assertTrue(goals_model.off_wing(shot("R", "BUF", "left", y=12), hand))     # right shot, left side
        self.assertTrue(goals_model.off_wing(shot("L", "BUF", "right", y=-12), hand))   # left shot, right side
        self.assertFalse(goals_model.off_wing(shot("R", "BUF", "right", y=-12), hand))
        self.assertFalse(goals_model.off_wing(shot("R", "BUF", "point", y=12), hand))   # not from the point
        self.assertFalse(goals_model.off_wing(shot("?", "BUF", "left", y=12), hand))    # handedness unknown


class Projection(unittest.TestCase):
    """Six hand-made games: BUF's shooter "1" lives in the low slot; FLA gives up a lot from there."""

    @classmethod
    def setUpClass(cls):
        cls.records = []
        for n in range(6):
            skaters = {"1": line("BUF", g=1 if n % 3 == 0 else 0), "2": line("BUF", "D", toi=1300, pp_toi=0), "3": line("FLA"), "4": line("TBL"), "5": line("NYR")}
            shots = [shot("1", "BUF", "low_slot", 9.0, goal=n % 3 == 0) for _ in range(5)] + [shot("2", "BUF", "point", 55.0) for _ in range(3)]
            shots += [shot("3", "FLA", "point", 55.0) for _ in range(6)]
            # FLA's opponents get low-slot looks; TBL / NYR play a quiet game of point shots.
            shots += [shot("4", "TBL", "point", 55.0) for _ in range(4)] + [shot("5", "NYR", "slot", 25.0) for _ in range(2)]
            skaters_bf = {k: v for k, v in skaters.items() if v["team"] in ("BUF", "FLA")}
            skaters_tn = {k: v for k, v in skaters.items() if v["team"] in ("TBL", "NYR")}
            cls.records.append(game(f"2026-10-0{n + 1}", "FLA", "BUF", skaters_bf, [s for s in shots if s["team"] in ("BUF", "FLA")], 10 + n))
            cls.records.append(game(f"2026-10-0{n + 1}", "TBL", "NYR", skaters_tn, [s for s in shots if s["team"] in ("TBL", "NYR")], 20 + n))
        cls.shots = build_nhl.shots_model_for(cls.records)
        cls.model = build_nhl.goals_model_for(cls.records, cls.shots, {})

    def test_a_projection_is_his_usual_times_each_piece(self):
        p = self.model.project("1", "FLA", False)
        mean = p["base"] * math.exp(goals_model.WEIGHTS["scale"])
        for value in p["lift"].values():
            mean *= value
        self.assertAlmostEqual(p["mean"], mean, places=9)
        self.assertAlmostEqual(p["chance"], 1 - math.exp(-p["mean"]), places=9)
        self.assertEqual(set(p["lift"]), set(goals_model.WEIGHTS) - {"scale"})

    def test_a_net_front_shooter_out_projects_a_point_shooter(self):
        self.assertGreater(self.model.project("1", "FLA", False)["mean"], self.model.project("2", "FLA", False)["mean"])

    def test_the_low_slot_trim_points_down_for_a_net_front_shooter(self):
        self.assertLess(self.model.project("1", "FLA", False)["lift"]["low"], 1.0)

    def test_the_zone_match_tag(self):
        # BUF's defense allows only point shots: 4th of 4 teams is "top 10" here, but no weakness.
        self.assertIsNone(self.model.zone_match("1", "BUF"))
        # FLA allows BUF's 5 low-slot shots a game, the most in this little league.
        tag = self.model.zone_match("1", "FLA")
        self.assertEqual((tag["area"], tag["opp_rank"]), ("low_slot", 1))
        self.assertGreaterEqual(tag["share"], goals_model.ZONE["heavy"] * tag["lg_share"])
        # The tag is never in the number: the projection has no zone piece.
        self.assertNotIn("zone", goals_model.WEIGHTS)

    def test_too_few_shots_for_a_tag(self):
        model = build_nhl.goals_model_for(self.records[:4], build_nhl.shots_model_for(self.records[:4]), {})  # 2 games: 10 low-slot shots
        self.assertIsNone(model.zone_match("1", "FLA"))

    def test_the_site_never_gives_the_model_last_season(self):
        self.assertEqual(list(inspect.signature(build_nhl.goals_model_for).parameters), ["records", "shots", "hand"])
        self.assertNotIn("prior", inspect.signature(goals_model.GoalsModel).parameters)


class Prices(unittest.TestCase):
    def test_how_a_price_is_filed(self):
        # +300 needs 25%.
        self.assertEqual(build_nhl.goals_play(0.27, 300)["size"], "none")
        self.assertEqual(build_nhl.goals_play(0.29, 300)["size"], "lean")
        self.assertEqual(build_nhl.goals_play(0.32, 300)["size"], "strong")
        self.assertEqual(build_nhl.goals_play(0.40, 300)["size"], "check")
        self.assertAlmostEqual(build_nhl.goals_play(0.32, 300)["edge"], 0.07)
        self.assertIsNone(build_nhl.goals_play(0.3, None))

    def test_a_player_moved_down_a_line_is_set_apart(self):
        self.assertEqual(build_nhl.goals_play(0.32, 300, "down")["size"], "check")
        self.assertEqual(build_nhl.goals_play(0.32, 300, "up")["size"], "strong")
        self.assertEqual(build_nhl.goals_play(0.2, 300, "down")["size"], "none")


class Board(unittest.TestCase):
    """build_nhl.goals_board with the saved game as the season so far."""

    NOW = datetime(2026, 10, 13, 14, 0)

    @classmethod
    def setUpClass(cls):
        cls.record = build_nhl.reduce_game(helpers.nhl_game())
        cls.shots = build_nhl.shots_model_for([cls.record])
        cls.model = build_nhl.goals_model_for([cls.record], cls.shots, {})
        cls.skaters = build_nhl.compute_skaters([cls.record], {})
        cls.lineups = build_nhl.lineup(cls.skaters, Counter(BUF=1, FLA=1))
        cls.goalies = {}
        for g in build_nhl.compute_goalies([cls.record]).values():
            cls.goalies.setdefault(g["team"], []).append(g)

    def schedule(self, **changes):
        return [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 2, "home_rest": 2, **changes}]

    def board(self, games=None, records=(), previous=None, now=None, odds=None):
        odds = {"77": {BENSON: {"goal": {"odds": 400, "no_odds": -600, "thin": False}}}} if odds is None else odds
        return build_nhl.goals_board(self.model, games or self.schedule(), self.lineups, {}, list(records), previous, now or self.NOW, None, self.skaters, self.goalies, odds)

    def test_every_skater_priced_or_not(self):
        entry = self.board()["77"]
        rows = entry["players"]
        self.assertEqual(Counter(r["team"] for r in rows), Counter(BUF=18, FLA=18))
        self.assertEqual([r["chance"] for r in rows], sorted((r["chance"] for r in rows), reverse=True))
        benson = next(r for r in rows if r["id"] == BENSON)
        self.assertEqual((benson["odds"], benson["first_odds"], benson["games"], benson["goals"], benson["shots"]), (400, 400, 1, 0, 3))
        self.assertAlmostEqual(benson["edge"], benson["chance"] - 0.2, delta=0.0011)
        self.assertAlmostEqual(benson["fair"], shots_model.fair_american(benson["chance"]), delta=3)  # the row's chance is rounded
        unpriced = [r for r in rows if r["id"] != BENSON]
        self.assertTrue(all(r["odds"] is None and r["edge"] is None and r["fair"] for r in unpriced))
        # The other team's goalie: its only starter so far.
        self.assertEqual(benson["goalie"], next(str(g["id"]) for g in self.goalies["FLA"] if g["starts"]))
        json.dumps(entry)

    def test_the_first_price_seen_is_kept(self):
        before = self.board()
        later = self.board(previous={"games": before}, odds={"77": {BENSON: {"goal": {"odds": 330}}}})
        benson = next(r for r in later["77"]["players"] if r["id"] == BENSON)
        self.assertEqual((benson["odds"], benson["first_odds"]), (330, 400))

    def test_a_game_that_has_started_keeps_the_last_builds_numbers(self):
        kept = json.loads(json.dumps(self.board()))
        kept["77"]["players"][0]["chance"] = 0.99
        after = self.board(previous={"games": kept}, now=datetime(2026, 10, 13, 23, 30))
        self.assertTrue(after["77"]["locked"])
        self.assertEqual(after["77"]["players"][0]["chance"], 0.99)
        self.assertEqual(self.board(now=datetime(2026, 10, 13, 23, 30)), {})

    def test_a_finished_game_gets_each_players_real_goals(self):
        final = {**self.record, "id": 77}
        entry = self.board(self.schedule(status="final"), records=[final], previous={"games": self.board()})["77"]
        actual = {r["id"]: r["actual"] for r in entry["players"]}
        self.assertEqual(sum(actual.values()), 8)
        self.assertEqual(actual[BENSON], 0)


class Record(unittest.TestCase):
    def entry(self, rows):
        return {"77": {"locked": True, "final": True, "players": rows}}

    def row(self, pid, chance, odds, first, actual, zone=None, thin=False, move=None):
        return {"id": pid, "name": f"P{pid}", "team": "BUF", "chance": chance, "mean": -math.log(1 - chance), "odds": odds, "first_odds": first,
                "thin": thin, "zone": {"area": zone} if zone else None, "actual": actual, "move": move}

    def games(self):
        return [{"game_id": "77", "date": "2026-10-13", "away": "BUF", "home": "FLA", "total_line": 6.5, "away_ml_implied_prob": 0.45, "home_ml_implied_prob": 0.55}]

    def test_a_finished_game_is_written_once_with_everyone_who_played(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            rows = [self.row("1", 0.3, 300, 350, 1), self.row("2", 0.1, None, None, 0), {**self.row("3", 0.2, 400, 400, None)}]
            self.assertEqual(build_nhl.record_goal_games(folder, self.entry(rows), self.games()), 1)
            self.assertEqual(build_nhl.record_goal_games(folder, self.entry([self.row("1", 0.9, 300, 300, 0)]), self.games()), 0)
            saved = json.loads((folder / "2026-10.json").read_text(encoding="utf-8"))
            game = saved["games"]["77"]
            self.assertEqual(saved["cols"], list(build_nhl.GOALS_RECORD_COLS))
            self.assertEqual([p[0] for p in game["plays"]], ["1", "2"])  # the scratch is left out, the unpriced player kept
            self.assertEqual(game["market"], {"total_line": 6.5, "away_ml_implied_prob": 0.45, "home_ml_implied_prob": 0.55})

    def test_the_record(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            rows = [
                self.row("1", 0.32, 300, 350, 1, zone="low_slot"),  # strong, won +3, price shortened 350 -> 300
                self.row("2", 0.29, 300, 250, 0),                   # lean, lost, price drifted 250 -> 300
                self.row("3", 0.20, 300, 300, 0),                   # no edge
                self.row("4", 0.45, 300, 300, 1),                   # check
                self.row("5", 0.10, None, None, 1, zone="slot"),    # no price: graded for honesty and the tag only
            ]
            build_nhl.record_goal_games(folder, self.entry(rows), self.games())
            r = build_nhl.goals_record_summary(folder)
            self.assertEqual((r["games"], r["players"]), (1, 5))
            self.assertEqual(r["strong"], {"wins": 1, "losses": 0, "units": 3.0})
            self.assertEqual(r["lean"], {"wins": 0, "losses": 1, "units": -1.0})
            self.assertEqual((r["none"]["losses"], r["check"]["wins"]), (1, 1))
            self.assertEqual(r["zone"], {"wins": 1, "losses": 0, "units": 3.0})
            self.assertEqual((r["zone_all"]["players"], r["zone_all"]["scored"]), (2, 2))
            # Closing line value on the called plays: +3.8 points (350 -> 300) and -3.6 (250 -> 300).
            self.assertEqual((r["clv"]["plays"], r["clv"]["shortened"], r["clv"]["drifted"]), (2, 1, 1))
            self.assertAlmostEqual(r["clv"]["points"], ((0.25 - 100 / 450) + (0.25 - 100 / 350)) / 2, places=4)
            self.assertEqual(sum(b["players"] for b in r["honest"]), 5)
            self.assertEqual([p["id"] for p in r["plays"]], ["4", "1", "2"])
            # Best Plays' filterable record: every called play (check included), [date, edge, won, units].
            self.assertEqual(r["ledger"], [["2026-10-13", p["edge"], int(p["won"]), p["units"]] for p in r["plays"]])
            self.assertEqual(r["days"], [{"date": "2026-10-13", "wins": 1, "losses": 1, "units": 2.0}])


if __name__ == "__main__":
    unittest.main()
