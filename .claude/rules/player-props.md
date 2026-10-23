---
paths:
  - "nfl_tool/site/player-props.*"
  - "nfl_tool/site/props-summary.js"
  - "nfl_tool/site/player-card.js"
  - "nfl_tool/site/best-plays.*"
---
# Player Props and the player card

Stories, example players and numbers behind these rules: `docs/history.md`, "Player Props".

## Props Summary card: directional, not a pick sheet

- It's a Target / Fade list of *packages*: a team position group plus betting markets plus its
  players' lines (e.g. "PHI WRs · Rec Yds · Long Rec → Smith, Wicks, Lemon").
- Only real betting markets: no YPA, INTs or sacks.
- Each package must agree with the betting market (spread for RB rushing, implied team total
  otherwise). A market is dropped if either side contradicts it (the two-sided rule).
- Rank tags list offense first, shaded red → yellow → green by how good the rank is for that unit.
- No projections, "model edge" numbers or model-picked players anywhere on the card or the Props
  tabs (Best Plays, below, is the one exception). The user draws the
  conclusions and adds players to the Prop Picks rail themselves.
- **Packages are scored per direction** (`propPackages`): each direction is judged on its own
  markets, so a package can show a Target and a Fade on DIFFERENT markets (card splits by `dir`).
  Never average every market into one lean and cut on it.
- Betting-market blocks (intentional): implied total <= 18.5 no targets / >= 25.5 no fades; 7+
  point spread for RB rushing. Exception: **Long Comp / Long Rec targets ignore the low-total
  block** (`PROP_LONG_MARKETS`). Yards/receptions targets stay blocked at low totals; fades at
  high totals unchanged.
- **Clickable tags:** every rank tag and garbage-time chip on a package opens a game-by-game popup
  (`openPropTagModal(team, side, metric)`): each game's number, the players behind it
  (playerClick), the opponent's usual in its OTHER games and +/- (colored from the tagged unit's
  side), flags (weather, backup QB, garbage %), and an Avg row with a one-line "offenses it faced
  got +X vs their usual" verdict.
  - Rows come from `prop_matchup_model.games` (per game side: `v` counts, `gt` garbage part, `bq`
    backup QB, `wx` bad weather, `p` players with `pass [att,cmp,yds,td]`,
    `rec [tgt,rec,yds,20+,deep yds,deep tgt]`, `rush [car,yds,10+]`, roster position), the same
    counts the rank is built from. Usual = plain average, unweighted.
  - Columns spell out whose numbers they are ("vs BUF D | HOU TEs | That D allows other teams").
  - An **Up next** row under Avg shows the card's opponent and only its usual (other cells blank),
    so it lines up against past opponents; it's skipped once that game is played.
- **Hide Prop Picks toggle:** Target / Fade fill the card and zoom 1.15-1.6x. It's the shared
  picks-column toggle (kind `props`; see styles.md).
- **Garbage-time tag (tag only, the user's choice):** a Target's reason stat gets a neutral gray
  dashed chip ("JAX D 44% garbage time") when 30%+ of it came with the offense under 10% to win
  (`PROP_GARBAGE_TAG`; league average ~12%). Hover explains it. The numbers themselves are NOT
  discounted; the spread decides how much it matters. Data:
  `prop_matchup_model.teams[t][side][metric].gt` (passing counts only) and `.gt_median` (the
  league mean, despite the name).
- The Prop Picks rail's team headers use the same team-color fill + left stripe as the banners.

## Zone Targets (`zoneTargets` / `renderZoneTargets` in props-summary.js)

Pass catchers whose targets land where the defense is soft.

- **Zone softness** is 50% the zone's own completion % and EPA allowed (shrunk with 8 prior
  attempts) plus how often it's attacked, and 50% the opponent-adjusted depth band from
  `prop_matchup_model`.
- **Player opportunity:** lineup-aware targets per game as a percentile at his position (70%)
  plus recent snap share (30%).
- **Markets:** Receptions (volume into soft short zones), Long Rec (10+ yd share into soft zones,
  defense gives up 20+ plays), Rec Yds (overall match plus volume); YAC is a bonus tag.
- A player's zone fit is a target-weighted blend cut at `ZT_MATCH_MIN`. Two bypasses of the
  blended cut: a strong **downfield** fit (>= 40% of targets intermediate/deep, those zones
  >= +0.8 soft, opportunity percentile >= 0.6) adds Rec Yds and ranks on max(blend, downfield
  fit); a strong **short** fit (>= 40% short/screen, >= +0.8 soft) also bypasses it. The blended
  cut still filters everything else.
- **Where it shows:** a panel under each Pass D Allowed grid; on the Props Summary card, flagged
  players list first with a ★ in receiving packages.

## Pass zones

- Pass-zone grids (Pass D Allowed / Passing Offense) use the summary-card look: rounded zone
  tiles, big share numbers, header/row shares as big red→green numbers with fill bars (no small %
  tags), stat tiles underneath. The offense per-player mini grids sit 3 cards per row with uniform
  row heights. QB grid cells show comp/att plus yards · YAC.
- **Zone popup** (`renderPassZoneModalContent`): opened by clicking a cell in any team grid, the
  QB grid, or a receiver grid. A receiver grid opens the popup filtered to that player
  (`receiver` in the payload). It shows:
  - summary tiles: throws, catches/%, yards per catch, YAC share, EPA per throw, 20+ plays;
  - league rank by volume;
  - who got targeted, most first, with catch %, YAC/rec and longest;
  - on offense, **"OPP Defense Here"**: Throws faced/game, Comp %, Yards/throw, YAC/catch and
    EPA/throw allowed, each next to the league average; colored from the defense's side vs the
    league, using values shrunk by 8 prior throws (4 for YAC); a one-line **Top X% / Bottom X% /
    Neutral matchup** blurb and a Soft spot / Average / Holds up pill. Both come from the league
    ranking of `ztDefenseSoftness` (thirds, or the same 0.5 line Zone Targets uses), so they
    always agree with each other and with the Zone Targets chips;
  - every throw grouped by player, newest first, with opponent, air yards, YAC and EPA.
- **Zone matchup panel** (`renderZoneMatchupPanel`, beside the QB grid; wraps below it on narrow
  screens):
  - One row per depth (20+ / 10-19 / 0-9 / SCR, its 3 zones combined) and per side (L / M / R,
    its 4 depths combined).
  - Each row shows share of the offense's throws, then Catch%, Yds/throw, YAC/catch and EPA/throw
    as offense-vs-defense-allowed pairs, colored vs the league from each unit's side, plus a
    Top X% / Bottom X% / Neutral / Mixed chip.
  - Grades weight EPA 0.35, Y/T 0.25, success 0.2, catch 0.1, YAC 0.1, shrunk by 10 prior throws.
    The % is this pairing's rank among every offense × defense pairing for that group.
  - **"Mixed"** means one side is clearly good and the other clearly bad (the two-sided rule).
- **Overall read** (`renderZoneMatchupRead`) under the lead-zone tiles: an overall passing matchup
  (depth grades weighted by the offense's throw share), plus the Best spot and Toughest spot
  among groups with at least 10% of throws.
- **Game script:** build_stats flags each throw `gt` when win probability is under 10% or over
  90% (`GARBAGE_WP`), and records `s` for play success. Garbage-time throws count **half** in
  these grades, and the grades use only per-throw efficiency, never volume, which game script
  inflates.
- The page max width is 1840px, so wide monitors fit the panel beside the grid.

## Tables and cards

- **Passing tab = one QB card per team** (`renderQbCards`), in this order:
  1. Header: photo, name, games and attempts.
  2. Eight equal season tiles (Att/G, Cmp%, Yds/G, Y/A, TD/G, INT/G, EPA/Att, ADOT), colored vs
     every QB and clickable for the QB list. Y/A and TD/G are derived from game logs by
     `enrichQbRows`.
  3. His posted lines.
  4. A 2×2 of equal boxes: vs OPP pass D (QB vs defense-allowed, with a two-sided Edge),
     Pressure, QB rushing, Red zone.
  5. Recent weeks, shaded against his own games.
  The Show backup QBs toggle stacks a second card. Cards are ordered by
  `currentStarterQb(team, week)`.
- **Receiving table:** the 7 core columns get a very light green/red wash ranked against the
  player's own teammates in that table. The 4 depth columns sit under a boxed "Target depth"
  group label; their colors compare each player to every pass-catcher in the league, so leave
  them as-is.
- Rush lanes are big tiles like the pass zones.
- Props baselines use lineup-aware games (`propBaselineGames`); injuries come through
  `propInjuries`.
- Page extras: the **Pick props** list is grouped Passing / Rushing / Receiving / Other, then by
  player. Each player has an **Out?** switch for late news the injury report misses.

## The player card (`player-card.js`)

The ONE popup for every player name or photo on every page. Anything wrapped with
`playerClick(team, name, inner?, oppTeam?)` (or `.player-click` +
`data-entry {team, name, oppTeam}`) opens it. **Any new place that shows a player must use playerClick.**

- **Odds tab:** every prop line plus Anytime and First TD, with Possible Plays checkboxes, and
  "+ Summary" on the Player Props page.
- **Game Log tab:** weekly versions of the Receiving / Rushing / Passing table stats (snap %,
  target share, ADOT, YAC/rec, depth buckets, 10+ runs, RZ looks), each column shaded against the
  player's own weeks, with an Avg row.
- **Rush/Catch Lanes tab:** RB/QB rushing first, WR/TE catch zones first.
- The file also holds the rush-lane and pass-zone drawing code, so every page can draw them.
- Injury lists and box scores link skill positions only (`SKILL_POSITIONS`).

## NFL Best Plays (`best-plays.html/.js`, 2026-10-20)

Members asked for "top plays" for props and TDs; the owner agreed with a small-sample warning on
top (`#bp-warning`, the typical games played). First row under the NFL menu's "Player props".

- **Props:** the projection engine in props-summary.js (`propTeamLines(..., withModel)`), which
  starts from the books' no-vig line and moves toward the data by games played (`PROP_STABILITY`).
  Then `bpCalibrate`: each market's average gap to the books this week (log-odds) comes off every
  line in it (the engine leaned Over: receptions above the books on 47 of 58 players in Week 7),
  and the model keeps only `BP_MODEL_TRUST` 0.5 of what is left. The shown projection moves with
  the chance, so an Over never shows a projection under its line.
- **Anytime TD:** implied team points x `BP_TD_PER_POINT` -> expected offensive TDs, split by
  touches / RZ looks / xTD (First TD model's priors and defense-by-position factor), blended with
  the market's own no-vig split by games / (games + 6). No market-wide lean found (checked).
- **First TD:** TD Data's `firstTdPlayerTargets` as is. app.js only starts itself on TD Data
  (`TD_DATA_PAGE`), so Best Plays can load it; the stars are the TD Summary's (`td2KeyList`).
- Edge = model chance minus the best price's break-even (best across the member's books,
  `bookBest`). Ratings `BP_EDGES` per market; Check = edge past `check` or a TD long shot at
  `BP_CHECK_RATIO` 1.8x the price's chance (usually news the model lacks). Games that have kicked
  off drop off (`bpStarted`). Save boxes are the shared `propOuEntries` / `ouCheckboxCell` ids.
  Toolbar: market buttons, a **Rating** menu (All Ratings / Strong / Lean / Check; 2026-10-23,
  replaced "Strong only") and the Game menu.
- **Graded record (2026-10-22, owner: "capture what members see", not the math ported to
  Python):** the engine runs in the browser, so every deploy opens best-plays.html headless on the
  fresh data (`tools/best_plays_capture.py`, step "NFL Best Plays record") and reads `bpCapture()`:
  the page's own list, no member so no My Books (best price across every US book). Kept in
  `model_history/nfl_best_plays/<season>.json` by `nfl_tool/best_plays_record.py`: a game not yet
  started takes the latest list (a dropped play is dropped; an empty capture keeps the old ones);
  a started game is never touched (odds lock at kickoff); `first_price` / `first_book` kept for CLV.
  Graded every run from data.json (`player_game_logs`, `player_td_results`; no snap and no touch =
  void, not a loss; an exact push = void). `site/best_plays_record.json` = `ledger` per group
  (rec / rush / pass / any / first; tags group, side, rating) + the graded plays. Captures run on
  the 6-hour cron and every push, so the "last pre-kickoff" price can be hours before kickoff.
  The capture never blocks a deploy (`safe_main` always leaves the site file; the gate fails on a
  missing one). **Popup:** "YTD Model Performance" beside the title (shown once the record file
  loads) -> `ytdTracker` key `nfl-best-plays`, one market per group, Min Edge from that market's
  Lean bar, a "New Record, Small Sample" note, and the graded plays (date, player, bet, price +
  book, edge, rating, result) kept to the tracker with `ytdKeeps`. Tests:
  `tests/test_best_plays_record.py`, `tests/test_best_plays_site.py`.
- It loads props-summary.js and app.js for their math but has no game picker (`#away-select`):
  their code that reads the picker must skip when it's missing. The player card shows
  "+ Summary" only where the picker exists (it threw on Best Plays until 2026-10-21).
- Test: `tests/test_best_plays_site.py`.
