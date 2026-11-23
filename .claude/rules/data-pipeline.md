---
paths:
  - "nfl_tool/*.py"
  - "nfl_tool/site/common.js"
---
# NFL data pipeline (`nfl_tool/build_stats.py` and friends)

Stories and example players behind these rules: `docs/history.md`, "Data pipeline".

`build_stats.py` runs the build in order; the work lives in `nfl_*.py` by job (2026-11-23, list in its
opening note: `nfl_sources` downloads, `nfl_lines` odds, `nfl_td`, `nfl_team_stats`, `nfl_players`,
`nfl_props`; each imports only files above it). It reads nflverse play-by-play, rosters, injuries, snap counts, FTN charting and
schedules, plus odds from SmartStake (every US book) and Novig, and ESPN FPI, and writes
`nfl_tool/site/data.json` (untracked; built in CI). `gmg_model.py` and `line_grades.py` are
imported by it (rules in game-previews.md).

## Building locally

- `python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  A 404 is a transient nflverse error; re-run.
- The build only downloads a data file if it's missing (`download_if_missing`), so a local
  `data/` folder goes stale. Delete `data/*_2026*` and `data/games.csv` (and `data/ngs_*.csv.gz`)
  before a local build that needs the latest games. CI always starts fresh.
- Locally the previous-build read fails (401, no bot token), so locked lines, SmartStake's started
  games and the live model entries aren't available; that's expected.

## Ratings and adjustments

- **ESPN FPI** (`espn_ratings`): offense/defense/FPI turned into 1–100 league-normed ratings, plus
  SOS rank. FPI is predictive; it includes preseason priors and QB changes.
- **Opponent adjustment:** `prop_matchup_model` gives what each defense allows and each offense
  produces by position, throw depth and play type, with ranks. `team_stats_adj` powers the Game
  Previews **Raw / vs Opponents** toggle. Early samples are shrunk toward league average.
- **Context weights (passing numbers):** games in rain, snow or 15+ mph wind count 30%; games
  against a backup QB count 30% toward the defense's numbers.
- **Game script:** each throw is flagged `gt` when win probability is under 10% or over 90%
  (`GARBAGE_WP`), with `s` for play success (used by the zone grades in player-props.md).
- `compute_koe` -> `DATA.koe` (King of the Endzone; promos.md). `koe_week_boards` +
  `koe_game_results` -> `site/koe_weeks.json` (past weeks' boards, each game's longest TD).
- **Two parts live in their own files** (`split_page_parts`, 2026-11-23; about 40% of data.json, which
  every NFL page reads): `site/box_scores.json` (`player_box_scores`, Game Previews) and
  `site/pass_plays.json` (each pass chart zone's `plays`; the zone counts stay in data.json; Player Props).
  A page that shows one calls `loadDataPart(name)` (common.js) before it draws; it puts the part back
  where the code reads it. A new generated file goes in `.gitignore` AND fetch_live_data.py's list.
  Test: `tests/test_data_parts.py`.

## Lineup-aware player usage (important)

- Uses `player_snaps` plus injuries.
- A game a regular left early doesn't count.
- A fill-in game while a regular (healthy now) was out counts 15%.
- TD Data uses `lineupWeights` / `lineupAdjustedXtd` in common.js; Props uses `propBaselineGames`.
- **Never surface a backup off one fill-in game.**
- **Starting QB = `currentStarterQb(team, week)`** (common.js): whoever threw the most in the
  team's most recent game, unless ruled out this week (then the starter before). Used for the TD
  summary's QB Key Player chips and to order the Player Props QB cards. Returns null when every
  recent starter is out; callers then fall back to most attempts. (The GMG model uses a different
  rule for "the regular starter is out": `_regular_qb`, game-previews.md.)

## Injuries and roster status

- Injuries come from nflverse's injuries file, keyed by week. Teams file their first practice
  report Wednesday afternoon (Thursday-game teams earlier), so Mon-Wed the current week is empty;
  the panel then shows the team's most recent earlier report, labeled "No Week N report yet ...
  Showing the Week N-1 final report", instead of a blank.
- **Live source for the upcoming week:** `fetch_nflcom_injuries` reads the league's own page,
  `nfl.com/injuries/league/{season}/reg{week}`, and `merge_live_injuries` swaps in NFL.com's rows
  for every team that has filed for the current week. Past weeks stay on nflverse. If the fetch or
  parse fails, the build keeps nflverse and logs why. NFL.com codes AZ/LAR are mapped to ARI/LA. A
  rebuild (6-hour cron, or a manual run) is still what pulls a newly filed report onto
  the site.
- **Injury `snap_share` (who counts as a starter)** joins the report to the snap counts by name,
  forgiving spelling (`_snap_share_lookup`: exact, then without punctuation/suffix, then last
  name + first initial when only one teammate fits). "Pat Surtain II" vs "Patrick Surtain II"
  once hid him, Out, from the Summary card.
- **Roster status:** players on reserve/IR never appear on weekly injury reports.
  `compute_roster_out` reads each team's latest weekly roster `status` (RES = IR/reserve, RET,
  CUT, EXE) into data.json `roster_out`. `rosterOut()` (common.js) feeds `lineupOutOn`,
  `propInjuries` and `firstTdInjuryStatus`, so these players count as Out everywhere and their
  backups get full lineup weight. DEV (practice squad) is NOT treated as out.
