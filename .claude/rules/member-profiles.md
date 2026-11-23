---
paths:
  - "nfl_tool/site/sync.js"
  - "nfl_tool/functions/**"
---
# Member Profiles and Saved-Data Endpoints (`/api/state`, Payouts, Price Logs)

Split from the old `members-and-hosting.md` (2026-11-23); `members.md`, `hosting.md`, `deploy.md` and `member-profiles.md` together hold all of it. Stories: `docs/history.md`, "Members and hosting".

## Member profiles (`sync.js` + `/api/state`)

- `/api/state` in the middleware (GET all, PUT one key; newest `updated` wins) is backed by the D1
  database `gmg-nfl-users` (table `user_state(uid,k,v,updated)`), bound as `DB`.
- deploy.yml creates the database and table, so the token needs **D1 Edit** as well as Pages Edit.
- `site/sync.js` keeps localStorage as the working copy. It pulls on load and on tab focus, pushes
  each save debounced, and on first contact merges pre-profile local data (lists by id, objects by
  key) instead of overwriting it. It mirrors saved plays, picks, notes, summary rails, manual Outs
  and model presets.
- **A stale device merges, never overwrites (2026-11-19).** Each device remembers the profile's
  `updated` its copy was built on (`nfl-tool.sync-base.v1`). A save goes out through a pull
  (`syncNow`, one at a time); if the profile moved on since, the two are merged (lists by id, this
  device wins a tie), else the save is sent as is (so a delete sticks). Why: My Plays grades and
  saves on load before the profile answers, and that stale list wiped a member's morning NBA plays.
  Test: `tests/test_sync_merge_site.py`.
- Synced keys are listed in both `SYNC_KEYS` (middleware) and `KEYS` (sync.js). **Add new per-user
  data to both**, and call `window.NFLSync?.push(key, value)` in its save function.
- Display prefs (theme, views, selected game) stay per-device.
- **Owner-only controls:** `OWNER_IDS` (the user's Discord ID `613105360286253076`) makes
  `/api/state` return `user.owner`. sync.js then adds `html.is-owner` (owner-only boxes: payouts, SGP
  price log). The Update Odds button that used to hang on it is gone.
- **Member Activity** (`activity.html/.js`, 2026-11-18; the owner's DAU / MAU, a link in the owner's account
  menu): a member's `GET /api/state` (every page load, sync.js) writes one row per Eastern day to the D1 table
  `member_activity(day, uid)` (created by deploy.yml), after the reply, a failure ignored; the owner isn't
  counted. Owner-only `/api/activity` sends counts, never who: last 30 days, MAU = different members in the 30
  days ending that day. No history before launch. Today is never colored or averaged in (the day isn't over).
  Tests: `test_ci_member_activity.py`, `test_activity_site.py`.
- **Request a feature:** an item in the account menu (logged-in members only; the 2026-10-17 header
  moved it there from its own yellow button). It opens a box titled "Have an idea
  for a tool, data point, or feature? I will do my best to get it added!". The idea is POSTed to
  `/api/requests` and saved in the D1 table `feature_requests` (created by deploy.yml). Limits:
  1000 characters per idea and 10 ideas per member per day. The owner's item reads "Feature
  requests": it lists every idea newest first (name, date), with Mark added / Undo / Delete (a
  PATCH; delete is soft, status `deleted`) and "+ Add my own idea". Members can never read others'
  ideas.
- **Refund?** (2026-10-30, the owner's words): a pill right after the theme button on every page
  (sync.js `addRefund`). Popup: the owner's note, Email, Additional Comments; POSTs `/api/requests`
  `{kind: "refund", email, text}`; the middleware stores it in `feature_requests` with the
  `REFUND_MARK` prefix (no schema change), and the owner's list shows a red "Refund Request" tag.
  Test: `tests/test_refund_site.py`.
- **What's new popup** (2026-10-15): `GMG_UPDATES` at the top of sync.js. Each member sees it
  once, on the first page they open after a new update is posted: unseen updates on top
  ("New" tag), older ones folded under "Earlier updates", then "Feel free to click 💡 Request a
  feature..." (opens the idea box) and "Got it". What they've seen is `nfl-tool.updates-seen.v1`
  (synced, so once per member, not per device or sport address); it is marked seen as soon as it
  shows. "What's new" in the account menu opens it again (with a dot while there is something unseen). It never opens on its own in a browser
  driven by a script (`navigator.webdriver`: the gate, the tests). **To post an update:** add one
  entry at the TOP (`id` = the date, `"2026-10-15b"` for a second that day; `items` =
  `[emoji, "<b>Feature</b> rest of the line"]`), in the owner's wording. An optional `after: {title, text}` is a
  note from the owner shown once, right after that update's popup is closed (2026-10-20b: "Before you go…"). An optional `sport` ("nfl" / "nba" / "nhl") shows an update only on that sport's pages (never marked seen elsewhere), and `until` (an Eastern date) is the last day it opens on its own or shows as new; then it folds under Earlier updates (2026-11-11: the NHL Model Check-In, "only when people click into nhl today"). An optional `slides: [[image, caption], ...]` (images in `site/brand/updates/`, public on every sport's address) shows a photo carousel above that update's list in a wider popup (2026-11-04c: a walk-through of the day's features, real-page screenshots). Test:
  `tests/test_updates_site.py`.
- **Promo payouts** (`PROMO_PAYOUTS`, 2026-10-14): `/api/crease-payouts` (NHL King of the
  Crease, keyed by `date`) and `/api/koe-payouts` (NFL King of the Endzone, keyed by nflverse
  `game` id). GET for any signed-in member, PUT owner-only (`{date|game, pool, payouts: [{id,
  name, paid}]}`; replaces that contest, an empty list removes it). D1 tables `crease_payouts` /
  `koe_payouts` (`<key>, pool, payouts JSON, updated`), each created by the endpoint on first use,
  so no deploy step. Used by the Promo Tools Winners lists (nhl-promos.md, promos.md). Test:
  `tests/test_ci_crease_payouts.py` (a D1 stand-in).
- **SGP price log** (`/api/sgp-prices`, 2026-10-16, NHL Line Stacks; the page was retired 2026-10-21, the endpoint and its D1 rows are kept, nothing calls it now): what each book charged for a
  stack. GET for any signed-in member (`{stacks: {"<game>:<sorted leg ids>": entry}, books}`), PUT
  owner-only (`{game, date, legs, names, kind, chance, indep, fair, books: [{book, price, legs:
  [price|null]}]}`: the model's numbers when logged, then one line per book, `SGP_BOOKS` only, once
  each; the same legs in any order replace the row; no books removes it). D1 table `sgp_prices`
  (`k, entry JSON, updated`), made on first use. Test: `tests/test_ci_sgp_prices.py`.
- **Suite switcher** (`addSuiteSwitcher`, `SUITE_SWITCH_PUBLIC`): see nba.md. It lists NFL, NBA
  and NHL (`SUITES`).
