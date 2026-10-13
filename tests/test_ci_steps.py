"""The decisions the GitHub workflows make (tools/ci_steps.py) and the live
data download they rely on (tools/fetch_live_data.py).

Nobody but the owner can read the repo's Actions page, so these can't be
debugged from a log: they are pinned here instead.

What is pinned: a push rebuilds only the suites whose build code changed and
a scheduled or manual run rebuilds everything; the hockey-only refresh never
publishes over a full rebuild, never publishes code that isn't live, and
never publishes a folder with a live data file missing; a download is only
kept if it is real JSON (a wrong key gets the login page back with a 200);
and the refresh publishes with the same database binding and build command
as the deploy.
"""
import io
import json
import re
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from helpers import nhl_data, nhl_shots  # first: puts tools/ on the import path

import ci_steps
import fetch_live_data

ROOT = Path(__file__).resolve().parent.parent
SHA = "4259e69a38ebd031e33c9615bec3b3b59a93c0f8"
LIVE = {"sha": SHA, "run": "38437162110", "built": "2026-10-13T17:17Z", "nba": {"built": "2026-10-13T17:17Z", "lines": 14}, "nhl": {"built": "2026-10-13T17:17Z", "lineups": 8, "shots": 29}}


class Plan(unittest.TestCase):
    """deploy.yml: what a run has to rebuild."""

    def test_the_scheduled_refresh_and_update_odds_rebuild_everything(self):
        for event in ("schedule", "workflow_dispatch"):
            self.assertEqual(ci_steps.plan(event, ["nfl_tool/site/style.css"]), {"nfl": "build", "nba": "build", "nhl": "build", "housekeeping": "yes"})

    def test_a_push_that_only_changes_the_site_rebuilds_no_data(self):
        changed = ["nfl_tool/site/style.css", "nfl_tool/site/nhl/shots.js", "nfl_tool/site/game-summary.js", "nfl_tool/functions/_middleware.js"]
        self.assertEqual(ci_steps.plan("push", changed), {"nfl": "reuse", "nba": "reuse", "nhl": "reuse", "housekeeping": "no"})

    def test_a_push_rebuilds_only_the_suite_whose_build_code_changed(self):
        only = lambda suite, changed: self.assertEqual({s: how for s, how in ci_steps.plan("push", changed).items() if how == "build"}, {suite: "build"}, changed)
        only("nhl", ["nfl_tool/nhl/build_nhl.py", "nfl_tool/site/nhl/shots.js"])
        only("nhl", ["nfl_tool/nhl/shots_model.py"])
        only("nba", ["nfl_tool/nba/build_nba.py"])
        for path in ("nfl_tool/build_stats.py", "nfl_tool/gmg_model.py", "nfl_tool/line_grades.py", "nfl_tool/novig_event_markets.graphql", "nfl_tool/requirements.txt"):
            only("nfl", [path])

    def test_files_outside_the_site_change_nothing(self):
        # The record the deploy bot commits, the tests, the tools and the notes.
        changed = ["model_history/gmg_model.json", "model_history/nhl_shots/2026-10.json", "tests/test_nhl.py", "tools/check_site.py", "docs/history.md", "CLAUDE.md"]
        self.assertEqual(set(ci_steps.plan("push", changed).values()), {"reuse", "no"})
        self.assertEqual(set(ci_steps.plan("push", []).values()), {"reuse", "no"})

    def test_anything_unclear_rebuilds_everything(self):
        everything = {"nfl": "build", "nba": "build", "nhl": "build", "housekeeping": "yes"}
        self.assertEqual(ci_steps.plan("push", None), everything)  # the live version couldn't be read or compared
        self.assertEqual(ci_steps.plan("", ["nfl_tool/site/style.css"]), everything)
        # deploy.yml holds the build commands and the member tables: a change to it runs it all.
        self.assertEqual(ci_steps.plan("push", [".github/workflows/deploy.yml", "nfl_tool/site/style.css"]), everything)

    def test_a_push_about_one_sport_checks_that_sport_only(self):
        """The owner: working on one sport must never test or touch another."""
        scope = lambda *changed: ci_steps.work_scope("push", list(changed))
        self.assertEqual(scope("nfl_tool/site/nhl/promo-tools.js", "nfl_tool/nhl/build_nhl.py", "tests/test_nhl_saves.py", "tests/fixtures/nhl_crease.json.gz", ".claude/rules/nhl.md", "docs/history.md", "CLAUDE.md"), "nhl")
        self.assertEqual(scope("nfl_tool/nba/build_nba.py", "nfl_tool/site/nba/nba.js"), "nba")
        self.assertEqual(scope("nfl_tool/site/game-summary.js", "nfl_tool/build_stats.py", "tests/test_site_js.py", "model_history/gmg_model.json"), "nfl")
        self.assertEqual(scope("model_history/nhl_shots/2026-10.json", "nfl_tool/site/nhl/shots.js"), "nhl")

    def test_shared_files_and_mixed_pushes_check_everything(self):
        scope = lambda *changed: ci_steps.work_scope("push", list(changed))
        for shared in ("nfl_tool/site/style.css", "nfl_tool/site/sync.js", "nfl_tool/functions/_middleware.js", "tools/check_site.py", "tests/helpers.py", "tests/site_browser.py", ".github/workflows/deploy.yml", "something/new.txt"):
            self.assertEqual(scope("nfl_tool/site/nhl/shots.js", shared), "all", shared)
        self.assertEqual(scope("nfl_tool/site/nhl/shots.js", "nfl_tool/site/app.js"), "all")
        self.assertEqual(scope("docs/history.md"), "all")  # nothing to go on
        self.assertEqual(ci_steps.work_scope("push", None), "all")
        self.assertEqual(ci_steps.work_scope("schedule", ["nfl_tool/site/nhl/shots.js"]), "all")

    def test_each_sports_styles_live_in_its_own_file(self):
        """Hockey's styles sat in the shared style.css, so every hockey change that
        touched one set off every sport's tests. They live in nhl/nhl.css now, the
        layout the NBA and NHL pages share in suite.css, and neither may drift back."""
        site = ROOT / "nfl_tool" / "site"
        shared = (site / "style.css").read_text(encoding="utf-8")
        for word in (".nhl-", ".shots-", ".crease-", ".nba-"):
            self.assertNotIn(word, shared, f"{word} rules belong in nhl/nhl.css or suite.css")
        self.assertNotIn(".nba-", (site / "nhl" / "nhl.css").read_text(encoding="utf-8").replace(" .nba-", "").replace(".nba-notag", ""))
        for page in ("nhl/index.html", "nhl/shots.html", "nhl/promo-tools.html"):
            html = (site / page).read_text(encoding="utf-8")
            order = [html.index(f'href="{name}"') for name in ("../style.css", "../suite.css", "nhl.css")]
            self.assertEqual(order, sorted(order), page)
        nba = (site / "nba" / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="../suite.css"', nba)
        self.assertNotIn("nhl.css", nba)
        for nfl_page in site.glob("*.html"):
            self.assertNotIn("suite.css", nfl_page.read_text(encoding="utf-8"), nfl_page.name)
        self.assertEqual(ci_steps.work_scope("push", ["nfl_tool/site/nhl/nhl.css", "nfl_tool/site/nhl/shots.js"]), "nhl")
        self.assertEqual(ci_steps.work_scope("push", ["nfl_tool/site/suite.css"]), "all")

    def test_every_test_file_belongs_to_a_sport_the_runner_knows(self):
        import run_tests
        files = sorted(path.name for path in (ROOT / "tests").glob("test_*.py"))
        self.assertEqual({run_tests.sport_of(name) for name in files} - {"nfl", "nba", "nhl", "ci"}, set())
        for name in files:
            # The runner and the plan must agree on whose test it is.
            planned = ci_steps.sport_of(f"tests/{name}")
            self.assertEqual(planned, "all" if run_tests.sport_of(name) == "ci" else run_tests.sport_of(name), name)

    def test_the_deploy_hands_the_scope_to_the_tests_and_the_browser_check(self):
        deploy = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        self.assertLess(deploy.index("- name: Plan the run"), deploy.index("- name: Run the tests"))
        self.assertIn('python tools/run_tests.py --only "$SCOPE"', deploy)
        self.assertIn('python tools/check_site.py --gate --only "$SCOPE"', deploy)
        self.assertEqual(deploy.count("SCOPE: ${{ steps.plan.outputs.scope || 'all' }}"), 2)

    def test_the_comparison_is_with_what_is_live(self):
        """Not with the push before: a sha that isn't one stops the comparison."""
        self.assertIsNone(ci_steps.changed_since_live(None))
        self.assertIsNone(ci_steps.changed_since_live({"sha": "not a sha"}))
        self.assertIsNone(ci_steps.live_sha({"sha": "4259e69"}))
        self.assertEqual(ci_steps.live_sha(LIVE), SHA)

    def test_stage_timings(self):
        marks = ["start 1000", "install 1048", "tests 1081", "nfl 1150", "gate 1190", "junk", "bad x"]
        self.assertEqual(ci_steps.timings(marks), {"install": 48, "tests": 33, "nfl": 69, "gate": 40, "total": 190})
        self.assertEqual(ci_steps.timings(["start 1000"]), {})


class VersionNote(unittest.TestCase):
    def test_the_nhl_note(self):
        with tempfile.TemporaryDirectory() as folder:
            site = Path(folder)
            (site / "nhl").mkdir()
            data = {**nhl_data(), "feed_debug": {**nhl_data().get("feed_debug", {}), "lineups": 6}}
            (site / "nhl" / "data.json").write_text(json.dumps(data), encoding="utf-8")
            (site / "nhl" / "shots.json").write_text(json.dumps(nhl_shots()), encoding="utf-8")
            note = ci_steps.suite_note(site, "nhl")
            self.assertEqual(note["built"], data["generated_at"])
            self.assertEqual((note["lineups"], note["shots"]), (6, len(nhl_shots()["games"])))
            self.assertEqual(note["lines"], data["novig_debug"]["matched"])
            self.assertEqual(note["games"], data["feed_debug"]["games_loaded"])
            # A build that failed left no file.
            self.assertIsNone(ci_steps.suite_note(site, "nba")["built"])


class HockeyRefresh(unittest.TestCase):
    """nhl-refresh.yml: when it may publish."""

    def decide(self, event="schedule", live=LIVE, busy=False, code_is_live=True, ahead=5, first=None):
        return ci_steps.refresh_decision(event, live, busy, code_is_live, ahead, first)[0]

    def test_it_goes_when_nothing_else_is_publishing_and_main_is_live(self):
        self.assertTrue(self.decide())
        self.assertTrue(self.decide(first=dict(LIVE)))

    def test_never_over_a_full_rebuild(self):
        self.assertFalse(self.decide(busy=True))
        self.assertFalse(self.decide(busy=None))  # GitHub couldn't be asked
        self.assertTrue(ci_steps.runs_busy([{"status": "completed"}, {"status": "queued"}]))
        self.assertTrue(ci_steps.runs_busy([{"status": "in_progress"}]))
        self.assertFalse(ci_steps.runs_busy([{"status": "completed"}, {"status": "completed"}]))
        self.assertFalse(ci_steps.runs_busy([]))

    def test_never_code_that_is_not_live(self):
        self.assertFalse(self.decide(code_is_live=False))  # a push whose deploy failed its tests
        self.assertFalse(self.decide(code_is_live=None))
        self.assertFalse(self.decide(live=None))
        self.assertFalse(self.decide(live={"sha": ""}))

    def test_not_if_the_site_was_republished_meanwhile(self):
        self.assertFalse(self.decide(first={**LIVE, "run": "999"}))
        self.assertFalse(self.decide(first={**LIVE, "nhl_refresh": {"at": "2026-10-13T18:47Z"}}))
        self.assertFalse(self.decide(first={}))  # the first check's note is gone

    def test_a_scheduled_run_with_no_game_coming_stops(self):
        self.assertFalse(self.decide(ahead=0))
        self.assertTrue(self.decide(ahead=None))  # the schedule couldn't be read: go ahead
        # The owner's button and a change to the workflow always run.
        self.assertTrue(self.decide(event="workflow_dispatch", ahead=0))
        self.assertTrue(self.decide(event="push", ahead=0))

    def test_games_about_to_start(self):
        schedule = {"gameWeek": [
            {"date": "2026-10-13", "games": [{"startTimeUTC": "2026-10-13T17:00:00Z"}, {"startTimeUTC": "2026-10-13T23:00:00Z"}, {"startTimeUTC": "2026-10-14T02:30:00Z"}]},
            {"date": "2026-10-14", "games": [{"startTimeUTC": "2026-10-14T23:00:00Z"}, {"startTimeUTC": None}, {}]},
        ]}
        at = lambda hour, minute=47: datetime(2026, 10, 13, hour, minute, tzinfo=timezone.utc)
        self.assertEqual(ci_steps.games_ahead(schedule, at(16)), 3)
        self.assertEqual(ci_steps.games_ahead(schedule, at(23)), 1)   # only the late game is left
        self.assertEqual(ci_steps.games_ahead(schedule, datetime(2026, 10, 14, 2, 47, tzinfo=timezone.utc)), 0)  # tomorrow's is 20 hours off
        self.assertIsNone(ci_steps.games_ahead(None, at(16)))
        self.assertIsNone(ci_steps.games_ahead({"error": "x"}, at(16)))

    def test_the_stamp_keeps_the_full_rebuilds_own_details(self):
        stamped = ci_steps.refresh_stamp(LIVE, {"built": "2026-10-13T18:48Z", "lineups": 12}, datetime(2026, 10, 13, 18, 48, tzinfo=timezone.utc), 777, 61)
        self.assertEqual((stamped["sha"], stamped["run"], stamped["built"], stamped["nba"]), (SHA, LIVE["run"], LIVE["built"], LIVE["nba"]))
        self.assertEqual(stamped["nhl"], {"built": "2026-10-13T18:48Z", "lineups": 12})
        self.assertEqual(stamped["nhl_refresh"], {"at": "2026-10-13T18:48Z", "run": "777", "seconds": 61})
        self.assertNotIn("nhl_refresh", LIVE)

    def test_a_folder_with_a_live_file_missing_is_never_published(self):
        with tempfile.TemporaryDirectory() as folder:
            site = Path(folder)
            teams = {"NJD": {}, "DET": {}}
            write = lambda rel, value: ((site / rel).parent.mkdir(parents=True, exist_ok=True), (site / rel).write_text(json.dumps(value), encoding="utf-8"))
            write("data.json", {"teams": []})
            write("nba/data.json", {"teams": {}})
            write("nhl/data.json", {"teams": teams, "schedule": [], "generated_at": "2026-10-13T18:48Z"})
            write("nhl/shots.json", {"games": {}})
            for abbr in teams:
                write(f"nhl/players/{abbr}.json", {})
            self.assertEqual(ci_steps.refresh_problems(site, LIVE), [])
            # Each file that is live has to be there.
            for rel, word in (("nhl/players/DET.json", "player file"), ("nhl/shots.json", "Shots"), ("nba/data.json", "NBA"), ("data.json", "NFL")):
                kept = (site / rel).read_text(encoding="utf-8")
                (site / rel).unlink()
                problems = ci_steps.refresh_problems(site, LIVE)
                self.assertTrue(any(word in p for p in problems), (rel, problems))
                (site / rel).write_text(kept, encoding="utf-8")
            # An NBA build that had failed (nothing live) isn't missed.
            (site / "nba" / "data.json").unlink()
            self.assertEqual(ci_steps.refresh_problems(site, {**LIVE, "nba": {"built": None}}), [])
            # A hockey build that wrote nothing usable, or no saved live version.
            write("nhl/data.json", {"teams": {}, "schedule": []})
            self.assertTrue(ci_steps.refresh_problems(site, {**LIVE, "nba": {"built": None}}))
            self.assertTrue(ci_steps.refresh_problems(site, None))


class Reply:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class LiveData(unittest.TestCase):
    """tools/fetch_live_data.py, with the live site played by `self.live`."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.site = Path(self.folder.name)
        self.live = {
            "data.json": {"teams": ["BUF"]},
            "nba/data.json": {"teams": {}},
            "nhl/data.json": {"teams": {"NJD": {}, "DET": {}}},
            "nhl/shots.json": {"games": {}},
            "nhl/crease.json": {"days": {}},
            "nhl/players/NJD.json": {"season": {}},
            "nhl/players/DET.json": {"season": {}},
        }
        self.asked = []
        for patch in (
            mock.patch.object(fetch_live_data, "SITE", self.site),
            mock.patch.object(fetch_live_data.time, "sleep", lambda seconds: None),
            mock.patch.object(fetch_live_data.urllib.request, "urlopen", self.urlopen),
            mock.patch.dict(fetch_live_data.os.environ, {"DISCORD_BOT_TOKEN": "a-test-token"}),
            mock.patch("sys.stdout", io.StringIO()),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def urlopen(self, request, timeout=None):
        rel = request.full_url.split("gmgsports.org/", 1)[1]
        self.asked.append(rel)
        self.assertTrue(request.get_header("X-gmg-build"))
        answer = self.live.get(rel)
        if answer is None:
            raise urllib.error.HTTPError(request.full_url, 404, "Not Found", None, None)
        if isinstance(answer, list):  # one answer per try
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, int):
            raise urllib.error.HTTPError(request.full_url, answer, "Error", None, None)
        if isinstance(answer, Exception):
            raise answer
        return Reply(answer if isinstance(answer, bytes) else json.dumps(answer).encode())

    def here(self):
        return sorted(str(p.relative_to(self.site)).replace("\\", "/") for p in self.site.rglob("*.json"))

    def test_everything_by_default(self):
        self.assertEqual(fetch_live_data.main([]), 0)
        self.assertEqual(self.here(), sorted(self.live))

    def test_the_hockey_refresh_takes_the_other_suites_only(self):
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 0)
        self.assertEqual(self.here(), ["data.json", "nba/data.json"])
        self.assertEqual(self.asked, ["data.json", "nba/data.json"])

    def test_a_suite_that_is_not_live_is_not_an_error(self):
        del self.live["nba/data.json"]  # the last NBA build failed: nothing to put back
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 0)
        self.assertEqual(self.here(), ["data.json"])

    def test_strict_stops_when_a_live_file_cannot_be_downloaded(self):
        self.live["nba/data.json"] = 503
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 1)
        self.assertEqual(self.asked.count("nba/data.json"), fetch_live_data.TRIES)
        # The daily site check carries on without it.
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba"]), 0)

    def test_a_hiccup_is_tried_again(self):
        self.live["data.json"] = [urllib.error.URLError("timed out"), 502, {"teams": ["BUF"]}]
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "--strict"]), 0)
        self.assertEqual(self.asked, ["data.json"] * 3)
        self.assertEqual(json.loads((self.site / "data.json").read_text()), {"teams": ["BUF"]})

    def test_the_login_page_is_never_saved_as_data(self):
        """A wrong key is answered with the login page and a 200."""
        self.live["data.json"] = b"<!doctype html><html><body>GMG Sports Data Suite: log in</body></html>"
        self.assertEqual(fetch_live_data.main(["--only", "nfl"]), 1)
        self.assertEqual(self.here(), [])
        self.live["data.json"] = b'["a list is not the data file"]'
        self.assertEqual(fetch_live_data.main(["--only", "nfl"]), 1)
        self.assertEqual(self.here(), [])

    def test_no_nfl_data_always_stops(self):
        del self.live["data.json"]
        self.assertEqual(fetch_live_data.main([]), 1)

    def test_need_wants_every_file_of_the_suite(self):
        """The deploy reuses a suite's live data only if all of it arrived."""
        self.assertEqual(fetch_live_data.main(["--only", "nhl", "--need", "nhl"]), 0)
        self.assertEqual(self.here(), sorted(rel for rel in self.live if rel.startswith("nhl/")))
        for gone in ("nhl/shots.json", "nhl/crease.json", "nhl/players/DET.json", "nhl/data.json"):
            for path in self.site.rglob("*.json"):
                path.unlink()
            kept = self.live.pop(gone)
            self.assertEqual(fetch_live_data.main(["--only", "nhl", "--need", "nhl"]), 1, gone)
            self.live[gone] = kept
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba"]), 0)
        del self.live["nba/data.json"]
        (self.site / "nba" / "data.json").unlink()
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba"]), 1)

    def test_a_file_already_here_is_left_alone(self):
        self.site.joinpath("data.json").write_text('{"local": true}', encoding="utf-8")
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "--strict"]), 0)
        self.assertEqual(self.asked, [])
        self.assertEqual(json.loads((self.site / "data.json").read_text()), {"local": True})

    def test_it_only_runs_with_the_build_key(self):
        with mock.patch.dict(fetch_live_data.os.environ, clear=True):
            self.assertEqual(fetch_live_data.main([]), 2)
        self.assertEqual(self.asked, [])


class WorkflowsInStep(unittest.TestCase):
    """The hockey refresh republishes the whole site, so what it shares with
    the deploy has to stay word for word the same."""

    @classmethod
    def setUpClass(cls):
        read = lambda name: (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
        cls.deploy, cls.refresh, cls.check = read("deploy.yml"), read("nhl-refresh.yml"), read("site-check.yml")

    def test_every_generated_site_file_is_put_back(self):
        """.gitignore lists the files the builds write into the site folder;
        each must be one the download knows, or a republish would drop it."""
        ignored = [line.strip() for line in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines() if line.startswith("nfl_tool/site/")]
        known = {f"nfl_tool/site/{rel}" for files in fetch_live_data.SUITES.values() for rel in files} | {f"nfl_tool/site/{fetch_live_data.NHL_PLAYERS}"}
        self.assertEqual(set(ignored), known)
        self.assertGreaterEqual(len(ignored), 5)

    def test_the_same_database_binding(self):
        binding = lambda text: re.findall(r"^\s+echo (['\"].*)$", text, flags=re.M)
        self.assertEqual(binding(self.refresh), binding(self.deploy))
        self.assertEqual(len(binding(self.refresh)), 7)
        self.assertIn('[[d1_databases]]', "".join(binding(self.refresh)))
        for text in (self.deploy, self.refresh):
            self.assertIn('grep -q "d1_databases" nfl_tool/wrangler.toml', text)

    def test_the_same_hockey_build_and_the_same_publish(self):
        build = lambda text: re.search(r"python3? (nfl_tool/nhl/build_nhl\.py --season \d+ --out \S+ --data-dir \S+)", text).group(1)
        publish = lambda text: re.search(r"command: (pages deploy .*)", text).group(1)
        self.assertEqual(build(self.refresh), build(self.deploy))
        self.assertEqual(publish(self.refresh), publish(self.deploy))
        self.assertIn("workingDirectory: nfl_tool", self.refresh)

    def test_the_refresh_asks_twice_and_publishes_only_on_two_yeses(self):
        self.assertEqual(self.refresh.count("tools/ci_steps.py refresh-check"), 2)
        self.assertIn("if: steps.check.outputs.go == 'yes' && steps.still.outputs.go == 'yes'", self.refresh)
        # Every step after the first check waits on it.
        steps = self.refresh.split("      - name: ")[2:]
        self.assertTrue(all("steps.check.outputs.go == 'yes'" in step for step in steps), [s.splitlines()[0] for s in steps])
        # It installs nothing: the machine's own Python, the standard library.
        self.assertNotIn("pip install", self.refresh)
        self.assertNotIn("playwright", self.refresh)

    def test_the_site_check_runs_once_a_day_not_after_every_deploy(self):
        self.assertNotIn("workflow_run", self.check)
        self.assertIn('cron: "57 12 * * *"', self.check)
        self.assertNotIn("Refresh NHL lineups", self.check)

    def test_the_deploy_builds_whatever_it_could_not_reuse(self):
        """A "Reuse" step may fail (it is continue-on-error); the build after it
        runs unless the reuse SUCCEEDED, so no plan and no download can leave a
        suite without data."""
        steps = {block.splitlines()[0].strip(): block for block in self.deploy.split("      - name: ")[1:]}
        for suite, build in (("nfl", "Build stats (nflverse needs no key; SGO_API_KEY is optional)"), ("nba", "Build NBA data"), ("nhl", "Build NHL data")):
            reuse = next(block for name, block in steps.items() if name.startswith(f"Reuse the live {suite.upper()} data"))
            self.assertIn(f"if: steps.plan.outputs.{suite} == 'reuse'", reuse)
            self.assertIn("continue-on-error: true", reuse)
            self.assertIn(f"fetch_live_data.py --only {suite} --need {suite}", reuse)
            self.assertIn(f"if: steps.reuse_{suite}.outcome != 'success'", steps[build])
        # The plan itself can't stop a deploy, and the gate, the binding and the publish are never conditional.
        self.assertIn("continue-on-error: true", steps["Plan the run"])
        for always in ("Run the tests", "Check the site before it goes live", "Member profile database (D1)", "Refuse to publish without the member database", "Deploy to Cloudflare Pages"):
            self.assertFalse(any(line.startswith("        if:") for line in steps[always].splitlines()), always)
        # Housekeeping is skipped only on a plain "no" (an empty plan runs it).
        self.assertIn("if: steps.plan.outputs.housekeeping != 'no'", steps["Push Discord secrets to Cloudflare"])
        self.assertIn('if [ "$HOUSEKEEPING" = "no" ]; then exit 0; fi', steps["Member profile database (D1)"])
        binding, tables = steps["Member profile database (D1)"].split('if [ "$HOUSEKEEPING" = "no" ]')
        self.assertIn("} > wrangler.toml", binding)
        self.assertNotIn("wrangler.toml", tables)
        self.assertNotIn("command: pages project create", self.deploy)


if __name__ == "__main__":
    unittest.main()
