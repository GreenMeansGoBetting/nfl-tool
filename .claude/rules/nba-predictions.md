---
paths:
  - "nfl_tool/nba/predict.py"
  - "nfl_tool/site/nba/game-predictions.html"
---
# NBA: Game Predictions (Off-Site Record)

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Full-game model: Game Predictions (built 2026-10-30 at the owner's ask, UNPROVEN)

No replayed model (pace, opponent-adjusted, lineup ratings; `tools/backtest/nba_games.py`) beat
DraftKings' closing line. On 2026-10-30 the owner asked for one anyway ("we have a lot of ingredients
... with no recipes"; fair odds for spread, total, moneyline beside the real lines). It sits under
UNDER CONSTRUCTION, and the owner was told it is unproven until its own graded record says otherwise.
- `predict.py`: League Stats Chart numbers -> points. Each number = average + (offense - avg) +
  (what the defense allows - avg), each pulled toward average by `SHRINK` (games; three-point making
  slow, shot mix fast). Rows a 100 possessions: Threes / The Paint / Mid-Range (shot mix vs the zone's
  worth + makes), Turnovers, Offensive Glass, Free Throws (trips + FT%), Everything Else (real rating
  minus the unshrunk rows, shrunk hard), then x possessions (both paces vs average), Home Court 2.
  **Transition and ball movement are not rows**: they are how the shots and turnovers happen (counting
  them again double counts). On 2026-10-30 the rows tracked real ratings at r 0.92 (test pins > 0.85).
  Shot mix alone moves almost nothing (a three, a paint shot and a mid shot are worth about the same
  league-wide); makes, turnovers, glass and free throws carry the points. Fair chances: normal curve,
  `MARGIN_SD` 12, `TOTAL_SD` 18. It knows nothing of injuries (said in the page's i).
- Build: `compute_predictions` (own try) -> data.json `predictions` {upcoming: {window: {game id}},
  record, ledger}: the next 3 nights' untipped games, every chart window. Record
  `model_history/nba_predictions/<season>.json`: season-window prediction + lines, rewritten until tip,
  graded on the final; YTD ledger per market = the model's side (`predict.plays`: spread / total by
  chance, ML by edge vs price), value = edge vs the book price, push left out; tags fav / dog (minus line
  or price), home / away, over / under.
- **Pages retired 2026-11-03** (research only; `game-predictions.html` forwards to the League Stats
  Chart; the page code is in git history). The old page, for reference: **Card =
  League-Stats-Chart grids (`pvGrid`, one width 640), ONE header row each** (the owner, 2026-10-30:
  "more structured and symmetrical"; a band over sub-labels = "two different weird stacks"). Top:
  **Big "Work In Progress" warning** (the owner's words). Card: **GMG Score + Injury Report** side by
  side (ESPN list, worst first, `playerClick`); then a row a team, **Book Spread / Total / ML | GMG
  Spread / Total / ML** = GMG's OWN numbers (our spread, our total, fair ML; Over on the road row,
  Under on the home row), shaded green / red by our fair price AT THE BOOK'S LINE vs the book's
  (both in the hover, **no percent under a price**); then the **Point Breakdown, always open**. No
  separate Spread / Total boxes (they repeat the GMG columns). Tests: `tests/test_nba_predictions.py`.
