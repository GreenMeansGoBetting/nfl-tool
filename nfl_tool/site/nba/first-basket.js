// ---- GMG NBA Suite: First Basket ----
// The pieces behind a game's first points, laid out for the member to put
// together (the owner, 2026-10-20: "the pieces of the puzzle with data for
// users to solve"): the tip, scoring first, opening trips, the first field
// goal each defense allows by position, the likely starters, and a rough fair
// price at the bottom. Everything comes from nba/data.json `first_basket`
// (nfl_tool/nba/first_basket.py), except the starting fives: the NBA's own
// lineup file, read live through /api/nba-lineups (the login middleware) every
// minute, Expected until the team turns its five in, then Confirmed. Without
// it (not posted yet, or the NBA turns the request away) the page uses the
// build's copy of that file, then the build's likely starters.

let DATA = null;
let FB = null;
let season = null;
let dayIndex = 0;
let gameId = null;
const FB_GAME_KEY = "nba-tool.fb-game.v1";
const FB_SEASON_KEY = "nba-tool.fb-season.v1";
const MIN_STARTS = 15; // players colored against each other need this many starts
const LINEUP_POLL_MS = 60 * 1000;
const LINEUPS = {}; // {YYYY-MM-DD: {fetched, games, live}}
// The NBA's team abbreviations that differ from ESPN's (our keys).
const NBA_ABBR = { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" };

const el = (id) => document.getElementById(id);
const pct = (n) => (n === null || n === undefined ? "--" : `${Math.round(n * 100)}%`);
const fmt = (n, digits = 1) => (n === null || n === undefined ? "--" : Number(n).toFixed(digits));
const signed = (n) => (n === null || n === undefined ? "--" : `${n > 0 ? "+" : ""}${Number(n).toFixed(1)}`);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop`;
const face = (id, cls = "nba-headshot") => `<img src="${faceUrl(id)}" alt="" class="${cls}" loading="lazy" onerror="this.style.visibility='hidden'">`;
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr, right = "") {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span>${right ? `<span class="nba-banner-right">${right}</span>` : ""}</div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}

// Red (0) to green (120) through the member's color set (sync.js).
function heat(value, lo, hi, flip) {
  if (value === null || value === undefined || hi === lo) return "";
  let t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  if (flip) t = 1 - t;
  return ` style="background:${scaleHsla(Math.round(t * 120), 70, 45, 0.3)}"`;
}
const range = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
};
// A team number's color against every team's same number.
function teamHeat(key, value, flip) {
  const [lo, hi] = range(Object.values(block().teams).map((t) => (typeof key === "function" ? key(t) : t[key])));
  return heat(value, lo, hi, flip);
}
// A starter's rate against every regular starter's.
function playerHeat(key, value) {
  const [lo, hi] = range(Object.values(block().players).filter((p) => p.starts >= MIN_STARTS).map((p) => p[key] / p.starts));
  return heat(value, lo, hi);
}

const block = () => FB.seasons[season];
const slate = () => FB.slates[season] || {};
const game = () => DATA.schedule.find((g) => g.game_id === gameId) || null;
// The game's two sides (real lineup when the NBA has one, else the build's
// likely starters) and the fair guess from them.
function plan() {
  const g = game();
  const built = slate()[gameId];
  if (!g || !built) return null;
  const away = sideFor(g, g.away, built.away);
  const home = sideFor(g, g.home, built.home);
  return { away, home, fair: fairPrices(away, home) };
}

// ---- lineups ----
const nameKey = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
let rosterIndex = null;
// {team: {name key: ESPN id}} from the build's roster and season players.
function rosterIds() {
  if (rosterIndex) return rosterIndex;
  rosterIndex = {};
  const add = (id, name, abbr) => {
    (rosterIndex[abbr] = rosterIndex[abbr] || {})[nameKey(name)] = id;
  };
  Object.values(FB.seasons).forEach((b) => Object.entries(b.players).forEach(([id, p]) => add(id, p.name, p.team)));
  Object.entries(FB.roster || {}).forEach(([id, [name, abbr]]) => add(id, name, abbr));
  return rosterIndex;
}
const extraPlayers = {}; // NBA-listed starters we have no numbers for (rookies, call-ups)
const blankPlayer = (name, pos, abbr) => ({ name, pos, team: abbr, starts: 0, games: 0, shot_early: 0, first_shot: 0, first_pts: 0, jumps: 0, tips_won: 0 });
function player(id) {
  const p = block().players[id];
  if (p) return p;
  if (extraPlayers[id]) return extraPlayers[id];
  const r = (FB.roster || {})[id];
  return r ? blankPlayer(r[0], r[2], r[1]) : blankPlayer(String(id), "F", "");
}
const faceUrl = (id) => (String(id).startsWith("nba:") ? `https://cdn.nba.com/headshots/nba/latest/260x190/${String(id).slice(4)}.png` : headshot(id));
function nbaTeam(g, abbr) {
  const day = LINEUPS[g.date];
  if (!day) return null;
  const espn = (t) => NBA_ABBR[t.teamAbbreviation] || t.teamAbbreviation;
  const match = (day.games || []).find((x) => espn(x.awayTeam) === g.away && espn(x.homeTeam) === g.home);
  if (!match) return null;
  return abbr === g.home ? match.homeTeam : match.awayTeam;
}
const POS_GROUP = { PG: "G", SG: "G", G: "G", SF: "F", PF: "F", F: "F", C: "C" };
// One side of the game: {starters, jumper, source: confirmed | expected | guess, fetched, live}.
function sideFor(g, abbr, built) {
  const t = nbaTeam(g, abbr);
  const listed = t ? (t.players || []).filter((x) => x.rosterStatus !== "Inactive" && ["Confirmed", "Expected"].includes(x.lineupStatus)).slice(0, 5) : [];
  if (listed.length < 5) return { ...built, source: "guess" };
  const ids = rosterIds()[abbr] || {};
  const starters = listed.map((x) => {
    const id = ids[nameKey(x.playerName)];
    if (id) return id;
    const nid = `nba:${x.personId}`;
    extraPlayers[nid] = blankPlayer(x.playerName, POS_GROUP[x.position] || "F", abbr);
    return nid;
  });
  const minJumps = (FB.fair_weights || {}).min_jumps || 2;
  const jumpers = starters.filter((id) => player(id).jumps >= minJumps).sort((a, b) => player(b).jumps - player(a).jumps);
  const center = listed.findIndex((x) => x.position === "C");
  const jumper = jumpers[0] || (center >= 0 ? starters[center] : null);
  const confirmed = listed.every((x) => x.lineupStatus === "Confirmed");
  return { starters, jumper, source: confirmed ? "confirmed" : "expected", fetched: LINEUPS[g.date].fetched, live: LINEUPS[g.date].live };
}
async function loadLineups(date) {
  if (!date) return;
  try {
    const res = await fetch(`/api/nba-lineups?date=${date.replace(/-/g, "")}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.games)) throw new Error("no games");
    LINEUPS[date] = { fetched: data.fetched, games: data.games, live: true };
  } catch (e) {
    // The build's copy, if it has one for that night.
    if (!(LINEUPS[date] && LINEUPS[date].live) && (FB.lineups || {})[date]) LINEUPS[date] = { ...FB.lineups[date], live: false };
  }
}

// The same guess as first_basket.py fair_prices, redone here so a real
// lineup moves it. tests/test_nba_first_basket.py pins the two to agree.
function fairPrices(away, home) {
  const w = FB.fair_weights || { tip_prior: 6, share_prior: 10, bench_share: 0.04 };
  const tipRate = (id) => {
    const p = id ? player(id) : null;
    return p ? (p.tips_won + w.tip_prior * 0.5) / (p.jumps + w.tip_prior) : 0.5;
  };
  const a = tipRate(away.jumper);
  const h = tipRate(home.jumper);
  const tipHome = (h * (1 - a)) / (h * (1 - a) + a * (1 - h));
  const lead = block().league.first_won_tip || 0.66;
  const firstHome = tipHome * lead + (1 - tipHome) * (1 - lead);
  const out = { tip_home: tipHome, first_home: firstHome, players: {} };
  [[away, 1 - firstHome], [home, firstHome]].forEach(([side, pTeam]) => {
    const rows = side.starters.map(player);
    if (!rows.length) return;
    const avg = rows.reduce((t, r) => t + r.first_pts, 0) / Math.max(1, rows.reduce((t, r) => t + r.starts, 0));
    const weights = rows.map((r) => (r.first_pts + w.share_prior * avg) / (r.starts + w.share_prior));
    const total = weights.reduce((t, x) => t + x, 0) || 1;
    side.starters.forEach((id, i) => {
      const pr = (pTeam * (1 - w.bench_share) * weights[i]) / total;
      out.players[id] = { p: pr, fair: american(pr) };
    });
  });
  return out;
}
function american(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
const LINEUP_TAG = {
  confirmed: ["Confirmed", "fb-lineup-confirmed", "The team has turned in this starting five (NBA)."],
  expected: ["Expected", "fb-lineup-expected", "The NBA's expected starting five; it turns Confirmed about 30 minutes before tip."],
  guess: ["Our guess", "fb-lineup-guess", "No NBA lineup yet: the five who started most when they played, leaving out anyone listed Out."],
};
const lineupTag = (side) => `<span class="fb-lineup ${LINEUP_TAG[side.source][1]}" title="${LINEUP_TAG[side.source][2]}">${LINEUP_TAG[side.source][0]}</span>`;
const days = () => [...new Set(DATA.schedule.filter((g) => (FB.slates[FB.default] || {})[g.game_id]).map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && (FB.slates[FB.default] || {})[g.game_id]);

// ---- season buttons ----
function renderSeasons() {
  const thisSeason = String(DATA.season);
  el("fb-seasons").innerHTML = Object.keys(FB.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${FB.seasons[s].label}</button>`)
    .join("") + (FB.seasons[thisSeason] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  const b = block();
  const cur = FB.seasons[thisSeason];
  el("fb-season-note").textContent = season === thisSeason
    ? `${b.label}: ${b.games} games so far, so small samples swing.`
    : `${b.label} numbers (${b.games} games), with players on their current teams.${cur ? ` ${cur.label} has ${cur.games} games so far.` : ` ${DATA.season_label} numbers start after the first games.`}`;
}
function setSeason(s, remember) {
  if (!FB.seasons[s]) return;
  season = s;
  if (!remember) return;
  // Kept only while the build's default stays the same, so the page still
  // moves to this season on its own once it takes over.
  try {
    localStorage.setItem(FB_SEASON_KEY, JSON.stringify({ season: s, default: FB.default }));
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
}

// ---- schedule ----
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

// ---- sections ----
const tile = (label, value, style = "", sub = "") => `<div class="nba-tile fb-tile"${style}><div class="gs-tile-label">${label}</div><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
const where = (g, abbr) => (abbr === g.home ? "home" : "away");

function renderTip(g, p) {
  const b = block();
  const side = (abbr) => {
    const jid = p[where(g, abbr)].jumper;
    const j = jid ? player(jid) : null;
    const t = b.teams[abbr] || {};
    const spot = where(g, abbr);
    const rate = j && j.jumps ? j.tips_won / j.jumps : null;
    const [lo, hi] = range(Object.values(b.players).filter((x) => x.jumps >= 10).map((x) => x.tips_won / x.jumps));
    return `<div class="nba-box fb-jumper">
      ${banner(abbr)}
      ${j ? `<div class="fb-jumper-who">${face(jid, "fb-face")}<div><b>${j.name}</b><span class="muted-label">${j.pos} &middot; jumper</span></div></div>` : `<p class="no-data-note">No regular jumper on file.</p>`}
      <div class="fb-tiles">
        ${tile("Tips won", j && j.jumps ? pct(rate) : "--", heat(rate, lo, hi), j ? `${j.tips_won} of ${j.jumps}` : "")}
        ${tile(`Team tip % ${spot}`, pct(t[`tip_${spot}`]), teamHeat(`tip_${spot}`, t[`tip_${spot}`]), `${t[`tip_${spot}_n`] || 0} games`)}
      </div>
    </div>`;
  };
  const home = p.fair.tip_home;
  const bar = home === null || home === undefined ? "" : `<div class="fb-split">
      <div class="gs-tile-label">Wins the tip</div>
      <div class="fb-split-bar">
        <span style="flex:${1 - home};background:rgba(${teamRgb(g.away)},0.85)">${logo(g.away, 20)} ${pct(1 - home)}</span>
        <span style="flex:${home};background:rgba(${teamRgb(g.home)},0.85)">${pct(home)} ${logo(g.home, 20)}</span>
      </div>
    </div>`;
  el("fb-tip").innerHTML = `<div class="fb-tip-row">${side(g.away)}${bar}${side(g.home)}</div>`;
}

function renderFirst(g) {
  const b = block();
  const lg = b.league;
  const box = (abbr) => {
    const t = b.teams[abbr];
    if (!t) return `<div class="nba-box">${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
    const spot = where(g, abbr);
    return `<div class="nba-box">${banner(abbr)}
      <div class="fb-tiles fb-tiles-4">
        ${tile(`Scored first ${spot}`, pct(t[`first_${spot}`]), teamHeat(`first_${spot}`, t[`first_${spot}`]), `${t[`first_${spot}_n`]} games &middot; all ${pct(t.first)}`)}
        ${tile("After winning tip", pct(t.first_won_tip), teamHeat("first_won_tip", t.first_won_tip), `Lg ${pct(lg.first_won_tip)} &middot; ${t.first_won_tip_n} games`)}
        ${tile("After losing tip", pct(t.first_lost_tip), teamHeat("first_lost_tip", t.first_lost_tip), `Lg ${pct(1 - lg.first_won_tip)} &middot; ${t.first_lost_tip_n} games`)}
        ${tile("Q1 margin", signed(t.q1_margin), teamHeat("q1_margin", t.q1_margin), "Lg 0")}
      </div>
    </div>`;
  };
  el("fb-first").innerHTML = box(g.away) + box(g.home);
}

function renderTrips(g) {
  const b = block();
  const lg = b.league;
  const table = (off, def) => {
    const o = b.teams[off] || {};
    const d = b.teams[def] || {};
    const row = (label, oKey, dKey, digits, lgValue) => `<tr><td>${label}</td>
      <td class="num fb-cell"${teamHeat(oKey, o[oKey], true)}>${fmt(o[oKey], digits)}</td>
      <td class="num fb-cell"${teamHeat(dKey, d[dKey])}>${fmt(d[dKey], digits)}</td>
      <td class="num muted-label">${fmt(lgValue, digits)}</td></tr>`;
    return `<div class="nba-box">
      <div class="nba-box-title">${logo(off, 20)} ${off} offense <span class="at">vs</span> ${logo(def, 20)} ${def} defense</div>
      <table class="data-table fb-table"><thead><tr><th></th><th>${off}</th><th>${def} allows</th><th>Lg</th></tr></thead><tbody>
        ${row("Possessions to first points", "poss", "opp_poss", 2, lg.poss)}
        ${row("Seconds to first points", "secs", "opp_secs", 0, lg.secs)}
      </tbody></table>
    </div>`;
  };
  el("fb-trips").innerHTML = table(g.away, g.home) + table(g.home, g.away);
}

function renderPositions(g) {
  const b = block();
  const lg = b.league.fg_allowed;
  const names = { G: "Guards", F: "Forwards", C: "Centers" };
  const box = (def, off) => {
    const t = b.teams[def];
    if (!t) return `<div class="nba-box">${banner(def)}<p class="no-data-note">No games on file.</p></div>`;
    return `<div class="nba-box">${banner(def, `allows &middot; ${logo(off, 18)} ${off} shoots`)}
      <div class="fb-tiles fb-tiles-3">
        ${["G", "F", "C"].map((pos) => tile(names[pos], pct(t.fg_allowed[pos]), teamHeat((x) => x.fg_allowed[pos], t.fg_allowed[pos]), `Lg ${pct(lg[pos])}`)).join("")}
      </div>
    </div>`;
  };
  // Each offense's view: the defense it faces.
  el("fb-pos").innerHTML = box(g.home, g.away) + box(g.away, g.home);
}

function renderStarters(g, p) {
  const out = (abbr) => new Set((DATA.injuries[abbr] || []).filter((x) => x.status === "Out").map((x) => x.id));
  const box = (abbr) => {
    const side = p[where(g, abbr)];
    const injured = out(abbr);
    const rows = side.starters.map((id) => {
      const pl = player(id);
      const rate = (n) => (pl.starts ? n / pl.starts : null);
      // Too few starts to color fairly (a rookie's 4): plain numbers.
      const cell = (key) => `<td class="num fb-cell"${pl.starts >= MIN_STARTS ? playerHeat(key, rate(pl[key])) : ""}><b>${pct(rate(pl[key]))}</b><small>${pl[key]}</small></td>`;
      return `<tr${injured.has(id) ? ' class="nba-out-row"' : ""}>
        <td><span class="nba-player">${face(id)}<span>${pl.name}</span><span class="muted-label">${pl.pos}</span>${id === side.jumper ? `<span class="fb-tag">Jumper</span>` : ""}${pl.starts ? "" : `<span class="nba-new" title="No starts on file in this season's view">new</span>`}</span></td>
        <td class="num">${pl.starts}</td>${cell("shot_early")}${cell("first_shot")}${cell("first_pts")}
      </tr>`;
    }).join("");
    return `<div class="nba-box">${banner(abbr, lineupTag(side))}
      <table class="data-table fb-table fb-starters"><thead><tr><th>Player</th><th>Starts</th><th title="Starts where he shot before anyone scored">Shot early</th><th title="Took the game's first shot">1st shot</th><th title="Scored the game's first points">Scored 1st</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="no-data-note">No starters on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("fb-starters").innerHTML = box(g.away) + box(g.home);
}

function renderFair(g, p) {
  const f = p.fair;
  const firstHome = f.first_home;
  const chips = (abbr) => p[where(g, abbr)].starters
    .filter((id) => f.players[id])
    .sort((x, y) => f.players[y].p - f.players[x].p)
    .map((id) => `<div class="fb-chip">${face(id)}<span>${player(id).name}</span><b>${showOdds(f.players[id].fair)}</b><small>${fmt(f.players[id].p * 100)}%</small></div>`)
    .join("");
  el("fb-fair").innerHTML = `<div class="nba-two">
      ${[g.away, g.home].map((abbr) => {
        const first = abbr === g.home ? firstHome : 1 - firstHome;
        return `<div class="nba-box">${banner(abbr, `scores first ${pct(first)}`)}<div class="fb-chips">${chips(abbr)}</div></div>`;
      }).join("")}
    </div>`;
}

function render() {
  renderSchedule();
  renderSeasons();
  const g = game();
  const p = plan();
  el("empty-state").hidden = !!(g && p);
  el("fb-game").hidden = !(g && p);
  if (!g || !p) {
    el("game-header").hidden = true;
    el("empty-state").innerHTML = "<p>No upcoming games on file.</p>";
    return;
  }
  renderHeader(g);
  renderTip(g, p);
  renderFirst(g);
  renderTrips(g);
  renderPositions(g);
  renderStarters(g, p);
  renderFair(g, p);
  renderLineupNote(p);
}
function renderLineupNote(p) {
  const real = [p.away, p.home].find((x) => x.source !== "guess");
  const at = real && real.fetched ? new Date(real.fetched).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
  el("fb-lineup-note").textContent = real
    ? `Starting fives from the NBA${at ? `, checked ${at}` : ""}${real.live ? "; the page checks again every minute." : " (as of the last site update)."}`
    : "No NBA lineup for this game yet, so these are our likely starters. The NBA's expected fives usually post the morning of the game.";
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(FB_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  const first = gamesOn(all[dayIndex])[0];
  selectGame(first ? first.game_id : null);
  loadLineups(all[dayIndex]).then(render);
}
// Every minute while the page is open on a night that hasn't finished.
setInterval(() => {
  if (!FB || document.hidden) return;
  const date = days()[dayIndex];
  if (!date || gamesOn(date).every((g) => g.status === "final")) return;
  loadLineups(date).then(render);
}, LINEUP_POLL_MS);

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) return selectGame(card.dataset.game);
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const s = e.target.closest("#fb-seasons [data-season]");
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
    FB = data.first_basket;
    if (!FB || !Object.keys(FB.seasons || {}).length) {
      el("empty-state").innerHTML = "<p>First Basket data isn't available right now.</p>";
      return;
    }
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(FB_SEASON_KEY) || "null");
    } catch (e) {
      // localStorage unavailable or bad JSON.
    }
    setSeason(pick && pick.default === FB.default && FB.seasons[pick.season] ? pick.season : FB.default, false);
    if (!season) setSeason(Object.keys(FB.seasons)[0], false);
    let saved = null;
    try {
      saved = localStorage.getItem(FB_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    const all = days();
    const savedGame = DATA.schedule.find((g) => g.game_id === saved && (FB.slates[FB.default] || {})[g.game_id]);
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    if ((FB.lineups || {})[all[dayIndex]]) LINEUPS[all[dayIndex]] = { ...FB.lineups[all[dayIndex]], live: false };
    render();
    loadLineups(all[dayIndex]).then(render);
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
