---
paths:
  - "nfl_tool/site/nba/nba-card.js"
  - "nfl_tool/site/nba/shot-chart.js"
  - "nfl_tool/site/nba/shot-charts.*"
  - "nfl_tool/nba/shots.py"
---
# NBA: The Player Card and Shot Charts

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## The player card (`nba-card.js`)

- **Every place an NBA page shows a player wraps him with `playerClick(id, inner)`** (ESPN id). And beside his position, his Player Type letter (`nbaTypeBadge(id)`). Pages
  load `../book-odds.js` and `nba-card.js` after their own script; every name in it starts `nbaCard` /
  `NBA_CARD`. Same shell as NFL / NHL (`#player-card-modal`).
- Head + this season's tiles (Games, Min, Pts, Reb, Ast, 3PM, PRA). **Game Log**: this season ONLY
  (`DATA.season`), newest first (Min with "B" off the bench, Pts, Reb, Ast, 3PM, 3PA, FG, FT, PRA,
  Stl, Blk, TO, PF, +/-), shaded against his own games.
- **Odds:** every market in `GMG_NBA_PROP_STATS` (sync.js) at the books' main line (`nbaCardMainLine`
  = zone_matchups.py `main_line` to the letter, used by the card, Prop Research, the line record and the sim:
  the line the most books price on BOTH sides with the Over 25-75% no-vig, ties nearest even then lower;
  else the two-sided line nearest even; else the line most quotes hang. Never the middle of every line
  listed: exchanges and bet365 put side lines in the main market, 2026-11-06 Holiday 3.5 at +400); best Over / Under (`bookPricePill`), a save box each side, "This Season" = games
  over that line. First Basket too. Saves `{id: nba:<stat>:<game>:<player>, ...}` at the best price;
  Over and Under share the id. **Show Alt Lines** (button beside the note, the owner 2026-11-02): every
  other line a book prices (main market off-lines + the `_alt` ladder) as an "Alt" row under its
  market, best price + save box each side (a rung's own id `...:<side><line>`), "This Season" at that
  line. Off-sim pages fetch `ladders.json` the first time it opens (`nbaCardLadders`).
- `LOG_FIELDS` (props.py): new fields go after the first eleven (`BOX_EXTRA`).
- Markets (`NBA_PROP_MARKETS`): points, rebounds, assists, threes, pra, pr, pa, ra, steals, blocks,
  stocks, turnovers; asked only when listed (`nba_listed_markets`, `max_pages=60`). No fouls.
- **Double Double / Triple Double** (the owner, 2026-11-20; `nba_odds.add_yes_no`, `alternate=True`): Yes = "o",
  No = "u", no line (`props.double_double` / `triple_double`). Card rows "Yes / No" in the Line column, Yes in Over,
  No in Under, This Season = games with 10+ in 2 / 3 of pts, reb, ast, stl, blk (sync.js `GMG_NBA_YES_NO`,
  `gmgNbaTens`); saved with side "yes" / "no", graded by `gradeNbaPlay`. version.json `nba.yes_no`: players priced per market (or the error).
- Grading (my-plays.js `gradeNbaPlay`, `gmgNbaStatValue`): box score without him = Void; none yet = wait.
- **Shot Chart** (`shot-chart.js`, `nbaShotView(id)`, names `nbaShot` / `NBA_SHOT`, loaded before
  nba-card.js) reads **`shots.json`** (`shots.py`, own try; gitignored, in fetch_live_data.py):
  `games`, `teams`, `players[<id>]` = [x, y, made, three, game index, flags (1 = 1st qtr / 2 = first 3
  min), kind (1 self / 2 catch / 3 drive-cut-rim), team, defense], `who`, `league`. Teams from the
  **box-score** team (never ESPN's play `team_id`); All-Star sides out. **x below 25 = shooter's
  left**; heaves 35+ ft and FTs out; basket at the top. 12 zones; Heat Map hexagons 1.6 ft (size
  capped at 92nd pct, color = make rate within 3.5 ft vs league). Color pulled toward the league by
  `NBA_SHOT_PRIOR` 6 shots. Filters: Season / L10 / L5, 2PT / 3PT, kind, 1st Qtr / First 3 Min.
- **Shot Charts page** (`shc-*` classes; `sc-*` is the NFL card's): a shooter vs a defense (address
  `#p=<id>&d=<TEAM>`), day strip with each team a button + roster buttons, dropdowns kept. Defense
  side drawn `{allowed: true}` (**red = allows more than the league**). Zone By Zone table with a
  **Call**: Target / Tough when one side is 2.5+ pts from the league and the other isn't 0.75+ the
  other way, zones with 5%+ of his shots and 5+ tries. Its global `DATA` is data.json.
- Tests: `test_nba_player_card_site.py`, `test_my_plays_site.py` (NbaPlays), `test_nba_shot_charts_site.py`,
  `test_nba_shots.py`.
