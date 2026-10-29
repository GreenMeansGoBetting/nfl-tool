# History: why the rules are what they are

This is the project guide as it stood on 2026-10-11, before it was split into `CLAUDE.md`
(core), `.claude/rules/` (current rules per area) and this file. It is kept word for word, grouped
by area, because it holds the dated stories, example players, before/after numbers and the
user's own words that explain WHY each rule exists.

- It is NOT loaded automatically. Search it when a rule's reason matters.
- The rules files are the current truth. If this file and a rules file disagree, the rules
  file wins; add a dated note here when a rule changes for a reason worth keeping.
- New entries go at the bottom of the matching area, newest last, starting with the date.

Facts that were out of date on 2026-10-11 are corrected in place and marked **[corrected]**.

## General

### What this is, and the workflow

## What this is

- Live at **https://nfl.gmgsports.org**. Repo: `GreenMeansGoBetting/nfl-tool`.
- Owner: a sports-betting content creator ("GMG" = Green Means Go) with no coding
  background. Explain in plain language and do the technical work yourself.
- The user screenshots sections and the **Summary cards** (fixed 1160×980, sized to their
  video template's left area) and drops them into betting videos. Favor dense,
  screenshot-ready, visually clean layouts.
- NFL is the active project. (A separate CFB tool is paused.)

## Workflow the user expects

1. Make the change and verify it locally (see below).
2. **Commit and push to `main`**. GitHub Actions rebuilds and deploys automatically.
3. Confirm it's live: poll `https://nfl.gmgsports.org/<file>?x=N` until the new code or
   data shows up, usually 60–105 s.
4. Tell the user to hard refresh (Ctrl+Shift+R).
5. Update this CLAUDE.md in the same commit whenever anything below changes.

- Commit messages end with the Co-Authored-By line the environment specifies.
- **Never view, print, or ask the user to paste API keys.** `SGO_API_KEY` and
  `SGO_API_KEY_BACKUP` are GitHub Actions secrets. Any future key (e.g. a Novig trading
  key) goes in GitHub Settings → Secrets, added by the user.


### Architecture overview

## Architecture

- `nfl_tool/build_stats.py`: the whole data pipeline. It reads nflverse play-by-play,
  rosters, injuries, snap counts, FTN charting and schedules, plus odds from Novig and
  SportsGameOdds and ESPN FPI, and writes `nfl_tool/site/data.json` (untracked; built in CI).
- `.github/workflows/deploy.yml`: runs build_stats and deploys `nfl_tool/site` to GitHub Pages.
  - It runs on a cron every 6 h, on pushes touching `nfl_tool/**`, and on manual dispatch.
  - Pushes set `SKIP_SGO_FETCH=1`, so SGO odds are reused from the live site to save quota.
    Novig and ESPN are free, so they're fetched fresh on every build.
- `nfl_tool/site/`: static HTML/CSS/JS pages.
  - `game-overview.html/.js` + `game-summary.js`: **Game Previews** (Full Preview, Build Your Model, Summary card).
  - `index.html` + `app.js`: **TD Data** (Season TDs, First TD, Summary card).
  - `player-props.html/.js` + `props-summary.js`: **Player Props** (Receiving/Rushing/Passing + Summary card).
  - `possible-plays.html/.js`: the Possible Plays list.
  - `picks.js`: the Pick Tracker.

  - `common.js`: shared helpers — tiers, possible plays, modals, the summary-card
    photo/banner/fit/**Save image** helpers, and lineup weights.

  - `teams.js`: team names, colors and logo URLs.
  - `style.css`: dark/light theme tokens and all page styles.

### Local verification

### Local verification

- Build: `SKIP_SGO_FETCH=1 python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json`.
  If the build hits a 404, it's a transient nflverse error; re-run.
- Serve `nfl_tool/site` with `python -m http.server <fresh port>` and check in the browser.
  Use a fresh port each time; the preview caches aggressively.
- Summary cards are 1160×980. `fitSummaryCard()` scales the content down if it overflows,
  and a scale near 1 is the goal.
- Save image uses html-to-image with `includeQueryParams: true`. Without it, ESPN logo URLs
  that differ only by query string collapse to one image.


## Game Previews

### A saved pick shows the line it was made at

  - **A saved pick shows the line it was made at** (`pickLabel`, game-overview.js): the Pick
    Tracker badge, the reveal popup and the Summary card's My Picks used to print the CURRENT
    line next to a saved pick (grading always used the stored `line_at_pick`). Changing only
    the confidence on the Summary card also re-saved the pick at the current line; it now keeps
    the original line.

### Offensive line / defensive front grades

- **Offensive line / defensive front grades (`nfl_tool/line_grades.py`, 2026-10-01):** designed
  with the user; in data.json as `line_grades[team].ol / .dl`.
  - **Where it shows (2026-10-01):** a "Trenches" row under Red Zone in Team Grades (OL overall
    vs the other team's front overall) and on the Game Previews Summary card (same row, same
    tags); and a Trenches section in each Game Previews panel between Pass Rush and Team Grades
    (Pass Protection, Run Blocking, Discipline, Overall; letter + 0-100 score, colored by score;
    the defense's Discipline cell is intentionally blank). Any Trenches grade opens the Trenches
    modal: all 32 teams, OL + defensive front, same layout as the draft the user approved, with
    hover breakdowns and the two teams highlighted. `categoryZ(cat, team, side)` in
    game-overview.js is the one switch for scheme / trenches / composite grades.
  - OL = Pass Pro 55% (pressure vs 4-man rush .30, vs blitz .15, sack rate minus FTN QB-fault
    sacks .25, pressure vs NGS time to throw .20, clean pocket .10) + Run Block 40% (NGS expected
    rush yds/carry .35, stuff rate .20, 3rd/4th & <=2 run conversion .15, yds/carry vs box count
    .15, designed-run success .15) + Discipline 5% (OL penalties/game via roster position).
  - DL = the same metrics from the defense's side (Pass Rush 55%, Run D 45%, no discipline), so OL
    grades read against the opponent's front (two-sided rule).
  - Each metric: shrunk toward league by prior k, opponent-adjusted (play-weighted), z-scored;
    groups re-standardized. Letter uses Team Grades' bands; plus a 0-100 score = league
    percentile of z (user asked for both, color-coded): A 88+, B 66-87, C 35-65, D 12-34, F <12.
  - Pressure = sack or QB hit (no public hurries). NGS comes from nflverse's combined
    `ngs_passing/ngs_rushing.csv.gz` (per-season files don't exist for 2026), weeks >= 1 only.

### The Game Previews Summary card, GMG score model, tags and edges

- **2026-10-12, the card was cut back to grades only.** It used to nest one or two stats under
  each grade, shown only when that stat was an "edge" (offense and defense far apart), capped at
  2 per grade and 7 per side. So one team's side could show several stat lines while the other
  showed only letters, which the user read as inconsistent, and the whole block as too wordy.
  A first redesign (grade tiles in a 2-wide grid per side) was rejected as "too jammed, too
  wordy" with dead space at the bottom. The user then chose: only the five categories with a
  letter and league rank, ratings stacked for comparison, an 8-color scale, and a logo chip for
  the edge. The edge rule moved from a z-score gap (Mismatch / Tough / Good vs Good tags) to
  the rank gap shown on the card, so nothing on the card can look contradictory.

- The Game Previews Summary card:
  - The Summary toolbar has no explanatory subtext (removed at the user's request 2026-10-11).
  - **Layout (redone 2026-10-10 over 4 mockups).** A viewer told the user the card "looks
    scattered, too much info and not organized"; the user asked for a joint NFL-statistician + UX
    review. Findings: the same story was told three times (grade, then loose stat edges), Bad vs
    Bad / Even rows had the same weight as real edges, numbers had no units, and the line was
    buried in a side rail. New card, one full-width column (`g2-*` styles), top to bottom:
    - **The Line** (`gsLineStrip`): Spread, Total, Market score (the score the spread + total
      imply), **GMG model** score (green tile), Win chance.
    - **Team panels** (`gsTeamPanel`), one per team side by side: team-color banner with record
      and record vs the spread, Results chips, Ratings (Off / Def / Overall / Schedule), Injuries
      (5 starters, then "+N").
    - **The Matchups** (`gsMatchupColumn`): each grade row (Passing, Rushing, Red Zone, Trenches,
      Blitz & Box) with the stats behind it nested underneath ("claim, then proof"). Only the grade
      rows get a tag box; stats get a dot (green favors the offense, red the defense, yellow
      strength vs strength). At most `GS_PROOF_PER_GRADE` 2 stats per grade and
      `GS_PROOF_PER_SIDE` 7 per side, strongest grade first; Bad vs Bad stats are not listed (not
      an edge). Leftover edges (points, EPA, 3rd down, penalties...) go under "Overall". Labels
      carry units ("Rush yds / game", "4-man rush success", "DAL shows it 53%").
    - **Keys** (`gsKeys`, user: "here's what you really need"): the 3 biggest graded matchups
      from both sides (`GS_KEYS_SHOWN`), tile = who has the advantage (team color), the matchup in
      plain words, the two grades. The regular starting QB ruled Out (same rule as the model) always takes the first tile. Sits below
      the matchups, above My Picks (the user's placement).
    - **My Picks** (`gsPickStrip`): one strip across the bottom, the three markets side by side.
      "Hide My Picks" hides the strip. The Novig QR block is off the card "for now" (user).
    Week 5: cards scale 93-98%, 0 labels cut off. The user's earlier rule still stands for new
    work: don't drop data to make it bigger; rearrange instead.
  - **GMG score model** (`nfl_tool/gmg_model.py` -> data.json `gmg_model[game_id]`, 2026-10-10;
    the user asked for predicted scores, then for its picks to be tracked "starting this week").
    - Each team's points = league average + three reads of its offense vs that defense (`BLEND`):
      ratings 40% (ESPN FPI off minus def), scoring 20% (opponent-adjusted points for / against,
      shrunk by 4 prior games), matchups 40% (offense z minus defense z for every graded piece:
      Passing .25, Trenches .15, Red Zone .13, Rushing .12, EPA/play .12, Blitz & Box .08, 3rd
      down .05, explosive .04, turnovers .03, sacks .02, penalties .01; 4.0 points per z).
      Home field 1.6. A starting QB ruled Out costs his team 3.5 points (`QB_OUT_POINTS`, the
      user's number) because the stats were built with him playing. Always opponent-adjusted.
    - **Which QB counts as "the starter"** (`_regular_qb` / `gsRegularQb`, fixed 2026-10-10):
      the QB with the most games as the team's lead passer (10+ attempts), ties to whoever led
      more recently; he's "out" if this week's injury report says Out or he's on IR. The first
      version took any QB with 40%+ snaps who was Out, and flagged Mariota (the fill-in) the week
      Jayden Daniels returned, docking WAS 3.5 points and showing "WAS without M. Mariota" in
      Keys. The model does not add points for a starter coming BACK; only ESPN's ratings see that.
    - It lives in the build, not the browser, so one number feeds the card, the record and the
      grading. The grade math in gmg_model.py mirrors game-overview.js (`compositeZ`,
      `schemeCompositeZ`, `SUMMARY_CATEGORIES`); **change a grade's recipe in both places**.
      Checked equal to the browser version on all 14 Week 5 games before the browser copy was removed.
    - **Picks:** every game gets a spread pick and a total pick (whichever side of Novig's line
      the model's score lands on) with an edge in points; 2.5+ (`EDGE_POINTS` / `GS_MODEL_EDGE`)
      is highlighted and tallied separately.
    - **Locked at kickoff:** this week's upcoming games are re-projected every build; once a
      game has started its entry is kept as the last build before kickoff left it (`frozen`) and
      graded against the line stored in it. A game that started with no earlier entry is never
      projected after the fact (TB @ DAL Week 5 shows "--"; tracking starts with Week 5's Sunday games).
    - **Where the record lives:** `previous_gmg_model` (build_stats.py) merges the live
      data.json's `gmg_model` with `model_history/gmg_model.json`, which deploy.yml commits (as
      github-actions[bot], needs `contents: write`) whenever a game locks or goes final. So
      expect small bot commits on main; `git pull --rebase` before pushing.
    - **Where it shows:** the green GMG model tile on the card (click it) and the "GMG Model
      record" toolbar button open the record popup (`renderModelRecord`, game-summary.js): four
      record tiles, then each week's games with model score, final, picks, edges and results.
    - **Your own weights (2026-10-11, the user's ask: "move and groove them"):** the small "i" on
      the model tile opens "How the model weighs things" (`openModelWeights`, game-summary.js):
      every weight is a slider in three groups (what goes into the score, matchup grades, point
      adjustments: home field, starting QB out, matchup impact), with a live table of the week's
      games (Market | GMG default | yours). Blend and matchup sliders are relative (share = value
      / group total). `gsModelCompute(game, w)` re-projects in the browser with the same math as
      gmg_model.py (equal to the build on GMG default weights; **keep the two in step**, including
      `GS_MODEL_BLEND / _MATCHUPS / _POINTS` bases vs the Python constants).
      - **Build Your Model view (2026-10-11):** a third view button on Game Previews, between
        Full Preview and Summary (`gsView` "model", `#section-model`). It's the same block as the
        popup (`renderModelWeights(page)`, one `.mw-root` each, everything found by class inside
        its own root) plus two extras: the week table adds the spread and total pick the current
        weights make (edge in points, 2.5+ highlighted), and the GMG Model record sits underneath.
        The card's "i" popup still works.
      - Presets: a "Using" dropdown (GMG default + saved sets), Save as new (named, max 12), Reset
        sliders, Delete. Moving a slider while on GMG default starts a preset called "My weights";
        slider moves save straight into the active preset. Stored in
        `nfl-tool.model-presets.v1` (`{active, presets:[{id,name,w}]}`), synced to the member's
        profile (in `SYNC_KEYS` and sync.js `KEYS`).
      - With a preset active the tile shows the preset's name and score, so a screenshot never
        passes custom weights off as "GMG model". Games that have kicked off, the record popup and
        the graded picks always use GMG default.
    - Weights were set from the season's first 65 finished games and marked down for being
      in-sample. **Not backtested on past seasons**: a talking point, never "beats the line".
  - The A–F grade boxes (`.gs-grade.tier-*`) use the same tinted fill + edge as the full
    preview's Team Grades cells (A/B green, C yellow, D/F red, A and F strongest), per the user
    2026-09-30. Keep the two in sync if either changes.
  - **Tags + Key Stat Edges (reworked 2026-10-01 after the user found real edges missing on
    PIT/CLE):** `gsMatchupTag(offZ, defZ)` in game-summary.js, both z's "good for its own side".
    Gap (off − def) >= 1.0 = Mismatch, <= −1.0 = Tough, so a bad offense vs an AVERAGE defense
    still flags (the old rule needed both sides past ±0.6 and hid PIT bad vs blitz, CLE sacks
    allowed, PIT's red zone). Both past ±0.4 the same way = Good vs Good / Bad vs Bad. Grade rows
    use the same tagger on their composite z.
    - Edges ranked by gap (or how far both lean for same-direction tags); since 2026-10-10 they
      are nested under the grade they back up (see Layout), not listed as a top 8.
    - Scheme looks count once the defense shows them >= 12% of the time; frequency only scales
      rank (0.7x-1.25x), never gates (the old "above-average frequency" gate dropped PIT vs a
      34% heavy box, the biggest edge in the game).
    - Candidates: General Stats rows (Production rows ranked 0.75x, since the Passing/Rushing
      grades already sum them), Penalty Yards (now included), scheme looks, and the Trenches
      parts (Pass pro vs rush, Run block vs run D). Turnovers show only as good vs bad (mostly
      random; never Bad vs Bad filler). Skipped: Plays/Game, quarter splits, the Red Zone
      composite (it has its own grade row).
  - "Scheme" is labeled "Blitz & Box" on the card.

### Full preview layout, recent games, box scores, paired rank popups

  - Game Previews General Stats & Scheme is two boxed matchups ("ATL Offense vs GB Defense"),
    each holding its stat table plus scheme and Team Grades. Grade letters are the same size as
    the numbers, and Heavy/Light Box values stay on one line.
  - Game Previews order: Injuries, Odds, **Recent Games**, General Stats & Scheme, Pick Tracker.
  - Box score popup (click a Recent Games row): `.box-score-grid` lays the tables out two-up,
    Passing | Rushing then Receiving | Defense, each filling its half (820px modal); one column
    on phones. The old single column of content-width tables left the right half empty.

  - Recent Games runs Week 1 first, with opponent logos, the closing spread and total from the
    schedule, and ATS (Covered/Missed/Push) and O/U results. Clicking a row opens the box score.
  - **League-rank popups are paired** (`openPairedRankModal` / `pairedRankPartner` in common.js):
    - Clicking any number in an OFF/DEF matchup row shows TEAM | offense value | defense value |
      TEAM. Each column is sorted on its own, with equal-width halves.
    - This matchup's offense is highlighted on the left and its defense on the right.
    - The partner is the opposite side's cell in the matching column, learned from a complete row
      of the same table, so a blank "--" never mis-pairs.
    - Cells with `noPair` (e.g. scheme Tendency %) or no real counterpart open the single list.
    - Team Grades use `openPairedGradeModal`; Red Zone's Trips/TDs/FGs/Avg columns appear on both halves.
  - New UI should reuse these patterns rather than add a new look.

## TD Data

- **2026-10-12, the TD Summary card was simplified like the Game Summary.** It had been a wall of
  tiles: each team got whichever TD targets, matchup tags and First TD tiles fired, so the two
  columns never matched and the section labels did not separate anything. The user: "so much
  data and it's overwhelming", "first tds - didn't see it because it blended in". Now the
  banners are followed by four sections under solid header bars, and TD Targets is one tape of
  the same 7 rows for both teams with league ranks. Distance targets, RZ finish and the position
  first-TD tiles left the card. Same day: QBs who don't run no longer count as TD options
  (Stafford kept appearing off one sneak TD and his red-zone sneaks).

### TD targets, First TD model, Soft D, Weak spot, TD Summary layout, no DST

- The TD Data page is considered solid; change it only when asked.
  - **TD Summary targets (app.js `modelEntry`), changed 2026-10-02 at the user's request:** a
    target still needs offense >= −0.3 and defense >= −0.5, plus a combined score >= 0.6, OR one
    clearly extreme side (`MODEL_TARGET_SOLO_Z` = 1.0) carrying it on its own. Trigger: IND
    allowing 70% of its TDs (2.3/g) from <=10 yds averaged out vs a near-average WAS offense
    and never showed. This added ~7 targets across 32 team-sides in Week 4 (2.3 -> 2.5 per side).
    Distance target rows show per game plus share of all TDs ("2.33 · 70%", unit "TDs/g · % of TDs").
  - **Distance concentration (2026-10-02, TEN @ BAL):** BAL allows 75% of its TDs from <=10 yds
    and TEN scores 75% of its own there, but per-game volume was ordinary on both sides, so the
    volume model missed it. `shareTargetEntry` (app.js): if a bucket fails on volume, it can still
    qualify on share-of-TDs z (one side >= 0.75, the other >= 0, each with 4+ TDs). It added 8
    targets across 32 sides in Week 4.
  - **First TD target must agree with the First TD section:** it only shows for an offense whose
    `firstTdChanceFor` (same model as the First TD bar) is >= 50%. TEN was a "First TD" target
    while the bar said BAL 60%; the user called that confusing. 0 conflicts across Week 4 after.
  - **First TD player picks (`firstTdPlayerTargets`, reworked 2026-10-02):** the user wants the
    whole offense's usage, not "who has scored before". Share of the team's first-TD chance =
    `FIRST_TD_W`: 30% full-field touches (targets + carries), 25% red zone opportunities
    (RZ targets + carries), 25% expected TDs, 20% early-game xTD. TDs scored carry 0 weight
    (was 15%). RZ and xTD shares are pulled toward the player's touch share until the team piles
    up `FIRST_TD_RZ_PRIOR` RZ looks / `FIRST_TD_XTD_PRIOR` xTD, so 3-5 end-zone looks or one
    goal-line game can't top a team. TEN went from Ayomanor 9.4% (9 targets), Ward 7.7% to
    Pollard 9.0% (45 touches, 8 RZ), Ayomanor 6.6%, Ward 5.1%.
    - **Recalibrated the same day (user: "Stafford 6.7% to score first? insane"):** weights now
      15% touches / 30% RZ opps / 40% xTD / 15% early (xTD and RZ price WHERE a touch happens);
      `FIRST_TD_SHARE_FLATTEN` 0.65 -> 0.9 (the strong flatten inflated fringe players and squeezed
      RB1s); opponent position factor capped at z ±1 and only with `FIRST_TD_DEF_MIN_TDS` = 3+ TDs
      allowed to that position (PHI's QB-allowed z +2.8 on 1-2 plays was a x1.77 boost); QBs
      x mobility^1.5, mobility = min(1, max(carries/g ÷ 6, rush yds/g ÷ 30)) (`FIRST_TD_QB_RUNNER`, `FIRST_TD_QB_RUN_YDS`; yards added at the user's request so Purdy, 3.3 car/g but 31 yds/g, counts as mobile: 1.1% -> 2.6%). Result: Stafford 6.6% -> 1.4%, pocket QBs
      0.3-1.4%, Allen 12.3%; model position totals RB 43 / WR 36 / TE 16 / QB 4.5 vs actual 39 / 37 /
      17 / 6.5. Calibration check: sum the model's first-TD % by position across a full slate and
      compare with the season's actual first-TD scorers by position.
    - **QB change + market prior (2026-10-05, user: "Drake London has higher than a 3% chance"):**
      London had 19 targets but 0 RZ looks, so Hooper's single end-zone target outranked him, and
      his 4-5 target games came with Rush/Strand before Penix returned (10 of Penix's 25 throws).
      (1) `lineupAdjustedXtd(team, week, { qbStarter })`: a WR/TE game thrown by someone other
      than `currentStarterQb` counts `LINEUP_QB_CHANGE_WEIGHT` 0.5 (First TD model only). (2) Each
      player's share blends in his share of the team's ANYTIME TD odds with weight
      `FIRST_TD_MARKET_PRIOR_GAMES` 2 / (2 + games): ~40% after 3 games, the user's pick over 50%
      ("keep 40 for now"). Anytime is a different market from the First TD odds the model is
      compared to. ATL: London 3.4% -> 5.5% (odds 10%), Hooper 4.1 -> 4.3, Bijan 24.5 -> 19.6.
  - **"Soft D" targets (2026-10-02, NE @ BUF):** a clearly soft defense (model z >= 1.0) flags even
    when the offense hasn't produced there (offense floor relaxed to −1.5 instead of −0.3). BUF had
    allowed 5 RB TDs (3rd most) while NE's backs had 1 against SEA/PIT/JAX. These are marked
    `defLed`: dashed chip + red "SOFT D" tag + tooltip, never shown as "strong", and both numbers
    stay in the row. Only for `MODEL_SOFT_METRICS` (QB/RB/WR/TE, rush/pass, <=10 yds; the longer
    buckets and First TD swing on 2-3 plays) and at most `MODEL_SOFT_MAX` = 2 per team side,
    softest first. Week 4: 12 across 32 sides.
  - **"Weak spot" matchup tag (2026-10-02, NE D):** `defenseWeakSpot` (app.js): for a defense that's
    good at stopping TDs overall (TD/g allowed z >= 0.4, 4+ TDs allowed), the skill position whose
    share of TDs allowed is clearly above that position's league share (z >= 0.75, 2+ TDs). It
    reads like "while NE is solid overall, if it has a weakness it's WRs". Shown regardless of
    the offense's usage (the user wants the tendency visible), but the line prints the offense's
    own share of TDs at that position, so both sides are on the card. Key players: that
    position's top usage players. Week 4: 9 tags across 32 sides.
  - **TD Summary layout (facelift 2026-10-09, built from the user's notes over 6 mockups):** like the
    Props card, one full-height column per team (`.td-team`, rows aligned across the two columns
    with subgrid -- the user likes them lined up) plus the TD Odds picks as a 250px right rail.
    The rail's team headers use the same team-color fill + left stripe as the column banners
    (Props Summary's Prop Picks rail too).
    Each column, top to bottom:
    - **Header** (`summaryTdTeamBanner`): team color block with name/logo and a one-line fact strip:
      Implied TDs (implied points from Novig spread + total, / 7), Top TD position (biggest share of
      the team's TDs), and photos of the team's **top 3 TD scorers** (`topTdScorers`).
      - Each photo has a green bubble on its bottom-right with that player's season TD count.
      - Counts are rushing + receiving TDs, so a QB counts only his own runs. They are real season
        counts from player_xtd, not the lineup-weighted ones.
      - Players ruled out this week are skipped. Ties are broken by expected TDs per game.
      - This used to show the top 2 key players. The user saw Burrow there with one TD, because QB
        matchup tags made him a key player.
    - **TD Targets** as tiles: chip label centered on top, two big shaded boxes (team | opp allows),
      share % small under distance values. No units, no numbered bubbles; the First TD target is
      left out (it's the First TD section's Scored 1st tile).
    - **Matchup Tags** as tiles in the same style (`summaryTagTile`): each " · " part of the tag's
      line becomes a box, the first number pulled out big ("TB 3.4 RZ trips/g"); a number followed
      by "+" stays in the label ("7+ box"); boxes tinted green (tag helps the offense) / yellow
      (works against it). "(lg x)" league notes are dropped on the card (user: no small gray text).
    - **First TD** (`summaryFirstTdBlock`): the big 1st TD chance box (this game), then First TD tab
      stats as tiles: Scored 1st (season rate vs allowed), the First TD tab's flagged position
      shares, RZ finish before the first TD. **No model player list** (user: "stop with the first td
      model player crap").
    - **Key Players** at the bottom, centered, with ★ = how many of the team's targets/tags the
      player fits (replaced the numbered badges).
    Leftover tiles in a row are centered under the row above (flex, not grid). Only `.sc-main`
    grows (`.sc-zoom-target`); the fit check also watches tiles and boxes for overflow. Week 5: 8 of
    15 games grow 1.0-1.25x, 7 dense ones shrink to 0.86-0.96 (still bigger type than the old card),
    0 overflow. Colliding short names (Bijan / Brian Robinson) show in full (`uniqueShortNames`).
  - **No DST targets anywhere (user 2026-10-02; TD Targets panel too since 2026-10-05):**
    defensive/return TDs are random and not bet, so `targetGroups` (app.js) drops DST items for
    both the TD Targets panel and the Summary card (First TD position targets already skipped
    DST). The DST stat rows in the TD Data tables stay; they're data, not a target.

## Player Props

### The player card

  - `player-card.js`: **the player card**, the ONE popup for every player name or photo on every
    page. Anything wrapped with `playerClick(team, name, inner?, oppTeam?)` (or `.player-click` +
    `data-entry {team, name, oppTeam}`) opens it.
    - **Odds tab:** every prop line plus Anytime and First TD, with Possible Plays checkboxes, and
      "+ Summary" on the Player Props page.
    - **Game Log tab:** weekly versions of the Receiving / Rushing / Passing table stats (snap %,
      target share, ADOT, YAC/rec, depth buckets, 10+ runs, RZ looks), each column shaded against
      the player's own weeks, with an Avg row.
    - **Rush/Catch Lanes tab:** RB/QB rushing first, WR/TE catch zones first.
    - The file also holds the rush-lane and pass-zone drawing code (moved out of player-props.js),
      so every page can draw them.
    - Injury lists and box scores link skill positions only (`SKILL_POSITIONS`).
    - **Any new place that shows a player must use playerClick.**

### Zone Targets, packages scored per direction, the audit habit

- **Zone Targets** (`zoneTargets` / `renderZoneTargets` in props-summary.js): pass catchers whose targets land where the defense is soft.
  - **Downfield exception (2026-10-02, Lamb vs HOU):** a player's zone fit is a target-weighted
    blend, so a receiver split half short (where the D is tough) and half downfield (where it's
    very soft) averaged out under `ZT_MATCH_MIN` and was dropped before the deep markets ran
    (Lamb: 0.19 blended, +1.08 downfield, HOU 5th-most explosive passes). A strong downfield fit
    (>= 40% of targets intermediate/deep, those zones >= +0.8 soft, opportunity percentile >= 0.6)
    now bypasses the blended cut, adds Rec Yds, and ranks on max(blend, downfield fit). The
    blended cut still filters everything else; Week 4 changed only Lamb (28 -> 29 targets).
    Made two-way the same day after an audit: a strong SHORT fit (>= 40% short/screen, >= +0.8
    soft) also bypasses the cut (Nico Collins vs DAL: short +1.18, deep tough, blend 0.24).
- **Props Summary packages are scored per direction (audit 2026-10-02):** `propPackages` used to
  average every market in a package into one lean, then cut below 0.1, so a strong Target market
  and a strong Fade market cancelled out (MIA vs MIN: Long Rec +0.81 vs Completions −0.81 ->
  nothing). Now each direction is judged on its own markets: a package can show a Target and a
  Fade on DIFFERENT markets (card splits by `dir`). The betting-market blocks (implied total
  <= 18.5 no targets / >= 25.5 no fades; 7+ point spread for RB rushing) are unchanged and
  intentional. Exception (user 2026-10-02): **Long Comp / Long Rec targets ignore the low-total block**
  (`PROP_LONG_MARKETS`): a low total means trailing, trailing teams take more deep shots, and a
  leading defense in a soft shell gives up catch-and-run long plays. Yards/receptions targets stay
  blocked at low totals; fades at high totals unchanged. An audit of Week 4 after the fix: 0 strong clean markets cut except by those blocks.
- **Audit habit (the user asked how to be sure nothing else is gapping the algorithm):** any rule
  that blends parts into one score and then cuts on it can hide one strong part. Before shipping
  a new selection rule, list every candidate with its parts for a real week and check that no
  strong single part (zone, market, side) is dropped except by an intentional block.
  - **Zone softness** is 50% the zone's own completion % and EPA allowed (shrunk with 8 prior attempts) plus how often it's attacked, and 50% the opponent-adjusted depth band from `prop_matchup_model`.
  - **Player opportunity:** lineup-aware targets per game as a percentile at his position (70%) plus recent snap share (30%).
  - **Markets:** Receptions (volume into soft short zones), Long Rec (10+ yd share into soft zones, defense gives up 20+ plays), Rec Yds (overall match plus volume); YAC is a bonus tag.
  - **Where it shows:** a panel under each Pass D Allowed grid; on the Props Summary card, flagged players list first with a ★ in receiving packages.

### Props Summary: directional, clickable tags, garbage-time tag

- **Props Summary is directional, not a pick sheet** (the user's call on 2026-09-28):
  - It's a Target / Fade list of *packages*: a team position group plus betting markets
    plus its players' lines (e.g. "PHI WRs · Rec Yds · Long Rec → Smith, Wicks, Lemon").
  - Only real betting markets: no YPA, INTs or sacks.
  - Each package must agree with the betting market (spread for RB rushing, implied team
    total otherwise).
  - Rank tags list offense first, shaded red → yellow → green by how good the rank is for
    that unit.
  - No projections, "model edge" numbers or model-picked players anywhere. The user
    draws the conclusions and adds players to the Prop Picks rail themselves.
  - **Clickable tags (2026-10-03):** every rank tag and garbage-time chip on a package opens a
    game-by-game popup (`openPropTagModal(team, side, metric)`): each game's number, the players
    behind it (playerClick), the opponent's usual in its OTHER games and +/- (colored from the
    tagged unit's side), flags (weather, backup QB, garbage %), and an Avg row with a one-line
    "offenses it faced got +X vs their usual" verdict. The user's ask: "did DAL just face running
    QBs, or can anyone run on them?" Rows come from `prop_matchup_model.games` (per game side:
    `v` counts, `gt` garbage part, `bq` backup QB, `wx` bad weather, `p` players with
    `pass [att,cmp,yds,td]`, `rec [tgt,rec,yds,20+,deep yds,deep tgt]`, `rush [car,yds,10+]`,
    roster position), the same counts the rank is built from. Usual = plain average, unweighted.
    Columns spell out whose numbers they are ("vs BUF D | HOU TEs | That D allows other teams")
    after the user misread an offense popup as the opponent's players.
    An **Up next** row under Avg shows the card's opponent and only its usual (other cells
    blank, per the user), so it lines up against past opponents; it's skipped once that game
    is played.
  - **Hide Prop Picks toggle (2026-10-03):** Target / Fade fill the card and zoom 1.15-1.6x.
    It's the shared picks-column toggle below (kind `props`).
  - **Garbage-time tag (2026-10-03, tag only by the user's choice):** a Target's reason stat
    gets a neutral gray dashed chip ("JAX D 44% garbage time") when 30%+ of it came with the
    offense under 10% to win (`PROP_GARBAGE_TAG`; league average ~12%). Hover explains it.
    The numbers themselves are NOT discounted: the user pointed out a team that keeps building
    leads keeps facing comeback throwing, so the spread decides how much it matters. Data:
    `prop_matchup_model.teams[t][side][metric].gt` (passing counts only) and `.gt_median`
    (the league mean, despite the name). Found when JAX D read "2nd-most WR yds" while every
    other page showed an elite pass D (44% of those yards came in blowouts).

### Passing tab QB cards

  - **Passing tab = one QB card per team** (`renderQbCards`), in this order:
    1. Header: photo, name, games and attempts.
    2. Eight equal season tiles (Att/G, Cmp%, Yds/G, Y/A, TD/G, INT/G, EPA/Att, ADOT), colored vs
       every QB and clickable for the QB list. Y/A and TD/G are derived from game logs by `enrichQbRows`.
    3. His posted lines.
    4. A 2×2 of equal boxes: vs OPP pass D (QB vs defense-allowed, with a two-sided Edge),
       Pressure, QB rushing, Red zone.
    5. Recent weeks, shaded against his own games.
    The Show backup QBs toggle stacks a second card.

### Pass-zone grids, receiving table, zone popup, zone matchup panel, game script

- Player Props pass-zone grids (Pass D Allowed / Passing Offense) use the summary-card look: rounded zone tiles, big share numbers, header/row shares as big red→green numbers with fill bars (no small % tags), stat tiles underneath. The offense per-player mini grids sit 3 cards per row with uniform row heights.
- **Receiving table:**
  - The 7 core columns get a very light green/red wash ranked against the player's own teammates
    in that table.
  - The 4 depth columns sit under a boxed "Target depth" group label. Their colors compare each
    player to every pass-catcher in the league, so leave them as-is.

- **Zone popup** (`renderPassZoneModalContent`):
  - Opened by clicking a cell in any team grid, the QB grid, or a receiver grid. A receiver grid
    opens the popup filtered to that player (`receiver` in the payload).
  - It shows:
    - summary tiles: throws, catches/%, yards per catch, YAC share, EPA per throw, 20+ plays;
    - league rank by volume;
    - who got targeted, most first, with catch %, YAC/rec and longest;
    - on offense, **"OPP Defense Here"**:
      - Throws faced/game, Comp %, Yards/throw, YAC/catch and EPA/throw allowed, each next to the
        league average.
      - Colored from the defense's side vs the league, using values shrunk by 8 prior throws (4 for YAC).
      - A one-line **Top X% / Bottom X% / Neutral matchup** blurb and a Soft spot / Average / Holds up
        pill. Both come from the league ranking of `ztDefenseSoftness` (thirds, or the same 0.5 line
        Zone Targets uses), so they always agree with each other and with the Zone Targets chips;
    - every throw grouped by player, newest first, with opponent, air yards, YAC and EPA.
  - QB grid cells show comp/att plus yards · YAC.
- **Zone matchup panel** (`renderZoneMatchupPanel`, beside the QB grid; wraps below it on narrow screens):
  - One row per depth (20+ / 10-19 / 0-9 / SCR, its 3 zones combined) and per side (L / M / R, its
    4 depths combined).
  - Each row shows share of the offense's throws, then Catch%, Yds/throw, YAC/catch and EPA/throw as
    offense-vs-defense-allowed pairs, colored vs the league from each unit's side, plus a
    Top X% / Bottom X% / Neutral / Mixed chip.
  - Grades weight EPA 0.35, Y/T 0.25, success 0.2, catch 0.1, YAC 0.1, shrunk by 10 prior throws.
    The % is this pairing's rank among every offense × defense pairing for that group.
  - **"Mixed"** means one side is clearly good and the other clearly bad (the two-sided rule).
- **Overall read** (`renderZoneMatchupRead`) under the lead-zone tiles: an overall passing matchup
  (depth grades weighted by the offense's throw share), plus the Best spot and Toughest spot among
  groups with at least 10% of throws.
- **Game script:** build_stats flags each throw `gt` when win probability is under 10% or over 90%
  (`GARBAGE_WP`), and records `s` for play success. Garbage-time throws count **half** in these
  grades, and the grades use only per-throw efficiency, never volume, which game script inflates.
- The page max width is 1840px (was 1600), so wide monitors fit the panel beside the grid.
- Player Props page extras:
  - The **Pick props** list is grouped Passing / Rushing / Receiving / Other, then by player.
  - Each player has an **Out?** switch for late news the injury report misses.

## Possible Plays, picks and promos

### View Results, Photo Export, loose TD name match

  - `possible-plays.js` **View Results** (2026-10-06): checkboxes on each bet, a select-all box, and
    "Select by game" chips; when any shown bet is checked, the summary covers only the checked ones
    ("Summary of N selected bets" + Clear selection). In-memory per visit (`resultsSelected`). The
    user wanted to recap just MNF.
  - `possible-plays.js` **Photo Export** (2026-10-10): a "📷 Photo Export" button beside View Results
    opens a box with week buttons, a checkbox per category (TD categories pre-checked), a Columns
    choice (Auto / 1-4) and **Save image**. The image (`#plays-export-card`, `.pe-*` styles) is just
    team logo, play, odds, grouped under category bars and flowed into columns so everything fits
    one picture (64 TD plays = 4 columns, about 1070x600). If plays are checked in the list, an
    "Only the N plays I checked" box appears, pre-checked. The user's Discord wanted all TD plays
    in one image instead of a stack of screenshots.
  - **TD bets grade on a loose name match** (`gradeTdPlay`, `normName`, 2026-10-06): bets keep the
    sportsbook's spelling ("Brian Robinson Jr.") while TD results use nflverse's ("Brian Robinson");
    an exact match graded his MNF TD a loss. Already-graded auto losses flip to wins on next load.

### One spelling per player in the odds

  - **One spelling per player in the odds (2026-10-11):** books disagree ("Brian Robinson Jr." on
    SGO, "Brian Robinson" on Novig and nflverse) and a row's book can change between builds, so
    a name flipped, the saved play's checkbox stopped matching, and saving it again listed him
    twice in Possible Plays / Photo Export. Two fixes: `canonicalize_odds_names` (build_stats.py,
    runs last) rewrites every TD / prop odds row to the site's own spelling (team game logs,
    then unique roster / headshot names; 36 rows changed the first run), and saved plays are
    matched by `possiblePlayKey` (common.js: the id without Jr./Sr./II-IV and punctuation), with
    `dedupePossiblePlays` merging existing doubles on page load (newest kept).

### Promo Tools: King of the Endzone

  - `promo-tools.html/.js`: **Promo Tools** tab (added 2026-10-05). First section: **King of the
    Endzone** (DraftKings' weekly promo paying on the game's LONGEST TD, D/ST included).
    - Team checklist for this week's games (per-device, `nfl-tool.koe.teams`), position filter.
    - Player table: TDs (count / avg / long), TDs by distance (1-10, 11-20, 21-40, 41+), big
      plays (20+/g, 40+ count, longest play), role (touches/g, 20+ runs / catches, ADOT for
      WR/TE only, deep targets/g), and this week's defense (20+ plays allowed/g matched to runs
      or catches by the player's mix, 20+ TDs allowed, avg TD length allowed). Colors vs the
      whole league. Ruled-out players hidden; QBs = current starter only.
    - **Upside** = league percentile of weighted z's (`KOE_UPSIDE_PARTS`: 20+ plays 35%, 40+
      plays 15%, deep role 15%, TD length 10%, opponent big plays allowed 25%), rates shrunk by
      `KOE_PRIOR_GAMES` 2. First-guess weights; the user said "we can adjust if needed".
    - Layout (user 2026-10-05): each column group has a colored header bubble spanning its columns
      (`KOE_GROUP_CLASS`, `.koe-g-*` colors), empty 8px gap columns split the groups, and every
      stat box is a fixed 44px (TD distances 38px; `table-layout: fixed`, colgroup), rows 32px; the player column (214px) has photo, name, team logo and position on one line. No Opp column (obvious from the matchup). Table ~1130px so it screenshots easily; **Save image** (`saveKoeImage`) downloads `#koe-capture` as a PNG with a GMG title naming the games and week.
    - D/ST table: return TDs (INT / FUM / KR / PR with yards), takeaways/g, opponent giveaways/g,
      D/ST TDs the opponent has allowed. No Upside score for D/ST yet.
    - Data: `build_stats.py compute_koe` -> `DATA.koe` (players per team, team big plays allowed,
      `dst_tds` / `dst_tds_allowed`; return TD length = `return_yards`, else
      `fumble_recovery_1_yards`).

### Pick Tracker

- **Pick Tracker** grades each pick on the price saved at pick time, which is Novig's when
  available.
  - **Your Record week filter (2026-09-30):** checkbox chips above the record, "All weeks" plus one
    chip per week that has picks (shows whenever there are picks, even one week, so it's discoverable). Check any mix of weeks to see
    just those; none checked = all weeks. Recent Picks stays unfiltered. The selection is a
    per-device view preference in localStorage (`nfl-tool.picks.weekFilter`), not synced to the
    profile. Old picks without a `week` fall back to their game's week in the schedule.


## Members and hosting

- **2026-10-14, each sport got its own address.** The user: "the site is currently routing to
  nfl.gmgsports.org. Can we fix it so the NHL, NBA and NFL all have different urls", offering
  gmgsports.org/nfl or /nhl as an alternative. Paths on gmgsports.org were ruled out: that's the
  hub on GitHub Pages, and putting the suite under it would mean moving the whole domain's
  nameservers to Cloudflare (which would also take over Namecheap's email forwarding).
  Subdomains need only one CNAME each at Namecheap. The files were left in their folders, so
  local testing and the build's data reads didn't change: the middleware maps each address to
  its folder. The session cookie went domain-wide so members sign in once, and Discord sign-in
  stays on nfl.gmgsports.org so no new callback had to be registered with Discord.
- **2026-10-13, the deploy got a gate and lost its public copy.** A friend of the user's reviewed
  the project and worried about its foundations. Two things stood out for a product people now
  pay for: the site check only ran AFTER a change was live, and the GitHub Pages copy plus the
  public repo let anyone read the site and its code without the login. The check now runs
  before publishing and blocks a broken site; GitHub Pages was dropped from the deploy; a public
  `version.json` replaced reading the Actions page to confirm a deploy.

### Support tab

  - `support.html`: **Support** tab (added 2026-10-09, last in the nav after Promo Tools). Shows the
    user's socials (pill buttons) and codes/tools cards in the gmgsports.org hub look (Black, ALL
    CAPS, gold copy-code buttons, green "Free trial" badges). It fetches
    `https://gmgsports.org/links.json` live (CORS allows it; logo paths get the hub prefix), so to
    change a link, code or blurb edit `links.json` in the hub repo (josh-conley/gmg-site), not here.
    The hub's "suite" section is skipped. Novig offer is **$50** in trade credits for a $10 deposit
    (also hardcoded in `game-summary.js` and `game-overview.html` Novig panels).

### Member profiles (sync.js)

  - `sync.js`: **member profiles**. It mirrors saved plays, picks, notes, summary rails and manual Outs to the logged-in Discord member's profile (`/api/state`, Cloudflare D1), so they follow them to any device. (Replaced the owner-only Firebase sync on 2026-09-28.)

### Hosting, login gate, Stripe email members, profiles, feature requests

### Hosting (moving to Cloudflare, started 2026-09-28)

- **[corrected]** `nfl.gmgsports.org` now points at Cloudflare Pages (`gmg-nfl.pages.dev`); it used to be a
  CNAME to GitHub Pages (`greenmeansgobetting.github.io`), which still gets a copy of every deploy.
  The domain is at **Namecheap**, which also runs email forwarding (MX `eforward*.registrar-servers.com`).
  **Don't move the whole domain's nameservers**; only the `nfl` record changes.
- **deploy.yml** also publishes the same built folder to **Cloudflare Pages** project `gmg-nfl`
  (test address `*.pages.dev`), using the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  Those steps are `continue-on-error`, so they never block the GitHub Pages deploy.
- `.github/workflows/cloudflare-domain.yml` attached `nfl.gmgsports.org` to the Pages project
  through the API. It can be re-run from the Actions tab and prints the verification status.
  (The Cloudflare connector for Claude can't manage Pages domains; the GitHub secret token can.)
- **Plan, one step at a time** (**[corrected]** steps 1, 2 and 5 are done; kept for the record):
  1. Cloudflare copy verified, then switch the `nfl` CNAME at Namecheap to the pages.dev address.
  2. Discord login gate (Pages Functions). A bot checks the member's **current** roles
     server-side on every visit (short session, re-checked every ~15–30 min), so cancelling
     or losing a role cuts access. data.json is gated too.
  3. Free vs Supporter roles.
  4. Sell the role (Discord Server Subscriptions / Patreon / Whop).
  5. ~~Optional Patreon/Whop login~~ -> **Email + Stripe membership for people without Discord**
     (built 2026-10-08; **[corrected]** LIVE since 2026-10-09: live prices and the `sk_live_` key are in). Some people would pay
     but won't join Discord, and the user wants low fees on $5/month, so: direct Stripe.
     - **How it works (password version):** the user refused the email-service (Resend + Namecheap
       DNS) and webhook setup as too much work, so: Join -> Stripe Checkout -> signed in -> picks a
       password; later sign-ins are **email + password**; the gate asks Stripe for the member's
       subscription every RECHECK_MS (no webhook needed); failed payment / cancel = no access (same
       live rule as Discord roles). Only secret needed: `STRIPE_SECRET_KEY`. Discord login keeps
       working alongside it.
     - Code: `nfl_tool/functions/_middleware.js` "Email members (Stripe)" block. Routes `/join`,
       `POST /stripe/checkout` (subscription, `trial_period_days` 7 unless the email had a trial,
       `payment_method_collection` always, promo codes allowed, email in metadata), `/join/done`
       (confirms with Stripe, saves the member, one-trial-per-card check via the `trial_cards`
       fingerprint -> `trial_end=now`, signs in, sends to `/set-password`), `/auth/email`
       (email + password; same reply for unknown email or wrong password; 5 misses = 15-min lock),
       `/set-password` (8+ chars; also the "Password" link in the account chip), `/account` (Stripe
       billing portal), `/admin/members` (owner-only: grant access until a date for Zelle/Venmo
       payers; reset a password -> shows a temporary one to send them). An optional
       `POST /stripe/webhook` works if `STRIPE_WEBHOOK_SECRET` is ever added. Passwords:
       PBKDF2-SHA256, 100k iterations, random salt. Sessions `kind: "email"`, uid
       `email:<address>`; an email member with no password is redirected to `/set-password`.
       Turns on when `STRIPE_SECRET_KEY` + DB exist; with an `sk_test_` key only the owner (signed
       in with Discord) can check out and the login page hides Join. D1 tables `members` (+ `pw`,
       `fail_count`, `lock_until`, added by ALTERs in deploy.yml) and `trial_cards`. Tested in the
       browser (no Node on this PC) with sql.js standing in for D1 and a fake Stripe: 34 checks.
     - **Free trial (user 2026-10-08):** 7 days, card or bank required, $0 until it ends (Stripe's
       reminder email before the first charge is on in the dashboard), one trial per email and per
       card. Optional promo codes for video viewers via Stripe coupons.
     - **Prices (`STRIPE_PRICE_IDS`, not secret):** test monthly $5 = `price_1UOKQhLM3ebsVWbZWbCfXE9X`,
       test yearly $45 = `price_1UOKQhLM3ebsVWbZrn3B6uGt`; live monthly $5 = `price_1UOg8YLM3ebsVWbZZQXVqT3q`,
       live yearly $45 = `price_1UOg99LM3ebsVWbZZwm7LMCD` (added 2026-10-09; live account activated).
       The key in use (sk_test_ / sk_live_) picks the set, and Join stays closed in a mode with blank
       IDs, so the GitHub key can be swapped in any order. A subscription Stripe doesn't know
       (`resource_missing`, e.g. test members after going live) marks that member canceled.
     - **One sign-in screen (redone 2026-10-09 to the user's wording):**
       - Header: the real GMG logo (`site/brand/gmg-logo.png`, served publicly through the `/brand/`
         bypass in the middleware) and **"GMG Sports Data Suite"**. The brand isn't NFL-only; NBA is
         coming.
       - `accessPage`, left box **"Join with Discord"**: "For $5 a month, get access to the site and
         Discord server.", a **Join now** button (INVITE_URL, Buildr) and **Log in with Discord**.
       - Right box **"Hate Discord? No problem"**: "7-day free trial, then $5 a month or $45 a year.
         Access to the entire site.", the email box, the two trial plan buttons, and a small "Already
         joined with email? Sign in" link to `/auth/email`.
       - `/auth/email` is its own page (`emailPage`): email + password form, and where every email
         sign-in error lands.
       - The "forgot your password" line was removed at the user's request (the owner can still
         reset passwords at `/admin/members`).
       - Stacks under 720px. When Join is closed (test mode for non-owners), the right box says email
         memberships are coming soon.
       - All text on these pages is ALL CAPS (`page()` CSS, buttons included), like the
         gmgsports.org style. Typed input values and tables stay as written.
     - Fees (approx., verify current rates): card ~2.9% + 30c + ~0.7% Billing = ~49c of $5; ACH
       ~8c. The flat 30c is what hurts, which is why there's a yearly plan.
     - **[corrected]** How it went live (done 2026-10-09): in Stripe's live mode, (1) activate the account, (2) copy the product to live
       mode (or recreate the $5/month and $45/year prices) and send the two live `price_` IDs ->
       `STRIPE_PRICE_IDS.live`, (3) redo the live-mode settings that don't carry over (payment methods
       incl. ACH, customer portal, trial-reminder / failed-payment emails), (4) replace the GitHub
       secret `STRIPE_SECRET_KEY` with the `sk_live_` key. The trial panel then opened to everyone.
- The user wants access tied to live roles; someone who paid a week must not keep access after cancelling.
- **Gate code:** `nfl_tool/functions/_middleware.js` (Pages Functions; deploy.yml deploys from `nfl_tool/`
  so the functions get bundled). It holds the config constants: GUILD_ID `1295760852892385290`,
  CLIENT_ID, ALLOWED_ROLE_IDS (`1471877733868109937`, `1471880013824393266`) and INVITE_URL (`https://gmgsports.buildr.bet/`).
  - The secrets `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` live in GitHub secrets and are copied
    into the Pages project by deploy.yml before each Cloudflare deploy.
  - The gate stays **off** (site open) until CLIENT_ID (`1554268816521957447`), roles and both secrets exist.
  - **ENFORCE = true since 2026-09-28: the gate is ON.** `false` is test mode (site open;
    `/auth/login` plus `/auth/check` show whether an account would get in).
  - **The build gets through the gate:** `fetch_previous_odds_snapshot` sends
    `X-GMG-Build: HMAC-SHA256(bot token, "gmg-build-v1")`, and deploy.yml passes `DISCORD_BOT_TOKEN`
    to the build step. Push builds rely on this to reuse SGO odds.
  - Bot invite: `https://discord.com/oauth2/authorize?client_id=1554268816521957447&scope=bot&permissions=0&guild_id=1295760852892385290`.
  - `https://nfl.gmgsports.org/auth/status` shows which pieces are in place, never the values.
  - Roles are re-checked with the bot every 15 min. Sessions last 30 days. If Discord's API is down,
    access is honored for 2 h after the last good check.
  - OAuth scope is `identify` only; redirect URI `<origin>/auth/callback`.
  - The session HMAC key is derived from the bot token, so rotating the token logs everyone out.
  - **Member profiles:**
    - `/api/state` in the middleware (GET all, PUT one key; newest `updated` wins) is backed by the D1
      database `gmg-nfl-users` (table `user_state(uid,k,v,updated)`), bound as `DB`.
    - deploy.yml creates the database and table and writes `nfl_tool/wrangler.toml` in CI, so the
      token needs **D1 Edit** as well as Pages Edit.
    - `site/sync.js` keeps localStorage as the working copy. It pulls on load and on tab focus,
      pushes each save debounced, and on first contact merges pre-profile local data (lists by id,
      objects by key) instead of overwriting it.
    - Synced keys are listed in both `SYNC_KEYS` (middleware) and `KEYS` (sync.js). **Add new
      per-user data to both**, and call `window.NFLSync?.push(key, value)` in its save function.
    - Display prefs (theme, views, selected game) stay per-device.
  - **Owner-only controls:** `OWNER_IDS` (the user's Discord ID `613105360286253076`) makes `/api/state`
    return `user.owner`. sync.js then adds `html.is-owner`, and the **Update Odds** button (which runs
    the GitHub build) is shown only then, plus on localhost.
  - **Request a feature (added 2026-10-09):**
    - sync.js adds a yellow "💡 Request a feature" button just left of the account chip (logged-in
      members only; icon-only on phones).
    - It opens a box titled "Have an idea for a tool, data point, or feature? I will do my best to
      get it added!". The idea is POSTed to `/api/requests` and saved in the D1 table
      `feature_requests` (created by deploy.yml).
    - Limits: 1000 characters per idea and 10 ideas per member per day.
    - The owner's button reads "Feature requests" instead. It lists every idea newest first (name,
      date), with Mark added / Undo / Delete (a PATCH; delete is soft, status `deleted`) and
      "+ Add my own idea".
    - Members can never read others' ideas.
  - Known bypass until fixed: the GitHub Pages copy still serves the site to anyone who hits
    GitHub's IPs directly, and the repo is public. Turn off GitHub Pages and make the repo
    private once the gate is confirmed.


### Build minutes: the hockey-only refresh and a deploy that does only what changed (2026-10-13)

- **How it came up.** The user asked how often lineups could be checked. The answer was that
  each check was a full rebuild, on a repo that had gone private that same day (2,000 free build
  minutes a month instead of unlimited). Their reply: "Why is checking for lineups rebuilding the
  entire site? That doesn't even make sense. At this rate we are going to run out of the ability
  to use this site after a few days?" Then: "Yes build that, and fix anything else that would
  trigger unnecessary steps for an isolated task."
- **What a run cost before:** about 3.5 minutes push to live, then a second job (the site check)
  that installed a second browser to open the pages the deploy's gate had just opened. Roughly
  7 billed minutes for any change at all, a hockey style tweak included.
- **The hockey-only refresh** went live about 80 seconds after its first push, with the login
  gate and the member database checked intact afterwards (`/auth/status`).
- **Why the refresh is so careful about when it publishes:** Cloudflare Pages replaces the whole
  site on every publish. A refresh that published while a code push was deploying, or published
  main's code after a deploy had failed its tests, would put old or untested code live. So it
  asks twice, and any doubt means it does nothing: the next one is an hour away.
- **Why the login page had to be ruled out:** a wrong build key gets the sign-in page back with
  a normal "200 OK". The old download would have saved that as data.json; harmless for a check,
  fatal for a job that republishes what it downloads. A download is now kept only if it is JSON.
- **Staying private.** The user offered to make the repo public again (unlimited minutes) and
  asked whether copying could be tracked. A fork is named and could be alerted on; a plain
  download is only a count; nobody running a copy on their own machine is visible at all. With
  the lean runs the private allowance is enough, so the recommendation was to stay private.
- A second chat was building the goalie saves tool in the same folder at the time, so this work
  was committed from a separate git worktree and only its own files were ever added.

### The refresh's clock moves to Cloudflare (2026-10-15)

- **How it came up.** The owner asked how reasonable it was to refresh every half hour instead
  of every hour. Looking at the runs answered a different question: GitHub's timer had fired 1
  of 6 hourly refreshes that afternoon (16:47 to 21:47 UTC), and one the night before started at
  01:50 for a 23:47 slot. GitHub says timed runs may be delayed or dropped when it is busy. A
  busy push day hid it (every push's deploy rebuilds hockey too); a quiet day would have had two
  or three refreshes, and a lock hours before puck drop.
- **The fix:** a Cloudflare Worker with a Cron Trigger (`workers/nhl-timer`) presses "Run
  workflow" every half hour. The refresh and all its checks are unchanged; the Worker only keeps
  time. The window also runs later (to 02:47 UTC) for West-coast games, which had only the 00:17
  full rebuild. Half-hourly costs nothing extra: the repo is public (free minutes), a run is 1 to
  2.5 minutes, and SmartStake allows 120 requests a minute.
- The owner made a GitHub token (Actions read and write, this repo only) and gave the Cloudflare
  key Workers Scripts Edit; no key ever passed through Claude.

## Data pipeline

### Odds lock at kickoff

  - **Odds lock at kickoff (2026-10-11):** Novig (and SGO) keep quoting IN-GAME lines, and the
    build published them as if pregame; mid-game the Pick Tracker read "SF -4.5, Under 56.5,
    SF -245" for a game that closed SF +3.5 / 46.5. `lock_started_game_odds` (build_stats.py)
    now takes a started game's odds from the previous build instead of this run's fetch, but only
    when that build is known to be pregame (it had already locked the game, listed in
    `lines_locked`, or its `generated_at` is before kickoff). Covers schedule lines (top-level +
    `novig`), both teams' TD and prop odds, and the all-odds list. With no trustworthy earlier
    copy it drops Novig's live copy and uses the spread/total the GMG model locked, then the
    schedule's closing line.

### Local builds

  - Local builds: `nfl_tool/build_stats.py` only downloads a data file if it's missing
    (`download_if_missing`), so a local `data/` folder goes stale. Delete `data/*_2026*` and
    `data/games.csv` before a local build that needs the latest games. CI always starts fresh.

### Data sources and key models

## Data sources and key models

- **2026-10-23: SGO removed, SmartStake leads.** The TD Summary's TD Odds rail showed Jaleel
  McLaughlin at +154 while Best Plays, his player card and FanDuel all had +600. The rail read
  `player_td_odds`, and that row was SportsGameOdds' "fair value" stand-in (SGO had no book price
  for him; its duplicate-player rule also kept the higher-chance row, which favored the
  stand-in). Best Plays and the card read SmartStake. The owner: "Lets remove all SGO
  implications and data and code from the logic. We have Smartstake now which will always reign
  supreme." SGO's fetch, keys, debug fields, the player prop fallback, the schedule-line refresh
  and the Game Previews All Odds list (SGO only) went. Anytime TD prices and the schedule's lines
  now come from SmartStake; Novig adds First TD, the over/unders and its own game prices. The
  notes below on SGO are the earlier history.
- **Odds: Novig first, SGO fills gaps** (until 2026-10-23).
  - Novig's public game feed is `POST https://api.novig.us/v1/graphql`, operation
    `EventMarkets_Query`. The query text is saved verbatim in
    `nfl_tool/novig_event_markets.graphql`.
    - Novig only accepts its own site's exact query. If `novig_debug.error` shows up in
      data.json, recapture the request body from the browser network tab on any novig.com
      game page and overwrite the file.
    - Games come from `GET https://api.novig.us/v3/public/catalog/events?league=NFL`.
    - `is_consensus` marks the main line; `outcomes[].available` is the price (0–1).
  - Player props, Anytime/First TD, and game spread/total/moneyline (`game.novig`) come
    from Novig. Thin books are flagged `thin`.
    - **TD markets keep one-sided prices** (changed 2026-10-09). Most First TD markets, and
      about 40% of Anytime ones, have a Yes price but no No. Requiring both sides left only 2–5
      First TD prices a game.
    - First TD chance = Yes ÷ the sum of every player's Yes in that game (never divided by
      less than 1).
    - Anytime chance = Yes/(Yes+No) when both sides trade. A one-sided one gets Yes × the
      game's median fair/Yes ratio.
    - Junk quotes are dropped: First TD Yes > 0.5, Anytime Yes > 0.95, or Yes+No > 1.5 (e.g.
      99.9¢/99.9¢ on a backup TE).
    - Other prop over/unders still need at least one side priced.
  - The user promotes Novig (code **GMGO**: deposit $10 → $50 in trade credits; QR at
    `site/novig-qr.png`). The user says Novig is fine with outside tools reading its feed.
  - SGO (SportsGameOdds, free tier) leaves many props without a book price. See
    `sgo_props_debug` in data.json.
- **ESPN FPI** (`espn_ratings`): offense/defense/FPI turned into 1–100 league-normed
  ratings, plus SOS rank. FPI is predictive; it includes preseason priors and QB changes.
- **Opponent adjustment:**
  - `prop_matchup_model` gives what each defense allows and each offense produces by
    position, throw depth and play type, with ranks.
  - `team_stats_adj` powers the Game Previews **Raw / vs Opponents** toggle.
  - Early samples are shrunk toward league average.
- **Context weights (passing numbers):** games in rain, snow or 15+ mph wind count 30%;
  games against a backup QB count 30% toward the defense's numbers.
- **Lineup-aware player usage (important):**
  - Uses `player_snaps` plus injuries.
  - A game a regular left early doesn't count.
  - A fill-in game while a regular (healthy now) was out counts 15%.
  - TD Data uses `lineupWeights` / `lineupAdjustedXtd` in common.js; Props uses
    `propBaselineGames`.
  - **Never surface a backup off one fill-in game.**
  - **Starting QB = `currentStarterQb(team, week)` (common.js, 2026-10-05):** whoever threw the
    most in the team's most recent game, unless ruled out this week (then the starter before).
    Used for the TD summary's QB Key Player chips and to order the Player Props QB cards. Fixes
    Cooper Rush (2 fill-in starts while Penix was Out) outranking Penix on season attempts.
    Returns null when every recent starter is out (TB Week 4: Mayfield Out, backup never
    started); callers then fall back to most attempts.

### Injuries and roster status

  - Injuries come from nflverse's injuries file, keyed by week. Teams file their first practice
    report Wednesday afternoon (Thursday-game teams earlier), so Mon-Wed the current week is
    empty; the panel then shows the team's most recent earlier report, labeled "No Week N report
    yet ... Showing the Week N-1 final report" (2026-09-30), instead of a blank.
  - **Roster status (2026-10-02):** players on reserve/IR never appear on weekly injury reports
    (teams only report active players), so an IR'd starter kept showing (Achane, Week 4; also
    Etienne, A.J. Brown, Pierce, Reed, Dart: 21 skill players with usage). `compute_roster_out`
    (build_stats.py) reads each team's latest weekly roster `status` (RES = IR/reserve, RET, CUT,
    EXE) into data.json `roster_out`. `rosterOut()` (common.js) feeds `lineupOutOn`, `propInjuries`
    and `firstTdInjuryStatus`, so these players count as Out everywhere and their backups get
    full lineup weight. DEV (practice squad) is NOT treated as out.
  - **Live source for the upcoming week (2026-09-30):** nflverse republishes the official report
    hours late, and the user needs Wednesday info for preview videos. `fetch_nflcom_injuries`
    (build_stats.py) reads the league's own page, `nfl.com/injuries/league/{season}/reg{week}`,
    and `merge_live_injuries` swaps in NFL.com's rows for every team that has filed for the
    current week. Past weeks stay on nflverse. If the fetch or parse fails, the build keeps
    nflverse and logs why. Verified: Week 3 on NFL.com matched nflverse 301/301 players, 100% on
    game and practice status. NFL.com codes AZ/LAR are mapped to ARI/LA. A rebuild (6-hour cron,
    or the Update Odds button) is still what pulls a newly filed report onto the site.
    The Raw Stats / vs Opponents toggle sits in the General Stats header, with a copy on the
    Summary toolbar because the card's matchups use it too.

## Styles

### The site font: Barlow to Sofia Sans (2026-10-15)

    - A friend watching a video said the all-caps text and numbers felt "too tall and bunched",
      and suggested a second font (monospace) for numbers. The owner agreed the text looked
      "mushed". Causes: Barlow Condensed at 800 weight, all caps, and condensed digits.
    - Tried first: Inter for digits only (a unicode-range face in front of Barlow). The numbers
      read better, but the owner "hated the mismatch in word font and number font" and found
      Barlow Semi "simply not good UI". Six single-family options were rendered on the real
      SEA @ DEN Game Summary (Inter, Roboto Condensed, IBM Plex Sans Condensed, Archivo, Sofia
      Sans, Saira), all capped at 700. Inter and Plex were wide enough to cut off labels; Sofia
      Sans fit everything at full size and was chosen for every sport, letters and numbers.

### Phone layout

    - **Phone layout (added 2026-09-29):** **[corrected]** style.css now has four `@media (max-width: 760px)`
      blocks (two small early ones, the main phone block, and one at the very end); new phone rules go in
      the last. Originally one block at the very end of style.css held every phone-only rule, so desktop stays pixel-identical (verified by diffing
      1440px screenshots before/after). Nothing is hidden on phones: wide sections scroll sideways
      inside their own box with the first (name) column pinned, side-by-side columns stack,
      Target Zones cards go two across, and the tab menu tightens (edge fade under 380px).
      New wide tables/grids should live inside `.stat-columns > section` (or get `min-width: 0;
      overflow-x: auto` in that block) so they don't widen the page on phones.
    - Phones also get: `html, body { overflow-x: clip }` (anything too wide made iOS zoom the whole
      page out, leaving a dark strip on the right); a compact topbar (acct name hidden, Update Odds
      icon-only), since the live logged-in topbar is wider than the local copy's; and
      `wrapWideTablesForPhone` (common.js), which wraps any table wider than its box in `.m-scroll`
      so only that table scrolls, not its whole section. Test phone layout with the acct chip and
      `is-owner` class added, or the topbar overflow won't show up locally.
    - The Summary cards are fixed 1160px images; on phones `zoomSummaryCardForPhone` (common.js,
      same 760px breakpoint) shrinks the card to fit, and `saveSummaryImage` lifts the zoom while
      capturing, so saved PNGs are identical on every device.


### Summary cards

- **Summary cards:** direct attention and don't explain.
  - No wordy blurbs. Use color and shaded boxes, not plain colored text.
  - No "#5" rank badges on the card; put ranks in hovers or small tags.
  - The card must never contradict itself (e.g. an RB over under a note that the run D is strong).
  - Give the rows and boxes room: use the full card height and don't cram.

- **Hide the picks column on any Summary card (2026-10-05):** a toolbar button `#summary-rail-btn`
  ("Hide Prop Picks" / "Hide My Picks" / "Hide TD Odds") drops the right rail; the card gets
  `.sc-no-rail`, and `fitWideSummaryCard` (common.js) zooms `.sc-main` to the biggest size that
  still fits (max `SUMMARY_WIDE_ZOOM_MAX` 1.6), then the usual shrink-only fit. html-to-image
  keeps the zoom, so saved images come out big too. Per-device view pref per card
  (`SUMMARY_RAIL_KEYS`), not synced. On Game Previews (since 2026-10-10) the picks are a bottom strip, so the button just hides that strip. The Props card has spare height so it grows a lot; the Game and TD cards are
  already height-bound (Game ~1030px of content for 980, TD 1.0-1.15x), so hiding the rail
  mostly widens them -- making them bigger needs less content or a different layout.

### One look across the whole site

- **One look across the whole site (the summary-card look), set 2026-09-28.** It lives in the
  "Facelift v2" block at the end of `style.css`:
  - Every `.data-table` is rounded tiles with 3px gaps, not hairline grid lines.
  - Colored values are shaded boxes (tint plus a matching 1px edge) in the bold display font.
  - Headers are small uppercase muted labels.
  - Team banners are team-color tints with a 4px team-color left edge (`teamBannerHeader`).
  - Rush lanes are big tiles like the pass zones.

  - Pick Tracker buttons match the summary's My Picks rail.
  - Tier cells are **filled** (tint plus a soft edge), never outline-only, in both themes.
  - Group headers inside tables (Production, Turnovers & Pressure, Run Defense, Team Grades...)
    are solid bars with an accent left edge and a small gap above (`group-gap` spacer rows).

- Schedule strip (top of every page): finished games show each team's score under its logo (winner bold), not the date.

## Site-wide rules

### Every matchup call reads BOTH sides; distrust small samples

- **Every matchup call reads BOTH sides (the user's rule, 2026-09-28).** Any Tough / Mismatch /
  Target / Fade / ADV logo / tag must use the offense's number AND the defense's ALLOWED number for
  the same thing. How often a defense shows a look (blitz %, box %) only decides whether the look
  matters, never which way it points. Use `matchupCall` / `matchupKind` in common.js:
  - A call needs one side clearly pointing one way and the other side not pointing the other way
    (`MATCHUP_CONTRA`).
  - An average alone is not enough, because it lets a strong side hide a contradicting one. That
    bug had "PHI 3.0 Y/C vs heavy box" read as Tough while CHI allowed 4.9 Y/C in that box.
  - Applied to: Game Summary Key stat edges (Blitz/Box rows show offense vs defense-allowed, with
    the look % in the label), the Scheme ADV column, the TD Data tags (Beats the blitz, Pressure
    trouble, Clean pocket, Light-box runs, Beats stacked box, RZ wall), and Props Summary packages
    (a market is dropped if either side contradicts it).
  - Rows where the sides don't act on each other (penalty yards) aren't matchups; keep them out of
    edges.
- **Distrust small samples.** 2–3 games can be one weird matchup (a backup QB, bad
  weather). Prefer approaches that discount flukes and lean on the market.

## NBA

### GMG NBA Suite

### GMG NBA Suite (started 2026-10-11; 2026-27 season tips off 2026-10-20)

The user wants the NBA version of this site on the same website, reached from a suite dropdown.
The brand is "GMG Sports Data Suite"; NFL and NBA are suites inside it.

- **Suite switcher** (`addSuiteSwitcher`, sync.js; `.suite-*` styles): the topbar brand ("GMG NFL
  SUITE") becomes a dropdown listing both suites. **Owner / localhost only until launch**
  (`SUITE_SWITCH_PUBLIC = false`); for everyone else the brand is still a plain link home. The NBA
  pages are guarded the same way (`.nba-app` hidden, `.nba-soon` "being built" note shown).
  **To launch:** set `SUITE_SWITCH_PUBLIC = true` (adds `html.suite-public`, which opens both).
- **Data: sportsdataverse / hoopR**, the basketball sister of nflverse. Season files are GitHub
  release assets at `sportsdataverse/sportsdataverse-data` (tags `espn_nba_*`, files named by the
  year the season ENDS: 2027 = 2026-27), scraped from ESPN and refreshed daily in season. Checked
  2026-10-11: `espn_nba_pbp` (play-by-play, ~640k plays a season, shot coordinates, players, clock,
  score), `espn_nba_team_boxscores`, `espn_nba_player_boxscores`, `espn_nba_schedules`,
  `espn_nba_rosters`, `espn_nba_depthcharts` and `espn_nba_injuries` (daily snapshots), plus
  `nba_stats_*` sets (shots, lineups, possessions). Parquet only is practical (pbp CSV is 275 MB),
  so `pyarrow` is in requirements.txt.
  - A season's box / pbp files don't exist until its first game (404); the build then uses last
    season's stats (`is_fallback_season`) with players placed on this season's rosters.
  - Not usable: `cdn.nba.com` / stats.nba.com (blocked with 403 from this PC and commonly from
    cloud builders). ESPN's own API (`site.api.espn.com/.../basketball/nba/scoreboard`, `summary`)
    works and is what hoopR scrapes; use it if same-day freshness is ever needed.
  - **Odds: Novig** has NBA on the same public feed (`events?league=NBA`, same
    `EventMarkets_Query`). Events are matched to games by team nickname + start time. Only
    `OPEN_PREGAME` events are read, and a game that has tipped keeps the lines of the last build
    before tip-off (`apply_lines`), so in-game lines never show.
- **Build:** `nfl_tool/nba/build_nba.py --season 2027 --out nfl_tool/site/nba/data.json` (deploy.yml
  step "Build NBA data", `continue-on-error`, so it can never block the NFL deploy). Local:
  add `--cached --data-dir data/nba` to reuse downloads. Output: `teams`, `team_stats` (per-100
  ratings, pace, four factors, 3s, paint / fast break / points off turnovers, each as `off_*` and
  the matching `def_*` allowed), `recent_games`, `players` (12-man rotation per team, per game +
  last 5), `injuries`, `schedule` (yesterday through 14 days out, Novig lines), `novig_debug`.
  Team keys are ESPN abbreviations (NY, GS, SA, NO, UTAH, WSH). Times are converted with a fixed
  UTC-4, so they read an hour late after the November clock change until that's handled.
  ESPN's `turnover_points` is points GIVEN UP off turnovers, so the sides are swapped on purpose.
- **Pages:** `site/nba/index.html` + `nba.js` = NBA Game Previews v1: day strip, The Line (spread,
  total, market score, win chance), The Teams (record, net / off / def rating, pace, home, away,
  last 10), Offense vs Defense (13 rows, each offense next to what the other defense allows, colored
  vs the league from each unit's side, same two-sided Mismatch / Tough / Good vs Good tags as the
  NFL cards), Rotations, Injuries, Recent Games. It does NOT load common.js (NFL-specific); it
  shares style.css and sync.js. New NBA styles are `.nba-*`.
- **Not built yet** (waiting on the user's priorities): Summary card, player props, model, picks,
  play-by-play tools (shot zones, first basket, quarter splits).

### NBA sim: start from the line (2026-10-28)

The game sim went live 2026-10-24 on the rule "the books' line is never an input" (the owner had
just retired the line-anchored projections after a -50u night). Four nights later Points + Threes
Best Plays stood at -12.0u (10-24..27, 328 plays; -16.4u on 10-27 alone): the sim's chances didn't
sort winners from losers (it said 62%, they hit 48%), and on the players who played the book's line
missed points by 4.84 on average against the sim's 5.54. A replay of those four nights tried ways
of blending the two; the best: center each player's simulated middle on the line, then move it 35%
of the way toward the sim's own middle, keeping the sim's spread and shape. The middle is the
MEDIAN, not the mean (points skew right, so centering the mean left fake under edges). With the 4%
minimum edge it went 85-89, +2.2u, and its top half by edge beat its bottom half (+2.8u vs -14.7u)
for the first time. That is break-even on four nights, not a proven edge. The owner approved it
("Start from the line", then "Build after reset"); `sim.nudge_to_line`, `LINE_NUDGE` 0.35. Threes
are whole numbers, so each whole number is spread evenly over +-0.5, moved, and read back
(`shift_ladder`); a whole-number move is exact. The banner on Best Plays / Points / Threes now reads
Testing: the model is being tested against its record. Plays saved before 10-28 stay as they were.


## NHL

### GMG NHL Suite (started 2026-10-13, a week into the 2026-27 season)

Two days after the NBA suite was started, the user asked whether the NHL could get the same
treatment: "is there enough free data out there for advanced NHL data points - box score stats,
but also location on rink". They pointed at moneypuck.com as an example of the data they wanted,
noting that its page says commercial use is prohibited, and asked for a source that could be used
instead.

- **Why not MoneyPuck:** its data page allows non-commercial use only, asks for credit, and says
  unapproved scraping will be blocked. This site has paying members, so it counts as commercial.
  The user was also told plainly that no source explicitly permits commercial use (NHL.com's terms
  read "personal, non-commercial"), which is the same footing as the ESPN and NFL feeds the other
  suites already stand on, and that this is a reading of published terms, not legal advice.
- **What was found instead:** everything MoneyPuck starts from is in the NHL's own public feed,
  which answered from the user's PC with no key (the NBA's official feed had been blocked). One
  game's play-by-play carries every shot, miss, block, goal, hit and faceoff with its spot on the
  ice. sportsdataverse (the source of the NBA files) has no NHL season files, only injuries and
  an open expected-goals model, so games are fetched one at a time.
- **Why games are kept as raw files:** with no season files, a cold build would download 1,344
  games (two requests each). The build keeps each official game on disk and the deploy carries
  that folder in GitHub's cache. The raw game is kept rather than its totals so later stats
  (expected goals, shot maps, line combinations) need no new downloads.
- **Why last season is a committed file:** on day one teams had played about 5 games, and the
  project rule is to distrust small samples. `prior_2026.json.gz` (60 KB) holds 2025-26's team
  and player numbers so the page can open on them until teams reach 10 games, without CI ever
  downloading last season. The page has a switch between the two seasons.
- **Checks made before trusting the numbers:** on all 1,312 games of 2025-26, goals matched the
  league's season report exactly, shots on goal within 0.07 a game, 5v5 shooting % exactly, and
  every one of 109,571 offensive / defensive zone shots faced the right net after being turned.
  Left / right was settled by comparing each team's lean with the NHL's own EDGE "L" / "R" shot
  areas (28 of 31 teams agree; the other three are near ties).
- **Why the rink colors mean volume:** a team that takes a lot of point shots isn't good at
  anything, so "more is green for the offense" would mislead. The rink is colored for how many
  shots the matchup points to from each area (two-sided, like `matchupCall`), which is also what
  matters for shot props.
- **Deliberately left for later:** expected goals (it needs its own fit and checks; the user
  should decide whether they want it before it is shown as a number), starting goalies (no free
  feed found), props, a Summary card.
- **How a CI build is confirmed:** the repo is private and `nhl/data.json` is behind the login,
  so `version.json` now carries a short note on the NBA and NHL builds.

### NHL player card (2026-10-13, same day as the foundation)

Right after seeing the first page the user asked for "the modals for clicking players like NFL":
box score stats, then "another tab for areas where they shoot the most/least like the WR catch
map we built", with shots per game and goals from each area, then their odds from Novig. They
called it the framework for the tools to come (anytime goal scorer, shots on goal, goalie
saves). They also said the five-game sample is understood and the season switch is fine as is.

- **Why per-team player files:** a season of game logs for 600 players would add several MB to
  data.json by April (the NFL data.json is 9.6 MB and the foundation plan already wants it
  split). The card's logs and shot areas live in `nhl/players/<TEAM>.json` and are loaded only
  for the two teams of the open game.
- **Why last season's logs are in the saved prior file:** with five games played, a card with
  only this season would be nearly empty, so `prior_2026.json.gz` grew from 60 KB to 0.5 MB to
  carry each player's 2025-26 log and shot areas.
- **Why a shared script:** the next tools are more NHL pages, and each must open the same card,
  so the data loading, helpers, rink drawing and card moved out of `nhl.js` into
  `nhl-common.js`.
- **The first-goal surprise:** Novig's first-goal book quoted 27 of 31 skaters in a game at
  21-27% to score first with nobody on the other side, depth defensemen included. Dividing by
  the sum of every Yes (the NFL First TD rule) turned a real 8.5% price into 1%. The rule
  became: a one-sided first-goal price must be at most half the player's own anytime price.
  That left the four real markets in that game.
- **Why zeros aren't red in the game log:** the NFL card shades every column against the
  player's own games, but goals are zero most nights, which painted the table red. Only the
  volume columns are shaded that way; scoring columns light up on the nights he scored.
- **Why goalie zones are rarely colored:** a .911 on 90 shots from one side looks bad next to
  the league's .937 but is two extra goals, well within luck. A zone needs 30 shots and a gap of
  1.5 standard deviations.

### NHL Shots tool (2026-10-13, the first tool built on the player card)

The user asked for a shots on goal tool that weighs "a variety of factors" (ice time, shots a
game, where he shoots, where the defense gives shots up, position) and ranks players best to
worst with a fair price. They said they don't know hockey well, and named their hold-back:
"Vegas has this info and can model better than me", but "if there's anything we can do to get an
edge or at least get to a place where we are identifying good spots, that would be awesome."

- **Why a replay came before the page:** with no hockey instinct to lean on, the weights had to
  come from data. 2024-25 was downloaded (1,312 games, about 4 minutes) so 2025-26 could be
  replayed the way the live build runs: each game projected from the games before it plus the
  season before. `tools/backtest/nhl_shots.py` prints the whole thing.
- **What the replay said about the user's factor list:** all of them are real, but small next to
  the player's own rate and ice time. The defense's overall number is worth about 6% either way
  for most players, position 2%, the rink areas 1%, the power play 1-2%, home ice 3%, a
  back-to-back 3.5%. Recent form (the last five games against his own rate) predicted nothing.
  Team strength and attempts-allowed added nothing once shots allowed was in. So "where he
  shoots against where they give shots up" is on the page because the user asked for it and it
  is real, but it is drawn as the small piece it is.
- **Why attempts:** a rate read from shot attempts (on goal, wide or blocked) predicted his next
  shots on goal better than his shots on goal did, so the rate is three quarters attempts.
- **Why the minutes get their own column:** the replay's projection with the REAL ice time known
  beat everything else by a wide margin. Ice-time news is where an edge would come from, and it
  is exactly what the model can't see.
- **The first slate (16 games, 233 two-sided lines):** the model and Novig's no-cut chances
  agreed closely (correlation 0.83), with the model about 2 points lower on overs on average.
  The biggest gap was a fourth-liner playing 9 minutes whom the book had lined at 2.5 shots (a
  promotion). That is why a 12+ point gap goes into its own "look for news first" group instead
  of topping the ranking.
- **Why a committed record:** nothing free has a history of shots-on-goal prices, so "does it
  beat the line" cannot be replayed. The page grades its own plays at the prices locked before
  puck drop and the deploy commits them (`model_history/nhl_shots/`, one file a month so the
  repo doesn't store a growing file every day).

### Shots: this season only (2026-10-13, an hour after the page went live)

The user opened the first play, an under 1.5 on Adam Jiricek (a St. Louis defenseman, 5 NHL
games: 2, 1, 2, 1, 3 shots), and asked "why on earth would we play an under?" He had cleared 1.5
in 3 of 5, and the user read Ottawa as a leaky defense that gives up point shots.

- **Two things had gone wrong, neither of them last season's data.** Ottawa was in fact allowing
  the FEWEST point shots in the league (8.0 a game against 11.0); the page had colored that red
  for "fewer shots", which on a defense's tile reads as "bad defense". And the under came from
  the small-sample guard: five games count for about half, so 1.8 a game became 1.4. Jiricek had
  no NHL games the year before, so last season was not in his number at all.
- **The guard was checked against the replay rather than argued.** Defensemen averaging 1.6-2.2
  after 5-9 games went over 1.5 in 42% of their next games; when a 5-9 game average said "over"
  and the model said "under", the over came in 36% of the time. The under was a fair call, but
  the page gave no way to see why, so it now starts each breakdown from the season average,
  names the sample step, and tags a called play that goes against his average.
- **The user then asked for this season only**, for every prop tool. Tested exactly as asked, the
  first slate projected Cale Makar for 1.6 shots and put a third of the board 12+ points from the
  market, almost all unders on stars: with five games and an average-skater guard, nothing says
  he is a volume shooter. A fade-out (last season gone by game 25) matched the best version's
  accuracy and was offered. The answer: "I don't want a gradual fade out. I don't want last
  season's data in the model for shots at all."
- **So it is this season only, with the best guard this season's data allows:** a small sample
  is mixed with an average skater who plays HIS minutes (a 21-minute forward against other
  big-minute forwards). On the replay that cut the stars' shortfall from 0.5 shots to about 0.1
  with no loss anywhere else. The first slate still had 33 "check" plays; that is what the rule
  costs until about game 20, and the user chose it knowing.
- The record keeps "against his average" plays apart from the rest, so whether fading a hot
  start actually wins is something the site will show rather than something to argue about.

### Shots: tonight's lines (2026-10-13, the same afternoon)

The user looked at the biggest edges and found the pattern: they were players on teams with an
injured forward, players whose minutes were going up that night. "The model is not accounting
for an uptick in usage based on injuries. This is something Vegas obviously knows and is clearly
accounting for. We are not. Thus we are generating bad picks based on a lack of full scoped
information."

- **They were right, and the information turned out to be free.** NHL.com publishes a "projected
  lineups" story for every game around midday: forward lines, defense pairs, goalies, scratches,
  injuries. That night's showed Warren Foegele, an 11-minute fourth-liner by his minutes, on
  Ottawa's top line, and Adam Jiricek (the under the user had questioned that morning) moved up
  to St. Louis's top pair.
- **What an injury list alone could not do:** a replay of "a regular is out" found his minutes
  spread thinly over everyone (about +0.04 minutes for each minute of a missing player above him),
  because WHO moves up is the whole story, and only the lineup says who.
- **Why the bump is +13% and not "the top line's minutes":** 1,300 of last season's 1,312 games
  still had their story, so the effect was fitted rather than assumed. A fill-in closes only
  about 15% of the gap between his minutes and his new line's, since he gets no power play and
  less of everything else. He does shoot more per minute with better linemates, so shots move
  more than minutes: about +10% for a 12-minute forward on the first line, +24% for a
  fourth-liner on the second.
- **So the lineup does not make Foegele a 1.5-shot player** (0.67 became 0.75 against a line of
  1.5). What is left of that gap is his cold start, which this-season-only cannot see past. Two
  things keep it from being a pick anyway: gaps of 12+ points were already set apart, and a play
  that goes AGAINST tonight's line change (an under on a promoted player) is now set apart too,
  whatever its size, shown amber instead of green.

### Shots: "Lineup Confirmed" and rinks with no plain zones (2026-10-13, evening)

- **The switch.** Once the Line column existed the user wanted the page to open on it: "Only
  show players with a line by default, and remove the feature to sort by everyone. Replace those
  toggles with Lineup Confirmed and All." So the page opens on players in a posted lineup, All
  adds the games still waiting, and a player with no shots-on-goal line is never listed. Each
  game in the strip says whether its lineup is in, because their first question was whether the
  site could show that at all ("is there a way to denote if a lineup has been confirmed?").
- "Confirmed" is their word. What NHL.com posts is its projected lineup from the morning skate;
  the About box says that, and that 95% of the skaters it listed last season did play.
- **The rinks.** "I also don't like when the shot charts are not colored. Red and green show,
  but sometimes it's just the natural display. Remember on the NFL Summary page how we had a
  scaled view of 8 colors: can we input that logic into the WHERE HE SHOOTS charts on the
  entirety of the site." The old rule colored a zone only when both sides clearly agreed, which
  left most zones plain. Now every zone is on the eight rank colors: a player's rink by what the
  opponent allows from there, a team's rink by both teams' ranks as one. The both-sides idea
  survives in the team rinks (disagreeing sides land in the middle colors) and, on a player's
  rink, as the number (his share) printed over the color (what the defense allows).
- The card's "OPP allows" column used to be colored from the defense's side (green = allows
  little). Next to a rink colored from the shooter's side that would have contradicted it, so
  the column now takes the zone's color.

### King of the Crease (2026-10-13, afternoon)

- **The ask.** "A tool similar to our King of the Endzone ... called King of the Crease": a
  quick, digestible snapshot of what decides saves, Novig's lines so everyone sees where the
  market is, every column sortable, and "a clean and crisp image to twitter" as the priority
  ("less information dense than the NFL one"). The new idea was theirs: "picking chalky and
  popular picks means your payout will be smaller. Some people are going to want to take the best
  possible play and walk out with $50 in bonus bets, others may want to take a dark horse ... and
  make it into a $400 free bet", so "a value tag which indicates where the market may be
  underselling the potential of the keeper".
- Novig had no saves market that morning and listed one by the afternoon, thin: half the main
  lines had one price or none.
- **What the replay said about their factors** (shots on goal, chances, saves): shots are nearly
  everything, from both teams; scoring chances from in close and the goalie's own save rate
  barely register; his saves a start so far is worse than no information at all.
- **Why Upside leans on the line.** A week into the season the model's projections ran 21 to 26
  saves while the lines ran 19.5 to 28.5. The lines are right to be wider: the book knows what a
  team was last year and the model, by the owner's rule, does not. So the chance to lead the day
  starts from the line and moves toward the model as the season earns it.
- **Why Value was rebuilt before it shipped.** Comparing "the day by our numbers" with "the day
  by the lines" tagged five low-line goalies on the first slate, none of them real: bunching the
  favorites makes every long shot look underrated. Now only the goalie's own number changes
  between the two chances. The honest result on day one was no Value tags at all.
- The lineup reader had been naming Victor Hedman as Tampa Bay's goalie (a seventh defenseman on
  his own line) and dropping an Islanders pair typed without a space; both were also missing
  from the Shots page. Fixed in passing.
- The NHL's own logos can't go into a saved image (no cross-origin header on assets.nhle.com),
  so this one page uses ESPN's, as the NFL pages always have.
- **The Devils goalie (same evening).** "Massive error - Jake Allen is confirmed for the Devils,
  yet the site is showing Nico Daws as confirmed. This cannot happen." The page had put the
  NHL's projected lineup first and a check mark on it. That lineup named Daws, who had started
  the night before, on a day the team didn't skate; Novig had a saves line for Allen only. Now
  no single source earns a mark, two agreeing earn "agree", and a disagreement is printed on the
  row with both names.

### One sport at a time (2026-10-13, evening)

- The user, after an afternoon of four-minute deploys: "can we make sure if we are working on
  one sport, that no other sports are ever rebuilt or tested or touched. That seems like a
  massive waste of resources." Data was already rebuilt per sport (earlier that day); the tests
  and the browser check still covered everything. Now `work_scope` names the one sport a push is
  about and the deploy passes it to `run_tests.py --only` and `check_site.py --gate --only`.
- What still checks everything, on purpose: a change to a file the sports share (style.css,
  sync.js, the login code, the tools, the test helpers, the workflows), a push that touches two
  sports, and the 6-hour refresh. The whole site is still published as one folder, so the other
  sports' live data is downloaded (a few seconds), never rebuilt.
- Honest sizes: the NHL has most of the browser tests (196 of 281), so an NHL-only push saves
  little on tests; an NFL-only push saves most of them. The hockey styles living in the shared
  style.css is the main reason an NHL change can still set off every test.
- **The stylesheet split (same evening).** Asked whether to close that last gap: "if that will
  save time in the long run and a skilled software engineer would make that change, please do
  it." Hockey's styles moved to `nhl/nhl.css`, the NBA / NHL shared layout to `suite.css`. The
  user also asked why it was taking a while and said they didn't want that to be the norm: the
  proof that nothing moved (every element's computed style, old file against new) is for a
  structural move like this one only, never for ordinary changes.

## 2026-10-19: the NHL Shots bar (shown or left out)

The owner asked for an audit of every graded Shots, Points and Goals play, to find the losing
factors and raise the bar so "only strong plays show", with no "check" tier. The record held 6
nights of Shots (485 plays with an edge), 3 of Points (162) and 5 of Goals (19 goals). To keep one
fluky night from deciding it, only factors that pointed the same way in both halves of the record
counted. Shots: 3-6 point edges and players moved down a line lost in both halves; big gaps and
unders on players moved up did not. A third cut, the edge coming only from tonight's matchup
adjustment against his season average, scored best (+14.5% in sample) but the owner turned it
down: a fill-in for an injury rightly projects above his average, and grading against it is
"muddy waters". The owner chose to change Shots only and leave Points and Goals until more games
are graded (the same two rules didn't help them on so few nights). Shots, before: shown plays
133-155, -31.6u; after: 154-117, +17.5u, in sample.

## 2026-10-13 evening: the outage, the live check, and last season leaving the NHL suite

- The owner reported the site down for paying members for over two hours while their Claude
  usage was used up. Every workflow run that day had succeeded; the publish live during the gap
  (the hockey-only refresh's first, 13:41 Eastern) uploaded the same 87 files and login code as
  the deploy before it. The owner then sent a screenshot: members had been looking at the NHL
  suite's "being built" launch guard, which every NHL page shows to everyone but the owner until
  the suite is launched. Nothing was broken and no push was stuck. What was added stands anyway: every publish is now followed by a look at the real site, and one that leaves it
  down is undone automatically (`ci_steps.py live-check`); CLAUDE.md tells every session to check
  usage before starting anything that ends in a push.
- NHL: the owner had last season's data removed from the whole suite (they disliked the page
  opening on it), and the "Where he shoots" rink's wording ("allows 3rd fewest") became three
  boxes per zone: shots a game, share, league rank. Zones are colored by the league-wide count.
- This session ran on a second PC (`C:\Users\cdmcc`), where Python is `py`.

## 2026-10-21: Line Matchups replaces Line Stacks

- Line Stacks lost most nights. On its first five nights (4,154 stacks graded) the best-scored
  stacks hit less often than the model said (Score 58+: said 23%, hit 16%). Same-game parlays are
  priced by each book's own engine, so the Score had nothing reliable to compare against. The
  owner retired it.
- A member who "knows puck" asked for line-vs-line information instead: likely matchups, how each
  line does together, hot / cold, past meetings. The owner wanted "more of a 'game preview' style
  tool than a 'heres a pick' tool". The kept shift charts already held all of it, so nothing new
  had to be downloaded. The owner approved a one-game mockup (FLA @ OTT) first.
- Honest limits shown to the owner first: about 6 games a team with a shift chart, trios with 20-60
  minutes together, trio-vs-trio history of a few minutes, and a third of 5-on-5 time played by mixed groups.

## 2026-10-28: the NBA data file outgrew Cloudflare's 25 MB a file

- Adding the Rebounds and Assists ladders to the NBA odds took `nba/data.json` to 27.8 MB.
  Cloudflare Pages refuses any one file over 25 MiB, so three deploys failed at the upload and
  members went about an hour and a half without the night's new features (the live site itself
  never went down: the old version stayed up). The error was only in the signed-in log.
- Fix, same night: the NBA file written compact (19.6 MB), then a "Check file sizes" step that
  names the biggest files in the public annotations and fails before the upload. Then, for room
  as the season grows: the NBA alt ladders (about 72,000 of 110,000 quotes, each with a bet link)
  moved to `nba/ladders.json`, and the NFL data.json (18.2 MB indented in week 8, and growing
  weekly) written compact. The step now warns past 20 MB so the next one is caught early.


## 2026-10-29: the NBA rules file before the trim (word for word)

`.claude/rules/nba.md` was cut from 936 lines to the rules alone (it loads on every NBA session). Its full text as it stood that day, with the owner's words, dates and replay numbers behind each rule, is kept here; headings pushed down two levels.

### GMG NBA Suite

Started 2026-10-11; the 2026-27 season tips off 2026-10-20. The user wants the NBA version of the
site on the same website, reached from a suite dropdown. The brand is "GMG Sports Data Suite";
NFL and NBA are suites inside it. More background: `docs/history.md`, "NBA".

#### Files (moved here from CLAUDE.md, 2026-10-25)

- Build: `nfl_tool/nba/build_nba.py` -> `site/nba/data.json`. `possessions.py`: the engine (every
  possession with the ten on the floor; every new NBA tool reads it). `identity.py`: Team Identity.
  `props.py`: player props data (`nba/props.json`). `sim.py`: the Points / Threes / Rebounds /
  Assists game sim (every game 10,000 times, tonight's plays, the record). `positions.py`: PG / SG / SF / PF / C from ESPN's
  depth charts. `shots.py`: this season's shot spots (`nba/shots.json`). `kotc.py`: King of the
  Court. `first_basket.py`: First Basket.
- Pages (`site/nba/`): `index.html` + `nba.js` + `matchup.css` Matchup Breakdown (Game Previews and Team
  Identity merged 2026-10-28; `identity.html` only forwards to it);
  `points.html` / `threes.html` / `rebounds.html` / `assists.html` + the same-named `.js` configs on
  `sim-board.js` + `sim.css` (Player View list + Matchup View game board); `best.html/.js` NBA Best
  Plays (all four markets by edge, same sim-board.js); `first-basket.html/.js`; `shot-charts.html/.js` (a shooter vs a defense);
  `nba-card.js` the player card (`playerClick(id)`: game log, every market's odds with save boxes,
  Shot Chart from `shot-chart.js`); `promo-tools.html` + `kotc.js` King of the Court.
- Records: `model_history/nba_kotc/` (nightly boards, tip-off lines), `nba_props/sim_<season>.json`
  (Points / Threes / Rebounds / Assists plays at tip, graded).

#### This season decides (the owner, 2026-10-20)

**Every NBA play, projection, tag and pick comes from 2026-27 games only.** 2025-26 is used for
backtests (fitting weights, measuring how many games a number needs before it means anything)
and **is not on the site at all since 2026-10-23** (the owner, once every team had played: "i do
not want flawed data entering this seasons numbers"): no season buttons' 2025-26, no reference
popups, no fallback while this season is young. build_nba.py reads only this season's files;
`identity_2026.json`, `props_2026.json`, `lines_2026.json` and the 2025-26 downloads stay for the
backtests (`test_the_site_never_reads_last_season` pins it). Before this season has enough games for a
number, show the data, not a projection. The owner: "A team with a new starting lineup and players
in and out (take boston - no brown add george - completely different) changes everything!"
- **No exceptions since 2026-10-27.** The game sim's per-player starting point from last season
  (2026-10-25 to 10-27, `sim_prior_2026.json`, deleted) read Toumani Camara (17 threes in 2 games, a
  new role) and Damian Lillard (missed 2025-26, new team, so an average guard) as unders. The owner:
  "stop using last seasons data i've told you 10000 times its not relevant". **Never suggest last
  season as a fix again**; when a young sample is thin, lean on this season's league / position
  numbers and let the replay pick how fast a player's own games take over.
- King of the Court was the one exception for its first week; it went this-season-only on
  2026-10-22 (the owner: "turn off 2025-2026 data because by next week, we will have every team
  with data for this season").

#### Positions: PG / SG / SF / PF / C (`nfl_tool/nba/positions.py`, 2026-10-21)

The owner: "Guards are drastically different roles and its unacceptable to not have PG vs SG
established." ESPN's box scores and roster files say only G / F / C; **ESPN's depth charts**
(`site.api.espn.com/.../basketball/nba/teams/<1-30>/depthcharts`, same player ids) list every
rostered player under the five spots, often several. A player's position = the spot where he
ranks highest (tie: first of PG, SG, SF, PF, C); Pritchard 2nd at PG, 3rd at SG = PG.
- `positions.json` keeps every player ever placed (departed players keep theirs for last
  season); each build adds today's charts on top (`load`). Re-save: `py nfl_tool/nba/positions.py --write`.
- `fetch_file` in build_nba.py relabels every `player_box` and `rosters` file (`relabel`), so
  every NBA tool sees the five; ESPN's G / F / C stays in `espn_group`. Players on no chart ever
  (7.6% of 2025-26 minutes): G with 4.5+ assists a 36 = PG (82% right), F with 6.5+ rebounds a
  36 = PF (65%); a roster row with no stats: SG / SF / C. Injuries take the table's position.
- Last season's numbers use today's depth-chart spots (a player's role may have changed).
- Tests: `tests/test_nba_positions.py`.

#### The engine (`nfl_tool/nba/possessions.py`, 2026-10-20)

The foundation every new NBA tool reads instead of the raw play-by-play. `Season(pbp, box)`
gives three tables: `possessions` (offense / defense, the five on the floor for each `o1..o5` /
`d1..d5`, start type make / miss / steal / dead_to / period, `t0`, `secs`, `margin`, points,
shots, free throws, turnovers, offensive rebounds, `first_secs`), `actions` (every shot, free
throw, turnover, rebound and foul with both fives; shots carry `dist`, `zone` rim / short / mid /
corner3 / above3, `kind2` catch / pullup / stepback / fade / drive / cut / post / floater /
putback / lob, the assister and the blocker; turnovers the stealer) and `stints` (each five's
time together). `py nfl_tool/nba/possessions.py --season 2026 --data-dir data/nba` prints the
health check (about a minute).

- **Lineups:** ESPN has every sub but not who starts a quarter. A player who does something (or
  is subbed out) before being subbed in started it; a quarter a player plays all of silently is
  filled from the box score (the teammate furthest above his rebuilt minutes). Technical fouls
  and ejections don't count (bench players get them).
- **ESPN's team_id is sometimes the wrong side** (401810560 gave CHI 9 points too many): a play's
  team comes from its player's box-score team, and points from the scoreboard's change. A player
  with no id in the box score (401810150) gets his team from his own plays.
- **All-Star sides** are left out: a team needs half the games of the most-played team (at most
  20), so opening week still counts.
- 2025-26 health: 1,230 games, 99.5 possessions a team-game, minutes within 1 of the box score
  99.99% (all within 2), team points match 2,459 of 2,460 (401810102: ESPN's play-by-play is
  missing plays). Corner 3 = |y| 21.5+ and |x| 33+, a quarter of all threes (the NBA's split).
- Read by Team Identity (below, shown on Matchup Breakdown); First Basket still counts its own possessions.
- What it answered first (the owner's "when will a guy like Peyton Pritchard shoot more"):
  Pritchard took 20.2% of Boston's shots with Jaylen Brown on the floor, 28.2% without.
- Tests: `tests/test_nba_possessions.py` (two real games in `tests/fixtures/nba_*_games.csv.gz`
  plus a hand-made one).

#### Team Identity (built 2026-10-20)

How each team plays, both sides of every matchup. The owner on the mockup: "This almost feels like
a 'game preview' of sorts. for now, keep it as its own tab but i think eventually we will merge
these two pages into one page."

- **Build:** `nfl_tool/nba/identity.py` (`team_identity`, `season_block`) on the engine, called by
  `compute_identity` in build_nba.py (its own try: a failure leaves `identity: null`). Output
  `identity`: `default` (this season once the middle team has `THIS_SEASON_DEFAULT_AT` games, like
  every NBA page) and `seasons[<year>]` (`label`, `team_games`, `teams{abbr: off_* / def_* / game
  script}`, `league{key: avg, sd}`). `def_<key>` = what the team's OPPONENTS did against it, so
  one team's offense in a game is the other's defense (a test pins it).
- **Last season is saved for the backtests** (not on the site since 2026-10-23):
  `nfl_tool/nba/identity_2026.json`. **Re-save it after changing a formula:**
  `py nfl_tool/nba/identity.py --season 2026 --data-dir data/nba --write`. This season is rebuilt
  every build from the play-by-play First Basket has just downloaded.
- **Numbers:** pace (possessions a 48), seconds a possession, transition (a shot or turnover within
  8 s of a defensive board or a steal) share and points, half-court points, shot share and make rate
  by zone, 3-point share, assisted makes, pull-up / step-back / fade share, catch-and-shoot share,
  turnover rate, steals' share of turnovers, offensive rebound rate, free throws a shot; game
  script: share of games up / down 15+ in the 4th and the night's starters still on the floor then
  (and in 4th quarters within 5), net points a 100 by quarter.
- **Numbers added 2026-10-28 for Matchup Breakdown:** `paint_share` / `paint_pct` (rim + short paint
  together), `ball_move` (makes assisted and catch-and-shoot share, averaged), `q<n>_ppq` (net points a
  game in each quarter), season_block `wl` {team: nw, nl, w / l: the `WL_KEYS` numbers over its wins /
  its losses}; each extremes type carries `order` (every team, most of the trait first).
- **The page is Matchup Breakdown since 2026-10-28** (below, "Matchup Breakdown"). Team Identity's
  own pages (2026-10-20 tags; 2026-10-26 Verdict with an edge count, Key / Every Stat, Every Type &
  Spot) are gone; the owner: "8 edges vs one" hid how big each edge was.
- **Matchup Extremes** (2026-10-26; now feeds The Verdict and Tonight's Types & Spots, full tables folded; the owner: "find the black and
  white of these teams", how a team does against a TYPE of opponent is "our bread and butter",
  relevant every night; UI left to the owner to adjust): `identity.matchup_extremes` (in
  `season_block` as `extremes`). 18 `TYPES` (top / bottom third of the 30 in one identity number:
  fast, slow, high 3s, rim, mid-range, corner 3, line, glass, transition, turnover-prone, pull-up /
  iso, ball movement, one-star (`star_share`), deep bench (`bench_share`, shots by non-starters);
  facing defenses: ball-hawk, foulers, rim protection, take away 3s). Per team-game (`game_rows`):
  points, 3PM, FTA, turnovers a 100 and pace. A team's split = its average against the type minus
  against everyone (offense types: what those opponents did to its defense); the page shows split
  minus the league's split, colored past 6 pts / 3 3PM / 6 FTA / 3 TOV a 100 (pace never), GP beside
  it, tonight's opponent's types first with a Tonight tag. **Readability pass (2026-10-26,** the owner:
  "so unclear as to what the hell this is even trying to say"): each block's header row names its own
  columns ("WSH Defense Vs These Offenses": Pts Allowed / 3s Allowed / FTs Allowed / TOs Forced;
  offense: Pts Scored / 3s Made...), a **Strength / Weak Spot** tag when the points cell is colored,
  **under `EX_MIN_GP` 3 games faded and never colored** (1-game cells were colored), types not faced
  yet (tonight's too, bold) fold into one "Not Faced Yet" line; no "--" cells (the owner: "it clutters it"). Matchup Breakdown shows tonight's types as rows of
  The Matchup (`exCell` in `site/nba/extremes.js`). Not built: big lineups / small-ball (need heights).
- **Schedule Spots** (2026-10-26, the owner's 13; second to the types): `identity.situation_tags`
  (from the season schedule file alone: B2B, 3 in 4, 4 in 6, rest edge 2+ days, layoff 3+ days, road
  trip game 1 / 4+, first home game after a trip, home stand 4+, altitude at DEN / UTAH, after a 20+
  loss / win, national TV or NBA Cup) and `schedule_spots` (Pts, Opp Pts a 100, pace: in the spot
  minus overall, next to the league's); season_block `spots` (+ `tonight` {game id: {team: keys}} for
  the next 15 days). `compute_identity` passes the schedule. Shown in Matchup Breakdown's Head To Head
  (Tonight's Spots, 3+ games). Dropped by the
  owner: OT the night before, body clock, miles, close loss, revenge, same opponent twice, star out.
- Tests: `tests/test_nba_identity.py`.

#### Player props data (built 2026-10-20)

The owner's plan, approved in words (no mockup): Points first, then rebounds / assists / 3s on the
same skeleton. **Pure data, no projection** until a projection is replayed against this season's
real lines. **Prices: SmartStake** (the owner: "Use smartstake because they have the best odds
options"), Novig only where SmartStake has no price.

- **Build:** `nfl_tool/nba/props.py` (`season_block`, `on_rosters`), called by `compute_props` in
  build_nba.py, written to **`site/nba/props.json`** (its own file: every player's game log; in
  `.gitignore` and `fetch_live_data.py` SUITES). `seasons[<year>]`: `fields` (the log's columns),
  `players[<espn id>]` (name, team, pos, `log` rows, `share` = his share of his team's shots
  while on the floor, `zones`, `kinds` self / catch / drive / other, `assisted`, `with[<teammate>]`
  = [min on, pts on, shots on, min off, pts off, shots off], teammates with `MIN_TOGETHER` 20+
  minutes together), `out[<team>][<game id>]` = [[id, rest / injury / coach]]. This season only
  (`default` is always it). 2025-26 is saved in `nfl_tool/nba/props_2026.json` for the backtests
  (re-save after a formula change: `py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write`).
- 2025-26 check: Pritchard 16.1 points a 36 with Jaylen Brown on the floor, 24.1 with him off.
- **SmartStake NBA** (`fetch_nba_book_odds`, smartstake.py): the points key is looked up in
  `/v1/markets` (`nba_prop_market_keys`: a player market for the stat alone, never a combo,
  quarter, half or first scorer), falling back to `basketball_player_points`; the player card's
  other markets are added from `NBA_PROP_MARKETS` when listed (the player card, below). data.json
  `book_odds` (same shape as the NFL / NHL, players by ESPN id, matched by name + team on
  today's rosters) and `book_odds_debug`; locks at tip like every price. The deploy's NBA step
  has `SMARTSTAKE_API_KEY`. `version.json` `nba.book_odds` = players with a points price (or the
  reason), `book_markets`, `props` = players per season.
- **Retired 2026-10-24: the line-anchored projections** (Points from 2026-10-20, Threes from
  2026-10-23: the books' line moved at most halfway toward ours, the props board, the testing
  banner, `lines_` / `threes_<season>.json`). The owner, after a night of 170 plays down 50 units:
  "I am sick of taking the vegas line and just basing our picks off that ... I want to 'start over'
  with both points and threes." Their records stay in model_history; the replays below stay.
- **Situational spots (2026-10-24):** `tools/backtest/nba_spots.py` measures 31 schedule /
  last-game / streak / lineup spots on ten past seasons against each team's normal and 2025-26's
  spreads and totals (findings in its header). Real ones (rest, back-to-backs, OT, close-win
  letdown) are 1-3 points and mostly priced; the sim's dials take their sizes from it. National TV,
  revenge, lookahead, streaks, time zones and altitude measured zero.
- **Factor research (2026-10-23):** `tools/backtest/nba_points.py` (findings in its header): last-5
  minutes overshoot (a dip bounces back) is real and is in the sim's minutes; referee crews added
  nothing.
- Tests: `tests/test_nba_props.py`.

#### Points and Threes: the game sim (`nfl_tool/nba/sim.py`, 2026-10-24)

The owner: "I just dont want to mimic the vegas line again and be back where we started." Every
game is played 10,000 times, possession by possession. Mockup approved 2026-10-24 (Tonight's Plays + Game Board).
- **Start from the line (2026-10-28, REVERSES 10-24's "the line is never an input";** the owner:
  "Start from the line"). 10-24..27 went -12.0u (said 62%, hit 48%; the line missed points by 4.84,
  the sim 5.54). `nudge_to_line` (build_nba.py `compute_sim`, right after each game's sims): per
  market, each player's ladders (every script), medians and mean move by d = (1 - `LINE_NUDGE` 0.35)
  x (main line - sim median), so his median sits at line + 0.35 x (sim median - line); spread and
  shape kept. MEDIAN, not mean (points skew right: centering the mean left fake unders). `shift_ladder`:
  each whole number spread over +-0.5, moved, read back (threes too; a whole move is exact, nothing
  below 0). No main line = the sim's own. props.json keeps `sim_med` (the sim's own), `line`, `nudge`;
  `med` / `lad` are the nudged ones, so the page, the plays and the record agree. Replay of 10-24..27:
  85-89, +2.2u at 4% min edge, top half by edge +2.8u vs bottom -14.7u: **break-even, not proven**.
  The banner reads **Testing / Model Being Tested Against Its Record**. Plays before 10-28 stay as saved.
- **One game** (`simulate`, numpy, all 10,000 at once, ~1 s a game): the teams' pace sets the
  possessions; each goes to one of the five on the floor (his minutes x his plays a minute); the
  play is a zone shot (rim / short / mid / corner 3 / above 3), a trip to the line or a turnover, by
  his mix tilted toward what this defense allows (`DEF_MIX_W` 0.5, both sides); it goes in at his
  zone make rate x what this defense allows there x the dials x home court (`HOME_EDGE` 2.2) x
  `LEVEL`; a miss can come back (offensive rebound: his team's rate x what the defense allows,
  against the league). After 3 quarters a blowout sends the starters to the bench (`GARBAGE_*`);
  from the 2nd quarter a lead shrinks a little (`LEAD_DRAG`: the team ahead eases off; real margins
  swing less than independent possessions would). Ties play overtime. Nights: minutes (wider for
  bench players, `SHORT_NIGHT` 4% an early exit), shooting, the game's pace and shooting.
- **Early season (this season only since 2026-10-27):** `season_inputs` from the engine; a player's
  rates lean on his position's numbers THIS season (`K_*`). Shot mix and shots a minute trust his own
  games fast (`K_MIX` 5 plays, `K_USE` 10 minutes: Camara's 17 threes in 2 games read as a shooter);
  make rates stay slow (`K_ZONE`, threes 200 shots). Replayed on 2025-26's opening month with no
  prior: threes miss 0.912 -> 0.896, points 4.65 -> 4.58 vs 40 / 60. `--prior-season` stays in the
  replay only.
- **Blowout minutes** (`blowout_starts`, `minutes_before`, `role_min`; the owner, 2026-10-27, Derrick
  White's 18 minutes in a 35-point win): a game whose lead hit 20 and stayed there in regulation (from
  the 2nd half) counts a player's minutes before then, scaled to 48 (`role_minutes`), **only ever
  down**: garbage-time minutes aren't a role. The owner, same day, on BOS-BKN: the sim's total was 3
  over the line yet every player but one read under; it gave 14-15 players a team minutes every night
  (Garza, Harper, Conley: blowout-only minutes), about 21 of Boston's 113 points. With it: Tatum 32.6
  -> 35.1 minutes, 23.6 -> 25.4 points, same total. Replay (this season, `--injury-report`): starters'
  points 15.2 -> 15.6 (real 15.7), points miss 4.74 -> 4.66. Raising a pulled starter (`BLOWOUT_UP` 1,
  the first version) overshot: starters 30.4-30.7 minutes vs 29.9 on 2025-26's opening month.
- **Minutes:** season^0.365 x last-5^0.635 (the overshoot), fit to 240 (`fill_minutes`: too many,
  the small roles give up the most; too few, everyone up in proportion, cap 40). **Out** (the
  injury report) leaves the rotation; the 2025-26 replay preferred handing his minutes to everyone
  in proportion over his own position first (minutes miss 4.8 vs 5.1-6.3). A fringe player who
  missed the team's last 3 games sits. **Chance to play (2026-10-27,** the owner: 80% of plays were
  unders): the sim had given full minutes to players who then sat (about 13 a team a night: Day-To-Day
  stars, rest nights, fringe bench), so everyone else read low; graded 10/24-26, unders the sim called
  62% hit 49%. Now each player plays in only some of the 10,000 games (`play_chance`, `PLAY_CHANCE`:
  Day-To-Day 0.45, measured 42% on this season's morning reports; Questionable 0.55, Doubtful 0.15,
  Probable 0.95; a bench player x his share of the team's games played, `SHOWS_K` 2; a usual starter
  off the report and anyone in the posted five always). A game he sits gives his minutes to the rest;
  his own numbers (props.json `plays` = his chance, min, med, ladder) count only the games he plays
  (books void a no-show). Replay `tools/backtest/nba_sim.py --injury-report` (Out = the morning's
  ESPN snapshot, not who really sat) on this season's first 5 nights: points -0.34 -> -0.03 a player,
  threes -0.13 -> -0.09, starters' minutes 28.7 -> 29.5 (real 29.9). **Starting fives:** the NBA's lineups file (First Basket's
  copies, `lineup_starters`, names matched with an accent fallback): a listed starter plays at
  least `STARTER_TRUST` 0.8 of his team's usual starter minutes (the owner: "a roleplayer who has 10
  minutes per game but tonight is starting"; the replay's fill-in starters played 25.5: no floor
  gave 19.9, 0.9 gave 28.2, 0.8 gives 25.9). **Once the five is posted, a usual starter (half his
  games) on the injury report but not Out (Questionable / Doubtful / Day-To-Day) who isn't in it sits
  too** (`hurt`, 2026-10-25: Embiid Questionable with Bona in the posted five at the noon build got 30
  bench minutes, and LeBron / Brown / Edgecombe all read big unders; ESPN ruled him Out 40 minutes later).
- **Injuries: ESPN's live list** (`live_injuries`, build_nba.py; the hoopR file is a daily snapshot,
  the fallback). The owner, 2026-10-24: ESPN still had LeBron Questionable an hour after Underdog
  reported him out, "that is not going to cut it".
- **The injury watch (2026-10-25,** the owner: "Within 5 minutes of a player being ruled out for
  their team, sims rerun"). Every build writes data.json `watch` (version.json `nba.watch`:
  tonight's untipped teams, fingerprints of ESPN's statuses `inj` and the NBA's posted fives `lu`,
  `nfl_tool/nba/watch.py`) and `timing` (seconds per part). The Cloudflare Worker gmg-nhl-timer
  (`workers/nhl-timer/watch.js`, every minute 8 am to 1 am ET) works out the same fingerprints and
  on a change presses `.github/workflows/nba-refresh.yml` (members-and-hosting.md). The refresh builds
  with `--fast-odds` (smartstake `fetch_nba_book_odds(fast=True)`, `carry_previous`): only Points /
  Threes main lines fresh, every other market and the ladders from the live build, a player's ladder
  dropped when his main line moved. SmartStake gives 10 pages a minute: the full odds were 216 of the
  build's 275 seconds on 10-25. The two sides
  must match to the letter (`tests/test_nba_watch.py`). **Grading (2026-10-26):** the box scores land about 7:35 am ET
  and nothing rebuilt the NBA until the day's injury news (10-25's plays sat ungraded all morning;
  GitHub's 6-hour cron skipped 06:17 and 12:17). `watch.ungraded` (build_nba.py `ungraded`: the last
  two nights' plays still waiting on a box score) above 0 makes the watch press nba-refresh.yml with
  source `grade`, at most once an hour (`GRADE_MINUTES`), from 8 am ET. Paid sources were turned down (the owner:
  "i dont want to pay": X's API for Underdog's posts). **Mark Out** (the owner's, 2026-10-25): a
  button on every Matchup View row (owner only, `.sim-markout`) saves `/api/nba-outs` (D1
  `nba_outs`, middleware) and presses nba-refresh.yml (Pages secret `DISPATCH_TOKEN` = the timer's
  `NHL_TRIGGER_TOKEN`, copied by deploy.yml); the build reads the night's list with its key
  (`fetch_marked_out`, `add_marked_out`: Out whatever ESPN says, `marked`), and the Out Tonight row
  reads "Out (GMG)" with an Undo.
- **Waiting On Market (2026-10-28,** Luka ruled Out: the refresh ran a minute after the news, before
  the books moved, Reaves 23.5 here vs 26.5 on FanDuel, and the sim read the stale line as a big over).
  data.json `market_watch` (watch.py `market_watch`, carried build to build via `fetch_previous`):
  when each 20+ minute player (`STAR_MINUTES`) on tonight's untipped teams was first seen Out, and when
  each untipped main line was first seen at its number. A candidate whose line is older than a
  teammate's ruling goes to props.json `sim_held` (`held_by`, at most `HOLD_MINUTES` 40): not a play,
  not saved; sim-board.js grays it with a Waiting On Market tag between the plays and the rest.
  `watch.recheck` (`RECHECK_MINUTES` 10 / 25 / 40 after the ruling): the timer presses the refresh
  with source `recheck` once it's due, news or not. Tests: test_nba_watch.py `WaitingOnMarket`,
  test_nba_sim.py `Build`.
- **The NBA's official injury report** (`nfl_tool/nba/nba_report.py`, 2026-10-25): a PDF every 15
  minutes at `ak-static.cms.nba.com/referee/injury/Injury-Report_<YYYY-MM-DD>_<hh>_<mm><AM|PM>.pdf`
  (Eastern); on 10-25 its 1:00 pm report had Embiid Out 8 minutes before ESPN. Read with `pypdf` by
  column position (the team and the name share a line; later pages have no header, the first page's
  columns carry), names matched to tonight's rotation players (`players_of`: data.json `players`), a
  player's first row. `add_report` (build): the newer of ESPN (its `updated`) and the report's slot
  wins; Available takes him off the list; Probable adds no one; the owner's marks come last. The
  watch HEADs the newest slot each minute and presses the refresh with `source: report` once per new
  report (not after a refresh that started after it was posted); that run's first step
  (`nba_report.py --changed`) stops unless tonight's rows changed (`watch.rep`, `rep_at`). Test:
  `tests/test_nba_report.py` on the 1:00 pm report (`tests/fixtures`).
- **The dials** (`SCHEDULE_DIALS`, `LAST_GAME_DIALS`, sizes from nba_spots.py: [own points, the
  other team's points]): Rest Edge (B2B vs 2+ days off, -0.72 / +1.89), Back-To-Back, 3 In 4,
  4 In 6; Letdown: OT Win, Overtime Legs, Letdown: Close Win (1-3 in regulation), Off A 20+ Win
  (+0.25 / -0.58: no letdown, the opposite). One of each kind a team at most, in that order. Turned
  into a make-rate change (/ `PTS_BASE` 113).
- **Checked on 2025-26** (`tools/backtest/nba_sim.py`, findings in its header: each night from that
  season's earlier games only, the players who sat taken out): team points +0.4 high, player points
  +0.25, threes +0.04; real results inside the sims' 10-90% range 80% (margin), 84% (total), 77%
  (player points); PIT deciles flat within a few points. The closing lines still beat it (total
  miss 14.5 vs 15.2, margin 11.2 vs 12.4): a play is where the two disagree by enough, and the record
  says whether that's an edge.
- **props.json** (compute_sim in build_nba.py, its own try: a failure leaves the pages empty, never
  the game logs): `sim` {game id: median margin / total, `scripts` (away by 10+ / close / home by
  10+), `base` (the same without the dials, `SIM_BASE_N` games), `dials` {home, away}, `starters`,
  `out` {home, away: who'd be in the rotation but sits tonight}, `lineup` (the NBA's five was posted), `players` {id: team, min, pts / fg3m: med by script, mean,
  `lad` by script = [first k, permille of k or more ...] (`ladder`)}}, `sim_plays` {points, threes},
  `sim_record` {market: {ledger}}, `sim_meta` (dial names, MIN_EDGE, `line_nudge`).
- **Prices:** every book's main line and every rung (`smartstake.add_ladder`: `points_alt` and
  `threes_alt`, alternates included). `version.json` `nba.points_alt` / `threes_alt`.
- **The plays** (`game_candidates`, `pick_plays`; since 2026-10-25): each player's **main line
  only** (the middle of the books' lines), Over and Under at the best price (`PRICE_RANGE` -250 to
  +400), against the sim's chance; **every one with `MIN_EDGE` 4+ points is a play, no cap a night or
  a game** (the owner: "Why only 8 plays?! display everything with its edge just like hockey is";
  main lines: "Most users are going to play his under X - x being his main line"); 2+ games this
  season and 18+ sim minutes. **Every play is Strong** (no Top Play since 2026-10-26, the owner: "just
  call everything STRONG"; old "top" rows count as Strong in the ledger and past nights). A rung
  is never the play: the page shows it as the **Ladder** tag. (2026-10-24 to 10-25: the best of every
  rung, one a game, 8 a night; Luka u25.5 +295 was a Top Play that way. Those plays stay in the record,
  tagged alt.) **Script-Proof** (beats its price in every script), **Chaos** (loses in a close
  game, wins when it goes sideways), **Needs A Close Game**.
- **The record:** `model_history/nba_props/sim_<season>.json` {game: {date, points: [play],
  threes: [play]}} (`PLAY_FIELDS`), rewritten until tip, never after; `sim.ledger` grades each play
  at its best price across every book, 1u; a push or a player who sat isn't graded. Split tags: top /
  strong, proof / chaos / close, over / under, main / alt, dials.
- **Past nights** (2026-10-25, the owner: "I have no way to go back and see how anything
  performed"): props.json `sim_past` {market: [play + `got`, `result` won / lost / push / sat /
  None]} (`past_plays`); the day arrows step back to them and show Results (record, units, Hit %,
  each play as locked at tip in the list with Hit / Miss, what he got, units). The page opens on tonight's slate.
- **The pages** (`site/nba/points.html` / `threes.html` + `points.js` / `threes.js` = `SIM_PAGE`
  config, on the shared `sim-board.js` + `sim.css`; Points / Threes tabs). **Rebuilt 2026-10-25** (the
  owner: the play cards and charts "feel busy to be thrown at a user immediately ... it goes against
  what i've built so far and the effort to be consistent across pages"; "brainless for people who
  want brainless, but deep for people who want deep"): the **Beta banner** back (suite.css
  `.pts-testing`, the caution line, the how-it-works behind its i; record tiles Yesterday /
  Season in units + YTD Model Performance, the shared YTD tracker with the split tags on its right),
  then **Player View | Matchup View** (a display pref per device, `nfl-tool.nba-sim-view`), the day
  arrows and game cards ("n Plays").
  - **Player View** = the NHL Shots page's list: **opens on Plays Only** (the owner: "This is about
    consistency. If users want the detailed look, theyll click"), Every Player adds the rest under
    "Not plays"; Side (Best Side / Overs / Unders) and Edge menus; a game card narrows the list (again
    = every game). Columns (the owner, same day: "Make it go PLAY, RATING, FAIR, EDGE, and then install
    the old hit rates tab"; Median / Hit % / Min dropped, "cramped"): #, Player (playerClick, logos),
    Play chip "o31.5 -110 FD" (green over, red under; best price on the member's books) + save box
    (nba-card.js `nbaCardSaveBox`), Rating (Strong), Fair, Edge, then **Hit Rate - Based On
    PTS / 3PM** (L5, L10, Season, Home, Away: his games OVER tonight's line whichever side the play is,
    "x of y", colored red 20% to green 80% with `scaleHsla`), **Tags** (takes the spare width; every
    other column is its contents + 11px a side, centered; the hit rates one width, 62px; the header reads
    "Hit Rate - Based On Over Points / Threes"; tags in two lines at most, a box the same height on every row, the rest in a "+N" pill, `fitTags`). Tags (`tagsFor`, a Tag menu filters): **Ladder** (the
    rung on the same side with the most edge, when it clears 4 and beats the main line's: "Ladder
    u25.5 +295 +9.4"), Script-Proof / Chaos Play / Needs A Close Game, each dial on with its team, Min ↑ /
    Min ↓ (a 20+ minute teammate at his spot Out tonight / back from sitting the last game), Points:
    Zone Fit / Tough Zones (his zones x what this defense allows, 2.5 points); Threes: 3s Allowed /
    Tough 3s D / Help D (Team Identity, 1 league spread), Underdog +6, Cold / Hot Run (last 5 makes
    0.6 a game off his own rate). Every column but Player / Play / Rating sorts. Started games gray
    under the rest. A click opens **The Model** (Hit In x of 10,000, GMG
    Fair, Edge and what the price needs, Book Line, the three scripts shaded, the histogram, Script-
    Proof / Chaos / Close + dial tags with the team, Starting, Locked At Tip; and **the ladder**: every
    line on the play's side then the main line's other side, our chance, fair, best price with every
    book on click, edge) and **Shot Chart** (`zonesView`: his chart beside every shot tonight's defense
    allowed, one set of filters, the Target / Tough zones where both point the same way, Zone By Zone =
    the Shot Charts page; no zone table: the owner, it "regurgitate[s] the chart").
  - **Matchup View** = the **Game Board** (rebuilt 2026-10-25 by the owner, step by step; then "give
    this a UI improvement to the max. Fill the space and make it enjoyable to read"): team-color
    banner, ONE strip (Spread / Sim, Total / Sim pills, then a big By 10+ / Close script bar filling the
    row), then **a card a team, side by side, half the width each** (team-tint banner with a 4px edge
    and the **Show Ladder** button; Player View's tile table: headshot + name, Starters / Bench group
    rows, then **Out Tonight**: `sim.out` grayed at the bottom with Game Previews' status pill, his
    season minutes and the injury, the owner 2026-10-25): Min, PTS / 3PM (**his median to a tenth**, `smoothMedian` off the ladder: the sim's own is
    a whole number, so every Threes Diff read -0.5), Line (Player View's chip, our side of his main
    line at the best price, a click = every book; tonight's play ringed), Diff (median minus the line,
    green on our side), Edge; "No Line" when no book has him. **The ladder** (Points 10+ to 40+, Threes
    1+ to 6+: our chance and best price; green / red at 3 points of edge, yellow near fair, gray with no
    price) is closed by default and opens one team at a time; while one is open both cards stack full
    width (no dead half). **Removed on purpose:** the Script Picker and by-script / Script columns (the
    owner: "its almost common sense and the numbers dont move much"; the scripts live on in the bar,
    the Player View tags and The Model), the % column, Dials Tonight (the dials are in every sim; Player
    View tags them), the box titles. Classes: `.sim-tcard`, `.sim-bt` (not `.sim-head`: the toolbar's).
- **Best Plays** (`site/nba/best.html` + `best.js`, 2026-10-25, the owner: "Keep the consistency present
  in those individual categories, but sort the best plays by edge, aggregating from these two
  categories"): sim-board.js with `SIM_PAGE.markets` = [points.js's, threes.js's config] (each page's
  config sits in `SIM_MARKETS`; `MK` = the market a row is drawn for). Player View only (no Matchup
  View), every market's rows in one list by edge with a **Market** column, Market switches (each on or
  off, the last stays on), hit rates over each row's own stat ("Based On Over His Line"), the record
  tiles and past nights across both, the YTD popup with All Plays + a tile a market (top / over /
  under splits). A new market = its page's config in `markets`. Best Plays / Points / Threes tabs on all three.
- **Rebounds and Assists (2026-10-28,** the owner: "build it in the exact same way and structure as
  the current points and threes", "a highly requested feature"; agreed in a 4-question Q&A): the same
  sim, pages (`rebounds.html` / `assists.html`, Under Construction in the NBA menu, tabs on all five),
  record (`sim_<season>.json` `rebounds` / `assists`), Best Plays (four markets) and YTD trackers.
  - **Boards:** every missed shot (and a missed LAST free throw, `ft_oreb` / `ft_dreb`) is a board; the
    shooting team's back at its oreb rate (both teams, as before), else the defense's. A credited share
    goes to players (`oreb_player` / `dreb_player`: the rest are team rebounds), each to the five on the
    floor by floor time x his rebounds a minute (`K_REB` 60 toward his POSITION's this season) x
    `reb_tilt`: how much of the boards tonight's other team gives up at his position, PG / SG / SF / PF /
    C (the owner: "actual position rather than bigs forwards and guards"), shrunk by `K_POS_REB` 400 (80
    read five games' noise: miss 2.16 vs 2.11; it grows as teams' games come in). `REB_LEVEL` 0.965.
  - **Assists:** a make is assisted at the shooter's assisted share (his zones' usual makes, `K_AST_SHOT`
    toward his group) x how often this defense gives up assisted makes (`K_DEF_AST`); the assist goes
    to a teammate on the floor, never the shooter, by his assists a minute (`K_AST` 25 toward his
    position: 60 read Jalen Johnson, a PF at 8.5 a game, at 5.9). One draw a team a period whose
    expected count per passer is exactly the per-shooter one (13 draws a period cost a second a game;
    each player keeps his own rate: the owner checked, "anthony davis and trae young are not the same").
  - **Nights:** `SD_REB` / `SD_AST` 0.4 (none: 14% of real results under the sims' 10th percentile and
    14% over the 90th). Replay on this season's first 6 nights (`nba_sim.py --injury-report`, 42 games,
    808 player-games): rebounds 4.24 vs 4.33 real, 80% inside 10-90%, by position PG 3.00 / 2.98 ... C
    5.85 / 5.91; assists 2.51 vs 2.59, 78%. Players the sim has at 9+ boards got about 1 fewer (32
    player-games; Points' 25+ does the same): watch it.
  - props.json: each sim player `reb` / `ast` like `pts`, `glass` [position tilt, his boards a minute
    vs his position's]; each game `misses` {home, away}; `sim_meta.miss_pg`. SmartStake: `rebounds_alt`
    / `assists_alt` ladders, and both in `FAST_STATS` (the injury refresh: an Out teammate moves these
    lines too, a stale price would read as an edge; about a minute more on the refresh).
  - **Tags** (sim-board.js `reboundsTags` / `assistsTags`): **Glass Fit / Tough Glass** (the position
    tilt 10%+ either way, his own rate not 10% the other way), **Misses Coming** (the other team's misses
    in tonight's sims 3+ over the league's a game), **Ball Movement Fit / Tough Passing D** (Team
    Identity `def_assisted` 1 league spread, his team's `off_assisted` not 0.3 the other way), **Hot /
    Cold Run** (last 5 games vs the games before them, at his minutes: 2 boards / 1.5 assists; 7+ games).
  - Ladder columns: Rebounds 4+ to 14+, Assists 2+ to 12+. The Shot Chart tab stays (same structure).
  - **Start from the line** applies to them too (`nudge_to_line` loops `STATS`; the owner, same day: "I dont
    love starting from the line, but we determined that was most reliable and will cause less destruction
    as we gather data").
- Tests: `tests/test_nba_sim.py`, `tests/test_nba_points_site.py`, `tests/test_nba_threes_site.py`, `tests/test_nba_best_site.py`. `tests/test_nba_rebounds_assists_site.py`.

#### The player card (`site/nba/nba-card.js`, 2026-10-21)

The owner: "build the player functionality that exists for NFL and NHL so theres consistency ...
game log and odds for all markets with checkboxes like NFL has ... game logs can be added only for
this season, do not add past years." **Every place an NBA page shows a player wraps him with
`playerClick(id, inner)`** (ESPN id): Matchup Breakdown's rotations and injuries, Points, First Basket's
starters and Value list, King of the Court's board. Each of those pages loads `../book-odds.js`
and `nba-card.js` (after the page's own script; every name in it starts `nbaCard` / `NBA_CARD` so
it can't clash with a page's helpers). Same shell as the NFL / NHL cards (`#player-card-modal`).
- Head (photo, position, team, next game) and this season's per-game tiles (Games, Min, Pts, Reb,
  Ast, 3PM, PRA).
- **Game Log** (opens here): this season's block of props.json ONLY (`DATA.season`), newest first,
  a per-game row on top: Min (a "B" when he came off the bench), Pts, Reb, Ast, 3PM, 3PA, FG, FT,
  PRA, Stl, Blk, TO, PF, +/-, shaded against his own games like the NHL card.
- **Odds**: every market in `GMG_NBA_PROP_STATS` (sync.js) a book prices for his game, at the line
  most books hang: best Over / Under across the member's books (`bookPricePill`), a box beside each
  side, and "This Season" = games over that line ("x of y", colored from 3 games like Points). First
  Basket too (same play id as the First Basket page). A box saves `{id: nba:<stat>:<game>:<player>,
  market, category, side, line, book, odds, ...}` at the best price; Over and Under share the id, so
  checking one side switches the play.
- **Log fields** (props.py `LOG_FIELDS`, after the first eleven so older files still read): fgm, ftm,
  reb, ast, stl, blk, tov, pf, pm, score, opp_score (`BOX_EXTRA`; None when a box score lacks one).
  props_2026.json keeps the old eleven (the card never shows last season).
- **Markets** (smartstake.py `NBA_PROP_MARKETS`): points, rebounds, assists, threes (made), pra, pr,
  pa, ra, steals, blocks, stocks (steals + blocks), turnovers; each asked for only when `/v1/markets`
  lists its key (`nba_listed_markets`), with `max_pages=60`. Yes / no markets and fouls left out.
- **Grading** (my-plays.js `gradeNbaPlay`): First Basket as before; every other market from his row
  for that game in props.json (`gmgNbaStatValue`, sync.js): the game in the box scores and him not in
  it = Void; no box score yet = wait.
- **Shot Chart** (2026-10-21; the owner on the mockup: "both with toggle is great as well as
  filters", this season only): `site/nba/shot-chart.js` (`nbaShotView(id)`, every name `nbaShot` /
  `NBA_SHOT`; loaded before nba-card.js on every page with the card) reads **`site/nba/shots.json`**
  (`nfl_tool/nba/shots.py`, its own try in build_nba.py `main`; gitignored, in fetch_live_data.py):
  `games` (this season's ids, oldest first), `teams` (abbreviations), `players[<id>]` = [x, y, made,
  three, game index, flags 1 = 1st qtr / 2 = first 3 min, kind 1 self-created / 2 catch / 3
  drive-cut-rim, his team, the defense (indexes into `teams`, -1 unknown)], `who[<id>]` = [name, team
  of his latest box-score game], `league` = [x, y, three, made, tried] by spot. The two teams come
  from his **box-score** team that game (never ESPN's play `team_id`); a player missing from the box
  score gets the play's side. All-Star sides are left out (the engine's half-the-games rule). ESPN's spot to the foot; **x below 25 = the shooter's left**
  (checked against NBA.com's 2025-26 shot file: same side on 90% of 121k matched shots, the rest
  wrong matches); heaves 35+ ft and free throws out. Basket at the top, so Left Side is drawn left.
  **Zones** (12: At The Rim, Paint, mid-range Left / Right Baseline, Left / Right Wing, Top; Left /
  Right Corner, Left / Right Wing, Top 3) with made/tried, %, % of FGA; **Heat Map** = hexagons
  1.6 ft, size = his shots there (scale tops out at the 92nd percentile), color = his make rate
  within 3.5 ft vs the league's there (same 2 / 3). Both: color pulled toward the league by 6 shots
  (`NBA_SHOT_PRIOR`), full at 8 points; the zone table beside it (FG, FG%, vs Lg, Share). Filters:
  Season / Last 10 / Last 5 (his games), 2PT / 3PT, Self-Created / Catch & Shoot / Drives & Cuts,
  1st Qtr / First 3 Min (for First Basket). A full season is ~4 MB, read only when the tab opens.
- Not built: alt lines.
- **Shot Charts page** (`site/nba/shot-charts.html` + `shot-charts.js` + `shot-charts.css`; NBA menu
  right under Team Identity; built 2026-10-21, the owner on the mockup: "This looks phenomenal"):
  pick an offense team + player and a defense (opens on tonight's first road team's top shooter vs
  the home defense; a new player's defense = his team's next opponent; the address keeps the pick,
  `#p=<id>&d=<TEAM>`). **Day strip** (2026-10-27, the owner: "have each team be selectable"): the
  site's day arrows + game cards, each team its own button (`.shc-slate-team`: its top shooter vs
  the other team's defense), and under it that team's roster as buttons (`.shc-roster-btn`, most
  shots first); the dropdowns stay. Left: his chart (`nbaShotZonesView` / `nbaShotHeatView`); right: every shot
  that defense allowed (shot[8]), drawn with `{allowed: true}` so the colors flip (**red = it allows
  more than the league**, legend Allows Less / Allows More). One set of filters for both (Last 10 =
  each side's own last 10 games). **Zone By Zone** table: his FG / FG% / vs Lg / Share, the same
  for the defense, the league's FG% and share, and a **Call**: Target / Tough when one side is
  2.5+ points (shrunk by `NBA_SHOT_PRIOR`) from the league and the other isn't 0.75+ the other way
  (matchupCall's rule), only on zones with 5%+ of his shots and 5+ tries. The page's own classes
  are `shc-*` (`sc-*` is the NFL Summary card's). Its global `DATA` is data.json (the card reads it).
  Tests: `tests/test_nba_shot_charts_site.py`, `tests/test_nba_shots.py`.
- Tests: `tests/test_nba_player_card_site.py`, `test_my_plays_site.py` (NbaPlays), `test_nba_props.py`.

#### Zone Matchup Targets (built 2026-10-27)

The owner: "Vegas is perfect ... But there's one gap - Shot Zone." Sabonis 24 of 26 shots in the
paint, Duncan Robinson 28 of 34 from three: where and HOW (self-created / catch and shoot / drive) a
player shoots against what tonight's defense allows **players like him** (guards / forwards / bigs:
a team can wall off bigs and still bleed blow-by layups to guards). Agreed in a 15-question Q&A:
- **Raw, no pulling toward the league, no minimum sample** ("then we just are recreating the
  sportsbooks numbers"); every read shows its shot counts and a His Shots filter. The page sets
  `NBA_SHOT_PRIOR = 0` (`let` in shot-chart.js); other pages still pull (the owner: raw everywhere
  "eventually", not yet).
- **No EV** (the owner, 2026-10-28: "i didn't want to try and calculate ev based on an artform"): no
  chance or edge ever; the main line and its best price are shown, and the record tracks W / L AND units.
- **Every player with a points or threes line** on the next slate gets a read per market, OVER /
  UNDER / Toss Up (the owner: "Maybe we call these OVERS and UNDERS"), Strong past 12%.
- Build: `nfl_tool/nba/zone_matchups.py` (`block`, in build_nba.py's shots try, its own try) ->
  shots.json `matchups` {date, games, players{id: name, team, opp, group, points / threes: score,
  shots, makes, side, strong, n, dn, line, zones[], kinds[]}, defense{team: {group: {zone: [made,
  tried, FG% rank, shots rank]}}}, league, league_n, pos{id: group}}. Score = (1 + Shots) x (1 +
  Makes) - 1: Shots = his zone shares x (the share of his group's shots this defense gives up there /
  the league's share - 1); Makes = the make rate allowed his group minus the league's, x points, by
  his zones and by his shot kinds, averaged, over his diet's league points a shot. High volume + low
  makes lands near Toss Up (the owner: show both, "i fear concluding that for a user"). Threes: his
  threes only. `zone()` = shot-chart.js nbaShotZone (a test pins it).
- Page (`site/nba/zones.html` + `zones.js` + `zones.css`; NBA menu under Shot Charts with a small
  New tag, `tag` in SPORT_PAGES / `.nav-new`): opens on **Best & Worst Spots** (Overs / Unders, top
  15, Show All; started games left out), **Matchup View** (game cards; both teams' players and each
  defense's **position grid**: `grid()` / `zmGrid`, PG-C down, the market's columns across in boxed
  groups (2026-10-28; Points: Inside The Arc = Rim, Paint, Mid; Three-Point Zones = Corner 3, Wing 3,
  Top 3; Shot Type = Self-Created, Catch & Shoot, Drives; Threes: the five 3 zones, then Catch & Shoot,
  Self-Created) + Overall, every column the same width (`table-layout: fixed`, labels wrap), each cell its rank of 30 (30th = gives up the most, red) by
  Makes / Shots / Points Per Shot (toggle), shots faced small, each row's worst cell outlined; the
  owner, 2026-10-27: "this is BOS weakness vs this position"), Points / Threes, His Shots filter; a row click
  opens his chart and the defense's chart allowed to his group (both vs his group's league) and the
  Why table (zones and shot types; 2026-10-28, the owner: "WAYYYY too wide"): his Shots / Share left
  (accent shade = how much of his diet), Zone / Type in the middle, the defense's FG, FG% vs Lg, FG%
  Rank, Shots vs Lg, Shots Rank right, only as wide as its contents; every cell red-to-green from HIS
  side (a rank of 30 = gives up the most = green there); Shots vs Lg on a log scale (full at +300%). Display prefs per device (`nba-tool.zones.v1`).
- Defense chart legends read Less Makes / More Makes, Fewer Shots / More Shots (the owner, same day).
- **Fixes the same day (the owner):** no Read cell ("redundant"; back in Matchup View only, Strong Over ... Strong Under: "it was helpful there"); Score, Shots and Makes cells on the site's full red-yellow-green scale (not green / red shades),
  (`zmShade`, through nbaShotColor); the **line = the player card's
  rule** (most books, ties lower: `main_line` / `nbaCardMainLine`, read live from data.json
  `book_odds`; the middle line had shown Walsh 1.5 threes his card didn't) with **Odds** = best price
  on the read's side across the member's books, no book name, click for every book; diet tags colored
  by that spot's Shots + Makes together for him (a red tag on an Over = the counterpoint) with a
  plain-words hover (`zmZoneWhy`); tags two lines max, same height every row, "+N" (`zmFitTags`);
  the charts get Every Type / Self-Created / Catch & Shoot / Drives & Cuts.
- **The record** (the owner: "grade based on score buckets"): `model_history/nba_zones/<season>.json`
  {game: {date, points / threes: [READ_FIELDS]}}, Over / Under reads only (no Toss Ups), rewritten until
  tip, never after (`update_record`); graded from the box scores (`box_logs`: played minutes > 0)
  against his main line then, push / sat not graded; `ledger` rows carry |score| and units at the best
  price across every book at tip (`best_price`, saved as READ_FIELDS price / book since 2026-10-28, the
  owner: "track the units for just the sake of seeing"; older reads units None), tags strong / lean, over / under. shots.json `matchups.record` {market:
  {ledger}}; the page's YTD Model Performance button = the shared tracker (Min Score slider 5-30%).
- **Past nights** (2026-10-28, the owner: "no back button to look at yesterday to analyze results"): shots.json
  `matchups.past` {market: [read + got, result hit / miss / push / sat / None]} (`zone_matchups.past`); the day
  arrows step back to Results (All Reads / Strong / Overs / Unders records, Overs and Unders lists, Strong Only).
- **Not built yet:** a key defender Out chip (with / without him on the floor; the owner flagged starters vs bench).
- Tests: `tests/test_nba_zone_matchups.py`.

#### The owner's list (2026-10-20, for when usage allows)

1. ~~Clickable NBA players with a pop-up like the other sports~~ built 2026-10-21 (the player
   card above), with its Shot Chart.
2. ~~Shot zones overhaul~~ built 2026-10-21 as the card's Shot Chart, and ~~a Shot Charts page~~
   (shooter vs defense) the same day. Points / First Basket / threes could read these zones.
3. **Alt-line ladder only with real alt prices** (SmartStake `alternate=true`) and narrow: "without
   odds its just filler".
4. **Rotation chart:** when a player usually subs in and out, who he plays the most minutes with,
   production with certain combos (the engine's stints have it all).
5. **Things to watch** per game: blend Team Identity's tags into a few conclusions on how a game
   may go.
6. ~~Rebounds and assists on the Points skeleton~~ built 2026-10-28 on the game sim (below).

#### Game model: full-game score, spread, total (replayed 2026-10-20, NOT built)

The owner asked for a final score projection and fair spread / total / moneyline.
`tools/backtest/nba_games.py` replayed 2025-26 night by night (this season's games only, like the
live rule) with three models on the engine: team points a possession and pace, the same
opponent-adjusted, and lineup-aware player ratings (all ten on the floor solved together; the
replay even knew who played). **None beats DraftKings' closing line**: margin miss 11.5 vs the
line's 10.9, total 15.3 vs 14.7, and where ours disagreed the result sided with the line. So no
fair-value "edge" on full-game sides / totals. The line can show the market's own implied score
(total / 2 +/- spread / 2). Next test: our record against Novig's OPENING lines this season
(the build would have to save them). The engine's proven edge so far is player-level (King of
the Court beat plain averages).

#### Suite switcher and launch switch

- The top menu (`addTopMenu`, sync.js, 2026-10-17): NFL, NBA, NHL and Promo Tools are buttons in
  the middle of the topbar, each opening a list of that sport's pages (`SPORT_PAGES`). It replaced
  the brand's suite dropdown; the brand now reads "GMG Sports Data Suite" on every sport.
- **LAUNCHED 2026-10-13: both suites are open to every member** (`SUITE_SWITCH_PUBLIC = true`
  in sync.js adds `html.suite-public`, which takes the guard off the NBA and NHL pages). The owner had been advertising the NHL tools while the switch was
  still off, so members who opened an NHL link got the guard's note ("GMG NHL Suite is being
  built ... Check back soon") for over two hours and the owner took the site for broken:
  "YES! I have been advertising it! Get it up and going. You can open both to the public!"
- The guard is still in the pages (`.nba-app` hidden and `.nba-soon` shown without
  `suite-public`, suite.css) and one switch covers both suites. **Never set it back to false
  unless the owner asks**; a test (`test_the_suite_is_open_to_every_member`) fails if it is.
- Members now see these pages, so a broken NBA or NHL page is a broken page for paying members.
  The deploy's gate still leaves them out (their data builds may fail on their own): check them
  with `tools/check_site.py --only nhl` / `--only nba` before any push that touches them.
- The owner-only "Update Odds" buttons were removed 2026-10-17 (the owner: the odds update on their own; ask Claude if one is needed).

#### Data: sportsdataverse / hoopR

The basketball sister of nflverse. Season files are GitHub release assets at
`sportsdataverse/sportsdataverse-data` (tags `espn_nba_*`, files named by the year the season
ENDS: 2027 = 2026-27), scraped from ESPN and refreshed daily in season.

- Checked 2026-10-11: `espn_nba_pbp` (play-by-play, ~640k plays a season, shot coordinates,
  players, clock, score), `espn_nba_team_boxscores`, `espn_nba_player_boxscores`,
  `espn_nba_schedules`, `espn_nba_rosters`, `espn_nba_depthcharts` and `espn_nba_injuries` (daily
  snapshots), plus `nba_stats_*` sets (shots, lineups, possessions).
- Parquet only is practical (the pbp CSV is 275 MB), so `pyarrow` is in requirements.txt.
- A season's box / pbp files don't exist until its first game (404). Game Previews carried both
  seasons from opening night (`stat_seasons`, opening on last season until 4 games a team); since
  2026-10-23 it is this season only (`stat_seasons` has one key, `is_fallback_season` always false).
- Not usable: `cdn.nba.com` / stats.nba.com (blocked with 403 from the user's PC and commonly
  from cloud builders). ESPN's own API (`site.api.espn.com/.../basketball/nba/scoreboard`,
  `summary`) works and is what hoopR scrapes; use it if same-day freshness is ever needed.
- **Odds: Novig** has NBA on the same public feed (`events?league=NBA`, same
  `EventMarkets_Query`). Events are matched to games by team nickname + start time. Only
  `OPEN_PREGAME` events are read, and a game that has tipped keeps the lines of the last build
  before tip-off (`apply_lines`), so in-game lines never show.

#### Build

- `nfl_tool/nba/build_nba.py --season 2027 --out nfl_tool/site/nba/data.json` (deploy.yml step
  "Build NBA data", `continue-on-error`, so it can never block the NFL deploy). Local: add
  `--cached --data-dir data/nba` to reuse downloads.
- Output: `teams`, `team_stats` (per-100 ratings, pace, four factors, 3s, paint / fast break /
  points off turnovers, each as `off_*` and the matching `def_*` allowed), `recent_games`,
  `players` (12-man rotation per team, per game + last 5), `injuries`, `schedule` (yesterday
  through 14 days out, Novig lines), `novig_debug`.
- Team keys are ESPN abbreviations (NY, GS, SA, NO, UTAH, WSH).
- `date` / `time` are Eastern on the real clock (`eastern()`, zoneinfo; a fixed UTC-4 until
  2026-10-29). Pages show `start_utc` in the member's own time zone (sync.js `gmgGameTime`).
- ESPN's `turnover_points` is points GIVEN UP off turnovers, so the sides are swapped on purpose.
- All-Star / exhibition sides appear in the box scores; only the 30 real teams are counted.

#### Pages

#### Matchup Breakdown (`site/nba/index.html` + `nba.js` + `matchup.css`, 2026-10-28)

Game Previews and Team Identity in one page (the owner: "after 3 minutes on this page i understand how
these teams win, why they lose, and what the matchup may have in store for tonight"). Agreed in a
20-question Q&A, no mockup. NBA menu: "Matchup Breakdown" (first); `identity.html` forwards here.
- **One cell language everywhere** (the owner: "Rank first then number ... so the user can always look
  for the same thing"): every cell = a rank of 30 big, its number small, shaded red to green by rank
  (`cellTd`, `scaleHsla`); green = good for that team. **How-often rows ARE colored** (the owner chose
  it): offense 1st = does it most, defense 1st = allows it least, so green against red = the offense
  gets its way. `rankIn` ranks a number among the teams' season numbers (also a wins / losses number).
- **Layout (the owner, 2026-10-28, two passes):** two anchored columns sized by their widest section
  (`.mb-grid`, `.mb-colwrap`; never stretch a box to fill the screen): **left** = The Line + Injuries,
  Biggest Edges, Head To Head, Rotations (each section the column's width); **right** = How They Win /
  How They Lose, then The Matchup; **Recent Games** across the bottom, a half each. **The columns are a
  fixed 960 / 780 px**, never sized by the night's content (sized by content, a long injury list put
  IND-PHI and ATL-MIA ~30px over and the right column dropped under the left); long names shorten
  with "...". **The Line = its four tiles in one row, Injuries full width under it**, each team a
  tinted box under its team banner, two columns inside past 4 players (the owner, 2026-10-29: "too
  much dead space"). **Head To Head's three parts sit in one row**, each its own shaded panel (blue /
  purple / amber) with its name on top, so the label column is only as wide as its labels. **Every
  team box (Edges, Win / Lose, Rotation, Recent) is tinted in its team color** (`teamBox`); The
  Matchup's halves are shaded by the team with the ball (`shadeMatchup`, measured after drawing);
  every label is full text color, never gray. Below 1860 px wide the
  columns stack (`test_long_content_never_drops_the_right_column`). **Labels sit in the far-left column** of every team-vs-team table (Biggest Edges,
  How They Win / Lose, Head To Head); **The Matchup keeps its label in the middle** (each row reads both
  directions) with the calls on the far outside. No "Has The Ball" / "Call" heads: logo + "HOU Off"
  column heads sit right under the first group's name; group headers centered.
- Sections: **The Line** + **Injuries** (compact); **Biggest Edges** (per team, its **Offense** group
  then its **Defense** group, up to 3 each, the team's own cell first); **How They Win / How They
  Lose** (the same 12 plain-word rows for every team, `WL_ROWS`, In Wins | In Losses, each ranked where
  it would sit among the 30 season numbers; the 3 biggest swings marked; "No Losses Yet" heads the
  empty column); **Head To Head** = three tables side by side: Season (record, ratings, pace, home /
  away / last 10), Points Per Quarter (Q1-Q4: **the margin big, its rank small**, colored by rank),
  Blowout Data (starters rows colored too, more = 1st) + Tonight's Spots; **Rotations** (cells shaded
  by rank on his own team, every column sortable); **Recent Games** (Spread / Total at tip, green =
  covered / over, from King of the Court's `lines_<season>.json` via `add_recent_lines`).
- **The Matchup**: one table, `[call][Away Off][Home Def] [label] [Home Off][Away Def][call]`, every
  row always. Rows (`M_ROWS`, the owner's cuts
  2026-10-28): Scoring = Pts / Possession, Pace, Transition Share, Transition Pts / Poss; Possessions =
  Turnovers, Rebounding (offensive rebound % vs the defense's own defensive rebound %), Free Throws /
  Shot; Shot Diet = 3-Point Share (no 3P%: "it will level out"), Paint Share, Paint FG%, Mid-Range
  Share, Mid-Range FG%, Ball Movement. Dropped: half-court, seconds a possession, steals' share, the
  corner / above-break split, rim vs paint split, pull-up / catch / assisted rows, 3P%, clutch,
  second-chance points. **Vs Tonight's Types**: the team that IS the type gets its rank in the trait
  (`order`), the other its points vs normal against teams like that minus the league's, ranked among
  every team that has faced the type (ranking among only the few with 3+ games read MIL's +7.2 allowed
  as "2nd"); the row shows once that team has `EX_MIN_GP` 3+ games against it.
- Calls (`rowCall`): matchupCall's rule (one side 0.6 spreads, the other not 0.3 against); transition
  scoring only for a team that runs; a make rate only where the offense shoots at least the league's
  share; Big Edge = the sides average 1 spread (a type: a 6+ point gap); how-often rows: Fits / Takes
  Away at 0.7 spreads each.
- This season only: no season buttons. It does NOT load common.js; it shares style.css, suite.css and
  sync.js (`.mb-*` styles in matchup.css). The NHL reuses suite.css's `.nba-two`, `.nba-box`, `.nba-app`.
- Tests: `tests/test_nba_matchup_site.py` (BOS @ DET on `identity_2026.json`), `test_nba_identity.py`
  (the numbers), `test_nba_previews_seasons.py` (stats blocks, Recent Games' lines).

#### First Basket (built 2026-10-20, opening night)

Who scores a game's first points. The owner turned down a predictive pick board: "i would rather
this page be the pieces of the puzzle with data for users to solve", with a fair-value guess at
the bottom only. Then, on the plain data mockup: "very data heavy ... no color coding or player
images. I like Team logos too", so it uses the site look (team-color banners, logos, ESPN
headshots, red-to-green `scaleHsla` cells, "i" bubbles for the explanations).

- **Any first points count, free throws included** (the owner: most books settle it that way), **and so does every "shot" count** (Shot Early, 1st Shot, Team Share 1st Shot, First Look; the owner, 2026-10-26: "Why on earth would we count them in one category but not another"). Fair never read them (its shot volume was already FGA + 0.44 FTA).
  "First field goal allowed" is field goals only, as asked.
- **Build:** `nfl_tool/nba/first_basket.py`, called by `compute_first_basket` in build_nba.py (its
  own try: a failure leaves `first_basket: null`). Reads `espn_nba_pbp/play_by_play_<season>.parquet`
  (22 MB a season) for both seasons. Output `first_basket`: `seasons[<year>]` (`label`, `games`,
  `league`, `teams`, `players`), `slates[<year>]` (`{game id: {away, home, fair}}` for the next 3
  nights: likely starters, jumper, fair guess), `default` (this season; until 2026-10-23 last
  season's block supplied the likely starters and the Value record while teams had under 4 games).
- **From the play-by-play:** the opening `Jumpball` names both jumpers; its `team_id` is the team
  that got the ball, and the jumper on that team won it. Possessions to first points: a team starts
  a possession on its first shot, turnover or rebound after the other team's (fouls without a shot
  don't, so the count runs a hair low). 2025-26: the tip winner scored first 66.6%; free throws were
  the first points in 9%; 2.02 possessions and 55 seconds to a team's first points; first field
  goals by guards 44%, forwards 37%, centers 19%.
- **Starting fives: the NBA's own lineup file** (the owner: "nba is big on lineups so making sure
  thats fast and accurate is key"). `stats.nba.com/js/data/leaders/00_daily_lineups_<YYYYMMDD>.json`
  (what nba.com's Today's Lineups reads; answers from the owner's PC though `cdn.nba.com` doesn't)
  lists each team's five as `Expected`, then `Confirmed` once the team turns it in (~30 min before
  tip), with position, `rosterStatus` and a timestamp. Only that day's file exists (later days 404).
  Read **live**: `/api/nba-lineups?date=YYYYMMDD` in `_middleware.js` (members only) fetches it and
  keeps it 60 s in Cloudflare's cache; the page asks on load and every minute while the night isn't
  over. Fallbacks: the build's copy (`first_basket.lineups`, fetched every build), then the build's
  likely starters ("Our guess"). Each team's banner says Confirmed / Expected / Our guess. Names are
  matched to our players by team + name (`roster`: every rostered player's ESPN id); a starter with
  no numbers (a rookie) shows with "new" and the NBA's headshot. The jumper, tip and fair guess
  follow the five shown (`fairPrices` in the page = `fair_prices` in Python; a test pins them).
  Twitter/X (Underdog NBA) was ruled out: reading it needs a paid API (~$200 a month) and scraping
  breaks X's rules. On opening night the NBA had SA's Dylan Harper starting where our guess had
  Tobias Harris.
- **Likely starters** (our guess, before the NBA posts a five): on the team today (roster file), not
  listed Out, starting in at least half the games he played, most minutes first. Ranking by start
  counts dropped Wembanyama (missed games) from the 2025-26 Spurs. **Jumper:** most jumps among
  them (at least `MIN_JUMPS` 2); with the NBA's five and no jumper on file, its listed center.
- **Prediction** (the tip chance; 2026-10-21, the owner: a jumper who only met Wembanyama and one who only met
  guards can't be read off Tips Won): `tip_ratings` = every OPENING tip of THIS season (held balls and overtime tips left out,
  the owner 2026-10-21: "dirty data which can skew"; `jump_balls`, winner = the jumper on the side that got the ball, never
  ESPN's name order), opponent-adjusted (Bradley-Terry), each rating starting from height
  (`TIP_PER_INCH` 0.15 from the roster file's height, `TIP_PULL` 3). data.json `first_basket.tip`
  = {ratings, heights, record, jumps}; every season view uses this season's (NBA rule). 2025-26
  replay (`tools/backtest/nba_tips.py`, each tip from the tips before it): opening tips only 63% right / log loss 0.627 (every jump ball was 64% / 0.627), vs 61% / 0.644 for
  steadied Tips Won, 60% for height alone; 5+ inches taller won 84%, 1 inch 50%. Home teams won
  52.9% of tips (noise-sized), so the tip's Home/Road row was dropped.
- **Fair** (`fair_prices`, rebuilt 2026-10-21 on a 2025-26 replay, each team-game from the games
  before it; the owner: "bake all the projections and data and likelihood into a fair price"):
  **Scores First** (`team_chance`) = Prediction x `TIP_WINNER_SCORES` 0.666 + the rest; trips to
  score / allow, after-tip rates and Scores First rates added nothing once the tip was known.
  His share of his team's first points (`first_shares`) = half (shots a start, FGA + 0.44 FTA,
  `shots`)^0.5, half Team Share 1st Pts steadied `TEAM_SHARE_PRIOR` 20 starts toward his
  teammates; x 0.96 (`BENCH_SHARE`). Who scores a team's first points is near random: this blend
  hit 25% (blind 20%); the OLD Fair (game first points a start) fit worse than an even split;
  **position vs the defense made every version worse** (no Position tag). **This season's
  players only** (`now` = this season's block, every season view; NBA rule), so before a team has
  games its five sit even (opening week: every starter the same price).
- **Value** (the owner chose "show value now", 2026-10-21: "as games are played it will level
  out"): our chance `VALUE_EDGE` 10%+ above Novig's implied (`is_value`). Green Value tag on the
  row; the third box (was Targets) lists the game's Value starters (Fair vs Novig) and the
  **record**: `model_history/nba_first_basket/<season>.json` (`first_basket_record` in
  build_nba.py; deploy bot commits it) = each game's ten as the last build before tip had them
  ({id: [name, chance, Novig, Value]}, a started game never rewritten), **from `FB_RECORD_START`
  2026-10-23** (the owner: "start fresh tonight" now that it's this season only; earlier nights are
  dropped from the file on the next build), `result` {team, scorer}
  from the play-by-play; `first_basket.record` = {plays, won, units (1u at Novig), games}. The
  record uses the build's starters (the NBA lineup copy isn't applied there), the page the live five.
- **Testing banner** (2026-10-23, the owner: "add the beta header on first basket"): the testing
  banner (styles in suite.css; Points / Threes had it until their sim, 2026-10-24, and again from 2026-10-25) at the top: Beta, Projections In Testing Until
  Mid-November, the caution line, and on the right the **Value Record So Far** with the YTD Model
  Performance button (it sat beside the season buttons before).
- **YTD Performance** (the owner, 2026-10-21: "a pill next to the years ... brings up a modal with
  the history"): a pill after the season buttons ("YTD Model Performance" since 2026-10-22) opens a
  window (`renderYtd`, book-odds.js's `ensureBookModal`) with the shared tracker (styles.md, "YTD
  Model Performance"): Tip Prediction and Scores First with a Min Chance slider (50-75%), Value Plays
  with a Min Edge slider (our chance over the price's, 10-100%; each Value play in `history` carries
  it as a fifth item since 2026-10-22, older ones count at 10%), and every graded game in the window
  newest first (picks under their slider show "--"): our tip pick (jumper, chance) vs who won it, our Scores
  First pick vs who did and the scorer, the Value plays at their price; right = green, wrong = red.
  A pick = the side over 50% (exactly 50% = no pick). From `record.history` (build_nba.py
  `first_basket_record`), which also saves `tip_home`, `jumpers` and `result.tip` from 2026-10-21
  on (earlier games' result.tip is filled in on the next build; their tip pick shows "--").
- **Tags** beside names (this season's numbers): **Value** (green), **Top Option** (most shots a
  start among the five), **First Look** (his team's first shot in 25%+ of 5+ starts), Jumper.
  Ideas not built: Usage + (a high-shot teammate Out), FT Early.
- **The page** (`site/nba/first-basket.html` + `first-basket.js` + `first-basket.css`; NBA menu
  under "Player props"): day strip, season buttons, then **Starters (both teams stacked) on the
  left, The Matchup with Value under it on the right, the same width (380 px); tops and bottoms
  level** (the owner, 2026-10-21: "I don't like the different levels": the Starters box stretches
  to the right column's height and Value fills what's left; `.fb-side`). Under 1000 px it stacks.
  Before 2026-10-21: three boxes side by side, Matchup | Starters | Targets ("box box box").
  How it got here (2026-10-20): tile sections with team cards and a split bar were "overwhelming ...
  so much dead space ... too many numbers all spread everywhere"; then one stacked table was
  "significantly improved" but the owner wanted "Simple. KISS" and wrote the rows themself.
- **The Matchup** (`renderMatchup`, `matchupRows`): ONE table, road team's value left, home team's
  right, the stat name in the middle with an **Edge** pill (better side's logo, when they're `edge`
  apart). The owner's rows, Title Case, nothing else: The Tip (Jumper with height, Tips Won, Prediction (the tip chance, named by the owner); its
  name sits between the team banners so no empty row sits under them), Scores
  First (Scores First, Home/Road, After Winning Tip, After Losing Tip), Opening Trips (Avg Poss. To
  Score, Avg Poss. To Allow), First FG Allowed (Point Guards, Shooting Guards, Small Forwards, Power Forwards, Centers; five
since 2026-10-21). **Removed on purpose:**
  game-count subtext, league averages, "fair guess" rows ("Wins the tip": "you're making a guess
  here and that's not evident. We can make predictions else where"), the 1st-quarter margin and
  the seconds rows. Group headers centered over the middle. **Every row one fixed height (28 px;
  38 px on phones), centered**, column 380 px (tightened 2026-10-21: "too wide ... too tall") (the owner: "keep them all consistent"). Each value colored against
  the league from its own team's side (green = good for that team; First FG Allowed: red = that
  position scores first on them often). **Colors = distance from the league average in league
  spreads** (`zHeat`, full color at 1.5 SD): picked over worst-to-best (one outlier stretched it)
  and rank (near-ties a color apart); the owner asked if it would turn all yellow with more data:
  no, the spread tightens with the league, so the color mix holds.
- **Targets: retired 2026-10-21** for Value. On CHA-BKN CHA led the tip, scores first and opening
  trips, yet Targets listed BKN's forwards ("Laughable"): who scores first IF a team does never
  asked which team is likelier to. Its position / tip / quick-start rules are gone from the page.
- **Starters**: one compact table per team, both the width of the wider one (banner: the team's
  **Scores First** box, colored from 50/50, and the lineup tag): Shot Early / 1st Shot / Scored 1st / **Team Share** (1st Shot, 1st Pts: his own team's
  first shot and first points whatever the other team did, `team_first_shot` / `team_first_pts`, in
  a thin box; the owner, 2026-10-21) as % with "x of y" under, **Fair** (our guess) and
  **Novig** (Novig's First Basket price), likeliest first. Team numbers are colored against all 30
  teams, players against every starter **from his first start** (`MIN_STARTS` 1 since 2026-10-23, the
  owner: "the color coding is not showing"; at 15 nobody qualified this early; jumpers from 1 jump).
  The Matchup's jumper name shortens ("..."), never his height.
- **Book prices: Best = SmartStake, then Novig** (the owner, 2026-10-21: SmartStake added the first
  point market; "relabel NOVIG to BEST"). `smartstake.add_first_basket` (called by
  `fetch_nba_book_odds`; keys from `first_basket_market_keys`: a player market for the game's first
  points / basket, no team / quarter / half / field-goal-only markets; falls back to
  `basketball_first_points_scorer`) puts every book's Yes into `book_odds["AWAY_HOME"].props.first_basket`
  by ESPN id; `book_odds_debug.first_basket` says what came back. **The sportsbooks (DraftKings, FanDuel,
  Caesars, theScore...) send 1st Points Scorer as ALTERNATE quotes, Yes only; the exchanges (Novig,
  ProphetX, Fliff) as a main Yes / No**, so it is fetched with `alternate=True` (the probe,
  2026-10-21: main lines only got just the exchanges). Locks at tip like every price.
  The **Best** column = `bookPricePill` (best across the member's books); a player no book lists
  shows Novig's own price, labeled Novig, not clickable (Novig's public feed `FIRST_BASKET` market,
  read in `fetch_novig_lines` into each game's `first_basket`, a `LINE_FIELDS` member). Value and
  the record use the best price (the record: best across ALL books, `best_price`, with its book).
  (2026-10-20 it was Novig only: "SS bad idea ... until SS can fix their offerings".)
- **Saving a play:** clicking Best opens book-odds.js's every-book window with `spec.save`; each
  book's price is a button that saves the play to My Plays at that book and price (another price
  switches it, the same one removes it; a check mark shows on the row). NBA plays:
  `nfl-tool.nba-plays.v1` (sync.js `loadNbaPlays` / `saveNbaPlays`, in both sync key lists), entry
  `{id: nba:fb:<game>:<player>, sport, market: first_basket, category: First Basket, date, game_id,
  matchup, team, player_id, description, logo, color, book, odds}`. My Plays grades them from
  `first_basket.results` ({game id: first scorer id}, this season's games): his id = win, anyone
  else = loss, no scorer on file = void. A player who didn't play is graded a loss: set Void by hand.
- Tests: `tests/test_nba_first_basket.py` (the build on two hand-made games, and the page).
- Not built yet: a Summary card; the record on the page is Value tags only (no calibration view yet).

#### King of the Court (Promo Tools; built 2026-10-19)

DraftKings' promo paid on the night's most points + rebounds + assists (PRA). The owner ran it
last season from a spreadsheet and wanted the same setup, built for the 2026-10-21 slate:
- a **defense board** (each team's 40 / 45 / 50 / 55 / 60+ PRA games allowed, colored, with a
  score: "do teams let certain stars beat them or do they play top to bottom solid D?"), plus
  **position vulnerability** (their ask);
- a **player board** (each player's games in those buckets, a score, the opponent's matchup score,
  a blended GMG number);
- a 2025-26 / 2026-27 toggle (removed 2026-10-22 with last season's data, below);
- **historic stats on nightly leaders** (games on the night, the winner's PRA, and anything about
  the game total / spread that narrows it down). They skipped the mockup to save usage: build it,
  then small tweaks.

- **Build:** `nfl_tool/nba/kotc.py`, called by `compute_kotc` in build_nba.py (its own try: a
  failure leaves `kotc: null` and Game Previews still builds). Output `data.json` `kotc`:
  `seasons[<this season>]` (`label`, `league`, `defense`, `players`, `nights`, `summary`),
  `slates[<this season>]` (`{date: rows}` for the next 3 nights), `default` (this season),
  `past` (`{date: {season_used, games, best, rows}}`: every recorded night before today, `kotc.past_nights`:
  everyone on its pregame board plus the night's 40 best PRA lines, each with pts / reb / ast /
  pra (None = didn't play) and the board's `rank` / `lead` / `proj`), `weights`, `thresholds`, `record`.
- **This season only since 2026-10-22** (the owner's list that day): no season toggle, no
  `PRIOR_GAMES` seed (the constant stays for the replay). Early on a player needs
  min(`MIN_GAMES` 3, half his team's games rounded up) games, so a team two games in has players.
- **Buckets are cumulative** (a 52 counts in 40+, 45+, 50+). Score (1 x 40+ ... 5 x 60+) is still
  built but no longer shown: the owner, 2026-10-22, "Score and matchup feel arbitrary right now -
  i dont know what they truly mean". Matchup (the other defense's Score) became **Opp Top**: the
  other defense's `star`, the most PRA any one opponent had against it, average a game (real PRA).
- **Positions are PG / SG / SF / PF / C** (positions.py, 2026-10-21): the board, vs Pos, the defense
  board's five columns and Who wins it. A defense's position number is PRA per 48 minutes allowed to
  that spot, steadied with 10 games of the league's rate (`pos_f` = against the league).
- **The projection's matchup still reads ESPN's G / F / C** (`grp`, `grp_f`): on the 2025-26
  replay the five positions put the leader in the top 5 61% of nights vs 64% (fit 0.68 vs 0.91),
  thinner samples and last season's players on today's spots. Kept under the first-week rule;
  **ask the owner** before switching (`py tools/backtest/nba_kotc.py --five-matchup` replays it).
- Players sit on the team today's roster file lists them with.
- **The projection** (`project`, `WEIGHTS`): base = half season average, half last 10; times the
  other defense's `pos_f` (exponent 1.0); times (game total / league average total)^0.2. **Lead %**
  (`lead_chances`): 6,000 runs of the slate with each PRA drawn around its projection (sd 4 + 0.22 x
  proj); ties split. Players ESPN lists Out stay on the board, grayed, with no chance.
- **The replay** (`py tools/backtest/nba_kotc.py`, about 2 minutes; findings in its header): every
  2025-26 night after the first 15, projected only from games before it. Fitted: position matchup
  0.99, total 0.17, blowout (spread past 6) -0.0025 a point, back-to-back +0.007: **blowouts and
  back-to-backs are 0 in the number**, shown as tags only. The leader was the board's #1 30% of
  nights, top 5 64-67%, top 10 83% (plain PRA average: 27 / 63 / 79). Lead % honest (said 14%, led
  14%; said 26%, led 27%). The replay knew who played; the live page only has the injury report.
- **Lines:** last season's are `nfl_tool/nba/lines_2026.json` (`{game id: [total, home spread]}`,
  made once on 2026-10-19: DraftKings' closing total and spread from ESPN's `summary` endpoint's
  `pickcenter` for 979 of 1,235 games, the play-by-play file's spread for the rest; ESPN's scoreboard
  has no odds for past dates). This season's are each game's Novig line at tip-off, saved by the build
  in `model_history/nba_kotc/lines_<season>.json` (committed by the deploy bot).
- **The record** (`model_history/nba_kotc/<season>.json`): each night's top 60 (30 until 2026-10-22; payouts on longer shots need their chance) by Lead % as the last
  build before the night's first tip had it (`kotc_record`; a started night is never rewritten). The
  page's Nightly leaders show the winner's place on it ("Pre 3"). NBA builds run every 6 hours and on
  pushes (no half-hourly refresh like the NHL), so a night's board can be up to 6 hours old at tip.
- **Historical Data** (`summary`, computed every build): four tiles with one label each, no
  subtext (the owner, 2026-10-21, their wording: AVG Winning PRA = `mean`, Winners Team Favored,
  Winners AVG Game Total, Winner in Top 5 as one number, 65%); winning PRA by slate size (typical, colored
  low to high, middle half, best; centered, no note under it), the leader's game total and spread against the games on those nights (2025-26: 240+
  totals 1.31x their share, under 220 0.37x; spreads 0-3 1.22x, 10+ 0.77x; the leader's team was
  favored 70%), positions (guards 47%), most nights led. This season's only, however few nights (last season's
  reference came off 2026-10-23).
- **The page** (`site/nba/promo-tools.html` + `kotc.js` + `kotc.css`): night arrows that step back
  through every finished night (`past`) and ahead through the slate, Save image; **the player board
  and the defense board side by side** (the owner, 2026-10-22: "defense chart to sit up beside the
  player data"; they wrap when the screen is too narrow), Nightly Leaders and the payout box below
  (outside both images). Player board: top 25, "Show all"; Lead %, Proj, Avg, buckets, Opp, Opp Top,
  vs Pos, Total, Spread (+ Est Pay, below); green = good for him; B2B and blowout tags. **L10 is
  gone** ("so closely related" to Proj) and so is the "from XXX" tag ("by next week we know").
  **A finished night** shows its pregame board against what happened: Pre (board place), PRA,
  P / R / A, Lead %, Proj, Opp, Paid; the winner(s) starred, didn't-play last (DNP). Defense board:
  red = bad defense (the owner's sheet); teams not playing dimmed; its own Save image; "Hide Teams Not
  Playing" (colors still against all 30); default sort Top Opp; **Targets** = the other team's top 3
  by Lead % (of the night's top 100; the owner 2026-10-22, was every one of the top 100). On a finished
  night it shows today's numbers with that night's teams and pregame board. No projection math.
  Headshots and logos are ESPN's (html-to-image can carry them).
- **Ties** (the owner, 2026-10-22: Edwards and Jerome tied at 58 and only Edwards showed): every
  co-leader counts. Nightly Leaders gives each his own line (logo, name, O/U and spread under it,
  his Pre, his Paid) and a Tie tag; a finished night stars every winner; Historical Data splits a
  tie night between them for shares (positions, total / spread mix, favored, the winner's total) and
  gives each a full night in Most nights led; Est Pay's fit leaves out a tied winner's payout (a
  split pool says nothing about how many were on him alone).
- **Payouts** (the owner, 2026-10-22: "a place to update what payouts were/could have been ... reverse
  engineer potential payouts based on prize pot, position on projections"): the owner's box (html.is-owner
  and localhost) picks a finished night, the Prize Pool, and DraftKings' pasted list ("Name - $140 in
  Bonus Bets", matched to that night's `past` rows by name, accents dropped, else a unique last name).
  Saved to `/api/court-payouts` (D1 `court_payouts`, the shared promo-payouts handler in _middleware.js;
  members read, owner saves). Shown as Paid on the finished night and on Nightly Leaders. **Est Pay**:
  once `FIT_MIN` 6 logged payouts have a pregame Lead %, log(paid / pool) is fit as a straight line on
  log(Lead %) (favorites are on more entries, so they pay less) and the board gets an Est Pay column
  at the latest logged pool. Unproven until it has a few weeks of nights.
- Tests: `tests/test_nba_kotc.py` (the build on a hand-made season) and `tests/test_nba_kotc_site.py`
  (the page on a data.json built from it; `SiteBrowser.nba` serves it).
- Not built yet: players' PRA lines from the books (SmartStake / Novig), a with/without-teammate
  usage bump, pace, Est Pay by slate size (one line for every night for now).

## 2026-10-29: the NHL rules file before the trim (word for word)

`.claude/rules/nhl.md` was cut from 1,334 lines to the rules alone (it loads on every NHL session). Its full text as it stood that day, with the owner's words, dates and replay numbers behind each rule, is kept here; headings pushed down two levels.

### GMG NHL Suite

Started 2026-10-13, a week into the 2026-27 season (84 games a team this year, 1,344 in all).
Third suite on the same site, reached from the suite dropdown. **Open to every member since
the evening of 2026-10-13** (one switch with the NBA suite: see nba.md, "Suite switcher and
launch switch"). More background: `docs/history.md`, "NHL".

#### Files (moved here from CLAUDE.md, 2026-10-25)

- Build: `nfl_tool/nhl/build_nhl.py` -> `site/nhl/data.json`, `nhl/shots.json` +
  `nhl/players/<TEAM>.json` (games kept in `data/nhl`). Models: `shots_model.py` (shots on goal),
  `saves_model.py` (King of the Crease + Saves page, `nhl/saves.json`), `goals_model.py` (anytime,
  `nhl/goals.json`), `points_model.py` (1+ point on top of goals, `nhl/points.json`),
  `lines_model.py` (Line Matchups, 5-on-5 lines and pairs from the shift charts, `nhl/lines.json`;
  replaced Line Stacks 2026-10-21, whose `stacks_model.py` stays for the replays).
- Pages (`site/nhl/`): `index.html` + `nhl.js` Game Previews; `shots`, `goals`, `points`, `saves`
  (`.html` + `.js` each); `lines.html/.js` Line Matchups (a preview, no picks); `best.html/.js` Best
  Plays (the pages' edges in one list); `promo-tools.html/.js` King of the Crease + `icebreaker.js`
  (quickest goal of the 7 PM slate); `nhl-common.js` shared by every page (data, rink drawing, the
  NHL player card, the save box `nhlPlayBox`); `nhl.css`.
- Records (`model_history/`): `nhl_shots/<month>.json`, `nhl_goals/`, `nhl_points/` (with each
  number's factors), `nhl_saves/`, `nhl_stacks/` (retired), `nhl_crease/`, `nhl_icebreaker/`.
- Replays: `tools/backtest/nhl_*.py` (shots, saves, goals, points, stacks, icebreaker);
  `tools/nhl_factor_report.py` groups the records by each graded play's saved factors.
- Hockey refresh: `.github/workflows/nhl-refresh.yml` every half hour, pressed by the Cloudflare
  timer `workers/nhl-timer` (installed by `nhl-timer.yml`).

#### Data: the NHL's own public feed (no key)

- **Do not use MoneyPuck** (moneypuck.com). Its data page allows non-commercial use only and says
  unapproved scraping is blocked; this site has paying members. Everything MoneyPuck starts from
  is in the league's feed, so the numbers are worked out here instead.
- No source explicitly permits commercial use: NHL.com's terms read "personal, non-commercial",
  the same footing as the ESPN and NFL feeds behind the other suites. The user was told.
- `api-web.nhle.com/v1`: `schedule/{date}` (a week at a time), `standings/now` and
  `standings/{date}`, `gamecenter/{id}/play-by-play`, `gamecenter/{id}/boxscore`. Also there,
  unused so far: `gamecenter/{id}/landing` (pregame goalie and skater comparison) and the EDGE
  tracking pages (`edge/team-detail/{teamId}/{season}/2`,
  `edge/team-shot-location-detail/...`: shot speed, skating speed, zone time, shots in 17 areas).
- `api.nhle.com/stats/rest/en`: `game?cayenneExp=season=20262027 and gameType=2` (the whole
  season's game list in one call; `gameStateId` 6 / 7 = finished), `team` (ids), the season
  reports `team/powerplay`, `team/penaltykill`, `skater/timeonice` (`limit=-1` = every row).
  Unused so far: `shiftcharts?cayenneExp=gameId=...` (who is on the ice: line combinations).
- **Play-by-play** gives every shot on goal, miss, blocked shot, goal, hit, faceoff, giveaway,
  takeaway and penalty with `xCoord` / `yCoord` (feet from center ice; goal lines at x = ±89),
  shot type, shooter, goalie and `situationCode` (four digits: away goalie, away skaters, home
  skaters, home goalie; `1551` = five a side).
  - `homeTeamDefendingSide` says which end the home team defends that period. `normalize_xy`
    turns every shot so the net attacked is at x = +89 and the shooter's left is +y. Checked on
    all of 2025-26: 109,571 of 109,571 offensive / defensive zone shots agree with the feed's own
    zone code, and left / right leans match the NHL's EDGE "L" / "R" areas.
  - A blocked shot is logged where it was BLOCKED and its `eventOwnerTeamId` is the shooter's
    team, so blocked shots count as attempts but are never placed on the rink.
- **ESPN** (`site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries`): injuries. Teams and
  players are matched to the NHL's by name with accents dropped (`plain`).
- **Novig** has NHL on the same feed (`events?league=NHL`, same `EventMarkets_Query`). Game
  lines: the consensus MONEY, SPREAD (the puck line, 1.5) and TOTAL. Player odds (below):
  PLAYER_GOALS, SHOTS_ON_GOAL, POINTS, ASSISTS, FIRST_GOAL_SCORER, and SAVES (goalies; it first
  appeared the afternoon of 2026-10-13). Unused so far: TEAM_TOTAL, POWER_PLAY_POINTS. Futures
  events (no " @ ") are skipped.
  - **Saves is a thin book** (`saves_lines_from_event`): a main line often has one price or none.
    The line is kept anyway (it still says where the market is); the over's fair chance is
    Over/(Over+Under), a lone ask / 1.05, or 50% with no price, held to 35-65%
    (`saves_over_chance`). Goalies with no game this season are kept by name (`id` None).
  Same odds lock as NBA: only `OPEN_PREGAME` events, and a started game keeps the lines and the
  player odds of the last build before puck drop (`apply_lines`, `locked_player_odds`).
- **The NHL's "projected lineups" story for every game** (NHL.com's game preview, found
  2026-10-13): `forge-dapi.d3.nhle.com/v2/content/en-us/stories?tags.slug=gameid-{id}&tags.slug=game-preview&context.slug=nhl`
  lists the story, its `selfUrl` has the text (`parts`, type `markdown`). Plain text: a
  "<Team> projected lineup" heading, one line of text per forward line ("A -- B -- C") and defense
  pair ("A -- B"), the goalies one to a line (**the first is the expected starter**), then
  "Scratched:" and "Injured:", then a "Status report". **The game tag is typed by hand:** on
  2026-10-22 Red Wings at Canucks was tagged with Utah at Seattle's id and the Canucks game had
  none, so both went without a lineup. A story counts for a game only if every team it lists plays
  in it, and a game whose tag has no fitting story is matched from the day's preview stories (slug
  ends "-game-preview-october-22-2026"; `day_lineup_stories`). Test: `test_nhl_lineup_stories.py`. Posted around midday Eastern on game day
  (some West-coast games later), so the 8:17 am ET build has none; the hockey-only refresh (`nhl-refresh.yml`, every half hour from
  midday to the last puck drop: members-and-hosting.md, "Build minutes") picks each one up. 1,300 of 2025-26's 1,312 games had one; 95% of the skaters listed did play. Old seasons'
  stories are still served. `parse_lineups`, `lineup_slots`, `fetch_lineups`.
  - The story is typed by hand. Two things it does (both met 2026-10-13): a team dressing seven
    defensemen lists the seventh **on his own line above the goalies** (Victor Hedman was read as
    Tampa Bay's starting goalie), and a pair can lose a space ("Tony DeAngelo --Scott Mayfield").
    So lines are split on `--` alone, and a lone name is a goalie only if the site doesn't know
    him as a skater and he is one of the last two; any other lone name is a skater in the lineup
    with no line or pair (`slot` None: on the Shots page he is under All, not Lineup Confirmed).
- **Confirmed starting goalies:** not in any feed, but the expected starter is the first goalie
  in that story (`shots.json` `lineups[game][team].goalie`). Game Previews' Goalies table tags the expected starter from crease.json (`starterRow` / `starterTag` in nhl.js; owner's request 2026-10-17): "Expected starter", a check mark when the lineup and the book agree, never "confirmed".
- **Not built:** expected goals (xG). It is a model on shot location and type, not a feed field;
  sportsdataverse publishes an open one (`nhl_xg_models`, license not checked).

#### Build (`nfl_tool/nhl/build_nhl.py`)

- `--season 2027 --out nfl_tool/site/nhl/data.json --data-dir data/nhl` (seasons are named by the
  year they END, like the NBA build; the NHL's own id is `20262027`). Regular season only.
- **Games are downloaded one at a time and kept.** Hockey has no season files like nflverse or
  hoopR. Each finished game's raw play-by-play + box score is saved to
  `data/nhl/games/<season>/<id>.json.gz` once the league marks it official (`gameState` "OFF"),
  and never downloaded again. The raw game is kept (about 17 KB), not the totals, so new stats
  can be added without re-downloading.
- deploy.yml: "Restore saved NHL games" / "Save NHL games" (GitHub's cache, `nhl-games-*`) carry
  `data/nhl` between runs; "Build NHL data" is `continue-on-error`, so it can never block the
  NFL deploy. A lost cache just means the season so far is downloaded again (2025-26's 1,312
  games took about 4 minutes from the user's PC).
- **This season only: no last-season file.** `prior_2026.json.gz`, `--write-prior`,
  `default_view`, `team_stats_prev`, `prev_season_label`, each player's `prev` and the player
  files' `prev` were removed 2026-10-13 (see "This season only" below). The file is in git
  history; the replays download a past season's games themselves.
- `reduce_game` boils one game down to team counts, skater lines and goalie lines; the season
  numbers are sums of those. Shootouts count only in the final score. Checked against the
  league's own 2025-26 reports: goals exact, shots on goal within 0.07 a game, 5v5 shooting %
  exact.
- **Rink areas** (`shot_area`; the same shapes are drawn by `RINK_ZONES` in nhl-common.js, change
  both together): `low_slot` (the box in front of the net to the faceoff dots, 9 ft either side: the
  usual "high danger" area), `slot` (the rest of the "home plate" up to the top of the circles),
  `left` / `right` (beside it, as the shooter sees it, including behind the goal line), `point`
  (top of the circles to the blue line), `long` (outside the zone). Area numbers leave out
  blocked shots, empty-net shots and penalty shots.
- `reduce_game` also counts each team's unblocked shots a man up (`unb_pp`), which the shots
  model reads as "power-play shots allowed".
- Output: `teams`, `team_stats` (every stat as `off_*` and the matching
  `def_*` allowed, plus record, power play, penalty kill), `recent_games`, `skaters` (12 forwards
  and 6 defensemen a team), `goalies`, `injuries`,
  `schedule` (yesterday through 14 days out, Novig lines, `away_rest` / `home_rest` days),
  `player_odds` (`{game id: {player id: odds}}`), `league` (each area's share of shots and
  shooting %, under `season`), `novig_debug`, `feed_debug`.
- **Player files** (`write_player_files`): `site/nhl/players/<TEAM>.json`, one per team, written
  next to data.json on every build and not tracked by git. Each holds, for everyone whose latest
  game was with that team, under `season`: the game log (one row per game: `log_lead` then
  `skater_cols` / `goalie_cols`), `areas` (skater `{area: [shots, on goal, goals]}`, goalie
  `{area: [shots faced, goals]}`), and for skaters `types` (shot type: `[shots, goals]`), `unb`
  and `pp_unb`. The page loads a team's file when one of its games is opened, so data.json stays
  small (the files are about 10 KB each early in a season; they were 80 KB with last season's logs).
- **Player odds** (`player_odds_from_event`), same spirit as the NFL build's TD odds:
  - Over / unders (`sog`, `points`, `assists`) use the consensus line only and need at least
    one side priced; `thin` = one side missing or the two asks adding past 115%.
  - The other shots-on-goal and goals lines ride along as ladders (`sog_alts`, `goal_alts`:
    `[line, over price]`).
  - Anytime goal (`goal`) = goals over 0.5. One-sided prices are kept (most depth players have
    no "No"); the chance is Yes/(Yes+No), or Yes times the game's median fair/Yes ratio. Dropped:
    Yes above 0.95, or Yes+No above 1.5.
  - **First goal: most of Novig's prices are placeholders.** On 2026-10-13 one game listed 27
    of 31 skaters at 21-27% with nobody on the other side (defensemen included). A one-sided
    first-goal price is kept only if it is at most half the player's own anytime price
    (`FIRST_GOAL_MAX_SHARE`); chances are scaled down if they add past 100%, never up. Expect
    only a few first-goal prices a game until that book fills in.
  - Players are matched to the NHL's ids by `player_finder`: exact name (accents dropped), then
    last name + first initial on the team, then a name only one player in the league has. Two
    possible players = no match (never a guess).
- The power play and penalty kill come from the league's reports; `def_pp_pct` (what a penalty
  kill allows) is `1 - pk_pct`, so a power play row reads both sides.
- Times use the offset the feed gives for each game (`easternUTCOffset`), so the November clock
  change is already right.
- `lineup` discounts ice time for a player with only a game or two (the lineup-aware usage rule),
  **never for one who dressed in his team's latest game** (`last_dressed`): Charlie McAvoy came back
  2026-10-13 after six games out, played 24:41, and the discount ranked him 8th of Boston's 8
  defensemen, so he was on no prop page until a lineup was posted (a member found it, 2026-10-16).
- **Tripwire** (`unlisted_priced`): a player with a Novig shots line in a game not started who is on
  no prop list goes to data.json `feed_debug.unlisted`, the build log, `version.json`
  `nhl.unlisted`, and a (never blocking) PROBLEM in `check_site.py`, so the daily site check
  reports it. `nhl.unmatched`: book names matching no player the site knows (one yet to play).
- Team colors are `TEAM_COLORS` (ESPN's; teams whose main color is black use their second).

#### This season only, everywhere (the user's rule, 2026-10-13, said three times)

The third time, for the whole site: "is the last season data on NHL slowing things down? ... It
really isn't relevant to me and if we need to scrap all past season NHL data I would be fine with
that. currently it defaults to last season anyway which i hate. Let's scrap all of last years
data on the site - if youd like to keep it archived for running tests on models thats fine."
So there is no last-season number on any NHL page, no season switch, and Game Previews opens on
this season with a "small sample" note until the middle team has played 10 games. (It was not
slowing the build: the old file was read from disk. The pages got lighter: data.json 1,217 KB to
828 KB, the player files 2,717 KB to 313 KB.) Do not re-offer last season as a fallback.

The first two times, for the prop tools:


"For shots/goals/points/saves I think it would be best to JUST use the current season and
understand that for awhile the sample will be small. A small sample of current form and style is
more accurate than a previous season with bad data." Then, when a fade-out was offered: "I don't
want a gradual fade out. I don't want last season's data in the model for shots at all."

- **No last-season data in any NHL prop model** (shots now; goals, points, saves when built): not
  a player's old rate, not a defense's old numbers, not as a starting point that fades. Do not
  re-offer a blend.
- What a small sample is steadied with must come from this season too (this season's league
  averages), and every number shown on a prop page is this season's.
- The user was shown what this costs (below) and chose it. The cost is real for the first 10-20
  games of a season; say so again only if they ask why the page looks the way it does.

#### Shots on goal model (`nfl_tool/nhl/shots_model.py`, standard library only)

The user asked (2026-10-13) for a shots tool that weighs "a variety of factors" and was honest
about one worry: "Vegas has this info and can model better than me." So every weight was fitted
on a replay, and the page keeps a record against the real prices.

- **Projection = shots per minute x minutes tonight x tonight's matchup**, from this season's
  games only (`shots_model_for` gives the model no prior).
  - Shots per minute: his shots for every minute played, each game back counting 0.985 of the one
    after it, with 50 minutes of an average skater mixed in (`pad_minutes`): **an average skater
    at his position WITH HIS ICE TIME** (`role`: his minutes over the position's average, to the
    power `role_power` 1.0). Three quarters of the rate is read from shot ATTEMPTS (times his own
    on-goal share, pulled hard to the league's): attempts predicted shots on goal better than
    shots on goal did.
  - Minutes: his recent ice time (each game back counts 0.8); a game under 60% of his usual
    ("left early") doesn't change it. **Before he has 3 games**, a game under half the league's
    last line / pair (`short_first`; about 5 min F, 7.5 min D) is "left early" too, and kept in
    `ShotsModel.short` so the goals model skips it for EV / PP minutes. With no full game yet, his
    minutes are tonight's line or pair's (`minutes_from` "line"; the goals model gives the power
    play his position's league share of them), and with no posted lineup he has **no number at
    all**. Three short games = he really plays that little (`short_games`). Why: Jake Sanderson
    left the opener hurt after 4:29, missed 8 games, came back 2026-10-21 on Ottawa's top pair
    and was projected as a 4.5-minute defenseman (0.07 shots, 1% for a point). On 2025-26's
    replay the rule changed nothing else (deviance 1.23111 vs 1.23114). Tests: `test_nhl_unsure.py`.
  - Matchup pieces, each an exponent on "what the other team allows against the league"
    (`WEIGHTS`): overall shots on goal 1.0, his position (forwards / defensemen) 0.5, the rink
    areas he shoots from 0.5, power-play shots allowed x his power-play share 0.6; home ice +3%,
    second night of a back-to-back -3.5%, opponent on one +3.5%; `scale` -4%.
  - A defense's number is its games this season mixed with 20 games of a league-average defense.
  - **Tonight's line** (`line`, weight 0.2, when the NHL's projected lineup is posted): the
    log of what his line or pair has been playing on this team (`slot_minutes`: the three busiest
    forwards of each game are "the first line", the next three the second; pairs by twos) over
    his own minutes, capped at +/-0.6. A fourth-liner listed on the top line gets about +13%.
    His minutes on the page stay his own.
- **Chance to clear a line:** a count a little streakier than pure chance (negative binomial,
  spread = m + 0.07 m^2). `chance_at_least`, `chance_over`, `fair_american`.
- **The replay** (`python tools/backtest/nhl_shots.py 2026`; `--tune` tries other settings;
  `--last-season` starts from the season before as well, to measure the rule above; a missing
  season's games download in about 4 minutes and its projected-lineups stories, kept in
  `data/nhl/previews/<season>`, in about 5): every 2025-26 skater-game projected only from that
  season's games before it. What it showed:
  - His rate and ice time are most of it. For the middle 80% of players the defense's overall
    number moves a projection about 6% either way, position 2%, rink areas 1%, power play 1%.
  - A hot or cold last five games added nothing. Neither did team strength or the defense's
    attempts allowed once shots on goal allowed was in.
  - Honest chances: "60-70% to clear" cleared 63-65% of the time.
  - Knowing the real ice time would have helped more than every matchup piece together.
  - **A line change is real but smaller than it looks** (the replay with every game's projected
    lineup): the `line` piece fitted at 0.21 +/- 0.03, the most reliable matchup piece after the
    defense's overall number, worth -4% to +4% for the middle 80% of players. A 12-minute forward
    listed on the first line played 9% more and shot 10% more; a fourth-liner on the second line
    +19% minutes, +24% shots. He does not inherit the star's ice time or power play: the gap
    between his minutes and the line's closed by only about 15%. Stars listed on a "third" line
    barely move (NHL.com lists lines in the team's order, not by ice time).
  - **The small-sample guard is not optional.** Raw this-season numbers with no guard missed by
    5% more at 5-9 games and 13% more in a player's first four.
  - **Checked on two seasons (2026-10-16):** the same replay on 2024-25 (fitted there, then scored on
    2025-26) put every weight back within its error range except power play: 2024-25 fit opp 1.11
    +/- 0.11, pos 0.33 +/- 0.20, area 0.99 +/- 0.34, line 0.20 +/- 0.03, home +3.2%, b2b -2.7%,
    opp_b2b +1.6%, spread 0.063. **Power play came out -0.09 +/- 0.34** (0.6 on the site); it swings
    half to half within one season (2024-25: +0.51 then -0.84) and is 0.22 +/- 0.23 on both seasons
    together: noise, worth under 1% of a projection. The 2024-25 weights scored 2025-26 no better
    than the site's (deviance 1.2312 vs 1.2311), so the owner kept every weight as is.
  - **Fading a hot start has been right.** When a player's average after 5-9 games said "over"
    and the model said "under", he went over 36% of the time at 1.5 (the average implied 57%, the
    model 43%). Defensemen averaging 1.6-2.2 after 5-9 games went over 1.5 in 42% of their next
    games.
  - **What this-season-only costs:** the defenses, nothing. The players: a volume shooter can't
    be told from a hot start, so the 66 players who averaged 2.5+ the year before were projected
    0.5 shots low in games 1-4 and 0.35 low in games 5-9 with a plain average-skater guard. The
    ice-time guard cut that to about 0.1 with no loss elsewhere. With last season in, it was 0.05.
- **The user's finding that started the line piece (2026-10-13):** "the biggest edges are
  flagging players with an injury on their offense ... both had a minutes increase due to the
  injured teammate ... Vegas obviously knows and is accounting for it, we are not." True: Warren
  Foegele (0.33 shots a game, 11 minutes) was on Ottawa's top line that night and the model had
  him as a fourth-liner. The lineup closes part of that gap (0.67 -> 0.75), not all of it: most of
  what is left is a cold six-game start that this-season-only can't see past.
- **The Shots bar (2026-10-19): a play is shown or left out, no Lean and no Check.** A play =
  an edge of `SHOTS_BAR` (6 points) or more on a player NOT moved down a line tonight
  (`shots_play`, `size` "play" / "none"). The owner asked for an audit of every graded play and
  "only strong plays". On the first six nights (485 plays with an edge): edges of 3-6 went 50-72
  (-20%); players moved down a line lost on BOTH sides (38-56, -22%) in both halves of the record;
  12+ gaps were not worse (53-43) and unders on players moved UP won (45-23), so the old "check"
  set-apart was dropped. The bar's plays went 154-117, +17.5u (+6.5%; 58.5% then 54.0% by half),
  in sample, so expect less. **Not used, on purpose:** a cut on tonight's number against his
  season average (it scored better, but the owner: fill-ins for injuries move a player's role,
  "grading vs their own season average ... muddy waters"). **Goals keeps its Lean / Strong /
  Check buckets** until it has more games graded; Points got its own bar 2026-10-22 (see "The
  Points bar"). Re-run `tools/nhl_factor_report.py` before changing the bar.
- **Power-play units: tested, not added** (`tools/backtest/nhl_pp_units.py`, 2026-10-14, the
  owner: "look into adding power play units into the model ... at least rotowire has them").
  The NHL's own shift charts (`api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=...`,
  open, about 0.25 s a game, kept in `data/nhl/shifts/<season>`) plus the play-by-play's
  `situationCode` give every skater's power-play time in every past game. On 2025-26, his share
  of the team's PP time last game (or last three) added nothing beyond the model (weight 0.01,
  -2% to +1%): his rate and recent minutes already carry his PP role, and last game's share
  was no better a guess at tonight's than his season share. Only tonight's real units would
  help (at most -16% to +9%, an overstatement), and those come from morning practice reports.
  Rotowire and Daily Faceoff publish them, but they are someone else's paid product (the
  MoneyPuck rule: not scraped for a site with paying members); a licensed feed would be the
  way. The NHL's projected-lineup story has no PP units.
- **It has NOT been shown to beat the line.** No free history of shots-on-goal prices exists.
  Same rule as the GMG model: a talking point until the record says otherwise.

#### Shots page data (`site/nhl/shots.json`, written next to data.json; not tracked)

- `games`: `{game id: {locked, final, players: [rows]}}` for games through `SHOTS_DAYS_AHEAD`
  (2) days out; each team's lineup (the same 12 forwards and 6 defensemen as Game Previews).
  A row: `games` and `avg` (his shots on goal a game this season: what his game log says),
  `mean` = `usual` x `matchup`, `minutes`, `lift` (what each piece did: 1.06 = +6%), `shares`
  (where he shoots), `chances` (1+ ... 8+ shots), `out` (ESPN: anything but day-to-day), and
  tonight's line: `slot` ("F1" ... "D3", null until the lineup is posted), `usual_slot` (the line
  his own minutes say he has been on), `line_minutes`, `move` ("up" / "down" / null).
- **Who is projected:** once a game's lineup is posted (`posted` on the game), exactly the
  skaters it lists who have played this season (a scratch or an injury isn't in it, a call-up
  before his first game has nothing to project from). Until then: the team's usual 18 by ice time,
  less anyone ESPN lists as out. Everyone in a posted lineup is added to data.json's `skaters`
  so his name opens the card.
- `lineups`: `{game id: {posted, team: {lines: [[names]], goalie, scratched, injured}}}` as the
  story has them, for the breakdown's linemates.
- **Same lock as the odds:** a game that has started keeps the previous build's rows (read from
  the live `shots.json` with the build key); with nothing saved it shows no projection rather
  than one made after puck drop. A finished game's rows get `actual` (real shots on goal; null
  if he didn't dress).
- `defense`: per team, what it allows a game for each stat the model reads: `season` and
  `season_rank` (1 = allows the most; what the page shows), `blend` / `factor` / `rank` (the
  steadied number the model uses), `league`, `games`.
- `edges` (`SHOTS_EDGES`: lean 3, strong 6, check 12; now only the every-book price tags' sizes on
  other pages and Best Plays' Goals / Points cutoff), `bar` (`SHOTS_BAR`, 0.06) and `record`.
- **The record** (`model_history/nhl_shots/<month>.json`, committed by the deploy's "Save GMG
  model record" step): each finished game is written once, with every player who had a main line
  and played: `[id, name, team, line, over, under, projection, chance of the over, real shots,
  season average, line move, first line, first over, first under]`, all as locked before puck drop
  (the last three, since 2026-10-14: the first main line and prices the site saw, carried on each
  board row as `first_sog` from the live shots.json; older rows don't have them), and since
  2026-10-16 a 15th column, **`factors`** (`SHOTS_FACTORS`, `shot_factors`; the file's `cols` and
  `factors` name them): position, games, season average, `vs_avg` (tonight's number minus it),
  minutes, PP share, tonight's slot and line move, home, `rest` / `opp_rest` (days; now on every
  board row too), his share from each rink area (`s_*`) and each matchup piece's lift (`l_*`).
  See "Learning which factors win".
  - **Closing line value** (`record.clv`, the owner: "start saving the price on shots too"): on the
    plays with an edge, the play's price moved from first seen to locked, in points of chance, when
    the line didn't move (`points` = average over `priced`); a moved line counts by direction (an
    over whose line went up = shortened). `shortened` / `drifted` / `plays`. A tile in the YTD popup, labeled **Early Price Move** and worded as context only (the owner, 2026-10-23): the prop pages are a BOTTOM UP model for members betting in the last hour or two, judged by wins and units on the model's own number at the puck-drop price; the first look is usually before lineups, so morning CLV is not the test (and plays picked at the lock lean toward prices that drifted). `shots_record_summary` grades the
  better side of each line (`shots_play`, whose `size` is how the page files it) into `play` /
  `none` (every saved game by today's bar, the ones before it too); for the plays it
  also splits `over` / `under` and **`fade` / `with`**: plays against the player's own season
  average (an under on a line he averages more than, or the reverse) next to plays with it.
  Wins, losses, units won risking 1 a play.
  - **The plays themselves** (the user, 2026-10-13: "a way to see plays that declared any edge and
    have a record of it. possibly grouped into buckets"): `record.days` = every day's tally of
    the plays, and `record.plays` = each graded play on the latest `SHOTS_RECORD_DAYS` (14) days that have any:
    side, line, locked price, edge, projection, real shots, won, units, `fade`. The buckets cover
    the whole season; the list is capped so shots.json doesn't grow by a megabyte by spring.
  - On the page: the **"YTD Model Performance"** button beside the Shots on Goal title opens the
    record in a popup (`#shots-record-modal`; the user's wording and placement, 2026-10-13; it
    sat at the bottom of the page first and they couldn't find it). In it, the tiles, then
    (`recordPlays` in shots.js) "Graded plays", newest day
    first, each day headed by its own W-L and units, with bucket buttons **Every edge** (how it
    opens) / **Overs** / **Unders** and the shown bucket's total beside them. Tiles: Plays, Not plays,
    Overs, Unders, Against / With his average, Closing line value.
    Nothing is typed in by hand: each build adds the games that finished since the last one.
  - **Started games stay on the list, grayed, under the plays still to come** (the user, later
    the same evening, with a game under way and its players still ranked as plays: "keep all the
    plays of the day on the shots list but have them grayed out if they are live kinda like the
    king of the crease is doing ... then have a toggle once games start at the top that
    differentiates and sorts from live and not"). `gameState` in shots.js: "open" / "live" /
    "final", from the build's `locked` AND the clock against `start_utc` (a build can be hours
    old at puck drop). Order is always open, live, final, whatever the sort; live rows are grayed
    (`.shots-live`) under a "Live now" heading; a day with both kinds gets the buttons **All
    games** (how it opens) / **Not started** / **Live / final**. A finished day is not grayed. The lock is the last build before puck drop (since 2026-10-15 usually the half-hourly refresh
  within the half hour before it), not the closing line.

#### Pages

- **Save to My Plays (2026-10-20):** every priced play on Shots, Goals, Points, Saves and Best Plays
  has a small box (`nhlPlayBox` in nhl-common.js; a new prop page adds it to its Play cell).
  The plays, their grading and the page: plays-and-promos.md, "My Plays".
- **The top bar (the owner, 2026-10-17): NFL, NBA, NHL, Promo Tools on every page of every sport**
  (it was Games / Player Props / Promo Tools on 2026-10-15). Each is a button that opens a list of
  its pages (`SPORT_PAGES` in sync.js, built by `addTopMenu`). The NHL's list is Game Previews, Line Matchups, then
  a "Player props" heading over Best Plays, Shots, Goals, Points, Saves (`PROPS`). A new NHL
  tool is one line in `PROPS`. No "More tools coming" on any page. Tests check every NHL page's bar
  (`test_header_site.py` the behavior).
- **Player search** (the owner, 2026-10-16: "if i start typing in GEE it will only show names of players
  with that"): a box in the Player header of Shots, Goals, Points, Saves and Best Plays. Case and accents don't matter (`nameSearchBox`,
  `nameMatches`, `NAME_SEARCH` in nhl-common.js; each page filters in its own sorted rows). A search
  that matches nobody keeps the table and the box with a "No players match" line. A new prop table:
  `search: true` on its Player column and `nameMatches` in its filter. Test: `tests/test_nhl_search_site.py`.
- **`site/nhl/nhl-common.js` is shared by every NHL page** and loads first: the data
  (`loadNhlData`), the season switch (`view`), helpers, the rink drawing (`rinkSvg`) and the
  player card. A new NHL page adds its own script after it and defines `render()` (called when
  the season or theme changes) and, if it has a selected game, `currentGame()`.
- `site/nhl/index.html` + `nhl.js` = NHL Game Previews v1: day strip, The Line (moneyline with win chance, puck line, total), The Teams (10
  tiles), Offense vs Defense (7 rows, same two-sided tags as NBA), Where the Shots Come From (a
  rink per offense), Goalies, Skaters, Injuries, Recent Games (with who started in net).
  - Where the Shots Come From (the user, 2026-10-14: "add the same triple data bubble logic
    that's on the player props"): the big number is the offense's shots a game from the zone;
    under it the Shots page's three boxes for the other DEFENSE (allows a game, share of all it
    allows, rank). The zone keeps its both-sides color (`rinkStep`); the boxes are on the
    defense's own rank colors.
  - Clicking a zone there (the user, 2026-10-19: "lists which opposing players shoot most from
    that zone") opens the every-team list with that offense's shooters above it
    (`zoneShooters` in nhl-common.js, `who: true` in the zone's `leagueAttr`): up to 8 players,
    shots a game from the zone (on goal or wide, from `players/<TEAM>.json`), share of his shots,
    on goal, goals, games; players Out / IR left off, 3+ games, ties share a color. A name opens
    the card in place of the list. Test: `test_a_zone_lists_its_shooters`.
  - A player's rink does the same with HIS team (the user, 2026-10-19: "if calling for an
    over/under, a user can see how they stack up vs team"): the Shots and Goals rows' rinks and
    the card's Shot Map (zones and the "allows" column) pass `who: <his team>, me: <his id>`;
    his row is outlined, and below the top 8 he is added under "Nth on TEAM from here". The
    goalie map has no list. Tests: `test_a_zone_lists_his_teams_shooters` (Shots),
    `test_the_cards_shot_map_lists_his_teams_shooters`, the Goals breakdown test.
- **A number shown as a player's stat is his REAL count, never mixed with an average** (the
  owner, 2026-10-19: "The % should never be mixed with a model guess. The data is the data -
  small sample or not"). The models still mix averages into their projections (`area_pad`,
  `pp_pad`, `pad_minutes`...), but the pages take what they show as his from `seasonCounts`
  (nhl-common.js: his team's players file, the card's counts): the Shots / Goals rink shares
  (hover says "12 of 17"), the power-play share, attempts per 60 and on-goal share. A model
  number is labeled as the model's ("Model's usual xG"). Never show `shares`, `pp_share`,
  `thru` or `att60` from shots.json / goals.json as his. **The projections keep the mixing**
  (the owner, 2026-10-19, after a raw-vs-mixed replay of all four models): raw data was clearly
  worse under about 10 games and equal after (Goals' chance score 0.36 mixed vs 0.68 raw at 1-5
  games; on this season's prices raw would have gone -51.5u on Goals, -21.4u on Points).
- **Every team, one number: the league-wide list** (`openLeagueModal` in nhl-common.js, the
  NFL site's stat-rank popup redone for hockey; the user asked for it "on all pages"). Any
  element with `data-league="${leagueAttr(p)}"` opens it: every rink zone (Game Previews both
  sides side by side, offense left and defense right, mirrored like the NFL's paired view; the
  Shots page and the card's Shot Map the defense only), the card's "OPP allows" cells, and both
  numbers of each Offense vs Defense row. Each side most first with its rank in words down the
  left; this game's teams outlined; each number on the eight colors by its own league rank. A
  rink list keeps the rink's colors (the most = green); an Offense vs Defense list colors the
  defense like its table cell (allowing the least = green). It opens over the player card, and
  Escape closes it first.
- **The player card** (nhl-common.js) is the ONE popup for every skater and goalie on every NHL
  page: wrap any name or photo with `playerClick(id, inner)`. **Any new place that shows an NHL
  player must use it.** It reuses the NFL card's shell (`#player-card-modal`, `.pc-box`,
  `.pc-head`, `.player-modal-toggle`); the NFL `player-card.js` is not loaded on NHL pages.
  - Tabs in the user's order: **Game Log** (opens here), **Shot Map**, **Odds**.
  - Game Log: newest first with a per-game row on top. Ice time, shots on goal and attempts are
    shaded against the player's own games; goals, assists and points only light up when he
    scored (zeros stay plain, or the whole table is red).
  - Shot Map, skater: a rink of where his shots come from, every zone on the eight rank colors
    by what tonight's opponent allows from there (the same chart as the Shots page's "Where he
    shoots"; with no game to read it against, the old shading by his own shots), and a table
    from the net out: shots per game, share, on goal, goals, shooting % next to the league's,
    and what the opponent allows from there with its rank, in the same color as that zone
    (`oppAllowsCell`: from the SHOOTER's side here, green = allows the most, so the card agrees
    with itself). Chips: goals a league-average shooter would have on the same shots from the same
    areas, power play share, shot types.
  - Shot Map, goalie: save % by area. A zone is colored only with 30+ shots faced and goals 1.5
    standard deviations from what the league allows on them (`goalieAreaTier`): luck alone
    should not paint a zone.
  - Odds: the lines above for the player's game (the open one, else his team's next), with
    `thin` tags and the ladders as "N or more" chips. A goalie's only line is Saves. Since
    2026-10-21 (the owner: "NHL is lacking checkboxes") each side shows the best price across the
    member's books (`bookPricePill`, SmartStake) or Novig's when no book lists it, with an
    `nhlPlayBox` beside it (anytime goal, shots, points, assists = market `ast`, saves; first goal
    has no box, nothing grades it). Every NHL page loads `../book-odds.js` for this.
  - A team whose file can't be read still opens the card (season tiles and odds only).
- `site/nhl/shots.html` + `shots.js` = **Shots** (under Player Props in the nav): one
  table for the day's slate, a row per skater, ranked best edge first.
  - **Edge = the model's chance minus the chance the price needs to break even**, for the better
    side of his main Novig line ("Best side"; Overs / Unders show one side for everyone). The page
    does no shot math: it reads `chances` and compares them with prices. `pickSide` must agree
    with the build's `shots_play` (a test checks every row), since the record is graded by it.
  - **It opens on the plays only** (`isPlay`: the build's bar, see "The Shots bar"), green, Rating
    "Play". **Plays only / Every line** (`shotsView.every`) lists everyone with a line: the plays
    first, then the rest under "Not plays", best edge first. A row over the bar on a player moved
    down a line says **"Lower line"** (left out). **Before a game's lineup is posted** nobody can
    have moved, so its plays are listed on the assumption he stays on his usual line, tagged
    **"Play: no lineup yet"** (dashed, `pendingLineup`; the owner, 2026-10-19: "post them with the
    assumption, but tag it as such"); once the lineup is in each stays a plain Play or drops off.
    Every graded play through 10-18 had its lineup posted by puck drop. Best Plays says the same
    with its "No lineup" note. No "check" group, nothing amber. A day with no
    plays says so and offers "Show every line". The every-book tags use the same bar (`bookEdges`:
    PLAY from 6, never on a player moved down, no CHECK).
  - **Toolbar:** Side, Skaters and Lineups are dropdowns (`.shots-filter-select`, the owner: "to
    reduce the clutter"), then Plays only / Every line. "How the number is made" sits at the top
    of the Shots panel, under the schedule strip.
  - **Line column:** L1-L4 / D1-D3 from the projected lineup, an arrow when it is above or below
    the line his minutes say he has been on, "--" until the lineup is posted. A note above the
    table says how many of the day's games have lineups, and each game in the strip is marked
    "Lineup" (with a check mark) or "No lineup yet" (`board.posted`). The breakdown shows the line as its own
    piece ("L1 tonight +13%"), his linemates, and who is injured or scratched.
  - Columns: Line, the play (**"o1.5" / "u2.5"** chip with Novig's price), **Rating** (Play, or
    Lower line when left out over the bar, plus "vs his avg" on a play), Avg (his season
    average) next to Proj, Fair price (the model's chance in its hover), Edge. Then the
    **advanced stats**, folded away until "Expand advanced stats" (see "Trimmed tables" below):
    Min (arrow = a minute off his season average) and what moved the number: Opp, Pos, Spots, PP,
    Home/rest. **Green = more shots for him, red = fewer** (the Over chip is green, the Under chip
    red, so a row agrees with itself). A piece is colored from 2.5%.
  - **A called play that goes against his own season average says so** ("vs his avg" next to the
    play). The first play the user opened was an under 1.5 on a defenseman who had cleared it in
    3 of 5 games ("why on earth would we play an under?"). The breakdown now starts from his
    season average and shows the small-sample step by name ("5-game sample -22%").
  - **A defense's tiles are never colored alone.** The user read red tiles as "bad defense"
    when red meant "fewer shots" (Ottawa was allowing the fewest point shots in the league). So:
    this season's own number, its rank said from the nearer end (`rankWords`: "3rd most", "the
    fewest"), and a word (Leaky / Stingy / Average).
  - **"Where he shoots": his share in bold, the defense in three boxes per zone** (the user,
    2026-10-13: the bold share "is helpful", but "allows x most/fewest ... is all relative
    information. It's also very wordy"). `zoneBoxes` in nhl-common.js, each box on the eight rank
    colors: shots a game allowed from the zone ("8.0/g"), that zone's share of ALL the shots
    the team allows ("21%"), and the league rank.
    - **Every rank is said from the nearer end, with its word: "2nd most", "3rd fewest"**
      (`rankWords` in nhl-common.js; the rank box is `rankBoxText`: the ordinal over a small
      "MOST" / "FEWEST"). A bare number reads backwards whichever way it counts: the user read
      Florida's "8.0/g ... 30th" (1st = allows the most) as a soft defense on 2026-10-13, so it
      became "1st = allows the fewest", and on 2026-10-14 read "WSH allows 13.5, 31st fewest" as
      wrong for a leaky defense: "it should flip and read x most when they are bad and x fewest
      when they are good ... split 50/50". Rank 1-16 of 32 is "most", 17-32 "fewest". Same on
      every NHL page: rink boxes and hovers, the card's "OPP allows" column, the Shots page's
      tiles, the league-wide lists. The COLORS stay the shooter's view ("green means go!"):
      green = the most shots for him. `season_rank` in shots.json counts 1st = allows the most.
    - **What colors a zone as a whole: the league-wide count, not the team's own split** (the
      user asked for this to be settled without adding complexity). Their example: a team
      allowing 10 shots can give up 80% of them from the low slot (8) and still allow fewer
      there than a team giving up 25% of 40 (10). A shooter's shots come from the count, and the
      count is what the model reads. So the zone, the count box and the rank box are on the rank
      for shots a game; the share box is on its OWN league rank (`areaShares` in shots.js,
      worked out on the page), so a defense that funnels shots into a zone still shows. No
      blended score.
    - The rink is 520px wide here (three boxes must fit the 18 ft low slot); the strip outside
      the zone carries the same three numbers as one uncolored line. On a phone the boxes are
      small. The player card's Shot Map still has its table instead.
  - A row opens its breakdown: his season average, the sample step, the matchup pieces
    multiplying out to tonight's number, the defense's tiles, every line the book prices at the
    model's fair price, and the rink of where he shoots (above), with the key underneath.
  - Filters: side, forwards / defense, and **"All" (how it opens) / "Lineup Confirmed"** (the
    user's words, 2026-10-13: "Only show players with a line by default, and remove the feature
    to sort by everyone"; then 2026-10-14: before the lineups are in "the page doesn't auto
    populate until you hit ALL ... that may confuse people", so it opens on All). Lineup
    Confirmed = only players on a line or pair in a posted lineup (`slot`); All adds the games
    still waiting on one. **A player with no shots-on-goal line is
    never listed** (there is no "Everyone" view any more). A day or game with nothing under
    Lineup Confirmed says why and has a "Show all players" button. A game in the strip shows only
    that game; click it again for the whole day. Players marked out are left off.
  - "Confirmed" is the user's label for "the NHL's projected lineup is in". It is not the
    official sheet from warmups; the page's About box says so (95% of listed skaters played).
  - Names open the player card.
- `site/nhl/promo-tools.html` + `promo-tools.js` = **Promo Tools: King of the Crease**, and `icebreaker.js` = its **Icebreaker** tab (both below).
- **Styles:** hockey-only rules go in `site/nhl/nhl.css` (never style.css: see styles.md); the
  layout shared with the NBA page is `site/suite.css`.
- It reuses the NBA page's layout classes (`.nba-two`, `.nba-box`, `.nba-tile`, `.nba-app` /
  `.nba-soon` for the launch guard, now open); hockey-only styles are `.nhl-*`. It does not load
  common.js.
- **Every rink zone is colored, on the NFL Summary's eight rank colors** (the user, 2026-10-13:
  "I don't like when the shot charts are not colored. Red and green show, but sometimes it's
  just the natural display ... the scaled view of 8 colors ... on the entirety of the site").
  `RANK_SCALE`, `rankStep`, `zoneOnStep`, `cellOnStep`, `rankScaleKey` in nhl-common.js (a copy
  of common.js's `RANK_SCALE`: change both together). Four teams to a step.
  - **The colors mean how MANY shots, not good or bad** (a lot of point shots isn't a strength):
    1st = the most shots = green, last = the fewest = red, and every rink carries the key
    ("the most ... the fewest") so it can't be read backwards.
  - A player's rink (Shots page breakdown, the card's Shot Map): the number is his own share or
    shots, the color is the OPPONENT's rank for shots allowed from there.
  - A team's rink (Game Previews): both sides as one (`rinkStep`): the offense's rank for shots
    taken from there and the defense's rank for shots allowed, averaged, then spread back out
    (two ranks averaged bunch in the middle) and cut into the eight steps. Sides that disagree
    land in the middle colors. This replaced the green / red / plain `rinkCall`.
  - Never colored: the strip outside the zone (too rare to read), and its row in the card's
    table. The goalie's map keeps its own rule (colored only past what luck explains).
- Logos are the NHL's SVGs, with a dark-page version (`logo_dark`); the page redraws on a theme
  switch.

#### King of the Crease (Promo Tools; built 2026-10-13)

DraftKings' promo: everyone whose goalie makes the **most saves of the day** shares $500K in
bonus bets (ties split; if your goalie doesn't start, the team's starter counts for you; the
qualifying bet must be +100 or longer). The NHL twin of King of the Endzone, with one thing that
tool lacks, asked for by the user: **Value** next to Upside ("picking chalky and popular picks
means your payout will be smaller").

- **The saves model** (`nfl_tool/nhl/saves_model.py`, standard library, this season only):
  a league-average start x how much the other team shoots x what his own team gives up x home /
  rest x his save rate. `WEIGHTS`: off 1.0, def 0.85, home -3%, his team on a back-to-back +3%,
  the other team on one -3%, save rate 1.0. Teams are this season's games mixed with 10 games of
  a league-average team; a quarter of the volume is read from attempts.
- **The replay** (`python tools/backtest/nhl_saves.py 2026 2025`, `--tune`): 5,034 starts over
  two seasons, each projected only from that season's games before it.
  - The two teams are nearly all of it (each moves a projection about 6% either way). His save
    rate: about 1%. **His own saves a start predicted worse than calling every goalie average.**
    Team strength, recent form and in-close scoring chances added nothing.
  - **Early in a season it knows little:** in the first two weeks its miss was 5.36 saves against
    5.42 for "everyone is average"; full strength by about game 20.
  - The spread (`save_spread`): a count with `DISPERSION` 0.02, plus 5% of starts ending early at
    about 12 saves (a pulled starter). Said / was within a point or two from 20 saves to 40.
  - **The promo's own question** (`top_chances`): goalies given 10-14% led their day 10% of the
    time; the favorite led 18% of days (a random pick 8%); the top three had the leader on 42%.
    The day's best averaged 36.7 saves (31 to 43 most days); 9% of days ended in a tie.
  - Not shown: that it beats the line (no free history of saves lines), or how many people pick
    each goalie (DraftKings doesn't publish it; payouts after the fact could back it out).
- **The board** (`crease_board` -> `site/nhl/crease.json`, untracked): `days[date].goalies`,
  one row per team playing, for the same days as the Shots page.
  - **A starter is never called confirmed** (the user, 2026-10-13: "Massive error ... this cannot
    happen"). The first version showed Nico Daws for New Jersey with a check mark while Jake
    Allen was starting: it trusted the NHL's projected lineup first and called it confirmed. That
    story is one writer's midday projection (that day's said "the Devils did not hold a morning
    skate"). Measured on 2025-26: its first goalie started 92% of the time (2,378 of 2,583), and
    55% when it named the goalie who had started the night before. Starters are official at
    warmups and no feed the site reads carries that.
  - **Starter** (`crease_starter`), `source`: "both" = the NHL's lineup and the book's saves line
    name the same goalie (the ONLY check mark, worded "agree", never "confirmed"); "split" = they
    differ: the book's goalie is shown (later, and money behind it) and `other` carries the
    lineup's name, drawn as a warning beside him; "lineup" / "market" = one source only, no mark;
    "usual" = neither (most starts, or the other goalie on the second night of a back-to-back).
    `doubt` = the lineup alone names last night's starter (a warning). A test fails if the page's
    script uses the word "confirmed".
  - Row: his season (`starts`, `saves_avg`, `sv_pct`, `high`), both sides of the matchup
    (`opp_shots` + rank, `allowed` + rank; 1 = the most, either way more work for him), the
    model's `shots` and `mean`, the line (`line`, `over`, `under`, `alts`, `mkt_mean` = the line
    and price turned back into saves), `blend`, `big` (chance of 35+), `top`, `mkt_top`, `value`,
    `check`, `tags`.
  - **Upside leans on the market** (`CREASE_RULES`): `blend` = the line moved toward the model by
    `0.5 x min(1, games / 20)` (the fewer of the two teams' games): about 14% in mid-October,
    halfway from game 20. A goalie with no line is on the model alone. `top` = his chance to make
    the day's most saves, ties included, from every starter's `blend`.
  - **Value = `top` / `mkt_top`**, where `mkt_top` is his chance if he were exactly what his line
    says **against the same field**. Only his own number changes. (The first version compared two
    whole fields and tagged every low-line goalie, because the model's projections are bunched
    early in a season.) Tag at 1.15+, with `top` at least half an even split of the day, and
    never when `check` (model and line 4+ saves apart: shown as a dashed "?" box).
    **Expect almost no Value tags until teams have played 10-15 games**: the rule working.
  - Upside tag: the day's best `top`, three at most (one per four starters on a short slate).
  - Lock: a started game keeps the previous build's rows; a final one gets `actual` (the saves of
    whoever STARTED for the team, which is who the promo counts) and, once the whole day is
    final, `led`. A game still open is worked out against finished goalies' real totals.
- **The record** (`model_history/nhl_crease/<month>.json`, committed with the other records):
  each finished day once. `crease_record_summary`: how often the favorite and the Upside tags
  led, the Value tags against what the chances and the lines said, and the average miss of the
  model, the line and the blend. It is what will say whether `blend` deserves more or less.
- **The page:** day strip (not clickable; the promo is the whole day), one table in King of the
  Endzone's look (`.koe-*` + `.crease-*`), every column sortable, always the whole slate, the
  Winners list beside it and an About box. The record tiles were removed 2026-10-14 (the owner:
  the Winners list "is all we need here"); `record` stays in crease.json for the record. The page does no math. Matchup columns are on the eight rank
  colors by league rank; the Novig line, saves a start and Tonight's by rank within the day.
  - The user's edits the same evening: no Upside chip ("clutter and already displayed in the
    chart"; the tag stays in the data for the record, Value keeps its chip), a narrower name
    column, the line without the over's price, the line and saves a start color coded "best to
    worst", and no Top 10 cut ("show the whole slate on the export photo").
- **Winners** (2026-10-14, `renderWinners` in promo-tools.js; the owner asked for "a sort of
  leaderboard history that shows who won, what his pregame rank was, upside etc." off to the
  right). One collapsible line per finished day, newest first and only the newest open: date,
  winner (ties: both), saves, his pregame place ("13th of 32" = his place by `top`) and what he
  paid. Open: starters, pool, about how many were on him (pool / payout), and **If they'd won**:
  each goalie DraftKings showed a payout for, most saves first, with Sv, Pre, Upside, Paid and
  **Worth** = `top` x paid (colored best to worst within the day); then our favorite and the most
  picked. Beside the table when there is room (`.crease-main`, flex-wrap), under it when not;
  **never in the saved image** (outside `#crease-capture`). No summary tiles (the owner removed
  them from the mockup).
  - Days: crease.json `history` (`crease_history`: every recorded day from
    `model_history/nhl_crease`, `CREASE_HISTORY_COLS`, best chance first).
  - **Payouts are typed in by the owner after each contest**: DraftKings shows only a few
    goalies' "what he paid / would have paid" (the pool is split evenly among everyone on the
    winner, whatever they bet). A box under the list, shown only with `html.is-owner` (and on
    localhost): pick the day, the pool ($500,000 by default), paste DraftKings' text as it comes
    ("🥅 Name - $2,748 in Bonus Bets"), Save. Names match the day's starters with accents dropped,
    else a last name only one starter has; any name it can't match blocks the save. Stored in D1
    `crease_payouts` through `/api/crease-payouts` (members-and-hosting.md).
  - Next, once a couple of weeks are logged: learn what drives picks (names, short lines,
    favorites) and estimate each goalie's payout before puck drop, so Value can become an
    expected payout. Label it an estimate and grade it like the rest.
- **Save image** is the priority (the user: "a clean and crisp image to twitter"): the table
  with a GMG title bar and a key, at 2x. **Logos on this page are ESPN's** (`shareLogo`):
  assets.nhle.com sends no cross-origin header, so html-to-image can't carry the NHL's own files.
  No headshots for the same reason. The image is always the whole slate.

#### Icebreaker (Promo Tools; built 2026-10-15)

DraftKings' promo: everyone with a qualifying **first goal scorer** bet (the owner's was $10; it
varies) on the player who scores the **quickest goal of the 7:00 PM ET slate** splits $250K. Quickest
by GAME clock: 0:10 into a 7:08 puck drop beats 0:15 into a 7:02 one. The owner's worry: "it feels
awfully random ... like finding a needle in a haystack", with two ways in: team first (fast starts,
a bad opponent) and players only (one player's matchup).

- **The replay came first** (`python tools/backtest/nhl_icebreaker.py`, 2024-25 and 2025-26, about
  290 nights with a 7:00 slate; findings in its header). The owner's ideas, tested: time of the first
  goal for / against, fast / slow starts (goals in the first 10 minutes, 1st-period goals), early
  shots, line 1 vs line 2, the first shift. **None of the team "fast start" numbers beat a team's
  plain goals for / against**, early shots were no better than a blind guess at the player level,
  and the opening shift was a coin flip (35% of winners were on it; 40% of opening forwards started
  the next game too). **What picks the early scorer is his scoring rate x his ice time.** On 4-6
  game slates the quickest goal came by about 2:00 of the 1st most nights; no ties in two seasons;
  defensemen 10-15% of winners, about 20% not five a side. Our kind of ranking had the winner in its
  top 10 on 11-22% of slates (ten random picks: 6%); the favorite is about 2%.
- **The number** (`icebreaker_board` in build_nhl.py -> `site/nhl/icebreaker.json`, untracked): with a
  steady scoring rate, a player's chance to score the slate's first goal is his expected goals tonight
  over everyone's. `rate` = the Goals page's `mean` (goals.json, so lineups, matchup, goalie, home, rest
  are all in), moved toward his Novig anytime price (`mkt_mean` = -ln(1 - chance)) the King of the
  Crease way: market + `0.5 x min(1, games / 20)` of the way to the model (`ICEBREAKER_RULES`; the
  fewer of the two teams' games). No price = the model alone. Players ESPN lists as out are left off.
- **The page does one division** (`icebreaker.js`): his rate over everyone's in the games the member
  picked; a team's chance = its players' added up (so the two views always agree); "Of team" = his
  share of his team's. It has to follow the member's game picks, so it can't come from the build.
- **The slate is picked on the page** (the owner: usually a select group of early games, and "it
  changes"): Day arrows, then **Start time** chips grouping the day's games by puck drop (opens on
  7:00 PM ET, else the day's first), then **Games** chips to add or remove any one game.
- **Fast starts, this season** (the owner's label; `fast_starts`, from `reduce_game`'s `first_goal`,
  `first_goals` and the teams' `sog_early`): games it scored first, the time of its own first goal in
  its middle game ("1st 7:14", "none" = scoreless in more than half), shots on goal a game in the
  first 5 minutes, and what tonight's opponent allows there. **Shown, never counted** (the replay);
  colored on the eight colors by place among the picked teams.
- Layout: Teams table (Chance, the top three as "Best bets", Fast starts) beside the Players table
  (Line, Chance, "1 In", Of Team, then **First 10 Minutes · This Season**: GIFT = goals in the first
  10 minutes / games, SOG a game, TOI a game, then **DraftKings' first goal price**), the top 15
  until "Show all"; clicking a team shows only its players. The Winners list beside them, never in
  the saved image.
  - The first-10 columns (the owner, 2026-10-22, replacing G/GP, xG and Min) are icebreaker.json
    `first10` (`first_ten`: `[games, goals, SOG, charted games, seconds]`, from `reduce_game`'s
    per-skater `g10` / `sog10` / `toi10`, the 1st period before 10:00). TOI averages only games
    with a shift chart (the league has none for games 6-52). Shown, never in the chances: the replay
    found early-game numbers predict nothing beyond scoring rate x ice time.
  - **Every Players column sorts on a click** (again to flip; `ICE_SORT`, `iceView.sort`), the
    top-15 cut follows the sort, and a player with nothing in that column sinks. Its headers carry
    `data-ice-sort`, which promo-tools.js's King of the Crease sort skips. Save image like King of the Crease (ESPN logos).
- **First goal prices: SmartStake** (`smartstake.add_first_goal`): the market's key isn't in their
  docs, so each build reads `/v1/markets?league=nhl` (`fetch_markets`) and takes player markets
  named for the first goal, not a team's, a period's or the last (`first_goal_market_keys`). Yes is
  kept as "o", No dropped; stored as data.json `book_odds[...].props.first_goal`, its own try (a
  failure never costs the shots / goals prices). The row's `fg` is DraftKings' price and nothing
  else (the owner: "other books don't matter, its only dk or bust"); the page's DraftKings column
  shows only when some player in the picked games has one. `version.json` `nhl.first_goal` = players
  priced (or the note naming SmartStake's nearest markets).
- **SmartStake has no NHL first goal scorer market** (the first deploy listed its 43 NHL markets:
  totals, puck lines, period and player goals / shots, none for the first goal). The owner asked
  about scraping DraftKings: no (their terms forbid it; the MoneyPuck rule). SGO (one event,
  2026-10-15): FanDuel priced all of its first goal scorers, Bovada / BetMGM / ESPN Bet / Caesars
  some, DraftKings none, so that check was taken out again. The owner is asking SmartStake to add
  NHL first goal scorer; when it comes, check `first_goal_market_keys` finds it.
- **Historical Data** button beside the title: the replay's findings in a popup (`#ice-history-modal`,
  the owner's ask: "so users can get some background stats"). Its numbers are typed into
  promo-tools.html: change them with the replay. Reworded to the owner's edits the same day: no lead line,
  tiles "best pick scores first about 1 night in 50" / top 10 / top 20, columns "Typical night" /
  "Slow night" with a note saying what each means, and "This promo is mostly luck ... GMG's advice: have fun."
- **Lock and record:** a started game keeps the last build's rows (none saved = no rows). Once every
  7:00 PM game of a day is final, the day is written once to `model_history/nhl_icebreaker/<month>.json`
  (every player's locked rate, mean, mkt_mean, DraftKings price, and the winners: the quickest first
  goal, ties included). `icebreaker_history` -> the Winners list: day, who broke the ice, when, his
  place before puck drop ("12th/170"), his chance, his DraftKings price; our top pick in the hover.
- Reached as `promo-tools.html#icebreaker` (the Promo Tools menu's "Icebreaker" item; `showPromo` in
  promo-tools.js switches the tabs and the address).
- Tests: `tests/test_nhl_icebreaker.py` (first goals from the saved game, fast starts, the blend,
  prices, lock, record, history, SmartStake's market names) and `tests/test_nhl_icebreaker_site.py`
  (the page on `tests/fixtures/nhl_icebreaker.json.gz`). `check_site.py` opens it by its address.
- Not built yet: a payout estimate (the pool is split among everyone on the winner, so popular
  stars pay less: King of the Crease's Value idea), once a few contests' payouts are known.

#### Tests and checks

- `tests/test_nhl.py` (the build, on one saved game and one saved Novig event) and
  `tests/test_nhl_site.py` (the page and the player card in a browser on a saved `nhl/data.json`
  and two saved player files, NJD and DET). They run with the rest
  (`python tools/run_tests.py`), so a broken NHL test stops a deploy like any other.
- `tests/test_nhl_shots.py` (the model, that the build never hands it last season, tonight's
  lines read from a saved story (`nhl_lineup_story.json.gz`, STL @ OTT), and the board, lock and
  record, on the saved game and hand-made games) and `tests/test_nhl_shots_site.py` (the Shots page in a browser on
  `nhl_shots.json.gz`, the shots.json that matches the saved data sample).
- `tests/test_nhl_saves.py` (the saves model, Novig's saves lines, the starter, the lineup
  reader's lone-name fixes, the board, lock, record and Winners history) and
  `tests/test_nhl_crease_site.py` (the Promo Tools page in a browser on `nhl_crease.json.gz`,
  the Winners list on a hand-made history, reading DraftKings' pasted list).
  `tests/test_ci_crease_payouts.py`: the payouts endpoint in the login middleware.
- `tools/fetch_live_data.py` also downloads the live player files, `shots.json` and `crease.json`, so the
  after-deploy site check sees the pages as members do.
- `tools/check_site.py` opens both NHL pages; like the NBA page they can never block the deploy gate.
- `https://nfl.gmgsports.org/version.json` shows whether the NHL build worked: `nhl.built`,
  `games` / `wanted`, `downloaded`, `lines`, `player_odds`, `shots` (games with projections),
  `lineups` (games whose projected lineup was read), `icebreaker` (days on its board), `first_goal`
  (players with a SmartStake first goal price, or why not), or
  `error` (the build's last line) when it failed.

#### Goals (anytime goal): step 1, the replay (2026-10-14; no page yet)

The owner asked for a Goals tab "displayed similarly to shots", with a flag where a player's
heavy shooting area overlaps an opponent's weakness (their example: Brandsegg-Nygard, 44% of his
attempts from the low slot, scored at +500 against New Jersey, who had given up 12 of 22 goals from
there; but NJD was 20th of 32 in low-slot SHOTS allowed). Plan agreed: replay first, then the
model, a one-row mockup, the page, the record.

- `python tools/backtest/nhl_goals.py 2026 2025` (about 20 s a season). Expected goals = a logistic
  table on distance, angle, rink area, shot type, rebound, rush, PP / SH, fitted weekly on the
  season's own shots before each day (this-season-only holds for the league's yardsticks too).
  Projection = his expected goals a minute (50 minutes of an average skater with his ice time
  mixed in) x the shots model's minutes x matchup pieces.
- What both seasons said:
  - Honest chances: "30-35%" scored 33-36%; the top 10% were a touch better than said (34-35% vs
    31-32%). Beats his goals a game clearly (log loss 0.397 vs 0.407; a flat chance 0.431). Only
    a little better than shots x the league's shooting % (0.3968 vs 0.3977).
  - Pieces that count: the defense's expected goals allowed (weight about 1.4, -8% to +9%), his
    finishing (goals over expected goals with 8 xG of average mixed in, weight 0.55, -10% to +10%),
    home, rest, line. Small: tonight's goalie (0.2-0.26, about +/-3%). Nothing: the areas he
    shoots from against what the defense allows from them (weight -0.08 / 0.39, +/-0.5, under 1%).
  - **The Zone Match overlap added nothing beyond the model, either season** (about 4,100 flagged
    games each): heavy low-slot / slot shooter + top-10 defense from that area scored 0.94 / 0.98 of
    what the model expected (shots-allowed version) and 0.93 / 0.93 (goals-allowed version). The
    owner's tighter version (40%+ low slot, top-5 defense): 0.92 both seasons. Flagged players DO
    score more often than average (16-22% vs 15%), but the model already expected it. Goalie weak
    in that area: 1.10 then 0.89 (noise).
  - **Heavy low-slot shooters run about 5-10% under their projection** (0.90-0.95 in every slice):
    a fix for step 2, not a reason to flag them.
  - **A defense's low-slot GOALS allowed is noise; its low-slot SHOTS allowed is real.** Team
    after N games vs the rest of the season, correlation across 32 teams: shots allowed 0.42-0.45
    after 6 games, goals allowed -0.03 / 0.01, shooting % allowed 0.14 / 0.15.
  - The rush flag is crude (only 1.7% of shots: the feed logs few neutral-zone events before a
    shot); it doesn't change the findings.
- Not testable: the price (no free history of anytime prices), and Novig's team totals as the
  model's anchor.

##### Step 1b: five "bottom up" ideas, tested like a statistician (2026-10-14)

The owner asked for other ways to attack goals ("a true bottom up style"), then "what would a
statistician do?": write the ideas and the bar down first, fit on one season, confirm on the
other, one model rather than a pile of flags, grade by calibration / log loss, and judge the
live record by closing line value (CLV) because ~900 anytime bets are needed to tell a 3-point
edge from luck. `python tools/backtest/nhl_goals_ideas.py` (about 1 minute; needs 2024-25's
shift charts and lineup stories, now kept in `data/nhl/shifts/2025` and `data/nhl/previews/2025`).
The bar (in the script's header, written before the first run): weight 2+ standard errors from
zero on 2024-25, lowers 2025-26's log loss with 2024-25's weights, same sign fitted on 2025-26.

- **Passed: even strength and power play apart** (his EV expected goals a minute x EV minutes +
  PP rate x PP minutes, from the shift charts; weight 1.1 both seasons, -8% to +4%).
- **Passed: one-timer side** (a right-handed shot from the left side or the reverse, in the
  expected-goals table: off-wing shots scored 9.3% vs 5.7%; small, -5% to +4%).
- **Passed: the low-slot trim** (not blind, step 1 found it): weight -1.1 / -1.2 on his low-slot
  share over his position's, -7% to +7%. The biggest of the three.
- **Out: empty-net goals** as built: the weight came out NEGATIVE (-0.93, -0.34). The players on
  the ice at an empty net are the ones protecting a lead (defensive forwards, top pairs), not the
  scorers. Empty-net goals are 6.2-6.6% of all goals; a rebuilt version would be found by looking,
  so it would need the same bar on a third season.
- **Out:** the penalty matchup (power-play time drawn x given up: nothing), a backup goalie
  beyond the goalie's own record (z 0.9), the team-strength gap (z -1.2).
- Everything that passed together, fitted on 2024-25, on 2025-26: log loss 0.39621 (step-1
  pieces 0.39691; his goals a game 0.407). Honest: "30-35%" scored 32.8%, the top 2% said 40.1%
  and scored 42.8%. Weights: opp 1.35, goalie 0.29, finish 0.44, line 0.23, home 0.10, b2b
  -0.08, opp_b2b 0.055, split 0.98, onetimer 3.44, low -0.95, scale 0.048.
- **The record must grade CLV:** save the first price of the day next to the locked price (the
  last refresh before puck drop), for Goals and, cheaply, for Shots too.
- The owner wants the **Zone Match tag shown and tracked** (its own bucket in the record), even
  though the replay found no edge in it.

##### Step 2: the model and goals.json (built 2026-10-14)

- **`nfl_tool/nhl/goals_model.py`** (standard library): exactly the replayed model.
  `tools/backtest/nhl_goals_check.py` replays both seasons THROUGH this file (it reproduced the
  ideas test's 0.39621) and fits `WEIGHTS` on both seasons together; rerun it after any change.
  - Expected goals: two logistic tables (without and with the off wing; the `onetimer` piece is
    the log of one rate over the other), fitted every build on this season's shots in plain
    Python (`fit_xg`, sparse Newton: under 3 s on a full season, identical to numpy to 1e-14).
  - `parts()` = his EV / PP rates with 50 / 15 minutes of an average skater, the shots model's
    minutes / line / home / rest, the defense's xG allowed (20 games of average), the goalie (25
    xG of average), finishing (8 xG of average), the low-slot trim. `chance_to_score` = 1 - e^-mean.
  - **Zone Match tag** (`zone_match`, `ZONE`): 35%+ more of his located shots from the low slot
    or slot than his position (15+ located shots) AND a defense top-10 for shots allowed a game from
    that area AND above the league's average there (added so a small league can't tag everyone).
    Never in the number.
- **Power-play seconds come from the league's per-game report**, not the shift charts:
  `skater/timeonice?isAggregate=false&isGame=true&cayenneExp=gameId=...` (`ppTimeOnIce`).
  The shift charts were empty for 47 of this season's first 105 games and read about 12 s a game
  (15%) short. Kept in the saved game as `raw["pp_toi"]` (`fetch_pp_toi`; a game saved before is
  backfilled when next read); `reduce_game` puts it on each skater (`pp_toi`, None without it; the
  model then reads that game at his own share so far). The replays' copy: `data/nhl/pp_toi/<season>.json.gz`.
- `reduce_game` also keeps every unblocked shot on a goalie as `shots` (`game_shots`, moved from
  the replay: no empty nets, penalty shots, own goalie pulled or shootouts).
- **`site/nhl/goals.json`** (not tracked; on fetch_live_data's list): `games` = the Shots page's
  games, players and lock (`goals_board`), EVERY skater priced or not: `chance`, `mean`, `fair`,
  `lift`, `shares`, `zone`, season `games` / `goals` / `xg` / `shots`, `ev_min` / `pp_min`,
  tonight's `goalie` (the NHL's projected lineup's, else the team's busiest starter; never called
  confirmed), the Novig anytime `odds` / `no_odds` / `thin`, **`first_odds`** (the first price the
  site saw, carried from the live goals.json), `edge` and `size` (`goals_play`, `GOALS_EDGES`
  3 / 6 / 12 points like Shots; a player moved DOWN a line is "check"). Also `defense`, `xg` (both
  tables), `league`, `weights`, `zone`, `record`. A failed Goals step still writes a goals.json
  (`error`), so putting the live NHL copy back (`--need nhl`) never trips on it.
- **The record** (`model_history/nhl_goals/<month>.json`, committed with the others): each
  finished game once, every projected player who played (priced or not), `GOALS_RECORD_COLS`, plus
  the game's locked total and moneylines (`market`, to test the market as an anchor later).
  Since 2026-10-16 a priced player's row ends with **`factors`** (`GOALS_FACTORS`, `goal_factors`;
  None for an unpriced one; older rows have 11 columns): position, games, goals, xG, `vs_avg`
  (tonight's expected goals minus his goals a game), minutes, EV / PP minutes, slot, line move,
  home, rest days, the Zone Match area, `s_*` shares and each piece's lift (`l_*`).
  `goals_record_summary`: buckets strong / lean / none / check, `zone`, `thin` (units at the locked
  Yes price); `clv` (called plays: average move in points of chance from the first price to the
  locked one, + = shortened, and how many shortened / drifted); `honest` (said vs scored, everyone);
  `zone_all`; `days` / `plays` like Shots.

##### Step 3: the Goals page (`site/nhl/goals.html` + `goals.js`, built 2026-10-14)

The owner approved a mockup of one row and its breakdown ("looks great. push it"), built in the
real Shots page from real numbers. The page REUSES the Shots page's layout, ids and classes
(`#shots-app`, `.shots-*`); its own styles are `.goals-*` in nhl.css. Under Player Props after Shots
on every NHL page (a test checks).
- **No goal math on the page:** chance, fair price, edge and bucket all come from goals.json; the
  edge cell is colored by the build's `size`, never the rounded edge (an edge of 2.996 rounds to
  3.0 but is "none" to the record). It also loads shots.json for the rink's defense boxes and
  tonight's linemates.
- Columns: #, Player, Line, Anytime (Novig's price alone in a green chip; **"No odds"** outlined
  chip when Novig hasn't priced him: the owner asked "no line as in odds or as in lineup?", so it
  says odds), **Rating** (the build's `size`: Strong / Lean / Check / New line), **Zone** (the blue
  Zone Match chip, "LOW SLOT" / "SLOT"), G (/gp), xG, Fair (chance in its hover), Edge; then the
  advanced stats, folded away: Min, Opp, Goalie, Finish, EV/PP, **Style** (net-front trim x off
  wing; the owner: "Keep style"), Home/rest. Result column once a game is final (W/L only for a priced player).
- **Ranking:** check first (amber), then priced plays by edge, then **"No odds yet"** players by
  their chance (the owner: "do it as shown"; prices and lineups fill in through the day with the
  half-hourly refresh). Filters: Skaters, Lineups, **Odds** (priced or not / priced only), **Zone Match**
  (everyone / only), the Check plays switch, and the live / final buttons, as on Shots.
- **The Zone Match tag is blue, never green** (tracked; no edge in the replay). A tagged
  player's breakdown has a blue note above the rink: his share, his position's, what the defense
  allows there and its rank, "Tracked in the record; not in the number."
- Breakdown: season G and xG -> his usual xG -> each piece -> tonight's xG and chance; the
  defense's tiles (xG allowed with Leaky / Stingy / Average, low-slot and slot shots allowed, the
  expected goalie labeled "projection"); the price table (anytime and 2+, model, fair, Novig,
  **First seen**, edge); the Shots page's rink.
- **YTD Model Performance** popup: tiles by bucket, Zone Match priced, thin, **Closing line value**
  (average points, shortened / drifted); "Said vs scored" for every graded player and the tag; the
  graded plays with bucket buttons (Every edge, Strong, Lean, Check first, Zone Match).
- Tests: `tests/test_nhl_goals_site.py` on `tests/fixtures/nhl_goals.json.gz` (built from the same
  games as the data sample: as of 10/12 14:00 UTC, then 10/13 14:12 with that file as the live one).

#### Points (1+ point): step 1, the replay (2026-10-16)

The owner: "moving to points ... built in a similar fashion as SOG/ATG with a backtest and then
a algorithm", under the Player Props menu and in Best Plays. Later: line / points stacks (3-4 leg
parlays of linemates' points), and every graded play saving the parts behind it so the weights can
be re-tuned from the record (Points from day one; Shots and Goals later).

- `python tools/backtest/nhl_points.py` (about 3 minutes; `--rows <folder>` keeps each season's
  rows to re-judge without replaying). 2024-25 and 2025-26, each walk-forward on its own games;
  the candidates and the bar are in the script's header, written before each run. Weights fitted on
  2024-25, judged on 2025-26 (log loss on "1+ point"); a piece stays only at 2+ standard errors on
  2024-25 with the same sign on 2025-26 alone. Every point counts (empty net, short-handed).
- A point in 35% of skater-games, 2+ in 9%; 0.46 points a game (0.17 goals, 0.29 assists).
- **The winner: the Goals model's expected goals as shipped + on-ice assists.** Assists = the
  expected goals his TEAMMATES make while he is on the ice (shift charts x the Goals model's
  table; 50 / 15 EV / PP minutes of an average skater with his ice time mixed in) x his share of
  their goals he assisted on (10 / 6 goals of his position's average mixed in), even strength and
  power play apart, x tonight's EV / PP minutes, x the matchup: the defense's expected goals
  allowed (1.54, the biggest), tonight's goalie (0.37), his line tonight (0.18), home, rest,
  plus "spread" (0.08: log of the assists number over its average; the chances were a touch
  bunched). Chance = 1 - e^-(goals + assists). 2025-26 log loss 0.59535; the bettor's points a
  game 0.60284; one flat chance 0.64860. Honest: "45-55%" got a point 51%, "55-65%" 62%.
  A re-scaling of the chance (logit x 1.09, the same both seasons) took it to 0.59505.
- Lost: plain points a minute (0.60125), the Goals model + plain assists (0.59776), on-ice points
  in one number (0.59669; 0.59623 with a blend toward his real points). His own team's strength
  failed the bar (the on-ice number already carries it).
- **Step 1b, both out** (the owner agreed to test them first): **tonight's linemates** (their EV
  points a minute against the linemates he has played with, from the projected-lineup story;
  read for 94% of skater-games, middle 80% 0.66x-1.36x): goals half z 1.7, assists half z 1.1,
  log loss 0.59530 against 0.59535. Right direction both seasons, too small to count: a line move
  is mostly carried by the minutes (`line`). **A second assist counted as half**: z 0.6. Tonight's
  power-play unit can't be tested (see "Power-play units").
- Not testable: the price (no free history of points prices). The record grades it from launch.

##### Step 2: the model, points.json and the record (built 2026-10-16)

- **`nfl_tool/nhl/points_model.py`** (standard library), exactly the replayed winner on top of the
  shipped Goals model: `PointsModel(goals)`, fed every game AFTER the Goals model (its table
  scores the shots). `tools/backtest/nhl_points_check.py` replays both seasons THROUGH this file
  (held out: 0.59527, re-scaled 0.59496, matching the replay) and fits `WEIGHTS`, `SPREAD_MEAN`
  and `CALIBRATION` on both seasons together; rerun it after any change.
  - Assists numbers come only from games with a shift chart (this season's games 6-52 have none):
    a game without one adds his minutes and points but no on-ice numbers or assists to the share.
  - `chance_at_least`: 1+ point re-scaled on the logit (`CALIBRATION` 0.036 + 1.086 x); 2+ and up
    a plain count. `chance_over(mean, line)`.
  - **`mates`: tonight's projected linemates against the ones he has played with** (`with`: who
    shared his line or pair, recent games counting more), both read by their EV points a minute
    today, so the same line is 1.0. **Tracked, never in the number** (it failed the bar; the record
    keeps it so the live season can say). `linemates(pid)` = who he plays with: for stacks later.
- `reduce_game` now keeps `goal_events` (`game_goals`: team, `pp`, scorer, assists, `on`) and each
  shot's `on` (the shooting team's players on the ice, goalie included), from the kept shift chart
  (`on_ice_finder`: a shift counts from just after it starts to the moment it ends, so a goal
  belongs to the players it ended the shift for). None without a chart.
- **`site/nhl/points.json`** (not tracked; on fetch_live_data's list; `version.json` `nhl.points`
  = games with projections): `games` = the Goals page's games, players and lock (`points_board`),
  every skater priced or not: season `games` / `goals` / `assists` / `points` / `avg` (points a
  game), `g_mean` (the Goals page's number), `a_mean`, `mean`, `chance` (1+), `two` (2+), `fair`,
  `lift` (the assists pieces) and `g_lift` (the goals pieces), `mates`; Novig's points `line` /
  `over` / `under` / `thin`, `first` (the first line and prices the site saw, carried from the live
  points.json), `chance_over` (rounded, what everything grades), and the Shots page's better side
  (`points_play`: "play" / "none" / "unsure", see "The Points bar"): `side`, `price`, `edge`, `size`, `fade`. A
  finished game's rows get `actual` (goals + assists). Also `weights`, `calibration`, `edges`, `bar`,
  `factors`, `record`. Main builds the Goals model once and hands it to both pages (`goals_file`'s
  `model`); a failed Points step writes a points.json with `error`.
- **The record** (`model_history/nhl_points/<month>.json`): each finished game once, every
  projected player who played, `POINTS_RECORD_COLS`; a priced player's row ends with **`factors`**
  (`POINTS_FACTORS`: position, games, avg, g_mean / a_mean, EV / PP minutes, tonight's slot and line
  move, `mates`, home, and each piece's lift on assists `a_*` and goals `g_*`). That is the
  owner's "learning which factors win": group graded plays by any factor once there are enough.
  `points_record_summary`: the Shots record's buckets, over / under, fade / with, CLV, `days`,
  `plays`, `ledger`, plus `honest` (1+ said vs got, everyone).
- Tests: `tests/test_nhl_points.py` (the saved game with its shift chart,
  `tests/fixtures/nhl_game_shifts.json.gz`).

##### The Points bar (2026-10-22)

The owner asked why Points was down (-32u on the first six nights' 370 graded plays). Strong +
Lean were +2.6u; the losses were **Check** (49-71, -34.9u; 42-57 of it plays against tonight's line
change), **the 1.5 lines** (8-20, -17.5u: `chance_at_least` for 2+ is a plain count, never tuned
on results) and **edges of 3-6** (92-102, -23.5u). On the priced 0.5 lines the market's own no-vig
price predicted a point better than the model (log loss 0.6348 vs 0.6446) on every one of the six
nights; z 1.3, so not proven, but one direction. The owner: "make a Points play 0.5 line only, edge
6+, never against tonight's line change."
- `points_play` (build_nhl.py): `shots_play` at `POINTS_EDGES`, then "play" only on the 0.5 line at
  `POINTS_BAR` (6 points) or more and not `against_move`; "unsure" from `UNSURE_EDGE`; else "none".
  No lean, no check. The board, the record (`play` / `none` / `unsure` + over / under / fade /
  with; `plays` and `ledger` hold only plays), Best Plays and the factor report all use it.
  Re-graded the same way, the season so far is 56-49, +6.6u (in sample: expect less).
- `POINTS_EDGES` still sizes the every-book price tags and the price table's green.
- Closing line value read about -2.4 points on all three records (Goals 145 drifted, 6
  shortened): best price at first look against best across more books at the lock, "drifted" by
  construction. Fixed the same day: see "Closing line value on Novig's prices".

##### Step 3: the Points page (`site/nhl/points.html` + `points.js`, built 2026-10-16)

The owner approved a mockup of the table and one opened row on the day's real numbers ("Looks
good. Finish the Points page"). It REUSES the Goals page's layout, ids and classes (`#shots-app`,
`.shots-*`, `.goals-*`); under Player Props after Goals on every NHL page (`PROPS` in sync.js).
- **No points math on the page:** the play (side, line, price), its chance (`chance_over` or 1 -
  it), the edge and the bucket all come from points.json, so the page and the record can't
  disagree. It also loads goals.json (the defense's expected goals allowed) and shots.json
  (tonight's lines, injured, scratched).
- Columns: #, Player, Line, **Play** (the Shots page's chip: "o0.5 +127" green / "u0.5 -150" red;
  "No odds" when Novig has no points line), Rating (Play, plus "vs his avg"; over the bar but left
  out: "1.5 Line" / "New Line"; Model Unsure), **P** (points /gp, goals and assists in the hover), **Fair** (the fair price of the play's
  side; 1+ point when unpriced), Edge; advanced: Min, xG, xA, Opp, Goalie, **Linemates** (the
  tracked `mates`, a blue chip like Zone Match), Home/rest. Ranking, filters (Skaters, Lineups,
  Odds, live / final; no Check switch) and the Result column as on Goals. Ranked: Plays, Not Plays
  (every other priced line), Model Unsure, No odds.
- Breakdown: season G / A / P -> goals tonight (the Goals page's number) -> his usual assists ->
  line, defense, goalie, Scale (`spread`), home / rest -> tonight "G + A, chance"; the defense
  tiles; a price table for o0.5 / u0.5 / o1.5 / u1.5 (model, fair, Novig, first seen, edge); and
  **his line tonight** on the right: each linemate's points and chance tonight with his own play
  chip (a first look at stacks), with the Linemates chip. Before the lineup is posted it says
  when it fills in.
- YTD Model Performance: tiles Plays, Not Plays, Overs, Unders, Against his avg, closing line value;
  "Said vs got" (1+ point, everyone); graded plays with buttons Every Play / Overs / Unders.
- Tests: `tests/test_nhl_points_site.py` on `tests/fixtures/nhl_points.json.gz`, built by
  `tools/make_nhl_points_sample.py` from the same games and prices as the data sample (as of 10/12
  14:00 UTC, then 10/13 14:12 with that file as the live one, like the Goals sample). Rebuild it
  with that script after a change to what points.json holds.

#### Line Matchups (`site/nhl/lines.html` + `lines.js`, built 2026-10-21; replaced Line Stacks)

The owner, after Line Stacks lost most nights: "Rather than making a tool that surfaces stacks and
plays - which are not performing anyway and are overwhelming - maybe we can create something that
just displays the lines for the night, the strong groups, the weak groups - more of a 'game
preview' style tool." A member who "knows puck" asked for likely line matchups, how each line
performs together, hot / cold streaks and past matchups. **A preview, never a pick sheet: no
prices, no projections, no record.** Under NHL right after Game Previews (not under Player props).
The owner approved a one-game mockup (FLA @ OTT) before the build.

- **The counting** (`nfl_tool/nhl/lines_model.py`, standard library): `game_units(raw)` from the
  kept shift chart (`reduce_game`'s `lines5`; None without one, like games 6-52 of this season).
  5-on-5 = exactly 3 F + 2 D + a goalie a side, read off the shifts each second (not the feed's
  `situationCode`). Per team: `team` and every trio (`F`) and pair (`D`) as `[secs, attempts for,
  against, goals for, against]` (attempts = goals, shots on goal, misses, blocked shots; OT counts
  only if it is 5-on-5, so it never does in the regular season), and `vs` = home trio against away
  trio seconds. A shift counts from just after it starts (`on_ice_finder`'s rule): a goal at the
  last second of a shift belongs to the line it ended.
- `LinesHistory` (this season's games only): `unit` (season + `l3` = last 3 games together; a game
  "together" = 60+ seconds), `usual` (no lineup posted: from the players in the team's latest game,
  `game_lines`' rule over its last 5 games; a team that dressed 11 F shows 3 lines), `deploy` (in
  the home team's home games, seconds by the other team's line rank x his line rank, ranks = that
  game's trios by 5-on-5 time, 0 = mixed groups), `meetings`. `likely_matchups`: for the other
  team's lines 1-4, the home line most often sent out against it, its share, and the mixed share.
- **`lines.json`** (`lines_file` in build_nhl.py; untracked; on fetch_live_data's list;
  `version.json` `nhl.line_matchups` = games): games through `SHOTS_DAYS_AHEAD`, each `{locked, posted,
  teams: {T: {source "posted" | "usual", games, team, lines, pairs}}, players: {id: [name, pos,
  headshot]}, matchups: {games, rows}, meetings: {games, rows: [home ids, away ids, secs]}}`. A
  posted lineup's groups in the story's order (an unknown name = a trio with no history: New
  Together). A started game keeps the last build's entry (locked); none saved = left off.
  `LINES_RULES` (sent as `rules`; the page's tags read them): Strong / Weak at 56% / 44% shot share
  with 20+ minutes together, else Small Sample (New Together at 0); Hot / Cold when the last 3 games
  (10+ minutes) are 5+ points of share from the season or +/-2 in goals, **Steady when the two
  disagree** (the first draft called a line Cold with its share rising: the card can't contradict
  itself).
- **The page:** one game at a time from the day strip ("Lineup" / "Usual Lines" on each card): the
  away team's tiles, a middle column (Likely Matchups with both lines' shot shares, Past Meetings,
  Team 5-on-5), the home team's. A tile: Line / Pair N + tag, three names (`playerClick`), Min · GP,
  Shot Share and Last 3 GP on the eight colors around 50% (`SHARE_STEPS`; shaded only past half the
  Strong minutes), Goals, Form. Under 1180px the middle column goes on top in three; phones one
  column, matchups first. The explanation is behind the "i".
- **What the first look showed (2026-10-21, ~6 games a team with a chart):** trios had 20-60
  minutes together, trio-vs-trio history only 2-8 minutes, and about a third of 5-on-5 time was
  mixed groups, so Likely Matchups is a lean and says so. It firms up as the season goes.
- Tests: `tests/test_nhl_line_matchups.py` (the counting on the saved game and a hand-made one, the
  history, the file) and `tests/test_nhl_line_matchups_site.py` (the page on `helpers.nhl_lines()`,
  built at test time from the saved FLA @ BUF game). `tests/test_nhl_lines.py` is the player card's
  Line column (`game_lines`), not this page.

#### Line Stacks (built 2026-10-16, retired 2026-10-21)

Points parlays of linemates (2-4 legs, a GMG Score from a "shared goals" model; the replay is
`tools/backtest/nhl_stacks.py`, the model `nfl_tool/nhl/stacks_model.py`, both kept with
`tests/test_nhl_stacks.py` for the model). **Retired because it lost:** 4,154 stacks graded over
10/16-10/20, the Score 58+ band said 23% and hit 16%, 51-57 said 21% and hit 12%; with no way to know
how each book prices a same-game parlay, the Score couldn't be fixed (the owner). Gone: the page,
`stacks.json`, the Points page's "Best stacks" box, the build's board and record (`game_ice` /
`ice` too). Kept: `model_history/nhl_stacks/` (the record), the SGP price log endpoint and its D1
rows (members-and-hosting.md), and My Plays still grades members' saved stacks
(plays-and-promos.md).

#### Saves (goalie saves over / under; built 2026-10-19)

The owner: "give the goalie saves model its own Saves page like Shots/Goals/Points". No new model
and no new replay: it is King of the Crease's saves model (above), read as a prop.
- **`saves_file` -> `site/nhl/saves.json`** (not tracked; on fetch_live_data's list; `version.json`
  `nhl.saves` = games with a saves line). Built FROM crease.json's board (`saves_board`), so the
  goalies, the starter call (`source`, never "confirmed"), the projection and the lock are King of
  the Crease's. A failed Crease step writes a saves.json with `error`.
  - Row (`saves_row`): the crease row without its promo numbers (`CREASE_ONLY_KEYS`), plus
    `chance_over` (the model's `mean` at Novig's main line, rounded once), `alts` with the model's
    chance at each, `fair`, `gap` (model minus what the line and price say, `mkt_mean`), `first`
    (carried from the live saves.json while the row names the same goalie), and the play
    (`saves_play`: `shots_play` at `SAVES_EDGES` 3 / 6 / 12 points, plus **check** when the model is
    `CREASE_RULES["check"]` = 4+ saves from `mkt_mean`). `void` = someone else started.
  - **The raw model, not King of the Crease's `blend`**: the promo leans on the line; a prop edge can't.
- **The record** (`model_history/nhl_saves/<month>.json`, `SAVES_RECORD_COLS`, `factors` =
  `SAVES_FACTORS`): every starter with a main line, written once per finished game. **A goalie who
  didn't start is left out** (books void it). `saves_record_summary`: the Points record's buckets,
  overs / unders, fade / with (his saves a start), CLV, ledger, and `honest` (the chance of the
  over said vs how often he went over).
- **Before launch, on King of the Crease's record (10/13-10/18, 92 priced starters): the model ran
  about 1 save BELOW what happened (the line: 0.2 above), and about 1.2 saves under the lines**, so
  early on most plays are unders. Told the owner; the record will say whether it lasts.
- **The page** (`saves.html` + `saves.js`; reuses `.shots-*` / `.goals-*`, its own `.saves-*` in
  nhl.css): #, Goalie (search), **Starter** (green "agree" = lineup and book name him; amber = they
  differ or he started last night; gray = one source), Play, Rating, Avg (saves a start), **Proj**
  (green / red a save above / below the line), Fair, Edge; advanced: Shots, Opp shots, His D, Save
  rate, Home/rest. Filters: Starters (all / lineup + book agree), Edge, Odds, Check plays, live /
  final. Open row: league start -> each piece -> tonight; both sides' tiles on the eight rank colors
  (green = more work for him); main line both ways and the other lines with the model's price and
  first seen; "In net (expected)" with the gap note. Result column: saves + W/L, "Void" when someone
  else started. The open row has the every-book column (`stat` "saves").
- **Every book's saves price (2026-10-20, the owner: SmartStake has "Player Saves" on its odds
  screen).** `smartstake.saves_market_keys` finds the market in `/v1/markets` by name (never a
  guessed key: an unknown key in the odds call could cost every NHL price); `props.saves` like
  shots. `best_saves_prices` swaps each Novig saves line's over / under for the best US book price
  at the SAME line (`over_book` / `under_book` on the crease and saves rows, `nv_*` = Novig's) before
  King of the Crease reads it; the fair `chance` stays Novig's, so King of the Crease's numbers
  don't move. `version.json` `nhl.book_saves` = goalies a book prices (or why none).
- Tests: `tests/test_nhl_saves_page.py` (the build) and `tests/test_nhl_saves_site.py` (the page on
  `helpers.nhl_saves()`, built at test time from the King of the Crease sample).

#### Model Unsure: the safety net (2026-10-22)

The owner, after Sanderson's u0.5 points (+47.3) showed on Best Plays: "if a play like this can
surface, then how can we trust that ANY of these plays are good?" An edge of `UNSURE_EDGE` (25
points) or more is filed **"unsure"** by `shots_play` / `goals_play` (so Shots, Points, Saves and
Goals alike), whatever else it is: the model is missing something, not the book 25 points off.
- Never a play: Shots' `isPlay` and Best Plays leave it out; Goals / Points / Saves list it under
  its own "Model Unsure" heading after the plays (dashed gray tag, `unsureTag` / `unsureHead` in
  nhl-common.js; no "vs his avg"). Each file sends `unsure` for the pages.
- The records grade it in its own `unsure` bucket, never in the plays, `days`, `plays` or
  `ledger`; the factor report skips it like "none". Records are regraded by today's rules, so
  Sanderson's two losses left the plays' record (told to the owner).
- When it was set, Sanderson's two were the only Shots / Points plays of the season past it (next:
  23.7); Goals had never passed 14; one Saves under (Wallstedt, 25.1, lost) also moved there.

#### Closing line value on Novig's prices (2026-10-22)

The owner approved the plan after the audit above. Wins and units stay at the best price across
books (what a bettor gets); **CLV reads Novig alone** (an exchange: the cleanest single read of the
market), at the first look and at the lock.
- `clv_move`: on the same line, the play side's chance with the cut taken out (both sides priced at
  both looks; else that side's own price both times), lock minus first, + = the market moved to the
  model. A moved line counts by direction. `clv_tally` / `clv_add` / `clv_done`: `plays`, `priced`,
  `points` (average over `priced`), `shortened`, `drifted`, `since`, `book` "novig".
- Every board row carries `nv` (`novig_prices` / `novig_goal_prices`: the `nv_*` prices
  best_book_prices keeps, else the row's own) and `first_nv` (carried from the live file like
  `first`; Saves only for the same goalie). Crease rows carry `nv_over` / `nv_under` for this.
- Every record row ends with an `nv` column after `factors` (`CLV_COLS`: over / under
  `[first_line, first_over, first_under, over, under]`, goals `[first_yes, first_no, yes, no]`);
  each file's `nv` key names them. Rows before `BEST_PRICES_FROM` (2026-10-17) hold Novig's own
  prices and count as they are (goals Yes only); rows from it without `nv` are left out.
- One tile for all four pages: `clvTile` in nhl-common.js ("Closing Line Value", "since" date).
- Re-graded when it shipped: Shots -0.4 points (38 shortened, 36 drifted, 74 plays: about even, so
  the old -2.5 was mostly the measurement), Goals -1.4 (4 / 35, 43 plays: still leaning drifted),
  Points 2 plays, Saves none yet. Small samples; it fills from 10/23 on.
- Not the true close: the lock is the last refresh before puck drop (up to 30 minutes early).
- Tests: `tests/test_nhl_clv.py`.

#### Learning which factors win: the factor report (2026-10-16)

The owner: bring Shots and Goals "up to the Points record's standard", then a report (a tool,
not a member page). **Groundwork only: no weight was changed.**
- All three records save the parts behind each graded play (`SHOTS_FACTORS`, `GOALS_FACTORS`,
  `POINTS_FACTORS`), as locked before puck drop.
- `python tools/nhl_factor_report.py` (`--market shots|goals|points`, `--every` adds the no-edge
  plays, `--since`, `--min`, `--json`) grades every play the pages' way (`shots_play` /
  `goals_play`; its totals match the record summaries) and groups them by each factor: plays,
  W-L, win %, the win % the prices needed, units, return a play. A lift (and `mates`, `vs_avg`)
  is grouped by whether it pushed toward the play's side, against it, or under 2%; labels by
  value; other numbers by thirds. **Groups under 100 plays are marked "early"**: tell the owner
  they can't be trusted yet. Old rows count where their own columns say enough (move, average, zone).
- Tests: `tests/test_nhl_factor_report.py` (hand-made records, and the real ones read cleanly).

#### Best Plays (`site/nhl/best.html` + `best.js`, built 2026-10-15)

The owner: "I don't care about the noise, I am in a rush: what are my best overall bets
tonight." First under Player Props. A short list that sends people to the Shots and Goals
pages for the detail, not a copy of them.
- **Every play the Shots, Goals and Points pages call a play** (Shots: its bar, `shots.json` `bar`
  and not moved down a line; Points: the build's `size` "play"; Goals and Saves: `size` strong / lean / check), all
  three markets in one table, biggest edge first. The Shots play is the Shots page's best side
  (the build's `shots_play`, so the record grades the same play); the Goals play is goals.json's
  `edge`; the Points play is points.json's `side` / `price` / `edge` ("o0.5 points", "Points ›").
  A test checks all three against the build.
- **No cap and no "Check" group.** The owner turned down a top-10 / two-a-game cap: "if the model
  notices an edge, we shouldn't punish ourselves ... bettors have to make their own choice."
  Plays the other pages file as "check" are ranked like any other. Through 10/14 Shots' check
  bucket was 48-32 +8.4u, nearly all of it one night (within a standard error of break-even);
  the record will say whether that holds.
- **Every row says its own page's bucket** (a member, 2026-10-20: a player in Check first on the
  Goals page showed here as a plain play; the owner: "this can't happen"). A **Rating** column after
  Play: Shots and Points "Play", Goals / Saves Strong / Lean / Check / New line from the build's `size`
  (`bucketTag` in nhl-common.js, the ONE function the Goals and Points pages use too); a Check's
  edge is amber, as on its page. Goals and Points plays are picked by `size` (strong / lean / check),
  never by the saved edge: edges are saved rounded, so a 2.98 is "3.0" but "none" to the build.
  **Rating sorts** (Strong / Play, Lean, Check; flip it to put the Checks together).
- **Saves (2026-10-20, the owner: "yes")**: a fourth market switch, "Goalie saves". Its plays are
  saves.json's as the build files them (`size` strong / lean / check, a goalie the site knows, priced
  at the best price across books), "o26.5 saves" chips, `savesGapCheck` for its other Check (model and
  line 4+ saves apart), the Saves page's starter tag (`starterTag`, now in nhl-common.js) first in
  Notes, "N GS" under 5 starts, a "Goalie saves" tile with its own slider in the YTD popup (the saves
  record's `ledger`), and the row opens `saves.html#row=`.
- **Notes say what the model may not know yet**, never a verdict: "No lineup" (that market's
  board had no posted lineup), the line change ("L2 ▼", amber when the play goes against the
  move), "N GP" under 5 games, "vs avg" (Shots: against his season average), "Thin". Centered
  in their column (the owner).
- **Lineup banner** when an open game has no lineup: "Lineups are in for X of Y games. Plays
  marked No lineup can change when the NHL posts it." The page fills all day (lunch-break bets).
- Columns: #, Player, Play ("u1.5 shots" / "Scores goal"), **GMG Fair** (the owner's name: the
  model's chance as a no-cut price, the same number as the Shots / Goals pages' Fair; goals use
  goals.json `fair`), Odds, Edge, Notes, Puck drop, a
  "Shots ›" / "Goals ›" link. **Every column with a key sorts; Odds = the biggest payout first**
  (the owner's "return on $1"). No Win % (the owner: "unimportant and clutter"; the chance is in
  the Edge hover). Market switches (Shots on goal, Anytime goal, Points; at least one stays on).
- **A row opens its own row on the other page:** `shots.html#row=<game>:<player>` (or goals.html);
  `linkedRow` / `scrollToRow` in nhl-common.js pick the game, open the row and scroll to it.
- YTD Model Performance: strong + lean + check from each page's record, added up (shots, goals,
  points, all). No record of its own: with no cap, its list is exactly those buckets.
  - **Filterable** (2026-10-16, the owner: "How are SOG Best plays with a 10% edge doing in the
    last 15 days"): each record's `ledger` (`record_ledger` in build_nhl.py) is EVERY graded play
    of the season as `[date, edge, won, units]` (`plays` stays capped at 14 days with the detail).
    The popup is the shared tracker (styles.md, "YTD Model Performance"; Yesterday added
    2026-10-22): a Min Edge slider (3-20 points) in each market's tile, All Plays = every market at
    its own minimum. An edge counts as the table rounds it (9.96 = 10.0). Remembered per device
    (`nfl-tool.ytd.nhl-best.v1`). With no ledger (an old shots.json) the plain season tiles show.
    Since 2026-10-22 the Shots, Goals, Points and Saves popups are the same tracker (`nhlYtd`), and
    each ledger row carries its tags (side, bucket, fade / with, zone, thin) for their split tiles.
- **Filters and book (2026-10-17):** an Edge menu (3+ to 15+ points) and a Lineups menu (all / lineup confirmed) in the toolbar (`bestView.minEdge`, `lineup`); every price is the BEST price any US book quotes at Novig's line (see "Best book prices"); the Odds cell names the book (Novig keeps its logo) and opens every book; a **Good to** column = the worst price that still has the smallest (3-point) edge (`goodTo`).
- **Player cell (2026-10-18, the owner):** the rows are taller since the book name went under each
  price, so the cell's flex box sits INSIDE the td (`.best-player`, a flex td can't center
  vertically); photo 34px, logos 30px (every prop table's `.shots-vs` logos are 30px since 2026-10-29: members found 16-24px too small).
- Phone: the photo and position letter drop out of the Player cell so the play shows without
  scrolling (last phone block of nhl.css).
- Not built yet: **"Dropped since earlier"** (plays listed earlier in the day that fell off after
  a lineup or a price moved, with why). Needs the build to carry each play's first-seen edge
  from the live file, the way `first_odds` is carried.
- Tests: `tests/test_nhl_best_site.py`.

#### Not built yet (waiting on the user's priorities)

Built: Shots, Goals (anytime goal, with expected goals), Points (1+ point), Saves (goalie saves), all above.
For Saves: Best Plays lists its plays (2026-10-20). Line Stacks was retired 2026-10-21 for Line Matchups (above). Next on the
owner's list: re-weighting from the factor report once its groups pass 100+ plays (the records and the report exist: "Learning which factors win"). For Goals: the market's team totals as an anchor once the record has them.
For King of the Crease: a payout estimate before puck drop from the logged payouts (see
Winners), and a lone skater's place on the Shots page's Lineup Confirmed view.
Also open: a Summary card, a game model, shot-by-shot dot maps, the EDGE
tracking stats, playoffs.
For the Shots model: tonight's power-play units from a licensed morning-report feed (past units
from `shiftcharts` were tested and add nothing: see "Power-play units" above); a snapshot of the closing line (the refresh now gets within half an hour of puck drop); the expected starting goalie on
Game Previews (it is already in `shots.json`).

#### Best book prices (the owner, 2026-10-17)

"We should be tracking via the best price available -- bettors should be line shopping anyway."
`best_book_prices` (build_nhl.py, after SmartStake's `book_odds`) swaps each main-line price in
`player_odds` (shots, points and saves over / under, anytime goal; the Saves page's own lines: `best_saves_prices`) for the best price ANY US book quotes at
the SAME line when it beats Novig's; `over_book` / `under_book` / goal `book` name the book and
`nv_*` keeps Novig's. So every edge, play, CLV first price and graded record (Shots, Goals, Points,
Best Plays) is figured on that price. Chances stay the model's / Novig's fair chance. Build-wide: it
ignores a member's My Books (the page's price list still honors them). Locks like the book odds
(a started game keeps the last build's). **Records before 2026-10-17 were graded at Novig's price**,
so the record mixes the two; CLV for that day compares a Novig first price with a best-price lock.
No SmartStake run = Novig's price, as before. Pages say "best price across books" where they said
Novig. Test: `tests/test_nhl_best_prices.py`.
- **On the page, the member's books come first (the owner, 2026-10-23):** when the build's book is
  one the member turned off in My Books, Shots, Goals, Points, Saves and Best Plays show the best
  price among the member's own books at that line, and the edge on it (`memberPrice` /
  `buildBook` in nhl-common.js; none of theirs has it = the build's price). Which plays are listed
  and their buckets stay the build's (the record). No books off = the build's price, as before.
  A My Books change redraws the page. Test: `test_a_member_sees_the_best_price_on_their_own_books`.

#### Every book's price in the Shots, Goals and Points rows (SmartStake, 2026-10-14)

- **Same filters and same open row on every prop page (2026-10-18, a member: "filter by above a
  score, if lineups are out"; the owner: some pages showed odds when opened, some didn't).** Shots,
  Goals, Points and Best Plays all have an **Edge** menu (`edgeOptions` / `edgeAtLeast` in
  nhl-common.js; "Any edge" by default off Best Plays) and a Lineups menu. The
  Points open row has the every-book column too (`stat` "points"). A new prop page gets both.

- `build_nhl.py` asks SmartStake for shots on goal and goals (`smartstake.fetch_nhl_book_odds`;
  key `SMARTSTAKE_API_KEY` on the NHL build step of deploy.yml AND nhl-refresh.yml) and writes
  nhl/data.json `book_odds["AWAY_HOME"].props.{sog,goals}[player id]`; players are matched with
  `player_finder` on either team, trying every spelling the books use. Rules as for the NFL
  (data-pipeline.md): US books, odds lock. Each book is tagged against OUR model at its
  own line (`bookPanelFor(x, stat, line, label, chanceAt, edges)`: shots `chanceOver`, goals
  `r.chance` / `twoPlus`), with the page's `edges`, so the panel's numbers match the Edge column.
- The open row (`detailRow` in shots.js / goals.js, `bookPanelFor` in nhl-common.js) is three
  columns: the build pills, tiles and price table in a 520px left column (the pills wrap there,
  the owner's ask), the rink in the middle, every book's price on the right (`.has-odds`). Under
  1360px wide the odds sit under the rink; on phones everything stacks. A row with no book
  prices keeps the two-column layout. Goals' tabs read Scores / No goal (the 0.5 line).
- **Trimmed tables (2026-10-15, the owner: "too much info right now thrown at users").** No Model %
  or (Goals) Proj column: "the odds show that / fair shows that". Every column is only as wide as
  its contents (`width: 1%` on each header) and an empty last column (`.shots-spacer`) takes the
  spare width, so folding columns away never stretches the rest. Each page's `COLUMNS` entry draws
  its own cell (`cell`); `adv: true` marks an advanced stat, shown only after **Expand advanced
  stats** (`advancedToggle`, `nhlAdvancedStats` in nhl-common.js: one per-device switch for both
  pages). The Rating column's tags are the YTD record's (`ratingTag`). Tests find columns by their
  header text, not position.

#### Explanations behind an "i" (2026-10-14)

The owner: long explanations on screen look "yuck"; put them in a bubble people open themselves.
Every long `p.section-note` on the NHL pages is `hidden` with class `info-note`, opened by a
`button.info-i` (aria-controls = the note's id) beside its heading; the rink key in the open rows
too. The click handler is in sync.js (capture phase), the look in style.css, so any page can use
it. On Shots / Goals the "i" sits right after `#shots-title` (the pages rewrite that title).

#### The player card's Line column (2026-10-14)

Each game log row shows the line he played on that night (L1-L4, D1-D3; `game_lines` in
build_nhl.py): from the league's shift chart, the forward with the most ice time plus the two he
shared the most ice with are a line, and so on; lines are numbered by their ice time (pairs for
defense). Shift charts are fetched once per finished game and kept on it (`fetch_shifts`,
`keep_shifts`); the league has none for games 6-52 of 2026-27, so those rows show "--" (an empty
chart is recorded once a game is `SHIFTS_GIVE_UP_DAYS` old so it isn't asked for every build).
The skater log's last column is `slot`. Date / Opp / Result are only as wide as they need.
