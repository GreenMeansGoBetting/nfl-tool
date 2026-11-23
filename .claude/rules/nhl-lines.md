---
paths:
  - "nfl_tool/site/nhl/lines.*"
  - "nfl_tool/site/nhl/vs-position.*"
  - "nfl_tool/nhl/lines_model.py"
  - "nfl_tool/nhl/stacks_model.py"
  - "tools/backtest/nhl_stacks.py"
---
# NHL: Line Matchups and Vs Position

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

## Line Matchups (`lines.html` + `lines.js`)

**A preview, never a pick sheet: no prices, no projections, no record.** Under NHL after Game
Previews.
- **Counting** (`lines_model.py`): `game_units(raw)` from `lines5`. 5-on-5 = exactly 3 F + 2 D + a
  goalie a side, read off the shifts each second. Per team: `team`, every trio (`F`) and pair (`D`)
  as `[secs, attempts for, against, goals for, against]`, and `vs` (home trio vs away trio secs).
- `LinesHistory` (this season only): `unit` (season + `l3`; "together" = 60+ s), `usual` (from the
  latest game, `game_lines`' rule over the last 5), `deploy`, `meetings`. `likely_matchups`.
- **`lines.json`** (`lines_file`; `version.json` `nhl.line_matchups`): games through
  `SHOTS_DAYS_AHEAD`, `{locked, posted, teams: {T: {source "posted" | "usual", games, team, lines,
  pairs}}, players, matchups, meetings}`. Unknown name = New Together. Started games keep the last
  build's entry. `LINES_RULES` (sent as `rules`): Strong / Weak at 56% / 44% share with 20+ minutes,
  else Small Sample (New Together at 0); Hot / Cold when last 3 (10+ min) are 5+ points of share or
  +/-2 goals off the season, **Steady when the two disagree** (never contradict itself).
- **Page:** one game from the strip ("Lineup" / "Usual Lines"): away tiles, middle (Likely Matchups,
  Past Meetings, Team 5-on-5), home tiles. Tile: Line / Pair N + tag, names (`playerClick`), Min · GP,
  Shot Share and Last 3 GP on eight colors around 50% (`SHARE_STEPS`, shaded past half the Strong
  minutes), Goals, Form. Under 1180px the middle goes on top; phones one column, matchups first.
  Likely Matchups is a lean (little trio-vs-trio history) and says so.
- Tests: `tests/test_nhl_line_matchups.py`, `tests/test_nhl_line_matchups_site.py`
  (`helpers.nhl_lines()`). `tests/test_nhl_lines.py` is the card's Line column.
- **Line Stacks (retired 2026-10-21, it lost):** gone are the page, `stacks.json`, the build's board
  and record (`game_ice` / `ice`). Kept: `model_history/nhl_stacks/`, `stacks_model.py` +
  `tools/backtest/nhl_stacks.py` + `tests/test_nhl_stacks.py`, the SGP price log endpoint and D1 rows
  (member-profiles.md); My Plays still grades saved stacks.

## Vs Position (`vs-position.html` + `vs-position.js`, 2026-11-17)

What each defense allows to C / LW / RW / D (a member: "the shots that each team gives to each
position"; the owner: its own page under Line Matchups, a Shots / Goals toggle, a game shows its players).
- Build: `compute_vs_position(records)` -> data.json `vs_position` {positions, teams {T: {season,
  home, away, "10": [games, C sog, C g, L sog, L g, R sog, R g, D sog, D g, C pts, L pts, R pts, D pts]}}}: the OTHER
  team's skaters by the box score's position; home / away = the defense's venue. The page only divides and ranks.
- Page: Shots | Goals | Points and Season / Home / Away / Last 10 (per-device `nhl-tool.vs-position.v1`).
- **Game card** (the first unstarted opens; the owner, 2026-11-18): offense banner "vs <DEF> Defense", then one lane per
  position that never wraps: position, the defense's tile, the offense's players (data.json skaters, his number a game,
  Goals and Points with his season total small beside it, "0.38 (8)"; colored vs the league's players at his position with 3+ games; Out faded, last). The header says the stat once
  ("BOS SOG Per Game"), never on each tile; only a player with under half his team's games shows "4 GP".
- **League chart, by screen** (`VP_WIDE`, 761px and up): a computer gets it on top of the page, teams across, positions
  down (`vpSnapshot`, click a position to sort); a phone gets the tall list under the game (`vpTable`). The game's two
  teams lead, never grayed. **Today's Teams Only** in its band follows the day picked. Defense tiles are graded from the
  defense's side (the owner, 2026-11-17: "isn't good defense colored green site wide"): allows the fewest = 1st green,
  allows the most = 32nd red; the chart still lists the most allowed first. Player tiles: more = green.
- The box score's positions list many wingers as C (it's the roster's position, not tonight's line).
- Tests: `tests/test_nhl_vs_position.py`.
