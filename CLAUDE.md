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
- Live at **https://nfl.gmgsports.org** (+ `nba.` / `nhl.gmgsports.org`, same site). Repo: `GreenMeansGoBetting/nfl-tool`. The brand is
  "GMG Sports Data Suite"; NFL, NBA and NHL are all open to members (NBA and NHL launched
  2026-10-13 and are still being built out). A separate CFB tool is paused.
- The user screenshots sections and the **Summary cards** (fixed 1160×980, sized to their video
  template's left area) and drops them into betting videos. Favor dense, screenshot-ready,
  visually clean layouts.
- For layout changes the user likes before/after mockup images and approves before a push.

## Workflow the user expects

1. Make the change and verify it locally (below).
2. `git pull --rebase` (a bot commits `model_history/gmg_model.json` to main), then **commit and
   push to `main`**. GitHub Actions rebuilds and deploys automatically. No branches or pull requests.
3. Confirm it's live with ONE look at `https://nfl.gmgsports.org/version.json` (public) about 7
   minutes after the push (3 for pages / login code only): it shows the pushed `sha`. The deploy runs every test and
   opens every page and Summary card (`check_site.py --gate`) before publishing, and puts the last
   version back if the live site is down after; if the sha never changes, the run failed: say so and look at why.
4. Tell the user to hard refresh (Ctrl+Shift+R).

- **The site must never be left down or half-done** (members pay). Before starting a task that ends in a push, check plan usage (`mcp__ccd_session_mgmt__get_usage`); with under about 25% of the 5-hour window left, don't start it: say what is left and when it resets. One push = one finished, tested change that works on its own: never a "part 1", never a change made outside git. `python tools/ci_steps.py live-check --look` says whether the site is answering. Detail: members-and-hosting.md, "The site must never be left down".

- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys.** `SMARTSTAKE_API_KEY`,
  `STRIPE_SECRET_KEY`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `CLOUDFLARE_API_TOKEN` and any
  future key are GitHub Actions secrets, added by the user in GitHub Settings → Secrets.
- Git safety: never force-push, never `git reset --hard`, never rewrite history. If a pull or push
  conflicts or is rejected, stop and explain it in plain words. Undo a bad push with `git revert`.

### Local verification

- **Lean checking (the owner, 2026-10-23: save usage, the deploy's gate already opens every page).**
  Locally, test only the area touched: `run_tests.py --only <sport>`; the full set only for a
  site-wide UI change or a shared file (common.js, sync.js, style.css, suite.css, ytd.js,
  book-odds.js, my-plays, the login code, tools/, workflows). No local `check_site.py` run; a
  visual change gets ONE screenshot of that one thing. Batch related small fixes into one push.
- **Tests** (`tests/`, on saved samples in `tests/fixtures/`) pin the math and every past bug. When a
  rule they pin changes on purpose, change its test in the same commit; a bug fix gets a test that
  fails without it. Runs (public): `api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/runs`.
- Python: on the Carter PC `C:\Users\Carter\AppData\Local\Python\bin\python.exe` (there `py` can't
  see Playwright's browser); on the cdmcc PC `py`. Plain `python` is the Store stub on both.
- `tools/check_site.py` (needs Playwright: `pip install -r tools/requirements-dev.txt`, then
  `python -m playwright install chromium`) is for chasing a specific page problem, never routine.
  Never the full all-games screenshot set (the user: it "takes way too long").
- Build: `python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  A 404 is a transient nflverse error; re-run. The build only downloads a file that's missing
  (`download_if_missing`), so delete `data/*_2026*` and `data/games.csv` first when the latest
  games matter. CI always starts fresh.
- Serve `nfl_tool/site` with `python -m http.server <fresh port>`; use a fresh port each time
  (the preview caches aggressively). No Node.js or `gh` on the user's PC.

## Project map

- `nfl_tool/build_stats.py`: the NFL data pipeline -> `nfl_tool/site/data.json` (untracked, built in CI).
- `nfl_tool/gmg_model.py`: GMG score model, its picks and the locked record.
- `nfl_tool/line_grades.py`: offensive line / defensive front grades.
- `nfl_tool/novig_event_markets.graphql`: Novig's query text, sent verbatim. `nfl_tool/smartstake.py`: every US book's price -> `book_odds` in data.json and nhl/data.json, shown by `site/book-odds.js` (shared: best-price pill, all-books list; tags only against our own model; data-pipeline.md, nhl.md).
- `nfl_tool/nba/build_nba.py`: NBA data build -> `nfl_tool/site/nba/data.json`. `nfl_tool/nba/kotc.py`: King of the Court; `first_basket.py`: First Basket (nba.md). `nfl_tool/nba/possessions.py`: the NBA engine (every possession with the ten on the floor; every new NBA tool reads it); `identity.py`: Team Identity; `props.py`: player props data (`nba/props.json`). `positions.py`: PG / SG / SF / PF / C from ESPN's depth charts (every box score is read with them). `shots.py`: this season's shot spots (`nba/shots.json`, the card's Shot Chart).
- `nfl_tool/nhl/build_nhl.py`: NHL data build -> `nfl_tool/site/nhl/data.json`, `nhl/shots.json` + `nhl/players/<TEAM>.json` (games kept in `data/nhl`).
- `nfl_tool/nhl/shots_model.py`: the NHL shots-on-goal model; `saves_model.py`: goalie saves (King of the Crease and the Saves page, `nhl/saves.json`); `goals_model.py`: anytime goals (`nhl/goals.json`); `points_model.py`: 1+ point, on top of goals (`nhl/points.json`); `lines_model.py`: Line Matchups, every line and pair at 5-on-5 from the shift charts (`nhl/lines.json`; replaced Line Stacks 2026-10-21, whose `stacks_model.py` stays for the replays).
- `nfl_tool/functions/_middleware.js`: member login gate (Discord + email/Stripe), profiles, admin.
- `.github/workflows/deploy.yml`: builds and deploys on a 6-hour cron, "Run workflow" and every push to main;
  every run tests, builds and browser-checks all three sports (members-and-hosting.md, "Every run does everything"). `nhl-refresh.yml`: hockey-only refresh every half hour, pressed by the Cloudflare timer `workers/nhl-timer` (installed by `nhl-timer.yml`). `cloudflare-domain.yml`: one-off domain attach.
- `model_history/`, committed by the deploy bot: `gmg_model.json` (locked projections), `nfl_koe/` (King of the Endzone's past weekly boards), `nfl_best_plays/` (NFL Best Plays as the page showed them, graded: `nfl_tool/best_plays_record.py`, captured by `tools/best_plays_capture.py`), `nhl_shots/<month>.json` (graded Shots plays), `nhl_goals/` (graded Goals players), `nhl_points/` (graded Points players, with the factors behind each number), `nhl_saves/` (graded Saves starters), `nhl_stacks/` (retired Line Stacks' record, kept), `nhl_crease/` (King of the Crease's days), `nhl_icebreaker/` (Icebreaker's 7 PM slates), `nba_kotc/` (King of the Court's nightly boards and this season's tip-off lines).
- `tools/check_site.py`: one-command local check (pages, every Summary card's fit, phone width,
  optional screenshots and before/after compare). Outside `nfl_tool/`, so it never redeploys.
  `.github/workflows/site-check.yml` runs it against the live data once a day.
- `tools/run_tests.py` + `tests/`: the permanent tests. Plain Python for the build code; the site's
  JavaScript runs in a real browser on the saved data (`tests/site_browser.py`), like the site check.
- `tools/backtest/`: week-by-week replay of the GMG model on past seasons (`features.py`, then `analyze.py`);
  `nhl_shots.py` replays the NHL shots model the same way and fits its weights; `nhl_saves.py` the saves model; `nhl_goals*.py` the goals model; `nhl_points*.py` the points model; `nhl_stacks*.py` Line Stacks; `nhl_icebreaker.py` what predicts the slate's quickest goal. `tools/nhl_factor_report.py`: the NHL records grouped by each graded play's saved factors (nhl.md).
- `nfl_tool/site/`: static pages.
  - `game-overview.html/.js` + `game-summary.js`: **Game Previews** (Full Preview, Build Your Model, Summary card).
  - `index.html` + `app.js`: **TD Data** (Season TDs, First TD, Summary card). `first-td.html` is an old redirect.
  - `player-props.html/.js` + `props-summary.js`: **Player Props** (Receiving / Rushing / Passing + Summary card; the menu links each as `#view`). `best-plays.html/.js`: **NFL Best Plays** (player-props.md).
  - `player-card.js`: the player card popup, plus rush-lane and pass-zone drawing.
  - `my-plays.html/.js`: **My Plays** (top-menu button): every sport's saved plays, graded, sortable, Photo Export, Parlay Wheel (`parlay-wheel.js`). `possible-plays.html` is now a redirect there; `plays-grading.js`: NFL grading/units. `picks.js`: Pick Tracker.
  - `promo-tools.html/.js`: Promo Tools (King of the Endzone). `support.html`: Support tab.
  - `common.js`: shared helpers (tiers, matchup calls, saved plays, lineup weights, modals, summary-card fit / Save image).
  - `sync.js`: member profiles, the top menu (NFL / NBA / NHL / Promo Tools dropdowns: `SPORT_PAGES`, `PROPS`, `PROMOS`, `navMenu`; then the My Plays button), `loadNhlPlays`/`saveNhlPlays`, the account button and its menu (feature requests, What's new, Settings, Support, Log out), the Settings window (odds format, color set, My Books). `teams.js`: names, colors, logos.
  - `style.css`: dark/light tokens and the NFL pages' styles. `suite.css`: the layout the NBA and NHL pages share. `nhl/nhl.css`: hockey only.
  - `nba/index.html` + `nba/nba.js`: NBA Game Previews; `nba/identity.html` + `identity.js`: Team Identity; `nba/points.html` + `points.js`: Points. `nba/first-basket.html` + `first-basket.js`: First Basket. `nba/shot-charts.html` + `shot-charts.js`: Shot Charts (a shooter vs a defense). `nba/nba-card.js`: the NBA player card (`playerClick(id)`; this season's game log, every market's odds with save boxes, Shot Chart from `nba/shot-chart.js`). `nba/promo-tools.html` + `kotc.js`: NBA Promo Tools (King of the Court). `nhl/index.html` + `nhl/nhl.js`: NHL Game Previews.
  - `nhl/shots.html` + `nhl/shots.js`: NHL Shots (every skater ranked by shots-on-goal value); `nhl/goals.html` + `goals.js`: NHL Goals (anytime goal); `nhl/points.html` + `points.js`: NHL Points (1+ point); `nhl/saves.html` + `saves.js`: NHL Saves (goalie saves over / under); `nhl/lines.html` + `lines.js`: Line Matchups (a preview, no picks); `nhl/best.html` + `best.js`: Best Plays (the three pages' edges in one list).
  - `nhl/promo-tools.html` + `nhl/promo-tools.js`: NHL Promo Tools (King of the Crease: most saves of the day); `nhl/icebreaker.js`: its Icebreaker tab (quickest goal of the 7 PM slate).
  - `nhl/nhl-common.js`: shared by every NHL page (data, rink drawing, the NHL player card, the save-to-My-Plays box `nhlPlayBox`).

## Rules that apply everywhere

- **Every matchup call reads BOTH sides.** Any Tough / Mismatch / Target / Fade / ADV logo / tag
  must use the offense's number AND the defense's ALLOWED number for the same thing. Use
  `matchupCall` / `matchupKind` in common.js: a call needs one side clearly pointing one way and
  the other side not pointing the other way (`MATCHUP_CONTRA`). An average alone is not enough.
  How often a defense shows a look (blitz %, box %) only decides whether the look matters, never
  which way it points. Rows where the sides don't act on each other (penalty yards) aren't matchups.
- **Distrust small samples.** 2–3 games can be one weird matchup; prefer approaches that discount flukes and lean on the market.
- **Audit habit:** any rule that blends parts into one score and then cuts on it can hide one
  strong part. Before shipping a new selection rule, list every candidate with its parts for a
  real week and check that no strong single part is dropped except by an intentional block.
- **Summary cards direct attention and don't explain.** No wordy blurbs; color and shaded boxes, not plain colored text. No "#5" rank badges (ranks in hovers or small tags; except the Game Summary's Matchups and the TD Summary's targets).
  Never contradict itself; use the full card height, don't cram. **Never drop data to make a card bigger; rearrange into dead space.**
- **Props Summary is directional, never a pick sheet:** no projections, "model edge" numbers or
  model-picked players. The user draws the conclusions. NFL Best Plays is the one page of model plays (owner, 2026-10-20).
- **The GMG model is a talking point, never "beats the line".** A 2024-25 replay had it at 50% against the spread.
- **Any new place that shows a player must use `playerClick`** (NHL pages: their own in `nhl/nhl-common.js`).
- **Reuse the existing look** (the summary-card look: rounded tiles, shaded boxes, team-color
  banners, filled tier cells) rather than adding a new one. One font, Sofia Sans, for letters AND numbers on every sport (styles.md).
- **Title Case every header, label and button** without being asked (the owner, 2026-10-21: "If its
  a header, every word needs capitalized"); when the owner gives exact wording, use it as written.
- **Odds lock at kickoff:** never show in-game lines as the line; a saved pick shows the line it was made at.
- **Every model record is the shared YTD tracker** (`ytd.js` `ytdTracker`: Yesterday to Season, a
  Min Edge slider per market, split tiles; the build sends a `ledger`). A new tool gets it (styles.md; `test_ytd_site.py`).
- **Lineup-aware usage:** never surface a backup off one fill-in game. **No DST targets anywhere** (random, not bet).
- **Settings gear** (sync.js, styles.md): every shown price goes through `showOdds`, every red-to-green shade through `scaleHsla` / the tier tokens; never name a state.
- **Per-member data** goes in BOTH `SYNC_KEYS` (middleware) and `KEYS` (sync.js), and its save
  function calls `window.NFLSync?.push(key, value)`. Settings (odds format, colors) sync too; display prefs (theme, views, selected game) stay per-device.
- **Phone layout:** phone-only rules go in the last `@media (max-width: 760px)` block of
  style.css so desktop stays pixel-identical; new wide tables must scroll inside their own box.
- The TD Data page is considered solid; change it only when asked.
- **The NHL suite is this season only**: no last-season data in any model or on any page, not even fading out (nhl.md). **NBA: this season only on the site** (since 2026-10-23, no 2025-26 even as reference); 2025-26 is for backtests only (nba.md).

## Where the detail lives

Area rules in `.claude/rules/` (each loads when you open a file it lists):

- `game-previews.md`: Summary card layout, GMG score model and weights, grades / tags, trenches, pick labels.
- `td-data.md`: TD targets, First TD model, Soft D, Weak spot, TD Summary layout.
- `player-props.md`: Props Summary packages, Zone Targets, zone popup and panel, QB cards, player card.
- `plays-and-promos.md`: Possible Plays, Photo Export, View Results, Pick Tracker, King of the Endzone.
- `members-and-hosting.md`: Discord gate, email / Stripe members, profiles, feature requests, Cloudflare, deploy.
- `data-pipeline.md`: sources, SmartStake / Novig odds rules (no SGO since 2026-10-23), odds lock, injuries, lineup-aware usage, opponent adjustment.
- `styles.md`: the site-wide look, phone layout, summary-card fit / zoom / Save image.
- `nba.md`: the NBA suite (data sources, build, pages, suite switcher, launch switch).
- `nhl.md`: the NHL suite (the NHL's own feed, kept games, rink areas, pages, the Shots model and its record; never MoneyPuck).

Clean-up plan: `docs/foundation-plan.md` (one item per session). Why rules exist: `docs/history.md` (search it; not loaded automatically).
