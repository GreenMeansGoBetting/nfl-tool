---
paths:
  - "nfl_tool/site/promo-tools.*"
  - "nfl_tool/site/contest.*"
---
# Promo Tools: King of the Endzone, the $100 CONTEST and the Promo Tools Menu

Split from `plays-and-promos.md` (2026-11-23), which keeps My Plays, Possible Plays storage, the Pick Tracker and the shared common.js logic.

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
- **Two formats, the owner's chips before the lock** (2026-11-24, Thanksgiving week): **One Pick A
  Game** (above) or **Three A Game**: the game's First TD scorer (either team) plus one anytime TD
  per team, so 5 games = 15 picks, $150. The same player may be a First TD and an anytime pick.
  Each $10 pick is a "slot" (`slotsOf` / middleware `contestSlots`; ids `<game>:F` / `:A` / `:H`,
  the game id in the one-pick format; marks are keyed by slot). Default: Three when 6 or fewer
  games; when 3+ games come Tue-Fri only those are in (the owner's game chips change it).
  **First TD prices: FanDuel's only** (the owner, 2026-11-24: "Keep FD"), from SmartStake's
  `football_player_first_touchdown_scorer_yes_no` (nfl_odds.py, its own alternate-quotes call ->
  `book_odds[game].props.first_td`; team / position from the anytime list). Never Novig's. On
  2026-11-24 the probe (`PROBE=first_td`) found DraftKings, Fanatics, Fliff, Stake and others on it
  but not FanDuel yet; a game with no FanDuel First TD blocks the lock and is named.
- **The next contest** (2026-11-24, the owner: "i see last week only"): `/api/contest` serves the
  latest saved contest. Once it has fully locked and this week's games make a different id, the
  owner gets this week's preview (`wantNew`), with "Last Contest's Results" / "Start This Week's
  Contest" to flip; members keep the saved one until the lock. Locking over a finished contest
  with the same id clears its entries.
- **Each game locks on its own** (`g.lock_at`; the contest's `lock_at` = the last one). Three
  format: the first day's games at that day's first kickoff, every later game at the next kickoff
  (Wednesday alone, Thursday + Friday at DET's kickoff). One format: Sunday 1:00 PM ET for all. A
  locked game's picks can't change (the server keeps the saved ones); a member can still enter
  until the last lock, and **a pick missing from a locked game is a $10 loss** (the owner:
  "Counts as -$30"; the page warns). A locked game's picks show to every member; the rest stay
  hidden. The live feed, Tracking tab and Leaderboard start with the first lock. One
  entry per account (replaced on save); leaderboard name + Discord/email contact (contact only ever
  sent to the owner).
- **First TD grading**: ESPN's earliest scoring play that is a TD (`espnFirstTd`, the name before
  "N Yd"; a defensive TD first = every First TD pick loses), then data.json `first_td` (offense
  only, under the scorer's team). Someone else first = a miss at once; money back only if he
  isn't in the final box score.
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
- Rank: bankroll, then FEWER correct picks, then the
  longest price that hit, then split (the owner's tie rule).
- The menu pill (top of the NFL menu, sync.js `SPORT_PAGES.nfl`) shows for every member since 2026-11-21 (owner-only before).
- Tests: `test_ci_contest.py` (API), `test_contest_site.py` (page).

## The Promo Tools menu (every page, 2026-10-15)

"Promo Tools" in the nav of every NFL, NBA and NHL page opens a dropdown of every promo tool on
the site, whatever its sport (the owner: "have a drop down of all that is available so they can
jump to it easier for any page"). `addPromoMenu` / `PROMOS` in sync.js; a new promo tool is one
line there. The NBA suite has none of its own yet, so its nav gets the button from sync.js.
Links cross sports by full address on nba./nhl. like the suite switcher. Styles `.promo-*` in
style.css (not `.suite-item`: a test counts the switcher's items). Test: `PromoMenu` in
tests/test_nhl_shots_site.py.

## Promo Tools: King of the Endzone (`promo-tools.html/.js`)

DraftKings' weekly promo paying on the game's LONGEST TD, D/ST included.

- Team checklist for this week's games (per-device, `nfl-tool.koe.teams`), position filter.
- Player table: TDs (count / avg / long), TDs by distance (1-10, 11-20, 21-40, 41+), big plays
  (20+/g, 40+ count, longest play), role (touches/g, 20+ runs / catches, ADOT for WR/TE only, deep
  targets/g), and this week's defense (20+ plays allowed/g matched to runs or catches by the
  player's mix, 20+ TDs allowed, avg TD length allowed). Colors vs the whole league. Ruled-out
  players hidden; QBs = current starter only.
- **Upside** = league percentile of weighted z's of what he should do TONIGHT: touches/game x
  per-touch rate, each rate pulled toward his position's average by `KOE_PRIOR_TOUCHES` 40
  (`KOE_UPSIDE_PARTS`: 20+ plays 30%, 40+ plays 15%, deep role 15%, TDs 20%, this week's defense's
  big plays allowed x his touches vs league-average touches, capped 2x, 20%). Never per game:
  2026-10-19 the per-game blend put a 2-touch fullback (Juszczyk) over Diggs and McCaffrey. The
  owner picked this of three options on a weeks 2-6 replay of every game's longest TD (it tied or
  beat the old blend; the longest TD is mostly random). About 35% of winning TDs are under 20 yds,
  so TD volume counts.
- **Touches tonight are lineup-aware** (`koeTouchesNow`, 2026-10-26): touches per team game with
  common.js `lineupWeights` (a fill-in game for a regular who's healthy now counts 15%, a game he
  left early doesn't count). Raw Tch/g put Dameon Pierce (2 games as Barkley's fill-in) over
  Darius Cooper with Barkley back. The Tch/g column stays the real count; the Upside hover shows
  the touches used.
- Layout: each column group has a colored header bubble spanning its columns (`KOE_GROUP_CLASS`,
  `.koe-g-*` colors), empty 8px gap columns split the groups, and every stat box is a fixed 44px
  (TD distances 38px; `table-layout: fixed`, colgroup), rows 32px; the player column (214px) has
  photo, name, team logo and position on one line. No Opp column. Table ~1130px so it screenshots
  easily; **Save image** (`saveKoeImage`) downloads `#koe-capture` as a PNG with a GMG title
  naming the games and week.
- D/ST table: return TDs (INT / FUM / KR / PR with yards), takeaways/g, opponent giveaways/g, D/ST
  TDs the opponent has allowed. No Upside score for D/ST yet.
- Data: `nfl_td.py compute_koe` -> `DATA.koe` (players per team, team big plays allowed,
  `dst_tds` / `dst_tds_allowed`; return TD length = `return_yards`, else `fumble_recovery_1_yards`).
- **Week toggle** (2026-10-14, the owner: "doesn't have a week toggle so going back is not
  possible"): arrows beside "Week N" in the Teams panel. A past week shows its board **as it
  stood going into the week** (labeled so): `koe_week_boards` runs `compute_koe` on the games
  before week W, for W = 2 to now (week 1 has nothing before it), and saves each one once every
  earlier game is final (`model_history/nfl_koe/<season>/week-NN.json`, committed by the deploy
  bot) so the build doesn't redo the season every run. Past weeks: that week's injury report
  and the QB who started that week (`koeOut`, `koeStarterQb`); this week keeps the live rules.
  Once a game is final a **Result** column shows each player's longest TD in it, with a star for
  the game's longest (`koe_game_results`: offensive TDs at their gain, return TDs as "<TEAM>
  D/ST" at their return length, ties name everyone; roster full names). Both go to
  `site/koe_weeks.json` (its own file, only this page loads it; on fetch_live_data's list).
- **Winners** (2026-10-14, the NHL King of the Crease list carried over): beside the table when
  there is room, never in the saved image. One collapsible line per **contest** = a game the
  owner has logged payouts for (the promo is one game a week, so far Monday night): week and
  game, the longest TD's scorer and yards, his place going into the week ("2nd of 20" = by
  Upside among both teams' players, starters only, as the table ranks them: `koeBoard`), and
  what he paid. Open: pool, about how many were on him (pool / payout), **If they'd won** (each
  player DraftKings showed a payout for: TD, Pre, Up, Paid), our top Upside and the most picked.
  No Worth column: Upside is a 0-100 score, not a chance (the planned longest-TD chance model
  would add one, and a Value column).
  - The owner's paste box (only with `html.is-owner`): pick the game (finished games, the last
    Monday one first), the pool (required; filled from the last one logged), DraftKings' list as
    it comes. Names match both teams' board players, every TD scorer and both D/STs ("Falcons
    D/ST"); any unmatched name, or no pool, blocks the save. D1 `koe_payouts` through
    `/api/koe-payouts` (member-profiles.md).
- Tests: `tests/test_koe_build.py` (results and boards on hand-made plays) and
  `tests/test_koe_site.py` (the toggle, Result column, Winners and paste box in a browser).
