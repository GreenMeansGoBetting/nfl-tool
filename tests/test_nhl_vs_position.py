"""NHL Vs Position (build_nhl.compute_vs_position -> data.json vs_position; site/nhl/vs-position.js).

Pinned (a member, 2026-11-13: "the shots that each team gives to each position. LW/C/RW/D"; the owner,
2026-11-17: its own page, a Shots / Goals toggle, and a game shows the players in tonight's matchup):
the build counts the shots on goal and goals each defense allows to the other team's C / L / R / D,
in all games, at home, on the road and its last 10; the page divides by games and ranks from the
defense's side (1st = allows the fewest, green; the most allowed = last, red; the owner, 2026-11-17); a game shows both offenses' players at
each position beside what the other defense allows; Out players are faded; the page is in the NHL menu.
The owner, 2026-11-18: Points too; one lane per position that never wraps; no repeated "SOG/G 21 GP"; a
computer gets the league chart across the top (teams across, positions down), a phone the tall list under
the game, and it can show only the day's teams."""
import sys
import unittest
from pathlib import Path

from helpers import nhl_data  # first: puts tools/ on the import path

from site_browser import SiteBrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
import build_nhl  # noqa: E402


def skater(team, pos, sog, g, a=0):
    return {"team": team, "pos": pos, "sog": sog, "g": g, "a": a}


def record(date, home, away, skaters):
    return {"date": date, "home": home, "away": away, "skaters": {str(i): s for i, s in enumerate(skaters)}}


class Build(unittest.TestCase):
    def test_counts_what_each_defense_allows_to_each_position(self):
        recs = [
            # AAA at home: BBB's center 3 shots 1 goal, left wing 2, a defenseman 1; AAA's own shots never count for AAA
            record("2026-10-10", "AAA", "BBB", [skater("BBB", "C", 3, 1, 2), skater("BBB", "L", 2, 0, 1), skater("BBB", "D", 1, 0), skater("AAA", "C", 9, 2)]),
            # AAA on the road: CCC's right wing 4 shots 2 goals; an "F" (no position) is left out
            record("2026-10-12", "CCC", "AAA", [skater("CCC", "R", 4, 2), skater("CCC", "F", 5, 1)]),
        ]
        vp = build_nhl.compute_vs_position(recs)
        self.assertEqual(vp["positions"], ["C", "L", "R", "D"])
        aaa = vp["teams"]["AAA"]
        # shots and goals per position, then points (goals + assists) per position on the end
        self.assertEqual(aaa["season"], [2, 3, 1, 2, 0, 4, 2, 1, 0, 3, 1, 2, 0])
        self.assertEqual(aaa["home"], [1, 3, 1, 2, 0, 0, 0, 1, 0, 3, 1, 0, 0])
        self.assertEqual(aaa["away"], [1, 0, 0, 0, 0, 4, 2, 0, 0, 0, 0, 2, 0])
        self.assertEqual(aaa["10"], aaa["season"])
        self.assertEqual(vp["teams"]["BBB"]["season"], [1, 9, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0])  # AAA's center on BBB

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
        PAGE.set_viewport_size({"width": 1440, "height": 1000})
        # every team in the sample: C shots a game = its place in the list (so ranks are known), goals a tenth of that, C points three tenths
        PAGE.evaluate("""() => {
            const teams = Object.keys(DATA.teams);
            DATA.vs_position = { positions: ['C', 'L', 'R', 'D'], teams: Object.fromEntries(teams.map((t, i) => {
                const row = [2, 2 * (i + 1), 0.2 * (i + 1), 4, 1, 6, 1, 8, 0, 0.6 * (i + 1), 3, 3, 1];
                return [t, { season: row, home: row, away: row, '10': row }];
            })) };
            Object.assign(vpView, { stat: 'sog', window: 'season', sort: 'C', today: false });
            const g = gamesOn(days()[dayIndex])[0];
            gameId = g ? g.game_id : null;
            vpPeerCache = {};
            render();
        }""")

    def tearDown(self):
        PAGE.set_viewport_size({"width": 1440, "height": 1000})

    def test_a_computer_gets_teams_across_most_allowed_first(self):
        got = PAGE.evaluate("""() => {
            const snap = document.querySelector('.vp-snap');
            const g = currentGame();
            const heads = [...snap.querySelectorAll('.od-glabels .vp-logo')].map((b) => b.dataset.vpTeam);
            const rows = [...snap.querySelectorAll('tbody tr')];
            const tiles = [...rows[0].querySelectorAll('.vp-tile')];
            const n = Object.keys(DATA.vs_position.teams).length;
            const box = document.querySelector('#vp-app').getBoundingClientRect();
            return { list: !!document.querySelector('.vp-grid'), heads, pos: rows.map((r) => r.querySelector('.vp-pos').dataset.vpSort),
                     rest: tiles.slice(2).map((t) => Number(t.querySelector('b').textContent)), game: [g.away, g.home], n,
                     firstSmall: tiles[2].querySelector('small').textContent, last: ordinal(n),
                     red: ` style="${tiles[2].getAttribute('style')}"` === cellOnStep(rankStep(n, n)),
                     onTop: document.querySelector('#vp-table').getBoundingClientRect().bottom <= document.querySelector('#vp-matchup').getBoundingClientRect().top,
                     fits: snap.getBoundingClientRect().right <= box.right };
        }""")
        self.assertFalse(got["list"])
        self.assertEqual(len(got["heads"]), got["n"])
        self.assertEqual(sorted(got["heads"][:2]), sorted(got["game"]))  # the game's teams lead
        self.assertEqual(got["pos"], ["C", "L", "R", "D"])
        self.assertEqual(got["rest"], sorted(got["rest"], reverse=True))
        self.assertTrue(got["onTop"])
        self.assertTrue(got["fits"])  # all 32 fit on a computer

    def test_the_leakiest_defense_ranks_last_and_red(self):
        got = PAGE.evaluate("""() => {
            const n = Object.keys(DATA.vs_position.teams).length;
            const worst = Object.keys(DATA.vs_position.teams).at(-1);
            gameId = null;
            render();
            const tile = document.querySelector('.vp-snap tbody tr .vp-tile');
            return { first: document.querySelector('.vp-snap .od-glabels .vp-logo').dataset.vpTeam, worst, rank: tile.querySelector('small').textContent, last: ordinal(n),
                     red: ` style="${tile.getAttribute('style')}"` === cellOnStep(rankStep(n, n)) };
        }""")
        self.assertEqual(got["first"], got["worst"])
        self.assertEqual(got["rank"], got["last"])
        self.assertTrue(got["red"])

    def test_a_phone_gets_the_tall_list_under_the_game(self):
        PAGE.set_viewport_size({"width": 390, "height": 800})
        PAGE.wait_for_function("() => !!document.querySelector('.vp-grid')")
        got = PAGE.evaluate("""() => {
            const rows = [...document.querySelectorAll('.vp-grid tbody tr:not(.vp-spacer):not(.vp-top)')];
            const list = document.querySelector('#vp-table').getBoundingClientRect();
            const game = document.querySelector('#vp-matchup').getBoundingClientRect();
            const page = document.documentElement;
            return { snap: !!document.querySelector('.vp-snap'), c: rows.map((tr) => Number(tr.querySelector('.vp-tile b').textContent)),
                     under: list.top >= game.bottom, wide: page.scrollWidth > page.clientWidth };
        }""")
        self.assertFalse(got["snap"])
        self.assertEqual(got["c"], sorted(got["c"], reverse=True))
        self.assertTrue(got["under"])
        self.assertFalse(got["wide"])

    def test_todays_teams_only_keeps_the_days_teams(self):
        got = PAGE.evaluate("""() => {
            document.querySelector('[data-vp-today]').click();
            const shown = [...document.querySelectorAll('.vp-snap .od-glabels .vp-logo')].map((b) => b.dataset.vpTeam);
            const on = document.querySelector('[data-vp-today]').classList.contains('active');
            const want = gamesOn(days()[dayIndex]).flatMap((g) => [g.away, g.home]);
            document.querySelector('[data-vp-today]').click();
            return { shown, on, want, back: document.querySelectorAll('.vp-snap .od-glabels .vp-logo').length, all: Object.keys(DATA.vs_position.teams).length };
        }""")
        self.assertTrue(got["on"])
        self.assertEqual(sorted(got["shown"]), sorted(got["want"]))
        self.assertEqual(got["back"], got["all"])

    def test_a_game_shows_both_offenses_players_in_one_lane_per_position(self):
        got = PAGE.evaluate("""() => {
            const g = currentGame();
            const boxes = [...document.querySelectorAll('.vp-box')].map((b) => b.querySelector('.team-banner').textContent);
            const away = document.querySelector('.vp-box');
            const trs = [...away.querySelectorAll('.vp-mgrid tbody tr')];
            const rows = trs.map((tr) => [tr.querySelector('.vp-pos').textContent, tr.querySelectorAll('.vp-player').length]);
            const want = ['C', 'L', 'R', 'D'].map((p) => new Set((DATA.skaters[g.away] || []).filter((x) => x.pos === p).map((x) => x.id)).size);
            // every tile of a position sits on its row's one line
            const oneLine = trs.every((tr) => new Set([...tr.querySelectorAll('.od-tile')].map((t) => Math.round(t.getBoundingClientRect().top))).size === 1);
            return { g: [g.away, g.home], boxes, rows, want, oneLine, head: away.querySelector('th[colspan]').textContent, text: away.querySelector('tbody').textContent,
                     top: [...document.querySelectorAll('.vp-snap .od-glabels .vp-logo')].slice(0, 2).map((b) => b.dataset.vpTeam) };
        }""")
        away, home = got["g"]
        self.assertIn(f"vs {home} Defense", got["boxes"][0])
        self.assertIn(f"vs {away} Defense", got["boxes"][1])
        self.assertEqual([r[0] for r in got["rows"]], ["C", "LW", "RW", "D"])
        self.assertEqual([r[1] for r in got["rows"]], got["want"])
        self.assertTrue(got["oneLine"])
        self.assertEqual(got["head"], f"{away} SOG Per Game")  # said once in the header
        self.assertNotIn("SOG/G", got["text"])  # never repeated on every tile
        self.assertEqual(sorted(got["top"]), sorted([away, home]))
        self.assertEqual(SITE.errors, [])

    def test_only_a_short_sample_shows_its_games(self):
        got = PAGE.evaluate("""() => {
            const g = currentGame();
            const hurt = new Set((DATA.injuries[g.away] || []).map((p) => p.id));
            const roster = DATA.skaters[g.away];
            const p = roster.find((x) => !hurt.has(x.id));
            const keep = p.games;
            const before = document.querySelectorAll('.vp-box')[0].querySelectorAll('.vp-gp').length;
            p.games = 1;
            render();
            const after = [...document.querySelectorAll('.vp-box')[0].querySelectorAll('.vp-gp')].map((x) => x.textContent);
            p.games = keep;
            render();
            return { before, after };
        }""")
        self.assertIn("1 GP", got["after"])
        self.assertLess(got["before"], len(got["after"]) + 1)

    def test_goals_and_points_show_the_season_total_beside_the_rate(self):
        got = PAGE.evaluate("""() => {
            const g = currentGame();
            const read = (stat) => {
                document.querySelector(`[data-vp-stat="${stat}"]`).click();
                const tiles = [...document.querySelectorAll('.vp-box')[0].querySelectorAll('.vp-player')];
                const p = (DATA.skaters[g.away] || []).filter((x) => x.pos === 'C').sort((a, b) => b[stat] / b.games - a[stat] / a.games)[0];
                const tile = tiles.find((t) => t.title.startsWith(p.name + ':'));
                return { rate: tile.querySelector('b').textContent, total: (tile.querySelector('.vp-total') || {}).textContent, want: `(${p[stat]})`,
                         spill: [...document.querySelectorAll('.vp-pnum')].filter((x) => x.scrollWidth > x.clientWidth).length };
            };
            const out = { g: read('g'), p: read('p') };
            document.querySelector('[data-vp-stat="sog"]').click();
            out.shots = document.querySelectorAll('.vp-total').length;
            return out;
        }""")
        for stat in ("g", "p"):
            self.assertRegex(got[stat]["rate"], r"^\d+\.\d\d$")
            self.assertEqual(got[stat]["total"], got[stat]["want"])
            self.assertEqual(got[stat]["spill"], 0)
        self.assertEqual(got["shots"], 0)  # shots stay a plain number a game

    def test_goals_and_points_toggles_and_a_position_sorts(self):
        got = PAGE.evaluate("""() => {
            const band = () => document.querySelector('.vp-snap .vp-snaphead span').textContent;
            const lane = () => document.querySelector('.vp-mgrid th[colspan]').textContent;
            const tile = () => document.querySelectorAll('.vp-snap tbody tr')[0].querySelectorAll('.vp-tile b')[2].textContent;
            document.querySelector('[data-vp-stat="g"]').click();
            const goals = { band: band(), lane: lane(), tile: tile() };
            document.querySelector('[data-vp-stat="p"]').click();
            const points = { band: band(), lane: lane(), tile: tile() };
            document.querySelector('[data-vp-sort="D"]').click();
            const sorted = document.querySelector('.vp-snap .vp-sorted').dataset.vpSort;
            document.querySelector('[data-vp-stat="sog"]').click();
            return { goals, points, sorted, off: currentGame().away };
        }""")
        self.assertEqual(got["goals"]["band"], "Goals Allowed Per Game")
        self.assertEqual(got["goals"]["lane"], f"{got['off']} Goals Per Game")
        self.assertRegex(got["goals"]["tile"], r"^\d+\.\d\d$")
        self.assertEqual(got["points"]["band"], "Points Allowed Per Game")
        self.assertEqual(got["points"]["lane"], f"{got['off']} Points Per Game")
        self.assertRegex(got["points"]["tile"], r"^\d+\.\d\d$")
        self.assertEqual(got["sorted"], "D")

    def test_a_saved_file_without_points_still_draws(self):
        got = PAGE.evaluate("""() => {
            for (const t of Object.values(DATA.vs_position.teams)) for (const k of Object.keys(t)) t[k] = t[k].slice(0, 9);
            document.querySelector('[data-vp-stat="p"]').click();
            const text = document.querySelector('.vp-snap .vp-tile b').textContent;
            document.querySelector('[data-vp-stat="sog"]').click();
            return text;
        }""")
        self.assertEqual(got, "--")

    def test_it_is_in_the_nhl_menu(self):
        self.assertTrue(PAGE.evaluate("() => [...document.querySelectorAll('a')].some((a) => /vs-position\\.html$/.test(a.getAttribute('href') || ''))"))


if __name__ == "__main__":
    unittest.main()
