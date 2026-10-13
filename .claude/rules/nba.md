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

- `addSuiteSwitcher` (sync.js; `.suite-*` styles): the topbar brand ("GMG NFL SUITE") becomes a
  dropdown listing every suite in `SUITES` (NFL, NBA, NHL since 2026-10-13).
- **Owner / localhost only until launch** (`SUITE_SWITCH_PUBLIC = false`); for everyone else the
  brand is still a plain link home. The NBA pages are guarded the same way (`.nba-app` hidden,
  `.nba-soon` "being built" note shown).
- **To launch:** set `SUITE_SWITCH_PUBLIC = true` (adds `html.suite-public`, which opens both).
  One switch covers NBA and NHL: the NHL page uses the same `.nba-app` / `.nba-soon` guard, so
  launching one without the other needs a second switch first.

## Data: sportsdataverse / hoopR

The basketball sister of nflverse. Season files are GitHub release assets at
`sportsdataverse/sportsdataverse-data` (tags `espn_nba_*`, files named by the year the season
ENDS: 2027 = 2026-27), scraped from ESPN and refreshed daily in season.

- Checked 2026-10-11: `espn_nba_pbp` (play-by-play, ~640k plays a season, shot coordinates,
  players, clock, score), `espn_nba_team_boxscores`, `espn_nba_player_boxscores`,
  `espn_nba_schedules`, `espn_nba_rosters`, `espn_nba_depthcharts` and `espn_nba_injuries` (daily
  snapshots), plus `nba_stats_*` sets (shots, lineups, possessions).
- Parquet only is practical (the pbp CSV is 275 MB), so `pyarrow` is in requirements.txt.
- A season's box / pbp files don't exist until its first game (404); the build then uses last
  season's stats (`is_fallback_season`) with players placed on this season's rosters.
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
  cards), Rotations, Injuries, Recent Games.
- It does NOT load common.js (NFL-specific); it shares style.css and sync.js. New NBA styles are
  `.nba-*`. The NHL page reuses the layout ones (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app`),
  so check `site/nhl/` after changing them. Pace is shown without a good/bad color (fast or slow isn't good or bad).
- **Not built yet** (waiting on the user's priorities): Summary card, player props, model, picks,
  play-by-play tools (shot zones, first basket, quarter splits).
