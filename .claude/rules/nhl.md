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
- **Novig** has NHL on the same feed (`events?league=NHL`, same `EventMarkets_Query`). Game
  lines: the consensus MONEY, SPREAD (the puck line, 1.5) and TOTAL. Player odds (below):
  PLAYER_GOALS, SHOTS_ON_GOAL, POINTS, ASSISTS, FIRST_GOAL_SCORER. Unused so far: TEAM_TOTAL.
  No goalie saves market was listed (checked 2026-10-13). Futures events (no " @ ") are skipped.
  Same odds lock as NBA: only `OPEN_PREGAME` events, and a started game keeps the lines and the
  player odds of the last build before puck drop (`apply_lines`, `locked_player_odds`).
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
- **`nfl_tool/nhl/prior_2026.json.gz`** (0.5 MB, committed): 2025-26's team, skater and goalie
  numbers plus every player's game log and shot areas (`detail`) and the league's area averages
  (`league`), written once with `--season 2026 --write-prior nfl_tool/nhl/prior_2026.json.gz`
  (about 10 seconds when the games are already in `data/nhl`). Do the same for 2026-27 when it
  ends, and re-run it whenever `reduce_game` gains a stat the card should show for last season.
  It lets the page show last season while this one is young without CI downloading 1,300 old
  games.
- `default_view` is `prev` until the middle team has played `MIN_GAMES_FOR_CURRENT` (10) games.
- `reduce_game` boils one game down to team counts, skater lines and goalie lines; the season
  numbers are sums of those. Shootouts count only in the final score. Checked against the
  league's own 2025-26 reports: goals exact, shots on goal within 0.07 a game, 5v5 shooting %
  exact.
- **Rink areas** (`shot_area`; the same shapes are drawn by `RINK_ZONES` in nhl-common.js, change
  both together): `low_slot` (the box in front of the net to the faceoff dots, 9 ft either side: the
  usual "high danger" area), `slot` (the rest of the "home plate" up to the top of the circles),
  `left` / `right` (beside it, as the shooter sees it, including behind the goal line), `point`
  (top of the circles to the blue line), `long` (outside the zone). Area numbers leave out
  blocked shots, empty-net shots and penalty shots.
- Output: `teams`, `team_stats` and `team_stats_prev` (every stat as `off_*` and the matching
  `def_*` allowed, plus record, power play, penalty kill), `recent_games`, `skaters` (12 forwards
  and 6 defensemen a team, each with last season's line as `prev`), `goalies`, `injuries`,
  `schedule` (yesterday through 14 days out, Novig lines, `away_rest` / `home_rest` days),
  `player_odds` (`{game id: {player id: odds}}`), `league` (each area's share of shots and
  shooting %, `season` and `prev`), `novig_debug`, `feed_debug`.
- **Player files** (`write_player_files`): `site/nhl/players/<TEAM>.json`, one per team, written
  next to data.json on every build and not tracked by git. Each holds, for everyone whose latest
  game was with that team, `season` and `prev`: the game log (one row per game: `log_lead` then
  `skater_cols` / `goalie_cols`), `areas` (skater `{area: [shots, on goal, goals]}`, goalie
  `{area: [shots faced, goals]}`), and for skaters `types` (shot type: `[shots, goals]`), `unb`
  and `pp_unb`. The page loads a team's file when one of its games is opened, so data.json stays
  small (the files are about 80 KB each, mostly last season's logs).
- **Player odds** (`player_odds_from_event`), same spirit as the NFL build's TD odds:
  - Over / unders (`sog`, `points`, `assists`) use the consensus line only and need at least
    one side priced; `thin` = one side missing or the two asks adding past 115%.
  - The other shots-on-goal and goals lines ride along as ladders (`sog_alts`, `goal_alts`:
    `[line, over price]`).
  - Anytime goal (`goal`) = goals over 0.5. One-sided prices are kept (most depth players have
    no "No"); the chance is Yes/(Yes+No), or Yes times the game's median fair/Yes ratio. Dropped:
    Yes above 0.95, or Yes+No above 1.5.
  - **First goal: most of Novig's prices are placeholders.** On 2026-10-13 one game listed 27
    of 31 skaters at 21-27% with nobody on the other side (defensemen included). A one-sided
    first-goal price is kept only if it is at most half the player's own anytime price
    (`FIRST_GOAL_MAX_SHARE`); chances are scaled down if they add past 100%, never up. Expect
    only a few first-goal prices a game until that book fills in.
  - Players are matched to the NHL's ids by `player_finder`: exact name (accents dropped), then
    last name + first initial on the team, then a name only one player in the league has. Two
    possible players = no match (never a guess).
- The power play and penalty kill come from the league's reports; `def_pp_pct` (what a penalty
  kill allows) is `1 - pk_pct`, so a power play row reads both sides.
- Times use the offset the feed gives for each game (`easternUTCOffset`), so the November clock
  change is already right.
- `lineup` discounts ice time for a player with only a game or two (the lineup-aware usage rule).
- Team colors are `TEAM_COLORS` (ESPN's; teams whose main color is black use their second).

## Pages

- **`site/nhl/nhl-common.js` is shared by every NHL page** and loads first: the data
  (`loadNhlData`), the season switch (`view`), helpers, the rink drawing (`rinkSvg`) and the
  player card. A new NHL page adds its own script after it and defines `render()` (called when
  the season or theme changes) and, if it has a selected game, `currentGame()`.
- `site/nhl/index.html` + `nhl.js` = NHL Game Previews v1: day strip, a season switch (this
  season / last season), The Line (moneyline with win chance, puck line, total), The Teams (10
  tiles), Offense vs Defense (7 rows, same two-sided tags as NBA), Where the Shots Come From (a
  rink per offense), Goalies, Skaters, Injuries, Recent Games (with who started in net).
- **The player card** (nhl-common.js) is the ONE popup for every skater and goalie on every NHL
  page: wrap any name or photo with `playerClick(id, inner)`. **Any new place that shows an NHL
  player must use it.** It reuses the NFL card's shell (`#player-card-modal`, `.pc-box`,
  `.pc-head`, `.player-modal-toggle`); the NFL `player-card.js` is not loaded on NHL pages.
  - Tabs in the user's order: **Game Log** (opens here), **Shot Map**, **Odds**, plus the season
    switch, which is the same setting as the page's.
  - Game Log: newest first with a per-game row on top. Ice time, shots on goal and attempts are
    shaded against the player's own games; goals, assists and points only light up when he
    scored (zeros stay plain, or the whole table is red).
  - Shot Map, skater: a rink shaded by where his shots come from (brighter green = more of his
    shots; the strip outside the zone is never shaded) and a table from the net out: shots per
    game, share, on goal, goals, shooting % next to the league's, and what tonight's opponent
    allows from there with its rank (colored from the defense's own side, like every "allows"
    number). Chips: goals a league-average shooter would have on the same shots from the same
    areas, power play share, shot types.
  - Shot Map, goalie: save % by area. A zone is colored only with 30+ shots faced and goals 1.5
    standard deviations from what the league allows on them (`goalieAreaTier`): luck alone
    should not paint a zone.
  - Odds: the lines above for the player's game (the open one, else his team's next), with
    `thin` tags and the ladders as "N or more" chips. Goalies have no lines.
  - A team whose file can't be read still opens the card (season tiles and odds only).
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
  `tests/test_nhl_site.py` (the page and the player card in a browser on a saved `nhl/data.json`
  and two saved player files, NJD and DET). They run with the rest
  (`python tools/run_tests.py`), so a broken NHL test stops a deploy like any other.
- `tools/fetch_live_data.py` also downloads the live player files, so the after-deploy site
  check sees the page as members do.
- `tools/check_site.py` opens the NHL page; like the NBA page it can never block the deploy gate.
- `https://nfl.gmgsports.org/version.json` shows whether the NHL build worked: `nhl.built`,
  `games` / `wanted`, `downloaded`, `lines`, `player_odds`, or `error` (the build's last line)
  when it failed.

## Not built yet (waiting on the user's priorities)

The user's next tools (2026-10-13), each built on the player card and `player_odds`: an anytime
goal scorer tool, a shots on goal tool, a goalie saves tool (no saves market on Novig yet).
Also open: expected goals, a Summary card, a model, line combinations from the shift charts,
shot-by-shot dot maps, the EDGE tracking stats, playoffs.
