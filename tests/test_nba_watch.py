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
        PAGE.evaluate("(src) => { window.W = new Function(src.replace(/^export /gm, '') + '; return { digest, injuryRows, lineupRows, changes, nbaWatch, reportSlot, REPRESS_MINUTES };')(); }", src)
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

    def run_watch(self, espn=ESPN, lineups=LINEUPS, refresh=None, deploy=None, now="2026-10-25T19:10:00Z", watch_block=None, reports=None, box=None, built=None, board=None):
        w = watch_block if watch_block is not None else {**block(), "rep_at": "2026-10-25T19:00Z"}
        return PAGE.evaluate("""async ([w, espn, lu, refresh, deploy, now, reports, box, built, board]) => {
            const pressed = [];
            const realFetch = window.fetch, realNow = Date.now;
            Date.now = () => Date.parse(now);
            window.fetch = async (url) => {
              if (url.includes('ak-static.cms.nba.com')) {
                const posted = (reports || {})[url.split('Injury-Report_')[1]];
                return new Response('', { status: posted ? 200 : 404, headers: posted ? { 'Last-Modified': posted } : {} });
              }
              if (url.includes('/scoreboard?dates=')) return new Response(JSON.stringify((board || {})[url.split('dates=')[1]] || { events: [] }), { status: 200 });
              if (url.includes('player_box_')) return new Response('', { status: box ? 200 : 404, headers: box ? { 'Last-Modified': box } : {} });
              const body = url.startsWith('https://nfl.gmgsports.org/version.json') ? { nba: { watch: w, built } }
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
        }""", [w, espn, lineups, refresh, deploy, now, reports, box, built, board])

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


class WaitingOnMarket(unittest.TestCase):
    """2026-10-28, Luka ruled out: the refresh ran before the books moved
    (Reaves 23.5 here, 26.5 on FanDuel). A line taken before a 20+ minute
    teammate was ruled Out that hasn't moved is held for HOLD_MINUTES, and
    the timer runs the odds again RECHECK_MINUTES after the ruling."""

    def test_a_stale_line_is_held_until_it_moves(self):
        key = "401:points:reaves"
        morning = watch.market_watch(None, {}, {key: 23.5}, "2026-10-28T14:00Z")
        ruled = watch.market_watch(morning, {"luka": "LAL"}, {key: 23.5}, "2026-10-28T20:01Z")
        self.assertEqual(watch.held_by(ruled, key, "LAL", "2026-10-28T20:01Z"), ["luka"])
        self.assertEqual(watch.held_by(ruled, key, "MIN", "2026-10-28T20:01Z"), [])  # the other team's line isn't his
        moved = watch.market_watch(ruled, {"luka": "LAL"}, {key: 26.5}, "2026-10-28T20:11Z")
        self.assertEqual(moved["outs"]["luka"]["at"], "2026-10-28T20:01Z")  # the ruling keeps its time
        self.assertEqual(watch.held_by(moved, key, "LAL", "2026-10-28T20:11Z"), [])  # the line caught up: a play again
        still = watch.market_watch(ruled, {"luka": "LAL"}, {key: 23.5}, "2026-10-28T20:41Z")
        self.assertEqual(watch.held_by(still, key, "LAL", "2026-10-28T20:41Z"), [])  # 40 minutes: the books have had their say

    def test_the_first_build_holds_nothing(self):
        # no memory yet (the first build of this, or of the day): the Out and the line are both "now"
        first = watch.market_watch(None, {"luka": "LAL"}, {"401:points:reaves": 23.5}, "2026-10-28T20:01Z")
        self.assertEqual(watch.held_by(first, "401:points:reaves", "LAL", "2026-10-28T20:01Z"), [])
        # a line first posted after the ruling already has the news in it
        later = watch.market_watch(first, {"luka": "LAL"}, {"401:points:reaves": 23.5, "401:points:lebron": 27.5}, "2026-10-28T20:06Z")
        self.assertEqual(watch.held_by(later, "401:points:lebron", "LAL", "2026-10-28T20:06Z"), [])

    def test_the_odds_again_after_a_ruling(self):
        mw = watch.market_watch(None, {"luka": "LAL"}, {}, "2026-10-28T20:01Z")
        self.assertEqual(watch.recheck(mw, "2026-10-28T20:01Z"), "2026-10-28T20:11Z")
        self.assertEqual(watch.recheck(mw, "2026-10-28T20:11Z"), "2026-10-28T20:26Z")
        self.assertEqual(watch.recheck(mw, "2026-10-28T20:26Z"), "2026-10-28T20:41Z")
        self.assertIsNone(watch.recheck(mw, "2026-10-28T20:41Z"))
        self.assertIsNone(watch.recheck({}, "2026-10-28T20:41Z"))

    def test_the_timer_presses_a_due_recheck(self):
        t = Timer()
        done = [{"status": "completed", "created_at": "2026-10-25T18:00:00Z"}]
        due = t.run_watch(refresh=done, watch_block={**block(), "rep_at": "2026-10-25T19:00Z", "recheck": "2026-10-25T19:10Z"})
        self.assertEqual(due["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "recheck"}}]])
        early = t.run_watch(refresh=done, watch_block={**block(), "rep_at": "2026-10-25T19:00Z", "recheck": "2026-10-25T19:11Z"})
        self.assertEqual(early, {"said": "nothing changed", "pressed": []})


class Report(unittest.TestCase):
    """The NBA's report (2026-10-25): a newly posted one presses the refresh
    once, with source "report" (its first step reads the PDF)."""

    def test_the_same_slot_address_as_python(self):
        import nba_report
        from datetime import datetime, timezone
        for iso in ("2026-10-25T17:08:00Z", "2026-10-25T16:00:00Z", "2026-10-26T03:59:00Z", "2026-10-25T04:14:00Z", "2026-11-02T18:31:00Z"):
            at = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            js = PAGE.evaluate("(iso) => W.reportSlot(new Date(iso))", iso)
            self.assertEqual(js["url"], nba_report.slot_url(at), iso)
            self.assertEqual(js["at"], nba_report.slot_utc(js["url"]), iso)

    def test_a_new_report_presses_once(self):
        posted = {"2026-10-25_03_15PM.pdf": "Sun, 25 Oct 2026 19:17:00 GMT"}  # 3:15 pm Eastern, up at 3:17
        # the live build read the 3:00 one; nothing else changed
        got = Timer.run_watch(self, now="2026-10-25T19:20:00Z", reports=posted, refresh=[{"status": "completed", "created_at": "2026-10-25T19:05:00Z"}])
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "report"}}]])
        # a refresh started after it was posted has read it
        got = Timer.run_watch(self, now="2026-10-25T19:25:00Z", reports=posted, refresh=[{"status": "completed", "created_at": "2026-10-25T19:20:00Z"}])
        self.assertEqual((got["pressed"], got["said"]), ([], "the 2026-10-25T19:15Z report was already read"))
        # the live build already has it, or nothing newer is posted
        self.assertEqual(Timer.run_watch(self, now="2026-10-25T19:20:00Z", reports=posted, watch_block={**block(), "rep_at": "2026-10-25T19:15Z"})["said"], "nothing changed")
        self.assertEqual(Timer.run_watch(self, now="2026-10-25T19:20:00Z")["said"], "nothing changed")
        # an injury change goes as "watch" (it reads the report too)
        later = copy.deepcopy(ESPN)
        later["injuries"][1]["injuries"][0]["status"] = "Out"
        got = Timer.run_watch(self, espn=later, now="2026-10-25T19:20:00Z", reports=posted, refresh=[{"status": "completed", "created_at": "2026-10-25T19:05:00Z"}])
        self.assertEqual(got["pressed"][0][1]["inputs"]["source"], "watch")


class Grade(unittest.TestCase):
    """Last night's plays (2026-10-26: 10-25's sat ungraded all morning, the box
    scores land about 7:35 am Eastern): while version.json nba.watch.ungraded is
    above 0 the refresh is pressed with source "grade", at most once an hour."""

    def test_waiting_plays_press_a_grading_refresh(self):
        morning = {**block(), "teams": [], "ungraded": 71}  # 8 am: tonight's teams are listed too, or not
        got = Timer.run_watch(self, watch_block=morning, refresh=[{"status": "completed", "created_at": "2026-10-25T04:45:00Z"}])
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "grade"}}]])
        got = Timer.run_watch(self, watch_block={**block(), "rep_at": "2026-10-25T19:00Z", "ungraded": 3}, refresh=[])
        self.assertEqual(got["pressed"][0][1]["inputs"]["source"], "grade")

    def test_once_an_hour_and_never_when_graded(self):
        morning = {**block(), "teams": [], "ungraded": 71}
        got = Timer.run_watch(self, watch_block=morning, refresh=[{"status": "completed", "created_at": "2026-10-25T18:20:00Z"}])
        self.assertEqual(got["pressed"], [])  # 50 minutes ago: the box scores weren't there yet
        self.assertEqual(Timer.run_watch(self, watch_block={**morning, "ungraded": 0})["said"], "no game left tonight")
        self.assertEqual(Timer.run_watch(self, deploy=[{"status": "queued"}], watch_block=morning)["pressed"], [])

    def test_new_box_scores_press_at_once(self):
        # 2026-10-30: the 8:00 press ran three minutes before the box scores landed (8:03), and the
        # hourly wait kept 10-29's plays ungraded until 9:50
        morning = {**block(), "teams": [], "ungraded": 12}
        ran = [{"status": "completed", "created_at": "2026-10-25T19:00:00Z"}]
        got = Timer.run_watch(self, watch_block=morning, refresh=ran, built="2026-10-25T19:02Z", box="Sun, 25 Oct 2026 19:03:41 GMT")
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "grade"}}]])
        # the same copy the last build (or a refresh started after it) already read: the hourly wait
        for built, started in (("2026-10-25T19:05Z", "2026-10-25T19:00:00Z"), ("2026-10-25T19:02Z", "2026-10-25T19:04:00Z")):
            got = Timer.run_watch(self, watch_block=morning, refresh=[{"status": "completed", "created_at": started}], built=built, box="Sun, 25 Oct 2026 19:03:41 GMT")
            self.assertEqual(got["pressed"], [], (built, started))

    def test_a_game_final_on_espn_presses_at_once(self):
        # 2026-10-31: three mornings running last night's plays waited on hoopR's 7:30 am files;
        # the build now lists the games still to finish and ESPN's copy grades them
        night = {**block(), "teams": [], "ungraded": 0, "grade": [["401", "20261025"], ["402", "20261025"]]}
        board = {"20261025": {"events": [{"id": "401", "status": {"type": {"completed": True}}},
                                         {"id": "402", "status": {"type": {"completed": False}}}]}}
        ran = [{"status": "completed", "created_at": "2026-10-25T18:55:00Z"}]
        got = Timer.run_watch(self, watch_block=night, refresh=ran, board=board)
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "grade"}}]])
        self.assertIn("401", got["said"])
        # under FINAL_MINUTES since the last refresh (it may be the one grading it): wait
        got = Timer.run_watch(self, watch_block=night, refresh=[{"status": "completed", "created_at": "2026-10-25T19:05:00Z"}], board=board)
        self.assertEqual(got["pressed"], [])
        # nothing final yet: nothing pressed
        got = Timer.run_watch(self, watch_block=night, refresh=ran, board={})
        self.assertEqual(got, {"said": "no game left tonight", "pressed": []})

    def test_once_after_midnight_for_last_nights_results(self):
        late = {**block(), "teams": [], "ungraded": 0, "day": "20261025"}  # the live build is from before midnight
        at = "2026-10-26T04:05:00Z"  # 12:05 am Eastern
        got = Timer.run_watch(self, watch_block=late, now=at, refresh=[{"status": "completed", "created_at": "2026-10-26T02:00:00Z"}])
        self.assertEqual(got["pressed"], [["nba-refresh.yml/dispatches", {"ref": "main", "inputs": {"source": "grade"}}]])
        # a refresh already started after midnight (still publishing): not again
        got = Timer.run_watch(self, watch_block=late, now=at, refresh=[{"status": "completed", "created_at": "2026-10-26T04:00:30Z"}])
        self.assertEqual(got["pressed"], [])

    def test_the_build_lists_the_games_still_to_finish(self):
        games = [{"game_id": "1", "date": "2026-10-24", "status": "final"}, {"game_id": "2", "date": "2026-10-25", "status": "scheduled"},
                 {"game_id": "3", "date": "2026-10-26", "status": "scheduled"}, {"game_id": "4", "date": "2026-10-27", "status": "scheduled"},
                 {"game_id": "5", "date": "2026-10-23", "status": "scheduled"}]  # three nights back: never
        self.assertEqual(watch.waiting(games, "2026-10-26"), [["2", "20261025"], ["3", "20261026"]])

    def test_the_build_counts_the_last_two_nights_only(self):
        import build_nba
        past = {"points": [{"date": "2026-10-25", "result": None}, {"date": "2026-10-25", "result": "won"},
                           {"date": "2026-10-20", "result": None}],  # a box score that never came: no hourly refresh forever
                "threes": [{"date": "2026-10-24", "result": None}, {"date": "2026-10-25", "result": "sat"}]}
        self.assertEqual(build_nba.ungraded(past, "2026-10-26"), 2)
        self.assertEqual(build_nba.ungraded(None, "2026-10-26"), 0)


class Install(unittest.TestCase):
    def test_the_crons_match(self):
        toml = (WORKER / "wrangler.toml").read_text(encoding="utf-8")
        index = (WORKER / "index.js").read_text(encoding="utf-8")
        crons = json.loads(re.search(r"^crons = (\[.*\])$", toml, flags=re.M).group(1))
        nba = re.search(r'NBA_WATCH_CRON = "([^"]+)"', index).group(1)
        self.assertEqual(crons, ["17,47 0-2,16-23 * 1-6,10-12 *", nba])
        self.assertEqual(nba, "* * * 1-6,10-12 *")  # around the clock: a game is graded the minute it's final (2026-10-31)
        self.assertIn('import { githubClient, nbaWatch } from "./watch.js";', index)


if __name__ == "__main__":
    unittest.main()
