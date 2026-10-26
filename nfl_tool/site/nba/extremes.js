// GMG NBA Suite: Matchup Extremes, shared by Team Identity (every type) and
// Game Previews (only the types tonight's opponent is, and only where the
// team is far from normal). From identity.py `matchup_extremes` (the owner,
// 2026-10-26: "find the black and white of these teams").
//
// Each number = the team's split against a type of opponent minus the
// league's split against that type. [key, label, a gap this big gets colored,
// +1 = more is good for the team's offense, 0 = never good or bad]
const EX_OUTCOMES = [["pts", "Pts", 6, 1], ["pace", "Pace", 3, 0], ["fg3m", "3PM", 3, 1], ["fta", "FTA", 6, 1], ["tov", "TOV", 3, -1]];
const EX_WORDS = { pts: "points", pace: "possessions a 48", fg3m: "3s made", fta: "free throws", tov: "turnovers" };

// One cell: null with no games, else {gap, cls, title, far}.
function exCell(ex, abbr, t, o) {
  const [, , at, way] = EX_OUTCOMES.find((x) => x[0] === o);
  const c = (ex.teams[abbr] || {})[t.key] || { n: 0 };
  const v = c[o];
  const lg = ex.league[t.key] && ex.league[t.key][o];
  if (!c.n || !v || v[1] === null || lg === null || lg === undefined) return null;
  const gap = v[1] - lg;
  // positive = good for this team: its offense up (def types), or its opponents down (off types)
  const good = way === 0 ? 0 : gap * way * (t.side === "def" ? 1 : -1);
  const far = way !== 0 && Math.abs(gap) >= at;
  const who = t.side === "off" ? `${t.label} had` : `${abbr} had`;
  const title = `${who} ${v[0]} ${EX_WORDS[o]}${o === "pace" ? "" : " a 100"} in ${c.n} game${c.n === 1 ? "" : "s"}: ${v[1] > 0 ? "+" : ""}${v[1]} vs ${abbr}'s usual. League: ${lg > 0 ? "+" : ""}${lg}.`;
  return { gap, far, title, cls: far ? (good > 0 ? "tier-good" : "tier-bad") : "id-plain" };
}

// The table for one team. tonightOnly: just the types `opp` is where at least
// one number is far from normal (Game Previews); "" when there are none.
function exTable(ex, abbr, opp, tonightOnly) {
  if (!ex || !ex.teams[abbr]) return "";
  const row = (t) => {
    const n = ((ex.teams[abbr] || {})[t.key] || {}).n || 0;
    const tonight = t.teams.includes(opp);
    const cells = EX_OUTCOMES.map(([o]) => [o, exCell(ex, abbr, t, o)]);
    const far = cells.some(([, c]) => c && c.far);
    const html = `<tr${tonight ? ' class="ex-tonight"' : ""}><td class="ex-type" title="${t.teams.join(", ")}">${t.label}${tonight && !tonightOnly ? ' <span class="gs-tag gs-tag-strong">Tonight</span>' : ""}</td><td class="num id-plain">${n}</td>${cells
      .map(([, c]) => (c ? `<td class="num ${c.cls}" title="${c.title}">${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}</td>` : `<td class="num id-plain">--</td>`))
      .join("")}</tr>`;
    return { tonight, far, html };
  };
  const group = (side, title) => {
    let rows = ex.types.filter((t) => t.side === side).map(row);
    if (tonightOnly) rows = rows.filter((r) => r.tonight && r.far);
    else rows.sort((a, b) => b.tonight - a.tonight); // tonight's types first, the rest in their usual order
    return rows.length ? `<tr class="id-group"><td colspan="${EX_OUTCOMES.length + 2}">${title}</td></tr>${rows.map((r) => r.html).join("")}` : "";
  };
  const body = group("off", `Facing Offenses: ${abbr} Defense`) + group("def", `Facing Defenses: ${abbr} Offense`);
  if (!body) return "";
  return `<div class="id-scroll"><table class="data-table id-table ex-table"><thead><tr><th>Facing</th><th>GP</th>${EX_OUTCOMES.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}
