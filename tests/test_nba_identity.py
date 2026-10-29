"""NBA Team Identity numbers (nfl_tool/nba/identity.py and its part of
build_nba.py), read by Matchup Breakdown (site/nba/nba.js; its page tests are
test_nba_matchup_site.py).

What is pinned: on the engine's hand-made game every number is worked out by
hand, and one team's offense equals the other team's defense (both sides are
the same possessions); the merged Paint and Ball Movement numbers, points per
quarter and the win / loss splits; the build is this season only; last
season's saved file has every number the page reads."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "tests"))
import build_nba  # noqa: E402
import identity  # noqa: E402
import possessions as P  # noqa: E402
from test_nba_possessions import EVENTS, MINUTES, box, game  # noqa: E402

REFERENCE = json.loads((ROOT / "nfl_tool" / "nba" / "identity_2026.json").read_text(encoding="utf-8"))


class HandMadeGame(unittest.TestCase):
    """The engine test's game: home 1 v away 2, five possessions each.
    Home: period start (make, 2), miss (2 shots, an offensive board, a make: 2),
    steal (layup in 3 s + a technical free throw: 3), make (thrown away), miss
    (a miss 8 s after the board). Away: make (a missed corner 3), make (a
    turnover), make (a step-back 3), dead ball (a mid-range miss), miss (none)."""

    @classmethod
    def setUpClass(cls):
        season = P.Season(game([dict(e) for e in EVENTS]), box(MINUTES))
        cls.ident = identity.team_identity(season, {1: "AAA", 2: "BBB"})
        cls.a, cls.b = cls.ident["teams"]["AAA"], cls.ident["teams"]["BBB"]

    def test_points_and_transition_by_hand(self):
        self.assertAlmostEqual(self.a["off_ppp"], 7 / 5)
        self.assertAlmostEqual(self.b["off_ppp"], 3 / 5)
        # transition: a shot or turnover within 8 s of a defensive board or a steal
        self.assertAlmostEqual(self.a["off_trans_freq"], 3 / 5)
        self.assertAlmostEqual(self.a["off_trans_ppp"], (2 + 3 + 0) / 3)
        self.assertAlmostEqual(self.a["off_tov_rate"], 1 / 5)
        self.assertAlmostEqual(self.b["off_steal_share"], 1.0)

    def test_shot_diet_by_hand(self):
        self.assertAlmostEqual(self.b["off_corner3_share"], 1 / 3)
        self.assertAlmostEqual(self.b["off_above3_share"], 1 / 3)
        self.assertAlmostEqual(self.b["off_three_rate"], 2 / 3)
        # home misses: 13's (14 got the offensive board) and 12's 3 (21 got the defensive one)
        self.assertAlmostEqual(self.a["off_oreb_rate"], 1 / 2)

    def test_merged_rows(self):
        # Matchup Breakdown's Paint = the rim and the short paint together; Ball Movement =
        # makes assisted and catch-and-shoot, averaged (the owner, 2026-10-28)
        for t in (self.a, self.b):
            self.assertAlmostEqual(t["off_paint_share"], t["off_rim_share"] + t["off_short_share"])
            self.assertAlmostEqual(t["off_ball_move"], (t["off_assisted"] + t["off_catch"]) / 2)
        rim, short = self.a["off_rim_share"], self.a["off_short_share"]
        made = rim * (self.a["off_rim_pct"] or 0) + short * (self.a["off_short_pct"] or 0)
        self.assertAlmostEqual(self.a["off_paint_pct"], made / (rim + short))

    def test_points_per_quarter_and_wins_and_losses(self):
        # one game, AAA 7 BBB 3: the quarters add up to the margin, each the other's opposite
        quarters = [k for k in self.a if k.endswith("_ppq")]
        self.assertTrue(quarters)
        self.assertAlmostEqual(sum(self.a[k] for k in quarters), 7 - 3)
        for k in quarters:
            self.assertAlmostEqual(self.a[k], -self.b[k])
        wl = self.ident["wl"]
        self.assertEqual((wl["AAA"]["nw"], wl["AAA"]["nl"], wl["BBB"]["nw"], wl["BBB"]["nl"]), (1, 0, 0, 1))
        self.assertAlmostEqual(wl["AAA"]["w"]["off_ppp"], 7 / 5)
        self.assertAlmostEqual(wl["BBB"]["l"]["def_ppp"], 7 / 5)
        self.assertEqual((wl["AAA"]["l"], wl["BBB"]["w"]), ({}, {}))
        self.assertEqual(sorted(k[4:] for k in wl["AAA"]["w"] if k.startswith("off_")), sorted(identity.WL_KEYS))

    def test_wins_and_losses_come_from_the_final_score(self):
        # possessions can miss a few points (BKN @ CLE 2026-10-24: CLE won 125-121 but its
        # possessions summed to 120, so CLE showed 2-2 at 3-1); the scoreboard's final decides
        season = P.Season(game([dict(e) for e in EVENTS]), box(MINUTES))
        finals = season.check["player"].isna()
        season.check.loc[finals & (season.check["team"] == 2), "rebuilt"] = 9.0
        wl = identity.team_identity(season, {1: "AAA", 2: "BBB"})["wl"]
        self.assertEqual((wl["AAA"]["nw"], wl["AAA"]["nl"], wl["BBB"]["nw"], wl["BBB"]["nl"]), (0, 1, 1, 0))

    def test_one_teams_offense_is_the_others_defense(self):
        for key in ("ppp", "pace", "poss_secs", "trans_freq", "rim_share", "three_rate", "tov_rate", "oreb_rate", "fta_rate"):
            self.assertAlmostEqual(self.a[f"off_{key}"], self.b[f"def_{key}"], msg=key)
            self.assertAlmostEqual(self.b[f"off_{key}"], self.a[f"def_{key}"], msg=key)


class Extremes(unittest.TestCase):
    """Matchup Extremes (the owner, 2026-10-26): a team's games against a type
    of opponent vs its games against everyone, next to the league's split."""

    def test_split_and_league_split_by_hand(self):
        import pandas as pd
        # three teams, so a type is one team (the top third). CCC shoots the most 3s.
        ident = {"teams": {t: {"off_three_rate": r} for t, r in (("AAA", 0.3), ("BBB", 0.35), ("CCC", 0.5))}}
        rows = pd.DataFrame([
            # game, offense, defense, points a 100 (pace etc. alike)
            ("g1", "CCC", "AAA", 130), ("g1", "AAA", "CCC", 100),
            ("g2", "BBB", "AAA", 100), ("g2", "AAA", "BBB", 110),
            ("g3", "CCC", "BBB", 110), ("g3", "BBB", "CCC", 120),
        ], columns=["game_id", "off", "def", "pts"])
        for k in ("pace", "fg3m", "fta", "tov"):
            rows[k] = 1.0
        real = identity.game_rows, identity.shot_shares
        identity.game_rows, identity.shot_shares = (lambda season: rows.copy()), (lambda season: {})
        try:
            ex = identity.matchup_extremes(None, ident, {})
        finally:
            identity.game_rows, identity.shot_shares = real
        threes = next(t for t in ex["types"] if t["key"] == "threes")
        self.assertEqual((threes["teams"], threes["side"]), (["CCC"], "off"))
        # AAA allowed 130 to CCC, 115 on average: +15. The league: CCC scored 120 vs 111.67 overall.
        self.assertEqual(ex["teams"]["AAA"]["threes"]["n"], 1)
        self.assertEqual(ex["teams"]["AAA"]["threes"]["pts"], [130.0, 15.0])
        self.assertEqual(ex["teams"]["BBB"]["threes"]["pts"], [110.0, 0.0])  # 110 to CCC, 110 on average
        self.assertEqual(ex["league"]["threes"]["pts"], 8.3)
        self.assertEqual(ex["teams"]["CCC"]["threes"]["n"], 0)

    def test_every_type_in_the_saved_season(self):
        ex = REFERENCE["extremes"]
        self.assertEqual(len(ex["types"]), 18)
        self.assertEqual(len(ex["teams"]), 30)
        self.assertTrue(all(len(t["teams"]) == 10 for t in ex["types"]))


class Spots(unittest.TestCase):
    """Schedule Spots (the owner, 2026-10-26): which spot each team is in, from the schedule."""

    def test_spots_from_dates_sites_and_the_last_score(self):
        import pandas as pd
        games = [  # id, date, home, away, home score, away score (None = not played)
            (1, "2026-10-20", "BOS", "AAA", 130, 100),  # AAA loses by 30 on the road
            (2, "2026-10-21", "CCC", "AAA", 100, 101),  # back-to-back, 2nd road game
            (3, "2026-10-23", "DEN", "AAA", 110, 112),  # 3 in 4, altitude, 3rd road game
            (4, "2026-10-24", "UTAH", "AAA", 90, 95),   # b2b, 4 in 6 (21, 23, 24 + 20), road game 4
            (5, "2026-10-26", "AAA", "BOS", None, None),  # first home game after the trip; BOS rested 5 days
        ]
        sched = pd.DataFrame([{"game_id": g, "game_date": d, "home_abbreviation": h, "away_abbreviation": a, "home_score": hs or 0,
                               "away_score": as_ or 0, "status_type_completed": hs is not None, "season_type": 2,
                               "notes_headline": "NBA Cup - Group Play" if g == 5 else "", "broadcast_market": "home"}
                              for g, d, h, a, hs, as_ in games])
        tags = identity.situation_tags(sched)
        self.assertEqual(sorted(tags[(1, "AAA")]), ["road_first"])
        self.assertEqual(sorted(tags[(2, "AAA")]), ["after_blowout_loss", "b2b"])
        self.assertEqual(sorted(tags[(3, "AAA")]), ["altitude", "three_in_four"])
        self.assertEqual(sorted(tags[(4, "AAA")]), ["altitude", "b2b", "four_in_six", "road_long", "three_in_four"])
        self.assertEqual(sorted(tags[(5, "AAA")]), ["four_in_six", "home_after_trip", "spotlight", "three_in_four"])  # 23, 24, 26 and 21
        self.assertEqual(sorted(tags[(5, "BOS")]), ["after_blowout_win", "layoff", "rest_edge", "road_first", "spotlight"])


class SeasonDefault(unittest.TestCase):
    def build(self, this_season_games):
        def fake_fetch(kind, season, data_dir, force):
            return "pbp" if this_season_games and season == 2027 else None

        def fake_block(pbp, box_, label, schedule=None):
            return {"label": label, "team_games": this_season_games, "teams": {}, "league": {}}

        real_fetch, real_block = build_nba.fetch_file, identity.season_block
        build_nba.fetch_file, identity.season_block = fake_fetch, fake_block
        try:
            return build_nba.compute_identity(2027, Path("."), False)
        finally:
            build_nba.fetch_file, identity.season_block = real_fetch, real_block

    def test_this_season_only(self):
        # The owner, 2026-10-23: no last-season data on the site, even after one game.
        before = self.build(0)
        self.assertEqual((before["default"], list(before["seasons"])), ("2027", []))
        early = self.build(1)
        self.assertEqual((early["default"], list(early["seasons"])), ("2027", ["2027"]))


class SavedSeason(unittest.TestCase):
    def test_last_season_has_every_team_and_number(self):
        self.assertEqual(REFERENCE["label"], "2025-26")
        self.assertEqual(len(REFERENCE["teams"]), 30)
        self.assertEqual(REFERENCE["team_games"], 82)
        js = (ROOT / "nfl_tool" / "site" / "nba" / "nba.js").read_text(encoding="utf-8")
        for row in REFERENCE["teams"].values():
            for side in ("off", "def"):
                for key in ("ppp", "pace", "trans_ppp", "paint_share", "paint_pct", "ball_move", "tov_rate", "oreb_rate"):
                    self.assertIsNotNone(row.get(f"{side}_{key}"), f"{side}_{key}")
            self.assertIsNotNone(row.get("q1_ppq"))
        # every matchup row the page reads is a number the build makes
        rows = js[js.index("const M_ROWS"):js.index("const M_GROUPS")]
        for key in identity.WL_KEYS:
            self.assertIn(f'["{key}"', rows)
        self.assertEqual(rows.count('\n  ["'), len(identity.WL_KEYS))
        self.assertEqual(len(REFERENCE["wl"]), 30)
        # the league's possessions a game and corner-3 share, as the engine measured them
        self.assertAlmostEqual(REFERENCE["league"]["off_pace"]["avg"], 99, delta=1.5)
        self.assertAlmostEqual(REFERENCE["league"]["off_corner3_share"]["avg"], 0.105, delta=0.01)


if __name__ == "__main__":
    unittest.main()
