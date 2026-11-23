---
paths:
  - ".github/workflows/**"
  - "tools/ci_steps.py"
  - "tools/check_site.py"
  - "tools/run_tests.py"
  - "tools/fetch_live_data.py"
  - "tests/test_ci_steps.py"
---
# Deploys: Never Leave the Site Down, What Each Run Does

Split from the old `members-and-hosting.md` (2026-11-23); `members.md`, `hosting.md`, `deploy.md` and `member-profiles.md` together hold all of it. Stories: `docs/history.md`, "Members and hosting".

## The site must never be left down (2026-10-13)

The site was down for paying members for over two hours on 2026-10-13 while the owner's Claude
usage was spent, so nobody could fix it. The owner: "that CANNOT happen. We need a safeguard in
place so that usage is either understood and new tasks don't begin if they can't finish, or never
take the site offline until a push is completely ready."

- **What was found afterwards:** every workflow run that day succeeded. The gap in publishes
  (13:41 to 16:03 Eastern) had the hockey-only refresh's first publish live; its log shows the
  same 87 files and the same login code as the deploy before it. So the record does not show a
  broken publish.
- **What members saw** (the owner's phone screenshot, sent afterwards): the NHL Shots page's
  "GMG NHL Suite is being built for the 2026-27 season. Check back soon." That is not a broken
  site. It is the launch guard (`.nba-soon`, suite.css): every NHL and NBA page shows it to
  everyone who is not the owner, by design, until `SUITE_SWITCH_PUBLIC` is true (nba.md). The
  text exists only on those pages, no NFL page can show it, and nothing sends a member to an NHL
  page (the suite dropdown is owner-only too). So people reached an NHL link while the suite was
  still closed (the owner had been advertising it). The owner read it as a push stuck halfway;
  no push was. Fixed the same evening by launching both suites (`SUITE_SWITCH_PUBLIC = true`).
  The lesson: a page members can reach by link must never look finished to the owner and
  closed to everyone else without the owner knowing which it is.
- **The live check** (`tools/ci_steps.py live-check`, the last step of deploy.yml and
  nhl-refresh.yml). After every publish it looks at the real site up to four times, 15 s apart:
  the sign-in page is served (401), `/auth/status` says the login is on and the member database
  is connected, and with the build's key `data.json`, three pages, `style.css`, `common.js` and
  `sync.js` come back. The tests and the gate can't see any of that: they run before the publish.
  - Down = the version from before the publish is put back through Cloudflare's API
    (`step_back`: the newest earlier finished production deployment, `.../rollback`), the site
    is looked at again, and the run fails (GitHub emails the owner). No person and no Claude
    session is needed. The push is then NOT live: fix it and push again.
  - Still the old version but answering = the run fails and nothing is undone.
  - `ENFORCE = false` in the login code (the site opened on purpose) stops it expecting the
    sign-in page.
  - The going-back call has only been run against a fake Cloudflare in the tests; the first real
    outage is its first real use. If a run says "STILL DOWN after going back", the owner can go
    back by hand: Cloudflare dashboard, Workers & Pages, gmg-nfl, Deployments, "Rollback" on the
    last good one.
- **`python tools/ci_steps.py live-check --look`** from any PC: is the site answering right now
  (public checks only without the key; changes nothing).
- **Claude's side** (CLAUDE.md): check plan usage before starting anything that ends in a push,
  and don't start with under about 25% of the 5-hour window left. Work in progress stays on the
  PC, uncommitted or committed but not pushed, where it can't touch the site. One push is one
  finished change: the site must work after it with no second push. Never change Cloudflare,
  DNS, secrets or the member database by hand as a step of a larger task.
- **The Actions page can be read from here** with Claude in Chrome when the owner's Chrome is
  signed in to GitHub (open the run, expand the step): how a failed run is diagnosed without
  asking the owner for the red step's name.
- Not built: something that watches the site BETWEEN publishes (a free uptime monitor such as
  UptimeRobot pointed at `https://nfl.gmgsports.org/auth/status`, which the owner would sign up
  for; a watcher in GitHub Actions is free now that the repo is public, but none is built).

## Every run does everything (2026-10-15)

Since the repo went public (2026-10-15) GitHub's build minutes are free, so the deploy is the
same on every run: every test, all three sports built fresh, every page and Summary card checked,
the Cloudflare upkeep, the publish, the live check. About 6.5 to 8 minutes from push to live
(`timing` total ~400 s plus the queue). Two pushes close together: the second waits for the first.

- **The page-only fast lane (2026-10-15).** The owner, after a one-arrow change took 7 minutes:
  "removing one small thing ... shouldnt take more than 45 seconds". The ~4.5 minutes of data
  rebuilds can't change on a push that changed only page files, so `ci_steps.py lane` compares
  every file changed since the LIVE version (`version.json` sha, `git diff --name-only`): if all
  are under `nfl_tool/site/`, `tests/`, `docs/`, `.claude/`, `model_history/` or are `CLAUDE.md`
  / `README.md`, the lane is "pages" and "Use the live data" downloads all three sports' live
  files (`fetch_live_data.py --need nfl nba nhl`) instead of building them. Anything else (build
  code, `functions/`, `tools/`, workflows, `.gitignore`), a scheduled or manual run, or a live
  version it can't read = "full". If the download fails, every build runs as usual. Every test
  and the gate still run on both lanes, so it is about 2.5 to 3 minutes, not 45 seconds: the
  owner was told publishing a file without the tests and the gate is how a broken page reaches
  members. `version.json` `lane` says which ran. This is NOT a return of per-sport deploys: it
  never decides which sport a file belongs to.
- **Rebuild only what changed (2026-10-22, replaces "pages or full").** The owner, after a
  login-code push rebuilt all three sports: "if no data is getting messed with it does not need
  to be altered and rebuilt" (pages of a scrapbook: adding to July never touches January).
  `ci_steps.py build_plan`: each changed file names the sports whose DATA it can change
  (`sports_for`): pages, notes, tests, `model_history/`, the login code (`nfl_tool/functions/`)
  and `tools/` change none; `nfl_tool/nba/` = NBA, `nfl_tool/nhl/` = NHL, `build_stats.py`,
  `gmg_model.py`, `line_grades.py`, `nfl_odds.py` = NFL; `smartstake.py` (the shared SmartStake plumbing only since 2026-11-21: each sport's odds code is in its own file, nfl-odds.md), the Novig query, requirements, the
  workflows and anything unknown = every sport. The lane step outputs `build` and `live`; the
  sports in `live` are downloaded (`fetch_live_data.py --only $LIVE --need $LIVE`), and if that
  fails every sport is built. `lane` in version.json: `pages` / `partial` / `full`. A test checks
  the NBA / NHL builds import no root file except ones mapped to every sport. **The gate still
  opens every page on every push.**
- **Tests by lane (2026-11-17).** The owner, after an NBA-only push spent 4 minutes on every
  sport's tests: "IF I MAKE AN NBA CHANGE JUST DONT TOUCH NHL. JUST LEAVE NHL AND NFL ALONE."
  The lane step now runs BEFORE the tests and outputs `tests` (`ci_steps.test_plan`): a push whose
  files are all one sport's own (`nfl_tool/nba/`, `site/nba/`, `tests/test_nba_*`,
  `model_history/nba_*`; same for NHL; NFL = its build files) runs `run_tests.py --deploy nba`:
  that sport's tests plus every shared test whose CODE reaches it (`nba/`, `"nba"`, `.nba`;
  comments don't count), never another sport's own tests. Notes are ignored; any shared or unknown
  file (site/ root files, the login code, tools/, workflows, tests/helpers, fixtures), a schedule
  or "Run workflow" = every test. Nothing is hand-listed, so a new test file needs no registering
  (the 2026-10-15 failure below). NBA-only: ~550 tests, ~1.5 min instead of ~4.

- **Why** (2026-10-13 to 10-15 it was the other way): while the repo was private (2,000 free
  minutes a month) a push rebuilt, tested and browser-checked only the sport it changed, reused
  the other sports' live data, and pushes touching only `tests/` or `tools/` started no deploy.
  On 2026-10-15 that cost about 45 minutes: a new NFL test file missing from the hand-kept list
  of each test's sport failed a deploy, and the fix touched only `tools/`, so no deploy ran. It
  also hid a bug (`smartstake.py` feeds the hockey build but counted as football-only). The
  owner approved the simple version: 3 to 4 more minutes per push for a deploy that always does
  the same thing. Builds (2026-10-22) and tests (2026-11-17) are per sport again at the owner's
  word, but only from reading the files themselves: never a hand-kept list.
- **`tools/ci_steps.py` holds the workflows' decisions** (tested in `tests/test_ci_steps.py`).
  Each run reports itself in the public `version.json`: `timing` (seconds per stage: `install`,
  `tests`, `nfl`, `nhl`, `gate`, `cloudflare`, `total`), `data` (NBA / NHL: `built`, `live copy`
  or `missing`), `nhl_refresh`.
- **Safety nets for building everything on every push:** the NFL build is tried twice (nflverse
  sometimes gives a one-off 404). A failed NBA or NHL build has its live data put back
  (`fetch_live_data.py --only X --need X --replace`: whatever the build left is cleared first),
  so the site is never published without a sport's data; version.json then shows `live copy`
  and that sport's `error` (the build log's last line) beside the older `built`.
- `--only nfl|nba|nhl` on `run_tests.py` and `check_site.py` stays, for a local check while
  working on one sport. The deploy uses `--deploy` instead (tests by lane, above).
- **`.github/workflows/nhl-refresh.yml`: the hockey-only refresh.** Every half hour, at :17
  and :47 from 16:17 to 02:47 UTC, October to June, plus "Run workflow" on the Actions page and a push that edits the file.
  - **The clock is Cloudflare's, not GitHub's (2026-10-15).** GitHub's own timer was late or
    dropped most hours (that day the hourly refresh ran 1 of 6 times; one run started two hours
    late), so the Worker `gmg-nhl-timer` (`workers/nhl-timer/`, a Cron Trigger) presses "Run
    workflow" with `source: timer`. It decides nothing: `refresh-check` treats a "timer" run like
    a scheduled one (stops when no game starts in 14 hours). GitHub's hourly `schedule` stays as
    a backup and stands aside when the live `nhl.built` is under 25 minutes old
    (`BACKUP_SKIP_MINUTES`).
  - **The same Worker starts The Bouncer (2026-11-18)**, the daily Discord membership check in the
    private repo `discord-role-check`: `BOUNCER_CRON` presses its workflow with `source: timer`
    (GitHub's own timer ran its mornings 8 to 10 hours late). `NHL_TRIGGER_TOKEN` has access to both
    repos; each install sends a harmless `source: check` press to prove it.
  - `.github/workflows/nhl-timer.yml` installs the Worker (on a change to it, or by hand). It
    needs the GitHub secret `NHL_TRIGGER_TOKEN` (a fine-grained token, this repo only, Actions
    read and write; the owner made it with an expiry, so when the timer stops, make a new one,
    replace the secret and run that workflow) and Workers Scripts Edit on `CLOUDFLARE_API_TOKEN`.
    A failed press shows only in the Worker's logs (Cloudflare dashboard, Workers & Pages,
    gmg-nhl-timer); the backup keeps the refresh going hourly meanwhile. It rebuilds only the NHL files and republishes, on the machine's
  own Python with nothing installed, no tests, no page check: about 80 seconds push to live
  on its first run. A publish replaces the whole site folder, so the NFL and NBA data are
  downloaded from the live site and put back (`--only nfl nba --strict`), and it asks twice
  (`refresh-check`, before starting and right before publishing): no full rebuild queued or
  running, main's `nfl_tool/` is the live code, nobody republished meanwhile. Any doubt = no.
  `refresh-stamp` refuses a folder with a live data file missing. `version.json` keeps the
  full rebuild's `sha` / `run` / `built`; `nhl` and `nhl_refresh` change.
- **`.github/workflows/nba-refresh.yml`: the NBA injury refresh (2026-10-25).** Pressed by the
  same Worker's every-minute NBA watch (nba-sim.md, "The injury watch") with `source: watch`, never
  while a refresh is running, a full rebuild is queued or running, or within 4 minutes of the last
  one. The same rules as the hockey refresh (`refresh-check --sport nba` twice, `refresh-stamp
  --sport nba`, the NFL / NHL data put back with `--only nfl nhl --strict`, the live check), with
  the deploy's NBA build command and `pip install -r nfl_tool/requirements.txt`; it commits
  `model_history/nba_*` (tonight's plays are rewritten until tip). Both refreshes share the
  concurrency group `site-refresh`, so they never publish over each other. version.json:
  `nba_refresh`.
- **A new generated file in the site folder** goes in `.gitignore` AND `fetch_live_data.py`'s
  `SUITES` (a test compares the two), or a refresh or a live copy put back would publish without it.
- The refresh shares the database binding, the NHL build command and the publish command with
  deploy.yml word for word (tests compare them): change both together.
- The "create Pages project" step is gone (it failed with "already exists" on every run; the
  recreate command is in deploy.yml). **Install speed (2026-10-23):** on 2026-10-22 "Install
  dependencies" took 10 to 14 minutes on several runs (normally under 1). Now pip packages
  (`setup-python` `cache: pip`) and the browser (`~/.cache/ms-playwright`, keyed on Playwright's
  version) are kept between runs, and the browser's system libraries and fonts
  (`playwright install-deps`) still run every time, so fonts stay the same, but get 180 s
  (`timeout`); past that the run warns and goes on with the runner's own libraries.
