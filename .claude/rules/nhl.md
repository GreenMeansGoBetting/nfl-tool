---
paths:
  - "nfl_tool/nhl/**"
  - "nfl_tool/site/nhl/**"
---
# GMG NHL Suite

Started 2026-10-13, a week into the 2026-27 season (84 games a team this year, 1,344 in all).
Third suite on the same site, reached from the suite dropdown and **owner / localhost only until
launch**, exactly like the NBA suite (same switch: see nba.md, "Suite switcher and launch
switch"). More background: `docs/history.md`, "NHL".

## Data: the NHL's own public feed (no key)

- **Do not use MoneyPuck** (moneypuck.com). Its data page allows non-commercial use only and says
  unapproved scraping is blocked; this site has paying members. Everything MoneyPuck starts from
  is in the league's feed, so the numbers are worked out here instead.
- No source explicitly permits commercial use: NHL.com's terms read "personal, non-commercial",
  the same footing as the ESPN and NFL feeds behind the other suites. The user was told.
- `api-web.nhle.com/v1`: `schedule/{date}` (a week at a time), `standings/now` and
  `standings/{date}`, `gamecenter/{id}/play-by-play`, `gamecenter/{id}/boxscore`. Also there,
  unused so far: `gamecenter/{id}/landing` (pregame goalie and skater comparison) and the EDGE
  tracking pages (`edge/team-detail/{teamId}/{season}/2`,
  `edge/team-shot-location-detail/...`: shot speed, skating speed, zone time, shots in 17 areas).
- `api.nhle.com/stats/rest/en`: `game?cayenneExp=season=20262027 and gameType=2` (the whole
  season's game list in one call; `gameStateId` 6 / 7 = finished), `team` (ids), the season
  reports `team/powerplay`, `team/penaltykill`, `skater/timeonice` (`limit=-1` = every row).
  Unused so far: `shiftcharts?cayenneExp=gameId=...` (who is on the ice: line combinations).
- **Play-by-play** gives every shot on goal, miss, blocked shot, goal, hit, faceoff, giveaway,
  takeaway and penalty with `xCoord` / `yCoord` (feet from center ice; goal lines at x = ±89),
  shot type, shooter, goalie and `situationCode` (four digits: away goalie, away skaters, home
  skaters, home goalie; `1551` = five a side).
  - `homeTeamDefendingSide` says which end the home team defends that period. `normalize_xy`
    turns every shot so the net attacked is at x = +89 and the shooter's left is +y. Checked on
    all of 2025-26: 109,571 of 109,571 offensive / defensive zone shots agree with the feed's own
    zone code, and left / right leans match the NHL's EDGE "L" / "R" areas.
  - A blocked shot is logged where it was BLOCKED and its `eventOwnerTeamId` is the shooter's
    team, so blocked shots count as attempts but are never placed on the rink.
- **ESPN** (`site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries`): injuries. Teams and
  players are matched to the NHL's by name with accents dropped (`plain`).
- **Novig** has NHL on the same feed (`events?league=NHL`, same `EventMarkets_Query`). Used: the
  consensus MONEY, SPREAD (the puck line, 1.5) and TOTAL. Also there, unused so far: TEAM_TOTAL,
  PLAYER_GOALS, SHOTS_ON_GOAL, POINTS, ASSISTS, FIRST_GOAL_SCORER. Futures events (no " @ ") are
  skipped. Same odds lock as NBA: only `OPEN_PREGAME` events, and a started game keeps the lines
  of the last build before puck drop (`apply_lines`).
- **Not in any free feed found so far:** confirmed starting goalies. The page lists each team's
  goalies and never names a starter.
- **Not built:** expected goals (xG). It is a model on shot location and type, not a feed field;
  sportsdataverse publishes an open one (`nhl_xg_models`, license not checked).

## Build (`nfl_tool/nhl/build_nhl.py`)

- `--season 2027 --out nfl_tool/site/nhl/data.json --data-dir data/nhl` (seasons are named by the
  year they END, like the NBA build; the NHL's own id is `20262027`). Regular season only.
- **Games are downloaded one at a time and kept.** Hockey has no season files like nflverse or
  hoopR. Each finished game's raw play-by-play + box score is saved to
  `data/nhl/games/<season>/<id>.json.gz` once the league marks it official (`gameState` "OFF"),
  and never downloaded again. The raw game is kept (about 17 KB), not the totals, so new stats
  can be added without re-downloading.
- deploy.yml: "Restore saved NHL games" / "Save NHL games" (GitHub's cache, `nhl-games-*`) carry
  `data/nhl` between runs; "Build NHL data" is `continue-on-error`, so it can never block the
  NFL deploy. A lost cache just means the season so far is downloaded again (2025-26's 1,312
  games took about 4 minutes from the user's PC).
- **`nfl_tool/nhl/prior_2026.json.gz`** (60 KB, committed): 2025-26's team, skater and goalie
  numbers, written once with `--season 2026 --write-prior nfl_tool/nhl/prior_2026.json.gz`. Do
  the same for 2026-27 when it ends. It lets the page show last season while this one is young
  without CI downloading 1,300 old games.
- `default_view` is `prev` until the middle team has played `MIN_GAMES_FOR_CURRENT` (10) games.
- `reduce_game` boils one game down to team counts, skater lines and goalie lines; the season
  numbers are sums of those. Shootouts count only in the final score. Checked against the
  league's own 2025-26 reports: goals exact, shots on goal within 0.07 a game, 5v5 shooting %
  exact.
- **Rink areas** (`shot_area`; the same shapes are drawn by `RINK_ZONES` in nhl.js, change both
  together): `low_slot` (the box in front of the net to the faceoff dots, 9 ft either side: the
  usual "high danger" area), `slot` (the rest of the "home plate" up to the top of the circles),
  `left` / `right` (beside it, as the shooter sees it, including behind the goal line), `point`
  (top of the circles to the blue line), `long` (outside the zone). Area numbers leave out
  blocked shots, empty-net shots and penalty shots.
- Output: `teams`, `team_stats` and `team_stats_prev` (every stat as `off_*` and the matching
  `def_*` allowed, plus record, power play, penalty kill), `recent_games`, `skaters` (12 forwards
  and 6 defensemen a team, each with last season's line as `prev`), `goalies`, `injuries`,
  `schedule` (yesterday through 14 days out, Novig lines, `away_rest` / `home_rest` days),
  `novig_debug`, `feed_debug`.
- The power play and penalty kill come from the league's reports; `def_pp_pct` (what a penalty
  kill allows) is `1 - pk_pct`, so a power play row reads both sides.
- Times use the offset the feed gives for each game (`easternUTCOffset`), so the November clock
  change is already right.
- `lineup` discounts ice time for a player with only a game or two (the lineup-aware usage rule).
- Team colors are `TEAM_COLORS` (ESPN's; teams whose main color is black use their second).

## Pages

- `site/nhl/index.html` + `nhl.js` = NHL Game Previews v1: day strip, a season switch (this
  season / last season), The Line (moneyline with win chance, puck line, total), The Teams (10
  tiles), Offense vs Defense (7 rows, same two-sided tags as NBA), Where the Shots Come From (a
  rink per offense), Goalies, Skaters, Injuries, Recent Games (with who started in net).
- It reuses the NBA page's layout classes (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app` /
  `.nba-soon` for the owner-only guard); hockey-only styles are `.nhl-*`. It does not load
  common.js.
- **The rink colors mean how MANY shots, not good or bad** (a lot of point shots isn't a
  strength). `rinkCall` is two-sided like the NFL site's `matchupCall`: green ("more") needs one
  side clearly above the league and the other not pointing the other way; red is the mirror. The
  strip outside the zone is never colored.
- The season switch is not remembered between visits; the page always opens on `default_view`.
- Logos are the NHL's SVGs, with a dark-page version (`logo_dark`); the page redraws on a theme
  switch.

## Tests and checks

- `tests/test_nhl.py` (the build, on one saved game and one saved Novig event) and
  `tests/test_nhl_site.py` (the page in a browser on a saved `nhl/data.json`). They run with the
  rest (`python tools/run_tests.py`), so a broken NHL test stops a deploy like any other.
- `tools/check_site.py` opens the NHL page; like the NBA page it can never block the deploy gate.
- `https://nfl.gmgsports.org/version.json` shows whether the NHL build worked: `nhl.built`,
  `games` / `wanted`, `downloaded`, `lines`, or `error` (the build's last line) when it failed.

## Not built yet (waiting on the user's priorities)

Expected goals, a Summary card, player props (shots on goal, points, goals, first goal: Novig
has the markets), a model, line combinations from the shift charts, player shot maps, the EDGE
tracking stats, playoffs.
