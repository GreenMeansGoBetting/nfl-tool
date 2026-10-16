"""The NHL build (nfl_tool/nhl/build_nhl.py) on saved samples.

What is pinned: where a shot counts as coming from (the rink areas, and that
every shot is turned to face the net its team attacks), who was a man up, one
real game boiled down to the right totals, the two-sided team numbers, the
lineup rule for one-game fill-ins, the same odds lock as the NFL site (a
game that has started never shows a fresh, in-game line), and the player
card's data: each player's own shot areas and game log, and Novig's player
odds (main lines, one-sided prices kept, placeholder first-goal asks dropped)."""
import copy
import json
import tempfile
import unittest
from collections import Counter
from datetime import datetime
from pathlib import Path

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl

BUF, FLA = 7, 13  # the NHL's team ids in the saved game (FLA @ BUF)


class RinkAreas(unittest.TestCase):
    """shot_area: x is feet toward the attacked net (goal line at 89), +y the shooter's left."""

    def test_each_area(self):
        for (x, y), area in {
            (80, 0): "low_slot", (85, 8): "low_slot", (70, -9): "low_slot",
            (60, 0): "slot", (70, 20): "slot", (55, -22): "slot", (75, 12): "slot",
            (60, 30): "left", (85, 12): "left", (95, 5): "left",
            (60, -30): "right", (88, -10): "right", (92, -1): "right",
            (40, 10): "point", (26, -40): "point", (53, 0): "point",
            (10, 0): "long", (-60, 5): "long",
        }.items():
            self.assertEqual(build_nhl.shot_area(x, y), area, f"({x}, {y})")

    def test_a_shot_is_turned_to_face_the_net_it_attacks(self):
        self.assertEqual(build_nhl.normalize_xy({"xCoord": 61, "yCoord": -19}, 1), (61, -19))
        self.assertEqual(build_nhl.normalize_xy({"xCoord": -84, "yCoord": 9}, -1), (84, -9))
        self.assertIsNone(build_nhl.normalize_xy({"xCoord": 61}, 1))
        self.assertIsNone(build_nhl.normalize_xy({"xCoord": 61, "yCoord": 2}, None))


class Manpower(unittest.TestCase):
    """strength: the feed's code is away goalie, away skaters, home skaters, home goalie."""

    def test_codes(self):
        for code, home, away in (
            ("1551", "5v5", "5v5"),
            ("1451", "pp", "sh"),
            ("1541", "sh", "pp"),
            ("1441", "ev", "ev"),
            ("1331", "ev", "ev"),
            ("0651", "en", "extra"),  # away goalie pulled: home shoots at an empty net
            ("1560", "extra", "en"),
            ("1010", "ps", "ps"),
            ("0101", "ps", "ps"),
        ):
            self.assertEqual(build_nhl.strength(code, True), home, f"{code} home")
            self.assertEqual(build_nhl.strength(code, False), away, f"{code} away")

    def test_a_missing_code_counts_as_five_a_side(self):
        self.assertEqual(build_nhl.strength(None, True), "5v5")


class SavedGame(unittest.TestCase):
    """FLA @ BUF, 2026-10-12 (BUF 5, FLA 3): both teams changed goalies."""

    @classmethod
    def setUpClass(cls):
        cls.raw = helpers.nhl_game()
        cls.game = build_nhl.reduce_game(cls.raw)

    def test_score_and_teams(self):
        g = self.game
        self.assertEqual((g["id"], g["date"], g["home"], g["away"], g["ended"]), (2026020087, "2026-10-12", "BUF", "FLA", "REG"))
        self.assertEqual(g["score"], {"BUF": 5, "FLA": 3})

    def test_shots_on_goal_match_the_leagues_own_count(self):
        pbp = self.raw["pbp"]
        self.assertEqual(self.game["teams"]["BUF"]["sog"], pbp["homeTeam"]["sog"])
        self.assertEqual(self.game["teams"]["FLA"]["sog"], pbp["awayTeam"]["sog"])
        self.assertEqual((self.game["teams"]["BUF"]["sog"], self.game["teams"]["FLA"]["sog"]), (32, 23))

    def test_goals_by_manpower(self):
        buf, fla = self.game["teams"]["BUF"], self.game["teams"]["FLA"]
        self.assertEqual((buf["g"], buf["g_5v5"], buf["g_pp"]), (5, 3, 2))
        self.assertEqual((fla["g"], fla["g_5v5"], fla["g_pp"]), (3, 1, 2))

    def test_attempts_and_blocks(self):
        buf, fla = self.game["teams"]["BUF"], self.game["teams"]["FLA"]
        self.assertEqual((buf["att"], buf["unb"], buf["att_5v5"]), (49, 43, 39))
        self.assertEqual((fla["att"], fla["unb"], fla["att_5v5"]), (63, 46, 42))
        # A blocked shot belongs to the shooter's attempts and the other team's blocks.
        self.assertEqual(buf["blk"], fla["att"] - fla["unb"])
        self.assertEqual(fla["blk"], buf["att"] - buf["unb"])

    def test_where_the_shots_came_from(self):
        buf, fla = self.game["teams"]["BUF"], self.game["teams"]["FLA"]
        areas = lambda t: {a: t.get(f"a_{a}", 0) for a in build_nhl.AREAS}
        self.assertEqual(areas(buf), {"low_slot": 8, "slot": 10, "left": 6, "right": 5, "point": 13, "long": 0})
        self.assertEqual(areas(fla), {"low_slot": 11, "slot": 3, "left": 9, "right": 2, "point": 21, "long": 0})
        # BUF's one shot at the empty net isn't part of where it shoots from.
        self.assertEqual(sum(areas(buf).values()), buf["unb"] - 1)
        self.assertEqual(sum(areas(fla).values()), fla["unb"])
        self.assertEqual((buf["ag_low_slot"], buf["ag_slot"], buf["ag_point"]), (2, 2, 1))
        self.assertEqual(fla["ag_low_slot"], 3)

    def test_every_shot_faces_the_net_its_team_attacks(self):
        """The feed marks each shot's zone from the shooter's side; after the
        turn, an offensive-zone shot must sit past the blue line."""
        pbp = self.raw["pbp"]
        team_of = {r["playerId"]: r["teamId"] for r in pbp["rosterSpots"]}
        directions = build_nhl.attack_directions(pbp["plays"], team_of, pbp["homeTeam"]["id"])
        self.assertEqual(directions, {(1, FLA): -1, (1, BUF): 1, (2, FLA): 1, (2, BUF): -1, (3, FLA): -1, (3, BUF): 1})
        checked = 0
        for p in pbp["plays"]:
            d = p.get("details") or {}
            if p["typeDescKey"] in ("goal", "shot-on-goal", "missed-shot") and d.get("zoneCode") == "O":
                x, _ = build_nhl.normalize_xy(d, directions[(p["periodDescriptor"]["number"], d["eventOwnerTeamId"])])
                self.assertGreater(x, build_nhl.BLUE_LINE_X, p["timeInPeriod"])
                checked += 1
        self.assertGreater(checked, 70)

    def test_directions_without_the_feeds_side_field(self):
        """A period the feed doesn't label is read from where the shots were taken."""
        pbp = copy.deepcopy(self.raw["pbp"])
        for p in pbp["plays"]:
            p.pop("homeTeamDefendingSide", None)
        team_of = {r["playerId"]: r["teamId"] for r in pbp["rosterSpots"]}
        self.assertEqual(build_nhl.attack_directions(pbp["plays"], team_of, BUF), {(1, FLA): -1, (1, BUF): 1, (2, FLA): 1, (2, BUF): -1, (3, FLA): -1, (3, BUF): 1})

    def test_a_skaters_line(self):
        benson = self.game["skaters"]["8484145"]
        self.assertEqual((benson["name"], benson["team"], benson["pos"]), ("Zach Benson", "BUF", "L"))
        self.assertEqual((benson["toi"], benson["g"], benson["a"], benson["sog"], benson["att"], benson["hd"], benson["ppp"]), (1180, 0, 1, 2, 3, 2, 1))

    def test_goalies(self):
        goalies = self.game["goalies"]
        self.assertEqual(len(goalies), 4)
        ellis, luukkonen = goalies["8481551"], goalies["8480045"]
        self.assertTrue(ellis["start"])
        self.assertFalse(luukkonen["start"])
        self.assertEqual((luukkonen["sa"], luukkonen["ga"], luukkonen["dec"], luukkonen["toi"]), (14, 1, "W", 2014))
        # Both goals Ellis gave up came from the low slot.
        self.assertEqual((ellis["hd_sa"], ellis["hd_ga"]), (2, 2))

    def test_a_shootout_counts_only_in_the_final_score(self):
        raw = helpers.nhl_game()
        before = build_nhl.reduce_game(raw)["teams"]["BUF"]
        raw["pbp"]["plays"].append({
            "typeDescKey": "goal", "periodDescriptor": {"number": 5, "periodType": "SO"}, "situationCode": "1010",
            "details": {"xCoord": 80, "yCoord": 0, "scoringPlayerId": 8484145, "eventOwnerTeamId": BUF, "goalieInNetId": 8474593},
        })
        self.assertEqual(build_nhl.reduce_game(raw)["teams"]["BUF"], before)


class SeasonNumbers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.game = build_nhl.reduce_game(helpers.nhl_game())
        cls.stats = build_nhl.compute_team_stats([cls.game], {}, {}, {})

    def test_what_a_defense_allows_is_what_the_other_offense_did(self):
        buf, fla = self.stats["BUF"], self.stats["FLA"]
        for key in ("gpg", "sog_pg", "att_pg", "hd_pg", "sh_pct", "low_slot_pg", "point_share", "slot_g"):
            self.assertEqual(buf[f"def_{key}"], fla[f"off_{key}"], key)
            self.assertEqual(fla[f"def_{key}"], buf[f"off_{key}"], key)
        self.assertEqual((buf["off_gpg"], buf["off_sog_pg"], buf["off_hd_pg"]), (5.0, 32.0, 8.0))
        self.assertAlmostEqual(buf["att_share"] + fla["att_share"], 1, places=3)
        self.assertEqual(buf["off_sh_pct"], round(3 / 25, 4))

    def test_area_shares_add_up(self):
        for team in ("BUF", "FLA"):
            self.assertAlmostEqual(sum(self.stats[team][f"off_{a}_share"] for a in build_nhl.AREAS), 1, places=3)

    def test_the_penalty_kill_is_the_other_side_of_a_power_play_row(self):
        reports = {"powerplay": {7: {"powerPlayPct": 0.25, "ppOpportunitiesPerGame": 3.5}}, "penaltykill": {7: {"penaltyKillPct": 0.8, "timesShorthandedPerGame": 2.75}}}
        buf = build_nhl.compute_team_stats([self.game], {}, reports, {"BUF": 7})["BUF"]
        self.assertEqual((buf["off_pp_pct"], buf["off_pp_opp_pg"], buf["pk_pct"], buf["def_pp_pct"], buf["def_pp_opp_pg"]), (0.25, 3.5, 0.8, 0.2, 2.75))

    def test_results(self):
        game = {"home": "AAA", "away": "BBB", "score": {"AAA": 3, "BBB": 2}, "ended": "REG"}
        self.assertEqual((build_nhl.result_for(game, "AAA"), build_nhl.result_for(game, "BBB")), ("W", "L"))
        for ended in ("OT", "SO"):
            self.assertEqual(build_nhl.result_for({**game, "ended": ended}, "BBB"), "OTL")

    def test_recent_games_name_the_starter(self):
        recent = build_nhl.compute_recent_games([self.game])
        self.assertEqual(recent["BUF"][0], {
            "date": "2026-10-12", "opp": "FLA", "home": True, "gf": 5, "ga": 3, "result": "W", "ended": "REG", "sog": 32, "sog_against": 23, "goalie": "Colten Ellis",
        })
        self.assertEqual(recent["FLA"][0]["goalie"], "Jacob Markstrom")

    def test_goalie_season_line(self):
        goalies = build_nhl.compute_goalies([self.game])
        luukkonen = goalies["8480045"]
        self.assertEqual((luukkonen["games"], luukkonen["starts"], luukkonen["record"]), (1, 0, "1-0-0"))
        self.assertEqual(luukkonen["sv_pct"], round(13 / 14, 4))
        self.assertEqual(luukkonen["gaa"], round(1 * 3600 / 2014, 2))
        self.assertIsNone(luukkonen["l5_sv_pct"])  # "last five starts": he has none


class Lineup(unittest.TestCase):
    """Lineup-aware usage: a one-game fill-in must not jump the regulars."""

    def skater(self, pid, toi, games, pos="C"):
        return {"id": pid, "team": "AAA", "pos": pos, "toi": toi, "games": games}

    def test_one_big_night_doesnt_top_the_list(self):
        skaters = {"reg": self.skater("reg", 18.0, 10), "fill": self.skater("fill", 22.0, 1), "dman": self.skater("dman", 24.0, 10, "D")}
        order = [s["id"] for s in build_nhl.lineup(skaters, Counter({"AAA": 10}))["AAA"]]
        self.assertEqual(order, ["reg", "fill", "dman"])  # forwards first, then defense

    def test_a_regular_back_from_injury_makes_the_list(self):
        """Charlie McAvoy, 2026-10-16: back after six games out with 24:41,
        his one game was discounted to last of Boston's eight defensemen.
        Dressing in the team's latest game means he is in the lineup now; a
        one-game fill-in who didn't dress last game is still held down."""
        skaters = {f"d{i}": self.skater(f"d{i}", 20.0 - i, 7, "D") for i in range(6)}
        skaters["back"] = self.skater("back", 24.7, 1, "D")
        skaters["fill"] = self.skater("fill", 24.0, 1, "D")
        dressed = {"AAA": {"back", "d0", "d1", "d2", "d3", "d4"}}
        order = [s["id"] for s in build_nhl.lineup(skaters, Counter({"AAA": 7}), dressed)["AAA"]]
        self.assertEqual(order[0], "back")
        self.assertNotIn("fill", order)
        # Without knowing who dressed, the old discount drops him.
        self.assertNotIn("back", [s["id"] for s in build_nhl.lineup(skaters, Counter({"AAA": 7}))["AAA"]])

    def test_last_dressed_is_each_teams_latest_game(self):
        line = lambda team: {"team": team}
        records = [
            {"home": "AAA", "away": "BBB", "skaters": {"a1": line("AAA"), "a2": line("AAA"), "b1": line("BBB")}},
            {"home": "CCC", "away": "AAA", "skaters": {"a1": line("AAA"), "a3": line("AAA"), "c1": line("CCC")}},
        ]
        self.assertEqual(build_nhl.last_dressed(records), {"AAA": {"a1", "a3"}, "BBB": {"b1"}, "CCC": {"c1"}})

    def test_the_tripwire_names_a_priced_player_on_no_list(self):
        now = datetime(2026, 10, 16, 18, 0)
        games = [{"game_id": "1", "away": "BOS", "home": "ANA", "status": "scheduled", "start_utc": "2026-10-17T02:00Z"},
                 {"game_id": "2", "away": "NJD", "home": "DET", "status": "scheduled", "start_utc": "2026-10-16T17:00Z"}]
        lineups = {"BOS": [{"id": "pasta"}], "ANA": [], "NJD": [], "DET": []}
        odds = {"1": {"pasta": {"name": "David Pastrnak", "team": "BOS", "sog": {"line": 3.5}},
                      "chuck": {"name": "Charlie McAvoy", "team": "BOS", "sog": {"line": 1.5}},
                      "goalie": {"name": "Jeremy Swayman", "team": "BOS", "saves": {"line": 27.5}}},
                "2": {"x": {"name": "Started Game", "team": "NJD", "sog": {"line": 2.5}}}}
        self.assertEqual(build_nhl.unlisted_priced(games, lineups, odds, now),
                         [{"game": "1", "team": "BOS", "id": "chuck", "name": "Charlie McAvoy"}])

    def test_early_in_the_season_everyone_counts_in_full(self):
        skaters = {"a": self.skater("a", 18.0, 2), "b": self.skater("b", 22.0, 1)}
        self.assertEqual([s["id"] for s in build_nhl.lineup(skaters, Counter({"AAA": 2}))["AAA"]], ["b", "a"])


class Schedule(unittest.TestCase):
    def test_eastern_time_uses_the_feeds_offset(self):
        self.assertEqual(build_nhl.eastern("2026-10-13T23:00:00Z", "-04:00"), datetime(2026, 10, 13, 19, 0))
        self.assertEqual(build_nhl.eastern("2026-11-10T00:30:00Z", "-05:00"), datetime(2026, 11, 9, 19, 30))
        self.assertEqual(build_nhl.utc_text("2026-10-13T23:00:00Z"), "2026-10-13T23:00Z")

    def test_rest_days(self):
        games = [{"date": "2026-10-13", "away": "NJD", "home": "DET"}]
        season = [
            {"gameDate": "2026-10-12", "homeTeamId": 1, "visitingTeamId": 9},
            {"gameDate": "2026-10-10", "homeTeamId": 17, "visitingTeamId": 8},
            {"gameDate": "2026-10-13", "homeTeamId": 17, "visitingTeamId": 1},
        ]
        build_nhl.add_rest(games, season, {1: "NJD", 17: "DET", 9: "OTT", 8: "MTL"})
        self.assertEqual((games[0]["away_rest"], games[0]["home_rest"]), (1, 3))  # NJD played yesterday

    def test_first_game_has_no_rest_number(self):
        games = [{"date": "2026-10-13", "away": "NJD", "home": "DET"}]
        build_nhl.add_rest(games, [], {})
        self.assertEqual((games[0]["away_rest"], games[0]["home_rest"]), (None, None))


class NovigLines(unittest.TestCase):
    def test_main_lines_from_the_saved_event(self):
        """NJD @ DET: only the main (consensus) moneyline, puck line and total, never an alternate line."""
        lines = build_nhl.lines_from_event(helpers.nhl_novig_event()["event"])
        self.assertEqual(lines, {
            "away_team_spread": 1.5, "away_spread_odds": -257, "home_team_spread": -1.5, "home_spread_odds": 245,
            "total_line": 6.5, "over_odds": 125, "under_odds": -127,
            "away_moneyline": 102, "home_moneyline": -104, "away_ml_implied_prob": 0.493, "home_ml_implied_prob": 0.507,
        })

    def test_win_chances_add_to_one(self):
        lines = build_nhl.lines_from_event(helpers.nhl_novig_event()["event"])
        self.assertAlmostEqual(lines["away_ml_implied_prob"] + lines["home_ml_implied_prob"], 1, places=3)

    def test_price_conversion(self):
        self.assertEqual([build_nhl.price_to_american(p) for p in (0.5, 0.6, 0.4, 0, 1, None)], [-100, -150, 150, None, None, None])


class OddsLock(unittest.TestCase):
    """Books keep quoting after puck drop; a started game keeps the line of the last build before it."""

    PREGAME = {"home_team_spread": -1.5, "away_team_spread": 1.5, "total_line": 6.5, "home_moneyline": -104, "away_moneyline": 102}
    LIVE = {"home_team_spread": 1.5, "away_team_spread": -1.5, "total_line": 8.5, "home_moneyline": 320, "away_moneyline": -400}
    NOW = datetime(2026, 10, 13, 23, 30)

    def game(self, start, status="scheduled"):
        return {"game_id": "1", "start_utc": start, "status": status}

    def test_started_game_keeps_the_previous_builds_line(self):
        games = [self.game("2026-10-13T22:00Z")]
        build_nhl.apply_lines(games, {"1": self.LIVE}, {"schedule": [{"game_id": "1", **self.PREGAME}]}, self.NOW)
        self.assertEqual({k: games[0][k] for k in self.PREGAME}, self.PREGAME)
        self.assertTrue(games[0]["lines_locked"])

    def test_started_game_with_no_earlier_build_shows_no_line(self):
        for status in ("scheduled", "final"):
            games = [self.game("2026-10-13T22:00Z", status)]
            build_nhl.apply_lines(games, {"1": self.LIVE}, None, self.NOW)
            self.assertFalse(any(k in games[0] for k in self.LIVE))
            self.assertTrue(games[0]["lines_locked"])

    def test_game_that_hasnt_started_gets_this_runs_line(self):
        games = [self.game("2026-10-14T00:00Z")]
        build_nhl.apply_lines(games, {"1": self.PREGAME}, {"schedule": [{"game_id": "1", **self.LIVE}]}, self.NOW)
        self.assertEqual({k: games[0][k] for k in self.PREGAME}, self.PREGAME)
        self.assertFalse(games[0]["lines_locked"])

    def test_no_fresh_line_falls_back_to_the_last_one(self):
        games = [self.game("2026-10-14T00:00Z")]
        build_nhl.apply_lines(games, {}, {"schedule": [{"game_id": "1", **self.PREGAME}]}, self.NOW)
        self.assertEqual(games[0]["total_line"], 6.5)

    def test_player_odds_lock_the_same_way(self):
        fresh, old = {"1": {"p": {"goal": "in-game"}}, "2": {"p": {"goal": "fresh"}}}, {"player_odds": {"1": {"p": {"goal": "pregame"}}, "2": {"p": {"goal": "old"}}, "9": {"p": {}}}}
        games = [self.game("2026-10-13T22:00Z"), {**self.game("2026-10-14T00:00Z"), "game_id": "2"}, {**self.game("2026-10-14T02:00Z"), "game_id": "3"}]
        locked = build_nhl.locked_player_odds(games, fresh, old, self.NOW)
        # Started: the last build's. Not started: this run's. A game off the schedule is dropped.
        self.assertEqual(locked, {"1": {"p": {"goal": "pregame"}}, "2": {"p": {"goal": "fresh"}}})
        self.assertEqual(build_nhl.locked_player_odds(games, fresh, None, self.NOW), {"2": {"p": {"goal": "fresh"}}})
        self.assertEqual(build_nhl.locked_player_odds(games, {}, old, self.NOW)["2"], {"p": {"goal": "old"}})


class PlayerCardData(unittest.TestCase):
    """What the player card reads: each player's game log, where his shots
    came from and what kind they were (FLA @ BUF again)."""

    @classmethod
    def setUpClass(cls):
        cls.game = build_nhl.reduce_game(helpers.nhl_game())
        cls.detail = build_nhl.compute_player_details([cls.game])

    def test_a_skaters_areas_and_shot_types(self):
        benson = self.game["skaters"]["8484145"]
        self.assertEqual(benson["areas"], {"low_slot": [2, 1, 0], "left": [1, 1, 0]})  # [shots, on goal, goals]
        self.assertEqual(benson["types"], {"snap": [3, 0]})
        self.assertEqual((benson["unb"], benson["pp_unb"], benson["pm"], benson["pim"]), (3, 1, 0, 0))

    def test_players_areas_add_up_to_the_teams(self):
        for team in ("BUF", "FLA"):
            skaters = [s for s in self.game["skaters"].values() if s["team"] == team]
            for area in build_nhl.AREAS:
                self.assertEqual(sum(s["areas"].get(area, [0, 0, 0])[0] for s in skaters), self.game["teams"][team].get(f"a_{area}", 0), f"{team} {area}")
                self.assertEqual(sum(s["areas"].get(area, [0, 0, 0])[2] for s in skaters), self.game["teams"][team].get(f"ag_{area}", 0), f"{team} {area} goals")
        for s in self.game["skaters"].values():
            self.assertEqual(sum(v[0] for v in s["types"].values()), sum(v[0] for v in s["areas"].values()), s["name"])

    def test_every_shot_a_goalie_faced_has_an_area(self):
        for g in self.game["goalies"].values():
            self.assertEqual(sum(v[0] for v in g["areas"].values()), g["sa"], g["name"])
            self.assertEqual(sum(v[1] for v in g["areas"].values()), g["ga"], g["name"])
        self.assertEqual(self.game["goalies"]["8480045"]["areas"], {"low_slot": [5, 1], "slot": [1, 0], "left": [5, 0], "point": [3, 0]})

    def test_log_rows_point_at_the_game(self):
        self.assertEqual(self.detail["games"], {"2026020087": ["2026-10-12", "BUF", "FLA", 5, 3, "REG"]})
        self.assertEqual(self.detail["skaters"]["8484145"]["log"], [["2026020087", "BUF", 1180, 0, 1, 2, 3, 0, 1, 0, 0, 1, None]])  # None: the sample game has no shift chart, so no line
        self.assertEqual(self.detail["goalies"]["8480045"]["log"], [["2026020087", "BUF", 0, "W", 2014, 14, 1, 5, 1]])

    def test_the_file_spells_each_game_out_from_the_players_side(self):
        self.assertEqual(build_nhl.player_file(self.detail, "8484145")["log"], [["2026-10-12", "FLA", 1, 5, 3, "REG", 1180, 0, 1, 2, 3, 0, 1, 0, 0, 1, None]])
        self.assertEqual(build_nhl.player_file(self.detail, "8480045")["log"], [["2026-10-12", "FLA", 1, 5, 3, "REG", 0, "W", 2014, 14, 1, 5, 1]])
        visitor = next(pid for pid, s in self.game["skaters"].items() if s["team"] == "FLA")
        self.assertEqual(build_nhl.player_file(self.detail, visitor)["log"][0][:6], ["2026-10-12", "BUF", 0, 3, 5, "REG"])
        self.assertIsNone(build_nhl.player_file(self.detail, "1"))
        self.assertIsNone(build_nhl.player_file(None, "8484145"))

    def test_games_add_up(self):
        second = {**self.game, "id": 2026020099}
        benson = build_nhl.compute_player_details([self.game, second])["skaters"]["8484145"]
        self.assertEqual(len(benson["log"]), 2)
        self.assertEqual((benson["areas"], benson["types"], benson["unb"], benson["pp_unb"]), ({"low_slot": [4, 2, 0], "left": [2, 2, 0]}, {"snap": [6, 0]}, 6, 2))

    def test_the_leagues_yardstick(self):
        league = build_nhl.league_areas([self.game])
        self.assertEqual(league["low_slot"], {"share": 0.2159, "sh_pct": 0.3846})  # 19 of 88 shots; 5 goals on 13 on goal
        self.assertEqual(league["long"], {"share": 0.0, "sh_pct": None})
        self.assertAlmostEqual(sum(a["share"] for a in league.values()), 1, places=3)

    def test_one_file_per_team(self):
        stats = {"skaters": build_nhl.compute_skaters([self.game], {}), "goalies": build_nhl.compute_goalies([self.game]), "detail": self.detail}
        with tempfile.TemporaryDirectory() as folder:
            build_nhl.write_player_files(Path(folder), {"BUF": {}, "FLA": {}, "DET": {}}, stats, "2026-10-13T14:12Z")
            buf = json.loads((Path(folder) / "BUF.json").read_text())
            det = json.loads((Path(folder) / "DET.json").read_text())
        self.assertEqual((buf["log_lead"], buf["skater_cols"], buf["goalie_cols"]), (["date", "opp", "home", "gf", "ga", "ended"], list(build_nhl.SKATER_LOG_COLS), list(build_nhl.GOALIE_LOG_COLS)))
        self.assertEqual(len(buf["skaters"]), 18)
        self.assertEqual(sorted(buf["goalies"]), ["8480045", "8481551"])
        benson = buf["skaters"]["8484145"]
        self.assertEqual(set(benson), {"season"})  # this season only: nothing from last season is written
        self.assertEqual(benson["season"]["log"][0][:7], ["2026-10-12", "FLA", 1, 5, 3, "REG", 1180])
        self.assertTrue(all(s["team"] == "BUF" for pid, s in self.game["skaters"].items() if pid in buf["skaters"]))
        self.assertEqual((det["skaters"], det["goalies"]), ({}, {}))  # a team with nobody yet still gets a file


def novig_market(kind, name, strike, prices, team="Detroit Red Wings", consensus=True):
    """One player market shaped like Novig's feed."""
    words = lambda word: word if word in ("Yes", "No") else f"{word} {strike}"
    return {
        "type": kind, "is_consensus": consensus, "strike": strike,
        "player": {"full_name": name, "player_competitors": [{"competitor": {"name": team}}]},
        "outcomes": [{"description": words(word), "available": price} for word, price in prices.items()],
    }


class PlayerOdds(unittest.TestCase):
    """Novig's player markets for NJD @ DET (the saved event)."""

    TEAMS = {"Detroit Red Wings": "DET", "New Jersey Devils": "NJD"}

    def read(self, event):
        return build_nhl.player_odds_from_event(event, self.TEAMS.get, lambda team, name: f"{team}:{name}")

    @classmethod
    def setUpClass(cls):
        cls.odds = cls.read(cls, helpers.nhl_novig_event()["event"])
        cls.hughes = cls.odds["NJD:Jack Hughes"]

    def test_over_unders_use_the_main_line(self):
        self.assertEqual(self.hughes["sog"], {"line": 3.5, "over": 115, "under": -125, "chance": 0.456, "thin": False})
        self.assertEqual(self.hughes["points"]["line"], 1.5)  # the book's main line, not the 0.5 it also lists
        self.assertEqual(self.hughes["assists"], {"line": 0.5, "over": -113, "under": -100, "chance": 0.515, "thin": False})
        self.assertEqual(sum(1 for o in self.odds.values() if "sog" in o), 14)

    def test_the_other_lines_ride_along_as_ladders(self):
        self.assertEqual(self.hughes["sog_alts"], [[1.5, -590], [2.5, -199], [4.5, 251], [5.5, 506], [6.5, 953]])  # never the main 3.5
        self.assertEqual(self.hughes["goal_alts"], [[1.5, 1150], [2.5, 5782]])

    def test_anytime_goal(self):
        self.assertEqual(self.hughes["goal"], {"odds": 178, "no_odds": -233, "thin": False, "chance": 0.34})
        self.assertEqual(sum(1 for o in self.odds.values() if "goal" in o), 36)
        # One-sided (nobody selling No): kept, flagged, and the chance comes in under the asking price.
        mazur = self.odds["DET:Carter Mazur"]["goal"]
        self.assertEqual(mazur, {"odds": 1076, "no_odds": None, "thin": True, "chance": 0.081})

    def test_first_goal_placeholders_are_dropped(self):
        """The book listed 31 first-goal prices; 27 were one-sided asks of
        21-27% (defensemen included). Only the four real markets remain."""
        priced = {o["name"]: o["first_goal"] for o in self.odds.values() if "first_goal" in o}
        self.assertEqual(sorted(priced), ["Alex DeBrincat", "Dylan Larkin", "Jack Hughes", "Nico Hischier"])
        self.assertEqual(priced["Jack Hughes"], {"odds": 1076, "thin": False, "chance": 0.081})
        for o in self.odds.values():
            if "first_goal" in o:
                self.assertLess(o["first_goal"]["chance"], o["goal"]["chance"], o["name"])  # can't score first without scoring

    def test_one_sided_first_goal_must_fit_his_anytime_price(self):
        event = {"markets": [
            novig_market("PLAYER_GOALS", "Real Price", 0.5, {"Over": 0.30, "Under": 0.75}),
            novig_market("FIRST_GOAL_SCORER", "Real Price", 0.0, {"Yes": 0.10, "No": None}),
            novig_market("PLAYER_GOALS", "Placeholder", 0.5, {"Over": 0.30, "Under": 0.75}),
            novig_market("FIRST_GOAL_SCORER", "Placeholder", 0.0, {"Yes": 0.20, "No": None}),
            novig_market("FIRST_GOAL_SCORER", "No Anytime", 0.0, {"Yes": 0.05, "No": None}),
        ]}
        odds = self.read(event)
        self.assertEqual(odds["DET:Real Price"]["first_goal"], {"odds": 900, "thin": True, "chance": 0.09})
        self.assertNotIn("first_goal", odds["DET:Placeholder"])
        self.assertNotIn("DET:No Anytime", odds)

    def test_first_goal_chances_never_add_past_one(self):
        event = {"markets": [m for name in "ABC" for m in (
            novig_market("PLAYER_GOALS", name, 0.5, {"Over": 0.6, "Under": 0.45}),
            novig_market("FIRST_GOAL_SCORER", name, 0.0, {"Yes": 0.45, "No": 0.5}),
        )]}
        chances = [o["first_goal"]["chance"] for o in self.read(event).values()]
        self.assertEqual(chances, [0.333, 0.333, 0.333])

    def test_junk_quotes(self):
        event = {"markets": [
            novig_market("PLAYER_GOALS", "Both 99", 0.5, {"Over": 0.999, "Under": 0.999}),
            novig_market("PLAYER_GOALS", "Wide", 0.5, {"Over": 0.8, "Under": 0.8}),
            novig_market("SHOTS_ON_GOAL", "Empty", 2.5, {"Over": None, "Under": None}),
            novig_market("SHOTS_ON_GOAL", "One Side", 2.5, {"Over": 0.4, "Under": None}),
            novig_market("SHOTS_ON_GOAL", "Wide", 2.5, {"Over": 0.6, "Under": 0.6}),
        ]}
        odds = self.read(event)
        self.assertNotIn("DET:Both 99", odds)
        self.assertNotIn("DET:Empty", odds)
        self.assertNotIn("goal", odds["DET:Wide"])
        self.assertEqual(odds["DET:One Side"]["sog"], {"line": 2.5, "over": 150, "under": None, "chance": None, "thin": True})
        self.assertTrue(odds["DET:Wide"]["sog"]["thin"])  # the two asks add to 120%

    def test_a_player_the_site_doesnt_know_is_left_out(self):
        event = helpers.nhl_novig_event()["event"]
        self.assertEqual(build_nhl.player_odds_from_event(event, self.TEAMS.get, lambda team, name: None), {})
        self.assertEqual(build_nhl.player_odds_from_event(event, lambda name: None, lambda team, name: "x"), {})


class FindingPlayers(unittest.TestCase):
    """Books spell names their own way; the site's id is the NHL's."""

    @classmethod
    def setUpClass(cls):
        skaters = {
            "1": {"name": "Tim Stützle", "team": "OTT"}, "2": {"name": "Mitchell Marner", "team": "VGK"},
            "3": {"name": "Elias Pettersson", "team": "VAN"}, "4": {"name": "Elias Pettersson", "team": "VAN"},
        }
        cls.find = staticmethod(build_nhl.player_finder(skaters, {"9": {"name": "Jake Allen", "team": "NJD"}}))

    def test_matches(self):
        self.assertEqual(self.find("OTT", "Tim Stutzle"), "1")    # accents
        self.assertEqual(self.find("VGK", "Mitch Marner"), "2")   # same last name and first initial on the team
        self.assertEqual(self.find("DET", "Jake Allen"), "9")     # just changed teams: the only one in the league

    def test_no_guess_when_it_could_be_two_players(self):
        self.assertIsNone(self.find("VAN", "Elias Pettersson"))
        self.assertIsNone(self.find("OTT", "Nobody Here"))

    def test_team_names(self):
        teams = {"DET": {"mascot": "Red Wings"}, "MTL": {"mascot": "Canadiens"}, "STL": {"mascot": "Blues"}, "CBJ": {"mascot": "Blue Jackets"}}
        name = build_nhl.team_namer(teams)
        self.assertEqual([name(n) for n in ("Detroit Red Wings", "Montréal Canadiens", "St. Louis Blues", "Columbus Blue Jackets", "Seattle Kraken")], ["DET", "MTL", "STL", "CBJ", None])


if __name__ == "__main__":
    unittest.main()
