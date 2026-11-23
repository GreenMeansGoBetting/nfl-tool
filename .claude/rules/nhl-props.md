---
paths:
  - "nfl_tool/site/nhl/shots.*"
  - "nfl_tool/site/nhl/goals.*"
  - "nfl_tool/site/nhl/points.*"
  - "nfl_tool/site/nhl/saves.*"
  - "nfl_tool/site/nhl/best.*"
  - "nfl_tool/nhl/shots_model.py"
  - "nfl_tool/nhl/goals_model.py"
  - "nfl_tool/nhl/points_model.py"
  - "nfl_tool/nhl/saves_model.py"
  - "nfl_tool/nhl/nhl_odds.py"
  - "tools/nhl_factor_report.py"
  - "tools/backtest/nhl_*.py"
---
# NHL: Prop Pages Shared Rules (Model Unsure, Best Prices, CLV, Factor Report, Best Plays)

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

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
  (`memberPrice` / `buildBook`; none = the build's on the prop pages). Listed plays and buckets stay
  the build's, except **Best Plays leaves out a play none of their books has** (`notMine`, "N plays
  left out" + Edit My Books; a member, 2026-11-21: it showed books they don't have). A My Books change
  redraws. Tests: `test_a_member_sees_the_best_price_on_their_own_books`,
  `test_a_play_none_of_the_members_books_has_is_left_out`.
- **Every book's price** (`smartstake.fetch_nhl_book_odds`; `SMARTSTAKE_API_KEY` on the NHL step of
  deploy.yml AND nhl-refresh.yml): `book_odds["AWAY_HOME"].props.{sog,goals,saves,first_goal}[id]`,
  matched by `player_finder` on either team. US books, odds lock (data-pipeline.md).
- **Every book's ladder** (the owner, 2026-11-02: "use smartstake odds and not just novig"): ONE
  `alternate=true` call for every market (`add_ladder(..., league="nhl")`) into `sog_alt`,
  `goals_alt`, `points_alt`, `saves_alt` (every line, main ones too). The open rows' ladders
  (`nhlLadder` in nhl-common.js; Shots, Goals incl. a hat trick, Points, Saves) and the card's alt
  lines price each line at the best on the member's books (`nhlLinePrice`; Novig's when no book has
  it), click for every book, a save box each. A line only a book hangs joins the ladder (Saves:
  no model chance there). nhl/data.json was 3.8 MB on 2026-11-02, so the ladders stay inside it.

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
