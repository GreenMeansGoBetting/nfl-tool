"""King of the Court (nfl_tool/nba/kotc.py and its part of build_nba.py), on a
small hand-made season so every answer can be worked out by hand.

What is pinned: the 40+ ... 60+ buckets count each game in every bucket it
reaches and the Score weighs them 1 to 5; a defense is judged by what its
OPPONENTS did, by position, steadied toward the league; a night's leader, ties
and his team's spread (home and away); the projection's pieces; lead chances
add up to 1 and skip players listed Out; last season's players move to this
season's roster (gone = off the board); this season's average starts with
last season's; the record never rewrites a night that has started; this
season's lines are saved as games lock; the Historical Data shares."""
import json
import math
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402
import kotc  # noqa: E402

TEAMS = {"AAA", "BBB", "CCC", "DDD"}


def box(rows):
    """Player box rows: (game, date, player id, name, team, opp, home, pos, min, pts, reb, ast)."""
    cols = ["game_id", "game_date", "athlete_id", "athlete_display_name", "team_abbreviation", "opponent_team_abbreviation",
            "home_away", "athlete_position_abbreviation", "minutes", "points", "rebounds", "assists"]
    df = pd.DataFrame([dict(zip(cols, r)) for r in rows])
    df["home_away"] = df["home_away"].map({True: "home", False: "away"})
    df["season_type"] = 2
    df["did_not_play"] = False
    df["athlete_headshot_href"] = None
    return df


# Two nights. Night 1: AAA (home) beat BBB; CCC (home) v DDD. Night 2: AAA @ CCC, BBB v DDD (home).
SEASON = box([
    (1, "2026-01-01", 10, "Star A", "AAA", "BBB", True, "G", 36, 40, 10, 12),   # 62
    (1, "2026-01-01", 11, "Big A", "AAA", "BBB", True, "C", 30, 20, 15, 2),     # 37
    (1, "2026-01-01", 20, "Star B", "BBB", "AAA", False, "PG", 34, 30, 8, 9),   # 47
    (1, "2026-01-01", 21, "Wing B", "BBB", "AAA", False, "SF", 30, 10, 5, 2),   # 17
    (2, "2026-01-01", 30, "Star C", "CCC", "DDD", True, "F", 35, 25, 12, 5),    # 42
    (2, "2026-01-01", 40, "Star D", "DDD", "CCC", False, "G", 33, 28, 6, 11),   # 45
    (3, "2026-01-02", 10, "Star A", "AAA", "CCC", False, "G", 37, 30, 9, 11),   # 50
    (3, "2026-01-02", 11, "Big A", "AAA", "CCC", False, "C", 28, 12, 12, 1),    # 25
    (3, "2026-01-02", 30, "Star C", "CCC", "AAA", True, "F", 36, 30, 15, 5),    # 50 (tie with Star A)
    (4, "2026-01-02", 20, "Star B", "BBB", "DDD", False, "PG", 30, 22, 5, 8),    # 35
    (4, "2026-01-02", 40, "Star D", "DDD", "BBB", True, "G", 34, 25, 4, 10),    # 39
])
LINES = {"1": [230.0, -6.5], "2": [220.0, 2.0], "3": [240.0, -3.0], "4": [225.0, 11.0]}


class Buckets(unittest.TestCase):
    def test_a_game_counts_in_every_bucket_it_reaches(self):
        self.assertEqual(kotc.bucket_counts(pd.Series([39, 40, 52, 60, 61])), [4, 3, 3, 2, 2])

    def test_score_weighs_the_buckets_one_to_five(self):
        self.assertEqual(kotc.bucket_score([4, 3, 3, 2, 2]), 4 + 6 + 9 + 8 + 10)

    def test_five_positions_and_a_bare_g_or_f_counts_as_sg_or_sf(self):
        # The build relabels every box score from ESPN's depth charts (positions.py);
        # a G / F that slips through is a shooting guard / small forward.
        pg = kotc.player_games(SEASON, TEAMS)
        pos = dict(zip(pg["name"], pg["pos"]))
        self.assertEqual((pos["Star B"], pos["Wing B"], pos["Big A"], pos["Star A"], pos["Star C"]), ("PG", "SF", "C", "SG", "SF"))
        self.assertEqual(pg.loc[pg["name"] == "Star A", "pra"].tolist(), [62, 50])


class Defense(unittest.TestCase):
    def setUp(self):
        self.pg = kotc.player_games(SEASON, TEAMS)
        self.league = kotc.league_numbers(self.pg, LINES)
        self.d = kotc.compute_defense(self.pg, self.league)

    def test_a_defense_is_what_its_opponents_did(self):
        # BBB faced AAA (Star A 62, Big A 37) and DDD (Star D 39).
        self.assertEqual(self.d["BBB"]["buckets"], [1, 1, 1, 1, 1])
        self.assertEqual(self.d["BBB"]["score"], 15)
        self.assertEqual(self.d["BBB"]["star"], (62 + 39) / 2)
        # CCC faced DDD (45) and AAA (50, 25): best opponent 45 then 50.
        self.assertEqual(self.d["CCC"]["star"], 47.5)
        self.assertEqual(self.d["CCC"]["games"], 2)

    def test_position_numbers_are_per_48_and_steadied_toward_the_league(self):
        raw = 48 * (62 + 39) / (36 + 34)  # shooting guards against BBB: Star A, Star D
        self.assertEqual(self.d["BBB"]["pos"]["SG"], round(raw, 1))
        league_g = self.league["pos"]["SG"]["per48"]
        self.assertGreater(raw, league_g)
        f = self.d["BBB"]["pos_f"]["SG"]
        self.assertTrue(1 < f < raw / league_g, f)  # pulled toward 1, not all the way

    def test_league_total_is_the_lines_average(self):
        self.assertEqual(self.league["total"], (230 + 220 + 240 + 225) / 4)


class Nights(unittest.TestCase):
    def setUp(self):
        self.nights = kotc.compute_nights(kotc.player_games(SEASON, TEAMS), LINES)

    def test_leader_runner_up_and_his_teams_spread(self):
        n = self.nights[0]
        self.assertEqual((n["date"], n["games"], n["pra"], n["second"]), ("2026-01-01", 2, 62, 47))
        lead = n["leaders"][0]
        self.assertEqual((lead["name"], lead["total"], lead["spread"]), ("Star A", 230.0, -6.5))  # home: the line as is

    def test_a_tie_keeps_both_and_an_away_team_gets_the_other_side(self):
        n = self.nights[1]
        self.assertEqual(sorted(l["name"] for l in n["leaders"]), ["Star A", "Star C"])
        spreads = {l["name"]: l["spread"] for l in n["leaders"]}
        self.assertEqual(spreads, {"Star A": 3.0, "Star C": -3.0})
        self.assertEqual(n["second"], 39)

    def test_summary_shares(self):
        pg = kotc.player_games(SEASON, TEAMS)
        s = kotc.compute_summary(pg, LINES, self.nights)
        self.assertEqual(s["nights"], 2)
        self.assertEqual(s["ties"], 1)
        for rows in (s["by_total"], s["by_spread"]):
            self.assertAlmostEqual(sum(r["share"] for r in rows), 1, places=2)
            self.assertAlmostEqual(sum(r["fair"] for r in rows), 1, places=2)
        self.assertEqual(s["mean"], round(sum(n["pra"] for n in self.nights) / 2, 1))  # the tile's "Avg winning PRA"
        self.assertEqual(s["favored"], 0.5)  # night 1's leader was favored, night 2's first (Star A, +3) wasn't


class Projection(unittest.TestCase):
    LEAGUE = {"total": 230.0}

    def test_pieces(self):
        # The matchup reads the guard / forward / center group (2026-10-21: five positions replayed worse),
        # so a PG takes the defense's guard number, not its PG one.
        p = {"base": 40.0, "pos": "PG", "grp": "G"}
        opp = {"pos_f": {"PG": 1.5}, "grp_f": {"G": 1.1}}
        w = kotc.WEIGHTS
        self.assertAlmostEqual(kotc.project(p, opp, 230.0, -3, False, self.LEAGUE), 40 * 1.1 ** w["opp"])
        self.assertAlmostEqual(kotc.project(p, None, 253.0, None, False, self.LEAGUE), 40 * 1.1 ** w["total"])
        no_tags = kotc.project(p, None, None, None, False, self.LEAGUE)
        self.assertAlmostEqual(kotc.project(p, None, None, -15, True, self.LEAGUE), no_tags * math.exp(w["blowout"] * 9) * math.exp(w["b2b"]))

    def test_lead_chances_add_up_and_favor_the_bigger_projection(self):
        chances = kotc.lead_chances([45, 40, 30, 20])
        self.assertAlmostEqual(sum(chances), 1, places=6)
        self.assertEqual(chances, sorted(chances, reverse=True))
        self.assertEqual(kotc.lead_chances([]), [])

    def test_this_seasons_average_starts_with_last_seasons(self):
        pg = kotc.player_games(SEASON, TEAMS)
        prior = {"10": {"base": 30.0}}
        alone = kotc.compute_players(pg)["10"]["base"]
        seeded = kotc.compute_players(pg, prior)["10"]["base"]
        self.assertAlmostEqual(seeded, (2 * alone + kotc.PRIOR_GAMES * 30) / (2 + kotc.PRIOR_GAMES), places=1)


class Slate(unittest.TestCase):
    def setUp(self):
        pg = kotc.player_games(SEASON, TEAMS)
        self.block = kotc.season_block(pg, LINES, "2025-26")
        self.games = [
            {"game_id": "9", "date": "2026-01-02", "away": "BBB", "home": "AAA", "home_team_spread": -4.0, "away_team_spread": 4.0, "total_line": 232.0},
            {"game_id": "8", "date": "2026-01-03", "away": "DDD", "home": "AAA", "total_line": None},
        ]

    def test_rows_out_players_and_roster_moves(self):
        old = kotc.MIN_GAMES
        kotc.MIN_GAMES = 1
        try:
            # Star B now plays for AAA; Wing B is on no roster; Big A is Out.
            teams_now = {"10": "AAA", "11": "AAA", "20": "AAA", "21": None, "30": "CCC", "40": "DDD"}
            out = kotc.slate(self.block, self.games, teams_now, {"11"}, ["2026-01-02", "2026-01-03"])
        finally:
            kotc.MIN_GAMES = old
        first = {r["id"]: r for r in out["2026-01-02"]}
        self.assertEqual(set(first), {"10", "11", "20"})
        self.assertEqual(first["20"]["team"], "AAA")
        self.assertTrue(first["11"]["out"])
        self.assertNotIn("lead", first["11"])
        self.assertAlmostEqual(sum(r["lead"] for r in first.values() if not r["out"]), 1, places=3)
        self.assertEqual([r["proj"] for r in out["2026-01-02"]], sorted((r["proj"] for r in out["2026-01-02"]), reverse=True))
        # Night two: AAA played the night before.
        self.assertTrue(all(r["b2b"] for r in out["2026-01-03"] if r["team"] == "AAA"))
        self.assertFalse(any(r["b2b"] for r in out["2026-01-02"]))


class Record(unittest.TestCase):
    def test_a_started_night_is_never_rewritten_and_lines_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = build_nba.KOTC_RECORD_DIR
            build_nba.KOTC_RECORD_DIR = Path(tmp)
            try:
                block = {"players": {"10": {"name": "Star A"}, "20": {"name": "Star B"}}}
                games = [{"game_id": "1", "date": "2026-10-20", "start_utc": "2026-10-20T23:30Z", "lines_locked": False, "total_line": 230.0, "home_team_spread": -2.0},
                         {"game_id": "2", "date": "2026-10-21", "start_utc": "2026-10-21T23:30Z", "lines_locked": False}]
                slate = {"2026-10-20": [{"id": "10", "team": "AAA", "proj": 40.0, "lead": 0.6, "out": False}, {"id": "20", "team": "BBB", "proj": 38.0, "lead": 0.4, "out": False}],
                         "2026-10-21": [{"id": "20", "team": "BBB", "proj": 30.0, "lead": 1.0, "out": False}]}
                before = datetime(2026, 10, 20, 20, 0)
                rec = build_nba.kotc_record(2027, slate, 2026, block, games, before)
                self.assertEqual([b["name"] for b in rec["2026-10-20"]["board"]], ["Star A", "Star B"])
                self.assertEqual(rec["2026-10-20"]["season_used"], "2025-26")
                # After the first tip the night keeps what it had, whatever the new board says.
                slate["2026-10-20"][0]["lead"] = 0.1
                after = datetime(2026, 10, 21, 1, 0)
                rec = build_nba.kotc_record(2027, slate, 2026, block, games, after)
                self.assertEqual(rec["2026-10-20"]["board"][0]["lead"], 0.6)
                saved = json.loads((Path(tmp) / "2027.json").read_text())
                self.assertEqual(saved["2026-10-20"]["board"][0]["lead"], 0.6)

                # This season's lines: saved once a game has locked.
                self.assertEqual(build_nba.kotc_lines(2027, games), {})
                games[0]["lines_locked"] = True
                self.assertEqual(build_nba.kotc_lines(2027, games), {"1": [230.0, -2.0]})
                self.assertTrue((Path(tmp) / "lines_2027.json").exists())
            finally:
                build_nba.KOTC_RECORD_DIR = old

    def test_last_seasons_lines_are_the_saved_file(self):
        lines = build_nba.kotc_lines(2026, [])
        self.assertGreater(len(lines), 1200)
        total, spread = next(iter(lines.values()))
        self.assertTrue(total is None or 180 < total < 280)


if __name__ == "__main__":
    unittest.main()
