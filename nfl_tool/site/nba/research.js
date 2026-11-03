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
// Seven tiles: Points Vs The Line, Recent Form, How He Scores, Teammates On The Floor, Matchup
// Angles, Game Script, Rotation. Real counts only. Green = points toward more, red = toward fewer;
// a two-sided read (Matchup Angles) follows the site's rule: one side clearly one way and the other
// not the other way.
const RS = () => PROPS.research || { players: {}, teams: {}, games: {}, spots: {} };
const rsOf = (pid) => RS().players[pid] || {};
const pct1 = (n, d) => (d ? Math.round((n / d) * 100) : null);
// a shade for a signed strength (-1..1): green toward more points, red toward fewer, nothing near 0
const leanBg = (s, fill = 0.4) => (s === null || s === undefined || Number.isNaN(s) || Math.abs(s) < 0.1 ? "" : `background:${scaleHsla(s > 0 ? 135 : 0, 78, 44, 0.1 + Math.min(1, Math.abs(s)) * fill)}`);
const per36 = (n, m) => (m ? (n / m) * 36 : null);
const tile = (title, tip, body, cls = "") => `<section class="rs-tile${cls ? ` ${cls}` : ""}"><h4 title="${tip}">${title}<span class="rs-i">i</span></h4>${body}</section>`;
const gameDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });

// Rotation players at one position (12+ minutes, 3+ games): the pool a number is ranked in.
function posPool(pos) {
  const f = logFields();
  return Object.entries(seasonBlock().players).filter(([, p]) => p.pos === pos && (p.log || []).length >= 3
    && avg(p.log.map((r) => r[f.min] || 0)) >= ROTATION_MIN);
}
// share of the pool below a value, as -1..1 (0 = the middle)
function spread(v, pool) {
  const xs = pool.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v === null || v === undefined || xs.length < 5) return null;
  return (xs.filter((x) => x < v).length + 0.5 * xs.filter((x) => x === v).length) / xs.length * 2 - 1;
}
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
function allowedRanks(pos, stat, n) {
  const teams = Object.keys(DATA.teams || {}).map((t) => [t, allowedRecent(t, pos, stat, n)]).filter(([, x]) => x);
  const sorted = teams.sort((a, b) => b[1].v - a[1].v);
  return { n: sorted.length, r: Object.fromEntries(sorted.map(([t], i) => [t, i + 1])), v: Object.fromEntries(sorted) };
}
const rankSigned = (rank, n) => (rank && n > 1 ? 1 - ((rank - 1) / (n - 1)) * 2 : null); // 1st = +1, last = -1

// 1. Points Vs The Line: his last games as bars against tonight's line (and his line that night).
function chartTile(x) {
  const f = logFields();
  const log = logOf(x.pid).slice(-15);
  const lines = rsOf(x.pid).lines || {};
  if (!log.length) return tile("Points Vs The Line", "His points in each game this season", '<p class="rs-none">No games yet.</p>', "rs-wide");
  const line = x.line;
  const W = 520, H = 150, top = 16, base = 124;
  const max = Math.max(10, line || 0, ...log.map((r) => r[f.pts] || 0)) * 1.1;
  const y = (v) => base - (v / max) * (base - top);
  const bw = W / log.length;
  const bars = log.map((r, i) => {
    const v = r[f.pts] || 0;
    const then = lines[String(r[f.game])];
    const cls = line === null ? "" : v > line ? " over" : " under";
    const tip = `${gameDate(r[f.date])} ${r[f.home] ? "vs" : "@"} ${r[f.opp]}: ${v} pts in ${r[f.min]} min, ${r[f.fga]} shots${then !== undefined ? `, his line was ${fmt(then)}` : ""}`;
    const cx = i * bw + bw / 2;
    return `<g><title>${tip}</title><rect class="rs-bar${cls}" x="${(i * bw + bw * 0.16).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${(base - y(v)).toFixed(1)}" rx="3"></rect>`
      + `<text class="rs-bar-v" x="${cx.toFixed(1)}" y="${(y(v) - 3).toFixed(1)}">${v}</text>`
      + (then !== undefined ? `<line class="rs-then" x1="${(i * bw + bw * 0.08).toFixed(1)}" x2="${(i * bw + bw * 0.92).toFixed(1)}" y1="${y(then).toFixed(1)}" y2="${y(then).toFixed(1)}"></line>` : "")
      + `<text class="rs-bar-l" x="${cx.toFixed(1)}" y="${base + 11}">${r[f.opp]}</text><text class="rs-bar-l rs-bar-d" x="${cx.toFixed(1)}" y="${base + 22}">${gameDate(r[f.date])}</text></g>`;
  }).join("");
  const lineMark = line === null ? "" : `<line class="rs-tonight" x1="0" x2="${W}" y1="${y(line).toFixed(1)}" y2="${y(line).toFixed(1)}"></line><text class="rs-tonight-t" x="${W - 2}" y="${(y(line) - 4).toFixed(1)}">${fmt(line)}</text>`;
  const vals = log.map((r) => r[f.pts] || 0);
  const overs = line === null ? [] : vals.filter((v) => v > line);
  const unders = line === null ? [] : vals.filter((v) => v < line);
  const chips = line === null ? "" : `<div class="rs-chips">
      <span class="rs-chip" style="${leanBg(overs.length / vals.length * 2 - 1)}" title="Games over tonight's line of the ones shown">Over ${overs.length} Of ${vals.length}</span>
      <span class="rs-chip" title="When he went over tonight's line, by how much on average">Over By ${overs.length ? `+${fmt(avg(overs.map((v) => v - line)))}` : "--"}</span>
      <span class="rs-chip" title="When he went under tonight's line, by how much on average">Under By ${unders.length ? `&minus;${fmt(avg(unders.map((v) => line - v)))}` : "--"}</span>
      <span class="rs-chip" title="Games within 3 points of tonight's line either way">Within 3: ${vals.filter((v) => Math.abs(v - line) <= 3).length}</span></div>`;
  const anyThen = log.some((r) => lines[String(r[f.game])] !== undefined);
  const legend = `<span class="rs-legend"><i class="rs-k-tonight"></i>Tonight's Line${anyThen ? '<i class="rs-k-then"></i>His Line That Night' : ""}</span>`;
  return tile("Points Vs The Line", `His last ${log.length} games (oldest left). Green = over tonight's line, red = under. Hover a bar for the game.${anyThen ? " The short white mark is the line the books had him at that night (saved since 2026-11-03)." : ""}`,
    `<svg class="rs-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lineMark}${bars}</svg><div class="rs-chart-foot">${chips}${legend}</div>`, "rs-wide");
}

// 2. Recent Form: last 5 against the season, his volume vs his shooting, and the defense lately.
function formTile(x) {
  const f = logFields();
  const log = logOf(x.pid);
  const l5 = log.slice(-5);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[f[k]] || 0), 0);
  const per = (rows, k) => (rows.length ? sum(rows, k) / rows.length : null);
  const fgp = (rows) => (sum(rows, "fga") ? (sum(rows, "fgm") / sum(rows, "fga")) * 100 : null);
  const oppS = allowedRecent(x.opp, x.p.pos, (r, ff) => r[ff.pts], 0);
  const oppL = allowedRecent(x.opp, x.p.pos, (r, ff) => r[ff.pts], 5);
  const rows = [
    ["Points", per(log, "pts"), per(l5, "pts"), 1, 0.15],
    ["Minutes", per(log, "min"), per(l5, "min"), 1, 0.1],
    ["Shots (FGA)", per(log, "fga"), per(l5, "fga"), 1, 0.15],
    ["Free Throws (FTA)", per(log, "fta"), per(l5, "fta"), 1, 0.3],
    ["FG %", fgp(log), fgp(l5), 0, 0.12],
    [`Opp Allows ${x.p.pos}s`, oppS && oppS.v, oppL && oppL.v, 1, 0.15],
  ];
  const body = rows.map(([label, s, r, d, big]) => {
    const ch = s === null || r === null ? null : r - s;
    const rel = ch === null || !s ? null : ch / s / big;
    return `<tr><th>${label}</th><td>${fmt(s, d)}</td><td style="${leanBg(rel)}"><b>${fmt(r, d)}</b></td><td class="rs-ch">${ch === null ? "--" : signed(ch, d)}</td></tr>`;
  }).join("");
  // where a points swing came from: more / fewer shots tends to stick, hot / cold shooting tends to fade
  const chips = [];
  const ptsCh = per(l5, "pts") - per(log, "pts");
  if (l5.length >= 3 && Math.abs(ptsCh) >= 2) {
    const ppShot = sum(log, "pts") / Math.max(1, sum(log, "fga"));
    const volume = (per(l5, "fga") - per(log, "fga")) * ppShot + (per(l5, "fta") - per(log, "fta")) * 0.8;
    const shooting = ptsCh - volume;
    const up = ptsCh > 0;
    const fromVolume = Math.sign(volume) === Math.sign(ptsCh) && Math.abs(volume) >= Math.abs(shooting);
    chips.push(`<span class="rs-chip ${fromVolume ? (up ? "good" : "bad") : "warn"}" title="His last 5 are ${signed(ptsCh)} points a game from his season: about ${signed(volume)} from more or fewer shots and free throws, ${signed(shooting)} from making more or fewer of them. A change in shots tends to hold; a hot or cold shooting run tends to even out.">${up ? "Up" : "Down"}: ${fromVolume ? (up ? "More Shots" : "Fewer Shots") : (up ? "Hot Shooting" : "Cold Shooting")}</span>`);
  }
  const starts = sum(l5, "start");
  chips.push(`<span class="rs-chip" title="Games he started of his last ${l5.length}, and this season">Started ${starts} Of ${l5.length} (${sum(log, "start")} Of ${log.length})</span>`);
  const blow = log.filter((r) => r[f.score] !== null && r[f.opp_score] !== null && Math.abs(r[f.score] - r[f.opp_score]) >= 20);
  if (blow.length) {
    const rest = log.filter((r) => !blow.includes(r));
    chips.push(`<span class="rs-chip${per(blow, "min") < per(rest, "min") - 3 ? " warn" : ""}" title="Games decided by 20+ points: his minutes in them against his other games">Blowouts: ${blow.length} G, ${fmt(per(blow, "min"), 0)} Min (${fmt(per(rest, "min"), 0)} Others)</span>`);
  }
  return tile("Recent Form", "His last 5 games against his season, and what tonight's defense has allowed his position in its last 5 games. Green / red = his last 5 well above / below his season.",
    `<table class="rs-mini"><thead><tr><th></th><th>Season</th><th>L5</th><th>+/-</th></tr></thead><tbody>${body}</tbody></table><div class="rs-chips">${chips.join("")}</div>`);
}

// 3. How He Scores: how his shots come, how much is set up for him, his share of the team's shots.
function scoreTile(x) {
  const f = logFields();
  const p = playerOf(x.pid) || {};
  const r = rsOf(x.pid);
  const pool = posPool(x.p.pos);
  const kinds = p.kinds || {};
  const seg = [["self", "Self-Created", "rs-k1"], ["catch", "Catch & Shoot", "rs-k2"], ["drive", "Drives & Cuts", "rs-k3"], ["other", "Post / Other", "rs-k4"]];
  const bar = `<div class="rs-stack" title="How his shots come: Self-Created = pull-ups, step-backs and fades">${seg.map(([k, label, cls]) => (kinds[k] ? `<span class="${cls}" style="width:${(kinds[k] * 100).toFixed(1)}%" title="${label}: ${Math.round(kinds[k] * 100)}% of his shots">${kinds[k] >= 0.12 ? `${Math.round(kinds[k] * 100)}%` : ""}</span>` : "")).join("")}</div>
    <div class="rs-stack-key">${seg.map(([k, label, cls]) => `<span><i class="${cls}"></i>${label}</span>`).join("")}</div>`;
  const log = logOf(x.pid);
  const sum = (rows, k) => rows.reduce((a, q) => a + (q[f[k]] || 0), 0);
  const ftShare = (pl) => { const pts = sum(pl, "pts"); return pts ? sum(pl, "ftm") / pts : null; };
  const transShare = (pid) => { const t = rsOf(pid).trans; return t && t[1] ? t[0] / t[1] : null; };
  const metric = (label, v, poolVals, tip) => {
    const s = spread(v, poolVals);
    const rank = v === null ? null : poolVals.filter((q) => q !== null && q > v).length + 1;
    return `<tr title="${tip}"><th>${label}</th><td><b>${v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`}</b></td>
      <td class="rs-meter"><span style="width:${s === null ? 0 : ((s + 1) / 2) * 100}%"></span></td><td class="rs-rank">${rank && poolVals.length ? `${ordinal(rank)} of ${poolVals.length} ${x.p.pos}s` : ""}</td></tr>`;
  };
  const shareTeam = Object.entries(seasonBlock().players).filter(([, q]) => q.team === x.team && q.share).sort((a, b) => b[1].share - a[1].share);
  const teamRank = shareTeam.findIndex(([id]) => id === x.pid) + 1;
  const rows = [
    metric("Shot Share", p.share ?? null, pool.map(([, q]) => q.share ?? null), `His share of his team's shots while he's on the floor${teamRank ? ` (${ordinal(teamRank)} on the ${x.team})` : ""}`),
    metric("Assisted Makes", p.assisted ?? null, pool.map(([, q]) => q.assisted ?? null), "Share of his made shots a teammate assisted (the rest he made on his own)"),
    metric("Pts From The Line", ftShare(log), pool.map(([, q]) => ftShare(q.log)), "Share of his points from free throws"),
    metric("Transition Pts", transShare(x.pid), pool.map(([id]) => transShare(id)), "Share of his points on fast breaks: possessions off a miss or a steal with a shot inside 8 seconds"),
  ].join("");
  const feed = r.feed;
  const feeders = feed && feed[1].length ? `<div class="rs-feed"><span class="rs-feed-h" title="Who assists his made shots (of his ${feed[0]} makes)">Who Sets Him Up</span>${feed[1].map(([id, n]) => {
    const st = statusOf(x.team, id);
    return `<span class="rs-chip${isOut(st) ? " bad" : st ? " warn" : ""}" title="${nameOf(id)} assisted ${n} of his ${feed[0]} makes${st ? ` (${st} tonight)` : ""}">${playerClick(id, lastName(nameOf(id)))} ${pct1(n, feed[0])}%${st ? ` ${statusPill(st)}` : ""}</span>`;
  }).join("")}</div>` : "";
  return tile("How He Scores", `How his shots come and where his points come from, each ranked among this season's rotation ${x.p.pos}s (1st = the most). Who Sets Him Up = the teammates who assist his makes; red = Out tonight.`,
    `${bar}<table class="rs-mini rs-metrics"><tbody>${rows}</tbody></table>${feeders}`);
}

// 4. Teammates On The Floor: his scoring with each teammate on the floor and off it, and how often
// they share the floor.
function mateTile(x) {
  const p = playerOf(x.pid) || {};
  const feed = Object.fromEntries(((rsOf(x.pid).feed || [0, []])[1]));
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team)
    .sort((a, b) => b[1][0] - a[1][0]).slice(0, 7);
  if (!mates.length) return tile("Teammates On The Floor", "His scoring with each teammate on the floor and off it", '<p class="rs-none">Not enough minutes together yet.</p>', "rs-wide");
  const rows = mates.map(([id, w]) => {
    const [mOn, pOn, fOn, mOff, pOff, fOff] = w;
    const together = mOn / (mOn + mOff);
    const on = per36(pOn, mOn), off = mOff >= 20 ? per36(pOff, mOff) : null;
    const diff = off === null ? null : on - off;
    const sOn = per36(fOn, mOn), sOff = mOff >= 20 ? per36(fOff, mOff) : null;
    const st = statusOf(x.team, id);
    return `<tr${isOut(st) ? ' class="rs-mate-out"' : ""}><th>${playerClick(id, lastName(nameOf(id)))} ${statusPill(st)}</th>
      <td title="${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes with ${nameOf(id)} on the floor"><span class="rs-together"><span style="width:${(together * 100).toFixed(0)}%"></span></span>${Math.round(together * 100)}%</td>
      <td><b>${fmt(on)}</b></td><td>${fmt(off)}</td>
      <td class="rs-ch" style="${leanBg(diff === null ? null : -diff / 6)}" title="Points a 36 with ${nameOf(id)} off the floor minus on it (green = he scores more without him)">${diff === null ? "--" : signed(-diff)}</td>
      <td>${fmt(sOn)}</td><td style="${leanBg(sOff === null ? null : (sOff - sOn) / 5)}">${fmt(sOff)}</td>
      <td>${feed[id] ? feed[id] : "--"}</td></tr>`;
  }).join("");
  return tile("Teammates On The Floor", "Every teammate he's shared 20+ minutes with this season, most time together first. Together = share of his minutes with that teammate on the floor. Points and shots are his, a 36 minutes, with the teammate on and off the floor (off needs 20+ minutes). Off-On: green = he scores more when that teammate sits. Assists = that teammate's assists on his makes. A teammate Out tonight is marked red.",
    `<table class="rs-mini rs-mates"><thead><tr><th>Teammate</th><th>Together</th><th>Pts/36 On</th><th>Off</th><th>Off-On</th><th>Shots/36 On</th><th>Off</th><th>Assists</th></tr></thead><tbody>${rows}</tbody></table>`, "rs-wide");
}

// 5. Matchup Angles: his side and tonight's defense's side of one thing, with a read only when one
// side clearly points one way and the other doesn't point the other way.
function anglesTile(x) {
  const f = logFields();
  const pool = posPool(x.p.pos);
  const R = RS();
  const id = ((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {};
  const teams = id.teams || {};
  const teamList = Object.keys(teams);
  const rankBy = (key, hi = true) => {
    const s = teamList.filter((t) => teams[t][key] !== null && teams[t][key] !== undefined).sort((a, b) => (hi ? teams[b][key] - teams[a][key] : teams[a][key] - teams[b][key]));
    return { n: s.length, r: Object.fromEntries(s.map((t, i) => [t, i + 1])) };
  };
  const perG = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const share = (pid) => { const u = (R.players[pid] || {}).units; return u && u[0] + u[2] ? u[0] / (u[0] + u[2]) : null; };
  const transShare = (pid) => { const t = (R.players[pid] || {}).trans; return t && t[1] ? t[0] / t[1] : null; };
  const benchPer = (t) => { const u = R.teams[t]; return u && u[0] >= 30 ? (u[1] / u[0]) * 100 : null; };
  const benchRank = (() => { const s = teamList.filter((t) => benchPer(t) !== null).sort((a, b) => benchPer(b) - benchPer(a)); return { n: s.length, r: Object.fromEntries(s.map((t, i) => [t, i + 1])) }; })();
  const ftA = allowedRanks(x.p.pos, (r, ff) => r[ff.fta], 0);
  const log = logOf(x.pid);
  const fouls36 = (rows) => { const m = rows.reduce((a, r) => a + (r[f.min] || 0), 0); return m ? (rows.reduce((a, r) => a + (r[f.pf] || 0), 0) / m) * 36 : null; };
  const early = new Set((rsOf(x.pid).foul || []).map(String));
  // the other team's players at his position: how many free throws they draw a game
  const oppDraw = (t) => { const rows = Object.values(seasonBlock().players).filter((q) => q.team === t && q.pos === x.p.pos).flatMap((q) => q.log || []); const games = new Set(rows.map((r) => r[f.game])).size; return games ? rows.reduce((a, r) => a + (r[f.fta] || 0), 0) / games : null; };
  const drawRank = (() => { const s = teamList.map((t) => [t, oppDraw(t)]).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]); return { n: s.length, r: Object.fromEntries(s.map(([t], i) => [t, i + 1])), v: Object.fromEntries(s) }; })();
  const pace = rankBy("off_pace");
  const trans = rankBy("def_trans_freq");
  const cell = (s, text, tip) => `<td style="${leanBg(s, 0.45)}" title="${tip}">${text}</td>`;
  const posRank = (v, vals) => { const xs = vals.filter((q) => q !== null && q !== undefined); return v === null || v === undefined ? "--" : `${ordinal(xs.filter((q) => q > v).length + 1)} of ${xs.length}`; };
  const read = (a, b) => {
    if (a === null || b === null) return '<td class="rs-read"><span class="muted-label">--</span></td>';
    const target = (a >= 0.4 && b > -0.1) || (b >= 0.4 && a > -0.1);
    const tough = (a <= -0.4 && b < 0.1) || (b <= -0.4 && a < 0.1);
    return `<td class="rs-read">${target ? '<span class="rs-chip good">More</span>' : tough ? '<span class="rs-chip bad">Fewer</span>' : '<span class="muted-label">Neutral</span>'}</td>`;
  };
  const opp = x.opp;
  const rk = (r, t) => (r.r[t] ? `${ordinal(r.r[t])} of ${r.n}` : "--");
  const myFta = perG(log, "fta");
  const ftVals = pool.map(([, q]) => perG(q.log || [], "fta"));
  const sFt = spread(myFta, ftVals), oFt = rankSigned(ftA.r[opp], ftA.n);
  const myTr = transShare(x.pid), trVals = pool.map(([pid]) => transShare(pid));
  const sTr = spread(myTr, trVals), oTr = rankSigned(trans.r[opp], trans.n);
  const myB = share(x.pid), bVals = pool.map(([pid]) => share(pid));
  const sB = spread(myB, bVals), oB = rankSigned(benchRank.r[opp], benchRank.n);
  const sPace = rankSigned(pace.r[x.team], pace.n), oPace = rankSigned(pace.r[opp], pace.n);
  const myPf = fouls36(log), pfVals = pool.map(([, q]) => fouls36(q.log || []));
  const sPf = spread(myPf, pfVals), oPf = rankSigned(drawRank.r[opp], drawRank.n);
  const u = rsOf(x.pid).units;
  const benchTip = u ? `${Math.round(myB * 100)}% of his possessions came against bench units (2 or fewer starters on the floor): ${fmt((u[1] / Math.max(1, u[0])) * 100, 0)} pts a 100 possessions vs bench, ${fmt((u[3] / Math.max(1, u[2])) * 100, 0)} vs starters` : "";
  const bp = benchPer(opp);
  const rows = [
    ["Free Throws", cell(sFt, `${fmt(myFta)} FTA <small>${posRank(myFta, ftVals)}</small>`, `His free throws tried a game, ranked among ${x.p.pos}s`),
      cell(oFt, `${fmt(ftA.v[opp] && ftA.v[opp].v)} <small>${rk(ftA, opp)}</small>`, `Free throws ${team(opp).name} allow ${x.p.pos}s a game (1st = the most)`), read(sFt, oFt)],
    ["Transition", cell(sTr, `${myTr === null ? "--" : `${Math.round(myTr * 100)}%`} <small>${posRank(myTr, trVals)}</small>`, "Share of his points on fast breaks, ranked among his position"),
      cell(oTr, `<small>${rk(trans, opp)}</small>`, `How often ${team(opp).name}'s opponents get out in transition (1st = the most)`), read(sTr, oTr)],
    ["Vs Bench Units", cell(sB, `${myB === null ? "--" : `${Math.round(myB * 100)}%`} <small>${posRank(myB, bVals)}</small>`, benchTip || "His possessions against bench units"),
      cell(oB, `${bp === null ? "--" : fmt(bp, 0)} <small>${rk(benchRank, opp)}</small>`, `Points a 100 possessions ${team(opp).name} allow with 2 or fewer starters on the floor (1st = the most)`), read(sB, oB)],
    ["Pace", cell(sPace, `<small>${rk(pace, x.team)}</small>`, `${team(x.team).name}'s pace (1st = fastest)`), cell(oPace, `<small>${rk(pace, opp)}</small>`, `${team(opp).name}'s pace (1st = fastest)`), read(sPace, oPace)],
    ["Foul Trouble", cell(sPf === null ? null : -sPf, `${fmt(myPf)} /36 <small>${early.size} early</small>`, `His fouls a 36 minutes, ranked among ${x.p.pos}s (red = foul-prone). ${early.size} game${early.size === 1 ? "" : "s"} with early foul trouble (2 in the 1st or 3 by the half)`),
      cell(oPf === null ? null : -oPf, `${fmt(drawRank.v[opp])} FTA <small>${rk(drawRank, opp)}</small>`, `Free throws ${team(opp).name}'s ${x.p.pos}s draw a game (1st = the most: the player he guards attacks)`), read(sPf === null ? null : -sPf, oPf === null ? null : -oPf)],
  ].map(([label, a, b, r]) => `<tr><th>${label}</th>${a}${b}${r}</tr>`).join("");
  return tile("Matchup Angles", `His side and ${team(opp).name}'s side of the same thing. Green = points toward more points for him, red = toward fewer. More / Fewer only when one side clearly points one way and the other doesn't point the other way.`,
    `<table class="rs-mini rs-angles"><thead><tr><th></th><th>${lastName(nameOf(x.pid))}</th><th>${opp}</th><th>Read</th></tr></thead><tbody>${rows}</tbody></table>`);
}

// 6. Game Script: his points by the spread, total and pace his games had, and in tonight's schedule
// spots; tonight's bucket outlined.
function scriptTile(x) {
  const f = logFields();
  const R = RS();
  const log = logOf(x.pid);
  const games = R.games || {};
  const allPace = Object.values(games).map((g) => g[0]).filter(Boolean).sort((a, b) => a - b);
  const allTot = Object.values(games).map((g) => g[1]).filter(Boolean).sort((a, b) => a - b);
  const q = (xs, p) => (xs.length ? xs[Math.floor(p * (xs.length - 1))] : null);
  const spreadOf = (r) => { const g = games[String(r[f.game])]; return g && g[2] !== null && g[2] !== undefined ? (r[f.home] ? g[2] : -g[2]) : null; };
  const id = ((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {};
  const tp = id.teams || {};
  const tonightPace = tp[x.team] && tp[x.opp] ? (tp[x.team].off_pace + tp[x.opp].off_pace) / 2 : null;
  const hs = x.g.home_team_spread;
  const tonightSpread = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  const tonightTotal = x.g.total_line ?? null;
  const p33 = q(allPace, 1 / 3), p67 = q(allPace, 2 / 3), t33 = q(allTot, 1 / 3), t67 = q(allTot, 2 / 3);
  const groups = [
    ["His Spread", spreadOf, tonightSpread, [["Favored By 7+", (v) => v <= -6.5], ["Within 6", (v) => v > -6.5 && v < 6.5], ["Underdog 7+", (v) => v >= 6.5]], (v) => (v > 0 ? `+${fmt(v)}` : fmt(v))],
    ["Game Total", (r) => (games[String(r[f.game])] || [])[1] ?? null, tonightTotal, t33 === null ? [] : [[`Under ${fmt(t33, 1)}`, (v) => v < t33], ["Middle", (v) => v >= t33 && v <= t67], [`Over ${fmt(t67, 1)}`, (v) => v > t67]], (v) => fmt(v)],
    ["Game Pace", (r) => (games[String(r[f.game])] || [])[0] ?? null, tonightPace, p33 === null ? [] : [["Slow", (v) => v < p33], ["Average", (v) => v >= p33 && v <= p67], ["Fast", (v) => v > p67]], (v) => fmt(v)],
  ];
  const line = x.line;
  const rowOf = (label, rows, isTonight, tip) => {
    const vals = rows.map((r) => r[f.pts] || 0);
    const over = line === null ? null : vals.filter((v) => v > line).length;
    const a = avg(vals);
    const season = avg(log.map((r) => r[f.pts] || 0));
    const small = vals.length < SMALL;
    return `<tr class="${isTonight ? "rs-tonight-row" : ""}${small ? " rs-small" : ""}" title="${tip}${small ? " (Small Sample)" : ""}"><th>${label}${isTonight ? ' <span class="rs-tag">Tonight</span>' : ""}</th><td>${vals.length}</td>
      <td style="${small ? "" : leanBg(a === null || !season ? null : (a - season) / season / 0.15)}"><b>${fmt(a)}</b></td>
      <td style="${small || over === null ? "" : leanBg(over / vals.length * 2 - 1)}">${over === null || !vals.length ? "--" : `${over} of ${vals.length}`}</td></tr>`;
  };
  let body = "";
  for (const [name, get, now, buckets, show] of groups) {
    if (!buckets.length) continue;
    body += `<tr class="rs-group"><td colspan="4">${name}${now === null ? "" : ` <span class="muted-label">Tonight ${show(now)}</span>`}</td></tr>`;
    for (const [label, test] of buckets) {
      const rows = log.filter((r) => { const v = get(r); return v !== null && test(v); });
      body += rowOf(label, rows, now !== null && test(now), `His games with ${name.toLowerCase()} ${label.toLowerCase()}`);
    }
  }
  // tonight's schedule spots (Team Identity), his games in each
  const spotsAll = id.spots || {};
  const labels = Object.fromEntries((spotsAll.types || []).map((t) => [t.key, t.label]));
  const tonight = ((spotsAll.tonight || {})[String(x.g.game_id)] || {})[x.team] || [];
  body += `<tr class="rs-group"><td colspan="4">Tonight's Schedule Spots</td></tr>`;
  if (!tonight.length) body += '<tr><th colspan="4" class="muted-label">None Tonight</th></tr>';
  for (const k of tonight) {
    const rows = log.filter((r) => (((R.spots || {})[String(r[f.game])] || {})[x.team] || []).includes(k));
    body += rowOf(labels[k] || k, rows, true, `His games in this spot this season`);
  }
  return tile("Game Script", `His points by the kind of game: his team's spread and the game total at tip, the game's pace (thirds of every game this season), and tonight's schedule spots. Tonight's bucket is outlined. Avg green / red = 15%+ above / below his season; Over = games over tonight's line. Fewer than ${SMALL} games is too few to lean on (faded).`,
    `<table class="rs-mini rs-script"><thead><tr><th></th><th>G</th><th>Avg</th><th>Over</th></tr></thead><tbody>${body}</tbody></table>`);
}

// 7. Rotation: when he's on the floor, minute by minute, and his points by quarter.
function rotationTile(x) {
  const r = rsOf(x.pid);
  if (!r.rot || !r.rotn || !r.rotn[0]) return tile("Rotation", "When he's on the floor", '<p class="rs-none">No rotation data yet.</p>', "rs-full");
  const strip = (counts, n, label) => `<div class="rs-rot-row"><span class="rs-rot-l">${label}</span><div class="rs-rot">${counts.map((c, m) => {
    const share = n ? c / n : 0;
    return `<i class="${m % 12 === 0 && m ? "q" : ""}" style="background:${scaleHsla(205, 80, 52, 0.06 + share * 0.86)}" title="Minute ${m + 1} (${["1st", "2nd", "3rd", "4th"][Math.floor(m / 12)]} quarter): on the floor in ${c} of ${n} games"></i>`;
  }).join("")}</div></div>`;
  const qLabels = `<div class="rs-rot-row rs-rot-qs"><span class="rs-rot-l"></span><div class="rs-rot-q">${["1st", "2nd", "3rd", "4th"].map((q) => `<span>${q} Qtr</span>`).join("")}</div></div>`;
  const games = r.rotn[0];
  const qs = (r.q || []).map((v) => v / games);
  const qMax = Math.max(1, ...qs);
  const quarters = `<div class="rs-qpts">${qs.map((v, i) => `<div class="rs-qpt" title="${fmt(v)} points a game in the ${["1st", "2nd", "3rd", "4th"][i]} quarter"><span>Q${i + 1}</span><b>${fmt(v)}</b><i style="height:${((v / qMax) * 100).toFixed(0)}%"></i></div>`).join("")}</div>`;
  const q4 = r.q4 || [0, 0, 0, 0];
  const close = q4[0] ? q4[1] / q4[0] : null, open = q4[2] ? q4[3] / q4[2] : null;
  const fourth = `<div class="rs-chips rs-q4"><span class="rs-chip" title="Games within 10 entering the 4th: his 4th-quarter minutes a game">Close 4ths: <b>${fmt(close)}</b> Min (${q4[0]} G)</span><span class="rs-chip${close !== null && open !== null && open < close - 3 ? " warn" : ""}" title="Games not within 10 entering the 4th: his 4th-quarter minutes a game">Not Close: <b>${fmt(open)}</b> Min (${q4[2]} G)</span></div>`;
  return tile("Rotation", `When he's on the floor at each minute of the game: darker = on the floor in more of his games (season and last ${r.rotn[1]}). Points a game by quarter, and his 4th-quarter minutes when the game is close vs not (a big spread can mean an early seat).`,
    `<div class="rs-rot-wrap"><div class="rs-rot-strips">${strip(r.rot, games, "Season")}${strip(r.rot5, r.rotn[1], `Last ${r.rotn[1]}`)}${qLabels}</div><div class="rs-rot-side">${quarters}${fourth}</div></div>`, "rs-full");
}

function panel(x) {
  if (!PROPS.research) return '<div class="rs-panel"><p class="rs-none">The research data comes with the next data build.</p></div>';
  return `<div class="rs-panel">${chartTile(x)}${formTile(x)}${scoreTile(x)}${mateTile(x)}${anglesTile(x)}${scriptTile(x)}${rotationTile(x)}</div>`;
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
  fitTags.wait = setTimeout(fitTags, 120);
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
