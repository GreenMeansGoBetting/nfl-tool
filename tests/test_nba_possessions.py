"""The NBA engine (nfl_tool/nba/possessions.py): play-by-play rebuilt into
possessions with the ten players on the floor.

Two real 2025-26 games (tests/fixtures/nba_*_games.csv.gz) pin that the
rebuild matches the box score: every player's minutes, both final scores,
ten players on the floor for every action. Both had ESPN data problems:
401810560 (MIA v CHI) tags some Bulls baskets with the wrong team, and
401810150 has a Bulls player with no id in the box score (the engine once
had only four Bulls on the floor and gave CHI 9 points too many).

A small hand-made game pins the rules: a defensive rebound starts a "miss"
possession, a steal a "steal" one, a make a "make" one; an offensive rebound
keeps the possession; a technical free throw scores but changes nothing; a
player who plays a whole quarter without showing up is found from the box
score; shot zones and kinds."""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import possessions as P  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


class RealGames(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.season = P.Season(pd.read_csv(FIX / "nba_pbp_games.csv.gz"), pd.read_csv(FIX / "nba_box_games.csv.gz"))

    def test_both_games_are_rebuilt(self):
        self.assertEqual(sorted(self.season.possessions["game_id"].unique()), [401810150, 401810560])
        self.assertEqual(self.season.problems, [])

    def test_every_players_minutes_match_the_box_score(self):
        pl = self.season.check[self.season.check["player"].notna()]
        off = (pl["rebuilt"] - pl["box"]).abs()
        self.assertLessEqual(off.max(), 1.0, pl[off > 1.0])

    def test_final_scores_match_even_with_espns_wrong_team_tags(self):
        tm = self.season.check[self.season.check["player"].isna()]
        got = {(int(g), int(t)): r for g, t, r in zip(tm["game_id"], tm["team"], tm["rebuilt"])}
        self.assertEqual(got, {(401810150, 4): 101, (401810150, 11): 103, (401810560, 4): 91, (401810560, 14): 134})
        pts = self.season.possessions.groupby(["game_id", "off"])["pts"].sum().to_dict()
        self.assertEqual(pts[(401810560, 4)], 91)
        self.assertEqual(pts[(401810560, 14)], 134)

    def test_ten_on_the_floor_for_every_action(self):
        a = self.season.actions
        self.assertTrue((a["with"].map(len) == 5).all())
        self.assertTrue((a["against"].map(len) == 5).all())

    def test_the_two_teams_have_about_the_same_possessions(self):
        n = self.season.possessions.groupby(["game_id", "off"]).size()
        by_game = n.groupby(level=0)
        self.assertTrue(((by_game.max() - by_game.min()) <= 3).all(), n)
        self.assertTrue(((n > 85) & (n < 115)).all(), n)


# ---- a hand-made game: home 1 (players 11-16) v away 2 (players 21-25) ----
def ev(period, clock, type_text, team, a1=None, a2=None, text="", made=False, value=0, pts=0, x=0, y=0, score=None):
    return {"period_number": period, "clock_minutes": clock // 60, "clock_seconds": clock % 60, "type_text": type_text,
            "text": text, "team_id": team, "athlete_id_1": a1, "athlete_id_2": a2, "athlete_id_3": None,
            "shooting_play": pts > 0, "scoring_play": made, "score_value": value, "points_attempted": pts,
            "coordinate_x": x, "coordinate_y": y, "score": score}


def game(events):
    rows, home, away = [], 0, 0
    for i, e in enumerate(events):
        h, a = e.pop("score") or (home, away)
        home, away = h, a
        rows.append({**e, "game_id": 9, "game_play_number": i + 1, "season_type": 2, "home_score": home,
                     "away_score": away, "home_team_id": 1, "away_team_id": 2})
    return pd.DataFrame(rows)


def box(minutes):
    return pd.DataFrame([{"game_id": 9, "season_type": 2, "athlete_id": pid, "athlete_display_name": f"P{pid}",
                          "team_id": 1 if pid < 20 else 2, "minutes": m, "points": 0, "did_not_play": False,
                          "team_score": 0, "home_away": "home" if pid < 20 else "away"} for pid, m in minutes.items()])


# Quarter 1 (12:00 = 720 seconds left):
#   home 11 makes a 2 (11:50) -> away ball after a make
#   away 21 misses a corner 3, home 12 defensive rebound (11:30) -> home "miss" possession
#   home 13 misses, home 14 offensive rebound, home 14 makes (11:20) -> one possession, 2 points
#   away 22 bad pass, home 15 steals (11:00) -> home "steal" possession
#   home 15 makes a layup (10:57), 3 seconds in
#   technical foul on away 25; home 11 makes the technical free throw (10:50): +1, no new possession
#   sub: 16 in for 11 (10:50)
#   away 23 makes a step-back 3 (10:30)
#   home 13 throws it out of bounds (10:15) -> away "dead_to" possession
#   away 24 misses, home 13 rebounds; home 12 misses, away 21 rebounds
# Player 25 (away) never shows up but is on the floor all game; the box score gives him 12 minutes.
EVENTS = [
    ev(1, 710, "Jump Shot", 1, 11, text="P11 makes 12-foot jumper", made=True, value=2, pts=2, x=30, score=(2, 0)),
    ev(1, 695, "Jump Shot", 2, 21, text="P21 misses 22-foot three point jumper", pts=3, x=-39, y=22),
    ev(1, 690, "Defensive Rebound", 1, 12),
    ev(1, 685, "Jump Shot", 1, 13, text="P13 misses 18-foot jumper", pts=2, x=24),
    ev(1, 683, "Offensive Rebound", 1, 14),
    ev(1, 680, "Tip Shot", 1, 14, text="P14 makes tip shot", made=True, value=2, pts=2, x=41, score=(4, 0)),
    ev(1, 660, "Bad Pass\nTurnover", 2, 22, 15, text="P22 bad pass (P15 steals)"),
    ev(1, 657, "Driving Layup Shot", 1, 15, text="P15 makes driving layup", made=True, value=2, pts=2, x=40, score=(6, 0)),
    ev(1, 650, "Technical Foul", 2, 25),
    ev(1, 650, "Free Throw - Technical", 1, 11, text="P11 makes technical free throw", made=True, value=1, score=(7, 0)),
    ev(1, 650, "Substitution", 1, 16, 11, text="P16 enters the game for P11"),
    ev(1, 630, "Step Back Jump Shot", 2, 23, text="P23 makes 26-foot step back jumpshot", made=True, value=3, pts=3,
       x=-20, y=5, score=(7, 3)),
    ev(1, 615, "Out of Bounds - Bad Pass Turnover", 1, 13, text="P13 out of bounds bad pass turnover"),
    ev(1, 600, "Jump Shot", 2, 24, text="P24 misses 15-foot jumper", pts=2, x=-30),
    ev(1, 598, "Defensive Rebound", 1, 13),
    ev(1, 590, "Jump Shot", 1, 12, text="P12 misses 25-foot three point jumper", pts=3, x=17),
    ev(1, 588, "Defensive Rebound", 2, 21),
    ev(1, 0, "End Period", None),
]
MINUTES = {11: 1.2, 12: 12, 13: 12, 14: 12, 15: 12, 16: 10.8, 21: 12, 22: 12, 23: 12, 24: 12, 25: 12}


class HandMadeGame(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.season = P.Season(game([dict(e) for e in EVENTS]), box(MINUTES))
        cls.poss = cls.season.possessions

    def test_how_each_possession_started(self):
        self.assertEqual(list(zip(self.poss["off"], self.poss["start"])),
                         [(1, "period"), (2, "make"), (1, "miss"), (2, "make"), (1, "steal"), (2, "make"),
                          (1, "make"), (2, "dead_to"), (1, "miss"), (2, "miss")])

    def test_an_offensive_rebound_keeps_the_possession(self):
        third = self.poss.iloc[2]
        self.assertEqual((third["fga"], third["oreb"], third["pts"]), (2, 1, 2))

    def test_a_technical_free_throw_scores_but_changes_nothing(self):
        steal = self.poss.iloc[4]
        self.assertEqual(steal["pts"], 3)  # the layup + the technical free throw
        self.assertEqual(steal["first_secs"], 3.0)
        self.assertEqual(len(self.poss), 10)

    def test_a_player_who_never_shows_up_is_found_from_the_box_score(self):
        self.assertEqual(self.season.problems, [])
        self.assertEqual(sorted(self.poss.iloc[1][list(P.TEAM_COLS)]), [21, 22, 23, 24, 25])
        pl = self.season.check[self.season.check["player"].notna()]
        off = (pl["rebuilt"] - pl["box"]).abs()
        self.assertLess(off.max(), 0.05, pl)

    def test_a_sub_changes_the_five_from_then_on(self):
        last_home = self.poss[self.poss["off"] == 1].iloc[-1]
        self.assertEqual(sorted(last_home[list(P.TEAM_COLS)]), [12, 13, 14, 15, 16])

    def test_shots_carry_zone_kind_and_steals(self):
        a = self.season.actions
        shots = a[a["kind"] == "shot"].set_index("player")
        self.assertEqual(shots.loc[21, "zone"], "corner3")
        self.assertEqual(shots.loc[23, "zone"], "above3")
        self.assertEqual(shots.loc[23, "kind2"], "stepback")
        self.assertEqual(shots.loc[14, "kind2"], "putback")
        self.assertEqual(shots.loc[14, "zone"], "rim")
        self.assertEqual(a[a["kind"] == "to"].iloc[0]["steal"], 15)


class ShotNames(unittest.TestCase):
    def test_shot_kinds(self):
        for name, kind in [("Jump Shot", "catch"), ("Pullup Jump Shot", "pullup"), ("Step Back Jump Shot", "stepback"),
                           ("Turnaround Fade Away Jump Shot", "fade"), ("Cutting Dunk Shot", "cut"),
                           ("Driving Layup Shot", "drive"), ("Alley Oop Dunk Shot", "lob"), ("Layup Shot Putback", "putback"),
                           ("Turnaround Hook Shot", "post"), ("Driving Floating Jump Shot", "floater")]:
            self.assertEqual(P.shot_kind(name), kind, name)


if __name__ == "__main__":
    unittest.main()
