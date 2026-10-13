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

## 4. Smaller files, one source of truth (next)

- `nfl_tool/build_stats.py` is 5,100 lines: split by feature (odds, injuries, TD data, props,
  team stats, schedule) into modules, keeping one entry script. Tests from item 3 come first so
  the split can be proven to change nothing (compare the built `data.json` before and after).
- `nfl_tool/site/style.css` is 3,800 lines of layers stacked on layers: one file per page plus a
  shared file for the building blocks (tiles, chips, the shared-label "tape", rank colors).
- Logic that exists twice (model weights and math in Python and in JavaScript, grade recipes):
  keep the numbers in one shared file both sides read, or compute in the build and only display
  in the browser.

## 5. Separate data updates from design changes

Every push, even a color change, re-downloads the season and rebuilds everything. Keep the last
good `data.json` between runs and let pushes that don't touch the build code publish with it;
rebuild data on the 6-hour schedule and on "Update Odds". Target: a design push live in about a
minute.

## 6. Split data.json

It is 9.6 MB and every page loads all of it. Split it so each page loads what it needs (player
game logs and pass charts on demand). Faster for members on phones and for the checks.
