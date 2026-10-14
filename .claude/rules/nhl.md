---
paths:
  - "nfl_tool/nhl/**"
  - "nfl_tool/site/nhl/**"
---
# GMG NHL Suite

Started 2026-10-13, a week into the 2026-27 season (84 games a team this year, 1,344 in all).
Third suite on the same site, reached from the suite dropdown. **Open to every member since
the evening of 2026-10-13** (one switch with the NBA suite: see nba.md, "Suite switcher and
launch switch"). More background: `docs/history.md`, "NHL".

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
  PLAYER_GOALS, SHOTS_ON_GOAL, POINTS, ASSISTS, FIRST_GOAL_SCORER, and SAVES (goalies; it first
  appeared the afternoon of 2026-10-13). Unused so far: TEAM_TOTAL, POWER_PLAY_POINTS. Futures
  events (no " @ ") are skipped.
  - **Saves is a thin book** (`saves_lines_from_event`): a main line often has one price or none.
    The line is kept anyway (it still says where the market is); the over's fair chance is
    Over/(Over+Under), a lone ask / 1.05, or 50% with no price, held to 35-65%
    (`saves_over_chance`). Goalies with no game this season are kept by name (`id` None).
  Same odds lock as NBA: only `OPEN_PREGAME` events, and a started game keeps the lines and the
  player odds of the last build before puck drop (`apply_lines`, `locked_player_odds`).
- **The NHL's "projected lineups" story for every game** (NHL.com's game preview, found
  2026-10-13): `forge-dapi.d3.nhle.com/v2/content/en-us/stories?tags.slug=gameid-{id}&tags.slug=game-preview&context.slug=nhl`
  lists the story, its `selfUrl` has the text (`parts`, type `markdown`). Plain text: a
  "<Team> projected lineup" heading, one line of text per forward line ("A -- B -- C") and defense
  pair ("A -- B"), the goalies one to a line (**the first is the expected starter**), then
  "Scratched:" and "Injured:", then a "Status report". Posted around midday Eastern on game day
  (some West-coast games later), so the 8:17 am ET build has none; the hockey-only refresh (`nhl-refresh.yml`, hourly from
  midday to puck drop: members-and-hosting.md, "Build minutes") picks each one up. 1,300 of 2025-26's 1,312 games had one; 95% of the skaters listed did play. Old seasons'
  stories are still served. `parse_lineups`, `lineup_slots`, `fetch_lineups`.
  - The story is typed by hand. Two things it does (both met 2026-10-13): a team dressing seven
    defensemen lists the seventh **on his own line above the goalies** (Victor Hedman was read as
    Tampa Bay's starting goalie), and a pair can lose a space ("Tony DeAngelo --Scott Mayfield").
    So lines are split on `--` alone, and a lone name is a goalie only if the site doesn't know
    him as a skater and he is one of the last two; any other lone name is a skater in the lineup
    with no line or pair (`slot` None: on the Shots page he is under All, not Lineup Confirmed).
- **Confirmed starting goalies:** not in any feed, but the expected starter is the first goalie
  in that story (`shots.json` `lineups[game][team].goalie`). Game Previews doesn't show it yet.
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
- **This season only: no last-season file.** `prior_2026.json.gz`, `--write-prior`,
  `default_view`, `team_stats_prev`, `prev_season_label`, each player's `prev` and the player
  files' `prev` were removed 2026-10-13 (see "This season only" below). The file is in git
  history; the replays download a past season's games themselves.
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
- `reduce_game` also counts each team's unblocked shots a man up (`unb_pp`), which the shots
  model reads as "power-play shots allowed".
- Output: `teams`, `team_stats` (every stat as `off_*` and the matching
  `def_*` allowed, plus record, power play, penalty kill), `recent_games`, `skaters` (12 forwards
  and 6 defensemen a team), `goalies`, `injuries`,
  `schedule` (yesterday through 14 days out, Novig lines, `away_rest` / `home_rest` days),
  `player_odds` (`{game id: {player id: odds}}`), `league` (each area's share of shots and
  shooting %, under `season`), `novig_debug`, `feed_debug`.
- **Player files** (`write_player_files`): `site/nhl/players/<TEAM>.json`, one per team, written
  next to data.json on every build and not tracked by git. Each holds, for everyone whose latest
  game was with that team, under `season`: the game log (one row per game: `log_lead` then
  `skater_cols` / `goalie_cols`), `areas` (skater `{area: [shots, on goal, goals]}`, goalie
  `{area: [shots faced, goals]}`), and for skaters `types` (shot type: `[shots, goals]`), `unb`
  and `pp_unb`. The page loads a team's file when one of its games is opened, so data.json stays
  small (the files are about 10 KB each early in a season; they were 80 KB with last season's logs).
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

## This season only, everywhere (the user's rule, 2026-10-13, said three times)

The third time, for the whole site: "is the last season data on NHL slowing things down? ... It
really isn't relevant to me and if we need to scrap all past season NHL data I would be fine with
that. currently it defaults to last season anyway which i hate. Let's scrap all of last years
data on the site - if youd like to keep it archived for running tests on models thats fine."
So there is no last-season number on any NHL page, no season switch, and Game Previews opens on
this season with a "small sample" note until the middle team has played 10 games. (It was not
slowing the build: the old file was read from disk. The pages got lighter: data.json 1,217 KB to
828 KB, the player files 2,717 KB to 313 KB.) Do not re-offer last season as a fallback.

The first two times, for the prop tools:


"For shots/goals/points/saves I think it would be best to JUST use the current season and
understand that for awhile the sample will be small. A small sample of current form and style is
more accurate than a previous season with bad data." Then, when a fade-out was offered: "I don't
want a gradual fade out. I don't want last season's data in the model for shots at all."

- **No last-season data in any NHL prop model** (shots now; goals, points, saves when built): not
  a player's old rate, not a defense's old numbers, not as a starting point that fades. Do not
  re-offer a blend.
- What a small sample is steadied with must come from this season too (this season's league
  averages), and every number shown on a prop page is this season's.
- The user was shown what this costs (below) and chose it. The cost is real for the first 10-20
  games of a season; say so again only if they ask why the page looks the way it does.

## Shots on goal model (`nfl_tool/nhl/shots_model.py`, standard library only)

The user asked (2026-10-13) for a shots tool that weighs "a variety of factors" and was honest
about one worry: "Vegas has this info and can model better than me." So every weight was fitted
on a replay, and the page keeps a record against the real prices.

- **Projection = shots per minute x minutes tonight x tonight's matchup**, from this season's
  games only (`shots_model_for` gives the model no prior).
  - Shots per minute: his shots for every minute played, each game back counting 0.985 of the one
    after it, with 50 minutes of an average skater mixed in (`pad_minutes`): **an average skater
    at his position WITH HIS ICE TIME** (`role`: his minutes over the position's average, to the
    power `role_power` 1.0). Three quarters of the rate is read from shot ATTEMPTS (times his own
    on-goal share, pulled hard to the league's): attempts predicted shots on goal better than
    shots on goal did.
  - Minutes: his recent ice time (each game back counts 0.8); a game under 60% of his usual
    ("left early") doesn't change it.
  - Matchup pieces, each an exponent on "what the other team allows against the league"
    (`WEIGHTS`): overall shots on goal 1.0, his position (forwards / defensemen) 0.5, the rink
    areas he shoots from 0.5, power-play shots allowed x his power-play share 0.6; home ice +3%,
    second night of a back-to-back -3.5%, opponent on one +3.5%; `scale` -4%.
  - A defense's number is its games this season mixed with 20 games of a league-average defense.
  - **Tonight's line** (`line`, weight 0.2, when the NHL's projected lineup is posted): the
    log of what his line or pair has been playing on this team (`slot_minutes`: the three busiest
    forwards of each game are "the first line", the next three the second; pairs by twos) over
    his own minutes, capped at +/-0.6. A fourth-liner listed on the top line gets about +13%.
    His minutes on the page stay his own.
- **Chance to clear a line:** a count a little streakier than pure chance (negative binomial,
  spread = m + 0.07 m^2). `chance_at_least`, `chance_over`, `fair_american`.
- **The replay** (`python tools/backtest/nhl_shots.py 2026`; `--tune` tries other settings;
  `--last-season` starts from the season before as well, to measure the rule above; a missing
  season's games download in about 4 minutes and its projected-lineups stories, kept in
  `data/nhl/previews/<season>`, in about 5): every 2025-26 skater-game projected only from that
  season's games before it. What it showed:
  - His rate and ice time are most of it. For the middle 80% of players the defense's overall
    number moves a projection about 6% either way, position 2%, rink areas 1%, power play 1%.
  - A hot or cold last five games added nothing. Neither did team strength or the defense's
    attempts allowed once shots on goal allowed was in.
  - Honest chances: "60-70% to clear" cleared 63-65% of the time.
  - Knowing the real ice time would have helped more than every matchup piece together.
  - **A line change is real but smaller than it looks** (the replay with every game's projected
    lineup): the `line` piece fitted at 0.21 +/- 0.03, the most reliable matchup piece after the
    defense's overall number, worth -4% to +4% for the middle 80% of players. A 12-minute forward
    listed on the first line played 9% more and shot 10% more; a fourth-liner on the second line
    +19% minutes, +24% shots. He does not inherit the star's ice time or power play: the gap
    between his minutes and the line's closed by only about 15%. Stars listed on a "third" line
    barely move (NHL.com lists lines in the team's order, not by ice time).
  - **The small-sample guard is not optional.** Raw this-season numbers with no guard missed by
    5% more at 5-9 games and 13% more in a player's first four.
  - **Fading a hot start has been right.** When a player's average after 5-9 games said "over"
    and the model said "under", he went over 36% of the time at 1.5 (the average implied 57%, the
    model 43%). Defensemen averaging 1.6-2.2 after 5-9 games went over 1.5 in 42% of their next
    games.
  - **What this-season-only costs:** the defenses, nothing. The players: a volume shooter can't
    be told from a hot start, so the 66 players who averaged 2.5+ the year before were projected
    0.5 shots low in games 1-4 and 0.35 low in games 5-9 with a plain average-skater guard. The
    ice-time guard cut that to about 0.1 with no loss elsewhere. With last season in, it was 0.05.
- **The user's finding that started the line piece (2026-10-13):** "the biggest edges are
  flagging players with an injury on their offense ... both had a minutes increase due to the
  injured teammate ... Vegas obviously knows and is accounting for it, we are not." True: Warren
  Foegele (0.33 shots a game, 11 minutes) was on Ottawa's top line that night and the model had
  him as a fourth-liner. The lineup closes part of that gap (0.67 -> 0.75), not all of it: most of
  what is left is a cold six-game start that this-season-only can't see past.
- **Expect a big "check" group until about game 20.** On the first slate (teams 5 games in) 33
  of 252 lines were 12+ points from the market: a model that has only seen this season against a
  book that knows who Cale Makar is. That is the rule working as chosen, not a bug.
- **Power-play units: tested, not added** (`tools/backtest/nhl_pp_units.py`, 2026-10-14, the
  owner: "look into adding power play units into the model ... at least rotowire has them").
  The NHL's own shift charts (`api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=...`,
  open, about 0.25 s a game, kept in `data/nhl/shifts/<season>`) plus the play-by-play's
  `situationCode` give every skater's power-play time in every past game. On 2025-26, his share
  of the team's PP time last game (or last three) added nothing beyond the model (weight 0.01,
  -2% to +1%): his rate and recent minutes already carry his PP role, and last game's share
  was no better a guess at tonight's than his season share. Only tonight's real units would
  help (at most -16% to +9%, an overstatement), and those come from morning practice reports.
  Rotowire and Daily Faceoff publish them, but they are someone else's paid product (the
  MoneyPuck rule: not scraped for a site with paying members); a licensed feed would be the
  way. The NHL's projected-lineup story has no PP units.
- **It has NOT been shown to beat the line.** No free history of shots-on-goal prices exists.
  Same rule as the GMG model: a talking point until the record says otherwise.

## Shots page data (`site/nhl/shots.json`, written next to data.json; not tracked)

- `games`: `{game id: {locked, final, players: [rows]}}` for games through `SHOTS_DAYS_AHEAD`
  (2) days out; each team's lineup (the same 12 forwards and 6 defensemen as Game Previews).
  A row: `games` and `avg` (his shots on goal a game this season: what his game log says),
  `mean` = `usual` x `matchup`, `minutes`, `lift` (what each piece did: 1.06 = +6%), `shares`
  (where he shoots), `chances` (1+ ... 8+ shots), `out` (ESPN: anything but day-to-day), and
  tonight's line: `slot` ("F1" ... "D3", null until the lineup is posted), `usual_slot` (the line
  his own minutes say he has been on), `line_minutes`, `move` ("up" / "down" / null).
- **Who is projected:** once a game's lineup is posted (`posted` on the game), exactly the
  skaters it lists who have played this season (a scratch or an injury isn't in it, a call-up
  before his first game has nothing to project from). Until then: the team's usual 18 by ice time,
  less anyone ESPN lists as out. Everyone in a posted lineup is added to data.json's `skaters`
  so his name opens the card.
- `lineups`: `{game id: {posted, team: {lines: [[names]], goalie, scratched, injured}}}` as the
  story has them, for the breakdown's linemates.
- **Same lock as the odds:** a game that has started keeps the previous build's rows (read from
  the live `shots.json` with the build key); with nothing saved it shows no projection rather
  than one made after puck drop. A finished game's rows get `actual` (real shots on goal; null
  if he didn't dress).
- `defense`: per team, what it allows a game for each stat the model reads: `season` and
  `season_rank` (1 = allows the most; what the page shows), `blend` / `factor` / `rank` (the
  steadied number the model uses), `league`, `games`.
- `edges` (`SHOTS_EDGES`: lean 3 points, strong 6, check 12) and `record`.
- **The record** (`model_history/nhl_shots/<month>.json`, committed by the deploy's "Save GMG
  model record" step): each finished game is written once, with every player who had a main line
  and played: `[id, name, team, line, over, under, projection, chance of the over, real shots,
  season average, line move]`, all as locked before puck drop. `shots_record_summary` grades the
  better side of each line (`shots_play`, whose `size` is how the page files it) into `strong` /
  `lean` / `none` / `check`; for edges of 3 to 12 it
  also splits `over` / `under` and **`fade` / `with`**: plays against the player's own season
  average (an under on a line he averages more than, or the reverse) next to plays with it.
  Wins, losses, units won risking 1 a play.
  - **The plays themselves** (the user, 2026-10-13: "a way to see plays that declared any edge and
    have a record of it. possibly grouped into buckets"): `record.days` = every day's tally of
    the plays with an edge (lean + strong), and `record.plays` = each graded play that declared
    an edge (lean, strong or check) on the latest `SHOTS_RECORD_DAYS` (14) days that have any:
    side, line, locked price, edge, projection, real shots, won, units, `fade`. The buckets cover
    the whole season; the list is capped so shots.json doesn't grow by a megabyte by spring.
  - On the page: the **"YTD Model Performance"** button beside the Shots on Goal title opens the
    record in a popup (`#shots-record-modal`; the user's wording and placement, 2026-10-13; it
    sat at the bottom of the page first and they couldn't find it). In it, the tiles, then
    (`recordPlays` in shots.js) "Graded plays", newest day
    first, each day headed by its own W-L and units, with bucket buttons **Every edge** (how it
    opens) / **Strong** / **Lean** / **Check first** and the shown bucket's total beside them.
    Nothing is typed in by hand: each build adds the games that finished since the last one.
  - **Started games stay on the list, grayed, under the plays still to come** (the user, later
    the same evening, with a game under way and its players still ranked as plays: "keep all the
    plays of the day on the shots list but have them grayed out if they are live kinda like the
    king of the crease is doing ... then have a toggle once games start at the top that
    differentiates and sorts from live and not"). `gameState` in shots.js: "open" / "live" /
    "final", from the build's `locked` AND the clock against `start_utc` (a build can be hours
    old at puck drop). Order is always open, live, final, whatever the sort; live rows are grayed
    (`.shots-live`) under a "Live now" heading; a day with both kinds gets the buttons **All
    games** (how it opens) / **Not started** / **Live / final**. A finished day is not grayed. The lock is the last build before puck drop (since 2026-10-13 usually the hourly refresh
  within the hour before it), not the closing line.

## Pages

- **`site/nhl/nhl-common.js` is shared by every NHL page** and loads first: the data
  (`loadNhlData`), the season switch (`view`), helpers, the rink drawing (`rinkSvg`) and the
  player card. A new NHL page adds its own script after it and defines `render()` (called when
  the season or theme changes) and, if it has a selected game, `currentGame()`.
- `site/nhl/index.html` + `nhl.js` = NHL Game Previews v1: day strip, The Line (moneyline with win chance, puck line, total), The Teams (10
  tiles), Offense vs Defense (7 rows, same two-sided tags as NBA), Where the Shots Come From (a
  rink per offense), Goalies, Skaters, Injuries, Recent Games (with who started in net).
  - Where the Shots Come From (the user, 2026-10-14: "add the same triple data bubble logic
    that's on the player props"): the big number is the offense's shots a game from the zone;
    under it the Shots page's three boxes for the other DEFENSE (allows a game, share of all it
    allows, rank). The zone keeps its both-sides color (`rinkStep`); the boxes are on the
    defense's own rank colors.
- **Every team, one number: the league-wide list** (`openLeagueModal` in nhl-common.js, the
  NFL site's stat-rank popup redone for hockey; the user asked for it "on all pages"). Any
  element with `data-league="${leagueAttr(p)}"` opens it: every rink zone (Game Previews both
  sides side by side, offense left and defense right, mirrored like the NFL's paired view; the
  Shots page and the card's Shot Map the defense only), the card's "OPP allows" cells, and both
  numbers of each Offense vs Defense row. Each side most first with its rank in words down the
  left; this game's teams outlined; each number on the eight colors by its own league rank. A
  rink list keeps the rink's colors (the most = green); an Offense vs Defense list colors the
  defense like its table cell (allowing the least = green). It opens over the player card, and
  Escape closes it first.
- **The player card** (nhl-common.js) is the ONE popup for every skater and goalie on every NHL
  page: wrap any name or photo with `playerClick(id, inner)`. **Any new place that shows an NHL
  player must use it.** It reuses the NFL card's shell (`#player-card-modal`, `.pc-box`,
  `.pc-head`, `.player-modal-toggle`); the NFL `player-card.js` is not loaded on NHL pages.
  - Tabs in the user's order: **Game Log** (opens here), **Shot Map**, **Odds**.
  - Game Log: newest first with a per-game row on top. Ice time, shots on goal and attempts are
    shaded against the player's own games; goals, assists and points only light up when he
    scored (zeros stay plain, or the whole table is red).
  - Shot Map, skater: a rink of where his shots come from, every zone on the eight rank colors
    by what tonight's opponent allows from there (the same chart as the Shots page's "Where he
    shoots"; with no game to read it against, the old shading by his own shots), and a table
    from the net out: shots per game, share, on goal, goals, shooting % next to the league's,
    and what the opponent allows from there with its rank, in the same color as that zone
    (`oppAllowsCell`: from the SHOOTER's side here, green = allows the most, so the card agrees
    with itself). Chips: goals a league-average shooter would have on the same shots from the same
    areas, power play share, shot types.
  - Shot Map, goalie: save % by area. A zone is colored only with 30+ shots faced and goals 1.5
    standard deviations from what the league allows on them (`goalieAreaTier`): luck alone
    should not paint a zone.
  - Odds: the lines above for the player's game (the open one, else his team's next), with
    `thin` tags and the ladders as "N or more" chips. A goalie's only line is Saves.
  - A team whose file can't be read still opens the card (season tiles and odds only).
- `site/nhl/shots.html` + `shots.js` = **Shots** (the nav button next to Game Previews): one
  table for the day's slate, a row per skater, ranked best edge first.
  - **Edge = the model's chance minus the chance the price needs to break even**, for the better
    side of his main Novig line ("Best side"; Overs / Unders show one side for everyone). The page
    does no shot math: it reads `chances` and compares them with prices. `pickSide` must agree
    with the build's `shots_play` (a test checks every row), since the record is graded by it.
  - **"Check first" plays lead the ranking**, under their own heading, amber instead of green: a
    gap of 12+ points (`check`: a handful of games against everything the market knows), and **a
    play against tonight's line change** (`new line`: an under on a player moved up a line, an
    over on one moved down). Then "Plays", best edge first. They sat at the bottom as "Not
    plays" until the owner, 2026-10-14, after night one (check 44-29, +7.5u; lean 14-27): "These
    are massive edges, and last night the top 10 plays went 9-1. I don't like that they are
    hidden at the bottom". A **Check plays: Shown / Hidden (N)** switch (`shotsView.checks`)
    drops them. The record still grades them as their own bucket.
  - **Toolbar:** Side, Skaters and Lineups are dropdowns (`.shots-filter-select`, the owner: "to
    reduce the clutter"), then the Check plays switch. "How the number is made" sits at the top
    of the Shots panel, under the schedule strip.
  - **Line column:** L1-L4 / D1-D3 from the projected lineup, an arrow when it is above or below
    the line his minutes say he has been on, "--" until the lineup is posted. A note above the
    table says how many of the day's games have lineups, and each game in the strip is marked
    "Lineup" (with a check mark) or "No lineup yet" (`board.posted`). The breakdown shows the line as its own
    piece ("L1 tonight +13%"), his linemates, and who is injured or scratched.
  - Columns: Line, the play, Avg (his season average) next to Proj, Model %, Fair price, Edge, Min
    (arrow = a minute off his season average), then what moved the number: Opp, Pos, Spots, PP,
    Home/rest. **Green = more shots for him, red = fewer** (the Over chip is green, the Under chip
    red, so a row agrees with itself). A piece is colored from 2.5%.
  - **A called play that goes against his own season average says so** ("vs his avg" next to the
    play). The first play the user opened was an under 1.5 on a defenseman who had cleared it in
    3 of 5 games ("why on earth would we play an under?"). The breakdown now starts from his
    season average and shows the small-sample step by name ("5-game sample -22%").
  - **A defense's tiles are never colored alone.** The user read red tiles as "bad defense"
    when red meant "fewer shots" (Ottawa was allowing the fewest point shots in the league). So:
    this season's own number, its rank said from the nearer end (`rankWords`: "3rd most", "the
    fewest"), and a word (Leaky / Stingy / Average).
  - **"Where he shoots": his share in bold, the defense in three boxes per zone** (the user,
    2026-10-13: the bold share "is helpful", but "allows x most/fewest ... is all relative
    information. It's also very wordy"). `zoneBoxes` in nhl-common.js, each box on the eight rank
    colors: shots a game allowed from the zone ("8.0/g"), that zone's share of ALL the shots
    the team allows ("21%"), and the league rank.
    - **Every rank is said from the nearer end, with its word: "2nd most", "3rd fewest"**
      (`rankWords` in nhl-common.js; the rank box is `rankBoxText`: the ordinal over a small
      "MOST" / "FEWEST"). A bare number reads backwards whichever way it counts: the user read
      Florida's "8.0/g ... 30th" (1st = allows the most) as a soft defense on 2026-10-13, so it
      became "1st = allows the fewest", and on 2026-10-14 read "WSH allows 13.5, 31st fewest" as
      wrong for a leaky defense: "it should flip and read x most when they are bad and x fewest
      when they are good ... split 50/50". Rank 1-16 of 32 is "most", 17-32 "fewest". Same on
      every NHL page: rink boxes and hovers, the card's "OPP allows" column, the Shots page's
      tiles, the league-wide lists. The COLORS stay the shooter's view ("green means go!"):
      green = the most shots for him. `season_rank` in shots.json counts 1st = allows the most.
    - **What colors a zone as a whole: the league-wide count, not the team's own split** (the
      user asked for this to be settled without adding complexity). Their example: a team
      allowing 10 shots can give up 80% of them from the low slot (8) and still allow fewer
      there than a team giving up 25% of 40 (10). A shooter's shots come from the count, and the
      count is what the model reads. So the zone, the count box and the rank box are on the rank
      for shots a game; the share box is on its OWN league rank (`areaShares` in shots.js,
      worked out on the page), so a defense that funnels shots into a zone still shows. No
      blended score.
    - The rink is 520px wide here (three boxes must fit the 18 ft low slot); the strip outside
      the zone carries the same three numbers as one uncolored line. On a phone the boxes are
      small. The player card's Shot Map still has its table instead.
  - A row opens its breakdown: his season average, the sample step, the matchup pieces
    multiplying out to tonight's number, the defense's tiles, every line the book prices at the
    model's fair price, and the rink of where he shoots (above), with the key underneath.
  - Filters: side, forwards / defense, and **"All" (how it opens) / "Lineup Confirmed"** (the
    user's words, 2026-10-13: "Only show players with a line by default, and remove the feature
    to sort by everyone"; then 2026-10-14: before the lineups are in "the page doesn't auto
    populate until you hit ALL ... that may confuse people", so it opens on All). Lineup
    Confirmed = only players on a line or pair in a posted lineup (`slot`); All adds the games
    still waiting on one. **A player with no shots-on-goal line is
    never listed** (there is no "Everyone" view any more). A day or game with nothing under
    Lineup Confirmed says why and has a "Show all players" button. A game in the strip shows only
    that game; click it again for the whole day. Players marked out are left off.
  - "Confirmed" is the user's label for "the NHL's projected lineup is in". It is not the
    official sheet from warmups; the page's About box says so (95% of listed skaters played).
  - Names open the player card.
- `site/nhl/promo-tools.html` + `promo-tools.js` = **Promo Tools: King of the Crease** (below).
- **Styles:** hockey-only rules go in `site/nhl/nhl.css` (never style.css: see styles.md); the
  layout shared with the NBA page is `site/suite.css`.
- It reuses the NBA page's layout classes (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app` /
  `.nba-soon` for the launch guard, now open); hockey-only styles are `.nhl-*`. It does not load
  common.js.
- **Every rink zone is colored, on the NFL Summary's eight rank colors** (the user, 2026-10-13:
  "I don't like when the shot charts are not colored. Red and green show, but sometimes it's
  just the natural display ... the scaled view of 8 colors ... on the entirety of the site").
  `RANK_SCALE`, `rankStep`, `zoneOnStep`, `cellOnStep`, `rankScaleKey` in nhl-common.js (a copy
  of common.js's `RANK_SCALE`: change both together). Four teams to a step.
  - **The colors mean how MANY shots, not good or bad** (a lot of point shots isn't a strength):
    1st = the most shots = green, last = the fewest = red, and every rink carries the key
    ("the most ... the fewest") so it can't be read backwards.
  - A player's rink (Shots page breakdown, the card's Shot Map): the number is his own share or
    shots, the color is the OPPONENT's rank for shots allowed from there.
  - A team's rink (Game Previews): both sides as one (`rinkStep`): the offense's rank for shots
    taken from there and the defense's rank for shots allowed, averaged, then spread back out
    (two ranks averaged bunch in the middle) and cut into the eight steps. Sides that disagree
    land in the middle colors. This replaced the green / red / plain `rinkCall`.
  - Never colored: the strip outside the zone (too rare to read), and its row in the card's
    table. The goalie's map keeps its own rule (colored only past what luck explains).
- Logos are the NHL's SVGs, with a dark-page version (`logo_dark`); the page redraws on a theme
  switch.

## King of the Crease (Promo Tools; built 2026-10-13)

DraftKings' promo: everyone whose goalie makes the **most saves of the day** shares $500K in
bonus bets (ties split; if your goalie doesn't start, the team's starter counts for you; the
qualifying bet must be +100 or longer). The NHL twin of King of the Endzone, with one thing that
tool lacks, asked for by the user: **Value** next to Upside ("picking chalky and popular picks
means your payout will be smaller").

- **The saves model** (`nfl_tool/nhl/saves_model.py`, standard library, this season only):
  a league-average start x how much the other team shoots x what his own team gives up x home /
  rest x his save rate. `WEIGHTS`: off 1.0, def 0.85, home -3%, his team on a back-to-back +3%,
  the other team on one -3%, save rate 1.0. Teams are this season's games mixed with 10 games of
  a league-average team; a quarter of the volume is read from attempts.
- **The replay** (`python tools/backtest/nhl_saves.py 2026 2025`, `--tune`): 5,034 starts over
  two seasons, each projected only from that season's games before it.
  - The two teams are nearly all of it (each moves a projection about 6% either way). His save
    rate: about 1%. **His own saves a start predicted worse than calling every goalie average.**
    Team strength, recent form and in-close scoring chances added nothing.
  - **Early in a season it knows little:** in the first two weeks its miss was 5.36 saves against
    5.42 for "everyone is average"; full strength by about game 20.
  - The spread (`save_spread`): a count with `DISPERSION` 0.02, plus 5% of starts ending early at
    about 12 saves (a pulled starter). Said / was within a point or two from 20 saves to 40.
  - **The promo's own question** (`top_chances`): goalies given 10-14% led their day 10% of the
    time; the favorite led 18% of days (a random pick 8%); the top three had the leader on 42%.
    The day's best averaged 36.7 saves (31 to 43 most days); 9% of days ended in a tie.
  - Not shown: that it beats the line (no free history of saves lines), or how many people pick
    each goalie (DraftKings doesn't publish it; payouts after the fact could back it out).
- **The board** (`crease_board` -> `site/nhl/crease.json`, untracked): `days[date].goalies`,
  one row per team playing, for the same days as the Shots page.
  - **A starter is never called confirmed** (the user, 2026-10-13: "Massive error ... this cannot
    happen"). The first version showed Nico Daws for New Jersey with a check mark while Jake
    Allen was starting: it trusted the NHL's projected lineup first and called it confirmed. That
    story is one writer's midday projection (that day's said "the Devils did not hold a morning
    skate"). Measured on 2025-26: its first goalie started 92% of the time (2,378 of 2,583), and
    55% when it named the goalie who had started the night before. Starters are official at
    warmups and no feed the site reads carries that.
  - **Starter** (`crease_starter`), `source`: "both" = the NHL's lineup and the book's saves line
    name the same goalie (the ONLY check mark, worded "agree", never "confirmed"); "split" = they
    differ: the book's goalie is shown (later, and money behind it) and `other` carries the
    lineup's name, drawn as a warning beside him; "lineup" / "market" = one source only, no mark;
    "usual" = neither (most starts, or the other goalie on the second night of a back-to-back).
    `doubt` = the lineup alone names last night's starter (a warning). A test fails if the page's
    script uses the word "confirmed".
  - Row: his season (`starts`, `saves_avg`, `sv_pct`, `high`), both sides of the matchup
    (`opp_shots` + rank, `allowed` + rank; 1 = the most, either way more work for him), the
    model's `shots` and `mean`, the line (`line`, `over`, `under`, `alts`, `mkt_mean` = the line
    and price turned back into saves), `blend`, `big` (chance of 35+), `top`, `mkt_top`, `value`,
    `check`, `tags`.
  - **Upside leans on the market** (`CREASE_RULES`): `blend` = the line moved toward the model by
    `0.5 x min(1, games / 20)` (the fewer of the two teams' games): about 14% in mid-October,
    halfway from game 20. A goalie with no line is on the model alone. `top` = his chance to make
    the day's most saves, ties included, from every starter's `blend`.
  - **Value = `top` / `mkt_top`**, where `mkt_top` is his chance if he were exactly what his line
    says **against the same field**. Only his own number changes. (The first version compared two
    whole fields and tagged every low-line goalie, because the model's projections are bunched
    early in a season.) Tag at 1.15+, with `top` at least half an even split of the day, and
    never when `check` (model and line 4+ saves apart: shown as a dashed "?" box).
    **Expect almost no Value tags until teams have played 10-15 games**: the rule working.
  - Upside tag: the day's best `top`, three at most (one per four starters on a short slate).
  - Lock: a started game keeps the previous build's rows; a final one gets `actual` (the saves of
    whoever STARTED for the team, which is who the promo counts) and, once the whole day is
    final, `led`. A game still open is worked out against finished goalies' real totals.
- **The record** (`model_history/nhl_crease/<month>.json`, committed with the other records):
  each finished day once. `crease_record_summary`: how often the favorite and the Upside tags
  led, the Value tags against what the chances and the lines said, and the average miss of the
  model, the line and the blend. It is what will say whether `blend` deserves more or less.
- **The page:** day strip (not clickable; the promo is the whole day), one table in King of the
  Endzone's look (`.koe-*` + `.crease-*`), every column sortable, always the whole slate, the
  record tiles and an About box. The page does no math. Matchup columns are on the eight rank
  colors by league rank; the Novig line, saves a start and Tonight's by rank within the day.
  - The user's edits the same evening: no Upside chip ("clutter and already displayed in the
    chart"; the tag stays in the data for the record, Value keeps its chip), a narrower name
    column, the line without the over's price, the line and saves a start color coded "best to
    worst", and no Top 10 cut ("show the whole slate on the export photo").
- **Save image** is the priority (the user: "a clean and crisp image to twitter"): the table
  with a GMG title bar and a key, at 2x. **Logos on this page are ESPN's** (`shareLogo`):
  assets.nhle.com sends no cross-origin header, so html-to-image can't carry the NHL's own files.
  No headshots for the same reason. The image is always the whole slate.

## Tests and checks

- `tests/test_nhl.py` (the build, on one saved game and one saved Novig event) and
  `tests/test_nhl_site.py` (the page and the player card in a browser on a saved `nhl/data.json`
  and two saved player files, NJD and DET). They run with the rest
  (`python tools/run_tests.py`), so a broken NHL test stops a deploy like any other.
- `tests/test_nhl_shots.py` (the model, that the build never hands it last season, tonight's
  lines read from a saved story (`nhl_lineup_story.json.gz`, STL @ OTT), and the board, lock and
  record, on the saved game and hand-made games) and `tests/test_nhl_shots_site.py` (the Shots page in a browser on
  `nhl_shots.json.gz`, the shots.json that matches the saved data sample).
- `tests/test_nhl_saves.py` (the saves model, Novig's saves lines, the starter, the lineup
  reader's lone-name fixes, the board, lock and record) and `tests/test_nhl_crease_site.py` (the
  Promo Tools page in a browser on `nhl_crease.json.gz`).
- `tools/fetch_live_data.py` also downloads the live player files, `shots.json` and `crease.json`, so the
  after-deploy site check sees the pages as members do.
- `tools/check_site.py` opens both NHL pages; like the NBA page they can never block the deploy gate.
- `https://nfl.gmgsports.org/version.json` shows whether the NHL build worked: `nhl.built`,
  `games` / `wanted`, `downloaded`, `lines`, `player_odds`, `shots` (games with projections),
  `lineups` (games whose projected lineup was read), or
  `error` (the build's last line) when it failed.

## Goals (anytime goal): step 1, the replay (2026-10-14; no page yet)

The owner asked for a Goals tab "displayed similarly to shots", with a flag where a player's
heavy shooting area overlaps an opponent's weakness (their example: Brandsegg-Nygard, 44% of his
attempts from the low slot, scored at +500 against New Jersey, who had given up 12 of 22 goals from
there; but NJD was 20th of 32 in low-slot SHOTS allowed). Plan agreed: replay first, then the
model, a one-row mockup, the page, the record.

- `python tools/backtest/nhl_goals.py 2026 2025` (about 20 s a season). Expected goals = a logistic
  table on distance, angle, rink area, shot type, rebound, rush, PP / SH, fitted weekly on the
  season's own shots before each day (this-season-only holds for the league's yardsticks too).
  Projection = his expected goals a minute (50 minutes of an average skater with his ice time
  mixed in) x the shots model's minutes x matchup pieces.
- What both seasons said:
  - Honest chances: "30-35%" scored 33-36%; the top 10% were a touch better than said (34-35% vs
    31-32%). Beats his goals a game clearly (log loss 0.397 vs 0.407; a flat chance 0.431). Only
    a little better than shots x the league's shooting % (0.3968 vs 0.3977).
  - Pieces that count: the defense's expected goals allowed (weight about 1.4, -8% to +9%), his
    finishing (goals over expected goals with 8 xG of average mixed in, weight 0.55, -10% to +10%),
    home, rest, line. Small: tonight's goalie (0.2-0.26, about +/-3%). Nothing: the areas he
    shoots from against what the defense allows from them (weight -0.08 / 0.39, +/-0.5, under 1%).
  - **The Zone Match overlap added nothing beyond the model, either season** (about 4,100 flagged
    games each): heavy low-slot / slot shooter + top-10 defense from that area scored 0.94 / 0.98 of
    what the model expected (shots-allowed version) and 0.93 / 0.93 (goals-allowed version). The
    owner's tighter version (40%+ low slot, top-5 defense): 0.92 both seasons. Flagged players DO
    score more often than average (16-22% vs 15%), but the model already expected it. Goalie weak
    in that area: 1.10 then 0.89 (noise).
  - **Heavy low-slot shooters run about 5-10% under their projection** (0.90-0.95 in every slice):
    a fix for step 2, not a reason to flag them.
  - **A defense's low-slot GOALS allowed is noise; its low-slot SHOTS allowed is real.** Team
    after N games vs the rest of the season, correlation across 32 teams: shots allowed 0.42-0.45
    after 6 games, goals allowed -0.03 / 0.01, shooting % allowed 0.14 / 0.15.
  - The rush flag is crude (only 1.7% of shots: the feed logs few neutral-zone events before a
    shot); it doesn't change the findings.
- Not testable: the price (no free history of anytime prices), and Novig's team totals as the
  model's anchor.

### Step 1b: five "bottom up" ideas, tested like a statistician (2026-10-14)

The owner asked for other ways to attack goals ("a true bottom up style"), then "what would a
statistician do?": write the ideas and the bar down first, fit on one season, confirm on the
other, one model rather than a pile of flags, grade by calibration / log loss, and judge the
live record by closing line value (CLV) because ~900 anytime bets are needed to tell a 3-point
edge from luck. `python tools/backtest/nhl_goals_ideas.py` (about 1 minute; needs 2024-25's
shift charts and lineup stories, now kept in `data/nhl/shifts/2025` and `data/nhl/previews/2025`).
The bar (in the script's header, written before the first run): weight 2+ standard errors from
zero on 2024-25, lowers 2025-26's log loss with 2024-25's weights, same sign fitted on 2025-26.

- **Passed: even strength and power play apart** (his EV expected goals a minute x EV minutes +
  PP rate x PP minutes, from the shift charts; weight 1.1 both seasons, -8% to +4%).
- **Passed: one-timer side** (a right-handed shot from the left side or the reverse, in the
  expected-goals table: off-wing shots scored 9.3% vs 5.7%; small, -5% to +4%).
- **Passed: the low-slot trim** (not blind, step 1 found it): weight -1.1 / -1.2 on his low-slot
  share over his position's, -7% to +7%. The biggest of the three.
- **Out: empty-net goals** as built: the weight came out NEGATIVE (-0.93, -0.34). The players on
  the ice at an empty net are the ones protecting a lead (defensive forwards, top pairs), not the
  scorers. Empty-net goals are 6.2-6.6% of all goals; a rebuilt version would be found by looking,
  so it would need the same bar on a third season.
- **Out:** the penalty matchup (power-play time drawn x given up: nothing), a backup goalie
  beyond the goalie's own record (z 0.9), the team-strength gap (z -1.2).
- Everything that passed together, fitted on 2024-25, on 2025-26: log loss 0.39621 (step-1
  pieces 0.39691; his goals a game 0.407). Honest: "30-35%" scored 32.8%, the top 2% said 40.1%
  and scored 42.8%. Weights: opp 1.35, goalie 0.29, finish 0.44, line 0.23, home 0.10, b2b
  -0.08, opp_b2b 0.055, split 0.98, onetimer 3.44, low -0.95, scale 0.048.
- **The record must grade CLV:** save the first price of the day next to the locked price (the
  last refresh before puck drop), for Goals and, cheaply, for Shots too.
- The owner wants the **Zone Match tag shown and tracked** (its own bucket in the record), even
  though the replay found no edge in it.

### Step 2: the model and goals.json (built 2026-10-14; no page yet, step 3 is a one-row mockup)

- **`nfl_tool/nhl/goals_model.py`** (standard library): exactly the replayed model.
  `tools/backtest/nhl_goals_check.py` replays both seasons THROUGH this file (it reproduced the
  ideas test's 0.39621) and fits `WEIGHTS` on both seasons together; rerun it after any change.
  - Expected goals: two logistic tables (without and with the off wing; the `onetimer` piece is
    the log of one rate over the other), fitted every build on this season's shots in plain
    Python (`fit_xg`, sparse Newton: under 3 s on a full season, identical to numpy to 1e-14).
  - `parts()` = his EV / PP rates with 50 / 15 minutes of an average skater, the shots model's
    minutes / line / home / rest, the defense's xG allowed (20 games of average), the goalie (25
    xG of average), finishing (8 xG of average), the low-slot trim. `chance_to_score` = 1 - e^-mean.
  - **Zone Match tag** (`zone_match`, `ZONE`): 35%+ more of his located shots from the low slot
    or slot than his position (15+ located shots) AND a defense top-10 for shots allowed a game from
    that area AND above the league's average there (added so a small league can't tag everyone).
    Never in the number.
- **Power-play seconds come from the league's per-game report**, not the shift charts:
  `skater/timeonice?isAggregate=false&isGame=true&cayenneExp=gameId=...` (`ppTimeOnIce`).
  The shift charts were empty for 47 of this season's first 105 games and read about 12 s a game
  (15%) short. Kept in the saved game as `raw["pp_toi"]` (`fetch_pp_toi`; a game saved before is
  backfilled when next read); `reduce_game` puts it on each skater (`pp_toi`, None without it; the
  model then reads that game at his own share so far). The replays' copy: `data/nhl/pp_toi/<season>.json.gz`.
- `reduce_game` also keeps every unblocked shot on a goalie as `shots` (`game_shots`, moved from
  the replay: no empty nets, penalty shots, own goalie pulled or shootouts).
- **`site/nhl/goals.json`** (not tracked; on fetch_live_data's list): `games` = the Shots page's
  games, players and lock (`goals_board`), EVERY skater priced or not: `chance`, `mean`, `fair`,
  `lift`, `shares`, `zone`, season `games` / `goals` / `xg` / `shots`, `ev_min` / `pp_min`,
  tonight's `goalie` (the NHL's projected lineup's, else the team's busiest starter; never called
  confirmed), the Novig anytime `odds` / `no_odds` / `thin`, **`first_odds`** (the first price the
  site saw, carried from the live goals.json), `edge` and `size` (`goals_play`, `GOALS_EDGES`
  3 / 6 / 12 points like Shots; a player moved DOWN a line is "check"). Also `defense`, `xg` (both
  tables), `league`, `weights`, `zone`, `record`. A failed Goals step still writes a goals.json
  (`error`), so a reuse deploy's `--need nhl` never trips on it.
- **The record** (`model_history/nhl_goals/<month>.json`, committed with the others): each
  finished game once, every projected player who played (priced or not), `GOALS_RECORD_COLS`, plus
  the game's locked total and moneylines (`market`, to test the market as an anchor later).
  `goals_record_summary`: buckets strong / lean / none / check, `zone`, `thin` (units at the locked
  Yes price); `clv` (called plays: average move in points of chance from the first price to the
  locked one, + = shortened, and how many shortened / drifted); `honest` (said vs scored, everyone);
  `zone_all`; `days` / `plays` like Shots.

## Not built yet (waiting on the user's priorities)

The user's next tools (2026-10-13), each built on the player card and `player_odds`: an anytime
goal scorer tool, a goalie saves prop tool (the saves model and Novig's saves lines now exist:
see King of the Crease). The shots on goal tool is built (above).
For King of the Crease: how many people pick each goalie (ask the user for a winning day's
payout), and a lone skater's place on the Shots page's Lineup Confirmed view.
Also open: expected goals, a Summary card, a game model, shot-by-shot dot maps, the EDGE
tracking stats, playoffs.
For the Shots model: tonight's power-play units from a licensed morning-report feed (past units
from `shiftcharts` were tested and add nothing: see "Power-play units" above); a snapshot of the closing line (the hourly refresh now gets within an hour of puck drop); the expected starting goalie on
Game Previews (it is already in `shots.json`).
