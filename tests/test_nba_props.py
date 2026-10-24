"""NBA player props data (nfl_tool/nba/props.py, its part of build_nba.py and
the NBA part of smartstake.py).

What is pinned: on the engine's hand-made game, a player's game log is his
box score, his shot share and shot types come from the play-by-play, and
his minutes / points with a teammate on the floor plus without add up to his
totals; a DNP reason becomes rest / injury / coach; last season's players
sit on today's roster team (gone = off the list); the page opens on last
season until the middle team has THIS_SEASON_DEFAULT_AT games; SmartStake's
NBA points market is found by name and never a combo, quarter or first
scorer, and its quotes land on players by ESPN id. (The line-anchored
projections these tests also pinned were retired 2026-10-24 for the game sim:
tests/test_nba_sim.py.)"""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
sys.path.insert(0, str(ROOT / "tests"))
import build_nba  # noqa: E402
import props  # noqa: E402
import smartstake  # noqa: E402
from test_nba_possessions import EVENTS, MINUTES, box, game  # noqa: E402

POINTS = {11: 3, 12: 0, 13: 0, 14: 2, 15: 2, 16: 0, 21: 0, 22: 0, 23: 3, 24: 0, 25: 0}


def full_box():
    b = box(MINUTES)
    b["points"] = b["athlete_id"].map(POINTS)
    b["game_date"] = "2026-01-05"
    b["team_abbreviation"] = b["team_id"].map({1: "AAA", 2: "BBB"})
    b["opponent_team_abbreviation"] = b["team_id"].map({1: "BBB", 2: "AAA"})
    b["starter"] = b["athlete_id"].isin([11, 12, 13, 14, 15, 21, 22, 23, 24, 25])
    b["athlete_position_abbreviation"] = "G"
    for col in ("field_goals_attempted", "three_point_field_goals_made", "three_point_field_goals_attempted", "free_throws_attempted"):
        b[col] = 1
    b["reason"] = None
    # two who didn't play: one resting, one hurt
    dnp = pd.DataFrame([{**b.iloc[0].to_dict(), "athlete_id": 17, "athlete_display_name": "P17", "minutes": None, "points": 0,
                         "did_not_play": True, "reason": "REST", "starter": False},
                        {**b.iloc[0].to_dict(), "athlete_id": 18, "athlete_display_name": "P18", "minutes": None, "points": 0,
                         "did_not_play": True, "reason": "LEFT ANKLE SPRAIN", "starter": False}])
    return pd.concat([b, dnp], ignore_index=True)


class SeasonBlock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        props.MIN_TOGETHER, cls.saved = 0, props.MIN_TOGETHER  # a one-quarter game
        cls.block = props.season_block(game([dict(e) for e in EVENTS]), full_box(), "2025-26")
        cls.p = cls.block["players"]
        props.MIN_TOGETHER = cls.saved

    def test_the_log_is_the_box_score(self):
        f = self.block["fields"]
        row = dict(zip(f, self.p["15"]["log"][0]))
        self.assertEqual((row["date"], row["opp"], row["home"], row["start"], row["min"], row["pts"]), ("2026-01-05", "BBB", 1, 1, 12, 2))
        self.assertNotIn("17", self.p)  # didn't play: no log

    def test_shot_share_and_shot_types(self):
        # home took 5 shots, all with 12-15 on the floor; 14 took 1 (a putback at the rim)
        self.assertAlmostEqual(self.p["14"]["share"], round(1 / 5, 3))
        self.assertEqual(self.p["14"]["zones"]["rim"], 1.0)
        self.assertEqual(self.p["14"]["zone_pct"], {"rim": [1.0, 1]})  # his putback went in
        self.assertEqual(self.p["21"]["zone_pct"], {"corner3": [0.0, 1]})
        self.assertEqual(self.p["23"]["kinds"]["self"], 1.0)  # a step-back 3
        self.assertEqual(self.p["23"]["assisted"], 0.0)

    def test_with_and_without_add_up(self):
        # 15 played the whole quarter; 11 sat after 70 seconds, 16 came in for him
        with11 = self.p["15"]["with"].get("16")
        self.assertIsNotNone(with11)
        on_min, on_pts, _, off_min, off_pts, _ = with11
        self.assertAlmostEqual(on_min + off_min, 12, delta=0.1)
        self.assertEqual(on_pts + off_pts, 2)  # his layup came before 16 checked in
        self.assertEqual(on_pts, 0)

    def test_who_sat_and_why(self):
        self.assertEqual(sorted(self.block["out"]["AAA"]["9"]), [["17", "rest"], ["18", "injury"]])
        self.assertEqual(props.why_out("COACH'S DECISION"), "coach")
        self.assertEqual(props.why_out("RIGHT KNEE INJURY MANAGEMENT"), "rest")

    def test_last_season_sits_on_todays_roster(self):
        moved = props.on_rosters(self.block, {"15": "CCC", "23": "BBB"})
        self.assertEqual({pid: p["team"] for pid, p in moved["players"].items()}, {"15": "CCC", "23": "BBB"})


class SeasonDefault(unittest.TestCase):
    def test_this_season_only(self):
        # The owner, 2026-10-23: no last-season data on the site, even after one game.
        def block(games):
            return {"players": {"1": {"team": "AAA", "log": [["d", g] for g in range(games)]},
                                "2": {"team": "BBB", "log": [["d", 100 + g] for g in range(games)]}}}
        real_fetch, real_block, real_season = build_nba.fetch_file, props.season_block, build_nba.P.Season
        try:
            build_nba.fetch_file = lambda kind, season, d, force: "x" if season == 2027 else None
            build_nba.P.Season = lambda pbp, box: None
            props.season_block = lambda pbp, b, label, engine=None: {"label": label, **block(1)}
            built = build_nba.compute_props(2027, Path("."), None)
            self.assertEqual((built["default"], list(built["seasons"])), ("2027", ["2027"]))
        finally:
            build_nba.fetch_file, props.season_block, build_nba.P.Season = real_fetch, real_block, real_season


class SmartStakeNba(unittest.TestCase):
    def test_the_points_market_is_found_by_name_and_never_a_combo(self):
        listed = [{"key": "basketball_player_points", "name": "Player Points"},
                  {"key": "basketball_player_points_rebounds_assists", "name": "Player Points + Rebounds + Assists"},
                  {"key": "basketball_player_points_q1", "name": "1st Quarter Player Points"},
                  {"key": "basketball_first_points_scorer", "name": "1st Points Scorer"},
                  {"key": "basketball_team_points", "name": "Team Total Points"},
                  {"key": "basketball_player_most_points_yes_no", "name": "Player Most Points"}]
        self.assertEqual(smartstake.nba_prop_market_keys(listed), {"basketball_player_points": "points"})

    def test_the_player_cards_markets_are_asked_for_only_when_listed(self):
        # The NBA player card (2026-10-21) prices every market; a key SmartStake doesn't list is never sent.
        listed = [{"key": "basketball_player_points"}, {"key": "basketball_player_rebounds"},
                  {"key": "basketball_player_points_rebounds_assists"}, {"key": "basketball_player_fouls"}]
        self.assertEqual(smartstake.nba_listed_markets(listed), {"basketball_player_points": "points",
                         "basketball_player_rebounds": "rebounds", "basketball_player_points_rebounds_assists": "pra"})
        self.assertEqual(smartstake.nba_listed_markets([]), {})

    def test_quotes_land_on_players_by_espn_id(self):
        q = {"event_id": 1, "book": "draftkings", "market_key": "basketball_player_points", "player_id": 7,
             "participant": "Payton Pritchard", "away": "Boston Celtics", "home": "Detroit Pistons",
             "side": "over", "line": 14.5, "odds": -115, "starts_at": "2026-10-21T23:00:00Z"}
        under = {**q, "side": "under", "odds": -105}
        ids = {"paytonpritchard": "4066354"}
        games = smartstake.build_book_odds([q, under], lambda full: {"boston celtics": "BOS", "detroit pistons": "DET"}.get(full.lower()),
                                           prop_markets={"basketball_player_points": "points"}, td_market=None, line_markets={},
                                           player_key=lambda name, a, h: ids.get(smartstake.norm_player(name)))
        row = games["BOS_DET"]["props"]["points"]["4066354"]
        self.assertEqual(sorted(x[1] for x in row["q"]), ["o", "u"])
        self.assertEqual(row["q"][0][2], 14.5)


class GameLog(unittest.TestCase):
    def test_the_card_fields_come_after_the_first_eleven(self):
        # Older files and the Points page read the first eleven by position.
        self.assertEqual(props.LOG_FIELDS[:11], ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta"])
        self.assertEqual(len(props.LOG_FIELDS), 11 + len(props.BOX_EXTRA))
        self.assertEqual([props.num(v) for v in (7.0, "+5", "-3", None, "", float("nan"))], [7, 5, -3, None, None, None])


if __name__ == "__main__":
    unittest.main()
