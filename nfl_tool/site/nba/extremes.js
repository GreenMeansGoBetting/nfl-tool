// GMG NBA Suite: Matchup Extremes and Schedule Spots, shared by Team Identity
// (every row) and Game Previews (only the rows that apply tonight, and only
// where the team is far from normal). From identity.py `matchup_extremes` /
// `schedule_spots` (the owner, 2026-10-26: "find the black and white of these
// teams").
//
// Each number = the team's split (its games against a type of opponent, or in
// a schedule spot, minus its games overall) minus the league's split.
// Outcomes: [key, a gap this big gets colored, +1 = more is good for the team,
// -1 = bad, 0 = never good or bad]. Opponent types with side "off" describe
// the opponent's offense, so their rows are the team's defense and the sign
// flips. Each group names its own columns, since the same number reads
// "allowed" on defense and "scored" on offense (the owner, 2026-10-26: "so
// unclear as to what the hell this is even trying to say").
const EX_OUTCOMES = [["pts", 6, 1], ["pace", 3, 0], ["fg3m", 3, 1], ["fta", 6, 1], ["tov", 3, -1]];
const EX_OFF_HEADS = ["Pts Scored", "Pace", "3s Made", "FTs Taken", "Turnovers"];
const EX_DEF_HEADS = ["Pts Allowed", "Pace", "3s Allowed", "FTs Allowed", "TOs Forced"];
const SPOT_OUTCOMES = [["pts", 6, 1], ["opp", 6, -1], ["pace", 3, 0]];
const SPOT_HEADS = ["Pts Scored", "Pts Allowed", "Pace"];
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

// One team's table. opts: outcomes, groups [[filter(t), title, column heads]],
// isTonight(t), tonightOnly (Game Previews: just tonight's rows with a colored
// number). "" when no row is left.
function exRows(ex, abbr, opts) {
  if (!ex || !ex.teams[abbr]) return "";
  const outs = opts.outcomes;
  const row = (t) => {
    const n = ((ex.teams[abbr] || {})[t.key] || {}).n || 0;
    const tonight = opts.isTonight(t);
    const cells = outs.map((o) => exCell(ex, abbr, t, o));
    const far = cells.some((c) => c && c.far);
    // The verdict rides on points (the first outcome): a Strength or a Weak Spot.
    const pts = cells[0];
    const verdict = pts && pts.far ? (pts.good > 0 ? ' <span class="gs-tag gs-tag-mismatch">Strength</span>' : ' <span class="gs-tag gs-tag-tough">Weak Spot</span>') : "";
    const hover = t.teams ? ` title="${t.teams.join(", ")}"` : "";
    const tags = (tonight && !opts.tonightOnly ? ' <span class="gs-tag gs-tag-strong">Tonight</span>' : "") + verdict;
    const html = `<tr class="${tonight ? "ex-tonight" : ""}"><td class="ex-type"${hover}><span class="ex-name">${t.label}</span>${tags}</td><td class="num id-plain${n < EX_MIN_GP ? " ex-thin" : ""}">${n}</td>${cells
      .map((c) => (c ? `<td class="num ${c.cls}" title="${c.title}">${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}</td>` : `<td class="num"></td>`))
      .join("")}</tr>`;
    return { tonight, far, n, label: t.label, html };
  };
  const body = opts.groups.map(([keep, title, heads]) => {
    let rows = ex.types.filter(keep).map(row);
    let unseen = [];
    if (opts.tonightOnly) rows = rows.filter((r) => r.tonight && r.far);
    else {
      // Tonight's types first; types not faced yet (tonight's too) fold into one
      // line at the bottom instead of a row of blanks (the owner: "it clutters it").
      unseen = rows.filter((r) => !r.n).map((r) => (r.tonight ? `<b>${r.label} (Tonight)</b>` : r.label));
      rows = rows.filter((r) => r.n).sort((a, b) => b.tonight - a.tonight);
      const last = rows.filter((r) => r.tonight).length;
      if (last && last < rows.length) rows[last - 1].html = rows[last - 1].html.replace('class="ex-tonight"', 'class="ex-tonight ex-tonight-last"');
    }
    if (!rows.length && !unseen.length) return "";
    const head = `<tr class="id-group ex-head"><td>${title}</td><td>GP</td>${heads.map((h) => `<td>${h}</td>`).join("")}</tr>`;
    const tail = unseen.length ? `<tr class="ex-unseen"><td colspan="${outs.length + 2}">Not Faced Yet: ${unseen.join(", ")}</td></tr>` : "";
    return head + rows.map((r) => r.html).join("") + tail;
  }).join("");
  if (!body) return "";
  return `<div class="id-scroll"><table class="data-table id-table ex-table"><tbody>${body}</tbody></table></div>`;
}

// Matchup Extremes for `abbr` against tonight's opponent `opp`.
function exTable(ex, abbr, opp, tonightOnly) {
  return exRows(ex, abbr, {
    outcomes: EX_OUTCOMES, tonightOnly, isTonight: (t) => t.teams.includes(opp),
    groups: [[(t) => t.side === "off", `${abbr} Defense Vs These Offenses`, EX_DEF_HEADS], [(t) => t.side === "def", `${abbr} Offense Vs These Defenses`, EX_OFF_HEADS]],
  });
}

// Schedule Spots for `abbr` in game `gameId` (spots.tonight lists the spots
// each team is in for the coming games).
function spotTable(spots, abbr, gameId, tonightOnly) {
  if (!spots) return "";
  const now = ((spots.tonight || {})[gameId] || {})[abbr] || [];
  return exRows(spots, abbr, {
    outcomes: SPOT_OUTCOMES, tonightOnly, isTonight: (t) => now.includes(t.key),
    groups: [[() => true, `${abbr} In These Spots`, SPOT_HEADS]],
  });
}
