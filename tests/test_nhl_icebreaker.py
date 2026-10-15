"""Icebreaker's build (build_nhl.py: fast_starts, icebreaker_row / _board, the record and
Winners history) and SmartStake's first goal scorer prices (smartstake.py).

What is pinned: a game's first goal and each team's first goal, by game clock, and the
early shots, from the saved game; the fast-start numbers (shown, never counted); a player's
rate is the market moved toward the model by as much as the season has earned, the model
alone without a price; DraftKings' first goal price and the best one; a started game keeps
the last build's rows and never gets new ones; a finished 7:00 slate's Icebreaker is the
quickest first goal, ties included, written once; the Winners history's place and chance;
the first goal scorer market found by name, Yes kept and No dropped."""
import json
import math
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from helpers import nhl_game  # first: puts nfl_tool/nhl on the import path

import build_nhl as b
import smartstake


def secs(text):
    m, s = text.split(":")
    return int(m) * 60 + int(s)


class Game(unittest.TestCase):
    def test_first_goals_and_early_shots_come_from_the_play_by_play(self):
        raw = nhl_game()
        r = b.reduce_game(raw)
        pbp = raw["pbp"]
        team_of = {pbp["homeTeam"]["id"]: pbp["homeTeam"]["abbrev"], pbp["awayTeam"]["id"]: pbp["awayTeam"]["abbrev"]}
        goals = [((p["periodDescriptor"]["number"] - 1) * 1200 + secs(p["timeInPeriod"]), team_of[p["details"]["eventOwnerTeamId"]], str(p["details"]["scoringPlayerId"]))
                 for p in pbp["plays"] if p["typeDescKey"] == "goal" and p["periodDescriptor"].get("periodType") != "SO"]
        first = min(goals)
        self.assertEqual((r["first_goal"]["t"], r["first_goal"]["team"], r["first_goal"]["id"]), first)
        self.assertTrue(r["first_goal"]["name"])
        for team in (pbp["homeTeam"]["abbrev"], pbp["awayTeam"]["abbrev"]):
            mine = [t for t, who, _ in goals if who == team]
            self.assertEqual(r["first_goals"].get(team), min(mine) if mine else None)
            early = sum(1 for p in pbp["plays"] if p["typeDescKey"] in ("goal", "shot-on-goal") and p["periodDescriptor"]["number"] == 1
                        and secs(p["timeInPeriod"]) < b.EARLY_SECONDS and team_of.get(p["details"].get("eventOwnerTeamId")) == team)
            self.assertEqual(r["teams"][team].get("sog_early", 0), early)


def record(home, away, first=None, firsts=None, early=(0, 0)):
    return {"home": home, "away": away, "first_goal": first, "first_goals": firsts or {},
            "teams": {home: {"sog_early": early[0]}, away: {"sog_early": early[1]}}}


class FastStarts(unittest.TestCase):
    def test_counts_and_the_middle_games_first_goal(self):
        records = [
            record("AAA", "BBB", {"t": 100, "team": "AAA"}, {"AAA": 100, "BBB": 900}, (3, 1)),
            record("BBB", "AAA", {"t": 50, "team": "BBB"}, {"BBB": 50}, (2, 0)),
            record("AAA", "CCC", {"t": 300, "team": "AAA"}, {"AAA": 300}, (1, 4)),
        ]
        fast = b.fast_starts(records)
        self.assertEqual(fast["AAA"]["gp"], 3)
        self.assertEqual(fast["AAA"]["first"], 2)
        self.assertEqual(fast["AAA"]["first_time"], 300)  # 100, 300, never: the middle game
        self.assertEqual(fast["AAA"]["sog5"], round((3 + 0 + 1) / 3, 2))
        self.assertEqual(fast["AAA"]["sog5_against"], round((1 + 2 + 4) / 3, 2))
        self.assertIsNone(fast["CCC"]["first_time"])  # scoreless in its only game
        self.assertEqual(fast["BBB"]["first_time"], 50)  # 900 and 50: the lower middle


GAME = {"game_id": "1", "away": "AAA", "home": "BBB", "date": "2026-10-20", "time": "19:00", "start_utc": "2026-10-20T23:00Z", "status": "scheduled"}


def goal_row(pid, team="AAA", mean=0.4, out=False):
    return {"id": pid, "name": f"P{pid}", "team": team, "opp": "BBB" if team == "AAA" else "AAA", "home": team == "BBB", "pos": "C",
            "slot": "F1", "usual_slot": "F1", "move": None, "games": 8, "goals": 3, "xg": 2.5, "minutes": 18.0, "mean": mean, "out": out}


class Row(unittest.TestCase):
    def test_no_price_is_the_model_alone(self):
        row = b.icebreaker_row(goal_row("9"), GAME, None, {}, 8)
        self.assertEqual(row["rate"], 0.4)
        self.assertIsNone(row["mkt_mean"])
        self.assertEqual(row["game_id"], "1")

    def test_a_price_is_moved_toward_the_model_by_what_the_season_has_earned(self):
        odds = {"goal": {"chance": 0.3}}
        mkt = round(-math.log(0.7), 4)  # the build keeps 4 places
        for games, weight in ((8, 0.5 * 8 / 20), (40, 0.5)):
            row = b.icebreaker_row(goal_row("9"), GAME, odds, {}, games)
            self.assertAlmostEqual(row["mkt_mean"], mkt, places=4)
            self.assertAlmostEqual(row["rate"], mkt + weight * (0.4 - mkt), places=4)

    def test_first_goal_prices_draftkings_and_the_best(self):
        books = {"AAA_BBB": {"props": {"first_goal": {"9": {"name": "P9", "q": [
            ["draftkings", "o", None, 700, ""], ["fanduel", "o", None, 800, ""], ["betmgm", "u", None, 2000, ""]]},
            "8": {"name": "P8", "q": [["betmgm", "o", None, 900, ""]]}}}}}
        self.assertEqual(b.first_goal_prices(books, GAME, "9"), {"fg": 700, "fg_best": ["FanDuel", 800]})
        self.assertEqual(b.first_goal_prices(books, GAME, "8"), {"fg": None, "fg_best": ["BetMGM", 900]})
        self.assertEqual(b.first_goal_prices(books, GAME, "7"), {"fg": None, "fg_best": None})


class Board(unittest.TestCase):
    NOW = datetime(2026, 10, 20, 12, 0)

    def test_an_open_game_is_built_from_the_goals_rows_without_anyone_out(self):
        goals = {"1": {"players": [goal_row("1", mean=0.2), goal_row("2", mean=0.5), goal_row("3", out=True)]}}
        board = b.icebreaker_board(goals, [GAME], [], {}, {}, None, self.NOW)
        day = board["2026-10-20"]
        self.assertEqual([r["id"] for r in day["players"]], ["2", "1"])  # most likely first
        self.assertEqual(day["games"][0]["locked"], False)

    def test_a_started_game_keeps_the_last_builds_rows_and_never_makes_new_ones(self):
        goals = {"1": {"players": [goal_row("1", mean=0.9)]}}
        late = datetime(2026, 10, 20, 23, 30)
        kept = {"days": {"2026-10-20": {"players": [{**b.icebreaker_row(goal_row("1", mean=0.3), GAME, None, {}, 8)}]}}}
        board = b.icebreaker_board(goals, [GAME], [], {}, {}, kept, late)
        self.assertEqual(board["2026-10-20"]["players"][0]["rate"], 0.3)
        self.assertTrue(board["2026-10-20"]["games"][0]["locked"])
        board = b.icebreaker_board(goals, [GAME], [], {}, {}, None, late)
        self.assertEqual(board["2026-10-20"]["players"], [])


def finished_day():
    """Two 7:00 games and an 8:00 one, all final: the 8:00 game's goal at 0:05 doesn't count."""
    games = [
        {"game_id": "1", "time": "19:00", "final": True, "first": {"t": 40, "team": "AAA", "id": "11", "name": "Eleven"}},
        {"game_id": "2", "time": "19:00", "final": True, "first": {"t": 95, "team": "CCC", "id": "21", "name": "Twenty-One"}},
        {"game_id": "3", "time": "20:00", "final": True, "first": {"t": 5, "team": "EEE", "id": "31", "name": "Thirty-One"}},
    ]
    players = [
        {"id": "12", "name": "Twelve", "team": "AAA", "game_id": "1", "rate": 0.6, "mean": 0.6, "mkt_mean": None, "fg": 600},
        {"id": "11", "name": "Eleven", "team": "AAA", "game_id": "1", "rate": 0.2, "mean": 0.2, "mkt_mean": None, "fg": 2500},
        {"id": "21", "name": "Twenty-One", "team": "CCC", "game_id": "2", "rate": 0.2, "mean": 0.2, "mkt_mean": None, "fg": None},
        {"id": "31", "name": "Thirty-One", "team": "EEE", "game_id": "3", "rate": 5.0, "mean": 5.0, "mkt_mean": None, "fg": 100},
    ]
    return {"2026-10-20": {"games": games, "players": players}}


class Record(unittest.TestCase):
    def test_the_quickest_7pm_goal_is_the_icebreaker_written_once(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            self.assertEqual(b.record_icebreaker_days(folder, finished_day()), 1)
            self.assertEqual(b.record_icebreaker_days(folder, finished_day()), 0)
            saved = json.loads((folder / "2026-10.json").read_text(encoding="utf-8"))
            day = saved["days"]["2026-10-20"]
            self.assertEqual((day["games"], day["time"]), (2, 40))
            self.assertEqual([w["id"] for w in day["winners"]], ["11"])
            self.assertEqual(len(day["players"]), 3)  # the 8:00 game isn't the promo's
            history = b.icebreaker_history(folder)
            self.assertEqual(len(history), 1)
            w = history[0]["winners"][0]
            self.assertEqual((w["rank"], w["chance"], w["fg"]), (2, 0.2, 2500))
            self.assertEqual(history[0]["top"]["name"], "Twelve")
            self.assertEqual(history[0]["top"]["chance"], 0.6)

    def test_a_tie_crowns_both_and_an_open_slate_waits(self):
        day = finished_day()
        day["2026-10-20"]["games"][1]["first"]["t"] = 40
        self.assertEqual([w["id"] for w in b.icebreaker_slate(day["2026-10-20"])["winners"]], ["11", "21"])
        day["2026-10-20"]["games"][1]["final"] = False
        self.assertIsNone(b.icebreaker_slate(day["2026-10-20"]))

    def test_a_winner_the_page_never_listed_has_no_place(self):
        day = finished_day()
        day["2026-10-20"]["games"][0]["first"]["id"] = "99"
        with tempfile.TemporaryDirectory() as folder:
            b.record_icebreaker_days(Path(folder), day)
            w = b.icebreaker_history(Path(folder))[0]["winners"][0]
            self.assertEqual((w["rank"], w["chance"]), (None, None))


class SgoProbe(unittest.TestCase):
    def test_one_events_first_goal_prices_by_book(self):
        def odd(pid, books, stat="firstToScore", side="yes"):
            return {"statID": stat, "playerID": pid, "sideID": side, "byBookmaker": {b: {"available": True, "odds": o} for b, o in books.items()}}
        event = {"eventID": "E1", "odds": {
            "a": odd("P1", {"draftkings": "+700", "fanduel": "+750"}),
            "b": odd("P2", {"fanduel": "+900"}),
            "c": odd("P1", {"draftkings": "-2000"}, side="no"),
            "d": odd(None, {"draftkings": "-130"}),  # a team to score first
            "e": odd("P3", {"draftkings": "+200"}, stat="points"),
        }}
        got = b.sgo_first_goal_summary(event)
        self.assertEqual((got["players"], got["draftkings"], got["sample"]), (2, 1, [["P1", "+700"]]))
        self.assertEqual(got["books"], {"fanduel": 2, "draftkings": 1})

    def test_it_asks_once_and_never_without_a_key(self):
        found = {"event": "E1", "players": 30, "draftkings": 28}
        self.assertEqual(b.probe_sgo_first_goal("key", {"book_odds_debug": {"sgo_first_goal": found}}), found)  # no call: already answered
        self.assertEqual(b.probe_sgo_first_goal(None, None), {"skipped": "no SGO_API_KEY"})


class FirstGoalMarket(unittest.TestCase):
    def test_the_first_goal_scorer_market_is_found_by_name(self):
        listed = [
            {"key": "hockey_player_goals", "name": "Player Goals"},
            {"key": "hockey_first_goalscorer", "name": "First Goalscorer"},
            {"key": "hockey_team_first_goal", "name": "Team To Score First Goal"},
            {"key": "hockey_p1_first_goal", "name": "1st Period First Goalscorer"},
            {"key": "hockey_last_goalscorer", "name": "Last Goalscorer"},
            {"market_key": "hockey_player_1st_goal", "market_name": "Player 1st Goal"},
            "hockey_player_first_goal_scorer",
        ]
        self.assertEqual(smartstake.first_goal_market_keys(listed), ["hockey_first_goalscorer", "hockey_player_1st_goal", "hockey_player_first_goal_scorer"])

    def test_yes_is_kept_as_the_over_and_no_is_dropped(self):
        quote = {"event_id": 1, "home": "Buffalo Sabres", "away": "Florida Panthers", "starts_at": "2026-10-20T23:00:00Z", "market_key": "hockey_first_goalscorer",
                 "participant": "Sam Reinhart", "player_id": 5, "line": None}
        quotes = [{**quote, "book": "draftkings", "side": "yes", "odds": 700}, {**quote, "book": "draftkings", "side": "no", "odds": -2000}]
        teams = {"buffalo sabres": "BUF", "florida panthers": "FLA"}
        games = smartstake.build_book_odds(quotes, teams, prop_markets={"hockey_first_goalscorer": "first_goal"}, td_market=None, line_markets={},
                                           player_key=lambda name, away, home: "8477933", yes_markets={"hockey_first_goalscorer"})
        self.assertEqual(games["FLA_BUF"]["props"]["first_goal"]["8477933"]["q"], [["draftkings", "o", None, 700, ""]])


if __name__ == "__main__":
    unittest.main()
