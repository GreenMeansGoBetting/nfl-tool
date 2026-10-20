---
paths:
  - "nfl_tool/nba/**"
  - "nfl_tool/site/nba/**"
---
# GMG NBA Suite

Started 2026-10-11; the 2026-27 season tips off 2026-10-20. The user wants the NBA version of the
site on the same website, reached from a suite dropdown. The brand is "GMG Sports Data Suite";
NFL and NBA are suites inside it. More background: `docs/history.md`, "NBA".

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
- A season's box / pbp files don't exist until its first game (404). Game Previews carries both
  seasons (`stat_seasons`, built 2026-10-20, opening night): last season's with players placed on
  this season's rosters, this season's once it has games. The top-level `team_stats` /
  `recent_games` / `players` are the default season's (`stats_season`, `is_fallback_season`): this
  season once the middle team has played `THIS_SEASON_DEFAULT_AT` (4) games, the same rule King of
  the Court uses (the owner: "sooner than later default to this season"). Without this the page
  would have jumped to 1-game numbers the morning after opening night.
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
  nights: likely starters, jumper, fair guess), `default` (this season once there are 4 games a team).
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
- **Fair value guess** (`fair_prices`): tip from the two jumpers (each steadied with 6 coin-flip
  jumps), first points = tip x the league's tip-winner rate, each starter's share from first points
  per start steadied 10 starts toward his teammates', 4% to the bench. Not replayed or tracked yet.
- **The page** (`site/nba/first-basket.html` + `first-basket.js` + `first-basket.css`; NBA menu
  under "Player props"): day strip, season buttons, then two pieces. **The Matchup** (`renderMatchup`,
  `matchupRows`): ONE table, road team's value left, home team's right, the stat name + league
  average in the middle with an **Edge** pill (better side's logo, when they're `edge` apart),
  grouped The Tip / Scoring First / Opening Trips / First FG Allowed. The owner turned down the
  first version (separate tile sections, team cards, a split bar) as "overwhelming ... so much dead
  space ... too many numbers all spread everywhere" and asked for "stats stacked with team columns
  and the data side by side" with "an edge column". **Every row is one fixed height (46 px; 62 px on
  phones), centered, small notes BESIDE the number, never under it** (the owner: "keep them all
  consistent"). Each value is colored against the league from its own team's side (green = good
  for that team; First FG Allowed: red = that position scores first on them often). **Starters**:
  one table per team (lineup tag on the banner), shot early / 1st shot / scored 1st as % with "x of
  y" under, and the fair price as the last column, best first. Team numbers are colored against
  all 30 teams, players against starters with 15+ starts (fewer: plain).
- Tests: `tests/test_nba_first_basket.py` (the build on two hand-made games, and the page).
- Not built yet: books' first-basket prices (SmartStake), a graded record of the guess, a Summary card.

## King of the Court (Promo Tools; built 2026-10-19)

DraftKings' promo paid on the night's most points + rebounds + assists (PRA). The owner ran it
last season from a spreadsheet and wanted the same setup, built for the 2026-10-21 slate:
- a **defense board** (each team's 40 / 45 / 50 / 55 / 60+ PRA games allowed, colored, with a
  score: "do teams let certain stars beat them or do they play top to bottom solid D?"), plus
  **position vulnerability** (their ask);
- a **player board** (each player's games in those buckets, a score, the opponent's matchup score,
  a blended GMG number);
- a **2025-26 / 2026-27 toggle** ("after a week of the season, i think the new data (even with a
  small sample) is better because of how many trades etc occur, but the toggle would still be great");
- **historic stats on nightly leaders** (games on the night, the winner's PRA, and anything about
  the game total / spread that narrows it down). They skipped the mockup to save usage: build it,
  then small tweaks.

- **Build:** `nfl_tool/nba/kotc.py`, called by `compute_kotc` in build_nba.py (its own try: a
  failure leaves `kotc: null` and Game Previews still builds). Output `data.json` `kotc`:
  `seasons[<year>]` (`label`, `league`, `defense`, `players`, `nights`, `summary`), `slates[<year>]`
  (`{date: rows}` for the next 3 nights, each projected from that season), `default` (this season
  once the middle team has played 4 games, else last season), `weights`, `thresholds`, `record`.
- **Buckets are cumulative** (a 52 counts in 40+, 45+, 50+); Score = 1 x 40+ ... 5 x 60+.
- **Positions are G / F / C:** ESPN labels nearly everyone that way (2025-26: G 13,010 player-games,
  F 9,717, C 3,889; PG / SG / SF / PF about 100 in all). The owner asked "do they use SF/PF/PG/SG?":
  no. A defense's position number is PRA per 48 minutes allowed to that group, steadied with 10 games
  of the league's rate (`pos_f` = against the league).
- **Last season on this season's rosters:** a player's last-season row sits on the team today's
  roster file lists him with; not on a roster = off the board. In this season's view each average
  starts with 5 games of his last season (`PRIOR_GAMES`, until 30 games).
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
- **The record** (`model_history/nba_kotc/<season>.json`): each night's top 30 by Lead % as the last
  build before the night's first tip had it (`kotc_record`; a started night is never rewritten). The
  page's Nightly leaders show the winner's place on it ("Pre 3"). NBA builds run every 6 hours and on
  pushes (no half-hourly refresh like the NHL), so a night's board can be up to 6 hours old at tip.
- **Historical Data** (`summary`, computed every build): winning PRA by slate size (typical, middle
  half, best), the leader's game total and spread against the games on those nights (2025-26: 240+
  totals 1.31x their share, under 220 0.37x; spreads 0-3 1.22x, 10+ 0.77x; the leader's team was
  favored 70%), positions (guards 47%), most nights led. Shows last season's until this season has
  20 nights.
- **The page** (`site/nba/promo-tools.html` + `kotc.js` + `kotc.css`): night arrows, season buttons
  (this season's disabled until it has games), Save image; the player board (top 25, "Show all"; Lead
  %, Proj, Avg, L10, buckets, Score, Opp, Matchup, vs Pos, Total, Spread; green = good for him; B2B,
  "from XXX" and blowout tags), Nightly leaders beside it (outside the image), then the defense board
  (red = bad defense, the owner's sheet; teams not playing dimmed; its own Save image). It does no
  projection math. Headshots and logos are ESPN's (html-to-image can carry them).
- Tests: `tests/test_nba_kotc.py` (the build on a hand-made season) and `tests/test_nba_kotc_site.py`
  (the page on a data.json built from it; `SiteBrowser.nba` serves it).
- Not built yet: players' PRA lines from the books (SmartStake / Novig), a with/without-teammate
  usage bump, DraftKings payouts (King of the Crease's Winners idea), pace.
