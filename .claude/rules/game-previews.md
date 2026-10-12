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

## Grades and edges

- `categoryZ(cat, team, side)` in game-overview.js is the one switch for scheme / trenches /
  composite grades (`compositeZ`, `schemeCompositeZ`, `SUMMARY_CATEGORIES`).
- "Scheme" is labeled "Blitz & Box" on the card.
- **On the Summary card an edge is read straight off the two ranks shown** (`gsRankEdge` in
  game-summary.js), so a chip can never disagree with the numbers beside it:
  - `gsCategoryRank` ranks a team's grade 1-32 for its own side (1 = best offense / best defense).
  - Gap = the defense's rank minus the offense's rank. 16+ apart = clear edge, 8-15 = slight,
    closer = even. Both sides top 8 = strength vs strength.
  - The Matchups rows and the Keys tiles both use this one call.
- The Full Preview's Team Grades cells keep their own A/B green, C yellow, D/F red fill.

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

## Summary card (one full-width column, `g2-*` / `g5-*` styles, top to bottom)

Simplified 2026-10-12 at the user's call: "so much info is actually hurting it... if people
want the entire set of info they can get on the site." Do not add stat lines back to it.

- The Summary toolbar has no explanatory subtext.
- **The Line** (`gsLineStrip`): Spread, Total, Market score (the score the spread + total imply),
  **GMG model** score (green tile), Win chance.
- **Teams row** (`.g5-teams`): a panel per team at the two ends (`gsTeamPanel`: team-color banner
  with Rec and ATS, Results chips, Injuries with 5 starters then "+N"), and **both teams' Ratings
  stacked between them** (`gsRatingsStack`: one row per team; Off / Def / Overall / Schedule
  compare straight down). The user prefers stacked over a ratings row inside each panel.
- **The Matchups** (`gsMatchupTape`): only the five grades (Passing, Rushing, Red Zone, Trenches,
  Blitz & Box), the same rows for both teams in every game.
  - One shared label column down the middle: away offense vs home defense on its left, home
    offense vs away defense on its right.
  - Each cell is the letter grade plus its league rank ("#3"). The user asked for ranks here,
    so this card is the exception to the "no rank badges" rule.
  - Color follows the rank on an **8-step scale** (`GS_RANK_SCALE`, four teams per step: two
    greens, lime, yellow, amber, orange, red-orange, red), not the 3-tier green/yellow/red.
  - The edge is a **logo chip** at the outer end of each side, not a word: the logo of the team
    with the edge, green border = clear, yellow = slight, two logos = strength vs strength,
    a dash = even.
- **Keys** (`gsKeys`): the 3 biggest matchups from both sides (`GS_KEYS_SHOWN`), picked by the
  same rank edge; tile = who has the advantage (team color), the matchup in plain words, the two
  grades in rank colors. The regular starting QB ruled Out (same rule as the model) always takes
  the first tile. Sits below the matchups, above My Picks (the user's placement).
- **My Picks** (`gsPickStrip`): one strip across the bottom, the three markets side by side. The
  toolbar button `#summary-rail-btn` ("Hide My Picks") hides the strip. The Novig QR block is off
  the card "for now" (user).
- The card fits at full size (scale 1.00) with everything on; it is `.sc-grow`, so
  `fitWideSummaryCard` zooms the main column when there's room.

## GMG score model (`nfl_tool/gmg_model.py` -> data.json `gmg_model[game_id]`)

- Each team's points = league average + three reads of its offense vs that defense (`BLEND`):
  ratings 40% (ESPN FPI off minus def), scoring 20% (opponent-adjusted points for / against,
  shrunk by 4 prior games), matchups 40% (offense z minus defense z for every graded piece:
  Passing .26, Red Zone .17, Trenches .13, EPA/play .12, Rushing .10, Blitz & Box .08, turnovers
  .06, explosive .03, sacks .03, 3rd down .02, penalties 0; 4.0 points per z). Always
  opponent-adjusted, whatever the Raw / vs Opponents toggle says.
- **Margin stretch 1.2** (`MARGIN_STRETCH`, slider "Margin stretch"): the gap between the two
  teams' blended points is widened 1.2x before home field (1.6) and QB-out are added; the total
  is untouched. Without it the model's margins ran about 3.5 points against the market's 4.5,
  which put roughly 4 of 5 spread picks on the underdog whatever the weights were. If the
  tracked picks start leaning hard to favorites or underdogs, revisit this number.
- A starting QB ruled Out costs his team 3.5 points (`QB_OUT_POINTS`, the user's number). **The
  starter** (`_regular_qb` / `gsRegularQb`) = the QB with the most games as the team's lead
  passer (10+ attempts), ties to whoever led more recently; he's "out" if this week's injury
  report says Out or he's on IR. A fill-in who is Out himself never counts. The model does not
  add points for a starter coming BACK; only ESPN's ratings see that.
- It lives in the build, not the browser, so one number feeds the card, the record and the
  grading. The grade math in gmg_model.py mirrors game-overview.js; **change a grade's recipe in
  both places**.
- **Picks vs leans:** every game stores which side of Novig's spread and total the model's score
  lands on, with the gap in points. It is a **pick** only at 4+ points (`EDGE_POINTS` /
  `GS_MODEL_EDGE`, keep the two equal); closer than that it is a **lean**, shown grey. The
  user's call (2026-10-12): calling every game a pick just tracked coin flips.
- **Locked at kickoff:** this week's upcoming games are re-projected every build; once a game has
  started its entry is kept as the last build before kickoff left it (`frozen`) and graded against
  the line stored in it. A game that started with no earlier entry is never projected after the
  fact (it shows "--").
- **Where the record lives:** `previous_gmg_model` (build_stats.py) merges the live data.json's
  `gmg_model` with `model_history/gmg_model.json`, which deploy.yml commits (as
  github-actions[bot], needs `contents: write`) whenever a game locks or goes final.
- **Where it shows:** the green GMG model tile on the card (click it) and the "GMG Model record"
  toolbar button open the record popup (`renderModelRecord`): two headline tiles (Spread picks,
  Total picks: 4+ only), two small "Every game" tiles, then each week's games with model score,
  final, the pick or lean, its gap and the result (leans greyed).
- **Backtest (2026-10-12, `tools/backtest/`):** a week-by-week replay of 2024 and 2025 (480
  games, weeks 3-18, each projected only from earlier games; no ratings part, ESPN keeps no
  history). What it showed:
  - Against the closing spread it was 50%, and sliders tuned on one season then tested on the
    other did no better (47.7%). **A talking point, never "beats the line".**
  - The matchup pieces overlap heavily (Passing vs EPA/play 0.92), so the exact split barely
    moves accuracy. The weights were nudged toward what held up in both seasons: Red Zone and
    turnovers up, 3rd down and Rushing down, penalties to 0 (no link to the margin at all).
  - **The model's margins were smaller than the market's** (2026 weeks 3-5: 3.5 points on
    average vs 4.5), so about 4 of 5 spread picks landed on the underdog. A week where favorites
    cover (Week 5: 3-10) said nothing about the weights. Fixed with the margin stretch above.
  - Once the spread is known, the model's disagreement with it added nothing (best blend: the
    market plus 9% of the model's gap, with opposite signs in the two seasons). Hence picks only
    at 4+ points, and the "talking point" framing.
  - Home field fit near 2.2 and QB-out near 2.2 in that replay; both left at the user's numbers
    (1.6 and 3.5), the sample is too small to move them.

## Your own weights and Build Your Model

- The small "i" on the model tile opens "How the model weighs things" (`openModelWeights`): every
  weight is a slider in three groups (what goes into the score, matchup grades, point adjustments:
  home field, starting QB out, matchup impact, margin stretch), with a live table of the week's games (Market |
  GMG default | yours). Blend and matchup sliders are relative (share = value / group total).
- `gsModelCompute(game, w)` re-projects in the browser with the same math as gmg_model.py (equal
  to the build on GMG default weights). **Keep the two in step**, including
  `GS_MODEL_BLEND / _MATCHUPS / _POINTS` bases vs the Python constants.
- **Build Your Model view:** a third view button between Full Preview and Summary (`gsView`
  "model", `#section-model`). Same block as the popup (`renderModelWeights(page)`, one `.mw-root`
  each, everything found by class inside its own root) plus two extras: the week table adds the
  spread and total side the current weights land on (gap in points; 4+ = a pick, green; closer
  = a lean, grey), and the GMG Model record sits underneath.
- Presets: a "Using" dropdown (GMG default + saved sets), Save as new (named, max 12), Reset
  sliders, Delete. Moving a slider while on GMG default starts a preset called "My weights";
  slider moves save straight into the active preset. Stored in `nfl-tool.model-presets.v1`
  (`{active, presets:[{id,name,w}]}`), synced to the member's profile (in `SYNC_KEYS` and
  sync.js `KEYS`).
- With a preset active the tile shows the preset's name and score, so a screenshot never passes
  custom weights off as "GMG model". Games that have kicked off, the record popup and the graded
  picks always use GMG default.
