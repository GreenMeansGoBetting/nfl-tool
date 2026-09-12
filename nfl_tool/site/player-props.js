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
      // The chip's own % is the player's target share (not a league stat),
      // but its COLOR comes from the opponent's success_allowed on this
      // route -- clicking opens the rank modal for that underlying stat,
      // same "every colored square is clickable" convention as the rest
      // of the site.
      const payload = { team: oppTeam, statKey, label: `${label} Success % Allowed`, invert: true, percent: true };
      return `<span class="route-chip ${cls} stat-rank-click" data-entry="${encodeDataAttr(payload)}">${label} ${share}%</span>`;
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

// One cell of the route-defense table: value tiered/shaded against every
// OTHER team's same stat, same invert=true convention as every other
// "allowed" number on the site (lower = better defense = green). The color
// alone carries the worst-to-best signal (also how the table is sorted) --
// an explicit "8/32" rank number sat next to it before and read as
// backwards/confusing (people expect rank 1 = best, not worst), so it's
// color-only now.
function routeDefenseCell(defTeam, statKey, opts = {}) {
  const val = DATA.team_stats[defTeam][statKey];
  if (val === null || val === undefined) return `<td class="num">--</td>`;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t][statKey])
    .filter((v) => v !== null && v !== undefined);
  const cls = percentileTier(val, pool, true);
  const alpha = tierAlphaAttr(val, pool, true);
  const display = opts.percent ? `${Math.round(val * 100)}%` : fmt(val, opts.digits ?? 1);
  return numCell(display, cls, alpha, { team: defTeam, statKey, label: opts.label || statKey, invert: true, percent: !!opts.percent, digits: opts.digits });
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
      const routeLabel = ROUTE_LABELS[route] || route;
      const usageCell = numCell(`${Math.round(usage * 100)}%`, `route-map-off-end ${usageCls}`, usageAlpha, { team: offTeam, statKey: `route_rate_${key}`, label: `${routeLabel} Usage`, invert: false, percent: true });
      return `<tr>
        <td><span class="route-name-click" data-entry="${encodeDataAttr({ team: offTeam, route })}">${routeLabel}</span></td>
        ${usageCell}
        ${routeDefenseCell(defTeam, `success_allowed_${key}`, { percent: true, label: `${routeLabel} Success % Allowed` })}
        ${routeDefenseCell(defTeam, `yards_allowed_per_target_${key}`, { digits: 1, label: `${routeLabel} Yards/Target Allowed` })}
        ${routeDefenseCell(defTeam, `catch_rate_allowed_${key}`, { percent: true, label: `${routeLabel} Catch % Allowed` })}
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
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying pass-catchers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      return `<tr>
        <td><div class="player-name-row"><span class="player-name player-click" data-entry="${encodeDataAttr({ team, name: p.name, oppTeam })}">${p.name}</span>${routeChipsHtml(p, oppTeam)}</div></td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.targets_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_yards_per_g, 1)}</td>
        <td class="num">${p.adot != null ? fmt(p.adot, 1) : "--"}</td>
        <td class="num">${p.yac_per_rec != null ? fmt(p.yac_per_rec, 1) : "--"}</td>
        <td class="num">${p.target_share != null ? Math.round(p.target_share * 100) + "%" : "--"}</td>
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team, true)}
    <table class="data-table props-rec-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Tgt/g</th><th class="num">Rec/g</th><th class="num">Yds/g</th><th class="num">ADOT</th><th class="num">YAC</th><th class="num">Tgt%</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Same 7 lanes as build_stats.py's RUSH_ZONES, left to right the way a
// broadcast angle actually reads them (defense's own left is the offense's
// right, but this follows the OFFENSE's perspective site-wide, same as
// "left"/"right" in run_location itself).
const RUSH_ZONES = [
  { key: "left_end", label: "LE", full: "Left End" },
  { key: "left_tackle", label: "LT", full: "Left Tackle" },
  { key: "left_guard", label: "LG", full: "Left Guard" },
  { key: "middle", label: "M", full: "Middle" },
  { key: "right_guard", label: "RG", full: "Right Guard" },
  { key: "right_tackle", label: "RT", full: "Right Tackle" },
  { key: "right_end", label: "RE", full: "Right End" },
];

// Defense box: this team's own success rate/YPC allowed running into that
// lane, tiered against every other team the same percentile way as every
// other colored cell on the site, and clickable into the league-rank
// modal. Below RUSH_ZONE_MIN_SAMPLE (build_stats.py) there's nothing
// reliable to show or rank, so it renders flat gray instead of a color
// tier or a dead click target.
function defenseLaneCell(team, zone) {
  const successKey = `rush_success_allowed_${zone.key}`;
  const ypcKey = `rush_ypc_allowed_${zone.key}`;
  const val = DATA.team_stats[team][successKey];
  const ypc = DATA.team_stats[team][ypcKey];
  const hasSample = val !== null && val !== undefined;
  let cls = "rush-lane-nosample";
  let clickAttrs = "";
  if (hasSample) {
    const pool = teamsWithGames()
      .map((t) => DATA.team_stats[t][successKey])
      .filter((v) => v !== null && v !== undefined);
    cls = percentileTier(val, pool, true);
    const payload = { team, statKey: successKey, label: `${zone.full} Rush Success % Allowed`, invert: true, percent: true };
    clickAttrs = ` stat-rank-click" data-entry="${encodeDataAttr(payload)}`;
  }
  const display = hasSample ? `${Math.round(val * 100)}%` : "--";
  const ypcDisplay = ypc !== null && ypc !== undefined ? fmt(ypc, 1) : "--";
  return `<div class="rush-lane-box ${cls}${clickAttrs}">
    <span class="rush-lane-label">${zone.label}</span>
    <span class="rush-lane-pct">${display}</span>
    <span class="rush-lane-ypc">${ypcDisplay} YPC</span>
  </div>`;
}

// Offense block, top half: success rate/YPC running into that lane (team's
// own, or via successVal/pool/label overrides, a single player's). Sits
// directly under the defense box above it with no gap -- both halves are
// "how good," meant to read as one connected stack from defense down
// through offense effectiveness.
function offenseSuccessCell(successVal, ypcVal, pool, label, clickPayload) {
  const hasSample = successVal !== null && successVal !== undefined;
  const cls = hasSample ? percentileTier(successVal, pool, false) : "rush-lane-nosample";
  const display = hasSample ? `${Math.round(successVal * 100)}%` : "--";
  const ypcDisplay = ypcVal !== null && ypcVal !== undefined ? fmt(ypcVal, 1) : "--";
  const clickAttrs = hasSample && clickPayload ? ` stat-rank-click" data-entry="${encodeDataAttr(clickPayload)}` : "";
  return `<div class="rush-lane-off-success ${cls}${clickAttrs}">
    <span class="rush-lane-pct">${display}</span>
    <span class="rush-lane-ypc">${ypcDisplay} YPC</span>
  </div>`;
}

// Offense block, bottom half: how often (frequency) -- not a "good/bad"
// rate, so no percentile tier, but shaded in a flat accent blue scaled by
// its own magnitude (darker = more often, lighter = rarely) rather than
// left uncolored, so a glance at shade alone says which lanes actually get
// used. Scale caps at FREQ_SHADE_CAP -- lane shares rarely clear ~35% even
// for a heavily-used lane, so capping there (instead of at the
// mathematical max of 100%) keeps real differences visible instead of
// every lane looking pale.
const FREQ_SHADE_CAP = 0.35;
const FREQ_SHADE_MIN_ALPHA = 0.08;
const FREQ_SHADE_MAX_ALPHA = 0.85;

function offenseFreqCell(freqVal) {
  if (freqVal === null || freqVal === undefined) {
    return `<div class="rush-lane-off-freq"><span class="rush-lane-freq-pct">--</span></div>`;
  }
  const t = Math.min(freqVal / FREQ_SHADE_CAP, 1);
  const alpha = FREQ_SHADE_MIN_ALPHA + t * (FREQ_SHADE_MAX_ALPHA - FREQ_SHADE_MIN_ALPHA);
  const display = `${Math.round(freqVal * 100)}%`;
  return `<div class="rush-lane-off-freq" style="background: rgba(var(--accent-rgb), ${alpha.toFixed(2)})"><span class="rush-lane-freq-pct">${display}</span></div>`;
}

// One lane column: defense box on top, the offense block (success half
// over frequency half) on the bottom -- offense stays on the bottom
// everywhere on this chart, team view and player view alike.
function rushLaneColumn(defBox, offSuccessCell, offFreqCell) {
  return `<div class="rush-lane-col">
    ${defBox}
    <div class="rush-lane-off-block">
      ${offSuccessCell}
      ${offFreqCell}
    </div>
  </div>`;
}

// Same offense block with no defense box above it -- used by the "See All
// Players" modal, where the shared defense row is shown ONCE up top
// instead of once per player. Gets its own rounded-top treatment (the
// normal column relies on the defense box above it for that corner).
function rushLaneColumnStandalone(offSuccessCell, offFreqCell) {
  return `<div class="rush-lane-col">
    <div class="rush-lane-off-block rush-lane-off-block-standalone">
      ${offSuccessCell}
      ${offFreqCell}
    </div>
  </div>`;
}

// A defense box on its own, still wrapped in .rush-lane-col so it stretches
// to the same width as every offense column below it -- .rush-lane-box
// itself has no flex-grow of its own (it relies on .rush-lane-col for
// that), so used bare it shrinks to its content width instead of lining up
// with the (wrapped) offense blocks underneath.
function rushLaneColumnDefenseOnly(defBox) {
  return `<div class="rush-lane-col">${defBox}</div>`;
}

function renderRushLanesChart(offTeam, defTeam) {
  const cols = RUSH_ZONES.map((z) => {
    const successKey = `rush_success_${z.key}`;
    const val = DATA.team_stats[offTeam][successKey];
    const ypc = DATA.team_stats[offTeam][`rush_ypc_${z.key}`];
    const pool = teamsWithGames()
      .map((t) => DATA.team_stats[t][successKey])
      .filter((v) => v !== null && v !== undefined);
    const payload = { team: offTeam, statKey: successKey, label: `${z.full} Rush Success %`, invert: false, percent: true };
    const off = offenseSuccessCell(val, ypc, pool, z.full, payload);
    const freq = offenseFreqCell(DATA.team_stats[offTeam][`rush_rate_${z.key}`]);
    return rushLaneColumn(defenseLaneCell(defTeam, z), off, freq);
  }).join("");
  return `<div class="rush-lanes">
    <div class="rush-lanes-team-tag">${teamLogoMini(defTeam)} ${defTeam} run defense</div>
    <div class="rush-lanes-cols">${cols}</div>
    <div class="rush-lanes-team-tag">${teamLogoMini(offTeam)} ${offTeam} rush offense</div>
  </div>`;
}

// League-wide success-rate pool per lane, built once per modal open (not
// per box) -- every player with a qualifying sample in DATA.player_rush_
// zones, regardless of position. Tiering a back's own lane success against
// this answers "does he actually run well to that side" (vs. the league),
// not just "well relative to his other lanes."
function buildRushZonePools() {
  const pools = {};
  RUSH_ZONES.forEach((z) => (pools[z.key] = []));
  const all = DATA.player_rush_zones || {};
  for (const t of Object.keys(all)) {
    for (const n of Object.keys(all[t])) {
      const zones = all[t][n];
      RUSH_ZONES.forEach((z) => {
        const v = zones[z.key] && zones[z.key].success;
        if (v !== null && v !== undefined) pools[z.key].push(v);
      });
    }
  }
  return pools;
}

// The individual-back complement to renderRushLanesChart's team view: this
// player's own success rate/YPC and usage frequency per lane, paired with
// the SAME opponent-allowed box from the team chart -- "does this back
// like this lane, is he actually good at it, and is this defense's own
// weak side lined up with it." No click-through-to-rank-modal here (a
// single player's number isn't a team to rank against other teams).
function renderPlayerRushLanesContent(team, name, oppTeam) {
  const zones = ((DATA.player_rush_zones || {})[team] || {})[name];
  const heading = `<h3>${name} <span class="muted-label">(${team})</span> &mdash; Rush Lanes</h3>`;
  if (!zones || !oppTeam) {
    return `${heading}<p class="no-data-note">No charted rush attempts for this player yet.</p>`;
  }
  const pools = buildRushZonePools();
  const cols = RUSH_ZONES.map((z) => {
    const zd = zones[z.key] || {};
    const off = offenseSuccessCell(zd.success, zd.ypc, pools[z.key], z.full, null);
    const freq = offenseFreqCell(zd.share);
    return rushLaneColumn(defenseLaneCell(oppTeam, z), off, freq);
  }).join("");
  return `${heading}
    <div class="rush-lanes">
      <div class="rush-lanes-team-tag">${teamLogoMini(oppTeam)} ${oppTeam} run defense</div>
      <div class="rush-lanes-cols">${cols}</div>
      <div class="rush-lanes-team-tag">${name} carries</div>
    </div>`;
}

// ---- "See All Players" rush-lanes modal -- every qualifying rusher on
// one team, at once, against the same opponent defense (shown once at the
// top instead of repeated per player), instead of opening each player's
// own modal one at a time. Its own dedicated modal (not the shared
// props-modal) since it needs to be much wider to fit everyone. ----
function renderTeamRushLanesAllPlayersContent(team, oppTeam) {
  const heading = `<h3>${teamLogoMini(team)} ${TEAM_NAMES[team] || team} Rushers <span class="muted-label">vs ${teamLogoMini(oppTeam)} ${TEAM_NAMES[oppTeam] || oppTeam} Run Defense</span></h3>`;
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.carries >= 5)
    .sort((a, b) => b.carries - a.carries);
  if (!players.length) {
    return `${heading}<p class="no-data-note">No qualifying rushers yet this season.</p>`;
  }
  const pools = buildRushZonePools();
  const defRow = RUSH_ZONES.map((z) => rushLaneColumnDefenseOnly(defenseLaneCell(oppTeam, z))).join("");
  const playerBlocks = players
    .map((p) => {
      const zones = ((DATA.player_rush_zones || {})[team] || {})[p.name] || {};
      const cols = RUSH_ZONES.map((z) => {
        const zd = zones[z.key] || {};
        const off = offenseSuccessCell(zd.success, zd.ypc, pools[z.key], z.full, null);
        const freq = offenseFreqCell(zd.share);
        return rushLaneColumnStandalone(off, freq);
      }).join("");
      return `<div class="rush-lanes-player-block">
        <div class="rush-lanes-team-tag">${p.name} <span class="muted-label">(${p.position})</span></div>
        <div class="rush-lanes-cols">${cols}</div>
      </div>`;
    })
    .join("");
  return `${heading}
    <div class="rush-lanes-team-tag">${teamLogoMini(oppTeam)} ${oppTeam} run defense</div>
    <div class="rush-lanes-cols">${defRow}</div>
    <div class="rush-lanes-all-players">${playerBlocks}</div>`;
}

function ensureRushLanesAllModal() {
  if (document.getElementById("rush-lanes-all-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "rush-lanes-all-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box rush-lanes-all-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="rush-lanes-all-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeRushLanesAllModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeRushLanesAllModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRushLanesAllModal();
  });
}
function closeRushLanesAllModal() {
  const el = document.getElementById("rush-lanes-all-modal");
  if (el) el.hidden = true;
}
function openRushLanesAllModal(team, oppTeam) {
  ensureRushLanesAllModal();
  document.getElementById("rush-lanes-all-modal-content").innerHTML = renderTeamRushLanesAllPlayersContent(team, oppTeam);
  document.getElementById("rush-lanes-all-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".rush-lanes-all-btn");
  if (!btn) return;
  const { team, oppTeam } = decodeDataAttr(btn.dataset.entry);
  openRushLanesAllModal(team, oppTeam);
});

function renderRushingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.carries >= 5)
    .sort((a, b) => b.carries - a.carries)
    .slice(0, 4);
  if (!players.length) {
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying rushers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      const allowedKey = `rush_yards_allowed_${p.position.toLowerCase()}_per_g`;
      return `<tr>
        <td><span class="player-click" data-entry="${encodeDataAttr({ team, name: p.name, oppTeam })}">${p.name}</span></td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.carries_per_g, 1)}</td>
        <td class="num">${fmt(p.rush_yards_per_g, 1)}</td>
        <td class="num">${p.ypc != null ? fmt(p.ypc, 1) : "--"}</td>
        <td class="num">${p.explosive_rush_rate != null ? Math.round(p.explosive_rush_rate * 100) + "%" : "--"}</td>
        <td class="num">${p.rz_carries_per_g != null ? fmt(p.rz_carries_per_g, 1) : "--"}</td>
        ${playerAdvCell(p, oppTeam, "rush_yards_per_g", allowedKey)}
      </tr>`;
    })
    .join("");
  const allPlayersPayload = { team, oppTeam };
  return `<div class="rush-lanes-all-row">${teamBannerHeader(team, true)}<button type="button" class="rush-lanes-all-btn" data-entry="${encodeDataAttr(allPlayersPayload)}">See All Players</button></div>
    <table class="data-table props-rush-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Car/g</th><th class="num">Yds/g</th><th class="num">YPC</th><th class="num">Exp%</th><th class="num">RZ/g</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderPassingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.pass_att >= 10)
    .sort((a, b) => b.pass_att - a.pass_att)
    .slice(0, 2);
  if (!players.length) {
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      return `<tr>
        <td><span class="player-click" data-entry="${encodeDataAttr({ team, name: p.name, oppTeam })}">${p.name}</span></td>
        <td class="num">${fmt(p.pass_att_per_g, 1)}</td>
        <td class="num">${p.comp_pct != null ? Math.round(p.comp_pct * 100) + "%" : "--"}</td>
        <td class="num">${fmt(p.pass_yards_per_g, 1)}</td>
        <td class="num">${fmt(p.int_per_g, 2)}</td>
        ${playerAdvCell(p, oppTeam, "pass_yards_per_g", "pass_yards_allowed_per_g")}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team, true)}
    <table class="data-table props-pass-table">
      <thead><tr><th class="lb-player">Player</th><th class="num">Att/g</th><th class="num">Cmp%</th><th class="num">Yds/g</th><th class="num">INT/g</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Full player-props modal (every market SGO offers, per team header
// click) -- distinct from the anytime-TD odds modal in common.js, since
// this one needs a market dropdown that re-renders in place while staying
// open, rather than one fixed market per click. ----
function ensurePropsModal() {
  if (document.getElementById("props-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "props-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="props-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePropsModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePropsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePropsModal();
  });
}

function closePropsModal() {
  const el = document.getElementById("props-modal");
  if (el) el.hidden = true;
}

// Only markets with an actual posted line for THIS matchup -- a market can
// exist in the site-wide catalog but have zero real book coverage for a
// specific game/week (backup QB, a market the books just haven't priced
// yet), so the dropdown only ever offers markets with real rows.
function availableMarketsFor(awayTeam, homeTeam) {
  const labels = DATA.player_prop_market_labels || {};
  const markets = DATA.player_prop_markets || {};
  return Object.keys(labels).filter((stat) => {
    const m = markets[stat];
    if (!m) return false;
    return (m[awayTeam] || []).length > 0 || (m[homeTeam] || []).length > 0;
  });
}

// Line is the leading/leftmost number (what you're actually betting on),
// Over/Under prices follow -- no book column, since line-shopping across
// books is on the user, not this tool (same reasoning the anytime-TD modal
// already states). Position, not team code, in parens -- the row's own
// team-color border/tint already says which team.
// A single O/U market row is really TWO potential plays (Over and Under),
// so it gets two checkboxes, not one -- built from the same shape both
// the team-header market table and the player-only "All Props" modal use,
// so checking a line in either place shows checked in the other too (same
// id scheme). Week is baked into the id since a market's current line is
// only ever this week's -- an old saved play for the same player/market
// from a prior week shouldn't collide with (or show as checked for) this
// week's line.
function propOuEntries(marketKey, marketLabel, team, name, line, overOdds, underOdds, matchup) {
  const base = { week: scheduleWeek, matchup, category: marketLabel, team };
  return {
    over: { ...base, id: `${scheduleWeek}_${marketKey}_${team}_${name}_over`, description: `${name} Over ${fmt(line, 1)}`, odds: fmtOddsSigned(overOdds) },
    under: { ...base, id: `${scheduleWeek}_${marketKey}_${team}_${name}_under`, description: `${name} Under ${fmt(line, 1)}`, odds: fmtOddsSigned(underOdds) },
  };
}
function ouCheckboxCell(oddsDisplay, entry) {
  const checked = isPossiblePlay(entry.id) ? " checked" : "";
  return `${oddsDisplay} <label class="pp-check-inline" title="Add to Possible Plays"><input type="checkbox" class="pp-toggle" data-entry="${encodeDataAttr(entry)}"${checked}></label>`;
}

function renderPropsMarketTable(awayTeam, homeTeam, market) {
  const marketLabel = (DATA.player_prop_market_labels || {})[market] || market;
  const marketData = (DATA.player_prop_markets || {})[market] || {};
  const matchup = `${awayTeam} @ ${homeTeam}`;
  const rows = [awayTeam, homeTeam]
    .flatMap((t) => (marketData[t] || []).map((p) => ({ ...p, team: t })))
    .sort((a, b) => (b.line || 0) - (a.line || 0));
  if (!rows.length) {
    return `<p class="no-data-note">No lines posted for this market yet.</p>`;
  }
  const body = rows
    .map((p) => {
      const rgb = teamAccentRgb(p.team);
      const rowStyle = `border-left:4px solid rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.07);`;
      const { over, under } = propOuEntries(market, marketLabel, p.team, p.name, p.line, p.over_odds, p.under_odds, matchup);
      return `<tr style="${rowStyle}">
        <td>${teamLogoMini(p.team)} ${p.name} <span class="muted-label">(${p.position || "?"})</span></td>
        <td class="num props-line">${fmt(p.line, 1)}</td>
        <td class="num">${ouCheckboxCell(fmtOddsSigned(p.over_odds), over)}</td>
        <td class="num">${ouCheckboxCell(fmtOddsSigned(p.under_odds), under)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table props-market-table">
    <thead><tr><th>Player</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderPropsModalContent(awayTeam, homeTeam) {
  const matchup = `${awayTeam} @ ${homeTeam}`;
  const markets = availableMarketsFor(awayTeam, homeTeam);
  if (!markets.length) {
    return `<h3>${matchup} &mdash; Player Props</h3><p class="no-data-note">No player prop lines posted for this game yet.</p>`;
  }
  const labels = DATA.player_prop_market_labels || {};
  const selected = markets[0];
  const options = markets.map((m) => `<option value="${m}">${labels[m] || m}</option>`).join("");
  return `<h3>${matchup} &mdash; Player Props</h3>
    <select id="props-market-select" class="props-market-select">${options}</select>
    <div id="props-market-table">${renderPropsMarketTable(awayTeam, homeTeam, selected)}</div>`;
}

// Which game the open modal's market dropdown is showing -- set once when
// the modal opens, read by the dropdown's own change handler so switching
// markets only re-renders the table, not the whole modal (keeps the
// dropdown's own selection/focus intact).
let propsModalTeams = null;

function openPropsModal(awayTeam, homeTeam) {
  ensurePropsModal();
  propsModalTeams = { away: awayTeam, home: homeTeam };
  playerModalState = null;
  document.getElementById("props-modal-content").innerHTML = renderPropsModalContent(awayTeam, homeTeam);
  document.getElementById("props-modal").hidden = false;
}

// The inverse of the team-header modal: every market THIS ONE player has a
// posted line for, instead of every player in one market. Scans the same
// DATA.player_prop_markets catalog by name (SGO player props carry no
// gsis_id to join on, same limitation build_roster_position_lookup already
// works around) -- a handful of players won't match across name-format
// quirks, same known/accepted limitation as roster_teams elsewhere.
function playerPropsAcrossMarkets(team, name) {
  const labels = DATA.player_prop_market_labels || {};
  const markets = DATA.player_prop_markets || {};
  const rows = [];
  for (const stat of Object.keys(labels)) {
    const found = ((markets[stat] || {})[team] || []).find((p) => p.name === name);
    if (found) rows.push({ marketKey: stat, market: labels[stat], ...found });
  }
  return rows;
}

function renderPlayerMarketsModalContent(team, name) {
  const rows = playerPropsAcrossMarkets(team, name);
  const position = rows.length ? rows[0].position : null;
  const heading = `<h3>${name} <span class="muted-label">(${position || "?"} &middot; ${team})</span> &mdash; All Props</h3>`;
  if (!rows.length) {
    return `${heading}<p class="no-data-note">No prop lines posted for this player yet.</p>`;
  }
  const game = (DATA.schedule || []).find((g) => g.week === scheduleWeek && (g.away === team || g.home === team));
  const matchup = game ? `${game.away} @ ${game.home}` : team;
  const body = rows
    .map((r) => {
      const { over, under } = propOuEntries(r.marketKey, r.market, team, name, r.line, r.over_odds, r.under_odds, matchup);
      return `<tr><td>${r.market}</td><td class="num props-line">${fmt(r.line, 1)}</td><td class="num">${ouCheckboxCell(fmtOddsSigned(r.over_odds), over)}</td><td class="num">${ouCheckboxCell(fmtOddsSigned(r.under_odds), under)}</td></tr>`;
    })
    .join("");
  return `${heading}
    <table class="data-table player-odds-table props-market-table">
      <thead><tr><th>Market</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// Which player modal is open and whether it's showing the odds view or the
// game log -- a small toggle bar re-renders just the body in place, same
// "stay open, swap content" pattern as the market-select dropdown above.
let playerModalState = null;

// One stat-type table (Passing/Rushing/Receiving), header + rows straight
// down -- separate tables instead of one row cramming all three together,
// so each stat gets its own labeled column and a QB's passing line doesn't
// need to squeeze next to two columns of "--" for a position that never
// touches the ball as a rusher/receiver most weeks.
function renderGameLogSection(title, headers, rows, rowFn) {
  const headHtml = headers.map((h, i) => `<th${i >= 2 ? ' class="num"' : ""}>${h}</th>`).join("");
  const body = rows
    .map((r) => {
      const cells = rowFn(r);
      return `<tr>${cells.map((c, i) => `<td${i >= 2 ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<div class="game-log-section">
    <h4 class="game-log-section-title">${title}</h4>
    <table class="data-table player-odds-table game-log-table">
      <thead><tr>${headHtml}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function renderPlayerGameLogContent(team, name) {
  const rows = ((DATA.player_game_logs || {})[team] || {})[name] || [];
  const heading = `<h3>${name} <span class="muted-label">(${team})</span> &mdash; Game Log</h3>`;
  if (!rows.length) {
    return `${heading}<p class="no-data-note">No game logs recorded for this player yet.</p>`;
  }

  // Passing only for QBs -- a position, not "did they ever throw one pass"
  // (a wildcat/trick-play completion shouldn't earn a skill player a
  // Passing section). Position comes from the same player_props row this
  // modal's own Odds view is keyed against.
  const position = (DATA.player_props[team] || []).find((p) => p.name === name)?.position;
  const weekCell = (r) => [r.week, `${teamLogoMini(r.opp)} ${r.opp}`];

  const sections = [];
  if (position === "QB") {
    const passRows = rows.filter((r) => r.pass_att > 0);
    if (passRows.length) {
      sections.push(
        renderGameLogSection("Passing", ["Wk", "Opp", "Att", "Cmp", "Yds", "TD", "INT"], passRows, (r) => [
          ...weekCell(r),
          r.pass_att,
          r.completions,
          fmt(r.pass_yards, 0),
          r.pass_td,
          r.interceptions,
        ])
      );
    }
  }
  const rushRows = rows.filter((r) => r.carries > 0);
  if (rushRows.length) {
    sections.push(
      renderGameLogSection("Rushing", ["Wk", "Opp", "Car", "Yds", "TD"], rushRows, (r) => [
        ...weekCell(r),
        r.carries,
        fmt(r.rush_yards, 0),
        r.rush_td,
      ])
    );
  }
  const recRows = rows.filter((r) => r.targets > 0);
  if (recRows.length) {
    sections.push(
      renderGameLogSection("Receiving", ["Wk", "Opp", "Tgt", "Rec", "Yds", "TD"], recRows, (r) => [
        ...weekCell(r),
        r.targets,
        r.receptions,
        fmt(r.rec_yards, 0),
        r.rec_td,
      ])
    );
  }

  if (!sections.length) {
    return `${heading}<p class="no-data-note">No qualifying stat lines recorded for this player yet.</p>`;
  }
  return `${heading}${sections.join("")}`;
}

function renderPlayerModalShell() {
  const { team, name, oppTeam, view } = playerModalState;
  let bodyHtml;
  if (view === "gamelog") bodyHtml = renderPlayerGameLogContent(team, name);
  else if (view === "rushlanes") bodyHtml = renderPlayerRushLanesContent(team, name, oppTeam);
  else bodyHtml = renderPlayerMarketsModalContent(team, name);
  return `<div class="player-modal-toggle">
      <button type="button" class="player-modal-toggle-btn${view === "odds" ? " active" : ""}" data-view="odds">Odds</button>
      <button type="button" class="player-modal-toggle-btn${view === "gamelog" ? " active" : ""}" data-view="gamelog">Game Log</button>
      <button type="button" class="player-modal-toggle-btn${view === "rushlanes" ? " active" : ""}" data-view="rushlanes">Rush Lanes</button>
    </div>
    <div id="player-modal-body">${bodyHtml}</div>`;
}

function openPlayerMarketsModal(team, name, oppTeam) {
  ensurePropsModal();
  propsModalTeams = null; // no market dropdown in this view -- keeps the OTHER change handler from acting on stale state
  playerModalState = { team, name, oppTeam, view: "odds" };
  document.getElementById("props-modal-content").innerHTML = renderPlayerModalShell();
  document.getElementById("props-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest(".player-modal-toggle-btn");
  if (!toggleBtn || !playerModalState) return;
  playerModalState.view = toggleBtn.dataset.view;
  document.getElementById("props-modal-content").innerHTML = renderPlayerModalShell();
});

// Every player on this team with ANY charted targets on this route -- not
// just whoever's top-3 chip happens to show it (a route can be a soft spot
// for the defense without being any single receiver's SIGNATURE route, so
// this is the "who actually runs it, even a little" reference view).
function playersForRoute(team, route) {
  return (DATA.player_props[team] || [])
    .map((p) => {
      const count = (p.routes || {})[route] || 0;
      if (!count) return null;
      const total = Object.values(p.routes || {}).reduce((a, b) => a + b, 0);
      return { name: p.name, position: p.position, count, share: total ? count / total : 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);
}

function renderRouteReceiversModalContent(team, route) {
  const label = ROUTE_LABELS[route] || route;
  const rows = playersForRoute(team, route);
  const heading = `<h3>${label} Routes &mdash; ${team}</h3>`;
  if (!rows.length) {
    return `${heading}<p class="no-data-note">No charted targets on this route for ${team} yet.</p>`;
  }
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.name} <span class="muted-label">(${r.position})</span></td><td class="num">${r.count}</td><td class="num">${Math.round(r.share * 100)}%</td></tr>`
    )
    .join("");
  return `${heading}
    <table class="data-table player-odds-table props-market-table">
      <thead><tr><th>Player</th><th class="num">Targets</th><th class="num">Share</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function openRouteReceiversModal(team, route) {
  ensurePropsModal();
  propsModalTeams = null;
  playerModalState = null;
  document.getElementById("props-modal-content").innerHTML = renderRouteReceiversModalContent(team, route);
  document.getElementById("props-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const playerEl = e.target.closest(".player-click");
  if (playerEl) {
    const { team, name, oppTeam } = decodeDataAttr(playerEl.dataset.entry);
    openPlayerMarketsModal(team, name, oppTeam);
    return;
  }
  const routeEl = e.target.closest(".route-name-click");
  if (routeEl) {
    const { team, route } = decodeDataAttr(routeEl.dataset.entry);
    openRouteReceiversModal(team, route);
    return;
  }
  const btn = e.target.closest(".props-team-click");
  if (!btn) return;
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  if (away && home) openPropsModal(away, home);
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "props-market-select" || !propsModalTeams) return;
  document.getElementById("props-market-table").innerHTML = renderPropsMarketTable(
    propsModalTeams.away,
    propsModalTeams.home,
    e.target.value
  );
});

const ALL_SECTIONS = ["receiving", "rushing", "passing"];

// ---- Receiving/Rushing/Passing tabs -- same view-toggle pattern as TD
// Data's Season/First TD toggle, just three panels instead of two, and all
// three panels live flat (no separate readiness wrapper) since a single
// currentPropsView already covers both "which tab" and "what's visible".
const PROPS_VIEW_KEY = "nfl-tool.props-view.v1";
let currentPropsView = "receiving";

function loadSavedPropsView() {
  try {
    return localStorage.getItem(PROPS_VIEW_KEY) || "receiving";
  } catch (e) {
    return "receiving";
  }
}

function setActivePropsView(view) {
  currentPropsView = view;
  ALL_SECTIONS.forEach((s) => {
    document.getElementById(`section-${s}`).hidden = s !== view;
  });
  document.querySelectorAll(".props-view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  try {
    localStorage.setItem(PROPS_VIEW_KEY, view);
  } catch (e) {
    // localStorage unavailable -- toggle just won't stick across reloads.
  }
}

document.querySelectorAll(".props-view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => setActivePropsView(btn.dataset.view));
});

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = ALL_SECTIONS.map((s) => document.getElementById(`section-${s}`));
  const notesPlaysEl = document.getElementById("section-notes-plays");

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    notesPlaysEl.hidden = true;
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
    notesPlaysEl.hidden = true;
    emptyEl.hidden = false;
    const missing = [!awayReady && away, !homeReady && home].filter(Boolean).join(" and ");
    emptyEl.innerHTML = `<p>${missing} ${missing.includes(" and ") ? "have" : "has"} no games played yet this season.</p>`;
    return;
  }
  emptyEl.hidden = true;
  notesPlaysEl.hidden = false;
  setActivePropsView(currentPropsView);

  document.getElementById("col-away-receiving").innerHTML = renderReceivingTable(away, home);
  document.getElementById("col-away-routemap").innerHTML = renderRouteMapTable(away, home);
  document.getElementById("col-home-receiving").innerHTML = renderReceivingTable(home, away);
  document.getElementById("col-home-routemap").innerHTML = renderRouteMapTable(home, away);
  document.getElementById("col-away-rushing").innerHTML = renderRushingTable(away, home);
  document.getElementById("col-away-rushlanes").innerHTML = renderRushLanesChart(away, home);
  document.getElementById("col-home-rushing").innerHTML = renderRushingTable(home, away);
  document.getElementById("col-home-rushlanes").innerHTML = renderRushLanesChart(home, away);
  document.getElementById("col-away-passing").innerHTML = renderPassingTable(away, home);
  document.getElementById("col-home-passing").innerHTML = renderPassingTable(home, away);

  const notesKey = `${away}_${home}`;
  const savedNote = loadTdNotes()[notesKey] || "";
  document.querySelectorAll(".td-notes-input").forEach((el) => {
    el.value = savedNote;
    el.dataset.key = notesKey;
  });
  renderTdPossiblePlaysList(away, home);
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
    setActivePropsView(loadSavedPropsView());
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening player-props.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
