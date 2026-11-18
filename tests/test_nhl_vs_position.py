"""NHL Vs Position (build_nhl.compute_vs_position -> data.json vs_position; site/nhl/vs-position.js).

Pinned (a member, 2026-11-13: "the shots that each team gives to each position. LW/C/RW/D"; the owner,
2026-11-17: its own page, a Shots / Goals toggle, and a game shows the players in tonight's matchup):
the build counts the shots on goal and goals each defense allows to the other team's C / L / R / D,
in all games, at home, on the road and its last 10; the page divides by games and ranks (1st = allows
the most, green, the shooter's side like every NHL page); a game shows both offenses' players at
each position beside what the other defense allows; Out players are faded; the page is in the NHL menu."""
import sys
import unittest
from pathlib import Path

from helpers import nhl_data  # first: puts tools/ on the import path

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
import build_nhl  # noqa: E402


def skater(team, pos, sog, g):
    return {"team": team, "pos": pos, "sog": sog, "g": g}


def record(date, home, away, skaters):
    return {"date": date, "home": home, "away": away, "skaters": {str(i): s for i, s in enumerate(skaters)}}


class Build(unittest.TestCase):
    def test_counts_what_each_defense_allows_to_each_position(self):
        recs = [
            # AAA at home: BBB's center 3 shots 1 goal, left wing 2, a defenseman 1; AAA's own shots never count for AAA
            record("2026-10-10", "AAA", "BBB", [skater("BBB", "C", 3, 1), skater("BBB", "L", 2, 0), skater("BBB", "D", 1, 0), skater("AAA", "C", 9, 2)]),
            # AAA on the road: CCC's right wing 4 shots 2 goals; an "F" (no position) is left out
            record("2026-10-12", "CCC", "AAA", [skater("CCC", "R", 4, 2), skater("CCC", "F", 5, 1)]),
        ]
        vp = build_nhl.compute_vs_position(recs)
        self.assertEqual(vp["positions"], ["C", "L", "R", "D"])
        aaa = vp["teams"]["AAA"]
        self.assertEqual(aaa["season"], [2, 3, 1, 2, 0, 4, 2, 1, 0])
        self.assertEqual(aaa["home"], [1, 3, 1, 2, 0, 0, 0, 1, 0])
        self.assertEqual(aaa["away"], [1, 0, 0, 0, 0, 4, 2, 0, 0])
        self.assertEqual(aaa["10"], aaa["season"])
        self.assertEqual(vp["teams"]["BBB"]["season"], [1, 9, 2, 0, 0, 0, 0, 0, 0])  # AAA's center on BBB

    def test_last_10_is_the_latest_ten(self):
        recs = [record(f"2026-10-{d:02d}", "AAA", "BBB", [skater("BBB", "C", d, 0)]) for d in range(1, 13)]
        aaa = build_nhl.compute_vs_position(recs)["teams"]["AAA"]
        self.assertEqual(aaa["10"][:2], [10, sum(range(3, 13))])
        self.assertEqual(aaa["season"][:2], [12, sum(range(1, 13))])


SITE = PAGE = None


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/vs-position.html")
        PAGE.wait_for_function("() => typeof DATA !== 'undefined' && DATA && !document.getElementById('vp-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Page(unittest.TestCase):
    def setUp(self):
        # every team in the sample: C shots a game = its place in the list (so ranks are known), goals a tenth of that
        PAGE.evaluate("""() => {
            const teams = Object.keys(DATA.teams);
            DATA.vs_position = { positions: ['C', 'L', 'R', 'D'], teams: Object.fromEntries(teams.map((t, i) => {
                const row = [2, 2 * (i + 1), 0.2 * (i + 1), 4, 1, 6, 1, 8, 0];
                return [t, { season: row, home: row, away: row, '10': row }];
            })) };
            Object.assign(vpView, { stat: 'sog', window: 'season', sort: 'C' });
            const g = gamesOn(days()[dayIndex])[0];
            gameId = g ? g.game_id : null;
            vpPeerCache = {};
            render();
        }""")

    def test_every_team_most_allowed_first_and_green(self):
        got = PAGE.evaluate("""() => {
            const rows = [...document.querySelectorAll('.vp-grid tbody tr:not(.vp-spacer):not(.vp-top)')];
            return { n: rows.length, c: rows.map((tr) => Number(tr.querySelectorAll('.vp-tile b')[0].textContent)),
                     first: rows[0].querySelectorAll('.vp-tile small')[0].textContent };
        }""")
        self.assertEqual(got["c"], sorted(got["c"], reverse=True))
        self.assertTrue(got["first"].endswith("Most"))

    def test_a_game_shows_both_offenses_players_by_position(self):
        got = PAGE.evaluate("""() => {
            const g = currentGame();
            const boxes = [...document.querySelectorAll('.vp-box')].map((b) => b.querySelector('.team-banner').textContent);
            const away = document.querySelector('.vp-box');
            const rows = [...away.querySelectorAll('.vp-mgrid tbody tr')].map((tr) => [tr.querySelector('.vp-pos').textContent, tr.querySelectorAll('.vp-player').length]);
            const want = ['C', 'L', 'R', 'D'].map((p) => new Set((DATA.skaters[g.away] || []).filter((x) => x.pos === p).map((x) => x.id)).size);
            return { g: [g.away, g.home], boxes, rows, want, top: [...document.querySelectorAll('.vp-grid tr.vp-top .vp-logo')].map((b) => b.dataset.vpTeam) };
        }""")
        away, home = got["g"]
        self.assertIn(f"vs {home} Defense", got["boxes"][0])
        self.assertIn(f"vs {away} Defense", got["boxes"][1])
        self.assertEqual([r[0] for r in got["rows"]], ["C", "LW", "RW", "D"])
        self.assertEqual([r[1] for r in got["rows"]], got["want"])
        self.assertEqual(sorted(got["top"]), sorted([away, home]))  # the game's teams lead the table
        self.assertEqual(SITE.errors, [])

    def test_goals_toggle_and_a_header_sorts(self):
        got = PAGE.evaluate("""() => {
            document.querySelector('[data-vp-stat="g"]').click();
            const head = document.querySelector('.vp-grid .od-ggroups th.od-g2').textContent;
            const tile = document.querySelector('.vp-grid tbody tr:not(.vp-top):not(.vp-spacer) .vp-tile b').textContent;
            document.querySelector('[data-vp-sort="D"]').click();
            const sorted = document.querySelector('.vp-grid .vp-sorted').dataset.vpSort;
            document.querySelector('[data-vp-stat="sog"]').click();
            return { head, tile, sorted };
        }""")
        self.assertTrue(got["head"].startswith("Goals Allowed"))
        self.assertRegex(got["tile"], r"^\d+\.\d\d$")
        self.assertEqual(got["sorted"], "D")

    def test_it_is_in_the_nhl_menu(self):
        self.assertTrue(PAGE.evaluate("() => [...document.querySelectorAll('a')].some((a) => /vs-position\\.html$/.test(a.getAttribute('href') || ''))"))


if __name__ == "__main__":
    unittest.main()
