---
paths:
  - "nfl_tool/*.py"
  - "nfl_tool/novig_event_markets.graphql"
  - "nfl_tool/site/common.js"
---
# NFL data pipeline (`nfl_tool/build_stats.py` and friends)

Stories and example players behind these rules: `docs/history.md`, "Data pipeline".

`build_stats.py` reads nflverse play-by-play, rosters, injuries, snap counts, FTN charting and
schedules, plus odds from SmartStake (every US book) and Novig, and ESPN FPI, and writes
`nfl_tool/site/data.json` (untracked; built in CI). `gmg_model.py` and `line_grades.py` are
imported by it (rules in game-previews.md).

## Building locally

- `python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  A 404 is a transient nflverse error; re-run.
- The build only downloads a data file if it's missing (`download_if_missing`), so a local
  `data/` folder goes stale. Delete `data/*_2026*` and `data/games.csv` (and `data/ngs_*.csv.gz`)
  before a local build that needs the latest games. CI always starts fresh.
- Locally the previous-build read fails (401, no bot token), so locked lines, SmartStake's started
  games and the live model entries aren't available; that's expected.

## Odds: SmartStake leads, Novig adds; no SGO

- **SGO (SportsGameOdds) was removed 2026-10-23** (the owner: SmartStake "will always reign
  supreme"). It once put Jaleel McLaughlin at +154 (its "fair value" stand-in) on the TD Summary
  while FanDuel had +600. Never add it back. The All Odds list on Game Previews (SGO only) went
  with it.
- Anytime TD (`player_td_odds`): SmartStake's list (`book_td_odds`, team from the current roster;
  its best price and its own no-vig chance). Novig's own feed only for a team SmartStake has
  nothing on (`merge_td_odds`; the owner, 2026-10-26: "smartstake, not novig default"). A player
  only an exchange prices (`TD_EXCHANGES`: Novig, ProphetX, Kalshi, Polymarket) is left off.
- Who the odds leave off (`odds_unavailable_names`): Out / Doubtful / IR on his team's LATEST
  report up to this week, plus `roster_out`. Never an earlier week's (Barkley, Out Weeks 5-6, was
  missing from the Week 7 TD Summary).
- First TD and the player over/unders: Novig only (SmartStake has no First TD market). First TD
  rows are kept only for players on SmartStake's Anytime list for that team (`first_td_on_book_list`).
- Schedule spread / total / moneyline (top level): the line most US books post at the best price
  there (`apply_book_schedule_lines`), else nflverse's. `game.novig` is Novig's own (Pick Tracker).

- Novig's public game feed is `POST https://api.novig.us/v1/graphql`, operation
  `EventMarkets_Query`. The query text is saved verbatim in `nfl_tool/novig_event_markets.graphql`.
  - Novig only accepts its own site's exact query. If `novig_debug.error` shows up in data.json,
    recapture the request body from the browser network tab on any novig.com game page and
    overwrite the file.
  - Games come from `GET https://api.novig.us/v3/public/catalog/events?league=NFL`.
  - `is_consensus` marks the main line; `outcomes[].available` is the price (0–1).
- From Novig: player props, First TD, Anytime TD's chance, and game spread/total/moneyline (`game.novig`).
  Thin books are flagged `thin`. Prop over/unders need at least one side priced.
- **TD markets keep one-sided prices.** Most First TD markets, and about 40% of Anytime ones,
  have a Yes price but no No.
  - First TD chance = Yes ÷ the sum of every player's Yes in that game (never divided by less
    than 1).
  - Anytime chance = Yes/(Yes+No) when both sides trade. A one-sided one gets Yes × the game's
    median fair/Yes ratio.
  - Junk quotes are dropped: First TD Yes > 0.5, Anytime Yes > 0.95, or Yes+No > 1.5 (e.g.
    99.9¢/99.9¢ on a backup TE).
- The user promotes Novig (code **GMGO**: deposit $10 → $50 in trade credits; QR at
  `site/novig-qr.png`) and says Novig is fine with outside tools reading its feed.
- **Odds lock at kickoff** (`lock_started_game_odds`): a started game's odds come from the
  previous build instead of this run's fetch, but only when that build is known to be pregame (it
  had already locked the game, listed in `lines_locked`, or its `generated_at` is before kickoff).
  Covers schedule lines (top-level + `novig`) and both teams' TD and prop odds. With no trustworthy earlier copy it drops Novig's live copy and uses the spread/total the
  GMG model locked, then the schedule's closing line (and shows no moneyline until final).
- **One spelling per player in the odds** (`canonicalize_odds_names`, runs last): rewrites every
  TD / prop odds row to the site's own spelling (team game logs, then unique roster / headshot
  names). Books disagree on Jr./Sr./II and a row's book can change between builds.

## Every book's price: SmartStake (`nfl_tool/smartstake.py`, 2026-10-14)

- The owner is a SmartStake partner with their WRITTEN permission to show the odds to members
  (their API terms otherwise allow internal use only). Key: GitHub secret `SMARTSTAKE_API_KEY`,
  passed to the NFL build step. Docs: https://www.smartstake.app/api (needs `Accept-Encoding: gzip`).
- One league snapshot per build: `/v1/odds?league=nfl`, `alternate=false`, `live=false`, only the
  markets used, `state=NJ` (without a state the bet links are Ontario's; NJ links open fine in other
  states, so the site never mentions a state: the owner, 2026-10-15, members found the NJ note confusing). Unfiltered it is ~40,000
  quotes a game. Only `US_BOOKS` are kept (it also carries Canadian, offshore and pick'em apps).
- data.json `book_odds["AWAY_HOME"]` = props by stat id and normName, Anytime TD (`td`, the 0.5
  line only; there is no First TD market), game `lines` (ml / spread / total); each quote is
  `[book, side, line, odds, url]`. Players are grouped by the API's `player_id` (books spell names
  differently) and take the roster spelling. `book_odds_debug` says what came back.
- Odds lock: a started game keeps the previous build's pregame copy or shows no book prices.
  No key or a failed fetch = no book prices; the site falls back to Novig.
- The site (`book-odds.js`): **tags only against OUR model, never a market "fair" price** (the
  owner, 2026-10-14: "we aren't top down betting ... we are trying to find an edge from our own
  number"; a Pinnacle + Novig no-vig yardstick shipped first and was removed). A caller passes
  `spec.model` ({"side|line": the model's chance}) and `spec.edges`; the edge is the page's own
  measure (chance minus the price's break-even, in points: PLAY from `lean`, CHECK from `check`,
  else PASS). No model number = no tags: the NFL pop-ups (props, TDs, game lines) just rank the
  books. Book odds never feed the model math: `over_odds` / `under_odds` stay Novig's.
- Shared with the NHL build (`fetch_nhl_book_odds`, nhl.md): `smartstake.py` and `site/book-odds.js`
  are shared by both sports, and `/book-odds.js` is in the middleware's SHARED_FILES (the NHL
  pages load `../book-odds.js`), so book-odds.js carries its own helpers (no common.js there).
  Each build keeps only the games on its own schedule (`keep`): the board runs days ahead.
- `tools/smartstake_probe.py` (+ `smartstake-probe.yml`, runs when pushed) re-checks books and
  market keys; it commits counts and names only, never prices.

## Ratings and adjustments

- **ESPN FPI** (`espn_ratings`): offense/defense/FPI turned into 1–100 league-normed ratings, plus
  SOS rank. FPI is predictive; it includes preseason priors and QB changes.
- **Opponent adjustment:** `prop_matchup_model` gives what each defense allows and each offense
  produces by position, throw depth and play type, with ranks. `team_stats_adj` powers the Game
  Previews **Raw / vs Opponents** toggle. Early samples are shrunk toward league average.
- **Context weights (passing numbers):** games in rain, snow or 15+ mph wind count 30%; games
  against a backup QB count 30% toward the defense's numbers.
- **Game script:** each throw is flagged `gt` when win probability is under 10% or over 90%
  (`GARBAGE_WP`), with `s` for play success (used by the zone grades in player-props.md).
- `compute_koe` -> `DATA.koe` (King of the Endzone; plays-and-promos.md). `koe_week_boards` +
  `koe_game_results` -> `site/koe_weeks.json` (past weeks' boards, each game's longest TD).

## Lineup-aware player usage (important)

- Uses `player_snaps` plus injuries.
- A game a regular left early doesn't count.
- A fill-in game while a regular (healthy now) was out counts 15%.
- TD Data uses `lineupWeights` / `lineupAdjustedXtd` in common.js; Props uses `propBaselineGames`.
- **Never surface a backup off one fill-in game.**
- **Starting QB = `currentStarterQb(team, week)`** (common.js): whoever threw the most in the
  team's most recent game, unless ruled out this week (then the starter before). Used for the TD
  summary's QB Key Player chips and to order the Player Props QB cards. Returns null when every
  recent starter is out; callers then fall back to most attempts. (The GMG model uses a different
  rule for "the regular starter is out": `_regular_qb`, game-previews.md.)

## Injuries and roster status

- Injuries come from nflverse's injuries file, keyed by week. Teams file their first practice
  report Wednesday afternoon (Thursday-game teams earlier), so Mon-Wed the current week is empty;
  the panel then shows the team's most recent earlier report, labeled "No Week N report yet ...
  Showing the Week N-1 final report", instead of a blank.
- **Live source for the upcoming week:** `fetch_nflcom_injuries` reads the league's own page,
  `nfl.com/injuries/league/{season}/reg{week}`, and `merge_live_injuries` swaps in NFL.com's rows
  for every team that has filed for the current week. Past weeks stay on nflverse. If the fetch or
  parse fails, the build keeps nflverse and logs why. NFL.com codes AZ/LAR are mapped to ARI/LA. A
  rebuild (6-hour cron, or a manual run) is still what pulls a newly filed report onto
  the site.
- **Injury `snap_share` (who counts as a starter)** joins the report to the snap counts by name,
  forgiving spelling (`_snap_share_lookup`: exact, then without punctuation/suffix, then last
  name + first initial when only one teammate fits). "Pat Surtain II" vs "Patrick Surtain II"
  once hid him, Out, from the Summary card.
- **Roster status:** players on reserve/IR never appear on weekly injury reports.
  `compute_roster_out` reads each team's latest weekly roster `status` (RES = IR/reserve, RET,
  CUT, EXE) into data.json `roster_out`. `rosterOut()` (common.js) feeds `lineupOutOn`,
  `propInjuries` and `firstTdInjuryStatus`, so these players count as Out everywhere and their
  backups get full lineup weight. DEV (practice squad) is NOT treated as out.
