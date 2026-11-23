---
paths:
  - "nfl_tool/site/nhl/shots.*"
  - "nfl_tool/nhl/shots_model.py"
  - "tools/backtest/nhl_shots*.py"
---
# NHL: Shots on Goal

Part of the NHL rules; the shared ones (files, this season only, data, build) are in `nhl.md`, which loads with this file.

## Shots on goal

**Model** (`shots_model.py`, standard library; `shots_model_for` gives it no prior):
- **Projection = shots per minute x minutes tonight x matchup.**
  - Rate: shots per minute played, each game back 0.985 of the next, with 50 minutes
    (`pad_minutes`) of an average skater at his position WITH HIS ICE TIME (`role`, `role_power`
    1.0). Three quarters read from attempts x his on-goal share (pulled hard to the league's).
  - Minutes: recent ice time (each game back 0.8); a game under 60% of his usual ("left early")
    doesn't count. Before 3 games, a game under half the league's last line / pair (`short_first`)
    is "left early" too, kept in `ShotsModel.short` (the goals model skips it). No full game yet:
    tonight's line or pair minutes (`minutes_from` "line"); no posted lineup = **no number at all**.
    Three short games = he really plays that little (`short_games`). Tests: `test_nhl_unsure.py`.
  - Matchup (`WEIGHTS`, exponents on what the opponent allows vs the league): overall 1.0,
    position 0.5, his rink areas 0.5, PP shots allowed x his PP share 0.6; home +3%, own b2b -3.5%,
    opponent b2b +3.5%; `scale` -4%. A defense = its games mixed with 20 games of league average.
  - **Tonight's line** (`line`, 0.2, when posted): log of his line's minutes on this team
    (`slot_minutes`: top three forwards by ice time each game = line 1, etc.) over his own, capped
    +/-0.6. Minutes shown stay his own.
- **Chance:** negative binomial, spread = m + 0.07 m^2 (`chance_at_least`, `chance_over`,
  `fair_american`).
- **Replay:** `python tools/backtest/nhl_shots.py 2026` (`--tune`, `--last-season`). Findings that
  bind: his rate and ice time are most of it; hot / cold streaks, team strength and attempts allowed
  add nothing; the small-sample guard is required; fading a hot start has been right. Weights
  checked on 2024-25 and kept as is (PP weight is noise, under 1%).
- **Power-play units: tested, not added** (`tools/backtest/nhl_pp_units.py`; shifts kept in
  `data/nhl/shifts/<season>`): past PP share added nothing. Only tonight's real units would help,
  and those are paid products (needs a licensed feed). The lineup story has no PP units.
- **Not shown to beat the line** (no free history of SOG prices): a talking point until the record
  says otherwise.

**shots.json** (untracked, next to data.json):
- `games`: `{game: {locked, final, players}}` through `SHOTS_DAYS_AHEAD` (2) days. Row: `games`,
  `avg` (his real shots a game), `mean` = `usual` x `matchup`, `minutes`, `lift` (1.06 = +6%),
  `shares`, `chances` (1+ ... 8+), `out`, `slot` ("F1" ... "D3", null until posted), `usual_slot`,
  `line_minutes`, `move` ("up" / "down" / null), `first_sog`, `rest` / `opp_rest`.
- **Who is projected:** a posted lineup's skaters who have played this season (`posted` on the
  game); before that, the team's usual 18 by ice time less ESPN's outs.
- `lineups`: `{game: {posted, team: {lines, goalie, scratched, injured}}}`.
- **Lock:** a started game keeps the previous build's rows (live `shots.json` read with the build
  key); none saved = no projection, never one made after puck drop. Finals get `actual` (null if he
  didn't dress).
- `defense`: per team `season`, `season_rank` (1 = allows most; what the page shows), `blend` /
  `factor` / `rank` (the model's), `league`, `games`.
- `edges` (`SHOTS_EDGES` lean 3, strong 6, check 12: now only the every-book tags and Best Plays'
  Goals / Points cutoff), `bar` (`SHOTS_BAR` 0.06), `record`.

**The Shots bar: a play is shown or left out, no Lean and no Check.** A play = an edge of
`SHOTS_BAR` (6 points) or more on a player NOT moved down a line tonight (`shots_play`, `size`
"play" / "none"). Never cut on tonight's number against his season average (the owner: fill-ins
move roles). Re-run `tools/nhl_factor_report.py` before changing the bar.

**The record** (`model_history/nhl_shots/<month>.json`, committed by "Save GMG model record"):
each finished game once, every player with a main line who played: `[id, name, team, line, over,
under, projection, chance of the over, real shots, season average, line move, first line, first
over, first under]` as locked, then **`factors`** (`SHOTS_FACTORS`, `shot_factors`; the file's
`cols` / `factors` name them: position, games, avg, `vs_avg`, minutes, PP share, slot, move, home,
`rest` / `opp_rest`, `s_*` shares, `l_*` lifts), then `nv` (see CLV).
- `shots_record_summary`: `play` / `none` (every saved game by today's bar), and for plays `over` /
  `under`, **`fade` / `with`** (against / with his season average); W-L, units risking 1.
- `record.days` = every day's tally; `record.plays` = each graded play of the latest
  `SHOTS_RECORD_DAYS` (14) days with any (capped so the file doesn't grow).
- `record.clv` (see "Closing line value").

**The page** (`shots.html` + `shots.js`), one table for the slate, best edge first:
- **Edge = model chance minus the price's break-even**, for the better side of the main line. No
  shot math on the page: it reads `chances`. `pickSide` must agree with the build's `shots_play` (a
  test checks every row).
- **Opens on plays only** (`isPlay`), Rating "Play". **Plays only / Every line**
  (`shotsView.every`): plays first, then "Not plays". Over the bar but moved down = **"Lower
  line"**. **Before a lineup is posted** plays assume he stays on his usual line, tagged **"Play: no
  lineup yet"** (dashed, `pendingLineup`). No check group, nothing amber. No plays = says so +
  "Show every line". `bookEdges`: PLAY from 6, never on a player moved down, no CHECK.
- Toolbar: Side, Skaters, Lineups dropdowns (`.shots-filter-select`), Plays only / Every line.
  "How the number is made" at the top of the panel.
- Line column: L1-L4 / D1-D3 + arrow vs his usual line, "--" until posted; a note says how many
  games have lineups; strip cards say "Lineup" (check) or "No lineup yet" (`board.posted`).
- Columns: Line, the play (**"o1.5" / "u2.5"** chip + price), **Rating** (Play / Lower line, + "vs
  his avg" when the play goes against his season average), Avg, Proj, Fair, Edge; advanced: Min,
  Opp, Pos, Spots, PP, Home/rest. **Green = more shots for him, red = fewer** (Over chip green,
  Under red); a piece colored from 2.5%.
- Breakdown starts from his season average, names the small-sample step ("5-game sample -22%"),
  the line piece ("L1 tonight +13%"), linemates, injured / scratched, the defense tiles, every line
  at the model's fair price, and "Where he shoots" (his share bold, the defense's `zoneBoxes`).
- Lineups filter: **"All" (opens here) / "Lineup Confirmed"** (on a line or pair in a posted
  lineup). **A player with no shots line is never listed.** Nothing under Lineup Confirmed says why
  + "Show all players". A strip game shows only that game (click again for the day). Outs left off.
  "Confirmed" = the NHL's projected lineup, not warmups; the About box says so.
- **"YTD Model Performance"** button beside the title opens the record (`#shots-record-modal`, the
  `nhlYtd` tracker): tiles, then graded plays newest day first (`recordPlays`).
