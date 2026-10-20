"""NBA First Basket (nfl_tool/nba/first_basket.py and site/nba/first-basket.js)
on two hand-made games, so every number can be worked out by hand.

What is pinned: the opening Jumpball's team is the tip winner and its jumper
on that team won it; any first points count (a free throw too) while "first
field goal allowed" is field goals only; possessions to first points; shots
before the game's first points; the league's tip-winner rate; likely starters
are regular starters by minutes (a star who missed games still starts) and
skip players listed Out; the fair guess adds up; the page draws every section
with the build's numbers, colors with no script errors, and is in the NBA menu."""
import sys
import unittest
from pathlib import Path

import pandas as pd

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import first_basket as fb  # noqa: E402

TEAMS = {"AAA": 1, "BBB": 2}
# AAA: 10 big (jumper), 11 guard, 12 star; BBB: 20 big (jumper), 21 guard.
POS = {10: "C", 11: "G", 12: "F", 20: "C", 21: "G"}


def plays(game, rows):
    """rows: (type, team, athlete 1, athlete 2, shooting, scoring, seconds left, home score, away score)."""
    out = []
    for i, (kind, team, a1, a2, shot, score, left, hs, aw) in enumerate(rows):
        out.append({
            "game_id": game, "sequence_number": i, "season_type": 2, "period_number": 1, "type_text": kind,
            "team_id": TEAMS[team], "athlete_id_1": a1, "athlete_id_2": a2, "shooting_play": shot, "scoring_play": score,
            "start_quarter_seconds_remaining": left, "home_score": hs, "away_score": aw,
            "home_team_abbrev": "AAA", "away_team_abbrev": "BBB", "home_team_id": 1, "away_team_id": 2,
        })
    return out


PBP = pd.DataFrame(
    # Game 1 (AAA home): 10 beats 20 to AAA. 11 misses, BBB rebounds, 21 misses,
    # AAA rebounds, 12 scores a layup at 690 (AAA's 2nd trip). BBB: 21 scores at 670.
    plays(1, [
        ("Jumpball", "AAA", 10, 20, False, False, 720, 0, 0),
        ("Jump Shot", "AAA", 11, None, True, False, 712, 0, 0),
        ("Defensive Rebound", "BBB", 20, None, False, False, 710, 0, 0),
        ("Jump Shot", "BBB", 21, None, True, False, 700, 0, 0),
        ("Defensive Rebound", "AAA", 10, None, False, False, 698, 0, 0),
        ("Layup Shot", "AAA", 12, None, True, True, 690, 2, 0),
        ("Jump Shot", "BBB", 21, None, True, True, 670, 2, 3),
        ("End Period", "AAA", None, None, False, False, 0, 30, 25),
    ])
    # Game 2 (AAA home again): 20 beats 10 to BBB. 21 is fouled and makes a free
    # throw at 705 (first points, not a field goal); AAA's 11 scores at 690;
    # BBB's 20 makes the first field goal for BBB at 680.
    + plays(2, [
        ("Jumpball", "BBB", 10, 20, False, False, 720, 0, 0),
        ("Free Throw - 1 of 2", "BBB", 21, None, True, True, 705, 0, 1),
        ("Jump Shot", "AAA", 11, None, True, True, 690, 2, 1),
        ("Dunk", "BBB", 20, None, True, True, 680, 2, 3),
        ("End Period", "AAA", None, None, False, False, 0, 20, 28),
    ])
)


def box_rows():
    rows = []
    for game in (1, 2, 3, 4):
        for pid, team in ((10, "AAA"), (11, "AAA"), (20, "BBB"), (21, "BBB")):
            rows.append((game, pid, team, True, 30))
        rows.append((game, 13, "AAA", True, 12))  # starts every game, few minutes
    rows.append((1, 12, "AAA", True, 36))  # the star: 1 game, started it, big minutes
    rows.append((2, 14, "AAA", False, 25))  # a bench player
    return pd.DataFrame([{
        "game_id": g, "athlete_id": pid, "team_abbreviation": t, "starter": s, "minutes": m, "season_type": 2,
        "game_date": f"2026-01-0{g}", "athlete_display_name": f"P{pid}", "athlete_position_abbreviation": POS.get(pid, "G"),
        "athlete_headshot_href": None,
    } for g, pid, t, s, m in rows])


BLOCK = fb.season_block(PBP, box_rows(), set(TEAMS), "2025-26")


class Build(unittest.TestCase):
    def test_the_tip_and_first_points(self):
        a, b = BLOCK["teams"]["AAA"], BLOCK["teams"]["BBB"]
        self.assertEqual((a["tip"], a["first"], a["first_won_tip"], a["first_lost_tip"]), (0.5, 0.5, 1.0, 0.0))
        self.assertEqual((a["tip_home"], b["tip_away"], a["first_home"]), (0.5, 0.5, 0.5))
        p10, p20 = BLOCK["players"]["10"], BLOCK["players"]["20"]
        self.assertEqual((p10["jumps"], p10["tips_won"], p20["tips_won"]), (2, 1, 1))
        # Game 1's tip winner scored first, game 2's too (with a free throw).
        self.assertEqual(BLOCK["league"]["first_won_tip"], 1.0)
        self.assertEqual(BLOCK["league"]["free_throw_first"], 0.5)

    def test_possessions_and_seconds_to_first_points(self):
        a, b = BLOCK["teams"]["AAA"], BLOCK["teams"]["BBB"]
        # AAA: 2nd trip in game 1 (30 s), 1st trip in game 2 (30 s).
        self.assertEqual((a["poss"], a["secs"]), (1.5, 30))
        # BBB: 2nd trip in game 1 (50 s), 1st trip in game 2 (15 s).
        self.assertEqual((b["poss"], b["secs"]), (1.5, 32))
        self.assertEqual((a["opp_poss"], a["opp_secs"]), (b["poss"], b["secs"]))
        self.assertEqual((a["q1_margin"], b["q1_margin"]), (-1.5, 1.5))

    def test_first_field_goal_allowed_is_field_goals_only(self):
        # Against AAA: 21 (G) in game 1; in game 2 the free throw doesn't count, 20 (C) does.
        self.assertEqual(BLOCK["teams"]["AAA"]["fg_allowed"], {"G": 0.5, "F": 0.0, "C": 0.5})
        # Against BBB: 12 (F), then 11 (G).
        self.assertEqual(BLOCK["teams"]["BBB"]["fg_allowed"], {"G": 0.5, "F": 0.5, "C": 0.0})

    def test_starters_shots_before_the_first_points(self):
        p = BLOCK["players"]
        self.assertEqual((p["11"]["shot_early"], p["11"]["first_shot"]), (1, 1))
        self.assertEqual((p["21"]["shot_early"], p["21"]["first_shot"], p["21"]["first_pts"]), (1, 0, 1))
        self.assertEqual(p["12"]["first_pts"], 1)
        self.assertEqual(p["10"]["shot_early"], 0)

    def test_likely_starters_are_regular_starters_by_minutes(self):
        side = fb.game_side(BLOCK, "AAA", {}, set())
        # 12 started his only game: he starts, ahead of 13 (more starts, fewer minutes).
        self.assertEqual(side["starters"][:3], ["12", "10", "11"])
        self.assertNotIn("14", side["starters"])
        self.assertEqual(side["jumper"], "10")
        out = fb.game_side(BLOCK, "AAA", {}, {"10"})
        self.assertNotIn("10", out["starters"])
        self.assertIsNone(out["jumper"])  # nobody else on AAA has jumped

    def test_the_fair_guess_adds_up(self):
        games = [{"game_id": "9", "date": "2026-10-21", "away": "BBB", "home": "AAA"}]
        g = fb.slate(BLOCK, games, {}, set(), ["2026-10-21"])["9"]
        f = g["fair"]
        self.assertAlmostEqual(f["tip_home"], 0.5, places=3)
        self.assertAlmostEqual(f["first_home"], 0.5, places=3)
        total = sum(v["p"] for v in f["players"].values())
        self.assertAlmostEqual(total, 1 - fb.BENCH_SHARE, places=2)
        self.assertEqual(fb.american(0.2), 400)
        self.assertEqual(fb.american(0.6), -150)


SITE = PAGE = None
GAME = {"game_id": "9", "date": "2026-10-21", "time": "19:30", "away": "BBB", "home": "AAA", "status": "scheduled"}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in TEAMS}
        SITE.nba = {
            "season": 2027, "season_label": "2026-27", "teams": teams, "schedule": [GAME], "injuries": {}, "kotc": None,
            "first_basket": {"default": "2026", "seasons": {"2026": BLOCK}, "slates": {"2026": fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"])}},
        }
        PAGE = SITE.open("nba/first-basket.html")
        PAGE.wait_for_function("() => FB && !document.getElementById('fb-game').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Page(unittest.TestCase):
    def test_every_section_draws_with_no_script_errors(self):
        self.assertEqual(SITE.errors, [])
        for section in ("fb-tip", "fb-first", "fb-trips", "fb-pos", "fb-starters", "fb-fair"):
            self.assertTrue(PAGE.inner_text(f"#{section}").strip(), section)

    def test_shows_the_builds_numbers(self):
        tip = PAGE.inner_text("#fb-tip")
        self.assertIn("1 of 2", tip)
        self.assertIn("50%", tip)
        starters = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .nba-box')[1].querySelectorAll('tbody tr')].map((tr) => tr.children[0].innerText)")
        self.assertTrue(starters[0].startswith("P12"))
        self.assertIn("JUMPER", starters[1].upper())
        trips = PAGE.inner_text("#fb-trips")
        self.assertIn("1.50", trips)

    def test_season_buttons(self):
        buttons = PAGE.evaluate("() => [...document.querySelectorAll('#fb-seasons button')].map((b) => [b.textContent, b.disabled])")
        self.assertEqual(buttons, [["2025-26", False], ["2026-27", True]])

    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/first-basket.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
