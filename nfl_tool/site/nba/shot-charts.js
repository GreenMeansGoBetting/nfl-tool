// GMG NBA Suite: Shot Charts. One shooter next to one defense (the owner,
// 2026-10-21: "pick an offensive player and then a defensive team to compare").
// Left: his shots (shot-chart.js, green = he makes more than the league from
// there). Right: every shot that defense allowed, the same zones and heat-map
// spots (red = it allows more than the league from there). Then one table,
// zone by zone, reading both sides. THIS season's shots only (nba/shots.json:
// each shot carries the shooter's team and the defense, from the box score).
// Loads before shot-chart.js / nba-card.js, so it calls their helpers only
// once the page has loaded. Every name here starts with sc / SC_.

let DATA = null; // data.json: teams (names, colors, logos), the schedule; the player card reads it too
let SC_FILE = null; // shots.json
const SC = { player: null, def: null };
const SC_KEY = "nba-tool.shot-charts.v1";

const scEl = (id) => document.getElementById(id);
const scTeam = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const scLogo = (abbr, size = 20) => (abbr && scTeam(abbr).logo ? `<img src="${scTeam(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
function scRgb(abbr) {
  const hex = scTeam(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
const scTitle = (abbr, inner) => `<div class="nba-box-title shc-title" style="background:rgba(${scRgb(abbr)},0.22);border-left:4px solid rgb(${scRgb(abbr)})">${scLogo(abbr, 24)}${inner}</div>`;

// ---- the shots ----
const scTeamIndex = (abbr) => (SC_FILE.teams || []).indexOf(abbr);
const scPlayerShots = (id) => (SC_FILE.players || {})[String(id)] || [];
// Every shot this defense allowed (shot-chart.js, shared with Points' open row).
const scAllowed = (abbr) => nbaShotAllowed(SC_FILE, abbr);
// Players on each team (his latest game's team), most shots first.
function scRosters() {
  const out = {};
  Object.entries(SC_FILE.who || {}).forEach(([id, [name, team]]) => {
    (out[team] = out[team] || []).push({ id, name, n: scPlayerShots(id).length });
  });
  Object.values(out).forEach((list) => list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)));
  return out;
}
const scTeams = () => Object.keys(scRosters()).sort((a, b) => scTeam(a).name.localeCompare(scTeam(b).name));

// The team this team plays next (today or later), from the schedule.
function scNextOpponent(abbr) {
  const today = new Date().toLocaleDateString("en-CA");
  const g = ((DATA && DATA.schedule) || []).filter((x) => x.date >= today && (x.away === abbr || x.home === abbr)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  return g ? (g.away === abbr ? g.home : g.away) : null;
}

// ---- the slate: the day's games, each team its own button (the owner, 2026-10-27:
// click a team, get its roster, the defense it plays fills in) ----
let scDayIndex = 0;
const scDays = () => [...new Set(((DATA && DATA.schedule) || []).map((g) => g.date))].sort();
const scGamesOn = (date) => ((DATA && DATA.schedule) || []).filter((g) => g.date === date).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
function scFirstDay() {
  const all = scDays();
  const today = new Date().toLocaleDateString("en-CA");
  scDayIndex = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
}
function scRenderSlate() {
  const all = scDays();
  const date = all[scDayIndex];
  scEl("schedule-scroller").hidden = !all.length;
  if (!all.length) return;
  const off = SC.player && SC_FILE.who[SC.player] ? SC_FILE.who[SC.player][1] : null;
  scEl("day-label").textContent = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  scEl("day-prev").disabled = scDayIndex <= 0;
  scEl("day-next").disabled = scDayIndex >= all.length - 1;
  const side = (abbr, opp) =>
    `<button type="button" class="shc-slate-team${abbr === off && opp === SC.def ? " selected" : ""}" data-team="${abbr}" data-opp="${opp}" title="${scTeam(abbr).name} shooters vs the ${scTeam(opp).name} defense">${scLogo(abbr, 28)}<span>${abbr}</span></button>`;
  scEl("matchup-row").innerHTML = scGamesOn(date)
    .map((g) => {
      const on = (g.away === off && g.home === SC.def) || (g.home === off && g.away === SC.def);
      return `<div class="matchup-card shc-slate-game${on ? " selected" : ""}">
        <span class="matchup-teams-row">${side(g.away, g.home)}<span class="at">@</span>${side(g.home, g.away)}</span>
        <span class="matchup-date">${gmgGameTime(g, false)}</span>
      </div>`;
    })
    .join("");
  // The offense team's roster, most shots first: one click picks the shooter.
  const roster = off ? scRosters()[off] || [] : [];
  scEl("shc-roster").hidden = !roster.length;
  scEl("shc-roster").innerHTML = `<span class="shc-roster-label">${scLogo(off, 18)}${scTeam(off).short || off} Roster</span>${roster
    .map((p) => `<button type="button" class="shc-roster-btn${p.id === SC.player ? " selected" : ""}" data-player="${p.id}" title="${p.n} shots this season">${p.name}</button>`)
    .join("")}`;
}

// ---- the call: both sides (shot-chart.js nbaShotCall, shared with Points) ----
const scCall = (mine, allowed, lg, share) => nbaShotCall(mine, allowed, lg, share);

// ---- drawing ----
function scSummary(shots, label) {
  const games = new Set(shots.map((s) => s[4])).size;
  const made = shots.reduce((n, s) => n + s[2], 0);
  const threes = shots.filter((s) => s[3]);
  const tm = threes.reduce((n, s) => n + s[2], 0);
  return `<div class="nba-shot-sum shc-sum"><b>${shots.length}</b> ${label} &middot; <b>${games}</b> Game${games === 1 ? "" : "s"} &middot; FG <b>${made}/${shots.length}</b> (${nbaShotPct(made, shots.length)}) &middot; 3PT <b>${tm}/${threes.length}</b> (${nbaShotPct(tm, threes.length)})</div>`;
}
function scChart(shots, opts) {
  if (!shots.length) return `<p class="no-data-note">No shots with these filters.</p>`;
  const league = SC_FILE.league || [];
  const small = shots.length < NBA_SHOT_SMALL ? `<p class="no-data-note">Small sample: ${shots.length} shot${shots.length === 1 ? "" : "s"}.</p>` : "";
  return `${small}<div class="nba-shot-chart shc-chart">${NBA_SHOT_STATE.view === "heat" ? nbaShotHeatView(shots, league, opts) : nbaShotZonesView(shots, league, opts)}</div>`;
}
function scTable(mineShots, allowedShots) {
  const mine = nbaShotZoneTotals(mineShots, false);
  const allowed = nbaShotZoneTotals(allowedShots, false);
  const lg = nbaShotZoneTotals(SC_FILE.league || [], true);
  const lgTotal = Object.values(lg).reduce((n, t) => n + t[1], 0);
  const cell = (t, total, lr, sign) => {
    const [m, a] = t || [0, 0];
    const vs = a && lr !== null ? Math.round((m / a - lr) * 100) : null;
    const tint = a ? ` style="background:${nbaShotColor(sign * nbaShotDiff(m, a, lr), 0.32)}"` : "";
    return `<td class="num shc-split">${a ? `${m}/${a}` : "--"}</td><td class="num"${tint}><b>${nbaShotPct(m, a)}</b></td><td class="num">${vs === null ? "--" : `${vs > 0 ? "+" : ""}${vs}`}</td><td class="num">${total ? `${Math.round((a / total) * 100)}%` : "--"}</td>`;
  };
  const rows = NBA_SHOT_GROUPS.map(([group, zones]) => {
    const body = zones
      .map(([z, name]) => {
        const lr = lg[z] && lg[z][1] ? lg[z][0] / lg[z][1] : null;
        const share = mineShots.length ? ((mine[z] || [0, 0])[1] / mineShots.length) : 0;
        const call = scCall(mine[z], allowed[z], lr, share);
        const tag = call ? `<span class="shc-tag" style="background:${nbaShotColor(call * NBA_SHOT_FULL, 0.3)};border-color:${nbaShotColor(call * NBA_SHOT_FULL, 0.8)}">${call === 1 ? "Target" : "Tough"}</span>` : "";
        const lgShare = lg[z] && lgTotal ? Math.round((lg[z][1] / lgTotal) * 100) : null;
        return `<tr data-zone="${z}"><td>${name}</td>${cell(mine[z], mineShots.length, lr, 1)}${cell(allowed[z], allowedShots.length, lr, -1)}<td class="num shc-lg">${lr === null ? "--" : nbaShotPct(lg[z][0], lg[z][1])}<small>${lgShare === null ? "" : ` ${lgShare}%`}</small></td><td class="shc-call">${tag}</td></tr>`;
      })
      .join("");
    return `<tr class="nba-shot-group"><td colspan="11">${group}</td></tr>${body}`;
  }).join("");
  const who = SC_FILE.who[SC.player] || ["", ""];
  return `<table class="data-table nba-shot-table shc-table"><thead>
    <tr class="shc-head"><th></th><th colspan="4" class="shc-split">${scLogo(who[1], 16)} ${who[0]}</th><th colspan="4" class="shc-split">${scLogo(SC.def, 16)} ${SC.def} Defense Allows</th><th class="shc-split">League</th><th></th></tr>
    <tr><th>Zone</th><th class="num shc-split">FG</th><th class="num">FG%</th><th class="num" title="His make rate minus the league's from the same zone, in points">vs Lg</th><th class="num" title="Share of his shots">Share</th><th class="num shc-split">FG</th><th class="num">FG%</th><th class="num" title="The make rate this defense allows minus the league's, in points (+ = allows more)">vs Lg</th><th class="num" title="Share of the shots it allows">Share</th><th class="num shc-split" title="The league's make rate and share of shots from the zone">FG% Share</th><th>Call</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
}

function scRender() {
  if (!SC_FILE || !SC.player) return;
  const rosters = scRosters();
  const who = SC_FILE.who[SC.player];
  const teams = scTeams();
  scEl("shc-team").innerHTML = teams.map((t) => `<option value="${t}"${t === who[1] ? " selected" : ""}>${scTeam(t).name}</option>`).join("");
  scEl("shc-player").innerHTML = (rosters[who[1]] || []).map((p) => `<option value="${p.id}"${p.id === SC.player ? " selected" : ""}>${p.name} (${p.n})</option>`).join("");
  scEl("shc-def").innerHTML = (SC_FILE.teams || []).slice().sort((a, b) => scTeam(a).name.localeCompare(scTeam(b).name)).map((t) => `<option value="${t}"${t === SC.def ? " selected" : ""}>${scTeam(t).name}</option>`).join("");
  scRenderSlate();
  scEl("shc-controls").innerHTML = nbaShotControls();
  const mine = nbaShotPick(scPlayerShots(SC.player), NBA_SHOT_STATE);
  const allowed = nbaShotPick(scAllowed(SC.def), NBA_SHOT_STATE);
  scEl("shc-off").innerHTML = `${scTitle(who[1], `${playerClick(SC.player, `<span class="shc-name">${who[0]}</span>`)}<span class="shc-sub">Offense</span>`)}<div class="shc-inner">${scSummary(mine, "Shots")}${scChart(mine)}</div>`;
  scEl("shc-defbox").innerHTML = `${scTitle(SC.def, `<span class="shc-name">${scTeam(SC.def).name}</span><span class="shc-sub">Defense &middot; Shots Allowed</span>`)}<div class="shc-inner">${scSummary(allowed, "Shots Allowed")}${scChart(allowed, { allowed: true })}</div>`;
  scEl("shc-table").innerHTML = scTable(mine, allowed);
  scEl("shc-pickers").hidden = false;
  scEl("shc-body").hidden = false;
  scEl("empty-state").hidden = true;
  const hash = `#p=${SC.player}&d=${SC.def}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  try {
    localStorage.setItem(SC_KEY, JSON.stringify(SC));
  } catch (e) {
    // localStorage unavailable -- the pick just won't stick.
  }
}

// Pick a player; the defense follows his team's next opponent unless one is given.
function scPick(id, def) {
  const who = SC_FILE.who[id];
  if (!who) return;
  SC.player = String(id);
  const other = (SC_FILE.teams || []).find((t) => t !== who[1]);
  SC.def = def && def !== who[1] && scTeamIndex(def) >= 0 ? def : scNextOpponent(who[1]) || (SC.def && SC.def !== who[1] ? SC.def : other);
  scRender();
}

// The first pick: the link's #p=&d=, else the last one, else tonight's first game (road team's top shooter vs the home defense).
function scFirstPick() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get("p") && SC_FILE.who[q.get("p")]) return scPick(q.get("p"), q.get("d"));
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SC_KEY) || "null");
  } catch (e) {
    // localStorage unavailable or bad JSON.
  }
  if (saved && SC_FILE.who[saved.player]) return scPick(saved.player, saved.def);
  const rosters = scRosters();
  const today = new Date().toLocaleDateString("en-CA");
  const g = ((DATA && DATA.schedule) || []).filter((x) => x.date >= today && rosters[x.away]).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const team = g ? g.away : scTeams()[0];
  const top = (rosters[team] || [])[0];
  if (top) scPick(top.id, g ? g.home : null);
}

document.addEventListener("change", (e) => {
  if (!SC_FILE) return;
  if (e.target.id === "shc-team") {
    const top = (scRosters()[e.target.value] || [])[0];
    if (top) scPick(top.id);
  } else if (e.target.id === "shc-player") scPick(e.target.value, SC.def);
  else if (e.target.id === "shc-def") {
    SC.def = e.target.value;
    scRender();
  }
});
document.addEventListener("nba-shot-changed", scRender);
document.addEventListener("click", (e) => {
  if (!SC_FILE) return;
  const team = e.target.closest(".shc-slate-team");
  if (team) {
    const top = (scRosters()[team.dataset.team] || [])[0];
    if (top) scPick(top.id, team.dataset.opp);
    return;
  }
  const player = e.target.closest(".shc-roster-btn");
  if (player) return scPick(player.dataset.player, SC.def);
  const all = scDays();
  const step = e.target.closest("#day-prev") ? -1 : e.target.closest("#day-next") ? 1 : 0;
  if (step && all[scDayIndex + step]) {
    scDayIndex += step;
    scRenderSlate();
  }
});
document.addEventListener("click", (e) => {
  const theme = e.target.closest("#theme-toggle");
  if (!theme) return;
  const light = document.documentElement.dataset.theme !== "light";
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
  } catch (err) {
    // localStorage unavailable -- the theme just won't stick.
  }
});

window.addEventListener("load", () => {
  Promise.all([
    fetch("data.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("shots.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([data, file]) => {
    DATA = data || { teams: {}, schedule: [] };
    SC_FILE = file;
    if (!file || !Object.keys(file.who || {}).length) {
      scEl("empty-state").innerHTML = `<p>${file ? "No shots this season yet." : "Shot charts aren't available right now."}</p>`;
      return;
    }
    scFirstDay();
    scFirstPick();
  });
});
