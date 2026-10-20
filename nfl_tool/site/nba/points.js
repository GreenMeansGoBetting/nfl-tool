// GMG NBA Suite: Points. Every player with a points line on the night's slate,
// pure data plus the line-anchored projection (nfl_tool/nba/props.py, build
// side; site/nba/props.json + data.json). The page does no projection math:
// it reads `slate`, and works out hit rates, tags and the player view from
// the season's game logs.
// The owner's plan (2026-10-20, in words): line + best SmartStake price, hit
// rates against tonight's line (L5 / L10 / season / home-road / vs opponent,
// "x of y"), minutes and their trend, shot share, how he scores, two-sided
// matchup tags; click a player for his log, the alt-line ladder and with /
// without a teammate (Out for rest, Out injured, or off the floor).

let DATA = null;
let PROPS = null;
let season = null;
let dayIndex = 0;
let openId = null;
const PTS_SEASON_KEY = "nba-tool.pts-season.v1";
const MIN_TREND = 3; // last-5 minutes this far from the season's = Min up / down
const ZONE_FIT = 0.025; // weighted make rate allowed this far from the league's = Zone fit / Tough zones
const ZONES = ["rim", "short", "mid", "corner3", "above3"];

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

// ---- the slate ----
const days = () => [...new Set(DATA.schedule.filter((g) => (PROPS.slate || {})[g.game_id]).map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && (PROPS.slate || {})[g.game_id]);
function bookRow(g, pid) {
  return ((((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {}).points || {})[pid] || null;
}
const bookName = (g, pid) => (bookRow(g, pid) || {}).name || null;

// ---- hit rates ----
// Games over / of the games, against tonight's line (a push isn't over).
function hits(rows, line) {
  if (line === null || line === undefined || !rows.length) return null;
  const f = F();
  return { over: rows.filter((r) => r[f.pts] > line).length, of: rows.length };
}
function hitCell(h, title) {
  if (!h) return `<td class="num pts-hit">--</td>`;
  const share = h.over / h.of;
  const cls = h.of < 3 ? "" : share >= 0.6 ? "tier-good" : share <= 0.4 ? "tier-bad" : "tier-mid";
  return `<td class="num pts-hit ${cls}" title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}

// ---- matchup tags (two-sided) ----
// Zone fit: his shot zones x what tonight's defense allows there, against
// the league's make rate in those same zones. Both sides count: where HE
// shoots and what THIS defense gives up there.
function zoneFit(p, opp) {
  const ib = identityBlock();
  if (!ib || !p.zones || !ib.teams[opp]) return null;
  let allowed = 0;
  let league = 0;
  let total = 0;
  for (const z of ZONES) {
    const s = p.zones[z] || 0;
    const a = ib.teams[opp][`def_${z}_pct`];
    const l = (ib.league[`def_${z}_pct`] || {}).avg;
    if (a === null || a === undefined || !l) continue;
    allowed += s * a;
    league += s * l;
    total += s;
  }
  return total ? (allowed - league) / total : null;
}
function tags(p, row, g, opp, minutes) {
  const out = [];
  const fit = zoneFit(p, opp);
  if (fit !== null && fit >= ZONE_FIT) out.push(`<span class="gs-tag gs-tag-mismatch" title="${opp} allows ${(fit * 100).toFixed(1)} points of make rate above the league where he shoots">Zone fit</span>`);
  if (fit !== null && fit <= -ZONE_FIT) out.push(`<span class="gs-tag gs-tag-tough" title="${opp} allows ${(-fit * 100).toFixed(1)} points of make rate below the league where he shoots">Tough zones</span>`);
  if (row && row.missing > 0.04) out.push(`<span class="pts-tag" title="Rotation teammates listed Out tonight took ${pct(row.missing)} of the team's shots this season">Usage +${Math.round(row.missing * 100)}%</span>`);
  if (minutes && minutes.l5 !== null && minutes.avg !== null && minutes.games >= 5) {
    if (minutes.l5 - minutes.avg >= MIN_TREND) out.push(`<span class="pts-tag" title="Last 5: ${fmt(minutes.l5)} minutes, season ${fmt(minutes.avg)}">Min &uarr;</span>`);
    if (minutes.avg - minutes.l5 >= MIN_TREND) out.push(`<span class="pts-tag" title="Last 5: ${fmt(minutes.l5)} minutes, season ${fmt(minutes.avg)}">Min &darr;</span>`);
  }
  return out.join("");
}

// ---- one player's row ----
function rowFor(g, pid, row) {
  const f = F();
  const p = block().players[pid] || null;
  const tm = (p && (p.team === g.away || p.team === g.home)) ? p.team : rosterTeam(pid, g);
  const opp = tm === g.home ? g.away : g.home;
  const home = tm === g.home;
  const log = p ? p.log : [];
  const line = row.line;
  const minutes = log.length
    ? { avg: log.reduce((a, r) => a + r[f.min], 0) / log.length, l5: log.slice(-5).reduce((a, r) => a + r[f.min], 0) / Math.min(5, log.length), games: log.length }
    : null;
  return {
    pid, g, tm, opp, home, p, row, line, log, minutes,
    name: (p && p.name) || bookName(g, pid) || pid,
    l5: hits(log.slice(-5), line),
    l10: hits(log.slice(-10), line),
    all: hits(log, line),
    ha: hits(log.filter((r) => r[f.home] === (home ? 1 : 0)), line),
    vs: hits(log.filter((r) => r[f.opp] === opp), line),
  };
}
function rosterTeam(pid, g) {
  const cur = (PROPS.seasons[thisSeason()] || { players: {} }).players[pid];
  if (cur && (cur.team === g.away || cur.team === g.home)) return cur.team;
  const last = Object.values(PROPS.seasons).map((b) => b.players[pid]).find((p) => p && (p.team === g.away || p.team === g.home));
  return last ? last.team : g.away;
}

function projCell(r) {
  const row = r.row;
  if (row.proj === null || row.proj === undefined) return `<td class="num">--</td>`;
  const gap = row.proj - row.line;
  const cls = Math.abs(gap) < 0.5 ? "" : gap > 0 ? "tier-good" : "tier-bad";
  const how = row.w > 0
    ? `The line ${fmt(row.line)} moved ${Math.round(row.w * 100)}% toward our ${fmt(row.ours)} (${row.games} game${row.games === 1 ? "" : "s"} this season)`
    : "No games this season yet: the projection is the line";
  return `<td class="num pts-proj ${cls}" title="${how}"><b>${fmt(row.proj)}</b><small>${row.w > 0 ? `${Math.round(row.w * 100)}% ours` : "= line"}</small></td>`;
}

function pricesCell(r) {
  const spec = (side) => ({ kind: "prop", stat: "points", team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side, line: r.line, title: `${r.name} points`, sub: `${r.tm} vs ${r.opp}` });
  const o = bookPricePill(spec("o"));
  const u = bookPricePill(spec("u"));
  return `<td><div class="pts-prices">${o ? `<span class="pts-side">O</span>${o}` : ""}${u ? `<span class="pts-side">U</span>${u}` : ""}${!o && !u ? "--" : ""}</div></td>`;
}

function mixCell(p) {
  if (!p || !p.zones) return `<td class="pts-mix">--</td>`;
  const threes = (p.zones.corner3 || 0) + (p.zones.above3 || 0);
  return `<td class="pts-mix" title="Share of his shots: at the rim, 3-pointers, and pull-ups / step-backs / fades (made off the dribble)">Rim <b>${pct(p.zones.rim)}</b> &middot; 3s <b>${pct(threes)}</b> &middot; Self <b>${pct((p.kinds || {}).self)}</b></td>`;
}

function renderRow(r) {
  const out = r.row.out;
  const minutes = r.minutes;
  const cells = `
    <td><div class="pts-player" data-open="${r.pid}">${headshot(r.pid)}<span><b>${r.name}</b> <span class="muted-label">${(r.p && r.p.pos) || ""}</span>${out ? ' <span class="gs-inj-status tier-bad">Out</span>' : ""}<br><span class="muted-label">${logo(r.tm, 14)} ${r.tm} ${r.home ? "vs" : "@"} ${logo(r.opp, 14)} ${r.opp}</span></span></div></td>
    <td class="num"><b>${fmt(r.line)}</b></td>
    ${pricesCell(r)}
    ${projCell(r)}
    ${hitCell(r.l5, "Last 5 games over tonight's line")}
    ${hitCell(r.l10, "Last 10 games over tonight's line")}
    ${hitCell(r.all, "This season's games over tonight's line")}
    ${hitCell(r.ha, `${r.home ? "Home" : "Road"} games over tonight's line`)}
    ${hitCell(r.vs, `Games against ${r.opp} over tonight's line`)}
    <td class="num pts-min">${minutes ? `${fmt(minutes.avg)}<small>L5 ${fmt(minutes.l5)}</small>` : "--"}</td>
    <td class="num" title="His share of his team's shots while he's on the floor">${r.p ? pct(r.p.share) : "--"}</td>
    ${mixCell(r.p)}
    <td><div class="pts-tags">${tags(r.p || {}, r.row, r.g, r.opp, minutes)}</div></td>`;
  const open = openId === `${r.g.game_id}:${r.pid}`;
  return `<tr class="${out ? "pts-row-out" : ""}" data-key="${r.g.game_id}:${r.pid}">${cells}</tr>${open ? `<tr class="pts-open"><td colspan="13">${playerView(r)}</td></tr>` : ""}`;
}

// ---- the zone chart (player view) ----
// A half court in feet (50 wide, 47 deep, the basket 5.25 off the baseline).
// Each zone is shaded by what tonight's defense allows there against the
// league (green = softer than average for him, red = tougher; full color at
// ZONE_FULL), and labeled with his share of his shots and his make rate.
const ZONE_FULL = 0.06;
const ZONE_NAMES = { rim: "Rim", short: "Paint", mid: "Mid-range", corner3: "Corner 3", above3: "Above-break 3" };
function zoneEdge(opp, z) {
  const ib = identityBlock();
  if (!ib || !ib.teams[opp]) return null;
  const a = ib.teams[opp][`def_${z}_pct`];
  const l = (ib.league[`def_${z}_pct`] || {}).avg;
  return a === null || a === undefined || !l ? null : a - l;
}
function zoneFill(edge) {
  if (edge === null) return "rgba(127,127,127,0.12)";
  const t = Math.max(-1, Math.min(1, edge / ZONE_FULL));
  return scaleHsla(60 + t * 60, 70, 45, 0.18 + Math.abs(t) * 0.42);
}
function zoneChart(r) {
  const p = r.p || {};
  const share = p.zones || {};
  const made = p.zone_pct || {};
  const fill = Object.fromEntries(ZONES.map((z) => [z, zoneFill(zoneEdge(r.opp, z))]));
  const label = (z, x, y) => {
    const m = made[z];
    return `<text x="${x}" y="${y}" text-anchor="middle" class="pts-zone-share">${pct(share[z] || 0)}</text>
      <text x="${x}" y="${y + 2.3}" text-anchor="middle" class="pts-zone-made">${m && m[0] !== null ? `${pct(m[0])} FG` : "--"}</text>`;
  };
  const svg = `<svg viewBox="-2.5 -0.5 55 48" class="pts-court" role="img" aria-label="Shot zones">
    <rect x="0" y="0" width="50" height="47" fill="${fill.above3}"/>
    <rect x="0" y="0" width="3" height="14" fill="${fill.corner3}"/><rect x="47" y="0" width="3" height="14" fill="${fill.corner3}"/>
    <path d="M3,0 L3,14 A23.75,23.75 0 0 0 47,14 L47,0 Z" fill="${fill.mid}"/>
    <circle cx="25" cy="5.25" r="9" fill="${fill.short}"/>
    <circle cx="25" cy="5.25" r="4" fill="${fill.rim}"/>
    <g class="pts-court-lines" fill="none">
      <rect x="0" y="0" width="50" height="47"/><path d="M3,0 L3,14 A23.75,23.75 0 0 0 47,14 L47,0"/>
      <circle cx="25" cy="5.25" r="9"/><circle cx="25" cy="5.25" r="4"/><rect x="17" y="0" width="16" height="19"/>
      <line x1="22" y1="4" x2="28" y2="4"/><circle cx="25" cy="5.25" r="0.75"/>
    </g>
    ${label("rim", 25, 7.6)}${label("short", 25, 12.4)}${label("mid", 25, 21.5)}
    ${label("corner3", 1.5, 7)}${label("corner3", 48.5, 7)}${label("above3", 25, 36)}
  </svg>`;
  const rows = ZONES.map((z) => {
    const edge = zoneEdge(r.opp, z);
    const ib = identityBlock();
    const allowed = ib && ib.teams[r.opp] ? ib.teams[r.opp][`def_${z}_pct`] : null;
    const m = made[z];
    const cls = edge === null ? "" : edge >= 0.02 ? "tier-good" : edge <= -0.02 ? "tier-bad" : "tier-mid";
    return `<tr><td>${ZONE_NAMES[z]}</td><td class="num">${pct(share[z] || 0)}</td><td class="num">${m && m[0] !== null ? `${pct(m[0])} <small class="muted-label">${m[1]}</small>` : "--"}</td><td class="num ${cls}">${pct(allowed)}</td></tr>`;
  }).join("");
  const ib = identityBlock();
  return `<div><h4>Shot zones vs ${r.opp}</h4>${svg}
    <table class="data-table pts-zone-table"><thead><tr><th>Zone</th><th>His shots</th><th>His FG%</th><th>${r.opp} allows</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="pts-ww-note">${ib ? `Shaded by what ${r.opp} allows in each zone against the league in ${ib.label}: green = softer than average, red = tougher.` : "No defense numbers for this season yet."}</p></div>`;
}

// ---- the player view ----
let ww = { mate: "", mode: "out" }; // with / without: teammate id, mode out | rest | injury | floor
function playerView(r) {
  const f = F();
  const log = r.log;
  const recent = log.slice(-12).reverse();
  const logRows = recent.map((x) => {
    const res = r.line === null || r.line === undefined ? "" : x[f.pts] > r.line ? '<span class="pts-res-o">O</span>' : '<span class="pts-res-u">U</span>';
    return `<tr><td>${new Date(`${x[f.date]}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td><td>${x[f.home] ? "vs" : "@"} ${logo(x[f.opp], 14)} ${x[f.opp]}</td><td class="num">${x[f.min]}</td><td class="num"><b>${x[f.pts]}</b></td><td class="num">${x[f.fga]}</td><td class="num">${x[f.fg3m]}/${x[f.fg3a]}</td><td class="num">${x[f.fta]}</td><td class="num">${res}</td></tr>`;
  }).join("");
  const logBox = `<div><h4>Game log (${block().label})</h4>${log.length
    ? `<table class="data-table"><thead><tr><th>Date</th><th>Opp</th><th>Min</th><th>Pts</th><th>FGA</th><th>3PM</th><th>FTA</th><th>${fmt(r.line)}</th></tr></thead><tbody>${logRows}</tbody></table>`
    : `<p class="no-data-note">No games in ${block().label} yet.</p>`}</div>`;

  // alt-line ladder: tonight's line plus round numbers around it
  const base = r.line !== null && r.line !== undefined ? Math.round(r.line / 5) * 5 : 15;
  const steps = [...new Set([base - 10, base - 5, base, base + 5, base + 10].filter((x) => x >= 5).map((x) => x - 0.5).concat(r.line !== null && r.line !== undefined ? [r.line] : []))].sort((a, b) => a - b);
  const ladder = steps.map((s) => {
    const a = hits(log, s);
    const t = hits(log.slice(-10), s);
    const cls = (h) => (!h || h.of < 3 ? "" : h.over / h.of >= 0.6 ? "tier-good" : h.over / h.of <= 0.4 ? "tier-bad" : "tier-mid");
    return `<tr${s === r.line ? ' class="bo-best"' : ""}><td>${fmt(s)}+${s === r.line ? " <small class='muted-label'>tonight</small>" : ""}</td><td class="num ${cls(t)}">${t ? `${t.over} of ${t.of}` : "--"}</td><td class="num ${cls(a)}">${a ? `${a.over} of ${a.of}` : "--"}</td></tr>`;
  }).join("");
  const ladderBox = `<div><h4>Alt-line ladder</h4><table class="data-table"><thead><tr><th>Points</th><th>Last 10</th><th>Season</th></tr></thead><tbody>${ladder}</tbody></table>
    ${bookOddsPanel({ kind: "prop", stat: "points", team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side: "o", line: r.line, title: `${r.name} points`, sub: `${r.tm} vs ${r.opp}` })}</div>`;
  return `<div class="pts-view">${logBox}${zoneChart(r)}${ladderBox}<div><h4>With / without</h4>${withWithout(r)}</div></div>`;
}

function teammates(r) {
  const players = block().players;
  if (!r.p) return [];
  const ids = new Set(Object.keys(r.p.with || {}));
  // teammates who sat any of his games also count (an injured star may never share the floor)
  const outs = block().out[r.tm] || {};
  const f = F();
  r.log.forEach((x) => (outs[String(x[f.game])] || []).forEach(([id]) => ids.add(id)));
  // the teammates who matter most first: most minutes this season
  const minutes = (id) => (players[id].log || []).reduce((a, x) => a + x[f.min], 0);
  return [...ids].filter((id) => players[id] && id !== r.pid).sort((a, b) => minutes(b) - minutes(a));
}

function withWithout(r) {
  const mates = teammates(r);
  if (!mates.length) return `<p class="no-data-note">No teammates on file for ${block().label}.</p>`;
  if (!mates.includes(ww.mate)) ww.mate = mates[0];
  const players = block().players;
  const f = F();
  const modeBtn = (m, label) => `<button type="button" class="view-toggle-btn${ww.mode === m ? " active" : ""}" data-ww-mode="${m}">${label}</button>`;
  const controls = `<div class="pts-ww-controls"><select data-ww-mate>${mates.map((id) => `<option value="${id}"${id === ww.mate ? " selected" : ""}>${players[id].name}</option>`).join("")}</select>
    ${modeBtn("out", "Out (any)")}${modeBtn("rest", "Out: rest")}${modeBtn("injury", "Out: injured")}${modeBtn("floor", "Off the floor")}</div>`;
  const mate = players[ww.mate];
  if (ww.mode === "floor") {
    const w = (r.p.with || {})[ww.mate];
    if (!w) return `${controls}<p class="no-data-note">They didn't share 20+ minutes on the floor in ${block().label}.</p>`;
    const per36 = (pts, min) => (min > 0 ? (pts * 36) / min : null);
    return `${controls}<table class="data-table"><thead><tr><th>${mate.name}</th><th>Minutes</th><th>Pts / 36</th><th>Shots / 36</th></tr></thead><tbody>
      <tr><td>On the floor</td><td class="num">${fmt(w[0], 0)}</td><td class="num"><b>${fmt(per36(w[1], w[0]))}</b></td><td class="num">${fmt(per36(w[2], w[0]))}</td></tr>
      <tr><td>Off the floor</td><td class="num">${fmt(w[3], 0)}</td><td class="num"><b>${fmt(per36(w[4], w[3]))}</b></td><td class="num">${fmt(per36(w[5], w[3]))}</td></tr>
      </tbody></table><p class="pts-ww-note">Every minute ${r.name} played this season, split by whether ${mate.name} was on the floor with him.</p>`;
  }
  // game-level: games the teammate sat (by reason) against games they both played
  const outs = block().out[r.tm] || {};
  const mateGames = new Set((mate.log || []).map((x) => x[f.game]));
  const sat = r.log.filter((x) => (outs[String(x[f.game])] || []).some(([id, why]) => id === ww.mate && (ww.mode === "out" ? true : why === ww.mode)));
  const together = r.log.filter((x) => mateGames.has(x[f.game]));
  const summary = (rows, label) => {
    if (!rows.length) return `<tr><td>${label}</td><td class="num">0</td><td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td></tr>`;
    const avg = (k) => rows.reduce((a, x) => a + x[f[k]], 0) / rows.length;
    const h = hits(rows, r.line);
    return `<tr><td>${label}</td><td class="num">${rows.length}</td><td class="num"><b>${fmt(avg("pts"))}</b></td><td class="num">${fmt(avg("min"))}</td><td class="num">${fmt(avg("fga"))}</td><td class="num">${h ? `${h.over} of ${h.of}` : "--"}</td></tr>`;
  };
  const label = { out: "Out", rest: "Out: rest", injury: "Out: injured" }[ww.mode];
  return `${controls}<table class="data-table"><thead><tr><th>${mate.name}</th><th>Games</th><th>Pts</th><th>Min</th><th>FGA</th><th>Over ${fmt(r.line)}</th></tr></thead><tbody>
    ${summary(together, "Played")}${summary(sat, label)}</tbody></table>
    <p class="pts-ww-note">${r.name}'s games in ${block().label}, split by whether ${mate.name} played. "Out" reasons come from the box score's DNP note.</p>`;
}

// ---- the board ----
function rows() {
  const all = days();
  const date = all[dayIndex];
  const pick = el("pts-game").value;
  const search = (el("pts-search").value || "").toLowerCase();
  const out = [];
  for (const g of gamesOn(date)) {
    if (pick && pick !== g.game_id) continue;
    for (const [pid, row] of Object.entries(PROPS.slate[g.game_id] || {})) {
      const r = rowFor(g, pid, row);
      if (search && !r.name.toLowerCase().includes(search)) continue;
      out.push(r);
    }
  }
  const share = (h) => (h ? h.over / h.of : -1);
  const sort = el("pts-sort").value;
  const key = {
    line: (r) => r.line || 0,
    gap: (r) => (r.row.proj !== null && r.line !== null ? r.row.proj - r.line : -99),
    l10: (r) => share(r.l10),
    season: (r) => share(r.all),
  }[sort] || ((r) => r.line || 0);
  return out.sort((a, b) => (a.row.out - b.row.out) || key(b) - key(a));
}

function renderBoard() {
  const list = rows();
  el("empty-state").hidden = list.length > 0;
  el("pts-board").hidden = !list.length;
  if (!list.length) {
    el("empty-state").innerHTML = "<p>No points lines posted for this day yet. The books usually post them the morning of the games.</p>";
    return;
  }
  const head = `<thead><tr><th>Player</th><th>Line</th><th>Best price</th><th title="The line moved toward our number">Proj</th><th>L5</th><th>L10</th><th>Season</th><th>H/A</th><th>vs</th><th>Min</th><th>Share</th><th>Mix</th><th>Tags</th></tr></thead>`;
  el("pts-table").innerHTML = `${head}<tbody>${list.map(renderRow).join("")}</tbody>`;
}

function renderGamePicker() {
  const all = days();
  const date = all[dayIndex];
  const cur = el("pts-game").value;
  const games = gamesOn(date);
  el("pts-game").innerHTML = `<option value="">All games</option>${games.map((g) => `<option value="${g.game_id}">${g.away} @ ${g.home} &middot; ${fmtTime(g.time)}</option>`).join("")}`;
  if (games.some((g) => g.game_id === cur)) el("pts-game").value = cur;
}

function renderSeasons() {
  el("pts-seasons").innerHTML = Object.keys(PROPS.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${PROPS.seasons[s].label}</button>`)
    .join("") + (PROPS.seasons[thisSeason()] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  const b = block();
  el("pts-season-note").textContent = season === thisSeason()
    ? `Hit rates and splits from ${b.label}. Early in the season every rate is a few games.`
    : `Hit rates and splits from ${b.label} (reference: rosters have changed). The projection always uses this season only.`;
}

function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  renderSeasons();
  renderGamePicker();
  renderBoard();
}

function setSeason(s, remember) {
  if (!PROPS.seasons[s]) return;
  season = s;
  if (!remember) return;
  try {
    localStorage.setItem(PTS_SEASON_KEY, JSON.stringify({ season: s, default: PROPS.default }));
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
}

document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open]");
  if (opener) {
    const key = opener.closest("tr").dataset.key;
    openId = openId === key ? null : key;
    ww = { mate: "", mode: "out" };
    return renderBoard();
  }
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
  if (e.target.matches("#pts-game, #pts-sort")) renderBoard();
});
document.addEventListener("input", (e) => {
  if (e.target.matches("#pts-search")) renderBoard();
});

Promise.all([fetch("data.json").then((r) => r.json()), fetch("props.json").then((r) => r.json())])
  .then(([data, props]) => {
    DATA = data;
    PROPS = props;
    if (!PROPS || !Object.keys(PROPS.seasons || {}).length) {
      el("empty-state").innerHTML = "<p>Points data isn't available right now.</p>";
      return;
    }
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(PTS_SEASON_KEY) || "null");
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
