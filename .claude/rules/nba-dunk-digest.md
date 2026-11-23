---
paths:
  - "nfl_tool/nba/narrative.py"
  - "nfl_tool/site/nba/dunk-digest.*"
---
# NBA: Dunk Digest

Part of the NBA rules; the shared ones (files, this season only, data, build) are in `nba.md`, which loads with this file.

## Dunk Digest (`dunk-digest.html/.js/.css`, 2026-11-18; owner only for now)

The owner's nightly walk-through for videos (an older page of this name was removed 2026-11-11): members want
the data, sorted by game, on the site so it can be clicked into, without hopping between pages.
- **Every game in tip order, top to bottom:** game bar; Matchup Summary (zoom 1.6) with each team's Injuries and
  Team Numbers beside it (each box titled with its stat, the owner: "its not clear what these are"); both Edges
  side by side (zoom 1.2); a small Both Teams; Player Types (zoomed to its row by `ddFit`; its note on game 1
  only); **Standouts, then Tough Spots under them, full width, zoom 1.4** (the owner: side by side was "too
  small"); Narrative.
- **Nothing is worked out here.** It loads matchup-keys.js and standouts.js and calls their drawing functions
  (`summaryCard`, `edgeBox`, `bothBox`, `typeBox`, `ssBuild`, `ssGameBand`), so numbers and clicks stay theirs.
  `window.NBA_DIGEST` stops those two files booting; `DATA` is `var` in both so they can share a page;
  `ssRender` is swapped for `ddRefresh` (a drop-down or saved play redraws only the Standouts boxes).
- **Camera:** a 1400 px column on the left (`--dd-z` shrinks it to fit) and the game list under the owner's
  camera (`.dd-rail`, sticky at 215 px). Under 1500 px wide the list moves above the column.
- **Owner only:** an `owner` row in `SPORT_PAGES`, and CSS hides the page unless `html.is-owner` / `.local-dev`
  (a member with the link sees "This page isn't open yet"). A browser-side block: the data is what members have.
- **Narrative** (`narrative.py`, data.json `narrative`, own try; the owner approved the rules 2026-11-18): talking
  points, **never a pick** (revenge measured zero in `nba_spots.py`). Rotation players; the page drops Out / Doubtful.
  No saved data or a neutral site = "No Data Yet"; nothing that fits = "None Tonight". Never guessed.
  - **Revenge Game** (both teams): **any season he played for tonight's opponent, however long ago** (the owner,
    2026-11-19, after a games + recency rule cut Jrue Holiday at MIL: "I like to know if any player is returning to
    face a familiar foe"). The row shows games, seasons with them and **"N Seasons Ago"** (from his last season there).
    Tags from ESPN game logs, preseason out, read only if he left within `TAG_SEASONS` 3: **First Game Back** (road,
    never played there since leaving), **First Time Facing Them** (home, or a neutral site). Order: tagged first, then
    the most recent stint.
  - **Back To Hometown** (road players): 2 of ESPN's place, Wikipedia's birthplace and a local high school within
    `NEAR_MILES` 75; a local school on file must be near too (Bam Adebayo: born Newark, schools in NC); national preps
    (`PREP`) never count. **ESPN's "birthplace" behaves like a hometown** (54 disagreements with Wikipedia: the high
    school sat near ESPN's place 48 times, Wikipedia's once).
  - **Back To College** (road players): any school he attended, Wikipedia for transfers, ESPN's always included.
  - Both: tonight's arena must be the **closest of the 30** (NY / BKN and LAL / LAC count as one; Danny Wolf's Glencoe
    is Chicago, not Milwaukee), and his own team's arena not within 75 miles. Home players aren't "going back".
  - **Saved facts:** `model_history/nba_bios/<season>.json` (bot commits it): each full build re-reads new players and
    the oldest past `STALE_DAYS` 7, at most `MAX_REFRESH` 80, and tonight + 3 days' game logs once a day; a source
    down keeps what's saved; the injury refresh asks nothing. Re-read all (about 6 minutes):
    `py nfl_tool/nba/narrative.py --season 2027 --seed`. A wrong story: add the player to `HIDE`.
  - Tests: `tests/test_nba_narrative.py`, `tests/test_nba_digest_site.py`.
