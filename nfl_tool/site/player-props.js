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
        <td><div class="player-name-row"><span class="player-name player-click" data-entry="${encodeDataAttr({ team, name: p.name })}">${p.name}</span>${routeChipsHtml(p, oppTeam)}</div></td>
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
        <td><span class="player-click" data-entry="${encodeDataAttr({ team, name: p.name })}">${p.name}</span></td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.carries_per_g, 1)}</td>
        <td class="num">${fmt(p.rush_yards_per_g, 1)}</td>
        <td class="num">${p.ypc != null ? fmt(p.ypc, 1) : "--"}</td>
        ${playerAdvCell(p, oppTeam, "rush_yards_per_g", allowedKey)}
      </tr>`;
    })
    .join("");
  return `${teamBannerHeader(team, true)}
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
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying passers yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      return `<tr>
        <td><span class="player-click" data-entry="${encodeDataAttr({ team, name: p.name })}">${p.name}</span></td>
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
function renderPropsMarketTable(awayTeam, homeTeam, market) {
  const marketData = (DATA.player_prop_markets || {})[market] || {};
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
      return `<tr style="${rowStyle}">
        <td>${teamLogoMini(p.team)} ${p.name} <span class="muted-label">(${p.position || "?"})</span></td>
        <td class="num props-line">${fmt(p.line, 1)}</td>
        <td class="num">${fmtOddsSigned(p.over_odds)}</td>
        <td class="num">${fmtOddsSigned(p.under_odds)}</td>
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
    if (found) rows.push({ market: labels[stat], ...found });
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
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.market}</td><td class="num props-line">${fmt(r.line, 1)}</td><td class="num">${fmtOddsSigned(r.over_odds)}</td><td class="num">${fmtOddsSigned(r.under_odds)}</td></tr>`
    )
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
  const { team, name, view } = playerModalState;
  const bodyHtml = view === "gamelog" ? renderPlayerGameLogContent(team, name) : renderPlayerMarketsModalContent(team, name);
  return `<div class="player-modal-toggle">
      <button type="button" class="player-modal-toggle-btn${view === "odds" ? " active" : ""}" data-view="odds">Odds</button>
      <button type="button" class="player-modal-toggle-btn${view === "gamelog" ? " active" : ""}" data-view="gamelog">Game Log</button>
    </div>
    <div id="player-modal-body">${bodyHtml}</div>`;
}

function openPlayerMarketsModal(team, name) {
  ensurePropsModal();
  propsModalTeams = null; // no market dropdown in this view -- keeps the OTHER change handler from acting on stale state
  playerModalState = { team, name, view: "odds" };
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
    const { team, name } = decodeDataAttr(playerEl.dataset.entry);
    openPlayerMarketsModal(team, name);
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
  setActivePropsView(currentPropsView);

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
