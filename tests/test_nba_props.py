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
                self.assertEqual(saved, {"1": {"7": [14.5, 14.5, None, 0.0, None, None, None, None]}})
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
        fast_soft = props.our_points(log, props.LOG_FIELDS, {"off_pace": 104.0}, opp, league, out_share=0.2, share=0.1, opp_out=0.3)[0]
        want = (80 / 3 * 0.5 * (1 + props.LEAN) * 1.05 ** props.W_PACE * 1.1 ** props.W_DEF * 1.2 ** props.W_TRANS
                * (1 + (props.W_OUT - props.W_OUT_SHARE * 0.5) * 0.2) * (1 + props.W_OPP_OUT * 0.3))
        self.assertAlmostEqual(fast_soft, want)

    def test_a_minutes_dip_bounces_back(self):
        # last 5 at 20 minutes, season 25: our minutes sit above the last 5 (the 2025-26 replay)
        log = [self.row(30, 15)] * 5 + [self.row(20, 10)] * 5
        ours, minutes, ppm = props.our_points(log, props.LOG_FIELDS, None, None, None)
        self.assertAlmostEqual(minutes, 20)
        self.assertAlmostEqual(ours, 20 * 0.5 * (1 + props.LEAN) * (20 / 25) ** props.W_MIN)
        self.assertGreater(ours, 20 * 0.5)

    def test_missing_teammates_lift_role_players_not_stars(self):
        log = [self.row(30, 15)] * 3
        none = props.our_points(log, props.LOG_FIELDS, None, None, None)[0]
        role = props.our_points(log, props.LOG_FIELDS, None, None, None, out_share=0.2, share=0.1)[0]
        star = props.our_points(log, props.LOG_FIELDS, None, None, None, out_share=0.2, share=0.3)[0]
        self.assertGreater(role, none * 1.1)
        self.assertAlmostEqual(star, none)  # never cut: too few stars in the replay to say


class TestPointsRecord(unittest.TestCase):
    """props.record_ledger: every projection graded against its tip-off line (the owner, 2026-10-23)."""

    def block(self):
        def row(game, pts):
            return ["2026-10-24", game, "BBB", 1, 1, 30, pts, 10, 1, 3, 2]
        return {"fields": props.LOG_FIELDS, "players": {"1": {"log": [row(10, 25), row(11, 20)]}, "2": {"log": [row(10, 30)]}}}

    def test_the_lean_is_graded_and_tagged(self):
        lines = {
            "10": {"1": [24.5, 25.4, 30.0, 0.2, 0.8, 0.12, 0.1, 0.0],  # over, won; star line, minutes dip, role player
                   "2": [28.5, 27.9, 25.0, 0.2]},                       # under, lost (old four-field row)
            "11": {"1": [20.0, 21.0, 25.0, 0.2]},                       # a push: not a play
        }
        ledger = props.record_ledger(lines, self.block())
        self.assertEqual(ledger, [["2026-10-24", 0.9, 1, None, ["over", "star", "dip", "role"]],
                                  ["2026-10-24", 0.6, 0, None, ["under", "star"]]])

    def test_no_lean_or_no_game_is_no_play(self):
        lines = {"10": {"1": [24.5, 24.5, None, 0.0], "3": [12.5, 13.5, 15.0, 0.1]}, "99": {"1": [10.5, 11.0, 12.0, 0.1]}}
        self.assertEqual(props.record_ledger(lines, self.block()), [])
        self.assertEqual(props.record_ledger(lines, None), [])

    def test_the_record_starts_when_the_projection_went_on_the_page(self):
        block = self.block()
        block["players"]["1"]["log"][0][0] = "2026-10-22"  # the old formula's night
        lines = {"10": {"1": [24.5, 25.4, 30.0, 0.2]}}
        self.assertEqual(props.record_ledger(lines, block), [])


class Threes(unittest.TestCase):
    """The threes projection (2026-10-23, tools/backtest/nba_threes.py): tries x
    make rate, a night's count wider than Poisson, anchored to the books."""

    def row(self, minutes, made, tried, game=1):
        return ["2026-10-21", game, "BBB", 1, 1, minutes, 10, 10, made, tried, 2]

    def test_a_nights_threes_spread_wider_than_poisson(self):
        import math
        poisson = lambda m, k: math.exp(-m) * m ** k / math.factorial(k)  # noqa: E731
        self.assertAlmostEqual(sum(props.nb_pmf(1.8, k) for k in range(40)), 1.0, places=6)
        # the replay: 1+ hits less often than Poisson, 4+ more often
        self.assertLess(props.chance_over(1.0, 0.5), 1 - poisson(1.0, 0))
        self.assertGreater(props.chance_over(1.0, 3.5), 1 - sum(poisson(1.0, k) for k in range(4)))

    def test_the_books_chance_and_the_mean_it_implies(self):
        q = [["dk", "o", 1.5, -130, ""], ["fd", "o", 1.5, -120, ""], ["dk", "u", 1.5, 100, ""], ["fd", "u", 1.5, -105, ""], ["mgm", "o", 2.5, 190, ""]]
        p = props.market_chance(q, 1.5)
        self.assertTrue(0.5 < p < 0.56)
        self.assertAlmostEqual(props.chance_over(props.mean_for(p, 1.5), 1.5), p, places=4)
        self.assertEqual(props.best_price(q, "o", 1.5), -120)
        self.assertIsNone(props.market_chance(q, 3.5))
        # one side only: its price less a 4.5% vig
        self.assertAlmostEqual(props.market_chance([["dk", "o", 0.5, -300, ""]], 0.5), 0.75 / 1.045)

    def test_day_one_is_the_books_and_ours_moves_it(self):
        q = [["dk", "o", 1.5, -110, ""], ["dk", "u", 1.5, -110, ""]]
        day1 = props.project_threes(1.5, q, 0, None)
        self.assertAlmostEqual(day1["p_over"], 0.5, places=4)
        self.assertAlmostEqual(day1["edge"], 0.0, places=4)
        later = props.project_threes(1.5, q, 10, 3.0)
        self.assertAlmostEqual(later["w"], props.PROJ_MAX / 2)
        self.assertGreater(later["edge"], 0.05)
        self.assertEqual(len(later["ladder"]), 5)
        self.assertTrue(all(a > b for a, b in zip(later["ladder"], later["ladder"][1:])))
        self.assertIsNone(props.project_threes(1.5, [], 10, 3.0)["edge"])  # no price: no edge

    def test_tries_times_a_make_rate_pulled_toward_the_league(self):
        log = [self.row(30, 3, 6)] * 4  # 24 tries, 12 made in 120 minutes
        t = props.our_threes(log, props.LOG_FIELDS, None, None, None, 0.36)
        self.assertAlmostEqual(t["pct"], (12 + props.THREES_K * 0.36) / (24 + props.THREES_K))
        luck = 3 - 6 * t["pct"]
        self.assertAlmostEqual(t["tries"], 30 * 0.2 * (1 + props.T_LEAN) * (1 + props.T_LUCK * luck))
        self.assertAlmostEqual(t["makes"], t["tries"] * t["pct"])

    def test_threes_allowed_help_defense_and_underdogs_raise_tries(self):
        log = [self.row(30, 2, 6)] * 4
        league = {"off_pace": {"avg": 100.0}, "def_three_pp": {"avg": 0.38}, "def_catch3": {"avg": 0.6}}
        avg = {"off_pace": 100.0, "def_three_pp": 0.38, "def_catch3": 0.6}
        base = props.our_threes(log, props.LOG_FIELDS, avg, avg, league, 0.36)["tries"]
        loose = props.our_threes(log, props.LOG_FIELDS, avg, {**avg, "def_three_pp": 0.42, "def_catch3": 0.66}, league, 0.36)["tries"]
        self.assertAlmostEqual(loose / base, (0.42 / 0.38) ** props.T_DEF3 * 1.1 ** props.T_CATCH3)
        dog = props.our_threes(log, props.LOG_FIELDS, avg, avg, league, 0.36, spread=10)["tries"]
        self.assertAlmostEqual(dog / base, 1 + props.T_DOG)
        role = props.our_threes(log, props.LOG_FIELDS, avg, avg, league, 0.36, out_share=0.2, share=0.1)["tries"]
        star = props.our_threes(log, props.LOG_FIELDS, avg, avg, league, 0.36, out_share=0.2, share=0.3)["tries"]
        self.assertGreater(role, base * 1.1)
        self.assertAlmostEqual(star, base)

    def test_the_slate_reads_the_threes_market_and_his_teams_spread(self):
        f = props.LOG_FIELDS
        block = {"fields": f, "players": {"3": {"team": "CCC", "log": [self.row(30, 2, 6, game=g) for g in range(5)]}}}
        game = {"game_id": "20", "date": "2026-10-22", "away": "CCC", "home": "EEE", "home_team_spread": -8.5}
        q = [["dk", "o", 1.5, -125, ""], ["fd", "o", 1.5, -115, ""], ["dk", "u", 1.5, 105, ""]]
        odds = {"CCC_EEE": {"props": {"threes": {"3": {"name": "P3", "q": q}}}}}
        s = build_nba.threes_slate(2027, block, odds, [game], None, {}, {"3": "CCC"}, datetime(2026, 10, 22, 12, 0))["20"]["3"]
        self.assertEqual(s["line"], 1.5)
        self.assertEqual(s["spread"], 8.5)  # the road team is getting 8.5
        self.assertEqual((s["best_o"], s["best_u"]), (-115, 105))
        self.assertEqual(s["games"], 5)
        self.assertAlmostEqual(s["edge"], s["p_over"] - s["p_mkt"], places=2)

    def test_the_play_is_the_side_that_beats_its_best_price(self):
        # the NHL pages' rule: our chance minus what the price needs, the bigger side, positive only
        self.assertEqual(props.threes_play(0.6, 110, -130)[:2], ("over", 0.6 - 100 / 210))
        side, edge, price = props.threes_play(0.4, -110, 120)
        self.assertEqual((side, price), ("under", 120))
        self.assertAlmostEqual(edge, 0.6 - 100 / 220)
        self.assertIsNone(props.threes_play(0.5, -115, -115))  # the vig eats both sides
        self.assertIsNone(props.threes_play(0.6, None, None))

    def test_the_record_grades_the_play_at_its_best_price(self):
        def row(game, made):
            return ["2026-10-24", game, "BBB", 1, 1, 30, 10, 10, made, 6, 2]
        block = {"fields": props.LOG_FIELDS, "players": {"1": {"log": [row(10, 3), row(11, 1)]}, "2": {"log": [row(10, 2)]}}}
        lines = {
            # over: 58% vs +110's 47.6%, 3 made: won 1.1u; underdog, cold run
            "10": {"1": [1.5, 1.9, 2.2, 0.25, 0.58, 0.52, 110, -130, 1.0, 0.0, 0.2, -0.8, 7.5],
                   # under: 60% vs +105's 48.8%, 2 made on 1.5: lost 1u
                   "2": [1.5, 1.4, 1.2, 0.25, 0.40, 0.45, -150, 105, 1.0, 0.0, 0.2, 0.0, -3.0]},
            # no positive edge on either side: not a play
            "11": {"1": [0.5, 1.0, 1.0, 0.0, 0.6, 0.6, -150, 120]},
        }
        ledger = props.threes_ledger(lines, block)
        self.assertEqual(ledger, [["2026-10-24", round(0.6 - 100 / 205, 4), 0, -1.0, ["under"]],
                                  ["2026-10-24", round(0.58 - 100 / 210, 4), 1, 1.1, ["over", "dog", "cold"]]])
        self.assertEqual(props.threes_ledger(lines, None), [])

    def test_a_started_game_is_never_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = build_nba.PROPS_RECORD_DIR
            build_nba.PROPS_RECORD_DIR = Path(tmp)
            try:
                games = [{"game_id": "1", "away": "BOS", "home": "DET", "start_utc": "2026-10-21T23:00Z"}]

                def slate(line):
                    return {"1": {"7": {"line": line, "proj": 1.8, "ours": 2.0, "w": 0.2, "p_over": 0.55, "p_mkt": 0.5, "best_o": -110, "best_u": -110}}}
                build_nba.threes_lines_record(2027, slate(1.5), games, datetime(2026, 10, 21, 20, 0))
                build_nba.threes_lines_record(2027, slate(2.5), games, datetime(2026, 10, 21, 23, 30))  # after tip
                saved = json.loads((Path(tmp) / "threes_2027.json").read_text())
                self.assertEqual(saved["1"]["7"][:8], [1.5, 1.8, 2.0, 0.2, 0.55, 0.5, -110, -110])
            finally:
                build_nba.PROPS_RECORD_DIR = real


if __name__ == "__main__":
    unittest.main()
