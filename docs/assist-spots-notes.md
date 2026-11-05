# Assist Spots: Brainstorm Notes (2026-11-05)

A new NBA assist tool, separate from the Assists research panel. Not on the site. Mockup:
`mockups/assist-spots.html` (open through any local server at the repo root), data from
`mockups/assist-spots-build.py` (reads hoopR's 2027 play-by-play through `possessions.Season`).

## The Owner's Verdict On Mockup 1 (Rejected)

"An overwhelming mess of information with no direction. I don't know what's good or bad. I don't
know if someone has a good or soft matchup." Specifically:
- No verdict: every player got 15 colored tiles and no answer. A row must say good spot / soft
  spot / nothing at a glance.
- Ugly: two-line stacked thin headers ("Chances / A 36"); headers must be one line.
- Too wordy: "No Clear Recipe / Spreads It Around", long tags. Same complaint as always.
- "Who Else Handles" looked random (Mitchell got Larsson, Giannis got Wiggins): the biggest on / off
  swing for any teammate is not a story unless that teammate's status changes tonight.
- Idea from the owner: group by team or game, a different view, instead of one long player list.

## What The Research Found (Keep)

Assists = **Chances** (teammates' makes while he's on the floor) x **His Share** of them. Low nights
come from three different causes, and the tool should tell them apart:
- **Teammates missed** (noise, bounce-back): Mitchell 10-26 DAL, teammates 2/17 on catch-and-shoot 3s.
- **Someone else ran the offense**: Giannis with Wiggins on (the starting five, Mitchell handles)
  22% share vs 43% with Wiggins off (bench groups, Giannis is the point guard). Mitchell's share is
  42-48% in games Giannis played little (MIN, CHA), ~30% otherwise.
- **Fewer minutes / possessions**: Mitchell 11-02 LAL, 29 min.

Passers have recipes (share of their assists by shot type: catch-and-shoot 3s, catch and drive,
cuts / lobs, off-dribble 3s, short / mid): Giannis 52% catch-and-shoot 3s (league 33%), 35% in the
first 8 seconds; Trae 28% lobs; Draymond 29% cuts, 39% to Curry; Luka 41% catch and drive; Podziemski
47% catch-and-shoot 3s. Mitchell has no clear recipe (spreads it around) and is read through
Chances x Share instead. Giannis to Mitchell: kick-outs and closeout drives, zero cuts.

Defenses differ 2-4x on assisted makes by type (corner catch-and-shoot 3s POR 1.6 to OKC 4.5 per
100 possessions; lobs WSH 0.6 to DAL 2.4). Use attempts allowed (a scheme habit), not makes (luck).
Every call reads both sides: his recipe AND the defense's allowed rate on those types.

Owner's stances: no league-median blending (his own games, show the count, a spread check:
"13 to Mitchell across 7 of 9 games" is real, 8 in one game is flagged). Start from the line.
No projections; the tool flags spots, the member decides. Keep a graded record from day one.

Tonight's (11-05) real spots the mockup found: Draymond's share 44% with Gui Santos on vs 28%
without, Santos OUT; Booker and Dillon Brooks bounce-back (teammates cold, chances normal).

## Built (2026-11-05, after mock-ups 2-5 on the cdmcc PC)

Live as `nba/assist-spots.html` (spots.js on research.js); the rules are in `.claude/rules/nba.md`,
"Assist Spots". What the owner steered on the way: Over / Under / Mixed / No Read per row; the Prop
Research list and drop-down panel ("design it like the prop pages"); the props Vs The Line copied over;
"Bounce-Back" dropped ("thats like saying someone is due") for a yellow Volume tag; defense ranks read
from the defense (30th = allows the most, red); every tile colored against its own column; and the
Read weighing every factor (Targets, Types, Lineup) instead of one trigger.
