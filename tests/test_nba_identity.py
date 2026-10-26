"""NBA Team Identity (nfl_tool/nba/identity.py, its part of build_nba.py and
site/nba/identity.js).

What is pinned: on the engine's hand-made game every number is worked out by
hand, and one team's offense equals the other team's defense (both sides are
the same possessions); the build opens on last season until the middle team
has THIS_SEASON_DEFAULT_AT games (the owner's rule: plays and projections
come from this season, last season is reference); last season's saved file
has every number the page reads; the page draws both teams and both matchup
boxes with no script errors, its two-sided tags, its season buttons, and its
place in the NBA menu."""
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
from site_browser import SiteBrowser  # noqa: E402
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
        js = (ROOT / "nfl_tool" / "site" / "nba" / "identity.js").read_text(encoding="utf-8")
        for row in REFERENCE["teams"].values():
            for side in ("off", "def"):
                for key in ("ppp", "pace", "trans_ppp", "rim_share", "rim_pct", "corner3_share", "self_made", "tov_rate", "oreb_rate"):
                    self.assertIsNotNone(row.get(f"{side}_{key}"), f"{side}_{key}")
        for key in ("pace", "poss_secs", "trans_freq", "half_ppp", "assisted", "catch", "steal_share", "fta_rate"):
            self.assertIn(f'"{key}"', js)
        # the league's possessions a game and corner-3 share, as the engine measured them
        self.assertAlmostEqual(REFERENCE["league"]["off_pace"]["avg"], 99, delta=1.5)
        self.assertAlmostEqual(REFERENCE["league"]["off_corner3_share"]["avg"], 0.105, delta=0.01)


GAME = {"game_id": "9", "date": "2026-10-21", "time": "19:30", "away": "BOS", "home": "DET", "status": "scheduled"}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": n, "short": t, "logo": "", "color": c} for t, n, c in (("BOS", "Boston Celtics", "007a33"), ("DET", "Detroit Pistons", "c8102e"))}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": [GAME], "injuries": {}, "kotc": None,
                    "first_basket": None, "identity": {"default": "2026", "seasons": {"2026": REFERENCE}}}
        PAGE = SITE.open("nba/identity.html")
        PAGE.wait_for_function("() => ID && !document.getElementById('id-game').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def row(box_index, label):
    return PAGE.evaluate("""([i, label]) => {
        const tr = [...document.querySelectorAll('#id-matchups .nba-box')[i].querySelectorAll('.id-main tbody tr')]
            .find((r) => r.children[0].innerText.trim() === label);
        return tr ? [...tr.children].map((td) => td.innerText.trim()) : null;
    }""", [box_index, label])


class Page(unittest.TestCase):
    def test_both_teams_and_both_matchups_draw_with_no_script_errors(self):
        self.assertEqual(SITE.errors, [])
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('#id-teams .nba-box').length"), 2)
        titles = PAGE.evaluate("() => [...document.querySelectorAll('#id-matchups .nba-box-title')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim())")
        self.assertEqual(titles, ["BOS offense vs DET defense", "DET offense vs BOS defense"])
        cells = PAGE.evaluate("() => [...document.querySelectorAll('#id-matchups td.num')].map((td) => td.innerText.trim())")
        self.assertNotIn("--", cells)

    def test_rows_read_both_sides(self):
        # 2025-26: Boston took 46.9% of its shots as 3s and Detroit allowed 43.4% (both a lot: Fits)
        self.assertEqual(row(0, "Shots that are 3s"), ["Shots that are 3s", "46.9%", "43.4%", "FITS"])
        ppp = row(0, "Points / possession")
        self.assertEqual(ppp[1:3], ["1.21", "1.10"])
        # how often a team does something is never colored good or bad
        plain = PAGE.evaluate("""() => [...document.querySelectorAll('#id-matchups .id-main tbody tr')]
            .filter((r) => r.children[0].innerText.trim() === 'Possessions / 48')
            .map((r) => r.children[1].className)""")
        self.assertTrue(all("tier-" not in c for c in plain), plain)

    def test_matchup_extremes(self):
        # BOS vs DET: Detroit is a turnover-prone team (2025-26), so that row has a Tonight
        # tag, tonight's types lead the group; each number = BOS's split minus the league's.
        rows = PAGE.evaluate("""() => [...document.querySelectorAll('#id-extremes .nba-box')[0].querySelectorAll('tbody tr')]
            .map((r) => [...r.children].map((td) => td.innerText.trim()))""")
        self.assertTrue(rows[0][0].upper().startswith("FACING OFFENSES"), rows[0])
        group = rows[1:next(i for i, r in enumerate(rows) if r[0].upper().startswith("FACING DEFENSES"))]
        tonight = [r[0].split()[-1].upper() == "TONIGHT" for r in group]
        self.assertEqual(tonight, sorted(tonight, reverse=True))
        sloppy = next(r for r in group if r[0].startswith("Turnover-Prone Teams"))
        self.assertEqual(sloppy[0].split()[-1].upper(), "TONIGHT")
        ex = REFERENCE["extremes"]
        want = ex["teams"]["BOS"]["sloppy"]["pts"][1] - ex["league"]["sloppy"]["pts"]
        self.assertEqual(float(sloppy[2]), round(want, 1))
        self.assertEqual(int(sloppy[1]), ex["teams"]["BOS"]["sloppy"]["n"])
        pace = PAGE.evaluate("() => [...document.querySelectorAll('#id-extremes .ex-table tbody tr:not(.id-group)')].map((r) => r.children[3].className)")
        self.assertTrue(pace and all("tier-" not in c for c in pace), pace)

    def test_identity_tags(self):
        bos = PAGE.evaluate("() => [...document.querySelectorAll('#id-teams .nba-box')[0].querySelectorAll('.id-chip')].map((c) => c.textContent)")
        self.assertIn("Slow pace", bos)
        self.assertLessEqual(len(bos), 8)

    def test_season_buttons(self):
        buttons = PAGE.evaluate("() => [...document.querySelectorAll('#id-seasons button')].map((b) => [b.textContent, b.disabled])")
        self.assertEqual(buttons, [["2025-26", False], ["2026-27", True]])

    def test_in_the_nba_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nav-menu a')].map((a) => a.getAttribute('href'))")
        self.assertTrue(any(h and h.endswith("nba/identity.html") for h in links), links)


if __name__ == "__main__":
    unittest.main()
