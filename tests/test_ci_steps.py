"""The decisions the GitHub workflows make (tools/ci_steps.py) and the live
data download they rely on (tools/fetch_live_data.py).

Nobody but the owner can read the repo's Actions page, so these can't be
debugged from a log: they are pinned here instead.

What is pinned: every push to main runs the whole deploy (every test, every
sport built, every page checked), and a failed NBA or NHL build has its live
data put back instead of publishing without it; the hockey-only refresh never
publishes over a full rebuild, never publishes code that isn't live, and
never publishes a folder with a live data file missing; every publish is
followed by a look at the real site, and one that leaves it down is undone;
a download is only
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

from helpers import nhl_data, nhl_saves, nhl_shots  # first: puts tools/ on the import path

import ci_steps
import fetch_live_data

ROOT = Path(__file__).resolve().parent.parent
SHA = "4259e69a38ebd031e33c9615bec3b3b59a93c0f8"
LIVE = {"sha": SHA, "run": "38437162110", "built": "2026-10-13T17:17Z", "nba": {"built": "2026-10-13T17:17Z", "lines": 14}, "nhl": {"built": "2026-10-13T17:17Z", "lineups": 8, "shots": 29}}


class DeploySteps(unittest.TestCase):
    """deploy.yml's small helpers and the sports' separate styles."""

    def test_each_sports_styles_live_in_its_own_file(self):
        """Hockey's styles sat in the shared style.css, so every hockey change that
        touched one set off every sport's tests. They live in nhl/nhl.css now, the
        layout the NBA and NHL pages share in suite.css, and neither may drift back."""
        site = ROOT / "nfl_tool" / "site"
        shared = (site / "style.css").read_text(encoding="utf-8")
        for word in (".nhl-", ".shots-", ".crease-", ".nba-"):
            self.assertNotIn(word, shared, f"{word} rules belong in nhl/nhl.css or suite.css")
        self.assertNotIn(".nba-", (site / "nhl" / "nhl.css").read_text(encoding="utf-8").replace(" .nba-", "").replace(".nba-notag", ""))
        for page in ("nhl/index.html", "nhl/best.html", "nhl/shots.html", "nhl/promo-tools.html"):
            html = (site / page).read_text(encoding="utf-8")
            order = [html.index(f'href="{name}"') for name in ("../style.css", "../suite.css", "nhl.css")]
            self.assertEqual(order, sorted(order), page)
        nba = (site / "nba" / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="../suite.css"', nba)
        self.assertNotIn("nhl.css", nba)
        for nfl_page in site.glob("*.html"):
            self.assertNotIn("suite.css", nfl_page.read_text(encoding="utf-8"), nfl_page.name)

    def test_only_a_whole_sha_counts_as_the_live_version(self):
        self.assertIsNone(ci_steps.live_sha(None))
        self.assertIsNone(ci_steps.live_sha({"sha": "not a sha"}))
        self.assertIsNone(ci_steps.live_sha({"sha": "4259e69"}))
        self.assertEqual(ci_steps.live_sha(LIVE), SHA)

    def test_stage_timings(self):
        marks = ["start 1000", "install 1048", "tests 1081", "nfl 1150", "gate 1190", "junk", "bad x"]
        self.assertEqual(ci_steps.timings(marks), {"install": 48, "tests": 33, "nfl": 69, "gate": 40, "total": 190})
        self.assertEqual(ci_steps.timings(["start 1000"]), {})


class FastLane(unittest.TestCase):
    """Which pushes may publish with the live data (ci_steps.lane_decision)."""

    def test_page_files_tests_and_notes_take_the_fast_lane(self):
        changed = ["nfl_tool/site/nhl/icebreaker.js", "nfl_tool/site/nhl/nhl.css", "tests/test_nhl_icebreaker_site.py", ".claude/rules/nhl.md", "CLAUDE.md", "model_history/nhl_goals/2026-10.json"]
        self.assertEqual(ci_steps.lane_decision("push", changed)[0], "pages")

    def test_anything_that_can_change_the_data_rebuilds(self):
        for path in ("nfl_tool/nhl/build_nhl.py", "nfl_tool/smartstake.py", "nfl_tool/functions/_middleware.js", "tools/ci_steps.py",
                     ".github/workflows/deploy.yml", "nfl_tool/requirements.txt", "nfl_tool/novig_event_markets.graphql", ".gitignore"):
            self.assertEqual(ci_steps.lane_decision("push", ["nfl_tool/site/app.js", path])[0], "full", path)

    def test_only_a_push_and_only_when_it_can_tell(self):
        page = ["nfl_tool/site/app.js"]
        self.assertEqual(ci_steps.lane_decision("schedule", page)[0], "full")
        self.assertEqual(ci_steps.lane_decision("workflow_dispatch", page)[0], "full")
        self.assertEqual(ci_steps.lane_decision("push", None)[0], "full")
        self.assertEqual(ci_steps.lane_decision("push", [])[0], "full")


class VersionNote(unittest.TestCase):
    def test_the_nhl_note(self):
        with tempfile.TemporaryDirectory() as folder:
            site = Path(folder)
            (site / "nhl").mkdir()
            data = {**nhl_data(), "feed_debug": {**nhl_data().get("feed_debug", {}), "lineups": 6,
                                                 "unlisted": [{"game": "1", "team": "BOS", "id": "8479325", "name": "Charlie McAvoy"}]}}
            (site / "nhl" / "data.json").write_text(json.dumps(data), encoding="utf-8")
            (site / "nhl" / "shots.json").write_text(json.dumps(nhl_shots()), encoding="utf-8")
            (site / "nhl" / "saves.json").write_text(json.dumps(nhl_saves()), encoding="utf-8")
            note = ci_steps.suite_note(site, "nhl")
            self.assertEqual(note["saves"], sum(any(r["line"] is not None for r in g["goalies"]) for g in nhl_saves()["games"].values()))  # games with a saves line
            self.assertEqual(note["built"], data["generated_at"])
            self.assertEqual((note["lineups"], note["shots"]), (6, len(nhl_shots()["games"])))
            self.assertEqual(note["lines"], data["novig_debug"]["matched"])
            self.assertEqual(note["games"], data["feed_debug"]["games_loaded"])
            self.assertEqual(note["unlisted"], ["Charlie McAvoy (BOS)"])  # the tripwire
            # A build that failed left no file.
            self.assertIsNone(ci_steps.suite_note(site, "nba")["built"])

    def test_a_failed_build_with_its_live_copy_says_why(self):
        """The live copy keeps its own (older) build time, and the failed
        build's last line is shown beside it."""
        with tempfile.TemporaryDirectory() as folder:
            site, root = Path(folder) / "site", Path(folder)
            (site / "nhl").mkdir(parents=True)
            (site / "nhl" / "data.json").write_text(json.dumps(nhl_data()), encoding="utf-8")
            (root / "nhl_build.log").write_text("Loading games\nRuntimeError: the NHL feed timed out\n\n", encoding="utf-8")
            with mock.patch.object(ci_steps, "ROOT", root):
                note = ci_steps.suite_note(site, "nhl", failed=True)
                self.assertEqual(note["built"], nhl_data()["generated_at"])
                self.assertEqual(note["error"], "RuntimeError: the NHL feed timed out")
                self.assertNotIn("error", ci_steps.suite_note(site, "nhl"))
                self.assertEqual(ci_steps.suite_note(site, "nba"), {"built": None})


class HockeyRefresh(unittest.TestCase):
    """nhl-refresh.yml: when it may publish."""

    def decide(self, event="schedule", live=LIVE, busy=False, code_is_live=True, ahead=5, first=None, now=None):
        return ci_steps.refresh_decision(event, live, busy, code_is_live, ahead, first, now)[0]

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
        # The Cloudflare timer (a button press marked "timer") stops like the schedule.
        self.assertFalse(self.decide(event="timer", ahead=0))
        self.assertTrue(self.decide(event="timer", ahead=3))

    def test_the_github_backup_skips_when_the_timer_just_ran(self):
        """GitHub's hourly timer is only a backup for the Cloudflare one (it
        ran 1 of 6 hours on 2026-10-15): it stays out of the way when the NHL
        data is under 25 minutes old, and runs when it is older or unknown."""
        live = {**LIVE, "nhl": {"built": "2026-10-15T21:29Z"}}
        at = lambda hour, minute: datetime(2026, 10, 15, hour, minute, tzinfo=timezone.utc)
        self.assertFalse(self.decide(live=live, now=at(21, 47)))   # 18 minutes old
        self.assertTrue(self.decide(live=live, now=at(21, 59)))    # 30 minutes old
        self.assertTrue(self.decide(live={**LIVE, "nhl": {"built": None}}, now=at(21, 47)))
        self.assertTrue(self.decide(live=live))                    # the check right before publishing
        # The Cloudflare timer and the owner's button never wait on it.
        self.assertTrue(self.decide(event="timer", live=live, now=at(21, 47)))
        self.assertTrue(self.decide(event="workflow_dispatch", live=live, now=at(21, 47)))
        self.assertAlmostEqual(ci_steps.minutes_since("2026-10-15T21:29Z", at(21, 47)), 18)
        self.assertIsNone(ci_steps.minutes_since(None, at(21, 47)))

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
            "koe_weeks.json": {"boards": {}, "results": {}},
            "nba/data.json": {"teams": {}},
            "nba/props.json": {"seasons": {}},
            "nhl/data.json": {"teams": {"NJD": {}, "DET": {}}},
            "nhl/shots.json": {"games": {}},
            "nhl/crease.json": {"days": {}},
            "nhl/goals.json": {"games": {}},
            "nhl/points.json": {"games": {}},
            "nhl/lines.json": {"games": {}},
            "nhl/saves.json": {"games": {}},
            "nhl/icebreaker.json": {"days": {}},
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
        self.assertEqual(self.here(), ["data.json", "koe_weeks.json", "nba/data.json", "nba/props.json"])
        self.assertEqual(self.asked, ["data.json", "koe_weeks.json", "nba/data.json", "nba/props.json"])

    def test_nba_props_not_live_yet_is_not_an_error(self):
        """The first deploy after nba/props.json was added: a refresh before it
        must still put the rest back, and a reused deploy builds instead."""
        del self.live["nba/props.json"]
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 0)
        self.assertEqual(self.here(), ["data.json", "koe_weeks.json", "nba/data.json"])
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba"]), 1)

    def test_king_of_the_endzones_weeks_not_live_yet_is_not_an_error(self):
        """The first deploy after koe_weeks.json was added: a refresh before it
        must still put the NFL data back."""
        del self.live["koe_weeks.json"]
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 0)
        self.assertEqual(self.here(), ["data.json", "nba/data.json", "nba/props.json"])
        # A reused deploy needs every NFL file, so it builds instead.
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "--need", "nfl"]), 1)

    def test_a_suite_that_is_not_live_is_not_an_error(self):
        del self.live["nba/data.json"]  # the last NBA build failed: nothing to put back
        del self.live["nba/props.json"]
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 0)
        self.assertEqual(self.here(), ["data.json", "koe_weeks.json"])

    def test_strict_stops_when_a_live_file_cannot_be_downloaded(self):
        self.live["nba/data.json"] = 503
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba", "--strict"]), 1)
        self.assertEqual(self.asked.count("nba/data.json"), fetch_live_data.TRIES)
        # The daily site check carries on without it.
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "nba"]), 0)

    def test_a_hiccup_is_tried_again(self):
        self.live["data.json"] = [urllib.error.URLError("timed out"), 502, {"teams": ["BUF"]}]
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "--strict"]), 0)
        self.assertEqual(self.asked, ["data.json"] * 3 + ["koe_weeks.json"])
        self.assertEqual(json.loads((self.site / "data.json").read_text()), {"teams": ["BUF"]})

    def test_the_login_page_is_never_saved_as_data(self):
        """A wrong key is answered with the login page and a 200."""
        self.live["data.json"] = b"<!doctype html><html><body>GMG Sports Data Suite: log in</body></html>"
        self.assertEqual(fetch_live_data.main(["--only", "nfl"]), 1)
        self.assertNotIn("data.json", self.here())
        self.live["data.json"] = b'["a list is not the data file"]'
        self.assertEqual(fetch_live_data.main(["--only", "nfl"]), 1)
        self.assertNotIn("data.json", self.here())

    def test_no_nfl_data_always_stops(self):
        del self.live["data.json"]
        self.assertEqual(fetch_live_data.main([]), 1)

    def test_need_wants_every_file_of_the_suite(self):
        """The deploy reuses a suite's live data only if all of it arrived."""
        self.assertEqual(fetch_live_data.main(["--only", "nhl", "--need", "nhl"]), 0)
        self.assertEqual(self.here(), sorted(rel for rel in self.live if rel.startswith("nhl/")))
        for gone in ("nhl/shots.json", "nhl/crease.json", "nhl/goals.json", "nhl/points.json", "nhl/lines.json", "nhl/icebreaker.json", "nhl/saves.json", "nhl/players/DET.json", "nhl/data.json"):
            for path in self.site.rglob("*.json"):
                path.unlink()
            kept = self.live.pop(gone)
            self.assertEqual(fetch_live_data.main(["--only", "nhl", "--need", "nhl"]), 1, gone)
            self.live[gone] = kept
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba"]), 0)
        del self.live["nba/data.json"]
        (self.site / "nba" / "data.json").unlink()
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba"]), 1)

    def test_replace_clears_what_a_failed_build_left(self):
        """The deploy after a failed NHL build: a half-written file and a team
        that is no longer in the data must not be published."""
        (self.site / "nhl" / "players").mkdir(parents=True)
        (self.site / "nhl" / "data.json").write_text('{"half": ', encoding="utf-8")
        (self.site / "nhl" / "players" / "SEA.json").write_text("{}", encoding="utf-8")
        (self.site / "data.json").write_text('{"built": "here"}', encoding="utf-8")
        self.assertEqual(fetch_live_data.main(["--only", "nhl", "--need", "nhl", "--replace"]), 0)
        self.assertEqual(self.here(), ["data.json"] + sorted(rel for rel in self.live if rel.startswith("nhl/")))
        self.assertEqual(json.loads((self.site / "nhl" / "data.json").read_text()), self.live["nhl/data.json"])
        self.assertEqual(json.loads((self.site / "data.json").read_text()), {"built": "here"})  # other suites untouched
        # If the live copy can't be had, nothing half-built is left behind.
        (self.site / "nba").mkdir(exist_ok=True)
        (self.site / "nba" / "data.json").write_text('{"half": ', encoding="utf-8")
        self.live["nba/data.json"] = 503
        self.assertEqual(fetch_live_data.main(["--only", "nba", "--need", "nba", "--replace"]), 1)
        self.assertFalse((self.site / "nba" / "data.json").exists())

    def test_a_file_already_here_is_left_alone(self):
        self.site.joinpath("data.json").write_text('{"local": true}', encoding="utf-8")
        self.assertEqual(fetch_live_data.main(["--only", "nfl", "--strict"]), 0)
        self.assertEqual(self.asked, ["koe_weeks.json"])
        self.assertEqual(json.loads((self.site / "data.json").read_text()), {"local": True})

    def test_it_only_runs_with_the_build_key(self):
        with mock.patch.dict(fetch_live_data.os.environ, clear=True):
            self.assertEqual(fetch_live_data.main([]), 2)
        self.assertEqual(self.asked, [])


class LiveCheck(unittest.TestCase):
    """After every publish: is the real site answering, and if not, the
    version from before it goes back (the owner, 2026-10-13: the site being
    down for members "CANNOT happen")."""

    VERSION = {"sha": SHA, "run": "1", "built": "2026-10-13T21:00Z"}
    KEY = "build-key"

    def site(self, **changes):
        """A fake live site: {path: (status, body)}, healthy unless changed."""
        pages = {
            "": (401, b"<html><h1>GMG Sports Data <b>Suite</b></h1></html>"),
            "auth/status": (200, json.dumps({"gate": "on", "profiles": True}).encode()),
            "version.json": (200, json.dumps(self.VERSION).encode()),
            "data.json": (200, json.dumps({"schedule": [{"game_id": "1"}], "teams": ["BUF"]}).encode()),
            **{rel: (200, b"x" * 2000) for rel in ci_steps.LIVE_FILES},
        }
        pages.update(changes)

        def get(path, key=None):
            rel = path.split("?")[0]
            if rel in ("data.json", *ci_steps.LIVE_FILES) and key != self.KEY:
                return pages[""]  # no key: the sign-in page, like the real site
            return pages[rel]

        return get

    def verdict(self, get, expected=None, **kw):
        return ci_steps.live_verdict(get, expected or self.VERSION, self.KEY, rounds=3, sleep=lambda s: None, **kw)

    def test_a_healthy_site_on_the_new_version_passes(self):
        self.assertEqual(self.verdict(self.site()), ("ok", []))

    def test_what_counts_as_down(self):
        down = {
            "the login code crashing": {"": (500, b"error 1101"), "auth/status": (500, b"")},
            "no answer at all": {"": (None, b"")},
            "the member database not connected": {"auth/status": (200, json.dumps({"gate": "on", "profiles": False}).encode())},
            "the login switched off by a missing secret": {"": (200, b"<html>GMG Sports Data</html>"), "auth/status": (200, json.dumps({"gate": "off", "profiles": True}).encode())},
            "the data file missing": {"data.json": (404, b"")},
            "the sign-in page where the data should be": {"data.json": (200, b"<html>GMG Sports Data</html>")},
            "an empty data file": {"data.json": (200, b"{}")},
            "a page missing": {"game-overview.html": (404, b"")},
            "the stylesheet missing": {"style.css": (404, b"")},
        }
        for what, changes in down.items():
            verdict, problems = self.verdict(self.site(**changes))
            self.assertEqual(verdict, "down", what)
            self.assertTrue(problems, what)

    def test_a_slow_hand_over_is_not_an_outage(self):
        """The old version for the first two looks, the new one on the third."""
        looks = {"n": 0}
        old, new = self.site(**{"version.json": (200, json.dumps({**self.VERSION, "run": "0"}).encode())}), self.site()

        def get(path, key=None):
            if path.startswith("version.json"):
                looks["n"] += 1  # the first request of each look
            return (old if looks["n"] <= 2 else new)(path, key)

        self.assertEqual(self.verdict(get), ("ok", []))
        self.assertEqual(looks["n"], 3)

    def test_the_old_version_still_being_served_fails_without_going_back(self):
        verdict, problems = self.verdict(self.site(), expected={**self.VERSION, "run": "2"})
        self.assertEqual(verdict, "not-served")
        self.assertIn("still serving the version from before", problems[0])

    def test_a_site_opened_on_purpose_is_not_expected_to_show_the_sign_in_page(self):
        opened = self.site(**{"": (200, b"<html>the site</html>"), "auth/status": (200, json.dumps({"gate": "off", "profiles": True}).encode())})
        self.assertEqual(self.verdict(opened, gate=False), ("ok", []))
        self.assertTrue(ci_steps.gate_is_on())  # today the login is on, so the sign-in page is expected

    def test_without_the_build_key_only_the_public_checks_run(self):
        self.assertEqual(ci_steps.live_problems(self.site(**{"data.json": (404, b"")}), None), [])
        self.assertTrue(ci_steps.live_problems(self.site(**{"": (500, b"")}), None))

    def test_going_back_picks_the_version_from_before_this_publish(self):
        d = lambda i, status="success", stage="deploy", env="production": {"id": i, "environment": env, "latest_stage": {"name": stage, "status": status}}
        self.assertEqual(ci_steps.step_back_target([d("new"), d("before"), d("older")]), "before")
        # Never the one just published, a failed one, an unfinished one or a preview.
        self.assertEqual(ci_steps.step_back_target([d("new"), d("x", "failure"), d("y", stage="build"), d("z", env="preview"), d("good")]), "good")
        self.assertIsNone(ci_steps.step_back_target([d("new")]))
        self.assertIsNone(ci_steps.step_back_target(None))

    def test_going_back_asks_cloudflare_for_exactly_that(self):
        calls = []

        def api(method, path):
            calls.append((method, path))
            return {"success": True, "result": [{"id": "new", "latest_stage": {"name": "deploy", "status": "success"}}, {"id": "before", "latest_stage": {"name": "deploy", "status": "success"}}]}

        self.assertEqual(ci_steps.step_back(api), (True, "the version from before this publish is back"))
        self.assertEqual(calls, [("GET", "deployments?env=production&per_page=10"), ("POST", "deployments/before/rollback")])
        self.assertFalse(ci_steps.step_back(lambda method, path: None)[0])  # Cloudflare can't be reached: says so, doesn't crash

    def test_the_command_goes_back_only_when_the_site_is_down(self):
        went_back = []
        cases = (("ok", [], 0, 0), ("not-served", ["old"], 1, 0), ("down", ["the login code isn't answering"], 1, 1))
        for verdict, problems, code, backs in cases:
            went_back.clear()
            with mock.patch.object(ci_steps, "live_verdict", return_value=(verdict, problems)), \
                 mock.patch.object(ci_steps, "step_back", side_effect=lambda: went_back.append(1) or (True, "back")), \
                 mock.patch.object(ci_steps, "live_problems", return_value=[]), mock.patch.object(ci_steps.time, "sleep"), \
                 mock.patch.dict(ci_steps.os.environ, {}, clear=True):
                self.assertEqual(ci_steps.main(["live-check"]), code, verdict)
            self.assertEqual(len(went_back), backs, verdict)

    def test_looking_never_goes_back(self):
        with mock.patch.object(ci_steps, "live_get", self.site(**{"": (500, b"")})), mock.patch.object(ci_steps, "step_back") as back, \
             mock.patch.dict(ci_steps.os.environ, {}, clear=True):
            self.assertEqual(ci_steps.main(["live-check", "--look"]), 1)
        back.assert_not_called()


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

    def test_every_push_to_main_runs_the_deploy(self):
        """Since 2026-10-15 (the repo is public, build minutes are free): no
        folder filter, no per-sport plan, every test and every page checked
        on every run. A folder filter once left a fix to a failed deploy
        unpublished, and a per-sport test list once failed a deploy."""
        trigger = self.deploy.split("permissions:")[0]
        self.assertIn("  push:\n    branches: [main]\n", trigger)
        self.assertNotIn("paths", trigger)
        for gone in ("steps.plan", "ci_steps.py plan", "SCOPE", "HOUSEKEEPING", "Reuse the live"):
            self.assertNotIn(gone, self.deploy)
        self.assertIn('python tools/run_tests.py || { echo "Retrying once..."; sleep 5; python tools/run_tests.py; }', self.deploy)
        self.assertIn('python tools/check_site.py --gate || { echo "Retrying once..."; sleep 5; python tools/check_site.py --gate; }', self.deploy)
        steps = {block.splitlines()[0].strip(): block for block in self.deploy.split("      - name: ")[1:]}
        for always in ("Run the tests", "Choose the lane", "Check the site before it goes live",
                       "Push Discord secrets to Cloudflare", "Member profile database (D1)", "Refuse to publish without the member database", "Deploy to Cloudflare Pages"):
            self.assertFalse(any(line.startswith("        if:") for line in steps[always].splitlines()), always)
        self.assertNotIn("command: pages project create", self.deploy)
        # The tests come before anything is built.
        self.assertLess(self.deploy.index("- name: Run the tests"), self.deploy.index("- name: Build stats"))

    def test_a_page_only_push_publishes_with_the_live_data(self):
        """The fast lane (2026-10-15): the builds are skipped only when the
        lane is "pages" AND every live data file arrived; otherwise they all
        run. The tests and the gate run either way."""
        steps = {block.splitlines()[0].strip(): block for block in self.deploy.split("      - name: ")[1:]}
        names = list(steps)
        full = "        if: steps.lane.outputs.lane != 'pages' || steps.live_data.outcome != 'success'\n"
        for build in ("Build stats (nflverse needs no key; SGO_API_KEY is optional)", "Build NBA data", "Restore saved NHL games", "Build NHL data", "Save NHL games", "Save GMG model record"):
            self.assertIn(full, steps[build], build)
        live = steps["Use the live data (page-only push)"]
        self.assertIn("id: live_data", live)
        self.assertIn("if: steps.lane.outputs.lane == 'pages'", live)
        self.assertIn("continue-on-error: true", live)
        self.assertIn("python tools/fetch_live_data.py --need nfl nba nhl", live)
        self.assertIn("DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}", live)
        self.assertIn("id: lane", steps["Choose the lane"])
        self.assertLess(names.index("Run the tests"), names.index("Choose the lane"))
        self.assertEqual(names.index("Use the live data (page-only push)"), names.index("Choose the lane") + 1)
        self.assertLess(names.index("Use the live data (page-only push)"), names.index("Build stats (nflverse needs no key; SGO_API_KEY is optional)"))
        self.assertIn("LANE: ${{ steps.lane.outputs.lane }}", steps["Note the run in version.json"])

    def test_the_nfl_build_is_tried_twice(self):
        """nflverse sometimes answers with a one-off 404; every push builds football."""
        build = "python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json"
        self.assertIn(f'{build} || {{ echo "Retrying once..."; sleep 30; {build}; }}', self.deploy)

    def test_a_failed_nba_or_nhl_build_puts_the_live_copy_back(self):
        """Never publish the site without a sport's data: the step after each
        build runs only if it failed, clears what it left and downloads the
        live copy; version.json says which happened."""
        steps = {block.splitlines()[0].strip(): block for block in self.deploy.split("      - name: ")[1:]}
        names = list(steps)
        for suite in ("nba", "nhl"):
            up = suite.upper()
            back_name = f"Put the live {up} data back (the {up} build failed)"
            build, back = steps[f"Build {up} data"], steps[back_name]
            self.assertIn(f"id: build_{suite}", build)
            self.assertIn("continue-on-error: true", build)
            self.assertIn(f"| tee {suite}_build.log", build)
            self.assertIn(f"id: back_{suite}", back)
            self.assertIn(f"if: steps.build_{suite}.outcome == 'failure'", back)
            self.assertIn("continue-on-error: true", back)
            self.assertIn(f"run: python tools/fetch_live_data.py --only {suite} --need {suite} --replace", back)
            self.assertIn("DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}", back)
            self.assertEqual(names.index(back_name), names.index(f"Build {up} data") + 1)
            self.assertIn(f"DATA_{up}: ${{{{ steps.build_{suite}.outcome == 'success' && 'built' || ((steps.back_{suite}.outcome == 'success' || steps.live_data.outcome == 'success') && 'live copy' || 'missing') }}}}", steps["Note the run in version.json"])
        # Both before the gate, so the live copy is checked like a fresh build.
        self.assertLess(names.index("Put the live NHL data back (the NHL build failed)"), names.index("Check the site before it goes live"))

    def test_both_publishes_are_followed_by_the_live_check(self):
        """The last step of each workflow, straight after the publish, and in
        the deploy never conditional. It holds the Cloudflare token it needs to
        put the last version back."""
        for text, python in ((self.deploy, "python"), (self.refresh, "python3")):
            last = text.split("      - name: ")[-1]
            self.assertTrue(last.startswith("Check the live site (and put the last version back if it is down)"), last[:60])
            self.assertIn(f"run: {python} tools/ci_steps.py live-check\n", last)
            self.assertNotIn("--look", last)
            self.assertNotIn("continue-on-error", last)
            for secret in ("DISCORD_BOT_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
                self.assertIn(f"{secret}: ${{{{ secrets.{secret} }}}}", last)
            self.assertIn("command: pages deploy", text.split("      - name: ")[-2])
        self.assertNotIn("        if:", self.deploy.split("      - name: ")[-1])


if __name__ == "__main__":
    unittest.main()
