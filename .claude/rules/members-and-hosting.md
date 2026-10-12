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
- **deploy.yml** builds the data, deploys `nfl_tool/site` to GitHub Pages, then publishes the same
  built folder to Cloudflare Pages using the secrets `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. The Cloudflare steps are `continue-on-error`. It deploys from
  `nfl_tool/` so the Pages Functions get bundled, and writes `nfl_tool/wrangler.toml` in CI.
- It runs on a cron every 6 h, on pushes touching `nfl_tool/**`, and on manual dispatch. Pushes
  set `SKIP_SGO_FETCH=1`, so SGO odds are reused from the live site to save quota. Novig and ESPN
  are free, so they're fetched fresh on every build.
- Other steps: "Build NBA data" (`continue-on-error`) and "Save GMG model record" (commits
  `model_history/gmg_model.json` as github-actions[bot]; the workflow has `contents: write`).
- `.github/workflows/cloudflare-domain.yml` attached `nfl.gmgsports.org` to the Pages project
  through the API. It can be re-run from the Actions tab and prints the verification status. (The
  Cloudflare connector for Claude can't manage Pages domains; the GitHub secret token can.)
- **Known bypass, still open:** the GitHub Pages copy still serves the site to anyone who hits
  GitHub's IPs directly, and the repo is public. Turn off GitHub Pages and make the repo private
  once the user agrees.

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
- **Suite switcher** (`addSuiteSwitcher`, `SUITE_SWITCH_PUBLIC`): see nba.md.

## Support tab (`support.html`)

Last in the nav after Promo Tools. Shows the user's socials (pill buttons) and codes/tools cards
in the gmgsports.org hub look (Black, ALL CAPS, gold copy-code buttons, green "Free trial"
badges). It fetches `https://gmgsports.org/links.json` live (CORS allows it; logo paths get the
hub prefix), so to change a link, code or blurb edit `links.json` in the hub repo
(josh-conley/gmg-site), not here. The hub's "suite" section is skipped. The Novig offer is
**$50** in trade credits for a $10 deposit, code **GMGO** (also hardcoded in `game-overview.html`;
QR at `site/novig-qr.png`).
