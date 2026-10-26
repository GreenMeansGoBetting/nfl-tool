// GMG NBA Suite: Matchup Extremes and Schedule Spots, shared by Team Identity
// (every row) and Game Previews (only the rows that apply tonight, and only
// where the team is far from normal). From identity.py `matchup_extremes` /
// `schedule_spots` (the owner, 2026-10-26: "find the black and white of these
// teams").
//
// Each number = the team's split (its games against a type of opponent, or in
// a schedule spot, minus its games overall) minus the league's split.
// Outcomes: [key, label, a gap this big gets colored, +1 = more is good for
// the team, -1 = bad, 0 = never good or bad]. Opponent types with side "off"
// describe the opponent's offense, so their rows are the team's defense and
// the sign flips.
const EX_OUTCOMES = [["pts", "Pts", 6, 1], ["pace", "Pace", 3, 0], ["fg3m", "3PM", 3, 1], ["fta", "FTA", 6, 1], ["tov", "TOV", 3, -1]];
const SPOT_OUTCOMES = [["pts", "Pts", 6, 1], ["opp", "Opp Pts", 6, -1], ["pace", "Pace", 3, 0]];
const EX_WORDS = { pts: "points", opp: "points allowed", pace: "possessions a 48", fg3m: "3s made", fta: "free throws", tov: "turnovers" };

// One cell: null with no games, else {gap, cls, title, far}.
function exCell(ex, abbr, t, [o, , at, way]) {
  const c = (ex.teams[abbr] || {})[t.key] || { n: 0 };
  const v = c[o];
  const lg = ex.league[t.key] && ex.league[t.key][o];
  if (!c.n || !v || v[1] === null || lg === null || lg === undefined) return null;
  const gap = v[1] - lg;
  const good = way === 0 ? 0 : gap * way * (t.side === "off" ? -1 : 1);
  const far = way !== 0 && Math.abs(gap) >= at;
  const who = t.side === "off" ? `${t.label} had` : `${abbr} had`;
  const where = t.side === undefined ? "in this spot" : "against them";
  const title = `${who} ${v[0]} ${EX_WORDS[o]}${o === "pace" ? "" : " a 100"} ${where} (${c.n} game${c.n === 1 ? "" : "s"}): ${v[1] > 0 ? "+" : ""}${v[1]} vs ${abbr}'s usual. League: ${lg > 0 ? "+" : ""}${lg}.`;
  return { gap, far, title, cls: far ? (good > 0 ? "tier-good" : "tier-bad") : "id-plain" };
}

// One team's table. opts: outcomes, groups [[filter(t), title]], isTonight(t),
// tonightOnly (Game Previews: just tonight's rows with a colored number).
// "" when no row is left.
function exRows(ex, abbr, opts) {
  if (!ex || !ex.teams[abbr]) return "";
  const outs = opts.outcomes;
  const row = (t) => {
    const n = ((ex.teams[abbr] || {})[t.key] || {}).n || 0;
    const tonight = opts.isTonight(t);
    const cells = outs.map((o) => exCell(ex, abbr, t, o));
    const far = cells.some((c) => c && c.far);
    const hover = t.teams ? ` title="${t.teams.join(", ")}"` : "";
    const html = `<tr${tonight ? ' class="ex-tonight"' : ""}><td class="ex-type"${hover}>${t.label}${tonight && !opts.tonightOnly ? ' <span class="gs-tag gs-tag-strong">Tonight</span>' : ""}</td><td class="num id-plain">${n}</td>${cells
      .map((c) => (c ? `<td class="num ${c.cls}" title="${c.title}">${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}</td>` : `<td class="num id-plain">--</td>`))
      .join("")}</tr>`;
    return { tonight, far, html };
  };
  const body = opts.groups.map(([keep, title]) => {
    let rows = ex.types.filter(keep).map(row);
    if (opts.tonightOnly) rows = rows.filter((r) => r.tonight && r.far);
    else rows.sort((a, b) => b.tonight - a.tonight); // tonight's first, the rest in their usual order
    return rows.length ? `<tr class="id-group"><td colspan="${outs.length + 2}">${title}</td></tr>${rows.map((r) => r.html).join("")}` : "";
  }).join("");
  if (!body) return "";
  return `<div class="id-scroll"><table class="data-table id-table ex-table"><thead><tr><th>${opts.head}</th><th>GP</th>${outs.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Matchup Extremes for `abbr` against tonight's opponent `opp`.
function exTable(ex, abbr, opp, tonightOnly) {
  return exRows(ex, abbr, {
    outcomes: EX_OUTCOMES, head: "Facing", tonightOnly, isTonight: (t) => t.teams.includes(opp),
    groups: [[(t) => t.side === "off", `Facing Offenses: ${abbr} Defense`], [(t) => t.side === "def", `Facing Defenses: ${abbr} Offense`]],
  });
}

// Schedule Spots for `abbr` in game `gameId` (spots.tonight lists the spots
// each team is in for the coming games).
function spotTable(spots, abbr, gameId, tonightOnly) {
  if (!spots) return "";
  const now = ((spots.tonight || {})[gameId] || {})[abbr] || [];
  return exRows(spots, abbr, {
    outcomes: SPOT_OUTCOMES, head: "Spot", tonightOnly, isTonight: (t) => now.includes(t.key),
    groups: [[() => true, `Schedule Spots: ${abbr}`]],
  });
}
