// Player Props page: volume/efficiency for receiving, rushing, and passing,
// each next to what the OPPONENT allows at that position -- plus a route-
// tree breakdown for pass-catchers (target share by route type, tinted by
// the opponent's allowed success rate on that specific route). Reads the
// same DATA.player_props/team_stats build_stats.py already produces; no
// separate data source from TD Data or Game Previews.

// Same order as build_stats.py's ROUTE_TYPES -- must match exactly, since
// this drives the full route-defense breakdown table (every route, not
// just a player's own top 3). Texas/Angle and Wheel deliberately excluded
// -- thin league-wide volume, rarely anyone's top route.
const ROUTE_TYPES = [
  "SCREEN", "SWING", "QUICK OUT", "SLANT", "HITCH/CURL",
  "SHALLOW CROSS/DRAG", "IN/DIG", "DEEP OUT", "CORNER", "POST", "GO",
];

const ROUTE_LABELS = {
  SCREEN: "Screen",
  SWING: "Swing",
  "QUICK OUT": "Quick Out",
  SLANT: "Slant",
  "HITCH/CURL": "Hitch/Curl",
  "SHALLOW CROSS/DRAG": "Drag",
  "IN/DIG": "Dig",
  "DEEP OUT": "Deep Out",
  CORNER: "Corner",
  POST: "Post",
  GO: "Go/Fly",
};

// Matches build_stats.py's _route_key() exactly -- the route string is the
// join key between a player's own route mix and the opponent's team_stats
// success_allowed_<key> field.
function routeStatKey(route) {
  return route.toLowerCase().replace(/\//g, "_").replace(/ /g, "_");
}

// Top 3 routes by target count, as % share of that player's OWN charted
// targets (not all targets -- route charting only covers the actual
// targeted receiver, see build_stats.py's compute_route_splits).
function topRoutes(routes, n = 3) {
  return Object.entries(routes || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function routeChipsHtml(player, oppTeam) {
  const entries = topRoutes(player.routes);
  if (!entries.length) return "";
  const total = Object.values(player.routes).reduce((a, b) => a + b, 0);
  const chips = entries
    .map(([route, count]) => {
      const share = total ? Math.round((count / total) * 100) : 0;
      const statKey = `success_allowed_${routeStatKey(route)}`;
      const val = DATA.team_stats[oppTeam][statKey];
      let cls = "";
      if (val !== null && val !== undefined) {
        const pool = teamsWithGames()
          .map((t) => DATA.team_stats[t][statKey])
          .filter((v) => v !== null && v !== undefined);
        cls = percentileTier(val, pool, true);
      }
      const label = ROUTE_LABELS[route] || route;
      return `<span class="route-chip ${cls}">${label} ${share}%</span>`;
    })
    .join("");
  return `<div class="player-routes">${chips}</div>`;
}

// Same offense-vs-allowed pairing as every ADV column on the site, just at
// player granularity: the player's own value is z-scored against every
// OTHER qualifying player at the same position league-wide (not all
// players -- a TE's yards/game reads very differently than a WR's), the
// opponent's allowed value is z-scored against every team the normal way.
function playerAdvCell(player, oppTeam, statKey, allowedKey) {
  const val = player[statKey];
  if (val === null || val === undefined || !allowedKey) return `<td class="edge-cell">--</td>`;
  const pool = Object.values(DATA.player_props)
    .flat()
    .filter((p) => p.position === player.position)
    .map((p) => p[statKey])
    .filter((v) => v !== null && v !== undefined);
  const offTier = percentileTier(val, pool, false);
  const offExtreme = percentileTier(val, pool, false, TIER_Z_EXTREME_THRESHOLD);
  const defVal = DATA.team_stats[oppTeam][allowedKey];
  let defTier = "", defExtreme = "";
  if (defVal !== null && defVal !== undefined) {
    const teamPool = teamsWithGames()
      .map((t) => DATA.team_stats[t][allowedKey])
      .filter((v) => v !== null && v !== undefined);
    defTier = percentileTier(defVal, teamPool, true);
    defExtreme = percentileTier(defVal, teamPool, true, TIER_Z_EXTREME_THRESHOLD);
  }
  return edgeCell(offTier, defTier, player.team, oppTeam, offExtreme, defExtreme);
}

// 1 = worst (allows the most/highest value in the pool), last = best --
// "worst to best" ranking so the juiciest matchup route always reads as
// rank 1, matching how the whole table is sorted. null when the value
// itself has no signal (too few charted plays).
function rankWorstToBest(value, pool) {
  if (value === null || value === undefined) return null;
  const sorted = pool.slice().sort((a, b) => b - a);
  return sorted.indexOf(value) + 1;
}

// One cell of the route-defense table: value tiered/shaded against every
// OTHER team's same stat, same invert=true convention as every other
// "allowed" number on the site (lower = better defense = green). showRank
// appends a "(Nth of 32)" worst-to-best rank -- only the primary sort
// column carries it, to keep the row from getting too busy.
function routeDefenseCell(defTeam, statKey, opts = {}) {
  const val = DATA.team_stats[defTeam][statKey];
  if (val === null || val === undefined) return `<td class="num">--</td>`;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t][statKey])
    .filter((v) => v !== null && v !== undefined);
  const cls = percentileTier(val, pool, true);
  const alpha = tierAlphaAttr(val, pool, true);
  const display = opts.percent ? `${Math.round(val * 100)}%` : fmt(val, opts.digits ?? 1);
  const rankHtml = opts.showRank
    ? `<span class="route-rank">${rankWorstToBest(val, pool)}/${pool.length}</span>`
    : "";
  return `<td class="num ${cls}"${alpha}>${display}${rankHtml}</td>`;
}

// Full route-by-route defensive profile for one team -- every route type
// (not just a player's own top 3), so a defense's specific soft spots (e.g.
// "fine everywhere except Hitch/Curl") show up even for a route none of
// the shown players happen to lean on. Meant to sit right next to the
// OPPOSING team's Receiving table (that team's players are the ones who'll
// actually test this profile). Sorted worst-to-best by success rate allowed
// EVERY time (not a fixed route order) -- the point is a scannable "map":
// the softest matchup route is always the first row.
function renderRouteDefenseTable(defTeam) {
  const sortedRoutes = ROUTE_TYPES.slice().sort((a, b) => {
    const va = DATA.team_stats[defTeam][`success_allowed_${routeStatKey(a)}`];
    const vb = DATA.team_stats[defTeam][`success_allowed_${routeStatKey(b)}`];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return vb - va;
  });
  const rows = sortedRoutes.map((route) => {
    const key = routeStatKey(route);
    const label = ROUTE_LABELS[route] || route;
    return `<tr>
      <td>${label}</td>
      ${routeDefenseCell(defTeam, `success_allowed_${key}`, { percent: true, showRank: true })}
      ${routeDefenseCell(defTeam, `yards_allowed_per_target_${key}`, { digits: 1 })}
      ${routeDefenseCell(defTeam, `catch_rate_allowed_${key}`, { percent: true })}
    </tr>`;
  }).join("");
  return `${teamBannerHeader(defTeam)}
    <p class="section-note">How ${defTeam} defends each route, worst matchup first ("--" = too few charted plays yet).</p>
    <table class="data-table route-def-table">
      <thead><tr><th>Route</th><th class="num">Succ%</th><th class="num">Yds/Tgt</th><th class="num">Ctch%</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Team's own OFFENSE route mix -- how much this team leans on each route,
// sorted most- to least-used so the identity reads at a glance. Also
// tinted by how that SAME route's usage compares to the OTHER 31 teams'
// usage of it (not this team's other routes) -- not a good/bad judgment,
// just a "notably more/less than league average" magnitude signal, same
// non-judgmental convention bucketShareTier already uses for offense-side
// shares elsewhere on the site (e.g. TD Position/Distance tables).
function renderRouteUsageTable(team) {
  const rows = ROUTE_TYPES.map((route) => ({
    route,
    rate: DATA.team_stats[team][`route_rate_${routeStatKey(route)}`],
  }))
    .filter((r) => r.rate !== null && r.rate !== undefined)
    .sort((a, b) => b.rate - a.rate)
    .map((r) => {
      const key = `route_rate_${routeStatKey(r.route)}`;
      const pool = teamsWithGames()
        .map((t) => DATA.team_stats[t][key])
        .filter((v) => v !== null && v !== undefined);
      const cls = percentileTier(r.rate, pool, false);
      const alpha = tierAlphaAttr(r.rate, pool, false);
      return `<tr><td>${ROUTE_LABELS[r.route] || r.route}</td><td class="num ${cls}"${alpha}>${Math.round(r.rate * 100)}%</td></tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <p class="section-note">${team}'s own route usage vs. league average for that route, most-used first.</p>
    <table class="data-table route-usage-table">
      <thead><tr><th>Route</th><th class="num">Usage</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderReceivingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.targets >= 5)
    .sort((a, b) => b.targets - a.targets)
    .slice(0, 6);
  if (!players.length) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No qualifying pass-catchers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      const allowedKey = `rec_yards_allowed_${p.position.toLowerCase()}_per_g`;
      return `<tr>
        <td><div class="player-name">${p.name}</div>${routeChipsHtml(p, oppTeam)}</td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.targets_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_yards_per_g, 1)}</td>
        <td class="num">${p.catch_rate != null ? Math.round(p.catch_rate * 100) + "%" : "--"}</td>
        ${playerAdvCell(p, oppTeam, "rec_yards_per_g", allowedKey)}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table props-rec-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Tgt/g</th><th class="num">Rec/g</th><th class="num">Yds/g</th><th class="num">Ctch%</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRushingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.carries >= 5)
    .sort((a, b) => b.carries - a.carries)
    .slice(0, 4);
  if (!players.length) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No qualifying rushers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      const allowedKey = `rush_yards_allowed_${p.position.toLowerCase()}_per_g`;
      return `<tr>
        <td>${p.name}</td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.carries_per_g, 1)}</td>
        <td class="num">${fmt(p.rush_yards_per_g, 1)}</td>
        <td class="num">${p.ypc != null ? fmt(p.ypc, 1) : "--"}</td>
        ${playerAdvCell(p, oppTeam, "rush_yards_per_g", allowedKey)}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table props-rush-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Car/g</th><th class="num">Yds/g</th><th class="num">YPC</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderPassingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.pass_att >= 10)
    .sort((a, b) => b.pass_att - a.pass_att)
    .slice(0, 2);
  if (!players.length) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      return `<tr>
        <td>${p.name}</td>
        <td class="num">${fmt(p.pass_att_per_g, 1)}</td>
        <td class="num">${p.comp_pct != null ? Math.round(p.comp_pct * 100) + "%" : "--"}</td>
        <td class="num">${fmt(p.pass_yards_per_g, 1)}</td>
        <td class="num">${fmt(p.int_per_g, 2)}</td>
        ${playerAdvCell(p, oppTeam, "pass_yards_per_g", "pass_yards_allowed_per_g")}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table props-pass-table">
      <thead><tr><th class="lb-player">Player</th><th class="num">Att/g</th><th class="num">Cmp%</th><th class="num">Yds/g</th><th class="num">INT/g</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const ALL_SECTIONS = ["receiving", "rushing", "passing"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = ALL_SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>Choose both teams above to see player props for this matchup.</p>";
    return;
  }

  const awayStats = DATA.team_stats[away];
  const homeStats = DATA.team_stats[home];
  const awayReady = awayStats && awayStats.games_played > 0;
  const homeReady = homeStats && homeStats.games_played > 0;
  if (!awayReady || !homeReady) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    const missing = [!awayReady && away, !homeReady && home].filter(Boolean).join(" and ");
    emptyEl.innerHTML = `<p>${missing} ${missing.includes(" and ") ? "have" : "has"} no games played yet this season.</p>`;
    return;
  }
  emptyEl.hidden = true;
  sectionEls.forEach((el) => (el.hidden = false));

  document.getElementById("col-away-routeusage").innerHTML = renderRouteUsageTable(away);
  document.getElementById("col-away-receiving").innerHTML = renderReceivingTable(away, home);
  document.getElementById("col-home-routedef").innerHTML = renderRouteDefenseTable(home);
  document.getElementById("col-home-routeusage").innerHTML = renderRouteUsageTable(home);
  document.getElementById("col-home-receiving").innerHTML = renderReceivingTable(home, away);
  document.getElementById("col-away-routedef").innerHTML = renderRouteDefenseTable(away);
  document.getElementById("col-away-rushing").innerHTML = renderRushingTable(away, home);
  document.getElementById("col-home-rushing").innerHTML = renderRushingTable(home, away);
  document.getElementById("col-away-passing").innerHTML = renderPassingTable(away, home);
  document.getElementById("col-home-passing").innerHTML = renderPassingTable(home, away);
}

function populateSelects() {
  const awaySel = document.getElementById("away-select");
  const homeSel = document.getElementById("home-select");
  const opts = DATA.teams
    .slice()
    .sort((a, b) => (TEAM_NAMES[a] || a).localeCompare(TEAM_NAMES[b] || b))
    .map((t) => `<option value="${t}">${TEAM_NAMES[t] || t}</option>`)
    .join("");
  awaySel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  homeSel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  awaySel.addEventListener("change", render);
  homeSel.addEventListener("change", render);
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    populateSelects();
    initScheduleScroller(render);
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening player-props.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
