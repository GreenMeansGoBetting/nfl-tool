---
paths:
  - "nfl_tool/site/nhl/saves.*"
  - "nfl_tool/nhl/saves_model.py"
  - "tools/backtest/nhl_saves*.py"
---
# NHL: Saves

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

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
- **Every book's saves price:** `nhl_odds.saves_market_keys` finds the market in `/v1/markets` by
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
