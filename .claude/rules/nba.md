---
paths:
  - "nfl_tool/nba/**"
  - "nfl_tool/site/nba/**"
---
# GMG NBA Suite

Started 2026-10-11; the 2026-27 season tips off 2026-10-20. The user wants the NBA version of the
site on the same website, reached from a suite dropdown. The brand is "GMG Sports Data Suite";
NFL and NBA are suites inside it. More background: `docs/history.md`, "NBA".

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
- King of the Court was the one exception for its first week; it went this-season-only on
  2026-10-22 (the owner: "turn off 2025-2026 data because by next week, we will have every team
  with data for this season"). No exceptions remain.

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
- Read by Team Identity (below); First Basket still counts its own possessions.
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
- **The page** (`site/nba/identity.html` + `identity.js` + `identity.css`; NBA menu under Game
  Previews): day strip, season buttons, **The Teams** (Offense / Defense identity tags: up to 4
  each, a full league spread from average, biggest first; 4th-quarter table; quarters) and
  **Offense vs Defense** (both directions, grouped rows, then "Where the shots come from").
  Good / bad rows use Game Previews' tags (Mismatch / Tough / Good vs Good). **How-often rows (pace,
  shares) are never colored good or bad**; their tags are **Fits** (offense does it a lot, this
  defense allows it a lot, 0.7 spreads each) and **Takes away** (offense a lot, defense rarely).
  The zone table's tag is the volume tag when there is one, else the make-rate matchup.
- Tests: `tests/test_nba_identity.py`.

## Player props (data built 2026-10-20; the Points page is next)

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
- **Tip-off lines:** `model_history/nba_props/lines_<season>.json` = {game id: {player id:
  [middle main points line across books, projection, our number, weight]}}, the last pregame
  build's (never rewritten after tip): the line history, and what the projection is graded against.
- **Points projection from day one, anchored to the line** (the owner: "I would like projections to
  start day one - even if its weighing heavily towards the line. I want the framework in"):
  `props.project_points` = line + w x (ours - line), w = `PROJ_MAX` 0.5 x games / (games +
  `PROJ_K` 10) on THIS season's games (no games = the line). Ours (`our_points`) = last-5 minutes
  x season points a minute x (1 + `LEAN`), then the factors the 2025-26 replay kept
  (`tools/backtest/nba_points.py`), refitted together on all of 2025-26 on 2026-10-23: the game's
  pace^0.9 (both teams' this-season `off_pace` against the league), the other defense's
  `def_ppp`^0.56 and `def_trans_freq`^0.2 against the league (Team Identity, this season),
  (last 5 / season minutes)^-0.365 (a minutes dip bounces back), x (1 + max(0, 1.68 - 1.83 x his
  shot share / 0.2) x `missing`) (teammates listed Out: their shots go to role players, a star gets
  no bump and no cut), x (1 + 0.1 x the other team's `opp_missing`). Zone fit, free throws and
  turnovers forced added nothing once those were in: tags only. Points miss by ~5.2 whatever we do;
  the factors cut it ~1%. props.json `slate` = {game id: {player id: line, proj, w, ours, min, ppm,
  games, out, missing, share, opp_missing, min_ratio}} for the next 3 nights; `proj` = the settings.
  **PROJ_MAX stays 0.5 until the live record says otherwise** (the lines record keeps [line, proj,
  ours, w, min_ratio, missing, share, opp_missing] per player for exactly that).
- **Shown and graded live since 2026-10-23** (the owner: "start projecting today using what we know
  to be true + what we think might be true/an edge and pretend it is. Then track to see real time if
  we are onto something. We can adjust after a month"). props.json `record.ledger` =
  `props.record_ledger` (the shared YTD tracker's rows: the side the projection leans off the
  tip-off line, edge in points, no units: no saved price), from `RECORD_START` 2026-10-23 (the older
  rows were the earlier formula). Split tags test each idea alone: over / under, `star` (line 24.5+,
  idea C), `dip` (last-5 minutes 85% of his season or less), `role` (10%+ of the team's shots Out,
  his share under 15%), `opp_out` (the other team missing 15%+). **Revisit around 2026-11-23** with
  ~2,000 graded plays: drop what isn't holding, raise PROJ_MAX if the record earns it.
- **Factor research (2026-10-23, the owner's 10 ideas + minutes, referees, star lines, rest):** the
  replay (`tools/backtest/nba_points.py`, findings in its header) found two new things that predict
  points: last-5 minutes overshoot (a minutes dip bounces back, a rise sticks) and missing
  teammates' shots go mostly to role players. Referee crews, rest / schedule spots and the position
  matchup added nothing. Each factor is also graded against this season's tip-off lines
  (`py tools/backtest/nba_points_lines.py --season 2027`; needs `py tools/backtest/nba_refs.py
  --season 2027` for the crews; meaningful from ~2,000 lines, about mid-November).
- Tests: `tests/test_nba_props.py`.
- **The Points page** (since 2026-10-23 on the shared props board above: the columns, sorting, tags and
  Hit Rate group described there replace the Line / Best Price / Proj / Min columns below) (`site/nba/points.html` + `points.js` + `points.css`; NBA menu, Player props,
  above First Basket; built 2026-10-20 from the owner's plan in words, no mockup, then trimmed the
  same night on the owner's notes): day arrows, game / sort / search filters, season buttons (hit
  rates and splits only). One row per player in props.json `slate`: Player (narrow), Line (middle
  main line), best Over **stacked on** Under (book-odds.js `bookPricePill`, book names hidden in
  the cell, every book on click), **Proj** (was "Coming soon" until 2026-10-23: the number, then
  "Over 1.5" / "Under 0.6" off the line, "No Games Yet" = the line; Sort: Proj Edge), L5 / L10 / Season / H-A / vs hit
  rates against tonight's line as "x of y" (colored from 3 games: 60%+ green, 40%- red), Min
  (season, L5), Share, Mix (2026-10-23, the owner: half the width, pills colored "based on usage ...
  on a 1-100 scale": Rim / 3s / Self pills, his % of shots, each shaded on the 8-step rank colors
  by its percentile among this season's players with 20+ shots, green = uses it most), tags (Zone fit / Tough zones: his zones x
  this defense's make rate allowed against the league's, 2.5 points either way; Usage +: `missing`;
  Min up / down: last 5 moved 3+). Out players gray, last. Clicking a player opens **only with /
  without** (a teammate, most minutes first; Out (any) / Out: rest / Out: injured split his games
  by whether he played, from box-score DNP reasons; Off the floor = `with` minutes, points and shots
  a 36) **and every book's price** (no name banner). The game log, alt-line ladder and a shot-zone
  chart were there for an hour and cut (the owner: "Bottom line, i hate the drop down player points
  portion currently"); props.json keeps `zone_pct` for the zone redo. **2026-10-23 redo** (the
  owner: "incorporate the shot charts for player and opposing defense into the player drop downs
  ... especially if we are addressing zone fit"): left column = With / Without stacked on Every Book
  (main lines only; the rest behind **Show Other Lines (n)**, book-odds.js `spec.collapseOthers`,
  only Points sets it), right = **Shot Zones**: his chart next to every shot tonight's defense
  allowed (shot-chart.js, Shot Charts page look and filters, `nbaShotAllowed`), then the Target /
  Tough zones (`nbaShotCall`, shared with the Shot Charts page) and a Zone By Zone link to that
  page. The player's NAME opens the player card (below); the rest of the row opens the drop down. Tests:
  `tests/test_nba_points_site.py` (`SiteBrowser.nba_props`).
- **The testing banner** (2026-10-23; under its title, the owner's words as written: **PLEASE WAGER WITH
  CAUTION UNTIL WE HAVE MORE DATA.**, on Points and Threes; the owner: "a large header ... that until mid november we
  wont know for sure - but also provide checks and balances on the way with real info"): top of
  the page, "Beta" + **Projections In Testing Until Mid-November** (what's proven vs being tested
  behind the i), and on the right **Record So Far** (record.ledger W-L, %) with the **YTD Model
  Performance** button (ytd.js: Points Projection with a Min Edge slider in points, splits Overs /
  Unders / Star Lines (24.5+) / Minutes Dip / Role Player Usage + / Opponent Missing). The owner
  wants the same banner on a Best Plays page "eventually" (the NBA has none yet). Take it down once
  the record has spoken (mid-November) and the owner says so.

## The NBA props board (`site/nba/props-board.js`, shared by Points and Threes, 2026-10-23)

The owner: "we want users to feel comfortable to in rhythm with the design of this site moving from
sport to sport. Everything we create should mimic the other tools in form and function." One board,
each page a config (`PB_PAGE` in points.js / threes.js, loaded BEFORE props-board.js; column lists
may be functions because the board's helpers load after):
- **The play the NHL pages' way:** Play chip (`o19.5 PTS`, `u0.5 3PM`, green over / red under) = the
  side our projection **leans** (Threes: our chance of the Over vs the books' no-vig `p_mkt`; Points:
  the projection vs the line; no lean = no chip), priced at its best price across the member's
  books. Until 2026-10-23 it was "the side that beats its price by more", which with the books' cut
  often showed the less-bad side we lean AGAINST (the owner, on Pippen: "why is the play over 1.5 at
  a negative edge - why not list that as an under?"). **GMG Fair** (our chance, no cut), **Odds**
  (the best price, the book's INITIALS under it, full name on hover; click = every book), **Good To** (fair at our chance - `GOOD_TO` 3 points; only on a
  play, edge 3+: on less it named a price better than the books', "weird"), **Edge** (points, green
  from 3 = a play, red below 0 = not good enough, not graded). The record grades the same rule
  (`props.threes_play(p_over, best_o, best_u, lean)`, best price across every book, positive only).
- Negative-edge rows stay on the board for their data (hit rates, tags); the record never grades them.
- **Columns:** Player, Play, [page's `before`: Threes' Proj Att], Proj (narrow), GMG Fair, Odds, Good
  To, Edge, [page's `after`: 3PA / 3PM or Avg / FGA a game], then **Hit Rate - Based On 3PM / PTS**
  (one group box over L5, L10, Season, Home, Away: the rates count HIS numbers over the line,
  whichever side the play is, so an Under's red isn't bad news; no vs column, "relevant 3 times a
  year"; every cell colored by its % from red at 20% to green at 80%, however
  few games: the "x of y" says how many), [page's `end`: Points' Share, Mix], Tags. **Every column sorts** (click; again flips),
  **Edge by default**; Out players always last. No Min column (2026-10-23). The price columns and
  the numbers (Proj Att, Proj, GMG Fair, Odds, Good To, Edge, the averages) are `th-tight` (as narrow
  as their numbers; the owner: Odds "absolutely too wide"). **Frozen headers:** the board scrolls in
  its own box (`.pts-scroll`, at most the window's height) with `thead` sticky. Points' Share is
  colored by its percentile on Mix's 8-step scale. On PC (1100px+) the board is 10% bigger (`zoom`), the
  page scrolls and the header sticks under the site's top bar (`--pb-top`, measured); smaller screens
  keep the scroll box. Threes' Proj is labeled **Proj Make** (`PB_PAGE.projLabel`).
- **Tags** are `{key, label, cls, title}`; matchup tags green / red (`.gs-tag`), the rest amber
  (`.pts-tag`, same shape). **Tag filter** (`#pts-tag`, replaced the Sort menu): only players with
  that tag. Shared tags: Usage +, and minutes from the injury report: **Min up** = a rotation
  teammate (20+ min) at his spot (guards / forwards / centers) listed Out tonight (not for a player
  already at 32+ min); **Min down** = one who sat the team's last game and isn't listed Out tonight.
  (The last-5 minutes trend tags went with the Min column; the trend is in the projection.)
- **Points' chance of the Over** (`props.points_chance`): a normal count around the projection, sd =
  2.73 + 1.07 x sqrt(proj) (fitted on 2025-26's replay). Points' lines record adds [p_over, best
  Over, best Under] as fields 9-11; a row without them (saved before this) isn't graded.
- Tests: `tests/test_nba_points_site.py`, `tests/test_nba_threes_site.py` (sorting, filter, minutes tags).

## Threes (threes made; built 2026-10-23 on the Points skeleton)

The owner's 10 ideas + 5 of ours, replayed on 2025-26 first (`tools/backtest/nba_threes.py`,
findings in its header). **Tries are predictable, makes mostly aren't** (the owner wants this line
in the page's explainer: "we can predict how many threes a player will try, but not how many
he'll make"), so the projection is tries x make rate.
- **Build:** `props.our_threes` (tries = last-5 minutes x season threes tried a minute, x pace^1.43,
  the other defense's `def_three_pp`^0.52 and `def_catch3`^0.59 (Team Identity, added for this:
  threes a possession, catch-and-shoot share of threes), (last 5 / season minutes)^-0.446, (1 +
  0.037 x his team's spread / 10: underdogs shoot more), (1 + 0.05 x `luck`: last-5 makes above his
  own rate a game, a cold run trims tries), teammates Out like Points (1.51 - 1.725 x share / 0.2);
  make rate = his season's pulled `THREES_K` 200 tries toward the league's). A night's count is a
  negative binomial `THREES_SPREAD` 1.25 x wider than Poisson (the replay: 1+ hits less, 3+ / 4+
  more). **Anchored to the books:** the books' no-vig chance of the Over at the middle line
  (`market_chance`, one side only = its price less 4.5%) -> the makes it implies (`mean_for`), moved
  `PROJ_MAX` x games / (games + `PROJ_K`) toward ours (`project_threes`); edge = our chance of the
  Over - the books'. props.json `threes_slate` (build_nba.py `threes_slate`, its own try: a failure
  never costs Points) with `ladder` = our chance of 1+ .. 5+.
- **Ladder prices:** `smartstake.add_threes_ladder` fetches the threes market with alternates into
  `props["threes_alt"]` (kept apart so the middle main line stays the main line); version.json
  `nba.threes_alt` says what came back. The page shows only rungs a book prices (owner's list #3).
- **Record:** `model_history/nba_props/threes_<season>.json` ({game: {player: [line, proj, ours, w,
  p_over, p_mkt, best Over, best Under, min_ratio, missing, share, luck, spread]}}, never rewritten
  after tip); `props.threes_ledger` grades the play (`threes_play`, the NHL pages' rule since 2026-10-23:
  the side our chance beats its best price by more, a positive edge only) at that price, 1u,
  from `THREES_RECORD_START` 2026-10-23; split tags over / under / half (0.5 lines) / dip / role /
  dog (+6) / cold / hot (0.6 makes a game off his rate). props.json `threes_record.ledger`.
- **Untested idea waiting on this season's lines:** do the books raise a line after lucky shooting
  (makes up, tries flat)? `luck` is saved per line for exactly that.
- **The page** (`site/nba/threes.html` + `threes.js` + `threes.css`, on the shared board above; NBA
  menu under Points): Proj Att (our tries; make rate on hover only, the owner: subtext "muddies the
  page") between Play and Proj; 3PA / 3PM a game after Edge; tags 3s Allowed / Tough 3s D (the
  defense's `def_three_pp` 1+ league spread, and for 3s Allowed his threes 30%+ of his shots), Help
  D (`def_catch3` 1+ spread and his catch share 35%+), Underdog +X (6+), Cold Run / Hot Run. Drop
  down: With / Without on threes (no Off the floor: `with` holds points only), Every Book, **The
  Ladder** (Rung, Our Fair, Best Price, Edge shaded at 3 points), Shot Zones opened on 3PT. Same
  testing banner ("Record So Far" in units).

## The player card (`site/nba/nba-card.js`, 2026-10-21)

The owner: "build the player functionality that exists for NFL and NHL so theres consistency ...
game log and odds for all markets with checkboxes like NFL has ... game logs can be added only for
this season, do not add past years." **Every place an NBA page shows a player wraps him with
`playerClick(id, inner)`** (ESPN id): Game Previews' rotations and injuries, Points, First Basket's
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
  `#p=<id>&d=<TEAM>`). Left: his chart (`nbaShotZonesView` / `nbaShotHeatView`); right: every shot
  that defense allowed (shot[8]), drawn with `{allowed: true}` so the colors flip (**red = it allows
  more than the league**, legend Allows Less / Allows More). One set of filters for both (Last 10 =
  each side's own last 10 games). **Zone By Zone** table: his FG / FG% / vs Lg / Share, the same
  for the defense, the league's FG% and share, and a **Call**: Target / Tough when one side is
  2.5+ points (shrunk by `NBA_SHOT_PRIOR`) from the league and the other isn't 0.75+ the other way
  (matchupCall's rule), only on zones with 5%+ of his shots and 5+ tries. The page's own classes
  are `shc-*` (`sc-*` is the NFL Summary card's). Its global `DATA` is data.json (the card reads it).
  Tests: `tests/test_nba_shot_charts_site.py`, `tests/test_nba_shots.py`.
- Tests: `tests/test_nba_player_card_site.py`, `test_my_plays_site.py` (NbaPlays), `test_nba_props.py`.

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

- `site/nba/index.html` + `nba.js` = NBA Game Previews v1: day strip, The Line (spread, total,
  market score, win chance), The Teams (record, net / off / def rating, pace, home, away, last
  10), Offense vs Defense (13 rows, each offense next to what the other defense allows, colored vs
  the league from each unit's side, same two-sided Mismatch / Tough / Good vs Good tags as the NFL
  cards), Rotations, Injuries, Recent Games. Season buttons under the game header (2025-26 /
  2026-27, `renderSeasons`); a member's pick is remembered only until the build's default changes,
  so nobody is left on last season after the switch. Tests: `tests/test_nba_previews_seasons.py`.
- It does NOT load common.js (NFL-specific); it shares style.css and sync.js. New NBA styles are
  `.nba-*`. The NHL page reuses the layout ones (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app`),
  so check `site/nhl/` after changing them. Pace is shown without a good/bad color (fast or slow isn't good or bad).
- **Not built yet** (waiting on the user's priorities): Summary card, player props, model, picks,
  play-by-play tools (shot zones, quarter splits).

## First Basket (built 2026-10-20, opening night)

Who scores a game's first points. The owner turned down a predictive pick board: "i would rather
this page be the pieces of the puzzle with data for users to solve", with a fair-value guess at
the bottom only. Then, on the plain data mockup: "very data heavy ... no color coding or player
images. I like Team logos too", so it uses the site look (team-color banners, logos, ESPN
headshots, red-to-green `scaleHsla` cells, "i" bubbles for the explanations).

- **Any first points count, free throws included** (the owner: most books settle it that way).
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
- **Testing banner** (2026-10-23, the owner: "add the beta header on first basket"): the Points /
  Threes banner (styles in suite.css since then) at the top: Beta, Projections In Testing Until
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
