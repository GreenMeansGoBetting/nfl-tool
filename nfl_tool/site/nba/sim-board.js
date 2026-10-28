// GMG NBA Suite: the game sim's page, shared by Points and Threes (built
// 2026-10-24; the owner: "I want to 'start over' with both points and threes
// ... I just dont want to mimic the vegas line again"). Every game is played
// 10,000 times from this season's possessions (nfl_tool/nba/sim.py); the
// books' line is never an input, only the price a play is judged against.
// Two views (2026-10-25, the owner: "player view would show the best edges
// regardless of team like the NHL setup ... Matchup view would allow users to
// look at entire lineups across a game"): Player View, one list sorted by
// edge with a row that opens The Model / Shot Chart, and Matchup View, the
// game board. Plays are main lines only; a better rung is a Ladder tag.
//
// A page loads this after its own config, `SIM_PAGE`:
//   { market: "points" | "threes" | "rebounds" | "assists",  // book_odds market (and its "_alt" ladder)
//     stat: "pts" | "fg3m" | "reb" | "ast",  // the sim's stat in props.json `sim` (= the game log's field)
//     unit: "Points", short: "PTS",      // words for a play ("30+ Points", "Over 27.5")
//     rungs: [10, 15, ...],              // the ladder's columns on the game board
//     ytd: {key, label} }
// Best Plays (2026-10-25, the owner: "a best plays page ... aggregating from these two
// categories", sorted by edge) loads it with `SIM_PAGE = {markets: [points config, threes
// config], ytd}`: Player View only, every market's rows in one list with a Market column.
// `MK` is the market being worked on (each row sets it before it is drawn).
// From props.json: `sim` {game id: the game's 10,000}, `sim_plays` {market:
// [play]}, `sim_record` {market: {ledger}}, `sim_meta` (dial names).
// Prices: every book's (data.json book_odds), the best across the member's
// own books (My Books), so an edge here can be a little better or worse than
// the one the record grades (the best across every book at tip-off).

let DATA = null;
let PROPS = null;
let dayIndex = 0;
let gameId = "";
const EDGE_SHADE = 0.03; // a rung's edge this far over / under = shaded green / red
const MARKETS = SIM_PAGE.markets || [SIM_PAGE];
const BEST = Boolean(SIM_PAGE.markets);
let MK = MARKETS[0];

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
// Every market's rows carry `mk` (its config); Best Plays' Market switches leave some out.
const marketsOn = () => MARKETS.filter((m) => !BEST || LIST.markets[m.market] !== false);
const tagged = (key) => MARKETS.flatMap((m) => ((PROPS[key] || {})[m.market] || []).map((p) => ({ ...p, mk: m })));
const pastAll = () => tagged("sim_past").filter((p) => marketsOn().includes(p.mk));
const days = () => [...new Set([...simDays(), ...tagged("sim_past").map((p) => p.date)])].sort();
const isPast = (date) => !simDays().has(date);
const pastOn = (date) => pastAll().filter((p) => p.date === date);
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && sims()[g.game_id]);
const playsOn = (date) => tagged("sim_plays").filter((p) => p.date === date && marketsOn().includes(p.mk));
// `sim_held`: would-be plays whose line was taken before a 20+ minute teammate was ruled Out and hasn't
// moved since (the owner, 2026-10-28, Luka out, Reaves still 23.5): grayed, Waiting On Market, not counted
const heldOn = (date) => tagged("sim_held").filter((p) => p.date === date && marketsOn().includes(p.mk));
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
  return [...(((props[MK.market] || {})[pid] || {}).q || []), ...(((props[`${MK.market}_alt`] || {})[pid] || {}).q || [])];
}
function mainLine(g, pid) {
  const ls = ((((bookGame(g)[MK.market] || {})[pid] || {}).q) || []).map((q) => q[2]).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return ls.length ? ls[Math.floor(ls.length / 2)] : null;
}
// The every-book list for one price: the main market when it has this line, else the ladder's.
function priceSpec(g, pid, side, line, tm) {
  const inMain = ((((bookGame(g)[MK.market] || {})[pid] || {}).q) || []).some((q) => q[2] === line);
  return { kind: "prop", stat: inMain ? MK.market : `${MK.market}_alt`, team: tm, game: `${g.away}_${g.home}`, pid, side, line, title: `${nameOf(pid)} ${MK.unit}`, sub: `${g.away} @ ${g.home}` };
}
// The best price on the member's books for one side at one line, the main market and the ladder together.
function bestPrice(g, pid, side, line) {
  const best = bookBest(quotesFor(g, pid), side, line);
  return best ? { price: best[3], book: best[0] } : null;
}
function playName(p) {
  const rung = p.side === "o" && !p.main && Number.isInteger(p.line - 0.5);
  if (rung) return `${p.line + 0.5}+ ${MK.unit}`;
  return `${p.side === "o" ? "Over" : "Under"} ${fmt(p.line)}${p.main ? "" : ` ${MK.short}`}`;
}

// ---- the record: hero tiles and the YTD popup ----
const ledgerOf = (m) => (((PROPS.sim_record || {})[m.market]) || {}).ledger || [];
const ledger = () => MARKETS.flatMap(ledgerOf);
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
  // (no Top Plays tile since 2026-10-26: every play is Strong)
  el("sim-record").innerHTML = `${tile("Yesterday", all.filter((r) => r[0] === dayBack(1)))}${tile("Season", all)}
    <button type="button" class="sim-ytd-btn" id="sim-ytd">${all.length ? "YTD Model Performance" : "Record Starts With Tonight's Plays"}</button>`;
}
function renderYtd() {
  const overlay = ensureBookModal("sim-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="sim-ytd-tracker"></div>
    <p class="no-data-note">Every one of tonight's plays, graded at its best price across every book at tip-off, 1 unit. A push or a player who sat doesn't count.</p>`;
  // Best Plays: one tile a market plus All Plays, and only the main splits (each page has the rest)
  const splits = BEST ? [["over", "Overs"], ["under", "Unders"]]
    : [["proof", "Script-Proof", "Beat its price in every script"], ["chaos", "Chaos Plays", "Lost in a close game, won when it went sideways"],
      ["close", "Needs A Close Game"], ["over", "Overs"], ["under", "Unders"], ["main", "Main Lines"], ["alt", "Ladder Rungs"],
      ["dials", "Spot Dials", "A schedule or last-game dial was on for one of the teams"]];
  ytdTracker(content.querySelector(".sim-ytd-tracker"), {
    key: SIM_PAGE.ytd.key,
    all: BEST ? "All Plays" : "",
    markets: MARKETS.map((m) => ({ key: m.ytd.key, label: m.ytd.label, short: m.unit, ledger: ledgerOf(m), min: 0, max: 15, step: 1, scale: 100, unit: "%+",
      tip: "Every play with at least the minimum edge (points of our chance over what its price needs)", splits })),
  });
  overlay.hidden = false;
}

// ---- scripts and shades ----
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
// ---- Player View: every player in one list, sorted by edge (the NHL pages' setup) ----
// The owner, 2026-10-25: "I like how we have NHL where it shows players in one list
// sorted by edge ... It needs to be brainless for people who want brainless, but deep
// for people who want deep." A row: the play at his main line, its edge, a Ladder tag
// when a rung on the same side has more edge; a click opens The Model / Shot Chart.
// Opens on the plays only, like the NHL pages ("If users want the detailed look,
// theyll click").
const LIST = { side: "best", minEdge: 0, every: false, tag: "", sort: "edge", dir: -1, open: null, tab: "model", game: "",
  markets: Object.fromEntries(MARKETS.map((m) => [m.market, true])) };
const PRICE_RANGE = [-250, 400]; // the build's: past +400 a rung's chance rests on a few hundred sims' tails
const minEdge = () => (PROPS.sim_meta || {}).min_edge || 0.04;
// A game has started once its tip time has passed (times are Eastern, fixed UTC-4 like the build).
const started = (g) => Boolean(g.time) && Date.now() >= Date.parse(`${g.date}T${g.time}:00-04:00`);
// Over / Under with the line, as a bettor writes it: "o31.5" / "u25.5"; a rung over a half line reads "30+".
const chipText = (side, line, main) => (side === "o" && !main && Number.isInteger(line - 0.5) ? `${line + 0.5}+` : `${side}${fmt(line)}`);
function chip(side, line, price, book, main = true) {
  return `<span class="sim-chip sim-chip-${side}" title="${side === "o" ? "Over" : "Under"} ${fmt(line)} ${MK.unit.toLowerCase()} at the best price across your books"><b>${chipText(side, line, main)}</b><span>${price === null || price === undefined ? "--" : showOdds(price)}</span>${book ? `<small>${BOOK_INITIALS[book] || book}</small>` : ""}</span>`;
}
// Script-Proof / Chaos / Needs A Close Game (sim.py kind_of), from the chances by script and what the price needs.
function kindOf(scripts, needs) {
  const have = Object.entries(scripts).filter(([, v]) => v !== null && v !== undefined);
  if (!have.length) return null;
  if (have.every(([, v]) => v >= needs)) return "proof";
  const close = scripts.close;
  const sideways = have.filter(([k]) => k !== "close").map(([, v]) => v);
  if (close !== null && close !== undefined && close < needs && sideways.some((v) => v >= needs)) return "chaos";
  if (close !== null && close !== undefined && close >= needs) return "close";
  return null;
}
const KINDS = {
  proof: ["Script-Proof", "sim-t-proof", "Beats its price in every script the 10,000 games play"],
  chaos: ["Chaos Play", "sim-t-chaos", "Loses in a close game; cashes when the game goes sideways"],
  close: ["Needs A Close Game", "sim-t-why", "Only beats its price when the game stays close"],
};
// Every line a book prices on one side for him (the main market and the ladder), lowest first.
function sideLines(g, pid, side) {
  return [...new Set(quotesFor(g, pid).filter((q) => q[1] === side && q[2] !== null && q[2] !== undefined).map((q) => q[2]))].sort((a, b) => a - b);
}
// The Ladder tag: the rung on the play's side with the most edge, when it beats the main line's
// edge and clears the play bar (the owner: "would be interested in knowing the ladder down may have an edge").
function ladderBest(g, pid, lad, side, main, mainEdge) {
  let best = null;
  for (const line of sideLines(g, pid, side)) {
    if (line === main) continue;
    const price = bestPrice(g, pid, side, line);
    if (!price || price.price < PRICE_RANGE[0] || price.price > PRICE_RANGE[1]) continue;
    const edge = sideChance(lad, side, line) - oddsProb(price.price);
    if (!best || edge > best.edge) best = { line, edge, ...price };
  }
  return best && best.edge >= minEdge() && best.edge > (mainEdge === null ? -1 : mainEdge) ? best : null;
}
// One row a player: his main line, the side shown (the build's play, else the better side or
// the side picked in Side), the best price on the member's books, our chance, the edge.
function listRows(date) {
  const out = [];
  for (const mk of marketsOn()) {
    MK = mk;
    const plays = playsOn(date).filter((p) => p.mk === mk);
    const helds = heldOn(date).filter((p) => p.mk === mk);
    for (const g of gamesOn(date)) {
      if (LIST.game && g.game_id !== LIST.game) continue;
      const sim = sims()[g.game_id];
      const live = started(g);
      for (const [pid, r] of Object.entries(sim.players)) {
        if (!r[MK.stat]) continue;
        const play = plays.find((p) => p.game === g.game_id && p.pid === pid);
        const held = play || live ? null : helds.find((p) => p.game === g.game_id && p.pid === pid);
        const ml = play ? play.line : held ? held.line : mainLine(g, pid);
        if (ml === null || r.min < 6) continue;
        const lad = r[MK.stat].lad.all;
        const sides = ["o", "u"].map((side) => {
          const best = bestPrice(g, pid, side, ml) || (play && play.side === side ? { price: play.price, book: play.book } : null);
          const chance = sideChance(lad, side, ml);
          return { side, chance, price: best ? best.price : null, book: best ? best.book : null, edge: best ? chance - oddsProb(best.price) : null };
        });
        const want = LIST.side === "best" ? ((play || held) ? (play || held).side : null) : LIST.side;
        const pick = want ? sides.find((s) => s.side === want) : sides.filter((s) => s.edge !== null).sort((a, b) => b.edge - a.edge)[0];
        if (!pick || pick.price === null) continue;
        const tm = r.team === "home" ? g.home : g.away;
        out.push({ mk, g, pid, r, team: tm, opp: tm === g.home ? g.away : g.home, home: tm === g.home, line: ml, ...pick, lad,
          play: play && play.side === pick.side ? play : null, held: held && held.side === pick.side ? held : null, live, ladder: live ? null : ladderBest(g, pid, lad, pick.side, ml, pick.edge) });
      }
    }
  }
  out.forEach((x) => {
    MK = x.mk;
    x.hits = hitsFor(x);
    x.tags = tagsFor(x);
  });
  return out;
}

// ---- hit rates: his games over tonight's line (a push isn't over), "x of y" ----
// Back from the old props board (the owner, 2026-10-25: "install the old hit rates tab we used to
// show on points and 3s, with all the sub columns"): L5, L10, Season, Home, Away, counting HIS
// numbers over the line whichever side the play is, so an Under's red isn't bad news.
const seasonBlock = () => (PROPS.seasons || {})[String(DATA.season)] || { players: {}, out: {}, fields: [] };
const logFields = () => Object.fromEntries((seasonBlock().fields || []).map((f, i) => [f, i]));
const logOf = (pid) => (seasonBlock().players[pid] || {}).log || [];
function hits(rows, line, f) {
  if (line === null || line === undefined || !rows.length) return null;
  return { over: rows.filter((x) => x[f[MK.stat]] > line).length, of: rows.length };
}
function hitsFor(x) {
  const f = logFields();
  const log = logOf(x.pid);
  return {
    l5: hits(log.slice(-5), x.line, f),
    l10: hits(log.slice(-10), x.line, f),
    all: hits(log, x.line, f),
    home: hits(log.filter((r) => r[f.home]), x.line, f),
    away: hits(log.filter((r) => !r[f.home]), x.line, f),
  };
}
const hitShare = (h) => (h ? h.over / h.of : -1);
// Every cell colored by its percentage: red at 20% or less, yellow at 50%, green at 80% or more,
// stronger the farther from 50%. The "x of y" under it says how many games it is.
function hitCell(h, title) {
  if (!h) return '<td class="num sim-hit">--</td>';
  const share = h.over / h.of;
  const hue = Math.round(Math.max(0, Math.min(1, (share - 0.2) / 0.6)) * 135);
  const style = ` style="background:${scaleHsla(hue, 78, 44, 0.24 + Math.min(0.3, Math.abs(share - 0.5)) * 1.1)}"`;
  return `<td class="num sim-hit"${style} title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}

// ---- tags (each {key, label, title, cls}; the Tag menu lists the night's keys) ----
// The owner, 2026-10-25: "add the tags back that are relevant". The old board's (minutes from the
// injury report; Points' zone fit; Threes' defense, underdog and hot / cold runs) plus the sim's own
// (the Ladder, Script-Proof / Chaos / Needs A Close Game, the spot dials). Matchup tags read both
// sides (his shots and what this defense allows).
const TAG = (key, label, title, cls = "", filter = "") => ({ key, label, title, cls, filter: filter || label });
const POS_GROUP = { PG: "G", SG: "G", G: "G", SF: "F", PF: "F", F: "F", C: "C" };
const MIN_UP_MAX = 32; // a player already this many minutes a game gets no Min up tag
const ZONE_FIT = 0.025; // weighted make rate allowed this far from the league's = Zone Fit / Tough Zones
const ZONES = ["rim", "short", "mid", "corner3", "above3"];
const TAG_Z = 1; // a defense this many league spreads from average = 3s Allowed / Tough 3s D / Help D
const SHOOTER_SHARE = 0.3; // his share of shots from 3 at which a defense's threes matter to him
const CATCH_SHARE = 0.35; // his share of shots that are catch-and-shoot, for Help D
const DOG = 6; // his team getting this many points = Underdog (last season's replay: trailing teams shoot more threes)
const STREAK = 0.6; // makes a game off his own rate over the last 5 = Cold Run / Hot Run
// Rebounds / Assists (2026-10-28): the sim's own matchup inputs, both sides each
const GLASS_TILT = 0.1; // tonight's defense gives his position this much more / less of the boards than the league = Glass Fit / Tough Glass
const GLASS_OWN = 0.1; // ... unless his own boards a minute (his position's = 1) point the other way this much
const MISSES_UP = 3; // the other team's missed shots in tonight's sims this many over the league's a game = Misses Coming
const RUN = { reb: 2, ast: 1.5 }; // his last 5 games this many a game over / under his games before them (at his minutes) = Hot / Cold Run
const RUN_GAMES = 7; // games before a run can show (the last 5 against at least 2 before them)
const identityNow = () => {
  const d = DATA.identity;
  return d && d.seasons ? d.seasons[d.default] || Object.values(d.seasons)[0] || null : null;
};
function defZ(opp, key) {
  const ib = identityNow();
  const v = ib && ib.teams[opp] ? ib.teams[opp][key] : null;
  const lg = ib ? ib.league[key] : null;
  return v === null || v === undefined || !lg || !lg.sd ? null : (v - lg.avg) / lg.sd;
}
// his shot zones x what tonight's defense allows there, against the league's make rate in those zones
function zoneFit(p, opp) {
  const ib = identityNow();
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
// Minutes from injuries: a rotation teammate at his spot listed Out tonight = more minutes; one who
// sat the team's last game and isn't listed Out tonight = back, fewer minutes.
function minutesTags(x) {
  const blk = seasonBlock();
  const me = blk.players[x.pid];
  if (!me) return [];
  const f = logFields();
  const group = POS_GROUP[me.pos] || "";
  const avgMin = (p) => ((p.log || []).length ? p.log.reduce((a, r) => a + r[f.min], 0) / p.log.length : 0);
  const mates = Object.entries(blk.players).filter(([id, p]) => id !== x.pid && p.team === x.team && POS_GROUP[p.pos] === group && avgMin(p) >= 20);
  const out = new Set(((DATA.injuries || {})[x.team] || []).filter((i) => i.status === "Out").map((i) => String(i.id)));
  const tags = [];
  const gone = mates.filter(([id]) => out.has(id));
  if (gone.length && avgMin(me) < MIN_UP_MAX) {
    tags.push(TAG("min_up", "Min &uarr;", `${gone.map(([, p]) => p.name).join(", ")} (${gone.length > 1 ? "rotation players" : "a rotation player"} at his spot) ${gone.length > 1 ? "are" : "is"} listed Out tonight`, "", "Min Up"));
  }
  const log = me.log || [];
  const lastGame = log.length ? log[log.length - 1][f.game] : null;
  const sat = new Set((((blk.out || {})[x.team] || {})[String(lastGame)] || []).map(([id]) => String(id)));
  const back = mates.filter(([id]) => sat.has(id) && !out.has(id));
  if (back.length) tags.push(TAG("min_down", "Min &darr;", `${back.map(([, p]) => p.name).join(", ")} sat the last game and ${back.length > 1 ? "aren't" : "isn't"} listed Out tonight`, "", "Min Down"));
  return tags;
}
function pointsTags(x, p) {
  const fit = zoneFit(p, x.opp);
  if (fit !== null && fit >= ZONE_FIT) return [TAG("zone_fit", "Zone Fit", `${x.opp} allows ${(fit * 100).toFixed(1)} points of make rate above the league where he shoots`, "good")];
  if (fit !== null && fit <= -ZONE_FIT) return [TAG("tough_zones", "Tough Zones", `${x.opp} allows ${(-fit * 100).toFixed(1)} points of make rate below the league where he shoots`, "bad")];
  return [];
}
function threesTags(x, p) {
  const out = [];
  const threes = p.zones ? (p.zones.corner3 || 0) + (p.zones.above3 || 0) : null;
  const z3 = defZ(x.opp, "def_three_pp");
  if (z3 !== null && z3 >= TAG_Z && threes !== null && threes >= SHOOTER_SHARE) out.push(TAG("allowed", "3s Allowed", `${x.opp} allows ${fmt(z3)} league spreads more threes a possession than average, and ${pct(threes)} of his shots are threes`, "good"));
  if (z3 !== null && z3 <= -TAG_Z) out.push(TAG("tough", "Tough 3s D", `${x.opp} allows ${fmt(-z3)} league spreads fewer threes a possession than average`, "bad"));
  const zc = defZ(x.opp, "def_catch3");
  const catchShare = (p.kinds || {}).catch;
  if (zc !== null && zc >= TAG_Z && catchShare !== undefined && catchShare >= CATCH_SHARE) out.push(TAG("help", "Help D", `Threes against ${x.opp} are catch-and-shoot ${fmt(zc)} league spreads more than average (help defense leaving shooters), and ${pct(catchShare)} of his shots are catch-and-shoot`, "good"));
  const hs = x.g.home_team_spread;
  const spread = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  if (spread !== null && spread >= DOG) out.push(TAG("dog", `Underdog +${fmt(spread)}`, `His team is getting ${fmt(spread)}: trailing teams shoot more threes (last season's replay)`, "", "Underdog"));
  // hot / cold: his last 5 games' makes against his own make rate on the same tries
  const f = logFields();
  const log = logOf(x.pid);
  const tried = log.reduce((a, r) => a + (r[f.fg3a] || 0), 0);
  if (log.length >= 5 && tried) {
    const rate = log.reduce((a, r) => a + (r[f.fg3m] || 0), 0) / tried;
    const luck = log.slice(-5).reduce((a, r) => a + (r[f.fg3m] || 0) - (r[f.fg3a] || 0) * rate, 0) / 5;
    if (luck <= -STREAK) out.push(TAG("cold", "Cold Run", `His last 5 games: ${fmt(-luck)} fewer makes a game than his own make rate says. Last season's replay: he tries a few % fewer next game; his make rate doesn't change`));
    if (luck >= STREAK) out.push(TAG("hot", "Hot Run", `His last 5 games: ${fmt(luck)} more makes a game than his own make rate says. Last season's replay: he tries a few % more next game; his make rate doesn't change`));
  }
  return out;
}
// Hot / Cold Run for a counting stat: his last 5 games a minute against the games before them, at his recent minutes
function runTags(x, stat, unit) {
  const f = logFields();
  const log = logOf(x.pid).filter((r) => (r[f.min] || 0) > 0);
  if (log.length < RUN_GAMES || f[stat] === undefined) return [];
  const per = (rows) => rows.reduce((a, r) => a + (r[f[stat]] || 0), 0) / Math.max(rows.reduce((a, r) => a + (r[f.min] || 0), 0), 1);
  const last = log.slice(-5);
  const gap = (per(last) - per(log.slice(0, -5))) * (last.reduce((a, r) => a + r[f.min], 0) / last.length);
  if (gap >= RUN[stat]) return [TAG("hot", "Hot Run", `His last 5 games: ${fmt(gap)} more ${unit} a game than his games before them, at his minutes`)];
  if (gap <= -RUN[stat]) return [TAG("cold", "Cold Run", `His last 5 games: ${fmt(-gap)} fewer ${unit} a game than his games before them, at his minutes`)];
  return [];
}
// Glass Fit / Tough Glass: what tonight's defense gives up at his position (props.json sim player `glass`
// = [the position tilt the sim uses, his own boards a minute against his position's]); Misses Coming: the
// other team's misses in tonight's sims (its shooting x this defense) against the league's a game
function reboundsTags(x, p) {
  const out = [];
  const [tilt, own] = x.r.glass || [null, null];
  const pos = p.pos || "his position";
  if (tilt !== null && tilt >= 1 + GLASS_TILT && (own === null || own >= 1 - GLASS_OWN)) {
    out.push(TAG("glass_fit", "Glass Fit", `Against ${x.opp}, ${pos}s grab ${Math.round((tilt - 1) * 100)}% more of the boards than the league's ${pos}s do (as the sim weighs it this early)${own === null ? "" : `, and he rebounds at ${pct(own)} of his position's rate`}`, "good"));
  }
  if (tilt !== null && tilt <= 1 - GLASS_TILT && (own === null || own <= 1 + GLASS_OWN)) {
    out.push(TAG("tough_glass", "Tough Glass", `Against ${x.opp}, ${pos}s grab ${Math.round((1 - tilt) * 100)}% fewer of the boards than the league's ${pos}s do (as the sim weighs it this early)${own === null ? "" : `, and he rebounds at ${pct(own)} of his position's rate`}`, "bad"));
  }
  const misses = ((sims()[x.g.game_id] || {}).misses || {})[x.home ? "away" : "home"];
  const avg = (PROPS.sim_meta || {}).miss_pg;
  if (misses !== undefined && misses !== null && avg && misses - avg >= MISSES_UP) {
    out.push(TAG("misses", "Misses Coming", `${x.opp} misses ${fmt(misses)} shots a game in tonight's sims (its shooting against ${x.team}'s defense), ${fmt(misses - avg)} over the league's ${fmt(avg)}: more boards to grab`, "good"));
  }
  return [...out, ...runTags(x, "reb", "rebounds")];
}
// Ball Movement Fit / Tough Passing D: how often this defense's makes allowed are assisted (Team Identity),
// with his team's own assisted share not pointing the other way (0.3 league spreads)
function assistsTags(x) {
  const out = [];
  const zd = defZ(x.opp, "def_assisted");
  const zo = defZ(x.team, "off_assisted");
  const own = zo === null ? "" : `, and ${x.team}'s own makes are assisted ${signed(zo)} spreads from average`;
  if (zd !== null && zd >= TAG_Z && (zo === null || zo > -0.3)) {
    out.push(TAG("movement", "Ball Movement Fit", `${x.opp} gives up assisted makes ${fmt(zd)} league spreads more than average${own}`, "good"));
  }
  if (zd !== null && zd <= -TAG_Z && (zo === null || zo < 0.3)) {
    out.push(TAG("tough_pass", "Tough Passing D", `${x.opp} gives up assisted makes ${fmt(-zd)} league spreads less than average${own}`, "bad"));
  }
  return [...out, ...runTags(x, "ast", "assists")];
}
// A dial sits on the team it is about; Rest Edge is about the TIRED team (on a back-to-back, the other
// team 2+ days off), so it is named for the rested team that has the edge (the owner, 2026-10-28: "LAL
// rest edge when they played last night and LAC did not. Makes no sense")
function dialText(g, k, d) {
  const [label] = ((PROPS.sim_meta || {}).dials || {})[d] || [d];
  return `${d === "rest_edge" ? g[k === "home" ? "away" : "home"] : g[k]} ${label}`;
}
const MARKET_TAGS = { points: pointsTags, threes: threesTags, rebounds: reboundsTags, assists: assistsTags };
// Rebounds / Assists' own tags always sit in the Tag menu, even on a night no row has one (the owner, 2026-10-28)
const MARKET_TAG_MENU = {
  rebounds: [["glass_fit", "Glass Fit"], ["tough_glass", "Tough Glass"], ["misses", "Misses Coming"], ["hot", "Hot Run"], ["cold", "Cold Run"]],
  assists: [["movement", "Ball Movement Fit"], ["tough_pass", "Tough Passing D"], ["hot", "Hot Run"], ["cold", "Cold Run"]],
};
function tagsFor(x) {
  const tags = [];
  if (x.held) tags.push(TAG("wait", "Waiting On Market", `${x.held.out.join(", ")} ruled Out after this line was posted, and it hasn't moved yet: not a play until it does (or 40 minutes pass)`, "wait"));
  if (x.ladder) tags.push(TAG("ladder", `Ladder ${chipText(x.side, x.ladder.line, false)} ${showOdds(x.ladder.price)} <span>${signed(x.ladder.edge * 100)}</span>`,
    `${playName({ side: x.side, line: x.ladder.line, main: false })} at ${showOdds(x.ladder.price)} (${BOOK_INITIALS[x.ladder.book] || x.ladder.book}): ${signed(x.ladder.edge * 100)} points of edge, more than his main line. Click the row for every rung.`, "lad", "Ladder"));
  const all = x.r[MK.stat].lad;
  if (x.price !== null) {
    const scripts = Object.fromEntries(SCRIPT_KEYS.map((k) => [k, all[k] ? sideChance(all[k], x.side, x.line) : null]));
    const kind = kindOf(scripts, oddsProb(x.price));
    if (kind) tags.push(TAG(kind, KINDS[kind][0], KINDS[kind][2], kind === "proof" ? "good" : kind === "chaos" ? "chaos" : ""));
  }
  const sim = sims()[x.g.game_id];
  ["away", "home"].forEach((k) => (sim.dials[k] || []).forEach((d) => {
    tags.push(TAG("dial", dialText(x.g, k, d), `A spot dial is on for ${x.g[k]} tonight (it moves the sims; the Game Board in Matchup View has its size)`, "", "Spot Dial"));
  }));
  const p = seasonBlock().players[x.pid] || {};
  tags.push(...minutesTags(x), ...(MARKET_TAGS[MK.market] || pointsTags)(x, p));
  return tags;
}
const tagHtml = (t) => `<span class="sim-rtag${t.cls ? ` ${t.cls}` : ""}" title="${t.title}">${t.label}</span>`;
const SORTS = {
  edge: (x) => x.edge,
  chance: (x) => x.chance,
  l5: (x) => hitShare(x.hits.l5),
  l10: (x) => hitShare(x.hits.l10),
  all: (x) => hitShare(x.hits.all),
  home: (x) => hitShare(x.hits.home),
  away: (x) => hitShare(x.hits.away),
  tags: (x) => x.tags.length,
  market: (x) => -MARKETS.indexOf(x.mk),
};
const playRank = (x) => (x.play ? 2 : x.held ? 1 : 0); // the plays, then the ones waiting on the market, then the rest
function sortedList(date) {
  const key = SORTS[LIST.sort] || SORTS.edge;
  return listRows(date)
    .filter((x) => (LIST.every || x.play || x.held) && (!LIST.minEdge || (x.edge !== null && x.edge >= LIST.minEdge)) && (!LIST.tag || x.tags.some((t) => t.key === LIST.tag)))
    .sort((a, b) => (a.live - b.live) || (!LIST.every ? !!a.held - !!b.held : 0) || (LIST.every && LIST.sort === "edge" ? playRank(b) - playRank(a) : 0) || LIST.dir * ((key(a) ?? -99) - (key(b) ?? -99)));
}
function renderToolbar(rows) {
  const menu = (key, label, options, tip) =>
    `<label class="sim-menu"${tip ? ` title="${tip}"` : ""}><span>${label}</span><select data-list="${key}">${options.map(([v, text]) => `<option value="${v}"${String(LIST[key]) === String(v) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  const bar = Math.round(minEdge() * 100);
  // Best Plays: one switch a market, each on or off on its own, at least one on (NHL Best Plays' way)
  const markets = BEST ? `<span class="sim-seg sim-markets">${MARKETS.map((m) => {
    const on = LIST.markets[m.market] !== false;
    return `<button type="button" class="view-toggle-btn${on ? " active" : ""}" data-list-market="${m.market}" aria-pressed="${on}" title="${on ? "Hide" : "Show"} the ${m.unit} plays">${on ? "&#10003; " : ""}${m.unit}</button>`;
  }).join("")}</span>` : "";
  el("sim-toolbar").innerHTML = markets +
    menu("side", "Side", [["best", "Best Side"], ["o", "Overs"], ["u", "Unders"]], "Best Side: the play's side, or the better side of his main line. Overs / Unders: that side for everyone") +
    menu("minEdge", "Edge", [[0, "Any"], ...[4, 6, 8, 10, 15].filter((n) => n >= bar).map((n) => [n / 100, `${n}+ Points`])], "Only rows with at least this much edge (our chance minus the chance the price needs, in points)") +
    menu("tag", "Tag", [["", "All Tags"], ...[...new Map([...rows.flatMap((x) => x.tags).map((t) => [t.key, t.filter]), ...MARKETS.flatMap((m) => MARKET_TAG_MENU[m.market] || [])])]], "Only players with this tag") +
    `<span class="sim-seg">${[[false, "Plays Only", `Only the plays: ${bar}+ points of edge on his main line`], [true, "Every Player", "Every player with a main line: the plays first, then the rest"]]
      .map(([v, label, tip]) => `<button type="button" class="view-toggle-btn${LIST.every === v ? " active" : ""}" data-list-every="${v}" title="${tip}">${label}</button>`).join("")}</span>` +
    (LIST.game ? `<button type="button" class="view-toggle-btn" data-list-game="" title="Show every game again">${(() => { const g = DATA.schedule.find((x) => x.game_id === LIST.game); return g ? `${g.away} @ ${g.home}` : ""; })()} &times;</button>` : "");
}
// The owner, 2026-10-25: "Make it go PLAY, RATING, FAIR, EDGE, and then install the old hit rates
// tab"; every number column only as wide as its numbers plus a little each side, Tags takes the rest.
const COLS = [
  { label: "#" },
  { label: "Player", cls: "sim-th-player" },
  ...(BEST ? [{ label: "Market", key: "market", title: "Points or Threes: the page the play comes from" }] : []),
  { label: "Play", title: "His main line, the side the model likes (o = over, u = under), at the best price across your books. The box saves it to My Plays." },
  { label: "Rating", title: "Strong: 4+ points of edge on his main line" },
  { label: "Fair", key: "chance", title: "The price with no cut at which our chance breaks even (our chance on hover)" },
  { label: "Edge", key: "edge", title: "Our chance minus the chance the price needs to break even, in points" },
  { label: "L5", key: "l5", hit: true, title: "His last 5 games over tonight's line" },
  { label: "L10", key: "l10", hit: true, title: "His last 10 games over tonight's line" },
  { label: "Season", key: "all", hit: true, title: "This season's games over tonight's line" },
  { label: "Home", key: "home", hit: true, title: "Home games over tonight's line" },
  { label: "Away", key: "away", hit: true, title: "Road games over tonight's line" },
  { label: "Tags", key: "tags", cls: "sim-th-tags", title: "The Ladder, how the play does in each script, the spot dials, minutes from the injury report and the matchup" },
];
function edgeCell(x) {
  const e = x.edge;
  const cls = x.play ? " tier-good" : "";
  const alpha = x.play ? ` style="--tier-a:${Math.min(0.36, 0.14 + (e - minEdge()) * 2.5).toFixed(2)}"` : "";
  return `<td class="num sim-tight sim-edgec${cls}"${alpha} title="Our ${pct(x.chance)} minus the ${(oddsProb(x.price) * 100).toFixed(1)}% this price needs">${e === null ? "--" : signed(e * 100)}</td>`;
}
function playerCell(pid, team, opp, home) {
  return `<td class="sim-plcell"><span class="sim-pl-in">${headshot(pid)}${playerClick(pid, `<b>${nameOf(pid)}</b>`)}<span class="muted-label">${posOf(pid)}</span><span class="sim-vs">${logo(team, 16)}<span>${home ? "vs" : "@"}</span>${logo(opp, 16)}</span></span></td>`;
}
function ratingTag(play, live) {
  if (!play) return '<span class="muted-label">--</span>';
  // every play is Strong (the owner, 2026-10-26: "can we not say TOP PLAY anymore")
  return `<span class="sim-rate"${live ? ' title="Locked at tip: this is the play the record grades"' : ""}>Strong</span>`;
}
// Best Plays' Market cell: which page the play is from (its page's tab look, small)
const marketCell = (mk) => (BEST ? `<td class="sim-tight"><span class="sim-mkt sim-mkt-${mk.market}">${mk.unit}</span></td>` : "");
function listRow(x, i, cols) {
  MK = x.mk;
  const key = `${MK.market}:${x.g.game_id}:${x.pid}`;
  const open = LIST.open === key;
  const save = typeof nbaCardSaveBox === "function"
    ? nbaCardSaveBox(nbaCardEntry(MK.market, x.g, { id: x.pid, name: nameOf(x.pid), team: x.team }, x.side, x.line, [x.book, x.side, x.line, x.price]))
    : "";
  const f = fair(x.chance);
  return `<tr class="sim-row${open ? " open" : ""}${x.live ? " live" : ""}${x.held ? " held" : ""}" data-row="${key}">
    <td class="num sim-rank">${i + 1}</td>${playerCell(x.pid, x.team, x.opp, x.home)}${marketCell(x.mk)}
    <td class="sim-playc">${chip(x.side, x.line, x.price, x.book)}${x.live ? "" : save}</td>
    <td class="sim-tight">${ratingTag(x.play, x.live)}</td>
    <td class="num sim-tight" title="Our chance: ${pct(x.chance)}">${f === null ? "--" : showOdds(f)}</td>${edgeCell(x)}
    ${hitCell(x.hits.l5, "Last 5 games over tonight's line")}${hitCell(x.hits.l10, "Last 10 games over tonight's line")}${hitCell(x.hits.all, "This season's games over tonight's line")}${hitCell(x.hits.home, "Home games over tonight's line")}${hitCell(x.hits.away, "Road games over tonight's line")}
    <td class="sim-tagc"><div class="sim-rtags">${x.tags.map(tagHtml).join("")}</div></td></tr>
    ${open ? `<tr class="sim-detail"><td colspan="${cols}">${detail(x)}</td></tr>` : ""}`;
}
// ---- the open row: The Model (the 10,000 games and every rung) and the Shot Chart ----
function hist(lad, side, line) {
  const [lo, xs] = lad;
  const bars = xs.map((x, i) => ({ k: lo + i, exact: (x - (xs[i + 1] || 0)) / 1000, hit: side === "o" ? lo + i > line : lo + i < line }));
  const peak = Math.max(...bars.map((b) => b.exact), 0.0001);
  return `<div class="sim-hist">${bars.map((b) => `<div class="${b.hit ? "hit" : ""}" style="height:${Math.max(2, Math.round((100 * b.exact) / peak))}%" title="${b.k}: ${(b.exact * 100).toFixed(1)}%"></div>`).join("")}</div>
    <div class="sim-hlab">${bars.map((b, i) => `<span>${i % Math.ceil(bars.length / 9) === 0 ? b.k : ""}</span>`).join("")}</div>`;
}
function ladderTable(x) {
  const ml = x.line;
  const rows = sideLines(x.g, x.pid, x.side).map((line) => [x.side, line]);
  if (!rows.some(([, l]) => l === ml)) rows.push([x.side, ml]);
  rows.sort((a, b) => (x.side === "o" ? a[1] - b[1] : b[1] - a[1]));
  rows.push([x.side === "o" ? "u" : "o", ml]); // the main line's other side, last (the NHL ladder's way)
  const body = rows.map(([side, line]) => {
    const c = sideChance(x.lad, side, line);
    const best = bestPrice(x.g, x.pid, side, line);
    const edge = best ? c - oddsProb(best.price) : null;
    const f = fair(c);
    const spec = priceSpec(x.g, x.pid, side, line, x.team);
    const isMain = line === ml;
    const isLadder = x.ladder && side === x.side && line === x.ladder.line;
    return `<tr class="${isMain ? "main" : ""}${isLadder ? " best" : ""}"><td>${side === "o" ? "Over" : "Under"} ${fmt(line)}${isMain ? '<span class="sim-mn">Main</span>' : ""}</td>
      <td class="num">${pct(c)}</td><td class="num">${f === null ? "--" : showOdds(f)}</td>
      <td class="num">${best ? `<button type="button" class="sim-mini" data-bo="${boEnc(spec)}" title="Every book">${showOdds(best.price)} <small>${BOOK_INITIALS[best.book] || best.book}</small></button>` : "--"}</td>
      <td class="num"${edge === null || Math.abs(edge) < EDGE_SHADE ? "" : shade(edge)}>${edge === null ? "--" : signed(edge * 100)}</td></tr>`;
  }).join("");
  return `<table class="sim-ladt"><thead><tr><th>Line</th><th>Our Chance</th><th>Fair</th><th>Best Price</th><th>Edge</th></tr></thead><tbody>${body}</tbody></table>`;
}
function detail(x) {
  const tabs = `<div class="sim-itabs">${[["model", "The Model"], ["shots", "Shot Chart"]].map(([k, label]) => `<button type="button" class="${LIST.tab === k ? "on" : ""}" data-sim-tab="${k}">${label}</button>`).join("")}</div>`;
  if (LIST.tab === "shots") {
    return `${tabs}<div class="sim-shots">${zonesView(x)}</div>`;
  }
  const sim = sims()[x.g.game_id];
  const needs = oddsProb(x.price);
  const all = x.r[MK.stat].lad;
  const scripts = Object.fromEntries(SCRIPT_KEYS.map((k) => [k, all[k] ? sideChance(all[k], x.side, x.line) : null]));
  const kind = KINDS[kindOf(scripts, needs)];
  const dials = ["away", "home"].flatMap((k) => (sim.dials[k] || []).map((d) => dialText(x.g, k, d)));
  const starts = ((sim.starters || {})[x.r.team] || []).includes(x.pid);
  const hits = Math.min(9990, Math.round(x.chance * 1000) * 10);
  const f = fair(x.chance);
  return `${tabs}<div class="sim-dgrid">
    <div>
      <div class="sim-kicker">${playName({ side: x.side, line: x.line, main: true })} &middot; ${MK.unit} In The 10,000 Games</div>
      <div class="sim-nums sim-nums4">
        <div><small>Hit In</small><b>${hits.toLocaleString()}</b><i>of 10,000</i></div>
        <div><small>GMG Fair</small><b>${f === null ? "--" : showOdds(f)}</b><i>${pct(x.chance)}</i></div>
        <div class="${x.edge > 0 ? "sim-edge" : "sim-edge-gone"}"><small>Edge</small><b>${signed(x.edge * 100)}</b><i>needs ${(needs * 100).toFixed(1)}%</i></div>
        <div><small>Book Line</small><b>${fmt(x.line)}</b><i>our median ${fmt(x.r[MK.stat].med.all, 0)}</i></div>
      </div>
      <div class="sim-kicker">How Often It Hits In Each Script</div>
      <div class="sim-scripts">${SCRIPT_KEYS.map((k) => `<div${scripts[k] === null ? "" : shade(scripts[k] - needs)}><small>${scriptLabel(x.g, k, true)}</small><b>${scripts[k] === null ? "--" : pct(scripts[k])}</b></div>`).join("")}</div>
      <div class="sim-kicker">His ${MK.unit} In The 10,000 Games &middot; Green = This Side Wins</div>
      ${hist(all.all, x.side, x.line)}
      <div class="sim-tags">${kind ? `<span class="sim-tag ${kind[1]}" title="${kind[2]}">${kind[0]}</span>` : ""}${dials.map((d) => `<span class="sim-tag sim-t-dial">${d}</span>`).join("")}${starts ? `<span class="sim-tag sim-t-why" title="${sim.lineup ? "In the NBA's starting five" : "One of his team's five with the most minutes (the NBA's five isn't posted yet)"}">Starting</span>` : ""}${x.live ? '<span class="sim-tag sim-t-why" title="Saved at tip-off: this is the play the record grades">Locked At Tip</span>' : ""}</div>
    </div>
    <div>
      <div class="sim-kicker">The Ladder &middot; ${x.side === "o" ? "Overs" : "Unders"}, Then The Other Side</div>
      ${ladderTable(x)}
      <p class="sim-off">Best Price: the best across your books; click it for every book. Shaded at ${Math.round(EDGE_SHADE * 100)}+ points either way.</p>
    </div>
  </div>`;
}
// His shots next to every shot tonight's defense has allowed (shot-chart.js), one set of filters
// for both, then the zones where both sides point the same way (nbaShotCall, the Shot Charts page's
// Target / Tough rule). Back from the old board (the owner, 2026-10-25: "instead of the list of
// columns and rows that regurgitate the chart anyway, can you add back the defensive chart for allowed").
function zonesView(x) {
  if (typeof nbaShotFile !== "function") return "";
  const file = nbaShotFile();
  if (file === undefined) {
    Promise.resolve(NBA_SHOT_FILE).then(() => renderList());
    return '<p class="no-data-note">Loading&hellip;</p>';
  }
  if (!file) return `<p class="no-data-note">Shot charts aren't available right now.</p>`;
  const league = file.league || [];
  const mine = nbaShotPick((file.players || {})[String(x.pid)] || [], NBA_SHOT_STATE);
  const allowed = nbaShotPick(nbaShotAllowed(file, x.opp), NBA_SHOT_STATE);
  const fg = (shots) => `${shots.length} Shots &middot; FG ${nbaShotPct(shots.reduce((n, s) => n + s[2], 0), shots.length)}`;
  const chart = (shots, opts) => (!shots.length ? '<p class="no-data-note">No shots with these filters.</p>'
    : `<div class="nba-shot-chart">${NBA_SHOT_STATE.view === "heat" ? nbaShotHeatView(shots, league, opts) : nbaShotZonesView(shots, league, opts)}</div>`);
  const side = (abbr, label, shots, opts) => `<div class="sim-zone-side"><div class="sim-zone-head">${logo(abbr, 16)} <b>${label}</b><small>${fg(shots)}</small></div>${chart(shots, opts)}</div>`;
  const ours = nbaShotZoneTotals(mine, false);
  const theirs = nbaShotZoneTotals(allowed, false);
  const lg = nbaShotZoneTotals(league, true);
  const calls = [];
  NBA_SHOT_GROUPS.forEach(([group, zones]) => zones.forEach(([z, name]) => {
    const lr = lg[z] && lg[z][1] ? lg[z][0] / lg[z][1] : null;
    const share = mine.length ? (ours[z] || [0, 0])[1] / mine.length : 0;
    const call = nbaShotCall(ours[z], theirs[z], lr, share);
    if (call) calls.push(`<span class="sim-zone-call" style="background:${nbaShotColor(call * NBA_SHOT_FULL, 0.3)};border-color:${nbaShotColor(call * NBA_SHOT_FULL, 0.8)}" title="${Math.round(share * 100)}% of his shots">${call === 1 ? "Target" : "Tough"}: ${group === "Threes" ? `${name} 3` : group === "Mid-Range" ? `Mid ${name}` : name}</span>`);
  }));
  return `<div class="nba-shot-controls">${nbaShotControls()}</div>
    <div class="sim-zone-pair">${side(x.team, nameOf(x.pid), mine)}${side(x.opp, `${x.opp} Defense Allows`, allowed, { allowed: true })}</div>
    <div class="sim-zone-calls">${calls.length ? calls.join("") : '<span class="muted-label">No zone where both sides point the same way.</span>'}
      <a class="sim-zone-more" href="shot-charts.html#p=${x.pid}&d=${x.opp}">Zone By Zone &rsaquo;</a></div>`;
}
// The header: one "Hit Rate - Based On Over Points / Threes" box over the hit rate columns (the old
// board's look; the owner, 2026-10-25: "make title (based on over points)").
function listHead(cols) {
  let group = "";
  for (let i = 0; i < cols.length; i += 1) {
    if (cols[i].hit) {
      let n = 0;
      while (cols[i + n] && cols[i + n].hit) n += 1;
      group += `<th colspan="${n}" class="sim-hitgroup" title="How often he went OVER tonight's line (${BEST ? "the play's market" : MK.unit.toLowerCase()}), whichever side the play is"><span>Hit Rate - Based On Over ${BEST ? "His Line" : MK.unit}</span></th>`;
      i += n - 1;
    } else group += "<th></th>";
  }
  return `<thead><tr class="sim-group-row">${group}</tr><tr>${cols.map((c) => {
    const on = c.key && c.key === LIST.sort;
    const cls = [c.key ? "sim-sort" : "", on ? "on" : "", c.cls || "", c.hit ? "sim-hit-th" : ""].filter(Boolean).join(" ");
    return `<th${cls ? ` class="${cls}"` : ""}${c.key ? ` data-sort="${c.key}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${on ? `<span class="sim-arrow">${LIST.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("")}</tr></thead>`;
}
function renderList() {
  const date = days()[dayIndex];
  if (isPast(date)) return renderPast(date);
  el("sim-toolbar").hidden = false;
  renderToolbar(listRows(date));
  const rows = sortedList(date);
  const bar = Math.round(minEdge() * 100);
  const all = playsOn(date).length;
  const waiting = heldOn(date).length;
  el("sim-list-note").innerHTML = `${all} play${all === 1 ? "" : "s"} tonight${waiting ? ` &middot; ${waiting} waiting on the market` : ""} &middot; ${bar}+ points of edge on his main line, at the best price &middot; click a row for the model, the ladder and his shot chart`;
  const cols = COLS.length;
  if (!rows.length) {
    const noOdds = !Object.keys(DATA.book_odds || {}).length;
    el("sim-list").innerHTML = `<p class="sim-noplay">${noOdds ? "The books haven't posted these lines yet. Plays show up once they do." : LIST.every ? "No player matches these filters." : `No plays${LIST.game ? " in this game" : " tonight"}: no main line has ${bar}+ points of edge.`}${!LIST.every ? ' <button type="button" class="view-toggle-btn" data-list-every="true">Show Every Player</button>' : ""}</p>`;
    return;
  }
  const body = rows.map((x, i) => {
    const prev = rows[i - 1];
    const liveHead = x.live && i > 0 && !prev.live
      ? `<tr class="sim-group"><td colspan="${cols}">Started: locked at tip, the price and the play the record grades.</td></tr>` : "";
    const heldHead = x.held && (!prev || !prev.held)
      ? `<tr class="sim-group"><td colspan="${cols}">Waiting On Market: a teammate was ruled Out after these lines were posted, and they haven't moved yet.</td></tr>` : "";
    const restHead = LIST.every && LIST.sort === "edge" && !x.play && !x.held && (!prev || prev.play || prev.held || prev.live !== x.live)
      ? `<tr class="sim-group"><td colspan="${cols}">Not plays: under ${bar} points of edge on his main line, or not enough games or minutes yet.</td></tr>` : "";
    return liveHead + heldHead + restHead + listRow(x, i, cols);
  }).join("");
  el("sim-list").innerHTML = `<div class="nba-box sim-listbox"><div class="sim-scroll"><table class="data-table sim-list">${listHead(COLS)}<tbody>${body}</tbody></table></div></div>`;
  fitTags();
}
// Tags fill at most two lines, the same box on every row (the owner: "I NEVER want tags to stack" into taller rows, "just do a +1 or +2 etc tag that
// can be hovered over"): the ones that don't fit fold into a "+N" pill naming them on hover.
function fitTags() {
  document.querySelectorAll("#sim-list .sim-rtags").forEach((box) => {
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
      more.title = rest.map((t) => t.textContent.trim()).join(" \u00b7 ");
      if (box.scrollHeight <= box.clientHeight + 1) break;
    }
  });
}
window.addEventListener("resize", () => {
  clearTimeout(fitTags.wait);
  fitTags.wait = setTimeout(fitTags, 120);
});
// ---- a past night: each play as locked at tip, Hit / Miss and what he got ----
const unitsWon = (p) => (p.price > 0 ? p.price / 100 : 100 / -p.price);
function renderPast(date) {
  el("sim-toolbar").hidden = true;
  const plays = pastOn(date).sort((a, b) => b.edge - a.edge);
  const graded = plays.filter((p) => p.result === "won" || p.result === "lost");
  const w = graded.filter((p) => p.result === "won").length;
  const u = graded.reduce((a, p) => a + (p.result === "won" ? unitsWon(p) : -1), 0);
  const waiting = plays.filter((p) => !p.result).length;
  el("sim-list-note").innerHTML = `Results &middot; ${plays.length} play${plays.length === 1 ? "" : "s"}, locked at tip, graded at the best price across every book, 1 unit${waiting ? ` &middot; ${waiting} waiting on the box score` : ""}`;
  if (!plays.length) {
    el("sim-list").innerHTML = '<p class="sim-noplay">No plays this night.</p>';
    return;
  }
  const rows = plays.map((p, i) => {
    MK = p.mk;
    const final = { won: ["sim-won", "Hit"], lost: ["sim-lost", "Miss"], push: ["", "Push"], sat: ["", "Didn't Play"] }[p.result] || ["", "Waiting"];
    const units = p.result === "won" ? unitsWon(p) : p.result === "lost" ? -1 : 0;
    const done = p.result === "won" || p.result === "lost";
    return `<tr class="sim-row past${done ? ` ${p.result}` : ""}"><td class="num sim-rank">${i + 1}</td>${playerCell(p.pid, p.team, p.opp, p.home)}${marketCell(p.mk)}
      <td class="sim-playc">${chip(p.side, p.line, p.price, p.book, p.main !== false)}</td><td>${ratingTag(p, false)}</td>
      <td class="num sim-result ${final[0]}"><b>${final[1]}</b>${p.got === null || p.got === undefined ? "" : ` <span>${fmt(p.got, 0)}</span>`}</td>
      <td class="num">${pct(p.chance)}</td><td class="num">${signed(p.edge * 100)}</td>
      <td class="num ${units > 0 ? "sim-up" : units < 0 ? "sim-down" : ""}">${done ? `${units >= 0 ? "+" : "&minus;"}${Math.abs(units).toFixed(2)}u` : "--"}</td><td class="sim-spacer"></td></tr>`;
  }).join("");
  const head = `<thead><tr><th>#</th><th class="sim-th-player">Player</th>${BEST ? "<th>Market</th>" : ""}<th>Play</th><th>Rating</th><th title="Hit / Miss and his ${BEST ? "number" : MK.unit.toLowerCase()}">Result</th><th>Hit %</th><th title="Edge at the price locked at tip">Edge</th><th>Units</th><th class="sim-spacer"></th></tr></thead>`;
  el("sim-list").innerHTML = `<div class="sim-night">
      <div><small>Record</small><b>${graded.length ? `${w}-${graded.length - w}` : "--"}</b></div>
      <div><small>Units</small><b class="${u >= 0 ? "sim-up" : "sim-down"}">${graded.length ? `${u >= 0 ? "+" : "&minus;"}${Math.abs(u).toFixed(2)}u` : "--"}</b></div>
      <div><small>Hit %</small><b>${graded.length ? `${Math.round((w / graded.length) * 100)}%` : "--"}</b></div>
    </div>
    <div class="nba-box sim-listbox"><div class="sim-scroll"><table class="data-table sim-list">${head}<tbody>${rows}</tbody></table></div></div>`;
}

// ---- the game board ----
// The game cards: in Player View a card narrows the list to that game (again = every game,
// the NHL pages' way); in Matchup View it picks the game board's game.
// One pick for both views and every sim page (the owner, 2026-10-25: switching views or going
// Points to Threes should "stay on the same game instead of resetting"): a card click in either
// view picks it for both, and the night + game ride along to the next page for this tab.
const PICK_KEY = "nfl-tool.nba-sim-pick";
function pickGame(id) {
  LIST.game = id;
  if (id) gameId = id;
}
function savePick() {
  try {
    sessionStorage.setItem(PICK_KEY, JSON.stringify({ date: days()[dayIndex], game: LIST.game, board: gameId }));
  } catch (err) {
    // sessionStorage unavailable -- the next page opens on its own default.
  }
}
function loadPick() {
  try {
    const p = JSON.parse(sessionStorage.getItem(PICK_KEY) || "null");
    const at = p ? days().indexOf(p.date) : -1;
    if (at < 0) return;
    dayIndex = at;
    LIST.game = p.game || "";
    gameId = p.board || "";
  } catch (err) {
    // nothing saved, or sessionStorage unavailable
  }
}
function renderGamePicker() {
  const games = gamesOn(days()[dayIndex]);
  if (!games.some((g) => g.game_id === gameId)) gameId = games.length ? games[0].game_id : "";
  if (!games.some((g) => g.game_id === LIST.game)) LIST.game = "";
  savePick();
  const on = view === "matchup" ? gameId : LIST.game;
  el("matchup-row").innerHTML = games.map((g) => {
    const n = playsOn(g.date).filter((p) => p.game === g.game_id).length;
    return `<button type="button" class="matchup-card${g.game_id === on ? " selected" : ""}" data-game="${g.game_id}">
      <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
      <span class="matchup-date">${fmtTime(g.time)}${n ? ` &middot; ${n} Play${n === 1 ? "" : "s"}` : ""}</span></button>`;
  }).join("");
}
function scriptBar(g, shares) {
  const part = (k, color, cls = "") => `<div class="${cls}" style="width:${Math.max(8, shares[k] * 100)}%;background:${color}"><small>${scriptLabel(g, k)}</small><b>${pct(shares[k])}</b></div>`;
  return `<div class="sim-sbar">${part("away", `#${team(g.away).color || "444"}`)}${part("close", "var(--table-head)", "sim-sbar-close")}${part("home", `#${team(g.home).color || "444"}`)}</div>`;
}
// A price cell's shade: green / red past EDGE_SHADE, yellow near fair, gray with no price.
function priceShade(edge) {
  if (edge === null || edge === undefined) return ' style="background:var(--panel-2);color:var(--muted)"';
  return Math.abs(edge) < EDGE_SHADE ? ' style="background:rgba(var(--mid-rgb),.2)"' : shade(edge);
}
// His median to a tenth, read off the ladder (the sim's own median is a whole number, so every
// Threes line read "-0.5"): the middle of the count he lands on, by how the 10,000 games split.
function smoothMedian(lad) {
  let k = (lad || [0])[0];
  while (atLeast(lad, k + 1) >= 0.5) k += 1;
  const at = atLeast(lad, k) - atLeast(lad, k + 1);
  return at > 0 ? k - 0.5 + (0.5 - (1 - atLeast(lad, k))) / at : k;
}
// The game board (rebuilt 2026-10-25, the owner: "give this a UI improvement to the max. Fill the
// space and make it enjoyable to read"): one strip on top (Spread / Sim, Total / Sim, the script
// bar), then a card a team, side by side, each half the width: the team's banner (Show Ladder on
// it), Player View's table look, starters then the bench. Columns: Min, PTS / 3PM (his median to
// a tenth), Line (Player View's chip: our side of his main line at the best price, a click = every
// book), Diff (median minus the line), Edge, and the ladder when that team's is open (the card
// then takes the full width). The Script Picker, Script / % columns and Dials Tonight came off
// earlier the same day (the dials are in every sim; the scripts live on in the bar, the Player
// View tags and The Model).
const LADDER_OPEN = { away: false, home: false };
function renderBoard() {
  const g = DATA.schedule.find((x) => x.game_id === gameId);
  const sim = g && sims()[g.game_id];
  if (!sim) {
    el("sim-board").innerHTML = `<p class="sim-noplay">${isPast(days()[dayIndex]) ? "The game board is for upcoming games. This night's plays are graded in Player View." : "No game on this day."}</p>`;
    return;
  }
  const lean = sim.margin === 0 ? "Even" : `${sim.margin > 0 ? g.home : g.away} By ${Math.abs(sim.margin)}`;
  const spread = g.home_team_spread;
  const book = spread === null || spread === undefined ? "--" : spread === 0 ? "Pick" : `${spread < 0 ? g.home : g.away} &minus;${fmt(Math.abs(spread))}`;
  const plays = playsOn(g.date).filter((p) => p.game === g.game_id);
  const isPlay = (pid, line, side) => plays.some((p) => p.pid === pid && p.line === line && p.side === side);
  const rungs = MK.rungs;
  const row = (k, pid, r) => {
    const lad = r[MK.stat].lad.all;
    const med = lad && lad[1] && lad[1].length ? smoothMedian(lad) : null;
    const tm = g[k];
    const ml = mainLine(g, pid);
    let mainCells = '<td class="sim-noline" colspan="3">No Line</td>';
    if (ml !== null) {
      const sides = ["o", "u"].map((side) => {
        const best = bestPrice(g, pid, side, ml);
        const c = sideChance(lad, side, ml);
        return { side, best, c, edge: best ? c - oddsProb(best.price) : null };
      });
      const pick = sides.filter((x) => x.edge !== null).sort((a, b) => b.edge - a.edge)[0] || sides[0];
      const spec = priceSpec(g, pid, pick.side, ml, tm);
      // Diff: his median past the line on our side, deeper the farther (a 4 floor so a 2.5 line isn't all color)
      const diff = med === null ? null : med - ml;
      const diffShade = diff === null ? "" : shade((pick.side === "o" ? diff : -diff) / Math.max(4, ml) / 2);
      const theChip = chip(pick.side, ml, pick.best ? pick.best.price : null, pick.best ? pick.best.book : "");
      mainCells = `<td class="sim-rung main${isPlay(pid, ml, pick.side) ? " pick" : ""}">${pick.best ? `<button type="button" class="sim-chipbtn" data-bo="${boEnc(spec)}" title="Every book's price">${theChip}</button>` : theChip}</td>
        <td class="sim-num"${diffShade}>${diff === null ? "--" : signed(diff)}</td>
        <td class="sim-num"${priceShade(pick.edge)}>${pick.edge === null ? "--" : signed(pick.edge * 100)}</td>`;
    }
    const rungCells = LADDER_OPEN[k] ? rungs.map((n) => {
      const line = n - 0.5;
      const c = chanceOver(lad, line);
      const best = bestPrice(g, pid, "o", line);
      const edge = best ? c - oddsProb(best.price) : null;
      const spec = priceSpec(g, pid, "o", line, tm);
      return `<td class="sim-rung${isPlay(pid, line, "o") ? " pick" : ""}"${priceShade(edge)}><b>${pct(c)}</b>${best ? `<button type="button" class="sim-mini" data-bo="${boEnc(spec)}">${showOdds(best.price)}</button>` : "<small>&mdash;</small>"}</td>`;
    }).join("") : "";
    const mark = `<button type="button" class="sim-markout" data-mo="${pid}" data-mo-team="${k}" data-mo-out="1" title="Mark him Out tonight: the sims rerun without him in about 5 minutes">Mark Out</button>`;
    return `<tr><td class="sim-pl">${headshot(pid)}${playerClick(pid, `<b>${nameOf(pid)}</b>`)}<span class="sim-pos">${posOf(pid)}</span>${mark}</td>
      <td class="sim-min">${fmt(r.min)}</td><td class="sim-num sim-med">${med === null ? "--" : fmt(med)}</td>${mainCells}${rungCells}</tr>`;
  };
  // a player who sits tonight (sim.out: listed Out, or a usual starter on the injury report who
  // isn't in the NBA's posted five): grayed under the bench with his status, his minutes this season
  const outRow = (k, pid, cols) => {
    const inj = ((DATA.injuries || {})[g[k]] || []).find((i) => String(i.id) === pid) || {};
    const status = inj.status || "Out";
    const label = status === "Out" ? "Out" : status === "Doubtful" ? "Doubtful" : status === "Questionable" ? "Questionable" : "Day-To-Day";
    const why = status === "Out" ? (inj.injury || "Listed Out") : `${label} and not in the NBA's posted five: the sim sits him`;
    const log = logOf(pid);
    const f = logFields();
    const avg = log.length ? log.reduce((a, r) => a + r[f.min], 0) / log.length : null;
    const note = inj.note ? ` title="${inj.note.replace(/"/g, "&quot;")}"` : "";
    // the owner's own mark (Mark Out): an Undo, owner only
    const undo = inj.marked ? `<button type="button" class="sim-markout" data-mo="${pid}" data-mo-team="${k}" data-mo-out="0" title="Take your mark off: the sims rerun with him">Undo</button>` : "";
    return `<tr class="sim-outrow"${note}><td class="sim-pl">${headshot(pid)}${playerClick(pid, `<b>${nameOf(pid)}</b>`)}<span class="sim-pos">${posOf(pid)}</span><span class="gs-inj-status ${status === "Out" ? "tier-bad" : "tier-mid"}">${inj.marked ? "Out (GMG)" : label}</span>${undo}</td>
      <td class="sim-min" title="His minutes a game this season">${fmt(avg)}</td><td class="sim-noline sim-outwhy" colspan="${cols - 2}">${why}</td></tr>`;
  };
  // one team's card: its banner (with the ladder switch), then starters, the bench and who sits tonight
  const teamCard = (k) => {
    const open = LADDER_OPEN[k];
    const all = Object.entries(sim.players).filter(([, r]) => r.team === k && r.min >= 6).sort((a, b) => b[1].min - a[1].min);
    const five = (sim.starters || {})[k] || [];
    const starters = all.filter(([pid]) => five.includes(pid));
    const bench = all.filter(([pid]) => !five.includes(pid));
    const cols = 6 + (open ? rungs.length : 0);
    const group = (label) => `<tr class="group-row sim-bgroup"><td colspan="${cols}">${label}</td></tr>`;
    const sat = ((sim.out || {})[k] || []).filter((pid) => !sim.players[pid]);
    const body = (starters.length
      ? `${group("Starters")}${starters.map(([pid, r]) => row(k, pid, r)).join("")}${bench.length ? group("Bench") : ""}${bench.map(([pid, r]) => row(k, pid, r)).join("")}`
      : all.map(([pid, r]) => row(k, pid, r)).join("")) + (sat.length ? `${group("Out Tonight")}${sat.map((pid) => outRow(k, pid, cols)).join("")}` : "");
    const color = team(g[k]).color || "555555";
    return `<section class="sim-tcard${open ? " wide" : ""}" data-team="${k}">
      <div class="sim-tbar" style="--tc:#${color}">${logo(g[k], 28)}<b>${team(g[k]).name}</b>
        <button type="button" class="sim-ladder-btn${open ? " on" : ""}" data-ladder="${k}">${open ? "Hide Ladder" : `Show Ladder <small>${rungs[0]}+ To ${rungs[rungs.length - 1]}+</small>`}</button></div>
      <div class="sim-tablewrap"><table class="data-table sim-bt">
        <thead><tr class="sim-thead"><th class="sim-th-player">Player</th><th>Min</th><th title="His median in the 10,000 games">${MK.short}</th><th>Line</th><th title="His median minus the line">Diff</th><th title="Our chance minus what the best price needs">Edge</th>${open ? rungs.map((n) => `<th class="sim-th-rung">${n}+</th>`).join("") : ""}</tr></thead>
        <tbody>${body}</tbody></table></div>
    </section>`;
  };
  el("sim-board").innerHTML = `<div class="sim-game">
    <div class="sim-gbar"><div style="background:#${team(g.away).color || "333"}">${logo(g.away, 34)} ${team(g.away).name}</div>
      <div class="sim-gmid"><small>${new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })} ${fmtTime(g.time)}</small>@</div>
      <div style="background:#${team(g.home).color || "333"}">${team(g.home).name} ${logo(g.home, 34)}</div></div>
    <div class="sim-strip">
      <div class="sim-score"><div><small>Spread</small><b>${book}</b></div><div class="sim-sim"><small>Sim</small><b>${lean}</b></div>
        <div><small>Total</small><b>${g.total_line === null || g.total_line === undefined ? "--" : fmt(g.total_line)}</b></div><div class="sim-sim"><small>Sim</small><b>${fmt(sim.total, 0)}</b></div></div>
      ${scriptBar(g, sim.scripts)}
    </div>
    <div class="sim-teams${LADDER_OPEN.away || LADDER_OPEN.home ? " stacked" : ""}">${teamCard("away")}${teamCard("home")}</div>
    <div class="sim-legend"><span><i style="background:rgba(var(--good-rgb),.34)"></i>Our chance beats the best price by ${Math.round(EDGE_SHADE * 100)}+</span><span><i style="background:rgba(var(--mid-rgb),.3)"></i>Near fair</span><span><i style="background:rgba(var(--bad-rgb),.3)"></i>The price beats our chance</span><span><i style="background:var(--panel-2);border:1px solid var(--border)"></i>No price</span><span><i class="sim-legend-pick"></i>Tonight's play</span></div>
  </div>`;
}

// The owner's Mark Out (2026-10-25): /api/nba-outs saves it and starts the NBA refresh, so the
// sims rerun without him (the build reads the list). The page shows the new sims after a reload.
async function markOut(btn) {
  const g = DATA.schedule.find((x) => x.game_id === gameId);
  if (!g || btn.disabled) return;
  const out = btn.dataset.moOut === "1";
  const pid = btn.dataset.mo;
  if (out && !confirm(`Mark ${nameOf(pid)} Out tonight? The sims rerun without him in about 5 minutes.`)) return;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetch("/api/nba-outs", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: g.date, pid, name: nameOf(pid), team: g[btn.dataset.moTeam], out }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.status);
    btn.textContent = body.refresh === "started" ? "Rerunning: Reload In ~5 Min" : `Saved (Refresh: ${body.refresh})`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Failed (${err.message}): Try Again`;
  }
}

function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  renderRecord();
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  el("sim-player").hidden = view !== "player";
  if (el("sim-matchup")) el("sim-matchup").hidden = view !== "matchup"; // Best Plays has no Matchup View
  renderGamePicker();
  if (view === "player") renderList();
  else renderBoard();
}

// Player View / Matchup View (the owner, 2026-10-25): a display pref, kept per device.
let view = "player";
try {
  if (!BEST && localStorage.getItem("nfl-tool.nba-sim-view") === "matchup") view = "matchup";
} catch (err) {
  // localStorage unavailable -- opens on Player View.
}
document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-list]");
  if (sel) {
    LIST[sel.dataset.list] = sel.dataset.list === "minEdge" ? Number(sel.value) : sel.value;
    LIST.open = null;
    return renderList();
  }
  // a play saved to My Plays from a row (nba-card.js saves it): keep the boxes in step
  if (e.target.closest("#sim-list .nba-pc-toggle")) renderList();
});
document.addEventListener("nba-shot-changed", () => view === "player" && LIST.tab === "shots" && renderList());
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]");
  if (v) {
    view = v.dataset.view;
    try {
      localStorage.setItem("nfl-tool.nba-sim-view", view);
    } catch (err) {
      // localStorage unavailable -- the view just won't stick.
    }
    return render();
  }
  const card = e.target.closest("#matchup-row [data-game]");
  if (card) {
    if (view === "matchup") {
      pickGame(card.dataset.game);
      renderGamePicker();
      return renderBoard();
    }
    pickGame(LIST.game === card.dataset.game ? "" : card.dataset.game);
    LIST.open = null;
    renderGamePicker();
    return renderList();
  }
  const clear = e.target.closest("[data-list-game]");
  if (clear) {
    LIST.game = "";
    renderGamePicker();
    return renderList();
  }
  const mkt = e.target.closest("[data-list-market]");
  if (mkt) {
    const key = mkt.dataset.listMarket;
    const on = LIST.markets[key] !== false;
    if (on && MARKETS.filter((m) => LIST.markets[m.market] !== false).length === 1) return; // the last one stays on
    LIST.markets[key] = !on;
    LIST.open = null;
    renderGamePicker();
    return renderList();
  }
  const every = e.target.closest("[data-list-every]");
  if (every) {
    LIST.every = every.dataset.listEvery === "true";
    LIST.open = null;
    return renderList();
  }
  const sort = e.target.closest("#sim-list [data-sort]");
  if (sort) {
    if (LIST.sort === sort.dataset.sort) LIST.dir = -LIST.dir;
    else {
      LIST.sort = sort.dataset.sort;
      LIST.dir = -1;
    }
    return renderList();
  }
  const tab = e.target.closest("[data-sim-tab]");
  if (tab) {
    LIST.tab = tab.dataset.simTab;
    if (LIST.tab === "shots" && typeof nbaShotFile === "function" && nbaShotFile() === undefined) Promise.resolve(NBA_SHOT_FILE).then(renderList);
    return renderList();
  }
  // a click on a row (anywhere but the name, a price or the save box) opens its detail
  const row = e.target.closest("#sim-list tr.sim-row[data-row]");
  if (row && !e.target.closest("a, button, label, input, .player-click, [data-bo]")) {
    LIST.open = LIST.open === row.dataset.row ? null : row.dataset.row;
    return renderList();
  }
  const mo = e.target.closest("[data-mo]");
  if (mo) return markOut(mo);
  const ladder = e.target.closest("[data-ladder]");
  if (ladder) {
    LADDER_OPEN[ladder.dataset.ladder] = !LADDER_OPEN[ladder.dataset.ladder];
    return renderBoard();
  }
  if (e.target.closest("#sim-ytd")) return renderYtd();
  if (e.target.closest("#day-prev") && dayIndex > 0) {
    dayIndex -= 1;
    LIST.open = null;
    return render();
  }
  if (e.target.closest("#day-next") && dayIndex < days().length - 1) {
    dayIndex += 1;
    LIST.open = null;
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

// the alt ladders ("points_alt" ...) come in their own ladders.json (the build splits them out to keep
// data.json under Cloudflare's 25 MB a file) and go back into book_odds here
const mergeLadders = (data, ladders) => {
  for (const [key, game] of Object.entries(ladders || {})) {
    const into = (data.book_odds || {})[key];
    if (into) into.props = { ...(into.props || {}), ...(game.props || {}) };
  }
  return data;
};

Promise.all([fetch("data.json").then((r) => r.json()), fetch("props.json").then((r) => r.json()),
  fetch("ladders.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))])
  .then(([data, props, ladders]) => {
    DATA = mergeLadders(data, ladders);
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
    loadPick(); // the night and game picked on the last sim page, if any
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
