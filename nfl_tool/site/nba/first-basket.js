// ---- GMG NBA Suite: First Basket ----
// The pieces behind a game's first points, laid out for the member to put
// together (the owner, 2026-10-20: "the pieces of the puzzle with data for
// users to solve"): the tip, scoring first, opening trips, the first field
// goal each defense allows by position, and the likely starters with every
// book's price. Research only since 2026-11-03 (the owner: "scrap the tracking",
// the Fair, the Scores First %, the tip Prediction and the Value box), so no
// model number is on the page. Everything comes from nba/data.json `first_basket`
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
// Every starter is colored from his first start (the owner, 2026-10-23: "the color coding is not
// showing": at 15 starts nobody qualified this early); the "x of y" under each says how many.
const MIN_STARTS = 1;
const MIN_JUMPS_HEAT = 1; // jumpers colored against each other
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
// A game's start in the member's time zone ("7:00 PM CT"; abbr = false: "7:00 PM"). sync.js gmgGameTime.
function fmtTime(g, abbr = true) {
  return gmgGameTime(g, abbr);
}

// Colors: distance from the league average, measured in the league's own
// spread (standard deviations), red (0) to green (120) through the member's
// color set (sync.js). Average is yellow; full color at FULL_COLOR_SD either
// side, smooth between. Chosen 2026-10-20 over worst-to-best (one outlier,
// Wembanyama's 91% tips, washed everyone else out) and league rank (near-ties
// in a noisy 50/50 market looked a full color apart). The scale tightens as
// the league bunches up over a season, so the mix of colors stays about the same.
const FULL_COLOR_SD = 1.5;
function zHeat(value, values, flip) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (value === null || value === undefined || v.length < 3) return "";
  const mean = v.reduce((t, x) => t + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((t, x) => t + (x - mean) ** 2, 0) / v.length);
  if (!sd) return "";
  let z = Math.max(-1, Math.min(1, (value - mean) / sd / FULL_COLOR_SD));
  if (flip) z = -z;
  return ` style="background:${scaleHsla(Math.round((z + 1) * 60), 70, 45, 0.3)}"`;
}
// A team number's color against every team's same number.
function teamHeat(key, value, flip) {
  return zHeat(value, Object.values(block().teams).map((t) => (typeof key === "function" ? key(t) : t[key])), flip);
}
// A starter's rate against every regular starter's.
function playerHeat(key, value) {
  return zHeat(value, Object.values(block().players).filter((p) => p.starts >= MIN_STARTS).map((p) => p[key] / p.starts));
}
// A jumper's tips won against every regular jumper's.
function jumperHeat(value) {
  return zHeat(value, Object.values(block().players).filter((x) => x.jumps >= MIN_JUMPS_HEAT).map((x) => x.tips_won / x.jumps));
}

const block = () => FB.seasons[season];
const slate = () => FB.slates[season] || {};
const game = () => DATA.schedule.find((g) => g.game_id === gameId) || null;
// The game's two sides (real lineup when the NBA has one, else the build's
// likely starters).
function plan() {
  const g = game();
  const built = slate()[gameId];
  if (!g || !built) return null;
  const away = sideFor(g, g.away, built.away);
  const home = sideFor(g, g.home, built.home);
  return { away, home };
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
const blankPlayer = (name, pos, abbr) => ({ name, pos, team: abbr, starts: 0, games: 0, shot_early: 0, first_shot: 0, first_pts: 0, team_first_shot: 0, team_first_pts: 0, jumps: 0, tips_won: 0 });
function player(id) {
  const p = block().players[id];
  if (p) return p;
  if (extraPlayers[id]) return extraPlayers[id];
  const r = (FB.roster || {})[id];
  return r ? blankPlayer(r[0], r[2], r[1]) : blankPlayer(String(id), "SF", "");
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
const POS_GROUP = { PG: "PG", SG: "SG", SF: "SF", PF: "PF", C: "C", G: "SG", F: "SF" };
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
    extraPlayers[nid] = blankPlayer(x.playerName, POS_GROUP[x.position] || "SF", abbr);
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

const feetInches = (h) => (h ? `${Math.floor(h / 12)}'${h % 12}"` : "");

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
        <span class="matchup-date">${fmtTime(g, false)}</span>
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
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g)}${g.tv ? ` &middot; ${g.tv}` : ""}</div>`;
}

// ---- sections ----
const where = (g, abbr) => (abbr === g.home ? "home" : "away");
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const POS_NAMES = { PG: "Point Guards", SG: "Shooting Guards", SF: "Small Forwards", PF: "Power Forwards", C: "Centers" };
const lastName = (name) => String(name || "").split(" ").slice(1).join(" ") || name;

// The matchup table: one row per number, the road team's value on the left,
// the home team's on the right, the stat in the middle with an edge pill
// pointing at the better side. Kept to the bare numbers (the owner,
// 2026-10-20: "Simple. KISS"): no game counts, league averages or guesses.
// Each value is colored against the league from its own team's side: green =
// good for that team. better: which way is good; edge: how far apart before
// it's called an edge.
function matchupRows(g, p) {
  const b = block();
  const t = (abbr) => b.teams[abbr] || {};
  const spot = (abbr) => where(g, abbr);
  const jumperOf = (abbr) => {
    const id = p[spot(abbr)].jumper;
    return id ? player(id) : null;
  };
  const tipRecord = (abbr) => {
    const id = p[spot(abbr)].jumper;
    const rec = id && ((FB.tip || {}).record || {})[id];
    const h = id && ((FB.tip || {}).heights || {})[id];
    return `${rec ? `This season: won ${rec[0]} of ${rec[1]} opening tips` : "No opening tips yet this season"}${h ? `, ${feetInches(h)}` : ""}`;
  };
  return [
    { label: "Jumper", jumper: true },
    {
      label: "Tips Won", better: "high", edge: 0.05, show: pct,
      value: (abbr) => { const j = jumperOf(abbr); return j && j.jumps ? j.tips_won / j.jumps : null; },
      color: (abbr, v) => jumperHeat(v), title: tipRecord,
    },
    { group: "Scores First" },
    { label: "Scores First", better: "high", edge: 0.05, show: pct, value: (abbr) => t(abbr).first, color: (abbr, v) => teamHeat("first", v) },
    {
      label: "Home/Road", better: "high", edge: 0.05, show: pct,
      value: (abbr) => t(abbr)[`first_${spot(abbr)}`], color: (abbr, v) => teamHeat(`first_${spot(abbr)}`, v),
    },
    { label: "After Winning Tip", better: "high", edge: 0.05, show: pct, value: (abbr) => t(abbr).first_won_tip, color: (abbr, v) => teamHeat("first_won_tip", v) },
    { label: "After Losing Tip", better: "high", edge: 0.05, show: pct, value: (abbr) => t(abbr).first_lost_tip, color: (abbr, v) => teamHeat("first_lost_tip", v) },
    { group: "Opening Trips" },
    { label: "Avg Poss. To Score", better: "low", edge: 0.1, show: (v) => fmt(v, 2), value: (abbr) => t(abbr).poss, color: (abbr, v) => teamHeat("poss", v, true) },
    { label: "Avg Poss. To Allow", better: "high", edge: 0.1, show: (v) => fmt(v, 2), value: (abbr) => t(abbr).opp_poss, color: (abbr, v) => teamHeat("opp_poss", v) },
    { group: "First FG Allowed" },
    ...POSITIONS.map((pos) => ({
      label: POS_NAMES[pos], show: pct,
      value: (abbr) => (t(abbr).fg_allowed || {})[pos],
      color: (abbr, v) => teamHeat((x) => (x.fg_allowed || {})[pos], v, true),
    })),
  ];
}

function renderMatchup(g, p) {
  const cellFor = (row, abbr) => {
    if (row.jumper) {
      const id = p[where(g, abbr)].jumper;
      const h = ((FB.tip || {}).heights || {})[id];
      // the name gives way (ellipsis), never the height (the owner: long names hid it)
      return `<td class="fb-m-val fb-m-jumper">${id ? `<div class="fb-jumper-in">${face(id)}<span title="${player(id).name}">${lastName(player(id).name)}</span>${h ? `<small>${feetInches(h)}</small>` : ""}</div>` : `<span class="muted-label">None</span>`}</td>`;
    }
    const v = row.value(abbr);
    const title = row.title ? ` title="${row.title(abbr).replace(/"/g, "&quot;")}"` : "";
    return `<td class="fb-m-val"${v === null || v === undefined ? "" : row.color(abbr, v)}${title}><b>${row.show(v)}</b></td>`;
  };
  const edgeFor = (row) => {
    if (!row.better) return "";
    const a = row.value(g.away);
    const h = row.value(g.home);
    if (a === null || a === undefined || h === null || h === undefined || Math.abs(a - h) < row.edge) return "";
    const homeBetter = row.better === "high" ? h > a : h < a;
    const abbr = homeBetter ? g.home : g.away;
    return `<span class="fb-edge${homeBetter ? " fb-edge-home" : ""}" title="Edge: ${abbr}">${homeBetter ? "" : "&#9664;"}${logo(abbr, 14)}${homeBetter ? "&#9654;" : ""}</span>`;
  };
  const body = matchupRows(g, p).map((row) => {
    if (row.group) return `<tr class="fb-m-group"><td></td><td>${row.group}</td><td></td></tr>`;
    return `<tr>${cellFor(row, g.away)}<td class="fb-m-mid"><span class="fb-m-label">${row.label}</span>${edgeFor(row)}</td>${cellFor(row, g.home)}</tr>`;
  }).join("");
  const head = (abbr) => `<th class="fb-m-team" style="background:rgba(${teamRgb(abbr)},0.22);border-bottom:3px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span>${abbr}</span></th>`;
  // The Tip's name sits between the team banners, so the jumpers sit right
  // under them (the owner, 2026-10-21: an empty row there read as dead space).
  el("fb-matchup").innerHTML = `<table class="fb-matchup"><thead><tr>${head(g.away)}<th class="fb-m-mid fb-m-first">The Tip</th>${head(g.home)}</tr></thead><tbody>${body}</tbody></table>`;
}


// The best First Basket price across the member's books (SmartStake, the
// owner, 2026-10-21: "relabel NOVIG to BEST"): {odds, book}, else Novig's
// own price (book "novig"), else null.
// The team a starter plays for tonight (the drawn plan: render() keeps it).
let shownPlan = null;
const sideTeam = (g, id) => (shownPlan && shownPlan.home.starters.includes(id) ? g.home : g.away);
function bestPrice(g, id) {
  const best = bookBest(bookQuotes(bookSpec(g, id)), "o", null);
  if (best) return { odds: best[3], book: best[0] };
  const nv = novigPrice(g, id);
  return nv === null ? null : { odds: nv, book: "novig" };
}
const bestOdds = (g, id) => (bestPrice(g, id) || {}).odds ?? null;
// The play a price saves to My Plays (sync.js loadNbaPlays; graded there from
// first_basket.results).
function playEntry(g, id) {
  const abbr = sideTeam(g, id);
  return {
    id: `nba:fb:${g.game_id}:${id}`, sport: "nba", market: "first_basket", category: "First Basket",
    date: g.date, game_id: g.game_id, matchup: `${g.away} @ ${g.home}`, team: abbr, player_id: String(id),
    description: `${player(id).name} first basket`, logo: team(abbr).logo, color: `#${team(abbr).color || "555555"}`,
  };
}
// The every-book window for one starter (book-odds.js): a yes-only market;
// a book's price saves the play.
function bookSpec(g, id) {
  const abbr = sideTeam(g, id);
  return {
    kind: "prop", stat: "first_basket", team: abbr, game: `${g.away}_${g.home}`, pid: String(id), side: "o", line: null,
    oneSide: true, noLine: true, title: `${player(id).name} First Basket`, sub: `${g.away} @ ${g.home}`,
    color: `#${team(abbr).color || "555555"}`, save: playEntry(g, id),
  };
}
const savedPlay = (entry) => (typeof loadNbaPlays === "function" ? loadNbaPlays().find((x) => x.id === entry.id) || null : null);
window.bookPlaySaver = {
  saved: savedPlay,
  toggle(entry, book, odds) {
    const now = savedPlay(entry);
    const rest = loadNbaPlays().filter((x) => x.id !== entry.id);
    saveNbaPlays(now && now.book === book && Number(now.odds) === odds ? rest : [...rest, { ...entry, book, odds, added_at: new Date().toISOString() }]);
    render();
  },
};
function bestCell(g, id) {
  const pill = bookPricePill(bookSpec(g, id));
  const saved = savedPlay(playEntry(g, id)) ? `<span class="fb-saved" title="In My Plays">&#10003;</span>` : "";
  if (pill) return `<td class="num fb-best">${pill}${saved}</td>`;
  const nv = novigPrice(g, id);
  return `<td class="num fb-best">${nv === null ? "--" : `<span class="fb-best-plain" title="Novig's price; no other book lists him yet">${showOdds(nv)} <small>Novig</small></span>`}${saved}</td>`;
}

// Novig's First Basket "Yes" price for a player, matched by name.
function novigPrice(g, id) {
  const prices = g.first_basket || {};
  const want = nameKey(player(id).name);
  const name = Object.keys(prices).find((n) => nameKey(n) === want);
  return name === undefined ? null : prices[name];
}

function renderStarters(g, p) {
  const out = (abbr) => new Set((DATA.injuries[abbr] || []).filter((x) => x.status === "Out").map((x) => x.id));
  const box = (abbr) => {
    const side = p[where(g, abbr)];
    const injured = out(abbr);
    // Position order, PG to C (no model order since 2026-11-03).
    const order = (id) => { const i = POSITIONS.indexOf(POS_GROUP[player(id).pos] || player(id).pos); return i < 0 ? POSITIONS.length : i; };
    const ids = side.starters.slice().sort((x, y) => order(x) - order(y));
    const rows = ids.map((id) => {
      const pl = player(id);
      const rate = (n) => (pl.starts ? n / pl.starts : null);
      // Too few starts to color fairly (a rookie's 4): plain numbers.
      const cell = (key) => `<td class="num fb-cell"${pl.starts >= MIN_STARTS ? playerHeat(key, rate(pl[key])) : ""}><b>${pct(rate(pl[key]))}</b><small>${pl[key]} of ${pl.starts}</small></td>`;
      // Team Share (the owner, 2026-10-21): how often he took HIS TEAM's first
      // shot and scored its first points, whoever scored first in the game.
      // Its own thin box (fb-sh-l / fb-sh-r draw it), between Scored 1st and Best.
      const share = (key, side) => `<td class="num fb-cell fb-sh-${side}"${pl.starts >= MIN_STARTS ? playerHeat(key, rate(pl[key] || 0)) : ""}><b>${pct(rate(pl[key] || 0))}</b><small>${pl[key] || 0} of ${pl.starts}</small></td>`;
      return `<tr${injured.has(id) ? ' class="nba-out-row"' : ""}>
        <td class="fb-name"><span class="nba-player" title="${pl.name}">${playerClick(id, `${face(id)}<span>${pl.name}</span>`)}<span class="muted-label">${pl.pos}</span></span></td>
        ${cell("shot_early")}${cell("first_shot")}${cell("first_pts")}${share("team_first_shot", "l")}${share("team_first_pts", "r")}
        ${bestCell(g, id)}
      </tr>`;
    }).join("");
    return `<div class="nba-box fb-starters-box">${banner(abbr, lineupTag(side))}
      <table class="data-table fb-table fb-starters"><thead><tr><th rowspan="2" class="fb-name">Player</th><th rowspan="2" title="Starts where he shot before anyone scored">Shot Early</th><th rowspan="2" title="Took the game's first shot">1st Shot</th><th rowspan="2" title="Scored the game's first points">Scored 1st</th><th colspan="2" class="fb-share-head" title="His share of his own team's firsts, over his starts">Team Share</th><th rowspan="2" title="The best First Basket price across your books; click for every book and to save a play">Best</th></tr>
        <tr><th class="fb-sh-l" title="Took his team's first shot">1st Shot</th><th class="fb-sh-r" title="Scored his team's first points">1st Pts</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="no-data-note">No starters on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("fb-starters").innerHTML = box(g.away) + box(g.home);
}

function render() {
  renderSchedule();
  renderSeasons();
  const g = game();
  const p = plan();
  shownPlan = p;
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
  const at = real && real.fetched ? gmgClock(real.fetched) : "";
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
