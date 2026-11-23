# Foundation plan

Why this exists: in October 2026 a developer friend of the owner reviewed the project and warned
that it keeps growing without much structure, so every task costs more usage and time. This is
the agreed plan to fix that, in order. Do one item per chat session. Update the status here when
an item is finished.

Ground rules:

- Clean up an area when work touches it; no big-bang rewrite, no framework, no stats database.
- Nothing here may change what members see unless the owner approved it.
- The owner starts a fresh chat per task, opened from this repo's folder, to keep usage down.

## Done

- **Protect the paid site (2026-10-13).** The repo is private and the GitHub Pages copy is gone.
  The deploy runs `tools/check_site.py --gate` before publishing and stops if a page or card is
  broken. `https://nfl.gmgsports.org/version.json` confirms which commit is live.

- **Permanent tests for the math (item 3, 2026-10-13).** `python tools/run_tests.py` runs 49 tests in
  about 4 seconds; the deploy runs them before it builds anything and stops if one fails.
  - Plain Python for the build code (`tests/test_gmg_model.py`, `test_odds_lock.py`,
    `test_novig_props.py`); the site's JavaScript runs in a real browser on saved data
    (`tests/test_site_js.py`), because the PC has Playwright but no Node.
  - Two saved samples in `tests/fixtures/`, outside `nfl_tool/` so they never deploy: the full
    `data.json` built 2026-10-12 (week 5, compressed to 0.6 MB) and one game's Novig markets.
  - What is pinned: the GMG model gives the same score in the build and in the browser on default
    weights, and the weights lists and grade recipes match; a pick needs 4+ points; the odds and
    the model entry lock at kickoff; Novig First TD prices (one-sided kept, junk dropped, a game
    sums to about 100%); two-sided matchup calls (the PHI heavy-box case); the Game Summary edge
    rule; no pocket QB as a TD option; no TD Summary chip against a top-8 defense.
  - Each rule was broken on purpose once (27 ways) to prove a test fails when it breaks.
  - Going forward: a bug fix gets a test that fails without it; a rule changed on purpose gets
    its test changed in the same commit. `test_buf_at_la_score` holds the model's exact answer
    for one game, which is the proof item 4's split changes nothing.

- **Monday clean-up (2026-11-23).** Claude's notes for NBA and NHL were split into one file per tool
  (`.claude/rules/nba-*.md`, `nhl-*.md`): opening an NBA file used to load all 90 KB of NBA notes,
  now a 9 KB core plus that tool's file (NHL: 57 KB to a 22 KB core plus one tool). About 250 lines
  of code nothing called were removed (the old TD Data "Matchup Snapshot" finder, among others).
  Screenshots and mockups live in `scratch/`, which git ignores.
  Same day, the site-wide notes: `members-and-hosting.md` became `members.md`, `member-profiles.md`,
  `hosting.md` and `deploy.md`; King of the Endzone and the $100 CONTEST moved to `promos.md`; odds
  moved to `nfl-odds.md`. Editing sync.js now loads about 23 KB of notes (was 54), common.js 29 (was 45).

- **Design pushes publish fast (item 5, mostly done by 2026-11).** A push that touches only pages,
  the login code, tools, tests or notes skips the data rebuild and is live in about 5 minutes; the
  deploy rebuilds only the sport a push changed. A shared file (common.js, style.css, ...) still
  rebuilds everything (about 23 minutes).

## 4. Smaller files, one source of truth (next)

- `nfl_tool/build_stats.py` is 4,700 lines (2026-11-23; `nhl/build_nhl.py` 4,000): split by feature (odds, injuries, TD data, props,
  team stats, schedule) into modules, keeping one entry script. Tests from item 3 come first so
  the split can be proven to change nothing (compare the built `data.json` before and after).
- `nfl_tool/site/style.css` is 4,400 lines (and growing) of layers stacked on layers: one file per page plus a
  shared file for the building blocks (tiles, chips, the shared-label "tape", rank colors).
- The NBA / NHL day and game picker (`days`, `gamesOn`, `renderSchedule`, `selectDay`,
  `currentGame`) is copied into 11 page files and has drifted into 11 slightly different versions:
  one shared copy in a suite-wide file (2026-11-23 count). Same for the NHL prop pages' shared
  helpers (`gameState`, `sortedRows`, `renderToolbar`, `edgeCell`).
- Logic that exists twice (model weights and math in Python and in JavaScript, grade recipes):
  keep the numbers in one shared file both sides read, or compute in the build and only display
  in the browser.

## 6. Split data.json

It is 9.6 MB and every page loads all of it. Split it so each page loads what it needs (player
game logs and pass charts on demand). Faster for members on phones and for the checks.
