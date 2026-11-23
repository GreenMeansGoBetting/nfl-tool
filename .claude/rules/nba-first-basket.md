---
paths:
  - "nfl_tool/nba/first_basket.py"
  - "nfl_tool/site/nba/first-basket.*"
---
# NBA: First Basket

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## First Basket (`first_basket.py`, `first-basket.*`)

The pieces of the puzzle for users to solve; site look (team banners, logos, headshots, `scaleHsla`
cells, "i" bubbles). **Research only since 2026-11-03** (under Prop Research; the owner: "scrap the
tracking etc. scrap the fair line listed by starters. scrap the scores first % our guess and the
prediction under the tip. scrap the value spot"): no testing banner, record, YTD, Fair column, Scores
First box, tip Prediction row or Value box on the page. The build still makes the tip ratings, Fair
and Value record below (off the page).
- **Any first points count, FTs included, and so does every "shot" count** (Shot Early, 1st Shot, Team
  Share 1st Shot, First Look). "First FG allowed" is field goals only.
- Build (`compute_first_basket`, own try): `seasons[<year>]`, `slates[<year>]` (next 3 nights: starters,
  jumper, fair), `default` (this season).
- Play-by-play: the opening `Jumpball`'s `team_id` = the team that got the ball; its jumper won.
- **Starting fives: the NBA's lineup file** `stats.nba.com/js/data/leaders/00_daily_lineups_<YYYYMMDD>.json`
  (Expected, then Confirmed; today only), read **live** via `/api/nba-lineups?date=` (middleware,
  members only, 60 s cache), asked every minute. Fallbacks: the build's copy (`first_basket.lineups`),
  then our guess. Banner says Confirmed / Expected / Our guess. Matched by team + name (`roster`); a
  starter with no numbers shows "new".
- **Likely starters:** on today's roster, not Out, started half his games, most minutes first.
  **Jumper:** most jumps (`MIN_JUMPS` 2); else the NBA five's center.
- **Prediction** (`tip_ratings`): OPENING tips of THIS season only (no held balls / OT tips;
  `jump_balls`, winner = jumper on the side that got the ball), Bradley-Terry from height
  (`TIP_PER_INCH` 0.15, `TIP_PULL` 3). data.json `first_basket.tip`. No Home/Road tip row.
- **Fair** (`fair_prices`): Scores First (`team_chance`) = Prediction x `TIP_WINNER_SCORES` 0.666 +
  the rest. His share (`first_shares`) = half shots-a-start^0.5, half Team Share 1st Pts steadied
  `TEAM_SHARE_PRIOR` 20, x `BENCH_SHARE` 0.96. **No position-vs-defense** (made it worse). This
  season's players only.
- **Value:** our chance `VALUE_EDGE` 10%+ over the price's (`is_value`); green tag; Value box. **Record**
  `model_history/nba_first_basket/<season>.json` (`first_basket_record`): each game's ten from the
  last pre-tip build, never rewritten, from `FB_RECORD_START` 2026-10-23; `first_basket.record`
  {plays, won, units, games} at the best price across all books. Uses the build's starters.
- **No tags beside starters' names** (Value / Top Option / First Look / Jumper / New removed, the
  owner 2026-10-30: they pushed the numbers away). Player column one fixed width (`.fb-name`, 196 px,
  long names "...") so the numbers sit in the same spot on every game.
- **Layout:** Starters (both teams stacked) left, The Matchup right, tops level (`.fb-side`); stacks
  under 1000 px.
- **The Matchup** (`renderMatchup`, `matchupRows`): one table, road left, home right, stat in the
  middle with an **Edge** pill. Only the owner's rows: The Tip (Jumper + height, Tips Won with his
  opening tips in the hover), Scores First (Scores First, Home/Road, After Winning / Losing Tip), Opening Trips (Avg
  Poss. To Score / Allow), First FG Allowed (PG, SG, SF, PF, C). **No** game counts, league averages,
  guess rows, 1st-quarter margin or seconds rows. Rows 28 px (38 phones), column 380 px. Colors =
  league spreads from the average (`zHeat`, full at 1.5 SD). Targets is retired.
- **Starters:** compact table per team, PG to C (banner: lineup tag): Shot Early / 1st Shot / Scored
  1st / Team Share (1st Shot, 1st Pts) with "x of y", Best. Colored from the first start
  (`MIN_STARTS` 1). The jumper's name shortens, never his height.
- **Prices: Best = SmartStake, then Novig.** `nba_odds.add_first_basket` (`first_basket_market_keys`,
  fallback `basketball_first_points_scorer`) **with `alternate=True`** (books send it as alternates,
  Yes only) into `book_odds[...].props.first_basket`. No book = Novig's `FIRST_BASKET` price, labeled
  Novig, not clickable.
- **Saving:** Best opens the every-book window with `spec.save`; plays in `nfl-tool.nba-plays.v1`
  (`loadNbaPlays` / `saveNbaPlays`, both sync lists), id `nba:fb:<game>:<player>`. Graded from
  `first_basket.results`: his id = win, else loss, none = void (a DNP needs Void by hand).
- **Player Types** (the owner, 2026-11-11; a first table mixing both directions in each row was "confusing",
  he picked from three real-page versions): every starter's letter (`nbaTypeBadge`), and
  **B: in each Starters table, a purple "Vs <OPP> Defense: His Letter" block** (1st Shot / 1st FG allowed
  to his letter, "x of y" games; Open 3 Min = every FG try in the first 3 minutes, FG% and made / tried),
  **Best stays the far-right column**; **C: at the bottom (`#fbt-area`, `fbtVariantC`), each defense against
  EVERY letter**, tonight's other starters named under theirs (the rest faded, still clickable: "if TOR is
  bad vs F and there's no F on the slate, the letters next to it"). Red = allows the most of the 30.
  **Every number opens the games behind it** (`fbtOpen`). Data: season block `type_log` ([game, date,
  offense, defense, first shooter, first FG maker, [[shooter, made]...] opening tries]). About 11 first
  baskets per defense: counts always shown. **Research only: never in Fair or the tip.** Never read
  both directions in one row again.
- Tests: `tests/test_nba_first_basket.py`. Not built: a Summary card, a calibration view.
