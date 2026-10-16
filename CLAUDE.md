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
3. Confirm it's live: `https://nfl.gmgsports.org/version.json` (public) shows the pushed commit's
   `sha`, about 7 minutes after the push (about 3 for a page-only push: members-and-hosting.md). The deploy runs the tests first, then opens every
   page and Summary card in a browser (`check_site.py --gate`), and publishes nothing if a test
   fails or a page is broken, so if the sha never changes, the run failed: say so and look at why.
   After publishing it looks at the real site and puts the last version back if it is down.
4. Tell the user to hard refresh (Ctrl+Shift+R).

- **The site must never be left down or half-done** (members pay). Before starting a task that ends in a push, check plan usage (`mcp__ccd_session_mgmt__get_usage`); with under about 25% of the 5-hour window left, don't start it: say what is left and when it resets. One push = one finished, tested change that works on its own: never a "part 1", never a change made outside git. `python tools/ci_steps.py live-check --look` says whether the site is answering. Detail: members-and-hosting.md, "The site must never be left down".

- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys.** `SGO_API_KEY`, `SGO_API_KEY_BACKUP`,
  `STRIPE_SECRET_KEY`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `CLOUDFLARE_API_TOKEN` and any
  future key are GitHub Actions secrets, added by the user in GitHub Settings → Secrets.
- Git safety: never force-push, never `git reset --hard`, never rewrite history. If a pull or push
  conflicts or is rejected, stop and explain it in plain words. Undo a bad push with `git revert`.

### Local verification

- **One sport at a time** (the user's rule): add `--only nfl|nba|nhl` to both checks below. The deploy always runs everything.
- **Tests:** `python tools/run_tests.py` before any push that touches the build
  code or the site's JavaScript. `tests/` pins the math and every past bug on saved samples
  (`tests/fixtures/`), so the answers never depend on this week's data. When a rule they pin
  changes on purpose, change its test in the same commit; a bug fix gets a test that fails without it.
  Every push to main starts the full deploy (all tests, all sports). The public Actions API
  shows runs: `api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/runs`.
- Python: on the Carter PC `C:\Users\Carter\AppData\Local\Python\bin\python.exe` (there `py` can't
  see Playwright's browser); on the cdmcc PC `py`. Plain `python` is the Store stub on both.
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
- `nfl_tool/novig_event_markets.graphql`: Novig's query text, sent verbatim. `nfl_tool/smartstake.py`: every US book's price -> `book_odds` in data.json and nhl/data.json, shown by `site/book-odds.js` (shared: best-price pill, all-books list; tags only against our own model; data-pipeline.md, nhl.md).
- `nfl_tool/nba/build_nba.py`: NBA data build -> `nfl_tool/site/nba/data.json`.
- `nfl_tool/nhl/build_nhl.py`: NHL data build -> `nfl_tool/site/nhl/data.json`, `nhl/shots.json` + `nhl/players/<TEAM>.json` (games kept in `data/nhl`).
- `nfl_tool/nhl/shots_model.py`: the NHL shots-on-goal model; `saves_model.py`: goalie saves (behind King of the Crease); `goals_model.py`: anytime goals (`nhl/goals.json`); `points_model.py`: 1+ point, on top of goals (`nhl/points.json`).
- `nfl_tool/functions/_middleware.js`: member login gate (Discord + email/Stripe), profiles, admin.
- `.github/workflows/deploy.yml`: builds and deploys on a 6-hour cron, "Update Odds" and every push to main;
  every run tests, builds and browser-checks all three sports (members-and-hosting.md, "Every run does everything"). `nhl-refresh.yml`: hockey-only refresh every half hour, pressed by the Cloudflare timer `workers/nhl-timer` (installed by `nhl-timer.yml`). `cloudflare-domain.yml`: one-off domain attach.
- `model_history/`, committed by the deploy bot: `gmg_model.json` (locked projections), `nfl_koe/` (King of the Endzone's past weekly boards), `nhl_shots/<month>.json` (graded Shots plays), `nhl_goals/` (graded Goals players), `nhl_points/` (graded Points players, with the factors behind each number), `nhl_crease/` (King of the Crease's days), `nhl_icebreaker/` (Icebreaker's 7 PM slates).
- `tools/check_site.py`: one-command local check (pages, every Summary card's fit, phone width,
  optional screenshots and before/after compare). Outside `nfl_tool/`, so it never redeploys.
  `.github/workflows/site-check.yml` runs it against the live data once a day.
- `tools/run_tests.py` + `tests/`: the permanent tests. Plain Python for the build code; the site's
  JavaScript runs in a real browser on the saved data (`tests/site_browser.py`), like the site check.
- `tools/backtest/`: week-by-week replay of the GMG model on past seasons (`features.py`, then `analyze.py`);
  `nhl_shots.py` replays the NHL shots model the same way and fits its weights; `nhl_saves.py` the saves model; `nhl_goals*.py` the goals model; `nhl_points*.py` the points model; `nhl_icebreaker.py` what predicts the slate's quickest goal.
- `nfl_tool/site/`: static pages.
  - `game-overview.html/.js` + `game-summary.js`: **Game Previews** (Full Preview, Build Your Model, Summary card).
  - `index.html` + `app.js`: **TD Data** (Season TDs, First TD, Summary card). `first-td.html` is an old redirect.
  - `player-props.html/.js` + `props-summary.js`: **Player Props** (Receiving / Rushing / Passing + Summary card).
  - `player-card.js`: the player card popup, plus rush-lane and pass-zone drawing.
  - `possible-plays.html/.js`: Possible Plays (View Results, Photo Export, Parlay Wheel). `picks.js`: Pick Tracker.
  - `promo-tools.html/.js`: Promo Tools (King of the Endzone). `support.html`: Support tab.
  - `common.js`: shared helpers (tiers, matchup calls, saved plays, lineup weights, modals, summary-card fit / Save image).
  - `sync.js`: member profiles, account chip, the Settings gear (odds format, color set, My Books), feature requests, suite switcher, the Promo Tools menu (`PROMOS`: every sport's promo tools from any page's nav), the NHL Player Props menu (`PROPS`). `teams.js`: names, colors, logos.
  - `style.css`: dark/light tokens and the NFL pages' styles. `suite.css`: the layout the NBA and NHL pages share. `nhl/nhl.css`: hockey only.
  - `nba/index.html` + `nba/nba.js`: NBA Game Previews. `nhl/index.html` + `nhl/nhl.js`: NHL Game Previews.
  - `nhl/shots.html` + `nhl/shots.js`: NHL Shots (every skater ranked by shots-on-goal value); `nhl/goals.html` + `goals.js`: NHL Goals (anytime goal); `nhl/points.html` + `points.js`: NHL Points (1+ point); `nhl/best.html` + `best.js`: Best Plays (the three pages' edges in one list).
  - `nhl/promo-tools.html` + `nhl/promo-tools.js`: NHL Promo Tools (King of the Crease: most saves of the day); `nhl/icebreaker.js`: its Icebreaker tab (quickest goal of the 7 PM slate).
  - `nhl/nhl-common.js`: shared by every NHL page (data, rink drawing, the NHL player card).

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
- **Summary cards direct attention and don't explain.** No wordy blurbs; use color and shaded
  boxes, not plain colored text. No "#5" rank badges on the card (ranks go in hovers or small
  tags); the exceptions are the Game Summary's Matchups and the TD Summary's targets, which show league ranks. The card must never contradict itself. Give rows and boxes room: use the full card
  height and don't cram. **Never drop data to make a card bigger; rearrange into dead space.**
- **Props Summary is directional, never a pick sheet:** no projections, "model edge" numbers or
  model-picked players. The user draws the conclusions.
- **The GMG model is a talking point, never "beats the line".** A 2024-25 replay had it at 50% against the spread.
- **Any new place that shows a player must use `playerClick`** (NHL pages: their own in `nhl/nhl-common.js`).
- **Reuse the existing look** (the summary-card look: rounded tiles, shaded boxes, team-color
  banners, filled tier cells) rather than adding a new one. One font, Sofia Sans, for letters AND numbers on every sport (styles.md).
- **Odds lock at kickoff.** Books keep quoting in-game lines; the site must never show them as
  the line. A saved pick always shows the line it was made at.
- **Lineup-aware usage:** never surface a backup off one fill-in game. **No DST targets anywhere** (random, not bet).
- **Settings gear** (sync.js, styles.md): every shown price goes through `showOdds`, every red-to-green shade through `scaleHsla` / the tier tokens; never name a state.
- **Per-member data** goes in BOTH `SYNC_KEYS` (middleware) and `KEYS` (sync.js), and its save
  function calls `window.NFLSync?.push(key, value)`. Settings (odds format, colors) sync too; display prefs (theme, views, selected game) stay per-device.
- **Phone layout:** phone-only rules go in the last `@media (max-width: 760px)` block of
  style.css so desktop stays pixel-identical; new wide tables must scroll inside their own box.
- The TD Data page is considered solid; change it only when asked.
- **The NHL suite is this season only**: no last-season data in any model or on any page, not even fading out (nhl.md).

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

Clean-up plan: `docs/foundation-plan.md` (one item per session). Why rules exist: `docs/history.md` (search it; not loaded automatically).
