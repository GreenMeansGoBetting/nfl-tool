---
paths:
  - "nfl_tool/site/nhl/goals.*"
  - "nfl_tool/site/nhl/points.*"
  - "nfl_tool/nhl/goals_model.py"
  - "nfl_tool/nhl/points_model.py"
  - "tools/backtest/nhl_goals*.py"
  - "tools/backtest/nhl_points*.py"
  - "tools/backtest/nhl_pp_units.py"
  - "tools/make_nhl_points_sample.py"
---
# NHL: Goals and Points

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

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
- **No goal** (a member, 2026-10-23: the Under side of Goals): under the anytime price, "No" + its price
  (best book at under 0.5 on the member's books, else Novig's `no_odds`) and its own save box
  (`noGoalChip`); also the card's Odds tab. Saved as market `goal`, side under, line 0.5, id ending `:no`
  (its own play beside the Yes); My Plays grades it a win at 0 goals.
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
