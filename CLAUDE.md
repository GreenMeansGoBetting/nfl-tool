# GMG's NFL Suite — project guide for Claude

**Keep this file current.** Whenever a feature, data source, workflow, or one of the
user's preferences changes, update the matching section here **in the same commit**.
Any session on any machine (desktop, laptop, claude.ai/code) relies on this file for
context. It is the only copy that travels with the repo.

## What this is

- Live at **https://nfl.gmgsports.org**. Repo: `GreenMeansGoBetting/nfl-tool`.
- Owner: a sports-betting content creator ("GMG" = Green Means Go) with no coding
  background. Explain in plain language and do the technical work yourself.
- The user screenshots sections and the **Summary cards** (fixed 1160×980, sized to their
  video template's left area) and drops them into betting videos. Favor dense,
  screenshot-ready, visually clean layouts.
- NFL is the active project. (A separate CFB tool is paused.)

## Workflow the user expects

1. Make the change and verify it locally (see below).
2. **Commit and push to `main`**. GitHub Actions rebuilds and deploys automatically.
3. Confirm it's live: poll `https://nfl.gmgsports.org/<file>?x=N` until the new code or
   data shows up, usually 60–105 s.
4. Tell the user to hard refresh (Ctrl+Shift+R).
5. Update this CLAUDE.md in the same commit whenever anything below changes.

- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys.** `SGO_API_KEY` and
  `SGO_API_KEY_BACKUP` are GitHub Actions secrets. Any future key (e.g. a Novig trading
  key) goes in GitHub Settings → Secrets, added by the user.

## Architecture

- `nfl_tool/build_stats.py`: the whole data pipeline. It reads nflverse play-by-play,
  rosters, injuries, snap counts, FTN charting and schedules, plus odds from Novig and
  SportsGameOdds and ESPN FPI, and writes `nfl_tool/site/data.json` (untracked; built in CI).
- `.github/workflows/deploy.yml`: runs build_stats and deploys `nfl_tool/site` to GitHub Pages.
  - It runs on a cron every 6 h, on pushes touching `nfl_tool/**`, and on manual dispatch.
  - Pushes set `SKIP_SGO_FETCH=1`, so SGO odds are reused from the live site to save quota.
    Novig and ESPN are free, so they're fetched fresh on every build.
- `nfl_tool/site/`: static HTML/CSS/JS pages.
  - `game-overview.html/.js` + `game-summary.js`: **Game Previews** (Full Preview + Summary card).
  - `index.html` + `app.js`: **TD Data** (Season TDs, First TD, Summary card).
  - `player-props.html/.js` + `props-summary.js`: **Player Props** (Receiving/Rushing/Passing + Summary card).
  - `possible-plays.html/.js`: the Possible Plays list.
  - `picks.js`: the Pick Tracker.
  - `possible-plays.js` **View Results** (2026-10-06): checkboxes on each bet, a select-all box, and
    "Select by game" chips; when any shown bet is checked, the summary covers only the checked ones
    ("Summary of N selected bets" + Clear selection). In-memory per visit (`resultsSelected`). The
    user wanted to recap just MNF.
  - **TD bets grade on a loose name match** (`gradeTdPlay`, `normName`, 2026-10-06): bets keep the
    sportsbook's spelling ("Brian Robinson Jr.") while TD results use nflverse's ("Brian Robinson");
    an exact match graded his MNF TD a loss. Already-graded auto losses flip to wins on next load.
  - Local builds: `nfl_tool/build_stats.py` only downloads a data file if it's missing
    (`download_if_missing`), so a local `data/` folder goes stale. Delete `data/*_2026*` and
    `data/games.csv` before a local build that needs the latest games. CI always starts fresh.
  - `support.html`: **Support** tab (added 2026-10-09, last in the nav after Promo Tools). Shows the
    user's socials (pill buttons) and codes/tools cards in the gmgsports.org hub look (Black, ALL
    CAPS, gold copy-code buttons, green "Free trial" badges). It fetches
    `https://gmgsports.org/links.json` live (CORS allows it; logo paths get the hub prefix), so to
    change a link, code or blurb edit `links.json` in the hub repo (josh-conley/gmg-site), not here.
    The hub's "suite" section is skipped. Novig offer is **$50** in trade credits for a $10 deposit
    (also hardcoded in `game-summary.js` and `game-overview.html` Novig panels).
  - `promo-tools.html/.js`: **Promo Tools** tab (added 2026-10-05). First section: **King of the
    Endzone** (DraftKings' weekly promo paying on the game's LONGEST TD, D/ST included).
    - Team checklist for this week's games (per-device, `nfl-tool.koe.teams`), position filter.
    - Player table: TDs (count / avg / long), TDs by distance (1-10, 11-20, 21-40, 41+), big
      plays (20+/g, 40+ count, longest play), role (touches/g, 20+ runs / catches, ADOT for
      WR/TE only, deep targets/g), and this week's defense (20+ plays allowed/g matched to runs
      or catches by the player's mix, 20+ TDs allowed, avg TD length allowed). Colors vs the
      whole league. Ruled-out players hidden; QBs = current starter only.
    - **Upside** = league percentile of weighted z's (`KOE_UPSIDE_PARTS`: 20+ plays 35%, 40+
      plays 15%, deep role 15%, TD length 10%, opponent big plays allowed 25%), rates shrunk by
      `KOE_PRIOR_GAMES` 2. First-guess weights; the user said "we can adjust if needed".
    - Layout (user 2026-10-05): each column group has a colored header bubble spanning its columns
      (`KOE_GROUP_CLASS`, `.koe-g-*` colors), empty 8px gap columns split the groups, and every
      stat box is a fixed 44px (TD distances 38px; `table-layout: fixed`, colgroup), rows 32px; the player column (214px) has photo, name, team logo and position on one line. No Opp column (obvious from the matchup). Table ~1130px so it screenshots easily; **Save image** (`saveKoeImage`) downloads `#koe-capture` as a PNG with a GMG title naming the games and week.
    - D/ST table: return TDs (INT / FUM / KR / PR with yards), takeaways/g, opponent giveaways/g,
      D/ST TDs the opponent has allowed. No Upside score for D/ST yet.
    - Data: `build_stats.py compute_koe` -> `DATA.koe` (players per team, team big plays allowed,
      `dst_tds` / `dst_tds_allowed`; return TD length = `return_yards`, else
      `fumble_recovery_1_yards`).
  - `common.js`: shared helpers — tiers, possible plays, modals, the summary-card
    photo/banner/fit/**Save image** helpers, and lineup weights.
  - `player-card.js`: **the player card**, the ONE popup for every player name or photo on every
    page. Anything wrapped with `playerClick(team, name, inner?, oppTeam?)` (or `.player-click` +
    `data-entry {team, name, oppTeam}`) opens it.
    - **Odds tab:** every prop line plus Anytime and First TD, with Possible Plays checkboxes, and
      "+ Summary" on the Player Props page.
    - **Game Log tab:** weekly versions of the Receiving / Rushing / Passing table stats (snap %,
      target share, ADOT, YAC/rec, depth buckets, 10+ runs, RZ looks), each column shaded against
      the player's own weeks, with an Avg row.
    - **Rush/Catch Lanes tab:** RB/QB rushing first, WR/TE catch zones first.
    - The file also holds the rush-lane and pass-zone drawing code (moved out of player-props.js),
      so every page can draw them.
    - Injury lists and box scores link skill positions only (`SKILL_POSITIONS`).
    - **Any new place that shows a player must use playerClick.**
  - `sync.js`: **member profiles**. It mirrors saved plays, picks, notes, summary rails and manual Outs to the logged-in Discord member's profile (`/api/state`, Cloudflare D1), so they follow them to any device. (Replaced the owner-only Firebase sync on 2026-09-28.)
  - `teams.js`: team names, colors and logo URLs.
  - `style.css`: dark/light theme tokens and all page styles.
    - **Phone layout (added 2026-09-29):** one `@media (max-width: 760px)` block at the very end of
      style.css holds every phone-only rule, so desktop stays pixel-identical (verified by diffing
      1440px screenshots before/after). Nothing is hidden on phones: wide sections scroll sideways
      inside their own box with the first (name) column pinned, side-by-side columns stack,
      Target Zones cards go two across, and the tab menu tightens (edge fade under 380px).
      New wide tables/grids should live inside `.stat-columns > section` (or get `min-width: 0;
      overflow-x: auto` in that block) so they don't widen the page on phones.
    - Phones also get: `html, body { overflow-x: clip }` (anything too wide made iOS zoom the whole
      page out, leaving a dark strip on the right); a compact topbar (acct name hidden, Update Odds
      icon-only), since the live logged-in topbar is wider than the local copy's; and
      `wrapWideTablesForPhone` (common.js), which wraps any table wider than its box in `.m-scroll`
      so only that table scrolls, not its whole section. Test phone layout with the acct chip and
      `is-owner` class added, or the topbar overflow won't show up locally.
    - The Summary cards are fixed 1160px images; on phones `zoomSummaryCardForPhone` (common.js,
      same 760px breakpoint) shrinks the card to fit, and `saveSummaryImage` lifts the zoom while
      capturing, so saved PNGs are identical on every device.

### Hosting (moving to Cloudflare, started 2026-09-28)

- **Today:** `nfl.gmgsports.org` is a CNAME to GitHub Pages (`greenmeansgobetting.github.io`).
  The domain is at **Namecheap**, which also runs email forwarding (MX `eforward*.registrar-servers.com`).
  **Don't move the whole domain's nameservers**; only the `nfl` record changes.
- **deploy.yml** also publishes the same built folder to **Cloudflare Pages** project `gmg-nfl`
  (test address `*.pages.dev`), using the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  Those steps are `continue-on-error`, so they never block the GitHub Pages deploy.
- `.github/workflows/cloudflare-domain.yml` attached `nfl.gmgsports.org` to the Pages project
  through the API. It can be re-run from the Actions tab and prints the verification status.
  (The Cloudflare connector for Claude can't manage Pages domains; the GitHub secret token can.)
- **Plan, one step at a time:**
  1. Cloudflare copy verified, then switch the `nfl` CNAME at Namecheap to the pages.dev address.
  2. Discord login gate (Pages Functions). A bot checks the member's **current** roles
     server-side on every visit (short session, re-checked every ~15–30 min), so cancelling
     or losing a role cuts access. data.json is gated too.
  3. Free vs Supporter roles.
  4. Sell the role (Discord Server Subscriptions / Patreon / Whop).
  5. ~~Optional Patreon/Whop login~~ -> **Email + Stripe membership for people without Discord**
     (built 2026-10-08; Stripe is in Test mode until the user goes live). Some people would pay
     but won't join Discord, and the user wants low fees on $5/month, so: direct Stripe.
     - **How it works (password version):** the user refused the email-service (Resend + Namecheap
       DNS) and webhook setup as too much work, so: Join -> Stripe Checkout -> signed in -> picks a
       password; later sign-ins are **email + password**; the gate asks Stripe for the member's
       subscription every RECHECK_MS (no webhook needed); failed payment / cancel = no access (same
       live rule as Discord roles). Only secret needed: `STRIPE_SECRET_KEY`. Discord login keeps
       working alongside it.
     - Code: `nfl_tool/functions/_middleware.js` "Email members (Stripe)" block. Routes `/join`,
       `POST /stripe/checkout` (subscription, `trial_period_days` 7 unless the email had a trial,
       `payment_method_collection` always, promo codes allowed, email in metadata), `/join/done`
       (confirms with Stripe, saves the member, one-trial-per-card check via the `trial_cards`
       fingerprint -> `trial_end=now`, signs in, sends to `/set-password`), `/auth/email`
       (email + password; same reply for unknown email or wrong password; 5 misses = 15-min lock),
       `/set-password` (8+ chars; also the "Password" link in the account chip), `/account` (Stripe
       billing portal), `/admin/members` (owner-only: grant access until a date for Zelle/Venmo
       payers; reset a password -> shows a temporary one to send them). An optional
       `POST /stripe/webhook` works if `STRIPE_WEBHOOK_SECRET` is ever added. Passwords:
       PBKDF2-SHA256, 100k iterations, random salt. Sessions `kind: "email"`, uid
       `email:<address>`; an email member with no password is redirected to `/set-password`.
       Turns on when `STRIPE_SECRET_KEY` + DB exist; with an `sk_test_` key only the owner (signed
       in with Discord) can check out and the login page hides Join. D1 tables `members` (+ `pw`,
       `fail_count`, `lock_until`, added by ALTERs in deploy.yml) and `trial_cards`. Tested in the
       browser (no Node on this PC) with sql.js standing in for D1 and a fake Stripe: 34 checks.
     - **Free trial (user 2026-10-08):** 7 days, card or bank required, $0 until it ends (Stripe's
       reminder email before the first charge is on in the dashboard), one trial per email and per
       card. Optional promo codes for video viewers via Stripe coupons.
     - **Prices (`STRIPE_PRICE_IDS`, not secret):** test monthly $5 = `price_1UOKQhLM3ebsVWbZWbCfXE9X`,
       test yearly $45 = `price_1UOKQhLM3ebsVWbZrn3B6uGt`; live monthly $5 = `price_1UOg8YLM3ebsVWbZZQXVqT3q`,
       live yearly $45 = `price_1UOg99LM3ebsVWbZZwm7LMCD` (added 2026-10-09; live account activated).
       The key in use (sk_test_ / sk_live_) picks the set, and Join stays closed in a mode with blank
       IDs, so the GitHub key can be swapped in any order. A subscription Stripe doesn't know
       (`resource_missing`, e.g. test members after going live) marks that member canceled.
     - **One sign-in screen (redone 2026-10-09 to the user's wording):**
       - Header: the real GMG logo (`site/brand/gmg-logo.png`, served publicly through the `/brand/`
         bypass in the middleware) and **"GMG Sports Data Suite"**. The brand isn't NFL-only; NBA is
         coming.
       - `accessPage`, left box **"Join with Discord"**: "For $5 a month, get access to the site and
         Discord server.", a **Join now** button (INVITE_URL, Buildr) and **Log in with Discord**.
       - Right box **"Hate Discord? No problem"**: "7-day free trial, then $5 a month or $45 a year.
         Access to the entire site.", the email box, the two trial plan buttons, and a small "Already
         joined with email? Sign in" link to `/auth/email`.
       - `/auth/email` is its own page (`emailPage`): email + password form, and where every email
         sign-in error lands.
       - The "forgot your password" line was removed at the user's request (the owner can still
         reset passwords at `/admin/members`).
       - Stacks under 720px. When Join is closed (test mode for non-owners), the right box says email
         memberships are coming soon.
       - All text on these pages is ALL CAPS (`page()` CSS, buttons included), like the
         gmgsports.org style. Typed input values and tables stay as written.
     - Fees (approx., verify current rates): card ~2.9% + 30c + ~0.7% Billing = ~49c of $5; ACH
       ~8c. The flat 30c is what hurts, which is why there's a yearly plan.
     - **To go live:** in Stripe's live mode, (1) activate the account, (2) copy the product to live
       mode (or recreate the $5/month and $45/year prices) and send the two live `price_` IDs ->
       `STRIPE_PRICE_IDS.live`, (3) redo the live-mode settings that don't carry over (payment methods
       incl. ACH, customer portal, trial-reminder / failed-payment emails), (4) replace the GitHub
       secret `STRIPE_SECRET_KEY` with the `sk_live_` key. Then the trial panel opens to everyone.
- The user wants access tied to live roles; someone who paid a week must not keep access after cancelling.
- **Gate code:** `nfl_tool/functions/_middleware.js` (Pages Functions; deploy.yml deploys from `nfl_tool/`
  so the functions get bundled). It holds the config constants: GUILD_ID `1295760852892385290`,
  CLIENT_ID, ALLOWED_ROLE_IDS (`1471877733868109937`, `1471880013824393266`) and INVITE_URL (`https://gmgsports.buildr.bet/`).
  - The secrets `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` live in GitHub secrets and are copied
    into the Pages project by deploy.yml before each Cloudflare deploy.
  - The gate stays **off** (site open) until CLIENT_ID (`1554268816521957447`), roles and both secrets exist.
  - **ENFORCE = true since 2026-09-28: the gate is ON.** `false` is test mode (site open;
    `/auth/login` plus `/auth/check` show whether an account would get in).
  - **The build gets through the gate:** `fetch_previous_odds_snapshot` sends
    `X-GMG-Build: HMAC-SHA256(bot token, "gmg-build-v1")`, and deploy.yml passes `DISCORD_BOT_TOKEN`
    to the build step. Push builds rely on this to reuse SGO odds.
  - Bot invite: `https://discord.com/oauth2/authorize?client_id=1554268816521957447&scope=bot&permissions=0&guild_id=1295760852892385290`.
  - `https://nfl.gmgsports.org/auth/status` shows which pieces are in place, never the values.
  - Roles are re-checked with the bot every 15 min. Sessions last 30 days. If Discord's API is down,
    access is honored for 2 h after the last good check.
  - OAuth scope is `identify` only; redirect URI `<origin>/auth/callback`.
  - The session HMAC key is derived from the bot token, so rotating the token logs everyone out.
  - **Member profiles:**
    - `/api/state` in the middleware (GET all, PUT one key; newest `updated` wins) is backed by the D1
      database `gmg-nfl-users` (table `user_state(uid,k,v,updated)`), bound as `DB`.
    - deploy.yml creates the database and table and writes `nfl_tool/wrangler.toml` in CI, so the
      token needs **D1 Edit** as well as Pages Edit.
    - `site/sync.js` keeps localStorage as the working copy. It pulls on load and on tab focus,
      pushes each save debounced, and on first contact merges pre-profile local data (lists by id,
      objects by key) instead of overwriting it.
    - Synced keys are listed in both `SYNC_KEYS` (middleware) and `KEYS` (sync.js). **Add new
      per-user data to both**, and call `window.NFLSync?.push(key, value)` in its save function.
    - Display prefs (theme, views, selected game) stay per-device.
  - **Owner-only controls:** `OWNER_IDS` (the user's Discord ID `613105360286253076`) makes `/api/state`
    return `user.owner`. sync.js then adds `html.is-owner`, and the **Update Odds** button (which runs
    the GitHub build) is shown only then, plus on localhost.
  - **Request a feature (added 2026-10-09):**
    - sync.js adds a yellow "💡 Request a feature" button just left of the account chip (logged-in
      members only; icon-only on phones).
    - It opens a box titled "Have an idea for a tool, data point, or feature? I will do my best to
      get it added!". The idea is POSTed to `/api/requests` and saved in the D1 table
      `feature_requests` (created by deploy.yml).
    - Limits: 1000 characters per idea and 10 ideas per member per day.
    - The owner's button reads "Feature requests" instead. It lists every idea newest first (name,
      date), with Mark added / Undo / Delete (a PATCH; delete is soft, status `deleted`) and
      "+ Add my own idea".
    - Members can never read others' ideas.
  - Known bypass until fixed: the GitHub Pages copy still serves the site to anyone who hits
    GitHub's IPs directly, and the repo is public. Turn off GitHub Pages and make the repo
    private once the gate is confirmed.

### Local verification

- Build: `SKIP_SGO_FETCH=1 python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  If the build hits a 404, it's a transient nflverse error; re-run.
- Serve `nfl_tool/site` with `python -m http.server <fresh port>` and check in the browser.
  Use a fresh port each time; the preview caches aggressively.
- Summary cards are 1160×980. `fitSummaryCard()` scales the content down if it overflows,
  and a scale near 1 is the goal.
- Save image uses html-to-image with `includeQueryParams: true`. Without it, ESPN logo URLs
  that differ only by query string collapse to one image.

## Data sources and key models

- **Odds: Novig first, SGO fills gaps.**
  - Novig's public game feed is `POST https://api.novig.us/v1/graphql`, operation
    `EventMarkets_Query`. The query text is saved verbatim in
    `nfl_tool/novig_event_markets.graphql`.
    - Novig only accepts its own site's exact query. If `novig_debug.error` shows up in
      data.json, recapture the request body from the browser network tab on any novig.com
      game page and overwrite the file.
    - Games come from `GET https://api.novig.us/v3/public/catalog/events?league=NFL`.
    - `is_consensus` marks the main line; `outcomes[].available` is the price (0–1).
  - Player props, Anytime/First TD, and game spread/total/moneyline (`game.novig`) come
    from Novig. A market is only used from Novig when both sides are priced. Thin books
    are flagged `thin`.
  - The user promotes Novig (code **GMGO**: deposit $10 → $50 in trade credits; QR at
    `site/novig-qr.png`). The user says Novig is fine with outside tools reading its feed.
  - SGO (SportsGameOdds, free tier) leaves many props without a book price. See
    `sgo_props_debug` in data.json.
- **ESPN FPI** (`espn_ratings`): offense/defense/FPI turned into 1–100 league-normed
  ratings, plus SOS rank. FPI is predictive; it includes preseason priors and QB changes.
- **Opponent adjustment:**
  - `prop_matchup_model` gives what each defense allows and each offense produces by
    position, throw depth and play type, with ranks.
  - `team_stats_adj` powers the Game Previews **Raw / vs Opponents** toggle.
  - Early samples are shrunk toward league average.
- **Context weights (passing numbers):** games in rain, snow or 15+ mph wind count 30%;
  games against a backup QB count 30% toward the defense's numbers.
- **Lineup-aware player usage (important):**
  - Uses `player_snaps` plus injuries.
  - A game a regular left early doesn't count.
  - A fill-in game while a regular (healthy now) was out counts 15%.
  - TD Data uses `lineupWeights` / `lineupAdjustedXtd` in common.js; Props uses
    `propBaselineGames`.
  - **Never surface a backup off one fill-in game.**
  - **Starting QB = `currentStarterQb(team, week)` (common.js, 2026-10-05):** whoever threw the
    most in the team's most recent game, unless ruled out this week (then the starter before).
    Used for the TD summary's QB Key Player chips and to order the Player Props QB cards. Fixes
    Cooper Rush (2 fill-in starts while Penix was Out) outranking Penix on season attempts.
    Returns null when every recent starter is out (TB Week 4: Mayfield Out, backup never
    started); callers then fall back to most attempts.
- **Zone Targets** (`zoneTargets` / `renderZoneTargets` in props-summary.js): pass catchers whose targets land where the defense is soft.
  - **Downfield exception (2026-10-02, Lamb vs HOU):** a player's zone fit is a target-weighted
    blend, so a receiver split half short (where the D is tough) and half downfield (where it's
    very soft) averaged out under `ZT_MATCH_MIN` and was dropped before the deep markets ran
    (Lamb: 0.19 blended, +1.08 downfield, HOU 5th-most explosive passes). A strong downfield fit
    (>= 40% of targets intermediate/deep, those zones >= +0.8 soft, opportunity percentile >= 0.6)
    now bypasses the blended cut, adds Rec Yds, and ranks on max(blend, downfield fit). The
    blended cut still filters everything else; Week 4 changed only Lamb (28 -> 29 targets).
    Made two-way the same day after an audit: a strong SHORT fit (>= 40% short/screen, >= +0.8
    soft) also bypasses the cut (Nico Collins vs DAL: short +1.18, deep tough, blend 0.24).
- **Props Summary packages are scored per direction (audit 2026-10-02):** `propPackages` used to
  average every market in a package into one lean, then cut below 0.1, so a strong Target market
  and a strong Fade market cancelled out (MIA vs MIN: Long Rec +0.81 vs Completions −0.81 ->
  nothing). Now each direction is judged on its own markets: a package can show a Target and a
  Fade on DIFFERENT markets (card splits by `dir`). The betting-market blocks (implied total
  <= 18.5 no targets / >= 25.5 no fades; 7+ point spread for RB rushing) are unchanged and
  intentional. Exception (user 2026-10-02): **Long Comp / Long Rec targets ignore the low-total block**
  (`PROP_LONG_MARKETS`): a low total means trailing, trailing teams take more deep shots, and a
  leading defense in a soft shell gives up catch-and-run long plays. Yards/receptions targets stay
  blocked at low totals; fades at high totals unchanged. An audit of Week 4 after the fix: 0 strong clean markets cut except by those blocks.
- **Audit habit (the user asked how to be sure nothing else is gapping the algorithm):** any rule
  that blends parts into one score and then cuts on it can hide one strong part. Before shipping
  a new selection rule, list every candidate with its parts for a real week and check that no
  strong single part (zone, market, side) is dropped except by an intentional block.
  - **Zone softness** is 50% the zone's own completion % and EPA allowed (shrunk with 8 prior attempts) plus how often it's attacked, and 50% the opponent-adjusted depth band from `prop_matchup_model`.
  - **Player opportunity:** lineup-aware targets per game as a percentile at his position (70%) plus recent snap share (30%).
  - **Markets:** Receptions (volume into soft short zones), Long Rec (10+ yd share into soft zones, defense gives up 20+ plays), Rec Yds (overall match plus volume); YAC is a bonus tag.
  - **Where it shows:** a panel under each Pass D Allowed grid; on the Props Summary card, flagged players list first with a ★ in receiving packages.
- **Pick Tracker** grades each pick on the price saved at pick time, which is Novig's when
  available.
  - **Your Record week filter (2026-09-30):** checkbox chips above the record, "All weeks" plus one
    chip per week that has picks (shows whenever there are picks, even one week, so it's discoverable). Check any mix of weeks to see
    just those; none checked = all weeks. Recent Picks stays unfiltered. The selection is a
    per-device view preference in localStorage (`nfl-tool.picks.weekFilter`), not synced to the
    profile. Old picks without a `week` fall back to their game's week in the schedule.

- **Offensive line / defensive front grades (`nfl_tool/line_grades.py`, 2026-10-01):** designed
  with the user; in data.json as `line_grades[team].ol / .dl`.
  - **Where it shows (2026-10-01):** a "Trenches" row under Red Zone in Team Grades (OL overall
    vs the other team's front overall) and on the Game Previews Summary card (same row, same
    tags); and a Trenches section in each Game Previews panel between Pass Rush and Team Grades
    (Pass Protection, Run Blocking, Discipline, Overall; letter + 0-100 score, colored by score;
    the defense's Discipline cell is intentionally blank). Any Trenches grade opens the Trenches
    modal: all 32 teams, OL + defensive front, same layout as the draft the user approved, with
    hover breakdowns and the two teams highlighted. `categoryZ(cat, team, side)` in
    game-overview.js is the one switch for scheme / trenches / composite grades.
  - OL = Pass Pro 55% (pressure vs 4-man rush .30, vs blitz .15, sack rate minus FTN QB-fault
    sacks .25, pressure vs NGS time to throw .20, clean pocket .10) + Run Block 40% (NGS expected
    rush yds/carry .35, stuff rate .20, 3rd/4th & <=2 run conversion .15, yds/carry vs box count
    .15, designed-run success .15) + Discipline 5% (OL penalties/game via roster position).
  - DL = the same metrics from the defense's side (Pass Rush 55%, Run D 45%, no discipline), so OL
    grades read against the opponent's front (two-sided rule).
  - Each metric: shrunk toward league by prior k, opponent-adjusted (play-weighted), z-scored;
    groups re-standardized. Letter uses Team Grades' bands; plus a 0-100 score = league
    percentile of z (user asked for both, color-coded): A 88+, B 66-87, C 35-65, D 12-34, F <12.
  - Pressure = sack or QB hit (no public hurries). NGS comes from nflverse's combined
    `ngs_passing/ngs_rushing.csv.gz` (per-season files don't exist for 2026), weeks >= 1 only.

## The user's preferences (hard-won — follow them)

- **Summary cards:** direct attention and don't explain.
  - No wordy blurbs. Use color and shaded boxes, not plain colored text.
  - No "#5" rank badges on the card; put ranks in hovers or small tags.
  - The card must never contradict itself (e.g. an RB over under a note that the run D is strong).
  - Give the rows and boxes room: use the full card height and don't cram.
- **Props Summary is directional, not a pick sheet** (the user's call on 2026-09-28):
  - It's a Target / Fade list of *packages*: a team position group plus betting markets
    plus its players' lines (e.g. "PHI WRs · Rec Yds · Long Rec → Smith, Wicks, Lemon").
  - Only real betting markets: no YPA, INTs or sacks.
  - Each package must agree with the betting market (spread for RB rushing, implied team
    total otherwise).
  - Rank tags list offense first, shaded red → yellow → green by how good the rank is for
    that unit.
  - No projections, "model edge" numbers or model-picked players anywhere. The user
    draws the conclusions and adds players to the Prop Picks rail themselves.
  - **Clickable tags (2026-10-03):** every rank tag and garbage-time chip on a package opens a
    game-by-game popup (`openPropTagModal(team, side, metric)`): each game's number, the players
    behind it (playerClick), the opponent's usual in its OTHER games and +/- (colored from the
    tagged unit's side), flags (weather, backup QB, garbage %), and an Avg row with a one-line
    "offenses it faced got +X vs their usual" verdict. The user's ask: "did DAL just face running
    QBs, or can anyone run on them?" Rows come from `prop_matchup_model.games` (per game side:
    `v` counts, `gt` garbage part, `bq` backup QB, `wx` bad weather, `p` players with
    `pass [att,cmp,yds,td]`, `rec [tgt,rec,yds,20+,deep yds,deep tgt]`, `rush [car,yds,10+]`,
    roster position), the same counts the rank is built from. Usual = plain average, unweighted.
    Columns spell out whose numbers they are ("vs BUF D | HOU TEs | That D allows other teams")
    after the user misread an offense popup as the opponent's players.
    An **Up next** row under Avg shows the card's opponent and only its usual (other cells
    blank, per the user), so it lines up against past opponents; it's skipped once that game
    is played.
  - **Hide Prop Picks toggle (2026-10-03):** Target / Fade fill the card and zoom 1.15-1.6x.
    It's the shared picks-column toggle below (kind `props`).
  - **Garbage-time tag (2026-10-03, tag only by the user's choice):** a Target's reason stat
    gets a neutral gray dashed chip ("JAX D 44% garbage time") when 30%+ of it came with the
    offense under 10% to win (`PROP_GARBAGE_TAG`; league average ~12%). Hover explains it.
    The numbers themselves are NOT discounted: the user pointed out a team that keeps building
    leads keeps facing comeback throwing, so the spread decides how much it matters. Data:
    `prop_matchup_model.teams[t][side][metric].gt` (passing counts only) and `.gt_median`
    (the league mean, despite the name). Found when JAX D read "2nd-most WR yds" while every
    other page showed an elite pass D (44% of those yards came in blowouts).
- **Every matchup call reads BOTH sides (the user's rule, 2026-09-28).** Any Tough / Mismatch /
  Target / Fade / ADV logo / tag must use the offense's number AND the defense's ALLOWED number for
  the same thing. How often a defense shows a look (blitz %, box %) only decides whether the look
  matters, never which way it points. Use `matchupCall` / `matchupKind` in common.js:
  - A call needs one side clearly pointing one way and the other side not pointing the other way
    (`MATCHUP_CONTRA`).
  - An average alone is not enough, because it lets a strong side hide a contradicting one. That
    bug had "PHI 3.0 Y/C vs heavy box" read as Tough while CHI allowed 4.9 Y/C in that box.
  - Applied to: Game Summary Key stat edges (Blitz/Box rows show offense vs defense-allowed, with
    the look % in the label), the Scheme ADV column, the TD Data tags (Beats the blitz, Pressure
    trouble, Clean pocket, Light-box runs, Beats stacked box, RZ wall), and Props Summary packages
    (a market is dropped if either side contradicts it).
  - Rows where the sides don't act on each other (penalty yards) aren't matchups; keep them out of
    edges.
- **Distrust small samples.** 2–3 games can be one weird matchup (a backup QB, bad
  weather). Prefer approaches that discount flukes and lean on the market.
- The TD Data page is considered solid; change it only when asked.
  - **TD Summary targets (app.js `modelEntry`), changed 2026-10-02 at the user's request:** a
    target still needs offense >= −0.3 and defense >= −0.5, plus a combined score >= 0.6, OR one
    clearly extreme side (`MODEL_TARGET_SOLO_Z` = 1.0) carrying it on its own. Trigger: IND
    allowing 70% of its TDs (2.3/g) from <=10 yds averaged out vs a near-average WAS offense
    and never showed. This added ~7 targets across 32 team-sides in Week 4 (2.3 -> 2.5 per side).
    Distance target rows show per game plus share of all TDs ("2.33 · 70%", unit "TDs/g · % of TDs").
  - **Distance concentration (2026-10-02, TEN @ BAL):** BAL allows 75% of its TDs from <=10 yds
    and TEN scores 75% of its own there, but per-game volume was ordinary on both sides, so the
    volume model missed it. `shareTargetEntry` (app.js): if a bucket fails on volume, it can still
    qualify on share-of-TDs z (one side >= 0.75, the other >= 0, each with 4+ TDs). It added 8
    targets across 32 sides in Week 4.
  - **First TD target must agree with the First TD section:** it only shows for an offense whose
    `firstTdChanceFor` (same model as the First TD bar) is >= 50%. TEN was a "First TD" target
    while the bar said BAL 60%; the user called that confusing. 0 conflicts across Week 4 after.
  - **First TD player picks (`firstTdPlayerTargets`, reworked 2026-10-02):** the user wants the
    whole offense's usage, not "who has scored before". Share of the team's first-TD chance =
    `FIRST_TD_W`: 30% full-field touches (targets + carries), 25% red zone opportunities
    (RZ targets + carries), 25% expected TDs, 20% early-game xTD. TDs scored carry 0 weight
    (was 15%). RZ and xTD shares are pulled toward the player's touch share until the team piles
    up `FIRST_TD_RZ_PRIOR` RZ looks / `FIRST_TD_XTD_PRIOR` xTD, so 3-5 end-zone looks or one
    goal-line game can't top a team. TEN went from Ayomanor 9.4% (9 targets), Ward 7.7% to
    Pollard 9.0% (45 touches, 8 RZ), Ayomanor 6.6%, Ward 5.1%.
    - **Recalibrated the same day (user: "Stafford 6.7% to score first? insane"):** weights now
      15% touches / 30% RZ opps / 40% xTD / 15% early (xTD and RZ price WHERE a touch happens);
      `FIRST_TD_SHARE_FLATTEN` 0.65 -> 0.9 (the strong flatten inflated fringe players and squeezed
      RB1s); opponent position factor capped at z ±1 and only with `FIRST_TD_DEF_MIN_TDS` = 3+ TDs
      allowed to that position (PHI's QB-allowed z +2.8 on 1-2 plays was a x1.77 boost); QBs
      x mobility^1.5, mobility = min(1, max(carries/g ÷ 6, rush yds/g ÷ 30)) (`FIRST_TD_QB_RUNNER`, `FIRST_TD_QB_RUN_YDS`; yards added at the user's request so Purdy, 3.3 car/g but 31 yds/g, counts as mobile: 1.1% -> 2.6%). Result: Stafford 6.6% -> 1.4%, pocket QBs
      0.3-1.4%, Allen 12.3%; model position totals RB 43 / WR 36 / TE 16 / QB 4.5 vs actual 39 / 37 /
      17 / 6.5. Calibration check: sum the model's first-TD % by position across a full slate and
      compare with the season's actual first-TD scorers by position.
    - **QB change + market prior (2026-10-05, user: "Drake London has higher than a 3% chance"):**
      London had 19 targets but 0 RZ looks, so Hooper's single end-zone target outranked him, and
      his 4-5 target games came with Rush/Strand before Penix returned (10 of Penix's 25 throws).
      (1) `lineupAdjustedXtd(team, week, { qbStarter })`: a WR/TE game thrown by someone other
      than `currentStarterQb` counts `LINEUP_QB_CHANGE_WEIGHT` 0.5 (First TD model only). (2) Each
      player's share blends in his share of the team's ANYTIME TD odds with weight
      `FIRST_TD_MARKET_PRIOR_GAMES` 2 / (2 + games): ~40% after 3 games, the user's pick over 50%
      ("keep 40 for now"). Anytime is a different market from the First TD odds the model is
      compared to. ATL: London 3.4% -> 5.5% (odds 10%), Hooper 4.1 -> 4.3, Bijan 24.5 -> 19.6.
  - **"Soft D" targets (2026-10-02, NE @ BUF):** a clearly soft defense (model z >= 1.0) flags even
    when the offense hasn't produced there (offense floor relaxed to −1.5 instead of −0.3). BUF had
    allowed 5 RB TDs (3rd most) while NE's backs had 1 against SEA/PIT/JAX. These are marked
    `defLed`: dashed chip + red "SOFT D" tag + tooltip, never shown as "strong", and both numbers
    stay in the row. Only for `MODEL_SOFT_METRICS` (QB/RB/WR/TE, rush/pass, <=10 yds; the longer
    buckets and First TD swing on 2-3 plays) and at most `MODEL_SOFT_MAX` = 2 per team side,
    softest first. Week 4: 12 across 32 sides.
  - **"Weak spot" matchup tag (2026-10-02, NE D):** `defenseWeakSpot` (app.js): for a defense that's
    good at stopping TDs overall (TD/g allowed z >= 0.4, 4+ TDs allowed), the skill position whose
    share of TDs allowed is clearly above that position's league share (z >= 0.75, 2+ TDs). It
    reads like "while NE is solid overall, if it has a weakness it's WRs". Shown regardless of
    the offense's usage (the user wants the tendency visible), but the line prints the offense's
    own share of TDs at that position, so both sides are on the card. Key players: that
    position's top usage players. Week 4: 9 tags across 32 sides.
  - **TD Summary layout (facelift 2026-10-09, built from the user's notes over 6 mockups):** like the
    Props card, one full-height column per team (`.td-team`, rows aligned across the two columns
    with subgrid -- the user likes them lined up) plus the TD Odds picks as a 250px right rail.
    Each column, top to bottom:
    - **Header** (`summaryTdTeamBanner`): team color block with name/logo and a one-line fact strip:
      Implied TDs (implied points from Novig spread + total, / 7), Top TD position (biggest share of
      the team's TDs), photos of the top 2 key players.
    - **TD Targets** as tiles: chip label centered on top, two big shaded boxes (team | opp allows),
      share % small under distance values. No units, no numbered bubbles; the First TD target is
      left out (it's the First TD section's Scored 1st tile).
    - **Matchup Tags** as tiles in the same style (`summaryTagTile`): each " · " part of the tag's
      line becomes a box, the first number pulled out big ("TB 3.4 RZ trips/g"); a number followed
      by "+" stays in the label ("7+ box"); boxes tinted green (tag helps the offense) / yellow
      (works against it). "(lg x)" league notes are dropped on the card (user: no small gray text).
    - **First TD** (`summaryFirstTdBlock`): the big 1st TD chance box (this game), then First TD tab
      stats as tiles: Scored 1st (season rate vs allowed), the First TD tab's flagged position
      shares, RZ finish before the first TD. **No model player list** (user: "stop with the first td
      model player crap").
    - **Key Players** at the bottom, centered, with ★ = how many of the team's targets/tags the
      player fits (replaced the numbered badges).
    Leftover tiles in a row are centered under the row above (flex, not grid). Only `.sc-main`
    grows (`.sc-zoom-target`); the fit check also watches tiles and boxes for overflow. Week 5: 8 of
    15 games grow 1.0-1.25x, 7 dense ones shrink to 0.86-0.96 (still bigger type than the old card),
    0 overflow. Colliding short names (Bijan / Brian Robinson) show in full (`uniqueShortNames`).
  - **No DST targets anywhere (user 2026-10-02; TD Targets panel too since 2026-10-05):**
    defensive/return TDs are random and not bet, so `targetGroups` (app.js) drops DST items for
    both the TD Targets panel and the Summary card (First TD position targets already skipped
    DST). The DST stat rows in the TD Data tables stay; they're data, not a target.
- The Game Previews Summary card:
  - **Layout (2026-10-05, from the user's marked-up screenshot; approved from a mockup):**
    main column = injuries strip; W&L vs the spread; Matchups with A–F grades and
    Mismatch/Tough/Good vs Good/Bad vs Bad tags. Right rail = Lines, compact Ratings
    (Off/Def/FPI/SOS tiles, number over change, with the "1-100 vs the league" note under them),
    My Picks (slimmer buttons), Novig ad. Rail is 256px. The card is `.sc-grow`, so
    `fitWideSummaryCard` zooms the main column up when there's room (it also backs off if a
    row label would get cut off). Week 4: every game fit at 100% (ATL @ NO was shrunk to 86%
    before). Hiding My Picks puts Lines and Ratings back in the main column's top row.
    The user's rule: never drop data to make it bigger; rearrange into dead space instead.
  - The A–F grade boxes (`.gs-grade.tier-*`) use the same tinted fill + edge as the full
    preview's Team Grades cells (A/B green, C yellow, D/F red, A and F strongest), per the user
    2026-09-30. Keep the two in sync if either changes.
  - **Tags + Key Stat Edges (reworked 2026-10-01 after the user found real edges missing on
    PIT/CLE):** `gsMatchupTag(offZ, defZ)` in game-summary.js, both z's "good for its own side".
    Gap (off − def) >= 1.0 = Mismatch, <= −1.0 = Tough, so a bad offense vs an AVERAGE defense
    still flags (the old rule needed both sides past ±0.6 and hid PIT bad vs blitz, CLE sacks
    allowed, PIT's red zone). Both past ±0.4 the same way = Good vs Good / Bad vs Bad. Grade rows
    use the same tagger on their composite z.
    - Edges ranked by gap (or how far both lean for same-direction tags); top 8 shown.
    - Scheme looks count once the defense shows them >= 12% of the time; frequency only scales
      rank (0.7x-1.25x), never gates (the old "above-average frequency" gate dropped PIT vs a
      34% heavy box, the biggest edge in the game).
    - Candidates: General Stats rows (Production rows ranked 0.75x, since the Passing/Rushing
      grades already sum them), Penalty Yards (now included), scheme looks, and the Trenches
      parts (Pass pro vs rush, Run block vs run D). Turnovers show only as good vs bad (mostly
      random; never Bad vs Bad filler). Skipped: Plays/Game, quarter splits, the Red Zone
      composite (it has its own grade row).
  - Right side: Lines, Ratings, My Picks and the Novig ad (see Layout above).
  - "Scheme" is labeled "Blitz & Box" on the card.
- **Hide the picks column on any Summary card (2026-10-05):** a toolbar button `#summary-rail-btn`
  ("Hide Prop Picks" / "Hide My Picks" / "Hide TD Odds") drops the right rail; the card gets
  `.sc-no-rail`, and `fitWideSummaryCard` (common.js) zooms `.sc-main` to the biggest size that
  still fits (max `SUMMARY_WIDE_ZOOM_MAX` 1.6), then the usual shrink-only fit. html-to-image
  keeps the zoom, so saved images come out big too. Per-device view pref per card
  (`SUMMARY_RAIL_KEYS`), not synced. On Game Previews this also hides the Novig ad (it lives in
  that rail). The Props card has spare height so it grows a lot; the Game and TD cards are
  already height-bound (Game ~1030px of content for 980, TD 1.0-1.15x), so hiding the rail
  mostly widens them -- making them bigger needs less content or a different layout.
- **One look across the whole site (the summary-card look), set 2026-09-28.** It lives in the
  "Facelift v2" block at the end of `style.css`:
  - Every `.data-table` is rounded tiles with 3px gaps, not hairline grid lines.
  - Colored values are shaded boxes (tint plus a matching 1px edge) in the bold display font.
  - Headers are small uppercase muted labels.
  - Team banners are team-color tints with a 4px team-color left edge (`teamBannerHeader`).
  - Rush lanes are big tiles like the pass zones.
  - **Passing tab = one QB card per team** (`renderQbCards`), in this order:
    1. Header: photo, name, games and attempts.
    2. Eight equal season tiles (Att/G, Cmp%, Yds/G, Y/A, TD/G, INT/G, EPA/Att, ADOT), colored vs
       every QB and clickable for the QB list. Y/A and TD/G are derived from game logs by `enrichQbRows`.
    3. His posted lines.
    4. A 2×2 of equal boxes: vs OPP pass D (QB vs defense-allowed, with a two-sided Edge),
       Pressure, QB rushing, Red zone.
    5. Recent weeks, shaded against his own games.
    The Show backup QBs toggle stacks a second card.
  - Pick Tracker buttons match the summary's My Picks rail.
  - Tier cells are **filled** (tint plus a soft edge), never outline-only, in both themes.
  - Group headers inside tables (Production, Turnovers & Pressure, Run Defense, Team Grades...)
    are solid bars with an accent left edge and a small gap above (`group-gap` spacer rows).
  - Game Previews General Stats & Scheme is two boxed matchups ("ATL Offense vs GB Defense"),
    each holding its stat table plus scheme and Team Grades. Grade letters are the same size as
    the numbers, and Heavy/Light Box values stay on one line.
  - Game Previews order: Injuries, Odds, **Recent Games**, General Stats & Scheme, Pick Tracker.
  - Box score popup (click a Recent Games row): `.box-score-grid` lays the tables out two-up,
    Passing | Rushing then Receiving | Defense, each filling its half (820px modal); one column
    on phones. The old single column of content-width tables left the right half empty.
  - Injuries come from nflverse's injuries file, keyed by week. Teams file their first practice
    report Wednesday afternoon (Thursday-game teams earlier), so Mon-Wed the current week is
    empty; the panel then shows the team's most recent earlier report, labeled "No Week N report
    yet ... Showing the Week N-1 final report" (2026-09-30), instead of a blank.
  - **Roster status (2026-10-02):** players on reserve/IR never appear on weekly injury reports
    (teams only report active players), so an IR'd starter kept showing (Achane, Week 4; also
    Etienne, A.J. Brown, Pierce, Reed, Dart: 21 skill players with usage). `compute_roster_out`
    (build_stats.py) reads each team's latest weekly roster `status` (RES = IR/reserve, RET, CUT,
    EXE) into data.json `roster_out`. `rosterOut()` (common.js) feeds `lineupOutOn`, `propInjuries`
    and `firstTdInjuryStatus`, so these players count as Out everywhere and their backups get
    full lineup weight. DEV (practice squad) is NOT treated as out.
  - **Live source for the upcoming week (2026-09-30):** nflverse republishes the official report
    hours late, and the user needs Wednesday info for preview videos. `fetch_nflcom_injuries`
    (build_stats.py) reads the league's own page, `nfl.com/injuries/league/{season}/reg{week}`,
    and `merge_live_injuries` swaps in NFL.com's rows for every team that has filed for the
    current week. Past weeks stay on nflverse. If the fetch or parse fails, the build keeps
    nflverse and logs why. Verified: Week 3 on NFL.com matched nflverse 301/301 players, 100% on
    game and practice status. NFL.com codes AZ/LAR are mapped to ARI/LA. A rebuild (6-hour cron,
    or the Update Odds button) is still what pulls a newly filed report onto the site.
    The Raw Stats / vs Opponents toggle sits in the General Stats header, with a copy on the
    Summary toolbar because the card's matchups use it too.
  - Recent Games runs Week 1 first, with opponent logos, the closing spread and total from the
    schedule, and ATS (Covered/Missed/Push) and O/U results. Clicking a row opens the box score.
  - **League-rank popups are paired** (`openPairedRankModal` / `pairedRankPartner` in common.js):
    - Clicking any number in an OFF/DEF matchup row shows TEAM | offense value | defense value |
      TEAM. Each column is sorted on its own, with equal-width halves.
    - This matchup's offense is highlighted on the left and its defense on the right.
    - The partner is the opposite side's cell in the matching column, learned from a complete row
      of the same table, so a blank "--" never mis-pairs.
    - Cells with `noPair` (e.g. scheme Tendency %) or no real counterpart open the single list.
    - Team Grades use `openPairedGradeModal`; Red Zone's Trips/TDs/FGs/Avg columns appear on both halves.
  - New UI should reuse these patterns rather than add a new look.
- Player Props pass-zone grids (Pass D Allowed / Passing Offense) use the summary-card look: rounded zone tiles, big share numbers, header/row shares as big red→green numbers with fill bars (no small % tags), stat tiles underneath. The offense per-player mini grids sit 3 cards per row with uniform row heights.
- **Receiving table:**
  - The 7 core columns get a very light green/red wash ranked against the player's own teammates
    in that table.
  - The 4 depth columns sit under a boxed "Target depth" group label. Their colors compare each
    player to every pass-catcher in the league, so leave them as-is.
- Schedule strip (top of every page): finished games show each team's score under its logo (winner bold), not the date.
- **Zone popup** (`renderPassZoneModalContent`):
  - Opened by clicking a cell in any team grid, the QB grid, or a receiver grid. A receiver grid
    opens the popup filtered to that player (`receiver` in the payload).
  - It shows:
    - summary tiles: throws, catches/%, yards per catch, YAC share, EPA per throw, 20+ plays;
    - league rank by volume;
    - who got targeted, most first, with catch %, YAC/rec and longest;
    - on offense, **"OPP Defense Here"**:
      - Throws faced/game, Comp %, Yards/throw, YAC/catch and EPA/throw allowed, each next to the
        league average.
      - Colored from the defense's side vs the league, using values shrunk by 8 prior throws (4 for YAC).
      - A one-line **Top X% / Bottom X% / Neutral matchup** blurb and a Soft spot / Average / Holds up
        pill. Both come from the league ranking of `ztDefenseSoftness` (thirds, or the same 0.5 line
        Zone Targets uses), so they always agree with each other and with the Zone Targets chips;
    - every throw grouped by player, newest first, with opponent, air yards, YAC and EPA.
  - QB grid cells show comp/att plus yards · YAC.
- **Zone matchup panel** (`renderZoneMatchupPanel`, beside the QB grid; wraps below it on narrow screens):
  - One row per depth (20+ / 10-19 / 0-9 / SCR, its 3 zones combined) and per side (L / M / R, its
    4 depths combined).
  - Each row shows share of the offense's throws, then Catch%, Yds/throw, YAC/catch and EPA/throw as
    offense-vs-defense-allowed pairs, colored vs the league from each unit's side, plus a
    Top X% / Bottom X% / Neutral / Mixed chip.
  - Grades weight EPA 0.35, Y/T 0.25, success 0.2, catch 0.1, YAC 0.1, shrunk by 10 prior throws.
    The % is this pairing's rank among every offense × defense pairing for that group.
  - **"Mixed"** means one side is clearly good and the other clearly bad (the two-sided rule).
- **Overall read** (`renderZoneMatchupRead`) under the lead-zone tiles: an overall passing matchup
  (depth grades weighted by the offense's throw share), plus the Best spot and Toughest spot among
  groups with at least 10% of throws.
- **Game script:** build_stats flags each throw `gt` when win probability is under 10% or over 90%
  (`GARBAGE_WP`), and records `s` for play success. Garbage-time throws count **half** in these
  grades, and the grades use only per-throw efficiency, never volume, which game script inflates.
- The page max width is 1840px (was 1600), so wide monitors fit the panel beside the grid.
- Player Props page extras:
  - The **Pick props** list is grouped Passing / Rushing / Receiving / Other, then by player.
  - Each player has an **Out?** switch for late news the injury report misses.
