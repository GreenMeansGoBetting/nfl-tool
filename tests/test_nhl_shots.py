"""The NHL shots-on-goal model (nfl_tool/nhl/shots_model.py) and the Shots
page's half of the build (build_nhl.py), on saved and hand-made games.

What is pinned: the chance of clearing a line (a count a little streakier
than pure chance, whose chances still add up to the projection); what a
defense "allows" is what the other offense did; a projection is his usual
times each matchup piece; THIS SEASON ONLY (the build never hands the model
last season); small samples are pulled toward an average skater with his ice
time, a night he left early doesn't change his minutes; the board (who is
projected, the same lock as the odds, real shots on a finished game) and the
record (a game is written once, plays graded at the locked price, plays
against his own average kept apart)."""
import json
import math
import tempfile
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl
import shots_model

BENSON = "8484145"  # Zach Benson, BUF forward, in the saved game (FLA @ BUF)


def skater(team, pos="C", toi=1080, sog=2, att=4, pp_unb=0, areas=None):
    """One skater's line the way reduce_game writes it (18 minutes, 2 shots on goal by default)."""
    areas = areas or {"slot": [sog, sog, 0]}
    return {"team": team, "pos": pos, "toi": toi, "sog": sog, "att": att, "unb": sum(a[0] for a in areas.values()), "pp_unb": pp_unb, "areas": areas}


def game(date, home, away, skaters, game_id=1):
    """A finished game made of skater lines; each team's totals are its skaters' sums."""
    teams = {home: Counter(), away: Counter()}
    for line in skaters.values():
        teams[line["team"]].update(sog=line["sog"], att=line["att"], unb_pp=line["pp_unb"])
    return {"id": game_id, "date": date, "home": home, "away": away, "teams": {t: dict(c) for t, c in teams.items()}, "skaters": skaters}


class Chances(unittest.TestCase):
    def test_pure_chance_matches_the_textbook(self):
        self.assertAlmostEqual(shots_model.chance_at_least(2.0, 1, 0), 1 - math.exp(-2))
        self.assertAlmostEqual(shots_model.chance_at_least(2.5, 3, 0), 1 - math.exp(-2.5) * (1 + 2.5 + 2.5 ** 2 / 2))

    def test_shots_are_a_little_streakier_than_pure_chance(self):
        """Same projection, wider spread: the middle line is cleared a bit less often, a big night a bit more."""
        self.assertEqual(shots_model.DISPERSION, 0.07)
        self.assertAlmostEqual(shots_model.chance_at_least(3, 3, 0), 0.5768, places=4)
        self.assertAlmostEqual(shots_model.chance_at_least(3, 3), 0.5556, places=4)
        self.assertGreater(shots_model.chance_at_least(3, 6), shots_model.chance_at_least(3, 6, 0))

    def test_the_chances_add_up_to_the_projection(self):
        for mean in (0.6, 1.4, 2.7, 4.2):
            self.assertAlmostEqual(sum(shots_model.chance_at_least(mean, n) for n in range(1, 80)), mean, places=6)

    def test_over_a_half_line_is_the_next_whole_number(self):
        self.assertEqual(shots_model.chance_over(2.2, 2.5), shots_model.chance_at_least(2.2, 3))
        self.assertEqual(shots_model.chance_over(2.2, 0.5), shots_model.chance_at_least(2.2, 1))

    def test_the_ladder_only_falls(self):
        ladder = [shots_model.chance_at_least(2.4, n) for n in range(0, 9)]
        self.assertEqual(ladder[0], 1.0)
        self.assertTrue(all(0 < b < a <= 1 for a, b in zip(ladder, ladder[1:])))
        self.assertEqual(shots_model.chance_at_least(0, 1), 0.0)

    def test_fair_price(self):
        self.assertEqual([shots_model.fair_american(p) for p in (0.6, 0.4, 0.5, 0.75, 0.2)], [-150, 150, -100, -300, 400])
        self.assertIsNone(shots_model.fair_american(0))
        self.assertIsNone(shots_model.fair_american(1))


class WhatADefenseAllows(unittest.TestCase):
    """The saved game: FLA @ BUF (BUF 32 shots on goal, FLA 23)."""

    @classmethod
    def setUpClass(cls):
        cls.game = build_nhl.reduce_game(helpers.nhl_game())

    def test_it_is_what_the_other_offense_did(self):
        buf, fla = shots_model.allowed_in(self.game, "BUF"), shots_model.allowed_in(self.game, "FLA")
        self.assertEqual((buf["sog"], buf["att"], fla["sog"], fla["att"]), (23, 63, 32, 49))
        # Forwards and defensemen split the same shots on goal.
        self.assertEqual((buf["f_sog"], buf["d_sog"]), (14, 9))
        self.assertEqual((fla["f_sog"], fla["d_sog"]), (17, 15))
        # Power-play shots allowed are the other team's shots a man up.
        self.assertEqual((buf["pp_unb"], fla["pp_unb"]), (self.game["teams"]["FLA"]["unb_pp"], self.game["teams"]["BUF"]["unb_pp"]))
        self.assertEqual((buf["pp_unb"], fla["pp_unb"]), (14, 8))
        # By area: what FLA's skaters took (the same placed shots the rink shows).
        self.assertEqual({a: buf[f"a_{a}"] for a in build_nhl.AREAS}, {a: self.game["teams"]["FLA"].get(f"a_{a}", 0) for a in build_nhl.AREAS})
        self.assertEqual(buf["located"], 46)

    def test_a_season_boiled_down(self):
        summary = shots_model.season_summary([self.game])
        self.assertEqual(summary["players"][BENSON], {"pos": "L", "games": 1, "toi": 1180, "sog": 2, "att": 3, "unb": 3, "pp_unb": 1, "areas": {"low_slot": 2, "left": 1}})
        self.assertEqual(summary["teams"]["BUF"]["sog"], 23)
        self.assertEqual((summary["league"]["F_sog"], summary["league"]["D_sog"]), (31, 24))
        self.assertEqual((summary["league"]["F_games"], summary["league"]["D_games"]), (24, 12))


class Projection(unittest.TestCase):
    """Hand-made games: AAA's shooter "p" against BBB and CCC."""

    def league(self, n=30):
        """A league to compare with: n games in which every team allows the same 4 shots on goal."""
        records = []
        for i in range(n):
            lines = {f"x{i}": skater("XXX"), f"y{i}": skater("YYY"), f"xd{i}": skater("XXX", "D"), f"yd{i}": skater("YYY", "D")}
            records.append(game(f"2026-01-{i + 1:02d}", "XXX", "YYY", lines, 100 + i))
        return records

    def model(self, extra=(), prior=None, **params):
        model = shots_model.ShotsModel(prior, params or None)
        for record in [*self.league(), *extra]:
            model.add_game(record)
        return model

    def test_someone_the_model_has_never_seen(self):
        self.assertIsNone(self.model().project("nobody", "XXX", True))

    def test_a_projection_is_his_usual_times_each_piece(self):
        model = self.model([game("2026-02-01", "AAA", "BBB", {"p": skater("AAA", sog=4, att=7), "q": skater("BBB")}, 1)])
        proj = model.project("p", "XXX", home=True, rest=1, opp_rest=1)
        lift = proj["lift"]
        self.assertAlmostEqual(lift["home"], math.exp(0.03))
        self.assertAlmostEqual(lift["b2b"], math.exp(-0.035))
        self.assertAlmostEqual(lift["opp_b2b"], math.exp(0.035))
        product = math.exp(shots_model.WEIGHTS["scale"])
        for value in lift.values():
            product *= value
        self.assertAlmostEqual(proj["mean"], proj["base"] * product)
        self.assertAlmostEqual(proj["base"], proj["rate"]["per_min"] * proj["minutes"])
        rested = model.project("p", "XXX", home=False, rest=2, opp_rest=3)["lift"]
        self.assertEqual((rested["home"], rested["b2b"], rested["opp_b2b"]), (1.0, 1.0, 1.0))

    def test_a_defense_that_allows_more_lifts_the_projection(self):
        # BBB gives up 12 shots on goal a game where the league gives up 4.
        leaky = [game(f"2026-02-{d:02d}", "AAA", "BBB", {"p": skater("AAA", sog=12, att=24), "q": skater("BBB")}, d) for d in range(1, 6)]
        model = self.model(leaky)
        allowed = model.allowed("BBB", "sog")
        self.assertEqual((allowed["season"], allowed["league"] < 5), (12.0, True))
        # Five games are blended with 20 of a league-average defense: well short of 12, well above 4.
        self.assertTrue(4.5 < allowed["blend"] < 7, allowed["blend"])
        against_leaky, against_average = model.project("p", "BBB", True), model.project("p", "XXX", True)
        self.assertGreater(against_leaky["lift"]["opp"], 1.2)
        self.assertAlmostEqual(against_average["lift"]["opp"], against_average["opp"]["factor"])
        self.assertGreater(against_leaky["mean"], against_average["mean"])
        # A team with no games at all is the league's average.
        self.assertAlmostEqual(model.allowed("NEW", "sog")["factor"], 1.0)

    def test_position_is_only_what_the_overall_number_does_not_say(self):
        # CCC's shots against all go to defensemen: 8 of them a game, none to forwards.
        lines = lambda d: {"p": skater("AAA", "D", sog=8, att=12, areas={"point": [8, 8, 0]}), "f": skater("AAA", "C", sog=0, att=1, areas={"slot": [1, 0, 0]}), "q": skater("CCC")}
        model = self.model([game(f"2026-02-{d:02d}", "AAA", "CCC", lines(d), d) for d in range(1, 9)])
        self.assertGreater(model.project("p", "CCC", True)["lift"]["pos"], 1.05)
        self.assertLess(model.project("f", "CCC", True)["lift"]["pos"], 0.95)

    def test_where_he_shoots_against_where_the_defense_gives_shots_up(self):
        # CCC gives up point shots; "pt" shoots from the point, "sl" from the slot.
        lines = lambda d: {
            "pt": skater("AAA", "D", sog=6, att=10, areas={"point": [8, 6, 0]}), "sl": skater("AAA", "C", sog=1, att=2, areas={"slot": [1, 1, 0]}), "q": skater("CCC"),
        }
        model = self.model([game(f"2026-02-{d:02d}", "AAA", "CCC", lines(d), d) for d in range(1, 9)])
        self.assertGreater(model.project("pt", "CCC", True)["lift"]["area"], 1.0)
        self.assertLess(model.project("sl", "CCC", True)["lift"]["area"], 1.0)
        self.assertAlmostEqual(sum(model.project("pt", "CCC", True)["shares"].values()), 1.0)

    def test_one_big_night_is_pulled_toward_the_league(self):
        model = self.model([game("2026-02-01", "AAA", "BBB", {"p": skater("AAA", sog=7, att=11, areas={"slot": [9, 7, 0]}), "q": skater("BBB")}, 1)])
        proj = model.project("p", "XXX", False)
        # The league's forwards get 2 shots on goal in these 18 minutes; one 7-shot game moves him some of the way, not to 7.
        self.assertTrue(2.0 < proj["mean"] < 3.6, proj["mean"])

    def test_a_small_sample_is_measured_against_skaters_with_his_ice_time(self):
        """Two forwards with the same shot rate over two games, one playing 24 minutes and one 12
        (the league's forwards play 18): the big-minute forward is mixed with a busier "average skater"."""
        lines = lambda: {"top": skater("AAA", toi=1440, sog=4, att=8), "depth": skater("AAA", toi=720, sog=2, att=4), "q": skater("BBB")}
        model = self.model([game(f"2026-02-0{d}", "AAA", "BBB", lines(), d) for d in (1, 2)])
        top, depth = model.project("top", "XXX", False), model.project("depth", "XXX", False)
        self.assertAlmostEqual(model.role("F", 24.0), 24 / 18, places=1)
        self.assertGreater(top["rate"]["per_min"], depth["rate"]["per_min"] * 1.15)
        # With no ice-time scaling both would be mixed with the same average forward.
        flat = self.model([game(f"2026-02-0{d}", "AAA", "BBB", lines(), d) for d in (1, 2)], role_power=0.0)
        self.assertLess(flat.project("top", "XXX", False)["rate"]["per_min"], top["rate"]["per_min"])

    def test_the_replay_can_still_start_from_a_season_before(self):
        """Only the replay hands the model a `prior` (to measure what this-season-only costs)."""
        cold = game("2025-12-01", "AAA", "BBB", {"p": skater("AAA", sog=1, att=2), "q": skater("BBB")}, 1)
        prior = shots_model.season_summary([cold] * 20)
        hot = [game(f"2026-02-{d:02d}", "AAA", "BBB", {"p": skater("AAA", sog=5, att=9), "q": skater("BBB")}, d) for d in range(1, 21)]
        proj = self.model(hot, prior).project("p", "XXX", False)
        # 20 games at 1 last season, 20 at 5 this season: closer to 5 than to the middle.
        self.assertGreater(proj["rate"]["direct"] * 18, 3.2)
        self.assertEqual((proj["games"], proj["prev_games"]), (20, 20))

    def test_the_site_never_gives_the_model_last_season(self):
        """The owner's rule: this season's games only. A player who hasn't played yet this
        season has no projection, whatever he did the year before."""
        last = game("2025-12-01", "AAA", "BBB", {"p": skater("AAA", sog=3, att=6), "q": skater("BBB")}, 1)
        this = game("2026-10-10", "CCC", "DDD", {"c": skater("CCC"), "d": skater("DDD")}, 2)
        model = build_nhl.shots_model_for([this])
        self.assertEqual((model.prior_players, model.prior_teams), ({}, {}))
        self.assertIsNone(model.project("p", "CCC", True))
        self.assertIsNotNone(model.project("c", "DDD", True))
        self.assertIsNone(model.allowed("DDD", "sog")["prev"])
        # (Handed the season before, as only the replay does, he would have one.)
        proj = self.model([], shots_model.season_summary([last] * 30)).project("p", "XXX", True)
        self.assertEqual((proj["games"], proj["prev_games"]), (0, 30))

    def test_a_night_he_left_early_does_not_change_his_minutes(self):
        usual = [game(f"2026-02-{d:02d}", "AAA", "BBB", {"p": skater("AAA", toi=1200), "q": skater("BBB")}, d) for d in range(1, 6)]
        hurt = game("2026-02-10", "AAA", "BBB", {"p": skater("AAA", toi=300, sog=0, att=0, areas={"slot": [0, 0, 0]}), "q": skater("BBB")}, 10)
        demoted = game("2026-02-10", "AAA", "BBB", {"p": skater("AAA", toi=900), "q": skater("BBB")}, 10)
        self.assertAlmostEqual(self.model(usual).project("p", "XXX", True)["minutes"], 20.0)
        self.assertAlmostEqual(self.model([*usual, hurt]).project("p", "XXX", True)["minutes"], 20.0)
        # A real cut in ice time (15 minutes, not 5) does move it, most of all the latest game.
        self.assertTrue(18.0 < self.model([*usual, demoted]).project("p", "XXX", True)["minutes"] < 19.0)

    def test_power_play_shooters_gain_against_a_team_that_gives_up_power_play_shots(self):
        lines = lambda d: {"pp": skater("AAA", sog=4, att=6, pp_unb=4, areas={"slot": [4, 4, 0]}), "ev": skater("AAA", sog=4, att=6, areas={"slot": [4, 4, 0]}), "q": skater("CCC")}
        model = self.model([game(f"2026-02-{d:02d}", "AAA", "CCC", lines(d), d) for d in range(1, 9)])
        self.assertGreater(model.project("pp", "CCC", True)["lift"]["pp"], model.project("ev", "CCC", True)["lift"]["pp"])
        self.assertGreater(model.project("pp", "CCC", True)["pp_share"], 0.4)


class Board(unittest.TestCase):
    """build_nhl.shots_board with the saved game as the season so far."""

    NOW = datetime(2026, 10, 13, 14, 0)

    @classmethod
    def setUpClass(cls):
        cls.record = build_nhl.reduce_game(helpers.nhl_game())
        cls.model = build_nhl.shots_model_for([cls.record])
        cls.lineups = build_nhl.lineup(build_nhl.compute_skaters([cls.record], {}), Counter(BUF=1, FLA=1))

    def schedule(self, **changes):
        return [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 1, "home_rest": 1, **changes}]

    def board(self, games=None, injuries=None, records=(), previous=None, now=None):
        return build_nhl.shots_board(self.model, games or self.schedule(), self.lineups, injuries or {}, list(records), previous, now or self.NOW)

    def test_every_skater_in_both_lineups(self):
        entry = self.board()["77"]
        rows = entry["players"]
        self.assertFalse(entry["locked"])
        self.assertEqual(Counter(r["team"] for r in rows), Counter(BUF=18, FLA=18))
        self.assertEqual([r["mean"] for r in rows], sorted((r["mean"] for r in rows), reverse=True))
        benson = next(r for r in rows if r["id"] == BENSON)
        self.assertEqual((benson["name"], benson["opp"], benson["home"], benson["out"]), ("Zach Benson", "FLA", False, False))
        # What his game log says: one game, two shots on goal.
        self.assertEqual((benson["games"], benson["avg"]), (1, 2.0))
        # Both teams played yesterday: his own tired legs and the other team's cancel out.
        self.assertEqual((benson["lift"]["home"], benson["lift"]["b2b"], benson["lift"]["opp_b2b"]), (1.0, 0.966, 1.036))
        self.assertAlmostEqual(benson["mean"], benson["usual"] * benson["matchup"], delta=0.011)
        self.assertEqual(len(benson["chances"]), build_nhl.SHOTS_LADDER)
        # The third rung is "3 or more": the chance of going over 2.5.
        self.assertAlmostEqual(benson["chances"][2], shots_model.chance_over(benson["mean"], 2.5), delta=0.002)
        self.assertTrue(all(b < a for a, b in zip(benson["chances"], benson["chances"][1:])))
        json.dumps(entry)

    def test_an_injured_player_is_marked_out(self):
        day_to_day = next(p["id"] for p in self.lineups["BUF"] if p["id"] != BENSON)
        rows = self.board(injuries={"BUF": [{"id": BENSON, "status": "Out"}, {"id": day_to_day, "status": "Day-To-Day"}]})["77"]["players"]
        self.assertEqual({r["id"] for r in rows if r["out"]}, {BENSON})

    def test_only_the_next_two_days_are_projected(self):
        self.assertIn("77", self.board(self.schedule(date="2026-10-15", start_utc="2026-10-15T23:00Z")))
        self.assertEqual(self.board(self.schedule(date="2026-10-16", start_utc="2026-10-16T23:00Z")), {})

    def test_a_game_that_has_started_keeps_the_last_builds_numbers(self):
        """The same lock as the odds: a projection made after puck drop is never shown."""
        before = self.board()
        kept = json.loads(json.dumps(before))
        kept["77"]["players"][0]["mean"] = 9.99  # so a re-projection would be noticed
        after = self.board(previous={"games": kept}, now=datetime(2026, 10, 13, 23, 30))
        self.assertTrue(after["77"]["locked"])
        self.assertEqual(after["77"]["players"][0]["mean"], 9.99)
        self.assertNotIn("final", after["77"])
        # Nothing saved from before puck drop: no projection at all, rather than a late one.
        self.assertEqual(self.board(now=datetime(2026, 10, 13, 23, 30)), {})
        self.assertEqual(self.board(self.schedule(status="final")), {})

    def test_a_finished_game_gets_each_players_real_shots(self):
        final = {**self.record, "id": 77}
        entry = self.board(self.schedule(status="final"), records=[final], previous={"games": self.board()})["77"]
        self.assertEqual((entry["locked"], entry["final"]), (True, True))
        actual = {r["id"]: r["actual"] for r in entry["players"]}
        self.assertEqual(actual[BENSON], 2)
        self.assertEqual(sum(actual.values()), 32 + 23)
        # Someone who didn't dress has no number (his plays are void).
        scratched = {**final, "skaters": {k: v for k, v in final["skaters"].items() if k != BENSON}}
        entry = self.board(self.schedule(status="final"), records=[scratched], previous={"games": self.board()})["77"]
        self.assertIsNone(next(r for r in entry["players"] if r["id"] == BENSON)["actual"])

    def test_defense_numbers_rank_who_allows_the_most(self):
        defense = build_nhl.shots_defense(self.model, ["BUF", "FLA"])
        self.assertEqual((defense["FLA"]["sog"]["season"], defense["FLA"]["sog"]["rank"], defense["FLA"]["sog"]["season_rank"]), (32.0, 1, 1))
        self.assertEqual((defense["BUF"]["sog"]["season"], defense["BUF"]["sog"]["rank"], defense["BUF"]["sog"]["season_rank"]), (23.0, 2, 2))
        self.assertEqual(set(defense["BUF"]["sog"]), {"season", "blend", "league", "factor", "rank", "season_rank", "games"})  # nothing from last season
        self.assertEqual(set(defense["BUF"]), {"sog", "f_sog", "d_sog", "pp_unb", *(f"a_{a}" for a in build_nhl.AREAS)})


class Record(unittest.TestCase):
    def test_the_play_is_the_side_with_the_bigger_edge(self):
        over = build_nhl.shots_play(0.6, 2.5, -120, 100)
        self.assertEqual((over["side"], over["price"], over["chance"]), ("over", -120, 0.6))
        self.assertAlmostEqual(over["edge"], 0.6 - 120 / 220)
        under = build_nhl.shots_play(0.4, 2.5, 100, -110)
        self.assertEqual((under["side"], under["price"]), ("under", -110))
        self.assertAlmostEqual(under["edge"], 0.6 - 110 / 210)
        # One side priced: that side, even at a bad price. Neither: no play.
        self.assertEqual(build_nhl.shots_play(0.3, 1.5, 150, None)["side"], "over")
        self.assertIsNone(build_nhl.shots_play(0.3, 1.5, None, None))

    def test_a_play_against_his_own_average_is_marked(self):
        """An under on a line he averages more than (or an over on one he averages less than)."""
        fade = lambda chance, over, under, avg: build_nhl.shots_play(chance, 1.5, over, under, avg)["fade"]
        self.assertTrue(fade(0.40, -122, 102, 1.8))    # under 1.5 for a player averaging 1.8
        self.assertFalse(fade(0.40, -122, 102, 1.2))   # under 1.5 for a player averaging 1.2
        self.assertTrue(fade(0.65, -110, -110, 1.0))   # over 1.5 for a player averaging 1.0
        self.assertFalse(fade(0.65, -110, -110, 2.4))
        self.assertFalse(fade(0.40, -122, 102, None))  # no games yet: nothing to go against
        self.assertEqual((build_nhl.break_even(-150), build_nhl.break_even(150), build_nhl.break_even(100)), (0.6, 0.4, 0.5))

    def row(self, pid, mean, actual, avg=None):
        return {"id": pid, "name": pid.upper(), "team": "AAA", "mean": mean, "avg": avg, "chances": [round(shots_model.chance_at_least(mean, n), 3) for n in range(1, 9)], "actual": actual}

    def test_a_finished_game_is_written_once(self):
        games = [{"game_id": "9", "date": "2026-10-13", "away": "AAA", "home": "BBB"}, {"game_id": "10", "date": "2026-10-13", "away": "CCC", "home": "DDD"}]
        board = {
            "9": {"final": True, "players": [self.row("a", 2.8, 4, 3.2), self.row("b", 1.9, 1, 2.5), self.row("noline", 1.0, 0), self.row("scratched", 2.0, None)]},
            "10": {"locked": True, "players": [self.row("c", 2.0, None)]},  # started, not final yet
        }
        odds = {"9": {"a": {"sog": {"line": 2.5, "over": -120, "under": 100}}, "b": {"sog": {"line": 1.5, "over": -140, "under": 115}}, "scratched": {"sog": {"line": 1.5, "over": 100, "under": -120}}, "noline": {"goal": {"odds": 300}}}}
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "nhl_shots"
            self.assertEqual(build_nhl.record_finished_games(folder, board, odds, games), 1)
            saved = json.loads((folder / "2026-10.json").read_text())
            self.assertEqual(list(saved["games"]), ["9"])
            self.assertEqual(saved["games"]["9"]["plays"], [
                # ... the projection, the model's chance of the over, his real shots, his season average at the lock
                ["a", "A", "AAA", 2.5, -120, 100, 2.8, round(shots_model.chance_at_least(2.8, 3), 3), 4, 3.2],
                ["b", "B", "AAA", 1.5, -140, 115, 1.9, round(shots_model.chance_at_least(1.9, 2), 3), 1, 2.5],
            ])
            # The next build sees the same finished game: nothing is added or rewritten.
            board["9"]["players"][0]["mean"] = 9.9
            self.assertEqual(build_nhl.record_finished_games(folder, board, odds, games), 0)
            self.assertEqual(json.loads((folder / "2026-10.json").read_text()), saved)

    def test_the_record_by_edge_size(self):
        plays = [
            # id, name, team, line, over, under, projection, model's chance of the over, real shots, his season average
            ["a", "A", "AAA", 2.5, -120, 100, 3.4, 0.70, 3, 3.6],   # over, edge 15.5: "check"; won
            ["b", "B", "AAA", 2.5, -120, 100, 2.9, 0.62, 2, 3.0],   # over, edge 7.5: strong; lost; with his average
            ["c", "C", "AAA", 2.5, 100, -110, 2.0, 0.40, 1, 2.8],   # under, edge 7.6: strong; won; AGAINST his average
            ["d", "D", "AAA", 2.5, -118, 100, 2.7, 0.58, 4, 2.2],   # over, edge 3.9: lean; won; AGAINST his average
            ["e", "E", "AAA", 2.5, -115, -105, 2.6, 0.55, 3],       # over, edge 1.5: no edge; won (a row saved before averages were kept)
        ]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(build_nhl.shots_record_summary(folder / "missing")["games"], 0)
            (folder / "2026-10.json").write_text(json.dumps({"games": {"9": {"date": "2026-10-13", "away": "AAA", "home": "BBB", "plays": plays[:3]}}}))
            (folder / "2026-11.json").write_text(json.dumps({"games": {"400": {"date": "2026-11-02", "away": "AAA", "home": "BBB", "plays": plays[3:]}}}))
            record = build_nhl.shots_record_summary(folder)
        self.assertEqual((record["since"], record["through"], record["games"]), ("2026-10-13", "2026-11-02", 2))
        self.assertEqual(record["check"], {"wins": 1, "losses": 0, "units": 0.83})
        self.assertEqual(record["strong"], {"wins": 1, "losses": 1, "units": -0.09})  # -1 on the over, +0.91 on the under at -110
        self.assertEqual(record["lean"], {"wins": 1, "losses": 0, "units": 0.85})
        self.assertEqual(record["none"], {"wins": 1, "losses": 0, "units": 0.87})
        # Overs against unders counts only the plays the page calls an edge (3 to 12 points).
        self.assertEqual(record["over"], {"wins": 1, "losses": 1, "units": -0.15})
        self.assertEqual(record["under"], {"wins": 1, "losses": 0, "units": 0.91})
        # ...and, among those, the plays that went against the player's own season average.
        self.assertEqual(record["fade"], {"wins": 2, "losses": 0, "units": 1.76})
        self.assertEqual(record["with"], {"wins": 0, "losses": 1, "units": -1.0})


if __name__ == "__main__":
    unittest.main()
