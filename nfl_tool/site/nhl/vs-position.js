// ---- GMG NHL Suite: Vs Position ----
// What each defense allows to each skater position (a member, 2026-11-13: "the shots that each team gives
// to each position. LW/C/RW/D"; the owner, 2026-11-17: its own page with a Shots / Goals toggle, and a
// game opens the players in tonight's matchup). The build counts it (build_nhl.py compute_vs_position
// -> data.json vs_position: per team and window [games, C shots, C goals, L ..., R ..., D ...]); the
// page only divides and ranks. Colors from the shooter's view like every NHL page (nhl.md): the
// defense that allows the most = green, the fewest = red; a player with the most = green.

let dayIndex = 0;
let gameId = null;
const VP_KEY = "nhl-tool.vs-position.v1"; // a display pref, kept on this device
const VP_DEFAULT = { stat: "sog", window: "season", sort: "C" };
const vpView = (() => {
  try {
    return { ...VP_DEFAULT, ...JSON.parse(localStorage.getItem(VP_KEY) || "{}") };
  } catch (e) {
    return { ...VP_DEFAULT }; // localStorage unavailable
  }
})();
const vpSave = () => {
  try {
    localStorage.setItem(VP_KEY, JSON.stringify({ stat: vpView.stat, window: vpView.window }));
  } catch (e) {
    // localStorage unavailable: the view just won't stick
  }
};
// [box score position, label, name]
const VP_POS = [["C", "C", "Centers"], ["L", "LW", "Left Wings"], ["R", "RW", "Right Wings"], ["D", "D", "Defensemen"]];
const VP_WINDOWS = [["season", "Season", "Every game this season"], ["home", "Home", "The defense's home games"], ["away", "Away", "The defense's road games"], ["10", "Last 10", "The defense's last 10 games"]];
const VP_STATS = [["sog", "Shots"], ["g", "Goals"]];
const VP_PLAYER_MIN = 3; // games before a player is colored
const VP_OUT = (p) => p.status !== "Day-To-Day";

const vpWord = () => (vpView.stat === "g" ? "goals" : "shots on goal");
const vpFmt = (v) => (has(v) ? v.toFixed(vpView.stat === "g" ? 2 : 1) : "--");
// The defense's number a game at a position (i = VP_POS index), in the picked window, or null.
function vpVal(abbr, i) {
  const row = (((DATA.vs_position || {}).teams || {})[abbr] || {})[vpView.window];
  if (!row || !row[0]) return null;
  return row[1 + 2 * i + (vpView.stat === "g" ? 1 : 0)] / row[0];
}
const vpGames = (abbr) => ((((DATA.vs_position || {}).teams || {})[abbr] || {})[vpView.window] || [0])[0];
// {team: {r, n}}: 1st = allows the most (green)
function vpRanks(i) {
  const vals = Object.keys((DATA.vs_position || {}).teams || {}).map((t) => [t, vpVal(t, i)]).filter(([, v]) => has(v));
  return Object.fromEntries(vals.map(([t, v]) => [t, { r: 1 + vals.filter(([, x]) => x > v).length, n: vals.length }]));
}
const vpTile = (v, rk, tip) => `<div class="od-tile vp-tile"${rk ? cellOnStep(rankStep(rk.r, rk.n)) : ""} title="${tip}"><b>${vpFmt(v)}</b>${rk ? `<small>${ordinal(rk.r <= rk.n / 2 ? rk.r : rk.n + 1 - rk.r)} ${rk.r <= rk.n / 2 ? "Most" : "Fewest"}</small>` : ""}</div>`;
const vpAllowTip = (abbr, i, v, rk) => `${team(abbr).name} allows ${vpFmt(v)} ${vpWord()} a game to ${VP_POS[i][2].toLowerCase()} (${VP_WINDOWS.find((w) => w[0] === vpView.window)[1]}, ${vpGames(abbr)} games)${rk ? `: ${rankWords(rk.r, rk.n)} of ${rk.n}` : ""}`;

// ---- schedule ----
function days() {
  return [...new Set(DATA.schedule.map((g) => g.date))].sort();
}
function gamesOn(date) {
  return DATA.schedule.filter((g) => g.date === date);
}
function currentGame() {
  return DATA.schedule.find((g) => g.game_id === gameId) || null;
}
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date).map((g) => {
    const final = g.status === "final";
    return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}" title="Show this game's players (click again to close)">
      <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
      <span class="matchup-date">${final ? "Final" : fmtTime(g, false)}</span></button>`;
  }).join("");
}

// ---- tonight's players at a position ----
// Each skater's own number this season (data.json skaters): shots on goal a game, or goals; colored by his
// place among the league's players at his position with VP_PLAYER_MIN+ games (the most = green).
const vpPlayerVal = (p) => (vpView.stat === "g" ? (p.games ? p.g / p.games : null) : p.sog_pg);
let vpPeerCache = {};
function vpPeers(pos) {
  const key = `${vpView.stat}:${pos}`;
  if (!vpPeerCache[key]) {
    vpPeerCache[key] = Object.values(DATA.skaters || {}).flat().filter((p) => p.pos === pos && (p.games || 0) >= VP_PLAYER_MIN)
      .map(vpPlayerVal).filter(has).sort((a, b) => b - a);
  }
  return vpPeerCache[key];
}
function vpPlayers(abbr, pos) {
  const out = new Map((DATA.injuries[abbr] || []).filter((p) => p.id).map((p) => [p.id, p.status]));
  const seen = new Set();
  return (DATA.skaters[abbr] || []).filter((p) => p.pos === pos && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => (out.has(a.id) && VP_OUT({ status: out.get(a.id) })) - (out.has(b.id) && VP_OUT({ status: out.get(b.id) })) || (vpPlayerVal(b) || 0) - (vpPlayerVal(a) || 0))
    .map((p) => {
      const status = out.get(p.id);
      const isOut = status && VP_OUT({ status });
      const v = vpPlayerVal(p);
      const peers = vpPeers(pos);
      const rk = has(v) && (p.games || 0) >= VP_PLAYER_MIN && peers.length ? { r: 1 + peers.filter((x) => x > v).length, n: peers.length } : null;
      const big = vpView.stat === "g" ? `${p.g}` : has(v) ? v.toFixed(1) : "--";
      const small = vpView.stat === "g" ? `G · ${p.games} GP` : `SOG/G · ${p.games} GP`;
      const last = p.name.split(" ").slice(1).join(" ") || p.name;
      const tip = `${p.name}: ${vpView.stat === "g" ? `${p.g} goals in ${p.games} games` : `${has(v) ? v.toFixed(2) : "--"} shots on goal a game in ${p.games} games`}${rk ? `, ${rankWords(rk.r, rk.n)} of ${rk.n} ${VP_POS.find((x) => x[0] === pos)[2].toLowerCase()}` : ""}${status ? ` · ${status}` : ""}`;
      return `<div class="od-tile vp-player${isOut ? " vp-out" : ""}"${rk && !isOut ? cellOnStep(rankStep(rk.r, rk.n)) : ""} title="${tip}"><span class="vp-pname">${playerClick(p.id, last)}${status ? `<i class="vp-tag">${isOut ? "Out" : "DTD"}</i>` : ""}</span><b>${big}</b><small>${small}</small></div>`;
    }).join("");
}

// ---- one direction of the picked game: the offense big, "vs <DEF> Defense" on the right ----
function vpBox(off, def) {
  const rows = VP_POS.map(([pos, label], i) => {
    const v = vpVal(def, i);
    const rk = vpRanks(i)[def];
    const players = vpPlayers(off, pos);
    return `<tr><td class="od-label vp-pos">${label}</td>
      <td class="od-g2 od-gt od-gl od-gr">${vpTile(v, rk, vpAllowTip(def, i, v, rk))}</td><td class="od-ggap"></td>
      <td class="od-g1 od-gt od-gl od-gr vp-pcell"><div class="vp-plist">${players || '<span class="vp-none">No Players On File</span>'}</div></td></tr>`;
  }).join("");
  return `<div class="vp-box">${banner(off, `vs ${def} Defense`)}
    <table class="data-table od-grid vp-mgrid"><colgroup><col style="width:44px"><col style="width:76px"><col style="width:6px"><col></colgroup>
    <thead><tr class="od-ggroups"><th></th><th class="od-g2 od-gone">${def} Allows</th><th class="od-ggap"></th><th class="od-g1 od-gone">${off} ${vpView.stat === "g" ? "Goals" : "Shots On Goal"}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---- every team ----
function vpTable() {
  const g = currentGame();
  const top = g ? [g.away, g.home] : [];
  const ranks = VP_POS.map((_, i) => vpRanks(i));
  const si = Math.max(0, VP_POS.findIndex((p) => p[0] === vpView.sort));
  const teams = Object.keys((DATA.vs_position || {}).teams || {}).filter((t) => vpGames(t))
    .sort((a, b) => (vpVal(b, si) ?? -1) - (vpVal(a, si) ?? -1));
  const head = `<thead><tr class="od-ggroups"><th class="vp-corner" rowspan="2">Team</th><th class="od-ggap" rowspan="2"></th><th class="od-g2" colspan="${VP_POS.length}">${vpView.stat === "g" ? "Goals" : "Shots On Goal"} Allowed A Game</th></tr>
    <tr class="od-glabels">${VP_POS.map(([pos, label, name], i) => `<th class="od-g2 od-gt${i === 0 ? " od-gl" : ""}${i === VP_POS.length - 1 ? " od-gr" : ""} vp-sort${pos === vpView.sort ? " vp-sorted" : ""}" data-vp-sort="${pos}" title="${name}: click to sort, the most first">${label}${pos === vpView.sort ? " &#9660;" : ""}</th>`).join("")}</tr></thead>`;
  // the picked game's two teams lead (the rest stay in color: this table is read across the league)
  const row = (t) => `<tr class="${top.includes(t) ? "vp-top" : ""}"><td class="vp-team"><button type="button" class="vp-logo" data-vp-team="${t}" style="--team:${teamRgb(t)}" title="${team(t).name} (${vpGames(t)} games)${top.includes(t) ? "" : ": show its game on this day"}">${logo(t, 26)}<span>${t}</span></button></td><td class="od-ggap"></td>
    ${VP_POS.map((_, i) => {
      const v = vpVal(t, i), rk = ranks[i][t];
      return `<td class="od-g2 od-gt${i === 0 ? " od-gl" : ""}${i === VP_POS.length - 1 ? " od-gr" : ""}">${vpTile(v, rk, vpAllowTip(t, i, v, rk))}</td>`;
    }).join("")}</tr>`;
  const lead = top.filter((t) => teams.includes(t));
  const rest = teams.filter((t) => !lead.includes(t));
  return `<table class="data-table od-grid vp-grid"><colgroup><col style="width:84px"><col style="width:6px">${VP_POS.map(() => '<col style="width:66px">').join("")}</colgroup>${head}
    <tbody>${lead.map(row).join("")}${lead.length ? `<tr class="vp-spacer"><td colspan="${2 + VP_POS.length}"></td></tr>` : ""}${rest.map(row).join("")}</tbody></table>`;
}

function renderControls() {
  const seg = (attr, list, on) => `<div class="pt-seg vp-seg">${list.map(([k, name, tip]) => `<button type="button" class="view-toggle-btn${k === on ? " active" : ""}" ${attr}="${k}"${tip ? ` title="${tip}"` : ""}>${name}</button>`).join("")}</div>`;
  el("vp-bar").innerHTML = seg("data-vp-stat", VP_STATS, vpView.stat) + seg("data-vp-window", VP_WINDOWS, vpView.window);
}
function render() {
  renderSchedule();
  renderControls();
  const g = currentGame();
  el("vp-matchup").innerHTML = g ? `<div class="vp-two">${vpBox(g.away, g.home)}${vpBox(g.home, g.away)}</div>` : "";
  el("vp-table").innerHTML = (DATA.vs_position || {}).teams ? vpTable() : '<p class="no-data-note">Vs Position isn\'t available right now.</p>';
}

function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  gameId = null;
  render();
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".player-click")) return;
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    return render();
  }
  const t = e.target.closest("[data-vp-team]");
  if (t) {
    const g = gamesOn(days()[dayIndex]).find((x) => [x.away, x.home].includes(t.dataset.vpTeam));
    if (g) {
      gameId = g.game_id;
      render();
      el("vp-matchup").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  const sort = e.target.closest("[data-vp-sort]");
  if (sort) {
    vpView.sort = sort.dataset.vpSort;
    return render();
  }
  const stat = e.target.closest("[data-vp-stat]");
  const win = e.target.closest("[data-vp-window]");
  if (stat || win) {
    if (stat) vpView.stat = stat.dataset.vpStat;
    if (win) vpView.window = win.dataset.vpWindow;
    vpPeerCache = {};
    vpSave();
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
});

loadNhlData()
  .then(() => {
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    const day = all.find((d) => d >= today) || all[all.length - 1];
    el("empty-state").hidden = true;
    el("vp-app").hidden = false;
    dayIndex = Math.max(0, all.indexOf(day));
    const first = gamesOn(all[dayIndex]).find((g) => g.status !== "final") || gamesOn(all[dayIndex])[0];
    gameId = first ? first.game_id : null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
