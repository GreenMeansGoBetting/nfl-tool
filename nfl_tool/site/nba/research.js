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
  const spec = { kind: "prop", stat: MK.market, team: tm, game: `${g.away}_${g.home}`, pid, side, line, title: `${nameOf(pid)} ${MK.unit}`, sub: `${g.away} @ ${g.home}`, short: true };
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

// ---- tonight's game (the owner, 2026-11-03: "add some relevant data past OPP ALLOWS (maybe pace
// stats for the matchup)"): the game's pace (both teams' average, ranked among the 30 teams' own
// paces, 1st = fastest), his team's spread and the total (colored by where it sits among this
// season's game totals, higher = greener) ----
function tonightGame(g, tm, opp) {
  const teams = identityTeams();
  const paces = Object.values(teams).map((t) => t.off_pace).filter((v) => v !== null && v !== undefined);
  const pace = teams[tm] && teams[opp] && teams[tm].off_pace && teams[opp].off_pace ? (teams[tm].off_pace + teams[opp].off_pace) / 2 : null;
  const paceRank = pace === null ? null : paces.filter((v) => v > pace).length + 1;
  const hs = g.home_team_spread;
  const totals = Object.values(RS().games || {}).map((x) => x[1]).filter((v) => v !== null && v !== undefined);
  return { pace, paceRank, paceN: paces.length, spread: hs === null || hs === undefined ? null : tm === g.home ? hs : -hs,
    total: g.total_line ?? null, totalS: g.total_line === null || g.total_line === undefined ? null : spread(g.total_line, totals) };
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
        without: withoutRows(pid, p.team), game: tonightGame(g, p.team, opp),
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
  pace: (x) => x.game.pace ?? -1, spread: (x) => (x.game.spread === null ? 99 : -x.game.spread), total: (x) => x.game.total ?? -1,
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
  { label: "Pace", key: "pace", game: true, title: "Tonight's pace: both teams' possessions a 48 minutes, averaged, and where that ranks among the 30 teams (1st = fastest)" },
  { label: "Spread", key: "spread", game: true, title: "His team's spread tonight" },
  { label: "Total", key: "total", game: true, title: "Tonight's total (colored by where it sits among this season's game totals)" },
  { label: "Teammates On The Report", cls: "sim-th-tags", title: "His numbers in the games each teammate on tonight's injury report missed (20+ minute players). No = Out or Doubtful, If No = Day-To-Day or Questionable. The number in brackets is the change from his games with that teammate." },
];
function listHead() {
  let group = "";
  for (let i = 0; i < COLS.length; i += 1) {
    const kind = COLS[i].hit ? "hit" : COLS[i].game ? "game" : "";
    if (kind) {
      let n = 0;
      while (COLS[i + n] && (kind === "hit" ? COLS[i + n].hit : COLS[i + n].game)) n += 1;
      group += kind === "hit" ? `<th colspan="${n}" class="sim-hitgroup" title="How often he went OVER tonight's line"><span>Hit Rate - Over Tonight's Line</span></th>`
        : `<th colspan="${n}" class="sim-hitgroup rs-gamegroup" title="Tonight's game"><span>Tonight's Game</span></th>`;
      i += n - 1;
    } else group += "<th></th>";
  }
  return `<thead><tr class="sim-group-row">${group}</tr><tr>${COLS.map((c) => {
    const on = c.key && c.key === LIST.sort;
    const cls = [c.key ? "sim-sort" : "", on ? "on" : "", c.cls || "", c.hit || c.game ? "sim-hit-th" : ""].filter(Boolean).join(" ");
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
function gameCells(x) {
  const gm = x.game;
  const pace = gm.pace === null ? '<td class="num rs-two">--</td>'
    : `<td class="num rs-two" style="${rankStyle(gm.paceRank, gm.paceN || 30)}" title="Tonight's pace ${fmt(gm.pace)} possessions a 48 (${x.team} and ${x.opp} averaged), ${ordinal(gm.paceRank)} fastest of ${gm.paceN}"><b>${fmt(gm.pace)}</b><small>${ordinal(gm.paceRank)}</small></td>`;
  const sp = `<td class="num rs-two" title="${x.team}'s spread tonight"><b>${gm.spread === null ? "--" : gm.spread > 0 ? `+${fmt(gm.spread)}` : fmt(gm.spread)}</b><small>${x.team}</small></td>`;
  const tot = `<td class="num rs-two"${gm.totalS === null ? "" : ` style="${stepStyle(gm.totalS)}"`} title="Tonight's total"><b>${gm.total === null ? "--" : fmt(gm.total)}</b><small>O/U</small></td>`;
  return pace + sp + tot;
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
    ${gameCells(x)}
    <td class="sim-tagc"><div class="sim-rtags">${x.without.map(withoutPill).join("") || '<span class="muted-label">None</span>'}</div></td>
  </tr>`;
}
// ---- the research panel: two sandboxes (the owner approved the layout 2026-11-03) ----
// The owner: "I crave symmetry. I crave consistency. I crave clear and obvious", and on tabs: "this
// would give us a standard sandbox area so youd always know how to conform data to it, rather than
// making everything a different shape and size every time." Under a clicked Points row: two boxes
// of the same size side by side, each with tabs, and EVERY tab is the same grid (sim.css .rs-g): one
// header row, RS_ROWS rows, a label column and seven equal columns, 3 px between tiles and nothing
// else. Colors mean the same thing on every tab: blue header = him, purple = tonight's defense,
// green = the read; every tile on the 8-step scale (stepStyle). The tabs are the titles. Real counts
// only. A new tab fits this grid: six rows of a label + seven tiles (span 2 / 3 / 7 to merge).
const RS_ROWS = 6;
const RS_TABS = { left: ["Form", "Scoring", "Matchup", "Game Script"], right: ["Vs The Line", "Rotation", "Teammates"] };
const RSV = { left: "Form", right: "Vs The Line" }; // the open tab of each box (kept while the page is open)
const SCRIPT_RANGE = 5; // Game Script: his games within this many points of tonight's spread / total, either way (two possessions)
const PACE_RANGE = 2; // ... and within this many possessions of tonight's pace
const RS = () => PROPS.research || { players: {}, teams: {}, games: {}, spots: {}, defpos: {}, deffga: {} };
const rsOf = (pid) => RS().players[pid] || {};
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// a signed strength (-1..1) on the 8-step scale: +1 = greenest, -1 = reddest, null = an uncolored tile
const stepStyle = (s) => (s === null || s === undefined || Number.isNaN(s) ? "" : rankStyle(1 + Math.round(((1 - clamp1(s)) / 2) * 7), 8));
const per36 = (n, m) => (m ? (n / m) * 36 : null);
const pctT = (v) => (v === null || v === undefined || Number.isNaN(v) ? "--" : `${Math.round(v * 100)}%`);
const sgn = (v, d = 1) => (v === null || v === undefined ? "--" : `${v > 0 ? "+" : v < 0 ? "&minus;" : ""}${Math.abs(v).toFixed(d)}`);
const shortName = (name) => { const parts = String(name || "").split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : String(name || ""); };
const face = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="rs-face" loading="lazy" onerror="this.style.visibility='hidden'">`;
const gameDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
const tipAttr = (tip) => (tip ? ` title="${String(tip).replace(/"/g, "&quot;")}"` : "");
// the grid's three tiles: a number (colored by a signed strength), a label, a header (him / def / read / plain)
const T = (v, s, tip = "", cls = "") => `<div class="rs-t${cls ? ` ${cls}` : ""}"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(tip)}>${v}</div>`;
const LB = (v, tip = "") => `<div class="rs-t rs-l"${tipAttr(tip)}>${v}</div>`;
const HD = (v, kind, cls = "", tip = "") => `<div class="rs-t rs-h rs-${kind}${cls ? ` ${cls}` : ""}"${tipAttr(tip)}>${v}</div>`;
// his jersey number on a jersey in his team's color (the owner, 2026-11-03: a long name hid the
// defense in the corner); no number in the data yet = his last name
const jersey = (pid) => {
  const p = playerOf(pid) || {};
  if (!p.num) return `<span class="rs-jname">${lastName(nameOf(pid))}</span>`;
  return `<span class="rs-jersey" style="background:#${team(p.team).color || "555555"}" title="${nameOf(pid)} #${p.num}">${p.num}</span>`;
};
// the key: blue = him (his jersey), purple = tonight's defense against his position
const corner = (x) => `<div class="rs-t rs-corner"><span class="rs-key rs-him">${jersey(x.pid)}</span><span class="rs-key rs-def" title="What ${team(x.opp).name} allow ${x.p.pos}s">${logo(x.opp, 15)}vs ${x.p.pos}s</span></div>`;
// six rows, always: a tab with fewer fills the rest with blank tiles so every box is the same shape.
// `bands`: [kind, first column, columns] shaded behind a group of columns (blue him, purple defense).
const gridOf = (head, rows, { bands = [], cls = "", n = RS_ROWS } = {}) => {
  const out = rows.slice(0, n);
  while (out.length < n) out.push(LB("") + T("", null, "", "rs-s7 rs-blank"));
  const back = bands.length ? `<div class="rs-g rs-bands${cls ? ` ${cls}` : ""}" aria-hidden="true">${bands.map(([k, from, span]) => `<i class="rs-band rs-${k}" style="grid-column:${from} / span ${span}"></i>`).join("")}</div>` : "";
  return `<div class="rs-gw"><div class="rs-g${cls ? ` ${cls}` : ""}">${head}${out.join("")}</div>${back}</div>`;
};
const BANDS_4_3 = [["him", 2, 4], ["def", 6, 3]];
const BANDS_3_3_1 = [["him", 2, 3], ["def", 5, 3], ["rd", 8, 1]];
// the two-sided read (the site's matchup rule): one side clearly one way, the other not the other way
const readOf = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return { t: "--", s: null };
  if ((a >= 0.4 && b > -0.1) || (b >= 0.4 && a > -0.1)) return { t: "More", s: 1 };
  if ((a <= -0.4 && b < 0.1) || (b <= -0.4 && a < 0.1)) return { t: "Fewer", s: -1 };
  return { t: "Even", s: 0.1 };
};
const READ_TIP = { More: "One side points to more points for him and the other doesn't point against it", Fewer: "One side points to fewer points for him and the other doesn't point against it", Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };

// Rotation players at one position (12+ minutes, 3+ games): the pool a number is ranked in.
function posPool(pos) {
  const f = logFields();
  return Object.entries(seasonBlock().players).filter(([, p]) => p.pos === pos && (p.log || []).length >= 3
    && avg(p.log.map((r) => r[f.min] || 0)) >= ROTATION_MIN);
}
// where a value sits in a pool, as -1..1 (+1 = the most)
function spread(v, pool) {
  const xs = pool.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v === null || v === undefined || Number.isNaN(v) || xs.length < 5) return null;
  return ((xs.filter((x) => x < v).length + 0.5 * xs.filter((x) => x === v).length) / xs.length) * 2 - 1;
}
const rankIn = (v, pool) => { const xs = pool.filter((q) => q !== null && q !== undefined && !Number.isNaN(q)); return v === null || v === undefined || Number.isNaN(v) ? null : { r: xs.filter((q) => q > v).length + 1, n: xs.length }; };
const rankSigned = (rank, n) => (rank && n > 1 ? 1 - ((rank - 1) / (n - 1)) * 2 : null); // 1st = +1, last = -1
const rankTxt = (rk) => (rk && rk.r ? ordinal(rk.r) : "--");
function teamRanks(valueOf) {
  const s = Object.keys(DATA.teams || {}).map((t) => [t, valueOf(t)]).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => b[1] - a[1]);
  return { n: s.length, r: Object.fromEntries(s.map(([t], i) => [t, i + 1])), v: Object.fromEntries(s) };
}
const identityBlock = () => (((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {});
const identityTeams = () => identityBlock().teams || {};

// What each defense allowed one position, from every player's game logs: per team its games in date
// order with the position's points, shots, threes, free throws and makes; season and last 5, each
// ranked of 30 (1st = allows the most). Kept per position.
const DEF_POS = {};
function defenseByPos(pos) {
  if (DEF_POS[pos]) return DEF_POS[pos];
  const f = logFields();
  const KEYS = ["pts", "fga", "fg3m", "fta", "fgm"];
  const byTeam = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (p.pos !== pos) continue;
    for (const r of p.log || []) {
      const t = r[f.opp];
      if (!t) continue;
      const g = ((byTeam[t] = byTeam[t] || {})[r[f.game]] = byTeam[t][r[f.game]] || { d: r[f.date], pts: 0, fga: 0, fg3m: 0, fta: 0, fgm: 0 });
      for (const k of KEYS) g[k] += r[f[k]] || 0;
    }
  }
  const total = (gs, k) => gs.reduce((a, g) => a + g[k], 0);
  const agg = (gs) => (gs.length ? { pts: total(gs, "pts") / gs.length, fga: total(gs, "fga") / gs.length, fg3m: total(gs, "fg3m") / gs.length, fta: total(gs, "fta") / gs.length,
    fgp: total(gs, "fga") ? (total(gs, "fgm") / total(gs, "fga")) * 100 : null, n: gs.length } : null);
  const teams = {};
  for (const [t, games] of Object.entries(byTeam)) {
    const gs = Object.values(games).sort((a, b) => (a.d < b.d ? -1 : 1));
    teams[t] = { season: agg(gs), l5: agg(gs.slice(-5)) };
  }
  const ranks = {};
  for (const w of ["season", "l5"]) {
    ranks[w] = {};
    for (const k of ["pts", "fga", "fg3m", "fta", "fgp"]) {
      const sorted = Object.keys(teams).filter((t) => teams[t][w] && teams[t][w][k] !== null).sort((a, b) => teams[b][w][k] - teams[a][w][k]);
      ranks[w][k] = { n: sorted.length, r: Object.fromEntries(sorted.map((t, i) => [t, i + 1])) };
    }
  }
  DEF_POS[pos] = { teams, ranks };
  return DEF_POS[pos];
}
// What every defense allowed one position as shares (research.defpos / deffga): shot share,
// assisted makes, transition, and points by zone; rankOf(get) ranks the teams (1st = the most).
function defShares(pos) {
  const D = RS().defpos || {}, F = RS().deffga || {};
  const teams = {};
  for (const [t, byPos] of Object.entries(D)) {
    const v = byPos[pos];
    if (!v) continue;
    const [th, mid, paint, ft, makes, ast, trans, pts, fga] = v;
    teams[t] = { shot: F[t] ? fga / F[t] : null, assisted: makes ? ast / makes : null, trans: pts ? trans / pts : null,
      z: pts ? [th / pts, mid / pts, paint / pts, ft / pts] : null, pts: [th, mid, paint, ft] };
  }
  const rankOf = (get) => { const xs = Object.keys(teams).filter((t) => get(teams[t]) !== null && get(teams[t]) !== undefined).sort((a, b) => get(teams[b]) - get(teams[a])); return { n: xs.length, r: Object.fromEntries(xs.map((t, i) => [t, i + 1])) }; };
  return { teams, rankOf };
}
const ZONES_PTS = [["Threes", "threes"], ["Mid-Range", "mid-range shots"], ["Paint", "the paint (at the rim and short shots)"], ["Free Throws", "free throws"]];

// ---- left box ----
// Form: his season, last 10, last 5 and the change, beside what tonight's defense allows his
// position (season, last 5, change). His season is colored against his position, the defense's by
// its rank of 30 (green = allows the most), the changes by how big they are.
function formTab(x) {
  const f = logFields();
  const log = logOf(x.pid), l10 = log.slice(-10), l5 = log.slice(-5);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[f[k]] || 0), 0);
  const per = (k) => (rows) => (rows.length ? sum(rows, k) / rows.length : null);
  const fgp = (rows) => (sum(rows, "fga") ? (sum(rows, "fgm") / sum(rows, "fga")) * 100 : null);
  const pool = posPool(x.p.pos);
  const D = defenseByPos(x.p.pos);
  const opp = D.teams[x.opp] || {};
  const ROWS = [["PTS", per("pts"), 1, 0.15, "pts", "points"], ["MIN", per("min"), 1, 0.1, null, "minutes"], ["FGA", per("fga"), 1, 0.15, "fga", "shots"],
    ["3PM", per("fg3m"), 1, 0.3, "fg3m", "threes made"], ["FTA", per("fta"), 1, 0.3, "fta", "free throws tried"], ["FG%", fgp, 0, 0.12, "fgp", "field goal %"]];
  const rows = ROWS.map(([label, get, d, big, key, what]) => {
    const s = get(log), a10 = get(l10), a5 = get(l5);
    const rel = (v) => (v === null || s === null || !s ? null : (v - s) / s / big);
    const ch = a5 === null || s === null ? null : a5 - s;
    // his season against his position; L10 / L5 against HIS season (the owner, 2026-11-03: "compared
    // against himself to see trends lately vs long term"). No real change = a plain tile, never a
    // middle color (with 10 games or fewer his L10 IS his season).
    const trend = (v, rows) => (rows.length >= log.length ? null : Math.abs(rel(v) ?? 0) < 0.2 ? null : rel(v));
    let cells = T(fmt(s, d), spread(s, pool.map(([, q]) => get(q.log || []))), `His ${what} a game this season (colored against the league's ${x.p.pos}s)`)
      + T(fmt(a10, d), trend(a10, l10), `His last ${l10.length} games (colored against his season)`) + T(fmt(a5, d), trend(a5, l5), `His last ${l5.length} games (colored against his season)`)
      + T(sgn(ch, d), rel(a5), "Last 5 minus his season");
    if (!key || !opp.season) cells += T("--", null, "") + T("--", null, "") + T("--", null, "");
    else {
      const rk = (w) => rankSigned(D.ranks[w][key].r[x.opp], D.ranks[w][key].n);
      const sv = opp.season[key], lv = opp.l5 ? opp.l5[key] : null;
      const dch = lv === null || sv === null ? null : lv - sv;
      const tip = `${team(x.opp).name} allow ${x.p.pos}s ${fmt(sv, d)} ${what} a game (${ordinal(D.ranks.season[key].r[x.opp])} most of ${D.ranks.season[key].n}); ${fmt(lv, d)} in their last ${opp.l5 ? opp.l5.n : 0}`;
      cells += T(fmt(sv, d), rk("season"), tip) + T(fmt(lv, d), opp.l5 ? rk("l5") : null, tip) + T(sgn(dch, d), dch === null || !sv ? null : dch / sv / big, tip);
    }
    return LB(label, `${what[0].toUpperCase()}${what.slice(1)} a game`) + cells;
  });
  const head = corner(x) + HD("Season", "him") + HD("L10", "him") + HD("L5", "him") + HD("+/-", "him") + HD("Season", "def", "", `What ${team(x.opp).name} allow ${x.p.pos}s`) + HD("L5", "def") + HD("+/-", "def");
  return gridOf(head, rows, { bands: BANDS_4_3 });
}

// Scoring: his share, its rank among his position and points a game, beside what the defense allows
// his position (share, rank of 30, points a game), and the read. Points by zone: threes, mid-range,
// the paint (rim + short) and free throws.
function scoringTab(x) {
  const p = playerOf(x.pid) || {};
  const pool = posPool(x.p.pos);
  const DS = defShares(x.p.pos);
  const opp = DS.teams[x.opp] || {};
  const games = (rsOf(x.pid).rotn || [logOf(x.pid).length])[0] || logOf(x.pid).length || 1;
  const dGames = ((defenseByPos(x.p.pos).teams[x.opp] || {}).season || {}).n || 0;
  const row = (label, v, vals, dv, dr, ppg, dppg, tip, dtip) => {
    const rk = rankIn(v, vals), s = spread(v, vals), ds = rankSigned(dr.r[x.opp], dr.n), rd = readOf(s, ds);
    return LB(label, tip) + T(pctT(v), s, tip) + T(rankTxt(rk), s, rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "") + T(ppg === null ? "--" : fmt(ppg), ppg === null ? null : s, ppg === null ? "" : `${fmt(ppg)} points a game`)
      + T(pctT(dv), ds, `${team(x.opp).name}: ${dtip}`) + T(dr.r[x.opp] ? ordinal(dr.r[x.opp]) : "--", ds, dr.r[x.opp] ? `${ordinal(dr.r[x.opp])} most of ${dr.n}` : "")
      + T(dppg === null ? "--" : fmt(dppg), dppg === null ? null : ds, dppg === null ? "" : `${team(x.opp).name} allow ${x.p.pos}s ${fmt(dppg)} points a game this way`) + T(rd.t, rd.s, READ_TIP[rd.t]);
  };
  const rows = [
    row("Shot Share", p.share ?? null, pool.map(([, q]) => q.share ?? null), opp.shot, DS.rankOf((t) => t.shot), null, null,
      "His share of his team's shots while he's on the floor", `share of their opponents' shots taken by ${x.p.pos}s`),
    row("Assisted", p.assisted ?? null, pool.map(([, q]) => q.assisted ?? null), opp.assisted, DS.rankOf((t) => t.assisted), null, null,
      "Share of his made shots a teammate assisted", `share of ${x.p.pos}s' made shots against them that were assisted`),
  ];
  const pz = rsOf(x.pid).pz;
  const share = (q, i) => { const t = q ? q.reduce((a, b) => a + b, 0) : 0; return t ? q[i] / t : null; };
  ZONES_PTS.forEach(([label, what], i) => {
    rows.push(row(label, share(pz, i), pool.map(([id]) => share(rsOf(id).pz, i)), opp.z ? opp.z[i] : null, DS.rankOf((t) => (t.z ? t.z[i] : null)),
      pz ? pz[i] / games : null, opp.pts && dGames ? opp.pts[i] / dGames : null, `Share of his points from ${what}`, `share of ${x.p.pos}s' points against them from ${what}`));
  });
  const head = corner(x) + HD("Share", "him") + HD("Rank", "him") + HD("Pts / G", "him") + HD("Allowed", "def") + HD("Rank", "def") + HD("Pts / G", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: BANDS_3_3_1 });
}

// Matchup: his side and the defense's side of one thing (value and rank each) and the read.
function matchupTab(x) {
  const f = logFields();
  const pool = posPool(x.p.pos);
  const R = RS();
  const teams = identityTeams();
  const opp = x.opp;
  const perG = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const benchShare = (pid) => { const u = (R.players[pid] || {}).units; return u && u[0] + u[2] ? u[0] / (u[0] + u[2]) : null; };
  const transShare = (pid) => { const t = (R.players[pid] || {}).trans; return t && t[1] ? t[0] / t[1] : null; };
  const fouls36 = (rows) => { const m = rows.reduce((a, r) => a + (r[f.min] || 0), 0); return m ? (rows.reduce((a, r) => a + (r[f.pf] || 0), 0) / m) * 36 : null; };
  const D = defenseByPos(x.p.pos);
  const ptsAllowed = teamRanks((t) => ((D.teams[t] || {}).season || {}).pts ?? null);
  const ftAllowed = teamRanks((t) => ((D.teams[t] || {}).season || {}).fta ?? null);
  const transAllowed = teamRanks((t) => (teams[t] || {}).def_trans_freq ?? null);
  const benchAllowed = teamRanks((t) => { const u = R.teams[t]; return u && u[0] >= 30 ? (u[1] / u[0]) * 100 : null; });
  const pace = teamRanks((t) => (teams[t] || {}).off_pace ?? null);
  // the other team's players at his position: free throws they draw a game (they attack him)
  const draws = teamRanks((t) => { const rows = Object.values(seasonBlock().players).filter((q) => q.team === t && q.pos === x.p.pos).flatMap((q) => q.log || []); const n = new Set(rows.map((r) => r[f.game])).size; return n ? rows.reduce((a, r) => a + (r[f.fta] || 0), 0) / n : null; });
  // each side: the value and its rank (no average columns: the owner, 2026-11-03, they misled)
  const him = (v, vals, show, flip = false) => { const rk = rankIn(v, vals); const s = spread(v, vals); return { s: s === null ? null : flip ? -s : s, v: show(v), r: rk ? `${ordinal(rk.r)}` : "--", rt: rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "" }; };
  const them = (rk, t, show, flip = false) => { const s = rankSigned(rk.r[t], rk.n); return { s: s === null ? null : flip ? -s : s, v: show(rk.v[t]), r: rk.r[t] ? ordinal(rk.r[t]) : "--", rt: rk.r[t] ? `${ordinal(rk.r[t])} of ${rk.n}` : "" }; };
  const ROWS = [
    ["Points", "His points a game / what the defense allows his position a game", him(perG(logOf(x.pid), "pts"), pool.map(([, q]) => perG(q.log || [], "pts")), (v) => fmt(v)), them(ptsAllowed, opp, (v) => fmt(v))],
    ["Free Throws", "His free throws tried a game / what the defense allows his position", him(perG(logOf(x.pid), "fta"), pool.map(([, q]) => perG(q.log || [], "fta")), (v) => fmt(v)), them(ftAllowed, opp, (v) => fmt(v))],
    ["Transition", "Share of his points on fast breaks / how often the defense's opponents get out in transition", him(transShare(x.pid), pool.map(([id]) => transShare(id)), pctT), them(transAllowed, opp, pctT)],
    ["Vs Bench", "Share of his possessions against bench units (2 or fewer starters) / points a 100 possessions the defense's bench units allow", him(benchShare(x.pid), pool.map(([id]) => benchShare(id)), pctT), them(benchAllowed, opp, (v) => fmt(v, 0))],
    ["Pace", "His team's pace / the defense's pace (possessions a 48 minutes; 1st = fastest)", them(pace, x.team, (v) => fmt(v)), them(pace, opp, (v) => fmt(v))],
    ["Foul Trouble", "His fouls a 36 minutes (red = foul-prone) / free throws the defense's players at his position draw a game (red = they attack)", him(fouls36(logOf(x.pid)), pool.map(([, q]) => fouls36(q.log || [])), (v) => fmt(v), true), them(draws, opp, (v) => fmt(v), true)],
  ];
  const rows = ROWS.map(([label, tip, a, b]) => {
    const rd = readOf(a.s, b.s);
    return LB(label, tip) + T(a.v, a.s, tip) + T(a.r, a.s, a.rt) + T(b.v, b.s, tip) + T(b.r, b.s, b.rt) + T(rd.t, rd.s, READ_TIP[rd.t]);
  });
  const head = corner(x) + HD(jersey(x.pid), "him", "", nameOf(x.pid)) + HD("Rank", "him") + HD("Allows", "def") + HD("Rank", "def") + HD("Read", "rd");
  // five columns across the same box (every row full, so no blank rows to span)
  return gridOf(head, rows, { bands: [["him", 2, 2], ["def", 4, 2], ["rd", 6, 1]], cls: "rs-five" });
}

// Game Script: his games like tonight (within SCRIPT_RANGE of tonight's spread and total either
// way, PACE_RANGE possessions of tonight's pace, tonight's schedule spots) beside all his games.
function scriptTab(x) {
  const f = logFields();
  const R = RS();
  const log = logOf(x.pid);
  const games = R.games || {};
  const gOf = (r) => games[String(r[f.game])] || [];
  const teams = identityTeams();
  const avgOf = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const season = avgOf(log, "pts"), seasonMin = avgOf(log, "min"), seasonFga = avgOf(log, "fga");
  const line = x.line;
  const rows = [];
  // every number colored against his own season (fewer than SMALL games: faded, never colored)
  const add = (label, rowsIn, tip, all = false) => {
    const a = avgOf(rowsIn, "pts"), m = avgOf(rowsIn, "min"), s = avgOf(rowsIn, "fga");
    const over = line === null ? null : rowsIn.filter((r) => (r[f.pts] || 0) > line).length;
    const small = rowsIn.length < SMALL;
    const vsSeason = (v, base, k) => (small || v === null || !base ? null : (v - base) / base / k);
    const rel = vsSeason(a, season, 0.15);
    const hit = over === null || !rowsIn.length ? null : over / rowsIn.length;
    const hitS = small || hit === null ? null : hit * 2 - 1;
    const sm = small ? " rs-small" : "";
    const smTip = small ? ` (Small Sample: under ${SMALL} games, not colored)` : "";
    rows.push(LB(label, tip) + T(String(rowsIn.length), null, `${tip}${smTip}`, `rs-count${sm}`) + T(fmt(a), rel, `${tip}: ${fmt(a)} points a game (season ${fmt(season)})${smTip}`, sm.trim())
      + T(all ? "--" : sgn(a === null || season === null ? null : a - season), rel, `Points a game minus his season${smTip}`, sm.trim())
      + T(fmt(m), vsSeason(m, seasonMin, 0.1), `Minutes a game (season ${fmt(seasonMin)})${smTip}`, sm.trim())
      + T(fmt(s), vsSeason(s, seasonFga, 0.15), `Shots a game (season ${fmt(seasonFga)})${smTip}`, sm.trim())
      + T(over === null || !rowsIn.length ? "--" : `${over} of ${rowsIn.length}`, hitS, `Games over tonight's line${smTip}`, sm.trim())
      + T(hit === null ? "--" : `${Math.round(hit * 100)}%`, hitS, `Games over tonight's line${smTip}`, sm.trim()));
  };
  const hs = x.g.home_team_spread;
  const sp = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  const tot = x.g.total_line ?? null;
  const tp = teams[x.team] && teams[x.opp] ? (teams[x.team].off_pace + teams[x.opp].off_pace) / 2 : null;
  // the schedule spots left this tab (the owner, 2026-11-03: "too niche")
  add("All Games", log, "Every game this season", true);
  if (sp !== null) add(`Spread ${sgn(sp)}`, log.filter((r) => { const g = gOf(r); return g[2] !== null && g[2] !== undefined && Math.abs((r[f.home] ? g[2] : -g[2]) - sp) <= SCRIPT_RANGE; }), `His games with his team's spread from ${sgn(sp - SCRIPT_RANGE)} to ${sgn(sp + SCRIPT_RANGE)} (tonight ${sgn(sp)})`);
  if (tot !== null) add(`Total ${fmt(tot)}`, log.filter((r) => { const v = gOf(r)[1]; return v !== null && v !== undefined && Math.abs(v - tot) <= SCRIPT_RANGE; }), `His games with a total from ${fmt(tot - SCRIPT_RANGE)} to ${fmt(tot + SCRIPT_RANGE)} (tonight ${fmt(tot)})`);
  if (tp !== null) add(`Pace ${fmt(tp)}`, log.filter((r) => { const v = gOf(r)[0]; return v !== null && v !== undefined && Math.abs(v - tp) <= PACE_RANGE; }), `His games with a pace from ${fmt(tp - PACE_RANGE)} to ${fmt(tp + PACE_RANGE)} (tonight: ${x.team} and ${x.opp}'s average, ${fmt(tp)})`);
  add(x.home ? "Home Games" : "Road Games", log.filter((r) => Boolean(r[f.home]) === x.home), `His ${x.home ? "home" : "road"} games (tonight he's ${x.home ? "home" : "on the road"})`);
  add("Last 10", log.slice(-10), "His last 10 games");
  const cornerTxt = `<div class="rs-t rs-corner" title="His games in spots like tonight's: spread and total within ${SCRIPT_RANGE} points, pace within ${PACE_RANGE} possessions"><span class="rs-key rs-him">${jersey(x.pid)}</span>Like Tonight</div>`;
  const head = cornerTxt + ["Games", "PTS", "+/-", "MIN", "FGA", line === null ? "Over" : `Over ${fmt(line)}`, "Hit %"].map((h) => HD(h, "him")).join("");
  return gridOf(head, rows);
}

// ---- right box ----
// Vs The Line: his last games as bars that touch, tonight's line dashed across them, the line he had
// that night as a line of dots (green = he cleared it); the strip under it counts them.
// The last LINE_DAYS days, one slot a day (the owner, 2026-11-03): a bar when he played, OUT when his
// team played without him, OFF when his team didn't play. His team's days = days 2+ of his current
// teammates played (a player traded in doesn't bring his old team's nights).
const LINE_DAYS = 15;
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
function lineTab(x) {
  const f = logFields();
  const mine = logOf(x.pid);
  const lines = rsOf(x.pid).lines || {};
  if (!mine.length) return gridOf(corner(x) + HD("", "plain", "rs-s7"), []);
  const line = x.line;
  const byDate = Object.fromEntries(mine.map((r) => [r[f.date], r]));
  const teamDays = {};
  let first = null, latest = null;
  for (const [id, p] of Object.entries(seasonBlock().players)) {
    for (const r of p.log || []) {
      const d = r[f.date];
      if (!first || d < first) first = d;
      if (!latest || d > latest) latest = d;
      if (p.team === x.team && id !== String(x.pid)) (teamDays[d] = teamDays[d] || { n: 0, opp: r[f.opp] }).n += 1;
    }
  }
  // the window ends the night before this game, or at the last night anyone has played
  let end = addDays(x.g.date, -1);
  if (latest && latest < end) end = latest;
  const slots = [];
  for (let i = LINE_DAYS - 1; i >= 0; i -= 1) {
    const d = addDays(end, -i);
    if (first && d < first) continue;
    const r = byDate[d];
    const td = teamDays[d];
    slots.push({ d, r, kind: r ? "played" : td && td.n >= 2 ? "out" : "off", opp: r ? r[f.opp] : td && td.n >= 2 ? td.opp : "" });
  }
  const n = slots.length;
  const played = slots.filter((s) => s.r);
  const vals = played.map((s) => s.r[f.pts] || 0);
  const thenOf = (s) => (s.r ? lines[String(s.r[f.game])] ?? null : null);
  const max = Math.max(10, line || 0, ...played.map(thenOf).filter((v) => v !== null), ...vals) * 1.12;
  const pctY = (v) => (v / max) * 100;
  const pts = [];
  const bars = slots.map((s, i) => {
    const pos = `left:${(i / n) * 100}%;width:${100 / n}%`;
    if (!s.r) {
      const tip = s.kind === "out" ? `${gameDate(s.d)}: his team played ${s.opp} without him` : `${gameDate(s.d)}: no game`;
      return `<div class="rs-vday ${s.kind}" style="${pos}"${tipAttr(tip)}><span>${s.kind === "out" ? "OUT" : "OFF"}</span></div>`;
    }
    const v = s.r[f.pts] || 0;
    const then = thenOf(s);
    if (then !== null) pts.push({ x: ((i + 0.5) / n) * 100, y: 100 - pctY(then), v: then, hit: v > then });
    const cls = line === null ? "" : v > line ? " over" : " under";
    const tip = `${gameDate(s.d)} ${s.r[f.home] ? "vs" : "@"} ${s.r[f.opp]}: ${v} pts in ${s.r[f.min]} min, ${s.r[f.fga]} shots${then !== null ? `; his line was ${fmt(then)} (${v > then ? "cleared" : "missed"})` : "; no line saved for that night"}`;
    return `<div class="rs-vbar${cls}" style="${pos};height:${pctY(v)}%"${tipAttr(tip)}><b>${v}</b></div>`;
  }).join("");
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(p.x * 10).toFixed(1)},${(p.y * 10).toFixed(1)}`).join("");
  const dots = pts.map((p) => `<i class="rs-vdot${p.hit ? " hit" : ""}" style="left:${p.x}%;top:${p.y}%"${tipAttr(`His line that night: ${fmt(p.v)} (${p.hit ? "cleared" : "missed"})`)}><em>${fmt(p.v)}</em></i>`).join("");
  const lineMark = line === null ? "" : `<div class="rs-vline" style="bottom:${pctY(line)}%"${tipAttr(`Tonight's line: ${fmt(line)}`)}><em>${fmt(line)}</em></div>`;
  const labels = slots.map((s) => `<span><b>${s.r ? `${s.r[f.home] ? "" : "@"}${s.opp}` : s.kind === "out" ? s.opp : "&nbsp;"}</b>${gameDate(s.d)}</span>`).join("");
  return `<div class="rs-vl"><div class="rs-vplot">${bars}${lineMark}${path ? `<svg class="rs-vpath" viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="${path}"></path></svg>` : ""}${dots}</div><div class="rs-vx">${labels}</div></div>`;
}

// Rotation: when he's on the floor, minute by minute (green = on the floor in most of those games),
// season / last 5 / last game, under quarter headers that carry his points by quarter.
function rotationTab(x) {
  const r = rsOf(x.pid);
  if (!r.rot || !r.rotn || !r.rotn[0]) return gridOf(`<div class="rs-t rs-corner">On The Floor</div>` + HD("", "plain", "rs-s7"), [], { cls: "rs-rot", n: 3 });
  const QN = ["1st", "2nd", "3rd", "4th"];
  // four quarter blocks of 12 minutes, a clear gap between quarters
  const strip = (counts, nGames, label) => LB(label) + `<div class="rs-strip rs-s7">${QN.map((q, qi) => `<span>${counts.slice(qi * 12, qi * 12 + 12).map((c, k) => `<i style="${c ? stepStyle((c / nGames) * 2 - 1) : ""}"${tipAttr(`Minute ${qi * 12 + k + 1} (${q} quarter): on the floor in ${c} of ${nGames} game${nGames === 1 ? "" : "s"}`)}></i>`).join("")}</span>`).join("")}</div>`;
  const games = r.rotn[0];
  const qs = (r.q || [0, 0, 0, 0]).map((v) => v / games);
  const qTot = qs.reduce((a, b) => a + b, 0);
  const rows = [
    strip(r.rot, games, "Season"), strip(r.rot5, r.rotn[1], `Last ${r.rotn[1]}`), r.rot1 ? strip(r.rot1, 1, "Last Game") : LB("Last Game") + T("--", null, "", "rs-s7"),
  ];
  // the quarter headers carry his points a game in that quarter, colored by his share of his points
  // (the owner, 2026-11-03: the rows under the strips were noise answered elsewhere)
  const qHead = (q, i) => {
    const s = qTot ? (qs[i] / qTot - 0.25) / 0.08 : null;
    return `<div class="rs-t rs-h rs-qt"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(`${fmt(qs[i])} points a game in the ${q} quarter (${qTot ? Math.round((qs[i] / qTot) * 100) : 0}% of his points)`)}>${q} Qtr<b>${fmt(qs[i])} Pts</b></div>`;
  };
  const head = `<div class="rs-t rs-corner">On The Floor</div><div class="rs-qh rs-s7">${QN.map(qHead).join("")}</div>`;
  return gridOf(head, rows, { cls: "rs-rot", n: 3 });
}

// Teammates: his shots and points a 36 with each teammate on the floor and off it, how often they
// share the floor, the change, and the teammate's assists on his makes. With and Without are both
// colored against his usual rate (both sides of a pair always get a color).
function teammatesTab(x) {
  const p = playerOf(x.pid) || {};
  const feedRow = rsOf(x.pid).feed || [0, []];
  const feed = Object.fromEntries(feedRow[1]);
  const makes = feedRow[0];
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team).sort((a, b) => b[1][0] - a[1][0]).slice(0, RS_ROWS);
  const all = mates.length ? mates[0][1] : [0, 0, 0, 0, 0, 0];
  const usualPts = per36(all[1] + all[4], all[0] + all[3]), usualShots = per36(all[2] + all[5], all[0] + all[3]);
  const vs = (v, usual, k) => (v === null || usual === null ? null : (v - usual) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, pOn, fOn, mOff, pOff, fOff] = w;
    const together = mOn / (mOn + mOff);
    const on = per36(pOn, mOn), off = mOff >= 20 ? per36(pOff, mOff) : null;
    const sOn = per36(fOn, mOn), sOff = mOff >= 20 ? per36(fOff, mOff) : null;
    const diff = off === null ? null : off - on;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return `<div class="rs-t rs-l${isOut(st) ? " rs-out" : ""}">${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}</div>`
      + T(pctT(together), together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`)
      + T(fmt(sOn), vs(sOn, usualShots, 3), `His shots a 36 with ${name} on the floor (his usual ${fmt(usualShots)})`)
      + T(fmt(sOff), vs(sOff, usualShots, 3), `His shots a 36 with ${name} off the floor (his usual ${fmt(usualShots)})`)
      + T(fmt(on), vs(on, usualPts, 4), `His points a 36 with ${name} on the floor (${Math.round(mOn)} min; his usual ${fmt(usualPts)})`)
      + T(fmt(off), vs(off, usualPts, 4), `His points a 36 with ${name} off the floor (${Math.round(mOff)} min; his usual ${fmt(usualPts)})`)
      + T(diff === null ? "--" : sgn(diff), diff === null ? null : diff / 6, `Points a 36 without ${name} minus with: green = he scores more when ${name} sits`)
      + T(feed[id] ? String(feed[id]) : "--", feed[id] && makes ? (feed[id] / makes) * 8 - 1 : null, `${name}'s assists on his made shots${makes ? ` (${feed[id] || 0} of his ${makes})` : ""}`);
  });
  const head = corner(x) + HD("Together", "plain", "", "Share of his minutes with that teammate on the floor") + HD("Shots With", "him") + HD("Shots W/O", "him") + HD("Pts With", "him") + HD("Pts W/O", "him") + HD("Change", "him", "", "Points a 36 without minus with") + HD("Assists", "plain", "", "That teammate's assists on his made shots");
  return gridOf(head, rows, { cls: "rs-wide" });
}

const RS_TAB = { Form: formTab, Scoring: scoringTab, Matchup: matchupTab, "Game Script": scriptTab, "Vs The Line": lineTab, Rotation: rotationTab, Teammates: teammatesTab };
const RS_TAB_TIP = {
  Form: "His season, last 10 and last 5 beside what tonight's defense allows his position (season, last 5). His season is colored against his position; the defense's by its rank of 30 (green = allows the most).",
  Scoring: "Where his points come from (share, rank among his position, points a game) beside what tonight's defense allows his position, and the read.",
  Matchup: "His side and the defense's side of the same thing. More / Fewer only when one side clearly points one way and the other doesn't point the other way.",
  "Game Script": `His games like tonight: within ${SCRIPT_RANGE} points of tonight's spread and total either way, within ${PACE_RANGE} possessions of tonight's pace, his home or road games and his last 10, each colored against his season. Fewer than ${SMALL} games is too few to lean on (faded, uncolored).`,
  "Vs The Line": `His last ${LINE_DAYS} days against tonight's line (dashed): a bar a game, OUT when his team played without him, OFF when it didn't play. The dots are the line he had that night (green = cleared).`,
  Rotation: "When he's on the floor at each minute (green = most of his games), with his points a game in each quarter in its header.",
  Teammates: "His shots and points a 36 with each teammate on the floor and off it (green / red = above / below his usual), time together, and that teammate's assists on his makes.",
};
const sandbox = (x, side) => `<div class="rs-sb" data-side="${side}"><div class="rs-tabs">${RS_TABS[side].map((t) => `<button type="button" class="${t === RSV[side] ? "on" : ""}" data-rs-tab="${side}:${t}" title="${RS_TAB_TIP[t]}">${t}</button>`).join("")}</div><div class="rs-sbody">${RS_TAB[RSV[side]](x)}</div></div>`;
function panel(x) {
  if (!PROPS.research) return '<div class="rs-panel"><p class="rs-none">The research data comes with the next data build.</p></div>';
  return `<div class="rs-panel">${sandbox(x, "left")}${sandbox(x, "right")}</div>`;
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
  const tab = e.target.closest("#rs-list [data-rs-tab]");
  if (tab) {
    const [side, name] = tab.dataset.rsTab.split(":");
    RSV[side] = name;
    const box = tab.closest(".rs-sb");
    const x = OPEN && rowsOn(days()[dayIndex]).find((r) => `${r.g.game_id}:${r.pid}` === OPEN);
    if (box && x) box.outerHTML = sandbox(x, side);
    return;
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
