"""The decisions the GitHub workflows make, kept here so they can be tested
(tests/test_ci_steps.py) instead of living as shell inside the YAML.

    python tools/ci_steps.py plan                  # deploy.yml: what does this run have to rebuild?
    python tools/ci_steps.py mark NAME             # deploy.yml: a stage just ended (for version.json's timing)
    python tools/ci_steps.py note                  # deploy.yml: the NBA / NHL notes, what was reused, the timings
    python tools/ci_steps.py refresh-check         # nhl-refresh.yml: anything to refresh, and safe to publish?
    python tools/ci_steps.py refresh-check --again # nhl-refresh.yml: the same question right before publishing
    python tools/ci_steps.py refresh-stamp         # nhl-refresh.yml: check the new NHL files, note the refresh

Why they exist (2026-10-13): the repo went private, which put the builds on
GitHub's 2,000 free minutes a month, and every run did everything: a lineup
check or a one-line style change rebuilt football, basketball and hockey.

  * A push only rebuilds the suites whose build code it changed (`plan`); the
    others' data is taken exactly as it is live (fetch_live_data.py).
  * Hockey lineups and odds are refreshed hourly by a small job that rebuilds
    only the NHL files and republishes (`refresh-*`).

Nobody but the owner can read the repo's Actions page, so each run says what
it did in the public version.json: `data` (built / reused per suite),
`timing` (seconds per stage) and `nhl_refresh`.

Standard library only: the hockey refresh runs on the machine's own Python
with nothing installed.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "nfl_tool" / "site"
LIVE = "https://nfl.gmgsports.org"
DEPLOY_YML = ".github/workflows/deploy.yml"
SUITES = ("nfl", "nba", "nhl")
# A scheduled refresh is skipped when no NHL game starts within this many hours.
REFRESH_WINDOW_HOURS = 14


# ---- small plumbing ----
def state_dir() -> Path:
    return Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir())


def output(**values):
    """Hand values to the workflow's later steps (and print them)."""
    lines = [f"{key}={value}" for key, value in values.items()]
    print("\n".join(lines))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def summary(text):
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text + "\n")


def get_json(url, headers=None, timeout=20, tries=2):
    """The JSON at a URL, or None."""
    for attempt in range(tries):
        if attempt:
            time.sleep(2)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "gmg-ci/1.0", **(headers or {})})
            with urllib.request.urlopen(request, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:
            print(f"{url.split('?')[0]}: {e}")
    return None


def live_version():
    """What is published right now (version.json is served without the login)."""
    found = get_json(f"{LIVE}/version.json?t={int(time.time())}")
    return found if isinstance(found, dict) else None


def git(*args):
    """A git command's output, or None if it failed."""
    try:
        done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=120)
    except Exception:
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def have_commit(sha):
    """Make sure a commit is in this checkout (the workflows clone only the
    newest one), without turning a full local clone into a shallow one."""
    if git("cat-file", "-e", f"{sha}^{{commit}}") is not None:
        return True
    shallow = git("rev-parse", "--is-shallow-repository") == "true"
    return git("fetch", "--quiet", *(["--depth=1"] if shallow else []), "origin", sha) is not None


def live_sha(live):
    sha = str((live or {}).get("sha") or "")
    return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def read_json(path):
    try:
        found = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return found if isinstance(found, dict) else None


# ---- deploy.yml: what does this run have to rebuild? ----
BUILD_ALL = {"nfl": "build", "nba": "build", "nhl": "build", "housekeeping": "yes"}
# Under nfl_tool/, everything that isn't the site itself, the login code or
# another suite's build is the NFL build (build_stats.py, gmg_model.py,
# line_grades.py, the Novig query, requirements.txt).
NOT_THE_NFL_BUILD = ("nfl_tool/site/", "nfl_tool/functions/", "nfl_tool/nba/", "nfl_tool/nhl/")


def plan(event, changed):
    """{"nfl" / "nba" / "nhl": "build" or "reuse", "housekeeping": "yes" or "no"}.

    `changed` is every file that differs between the code that is live and
    the code being deployed (None when that can't be worked out).

    The 6-hour refresh and "Update Odds" exist to get fresh data: they build
    everything. A push exists to publish a code change: it rebuilds only the
    suites whose build code changed, and the rest of the data goes out
    exactly as it is live. Anything unclear builds everything.

    Housekeeping is the Cloudflare upkeep that only matters when something
    was changed outside the code (a secret, the member tables): it runs on
    the scheduled and manual runs, and on a push that edits deploy.yml,
    where the tables are defined.
    """
    if event != "push" or changed is None or DEPLOY_YML in changed:
        return dict(BUILD_ALL)
    touched = lambda folder: any(path.startswith(folder) for path in changed)
    return {
        "nfl": "build" if any(path.startswith("nfl_tool/") and not path.startswith(NOT_THE_NFL_BUILD) for path in changed) else "reuse",
        "nba": "build" if touched("nfl_tool/nba/") else "reuse",
        "nhl": "build" if touched("nfl_tool/nhl/") else "reuse",
        "housekeeping": "no",
    }


def changed_since_live(live):
    """Files that differ between the live code and this checkout, or None.
    Compared with what is LIVE, not with the push before this one: if an
    earlier push's deploy failed or was skipped, its changes still count."""
    sha = live_sha(live)
    if not sha or not have_commit(sha):
        return None
    names = git("diff", "--name-only", sha, "HEAD")
    return None if names is None else [line for line in names.splitlines() if line]


def cmd_plan(args):
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    changed = changed_since_live(live_version()) if event == "push" else None
    decided = plan(event, changed)
    output(**decided)
    summary(f"Run type: {event or 'unknown'}. " + ", ".join(f"{suite.upper()} data: {decided[suite]}" for suite in SUITES) + f". Cloudflare upkeep: {decided['housekeeping']}.")
    return 0


# ---- deploy.yml: how long each stage took ----
def timing_file() -> Path:
    return state_dir() / "gmg-ci-timing.txt"


def timings(lines):
    """{stage: seconds} from "name epoch" marks (the first is the start),
    plus "total"."""
    marks = []
    for line in lines:
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            marks.append((parts[0], int(parts[1])))
    out = {name: now - before for (_, before), (name, now) in zip(marks, marks[1:])}
    if len(marks) > 1:
        out["total"] = marks[-1][1] - marks[0][1]
    return out


def cmd_mark(args):
    with open(timing_file(), "a", encoding="utf-8") as f:
        f.write(f"{args.name} {int(time.time())}\n")
    return 0


# ---- version.json: whether the NBA and NHL builds worked ----
def suite_note(site: Path, suite: str) -> dict:
    """What version.json says about one suite's data: when it was built, how
    many lines it matched, and for NHL the games loaded, the players with
    odds, the games whose lineup was read and the games with shot
    projections. {"built": None} when the file isn't there (the build failed);
    the failed build's last line is added from its log if there is one."""
    data = read_json(site / suite / "data.json")
    if data is None:
        note = {"built": None}
        log = ROOT / f"{suite}_build.log"
        if log.exists():
            lines = [line for line in log.read_text(errors="replace").splitlines() if line.strip()]
            note["error"] = lines[-1][:200] if lines else None
        return note
    feed = data.get("feed_debug") or {}
    novig = data.get("novig_debug") or {}
    note = {"built": data.get("generated_at"), "lines": novig.get("matched")}
    if "players" in novig:
        note["player_odds"] = novig["players"]
    if feed:
        note.update(games=feed.get("games_loaded"), wanted=feed.get("games_wanted"), downloaded=feed.get("games_downloaded"))
    if "lineups" in feed:
        note["lineups"] = feed["lineups"]  # games with the NHL's projected lineup read
    if suite == "nhl":
        shots = read_json(site / "nhl" / "shots.json")
        note["shots"] = len(shots.get("games") or {}) if shots else None  # games with projections
        crease = read_json(site / "nhl" / "crease.json")
        note["crease"] = len(crease.get("days") or {}) if crease else None  # King of the Crease: days with a board
    return note


def cmd_note(args):
    path = SITE / "version.json"
    version = read_json(path)
    if version is None:
        print("version.json isn't stamped yet.")
        return 1
    for suite in ("nba", "nhl"):
        version[suite] = suite_note(SITE, suite)
    # What this run built and what it took as it was live (deploy.yml passes these in).
    data = {suite: os.environ.get(f"DATA_{suite.upper()}") for suite in SUITES}
    if any(data.values()):
        version["data"] = {suite: how for suite, how in data.items() if how}
    if timing_file().exists():
        version["timing"] = timings(timing_file().read_text(encoding="utf-8").splitlines())
    path.write_text(json.dumps(version) + "\n", encoding="utf-8")
    print(json.dumps(version))
    return 0


# ---- nhl-refresh.yml: the hockey-only refresh ----
def runs_busy(runs):
    """True if any of the deploy workflow's recent runs is queued or running."""
    return any((run.get("status") or "") != "completed" for run in runs)


def deploy_busy():
    """Whether a full rebuild is queued or running, or None if GitHub can't be asked."""
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not repo or not token:
        return None
    found = get_json(
        f"https://api.github.com/repos/{repo}/actions/workflows/{DEPLOY_YML.rsplit('/', 1)[1]}/runs?per_page=10",
        {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    if not isinstance(found, dict) or not isinstance(found.get("workflow_runs"), list):
        return None
    return runs_busy(found["workflow_runs"])


def same_code(sha):
    """True if the site and build code in this checkout is the code that is
    live (nfl_tool/ is identical), False if not, None if it can't be told."""
    if not sha or not have_commit(sha):
        return None
    live, here = git("rev-parse", f"{sha}:nfl_tool"), git("rev-parse", "HEAD:nfl_tool")
    return None if not live or not here else live == here


def games_ahead(schedule, now: datetime, hours=REFRESH_WINDOW_HOURS):
    """How many NHL games start in the next `hours` (the league's schedule
    feed), or None if it can't be read."""
    if not isinstance(schedule, dict) or not isinstance(schedule.get("gameWeek"), list):
        return None
    count = 0
    for day in schedule["gameWeek"]:
        for game in day.get("games") or []:
            try:
                start = datetime.strptime(game["startTimeUTC"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            except (KeyError, TypeError, ValueError):
                continue
            if now < start <= now + timedelta(hours=hours):
                count += 1
    return count


def refresh_decision(event, live, busy, code_is_live, ahead, first=None):
    """(go, why). The refresh republishes the whole site folder with only the
    NHL files rebuilt, so it must never run over a full rebuild or publish
    code that isn't already live:

      * a full rebuild queued or running reads the lineups itself, and would
        be overwritten (or overwrite this) if both published;
      * if main's code differs from the live code, a deploy failed or hasn't
        run, and publishing main would put untested code live;
      * if the site changed between the first check and the one right before
        publishing (`first`), someone else published: stop.

    Anything that can't be checked counts as "no": a skipped refresh costs
    nothing, the next one is an hour away.

    On the hourly schedule it is also skipped when no game is about to start
    (a schedule that can't be read doesn't stop it).
    """
    if not live_sha(live):
        return False, "couldn't read what is live"
    if busy is None:
        return False, "couldn't ask GitHub whether a full rebuild is running"
    if busy:
        return False, "a full rebuild is queued or running; it reads the lineups itself"
    if code_is_live is not True:
        return False, "the code on main isn't the code that is live (a deploy failed or hasn't run yet); the full rebuild goes first"
    if first is not None and live != first:
        return False, "the site was republished while this ran"
    if event == "schedule" and ahead == 0:
        return False, f"no NHL game starts in the next {REFRESH_WINDOW_HOURS} hours"
    return True, "nothing else is publishing and the live code is main's"


def refresh_state() -> Path:
    return state_dir() / "gmg-nhl-refresh.json"


def cmd_refresh_check(args):
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    live = live_version()
    first = None
    if args.again:
        first = (read_json(refresh_state()) or {}).get("live") or {}
    ahead = None
    if event == "schedule" and not args.again:
        ahead = games_ahead(get_json("https://api-web.nhle.com/v1/schedule/now"), utc_now())
    go, why = refresh_decision(event, live, deploy_busy(), same_code(live_sha(live)), ahead, first)
    if not args.again:
        refresh_state().write_text(json.dumps({"live": live, "started": int(time.time())}), encoding="utf-8")
    output(go="yes" if go else "no")
    summary(f"{'Publishing' if args.again else 'Refreshing'}: {'yes' if go else 'no'} ({why}).")
    return 0


def refresh_stamp(version, nhl_note, now: datetime, run_id, seconds):
    """The live version.json with the NHL note replaced and the refresh
    noted. `sha`, `run` and `built` stay the full rebuild's: the code and the
    rest of the data are still that build's."""
    return {**version, "nhl": nhl_note, "nhl_refresh": {"at": now.strftime("%Y-%m-%dT%H:%MZ"), "run": str(run_id or ""), "seconds": seconds}}


def refresh_problems(site: Path, version) -> list:
    """Why this folder must NOT be published (empty = fine). It is about to
    replace the whole live site, so every data file that is live has to be
    here, and the new NHL files have to be real."""
    problems = []
    if not live_sha(version):
        problems.append("the live version.json wasn't saved by the first check")
    if read_json(site / "data.json") is None:
        problems.append("the NFL data.json is missing")
    if ((version or {}).get("nba") or {}).get("built") and read_json(site / "nba" / "data.json") is None:
        problems.append("the NBA data is live but isn't here")
    nhl = read_json(site / "nhl" / "data.json")
    if nhl is None or not nhl.get("teams") or not isinstance(nhl.get("schedule"), list) or not nhl.get("generated_at"):
        problems.append("the NHL build didn't write a usable data.json")
    elif not all((site / "nhl" / "players" / f"{abbr}.json").exists() for abbr in nhl["teams"]):
        problems.append("a team's player file is missing")
    if (((version or {}).get("nhl") or {}).get("shots")) and read_json(site / "nhl" / "shots.json") is None:
        problems.append("the Shots page's file is live but wasn't rebuilt")
    return problems


def cmd_refresh_stamp(args):
    state = read_json(refresh_state()) or {}
    version = state.get("live")
    problems = refresh_problems(SITE, version)
    if problems:
        summary("Not publishing: " + "; ".join(problems) + ".")
        return 1
    note = suite_note(SITE, "nhl")
    stamped = refresh_stamp(version, note, utc_now(), os.environ.get("GITHUB_RUN_ID"), int(time.time()) - int(state.get("started") or time.time()))
    (SITE / "version.json").write_text(json.dumps(stamped) + "\n", encoding="utf-8")
    summary(f"NHL data rebuilt: lineups read for {note.get('lineups')} games, odds for {note.get('player_odds')} players, {note.get('shots')} games with shot projections.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Decisions the GitHub workflows make.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("plan").set_defaults(run=cmd_plan)
    mark = sub.add_parser("mark")
    mark.add_argument("name")
    mark.set_defaults(run=cmd_mark)
    sub.add_parser("note").set_defaults(run=cmd_note)
    check = sub.add_parser("refresh-check")
    check.add_argument("--again", action="store_true", help="right before publishing: also stop if the site changed since the first check")
    check.set_defaults(run=cmd_refresh_check)
    sub.add_parser("refresh-stamp").set_defaults(run=cmd_refresh_stamp)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
