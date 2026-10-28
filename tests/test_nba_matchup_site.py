"""NBA Matchup Breakdown (site/nba/index.html + nba.js; Game Previews and Team
Identity merged, 2026-10-28), on 2025-26's saved identity numbers
(nfl_tool/nba/identity_2026.json) for BOS @ DET.

What is pinned: no script errors; The Matchup reads both directions side by
side (BOS's offense across from DET's defense, then DET's offense across from
BOS's defense), every row, each cell a rank of 30 first and its number second;
every Edge follows the site's two-sided rule and Biggest Edges lists each
team's 3 biggest; How They Win / How They Lose, Head To Head, Recent Games'
covers; the menu item, and that Team Identity's old address lands here."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
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
        teams = {t: {"name": n, "short": s, "logo": "", "color": c} for t, n, s, c in
                 (("BOS", "Boston Celtics", "Celtics", "007a33"), ("DET", "Detroit Pistons", "Pistons", "c8102e"))}
        recent = {"BOS": [{"game_id": "1", "date": "2026-10-19", "opp": "DET", "home": True, "pf": 110, "pa": 100, "win": True, "pace": 98.0, "spread": -6.5, "total": 214.5}],
                  "DET": [{"game_id": "1", "date": "2026-10-19", "opp": "BOS", "home": False, "pf": 100, "pa": 110, "win": False, "pace": 98.0, "spread": 6.5, "total": 214.5}]}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": [GAME], "kotc": None, "first_basket": None,
                    "injuries": {"DET": [{"id": "5", "name": "Pat Lee", "status": "Out", "position": "SG", "injury": "Knee"}]},
                    "team_stats": {"BOS": team_stats(5, 1), "DET": team_stats(2, 4)}, "recent_games": recent, "players": {},
                    "identity": {"default": "2026", "seasons": {"2026": REFERENCE}}}
        PAGE = SITE.open("nba/")
        PAGE.wait_for_function("() => DATA && !document.getElementById('section-duo').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


# A cell's text, its rank and number apart ("2nd 1.21").
CELL_TEXT = "const cellText = (td) => td.querySelector('b') ? [td.querySelector('b').textContent, (td.querySelector('small') || {}).textContent || ''].join(' ').trim() : td.textContent.replace(/\\s+/g, ' ').trim();"


def matchup_row(label):
    """[call, BOS off, DET def, stat, DET off, BOS def, call] texts of The Matchup's row `label`."""
    return PAGE.evaluate("""(label) => {""" + CELL_TEXT + """
        const tr = [...document.querySelectorAll('.mb-matchup tbody tr')].find((r) => r.querySelector('.mb-stat') && r.querySelector('.mb-stat').textContent === label);
        return tr ? [...tr.children].map(cellText) : null;
    }""", label)


class Page(unittest.TestCase):
    def test_both_directions_side_by_side(self):
        self.assertEqual(SITE.errors, [])
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup thead tr')].map((r) => [...r.children].map((th) => th.textContent.trim()))")
        self.assertEqual(heads[0], ["BOS Has The Ball", "", "DET Has The Ball"])
        self.assertEqual(heads[1], ["Call", "BOS Off", "DET Def", "", "DET Off", "BOS Def", "Call"])
        shown = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup tbody tr:not(.mb-group) .mb-stat')].map((td) => td.textContent)")
        self.assertEqual(shown[:len(ROWS)], [r[1] for r in ROWS])  # every row, always (the owner: show everything)
        self.assertNotIn("--", PAGE.inner_text("#matchup-content"))

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
        # Biggest Edges: each team's 3 biggest (types included), never a count
        every = PAGE.evaluate("() => [...document.querySelectorAll('.mb-matchup .mb-edge img')].map((i) => i.alt)")
        boxes = PAGE.evaluate("() => [...document.querySelectorAll('#edges-content .nba-box')].map((b) => b.querySelectorAll('tbody .mb-edge').length)")
        self.assertEqual(boxes, [min(3, every.count("BOS")), min(3, every.count("DET"))])
        self.assertEqual(SITE.errors, [])

    def test_tonights_types_only_with_three_games(self):
        rows = PAGE.evaluate("""() => { const all = [...document.querySelectorAll('.mb-matchup tbody tr')];
            const i = all.findIndex((r) => r.classList.contains('mb-group') && r.textContent.startsWith("Vs Tonight's Types"));
            return i < 0 ? [] : all.slice(i + 1).map((r) => [...r.querySelectorAll('td.mb-v')].map((td) => td.textContent.trim()).filter(Boolean)); }""")
        self.assertTrue(rows)
        for cells in rows:
            self.assertNotIn("GP", " ".join(cells))

    def test_win_loss_and_head_to_head(self):
        wl = PAGE.evaluate("() => [...document.querySelectorAll('#wl-content .nba-box')].map((b) => [b.querySelector('.nba-banner-right').textContent, [...b.querySelectorAll('thead th')].map((th) => th.textContent), b.querySelectorAll('tbody tr').length])")
        for (record, heads, n), t in zip(wl, ("BOS", "DET")):
            w = REFERENCE["wl"][t]
            self.assertEqual(record, f"{w['nw']}-{w['nl']}")
            self.assertEqual(heads, ["", f"In Wins ({w['nw']})", f"In Losses ({w['nl']})"])
            self.assertEqual(n, 3)
        h2h = PAGE.evaluate("() => {" + CELL_TEXT + " return [...document.querySelectorAll('.mb-mirror tbody tr:not(.mb-group)')].map((r) => [...r.children].map(cellText)); }")
        rows = {r[1]: r for r in h2h}
        self.assertEqual(rows["Record"], ["5-1", "Record", "2-4"])
        self.assertEqual(rows["Net Rating"][0][:3], "1st")
        q1 = rows["Q1"]
        self.assertTrue(q1[0].startswith(ordinal(rank("q1_ppq", "BOS", True)) + " "), q1)
        self.assertIn("Blowout Data", PAGE.text_content("#h2h-content"))

    def test_top_row_and_recent_games(self):
        self.assertIn("Pat Lee", PAGE.inner_text("#top-content"))
        self.assertIn("221.5", PAGE.inner_text("#top-content"))
        # BOS won by 10 as a 6.5 favorite (covered, green); 210 points under 214.5 (red)
        cells = PAGE.evaluate("() => [...document.querySelectorAll('#recent-content .nba-box')[0].querySelectorAll('td.mb-res')].map((td) => [td.textContent, td.title])")
        self.assertEqual(cells, [["-6.5", "Covered"], ["U 214.5", "Under"]])

    def test_in_the_nba_menu_and_team_identity_lands_here(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.nba-menu a')].map((a) => [a.textContent, a.getAttribute('href')])")
        self.assertIn("Matchup Breakdown", [x[0] for x in links])
        self.assertNotIn("Team Identity", [x[0] for x in links])
        page = SITE.open("nba/identity.html")
        try:
            page.wait_for_url("**/nba/")
            page.wait_for_function("() => typeof DATA !== 'undefined' && DATA")
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main()
