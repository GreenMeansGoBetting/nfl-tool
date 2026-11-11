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
const ssView = { cat: "all", window: "season", open: "", dtab: "like" }; // open: the player row whose drop-down is open

const ssEl = (id) => document.getElementById(id);
const ssTeam = (abbr) => (DATA.teams || {})[abbr] || { name: abbr, color: "555555", logo: "" };
const ssRgb = (abbr) => [0, 2, 4].map((i) => parseInt((ssTeam(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
const ssEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ssDays = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const ssGames = (date) => DATA.schedule.filter((g) => g.date === date);
const ssLogo = (abbr) => `<div class="pt-logo" style="--team:${ssRgb(abbr)}" title="${ssEsc(ssTeam(abbr).name)}: open this game in Matchup Keys">${ssTeam(abbr).logo ? `<img src="${ssTeam(abbr).logo}" alt="${abbr}" loading="lazy">` : abbr}</div>`;
const ssLetter = (L) => `<span class="pt-letter" style="--h:${Math.round("ABCDEFGHIJK".indexOf(L) * 28)}">${L}</span>`;

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
  const letters = "ABCDEFGHIJK".split("");
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
function ssRow(row, ranks, table, stacked) {
  const g = row.game;
  const gameCell = `<td class="ss-game ss-open" title="Open this game in Matchup Keys">${g.away} @ ${g.home}</td>`;
  const tag = stacked ? `<span class="ss-stack" title="${ssEsc(stacked)}">Stacked</span>` : "";
  if (row.kind === "player") {
    return `<tr class="ss-p" data-game="${g.game_id}">${gameCell}<td class="pt-name"><div class="ss-who">${ssLogo(row.team)}<span>${playerClick(row.pid, ssEsc(row.p.name))}<small>${ssEsc(row.p.pos || "")} · vs ${row.opp}</small></span></div></td>
      <td class="ss-read">${ssLetter(row.p.type)} ${row.label}${tag}</td>${ssPlayerTiles(row)}</tr>${ssView.open === ssKey(row) ? ssDrop(row) : ""}`;
  }
  const who = row.team ? `${ssLogo(row.team)}<span class="ss-team"><b>${row.team}</b><small>Offense vs ${row.team === g.away ? g.home : g.away}</small></span>` : `${ssLogo(g.away)}${ssLogo(g.home)}<span><small>Both Teams</small></span>`;
  return `<tr class="ss-t" data-game="${g.game_id}">${gameCell}<td class="pt-name"><div class="ss-who">${who}</div></td><td class="ss-read">${ssEsc(row.key.title)}${tag}</td>${ssTeamTiles(row, ranks, table)}<td></td></tr>`;
}
function ssSection(title, rows, ranks, table, stacks) {
  const cats = SS_CATS.filter(([c]) => ssView.cat === "all" || ssView.cat === c);
  const body = cats.map(([c, name]) => {
    // players (with their letters) first, then teams, strongest first in each (the owner, 2026-11-11: not jumbled)
    const list = rows.filter((r) => r.cat === c).sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === "player" ? -1 : 1));
    if (!list.length) return "";
    return `<tr class="ss-cat"><td colspan="6">${name}</td></tr>${list.map((r) => ssRow(r, ranks, table, stacks.get(r))).join("")}`;
  }).join("");
  return `<div class="ss-box"><table class="data-table od-grid pt-grid ss-grid">
    <colgroup><col style="width:76px"><col style="width:190px"><col style="width:236px"><col style="width:78px"><col style="width:78px"><col style="width:78px"></colgroup>
    <thead><tr class="od-ggroups"><th class="od-g${title === "Standouts" ? 0 : 3} ss-title" colspan="6">${title}</th></tr></thead>
    <tbody>${body || `<tr><td colspan="6" class="ss-none">Nothing ${title === "Standouts" ? "stands out" : "tough"} in this category tonight.</td></tr>`}</tbody></table></div>`;
}

function ssRender() {
  const all = ssDays();
  const date = all[ssDay];
  ssEl("day-label").textContent = date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const games = ssGames(date);
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
  const counts = Object.fromEntries(SS_CATS.map(([c]) => [c, rows.filter((r) => r.cat === c).length]));
  ssEl("ss-bar").innerHTML = `<div class="pt-seg">${[["all", "All"], ...SS_CATS].map(([c, name]) => `<button type="button" class="view-toggle-btn${ssView.cat === c ? " active" : ""}" data-cat="${c}">${name}${c === "all" ? "" : ` <small>${counts[c]}</small>`}</button>`).join("")}</div>
    <div class="pt-seg">${[["season", "Season"], ["10", "Last 10"]].map(([w, name]) => `<button type="button" class="view-toggle-btn${ssView.window === w ? " active" : ""}" data-window="${w}">${name}</button>`).join("")}</div>
    <span class="pt-count">${games.length} game${games.length === 1 ? "" : "s"}</span>`;
  ssEl("ss-body").innerHTML = games.length
    ? `<div class="ss-cols">${ssSection("Standouts", rows.filter((r) => r.side === "more"), ranks, table, stacks)}${ssSection("Tough Spots", rows.filter((r) => r.side === "less"), ranks, table, stacks)}</div>`
    : `<p class="no-data-note">No games this day.</p>`;
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
    if (ssView.open && nbaCardProps() === undefined) Promise.resolve(NBA_CARD_PROPS).then(() => ssRender());
    return;
  }
  const dtab = e.target.closest(".ss-dtabs [data-dtab]");
  if (dtab) {
    ssView.dtab = dtab.dataset.dtab;
    return ssRender();
  }
  const open = e.target.closest(".ss-grid tr[data-game] :is(.pt-logo, .ss-open, .ss-team)");
  if (open) return ssOpenGame(open.closest("tr").dataset.game);
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
