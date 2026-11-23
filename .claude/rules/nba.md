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

## Where Each Tool's Rules Are

Each tool's rules are in their own file and load when you open that tool's files: `nba-sim.md`
(props.py, the game sim, Prop Research, Assist Spots), `nba-matchup.md` (Team Identity, League Stats
Chart, Matchup Keys, The Matchup), `nba-player-card.md`, `nba-zones.md`, `nba-predictions.md`,
`nba-types.md`, `nba-standouts.md`, `nba-dunk-digest.md`, `nba-first-basket.md`, `nba-kotc.md`.
`build_nba.py` calls all of them: read the one for the part you are changing.

## Files

- Build: `nfl_tool/nba/build_nba.py` -> `site/nba/data.json`. `possessions.py`: the engine (every
  possession with the ten on the floor; every new NBA tool reads it). `identity.py`: Team Identity.
  `props.py`: player props data (`nba/props.json`). `sim.py`: the Points / Threes / Rebounds /
  Assists game sim. `positions.py`: PG / SG / SF / PF / C. `shots.py`: shot spots (`nba/shots.json`).
  `zone_matchups.py`: Zone Matchup Targets. `kotc.py`: King of the Court. `first_basket.py`: First
  Basket. `watch.py`: injury / market watch. `nba_report.py`: the NBA's injury report PDF.
  `espn_late.py`: last night's finals from ESPN before hoopR has them. `narrative.py`: Dunk Digest's Narrative.
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
  (`shot_types.py`); `dunk-digest.html/.js/.css` Dunk Digest (owner only, below).
- Records (`model_history/`): `nba_props/sim_<season>.json`, `nba_zones/<season>.json`,
  `nba_first_basket/<season>.json`, `nba_kotc/` (nightly boards, `lines_<season>.json`).

## This season only, no exceptions

- **Biography is not stats:** Dunk Digest's Narrative may read a player's career teams, hometown and college (the
  owner, 2026-11-18). Nothing from it reaches a number, model, tag or any other page.
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

## The owner's open list

- **Alt-line ladder only with real alt prices** (SmartStake `alternate=true`), narrow.
- **Rotation chart:** when a player subs in / out, who he plays with, production by combo (stints).
- **Things to watch** per game: a few conclusions from Team Identity.

## Suite switch

- The top menu (`addTopMenu`, sync.js) lists each sport's pages (`SPORT_PAGES`).
- **Both suites are open to every member** (`SUITE_SWITCH_PUBLIC = true` -> `html.suite-public`).
  **Never set it back to false unless the owner asks** (`test_the_suite_is_open_to_every_member`).
- NBA / NHL pages are paying members' pages: check them with `tools/check_site.py --only nba` /
  `--only nhl` when chasing a problem there.
- No owner "Update Odds" buttons.

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
