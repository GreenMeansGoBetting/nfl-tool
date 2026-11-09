"""The Matchup sheet (site/nba/matchup-sheet.js), Matchup Keys' Summary tab since Matchup Data
(nba/index.html + nba.js) was retired 2026-11-09 (the owner: "add that matchup sheet to a fourth tab
called summary ... then i believe we can remove matchup data"), on 2025-26's saved identity numbers
(nfl_tool/nba/identity_2026.json) for BOS @ DET.

What is pinned: no script errors; The Matchup reads both directions side by side (BOS's offense
across from DET's defense, then DET's offense across from BOS's defense), every row, each cell a rank
of 30 first and its number second; every Edge follows the site's two-sided rule; Vs Tonight's Types;
the menu has Matchup Keys and no Matchup Data, and the old addresses land on Matchup Keys; who's
behind a number (who.js) from a Summary stat name and from any colored box."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHART = json.loads((ROOT / "tests" / "fixtures" / "nba_league_chart_2026-10-30.json").read_text(encoding="utf-8"))
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

REFERENCE = json.loads((ROOT / "nfl_tool" / "nba" / "identity_2026.json").read_text(encoding="utf-8"))
GAME = {"game_id": "9", "date": "2026-10-21", "time": "19:30", "away": "BOS", "home": "DET", "status": "scheduled",
        "home_team_spread": -2.5, "away_team_spread": 2.5, "total_line": 221.5}
# key, label, way (+1 the offense wants it high, -1 low, 0 how often), share a make-rate row needs
ROWS = [("ppp", "Pts / Possession", 1, None), ("pace", "Pace", 0, None), ("trans_freq", "Transition Share", 0, None),
        ("trans_ppp", "Transition Pts / Poss", 1, None), ("tov_rate", "Turnovers", -1, None), ("oreb_rate", "Rebounding", 1, None),
        ("fta_rate", "Free Throws / Shot", 1, None), ("three_rate", "3-Point Share", 0, None), ("paint_share", "Paint Share", 0, None),
        ("paint_pct", "Paint FG%", 1, "paint_share"), ("mid_share", "Mid-Range Share", 0, None), ("mid_pct", "Mid-Range FG%", 1, "mid_share"),
        ("ball_move", "Ball Movement", 0, None)]
T, L = REFERENCE["teams"], REFERENCE["league"]


def zz(t, k):
    return None if T[t].get(k) is None else (T[t][k] - L[k]["avg"]) / (L[k]["sd"] or 1)


def rank(key, team, hi):
    v = T[team][key]
    vals = [s[key] for s in T.values() if s.get(key) is not None]
    return min(len(vals), 1 + sum(1 for x in vals if (x > v if hi else x < v)))


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def team_stats(wins, losses):
    return {"games_played": wins + losses, "wins": wins, "losses": losses, "net_rating": wins - losses, "off_rating": 110.0 + wins,
            "def_rating": 110.0 - wins, "pace": 99.0, "home_record": f"{wins}-0", "away_record": f"0-{losses}", "last10": f"{wins}-{losses}"}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in CHART}
        teams.update({t: {"name": n, "short": s, "logo": "", "color": c} for t, n, s, c in
                      (("BOS", "Boston Celtics", "Celtics", "007a33"), ("DET", "Detroit Pistons", "Pistons", "c8102e"))})
        recent = {"BOS": [{"game_id": "1", "date": "2026-10-19", "opp": "DET", "home": True, "pf": 110, "pa": 100, "win": True, "pace": 98.0, "spread": -6.5, "total": 214.5}],
                  "DET": [{"game_id": "1", "date": "2026-10-19", "opp": "BOS", "home": False, "pf": 100, "pa": 110, "win": False, "pace": 98.0, "spread": 6.5, "total": 214.5}]}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": [GAME], "kotc": None, "first_basket": None,
                    "injuries": {"DET": [{"id": "5", "name": "Pat Lee", "status": "Out", "position": "SG", "injury": "Knee"}]},
                    "team_stats": {"BOS": team_stats(5, 1), "DET": team_stats(2, 4)}, "recent_games": recent, "players": {},
                    "identity": {"default": "2026", "seasons": {"2026": REFERENCE}},
                    "league_chart": {"season": CHART, "10": CHART, "5": CHART, "3": CHART}}
        PAGE = SITE.open("nba/matchup-keys.html")
        PAGE.wait_for_function("() => !!document.querySelector('[data-mk-tab=summary]')")
        PAGE.click("[data-mk-tab=summary]")
        PAGE.wait_for_selector(".mk-sheet .mb-matchup")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


# A cell's text, its rank and number apart ("2nd 1.21").
CELL_TEXT = "const cellText = (td) => td.querySelector('b') ? [td.querySelector('b').textContent, (td.querySelector('small') || {}).textContent || ''].join(' ').trim() : td.textContent.replace(/\\s+/g, ' ').trim();"


def matchup_row(label):
    """[call, BOS off, DET def, label, DET off, BOS def, call] texts of The Matchup's row `label`."""
    return PAGE.evaluate("""(label) => {""" + CELL_TEXT + """
        const tr = [...document.querySelectorAll('.mb-matchup tbody tr')].find((r) => r.querySelector('.mb-stat') && r.querySelector('.mb-stat').textContent === label);
        return tr ? [...tr.children].map(cellText) : null;
    }""", label)


class Page(unittest.TestCase):
    def test_both_directions_side_by_side(self):
        self.assertEqual(SITE.errors, [])
        # no "Has The Ball" / "Call" heads; the column heads right above the first rows; the
        # label in the middle, the calls on the far outside (the owner, 2026-10-28)
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup tr.mb-heads')].map((r) => [...r.children].map((th) => th.textContent.trim()))")
        self.assertEqual(heads, [["", "BOS Off", "DET Def", "", "DET Off", "BOS Def", ""]])
        first = PAGE.evaluate("() => { const r = document.querySelector('.mb-matchup tr.mb-heads'); return [r.previousElementSibling.textContent, r.nextElementSibling.querySelector('.mb-stat').textContent]; }")
        self.assertEqual(first, ["Scoring", "Pts / Possession"])
        last = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup tbody tr:not(.mb-group):not(.mb-heads)')].every((r) => r.children[3].classList.contains('mb-stat') && r.children[0].classList.contains('mb-call') && r.children[6].classList.contains('mb-call'))")
        self.assertTrue(last)
        shown = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup tbody tr:not(.mb-group) .mb-stat')].map((td) => td.textContent)")
        self.assertEqual(shown[:len(ROWS)], [r[1] for r in ROWS])  # every row, always (the owner: show everything)
        self.assertNotIn("--", PAGE.inner_text(".mk-sheet"))

    def test_rank_first_then_number_both_sides(self):
        ppp = matchup_row("Pts / Possession")
        self.assertEqual(ppp[1], f"{ordinal(rank('off_ppp', 'BOS', True))} {T['BOS']['off_ppp']:.2f}")
        self.assertEqual(ppp[2], f"{ordinal(rank('def_ppp', 'DET', False))} {T['DET']['def_ppp']:.2f}")
        self.assertEqual(ppp[4], f"{ordinal(rank('off_ppp', 'DET', True))} {T['DET']['off_ppp']:.2f}")
        self.assertEqual(ppp[5], f"{ordinal(rank('def_ppp', 'BOS', False))} {T['BOS']['def_ppp']:.2f}")
        # turnovers: the offense's 1st = fewest, the defense's 1st = forces the most
        tov = matchup_row("Turnovers")
        self.assertTrue(tov[1].startswith(ordinal(rank("off_tov_rate", "BOS", False)) + " "), tov)
        self.assertTrue(tov[2].startswith(ordinal(rank("def_tov_rate", "DET", True)) + " "), tov)
        # how often: the offense's 1st = does it most, the defense's 1st = allows it least
        threes = matchup_row("3-Point Share")
        self.assertTrue(threes[1].startswith(ordinal(rank("off_three_rate", "BOS", True)) + " "), threes)
        self.assertTrue(threes[2].startswith(ordinal(rank("def_three_rate", "DET", False)) + " "), threes)
        # rebounding: the defense side reads as its own defensive rebound %
        reb = matchup_row("Rebounding")
        self.assertTrue(reb[2].endswith(f"{(1 - T['DET']['def_oreb_rate']) * 100:.1f}%"), reb)
        # every value cell is shaded red to green
        styles = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup td.mb-v:not(.mb-empty)')].map((td) => td.getAttribute('style') || '')")
        self.assertTrue(styles and all("background" in s for s in styles))

    def test_edges_follow_the_two_sided_rule(self):
        # Worked out again here: an edge needs one side 0.6 league spreads toward a team and
        # the other not 0.3 the other way; its pill carries the logo of the team it favors.
        want = {"BOS": 0, "DET": 0}
        for off, de in (("BOS", "DET"), ("DET", "BOS")):
            for key, _, way, share in ROWS:
                a, b = zz(off, f"off_{key}"), zz(de, f"def_{key}")
                if way == 0 or a is None or b is None or (share and (zz(off, f"off_{share}") or -1) < 0):
                    continue
                a, b = a * way, b * way
                hi, lo = max(a, b), min(a, b)
                d = 1 if hi >= 0.6 and lo > -0.3 else -1 if lo <= -0.6 and hi < 0.3 else 0
                if not d or (key == "trans_ppp" and d == 1 and zz(off, "off_trans_freq") < 0):
                    continue
                want[off if d > 0 else de] += 1
        labels = [r[1] for r in ROWS]
        pills = PAGE.evaluate("""(labels) => [...document.querySelectorAll('.mb-matchup tbody tr')]
            .filter((r) => r.querySelector('.mb-stat') && labels.includes(r.querySelector('.mb-stat').textContent))
            .flatMap((r) => [...r.querySelectorAll('.mb-edge img')].map((i) => i.alt))""", labels)
        self.assertEqual([pills.count("BOS"), pills.count("DET")], [want["BOS"], want["DET"]])
        self.assertGreater(want["BOS"] + want["DET"], 0)
        self.assertEqual(SITE.errors, [])

    def test_tonights_types_only_with_three_games(self):
        rows = PAGE.evaluate("""() => { const all = [...document.querySelectorAll('.mb-matchup tbody tr')];
            const i = all.findIndex((r) => r.classList.contains('mb-group') && r.textContent.startsWith("Vs Tonight's Types"));
            return i < 0 ? [] : all.slice(i + 1).map((r) => [...r.querySelectorAll('td.mb-v')].map((td) => td.textContent.trim()).filter(Boolean)); }""")
        self.assertTrue(rows)
        for cells in rows:
            self.assertNotIn("GP", " ".join(cells))

    def test_matchup_data_is_retired(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nba-menu a')].map((a) => [a.textContent, a.getAttribute('href')])")
        names = [x[0] for x in links]
        self.assertIn("Matchup Keys", names)
        self.assertNotIn("Matchup Data", names)
        self.assertNotIn("Team Identity", names)
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('[data-mk-tab]')].map((b) => b.textContent)"),
                         ["Overview", "Categories", "Rotations & History", "Summary"])
        for old in ("nba/", "nba/identity.html"):
            page = SITE.open(old)
            try:
                page.wait_for_url("**/nba/matchup-keys.html")
            finally:
                page.close()


class WhoIsBehindIt(unittest.TestCase):
    # A member, 2026-11-09: click a Matchup row (Paint FG%) for "a few players that score high in paint
    # for that team", guards included; transition too ("assists or scoring in transition"). The owner, the
    # same day: a box opens ITS matchup only, the offense's players beside the defense's allowed by
    # position, "positioned left and right" the way the two boxes sit; a Summary stat name opens both.
    def test_a_stat_name_opens_both_teams_players(self):
        fields = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta", "fgm", "ftm", "reb", "ast", "stl", "blk", "tov", "pf", "pm", "score", "opp_score", "oreb", "dreb"]
        def log(fga, mins=30, opp="XXX"):
            return [["2026-10-1%d" % d, d, opp, 1, 1, mins, 20, fga, 1, 3, 4, 8, 3, 5, 4, 1, 0, 2, 2, 0, 110, 100, 1, 4] for d in range(3)]
        players = {
            # his 3 games on DET's defense
            "10": {"name": "Big Guard", "team": "BOS", "pos": "PG", "log": log(20, opp="DET"), "zones": {"rim": 0.5, "short": 0.1, "mid": 0.1, "corner3": 0.1, "above3": 0.2},
                   "zone_pct": {"rim": [0.6, 30], "short": [0.4, 6], "mid": [0.5, 6]}, "kinds": {"catch": 0.2}, "assisted": 0.4},
            "11": {"name": "Small Center", "team": "BOS", "pos": "C", "log": log(10), "zones": {"rim": 0.9, "short": 0.1, "mid": 0.0, "corner3": 0.0, "above3": 0.0},
                   "zone_pct": {"rim": [0.7, 27], "short": [0.5, 3]}, "kinds": {"catch": 0.0}, "assisted": 0.8},
            "12": {"name": "Bench Guy", "team": "BOS", "pos": "SF", "log": log(30, mins=8), "zones": {"rim": 1.0}, "zone_pct": {"rim": [0.5, 90]}},
            "20": {"name": "Det Wing", "team": "DET", "pos": "SF", "log": log(12), "zones": {"rim": 0.3, "short": 0.1, "mid": 0.2, "corner3": 0.2, "above3": 0.2},
                   "zone_pct": {"rim": [0.5, 10], "short": [0.5, 4]}},
        }
        SITE.nba_props = {"default": "2027", "seasons": {"2027": {"label": "2026-27", "fields": fields, "players": players, "out": {}}},
                          "research": {"players": {"10": {"trans": [18, 60], "ap": [40, 12, 3]}}}}
        try:
            PAGE.click(".mb-matchup td.mb-who[data-who='paint']")
            PAGE.wait_for_selector("#mb-who-modal:not([hidden]) .mb-who-table")
            boxes = PAGE.evaluate("() => [...document.querySelectorAll('#mb-who-modal .mb-whobox')].map((b) => [...b.querySelectorAll('tr:not(.mb-heads)')].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\\s+/g, ' ').trim())))")
            bos, det_def, det, bos_def = boxes  # both directions: BOS offense | DET defense, then DET offense | BOS defense
            heads = PAGE.evaluate("() => [...document.querySelectorAll('#mb-who-modal .team-banner-name')].map((b) => b.textContent)")
            self.assertEqual(heads, ["Boston Celtics Offense", "Allowed By Position", "Detroit Pistons Offense", "Allowed By Position"])
            # DET's defense: what it allowed PGs (Big Guard, 20 points on 8 of 20 a game in 3 games), and BOS's PGs' paint shots
            self.assertEqual(det_def[0][0], "PG")
            self.assertEqual(det_def[0][-1], "12.0")
            # the guard first: 20 shots a game x 60% of them in the paint = 12.0; the bench player (8 min) left off
            self.assertEqual([r[0].split(" ")[0] for r in bos], ["Big", "Small"])
            # paint FG% (0.6*30 + 0.4*6) / 36; team share counts every BOS player, the bench one too: 12 of 52 a game
            self.assertEqual(bos[0][3:6], ["12.0", "57%", "23%"])
            self.assertIn("Det Wing", det[0][0])
            PAGE.keyboard.press("Escape")
            # a box opens its own matchup only, in the boxes' order: DET's defense box (second in BOS's half)
            PAGE.click(".mb-matchup td.mb-who-v[data-who='paint'][data-o='BOS'][data-d='DET'] >> nth=1")
            PAGE.wait_for_selector("#mb-who-modal:not([hidden]) .mb-who-dir")
            self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('#mb-who-modal .team-banner-name')].map((b) => b.textContent)"),
                             ["Boston Celtics Offense", "Allowed By Position"])
            PAGE.evaluate("() => { const s = document.querySelector('#mb-who-modal .mb-who-table tr:not(.mb-heads)'); return s && s.textContent; }")
            PAGE.keyboard.press("Escape")
            PAGE.click(".mb-matchup td.mb-who[data-who='transition']")
            PAGE.wait_for_function("() => document.querySelector('#mb-who-content').innerText.includes('TRANS') || document.querySelector('#mb-who-content').innerText.includes('Trans')")
            first = PAGE.evaluate("() => [...document.querySelector('#mb-who-modal .mb-whobox tr:not(.mb-heads)').children].map((td) => td.innerText.trim())")
            self.assertEqual(first[3:6], ["6.0", "30%", "1.0"])  # 18 transition points in 3 games, 18 of 60, 3 transition assists
            PAGE.keyboard.press("Escape")
            # a team-only number opens nothing; every colored box with a player split opens it (the owner, 2026-11-09)
            self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup td.mb-mid')].filter((td) => td.textContent === 'Pace' && td.dataset.who).length"), 0)
            PAGE.click("[data-mk-tab=categories]")
            PAGE.wait_for_selector(".mk-cats")
            PAGE.click(".mk-cline[data-cat='threes'] .mk-who >> nth=0")
            PAGE.wait_for_function("() => !document.getElementById('mb-who-modal').hidden && document.querySelector('#mb-who-content').textContent.includes('Threes')")
            self.assertFalse(PAGE.evaluate("() => view.open.has('threes')"))  # the box opened the players, not the category
            PAGE.keyboard.press("Escape")
            PAGE.click("[data-mk-tab=overview]")
            PAGE.wait_for_selector(".mk-ov")
            self.assertGreater(PAGE.locator(".mk-ov .mk-who").count(), 0)
            # an Edges box: its own team's box first, so its own team's side opens on the left
            box = PAGE.locator(".mk-edges .mk-who").first
            team = PAGE.evaluate("(el) => el.closest('.mk-edges').dataset.team", box.element_handle())
            box.click()
            PAGE.wait_for_selector("#mb-who-modal:not([hidden]) .mb-who-dir")
            first = PAGE.evaluate("() => document.querySelector('#mb-who-modal .mb-whobox').dataset.team")
            self.assertEqual(first, team)
            self.assertEqual(PAGE.locator("#mb-who-modal .mb-who-dir").count(), 1)
            PAGE.keyboard.press("Escape")
            self.assertEqual(PAGE.locator(".mk-ov .mks-span.mk-who").count(), 0)  # Pace: no player split
        finally:
            PAGE.keyboard.press("Escape")
            PAGE.click("[data-mk-tab=summary]")
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
