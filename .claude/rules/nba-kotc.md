---
paths:
  - "nfl_tool/nba/kotc.py"
  - "nfl_tool/site/nba/kotc.*"
  - "nfl_tool/site/nba/promo-tools.html"
---
# NBA: King of the Court

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## King of the Court (Promo Tools; `kotc.py`, `promo-tools.html` + `kotc.js` + `kotc.css`)

DraftKings' promo on the night's most PRA.
- Build (`compute_kotc`, own try): `seasons[<this season>]` (`league`, `defense`, `players`, `nights`,
  `summary`), `slates` (next 3 nights), `default`, `past` (`past_nights`: pregame board + the night's 40
  best, with `rank` / `lead` / `proj`), `weights`, `thresholds`, `record`.
- This season only (no toggle, no `PRIOR_GAMES` seed). A player needs min(`MIN_GAMES` 3, half his
  team's games rounded up).
- **Buckets cumulative** (40+ ... 60+). Score is built but **not shown**; Opp Top = the other
  defense's `star` (most PRA by one opponent, per game).
- Positions PG-C on the board, vs Pos and the defense board; position number = PRA per 48 allowed,
  steadied with 10 games (`pos_f`). **The projection's matchup still reads G / F / C** (`grp`,
  `grp_f`): **ask the owner before switching** (`py tools/backtest/nba_kotc.py --five-matchup`).
- Players sit on today's roster-file team.
- **Projection** (`project`, `WEIGHTS`): half season, half last 10; x `pos_f`; x (total / league
  total)^0.2. **Lead %** (`lead_chances`): 6,000 slate runs, sd 4 + 0.22 x proj, ties split. Out players
  stay grayed with no chance. Blowouts and B2B are tags only (0 in the number). Replay:
  `py tools/backtest/nba_kotc.py`.
- Lines: `lines_2026.json` (backtest); this season's Novig line at tip in `nba_kotc/lines_<season>.json`.
- **Record** (`kotc_record`): each night's top 60 by Lead % from the last build before the first tip,
  never rewritten; Nightly Leaders show "Pre n". NBA builds run every 6 hours, so a board can be 6 hours old.
- **Historical Data** (`summary`): four tiles, one label each, no subtext (AVG Winning PRA, Winners Team
  Favored, Winners AVG Game Total, Winner in Top 5); winning PRA by slate size; total / spread mix;
  positions; most nights led. This season only.
- **The page:** night arrows (past and slate), Save image; **player board and defense board side by
  side**, Nightly Leaders and payouts below. Player board: top 25, Show all; Lead %, Proj, Avg,
  buckets, Opp, Opp Top, vs Pos, Total, Spread, Est Pay; B2B / blowout tags; **no L10, no "from" tag**.
  Finished night: Pre, PRA, P / R / A, Lead %, Proj, Opp, Paid; winners starred, DNP last. **Defense
  board** (flipped 2026-11-17, the owner): one row per OFFENSE playing the night (Team), Tonight = the
  defense it faces, and every number after is that DEFENSE's; Targets = the Team's own top 3 by Lead %;
  idle teams have no row; colors rank against all 30; red = bad defense; default sort Top Opp. A 40+ ...
  60+ cell opens who did it vs that defense with his box line (`big` per defense, `big_cols`).
- **Leader Trends** (beside Nightly Leaders, the owner 2026-11-10; `renderTrends`, `trendPoints`): an SVG
  scatter, a dot a leader. Tabs **Pregame Rank** (x games that night, y his Pre place, square-root
  scale, not on that night's board = bottom "Off" row) and **Spread & Total** (x his spread, favored
  left; y the total). Dots on one spot merge into a bigger dot with the count; color = Pre on the
  8-step scale; three tiles under each (Top 5 by slate size; Favored 5+ / Within 5 / Underdog 5+), a
  tie half a night each. Hover or tap names the dot; Save image.
- **Ties:** every co-leader counts (own line, Tie tag, starred; Historical Data splits shares, full
  night each in Most nights led; Est Pay's fit leaves out tied payouts).
- **Payouts:** the owner's box (is-owner / localhost) saves Prize Pool + DraftKings' pasted list to
  `/api/court-payouts` (D1 `court_payouts`). **Est Pay** after `FIT_MIN` 6 payouts: log(paid / pool) on
  log(Lead %). Unproven.
- Tests: `test_nba_kotc.py`, `test_nba_kotc_site.py`. Not built: book PRA lines, teammate usage bump,
  pace, Est Pay by slate size.
