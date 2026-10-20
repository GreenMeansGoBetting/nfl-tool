"""NBA First Basket (nfl_tool/nba/first_basket.py and site/nba/first-basket.js)
on two hand-made games, so every number can be worked out by hand.

What is pinned: the opening Jumpball's team is the tip winner and its jumper
on that team won it; any first points count (a free throw too) while "first
field goal allowed" is field goals only; possessions to first points; shots
before the game's first points; the league's tip-winner rate; likely starters
are regular starters by minutes (a star who missed games still starts) and
skip players listed Out; the fair guess adds up; the page draws every section
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
            "first_basket": {
                "default": "2026", "seasons": {"2026": BLOCK}, "slates": {"2026": fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"])},
                "roster": {"10": ["P10", "AAA", "C"], "11": ["P11", "AAA", "G"]}, "lineups": {}, "fair_weights": fb.fair_weights(),
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

    def test_the_matchup_table_stacks_both_teams_side_by_side(self):
        rows = PAGE.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#fb-matchup tbody tr:not(.fb-m-group)')]
            .map((tr) => [tr.querySelector('.fb-m-label').firstChild.textContent, [tr.children[0].innerText, tr.children[2].innerText, !!tr.querySelector('.fb-edge')]]))""")
        groups = PAGE.evaluate("() => [...document.querySelectorAll('#fb-matchup .fb-m-group')].map((tr) => tr.innerText.trim().toUpperCase())")
        self.assertEqual(groups, ["THE TIP", "SCORING FIRST", "OPENING TRIPS", "FIRST FG ALLOWED"])
        # Road (BBB) left, home (AAA) right.
        self.assertEqual(["".join(v.split()) for v in rows["Jumper's tips won"][:2]], ["50%1of2", "50%1of2"])
        # Every row the same height (the owner: "keep them all consistent").
        heights = PAGE.evaluate("() => [...new Set([...document.querySelectorAll('#fb-matchup tbody tr:not(.fb-m-group)')].map((r) => Math.round(r.getBoundingClientRect().height)))]")
        self.assertEqual(len(heights), 1, heights)
        self.assertEqual(rows["Trips to its first points"][:2], ["1.50", "1.50"])
        self.assertFalse(rows["Trips to its first points"][2])  # level: no edge
        # AAA scored first after winning the tip (100%), BBB too: no edge; AAA's 1st quarter -1.5 vs +1.5: BBB's edge.
        self.assertTrue(rows["1st quarter margin"][2])
        edge = PAGE.evaluate("() => [...document.querySelectorAll('#fb-matchup .fb-edge')].map((e) => e.title)")
        self.assertIn("Edge: BBB", edge)

    def test_starters_show_the_fair_price_best_first(self):
        starters = PAGE.evaluate("() => [...document.querySelectorAll('#fb-starters .nba-box')[1].querySelectorAll('tbody tr')].map((tr) => [tr.children[0].innerText, tr.children[4].innerText])")
        names = [s[0].split("\n")[0] for s in starters]
        self.assertEqual(set(names[:3]), {"P12", "P10", "P11"})
        prices = [float(s[1].split("\n")[1].rstrip("%")) for s in starters]
        self.assertEqual(prices, sorted(prices, reverse=True))
        self.assertTrue(any("JUMPER" in s[0].upper() for s in starters))

    def test_season_buttons(self):
        buttons = PAGE.evaluate("() => [...document.querySelectorAll('#fb-seasons button')].map((b) => [b.textContent, b.disabled])")
        self.assertEqual(buttons, [["2025-26", False], ["2026-27", True]])

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
        built = fb.slate(BLOCK, [GAME], {}, set(), ["2026-10-21"])["9"]["fair"]
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
