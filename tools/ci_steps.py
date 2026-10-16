"""The decisions the GitHub workflows make, kept here so they can be tested
(tests/test_ci_steps.py) instead of living as shell inside the YAML.

    python tools/ci_steps.py mark NAME             # deploy.yml: a stage just ended (for version.json's timing)
    python tools/ci_steps.py note                  # deploy.yml: the NBA / NHL notes, a failed build's live copy, the timings
    python tools/ci_steps.py refresh-check         # nhl-refresh.yml: anything to refresh, and safe to publish?
    python tools/ci_steps.py refresh-check --again # nhl-refresh.yml: the same question right before publishing
    python tools/ci_steps.py refresh-stamp         # nhl-refresh.yml: check the new NHL files, note the refresh
    python tools/ci_steps.py live-check            # both, right after publishing: is the live site answering? if not, put the last version back
    python tools/ci_steps.py live-check --look     # anywhere, any time: is the live site answering? (changes nothing)

Why they exist (2026-10-13): the repo had gone private, which put the builds
on GitHub's 2,000 free minutes a month, and every run did everything: a
lineup check rebuilt football, basketball and hockey. Hockey lineups and odds
are refreshed every half hour by a small job that rebuilds only the NHL
files and republishes (`refresh-*`). The deploy itself builds and tests everything on
every run again since 2026-10-15 (the repo is public, minutes are free, and
rebuilding only what a push changed had failed a deploy).

Each run says what it did in the public version.json: `data` (an NBA / NHL
build that failed and had its live copy put back), `timing` (seconds per
stage) and `nhl_refresh`.

Standard library only: the hockey refresh runs on the machine's own Python
with nothing installed.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "nfl_tool" / "site"
LIVE = "https://nfl.gmgsports.org"
DEPLOY_YML = ".github/workflows/deploy.yml"
SUITES = ("nfl", "nba", "nhl")
# A timed refresh is skipped when no NHL game starts within this many hours.
REFRESH_WINDOW_HOURS = 14
# GitHub's own hourly timer is only the backup for the Cloudflare timer
# (workers/nhl-timer): it skips when the live NHL data is this fresh.
BACKUP_SKIP_MINUTES = 25


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


# ---- deploy.yml: the page-only fast lane (2026-10-15) ----
# The owner: removing one small arrow "shouldnt take more than 45 seconds".
# A push that changes only what the browser loads (pages, scripts, styles)
# can't change a data file, so it publishes with the LIVE data instead of
# rebuilding all three sports (about 4.5 of the 7 minutes). Every test and the
# browser gate still run. It goes by every file changed since the version
# that is live, not by which sport a file belongs to: that hand-kept list is
# what failed twice before "every run does everything".
PAGE_ONLY = ("nfl_tool/site/", "tests/", "docs/", ".claude/", "model_history/")
PAGE_ONLY_FILES = ("CLAUDE.md", "README.md")


def changed_since(sha):
    """Every file that differs between the live commit and this one, or None
    if it can't be told."""
    if not sha or not have_commit(sha):
        return None
    out = git("diff", "--name-only", sha, "HEAD")
    return None if out is None else [line for line in out.splitlines() if line.strip()]


def lane_decision(event, changed):
    """("pages" or "full", why). Only a push can take the fast lane: the
    schedule and "Update Odds" are there to refresh the data."""
    if event != "push":
        return "full", "a scheduled or manual run refreshes the data"
    if changed is None:
        return "full", "couldn't tell what changed since the live version"
    if not changed:
        return "full", "nothing changed since the live version"
    other = [f for f in changed if not f.startswith(PAGE_ONLY) and f not in PAGE_ONLY_FILES]
    if other:
        return "full", f"{len(other)} changed file(s) can change the data, e.g. {other[0]}"
    return "pages", f"only page files changed ({len(changed)}): publishing with the live data"


def cmd_lane(args):
    lane, why = lane_decision(os.environ.get("GITHUB_EVENT_NAME", ""), changed_since(live_sha(live_version())))
    output(lane=lane)
    summary(f"Lane: {lane} ({why}).")
    return 0


# ---- version.json: whether the NBA and NHL builds worked ----
def build_error(suite):
    """The last line a failed build wrote to its log (deploy.yml keeps
    nba_build.log and nhl_build.log), or None."""
    log = ROOT / f"{suite}_build.log"
    if not log.exists():
        return None
    lines = [line for line in log.read_text(errors="replace").splitlines() if line.strip()]
    return lines[-1][:200] if lines else None


def suite_note(site: Path, suite: str, failed=False) -> dict:
    """What version.json says about one suite's data: when it was built, how
    many lines it matched, and for NHL the games loaded, the players with
    odds, the games whose lineup was read and the games with shot
    projections. {"built": None} when the file isn't there (the build failed
    and its live copy couldn't be put back). When the build failed (`failed`,
    or no file) its log's last line is added as "error"; a live copy put back
    keeps its own, older, "built"."""
    data = read_json(site / suite / "data.json")
    if data is None:
        error = build_error(suite)
        return {"built": None, **({"error": error} if error else {})}
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
        goals = read_json(site / "nhl" / "goals.json")
        note["goals"] = len(goals.get("games") or {}) if goals else None  # Goals: games with projections
        points = read_json(site / "nhl" / "points.json")
        note["points"] = len(points.get("games") or {}) if points else None  # Points: games with projections
        stacks = read_json(site / "nhl" / "stacks.json")
        note["stacks"] = sum(bool(g.get("stacks")) for g in (stacks.get("games") or {}).values()) if stacks else None  # Line Stacks: games with stacks
        ice = read_json(site / "nhl" / "icebreaker.json")
        note["icebreaker"] = len(ice.get("days") or {}) if ice else None  # Icebreaker: days with a board
        fg = (data.get("book_odds_debug") or {}).get("first_goal") or {}
        note["first_goal"] = fg.get("players", fg.get("error") or fg.get("note") or fg.get("skipped"))  # SmartStake first goal scorer prices
    if failed:
        note["error"] = build_error(suite)
    return note


def cmd_note(args):
    path = SITE / "version.json"
    version = read_json(path)
    if version is None:
        print("version.json isn't stamped yet.")
        return 1
    # Per suite: "built", "live copy" (the build failed, the live data was put
    # back) or "missing" (deploy.yml passes these in).
    data = {suite: os.environ.get(f"DATA_{suite.upper()}") for suite in SUITES}
    for suite in ("nba", "nhl"):
        version[suite] = suite_note(SITE, suite, failed=data[suite] not in (None, "built"))
    if any(data.values()):
        version["data"] = {suite: how for suite, how in data.items() if how}
    if os.environ.get("LANE"):
        version["lane"] = os.environ["LANE"]  # "pages" = published with the live data
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


def minutes_since(stamp, now: datetime):
    """Minutes from a version.json time ("2026-10-15T21:29Z") to now, or
    None if it can't be read."""
    try:
        then = datetime.strptime(str(stamp), "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (now - then).total_seconds() / 60


def refresh_decision(event, live, busy, code_is_live, ahead, first=None, now=None):
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
    nothing, the next one is half an hour away.

    A timed run ("timer": the Cloudflare timer every half hour; "schedule":
    GitHub's hourly backup) is also skipped when no game is about to start (a
    schedule that can't be read doesn't stop it). The backup is skipped too
    when the live NHL data is under BACKUP_SKIP_MINUTES old: GitHub's timer
    is late or dropped most hours (2026-10-15: 1 of 6 ran), which is why the
    Cloudflare one exists.
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
    if event in ("schedule", "timer") and ahead == 0:
        return False, f"no NHL game starts in the next {REFRESH_WINDOW_HOURS} hours"
    if event == "schedule" and now is not None:
        age = minutes_since(((live or {}).get("nhl") or {}).get("built"), now)
        if age is not None and age < BACKUP_SKIP_MINUTES:
            return False, f"the NHL data was rebuilt {int(age)} minutes ago (this is the backup timer)"
    return True, "nothing else is publishing and the live code is main's"


def refresh_state() -> Path:
    return state_dir() / "gmg-nhl-refresh.json"


def cmd_refresh_check(args):
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event == "workflow_dispatch" and os.environ.get("REFRESH_SOURCE") == "timer":
        event = "timer"  # the Cloudflare timer presses the same button as the owner
    live = live_version()
    first = None
    if args.again:
        first = (read_json(refresh_state()) or {}).get("live") or {}
    ahead = None
    if event in ("schedule", "timer") and not args.again:
        ahead = games_ahead(get_json("https://api-web.nhle.com/v1/schedule/now"), utc_now())
    go, why = refresh_decision(event, live, deploy_busy(), same_code(live_sha(live)), ahead, first, None if args.again else utc_now())
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


# ---- after a publish: is the live site answering? if not, put the last version back ----
# The owner, 2026-10-13, after the site was down for paying members for over
# two hours: "that CANNOT happen ... never take the site offline until a push
# is completely ready." The tests and the gate run BEFORE a publish and only
# see the pages. Neither can see what breaks at the host: the login code, the
# member database binding, a secret, a file that didn't upload. So every
# publish is followed by a look at the real site from outside, and a publish
# that leaves it not answering is undone on the spot (Cloudflare keeps every
# earlier version; going back to one takes a few seconds), with no person and
# no Claude session needed. The run then fails, so GitHub emails the owner.
PAGES_PROJECT = "gmg-nfl"
MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
LIVE_ROUNDS = 4          # looks at the live site before calling it down...
LIVE_PAUSE = 15          # ...this many seconds apart (a new version takes a moment to be served everywhere)
# Files every page needs, read with the build's key (members are served the same files).
LIVE_FILES = ("game-overview.html", "index.html", "player-props.html", "style.css", "common.js", "sync.js")
SIGN_IN_TEXT = "GMG Sports Data"


def live_get(path, key=None, timeout=25):
    """(status, body) for a path on the live site; (None, b"") if it can't be
    reached. `key` is the build's key (the member login lets it through)."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; gmg-live-check/1.0)", "Cache-Control": "no-cache"}
    if key:
        headers["X-GMG-Build"] = key
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{LIVE}/{path}", headers=headers), timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        with e:
            return e.code, e.read()
    except Exception as e:
        print(f"/{path.split('?')[0]}: {e}")
        return None, b""


def build_key():
    token = os.environ.get("DISCORD_BOT_TOKEN")
    return hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest() if token else None


def gate_is_on():
    """Whether the code being published has the member login switched on
    (ENFORCE in the login code). If the owner ever opens the site on purpose,
    the check stops expecting the sign-in page."""
    try:
        return bool(re.search(r"^const ENFORCE = true\b", MIDDLEWARE.read_text(encoding="utf-8"), flags=re.M))
    except OSError:
        return True


def as_json(body):
    try:
        found = json.loads(body)
    except ValueError:
        return None
    return found if isinstance(found, dict) else None


def live_problems(get, key=None, gate=True):
    """What is wrong with the live site right now, in plain words (empty =
    it is answering). `get(path, key)` -> (status, body). Without the build's
    key only the public checks run."""
    problems = []
    stamp = int(time.time())
    status, body = get(f"?t={stamp}", None)
    if gate:
        if status != 401 or SIGN_IN_TEXT not in body.decode("utf-8", "replace"):
            problems.append(f"the sign-in page isn't being served (got {status or 'no answer'})")
    elif status != 200:
        problems.append(f"the home page isn't being served (got {status or 'no answer'})")
    status, body = get(f"auth/status?t={stamp}", None)
    auth = as_json(body) if status == 200 else None
    if auth is None:
        problems.append(f"the login code isn't answering (/auth/status gave {status or 'no answer'})")
    else:
        if gate and auth.get("gate") != "on":
            problems.append("the member login is off (a secret is missing): the site is open to everyone")
        if auth.get("profiles") is not True:
            problems.append("the member database isn't connected: email members can't sign in")
    if key:
        status, body = get(f"data.json?t={stamp}", key)
        data = as_json(body) if status == 200 else None
        if data is None or not data.get("schedule") or not data.get("teams"):
            problems.append(f"the NFL data file isn't being served whole (got {status or 'no answer'})")
        for rel in LIVE_FILES:
            status, body = get(f"{rel}?t={stamp}", key)
            if status != 200 or len(body) < 500:
                problems.append(f"{rel} isn't being served (got {status or 'no answer'})")
    return problems


def version_is_live(get, expected):
    """True once the live version.json is the one just published."""
    status, body = get(f"version.json?t={int(time.time())}", None)
    return status == 200 and expected is not None and as_json(body) == expected


def live_verdict(get, expected, key=None, gate=True, rounds=LIVE_ROUNDS, pause=LIVE_PAUSE, sleep=time.sleep):
    """("ok" | "not-served" | "down", problems) after a publish.

    Looks up to `rounds` times, `pause` seconds apart, and stops at the first
    clean look, so a slow hand-over at the host is never called an outage.
      * "ok": the new version is being served and the site answers.
      * "not-served": the site answers but is still the OLD version. Nothing
        is broken for members, so nothing is undone; the run fails so it shows.
      * "down": the site is not answering properly. The caller puts the last
        version back.
    """
    problems, served = [], False
    for attempt in range(rounds):
        if attempt:
            sleep(pause)
        served = version_is_live(get, expected)
        problems = live_problems(get, key, gate)
        if served and not problems:
            return "ok", []
    if problems:
        return "down", problems
    return "not-served", ["the site is answering, but it is still serving the version from before this publish"]


def step_back_target(deployments):
    """The version that was live before this publish: the newest earlier
    production deployment that finished. `deployments` is Cloudflare's list,
    newest first, the one just published on top. None if there isn't one."""
    for d in (deployments or [])[1:]:
        stage = d.get("latest_stage") or {}
        if d.get("environment", "production") == "production" and stage.get("name") == "deploy" and stage.get("status") == "success" and d.get("id"):
            return d["id"]
    return None


def cloudflare(method, path):
    """A call to Cloudflare's API with the deploy's own token: the parsed
    answer, or None. The token is never printed."""
    token, account = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        print("No Cloudflare token here.")
        return None
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PAGES_PROJECT}/{path}",
        method=method, data=b"" if method == "POST" else None, headers={"Authorization": f"Bearer {token}", "User-Agent": "gmg-ci/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return as_json(resp.read())
    except urllib.error.HTTPError as e:
        with e:
            print(f"Cloudflare said {e.code} to {method} {path.split('?')[0]}")
    except Exception as e:
        print(f"Cloudflare couldn't be reached: {type(e).__name__}")
    return None


def step_back(api=cloudflare):
    """Put the version from before this publish back. (done, words)."""
    listed = api("GET", "deployments?env=production&per_page=10")
    target = step_back_target((listed or {}).get("result")) if listed and listed.get("success") else None
    if not target:
        return False, "couldn't find the version from before this publish to go back to"
    answer = api("POST", f"deployments/{target}/rollback")
    if not answer or not answer.get("success"):
        return False, "Cloudflare refused to go back to the version from before this publish"
    return True, "the version from before this publish is back"


def cmd_live_check(args):
    key = build_key()
    gate = gate_is_on()
    if args.look:
        problems = live_problems(live_get, key, gate)
        status, body = live_get(f"version.json?t={int(time.time())}")
        version = as_json(body) if status == 200 else None
        if version is None:
            problems.append("version.json isn't being served")
        print(f"Live now: commit {str((version or {}).get('sha'))[:7]}, built {(version or {}).get('built')}." + ("" if key else " (Public checks only: the data files need the build's key.)"))
        print("The site is answering." if not problems else "PROBLEMS: " + "; ".join(problems) + ".")
        return 1 if problems else 0
    verdict, problems = live_verdict(live_get, read_json(SITE / "version.json"), key, gate)
    if verdict == "ok":
        summary("Live check: the new version is being served and the site is answering.")
        return 0
    if verdict == "not-served":
        summary("Live check FAILED: " + problems[0] + ". Members are not affected; nothing was undone.")
        return 1
    summary("Live check FAILED after publishing: " + "; ".join(problems) + ".")
    done, words = step_back()
    summary(f"Going back: {words}.")
    if done:
        time.sleep(LIVE_PAUSE)
        still = live_problems(live_get, key, gate)
        summary("After going back the site is answering. This push is NOT live; fix it and push again." if not still else "STILL DOWN after going back: " + "; ".join(still) + ". This needs a person now.")
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description="Decisions the GitHub workflows make.")
    sub = parser.add_subparsers(dest="command", required=True)
    mark = sub.add_parser("mark")
    mark.add_argument("name")
    mark.set_defaults(run=cmd_mark)
    sub.add_parser("note").set_defaults(run=cmd_note)
    sub.add_parser("lane").set_defaults(run=cmd_lane)
    check = sub.add_parser("refresh-check")
    check.add_argument("--again", action="store_true", help="right before publishing: also stop if the site changed since the first check")
    check.set_defaults(run=cmd_refresh_check)
    sub.add_parser("refresh-stamp").set_defaults(run=cmd_refresh_stamp)
    live = sub.add_parser("live-check")
    live.add_argument("--look", action="store_true", help="only look and report: expects no particular version and never goes back")
    live.set_defaults(run=cmd_live_check)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
