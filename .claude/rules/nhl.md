---
paths:
  - "nfl_tool/nhl/**"
  - "nfl_tool/site/nhl/**"
---
# GMG NHL Suite

The NHL suite inside "GMG Sports Data Suite" (started 2026-10-13; 84 games a team, 1,344 in all),
open to every member (one switch with the NBA suite: nba.md, "Suite switch").
This file holds the rules only. The owner's words, dates and replay numbers behind each one are
in `docs/history.md`: "NHL", and "2026-10-29: the NHL rules file before the trim" (the full old text).

## Where Each Tool's Rules Are

Each tool's rules are in their own file and load when you open that tool's files: `nhl-props.md`
(every prop page: Model Unsure, best prices, CLV, factor report, Best Plays), `nhl-shots.md`,
`nhl-goals-points.md`, `nhl-saves.md`, `nhl-lines.md` (Line Matchups, Vs Position),
`nhl-promos.md` (King of the Crease, Icebreaker, King of the Hat Trick). `build_nhl.py` calls all of
them: read the one for the part you are changing.

## Files

- Build: `nfl_tool/nhl/build_nhl.py` -> `site/nhl/data.json`, `nhl/shots.json` +
  `nhl/players/<TEAM>.json` (games kept in `data/nhl`). `build_nhl.py` is the order (main); the work is
  in job files (2026-11-23, each imports only files above it, list in its opening note): `nhl_games`
  (NHL feed, play-by-play, schedule, injuries), `nhl_stats`, `nhl_prices` (Novig, locks, best prices,
  CLV), `nhl_lineups`, `nhl_records`, `shots_page`, `goals_page`, `points_page`, `line_matchups_page`,
  `goalie_pages` (Crease + Saves), `promo_pages` (Icebreaker, Hat Trick), `past_days`. Models: `shots_model.py` (shots on goal),
  `saves_model.py` (King of the Crease + Saves, `nhl/saves.json`), `goals_model.py` (anytime,
  `nhl/goals.json`), `points_model.py` (1+ point on top of goals, `nhl/points.json`),
  `lines_model.py` (Line Matchups, `nhl/lines.json`). `stacks_model.py` (retired Line Stacks) stays
  for the replays.
- Pages (`site/nhl/`): `index.html` + `nhl.js` Game Previews; `shots`, `goals`, `points`, `saves`
  (`.html` + `.js` each); `lines.html/.js` Line Matchups; `vs-position.html/.js` Vs Position; `best.html/.js` Best Plays;
  `promo-tools.html/.js` King of the Crease + `icebreaker.js` + `hattrick.js`; `nhl-common.js` shared by every page;
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
  `home_rest`), `player_odds` (`{game: {player: odds}}`), `league`, `novig_debug`, `feed_debug`. Also `past_<market>.json` (see "Past days").
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
  The NHL list: Game Previews, Line Matchups, Vs Position, then "Player props" over Best Plays, Shots, Goals,
  Points, Saves (`PROPS`). A new prop tool = one line in `PROPS`. No "More tools coming". Tests:
  every NHL page's bar, `test_header_site.py`.
- **Save to My Plays:** every priced play on Shots, Goals, Points, Saves and Best Plays has an
  `nhlPlayBox` (a new prop page adds it to its Play cell). See plays-and-promos.md, "My Plays".
- **Player search** in the Player header of every prop table (`nameSearchBox`, `nameMatches`,
  `NAME_SEARCH`; case and accents ignored). No match keeps the table with "No players match". A new
  prop table: `search: true` on its Player column + `nameMatches` in its filter.
  Test: `tests/test_nhl_search_site.py`.
- **Skaters menu** (Shots, Goals, Points: `SKATER_PICKS` / `skaterPick` in nhl-common.js): All,
  Forwards, Defense, Top 6 / Bottom 6 Forwards, each line and pair (tonight's posted `slot` only).
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
  - Odds: his game's lines (open game, else his next), `thin` tags. Each side
    the best price on the member's books (`bookPricePill`) or Novig's, with an `nhlPlayBox` (goal,
    shots, points, assists = market `ast`, saves; first goal has no box). **Show Alt Lines** (as the
    NBA card, 2026-11-02): every other line SmartStake's ladder or Novig prices, an "Alt" row under its
    market, best price + box each side (a rung is its own play).
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
- **Past days (any date, the owner 2026-11-03):** the build writes `nhl/past_<market>.json` (shots,
  goals, points, saves; `past_file`, `write_past_files`): every priced row of that page's record filed
  by today's rules (`past_play`), `PAST_COLS`. Each prop page and Best Plays sets `PAST_PAGE` and reads
  it after its first draw (`nhlPastLater` in nhl-common.js): the day arrows reach opening night and a
  **date box** (`nhlDayPicker`) jumps to any day. A day the live board no longer has is drawn by
  `nhlRenderPast` / `nhlPastTable` (Plays Only / Every Player, Edge menu, W / L / P and units; Best
  Plays: every market, plays only). No breakdown on past days (not saved). Tests:
  `tests/test_nhl_past_days.py` (`SiteBrowser.nhl_past` serves hand-made files; others 404).
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
