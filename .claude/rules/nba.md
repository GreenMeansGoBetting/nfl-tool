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
- Pages (`site/nba/`): `league.html` + `league.js` + `league.css` League Stats Chart (first in the menu;
  its columns, formats and ranks in `league-cols.js`, shared with Matchup Keys); `matchup-keys.html/.js/.css` + `matchup-history.js`
  Matchup Keys (rules in `keys.js`);
  `matchup-sheet.js` (The Matchup, its Summary tab) + `who.js` (who's behind a number) + `matchup.css`;
  `index.html` / `identity.html` only forward to Matchup Keys (Matchup Data retired 2026-11-09); `points` / `threes` / `rebounds` / `assists` `.html` (`data-market`) on `research.js`
  + `sim.css` Prop Research; `assist-spots.html` + `spots.js` Assist Spots (on research.js);
  `best.html` / `game-predictions.html` only forward (retired 2026-11-03);
  `first-basket.html/.js/.css`;
  `shot-charts.html/.js/.css`; `zones.html/.js/.css`; `nba-card.js` player card (+ `shot-chart.js`);
  `promo-tools.html` + `kotc.js` + `kotc.css` King of the Court; `extremes.js`; `types.html/.js/.css` Player Types
  (`shot_types.py`). (Dunk Digest was removed 2026-11-11.)
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
  (`fetch_nba_book_odds(fast=True)`, `carry_previous`: only `FAST_STATS` main lines AND their alt
  ladders fresh (2026-11-10: carried, a moved line's ladder was dropped until the next full build;
  a failed ladder fetch still falls back to that), the rest carried). A refresh still queued after `STUCK_MINUTES` 45
  is cancelled and ignored (2026-11-05: one sat queued 22 h and blocked every press, so the odds stayed
  at the 2:58 am build all day). **Both sides must match to the letter**
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
- **The plays** (`game_candidates`, `pick_plays`): **main line only** (`middle_line` = the card's `main_line`),
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
- Menu: **Prop Research** head, All Props, Points / Threes / Assists / Rebounds pills, then 1st Basket and Shot Charts (no
  UNDER CONSTRUCTION since 2026-11-03). Tabs on the four pages. `RS_MARKETS` = each page's stat.
- Intro box (title + i bubble + one line), day arrows (next `DAYS_AHEAD` 3 slates; off-season = the
  last one), game cards narrow the list, Position menu, **With A Line | Every Player** (rotation
  `ROTATION_MIN` 12+ min, no line = "No Line"; Out / Doubtful players left off).
- Columns (sim-list table rule): Player (playerClick on top; pos, injury pill DTD / Q / D / Out and the two logos under it; names past 170 px end in "..." with the full name on hover; the owner, 2026-11-04: the column was too wide, row height unchanged), Line (the
  books' main line, `nbaCardMainLine`), **Over / Under** (best on My Books; click = every book, and a price there saves the play at that book and price, `bookPlaySaver`; a check mark on a saved side; no check box in the row, the owner 2026-11-04),
  **Avg, Min (Threes: 3PA), Volume** (Points: his shot share on the floor; Threes: share of his shots
  that are threes), season only, **no L5 under them** (the owner, 2026-11-04: cluttered), each colored
  against his position's rotation players (`listNums`, `listPool`; same color as his Form Season tile),
  **Hit Rate - Over Tonight's Line** (L5 / L10 / Season / Home / Away,
  "x of y"), **Opp Allows** (what tonight's opponent gives up a game to his exact position, from every
  player's logs, ranked of 30 from the defense: 30th = gives up the most, red; 8-step rank colors), **Teammates On The Report** (spare
  width, `fitTags`): per 20+ minute teammate on tonight's report, his average in the games that
  teammate missed (`out` in props.json) and the change from games with him; "No" = Out / Doubtful,
  "If No" (dashed) = DTD / Questionable; colored only at `SMALL` 3+ games and a swing of `MK.swing`.
- **Past nights** (the owner, 2026-11-05: "go back days like the other tools and see how things
  did"; every stat page and All Props): day arrows back to opening night + a date box (`dayPicker`);
  the page opens on today's slate (`startDay`). A past night's games = the schedule's + the logs'
  (`pastGames`, score on the card); his line = the saved line history (`lineKey`: `lines` / `lines3`
  / `linesr` / `linesa`); Avg / Min / hit rates / Opp Allows count only games BEFORE that night
  (`logBefore`, `allowed(cut)`); no Over / Under price columns; no research panel (its tabs read the
  whole season, that night included); **Result replaces Teammates On The Report**: an Over / Under /
  Push tile (hit colors) + his number colored like Avg (`resultCell`, sortable); no injury pill. No
  units (the owner).
- **O / U Reads and Volume on past nights are FROZEN at tip** (the owner, 2026-11-05: "lock the info
  that comprises those boxes before that game is played"): today's panel can't be rewound (season
  totals), so `tools/nba_reads_capture.py` opens All Props after every deploy build ("NBA Reads
  record") and every NBA injury refresh (after its publish and live check, "Save the NBA Reads before
  tip"), reads `rsCapture()` for every untipped game, and `reads_record.py` keeps it in
  `model_history/nba_reads/<season>.json` (rewritten until tip, never after); the build copies it into
  props.json `research.frozen` (`frozenOf` / `frozenReads`). Nights before 2026-11-05 show "--". Never
  today's Reads on a past night. Tests: `tests/test_nba_reads_record.py`, research site `PastNights`.
- The card loads `ladders.json` itself (this page doesn't). Tests: `tests/test_nba_research_site.py`.
- **Research panel (Points 2026-11-03; Threes, Rebounds and Assists 2026-11-04; every market)**: a row click (not the name, a price or a tag)
  opens it (`panel`, `PANEL`). **Two sandboxes** (the owner approved the mock-up, 2026-11-03: "a
  standard sandbox area so youd always know how to conform data to it"): two boxes of one size side
  by side, each with tabs (`RS_TABS`: left Form / Scoring / Matchup / Game Script, right Vs The Line /
  Rotation / Teammates; `RSV` keeps the open tab), and **every tab is the same grid** (`.rs-g`: one
  header row, `RS_ROWS` 6 rows, a 112 px label column (Teammates 150, `rs-wide`) + 7 equal columns;
  `gridOf` fills short tabs with blank rows; merge with `rs-s2` / `rs-s3` / `rs-s7`). **Boxes a fixed
  600 px, never stretched**; tabs are separate raised buttons; space above the panel (2026-11-03).
  Blue = him, purple = tonight's defense, green = the read (`readOf`, the two-sided rule; **Over / Under / Even** since 2026-11-04, the owner: "framing it as betting"; rank hovers say "Nth-most" / "Nth-least of 30", `rankWords`), as header
  tiles AND shaded bands behind each column group (`gridOf` `bands`); tiles on the 8-step scale
  (`stepStyle`). **Him = his jersey number** on a jersey in his team's color (`jersey`, props.json
  `num`); the corner key = jersey + "<logo> vs PGs". Short labels (PTS / MIN / FGA / 3PM / FTA / FG%;
  Threes / Mid-Range / Paint / Free Throws). A new research view is a new tab on this grid, never a new shape.
  Form (Season colored vs his position; L10 / L5 vs HIS season, the owner: "trends lately vs long
  term", plain when L10 = his season or the move is tiny; vs DEF Season / L10 / L5 each ranked in its
  window; then **Read** off the two Season tiles; **no +/- columns** (the owner, 2026-11-04: a Read
  instead, so Form is him 3 / defense 3 / read like Scoring); `defenseByPos`), Scoring (share / rank / pts a game vs DEF allowed / rank / pts a game, read;
  `defShares`), Matchup (jersey / rank vs allows / rank, read; five columns `rs-five`; **no average columns**, the owner: misleading),
  Game Script (All Games, his games within `SCRIPT_RANGE` 5 of tonight's spread and total,
  `PACE_RANGE` 2 of the pace, venue, last 10; every number vs his season; under `SMALL` faded;
  **no schedule spots**, the owner: "too niche"), Vs The Line (the last `LINE_DAYS` 15 days a slot each:
  slim bars, OUT = team played without him, OFF = no game; team over date; tonight's dashed line, his
  line that night as dots; **no strip under it**), Rotation (quarter headers carry points a quarter,
  colored; three tall strips season / last 5 / last game in four quarter blocks; nothing under them),
  Teammates (together, shots and points a 36 with / without, change, assists to him).
- **Threes panel** (the owner's Q&A, 2026-11-04; `THREES` in research.js, Points untouched): left
  **Form / Shooting / Shot Map / Game Script**, right **Vs The Line / Ladder / Rotation / Teammates**
  (no Matchup: it repeated Form; the map covers where). A tab with fewer than six rows grows them to
  fill the same box (`gridOf` `fill`, `.rs-fill`), never blank rows. Form: 3PM, 3PA, 3P%, 3PA Rate
  (**no FGA, no minutes**). Shooting = HOW (Catch & Shoot, Pull-Up, Step-Back, Transition, Second
  Chance; no location rows, the map has them; no Assisted, it repeats catch): share / rank / 3PM a game
  vs the defense's share of his position's threes / rank / made a game, read. **Shot Map**: two heat
  maps (shot-chart.js `nbaShotHeatView`, threes only, `MAP_HEX` 2.6 ft, `legend: false`), his and every
  three his position took vs tonight's defense (shots.json); the defense's map is drawn `allowed: true`
  (red = more makes against them, like the Shot Charts page; 2026-11-06), a color key under each map. Game Script columns Games / 3PM / +/- / 3PA / 3P% /
  Over / Hit %. Vs The Line bars read makes / tries, a night with none = a red "0/5" chip. **Ladder**:
  % of games with None / k+ threes, seven columns sliding to sit around tonight's line (start = Over - 3,
  floor 0), the Over column's header green; rows Season, Last 10, Last 5, venue, Spread like tonight,
  **Vs Like <OPP>** (his games vs defenses in the same third for threes made by his position); under
  `SMALL` faded. Rotation quarter headers: 3PM and 3PA a game. Teammates: 3PA / 3PM a 36 with / without,
  change in made, assists on his threes. The list's Min column is **3PA** on this page.
- **Rebounds panel** (the owner's Q&A, 2026-11-04: ten factors, every one placed; `REBS` in research.js):
  left **Form / Rebounding / Miss Zones / Game Script**, right **Vs The Line / Ladder / Rotation /
  Teammates**. Form: REB, DREB, OREB, MIN (minutes stay: the biggest driver of boards). **Rebounding**
  (five columns like Matchup, value / rank each side, read): Defensive Chances (other team's misses a 36
  on the floor vs misses the opponent leaves a game), Defensive Rate (his DREB share vs their OREB rate,
  flipped), Offensive Chances (his team's misses a 36 vs FG% they allow, flipped), Offensive Rate (his
  OREB share vs their DREB rate, flipped), Pace. **Miss Zones** (Shooting's shape): where his defensive
  boards' misses came from (Rim, Paint, Mid-Range, Corner 3, Above-Break 3, Free Throws) vs where the
  opponent misses from, read. A grid, not a court map: a map can't show who grabs the miss. Game Script
  columns MIN and **Chances** (rebounds by anyone while he played, `rcg`). Vs The Line hover splits
  DREB / OREB. Ladder = Threes' (`MK.stat`). Rotation headers REB and OREB a quarter. Teammates: REB a
  36 and his share of the boards with / without, change, **Their REB** (that teammate's own a 36). List
  Volume = his share of the rebounds there to get (`rebShare`). Logs carry `oreb`, `dreb` (props.py).
- **Assists panel** (`ASTS`, 2026-11-04): **no turnovers anywhere** (the owner: "too noisey ... guys
  can turn it over 8 times and still get 12 assists"). Left **Form / Playmaking / Assist Zones / Game
  Script**, right **Vs The Line / Ladder / Rotation / Teammates**. **Form** (the owner, 2026-11-04: only
  the AST row was useful): AST, then **To SG / To SF / ...** (every position but his own): his assists a
  game to that position (Season / L10 / L5, `acg` [.., PG, SG, SF, PF, C]) vs the assisted baskets the
  defense gives up to that position a game (Season / L10 / L5 ranked of 30, `dag`), read
  (`assistPosRows`). No AST / 36, no minutes. **Playmaking** (Rebounding's five columns): Assist Chances (teammates' makes a 36
  on the floor vs FG% the defense allows), Assist Rate (his share of those makes vs the share of makes
  against them that are assisted, summed from `defpos`), Transition (his fast-break assist share vs
  `def_trans_freq`), Pace. **Assist Zones**: where the shots he sets up come from (Rim, Paint,
  Mid-Range, Corner 3, Above-Break 3) vs where the defense gives up assisted makes (`daz`). Game Script
  MIN and Chances (`acg`). **Vs The Line's hover = that night's chances and rate vs his season** (the
  owner's "why did Acuff pass more that game?"). Rotation: AST a quarter only. Teammates: AST a 36 and
  rate with / without, change, **To Him** (his assists to that teammate, `to`). List Volume = his assist
  rate (`astRate`). The owner may want a deeper "why did he pass more" tool later (Zone Matchup style).
- **Reads: O / U** (the owner, 2026-11-04), right of Opp Allows under a green "Reads" band: how many of the
  Read tiles in his panel say Over / Under, "x/y" out of every Read tile on that page (Points 17, Threes 9,
  Rebounds 14, Assists 14; a "--" read counts as neither; Form's MIN row is never a read, `none`), colored by the
  share (`READ_FULL` 0.5 = greenest). Every Read tile goes through `RT`, so the column always equals the panel
  (`readsOf`, cached per player). Form compares him to his position, so a star facing a weak defense leans Over:
  the owner chose that over a 'signature' tag rule after seeing real examples ("luka is facing a weak defense
  thats why he shows").
- **Filters** (`filters.js`, 2026-11-04; the owner picked the fold-open panel from two mock-ups, then "stack things a little
  better ... too much dead space"): a **Filters** button opens a min and a max box for every list number (The Line, His
  Numbers, Defense, Reads, Tonight's Game) and every panel row with a Read (His, His Rank, Defense, Defense Rank: the
  owner wanted the defense as a rank AND its raw number), with its unit (% / raw / rank). Every Read row hands its
  numbers to `RT` (`num`: him / hu / hr / def / du / dr; percents 0-100), kept in `x.reads.nums`. All filters must pass;
  a missing number fails. Columns stacked to one height (`RF_LIST_COLS`, `rfTabColumns`), each column's last box to the
  bottom. Chips in the bar (blue him, purple defense...), Clear. **Save This Screen** = `nfl-tool.nba-screens.v1`
  (synced: sync.js KEYS + the middleware's SYNC_KEYS), a button per screen on its page. All Props: the list numbers
  only plus Points / Threes / Assists / Rebounds toggles. Tests: test_nba_research_site.py `Filters`.
- **All Props** (`all-props.html`, `data-market="all"`, 2026-11-04; the owner: for members who "don't care about
  what stats they are"): every market's rows on one list (`rowsOnAll`), a row a player a stat with a **Stat** pill
  (`STAT_HUE`, the menu's colors; it links to that stat's page), opens sorted by O. Only the columns that mean the
  same for every stat: no Min / 3PA and no Volume (the owner: "if people want to click into the specific category
  they can"). A row click opens that stat's own panel. **`setMarket(m)`** switches everything market-specific
  (MK, THREES / REBS / ASTS, `RS_TABS`, the Teammates tab, `RS_TAB_TIP`, the columns); a stat page calls it once.
  Caches are per market (`ALLOWED`, `LIST_POOL`, `READ_CACHE`), rows carry `mk`, `openKey` = market:game:player,
  and a saved play's key carries its market. A tab on every research page. `fitTags` measures every box in one pass
  (box by box took 4 s on All Props' 1,000+ rows).
- **The list row**: Over / Under show the price + a two-letter book (`spec.short`, `BOOK_CODES` in
  book-odds.js); **Tonight's Game** after Opp Allows: Pace (both teams' average, rank among the 30
  teams' paces), Spread (his team's), Total (`tonightGame`).
- Data: `research.py` -> props.json `research` (own try in `compute_props`): per player `feed`,
  `trans`, `units` (bench unit = `BENCH_UNIT` 2 or fewer starters), `q`, `rot` / `rot5` / `rotn`,
  `rot1`, `q4`, `foul`, `lines`, `pz` (points by zone); threes: `t3` ([made, tried] by `THREE_KINDS`
  catch / pull-up (+ fades) / step-back / transition (the three itself within 8 s of a transition
  possession's start) / second chance (after his team's OREB, same possession), then all), `q3`,
  `feed3`, `w3` (with / without each `with` teammate), `lines3`; rebounds (a chance = a player's
  rebound off a miss while he's on the floor; team rebounds left out, the standard rate count): `rb`
  [def chances, DREB, off chances, OREB, seconds], `rz` (DREB by `MISS_ZONES`), `qr`, `rcg`, `wr`,
  `linesr`; assists (a chance = a teammate's made shot while he's on the floor): `ap` [chances,
  assists, transition assists], `az` (by `ASSIST_ZONES`), `qa`, `acg` {game: [chances, assists, to PG..C]},
  `wa`, `to`, `linesa`; per defense `daz`, `dag` {game: assisted makes by position}; per team `rbt` [games, rebounds off their misses, their OREB, off opponents' misses, their
  DREB, opponents' makes, shots] and `mz` (their rebounded misses by zone); `defpos` / `deffga` (each defense vs
  each position), `def3` (the same 12 numbers allowed to each position); `teams` (by abbreviation), `games` {id: [pace, total, home spread]},
  `spots`. **Line history**: `add_line_history` keeps every player's main line in all four markets
  until tip in `model_history/nba_lines/<season>.json` (from 2026-11-03); older nights come from
  `past_points_lines(season, market)` (the retired projections' `lines_` / `threes_` files, the sim and
  Zone Matchup records); points -> `lines`, threes -> `lines3`. Tests: `tests/test_nba_research.py`.

## Assist Spots (`assist-spots.html` + `spots.js` on research.js, 2026-11-05)

The owner's assist tool after five mock-ups (notes: `docs/assist-spots-notes.md`). Assists = chances
(teammates' makes while he's on the floor) x his share of them.
- **Built on Prop Research, not beside it:** the page loads research.js then spots.js, which swaps
  `setMarket` (its tabs, tips, columns) and `row` through `window`, adds its tabs to `RS_TAB` and its sorts
  to `SORTS`. The list, prices, day arrows, drop-down panel, past nights and **Vs The Line are
  research.js's own** (the owner: "copy that exact one over"). A tab on every research page's tab bar; its menu pill sits
  beside Zone Matchup Targets, not under Prop Research (the owner).
- **Columns:** Player, Line, Over, Under, Avg, Rate (assist rate), Hit Rate L5 / Season, **Reads**: Targets,
  Types, Lineup, Read; **Tonight's Game**: Chances, Volume. Opens sorted by Read (Over, Under, Mixed, No Read).
- **The Read reads every factor** (the owner: "its not taking into account all the info": Draymond's Under
  came off Santos alone while 39% of his assists go to Curry and MIA is the worst vs PGs). Each factor is
  his side x tonight's side, a pull in steps (0.5 Lean, 1 Strong, `SCALE`):
  **Targets** = sum over his top 4 teammates of (share of his assists) x (the defense's assisted baskets a
  game to that teammate's position / the league's - 1), `dag`; **Types** = his mix x (the defense's shots
  of each type a 100 possessions / the league's) - 1, `dfa`; **Lineup** = a teammate Out / Doubtful tonight
  who played 2 of his team's last 3 (new: the line may lag), his share without him minus his season share
  (`wa`, 25+ makes each way). Over / Under when the votes agree and add to 1+, **Mixed** when real pulls go
  both ways, No Read otherwise. Under `SMALL_AST` 20 assists: Targets and Types say Small, no vote.
  **Context only, never a vote:** Chances (pace x makes his team makes and the defense allows: the same for
  everyone in the game, the total prices it) and Volume (team threes above average, mostly off a pass, he
  sets them up, the defense not bottom-10 at allowing threes; the owner: "a yellow VOLUME tag").
  A one-game cold-shooting "bounce-back" was dropped (the owner: "thats like saying someone is due").
- **Defense ranks read from the defense** (the owner: "the defense who is bad should be ranked 30th and
  red"): `dRank` = 30th allows the most, red. **Everywhere since 2026-11-06** ("bad defense is red":
  LAL 4th-most catch-and-shoot threes allowed showed green): every Research panel defense tile (`DT`: drawn
  -s, the Read still takes s = good for him), its rank (`dRank` / `defRank`; rows where more is worse for
  him, like crashing the glass, rank 1st = the most), the Filters' Defense Rank and the list's Opp Allows.
- **Tabs** (the research grid): left Who He Assists (teammates down, types across, counts colored against
  the grid, Total % column, Total row % vs the league, the defense row and Vs Pos purple), Assist Types,
  Game Log (Min, Chances, Share, C&S 3s, AST, that night's Line, Vs Tonight); right The Read (every factor
  a row: Him, Tonight, Pull; the last row the call with its pulls), Vs The Line, Lineup (With / Without
  colored vs his season, If Out, Last 3, Tonight).
- **Data:** research.py `spots_block`: `af`, `ag`, `k3g` per player, `dfa`, `tm` per team (`ASSIST_TYPES`
  k3 / dr / cl / d3 / mid, `assist_type`). **Record:** `spotsCapture()` (tools/nba_reads_capture.py, after
  All Props) keeps every untipped game's reads in `model_history/nba_assist_spots/<season>.json` until tip
  (`reads_record.SPOTS_DIR`); the build copies it into props.json `research.spots_frozen` and a past night
  shows those reads beside the Result.
- **Graded** (the owner, 2026-11-05: "the same grading feature as the player props ... go back and check how
  it performed"; picked both): `spotGraded` grades every saved Over / Under read against his line then with
  his assists that night (Mixed / No Read aren't sides; sat or not final = not counted; a push skipped). A
  past night's Read shows **Hit / Miss** under it (no outline) and the note adds "Reads that night: Over
  w-l, Under w-l" (`spotTally`, a `renderList` wrap). **YTD Model Performance** (`spotYtd`, ytd.js, the
  page loads `../ytd.js`): one market, ledger `[date, pull, won, null, [over|under]]`, W / L only (no
  prices were saved), Min Pull slider 1-3 (pull = the votes that leaned that way, added up).
- Tests: `test_nba_research.py` `test_assist_spots_types`, `test_nba_research_site.py` `AssistSpots`.

## The player card (`nba-card.js`)

- **Every place an NBA page shows a player wraps him with `playerClick(id, inner)`** (ESPN id). And beside his position, his Player Type letter (`nbaTypeBadge(id)`). Pages
  load `../book-odds.js` and `nba-card.js` after their own script; every name in it starts `nbaCard` /
  `NBA_CARD`. Same shell as NFL / NHL (`#player-card-modal`).
- Head + this season's tiles (Games, Min, Pts, Reb, Ast, 3PM, PRA). **Game Log**: this season ONLY
  (`DATA.season`), newest first (Min with "B" off the bench, Pts, Reb, Ast, 3PM, 3PA, FG, FT, PRA,
  Stl, Blk, TO, PF, +/-), shaded against his own games.
- **Odds:** every market in `GMG_NBA_PROP_STATS` (sync.js) at the books' main line (`nbaCardMainLine`
  = zone_matchups.py `main_line` to the letter, used by the card, Prop Research, the line record and the sim:
  the line the most books price on BOTH sides with the Over 25-75% no-vig, ties nearest even then lower;
  else the two-sided line nearest even; else the line most quotes hang. Never the middle of every line
  listed: exchanges and bet365 put side lines in the main market, 2026-11-06 Holiday 3.5 at +400); best Over / Under (`bookPricePill`), a save box each side, "This Season" = games
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

## Suite switch

- The top menu (`addTopMenu`, sync.js) lists each sport's pages (`SPORT_PAGES`).
- **Both suites are open to every member** (`SUITE_SWITCH_PUBLIC = true` -> `html.suite-public`).
  **Never set it back to false unless the owner asks** (`test_the_suite_is_open_to_every_member`).
- NBA / NHL pages are paying members' pages: check them with `tools/check_site.py --only nba` /
  `--only nhl` when chasing a problem there.
- No owner "Update Odds" buttons.

## Player Types (`shot_types.py`, `types.html/.js/.css`, 2026-11-11)

Players typed by HOW they shoot, not position (the owner, after an old "Courtside Pal" chart; "not
all PGs or PFs play the same style"). Audited with the owner before launch: every ESPN label, a
Basketball-Reference comparison, odd vs even games, the owner's eye test.
- **Letters A-K, never names** (A = deepest shooters ... K = rim runners); badges in a rainbow, A red to K
  purple (`ptHue`), never a number tile. 50+ shots (`MIN_SHOTS`); heaves out.
- Mix (`F`): distance, 3PT, catch & shoot (plain / running / bank jumpers: 95-97% assisted), pull-up +
  step-back, fade + turnaround, floater, post / hook (driving hooks too), drive, cut (cutting + plain
  layups / dunks, 82-87% assisted), lob / putback, fast break. Every ESPN label in ONE group (`LABELS`);
  an unknown label fails the step.
- **Ten k-means groups + the owner's split**: the bigs who shoot threes (`bigs_group`) with under 20%
  threes become their own type (I: Sengun, Anthony Davis). 11 / 12 groups split scorers, not bigs.
- **Saved groups** `model_history/nba_shot_types/<season>.json` (mu, sd, centers by letter, split,
  stability, moved). **Redrawn weekly** (`REDRAW_DAYS` 7, the owner: weekly is the longest to wait);
  a redraw keeps letters (nearest old group). Every build re-types players against the saved groups.
- **Borderline** (`fit` 0.5+): two letters "B / E" (the owner). 2026-11-11 odd / even games: 56% kept
  their letter, 85% letter or lean; clear fits 80%, borderline 33%.
- data.json `shot_types` (compute_props, own try): players {name, team, pos, type, lean, fit, border,
  n, mix, avg [games, pts, 3PM]}, `log` (`log_fields`: every night vs his own other-games average), `defense` {teams {abbr: {games, vs {letter: [shots, makes, points, 3PM]}}}, league, team_games}.
- **Page** (menu under Zone Matchup Targets): tabs The 11 Types / Every Player / Defense Vs Type
  (`#types` / `#players` / `#defense`). Tiles on the 8-step scale, the most = green; Defense Vs Type
  ranked from the defense (30th = allows the most, red), Points / Threes Made / Shots a game or FG%,
  under `PT_DEF_MIN` 30 shots faded and unranked. Filtering to a type lists its players then leaners.
- **The letter goes wherever a player's name goes** (the owner, 2026-11-11: useful "across the entire
  site"): `nbaTypeBadge(id)` (nba-card.js; CSS `.pt-letter` / `.pt-badge` in suite.css) beside his
  position: player card, Prop Research list, who.js pop-ups, Zone Matchup Targets. A new place that
  shows an NBA player uses `playerClick` AND `nbaTypeBadge`.
- **Type beside position, never instead**: Prop Research's **Type Matchup** list column (after Opp
  Allows; Points / Threes, All Props for those rows) and panel tab (right box: Points / Threes for his
  type vs tonight's defense, then the latest "Like Him" games), research.js `typeMatch` / `typeTab`,
  Slate Standouts' measuring stick (`TM_MIN` 6), colored like Opp Allows (30th = gives up the most, red).
- **Tonight tab** (first on Player Types): the game carousel (click a game to isolate it, again for all),
  every player on the slate (Out / Doubtful off) with his letter, his PTS / 3PM, and his type's +/- and
  beat-average x / y against tonight's defense (`ptTonightTab`).
- **Matchup Keys: Player Types box** (Overview, under Both Teams; `typeBox`): each defense's
  fingerprint (points over those players' own averages against it, per letter, ranked of the defenses at
  6+ games, 30th = gives up the most, red) and each offense's mix (share of its typed shooting per letter);
  **Type Fit** = the defense weighted by the offense's mix, its parts in the hover (never a hidden score).
- **Shot Fit** tab (research panel, Points / Threes, `shotFitTab`): his top 5 shot kinds (catch, pull-up,
  fade, floater, post, drive, cut, lob) beside the FG% tonight's defense allows on each (every shot it
  faced, typed or not: shot_types `defense.kinds` / `league_kinds`), the league's, +/-, rank of 30 (30th
  = allows the best shooting); under `SF_MIN` 40 shots faded. Fit = points per 10 of his shots over the
  league's, weighted by his mix.
- **Zone Matchup Targets: Type tag** beside every read (`zmTypeTag`, `nbaTypeVs` in nba-card.js): Agrees /
  Disagrees / Too Few (6+ games of his type against that defense, before the night shown). **Information
  only, never a filter or "play" wording** (the owner, 2026-11-11: the tool's whole logic needs a rework
  later; on Oct 28-Nov 10 ZMT was 658-674, -39.5u, threes overs the worst; reads the type disagreed with
  went 94-115, -23.9u; agreed 165-162).
- Not now (the owner, 2026-11-11): lineup-aware splits (off for now, "messy"); letter pairings (wait for
  more minutes together, ~December).
- Next (the owner): one more pass on the live page, then matchups by type or the next type family
  (rebounding / assisting / playmaking). Swap position splits for types only where a replay shows types
  predict better. Tests: `test_nba_shot_types.py`, `test_nba_types_site.py`.

## Slate Standouts (`standouts.html/.js/.css`, 2026-11-11; first in the NBA menu)

The front door (the owner: "see all the mismatches in one place and by category so they dont have to
wade through info on top of info"). A night's slate (day arrows), categories (Points, Threes, Paint &
Mid-Range, Rebounds, Turnovers, Free Throws, Pace & Total; counts on the buttons), Season / Last 10,
**Standouts** (toward more) beside **Tough Spots** (toward less). **Numbers, not picks: no
projections, no line / "priced in" check, no record or tracking** (the owner: "adds undue pressure").
- **Team rows = Matchup Keys' own keys** (`nbaMatchupKeys`, never a copy): offense Edge / Fits = a
  Standout; a defense Edge = a Tough Spot for the offense facing it; Same Style / Trend by direction
  (`SS_LESS`). Its top-10-of-30 cut is Matchup Keys'; change both together or neither. The owner wants
  other tools' game-level angles here too, not only Player Types.
- **Player rows = his type vs tonight's defense over their own averages** (shot_types `log`: each
  night minus his other games' average, leave-one-out; no pull toward the league). The owner's
  cutoffs (`SS_PLAYER`, `SS_HIT_*`, `SS_MIN_GAMES`, picked from a count of each option): **+2.5 points /
  +0.7 threes, beat it 55% of the time (Tough: 45% or less), 6+ games** ("for now": raise the games
  cut as the season fills); he must do it himself (12+ points / 1.5+ threes a game); Out / Doubtful off.
  Tiles: his average, the type's +/- vs that defense (rank of the defenses, 30th = gives up the most,
  red; hover lists the players behind it), beat-average x / y.
- **In each category, players (with their letters) first, then teams** (the owner: not jumbled).
- **Stacked** = a player row and a team row, same game, category and direction (parts shown, never
  blended; hover names the team spot). A team logo / name / the game opens Matchup Keys on that game.
- Tests: `test_nba_standouts_site.py`.

## Basketball-Reference cross-check (`bbref_check.py`, `nba-bbref-check.yml`, 2026-11-11)

- **An alarm, never a source** (no shot types there). Mondays 15:23 UTC: our per-player average
  distance, 3PA share and dunk share (the engine's shots, **heaves out**: theirs leave them out;
  counting them flagged Isaiah Collier, 5 heaves in 67 shots, 2026-11-11) vs Basketball-Reference's season
  shooting page (NBA tracking). Players with the same games in both and 50+ shots; fails (GitHub
  emails) at 3 ft / 8 pts apart, a league match under `MIN_CORR`, or under 20 players matched.
- **One page a week, nothing shown on the site, nothing committed.** Sports Reference's terms: reuse
  with credit is welcome; no competing database, 20 requests a minute, **no feeding their content to
  AI**: don't pull their pages into a Claude session without the owner's say; tests use made-up rows.
- Season (2027) matches deploy.yml's NBA build: change both together. Tests: `tests/test_nba_bbref_check.py`.

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
- **Matchup Keys** (its own page since 2026-11-04, `matchup-keys.html/.js/.css`, menu beside League Stats Chart / Matchup
  Data; the button on the chart was "too hidden"). Every rule in `keys.js`
  (`nbaMatchupKeys`, ONE place). Extreme = top / bottom 10 of 30.
  Types: Edge (one side top 10, the other bottom half; a make rate only for an offense in the top
  half of taking those shots, transition scoring only for one that runs), Fits / Takes Away (how-often:
  offense top 10 vs a defense allowing the most / least), Same Style / Clash (both at one end / opposite
  ends; no Opposite Ends for scoring, turnovers, glass: an Edge says it), Inside Vs Outside (replaces the
  3PA / paint clashes), Trend (combined O/U 6+ decisions, 70%+), Few Falling (volume top 10, makes 10+
  places lower), Not Tested (a weak defense the offense rarely tests).
- **Three groups** (`KEY_GROUP`): Edge = edge + Fits (the offense's) + Takes Away (the defense's),
  written "<TEAM> Offense / Defense: <name>"; Clash = clash + Not Tested + Few Falling; Same Style =
  style + Trend. `lead` puts each topic's strongest key first. The owner's CHA @ WSH read is pinned on
  `tests/fixtures/nba_league_chart_2026-10-30.json`. Owner fear: things omitted or miscounted: audit a
  real slate before changing a rule. **No model points on the keys** (2026-11-03).
- **The page (rebuilt 2026-11-06 in the Points Research look,** sim.css `.rs-sb` / `.rs-g` / `.rs-t` /
  `.rs-tabs`; the owner: the old Edges / Clashes / Same Style stacks were "a mess of info", "it needs to
  be segmented ... this is where BOS have an edge vs this is where CHA is weak vs this is where they are
  both x", "make them like [the player prop drop downs]"). Top: game and the line (spread, total, ML via
  `showOdds`), **Injuries by name** both teams (`playerClick`, Out / DTD; Probable left off; the owner:
  "4 out" hid them), then **four big tab buttons a quarter of the width each** (`MK_TABS`: Overview /
  Categories / Rotations & History / Summary; the owner, 2026-11-06: "large buttons ... easily seen and
  clicked"). Carousel + Season / Last 10 / 5 / 3 (the research boxes' tabs are the same windows); the
  open game is `nba-tool.game.v1`; the tab is a per-device pref. **Matchup Data was retired 2026-11-09**
  (the owner: "add that matchup sheet to a fourth tab called summary ... then i believe we can remove
  matchup data"): the NBA menu has no Matchup Data, the NBA home (`/nba/`, `SPORT_PAGES` home) and
  `identity.html` forward to Matchup Keys.
  - **Every colored box with a player split opens who's behind it** (`who.js` `whoOpen(topic, game)`;
    a member asked for Paint FG% on 2026-11-09, the owner made it every box): both teams' rotation
    players (12+ min, 3+ games) for the topic (`WHO`: scoring, transition, threes, paint, mid,
    turnovers, glass, ft, ballmove; `whoTopic` maps a league-chart key or a Matchup row), top 6 by its
    main number plus the top 3 in its `also`, each number tiled by its place among the league's
    rotation players (turnovers: red = more), his share of the team's total. Pace, totals and records
    open nothing. A tile carries `data-who` (`whoAttr`); the page's click handler opens it before a
    category line's open / close. Numbers only, no calls. Data: props.json (logs, `zones`, `zone_pct`,
    research `trans` / `ap`).
  - **Overview:** road team's **Edges** | **Matchup Summary** | home team's **Edges**, then **Both
    Teams** (Same Style + Trend keys, three columns). Every Edge key shown, strongest first, **the box's
    own team's column first** (the owner: CHA first in CHA's box). **Labels are stat names, never
    phrases** (`MK_LABEL`; the owner: "default to the stat category rather than this arbitrary
    blabber"; "3PA" not "Live Behind The Arc") with an **OFF / DEF tag** (OFF = when that team has the
    ball). Tiles: rank big, value + stat name small, on the rank colors. Clash keys are not headlined:
    a Not Tested shows as a Read in Categories; Few Falling / Opposite Ends aren't shown.
  - **Categories:** a line a category (`MK_CATS`: Scoring Efficiency, Pace & Total, Transition,
    Three-Point Shooting, Paint & Mid-Range, Turnovers, Rebounding, Free Throws): road Off · home Def ·
    **Read** | home Off · road Def · **Read**. Read = `<TEAM> Edge` (logo, team color) / Even / **Not
    Tested** (yellow), from keys.js only (`lineRead`, `pairRead`). Click opens two 600 px research
    boxes, one a direction: label | Off value, rank | Allows value, rank | Read, bands blue / purple /
    green. Pace & Total = the two teams side by side: Pace & Scoring (Pace, Avg Total, Net Rating) and
    Betting Record (O/U, ATS, Avg Margin), Read = Both Fast / Slow / High / Low or the O/U Trend.
    Categories and Rotations & History are **1020 px wide** (the owner: the Categories lines were "too
    wide"); the Overview stays 1260.
  - **Summary** (`matchup-sheet.js`, `matchup.css`): The Matchup, moved from Matchup Data (below); stat
    names and number boxes open who's behind it.
  - **Rotations & History** (`matchup-history.js`, `mhView`; Matchup Data's sections in this look, not a
    link): both Rotations (sortable heads, each number shaded by rank on his own team, Out rows faded),
    **Head To Head** (tabs Season / Quarters / Blowouts & Spots; tonight's spots via extremes.js) beside
    **How They Win / Lose** (a tab a team, in wins vs in losses, 3 biggest swings marked), then both
    teams' **Recent Games** (spread green = covered, total green = over).
- **Matchup Summary card** (`summaryCard`, `MK_SUMMARY`), one width 470 px (two fit the 1160 video
  frame): team banners, "Matchup Summary" + tip time + spread / total; the 7 categories down the
  middle: Scoring Efficiency (ORtg / DRtg), Pace (one tile a team), Three-Point Shooting (3PM), Paint
  Scoring (paint FG%), Turnovers, Rebounding (OREB% / DREB%), Free Throws (FT rate). **Each side reads
  one matchup** (the owner, 2026-11-06: Off and Def of the same team side by side "feels weird"): road
  Off | home Def | category | home Off | road Def. A logo beside the category = the team with an Edge
  in that matchup (hover = the key). **Show All Summaries**: every game of the carousel's day, two a
  row (one screenshot = two games); a game card goes back to that game. Tests:
  `tests/test_nba_matchup_keys.py`.

## The Matchup (`matchup-sheet.js` + `matchup.css`; Matchup Keys' Summary tab)

Matchup Data (`index.html` + `nba.js`, "Matchup Breakdown" before 2026-11-04) was retired 2026-11-09:
its Line, Injuries, Edges, Head To Head, How They Win / Lose, Rotations and Recent Games live on Matchup
Keys (Overview, Rotations & History), The Matchup on the Summary tab.

- **One cell language:** rank of 30 big, number small, shaded red to green by rank (`cellTd`,
  `scaleHsla`), green = good for that team. How-often rows colored too (offense 1st = does it most,
  defense 1st = allows it least). `rankIn` ranks among the season numbers.
- **The Matchup:** `[call][Away Off][Home Def] [label] [Home Off][Away Def][call]`, every row always
  (`M_ROWS`): Pts / Possession, Pace, Transition Share, Transition Pts / Poss; Turnovers, Rebounding
  (OREB% vs the defense's DREB%), Free Throws / Shot; 3-Point Share (no 3P%), Paint Share, Paint FG%,
  Mid-Range Share, Mid-Range FG%, Ball Movement. **Vs Tonight's Types**: the type team gets its trait
  rank (`order`), the other its split ranked among every team that faced the type; shown at
  `EX_MIN_GP` 3+.
- Calls (`rowCall`): matchupCall's rule (0.6 spreads one side, not 0.3 against); transition only for a
  team that runs; a make rate only where the offense shoots at least the league's share; Big Edge =
  sides average 1 spread (types: 6+ pts); how-often rows Fits / Takes Away at 0.7 each.
- Tests: `test_nba_matchup_site.py` (on Matchup Keys' Summary tab; who.js too), `test_nba_identity.py`,
  `test_nba_previews_seasons.py`.

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
- **Leader Trends** (beside Nightly Leaders, the owner 2026-11-10; `renderTrends`, `trendPoints`): an SVG
  scatter, a dot a leader. Tabs **Pregame Rank** (x games that night, y his Pre place, square-root
  scale, not on that night's board = bottom "Off" row) and **Spread & Total** (x his spread, favored
  left; y the total). Dots on one spot merge into a bigger dot with the count; color = Pre on the
  8-step scale; three tiles under each (Top 5 by slate size; Favored 5+ / Within 5 / Underdog 5+), a
  tie half a night each. Hover or tap names the dot; Save image.
- **Ties:** every co-leader counts (own line, Tie tag, starred; Historical Data splits shares, full
  night each in Most nights led; Est Pay's fit leaves out tied payouts).
- **Payouts:** the owner's box (is-owner / localhost) saves Prize Pool + DraftKings' pasted list to
  `/api/court-payouts` (D1 `court_payouts`). **Est Pay** after `FIT_MIN` 6 payouts: log(paid / pool) on
  log(Lead %). Unproven.
- Tests: `test_nba_kotc.py`, `test_nba_kotc_site.py`. Not built: book PRA lines, teammate usage bump,
  pace, Est Pay by slate size.
