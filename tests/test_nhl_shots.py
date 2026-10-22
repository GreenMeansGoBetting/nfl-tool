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
against his own average kept apart); and tonight's lines: the NHL's projected
lineup read into lines and pairs, a player on a busier line than his minutes
say projected for more, and a play against that move set apart."""
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


class TonightsLines(unittest.TestCase):
    """The NHL's projected-lineups story (saved: STL @ OTT, 2026-10-13) and what the model does with it."""

    @classmethod
    def setUpClass(cls):
        cls.story = helpers.nhl_lineup_story()
        cls.parsed = build_nhl.parse_lineups(cls.story["markdown"])
        data = helpers.nhl_data()
        cls.skaters = {p["id"]: p for players in data["skaters"].values() for p in players}
        cls.find = staticmethod(build_nhl.player_finder(cls.skaters, {p["id"]: p for players in data["goalies"].values() for p in players}))
        cls.positions = {pid: p["pos"] for pid, p in cls.skaters.items()}

    def test_the_story_is_read_into_lines_pairs_and_goalies(self):
        self.assertEqual(list(self.parsed), ["Blues", "Senators"])
        ott = self.parsed["Senators"]
        self.assertEqual([len(g) for g in ott["groups"]], [3, 3, 3, 3, 2, 2, 2])
        self.assertEqual(ott["groups"][0], ["Warren Foegele", "Tim Stutzle", "Drake Batherson"])
        self.assertEqual(ott["groups"][4], ["Thomas Chabot", "Jordan Spence"])
        self.assertEqual(ott["goalies"], ["Samuel Ersson", "Linus Ullmark"])  # the first is the expected starter
        self.assertEqual(ott["scratched"], ["Hayden Hodgson"])
        # The reasons in brackets go, the names stay; the status report under it is not read as players.
        self.assertEqual(ott["injured"], ["Jake Sanderson", "Artem Zub", "William Eklund", "Kurtis MacDermid", "Cameron Crotty", "Nikolas Matinpalo"])
        self.assertEqual(self.parsed["Blues"]["scratched"], ["Theo Lindstein", "Zach Dean"])

    def test_other_shapes_a_story_can_take(self):
        text = "**Kraken projected lineup**\n\nA One -- B Two -- C Three\n\nD Four -- E Five\n\nG Goalie\n\n***Scratched:** None*\n\n***Injured:** H Six (lower body), I Seven (illness)*\n\n**Status report**\n\nSix skated Monday.\n\nJ Eight -- K Nine"
        kraken = build_nhl.parse_lineups(text)["Kraken"]
        self.assertEqual((kraken["groups"], kraken["goalies"], kraken["scratched"], kraken["injured"]), ([["A One", "B Two", "C Three"], ["D Four", "E Five"]], ["G Goalie"], [], ["H Six", "I Seven"]))
        self.assertEqual(build_nhl.parse_lineups("No lineups in this one."), {})
        # Typed by hand: a non-breaking space before a dash, a curly apostrophe, a long dash.
        odd = build_nhl.parse_lineups("**Predators projected lineup**\n\nA One -- Ryan O\u2019Reilly\u00a0-- C Three\n\nD Four \u2013 E Five")["Predators"]
        self.assertEqual(odd["groups"], [["A One", "Ryan O'Reilly", "C Three"], ["D Four", "E Five"]])

    def test_each_listed_skater_gets_his_line_or_pair(self):
        team_of = build_nhl.team_namer(helpers.nhl_data()["teams"])
        self.assertEqual((team_of("Senators"), team_of("Blues")), ("OTT", "STL"))
        ott = build_nhl.lineup_slots(self.parsed["Senators"], "OTT", self.find, self.positions)
        slot = lambda name: ott["skaters"][next(pid for pid, p in self.skaters.items() if p["name"] == name and p["team"] == "OTT")]
        self.assertEqual((slot("Warren Foegele"), slot("Drake Batherson"), slot("Stephen Halliday"), slot("Thomas Chabot"), slot("Carter Yakemchuk")), ("F1", "F1", "F4", "D1", "D2"))
        self.assertEqual(ott["lines"][0], ["Warren Foegele", "Tim Stutzle", "Drake Batherson"])
        # Players the page has no games for (a call-up before his first game) are named, not guessed at.
        stl = build_nhl.lineup_slots(self.parsed["Blues"], "STL", self.find, self.positions)
        self.assertIn("Dylan Peterson", stl["unknown"])
        self.assertTrue(all(isinstance(pid, str) and pid in self.skaters for pid in {**ott["skaters"], **stl["skaters"]}))
        # The injured and scratched it can match are out by id.
        eklund = next((pid for pid, p in self.skaters.items() if p["name"] == "William Eklund"), None)
        if eklund:
            self.assertIn(eklund, ott["out"])

    def test_two_forwards_listed_alone_are_a_line_not_a_pair(self):
        """Eleven forwards and seven defensemen: the short line is still forwards."""
        find = lambda team, name: name.lower()
        lineup = {"groups": [["A", "B", "C"], ["D", "E"], ["X", "Y"], ["P", "Q", "R"]], "goalies": ["G"], "scratched": [], "injured": []}
        slots = build_nhl.lineup_slots(lineup, "AAA", find, {"a": "C", "b": "L", "c": "R", "d": "L", "e": "C", "x": "D", "y": "D", "p": "D", "q": "D", "r": "D"})["skaters"]
        self.assertEqual((slots["a"], slots["d"], slots["e"], slots["x"], slots["p"]), ("F1", "F2", "F2", "D1", "D2"))

    def model(self):
        """AAA: a first line at 20 minutes, a second at 15, a fourth-liner "dep" at 10, every night for five games."""
        model = shots_model.ShotsModel()
        for d in range(1, 6):
            lines = {f"top{i}": skater("AAA", toi=1200) for i in range(3)}
            lines.update({f"mid{i}": skater("AAA", toi=900) for i in range(3)})
            lines.update({f"low{i}": skater("AAA", toi=720) for i in range(3)})
            lines.update({"dep": skater("AAA", toi=600), "dep2": skater("AAA", toi=600), "dep3": skater("AAA", toi=600), "q": skater("BBB")})
            model.add_game(game(f"2026-10-0{d}", "AAA", "BBB", lines, d))
        return model

    def test_what_each_line_plays_is_read_from_the_teams_own_games(self):
        model = self.model()
        self.assertEqual([round(model.slot_minutes("AAA", f"F{n}"), 1) for n in (1, 2, 3, 4)], [20.0, 15.0, 12.0, 10.0])
        self.assertEqual((model.usual_slot("dep", "AAA"), model.usual_slot("top0", "AAA"), model.usual_slot("mid1", "AAA")), ("F4", "F1", "F2"))
        # A team with no games yet gets the league's lines.
        self.assertAlmostEqual(model.slot_minutes("NEW", "F1"), model.slot_minutes("*", "F1"))
        self.assertIsNone(model.slot_minutes("AAA", "F9"))

    def test_a_fill_in_on_the_top_line_is_projected_for_more_but_not_for_the_stars_minutes(self):
        model = self.model()
        usual = model.project("dep", "BBB", True, team="AAA", slot="F4")
        moved = model.project("dep", "BBB", True, team="AAA", slot="F1")
        none = model.project("dep", "BBB", True)
        self.assertEqual((usual["lift"]["line"], none["lift"]["line"]), (1.0, 1.0))
        # The first line plays twice his minutes: e^(0.2 x the capped log of 2) = +13%, not +100%.
        self.assertAlmostEqual(moved["x"]["line"], shots_model.PARAMS["line_cap"])
        self.assertAlmostEqual(moved["lift"]["line"], math.exp(0.2 * 0.6))
        self.assertAlmostEqual(moved["mean"], none["mean"] * math.exp(0.2 * 0.6))
        self.assertEqual(moved["minutes"], none["minutes"])  # his own minutes are still what the page shows
        # And the other way: a first-liner listed on the fourth line.
        self.assertAlmostEqual(model.project("top0", "BBB", True, team="AAA", slot="F4")["lift"]["line"], math.exp(0.2 * -0.6))
        # A forward is never measured against a defense pair's minutes.
        self.assertEqual(model.project("dep", "BBB", True, team="AAA", slot="D1")["lift"]["line"], 1.0)

    def test_the_board_lists_exactly_the_posted_lineup(self):
        record = build_nhl.reduce_game(helpers.nhl_game())
        model = build_nhl.shots_model_for([record])
        skaters = build_nhl.compute_skaters([record], {})
        lineups = build_nhl.lineup(skaters, Counter(BUF=1, FLA=1))
        buf = [p["id"] for p in lineups["BUF"] if p["pos"] != "D"]
        # BUF's lineup is posted (its busiest forward listed on the fourth line, and one forward left out); FLA's is not.
        tonight = {"77": {"posted": "2026-10-13T16:00Z", "BUF": {"skaters": {buf[0]: "F4", **{pid: "F1" for pid in buf[1:4]}, **{pid: "F2" for pid in buf[4:11]}}}}}
        games = [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 2, "home_rest": 2}]
        entry = build_nhl.shots_board(model, games, lineups, {"FLA": [{"id": lineups["FLA"][0]["id"], "status": "Out"}]}, [], None, datetime(2026, 10, 13, 14, 0), tonight, skaters)["77"]
        rows = {r["id"]: r for r in entry["players"]}
        self.assertEqual(entry["posted"], "2026-10-13T16:00Z")
        self.assertEqual(sum(1 for r in rows.values() if r["team"] == "BUF"), 11)   # only the listed skaters (no defensemen were listed here)
        self.assertNotIn(buf[11], rows)
        self.assertEqual((rows[buf[0]]["slot"], rows[buf[0]]["usual_slot"], rows[buf[0]]["move"]), ("F4", "F1", "down"))
        self.assertLess(rows[buf[0]]["lift"]["line"], 1.0)
        self.assertFalse(any(r["out"] for r in rows.values() if r["team"] == "BUF"))
        # No lineup posted for FLA: its usual 18 by ice time, ESPN's injury list, no line.
        fla = [r for r in rows.values() if r["team"] == "FLA"]
        self.assertEqual((len(fla), sum(r["out"] for r in fla), {r["slot"] for r in fla}, {r["lift"]["line"] for r in fla}), (18, 1, {None}, {1.0}))
        page = build_nhl.lineups_for_page({"77": {"posted": "x", "BUF": {"lines": [["A", "B"]], "goalie": "9", "scratched": [], "injured": ["C"]}}}, {"9": {"name": "The Goalie"}})
        self.assertEqual(page, {"77": {"posted": "x", "BUF": {"lines": [["A", "B"]], "goalie": "The Goalie", "scratched": [], "injured": ["C"]}}})


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

    def test_a_play_is_shown_or_left_out(self):
        """The owner, 2026-10-19 (after auditing every graded play): a Shots play is an edge of
        SHOTS_BAR (6 points) or more on a player NOT moved down a line tonight. No lean, no check."""
        size = lambda chance, over, under, move: build_nhl.shots_play(chance, 1.5, over, under, None, move)["size"]
        self.assertEqual(build_nhl.SHOTS_BAR, 0.06)
        self.assertEqual(size(0.40, -110, -110, None), "play")     # under, edge 7.6
        self.assertEqual(size(0.40, -110, -110, "up"), "play")     # an under on a player moved UP is a play now (45-23 in the audit)
        self.assertEqual(size(0.40, -110, -110, "down"), "none")   # moved down a line: left out, whichever side
        self.assertEqual(size(0.62, -110, -110, "down"), "none")
        self.assertEqual(size(0.62, -110, -110, "up"), "play")
        self.assertEqual(size(0.56, -110, -110, None), "none")     # edge 3.6: under the bar (no more "lean")
        self.assertEqual(size(0.25, -110, -110, None), "play")     # a gap of 22 points is no longer set apart
        # (Points has its own bar since 2026-10-22: points_play, test_nhl_points.py.)
        self.assertEqual((build_nhl.line_move("F1", "F4"), build_nhl.line_move("D3", "D1"), build_nhl.line_move("F2", "F2")), ("up", "down", None))
        self.assertEqual((build_nhl.line_move(None, "F2"), build_nhl.line_move("F1", None), build_nhl.line_move("F1", "D1")), (None, None, None))
        self.assertEqual((build_nhl.break_even(-150), build_nhl.break_even(150), build_nhl.break_even(100)), (0.6, 0.4, 0.5))

    def row(self, pid, mean, actual, avg=None):
        return {"id": pid, "name": pid.upper(), "team": "AAA", "mean": mean, "avg": avg, "chances": [round(shots_model.chance_at_least(mean, n), 3) for n in range(1, 9)], "actual": actual}

    def test_closing_line_value(self):
        """From the first line and price the site saw to the locked ones, on the plays with an edge."""
        def game(plays):
            return {"date": "2026-10-13", "away": "AAA", "home": "BBB", "plays": plays}
        # The model's chance of the over, set so each play has an edge over the bar (6+ points).
        rows = [
            ["a", "A", "AAA", 2.5, -110, -110, 3.0, 0.62, 4, 3.0, None, 2.5, 120, -140],   # over: +120 -> -110 on the same line
            ["b", "B", "AAA", 2.5, 105, -125, 1.6, 0.36, 1, 1.6, None, 2.5, 100, -150],    # under: -150 -> -125, drifted
            ["c", "C", "AAA", 3.5, -110, -110, 4.0, 0.62, 5, 4.0, None, 2.5, -110, -110],  # over, and the line went up
            ["d", "D", "AAA", 2.5, -110, -110, 3.0, 0.62, 4, 3.0, None],                     # saved before first prices were kept
        ]
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "2026-10.json").write_text(json.dumps({"games": {"9": game(rows)}}))
            clv = build_nhl.shots_record_summary(Path(tmp))["clv"]
        self.assertEqual((clv["plays"], clv["priced"], clv["shortened"], clv["drifted"]), (3, 2, 2, 1))
        self.assertAlmostEqual(clv["points"], ((110 / 210 - 100 / 220) + (125 / 225 - 150 / 250)) / 2, places=4)

    def test_the_board_keeps_the_first_line_seen(self):
        record = build_nhl.reduce_game(helpers.nhl_game())
        model = build_nhl.shots_model_for([record])
        lineups = build_nhl.lineup(build_nhl.compute_skaters([record], {}), Counter(BUF=1, FLA=1))
        games = [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 2, "home_rest": 2}]
        now = datetime(2026, 10, 13, 14, 0)
        first = build_nhl.shots_board(model, games, lineups, {}, [], None, now, player_odds={"77": {BENSON: {"sog": {"line": 2.5, "over": 120, "under": -150, "thin": False}}}})
        row = lambda board: next(r for r in board["77"]["players"] if r["id"] == BENSON)
        self.assertEqual(row(first)["first_sog"], {"line": 2.5, "over": 120, "under": -150})
        later = build_nhl.shots_board(model, games, lineups, {}, [], {"games": first}, now, player_odds={"77": {BENSON: {"sog": {"line": 3.5, "over": 110, "under": -130}}}})
        self.assertEqual(row(later)["first_sog"], {"line": 2.5, "over": 120, "under": -150})
        self.assertIsNone(next(r for r in first["77"]["players"] if r["id"] != BENSON)["first_sog"])

    def test_a_finished_game_is_written_once(self):
        games = [{"game_id": "9", "date": "2026-10-13", "away": "AAA", "home": "BBB"}, {"game_id": "10", "date": "2026-10-13", "away": "CCC", "home": "DDD"}]
        board = {
            "9": {"final": True, "players": [self.row("a", 2.8, 4, 3.2), {**self.row("b", 1.9, 1, 2.5), "move": "up"}, self.row("noline", 1.0, 0), self.row("scratched", 2.0, None)]},
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
                # ... and whether tonight's line was a move up or down for him
                # ... and the first line and prices the site saw (none on these hand-made rows)
                # ... and the parts behind his number (SHOTS_FACTORS; mostly empty on these hand-made rows)
                ["a", "A", "AAA", 2.5, -120, 100, 2.8, round(shots_model.chance_at_least(2.8, 3), 3), 4, 3.2, None, None, None, None, build_nhl.shot_factors(board["9"]["players"][0])],
                ["b", "B", "AAA", 1.5, -140, 115, 1.9, round(shots_model.chance_at_least(1.9, 2), 3), 1, 2.5, "up", None, None, None, build_nhl.shot_factors(board["9"]["players"][1])],
            ])
            self.assertEqual((saved["cols"], saved["factors"]), (list(build_nhl.SHOTS_RECORD_COLS), list(build_nhl.SHOTS_FACTORS)))
            self.assertEqual(dict(zip(build_nhl.SHOTS_FACTORS, saved["games"]["9"]["plays"][0][-1]))["vs_avg"], -0.4)  # 2.8 tonight, 3.2 a game
            # The next build sees the same finished game: nothing is added or rewritten.
            board["9"]["players"][0]["mean"] = 9.9
            self.assertEqual(build_nhl.record_finished_games(folder, board, odds, games), 0)
            self.assertEqual(json.loads((folder / "2026-10.json").read_text()), saved)

    def test_the_record_keeps_the_parts_behind_each_number(self):
        """A real board row's factors: usage, tonight's line, home / rest, where he shoots and each matchup piece's lift."""
        record = build_nhl.reduce_game(helpers.nhl_game())
        model = build_nhl.shots_model_for([record])
        lineups = build_nhl.lineup(build_nhl.compute_skaters([record], {}), Counter(BUF=1, FLA=1))
        games = [{"game_id": "77", "date": "2026-10-13", "start_utc": "2026-10-13T23:00Z", "away": "BUF", "home": "FLA", "status": "scheduled", "away_rest": 1, "home_rest": 3}]
        board = build_nhl.shots_board(model, games, lineups, {}, [], None, datetime(2026, 10, 13, 14, 0))
        row = next(r for r in board["77"]["players"] if r["id"] == BENSON)
        f = dict(zip(build_nhl.SHOTS_FACTORS, build_nhl.shot_factors(row)))
        self.assertEqual((f["pos"], f["games"], f["home"], f["rest"], f["opp_rest"], f["slot"], f["move"]), (row["pos"], 1, 0, 1, 3, None, None))
        self.assertEqual(f["vs_avg"], round(row["mean"] - row["avg"], 3))
        self.assertEqual({k: f[f"l_{k}"] for k in row["lift"]}, row["lift"])
        self.assertEqual({a: f[f"s_{a}"] for a in row["shares"]}, row["shares"])
        self.assertLess(f["l_b2b"], 1)  # BUF on the second night of a back-to-back
        self.assertTrue(all(v is not None for k, v in f.items() if k not in ("slot", "move") and not k.startswith("s_")))  # no lineup posted; areas he shot from

    def test_the_record_by_edge_size(self):
        plays = [
            # id, name, team, line, over, under, projection, model's chance of the over, real shots, his season average
            ["a", "A", "AAA", 2.5, -120, 100, 3.4, 0.70, 3, 3.6],   # over, edge 15.5: a play (big gaps aren't set apart); won
            ["b", "B", "AAA", 2.5, -120, 100, 2.9, 0.62, 2, 3.0],   # over, edge 7.5: a play; lost; with his average
            ["c", "C", "AAA", 2.5, 100, -110, 2.0, 0.40, 1, 2.8],   # under, edge 7.6: a play; won; AGAINST his average
            ["d", "D", "AAA", 2.5, -118, 100, 2.7, 0.58, 4, 2.2],   # over, edge 3.9: under the bar; won
            ["e", "E", "AAA", 2.5, -115, -105, 2.6, 0.55, 3],       # over, edge 1.5: no edge; won (a row saved before averages were kept)
            ["f", "F", "AAA", 1.5, -110, -110, 1.3, 0.42, 3, 1.2, "up"],    # under, edge 5.6: under the bar; lost
            ["g", "G", "AAA", 1.5, -110, -110, 1.3, 0.40, 3, 1.2, "down"],  # under, edge 7.6, but he was moved DOWN a line: left out; lost
            ["h", "H", "AAA", 1.5, -110, -110, 1.3, 0.40, 1, 1.2, "up"],    # under, edge 7.6, moved UP a line: a play; won
        ]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(build_nhl.shots_record_summary(folder / "missing")["games"], 0)
            (folder / "2026-10.json").write_text(json.dumps({"games": {"9": {"date": "2026-10-13", "away": "AAA", "home": "BBB", "plays": plays[:3]}}}))
            (folder / "2026-11.json").write_text(json.dumps({"games": {"400": {"date": "2026-11-02", "away": "AAA", "home": "BBB", "plays": plays[3:]}}}))  # d to h
            record = build_nhl.shots_record_summary(folder)
        self.assertEqual((record["since"], record["through"], record["games"]), ("2026-10-13", "2026-11-02", 2))
        self.assertNotIn("check", record)
        self.assertEqual(record["play"], {"wins": 3, "losses": 1, "units": 1.65})   # a, b, c, h
        self.assertEqual(record["none"], {"wins": 2, "losses": 2, "units": -0.28})  # d, e, f and g (moved down)
        # Overs against unders counts only the plays.
        self.assertEqual(record["over"], {"wins": 1, "losses": 1, "units": -0.17})
        self.assertEqual(record["under"], {"wins": 2, "losses": 0, "units": 1.82})
        # ...and, among those, the plays that went against the player's own season average.
        self.assertEqual(record["fade"], {"wins": 1, "losses": 0, "units": 0.91})
        self.assertEqual(record["with"], {"wins": 2, "losses": 1, "units": 0.74})
        # The plays themselves, newest day first and the biggest edge first within a day, each with what happened.
        self.assertEqual([(play["date"], play["name"], play["size"], play["won"]) for play in record["plays"]], [
            ("2026-11-02", "H", "play", True),
            ("2026-10-13", "A", "play", True), ("2026-10-13", "C", "play", True), ("2026-10-13", "B", "play", False),
        ])
        c = next(play for play in record["plays"] if play["name"] == "C")
        self.assertEqual({key: c[key] for key in ("id", "team", "opp", "home", "side", "line", "price", "mean", "actual", "units", "fade")},
                         {"id": "c", "team": "AAA", "opp": "BBB", "home": False, "side": "under", "line": 2.5, "price": -110, "mean": 2.0, "actual": 1, "units": 0.91, "fade": True})
        self.assertAlmostEqual(c["edge"], 0.076, places=3)
        # Best Plays' filterable record: the same plays, oldest first, [date, edge, won, units].
        self.assertEqual([row[0] for row in record["ledger"]], ["2026-10-13"] * 3 + ["2026-11-02"])
        self.assertEqual(sorted(tuple(row) for row in record["ledger"]), sorted((p["date"], p["edge"], int(p["won"]), p["units"]) for p in record["plays"]))
        # Each day's tally of the plays.
        self.assertEqual(record["days"], [{"date": "2026-10-13", "wins": 2, "losses": 1, "units": 0.74}, {"date": "2026-11-02", "wins": 1, "losses": 0, "units": 0.91}])

    def test_the_page_lists_only_the_latest_days_of_plays(self):
        play = ["a", "A", "AAA", 2.5, -120, 100, 2.9, 0.62, 3, 3.0]  # an over at a 7.5 edge (a play) that won
        with tempfile.TemporaryDirectory() as tmp:
            games = {str(day): {"date": f"2026-11-{day:02d}", "away": "AAA", "home": "BBB", "plays": [play]} for day in range(1, 21)}
            (Path(tmp) / "2026-11.json").write_text(json.dumps({"games": games}))
            record = build_nhl.shots_record_summary(Path(tmp))
        self.assertEqual(record["play"]["wins"], 20)   # the tallies and the days cover every game
        self.assertEqual(len(record["days"]), 20)
        self.assertEqual(len(record["plays"]), build_nhl.SHOTS_RECORD_DAYS)
        # The short list Best Plays filters by days back and edge keeps every day.
        self.assertEqual(len(record["ledger"]), 20)
        self.assertEqual(record["ledger"][0], ["2026-11-01", round(record["plays"][0]["edge"], 3), 1, record["plays"][0]["units"]])
        self.assertEqual((record["plays"][0]["date"], record["plays"][-1]["date"]), ("2026-11-20", "2026-11-07"))


if __name__ == "__main__":
    unittest.main()
