---
paths:
  - "nfl_tool/site/app.js"
  - "nfl_tool/site/index.html"
  - "nfl_tool/site/first-td.html"
---
# TD Data

The TD Data page is considered solid; change it only when asked. Stories, example games and
before/after numbers behind these rules: `docs/history.md`, "TD Data".

## TD Summary targets (app.js)

- `modelEntry`: a target needs offense >= −0.3 and defense >= −0.5, plus a combined score >= 0.6,
  OR one clearly extreme side (`MODEL_TARGET_SOLO_Z` = 1.0) carrying it on its own. Distance
  target rows show per game plus share of all TDs ("2.33 · 70%", unit "TDs/g · % of TDs").
- **Distance concentration** (`shareTargetEntry`): if a bucket fails on volume, it can still
  qualify on share-of-TDs z (one side >= 0.75, the other >= 0, each with 4+ TDs).
- **First TD target must agree with the First TD section:** it only shows for an offense whose
  `firstTdChanceFor` (same model as the First TD bar) is >= 50%.
- **"Soft D" targets:** a clearly soft defense (model z >= 1.0) flags even when the offense hasn't
  produced there (offense floor relaxed to −1.5 instead of −0.3). Marked `defLed`: dashed chip +
  red "SOFT D" tag + tooltip, never shown as "strong", and both numbers stay in the row. Only for
  `MODEL_SOFT_METRICS` (QB/RB/WR/TE, rush/pass, <=10 yds; the longer buckets and First TD swing on
  2-3 plays) and at most `MODEL_SOFT_MAX` = 2 per team side, softest first.
- **"Weak spot" matchup tag** (`defenseWeakSpot`): for a defense that's good at stopping TDs
  overall (TD/g allowed z >= 0.4, 4+ TDs allowed), the skill position whose share of TDs allowed
  is clearly above that position's league share (z >= 0.75, 2+ TDs). Shown regardless of the
  offense's usage, but the line prints the offense's own share of TDs at that position, so both
  sides are on the card. Key players: that position's top usage players.
- **No DST targets anywhere:** `targetGroups` drops DST items for both the TD Targets panel and
  the Summary card. The DST stat rows in the TD Data tables stay; they're data, not a target.

## First TD player model (`firstTdPlayerTargets`)

The user wants the whole offense's usage, not "who has scored before".

- Share of the team's first-TD chance = `FIRST_TD_W`: 15% full-field touches (targets + carries)
  / 30% red zone opportunities (RZ targets + carries) / 40% expected TDs / 15% early-game xTD.
  TDs scored carry 0 weight.
- RZ and xTD shares are pulled toward the player's touch share until the team piles up
  `FIRST_TD_RZ_PRIOR` RZ looks / `FIRST_TD_XTD_PRIOR` xTD, so 3-5 end-zone looks or one goal-line
  game can't top a team.
- `FIRST_TD_SHARE_FLATTEN` 0.9.
- Opponent position factor capped at z ±1 and only with `FIRST_TD_DEF_MIN_TDS` = 3+ TDs allowed
  to that position.
- QBs x mobility^1.5, mobility = min(1, max(carries/g ÷ 6, rush yds/g ÷ 30))
  (`FIRST_TD_QB_RUNNER`, `FIRST_TD_QB_RUN_YDS`).
- **QB change:** `lineupAdjustedXtd(team, week, { qbStarter })`: a WR/TE game thrown by someone
  other than `currentStarterQb` counts `LINEUP_QB_CHANGE_WEIGHT` 0.5 (First TD model only).
- **Market prior:** each player's share blends in his share of the team's ANYTIME TD odds with
  weight `FIRST_TD_MARKET_PRIOR_GAMES` 2 / (2 + games): ~40% after 3 games (the user: "keep 40
  for now"). Anytime is a different market from the First TD odds the model is compared to.
- Calibration check: sum the model's first-TD % by position across a full slate and compare with
  the season's actual first-TD scorers by position (last check: model RB 43 / WR 36 / TE 16 /
  QB 4.5 vs actual 39 / 37 / 17 / 6.5).
- The TD summary's QB Key Player chips use `currentStarterQb(team, week)` (`keyStarterQb`).

## TD Summary card layout

Like the Props card: one full-height column per team (`.td-team`, rows aligned across the two
columns with subgrid; the user likes them lined up) plus the TD Odds picks as a 250px right rail.
The rail's team headers use the same team-color fill + left stripe as the column banners. Each
column, top to bottom:

- **Header** (`summaryTdTeamBanner`): team color block with name/logo and a one-line fact strip:
  Implied TDs (implied points from Novig spread + total, / 7), Top TD position (biggest share of
  the team's TDs), and photos of the team's **top 3 TD scorers** (`topTdScorers`).
  - Each photo has a green bubble on its bottom-right with that player's season TD count.
  - Counts are rushing + receiving TDs, so a QB counts only his own runs. They are real season
    counts from player_xtd, not the lineup-weighted ones.
  - Players ruled out this week are skipped. Ties are broken by expected TDs per game.
- **TD Targets** as tiles: chip label centered on top, two big shaded boxes (team | opp allows),
  share % small under distance values. No units, no numbered bubbles; the First TD target is left
  out (it's the First TD section's Scored 1st tile).
- **Matchup Tags** as tiles in the same style (`summaryTagTile`): each " · " part of the tag's
  line becomes a box, the first number pulled out big ("TB 3.4 RZ trips/g"); a number followed by
  "+" stays in the label ("7+ box"); boxes tinted green (tag helps the offense) / yellow (works
  against it). "(lg x)" league notes are dropped on the card (no small gray text).
- **First TD** (`summaryFirstTdBlock`): the big 1st TD chance box (this game), then First TD tab
  stats as tiles: Scored 1st (season rate vs allowed), the First TD tab's flagged position shares,
  RZ finish before the first TD. **No model player list on the card.**
- **Key Players** at the bottom, centered, with ★ = how many of the team's targets/tags the
  player fits.

Leftover tiles in a row are centered under the row above (flex, not grid). Only `.sc-main` grows
(`.sc-zoom-target`); the fit check also watches tiles and boxes for overflow. Colliding short
names (Bijan / Brian Robinson) show in full (`uniqueShortNames`). The toolbar button
`#summary-rail-btn` ("Hide TD Odds") drops the rail.

## TD Data tags that read both sides

Beats the blitz, Pressure trouble, Clean pocket, Light-box runs, Beats stacked box, RZ wall all
use the offense's number and the defense's allowed number (`matchupCall` / `matchupKind`).
