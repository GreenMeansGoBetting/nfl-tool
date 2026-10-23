// GMG NBA Suite: Threes (threes made). Built 2026-10-23 on the Points page's
// skeleton (the owner: "build the threes page on the points setup") from the
// 2025-26 replay (tools/backtest/nba_threes.py): tries are predictable, makes
// mostly aren't, so the projection is tries x make rate (nfl_tool/nba/props.py
// our_threes / project_threes; props.json `threes_slate`). The page does no
// projection math: it reads the slate, and works out hit rates, tags and the
// player view from the season's game logs. Styles: points.css + threes.css.

let DATA = null;
let PROPS = null;
let season = null;
let dayIndex = 0;
let openId = null;
const TH_SEASON_KEY = "nba-tool.threes-season.v1";
const MIN_TREND = 3; // last-5 minutes this far from the season's = Min up / down
const TAG_Z = 1; // a defense this many league spreads from average = 3s Allowed / Tough 3s D / Help D
const SHOOTER_SHARE = 0.3; // his share of shots from 3 at which a defense's threes matter to him
const CATCH_SHARE = 0.35; // his share of shots that are catch-and-shoot, for Help D
const DOG = 6; // his team getting this many points = Underdog (the replay: trailing teams shoot more)
const STREAK = 0.6; // makes a game off his own rate over the last 5 = Cold Run / Hot Run
const LADDER_EDGE = 0.03; // our chance this far over / under a rung's price = shaded

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
const slate = () => PROPS.threes_slate || {};

// ---- the slate ----
const days = () => [...new Set(DATA.schedule.filter((g) => slate()[g.game_id]).map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && slate()[g.game_id]);
function bookRow(g, pid, stat = "threes") {
  return ((((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {})[stat] || {})[pid] || null;
}
const bookName = (g, pid) => (bookRow(g, pid) || {}).name || null;

// ---- hit rates ----
// Games over / of the games, against tonight's line (a push isn't over).
function hits(rows, line) {
  if (line === null || line === undefined || !rows.length) return null;
  const f = F();
  return { over: rows.filter((r) => r[f.fg3m] > line).length, of: rows.length };
}
function hitCell(h, title) {
  if (!h) return `<td class="num pts-hit">--</td>`;
  const share = h.over / h.of;
  const cls = h.of < 3 ? "" : share >= 0.6 ? "tier-good" : share <= 0.4 ? "tier-bad" : "tier-mid";
  return `<td class="num pts-hit ${cls}" title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}

// ---- matchup tags (two-sided: his side and this defense's) ----
// A defense's number in league spreads from average (Team Identity, this season).
function defZ(opp, key) {
  const ib = identityBlock();
  const v = ib && ib.teams[opp] ? ib.teams[opp][key] : null;
  const lg = ib ? ib.league[key] : null;
  return v === null || v === undefined || !lg || !lg.sd ? null : (v - lg.avg) / lg.sd;
}
function tags(p, row, opp, minutes) {
  const out = [];
  const threes = p.zones ? (p.zones.corner3 || 0) + (p.zones.above3 || 0) : null;
  const z3 = defZ(opp, "def_three_pp");
  if (z3 !== null && z3 >= TAG_Z && threes !== null && threes >= SHOOTER_SHARE) out.push(`<span class="gs-tag gs-tag-mismatch" title="${opp} allows ${fmt(z3)} league spreads more threes a possession than average, and ${pct(threes)} of his shots are threes">3s Allowed</span>`);
  if (z3 !== null && z3 <= -TAG_Z) out.push(`<span class="gs-tag gs-tag-tough" title="${opp} allows ${fmt(-z3)} league spreads fewer threes a possession than average">Tough 3s D</span>`);
  const zc = defZ(opp, "def_catch3");
  const catchShare = (p.kinds || {}).catch;
  if (zc !== null && zc >= TAG_Z && catchShare !== undefined && catchShare >= CATCH_SHARE) out.push(`<span class="gs-tag gs-tag-mismatch" title="Threes against ${opp} are catch-and-shoot ${fmt(zc)} league spreads more than average (help defense leaving shooters), and ${pct(catchShare)} of his shots are catch-and-shoot">Help D</span>`);
  if (row.spread !== null && row.spread !== undefined && row.spread >= DOG) out.push(`<span class="pts-tag" title="His team is getting ${fmt(row.spread)}: trailing teams shoot more threes (last season's replay)">Underdog +${fmt(row.spread)}</span>`);
  if (row.missing > 0.04) out.push(`<span class="pts-tag" title="Rotation teammates listed Out tonight took ${pct(row.missing)} of the team's shots this season">Usage +${Math.round(row.missing * 100)}%</span>`);
  if (minutes && minutes.l5 !== null && minutes.avg !== null && minutes.games >= 5) {
    if (minutes.l5 - minutes.avg >= MIN_TREND) out.push(`<span class="pts-tag" title="Last 5: ${fmt(minutes.l5)} minutes, season ${fmt(minutes.avg)}">Min &uarr;</span>`);
    if (minutes.avg - minutes.l5 >= MIN_TREND) out.push(`<span class="pts-tag" title="Last 5: ${fmt(minutes.l5)} minutes, season ${fmt(minutes.avg)}">Min &darr;</span>`);
  }
  if (row.luck !== null && row.luck !== undefined && row.luck <= -STREAK) out.push(`<span class="pts-tag" title="His last 5 games: ${fmt(-row.luck)} fewer makes a game than his own make rate says. Last season's replay: he tries a few % fewer next game; his make rate doesn't change">Cold Run</span>`);
  if (row.luck !== null && row.luck !== undefined && row.luck >= STREAK) out.push(`<span class="pts-tag" title="His last 5 games: ${fmt(row.luck)} more makes a game than his own make rate says. Last season's replay: he tries a few % more next game; his make rate doesn't change">Hot Run</span>`);
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
  const avg = (rows, k) => rows.reduce((a, r) => a + r[f[k]], 0) / rows.length;
  const minutes = log.length ? { avg: avg(log, "min"), l5: avg(log.slice(-5), "min"), games: log.length } : null;
  const tries = log.length ? { avg: avg(log, "fg3a"), l5: avg(log.slice(-5), "fg3a") } : null;
  return {
    pid, g, tm, opp, home, p, row, line, log, minutes, tries,
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

// The projection: threes made, and the side it leans by how many points our
// chance of the Over beats the books' no-vig chance (the edge). Graded live
// (props.json `threes_record`). No games this season = the books' number.
const projEdge = (r) => (r.row.edge === null || r.row.edge === undefined ? 0 : r.row.edge);
function projCell(r) {
  const proj = r.row.proj;
  if (proj === null || proj === undefined) return `<td class="num pts-proj">--</td>`;
  const edge = projEdge(r);
  const lean = r.row.edge === null || r.row.edge === undefined ? `<small>No Price</small>`
    : Math.abs(edge) < 0.005 ? `<small>${r.row.games ? "At The Line" : "No Games Yet"}</small>`
      : `<small class="${edge > 0 ? "pts-res-o" : "pts-res-u"}">${edge > 0 ? "Over" : "Under"} +${Math.round(Math.abs(edge) * 100)}%</small>`;
  const title = r.row.ours === null || r.row.ours === undefined ? "No games this season yet: the projection is the books' number"
    : `Our number ${fmt(r.row.ours, 2)} made; the projection weighs it ${Math.round(r.row.w * 100)}% against the books' (more as his games come in). Our chance of the Over ${pct(r.row.p_over)}, the books' ${pct(r.row.p_mkt)} (no vig)`;
  return `<td class="num pts-proj" title="${title}"><b>${fmt(proj)}</b>${lean}</td>`;
}
function triesCell(r) {
  const t = r.row.tries;
  if (t === null || t === undefined) return `<td class="num th-tries">--</td>`;
  return `<td class="num th-tries" title="Threes we expect him to try tonight, and his make rate (his season, pulled 200 tries toward the league's)"><b>${fmt(t)}</b><small>${pct(r.row.pct)} Make</small></td>`;
}

// ---- the live record (the testing banner + YTD Model Performance) ----
// props.json threes_record.ledger = [date, edge (our chance minus the books'),
// won, units at the best price, tags] (props.threes_ledger).
const TH_SPLITS = [
  ["over", "Overs"], ["under", "Unders"],
  ["half", "0.5 Lines", "Lines of 0.5: one make is an Over"],
  ["dip", "Minutes Dip", "His last 5 games' minutes 15%+ under his season: the replay says those bounce back"],
  ["role", "Role Player Usage +", "Teammates taking 10%+ of the shots are Out and he takes under 15%: the replay says the shots go to him"],
  ["dog", "Underdogs (+6)", "His team getting 6+: trailing teams shoot more threes"],
  ["cold", "Cold Run", "His last 5 made 0.6+ a game under his own rate"],
  ["hot", "Hot Run", "His last 5 made 0.6+ a game over his own rate"],
];
const ledger = () => (PROPS.threes_record || {}).ledger || [];
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
    <p class="no-data-note">Every projection whose chance of the Over differed from the books' at the tip-off line, graded Over / Under at the best price at tip-off, 1 unit (pushes and players who sat don't count).</p>`;
  ytdTracker(content.querySelector(".pts-ytd-tracker"), {
    key: "nba-threes",
    markets: [{ key: "threes", label: "Threes Projection", ledger: ledger(), min: 0, max: 10, step: 1, scale: 100, unit: "%+",
                tip: "Every projection whose chance beat the books' by at least the minimum", splits: TH_SPLITS }],
  });
  overlay.hidden = false;
}

function pricesCell(r) {
  const spec = (side) => ({ kind: "prop", stat: "threes", team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side, line: r.line, title: `${r.name} threes`, sub: `${r.tm} vs ${r.opp}` });
  const o = bookPricePill(spec("o"));
  const u = bookPricePill(spec("u"));
  const line = (side, pill) => `<div class="pts-price"><span class="pts-side">${side}</span>${pill || "--"}</div>`;
  return `<td class="pts-prices">${o || u ? line("O", o) + line("U", u) : "--"}</td>`;
}

function renderRow(r) {
  const out = r.row.out;
  const minutes = r.minutes;
  const cells = `
    <td><div class="pts-player" data-open="${r.pid}">${headshot(r.pid)}<span><b>${playerClick(r.pid, r.name)}</b> <span class="muted-label">${(r.p && r.p.pos) || ""}</span>${out ? ' <span class="gs-inj-status tier-bad">Out</span>' : ""}<br><span class="muted-label">${logo(r.tm, 14)} ${r.tm} ${r.home ? "vs" : "@"} ${logo(r.opp, 14)} ${r.opp}</span></span></div></td>
    <td class="num"><b>${fmt(r.line)}</b></td>
    ${pricesCell(r)}
    ${projCell(r)}
    ${triesCell(r)}
    ${hitCell(r.l5, "Last 5 games over tonight's line")}
    ${hitCell(r.l10, "Last 10 games over tonight's line")}
    ${hitCell(r.all, "This season's games over tonight's line")}
    ${hitCell(r.ha, `${r.home ? "Home" : "Road"} games over tonight's line`)}
    ${hitCell(r.vs, `Games against ${r.opp} over tonight's line`)}
    <td class="num pts-min">${minutes ? `${fmt(minutes.avg)}<small>L5 ${fmt(minutes.l5)}</small>` : "--"}</td>
    <td class="num pts-min" title="Threes tried a game: season, last 5 under it">${r.tries ? `${fmt(r.tries.avg)}<small>L5 ${fmt(r.tries.l5)}</small>` : "--"}</td>
    <td><div class="pts-tags">${tags(r.p || {}, r.row, r.opp, minutes)}</div></td>`;
  const open = openId === `${r.g.game_id}:${r.pid}`;
  return `<tr class="${out ? "pts-row-out" : ""}" data-key="${r.g.game_id}:${r.pid}">${cells}</tr>${open ? `<tr class="pts-open"><td colspan="13">${playerView(r)}</td></tr>` : ""}`;
}

// ---- the player view ----
// Left: with / without a teammate, then every book's price (main lines; the
// rest behind Show Other Lines). Right: the ladder (only rungs a book really
// prices: the owner, "without odds its just filler"), then his threes next
// to every three tonight's defense has allowed (the Points drop-down's Shot
// Zones, opened on 3PT).
let ww = { mate: "", mode: "out" }; // with / without: teammate id, mode out | rest | injury
function playerView(r) {
  const books = bookOddsPanel({ kind: "prop", stat: "threes", team: r.tm, game: `${r.g.away}_${r.g.home}`, pid: r.pid, side: "o", line: r.line, title: `${r.name} threes`, sub: `${r.tm} vs ${r.opp}`, collapseOthers: true });
  return `<div class="pts-view"><div class="pts-view-left"><div><h4>With / Without</h4>${withWithout(r)}</div><div><h4>Every Book</h4>${books || '<p class="no-data-note">No book has this line right now.</p>'}</div></div>
    <div class="pts-view-zones"><h4>The Ladder <button type="button" class="info-i" aria-expanded="false" aria-controls="th-ladder-note-${r.pid}" title="How to read this">i</button></h4>
      <p class="info-note" id="th-ladder-note-${r.pid}" hidden>Each rung: our chance of that many threes or more (as a fair price, % under it), the best price across your books, and how far our chance is over (green) or under (red) the chance that price needs. A night's threes swing wider than a plain average says, so big nights hit more often than most expect. Only rungs a book prices are shown. In testing like the projection.</p>
      ${ladderView(r)}
      <h4 class="th-zones-head">Shot Zones: ${r.name} vs ${r.opp} Defense</h4>${zonesView(r)}</div></div>`;
}

function ladderView(r) {
  const chances = r.row.ladder || [];
  const quotes = [...((bookRow(r.g, r.pid) || {}).q || []), ...((bookRow(r.g, r.pid, "threes_alt") || {}).q || [])];
  const rows = chances.map((c, i) => {
    const k = i + 1;
    const best = bookBest(quotes, "o", k - 0.5);
    if (!best || c === null || c === undefined) return "";
    const edge = c - oddsProb(best[3]);
    const cls = edge >= LADDER_EDGE ? "tier-good" : edge <= -LADDER_EDGE ? "tier-bad" : "";
    return `<tr><td><b>${k}+ Threes</b></td><td class="num">${showOdds(probToAmerican(c))}<small>${pct(c)}</small></td>
      <td class="num">${showOdds(best[3])}<small>${BOOK_NAMES[best[0]] || best[0]}</small></td>
      <td class="num ${cls}">${edge >= 0 ? "+" : ""}${Math.round(edge * 100)}%</td></tr>`;
  }).join("");
  if (!rows) return `<p class="no-data-note">No book prices these rungs right now.</p>`;
  return `<table class="data-table th-ladder"><thead><tr><th>Rung</th><th>Our Fair</th><th>Best Price</th><th>Edge</th></tr></thead><tbody>${rows}</tbody></table>`;
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

// Game by game: his games a teammate sat (by reason) against games they both played.
function withWithout(r) {
  const mates = teammates(r);
  if (!mates.length) return `<p class="no-data-note">No teammates on file for ${block().label}.</p>`;
  if (!mates.includes(ww.mate)) ww.mate = mates[0];
  const players = block().players;
  const f = F();
  const modeBtn = (m, label) => `<button type="button" class="view-toggle-btn${ww.mode === m ? " active" : ""}" data-ww-mode="${m}">${label}</button>`;
  const controls = `<div class="pts-ww-controls"><select data-ww-mate>${mates.map((id) => `<option value="${id}"${id === ww.mate ? " selected" : ""}>${players[id].name}</option>`).join("")}</select>
    ${modeBtn("out", "Out (any)")}${modeBtn("rest", "Out: rest")}${modeBtn("injury", "Out: injured")}</div>`;
  const mate = players[ww.mate];
  const outs = block().out[r.tm] || {};
  const mateGames = new Set((mate.log || []).map((x) => x[f.game]));
  const sat = r.log.filter((x) => (outs[String(x[f.game])] || []).some(([id, why]) => id === ww.mate && (ww.mode === "out" ? true : why === ww.mode)));
  const together = r.log.filter((x) => mateGames.has(x[f.game]));
  const summary = (rows, label) => {
    if (!rows.length) return `<tr><td>${label}</td><td class="num">0</td><td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td></tr>`;
    const avg = (k) => rows.reduce((a, x) => a + x[f[k]], 0) / rows.length;
    const h = hits(rows, r.line);
    return `<tr><td>${label}</td><td class="num">${rows.length}</td><td class="num"><b>${fmt(avg("fg3m"))}</b></td><td class="num">${fmt(avg("fg3a"))}</td><td class="num">${fmt(avg("min"))}</td><td class="num">${h ? `${h.over} of ${h.of}` : "--"}</td></tr>`;
  };
  const label = { out: "Out", rest: "Out: rest", injury: "Out: injured" }[ww.mode];
  return `${controls}<table class="data-table"><thead><tr><th>${mate.name}</th><th>Games</th><th>3PM</th><th>3PA</th><th>Min</th><th>Over ${fmt(r.line)}</th></tr></thead><tbody>
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
    for (const [pid, row] of Object.entries(slate()[g.game_id] || {})) {
      const r = rowFor(g, pid, row);
      if (search && !r.name.toLowerCase().includes(search)) continue;
      out.push(r);
    }
  }
  const share = (h) => (h ? h.over / h.of : -1);
  const sort = el("pts-sort").value;
  const key = {
    line: (r) => r.line || 0,
    edge: (r) => Math.abs(projEdge(r)),
    tries: (r) => r.row.tries || 0,
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
    el("empty-state").innerHTML = "<p>No threes lines posted for this day yet. The books usually post them the morning of the games.</p>";
    return;
  }
  const head = `<thead><tr><th>Player</th><th>Line</th><th>Best Price</th><th>Proj</th><th>Tries</th><th>L5</th><th>L10</th><th>Season</th><th>H/A</th><th>vs</th><th>Min</th><th>3PA</th><th>Tags</th></tr></thead>`;
  el("pts-table").innerHTML = `${head}<tbody>${list.map(renderRow).join("")}</tbody>`;
}

function renderGamePicker() {
  const all = days();
  const date = all[dayIndex];
  const cur = el("pts-game").value;
  const games = gamesOn(date);
  el("pts-game").innerHTML = `<option value="">All Games</option>${games.map((g) => `<option value="${g.game_id}">${g.away} @ ${g.home} &middot; ${fmtTime(g.time)}</option>`).join("")}`;
  if (games.some((g) => g.game_id === cur)) el("pts-game").value = cur;
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
    localStorage.setItem(TH_SEASON_KEY, JSON.stringify({ season: s, default: PROPS.default }));
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
  if (e.target.matches("#pts-game, #pts-sort")) renderBoard();
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
      el("empty-state").innerHTML = "<p>Threes data isn't available right now.</p>";
      return;
    }
    NBA_SHOT_STATE.pts = "3"; // the drop-down's Shot Zones open on threes
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(TH_SEASON_KEY) || "null");
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
