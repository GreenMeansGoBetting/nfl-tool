"""The NHL build (nfl_tool/nhl/build_nhl.py) on saved samples.

What is pinned: where a shot counts as coming from (the rink areas, and that
every shot is turned to face the net its team attacks), who was a man up, one
real game boiled down to the right totals, the two-sided team numbers, the
lineup rule for one-game fill-ins, and the same odds lock as the NFL site (a
game that has started never shows a fresh, in-game line)."""
import copy
import unittest
from collections import Counter
from datetime import datetime

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


if __name__ == "__main__":
    unittest.main()
