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

// Explicit <colgroup> (not th/td nth-child widths) because the header has
// a colspan cell -- table-layout:fixed's column-width algorithm doesn't
// reliably honor per-cell widths once colspan is involved (same issue
// STAT_TABLE_COLGROUP in common.js already documents/works around), which
// is exactly what caused the previous version's header to overhang.
const ROUTE_MAP_COLGROUP =
  '<colgroup><col style="width:90px"><col style="width:50px"><col style="width:62px"><col style="width:58px"><col style="width:58px"></colgroup>';

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

// One row per route: offTeam's own usage share next to defTeam's allowed
// numbers for that EXACT route -- one merged table instead of two separate
// ones, so "what this offense likes to do" and "how this defense handles
// it" read as a single map. Sorted by OFF usage (most-used route first,
// not by defensive vulnerability) since the point is "here's what they'll
// probably do, and here's how it goes against this defense" -- usage
// drives the order, defense numbers just ride along per route.
function renderRouteMapTable(offTeam, defTeam) {
  const sortedRoutes = ROUTE_TYPES.map((route) => ({
    route,
    usage: DATA.team_stats[offTeam][`route_rate_${routeStatKey(route)}`],
  }))
    .filter((r) => r.usage !== null && r.usage !== undefined)
    .sort((a, b) => b.usage - a.usage);

  const rows = sortedRoutes
    .map(({ route, usage }) => {
      const key = routeStatKey(route);
      const usagePool = teamsWithGames()
        .map((t) => DATA.team_stats[t][`route_rate_${key}`])
        .filter((v) => v !== null && v !== undefined);
      const usageCls = percentileTier(usage, usagePool, false);
      const usageAlpha = tierAlphaAttr(usage, usagePool, false);
      return `<tr>
        <td>${ROUTE_LABELS[route] || route}</td>
        <td class="num route-map-off-end ${usageCls}"${usageAlpha}>${Math.round(usage * 100)}%</td>
        ${routeDefenseCell(defTeam, `success_allowed_${key}`, { percent: true, showRank: true })}
        ${routeDefenseCell(defTeam, `yards_allowed_per_target_${key}`, { digits: 1 })}
        ${routeDefenseCell(defTeam, `catch_rate_allowed_${key}`, { percent: true })}
      </tr>`;
    })
    .join("");

  // Team badges live IN the table's own header row (colspan matched to the
  // real columns below them) instead of a separate div above it -- a
  // flex-based header next to a fixed-width table can't guarantee its
  // splits land on the same boundaries as the actual columns, which is
  // exactly what caused the previous version's badges to overhang/misalign
  // (the OFF badge needs to sit ONLY over the Usage column, not half the
  // table). colspan guarantees exact alignment, same technique common.js's
  // headerRow() already uses for every other paired OFF/DEF table.
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<table class="data-table route-map-table">
      ${ROUTE_MAP_COLGROUP}
      <thead>
        <tr><th colspan="2" class="route-map-off-end" style="${offStyle}">${teamLogoMini(offTeam)} ${offTeam}</th><th colspan="3" style="${defStyle}">${teamLogoMini(defTeam)} ${defTeam}</th></tr>
        <tr><th>Route</th><th class="num route-map-off-end">Usage</th><th class="num">Succ%</th><th class="num">Yds/Tgt</th><th class="num">Ctch%</th></tr>
      </thead>
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
      return `<tr>
        <td><div class="player-name">${p.name}</div>${routeChipsHtml(p, oppTeam)}</td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.targets_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_yards_per_g, 1)}</td>
        <td class="num">${p.catch_rate != null ? Math.round(p.catch_rate * 100) + "%" : "--"}</td>
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table props-rec-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Tgt/g</th><th class="num">Rec/g</th><th class="num">Yds/g</th><th class="num">Ctch%</th></tr></thead>
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

  document.getElementById("col-away-receiving").innerHTML = renderReceivingTable(away, home);
  document.getElementById("col-away-routemap").innerHTML = renderRouteMapTable(away, home);
  document.getElementById("col-home-receiving").innerHTML = renderReceivingTable(home, away);
  document.getElementById("col-home-routemap").innerHTML = renderRouteMapTable(home, away);
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
