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

## Files (moved here from CLAUDE.md, 2026-10-25)

- Build: `nfl_tool/nhl/build_nhl.py` -> `site/nhl/data.json`, `nhl/shots.json` +
  `nhl/players/<TEAM>.json` (games kept in `data/nhl`). Models: `shots_model.py` (shots on goal),
  `saves_model.py` (King of the Crease + Saves page, `nhl/saves.json`), `goals_model.py` (anytime,
  `nhl/goals.json`), `points_model.py` (1+ point on top of goals, `nhl/points.json`),
  `lines_model.py` (Line Matchups, 5-on-5 lines and pairs from the shift charts, `nhl/lines.json`;
  replaced Line Stacks 2026-10-21, whose `stacks_model.py` stays for the replays).
- Pages (`site/nhl/`): `index.html` + `nhl.js` Game Previews; `shots`, `goals`, `points`, `saves`
  (`.html` + `.js` each); `lines.html/.js` Line Matchups (a preview, no picks); `best.html/.js` Best
  Plays (the pages' edges in one list); `promo-tools.html/.js` King of the Crease + `icebreaker.js`
  (quickest goal of the 7 PM slate); `nhl-common.js` shared by every page (data, rink drawing, the
  NHL player card, the save box `nhlPlayBox`); `nhl.css`.
- Records (`model_history/`): `nhl_shots/<month>.json`, `nhl_goals/`, `nhl_points/` (with each
  number's factors), `nhl_saves/`, `nhl_stacks/` (retired), `nhl_crease/`, `nhl_icebreaker/`.
- Replays: `tools/backtest/nhl_*.py` (shots, saves, goals, points, stacks, icebreaker);
  `tools/nhl_factor_report.py` groups the records by each graded play's saved factors.
- Hockey refresh: `.github/workflows/nhl-refresh.yml` every half hour, pressed by the Cloudflare
  timer `workers/nhl-timer` (installed by `nhl-timer.yml`).

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
  "Scratched:" and "Injured:", then a "Status report". **The game tag is typed by hand:** on
  2026-10-22 Red Wings at Canucks was tagged with Utah at Seattle's id and the Canucks game had
  none, so both went without a lineup. A story counts for a game only if every team it lists plays
  in it, and a game whose tag has no fitting story is matched from the day's preview stories (slug
  ends "-game-preview-october-22-2026"; `day_lineup_stories`). Test: `test_nhl_lineup_stories.py`. Posted around midday Eastern on game day
  (some West-coast games later), so the 8:17 am ET build has none; the hockey-only refresh (`nhl-refresh.yml`, every half hour from
  midday to the last puck drop: members-and-hosting.md, "Build minutes") picks each one up. 1,300 of 2025-26's 1,312 games had one; 95% of the skaters listed did play. Old seasons'
  stories are still served. `parse_lineups`, `lineup_slots`, `fetch_lineups`.
  - The story is typed by hand. Two things it does (both met 2026-10-13): a team dressing seven
    defensemen lists the seventh **on his own line above the goalies** (Victor Hedman was read as
    Tampa Bay's starting goalie), and a pair can lose a space ("Tony DeAngelo --Scott Mayfield").
    So lines are split on `--` alone, and a lone name is a goalie only if the site doesn't know
    him as a skater and he is one of the last two; any other lone name is a skater in the lineup
    with no line or pair (`slot` None: on the Shots page he is under All, not Lineup Confirmed).
- **Confirmed starting goalies:** not in any feed, but the expected starter is the first goalie
  in that story (`shots.json` `lineups[game][team].goalie`). Game Previews' Goalies table tags the expected starter from crease.json (`starterRow` / `starterTag` in nhl.js; owner's request 2026-10-17): "Expected starter", a check mark when the lineup and the book agree, never "confirmed".
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
- `lineup` discounts ice time for a player with only a game or two (the lineup-aware usage rule),
  **never for one who dressed in his team's latest game** (`last_dressed`): Charlie McAvoy came back
  2026-10-13 after six games out, played 24:41, and the discount ranked him 8th of Boston's 8
  defensemen, so he was on no prop page until a lineup was posted (a member found it, 2026-10-16).
- **Tripwire** (`unlisted_priced`): a player with a Novig shots line in a game not started who is on
  no prop list goes to data.json `feed_debug.unlisted`, the build log, `version.json`
  `nhl.unlisted`, and a (never blocking) PROBLEM in `check_site.py`, so the daily site check
  reports it. `nhl.unmatched`: book names matching no player the site knows (one yet to play).
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
    ("left early") doesn't change it. **Before he has 3 games**, a game under half the league's
    last line / pair (`short_first`; about 5 min F, 7.5 min D) is "left early" too, and kept in
    `ShotsModel.short` so the goals model skips it for EV / PP minutes. With no full game yet, his
    minutes are tonight's line or pair's (`minutes_from` "line"; the goals model gives the power
    play his position's league share of them), and with no posted lineup he has **no number at
    all**. Three short games = he really plays that little (`short_games`). Why: Jake Sanderson
    left the opener hurt after 4:29, missed 8 games, came back 2026-10-21 on Ottawa's top pair
    and was projected as a 4.5-minute defenseman (0.07 shots, 1% for a point). On 2025-26's
    replay the rule changed nothing else (deviance 1.23111 vs 1.23114). Tests: `test_nhl_unsure.py`.
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
  - **Checked on two seasons (2026-10-16):** the same replay on 2024-25 (fitted there, then scored on
    2025-26) put every weight back within its error range except power play: 2024-25 fit opp 1.11
    +/- 0.11, pos 0.33 +/- 0.20, area 0.99 +/- 0.34, line 0.20 +/- 0.03, home +3.2%, b2b -2.7%,
    opp_b2b +1.6%, spread 0.063. **Power play came out -0.09 +/- 0.34** (0.6 on the site); it swings
    half to half within one season (2024-25: +0.51 then -0.84) and is 0.22 +/- 0.23 on both seasons
    together: noise, worth under 1% of a projection. The 2024-25 weights scored 2025-26 no better
    than the site's (deviance 1.2312 vs 1.2311), so the owner kept every weight as is.
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
- **The Shots bar (2026-10-19): a play is shown or left out, no Lean and no Check.** A play =
  an edge of `SHOTS_BAR` (6 points) or more on a player NOT moved down a line tonight
  (`shots_play`, `size` "play" / "none"). The owner asked for an audit of every graded play and
  "only strong plays". On the first six nights (485 plays with an edge): edges of 3-6 went 50-72
  (-20%); players moved down a line lost on BOTH sides (38-56, -22%) in both halves of the record;
  12+ gaps were not worse (53-43) and unders on players moved UP won (45-23), so the old "check"
  set-apart was dropped. The bar's plays went 154-117, +17.5u (+6.5%; 58.5% then 54.0% by half),
  in sample, so expect less. **Not used, on purpose:** a cut on tonight's number against his
  season average (it scored better, but the owner: fill-ins for injuries move a player's role,
  "grading vs their own season average ... muddy waters"). **Goals keeps its Lean / Strong /
  Check buckets** until it has more games graded; Points got its own bar 2026-10-22 (see "The
  Points bar"). Re-run `tools/nhl_factor_report.py` before changing the bar.
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
- `edges` (`SHOTS_EDGES`: lean 3, strong 6, check 12; now only the every-book price tags' sizes on
  other pages and Best Plays' Goals / Points cutoff), `bar` (`SHOTS_BAR`, 0.06) and `record`.
- **The record** (`model_history/nhl_shots/<month>.json`, committed by the deploy's "Save GMG
  model record" step): each finished game is written once, with every player who had a main line
  and played: `[id, name, team, line, over, under, projection, chance of the over, real shots,
  season average, line move, first line, first over, first under]`, all as locked before puck drop
  (the last three, since 2026-10-14: the first main line and prices the site saw, carried on each
  board row as `first_sog` from the live shots.json; older rows don't have them), and since
  2026-10-16 a 15th column, **`factors`** (`SHOTS_FACTORS`, `shot_factors`; the file's `cols` and
  `factors` name them): position, games, season average, `vs_avg` (tonight's number minus it),
  minutes, PP share, tonight's slot and line move, home, `rest` / `opp_rest` (days; now on every
  board row too), his share from each rink area (`s_*`) and each matchup piece's lift (`l_*`).
  See "Learning which factors win".
  - **Closing line value** (`record.clv`, the owner: "start saving the price on shots too"): on the
    plays with an edge, the play's price moved from first seen to locked, in points of chance, when
    the line didn't move (`points` = average over `priced`); a moved line counts by direction (an
    over whose line went up = shortened). `shortened` / `drifted` / `plays`. A tile in the YTD popup, labeled **Early Price Move** and worded as context only (the owner, 2026-10-23): the prop pages are a BOTTOM UP model for members betting in the last hour or two, judged by wins and units on the model's own number at the puck-drop price; the first look is usually before lineups, so morning CLV is not the test (and plays picked at the lock lean toward prices that drifted). `shots_record_summary` grades the
  better side of each line (`shots_play`, whose `size` is how the page files it) into `play` /
  `none` (every saved game by today's bar, the ones before it too); for the plays it
  also splits `over` / `under` and **`fade` / `with`**: plays against the player's own season
  average (an under on a line he averages more than, or the reverse) next to plays with it.
  Wins, losses, units won risking 1 a play.
  - **The plays themselves** (the user, 2026-10-13: "a way to see plays that declared any edge and
    have a record of it. possibly grouped into buckets"): `record.days` = every day's tally of
    the plays, and `record.plays` = each graded play on the latest `SHOTS_RECORD_DAYS` (14) days that have any:
    side, line, locked price, edge, projection, real shots, won, units, `fade`. The buckets cover
    the whole season; the list is capped so shots.json doesn't grow by a megabyte by spring.
  - On the page: the **"YTD Model Performance"** button beside the Shots on Goal title opens the
    record in a popup (`#shots-record-modal`; the user's wording and placement, 2026-10-13; it
    sat at the bottom of the page first and they couldn't find it). In it, the tiles, then
    (`recordPlays` in shots.js) "Graded plays", newest day
    first, each day headed by its own W-L and units, with bucket buttons **Every edge** (how it
    opens) / **Overs** / **Unders** and the shown bucket's total beside them. Tiles: Plays, Not plays,
    Overs, Unders, Against / With his average, Closing line value.
    Nothing is typed in by hand: each build adds the games that finished since the last one.
  - **Started games stay on the list, grayed, under the plays still to come** (the user, later
    the same evening, with a game under way and its players still ranked as plays: "keep all the
    plays of the day on the shots list but have them grayed out if they are live kinda like the
    king of the crease is doing ... then have a toggle once games start at the top that
    differentiates and sorts from live and not"). `gameState` in shots.js: "open" / "live" /
    "final", from the build's `locked` AND the clock against `start_utc` (a build can be hours
    old at puck drop). Order is always open, live, final, whatever the sort; live rows are grayed
    (`.shots-live`) under a "Live now" heading; a day with both kinds gets the buttons **All
    games** (how it opens) / **Not started** / **Live / final**. A finished day is not grayed. The lock is the last build before puck drop (since 2026-10-15 usually the half-hourly refresh
  within the half hour before it), not the closing line.

## Pages

- **Save to My Plays (2026-10-20):** every priced play on Shots, Goals, Points, Saves and Best Plays
  has a small box (`nhlPlayBox` in nhl-common.js; a new prop page adds it to its Play cell).
  The plays, their grading and the page: plays-and-promos.md, "My Plays".
- **The top bar (the owner, 2026-10-17): NFL, NBA, NHL, Promo Tools on every page of every sport**
  (it was Games / Player Props / Promo Tools on 2026-10-15). Each is a button that opens a list of
  its pages (`SPORT_PAGES` in sync.js, built by `addTopMenu`). The NHL's list is Game Previews, Line Matchups, then
  a "Player props" heading over Best Plays, Shots, Goals, Points, Saves (`PROPS`). A new NHL
  tool is one line in `PROPS`. No "More tools coming" on any page. Tests check every NHL page's bar
  (`test_header_site.py` the behavior).
- **Player search** (the owner, 2026-10-16: "if i start typing in GEE it will only show names of players
  with that"): a box in the Player header of Shots, Goals, Points, Saves and Best Plays. Case and accents don't matter (`nameSearchBox`,
  `nameMatches`, `NAME_SEARCH` in nhl-common.js; each page filters in its own sorted rows). A search
  that matches nobody keeps the table and the box with a "No players match" line. A new prop table:
  `search: true` on its Player column and `nameMatches` in its filter. Test: `tests/test_nhl_search_site.py`.
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
  - Clicking a zone there (the user, 2026-10-19: "lists which opposing players shoot most from
    that zone") opens the every-team list with that offense's shooters above it
    (`zoneShooters` in nhl-common.js, `who: true` in the zone's `leagueAttr`): up to 8 players,
    shots a game from the zone (on goal or wide, from `players/<TEAM>.json`), share of his shots,
    on goal, goals, games; players Out / IR left off, 3+ games, ties share a color. A name opens
    the card in place of the list. Test: `test_a_zone_lists_its_shooters`.
  - A player's rink does the same with HIS team (the user, 2026-10-19: "if calling for an
    over/under, a user can see how they stack up vs team"): the Shots and Goals rows' rinks and
    the card's Shot Map (zones and the "allows" column) pass `who: <his team>, me: <his id>`;
    his row is outlined, and below the top 8 he is added under "Nth on TEAM from here". The
    goalie map has no list. Tests: `test_a_zone_lists_his_teams_shooters` (Shots),
    `test_the_cards_shot_map_lists_his_teams_shooters`, the Goals breakdown test.
- **A number shown as a player's stat is his REAL count, never mixed with an average** (the
  owner, 2026-10-19: "The % should never be mixed with a model guess. The data is the data -
  small sample or not"). The models still mix averages into their projections (`area_pad`,
  `pp_pad`, `pad_minutes`...), but the pages take what they show as his from `seasonCounts`
  (nhl-common.js: his team's players file, the card's counts): the Shots / Goals rink shares
  (hover says "12 of 17"), the power-play share, attempts per 60 and on-goal share. A model
  number is labeled as the model's ("Model's usual xG"). Never show `shares`, `pp_share`,
  `thru` or `att60` from shots.json / goals.json as his. **The projections keep the mixing**
  (the owner, 2026-10-19, after a raw-vs-mixed replay of all four models): raw data was clearly
  worse under about 10 games and equal after (Goals' chance score 0.36 mixed vs 0.68 raw at 1-5
  games; on this season's prices raw would have gone -51.5u on Goals, -21.4u on Points).
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
    `thin` tags and the ladders as "N or more" chips. A goalie's only line is Saves. Since
    2026-10-21 (the owner: "NHL is lacking checkboxes") each side shows the best price across the
    member's books (`bookPricePill`, SmartStake) or Novig's when no book lists it, with an
    `nhlPlayBox` beside it (anytime goal, shots, points, assists = market `ast`, saves; first goal
    has no box, nothing grades it). Every NHL page loads `../book-odds.js` for this.
  - A team whose file can't be read still opens the card (season tiles and odds only).
- `site/nhl/shots.html` + `shots.js` = **Shots** (under Player Props in the nav): one
  table for the day's slate, a row per skater, ranked best edge first.
  - **Edge = the model's chance minus the chance the price needs to break even**, for the better
    side of his main Novig line ("Best side"; Overs / Unders show one side for everyone). The page
    does no shot math: it reads `chances` and compares them with prices. `pickSide` must agree
    with the build's `shots_play` (a test checks every row), since the record is graded by it.
  - **It opens on the plays only** (`isPlay`: the build's bar, see "The Shots bar"), green, Rating
    "Play". **Plays only / Every line** (`shotsView.every`) lists everyone with a line: the plays
    first, then the rest under "Not plays", best edge first. A row over the bar on a player moved
    down a line says **"Lower line"** (left out). **Before a game's lineup is posted** nobody can
    have moved, so its plays are listed on the assumption he stays on his usual line, tagged
    **"Play: no lineup yet"** (dashed, `pendingLineup`; the owner, 2026-10-19: "post them with the
    assumption, but tag it as such"); once the lineup is in each stays a plain Play or drops off.
    Every graded play through 10-18 had its lineup posted by puck drop. Best Plays says the same
    with its "No lineup" note. No "check" group, nothing amber. A day with no
    plays says so and offers "Show every line". The every-book tags use the same bar (`bookEdges`:
    PLAY from 6, never on a player moved down, no CHECK).
  - **Toolbar:** Side, Skaters and Lineups are dropdowns (`.shots-filter-select`, the owner: "to
    reduce the clutter"), then Plays only / Every line. "How the number is made" sits at the top
    of the Shots panel, under the schedule strip.
  - **Line column:** L1-L4 / D1-D3 from the projected lineup, an arrow when it is above or below
    the line his minutes say he has been on, "--" until the lineup is posted. A note above the
    table says how many of the day's games have lineups, and each game in the strip is marked
    "Lineup" (with a check mark) or "No lineup yet" (`board.posted`). The breakdown shows the line as its own
    piece ("L1 tonight +13%"), his linemates, and who is injured or scratched.
  - Columns: Line, the play (**"o1.5" / "u2.5"** chip with Novig's price), **Rating** (Play, or
    Lower line when left out over the bar, plus "vs his avg" on a play), Avg (his season
    average) next to Proj, Fair price (the model's chance in its hover), Edge. Then the
    **advanced stats**, folded away until "Expand advanced stats" (see "Trimmed tables" below):
    Min (arrow = a minute off his season average) and what moved the number: Opp, Pos, Spots, PP,
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
- `site/nhl/promo-tools.html` + `promo-tools.js` = **Promo Tools: King of the Crease**, and `icebreaker.js` = its **Icebreaker** tab (both below).
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
  Winners list beside it and an About box. The record tiles were removed 2026-10-14 (the owner:
  the Winners list "is all we need here"); `record` stays in crease.json for the record. The page does no math. Matchup columns are on the eight rank
  colors by league rank; the Novig line, saves a start and Tonight's by rank within the day.
  - The user's edits the same evening: no Upside chip ("clutter and already displayed in the
    chart"; the tag stays in the data for the record, Value keeps its chip), a narrower name
    column, the line without the over's price, the line and saves a start color coded "best to
    worst", and no Top 10 cut ("show the whole slate on the export photo").
- **Winners** (2026-10-14, `renderWinners` in promo-tools.js; the owner asked for "a sort of
  leaderboard history that shows who won, what his pregame rank was, upside etc." off to the
  right). One collapsible line per finished day, newest first and only the newest open: date,
  winner (ties: both), saves, his pregame place ("13th of 32" = his place by `top`) and what he
  paid. Open: starters, pool, about how many were on him (pool / payout), and **If they'd won**:
  each goalie DraftKings showed a payout for, most saves first, with Sv, Pre, Upside, Paid and
  **Worth** = `top` x paid (colored best to worst within the day); then our favorite and the most
  picked. Beside the table when there is room (`.crease-main`, flex-wrap), under it when not;
  **never in the saved image** (outside `#crease-capture`). No summary tiles (the owner removed
  them from the mockup).
  - Days: crease.json `history` (`crease_history`: every recorded day from
    `model_history/nhl_crease`, `CREASE_HISTORY_COLS`, best chance first).
  - **Payouts are typed in by the owner after each contest**: DraftKings shows only a few
    goalies' "what he paid / would have paid" (the pool is split evenly among everyone on the
    winner, whatever they bet). A box under the list, shown only with `html.is-owner` (and on
    localhost): pick the day, the pool ($500,000 by default), paste DraftKings' text as it comes
    ("🥅 Name - $2,748 in Bonus Bets"), Save. Names match the day's starters with accents dropped,
    else a last name only one starter has; any name it can't match blocks the save. Stored in D1
    `crease_payouts` through `/api/crease-payouts` (members-and-hosting.md).
  - Next, once a couple of weeks are logged: learn what drives picks (names, short lines,
    favorites) and estimate each goalie's payout before puck drop, so Value can become an
    expected payout. Label it an estimate and grade it like the rest.
- **Save image** is the priority (the user: "a clean and crisp image to twitter"): the table
  with a GMG title bar and a key, at 2x. **Logos on this page are ESPN's** (`shareLogo`):
  assets.nhle.com sends no cross-origin header, so html-to-image can't carry the NHL's own files.
  No headshots for the same reason. The image is always the whole slate.

## Icebreaker (Promo Tools; built 2026-10-15)

DraftKings' promo: everyone with a qualifying **first goal scorer** bet (the owner's was $10; it
varies) on the player who scores the **quickest goal of the 7:00 PM ET slate** splits $250K. Quickest
by GAME clock: 0:10 into a 7:08 puck drop beats 0:15 into a 7:02 one. The owner's worry: "it feels
awfully random ... like finding a needle in a haystack", with two ways in: team first (fast starts,
a bad opponent) and players only (one player's matchup).

- **The replay came first** (`python tools/backtest/nhl_icebreaker.py`, 2024-25 and 2025-26, about
  290 nights with a 7:00 slate; findings in its header). The owner's ideas, tested: time of the first
  goal for / against, fast / slow starts (goals in the first 10 minutes, 1st-period goals), early
  shots, line 1 vs line 2, the first shift. **None of the team "fast start" numbers beat a team's
  plain goals for / against**, early shots were no better than a blind guess at the player level,
  and the opening shift was a coin flip (35% of winners were on it; 40% of opening forwards started
  the next game too). **What picks the early scorer is his scoring rate x his ice time.** On 4-6
  game slates the quickest goal came by about 2:00 of the 1st most nights; no ties in two seasons;
  defensemen 10-15% of winners, about 20% not five a side. Our kind of ranking had the winner in its
  top 10 on 11-22% of slates (ten random picks: 6%); the favorite is about 2%.
- **The number** (`icebreaker_board` in build_nhl.py -> `site/nhl/icebreaker.json`, untracked): with a
  steady scoring rate, a player's chance to score the slate's first goal is his expected goals tonight
  over everyone's. `rate` = the Goals page's `mean` (goals.json, so lineups, matchup, goalie, home, rest
  are all in), moved toward his Novig anytime price (`mkt_mean` = -ln(1 - chance)) the King of the
  Crease way: market + `0.5 x min(1, games / 20)` of the way to the model (`ICEBREAKER_RULES`; the
  fewer of the two teams' games). No price = the model alone. Players ESPN lists as out are left off.
- **The page does one division** (`icebreaker.js`): his rate over everyone's in the games the member
  picked; a team's chance = its players' added up (so the two views always agree); "Of team" = his
  share of his team's. It has to follow the member's game picks, so it can't come from the build.
- **The slate is picked on the page** (the owner: usually a select group of early games, and "it
  changes"): Day arrows, then **Start time** chips grouping the day's games by puck drop (opens on
  7:00 PM ET, else the day's first), then **Games** chips to add or remove any one game.
- **Fast starts, this season** (the owner's label; `fast_starts`, from `reduce_game`'s `first_goal`,
  `first_goals` and the teams' `sog_early`): games it scored first, the time of its own first goal in
  its middle game ("1st 7:14", "none" = scoreless in more than half), shots on goal a game in the
  first 5 minutes, and what tonight's opponent allows there. **Shown, never counted** (the replay);
  colored on the eight colors by place among the picked teams.
- Layout: Teams table (Chance, the top three as "Best bets", Fast starts) beside the Players table
  (Line, Chance, "1 In", Of Team, then **First 10 Minutes · This Season**: GIFT = goals in the first
  10 minutes / games, SOG a game, TOI a game, then **DraftKings' first goal price**), the top 15
  until "Show all"; clicking a team shows only its players. The Winners list beside them, never in
  the saved image.
  - The first-10 columns (the owner, 2026-10-22, replacing G/GP, xG and Min) are icebreaker.json
    `first10` (`first_ten`: `[games, goals, SOG, charted games, seconds]`, from `reduce_game`'s
    per-skater `g10` / `sog10` / `toi10`, the 1st period before 10:00). TOI averages only games
    with a shift chart (the league has none for games 6-52). Shown, never in the chances: the replay
    found early-game numbers predict nothing beyond scoring rate x ice time.
  - **Every Players column sorts on a click** (again to flip; `ICE_SORT`, `iceView.sort`), the
    top-15 cut follows the sort, and a player with nothing in that column sinks. Its headers carry
    `data-ice-sort`, which promo-tools.js's King of the Crease sort skips. Save image like King of the Crease (ESPN logos).
- **First goal prices: SmartStake** (`smartstake.add_first_goal`): the market's key isn't in their
  docs, so each build reads `/v1/markets?league=nhl` (`fetch_markets`) and takes player markets
  named for the first goal, not a team's, a period's or the last (`first_goal_market_keys`). Yes is
  kept as "o", No dropped; stored as data.json `book_odds[...].props.first_goal`, its own try (a
  failure never costs the shots / goals prices). The row's `fg` is DraftKings' price and nothing
  else (the owner: "other books don't matter, its only dk or bust"); the page's DraftKings column
  shows only when some player in the picked games has one. `version.json` `nhl.first_goal` = players
  priced (or the note naming SmartStake's nearest markets).
- **SmartStake has no NHL first goal scorer market** (the first deploy listed its 43 NHL markets:
  totals, puck lines, period and player goals / shots, none for the first goal). The owner asked
  about scraping DraftKings: no (their terms forbid it; the MoneyPuck rule). SGO (one event,
  2026-10-15): FanDuel priced all of its first goal scorers, Bovada / BetMGM / ESPN Bet / Caesars
  some, DraftKings none, so that check was taken out again. The owner is asking SmartStake to add
  NHL first goal scorer; when it comes, check `first_goal_market_keys` finds it.
- **Historical Data** button beside the title: the replay's findings in a popup (`#ice-history-modal`,
  the owner's ask: "so users can get some background stats"). Its numbers are typed into
  promo-tools.html: change them with the replay. Reworded to the owner's edits the same day: no lead line,
  tiles "best pick scores first about 1 night in 50" / top 10 / top 20, columns "Typical night" /
  "Slow night" with a note saying what each means, and "This promo is mostly luck ... GMG's advice: have fun."
- **Lock and record:** a started game keeps the last build's rows (none saved = no rows). Once every
  7:00 PM game of a day is final, the day is written once to `model_history/nhl_icebreaker/<month>.json`
  (every player's locked rate, mean, mkt_mean, DraftKings price, and the winners: the quickest first
  goal, ties included). `icebreaker_history` -> the Winners list: day, who broke the ice, when, his
  place before puck drop ("12th/170"), his chance, his DraftKings price; our top pick in the hover.
- Reached as `promo-tools.html#icebreaker` (the Promo Tools menu's "Icebreaker" item; `showPromo` in
  promo-tools.js switches the tabs and the address).
- Tests: `tests/test_nhl_icebreaker.py` (first goals from the saved game, fast starts, the blend,
  prices, lock, record, history, SmartStake's market names) and `tests/test_nhl_icebreaker_site.py`
  (the page on `tests/fixtures/nhl_icebreaker.json.gz`). `check_site.py` opens it by its address.
- Not built yet: a payout estimate (the pool is split among everyone on the winner, so popular
  stars pay less: King of the Crease's Value idea), once a few contests' payouts are known.

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
  reader's lone-name fixes, the board, lock, record and Winners history) and
  `tests/test_nhl_crease_site.py` (the Promo Tools page in a browser on `nhl_crease.json.gz`,
  the Winners list on a hand-made history, reading DraftKings' pasted list).
  `tests/test_ci_crease_payouts.py`: the payouts endpoint in the login middleware.
- `tools/fetch_live_data.py` also downloads the live player files, `shots.json` and `crease.json`, so the
  after-deploy site check sees the pages as members do.
- `tools/check_site.py` opens both NHL pages; like the NBA page they can never block the deploy gate.
- `https://nfl.gmgsports.org/version.json` shows whether the NHL build worked: `nhl.built`,
  `games` / `wanted`, `downloaded`, `lines`, `player_odds`, `shots` (games with projections),
  `lineups` (games whose projected lineup was read), `icebreaker` (days on its board), `first_goal`
  (players with a SmartStake first goal price, or why not), or
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

### Step 2: the model and goals.json (built 2026-10-14)

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
  (`error`), so putting the live NHL copy back (`--need nhl`) never trips on it.
- **The record** (`model_history/nhl_goals/<month>.json`, committed with the others): each
  finished game once, every projected player who played (priced or not), `GOALS_RECORD_COLS`, plus
  the game's locked total and moneylines (`market`, to test the market as an anchor later).
  Since 2026-10-16 a priced player's row ends with **`factors`** (`GOALS_FACTORS`, `goal_factors`;
  None for an unpriced one; older rows have 11 columns): position, games, goals, xG, `vs_avg`
  (tonight's expected goals minus his goals a game), minutes, EV / PP minutes, slot, line move,
  home, rest days, the Zone Match area, `s_*` shares and each piece's lift (`l_*`).
  `goals_record_summary`: buckets strong / lean / none / check, `zone`, `thin` (units at the locked
  Yes price); `clv` (called plays: average move in points of chance from the first price to the
  locked one, + = shortened, and how many shortened / drifted); `honest` (said vs scored, everyone);
  `zone_all`; `days` / `plays` like Shots.

### Step 3: the Goals page (`site/nhl/goals.html` + `goals.js`, built 2026-10-14)

The owner approved a mockup of one row and its breakdown ("looks great. push it"), built in the
real Shots page from real numbers. The page REUSES the Shots page's layout, ids and classes
(`#shots-app`, `.shots-*`); its own styles are `.goals-*` in nhl.css. Under Player Props after Shots
on every NHL page (a test checks).
- **No goal math on the page:** chance, fair price, edge and bucket all come from goals.json; the
  edge cell is colored by the build's `size`, never the rounded edge (an edge of 2.996 rounds to
  3.0 but is "none" to the record). It also loads shots.json for the rink's defense boxes and
  tonight's linemates.
- Columns: #, Player, Line, Anytime (Novig's price alone in a green chip; **"No odds"** outlined
  chip when Novig hasn't priced him: the owner asked "no line as in odds or as in lineup?", so it
  says odds), **Rating** (the build's `size`: Strong / Lean / Check / New line), **Zone** (the blue
  Zone Match chip, "LOW SLOT" / "SLOT"), G (/gp), xG, Fair (chance in its hover), Edge; then the
  advanced stats, folded away: Min, Opp, Goalie, Finish, EV/PP, **Style** (net-front trim x off
  wing; the owner: "Keep style"), Home/rest. Result column once a game is final (W/L only for a priced player).
- **Ranking:** check first (amber), then priced plays by edge, then **"No odds yet"** players by
  their chance (the owner: "do it as shown"; prices and lineups fill in through the day with the
  half-hourly refresh). Filters: Skaters, Lineups, **Odds** (priced or not / priced only), **Zone Match**
  (everyone / only), the Check plays switch, and the live / final buttons, as on Shots.
- **The Zone Match tag is blue, never green** (tracked; no edge in the replay). A tagged
  player's breakdown has a blue note above the rink: his share, his position's, what the defense
  allows there and its rank, "Tracked in the record; not in the number."
- Breakdown: season G and xG -> his usual xG -> each piece -> tonight's xG and chance; the
  defense's tiles (xG allowed with Leaky / Stingy / Average, low-slot and slot shots allowed, the
  expected goalie labeled "projection"); the price table (anytime and 2+, model, fair, Novig,
  **First seen**, edge); the Shots page's rink.
- **YTD Model Performance** popup: tiles by bucket, Zone Match priced, thin, **Closing line value**
  (average points, shortened / drifted); "Said vs scored" for every graded player and the tag; the
  graded plays with bucket buttons (Every edge, Strong, Lean, Check first, Zone Match).
- Tests: `tests/test_nhl_goals_site.py` on `tests/fixtures/nhl_goals.json.gz` (built from the same
  games as the data sample: as of 10/12 14:00 UTC, then 10/13 14:12 with that file as the live one).

## Points (1+ point): step 1, the replay (2026-10-16)

The owner: "moving to points ... built in a similar fashion as SOG/ATG with a backtest and then
a algorithm", under the Player Props menu and in Best Plays. Later: line / points stacks (3-4 leg
parlays of linemates' points), and every graded play saving the parts behind it so the weights can
be re-tuned from the record (Points from day one; Shots and Goals later).

- `python tools/backtest/nhl_points.py` (about 3 minutes; `--rows <folder>` keeps each season's
  rows to re-judge without replaying). 2024-25 and 2025-26, each walk-forward on its own games;
  the candidates and the bar are in the script's header, written before each run. Weights fitted on
  2024-25, judged on 2025-26 (log loss on "1+ point"); a piece stays only at 2+ standard errors on
  2024-25 with the same sign on 2025-26 alone. Every point counts (empty net, short-handed).
- A point in 35% of skater-games, 2+ in 9%; 0.46 points a game (0.17 goals, 0.29 assists).
- **The winner: the Goals model's expected goals as shipped + on-ice assists.** Assists = the
  expected goals his TEAMMATES make while he is on the ice (shift charts x the Goals model's
  table; 50 / 15 EV / PP minutes of an average skater with his ice time mixed in) x his share of
  their goals he assisted on (10 / 6 goals of his position's average mixed in), even strength and
  power play apart, x tonight's EV / PP minutes, x the matchup: the defense's expected goals
  allowed (1.54, the biggest), tonight's goalie (0.37), his line tonight (0.18), home, rest,
  plus "spread" (0.08: log of the assists number over its average; the chances were a touch
  bunched). Chance = 1 - e^-(goals + assists). 2025-26 log loss 0.59535; the bettor's points a
  game 0.60284; one flat chance 0.64860. Honest: "45-55%" got a point 51%, "55-65%" 62%.
  A re-scaling of the chance (logit x 1.09, the same both seasons) took it to 0.59505.
- Lost: plain points a minute (0.60125), the Goals model + plain assists (0.59776), on-ice points
  in one number (0.59669; 0.59623 with a blend toward his real points). His own team's strength
  failed the bar (the on-ice number already carries it).
- **Step 1b, both out** (the owner agreed to test them first): **tonight's linemates** (their EV
  points a minute against the linemates he has played with, from the projected-lineup story;
  read for 94% of skater-games, middle 80% 0.66x-1.36x): goals half z 1.7, assists half z 1.1,
  log loss 0.59530 against 0.59535. Right direction both seasons, too small to count: a line move
  is mostly carried by the minutes (`line`). **A second assist counted as half**: z 0.6. Tonight's
  power-play unit can't be tested (see "Power-play units").
- Not testable: the price (no free history of points prices). The record grades it from launch.

### Step 2: the model, points.json and the record (built 2026-10-16)

- **`nfl_tool/nhl/points_model.py`** (standard library), exactly the replayed winner on top of the
  shipped Goals model: `PointsModel(goals)`, fed every game AFTER the Goals model (its table
  scores the shots). `tools/backtest/nhl_points_check.py` replays both seasons THROUGH this file
  (held out: 0.59527, re-scaled 0.59496, matching the replay) and fits `WEIGHTS`, `SPREAD_MEAN`
  and `CALIBRATION` on both seasons together; rerun it after any change.
  - Assists numbers come only from games with a shift chart (this season's games 6-52 have none):
    a game without one adds his minutes and points but no on-ice numbers or assists to the share.
  - `chance_at_least`: 1+ point re-scaled on the logit (`CALIBRATION` 0.036 + 1.086 x); 2+ and up
    a plain count. `chance_over(mean, line)`.
  - **`mates`: tonight's projected linemates against the ones he has played with** (`with`: who
    shared his line or pair, recent games counting more), both read by their EV points a minute
    today, so the same line is 1.0. **Tracked, never in the number** (it failed the bar; the record
    keeps it so the live season can say). `linemates(pid)` = who he plays with: for stacks later.
- `reduce_game` now keeps `goal_events` (`game_goals`: team, `pp`, scorer, assists, `on`) and each
  shot's `on` (the shooting team's players on the ice, goalie included), from the kept shift chart
  (`on_ice_finder`: a shift counts from just after it starts to the moment it ends, so a goal
  belongs to the players it ended the shift for). None without a chart.
- **`site/nhl/points.json`** (not tracked; on fetch_live_data's list; `version.json` `nhl.points`
  = games with projections): `games` = the Goals page's games, players and lock (`points_board`),
  every skater priced or not: season `games` / `goals` / `assists` / `points` / `avg` (points a
  game), `g_mean` (the Goals page's number), `a_mean`, `mean`, `chance` (1+), `two` (2+), `fair`,
  `lift` (the assists pieces) and `g_lift` (the goals pieces), `mates`; Novig's points `line` /
  `over` / `under` / `thin`, `first` (the first line and prices the site saw, carried from the live
  points.json), `chance_over` (rounded, what everything grades), and the Shots page's better side
  (`points_play`: "play" / "none" / "unsure", see "The Points bar"): `side`, `price`, `edge`, `size`, `fade`. A
  finished game's rows get `actual` (goals + assists). Also `weights`, `calibration`, `edges`, `bar`,
  `factors`, `record`. Main builds the Goals model once and hands it to both pages (`goals_file`'s
  `model`); a failed Points step writes a points.json with `error`.
- **The record** (`model_history/nhl_points/<month>.json`): each finished game once, every
  projected player who played, `POINTS_RECORD_COLS`; a priced player's row ends with **`factors`**
  (`POINTS_FACTORS`: position, games, avg, g_mean / a_mean, EV / PP minutes, tonight's slot and line
  move, `mates`, home, and each piece's lift on assists `a_*` and goals `g_*`). That is the
  owner's "learning which factors win": group graded plays by any factor once there are enough.
  `points_record_summary`: the Shots record's buckets, over / under, fade / with, CLV, `days`,
  `plays`, `ledger`, plus `honest` (1+ said vs got, everyone).
- Tests: `tests/test_nhl_points.py` (the saved game with its shift chart,
  `tests/fixtures/nhl_game_shifts.json.gz`).

### The Points bar (2026-10-22)

The owner asked why Points was down (-32u on the first six nights' 370 graded plays). Strong +
Lean were +2.6u; the losses were **Check** (49-71, -34.9u; 42-57 of it plays against tonight's line
change), **the 1.5 lines** (8-20, -17.5u: `chance_at_least` for 2+ is a plain count, never tuned
on results) and **edges of 3-6** (92-102, -23.5u). On the priced 0.5 lines the market's own no-vig
price predicted a point better than the model (log loss 0.6348 vs 0.6446) on every one of the six
nights; z 1.3, so not proven, but one direction. The owner: "make a Points play 0.5 line only, edge
6+, never against tonight's line change."
- `points_play` (build_nhl.py): `shots_play` at `POINTS_EDGES`, then "play" only on the 0.5 line at
  `POINTS_BAR` (6 points) or more and not `against_move`; "unsure" from `UNSURE_EDGE`; else "none".
  No lean, no check. The board, the record (`play` / `none` / `unsure` + over / under / fade /
  with; `plays` and `ledger` hold only plays), Best Plays and the factor report all use it.
  Re-graded the same way, the season so far is 56-49, +6.6u (in sample: expect less).
- `POINTS_EDGES` still sizes the every-book price tags and the price table's green.
- Closing line value read about -2.4 points on all three records (Goals 145 drifted, 6
  shortened): best price at first look against best across more books at the lock, "drifted" by
  construction. Fixed the same day: see "Closing line value on Novig's prices".

### Step 3: the Points page (`site/nhl/points.html` + `points.js`, built 2026-10-16)

The owner approved a mockup of the table and one opened row on the day's real numbers ("Looks
good. Finish the Points page"). It REUSES the Goals page's layout, ids and classes (`#shots-app`,
`.shots-*`, `.goals-*`); under Player Props after Goals on every NHL page (`PROPS` in sync.js).
- **No points math on the page:** the play (side, line, price), its chance (`chance_over` or 1 -
  it), the edge and the bucket all come from points.json, so the page and the record can't
  disagree. It also loads goals.json (the defense's expected goals allowed) and shots.json
  (tonight's lines, injured, scratched).
- Columns: #, Player, Line, **Play** (the Shots page's chip: "o0.5 +127" green / "u0.5 -150" red;
  "No odds" when Novig has no points line), Rating (Play, plus "vs his avg"; over the bar but left
  out: "1.5 Line" / "New Line"; Model Unsure), **P** (points /gp, goals and assists in the hover), **Fair** (the fair price of the play's
  side; 1+ point when unpriced), Edge; advanced: Min, xG, xA, Opp, Goalie, **Linemates** (the
  tracked `mates`, a blue chip like Zone Match), Home/rest. Ranking, filters (Skaters, Lineups,
  Odds, live / final; no Check switch) and the Result column as on Goals. Ranked: Plays, Not Plays
  (every other priced line), Model Unsure, No odds.
- Breakdown: season G / A / P -> goals tonight (the Goals page's number) -> his usual assists ->
  line, defense, goalie, Scale (`spread`), home / rest -> tonight "G + A, chance"; the defense
  tiles; a price table for o0.5 / u0.5 / o1.5 / u1.5 (model, fair, Novig, first seen, edge); and
  **his line tonight** on the right: each linemate's points and chance tonight with his own play
  chip (a first look at stacks), with the Linemates chip. Before the lineup is posted it says
  when it fills in.
- YTD Model Performance: tiles Plays, Not Plays, Overs, Unders, Against his avg, closing line value;
  "Said vs got" (1+ point, everyone); graded plays with buttons Every Play / Overs / Unders.
- Tests: `tests/test_nhl_points_site.py` on `tests/fixtures/nhl_points.json.gz`, built by
  `tools/make_nhl_points_sample.py` from the same games and prices as the data sample (as of 10/12
  14:00 UTC, then 10/13 14:12 with that file as the live one, like the Goals sample). Rebuild it
  with that script after a change to what points.json holds.

## Line Matchups (`site/nhl/lines.html` + `lines.js`, built 2026-10-21; replaced Line Stacks)

The owner, after Line Stacks lost most nights: "Rather than making a tool that surfaces stacks and
plays - which are not performing anyway and are overwhelming - maybe we can create something that
just displays the lines for the night, the strong groups, the weak groups - more of a 'game
preview' style tool." A member who "knows puck" asked for likely line matchups, how each line
performs together, hot / cold streaks and past matchups. **A preview, never a pick sheet: no
prices, no projections, no record.** Under NHL right after Game Previews (not under Player props).
The owner approved a one-game mockup (FLA @ OTT) before the build.

- **The counting** (`nfl_tool/nhl/lines_model.py`, standard library): `game_units(raw)` from the
  kept shift chart (`reduce_game`'s `lines5`; None without one, like games 6-52 of this season).
  5-on-5 = exactly 3 F + 2 D + a goalie a side, read off the shifts each second (not the feed's
  `situationCode`). Per team: `team` and every trio (`F`) and pair (`D`) as `[secs, attempts for,
  against, goals for, against]` (attempts = goals, shots on goal, misses, blocked shots; OT counts
  only if it is 5-on-5, so it never does in the regular season), and `vs` = home trio against away
  trio seconds. A shift counts from just after it starts (`on_ice_finder`'s rule): a goal at the
  last second of a shift belongs to the line it ended.
- `LinesHistory` (this season's games only): `unit` (season + `l3` = last 3 games together; a game
  "together" = 60+ seconds), `usual` (no lineup posted: from the players in the team's latest game,
  `game_lines`' rule over its last 5 games; a team that dressed 11 F shows 3 lines), `deploy` (in
  the home team's home games, seconds by the other team's line rank x his line rank, ranks = that
  game's trios by 5-on-5 time, 0 = mixed groups), `meetings`. `likely_matchups`: for the other
  team's lines 1-4, the home line most often sent out against it, its share, and the mixed share.
- **`lines.json`** (`lines_file` in build_nhl.py; untracked; on fetch_live_data's list;
  `version.json` `nhl.line_matchups` = games): games through `SHOTS_DAYS_AHEAD`, each `{locked, posted,
  teams: {T: {source "posted" | "usual", games, team, lines, pairs}}, players: {id: [name, pos,
  headshot]}, matchups: {games, rows}, meetings: {games, rows: [home ids, away ids, secs]}}`. A
  posted lineup's groups in the story's order (an unknown name = a trio with no history: New
  Together). A started game keeps the last build's entry (locked); none saved = left off.
  `LINES_RULES` (sent as `rules`; the page's tags read them): Strong / Weak at 56% / 44% shot share
  with 20+ minutes together, else Small Sample (New Together at 0); Hot / Cold when the last 3 games
  (10+ minutes) are 5+ points of share from the season or +/-2 in goals, **Steady when the two
  disagree** (the first draft called a line Cold with its share rising: the card can't contradict
  itself).
- **The page:** one game at a time from the day strip ("Lineup" / "Usual Lines" on each card): the
  away team's tiles, a middle column (Likely Matchups with both lines' shot shares, Past Meetings,
  Team 5-on-5), the home team's. A tile: Line / Pair N + tag, three names (`playerClick`), Min · GP,
  Shot Share and Last 3 GP on the eight colors around 50% (`SHARE_STEPS`; shaded only past half the
  Strong minutes), Goals, Form. Under 1180px the middle column goes on top in three; phones one
  column, matchups first. The explanation is behind the "i".
- **What the first look showed (2026-10-21, ~6 games a team with a chart):** trios had 20-60
  minutes together, trio-vs-trio history only 2-8 minutes, and about a third of 5-on-5 time was
  mixed groups, so Likely Matchups is a lean and says so. It firms up as the season goes.
- Tests: `tests/test_nhl_line_matchups.py` (the counting on the saved game and a hand-made one, the
  history, the file) and `tests/test_nhl_line_matchups_site.py` (the page on `helpers.nhl_lines()`,
  built at test time from the saved FLA @ BUF game). `tests/test_nhl_lines.py` is the player card's
  Line column (`game_lines`), not this page.

## Line Stacks (built 2026-10-16, retired 2026-10-21)

Points parlays of linemates (2-4 legs, a GMG Score from a "shared goals" model; the replay is
`tools/backtest/nhl_stacks.py`, the model `nfl_tool/nhl/stacks_model.py`, both kept with
`tests/test_nhl_stacks.py` for the model). **Retired because it lost:** 4,154 stacks graded over
10/16-10/20, the Score 58+ band said 23% and hit 16%, 51-57 said 21% and hit 12%; with no way to know
how each book prices a same-game parlay, the Score couldn't be fixed (the owner). Gone: the page,
`stacks.json`, the Points page's "Best stacks" box, the build's board and record (`game_ice` /
`ice` too). Kept: `model_history/nhl_stacks/` (the record), the SGP price log endpoint and its D1
rows (members-and-hosting.md), and My Plays still grades members' saved stacks
(plays-and-promos.md).

## Saves (goalie saves over / under; built 2026-10-19)

The owner: "give the goalie saves model its own Saves page like Shots/Goals/Points". No new model
and no new replay: it is King of the Crease's saves model (above), read as a prop.
- **`saves_file` -> `site/nhl/saves.json`** (not tracked; on fetch_live_data's list; `version.json`
  `nhl.saves` = games with a saves line). Built FROM crease.json's board (`saves_board`), so the
  goalies, the starter call (`source`, never "confirmed"), the projection and the lock are King of
  the Crease's. A failed Crease step writes a saves.json with `error`.
  - Row (`saves_row`): the crease row without its promo numbers (`CREASE_ONLY_KEYS`), plus
    `chance_over` (the model's `mean` at Novig's main line, rounded once), `alts` with the model's
    chance at each, `fair`, `gap` (model minus what the line and price say, `mkt_mean`), `first`
    (carried from the live saves.json while the row names the same goalie), and the play
    (`saves_play`: `shots_play` at `SAVES_EDGES` 3 / 6 / 12 points, plus **check** when the model is
    `CREASE_RULES["check"]` = 4+ saves from `mkt_mean`). `void` = someone else started.
  - **The raw model, not King of the Crease's `blend`**: the promo leans on the line; a prop edge can't.
- **The record** (`model_history/nhl_saves/<month>.json`, `SAVES_RECORD_COLS`, `factors` =
  `SAVES_FACTORS`): every starter with a main line, written once per finished game. **A goalie who
  didn't start is left out** (books void it). `saves_record_summary`: the Points record's buckets,
  overs / unders, fade / with (his saves a start), CLV, ledger, and `honest` (the chance of the
  over said vs how often he went over).
- **Before launch, on King of the Crease's record (10/13-10/18, 92 priced starters): the model ran
  about 1 save BELOW what happened (the line: 0.2 above), and about 1.2 saves under the lines**, so
  early on most plays are unders. Told the owner; the record will say whether it lasts.
- **The page** (`saves.html` + `saves.js`; reuses `.shots-*` / `.goals-*`, its own `.saves-*` in
  nhl.css): #, Goalie (search), **Starter** (green "agree" = lineup and book name him; amber = they
  differ or he started last night; gray = one source), Play, Rating, Avg (saves a start), **Proj**
  (green / red a save above / below the line), Fair, Edge; advanced: Shots, Opp shots, His D, Save
  rate, Home/rest. Filters: Starters (all / lineup + book agree), Edge, Odds, Check plays, live /
  final. Open row: league start -> each piece -> tonight; both sides' tiles on the eight rank colors
  (green = more work for him); main line both ways and the other lines with the model's price and
  first seen; "In net (expected)" with the gap note. Result column: saves + W/L, "Void" when someone
  else started. The open row has the every-book column (`stat` "saves").
- **Every book's saves price (2026-10-20, the owner: SmartStake has "Player Saves" on its odds
  screen).** `smartstake.saves_market_keys` finds the market in `/v1/markets` by name (never a
  guessed key: an unknown key in the odds call could cost every NHL price); `props.saves` like
  shots. `best_saves_prices` swaps each Novig saves line's over / under for the best US book price
  at the SAME line (`over_book` / `under_book` on the crease and saves rows, `nv_*` = Novig's) before
  King of the Crease reads it; the fair `chance` stays Novig's, so King of the Crease's numbers
  don't move. `version.json` `nhl.book_saves` = goalies a book prices (or why none).
- Tests: `tests/test_nhl_saves_page.py` (the build) and `tests/test_nhl_saves_site.py` (the page on
  `helpers.nhl_saves()`, built at test time from the King of the Crease sample).

## Model Unsure: the safety net (2026-10-22)

The owner, after Sanderson's u0.5 points (+47.3) showed on Best Plays: "if a play like this can
surface, then how can we trust that ANY of these plays are good?" An edge of `UNSURE_EDGE` (25
points) or more is filed **"unsure"** by `shots_play` / `goals_play` (so Shots, Points, Saves and
Goals alike), whatever else it is: the model is missing something, not the book 25 points off.
- Never a play: Shots' `isPlay` and Best Plays leave it out; Goals / Points / Saves list it under
  its own "Model Unsure" heading after the plays (dashed gray tag, `unsureTag` / `unsureHead` in
  nhl-common.js; no "vs his avg"). Each file sends `unsure` for the pages.
- The records grade it in its own `unsure` bucket, never in the plays, `days`, `plays` or
  `ledger`; the factor report skips it like "none". Records are regraded by today's rules, so
  Sanderson's two losses left the plays' record (told to the owner).
- When it was set, Sanderson's two were the only Shots / Points plays of the season past it (next:
  23.7); Goals had never passed 14; one Saves under (Wallstedt, 25.1, lost) also moved there.

## Closing line value on Novig's prices (2026-10-22)

The owner approved the plan after the audit above. Wins and units stay at the best price across
books (what a bettor gets); **CLV reads Novig alone** (an exchange: the cleanest single read of the
market), at the first look and at the lock.
- `clv_move`: on the same line, the play side's chance with the cut taken out (both sides priced at
  both looks; else that side's own price both times), lock minus first, + = the market moved to the
  model. A moved line counts by direction. `clv_tally` / `clv_add` / `clv_done`: `plays`, `priced`,
  `points` (average over `priced`), `shortened`, `drifted`, `since`, `book` "novig".
- Every board row carries `nv` (`novig_prices` / `novig_goal_prices`: the `nv_*` prices
  best_book_prices keeps, else the row's own) and `first_nv` (carried from the live file like
  `first`; Saves only for the same goalie). Crease rows carry `nv_over` / `nv_under` for this.
- Every record row ends with an `nv` column after `factors` (`CLV_COLS`: over / under
  `[first_line, first_over, first_under, over, under]`, goals `[first_yes, first_no, yes, no]`);
  each file's `nv` key names them. Rows before `BEST_PRICES_FROM` (2026-10-17) hold Novig's own
  prices and count as they are (goals Yes only); rows from it without `nv` are left out.
- One tile for all four pages: `clvTile` in nhl-common.js ("Closing Line Value", "since" date).
- Re-graded when it shipped: Shots -0.4 points (38 shortened, 36 drifted, 74 plays: about even, so
  the old -2.5 was mostly the measurement), Goals -1.4 (4 / 35, 43 plays: still leaning drifted),
  Points 2 plays, Saves none yet. Small samples; it fills from 10/23 on.
- Not the true close: the lock is the last refresh before puck drop (up to 30 minutes early).
- Tests: `tests/test_nhl_clv.py`.

## Learning which factors win: the factor report (2026-10-16)

The owner: bring Shots and Goals "up to the Points record's standard", then a report (a tool,
not a member page). **Groundwork only: no weight was changed.**
- All three records save the parts behind each graded play (`SHOTS_FACTORS`, `GOALS_FACTORS`,
  `POINTS_FACTORS`), as locked before puck drop.
- `python tools/nhl_factor_report.py` (`--market shots|goals|points`, `--every` adds the no-edge
  plays, `--since`, `--min`, `--json`) grades every play the pages' way (`shots_play` /
  `goals_play`; its totals match the record summaries) and groups them by each factor: plays,
  W-L, win %, the win % the prices needed, units, return a play. A lift (and `mates`, `vs_avg`)
  is grouped by whether it pushed toward the play's side, against it, or under 2%; labels by
  value; other numbers by thirds. **Groups under 100 plays are marked "early"**: tell the owner
  they can't be trusted yet. Old rows count where their own columns say enough (move, average, zone).
- Tests: `tests/test_nhl_factor_report.py` (hand-made records, and the real ones read cleanly).

## Best Plays (`site/nhl/best.html` + `best.js`, built 2026-10-15)

The owner: "I don't care about the noise, I am in a rush: what are my best overall bets
tonight." First under Player Props. A short list that sends people to the Shots and Goals
pages for the detail, not a copy of them.
- **Every play the Shots, Goals and Points pages call a play** (Shots: its bar, `shots.json` `bar`
  and not moved down a line; Points: the build's `size` "play"; Goals and Saves: `size` strong / lean / check), all
  three markets in one table, biggest edge first. The Shots play is the Shots page's best side
  (the build's `shots_play`, so the record grades the same play); the Goals play is goals.json's
  `edge`; the Points play is points.json's `side` / `price` / `edge` ("o0.5 points", "Points ›").
  A test checks all three against the build.
- **No cap and no "Check" group.** The owner turned down a top-10 / two-a-game cap: "if the model
  notices an edge, we shouldn't punish ourselves ... bettors have to make their own choice."
  Plays the other pages file as "check" are ranked like any other. Through 10/14 Shots' check
  bucket was 48-32 +8.4u, nearly all of it one night (within a standard error of break-even);
  the record will say whether that holds.
- **Every row says its own page's bucket** (a member, 2026-10-20: a player in Check first on the
  Goals page showed here as a plain play; the owner: "this can't happen"). A **Rating** column after
  Play: Shots and Points "Play", Goals / Saves Strong / Lean / Check / New line from the build's `size`
  (`bucketTag` in nhl-common.js, the ONE function the Goals and Points pages use too); a Check's
  edge is amber, as on its page. Goals and Points plays are picked by `size` (strong / lean / check),
  never by the saved edge: edges are saved rounded, so a 2.98 is "3.0" but "none" to the build.
  **Rating sorts** (Strong / Play, Lean, Check; flip it to put the Checks together).
- **Saves (2026-10-20, the owner: "yes")**: a fourth market switch, "Goalie saves". Its plays are
  saves.json's as the build files them (`size` strong / lean / check, a goalie the site knows, priced
  at the best price across books), "o26.5 saves" chips, `savesGapCheck` for its other Check (model and
  line 4+ saves apart), the Saves page's starter tag (`starterTag`, now in nhl-common.js) first in
  Notes, "N GS" under 5 starts, a "Goalie saves" tile with its own slider in the YTD popup (the saves
  record's `ledger`), and the row opens `saves.html#row=`.
- **Notes say what the model may not know yet**, never a verdict: "No lineup" (that market's
  board had no posted lineup), the line change ("L2 ▼", amber when the play goes against the
  move), "N GP" under 5 games, "vs avg" (Shots: against his season average), "Thin". Centered
  in their column (the owner).
- **Lineup banner** when an open game has no lineup: "Lineups are in for X of Y games. Plays
  marked No lineup can change when the NHL posts it." The page fills all day (lunch-break bets).
- Columns: #, Player, Play ("u1.5 shots" / "Scores goal"), **GMG Fair** (the owner's name: the
  model's chance as a no-cut price, the same number as the Shots / Goals pages' Fair; goals use
  goals.json `fair`), Odds, Edge, Notes, Puck drop, a
  "Shots ›" / "Goals ›" link. **Every column with a key sorts; Odds = the biggest payout first**
  (the owner's "return on $1"). No Win % (the owner: "unimportant and clutter"; the chance is in
  the Edge hover). Market switches (Shots on goal, Anytime goal, Points; at least one stays on).
- **A row opens its own row on the other page:** `shots.html#row=<game>:<player>` (or goals.html);
  `linkedRow` / `scrollToRow` in nhl-common.js pick the game, open the row and scroll to it.
- YTD Model Performance: strong + lean + check from each page's record, added up (shots, goals,
  points, all). No record of its own: with no cap, its list is exactly those buckets.
  - **Filterable** (2026-10-16, the owner: "How are SOG Best plays with a 10% edge doing in the
    last 15 days"): each record's `ledger` (`record_ledger` in build_nhl.py) is EVERY graded play
    of the season as `[date, edge, won, units]` (`plays` stays capped at 14 days with the detail).
    The popup is the shared tracker (styles.md, "YTD Model Performance"; Yesterday added
    2026-10-22): a Min Edge slider (3-20 points) in each market's tile, All Plays = every market at
    its own minimum. An edge counts as the table rounds it (9.96 = 10.0). Remembered per device
    (`nfl-tool.ytd.nhl-best.v1`). With no ledger (an old shots.json) the plain season tiles show.
    Since 2026-10-22 the Shots, Goals, Points and Saves popups are the same tracker (`nhlYtd`), and
    each ledger row carries its tags (side, bucket, fade / with, zone, thin) for their split tiles.
- **Filters and book (2026-10-17):** an Edge menu (3+ to 15+ points) and a Lineups menu (all / lineup confirmed) in the toolbar (`bestView.minEdge`, `lineup`); every price is the BEST price any US book quotes at Novig's line (see "Best book prices"); the Odds cell names the book (Novig keeps its logo) and opens every book; a **Good to** column = the worst price that still has the smallest (3-point) edge (`goodTo`).
- **Player cell (2026-10-18, the owner):** the rows are taller since the book name went under each
  price, so the cell's flex box sits INSIDE the td (`.best-player`, a flex td can't center
  vertically); photo 34px, logos 30px (every prop table's `.shots-vs` logos are 30px since 2026-10-29: members found 16-24px too small).
- Phone: the photo and position letter drop out of the Player cell so the play shows without
  scrolling (last phone block of nhl.css).
- Not built yet: **"Dropped since earlier"** (plays listed earlier in the day that fell off after
  a lineup or a price moved, with why). Needs the build to carry each play's first-seen edge
  from the live file, the way `first_odds` is carried.
- Tests: `tests/test_nhl_best_site.py`.

## Not built yet (waiting on the user's priorities)

Built: Shots, Goals (anytime goal, with expected goals), Points (1+ point), Saves (goalie saves), all above.
For Saves: Best Plays lists its plays (2026-10-20). Line Stacks was retired 2026-10-21 for Line Matchups (above). Next on the
owner's list: re-weighting from the factor report once its groups pass 100+ plays (the records and the report exist: "Learning which factors win"). For Goals: the market's team totals as an anchor once the record has them.
For King of the Crease: a payout estimate before puck drop from the logged payouts (see
Winners), and a lone skater's place on the Shots page's Lineup Confirmed view.
Also open: a Summary card, a game model, shot-by-shot dot maps, the EDGE
tracking stats, playoffs.
For the Shots model: tonight's power-play units from a licensed morning-report feed (past units
from `shiftcharts` were tested and add nothing: see "Power-play units" above); a snapshot of the closing line (the refresh now gets within half an hour of puck drop); the expected starting goalie on
Game Previews (it is already in `shots.json`).

## Best book prices (the owner, 2026-10-17)

"We should be tracking via the best price available -- bettors should be line shopping anyway."
`best_book_prices` (build_nhl.py, after SmartStake's `book_odds`) swaps each main-line price in
`player_odds` (shots, points and saves over / under, anytime goal; the Saves page's own lines: `best_saves_prices`) for the best price ANY US book quotes at
the SAME line when it beats Novig's; `over_book` / `under_book` / goal `book` name the book and
`nv_*` keeps Novig's. So every edge, play, CLV first price and graded record (Shots, Goals, Points,
Best Plays) is figured on that price. Chances stay the model's / Novig's fair chance. Build-wide: it
ignores a member's My Books (the page's price list still honors them). Locks like the book odds
(a started game keeps the last build's). **Records before 2026-10-17 were graded at Novig's price**,
so the record mixes the two; CLV for that day compares a Novig first price with a best-price lock.
No SmartStake run = Novig's price, as before. Pages say "best price across books" where they said
Novig. Test: `tests/test_nhl_best_prices.py`.
- **On the page, the member's books come first (the owner, 2026-10-23):** when the build's book is
  one the member turned off in My Books, Shots, Goals, Points, Saves and Best Plays show the best
  price among the member's own books at that line, and the edge on it (`memberPrice` /
  `buildBook` in nhl-common.js; none of theirs has it = the build's price). Which plays are listed
  and their buckets stay the build's (the record). No books off = the build's price, as before.
  A My Books change redraws the page. Test: `test_a_member_sees_the_best_price_on_their_own_books`.

## Every book's price in the Shots, Goals and Points rows (SmartStake, 2026-10-14)

- **Same filters and same open row on every prop page (2026-10-18, a member: "filter by above a
  score, if lineups are out"; the owner: some pages showed odds when opened, some didn't).** Shots,
  Goals, Points and Best Plays all have an **Edge** menu (`edgeOptions` / `edgeAtLeast` in
  nhl-common.js; "Any edge" by default off Best Plays) and a Lineups menu. The
  Points open row has the every-book column too (`stat` "points"). A new prop page gets both.

- `build_nhl.py` asks SmartStake for shots on goal and goals (`smartstake.fetch_nhl_book_odds`;
  key `SMARTSTAKE_API_KEY` on the NHL build step of deploy.yml AND nhl-refresh.yml) and writes
  nhl/data.json `book_odds["AWAY_HOME"].props.{sog,goals}[player id]`; players are matched with
  `player_finder` on either team, trying every spelling the books use. Rules as for the NFL
  (data-pipeline.md): US books, odds lock. Each book is tagged against OUR model at its
  own line (`bookPanelFor(x, stat, line, label, chanceAt, edges)`: shots `chanceOver`, goals
  `r.chance` / `twoPlus`), with the page's `edges`, so the panel's numbers match the Edge column.
- The open row (`detailRow` in shots.js / goals.js, `bookPanelFor` in nhl-common.js) is three
  columns: the build pills, tiles and price table in a 520px left column (the pills wrap there,
  the owner's ask), the rink in the middle, every book's price on the right (`.has-odds`). Under
  1360px wide the odds sit under the rink; on phones everything stacks. A row with no book
  prices keeps the two-column layout. Goals' tabs read Scores / No goal (the 0.5 line).
- **Trimmed tables (2026-10-15, the owner: "too much info right now thrown at users").** No Model %
  or (Goals) Proj column: "the odds show that / fair shows that". Every column is only as wide as
  its contents (`width: 1%` on each header) and an empty last column (`.shots-spacer`) takes the
  spare width, so folding columns away never stretches the rest. Each page's `COLUMNS` entry draws
  its own cell (`cell`); `adv: true` marks an advanced stat, shown only after **Expand advanced
  stats** (`advancedToggle`, `nhlAdvancedStats` in nhl-common.js: one per-device switch for both
  pages). The Rating column's tags are the YTD record's (`ratingTag`). Tests find columns by their
  header text, not position.

## Explanations behind an "i" (2026-10-14)

The owner: long explanations on screen look "yuck"; put them in a bubble people open themselves.
Every long `p.section-note` on the NHL pages is `hidden` with class `info-note`, opened by a
`button.info-i` (aria-controls = the note's id) beside its heading; the rink key in the open rows
too. The click handler is in sync.js (capture phase), the look in style.css, so any page can use
it. On Shots / Goals the "i" sits right after `#shots-title` (the pages rewrite that title).

## The player card's Line column (2026-10-14)

Each game log row shows the line he played on that night (L1-L4, D1-D3; `game_lines` in
build_nhl.py): from the league's shift chart, the forward with the most ice time plus the two he
shared the most ice with are a line, and so on; lines are numbered by their ice time (pairs for
defense). Shift charts are fetched once per finished game and kept on it (`fetch_shifts`,
`keep_shifts`); the league has none for games 6-52 of 2026-27, so those rows show "--" (an empty
chart is recorded once a game is `SHIFTS_GIVE_UP_DAYS` old so it isn't asked for every build).
The skater log's last column is `slot`. Date / Opp / Result are only as wide as they need.
