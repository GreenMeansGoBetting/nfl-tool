// GMG NBA Suite: the game sim's page, shared by Points and Threes (built
// 2026-10-24; the owner: "I want to 'start over' with both points and threes
// ... I just dont want to mimic the vegas line again"). Every game is played
// 10,000 times from this season's possessions (nfl_tool/nba/sim.py); the
// books' line is never an input, only the price a play is judged against.
//
// A page loads this after its own config, `SIM_PAGE`:
//   { market: "points" | "threes",       // book_odds market (and its "_alt" ladder)
//     stat: "pts" | "fg3m",              // the sim's stat in props.json `sim`
//     unit: "Points", short: "PTS",      // words for a play ("30+ Points", "Over 27.5")
//     rungs: [10, 15, ...],              // the ladder's columns on the game board
//     ytd: {key, label} }
// From props.json: `sim` {game id: the game's 10,000}, `sim_plays` {market:
// [play]}, `sim_record` {market: {ledger}}, `sim_meta` (dial names).
// Prices: every book's (data.json book_odds), the best across the member's
// own books (My Books), so an edge here can be a little better or worse than
// the one the record grades (the best across every book at tip-off).

let DATA = null;
let PROPS = null;
let dayIndex = 0;
let gameId = "";
let script = "all"; // the Script Picker: all / away / close / home
const EDGE_SHADE = 0.03; // a rung's edge this far over / under = shaded green / red

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="nba-headshot" loading="lazy" onerror="this.style.visibility='hidden'">`;
const pct = (n) => (n === null || n === undefined ? "--" : `${Math.round(n * 100)}%`);
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "--" : Number(n).toFixed(d));
const signed = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "&minus;" : ""}${Math.abs(n).toFixed(d)}`;
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
const sims = () => PROPS.sim || {};
const simDays = () => new Set(Object.values(sims()).map((g) => g.date));
// past nights (props.json `sim_past`): the saved plays, graded, so the arrows can step back
const pastAll = () => (PROPS.sim_past || {})[SIM_PAGE.market] || [];
const days = () => [...new Set([...simDays(), ...pastAll().map((p) => p.date)])].sort();
const isPast = (date) => !simDays().has(date);
const pastOn = (date) => pastAll().filter((p) => p.date === date);
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && sims()[g.game_id]);
const playsOn = (date) => ((PROPS.sim_plays || {})[SIM_PAGE.market] || []).filter((p) => p.date === date);
const nameOf = (pid) => {
  const s = (PROPS.seasons || {})[String(DATA.season)];
  return (s && s.players[pid] && s.players[pid].name) || Object.values(sims()).map((g) => (g.players[pid] || {}).name).find(Boolean) || pid;
};
const posOf = (pid) => (((PROPS.seasons || {})[String(DATA.season)] || { players: {} }).players[pid] || {}).pos || "";
// for the player card (nba-card.js): the game open on the page
function currentGame() {
  return DATA ? DATA.schedule.find((g) => g.game_id === gameId) || null : null;
}

// ---- chances from a ladder: [first k, permille of k or more for k = first ..] ----
function atLeast(lad, k) {
  const [lo, xs] = lad || [0, []];
  if (!xs.length) return 0;
  if (k <= lo) return k === lo ? xs[0] / 1000 : 1;
  const i = k - lo;
  return i < xs.length ? xs[i] / 1000 : 0;
}
function chanceOver(lad, line) {
  if (Number.isInteger(line)) {
    const over = atLeast(lad, line + 1);
    const push = atLeast(lad, line) - over;
    return over / Math.max(1 - push, 1e-9);
  }
  return atLeast(lad, Math.floor(line) + 1);
}
const sideChance = (lad, side, line) => (side === "o" ? chanceOver(lad, line) : 1 - chanceOver(lad, line));
const fair = (p) => (p > 0 && p < 1 ? probToAmerican(p) : null);

// ---- prices ----
function bookGame(g) {
  return ((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {};
}
function quotesFor(g, pid) {
  const props = bookGame(g);
  return [...(((props[SIM_PAGE.market] || {})[pid] || {}).q || []), ...(((props[`${SIM_PAGE.market}_alt`] || {})[pid] || {}).q || [])];
}
function mainLine(g, pid) {
  const ls = ((((bookGame(g)[SIM_PAGE.market] || {})[pid] || {}).q) || []).map((q) => q[2]).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return ls.length ? ls[Math.floor(ls.length / 2)] : null;
}
// The every-book list for one price: the main market when it has this line, else the ladder's.
function priceSpec(g, pid, side, line, tm) {
  const inMain = ((((bookGame(g)[SIM_PAGE.market] || {})[pid] || {}).q) || []).some((q) => q[2] === line);
  return { kind: "prop", stat: inMain ? SIM_PAGE.market : `${SIM_PAGE.market}_alt`, team: tm, game: `${g.away}_${g.home}`, pid, side, line, title: `${nameOf(pid)} ${SIM_PAGE.unit}`, sub: `${g.away} @ ${g.home}` };
}
// The best price on the member's books for one side at one line, the main market and the ladder together.
function bestPrice(g, pid, side, line) {
  const best = bookBest(quotesFor(g, pid), side, line);
  return best ? { price: best[3], book: best[0] } : null;
}
function playName(p) {
  const rung = p.side === "o" && !p.main && Number.isInteger(p.line - 0.5);
  if (rung) return `${p.line + 0.5}+ ${SIM_PAGE.unit}`;
  return `${p.side === "o" ? "Over" : "Under"} ${fmt(p.line)}${p.main ? "" : ` ${SIM_PAGE.short}`}`;
}

// ---- the record: hero tiles and the YTD popup ----
const ledger = () => (((PROPS.sim_record || {})[SIM_PAGE.market]) || {}).ledger || [];
function dayBack(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
}
function tile(label, rows) {
  if (!rows.length) return `<div><small>${label}</small><b>&mdash;</b></div>`;
  const w = rows.filter((r) => r[2]).length;
  const u = rows.reduce((a, r) => a + (r[3] || 0), 0);
  return `<div><small>${label}</small><b>${w}-${rows.length - w}</b><i class="${u >= 0 ? "sim-up" : "sim-down"}">${u >= 0 ? "+" : "&minus;"}${Math.abs(u).toFixed(1)}u</i></div>`;
}
function renderRecord() {
  const all = ledger();
  // (other windows live in the shared YTD popup, ytd.js)
  el("sim-record").innerHTML = `${tile("Yesterday", all.filter((r) => r[0] === dayBack(1)))}${tile("Top Plays", all.filter((r) => r[4].includes("top")))}${tile("Season", all)}
    <button type="button" class="sim-ytd-btn" id="sim-ytd">${all.length ? "YTD Model Performance" : "Record Starts With Tonight's Plays"}</button>`;
}
function renderYtd() {
  const overlay = ensureBookModal("sim-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="sim-ytd-tracker"></div>
    <p class="no-data-note">Every one of tonight's plays, graded at its best price across every book at tip-off, 1 unit. A push or a player who sat doesn't count.</p>`;
  ytdTracker(content.querySelector(".sim-ytd-tracker"), {
    key: SIM_PAGE.ytd.key,
    markets: [{ key: SIM_PAGE.ytd.key, label: SIM_PAGE.ytd.label, ledger: ledger(), min: 0, max: 15, step: 1, scale: 100, unit: "%+",
      tip: "Every play with at least the minimum edge (points of our chance over what its price needs)",
      splits: [["top", "Top Play"], ["strong", "Strong Plays"], ["proof", "Script-Proof", "Beat its price in every script"], ["chaos", "Chaos Plays", "Lost in a close game, won when it went sideways"],
        ["close", "Needs A Close Game"], ["over", "Overs"], ["under", "Unders"], ["main", "Main Lines"], ["alt", "Ladder Rungs"],
        ["dials", "Spot Dials", "A schedule or last-game dial was on for one of the teams"]] }],
  });
  overlay.hidden = false;
}

// ---- tonight's plays ----
const SCRIPT_KEYS = ["away", "close", "home"];
function scriptLabel(g, k, long) {
  if (k === "close") return long ? "Close Game" : "Close";
  return `${k === "away" ? g.away : g.home} ${long ? "Blowout" : "By 10+"}`;
}
// Shade a chance against what the price needs: green over, red under, deeper the farther.
function shade(diff) {
  if (diff === null || diff === undefined || Number.isNaN(diff)) return "";
  const a = Math.min(0.42, 0.1 + Math.abs(diff) * 2.2).toFixed(2);
  return Math.abs(diff) < 0.01 ? "" : ` style="background:rgba(var(--${diff > 0 ? "good" : "bad"}-rgb),${a})"`;
}
function playCard(p, top) {
  const g = DATA.schedule.find((x) => x.game_id === p.game);
  if (!g) return "";
  const live = bestPrice(g, p.pid, p.side, p.line);
  const price = live ? live.price : p.price;
  const book = live ? live.book : p.book;
  const needs = oddsProb(price);
  const edge = p.chance - needs;
  const kind = { proof: ["Script-Proof", "sim-t-proof", "Beats its price in every script the 10,000 games play"],
    chaos: ["Chaos Play", "sim-t-chaos", "Loses in a close game; cashes when the game goes sideways"],
    close: ["Needs A Close Game", "sim-t-why", "Only beats its price when the game stays close"] }[p.kind];
  const sim = sims()[p.game];
  // the dials on in this game, with whose they are ("CHA Back-To-Back")
  const dials = sim ? ["away", "home"].flatMap((k) => (sim.dials[k] || []).map((d) => `${g[k]} ${(PROPS.sim_meta.dials[d] || [d])[0]}`)) : [];
  const row = sim && sim.players[p.pid];
  const color = `#${team(p.team).color || "555555"}`;
  const spec = priceSpec(g, p.pid, p.side, p.line, p.team);
  const scripts = SCRIPT_KEYS.map((k) => {
    const v = (p.scripts || {})[k];
    return `<div${v === null || v === undefined ? "" : shade(v - needs)}><small>${scriptLabel(g, k, true)}</small><b>${v === null || v === undefined ? "--" : pct(v)}</b></div>`;
  }).join("");
  let extra = "";
  if (top && row) {
    const lad = row[SIM_PAGE.stat].lad.all;
    const [lo, xs] = lad;
    const bars = xs.map((x, i) => {
      const k = lo + i;
      const exact = (x - (xs[i + 1] || 0)) / 1000;
      const hit = p.side === "o" ? k > p.line : k < p.line;
      return { k, exact, hit };
    });
    const peak = Math.max(...bars.map((b) => b.exact), 0.0001);
    extra = `<div class="sim-nums">
        <div><small>Our Median</small><b>${fmt(row[SIM_PAGE.stat].med.all, 0)}</b><i>${SIM_PAGE.unit.toLowerCase()}</i></div>
        <div><small>Book Line</small><b>${fmt(mainLine(g, p.pid))}</b><i>main</i></div>
        <div><small>Minutes</small><b>${fmt(row.min)}</b><i>in the sims</i></div>
      </div>
      <div><div class="sim-kicker">His ${SIM_PAGE.unit} In The 10,000 Games &middot; Green = This Play Wins</div>
        <div class="sim-hist">${bars.map((b) => `<div class="${b.hit ? "hit" : ""}" style="height:${Math.max(2, Math.round((100 * b.exact) / peak))}%" title="${b.k}: ${(b.exact * 100).toFixed(1)}%"></div>`).join("")}</div>
        <div class="sim-hlab">${bars.map((b, i) => `<span>${i % Math.ceil(bars.length / 9) === 0 ? b.k : ""}</span>`).join("")}</div></div>`;
  }
  return `<div class="sim-play${top ? " top" : ""}">
    <div class="sim-banner" style="background:${color}">${logo(p.team, top ? 20 : 18)} ${g.away} @ ${g.home} &middot; ${fmtTime(g.time)}<span class="sim-tier">${p.tier === "top" ? "Top Play" : "Strong"}</span></div>
    <div class="sim-pbody">
      <div class="sim-who">${headshot(p.pid)}<div><b>${playerClick(p.pid, nameOf(p.pid))}</b><span>${posOf(p.pid)} &middot; ${team(p.team).name}${row ? ` &middot; ${fmt(row.min)} min in the sims` : ""}</span></div></div>
      <div class="sim-bet">${playName(p)} <button type="button" class="bo-pill sim-price" data-bo="${boEnc(spec)}" title="Best price across your books. Click for every book.">${showOdds(price)}<small>${BOOK_INITIALS[book] || book}</small></button></div>
      <div class="sim-nums">
        <div><small>Hit In</small><b>${Math.round(p.chance * 1000) * 10 >= 10000 ? "9,990" : (Math.round(p.chance * 1000) * 10).toLocaleString()}</b><i>of 10,000</i></div>
        <div><small>GMG Fair</small><b>${fair(p.chance) === null ? "--" : showOdds(fair(p.chance))}</b><i>${pct(p.chance)}</i></div>
        <div class="${edge > 0 ? "sim-edge" : "sim-edge-gone"}"><small>Edge</small><b>${signed(edge * 100)}</b><i>needs ${(needs * 100).toFixed(1)}%</i></div>
      </div>
      <div><div class="sim-kicker">How Often It Hits In Each Script</div><div class="sim-scripts">${scripts}</div></div>
      ${extra}
      <div class="sim-tags">${kind ? `<span class="sim-tag ${kind[1]}" title="${kind[2]}">${kind[0]}</span>` : ""}${dials.map((d) => `<span class="sim-tag sim-t-dial">${d}</span>`).join("")}${p.locked ? '<span class="sim-tag sim-t-why" title="Saved at tip-off: this is the play the record grades">Locked At Tip</span>' : ""}</div>
    </div></div>`;
}
// ---- a past night: each play as locked at tip, Hit / Miss and what he got ----
const unitsWon = (p) => (p.price > 0 ? p.price / 100 : 100 / -p.price);
function resultCard(p) {
  const color = `#${team(p.team).color || "555555"}`;
  const vs = p.opp ? `${p.home ? "vs" : "@"} ${p.opp}` : "";
  const done = p.result === "won" || p.result === "lost";
  const final = { won: ["sim-won", "Hit"], lost: ["sim-lost", "Miss"], push: ["", "Push"], sat: ["", "Didn't Play"] }[p.result] || ["", "Waiting"];
  const units = p.result === "won" ? unitsWon(p) : p.result === "lost" ? -1 : 0;
  const kind = { proof: ["Script-Proof", "sim-t-proof"], chaos: ["Chaos Play", "sim-t-chaos"], close: ["Needs A Close Game", "sim-t-why"] }[p.kind];
  const dials = [...new Set(p.dials || [])].map((d) => ((PROPS.sim_meta || {}).dials || {})[d] || [d]).map((d) => d[0]);
  return `<div class="sim-play past${done ? ` ${p.result}` : ""}">
    <div class="sim-banner" style="background:${color}">${logo(p.team, 18)} ${p.team || ""} ${vs}<span class="sim-tier">${p.tier === "top" ? "Top Play" : "Strong"}</span></div>
    <div class="sim-pbody">
      <div class="sim-who">${headshot(p.pid)}<div><b>${playerClick(p.pid, nameOf(p.pid))}</b><span>${posOf(p.pid)}${p.team ? ` &middot; ${team(p.team).name}` : ""}</span></div></div>
      <div class="sim-bet">${playName(p)} <span class="bo-pill sim-price" title="The best price across every book at tip-off: what the record grades">${showOdds(p.price)}<small>${BOOK_INITIALS[p.book] || p.book}</small></span></div>
      <div class="sim-nums">
        <div class="${final[0]}"><small>${final[1]}</small><b>${p.got === null || p.got === undefined ? "--" : fmt(p.got, 0)}</b><i>${SIM_PAGE.unit.toLowerCase()}</i></div>
        <div><small>Hit In</small><b>${(Math.round(p.chance * 1000) * 10).toLocaleString()}</b><i>of 10,000</i></div>
        <div><small>Edge At Tip</small><b>${signed(p.edge * 100)}</b><i>${done ? `${units >= 0 ? "+" : "&minus;"}${Math.abs(units).toFixed(2)}u` : "&nbsp;"}</i></div>
      </div>
      <div class="sim-tags">${done ? `<span class="sim-tag sim-t-${p.result}">${final[1]}</span>` : ""}${kind ? `<span class="sim-tag ${kind[1]}">${kind[0]}</span>` : ""}${dials.map((d) => `<span class="sim-tag sim-t-dial">${d}</span>`).join("")}</div>
    </div></div>`;
}
function renderPast(date) {
  const plays = pastOn(date);
  const graded = plays.filter((p) => p.result === "won" || p.result === "lost");
  const w = graded.filter((p) => p.result === "won").length;
  const u = graded.reduce((a, p) => a + (p.result === "won" ? unitsWon(p) : -1), 0);
  const waiting = plays.filter((p) => !p.result).length;
  el("sim-plays-title").textContent = "Results";
  el("sim-plays-note").innerHTML = `${plays.length} play${plays.length === 1 ? "" : "s"} &middot; locked at tip &middot; graded at the best price across every book, 1 unit${waiting ? ` &middot; ${waiting} waiting on the box score` : ""}`;
  if (!plays.length) {
    el("sim-plays").innerHTML = '<p class="sim-noplay">No plays this night.</p>';
    return;
  }
  const top = plays.filter((p) => p.tier === "top" && (p.result === "won" || p.result === "lost"));
  el("sim-plays").innerHTML = `<div class="sim-night">
      <div><small>Record</small><b>${graded.length ? `${w}-${graded.length - w}` : "--"}</b></div>
      <div><small>Units</small><b class="${u >= 0 ? "sim-up" : "sim-down"}">${graded.length ? `${u >= 0 ? "+" : "&minus;"}${Math.abs(u).toFixed(2)}u` : "--"}</b></div>
      <div><small>Top Play</small><b class="${top.length ? (top[0].result === "won" ? "sim-up" : "sim-down") : ""}">${top.length ? (top[0].result === "won" ? "Hit" : "Miss") : "--"}</b></div>
    </div>
    <div class="sim-plays-grid sim-past-grid">${plays.map(resultCard).join("")}</div>`;
}

function renderPlays() {
  const date = days()[dayIndex];
  if (isPast(date)) return renderPast(date);
  el("sim-plays-title").textContent = "Tonight's Plays";
  const plays = playsOn(date).sort((a, b) => (a.tier === "top" ? -1 : b.tier === "top" ? 1 : b.edge - a.edge));
  const games = gamesOn(date);
  const without = games.filter((g) => !plays.some((p) => p.game === g.game_id));
  const meta = PROPS.sim_meta || {};
  el("sim-plays-note").innerHTML = `${plays.length} play${plays.length === 1 ? "" : "s"} &middot; one per game at most &middot; ${Math.round((meta.min_edge || 0.04) * 100)}+ points of edge at the best price`;
  if (!plays.length) {
    el("sim-plays").innerHTML = `<p class="sim-noplay">${Object.keys(DATA.book_odds || {}).length ? "Nothing cleared the edge tonight. Every player's numbers are in the game board below." : "The books haven't posted these lines yet. Plays show up once they do; every player's numbers are in the game board below."}</p>`;
    return;
  }
  el("sim-plays").innerHTML = `<div class="sim-plays-grid">${plays.map((p, i) => playCard(p, i === 0 && p.tier === "top")).join("")}</div>
    ${without.length ? `<p class="sim-noplay">No play in ${without.map((g) => `${g.away} @ ${g.home}`).join(", ")}: nothing cleared the edge at the best price.</p>` : ""}`;
}

// ---- the game board ----
function renderGamePicker() {
  const games = gamesOn(days()[dayIndex]);
  if (!games.some((g) => g.game_id === gameId)) gameId = games.length ? games[0].game_id : "";
  el("matchup-row").innerHTML = games.map((g) => `<button type="button" class="matchup-card${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
      <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
      <span class="matchup-date">${fmtTime(g.time)}${playsOn(g.date).some((p) => p.game === g.game_id) ? " &middot; Play" : ""}</span></button>`).join("");
}
function dialRows(g, sim) {
  const meta = PROPS.sim_meta.dials;
  const rows = [];
  for (const k of ["away", "home"]) {
    const abbr = g[k];
    const other = k === "home" ? g.away : g.home;
    for (const key of sim.dials[k] || []) {
      const [label, own, opp] = meta[key] || [key, 0, 0];
      rows.push(`<div class="sim-dial"><div><b>${abbr} &middot; ${label}</b><em>${abbr} ${signed(own)} points scored, ${other} ${signed(opp)}</em></div><span class="sim-dial-v"${shade((own - opp) / 10)}>${signed(own - opp)}</span><small>margin</small></div>`);
    }
  }
  const on = new Set([...(sim.dials.away || []), ...(sim.dials.home || [])]);
  const off = Object.entries(meta).filter(([k]) => !on.has(k)).map(([, v]) => v[0]);
  return `${rows.join("") || '<p class="sim-off">No dial is on for this game: both teams play as their normal.</p>'}
    <p class="sim-off">Checked, not on: ${off.join(", ")}.</p>`;
}
function scriptBar(g, shares, label) {
  const part = (k, color) => `<div style="width:${Math.max(6, shares[k] * 100)}%;background:${color}"><small>${scriptLabel(g, k)}</small>${pct(shares[k])}</div>`;
  return `<div class="sim-sbar">${part("away", `#${team(g.away).color || "444"}`)}${part("close", "var(--border-strong)")}${part("home", `#${team(g.home).color || "444"}`)}</div>
    <div class="sim-sbase"><span>${label}</span></div>`;
}
function renderBoard() {
  const g = DATA.schedule.find((x) => x.game_id === gameId);
  const sim = g && sims()[g.game_id];
  if (!sim) {
    el("sim-board").innerHTML = `<p class="sim-noplay">${isPast(days()[dayIndex]) ? "The game board is for upcoming games. This night's plays are graded above." : "No game on this day."}</p>`;
    return;
  }
  const lean = sim.margin === 0 ? "Even" : `${sim.margin > 0 ? g.home : g.away} By ${Math.abs(sim.margin)}`;
  const spread = g.home_team_spread;
  const book = spread === null || spread === undefined ? "--" : spread === 0 ? "Pick" : `${spread < 0 ? g.home : g.away} &minus;${fmt(Math.abs(spread))}`;
  const plays = playsOn(g.date).filter((p) => p.game === g.game_id);
  const isPlay = (pid, line, side) => plays.some((p) => p.pid === pid && p.line === line && p.side === side);
  const rungs = SIM_PAGE.rungs;
  const rows = (k) => Object.entries(sim.players).filter(([, r]) => r.team === k && r.min >= 6).sort((a, b) => b[1].min - a[1].min).map(([pid, r]) => {
    const s = r[SIM_PAGE.stat];
    const lad = s.lad[script] || s.lad.all;
    const med = (key) => (s.med[key] === null || s.med[key] === undefined ? null : s.med[key]);
    const base = med("all");
    const scriptCell = (key) => {
      const v = med(key);
      return `<td class="sim-sp${key === script ? " on" : ""}"${v === null || base === null ? "" : shade((v - base) / Math.max(4, base) / 2)}><b>${v === null ? "--" : fmt(v, 0)}</b></td>`;
    };
    const tm = g[k];
    const ml = mainLine(g, pid);
    let mainCell = '<td class="sim-rung">--</td>';
    if (ml !== null) {
      const sides = ["o", "u"].map((side) => {
        const best = bestPrice(g, pid, side, ml);
        const c = sideChance(lad, side, ml);
        return { side, best, c, edge: best ? c - oddsProb(best.price) : null };
      });
      const pick = sides.filter((x) => x.edge !== null).sort((a, b) => b.edge - a.edge)[0] || sides[0];
      const spec = priceSpec(g, pid, pick.side, ml, tm);
      mainCell = `<td class="sim-rung main${isPlay(pid, ml, pick.side) ? " pick" : ""}"${pick.edge === null ? "" : shade(Math.abs(pick.edge) >= EDGE_SHADE ? pick.edge : 0)}>
        <b>${pick.side === "o" ? "O" : "U"} ${fmt(ml)} &middot; ${pct(pick.c)}</b>${pick.best ? `<button type="button" class="sim-mini" data-bo="${boEnc(spec)}">${showOdds(pick.best.price)}</button>` : "<small>--</small>"}</td>`;
    }
    const rungCells = rungs.map((n) => {
      const line = n - 0.5;
      const c = chanceOver(lad, line);
      const best = bestPrice(g, pid, "o", line);
      const edge = best ? c - oddsProb(best.price) : null;
      const spec = priceSpec(g, pid, "o", line, tm);
      return `<td class="sim-rung${isPlay(pid, line, "o") ? " pick" : ""}"${edge === null || Math.abs(edge) < EDGE_SHADE ? "" : shade(edge)}><b>${pct(c)}</b>${best ? `<button type="button" class="sim-mini" data-bo="${boEnc(spec)}">${showOdds(best.price)}</button>` : "<small>&mdash;</small>"}</td>`;
    }).join("");
    return `<tr><td class="sim-pl">${playerClick(pid, `<b>${nameOf(pid)}</b>`)}<span>${posOf(pid)}</span>${(sim.starters || {})[k] && sim.starters[k].includes(pid) ? '<span class="sim-st" title="Starts tonight">S</span>' : ""}</td>
      <td>${fmt(r.min)}</td><td class="sim-med"><b>${base === null ? "--" : fmt(base, 0)}</b></td>${SCRIPT_KEYS.map(scriptCell).join("")}${mainCell}${rungCells}</tr>`;
  }).join("");
  const teamRow = (k) => `<tr class="sim-team"><td colspan="${7 + rungs.length}">${logo(g[k], 16)} ${team(g[k]).name}${(sim.dials[k] || []).map((d) => ` <span class="sim-tag sim-t-dial">${(PROPS.sim_meta.dials[d] || [d])[0]}</span>`).join("")}</td></tr>`;
  const pickBtn = (k, label) => `<button type="button" class="sim-pick${script === k ? " on" : ""}" data-script="${k}"${k !== "all" && !(sim.scripts[k] > 0.02) ? " disabled" : ""}><small>${k === "all" ? "As Played" : "Only"}</small><b>${label}</b></button>`;
  el("sim-board").innerHTML = `<div class="sim-game">
    <div class="sim-gbar"><div style="background:#${team(g.away).color || "333"}">${logo(g.away, 34)} ${team(g.away).name}</div>
      <div class="sim-gmid"><small>${new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })} ${fmtTime(g.time)}</small>@</div>
      <div style="background:#${team(g.home).color || "333"}">${team(g.home).name} ${logo(g.home, 34)}</div></div>
    <div class="sim-ginner">
      <div class="sim-side">
        <div class="sim-box"><h3>The 10,000 Games <span>The Books Second</span></h3>
          <div class="sim-score"><div><small>Our Median</small><b>${lean}</b><i>Total ${fmt(sim.total, 0)}</i></div>
            <div><small>Book Line</small><b>${book}</b><i>Total ${g.total_line === null || g.total_line === undefined ? "--" : fmt(g.total_line)}</i></div></div>
          ${scriptBar(g, sim.scripts, `Tonight, dials on${JSON.stringify(sim.base) !== JSON.stringify(sim.scripts) ? ` &middot; without them: ${SCRIPT_KEYS.map((k) => pct(sim.base[k])).join(" / ")}` : ""}`)}
        </div>
        <div class="sim-box"><h3>Dials Tonight <span>From 10 Seasons</span></h3>${dialRows(g, sim)}</div>
        <div class="sim-box"><h3>Script Picker</h3><div class="sim-picks">${pickBtn("all", "All")}${pickBtn("away", scriptLabel(g, "away", true))}${pickBtn("close", "Close")}${pickBtn("home", scriptLabel(g, "home", true))}</div>
          <p class="sim-off">Pick a script and every chance on the board uses only those games.</p>
          <p class="sim-off">Starting fives: ${sim.lineup ? "the NBA's (Expected, then Confirmed about 30 minutes before tip)" : "not posted yet: the five with the most minutes"}.</p></div>
      </div>
      <div class="sim-tablewrap"><table class="sim-table">
        <thead><tr><th class="grp" style="text-align:left">Player</th><th class="grp" colspan="2">The Sims</th><th class="grp" colspan="3">Median ${SIM_PAGE.unit} By Script</th><th class="grp" colspan="${1 + rungs.length}">Our Chance &middot; Best Price${script === "all" ? "" : ` &middot; ${script === "close" ? "Close Games Only" : `${scriptLabel(g, script, true)}s Only`}`}</th></tr>
          <tr><th style="text-align:left">Name</th><th>Min</th><th>Median</th>${SCRIPT_KEYS.map((k) => `<th>${scriptLabel(g, k)}</th>`).join("")}<th>Main Line</th>${rungs.map((n) => `<th>${n}+</th>`).join("")}</tr></thead>
        <tbody>${teamRow("away")}${rows("away")}${teamRow("home")}${rows("home")}</tbody></table>
        <div class="sim-legend"><span><i style="background:rgba(var(--good-rgb),.34)"></i>Our chance beats the best price by ${Math.round(EDGE_SHADE * 100)}+</span><span><i style="background:rgba(var(--bad-rgb),.3)"></i>The price beats our chance</span><span><i class="sim-legend-pick"></i>Tonight's play</span><span>Script columns: green = he scores more in that script, red = less</span></div>
      </div>
    </div></div>`;
}

function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  renderRecord();
  renderPlays();
  renderGamePicker();
  renderBoard();
}

document.addEventListener("click", (e) => {
  const card = e.target.closest("#matchup-row [data-game]");
  if (card) {
    gameId = card.dataset.game;
    renderGamePicker();
    return renderBoard();
  }
  const pick = e.target.closest("[data-script]");
  if (pick && !pick.disabled) {
    script = pick.dataset.script;
    return renderBoard();
  }
  if (e.target.closest("#sim-ytd")) return renderYtd();
  if (e.target.closest("#day-prev") && dayIndex > 0) {
    dayIndex -= 1;
    script = "all";
    return render();
  }
  if (e.target.closest("#day-next") && dayIndex < days().length - 1) {
    dayIndex += 1;
    script = "all";
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
    if (!PROPS || !Object.keys(PROPS.sim || {}).length) {
      el("sim-app").hidden = true;
      el("empty-state").innerHTML = `<p>The game sim isn't available right now. It runs with every data build; check back shortly.</p>`;
      return;
    }
    el("empty-state").hidden = true;
    el("sim-app").hidden = false;
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    // open on tonight's slate (past nights are a click back)
    const ahead = all.filter((d) => !isPast(d));
    dayIndex = Math.max(0, all.indexOf(ahead.find((d) => d >= today) || ahead[0] || all[all.length - 1]));
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
