# GMG Sports Data Suite: project guide for Claude

This file holds only what every session needs. Rules for one part of the site live in
`.claude/rules/` and load when you open matching files; the stories behind them are in
`docs/history.md`.

**Keeping it current:** when a rule or preference changes, update the CLAUDE.md line or
`.claude/rules/` file that holds it. Put the story of WHY in the commit message, and in
`docs/history.md` if it's worth keeping. Keep CLAUDE.md under 140 lines (it loads on every
message, so every line costs usage); detail belongs in a rules file.

## Who this is for

- Owner: a sports-betting content creator ("GMG" = Green Means Go) with no coding background.
  Explain in plain language and do the technical work yourself.
- Live at **https://nfl.gmgsports.org** (+ `nba.` / `nhl.gmgsports.org`, same site). Repo: `GreenMeansGoBetting/nfl-tool`. The brand is
  "GMG Sports Data Suite"; NFL, NBA and NHL are all open to members (NBA and NHL launched
  2026-10-13 and are still being built out). A separate CFB tool is paused.
- The user screenshots sections and the **Summary cards** (fixed 1160×980, sized to their video
  template's left area) and drops them into betting videos. Favor dense, screenshot-ready,
  visually clean layouts.
- **No mockups, ever** (the owner, 2026-10-25, to save usage): build the change, push it, and the
  owner judges it live. If a layout is unclear, say the plan in a sentence or two instead.

## Workflow the user expects

1. Make the change and verify it locally (below).
2. `git pull --rebase` (a bot commits `model_history/` to main), then **commit and
   push to `main`**. GitHub Actions rebuilds and deploys automatically. No branches or pull requests.
3. Confirm it's live with ONE look at `https://nfl.gmgsports.org/version.json` (public) about 7
   minutes after the push (3 for pages / login code only): it shows the pushed `sha`. The deploy runs every test and
   opens every page and Summary card (`check_site.py --gate`) before publishing, and puts the last
   version back if the live site is down after; if the sha never changes, the run failed: say so and look at why.
4. Tell the user to hard refresh (Ctrl+Shift+R).

- **The site must never be left down or half-done** (members pay). Before starting a task that ends in a push, check plan usage (`mcp__ccd_session_mgmt__get_usage`); with under about 25% of the 5-hour window left, don't start it: say what is left and when it resets. One push = one finished, tested change that works on its own: never a "part 1", never a change made outside git. `python tools/ci_steps.py live-check --look` says whether the site is answering. Detail: members-and-hosting.md, "The site must never be left down".
- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys** (SmartStake, Stripe, Discord, Cloudflare,
  any future key): they are GitHub Actions secrets, added by the user in GitHub Settings → Secrets.
- Git safety: never force-push, never `git reset --hard`, never rewrite history. If a pull or push
  conflicts or is rejected, stop and explain it in plain words. Undo a bad push with `git revert`.

### Local verification

- **Lean checking (the owner, 2026-10-23: save usage, the deploy's gate already opens every page).**
  Locally, test only the area touched: `run_tests.py --only <sport>`; the full set only for a
  site-wide UI change or a shared file (common.js, sync.js, style.css, suite.css, ytd.js,
  book-odds.js, my-plays, the login code, tools/, workflows). No local `check_site.py` run; a
  visual change gets at most ONE small screenshot of that one thing. Batch related small fixes into one push.
- **Tests** (`tests/`, on saved samples in `tests/fixtures/`) pin the math and every past bug. When a
  rule they pin changes on purpose, change its test in the same commit; a bug fix gets a test that
  fails without it. Runs (public): `api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/runs`.
- Python: on the Carter PC `C:\Users\Carter\AppData\Local\Python\bin\python.exe` (there `py` can't
  see Playwright's browser); on the cdmcc PC `py`. Plain `python` is the Store stub on both.
- `tools/check_site.py` (Playwright: `pip install -r tools/requirements-dev.txt`, then
  `python -m playwright install chromium`) is only for chasing a specific page problem.
  Never the full all-games screenshot set (the user: it "takes way too long").
- Build: `python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`. A 404 is a
  transient nflverse error; re-run. The build only downloads missing files, so delete
  `data/*_2026*` and `data/games.csv` first when the latest games matter. CI always starts fresh.
- Serve `nfl_tool/site` with `python -m http.server <fresh port>` (the preview caches
  aggressively). No Node.js or `gh` on the user's PC.

## Project map

- NFL build: `nfl_tool/build_stats.py` -> `site/data.json` (untracked, built in CI); `gmg_model.py`
  (GMG score model, picks, locked record); `line_grades.py` (OL / DL grades); `best_plays_record.py`.
  Odds: `smartstake.py` (every US book -> `book_odds`, shown by `site/book-odds.js`),
  `novig_event_markets.graphql` (sent verbatim). See data-pipeline.md.
- **NBA** (`nfl_tool/nba/`, `site/nba/`) and **NHL** (`nfl_tool/nhl/`, `site/nhl/`): file lists
  are in nba.md / nhl.md, "Files".
- `nfl_tool/functions/_middleware.js`: member login gate (Discord + email/Stripe), profiles, admin.
- `.github/workflows/deploy.yml`: builds and deploys on a 6-hour cron, "Run workflow" and every push
  to main; every run tests, builds and browser-checks all three sports (members-and-hosting.md).
  `nhl-refresh.yml`: hockey every half hour (nhl.md). `site-check.yml`: daily live check.
- `model_history/` (committed by the deploy bot): every model's locked / graded record
  (`gmg_model.json`, `nfl_koe/`, `nfl_best_plays/`, `nhl_*/`, `nba_*/`).
- `tools/`: `check_site.py` (local page check), `run_tests.py` + `tests/` (site JS runs in a real
  browser via `tests/site_browser.py`), `backtest/` (season replays per model).
- NFL pages (`nfl_tool/site/`): `game-overview.html/.js` + `game-summary.js` Game Previews;
  `index.html` + `app.js` TD Data; `player-props.html/.js` + `props-summary.js` Player Props;
  `best-plays.html/.js` NFL Best Plays; `player-card.js` player card popup; `promo-tools.html/.js`
  King of the Endzone; `support.html`.
- Shared: `my-plays.html/.js` My Plays (every sport's saved plays, Photo Export, `parlay-wheel.js`;
  `plays-grading.js`, `picks.js`); `common.js` (tiers, matchup calls, saved plays, modals, card
  fit / Save image); `sync.js` (profiles, top menu `SPORT_PAGES` / `PROPS` / `PROMOS` / `navMenu`,
  account menu, Settings window, What's new `GMG_UPDATES`); `teams.js`; `ytd.js`; `style.css`
  (tokens + NFL pages), `suite.css` (NBA / NHL layout).

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
- **Tables: every column its contents + one small even padding, centered** (names / tags read left);
  ONE column takes the spare width (`width: 100%`; at `auto` the browser spreads it over every column),
  tags fill at most two lines in a box the same height on every row (extras fold into a "+N" pill with a hover list). The owner, 2026-10-25: "I hate always
  having to come back to this". Pattern: `table.data-table.sim-list` rules + `fitTags` (nba/sim.css, sim-board.js).
- **Two-team tables: teams side by side, the label in the far-left column** (a matchup table reading both
  directions keeps it in the middle; the owner, 2026-10-28). Never stretch a box to fill the screen.
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
- **The NHL suite is this season only**: no last-season data in any model or on any page, not even fading out (nhl.md). **NBA: this season only, no exceptions** (the owner, 2026-10-27: "i've told you 10000 times its not relevant"): no 2025-26 in any model, page or starting point, not even fading out; 2025-26 is for backtests only (nba.md).

## Where the detail lives

Area rules in `.claude/rules/` (each loads when you open a file it lists): `game-previews.md`
(Summary card, GMG model, grades / tags, trenches), `td-data.md`, `player-props.md` (Props Summary,
Zone Targets, player card), `plays-and-promos.md` (My Plays, Photo Export, Pick Tracker, King of the
Endzone), `members-and-hosting.md` (login, Stripe, Cloudflare, deploy), `data-pipeline.md` (sources,
SmartStake / Novig odds, odds lock, injuries, usage), `styles.md` (site-wide look, phone, card fit),
`nba.md`, `nhl.md` (the NHL's own feed; never MoneyPuck).

Clean-up plan: `docs/foundation-plan.md` (one item per session). Why rules exist: `docs/history.md` (search it; not loaded automatically).
