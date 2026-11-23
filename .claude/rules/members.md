---
paths:
  - "nfl_tool/functions/**"
  - "nfl_tool/site/support.html"
---
# Members and the Login Gate

Stories behind these rules (the hosting move, the Stripe setup, wording choices):
`docs/history.md`, "Members and hosting".

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
  `DISCORD_BOT_TOKEN` to the build steps. The model
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
  access until a date for Zelle/Venmo payers; the email box takes a pasted list, commas / spaces /
  one per line, for grant and remove since 2026-10-22, used to give the Stripe members 30 days
  free while they move to Buildr; reset a password (one email) -> shows a temporary one to send
  them; test `tests/test_ci_admin_members.py`). An optional `POST /stripe/webhook` works if `STRIPE_WEBHOOK_SECRET` is ever added.
- Passwords: PBKDF2-SHA256, 100k iterations, random salt. Sessions `kind: "email"`, uid
  `email:<address>`; an email member with no password is redirected to `/set-password`.
- Turns on when `STRIPE_SECRET_KEY` + DB exist. With an `sk_test_` key only the owner (signed in
  with Discord) can check out and the login page hides Join; with the `sk_live_` key (in place
  now) Join is open to everyone.
- **New signups CLOSED since 2026-10-22** (`STRIPE_JOIN_OPEN = false`; the owner is moving
  memberships to Buildr, `buildr.bet/docs`: OIDC sign-in + members API, no webhooks, no Stripe
  import). The right box shows the "coming soon" text; existing email members still sign in, are
  re-checked with Stripe and use `/account`. Test: `tests/test_ci_stripe_join_closed.py`.

## Buildr members (sign in with Buildr, built 2026-10-22)

The replacement for Stripe Join: people join on Buildr and sign in with Buildr. `BUILDR_JOIN_URL`
= the Buildr product **"GMG Data Site ONLY"** (no Discord role, $5/mo or $45/yr, 7-day trial; not
listed on the public store, reached by this link). Its Post-Purchase Redirect is
`https://nfl.gmgsports.org/auth/buildr/login`, so buyers skip Buildr's "Connect Discord –
Required" screen (shown for products with a Discord role) and land signed in. The right box reads
"Hate Discord? No problem" / "7-day free trial, then $5 a month or $45 a year. Access to the entire site." Code: the "Buildr members" block in the middleware.

- **Off until the GitHub secrets `BUILDR_CLIENT_ID` + `BUILDR_API_KEY` exist** (`BUILDR_CLIENT_SECRET`
  too if Buildr gave the app one; then the token call uses client_secret_basic, else PKCE only).
  deploy.yml copies all three into Pages. `/auth/status` shows `buildr` on/off.
- Owner setup in Buildr: Settings, Integrations, **Customer sign-in**, Register app, redirect URL
  `https://nfl.gmgsports.org/auth/buildr/callback`; **Buildr API** key with `members:read`.
- Flow: `/auth/buildr/login` (PKCE S256, state cookie `gmg_buildr_state`; on nba./nhl. sent to
  the NFL address like Discord) -> Buildr -> `/auth/buildr/callback` (state + `iss` checked, token,
  `/api/oidc/me`) -> members API: `GET members/{sub}`, else `POST members/lookup` by email. Access =
  member `active` with a subscription `active`/`trialing` (`BUILDR_PRODUCT_IDS` empty = any
  product). Session `kind: "buildr"`, uid `buildr:<member id>`, re-checked every RECHECK_MS with
  the same 2 h outage grace as Discord. Account menu: Manage Membership -> the Buildr store.
- Buildr has no webhooks and no Stripe import (buildr.bet/docs): Stripe members stay on Stripe.
- Unverified until the owner's keys exist: whether `sub` equals the members API id (the email
  lookup covers it) and the client's token auth method.
- Test: `tests/test_ci_buildr_members.py` (a fake Buildr).
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

## Support tab (`support.html`)

Reached from the account menu (the 2026-10-17 top menu has no Support button). Shows the user's socials (pill buttons) and codes/tools cards
in the gmgsports.org hub look (Black, ALL CAPS, gold copy-code buttons, green "Free trial"
badges). It fetches `https://gmgsports.org/links.json` live (CORS allows it; logo paths get the
hub prefix), so to change a link, code or blurb edit `links.json` in the hub repo
(josh-conley/gmg-site), not here. The hub's "suite" section is skipped. The Novig offer is
**$50** in trade credits for a $10 deposit, code **GMGO** (also hardcoded in `game-overview.html`;
QR at `site/novig-qr.png`).
