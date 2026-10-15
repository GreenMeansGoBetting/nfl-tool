---
paths:
  - "nfl_tool/functions/**"
  - "nfl_tool/site/sync.js"
  - "nfl_tool/site/support.html"
  - ".github/workflows/**"
---
# Members, login gate and hosting

Stories behind these rules (the hosting move, the Stripe setup, wording choices):
`docs/history.md`, "Members and hosting".

## Hosting

- **`nfl.gmgsports.org` points at Cloudflare Pages** (project `gmg-nfl`, `gmg-nfl.pages.dev`);
  the member login runs there. The domain is at **Namecheap**, which also runs email forwarding
  (MX `eforward*.registrar-servers.com`). **Don't move the whole domain's nameservers**; only the
  `nfl` record was changed.
- **One address per sport (2026-10-14):** `nba.gmgsports.org` and `nhl.gmgsports.org` are the
  same Pages project (a CNAME each at Namecheap -> `gmg-nfl.pages.dev`). The files stay in
  `site/nba/` and `site/nhl/`; the middleware serves `nhl.gmgsports.org/x` from `/nhl/x`, except
  `SHARED_FILES` (style.css, suite.css, sync.js, version.json) and `/brand/`, which come from the
  root. **A sport page that starts loading another root file (`../x.js`) needs it added to
  `SHARED_FILES`**, or it gets the sport folder's file / nothing. On a sport address, old
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
  - `version.json` (commit sha, run id, build time) is written into the site and served without
    a login (`/version.json` is let through by the middleware). It is how a deploy is confirmed.
    It also carries `nba` and `nhl`: when each of those builds last worked (`built`, null if it
    failed), how many lines it matched, and for NHL the games loaded / downloaded, how many
    players got odds (`player_odds`), how many games the Shots page has projections for
    (`shots`), or the failed build's last line (`error`). Their data files are behind the login, so this is the only way
    to see those builds from outside.
- It runs on a cron every 6 h, on **every push to main** (whatever it touched; the bot's
  model-record commits don't start one), and on manual dispatch. Every run is the same: every
  test, all three sports built fresh, every page checked ("Every run does everything" below). **Update Odds only opens the Actions page**; "Run workflow" starts it. A
  re-run of a failed run uses that run's OLD commit, never newer fixes. Pushes
  set `SKIP_SGO_FETCH=1`, so SGO odds are reused from the live site to save quota. Novig and ESPN
  are free, so they're fetched fresh on every build.
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
  - the owner-only "Update Odds" link still works (it opens the Actions page, signed in).

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

- **Why** (2026-10-13 to 10-15 it was the other way): while the repo was private (2,000 free
  minutes a month) a push rebuilt, tested and browser-checked only the sport it changed, reused
  the other sports' live data, and pushes touching only `tests/` or `tools/` started no deploy.
  On 2026-10-15 that cost about 45 minutes: a new NFL test file missing from the hand-kept list
  of each test's sport failed a deploy, and the fix touched only `tools/`, so no deploy ran. It
  also hid a bug (`smartstake.py` feeds the hockey build but counted as football-only). The
  owner approved the simple version: 3 to 4 more minutes per push for a deploy that always does
  the same thing. Don't bring per-sport deploys back to save time.
- **`tools/ci_steps.py` holds the workflows' decisions** (tested in `tests/test_ci_steps.py`).
  Each run reports itself in the public `version.json`: `timing` (seconds per stage: `install`,
  `tests`, `nfl`, `nhl`, `gate`, `cloudflare`, `total`), `data` (NBA / NHL: `built`, `live copy`
  or `missing`), `nhl_refresh`.
- **Safety nets for building everything on every push:** the NFL build is tried twice (nflverse
  sometimes gives a one-off 404). A failed NBA or NHL build has its live data put back
  (`fetch_live_data.py --only X --need X --replace`: whatever the build left is cleared first),
  so the site is never published without a sport's data; version.json then shows `live copy`
  and that sport's `error` (the build log's last line) beside the older `built`.
- Pushes still set `SKIP_SGO_FETCH=1` (SGO's monthly quota, nothing to do with minutes).
- `--only nfl|nba|nhl` on `run_tests.py` and `check_site.py` stays, for a local check while
  working on one sport. The deploy never passes it. A new test file needs no registering.
- **`.github/workflows/nhl-refresh.yml`: the hockey-only refresh.** Hourly at :47 from 16:47 to
  23:47 UTC, October to June, plus "Run workflow" (the NHL pages' Update Odds button) and a
  push that edits the file. It rebuilds only the NHL files and republishes, on the machine's
  own Python with nothing installed, no tests, no page check: about 80 seconds push to live
  on its first run. A publish replaces the whole site folder, so the NFL and NBA data are
  downloaded from the live site and put back (`--only nfl nba --strict`), and it asks twice
  (`refresh-check`, before starting and right before publishing): no full rebuild queued or
  running, main's `nfl_tool/` is the live code, nobody republished meanwhile. Any doubt = no.
  `refresh-stamp` refuses a folder with a live data file missing. `version.json` keeps the
  full rebuild's `sha` / `run` / `built`; `nhl` and `nhl_refresh` change.
- **A new generated file in the site folder** goes in `.gitignore` AND `fetch_live_data.py`'s
  `SUITES` (a test compares the two), or a refresh or a live copy put back would publish without it.
- The refresh shares the database binding, the NHL build command and the publish command with
  deploy.yml word for word (tests compare them): change both together.
- The "create Pages project" step is gone (it failed with "already exists" on every run; the
  recreate command is in deploy.yml). Looked at and left alone: the browser's system install
  (dropping it could change fonts and with them the card-fit checks) and pip caching (no real gain).

## Login gate (`nfl_tool/functions/_middleware.js`, Pages Functions)

The user wants access tied to live roles; someone who paid a week must not keep access after
cancelling.

- Config constants: GUILD_ID `1295760852892385290`, CLIENT_ID (`1554268816521957447`),
  ALLOWED_ROLE_IDS (`1471877733868109937`, `1471880013824393266`) and INVITE_URL
  (`https://gmgsports.buildr.bet/`).
- The secrets `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` live in GitHub secrets and are
  copied into the Pages project by deploy.yml before each Cloudflare deploy.
- The gate stays **off** (site open) until CLIENT_ID, roles and both secrets exist.
  **ENFORCE = true: the gate is ON.** `false` is test mode (site open; `/auth/login` plus
  `/auth/check` show whether an account would get in).
- **The build gets through the gate:** `fetch_previous_odds_snapshot` sends
  `X-GMG-Build: HMAC-SHA256(bot token, "gmg-build-v1")`, and deploy.yml passes
  `DISCORD_BOT_TOKEN` to the build steps. Push builds rely on this to reuse SGO odds; the model
  record and the odds lock rely on it to read the previous build.
- Bot invite: `https://discord.com/oauth2/authorize?client_id=1554268816521957447&scope=bot&permissions=0&guild_id=1295760852892385290`.
- `https://nfl.gmgsports.org/auth/status` shows which pieces are in place, never the values.
- Roles are re-checked with the bot every 15 min. Sessions last 30 days. If Discord's API is down,
  access is honored for 2 h after the last good check.
- OAuth scope is `identify` only; redirect URI `https://nfl.gmgsports.org/auth/callback` (sign-in on nba./nhl. is sent there).
- The session HMAC key is derived from the bot token, so rotating the token logs everyone out.

## Email members (Stripe), LIVE since 2026-10-09

For people who'd pay but won't join Discord. Password version: no email service, no webhook.

- Flow: Join -> Stripe Checkout -> signed in -> picks a password; later sign-ins are **email +
  password**; the gate asks Stripe for the member's subscription every RECHECK_MS; failed payment
  / cancel = no access (same live rule as Discord roles). Only secret needed: `STRIPE_SECRET_KEY`.
  Discord login keeps working alongside it.
- Code: the "Email members (Stripe)" block. Routes `/join`, `POST /stripe/checkout`
  (subscription, `trial_period_days` 7 unless the email had a trial, `payment_method_collection`
  always, promo codes allowed, email in metadata), `/join/done` (confirms with Stripe, saves the
  member, one-trial-per-card check via the `trial_cards` fingerprint -> `trial_end=now`, signs in,
  sends to `/set-password`), `/auth/email` (email + password; same reply for unknown email or
  wrong password; 5 misses = 15-min lock), `/set-password` (8+ chars; also the "Password" link in
  the account chip), `/account` (Stripe billing portal), `/admin/members` (owner-only: grant
  access until a date for Zelle/Venmo payers; reset a password -> shows a temporary one to send
  them). An optional `POST /stripe/webhook` works if `STRIPE_WEBHOOK_SECRET` is ever added.
- Passwords: PBKDF2-SHA256, 100k iterations, random salt. Sessions `kind: "email"`, uid
  `email:<address>`; an email member with no password is redirected to `/set-password`.
- Turns on when `STRIPE_SECRET_KEY` + DB exist. With an `sk_test_` key only the owner (signed in
  with Discord) can check out and the login page hides Join; with the `sk_live_` key (in place
  now) Join is open to everyone.
- D1 tables `members` (+ `pw`, `fail_count`, `lock_until`, added by ALTERs in deploy.yml) and
  `trial_cards`.
- **Free trial:** 7 days, card or bank required, $0 until it ends (Stripe's reminder email before
  the first charge is on in the dashboard), one trial per email and per card. Optional promo codes
  for video viewers via Stripe coupons.
- **Prices (`STRIPE_PRICE_IDS`, not secret):** test monthly $5 = `price_1UOKQhLM3ebsVWbZWbCfXE9X`,
  test yearly $45 = `price_1UOKQhLM3ebsVWbZrn3B6uGt`; live monthly $5 =
  `price_1UOg8YLM3ebsVWbZZQXVqT3q`, live yearly $45 = `price_1UOg99LM3ebsVWbZZwm7LMCD`. The key in
  use (sk_test_ / sk_live_) picks the set, and Join stays closed in a mode with blank IDs. A
  subscription Stripe doesn't know (`resource_missing`, e.g. test members after going live) marks
  that member canceled.
- Fees (approx., verify current rates): card ~2.9% + 30c + ~0.7% Billing = ~49c of $5; ACH ~8c.
  The flat 30c is why there's a yearly plan.
- No Node.js on the user's PC: the middleware was tested in the browser with sql.js standing in
  for D1 and a fake Stripe.

## Sign-in screens (the user's wording; keep it)

- Header: the real GMG logo (`site/brand/gmg-logo.png`, served publicly through the `/brand/`
  bypass in the middleware) and **"GMG Sports Data Suite"**. The brand isn't NFL-only.
- `accessPage`, left box **"Join with Discord"**: "For $5 a month, get access to the site and
  Discord server.", a **Join now** button (INVITE_URL, Buildr) and **Log in with Discord**.
- Right box **"Hate Discord? No problem"**: "7-day free trial, then $5 a month or $45 a year.
  Access to the entire site.", the email box, the two trial plan buttons, and a small "Already
  joined with email? Sign in" link to `/auth/email`.
- `/auth/email` is its own page (`emailPage`): email + password form, and where every email
  sign-in error lands.
- No "forgot your password" line (removed at the user's request; the owner resets passwords at
  `/admin/members`).
- Stacks under 720px. When Join is closed, the right box says email memberships are coming soon.
- All text on these pages is ALL CAPS (`page()` CSS, buttons included), like the gmgsports.org
  style. Typed input values and tables stay as written.

## Member profiles (`sync.js` + `/api/state`)

- `/api/state` in the middleware (GET all, PUT one key; newest `updated` wins) is backed by the D1
  database `gmg-nfl-users` (table `user_state(uid,k,v,updated)`), bound as `DB`.
- deploy.yml creates the database and table, so the token needs **D1 Edit** as well as Pages Edit.
- `site/sync.js` keeps localStorage as the working copy. It pulls on load and on tab focus, pushes
  each save debounced, and on first contact merges pre-profile local data (lists by id, objects by
  key) instead of overwriting it. It mirrors saved plays, picks, notes, summary rails, manual Outs
  and model presets.
- Synced keys are listed in both `SYNC_KEYS` (middleware) and `KEYS` (sync.js). **Add new per-user
  data to both**, and call `window.NFLSync?.push(key, value)` in its save function.
- Display prefs (theme, views, selected game) stay per-device.
- **Owner-only controls:** `OWNER_IDS` (the user's Discord ID `613105360286253076`) makes
  `/api/state` return `user.owner`. sync.js then adds `html.is-owner`, and the **Update Odds**
  button (which runs the GitHub build) is shown only then, plus on localhost (`html.local-dev`).
- **Request a feature:** sync.js adds a yellow "💡 Request a feature" button just left of the
  account chip (logged-in members only; icon-only on phones). It opens a box titled "Have an idea
  for a tool, data point, or feature? I will do my best to get it added!". The idea is POSTed to
  `/api/requests` and saved in the D1 table `feature_requests` (created by deploy.yml). Limits:
  1000 characters per idea and 10 ideas per member per day. The owner's button reads "Feature
  requests": it lists every idea newest first (name, date), with Mark added / Undo / Delete (a
  PATCH; delete is soft, status `deleted`) and "+ Add my own idea". Members can never read others'
  ideas.
- **Promo payouts** (`PROMO_PAYOUTS`, 2026-10-14): `/api/crease-payouts` (NHL King of the
  Crease, keyed by `date`) and `/api/koe-payouts` (NFL King of the Endzone, keyed by nflverse
  `game` id). GET for any signed-in member, PUT owner-only (`{date|game, pool, payouts: [{id,
  name, paid}]}`; replaces that contest, an empty list removes it). D1 tables `crease_payouts` /
  `koe_payouts` (`<key>, pool, payouts JSON, updated`), each created by the endpoint on first use,
  so no deploy step. Used by the Promo Tools Winners lists (nhl.md, plays-and-promos.md). Test:
  `tests/test_ci_crease_payouts.py` (a D1 stand-in).
- **Suite switcher** (`addSuiteSwitcher`, `SUITE_SWITCH_PUBLIC`): see nba.md. It lists NFL, NBA
  and NHL (`SUITES`).

## Support tab (`support.html`)

Last in the nav after Promo Tools. Shows the user's socials (pill buttons) and codes/tools cards
in the gmgsports.org hub look (Black, ALL CAPS, gold copy-code buttons, green "Free trial"
badges). It fetches `https://gmgsports.org/links.json` live (CORS allows it; logo paths get the
hub prefix), so to change a link, code or blurb edit `links.json` in the hub repo
(josh-conley/gmg-site), not here. The hub's "suite" section is skipped. The Novig offer is
**$50** in trade credits for a $10 deposit, code **GMGO** (also hardcoded in `game-overview.html`;
QR at `site/novig-qr.png`).
