"""NFL Vs Position (site/nfl-vs-position.js), in a real browser on the saved sample.

Pinned (a member, 2026-10-31: "how many receiving yards the Colts gave to running backs"; the owner,
2026-11-24: its own tool under the Opening Drive Tool, QB rushing and TDs too, a bad defense is red):
the page counts what each defense allowed to QB / RB / WR / TE from every player's weekly log, and
those counts equal the build's own play-by-play totals (prop_matchup_model) and TDs allowed
(team_stats); a defense's rank reads from its side (1st = allows the fewest, green); the stretch
(home / away / last N) changes the games counted; players ruled Out are left off."""
import unittest

from helpers import site_data  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nfl-vs-position.html")
        PAGE.evaluate("() => localStorage.removeItem('nfl-tool.vs-position-view.v1')")
        PAGE.reload()
        PAGE.wait_for_selector("#nvp-app:not([hidden])", timeout=20000)
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def view(stat="yds", win="season"):
    PAGE.evaluate("([s, w]) => { vpView.stat = s; vpView.win = w; renderVp(); }", [stat, win])


class Counts(unittest.TestCase):
    def test_equal_to_the_builds_play_by_play_totals(self):
        """Receiving and rushing yards a game by position, every defense, against prop_matchup_model."""
        got = PAGE.evaluate("""() => {
            const out = {};
            for (const t of VP.teams) {
                vpView.win = 'season';
                vpView.stat = 'yds';
                const rec = ['RB', 'WR', 'TE'].map((p) => vpAllowed(t, p));
                vpView.stat = 'rush';
                out[t] = { rec, rush: ['QB', 'RB'].map((p) => vpAllowed(t, p)), games: VP.games[t].length };
            }
            vpView.stat = 'yds';
            return out;
        }""")
        games = (site_data()["prop_matchup_model"] or {})["games"]
        self.assertGreaterEqual(len(got), 30)
        for team, mine in got.items():
            rows = [g for g in games if g["def"] == team]
            self.assertEqual(len(rows), mine["games"], team)
            per = lambda k: sum(g["v"].get(k, 0) for g in rows) / len(rows)  # noqa: E731
            for i, p in enumerate(("RB", "WR", "TE")):
                self.assertAlmostEqual(mine["rec"][i], per(f"recyds_{p}"), delta=6, msg=f"{team} rec yds to {p}s")
            for i, p in enumerate(("QB", "RB")):
                self.assertAlmostEqual(mine["rush"][i], per(f"rushyds_{p}"), delta=6, msg=f"{team} rush yds to {p}s")

    def test_tds_add_up_to_the_teams_tds_allowed(self):
        """Rushing + receiving TDs at every position = the pass and rush TDs the defense allowed."""
        got = PAGE.evaluate("""() => {
            vpView.stat = 'td'; vpView.win = 'season';
            const out = Object.fromEntries(VP.teams.map((t) => [t, Math.round(['QB', 'RB', 'WR', 'TE'].reduce((s, p) => s + vpAllowed(t, p), 0) * VP.games[t].length)]));
            vpView.stat = 'yds';
            return out;
        }""")
        stats = site_data()["team_stats"]
        for team, tds in got.items():
            self.assertEqual(tds, stats[team]["pass_td_allowed"] + stats[team]["rush_td_allowed"], team)


class Page(unittest.TestCase):
    def tearDown(self):
        view()

    def test_no_script_errors_and_both_offenses_drawn(self):
        view()
        self.assertEqual(PAGE.locator(".nvp-side").count(), 2)
        self.assertEqual(PAGE.locator("#nvp-teams tbody tr").count(), PAGE.evaluate("() => VP.teams.length"))
        self.assertEqual(SITE.errors, [])

    def test_each_stat_has_its_positions(self):
        for stat, rows in (("yds", ["RB", "WR", "TE"]), ("rush", ["QB", "RB"]), ("td", ["QB", "RB", "WR", "TE"])):
            view(stat)
            self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.nvp-side')[0].querySelectorAll('tbody .nvp-pos')].map((c) => c.textContent)"), rows, stat)

    def test_a_bad_defense_is_red(self):
        """1st = allows the fewest (green), last = allows the most (red), on the shared rank colors."""
        view()
        got = PAGE.evaluate("""() => {
            const vals = VP.teams.map((t) => [t, vpAllowed(t, 'WR')]).sort((a, b) => a[1] - b[1]);
            const [best, worst] = [vals[0][0], vals[vals.length - 1][0]];
            return { best: vpDefRank(best, 'WR'), worst: vpDefRank(worst, 'WR'), bestStyle: rankScaleStyle(vpDefRank(best, 'WR').rank, 32), redStyle: rankScaleStyle(32, 32), worstStyle: rankScaleStyle(vpDefRank(worst, 'WR').rank, vpDefRank(worst, 'WR').of), greenStyle: rankScaleStyle(1, 32) };
        }""")
        self.assertEqual(got["best"]["rank"], 1)
        self.assertEqual(got["worst"]["rank"], got["worst"]["of"])
        self.assertEqual(got["bestStyle"], got["greenStyle"])
        self.assertEqual(got["worstStyle"], got["redStyle"])

    def test_the_stretch_changes_the_games(self):
        got = PAGE.evaluate("""() => Object.fromEntries(['season', 'home', 'away', '3'].map((w) => { vpView.win = w; return [w, vpGames('ARI').length]; }))""")
        self.assertEqual(got["home"] + got["away"], got["season"])
        self.assertEqual(got["3"], min(3, got["season"]))

    def test_a_player_ruled_out_is_left_off(self):
        view()
        got = PAGE.evaluate("""() => {
            const team = document.getElementById('away-select').value;
            const top = vpPlayers(team, 'WR')[0].name;
            const keep = DATA.roster_out;
            DATA.roster_out = { ...(keep || {}), [team]: [...((keep || {})[team] || []), { name: top, status: 'RES' }] };
            rosterOut.cache = null;
            try { return { top, after: vpPlayers(team, 'WR').map((x) => x.name) }; }
            finally { DATA.roster_out = keep; rosterOut.cache = null; }
        }""")
        self.assertNotIn(got["top"], got["after"])


if __name__ == "__main__":
    unittest.main()
