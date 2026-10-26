// GMG NBA Suite: Team Identity. How each team plays, from the engine
// (nfl_tool/nba/identity.py): pace, transition, shot diet, shot creation,
// turnovers, glass, the line, 4th-quarter blowouts and quarters. Every matchup
// row reads both sides (the offense's number next to what the other defense
// allows), like Game Previews. The page does no math beyond coloring.
// The owner, 2026-10-20: its own tab for now; it may merge with Game
// Previews later.

let DATA = null;
let ID = null;
let season = null;
let dayIndex = 0;
let gameId = null;
const ID_GAME_KEY = "nba-tool.id-game.v1";
const ID_SEASON_KEY = "nba-tool.id-season.v1";

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr) {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span></div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

const block = () => ID.seasons[season];
const stats = (abbr) => block().teams[abbr] || null;

// ---- league comparison ----
// How far a team's number sits from the league average, in league spreads.
function z(abbr, key) {
  const s = stats(abbr);
  const lg = block().league[key];
  if (!s || !lg || s[key] === null || s[key] === undefined) return null;
  return (s[key] - lg.avg) / (lg.sd || 1);
}
function rank(abbr, key, highFirst) {
  const rows = Object.entries(block().teams).filter(([, s]) => s[key] !== null && s[key] !== undefined);
  rows.sort((a, b) => (highFirst ? b[1][key] - a[1][key] : a[1][key] - b[1][key]));
  const i = rows.findIndex(([t]) => t === abbr);
  return i === -1 ? null : i + 1;
}
const tierClass = (zv) => (zv === null ? "" : zv >= 0.5 ? "tier-good" : zv <= -0.5 ? "tier-bad" : "tier-mid");
function fmt(v, kind) {
  if (v === null || v === undefined) return "--";
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "secs") return `${v.toFixed(1)}s`;
  if (kind === "ppp") return v.toFixed(2);
  return v.toFixed(1);
}

// ---- The page (rebuilt 2026-10-26; the owner: "still so much to read and sort
// through. like 6 different sections. no consistency. too wordy. Imagine you
// are a bettor who has 5 minutes"). Every table reads the same way, like First
// Basket's matchup: road team left, the stat and its call in the middle, home
// team right. The Verdict on top gathers every call.
//
// An EDGE favors one team and always reads both sides: the offense's number and
// the other defense's allowed number, called with the site's matchup rule (one
// side EDGE_Z league spreads toward a team, the other not EDGE_CONTRA the other
// way, like common.js matchupCall); or tonight's opponent is a type this team
// plays far from normal against (Matchup Extremes' colored points cell,
// EX_MIN_GP+ games); or a schedule spot the team is in tonight, the same way.
// How OFTEN a team does something (pace, shot mix) is never good or bad: Fits /
// Takes Away say what to expect more or less of, never who wins.
const FREQ_GAP = 0.7;
const EDGE_Z = 0.6;
const EDGE_CONTRA = 0.3;
const EDGE_BIG = 1.0; // the two sides average a full league spread = Big Edge
const IV_VIEW_KEY = "nba-tool.id-view.v1";
let ivAll = false; // Every Stat (true) or Key Stats (false): a display pref per device

// key, label, how it prints, way (+1 the offense wants it high, -1 low, 0 = how
// often), group, then for good / bad rows the headlines [offense edge, defense
// edge] and for a zone's make rate the share it needs (the offense takes at
// least the league's usual share there); for how-often rows what to expect more
// or less of.
const M_ROWS = [
  ["ppp", "Pts / Possession", "ppp", 1, "Scoring", [(o) => `${o} Scores Efficiently`, (o, d) => `${d} Slows ${o} Down`]],
  ["half_ppp", "Half-Court Pts / Poss", "ppp", 1, "Scoring", [(o) => `${o} Scores In The Half Court`, (o, d) => `${d} Locks Up The Half Court`]],
  ["trans_ppp", "Transition Pts / Poss", "ppp", 1, "Scoring", [(o) => `${o} Scores In Transition`, (o, d) => `${d} Stops ${o}'s Transition`]],
  ["pace", "Pace (Poss / 48)", "num", 0, "Scoring", "Pace"],
  ["poss_secs", "Seconds / Possession", "secs", 0, "Scoring", null],
  ["trans_freq", "Transition Share", "pct", 0, "Scoring", "Transition"],
  ["tov_rate", "Turnover Rate", "pct", -1, "Ball Control", [(o) => `${o} Protects The Ball`, (o, d) => `${d} Forces ${o} Turnovers`]],
  ["steal_share", "TOs That Are Steals", "pct", -1, "Ball Control", [(o) => `${o} Avoids Steals`, (o, d) => `${d} Gets Steals`]],
  ["oreb_rate", "Offensive Rebound %", "pct", 1, "Ball Control", [(o) => `${o} Wins The Offensive Glass`, (o, d) => `${d} Owns The Defensive Glass`]],
  ["fta_rate", "Free Throws / Shot", "pct", 1, "Ball Control", [(o) => `${o} Gets To The Line`, (o, d) => `${d} Keeps ${o} Off The Line`]],
  ["three_rate", "3-Point Share", "pct", 0, "Shot Mix", "3s"],
  ["rim_share", "Rim Share", "pct", 0, "Shot Mix", "Rim Shots"],
  ["short_share", "Paint Share", "pct", 0, "Shot Mix", "Paint Shots"],
  ["mid_share", "Mid-Range Share", "pct", 0, "Shot Mix", "Mid-Range"],
  ["corner3_share", "Corner 3 Share", "pct", 0, "Shot Mix", "Corner 3s"],
  ["above3_share", "Above-Break 3 Share", "pct", 0, "Shot Mix", "Above-Break 3s"],
  ["self_made", "Pull-Up / Step-Back", "pct", 0, "Shot Mix", "Pull-Ups"],
  ["catch", "Catch-And-Shoot", "pct", 0, "Shot Mix", "Catch-And-Shoot"],
  ["assisted", "Makes Assisted", "pct", 0, "Shot Mix", "Ball Movement"],
  ["rim_pct", "FG% At The Rim", "pct", 1, "Shooting", [(o) => `${o} Finishes At The Rim`, (o, d) => `${d} Protects The Rim`], "rim_share"],
  ["short_pct", "FG% In The Paint", "pct", 1, "Shooting", [(o) => `${o} Scores In The Paint`, (o, d) => `${d} Defends The Paint`], "short_share"],
  ["mid_pct", "Mid-Range FG%", "pct", 1, "Shooting", [(o) => `${o} Hits Mid-Range Shots`, (o, d) => `${d} Defends The Mid-Range`], "mid_share"],
  ["corner3_pct", "Corner 3 FG%", "pct", 1, "Shooting", [(o) => `${o} Hits Corner 3s`, (o, d) => `${d} Defends Corner 3s`], "corner3_share"],
  ["above3_pct", "Above-Break 3 FG%", "pct", 1, "Shooting", [(o) => `${o} Hits Above-Break 3s`, (o, d) => `${d} Defends Above-Break 3s`], "above3_share"],
];
const M_GROUPS = ["Scoring", "Ball Control", "Shot Mix", "Shooting"];
const M_ALWAYS = ["ppp", "pace"]; // shown in Key Stats even with no call

// The call on one row with `off` on offense: null, or {kind: edge / fits /
// takes, team, size, text}. `called` carries this direction's earlier edges.
function rowCall(off, de, r, called) {
  const [key, , , way, , words, shareKey] = r;
  const oz = z(off, `off_${key}`);
  const dz = z(de, `def_${key}`);
  if (oz === null || dz === null) return null;
  if (way === 0) {
    if (!words || oz < FREQ_GAP) return null;
    if (dz >= FREQ_GAP) return { kind: "fits", size: oz + dz, text: key === "pace" ? "Fast Pace" : `More ${off} ${words}` };
    if (dz <= -FREQ_GAP) return { kind: "takes", size: oz - dz, text: key === "pace" ? `${de} Slows The Pace` : `Fewer ${off} ${words}` };
    return null;
  }
  if (shareKey && (z(off, `off_${shareKey}`) ?? -1) < 0) return null; // a zone it rarely shoots from
  const a = oz * way; // + = good for the offense
  const b = dz * way; // + = this defense allows a lot (good for the offense)
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const dir = hi >= EDGE_Z && lo > -EDGE_CONTRA ? 1 : lo <= -EDGE_Z && hi < EDGE_CONTRA ? -1 : 0;
  if (!dir) return null;
  if (key === "half_ppp" && called.ppp === dir) return null; // half-court is most of all scoring
  if (key === "trans_ppp" && dir === 1 && (z(off, "off_trans_freq") ?? -1) < 0) return null; // only helps a team that runs
  called[key] = dir;
  return { kind: "edge", team: dir > 0 ? off : de, size: Math.abs(a + b) / 2, text: dir > 0 ? words[0](off, de) : words[1](off, de) };
}

const pill = (c) => !c ? "" : c.kind === "edge"
  ? `<span class="iv-edge${c.size >= EDGE_BIG ? " iv-big" : ""}">${logo(c.team, 14)}${c.size >= EDGE_BIG ? "Big Edge" : "Edge"}</span>`
  : `<span class="gs-tag ${c.kind === "fits" ? "gs-tag-strong" : "gs-tag-weak"}">${c.kind === "fits" ? "Fits" : "Takes Away"}</span>`;
// One value cell: the number, a small rank (1 = best; how-often rows: 1 = most) and its hover.
function valCell(abbr, key, kind, cls, bestHigh, what) {
  const v = (stats(abbr) || {})[key];
  const r = rank(abbr, key, bestHigh);
  const words = what === "often" ? rankWords(abbr, key, bestHigh, ["Most", "Fewest"]) : rankWords(abbr, key, bestHigh);
  return `<td class="iv-v ${cls}" title="${words} of the 30">${fmt(v, kind)}${r ? `<small>${ordinal(r)}</small>` : ""}</td>`;
}
// "3rd Best" / "2nd Worst" among the teams with the number.
function rankWords(abbr, key, bestHigh, words = ["Best", "Worst"]) {
  const n = rank(abbr, key, bestHigh);
  const of = Object.values(block().teams).filter((s) => s[key] !== null && s[key] !== undefined).length;
  if (!n) return "";
  if (n === 1) return words[0];
  if (n === of) return words[1];
  return n <= of / 2 ? `${ordinal(n)} ${words[0]}` : `${ordinal(of + 1 - n)} ${words[1]}`;
}

// Every row of one direction ({group, html, call, key}) with `off` on offense.
function directionRows(g, off, de) {
  const called = {};
  const rows = [];
  if (!stats(off) || !stats(de)) return rows;
  for (const r of M_ROWS) {
    const [key, label, kind, way, group] = r;
    const call = rowCall(off, de, r, called);
    const oz = z(off, `off_${key}`);
    const dz = z(de, `def_${key}`);
    const oCls = way === 0 || oz === null ? "id-plain" : tierClass(oz * way);
    const dCls = way === 0 || dz === null ? "id-plain" : tierClass(-dz * way);
    const oCell = valCell(off, `off_${key}`, kind, oCls, way === 0 ? true : way > 0, way === 0 ? "often" : "");
    const dCell = valCell(de, `def_${key}`, kind, dCls, way === 0 ? true : way < 0, way === 0 ? "often" : "");
    const [left, right] = off === g.away ? [oCell, dCell] : [dCell, oCell];
    rows.push({ key, group, call, html: `<tr${call ? ' class="iv-called"' : ""}>${left}<td class="iv-stat">${label}${pill(call)}</td>${right}</tr>` });
  }
  return rows;
}
function directionBox(g, off, de, rows) {
  const head = (t) => (t === off ? `${t} Offense` : `${t} Defense Allows`);
  const body = M_GROUPS.map((grp) => {
    const shown = rows.filter((r) => r.group === grp && (ivAll || r.call || M_ALWAYS.includes(r.key)));
    return shown.length ? `<tr class="iv-group"><td colspan="3">${grp}</td></tr>${shown.map((r) => r.html).join("")}` : "";
  }).join("");
  return `<div class="nba-box iv-box"><div class="team-banner" style="background:rgba(${teamRgb(off)},0.22);border-left:4px solid rgb(${teamRgb(off)})">${logo(off, 22)}<span class="team-banner-name">${off} Has The Ball</span></div>
    <table class="iv-table"><thead><tr><th>${head(g.away)}</th><th></th><th>${head(g.home)}</th></tr></thead><tbody>${body || '<tr><td colspan="3" class="no-data-note">No games on file.</td></tr>'}</tbody></table></div>`;
}

// Tonight's types and spots: each row is one team's own split (the other
// column stays empty); the call goes to whoever it favors.
function typeRows(g) {
  const rows = [];
  const ex = block().extremes;
  const spots = block().spots;
  const cell = (c, n) => (c ? `<td class="iv-v ${c.cls}" title="${c.title}">${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}<small>${n} GP</small></td>` : `<td class="iv-v"></td>`);
  for (const [t, opp] of [[g.away, g.home], [g.home, g.away]]) {
    const add = (c, n, label, head) => {
      const call = c && c.far ? { kind: "edge", team: c.good > 0 ? t : opp, size: Math.abs(c.gap) / 6, text: head } : null;
      const mine = cell(c, n);
      const [left, right] = t === g.away ? [mine, '<td class="iv-v"></td>'] : ['<td class="iv-v"></td>', mine];
      rows.push({ call, html: `<tr${call ? ' class="iv-called"' : ""}>${left}<td class="iv-stat">${label}${pill(call)}</td>${right}</tr>` });
    };
    if (ex && ex.teams[t]) {
      for (const type of ex.types.filter((x) => x.teams.includes(opp))) {
        const n = (ex.teams[t][type.key] || {}).n || 0;
        if (!n) continue;
        const c = exCell(ex, t, type, EX_OUTCOMES[0]);
        const d = type.side === "off";
        const good = c && c.good > 0;
        add(c, n, `${t} ${d ? "Pts Allowed" : "Pts Scored"} Vs ${type.label}`,
          d ? (good ? `${t} D Shuts Down ${type.label}` : `${t} D Leaks Vs ${type.label}`) : (good ? `${t} O Thrives Vs ${type.label}` : `${t} O Stalls Vs ${type.label}`));
      }
    }
    if (spots && spots.teams[t]) {
      const now = ((spots.tonight || {})[g.game_id] || {})[t] || [];
      for (const type of spots.types.filter((x) => now.includes(x.key))) {
        const n = (spots.teams[t][type.key] || {}).n || 0;
        if (!n) continue;
        for (const o of SPOT_OUTCOMES.slice(0, 2)) {
          const c = exCell(spots, t, type, o);
          const good = c && c.good > 0;
          const pts = o[0] === "pts";
          add(c, n, `${t} ${pts ? "Pts Scored" : "Pts Allowed"}: ${type.label}`,
            pts ? (good ? `${t} O Thrives: ${type.label}` : `${t} O Sags: ${type.label}`) : (good ? `${t} D Steps Up: ${type.label}` : `${t} D Sags: ${type.label}`));
        }
      }
    }
  }
  return rows;
}
function typesBox(g, rows) {
  const shown = rows.filter((r) => ivAll || r.call);
  const body = shown.map((r) => r.html).join("") || `<tr><td colspan="3" class="iv-none">${rows.length ? "Nothing Far From Normal Tonight" : "No Games Yet Vs Tonight's Types"}</td></tr>`;
  return `<div class="nba-box iv-box"><div class="nba-box-title">Tonight's Types &amp; Spots</div>
    <table class="iv-table"><thead><tr><th>${g.away}</th><th>Vs Normal, League-Adjusted, A 100 Poss</th><th>${g.home}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// Game script: each team's own numbers side by side (quarters colored vs the league).
function scriptBox(g) {
  const sa = stats(g.away);
  const sh = stats(g.home);
  if (!sa || !sh) return "";
  const pct = (v) => (v === null || v === undefined ? "" : `${Math.round(v * 100)}%`);
  const of5 = (v) => (v === null || v === undefined ? "" : `${v.toFixed(1)} Of 5`);
  const net = (v) => (v === null || v === undefined ? "" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
  const row = (label, f, key, colored) => `<tr><td class="iv-v ${colored ? tierClass(z(g.away, key)) : "id-plain"}">${f(sa[key])}</td><td class="iv-stat">${label}</td><td class="iv-v ${colored ? tierClass(z(g.home, key)) : "id-plain"}">${f(sh[key])}</td></tr>`;
  return `<div class="nba-box iv-box"><div class="nba-box-title">Game Script</div>
    <table class="iv-table"><thead><tr><th>${g.away}</th><th></th><th>${g.home}</th></tr></thead><tbody>
      <tr class="iv-group"><td colspan="3">Net Pts / 100 By Quarter</td></tr>
      ${[1, 2, 3, 4].map((q) => row(`Q${q}`, net, `q${q}_net`, true)).join("")}
      <tr class="iv-group"><td colspan="3">4th Quarter</td></tr>
      ${row("Games Up 15+", pct, "blowout_up_share")}${row("Games Down 15+", pct, "blowout_down_share")}
      ${row("Starters On Floor: Up 15+", of5, "blowout_up_starters")}${row("Starters On Floor: Down 15+", of5, "blowout_down_starters")}${row("Starters On Floor: Within 5", of5, "close_starters")}
    </tbody></table></div>`;
}

// Identity tags: [key, way, tag when far above the league, tag when far below].
// way -1 = the key is good when low, so "above" means far better.
const CHIPS = [
  ["off_pace", 1, "Fast Pace", "Slow Pace"], ["off_three_rate", 1, "3-Point Heavy", "Few 3s"],
  ["off_rim_share", 1, "Attacks The Rim", "Avoids The Rim"], ["off_mid_share", 1, "Mid-Range Team", null],
  ["off_self_made", 1, "Off The Dribble", null], ["off_assisted", 1, "Ball Movement", "Low Assist Rate"],
  ["off_trans_freq", 1, "Runs In Transition", "Walks It Up"], ["off_tov_rate", -1, "Protects The Ball", "Turnover Prone"],
  ["off_oreb_rate", 1, "Crashes The Glass", "Gets Back, No Crash"], ["off_fta_rate", 1, "Lives At The Line", null],
  ["def_tov_rate", 1, "Forces Turnovers", null], ["def_rim_share", -1, "Walls Off The Rim", "Gives Up The Rim"],
  ["def_three_rate", -1, "Runs Teams Off The Line", "Gives Up 3s"], ["def_ppp", -1, "Elite Defense", "Leaky Defense"],
  ["def_oreb_rate", -1, "Ends Possessions", "Gives Up 2nd Chances"],
];
const CHIP_AT = 1;
const CHIP_MAX = 4;
function chips(abbr, side) {
  const out = [];
  for (const [key, way, high, low] of CHIPS) {
    if (!key.startsWith(side)) continue;
    const zv = z(abbr, key);
    if (zv === null) continue;
    if (zv * way >= CHIP_AT && high) out.push([Math.abs(zv), high]);
    else if (zv * way <= -CHIP_AT && low) out.push([Math.abs(zv), low]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, CHIP_MAX).map(([, t]) => `<span class="id-chip">${t}</span>`).join("") || `<span class="id-none">Nothing Far From Average</span>`;
}

// The Verdict: the edge count, each team's edges (biggest first), what to
// expect, and how each team plays.
function verdictBox(g, calls) {
  const a = g.away;
  const h = g.home;
  const edges = (t) => calls.filter((c) => c.kind === "edge" && c.team === t).sort((x, y) => y.size - x.size);
  const ea = edges(a);
  const eh = edges(h);
  const total = ea.length + eh.length;
  const share = total ? (ea.length / total) * 100 : 50;
  const list = (es) => es.map((c) => `<span class="iv-chip${c.size >= EDGE_BIG ? " iv-big" : ""}">${c.text}</span>`).join("") || '<span class="id-none">No Clear Edges</span>';
  const expect = calls.filter((c) => c.kind !== "edge").sort((x, y) => y.size - x.size);
  const side = (t, es, right) => `<div class="iv-side${right ? " iv-right" : ""}${es.length > (t === a ? eh : ea).length ? " iv-lead" : ""}">${logo(t, 34)}<span class="iv-name">${team(t).name}</span><span class="iv-num">${es.length}<small>Edge${es.length === 1 ? "" : "s"}</small></span></div>`;
  const play = (t) => `<div class="iv-play"><span class="iv-label">${t} Offense</span>${chips(t, "off")}</div><div class="iv-play"><span class="iv-label">${t} Defense</span>${chips(t, "def")}</div>`;
  return `<div class="nba-box iv-verdict">
    <div class="iv-score">${side(a, ea)}<div class="iv-bar"><i style="width:${share}%;background:rgb(${teamRgb(a)})"></i><i style="width:${100 - share}%;background:rgb(${teamRgb(h)})"></i></div>${side(h, eh, true)}</div>
    <div class="nba-two iv-lists"><div class="iv-list">${list(ea)}</div><div class="iv-list">${list(eh)}</div></div>
    <div class="iv-expect"><span class="iv-label">Expect</span>${expect.map((c) => `<span class="gs-tag ${c.kind === "fits" ? "gs-tag-strong" : "gs-tag-weak"}">${c.text}</span>`).join("") || '<span class="id-none">No Style Clashes</span>'}</div>
    <div class="iv-sub">How They Play</div>
    <div class="nba-two iv-lists"><div>${play(a)}</div><div>${play(h)}</div></div>
  </div>`;
}

function renderBoard(g) {
  const ra = directionRows(g, g.away, g.home);
  const rh = directionRows(g, g.home, g.away);
  const rt = typeRows(g);
  const calls = [...ra, ...rh, ...rt].map((r) => r.call).filter(Boolean);
  el("id-verdict").innerHTML = verdictBox(g, calls);
  el("id-view").innerHTML = [["key", "Key Stats"], ["all", "Every Stat"]].map(([k, l]) => `<button type="button" class="view-toggle-btn${(k === "all") === ivAll ? " active" : ""}" data-view="${k}">${l}</button>`).join("");
  el("id-board").innerHTML = directionBox(g, g.away, g.home, ra) + directionBox(g, g.home, g.away, rh);
  el("id-extra").innerHTML = typesBox(g, rt) + scriptBox(g);
}

// ---- Matchup Extremes and Schedule Spots (extremes.js) ----
function extremesBox(abbr, opp) {
  const table = exTable(block().extremes, abbr, opp, false);
  return `<div class="nba-box">${banner(abbr)}${table || '<p class="no-data-note">No games on file.</p>'}</div>`;
}
function spotsBox(abbr, g) {
  const table = spotTable(block().spots, abbr, g.game_id, false);
  return `<div class="nba-box">${banner(abbr)}${table || '<p class="no-data-note">No games on file.</p>'}</div>`;
}

// ---- season buttons ----
function renderSeasons() {
  const thisSeason = String(DATA.season);
  el("id-seasons").innerHTML = Object.keys(ID.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${ID.seasons[s].label}</button>`)
    .join("") + (ID.seasons[thisSeason] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  const b = block();
  const cur = ID.seasons[thisSeason];
  el("id-season-note").textContent = season === thisSeason
    ? `${b.label}: ${b.team_games} game${b.team_games === 1 ? "" : "s"} a team so far, so small samples swing.`
    : `${b.label} reference: rosters have changed since.${cur ? ` ${cur.label} has ${cur.team_games} game${cur.team_games === 1 ? "" : "s"} a team so far.` : ` ${DATA.season_label} numbers start after the first games.`}`;
}
function setSeason(s, remember) {
  if (!ID.seasons[s]) return;
  season = s;
  if (!remember) return;
  // Kept only while the build's default stays the same, so the page still
  // moves to this season on its own once it takes over.
  try {
    localStorage.setItem(ID_SEASON_KEY, JSON.stringify({ season: s, default: ID.default }));
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
}

// ---- schedule ----
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
const game = () => DATA.schedule.find((g) => g.game_id === gameId) || null;
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => `<button type="button" class="matchup-card${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${fmtTime(g.time).replace(" ET", "")}</span>
      </button>`)
    .join("");
}
function renderHeader(g) {
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  el("game-header").hidden = false;
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${team(g.away).logo}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${team(g.home).logo}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g.time)}${g.tv ? ` &middot; ${g.tv}` : ""}</div>`;
}

function render() {
  renderSchedule();
  renderSeasons();
  const g = game();
  el("empty-state").hidden = !!g;
  el("id-game").hidden = !g;
  if (!g) {
    el("game-header").hidden = true;
    el("empty-state").innerHTML = "<p>No upcoming games on file.</p>";
    return;
  }
  renderHeader(g);
  renderBoard(g);
  el("id-extremes").innerHTML = extremesBox(g.away, g.home) + extremesBox(g.home, g.away);
  el("id-spots").innerHTML = spotsBox(g.away, g) + spotsBox(g.home, g);
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(ID_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}
function selectDay(i) {
  const all = days();
  if (i < 0 || i >= all.length) return;
  dayIndex = i;
  gameId = (gamesOn(all[i])[0] || {}).game_id || null;
  render();
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) return selectGame(card.dataset.game);
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const v = e.target.closest("#id-view [data-view]");
  if (v) {
    ivAll = v.dataset.view === "all";
    try {
      localStorage.setItem(IV_VIEW_KEY, ivAll ? "all" : "key");
    } catch (err) {
      // localStorage unavailable -- the view just won't be remembered.
    }
    return render();
  }
  const s = e.target.closest("#id-seasons [data-season]");
  if (s) {
    setSeason(s.dataset.season, true);
    return render();
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
    ID = data.identity;
    if (!ID || !Object.keys(ID.seasons || {}).length) {
      el("empty-state").innerHTML = "<p>Team Identity data isn't available right now.</p>";
      return;
    }
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(ID_SEASON_KEY) || "null");
    } catch (e) {
      // localStorage unavailable or bad JSON.
    }
    setSeason(pick && pick.default === ID.default && ID.seasons[pick.season] ? pick.season : ID.default, false);
    if (!season) setSeason(Object.keys(ID.seasons)[0], false);
    let saved = null;
    try {
      ivAll = localStorage.getItem(IV_VIEW_KEY) === "all";
      saved = localStorage.getItem(ID_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    const all = days();
    const savedGame = DATA.schedule.find((g) => g.game_id === saved);
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame && savedGame.date >= today ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame && savedGame.date === day ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
