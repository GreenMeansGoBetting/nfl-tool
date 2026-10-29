---
paths:
  - "nfl_tool/nhl/**"
  - "nfl_tool/site/nhl/**"
---
# GMG NHL Suite

The NHL suite inside "GMG Sports Data Suite" (started 2026-10-13; 84 games a team, 1,344 in all),
open to every member (one switch with the NBA suite: nba.md, "Suite switcher and launch switch").
This file holds the rules only. The owner's words, dates and replay numbers behind each one are
in `docs/history.md`: "NHL", and "2026-10-29: the NHL rules file before the trim" (the full old text).

## Files

- Build: `nfl_tool/nhl/build_nhl.py` -> `site/nhl/data.json`, `nhl/shots.json` +
  `nhl/players/<TEAM>.json` (games kept in `data/nhl`). Models: `shots_model.py` (shots on goal),
  `saves_model.py` (King of the Crease + Saves, `nhl/saves.json`), `goals_model.py` (anytime,
  `nhl/goals.json`), `points_model.py` (1+ point on top of goals, `nhl/points.json`),
  `lines_model.py` (Line Matchups, `nhl/lines.json`). `stacks_model.py` (retired Line Stacks) stays
  for the replays.
- Pages (`site/nhl/`): `index.html` + `nhl.js` Game Previews; `shots`, `goals`, `points`, `saves`
  (`.html` + `.js` each); `lines.html/.js` Line Matchups; `best.html/.js` Best Plays;
  `promo-tools.html/.js` King of the Crease + `icebreaker.js`; `nhl-common.js` shared by every page;
  `nhl.css`.
- Records (`model_history/`): `nhl_shots/<month>.json`, `nhl_goals/`, `nhl_points/`, `nhl_saves/`,
  `nhl_stacks/` (retired), `nhl_crease/`, `nhl_icebreaker/`.
- Replays: `tools/backtest/nhl_*.py` (shots, saves, goals, goals_ideas, goals_check, points,
  points_check, stacks, icebreaker, pp_units); `tools/nhl_factor_report.py`.
- Hockey refresh: `.github/workflows/nhl-refresh.yml` every half hour, pressed by the Cloudflare
  timer `workers/nhl-timer` (installed by `nhl-timer.yml`).

## This season only, everywhere

- **No last-season number on any NHL page or in any NHL model**: not a player's old rate, not a
  defense's old numbers, not a starting point that fades, no season switch. Do not re-offer last
  season as a fallback or a blend. Past seasons are for the replays only (they download their own
  games). Removed for good: `prior_2026.json.gz`, `--write-prior`, `default_view`,
  `team_stats_prev`, `prev_season_label`, each player's `prev`.
- What steadies a small sample comes from this season too (this season's league averages).
- Game Previews opens on this season with a "small sample" note until the middle team has 10 games.
- The owner knows the cost (early-season projections are rougher); explain it only if asked.

## Data: the NHL's own public feed (no key)

- **Never MoneyPuck** (non-commercial only; this site has paying members). Never scrape paid
  products (Rotowire, Daily Faceoff, DraftKings). No source explicitly permits commercial use;
  NHL.com's terms read "personal, non-commercial" (the owner was told).
- `api-web.nhle.com/v1`: `schedule/{date}`, `standings/now` / `{date}`,
  `gamecenter/{id}/play-by-play`, `/boxscore`. Unused: `/landing`, the EDGE tracking pages.
- `api.nhle.com/stats/rest/en`: `game?cayenneExp=season=20262027 and gameType=2` (`gameStateId`
  6 / 7 = finished), `team`, `team/powerplay`, `team/penaltykill`, `skater/timeonice`
  (`limit=-1`), `shiftcharts?cayenneExp=gameId=...` (who is on the ice).
- **Play-by-play:** every event with `xCoord` / `yCoord` (goal lines at x = ±89), shot type,
  shooter, goalie, `situationCode` (away goalie, away skaters, home skaters, home goalie; `1551` =
  five a side). `normalize_xy` (from `homeTeamDefendingSide`) puts the net attacked at x = +89,
  shooter's left = +y. A blocked shot is logged where it was BLOCKED with the shooter's team as
  `eventOwnerTeamId`: counts as an attempt, never placed on the rink.
- **ESPN** injuries (`site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries`); names matched
  with accents dropped (`plain`).
- **Novig** (`events?league=NHL`, `EventMarkets_Query`): MONEY, SPREAD (puck line 1.5), TOTAL;
  player PLAYER_GOALS, SHOTS_ON_GOAL, POINTS, ASSISTS, FIRST_GOAL_SCORER, SAVES. Unused: TEAM_TOTAL,
  POWER_PLAY_POINTS. Futures (no " @ ") skipped. Odds lock as NBA: only `OPEN_PREGAME`; a started
  game keeps the last pre-puck-drop build's lines and player odds (`apply_lines`,
  `locked_player_odds`).
  - **Saves is a thin book** (`saves_lines_from_event`): the line is kept even with one price or
    none; over chance = Over/(Over+Under), a lone ask / 1.05, or 50%, held to 35-65%
    (`saves_over_chance`). Goalies with no game this season are kept by name (`id` None).
- **Projected lineups:** NHL.com's game-preview story,
  `forge-dapi.d3.nhle.com/v2/content/en-us/stories?tags.slug=gameid-{id}&tags.slug=game-preview&context.slug=nhl`
  (`selfUrl` -> `parts`, type `markdown`): "<Team> projected lineup", one line per forward line /
  pair ("A -- B -- C"), goalies one to a line (**the first is the expected starter**), then
  "Scratched:", "Injured:". `parse_lineups`, `lineup_slots`, `fetch_lineups`. Posted around midday
  ET; the half-hourly refresh picks each up. About 95% of listed skaters play.
  - **The game tag is typed by hand and can be wrong:** a story counts for a game only if every
    team it lists plays in it; a game with no fitting story is matched from the day's preview
    stories (slug ending "-game-preview-<month>-<day>-<year>"; `day_lineup_stories`). Test:
    `test_nhl_lineup_stories.py`.
  - Typed by hand: split lines on `--` alone (spaces go missing). A lone name is a goalie only if
    the site doesn't know him as a skater AND he is one of the last two; any other lone name (a
    seventh defenseman) is a skater with no line (`slot` None: under All, not Lineup Confirmed).
- **Starting goalies are never "confirmed"** (no feed has warmups). The lineup's first goalie is
  the expected starter (`shots.json` `lineups[game][team].goalie`); Game Previews' Goalies table
  tags it from crease.json (`starterRow` / `starterTag`): "Expected starter", a check mark only
  when lineup and book agree.
- No feed has expected goals; ours is our own model (see Goals). sportsdataverse publishes an open
  one (`nhl_xg_models`, license not checked).

## Build (`nfl_tool/nhl/build_nhl.py`)

- `--season 2027 --out nfl_tool/site/nhl/data.json --data-dir data/nhl` (seasons named by the
  year they END; the NHL's id is `20262027`). Regular season only.
- **Games downloaded one at a time and kept:** raw play-by-play + box score to
  `data/nhl/games/<season>/<id>.json.gz` once `gameState` is "OFF", never downloaded again. Keep
  the raw game (not totals) so new stats need no re-download.
- deploy.yml: "Restore saved NHL games" / "Save NHL games" (cache `nhl-games-*`) carry `data/nhl`;
  "Build NHL data" is `continue-on-error` (never blocks the NFL deploy). A lost cache re-downloads
  the season (about 4 minutes).
- `reduce_game` boils a game to team counts, skater and goalie lines; season numbers are sums.
  Shootouts count only in the final score. Also: `unb_pp` (unblocked shots a man up), `shots`
  (`game_shots`: unblocked shots on a goalie; no empty nets, penalty shots, pulled goalie,
  shootouts), `goal_events` (`game_goals`: team, `pp`, scorer, assists, `on`), each shot's `on`,
  `lines5`, `first_goal` / `first_goals`, `sog_early`, per-skater `g10` / `sog10` / `toi10`,
  `pp_toi`.
- **On-ice** (`on_ice_finder`): a shift counts from just after it starts to the moment it ends, so a
  goal belongs to the players whose shift it ended. None without a shift chart (the league has none
  for games 6-52 of 2026-27).
- **Power-play seconds** come from the league's per-game report
  (`skater/timeonice?isAggregate=false&isGame=true&cayenneExp=gameId=...`, `ppTimeOnIce`;
  `fetch_pp_toi`, kept as `raw["pp_toi"]`, backfilled when an old game is read), never the shift
  charts (empty or ~15% short). None without it: the model reads that game at his share so far.
  Replays' copy: `data/nhl/pp_toi/<season>.json.gz`.
- **Rink areas** (`shot_area`; drawn by `RINK_ZONES` in nhl-common.js: change both together):
  `low_slot` (in front of the net to the faceoff dots, 9 ft either side), `slot` (rest of "home
  plate" to the top of the circles), `left` / `right` (as the shooter sees it, incl. behind the
  line), `point` (to the blue line), `long` (outside the zone). Area numbers leave out blocked,
  empty-net and penalty shots.
- Output: `teams`, `team_stats` (every stat as `off_*` and matching `def_*` allowed, plus record,
  PP, PK), `recent_games`, `skaters` (12 F + 6 D a team, plus anyone in a posted lineup),
  `goalies`, `injuries`, `schedule` (yesterday to 14 days out, Novig lines, `away_rest` /
  `home_rest`), `player_odds` (`{game: {player: odds}}`), `league`, `novig_debug`, `feed_debug`.
- `def_pp_pct` = `1 - pk_pct`, so a power play row reads both sides.
- Times use each game's `easternUTCOffset`.
- **Player files** (`write_player_files`): `site/nhl/players/<TEAM>.json`, untracked, loaded when
  one of the team's games is opened. Under `season`: the game log (`log_lead` + `skater_cols` /
  `goalie_cols`; last skater column `slot`), `areas` (skater `[shots, on goal, goals]`, goalie
  `[faced, goals]`), skater `types`, `unb`, `pp_unb`.
- **Player odds** (`player_odds_from_event`):
  - Over / unders (`sog`, `points`, `assists`): consensus line only, one side priced at least;
    `thin` = one side missing or asks past 115%. Other lines ride as ladders (`sog_alts`,
    `goal_alts`: `[line, over price]`).
  - Anytime (`goal`) = goals over 0.5; one-sided kept; chance Yes/(Yes+No), or Yes x the game's
    median fair/Yes ratio. Dropped: Yes above 0.95, or Yes+No above 1.5.
  - **First goal: most of Novig's prices are placeholders.** A one-sided price is kept only if at
    most half his anytime price (`FIRST_GOAL_MAX_SHARE`); chances scaled down past 100%, never up.
  - `player_finder`: exact name (accents dropped), then last name + first initial on the team,
    then a name unique in the league. Two candidates = no match, never a guess.
- **`lineup` (lineup-aware usage):** discounts ice time for a player with only a game or two, but
  **never one who dressed in his team's latest game** (`last_dressed`).
- **Tripwire** (`unlisted_priced`): a player with a Novig shots line in an unstarted game who is on
  no prop list goes to `feed_debug.unlisted`, the build log, `version.json` `nhl.unlisted` and a
  non-blocking PROBLEM in `check_site.py`. `nhl.unmatched`: book names matching no known player.
- **Line column** (`game_lines`): from the shift chart, the forward with the most ice time plus the
  two he shared most ice with are a line, and so on; numbered by ice time (pairs likewise). Shift
  charts fetched once per finished game (`fetch_shifts`, `keep_shifts`); an empty chart is recorded
  once a game is `SHIFTS_GIVE_UP_DAYS` old. No chart = "--".
- Team colors: `TEAM_COLORS` (ESPN's; a black main color uses the second).

## Shared page rules

- **`nhl-common.js` loads first on every NHL page:** data (`loadNhlData`), helpers, `rinkSvg`, the
  player card, `nhlPlayBox`. A new page adds its script after it and defines `render()` and, with a
  selected game, `currentGame()`. NHL pages don't load common.js or `player-card.js`; they load
  `../book-odds.js`.
- **Styles:** hockey-only rules in `site/nhl/nhl.css` (`.nhl-*`; never style.css); the layout shared
  with NBA is `site/suite.css` (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app` / `.nba-soon`).
- **Top bar** (`SPORT_PAGES` / `addTopMenu` in sync.js): NFL, NBA, NHL, Promo Tools on every page.
  The NHL list: Game Previews, Line Matchups, then "Player props" over Best Plays, Shots, Goals,
  Points, Saves (`PROPS`). A new prop tool = one line in `PROPS`. No "More tools coming". Tests:
  every NHL page's bar, `test_header_site.py`.
- **Save to My Plays:** every priced play on Shots, Goals, Points, Saves and Best Plays has an
  `nhlPlayBox` (a new prop page adds it to its Play cell). See plays-and-promos.md, "My Plays".
- **Player search** in the Player header of every prop table (`nameSearchBox`, `nameMatches`,
  `NAME_SEARCH`; case and accents ignored). No match keeps the table with "No players match". A new
  prop table: `search: true` on its Player column + `nameMatches` in its filter.
  Test: `tests/test_nhl_search_site.py`.
- **Same filters and open row on every prop page:** an **Edge** menu (`edgeOptions` /
  `edgeAtLeast`; "Any edge" by default off Best Plays), a Lineups menu, and the every-book column in
  the open row. A new prop page gets all three.
- **A player's shown stat is his REAL count, never mixed with an average.** Pages take it from
  `seasonCounts` (his team's players file): rink shares (hover "12 of 17"), PP share, attempts per
  60, on-goal share. Never show `shares`, `pp_share`, `thru` or `att60` from shots.json / goals.json
  as his. A model number is labeled as the model's ("Model's usual xG"). **The projections keep the
  mixing** (`area_pad`, `pp_pad`, `pad_minutes`...; raw was clearly worse under ~10 games).
- **Every rank is said from the nearer end with its word** (`rankWords`; rank box `rankBoxText`):
  1-16 of 32 "most", 17-32 "fewest". Everywhere: rink boxes and hovers, the card's "OPP allows",
  tiles, league lists. `season_rank` in shots.json counts 1st = allows the most.
- **A defense's tiles are never colored alone:** this season's number, its rank in words, and a
  word (Leaky / Stingy / Average).
- **Eight rank colors on every rink zone** (`RANK_SCALE`, `rankStep`, `zoneOnStep`, `cellOnStep`,
  `rankScaleKey`; a copy of common.js's `RANK_SCALE`: change both). Four teams a step.
  - **Colors mean how MANY shots, not good or bad:** most = green, fewest = red, from the shooter's
    view ("green means go"). Every rink carries the key.
  - A player's rink: the number is his own share / shots, the color the OPPONENT's rank for shots
    allowed there. A team's rink (Game Previews): `rinkStep` = offense's and defense's ranks
    averaged, spread back out, cut into eight (disagreeing sides land in the middle).
  - **A zone is colored by the league-wide count, not the team's own split**; the share box is on
    its own league rank (`areaShares` in shots.js). No blended score.
  - Never colored: the strip outside the zone and its card row. Goalie maps: their own rule.
- **`zoneBoxes`:** three boxes per zone on the eight colors: shots a game allowed ("8.0/g"), share
  of everything the team allows ("21%"), league rank. The rink is 520px wide for them; the strip
  outside the zone carries the three as one uncolored line.
- **Zone shooters list** (`zoneShooters`, `who` / `me` in `leagueAttr`): clicking a zone lists up to
  8 shooters from that zone (shots a game, share, on goal, goals, games; Out / IR left off, 3+
  games, ties share a color). A player's rink passes `who: <his team>, me: <his id>`: his row
  outlined, added below the 8 as "Nth on TEAM from here". Goalie maps have none. Tests:
  `test_a_zone_lists_its_shooters`, `test_a_zone_lists_his_teams_shooters`,
  `test_the_cards_shot_map_lists_his_teams_shooters`.
- **League-wide list** (`openLeagueModal`): any `data-league="${leagueAttr(p)}"` opens every team
  on one number: rink zones (Game Previews both sides mirrored; elsewhere the defense only), the
  card's "OPP allows", both numbers of each Offense vs Defense row. Rank words down the left, this
  game's teams outlined. A rink list keeps the rink's colors; an Offense vs Defense list colors the
  defense like its cell (allows least = green). Opens over the card; Escape closes it first.
- **The player card** (nhl-common.js) is the ONE popup for every skater and goalie:
  `playerClick(id, inner)`. **Any new place that shows an NHL player must use it.** NFL card shell
  (`#player-card-modal`, `.pc-box`, `.pc-head`, `.player-modal-toggle`).
  - Tabs: **Game Log** (opens here), **Shot Map**, **Odds**.
  - Game Log: newest first, per-game row on top, Line column (L1-L4 / D1-D3). Ice time, shots,
    attempts shaded against his own games; goals, assists, points light up only when he scored.
  - Shot Map, skater: rink colored by what tonight's opponent allows (none: his own shots), table
    from the net out with the opponent's allowed cell in the zone's color (`oppAllowsCell`, the
    shooter's side); chips: league-average goals on his shots, PP share, shot types.
  - Shot Map, goalie: save % by area, colored only with 30+ shots and goals 1.5 SD from what the
    league allows (`goalieAreaTier`).
  - Odds: his game's lines (open game, else his next), `thin` tags, ladders as "N or more". Each side
    the best price on the member's books (`bookPricePill`) or Novig's, with an `nhlPlayBox` (goal,
    shots, points, assists = market `ast`, saves; first goal has no box).
  - A team file that can't be read still opens the card (season tiles and odds only).
- **Trimmed prop tables:** no Model % column, no Goals Proj. Each header `width: 1%` and an empty
  `.shots-spacer` takes the spare width. `COLUMNS` entries draw their own `cell`; `adv: true` =
  shown only after **Expand advanced stats** (`advancedToggle`, `nhlAdvancedStats`: one per-device
  switch). Rating tags are the YTD record's (`ratingTag`). Tests find columns by header text.
- **Open row** (`detailRow`, `bookPanelFor(x, stat, line, label, chanceAt, edges)`): pills, tiles,
  price table in a 520px left column, the rink in the middle, every book's price on the right
  (`.has-odds`); under 1360px the odds go under the rink; phones stack; no book prices = two
  columns. Each book tagged against OUR model at its own line with the page's `edges` (`chanceAt`:
  shots `chanceOver`, goals `r.chance` / `twoPlus`), so the panel matches the Edge column.
- **Started games stay listed, grayed, under the open ones** (`gameState`: "open" / "live" /
  "final" from `locked` AND the clock vs `start_utc`). Order always open, live, final; live rows
  `.shots-live` under "Live now"; a day with both gets **All games** / **Not started** /
  **Live / final**. A finished day isn't grayed.
- **Explanations behind an "i":** a long `p.section-note` is `hidden` with class `info-note`, opened
  by a `button.info-i` (aria-controls = its id) beside its heading; handler in sync.js (capture
  phase), look in style.css. On Shots / Goals the "i" follows `#shots-title`.
- Logos are the NHL's SVGs with a `logo_dark`; prop tables' `.shots-vs` logos are 30px. Saved
  images use ESPN logos (`shareLogo`) and no headshots: assets.nhle.com sends no CORS header.

## Game Previews (`index.html` + `nhl.js`)

Day strip, The Line (moneyline + win chance, puck line, total), The Teams (10 tiles), Offense vs
Defense (7 rows, two-sided tags as NBA), Where the Shots Come From (a rink per offense: the
offense's shots a game from the zone big, the other defense's three `zoneBoxes` under it; zone on
`rinkStep`, boxes on the defense's own ranks), Goalies, Skaters, Injuries, Recent Games (with who
started in net).

## Shots on goal

**Model** (`shots_model.py`, standard library; `shots_model_for` gives it no prior):
- **Projection = shots per minute x minutes tonight x matchup.**
  - Rate: shots per minute played, each game back 0.985 of the next, with 50 minutes
    (`pad_minutes`) of an average skater at his position WITH HIS ICE TIME (`role`, `role_power`
    1.0). Three quarters read from attempts x his on-goal share (pulled hard to the league's).
  - Minutes: recent ice time (each game back 0.8); a game under 60% of his usual ("left early")
    doesn't count. Before 3 games, a game under half the league's last line / pair (`short_first`)
    is "left early" too, kept in `ShotsModel.short` (the goals model skips it). No full game yet:
    tonight's line or pair minutes (`minutes_from` "line"); no posted lineup = **no number at all**.
    Three short games = he really plays that little (`short_games`). Tests: `test_nhl_unsure.py`.
  - Matchup (`WEIGHTS`, exponents on what the opponent allows vs the league): overall 1.0,
    position 0.5, his rink areas 0.5, PP shots allowed x his PP share 0.6; home +3%, own b2b -3.5%,
    opponent b2b +3.5%; `scale` -4%. A defense = its games mixed with 20 games of league average.
  - **Tonight's line** (`line`, 0.2, when posted): log of his line's minutes on this team
    (`slot_minutes`: top three forwards by ice time each game = line 1, etc.) over his own, capped
    +/-0.6. Minutes shown stay his own.
- **Chance:** negative binomial, spread = m + 0.07 m^2 (`chance_at_least`, `chance_over`,
  `fair_american`).
- **Replay:** `python tools/backtest/nhl_shots.py 2026` (`--tune`, `--last-season`). Findings that
  bind: his rate and ice time are most of it; hot / cold streaks, team strength and attempts allowed
  add nothing; the small-sample guard is required; fading a hot start has been right. Weights
  checked on 2024-25 and kept as is (PP weight is noise, under 1%).
- **Power-play units: tested, not added** (`tools/backtest/nhl_pp_units.py`; shifts kept in
  `data/nhl/shifts/<season>`): past PP share added nothing. Only tonight's real units would help,
  and those are paid products (needs a licensed feed). The lineup story has no PP units.
- **Not shown to beat the line** (no free history of SOG prices): a talking point until the record
  says otherwise.

**shots.json** (untracked, next to data.json):
- `games`: `{game: {locked, final, players}}` through `SHOTS_DAYS_AHEAD` (2) days. Row: `games`,
  `avg` (his real shots a game), `mean` = `usual` x `matchup`, `minutes`, `lift` (1.06 = +6%),
  `shares`, `chances` (1+ ... 8+), `out`, `slot` ("F1" ... "D3", null until posted), `usual_slot`,
  `line_minutes`, `move` ("up" / "down" / null), `first_sog`, `rest` / `opp_rest`.
- **Who is projected:** a posted lineup's skaters who have played this season (`posted` on the
  game); before that, the team's usual 18 by ice time less ESPN's outs.
- `lineups`: `{game: {posted, team: {lines, goalie, scratched, injured}}}`.
- **Lock:** a started game keeps the previous build's rows (live `shots.json` read with the build
  key); none saved = no projection, never one made after puck drop. Finals get `actual` (null if he
  didn't dress).
- `defense`: per team `season`, `season_rank` (1 = allows most; what the page shows), `blend` /
  `factor` / `rank` (the model's), `league`, `games`.
- `edges` (`SHOTS_EDGES` lean 3, strong 6, check 12: now only the every-book tags and Best Plays'
  Goals / Points cutoff), `bar` (`SHOTS_BAR` 0.06), `record`.

**The Shots bar: a play is shown or left out, no Lean and no Check.** A play = an edge of
`SHOTS_BAR` (6 points) or more on a player NOT moved down a line tonight (`shots_play`, `size`
"play" / "none"). Never cut on tonight's number against his season average (the owner: fill-ins
move roles). Re-run `tools/nhl_factor_report.py` before changing the bar.

**The record** (`model_history/nhl_shots/<month>.json`, committed by "Save GMG model record"):
each finished game once, every player with a main line who played: `[id, name, team, line, over,
under, projection, chance of the over, real shots, season average, line move, first line, first
over, first under]` as locked, then **`factors`** (`SHOTS_FACTORS`, `shot_factors`; the file's
`cols` / `factors` name them: position, games, avg, `vs_avg`, minutes, PP share, slot, move, home,
`rest` / `opp_rest`, `s_*` shares, `l_*` lifts), then `nv` (see CLV).
- `shots_record_summary`: `play` / `none` (every saved game by today's bar), and for plays `over` /
  `under`, **`fade` / `with`** (against / with his season average); W-L, units risking 1.
- `record.days` = every day's tally; `record.plays` = each graded play of the latest
  `SHOTS_RECORD_DAYS` (14) days with any (capped so the file doesn't grow).
- `record.clv` (see "Closing line value").

**The page** (`shots.html` + `shots.js`), one table for the slate, best edge first:
- **Edge = model chance minus the price's break-even**, for the better side of the main line. No
  shot math on the page: it reads `chances`. `pickSide` must agree with the build's `shots_play` (a
  test checks every row).
- **Opens on plays only** (`isPlay`), Rating "Play". **Plays only / Every line**
  (`shotsView.every`): plays first, then "Not plays". Over the bar but moved down = **"Lower
  line"**. **Before a lineup is posted** plays assume he stays on his usual line, tagged **"Play: no
  lineup yet"** (dashed, `pendingLineup`). No check group, nothing amber. No plays = says so +
  "Show every line". `bookEdges`: PLAY from 6, never on a player moved down, no CHECK.
- Toolbar: Side, Skaters, Lineups dropdowns (`.shots-filter-select`), Plays only / Every line.
  "How the number is made" at the top of the panel.
- Line column: L1-L4 / D1-D3 + arrow vs his usual line, "--" until posted; a note says how many
  games have lineups; strip cards say "Lineup" (check) or "No lineup yet" (`board.posted`).
- Columns: Line, the play (**"o1.5" / "u2.5"** chip + price), **Rating** (Play / Lower line, + "vs
  his avg" when the play goes against his season average), Avg, Proj, Fair, Edge; advanced: Min,
  Opp, Pos, Spots, PP, Home/rest. **Green = more shots for him, red = fewer** (Over chip green,
  Under red); a piece colored from 2.5%.
- Breakdown starts from his season average, names the small-sample step ("5-game sample -22%"),
  the line piece ("L1 tonight +13%"), linemates, injured / scratched, the defense tiles, every line
  at the model's fair price, and "Where he shoots" (his share bold, the defense's `zoneBoxes`).
- Lineups filter: **"All" (opens here) / "Lineup Confirmed"** (on a line or pair in a posted
  lineup). **A player with no shots line is never listed.** Nothing under Lineup Confirmed says why
  + "Show all players". A strip game shows only that game (click again for the day). Outs left off.
  "Confirmed" = the NHL's projected lineup, not warmups; the About box says so.
- **"YTD Model Performance"** button beside the title opens the record (`#shots-record-modal`, the
  `nhlYtd` tracker): tiles, then graded plays newest day first (`recordPlays`).

## Goals (anytime goal)

**Model** (`goals_model.py`, standard library; `tools/backtest/nhl_goals_check.py` replays both
seasons THROUGH it and fits `WEIGHTS`: rerun after any change):
- Expected goals: two logistic tables (without / with off wing; `onetimer` = log of one over the
  other), fitted every build on this season's shots (`fit_xg`, sparse Newton).
- `parts()`: EV / PP rates (50 / 15 minutes of an average skater mixed in) x the shots model's
  minutes / line / home / rest, the defense's xG allowed (20 games of average), the goalie (25 xG),
  finishing (8 xG), the low-slot trim. `chance_to_score` = 1 - e^-mean.
- **Zone Match tag** (`zone_match`, `ZONE`): 35%+ more of his located shots from low slot or slot
  than his position (15+ located shots) AND a top-10 defense for shots allowed there AND above the
  league's average there. **Tracked, never in the number** (no edge in the replay); always blue,
  never green.
- Replays: `tools/backtest/nhl_goals.py`, `tools/backtest/nhl_goals_ideas.py` (pre-registered bar:
  2+ SE on 2024-25, lowers 2025-26 log loss, same sign). Out: empty-net goals, penalty matchup,
  backup goalie, team-strength gap. A defense's low-slot GOALS allowed is noise; its SHOTS allowed
  is real.

**goals.json** (untracked; `goals_board`): the Shots page's games, players and lock, EVERY skater:
`chance`, `mean`, `fair`, `lift`, `shares`, `zone`, `games` / `goals` / `xg` / `shots`, `ev_min` /
`pp_min`, `goalie` (lineup's, else the busiest starter; never "confirmed"), `odds` / `no_odds` /
`thin`, `first_odds`, `edge`, `size` (`goals_play`, `GOALS_EDGES` 3 / 6 / 12; moved DOWN a line =
"check"). Also `defense`, `xg`, `league`, `weights`, `zone`, `record`. A failed step still writes
one with `error`, so putting the live NHL copy back (`--need nhl`) never trips on it.

**Record** (`model_history/nhl_goals/<month>.json`, `GOALS_RECORD_COLS`): every projected player
who played, the game's locked total and moneylines (`market`); a priced row ends with `factors`
(`GOALS_FACTORS`, `goal_factors`) then `nv`. `goals_record_summary`: strong / lean / none / check,
`zone`, `thin`, `clv`, `honest`, `zone_all`, `days` / `plays`. Goals keeps Lean / Strong / Check
until it has more games graded.

**Page** (`goals.html` + `goals.js`; reuses `#shots-app` / `.shots-*`, own `.goals-*`):
- No goal math: everything from goals.json; the edge cell is colored by `size`, never the rounded
  edge. Loads shots.json for rink boxes and linemates.
- Columns: #, Player, Line, Anytime (Novig chip; **"No odds"** outlined chip), **Rating** (Strong /
  Lean / Check / New line), **Zone** (blue chip), G (/gp), xG, Fair, Edge; advanced: Min, Opp,
  Goalie, Finish, EV/PP, **Style**, Home/rest. Result column once final.
- Ranking: check first (amber), priced plays by edge, then **"No odds yet"** by chance. Filters:
  Skaters, Lineups, **Odds**, **Zone Match**, Check plays, live / final.
- A Zone Match player's breakdown has a blue note: his share, his position's, the defense there,
  "Tracked in the record; not in the number."
- Breakdown: season G / xG -> usual xG -> each piece -> tonight; defense tiles; price table
  (anytime, 2+, model, fair, Novig, **First seen**, edge); the rink. Tabs read Scores / No goal.
- YTD popup: buckets, Zone Match, thin, CLV, "Said vs scored", graded plays (Every edge, Strong,
  Lean, Check first, Zone Match).
- Tests: `tests/test_nhl_goals_site.py` on `tests/fixtures/nhl_goals.json.gz`.

## Points (1+ point)

**Model** (`points_model.py`; `PointsModel(goals)`, fed every game AFTER the Goals model;
`tools/backtest/nhl_points_check.py` fits `WEIGHTS`, `SPREAD_MEAN`, `CALIBRATION`: rerun after
any change; replay `tools/backtest/nhl_points.py`, `--rows`):
- Goals = the Goals model's mean. Assists = teammates' expected goals while he's on the ice (shift
  charts x the xG table; 50 / 15 EV / PP minutes of average mixed in) x his share of their goals he
  assisted (10 / 6 goals of his position mixed in), EV and PP apart, x tonight's EV / PP minutes,
  x matchup (defense xG allowed, goalie, line, home, rest, `spread`). Assist numbers only from games
  with a shift chart.
- `chance_at_least`: 1+ re-scaled on the logit (`CALIBRATION`); 2+ a plain count. `chance_over`.
- **`mates`** (tonight's linemates vs his usual, by EV points a minute): **tracked, never in the
  number** (failed the bar). `linemates(pid)`.

**points.json** (untracked; `points_board`; main builds the Goals model once and hands it over via
`goals_file`'s `model`): every skater: `games` / `goals` / `assists` / `points` / `avg`, `g_mean`,
`a_mean`, `mean`, `chance`, `two`, `fair`, `lift` / `g_lift`, `mates`, `line` / `over` / `under` /
`thin`, `first`, `chance_over` (rounded; what everything grades), `side`, `price`, `edge`, `size`,
`fade`, `actual`. Also `weights`, `calibration`, `edges`, `bar`, `factors`, `record`; `error` on
failure.

**The Points bar:** `points_play` = `shots_play` at `POINTS_EDGES`, then **"play" only on the 0.5
line, edge `POINTS_BAR` (6) or more, and not `against_move`** (against tonight's line change);
"unsure" from `UNSURE_EDGE`; else "none". No lean, no check. Board, record, Best Plays and the
factor report all use it. `POINTS_EDGES` still sizes every-book tags and the price table's green.

**Record** (`model_history/nhl_points/<month>.json`, `POINTS_RECORD_COLS`; priced rows end with
`factors` (`POINTS_FACTORS`) then `nv`). `points_record_summary`: play / none / unsure, over /
under, fade / with, CLV, `days`, `plays`, `ledger`, `honest` (1+ said vs got).

**Page** (`points.html` + `points.js`; reuses the Goals layout):
- No points math: play, chance, edge, bucket from points.json. Loads goals.json and shots.json.
- Columns: #, Player, Line, **Play** ("o0.5 +127" green / "u0.5 -150" red; "No odds"), Rating
  (Play + "vs his avg"; left out over the bar: "1.5 Line" / "New Line"; Model Unsure), **P** (/gp;
  G and A in hover), **Fair**, Edge; advanced: Min, xG, xA, Opp, Goalie, **Linemates** (blue chip),
  Home/rest. Sections: Plays, Not Plays, Model Unsure, No odds. Filters as Goals, no Check switch.
- Breakdown: season G / A / P -> goals tonight -> usual assists -> line, defense, goalie, Scale,
  home / rest -> "G + A, chance"; defense tiles; o0.5 / u0.5 / o1.5 / u1.5 price table; **his line
  tonight** on the right (each linemate's chance and play chip; before posting, says when it fills).
- YTD: Plays, Not Plays, Overs, Unders, Against his avg, CLV; "Said vs got"; Every Play / Overs /
  Unders.
- Tests: `tests/test_nhl_points.py` (`tests/fixtures/nhl_game_shifts.json.gz`),
  `tests/test_nhl_points_site.py` on `tests/fixtures/nhl_points.json.gz`, built by
  `tools/make_nhl_points_sample.py` (rebuild it after changing what points.json holds).

## Saves (goalie saves over / under)

King of the Crease's saves model read as a prop; no model of its own.
- **`saves_file` -> `saves.json`** (untracked; built FROM crease.json's board, `saves_board`: same
  goalies, starter call, projection, lock; `error` on failure). Row (`saves_row`): the crease row
  minus `CREASE_ONLY_KEYS`, plus `chance_over` (model `mean` at Novig's main line), `alts` with the
  model's chance, `fair`, `gap` (model minus `mkt_mean`), `first` (same goalie only), the play
  (`saves_play`: `shots_play` at `SAVES_EDGES` 3 / 6 / 12, plus **check** at
  `CREASE_RULES["check"]` = 4+ saves from `mkt_mean`), `void` = someone else started.
  **Uses the raw model, never King of the Crease's `blend`.**
- **Record** (`model_history/nhl_saves/<month>.json`, `SAVES_RECORD_COLS`, `SAVES_FACTORS`): every
  starter with a main line; **a goalie who didn't start is left out** (books void it).
  `saves_record_summary`: Points' buckets, over / under, fade / with, CLV, ledger, `honest`.
- **Every book's saves price:** `smartstake.saves_market_keys` finds the market in `/v1/markets` by
  name (never a guessed key); `props.saves`. `best_saves_prices` swaps each Novig line's prices for
  the best US book at the SAME line (`over_book` / `under_book`, `nv_*` = Novig's) before King of
  the Crease reads it; the fair `chance` stays Novig's. `version.json` `nhl.book_saves`.
- **Page** (`saves.html` + `saves.js`, `.saves-*`): #, Goalie (search), **Starter** (green "agree";
  amber = they differ or he started last night; gray = one source), Play, Rating, Avg, **Proj**
  (green / red a save above / below the line), Fair, Edge; advanced: Shots, Opp shots, His D, Save
  rate, Home/rest. Filters: Starters, Edge, Odds, Check plays, live / final. Open row: league start
  -> pieces -> tonight, both sides' tiles (green = more work for him), lines with first seen, "In net
  (expected)", every-book column (`stat` "saves"). Result: saves + W/L, "Void".
- Tests: `tests/test_nhl_saves_page.py`, `tests/test_nhl_saves_site.py` (`helpers.nhl_saves()`).

## Model Unsure: the safety net

An edge of `UNSURE_EDGE` (25 points) or more is filed **"unsure"** by `shots_play` / `goals_play`
(every market): the model is missing something.
- Never a play: Shots' `isPlay` and Best Plays leave it out; Goals / Points / Saves list it under
  "Model Unsure" after the plays (dashed gray, `unsureTag` / `unsureHead`; no "vs his avg"). Each
  file sends `unsure`.
- Records grade it in its own `unsure` bucket, never in plays, `days`, `plays` or `ledger`; the
  factor report skips it. Records are regraded by today's rules.

## Best book prices

- `best_book_prices` (after SmartStake's `book_odds`) swaps each main-line price in `player_odds`
  (shots, points, saves over / under, anytime goal) for the best US book at the SAME line when it
  beats Novig's (`over_book` / `under_book` / goal `book`; `nv_*` keeps Novig's). Every edge, play,
  first price and graded record uses it; chances stay the model's / Novig's fair. Build-wide (ignores
  My Books); locks like book odds; no SmartStake = Novig's. Records before `BEST_PRICES_FROM`
  (2026-10-17) were graded at Novig's. Pages say "best price across books". Test:
  `tests/test_nhl_best_prices.py`.
- **On the page the member's books come first:** if the build's book is one they turned off, every
  prop page and Best Plays show the best price among their books at that line and the edge on it
  (`memberPrice` / `buildBook`; none = the build's). Listed plays and buckets stay the build's. A My
  Books change redraws. Test: `test_a_member_sees_the_best_price_on_their_own_books`.
- **Every book's price** (`smartstake.fetch_nhl_book_odds`; `SMARTSTAKE_API_KEY` on the NHL step of
  deploy.yml AND nhl-refresh.yml): `book_odds["AWAY_HOME"].props.{sog,goals,saves,first_goal}[id]`,
  matched by `player_finder` on either team. US books, odds lock (data-pipeline.md).

## Closing line value (Novig alone)

Wins and units stay at the best price across books; **CLV reads Novig alone**, first look vs lock.
- `clv_move`: the play side's no-cut chance (both sides priced at both looks, else that side's own
  price), lock minus first, + = toward the model; a moved line counts by direction. `clv_tally` /
  `clv_add` / `clv_done`: `plays`, `priced`, `points`, `shortened`, `drifted`, `since`, `book`.
- Board rows carry `nv` (`novig_prices` / `novig_goal_prices`) and `first_nv` (Saves: same goalie).
  Crease rows carry `nv_over` / `nv_under`. Every record row ends with `nv` after `factors`
  (`CLV_COLS`: over / under `[first_line, first_over, first_under, over, under]`, goals
  `[first_yes, first_no, yes, no]`). Rows from `BEST_PRICES_FROM` without `nv` are left out.
- One tile for all four pages: `clvTile` ("Closing Line Value", "since"). The YTD tile is labeled
  **Early Price Move** and worded as context only: the prop pages are a bottom-up model for bets in
  the last hour or two, judged by wins and units at the puck-drop price, not morning CLV.
- The lock is the last refresh before puck drop (up to 30 minutes early), not the true close.
- Tests: `tests/test_nhl_clv.py`.

## The factor report

- All three prop records save each graded play's parts as locked (`SHOTS_FACTORS`, `GOALS_FACTORS`,
  `POINTS_FACTORS`). No weight has been changed from them yet.
- `python tools/nhl_factor_report.py` (`--market shots|goals|points`, `--every`, `--since`,
  `--min`, `--json`) grades every play the pages' way and groups by each factor (W-L, win %, needed
  win %, units, return). Lifts group by toward / against / under 2%. **Groups under 100 plays are
  "early"**: tell the owner they can't be trusted yet.
- Tests: `tests/test_nhl_factor_report.py`.

## Best Plays (`best.html` + `best.js`)

A short list for a member in a rush; sends people to the other pages for detail.
- **Every play the Shots, Goals, Points and Saves pages call a play**, one table, biggest edge
  first: Shots its bar (`shots.json` `bar`, not moved down); Points `size` "play"; Goals and Saves
  `size` strong / lean / check, **picked by `size`, never the saved (rounded) edge**. A test checks
  them against the build. **No cap and no Check group.**
- **Every row says its own page's bucket:** a **Rating** column (`bucketTag` in nhl-common.js, the
  ONE function the pages share); a Check's edge is amber. Rating sorts.
- Saves: "o26.5 saves" chips, `savesGapCheck`, `starterTag` first in Notes, "N GS" under 5 starts;
  the row opens `saves.html#row=`.
- **Notes say what the model may not know, never a verdict:** "No lineup", the line change ("L2 ▼",
  amber against the move), "N GP" under 5, "vs avg", "Thin". Centered.
- **Lineup banner** when an open game has no lineup ("Lineups are in for X of Y games...").
- Columns: #, Player, Play, Rating, **GMG Fair**, Odds (book named under it; Novig keeps its logo;
  opens every book), **Good to** (worst price still at a 3-point edge, `goodTo`), Edge, Notes, Puck
  drop, a "Shots ›" / "Goals ›" link. Every keyed column sorts; Odds = biggest payout first. No Win %.
  Market switches (at least one stays on); Edge menu (`bestView.minEdge`) and Lineups menu.
- A row opens its row on the other page (`shots.html#row=<game>:<player>`; `linkedRow` /
  `scrollToRow`).
- **YTD:** the shared tracker (styles.md) on each record's `ledger` (`record_ledger`: every graded
  play `[date, edge, won, units]` plus tags); Min Edge slider per market, edge counted as the table
  rounds it; remembered as `nfl-tool.ytd.nhl-best.v1`. Shots, Goals, Points, Saves popups use the
  same tracker (`nhlYtd`).
- Player cell: the flex box sits INSIDE the td (`.best-player`); photo 34px, logos 30px. Phone: photo
  and position drop out (last phone block of nhl.css).
- Tests: `tests/test_nhl_best_site.py`.

## Line Matchups (`lines.html` + `lines.js`)

**A preview, never a pick sheet: no prices, no projections, no record.** Under NHL after Game
Previews.
- **Counting** (`lines_model.py`): `game_units(raw)` from `lines5`. 5-on-5 = exactly 3 F + 2 D + a
  goalie a side, read off the shifts each second. Per team: `team`, every trio (`F`) and pair (`D`)
  as `[secs, attempts for, against, goals for, against]`, and `vs` (home trio vs away trio secs).
- `LinesHistory` (this season only): `unit` (season + `l3`; "together" = 60+ s), `usual` (from the
  latest game, `game_lines`' rule over the last 5), `deploy`, `meetings`. `likely_matchups`.
- **`lines.json`** (`lines_file`; `version.json` `nhl.line_matchups`): games through
  `SHOTS_DAYS_AHEAD`, `{locked, posted, teams: {T: {source "posted" | "usual", games, team, lines,
  pairs}}, players, matchups, meetings}`. Unknown name = New Together. Started games keep the last
  build's entry. `LINES_RULES` (sent as `rules`): Strong / Weak at 56% / 44% share with 20+ minutes,
  else Small Sample (New Together at 0); Hot / Cold when last 3 (10+ min) are 5+ points of share or
  +/-2 goals off the season, **Steady when the two disagree** (never contradict itself).
- **Page:** one game from the strip ("Lineup" / "Usual Lines"): away tiles, middle (Likely Matchups,
  Past Meetings, Team 5-on-5), home tiles. Tile: Line / Pair N + tag, names (`playerClick`), Min · GP,
  Shot Share and Last 3 GP on eight colors around 50% (`SHARE_STEPS`, shaded past half the Strong
  minutes), Goals, Form. Under 1180px the middle goes on top; phones one column, matchups first.
  Likely Matchups is a lean (little trio-vs-trio history) and says so.
- Tests: `tests/test_nhl_line_matchups.py`, `tests/test_nhl_line_matchups_site.py`
  (`helpers.nhl_lines()`). `tests/test_nhl_lines.py` is the card's Line column.
- **Line Stacks (retired 2026-10-21, it lost):** gone are the page, `stacks.json`, the build's board
  and record (`game_ice` / `ice`). Kept: `model_history/nhl_stacks/`, `stacks_model.py` +
  `tools/backtest/nhl_stacks.py` + `tests/test_nhl_stacks.py`, the SGP price log endpoint and D1 rows
  (members-and-hosting.md); My Plays still grades saved stacks.

## King of the Crease (Promo Tools)

DraftKings: everyone whose goalie makes the **most saves of the day** splits $500K (ties split;
your team's starter counts if yours doesn't start; bet +100 or longer). Has **Value** next to Upside.
- **Saves model** (`saves_model.py`, this season only): league-average start x other team's shots x
  his team's defense x home / rest x save rate. `WEIGHTS`: off 1.0, def 0.85, home -3%, own b2b +3%,
  opp b2b -3%, save rate 1.0; teams mixed with 10 games of average; a quarter of volume from
  attempts. Replay `tools/backtest/nhl_saves.py 2026 2025` (`--tune`): the two teams are nearly all
  of it; his own saves a start predict worse than average. Spread (`save_spread`): `DISPERSION`
  0.02 + 5% of starts pulled at ~12 saves. `top_chances`.
- **Board** (`crease_board` -> `crease.json`, untracked): `days[date].goalies`, one row per team.
  - **A starter is never called confirmed** (a test fails if the page script says "confirmed").
    `crease_starter` `source`: "both" (lineup and book's saves line agree: the ONLY check mark,
    worded "agree"), "split" (book's goalie shown, `other` = lineup's, a warning), "lineup" /
    "market" (one source, no mark), "usual" (neither). `doubt` = lineup alone names last night's
    starter.
  - Row: `starts`, `saves_avg`, `sv_pct`, `high`, `opp_shots` + rank, `allowed` + rank, `shots`,
    `mean`, `line`, `over`, `under`, `alts`, `mkt_mean`, `blend`, `big` (35+), `top`, `mkt_top`,
    `value`, `check`, `tags`.
  - **Upside leans on the market** (`CREASE_RULES`): `blend` = line moved toward the model by
    `0.5 x min(1, games / 20)`; no line = model alone. `top` = chance of the day's most saves.
  - **Value = `top` / `mkt_top`** (his chance if he were exactly his line, same field). Tag at
    1.15+, `top` at least half an even split, never when `check` (4+ saves apart: dashed "?").
    Few Value tags before 10-15 games is the rule working. Upside tag: day's best `top`, three max
    (one per four starters).
  - Lock: started games keep the last build's rows; finals get `actual` (whoever STARTED), and the
    finished day `led`.
- **Record** (`model_history/nhl_crease/<month>.json`; `crease_record_summary`).
- **Page:** strip (not clickable), one sortable table in King of the Endzone's look (`.koe-*` +
  `.crease-*`), whole slate, no math. Matchup columns on the eight colors by league rank; line,
  saves a start and Tonight's by rank within the day. No Upside chip (Value keeps its chip), no
  over price, no Top 10 cut, no record tiles.
- **Winners** (`renderWinners`): one collapsible line per finished day, newest open: winner, saves,
  pregame place ("13th of 32"), paid; open: starters, pool, est. on him, **If they'd won** (Sv, Pre,
  Upside, Paid, **Worth** = `top` x paid), our favorite, the most picked. Beside the table
  (`.crease-main`), **never in the saved image** (outside `#crease-capture`). No summary tiles.
  Data: crease.json `history` (`crease_history`, `CREASE_HISTORY_COLS`).
  - **Payouts typed in by the owner:** a box shown only with `html.is-owner` (and localhost): day,
    pool ($500,000 default), paste DraftKings' text ("🥅 Name - $2,748 in Bonus Bets"). Names match
    starters (accents dropped, else a unique last name); an unmatched name blocks the save. D1
    `crease_payouts` via `/api/crease-payouts` (members-and-hosting.md).
- **Save image** is the priority: the table with a GMG title bar and key at 2x, whole slate.

## Icebreaker (Promo Tools, `promo-tools.html#icebreaker`)

DraftKings: a **first goal scorer** bet on whoever scores the **quickest goal (by game clock) of the
7:00 PM ET slate** splits $250K. Mostly luck; the page says so.
- **Replay** (`tools/backtest/nhl_icebreaker.py`): team "fast start" numbers, early shots and the
  opening shift predict nothing beyond **scoring rate x ice time**.
- **Number** (`icebreaker_board` -> `icebreaker.json`, untracked): his share of the slate's
  expected goals. `rate` = goals.json `mean` moved toward his Novig anytime price (`mkt_mean` =
  -ln(1 - chance)) the King of the Crease way (`ICEBREAKER_RULES`). Outs left off.
- **The page does one division** (`icebreaker.js`): his rate over everyone's in the picked games;
  team = its players added; "Of team" = his share. Day arrows, **Start time** chips (opens on 7:00
  PM ET, else the first), **Games** chips.
- **Fast starts** (`fast_starts`): games scored first, middle first-goal time, early SOG, what
  tonight's opponent allows. **Shown, never counted**; eight colors by place among picked teams.
- Layout: Teams table (Chance, top three "Best bets", Fast starts) beside Players (Line, Chance, "1
  In", Of Team, **First 10 Minutes · This Season** from `first10` / `first_ten`: GIFT, SOG, TOI
  (charted games only), then **DraftKings' first goal price**), top 15 until "Show all"; a team click
  filters. **Every Players column sorts** (`ICE_SORT`, `iceView.sort`, `data-ice-sort`, which King of
  the Crease's sort skips). Winners beside, never in the saved image.
- **First goal prices:** `smartstake.add_first_goal` reads `/v1/markets?league=nhl`
  (`fetch_markets`, `first_goal_market_keys`), Yes as "o" -> `props.first_goal`, its own try. The
  row's `fg` is **DraftKings only**; the column shows only when some picked player has one.
  `version.json` `nhl.first_goal`. SmartStake had no NHL first goal market at first (the owner asked
  them to add it). Never scrape DraftKings.
- **Historical Data** popup (`#ice-history-modal`): numbers typed into promo-tools.html; change them
  with the replay.
- **Lock and record:** started games keep the last build's rows; once every 7:00 PM game is final the
  day goes to `model_history/nhl_icebreaker/<month>.json`. `icebreaker_history` -> Winners. `showPromo`
  in promo-tools.js switches tabs and the address.
- Tests: `tests/test_nhl_icebreaker.py`, `tests/test_nhl_icebreaker_site.py`
  (`tests/fixtures/nhl_icebreaker.json.gz`).

## Tests and checks

- `tests/test_nhl.py` (build, one saved game + one Novig event), `tests/test_nhl_site.py` (page and
  card on a saved data.json + NJD / DET player files), `tests/test_nhl_shots.py` (model, never last
  season, lineup story `nhl_lineup_story.json.gz`, board / lock / record),
  `tests/test_nhl_shots_site.py` (`nhl_shots.json.gz`), `tests/test_nhl_saves.py`,
  `tests/test_nhl_crease_site.py` (`nhl_crease.json.gz`), `tests/test_ci_crease_payouts.py`; plus
  the per-page tests above. A broken NHL test stops a deploy.
- `tools/fetch_live_data.py` downloads the live player files and every NHL json for the after-deploy
  check. Check pages with `tools/check_site.py --only nhl` when chasing a problem there.
- `version.json` `nhl`: `built`, `games` / `wanted`, `downloaded`, `lines`, `player_odds`, `shots`,
  `lineups`, `icebreaker`, `first_goal`, `points`, `saves`, `book_saves`, `line_matchups`,
  `unlisted`, `unmatched`, or `error`.

## Not built yet

- Re-weighting from the factor report once its groups pass 100+ plays.
- Goals: Novig's team totals as an anchor. Shots: tonight's PP units from a licensed feed; a closing
  line snapshot.
- King of the Crease / Icebreaker: a payout estimate before puck drop from the logged payouts
  (labeled an estimate, graded); learn what drives picks.
- Best Plays: "Dropped since earlier" (carry each play's first-seen edge like `first_odds`).
- A Summary card, a game model, shot dot maps, EDGE stats, playoffs.
