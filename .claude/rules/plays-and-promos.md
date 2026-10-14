---
paths:
  - "nfl_tool/site/possible-plays.*"
  - "nfl_tool/site/picks.js"
  - "nfl_tool/site/promo-tools.*"
  - "nfl_tool/site/common.js"
---
# Possible Plays, Pick Tracker and Promo Tools

Stories behind these rules: `docs/history.md`, "Possible Plays, picks and promos".

## Possible Plays (`possible-plays.js`; storage helpers in common.js)

- Saved plays live in `nfl-tool.possible-plays.v1` (synced to the member's profile). A play's id
  has the player's name in it, so plays are matched by `possiblePlayKey` (common.js: the id
  without Jr./Sr./II-IV and punctuation), never by exact id: `isPossiblePlay` and
  `togglePossiblePlay` both use it. `dedupePossiblePlays` merges existing doubles on page load
  (newest kept; a result already on the older copy carries over).
- **View Results:** checkboxes on each bet, a select-all box, and "Select by game" chips; when any
  shown bet is checked, the summary covers only the checked ones ("Summary of N selected bets" +
  Clear selection). In-memory per visit (`resultsSelected`).
- **Photo Export:** a "📷 Photo Export" button beside View Results opens a box with week buttons,
  a checkbox per category (TD categories pre-checked), a Columns choice (Auto / 1-4) and **Save
  image**. The image (`#plays-export-card`, `.pe-*` styles) is just team logo, play, odds, grouped
  under category bars and flowed into columns so everything fits one picture. If plays are checked
  in the list, an "Only the N plays I checked" box appears, pre-checked.
- **TD bets grade on a loose name match** (`gradeTdPlay`, `normName`): bets may carry a book's
  spelling ("Brian Robinson Jr.") while TD results use nflverse's ("Brian Robinson"). Already-
  graded auto losses flip to wins on next load. A manual result always beats a later auto re-grade.
- The build also keeps one spelling per player in the odds (`canonicalize_odds_names`; see
  data-pipeline.md).

## Pick Tracker (`picks.js`; rendering in game-overview.js / game-summary.js)

- Grades each pick on the line and price saved at pick time (`line_at_pick` / `odds_at_pick`),
  which is Novig's when available. A saved pick is always shown at that line (`pickLabel`).
- **Your Record week filter:** checkbox chips above the record, "All weeks" plus one chip per week
  that has picks (shown whenever there are picks, even one week). Check any mix of weeks to see
  just those; none checked = all weeks. Recent Picks stays unfiltered. The selection is a
  per-device view preference in localStorage (`nfl-tool.picks.weekFilter`), not synced. Old picks
  without a `week` fall back to their game's week in the schedule.
- Pick Tracker buttons match the Summary card's My Picks strip.

## Promo Tools: King of the Endzone (`promo-tools.html/.js`)

DraftKings' weekly promo paying on the game's LONGEST TD, D/ST included.

- Team checklist for this week's games (per-device, `nfl-tool.koe.teams`), position filter.
- Player table: TDs (count / avg / long), TDs by distance (1-10, 11-20, 21-40, 41+), big plays
  (20+/g, 40+ count, longest play), role (touches/g, 20+ runs / catches, ADOT for WR/TE only, deep
  targets/g), and this week's defense (20+ plays allowed/g matched to runs or catches by the
  player's mix, 20+ TDs allowed, avg TD length allowed). Colors vs the whole league. Ruled-out
  players hidden; QBs = current starter only.
- **Upside** = league percentile of weighted z's (`KOE_UPSIDE_PARTS`: 20+ plays 35%, 40+ plays
  15%, deep role 15%, TD length 10%, opponent big plays allowed 25%), rates shrunk by
  `KOE_PRIOR_GAMES` 2. First-guess weights ("we can adjust if needed").
- Layout: each column group has a colored header bubble spanning its columns (`KOE_GROUP_CLASS`,
  `.koe-g-*` colors), empty 8px gap columns split the groups, and every stat box is a fixed 44px
  (TD distances 38px; `table-layout: fixed`, colgroup), rows 32px; the player column (214px) has
  photo, name, team logo and position on one line. No Opp column. Table ~1130px so it screenshots
  easily; **Save image** (`saveKoeImage`) downloads `#koe-capture` as a PNG with a GMG title
  naming the games and week.
- D/ST table: return TDs (INT / FUM / KR / PR with yards), takeaways/g, opponent giveaways/g, D/ST
  TDs the opponent has allowed. No Upside score for D/ST yet.
- Data: `build_stats.py compute_koe` -> `DATA.koe` (players per team, team big plays allowed,
  `dst_tds` / `dst_tds_allowed`; return TD length = `return_yards`, else `fumble_recovery_1_yards`).
- **Week toggle** (2026-10-14, the owner: "doesn't have a week toggle so going back is not
  possible"): arrows beside "Week N" in the Teams panel. A past week shows its board **as it
  stood going into the week** (labeled so): `koe_week_boards` runs `compute_koe` on the games
  before week W, for W = 2 to now (week 1 has nothing before it), and saves each one once every
  earlier game is final (`model_history/nfl_koe/<season>/week-NN.json`, committed by the deploy
  bot) so the build doesn't redo the season every run. Past weeks: that week's injury report
  and the QB who started that week (`koeOut`, `koeStarterQb`); this week keeps the live rules.
  Once a game is final a **Result** column shows each player's longest TD in it, with a star for
  the game's longest (`koe_game_results`: offensive TDs at their gain, return TDs as "<TEAM>
  D/ST" at their return length, ties name everyone; roster full names). Both go to
  `site/koe_weeks.json` (its own file, only this page loads it; on fetch_live_data's list).
- **Winners** (2026-10-14, the NHL King of the Crease list carried over): beside the table when
  there is room, never in the saved image. One collapsible line per **contest** = a game the
  owner has logged payouts for (the promo is one game a week, so far Monday night): week and
  game, the longest TD's scorer and yards, his place going into the week ("2nd of 20" = by
  Upside among both teams' players, starters only, as the table ranks them: `koeBoard`), and
  what he paid. Open: pool, about how many were on him (pool / payout), **If they'd won** (each
  player DraftKings showed a payout for: TD, Pre, Up, Paid), our top Upside and the most picked.
  No Worth column: Upside is a 0-100 score, not a chance (the planned longest-TD chance model
  would add one, and a Value column).
  - The owner's paste box (only with `html.is-owner`): pick the game (finished games, the last
    Monday one first), the pool (required; filled from the last one logged), DraftKings' list as
    it comes. Names match both teams' board players, every TD scorer and both D/STs ("Falcons
    D/ST"); any unmatched name, or no pool, blocks the save. D1 `koe_payouts` through
    `/api/koe-payouts` (members-and-hosting.md).
- Tests: `tests/test_koe_build.py` (results and boards on hand-made plays) and
  `tests/test_koe_site.py` (the toggle, Result column, Winners and paste box in a browser).

## Shared logic in common.js (other pages rely on it)

- `matchupCall` / `matchupKind` / `MATCHUP_CONTRA`: the two-sided matchup rule.
- `lineupWeights` / `lineupAdjustedXtd`, `lineupOutOn`, `rosterOut()`, `firstTdInjuryStatus`:
  lineup-aware usage (rules in data-pipeline.md).
- `currentStarterQb(team, week)`: whoever threw the most in the team's most recent game, unless
  ruled out this week (then the starter before). Returns null when every recent starter is out;
  callers then fall back to most attempts.
- `normName`, `shortName`, `teamBannerHeader`, `summaryFontCSS`, and the summary-card helpers
  (see styles.md).
