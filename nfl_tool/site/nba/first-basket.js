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
const where = (g, abbr) => (abbr === g.home ? "home" : "away");

// The matchup table: one row per number, the away team's value on the left,
// the home team's on the right, and in the middle what it is with an edge
// pill pointing at the better side (the owner, 2026-10-20: "stacked with team
// columns and the data side by side", "an edge column"). Each value is colored
// against the league from its own team's side: green = good for that team.
// better: which way is good; edge: how far apart before it's called an edge.
function matchupRows(g, p) {
  const b = block();
  const lg = b.league;
  const t = (abbr) => b.teams[abbr] || {};
  const spot = (abbr) => where(g, abbr);
  const jumperOf = (abbr) => {
    const id = p[spot(abbr)].jumper;
    return id ? { id, ...player(id) } : null;
  };
  const [jLo, jHi] = range(Object.values(b.players).filter((x) => x.jumps >= 10).map((x) => x.tips_won / x.jumps));
  const tipHome = p.fair.tip_home;
  const firstHome = p.fair.first_home;
  const side = (abbr, home, away) => (abbr === g.home ? home : away);
  const games = (n) => (n ? `${n} games` : "");
  return [
    { group: "The Tip" },
    { label: "Jumper", jumper: true },
    {
      label: "Jumper's tips won", better: "high", edge: 0.05, show: pct,
      value: (abbr) => { const j = jumperOf(abbr); return j && j.jumps ? j.tips_won / j.jumps : null; },
      sub: (abbr) => { const j = jumperOf(abbr); return j && j.jumps ? `${j.tips_won} of ${j.jumps}` : ""; },
      color: (abbr, v) => heat(v, jLo, jHi),
    },
    {
      label: "Team tips won, road / home", better: "high", edge: 0.05, show: pct,
      value: (abbr) => t(abbr)[`tip_${spot(abbr)}`], sub: (abbr) => games(t(abbr)[`tip_${spot(abbr)}_n`]),
      color: (abbr, v) => teamHeat(`tip_${spot(abbr)}`, v),
    },
    {
      label: "Wins the tip", lg: "fair guess", better: "high", edge: 0.05, show: pct, strong: true,
      value: (abbr) => side(abbr, tipHome, 1 - tipHome), color: (abbr, v) => heat(v, 0.25, 0.75),
    },
    { group: "Scoring First" },
    {
      label: "Scores first", lg: "fair guess", better: "high", edge: 0.03, show: pct, strong: true,
      value: (abbr) => side(abbr, firstHome, 1 - firstHome), color: (abbr, v) => heat(v, 0.35, 0.65),
    },
    {
      label: "Scored first, road / home", lg: "Lg 50%", better: "high", edge: 0.05, show: pct,
      value: (abbr) => t(abbr)[`first_${spot(abbr)}`], sub: (abbr) => games(t(abbr)[`first_${spot(abbr)}_n`]),
      color: (abbr, v) => teamHeat(`first_${spot(abbr)}`, v),
    },
    {
      label: "After winning the tip", lg: `Lg ${pct(lg.first_won_tip)}`, better: "high", edge: 0.05, show: pct,
      value: (abbr) => t(abbr).first_won_tip, sub: (abbr) => games(t(abbr).first_won_tip_n), color: (abbr, v) => teamHeat("first_won_tip", v),
    },
    {
      label: "After losing the tip", lg: `Lg ${pct(1 - lg.first_won_tip)}`, better: "high", edge: 0.05, show: pct,
      value: (abbr) => t(abbr).first_lost_tip, sub: (abbr) => games(t(abbr).first_lost_tip_n), color: (abbr, v) => teamHeat("first_lost_tip", v),
    },
    {
      label: "1st quarter margin", lg: "Lg 0", better: "high", edge: 1, show: signed,
      value: (abbr) => t(abbr).q1_margin, color: (abbr, v) => teamHeat("q1_margin", v),
    },
    { group: "Opening Trips" },
    {
      label: "Trips to its first points", lg: `Lg ${fmt(lg.poss, 2)}`, better: "low", edge: 0.1, show: (v) => fmt(v, 2),
      value: (abbr) => t(abbr).poss, color: (abbr, v) => teamHeat("poss", v, true),
    },
    {
      label: "Trips its D allows", lg: `Lg ${fmt(lg.poss, 2)}`, better: "high", edge: 0.1, show: (v) => fmt(v, 2),
      value: (abbr) => t(abbr).opp_poss, color: (abbr, v) => teamHeat("opp_poss", v),
    },
    {
      label: "Seconds to its first points", lg: `Lg ${fmt(lg.secs, 0)}`, better: "low", edge: 4, show: (v) => fmt(v, 0),
      value: (abbr) => t(abbr).secs, color: (abbr, v) => teamHeat("secs", v, true),
    },
    {
      label: "Seconds its D allows", lg: `Lg ${fmt(lg.secs, 0)}`, better: "high", edge: 4, show: (v) => fmt(v, 0),
      value: (abbr) => t(abbr).opp_secs, color: (abbr, v) => teamHeat("opp_secs", v),
    },
    { group: "First FG Allowed" },
    ...[["G", "Guards"], ["F", "Forwards"], ["C", "Centers"]].map(([pos, name]) => ({
      label: `${name} score it`, lg: `Lg ${pct(lg.fg_allowed[pos])}`, show: pct,
      value: (abbr) => (t(abbr).fg_allowed || {})[pos],
      color: (abbr, v) => teamHeat((x) => (x.fg_allowed || {})[pos], v, true),
    })),
  ];
}

function renderMatchup(g, p) {
  const cellFor = (row, abbr) => {
    if (row.jumper) {
      const id = p[where(g, abbr)].jumper;
      return `<td class="fb-m-val fb-m-jumper">${id ? `${face(id)}<span>${player(id).name}</span>` : `<span class="muted-label">none on file</span>`}</td>`;
    }
    const v = row.value(abbr);
    const sub = row.sub ? row.sub(abbr) : "";
    return `<td class="fb-m-val${row.strong ? " fb-m-strong" : ""}"${v === null || v === undefined ? "" : row.color(abbr, v)}><b>${row.show(v)}</b>${sub ? `<small>${sub}</small>` : ""}</td>`;
  };
  const edgeFor = (row) => {
    if (!row.better) return "";
    const a = row.value(g.away);
    const h = row.value(g.home);
    if (a === null || a === undefined || h === null || h === undefined || Math.abs(a - h) < row.edge) return "";
    const homeBetter = row.better === "high" ? h > a : h < a;
    const abbr = homeBetter ? g.home : g.away;
    return `<span class="fb-edge${homeBetter ? " fb-edge-home" : ""}" title="Edge: ${abbr}">${homeBetter ? "" : "&#9664;"}${logo(abbr, 16)}${homeBetter ? "&#9654;" : ""}</span>`;
  };
  const body = matchupRows(g, p).map((row) => {
    if (row.group) return `<tr class="fb-m-group"><td colspan="3">${row.group}</td></tr>`;
    return `<tr>${cellFor(row, g.away)}<td class="fb-m-mid"><span class="fb-m-label">${row.label}${edgeFor(row)}</span>${row.lg ? `<small>${row.lg}</small>` : ""}</td>${cellFor(row, g.home)}</tr>`;
  }).join("");
  const head = (abbr) => `<th class="fb-m-team" style="background:rgba(${teamRgb(abbr)},0.22);border-bottom:3px solid rgb(${teamRgb(abbr)})">${logo(abbr, 26)}<span>${abbr}</span><small>${where(g, abbr) === "home" ? "home" : "road"}</small></th>`;
  el("fb-matchup").innerHTML = `<table class="fb-matchup"><thead><tr>${head(g.away)}<th class="fb-m-mid">Edge</th>${head(g.home)}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderStarters(g, p) {
  const out = (abbr) => new Set((DATA.injuries[abbr] || []).filter((x) => x.status === "Out").map((x) => x.id));
  const fair = p.fair.players;
  const box = (abbr) => {
    const side = p[where(g, abbr)];
    const injured = out(abbr);
    // Best fair price first: the bottom line of the page.
    const ids = side.starters.slice().sort((x, y) => ((fair[y] || {}).p || 0) - ((fair[x] || {}).p || 0));
    const rows = ids.map((id) => {
      const pl = player(id);
      const rate = (n) => (pl.starts ? n / pl.starts : null);
      // Too few starts to color fairly (a rookie's 4): plain numbers.
      const cell = (key) => `<td class="num fb-cell"${pl.starts >= MIN_STARTS ? playerHeat(key, rate(pl[key])) : ""}><b>${pct(rate(pl[key]))}</b><small>${pl[key]} of ${pl.starts}</small></td>`;
      const f = fair[id];
      return `<tr${injured.has(id) ? ' class="nba-out-row"' : ""}>
        <td><span class="nba-player">${face(id)}<span>${pl.name}</span><span class="muted-label">${pl.pos}</span>${id === side.jumper ? `<span class="fb-tag">Jumper</span>` : ""}${pl.starts ? "" : `<span class="nba-new" title="No starts on file in this season's view">new</span>`}</span></td>
        ${cell("shot_early")}${cell("first_shot")}${cell("first_pts")}
        <td class="num fb-fair">${f ? `<b>${showOdds(f.fair)}</b><small>${fmt(f.p * 100)}%</small>` : "--"}</td>
      </tr>`;
    }).join("");
    return `<div class="nba-box">${banner(abbr, lineupTag(side))}
      <table class="data-table fb-table fb-starters"><thead><tr><th>Player</th><th title="Starts where he shot before anyone scored">Shot early</th><th title="Took the game's first shot">1st shot</th><th title="Scored the game's first points">Scored 1st</th><th title="Fair price to score first: a rough guess">Fair</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="no-data-note">No starters on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("fb-starters").innerHTML = box(g.away) + box(g.home);
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
  renderMatchup(g, p);
  renderStarters(g, p);
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
