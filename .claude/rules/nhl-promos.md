---
paths:
  - "nfl_tool/site/nhl/promo-tools.*"
  - "nfl_tool/site/nhl/icebreaker.js"
  - "nfl_tool/site/nhl/hattrick.js"
  - "nfl_tool/nhl/saves_model.py"
  - "tools/backtest/nhl_icebreaker*.py"
---
# NHL: Promo Tools (King of the Crease, Icebreaker, King of the Hat Trick)

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

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
    `crease_payouts` via `/api/crease-payouts` (member-profiles.md).
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

## King of the Hat Trick (Promo Tools, `promo-tools.html#hattrick`)

DraftKings: an anytime goal scorer bet on a player who scores a **hat trick** (3+ goals in one game)
splits the pool (several hat tricks: one pool across all of them; none rolls it over).
- **No odds on this page, ever** (the owner, 2026-10-31: "this isnt about finding fair value";
  members have prices already). Matchup and usage only; the game's total line is the one market
  number allowed. A test fails if hattrick.json carries a price.
- **Build** (`hattrick_file` -> `hattrick.json`, untracked): `days` copied from the Goals board
  (same players, lineups, lock; outs left off; `mean` = the Goals model's own xG tonight),
  `big` (every 2+ goal game: `vs` = goals on each goalie, empty nets not his), `players`
  (board players' real counts: 2G, HT, L10, PP G, TOI, PP TOI, SOG, low slot), `teams` (GF / GA,
  5+ games, 2G / HT for and against), `goalies` (2G / HT on him), `league` (hat tricks, days
  with one).
- **Page** (`hattrick.js`, Icebreaker's layout): Day, Games chips (whole day on), tiles, Teams
  Tonight (Tonight xG / Total, Offense, Opponent Defense, Opponent Goalie; league ranks on the
  eight colors), Players (Tonight, Scoring, Usage, Matchup; colors among the picked games; every
  column sorts; top 25), beside it (never in the image) every hat trick and every defense's 2G.
  Hovers on 2G / HT list the games. Top-level names in hattrick.js start with `hat`
  (promo-tools / nhl-common globals share the page).
- Tests: `tests/test_nhl_hattrick.py`.
