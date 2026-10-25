"""The NBA game sim (nfl_tool/nba/sim.py) and its part of build_nba.py, the
Points and Threes pages' engine since 2026-10-24.

What is pinned: minutes fit the team's 240 (too many: the small roles give
up the most; too few: everyone up, no one past the cap); a player listed Out
leaves his minutes to everyone in proportion (the replay beat handing them
to his position first); a player in the NBA's starting five plays starter minutes, and
names match across sources with accents; the dials (one schedule, one
last-game, in their order) and their size; a dial costs the tired team
points in the sims; the ladder's chances (a whole-number line's push left
out); Script-Proof / Chaos / Close; the plays (each player's main line only, at
its best price, every one with MIN_EDGE, no cap a night or a game,
the price range, the games and minutes floors); the record (graded at its
price, a push or a player who sat not graded, the split tags); the build
saves the plays until tip and never rewrites a started game; and on the
engine's two real games, the inputs and one sim run end to end."""
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
import build_nba  # noqa: E402
import possessions as P  # noqa: E402
import sim  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
MIX = np.array([60, 20, 20, 30, 30, 20, 15], float)  # rim, short, mid, corner 3, above 3, line trips, turnovers
MADE = np.array([39, 8, 8, 12, 11], float)


def player(name, team, group, mins, start=True, games=None, mix=MIX, made=MADE):
    n = len(mins)
    games = games or list(range(100, 100 + n))
    return {"name": name, "team": team, "group": group, "dates": [f"2026-10-{10 + i:02d}" for i in range(n)], "games": games,
            "min": [float(m) for m in mins], "start": [start] * n, "counts": mix.copy(), "made": made.copy(),
            "ftm": 16.0, "fta": 20.0, "plays": float(mix.sum()), "minutes": float(sum(mins))}


def inputs(players):
    groups = {g: {"mix": MIX / MIX.sum(), "pct": MADE / MIX[:5], "use": 0.45} for g in ("G", "F", "C")}
    teams = {t: {"pace_games": [99.0] * 5, "oreb": [50.0, 200.0], "allowed_oreb": [50.0, 200.0],
                 "allowed": MIX * 5, "allowed_made": MADE * 5} for t in ("AAA", "BBB")}
    history = {t: [{"date": f"2026-10-{10 + i:02d}", "game": 100 + i, "margin": 5, "ot": False} for i in range(5)] for t in ("AAA", "BBB")}
    return {"players": players, "teams": teams, "history": history,
            "league": {"groups": groups, "mix": MIX / MIX.sum(), "pct": MADE / MIX[:5], "ft": 0.78, "oreb": 0.25, "pace": 99.0}}


def roster():
    """Two teams of nine: guards 1-4 / 11-14, forwards 5-7 / 15-17, centers 8-9 / 18-19."""
    ps = {}
    for base, team in ((0, "AAA"), (10, "BBB")):
        for i, (group, mins) in enumerate([("G", 34), ("G", 32), ("G", 24), ("G", 10), ("F", 33), ("F", 30), ("F", 22), ("C", 30), ("C", 18)]):
            ps[base + i + 1] = player(f"P{base + i + 1}", team, group, [mins] * 5, start=i in (0, 1, 4, 5, 7))
    return ps


class Minutes(unittest.TestCase):
    def test_too_many_small_roles_give_up_the_most(self):
        m = sim.fill_minutes(np.array([36.0, 34, 30, 30, 28, 24, 20, 20, 12, 10]))
        self.assertAlmostEqual(m.sum(), 240)
        self.assertGreater(m[0] / 36, m[-1] / 10)  # the star keeps more of his share

    def test_too_few_everyone_up_no_one_past_the_cap(self):
        m = sim.fill_minutes(np.array([38.0, 30, 30, 28, 26, 20, 20]))
        self.assertAlmostEqual(m.sum(), 240)
        self.assertLessEqual(m.max(), sim.MIN_CAP + 1e-9)
        m = sim.fill_minutes(np.array([40.0] * 7))  # everyone capped and still too many
        self.assertAlmostEqual(m.sum(), 240)

    def test_last_five_count_more_than_the_season(self):
        self.assertAlmostEqual(sim.project_minutes([30] * 5), 30)
        dip = sim.project_minutes([34] * 10 + [24] * 5)
        self.assertTrue(24 < dip < 30)


class Rotation(unittest.TestCase):
    def side_minutes(self, out_ids, lineups=None, n=400):
        inp = inputs(roster())
        out = sim.game(inp, "BBB", "AAA", "2026-10-20", out_ids, n=n, seed=1, lineups=lineups)
        st = out["away"]  # AAA
        return {pid: st["min"][:, j].mean() for j, pid in enumerate(st["s"]["pids"])}

    def test_out_minutes_go_to_everyone_in_proportion(self):
        before = self.side_minutes(set())
        after = self.side_minutes({"1"})  # AAA's 34-minute guard
        self.assertNotIn(1, after)
        for pid in (2, 5, 9):
            self.assertGreater(after[pid], before[pid])
        self.assertAlmostEqual(after[2] / before[2], after[9] / before[9], delta=0.08)  # a guard and a center alike
        self.assertAlmostEqual(sum(after.values()), 240, delta=3)

    def test_a_listed_starter_plays_starter_minutes(self):
        five = ["P4", "P2", "P5", "P6", "P8"]  # the 10-minute guard P4 starts for the hurt P1
        day = {"games": [{"homeTeam": {"teamAbbreviation": "BBB", "players": []},
                          "awayTeam": {"teamAbbreviation": "AAA", "players": [{"playerName": n, "firstName": n, "lastName": n, "lineupStatus": "Expected", "rosterStatus": "Active"} for n in five]}}]}
        plain = self.side_minutes({"1"})
        listed = self.side_minutes({"1"}, day)
        self.assertGreater(listed[4], plain[4] + 8)
        self.assertGreaterEqual(listed[4], sim.STARTER_TRUST * 31.8 - 3)  # AAA's starters average 31.8

    def test_a_hurt_starter_not_in_the_posted_five_sits(self):
        # the owner, 2026-10-25: Embiid Questionable, Bona in the posted five, the sim had Embiid 30 minutes off the bench
        five = ["P9", "P2", "P1", "P5", "P6"]  # the 18-minute center P9 starts; the starting center P8 isn't listed
        day = {"games": [{"homeTeam": {"teamAbbreviation": "BBB", "players": []},
                          "awayTeam": {"teamAbbreviation": "AAA", "players": [{"playerName": n, "firstName": n, "lastName": n, "lineupStatus": "Expected", "rosterStatus": "Active"} for n in five]}}]}
        inp = inputs(roster())
        run = sim.game(inp, "BBB", "AAA", "2026-10-20", set(), n=200, seed=1, lineups=day, hurt={"8"})
        self.assertNotIn(8, run["away"]["s"]["pids"])
        self.assertEqual(run["sat"]["away"], [8])
        # healthy and left out of the five: he plays off the bench; hurt with no five posted yet: he plays
        self.assertIn(8, sim.game(inp, "BBB", "AAA", "2026-10-20", set(), n=200, seed=1, lineups=day)["away"]["s"]["pids"])
        self.assertIn(8, sim.game(inp, "BBB", "AAA", "2026-10-20", set(), n=200, seed=1, hurt={"8"})["away"]["s"]["pids"])
        # listed Out: in "sat" too, a bench player on the report still plays
        run = sim.game(inp, "BBB", "AAA", "2026-10-20", {"1"}, n=200, seed=1, lineups=day, hurt={"7"})
        self.assertEqual(sorted(run["sat"]["away"]), [1])
        self.assertEqual(run["sat"]["home"], [])

    def test_names_match_across_sources(self):
        names = {7: "Dennis Schröder", 8: "Jaren Jackson Jr.", 9: "Naz Reid", 10: "Sion James", 11: "Moussa Diabaté"}
        day = {"games": [{"homeTeam": {"teamAbbreviation": "CHA", "players": [
            {"playerName": "Dennis Schr�der", "firstName": "Dennis", "lastName": "Schr�der", "lineupStatus": "Confirmed", "rosterStatus": "Active"},
            {"playerName": "Jaren Jackson Jr", "firstName": "Jaren", "lastName": "Jackson Jr", "lineupStatus": "Confirmed", "rosterStatus": "Active"},
            {"playerName": "Naz Reid", "firstName": "Naz", "lastName": "Reid", "lineupStatus": "Confirmed", "rosterStatus": "Active"},
            {"playerName": "Sion James", "firstName": "Sion", "lastName": "James", "lineupStatus": "Confirmed", "rosterStatus": "Active"},
            {"playerName": "Moussa Diabate", "firstName": "Moussa", "lastName": "Diabate", "lineupStatus": "Confirmed", "rosterStatus": "Active"}]},
            "awayTeam": {"teamAbbreviation": "MIA", "players": []}}]}
        self.assertEqual(sim.lineup_starters(day, "CHA", "CHA", "MIA", names), {7, 8, 9, 10, 11})
        self.assertEqual(sim.lineup_starters(day, "CHA", "CHA", "BOS", names), set())  # not that game
        self.assertEqual(sim.lineup_starters(None, "CHA", "CHA", "MIA", names), set())


class Dials(unittest.TestCase):
    def hist(self, *rows):
        return [{"date": d, "game": i, "margin": m, "ot": ot} for i, (d, m, ot) in enumerate(rows)]

    def test_one_schedule_and_one_last_game_dial_in_order(self):
        rested = self.hist(("2026-10-20", -5, False))
        self.assertEqual(sim.team_dials(self.hist(("2026-10-23", 2, False)), "2026-10-24", rested), ["rest_edge", "close_win"])
        self.assertEqual(sim.team_dials(self.hist(("2026-10-23", 25, False)), "2026-10-24", self.hist(("2026-10-23", 1, False))), ["b2b", "big_win"])
        three = self.hist(("2026-10-19", -3, False), ("2026-10-20", -8, True))  # tonight 10-22: third in four nights, a day's rest
        self.assertEqual(sim.team_dials(three, "2026-10-22", rested), ["3in4", "ot_legs"])
        self.assertEqual(sim.team_dials(self.hist(("2026-10-21", 4, True)), "2026-10-24", rested), ["ot_win"])
        self.assertEqual(sim.team_dials(self.hist(("2026-10-20", -20, False)), "2026-10-24", rested), [])  # bounce-back tested at zero
        self.assertEqual(sim.team_dials([], "2026-10-24", rested), [])

    def test_the_size_is_own_points_plus_the_other_teams_effect(self):
        self.assertAlmostEqual(sim.dial_points(["rest_edge"], []), -0.72)
        self.assertAlmostEqual(sim.dial_points([], ["rest_edge"]), 1.89)  # the rested side scores more
        self.assertAlmostEqual(sim.dial_points(["b2b", "close_win"], ["big_win"]), -0.84 - 0.78 - 0.58)

    def test_a_tired_team_scores_less_in_the_sims(self):
        inp = inputs(roster())
        inp["history"]["AAA"].append({"date": "2026-10-19", "game": 105, "margin": -3, "ot": False})  # AAA last night
        inp["history"]["BBB"] = inp["history"]["BBB"][:3]  # BBB rested
        on = sim.game(inp, "BBB", "AAA", "2026-10-20", set(), n=4000, seed=3)
        off = sim.game(inp, "BBB", "AAA", "2026-10-20", set(), n=4000, seed=3, dials=False)
        self.assertEqual(on["away_dials"], ["rest_edge"])
        self.assertLess(on["margin"].mean() * -1, off["margin"].mean() * -1)  # AAA's margin worse with the dial


class Ladder(unittest.TestCase):
    def test_chances_and_the_push(self):
        values = np.array([0] * 20 + [1] * 30 + [2] * 30 + [3] * 20)
        lad = sim.ladder(values)
        self.assertAlmostEqual(sim.at_least(lad, 1), 0.8)
        self.assertAlmostEqual(sim.at_least(lad, 3), 0.2)
        self.assertEqual(sim.at_least(lad, 9), 0.0)
        self.assertAlmostEqual(sim.chance_over(lad, 1.5), 0.5)
        self.assertAlmostEqual(sim.chance_over(lad, 2), 0.2 / 0.7)  # a 2 is a push, left out
        self.assertAlmostEqual(sim.side_chance(lad, "u", 1.5), 0.5)

    def test_script_kinds(self):
        self.assertEqual(sim.kind_of({"away": 0.6, "close": 0.55, "home": 0.6}, 0.5), "proof")
        self.assertEqual(sim.kind_of({"away": 0.6, "close": 0.4, "home": 0.3}, 0.5), "chaos")
        self.assertEqual(sim.kind_of({"away": 0.4, "close": 0.6, "home": 0.3}, 0.5), "close")
        self.assertEqual(sim.kind_of({"away": None, "close": 0.6, "home": None}, 0.5), "proof")
        self.assertIsNone(sim.kind_of({"away": 0.4, "close": 0.4, "home": 0.4}, 0.5))


def game_row(pts, minutes=30):
    """One player's sim row with a ladder from a points list."""
    lad = sim.ladder(np.array(pts))
    return {"team": "home", "min": minutes, "name": "P", "pts": {"med": {"all": float(np.median(pts))}, "lad": {k: lad for k in ("all", "away", "close", "home")}},
            "fg3m": {"med": {"all": 1.0}, "lad": {}}}


class Plays(unittest.TestCase):
    def test_the_main_line_only_at_its_best_price(self):
        pts = [10] * 30 + [20] * 40 + [30] * 30  # 70% for 15.5+, 30% for 25.5+
        sim_game = {"players": {"1": game_row(pts), "2": game_row(pts), "3": game_row(pts, minutes=12)}, "dials": {"home": ["b2b"], "away": []}}
        # SmartStake's quotes carry a fifth field, the bet link
        props = {"points": {"1": {"q": [["dk", "o", 15.5, -110, ""], ["fd", "o", 15.5, -105, "https://fd"], ["dk", "u", 15.5, -110, ""]]},
                            "2": {"q": [["dk", "o", 15.5, -200]]},
                            "3": {"q": [["dk", "o", 15.5, 300]]}},  # 12 minutes: never a play
                 # a rung is never the play (2026-10-25): 2's 25.5 at +300 has +5 of edge, 1's +600 more than his main line
                 "points_alt": {"1": {"q": [["dk", "o", 25.5, 600]]}, "2": {"q": [["dk", "o", 25.5, 300]]}}}
        g = {"date": "2026-10-24", "home": "BBB", "away": "AAA"}
        cands = sim.game_candidates("9", g, sim_game, props, {"1": 5, "2": 5, "3": 5}, "points")
        self.assertEqual([c["pid"] for c in cands], ["1"])  # 2: -200 needs 66.7% (70%: +3.3, under the minimum)
        c = cands[0]
        # his main line's better side: 70% at FanDuel's -105 (needs 51.2%)
        self.assertEqual((c["side"], c["line"], c["price"], c["book"], c["main"]), ("o", 15.5, -105, "fd", True))
        self.assertAlmostEqual(c["edge"], 0.7 - 105 / 205, places=3)
        self.assertEqual(c["kind"], "proof")
        self.assertEqual((c["team"], c["opp"], c["dials"]), ("BBB", "AAA", ["b2b"]))
        self.assertEqual(sim.game_candidates("9", g, sim_game, props, {"1": 1}, "points"), [])  # one game isn't enough

    def test_every_play_with_its_edge_no_cap(self):
        # the owner, 2026-10-25: "Why only 8 plays?! display everything with its edge just like hockey is"
        cands = [{"game": str(i % 2), "edge": 0.04 + i / 100, "pid": str(i)} for i in range(12)]
        picked = sim.pick_plays(cands, [])
        self.assertEqual(len(picked), 12)  # several in one game, more than 8 a night
        self.assertEqual([p["pid"] for p in picked[:2]], ["11", "10"])
        self.assertEqual([p["tier"] for p in picked].count("top"), 1)
        self.assertEqual(picked[0]["tier"], "top")
        locked = [{"game": "5", "tier": "top"}]  # the Top Play already locked at tip tonight
        picked = sim.pick_plays(cands, locked)
        self.assertEqual(len(picked), 12)
        self.assertEqual(picked[0]["tier"], "strong")


class Record(unittest.TestCase):
    def test_graded_at_its_price_with_the_split_tags(self):
        row = lambda pid, side, line, price, tier, kind, main, dials: [pid, side, line, price, "dk", 0.5, 0.06, tier, kind, main, dials]  # noqa: E731
        record = {"9": {"date": "2026-10-24", "points": [row("1", "o", 25.5, 300, "top", "chaos", False, ["b2b"]),
                                                         row("2", "u", 14.5, -110, "strong", "proof", True, []),
                                                         row("3", "o", 20.0, -110, "strong", None, True, []),  # a push
                                                         row("4", "o", 10.5, -110, "strong", None, True, [])]}}  # sat
        logs = {("9", "1"): 27, ("9", "2"): 16, ("9", "3"): 20}
        self.assertEqual(sim.ledger(record, logs, "points"), [
            ["2026-10-24", 0.06, 1, 3.0, ["top", "over", "alt", "chaos", "dials"]],
            ["2026-10-24", 0.06, 0, -1.0, ["strong", "under", "main", "proof"]],
        ])
        self.assertEqual(sim.ledger(record, logs, "threes"), [])


class LastSeasonStart(unittest.TestCase):
    """2026-10-25: a player starts from his own last season, not his position's
    average (opening week read Zion as an average forward: threes overs)."""

    def test_a_non_shooter_keeps_his_own_shot_mix(self):
        lg = {"ft": 0.78, "groups": {"F": {"mix": np.array([0.3, 0.15, 0.1, 0.1, 0.25, 0.05, 0.05]),
                                           "pct": np.array([0.65, 0.45, 0.42, 0.38, 0.36]), "use": 0.5}}}
        # last season: 2,000 minutes, 1,000 plays, two threes
        last = ["F", 2000.0, [600, 150, 50, 1, 1, 150, 48], [400, 60, 20, 0, 0], 220, 300]
        mix, k_mix, *_rest, use, k_use = sim.starting_point(lg, "F", last)
        self.assertLess(mix[3] + mix[4], 0.02)  # his threes, not the 35% an average forward takes
        self.assertEqual((k_mix, k_use), (sim.K_PRIOR_MIX, sim.K_PRIOR_USE))
        self.assertAlmostEqual(use, (1000 + sim.K_USE * 0.5) / (2000 + sim.K_USE))
        rookie = sim.starting_point(lg, "F", None)
        self.assertAlmostEqual(rookie[0][4], 0.25)  # no last season: the position's numbers
        self.assertEqual(rookie[1], sim.K_MIX)


class PastPlays(unittest.TestCase):
    def test_past_nights_graded_for_the_day_arrows(self):
        row = lambda pid, side, line: [pid, side, line, 150, "dk", 0.5, 0.06, "strong", None, True, []]  # noqa: E731
        record = {"9": {"date": "2026-10-24", "points": [row("1", "o", 20.5), row("2", "o", 9.5), row("3", "u", 10.0), row("4", "o", 5.5)]},
                  "10": {"date": "2026-10-24", "points": [row("5", "o", 12.5)]},  # no box score yet
                  "11": {"date": "2026-10-25", "points": [row("1", "o", 30.5)]}}  # tonight: not past
        logs = {("9", "1"): 25, ("9", "2"): 8, ("9", "3"): 10}
        block = {"fields": ["date", "game", "opp", "home"], "players": {"1": {"team": "AAA", "log": [["2026-10-24", "9", "BBB", 0]]}}}
        out = build_nba.past_plays(record, logs, "points", "2026-10-25", block)
        self.assertEqual([(p["pid"], p["result"], p["got"]) for p in out],
                         [("1", "won", 25), ("2", "lost", 8), ("3", "push", 10), ("4", "sat", None), ("5", None, None)])
        self.assertEqual((out[0]["team"], out[0]["opp"], out[0]["home"], out[0]["price"]), ("AAA", "BBB", False, 150))


class Build(unittest.TestCase):
    def test_plays_are_saved_until_tip_and_never_after(self):
        inp = inputs(roster())
        games = [{"game_id": "77", "date": "2026-10-20", "time": "19:00", "away": "AAA", "home": "BBB", "start_utc": "2026-10-20T23:00Z"}]

        def odds(price):
            return {"AAA_BBB": {"props": {"points": {"1": {"q": [["dk", "o", 9.5, price, ""], ["dk", "u", 9.5, -110, ""]]}}}}}
        with tempfile.TemporaryDirectory() as tmp:
            real = build_nba.PROPS_RECORD_DIR
            build_nba.PROPS_RECORD_DIR = Path(tmp)
            try:
                before = build_nba.compute_sim(2027, inp, None, odds(300), games, {}, {}, datetime(2026, 10, 20, 15, 0))
                saved = json.loads((Path(tmp) / "sim_2027.json").read_text())
                self.assertEqual(saved["77"]["points"][0][:4], ["1", "o", 9.5, 300])
                self.assertEqual(before["sim_plays"]["points"][0]["tier"], "top")
                self.assertIn("77", before["sim"])
                self.assertEqual(set(before["sim"]["77"]["scripts"]), {"away", "close", "home"})
                after = build_nba.compute_sim(2027, inp, None, odds(-300), games, {}, {}, datetime(2026, 10, 20, 23, 30))
                self.assertEqual(json.loads((Path(tmp) / "sim_2027.json").read_text()), saved)  # never rewritten after tip
                locked = after["sim_plays"]["points"][0]
                self.assertTrue(locked["locked"])
                self.assertEqual((locked["price"], locked["tier"]), (300, "top"))
            finally:
                build_nba.PROPS_RECORD_DIR = real


class RealGames(unittest.TestCase):
    """The engine's two saved real games, start to finish."""

    @classmethod
    def setUpClass(cls):
        box = pd.read_csv(FIX / "nba_box_games.csv.gz")
        # the saved sample keeps only what the engine reads: add the rest of a box score
        box["game_date"] = box["game_id"].map({g: f"2026-01-{5 + i:02d}" for i, g in enumerate(sorted(box["game_id"].unique()))})
        box["team_abbreviation"] = "T" + box["team_id"].astype(str)
        box["athlete_position_abbreviation"] = "G"
        box["starter"] = box.groupby(["game_id", "team_id"])["minutes"].rank(ascending=False, method="first") <= 5
        scores = box.drop_duplicates(["game_id", "team_id"]).set_index(["game_id", "team_id"])["team_score"]
        box["opponent_team_score"] = [next(v for (g, t), v in scores.items() if g == gid and t != tid) for gid, tid in zip(box["game_id"], box["team_id"])]
        cls.inputs = sim.season_inputs(P.Season(pd.read_csv(FIX / "nba_pbp_games.csv.gz"), box), box)
        cls.teams = sorted(cls.inputs["teams"])

    def test_inputs(self):
        lg = self.inputs["league"]
        self.assertTrue(0.15 < lg["oreb"] < 0.4)
        self.assertTrue(85 < lg["pace"] < 115)
        p = max(self.inputs["players"].values(), key=lambda x: x["plays"])
        self.assertGreater(p["counts"][:5].sum(), 5)
        self.assertTrue(all(len(h) >= 1 for h in self.inputs["history"].values()))

    def test_one_game(self):
        home, away = self.teams[0], self.teams[1]
        out = sim.game(self.inputs, home, away, "2030-01-01", set(), n=500, seed=2)
        for k in ("home", "away"):
            self.assertAlmostEqual(out[k]["min"].sum(axis=1).mean(), 240, delta=8)  # a little more with overtime
            self.assertTrue(70 < out[k]["pts"].sum(axis=1).mean() < 160)
        s = sim.summary(out, {})
        self.assertAlmostEqual(sum(s["scripts"].values()), 1.0, places=2)
        row = next(iter(s["players"].values()))
        self.assertIn("all", row["pts"]["lad"])


if __name__ == "__main__":
    unittest.main()
