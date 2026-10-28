---
paths:
  - "nfl_tool/nba/**"
  - "nfl_tool/site/nba/**"
---
# GMG NBA Suite

Started 2026-10-11; the 2026-27 season tips off 2026-10-20. The user wants the NBA version of the
site on the same website, reached from a suite dropdown. The brand is "GMG Sports Data Suite";
NFL and NBA are suites inside it. More background: `docs/history.md`, "NBA".

## Files (moved here from CLAUDE.md, 2026-10-25)

- Build: `nfl_tool/nba/build_nba.py` -> `site/nba/data.json`. `possessions.py`: the engine (every
  possession with the ten on the floor; every new NBA tool reads it). `identity.py`: Team Identity.
  `props.py`: player props data (`nba/props.json`). `sim.py`: the Points / Threes game sim (every
  game 10,000 times, tonight's plays, the record). `positions.py`: PG / SG / SF / PF / C from ESPN's
  depth charts. `shots.py`: this season's shot spots (`nba/shots.json`). `kotc.py`: King of the
  Court. `first_basket.py`: First Basket.
- Pages (`site/nba/`): `index.html` + `nba.js` + `matchup.css` Matchup Breakdown (Game Previews and Team
  Identity merged 2026-10-28; `identity.html` only forwards to it);
  `points.html` / `threes.html` + `points.js` / `threes.js` on `sim-board.js` + `sim.css` (Player
  View list + Matchup View game board); `best.html/.js` NBA Best Plays (both markets by edge, same
  sim-board.js); `first-basket.html/.js`; `shot-charts.html/.js` (a shooter vs a defense);
  `nba-card.js` the player card (`playerClick(id)`: game log, every market's odds with save boxes,
  Shot Chart from `shot-chart.js`); `promo-tools.html` + `kotc.js` King of the Court.
- Records: `model_history/nba_kotc/` (nightly boards, tip-off lines), `nba_props/sim_<season>.json`
  (Points and Threes plays at tip, graded).

## This season decides (the owner, 2026-10-20)

**Every NBA play, projection, tag and pick comes from 2026-27 games only.** 2025-26 is used for
backtests (fitting weights, measuring how many games a number needs before it means anything)
and **is not on the site at all since 2026-10-23** (the owner, once every team had played: "i do
not want flawed data entering this seasons numbers"): no season buttons' 2025-26, no reference
popups, no fallback while this season is young. build_nba.py reads only this season's files;
`identity_2026.json`, `props_2026.json`, `lines_2026.json` and the 2025-26 downloads stay for the
backtests (`test_the_site_never_reads_last_season` pins it). Before this season has enough games for a
number, show the data, not a projection. The owner: "A team with a new starting lineup and players
in and out (take boston - no brown add george - completely different) changes everything!"
- **No exceptions since 2026-10-27.** The game sim's per-player starting point from last season
  (2026-10-25 to 10-27, `sim_prior_2026.json`, deleted) read Toumani Camara (17 threes in 2 games, a
  new role) and Damian Lillard (missed 2025-26, new team, so an average guard) as unders. The owner:
  "stop using last seasons data i've told you 10000 times its not relevant". **Never suggest last
  season as a fix again**; when a young sample is thin, lean on this season's league / position
  numbers and let the replay pick how fast a player's own games take over.
- King of the Court was the one exception for its first week; it went this-season-only on
  2026-10-22 (the owner: "turn off 2025-2026 data because by next week, we will have every team
  with data for this season").

## Positions: PG / SG / SF / PF / C (`nfl_tool/nba/positions.py`, 2026-10-21)

The owner: "Guards are drastically different roles and its unacceptable to not have PG vs SG
established." ESPN's box scores and roster files say only G / F / C; **ESPN's depth charts**
(`site.api.espn.com/.../basketball/nba/teams/<1-30>/depthcharts`, same player ids) list every
rostered player under the five spots, often several. A player's position = the spot where he
ranks highest (tie: first of PG, SG, SF, PF, C); Pritchard 2nd at PG, 3rd at SG = PG.
- `positions.json` keeps every player ever placed (departed players keep theirs for last
  season); each build adds today's charts on top (`load`). Re-save: `py nfl_tool/nba/positions.py --write`.
- `fetch_file` in build_nba.py relabels every `player_box` and `rosters` file (`relabel`), so
  every NBA tool sees the five; ESPN's G / F / C stays in `espn_group`. Players on no chart ever
  (7.6% of 2025-26 minutes): G with 4.5+ assists a 36 = PG (82% right), F with 6.5+ rebounds a
  36 = PF (65%); a roster row with no stats: SG / SF / C. Injuries take the table's position.
- Last season's numbers use today's depth-chart spots (a player's role may have changed).
- Tests: `tests/test_nba_positions.py`.

## The engine (`nfl_tool/nba/possessions.py`, 2026-10-20)

The foundation every new NBA tool reads instead of the raw play-by-play. `Season(pbp, box)`
gives three tables: `possessions` (offense / defense, the five on the floor for each `o1..o5` /
`d1..d5`, start type make / miss / steal / dead_to / period, `t0`, `secs`, `margin`, points,
shots, free throws, turnovers, offensive rebounds, `first_secs`), `actions` (every shot, free
throw, turnover, rebound and foul with both fives; shots carry `dist`, `zone` rim / short / mid /
corner3 / above3, `kind2` catch / pullup / stepback / fade / drive / cut / post / floater /
putback / lob, the assister and the blocker; turnovers the stealer) and `stints` (each five's
time together). `py nfl_tool/nba/possessions.py --season 2026 --data-dir data/nba` prints the
health check (about a minute).

- **Lineups:** ESPN has every sub but not who starts a quarter. A player who does something (or
  is subbed out) before being subbed in started it; a quarter a player plays all of silently is
  filled from the box score (the teammate furthest above his rebuilt minutes). Technical fouls
  and ejections don't count (bench players get them).
- **ESPN's team_id is sometimes the wrong side** (401810560 gave CHI 9 points too many): a play's
  team comes from its player's box-score team, and points from the scoreboard's change. A player
  with no id in the box score (401810150) gets his team from his own plays.
- **All-Star sides** are left out: a team needs half the games of the most-played team (at most
  20), so opening week still counts.
- 2025-26 health: 1,230 games, 99.5 possessions a team-game, minutes within 1 of the box score
  99.99% (all within 2), team points match 2,459 of 2,460 (401810102: ESPN's play-by-play is
  missing plays). Corner 3 = |y| 21.5+ and |x| 33+, a quarter of all threes (the NBA's split).
- Read by Team Identity (below, shown on Matchup Breakdown); First Basket still counts its own possessions.
- What it answered first (the owner's "when will a guy like Peyton Pritchard shoot more"):
  Pritchard took 20.2% of Boston's shots with Jaylen Brown on the floor, 28.2% without.
- Tests: `tests/test_nba_possessions.py` (two real games in `tests/fixtures/nba_*_games.csv.gz`
  plus a hand-made one).

## Team Identity (built 2026-10-20)

How each team plays, both sides of every matchup. The owner on the mockup: "This almost feels like
a 'game preview' of sorts. for now, keep it as its own tab but i think eventually we will merge
these two pages into one page."

- **Build:** `nfl_tool/nba/identity.py` (`team_identity`, `season_block`) on the engine, called by
  `compute_identity` in build_nba.py (its own try: a failure leaves `identity: null`). Output
  `identity`: `default` (this season once the middle team has `THIS_SEASON_DEFAULT_AT` games, like
  every NBA page) and `seasons[<year>]` (`label`, `team_games`, `teams{abbr: off_* / def_* / game
  script}`, `league{key: avg, sd}`). `def_<key>` = what the team's OPPONENTS did against it, so
  one team's offense in a game is the other's defense (a test pins it).
- **Last season is saved for the backtests** (not on the site since 2026-10-23):
  `nfl_tool/nba/identity_2026.json`. **Re-save it after changing a formula:**
  `py nfl_tool/nba/identity.py --season 2026 --data-dir data/nba --write`. This season is rebuilt
  every build from the play-by-play First Basket has just downloaded.
- **Numbers:** pace (possessions a 48), seconds a possession, transition (a shot or turnover within
  8 s of a defensive board or a steal) share and points, half-court points, shot share and make rate
  by zone, 3-point share, assisted makes, pull-up / step-back / fade share, catch-and-shoot share,
  turnover rate, steals' share of turnovers, offensive rebound rate, free throws a shot; game
  script: share of games up / down 15+ in the 4th and the night's starters still on the floor then
  (and in 4th quarters within 5), net points a 100 by quarter.
- **Numbers added 2026-10-28 for Matchup Breakdown:** `paint_share` / `paint_pct` (rim + short paint
  together), `ball_move` (makes assisted and catch-and-shoot share, averaged), `q<n>_ppq` (net points a
  game in each quarter), season_block `wl` {team: nw, nl, w / l: the `WL_KEYS` numbers over its wins /
  its losses}; each extremes type carries `order` (every team, most of the trait first).
- **The page is Matchup Breakdown since 2026-10-28** (below, "Matchup Breakdown"). Team Identity's
  own pages (2026-10-20 tags; 2026-10-26 Verdict with an edge count, Key / Every Stat, Every Type &
  Spot) are gone; the owner: "8 edges vs one" hid how big each edge was.
- **Matchup Extremes** (2026-10-26; now feeds The Verdict and Tonight's Types & Spots, full tables folded; the owner: "find the black and
  white of these teams", how a team does against a TYPE of opponent is "our bread and butter",
  relevant every night; UI left to the owner to adjust): `identity.matchup_extremes` (in
  `season_block` as `extremes`). 18 `TYPES` (top / bottom third of the 30 in one identity number:
  fast, slow, high 3s, rim, mid-range, corner 3, line, glass, transition, turnover-prone, pull-up /
  iso, ball movement, one-star (`star_share`), deep bench (`bench_share`, shots by non-starters);
  facing defenses: ball-hawk, foulers, rim protection, take away 3s). Per team-game (`game_rows`):
  points, 3PM, FTA, turnovers a 100 and pace. A team's split = its average against the type minus
  against everyone (offense types: what those opponents did to its defense); the page shows split
  minus the league's split, colored past 6 pts / 3 3PM / 6 FTA / 3 TOV a 100 (pace never), GP beside
  it, tonight's opponent's types first with a Tonight tag. **Readability pass (2026-10-26,** the owner:
  "so unclear as to what the hell this is even trying to say"): each block's header row names its own
  columns ("WSH Defense Vs These Offenses": Pts Allowed / 3s Allowed / FTs Allowed / TOs Forced;
  offense: Pts Scored / 3s Made...), a **Strength / Weak Spot** tag when the points cell is colored,
  **under `EX_MIN_GP` 3 games faded and never colored** (1-game cells were colored), types not faced
  yet (tonight's too, bold) fold into one "Not Faced Yet" line; no "--" cells (the owner: "it clutters it"). Matchup Breakdown shows tonight's types as rows of
  The Matchup (`exCell` in `site/nba/extremes.js`). Not built: big lineups / small-ball (need heights).
- **Schedule Spots** (2026-10-26, the owner's 13; second to the types): `identity.situation_tags`
  (from the season schedule file alone: B2B, 3 in 4, 4 in 6, rest edge 2+ days, layoff 3+ days, road
  trip game 1 / 4+, first home game after a trip, home stand 4+, altitude at DEN / UTAH, after a 20+
  loss / win, national TV or NBA Cup) and `schedule_spots` (Pts, Opp Pts a 100, pace: in the spot
  minus overall, next to the league's); season_block `spots` (+ `tonight` {game id: {team: keys}} for
  the next 15 days). `compute_identity` passes the schedule. Shown in Matchup Breakdown's Head To Head
  (Tonight's Spots, 3+ games). Dropped by the
  owner: OT the night before, body clock, miles, close loss, revenge, same opponent twice, star out.
- Tests: `tests/test_nba_identity.py`.

## Player props data (built 2026-10-20)

The owner's plan, approved in words (no mockup): Points first, then rebounds / assists / 3s on the
same skeleton. **Pure data, no projection** until a projection is replayed against this season's
real lines. **Prices: SmartStake** (the owner: "Use smartstake because they have the best odds
options"), Novig only where SmartStake has no price.

- **Build:** `nfl_tool/nba/props.py` (`season_block`, `on_rosters`), called by `compute_props` in
  build_nba.py, written to **`site/nba/props.json`** (its own file: every player's game log; in
  `.gitignore` and `fetch_live_data.py` SUITES). `seasons[<year>]`: `fields` (the log's columns),
  `players[<espn id>]` (name, team, pos, `log` rows, `share` = his share of his team's shots
  while on the floor, `zones`, `kinds` self / catch / drive / other, `assisted`, `with[<teammate>]`
  = [min on, pts on, shots on, min off, pts off, shots off], teammates with `MIN_TOGETHER` 20+
  minutes together), `out[<team>][<game id>]` = [[id, rest / injury / coach]]. This season only
  (`default` is always it). 2025-26 is saved in `nfl_tool/nba/props_2026.json` for the backtests
  (re-save after a formula change: `py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write`).
- 2025-26 check: Pritchard 16.1 points a 36 with Jaylen Brown on the floor, 24.1 with him off.
- **SmartStake NBA** (`fetch_nba_book_odds`, smartstake.py): the points key is looked up in
  `/v1/markets` (`nba_prop_market_keys`: a player market for the stat alone, never a combo,
  quarter, half or first scorer), falling back to `basketball_player_points`; the player card's
  other markets are added from `NBA_PROP_MARKETS` when listed (the player card, below). data.json
  `book_odds` (same shape as the NFL / NHL, players by ESPN id, matched by name + team on
  today's rosters) and `book_odds_debug`; locks at tip like every price. The deploy's NBA step
  has `SMARTSTAKE_API_KEY`. `version.json` `nba.book_odds` = players with a points price (or the
  reason), `book_markets`, `props` = players per season.
- **Retired 2026-10-24: the line-anchored projections** (Points from 2026-10-20, Threes from
  2026-10-23: the books' line moved at most halfway toward ours, the props board, the testing
  banner, `lines_` / `threes_<season>.json`). The owner, after a night of 170 plays down 50 units:
  "I am sick of taking the vegas line and just basing our picks off that ... I want to 'start over'
  with both points and threes." Their records stay in model_history; the replays below stay.
- **Situational spots (2026-10-24):** `tools/backtest/nba_spots.py` measures 31 schedule /
  last-game / streak / lineup spots on ten past seasons against each team's normal and 2025-26's
  spreads and totals (findings in its header). Real ones (rest, back-to-backs, OT, close-win
  letdown) are 1-3 points and mostly priced; the sim's dials take their sizes from it. National TV,
  revenge, lookahead, streaks, time zones and altitude measured zero.
- **Factor research (2026-10-23):** `tools/backtest/nba_points.py` (findings in its header): last-5
  minutes overshoot (a dip bounces back) is real and is in the sim's minutes; referee crews added
  nothing.
- Tests: `tests/test_nba_props.py`.

## Points and Threes: the game sim (`nfl_tool/nba/sim.py`, 2026-10-24)

The owner: "I just dont want to mimic the vegas line again and be back where we started." Every
game is played 10,000 times, possession by possession; **the books' line is never an input**, only
the price a play is judged against. Mockup approved 2026-10-24 (Tonight's Plays + Game Board).
- **One game** (`simulate`, numpy, all 10,000 at once, ~1 s a game): the teams' pace sets the
  possessions; each goes to one of the five on the floor (his minutes x his plays a minute); the
  play is a zone shot (rim / short / mid / corner 3 / above 3), a trip to the line or a turnover, by
  his mix tilted toward what this defense allows (`DEF_MIX_W` 0.5, both sides); it goes in at his
  zone make rate x what this defense allows there x the dials x home court (`HOME_EDGE` 2.2) x
  `LEVEL`; a miss can come back (offensive rebound: his team's rate x what the defense allows,
  against the league). After 3 quarters a blowout sends the starters to the bench (`GARBAGE_*`);
  from the 2nd quarter a lead shrinks a little (`LEAD_DRAG`: the team ahead eases off; real margins
  swing less than independent possessions would). Ties play overtime. Nights: minutes (wider for
  bench players, `SHORT_NIGHT` 4% an early exit), shooting, the game's pace and shooting.
- **Early season (this season only since 2026-10-27):** `season_inputs` from the engine; a player's
  rates lean on his position's numbers THIS season (`K_*`). Shot mix and shots a minute trust his own
  games fast (`K_MIX` 5 plays, `K_USE` 10 minutes: Camara's 17 threes in 2 games read as a shooter);
  make rates stay slow (`K_ZONE`, threes 200 shots). Replayed on 2025-26's opening month with no
  prior: threes miss 0.912 -> 0.896, points 4.65 -> 4.58 vs 40 / 60. `--prior-season` stays in the
  replay only.
- **Blowout minutes** (`blowout_starts`, `minutes_before`, `role_min`; the owner, 2026-10-27, Derrick
  White's 18 minutes in a 35-point win): a game whose lead hit 20 and stayed there in regulation (from
  the 2nd half) counts a player's minutes before then, scaled to 48 (`role_minutes`), **only ever
  down**: garbage-time minutes aren't a role. The owner, same day, on BOS-BKN: the sim's total was 3
  over the line yet every player but one read under; it gave 14-15 players a team minutes every night
  (Garza, Harper, Conley: blowout-only minutes), about 21 of Boston's 113 points. With it: Tatum 32.6
  -> 35.1 minutes, 23.6 -> 25.4 points, same total. Replay (this season, `--injury-report`): starters'
  points 15.2 -> 15.6 (real 15.7), points miss 4.74 -> 4.66. Raising a pulled starter (`BLOWOUT_UP` 1,
  the first version) overshot: starters 30.4-30.7 minutes vs 29.9 on 2025-26's opening month.
- **Minutes:** season^0.365 x last-5^0.635 (the overshoot), fit to 240 (`fill_minutes`: too many,
  the small roles give up the most; too few, everyone up in proportion, cap 40). **Out** (the
  injury report) leaves the rotation; the 2025-26 replay preferred handing his minutes to everyone
  in proportion over his own position first (minutes miss 4.8 vs 5.1-6.3). A fringe player who
  missed the team's last 3 games sits. **Chance to play (2026-10-27,** the owner: 80% of plays were
  unders): the sim had given full minutes to players who then sat (about 13 a team a night: Day-To-Day
  stars, rest nights, fringe bench), so everyone else read low; graded 10/24-26, unders the sim called
  62% hit 49%. Now each player plays in only some of the 10,000 games (`play_chance`, `PLAY_CHANCE`:
  Day-To-Day 0.45, measured 42% on this season's morning reports; Questionable 0.55, Doubtful 0.15,
  Probable 0.95; a bench player x his share of the team's games played, `SHOWS_K` 2; a usual starter
  off the report and anyone in the posted five always). A game he sits gives his minutes to the rest;
  his own numbers (props.json `plays` = his chance, min, med, ladder) count only the games he plays
  (books void a no-show). Replay `tools/backtest/nba_sim.py --injury-report` (Out = the morning's
  ESPN snapshot, not who really sat) on this season's first 5 nights: points -0.34 -> -0.03 a player,
  threes -0.13 -> -0.09, starters' minutes 28.7 -> 29.5 (real 29.9). **Starting fives:** the NBA's lineups file (First Basket's
  copies, `lineup_starters`, names matched with an accent fallback): a listed starter plays at
  least `STARTER_TRUST` 0.8 of his team's usual starter minutes (the owner: "a roleplayer who has 10
  minutes per game but tonight is starting"; the replay's fill-in starters played 25.5: no floor
  gave 19.9, 0.9 gave 28.2, 0.8 gives 25.9). **Once the five is posted, a usual starter (half his
  games) on the injury report but not Out (Questionable / Doubtful / Day-To-Day) who isn't in it sits
  too** (`hurt`, 2026-10-25: Embiid Questionable with Bona in the posted five at the noon build got 30
  bench minutes, and LeBron / Brown / Edgecombe all read big unders; ESPN ruled him Out 40 minutes later).
- **Injuries: ESPN's live list** (`live_injuries`, build_nba.py; the hoopR file is a daily snapshot,
  the fallback). The owner, 2026-10-24: ESPN still had LeBron Questionable an hour after Underdog
  reported him out, "that is not going to cut it".
- **The injury watch (2026-10-25,** the owner: "Within 5 minutes of a player being ruled out for
  their team, sims rerun"). Every build writes data.json `watch` (version.json `nba.watch`:
  tonight's untipped teams, fingerprints of ESPN's statuses `inj` and the NBA's posted fives `lu`,
  `nfl_tool/nba/watch.py`) and `timing` (seconds per part). The Cloudflare Worker gmg-nhl-timer
  (`workers/nhl-timer/watch.js`, every minute 8 am to 1 am ET) works out the same fingerprints and
  on a change presses `.github/workflows/nba-refresh.yml` (members-and-hosting.md). The refresh builds
  with `--fast-odds` (smartstake `fetch_nba_book_odds(fast=True)`, `carry_previous`): only Points /
  Threes main lines fresh, every other market and the ladders from the live build, a player's ladder
  dropped when his main line moved. SmartStake gives 10 pages a minute: the full odds were 216 of the
  build's 275 seconds on 10-25. The two sides
  must match to the letter (`tests/test_nba_watch.py`). **Grading (2026-10-26):** the box scores land about 7:35 am ET
  and nothing rebuilt the NBA until the day's injury news (10-25's plays sat ungraded all morning;
  GitHub's 6-hour cron skipped 06:17 and 12:17). `watch.ungraded` (build_nba.py `ungraded`: the last
  two nights' plays still waiting on a box score) above 0 makes the watch press nba-refresh.yml with
  source `grade`, at most once an hour (`GRADE_MINUTES`), from 8 am ET. Paid sources were turned down (the owner:
  "i dont want to pay": X's API for Underdog's posts). **Mark Out** (the owner's, 2026-10-25): a
  button on every Matchup View row (owner only, `.sim-markout`) saves `/api/nba-outs` (D1
  `nba_outs`, middleware) and presses nba-refresh.yml (Pages secret `DISPATCH_TOKEN` = the timer's
  `NHL_TRIGGER_TOKEN`, copied by deploy.yml); the build reads the night's list with its key
  (`fetch_marked_out`, `add_marked_out`: Out whatever ESPN says, `marked`), and the Out Tonight row
  reads "Out (GMG)" with an Undo.
- **The NBA's official injury report** (`nfl_tool/nba/nba_report.py`, 2026-10-25): a PDF every 15
  minutes at `ak-static.cms.nba.com/referee/injury/Injury-Report_<YYYY-MM-DD>_<hh>_<mm><AM|PM>.pdf`
  (Eastern); on 10-25 its 1:00 pm report had Embiid Out 8 minutes before ESPN. Read with `pypdf` by
  column position (the team and the name share a line; later pages have no header, the first page's
  columns carry), names matched to tonight's rotation players (`players_of`: data.json `players`), a
  player's first row. `add_report` (build): the newer of ESPN (its `updated`) and the report's slot
  wins; Available takes him off the list; Probable adds no one; the owner's marks come last. The
  watch HEADs the newest slot each minute and presses the refresh with `source: report` once per new
  report (not after a refresh that started after it was posted); that run's first step
  (`nba_report.py --changed`) stops unless tonight's rows changed (`watch.rep`, `rep_at`). Test:
  `tests/test_nba_report.py` on the 1:00 pm report (`tests/fixtures`).
- **The dials** (`SCHEDULE_DIALS`, `LAST_GAME_DIALS`, sizes from nba_spots.py: [own points, the
  other team's points]): Rest Edge (B2B vs 2+ days off, -0.72 / +1.89), Back-To-Back, 3 In 4,
  4 In 6; Letdown: OT Win, Overtime Legs, Letdown: Close Win (1-3 in regulation), Off A 20+ Win
  (+0.25 / -0.58: no letdown, the opposite). One of each kind a team at most, in that order. Turned
  into a make-rate change (/ `PTS_BASE` 113).
- **Checked on 2025-26** (`tools/backtest/nba_sim.py`, findings in its header: each night from that
  season's earlier games only, the players who sat taken out): team points +0.4 high, player points
  +0.25, threes +0.04; real results inside the sims' 10-90% range 80% (margin), 84% (total), 77%
  (player points); PIT deciles flat within a few points. The closing lines still beat it (total
  miss 14.5 vs 15.2, margin 11.2 vs 12.4): a play is where the two disagree by enough, and the record
  says whether that's an edge.
- **props.json** (compute_sim in build_nba.py, its own try: a failure leaves the pages empty, never
  the game logs): `sim` {game id: median margin / total, `scripts` (away by 10+ / close / home by
  10+), `base` (the same without the dials, `SIM_BASE_N` games), `dials` {home, away}, `starters`,
  `out` {home, away: who'd be in the rotation but sits tonight}, `lineup` (the NBA's five was posted), `players` {id: team, min, pts / fg3m: med by script, mean,
  `lad` by script = [first k, permille of k or more ...] (`ladder`)}}, `sim_plays` {points, threes},
  `sim_record` {market: {ledger}}, `sim_meta` (dial names, MIN_EDGE).
- **Prices:** every book's main line and every rung (`smartstake.add_ladder`: `points_alt` and
  `threes_alt`, alternates included). `version.json` `nba.points_alt` / `threes_alt`.
- **The plays** (`game_candidates`, `pick_plays`; since 2026-10-25): each player's **main line
  only** (the middle of the books' lines), Over and Under at the best price (`PRICE_RANGE` -250 to
  +400), against the sim's chance; **every one with `MIN_EDGE` 4+ points is a play, no cap a night or
  a game** (the owner: "Why only 8 plays?! display everything with its edge just like hockey is";
  main lines: "Most users are going to play his under X - x being his main line"); 2+ games this
  season and 18+ sim minutes. **Every play is Strong** (no Top Play since 2026-10-26, the owner: "just
  call everything STRONG"; old "top" rows count as Strong in the ledger and past nights). A rung
  is never the play: the page shows it as the **Ladder** tag. (2026-10-24 to 10-25: the best of every
  rung, one a game, 8 a night; Luka u25.5 +295 was a Top Play that way. Those plays stay in the record,
  tagged alt.) **Script-Proof** (beats its price in every script), **Chaos** (loses in a close
  game, wins when it goes sideways), **Needs A Close Game**.
- **The record:** `model_history/nba_props/sim_<season>.json` {game: {date, points: [play],
  threes: [play]}} (`PLAY_FIELDS`), rewritten until tip, never after; `sim.ledger` grades each play
  at its best price across every book, 1u; a push or a player who sat isn't graded. Split tags: top /
  strong, proof / chaos / close, over / under, main / alt, dials.
- **Past nights** (2026-10-25, the owner: "I have no way to go back and see how anything
  performed"): props.json `sim_past` {market: [play + `got`, `result` won / lost / push / sat /
  None]} (`past_plays`); the day arrows step back to them and show Results (record, units, Hit %,
  each play as locked at tip in the list with Hit / Miss, what he got, units). The page opens on tonight's slate.
- **The pages** (`site/nba/points.html` / `threes.html` + `points.js` / `threes.js` = `SIM_PAGE`
  config, on the shared `sim-board.js` + `sim.css`; Points / Threes tabs). **Rebuilt 2026-10-25** (the
  owner: the play cards and charts "feel busy to be thrown at a user immediately ... it goes against
  what i've built so far and the effort to be consistent across pages"; "brainless for people who
  want brainless, but deep for people who want deep"): the **Beta banner** back (suite.css
  `.pts-testing`, the caution line, the how-it-works behind its i; record tiles Yesterday /
  Season in units + YTD Model Performance, the shared YTD tracker with the split tags on its right),
  then **Player View | Matchup View** (a display pref per device, `nfl-tool.nba-sim-view`), the day
  arrows and game cards ("n Plays").
  - **Player View** = the NHL Shots page's list: **opens on Plays Only** (the owner: "This is about
    consistency. If users want the detailed look, theyll click"), Every Player adds the rest under
    "Not plays"; Side (Best Side / Overs / Unders) and Edge menus; a game card narrows the list (again
    = every game). Columns (the owner, same day: "Make it go PLAY, RATING, FAIR, EDGE, and then install
    the old hit rates tab"; Median / Hit % / Min dropped, "cramped"): #, Player (playerClick, logos),
    Play chip "o31.5 -110 FD" (green over, red under; best price on the member's books) + save box
    (nba-card.js `nbaCardSaveBox`), Rating (Strong), Fair, Edge, then **Hit Rate - Based On
    PTS / 3PM** (L5, L10, Season, Home, Away: his games OVER tonight's line whichever side the play is,
    "x of y", colored red 20% to green 80% with `scaleHsla`), **Tags** (takes the spare width; every
    other column is its contents + 11px a side, centered; the hit rates one width, 62px; the header reads
    "Hit Rate - Based On Over Points / Threes"; tags in two lines at most, a box the same height on every row, the rest in a "+N" pill, `fitTags`). Tags (`tagsFor`, a Tag menu filters): **Ladder** (the
    rung on the same side with the most edge, when it clears 4 and beats the main line's: "Ladder
    u25.5 +295 +9.4"), Script-Proof / Chaos Play / Needs A Close Game, each dial on with its team, Min ↑ /
    Min ↓ (a 20+ minute teammate at his spot Out tonight / back from sitting the last game), Points:
    Zone Fit / Tough Zones (his zones x what this defense allows, 2.5 points); Threes: 3s Allowed /
    Tough 3s D / Help D (Team Identity, 1 league spread), Underdog +6, Cold / Hot Run (last 5 makes
    0.6 a game off his own rate). Every column but Player / Play / Rating sorts. Started games gray
    under the rest. A click opens **The Model** (Hit In x of 10,000, GMG
    Fair, Edge and what the price needs, Book Line, the three scripts shaded, the histogram, Script-
    Proof / Chaos / Close + dial tags with the team, Starting, Locked At Tip; and **the ladder**: every
    line on the play's side then the main line's other side, our chance, fair, best price with every
    book on click, edge) and **Shot Chart** (`zonesView`: his chart beside every shot tonight's defense
    allowed, one set of filters, the Target / Tough zones where both point the same way, Zone By Zone =
    the Shot Charts page; no zone table: the owner, it "regurgitate[s] the chart").
  - **Matchup View** = the **Game Board** (rebuilt 2026-10-25 by the owner, step by step; then "give
    this a UI improvement to the max. Fill the space and make it enjoyable to read"): team-color
    banner, ONE strip (Spread / Sim, Total / Sim pills, then a big By 10+ / Close script bar filling the
    row), then **a card a team, side by side, half the width each** (team-tint banner with a 4px edge
    and the **Show Ladder** button; Player View's tile table: headshot + name, Starters / Bench group
    rows, then **Out Tonight**: `sim.out` grayed at the bottom with Game Previews' status pill, his
    season minutes and the injury, the owner 2026-10-25): Min, PTS / 3PM (**his median to a tenth**, `smoothMedian` off the ladder: the sim's own is
    a whole number, so every Threes Diff read -0.5), Line (Player View's chip, our side of his main
    line at the best price, a click = every book; tonight's play ringed), Diff (median minus the line,
    green on our side), Edge; "No Line" when no book has him. **The ladder** (Points 10+ to 40+, Threes
    1+ to 6+: our chance and best price; green / red at 3 points of edge, yellow near fair, gray with no
    price) is closed by default and opens one team at a time; while one is open both cards stack full
    width (no dead half). **Removed on purpose:** the Script Picker and by-script / Script columns (the
    owner: "its almost common sense and the numbers dont move much"; the scripts live on in the bar,
    the Player View tags and The Model), the % column, Dials Tonight (the dials are in every sim; Player
    View tags them), the box titles. Classes: `.sim-tcard`, `.sim-bt` (not `.sim-head`: the toolbar's).
- **Best Plays** (`site/nba/best.html` + `best.js`, 2026-10-25, the owner: "Keep the consistency present
  in those individual categories, but sort the best plays by edge, aggregating from these two
  categories"): sim-board.js with `SIM_PAGE.markets` = [points.js's, threes.js's config] (each page's
  config sits in `SIM_MARKETS`; `MK` = the market a row is drawn for). Player View only (no Matchup
  View), every market's rows in one list by edge with a **Market** column, Market switches (each on or
  off, the last stays on), hit rates over each row's own stat ("Based On Over His Line"), the record
  tiles and past nights across both, the YTD popup with All Plays + a tile a market (top / over /
  under splits). A new market = its page's config in `markets`. Best Plays / Points / Threes tabs on all three.
- Tests: `tests/test_nba_sim.py`, `tests/test_nba_points_site.py`, `tests/test_nba_threes_site.py`, `tests/test_nba_best_site.py`.

## The player card (`site/nba/nba-card.js`, 2026-10-21)

The owner: "build the player functionality that exists for NFL and NHL so theres consistency ...
game log and odds for all markets with checkboxes like NFL has ... game logs can be added only for
this season, do not add past years." **Every place an NBA page shows a player wraps him with
`playerClick(id, inner)`** (ESPN id): Matchup Breakdown's rotations and injuries, Points, First Basket's
starters and Value list, King of the Court's board. Each of those pages loads `../book-odds.js`
and `nba-card.js` (after the page's own script; every name in it starts `nbaCard` / `NBA_CARD` so
it can't clash with a page's helpers). Same shell as the NFL / NHL cards (`#player-card-modal`).
- Head (photo, position, team, next game) and this season's per-game tiles (Games, Min, Pts, Reb,
  Ast, 3PM, PRA).
- **Game Log** (opens here): this season's block of props.json ONLY (`DATA.season`), newest first,
  a per-game row on top: Min (a "B" when he came off the bench), Pts, Reb, Ast, 3PM, 3PA, FG, FT,
  PRA, Stl, Blk, TO, PF, +/-, shaded against his own games like the NHL card.
- **Odds**: every market in `GMG_NBA_PROP_STATS` (sync.js) a book prices for his game, at the line
  most books hang: best Over / Under across the member's books (`bookPricePill`), a box beside each
  side, and "This Season" = games over that line ("x of y", colored from 3 games like Points). First
  Basket too (same play id as the First Basket page). A box saves `{id: nba:<stat>:<game>:<player>,
  market, category, side, line, book, odds, ...}` at the best price; Over and Under share the id, so
  checking one side switches the play.
- **Log fields** (props.py `LOG_FIELDS`, after the first eleven so older files still read): fgm, ftm,
  reb, ast, stl, blk, tov, pf, pm, score, opp_score (`BOX_EXTRA`; None when a box score lacks one).
  props_2026.json keeps the old eleven (the card never shows last season).
- **Markets** (smartstake.py `NBA_PROP_MARKETS`): points, rebounds, assists, threes (made), pra, pr,
  pa, ra, steals, blocks, stocks (steals + blocks), turnovers; each asked for only when `/v1/markets`
  lists its key (`nba_listed_markets`), with `max_pages=60`. Yes / no markets and fouls left out.
- **Grading** (my-plays.js `gradeNbaPlay`): First Basket as before; every other market from his row
  for that game in props.json (`gmgNbaStatValue`, sync.js): the game in the box scores and him not in
  it = Void; no box score yet = wait.
- **Shot Chart** (2026-10-21; the owner on the mockup: "both with toggle is great as well as
  filters", this season only): `site/nba/shot-chart.js` (`nbaShotView(id)`, every name `nbaShot` /
  `NBA_SHOT`; loaded before nba-card.js on every page with the card) reads **`site/nba/shots.json`**
  (`nfl_tool/nba/shots.py`, its own try in build_nba.py `main`; gitignored, in fetch_live_data.py):
  `games` (this season's ids, oldest first), `teams` (abbreviations), `players[<id>]` = [x, y, made,
  three, game index, flags 1 = 1st qtr / 2 = first 3 min, kind 1 self-created / 2 catch / 3
  drive-cut-rim, his team, the defense (indexes into `teams`, -1 unknown)], `who[<id>]` = [name, team
  of his latest box-score game], `league` = [x, y, three, made, tried] by spot. The two teams come
  from his **box-score** team that game (never ESPN's play `team_id`); a player missing from the box
  score gets the play's side. All-Star sides are left out (the engine's half-the-games rule). ESPN's spot to the foot; **x below 25 = the shooter's left**
  (checked against NBA.com's 2025-26 shot file: same side on 90% of 121k matched shots, the rest
  wrong matches); heaves 35+ ft and free throws out. Basket at the top, so Left Side is drawn left.
  **Zones** (12: At The Rim, Paint, mid-range Left / Right Baseline, Left / Right Wing, Top; Left /
  Right Corner, Left / Right Wing, Top 3) with made/tried, %, % of FGA; **Heat Map** = hexagons
  1.6 ft, size = his shots there (scale tops out at the 92nd percentile), color = his make rate
  within 3.5 ft vs the league's there (same 2 / 3). Both: color pulled toward the league by 6 shots
  (`NBA_SHOT_PRIOR`), full at 8 points; the zone table beside it (FG, FG%, vs Lg, Share). Filters:
  Season / Last 10 / Last 5 (his games), 2PT / 3PT, Self-Created / Catch & Shoot / Drives & Cuts,
  1st Qtr / First 3 Min (for First Basket). A full season is ~4 MB, read only when the tab opens.
- Not built: alt lines.
- **Shot Charts page** (`site/nba/shot-charts.html` + `shot-charts.js` + `shot-charts.css`; NBA menu
  right under Team Identity; built 2026-10-21, the owner on the mockup: "This looks phenomenal"):
  pick an offense team + player and a defense (opens on tonight's first road team's top shooter vs
  the home defense; a new player's defense = his team's next opponent; the address keeps the pick,
  `#p=<id>&d=<TEAM>`). **Day strip** (2026-10-27, the owner: "have each team be selectable"): the
  site's day arrows + game cards, each team its own button (`.shc-slate-team`: its top shooter vs
  the other team's defense), and under it that team's roster as buttons (`.shc-roster-btn`, most
  shots first); the dropdowns stay. Left: his chart (`nbaShotZonesView` / `nbaShotHeatView`); right: every shot
  that defense allowed (shot[8]), drawn with `{allowed: true}` so the colors flip (**red = it allows
  more than the league**, legend Allows Less / Allows More). One set of filters for both (Last 10 =
  each side's own last 10 games). **Zone By Zone** table: his FG / FG% / vs Lg / Share, the same
  for the defense, the league's FG% and share, and a **Call**: Target / Tough when one side is
  2.5+ points (shrunk by `NBA_SHOT_PRIOR`) from the league and the other isn't 0.75+ the other way
  (matchupCall's rule), only on zones with 5%+ of his shots and 5+ tries. The page's own classes
  are `shc-*` (`sc-*` is the NFL Summary card's). Its global `DATA` is data.json (the card reads it).
  Tests: `tests/test_nba_shot_charts_site.py`, `tests/test_nba_shots.py`.
- Tests: `tests/test_nba_player_card_site.py`, `test_my_plays_site.py` (NbaPlays), `test_nba_props.py`.

## Zone Matchup Targets (built 2026-10-27)

The owner: "Vegas is perfect ... But there's one gap - Shot Zone." Sabonis 24 of 26 shots in the
paint, Duncan Robinson 28 of 34 from three: where and HOW (self-created / catch and shoot / drive) a
player shoots against what tonight's defense allows **players like him** (guards / forwards / bigs:
a team can wall off bigs and still bleed blow-by layups to guards). Agreed in a 15-question Q&A:
- **Raw, no pulling toward the league, no minimum sample** ("then we just are recreating the
  sportsbooks numbers"); every read shows its shot counts and a His Shots filter. The page sets
  `NBA_SHOT_PRIOR = 0` (`let` in shot-chart.js); other pages still pull (the owner: raw everywhere
  "eventually", not yet).
- **No EV** (the owner, 2026-10-28: "i didn't want to try and calculate ev based on an artform"): no
  chance or edge ever; the main line and its best price are shown, and the record tracks W / L AND units.
- **Every player with a points or threes line** on the next slate gets a read per market, OVER /
  UNDER / Toss Up (the owner: "Maybe we call these OVERS and UNDERS"), Strong past 12%.
- Build: `nfl_tool/nba/zone_matchups.py` (`block`, in build_nba.py's shots try, its own try) ->
  shots.json `matchups` {date, games, players{id: name, team, opp, group, points / threes: score,
  shots, makes, side, strong, n, dn, line, zones[], kinds[]}, defense{team: {group: {zone: [made,
  tried, FG% rank, shots rank]}}}, league, league_n, pos{id: group}}. Score = (1 + Shots) x (1 +
  Makes) - 1: Shots = his zone shares x (the share of his group's shots this defense gives up there /
  the league's share - 1); Makes = the make rate allowed his group minus the league's, x points, by
  his zones and by his shot kinds, averaged, over his diet's league points a shot. High volume + low
  makes lands near Toss Up (the owner: show both, "i fear concluding that for a user"). Threes: his
  threes only. `zone()` = shot-chart.js nbaShotZone (a test pins it).
- Page (`site/nba/zones.html` + `zones.js` + `zones.css`; NBA menu under Shot Charts with a small
  New tag, `tag` in SPORT_PAGES / `.nav-new`): opens on **Best & Worst Spots** (Overs / Unders, top
  15, Show All; started games left out), **Matchup View** (game cards; both teams' players and each
  defense's **position grid**: `grid()` / `zmGrid`, PG-C down, the market's columns across in boxed
  groups (2026-10-28; Points: Inside The Arc = Rim, Paint, Mid; Three-Point Zones = Corner 3, Wing 3,
  Top 3; Shot Type = Self-Created, Catch & Shoot, Drives; Threes: the five 3 zones, then Catch & Shoot,
  Self-Created) + Overall, every column the same width (`table-layout: fixed`, labels wrap), each cell its rank of 30 (30th = gives up the most, red) by
  Makes / Shots / Points Per Shot (toggle), shots faced small, each row's worst cell outlined; the
  owner, 2026-10-27: "this is BOS weakness vs this position"), Points / Threes, His Shots filter; a row click
  opens his chart and the defense's chart allowed to his group (both vs his group's league) and the
  Why table (zones and shot types; 2026-10-28, the owner: "WAYYYY too wide"): his Shots / Share left
  (accent shade = how much of his diet), Zone / Type in the middle, the defense's FG, FG% vs Lg, FG%
  Rank, Shots vs Lg, Shots Rank right, only as wide as its contents; every cell red-to-green from HIS
  side (a rank of 30 = gives up the most = green there); Shots vs Lg on a log scale (full at +300%). Display prefs per device (`nba-tool.zones.v1`).
- Defense chart legends read Less Makes / More Makes, Fewer Shots / More Shots (the owner, same day).
- **Fixes the same day (the owner):** no Read cell ("redundant"; back in Matchup View only, Strong Over ... Strong Under: "it was helpful there"); Score, Shots and Makes cells on the site's full red-yellow-green scale (not green / red shades),
  (`zmShade`, through nbaShotColor); the **line = the player card's
  rule** (most books, ties lower: `main_line` / `nbaCardMainLine`, read live from data.json
  `book_odds`; the middle line had shown Walsh 1.5 threes his card didn't) with **Odds** = best price
  on the read's side across the member's books, no book name, click for every book; diet tags colored
  by that spot's Shots + Makes together for him (a red tag on an Over = the counterpoint) with a
  plain-words hover (`zmZoneWhy`); tags two lines max, same height every row, "+N" (`zmFitTags`);
  the charts get Every Type / Self-Created / Catch & Shoot / Drives & Cuts.
- **The record** (the owner: "grade based on score buckets"): `model_history/nba_zones/<season>.json`
  {game: {date, points / threes: [READ_FIELDS]}}, Over / Under reads only (no Toss Ups), rewritten until
  tip, never after (`update_record`); graded from the box scores (`box_logs`: played minutes > 0)
  against his main line then, push / sat not graded; `ledger` rows carry |score| and units at the best
  price across every book at tip (`best_price`, saved as READ_FIELDS price / book since 2026-10-28, the
  owner: "track the units for just the sake of seeing"; older reads units None), tags strong / lean, over / under. shots.json `matchups.record` {market:
  {ledger}}; the page's YTD Model Performance button = the shared tracker (Min Score slider 5-30%).
- **Past nights** (2026-10-28, the owner: "no back button to look at yesterday to analyze results"): shots.json
  `matchups.past` {market: [read + got, result hit / miss / push / sat / None]} (`zone_matchups.past`); the day
  arrows step back to Results (All Reads / Strong / Overs / Unders records, Overs and Unders lists, Strong Only).
- **Not built yet:** a key defender Out chip (with / without him on the floor; the owner flagged starters vs bench).
- Tests: `tests/test_nba_zone_matchups.py`.

## The owner's list (2026-10-20, for when usage allows)

1. ~~Clickable NBA players with a pop-up like the other sports~~ built 2026-10-21 (the player
   card above), with its Shot Chart.
2. ~~Shot zones overhaul~~ built 2026-10-21 as the card's Shot Chart, and ~~a Shot Charts page~~
   (shooter vs defense) the same day. Points / First Basket / threes could read these zones.
3. **Alt-line ladder only with real alt prices** (SmartStake `alternate=true`) and narrow: "without
   odds its just filler".
4. **Rotation chart:** when a player usually subs in and out, who he plays the most minutes with,
   production with certain combos (the engine's stints have it all).
5. **Things to watch** per game: blend Team Identity's tags into a few conclusions on how a game
   may go.
6. Rebounds and assists on the Points skeleton (~~3s~~ built 2026-10-23 as Threes); show the projection once it grades well
   against this season's tip-off lines.

## Game model: full-game score, spread, total (replayed 2026-10-20, NOT built)

The owner asked for a final score projection and fair spread / total / moneyline.
`tools/backtest/nba_games.py` replayed 2025-26 night by night (this season's games only, like the
live rule) with three models on the engine: team points a possession and pace, the same
opponent-adjusted, and lineup-aware player ratings (all ten on the floor solved together; the
replay even knew who played). **None beats DraftKings' closing line**: margin miss 11.5 vs the
line's 10.9, total 15.3 vs 14.7, and where ours disagreed the result sided with the line. So no
fair-value "edge" on full-game sides / totals. The line can show the market's own implied score
(total / 2 +/- spread / 2). Next test: our record against Novig's OPENING lines this season
(the build would have to save them). The engine's proven edge so far is player-level (King of
the Court beat plain averages).

## Suite switcher and launch switch

- The top menu (`addTopMenu`, sync.js, 2026-10-17): NFL, NBA, NHL and Promo Tools are buttons in
  the middle of the topbar, each opening a list of that sport's pages (`SPORT_PAGES`). It replaced
  the brand's suite dropdown; the brand now reads "GMG Sports Data Suite" on every sport.
- **LAUNCHED 2026-10-13: both suites are open to every member** (`SUITE_SWITCH_PUBLIC = true`
  in sync.js adds `html.suite-public`, which takes the guard off the NBA and NHL pages). The owner had been advertising the NHL tools while the switch was
  still off, so members who opened an NHL link got the guard's note ("GMG NHL Suite is being
  built ... Check back soon") for over two hours and the owner took the site for broken:
  "YES! I have been advertising it! Get it up and going. You can open both to the public!"
- The guard is still in the pages (`.nba-app` hidden and `.nba-soon` shown without
  `suite-public`, suite.css) and one switch covers both suites. **Never set it back to false
  unless the owner asks**; a test (`test_the_suite_is_open_to_every_member`) fails if it is.
- Members now see these pages, so a broken NBA or NHL page is a broken page for paying members.
  The deploy's gate still leaves them out (their data builds may fail on their own): check them
  with `tools/check_site.py --only nhl` / `--only nba` before any push that touches them.
- The owner-only "Update Odds" buttons were removed 2026-10-17 (the owner: the odds update on their own; ask Claude if one is needed).

## Data: sportsdataverse / hoopR

The basketball sister of nflverse. Season files are GitHub release assets at
`sportsdataverse/sportsdataverse-data` (tags `espn_nba_*`, files named by the year the season
ENDS: 2027 = 2026-27), scraped from ESPN and refreshed daily in season.

- Checked 2026-10-11: `espn_nba_pbp` (play-by-play, ~640k plays a season, shot coordinates,
  players, clock, score), `espn_nba_team_boxscores`, `espn_nba_player_boxscores`,
  `espn_nba_schedules`, `espn_nba_rosters`, `espn_nba_depthcharts` and `espn_nba_injuries` (daily
  snapshots), plus `nba_stats_*` sets (shots, lineups, possessions).
- Parquet only is practical (the pbp CSV is 275 MB), so `pyarrow` is in requirements.txt.
- A season's box / pbp files don't exist until its first game (404). Game Previews carried both
  seasons from opening night (`stat_seasons`, opening on last season until 4 games a team); since
  2026-10-23 it is this season only (`stat_seasons` has one key, `is_fallback_season` always false).
- Not usable: `cdn.nba.com` / stats.nba.com (blocked with 403 from the user's PC and commonly
  from cloud builders). ESPN's own API (`site.api.espn.com/.../basketball/nba/scoreboard`,
  `summary`) works and is what hoopR scrapes; use it if same-day freshness is ever needed.
- **Odds: Novig** has NBA on the same public feed (`events?league=NBA`, same
  `EventMarkets_Query`). Events are matched to games by team nickname + start time. Only
  `OPEN_PREGAME` events are read, and a game that has tipped keeps the lines of the last build
  before tip-off (`apply_lines`), so in-game lines never show.

## Build

- `nfl_tool/nba/build_nba.py --season 2027 --out nfl_tool/site/nba/data.json` (deploy.yml step
  "Build NBA data", `continue-on-error`, so it can never block the NFL deploy). Local: add
  `--cached --data-dir data/nba` to reuse downloads.
- Output: `teams`, `team_stats` (per-100 ratings, pace, four factors, 3s, paint / fast break /
  points off turnovers, each as `off_*` and the matching `def_*` allowed), `recent_games`,
  `players` (12-man rotation per team, per game + last 5), `injuries`, `schedule` (yesterday
  through 14 days out, Novig lines), `novig_debug`.
- Team keys are ESPN abbreviations (NY, GS, SA, NO, UTAH, WSH).
- Times are converted with a fixed UTC-4, so they read an hour late after the November clock
  change until that's handled.
- ESPN's `turnover_points` is points GIVEN UP off turnovers, so the sides are swapped on purpose.
- All-Star / exhibition sides appear in the box scores; only the 30 real teams are counted.

## Pages

## Matchup Breakdown (`site/nba/index.html` + `nba.js` + `matchup.css`, 2026-10-28)

Game Previews and Team Identity in one page (the owner: "after 3 minutes on this page i understand how
these teams win, why they lose, and what the matchup may have in store for tonight"). Agreed in a
20-question Q&A, no mockup. NBA menu: "Matchup Breakdown" (first); `identity.html` forwards here.
- **One cell language everywhere** (the owner: "Rank first then number ... so the user can always look
  for the same thing"): every cell = a rank of 30 big, its number small, shaded red to green by rank
  (`cellTd`, `scaleHsla`); green = good for that team. **How-often rows ARE colored** (the owner chose
  it): offense 1st = does it most, defense 1st = allows it least, so green against red = the offense
  gets its way. `rankIn` ranks a number among the teams' season numbers (also a wins / losses number).
- **Layout rules (the owner's first look, 2026-10-28):** every section and box hugs its contents and
  they flow side by side where there's room (`.mb-flow`, `.mb-fitbox`; "when in doubt you just increase
  everything to fill the space rather than containing things"); **labels sit at the far right of every
  table, never between the teams** ("This has been an issue with you for the entirety of the site");
  group headers centered; no "Has The Ball" / "Call" heads, just logo + "HOU Off" over each column.
- Sections: **The Line** + **Injuries** (compact); **Biggest Edges** (per team, its **Offense** group
  then its **Defense** group, up to 3 each, the team's own cell first); **How They Win / How They
  Lose** (reworked: the same 12 plain-word rows for every team, `WL_ROWS`, In Wins | In Losses, each
  ranked where it would sit among the 30 season numbers; the 3 biggest swings marked; "No Losses Yet"
  heads the empty column); **Head To Head** (record, ratings, pace, home / away / last 10, Q1-Q4
  Margin, Blowout Data with the starters rows colored too (more = 1st), Tonight's Spots);
  **The Matchup**; **Rotations & Recent Games** in one section (rotation cells shaded by rank on his
  own team, every column sortable; Recent Games' Spread / Total at tip, green = covered / over, from
  King of the Court's `lines_<season>.json` via `add_recent_lines`).
- **The Matchup**: one table, `[Away Off][Home Def][call] | [Home Off][Away Def][call] [label]`, every
  row always. Rows (`M_ROWS`, the owner's cuts
  2026-10-28): Scoring = Pts / Possession, Pace, Transition Share, Transition Pts / Poss; Possessions =
  Turnovers, Rebounding (offensive rebound % vs the defense's own defensive rebound %), Free Throws /
  Shot; Shot Diet = 3-Point Share (no 3P%: "it will level out"), Paint Share, Paint FG%, Mid-Range
  Share, Mid-Range FG%, Ball Movement. Dropped: half-court, seconds a possession, steals' share, the
  corner / above-break split, rim vs paint split, pull-up / catch / assisted rows, 3P%, clutch,
  second-chance points. **Vs Tonight's Types**: the team that IS the type gets its rank in the trait
  (`order`), the other its points vs normal against teams like that minus the league's, ranked among
  every team that has faced the type (ranking among only the few with 3+ games read MIL's +7.2 allowed
  as "2nd"); the row shows once that team has `EX_MIN_GP` 3+ games against it.
- Calls (`rowCall`): matchupCall's rule (one side 0.6 spreads, the other not 0.3 against); transition
  scoring only for a team that runs; a make rate only where the offense shoots at least the league's
  share; Big Edge = the sides average 1 spread (a type: a 6+ point gap); how-often rows: Fits / Takes
  Away at 0.7 spreads each.
- This season only: no season buttons. It does NOT load common.js; it shares style.css, suite.css and
  sync.js (`.mb-*` styles in matchup.css). The NHL reuses suite.css's `.nba-two`, `.nba-box`, `.nba-app`.
- Tests: `tests/test_nba_matchup_site.py` (BOS @ DET on `identity_2026.json`), `test_nba_identity.py`
  (the numbers), `test_nba_previews_seasons.py` (stats blocks, Recent Games' lines).

## First Basket (built 2026-10-20, opening night)

Who scores a game's first points. The owner turned down a predictive pick board: "i would rather
this page be the pieces of the puzzle with data for users to solve", with a fair-value guess at
the bottom only. Then, on the plain data mockup: "very data heavy ... no color coding or player
images. I like Team logos too", so it uses the site look (team-color banners, logos, ESPN
headshots, red-to-green `scaleHsla` cells, "i" bubbles for the explanations).

- **Any first points count, free throws included** (the owner: most books settle it that way), **and so does every "shot" count** (Shot Early, 1st Shot, Team Share 1st Shot, First Look; the owner, 2026-10-26: "Why on earth would we count them in one category but not another"). Fair never read them (its shot volume was already FGA + 0.44 FTA).
  "First field goal allowed" is field goals only, as asked.
- **Build:** `nfl_tool/nba/first_basket.py`, called by `compute_first_basket` in build_nba.py (its
  own try: a failure leaves `first_basket: null`). Reads `espn_nba_pbp/play_by_play_<season>.parquet`
  (22 MB a season) for both seasons. Output `first_basket`: `seasons[<year>]` (`label`, `games`,
  `league`, `teams`, `players`), `slates[<year>]` (`{game id: {away, home, fair}}` for the next 3
  nights: likely starters, jumper, fair guess), `default` (this season; until 2026-10-23 last
  season's block supplied the likely starters and the Value record while teams had under 4 games).
- **From the play-by-play:** the opening `Jumpball` names both jumpers; its `team_id` is the team
  that got the ball, and the jumper on that team won it. Possessions to first points: a team starts
  a possession on its first shot, turnover or rebound after the other team's (fouls without a shot
  don't, so the count runs a hair low). 2025-26: the tip winner scored first 66.6%; free throws were
  the first points in 9%; 2.02 possessions and 55 seconds to a team's first points; first field
  goals by guards 44%, forwards 37%, centers 19%.
- **Starting fives: the NBA's own lineup file** (the owner: "nba is big on lineups so making sure
  thats fast and accurate is key"). `stats.nba.com/js/data/leaders/00_daily_lineups_<YYYYMMDD>.json`
  (what nba.com's Today's Lineups reads; answers from the owner's PC though `cdn.nba.com` doesn't)
  lists each team's five as `Expected`, then `Confirmed` once the team turns it in (~30 min before
  tip), with position, `rosterStatus` and a timestamp. Only that day's file exists (later days 404).
  Read **live**: `/api/nba-lineups?date=YYYYMMDD` in `_middleware.js` (members only) fetches it and
  keeps it 60 s in Cloudflare's cache; the page asks on load and every minute while the night isn't
  over. Fallbacks: the build's copy (`first_basket.lineups`, fetched every build), then the build's
  likely starters ("Our guess"). Each team's banner says Confirmed / Expected / Our guess. Names are
  matched to our players by team + name (`roster`: every rostered player's ESPN id); a starter with
  no numbers (a rookie) shows with "new" and the NBA's headshot. The jumper, tip and fair guess
  follow the five shown (`fairPrices` in the page = `fair_prices` in Python; a test pins them).
  Twitter/X (Underdog NBA) was ruled out: reading it needs a paid API (~$200 a month) and scraping
  breaks X's rules. On opening night the NBA had SA's Dylan Harper starting where our guess had
  Tobias Harris.
- **Likely starters** (our guess, before the NBA posts a five): on the team today (roster file), not
  listed Out, starting in at least half the games he played, most minutes first. Ranking by start
  counts dropped Wembanyama (missed games) from the 2025-26 Spurs. **Jumper:** most jumps among
  them (at least `MIN_JUMPS` 2); with the NBA's five and no jumper on file, its listed center.
- **Prediction** (the tip chance; 2026-10-21, the owner: a jumper who only met Wembanyama and one who only met
  guards can't be read off Tips Won): `tip_ratings` = every OPENING tip of THIS season (held balls and overtime tips left out,
  the owner 2026-10-21: "dirty data which can skew"; `jump_balls`, winner = the jumper on the side that got the ball, never
  ESPN's name order), opponent-adjusted (Bradley-Terry), each rating starting from height
  (`TIP_PER_INCH` 0.15 from the roster file's height, `TIP_PULL` 3). data.json `first_basket.tip`
  = {ratings, heights, record, jumps}; every season view uses this season's (NBA rule). 2025-26
  replay (`tools/backtest/nba_tips.py`, each tip from the tips before it): opening tips only 63% right / log loss 0.627 (every jump ball was 64% / 0.627), vs 61% / 0.644 for
  steadied Tips Won, 60% for height alone; 5+ inches taller won 84%, 1 inch 50%. Home teams won
  52.9% of tips (noise-sized), so the tip's Home/Road row was dropped.
- **Fair** (`fair_prices`, rebuilt 2026-10-21 on a 2025-26 replay, each team-game from the games
  before it; the owner: "bake all the projections and data and likelihood into a fair price"):
  **Scores First** (`team_chance`) = Prediction x `TIP_WINNER_SCORES` 0.666 + the rest; trips to
  score / allow, after-tip rates and Scores First rates added nothing once the tip was known.
  His share of his team's first points (`first_shares`) = half (shots a start, FGA + 0.44 FTA,
  `shots`)^0.5, half Team Share 1st Pts steadied `TEAM_SHARE_PRIOR` 20 starts toward his
  teammates; x 0.96 (`BENCH_SHARE`). Who scores a team's first points is near random: this blend
  hit 25% (blind 20%); the OLD Fair (game first points a start) fit worse than an even split;
  **position vs the defense made every version worse** (no Position tag). **This season's
  players only** (`now` = this season's block, every season view; NBA rule), so before a team has
  games its five sit even (opening week: every starter the same price).
- **Value** (the owner chose "show value now", 2026-10-21: "as games are played it will level
  out"): our chance `VALUE_EDGE` 10%+ above Novig's implied (`is_value`). Green Value tag on the
  row; the third box (was Targets) lists the game's Value starters (Fair vs Novig) and the
  **record**: `model_history/nba_first_basket/<season>.json` (`first_basket_record` in
  build_nba.py; deploy bot commits it) = each game's ten as the last build before tip had them
  ({id: [name, chance, Novig, Value]}, a started game never rewritten), **from `FB_RECORD_START`
  2026-10-23** (the owner: "start fresh tonight" now that it's this season only; earlier nights are
  dropped from the file on the next build), `result` {team, scorer}
  from the play-by-play; `first_basket.record` = {plays, won, units (1u at Novig), games}. The
  record uses the build's starters (the NBA lineup copy isn't applied there), the page the live five.
- **Testing banner** (2026-10-23, the owner: "add the beta header on first basket"): the testing
  banner (styles in suite.css; Points / Threes had it until their sim, 2026-10-24, and again from 2026-10-25) at the top: Beta, Projections In Testing Until
  Mid-November, the caution line, and on the right the **Value Record So Far** with the YTD Model
  Performance button (it sat beside the season buttons before).
- **YTD Performance** (the owner, 2026-10-21: "a pill next to the years ... brings up a modal with
  the history"): a pill after the season buttons ("YTD Model Performance" since 2026-10-22) opens a
  window (`renderYtd`, book-odds.js's `ensureBookModal`) with the shared tracker (styles.md, "YTD
  Model Performance"): Tip Prediction and Scores First with a Min Chance slider (50-75%), Value Plays
  with a Min Edge slider (our chance over the price's, 10-100%; each Value play in `history` carries
  it as a fifth item since 2026-10-22, older ones count at 10%), and every graded game in the window
  newest first (picks under their slider show "--"): our tip pick (jumper, chance) vs who won it, our Scores
  First pick vs who did and the scorer, the Value plays at their price; right = green, wrong = red.
  A pick = the side over 50% (exactly 50% = no pick). From `record.history` (build_nba.py
  `first_basket_record`), which also saves `tip_home`, `jumpers` and `result.tip` from 2026-10-21
  on (earlier games' result.tip is filled in on the next build; their tip pick shows "--").
- **Tags** beside names (this season's numbers): **Value** (green), **Top Option** (most shots a
  start among the five), **First Look** (his team's first shot in 25%+ of 5+ starts), Jumper.
  Ideas not built: Usage + (a high-shot teammate Out), FT Early.
- **The page** (`site/nba/first-basket.html` + `first-basket.js` + `first-basket.css`; NBA menu
  under "Player props"): day strip, season buttons, then **Starters (both teams stacked) on the
  left, The Matchup with Value under it on the right, the same width (380 px); tops and bottoms
  level** (the owner, 2026-10-21: "I don't like the different levels": the Starters box stretches
  to the right column's height and Value fills what's left; `.fb-side`). Under 1000 px it stacks.
  Before 2026-10-21: three boxes side by side, Matchup | Starters | Targets ("box box box").
  How it got here (2026-10-20): tile sections with team cards and a split bar were "overwhelming ...
  so much dead space ... too many numbers all spread everywhere"; then one stacked table was
  "significantly improved" but the owner wanted "Simple. KISS" and wrote the rows themself.
- **The Matchup** (`renderMatchup`, `matchupRows`): ONE table, road team's value left, home team's
  right, the stat name in the middle with an **Edge** pill (better side's logo, when they're `edge`
  apart). The owner's rows, Title Case, nothing else: The Tip (Jumper with height, Tips Won, Prediction (the tip chance, named by the owner); its
  name sits between the team banners so no empty row sits under them), Scores
  First (Scores First, Home/Road, After Winning Tip, After Losing Tip), Opening Trips (Avg Poss. To
  Score, Avg Poss. To Allow), First FG Allowed (Point Guards, Shooting Guards, Small Forwards, Power Forwards, Centers; five
since 2026-10-21). **Removed on purpose:**
  game-count subtext, league averages, "fair guess" rows ("Wins the tip": "you're making a guess
  here and that's not evident. We can make predictions else where"), the 1st-quarter margin and
  the seconds rows. Group headers centered over the middle. **Every row one fixed height (28 px;
  38 px on phones), centered**, column 380 px (tightened 2026-10-21: "too wide ... too tall") (the owner: "keep them all consistent"). Each value colored against
  the league from its own team's side (green = good for that team; First FG Allowed: red = that
  position scores first on them often). **Colors = distance from the league average in league
  spreads** (`zHeat`, full color at 1.5 SD): picked over worst-to-best (one outlier stretched it)
  and rank (near-ties a color apart); the owner asked if it would turn all yellow with more data:
  no, the spread tightens with the league, so the color mix holds.
- **Targets: retired 2026-10-21** for Value. On CHA-BKN CHA led the tip, scores first and opening
  trips, yet Targets listed BKN's forwards ("Laughable"): who scores first IF a team does never
  asked which team is likelier to. Its position / tip / quick-start rules are gone from the page.
- **Starters**: one compact table per team, both the width of the wider one (banner: the team's
  **Scores First** box, colored from 50/50, and the lineup tag): Shot Early / 1st Shot / Scored 1st / **Team Share** (1st Shot, 1st Pts: his own team's
  first shot and first points whatever the other team did, `team_first_shot` / `team_first_pts`, in
  a thin box; the owner, 2026-10-21) as % with "x of y" under, **Fair** (our guess) and
  **Novig** (Novig's First Basket price), likeliest first. Team numbers are colored against all 30
  teams, players against every starter **from his first start** (`MIN_STARTS` 1 since 2026-10-23, the
  owner: "the color coding is not showing"; at 15 nobody qualified this early; jumpers from 1 jump).
  The Matchup's jumper name shortens ("..."), never his height.
- **Book prices: Best = SmartStake, then Novig** (the owner, 2026-10-21: SmartStake added the first
  point market; "relabel NOVIG to BEST"). `smartstake.add_first_basket` (called by
  `fetch_nba_book_odds`; keys from `first_basket_market_keys`: a player market for the game's first
  points / basket, no team / quarter / half / field-goal-only markets; falls back to
  `basketball_first_points_scorer`) puts every book's Yes into `book_odds["AWAY_HOME"].props.first_basket`
  by ESPN id; `book_odds_debug.first_basket` says what came back. **The sportsbooks (DraftKings, FanDuel,
  Caesars, theScore...) send 1st Points Scorer as ALTERNATE quotes, Yes only; the exchanges (Novig,
  ProphetX, Fliff) as a main Yes / No**, so it is fetched with `alternate=True` (the probe,
  2026-10-21: main lines only got just the exchanges). Locks at tip like every price.
  The **Best** column = `bookPricePill` (best across the member's books); a player no book lists
  shows Novig's own price, labeled Novig, not clickable (Novig's public feed `FIRST_BASKET` market,
  read in `fetch_novig_lines` into each game's `first_basket`, a `LINE_FIELDS` member). Value and
  the record use the best price (the record: best across ALL books, `best_price`, with its book).
  (2026-10-20 it was Novig only: "SS bad idea ... until SS can fix their offerings".)
- **Saving a play:** clicking Best opens book-odds.js's every-book window with `spec.save`; each
  book's price is a button that saves the play to My Plays at that book and price (another price
  switches it, the same one removes it; a check mark shows on the row). NBA plays:
  `nfl-tool.nba-plays.v1` (sync.js `loadNbaPlays` / `saveNbaPlays`, in both sync key lists), entry
  `{id: nba:fb:<game>:<player>, sport, market: first_basket, category: First Basket, date, game_id,
  matchup, team, player_id, description, logo, color, book, odds}`. My Plays grades them from
  `first_basket.results` ({game id: first scorer id}, this season's games): his id = win, anyone
  else = loss, no scorer on file = void. A player who didn't play is graded a loss: set Void by hand.
- Tests: `tests/test_nba_first_basket.py` (the build on two hand-made games, and the page).
- Not built yet: a Summary card; the record on the page is Value tags only (no calibration view yet).

## King of the Court (Promo Tools; built 2026-10-19)

DraftKings' promo paid on the night's most points + rebounds + assists (PRA). The owner ran it
last season from a spreadsheet and wanted the same setup, built for the 2026-10-21 slate:
- a **defense board** (each team's 40 / 45 / 50 / 55 / 60+ PRA games allowed, colored, with a
  score: "do teams let certain stars beat them or do they play top to bottom solid D?"), plus
  **position vulnerability** (their ask);
- a **player board** (each player's games in those buckets, a score, the opponent's matchup score,
  a blended GMG number);
- a 2025-26 / 2026-27 toggle (removed 2026-10-22 with last season's data, below);
- **historic stats on nightly leaders** (games on the night, the winner's PRA, and anything about
  the game total / spread that narrows it down). They skipped the mockup to save usage: build it,
  then small tweaks.

- **Build:** `nfl_tool/nba/kotc.py`, called by `compute_kotc` in build_nba.py (its own try: a
  failure leaves `kotc: null` and Game Previews still builds). Output `data.json` `kotc`:
  `seasons[<this season>]` (`label`, `league`, `defense`, `players`, `nights`, `summary`),
  `slates[<this season>]` (`{date: rows}` for the next 3 nights), `default` (this season),
  `past` (`{date: {season_used, games, best, rows}}`: every recorded night before today, `kotc.past_nights`:
  everyone on its pregame board plus the night's 40 best PRA lines, each with pts / reb / ast /
  pra (None = didn't play) and the board's `rank` / `lead` / `proj`), `weights`, `thresholds`, `record`.
- **This season only since 2026-10-22** (the owner's list that day): no season toggle, no
  `PRIOR_GAMES` seed (the constant stays for the replay). Early on a player needs
  min(`MIN_GAMES` 3, half his team's games rounded up) games, so a team two games in has players.
- **Buckets are cumulative** (a 52 counts in 40+, 45+, 50+). Score (1 x 40+ ... 5 x 60+) is still
  built but no longer shown: the owner, 2026-10-22, "Score and matchup feel arbitrary right now -
  i dont know what they truly mean". Matchup (the other defense's Score) became **Opp Top**: the
  other defense's `star`, the most PRA any one opponent had against it, average a game (real PRA).
- **Positions are PG / SG / SF / PF / C** (positions.py, 2026-10-21): the board, vs Pos, the defense
  board's five columns and Who wins it. A defense's position number is PRA per 48 minutes allowed to
  that spot, steadied with 10 games of the league's rate (`pos_f` = against the league).
- **The projection's matchup still reads ESPN's G / F / C** (`grp`, `grp_f`): on the 2025-26
  replay the five positions put the leader in the top 5 61% of nights vs 64% (fit 0.68 vs 0.91),
  thinner samples and last season's players on today's spots. Kept under the first-week rule;
  **ask the owner** before switching (`py tools/backtest/nba_kotc.py --five-matchup` replays it).
- Players sit on the team today's roster file lists them with.
- **The projection** (`project`, `WEIGHTS`): base = half season average, half last 10; times the
  other defense's `pos_f` (exponent 1.0); times (game total / league average total)^0.2. **Lead %**
  (`lead_chances`): 6,000 runs of the slate with each PRA drawn around its projection (sd 4 + 0.22 x
  proj); ties split. Players ESPN lists Out stay on the board, grayed, with no chance.
- **The replay** (`py tools/backtest/nba_kotc.py`, about 2 minutes; findings in its header): every
  2025-26 night after the first 15, projected only from games before it. Fitted: position matchup
  0.99, total 0.17, blowout (spread past 6) -0.0025 a point, back-to-back +0.007: **blowouts and
  back-to-backs are 0 in the number**, shown as tags only. The leader was the board's #1 30% of
  nights, top 5 64-67%, top 10 83% (plain PRA average: 27 / 63 / 79). Lead % honest (said 14%, led
  14%; said 26%, led 27%). The replay knew who played; the live page only has the injury report.
- **Lines:** last season's are `nfl_tool/nba/lines_2026.json` (`{game id: [total, home spread]}`,
  made once on 2026-10-19: DraftKings' closing total and spread from ESPN's `summary` endpoint's
  `pickcenter` for 979 of 1,235 games, the play-by-play file's spread for the rest; ESPN's scoreboard
  has no odds for past dates). This season's are each game's Novig line at tip-off, saved by the build
  in `model_history/nba_kotc/lines_<season>.json` (committed by the deploy bot).
- **The record** (`model_history/nba_kotc/<season>.json`): each night's top 60 (30 until 2026-10-22; payouts on longer shots need their chance) by Lead % as the last
  build before the night's first tip had it (`kotc_record`; a started night is never rewritten). The
  page's Nightly leaders show the winner's place on it ("Pre 3"). NBA builds run every 6 hours and on
  pushes (no half-hourly refresh like the NHL), so a night's board can be up to 6 hours old at tip.
- **Historical Data** (`summary`, computed every build): four tiles with one label each, no
  subtext (the owner, 2026-10-21, their wording: AVG Winning PRA = `mean`, Winners Team Favored,
  Winners AVG Game Total, Winner in Top 5 as one number, 65%); winning PRA by slate size (typical, colored
  low to high, middle half, best; centered, no note under it), the leader's game total and spread against the games on those nights (2025-26: 240+
  totals 1.31x their share, under 220 0.37x; spreads 0-3 1.22x, 10+ 0.77x; the leader's team was
  favored 70%), positions (guards 47%), most nights led. This season's only, however few nights (last season's
  reference came off 2026-10-23).
- **The page** (`site/nba/promo-tools.html` + `kotc.js` + `kotc.css`): night arrows that step back
  through every finished night (`past`) and ahead through the slate, Save image; **the player board
  and the defense board side by side** (the owner, 2026-10-22: "defense chart to sit up beside the
  player data"; they wrap when the screen is too narrow), Nightly Leaders and the payout box below
  (outside both images). Player board: top 25, "Show all"; Lead %, Proj, Avg, buckets, Opp, Opp Top,
  vs Pos, Total, Spread (+ Est Pay, below); green = good for him; B2B and blowout tags. **L10 is
  gone** ("so closely related" to Proj) and so is the "from XXX" tag ("by next week we know").
  **A finished night** shows its pregame board against what happened: Pre (board place), PRA,
  P / R / A, Lead %, Proj, Opp, Paid; the winner(s) starred, didn't-play last (DNP). Defense board:
  red = bad defense (the owner's sheet); teams not playing dimmed; its own Save image; "Hide Teams Not
  Playing" (colors still against all 30); default sort Top Opp; **Targets** = the other team's top 3
  by Lead % (of the night's top 100; the owner 2026-10-22, was every one of the top 100). On a finished
  night it shows today's numbers with that night's teams and pregame board. No projection math.
  Headshots and logos are ESPN's (html-to-image can carry them).
- **Ties** (the owner, 2026-10-22: Edwards and Jerome tied at 58 and only Edwards showed): every
  co-leader counts. Nightly Leaders gives each his own line (logo, name, O/U and spread under it,
  his Pre, his Paid) and a Tie tag; a finished night stars every winner; Historical Data splits a
  tie night between them for shares (positions, total / spread mix, favored, the winner's total) and
  gives each a full night in Most nights led; Est Pay's fit leaves out a tied winner's payout (a
  split pool says nothing about how many were on him alone).
- **Payouts** (the owner, 2026-10-22: "a place to update what payouts were/could have been ... reverse
  engineer potential payouts based on prize pot, position on projections"): the owner's box (html.is-owner
  and localhost) picks a finished night, the Prize Pool, and DraftKings' pasted list ("Name - $140 in
  Bonus Bets", matched to that night's `past` rows by name, accents dropped, else a unique last name).
  Saved to `/api/court-payouts` (D1 `court_payouts`, the shared promo-payouts handler in _middleware.js;
  members read, owner saves). Shown as Paid on the finished night and on Nightly Leaders. **Est Pay**:
  once `FIT_MIN` 6 logged payouts have a pregame Lead %, log(paid / pool) is fit as a straight line on
  log(Lead %) (favorites are on more entries, so they pay less) and the board gets an Est Pay column
  at the latest logged pool. Unproven until it has a few weeks of nights.
- Tests: `tests/test_nba_kotc.py` (the build on a hand-made season) and `tests/test_nba_kotc_site.py`
  (the page on a data.json built from it; `SiteBrowser.nba` serves it).
- Not built yet: players' PRA lines from the books (SmartStake / Novig), a with/without-teammate
  usage bump, pace, Est Pay by slate size (one line for every night for now).
