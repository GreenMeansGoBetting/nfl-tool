# GMG Sports Data Suite: project guide for Claude

This file holds only what every session needs. Rules for one part of the site live in
`.claude/rules/` and load when you open matching files; the stories behind them are in
`docs/history.md`.

**Keeping it current:** when a rule or preference changes, update the CLAUDE.md line or
`.claude/rules/` file that holds it. Put the story of WHY in the commit message, and in
`docs/history.md` if it's worth keeping. Keep CLAUDE.md under 150 lines; if it grows past
that, move detail into a rules file.

## Who this is for

- Owner: a sports-betting content creator ("GMG" = Green Means Go) with no coding background.
  Explain in plain language and do the technical work yourself.
- Live at **https://nfl.gmgsports.org**. Repo: `GreenMeansGoBetting/nfl-tool`. The brand is
  "GMG Sports Data Suite"; NFL is live, the NBA and NHL suites are being built (owner-only until
  launch).
  A separate CFB tool is paused.
- The user screenshots sections and the **Summary cards** (fixed 1160×980, sized to their video
  template's left area) and drops them into betting videos. Favor dense, screenshot-ready,
  visually clean layouts.
- For layout changes the user likes before/after mockup images and approves before a push.

## Workflow the user expects

1. Make the change and verify it locally (below).
2. `git pull --rebase` (a bot commits `model_history/gmg_model.json` to main), then **commit and
   push to `main`**. GitHub Actions rebuilds and deploys automatically. No branches or pull requests.
3. Confirm it's live: `https://nfl.gmgsports.org/version.json` (public) shows the pushed commit's
   `sha`, usually about 3 minutes after the push. The deploy runs the tests first, then opens every
   page and Summary card in a browser (`check_site.py --gate`), and publishes nothing if a test
   fails or a page is broken, so if the sha never changes, the run failed: say so and look at why.
4. Tell the user to hard refresh (Ctrl+Shift+R).

- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys.** `SGO_API_KEY`, `SGO_API_KEY_BACKUP`,
  `STRIPE_SECRET_KEY`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `CLOUDFLARE_API_TOKEN` and any
  future key are GitHub Actions secrets, added by the user in GitHub Settings → Secrets.
- Git safety: never force-push, never `git reset --hard`, never rewrite history. If a pull or push
  conflicts or is rejected, stop and explain it in plain words. Undo a bad push with `git revert`.

### Local verification

- **One sport at a time** (the user's rule): add `--only nfl|nba|nhl` to both checks below; the deploy does the same for a one-sport push.
- **Tests:** `python tools/run_tests.py` before any push that touches the build
  code or the site's JavaScript. `tests/` pins the math and every past bug on saved samples
  (`tests/fixtures/`), so the answers never depend on this week's data. When a rule they pin
  changes on purpose, change its test in the same commit; a bug fix gets a test that fails without it.
- On this PC call Python as `C:\Users\Carter\AppData\Local\Python\bin\python.exe`: in Claude's
  shell plain `python` is the Store stub, and `py` can't see Playwright's browser.
- To verify a change, run `python tools/check_site.py` once before a push. While iterating on a
  design, screenshot ONE game's card, never the full all-games screenshot set (the user: it
  "takes way too long"). Use the browser only to look at something specific. It needs Playwright
  (`pip install -r tools/requirements-dev.txt`, then `python -m playwright install chromium`).
- Build: `SKIP_SGO_FETCH=1 python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  A 404 is a transient nflverse error; re-run. The build only downloads a file that's missing
  (`download_if_missing`), so delete `data/*_2026*` and `data/games.csv` first when the latest
  games matter. CI always starts fresh.
- Serve `nfl_tool/site` with `python -m http.server <fresh port>`; use a fresh port each time
  (the preview caches aggressively). No Node.js or `gh` on the user's PC.

## Project map

- `nfl_tool/build_stats.py`: the NFL data pipeline -> `nfl_tool/site/data.json` (untracked, built in CI).
- `nfl_tool/gmg_model.py`: GMG score model, its picks and the locked record.
- `nfl_tool/line_grades.py`: offensive line / defensive front grades.
- `nfl_tool/novig_event_markets.graphql`: Novig's query text, sent verbatim.
- `nfl_tool/nba/build_nba.py`: NBA data build -> `nfl_tool/site/nba/data.json`.
- `nfl_tool/nhl/build_nhl.py`: NHL data build -> `nfl_tool/site/nhl/data.json`, `nhl/shots.json` + `nhl/players/<TEAM>.json` (games kept in `data/nhl`).
- `nfl_tool/nhl/shots_model.py`: the NHL shots-on-goal model; `saves_model.py`: goalie saves (behind King of the Crease).
- `nfl_tool/functions/_middleware.js`: member login gate (Discord + email/Stripe), profiles, admin.
- `.github/workflows/deploy.yml`: builds and deploys on a 6-hour cron, "Update Odds", and pushes touching `nfl_tool/**`
  (a push rebuilds, tests and browser-checks only the sport it changed: `tools/ci_steps.py` `plan` / `work_scope`; shared files such as style.css check all). `nhl-refresh.yml`: hourly hockey-only refresh. `cloudflare-domain.yml`: one-off domain attach.
- `model_history/`, committed by the deploy bot: `gmg_model.json` (locked projections), `nhl_shots/<month>.json` (graded Shots plays), `nhl_crease/` (King of the Crease's days).
- `tools/check_site.py`: one-command local check (pages, every Summary card's fit, phone width,
  optional screenshots and before/after compare). Outside `nfl_tool/`, so it never redeploys.
  `.github/workflows/site-check.yml` runs it against the live data once a day.
- `tools/run_tests.py` + `tests/`: the permanent tests. Plain Python for the build code; the site's
  JavaScript runs in a real browser on the saved data (`tests/site_browser.py`), like the site check.
- `tools/backtest/`: week-by-week replay of the GMG model on past seasons (`features.py`, then `analyze.py`);
  `nhl_shots.py` replays the NHL shots model the same way and fits its weights; `nhl_saves.py` the saves model.
- `nfl_tool/site/`: static pages.
  - `game-overview.html/.js` + `game-summary.js`: **Game Previews** (Full Preview, Build Your Model, Summary card).
  - `index.html` + `app.js`: **TD Data** (Season TDs, First TD, Summary card). `first-td.html` is an old redirect.
  - `player-props.html/.js` + `props-summary.js`: **Player Props** (Receiving / Rushing / Passing + Summary card).
  - `player-card.js`: the player card popup, plus rush-lane and pass-zone drawing.
  - `possible-plays.html/.js`: Possible Plays (View Results, Photo Export, Parlay Wheel). `picks.js`: Pick Tracker.
  - `promo-tools.html/.js`: Promo Tools (King of the Endzone). `support.html`: Support tab.
  - `common.js`: shared helpers (tiers, matchup calls, saved plays, lineup weights, modals, summary-card fit / Save image).
  - `sync.js`: member profiles, account chip, feature requests, suite switcher. `teams.js`: names, colors, logos.
  - `style.css`: dark/light tokens and every page's styles.
  - `nba/index.html` + `nba/nba.js`: NBA Game Previews. `nhl/index.html` + `nhl/nhl.js`: NHL Game Previews.
  - `nhl/shots.html` + `nhl/shots.js`: NHL Shots (every skater ranked by shots-on-goal value).
  - `nhl/promo-tools.html` + `nhl/promo-tools.js`: NHL Promo Tools (King of the Crease: most saves of the day).
  - `nhl/nhl-common.js`: shared by every NHL page (data, rink drawing, the NHL player card).

## Rules that apply everywhere

- **Every matchup call reads BOTH sides.** Any Tough / Mismatch / Target / Fade / ADV logo / tag
  must use the offense's number AND the defense's ALLOWED number for the same thing. Use
  `matchupCall` / `matchupKind` in common.js: a call needs one side clearly pointing one way and
  the other side not pointing the other way (`MATCHUP_CONTRA`). An average alone is not enough.
  How often a defense shows a look (blitz %, box %) only decides whether the look matters, never
  which way it points. Rows where the sides don't act on each other (penalty yards) aren't matchups.
- **Distrust small samples.** 2–3 games can be one weird matchup (a backup QB, bad weather).
  Prefer approaches that discount flukes and lean on the market.
- **Audit habit:** any rule that blends parts into one score and then cuts on it can hide one
  strong part. Before shipping a new selection rule, list every candidate with its parts for a
  real week and check that no strong single part is dropped except by an intentional block.
- **Summary cards direct attention and don't explain.** No wordy blurbs; use color and shaded
  boxes, not plain colored text. No "#5" rank badges on the card (ranks go in hovers or small
  tags); the exceptions are the Game Summary's Matchups and the TD Summary's targets, which show league ranks. The card must never contradict itself. Give rows and boxes room: use the full card
  height and don't cram. **Never drop data to make a card bigger; rearrange into dead space.**
- **Props Summary is directional, never a pick sheet:** no projections, "model edge" numbers or
  model-picked players. The user draws the conclusions.
- **The GMG model is a talking point, never "beats the line".** A 2024-25 replay had it at 50% against the spread.
- **Any new place that shows a player must use `playerClick`** (the one player card; NHL pages
  have their own in `nhl/nhl-common.js`).
- **Reuse the existing look** (the summary-card look: rounded tiles, shaded boxes, team-color
  banners, filled tier cells) rather than adding a new one.
- **Odds lock at kickoff.** Books keep quoting in-game lines; the site must never show them as
  the line. A saved pick always shows the line it was made at.
- **Lineup-aware usage:** never surface a backup off one fill-in game.
- **No DST targets anywhere** (defensive / return TDs are random and not bet).
- **Per-member data** goes in BOTH `SYNC_KEYS` (middleware) and `KEYS` (sync.js), and its save
  function calls `window.NFLSync?.push(key, value)`. Display prefs (theme, views, selected game) stay per-device.
- **Phone layout:** phone-only rules go in the last `@media (max-width: 760px)` block of
  style.css so desktop stays pixel-identical; new wide tables must scroll inside their own box.
- The TD Data page is considered solid; change it only when asked.
- **NHL prop tools (shots, goals, points, saves) use this season's games only**: no last-season data in the model, not even fading out (nhl.md).

## Where the detail lives

Area rules in `.claude/rules/` (each loads when you open a file it lists):

- `game-previews.md`: Summary card layout, GMG score model and weights, grades / tags, trenches, pick labels.
- `td-data.md`: TD targets, First TD model, Soft D, Weak spot, TD Summary layout.
- `player-props.md`: Props Summary packages, Zone Targets, zone popup and panel, QB cards, player card.
- `plays-and-promos.md`: Possible Plays, Photo Export, View Results, Pick Tracker, King of the Endzone.
- `members-and-hosting.md`: Discord gate, email / Stripe members, profiles, feature requests, Cloudflare, deploy.
- `data-pipeline.md`: sources, Novig / SGO odds rules, odds lock, injuries, lineup-aware usage, opponent adjustment.
- `styles.md`: the site-wide look, phone layout, summary-card fit / zoom / Save image.
- `nba.md`: the NBA suite (data sources, build, pages, suite switcher, launch switch).
- `nhl.md`: the NHL suite (the NHL's own feed, kept games, rink areas, pages, the Shots model and its record; never MoneyPuck).

The engineering clean-up plan and its status: `docs/foundation-plan.md` (one item per session).

Background on past decisions and why rules exist: `docs/history.md` (search it when a rule's
reason matters; it is not loaded automatically).
