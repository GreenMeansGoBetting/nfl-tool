// ---- GMG NBA Suite: Slate Standouts ----
// Every mismatch on a night's slate in one place, by category (the owner, 2026-11-11: "the ability
// for a user to see all the mismatches in one place and by category so they dont have to wade
// through info on top of info"). Two lists: Standouts (pointing toward more) and Tough Spots (less).
// Two kinds of rows, both reading BOTH sides (CLAUDE.md):
//   Team rows   -- Matchup Keys' own rules (keys.js nbaMatchupKeys, never a second copy): an
//                  offense Edge / Fits = a Standout for that offense; a defense Edge = a Tough Spot
//                  for the offense facing it; Same Style / Trend keys on pace and totals by direction.
//   Player rows -- Player Types' measuring stick (data.json shot_types.log): how players of HIS type
//                  did against tonight's defense compared with their own averages (leave-one-out),
//                  and in how many of those games they beat it. He must do the thing himself
//                  (SS_MIN_SELF). No pull toward the league (the owner): the sample is shown.
// Stacked = a player spot and a team spot of the same category in the same game, pointing the
// same way (shown as parts, never blended). Numbers, not picks: no projections, no record.

let DATA = null;
let ssDay = 0;
// open: the player row whose drop-down is open; byGame: Sort By Game (a display pref, kept on this device)
const SS_BYGAME_KEY = "nba-tool.ss-bygame.v1";
const ssView = { cat: "all", window: "season", open: "", dtab: "like", byGame: (() => {
  try {
    return localStorage.getItem(SS_BYGAME_KEY) === "1";
  } catch (e) {
    return false; // localStorage unavailable -- By Category
  }
})() };

const ssEl = (id) => document.getElementById(id);
const ssTeam = (abbr) => (DATA.teams || {})[abbr] || { name: abbr, color: "555555", logo: "" };
const ssRgb = (abbr) => [0, 2, 4].map((i) => parseInt((ssTeam(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
const ssEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ssDays = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const ssGames = (date) => DATA.schedule.filter((g) => g.date === date);
const ssLetter = (L) => `<span class="pt-letter" style="--h:${Math.round("ABCDEFGHIJKL".indexOf(L) * 25.45)}">${L}</span>`;

// Categories, in the order they're listed. A key's topic (keys.js) says which one it belongs to.
const SS_CATS = [
  ["points", "Points"], ["threes", "Threes"], ["inside", "Paint & Mid-Range"], ["glass", "Rebounds"],
  ["turnovers", "Turnovers"], ["ft", "Free Throws"], ["pace", "Pace & Total"],
];
const SS_TOPIC = { scoring: "points", threes: "threes", paint: "inside", mid: "inside", diet: "inside", glass: "glass",
  turnovers: "turnovers", ft: "ft", transition: "pace", pace: "pace", total: "pace", ou: "pace" };
// Same Style / Trend titles that point toward less (a Tough Spot); the rest point toward more.
const SS_LESS = ["Both Play Slow", "Both Play Low-Scoring Games", "Two Top Defenses", "Two Struggling Offenses", "Unders", "Neither Runs", "Both Protect The Ball", "Neither Crashes", "Neither Gets To The Line", "Both Avoid Threes", "Both Stay Out Of The Paint", "Both Skip The Mid-Range"];

// The player measuring stick: [field in shot_types.log, his own average index in players[].avg, the
// least he must average himself, how far over / under their average a type must run, label]
const SS_PLAYER = {
  points: ["pts_diff", 1, 12, 2.5, "Points"],
  threes: ["m3_diff", 2, 1.5, 0.7, "Threes Made"],
};
// The owner's cutoffs, 2026-11-11 (picked from a count of each option on that night's slate): +2.5 points /
// +0.7 threes over their average, beating it 55% of the time, 6+ games ("6 games is good for now").
const SS_MIN_GAMES = 6; // player-games by his type against that defense before a row can show
const SS_HIT_HI = 0.55;
const SS_HIT_LO = 0.45;
const SS_OUT = new Set(["Out", "Doubtful"]);
const SS_RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const ssStep = (share) => { // 1 = greenest .. 0 = reddest
  const [hue, fill] = SS_RANK_SCALE[Math.min(7, Math.max(0, Math.floor((1 - share) * 8)))];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
};

// ---- player rows: the type measuring stick ----
function ssLog() {
  const st = DATA.shot_types;
  const f = Object.fromEntries(st.log_fields.map((k, i) => [k, i]));
  return { st, f, rows: st.log };
}
// Each defense's games in the window (Season, or its last 10 by date).
function ssWindowDates(rows, f, before) {
  const byDef = {};
  rows.forEach((r) => {
    if (r[f.date] >= before) return;
    (byDef[r[f.def]] ||= new Set()).add(r[f.date]);
  });
  const keep = {};
  Object.entries(byDef).forEach(([d, set]) => {
    const dates = [...set].sort();
    keep[d] = new Set(ssView.window === "10" ? dates.slice(-10) : dates);
  });
  return keep;
}
// {defense: {type: {cat: {n, avg, hit}}}} from games before `before` (a past night never sees itself).
function ssStick(before) {
  const { st, f, rows } = ssLog();
  const keep = ssWindowDates(rows, f, before);
  const out = {};
  rows.forEach((r) => {
    const d = r[f.def];
    if (r[f.date] >= before || !keep[d] || !keep[d].has(r[f.date])) return;
    const p = st.players[r[f.player]];
    if (!p) return;
    Object.entries(SS_PLAYER).forEach(([cat, [field]]) => {
      const cell = (((out[d] ||= {})[p.type] ||= {})[cat] ||= { n: 0, sum: 0, over: 0, who: {} });
      const v = r[f[field]];
      cell.n += 1;
      cell.sum += v;
      if (v > 0) cell.over += 1;
      cell.who[r[f.player]] = (cell.who[r[f.player]] || 0) + 1;
    });
  });
  Object.values(out).forEach((byType) => Object.values(byType).forEach((byCat) => Object.values(byCat).forEach((c) => {
    c.avg = c.sum / c.n;
    c.hit = c.over / c.n;
  })));
  return out;
}
// His defense rank against his type, of the defenses with enough games: 30th = runs most over (red).
function ssDefRank(stick, type, cat, def) {
  const vals = Object.entries(stick).map(([d, bt]) => [d, ((bt[type] || {})[cat] || {})]).filter(([, c]) => c.n >= SS_MIN_GAMES);
  const mine = vals.find(([d]) => d === def);
  if (!mine) return null;
  return { r: 1 + vals.filter(([, c]) => c.avg < mine[1].avg).length, n: vals.length };
}
function ssPlayerRows(games, stick) {
  const st = DATA.shot_types;
  const out = [];
  const injured = new Set(Object.values(DATA.injuries || {}).flat().filter((x) => SS_OUT.has(x.status)).map((x) => String(x.id)));
  games.forEach((g) => {
    [[g.away, g.home], [g.home, g.away]].forEach(([mine, def]) => {
      Object.entries(st.players).forEach(([pid, p]) => {
        if (p.team !== mine || injured.has(pid) || !p.avg) return;
        Object.entries(SS_PLAYER).forEach(([cat, [, ai, minSelf, gap, label]]) => {
          if (p.avg[ai] < minSelf) return;
          const c = (((stick[def] || {})[p.type] || {})[cat]);
          if (!c || c.n < SS_MIN_GAMES) return;
          const more = c.avg >= gap && c.hit >= SS_HIT_HI;
          const less = c.avg <= -gap && c.hit <= SS_HIT_LO;
          if (!more && !less) return;
          out.push({ kind: "player", side: more ? "more" : "less", cat, game: g, team: mine, opp: def, pid, p, c, label,
            score: Math.abs(c.avg) / gap, rank: ssDefRank(stick, p.type, cat, def), self: p.avg[ai] });
        });
      });
    });
  });
  return out;
}

// ---- team rows: Matchup Keys' own keys ----
function ssTeamRows(games, table, ranks) {
  const out = [];
  games.forEach((g) => {
    if (!table[g.away] || !table[g.home]) return;
    nbaMatchupKeys(table, g.away, g.home).forEach((k) => {
      const cat = SS_TOPIC[k.topic];
      if (!cat) return;
      let side = null, team = k.team;
      if (k.type === "edge" || k.type === "fits") {
        const offense = k.tiles[0].team === k.team; // the first tile is the offense's
        side = offense ? "more" : "less";
        team = offense ? k.team : k.tiles[0].team; // a defense Edge is a Tough Spot for the offense it faces
      } else if (k.type === "style" || k.type === "trend") {
        side = SS_LESS.some((w) => k.title.startsWith(w)) ? "less" : "more";
        team = null;
      } else return;
      out.push({ kind: "team", side, cat, game: g, team, key: k, score: k.score });
    });
  });
  return out;
}

// ---- a player row's line and drop-down ----
const ssKey = (row) => `${row.pid}|${row.cat}|${row.game.game_id}`;
// his main line tonight (the player card's rule: nbaCardMainLine over every book's quotes), or null
function ssLine(row) {
  if (typeof bookQuotes !== "function" || typeof nbaCardMainLine !== "function") return null;
  const g = row.game;
  const quotes = bookQuotes({ kind: "prop", team: row.team, pid: row.pid, stat: row.cat, game: `${g.away}_${g.home}` });
  return quotes.length ? nbaCardMainLine(quotes) : null;
}
// that night's line for a player (props.json research: points `lines`, threes `lines3`, by game id)
function ssLineThen(pid, gid, cat) {
  const rs = (((nbaCardProps() || {}).research || {}).players || {})[pid] || {};
  const v = (rs[cat === "threes" ? "lines3" : "lines"] || {})[gid];
  return v === undefined ? null : v;
}
const SS_DTABS = [["like", "Players Like Him"], ["def", "Defense Vs Every Type"]];
// The drop-down (the owner, 2026-11-11: "having it appear with the players in question, what their line
// was, and what they scored that night"), tabs like the other pages.
function ssDrop(row) {
  const props = nbaCardProps();
  const tabs = `<div class="ss-dtabs">${SS_DTABS.map(([k, name]) => `<button type="button" class="${ssView.dtab === k ? "on" : ""}" data-dtab="${k}">${k === "def" ? `${row.opp} Vs Every Type` : name}</button>`).join("")}</div>`;
  const body = ssView.dtab === "def" ? ssDropDef(row) : props === undefined ? '<p class="no-data-note">Loading the lines&hellip;</p>' : ssDropLike(row);
  return `<tr class="ss-drop"><td colspan="6"><div class="ss-dbox">${tabs}${body}</div></td></tr>`;
}
function ssDropLike(row) {
  const st = DATA.shot_types;
  const f = Object.fromEntries(st.log_fields.map((k, i) => [k, i]));
  const field = row.cat === "points" ? "pts" : "m3";
  const rows = st.log.filter((r) => r[f.def] === row.opp && r[f.date] < row.game.date && (st.players[r[f.player]] || {}).type === row.p.type)
    .sort((a, b) => (a[f.date] < b[f.date] ? 1 : -1));
  let overs = 0, lined = 0;
  const body = rows.map((r) => {
    const p = st.players[r[f.player]] || {};
    const v = r[f[field]], diff = r[f[`${field}_diff`]];
    const line = f.game === undefined ? null : ssLineThen(r[f.player], r[f.game], row.cat);
    const call = line === null ? "" : v > line ? "Over" : v < line ? "Under" : "Push";
    if (line !== null && call !== "Push") { lined += 1; if (call === "Over") overs += 1; }
    const hue = call === "Over" ? 135 : call === "Under" ? 0 : 58;
    const d = new Date(`${r[f.date]}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    return `<tr><td class="pt-name">${playerClick(r[f.player], ssEsc(p.name || r[f.player]))}</td><td>${d}</td>
      <td><div class="od-tile pt-tile"><b>${line === null ? "--" : line}</b></div></td>
      <td><div class="od-tile pt-tile"><b>${v}</b></div></td>
      <td>${call ? `<span class="ss-call" style="background:${scaleHsla(hue, 78, 44, 0.5)}">${call}</span>` : '<span class="ss-call">No Line</span>'}</td>
      <td><div class="od-tile pt-tile" style="${ssStep(Math.max(0, Math.min(1, 0.5 + diff / (row.cat === "points" ? 16 : 4))))}" title="Against his own average in his other games"><b>${diff > 0 ? "+" : ""}${diff.toFixed(1)}</b></div></td></tr>`;
  }).join("");
  const unit = row.cat === "points" ? "PTS" : "3PM";
  const sum = `Type ${row.p.type} against ${row.opp}: ${rows.length} games, beat their own average in ${rows.filter((r) => r[f[`${field}_diff`]] > 0).length}${lined ? `, went over their line in ${overs} of ${lined}` : ""}.`;
  return `<p class="ss-dsum">${ssLetter(row.p.type)} ${sum}</p><div class="ss-dscroll"><table class="data-table od-grid pt-grid ss-dgrid">
    <thead><tr><th class="pt-name">Player</th><th>Date</th><th>Line</th><th>${unit}</th><th>Vs Line</th><th>Vs His Avg</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function ssDropDef(row) {
  const stick = ssStick(row.game.date);
  const letters = "ABCDEFGHIJKL".split("");
  const fmt = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const cells = letters.map((L) => {
    const c = ((stick[row.opp] || {})[L] || {})[row.cat];
    const rk = c && c.n >= SS_MIN_GAMES ? ssDefRank(stick, L, row.cat, row.opp) : null;
    const style = rk ? rankStyle(rk.r, rk.n) : "";
    return c ? [`<td><div class="od-tile pt-tile${rk ? "" : " pt-thin"}" style="${style}" title="Type ${L} vs ${row.opp}: ${fmt(c.avg)} over their own averages in ${c.n} games${rk ? `, ${ordinal(rk.r)} of ${rk.n} defenses (30th = gives up the most)` : ""}"><b>${fmt(c.avg)}</b></div></td>`,
      `<td><div class="od-tile pt-tile${rk ? "" : " pt-thin"}" style="${style}"><b>${c.over}/${c.n}</b></div></td>`]
      : ['<td><div class="od-tile pt-tile pt-thin"><b>--</b></div></td>', '<td><div class="od-tile pt-tile pt-thin"><b></b></div></td>'];
  });
  const head = letters.map((L) => `<th${L === row.p.type ? ' class="ss-mine"' : ""}>${ssLetter(L)}</th>`).join("");
  return `<p class="ss-dsum">What ${row.opp} gives up to every type in ${row.label.toLowerCase()}, over those players' own averages (30th = gives up the most, red; faded = under ${SS_MIN_GAMES} games). His letter is outlined.</p>
    <div class="ss-dscroll"><table class="data-table od-grid pt-grid ss-dgrid"><thead><tr><th></th>${head}</tr></thead>
    <tbody><tr><td class="pt-name">+/- Avg</td>${cells.map((c) => c[0]).join("")}</tr><tr><td class="pt-name">Beat Avg</td>${cells.map((c) => c[1]).join("")}</tr></tbody></table></div>`;
}

// ---- drawing ----
function ssTeamTiles(row, ranks, table) {
  const t = row.key.tiles.slice(0, 2);
  const g = row.game;
  return t.map(({ team, key }, i) => {
    const opp = team === g.away ? g.home : g.away;
    const who = typeof whoTile_ === "function" ? whoTile_(key, team, opp, i === 0) : "";
    const c = COLS.find((x) => x[0] === key);
    const rk = (ranks[key] || { r: {} }).r[team];
    const n = (ranks[key] || {}).n || 30;
    const v = (table[team] || {})[key];
    const name = c ? c[2] : key;
    return `<td><div class="od-tile pt-tile ss-tile${who ? " ss-click" : ""}"${who} style="${rk ? rankStyle(rk, n) : ""}" title="${ssEsc(`${ssTeam(team).name} · ${name}: ${c ? exact(v, c[3]) : v}${rk ? ` · ${ordinal(rk)} of ${n}` : ""}${who ? " · click for who's behind it" : ""}`)}"><b>${rk ? ordinal(rk) : "--"}</b><small>${team} ${c ? c[1].replace("<br>", " ") : ""}</small></div></td>`;
  }).join("");
}
function ssPlayerTiles(row) {
  const { c, rank, self, cat } = row;
  const fmt = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const selfName = cat === "points" ? "PTS" : "3PM";
  const line = ssLine(row);
  const selfTile = `<td><div class="od-tile pt-tile ss-tile" title="${ssEsc(`${row.p.name}: ${line === null ? "no line yet" : `line ${line}`} tonight; ${self} ${selfName} a game this season`)}"><b>${line === null ? "--" : line}</b><small>Line · Avg ${self.toFixed(1)}</small></div></td>`;
  const who = Object.entries(c.who).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${(DATA.shot_types.players[id] || {}).name || id} (${n})`).join(", ");
  const defTile = `<td><div class="od-tile pt-tile ss-tile ss-click" data-dd="${ssKey(row)}" style="${rank ? rankStyle(rank.r, rank.n) : ""}" title="${ssEsc(`Type ${row.p.type} vs ${row.opp}: ${fmt(c.avg)} ${row.label.toLowerCase()} over their own average, ${c.n} games${rank ? ` · ${ordinal(rank.r)} of ${rank.n} defenses (30th = gives up the most)` : ""} · ${who}`)}"><b>${fmt(c.avg)}</b><small>${ssLetter(row.p.type)} vs ${row.opp}</small></div></td>`;
  const hitTile = `<td><div class="od-tile pt-tile ss-tile ss-click" data-dd="${ssKey(row)}" style="${ssStep(c.hit)}" title="${ssEsc(`In ${c.over} of ${c.n} games, type ${row.p.type} beat their own average against ${row.opp}`)}"><b>${c.over}/${c.n}</b><small>Beat Avg</small></div></td>`;
  return selfTile + defTile + hitTile;
}
// Two views (the owner, 2026-11-12, picked from three mockups): By Category (default: the headliners,
// then the two lists, for "just the outliers by market") and Sort By Game (one card per game, for SGP
// bettors). Same rows, tiles, hovers and clicks in both.
const ssFaceUrl = (pid) => `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${pid}.png&w=96&h=70&scale=crop`;
const ssTime = (g) => {
  const [h, m] = String(g.time || "").split(":").map(Number);
  return Number.isNaN(h) ? "" : `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const SS_SHORT = { points: "Points", threes: "Threes", inside: "Paint / Mid", glass: "Rebounds", turnovers: "Turnovers", ft: "Free Throws", pace: "Pace / Total" };
const ssArrow = (side) => (side === "more" ? "&#9650;" : "&#9660;");
const ssFace = (row, cls = "") => `<span class="ss-face ${cls}" style="--team:${ssRgb(row.team)}"><img src="${ssFaceUrl(row.pid)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>`;
const ssLogoBox = (abbr, cls = "") => `<span class="ss-logo ${cls}" style="--team:${ssRgb(abbr)}" title="${ssEsc(ssTeam(abbr).name)}: open this game in Matchup Keys">${ssTeam(abbr).logo ? `<img src="${ssTeam(abbr).logo}" alt="${abbr}" loading="lazy">` : abbr}</span>`;
// How far past its own cut a spot is: a player, his type's +/- over the owner's cutoff (1 = right at
// it); a team, Matchup Keys' own score. Only orders the headliners and shades the category chips.
const ssStrength = (row) => (row.kind === "player" ? (row.score - 1) / 1.4 : (row.score - 0.3) / 1.1);
// the category chip's color on the 8-step scale: Standouts the three greens, Tough Spots the three reds
function ssDirStyle(row) {
  const s = ssStrength(row);
  const step = row.side === "more" ? (s > 0.6 ? 0 : s > 0.3 ? 1 : 2) : (s > 0.6 ? 7 : s > 0.3 ? 6 : 5);
  const [hue, fill] = SS_RANK_SCALE[step];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
}
const ssTilesTds = (row, b) => (row.kind === "player" ? ssPlayerTiles(row) : `${ssTeamTiles(row, b.ranks, b.table)}<td></td>`);
// the tiles in a one-row grid of their own (cards), keeping the page's look and clicks
const ssTiles = (row, b, cls = "") => `<table class="data-table od-grid pt-grid ss-grid ss-tiles ${cls}"><tbody><tr data-game="${row.game.game_id}">${ssTilesTds(row, b)}</tr></tbody></table>`;
const ssDropFor = (row) => (row.kind === "player" && ssView.open === ssKey(row)
  ? `<table class="data-table od-grid pt-grid ss-grid ss-droptable"><tbody>${ssDrop(row)}</tbody></table>` : "");
function ssWho(row) {
  const g = row.game;
  if (row.kind === "player") return `${ssFace(row)}<span class="ss-name">${playerClick(row.pid, ssEsc(row.p.name))}<small>${ssEsc(row.p.pos || "")} &middot; ${row.team} vs ${row.opp}</small></span>`;
  if (row.team) return `${ssLogoBox(row.team)}<span class="ss-name ss-team"><b>${row.team}</b><small>Offense vs ${row.team === g.away ? g.home : g.away}</small></span>`;
  return `<span class="ss-pair">${ssLogoBox(g.away)}${ssLogoBox(g.home)}</span><span class="ss-name"><b>Both Teams</b><small>${g.away} @ ${g.home}</small></span>`;
}
function ssReadOf(row, stacked) {
  const tag = stacked ? `<span class="ss-stack" title="${ssEsc(stacked)}">Stacked</span>` : "";
  return row.kind === "player" ? `${ssLetter(row.p.type)} ${row.label}${tag}` : `${ssEsc(row.key.title)}${tag}`;
}
const ssCounts = (rows) => {
  const up = rows.filter((r) => r.side === "more").length;
  return `<span class="ss-counts"><span class="ss-up">${ssArrow("more")}${up}</span><span class="ss-down">${ssArrow("less")}${rows.length - up}</span></span>`;
};

// ---- By Category: the slate strip, the headliners, the two lists ----
function ssSlateStrip(b) {
  return `<div class="ss-slate">${b.games.map((g) => `<div class="ss-slate-game" data-game="${g.game_id}" title="Open this game in Matchup Keys">
      <div class="ss-slate-teams">${ssLogoBox(g.away)}<span>@</span>${ssLogoBox(g.home)}</div>
      <div class="ss-slate-info"><b>${g.away} @ ${g.home}</b><small>${ssTime(g)}${g.tv ? ` &middot; ${ssEsc(g.tv)}` : ""}</small></div>
      ${ssCounts(b.shown.filter((r) => r.game === g))}</div>`).join("")}</div>`;
}
// The three biggest spots on a side, one card per player / team: the strongest player spot and the
// strongest team spot always make it (neither kind can crowd the other out), then the next strongest.
function ssHeroPick(list) {
  const seen = new Set();
  const sorted = list.slice().sort((x, y) => ssStrength(y) - ssStrength(x) || (y.c ? y.c.n : 0) - (x.c ? x.c.n : 0)).filter((r) => {
    const id = r.kind === "player" ? r.pid : `${r.game.game_id}|${r.team || "both"}|${r.cat}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const pick = [sorted.find((r) => r.kind === "player"), sorted.find((r) => r.kind === "team")].filter(Boolean);
  sorted.forEach((r) => { if (pick.length < 3 && !pick.includes(r)) pick.push(r); });
  return pick.sort((x, y) => ssStrength(y) - ssStrength(x));
}
function ssHeroCard(row, b) {
  const g = row.game;
  const pic = row.kind === "player" ? ssFace(row, "ss-face-lg") : row.team ? ssLogoBox(row.team, "ss-logo-lg") : `<span class="ss-pair">${ssLogoBox(g.away, "ss-logo-lg")}${ssLogoBox(g.home, "ss-logo-lg")}</span>`;
  const name = row.kind === "player" ? playerClick(row.pid, ssEsc(row.p.name)) : `<b>${row.team ? `${row.team} Offense` : "Both Teams"}</b>`;
  return `<div class="ss-hero-card" data-game="${g.game_id}" style="--team:${ssRgb(row.team || g.home)}">
    <div class="ss-hero-top">${pic}<div class="ss-hero-who">${name}<small>${g.away} @ ${g.home} &middot; ${ssTime(g)}</small></div></div>
    <div class="ss-hero-read"><span class="ss-cat-chip" style="${ssDirStyle(row)}">${ssArrow(row.side)} ${SS_SHORT[row.cat]}</span>${ssReadOf(row, b.stacks.get(row))}</div>
    ${ssTiles(row, b, "ss-tiles-lg")}</div>`;
}
function ssHeroes(b) {
  const col = (side, title) => {
    const cards = ssHeroPick(b.shown.filter((r) => r.side === side));
    return cards.length ? `<div class="ss-hero-col ss-${side}"><div class="ss-band ss-${side} ss-hero-band">${ssArrow(side)} ${title}</div>
      <div class="ss-hero-cards">${cards.map((r) => ssHeroCard(r, b)).join("")}</div></div>` : "";
  };
  return `<div class="ss-hero">${col("more", "Biggest Standouts Tonight")}${col("less", "Biggest Tough Spots Tonight")}</div>`;
}
function ssSection(title, side, b) {
  const rows = b.shown.filter((r) => r.side === side);
  const cats = SS_CATS.filter(([c]) => ssView.cat === "all" || ssView.cat === c);
  const body = cats.map(([c, name]) => {
    // players (with their letters) first, then teams, strongest first in each (the owner, 2026-11-11: not jumbled)
    const list = rows.filter((r) => r.cat === c);
    if (!list.length) return "";
    return `<tr class="ss-cat"><td colspan="6"><div class="ss-catband ss-${side}">${name}<span>${list.length}</span></div></td></tr>${list.map((r) => {
      const g = r.game;
      return `<tr class="ss-${r.kind === "player" ? "p" : "t"}" data-game="${g.game_id}"><td class="ss-game ss-open" title="Open this game in Matchup Keys">${g.away} @ ${g.home}<small>${ssTime(g)}</small></td>
        <td class="pt-name"><div class="ss-who">${ssWho(r)}</div></td><td class="ss-read">${ssReadOf(r, b.stacks.get(r))}</td>${ssTilesTds(r, b)}</tr>${r.kind === "player" && ssView.open === ssKey(r) ? ssDrop(r) : ""}`;
    }).join("")}`;
  }).join("");
  return `<div class="ss-box"><table class="data-table od-grid pt-grid ss-grid ss-list">
    <colgroup><col style="width:76px"><col style="width:190px"><col style="width:236px"><col style="width:78px"><col style="width:78px"><col style="width:78px"></colgroup>
    <thead><tr class="od-ggroups"><th class="ss-band ss-${side}" colspan="6">${ssArrow(side)} <span class="ss-title">${title}</span> <span class="ss-n">${rows.length}</span></th></tr></thead>
    <tbody>${body || `<tr><td colspan="6" class="ss-none">Nothing ${side === "more" ? "stands out" : "tough"} in this category tonight.</td></tr>`}</tbody></table></div>`;
}

// ---- Sort By Game: one card per game ----
function ssGameCard(g, b) {
  const mine = b.shown.filter((r) => r.game === g);
  // by category, then the page's order inside each (players first, strongest first)
  const order = (side) => SS_CATS.flatMap(([c]) => mine.filter((r) => r.side === side && r.cat === c));
  const band = (side, title) => {
    const list = order(side);
    return `<div class="ss-band ss-${side} ss-cband">${ssArrow(side)} ${title} <span class="ss-n">${list.length}</span></div>
      <div class="ss-cbody">${list.length ? list.map((r) => `<div class="ss-crow ss-${r.kind === "player" ? "p" : "t"}"><span class="ss-cat-chip" style="${ssDirStyle(r)}">${SS_SHORT[r.cat]}</span>
        <div class="ss-cwho">${ssWho(r)}</div><div class="ss-cread">${ssReadOf(r, b.stacks.get(r))}</div>${ssTiles(r, b)}</div>${ssDropFor(r)}`).join("")
        : `<p class="ss-none">Nothing ${side === "more" ? "stands out" : "tough"} in this game.</p>`}</div>`;
  };
  const team = (abbr) => `<div class="ss-gteam" data-game="${g.game_id}" style="--team:${ssRgb(abbr)}" title="Open this game in Matchup Keys">${ssLogoBox(abbr, "ss-logo-lg")}<div><b>${ssEsc(ssTeam(abbr).name)}</b><small>${abbr === g.away ? "Away" : "Home"}</small></div></div>`;
  return `<section class="ss-gcard" data-game="${g.game_id}"><header class="ss-ghead">${team(g.away)}<div class="ss-gmid"><b>${ssTime(g)}</b><small>${ssEsc(g.tv || "")}</small>${ssCounts(mine)}</div>${team(g.home)}</header>
    ${band("more", "Standouts")}${band("less", "Tough Spots")}</section>`;
}

function ssBuild(date) {
  const games = ssGames(date).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const table = (DATA.league_chart || {})[ssView.window === "10" ? "10" : "season"] || {};
  const ranks = ranksOf(table);
  const stick = ssStick(date);
  const rows = [...ssTeamRows(games, table, ranks), ...ssPlayerRows(games, stick)];
  // Stacked: a player row and a team row, same game, same category, same direction, his team's side
  const stacks = new Map();
  rows.filter((r) => r.kind === "player").forEach((pr) => {
    const match = rows.find((tr) => tr.kind === "team" && tr.game === pr.game && tr.cat === pr.cat && tr.side === pr.side && (tr.team === pr.team || tr.team === null));
    if (match) stacks.set(pr, `Also a team spot: ${match.key.title}`);
  });
  const shown = rows.filter((r) => ssView.cat === "all" || r.cat === ssView.cat)
    .sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === "player" ? -1 : 1));
  return { games, table, ranks, rows, shown, stacks };
}

function ssRender() {
  const all = ssDays();
  const date = all[ssDay];
  ssEl("day-label").textContent = date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const b = ssBuild(date);
  const counts = Object.fromEntries(SS_CATS.map(([c]) => [c, b.rows.filter((r) => r.cat === c).length]));
  const more = b.shown.filter((r) => r.side === "more").length;
  ssEl("ss-bar").innerHTML = `<div class="pt-seg">${[["all", "All"], ...SS_CATS].map(([c, name]) => `<button type="button" class="view-toggle-btn${ssView.cat === c ? " active" : ""}" data-cat="${c}">${name}${c === "all" ? "" : ` <small>${counts[c]}</small>`}</button>`).join("")}</div>
    <div class="pt-seg">${[["season", "Season"], ["10", "Last 10"]].map(([w, name]) => `<button type="button" class="view-toggle-btn${ssView.window === w ? " active" : ""}" data-window="${w}">${name}</button>`).join("")}</div>
    <button type="button" class="view-toggle-btn ss-bygame${ssView.byGame ? " active" : ""}" data-bygame aria-pressed="${ssView.byGame}" title="One card per game (for same-game parlays)">Sort By Game</button>
    <span class="ss-tally"><span class="ss-up">${ssArrow("more")} ${more} Standouts</span><span class="ss-down">${ssArrow("less")} ${b.shown.length - more} Tough Spots</span><span class="ss-games">${b.games.length} Game${b.games.length === 1 ? "" : "s"}</span></span>`;
  if (!b.games.length) {
    ssEl("ss-body").innerHTML = '<p class="no-data-note">No games this day.</p>';
    return;
  }
  ssEl("ss-body").innerHTML = ssView.byGame
    ? `<div class="ss-gcards">${b.games.map((g) => ssGameCard(g, b)).join("")}</div>`
    : `${ssSlateStrip(b)}${ssHeroes(b)}<div class="ss-cols">${ssSection("Standouts", "more", b)}${ssSection("Tough Spots", "less", b)}</div>`;
}

// A team or a game opens that game on Matchup Keys (its open game: matchup-keys.js NBA_GAME_KEY).
function ssOpenGame(id) {
  try {
    localStorage.setItem("nba-tool.game.v1", id);
  } catch (e) {
    // localStorage unavailable -- Matchup Keys opens on today's first game.
  }
  location.href = "matchup-keys.html";
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".player-click")) return;
  const whoTile = e.target.closest(".ss-grid [data-who]");
  if (whoTile && typeof whoOpen === "function") {
    const g = DATA.schedule.find((x) => String(x.game_id) === whoTile.closest("tr").dataset.game);
    return whoOpen(whoTile.dataset.who, g, whoDirs(whoTile, g));
  }
  const dd = e.target.closest(".ss-grid [data-dd]");
  if (dd) {
    ssView.open = ssView.open === dd.dataset.dd ? "" : dd.dataset.dd;
    ssRender();
    // a headliner's tile opens its row's drop-down in the list below
    if (ssView.open && dd.closest(".ss-hero-card")) document.querySelector(".ss-list tr.ss-drop")?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (ssView.open && nbaCardProps() === undefined) Promise.resolve(NBA_CARD_PROPS).then(() => ssRender());
    return;
  }
  const dtab = e.target.closest(".ss-dtabs [data-dtab]");
  if (dtab) {
    ssView.dtab = dtab.dataset.dtab;
    return ssRender();
  }
  const open = e.target.closest("#ss-body :is(.ss-logo, .ss-open, .ss-team, .ss-slate-game, .ss-gteam)");
  if (open && open.closest("[data-game]")) return ssOpenGame(open.closest("[data-game]").dataset.game);
  if (e.target.closest("#ss-bar [data-bygame]")) {
    ssView.byGame = !ssView.byGame;
    ssView.open = "";
    try {
      localStorage.setItem(SS_BYGAME_KEY, ssView.byGame ? "1" : "0");
    } catch (err) {
      // localStorage unavailable -- the view just won't stick.
    }
    return ssRender();
  }
  const cat = e.target.closest("#ss-bar [data-cat]");
  if (cat) {
    ssView.cat = cat.dataset.cat;
    return ssRender();
  }
  const win = e.target.closest("#ss-bar [data-window]");
  if (win) {
    ssView.window = win.dataset.window;
    return ssRender();
  }
  if (e.target.closest("#day-prev") || e.target.closest("#day-next")) {
    ssDay = Math.max(0, Math.min(ssDays().length - 1, ssDay + (e.target.closest("#day-prev") ? -1 : 1)));
    return ssRender();
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

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    if (!data.shot_types || !data.shot_types.log || !data.league_chart) {
      ssEl("empty-state").innerHTML = "<p>Slate Standouts aren't available right now.</p>";
      return;
    }
    ssEl("empty-state").hidden = true;
    ssEl("ss-app").hidden = false;
    const all = ssDays();
    const today = new Date().toLocaleDateString("en-CA");
    ssDay = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
    ssRender();
  })
  .catch((err) => {
    ssEl("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
