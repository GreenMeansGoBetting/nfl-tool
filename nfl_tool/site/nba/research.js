// GMG NBA Suite: the prop research pages, Points / Threes / Rebounds / Assists (2026-11-03).
// They replace the game sim's boards. The owner, 2026-11-03: "I do not feel comfortable giving
// people projections based on incomplete info" (rest days, late scratches, a team going in with
// six players); "I would like people to be able to click into betting categories, like assists and
// rebounds, and get information and data that relates to those categories and see available bets
// and lines." So: no projection, no pick, no edge, no rating. Every number is a real count from
// this season's games, beside every book's line, and the member draws the conclusion.
// One page a market: the page's <body data-market="points"> picks its config below.
// A row: his main line (the middle of the books'), the best Over / Under across the member's books
// (click: every book; the box saves to My Plays), his average and minutes (season, last 5), how
// often he went over tonight's line, what tonight's defense allows to his position, and how he did
// in the games each teammate on tonight's injury report missed (the With / Without read).
// From props.json `seasons[...]`: players {log, pos, team}, out {team: {game: [[id, why]]}}.

const RS_MARKETS = {
  points: { market: "points", stat: "pts", unit: "Points", short: "PTS", swing: 3 },
  threes: { market: "threes", stat: "fg3m", unit: "Threes", short: "3PM", swing: 0.8 },
  rebounds: { market: "rebounds", stat: "reb", unit: "Rebounds", short: "REB", swing: 1.5 },
  assists: { market: "assists", stat: "ast", unit: "Assists", short: "AST", swing: 1.2 },
};
const MK = RS_MARKETS[document.body.dataset.market] || RS_MARKETS.points;
const ROTATION_MIN = 12; // Every Player: players at this many minutes a game or more
const KEY_MIN = 20; // a teammate this many minutes a game gets a With / Without pill when he's on the report
const SMALL = 3; // fewer games than this without a teammate = Small Sample, never colored
const DAYS_AHEAD = 3; // the day arrows reach this many slates

let DATA = null;
let PROPS = null;
let dayIndex = 0;
let gameId = "";
const LIST = { game: "", pos: "", every: false, sort: "line", dir: -1 };
// The research panel under a clicked row: the Points page for now (props.json `research`, research.py).
const PANEL = MK.market === "points";
let OPEN = ""; // "<game id>:<player id>" of the open row

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="nba-headshot" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "--" : Number(n).toFixed(d));
const signed = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "&minus;" : ""}${Math.abs(n).toFixed(d)}`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const lastName = (name) => String(name || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").split(" ").slice(-1)[0];

// ---- this season's games (props.json) ----
const seasonBlock = () => (PROPS.seasons || {})[String(DATA.season)] || Object.values(PROPS.seasons || {})[0] || { players: {}, out: {}, fields: [] };
const logFields = () => Object.fromEntries((seasonBlock().fields || []).map((f, i) => [f, i]));
const playerOf = (pid) => seasonBlock().players[pid] || null;
const logOf = (pid) => (playerOf(pid) || {}).log || [];
const nameOf = (pid) => (playerOf(pid) || {}).name || pid;
const statOf = (r, f) => r[f[MK.stat]] || 0;
// for the player card (nba-card.js): the game open on the page
function currentGame() {
  return DATA ? DATA.schedule.find((g) => g.game_id === gameId) || null : null;
}

// ---- the slate ----
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// The next slates from today; with none ahead (the off-season), the last one played.
function days() {
  const all = [...new Set(DATA.schedule.map((g) => g.date))].sort();
  const ahead = all.filter((d) => d >= todayET());
  return ahead.length ? ahead.slice(0, DAYS_AHEAD) : all.slice(-1);
}
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
// A game has started once its tip time has passed (times are Eastern, fixed UTC-4 like the build).
const started = (g) => g.status === "final" || (Boolean(g.time) && Date.now() >= Date.parse(`${g.date}T${g.time}:00-04:00`));

// ---- the books' lines (data.json book_odds) ----
function bookGame(g) {
  return ((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {};
}
function mainLine(g, pid) {
  const ls = ((((bookGame(g)[MK.market] || {})[pid] || {}).q) || []).map((q) => q[2]).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return ls.length ? ls[Math.floor(ls.length / 2)] : null;
}
function sideCell(g, pid, side, line, tm) {
  if (line === null) return '<td class="rs-price"><span class="muted-label">--</span></td>';
  const spec = { kind: "prop", stat: MK.market, team: tm, game: `${g.away}_${g.home}`, pid, side, line, title: `${nameOf(pid)} ${MK.unit}`, sub: `${g.away} @ ${g.home}` };
  const p = { id: pid, name: nameOf(pid), team: tm };
  return `<td class="rs-price">${typeof nbaCardSide === "function" ? nbaCardSide(spec, g, p, MK.market) : bookPricePill(spec) || "--"}</td>`;
}

// ---- the injury report (data.json injuries, ESPN's list + the NBA's report) ----
const reportOf = (tm) => (DATA.injuries || {})[tm] || [];
const statusOf = (tm, pid) => (reportOf(tm).find((x) => String(x.id) === String(pid)) || {}).status || "";
const isOut = (status) => /^(out|doubtful)/i.test(status);
const STATUS_SHORT = { "day-to-day": "DTD", questionable: "Q", probable: "P", doubtful: "D", out: "Out" };
const statusPill = (status) => {
  if (!status) return "";
  const short = STATUS_SHORT[status.toLowerCase()] || status;
  return `<span class="rs-inj${isOut(status) ? " out" : ""}" title="Injury report: ${status}">${short}</span>`;
};

// ---- what each defense allows to each position (this season, real games) ----
// Every player's game: his number against that opponent goes to the opponent's total for his
// position; a game a team played counts once. Per game = total / that team's games.
let ALLOWED = null;
function allowed() {
  if (ALLOWED && ALLOWED.mk === MK.market) return ALLOWED;
  const f = logFields();
  const sums = {}, games = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (!p.pos) continue;
    for (const r of p.log || []) {
      const opp = r[f.opp];
      if (!opp) continue;
      ((sums[opp] = sums[opp] || {})[p.pos] = (sums[opp][p.pos] || 0) + statOf(r, f));
      (games[opp] = games[opp] || new Set()).add(r[f.game]);
    }
  }
  const per = {};
  for (const [opp, byPos] of Object.entries(sums)) {
    for (const [pos, total] of Object.entries(byPos)) ((per[pos] = per[pos] || {})[opp] = { v: total / games[opp].size, n: games[opp].size });
  }
  const ranks = {};
  for (const [pos, teams] of Object.entries(per)) {
    const sorted = Object.entries(teams).sort((a, b) => b[1].v - a[1].v);
    ranks[pos] = { n: sorted.length, league: avg(sorted.map(([, x]) => x.v)), r: Object.fromEntries(sorted.map(([t], i) => [t, i + 1])) };
  }
  ALLOWED = { mk: MK.market, per, ranks };
  return ALLOWED;
}
// The site's 8-step rank colors (league.js rankStyle), 1st = allows the most = greenest.
const RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const rankStyle = (rank, total) => {
  const [hue, fill] = RANK_SCALE[Math.min(RANK_SCALE.length - 1, Math.floor(((rank - 1) / total) * RANK_SCALE.length))];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
};

// ---- With / Without: his games each teammate on tonight's report missed ----
// A teammate "missed" a game when the box score lists him as not playing (props.json `out`);
// games he wasn't on the team for count on neither side.
function withoutRows(pid, tm) {
  const f = logFields();
  const mine = logOf(pid);
  const outs = seasonBlock().out[tm] || {};
  const rows = [];
  for (const inj of reportOf(tm)) {
    const mate = String(inj.id);
    if (mate === String(pid) || /^probable/i.test(inj.status)) continue;
    const theirs = logOf(mate);
    const mins = avg(theirs.map((r) => r[f.min] || 0));
    if (!theirs.length || mins < KEY_MIN) continue;
    const played = new Set(theirs.map((r) => String(r[f.game])));
    const sat = (r) => (outs[String(r[f.game])] || []).some(([id]) => String(id) === mate);
    const withHim = mine.filter((r) => played.has(String(r[f.game]))).map((r) => statOf(r, f));
    const without = mine.filter((r) => !played.has(String(r[f.game])) && sat(r)).map((r) => statOf(r, f));
    rows.push({ mate, name: inj.name || nameOf(mate), status: inj.status, out: isOut(inj.status), mins,
      without: avg(without), n: without.length, with: avg(withHim), nWith: withHim.length });
  }
  return rows.sort((a, b) => b.out - a.out || b.mins - a.mins);
}
function withoutPill(w) {
  const label = `${w.out ? "No" : "If No"} ${lastName(w.name)}`;
  const base = `${w.name} (${w.status}, ${fmt(w.mins)} min a game)`;
  if (!w.n) return `<span class="sim-rtag wait" title="${base}: they haven't missed a game together this season">${label}: 0 G</span>`;
  const diff = w.with === null ? null : w.without - w.with;
  const small = w.n < SMALL;
  const cls = small || diff === null || Math.abs(diff) < MK.swing ? "" : diff > 0 ? " good" : " bad";
  const tip = `${base}: ${fmt(w.without)} ${MK.unit.toLowerCase()} a game in the ${w.n} game${w.n === 1 ? "" : "s"} he missed`
    + (w.with === null ? "" : `, ${fmt(w.with)} in ${w.nWith} with him`) + (small ? " (Small Sample)" : "");
  return `<span class="sim-rtag${cls}${w.out ? "" : " rs-maybe"}" title="${tip}">${label}: ${fmt(w.without)}${diff === null ? "" : ` (${signed(diff)})`} &middot; ${w.n} G</span>`;
}

// ---- the rows ----
function hits(rows, line, f) {
  if (line === null || line === undefined || !rows.length) return null;
  return { over: rows.filter((x) => statOf(x, f) > line).length, of: rows.length };
}
function rowsOn(date) {
  const f = logFields();
  const A = allowed();
  const out = [];
  for (const g of gamesOn(date)) {
    if (LIST.game && g.game_id !== LIST.game) continue;
    for (const [pid, p] of Object.entries(seasonBlock().players)) {
      if (p.team !== g.away && p.team !== g.home) continue;
      if (LIST.pos && p.pos !== LIST.pos) continue;
      const log = p.log || [];
      const line = mainLine(g, pid);
      const status = statusOf(p.team, pid);
      const mins = avg(log.map((r) => r[f.min] || 0));
      if (line === null && (!LIST.every || !log.length || mins < ROTATION_MIN || isOut(status))) continue;
      const opp = p.team === g.home ? g.away : g.home;
      const vals = log.map((r) => statOf(r, f));
      const last5 = log.slice(-5);
      out.push({
        g, pid, p, team: p.team, opp, home: p.team === g.home, line, status, live: started(g), gp: log.length,
        avg: avg(vals), avg5: avg(last5.map((r) => statOf(r, f))), min: mins, min5: avg(last5.map((r) => r[f.min] || 0)),
        hits: { l5: hits(last5, line, f), l10: hits(log.slice(-10), line, f), all: hits(log, line, f),
          home: hits(log.filter((r) => r[f.home]), line, f), away: hits(log.filter((r) => !r[f.home]), line, f) },
        allow: ((A.per[p.pos] || {})[opp]) || null, allowRank: ((A.ranks[p.pos] || { r: {} }).r[opp]) || null,
        allowN: (A.ranks[p.pos] || {}).n || 0, allowLeague: (A.ranks[p.pos] || {}).league,
        without: withoutRows(pid, p.team),
      });
    }
  }
  return out;
}
const hitShare = (h) => (h ? h.over / h.of : -1);
const SORTS = {
  line: (x) => (x.line === null ? -1 : x.line), avg: (x) => x.avg ?? -1, min: (x) => x.min ?? -1,
  l5: (x) => hitShare(x.hits.l5), l10: (x) => hitShare(x.hits.l10), all: (x) => hitShare(x.hits.all),
  home: (x) => hitShare(x.hits.home), away: (x) => hitShare(x.hits.away), allow: (x) => (x.allowRank ? -x.allowRank : -99),
};
function sortedRows(date) {
  const key = SORTS[LIST.sort] || SORTS.line;
  // started games at the bottom; a player with no line after the ones with one
  return rowsOn(date).sort((a, b) => a.live - b.live || (a.line === null) - (b.line === null) || LIST.dir * (key(a) - key(b)) || (b.min || 0) - (a.min || 0));
}

// ---- the table ----
const COLS = [
  { label: "Player", cls: "sim-th-player" },
  { label: "Line", key: "line", title: "His main line: the middle of the books' lines" },
  { label: "Over", title: "The best Over price across your books (click for every book; the box saves it to My Plays)" },
  { label: "Under", title: "The best Under price across your books (click for every book; the box saves it to My Plays)" },
  { label: "Avg", key: "avg", title: `His ${MK.unit.toLowerCase()} a game this season, his last 5 under it` },
  { label: "Min", key: "min", title: "His minutes a game this season, his last 5 under it" },
  { label: "L5", key: "l5", hit: true, title: "His last 5 games over tonight's line" },
  { label: "L10", key: "l10", hit: true, title: "His last 10 games over tonight's line" },
  { label: "Season", key: "all", hit: true, title: "This season's games over tonight's line" },
  { label: "Home", key: "home", hit: true, title: "Home games over tonight's line" },
  { label: "Away", key: "away", hit: true, title: "Road games over tonight's line" },
  { label: "Opp Allows", key: "allow", title: `What tonight's opponent allows a game in ${MK.unit.toLowerCase()} to his position, and where that ranks (1st = the most)` },
  { label: "Teammates On The Report", cls: "sim-th-tags", title: "His numbers in the games each teammate on tonight's injury report missed (20+ minute players). No = Out or Doubtful, If No = Day-To-Day or Questionable. The number in brackets is the change from his games with that teammate." },
];
function listHead() {
  let group = "";
  for (let i = 0; i < COLS.length; i += 1) {
    if (COLS[i].hit) {
      let n = 0;
      while (COLS[i + n] && COLS[i + n].hit) n += 1;
      group += `<th colspan="${n}" class="sim-hitgroup" title="How often he went OVER tonight's line"><span>Hit Rate - Over Tonight's Line</span></th>`;
      i += n - 1;
    } else group += "<th></th>";
  }
  return `<thead><tr class="sim-group-row">${group}</tr><tr>${COLS.map((c) => {
    const on = c.key && c.key === LIST.sort;
    const cls = [c.key ? "sim-sort" : "", on ? "on" : "", c.cls || "", c.hit ? "sim-hit-th" : ""].filter(Boolean).join(" ");
    return `<th${cls ? ` class="${cls}"` : ""}${c.key ? ` data-sort="${c.key}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${on ? `<span class="sim-arrow">${LIST.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("")}</tr></thead>`;
}
// Every hit rate colored by its percentage: red at 20% or less, yellow at 50%, green at 80% or more.
function hitCell(h, title) {
  if (!h) return '<td class="num sim-hit">--</td>';
  const share = h.over / h.of;
  const hue = Math.round(Math.max(0, Math.min(1, (share - 0.2) / 0.6)) * 135);
  const style = ` style="background:${scaleHsla(hue, 78, 44, 0.24 + Math.min(0.3, Math.abs(share - 0.5)) * 1.1)}"`;
  return `<td class="num sim-hit"${style} title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}
function allowCell(x) {
  if (!x.allow) return '<td class="num rs-allow">--</td>';
  const tip = `${team(x.opp).name} allow ${fmt(x.allow.v)} ${MK.unit.toLowerCase()} a game to ${x.p.pos}s (league ${fmt(x.allowLeague)}), ${ordinal(x.allowRank)} most of ${x.allowN}, over ${x.allow.n} games`;
  return `<td class="num rs-allow" style="${rankStyle(x.allowRank, x.allowN)}" title="${tip}"><b>${fmt(x.allow.v)}</b><small>${ordinal(x.allowRank)} &middot; ${x.p.pos}</small></td>`;
}
function row(x) {
  const two = (a, b, tip) => `<td class="num rs-two" title="${tip}"><b>${fmt(a)}</b><small>L5 ${fmt(b)}</small></td>`;
  const key = `${x.g.game_id}:${x.pid}`;
  return `<tr class="sim-row${x.live ? " live" : ""}${PANEL ? " rs-click" : ""}${OPEN === key ? " open" : ""}" data-open="${key}">
    <td class="sim-plcell"><span class="sim-pl-in">${headshot(x.pid)}${playerClick(x.pid, `<b>${nameOf(x.pid)}</b>`)}<span class="muted-label">${x.p.pos || ""}</span>${statusPill(x.status)}<span class="sim-vs">${logo(x.team, 16)}<span>${x.home ? "vs" : "@"}</span>${logo(x.opp, 16)}</span></span></td>
    <td class="num rs-line">${x.line === null ? '<span class="muted-label">No Line</span>' : `<b>${fmt(x.line)}</b>`}</td>
    ${sideCell(x.g, x.pid, "o", x.line, x.team)}${sideCell(x.g, x.pid, "u", x.line, x.team)}
    ${two(x.avg, x.avg5, `${fmt(x.avg)} a game in ${x.gp} games, ${fmt(x.avg5)} in his last ${Math.min(5, x.gp)}`)}
    ${two(x.min, x.min5, `${fmt(x.min)} minutes a game, ${fmt(x.min5)} in his last ${Math.min(5, x.gp)}`)}
    ${hitCell(x.hits.l5, "Last 5 games over tonight's line")}${hitCell(x.hits.l10, "Last 10 games over tonight's line")}${hitCell(x.hits.all, "This season's games over tonight's line")}${hitCell(x.hits.home, "Home games over tonight's line")}${hitCell(x.hits.away, "Road games over tonight's line")}
    ${allowCell(x)}
    <td class="sim-tagc"><div class="sim-rtags">${x.without.map(withoutPill).join("") || '<span class="muted-label">None</span>'}</div></td>
  </tr>`;
}
// ---- the research panel (the owner, 2026-11-03: "Think of this like a dashboard. You are someone
// who has 1-2 minutes to look at a player and get an idea about a line. Present the info in a way
// that is digestable, compact, color coded and give context") ----
// Built from the League Stats Chart's own pieces (style.css .od-grid / .od-ggroups / .od-glabels /
// .od-tile and the 8-step rank colors), so it reads like the rest of the site: colored group bands
// over compact columns, every number a filled tile. Green = toward more points, red = toward fewer.
// Real counts only. Tiles: Rotation (top), Points Vs The Line, Recent Form, How He Scores,
// Teammates On The Floor, Matchup Angles, Tonight's Game Script.
const RS = () => PROPS.research || { players: {}, teams: {}, games: {}, spots: {} };
const rsOf = (pid) => RS().players[pid] || {};
const RSV = { rank: false }; // Matchup Angles: Allowed / Rank toggle
const SCRIPT_RANGE = 5; // Game Script: his games within this many points of tonight's spread / total, either way (two possessions)
const PACE_RANGE = 2; // ... and within this many possessions of tonight's pace
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// a signed strength (-1..1) on the 8-step scale: +1 = greenest, -1 = reddest, null = an uncolored tile
const stepStyle = (s) => (s === null || s === undefined || Number.isNaN(s) ? "" : rankStyle(1 + Math.round(((1 - clamp1(s)) / 2) * 7), 8));
const per36 = (n, m) => (m ? (n / m) * 36 : null);
const shortName = (name) => { const parts = String(name || "").split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : String(name || ""); };
const face = (id, big = false) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="rs-face${big ? " big" : ""}" loading="lazy" onerror="this.style.visibility='hidden'">`;
const gameDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
const tileTd = (text, s, tip = "", sub = "") => `<td><div class="od-tile" style="${stepStyle(s)}" title="${tip}"><b>${text}</b>${sub ? `<small>${sub}</small>` : ""}</div></td>`;
const tile = (title, tip, body, head = "", cls = "") => `<section class="rs-tile${cls ? ` ${cls}` : ""}"><h4><span title="${tip}">${title}</span><span class="rs-i" title="${tip}">i</span>${head}</h4><div class="rs-body">${body}</div></section>`;

// One League-Stats-Chart grid: a colored band over each group of columns, a label row, tile cells.
// groups: [band label, od-g class, [column labels], column width]; rows: [label html, [td html], row class].
function grid(groups, rows, labelW, corner = "") {
  const L = labelW > 0; // no label column at 0
  const gap = (tag) => `<${tag} class="od-ggap"></${tag}>`;
  const cls = (g, i, n) => `${g} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const width = labelW + groups.reduce((a, [, , cols, w]) => a + cols.length * w, 0) + (groups.length - 1) * 6;
  const colgroup = `<colgroup>${L ? `<col style="width:${labelW}px">` : ""}${groups.map(([, , cols, w], gi) => `${gi ? '<col class="od-ggap-col">' : ""}${cols.map(() => `<col style="width:${w}px">`).join("")}`).join("")}</colgroup>`;
  // a one-column group is ONE header (its band, no label under it); with no wider group there's no label row at all
  const labels = groups.some(([, , cols]) => cols.length > 1);
  const span = labels ? ' rowspan="2"' : "";
  const head = `<tr class="od-ggroups">${L ? `<th class="rs-corner"${span}>${corner}</th>` : ""}${groups.map(([name, g, cols], gi) => `${gi ? `<th class="od-ggap"${span}></th>` : ""}${cols.length > 1
    ? `<th class="${g}" colspan="${cols.length}">${name}</th>` : `<th class="${g} rs-one"${span}>${name}</th>`}`).join("")}</tr>`
    + (labels ? `<tr class="od-glabels">${groups.map(([, g, cols]) => (cols.length > 1 ? cols.map((c, i) => `<th class="${cls(g, i, cols.length)}">${c}</th>`).join("") : "")).join("")}</tr>` : "");
  const body = rows.map(([label, cells, rowCls]) => {
    let k = 0;
    return `<tr${rowCls ? ` class="${rowCls}"` : ""}>${L ? `<td class="od-label rs-glabel">${label}</td>` : ""}${groups.map(([, g, cols], gi) => `${gi ? gap("td") : ""}${cols.map((c, i) => (cells[k++] || "<td></td>").replace("<td", `<td class="${cls(g, i, cols.length)}"`)).join("")}`).join("")}</tr>`;
  }).join("");
  return `<table class="data-table od-grid rs-grid" style="width:${width}px">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// Rotation players at one position (12+ minutes, 3+ games): the pool a number is ranked in.
function posPool(pos) {
  const f = logFields();
  return Object.entries(seasonBlock().players).filter(([, p]) => p.pos === pos && (p.log || []).length >= 3
    && avg(p.log.map((r) => r[f.min] || 0)) >= ROTATION_MIN);
}
// where a value sits in a pool, as -1..1 (+1 = the most)
function spread(v, pool) {
  const xs = pool.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v === null || v === undefined || xs.length < 5) return null;
  return ((xs.filter((x) => x < v).length + 0.5 * xs.filter((x) => x === v).length) / xs.length) * 2 - 1;
}
const rankIn = (v, pool) => { const xs = pool.filter((q) => q !== null && q !== undefined); return v === null || v === undefined ? null : { r: xs.filter((q) => q > v).length + 1, n: xs.length }; };
const rankSigned = (rank, n) => (rank && n > 1 ? 1 - ((rank - 1) / (n - 1)) * 2 : null); // 1st = +1, last = -1
// What a defense allowed one position in a number, a game, over its last n games (n = 0: season).
function allowedRecent(opp, pos, stat, n) {
  const f = logFields();
  const byGame = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (p.pos !== pos) continue;
    for (const r of p.log || []) {
      if (r[f.opp] !== opp) continue;
      const g = (byGame[r[f.game]] = byGame[r[f.game]] || { d: r[f.date], v: 0 });
      g.v += stat(r, f) || 0;
    }
  }
  const games = Object.values(byGame).sort((a, b) => (a.d < b.d ? -1 : 1));
  const use = n ? games.slice(-n) : games;
  return use.length ? { v: avg(use.map((g) => g.v)), n: use.length } : null;
}
function teamRanks(valueOf) {
  const s = Object.keys(DATA.teams || {}).map((t) => [t, valueOf(t)]).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => b[1] - a[1]);
  return { n: s.length, r: Object.fromEntries(s.map(([t], i) => [t, i + 1])), v: Object.fromEntries(s) };
}
// What each defense allowed one position: per team, its games in date order with the position's
// points, shots, free throws and makes (one pass over every log, kept per position), season and last
// 5, each ranked of 30 (1st = allows the most).
const DEF_POS = {};
function defenseByPos(pos) {
  if (DEF_POS[pos]) return DEF_POS[pos];
  const f = logFields();
  const byTeam = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (p.pos !== pos) continue;
    for (const r of p.log || []) {
      const t = r[f.opp];
      if (!t) continue;
      const g = ((byTeam[t] = byTeam[t] || {})[r[f.game]] = byTeam[t][r[f.game]] || { d: r[f.date], pts: 0, fga: 0, fta: 0, fgm: 0 });
      g.pts += r[f.pts] || 0;
      g.fga += r[f.fga] || 0;
      g.fta += r[f.fta] || 0;
      g.fgm += r[f.fgm] || 0;
    }
  }
  const total = (gs, k) => gs.reduce((a, g) => a + g[k], 0);
  const agg = (gs) => (gs.length ? { pts: total(gs, "pts") / gs.length, fga: total(gs, "fga") / gs.length, fta: total(gs, "fta") / gs.length,
    fgp: total(gs, "fga") ? (total(gs, "fgm") / total(gs, "fga")) * 100 : null, n: gs.length } : null);
  const teams = {};
  for (const [t, games] of Object.entries(byTeam)) {
    const gs = Object.values(games).sort((a, b) => (a.d < b.d ? -1 : 1));
    teams[t] = { season: agg(gs), l5: agg(gs.slice(-5)) };
  }
  const ranks = {};
  for (const w of ["season", "l5"]) {
    ranks[w] = {};
    for (const k of ["pts", "fga", "fta", "fgp"]) {
      const sorted = Object.keys(teams).filter((t) => teams[t][w] && teams[t][w][k] !== null).sort((a, b) => teams[b][w][k] - teams[a][w][k]);
      ranks[w][k] = { n: sorted.length, r: Object.fromEntries(sorted.map((t, i) => [t, i + 1])) };
    }
  }
  DEF_POS[pos] = { teams, ranks };
  return DEF_POS[pos];
}
const identityTeams = () => ((((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {}).teams) || {};

// 1. Rotation: when he's on the floor, minute by minute (green = on the floor in most of his games),
// his points by quarter, and his 4th-quarter minutes in close games vs not.
function rotationTile(x) {
  const r = rsOf(x.pid);
  if (!r.rot || !r.rotn || !r.rotn[0]) return tile("Rotation", "When he's on the floor", '<p class="rs-none">No rotation data yet.</p>');
  const QN = ["1st", "2nd", "3rd", "4th"];
  const strip = (counts, n, label) => `<div class="rs-rot-row"><span class="rs-rot-l">${label}</span><div class="rs-rot">${counts.map((c, m) =>
    `<i class="${m % 12 === 0 && m ? "q" : ""}" style="${c ? stepStyle((c / n) * 2 - 1) : ""}" title="Minute ${m + 1} (${QN[Math.floor(m / 12)]} quarter): on the floor in ${c} of ${n} games"></i>`).join("")}</div></div>`;
  const qLabels = `<div class="rs-rot-row"><span class="rs-rot-l"></span><div class="rs-rot-q">${QN.map((q) => `<span>${q} Qtr</span>`).join("")}</div></div>`;
  const games = r.rotn[0];
  const qs = (r.q || [0, 0, 0, 0]).map((v) => v / games);
  const qTotal = qs.reduce((a, b) => a + b, 0);
  const q4 = r.q4 || [0, 0, 0, 0];
  const close = q4[0] ? q4[1] / q4[0] : null, open = q4[2] ? q4[3] / q4[2] : null;
  const side = grid([["Points A Game By Quarter", "od-g1", ["Q1", "Q2", "Q3", "Q4"], 54], ["4th-Quarter Minutes", "od-g2", ["Close", "Not Close"], 72]],
    [["", [...qs.map((v, i) => tileTd(fmt(v), qTotal ? (v / qTotal - 0.25) / 0.08 : null, `${fmt(v)} points a game in the ${QN[i]} quarter (${qTotal ? Math.round((v / qTotal) * 100) : 0}% of his points)`)),
      tileTd(fmt(close), close === null || open === null ? null : (close - open) / 5, "Games within 10 entering the 4th: his 4th-quarter minutes a game", `${q4[0]} G`),
      tileTd(fmt(open), close === null || open === null ? null : (open - close) / 5, "Games NOT within 10 entering the 4th: his 4th-quarter minutes a game (red = he sits when it's not close)", `${q4[2]} G`)]]], 0);
  return tile("Rotation", `When he's on the floor at each minute of the game: green = on the floor in most of his games, red = rarely (season and last ${r.rotn[1]}). Points a game by quarter (green = a bigger share of his points), and his 4th-quarter minutes when the game is within 10 entering the 4th vs not.`,
    `<div class="rs-rot-wrap"><div class="rs-rot-strips">${strip(r.rot, games, "Season")}${strip(r.rot5, r.rotn[1], `Last ${r.rotn[1]}`)}${qLabels}</div>${side}</div>`, "", "rs-grow");
}

// 2. Points Vs The Line: his last games as bars against tonight's line, and the line he had that
// night as a second line (a dot a game: green = he cleared it, red = he didn't).
function chartTile(x) {
  const f = logFields();
  const log = logOf(x.pid).slice(-15);
  const lines = rsOf(x.pid).lines || {};
  if (!log.length) return tile("Points Vs The Line", "His points in each game this season", '<p class="rs-none">No games yet.</p>', "", "rs-fixed");
  const line = x.line;
  const bw = log.length <= 8 ? 46 : log.length <= 12 ? 38 : 32;
  const W = log.length * bw, H = 212, top = 22, base = 176;
  const then = log.map((r) => lines[String(r[f.game])] ?? null);
  const max = Math.max(10, line || 0, ...then.filter((v) => v !== null), ...log.map((r) => r[f.pts] || 0)) * 1.08;
  const y = (v) => base - (v / max) * (base - top);
  const bars = log.map((r, i) => {
    const v = r[f.pts] || 0;
    const cls = line === null ? "" : v > line ? " over" : " under";
    const tip = `${gameDate(r[f.date])} ${r[f.home] ? "vs" : "@"} ${r[f.opp]}: ${v} pts in ${r[f.min]} min, ${r[f.fga]} shots${then[i] !== null ? `; his line was ${fmt(then[i])} (${v > then[i] ? "cleared" : "missed"})` : ""}`;
    const cx = i * bw + bw / 2;
    const inside = base - y(v) >= 18;
    return `<g><title>${tip}</title><rect class="rs-bar${cls}" x="${i * bw}" y="${y(v).toFixed(1)}" width="${bw}" height="${(base - y(v)).toFixed(1)}"></rect>`
      + `<text class="rs-bar-v${inside ? " in" : ""}" x="${cx}" y="${(inside ? y(v) + 14 : y(v) - 4).toFixed(1)}">${v}</text>`
      + `<text class="rs-bar-l" x="${cx}" y="${base + 14}">${r[f.opp]}</text><text class="rs-bar-l rs-bar-d" x="${cx}" y="${base + 27}">${gameDate(r[f.date])}</text></g>`;
  }).join("");
  // his line each night: a line through the nights that have one, a labeled dot on each
  const pts = then.map((v, i) => (v === null ? null : [i * bw + bw / 2, y(v), v, (log[i][f.pts] || 0) > v]));
  let path = "";
  pts.forEach((p, i) => { if (p) path += `${path && pts[i - 1] ? "L" : "M"}${p[0]},${p[1].toFixed(1)}`; });
  const dots = pts.filter(Boolean).map(([cx, cy, v, hit]) => `<circle class="rs-then-dot${hit ? " hit" : ""}" cx="${cx}" cy="${cy.toFixed(1)}" r="4.5"></circle><text class="rs-then-t" x="${cx}" y="${(cy - 8).toFixed(1)}">${fmt(v)}</text>`).join("");
  const lineMark = line === null ? "" : `<line class="rs-tonight" x1="0" x2="${W}" y1="${y(line).toFixed(1)}" y2="${y(line).toFixed(1)}"></line>`;
  const svg = `<svg class="rs-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bars}${lineMark}${path ? `<path class="rs-then" d="${path}"></path>` : ""}${dots}</svg>`;
  const vals = log.map((r) => r[f.pts] || 0);
  const overs = line === null ? [] : vals.filter((v) => v > line), unders = line === null ? [] : vals.filter((v) => v < line);
  const had = pts.filter(Boolean);
  const cleared = had.filter((p) => p[3]).length;
  const cells = line === null ? [] : [
    tileTd(`${overs.length} of ${vals.length}`, (overs.length / vals.length) * 2 - 1, "Games over tonight's line"),
    tileTd(overs.length ? `+${fmt(avg(overs.map((v) => v - line)))}` : "--", overs.length ? avg(overs.map((v) => v - line)) / (line * 0.25) : null, "When he went over tonight's line, by how much on average"),
    tileTd(unders.length ? `&minus;${fmt(avg(unders.map((v) => line - v)))}` : "--", unders.length ? -avg(unders.map((v) => line - v)) / (line * 0.25) : null, "When he went under tonight's line, by how much on average"),
    tileTd(`${had.length ? `${cleared} of ${had.length}` : "--"}`, had.length >= SMALL ? (cleared / had.length) * 2 - 1 : null, "Nights he cleared the line he had THAT night (the dots)"),
  ];
  const foot = line === null ? "" : grid([[`Last ${vals.length} Vs Tonight's ${fmt(line)}`, "od-g1", ["Over", "Over By", "Under By"], 64], ["His Line That Night", "od-g2", ["Cleared"], 76]], [["", cells]], 0);
  const legend = `<div class="rs-legend"><span><i class="rs-k-tonight"></i>Tonight's Line</span><span><i class="rs-k-then"></i>His Line That Night</span></div>`;
  return tile("Points Vs The Line", `His last ${log.length} games, oldest left. Bars: green = over tonight's line (dashed), red = under. The dots are the line the books had him at THAT night: green = he cleared it, red = he didn't. Hover a bar for the game.`,
    `${svg}${legend}${foot}`, "", "rs-fixed");
}

// 3. Recent Form: his last 5 against his season (did the points come from more shots or hot
// shooting?) and what tonight's defense has allowed his position lately.
function formTile(x) {
  const f = logFields();
  const log = logOf(x.pid);
  const l5 = log.slice(-5);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[f[k]] || 0), 0);
  const per = (rows, k) => (rows.length ? sum(rows, k) / rows.length : null);
  const fgp = (rows) => (sum(rows, "fga") ? (sum(rows, "fgm") / sum(rows, "fga")) * 100 : null);
  const pool = posPool(x.p.pos);
  const D = defenseByPos(x.p.pos);
  const opp = D.teams[x.opp] || {};
  // Season / L5 / +/- for one number; every tile colored (his Season against the league's position,
  // the defense's against the 30 teams)
  const three = (s, r, d, big, sColor, rColor, tip) => {
    const ch = s === null || s === undefined || r === null || r === undefined ? null : r - s;
    const rel = ch === null || !s ? null : ch / s / big;
    return [tileTd(fmt(s, d), sColor, tip), tileTd(fmt(r, d), rColor === undefined ? rel : rColor, tip), tileTd(ch === null ? "--" : signed(ch, d), rel, tip)];
  };
  const mine = (getter, d, big, tip) => {
    const s = getter(log), r = getter(l5);
    return three(s, r, d, big, spread(s, pool.map(([, q]) => getter(q.log || []))), undefined, `${tip} (Season colored against the league's ${x.p.pos}s)`);
  };
  const blank = ["<td></td>", "<td></td>", "<td></td>"];
  const theirs = (k, d, big, what) => {
    if (!opp.season) return blank;
    const rk = (w) => rankSigned(D.ranks[w][k].r[x.opp], D.ranks[w][k].n);
    return three(opp.season[k], opp.l5 ? opp.l5[k] : null, d, big, rk("season"), opp.l5 ? rk("l5") : null,
      `${team(x.opp).name} allow ${x.p.pos}s ${what}: season ${ordinal(D.ranks.season[k].r[x.opp])} most of ${D.ranks.season[k].n}, last ${opp.l5 ? opp.l5.n : 0} games ${opp.l5 ? ordinal(D.ranks.l5[k].r[x.opp]) : "--"} most`);
  };
  const rows = [
    ["Points", [...mine((q) => per(q, "pts"), 1, 0.15, "His points a game"), ...theirs("pts", 1, 0.15, "points a game")]],
    ["Minutes", [...mine((q) => per(q, "min"), 1, 0.1, "His minutes a game"), ...blank]],
    ["Shots", [...mine((q) => per(q, "fga"), 1, 0.15, "His field goals tried a game"), ...theirs("fga", 1, 0.15, "shots a game")]],
    ["Free Throws", [...mine((q) => per(q, "fta"), 1, 0.3, "His free throws tried a game"), ...theirs("fta", 1, 0.3, "free throws a game")]],
    ["FG %", [...mine(fgp, 0, 0.12, "His field goal percentage"), ...theirs("fgp", 0, 0.12, "a field goal %")]],
  ];
  const table = grid([["Him", "od-g1", ["Season", "L5", "+/-"], 58], [`${logo(x.opp, 18)} DEF Vs ${x.p.pos}s`, "od-g2", ["Season", "L5", "+/-"], 58]], rows, 96);
  // where a points swing came from: more / fewer shots tends to hold, hot / cold shooting tends to even out
  const pills = [];
  const ptsCh = per(l5, "pts") - per(log, "pts");
  if (l5.length >= 3 && Math.abs(ptsCh) >= 2) {
    const ppShot = sum(log, "pts") / Math.max(1, sum(log, "fga"));
    const volume = (per(l5, "fga") - per(log, "fga")) * ppShot + (per(l5, "fta") - per(log, "fta")) * 0.8;
    const shooting = ptsCh - volume;
    const up = ptsCh > 0;
    const fromVolume = Math.sign(volume) === Math.sign(ptsCh) && Math.abs(volume) >= Math.abs(shooting);
    pills.push(`<span class="od-tile rs-pill" style="${fromVolume ? stepStyle(up ? 1 : -1) : stepStyle(0)}" title="His last 5 are ${signed(ptsCh)} points a game from his season: about ${signed(volume)} from more or fewer shots and free throws, ${signed(shooting)} from making more or fewer. A change in shots tends to hold; a hot or cold shooting run tends to even out."><b>${up ? "Up" : "Down"}: ${fromVolume ? (up ? "More Shots" : "Fewer Shots") : (up ? "Hot Shooting" : "Cold Shooting")}</b></span>`);
  }
  pills.push(`<span class="od-tile rs-pill" title="Games he started of his last 5"><b>Started ${sum(l5, "start")} Of ${l5.length}</b></span>`);
  const blow = log.filter((r) => r[f.score] !== null && r[f.opp_score] !== null && r[f.score] !== undefined && Math.abs(r[f.score] - r[f.opp_score]) >= 20);
  if (blow.length) {
    const rest = log.filter((r) => !blow.includes(r));
    const lost = per(rest, "min") - per(blow, "min");
    pills.push(`<span class="od-tile rs-pill" style="${lost >= 3 ? stepStyle(-0.7) : ""}" title="Games decided by 20+ points: ${fmt(per(blow, "min"), 0)} minutes in them, ${fmt(per(rest, "min"), 0)} in his other games"><b>Blowouts: ${fmt(per(blow, "min"), 0)} Min (${blow.length} G)</b></span>`);
  }
  return tile("Recent Form", `His last 5 games against his season (his Season colored against the league's ${x.p.pos}s; L5 and +/- green / red = well above / below his season), beside what ${team(x.opp).name} allow ${x.p.pos}s: season and their last 5 games, each colored by where it ranks of 30 (green = allows the most).`,
    `${table}<div class="rs-pills">${pills.join("")}</div>`);
}

// A stacked bar with each part's name and share written inside it; parts too thin for their text
// get a small key under the bar (and every part a hover).
function stackBar(parts, title = "") {
  const total = parts.reduce((a, q) => a + (q.v || 0), 0);
  if (!total) return "";
  const segs = parts.map((q) => ({ ...q, share: (q.v || 0) / total }));
  const text = (q) => (q.short ? (q.share >= 0.07 ? `${q.short} ${Math.round(q.share * 100)}%` : "") : q.share >= 0.2 ? `${q.label} ${Math.round(q.share * 100)}%` : q.share >= 0.08 ? `${Math.round(q.share * 100)}%` : "");
  const bar = `<div class="rs-stack${parts.some((q) => q.style) ? " rs-scaled" : ""}" title="${title}">${segs.map((q) => (q.share ? `<span class="${q.cls || ""}" style="width:${(q.share * 100).toFixed(1)}%;${q.style || ""}" title="${q.label}: ${Math.round(q.share * 100)}%${q.tip ? ` (${q.tip})` : ""}">${text(q)}</span>` : "")).join("")}</div>`;
  const thin = segs.filter((q) => q.share && !q.short && q.share < 0.2);
  return bar + (thin.length ? `<div class="rs-stack-key">${thin.map((q) => `<span><i class="${q.cls}"></i>${q.label} ${Math.round(q.share * 100)}%</span>`).join("")}</div>` : "");
}
// What every defense allowed one position, as shares (props.json research.defpos / deffga), with
// each share's rank of 30 (1st = allows the most).
function defShares(pos) {
  const D = RS().defpos || {}, F = RS().deffga || {};
  const teams = {};
  for (const [t, byPos] of Object.entries(D)) {
    const v = byPos[pos];
    if (!v) continue;
    const [th, mid, paint, ft, makes, ast, trans, pts, fga] = v;
    teams[t] = { shot: F[t] ? fga / F[t] : null, assisted: makes ? ast / makes : null, ft: pts ? ft / pts : null, trans: pts ? trans / pts : null,
      z: pts ? [th / pts, mid / pts, paint / pts, ft / pts] : null, pts: [th, mid, paint, ft] };
  }
  const rankOf = (get) => { const xs = Object.keys(teams).filter((t) => get(teams[t]) !== null && get(teams[t]) !== undefined).sort((a, b) => get(teams[b]) - get(teams[a])); return { n: xs.length, r: Object.fromEntries(xs.map((t, i) => [t, i + 1])) }; };
  return { teams, rankOf };
}
const ZONES_PTS = [["Threes", "3PT"], ["Mid-Range", "MID"], ["Paint", "PAINT"], ["Free Throws", "FT"]];

// 4. How He Scores: how his shots come and where his points come from, his side ranked among his
// position (1st = the most = green) beside what tonight's defense allows his position (ranked of 30).
function scoreTile(x) {
  const f = logFields();
  const p = playerOf(x.pid) || {};
  const pool = posPool(x.p.pos);
  const kinds = p.kinds || {};
  const shotBar = stackBar([["self", "Self-Created", "rs-k1", "pull-ups, step-backs and fades"], ["catch", "Catch & Shoot", "rs-k2", "off a pass"], ["drive", "Drives & Cuts", "rs-k3", "drives, cuts, floaters, lobs, putbacks"], ["other", "Post / Other", "rs-k4", ""]]
    .map(([k, label, cls, tip]) => ({ v: kinds[k] || 0, label, cls, tip })), "How his shots come: each shot is one type, so they add to 100%");
  const sum = (rows, k) => rows.reduce((a, q) => a + (q[f[k]] || 0), 0);
  const ftShare = (rows) => { const pts = sum(rows, "pts"); return pts ? sum(rows, "ftm") / pts : null; };
  const transShare = (pid) => { const t = rsOf(pid).trans; return t && t[1] ? t[0] / t[1] : null; };
  const DS = defShares(x.p.pos);
  const opp = DS.teams[x.opp] || {};
  const pctT = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
  const metric = (label, v, vals, key, tip, dtip) => {
    const rk = rankIn(v, vals), s = spread(v, vals);
    const dr = DS.rankOf((t) => t[key]);
    const ds = rankSigned(dr.r[x.opp], dr.n);
    return [`<span title="${tip}">${label}</span>`, [tileTd(pctT(v), s, tip), tileTd(rk ? ordinal(rk.r) : "--", s, tip, rk ? `of ${rk.n}` : ""),
      tileTd(pctT(opp[key]), ds, `${team(x.opp).name}: ${dtip}`), tileTd(dr.r[x.opp] ? ordinal(dr.r[x.opp]) : "--", ds, `${team(x.opp).name}: ${dtip}`, dr.n ? `of ${dr.n}` : "")]];
  };
  const rows = [
    metric("Shot Share", p.share ?? null, pool.map(([, q]) => q.share ?? null), "shot", "His share of his team's shots while he's on the floor", `share of their opponents' shots taken by ${x.p.pos}s`),
    metric("Assisted Makes", p.assisted ?? null, pool.map(([, q]) => q.assisted ?? null), "assisted", "Share of his made shots a teammate assisted", `share of ${x.p.pos}s' made shots against them that were assisted`),
    metric("Pts From The Line", ftShare(logOf(x.pid)), pool.map(([, q]) => ftShare(q.log || [])), "ft", "Share of his points from free throws", `share of ${x.p.pos}s' points against them from free throws`),
    metric("Transition Pts", transShare(x.pid), pool.map(([id]) => transShare(id)), "trans", "Share of his points on fast breaks: off a miss or a steal, a shot inside 8 seconds", `share of ${x.p.pos}s' points against them on fast breaks`),
  ];
  const groups = [["Him", "od-g1", ["Share", "Rank"], 62], [`${logo(x.opp, 18)} DEF Vs ${x.p.pos}s`, "od-g2", ["Allowed", "Rank"], 62]];
  const shares = grid(groups, rows, 120);

  // where his points come from: threes, mid-range, the paint (rim + short), free throws
  const pz = rsOf(x.pid).pz;
  const games = (rsOf(x.pid).rotn || [logOf(x.pid).length])[0] || 1;
  let breakdown = "";
  if (pz && pz.reduce((a, b) => a + b, 0)) {
    const tot = pz.reduce((a, b) => a + b, 0);
    const mine = pz.map((v) => v / tot);
    const zr = ZONES_PTS.map((_, i) => DS.rankOf((t) => (t.z ? t.z[i] : null)));
    const dz = opp.z || [null, null, null, null];
    // his share in each against his position's
    const poolZ = ZONES_PTS.map((_, i) => pool.map(([id]) => { const q = rsOf(id).pz; const t = q ? q.reduce((a, b) => a + b, 0) : 0; return t ? q[i] / t : null; }));
    // two bars, his and the defense's against his position, in the same order; each part on the
    // 8-step scale (his: his share against his position's, green = more of his points from there;
    // the defense's: its rank of 30, green = allows the most), its short name always inside
    const part = (i, v, sc, tip) => ({ v, label: ZONES_PTS[i][0], short: ZONES_PTS[i][1], style: stepStyle(sc), tip });
    const him = stackBar(ZONES_PTS.map((_, i) => part(i, pz[i], spread(mine[i], poolZ[i]), `${fmt(pz[i] / games)} points a game; ${rankIn(mine[i], poolZ[i]) ? ordinal(rankIn(mine[i], poolZ[i]).r) : "--"} most of his position`)));
    const def = opp.pts ? stackBar(ZONES_PTS.map((_, i) => part(i, opp.pts[i], rankSigned(zr[i].r[x.opp], zr[i].n), `${team(x.opp).name} allow ${x.p.pos}s ${pctT(dz[i])}; ${zr[i].r[x.opp] ? ordinal(zr[i].r[x.opp]) : "--"} most of ${zr[i].n}`))) : '<span class="rs-none">No games yet.</span>';
    breakdown = `<div class="rs-sub-h" title="Threes, mid-range, the paint (at the rim and short shots) and free throws, as shares of his points and of the points ${team(x.opp).name} allow ${x.p.pos}s">Where His Points Come From</div>`
      + `<div class="rs-bar-row"><span class="rs-bar-name">Him</span>${him}</div><div class="rs-bar-row"><span class="rs-bar-name">${logo(x.opp, 16)} DEF</span>${def}</div>`;
  }
  return tile("How He Scores", `How his shots come (each shot is one type, so they add to 100%: Self-Created = pull-ups, step-backs and fades; a drive to the rim counts as Drives & Cuts). Then his shares, ranked among this season's rotation ${x.p.pos}s (1st = the most), beside what ${team(x.opp).name} allow ${x.p.pos}s (ranked of 30, 1st = the most). Then where his points come from: threes, mid-range, the paint (at the rim and short shots) and free throws.`,
    `${shotBar}${shares}${breakdown}`);
}

// 5. Teammates On The Floor: his scoring with each teammate on the floor and off it, how often they
// share the floor, and the teammate's assists on his makes.
function mateTile(x) {
  const p = playerOf(x.pid) || {};
  const feed = Object.fromEntries((rsOf(x.pid).feed || [0, []])[1]);
  const makes = (rsOf(x.pid).feed || [0])[0];
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team)
    .sort((a, b) => b[1][0] - a[1][0]).slice(0, 7);
  if (!mates.length) return tile("Teammates On The Floor", "His scoring with each teammate on the floor and off it", '<p class="rs-none">Not enough minutes together yet.</p>');
  // his usual rate, all his minutes: With and Without are each colored against it (both sides of a
  // pair always get a color, styles.md "One Look")
  const all = mates.length ? mates[0][1] : [0, 0, 0, 0, 0, 0];
  const usualPts = per36(all[1] + all[4], all[0] + all[3]), usualShots = per36(all[2] + all[5], all[0] + all[3]);
  const vsUsual = (v, usual, k) => (v === null || usual === null ? null : (v - usual) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, pOn, fOn, mOff, pOff, fOff] = w;
    const together = mOn / (mOn + mOff);
    const on = per36(pOn, mOn), off = mOff >= 20 ? per36(pOff, mOff) : null;
    const diff = off === null ? null : off - on;
    const sOn = per36(fOn, mOn), sOff = mOff >= 20 ? per36(fOff, mOff) : null;
    const sDiff = sOff === null ? null : sOff - sOn;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return [`${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}`, [
      tileTd(`${Math.round(together * 100)}%`, together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`),
      tileTd(fmt(sOn), vsUsual(sOn, usualShots, 3), `His shots a 36 minutes with ${name} on the floor (his usual ${fmt(usualShots)})`),
      tileTd(fmt(sOff), vsUsual(sOff, usualShots, 3), `His shots a 36 minutes with ${name} OFF the floor (his usual ${fmt(usualShots)})`),
      tileTd(sDiff === null ? "--" : signed(sDiff), sDiff === null ? null : sDiff / 4, `Without minus with: green = he shoots more when ${name} sits`),
      tileTd(fmt(on), vsUsual(on, usualPts, 4), `His points a 36 minutes with ${name} on the floor (${Math.round(mOn)} min; his usual ${fmt(usualPts)})`),
      tileTd(fmt(off), vsUsual(off, usualPts, 4), `His points a 36 minutes with ${name} OFF the floor (${Math.round(mOff)} min; his usual ${fmt(usualPts)})`),
      tileTd(diff === null ? "--" : signed(diff), diff === null ? null : diff / 6, `Without minus with: green = he scores more when ${name} sits`),
      tileTd(feed[id] ? String(feed[id]) : "--", feed[id] && makes ? (feed[id] / makes) * 8 - 1 : null, `${name}'s assists on his made shots${makes ? ` (${feed[id] || 0} of his ${makes})` : ""}`),
    ], isOut(st) ? "rs-out" : ""];
  });
  return tile("Teammates On The Floor", "Every teammate he's shared 20+ minutes with this season, most time together first. Time Together = share of his minutes with that teammate on the floor. Shots and points are HIS, a 36 minutes, with the teammate on the floor and off it (off needs 20+ minutes): green / red = above / below his usual rate. Change = without minus with: green = he shoots / scores more when that teammate sits. Assists = that teammate's assists on his makes. Red name = Out tonight.",
    grid([["Time Together", "od-g0", [""], 66], ["His Shots / 36", "od-g2", ["With", "Without", "Change"], 58], ["His Points / 36", "od-g1", ["With", "Without", "Change"], 58], ["Assists To Him", "od-g3", [""], 66]], rows, 170));
}

// 6. Matchup Angles: his side and tonight's defense's side of one thing, Allowed (the numbers) or
// Rank; a More / Fewer read only when one side clearly points one way and the other doesn't point
// the other way (the site's two-sided rule).
function anglesTile(x) {
  const f = logFields();
  const pool = posPool(x.p.pos);
  const R = RS();
  const teams = identityTeams();
  const opp = x.opp;
  const perG = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const benchShare = (pid) => { const u = (R.players[pid] || {}).units; return u && u[0] + u[2] ? u[0] / (u[0] + u[2]) : null; };
  const transShare = (pid) => { const t = (R.players[pid] || {}).trans; return t && t[1] ? t[0] / t[1] : null; };
  const fouls36 = (rows) => { const m = rows.reduce((a, r) => a + (r[f.min] || 0), 0); return m ? (rows.reduce((a, r) => a + (r[f.pf] || 0), 0) / m) * 36 : null; };
  const ftAllowed = teamRanks((t) => (allowedRecent(t, x.p.pos, (r, ff) => r[ff.fta], 0) || {}).v ?? null);
  const transAllowed = teamRanks((t) => (teams[t] || {}).def_trans_freq ?? null);
  const benchAllowed = teamRanks((t) => { const u = R.teams[t]; return u && u[0] >= 30 ? (u[1] / u[0]) * 100 : null; });
  const pace = teamRanks((t) => (teams[t] || {}).off_pace ?? null);
  // the other team's players at his position: free throws they draw a game (they attack him)
  const draws = teamRanks((t) => { const rows = Object.values(seasonBlock().players).filter((q) => q.team === t && q.pos === x.p.pos).flatMap((q) => q.log || []); const n = new Set(rows.map((r) => r[f.game])).size; return n ? rows.reduce((a, r) => a + (r[f.fta] || 0), 0) / n : null; });
  const him = (v, vals, show, flip = false) => { const rk = rankIn(v, vals); const s = spread(v, vals); return { s: s === null ? null : flip ? -s : s, text: RSV.rank ? (rk ? ordinal(rk.r) : "--") : show(v), sub: RSV.rank ? `of ${rk ? rk.n : 0} ${x.p.pos}s` : "" }; };
  const them = (rk, t, show, flip = false) => { const s = rankSigned(rk.r[t], rk.n); return { s: s === null ? null : flip ? -s : s, text: RSV.rank ? (rk.r[t] ? ordinal(rk.r[t]) : "--") : show(rk.v[t]), sub: RSV.rank ? `of ${rk.n}` : "" }; };
  const pctTxt = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
  const read = (a, b) => {
    if (a.s === null || b.s === null) return tileTd("--", null, "Not enough data on one side yet");
    const more = (a.s >= 0.4 && b.s > -0.1) || (b.s >= 0.4 && a.s > -0.1);
    const fewer = (a.s <= -0.4 && b.s < 0.1) || (b.s <= -0.4 && a.s < 0.1);
    return tileTd(more ? "More" : fewer ? "Fewer" : "Even", more ? 1 : fewer ? -1 : 0.1, more ? "One side points to more points for him and the other doesn't point against it" : fewer ? "One side points to fewer points for him and the other doesn't point against it" : "The two sides don't line up one way");
  };
  const ROWS = [
    ["Free Throws", "His free throws tried a game / what the defense allows his position", him(perG(logOf(x.pid), "fta"), pool.map(([, q]) => perG(q.log || [], "fta")), (v) => fmt(v)), them(ftAllowed, opp, (v) => fmt(v))],
    ["Transition", "Share of his points on fast breaks / how often the defense's opponents get out in transition", him(transShare(x.pid), pool.map(([id]) => transShare(id)), pctTxt), them(transAllowed, opp, pctTxt)],
    ["Vs Bench Units", "Share of his possessions against bench units (2 or fewer starters) / points a 100 possessions the defense's bench units allow", him(benchShare(x.pid), pool.map(([id]) => benchShare(id)), pctTxt), them(benchAllowed, opp, (v) => fmt(v, 0))],
    ["Pace", "His team's pace / the defense's pace (possessions a 48 minutes; 1st = fastest)", them(pace, x.team, (v) => fmt(v)), them(pace, opp, (v) => fmt(v))],
    ["Foul Trouble", "His fouls a 36 minutes (red = foul-prone) / free throws the defense's players at his position draw a game (red = they attack)", him(fouls36(logOf(x.pid)), pool.map(([, q]) => fouls36(q.log || [])), (v) => fmt(v), true), them(draws, opp, (v) => fmt(v), true)],
  ];
  const rows = ROWS.map(([label, tip, a, b]) => [`<span title="${tip}">${label}</span>`, [tileTd(a.text, a.s, tip, a.sub), tileTd(b.text, b.s, tip, b.sub), read(a, b)]]);
  const toggle = `<span class="view-toggle rs-toggle">${[[false, "Allowed"], [true, "Rank"]].map(([v, label]) => `<button type="button" class="view-toggle-btn${RSV.rank === v ? " active" : ""}" data-rs-rank="${v}">${label}</button>`).join("")}</span>`;
  return tile("Matchup Angles", `His side and ${team(opp).name}'s side of the same thing (hover a row for what each number is). Green = toward more points for him, red = toward fewer. More / Fewer only when one side clearly points one way and the other doesn't point the other way.`,
    grid([[`<span title="${nameOf(x.pid)}">${face(x.pid, true)}</span>`, "od-g1", [""], 84], [`${logo(opp, 22)} DEF`, "od-g2", [""], 84], ["Read", "od-g0", [""], 64]], rows, 110), toggle);
}

// 7. Tonight's Game Script: only the kinds of game tonight is (his spread, the total, the pace and
// the schedule spots), each against all his games: games, his points, games over tonight's line.
function scriptTile(x) {
  const f = logFields();
  const R = RS();
  const log = logOf(x.pid);
  const games = R.games || {};
  const gOf = (r) => games[String(r[f.game])] || [];
  const teams = identityTeams();
  const season = avg(log.map((r) => r[f.pts] || 0));
  const line = x.line;
  const rows = [];
  const add = (label, rowsIn, tip) => {
    const vals = rowsIn.map((r) => r[f.pts] || 0);
    const a = avg(vals);
    const over = line === null ? null : vals.filter((v) => v > line).length;
    const small = vals.length < SMALL;
    rows.push([`<span title="${tip}">${label}</span>`, [
      tileTd(String(vals.length), null, tip),
      tileTd(fmt(a), small || a === null || !season ? null : (a - season) / season / 0.15, `${tip}: ${fmt(a)} points a game (season ${fmt(season)})`),
      tileTd(over === null || !vals.length ? "--" : `${over} of ${vals.length}`, small || over === null ? null : (over / vals.length) * 2 - 1, `${tip}: games over tonight's line`),
    ], small ? "rs-small" : ""]);
  };
  const sgn = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));
  // Tonight's spread, total and pace sit over the labels; each row is his games within SCRIPT_RANGE
  // of tonight's number either way (tonight's in the middle; pace PACE_RANGE possessions).
  const hs = x.g.home_team_spread;
  const sp = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  const tot = x.g.total_line ?? null;
  const tp = teams[x.team] && teams[x.opp] ? (teams[x.team].off_pace + teams[x.opp].off_pace) / 2 : null;
  add("All His Games", log, "Every game this season");
  if (sp !== null) {
    add(`Spread ${sgn(sp - SCRIPT_RANGE)} To ${sgn(sp + SCRIPT_RANGE)}`, log.filter((r) => { const g = gOf(r); if (g[2] === null || g[2] === undefined) return false; return Math.abs((r[f.home] ? g[2] : -g[2]) - sp) <= SCRIPT_RANGE; }),
      `His games with his team's spread within ${SCRIPT_RANGE} of tonight's ${sgn(sp)}`);
  }
  if (tot !== null) {
    add(`Total ${fmt(tot - SCRIPT_RANGE)} To ${fmt(tot + SCRIPT_RANGE)}`, log.filter((r) => { const v = gOf(r)[1]; return v !== null && v !== undefined && Math.abs(v - tot) <= SCRIPT_RANGE; }),
      `His games with a total within ${SCRIPT_RANGE} of tonight's ${fmt(tot)}`);
  }
  if (tp !== null) {
    add(`Pace ${fmt(tp - PACE_RANGE)} To ${fmt(tp + PACE_RANGE)}`, log.filter((r) => { const v = gOf(r)[0]; return v !== null && v !== undefined && Math.abs(v - tp) <= PACE_RANGE; }),
      `His games within ${PACE_RANGE} possessions of tonight's pace (${x.team} and ${x.opp}'s average, ${fmt(tp)})`);
  }
  const spots = ((((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {}).spots) || {};
  const labels = Object.fromEntries((spots.types || []).map((t) => [t.key, t.label]));
  for (const k of ((spots.tonight || {})[String(x.g.game_id)] || {})[x.team] || []) {
    add(labels[k] || k, log.filter((r) => (((R.spots || {})[String(r[f.game])] || {})[x.team] || []).includes(k)), `His games in this schedule spot: ${labels[k] || k}`);
  }
  const now = [["Spread", sp === null ? "--" : sgn(sp)], ["Total", tot === null ? "--" : fmt(tot)], ["Pace", tp === null ? "--" : fmt(tp)]];
  const corner = `<div class="rs-now"><span class="rs-now-h">Tonight's Game</span>${now.map(([k, v]) => `<span class="od-tile"><b>${v}</b><small>${k}</small></span>`).join("")}</div>`;
  return tile("Tonight's Game Script", `Tonight's spread, total and pace on top. Each row is his games within ${SCRIPT_RANGE} points of tonight's spread or total either way (pace: ${PACE_RANGE} possessions), and tonight's schedule spots, next to all his games. Points green / red = 15%+ above / below his season; Over = his games over tonight's line. Fewer than ${SMALL} games is faded: too few to lean on.`,
    grid([["His Games Like Tonight", "od-g1", ["Games", "Points", line === null ? "Over" : `Over ${fmt(line)}`], 64]], rows, 176, corner));
}

// Each row of boxes is drawn at its compact size, then scaled up evenly until it fills the panel's
// width (at most PANEL_ZOOM_MAX): bigger, easier to read, and no dead space beside the boxes (the
// owner, 2026-11-03: "dont just make stuff wider to fill it, make it more readable").
const PANEL_ZOOM_MAX = 1.3;
function fitPanel() {
  document.querySelectorAll("#rs-list .rs-prow").forEach((row) => {
    const boxes = [...row.children].filter((t) => !t.classList.contains("rs-grow"));
    if (!boxes.length) return;
    boxes.forEach((t) => (t.style.zoom = ""));
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const room = row.clientWidth - gap * (row.children.length - 1);
    const used = boxes.reduce((a, t) => a + t.getBoundingClientRect().width, 0);
    const z = Math.min(PANEL_ZOOM_MAX, room / used);
    if (z > 1.01) boxes.forEach((t) => (t.style.zoom = z.toFixed(3)));
  });
}
function panel(x) {
  if (!PROPS.research) return '<div class="rs-panel"><p class="rs-none">The research data comes with the next data build.</p></div>';
  return `<div class="rs-panel"><div class="rs-prow">${rotationTile(x)}</div><div class="rs-prow">${chartTile(x)}${formTile(x)}${scoreTile(x)}</div><div class="rs-prow">${mateTile(x)}${anglesTile(x)}${scriptTile(x)}</div></div>`;
}

function renderToolbar() {
  const menu = (key, label, options, tip) =>
    `<label class="sim-menu" title="${tip}"><span>${label}</span><select data-list="${key}">${options.map(([v, text]) => `<option value="${v}"${String(LIST[key]) === String(v) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  el("rs-toolbar").innerHTML = menu("pos", "Position", [["", "All"], ["PG", "PG"], ["SG", "SG"], ["SF", "SF"], ["PF", "PF"], ["C", "C"]], "Only players at this position")
    + `<span class="sim-seg">${[[false, "With A Line", "Only players the books have a line for"], [true, "Every Player", `Every rotation player (${ROTATION_MIN}+ minutes a game), with a line or not`]]
      .map(([v, label, tip]) => `<button type="button" class="view-toggle-btn${LIST.every === v ? " active" : ""}" data-list-every="${v}" title="${tip}">${label}</button>`).join("")}</span>`
    + (LIST.game ? `<button type="button" class="view-toggle-btn" data-list-game="" title="Show every game again">${(() => { const g = DATA.schedule.find((x) => x.game_id === LIST.game); return g ? `${g.away} @ ${g.home}` : ""; })()} &times;</button>` : "");
}
function renderList() {
  const date = days()[dayIndex];
  renderToolbar();
  const rows = date ? sortedRows(date) : [];
  const lined = rows.filter((x) => x.line !== null).length;
  const at = DATA.generated_at ? new Date(DATA.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  el("rs-note").innerHTML = `${lined} player${lined === 1 ? "" : "s"} with a ${MK.unit.toLowerCase()} line${at ? ` &middot; lines and injury report as of ${at}` : ""} &middot; check the injury report before you bet: NBA lineups change late`;
  if (!rows.length) {
    const noOdds = !Object.keys(DATA.book_odds || {}).length;
    el("rs-list").innerHTML = `<p class="sim-noplay">${noOdds || !LIST.every ? "The books haven't posted these lines yet." : "No player matches these filters."}${!LIST.every ? ' <button type="button" class="view-toggle-btn" data-list-every="true">Show Every Player</button>' : ""}</p>`;
    return;
  }
  const body = rows.map((x, i) => {
    const head = x.live && (i === 0 || !rows[i - 1].live) ? `<tr class="sim-group"><td colspan="${COLS.length}">Started: the lines locked at tip.</td></tr>` : "";
    return head + row(x) + (PANEL && OPEN === `${x.g.game_id}:${x.pid}` ? `<tr class="rs-panel-row"><td colspan="${COLS.length}">${panel(x)}</td></tr>` : "");
  }).join("");
  el("rs-list").innerHTML = `<div class="nba-box sim-listbox"><div class="sim-scroll"><table class="data-table sim-list rs-list">${listHead()}<tbody>${body}</tbody></table></div></div>`;
  fitTags();
  fitPanel();
}
// Tags fill at most two lines, the same box on every row: the ones that don't fit fold into a
// "+N" pill naming them on hover (the site's table rule).
function fitTags() {
  document.querySelectorAll("#rs-list .sim-rtags").forEach((box) => {
    box.querySelectorAll(".sim-rtag.more").forEach((m) => m.remove());
    const tags = [...box.children];
    tags.forEach((t) => (t.hidden = false));
    if (box.scrollHeight <= box.clientHeight + 1) return;
    const more = document.createElement("span");
    more.className = "sim-rtag more";
    box.appendChild(more);
    let shown = tags.length;
    while (shown > 0) {
      shown -= 1;
      tags[shown].hidden = true;
      const rest = tags.slice(shown);
      more.textContent = `+${rest.length}`;
      more.title = rest.map((t) => t.title || t.textContent.trim()).join("\n");
      if (box.scrollHeight <= box.clientHeight + 1) break;
    }
  });
}
window.addEventListener("resize", () => {
  clearTimeout(fitTags.wait);
  fitTags.wait = setTimeout(() => { fitTags(); fitPanel(); }, 120);
});

function renderGamePicker() {
  const games = gamesOn(days()[dayIndex]);
  if (!games.some((g) => g.game_id === LIST.game)) LIST.game = "";
  gameId = LIST.game || (games[0] || {}).game_id || "";
  el("matchup-row").innerHTML = games.map((g) => `<button type="button" class="matchup-card${g.game_id === LIST.game ? " selected" : ""}" data-game="${g.game_id}">
      <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
      <span class="matchup-date">${gmgGameTime(g, false)}</span></button>`).join("");
}
function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  renderGamePicker();
  renderList();
}

document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-list]");
  if (sel) {
    LIST[sel.dataset.list] = sel.value;
    return renderList();
  }
  // a play saved to My Plays from a row (nba-card.js saves it first): keep the boxes in step
  if (e.target.closest("#rs-list .nba-pc-toggle")) setTimeout(renderList, 0);
});
document.addEventListener("click", (e) => {
  const card = e.target.closest("#matchup-row [data-game]");
  if (card) {
    LIST.game = LIST.game === card.dataset.game ? "" : card.dataset.game;
    renderGamePicker();
    return renderList();
  }
  if (e.target.closest("[data-list-game]")) {
    LIST.game = "";
    renderGamePicker();
    return renderList();
  }
  const every = e.target.closest("[data-list-every]");
  if (every) {
    LIST.every = every.dataset.listEvery === "true";
    return renderList();
  }
  const view = e.target.closest("#rs-list [data-rs-rank]");
  if (view) {
    RSV.rank = view.dataset.rsRank === "true";
    return renderList();
  }
  const open = PANEL && e.target.closest("#rs-list tr.rs-click");
  if (open && !e.target.closest("a, button, input, select, label, .rs-price, .player-click, .sim-rtag")) {
    OPEN = OPEN === open.dataset.open ? "" : open.dataset.open;
    return renderList();
  }
  const sort = e.target.closest("#rs-list [data-sort]");
  if (sort) {
    if (LIST.sort === sort.dataset.sort) LIST.dir = -LIST.dir;
    else {
      LIST.sort = sort.dataset.sort;
      LIST.dir = -1;
    }
    return renderList();
  }
  if (e.target.closest("#day-prev") && dayIndex > 0) {
    dayIndex -= 1;
    LIST.game = "";
    return render();
  }
  if (e.target.closest("#day-next") && dayIndex < days().length - 1) {
    dayIndex += 1;
    LIST.game = "";
    return render();
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

Promise.all([fetch("data.json").then((r) => r.json()), fetch("props.json").then((r) => r.json())])
  .then(([data, props]) => {
    DATA = data;
    PROPS = props;
    if (!PROPS || !Object.keys(PROPS.seasons || {}).length) {
      el("rs-app").hidden = true;
      el("empty-state").innerHTML = "<p>The player data isn't available right now. It comes with every data build; check back shortly.</p>";
      return;
    }
    el("empty-state").hidden = true;
    el("rs-app").hidden = false;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
