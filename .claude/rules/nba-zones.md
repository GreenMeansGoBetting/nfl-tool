---
paths:
  - "nfl_tool/nba/zone_matchups.py"
  - "nfl_tool/site/nba/zones.*"
---
# NBA: Zone Matchup Targets

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Zone Matchup Targets (`zone_matchups.py`, `zones.html/.js/.css`)

Where and HOW a player shoots vs what tonight's defense allows **his group** (guards / forwards / bigs).
- **Raw, no pulling toward the league** (the page sets `NBA_SHOT_PRIOR = 0`; other pages still pull).
  Every read shows its shot counts; His Shots filter.
- **Outliers, not 50/50 spots** (the owner, 2026-10-30): under `MIN_SHOTS` (25 shots / 10 threes his) or
  `MIN_ALLOWED` (40 / 25 by the defense vs his group) = **Small Sample**, never a read; a zone's Shots part
  counts at most `VOL_CAP` double the league's; **his diet must agree** (`backing`: share of his shots,
  zones and types averaged, pointing the read's way `AGREE` 40%+ and twice the share against, within
  `EVEN` 5% = neither), else Toss Up (Embiid vs NYK 10-30: rim + paint against him, +50% Over from one
  13% spot). **No price on the read's side at the main line = no read** (Cain, Sharpe).
- **No EV ever:** no chance or edge; main line + best price shown; record tracks W / L and units.
- Every player with a points or threes line gets OVER / UNDER / Toss Up per market, Strong past 12%.
- Build (`block`, own try in the shots step) -> shots.json `matchups` {date, games, players{...},
  defense{team: {group: {zone: [made, tried, FG% rank, shots rank]}}}, league, league_n, pos}. Score =
  (1 + Shots) x (1 + Makes) - 1 (Shots: zone shares x allowed share / league share - 1; Makes: allowed
  make rate minus league x points, by zones and kinds, averaged, over his diet's league points a
  shot). Threes: his threes only. `zone()` = `nbaShotZone` (a test pins it).
- Page (menu beside Matchup Keys): **Best & Worst Spots** (top 15,
  Show All, started games out), **Matchup View** (both rotations + each defense's **position grid**,
  PG-C down, boxed column groups, every column the same width, cells = rank of 30 (30th = gives up
  most, red) by Makes / Shots / Points Per Shot, each row's worst cell outlined). Row click: his chart,
  the defense's chart vs his group, and the Why table (his side left, Zone / Type middle, defense
  right; colored from HIS side; Shots vs Lg log scale). Prefs per device (`nba-tool.zones.v1`).
- Legends: Less Makes / More Makes, Fewer Shots / More Shots. No Read cell except Matchup View.
  Score / Shots / Makes cells on the full red-yellow-green scale (`zmShade`). Line = the player card's
  rule (`main_line`); Odds = best price on the read's side, no book name, click for every book. **Why**
  column (`zmDiet`): short idea tags, **one row** (+N folds the rest): areas (`ZM_AREAS`, 15%+ of his
  shots) as "Rim Volume" / "Mid-Range Makes" / "Corner 3s Volume", types (25%+) "Self Creates" /
  "Catch & Shoot" / "Drives & Cuts"; only ones moved 5%+, biggest share x effect first; colored for him;
  no percentages on the tag, the numbers in the hover (`zmZoneWhy`).
- **The record:** `model_history/nba_zones/<season>.json`, Over / Under reads only, rewritten until
  tip (`update_record`); graded vs his main line (`box_logs`), units at the best price at tip
  (`best_price`). shots.json `matchups.record`; YTD tracker with a Min Score slider 5-30%. Past nights:
  `matchups.past` (`zone_matchups.past`).
- Not built: a key defender Out chip. Tests: `tests/test_nba_zone_matchups.py`.
