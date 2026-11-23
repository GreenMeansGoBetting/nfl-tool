---
paths:
  - "nfl_tool/functions/**"
  - ".github/workflows/**"
  - "workers/**"
  - "tests/test_sport_hosts.py"
---
# Hosting (Cloudflare Pages, Sport Addresses)

Split from the old `members-and-hosting.md` (2026-11-23); `members.md`, `hosting.md`, `deploy.md` and `member-profiles.md` together hold all of it. Stories: `docs/history.md`, "Members and hosting".

## Hosting

- **`nfl.gmgsports.org` points at Cloudflare Pages** (project `gmg-nfl`, `gmg-nfl.pages.dev`);
  the member login runs there. The domain is at **Namecheap**, which also runs email forwarding
  (MX `eforward*.registrar-servers.com`). **Don't move the whole domain's nameservers**; only the
  `nfl` record was changed.
- **One address per sport (2026-10-14):** `nba.gmgsports.org` and `nhl.gmgsports.org` are the
  same Pages project (a CNAME each at Namecheap -> `gmg-nfl.pages.dev`). The files stay in
  `site/nba/` and `site/nhl/`; the middleware serves `nhl.gmgsports.org/x` from `/nhl/x`, except
  `SHARED_FILES` (style.css, suite.css, sync.js, book-odds.js, ytd.js, version.json) and `/brand/`, which come from the
  root. **A sport page that starts loading another root file (`../x.js`) needs it added to
  `SHARED_FILES`**, or it gets the sport folder's file / nothing (`tests/test_sport_hosts.py` fails it; ytd.js was missed 2026-10-22 and the NHL Shots and Best Plays pages drew no plays for about 40 minutes). On a sport address, old
  `/nhl/...` links drop the folder and NFL pages (`NFL_PAGES`) go to nfl.gmgsports.org.
  `SPORT_HOSTS_LIVE` (on since 2026-10-14, once both addresses answered) sends
  nfl.gmgsports.org/nba/ and /nhl/ pages to their own address; data files are never moved, the build reads them on the NFL
  address. The session cookie is set for `gmgsports.org`, so one sign-in covers every sport;
  Discord sign-in always runs on nfl.gmgsports.org (the only callback registered with Discord)
  and returns to the page it started from (`safeNext`: only our three addresses). The suite
  switcher in sync.js links by full address on nba./nhl. Tests: `tests/test_ci_hosting.py`.
  Local testing uses the folders, unchanged.
- **deploy.yml** builds the data, runs the gate, then publishes `nfl_tool/site` to Cloudflare
  Pages (the only host) using the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It
  deploys from `nfl_tool/` so the Pages Functions get bundled, and writes `nfl_tool/wrangler.toml`
  in CI.
  - **The gate** (`python tools/check_site.py --gate`, retried once): every page and every game's
    Summary cards are opened in a real browser before anything is published. A script error, a
    missing file or a card that doesn't draw fails the run, so members keep the last good version
    and GitHub emails the owner. Cards that are merely too full never block. The NBA and NHL
    pages are left out of the gate (their builds may fail on their own).
  - It also refuses to publish if the member database step could not write the database binding
    (publishing without it would lock email members out).
  - The publish step is NOT `continue-on-error`: a failed publish is a failed run.
  - **Cloudflare Pages refuses any one file over 25 MiB** (wrangler's error is only in the
    signed-in log). "Check file sizes for Cloudflare" (`python tools/ci_steps.py sizes`, right
    before the publish) puts the 5 biggest files in the run's annotations ("Biggest files", public:
    `api.github.com/repos/GreenMeansGoBetting/nfl-tool/check-runs/<job id>/annotations`), warns on
    one past 20 MB and fails naming one over 25. Keep every data file well under: data files are
    written compact (`separators=(",", ":")`, never `indent`), and the NBA alt ladders (`*_alt`
    in `book_odds`, most of the quotes) live in `nba/ladders.json` (`split_ladders` /
    `merge_ladders` in build_nba.py; the player card (nba-card.js) and the build's read of the live copy merge them
    back). A big new block goes in its own file read only by the page that needs it (a new
    generated file: .gitignore AND fetch_live_data.py SUITES).
  - `version.json` (commit sha, run id, build time) is written into the site and served without
    a login (`/version.json` is let through by the middleware). It is how a deploy is confirmed.
    It also carries `nba` and `nhl`: when each of those builds last worked (`built`, null if it
    failed), how many lines it matched, and for NHL the games loaded / downloaded, how many
    players got odds (`player_odds`), how many games the Shots page has projections for
    (`shots`), or the failed build's last line (`error`). Their data files are behind the login, so this is the only way
    to see those builds from outside.
- It runs on a cron every 6 h, on **every push to main** (whatever it touched; the bot's
  model-record commits don't start one; nor does a push that changes ONLY the SmartStake probe files,
  `paths-ignore`, 2026-10-21), and on manual dispatch. Every run is the same: every
  test, all three sports built fresh, every page checked ("Every run does everything" below). There is no Update Odds button any more (removed 2026-10-17: the owner said the odds update on
  their own and he will ask Claude); "Run workflow" on the Actions page still starts a run. A
  re-run of a failed run uses that run's OLD commit, never newer fixes. Odds
  (SmartStake, Novig) and ESPN are fetched fresh on every build.
- Other steps: "Build NBA data" and "Build NHL data" (both `continue-on-error`; the NHL one
  sits between "Restore saved NHL games" and "Save NHL games", see nhl.md). If one fails, the
  next step puts that sport's live data back ("Put the live ... data back": `fetch_live_data.py
  --only X --need X --replace`) so the site is never published without it. "Note the run in
  version.json", and "Save GMG model record" (commits everything in
  `model_history/` as github-actions[bot]: `gmg_model.json` and the NHL Shots record,
  `nhl_shots/<month>.json`; the workflow has `contents: write`).
- **`.github/workflows/site-check.yml`** runs once a day (12:57 UTC) and on demand; until
  2026-10-13 it ran after every deploy, a second browser install for pages the gate had just
  opened. It
  downloads the LIVE data (`tools/fetch_live_data.py`, same `X-GMG-Build` key) and runs
  `tools/check_site.py` in its own job. A
  failed run = the check found a NEW problem (the same problems are reported once, not every day); the report is on the run's Summary page, GitHub emails the owner, and it also posts to
  Discord if the optional secret `SITE_CHECK_WEBHOOK` exists. `tools/check_site.py --site DIR`
  checks a copy of the site folder (how to reproduce a CI report locally with the live data).
- `.github/workflows/cloudflare-domain.yml` attaches `nfl.`, `nba.` and `nhl.gmgsports.org` to the Pages project
  through the API. It can be re-run from the Actions tab and prints the verification status. (The
  Cloudflare connector for Claude can't manage Pages domains; the GitHub secret token can.)
- **The repo is PUBLIC again since 2026-10-15** (the owner's call, to let Claude read the runs:
  `api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/runs` and each run's jobs/logs).
  The history was scanned for keys first (none). The notes below are from the private period.
- **The repo was private and GitHub Pages is off** (2026-10-13). The Pages copy had served the
  site without the login; it was dropped from the deploy, then the user made the repo private,
  which unpublished it (checked: GitHub's servers return 404 for the old copy). Because of that:
  - the public GitHub API no longer shows the runs, so confirm deploys with `version.json`;
  - there is no `gh` on the user's PC, so a failed run can only be read by the user on the
    Actions page (or from the failure email); ask them for the red step's name;
  - private repos get 2,000 free build minutes a month, which is why runs were kept lean
    until the repo went public again ("Every run does everything" below);
