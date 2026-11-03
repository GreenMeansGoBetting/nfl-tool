// ---- GMG NBA Suite: Dunk Digest ----
// The owner's daily video card (owner only, 2026-11-02): five games a card at
// the Summary card size, a row a team. Line (favorite = spread, underdog =
// total), Pace rank, a cell a prop market with the team's likely starters
// whose position has a good (green) or tough (red) matchup tonight, the First
// Basket numbers, and plain-fact notes. Just data: no leans, no picks.
// Reads nba/data.json (schedule, lines, league_chart, first_basket, identity
// spots, injuries) and props.json (this season's game logs, positions). The
// notes' stat facts are the League Stats Chart's Matchup Keys (keys.js), the
// one place those rules live.

let DATA = null;
let PROPS = null; // props.json, shared with the player card (nba-card.js)
let dayIndex = 0;

const DD_PER_CARD = 5;
const DD_POSITIONS = ["PG", "SG", "SF", "PF", "C"];
// [stat, header, log field]
const DD_STATS = [["pts", "Points", "pts"], ["fg3m", "Threes", "fg3m"], ["reb", "Rebounds", "reb"], ["ast", "Assists", "ast"]];
const DD_SHRINK_GAMES = 10; // a defense's position numbers start as 10 games of an average one (kotc.py SHRINK_GAMES)
const DD_PLAYER_PRIOR_MIN = 100; // a player's own rate starts as 100 minutes at his position's average
const DD_ROTATION_MIN = 100; // players with this many minutes set the spread of player rates
const DD_CALL = 1; // league spreads: the defense clearly pointing one way (a full spread: 0.6 lit half of every cell)
const DD_AGAINST = 0.3; // ...and the player not pointing back this far
const DD_SHOWN = 2; // positions a cell shows; the rest fold into a "+N" pill (hover lists them)
const DD_OUT_MIN = 25; // an Out starter (minutes a game) gets a note
const DD_OUTS_SHOWN = 2; // Out tags a team; the rest fold into "+N"
const DD_KEYS = 2; // Matchup Keys a game in the notes
const DD_KEY_PARTS = 2; // ranks a key shows (its strongest two)
// Schedule spots worth a note, most specific first; one tiredness spot a team.
const DD_TIRED = ["b2b", "three_in_four", "four_in_six"];
const DD_SPOTS = ["rest_edge", "layoff"];
// Short names for the card (the full ones are in the hover).
const DD_SPOT_SHORT = { b2b: "2nd Night Of B2B", three_in_four: "3 In 4 Nights", four_in_six: "4 In 6 Nights", rest_edge: "Rest Edge", layoff: "Layoff" };
const DD_SHORT = { "Shai Gilgeous-Alexander": "SGA" };

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lastName = (name) => DD_SHORT[name] || String(name || "").split(" ").slice(1).join(" ") || name || "";
const pct = (p) => `${Math.round(p * 100)}%`;
const shade = (p, hi, lo) => (p >= hi ? "dd-g" : p >= lo ? "dd-y" : "dd-r");

// ---- position spots ----
// League and defense rates a minute by position, and each player's own, from
// this season's game logs. Built once.
let SPOTS = null;
function spotModel() {
  if (SPOTS) return SPOTS;
  const season = PROPS && PROPS.seasons && PROPS.seasons[String(DATA.season)];
  const players = (season && season.players) || {};
  const F = Object.fromEntries(((season && season.fields) || []).map((f, i) => [f, i]));
  const blank = () => Object.fromEntries(DD_STATS.map(([s]) => [s, 0]));
  const league = {}, minAt = {}, def = {}, own = {};
  const teamGames = new Set();
  DD_POSITIONS.forEach((p) => { league[p] = blank(); minAt[p] = 0; });
  Object.entries(players).forEach(([id, pl]) => {
    const pos = pl.pos;
    if (!league[pos]) return;
    const mine = (own[id] = { pos, min: 0, games: 0, ...blank() });
    (pl.log || []).forEach((r) => {
      const min = r[F.min] || 0;
      if (min <= 0) return;
      teamGames.add(`${r[F.game]}:${r[F.opp]}`);
      const d = ((def[r[F.opp]] ||= {})[pos] ||= { min: 0, ...blank() });
      minAt[pos] += min;
      d.min += min;
      mine.min += min;
      mine.games += 1;
      DD_STATS.forEach(([s, , f]) => {
        const v = r[F[f]] || 0;
        league[pos][s] += v;
        d[s] += v;
        mine[s] += v;
      });
    });
  });
  const games = Math.max(1, teamGames.size);
  const rate = {}; // league a minute
  DD_POSITIONS.forEach((p) => { rate[p] = Object.fromEntries(DD_STATS.map(([s]) => [s, minAt[p] ? league[p][s] / minAt[p] : 0])); });
  const sd = (xs) => {
    if (xs.length < 2) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) || null;
  };
  // A defense's number: what it allows a minute to the position over the league's, steadied.
  const defFactor = {};
  Object.entries(def).forEach(([t, byPos]) => {
    defFactor[t] = {};
    DD_POSITIONS.forEach((p) => {
      const d = byPos[p] || { min: 0, ...blank() };
      const m0 = DD_SHRINK_GAMES * (minAt[p] / games);
      defFactor[t][p] = Object.fromEntries(DD_STATS.map(([s]) => [s, rate[p][s] ? (d[s] + rate[p][s] * m0) / (d.min + m0) / rate[p][s] - 1 : 0]));
    });
  });
  const playerFactor = (id) => {
    const o = own[id];
    if (!o) return null;
    const m1 = DD_PLAYER_PRIOR_MIN;
    return Object.fromEntries(DD_STATS.map(([s]) => [s, rate[o.pos][s] ? (o[s] + rate[o.pos][s] * m1) / (o.min + m1) / rate[o.pos][s] - 1 : 0]));
  };
  const spread = { def: {}, own: {} };
  DD_POSITIONS.forEach((p) => {
    spread.def[p] = {};
    spread.own[p] = {};
    DD_STATS.forEach(([s]) => {
      spread.def[p][s] = sd(Object.values(defFactor).map((x) => x[p][s]));
      spread.own[p][s] = sd(Object.entries(own).filter(([, o]) => o.pos === p && o.min >= DD_ROTATION_MIN).map(([id]) => playerFactor(id)[s]));
    });
  });
  SPOTS = { players, own, defFactor, playerFactor, spread };
  return SPOTS;
}
// One starter's call in one market against tonight's defense: {kind: good | tough, z: how far} or null.
function spotCall(id, opp, stat) {
  const m = spotModel();
  const o = m.own[id];
  if (!o || !m.defFactor[opp]) return null;
  const sdD = m.spread.def[o.pos][stat], sdO = m.spread.own[o.pos][stat];
  if (!sdD || !sdO) return null;
  const zd = m.defFactor[opp][o.pos][stat] / sdD;
  const zo = m.playerFactor(id)[stat] / sdO;
  if (zd >= DD_CALL && zo > -DD_AGAINST) return { kind: "good", z: zd };
  if (zd <= -DD_CALL && zo < DD_AGAINST) return { kind: "tough", z: -zd };
  return null;
}

// ---- the night ----
const FB = () => DATA.first_basket || {};
const slate = () => (FB().slates || {})[FB().default] || {};
const fbPlayer = (id) => ((FB().seasons || {})[FB().default] || { players: {} }).players[id] || null;
const days = () => [...new Set(DATA.schedule.filter((g) => slate()[g.game_id]).map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date && slate()[g.game_id]).sort((a, b) => (a.start_utc || "").localeCompare(b.start_utc || ""));

function lineFor(g, abbr) {
  const hs = g.home_team_spread;
  if (hs === null || hs === undefined) return "";
  const fav = hs <= 0 ? g.home : g.away;
  if (abbr === fav) return hs === 0 ? "PK" : `-${Math.abs(hs)}`;
  return g.total_line ?? "";
}
function paceCell(abbr) {
  const table = (DATA.league_chart || {}).season || {};
  const v = (table[abbr] || {}).pace;
  if (v === undefined || v === null) return `<div class="dd-box"></div>`;
  const vals = Object.values(table).map((r) => r.pace).filter((x) => x !== null && x !== undefined);
  const r = 1 + vals.filter((x) => x > v).length;
  const third = Math.round(vals.length / 3);
  const word = r <= third ? "Fast" : r > vals.length - third ? "Slow" : "Average";
  return `<div class="dd-pace ${word === "Fast" ? "dd-g" : word === "Slow" ? "dd-r" : "dd-y"}" title="${v} possessions a game"><b>${ordinal(r)}</b><span>${word}</span></div>`;
}
function statCell(side, opp, stat) {
  const starters = (side && side.starters) || [];
  const m = spotModel();
  const name = (id) => (m.players[id] || {}).name || "";
  // Strongest first; past DD_SHOWN the rest fold into a "+N" pill (the site's tag rule).
  const calls = starters.map((id) => [id, spotCall(id, opp, stat)]).filter(([, c]) => c).sort((a, b) => b[1].z - a[1].z);
  const shown = calls.slice(0, DD_SHOWN);
  const rest = calls.slice(DD_SHOWN);
  const chips = shown.map(([id, c]) => `<span class="dd-chip ${c.kind === "good" ? "dd-g" : "dd-r"}">${m.own[id].pos}</span>`).join("")
    + (rest.length ? `<span class="dd-chip dd-more" title="${esc(rest.map(([id, c]) => `${m.own[id].pos} ${name(id)} (${c.kind === "good" ? "good" : "tough"})`).join("\n"))}">+${rest.length}</span>` : "");
  const names = shown.map(([id, c]) => `<span class="${c.kind === "good" ? "dd-ng" : "dd-nr"}" title="${esc(name(id))}">${playerClick(id, esc(lastName(name(id))))}</span>`).join("");
  return `<div class="dd-box dd-stat"><div class="dd-chips">${chips}</div><div class="dd-names">${names}</div></div>`;
}
function fbCell(g, abbr) {
  const built = slate()[g.game_id];
  if (!built || !built.fair) return `<div class="dd-box"></div>`;
  const home = abbr === g.home;
  const side = home ? built.home : built.away;
  const first = home ? built.fair.first_home : 1 - built.fair.first_home;
  const tip = home ? built.fair.tip_home : 1 - built.fair.tip_home;
  const row = (label, value, cls, title = "") => `<div class="dd-xrow"${title ? ` title="${esc(title)}"` : ""}><span class="dd-xname">${label}</span><b class="${cls}">${value}</b></div>`;
  let html = row("Scores 1st", pct(first), shade(first, 0.55, 0.45));
  const jumper = side.jumper && fbPlayer(side.jumper);
  if (jumper) html += row(`Tip: ${playerClick(side.jumper, esc(lastName(jumper.name)))}`, pct(tip), shade(tip, 0.55, 0.45));
  const leader = (side.starters || []).map((id) => [id, fbPlayer(id)]).filter(([, p]) => p && p.starts && p.team_first_shot)
    .sort((a, b) => b[1].team_first_shot - a[1].team_first_shot || b[1].team_first_shot / b[1].starts - a[1].team_first_shot / a[1].starts)[0];
  if (leader) {
    const [id, p] = leader;
    html += row(`1st Shot: ${playerClick(id, esc(lastName(p.name)))}`, `${p.team_first_shot} of ${p.starts}`, shade(p.team_first_shot / p.starts, 0.4, 0.2), "Took his team's first shot, of his starts this season");
  }
  return `<div class="dd-box dd-fb">${html}</div>`;
}

// ---- notes: plain facts ----
// [words, kind]: count = most / fewest, rate = highest / lowest, pace = fastest / slowest.
const DD_FACT = {
  o_ppg: ["points a game", "count"], o_rtg: ["points per 100", "count"], o_3pm: ["threes made", "count"],
  o_3par: ["3-point attempt rate", "rate"], o_ftr: ["free throw rate", "rate"], o_tov: ["turnover %", "rate"],
  o_reb: ["offensive rebound %", "rate"], o_paint_share: ["paint shot share", "rate"], o_paint_pct: ["paint FG%", "rate"],
  o_mid_share: ["mid-range shot share", "rate"], o_mid_pct: ["mid-range FG%", "rate"], o_trans_freq: ["transition share", "rate"],
  o_trans_ppp: ["transition points", "count"], o_ball_move: ["ball movement", "rate"],
  d_ppg: ["points allowed", "count"], d_rtg: ["points allowed per 100", "count"], d_3pm: ["threes allowed", "count"],
  d_3par: ["opponent 3-point attempt rate", "rate"], d_ftr: ["opponent free throw rate", "rate"], d_tov: ["forced turnover %", "rate"],
  d_reb: ["defensive rebound %", "rate"], d_paint_share: ["paint shots allowed share", "rate"], d_paint_pct: ["opponent paint FG%", "rate"],
  d_mid_share: ["mid-range shots allowed share", "rate"], d_mid_pct: ["opponent mid-range FG%", "rate"],
  d_trans_freq: ["opponent transition share", "rate"], d_trans_ppp: ["transition points allowed", "count"], d_ball_move: ["opponent ball movement", "rate"],
  pace: ["pace", "pace"], total: ["average game total", "rate"],
};
const DD_WORDS = { count: ["most", "fewest"], rate: ["highest", "lowest"], pace: ["fastest", "slowest"] };
function rankWords(table, abbr, key) {
  const v = (table[abbr] || {})[key];
  const fact = DD_FACT[key];
  if (v === null || v === undefined || !fact || Array.isArray(v)) return null;
  const vals = Object.values(table).map((r) => r[key]).filter((x) => x !== null && x !== undefined);
  const top = 1 + vals.filter((x) => x > v).length;
  const bottom = 1 + vals.filter((x) => x < v).length;
  const [hi, lo] = DD_WORDS[fact[1]];
  const word = top <= bottom ? (top === 1 ? hi : `${ordinal(top)}-${hi}`) : bottom === 1 ? lo : `${ordinal(bottom)}-${lo}`;
  return `${abbr}: ${word} ${fact[0]}`;
}
function keyFacts(g) {
  const table = (DATA.league_chart || {}).season;
  if (!table || !table[g.away] || !table[g.home] || typeof nbaMatchupKeys !== "function") return [];
  return nbaMatchupKeys(table, g.away, g.home).filter((k) => k.lead).slice(0, DD_KEYS).map((k) => {
    if (k.type === "trend") return `${k.title} (over / under, both teams)`;
    const parts = [];
    k.tiles.forEach((t) => {
      const words = rankWords(table, t.team, t.key);
      if (words && !parts.includes(words)) parts.push(words);
    });
    return parts.slice(0, DD_KEY_PARTS).join("; ");
  }).filter(Boolean);
}
function tags(g) {
  const out = [];
  const idb = DATA.identity && DATA.identity.seasons && DATA.identity.seasons[DATA.identity.default];
  const spots = (idb && idb.spots) || {};
  const label = Object.fromEntries((spots.types || []).map((t) => [t.key, t.label]));
  const now = (spots.tonight || {})[g.game_id] || {};
  [g.away, g.home].forEach((abbr) => {
    const keys = now[abbr] || [];
    const tired = DD_TIRED.find((k) => keys.includes(k));
    if (tired) out.push(["dd-y", `${abbr}: ${DD_SPOT_SHORT[tired]}`, label[tired]]);
    DD_SPOTS.filter((k) => keys.includes(k)).forEach((k) => out.push(["dd-y", `${abbr}: ${DD_SPOT_SHORT[k]}`, label[k]]));
  });
  [g.away, g.home].forEach((abbr) => {
    const outs = (DATA.injuries[abbr] || []).filter((p) => p.status === "Out" && minutesAGame(p.id) >= DD_OUT_MIN)
      .sort((a, b) => minutesAGame(b.id) - minutesAGame(a.id));
    if (!outs.length) return;
    const more = outs.length - DD_OUTS_SHOWN;
    out.push(["dd-r", `${abbr} Out: ${outs.slice(0, DD_OUTS_SHOWN).map((p) => lastName(p.name)).join(", ")}${more > 0 ? ` +${more}` : ""}`, outs.map((p) => p.name).join("\n")]);
  });
  return out;
}
function minutesAGame(id) {
  const o = spotModel().own[id];
  return o && o.games ? o.min / o.games : 0;
}
function notesCell(g) {
  const t = tags(g).map(([cls, text, title]) => `<span class="dd-tag ${cls}"${title ? ` title="${esc(title)}"` : ""}>${esc(text)}</span>`).join("");
  const facts = keyFacts(g).map((f) => `<li>${esc(f)}</li>`).join("");
  return `<div class="dd-box dd-notes">${t ? `<div class="dd-tags">${t}</div>` : ""}${facts ? `<ul>${facts}</ul>` : ""}</div>`;
}

// ---- the cards ----
const DD_HEADS = ["Team", "Line", "Pace", ...DD_STATS.map((s) => s[1]), "First Basket", "Notes"];
function card(date, games, n, of) {
  let rows = DD_HEADS.map((h) => `<div class="dd-h">${h}</div>`).join("");
  games.forEach((g, i) => {
    const built = slate()[g.game_id] || {};
    [g.away, g.home].forEach((abbr, j) => {
      const side = abbr === g.home ? built.home : built.away;
      const opp = abbr === g.home ? g.away : g.home;
      rows += `<div class="dd-box dd-team" data-team="${abbr}">${team(abbr).logo ? `<img src="${team(abbr).logo}" alt="${abbr}" class="dd-logo">` : abbr}</div>`;
      rows += `<div class="dd-box dd-line">${lineFor(g, abbr)}</div>${paceCell(abbr)}`;
      rows += DD_STATS.map(([s]) => statCell(side, opp, s)).join("");
      rows += fbCell(g, abbr);
      if (!j) rows += notesCell(g);
    });
    if (i < games.length - 1) rows += `<div class="dd-gap"></div>`;
  });
  const day = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `<div class="dd-card" data-games="${games.length}">
    <div class="dd-head"><div><div class="dd-title">DUNK <span>DIGEST</span></div><div class="dd-date">${day}${of > 1 ? ` &middot; ${n} of ${of}` : ""}</div></div>
      <div class="dd-key">Each row = spots for <u>that team's</u> players vs tonight's defense<br><span class="dd-chip dd-g">SG</span> good matchup for that position &nbsp; <span class="dd-chip dd-r">C</span> tough matchup</div></div>
    <div class="dd-board" style="grid-template-rows:36px repeat(${games.length}, 1fr 1fr 12px)">${rows}</div>
    <div class="dd-foot"><span></span><span>Full breakdown at <b>nba.gmgsports.org</b></span></div>
  </div>`;
}
function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No Games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  const games = date ? gamesOn(date) : [];
  el("empty-state").hidden = games.length > 0;
  if (!games.length) el("empty-state").innerHTML = `<p class="dd-empty">No games on the slate.</p>`;
  const chunks = [];
  for (let i = 0; i < games.length; i += DD_PER_CARD) chunks.push(games.slice(i, i + DD_PER_CARD));
  el("dd-cards").innerHTML = chunks.map((c, i) => `<div class="dd-scroll">${card(date, c, i + 1, chunks.length)}</div>`).join("");
  fitNotes();
}
// A crowded notes box (both teams on a back-to-back with starters Out) steps its
// text down; past the smallest size its weakest Matchup Key goes (the rest are on
// the League Stats Chart).
const DD_NOTE_SIZES = [13.5, 12.5, 11.5];
function fitNotes() {
  document.querySelectorAll(".dd-notes").forEach((box) => {
    if (!box.clientHeight) return; // hidden until the owner check lands; fitted again then
    const over = () => box.scrollHeight > box.clientHeight + 1;
    for (const size of DD_NOTE_SIZES) {
      if (!over()) return;
      box.style.setProperty("--dd-note-size", `${size}px`);
    }
    const items = box.querySelectorAll("li");
    for (let i = items.length - 1; i > 0 && over(); i--) items[i].remove();
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#day-prev") && dayIndex > 0) { dayIndex -= 1; render(); }
  else if (e.target.closest("#day-next") && dayIndex < days().length - 1) { dayIndex += 1; render(); }
  else if (e.target.closest(".dd-bar .info-i")) {
    const b = e.target.closest(".info-i");
    const note = el(b.getAttribute("aria-controls"));
    note.hidden = !note.hidden;
    b.setAttribute("aria-expanded", String(!note.hidden));
  } else if (e.target.closest("#theme-toggle")) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("nfl-tool.theme", light ? "light" : "dark"); } catch (err) { /* private window */ }
  }
});

// The page shows once sync.js marks the owner (html.is-owner) and the fonts land: fit then.
new MutationObserver(fitNotes).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
if (document.fonts) document.fonts.ready.then(fitNotes);

Promise.all([
  fetch("data.json").then((r) => r.json()),
  fetch("props.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
]).then(([data, props]) => {
  PROPS = props;
  DATA = data;
  // Open on today (Eastern), or the next night with games.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const all = days();
  dayIndex = Math.max(0, all.findIndex((d) => d >= today));
  render();
}).catch((err) => {
  el("empty-state").innerHTML = `<p>Couldn't load the NBA data (${esc(err.message)}).</p>`;
});
