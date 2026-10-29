// ---- GMG NBA Suite: Matchup Breakdown ----
// Game Previews and Team Identity in one page (the owner, 2026-10-28: "after 3
// minutes on this page i understand how these teams win, why they lose, and
// what the matchup may have in store for tonight"). Stands on its own (no
// common.js) but uses the site's stylesheet. Data: nba/data.json (build_nba.py;
// the matchup numbers are identity.py's).
//
// One language everywhere (the owner: "Rank first then number ... so the user
// can always look for the same thing"): every cell is a rank of 30 in big type,
// its number small, shaded red to green by the rank. Green = good for that team;
// on how-often rows (pace, shot shares) green offense = does it a lot, green
// defense = takes it away, so green against red still reads "the offense gets
// its way". Every matchup row reads both sides (the offense's number across
// from the other defense's allowed number) and is called with the site's
// two-sided rule (common.js matchupCall).

let DATA = null;
let dayIndex = 0;
let gameId = null;
const NBA_GAME_KEY = "nba-tool.game.v1";

const el = (id) => document.getElementById(id);
const fmt = (n, digits = 1) => (n === null || n === undefined ? "--" : Number(n).toFixed(digits));
const signed = (n, digits = 1) => (n === null || n === undefined ? "--" : n === 0 ? "PK" : `${n > 0 ? "+" : ""}${String(Number(n.toFixed(digits))).replace(/\.0$/, "")}`);
const odds = (n) => (n === null || n === undefined ? "" : showOdds(n)); // the member's odds format (sync.js)
const team = (abbr) => DATA.teams[abbr] || { name: abbr, short: abbr, color: "555555", logo: "" };
const logo = (abbr, size = 18) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr, text, right = "") {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${text || team(abbr).name}</span>${right ? `<span class="nba-banner-right">${right}</span>` : ""}</div>`;
}
// A game's start in the member's time zone ("7:00 PM CT"; abbr = false: "7:00 PM"). sync.js gmgGameTime.
function fmtTime(g, abbr = true) {
  return gmgGameTime(g, abbr);
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

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

// ---- The Matchup: every row, both directions side by side ----
// [call][away off][home def] [label] [home off][away def][call]: the label in the
// middle, the calls on the far outside (the owner, 2026-10-28).
// Returns {html, edges: [{team, side, size, label, o, d}]}.
function matchup(g) {
  const a = g.away;
  const h = g.home;
  const edges = [];
  const COLS = 7;
  const rowHtml = (label, A, H) => `<tr${(A && A.call) || (H && H.call) ? ' class="mb-called"' : ""}>
      <td class="mb-call">${callPill(A && A.call)}</td>${cellTd(A && A.o)}${cellTd(A && A.d)}<td class="mb-stat mb-mid">${label}</td>
      ${cellTd(H && H.o)}${cellTd(H && H.d)}<td class="mb-call">${callPill(H && H.call)}</td></tr>`;
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
      body += rowHtml(r[1], A, H);
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

// ---- Biggest Edges: each team's biggest, as a chart (the owner: a count of 8 vs 1 hid sizes) ----
// Split into the team's Offense and its Defense, its own cell first (the owner:
// one list mixing both was confusing).
const EDGES_SHOWN = 3;
function edgesBox(g, edges) {
  const box = (t) => {
    const opp = t === g.away ? g.home : g.away;
    const part = (side) => {
      const mine = edges.filter((e) => e.team === t && e.side === side).sort((x, y) => y.size - x.size).slice(0, EDGES_SHOWN);
      if (!mine.length) return "";
      const head = side === "off" ? colHead(t, "Off") + colHead(opp, "Def") : colHead(t, "Def") + colHead(opp, "Off");
      const rows = mine.map((e) => {
        const [own, other] = side === "off" ? [e.o, e.d] : [e.d, e.o];
        return `<tr>${labelTd(e.label)}${cellTd(own)}${cellTd(other)}<td class="mb-call">${callPill({ kind: "edge", team: t, size: e.size })}</td></tr>`;
      }).join("");
      return `<tr class="mb-group"><td colspan="4">${t} ${side === "off" ? "Offense" : "Defense"}</td></tr><tr class="mb-heads"><th></th>${head}<th></th></tr>${rows}`;
    };
    const body = part("off") + part("def");
    return `<div class="nba-box mb-fitbox">${banner(t, `${team(t).name} Edges`)}
      ${body ? `<table class="mb-table mb-edges"><tbody>${body}</tbody></table>` : '<p class="mb-none">No Clear Edges</p>'}</div>`;
  };
  return box(g.away) + box(g.home);
}

// ---- How They Win / How They Lose (reworked 2026-10-28, the owner: the Off / Def
// pills and a different 3 rows per team were hard to decode) ----
// The same rows for every team in plain words, its wins beside its losses; each
// cell ranked where it would sit among the 30 teams' season numbers. The 3 rows
// that swing most between wins and losses are marked.
const WL_ROWS = [
  ["Points Scored / Poss", "off", "ppp"],
  ["Points Allowed / Poss", "def", "ppp"],
  ["Pace", "off", "pace"],
  ["3-Point Share", "off", "three_rate"],
  ["3-Point Share Allowed", "def", "three_rate"],
  ["Turnovers Committed", "off", "tov_rate"],
  ["Turnovers Forced", "def", "tov_rate"],
  ["Off Rebound %", "off", "oreb_rate"],
  ["Def Rebound %", "def", "oreb_rate"],
  ["Free Throws / Shot", "off", "fta_rate"],
  ["Paint FG%", "off", "paint_pct"],
  ["Paint FG% Allowed", "def", "paint_pct"],
];
const WL_SWINGS = 3;
function winLossBox(abbr) {
  const wl = ((block() || {}).wl || {})[abbr];
  if (!wl) return `<div class="nba-box mb-fitbox">${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
  const lg = (block() || {}).league || {};
  const has = (v) => v !== null && v !== undefined;
  const rows = WL_ROWS.map(([label, side, key]) => {
    const r = M_ROWS.find((x) => x[0] === key);
    const k = `${side}_${key}`;
    const w = (wl.w || {})[k];
    const l = (wl.l || {})[k];
    const gap = has(w) && has(l) && lg[k] ? Math.abs(w - l) / (lg[k].sd || 1) : -1;
    return { label, gap, w: has(w) ? sideCell(abbr, side, r, { value: w, when: "in wins" }) : null, l: has(l) ? sideCell(abbr, side, r, { value: l, when: "in losses" }) : null };
  });
  const swings = new Set(rows.filter((x) => x.gap >= 0).sort((x, y) => y.gap - x.gap).slice(0, WL_SWINGS).map((x) => x.label));
  const body = rows.map((x) => `<tr${swings.has(x.label) ? ' class="mb-swing"' : ""}>${labelTd(x.label)}${cellTd(x.w)}${cellTd(x.l)}</tr>`).join("");
  const wHead = wl.nw ? `In Wins (${wl.nw})` : "No Wins Yet";
  const lHead = wl.nl ? `In Losses (${wl.nl})` : "No Losses Yet";
  return `<div class="nba-box mb-fitbox mb-wlbox">${banner(abbr, team(abbr).name, `${wl.nw}-${wl.nl}`)}
    <table class="mb-table mb-wl"><thead><tr><th></th><th>${wHead}</th><th>${lHead}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---- Head To Head: three tables side by side (Season, Points Per Quarter, Blowout Data) ----
function headToHead(g) {
  const a = g.away;
  const h = g.home;
  const ts = DATA.team_stats || {};
  const n = teamsOf(ts);
  const sa = ts[a];
  const sh = ts[h];
  const rec = (s) => {
    if (!s) return '<td class="mb-v mb-empty"></td>';
    const [w, l] = String(s).split("-").map(Number);
    const share = w + l ? w / (w + l) : 0.5;
    return `<td class="mb-v mb-rec" style="background:${scaleHsla(Math.round(share * 120), 70, 45, 0.32)}"><b>${s}</b></td>`;
  };
  const tsCell = (abbr, key, hi, show) => {
    const s = ts[abbr];
    if (!s || s[key] === null || s[key] === undefined) return null;
    const r = rankIn(ts, key, s[key], hi);
    return { r, n, num: show(s[key]), title: `${abbr}: ${show(s[key])} (${ordinal(r)} of ${n})` };
  };
  const idCell = (abbr, key, hi, show, lead) => {
    const s = idStats(abbr);
    if (!s || s[key] === null || s[key] === undefined) return null;
    const r = rankIn(idTeams(), key, s[key], hi);
    const nn = teamsOf(idTeams());
    const c = { r, n: nn, num: show(s[key]), title: `${abbr}: ${show(s[key])} (${ordinal(r)} of ${nn})` };
    return lead ? { ...c, big: show(s[key]) } : c;
  };
  const raw = (A, H, label) => `<tr>${labelTd(label)}${A}${H}</tr>`;
  const both = (label, f) => `<tr>${labelTd(label)}${cellTd(f(a))}${cellTd(f(h))}</tr>`;
  const pts = (v) => `${v.toFixed(1)}`;
  const pctS = (v) => `${Math.round(v * 100)}%`;
  const of5 = (v) => `${v.toFixed(1)} Of 5`;
  let season = "";
  let quarters = "";
  let blowouts = "";
  if (sa || sh) {
    season += raw(rec(sa && `${sa.wins}-${sa.losses}`), rec(sh && `${sh.wins}-${sh.losses}`), "Record");
    season += both("Net Rating", (t) => tsCell(t, "net_rating", true, (v) => signed(v)));
    season += both("Offense", (t) => tsCell(t, "off_rating", true, pts));
    season += both("Defense", (t) => tsCell(t, "def_rating", false, pts));
    season += both("Pace", (t) => tsCell(t, "pace", true, pts));
    season += raw(rec(sa && sa.home_record), rec(sh && sh.home_record), "Home");
    season += raw(rec(sa && sa.away_record), rec(sh && sh.away_record), "Away");
    season += raw(rec(sa && sa.last10), rec(sh && sh.last10), "Last 10");
  }
  if (idStats(a) || idStats(h)) {
    // the margin itself big, its rank small (the owner, 2026-10-28)
    for (const q of [1, 2, 3, 4]) quarters += both(`Q${q}`, (t) => idCell(t, `q${q}_ppq`, true, (v) => signed(v), true));
    blowouts += both("Games Up 15+", (t) => idCell(t, "blowout_up_share", true, pctS));
    blowouts += both("Games Down 15+", (t) => idCell(t, "blowout_down_share", false, pctS));
    // starters still on the floor in the 4th: more = 1st (green), the how-often rule
    blowouts += both("Starters In: Up 15+", (t) => idCell(t, "blowout_up_starters", true, of5));
    blowouts += both("Starters In: Down 15+", (t) => idCell(t, "blowout_down_starters", true, of5));
    blowouts += both("Starters In: Within 5", (t) => idCell(t, "close_starters", true, of5));
  }
  blowouts += spotRows(g);
  // each part its own shaded panel, its name on top (so the label column is only as wide as its labels)
  const table = (title, rows, kind) => (rows ? `<div class="mb-partbox mb-part-${kind}"><div class="mb-part">${title}</div><table class="mb-table mb-mirror"><thead><tr><th></th>${colHead(a, "")}${colHead(h, "")}</tr></thead><tbody>${rows}</tbody></table></div>` : "");
  return `<div class="nba-box mb-fitbox mb-h2h"><div class="mb-parts">${table("Season", season, "season")}${table("Points Per Quarter", quarters, "ppq")}${table("Blowout Data", blowouts, "blow")}</div></div>`;
}
// Tonight's Schedule Spots (back-to-back, long road trip...): the team's net points
// a game vs its normal in that spot, minus the league's, ranked among every team
// that has been in it; shown once the team has EX_MIN_GP+ games in it.
function spotRows(g) {
  const spots = (block() || {}).spots;
  if (!spots) return "";
  const now = (spots.tonight || {})[g.game_id] || {};
  const keys = [...new Set([...(now[g.away] || []), ...(now[g.home] || [])])];
  const net = (abbr, t) => {
    const p = exCell(spots, abbr, t, SPOT_OUTCOMES[0]);
    const o = exCell(spots, abbr, t, SPOT_OUTCOMES[1]);
    return p && o ? { v: p.gap - o.gap, title: `${p.title} ${o.title}` } : null;
  };
  const cell = (abbr, t) => {
    if (!(now[abbr] || []).includes(t.key)) return null;
    const n = ((spots.teams[abbr] || {})[t.key] || {}).n || 0;
    const mine = net(abbr, t);
    if (!mine || n < EX_MIN_GP) return null; // a thin spot is one odd night
    const all = Object.keys(spots.teams).map((x) => net(x, t)).filter(Boolean).map((x) => x.v);
    return { r: 1 + all.filter((v) => v > mine.v).length, n: all.length, num: `${signed(mine.v)} Net`, title: mine.title };
  };
  const rows = spots.types.filter((t) => keys.includes(t.key)).map((t) => [t, cell(g.away, t), cell(g.home, t)]).filter(([, A, H]) => A || H)
    .map(([t, A, H]) => `<tr>${labelTd(t.label)}${cellTd(A)}${cellTd(H)}</tr>`).join("");
  return rows ? `<tr class="mb-group"><td colspan="3">Tonight's Spots</td></tr>${rows}` : "";
}

// ---- The Line and Injuries (top) ----
function lineBox(g) {
  const hs = g.home_team_spread;
  const total = g.total_line;
  const has = hs !== null && hs !== undefined;
  const fav = has ? (hs <= 0 ? g.home : g.away) : null;
  const tile = (label, body) => `<div class="mb-tile"><span class="gs-tile-label">${label}</span><b>${body}</b></div>`;
  const side = (abbr, text, small) => `<span class="mb-pair">${logo(abbr, 22)}${text}${small ? `<small>${small}</small>` : ""}</span>`;
  const ml = (abbr, price, prob) => side(abbr, odds(price) || "--", prob ? `${Math.round(prob * 100)}%` : "");
  const body = has || total
    ? `<div class="mb-line">
        ${tile("Spread", fav ? side(fav, signed(fav === g.home ? hs : g.away_team_spread)) : "--")}
        ${tile("Total", total ? fmt(total).replace(/\.0$/, "") : "--")}
        ${tile("Market Score", has && total ? side(g.away, fmt((total + hs) / 2)) + side(g.home, fmt((total - hs) / 2)) : "--")}
        ${tile("Win Chance", ml(g.away, g.away_moneyline, g.away_ml_implied_prob) + ml(g.home, g.home_moneyline, g.home_ml_implied_prob))}
      </div>${g.lines_locked ? `<p class="section-note">Locked at tip-off.</p>` : ""}`
    : `<p class="no-data-note">No line posted yet.</p>`;
  return `<div class="nba-box mb-fitbox mb-linebox"><div class="nba-box-title">The Line</div>${body}</div>`;
}
function injuriesBox(g) {
  const list = (abbr) => {
    const rows = (DATA.injuries[abbr] || [])
      .map((p) => `<div class="mb-inj" title="${esc([p.injury, p.note].filter(Boolean).join(": "))}"><span class="gs-inj-status ${p.status === "Out" ? "tier-bad" : "tier-mid"}">${p.status === "Out" ? "Out" : "DTD"}</span><b>${playerClick(p.id, p.name)}</b><small>${p.position || ""}</small></div>`)
      .join("");
    // each team its own tinted box under its banner; a long list folds into two columns
    const n = (DATA.injuries[abbr] || []).length;
    return `<div class="mb-inj-col" style="background:rgba(${teamRgb(abbr)},0.07);border-color:rgba(${teamRgb(abbr)},0.35)">${banner(abbr, team(abbr).name)}<div class="mb-inj-list${n > 4 ? " mb-inj-2col" : ""}">${rows || '<span class="mb-inj-none">Nobody Listed</span>'}</div></div>`;
  };
  return `<div class="nba-box mb-fitbox mb-injbox"><div class="nba-box-title">Injuries</div><div class="mb-injs">${list(g.away)}${list(g.home)}</div></div>`;
}

// ---- Rotations and Recent Games ----
// Each stat cell shaded by its rank on his own team (the owner: "Color code the
// cells though by team rank and make each sortable"); a column head sorts that
// team's table, biggest first (again = the other way).
const ROT_COLS = [["games", "GP", 0], ["min", "Min", 1], ["pts", "Pts", 1], ["reb", "Reb", 1], ["ast", "Ast", 1], ["threes", "3PM", 1], ["l5_pts", "L5 Pts", 1]];
const rotSort = {}; // team -> [key, -1 biggest first / 1 smallest first]
function renderPlayers(g) {
  const out = (abbr) => new Set((DATA.injuries[abbr] || []).filter((p) => p.status === "Out").map((p) => p.id));
  const table = (abbr) => {
    const injured = out(abbr);
    const players = ((DATA.players || {})[abbr] || []).slice();
    const [sk, dir] = rotSort[abbr] || [null, -1];
    if (sk) players.sort((x, y) => -dir * ((y[sk] ?? -1) - (x[sk] ?? -1)));
    const shade = (p, key) => {
      const vals = players.map((x) => x[key]).filter((v) => v !== null && v !== undefined);
      const v = p[key];
      if (v === null || v === undefined || vals.length < 2) return "";
      const r = 1 + vals.filter((x) => x > v).length;
      return ` style="background:${scaleHsla(Math.round((120 * (vals.length - r)) / (vals.length - 1)), 70, 45, 0.28)}"`;
    };
    const rows = players
      .map((p) => `<tr${injured.has(p.id) ? ' class="nba-out-row"' : ""}>
          <td class="nba-player">${p.headshot ? `<img src="${p.headshot}" alt="" class="nba-headshot" loading="lazy">` : `<span class="nba-headshot"></span>`}<span>${playerClick(p.id, p.name)}</span><span class="muted-label">${p.position || ""}</span>${injured.has(p.id) ? `<span class="gs-inj-status tier-bad">Out</span>` : ""}</td>
          ${ROT_COLS.map(([key, , digits]) => `<td class="num mb-rot"${shade(p, key)}>${digits ? fmt(p[key]) : p[key] ?? ""}</td>`).join("")}
        </tr>`)
      .join("");
    const th = ROT_COLS.map(([key, label]) => `<th class="mb-sort${sk === key ? " mb-sorted" : ""}" data-team="${abbr}" data-sort="${key}"${key === "l5_pts" ? ' title="Points per game, last five games"' : ""}>${label}${sk === key ? (dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("");
    return `<div class="nba-box mb-fitbox">${banner(abbr, `${team(abbr).name} Rotation`)}
      <table class="data-table nba-player-table mb-fit"><thead><tr><th>Player</th>${th}</tr></thead><tbody>${rows || `<tr><td colspan="8" class="no-data-note">No players on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("players-content").innerHTML = table(g.away) + table(g.home);
}
// Each game's line at tip: the spread green when the team covered, red when it
// didn't; the total green over, red under (gray on a push).
function renderRecent(g) {
  const table = (abbr) => {
    const rows = ((DATA.recent_games || {})[abbr] || [])
      .slice()
      .reverse()
      .map((r) => {
        const margin = r.pf - r.pa;
        const cover = r.spread === null || r.spread === undefined ? null : Math.sign(margin + r.spread);
        const ou = r.total === null || r.total === undefined ? null : Math.sign(r.pf + r.pa - r.total);
        const shade = (s) => (s === null ? "" : ` style="background:${s === 0 ? "var(--panel-2)" : scaleHsla(s > 0 ? 120 : 0, 70, 45, 0.32)}"`);
        const ats = cover === null ? "<td></td>" : `<td class="num mb-res"${shade(cover)} title="${cover > 0 ? "Covered" : cover < 0 ? "Didn't cover" : "Push"}">${signed(r.spread)}</td>`;
        const tot = ou === null ? "<td></td>" : `<td class="num mb-res"${shade(ou)} title="${ou > 0 ? "Over" : ou < 0 ? "Under" : "Push"}">${ou > 0 ? "O" : ou < 0 ? "U" : "P"} ${fmt(r.total).replace(/\.0$/, "")}</td>`;
        return `<tr><td>${new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td><td>${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}</td><td><span class="pick-result pick-result-${r.win ? "win" : "loss"}">${r.win ? "W" : "L"}</span></td><td class="num">${r.pf}-${r.pa}</td>${ats}${tot}<td class="num">${fmt(r.pace, 0)}</td></tr>`;
      })
      .join("");
    return `<div class="nba-box mb-fitbox">${banner(abbr, `${team(abbr).name} Recent`)}
      <table class="data-table mb-fit mb-recent"><thead><tr><th>Date</th><th>Opp</th><th></th><th>Score</th><th title="The line at tip: green = covered">Spread</th><th title="The total at tip: green = over">Total</th><th title="Possessions in the game">Pace</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="no-data-note">No games on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("recent-content").innerHTML = table(g.away) + table(g.home);
}

// ---- schedule ----
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
const currentGame = () => DATA.schedule.find((g) => g.game_id === gameId) || null;
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const side = (abbr, pts, opp) =>
        final
          ? `<span class="matchup-team-col">${logo(abbr, 28)}<span class="matchup-score${pts > opp ? " matchup-score-win" : " matchup-score-loss"}">${pts}</span></span>`
          : logo(abbr, 28);
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${side(g.away, g.away_score, g.home_score)}<span class="at">@</span>${side(g.home, g.home_score, g.away_score)}</span>
        ${final ? "" : `<span class="matchup-date">${fmtTime(g, false)}</span>`}
      </button>`;
    })
    .join("");
}
function renderHeader(g) {
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const games = (block() || {}).team_games;
  el("game-header").hidden = false;
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${team(g.away).logo}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${team(g.home).logo}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g)}${g.tv ? ` &middot; ${g.tv}` : ""}${games ? ` &middot; ${DATA.season_label}: ${games} game${games === 1 ? "" : "s"} a team so far` : ""}</div>`;
}

const SECTIONS = ["top", "edges", "story", "h2h", "matchup", "players", "recent"];
function render() {
  renderSchedule();
  const g = currentGame();
  el("empty-state").hidden = !!g;
  SECTIONS.forEach((s) => (el(`section-${s}`).hidden = !g));
  if (!g) {
    el("game-header").hidden = true;
    el("empty-state").innerHTML = "<p>No games in the next two weeks.</p>";
    return;
  }
  renderHeader(g);
  el("top-content").innerHTML = lineBox(g) + injuriesBox(g);
  const m = block() ? matchup(g) : null;
  el("edges-content").innerHTML = m ? edgesBox(g, m.edges) : `<p class="no-data-note">The matchup numbers aren't available right now.</p>`;
  el("h2h-content").innerHTML = headToHead(g);
  el("wl-content").innerHTML = block() ? winLossBox(g.away) + winLossBox(g.home) : "";
  el("matchup-content").innerHTML = m ? m.html : "";
  renderPlayers(g);
  renderRecent(g);
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(NBA_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  const first = gamesOn(all[dayIndex])[0];
  selectGame(first ? first.game_id : null);
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) return selectGame(card.dataset.game);
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const sort = e.target.closest("th.mb-sort");
  if (sort) {
    const [key, dir] = rotSort[sort.dataset.team] || [];
    rotSort[sort.dataset.team] = [sort.dataset.sort, key === sort.dataset.sort ? -dir : -1];
    const g = currentGame();
    if (g) renderPlayers(g);
    return;
  }
  const theme = e.target.closest("#theme-toggle");
  if (theme) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
  }
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const all = days();
    let saved = null;
    try {
      saved = localStorage.getItem(NBA_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    const savedGame = DATA.schedule.find((g) => g.game_id === saved);
    // Open on the saved game if it's still in the window, else today's
    // (or the next day's) first game.
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
