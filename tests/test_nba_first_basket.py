"""NBA First Basket (nfl_tool/nba/first_basket.py and site/nba/first-basket.js)
on two hand-made games, so every number can be worked out by hand.

What is pinned: the opening Jumpball's team is the tip winner and its jumper
on that team won it; any first points count (a free throw too) while "first
field goal allowed" is field goals only; possessions to first points; shots
before the game's first points; the league's tip-winner rate; likely starters
are regular starters by minutes (a star who missed games still starts) and
skip players listed Out; the tip chance reads every jump ball and who it was
against, starting from height; the Fair (team chance x his share of his team's
first points, this season only) adds up; the Value record saves before tip and
grades after (at the best price across the books, SmartStake, else Novig);
Best shows the best price across the member's books, opens every book, and a
book's price saves the play to My Plays (and again removes it); the page draws every section
with the build's numbers, colors with no script errors, and is in the NBA menu;
the NBA's lineup file replaces the likely starters (Expected from the build's
copy, Confirmed from the live /api/nba-lineups), names match our players, a
starter we have no numbers for still shows, and the page's fair guess is the
build's for the same five."""
import json
import sys
import unittest
from pathlib import Path

import pandas as pd

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402
import first_basket as fb  # noqa: E402

TEAMS = {"AAA": 1, "BBB": 2}
# AAA: 10 big (jumper), 11 point guard, 12 star; BBB: 20 big (jumper), 21 shooting guard.
POS = {10: "C", 11: "PG", 12: "SF", 20: "C", 21: "SG"}


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
    # BBB's 20 makes the first field goal for BBB at 680. Later a held ball:
    # 10 beats 21 to AAA (a jump ball for the tip rating, not an opening tip).
    + plays(2, [
        ("Jumpball", "BBB", 10, 20, False, False, 720, 0, 0),
        ("Free Throw - 1 of 2", "BBB", 21, None, True, True, 705, 0, 1),
        ("Jump Shot", "AAA", 11, None, True, True, 690, 2, 1),
        ("Dunk", "BBB", 20, None, True, True, 680, 2, 3),
        ("Jumpball", "AAA", 21, 10, False, False, 400, 10, 12),
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
        "athlete_headshot_href": None, "field_goals_attempted": 20 if pid == 12 else 8, "free_throws_attempted": 0,
    } for g, pid, t, s, m in rows])


BLOCK = fb.season_block(PBP, box_rows(), set(TEAMS), "2025-26")
TIP = fb.tip_block(fb.jump_balls(PBP, box_rows()), {})
NOW = BLOCK["players"]  # the tests' "this season" (the Fair reads only this season)


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
        # Five positions (the owner, 2026-10-21: PG and SG are different roles).
        five = lambda **v: {p: v.get(p, 0.0) for p in ("PG", "SG", "SF", "PF", "C")}
        # Against AAA: 21 (SG) in game 1; in game 2 the free throw doesn't count, 20 (C) does.
        self.assertEqual(BLOCK["teams"]["AAA"]["fg_allowed"], five(SG=0.5, C=0.5))
        # Against BBB: 12 (SF), then 11 (PG).
        self.assertEqual(BLOCK["teams"]["BBB"]["fg_allowed"], five(PG=0.5, SF=0.5))
        # And each offense's own first field goals, the other half of a position target.
        self.assertEqual(BLOCK["teams"]["AAA"]["fg_made"], five(PG=0.5, SF=0.5))
        self.assertEqual(BLOCK["teams"]["BBB"]["fg_made"], five(SG=0.5, C=0.5))

    def test_novig_first_basket_prices_lock_at_tip_like_the_lines(self):
        self.assertIn("first_basket", build_nba.LINE_FIELDS)

    def test_starters_shots_before_the_first_points(self):
        p = BLOCK["players"]
        self.assertEqual((p["11"]["shot_early"], p["11"]["first_shot"]), (1, 1))
        self.assertEqual((p["21"]["shot_early"], p["21"]["first_shot"], p["21"]["first_pts"]), (1, 0, 1))
        self.assertEqual(p["12"]["first_pts"], 1)
        self.assertEqual(p["10"]["shot_early"], 0)

    def test_team_share_is_his_own_teams_first_shot_and_points(self):
        # Game 1: AAA's first shot 11, first points 12; BBB's 21 both. Game 2:
        # AAA's 11 both; BBB's first shot is 20's dunk (a free throw isn't a
        # shot), its first points 21's free throw. Counted over his starts.
        p = BLOCK["players"]
        got = {pid: (p[pid]["team_first_shot"], p[pid]["team_first_pts"]) for pid in ("11", "12", "20", "21", "10")}
        self.assertEqual(got, {"11": (2, 1), "12": (0, 1), "20": (1, 0), "21": (1, 2), "10": (0, 0)})

    def test_likely_starters_are_regular_starters_by_minutes(self):
        side = fb.game_side(BLOCK, "AAA", {}, set())
        # 12 started his only game: he starts, ahead of 13 (more starts, fewer minutes).
        self.assertEqual(side["starters"][:3], ["12", "10", "11"])
        self.assertNotIn("14", side["starters"])
        self.assertEqual(side["jumper"], "10")
        out = fb.game_side(BLOCK, "AAA", {}, {"10"})
        self.assertNotIn("10", out["starters"])
        self.assertIsNone(out["jumper"])  # nobody else on AAA has jumped

    def test_every_jump_ball_counts_for_the_tip_rating(self):
        # Two opening tips and the held ball; the side that got the ball won it.
        self.assertEqual(fb.jump_balls(PBP, box_rows()), [(10, 20), (20, 10), (10, 21)])
        self.assertEqual(TIP["record"], {"10": [2, 3], "20": [1, 2], "21": [0, 1]})
        self.assertEqual((BLOCK["players"]["10"]["jumps"], BLOCK["players"]["10"]["tips_won"]), (2, 1))  # Tips Won: opening tips only

    def test_the_tip_rating_counts_who_he_jumped_against(self):
        # The owner's case: the same record against a big and against a guard
        # isn't the same jumper. 9 is a big who beat 7 four times; 8 lost to 7
        # four times. 1 beat the big, 2 beat 8; both lost once to 7.
        jumps = [(9, 7)] * 4 + [(7, 8)] * 4 + [(1, 9), (7, 1), (2, 8), (7, 2)]
        r = fb.tip_ratings(jumps, {})
        self.assertGreater(r["1"], r["2"])
        # Height is the starting point: with no jumps, 4 inches taller wins 65%.
        tip = fb.tip_block([], {"1": 84, "2": 80})
        self.assertAlmostEqual(fb.tip_chance(tip, "2", "1"), 1 / (1 + 2.718281828 ** (-4 * fb.TIP_PER_INCH)), places=4)
        self.assertEqual(fb.tip_chance(tip, "2", None), 0.5)
        self.assertEqual(fb.inches("6' 11\""), 83)

    def test_the_fair_guess_adds_up(self):
        games = [{"game_id": "9", "date": "2026-10-21", "away": "BBB", "home": "AAA"}]
        g = fb.slate(BLOCK, games, {}, set(), ["2026-10-21"], TIP, NOW)["9"]
        f = g["fair"]
        # AAA's 10 won 2 of his 3 jump balls: favored over BBB's 20.
        self.assertAlmostEqual(f["tip_home"], fb.tip_chance(TIP, "20", "10"), places=3)
        self.assertGreater(f["tip_home"], 0.5)
        lead = fb.TIP_WINNER_SCORES
        self.assertAlmostEqual(f["first_home"], f["tip_home"] * lead + (1 - f["tip_home"]) * (1 - lead), places=3)
        total = sum(v["p"] for v in f["players"].values())
        self.assertAlmostEqual(total, 1 - fb.BENCH_SHARE, places=2)
        self.assertEqual(fb.american(0.2), 400)
        self.assertEqual(fb.american(0.6), -150)

    def test_a_starters_share_is_half_shot_volume_half_team_share(self):
        five = ["12", "10", "11", "13"]
        shares = fb.first_shares(NOW, five)
        self.assertAlmostEqual(sum(shares), 1.0, places=6)
        # 12 shoots 20 a start and scored his team's first points in his one start: the most.
        self.assertEqual(max(shares), shares[0])
        # 11 scored AAA's first points once in 4 starts; 10 and 13 never, same volume: equal.
        self.assertGreater(shares[2], shares[1])
        self.assertAlmostEqual(shares[1], shares[3], places=6)
        # No starts this season: an even split.
        self.assertEqual([round(x, 6) for x in fb.first_shares({}, five)], [0.25] * 4)

    def test_best_price_is_the_best_book_else_novig(self):
        book_game = {"props": {"first_basket": {"12": {"q": [["draftkings", "o", None, 900, ""], ["fanduel", "o", None, 1000, ""]]}}}}
        self.assertEqual(fb.best_price(book_game, "12", 700), (1000, "fanduel"))
        self.assertEqual(fb.best_price(book_game, "10", 700), (700, "novig"))
        self.assertEqual(fb.best_price(None, "10", None), (None, None))

    def test_value_and_units(self):
        # Value: our chance at least 10% above Novig's (+450 = 18.2%).
        self.assertFalse(fb.is_value(0.199, 450))
        self.assertTrue(fb.is_value(0.201, 450))
        self.assertFalse(fb.is_value(0.5, None))
        self.assertEqual((fb.units(450, True), fb.units(450, False)), (4.5, -1.0))
        self.assertAlmostEqual(fb.units(-150, True), 2 / 3)

    def test_the_value_record_saves_before_tip_and_grades_after(self):
        import tempfile
        from datetime import datetime
        game = {**GAME, "start_utc": "2026-10-21T23:30Z", "first_basket": {"P12": 5000, "P10": 600}}
        slate_ = fb.slate(BLOCK, [game], {}, set(), ["2026-10-21"], TIP, NOW)
        names = {pid: p["name"] for pid, p in BLOCK["players"].items()}
        before, after = datetime(2026, 10, 21, 18, 0), datetime(2026, 10, 22, 5, 0)
        with tempfile.TemporaryDirectory() as tmp:
            old = build_nba.FB_RECORD_DIR
            build_nba.FB_RECORD_DIR = Path(tmp)
            try:
                books = {"BBB_AAA": {"props": {"first_basket": {"11": {"q": [["fanduel", "o", None, 3000, ""]]}}}}}
                got = build_nba.first_basket_record(2027, slate_, names, [game], {}, before, books)
                saved = json.loads((Path(tmp) / "2027.json").read_text())["9"]
                self.assertEqual(saved["players"]["11"][2:], [3000, True, "fanduel"])  # SmartStake's best
                self.assertEqual(saved["players"]["12"][2], 5000)  # no book has him: Novig
                self.assertTrue(saved["players"]["12"][3])  # +5000 = 2%: Value
                self.assertFalse(saved["players"]["10"][3])
                self.assertEqual(got["plays"], 0)  # not graded yet
                # After tip the prices may move; the saved ones stay, and the game is graded.
                late = {**game, "status": "final", "first_basket": {"P12": 100}}
                # The tip pick is saved too: its chance and both jumpers (road, home).
                self.assertEqual(saved["tip_home"], slate_["9"]["fair"]["tip_home"])
                self.assertEqual(saved["jumpers"], [["20", "P20"], ["10", "P10"]])
                got = build_nba.first_basket_record(2027, slate_, names, [late], {"9": {"first_team": "AAA", "first_scorer": 12, "tip": "BBB"}}, after)
                saved = json.loads((Path(tmp) / "2027.json").read_text())["9"]
                self.assertEqual(saved["players"]["12"][2], 5000)
                self.assertEqual(saved["result"], {"team": "AAA", "scorer": "12", "tip": "BBB"})
                history = got.pop("history")
                self.assertEqual(got, {"plays": 2, "won": 1, "units": 49.0, "games": 1})  # 12 won (+50), 11 lost (-1)
                # The YTD Performance window's row: picks as saved before tip, then what happened.
                self.assertEqual(history, [{"game_id": "9", "date": "2026-10-21", "away": "BBB", "home": "AAA",
                                            "tip_home": saved["tip_home"], "jumpers": saved["jumpers"], "tip": "BBB",
                                            "first_home": saved["first_home"], "first": "AAA", "scorer": ["12", "P12"],
                                            "value": [["11", "P11", 3000, False], ["12", "P12", 5000, True]]}])
                # A game graded before the tip winner was kept gets it on the next build.
                rec = json.loads((Path(tmp) / "2027.json").read_text())
                del rec["9"]["result"]["tip"]
                (Path(tmp) / "2027.json").write_text(json.dumps(rec))
                build_nba.first_basket_record(2027, slate_, names, [late], {"9": {"first_team": "AAA", "first_scorer": 12, "tip": "BBB"}}, after)
                self.assertEqual(json.loads((Path(tmp) / "2027.json").read_text())["9"]["result"]["tip"], "BBB")
            finally:
                build_nba.FB_RECORD_DIR = old


SITE = PAGE = None
# Novig's First Basket "Yes" prices by player name (build_nba.fetch_novig_lines).
GAME = {"game_id": "9", "date": "2026-10-21", "time": "19:30", "away": "BBB", "home": "AAA", "status": "scheduled",
        "first_basket": {"P12": 450, "P10": 600}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": t, "short": t, "logo": "", "color": "336699"} for t in TEAMS}
        SITE.nba = {
            "season": 2027, "season_label": "2026-27", "teams": teams, "schedule": [GAME], "injuries": {}, "kotc": None,
            "first_basket": {
                "default": "2026", "seasons": {"2026": BLOCK, "2027": {**BLOCK, "label": "2026-27"}}, "slates": {"2026": fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"], TIP, NOW)},
                "roster": {"10": ["P10", "AAA", "C"], "11": ["P11", "AAA", "G"]}, "lineups": {}, "fair_weights": fb.fair_weights(), "tip": TIP,
            },
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
        for section in ("fb-matchup", "fb-starters"):
            self.assertTrue(PAGE.inner_text(f"#{section}").strip(), section)

    def test_the_matchup_table_is_the_bare_numbers_side_by_side(self):
        rows = PAGE.evaluate("""() => [...document.querySelectorAll('#fb-matchup tbody tr:not(.fb-m-group)')]
            .map((tr) => [tr.querySelector('.fb-m-label').textContent, tr.children[0].innerText.trim(), tr.children[2].innerText.trim(), !!tr.querySelector('.fb-edge')])""")
        groups = PAGE.evaluate("() => [...document.querySelectorAll('#fb-matchup .fb-m-group')].map((tr) => tr.innerText.trim().toUpperCase())")
        # The Tip's name sits between the team banners: no empty row above the jumpers (the owner, 2026-10-21).
        self.assertEqual(groups, ["SCORES FIRST", "OPENING TRIPS", "FIRST FG ALLOWED"])
        self.assertEqual(PAGE.evaluate("() => document.querySelector('#fb-matchup thead .fb-m-mid').textContent"), "The Tip")
        # The owner's rows, in order (2026-10-20; 2026-10-21: Prediction in under Tips Won, the tip's Home/Road out).
        self.assertEqual([r[0] for r in rows], [
            "Jumper", "Tips Won", "Prediction", "Scores First", "Home/Road", "After Winning Tip", "After Losing Tip",
            "Avg Poss. To Score", "Avg Poss. To Allow", "Point Guards", "Shooting Guards", "Small Forwards", "Power Forwards", "Centers"])
        by = {r[0]: r for r in rows}
        # Road (BBB) left, home (AAA) right; just the number in each cell.
        self.assertEqual(by["Tips Won"][1:3], ["50%", "50%"])
        # Tonight's tip chance adds to 100% and is the fair guess's tip.
        home = round(fb.tip_chance(TIP, "20", "10") * 100)
        self.assertEqual(by["Prediction"][1:3], [f"{100 - home}%", f"{home}%"])
        self.assertEqual(by["Avg Poss. To Score"][1:3], ["1.50", "1.50"])
        self.assertEqual(by["Point Guards"][1:3][0], "50%")  # BBB gave AAA's PG a first FG
        self.assertEqual(by["Shooting Guards"][1:3][1], "50%")  # AAA gave BBB's SG one
        # A level game but for the tip: no other edge pills.
        self.assertEqual([r[0] for r in rows if r[3]], ["Prediction"] if abs(home - 50) >= 10 else [])
        # Every row the same height (the owner: "keep them all consistent").
        heights = PAGE.evaluate("() => [...new Set([...document.querySelectorAll('#fb-matchup tbody tr:not(.fb-m-group)')].map((r) => Math.round(r.getBoundingClientRect().height)))]")
        self.assertEqual(len(heights), 1, heights)

    def test_each_banner_has_the_teams_chance_to_score_first(self):
        built = fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"], TIP, NOW)["9"]["fair"]
        boxes = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .fb-chance b')].map((b) => b.textContent)")
        home = round(built["first_home"] * 100)
        self.assertEqual(boxes, [f"{100 - home}%", f"{home}%"])  # road (BBB) first, home (AAA)

    def test_value_box_and_tags(self):
        # Tonight's Novig prices are short of our Fair: no Value, and no record yet.
        text = PAGE.evaluate("() => document.querySelector('#fb-targets').innerText")
        self.assertIn("No Value In This Game", text)
        self.assertIn("Graded after", text)
        # A long price on the star: Value tag on his row, listed in the box; the record shows.
        got = PAGE.evaluate("""() => { const g = game(); const keep = g.first_basket; g.first_basket = { P12: 5000, P10: 600 };
            FB.record = { plays: 4, won: 1, units: 2.5, games: 3 }; render();
            const out = { box: document.querySelector('#fb-targets').innerText,
              tags: [...document.querySelectorAll('#fb-starters .fb-tag')].map((t) => [t.closest('tr').querySelector('.nba-player span').textContent, t.textContent]) };
            g.first_basket = keep; delete FB.record; render(); return out; }""")
        self.assertIn(["P12", "Value"], got["tags"])
        self.assertNotIn(["P10", "Value"], got["tags"])
        self.assertIn(["P12", "Top Option"], got["tags"])  # 20 shots a start, the most on AAA
        self.assertIn("P12", got["box"])
        self.assertIn("1 of 4", got["box"])
        self.assertIn("+2.5u", got["box"])
        self.assertEqual(SITE.errors, [])

    def test_starters_show_fair_and_novig_best_first(self):
        starters = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .nba-box')[1].querySelectorAll('tbody tr')].map((tr) => [tr.children[0].innerText, tr.children[6].innerText.trim(), tr.children[7].innerText.trim(), tr.children[4].innerText.trim(), tr.children[5].innerText.trim()])")
        heads = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .nba-box')[1].querySelectorAll('th')].map((th) => th.textContent)")
        # Team Share (his own team's first shot / first points) between Scored 1st and Fair (the owner, 2026-10-21).
        self.assertEqual(heads, ["Player", "Shot Early", "1st Shot", "Scored 1st", "Team Share", "Fair", "Best", "1st Shot", "1st Pts"])
        share = {s[0].split("\n")[0]: (s[3].split("\n")[0], s[4].split("\n")[0]) for s in starters}
        self.assertEqual(share["P11"], ("50%", "25%"))  # 2 and 1 of his 4 starts
        names = [s[0].split("\n")[0] for s in starters]
        self.assertEqual(set(names[:3]), {"P12", "P10", "P11"})
        fair = [int(s[1].replace("+", "")) for s in starters]
        self.assertEqual(fair, sorted(fair))  # shortest price (likeliest) first
        novig = {s[0].split("\n")[0]: s[2] for s in starters}
        # No book on file in this test: Best falls back to Novig's own price, labeled.
        self.assertEqual((novig["P12"], novig["P10"], novig["P11"]), ("+450 Novig", "+600 Novig", "--"))
        self.assertTrue(any("JUMPER" in s[0].upper() for s in starters))

    def test_season_buttons(self):
        buttons = PAGE.evaluate("() => [...document.querySelectorAll('#fb-seasons button')].map((b) => [b.textContent, b.disabled])")
        self.assertEqual(buttons, [["2025-26", False], ["2026-27", False]])

    def test_ytd_performance_pill_opens_the_history(self):
        # The owner, 2026-10-21: a "YTD Performance" pill beside the seasons.
        got = PAGE.evaluate("""() => {
            FB.record = { plays: 2, won: 1, units: 3.5, games: 2, history: [
              { game_id: "8", date: "2026-10-21", away: "BBB", home: "AAA", tip_home: 0.7, jumpers: [["20", "P20"], ["10", "P10"]], tip: "AAA",
                first_home: 0.6, first: "BBB", scorer: ["20", "P20"], value: [["12", "P12", 450, true], ["11", "P11", 900, false]] },
              { game_id: "7", date: "2026-10-20", away: "AAA", home: "BBB", tip_home: null, jumpers: null, tip: "BBB",
                first_home: 0.45, first: "AAA", scorer: null, value: [] }] };
            render();
            const pill = document.querySelector('#fb-seasons #fb-ytd');
            const label = pill && pill.textContent;
            pill.click();
            const modal = document.getElementById('fb-ytd-modal');
            const out = { label, open: !modal.hidden,
              tiles: [...modal.querySelectorAll('.fb-ytd-tile')].map((t) => t.innerText.replace(/\\s+/g, ' ').trim()),
              rows: [...modal.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim())) };
            modal.hidden = true; delete FB.record; render(); return out; }""")
        self.assertEqual(got["label"], "YTD Performance")
        self.assertTrue(got["open"])
        # Tip: picked AAA (70%) and AAA won it; the older game had no tip pick saved.
        # Scores First: AAA (60%) but BBB did, then AAA (55% road) and AAA did.
        self.assertEqual(got["tiles"][0], "TIP PREDICTION 1 of 1 100%")
        self.assertEqual(got["tiles"][1], "SCORES FIRST 1 of 2 50%")
        self.assertTrue(got["tiles"][2].startswith("VALUE PLAYS 1 of 2 50%"), got["tiles"][2])
        self.assertIn("+3.5u", got["tiles"][2])
        self.assertEqual(got["rows"][0][2].replace(" ", ""), "P1070%")  # home jumper and his chance
        self.assertEqual(got["rows"][1][2], "--")
        self.assertEqual(got["rows"][1][4].replace(" ", ""), "AAA55%")
        self.assertEqual(SITE.errors, [])

    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/first-basket.html") for h in links), links)


def nba_file(status, rookie=True):
    """The NBA's lineup file for GAME: AAA's five (one a rookie we have no numbers for), BBB's two (too few to use)."""
    names = [("P12", "F"), ("P10", "C"), ("P11", "G"), ("P13", "G")] + ([("Rookie Guy", "SG")] if rookie else [("P14", "G")])
    player = lambda i, n, pos: {"personId": 900 + i, "playerName": n, "position": pos, "lineupStatus": status, "rosterStatus": "Active"}
    return {"games": [{
        "gameId": "x", "awayTeam": {"teamAbbreviation": "BBB", "players": [player(10, "P20", "C"), player(11, "P21", "G")]},
        "homeTeam": {"teamAbbreviation": "AAA", "players": [player(i, n, pos) for i, (n, pos) in enumerate(names)]},
    }]}


SIDES = """() => { const p = plan(); return {
    away: p.away.source, home: p.home.source, starters: p.home.starters.map((id) => player(id).name), jumper: p.home.jumper,
    tags: [...document.querySelectorAll('#fb-starters .fb-lineup')].map((t) => t.textContent),
    fair: p.fair, note: document.getElementById('fb-lineup-note').textContent }; }"""


def use_build_copy(status):
    PAGE.evaluate("(file) => { FB.lineups = { '2026-10-21': { fetched: '2026-10-21T18:00:00Z', ...file } }; return loadLineups('2026-10-21').then(render); }", nba_file(status))


class Lineups(unittest.TestCase):
    def tearDown(self):
        PAGE.unroute("**/api/nba-lineups*")
        PAGE.evaluate("() => { for (const k in LINEUPS) delete LINEUPS[k]; FB.lineups = {}; render(); }")

    def test_without_an_nba_lineup_the_page_uses_the_builds_guess_and_its_fair_prices(self):
        got = PAGE.evaluate(SIDES)
        self.assertEqual((got["away"], got["home"], got["tags"]), ("guess", "guess", ["Our guess", "Our guess"]))
        built = fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"], TIP, NOW)["9"]["fair"]
        self.assertAlmostEqual(got["fair"]["tip_home"], built["tip_home"], places=3)
        self.assertAlmostEqual(got["fair"]["first_home"], built["first_home"], places=3)
        for pid, v in built["players"].items():
            self.assertAlmostEqual(got["fair"]["players"][pid]["p"], v["p"], places=3)
            self.assertEqual(got["fair"]["players"][pid]["fair"], v["fair"])

    def test_the_builds_copy_of_the_nba_file_gives_the_expected_five(self):
        use_build_copy("Expected")
        got = PAGE.evaluate(SIDES)
        self.assertEqual((got["away"], got["home"]), ("guess", "expected"))  # BBB's two names aren't a five
        self.assertEqual(got["starters"], ["P12", "P10", "P11", "P13", "Rookie Guy"])
        self.assertEqual(got["jumper"], "10")
        self.assertIn("Expected", got["tags"])
        self.assertIn("as of the last site update", got["note"])
        home = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .nba-box')][1].innerText")
        self.assertIn("Rookie Guy", home)
        self.assertIn("NEW", home.upper())
        five = PAGE.evaluate("() => plan().home.starters")
        total = sum(got["fair"]["players"][pid]["p"] for pid in five)
        self.assertAlmostEqual(total, got["fair"]["first_home"] * (1 - fb.BENCH_SHARE), places=3)
        self.assertEqual(SITE.errors, [])

    def test_the_live_file_wins_and_shows_confirmed(self):
        body = json.dumps({"fetched": "2026-10-21T23:05:00Z", **nba_file("Confirmed", rookie=False)})
        PAGE.route("**/api/nba-lineups*", lambda r: r.fulfill(status=200, content_type="application/json", body=body))
        use_build_copy("Expected")
        got = PAGE.evaluate(SIDES)
        self.assertEqual(got["home"], "confirmed")
        self.assertIn("Confirmed", got["tags"])
        self.assertEqual(got["starters"][-1], "P14")
        self.assertIn("every minute", got["note"])


if __name__ == "__main__":
    unittest.main()


BOOKS = {"BBB_AAA": {"kickoff": "2026-10-21T23:30Z", "props": {"first_basket": {
    "12": {"name": "P12", "q": [["draftkings", "o", None, 500, "https://dk.test/x"], ["fanduel", "o", None, 600, "https://fd.test/x"]]}}}, "td": {}, "lines": {}}}


class Best(unittest.TestCase):
    """Best (the owner, 2026-10-21: "relabel NOVIG to BEST and when clicked it brings up a modal
    screen where users can add plays to their my plays by clicking one of the odds")."""

    def setUp(self):
        PAGE.evaluate("(books) => { DATA.book_odds = books; localStorage.removeItem('nfl-tool.nba-plays.v1'); render(); }", BOOKS)

    def tearDown(self):
        PAGE.evaluate("() => { DATA.book_odds = {}; localStorage.removeItem('nfl-tool.nba-plays.v1'); const m = document.getElementById('book-odds-modal'); if (m) m.hidden = true; render(); }")

    def best_cells(self):
        return PAGE.evaluate("() => Object.fromEntries([...document.querySelectorAll('#fb-starters tbody tr')].map((tr) => [tr.querySelector('.nba-player span').textContent, tr.querySelector('.fb-best').innerText.trim()]))")

    def test_best_is_the_best_book_else_novig(self):
        cells = self.best_cells()
        self.assertTrue(cells["P12"].startswith("+600"), cells["P12"])  # FanDuel beats DraftKings
        self.assertIn("FanDuel", cells["P12"])
        self.assertTrue(cells["P10"].startswith("+600") and "Novig" in cells["P10"], cells["P10"])  # no book lists him
        self.assertEqual(cells["P11"], "--")

    def test_a_books_price_saves_the_play_and_again_removes_it(self):
        PAGE.click("#fb-starters .fb-best .bo-pill")
        PAGE.wait_for_selector("#book-odds-modal:not([hidden]) .bo-save")
        modal = PAGE.inner_text("#book-odds-modal")
        self.assertIn("P12 FIRST BASKET", modal.upper())
        self.assertIn("Click a price to save it", modal)
        self.assertNotIn("Under", modal)  # a yes-only market: no other side
        PAGE.click("#book-odds-modal .bo-save >> nth=1")  # DraftKings +500 (second best)
        plays = PAGE.evaluate("() => loadNbaPlays()")
        self.assertEqual(len(plays), 1)
        p = plays[0]
        self.assertEqual((p["sport"], p["market"], p["category"], p["player_id"], p["book"], p["odds"], p["game_id"], p["team"]),
                         ("nba", "first_basket", "First Basket", "12", "draftkings", 500, "9", "AAA"))
        self.assertEqual(p["description"], "P12 first basket")
        self.assertIn("Saved to My Plays at", PAGE.inner_text("#book-odds-modal"))
        self.assertIn("\u2713", self.best_cells()["P12"])  # the row shows it's saved
        # Another price switches it; the same price again removes it.
        PAGE.click("#book-odds-modal .bo-save >> nth=0")
        self.assertEqual([(x["book"], x["odds"]) for x in PAGE.evaluate("() => loadNbaPlays()")], [("fanduel", 600)])
        PAGE.click("#book-odds-modal .bo-save >> nth=0")
        self.assertEqual(PAGE.evaluate("() => loadNbaPlays()"), [])
        self.assertEqual(SITE.errors, [])

    def test_the_layout_starters_left_matchup_and_value_right_level(self):
        boxes = PAGE.evaluate("""() => Object.fromEntries(['.fb-mid', '.fb-left', '.fb-right'].map((s) => {
            const r = document.querySelector(s).getBoundingClientRect(); return [s, [Math.round(r.left), Math.round(r.top), Math.round(r.bottom), Math.round(r.width)]]; }))""")
        starters, matchup, value = boxes[".fb-mid"], boxes[".fb-left"], boxes[".fb-right"]
        self.assertLess(starters[0], matchup[0])  # Starters on the left
        self.assertEqual(matchup[0], value[0])  # Value under The Matchup
        self.assertEqual(matchup[3], value[3])  # the same width
        self.assertLess(matchup[2], value[1])
        self.assertEqual(starters[1], matchup[1])  # tops level
        self.assertEqual(starters[2], value[2])  # bottoms level

