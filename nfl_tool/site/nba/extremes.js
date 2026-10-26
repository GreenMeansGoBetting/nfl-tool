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
const EX_WORDS = { pts: "points", opp: "points allowed", pace: "possessions a 48", fg3m: "3s made", fta: "free throws", tov: "turnovers" };
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
  const who = t.side === "off" ? `${t.label} had` : `${abbr} had`;
  const where = t.side === undefined ? "in this spot" : "against them";
  const title = `${who} ${v[0]} ${EX_WORDS[o]}${o === "pace" ? "" : " a 100"} ${where} (${c.n} game${c.n === 1 ? "" : "s"}): ${v[1] > 0 ? "+" : ""}${v[1]} vs ${abbr}'s usual. League: ${lg > 0 ? "+" : ""}${lg}.${thin ? ` Under ${EX_MIN_GP} games: not colored yet.` : ""}`;
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
      .map((c) => (c ? `<td class="num ${c.cls}" title="${c.title}">${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}</td>` : `<td class="num id-plain ex-thin">--</td>`))
      .join("")}</tr>`;
    return { tonight, far, n, label: t.label, html };
  };
  const body = opts.groups.map(([keep, title, heads]) => {
    let rows = ex.types.filter(keep).map(row);
    let unseen = [];
    if (opts.tonightOnly) rows = rows.filter((r) => r.tonight && r.far);
    else {
      // Tonight's types first; types not faced yet fold into one line at the bottom.
      unseen = rows.filter((r) => !r.n && !r.tonight).map((r) => r.label);
      rows = rows.filter((r) => r.n || r.tonight).sort((a, b) => b.tonight - a.tonight);
      const last = rows.filter((r) => r.tonight).length;
      if (last && last < rows.length) rows[last - 1].html = rows[last - 1].html.replace('class="ex-tonight"', 'class="ex-tonight ex-tonight-last"');
    }
    if (!rows.length) return "";
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
