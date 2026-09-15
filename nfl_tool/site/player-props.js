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
// modal. No sample floor -- build_stats.py returns a number as soon as
// there's at least one play, so the carry count is shown right alongside
// it (n=2 reads very differently than n=20) instead of hiding thin lanes
// outright.
function defenseLaneCell(team, zone) {
  const successKey = `rush_success_allowed_${zone.key}`;
  const ypcKey = `rush_ypc_allowed_${zone.key}`;
  const val = DATA.team_stats[team][successKey];
  const ypc = DATA.team_stats[team][ypcKey];
  const n = DATA.team_stats[team][`rush_carries_allowed_${zone.key}`] || 0;
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
    <span class="rush-lane-n">n=${n}</span>
  </div>`;
}

// Offense block, top half: success rate/YPC running into that lane (team's
// own, or via successVal/pool/label overrides, a single player's). Sits
// directly under the defense box above it with no gap -- both halves are
// "how good," meant to read as one connected stack from defense down
// through offense effectiveness. carries is shown alongside the rate for
// the same reason as defenseLaneCell -- no sample floor upstream anymore,
// so the reader judges thin samples themselves instead of them being hidden.
function offenseSuccessCell(successVal, ypcVal, pool, label, clickPayload, carries) {
  const hasSample = successVal !== null && successVal !== undefined;
  const cls = hasSample ? percentileTier(successVal, pool, false) : "rush-lane-nosample";
  const display = hasSample ? `${Math.round(successVal * 100)}%` : "--";
  const ypcDisplay = ypcVal !== null && ypcVal !== undefined ? fmt(ypcVal, 1) : "--";
  const clickAttrs = hasSample && clickPayload ? ` stat-rank-click" data-entry="${encodeDataAttr(clickPayload)}` : "";
  const nDisplay = carries !== null && carries !== undefined ? `<span class="rush-lane-n">n=${carries}</span>` : "";
  return `<div class="rush-lane-off-success ${cls}${clickAttrs}">
    <span class="rush-lane-pct">${display}</span>
    <span class="rush-lane-ypc">${ypcDisplay} YPC</span>
    ${nDisplay}
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
    const off = offenseSuccessCell(val, ypc, pool, z.full, payload, DATA.team_stats[offTeam][`rush_carries_${z.key}`]);
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
    const off = offenseSuccessCell(zd.success, zd.ypc, pools[z.key], z.full, null, zd.carries);
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
  // No minimum carries to appear here anymore -- every rush lane cell
  // already shows its own carry count (n=X), so a one-carry back is
  // visibly thin rather than hidden outright.
  const players = (DATA.player_props[team] || []).filter((p) => p.carries > 0).sort((a, b) => b.carries - a.carries);
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
        const off = offenseSuccessCell(zd.success, zd.ypc, pools[z.key], z.full, null, zd.carries);
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

// League-wide pool of every qualifying QB's season-total value for ONE
// Player Props stat (e.g. every QB's EPA/Att) -- same position-scoped
// pool playerAdvCell already builds for its own tiering, just reused here
// for a plain (non-paired) cell instead of an offense-vs-defense edge.
function passStatPool(statKey) {
  return Object.values(DATA.player_props)
    .flat()
    .filter((p) => p.position === "QB")
    .map((p) => p[statKey])
    .filter((v) => v !== null && v !== undefined);
}

// One season-total passing stat, tiered against every other qualifying QB
// and clickable into openPlayerStatRankModal's full QB leaderboard for
// that exact stat -- same "every colored cell opens its own leaderboard"
// convention as the Coverage & Pressure panel above, just for the
// season-long numbers instead of a zone/man/pressure/clean split.
function passStatCell(player, statKey, opts = {}) {
  const value = player[statKey];
  if (value === null || value === undefined) return `<td class="num">--</td>`;
  const pool = passStatPool(statKey);
  const invert = !!opts.invert;
  const cls = percentileTier(value, pool, invert);
  const alpha = tierAlphaAttr(value, pool, invert);
  const display = opts.percent ? `${Math.round(value * 100)}%` : fmt(value, opts.digits ?? 1);
  const payload = {
    team: player.team, name: player.name, statKey, label: opts.label,
    invert, percent: !!opts.percent, digits: opts.digits,
  };
  return `<td class="num ${cls} player-stat-rank-click"${alpha} data-entry="${encodeDataAttr(payload)}">${display}</td>`;
}

// Every qualifying QB's value for one season-total Player Props stat,
// sorted best to worst (invert=true sorts ascending -- e.g. INT/g, where
// lower is better). Same shell/highlight convention as
// openPassSplitRankModal, just sourced from DATA.player_props instead of
// DATA.player_pass_splits.
function openPlayerStatRankModal(p) {
  ensureStatRankModal();
  const rows = [];
  for (const [team, players] of Object.entries(DATA.player_props)) {
    for (const pl of players) {
      if (pl.position !== "QB") continue;
      const val = pl[p.statKey];
      if (val === null || val === undefined) continue;
      rows.push({ team, name: pl.name, value: val });
    }
  }
  rows.sort((a, b) => (p.invert ? a.value - b.value : b.value - a.value));
  const values = rows.map((r) => r.value);
  const display = (v) => (p.percent ? `${Math.round(v * 100)}%` : fmt(v, p.digits ?? 1));
  const body = rows
    .map((r) => {
      const cls = percentileTier(r.value, values, !!p.invert);
      const alpha = tierAlphaAttr(r.value, values, !!p.invert);
      const rowCls = r.team === p.team && r.name === p.name ? ' class="stat-rank-current"' : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${r.name}</td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${p.label} &mdash; All QBs</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Player</th><th class="num">${p.label}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".player-stat-rank-click");
  if (!cell) return;
  openPlayerStatRankModal(decodeDataAttr(cell.dataset.entry));
});

// ---- Backup-QB visibility toggle (Passing tab) ----
// Off by default: only the team's top passer by volume shows up across
// the Passing table, Coverage & Pressure, and QB Rushing panels -- a
// clipboard-holder who threw 11 garbage-time passes cluttered all three
// otherwise. On, it reverts to showing up to 2 qualifying passers (the
// original behavior), for the rare case a real QB competition is
// happening. Persisted the same try/catch localStorage pattern as
// PROPS_VIEW_KEY above.
const SHOW_BACKUP_QBS_KEY = "nfl-tool.show-backup-qbs.v1";
let showBackupQbs = false;

function loadShowBackupQbs() {
  try {
    return localStorage.getItem(SHOW_BACKUP_QBS_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function setShowBackupQbs(value) {
  showBackupQbs = value;
  try {
    localStorage.setItem(SHOW_BACKUP_QBS_KEY, value ? "1" : "0");
  } catch (e) {
    // localStorage unavailable -- toggle just won't stick across reloads.
  }
}

// Every render function on this tab that lists passers pulls from this
// one place, so the toggle only has to be handled once.
function qualifyingPassers(team) {
  const all = (DATA.player_props[team] || [])
    .filter((p) => p.pass_att >= 10)
    .sort((a, b) => b.pass_att - a.pass_att);
  return showBackupQbs ? all.slice(0, 2) : all.slice(0, 1);
}

function renderPassingTable(team, oppTeam) {
  const players = qualifyingPassers(team);
  if (!players.length) {
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      return `<tr>
        <td><span class="player-click" data-entry="${encodeDataAttr({ team, name: p.name, oppTeam })}">${p.name}</span></td>
        ${passStatCell(p, "pass_att_per_g", { label: "Pass Attempts/Game" })}
        ${passStatCell(p, "comp_pct", { label: "Completion %", percent: true })}
        ${passStatCell(p, "pass_yards_per_g", { label: "Passing Yards/Game" })}
        ${passStatCell(p, "int_per_g", { label: "Interceptions/Game", digits: 2, invert: true })}
        ${passStatCell(p, "epa_per_att", { label: "EPA per Attempt", digits: 2 })}
        ${passStatCell(p, "adot_thrown", { label: "Average Depth of Target" })}
        ${playerAdvCell(p, oppTeam, "pass_yards_per_g", "pass_yards_allowed_per_g")}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team, true)}
    <table class="data-table props-pass-table">
      <thead><tr><th class="lb-player">Player</th><th class="num">Att/g</th><th class="num">Cmp%</th><th class="num">Yds/g</th><th class="num">INT/g</th><th class="num">EPA/Att</th><th class="num">aDOT</th><th class="edge-hdr">ADV</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Coverage & Pressure (Passing tab) ----
// Per-QB complement to compute_scheme_splits' team-level zone/man/blitz/
// pressure numbers (build_stats.py's compute_player_pass_splits): how THIS
// passer performs in each condition, next to how often the opponent shows
// it (team_stats tendency, neutral -- no color judgment on frequency alone,
// same reasoning as Game Overview's Scheme & Tendencies table) and what
// that defense allows in it (team_stats def_success_allowed_*, feeds the
// ADV cell same as every other offense/defense pairing on the site).
// Zone/Man rows were dropped along with build_stats.py's compute_scheme_
// splits/compute_player_pass_splits coverage-type data -- no live-during-
// season source exists for it (see that docstring). Pressured/Clean
// Pocket are still real: a sack-or-QB-hit proxy computed from plain pbp.
const PASS_SPLIT_ROWS = [
  { key: "pressure", label: "Pressured", tendKey: "pressure_rate", tendLabel: "Pressure Rate", defAllowedKey: "def_success_allowed_pressure" },
  { key: "clean", label: "Clean Pocket", tendKey: "clean_pocket_rate", tendLabel: "Clean Pocket Rate", defAllowedKey: "def_success_allowed_clean_pocket" },
];

// League-wide pool of every qualifying QB's value for ONE stat in ONE
// condition (e.g. every QB's success% vs zone, or every QB's YPA vs
// pressure) -- the percentile context for tiering a single QB's own
// number, same role playerAdvCell's pool plays for the season-long stats.
function passSplitPool(condition, stat) {
  return Object.values(DATA.player_pass_splits || {})
    .flatMap((players) => Object.values(players))
    .map((c) => c[condition]?.[stat])
    .filter((v) => v !== null && v !== undefined);
}

// Any QB performance number in a split (comp%, YPA, success%) -- higher is
// always better for all three, so invert is always false here. Clickable
// into openPassSplitRankModal (every qualifying QB's value for this exact
// stat+condition), same "every colored cell opens its own leaderboard"
// convention as the rest of the site -- just a per-QB leaderboard instead
// of the usual per-team one, since compute_scheme_splits' team-shaped
// rank modal (openStatRankModal/statRankGetter) has no notion of a player.
function passSplitRateCell(value, pool, payload) {
  if (value === null || value === undefined) return `<td class="num">--</td>`;
  const cls = percentileTier(value, pool, false);
  const alpha = tierAlphaAttr(value, pool, false);
  const display = payload.percent ? `${Math.round(value * 100)}%` : fmt(value, payload.digits ?? 1);
  return `<td class="num ${cls} pass-split-rank-click"${alpha} data-entry="${encodeDataAttr(payload)}">${display}</td>`;
}

// Every qualifying QB's value for one exact stat+condition (e.g. every
// QB's Success % vs Zone), sorted best to worst -- the player-level
// counterpart to common.js's openStatRankModal, reusing the same overlay/
// close-button chrome (ensureStatRankModal) since the shell is identical,
// just a different row source (every (team, name) in player_pass_splits
// instead of every team in team_stats).
function openPassSplitRankModal(p) {
  ensureStatRankModal();
  const rows = [];
  for (const [t, players] of Object.entries(DATA.player_pass_splits || {})) {
    for (const [name, splits] of Object.entries(players)) {
      const val = splits[p.condition]?.[p.stat];
      if (val === null || val === undefined) continue;
      rows.push({ team: t, name, value: val });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  const values = rows.map((r) => r.value);
  const display = (v) => (p.percent ? `${Math.round(v * 100)}%` : fmt(v, p.digits ?? 1));
  const body = rows
    .map((r) => {
      const cls = percentileTier(r.value, values, false);
      const alpha = tierAlphaAttr(r.value, values, false);
      const rowCls = r.team === p.team && r.name === p.name ? ' class="stat-rank-current"' : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${r.name}</td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${p.label} &mdash; All QBs</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Player</th><th class="num">${p.label}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".pass-split-rank-click");
  if (!cell) return;
  openPassSplitRankModal(decodeDataAttr(cell.dataset.entry));
});

// Opponent's own rate of showing this look, tiered against every OTHER
// team's rate for that exact same look -- a two-way split (zone/man,
// pressure/clean) has an easy-to-read dispersion even at just two numbers,
// so a team leaning unusually hard into one side is worth flagging the
// same way every other colored cell on the site flags an outlier. Same
// stat-rank-click convention as everywhere else -- click to see all 32
// teams' rate for this exact look.
function passSplitOppRateCell(oppTeam, tendKey, label) {
  const val = DATA.team_stats[oppTeam]?.[tendKey];
  if (val === null || val === undefined) return `<td class="num">--</td>`;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t]?.[tendKey])
    .filter((v) => v !== null && v !== undefined);
  const cls = percentileTier(val, pool, false);
  const alpha = tierAlphaAttr(val, pool, false);
  return numCell(`${Math.round(val * 100)}%`, cls, alpha, { team: oppTeam, statKey: tendKey, label, invert: false, percent: true });
}

function passSplitAdvCell(team, oppTeam, successVal, pool, defAllowedKey) {
  if (successVal === null || successVal === undefined) return `<td class="edge-cell">--</td>`;
  const offTier = percentileTier(successVal, pool, false);
  const offExtreme = percentileTier(successVal, pool, false, TIER_Z_EXTREME_THRESHOLD);
  const defVal = DATA.team_stats[oppTeam]?.[defAllowedKey];
  let defTier = "", defExtreme = "";
  if (defVal !== null && defVal !== undefined) {
    const teamPool = teamsWithGames()
      .map((t) => DATA.team_stats[t]?.[defAllowedKey])
      .filter((v) => v !== null && v !== undefined);
    defTier = percentileTier(defVal, teamPool, true);
    defExtreme = percentileTier(defVal, teamPool, true, TIER_Z_EXTREME_THRESHOLD);
  }
  return edgeCell(offTier, defTier, team, oppTeam, offExtreme, defExtreme);
}

function renderPassCoveragePanel(team, oppTeam) {
  const players = qualifyingPassers(team);
  if (!players.length) {
    return `<div class="stat-column-title">Coverage &amp; Pressure</div><p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const blocks = players
    .map((p) => {
      const splits = (DATA.player_pass_splits[team] || {})[p.name];
      if (!splits) {
        return `<div class="player-name-row"><span class="player-name">${p.name}</span></div><p class="no-data-note">No charted coverage/pressure data yet.</p>`;
      }
      const rows = PASS_SPLIT_ROWS.map((r) => {
        const cond = splits[r.key] || {};
        const successPool = passSplitPool(r.key, "success");
        return `<tr>
          <td>${r.label}</td>
          ${passSplitOppRateCell(oppTeam, r.tendKey, r.tendLabel)}
          ${passSplitRateCell(cond.comp_pct, passSplitPool(r.key, "comp_pct"), { team, name: p.name, condition: r.key, stat: "comp_pct", label: `${r.label} Comp %`, percent: true })}
          ${passSplitRateCell(cond.ypa, passSplitPool(r.key, "ypa"), { team, name: p.name, condition: r.key, stat: "ypa", label: `${r.label} YPA`, digits: 1 })}
          ${passSplitRateCell(cond.success, successPool, { team, name: p.name, condition: r.key, stat: "success", label: `${r.label} Success %`, percent: true })}
          ${passSplitAdvCell(team, oppTeam, cond.success, successPool, r.defAllowedKey)}
        </tr>`;
      }).join("");
      return `<div class="player-name-row"><span class="player-name">${p.name}</span></div>
        <table class="data-table pass-coverage-table">
          <thead><tr><th>Split</th><th class="num">Opp%</th><th class="num">Cmp%</th><th class="num">YPA</th><th class="num">Succ%</th><th class="edge-hdr">ADV</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join("");
  return `<div class="stat-column-title">Coverage &amp; Pressure</div>${blocks}`;
}

// ---- Pass Zone shot chart (Passing + Receiving tabs) ----
// Where a team's passing game actually attacks the field -- depth of
// target (screen/short/intermediate/deep, by air_yards) x pass_location
// (left/middle/right). Built entirely from build_stats.py's
// compute_pass_shot_chart, which -- unlike the Coverage & Pressure panel
// above -- uses only standard pbp columns nflverse publishes every week
// during the season, so this stays live all year instead of getting
// stuck on last season's data.
// Yardage ranges instead of words -- matches build_stats.py's
// PASS_DEPTH_BUCKETS boundaries exactly (deep=20+, intermediate=10-19,
// short=0-9, screen=behind the LOS). Shorter label = a shorter label
// column = room for all 4 team grids to sit on one row.
const PASS_ZONE_ROWS = [
  { key: "deep", label: "20+" },
  { key: "intermediate", label: "10-19" },
  { key: "short", label: "0-9" },
  { key: "screen", label: "SCN" },
];
const PASS_ZONE_COLS = ["left", "middle", "right"];

// Completion rate -- still the headline % on the cell (matches the comp/
// att fraction right below it), just no longer what drives the CELL
// COLOR (see passZoneCompositeZ). Still used as-is in the league-rank
// modal's own column.
function passZoneRate(zone) {
  return zone && zone.attempts ? zone.completions / zone.attempts : null;
}
function passZoneEpaPerPlay(zone) {
  return zone && zone.attempts ? zone.epa_sum / zone.attempts : null;
}

// League-wide pool of some per-zone metric (completion rate, volume, EPA/
// play -- whatever `metricFn` extracts), off or def side -- same zone-vs-
// zone comparison a raw team_stats percentile pool would do, just sourced
// from the nested pass_shot_charts blob instead of a flat key.
function passZonePool(side, zoneKey, metricFn) {
  return Object.values(DATA.pass_shot_charts || {})
    .map((t) => metricFn(t[side]?.zones?.[zoneKey]))
    .filter((v) => v !== null);
}

// Cell color: 75% how often this zone gets used (volume -- a raw
// attempts count, not a rate) + 25% EPA/play there. Deliberately NOT
// completion rate -- 2/2 and 7/8 read as the same "100%"-ish color under
// a rate-only scheme despite being very different signals (one snapshot,
// one a real, repeatable tendency), and a huge-volume zone at moderate
// efficiency is a more real "magnet spot" (offense) or "soft spot"
// (defense allowed) than a tiny-sample zone that happened to hit.
//
// BOTH components invert on the def side: getting thrown at often in one
// zone is itself the soft-spot signal (offenses attack what they've
// identified), so high volume allowed is bad news for that defense and
// has to read red -- same direction as allowing good EPA there. Green on
// a defense grid therefore means "nobody goes here, and it doesn't work
// when they do."
function passZoneCompositeZ(side, zoneKey, zone) {
  if (!zone || !zone.attempts) return null;
  const invert = side === "def";
  const volumePool = passZonePool(side, zoneKey, (z) => (z && z.attempts ? z.attempts : null));
  const epaPool = passZonePool(side, zoneKey, passZoneEpaPerPlay);
  const volZ = zScore(zone.attempts, volumePool, invert);
  const epaZ = zScore(passZoneEpaPerPlay(zone), epaPool, invert);
  if (volZ === null && epaZ === null) return null;
  return 0.75 * (volZ || 0) + 0.25 * (epaZ || 0);
}
function tierFromZ(z, threshold = TIER_Z_THRESHOLD) {
  if (z === null || z === undefined) return "";
  if (z >= threshold) return "tier-good";
  if (z <= -threshold) return "tier-bad";
  return "tier-mid";
}
function alphaAttrFromZ(z, threshold = TIER_Z_THRESHOLD) {
  if (z === null || z === undefined) return "";
  const az = Math.abs(z);
  if (az < threshold) return "";
  const t = Math.min((az - threshold) / (TIER_Z_SATURATE - threshold), 1);
  const a = TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * t;
  return ` style="--tier-a:${a.toFixed(2)}"`;
}

function renderPassZoneGrid(team, side) {
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  if (!chart) return `<p class="no-data-note">No pass-zone data yet.</p>`;
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = chart.zones[zk];
      const rate = passZoneRate(zone);
      const z = passZoneCompositeZ(side, zk, zone);
      const cls = tierFromZ(z);
      const alpha = alphaAttrFromZ(z);
      const rateDisplay = rate === null ? "--" : `${Math.round(rate * 100)}%`;
      const subDisplay = zone.attempts ? `${zone.completions}/${zone.attempts}` : "no attempts";
      const payload = { team, side, zoneKey: zk };
      return `<td class="num pass-zone-cell pass-zone-rank-click ${cls}"${alpha} data-entry="${encodeDataAttr(payload)}"><span class="pass-zone-rate">${rateDisplay}</span><span class="pass-zone-sub">${subDisplay}</span></td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label">${r.label}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid">
    <thead><tr><th></th><th>Left</th><th>Middle</th><th>Right</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Pass zone click-throughs: league rank, and (offense only) the
// individual plays behind one cell's number. One shared modal, two views,
// same "setup screen vs. arena" swap pattern the Wheel modal already uses. ----
function ensurePassZoneModal() {
  if (document.getElementById("pass-zone-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "pass-zone-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pass-zone-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="pass-zone-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePassZoneModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePassZoneModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePassZoneModal();
  });
}
function closePassZoneModal() {
  const el = document.getElementById("pass-zone-modal");
  if (el) el.hidden = true;
}

function renderPassZoneRankTable(team, side, zoneKey) {
  const rows = DATA.teams
    .map((t) => {
      const zone = (DATA.pass_shot_charts[t] || {})[side]?.zones?.[zoneKey];
      return { team: t, rate: passZoneRate(zone), epa: passZoneEpaPerPlay(zone), zone };
    })
    .filter((r) => r.rate !== null)
    .sort((a, b) => b.zone.attempts - a.zone.attempts);
  if (!rows.length) return `<p class="no-data-note">No attempts anywhere in this zone yet.</p>`;
  const body = rows
    .map((r) => {
      const rowCls = r.team === team ? ' class="stat-rank-current"' : "";
      const epaSign = r.epa >= 0 ? "+" : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${TEAM_NAMES[r.team] || r.team}</td><td class="num">${r.zone.attempts}</td><td class="num">${r.zone.completions}/${r.zone.attempts}</td><td class="num">${Math.round(r.rate * 100)}%</td><td class="num">${epaSign}${r.epa.toFixed(2)}</td></tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table pass-zone-rank-table">
    <thead><tr><th>Team</th><th class="num">Att</th><th class="num">C/A</th><th class="num">Comp %</th><th class="num">EPA/pl</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// One row per pass catcher who saw a target in this zone -- "who do I
// target" (offense) answered up front, without reading the play list
// underneath it. Sorted by targets, since volume is the whole point.
function passZonePlayerSummary(plays) {
  const groups = {};
  plays.forEach((p) => {
    const key = p.receiver || "Unknown";
    if (!groups[key]) groups[key] = { name: key, position: p.position || "?", targets: 0, rec: 0, yards: 0, air: 0, yac: 0, epa: 0, plays: [] };
    const g = groups[key];
    g.targets += 1;
    if (p.complete) {
      g.rec += 1;
      g.yards += p.yards || 0;
      g.air += p.air_yards || 0;
      g.yac += p.yac || 0;
    }
    g.epa += p.epa || 0;
    g.plays.push(p);
    if (!g.position || g.position === "?") g.position = p.position || "?";
  });
  return Object.values(groups).sort((a, b) => b.targets - a.targets);
}

function renderPassZonePlayerSummaryTable(summary) {
  const body = summary
    .map((g) => {
      const epaCls = g.epa > 0 ? "tier-good" : g.epa < 0 ? "tier-bad" : "";
      const epaSign = g.epa >= 0 ? "+" : "";
      return `<tr>
        <td>${g.name}</td>
        <td>${g.position}</td>
        <td class="num">${g.targets}</td>
        <td class="num">${g.rec}</td>
        <td class="num">${g.yards}</td>
        <td class="num">${g.air}</td>
        <td class="num">${g.yac}</td>
        <td class="num ${epaCls}">${epaSign}${g.epa.toFixed(1)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table pass-zone-summary-table">
    <thead><tr><th>Player</th><th>Pos</th><th class="num">Tgt</th><th class="num">Rec</th><th class="num">Yds</th><th class="num">Air</th><th class="num">YAC</th><th class="num">EPA</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Defense view of the same plays, rolled up by position group instead of
// by individual -- "which position group is finding this soft spot" is
// the question that actually transfers to next week's opponent, since
// the receivers themselves change every game.
function renderPassZonePositionTable(summary) {
  const groups = {};
  summary.forEach((g) => {
    const pos = g.position || "?";
    if (!groups[pos]) groups[pos] = { pos, targets: 0, rec: 0, yards: 0, yac: 0, epa: 0 };
    const t = groups[pos];
    t.targets += g.targets;
    t.rec += g.rec;
    t.yards += g.yards;
    t.yac += g.yac;
    t.epa += g.epa;
  });
  const rows = Object.values(groups).sort((a, b) => b.targets - a.targets);
  const body = rows
    .map((t) => {
      const epaCls = t.epa > 0 ? "tier-good" : t.epa < 0 ? "tier-bad" : "";
      const epaSign = t.epa >= 0 ? "+" : "";
      const rate = t.targets ? Math.round((t.rec / t.targets) * 100) : 0;
      return `<tr><td>${t.pos}</td><td class="num">${t.targets}</td><td class="num">${t.rec}/${t.targets}</td><td class="num">${rate}%</td><td class="num">${t.yards}</td><td class="num">${t.yac}</td><td class="num ${epaCls}">${epaSign}${t.epa.toFixed(1)}</td></tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table pass-zone-summary-table">
    <thead><tr><th>Pos</th><th class="num">Tgt</th><th class="num">C/A</th><th class="num">Comp %</th><th class="num">Yds</th><th class="num">YAC</th><th class="num">EPA</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// No "drop" distinction -- standard pbp doesn't chart drops (that's a
// PFF/NGS-only call), so an incompletion just shows as incomplete unless
// a pass defender was actually credited with breaking it up. yards splits
// into air (where it was caught -- the same depth this grid buckets by)
// and yac, since a short completion that housed it on YAC is a very
// different play than one that fell short of the sticks.
function renderPassZonePlayList(summary) {
  return summary
    .map((g) => {
      const rows = g.plays
        .map((p) => {
          const result = p.complete
            ? `${p.yards}y <span class="muted-label">(${p.air_yards} air + ${p.yac ?? 0} yac)</span>`
            : p.defender
            ? `Incomplete &mdash; broken up by ${p.defender}`
            : "Incomplete";
          const epaCls = p.epa > 0 ? "tier-good" : p.epa < 0 ? "tier-bad" : "";
          const epaSign = p.epa >= 0 ? "+" : "";
          return `<tr><td>Wk ${p.week}</td><td>${result}</td><td class="num ${epaCls}">${p.epa === null ? "--" : `${epaSign}${p.epa.toFixed(1)}`}</td></tr>`;
        })
        .join("");
      return `<div class="pass-zone-plays-player">
        <div class="stat-column-title">${g.name} <span class="muted-label">(${g.position} &middot; ${g.targets} tgt)</span></div>
        <table class="data-table player-odds-table">
          <thead><tr><th>Wk</th><th>Result</th><th class="num">EPA</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
}

// Everything in one wide view -- league rank, the who-to-target summary,
// and the plays themselves side by side, instead of a narrow box that
// made you toggle between them to hold two numbers in your head.
function renderPassZoneModalContent(team, side, zoneKey) {
  const zone = (DATA.pass_shot_charts[team] || {})[side]?.zones?.[zoneKey];
  const plays = (zone && zone.plays) || [];
  const sideLabel = side === "off" ? "Offense" : "Defense Allowed";
  const heading = `${teamLogoMini(team)} ${team} &mdash; ${zoneLabel(zoneKey)} ${sideLabel}`;
  const summary = passZonePlayerSummary(plays);
  const summaryBlock = !plays.length
    ? `<p class="no-data-note">No attempts in this zone yet.</p>`
    : side === "def"
    ? `<h4 class="pass-zone-modal-subhead">By Position</h4>${renderPassZonePositionTable(summary)}
       <h4 class="pass-zone-modal-subhead">By Player</h4>${renderPassZonePlayerSummaryTable(summary)}`
    : `<h4 class="pass-zone-modal-subhead">Who's Getting Targeted</h4>${renderPassZonePlayerSummaryTable(summary)}`;
  return `<h3>${heading}</h3>
    <div class="pass-zone-modal-layout">
      <div class="pass-zone-modal-col pass-zone-modal-col-rank">
        <h4 class="pass-zone-modal-subhead">League Rank <span class="muted-label">(by volume)</span></h4>
        ${renderPassZoneRankTable(team, side, zoneKey)}
      </div>
      <div class="pass-zone-modal-col">
        ${summaryBlock}
      </div>
      <div class="pass-zone-modal-col">
        ${plays.length ? `<h4 class="pass-zone-modal-subhead">Every Play</h4>${renderPassZonePlayList(summary)}` : ""}
      </div>
    </div>`;
}

function openPassZoneRankModal(team, side, zoneKey) {
  ensurePassZoneModal();
  document.getElementById("pass-zone-modal-content").innerHTML = renderPassZoneModalContent(team, side, zoneKey);
  document.getElementById("pass-zone-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".pass-zone-rank-click");
  if (!cell) return;
  const { team, side, zoneKey } = decodeDataAttr(cell.dataset.entry);
  openPassZoneRankModal(team, side, zoneKey);
});

function zoneLabel(zoneKey) {
  const [depth, loc] = zoneKey.split("_");
  return `${depth[0].toUpperCase()}${depth.slice(1)} ${loc[0].toUpperCase()}${loc.slice(1)}`;
}

// The per-zone list that used to sit under these stats was removed -- it
// was just the grid above it restated as text. What's left is the stuff
// the grid canNOT tell you at a glance, each tiered against the league so
// "25% deep rate" reads as high or low without needing the other 31 teams
// in front of you. Same invert rule as the grid: on defense, being
// thrown at more (deeper, more often) is the bad direction.
function passIdentityStats(team, side) {
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  if (!chart) return null;
  const zoneEntries = Object.entries(chart.zones).map(([key, z]) => ({ key, ...z }));
  const totalAttempts = zoneEntries.reduce((a, z) => a + z.attempts, 0);
  if (!totalAttempts) return null;
  const leadZone = zoneEntries.reduce((best, z) => (z.attempts > best.attempts ? z : best), zoneEntries[0]);
  const deepAttempts = zoneEntries.filter((z) => z.key.startsWith("deep_")).reduce((a, z) => a + z.attempts, 0);
  return {
    leadZoneKey: leadZone.key,
    leadZoneShare: leadZone.attempts / totalAttempts,
    deepRate: deepAttempts / totalAttempts,
    passRate: chart.total_plays ? chart.pass_attempts / chart.total_plays : null,
    attempts: chart.pass_attempts,
  };
}
function passIdentityPool(side, field) {
  return DATA.teams
    .map((t) => {
      const s = passIdentityStats(t, side);
      return s ? s[field] : null;
    })
    .filter((v) => v !== null && v !== undefined);
}

function renderPassIdentityCard(team, side) {
  const s = passIdentityStats(team, side);
  if (!s) return `<p class="no-data-note">No pass attempts charted yet.</p>`;
  const invert = side === "def";
  const statRow = (label, value, field, raw) => {
    const pool = passIdentityPool(side, field);
    const cls = raw === null || raw === undefined ? "" : percentileTier(raw, pool, invert);
    const alpha = raw === null || raw === undefined ? "" : tierAlphaAttr(raw, pool, invert);
    return `<div class="pass-zone-identity-stat"><span>${label}</span><strong class="${cls}"${alpha}>${value}</strong></div>`;
  };
  return `<div class="pass-zone-identity">
    ${statRow("Lead Zone", zoneLabel(s.leadZoneKey), "leadZoneShare", s.leadZoneShare)}
    ${statRow("Deep-Target Rate", `${Math.round(s.deepRate * 100)}%`, "deepRate", s.deepRate)}
    ${statRow("Pass Rate", s.passRate === null ? "--" : `${Math.round(s.passRate * 100)}%`, "passRate", s.passRate)}
    ${statRow("Attempts", s.attempts, "attempts", s.attempts)}
  </div>`;
}

function renderPassZoneBlock(team, side) {
  const heading = side === "off" ? `${team} &mdash; Passing Offense` : `${team} &mdash; Pass Defense (Allowed)`;
  // Offense only -- "who's actually getting targeted where" only makes
  // sense from the offense's own side; the defense-allowed grid already
  // says where a defense is weak, this says who's exploiting it.
  const allBtn = side === "off" ? `<button type="button" class="pass-zone-all-btn" data-team="${team}">See Players</button>` : "";
  return `<div class="pass-zone-block">
    <div class="stat-column-title">${teamLogoMini(team)} ${heading} ${allBtn}</div>
    ${renderPassZoneGrid(team, side)}
    ${renderPassIdentityCard(team, side)}
  </div>`;
}

// ---- Per-player target zones ("See Players") -- who actually gets
// targeted where, the offense-side complement to the team grid above.
// Same visual grid, sourced from build_stats.py's compute_player_pass_
// zone_splits instead of the team aggregate. Pattern-matched on the Rush
// Lanes "See All Players" modal (renderTeamRushLanesAllPlayersContent). ----
function passZonePlayerRate(zone) {
  return zone && zone.targets ? zone.receptions / zone.targets : null;
}
function passZonePlayerPool(zoneKey) {
  const pool = [];
  for (const players of Object.values(DATA.player_pass_zones || {})) {
    for (const zones of Object.values(players)) {
      const rate = passZonePlayerRate(zones[zoneKey]);
      if (rate !== null) pool.push(rate);
    }
  }
  return pool;
}
function renderPlayerPassZoneGrid(zones) {
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = zones[zk];
      const rate = passZonePlayerRate(zone);
      const cls = rate === null ? "" : percentileTier(rate, passZonePlayerPool(zk), false);
      const rateDisplay = rate === null ? "--" : `${Math.round(rate * 100)}%`;
      const epaSign = zone && zone.epa_sum > 0 ? "+" : "";
      const subDisplay = zone && zone.targets ? `${zone.receptions}/${zone.targets} &middot; ${zone.yards}y &middot; ${epaSign}${zone.epa_sum.toFixed(1)} epa` : "no targets";
      return `<td class="num pass-zone-cell ${cls}"><span class="pass-zone-rate">${rateDisplay}</span><span class="pass-zone-sub">${subDisplay}</span></td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label">${r.label}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid">
    <thead><tr><th></th><th>Left</th><th>Middle</th><th>Right</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
function renderPassZoneAllPlayersContent(team) {
  const heading = `<h3>${teamLogoMini(team)} ${TEAM_NAMES[team] || team} &mdash; Target Zones by Player</h3>`;
  const players = DATA.player_pass_zones[team] || {};
  const totalTargets = (name) => Object.values(players[name]).reduce((s, z) => s + z.targets, 0);
  const names = Object.keys(players)
    .filter((n) => totalTargets(n) > 0)
    .sort((a, b) => totalTargets(b) - totalTargets(a));
  if (!names.length) return `${heading}<p class="no-data-note">No charted targets yet this season.</p>`;
  const blocks = names
    .map((name) => `<div class="pass-zone-block"><div class="stat-column-title">${name} <span class="muted-label">(${totalTargets(name)} tgt)</span></div>${renderPlayerPassZoneGrid(players[name])}</div>`)
    .join("");
  return `${heading}<div class="stat-columns">${blocks}</div>`;
}
function ensurePassZoneAllModal() {
  if (document.getElementById("pass-zone-all-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "pass-zone-all-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pass-zone-all-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="pass-zone-all-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePassZoneAllModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePassZoneAllModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePassZoneAllModal();
  });
}
function closePassZoneAllModal() {
  const el = document.getElementById("pass-zone-all-modal");
  if (el) el.hidden = true;
}
function openPassZoneAllPlayersModal(team) {
  ensurePassZoneAllModal();
  document.getElementById("pass-zone-all-modal-content").innerHTML = renderPassZoneAllPlayersContent(team);
  document.getElementById("pass-zone-all-modal").hidden = false;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pass-zone-all-btn");
  if (!btn) return;
  openPassZoneAllPlayersModal(btn.dataset.team);
});

// ---- QB Rushing (scramble vs designed) ----
// build_stats.py's compute_scramble_splits: does pressure actually make
// this QB take off (his own scramble rate, pressured vs clean), and does
// the OPPONENT's own pressure actually contain scramblers once it forces
// one (their scramble rate/yards allowed in that same state) -- pressure
// without containment is a real, checkable distinction, not just raw
// pressure rate. Paired with a plain designed-vs-scramble volume/YPC
// split of this QB's own season rushing (build_player_props' designed_*/
// scramble_* fields).
const SCRAMBLE_ROWS = [
  { label: "Pressured", rateField: "scramble_rate_pressured", oppRateKey: "scramble_rate_allowed_pressured", oppYardsKey: "scramble_yards_allowed_pressured" },
  { label: "Clean Pocket", rateField: "scramble_rate_clean", oppRateKey: "scramble_rate_allowed_clean", oppYardsKey: "scramble_yards_allowed_clean" },
];

function scrambleRatePool(field) {
  return Object.values(DATA.player_scramble_splits || {})
    .flatMap((players) => Object.values(players))
    .map((s) => s[field])
    .filter((v) => v !== null && v !== undefined);
}

function scrambleRateCell(value, pool, payload) {
  if (value === null || value === undefined) return `<td class="num">--</td>`;
  const cls = percentileTier(value, pool, false);
  const alpha = tierAlphaAttr(value, pool, false);
  return `<td class="num ${cls} scramble-rank-click"${alpha} data-entry="${encodeDataAttr(payload)}">${Math.round(value * 100)}%</td>`;
}

// Generic tiered+clickable team_stats cell -- same pool/tier/click pattern
// as routeDefenseCell, just with an adjustable invert direction so it can
// serve a defense "allowed" stat (invert=true, lower=green) or a neutral
// team tendency (invert=false), reused by both the scramble-containment
// and red-zone-mix panels below.
function teamRateCell(team, statKey, label, opts = {}) {
  const val = DATA.team_stats[team]?.[statKey];
  if (val === null || val === undefined) return `<td class="num">--</td>`;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t]?.[statKey])
    .filter((v) => v !== null && v !== undefined);
  const invert = !!opts.invert;
  const cls = percentileTier(val, pool, invert);
  const alpha = tierAlphaAttr(val, pool, invert);
  const display = opts.percent ? `${Math.round(val * 100)}%` : fmt(val, opts.digits ?? 1);
  return numCell(display, cls, alpha, { team, statKey, label, invert, percent: !!opts.percent, digits: opts.digits });
}

function scrambleAdvCell(team, oppTeam, ownVal, pool, oppRateKey) {
  if (ownVal === null || ownVal === undefined) return `<td class="edge-cell">--</td>`;
  const offTier = percentileTier(ownVal, pool, false);
  const offExtreme = percentileTier(ownVal, pool, false, TIER_Z_EXTREME_THRESHOLD);
  const defVal = DATA.team_stats[oppTeam]?.[oppRateKey];
  let defTier = "", defExtreme = "";
  if (defVal !== null && defVal !== undefined) {
    const teamPool = teamsWithGames()
      .map((t) => DATA.team_stats[t]?.[oppRateKey])
      .filter((v) => v !== null && v !== undefined);
    defTier = percentileTier(defVal, teamPool, true);
    defExtreme = percentileTier(defVal, teamPool, true, TIER_Z_EXTREME_THRESHOLD);
  }
  return edgeCell(offTier, defTier, team, oppTeam, offExtreme, defExtreme);
}

// Every qualifying QB's value for one scramble-split field, sorted best to
// worst -- same shell/highlight convention as openPassSplitRankModal, just
// sourced from DATA.player_scramble_splits' flat fields instead of a
// nested zone/man/pressure/clean split.
function openScrambleRankModal(p) {
  ensureStatRankModal();
  const rows = [];
  for (const [t, players] of Object.entries(DATA.player_scramble_splits || {})) {
    for (const [name, s] of Object.entries(players)) {
      const val = s[p.field];
      if (val === null || val === undefined) continue;
      rows.push({ team: t, name, value: val });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  const values = rows.map((r) => r.value);
  const body = rows
    .map((r) => {
      const cls = percentileTier(r.value, values, false);
      const alpha = tierAlphaAttr(r.value, values, false);
      const rowCls = r.team === p.team && r.name === p.name ? ' class="stat-rank-current"' : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${r.name}</td><td class="num ${cls}"${alpha}>${Math.round(r.value * 100)}%</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${p.label} &mdash; All QBs</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Player</th><th class="num">${p.label}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".scramble-rank-click");
  if (!cell) return;
  openScrambleRankModal(decodeDataAttr(cell.dataset.entry));
});

function renderQbRushingPanel(team, oppTeam) {
  const players = qualifyingPassers(team);
  if (!players.length) {
    return `<div class="stat-column-title">QB Rushing</div><p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const blocks = players
    .map((p) => {
      const s = (DATA.player_scramble_splits[team] || {})[p.name];
      const scrambleRows = !s
        ? `<tr><td colspan="5" class="no-data-note">No charted scramble data yet.</td></tr>`
        : SCRAMBLE_ROWS.map((r) => {
            const pool = scrambleRatePool(r.rateField);
            const ownVal = s[r.rateField];
            return `<tr>
              <td>${r.label}</td>
              ${scrambleRateCell(ownVal, pool, { team, name: p.name, field: r.rateField, label: `${r.label} Scramble Rate` })}
              ${teamRateCell(oppTeam, r.oppRateKey, `Opp Scramble Rate Allowed (${r.label})`, { percent: true, invert: true })}
              ${teamRateCell(oppTeam, r.oppYardsKey, `Opp Yards/Scramble Allowed (${r.label})`, { digits: 1, invert: true })}
              ${scrambleAdvCell(team, oppTeam, ownVal, pool, r.oppRateKey)}
            </tr>`;
          }).join("");
      const typeRows = `
        <tr><td>Designed</td><td class="num">${p.designed_carries}</td><td class="num">${fmt(p.designed_rush_yards, 0)}</td>${passStatCell(p, "designed_ypc", { label: "Designed Rush YPC" })}</tr>
        <tr><td>Scramble</td><td class="num">${p.scramble_carries}</td><td class="num">${fmt(p.scramble_rush_yards, 0)}</td>${passStatCell(p, "scramble_ypc", { label: "Scramble YPC" })}</tr>
      `;
      return `<div class="player-name-row"><span class="player-name">${p.name}</span></div>
        <table class="data-table scramble-table">
          <thead><tr><th>Split</th><th class="num">Scr%</th><th class="num">OppAllow%</th><th class="num">OppYds</th><th class="edge-hdr">ADV</th></tr></thead>
          <tbody>${scrambleRows}</tbody>
        </table>
        <table class="data-table scramble-type-table">
          <thead><tr><th>Type</th><th class="num">Car</th><th class="num">Yds</th><th class="num">YPC</th></tr></thead>
          <tbody>${typeRows}</tbody>
        </table>`;
    })
    .join("");
  return `<div class="stat-column-title">QB Rushing</div>${blocks}`;
}

// ---- Red Zone Approach (team-level pass/run mix) ----
// build_stats.py's build_team_stats: this offense's own pass-vs-run SHARE
// of its red zone snaps, and each type's own TD conversion rate -- "does
// this team lean pass or run near the goal line, and which one actually
// works for them" -- next to what the OPPONENT shows/allows in the same
// split. Team-level only (not per-QB), so every cell reuses teamRateCell
// straight off team_stats, same as every other paired offense/defense
// table on the site.
const RZ_MIX_ROWS = [
  { label: "Pass", rateKey: "rz_pass_rate", tdKey: "rz_pass_td_rate", oppRateKey: "rz_pass_rate_allowed", oppTdKey: "rz_pass_td_rate_allowed" },
  { label: "Rush", rateKey: "rz_rush_rate", tdKey: "rz_rush_td_rate", oppRateKey: "rz_rush_rate_allowed", oppTdKey: "rz_rush_td_rate_allowed" },
];

function renderRedZoneMixPanel(team, oppTeam) {
  const rows = RZ_MIX_ROWS.map(
    (r) => `<tr>
      <td>${r.label}</td>
      ${teamRateCell(team, r.rateKey, `${r.label} Rate (Red Zone)`, { percent: true })}
      ${teamRateCell(team, r.tdKey, `${r.label} TD Rate (Red Zone)`, { percent: true })}
      ${teamRateCell(oppTeam, r.oppRateKey, `Opp ${r.label} Rate Allowed (Red Zone)`, { percent: true })}
      ${teamRateCell(oppTeam, r.oppTdKey, `Opp ${r.label} TD Rate Allowed (Red Zone)`, { percent: true, invert: true })}
    </tr>`
  ).join("");
  return `<div class="stat-column-title">Red Zone Approach</div>
    <table class="data-table rz-mix-table">
      <thead><tr><th>Play</th><th class="num">Rate</th><th class="num">TD%</th><th class="num">OppRate</th><th class="num">OppTD%</th></tr></thead>
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

const backupQbToggleEl = document.getElementById("show-backup-qbs");
if (backupQbToggleEl) {
  backupQbToggleEl.addEventListener("change", () => {
    setShowBackupQbs(backupQbToggleEl.checked);
    render();
  });
}

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
  document.getElementById("col-away-passcoverage").innerHTML = renderPassCoveragePanel(away, home);
  document.getElementById("col-home-passcoverage").innerHTML = renderPassCoveragePanel(home, away);
  document.getElementById("col-away-scramble").innerHTML = renderQbRushingPanel(away, home) + renderRedZoneMixPanel(away, home);
  document.getElementById("col-home-scramble").innerHTML = renderQbRushingPanel(home, away) + renderRedZoneMixPanel(home, away);
  document.getElementById("col-away-passzones-off").innerHTML = renderPassZoneBlock(away, "off");
  document.getElementById("col-away-passzones-def").innerHTML = renderPassZoneBlock(away, "def");
  document.getElementById("col-home-passzones-off").innerHTML = renderPassZoneBlock(home, "off");
  document.getElementById("col-home-passzones-def").innerHTML = renderPassZoneBlock(home, "def");
  document.getElementById("col-away-recvzones-off").innerHTML = renderPassZoneBlock(away, "off");
  document.getElementById("col-away-recvzones-def").innerHTML = renderPassZoneBlock(away, "def");
  document.getElementById("col-home-recvzones-off").innerHTML = renderPassZoneBlock(home, "off");
  document.getElementById("col-home-recvzones-def").innerHTML = renderPassZoneBlock(home, "def");

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
    showBackupQbs = loadShowBackupQbs();
    if (backupQbToggleEl) backupQbToggleEl.checked = showBackupQbs;
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening player-props.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
