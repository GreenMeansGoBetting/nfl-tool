// ---- NFL Vs Position ----
// What each defense gives up to each position (a member, 2026-10-31: "a screen that shows how much
// yards/catches a defense has given up to a position ... how many receiving yards the Colts gave to
// running backs"; the owner, 2026-11-24: its own tool under the Opening Drive Tool, built like it,
// QB rushing and TDs included, a bad defense is red). Counted in the browser from every player's
// weekly log (DATA.player_game_logs: targets, catches, yards, carries, TDs, opponent) by his roster
// position (prop_matchup_model's per-game players, else player_stats). Real counts, no pull toward
// league average. Shared look: style.css .od-grid / .od-tile (the One Look grid).

const VP_POSITIONS = ["QB", "RB", "WR", "TE"];
// [key, label, positions shown, the number from one weekly log row, decimals]
const VP_STATS = [
  ["yds", "Rec Yds", ["RB", "WR", "TE"], (g) => g.rec_yards || 0, 1],
  ["rec", "Receptions", ["RB", "WR", "TE"], (g) => g.receptions || 0, 1],
  ["tgt", "Targets", ["RB", "WR", "TE"], (g) => g.targets || 0, 1],
  ["rush", "Rush Yds", ["QB", "RB"], (g) => g.rush_yards || 0, 1], // WRs' few carries left off: near-zero tiles
  ["td", "TDs", ["QB", "RB", "WR", "TE"], (g) => (g.rush_td || 0) + (g.rec_td || 0), 2],
];
// Players shown a position in the matchup (and the pool their colors are ranked in).
const VP_SHOWN = { QB: 1, RB: 2, WR: 3, TE: 2 };
const VP_MIN_GAMES = 2; // never a player off one fill-in game (lineup-aware usage)
const VP_VIEW_KEY = "nfl-tool.vs-position-view.v1";
const vpView = (() => {
  const base = { stat: "yds", win: "season", sort: "WR", dir: -1 };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(VP_VIEW_KEY)) || {}) };
  } catch (e) {
    return base;
  }
})();
function vpSave() {
  try {
    localStorage.setItem(VP_VIEW_KEY, JSON.stringify(vpView));
  } catch (e) {
    // localStorage unavailable -- the view just won't stick.
  }
}
const vpStat = () => VP_STATS.find((s) => s[0] === vpView.stat) || VP_STATS[0];
const vpOrd = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
const vpFmt = (v) => (v === null || v === undefined ? "--" : v.toFixed(vpStat()[4]));

// ---- the counts (built once) ----
let VP = null;
function vpBuild() {
  // Each player's roster position: the latest game's in prop_matchup_model, else player_stats.
  const pos = {};
  const setPos = (team, name, p) => {
    const k = p === "FB" ? "RB" : p;
    if (VP_POSITIONS.includes(k)) (pos[team] = pos[team] || {})[normName(name)] = k;
  };
  Object.entries(DATA.player_stats || {}).forEach(([team, list]) => (list || []).forEach((p) => setPos(team, p.name, p.position)));
  [...((DATA.prop_matchup_model || {}).games || [])].sort((a, b) => a.wk - b.wk).forEach((g) => (g.p || []).forEach((p) => setPos(g.off, p.n, p.pos)));
  // Each team's finished games, oldest first: [{ week, home, opp }].
  const games = {};
  (DATA.schedule || []).filter((g) => g.home_score !== null && g.home_score !== undefined).sort((a, b) => a.week - b.week).forEach((g) => {
    (games[g.away] = games[g.away] || []).push({ week: g.week, home: false, opp: g.home });
    (games[g.home] = games[g.home] || []).push({ week: g.week, home: true, opp: g.away });
  });
  // allowed[defense][week][position] = { stat key: total }, from the other team's players' logs.
  const allowed = {};
  const players = {}; // players[team][name] = { pos, logs: [weekly rows] }
  Object.entries(DATA.player_game_logs || {}).forEach(([team, byName]) => {
    Object.entries(byName || {}).forEach(([name, logs]) => {
      const p = (pos[team] || {})[normName(name)];
      if (!p) return;
      (players[team] = players[team] || {})[name] = { pos: p, logs: logs || [] };
      (logs || []).forEach((g) => {
        const played = (games[g.opp] || []).some((x) => x.week === g.week && x.opp === team);
        if (!played) return;
        const cell = (((allowed[g.opp] = allowed[g.opp] || {})[g.week] = allowed[g.opp][g.week] || {})[p] = allowed[g.opp][g.week][p] || {});
        VP_STATS.forEach(([key, , , get]) => (cell[key] = (cell[key] || 0) + get(g)));
      });
    });
  });
  VP = { pos, games, allowed, players, teams: Object.keys(games).sort() };
}

// A team's games in the picked stretch.
function vpGames(team) {
  const all = VP.games[team] || [];
  if (vpView.win === "home") return all.filter((g) => g.home);
  if (vpView.win === "away") return all.filter((g) => !g.home);
  const n = Number(vpView.win);
  return n > 0 ? all.slice(-n) : all;
}
// What a defense gives up a game to a position, in the stretch (null = no games).
function vpAllowed(def, p) {
  const games = vpGames(def);
  if (!games.length) return null;
  const total = games.reduce((sum, g) => sum + ((((VP.allowed[def] || {})[g.week] || {})[p] || {})[vpView.stat] || 0), 0);
  return total / games.length;
}
// Rank of 32 from the defense's side: 1 = allows the fewest (green), 32 = the most (red).
function vpDefRank(def, p) {
  const v = vpAllowed(def, p);
  if (v === null) return null;
  const pool = VP.teams.map((t) => vpAllowed(t, p)).filter((x) => x !== null);
  return { rank: pool.filter((x) => x < v - 1e-9).length + 1, of: pool.length };
}
const vpRankWords = (r) => (r.rank <= r.of / 2 ? `${vpOrd(r.rank)} fewest` : `${vpOrd(r.of - r.rank + 1)} most`);

// One offense's players at a position: the ones carrying the load, never a one-game fill-in or a player
// ruled Out this week. Volume = targets + carries a game (a QB: pass attempts), season-long.
function vpPlayers(team, p) {
  const week = scheduleWeek || DATA.current_week;
  const weeks = new Set(vpGames(team).map((g) => g.week));
  const teamGames = weeks.size;
  const get = vpStat()[3];
  return Object.entries((VP.players || {})[team] || {})
    .filter(([name, x]) => x.pos === p && x.logs.length >= VP_MIN_GAMES && !lineupOutOn(team, name, week))
    .map(([name, x]) => {
      const vol = x.logs.reduce((s, g) => s + (p === "QB" ? g.pass_att || 0 : (g.targets || 0) + (g.carries || 0)), 0) / x.logs.length;
      const mine = x.logs.filter((g) => weeks.has(g.week));
      return { name, vol, gp: mine.length, teamGames, value: mine.length ? mine.reduce((s, g) => s + get(g), 0) / mine.length : null };
    })
    .sort((a, b) => b.vol - a.vol)
    .slice(0, VP_SHOWN[p]);
}
// Every team's shown players at a position: the pool a player's color is ranked in (the most = 1st).
function vpPlayerPool(p) {
  return VP.teams.flatMap((t) => vpPlayers(t, p)).map((x) => x.value).filter((v) => v !== null);
}

// ---- drawing ----
const vpTeamRgb = (team) => teamAccentRgb(team).map(Math.round).join(",");
const vpTeam = (team) => `<span class="nvp-team">${teamLogoMini(team, 20)}<b>${team}</b></span>`;
function vpDefTile(def, p) {
  const v = vpAllowed(def, p);
  const r = vpDefRank(def, p);
  if (v === null || !r) return `<div class="od-tile">--</div>`;
  const tip = `${def} allows ${vpFmt(v)} ${vpStat()[1].toLowerCase()} a game to ${p}s (${vpGames(def).length} games): ${vpRankWords(r)} of ${r.of}`;
  return `<div class="od-tile nvp-def"${rankScaleStyle(r.rank, r.of)} title="${tip}"><b>${vpFmt(v)}</b><small>${vpOrd(r.rank)}</small></div>`;
}
function vpPlayerTile(team, def, x, pool) {
  const rank = x.value === null ? null : pool.filter((v) => v > x.value + 1e-9).length + 1;
  const gp = x.gp < x.teamGames / 2 ? `<i class="nvp-gp">${x.gp} GP</i>` : "";
  const tip = `${x.name}: ${vpFmt(x.value)} ${vpStat()[1].toLowerCase()} a game (${x.gp} of ${x.teamGames} games)${rank ? `, ${vpOrd(rank)} of ${pool.length} starters at his position` : ""}`;
  return `<div class="od-tile nvp-player"${rank ? rankScaleStyle(rank, pool.length) : ""} title="${tip}"><b>${vpFmt(x.value)}</b><small>${playerClick(team, x.name, shortName(x.name), def)}${gp}</small></div>`;
}
// One offense against the other defense: a lane per position, read straight across.
function vpSide(off, def, pools) {
  const positions = vpStat()[2];
  const width = Math.max(...positions.map((p) => VP_SHOWN[p]));
  const gap = `<td class="od-ggap"></td>`;
  const grp = (team, i, n) => ` od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}" style="--zg:${vpTeamRgb(team)}`;
  const rows = positions.map((p) => {
    const list = vpPlayers(off, p);
    const cells = Array.from({ length: width }, (_, i) => `<td class="num od-cell${grp(off, i, width)}">${list[i] ? vpPlayerTile(off, def, list[i], pools[p]) : ""}</td>`).join("");
    return `<tr><td class="od-label nvp-pos">${p}</td>${gap}<td class="num od-cell${grp(def, 0, 1)}">${vpDefTile(def, p)}</td>${gap}${cells}</tr>`;
  }).join("");
  return `<table class="data-table od-grid nvp-side">
    <colgroup><col class="nvp-pos-col"><col class="od-ggap-col"><col class="nvp-def-col"><col class="od-ggap-col">${"<col class=\"nvp-player-col\">".repeat(width)}</colgroup>
    <thead>
      <tr class="od-ggroups"><th rowspan="2" class="od-gone nvp-pos">Pos</th>${`<th class="od-ggap"></th>`}<th class="od-gt od-gl od-gr" style="--zg:${vpTeamRgb(def)}" title="${def} defense"><span class="nvp-team">${teamLogoMini(def, 20)}<b>DEF</b></span></th><th class="od-ggap"></th><th colspan="${width}" class="od-gt od-gl od-gr" style="--zg:${vpTeamRgb(off)}" title="${off} offense"><span class="nvp-team">${teamLogoMini(off, 20)}<b>OFF</b></span></th></tr>
      <tr class="od-glabels"><th class="od-ggap"></th><th class="num${grp(def, 0, 1)}">Allows / G</th><th class="od-ggap"></th><th colspan="${width}" class="num${grp(off, 0, 1)}">${vpStat()[1]} / G</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}
function renderVpMatchup(pools) {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const box = document.getElementById("nvp-matchup");
  box.innerHTML = !away || !home || away === home ? "" : vpSide(away, home, pools) + vpSide(home, away, pools);
}
function renderVpTeams() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const positions = vpStat()[2];
  const key = positions.includes(vpView.sort) || vpView.sort === "team" ? vpView.sort : positions.includes("WR") ? "WR" : positions[0];
  const rows = VP.teams.map((team) => ({ team, g: vpGames(team).length, v: Object.fromEntries(positions.map((p) => [p, vpAllowed(team, p)])) }));
  rows.sort((x, y) => {
    if (key === "team") return x.team.localeCompare(y.team) * -vpView.dir;
    const a = x.v[key], b = y.v[key];
    if (a === b) return x.team.localeCompare(y.team);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a > b ? 1 : -1) * vpView.dir;
  });
  // The game picked leads the list (the NHL page's rule), the rest sorted.
  rows.sort((x, y) => ((y.team === away || y.team === home) - (x.team === away || x.team === home)));
  const arrow = (k) => (key === k ? (vpView.dir < 0 ? " ▼" : " ▲") : "");
  const edge = (i, n) => ` od-g0${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const gapTh = `<th class="od-ggap"></th>`;
  const body = rows.map((r) => `<tr class="${r.team === away || r.team === home ? "nvp-sel" : ""}">
      <td class="od-label">${vpTeam(r.team)}</td><td class="num">${r.g}</td><td class="od-ggap"></td>
      ${positions.map((p, i) => `<td class="num od-cell${edge(i, positions.length)}">${vpDefTile(r.team, p)}</td>`).join("")}
    </tr>`).join("");
  document.getElementById("nvp-teams").innerHTML = `
    <table class="data-table od-grid nvp-all">
      <colgroup><col class="nvp-team-col"><col class="nvp-g-col"><col class="od-ggap-col">${positions.map(() => '<col class="nvp-def-col">').join("")}</colgroup>
      <thead>
        <tr class="od-ggroups"><th rowspan="2" class="od-gone od-label bp-sort${key === "team" ? " bp-sort-on" : ""}" data-sort="team">Team${arrow("team")}</th><th rowspan="2" class="od-gone">G</th>${gapTh}<th colspan="${positions.length}" class="od-g0 od-gl od-gr">${vpStat()[1]} Allowed / G</th></tr>
        <tr class="od-glabels">${gapTh}${positions.map((p, i) => `<th class="num bp-sort${key === p ? " bp-sort-on" : ""}${edge(i, positions.length)}" data-sort="${p}">To ${p}s${arrow(p)}</th>`).join("")}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}
function renderVp() {
  document.getElementById("nvp-stats").innerHTML = VP_STATS.map(([k, label]) => `<button type="button" class="view-toggle-btn${vpView.stat === k ? " active" : ""}" data-stat="${k}">${label}</button>`).join("");
  document.getElementById("nvp-win").value = String(vpView.win);
  if (!VP.teams.length) {
    document.getElementById("nvp-matchup").innerHTML = `<p class="no-data-note">No games yet this season.</p>`;
    document.getElementById("nvp-teams").innerHTML = "";
    return;
  }
  const pools = Object.fromEntries(vpStat()[2].map((p) => [p, vpPlayerPool(p)]));
  renderVpMatchup(pools);
  renderVpTeams();
}

function vpStart() {
  vpBuild();
  document.getElementById("empty-state").hidden = true;
  document.getElementById("nvp-app").hidden = false;
  const options = [...DATA.teams].sort().map((t) => `<option value="${t}">${t}</option>`).join("");
  for (const id of ["away-select", "home-select"]) document.getElementById(id).innerHTML = options;
  initScheduleScroller(renderVp);
  for (const id of ["away-select", "home-select"]) {
    document.getElementById(id).addEventListener("change", () => {
      document.querySelectorAll("#matchup-row .matchup-card").forEach((c) => c.classList.remove("selected"));
      renderVp();
    });
  }
  document.getElementById("nvp-toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-stat]");
    if (!b) return;
    vpView.stat = b.dataset.stat;
    vpSave();
    renderVp();
  });
  document.getElementById("nvp-win").addEventListener("change", (e) => {
    vpView.win = e.target.value;
    vpSave();
    renderVp();
  });
  document.getElementById("nvp-teams").addEventListener("click", (e) => {
    const h = e.target.closest("th[data-sort]");
    if (!h) return;
    if (vpView.sort === h.dataset.sort) vpView.dir = -vpView.dir;
    else {
      vpView.sort = h.dataset.sort;
      vpView.dir = -1;
    }
    vpSave();
    renderVp();
  });
  renderVp();
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    vpStart();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML = "<p>Couldn't load this week's data. Try a refresh.</p>";
    console.error(err);
  });
