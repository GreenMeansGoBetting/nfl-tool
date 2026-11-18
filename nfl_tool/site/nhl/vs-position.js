// ---- GMG NHL Suite: Vs Position ----
// What each defense allows to each skater position (a member, 2026-11-13: "the shots that each team gives
// to each position. LW/C/RW/D"; the owner, 2026-11-17: its own page with a Shots / Goals toggle, and a
// game opens the players in tonight's matchup; 2026-11-18: Points too, one lane per position, and the
// league chart across the top on a computer). The build counts it (build_nhl.py compute_vs_position
// -> data.json vs_position: per team and window [games, C shots, C goals, L ..., R ..., D ..., C points,
// L, R, D]); the page only divides and ranks. A defense is graded from its own side (the owner,
// 2026-11-17, as on the NBA pages): allows the fewest = 1st and green, allows the most = 32nd and red;
// a player with the most = green.

let dayIndex = 0;
let gameId = null;
const VP_KEY = "nhl-tool.vs-position.v1"; // a display pref, kept on this device
const VP_DEFAULT = { stat: "sog", window: "season", sort: "C", today: false };
const vpView = (() => {
  try {
    return { ...VP_DEFAULT, ...JSON.parse(localStorage.getItem(VP_KEY) || "{}") };
  } catch (e) {
    return { ...VP_DEFAULT }; // localStorage unavailable
  }
})();
const vpSave = () => {
  try {
    localStorage.setItem(VP_KEY, JSON.stringify({ stat: vpView.stat, window: vpView.window, today: vpView.today }));
  } catch (e) {
    // localStorage unavailable: the view just won't stick
  }
};
// [box score position, label, name]
const VP_POS = [["C", "C", "Centers"], ["L", "LW", "Left Wings"], ["R", "RW", "Right Wings"], ["D", "D", "Defensemen"]];
const VP_WINDOWS = [["season", "Season", "Every game this season"], ["home", "Home", "The defense's home games"], ["away", "Away", "The defense's road games"], ["10", "Last 10", "The defense's last 10 games"]];
const VP_STATS = [["sog", "Shots"], ["g", "Goals"], ["p", "Points"]];
const VP_LABEL = { sog: "SOG", g: "Goals", p: "Points" };
const VP_WORD = { sog: "shots on goal", g: "goals", p: "points" };
const VP_PLAYER_MIN = 3; // games before a player is colored
const VP_THIN_SHARE = 0.5; // a player with under half his team's games says how many he has
const VP_OUT = (p) => p.status !== "Day-To-Day";
// A computer gets the league chart across the top (teams across, positions down); a phone keeps the tall list.
const VP_WIDE = window.matchMedia("(min-width: 761px)");

const vpWord = () => VP_WORD[vpView.stat];
const vpFmt = (v) => (has(v) ? v.toFixed(vpView.stat === "sog" ? 1 : 2) : "--");
// The defense's number a game at a position (i = VP_POS index), in the picked window, or null.
function vpVal(abbr, i) {
  const row = (((DATA.vs_position || {}).teams || {})[abbr] || {})[vpView.window];
  if (!row || !row[0]) return null;
  const at = vpView.stat === "sog" ? 1 + 2 * i : vpView.stat === "g" ? 2 + 2 * i : 1 + 2 * VP_POS.length + i;
  return has(row[at]) ? row[at] / row[0] : null;
}
const vpGames = (abbr) => ((((DATA.vs_position || {}).teams || {})[abbr] || {})[vpView.window] || [0])[0];
// {team: {r, n}}: 1st = allows the fewest (green), last = allows the most (red)
function vpRanks(i) {
  const vals = Object.keys((DATA.vs_position || {}).teams || {}).map((t) => [t, vpVal(t, i)]).filter(([, v]) => has(v));
  return Object.fromEntries(vals.map(([t, v]) => [t, { r: 1 + vals.filter(([, x]) => x < v).length, n: vals.length }]));
}
const vpTile = (v, rk, tip) => `<div class="od-tile vp-tile"${rk ? cellOnStep(rankStep(rk.r, rk.n)) : ""} title="${tip}"><b>${vpFmt(v)}</b>${rk ? `<small>${ordinal(rk.r)}</small>` : ""}</div>`;
const vpAllowTip = (abbr, i, v, rk) => `${team(abbr).name} allows ${vpFmt(v)} ${vpWord()} a game to ${VP_POS[i][2].toLowerCase()} (${VP_WINDOWS.find((w) => w[0] === vpView.window)[1]}, ${vpGames(abbr)} games)${rk ? `: ${rankWords(rk.n + 1 - rk.r, rk.n)} of ${rk.n} (ranked ${ordinal(rk.r)})` : ""}`;

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
// Each skater's own number a game this season (data.json skaters): shots on goal, goals or points; colored by
// his place among the league's players at his position with VP_PLAYER_MIN+ games (the most = green).
const vpPlayerVal = (p) => (vpView.stat === "sog" ? p.sog_pg : p.games ? p[vpView.stat] / p.games : null);
let vpPeerCache = {};
function vpPeers(pos) {
  const key = `${vpView.stat}:${pos}`;
  if (!vpPeerCache[key]) {
    vpPeerCache[key] = Object.values(DATA.skaters || {}).flat().filter((p) => p.pos === pos && (p.games || 0) >= VP_PLAYER_MIN)
      .map(vpPlayerVal).filter(has).sort((a, b) => b - a);
  }
  return vpPeerCache[key];
}
function vpPlayerTip(p, v, rk, pos, status) {
  const count = vpView.stat === "sog" ? `${has(v) ? v.toFixed(2) : "--"} shots on goal a game in ${p.games} games`
    : `${p[vpView.stat]} ${p[vpView.stat] === 1 ? vpWord().slice(0, -1) : vpWord()} in ${p.games} games (${vpFmt(v)} a game)`;
  return `${p.name}: ${count}${rk ? `, ${rankWords(rk.r, rk.n)} of ${rk.n} ${VP_POS.find((x) => x[0] === pos)[2].toLowerCase()}` : ""}${status ? ` · ${status}` : ""}`;
}
// One tile per player, best first, Out players last. Every tile is the name over the number; the games
// played only show when they matter (under half his team's games), the rest is in the hover.
function vpPlayers(abbr, pos) {
  const out = new Map((DATA.injuries[abbr] || []).filter((p) => p.id).map((p) => [p.id, p.status]));
  const seen = new Set();
  const roster = DATA.skaters[abbr] || [];
  const teamGames = Math.max(0, ...roster.map((p) => p.games || 0));
  return roster.filter((p) => p.pos === pos && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => (out.has(a.id) && VP_OUT({ status: out.get(a.id) })) - (out.has(b.id) && VP_OUT({ status: out.get(b.id) })) || (vpPlayerVal(b) || 0) - (vpPlayerVal(a) || 0))
    .map((p) => {
      const status = out.get(p.id);
      const isOut = status && VP_OUT({ status });
      const v = vpPlayerVal(p);
      const peers = vpPeers(pos);
      const rk = has(v) && (p.games || 0) >= VP_PLAYER_MIN && peers.length ? { r: 1 + peers.filter((x) => x > v).length, n: peers.length } : null;
      const last = p.name.split(" ").slice(1).join(" ") || p.name;
      const note = status ? `<i class="vp-tag">${isOut ? "Out" : "DTD"}</i>` : (p.games || 0) < teamGames * VP_THIN_SHARE ? `<i class="vp-gp">${p.games} GP</i>` : "";
      // Goals and Points: his season total beside the number a game (the owner, 2026-11-18: "0.38 (8)")
      const total = vpView.stat === "sog" ? "" : `<i class="vp-total">(${p[vpView.stat] ?? 0})</i>`;
      return `<div class="od-tile vp-player${isOut ? " vp-out" : ""}"${rk && !isOut ? cellOnStep(rankStep(rk.r, rk.n)) : ""} title="${vpPlayerTip(p, v, rk, pos, status)}"><span class="vp-pname">${playerClick(p.id, last)}</span><span class="vp-pnum"><b>${vpFmt(v)}</b>${total || note}</span>${total && note ? `<span class="vp-pnote">${note}</span>` : ""}</div>`;
    });
}

// ---- one direction of the picked game: the offense big, "vs <DEF> Defense" on the right ----
// One lane per position, read straight across: position, what the defense allows, then the players, never wrapped.
const VP_LANE_LEAD = 104; // the position and Allows columns together
function vpBox(off, def) {
  const lists = VP_POS.map(([pos]) => vpPlayers(off, pos));
  const n = Math.max(1, ...lists.map((l) => l.length));
  const rows = VP_POS.map(([, label], i) => {
    const v = vpVal(def, i);
    const rk = vpRanks(i)[def];
    const cells = lists[i].length
      ? Array.from({ length: n }, (_, k) => `<td class="od-g1 od-gt vp-pcell${k === n - 1 ? " od-gr" : ""}">${lists[i][k] || ""}</td>`).join("")
      : `<td class="od-g1 od-gt od-gr vp-pcell" colspan="${n}"><span class="vp-none">No Players On File</span></td>`;
    return `<tr><td class="od-g3 od-gt od-gl vp-pos">${label}</td><td class="od-g2 od-gt vp-allow">${vpTile(v, rk, vpAllowTip(def, i, v, rk))}</td>${cells}</tr>`;
  }).join("");
  return `<div class="vp-box" style="--vp-w:${VP_LANE_LEAD + n * 70}px;--vp-min:${VP_LANE_LEAD + n * 58}px">${banner(off, `vs ${def} Defense`)}
    <div class="vp-scroll"><table class="data-table od-grid vp-mgrid${vpView.stat === "sog" ? "" : " vp-tall"}"><colgroup><col style="width:38px"><col style="width:66px">${'<col>'.repeat(n)}</colgroup>
    <thead><tr class="od-ggroups"><th class="od-g3 od-gone vp-poshead">Pos</th><th class="od-g2 od-gone vp-allow">${def} Allows</th><th class="od-g1 od-gone vp-lanehead" colspan="${n}"><span>${off} ${VP_LABEL[vpView.stat]} Per Game</span></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

// ---- every team ----
// The teams to list: the picked game's two lead, the rest by the sorted position, the most allowed first.
function vpTeamList() {
  const g = currentGame();
  const top = g ? [g.away, g.home] : [];
  const si = Math.max(0, VP_POS.findIndex((p) => p[0] === vpView.sort));
  const slate = new Set(gamesOn(days()[dayIndex]).flatMap((x) => [x.away, x.home]));
  const teams = Object.keys((DATA.vs_position || {}).teams || {}).filter((t) => vpGames(t) && (!vpView.today || slate.has(t)))
    .sort((a, b) => (vpVal(b, si) ?? -1) - (vpVal(a, si) ?? -1));
  const lead = top.filter((t) => teams.includes(t));
  return { top, lead, rest: teams.filter((t) => !lead.includes(t)), ranks: VP_POS.map((_, i) => vpRanks(i)) };
}
// "Today's Teams Only" follows the day picked above the page.
function vpTodayButton() {
  const date = days()[dayIndex];
  const isToday = date === new Date().toLocaleDateString("en-CA");
  const name = isToday ? "Today's" : `${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}'s`;
  return `<button type="button" class="view-toggle-btn vp-today${vpView.today ? " active" : ""}" data-vp-today aria-pressed="${vpView.today}" title="Only the teams playing on the day picked above">${name} Teams Only</button>`;
}
const vpHeadBand = () => `<div class="vp-snaphead"><span>${VP_LABEL[vpView.stat]} Allowed Per Game</span>${vpTodayButton()}</div>`;
const vpTeamButton = (t, top, size) => `<button type="button" class="vp-logo" data-vp-team="${t}" style="--team:${teamRgb(t)}" title="${team(t).name} (${vpGames(t)} games)${top.includes(t) ? "" : ": show its game on this day"}">${logo(t, size)}<span>${t}</span></button>`;

// A computer: positions down, teams across, one screen-wide snapshot. Click a position to sort by it.
function vpSnapshot() {
  const { top, lead, rest, ranks } = vpTeamList();
  const cols = [...lead, ...(lead.length && rest.length ? [null] : []), ...rest];
  const n = lead.length + rest.length;
  const last = cols[cols.length - 1];
  const edge = (t) => (t === last ? " od-gr" : "");
  const head = `<thead><tr class="od-ggroups"><th class="od-g3 od-gone vp-poshead" rowspan="2">Pos</th><th class="od-g2" colspan="${cols.length || 1}">${vpHeadBand()}</th></tr>
    <tr class="od-glabels">${cols.map((t) => (t ? `<th class="od-g2 od-gt${edge(t)}${top.includes(t) ? " vp-picked" : ""}">${vpTeamButton(t, top, 22)}</th>` : '<th class="od-ggap"></th>')).join("")}</tr></thead>`;
  const rows = VP_POS.map(([pos, label, name], i) => `<tr><td class="od-g3 od-gt od-gl vp-pos vp-sort${pos === vpView.sort ? " vp-sorted" : ""}" data-vp-sort="${pos}" title="${name}: click to sort, the most first">${label}${pos === vpView.sort ? " &#9656;" : ""}</td>
    ${cols.map((t) => {
      if (!t) return '<td class="od-ggap"></td>';
      const v = vpVal(t, i), rk = ranks[i][t];
      return `<td class="od-g2 od-gt${edge(t)}">${vpTile(v, rk, vpAllowTip(t, i, v, rk))}</td>`;
    }).join("")}</tr>`).join("");
  return `<div class="vp-scroll"><table class="data-table od-grid vp-snap" style="--vp-n:${n}"><colgroup><col style="width:44px">${cols.map((t) => (t ? "<col>" : '<col style="width:6px">')).join("")}</colgroup>${head}<tbody>${rows}</tbody></table></div>`;
}

// A phone: the tall list, teams down, positions across.
function vpTable() {
  const { top, lead, rest, ranks } = vpTeamList();
  const head = `<thead><tr class="od-ggroups"><th class="vp-corner" rowspan="2">Team</th><th class="od-ggap" rowspan="2"></th><th class="od-g2" colspan="${VP_POS.length}">${vpHeadBand()}</th></tr>
    <tr class="od-glabels">${VP_POS.map(([pos, label, name], i) => `<th class="od-g2 od-gt${i === 0 ? " od-gl" : ""}${i === VP_POS.length - 1 ? " od-gr" : ""} vp-sort${pos === vpView.sort ? " vp-sorted" : ""}" data-vp-sort="${pos}" title="${name}: click to sort, the most first">${label}${pos === vpView.sort ? " &#9660;" : ""}</th>`).join("")}</tr></thead>`;
  // the picked game's two teams lead (the rest stay in color: this table is read across the league)
  const row = (t) => `<tr class="${top.includes(t) ? "vp-top" : ""}"><td class="vp-team">${vpTeamButton(t, top, 26)}</td><td class="od-ggap"></td>
    ${VP_POS.map((_, i) => {
      const v = vpVal(t, i), rk = ranks[i][t];
      return `<td class="od-g2 od-gt${i === 0 ? " od-gl" : ""}${i === VP_POS.length - 1 ? " od-gr" : ""}">${vpTile(v, rk, vpAllowTip(t, i, v, rk))}</td>`;
    }).join("")}</tr>`;
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
  el("vp-table").innerHTML = (DATA.vs_position || {}).teams ? (VP_WIDE.matches ? vpSnapshot() : vpTable()) : '<p class="no-data-note">Vs Position isn\'t available right now.</p>';
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
  if (e.target.closest("[data-vp-today]")) {
    vpView.today = !vpView.today;
    vpSave();
    return render();
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
// Turning a phone or resizing the window across the line swaps the league chart's layout.
VP_WIDE.addEventListener("change", () => {
  if (!el("vp-app").hidden) render();
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
