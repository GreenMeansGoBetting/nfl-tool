// ---- GMG NBA Suite: Player Types ----
// Every player with 50+ shots, typed by HOW he shoots (shot_types.py): A = the deepest
// shooters ... L = rim runners. Three tabs on the League Stats Chart's grid: The 12 Types
// (each type's average mix and who shoots most in it), Every Player (sortable, filters),
// Defense Vs Type (what each defense allows each type, ranked of 30: 30th = allows the
// most = red). Type letters are a rainbow, A red to L purple (the owner, 2026-11-11), on
// a badge, never a number tile. Numbers: the site's 8-step scale. Data: nba/data.json
// `shot_types`. Stands on its own (no common.js), like the League Stats Chart.

let DATA = null;
let ptDay = 0; // Tonight: the day on screen
const ptView = { game: "", tab: "types", type: "", pos: "", border: false, q: "", sort: "type", dir: 1, stat: "pts", dsort: "", ddir: 1 };

const ptEl = (id) => document.getElementById(id);
const ptTeam = (abbr) => (DATA.teams || {})[abbr] || { name: abbr, color: "555555", logo: "" };
const ptRgb = (abbr) => [0, 2, 4].map((i) => parseInt((ptTeam(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
const ptEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PT_LETTERS = "ABCDEFGHIJKL".split("");
const PT_COL_W = 50;
const PT_GAP_W = 6;
// [field, label, full name]; the mix arrives in shot_types.F order
const PT_GROUPS = [
  ["Where", "od-g0", [["dist", "Avg Dist", "Average shot distance (feet)"], ["three", "3PT", "Share of his shots that are threes"]]],
  ["Jumpers", "od-g1", [["catch", "Catch & Shoot", "Jumpers off a pass"], ["pullup", "Pull-Up", "Pull-ups and step-backs"], ["fade", "Fade", "Fadeaways and turnarounds"]]],
  ["Inside", "od-g2", [["float", "Floater", "Floaters and runners"], ["post", "Post / Hook", "Hooks and post moves"], ["drive", "Drive", "Driving and running layups and dunks"], ["cut", "Cut", "Cutting and plain layups / dunks (mostly assisted)"], ["lob", "Lob / Putback", "Alley-oops, tips and putbacks"]]],
  ["Pace", "od-g3", [["fast", "Fast Break", "Shots within 8 seconds of a miss or a steal"]]],
];
const PT_COLS = PT_GROUPS.flatMap((g) => g[2]);
const PT_DEF_STATS = [["pts", "Points"], ["m3", "Threes Made"], ["shots", "Shots"], ["fg", "FG%"]];
const PT_DEF_MIN = 30; // fewer shots by a type against a defense: faded, not colored

// The site's 8-step rank colors (common.js RANK_SCALE; this page doesn't load common.js).
const PT_RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const ptRankStyle = (rank, total) => {
  const [hue, fill] = PT_RANK_SCALE[Math.min(PT_RANK_SCALE.length - 1, Math.floor(((rank - 1) / total) * PT_RANK_SCALE.length))];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
};
const ptOrdinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
// 1 = the most (how-often numbers: the most is green); ties share a rank
function ptRanks(vals, most = true) {
  return vals.map((v) => (v === null ? null : 1 + vals.filter((x) => x !== null && (most ? x > v : x < v)).length));
}

const ptHue = (L) => Math.round(PT_LETTERS.indexOf(L) * 25.45); // A 0 red ... L 280 purple
const ptBadge = (L, lean) => `<span class="pt-letter${lean ? " pt-lean" : ""}" style="--h:${ptHue(L)}">${L}</span>`;
const ptTypeCell = (p) => (p.border ? `${ptBadge(p.type)}<span class="pt-slash">/</span>${ptBadge(p.lean, true)}` : ptBadge(p.type));
const ptMix = (p) => Object.fromEntries(DATA.shot_types.fields.map((f, i) => [f, p.mix[i]]));
const ptShow = (key, v) => (v === null || v === undefined ? "" : key === "dist" ? v.toFixed(1) : String(Math.round(v)));

function ptPlayers() {
  return Object.entries(DATA.shot_types.players).map(([id, p]) => ({ id, ...p, ...ptMix(p) }));
}

// ---- the grid's header: ONE block per group (style.css; the owner, 2026-11-11) ----
// The lead columns (Player, Team...) and any one-column group are a single cell spanning both
// rows, never an empty band over a label.
function ptHead(lead, groups, sortKey, dir) {
  const gap = (tag) => `<${tag} class="od-ggap"${tag === "th" ? ' rowspan="2"' : ""}></${tag}>`;
  const cls = (g, i, n) => `${g} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const sortTh = (key, label, name, classes, span) => {
    const on = key && key === sortKey;
    return `<th class="${classes}${key ? " pt-sort" : ""}${on ? " pt-sorted" : ""}"${span ? ' rowspan="2"' : ""}${key ? ` data-sort="${key}" title="${ptEsc(name || label)}: click to sort"` : ""}>${label}${on ? `<i class="pt-arrow">${dir > 0 ? "&#9660;" : "&#9650;"}</i>` : ""}</th>`;
  };
  const groupRow = `<tr class="od-ggroups">${lead.map((l) => sortTh(l.sort, l.label, l.label, `pt-lead${l.stick ? " pt-stick" : ""}`, true)).join("")}${groups.map(([name, g, cols], gi) =>
    `${gi ? gap("th") : ""}${cols.length === 1 ? sortTh(cols[0][0], cols[0][1], cols[0][2], `${g} od-gone`, true) : `<th class="${g}" colspan="${cols.length}">${name}</th>`}`).join("")}</tr>`;
  const labelRow = `<tr class="od-glabels">${groups.filter(([, , cols]) => cols.length > 1).map(([, g, cols]) =>
    cols.map(([key, label, name], i) => sortTh(key, label, name, cls(g, i, cols.length))).join("")).join("")}</tr>`;
  return groupRow + labelRow;
}
function ptColgroup(leadWidths, groups) {
  return `<colgroup>${leadWidths.map((w) => `<col style="width:${w}px">`).join("")}${groups.map(([, , c], gi) =>
    `${gi ? `<col style="width:${PT_GAP_W}px">` : ""}${c.map(() => `<col style="width:${PT_COL_W}px">`).join("")}`).join("")}</colgroup>`;
}
const ptWidth = (leadWidths, groups) => leadWidths.reduce((a, b) => a + b, 0) + groups.reduce((a, g) => a + g[2].length, 0) * PT_COL_W + (groups.length - 1) * PT_GAP_W;
function ptMixCells(row, ranks, total, groups) {
  const cls = (g, i, n) => `${g} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  return groups.map(([, g, cols], gi) => `${gi ? '<td class="od-ggap"></td>' : ""}${cols.map(([key, , name], i) => {
    const rk = ranks[key];
    const tip = `${name}: ${key === "dist" ? `${row[key].toFixed(1)} ft` : `${row[key].toFixed(1)}%`}${rk ? ` · ${ptOrdinal(rk)} of ${total}` : ""}`;
    return `<td class="${cls(g, i, cols.length)}"><div class="od-tile pt-tile" style="${rk ? ptRankStyle(rk, total) : ""}" title="${ptEsc(tip)}"><b>${ptShow(key, row[key])}</b></div></td>`;
  }).join("")}`).join("");
}

// ---- The 12 Types ----
function ptTypesTab() {
  const players = ptPlayers();
  const rows = PT_LETTERS.map((L) => {
    const g = players.filter((p) => p.type === L);
    const avg = Object.fromEntries(PT_COLS.map(([k]) => [k, g.length ? g.reduce((a, p) => a + p[k], 0) / g.length : null]));
    const top = [...g].sort((a, b) => b.n - a.n).slice(0, 6);
    return { L, n: g.length, ...avg, top };
  }).filter((r) => r.n);
  const ranks = Object.fromEntries(PT_COLS.map(([k]) => [k, ptRanks(rows.map((r) => r[k]))]));
  const lead = [{ label: "Type", stick: true }, { label: "Players" }];
  const widths = [58, 52];
  const NAMES_W = 330;
  const body = rows.map((r, ri) => `<tr class="pt-pick" data-type="${r.L}" title="Every ${r.L} player"><td class="pt-stick">${ptBadge(r.L)}</td><td><div class="od-tile pt-tile"><b>${r.n}</b></div></td>${ptMixCells(r, Object.fromEntries(PT_COLS.map(([k]) => [k, ranks[k][ri]])), rows.length, PT_GROUPS)}<td class="od-ggap"></td><td class="pt-names od-g3 od-gt od-gl od-gr">${r.top.map((p) => playerClick(p.id, ptEsc(p.name))).join(", ")}</td></tr>`).join("");
  // the shared header plus one more band: who shoots the most in each type
  const [groupRow, labelRow] = ptHead(lead, PT_GROUPS, null, 1).split("</tr>");
  const head = `${groupRow}<th class="od-ggap" rowspan="2"></th><th class="od-g3 od-gone" rowspan="2">Most Shots In The Type</th></tr>${labelRow}</tr>`;
  const width = ptWidth(widths, PT_GROUPS) + PT_GAP_W + NAMES_W;
  ptEl("pt-bar").innerHTML = `<span class="pt-count">Each type's average shot mix, colored across the 12 types. Click a type to see every player in it.</span>`;
  ptEl("pt-body").innerHTML = `<table class="data-table od-grid pt-grid" style="width:${width}px">${ptColgroup(widths, PT_GROUPS).replace("</colgroup>", `<col style="width:${PT_GAP_W}px"><col style="width:${NAMES_W}px"></colgroup>`)}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ---- Every Player ----
function ptPlayersTab() {
  const all = ptPlayers();
  const ranks = Object.fromEntries(PT_COLS.map(([k]) => [k, Object.fromEntries(all.map((p, i) => [p.id, ptRanks(all.map((x) => x[k]))[i]]))]));
  const q = ptView.q.trim().toLowerCase();
  let rows = all.filter((p) => (!ptView.type || p.type === ptView.type || (p.border && p.lean === ptView.type))
    && (!ptView.pos || p.pos === ptView.pos) && (!ptView.border || p.border) && (!q || (p.name || "").toLowerCase().includes(q)));
  const k = ptView.sort;
  rows.sort((a, b) => {
    // filtered to a type: its own players first, then the ones only leaning into it
    if (ptView.type && (a.type === ptView.type) !== (b.type === ptView.type)) return a.type === ptView.type ? -1 : 1;
    const x = k === "type" ? PT_LETTERS.indexOf(a.type) : k === "name" ? 0 : a[k];
    const y = k === "type" ? PT_LETTERS.indexOf(b.type) : k === "name" ? 0 : b[k];
    const c = k === "name" ? (a.name || "").localeCompare(b.name || "") : k === "type" ? x - y : y - x;
    return c * ptView.dir || b.n - a.n;
  });
  const chips = `<button type="button" class="view-toggle-btn pt-all${ptView.type ? "" : " active"}" data-type="">All</button>${PT_LETTERS.map((L) =>
    `<button type="button" class="pt-chip${ptView.type === L ? " on" : ""}" data-type="${L}" title="${L} players (and players leaning ${L})">${ptBadge(L)}</button>`).join("")}`;
  ptEl("pt-bar").innerHTML = `${chips}
    <select id="pt-pos" aria-label="Position"><option value="">Every Position</option>${["PG", "SG", "SF", "PF", "C"].map((p) => `<option${ptView.pos === p ? " selected" : ""}>${p}</option>`).join("")}</select>
    <label><input type="checkbox" id="pt-border"${ptView.border ? " checked" : ""}> Borderline Only</label>
    <input type="search" id="pt-q" placeholder="Find A Player" aria-label="Find a player" value="${ptEsc(ptView.q)}">
    <span class="pt-count">${rows.length} of ${all.length} players</span>`;
  const lead = [{ label: "Player", stick: true, sort: "name" }, { label: "Team" }, { label: "Type", sort: "type" }, { label: "Shots", sort: "n" }];
  const widths = [170, 52, 84, 50];
  const nRanks = ptRanks(all.map((p) => p.n));
  const nRank = Object.fromEntries(all.map((p, i) => [p.id, nRanks[i]]));
  const body = rows.map((p) => {
    const leans = ptView.type && p.type !== ptView.type;
    return `<tr${leans ? ' class="pt-leans"' : ""}><td class="pt-stick pt-name" title="${ptEsc(p.name)}">${playerClick(p.id, ptEsc(p.name))}<small>${ptEsc(p.pos || "")}${leans ? ` · Leans ${ptView.type}` : ""}</small></td>
      <td><div class="pt-logo" style="--team:${ptRgb(p.team)}" title="${ptEsc(ptTeam(p.team).name)}">${ptTeam(p.team).logo ? `<img src="${ptTeam(p.team).logo}" alt="${ptEsc(p.team)}" loading="lazy">` : ptEsc(p.team)}</div></td>
      <td class="pt-type-cell" title="${p.border ? `Borderline: nearly as close to ${p.lean} as to ${p.type}` : `Squarely ${p.type}`} (fit ${p.fit.toFixed(2)})">${ptTypeCell(p)}</td>
      <td><div class="od-tile pt-tile" style="${ptRankStyle(nRank[p.id], all.length)}" title="${p.n} shots this season"><b>${p.n}</b></div></td>
      ${ptMixCells(p, Object.fromEntries(PT_COLS.map(([key]) => [key, ranks[key][p.id]])), all.length, PT_GROUPS)}</tr>`;
  }).join("");
  ptEl("pt-body").innerHTML = `<table class="data-table od-grid pt-grid" style="width:${ptWidth(widths, PT_GROUPS)}px">${ptColgroup(widths, PT_GROUPS)}<thead>${ptHead(lead, PT_GROUPS, k, ptView.dir)}</thead><tbody>${body}</tbody></table>`;
}

// ---- Defense Vs Type ----
// a defense's number against one type: a game (points, threes, shots) or FG%
function ptDefValue(vs, games, stat) {
  if (!vs || !games) return null;
  const [shots, made, pts, m3] = vs;
  if (stat === "fg") return shots ? (100 * made) / shots : null;
  return ({ pts, m3, shots })[stat] / games;
}
function ptDefenseTab() {
  const def = DATA.shot_types.defense;
  const stat = ptView.stat;
  const teams = Object.keys(def.teams).sort();
  const letters = PT_LETTERS.filter((L) => def.league[L]);
  const fmt = (v) => (v === null ? "" : stat === "fg" ? String(Math.round(v)) : v.toFixed(1));
  // rank of 30 from the defense's side: allowing the least = 1st (green), the most = 30th (red)
  const ranks = {};
  letters.forEach((L) => {
    const vals = teams.map((t) => {
      const vs = def.teams[t].vs[L];
      return vs && vs[0] >= PT_DEF_MIN ? ptDefValue(vs, def.teams[t].games, stat) : null;
    });
    const r = ptRanks(vals, false);
    ranks[L] = { n: vals.filter((v) => v !== null).length, r: Object.fromEntries(teams.map((t, i) => [t, r[i]])) };
  });
  const sortL = ptView.dsort;
  const order = sortL ? [...teams].sort((a, b) => {
    const va = ptDefValue(def.teams[a].vs[sortL], def.teams[a].games, stat), vb = ptDefValue(def.teams[b].vs[sortL], def.teams[b].games, stat);
    return ((vb ?? -1) - (va ?? -1)) * ptView.ddir;
  }) : teams;
  const statName = PT_DEF_STATS.find((s) => s[0] === stat)[1];
  ptEl("pt-bar").innerHTML = `<div class="pt-seg">${PT_DEF_STATS.map(([key, label]) => `<button type="button" class="view-toggle-btn${stat === key ? " active" : ""}" data-stat="${key}">${label}</button>`).join("")}</div>
    <span class="pt-count">${stat === "fg" ? "FG% allowed" : `${statName} allowed a game`} to each type. Ranked of 30 from the defense's side: <b>30th = allows the most (red)</b>. Under ${PT_DEF_MIN} shots: faded, not ranked. Click a letter to sort.</span>`;
  const lg = def.team_games;
  const leagueVal = (L) => (stat === "fg" ? (100 * def.league[L][1]) / def.league[L][0] : ({ pts: def.league[L][2], m3: def.league[L][3], shots: def.league[L][0] })[stat] / lg);
  const cls = (i, n) => `od-g1 od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const head = `<tr class="od-ggroups"><th class="pt-lead pt-stick" rowspan="2">Team</th><th class="od-g1" colspan="${letters.length}">${stat === "fg" ? "FG% Allowed" : `${statName} Allowed A Game`} To Each Type</th></tr>
    <tr class="od-glabels">${letters.map((L, i) => `<th class="${cls(i, letters.length)} pt-sort${sortL === L ? " pt-sorted" : ""}" data-dsort="${L}" title="Sort by what each defense allows type ${L}">${ptBadge(L)}</th>`).join("")}</tr>`;
  const leagueRow = `<tr><td class="pt-stick pt-name">League<small>a team-game</small></td>${letters.map((L, i) => `<td class="${cls(i, letters.length)}"><div class="od-tile pt-tile" title="League: ${fmt(leagueVal(L))}"><b>${fmt(leagueVal(L))}</b></div></td>`).join("")}</tr>`;
  const body = order.map((t) => {
    const row = def.teams[t];
    return `<tr><td class="pt-stick"><div class="pt-logo" style="--team:${ptRgb(t)}" title="${ptEsc(ptTeam(t).name)} (${row.games} games)">${ptTeam(t).logo ? `<img src="${ptTeam(t).logo}" alt="${t}" loading="lazy">` : t}</div></td>${letters.map((L, i) => {
      const vs = row.vs[L];
      const v = ptDefValue(vs, row.games, stat);
      const rk = ranks[L].r[t];
      const thin = !vs || vs[0] < PT_DEF_MIN;
      const tip = vs ? `${ptTeam(t).name} vs type ${L}: ${fmt(v)}${stat === "fg" ? "% FG" : ` ${statName.toLowerCase()} a game`} (league ${fmt(leagueVal(L))}) · ${vs[0]} shots, ${Math.round((100 * vs[1]) / vs[0])}% FG, ${vs[2]} points, ${vs[3]} threes made in ${row.games} games${rk ? ` · ${ptOrdinal(rk)}-least of ${ranks[L].n}` : " · too few shots to rank"}` : `${ptTeam(t).name}: no shots by type ${L} yet`;
      return `<td class="${cls(i, letters.length)}"><div class="od-tile pt-tile${thin ? " pt-thin" : ""}" style="${rk && !thin ? ptRankStyle(rk, ranks[L].n) : ""}" title="${ptEsc(tip)}"><b>${fmt(v)}</b></div></td>`;
    }).join("")}</tr>`;
  }).join("");
  const width = 84 + letters.length * PT_COL_W;
  ptEl("pt-body").innerHTML = `<table class="data-table od-grid pt-grid" style="width:${width}px"><colgroup><col style="width:84px">${letters.map(() => `<col style="width:${PT_COL_W}px">`).join("")}</colgroup><thead>${head}</thead><tbody>${leagueRow}${body}</tbody></table>`;
}

function ptFoot() {
  const st = DATA.shot_types;
  // the groups are fixed (2026-11-13); each player is re-checked once a day (shot_types `day`)
  const drawn = new Date(`${st.drawn}T12:00:00`);
  const day = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const s = st.stability || {};
  const checked = st.day ? ` Every player re-checked ${day(new Date(`${st.day}T12:00:00`))}.` : "";
  ptEl("pt-foot").textContent = `${Object.keys(st.players).length} players typed (${st.min_shots}+ shots). Types fixed since ${day(drawn)}.${checked}`
    + (s.players ? ` Odd vs even games: ${Math.round(s.same * 100)}% kept their letter, ${Math.round(s.same_or_lean * 100)}% their letter or lean.` : "")
    + (st.moved !== null && st.moved !== undefined ? ` ${st.moved} changed letters at the last redraw.` : "");
}

// ---- Tonight (the owner, 2026-11-11): every player on a night's slate, his letter, and how his type has
// done against tonight's defense over their own averages (Slate Standouts' measuring stick, unfiltered).
// The game carousel picks one game to isolate; again = every game. ----
const PT_TN_MIN = 6; // Slate Standouts' SS_MIN_GAMES: fewer games = faded, not ranked
const PT_TN_OUT = new Set(["Out", "Doubtful"]);
const ptDays = () => [...new Set((DATA.schedule || []).map((g) => g.date))].sort();
// {defense: {type: {pts: {n, avg, over}, m3: {...}}}} from the games before `before`
function ptStick(before) {
  const st = DATA.shot_types;
  const f = Object.fromEntries(st.log_fields.map((k, i) => [k, i]));
  const out = {};
  (st.log || []).forEach((r) => {
    if (r[f.date] >= before) return;
    const p = st.players[r[f.player]];
    if (!p) return;
    [["pts", "pts_diff"], ["m3", "m3_diff"]].forEach(([k, field]) => {
      const c = (((out[r[f.def]] ||= {})[p.type] ||= {})[k] ||= { n: 0, sum: 0, over: 0 });
      c.n += 1;
      c.sum += r[f[field]];
      if (r[f[field]] > 0) c.over += 1;
    });
  });
  Object.values(out).forEach((bt) => Object.values(bt).forEach((bk) => Object.values(bk).forEach((c) => { c.avg = c.sum / c.n; })));
  return out;
}
// the defense's rank against a type in a stat, of the defenses with enough games: 30th = gives up the most (red)
function ptTnRank(stick, type, k, def) {
  const vals = Object.entries(stick).map(([d, bt]) => [d, ((bt[type] || {})[k])]).filter(([, c]) => c && c.n >= PT_TN_MIN);
  const mine = vals.find(([d]) => d === def);
  return mine ? { r: 1 + vals.filter(([, c]) => c.avg < mine[1].avg).length, n: vals.length } : null;
}
function ptSchedule(date) {
  const games = (DATA.schedule || []).filter((g) => g.date === date);
  const logo = (abbr) => `<img src="${ptTeam(abbr).logo}" alt="${abbr}" class="team-logo" style="width:28px;height:28px" loading="lazy">`;
  const label = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  return `<div class="schedule-scroller pt-sched"><div class="week-picker"><button type="button" id="pt-day-prev" class="week-nav-btn"${ptDay <= 0 ? " disabled" : ""}>&lsaquo;</button><span class="week-label">${label}</span><button type="button" id="pt-day-next" class="week-nav-btn"${ptDay >= ptDays().length - 1 ? " disabled" : ""}>&rsaquo;</button></div>
    <div class="matchup-row">${games.map((g) => `<button type="button" class="matchup-card${String(g.game_id) === ptView.game ? " selected" : ""}" data-pt-game="${g.game_id}" title="Show only this game (click again for every game)">
      <span class="matchup-teams-row">${logo(g.away)}<span class="at">@</span>${logo(g.home)}</span><span class="matchup-date">${typeof gmgGameTime === "function" ? gmgGameTime(g, false) : g.time || ""}</span></button>`).join("")}</div></div>`;
}
function ptTonightTab() {
  const all = ptDays();
  const date = all[ptDay];
  const games = (DATA.schedule || []).filter((g) => g.date === date && (!ptView.game || String(g.game_id) === ptView.game));
  ptEl("pt-bar").innerHTML = ptSchedule(date);
  const st = DATA.shot_types;
  const stick = ptStick(date || "9999");
  const out = new Set(Object.values(DATA.injuries || {}).flat().filter((x) => PT_TN_OUT.has(x.status)).map((x) => String(x.id)));
  const players = ptPlayers();
  const avgRank = (i) => { const vals = players.map((p) => (p.avg || [])[i] ?? null); return (v) => (v === null || v === undefined ? null : 1 + vals.filter((x) => x !== null && x > v).length); };
  const ptsRank = avgRank(1), m3Rank = avgRank(2);
  // Him (blue) beside the defense against his type (purple), each in its own block (the owner, 2026-11-11:
  // "its not super clear that the offensive player is the first column ... separate the shaded background").
  const groups = [
    ["His Points", "od-g1", [["line_pts", "Line", "His points line tonight (the books' main line)"], ["self_pts", "Avg", "His points a game this season"]]],
    ["Defense Vs His Type", "od-g2", [["pts", "+/- Avg", "Players of his type against tonight's defense: points over / under their own averages"], ["pts_hit", "Beat Avg", "How many of those games they beat their own average"]]],
    ["His Threes", "od-g1", [["line_m3", "Line", "His threes line tonight (the books' main line)"], ["self_m3", "Avg", "His threes made a game this season"]]],
    ["Defense Vs His Type", "od-g2", [["m3", "+/- Avg", "Players of his type against tonight's defense: threes over / under their own averages"], ["m3_hit", "Beat Avg", "How many of those games they beat their own average"]]],
  ];
  const lead = [{ label: "Player", stick: true }, { label: "Team" }, { label: "Type" }, { label: "Vs" }];
  const widths = [170, 52, 84, 52];
  const fmt = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const cls = (g, i, n) => `${g} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const tile = (style, text, tip, thin) => `<div class="od-tile pt-tile${thin ? " pt-thin" : ""}" style="${style}" title="${ptEsc(tip)}"><b>${text}</b></div>`;
  // his line tonight: the player card's main-line rule over every book's quotes (none = "--")
  const lineOf = (p, mine, g, stat) => {
    if (typeof bookQuotes !== "function" || typeof nbaCardMainLine !== "function") return null;
    const quotes = bookQuotes({ kind: "prop", team: mine, pid: p.id, stat, game: `${g.away}_${g.home}` });
    return quotes.length ? nbaCardMainLine(quotes) : null;
  };
  const himCells = (p, mine, g, stat, selfV, selfRank) => {
    const line = lineOf(p, mine, g, stat);
    return `<td class="${cls("od-g1", 0, 2)}">${tile("", line === null ? "--" : line, `${p.name}: ${line === null ? "no line yet" : `${stat} line ${line}`} tonight`, false)}</td>`
      + `<td class="${cls("od-g1", 1, 2)}">${tile(selfRank ? ptRankStyle(selfRank, players.length) : "", selfV === null || selfV === undefined ? "--" : selfV.toFixed(1), `${p.name}: ${selfV ?? "--"} ${stat} a game this season`, false)}</td>`;
  };
  const defCells = (p, def, k, label) => {
    const c = ((stick[def] || {})[p.type] || {})[k];
    if (!c) return `<td class="${cls("od-g2", 0, 2)}">${tile("", "--", `No games yet by type ${p.type} against ${def}`, true)}</td><td class="${cls("od-g2", 1, 2)}">${tile("", "--", "", true)}</td>`;
    const rk = ptTnRank(stick, p.type, k, def);
    const thin = c.n < PT_TN_MIN;
    const st = !thin && rk ? ptRankStyle(rk.r, rk.n) : "";
    const tip = `Type ${p.type} vs ${def}: ${fmt(c.avg)} ${label} over their own averages in ${c.n} games${rk ? `, ${ptOrdinal(rk.r)} of ${rk.n} defenses (30th = gives up the most)` : `; under ${PT_TN_MIN} games, not ranked`}`;
    return `<td class="${cls("od-g2", 0, 2)}">${tile(st, fmt(c.avg), tip, thin)}</td><td class="${cls("od-g2", 1, 2)}">${tile(st, `${c.over}/${c.n}`, `They beat their own average in ${c.over} of ${c.n} games`, thin)}</td>`;
  };
  const head = ptHead(lead, groups, null, 1);
  const width = ptWidth(widths, groups);
  const body = games.map((g) => {
    const rows = [[g.away, g.home], [g.home, g.away]].flatMap(([mine, def]) => players.filter((p) => p.team === mine && !out.has(String(p.id)))
      .sort((a, b) => ((b.avg || [])[1] || 0) - ((a.avg || [])[1] || 0))
      .map((p) => `<tr><td class="pt-stick pt-name" title="${ptEsc(p.name)}">${playerClick(p.id, ptEsc(p.name))}<small>${ptEsc(p.pos || "")}</small></td>
        <td><div class="pt-logo" style="--team:${ptRgb(mine)}">${ptTeam(mine).logo ? `<img src="${ptTeam(mine).logo}" alt="${mine}" loading="lazy">` : mine}</div></td>
        <td class="pt-type-cell">${ptTypeCell(p)}</td>
        <td><div class="pt-logo" style="--team:${ptRgb(def)}" title="Tonight's defense: ${ptEsc(ptTeam(def).name)}">${ptTeam(def).logo ? `<img src="${ptTeam(def).logo}" alt="${def}" loading="lazy">` : def}</div></td>
        ${himCells(p, mine, g, "points", (p.avg || [])[1], ptsRank((p.avg || [])[1]))}<td class="od-ggap"></td>${defCells(p, def, "pts", "points")}
        <td class="od-ggap"></td>${himCells(p, mine, g, "threes", (p.avg || [])[2], m3Rank((p.avg || [])[2]))}<td class="od-ggap"></td>${defCells(p, def, "m3", "threes")}</tr>`));
    return `<tr class="pt-game-row"><td class="pt-stick" colspan="${lead.length + 11}">${g.away} @ ${g.home}</td></tr>${rows.join("")}`;
  }).join("");
  ptEl("pt-body").innerHTML = games.length
    ? `<table class="data-table od-grid pt-grid" style="width:${width}px">${ptColgroup(widths, groups)}<thead>${head}</thead><tbody>${body}</tbody></table>`
    : `<p class="no-data-note">No games this day.</p>`;
}

function ptRender() {
  document.querySelectorAll(".pt-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === ptView.tab));
  if (ptView.tab === "tonight") ptTonightTab();
  else if (ptView.tab === "players") ptPlayersTab();
  else if (ptView.tab === "defense") ptDefenseTab();
  else ptTypesTab();
}
function ptSetTab(tab) {
  ptView.tab = tab;
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", `#${tab}`);
  ptRender();
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".player-click")) return; // the player card opens (nba-card.js)
  const tab = e.target.closest(".pt-tab");
  if (tab) return ptSetTab(tab.dataset.tab);
  const card = e.target.closest("[data-pt-game]");
  if (card) {
    ptView.game = ptView.game === card.dataset.ptGame ? "" : card.dataset.ptGame;
    return ptRender();
  }
  if (e.target.closest("#pt-day-prev") || e.target.closest("#pt-day-next")) {
    ptDay = Math.max(0, Math.min(ptDays().length - 1, ptDay + (e.target.closest("#pt-day-prev") ? -1 : 1)));
    ptView.game = "";
    return ptRender();
  }
  const pick = e.target.closest("tr.pt-pick");
  if (pick) {
    ptView.type = pick.dataset.type;
    ptView.sort = "n";
    ptView.dir = 1;
    return ptSetTab("players");
  }
  const chip = e.target.closest("#pt-bar [data-type]");
  if (chip) {
    ptView.type = chip.dataset.type;
    return ptRender();
  }
  const stat = e.target.closest("#pt-bar [data-stat]");
  if (stat) {
    ptView.stat = stat.dataset.stat;
    return ptRender();
  }
  const dsort = e.target.closest("th[data-dsort]");
  if (dsort) {
    ptView.ddir = ptView.dsort === dsort.dataset.dsort ? -ptView.ddir : 1;
    ptView.dsort = dsort.dataset.dsort;
    return ptRender();
  }
  const sort = e.target.closest("th[data-sort]");
  if (sort && ptView.tab === "players") {
    ptView.dir = ptView.sort === sort.dataset.sort ? -ptView.dir : 1;
    ptView.sort = sort.dataset.sort;
    return ptRender();
  }
  if (e.target.closest("#theme-toggle")) {
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
document.addEventListener("change", (e) => {
  if (e.target.id === "pt-pos") ptView.pos = e.target.value;
  else if (e.target.id === "pt-border") ptView.border = e.target.checked;
  else return;
  ptRender();
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "pt-q") return;
  ptView.q = e.target.value;
  const at = e.target.selectionStart;
  ptRender();
  const box = ptEl("pt-q");
  box.focus();
  box.setSelectionRange(at, at);
});
window.addEventListener("hashchange", () => {
  const tab = location.hash.slice(1);
  if (["tonight", "types", "players", "defense"].includes(tab) && tab !== ptView.tab) ptSetTab(tab);
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const st = data.shot_types;
    if (!st || !st.players || !Object.keys(st.players).length) {
      ptEl("empty-state").innerHTML = "<p>Player Types aren't available right now.</p>";
      return;
    }
    ptEl("empty-state").hidden = true;
    ptEl("pt-app").hidden = false;
    const tab = location.hash.slice(1);
    ptView.tab = ["tonight", "types", "players", "defense"].includes(tab) ? tab : "types";
    const days = ptDays();
    const today = new Date().toLocaleDateString("en-CA");
    ptDay = Math.max(0, days.indexOf(days.find((d) => d >= today) || days[days.length - 1]));
    ptFoot();
    ptRender();
  })
  .catch((err) => {
    ptEl("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
