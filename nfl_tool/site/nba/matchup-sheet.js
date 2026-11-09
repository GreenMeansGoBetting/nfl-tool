// ---- GMG NBA Suite: The Matchup sheet (matchup-sheet.js) ----
// Moved from the Matchup Data page (nba.js) to Matchup Keys' Summary tab when Matchup Data was
// retired (the owner, 2026-11-09: "add that matchup sheet to a fourth tab called summary ... then i
// believe we can remove matchup data"). Every identity row both directions side by side, rank of 30
// first and its number small, called with the site's two-sided rule; then Vs Tonight's Types.
// matchup(g) -> {html, edges}; a stat name opens who's behind it (who.js). Uses matchup-keys.js
// (DATA, team, logo, teamRgb, esc), league-cols.js (ordinal), extremes.js, sync.js (scaleHsla).
const signed = (n, digits = 1) => (n === null || n === undefined ? "--" : n === 0 ? "PK" : `${n > 0 ? "+" : ""}${String(Number(n.toFixed(digits))).replace(/\.0$/, "")}`);
// ---- ranks and cells ----
// Where value v sits among `table` (team -> numbers) on `key`: 1 + the teams
// better than it. hi = bigger is first. Works for a team's own number and for a
// number from part of its season (wins, losses).
function rankIn(table, key, v, hi) {
  if (v === null || v === undefined || !table) return null;
  const vals = Object.values(table).map((s) => s[key]).filter((x) => x !== null && x !== undefined);
  if (!vals.length) return null;
  return Math.min(vals.length, 1 + vals.filter((x) => (hi ? x > v : x < v)).length);
}
const teamsOf = (table) => Object.values(table || {}).filter((s) => s && Object.keys(s).length).length;
// One cell: {r, n, num, title, plain (never colored), abbr (logo in it), faded};
// `big` leads with that number and puts the rank small (Points Per Quarter).
function cellTd(c, extra = "") {
  if (!c) return `<td class="mb-v mb-empty${extra}"></td>`;
  const hue = c.n > 1 ? Math.round((120 * (c.n - c.r)) / (c.n - 1)) : 60;
  const style = c.plain || !c.r ? "" : ` style="background:${scaleHsla(hue, 70, 45, 0.32)}"`;
  const lg = c.abbr ? logo(c.abbr, 16) : "";
  const big = c.big !== undefined ? `<b>${c.big}</b>` : c.r ? `<b>${ordinal(c.r)}</b>` : "";
  const small = c.big !== undefined ? (c.r ? ordinal(c.r) : "") : c.num;
  return `<td class="mb-v${c.faded ? " mb-faded" : ""}${extra}"${style} title="${esc(c.title || "")}">${lg}${big}${small ? `<small>${small}</small>` : ""}</td>`;
}

// ---- the identity numbers (identity.py) ----
const block = () => {
  const id = DATA.identity;
  return (id && id.seasons && id.seasons[id.default]) || null;
};
const idTeams = () => (block() || {}).teams || {};
const idStats = (abbr) => idTeams()[abbr] || null;
// How far a team's number sits from the league average, in league spreads.
function z(abbr, key) {
  const s = idStats(abbr);
  const lg = (block() || {}).league && block().league[key];
  if (!s || !lg || s[key] === null || s[key] === undefined) return null;
  return (s[key] - lg.avg) / (lg.sd || 1);
}
function pctFmt(v) {
  return `${(v * 100).toFixed(1)}%`;
}
const FORMATS = { ppp: (v) => v.toFixed(2), pct: pctFmt, num: (v) => v.toFixed(1) };

// The matchup rows: key, label, how it prints, way (+1 the offense wants it
// high, -1 low, 0 = how often), group, how-often noun (Fits / Takes Away), the
// share a make-rate row needs (the offense takes at least the league's usual
// share there). The owner's cuts, 2026-10-28: half-court and seconds a
// possession (repeat scoring and pace), steals' share, the two 3-point zones
// (3PT share only; "3pt% is going to level out"), rim + paint as one Paint
// (both shares count), pull-up / catch / assisted as one Ball Movement.
const M_ROWS = [
  ["ppp", "Pts / Possession", "ppp", 1, "Scoring"],
  ["pace", "Pace", "num", 0, "Scoring", "Pace"],
  ["trans_freq", "Transition Share", "pct", 0, "Scoring", "Transition"],
  ["trans_ppp", "Transition Pts / Poss", "ppp", 1, "Scoring"],
  ["tov_rate", "Turnovers", "pct", -1, "Possessions"],
  ["oreb_rate", "Rebounding", "pct", 1, "Possessions"],
  ["fta_rate", "Free Throws / Shot", "pct", 1, "Possessions"],
  ["three_rate", "3-Point Share", "pct", 0, "Shot Diet", "3s"],
  ["paint_share", "Paint Share", "pct", 0, "Shot Diet", "Paint Shots"],
  ["paint_pct", "Paint FG%", "pct", 1, "Shot Diet", null, "paint_share"],
  ["mid_share", "Mid-Range Share", "pct", 0, "Shot Diet", "Mid-Range"],
  ["mid_pct", "Mid-Range FG%", "pct", 1, "Shot Diet", null, "mid_share"],
  ["ball_move", "Ball Movement", "pct", 0, "Shot Diet", "Ball Movement"],
];
const M_GROUPS = ["Scoring", "Possessions", "Shot Diet"];
// The defense side of a row reads as the defense's own number where that's plainer:
// Rebounding = the offense's offensive boards vs the defense's defensive boards.
const DEF_SHOW = { oreb_rate: (v) => 1 - v };
const ROW_HOVER = {
  ppp: ["Points a possession", "Points a possession allowed"],
  pace: ["Possessions a 48 minutes", "Possessions a 48 minutes its games run at"],
  trans_freq: ["Share of possessions in transition (a shot or turnover within 8 s of a defensive board or steal)", "Share of opponents' possessions in transition"],
  trans_ppp: ["Points a transition possession", "Points allowed a transition possession"],
  tov_rate: ["Share of possessions ending in a turnover (1st = fewest)", "Share of opponents' possessions it forces a turnover (1st = most)"],
  oreb_rate: ["Offensive rebound % (its misses it gets back)", "Defensive rebound % (opponents' misses it gets)"],
  fta_rate: ["Free throws a shot", "Free throws a shot allowed"],
  three_rate: ["Share of shots that are 3s (1st = most)", "Share of opponents' shots that are 3s (1st = fewest)"],
  paint_share: ["Share of shots at the rim or in the paint (1st = most)", "Share of opponents' shots in the paint (1st = fewest)"],
  paint_pct: ["FG% at the rim and in the paint", "FG% allowed at the rim and in the paint"],
  mid_share: ["Share of shots from mid-range (1st = most)", "Share of opponents' shots from mid-range (1st = fewest)"],
  mid_pct: ["Mid-range FG%", "Mid-range FG% allowed"],
  ball_move: ["Makes assisted and catch-and-shoot shots, averaged (1st = most)", "The same for its opponents (1st = fewest)"],
};

// Calls (the site's two-sided rule, like common.js matchupCall): an EDGE needs one
// side EDGE_Z league spreads toward a team and the other not EDGE_CONTRA the other
// way; a how-often row with both sides FREQ_GAP out is Fits (the offense does it a
// lot, this defense allows it a lot) or Takes Away (it rarely allows it).
const FREQ_GAP = 0.7;
const EDGE_Z = 0.6;
const EDGE_CONTRA = 0.3;
const EDGE_BIG = 1.0; // the two sides average a full league spread = Big Edge
function rowCall(off, de, r) {
  const [key, , , way, , noun, shareKey] = r;
  const oz = z(off, `off_${key}`);
  const dz = z(de, `def_${key}`);
  if (oz === null || dz === null) return null;
  if (way === 0) {
    if (!noun || oz < FREQ_GAP) return null;
    if (dz >= FREQ_GAP) return { kind: "fits", size: oz + dz };
    if (dz <= -FREQ_GAP) return { kind: "takes", size: oz - dz };
    return null;
  }
  if (shareKey && (z(off, `off_${shareKey}`) ?? -1) < 0) return null; // a zone it rarely shoots from
  const a = oz * way; // + = good for the offense
  const b = dz * way; // + = this defense allows a lot (good for the offense)
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const dir = hi >= EDGE_Z && lo > -EDGE_CONTRA ? 1 : lo <= -EDGE_Z && hi < EDGE_CONTRA ? -1 : 0;
  if (!dir) return null;
  if (key === "trans_ppp" && dir === 1 && (z(off, "off_trans_freq") ?? -1) < 0) return null; // only helps a team that runs
  return { kind: "edge", team: dir > 0 ? off : de, size: Math.abs(a + b) / 2 };
}
const callPill = (c) => !c ? "" : c.kind === "edge"
  ? `<span class="mb-edge${c.size >= EDGE_BIG ? " mb-big" : ""}">${logo(c.team, 14)}${c.size >= EDGE_BIG ? "Big Edge" : "Edge"}</span>`
  : `<span class="gs-tag ${c.kind === "fits" ? "gs-tag-strong" : "gs-tag-weak"}">${c.kind === "fits" ? "Fits" : "Takes Away"}</span>`;

// One side's cell on a row: the offense ranks 1st = best (how often: most), the
// defense 1st = best (how often: allows the fewest).
function sideCell(abbr, side, r, opts = {}) {
  const [key, label, kind, way] = r;
  const k = `${side}_${key}`;
  const v = opts.value !== undefined ? opts.value : (idStats(abbr) || {})[k];
  if (v === null || v === undefined) return null;
  const up = way >= 0; // the offense wants it high (how often: "most" is 1st)
  const hi = side === "off" ? up : !up;
  const n = teamsOf(idTeams());
  const shown = side === "def" && DEF_SHOW[key] ? DEF_SHOW[key](v) : v;
  const words = ROW_HOVER[key] ? ROW_HOVER[key][side === "off" ? 0 : 1] : label;
  const r0 = rankIn(idTeams(), k, v, hi);
  return { r: r0, n, num: FORMATS[kind](shown), title: `${abbr} ${side === "off" ? "Offense" : "Defense"}${opts.when ? ` (${opts.when})` : ""}: ${words}, ${FORMATS[kind](shown)}${r0 ? ` (${ordinal(r0)} of ${n})` : ""}` };
}

// ---- tonight's types (Matchup Extremes, extremes.js) ----
// A type row: the side that IS the type gets its rank in that trait; the other
// side gets its split against teams like that (points vs normal, minus the
// league's), ranked among every team that has faced the type (2026-10-28: ranked
// among only the few with 3+ games, MIL's +7.2 allowed read "2nd"). The row
// shows once that team has EX_MIN_GP+ games against the type.
function splitCell(ex, abbr, t) {
  const c = exCell(ex, abbr, t, EX_OUTCOMES[0]);
  if (!c) return null;
  const n = ((ex.teams[abbr] || {})[t.key] || {}).n || 0;
  const sign = t.side === "off" ? -1 : 1; // facing an offense type, fewer allowed is good
  const all = Object.keys(ex.teams).map((x) => exCell(ex, x, t, EX_OUTCOMES[0])).filter(Boolean).map((cc) => cc.gap * sign);
  const mine = c.gap * sign;
  return { r: 1 + all.filter((v) => v > mine).length, n: all.length, num: `${signed(c.gap)} Pts`, title: c.title, faded: n < EX_MIN_GP, call: c.far ? { kind: "edge", team: c.good > 0 ? abbr : null, size: Math.abs(c.gap) / 6 } : null };
}
function traitCell(t, abbr) {
  const i = (t.order || []).indexOf(abbr);
  if (i < 0) return null;
  return { r: i + 1, n: t.order.length, num: "", title: `${abbr}: ${ordinal(i + 1)} of ${t.order.length} as one of the ${t.label}` };
}
// The pair of cells (offense, defense) a type gives the direction `off` has the ball, or null.
function typePair(ex, t, off, de) {
  if (t.side === "off" && t.teams.includes(off)) {
    const d = splitCell(ex, de, t);
    if (!d || d.faded) return null;
    return { o: traitCell(t, off), d, call: d.call && { ...d.call, team: d.call.team || off } };
  }
  if (t.side === "def" && t.teams.includes(de)) {
    const o = splitCell(ex, off, t);
    if (!o || o.faded) return null;
    return { o, d: traitCell(t, de), call: o.call && { ...o.call, team: o.call.team || de } };
  }
  return null;
}

// A column head: the team's logo and "HOU Off" (the owner: no "Has The Ball" / "Call" heads).
const colHead = (abbr, what) => `<th class="mb-colhead">${logo(abbr, 18)} ${abbr}${what ? ` ${what}` : ""}</th>`;
// Labels sit at the far left of a team-vs-team table (the owner, 2026-10-28); The
// Matchup keeps its label in the middle, since each row reads both directions.
const labelTd = (text) => `<td class="mb-stat">${text}</td>`;

// A filled number box opens who's behind it too (the owner, 2026-11-09: "all these colored boxes are clickable")
// off / def: the half's offense and defense (its two boxes read offense, then defense: the offense on the left)
const tdWho = (html, key, off, def) => (whoTopic(key) && html.startsWith('<td class="mb-v') ? html.replace('<td class="mb-v', `<td${whoAttr(key, off, def, "o")} class="mb-v mb-who-v`) : html);

// ---- The Matchup: every row, both directions side by side ----
// [call][away off][home def] [label] [home off][away def][call]: the label in the
// middle, the calls on the far outside (the owner, 2026-10-28).
// Returns {html, edges: [{team, side, size, label, o, d}]}.
function matchup(g) {
  const a = g.away;
  const h = g.home;
  const edges = [];
  const COLS = 7;
  const rowHtml = (label, A, H, key = null) => `<tr${(A && A.call) || (H && H.call) ? ' class="mb-called"' : ""}>
      <td class="mb-call">${callPill(A && A.call)}</td>${tdWho(cellTd(A && A.o), key, a, h)}${tdWho(cellTd(A && A.d), key, a, h)}${whoTopic(key) ? `<td class="mb-stat mb-mid mb-who"${whoAttr(key)} title="Click: the players on both teams behind this number">${label}</td>` : `<td class="mb-stat mb-mid">${label}</td>`}
      ${tdWho(cellTd(H && H.o), key, h, a)}${tdWho(cellTd(H && H.d), key, h, a)}<td class="mb-call">${callPill(H && H.call)}</td></tr>`;
  // the column heads sit right above the first rows, under the first group's name
  const heads = `<tr class="mb-heads"><th></th>${colHead(a, "Off")}${colHead(h, "Def")}<th></th>${colHead(h, "Off")}${colHead(a, "Def")}<th></th></tr>`;
  const note = (label, P, off, de) => {
    if (P && P.call && P.call.kind === "edge") edges.push({ team: P.call.team, side: P.call.team === off ? "off" : "def", size: P.call.size, label, o: P.o, d: P.d });
  };
  const grp = (t) => `<tr class="mb-group"><td colspan="${COLS}">${t}</td></tr>`;
  let body = "";
  for (const name of M_GROUPS) {
    body += grp(name) + (name === M_GROUPS[0] ? heads : "");
    for (const r of M_ROWS.filter((x) => x[4] === name)) {
      const pair = (off, de) => {
        const o = sideCell(off, "off", r);
        const d = sideCell(de, "def", r);
        return o || d ? { o, d, call: rowCall(off, de, r) } : null;
      };
      const A = pair(a, h);
      const H = pair(h, a);
      note(r[1], A, a, h);
      note(r[1], H, h, a);
      body += rowHtml(r[1], A, H, r[0]);
    }
  }
  const ex = (block() || {}).extremes;
  if (ex) {
    const rows = ex.types.map((t) => [t, typePair(ex, t, a, h), typePair(ex, t, h, a)]).filter(([, A, H]) => A || H);
    if (rows.length) {
      body += grp("Vs Tonight's Types");
      for (const [t, A, H] of rows) {
        note(`Vs ${t.label}`, A, a, h);
        note(`Vs ${t.label}`, H, h, a);
        body += rowHtml(t.label, A, H);
      }
    }
  }
  return { html: `<div class="mb-scroll"><table class="mb-table mb-matchup"><tbody>${body}</tbody></table></div>`, edges };
}

// The Matchup's two halves shaded by the team that has the ball (left = the road
// team's offense, right = the home team's), the label column in the middle left
// plain. Measured after it's drawn, since the columns size to their contents.
let shadedGame = null;
function shadeMatchup(g) {
  shadedGame = g;
  const t = document.querySelector(".mb-matchup");
  const mid = t && t.querySelector("td.mb-mid");
  if (!t || !mid) return;
  const box = t.getBoundingClientRect();
  const m = mid.getBoundingClientRect();
  const l = Math.round(m.left - box.left - 1);
  const r = Math.round(m.right - box.left + 1);
  t.style.background = `linear-gradient(90deg, rgba(${teamRgb(g.away)},0.1) 0 ${l}px, transparent ${l}px ${r}px, rgba(${teamRgb(g.home)},0.1) ${r}px 100%)`;
}
window.addEventListener("resize", () => shadedGame && shadeMatchup(shadedGame));
document.fonts?.ready.then(() => shadedGame && shadeMatchup(shadedGame));
