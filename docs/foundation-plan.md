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

## 3. Permanent tests for the math (next)

There are none. Every change so far was verified with one-off scripts that were thrown away.
Build a small suite that runs in seconds, locally and in the deploy before the gate.

- The PC has Python and Playwright but no Node, so: plain Python tests for the build code, and
  browser-run checks (Playwright, like `tools/check_site.py`) for the site's JavaScript.
- A small fixed data sample (one saved `data.json`, trimmed if needed, kept out of the deploy)
  so results don't change week to week.
- Each bug that already happened becomes a test so it cannot come back. First ones:
  - The GMG model gives the same score in the build (`gmg_model.py`) and in the browser
    (`gsModelCompute`) on default weights, and the weights lists match.
  - A pocket QB is never a TD option: Stafford / Burrow out of Key Players and the banner photos;
    a running QB (Allen) stays (`qbIsRunner`).
  - Two-sided matchup calls: an offense number alone never makes a call (the PHI heavy-box case).
  - Game Summary edge rule: 16+ ranks apart = clear, 8-15 = slight, both top 8 = strength vs
    strength (`gsRankEdge`).
  - TD Summary: no target chip when the defense ranks top 8 on the card (`TD2_GOOD_DEF_RANK`).
  - Novig TD odds: one-sided First TD prices are kept, junk quotes are dropped, a game's First TD
    chances sum to about 100% (`extract_novig_props`, with a saved sample response).
  - Odds lock at kickoff: a started game keeps its stored line and model entry.
  - A model pick needs 4+ points from the line (`EDGE_POINTS` equals `GS_MODEL_EDGE`).
- Wire the suite into `deploy.yml` ahead of the gate, and say in CLAUDE.md how to run it.

## 4. Smaller files, one source of truth

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
