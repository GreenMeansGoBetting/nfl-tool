// GMG NBA Suite: the player-props board every NBA prop page shares (Points,
// Threes; built 2026-10-23, the owner: "we want users to feel comfortable ...
// moving from sport to sport. Everything we create should mimic the other
// tools in form and function"). The play reads like the NHL pages: Play, GMG
// Fair, Odds, Good To, Edge; every column sorts (Edge by default); a tag
// filter; the hit rates grouped under one "Hit Rate" header.
//
// A page loads this file after its own config, `PB_PAGE`:
//   { stat: "threes",                  // the book_odds market
//     slateKey, recordKey,             // props.json keys (`slate` / `record` for Points)
//     made: "fg3m", unit: "3PM",       // the log field hit rates count, and the Play chip's word
//     seasonKey, ytd: {key, label, splits},
//     before: [col], after: [col],     // the page's own columns around the shared ones (see COL below)
//     tags(r) -> [tag],                // the page's own tags; shared ones are added here
//     viewTop(r) -> html,              // the drop down's right column, above Shot Zones
//     zonesPts: "all" | "3", wwFloor: true | false, noun: "points lines" }
// The page does no projection math: the build's `slate` row carries the
// projection and our chance of the Over (nfl_tool/nba/props.py); the page
// works out the play against the member's own books, hit rates, tags and the
// drop down.

let DATA = null;
let PROPS = null;
let season = null;
let dayIndex = 0;
let openId = null;
let sortBy = { key: "edge", dir: -1 };
let gameId = ""; // the game strip's pick ("" = All Games)
const GOOD_TO = 0.03; // Good To: the worst price that still leaves this much edge; Edge is green from here
const MIN_UP_MAX = 32; // a player already this many minutes a game gets no Min up tag

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="nba-headshot" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "--" : Number(n).toFixed(d));
const pct = (n) => (n === null || n === undefined ? "--" : `${Math.round(n * 100)}%`);
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}

const block = () => PROPS.seasons[season] || { players: {}, out: {}, fields: [] };
const F = () => Object.fromEntries((block().fields || []).map((f, i) => [f, i]));
const thisSeason = () => String(DATA.season);
const identityBlock = () => ((DATA.identity || {}).seasons || {})[season] || null;
const slate = () => PROPS[PB_PAGE.slateKey] || {};

// ---- the slate ----
const days = () => [...new Set(DATA.schedule.filter((g) => slate()[g.game_id]).map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && slate()[g.game_id]);
function bookRow(g, pid, stat = PB_PAGE.stat) {
  return ((((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {})[stat] || {})[pid] || null;
}

// ---- hit rates: games over tonight's line (a push isn't over), "x of y" ----
function hits(rows, line) {
  if (line === null || line === undefined || !rows.length) return null;
  const f = F();
  return { over: rows.filter((x) => x[f[PB_PAGE.made]] > line).length, of: rows.length };
}
const hitShare = (h) => (h ? h.over / h.of : -1);
// Every cell colored by its percentage (the owner, 2026-10-23): red at 20% or
// less, yellow at 50%, green at 80% or more, stronger the farther from 50%.
// The "x of y" under it says how many games it is.
function hitCell(h, title) {
  if (!h) return `<td class="num pts-hit">--</td>`;
  const share = h.over / h.of;
  const hue = Math.round(Math.max(0, Math.min(1, (share - 0.2) / 0.6)) * 135);
  const style = ` style="background:${scaleHsla(hue, 78, 44, 0.24 + Math.min(0.3, Math.abs(share - 0.5)) * 1.1)}"`;
  return `<td class="num pts-hit"${style} title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}

// ---- the play (the NHL pages' way) ----
// The side our projection LEANS (our chance of the Over vs the books' no-vig
// chance; Points: the projection vs the line), priced at its best price across
// the member's books. With the books' cut both sides are often negative; this
// never shows the less-bad side we lean against (the owner, 2026-10-23, on
// Pippen: "why is the play over 1.5 at a negative edge - why not list that as
// an under?"). GMG Fair = our chance as a price with no cut; Good To = the
// worst price that still leaves GOOD_TO of edge; Edge = our chance minus the
// chance the price needs to break even, in points. The record grades the same
// rule (props.threes_play, at the best price across every book).
function leanSide(r) {
  const row = r.row;
  const [a, b] = row.p_mkt !== null && row.p_mkt !== undefined ? [row.p_over, row.p_mkt] : [row.proj, r.line];
  return a === null || a === undefined || b === null || b === undefined || a === b ? null : a > b ? "o" : "u";
}
const fairPrice = (p) => (p === null || p === undefined || p <= 0 || p >= 1 ? null : probToAmerican(p));
const points = (edge) => `${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}`;
function playFor(r) {
  const p = r.row.p_over;
  if (p === null || p === undefined || r.line === null || r.line === undefined) return null;
  const side = leanSide(r);
  if (!side) return null;
  const chance = side === "o" ? p : 1 - p;
  const best = bookBest((bookRow(r.g, r.pid) || {}).q || [], side, r.line);
  return best ? { side, chance, price: best[3], book: best[0], edge: chance - oddsProb(best[3]) } : null;
}
function projTitle(r) {
  return r.row.ours === null || r.row.ours === undefined ? "No games this season yet: the projection is the books' number"
    : `Our number ${fmt(r.row.ours, 1)}; the projection weighs it ${Math.round(r.row.w * 100)}% against the books' (more as his games come in)`;
}

// ---- tags (each {key, label, cls, title}; the filter lists the keys on the day) ----
const TAG = (key, label, title, cls = "") => ({ key, label, title, cls });
// Minutes from injuries (the owner, 2026-10-23): a rotation teammate at his
// spot listed Out tonight = more minutes; one who sat the team's last game and
// isn't listed Out tonight = back, fewer minutes.
const POS_GROUP = { PG: "G", SG: "G", G: "G", SF: "F", PF: "F", F: "F", C: "C" };
function outTonight(tm) {
  return new Set(((DATA.injuries || {})[tm] || []).filter((x) => x.status === "Out").map((x) => String(x.id)));
}
function minutesTags(r) {
  if (!r.p) return [];
  const f = F();
  const players = block().players;
  const group = POS_GROUP[r.p.pos] || "";
  const avgMin = (p) => ((p.log || []).length ? p.log.reduce((a, x) => a + x[f.min], 0) / p.log.length : 0);
  const mates = Object.entries(players).filter(([id, p]) => id !== r.pid && p.team === r.tm && POS_GROUP[p.pos] === group && avgMin(p) >= 20);
  const out = outTonight(r.tm);
  const tags = [];
  const gone = mates.filter(([id]) => out.has(id));
  if (gone.length && avgMin(r.p) < MIN_UP_MAX) {
    tags.push(TAG("min_up", "Min &uarr;", `${gone.map(([, p]) => p.name).join(", ")} (${gone.length > 1 ? "rotation players" : "a rotation player"} at his spot) ${gone.length > 1 ? "are" : "is"} listed Out tonight`));
  }
  // the team's latest game: who sat it
  const lastGame = (r.log.length ? r.log[r.log.length - 1][f.game] : null);
  const sat = new Set(((block().out[r.tm] || {})[String(lastGame)] || []).map(([id]) => id));
  const back = mates.filter(([id]) => sat.has(id) && !out.has(id));
  if (back.length) tags.push(TAG("min_down", "Min &darr;", `${back.map(([, p]) => p.name).join(", ")} sat the last game and ${back.length > 1 ? "aren't" : "isn't"} listed Out tonight`));
  return tags;
}
function tagsFor(r) {
  const own = PB_PAGE.tags(r) || [];
  const shared = [];
  if (r.row.missing > 0.04) shared.push(TAG("usage", `Usage +${Math.round(r.row.missing * 100)}%`, `Rotation teammates listed Out tonight took ${pct(r.row.missing)} of the team's shots this season`));
  return [...own, ...shared, ...minutesTags(r)];
}
const tagHtml = (t) => `<span class="${t.cls ? `gs-tag ${t.cls}` : "pts-tag"}" title="${t.title}">${t.label}</span>`;

// ---- one player's row ----
function rosterTeam(pid, g) {
  const cur = (PROPS.seasons[thisSeason()] || { players: {} }).players[pid];
  if (cur && (cur.team === g.away || cur.team === g.home)) return cur.team;
  return g.away;
}
function rowFor(g, pid, row) {
  const f = F();
  const p = block().players[pid] || null;
  const tm = (p && (p.team === g.away || p.team === g.home)) ? p.team : rosterTeam(pid, g);
  const opp = tm === g.home ? g.away : g.home;
  const home = tm === g.home;
  const log = p ? p.log : [];
  const line = row.line;
  const avg = (key) => (log.length ? log.reduce((a, x) => a + x[f[key]], 0) / log.length : null);
  const r = {
    pid, g, tm, opp, home, p, row, line, log, avg,
    name: (p && p.name) || (bookRow(g, pid) || {}).name || pid,
    l5: hits(log.slice(-5), line),
    l10: hits(log.slice(-10), line),
    all: hits(log, line),
    homeH: hits(log.filter((x) => x[f.home] === 1), line),
    awayH: hits(log.filter((x) => x[f.home] === 0), line),
  };
  r.play = playFor(r);
  r.tags = tagsFor(r);
  return r;
}

// ---- columns: {key (sort), label, title, cls, group, value(r) for sorting, cell(r)} ----
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? -Infinity : v);
const COL = {
  player: { key: "name", label: "Player", value: (r) => r.name, cell: (r) => `<td><div class="pts-player" data-open="${r.pid}">${headshot(r.pid)}<span><b>${playerClick(r.pid, r.name)}</b> <span class="muted-label">${(r.p && r.p.pos) || ""}</span>${r.row.out ? ' <span class="gs-inj-status tier-bad">Out</span>' : ""}<br><span class="muted-label">${logo(r.tm, 14)} ${r.tm} ${r.home ? "vs" : "@"} ${logo(r.opp, 14)} ${r.opp}</span></span></div></td>` },
  play: { key: "play", label: "Play", title: "The side of his main line our projection leans; green / red Edge says if the price is good enough", value: (r) => (r.play ? r.play.edge : null),
    cell: (r) => (r.play ? `<td class="th-play-cell"><span class="th-play th-play-${r.play.side}" title="${r.play.side === "o" ? "Over" : "Under"} ${fmt(r.line)} ${PB_PAGE.unit}: the side our projection leans"><b>${r.play.side}${fmt(r.line)}</b><span>${PB_PAGE.unit}</span></span></td>` : `<td class="th-play-cell">--</td>`) },
  proj: { key: "proj", label: PB_PAGE.projLabel || "Proj", title: "What we project tonight (in testing)", cls: "th-tight", value: (r) => r.row.proj,
    cell: (r) => `<td class="num th-proj th-tight" title="${projTitle(r)}"><b>${r.row.proj === null || r.row.proj === undefined ? "--" : fmt(r.row.proj, PB_PAGE.projDigits || 1)}</b>${r.row.games ? "" : "<small>No Games</small>"}</td>` },
  fair: { key: "fair", label: "GMG Fair", cls: "th-tight", title: "Our chance as a price with no cut. Odds longer than this are the edge", value: (r) => (r.play ? r.play.chance : null),
    cell: (r) => `<td class="num th-fair th-tight"${r.play ? ` title="Our chance: ${pct(r.play.chance)}"` : ""}>${r.play && fairPrice(r.play.chance) !== null ? showOdds(fairPrice(r.play.chance)) : "--"}</td>` },
  odds: { key: "odds", label: "Odds", cls: "th-tight", title: "The best price across your books. Click for every book", value: (r) => (r.play ? oddsDecimal(r.play.price) : null),
    cell: (r) => {
      if (!r.play) return `<td class="num th-odds">--</td>`;
      const spec = { kind: "prop", stat: PB_PAGE.stat, team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side: r.play.side, line: r.line, title: `${r.name} ${PB_PAGE.unit}`, sub: `${r.tm} vs ${r.opp}` };
      // the book's initials under the price (its name on hover) keep the column narrow (the owner, 2026-10-23)
      const book = BOOK_NAMES[r.play.book] || r.play.book;
      return `<td class="num th-odds th-tight"><button type="button" class="bo-pill" data-bo="${boEnc(spec)}" title="Best price across your books: ${book}. Click for every book.">${showOdds(r.play.price)}<small>${BOOK_INITIALS[r.play.book] || book}</small></button></td>`;
    } },
  // Good To only on a play (an edge of GOOD_TO+ at today's price): on anything less it would name a
  // price better than the books offer, which reads backwards (the owner, 2026-10-23: "weird").
  goodto: { key: "goodto", label: "Good To", cls: "th-tight", title: `The worst price this still has a ${Math.round(GOOD_TO * 100)}-point edge at. Past this, it is no longer a play`,
    value: (r) => (r.play && r.play.edge >= GOOD_TO ? r.play.chance : null),
    cell: (r) => { const v = r.play && r.play.edge >= GOOD_TO ? fairPrice(r.play.chance - GOOD_TO) : null; return `<td class="num th-goodto th-tight">${v === null ? "--" : showOdds(v)}</td>`; } },
  // Green from GOOD_TO (a play), red below 0 (no play: the record grades only positive edges), deeper the farther.
  edge: { key: "edge", label: "Edge", title: "Our chance minus the chance the price needs to break even, in points. Green from 3 (a play), red below 0", cls: "th-narrow", value: (r) => (r.play ? r.play.edge : null),
    cell: (r) => {
      const x = r.play;
      if (!x) return `<td class="num th-edge">--</td>`;
      const cls = x.edge >= GOOD_TO ? "tier-good" : x.edge < 0 ? "tier-bad" : "";
      const depth = x.edge >= GOOD_TO ? x.edge - GOOD_TO : -x.edge;
      const alpha = cls ? ` style="--tier-a:${Math.min(0.34, 0.1 + depth * 3).toFixed(2)}"` : "";
      return `<td class="num th-edge ${cls}"${alpha} title="Our ${pct(x.chance)} minus the ${pct(oddsProb(x.price))} this price needs to break even">${points(x.edge)}</td>`;
    } },
  l5: { key: "l5", label: "L5", group: "hit", title: "His last 5 games over tonight's line", value: (r) => hitShare(r.l5), cell: (r) => hitCell(r.l5, "Last 5 games over tonight's line") },
  l10: { key: "l10", label: "L10", group: "hit", title: "His last 10 games over tonight's line", value: (r) => hitShare(r.l10), cell: (r) => hitCell(r.l10, "Last 10 games over tonight's line") },
  season: { key: "season", label: "Season", group: "hit", title: "This season's games over tonight's line", value: (r) => hitShare(r.all), cell: (r) => hitCell(r.all, "This season's games over tonight's line") },
  homeH: { key: "home", label: "Home", group: "hit", title: "Home games over tonight's line", value: (r) => hitShare(r.homeH), cell: (r) => hitCell(r.homeH, "Home games over tonight's line") },
  awayH: { key: "away", label: "Away", group: "hit", title: "Road games over tonight's line", value: (r) => hitShare(r.awayH), cell: (r) => hitCell(r.awayH, "Road games over tonight's line") },
  tags: { key: "tags", label: "Tags", value: (r) => r.tags.length, cell: (r) => `<td><div class="pts-tags">${r.tags.map(tagHtml).join("")}</div></td>` },
};
// a per-game average column from the log
const avgCol = (key, field, label, title) => ({ key, label, title, cls: "th-tight", value: (r) => r.avg(field), cell: (r) => `<td class="num th-avg th-tight">${fmt(r.avg(field))}</td>` });
// (a page's column list may be a function: its config is read before this file's helpers exist)
const part = (x) => (typeof x === "function" ? x() : x || []);
const columns = () => [COL.player, COL.play, ...part(PB_PAGE.before), COL.proj, COL.fair, COL.odds, COL.goodto, COL.edge,
  ...part(PB_PAGE.after), COL.l5, COL.l10, COL.season, COL.homeH, COL.awayH, ...part(PB_PAGE.end), COL.tags];

// ---- the live record (the testing banner + YTD Model Performance) ----
// props.json <recordKey>.ledger = [date, edge (our chance minus what the price
// needs), won, units at the best price, tags] (props.record_ledger / threes_ledger).
const ledger = () => (PROPS[PB_PAGE.recordKey] || {}).ledger || [];
function renderRecord() {
  const all = ledger();
  const wins = all.filter((x) => x[2]).length;
  const n = all.length;
  const units = all.reduce((a, x) => a + (x[3] || 0), 0);
  el("pts-record").innerHTML = n
    ? `<span class="pts-rec-label">Record So Far</span><span class="pts-rec-num">${wins}-${n - wins}<small>${Math.round((100 * wins) / n)}% &middot; ${units >= 0 ? "+" : ""}${units.toFixed(1)}u</small></span>
       <button type="button" class="view-toggle-btn" id="pts-ytd">YTD Model Performance</button>`
    : `<span class="pts-rec-label">Record So Far</span><span class="pts-rec-num">0-0</span><small class="muted-label">First Grades After Tonight's Games</small>`;
}
function renderYtd() {
  const overlay = ensureBookModal("pts-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="pts-ytd-tracker"></div>
    <p class="no-data-note">Every play (the side our chance beat its best price by more, a positive edge only), graded at the best price at tip-off, 1 unit. Pushes and players who sat don't count.</p>`;
  ytdTracker(content.querySelector(".pts-ytd-tracker"), {
    key: PB_PAGE.ytd.key,
    markets: [{ key: PB_PAGE.ytd.key, label: PB_PAGE.ytd.label, ledger: ledger(), min: 0, max: 10, step: 1, scale: 100, unit: "%+",
                tip: "Every play with at least the minimum edge", splits: PB_PAGE.ytd.splits }],
  });
  overlay.hidden = false;
}

function renderRow(r, cols) {
  const open = openId === `${r.g.game_id}:${r.pid}`;
  return `<tr class="${r.row.out ? "pts-row-out" : ""}" data-key="${r.g.game_id}:${r.pid}">${cols.map((c) => c.cell(r)).join("")}</tr>${open ? `<tr class="pts-open"><td colspan="${cols.length}">${playerView(r)}</td></tr>` : ""}`;
}

// ---- the player view (the drop down) ----
// Left: with / without a teammate, then every book's price (main lines; the
// rest behind Show Other Lines). Right: the page's own piece (Threes: the
// ladder), then his shots next to every shot tonight's defense has allowed.
let ww = { mate: "", mode: "out" };
function playerView(r) {
  const books = bookOddsPanel({ kind: "prop", stat: PB_PAGE.stat, team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side: "o", line: r.line, title: `${r.name} ${PB_PAGE.unit}`, sub: `${r.tm} vs ${r.opp}`, collapseOthers: true });
  return `<div class="pts-view"><div class="pts-view-left"><div><h4>With / Without</h4>${withWithout(r)}</div><div><h4>Every Book</h4>${books || '<p class="no-data-note">No book has this line right now.</p>'}</div></div>
    <div class="pts-view-zones">${PB_PAGE.viewTop ? PB_PAGE.viewTop(r) : ""}<h4 class="th-zones-head">Shot Zones: ${r.name} vs ${r.opp} Defense</h4>${zonesView(r)}</div></div>`;
}

// His shots next to every shot tonight's defense has allowed (shot-chart.js),
// one set of filters for both, then the zones where both sides point the
// same way (nbaShotCall, the Shot Charts page's Target / Tough rule).
function zonesView(r) {
  const file = nbaShotFile();
  if (file === undefined) {
    Promise.resolve(NBA_SHOT_FILE).then(() => renderBoard());
    return `<p class="no-data-note">Loading&hellip;</p>`;
  }
  if (!file) return `<p class="no-data-note">Shot charts aren't available right now.</p>`;
  const league = file.league || [];
  const mine = nbaShotPick((file.players || {})[String(r.pid)] || [], NBA_SHOT_STATE);
  const allowed = nbaShotPick(nbaShotAllowed(file, r.opp), NBA_SHOT_STATE);
  const fg = (shots) => `${shots.length} Shots &middot; FG ${nbaShotPct(shots.reduce((n, s) => n + s[2], 0), shots.length)}`;
  const chart = (shots, opts) => (!shots.length ? `<p class="no-data-note">No shots with these filters.</p>`
    : `<div class="nba-shot-chart">${NBA_SHOT_STATE.view === "heat" ? nbaShotHeatView(shots, league, opts) : nbaShotZonesView(shots, league, opts)}</div>`);
  const side = (abbr, label, shots, opts) => `<div class="pts-zone-side"><div class="pts-zone-head">${logo(abbr, 16)} <b>${label}</b><small>${fg(shots)}</small></div>${chart(shots, opts)}</div>`;
  const ours = nbaShotZoneTotals(mine, false);
  const theirs = nbaShotZoneTotals(allowed, false);
  const lg = nbaShotZoneTotals(league, true);
  const calls = [];
  NBA_SHOT_GROUPS.forEach(([group, zones]) => zones.forEach(([z, name]) => {
    const lr = lg[z] && lg[z][1] ? lg[z][0] / lg[z][1] : null;
    const share = mine.length ? (ours[z] || [0, 0])[1] / mine.length : 0;
    const call = nbaShotCall(ours[z], theirs[z], lr, share);
    if (call) calls.push(`<span class="pts-zone-call" style="background:${nbaShotColor(call * NBA_SHOT_FULL, 0.3)};border-color:${nbaShotColor(call * NBA_SHOT_FULL, 0.8)}" title="${Math.round(share * 100)}% of his shots">${call === 1 ? "Target" : "Tough"}: ${group === "Threes" ? `${name} 3` : group === "Mid-Range" ? `Mid ${name}` : name}</span>`);
  }));
  return `<div class="nba-shot-controls">${nbaShotControls()}</div>
    <div class="pts-zone-pair">${side(r.tm, r.name, mine)}${side(r.opp, `${r.opp} Defense Allows`, allowed, { allowed: true })}</div>
    <div class="pts-zone-calls">${calls.length ? calls.join("") : '<span class="muted-label">No zone where both sides point the same way.</span>'}
      <a class="pts-zone-more" href="shot-charts.html#p=${r.pid}&d=${r.opp}">Zone By Zone &rsaquo;</a></div>`;
}

function teammates(r) {
  const players = block().players;
  if (!r.p) return [];
  const ids = new Set(Object.keys(r.p.with || {}));
  // teammates who sat any of his games also count (an injured star may never share the floor)
  const outs = block().out[r.tm] || {};
  const f = F();
  r.log.forEach((x) => (outs[String(x[f.game])] || []).forEach(([id]) => ids.add(id)));
  const minutes = (id) => (players[id].log || []).reduce((a, x) => a + x[f.min], 0);
  return [...ids].filter((id) => players[id] && id !== r.pid).sort((a, b) => minutes(b) - minutes(a));
}

// Game by game: his games a teammate sat (by reason) against games they both
// played; Points also splits his minutes by whether the teammate was on the floor.
function withWithout(r) {
  const mates = teammates(r);
  if (!mates.length) return `<p class="no-data-note">No teammates on file for ${block().label}.</p>`;
  if (!mates.includes(ww.mate)) ww.mate = mates[0];
  const players = block().players;
  const f = F();
  const modeBtn = (m, label) => `<button type="button" class="view-toggle-btn${ww.mode === m ? " active" : ""}" data-ww-mode="${m}">${label}</button>`;
  const controls = `<div class="pts-ww-controls"><select data-ww-mate>${mates.map((id) => `<option value="${id}"${id === ww.mate ? " selected" : ""}>${players[id].name}</option>`).join("")}</select>
    ${modeBtn("out", "Out (any)")}${modeBtn("rest", "Out: rest")}${modeBtn("injury", "Out: injured")}${PB_PAGE.wwFloor ? modeBtn("floor", "Off the floor") : ""}</div>`;
  const mate = players[ww.mate];
  if (ww.mode === "floor") {
    const w = (r.p.with || {})[ww.mate];
    if (!w) return `${controls}<p class="no-data-note">They didn't share 20+ minutes on the floor in ${block().label}.</p>`;
    const per36 = (v, min) => (min > 0 ? (v * 36) / min : null);
    return `${controls}<table class="data-table"><thead><tr><th>${mate.name}</th><th>Minutes</th><th>Pts / 36</th><th>Shots / 36</th></tr></thead><tbody>
      <tr><td>On the floor</td><td class="num">${fmt(w[0], 0)}</td><td class="num"><b>${fmt(per36(w[1], w[0]))}</b></td><td class="num">${fmt(per36(w[2], w[0]))}</td></tr>
      <tr><td>Off the floor</td><td class="num">${fmt(w[3], 0)}</td><td class="num"><b>${fmt(per36(w[4], w[3]))}</b></td><td class="num">${fmt(per36(w[5], w[3]))}</td></tr>
      </tbody></table><p class="pts-ww-note">Every minute ${r.name} played this season, split by whether ${mate.name} was on the floor with him.</p>`;
  }
  const outs = block().out[r.tm] || {};
  const mateGames = new Set((mate.log || []).map((x) => x[f.game]));
  const sat = r.log.filter((x) => (outs[String(x[f.game])] || []).some(([id, why]) => id === ww.mate && (ww.mode === "out" ? true : why === ww.mode)));
  const together = r.log.filter((x) => mateGames.has(x[f.game]));
  const cols = PB_PAGE.wwCols; // [[field, label], ...]: the first is bold
  const summary = (rows, label) => {
    if (!rows.length) return `<tr><td>${label}</td><td class="num">0</td>${cols.map(() => '<td class="num">--</td>').join("")}<td class="num">--</td></tr>`;
    const avg = (k) => rows.reduce((a, x) => a + x[f[k]], 0) / rows.length;
    const h = hits(rows, r.line);
    return `<tr><td>${label}</td><td class="num">${rows.length}</td>${cols.map(([k], i) => `<td class="num">${i ? fmt(avg(k)) : `<b>${fmt(avg(k))}</b>`}</td>`).join("")}<td class="num">${h ? `${h.over} of ${h.of}` : "--"}</td></tr>`;
  };
  const label = { out: "Out", rest: "Out: rest", injury: "Out: injured" }[ww.mode];
  return `${controls}<table class="data-table"><thead><tr><th>${mate.name}</th><th>Games</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}<th>Over ${fmt(r.line)}</th></tr></thead><tbody>
    ${summary(together, "Played")}${summary(sat, label)}</tbody></table>
    <p class="pts-ww-note">${r.name}'s games in ${block().label}, split by whether ${mate.name} played. "Out" reasons come from the box score's DNP note.</p>`;
}

// ---- the board ----
function dayRows() {
  const date = days()[dayIndex];
  const out = [];
  for (const g of gamesOn(date)) {
    if (gameId && gameId !== g.game_id) continue;
    for (const [pid, row] of Object.entries(slate()[g.game_id] || {})) out.push(rowFor(g, pid, row));
  }
  return out;
}
function rows(all) {
  const search = (el("pts-search").value || "").toLowerCase();
  const tag = el("pts-tag").value;
  const col = columns().find((c) => c.key === sortBy.key) || COL.edge;
  const kept = all.filter((r) => (!search || r.name.toLowerCase().includes(search)) && (!tag || r.tags.some((t) => t.key === tag)));
  // dir -1 = high to low (Z-A), 1 = low to high (A-Z); a missing value is last either way
  const cmp = (a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (typeof va === "string" || typeof vb === "string") return sortBy.dir * String(va || "").localeCompare(String(vb || ""));
    const na = num(va);
    const nb = num(vb);
    if (na === nb) return 0;
    if (na === -Infinity || nb === -Infinity) return na === -Infinity ? 1 : -1;
    return sortBy.dir * (na > nb ? 1 : -1);
  };
  // Out players last, whatever the sort (a missing value sorts last too)
  return kept.sort((a, b) => (a.row.out - b.row.out) || cmp(a, b));
}

function renderTagPicker(all) {
  const cur = el("pts-tag").value;
  const seen = new Map();
  all.forEach((r) => r.tags.forEach((t) => { if (!seen.has(t.key)) seen.set(t.key, t.key === "usage" ? "Usage +" : t.key === "dog" ? "Underdog" : t.label); }));
  el("pts-tag").innerHTML = `<option value="">All Tags</option>${[...seen].map(([k, label]) => `<option value="${k}">${label}</option>`).join("")}`;
  if (seen.has(cur)) el("pts-tag").value = cur;
}

// The site's top bar is sticky; on PC the board's header sticks right under it (points.css).
function measureTopbar() {
  const bar = document.querySelector(".topbar");
  document.documentElement.style.setProperty("--pb-top", `${bar ? bar.offsetHeight : 0}px`);
}
window.addEventListener("resize", measureTopbar);

function renderBoard() {
  measureTopbar();
  const all = dayRows();
  renderTagPicker(all);
  const list = rows(all);
  el("empty-state").hidden = list.length > 0;
  el("pts-board").hidden = !list.length;
  if (!list.length) {
    el("empty-state").innerHTML = all.length ? "<p>No players match these filters.</p>" : `<p>No ${PB_PAGE.noun} posted for this day yet. The books usually post them the morning of the games.</p>`;
    return;
  }
  const cols = columns();
  const th = (c) => {
    const on = c.key === sortBy.key;
    return `<th class="pb-sort${on ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}${c.group ? " pb-g" : ""}" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${c.label}${on ? `<span class="shots-arrow">${sortBy.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  };
  // the group row: one "Hit Rate - Based On 3PM" box over its cells (Icebreaker's look; the owner,
// 2026-10-23: the rates count his makes over the line, not the play, so an Under's red isn't bad news)
  let groupRow = "";
  for (let i = 0; i < cols.length; i += 1) {
    if (cols[i].group) {
      let n = 0;
      while (cols[i + n] && cols[i + n].group) n += 1;
      groupRow += `<th colspan="${n}" class="pb-group" title="How often he went OVER tonight's line (${PB_PAGE.unit}), whichever side the play is"><span>Hit Rate - Based On ${PB_PAGE.unit}</span></th>`;
      i += n - 1;
    } else groupRow += "<th></th>";
  }
  el("pts-table").innerHTML = `<thead><tr class="pb-group-row">${groupRow}</tr><tr>${cols.map(th).join("")}</tr></thead><tbody>${list.map((r) => renderRow(r, cols)).join("")}</tbody>`;
}

// The game strip (the other NBA pages' look, the owner 2026-10-23: "the game header ... it is
// missed"): day arrows, an All Games card, then a card per game; a picked game gets the big header.
function renderGamePicker() {
  const date = days()[dayIndex];
  const games = gamesOn(date);
  if (gameId && !games.some((g) => g.game_id === gameId)) gameId = "";
  el("matchup-row").innerHTML = `<button type="button" class="matchup-card pb-all-games${gameId ? "" : " selected"}" data-game="">
      <span class="matchup-teams-row"><b>All Games</b></span><span class="matchup-date">${games.length} game${games.length === 1 ? "" : "s"}</span></button>`
    + games.map((g) => `<button type="button" class="matchup-card${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${fmtTime(g.time).replace(" ET", "")}</span>
      </button>`).join("");
  const g = games.find((x) => x.game_id === gameId);
  el("game-header").hidden = !g;
  if (!g) return;
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${team(g.away).logo}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${team(g.home).logo}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g.time)}${g.tv ? ` &middot; ${g.tv}` : ""}</div>`;
}

function renderSeasons() {
  el("pts-seasons").innerHTML = Object.keys(PROPS.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${PROPS.seasons[s].label}</button>`)
    .join("") + (PROPS.seasons[thisSeason()] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  el("pts-season-note").textContent = `Hit rates and splits from ${block().label}. Early in the season every rate is a few games.`;
}

function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  renderSeasons();
  renderGamePicker();
  renderRecord();
  renderBoard();
}

function setSeason(s, remember) {
  if (!PROPS.seasons[s]) return;
  season = s;
  if (!remember) return;
  try {
    localStorage.setItem(PB_PAGE.seasonKey, JSON.stringify({ season: s, default: PROPS.default }));
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
}

document.addEventListener("click", (e) => {
  const head = e.target.closest("#pts-table th[data-sort]");
  if (head) {
    const key = head.dataset.sort;
    // a new column starts high-to-low (names A-Z); the same one flips
    sortBy = sortBy.key === key ? { key, dir: -sortBy.dir } : { key, dir: key === "name" ? 1 : -1 };
    return renderBoard();
  }
  const card = e.target.closest("#matchup-row [data-game]");
  if (card) {
    gameId = card.dataset.game;
    openId = null;
    renderGamePicker();
    return renderBoard();
  }
  const opener = e.target.closest("[data-open]");
  if (opener) {
    const key = opener.closest("tr").dataset.key;
    openId = openId === key ? null : key;
    ww = { mate: "", mode: "out" };
    return renderBoard();
  }
  if (e.target.closest("#pts-ytd")) return renderYtd();
  const mode = e.target.closest("[data-ww-mode]");
  if (mode) {
    ww.mode = mode.dataset.wwMode;
    return renderBoard();
  }
  if (e.target.closest("#day-prev") && dayIndex > 0) {
    dayIndex -= 1;
    openId = null;
    return render();
  }
  if (e.target.closest("#day-next") && dayIndex < days().length - 1) {
    dayIndex += 1;
    openId = null;
    return render();
  }
  const s = e.target.closest("#pts-seasons [data-season]");
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
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-ww-mate]")) {
    ww.mate = e.target.value;
    return renderBoard();
  }
  if (e.target.matches("#pts-tag")) renderBoard();
});
document.addEventListener("input", (e) => {
  if (e.target.matches("#pts-search")) renderBoard();
});
// a shot-chart filter in an open row (the player card redraws its own)
document.addEventListener("nba-shot-changed", () => {
  if (openId) renderBoard();
});

Promise.all([fetch("data.json").then((r) => r.json()), fetch("props.json").then((r) => r.json())])
  .then(([data, props]) => {
    DATA = data;
    PROPS = props;
    if (!PROPS || !Object.keys(PROPS.seasons || {}).length) {
      el("empty-state").innerHTML = `<p>${PB_PAGE.title} data isn't available right now.</p>`;
      return;
    }
    if (PB_PAGE.zonesPts) NBA_SHOT_STATE.pts = PB_PAGE.zonesPts; // the drop down's Shot Zones open on this
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(PB_PAGE.seasonKey) || "null");
    } catch (e) {
      // localStorage unavailable or bad JSON.
    }
    setSeason(pick && pick.default === PROPS.default && PROPS.seasons[pick.season] ? pick.season : PROPS.default, false);
    if (!season) setSeason(Object.keys(PROPS.seasons)[0], false);
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    dayIndex = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
