---
paths:
  - "nfl_tool/smartstake.py"
  - "nfl_tool/nfl_odds.py"
  - "nfl_tool/nfl_lines.py"
  - "nfl_tool/novig_event_markets.graphql"
  - "nfl_tool/site/book-odds.js"
  - "tools/smartstake_probe.py"
---
# NFL Odds: SmartStake, Novig and Every Book's Price

Split from `data-pipeline.md` (2026-11-23), which keeps building locally, ratings, lineup-aware usage and injuries.

## Odds: SmartStake leads, Novig adds; no SGO

- **SGO (SportsGameOdds) was removed 2026-10-23** (the owner: SmartStake "will always reign
  supreme"). It once put Jaleel McLaughlin at +154 (its "fair value" stand-in) on the TD Summary
  while FanDuel had +600. Never add it back. The All Odds list on Game Previews (SGO only) went
  with it.
- Anytime TD (`player_td_odds`): SmartStake's list (`book_td_odds`, team from the current roster;
  its best price and its own no-vig chance). Novig's own feed only for a team SmartStake has
  nothing on (`merge_td_odds`; the owner, 2026-10-26: "smartstake, not novig default"). A player
  who was on BOTH teams of a game this season goes to his newer one (`build_roster_team_lookup` lists
  teams oldest to newest; Joe Milton III, DAL then PHI, was dropped from PHI @ DAL, 2026-11-25). A player
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

- **One file per sport (2026-11-21):** `smartstake.py` is only the shared plumbing (API calls, US books,
  quotes -> prices, odds lock, alt ladders) and rebuilds every sport; each sport's markets and fetch are
  `nfl_odds.py` (NFL), `nba/nba_odds.py`, `nhl/nhl_odds.py`, so a change there rebuilds only that sport.
  The owner, after an NFL-only fix rebuilt NBA and NHL: "WE AREN'T DOING THOSE SPORTS". New sport-only
  odds code goes in that sport's file, never in smartstake.py.

- The owner is a SmartStake partner with their WRITTEN permission to show the odds to members
  (their API terms otherwise allow internal use only). Key: GitHub secret `SMARTSTAKE_API_KEY`,
  passed to the NFL build step. Docs: https://www.smartstake.app/api (needs `Accept-Encoding: gzip`).
- One league snapshot per build: `/v1/odds?league=nfl`, `alternate=false`, `live=false`, only the
  markets used, `state=NJ` (without a state the bet links are Ontario's; NJ links open fine in other
  states, so the site never mentions a state: the owner, 2026-10-15, members found the NJ note confusing). Unfiltered it is ~40,000
  quotes a game. Only `US_BOOKS` are kept (it also carries Canadian, offshore and pick'em apps).
  4CX (`4cx`) and Underdog (`underdog_dfs`) were added 2026-10-29 (members asked). Underdog is a
  pick'em app (`PICKEM_BOOKS`, `BO_PICKEM` in book-odds.js, `sim.PICKEM_BOOKS`): it shows in every
  price list but is never the best price a play, edge, MIN_BOOKS count or record uses.
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
- Shared with the NHL build (`nhl_odds.fetch_nhl_book_odds`, nhl.md): `smartstake.py` and `site/book-odds.js`
  are shared by both sports, and `/book-odds.js` is in the middleware's SHARED_FILES (the NHL
  pages load `../book-odds.js`), so book-odds.js carries its own helpers (no common.js there).
  Each build keeps only the games on its own schedule (`keep`): the board runs days ahead.
- `tools/smartstake_probe.py` (+ `smartstake-probe.yml`, runs when pushed) re-checks books and
  market keys; it commits counts and names only, never prices.
