---
paths:
  - "nfl_tool/site/game-overview.*"
  - "nfl_tool/site/game-summary.js"
  - "nfl_tool/gmg_model.py"
  - "nfl_tool/line_grades.py"
---
# Game Previews and the GMG model

Stories and examples behind these rules: `docs/history.md`, "Game Previews".

## Full Preview

- Section order: Injuries, Odds, **Recent Games**, General Stats & Scheme, Pick Tracker.
- General Stats & Scheme is two boxed matchups ("ATL Offense vs GB Defense"), each holding its
  stat table plus scheme and Team Grades. Grade letters are the same size as the numbers;
  Heavy/Light Box values stay on one line.
- The **Raw Stats / vs Opponents** toggle (`statsMode`, `applyStatsMode`; data `team_stats_adj`)
  sits in the General Stats header, with a copy on the Summary toolbar because the card's
  matchups use it too. It swaps `DATA.team_stats` between `team_stats_raw` and `team_stats_opp`.
- Recent Games runs Week 1 first, with opponent logos, the closing spread and total from the
  schedule, and ATS (Covered/Missed/Push) and O/U results. Clicking a row opens the box score.
- Box score popup: `.box-score-grid` lays the tables out two-up, Passing | Rushing then
  Receiving | Defense, each filling its half (820px modal); one column on phones.
- **League-rank popups are paired** (`openPairedRankModal` / `pairedRankPartner` in common.js):
  - Clicking any number in an OFF/DEF matchup row shows TEAM | offense value | defense value |
    TEAM. Each column is sorted on its own, with equal-width halves. This matchup's offense is
    highlighted on the left and its defense on the right.
  - The partner is the opposite side's cell in the matching column, learned from a complete row
    of the same table, so a blank "--" never mis-pairs.
  - Cells with `noPair` (e.g. scheme Tendency %) or no real counterpart open the single list.
  - Team Grades use `openPairedGradeModal`; Red Zone's Trips/TDs/FGs/Avg columns appear on both halves.
- **A saved pick shows the line it was made at** (`pickLabel`, game-overview.js): the Pick
  Tracker badge, the reveal popup and the card's My Picks print the stored `line_at_pick` /
  `odds_at_pick`, never the current line. Changing only the confidence on the Summary card keeps
  the original line. Grading always uses the stored line.

## Grades, tags and edges

- `categoryZ(cat, team, side)` in game-overview.js is the one switch for scheme / trenches /
  composite grades (`compositeZ`, `schemeCompositeZ`, `SUMMARY_CATEGORIES`).
- `gsMatchupTag(offZ, defZ)` in game-summary.js, both z's "good for its own side". Gap
  (off − def) >= 1.0 = Mismatch, <= −1.0 = Tough, so a bad offense vs an AVERAGE defense still
  flags. Both past ±0.4 the same way = Good vs Good / Bad vs Bad. Grade rows use the same tagger
  on their composite z.
- Edges are ranked by gap (or how far both lean for same-direction tags) and nested under the
  grade they back up, not listed as a top 8.
- Scheme looks count once the defense shows them >= 12% of the time; frequency only scales rank
  (0.7x-1.25x), never gates.
- Candidates: General Stats rows (Production rows ranked 0.75x, since the Passing/Rushing grades
  already sum them), Penalty Yards, scheme looks, and the Trenches parts (Pass pro vs rush, Run
  block vs run D). Turnovers show only as good vs bad (mostly random; never Bad vs Bad filler).
  Skipped: Plays/Game, quarter splits, the Red Zone composite (it has its own grade row).
- "Scheme" is labeled "Blitz & Box" on the card.
- The A–F grade boxes (`.gs-grade.tier-*`) use the same tinted fill + edge as the full preview's
  Team Grades cells (A/B green, C yellow, D/F red, A and F strongest). Keep the two in sync.

## Trenches (`nfl_tool/line_grades.py` -> data.json `line_grades[team].ol / .dl`)

- Shows as a "Trenches" row under Red Zone in Team Grades (OL overall vs the other team's front
  overall), the same row on the Summary card, and a Trenches section in each Game Previews panel
  between Pass Rush and Team Grades (Pass Protection, Run Blocking, Discipline, Overall; letter +
  0-100 score, colored by score; the defense's Discipline cell is intentionally blank). Any
  Trenches grade opens the Trenches modal: all 32 teams, OL + defensive front, hover breakdowns,
  the two teams highlighted.
- OL = Pass Pro 55% (pressure vs 4-man rush .30, vs blitz .15, sack rate minus FTN QB-fault sacks
  .25, pressure vs NGS time to throw .20, clean pocket .10) + Run Block 40% (NGS expected rush
  yds/carry .35, stuff rate .20, 3rd/4th & <=2 run conversion .15, yds/carry vs box count .15,
  designed-run success .15) + Discipline 5% (OL penalties/game via roster position).
- DL = the same metrics from the defense's side (Pass Rush 55%, Run D 45%, no discipline), so OL
  grades read against the opponent's front (two-sided rule).
- Each metric: shrunk toward league by prior k, opponent-adjusted (play-weighted), z-scored;
  groups re-standardized. Letter uses Team Grades' bands; plus a 0-100 score = league percentile
  of z: A 88+, B 66-87, C 35-65, D 12-34, F <12.
- Pressure = sack or QB hit (no public hurries). NGS comes from nflverse's combined
  `ngs_passing/ngs_rushing.csv.gz` (per-season files don't exist for 2026), weeks >= 1 only.

## Summary card (one full-width column, `g2-*` styles, top to bottom)

- The Summary toolbar has no explanatory subtext.
- **The Line** (`gsLineStrip`): Spread, Total, Market score (the score the spread + total imply),
  **GMG model** score (green tile), Win chance.
- **Team panels** (`gsTeamPanel`), one per team side by side: team-color banner with record and
  record vs the spread, Results chips, Ratings (Off / Def / Overall / Schedule), Injuries (5
  starters, then "+N").
- **The Matchups** (`gsMatchupColumn`): each grade row (Passing, Rushing, Red Zone, Trenches,
  Blitz & Box) with the stats behind it nested underneath ("claim, then proof"). Only the grade
  rows get a tag box; stats get a dot (green favors the offense, red the defense, yellow strength
  vs strength). At most `GS_PROOF_PER_GRADE` 2 stats per grade and `GS_PROOF_PER_SIDE` 7 per
  side, strongest grade first; Bad vs Bad stats are not listed (not an edge). Leftover edges
  (points, EPA, 3rd down, penalties...) go under "Overall". Labels carry units ("Rush yds /
  game", "4-man rush success", "DAL shows it 53%").
  - Every stat number has a color (`gsZClass`): green / red past the tier line, **yellow in
    between** (never plain). A Trenches value shown with its letter takes the letter's color
    (`gsGradeValClass`: A/B green, C yellow, D/F red).
- **Keys** (`gsKeys`): the 3 biggest graded matchups from both sides (`GS_KEYS_SHOWN`); tile =
  who has the advantage (team color), the matchup in plain words, the two grades. The regular
  starting QB ruled Out (same rule as the model) always takes the first tile. Sits below the
  matchups, above My Picks (the user's placement).
- **My Picks** (`gsPickStrip`): one strip across the bottom, the three markets side by side. The
  toolbar button `#summary-rail-btn` ("Hide My Picks") hides the strip. The Novig QR block is off
  the card "for now" (user).
- Cards scale 93-98% with everything on; the card is `.sc-grow`, so `fitWideSummaryCard` zooms
  the main column when there's room.

## GMG score model (`nfl_tool/gmg_model.py` -> data.json `gmg_model[game_id]`)

- Each team's points = league average + three reads of its offense vs that defense (`BLEND`):
  ratings 40% (ESPN FPI off minus def), scoring 20% (opponent-adjusted points for / against,
  shrunk by 4 prior games), matchups 40% (offense z minus defense z for every graded piece:
  Passing .25, Trenches .15, Red Zone .13, Rushing .12, EPA/play .12, Blitz & Box .08, 3rd down
  .05, explosive .04, turnovers .03, sacks .02, penalties .01; 4.0 points per z). Home field 1.6.
  Always opponent-adjusted, whatever the Raw / vs Opponents toggle says.
- A starting QB ruled Out costs his team 3.5 points (`QB_OUT_POINTS`, the user's number). **The
  starter** (`_regular_qb` / `gsRegularQb`) = the QB with the most games as the team's lead
  passer (10+ attempts), ties to whoever led more recently; he's "out" if this week's injury
  report says Out or he's on IR. A fill-in who is Out himself never counts. The model does not
  add points for a starter coming BACK; only ESPN's ratings see that.
- It lives in the build, not the browser, so one number feeds the card, the record and the
  grading. The grade math in gmg_model.py mirrors game-overview.js; **change a grade's recipe in
  both places**.
- **Picks:** every game gets a spread pick and a total pick (whichever side of Novig's line the
  model's score lands on) with an edge in points; 2.5+ (`EDGE_POINTS` / `GS_MODEL_EDGE`) is
  highlighted and tallied separately.
- **Locked at kickoff:** this week's upcoming games are re-projected every build; once a game has
  started its entry is kept as the last build before kickoff left it (`frozen`) and graded against
  the line stored in it. A game that started with no earlier entry is never projected after the
  fact (it shows "--").
- **Where the record lives:** `previous_gmg_model` (build_stats.py) merges the live data.json's
  `gmg_model` with `model_history/gmg_model.json`, which deploy.yml commits (as
  github-actions[bot], needs `contents: write`) whenever a game locks or goes final.
- **Where it shows:** the green GMG model tile on the card (click it) and the "GMG Model record"
  toolbar button open the record popup (`renderModelRecord`): four record tiles, then each week's
  games with model score, final, picks, edges and results.
- Weights were set from the 2026 season's first 65 finished games and marked down for being
  in-sample. **Not backtested on past seasons**: a talking point, never "beats the line".

## Your own weights and Build Your Model

- The small "i" on the model tile opens "How the model weighs things" (`openModelWeights`): every
  weight is a slider in three groups (what goes into the score, matchup grades, point adjustments:
  home field, starting QB out, matchup impact), with a live table of the week's games (Market |
  GMG default | yours). Blend and matchup sliders are relative (share = value / group total).
- `gsModelCompute(game, w)` re-projects in the browser with the same math as gmg_model.py (equal
  to the build on GMG default weights). **Keep the two in step**, including
  `GS_MODEL_BLEND / _MATCHUPS / _POINTS` bases vs the Python constants.
- **Build Your Model view:** a third view button between Full Preview and Summary (`gsView`
  "model", `#section-model`). Same block as the popup (`renderModelWeights(page)`, one `.mw-root`
  each, everything found by class inside its own root) plus two extras: the week table adds the
  spread and total pick the current weights make (edge in points, 2.5+ highlighted), and the GMG
  Model record sits underneath.
- Presets: a "Using" dropdown (GMG default + saved sets), Save as new (named, max 12), Reset
  sliders, Delete. Moving a slider while on GMG default starts a preset called "My weights";
  slider moves save straight into the active preset. Stored in `nfl-tool.model-presets.v1`
  (`{active, presets:[{id,name,w}]}`), synced to the member's profile (in `SYNC_KEYS` and
  sync.js `KEYS`).
- With a preset active the tile shows the preset's name and score, so a screenshot never passes
  custom weights off as "GMG model". Games that have kicked off, the record popup and the graded
  picks always use GMG default.
