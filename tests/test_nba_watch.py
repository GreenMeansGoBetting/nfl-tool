"""The NBA injury watch (2026-10-25): nfl_tool/nba/watch.py (the build's
fingerprints of what tonight's sims read: ESPN's injury statuses and the
NBA's posted fives) and its twin in the Cloudflare timer
(workers/nhl-timer/watch.js), which compares them every minute and presses
nba-refresh.yml on a change.

What is pinned: the two sides give the same fingerprints to the letter on the
same sample (one that never matched would refresh all night); only tonight's
teams that haven't tipped count; a status change, a new player on the list or
a new five changes it, the order things come in doesn't; and when the timer
presses: a change, nothing else refreshing or rebuilding, not within 4 minutes
of the last refresh; a source that can't be read is left out, not counted as
a change; the crons in wrangler.toml are the ones index.js knows."""
import copy
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import watch  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402

WORKER = ROOT / "workers" / "nhl-timer"


def athlete(pid, name):
    return {"displayName": name, "links": [{"href": f"https://www.espn.com/nba/player/_/id/{pid}/x"}],
            "notes": {"items": [{"id": "1"}]}, "$ref": f"http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/{pid}?lang=en"}


ESPN = {"injuries": [
    {"id": "20", "displayName": "Philadelphia 76ers", "injuries": [
        {"status": "Out", "athlete": athlete(3059318, "Joel Embiid")},
        {"status": "Day-To-Day", "athlete": athlete(4432166, "Kelly Oubre Jr.")}]},
    {"id": "8", "displayName": "Detroit Pistons", "injuries": [{"status": "Questionable", "athlete": athlete(4432446, "Jalen Durén")}]},
    {"id": "2", "displayName": "Boston Celtics", "injuries": [{"status": "Out", "athlete": athlete(1, "Someone Else")}]},
]}
LINEUPS = {"games": [{"homeTeam": {"teamAbbreviation": "PHI", "players": [
    {"playerName": n, "rosterStatus": "Active", "lineupStatus": "Expected"} for n in ("Tyrese Maxey", "VJ Edgecombe", "Jaylen Brown", "LeBron James", "Adem Bona")]
    + [{"playerName": "Joel Embiid", "rosterStatus": "Inactive", "lineupStatus": "Expected"}]},
    "awayTeam": {"teamAbbreviation": "DET", "players": [{"playerName": "Cade Cunningham", "rosterStatus": "Active", "lineupStatus": "Confirmed"}]}},
    {"homeTeam": {"teamAbbreviation": "BOS", "players": []}, "awayTeam": {"teamAbbreviation": "NYK", "players": []}}]}
GAMES = [{"date": "2026-10-25", "home": "PHI", "away": "DET", "start_utc": "2026-10-25T23:30Z"},
         {"date": "2026-10-25", "home": "BOS", "away": "NY", "start_utc": "2026-10-25T17:00Z"},  # already tipped
         {"date": "2026-10-26", "home": "LAL", "away": "SA", "start_utc": "2026-10-27T02:30Z"}]  # tomorrow
TEAMS = {"PHI": {"id": 20}, "DET": {"id": 8}, "BOS": {"id": 2}, "NY": {"id": 18}, "LAL": {"id": 13}, "SA": {"id": 24}}
NBA_ABBR = {"NYK": "NY", "SAS": "SA"}


def block(espn=ESPN, lineups=LINEUPS):
    return watch.block(GAMES, TEAMS, NBA_ABBR, "2026-10-25", "2026-10-25T19:00Z", espn, lineups)


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.context.new_page()
        PAGE.goto(f"{SITE.origin}/style.css")  # any page on 127.0.0.1: crypto.subtle needs a secure address
        src = (WORKER / "watch.js").read_text(encoding="utf-8")
        PAGE.evaluate("(src) => { window.W = new Function(src.replace(/^export /gm, '') + '; return { digest, injuryRows, lineupRows, changes, nbaWatch, REPRESS_MINUTES };')(); }", src)
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    SITE.close()


def js_block(w, espn, lineups):
    return PAGE.evaluate("async ([w, espn, lu]) => ({ inj: await W.digest(W.injuryRows(espn, w.teams)), lu: await W.digest(W.lineupRows(lu, w.nba)) })", [w, espn, lineups])


class Fingerprints(unittest.TestCase):
    def test_only_tonights_teams_that_havent_tipped(self):
        b = block()
        self.assertEqual((b["day"], b["teams"], b["nba"]), ("20261025", [8, 20], ["DET", "PHI"]))
        self.assertEqual(sorted(watch.injury_rows(ESPN, {8, 20})), ["3059318:Out", "4432166:Day-To-Day", "4432446:Questionable"])
        # the sim's five: Embiid is Inactive, the rest Expected / Confirmed
        self.assertEqual(sorted(watch.lineup_rows(LINEUPS, {"DET", "PHI"})),
                         ["DET=Cade Cunningham", "PHI=Adem Bona|Jaylen Brown|LeBron James|Tyrese Maxey|VJ Edgecombe"])

    def test_the_timer_gets_the_same_fingerprints(self):
        b = block()
        self.assertEqual(js_block(b, ESPN, LINEUPS), {"inj": b["inj"], "lu": b["lu"]})
        self.assertEqual(js_block(b, {}, {}), {"inj": watch.digest([]), "lu": watch.digest([])})

    def test_a_change_changes_it_the_order_doesnt(self):
        b = block()
        later = copy.deepcopy(ESPN)
        later["injuries"][0]["injuries"][1]["status"] = "Out"
        self.assertNotEqual(block(later)["inj"], b["inj"])
        added = copy.deepcopy(ESPN)
        added["injuries"][1]["injuries"].append({"status": "Out", "athlete": athlete(9, "New Guy")})
        self.assertNotEqual(block(added)["inj"], b["inj"])
        other_team = copy.deepcopy(ESPN)
        other_team["injuries"][2]["injuries"][0]["status"] = "Questionable"  # Boston already tipped
        self.assertEqual(block(other_team)["inj"], b["inj"])
        shuffled = copy.deepcopy(ESPN)
        shuffled["injuries"].reverse()
        shuffled["injuries"][-1]["injuries"].reverse()
        self.assertEqual(block(shuffled)["inj"], b["inj"])
        new_five = copy.deepcopy(LINEUPS)
        new_five["games"][0]["homeTeam"]["players"][4]["playerName"] = "Kelly Oubre Jr."
        self.assertNotEqual(block(lineups=new_five)["lu"], b["lu"])
        self.assertEqual(block(lineups=None)["lu"], watch.digest([]))  # not posted yet (a 404)
        self.assertIsNone(block(espn=None)["inj"])  # ESPN couldn't be read: the timer refreshes until it can


class Timer(unittest.TestCase):
    """nbaWatch with ESPN, the NBA, version.json and GitHub stood in for."""

    def run_watch(self, espn=ESPN, lineups=LINEUPS, refresh=None, deploy=None, now="2026-10-25T19:10:00Z", watch_block=None):
        w = watch_block if watch_block is not None else block()
        return PAGE.evaluate("""async ([w, espn, lu, refresh, deploy, now]) => {
            const pressed = [];
            const realFetch = window.fetch, realNow = Date.now;
            Date.now = () => Date.parse(now);
            window.fetch = async (url) => {
              const body = url.startsWith('https://nfl.gmgsports.org/version.json') ? { nba: { watch: w } }
                : url.includes('espn.com') ? espn : url.includes('stats.nba.com') ? lu : null;
              if (body === 'fail') return new Response('', { status: 500 });
              if (body === null) return new Response('', { status: 404 });
              return new Response(JSON.stringify(body), { status: 200 });
            };
            const github = async (path, body) => {
              if (body) { pressed.push([path, body]); return null; }
              return { workflow_runs: path.startsWith('nba-refresh') ? (refresh || []) : (deploy || []) };
            };
            try { return { said: await W.nbaWatch({}, github), pressed }; }
            finally { window.fetch = realFetch; Date.now = realNow; }
        }""", [w, espn, lineups, refresh, deploy, now])

    def test_nothing_changed_nothing_pressed(self):
        self.assertEqual(self.run_watch(), {"said": "nothing changed", "pressed": []})

    def test_a_player_ruled_out_presses_the_nba_refresh(self):
        later = copy.deepcopy(ESPN)
        later["injuries"][1]["injuries"][0]["status"] = "Out"
        got = self.run_watch(espn=later, refresh=[{"status": "completed", "created_at": "2026-10-25T18:00:00Z"}])
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "watch"}}]])
        self.assertIn("inj", got["said"])

    def test_never_stacked(self):
        later = copy.deepcopy(LINEUPS)
        later["games"][0]["homeTeam"]["players"][0]["playerName"] = "Quentin Grimes"
        for refresh, deploy in (([{"status": "in_progress", "created_at": "2026-10-25T19:08:00Z"}], []),
                                ([{"status": "completed", "created_at": "2026-10-25T19:07:00Z"}], []),  # 3 minutes ago
                                ([], [{"status": "completed"}, {"status": "queued"}])):
            self.assertEqual(self.run_watch(lineups=later, refresh=refresh, deploy=deploy)["pressed"], [], (refresh, deploy))
        self.assertEqual(len(self.run_watch(lineups=later, refresh=[{"status": "completed", "created_at": "2026-10-25T19:05:00Z"}])["pressed"]), 1)

    def test_a_source_that_cant_be_read_isnt_a_change(self):
        self.assertEqual(self.run_watch(espn="fail")["pressed"], [])
        self.assertEqual(self.run_watch(lineups="fail")["pressed"], [])
        self.assertEqual(self.run_watch(watch_block={**block(), "teams": []})["said"], "no game left tonight")
        # the lineups not posted yet (404) on both sides: no change
        self.assertEqual(self.run_watch(lineups=None, watch_block=block(lineups=None))["pressed"], [])


class Install(unittest.TestCase):
    def test_the_crons_match(self):
        toml = (WORKER / "wrangler.toml").read_text(encoding="utf-8")
        index = (WORKER / "index.js").read_text(encoding="utf-8")
        crons = json.loads(re.search(r"^crons = (\[.*\])$", toml, flags=re.M).group(1))
        nba = re.search(r'NBA_WATCH_CRON = "([^"]+)"', index).group(1)
        self.assertEqual(crons, ["17,47 0-2,16-23 * 1-6,10-12 *", nba])
        self.assertEqual(nba, "* 0-4,15-23 * 1-6,10-12 *")
        self.assertIn('import { githubClient, nbaWatch } from "./watch.js";', index)


if __name__ == "__main__":
    unittest.main()
