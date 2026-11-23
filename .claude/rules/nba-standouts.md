---
paths:
  - "nfl_tool/site/nba/standouts.*"
  - "nfl_tool/site/nba/extremes.js"
---
# NBA: Slate Standouts

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Slate Standouts (`standouts.html/.js/.css`, 2026-11-11; first in the NBA menu)

The front door (the owner: "see all the mismatches in one place and by category so they dont have to
wade through info on top of info"). A night's slate (day arrows), categories (Points, Threes, Paint &
Mid-Range, Rebounds, Turnovers, Free Throws, Pace & Total; counts on the buttons), Season / Last 10,
**Standouts** (toward more) beside **Tough Spots** (toward less). **Numbers, not picks: no
projections, no line / "priced in" check, no record or tracking** (the owner: "adds undue pressure").
- **Team rows = Matchup Keys' own keys** (`nbaMatchupKeys`, never a copy): offense Edge / Fits = a
  Standout; a defense Edge = a Tough Spot for the offense facing it; Same Style / Trend by direction
  (`SS_LESS`). Its top-10-of-30 cut is Matchup Keys'; change both together or neither. The owner wants
  other tools' game-level angles here too, not only Player Types.
- **Player rows = his type vs tonight's defense over their own averages** (shot_types `log`: each
  night minus his other games' average, leave-one-out; no pull toward the league). The owner's
  cutoffs (`SS_PLAYER`, `SS_HIT_*`, `SS_MIN_GAMES`, picked from a count of each option): **+2.5 points /
  +0.7 threes, beat it 55% of the time (Tough: 45% or less), 6+ games** ("for now": raise the games
  cut as the season fills); he must do it himself (12+ points / 1.5+ threes a game); Out / Doubtful off.
  Tiles: his average, the type's +/- vs that defense (rank of the defenses, 30th = gives up the most,
  red; hover lists the players behind it), beat-average x / y.
- **Rebounds go by the board, not the ball** (2026-11-17, the owner: the defensive glass only ever showed
  as the other team's Tough Spot): a Glass Edge or Rebound Chances is a Standout for the team that gets
  those boards ("UTAH Defense: Glass" = UTAH's row, "Defense vs LAC", its own tile first); Few Rebound
  Chances a Tough Spot. Every other category still reads by who has the ball.
- **In each category, players (with their letters) first, then teams** (the owner: not jumbled).
- **Clicks** (the owner, 2026-11-11, "to match the feel of the other pages"): a team row's rank tiles open
  Matchup Keys' who's-behind-it pop-up (who.js `whoTile_` / `whoOpen`, the tile's one matchup); a player
  row's +/- or Beat Avg tile opens a drop-down under it with tabs: **Players Like Him** (every game by his
  type against that defense: date, that player's line that night from props.json research `lines` /
  `lines3` by the log's `game`, what he scored, Over / Under, vs his own average; and "went over their
  line in x of y") and **<DEF> Vs Every Type** (that defense against all 11 letters, his outlined). His
  first tile is his **line tonight** (`ssLine`, the player card's main-line rule) with his average under it.
- **Saved check** (a member, 2026-11-14: "a check box ... so we know we chose them"): a player's line tile opens
  every book (`ssOpenLine`, book-odds.js `spec.save`, Prop Research's save rule); a price there saves to My Plays,
  and a player saved on that stat in that game gets a green check by his name and in the tile (`ssCheck`).
- **Stacked** = a player row and a team row, same game, category and direction (parts shown, never
  blended; hover names the team spot). A team logo / name / the game opens Matchup Keys on that game.
- **Two views** (the owner, 2026-11-12, picked from three mock-ups: A Headliners + Board, B Game Cards, C a games-by-categories map): **By
  Category** (default: a slate strip, game chips with ▲ / ▼ counts; **Biggest Standouts / Tough Spots
  Tonight**, three headliner cards a side; then the two lists, each category a green / red band) and a
  **Sort By Game** toggle ("for SGP bettors": a card per game, its Standouts and Tough Spots, a
  category chip on every row; per-device pref `nba-tool.ss-bygame.v1`). Same rows, tiles and clicks.
- **Headliners** (`ssHeroPick`): ordered by `ssStrength` (players: how far the type's +/- runs past the
  owner's cut; teams: Matchup Keys' score), never capped; **the strongest player spot and the strongest
  team spot always make it** (2026-11-12 audit: one kind crowded the other out, Quickley -5.4 1/7 off).
  It only orders headliners and shades category chips (Standouts the 3 greens, Tough the 3 reds).
- Tests: `test_nba_standouts_site.py`.
