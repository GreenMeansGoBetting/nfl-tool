"""NBA player props data (nfl_tool/nba/props.py, its part of build_nba.py and
the NBA part of smartstake.py).

What is pinned: on the engine's hand-made game, a player's game log is his
box score, his shot share and shot types come from the play-by-play, and
his minutes / points with a teammate on the floor plus without add up to his
totals; a DNP reason becomes rest / injury / coach; last season's players
sit on today's roster team (gone = off the list); the page opens on last
season until the middle team has THIS_SEASON_DEFAULT_AT games; SmartStake's
NBA points market is found by name and never a combo, quarter or first
scorer, and its quotes land on players by ESPN id; the tip-off line record
never rewrites a game that has started."""
import json
import sys
import tempfile
import unittest
from datetime import datetime
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
        real_fetch, real_block = build_nba.fetch_file, props.season_block
        try:
            build_nba.fetch_file = lambda kind, season, d, force: "x" if season == 2027 else None
            props.season_block = lambda pbp, b, label: {"label": label, **block(1)}
            built = build_nba.compute_props(2027, Path("."), None)
            self.assertEqual((built["default"], list(built["seasons"])), ("2027", ["2027"]))
        finally:
            build_nba.fetch_file, props.season_block = real_fetch, real_block


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


class TeammatesOut(unittest.TestCase):
    def test_a_traded_players_share_counts_his_old_teams_shots(self):
        # 1 and 2 played for AAA against BBB (game 10); 1 is on CCC now and Out tonight
        # for CCC, where 3 plays. 1 took 10 of AAA's 20 shots: half, not all of CCC's.
        f = props.LOG_FIELDS
        row = lambda game, opp, fga: dict(zip(f, ["2026-10-01", game, opp, 1, 1, 30, 10, fga, 0, 0, 0]))  # noqa: E731
        as_list = lambda d: [d.get(k) for k in f]  # noqa: E731
        block = {"fields": f, "players": {
            "1": {"team": "CCC", "log": [as_list(row(10, "BBB", 10))]},
            "2": {"team": "AAA", "log": [as_list(row(10, "BBB", 10))]},
            "3": {"team": "CCC", "log": [as_list(row(11, "DDD", 12))]},
        }}
        game = {"game_id": "20", "date": "2026-10-22", "away": "CCC", "home": "EEE"}
        odds = {"CCC_EEE": {"props": {"points": {"3": {"name": "P3", "q": [["dk", "o", 9.5, -110, ""]]}}}}}
        slate = build_nba.points_slate(2027, block, odds, [game], None, {"CCC": [{"id": "1", "status": "Out"}]},
                                       {"1": "CCC", "2": "AAA", "3": "CCC"}, datetime(2026, 10, 22, 12, 0))
        self.assertEqual(slate["20"]["3"]["missing"], 0.5)


class LinesRecord(unittest.TestCase):
    def test_a_started_game_is_never_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = build_nba.PROPS_RECORD_DIR
            build_nba.PROPS_RECORD_DIR = Path(tmp)
            try:
                games = [{"game_id": "1", "away": "BOS", "home": "DET", "start_utc": "2026-10-21T23:00Z"}]

                def slate(line):
                    return {"1": {"7": {"line": line, "proj": line, "ours": None, "w": 0.0}}}
                build_nba.props_lines_record(2027, slate(14.5), games, datetime(2026, 10, 21, 20, 0))
                build_nba.props_lines_record(2027, slate(20.5), games, datetime(2026, 10, 21, 23, 30))  # after tip
                saved = json.loads((Path(tmp) / "lines_2027.json").read_text())
                self.assertEqual(saved, {"1": {"7": [14.5, 14.5, None, 0.0]}})
            finally:
                build_nba.PROPS_RECORD_DIR = real

    def test_the_line_is_the_middle_main_line_across_books(self):
        game = {"away": "BOS", "home": "DET"}
        odds = {"BOS_DET": {"props": {"points": {"7": {"name": "P", "q": [["dk", "o", 14.5, -110, ""], ["fd", "o", 15.5, -110, ""], ["mgm", "u", 14.5, -110, ""]]}}}}}
        self.assertEqual(build_nba.points_line(odds, game, "7"), 14.5)
        self.assertIsNone(build_nba.points_line(odds, game, "8"))


class Projection(unittest.TestCase):
    def row(self, minutes, pts):
        return ["2026-10-21", 1, "BBB", 1, 1, minutes, pts, 10, 1, 3, 2]

    def test_day_one_is_the_line(self):
        self.assertEqual(props.project_points(14.5, 0, None), (14.5, 0.0))
        self.assertEqual(props.project_points(None, 5, 20.0), (None, 0.0))

    def test_it_moves_toward_ours_as_games_come_in_never_past_half(self):
        p1, w1 = props.project_points(14.5, 1, 24.5)
        p10, w10 = props.project_points(14.5, 10, 24.5)
        p82, w82 = props.project_points(14.5, 82, 24.5)
        self.assertAlmostEqual(w1, props.PROJ_MAX / (1 + props.PROJ_K))
        self.assertAlmostEqual(w10, props.PROJ_MAX / 2)
        self.assertLess(w82, props.PROJ_MAX)
        self.assertTrue(14.5 < p1 < p10 < p82 < 14.5 + 10 * props.PROJ_MAX)

    def test_our_number_minutes_rate_pace_and_the_other_defense(self):
        log = [self.row(30, 15), self.row(30, 15), self.row(20, 10)]  # 40 points in 80 minutes
        ours, minutes, ppm = props.our_points(log, props.LOG_FIELDS, None, None, None)
        self.assertAlmostEqual(ppm, 0.5)
        self.assertAlmostEqual(minutes, 80 / 3)
        self.assertAlmostEqual(ours, 80 / 3 * 0.5 * (1 + props.LEAN))
        league = {"off_pace": {"avg": 100.0}, "def_ppp": {"avg": 1.10}, "def_trans_freq": {"avg": 0.20}}
        opp = {"off_pace": 106.0, "def_ppp": 1.21, "def_trans_freq": 0.24}
        fast_soft = props.our_points(log, props.LOG_FIELDS, {"off_pace": 104.0}, opp, league, out_share=0.2)[0]
        want = (80 / 3 * 0.5 * (1 + props.LEAN) * 1.05 ** props.W_PACE * 1.1 ** props.W_DEF * 1.2 ** props.W_TRANS
                * (1 + props.W_OUT * 0.2))
        self.assertAlmostEqual(fast_soft, want)


if __name__ == "__main__":
    unittest.main()
