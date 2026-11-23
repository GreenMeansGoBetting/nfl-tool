---
paths:
  - "nfl_tool/nba/identity.py"
  - "nfl_tool/site/nba/league*"
  - "nfl_tool/site/nba/matchup*"
  - "nfl_tool/site/nba/who.js"
  - "nfl_tool/site/nba/keys.js"
  - "nfl_tool/site/nba/index.html"
  - "nfl_tool/site/nba/identity.html"
---
# NBA: Team Identity, League Stats Chart, Matchup Keys and The Matchup

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

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
  places lower), Not Tested (a weak defense the offense rarely tests). **The glass, both ends**
  (2026-11-17): Same Style on DREB% too (Both Own / Both Weak On The Defensive Glass); **Rebound
  Chances** = the glass's volume, missed shots a game (`o_miss` / `d_miss`, chart columns Misses / Opp
  Misses): the offense misses a lot and the defense's opponents miss a lot (one top 10, the other top
  half) = the defense's Edge; the mirror = Few Rebound Chances (clash group, a "Few Misses" Read in the
  Rebounding box's Misses row).
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
  - **Who's behind it also shows Allowed By Type** (`whoTypeBox`, 2026-11-11): stacked under Allowed By Position beside the
    player box (`.mb-who-stack`; the owner, 2026-11-18: in a row it "stretched" the pop-up), the
    defense against each letter in the offense's rotation (over their own averages; threes on Threes, points
    elsewhere), beat-average x / y, the offense's shot share per letter; 1st = allows the least, 6+ games.
  - **Every colored box with a player split opens who's behind it** (`who.js` `whoOpen(topic, game)`;
    a member asked for Paint FG% on 2026-11-09, the owner made it every box): for the topic (`WHO`:
    scoring, transition, threes, paint, mid, turnovers, glass, ft, ballmove; `whoTopic` maps a league-chart
    key or a Matchup row) **every player who has played for the team** (the owner, 2026-11-13: "every
    player regardless of stats"; a top-6 cut hid Harden), rotation (12+ min, 3+ games) first by the main
    number, the rest faded (`mb-who-bench`). **A team's own DEF box opens its own players** where they
    have a number (`WHO_OWN`: rebounding -> DREB `glassD`, turnovers -> steals `turnoversD`; the owner:
    "Im never going to click on a knicks button to see pacers players"); other DEF boxes (threes, paint ...
    allowed) still open the offense's players. Each number tiled by its place among the league's
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
    **Head To Head** (tabs Season / Quarters / Blowouts & Spots; tonight's spots via extremes.js; a Quarters
    label opens all 30 teams' quarter margins ranked, a head re-sorts, tonight's two in color, `mhQuarterOpen`) beside
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
