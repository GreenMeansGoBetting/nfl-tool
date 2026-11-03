---
paths:
  - "nfl_tool/nba/**"
  - "nfl_tool/site/nba/**"
---
# GMG NBA Suite

The NBA suite inside "GMG Sports Data Suite" (started 2026-10-11, season tipped 2026-10-20).
**A research site since 2026-11-03** (the owner: projections on incomplete info, rest days and late
scratches aren't fair to members): no projections, model plays, edges or ratings on any NBA page.
Pages show real counts beside every book's line; the member draws the conclusion. Don't propose new
NBA projections or picks. The sim and Game Predictions builds still run and grade their records off-site.
This file holds the rules only. The owner's words, dates and replay numbers behind each one are
in `docs/history.md`: "NBA", and "2026-10-29: the NBA rules file before the trim" (the full old text).

## Files

- Build: `nfl_tool/nba/build_nba.py` -> `site/nba/data.json`. `possessions.py`: the engine (every
  possession with the ten on the floor; every new NBA tool reads it). `identity.py`: Team Identity.
  `props.py`: player props data (`nba/props.json`). `sim.py`: the Points / Threes / Rebounds /
  Assists game sim. `positions.py`: PG / SG / SF / PF / C. `shots.py`: shot spots (`nba/shots.json`).
  `zone_matchups.py`: Zone Matchup Targets. `kotc.py`: King of the Court. `first_basket.py`: First
  Basket. `watch.py`: injury / market watch. `nba_report.py`: the NBA's injury report PDF.
  `espn_late.py`: last night's finals from ESPN before hoopR has them.
- Pages (`site/nba/`): `league.html` + `league.js` + `league.css` League Stats Chart (first in the menu);
  `index.html` + `nba.js` + `matchup.css` Matchup Breakdown (`identity.html` only
  forwards to it); `points` / `threes` / `rebounds` / `assists` `.html` (`data-market`) on `research.js`
  + `sim.css` Prop Research; `best.html` / `game-predictions.html` only forward (retired 2026-11-03);
  `first-basket.html/.js/.css`;
  `shot-charts.html/.js/.css`; `zones.html/.js/.css`; `nba-card.js` player card (+ `shot-chart.js`);
  `promo-tools.html` + `kotc.js` + `kotc.css` King of the Court; `extremes.js`; `digest.html/.js/.css`
  Dunk Digest (owner only).
- Records (`model_history/`): `nba_props/sim_<season>.json`, `nba_zones/<season>.json`,
  `nba_first_basket/<season>.json`, `nba_kotc/` (nightly boards, `lines_<season>.json`).

## This season only, no exceptions

- **Every NBA play, projection, tag and pick comes from 2026-27 games only.** 2025-26 is for
  backtests alone (fitting weights, how many games a number needs) and is not on the site at all:
  no season buttons, reference popups, fallbacks or per-player starting points. build_nba.py reads
  only this season's files; `identity_2026.json`, `props_2026.json`, `lines_2026.json` and the
  2025-26 downloads stay for backtests (`test_the_site_never_reads_last_season`).
- **Never suggest last season as a fix.** When a sample is thin, lean on this season's league /
  position numbers and let the replay decide how fast a player's own games take over. Before there
  are enough games for a number, show the data, not a projection.

## Positions (`positions.py`)

- ESPN's box scores say only G / F / C; **ESPN's depth charts** (`site.api.espn.com/.../basketball/
  nba/teams/<1-30>/depthcharts`) give PG / SG / SF / PF / C. A player's position = the spot where he
  ranks highest (tie: first of PG, SG, SF, PF, C).
- `positions.json` keeps every player ever placed; each build adds today's charts (`load`). Re-save:
  `py nfl_tool/nba/positions.py --write`.
- `fetch_file` relabels every `player_box` and `rosters` file (`relabel`); ESPN's group stays in
  `espn_group`. Never on a chart: G with 4.5+ assists a 36 = PG, F with 6.5+ rebounds a 36 = PF; a
  roster row with no stats: SG / SF / C. Injuries take the table's position.
- Tests: `tests/test_nba_positions.py`.

## The engine (`possessions.py`)

The foundation every NBA tool reads instead of raw play-by-play. `Season(pbp, box)` gives
`possessions` (offense / defense, `o1..o5` / `d1..d5`, start type make / miss / steal / dead_to /
period, `t0`, `secs`, `margin`, points, shots, FT, TO, OREB, `first_secs`), `actions` (every shot,
FT, TO, rebound and foul with both fives; shots carry `dist`, `zone` rim / short / mid / corner3 /
above3, `kind2` catch / pullup / stepback / fade / drive / cut / post / floater / putback / lob, the
assister and blocker; turnovers the stealer) and `stints`. Health check:
`py nfl_tool/nba/possessions.py --season 2026 --data-dir data/nba` (about a minute).
- **Lineups:** ESPN has every sub but not quarter starters. A player who acts (or is subbed out)
  before being subbed in started it; a silent full quarter is filled from the box score. Technical
  fouls and ejections don't count.
- **ESPN's team_id is sometimes the wrong side:** a play's team comes from its player's box-score
  team, points from the scoreboard's change; a player with no box-score id gets his team from his plays.
- **All-Star sides left out:** a team needs half the games of the most-played team (at most 20).
- Corner 3 = |y| 21.5+ and |x| 33+.
- Tests: `tests/test_nba_possessions.py`.

## Team Identity (`identity.py`; shown on Matchup Breakdown)

- `team_identity`, `season_block`, called by `compute_identity` (its own try: failure = `identity:
  null`). Output `identity`: `default` (this season) and `seasons[<year>]` (`label`, `team_games`,
  `teams{abbr: off_* / def_* / game script}`, `league{key: avg, sd}`). `def_<key>` = what the team's
  OPPONENTS did against it (a test pins it).
- **Re-save the backtest file after changing a formula:**
  `py nfl_tool/nba/identity.py --season 2026 --data-dir data/nba --write`.
- Numbers: pace, seconds a possession, transition (shot or TO within 8 s of a DREB or steal) share
  and points, half-court points, shot share and make rate by zone, 3-point share, assisted makes,
  pull-up / step-back / fade share, catch-and-shoot share, TO rate, steals' share, OREB rate, FT a
  shot; game script (up / down 15+ in the 4th, starters on the floor then and in close 4ths, net
  points a 100 by quarter); `paint_share` / `paint_pct`, `ball_move`, `q<n>_ppq`, `wl` (the `WL_KEYS`
  numbers over wins / losses); each extremes type carries `order`.
- **Matchup Extremes** (`matchup_extremes`, season_block `extremes`): 18 `TYPES` (top / bottom third
  in one identity number: fast, slow, high 3s, rim, mid-range, corner 3, line, glass, transition,
  turnover-prone, pull-up / iso, ball movement, one-star, deep bench; facing defenses: ball-hawk,
  foulers, rim protection, take away 3s). Per team-game: points, 3PM, FTA, TO a 100, pace. Split =
  average vs the type minus vs everyone, shown minus the league's split, colored past 6 pts / 3 3PM /
  6 FTA / 3 TOV (pace never). **Under `EX_MIN_GP` 3 games: faded, never colored.** Not-faced types
  fold into one "Not Faced Yet" line; no "--" cells. Not built: big lineups / small-ball.
- **Schedule Spots** (`situation_tags`, `schedule_spots`, season_block `spots` + `tonight`): B2B, 3 in
  4, 4 in 6, rest edge 2+ days, layoff 3+, road trip game 1 / 4+, first home game after a trip, home
  stand 4+, altitude DEN / UTAH, after a 20+ loss / win, national TV or NBA Cup. Dropped by the owner:
  OT the night before, body clock, miles, close loss, revenge, same opponent twice, star out.
- Tests: `tests/test_nba_identity.py`.

## Player props data (`props.py`)

- **Pure data, no projection** until replayed against this season's real lines. **Prices:
  SmartStake**, Novig only where SmartStake has no price.
- `season_block`, `on_rosters`, called by `compute_props`, written to **`site/nba/props.json`**
  (gitignored, in `fetch_live_data.py` SUITES): `fields`, `players[<espn id>]` (name, team, pos, `log`,
  `share`, `zones`, `kinds`, `assisted`, `with[<teammate>]` on / off splits for `MIN_TOGETHER` 20+),
  `out[<team>][<game id>]`. Backtest copy: `props_2026.json` (re-save:
  `py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write`).
- **SmartStake** (`fetch_nba_book_odds`): points key from `/v1/markets` (`nba_prop_market_keys`: the
  stat alone, never a combo / quarter / half / first scorer), fallback `basketball_player_points`.
  data.json `book_odds` (players by ESPN id, matched by name + team) and `book_odds_debug`; locks at
  tip. `version.json` `nba.book_odds`, `book_markets`, `props`.
- Retired: the line-anchored projections (Points / Threes, before the sim); records stay.
- Research scripts (findings in their headers): `tools/backtest/nba_spots.py` (situational spots;
  national TV, revenge, lookahead, streaks, time zones, altitude measured zero),
  `tools/backtest/nba_points.py` (last-5 minutes overshoot is real; referees added nothing).
- Tests: `tests/test_nba_props.py`.

## The game sim (`sim.py`): Points, Threes, Rebounds, Assists

Every game played 10,000 times, possession by possession.
- **Start from the line** (`nudge_to_line`, build_nba.py `compute_sim`, all `STATS`): each player's
  ladders, medians and mean move by (1 - `LINE_NUDGE` 0.35) x (main line - sim median), so his median
  sits at line + 0.35 x (sim median - line); shape kept. MEDIAN, not mean. `shift_ladder` spreads each
  whole number over +-0.5. No main line = the sim's own. props.json keeps `sim_med`, `line`, `nudge`;
  `med` / `lad` are nudged so page, plays and record agree. Banner: **Testing / Model Being Tested
  Against Its Record** (break-even, not proven).
- **One game** (`simulate`, numpy, ~1 s): pace sets possessions; each goes to one of the five (minutes
  x plays a minute); a zone shot, FT trip or TO by his mix tilted to what the defense allows
  (`DEF_MIX_W` 0.5); makes at his zone rate x the defense there x dials x `HOME_EDGE` 2.2 x `LEVEL`;
  OREBs from both sides' rates. Blowouts after 3 quarters bench starters (`GARBAGE_*`), `LEAD_DRAG`
  from the 2nd, ties play OT. Night noise: minutes (`SHORT_NIGHT` 4%), shooting, pace.
- **Early season:** `season_inputs` from the engine; rates lean on his position's THIS-season numbers
  (`K_*`). Shot mix / shots a minute trust his games fast (`K_MIX` 5, `K_USE` 10); make rates slow
  (`K_ZONE`, threes 200 shots). `--prior-season` exists in the replay only.
- **Blowout minutes** (`blowout_starts`, `minutes_before`, `role_min`): a game whose lead hit 20 and
  stayed (from the 2nd half) counts minutes before then, scaled to 48, **only ever down**.
- **Minutes:** season^0.365 x last-5^0.635, fit to 240 (`fill_minutes`, cap 40). Out leaves the
  rotation; his minutes go to everyone in proportion. A fringe player who missed the last 3 sits.
- **Chance to play** (`play_chance`, `PLAY_CHANCE`: Day-To-Day 0.45, Questionable 0.55, Doubtful 0.15,
  Probable 0.95; bench x share of games played, `SHOWS_K` 2; usual starters off the report and the
  posted five always play). A sat game gives his minutes away; his own numbers count only games he plays.
- **Starting fives** (NBA lineups file, `lineup_starters`, accent fallback): a listed starter gets at
  least `STARTER_TRUST` 0.8 of usual starter minutes. **Once the five is posted, a usual starter on the
  report but not Out who isn't in it sits** (`hurt`).
- **Injuries: ESPN's live list** (`live_injuries`; hoopR's daily file is the fallback).
- **The injury watch:** every build writes data.json `watch` (version.json `nba.watch`: untipped
  teams, fingerprints `inj` and `lu`, `watch.py`) and `timing`. The Worker gmg-nhl-timer
  (`workers/nhl-timer/watch.js`, every minute around the clock) computes the same fingerprints and on a
  change presses `nba-refresh.yml` (members-and-hosting.md), built with `--fast-odds`
  (`fetch_nba_book_odds(fast=True)`, `carry_previous`: only `FAST_STATS` main lines fresh, ladders
  carried, a ladder dropped when its main line moved). **Both sides must match to the letter**
  (`tests/test_nba_watch.py`).
- **Graded overnight, every play by 6 am ET** (the owner, 2026-10-31, after three mornings ungraded:
  hoopR lands about 7:30 am). `espn_late.patch` (in `fetch_file`): every game final on ESPN's scoreboard
  (last 2 Eastern dates) that hoopR's file lacks is added from ESPN's summary as hoopR's own rows
  (schedule marked final, player / team box, pbp; identical in every column read,
  `tests/test_nba_espn_late.py`); hoopR's rows win once they land. Current season only; a failure
  leaves hoopR's frame. **Grading presses** (source `grade`): a game in `watch.grade` (`watch.waiting`:
  last two nights + tonight, not final at build) now final on ESPN's scoreboard, at once (again after
  `FINAL_MINUTES` 10); the first minute after midnight ET with no build since (`watch.day` old), so
  last night moves to Results; `watch.ungraded` > 0 hourly (`GRADE_MINUTES`); hoopR's `player_box`
  newer than the last build (`newBoxScores`).
- **No paid sources** (X's API for Underdog was turned down).
- **Mark Out** (owner only, `.sim-markout` on Matchup View rows): saves `/api/nba-outs` (D1 `nba_outs`)
  and presses the refresh (Pages secret `DISPATCH_TOKEN` = the timer's `NHL_TRIGGER_TOKEN`, copied by
  deploy.yml); `fetch_marked_out`, `add_marked_out` make him Out whatever ESPN says; row reads
  "Out (GMG)" with an Undo.
- **Waiting On Market:** data.json `market_watch` (`watch.py`, carried via `fetch_previous`): when each
  `STAR_MINUTES` 20+ player was first seen Out, when each main line was first seen at its number. A
  candidate whose line is older than a teammate's ruling goes to props.json `sim_held` (`held_by`, at
  most `HOLD_MINUTES` 40): not a play, not saved, grayed with a Waiting On Market tag. `watch.recheck`
  (`RECHECK_MINUTES` 10 / 25 / 40) presses source `recheck`. Tests: test_nba_watch.py
  `WaitingOnMarket`, test_nba_sim.py `Build`.
- **NBA official injury report** (`nba_report.py`): PDF every 15 min at
  `ak-static.cms.nba.com/referee/injury/Injury-Report_<YYYY-MM-DD>_<hh>_<mm><AM|PM>.pdf` (Eastern),
  read with `pypdf` by column position (later pages carry the first page's columns), names matched to
  rotation players (`players_of`). `add_report`: newer of ESPN (`updated`) and the report wins;
  Available removes; Probable adds no one; owner marks last. The watch HEADs the newest slot each
  minute and presses source `report` once per new report; that run's first step
  (`nba_report.py --changed`) stops unless tonight's rows changed (`watch.rep`, `rep_at`). Test:
  `tests/test_nba_report.py`.
- **The dials** (`SCHEDULE_DIALS`, `LAST_GAME_DIALS`, sizes from nba_spots.py, [own pts, other pts]):
  Rest Edge, Back-To-Back, 3 In 4, 4 In 6; Letdown: OT Win, Overtime Legs, Letdown: Close Win, Off A
  20+ Win. One of each kind a team, in that order; turned into a make-rate change (/ `PTS_BASE` 113).
- **Replay:** `tools/backtest/nba_sim.py` (`--injury-report`; findings in its header). The closing
  lines still beat the sim: a play is where they disagree by enough, and the record says if it's an edge.
- **props.json** (compute_sim, its own try: failure empties the pages, never the logs): `sim` {game:
  margin / total, `scripts` (away 10+ / close / home 10+), `base` (no dials, `SIM_BASE_N`), `dials`,
  `starters`, `out`, `lineup`, `misses`, `players` {id: team, min, pts / fg3m / reb / ast med by
  script, mean, `lad` = [first k, permille of k or more...], `plays`, `glass`}}, `sim_plays`,
  `sim_record`, `sim_meta` (dial names, MIN_EDGE, `line_nudge`, `miss_pg`).
- **Prices:** every book's main line and every rung (`smartstake.add_ladder`: `points_alt`,
  `threes_alt`, `rebounds_alt`, `assists_alt`); alt ladders live in `nba/ladders.json`.
- **The plays** (`game_candidates`, `pick_plays`): **main line only** (the middle of the books'),
  Over and Under at the best price (`PRICE_RANGE` -250 to +400) vs the sim's chance; **every one with
  `MIN_EDGE` 4+ is a play, no cap**; 2+ games this season and 18+ sim minutes. **Every play is
  Strong** (old "top" rows count as Strong). A rung is never the play: it shows as the **Ladder** tag.
  Script tags: **Script-Proof**, **Chaos**, **Needs A Close Game**.
- **The record:** `sim_<season>.json` {game: {date, points / threes / rebounds / assists: [play]}}
  (`PLAY_FIELDS`), rewritten until tip, never after; graded at the best price across every book, 1u;
  push or sat not graded. Split tags: top / strong, proof / chaos / close, over / under, main / alt, dials.
- **Past nights:** props.json `sim_past` (`past_plays`); day arrows step back to Results, and a date
  box (`dayPicker`) jumps to any night (2026-11-03). The page opens on tonight's slate.
- **Rebounds:** every missed shot (and missed last FT, `ft_oreb` / `ft_dreb`) is a board, shooting team
  at its OREB rate else the defense. Credited share to players (`oreb_player` / `dreb_player`) on the
  floor by floor time x boards a minute (`K_REB` 60 toward his POSITION) x `reb_tilt` (what tonight's
  opponent gives up at his exact position, shrunk by `K_POS_REB` 400). `REB_LEVEL` 0.965.
- **Assists:** a make is assisted at the shooter's assisted share (`K_AST_SHOT`) x the defense's
  (`K_DEF_AST`); goes to a teammate on the floor, never the shooter, by his assists a minute (`K_AST`
  25 toward position). One draw a team a period; each player keeps his own rate.
- Nights: `SD_REB` / `SD_AST` 0.4. Watch: players the sim has at 9+ boards (and 25+ points) run high.

### Prop Research pages (`research.js` + `sim.css`, 2026-11-03; replaced the sim boards and Best Plays)

- The owner, 2026-11-03: "click into betting categories, like assists and rebounds, and get
  information and data that relates to those categories and see available bets and lines".
  **No model on the page:** no Edge, Fair, Rating, projection, plays, record or YTD tracker.
- Menu: **Prop Research** head, Points / Threes / Assists / Rebounds pills, then First Basket (no
  UNDER CONSTRUCTION since 2026-11-03). Tabs on the four pages. `RS_MARKETS` = each page's stat.
- Intro box (title + i bubble + one line), day arrows (next `DAYS_AHEAD` 3 slates; off-season = the
  last one), game cards narrow the list, Position menu, **With A Line | Every Player** (rotation
  `ROTATION_MIN` 12+ min, no line = "No Line"; Out / Doubtful players left off).
- Columns (sim-list table rule): Player (playerClick, pos, injury pill DTD / Q / D / Out), Line (middle
  of the books'), **Over / Under** (best on My Books via `nbaCardSide`: click = every book, box saves),
  Avg and Min (season, L5 under), **Hit Rate - Over Tonight's Line** (L5 / L10 / Season / Home / Away,
  "x of y"), **Opp Allows** (what tonight's opponent gives up a game to his exact position, from every
  player's logs, ranked of 30, 1st = most, 8-step rank colors), **Teammates On The Report** (spare
  width, `fitTags`): per 20+ minute teammate on tonight's report, his average in the games that
  teammate missed (`out` in props.json) and the change from games with him; "No" = Out / Doubtful,
  "If No" (dashed) = DTD / Questionable; colored only at `SMALL` 3+ games and a swing of `MK.swing`.
- The card loads `ladders.json` itself (this page doesn't). Tests: `tests/test_nba_research_site.py`.
- **Research panel (Points only so far, 2026-11-03)**: a row click (not the name, a price or a tag)
  opens a dashboard under it (`panel`, `PANEL`); the owner: "Think of this like a dashboard ... 1-2
  minutes to look at a player ... digestable, compact, color coded and give context". **Built from
  the League Stats Chart grid** (`grid()`, `tileTd()`, `stepStyle` on the 8-step scale; styles.md
  "One Look"); each row of boxes zoomed to fill the width (`fitPanel`). Rows: **Rotation** (48
  minute cells by how often he's on the floor, points by quarter, close vs not-close 4th minutes);
  **Points Vs The Line** (last 15 as touching bars vs tonight's dashed line, his line that night as a
  line of dots, green = cleared), **Recent Form** (Him and `logo DEF Vs <pos>s` side by side: Season /
  L5 / +/- for points, minutes (his only), shots, free throws, FG %; the defense's colored by its rank
  of 30, `defenseByPos`), **How He Scores** (shot-type bar, names inside; Him Share / Rank beside `logo DEF Vs
  <pos>s` Allowed / Rank for shot share, assisted makes, FT and transition shares, `defShares`; then
  Where His Points Come From: his and the defense's 3PT / MID / PAINT (rim + short) / FT bars, each
  part on the 8-step scale, `stackBar`; the owner picked bars over a grid, 2026-11-03); then **Teammates On The Floor** (face + "F. Last"; Time Together, His Shots / 36 then His
  Points / 36, each With / Without / Change, With and Without both colored vs his usual rate, Assists
  To Him), **Matchup Angles** (his face vs `logo DEF`; Allowed / Rank toggle `RSV`; More / Fewer only
  by the two-sided rule), **Tonight's Game Script** (tonight's spread / total / pace in the corner;
  rows = his games within `SCRIPT_RANGE` 5 of tonight's spread and total either way, pace
  `PACE_RANGE` 2, tonight's schedule spots, beside All His Games; under `SMALL` faded). Turned down:
  a key-defender tile, a hit-rate ladder (maybe later).
- Data: `research.py` -> props.json `research` (own try in `compute_props`): per player `feed`,
  `trans`, `units` (bench unit = `BENCH_UNIT` 2 or fewer starters), `q`, `rot` / `rot5` / `rotn`,
  `q4`, `foul`, `lines`, `pz` (points by zone); `defpos` / `deffga` (each defense vs each position); `teams` (by abbreviation), `games` {id: [pace, total, home spread]},
  `spots`. **Line history**: `add_line_history` keeps every player's main line in all four markets
  until tip in `model_history/nba_lines/<season>.json` (from 2026-11-03); older nights come from
  `past_points_lines` (the retired projections' lines file, the sim and Zone Matchup records). Tests: `tests/test_nba_research.py`.

## The player card (`nba-card.js`)

- **Every place an NBA page shows a player wraps him with `playerClick(id, inner)`** (ESPN id). Pages
  load `../book-odds.js` and `nba-card.js` after their own script; every name in it starts `nbaCard` /
  `NBA_CARD`. Same shell as NFL / NHL (`#player-card-modal`).
- Head + this season's tiles (Games, Min, Pts, Reb, Ast, 3PM, PRA). **Game Log**: this season ONLY
  (`DATA.season`), newest first (Min with "B" off the bench, Pts, Reb, Ast, 3PM, 3PA, FG, FT, PRA,
  Stl, Blk, TO, PF, +/-), shaded against his own games.
- **Odds:** every market in `GMG_NBA_PROP_STATS` (sync.js) at the line most books hang (ties lower,
  `nbaCardMainLine`); best Over / Under (`bookPricePill`), a save box each side, "This Season" = games
  over that line. First Basket too. Saves `{id: nba:<stat>:<game>:<player>, ...}` at the best price;
  Over and Under share the id. **Show Alt Lines** (button beside the note, the owner 2026-11-02): every
  other line a book prices (main market off-lines + the `_alt` ladder) as an "Alt" row under its
  market, best price + save box each side (a rung's own id `...:<side><line>`), "This Season" at that
  line. Off-sim pages fetch `ladders.json` the first time it opens (`nbaCardLadders`).
- `LOG_FIELDS` (props.py): new fields go after the first eleven (`BOX_EXTRA`).
- Markets (`NBA_PROP_MARKETS`): points, rebounds, assists, threes, pra, pr, pa, ra, steals, blocks,
  stocks, turnovers; asked only when listed (`nba_listed_markets`, `max_pages=60`). No yes / no or fouls.
- Grading (my-plays.js `gradeNbaPlay`, `gmgNbaStatValue`): box score without him = Void; none yet = wait.
- **Shot Chart** (`shot-chart.js`, `nbaShotView(id)`, names `nbaShot` / `NBA_SHOT`, loaded before
  nba-card.js) reads **`shots.json`** (`shots.py`, own try; gitignored, in fetch_live_data.py):
  `games`, `teams`, `players[<id>]` = [x, y, made, three, game index, flags (1 = 1st qtr / 2 = first 3
  min), kind (1 self / 2 catch / 3 drive-cut-rim), team, defense], `who`, `league`. Teams from the
  **box-score** team (never ESPN's play `team_id`); All-Star sides out. **x below 25 = shooter's
  left**; heaves 35+ ft and FTs out; basket at the top. 12 zones; Heat Map hexagons 1.6 ft (size
  capped at 92nd pct, color = make rate within 3.5 ft vs league). Color pulled toward the league by
  `NBA_SHOT_PRIOR` 6 shots. Filters: Season / L10 / L5, 2PT / 3PT, kind, 1st Qtr / First 3 Min.
- **Shot Charts page** (`shc-*` classes; `sc-*` is the NFL card's): a shooter vs a defense (address
  `#p=<id>&d=<TEAM>`), day strip with each team a button + roster buttons, dropdowns kept. Defense
  side drawn `{allowed: true}` (**red = allows more than the league**). Zone By Zone table with a
  **Call**: Target / Tough when one side is 2.5+ pts from the league and the other isn't 0.75+ the
  other way, zones with 5%+ of his shots and 5+ tries. Its global `DATA` is data.json.
- Tests: `test_nba_player_card_site.py`, `test_my_plays_site.py` (NbaPlays), `test_nba_shot_charts_site.py`,
  `test_nba_shots.py`.

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
- Page (menu under Shot Charts, New tag via `tag` in SPORT_PAGES): **Best & Worst Spots** (top 15,
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

## The owner's open list

- **Alt-line ladder only with real alt prices** (SmartStake `alternate=true`), narrow.
- **Rotation chart:** when a player subs in / out, who he plays with, production by combo (stints).
- **Things to watch** per game: a few conclusions from Team Identity.

## Full-game model: Game Predictions (built 2026-10-30 at the owner's ask, UNPROVEN)

No replayed model (pace, opponent-adjusted, lineup ratings; `tools/backtest/nba_games.py`) beat
DraftKings' closing line. On 2026-10-30 the owner asked for one anyway ("we have a lot of ingredients
... with no recipes"; fair odds for spread, total, moneyline beside the real lines). It sits under
UNDER CONSTRUCTION, and the owner was told it is unproven until its own graded record says otherwise.
- `predict.py`: League Stats Chart numbers -> points. Each number = average + (offense - avg) +
  (what the defense allows - avg), each pulled toward average by `SHRINK` (games; three-point making
  slow, shot mix fast). Rows a 100 possessions: Threes / The Paint / Mid-Range (shot mix vs the zone's
  worth + makes), Turnovers, Offensive Glass, Free Throws (trips + FT%), Everything Else (real rating
  minus the unshrunk rows, shrunk hard), then x possessions (both paces vs average), Home Court 2.
  **Transition and ball movement are not rows**: they are how the shots and turnovers happen (counting
  them again double counts). On 2026-10-30 the rows tracked real ratings at r 0.92 (test pins > 0.85).
  Shot mix alone moves almost nothing (a three, a paint shot and a mid shot are worth about the same
  league-wide); makes, turnovers, glass and free throws carry the points. Fair chances: normal curve,
  `MARGIN_SD` 12, `TOTAL_SD` 18. It knows nothing of injuries (said in the page's i).
- Build: `compute_predictions` (own try) -> data.json `predictions` {upcoming: {window: {game id}},
  record, ledger}: the next 3 nights' untipped games, every chart window. Record
  `model_history/nba_predictions/<season>.json`: season-window prediction + lines, rewritten until tip,
  graded on the final; YTD ledger per market = the model's side (`predict.plays`: spread / total by
  chance, ML by edge vs price), value = edge vs the book price, push left out; tags fav / dog (minus line
  or price), home / away, over / under.
- **Pages retired 2026-11-03** (research only; `game-predictions.html` forwards to the League Stats
  Chart; the page code is in git history). The old page, for reference: **Card =
  League-Stats-Chart grids (`pvGrid`, one width 640), ONE header row each** (the owner, 2026-10-30:
  "more structured and symmetrical"; a band over sub-labels = "two different weird stacks"). Top:
  **Big "Work In Progress" warning** (the owner's words). Card: **GMG Score + Injury Report** side by
  side (ESPN list, worst first, `playerClick`); then a row a team, **Book Spread / Total / ML | GMG
  Spread / Total / ML** = GMG's OWN numbers (our spread, our total, fair ML; Over on the road row,
  Under on the home row), shaded green / red by our fair price AT THE BOOK'S LINE vs the book's
  (both in the hover, **no percent under a price**); then the **Point Breakdown, always open**. No
  separate Spread / Total boxes (they repeat the GMG columns). Tests: `tests/test_nba_predictions.py`.

## Dunk Digest (`digest.html/.js/.css`, owner only, 2026-11-02)

The owner's daily video card (YouTube viewers asked for a "Dinger Digest" for the NBA). **Just
data: no leans, no picks, no tracking** (the owner). Menu: first in the NBA list with `owner: true`
(sync.js adds `owner-only`); the page hides `.dd-app` unless `is-owner` / `local-dev`.
- **Five games a card, each 1160 x 980** (the Summary card size); a row a team, a thick line between
  games. Columns: Team, **Line** (favorite's row = spread, underdog's row = total; "both sides is
  redundant"), **Pace** (rank of 30, Fast / Average / Slow thirds), **Points / Threes / Rebounds /
  Assists**, **First Basket**, **Notes**.
- **Stat cells = position chips, the player's last name under each** (the owner's ask; a YouTube
  comment's "SG 3s vs this team" idea). Each likely starter (First Basket slate's five) vs what
  tonight's defense allows his position a minute (props.json logs, steadied with 10 games of an average
  defense): green = defense 1+ league spread generous and he isn't 0.3 below his position at it; red =
  the mirror. **Defense-led on purpose** (a star alone would light every night). Strongest 2 shown,
  the rest fold into "+N" (hover lists them). 0.6 spreads lit about half of every cell (2026-11-02 audit).
- **First Basket:** the slate's `fair` (Scores 1st, jumper's tip chance) and the starter with the most
  team first shots ("x of y" starts). **Notes:** short schedule spots (`DD_SPOT_SHORT`), Out players
  with 25+ minutes a game (2 named a team, "+N"), then the game's 2 strongest Matchup Keys (keys.js)
  written as plain ranks ("DEN: 3rd-most threes made; MIA: most threes allowed"). The owner: "just
  state facts and dont get cute". A crowded box steps its text down (`fitNotes`), then drops its
  weakest key.
- Tests: `tests/test_nba_digest_site.py`.

## Suite switch

- The top menu (`addTopMenu`, sync.js) lists each sport's pages (`SPORT_PAGES`).
- **Both suites are open to every member** (`SUITE_SWITCH_PUBLIC = true` -> `html.suite-public`).
  **Never set it back to false unless the owner asks** (`test_the_suite_is_open_to_every_member`).
- NBA / NHL pages are paying members' pages: check them with `tools/check_site.py --only nba` /
  `--only nhl` when chasing a problem there.
- No owner "Update Odds" buttons.

## Data: sportsdataverse / hoopR

- Release assets at `sportsdataverse/sportsdataverse-data` (tags `espn_nba_*`, named by the year the
  season ENDS: 2027 = 2026-27): pbp, team / player box scores, schedules, rosters, depth charts,
  injuries (daily), `nba_stats_*`. Parquet only (`pyarrow`). A season's files 404 until its first game.
- **Not usable:** `cdn.nba.com` / stats.nba.com (403). ESPN's own API (`site.api.espn.com/.../
  basketball/nba/scoreboard`, `summary`) works: `espn_late.py` grades last night from it.
- **Novig** (`events?league=NBA`, `EventMarkets_Query`): matched by nickname + start time; only
  `OPEN_PREGAME`; a tipped game keeps the last pre-tip lines (`apply_lines`).

## Build

- `nfl_tool/nba/build_nba.py --season 2027 --out nfl_tool/site/nba/data.json` (deploy.yml "Build NBA
  data", `continue-on-error`). Local: `--cached --data-dir data/nba`.
- Output: `teams`, `team_stats` (`off_*` / `def_*`), `recent_games`, `players` (12-man rotations),
  `injuries`, `schedule` (yesterday to 14 days, Novig lines), `novig_debug`. data.json is written compact.
- Team keys are ESPN's (NY, GS, SA, NO, UTAH, WSH). `date` / `time` are Eastern on the real clock
  (`eastern()`, zoneinfo); pages show `start_utc` in the member's own time zone (sync.js
  `gmgGameTime`). ESPN's `turnover_points` is points GIVEN UP: swapped on purpose. Only the 30 real
  teams count.

## League Stats Chart (`league.html` + `league.js` + `league.css`, 2026-10-30)

All 30 teams down the left, numbers across the top (the owner's Q&A, no mockup). NHL, then NFL get
the same framework next ("once we have the framework down").
- Build: `league_chart` (build_nba.py, own try) -> data.json `league_chart` {season, 10, 5, 3: {team:
  games, pace, net, margin, total, ats / ou [won, lost, push], o_* / d_*}}: box scores per window
  (`compute_team_stats` on each team's last n rows; `d_reb` = its own defensive rebound rate), the
  engine for paint / mid / transition / ball movement (identity season_block `recent`, `RECENT_KEYS`,
  last n games by date), ATS / O/U vs King of the Court's lines at tip (`ats_records`). No 3P%.
- Page: Opening Drive grid look (`.od-grid`, `.od-tile`): Offense, Defense (Allowed), Game & Betting.
  **Every stat column one width** (`COL_W` 46, the owner: "I JUST WANT COLUMNS ALL equal"), two-line
  abbreviated heads, full names in the hover. **Whole numbers only**; exact number + rank in the hover.
  8-step rank colors (`RANK_SCALE` copied; no common.js), ranked over all 30 even when filtered.
  **Green = good for that team; the most of a how-often number is green** (fastest pace, most 3PA);
  defense: allowing the least is green (forced TOV, DREB: the most).
- Season / Last 10 / 5 / 3, Show Rank, Today's Teams Only (the carousel's day; off by default); header
  click = best first, again worst first (opens on Net Rating; **nothing remembered**). A game card
  lights its two teams up on top; again = back. Team cell = logo on its color, no name / record ("compact
  and punchy"); click = its game in Matchup Breakdown. A picked game's two teams light up; every
  other row goes grayscale ("too busy with all the colors"). **No outline on any tile** ("i hate it").
  Tests: `tests/test_nba_league_chart.py`.
- **Matchup Keys** (button, 2026-10-30; the owner: "HERES ALL THE DATA - then ... HERES WHAT MATTERS
  TONIGHT"): every rule in `keys.js` (`nbaMatchupKeys`, ONE place; Biggest Edges on Matchup Breakdown is
  to read the same keys next, the owner dislikes its two-numbers-a-cell look). Extreme = top / bottom 10
  of 30. Types: Edge (one side top 10, the other bottom half; a make rate only for an offense in the top
  half of taking those shots, transition scoring only for one that runs), Fits / Takes Away (how-often:
  offense top 10 vs a defense allowing the most / least), Same Style / Clash (both at one end / opposite
  ends; no Opposite Ends for scoring, turnovers, glass: an Edge says it), Inside Vs Outside (replaces the
  3PA / paint clashes), Trend (combined O/U 6+ decisions, 70%+), Few Falling (volume top 10, makes 10+
  places lower), Not Tested (a weak defense the offense rarely tests). **One card a topic** (`lead`, the
  strongest), the rest under More Keys, never dropped. Cards = the chart's own tiles. The 2026-10-30 audit
  (7-25 keys a game, the glass told three ways) is why; the owner's CHA @ WSH read is pinned on
  `tests/fixtures/nba_league_chart_2026-10-30.json`. Owner fear: things omitted or miscounted: audit a
  real slate (keys, More, near misses at 12) before changing a rule.
- **No model points on the keys** since 2026-11-03 (the Points Ledger / Model Vs Book and the chips
  were Game Predictions'); cards keep keys.js's own order.

## Matchup Breakdown (`index.html` + `nba.js` + `matchup.css`)

- **One cell language:** rank of 30 big, number small, shaded red to green by rank (`cellTd`,
  `scaleHsla`), green = good for that team. How-often rows colored too (offense 1st = does it most,
  defense 1st = allows it least). `rankIn` ranks among the season numbers.
- **Layout:** two anchored columns, **a fixed 960 / 780 px** (never sized by the night's content):
  left = The Line + Injuries, Biggest Edges, Head To Head, Rotations; right = How They Win / Lose, The
  Matchup; Recent Games across the bottom. Long names shorten with "...". **The Line = four tiles in
  one row, Injuries full width under it**, each team a tinted box under its banner, two columns inside
  past 4 players. **Head To Head's three parts in one row**, each its own shaded panel (blue / purple /
  amber) with its name on top. **Every team box (Edges, Win / Lose, Rotation, Recent) is tinted in its
  team color** (`teamBox`); The Matchup's halves are shaded by the team with the ball
  (`shadeMatchup`, measured after drawing); every label full text color, never gray. Below 1860 px the
  columns stack (`test_long_content_never_drops_the_right_column`). Labels far-left in team-vs-team
  tables; **The Matchup keeps its label in the middle** with calls on the outside; no "Has The Ball" /
  "Call" heads; group headers centered.
- Sections: The Line + Injuries; **Biggest Edges** (Offense then Defense, up to 3 each); **How They
  Win / Lose** (`WL_ROWS`, 3 biggest swings marked, "No Losses Yet"); **Head To Head** (Season, Points
  Per Quarter with the margin big and rank small, Blowout Data + Tonight's Spots); **Rotations**
  (sortable); **Recent Games** (Spread / Total at tip via `add_recent_lines`).
- **The Matchup:** `[call][Away Off][Home Def] [label] [Home Off][Away Def][call]`, every row always
  (`M_ROWS`): Pts / Possession, Pace, Transition Share, Transition Pts / Poss; Turnovers, Rebounding
  (OREB% vs the defense's DREB%), Free Throws / Shot; 3-Point Share (no 3P%), Paint Share, Paint FG%,
  Mid-Range Share, Mid-Range FG%, Ball Movement. **Vs Tonight's Types**: the type team gets its trait
  rank (`order`), the other its split ranked among every team that faced the type; shown at
  `EX_MIN_GP` 3+.
- Calls (`rowCall`): matchupCall's rule (0.6 spreads one side, not 0.3 against); transition only for a
  team that runs; a make rate only where the offense shoots at least the league's share; Big Edge =
  sides average 1 spread (types: 6+ pts); how-often rows Fits / Takes Away at 0.7 each.
- Does NOT load common.js (style.css, suite.css, sync.js). The NHL reuses suite.css's `.nba-two`,
  `.nba-box`, `.nba-app`.
- Tests: `test_nba_matchup_site.py`, `test_nba_identity.py`, `test_nba_previews_seasons.py`.

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
- **Prices: Best = SmartStake, then Novig.** `smartstake.add_first_basket` (`first_basket_market_keys`,
  fallback `basketball_first_points_scorer`) **with `alternate=True`** (books send it as alternates,
  Yes only) into `book_odds[...].props.first_basket`. No book = Novig's `FIRST_BASKET` price, labeled
  Novig, not clickable.
- **Saving:** Best opens the every-book window with `spec.save`; plays in `nfl-tool.nba-plays.v1`
  (`loadNbaPlays` / `saveNbaPlays`, both sync lists), id `nba:fb:<game>:<player>`. Graded from
  `first_basket.results`: his id = win, else loss, none = void (a DNP needs Void by hand).
- Tests: `tests/test_nba_first_basket.py`. Not built: a Summary card, a calibration view.

## King of the Court (Promo Tools; `kotc.py`, `promo-tools.html` + `kotc.js` + `kotc.css`)

DraftKings' promo on the night's most PRA.
- Build (`compute_kotc`, own try): `seasons[<this season>]` (`league`, `defense`, `players`, `nights`,
  `summary`), `slates` (next 3 nights), `default`, `past` (`past_nights`: pregame board + the night's 40
  best, with `rank` / `lead` / `proj`), `weights`, `thresholds`, `record`.
- This season only (no toggle, no `PRIOR_GAMES` seed). A player needs min(`MIN_GAMES` 3, half his
  team's games rounded up).
- **Buckets cumulative** (40+ ... 60+). Score is built but **not shown**; Opp Top = the other
  defense's `star` (most PRA by one opponent, per game).
- Positions PG-C on the board, vs Pos and the defense board; position number = PRA per 48 allowed,
  steadied with 10 games (`pos_f`). **The projection's matchup still reads G / F / C** (`grp`,
  `grp_f`): **ask the owner before switching** (`py tools/backtest/nba_kotc.py --five-matchup`).
- Players sit on today's roster-file team.
- **Projection** (`project`, `WEIGHTS`): half season, half last 10; x `pos_f`; x (total / league
  total)^0.2. **Lead %** (`lead_chances`): 6,000 slate runs, sd 4 + 0.22 x proj, ties split. Out players
  stay grayed with no chance. Blowouts and B2B are tags only (0 in the number). Replay:
  `py tools/backtest/nba_kotc.py`.
- Lines: `lines_2026.json` (backtest); this season's Novig line at tip in `nba_kotc/lines_<season>.json`.
- **Record** (`kotc_record`): each night's top 60 by Lead % from the last build before the first tip,
  never rewritten; Nightly Leaders show "Pre n". NBA builds run every 6 hours, so a board can be 6 hours old.
- **Historical Data** (`summary`): four tiles, one label each, no subtext (AVG Winning PRA, Winners Team
  Favored, Winners AVG Game Total, Winner in Top 5); winning PRA by slate size; total / spread mix;
  positions; most nights led. This season only.
- **The page:** night arrows (past and slate), Save image; **player board and defense board side by
  side**, Nightly Leaders and payouts below. Player board: top 25, Show all; Lead %, Proj, Avg,
  buckets, Opp, Opp Top, vs Pos, Total, Spread, Est Pay; B2B / blowout tags; **no L10, no "from" tag**.
  Finished night: Pre, PRA, P / R / A, Lead %, Proj, Opp, Paid; winners starred, DNP last. Defense
  board: red = bad defense; Hide Teams Not Playing; default sort Top Opp; Targets = the other team's
  top 3 by Lead %.
- **Ties:** every co-leader counts (own line, Tie tag, starred; Historical Data splits shares, full
  night each in Most nights led; Est Pay's fit leaves out tied payouts).
- **Payouts:** the owner's box (is-owner / localhost) saves Prize Pool + DraftKings' pasted list to
  `/api/court-payouts` (D1 `court_payouts`). **Est Pay** after `FIT_MIN` 6 payouts: log(paid / pool) on
  log(Lead %). Unproven.
- Tests: `test_nba_kotc.py`, `test_nba_kotc_site.py`. Not built: book PRA lines, teammate usage bump,
  pace, Est Pay by slate size.
