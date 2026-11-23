---
paths:
  - "nfl_tool/nba/sim.py"
  - "nfl_tool/nba/props.py"
  - "nfl_tool/nba/research.py"
  - "nfl_tool/nba/reads_record.py"
  - "nfl_tool/nba/watch.py"
  - "nfl_tool/site/nba/research.js"
  - "nfl_tool/site/nba/spots.js"
  - "nfl_tool/site/nba/sim.css"
  - "nfl_tool/site/nba/filters.js"
  - "nfl_tool/site/nba/points.html"
  - "nfl_tool/site/nba/threes.html"
  - "nfl_tool/site/nba/rebounds.html"
  - "nfl_tool/site/nba/assists.html"
  - "nfl_tool/site/nba/assist-spots.html"
  - "nfl_tool/site/nba/all-props.html"
  - "tools/nba_reads_capture.py"
---
# NBA: Player Props Data, The Game Sim, Prop Research and Assist Spots

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Player props data (`props.py`)

- **Pure data, no projection** until replayed against this season's real lines. **Prices:
  SmartStake**, Novig only where SmartStake has no price.
- `season_block`, `on_rosters`, called by `compute_props`, written to **`site/nba/props.json`**
  (gitignored, in `fetch_live_data.py` SUITES): `fields`, `players[<espn id>]` (name, team, pos, `log`,
  `share`, `zones`, `kinds`, `assisted`, `with[<teammate>]` on / off splits for `MIN_TOGETHER` 20+),
  `out[<team>][<game id>]`. Backtest copy: `props_2026.json` (re-save:
  `py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write`).
- **SmartStake** (`nba_odds.fetch_nba_book_odds`, nfl_tool/nba/nba_odds.py): points key from `/v1/markets` (`nba_prop_market_keys`: the
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
  change presses `nba-refresh.yml` (deploy.md), built with `--fast-odds`
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
  **Targets** (by Player Type since 2026-11-13, the owner: an assist is a teammate's make) = sum over his
  top 4 teammates of (share of his assists) x (that teammate's main letter's **assisted makes** over their
  own averages against tonight's defense, `typeStick("assisted")` on shot_types `am_diff`, / his own
  assisted makes a game, floor `TGT_FLOOR` 2). Assisted only (the owner: a ball-dominant type scoring on
  his own creates no assists). A teammate with no type or under `SPOT_TM_MIN` **3** games of his letter
  vs that defense isn't counted (the owner, 2026-11-13: rare letters like Davis's I sat unranked at the
  site's 6); 3-5 games count but the Vs Type tile is faded (`thin`, `rs-small`). Other pages keep `TM_MIN` 6.
  **A borderline teammate whose main letter is under 3 games is read by his lean** (the owner: Davis "I / G"
  vs IND, one Type I game; the tile shows the lean's letter, the hover says so, `leanNote`). On 11/11-13: 33 Lean+ Targets reads vs the position
  version's 43 (40+ assist players). Reads saved before 11/13 used positions (`dag`); **Types** = his mix x (the defense's shots
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
  the grid, Total % column, Total row % vs the league, the defense row and **Vs Type** purple: his letter + the
  defense's rank vs it on assisted makes). Its own grid (`sp-who`, the owner 2026-11-13): a 188px name
  column (short name, Out / Doubtful tag, position, `nbaTypeBadge`), the five assist types 48px under
  small headers; **Everyone Else +N opens to every teammate he has assisted** (`SPOT_ALL`, "Top 4" folds
  it; the box scrolls, header pinned) so fill-ins for an injured starter show, Assist Types,
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
