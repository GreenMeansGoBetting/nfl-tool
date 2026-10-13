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
- It runs on a cron every 6 h, on pushes touching `nfl_tool/**`, and on manual dispatch. Pushes
  set `SKIP_SGO_FETCH=1`, so SGO odds are reused from the live site to save quota. Novig and ESPN
  are free, so they're fetched fresh on every build.
- Other steps: "Build NBA data" and "Build NHL data" (both `continue-on-error`; the NHL one
  sits between "Restore saved NHL games" and "Save NHL games", see nhl.md), "Note the NBA and NHL
  builds in version.json", and "Save GMG model record" (commits everything in
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
- `.github/workflows/cloudflare-domain.yml` attached `nfl.gmgsports.org` to the Pages project
  through the API. It can be re-run from the Actions tab and prints the verification status. (The
  Cloudflare connector for Claude can't manage Pages domains; the GitHub secret token can.)
- **The repo is private and GitHub Pages is off** (2026-10-13). The Pages copy had served the
  site without the login; it was dropped from the deploy, then the user made the repo private,
  which unpublished it (checked: GitHub's servers return 404 for the old copy). Because of that:
  - the public GitHub API no longer shows the runs, so confirm deploys with `version.json`;
  - there is no `gh` on the user's PC, so a failed run can only be read by the user on the
    Actions page (or from the failure email); ask them for the red step's name;
  - private repos get 2,000 free build minutes a month, which is why runs are kept lean
    ("Build minutes" below);
  - the owner-only "Update Odds" link still works (it opens the Actions page, signed in).

## Build minutes: an isolated task must not set off unrelated work (2026-10-13)

The repo going private put the builds on GitHub's 2,000 free minutes a month (a job is billed
by the minute, rounded up). Every run used to do everything, and when the user was told a
lineup check meant a whole-site rebuild: "Why is checking for lineups rebuilding the entire
site? That doesn't even make sense ... fix anything else that would trigger unnecessary steps
for an isolated task." If the minutes ever ran out the site would stay up; what stops is the
refreshing and new code going live, until the 1st or about $0.008 a minute.

- **`tools/ci_steps.py` holds the workflows' decisions** (tested in `tests/test_ci_steps.py`,
  because nobody can read the Actions log from here). Each run reports itself in the public
  `version.json`: `data` (per suite `built` or `reused`), `timing` (seconds per stage:
  `install`, `tests`, `nfl`, `nhl`, `gate`, `cloudflare`, `total`), `nhl_refresh`.
- **A push rebuilds only what it changed** (`plan`). It compares the code being deployed with
  the code that is LIVE (`version.json`'s sha, so a push whose deploy failed still counts).
  A suite whose build code is unchanged has its data taken exactly as it is live ("Reuse the
  live ... data": `tools/fetch_live_data.py --only X --need X`); if that download isn't whole,
  the build runs after all. NFL build code = everything under `nfl_tool/` outside `site/`,
  `functions/`, `nba/`, `nhl/`. A push that edits `deploy.yml`, or anything unclear, builds
  everything. So a push no longer refreshes odds as a side effect.
- **The 6-hour cron and "Update Odds" always build everything** and run the housekeeping.
- **Housekeeping** = pushing the secrets to Cloudflare and the member-table commands. Skipped
  on a code push (a new secret value is live within 6 hours, or at once with "Update Odds").
  The database binding itself is written on every run. The "create Pages project" step is
  gone (it failed with "already exists" on every run; the recreate command is in deploy.yml).
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
  `SUITES` (a test compares the two), or a refresh or a reused deploy would publish without it.
- The refresh shares the database binding, the NHL build command and the publish command with
  deploy.yml word for word (tests compare them): change both together.
- Looked at and left alone: the tests on scheduled runs (they keep untested code from ever
  being published), the browser's system install (dropping it could change fonts and with them
  the card-fit checks), and pip caching (no real gain).

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
- OAuth scope is `identify` only; redirect URI `<origin>/auth/callback`.
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
