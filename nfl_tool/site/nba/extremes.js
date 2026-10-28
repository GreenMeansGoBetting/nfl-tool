// GMG NBA Suite: Matchup Extremes and Schedule Spots, read by Matchup Breakdown
// (nba.js: the Vs Tonight's Types rows and Tonight's Spots). From identity.py
// `matchup_extremes` / `schedule_spots` (the owner, 2026-10-26: "find the black
// and white of these teams").
//
// Each number = the team's split (its games against a type of opponent, or in
// a schedule spot, minus its games overall) minus the league's split.
// Outcomes: [key, a gap this big gets colored, +1 = more is good for the team,
// -1 = bad, 0 = never good or bad]. Opponent types with side "off" describe
// the opponent's offense, so their numbers are the team's defense and the sign
// flips.
const EX_OUTCOMES = [["pts", 6, 1], ["pace", 3, 0], ["fg3m", 3, 1], ["fta", 6, 1], ["tov", 3, -1]];
const SPOT_OUTCOMES = [["pts", 6, 1], ["opp", 6, -1], ["pace", 3, 0]];
// Hover wording, plain English (the owner, 2026-10-26: "had 116 points a 100
// against them? what does that even mean"). [verb, noun, more, fewer, verb now] by who
// the number is about: the team's defense, its offense, or a schedule spot;
// the last word is the verb for "the average team ...".
const EX_SAY = {
  def: { pts: ["allowed", "points", "more", "fewer", "allows"], fg3m: ["allowed", "made 3s", "more", "fewer", "allows"], fta: ["allowed", "free throw tries", "more", "fewer", "allows"], tov: ["forced", "turnovers", "more", "fewer", "forces"] },
  off: { pts: ["scored", "points", "more", "fewer", "scores"], fg3m: ["made", "3s", "more", "fewer", "makes"], fta: ["took", "free throws", "more", "fewer", "takes"], tov: ["committed", "turnovers", "more", "fewer", "commits"], opp: ["allowed", "points", "more", "fewer", "allows"] },
  pace: ["played at", "possessions a 48 minutes", "faster", "slower", "plays"],
};
const exNum = (x) => Math.abs(x).toFixed(1);
// "Vs Fast Teams (3 games): WSH allowed 121.4 points per 100 possessions, 7.3 more
// than its usual. The average team allows 2.4 more than usual vs them. Net: WSH 4.9
// worse than the average team vs them."
function exHover(abbr, t, o, n, v, lg, gap, good, thin) {
  const say = o === "pace" ? EX_SAY.pace : EX_SAY[t.side === "off" ? "def" : "off"][o];
  const [verb, noun, up, down, lgVerb] = say;
  const per = o === "pace" ? "" : " per 100 possessions";
  const where = t.side === undefined ? `In the spot "${t.label}"` : `Vs ${t.label}`;
  const move = (x) => (Math.abs(x) < 0.05 ? "the same as" : `${exNum(x)} ${x > 0 ? up : down} than`);
  const lgMove = Math.abs(lg) < 0.05 ? "the same as usual" : `${exNum(lg)} ${lg > 0 ? up : down} than usual`;
  const vs = t.side === undefined ? "in this spot" : "vs them";
  const verdict = `Net: ${abbr} ${exNum(gap)} ${good === 0 ? (gap > 0 ? up : down) : good > 0 ? "better" : "worse"} than the average team ${vs}.`;
  return `${where} (${n} game${n === 1 ? "" : "s"}): ${abbr} ${verb} ${v[0].toFixed(1)} ${noun}${per}, ${move(v[1])} its usual. The average team ${lgVerb} ${lgMove} ${vs}. ${verdict}${thin ? ` Under ${EX_MIN_GP} games, so not colored yet.` : ""}`;
}
// Fewer games than this against a type (or in a spot) is one odd night, not a
// pattern: the number shows faded and never colored or tagged.
const EX_MIN_GP = 3;

// One cell: null with no games, else {gap, cls, title, far, good}.
function exCell(ex, abbr, t, [o, at, way]) {
  const c = (ex.teams[abbr] || {})[t.key] || { n: 0 };
  const v = c[o];
  const lg = ex.league[t.key] && ex.league[t.key][o];
  if (!c.n || !v || v[1] === null || lg === null || lg === undefined) return null;
  const gap = v[1] - lg;
  const good = way === 0 ? 0 : gap * way * (t.side === "off" ? -1 : 1);
  const thin = c.n < EX_MIN_GP;
  const far = !thin && way !== 0 && Math.abs(gap) >= at;
  const title = exHover(abbr, t, o, c.n, v, lg, gap, good, thin);
  return { gap, far, good, title, cls: far ? (good > 0 ? "tier-good" : "tier-bad") : thin ? "id-plain ex-thin" : "id-plain" };
}

