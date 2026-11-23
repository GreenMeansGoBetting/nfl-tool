---
paths:
  - "nfl_tool/nba/shot_types.py"
  - "nfl_tool/site/nba/types.*"
---
# NBA: Player Types

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Player Types (`shot_types.py`, `types.html/.js/.css`, 2026-11-11)

Players typed by HOW they shoot, not position (the owner, after an old "Courtside Pal" chart; "not
all PGs or PFs play the same style"). Audited with the owner before launch: every ESPN label, a
Basketball-Reference comparison, odd vs even games, the owner's eye test.
- **Letters A-L, never names** (A = deepest shooters ... L = rim runners; 12 since 2026-11-13); badges in a
  rainbow, A red to L purple (`indexOf(L) * 25.45` on every page), never a number tile. 50+ shots (`MIN_SHOTS`); heaves out.
- Mix (`F`): distance, 3PT, catch & shoot (plain / running / bank jumpers: 95-97% assisted), pull-up +
  step-back, fade + turnaround, floater, post / hook (driving hooks too), drive, cut (cutting + plain
  layups / dunks, 82-87% assisted), lob / putback, fast break. Every ESPN label in ONE group (`LABELS`);
  an unknown label fails the step.
- **Ten k-means groups + the owner's split**: the bigs who shoot threes (`bigs_group`) with under 20%
  threes become their own type (J: Sengun, Anthony Davis). 11 / 12 groups split scorers, not bigs.
- **B / C split** (the owner, 2026-11-13: "threes are a massive part of betting"): the second-deepest group
  splits at `PULL_CUT` 35% of his threes off the dribble (`p3`, not in the grouping): B pull-up (Curry,
  LaVine, Murray), C catch (Vassell, Hunter, Jabari Smith). The biggest gap (32% -> 37%); 83% kept their side
  odd vs even games. Within `PULL_BAND` 3 points of the line: both letters. Groups `pull` {from, to, cut}; the
  catch half always takes the letter right after the pull-up half. Old C-K became D-L that day.
- **Saved groups, FROZEN** `model_history/nba_shot_types/<season>.json` (mu, sd, centers by letter, split,
  pull, stability, moved). The owner, 2026-11-13: "a basic type of player which is represented by a letter
  and a player fits INTO that type" (a from-scratch test redraw moved 56 players, Edwards without playing).
  Redrawn only by hand (`shot_types.py --write`), as the owner's decision. **Letters checked once a day**
  (`daily_letters`, `<season>_letters.json`): the first build of each Eastern day re-types everyone, later
  builds that day keep those letters; a player new that day is added.
- **Borderline** (`fit` 0.5+): two letters "B / E" (the owner). 2026-11-11 odd / even games: 56% kept
  their letter, 85% letter or lean; clear fits 80%, borderline 33%. 12 types (11/13): 54% / 85%.
- data.json `shot_types` (compute_props, own try): players {name, team, pos, type, lean, fit, border,
  n, mix, avg [games, pts, 3PM, assisted makes]}, `log` (`log_fields`: every night vs his own other-games
  average; `am` / `am_diff` = assisted makes from the play-by-play, appended last, `assisted_makes`), `defense` {teams {abbr: {games, vs {letter: [shots, makes, points, 3PM]}}}, league, team_games}.
- **Page** (menu under Zone Matchup Targets): tabs The 12 Types / Every Player / Defense Vs Type
  (`#types` / `#players` / `#defense`). Tiles on the 8-step scale, the most = green; Defense Vs Type
  ranked from the defense (30th = allows the most, red), Points / Threes Made / Shots a game or FG%,
  under `PT_DEF_MIN` 30 shots faded and unranked. Filtering to a type lists its players then leaners.
- **The letter goes wherever a player's name goes** (the owner, 2026-11-11: useful "across the entire
  site"): `nbaTypeBadge(id)` (nba-card.js; CSS `.pt-letter` / `.pt-badge` in suite.css) beside his
  position: player card, Prop Research list, who.js pop-ups, Zone Matchup Targets. A new place that
  shows an NBA player uses `playerClick` AND `nbaTypeBadge`.
- **Type beside position, never instead**: Prop Research's **Type Matchup** list column (after Opp
  Allows; Points / Threes, All Props for those rows) and panel tab (right box: Points / Threes for his
  type vs tonight's defense, then the latest "Like Him" games), research.js `typeMatch` / `typeTab`,
  Slate Standouts' measuring stick (`TM_MIN` 6), colored like Opp Allows (30th = gives up the most, red).
- **Tonight tab** (first on Player Types): the game carousel (click a game to isolate it, again for all),
  every player on the slate (Out / Doubtful off) with his letter, then per stat two blocks (the owner,
  2026-11-11: "separate the shaded background"): **His Points / His Threes** in blue (his line tonight,
  his average) and **Defense Vs His Type** in purple (+/- over their averages, beat-average x / y)
  (`ptTonightTab`).
- **Matchup Keys: Player Types box** (Overview, under Both Teams; `typeBox`, `typePlayers`): **ONE chart**
  (the owner, 2026-11-13: "combine it into one chart"), a row a letter: away players | away Pts Share |
  home Def Vs Type | letter | away Def Vs Type | home Pts Share | home players; Fit the last row; the box
  cut to its contents. Def Vs Type = points over those players' own averages against it, ranked of the
  defenses at 6+ games, 30th = gives up the most, red. **Pts Share** = share of the team's points a game
  from that letter (typed players' season averages, Out left out, `MK_PTS_GAMES` 3+ games; replaced the
  shot share, "redundant" beside the names). **Fit** = the defense weighted by the offense's Pts Share,
  its parts in the hover (never a hidden score). **Who each letter is** (2026-11-13: "no way to tell who
  is D"): last names, most shots first, Out faded, `playerClick`, away side right-aligned; no number chip,
  each name sits in a box shaded from HIS side (the other defense's rank flipped: soft defense = green).
- **Shot Fit** tab (research panel, Points / Threes, `shotFitTab`): his top 5 shot kinds (catch, pull-up,
  fade, floater, post, drive, cut, lob) beside the FG% tonight's defense allows on each (every shot it
  faced, typed or not: shot_types `defense.kinds` / `league_kinds`), the league's, +/-, rank of 30 (30th
  = allows the best shooting); under `SF_MIN` 40 shots faded. Fit = points per 10 of his shots over the
  league's, weighted by his mix.
- **Zone Matchup Targets: Type tag** beside every read (`zmTypeTag`, `nbaTypeVs` in nba-card.js): Agrees /
  Disagrees / Too Few (6+ games of his type against that defense, before the night shown). **Information
  only, never a filter or "play" wording** (the owner, 2026-11-11: the tool's whole logic needs a rework
  later; on Oct 28-Nov 10 ZMT was 658-674, -39.5u, threes overs the worst; reads the type disagreed with
  went 94-115, -23.9u; agreed 165-162).
- Not now (the owner, 2026-11-11): lineup-aware splits (off for now, "messy"); letter pairings (wait for
  more minutes together, ~December).
- Next (the owner): one more pass on the live page, then matchups by type or the next type family
  (rebounding / assisting / playmaking). Swap position splits for types only where a replay shows types
  predict better. Tests: `test_nba_shot_types.py`, `test_nba_types_site.py`.
