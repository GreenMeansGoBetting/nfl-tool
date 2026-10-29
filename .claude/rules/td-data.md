---
paths:
  - "nfl_tool/site/app.js"
  - "nfl_tool/site/index.html"
  - "nfl_tool/site/first-td.html"
  - "nfl_tool/site/opening-drives.*"
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
- The TD summary's QB Key Player chips use `currentStarterQb(team, week)` (`keyStarterQb`), and only
  for a QB who runs (`qbIsRunner`, see the card layout below).

## TD Summary card layout (`td2Main`, `td2-*` styles)

Simplified 2026-10-12 at the user's call (the wall of tiles, different for each team, read as
"so much data it's overwhelming"). Do not go back to tiles or add rows without asking. The TD
Odds picks stay in a 330px right rail (team headers in team color). Main area, top to bottom:

- **Team banners** (`summaryTdTeamBanner`, the part the user loves): name/logo, Implied TDs
  (implied points from Novig spread + total, / 7), Top TD position, and photos of the team's
  **top 3 TD scorers** (`topTdScorers`) with a green bubble holding each one's season TD count.
  Counts are rushing + receiving TDs, real season counts from player_xtd. Players ruled out this
  week are skipped. Ties are broken by expected TDs per game.
- Then four sections, each under a **solid header bar** (`.td2-h`; the old light labels did not
  separate anything, and First TD "blended in"):
  - **TD Targets** (`TD2_ROWS`): one tape with the SAME 7 rows for both teams in every game
    (Pass TDs, Rush TDs, QB, RB, WR, TE, Red zone TD %), labels down the middle: what this
    offense scores | what that defense allows. Each number is per game with its league rank
    ("#3") on the shared 8-step rank colors (`rankScaleStyle` in common.js, same as the Game
    Summary). Ranks are of the raw number shown.
  - **The Target chip** at the outer end of a row = the target model flagged it
    (`td2TargetItems`): this offense's logo, green border = strong, yellow = lean, **dashed =
    Soft D**, a small triangle = usage ahead of TDs. One card-only guard: no chip where the
    defense's number on the card ranks top 8 (`TD2_GOOD_DEF_RANK`). The model reads
    opponent-adjusted and usage numbers and could flag DAL's run game against a TB defense
    ranked #3 on the card, which read as a mistake.
  - **First TD**: the 1st TD chance for this game (one big box per team), then a "Scores first"
    row (season rate vs how often the other team allows it), with a chip when First TD is a target,
    then a **"1st TD by"** row (`td2FirstPos`): the position that scored this offense's game-opening
    TDs most ("WR 4/5") and how often that SAME position beat the other defense to the first TD
    ("WR 2/2"). Shaded only with 3+ first TDs behind it (`TD2_FIRST_POS_MIN`).
  - **Matchup Tags**: one line each (`td2TagRow`: chip, then up to three of its numbers; sample
    sizes and league notes stay in the tooltip; a three-number tag drops its unit text, and
    `TD2_TAG_WORDS` shortens long wording, so every line fits its box),
    at most `TD2_TAGS_SHOWN` 3 per team. Warning tags (and their numbers) are red on this card:
    they are roadblocks, and yellow read as "meh" (user 2026-10-16).
  - **Key Players**: up to `TD2_KEY_PLAYERS` 5 per team, stars = how many of the flagged rows and
    shown tags the player fits. Since 2026-10-16 they sit at the TOP of the right rail, above TD
    Odds, each team's pills on a block in its team color (`td2KeyRail`); they move back to the
    bottom of the main column only when the rail is hidden.
- **Width (2026-10-16, user: "way too wide"):** the narrower main column brings the four TD
  Targets columns in ~25%. The rail must fit 16-20 picked players without growing the card
  (a taller card shrinks everything): odds rows are one line, and past 16 picks they lose their
  padding (`td2-odds-dense`).
- **A QB is a TD-scoring option only if he runs** (`qbIsRunner`: 15+ rush yards or 5+ carries a
  game). Otherwise he never appears in Key Players or the banner photos. The user, on Stafford:
  "his TD was a fluke". His red-zone sneaks had also made him a top red-zone "usage" player.
- Left off the card on purpose (still on the TD Data tabs): distance targets, the RZ finish and
  position first-TD tiles, tags past the first three.
- The card fits at full size; only `.sc-main` grows (`.sc-zoom-target`), and the fit check
  watches the tag lines and tape cells for overflow. Colliding short names (Bijan / Brian
  Robinson) show in full (`uniqueShortNames`). The toolbar button `#summary-rail-btn` ("Hide TD
  Odds") drops the rail.

## TD Data tags that read both sides

Beats the blitz, Pressure trouble, Clean pocket, Light-box runs, Beats stacked box, RZ wall all
use the offense's number and the defense's allowed number (`matchupCall` / `matchupKind`).

## Opening Drive Tool (`opening-drives.html/.js`, its own page under TD Data in the menu; 2026-10-29)

For the Discord's "First Drive - Punt" parlays on primetime games. Not inside TD Data; no Summary card.
- Graded like the book: **Off TD / FG Att** (made, missed or blocked) **/ Punt** (blocked too) **/ Any
  Other** (turnover, downs, safety, defensive or special-teams score). First drive = the offense's
  first drive with a real snap (a kickoff return TD doesn't count). Build: `compute_opening_drives`
  -> `DATA.opening_drives.teams[team]` = per game `out`, plays, yards, `three_out`, `received`, and
  `half` / `game` drive counts `[td, fg, punt, other]`.
- A defense = its opponents' rows for the same games (both sides from the same drives).
- **Raw numbers, no pull toward league average** (the owner: "teams have identities"). Bigger
  samples come from the First Half / Full Game toggle instead; Last 3 / 5 / 8 filter.
- Fair = (offense rate + other team's defense rate) / 2, American only via `showOdds` (not on
  exchanges, so no percent). Both Fair = the two chances multiplied. Odds aren't fetched
  (SmartStake doesn't carry the market).
- Primetime tag on the schedule strip: not Sunday, or Sunday 7 PM ET or later.
- The owner's background paragraph at the top is their wording, verbatim.
- Tests: `test_opening_drives_build.py`, `test_opening_drives_site.py`.
