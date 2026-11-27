---
paths:
  - "nfl_tool/site/possible-plays.*"
  - "nfl_tool/site/picks.js"
  - "nfl_tool/site/common.js"
  - "nfl_tool/site/my-plays.*"
  - "nfl_tool/site/plays-grading.js"
  - "nfl_tool/site/parlay-wheel.js"
---
# My Plays, Possible Plays and the Pick Tracker

Stories behind these rules: `docs/history.md`, "Possible Plays, picks and promos".

<<<<<<< Updated upstream
=======
## $100 CONTEST (`contest.html/.js`, `/api/contest`; built 2026-11-20)

The owner's free weekly TD contest for members. One player per game (every game left in the week,
through Monday night), $10 fake money on each, $10 x games bankroll; a hit pays at the locked
price, a miss loses $10, a player with no snaps that week gets the $10 back.
- **One price for everyone: FanDuel's** (the owner, 2026-11-20), the build's `player_td_odds[].fd`
  (`book_td_odds`). The owner presses "Lock FanDuel Prices & Open Contest" (owner-only bar) after
  the video; that snapshot (games, players, prices, lock time) is the contest, saved by the login
  code (D1 `contests`, `contest_entries`, made on first use). Re-lock keeps or clears entries.
- **FanDuel's anytime TD is an "alternate" quote at SmartStake** (Yes only), so nfl_odds.py asks
  for the TD market on its own call with alternate quotes (2026-11-21: without it only Fliff, 4CX,
  Fanatics and Pinnacle came back and the lock failed). The page refuses to lock while a game has
  no FanDuel prices and names the games.
- **Kickoffs come from the books** (`book_odds[game].kickoff`) when they have one: flexed games
  (2026-11-21) were days behind in the schedule.
- **Locks Sunday 1:00 PM ET** (the Sunday game's date): the server refuses saves after it. One
  entry per account (replaced on save); leaderboard name + Discord/email contact (contact only ever
  sent to the owner). Before the lock members see who entered, not their picks.
- **Graded live** (2026-11-22, the owner: "more fun if we could do a semi live update"). First
  that applies (`gradeInfo`): the owner's hand result; ESPN's final box score; data.json the morning
  after (`player_td_results` any_td, `player_snaps` for "didn't play") only for a game ESPN never
  finished; then ESPN's in-game box score. **nflverse never replaces ESPN** (the owner: "instead of
  an auto replace ... an alert that says if there's differences"): every picked player whose
  data.json result differs from ESPN's final, with no hand result, is listed to the owner only
  (`diffs` / `diffBox`, under the owner bar on every tab) with Use nflverse / Keep ESPN, both a
  hand result. Members see the Tracking tab; only the owner gets the buttons. After the lock a GET of
  `/api/contest` asks ESPN (scoreboard + each started game's summary) at most every 2 minutes, saved
  in D1 `contest_live` (kind `feed`; made on first use); no timer (GitHub's runs hours late), the page
  re-asks every 2 minutes. Rushing / receiving / return TDs only (passing TDs don't count). A TD counts
  at once; a miss only once ESPN calls the game final; a player missing from a final box score gets
  the $10 back until the morning. Names: same `normName`, else one teammate with that last name and
  first initial. ESPN WSH / LAR = WAS / LA. A final game is never fetched again.
- **Tracking tab** (after the lock): every picked player by game, the game clock, how many picked
  him, the result and where it came from (Live / Official / Set By GMG). The owner's TD / No TD /
  Out / Auto buttons save `action: "mark"` (kind `marks`), beating the feed and the morning data.
  "Reset Every Hand Result To Auto" (owner bar, after the lock, while any exist) = `action: "unmark"`.
- **The morning data judges a miss / didn't-play only once the team's snap counts for the week are
  in** (`officialGrade`; a TD counts from the TD list alone). nflverse posts TDs hours before snap
  counts: Thanksgiving 2026's 3:37 AM build called every non-scorer "didn't play", and the owner's
  Use nflverse clicks saved it.
- Rank: bankroll, then FEWER correct picks, then the
  longest price that hit, then split (the owner's tie rule).
- The menu pill (top of the NFL menu, sync.js `SPORT_PAGES.nfl`) shows for every member since 2026-11-21 (owner-only before).
- Tests: `test_ci_contest.py` (API), `test_contest_site.py` (page).

>>>>>>> Stashed changes
## My Plays (`my-plays.html/.js`; built 2026-10-20)

The owner: "a checkbox to all plays across the site (NFL NBA NHL) and isolate the possible plays
to its own tab by promo tools which would aggregate all plays ... These would all self grade as
well. Nothing changes from history saved already." Built for NFL and NHL (NBA has no plays yet:
its prop pages get the box from day one).

- **Its own top-menu button**, "My Plays", after Promo Tools (sync.js `addTopMenu`, `.mine-trigger`,
  no dropdown). Possible Plays left the NFL list; `possible-plays.html` is a redirect to My Plays
  (2026-10-21, the owner: "I don't want that reroute to exist"). The page lives on the NFL address
  (`my-plays` in the middleware's `NFL_PAGES`) and reads `nhl/data.json` + `nhl/players/` there.
- **Storage:** NFL plays stay in `nfl-tool.possible-plays.v1`, untouched. NHL plays are
  `nfl-tool.nhl-plays.v1` (sync.js `loadNhlPlays`/`saveNhlPlays`; in both sync key lists), saved
  by the box beside each priced play on Shots, Goals, Points, Saves and Best Plays
  (nhl-common.js `nhlPlayBox` / `nhlPlayEntry`). Id `nhl:<market>:<game>:<player or legs>`: one per
  player, market and game, so the box stays checked when the line moves and Best Plays and the
  prop page share it (a box is ticked only on the saved side). **A ladder rung** (open-row ladders,
  the card's alt lines, 2026-11-02; NBA the same with `nba:` ids) adds `:<o|u><line>` and is its own
  play; a goals rung (2+, hat trick) is market `goal` with side over and a line, graded on it. The
  price saved is the one shown when checked.
- **Grading:** NFL through `plays-grading.js` (moved out of possible-plays.js, same rules). NHL
  from the team's box score in `nhl/players/<TEAM>.json` once the schedule says final: SOG,
  goals, points (G+A), saves (SA-GA); a player not in that night's log = Void; a Line Stack wins
  when every leg has 1+ point, Void if a leg didn't play. Hand results win, like the NFL's.
- **Line Stacks (retired 2026-10-21; members' saved stacks still grade) have no price** (SGPs are priced at the book): the row shows a Price box; until one
  is typed in, the stack counts in the record but not the units (`unitsForPlay` gives 0).
- Filters: sport chips (All, then one per sport that has plays), When (NFL weeks, NBA / NHL days)
  and Type. Every column header sorts (click again to flip); When sorts all sports by the game's
  day (an NFL play's from data.json's schedule). Checked rows narrow the record and the Photo
  Export (groups say the sport when mixed).
- **Parlay Wheel** (2026-10-21, asked for by NHL members; the owner: "prompt users to select what
  they want in their wheel"): the button opens a picker first (`renderWheelPicker`): sport chips,
  When, Pending Plays Only (on), Type chips, then every play by game with its own box; rows
  checked in the list start it. Then legs and spin (`parlay-wheel.js`, moved from
  possible-plays.js, told how a play looks by `WHEEL_LOOK`). A game = sport + week / day +
  matchup. The legs screen asks **No SGP** (default: one play per game, landing on a play clears
  its game) or **Yes SGP** (any number per game, only that play leaves; legs up to the play
  count, max 10).
- **NBA:** the page is ready for it: once the NBA prop pages bring `loadNbaPlays` / `saveNbaPlays`
  (sync.js, both sync key lists), its plays show here with a `date`, chip, filters and wheel.
  Grading, logos and wheel colors for NBA still need adding then (`gradeNhlPlay`'s twin, `WHEEL_LOOK`).
- Tests: `tests/test_my_plays_site.py`.

- **NBA plays** (2026-10-21): saved from NBA First Basket's every-book window (nba-first-basket.md, "Saving a
  play"), `loadNbaPlays` in sync.js, graded from nba/data.json `first_basket.results`
  (`loadNbaForGrading`); each play carries its own `logo` and `color` for the list and the wheel.

## Possible Plays storage (common.js; the page itself is gone, its parts live on My Plays)

- Saved plays live in `nfl-tool.possible-plays.v1` (synced to the member's profile). A play's id
  has the player's name in it, so plays are matched by `possiblePlayKey` (common.js: the id
  without Jr./Sr./II-IV and punctuation), never by exact id: `isPossiblePlay` and
  `togglePossiblePlay` both use it. `dedupePossiblePlays` merges existing doubles on page load
  (newest kept; a result already on the older copy carries over).
- **Photo Export** (My Plays): a Columns choice (Auto / 1-4) and **Save image**, of the plays
  shown (or the ones checked). The image (`#plays-export-card`, `.pe-*` styles) is just team logo, play, odds, grouped
  under category bars and flowed into columns so everything fits one picture.
  - **Show results** (2026-10-20, a member: the saved card "is basically just listing all my
    bets", he wanted the greens and reds and units): on when the week has any graded play.
    Rows shade green / red (`.pe-row-<result>`) with their units (`unitsForPlay`, the same
    tiered stakes as the record); pending / push / void stay plain with a small label; the
    title bar shows the record and units in a shaded box plus "N pending".
  - **Game lines name their game:** a total reads "BUF @ KC Over 54.5" with both logos, a
    spread / moneyline its side's logo (`exportPlayLogo` / `exportPlayText`; the play itself is
    unchanged). Test: `tests/test_plays_export_site.py`.
- **TD bets grade on a loose name match** (`gradeTdPlay`, `normName`): bets may carry a book's
  spelling ("Brian Robinson Jr.") while TD results use nflverse's ("Brian Robinson"). Already-
  graded auto losses flip to wins on next load. A manual result always beats a later auto re-grade.
- The build also keeps one spelling per player in the odds (`canonicalize_odds_names`; see
  nfl-odds.md).

## Pick Tracker (`picks.js`; rendering in game-overview.js / game-summary.js)

- Grades each pick on the line and price saved at pick time (`line_at_pick` / `odds_at_pick`),
  which is Novig's when available. A saved pick is always shown at that line (`pickLabel`).
- **Your Record week filter:** checkbox chips above the record, "All weeks" plus one chip per week
  that has picks (shown whenever there are picks, even one week). Check any mix of weeks to see
  just those; none checked = all weeks. Recent Picks stays unfiltered. The selection is a
  per-device view preference in localStorage (`nfl-tool.picks.weekFilter`), not synced. Old picks
  without a `week` fall back to their game's week in the schedule.
- Pick Tracker buttons match the Summary card's My Picks strip.

## Shared logic in common.js (other pages rely on it)

- `matchupCall` / `matchupKind` / `MATCHUP_CONTRA`: the two-sided matchup rule.
- `lineupWeights` / `lineupAdjustedXtd`, `lineupOutOn`, `rosterOut()`, `firstTdInjuryStatus`:
  lineup-aware usage (rules in data-pipeline.md).
- `currentStarterQb(team, week)`: whoever threw the most in the team's most recent game, unless
  ruled out this week (then the starter before). Returns null when every recent starter is out;
  callers then fall back to most attempts.
- `normName`, `shortName`, `teamBannerHeader`, `summaryFontCSS`, and the summary-card helpers
  (see styles.md).
