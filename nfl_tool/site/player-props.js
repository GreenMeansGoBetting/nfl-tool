// Player Props page: volume/efficiency for receiving, rushing, and passing,
// each next to what the OPPONENT allows at that position. Reads the same
// DATA.player_props/team_stats build_stats.py already produces; no
// separate data source from TD Data or Game Previews.

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

// Same depth buckets as the Target Zones grid (PASS_ZONE_ROWS/PASS_ZONE_
// COLS), short labels instead of the grid's spelled-out ones -- this table
// already has 9 other columns, so brevity matters more here than it does
// in a 3-wide grid.
const RECEIVING_DIST_COLS = [
  { key: "deep", label: "20+" },
  { key: "intermediate", label: "10-19" },
  { key: "short", label: "0-9" },
  { key: "screen", label: "SCN" },
];

// A player's own share of targets at ONE depth (summed across all 3
// locations), out of that player's own total targets across every zone --
// the player-level version of passZoneRowShare's team-level "how much of
// MY volume is at this depth."
function playerZoneDepthShare(zones, rowKey) {
  if (!zones) return null;
  let total = 0;
  for (const key in zones) total += zones[key].targets || 0;
  if (!total) return null;
  const sum = PASS_ZONE_COLS.reduce((s, loc) => s + (zones[`${rowKey}_${loc}`]?.targets || 0), 0);
  return sum / total;
}
// League-wide pool of every qualifying pass-catcher's own share at one
// depth, for percentile coloring -- same convention as everywhere else,
// just sourced from player_pass_zones instead of a flat team_stats key.
function playerZoneDepthSharePool(rowKey) {
  const pool = [];
  for (const players of Object.values(DATA.player_pass_zones || {})) {
    for (const p of Object.values(players)) {
      const share = playerZoneDepthShare(p.zones, rowKey);
      if (share !== null) pool.push(share);
    }
  }
  return pool;
}

// Sort state for the distance columns only -- the original stat columns
// (Tgt/g, etc.) open a league rank modal on click instead (see
// openReceivingColumnRankModal), so only ONE sort key is ever active at a
// time and it always belongs to a distance column. Module-level since the
// click handler re-renders the table in place rather than reopening it.
let receivingSort = { key: null, dir: "desc" };

// One table per team (with room to spare at 1600px main width now) instead
// of both teams merged into one sorted list -- easier to scan "this team's
// whole receiving corps" as its own block, same pattern every other tab on
// this page already uses (Rushing/Passing are both split by team).
// No target minimum -- same reasoning as the Target Zones cards below
// (renderOffensePlayerZoneCards): a targets>=5 bar was built for
// stabilizing a per-game RATE, but it was quietly dropping every real
// pass-catcher below that bar from this table entirely (a deep receiving
// corps might only show 2 of 9 real targets-earners per team). Any
// charted target qualifies now -- and as of build_stats.py's
// PROPS_MIN_TARGETS fix, that's true all the way back to the underlying
// data too, not just this display filter.
// The 7 flat-field stat columns -- unlike RECEIVING_DIST_COLS, these read
// straight off a player_props row instead of needing a zone lookup.
// Header click sorts the table by this column; clicking a player's own
// NUMBER (not the header) opens the league-wide rank modal for it -- this
// used to be backwards (header click opened the rank modal, and there was
// no way to sort by these columns at all).
const RECEIVING_STAT_COLS = [
  { key: "targets_per_g", label: "Tgt/g" },
  { key: "rec_per_g", label: "Rec/g" },
  { key: "rec_yards_per_g", label: "Yds/g" },
  { key: "adot", label: "ADOT" },
  { key: "yac_per_rec", label: "YAC" },
  { key: "target_share", label: "Tgt%", percent: true },
  { key: "snap_pct", label: "Snap%", percent: true },
];

// One header-click sort key covers every sortable column on this table --
// the 7 flat stats above, the 4 zone-share distance columns, and Player/
// Pos -- so a reader can sort by literally anything in the header row, not
// just the 4 distance columns like before.
function receivingSortValue(p, key) {
  if (key === "name" || key === "position") return p[key] || "";
  if (RECEIVING_DIST_COLS.some((c) => c.key === key)) {
    const zones = ((DATA.player_pass_zones[p.team] || {})[p.name] || {}).zones;
    const share = playerZoneDepthShare(zones, key);
    return share === null ? -1 : share;
  }
  const v = p[key];
  return v === null || v === undefined ? -1 : v;
}

function renderReceivingTeamTable(team, oppTeam) {
  let rows = (DATA.player_props[team] || []).filter((p) => p.targets > 0);
  if (!rows.length) {
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying pass-catchers yet this season.</p>`;
  }
  if (receivingSort.key) {
    rows = [...rows].sort((a, b) => {
      const av = receivingSortValue(a, receivingSort.key);
      const bv = receivingSortValue(b, receivingSort.key);
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
      return receivingSort.dir === "desc" ? -cmp : cmp;
    });
  } else {
    rows = [...rows].sort((a, b) => b.targets - a.targets);
  }

  const sortHeader = (key, label, cls = "") => {
    const active = receivingSort.key === key;
    const arrow = active ? (receivingSort.dir === "desc" ? " ▼" : " ▲") : "";
    return `<th class="${cls} receiving-sort-click${active ? " active" : ""}" data-key="${key}">${label}${arrow}</th>`;
  };
  // Very light shading against his OWN teammates in this table (not the
  // league): percentile rank within the team, green above the middle, red
  // below, never stronger than a faint wash. Layered as a background-image
  // so the tile's own base color stays underneath.
  const teamPools = {};
  RECEIVING_STAT_COLS.forEach((c) => (teamPools[c.key] = rows.map((p) => p[c.key]).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)));
  const teamShade = (key, val) => {
    const pool = teamPools[key];
    if (pool.length < 3 || pool[0] === pool[pool.length - 1]) return "";
    const below = pool.filter((v) => v < val).length;
    const equal = pool.filter((v) => v === val).length;
    const q = (below + (equal - 1) / 2) / (pool.length - 1); // 0 = team low, 1 = team high
    const d = Math.abs(q - 0.5) * 2;
    if (d < 0.2) return "";
    const rgb = q > 0.5 ? "var(--good-rgb)" : "var(--bad-rgb)";
    const a = (0.05 + 0.13 * d).toFixed(3);
    return ` style="background-image:linear-gradient(rgba(${rgb},${a}),rgba(${rgb},${a}))"`;
  };
  const statCell = (p, col) => {
    const val = p[col.key];
    if (val === null || val === undefined) return `<td class="num">--</td>`;
    const display = col.percent ? `${Math.round(val * 100)}%` : fmt(val, col.digits ?? 1);
    const payload = { statKey: col.key, label: col.label, percent: !!col.percent, digits: col.digits, invert: !!col.invert };
    return `<td class="num receiving-col-rank-click" data-entry="${encodeDataAttr(payload)}"${teamShade(col.key, val)}>${display}</td>`;
  };

  const body = rows
    .map((p) => {
      const zones = ((DATA.player_pass_zones[p.team] || {})[p.name] || {}).zones;
      const distCells = RECEIVING_DIST_COLS.map((r) => {
        const share = playerZoneDepthShare(zones, r.key);
        if (share === null) return `<td class="num rec-depth">--</td>`;
        const pool = playerZoneDepthSharePool(r.key);
        const cls = percentileTier(share, pool, false);
        const alpha = tierAlphaAttr(share, pool, false);
        return `<td class="num rec-depth ${cls}"${alpha}>${Math.round(share * 100)}%</td>`;
      }).join("");
      return `<tr>
        <td><span class="player-name player-click" data-entry="${encodeDataAttr({ team: p.team, name: p.name, oppTeam })}">${p.name}</span></td>
        <td>${p.position}</td>
        ${RECEIVING_STAT_COLS.map((c) => statCell(p, c)).join("")}
        ${distCells}
      </tr>`;
    })
    .join("");

  return `${teamBannerHeader(team, true)}
    <table class="data-table props-rec-table">
      <colgroup>${[130, 32, 40, 40, 48, 40, 40, 40, 40, 34, 40, 34, 34].map((w) => `<col style="width:${w}px">`).join("")}</colgroup>
      <thead>
      <tr class="rec-group-row"><th colspan="${2 + RECEIVING_STAT_COLS.length}"></th><th colspan="${RECEIVING_DIST_COLS.length}" class="rec-depth-group" title="Share of HIS targets at each depth, shaded vs every pass-catcher in the league">Target depth</th></tr>
      <tr>
        ${sortHeader("name", "Player", "lb-player")}
        ${sortHeader("position", "Pos", "lb-pos")}
        ${RECEIVING_STAT_COLS.map((c) => sortHeader(c.key, c.label, "num")).join("")}
        ${RECEIVING_DIST_COLS.map((c) => sortHeader(c.key, c.label, "num rec-depth")).join("")}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// League-wide rank for one Receiving-table column, across every
// qualifying pass-catcher on ANY team (not position-scoped -- a TE and a
// WR on the same list, position shown per row for context) -- opened by
// clicking a player's own number in that column, same "click a value, see
// everyone" convention the Passing table's stat cells already use.
function openReceivingColumnRankModal(statKey, label, opts = {}) {
  ensureStatRankModal();
  const rows = [];
  for (const [team, players] of Object.entries(DATA.player_props)) {
    for (const pl of players) {
      if (pl.targets < 1) continue;
      const val = pl[statKey];
      if (val === null || val === undefined) continue;
      rows.push({ team, name: pl.name, position: pl.position, value: val });
    }
  }
  const invert = !!opts.invert;
  rows.sort((a, b) => (invert ? a.value - b.value : b.value - a.value));
  const values = rows.map((r) => r.value);
  const display = (v) => (opts.percent ? `${Math.round(v * 100)}%` : fmt(v, opts.digits ?? 1));
  const body = rows
    .map((r) => {
      const cls = percentileTier(r.value, values, invert);
      const alpha = tierAlphaAttr(r.value, values, invert);
      return `<tr><td>${teamLogoMini(r.team)} ${playerClick(r.team, r.name)} <span class="muted-label">(${r.position})</span></td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${label} &mdash; All Pass-Catchers</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Player</th><th class="num">${label}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const rankCell = e.target.closest(".receiving-col-rank-click");
  if (rankCell) {
    const { statKey, label, invert, percent, digits } = decodeDataAttr(rankCell.dataset.entry);
    openReceivingColumnRankModal(statKey, label, { invert, percent, digits });
    return;
  }
  const sortTh = e.target.closest(".receiving-sort-click");
  if (sortTh) {
    const key = sortTh.dataset.key;
    receivingSort = receivingSort.key === key ? { key, dir: receivingSort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" };
    const away = document.getElementById("away-select").value;
    const home = document.getElementById("home-select").value;
    document.getElementById("col-away-receiving").innerHTML = renderReceivingTeamTable(away, home);
    document.getElementById("col-home-receiving").innerHTML = renderReceivingTeamTable(home, away);
  }
});


// Main-page rush lanes: the opponent's defense row shown once at the top,
// then every rusher who's actually touched the ball gets his OWN lane
// column set below it -- the Rushing-tab equivalent of the Receiving tab's
// per-player hotspot cards (renderOffensePlayerZoneCards), so "does this
// back like this lane, and is this defense's own weak side lined up with
// it" reads directly off the main page instead of behind a "See All
// Players" click-through (this used to be modal-only content; the modal's
// gone now since duplicating the exact same view there added nothing).
function renderRushLanesPlayers(team, oppTeam) {
  const defRow = RUSH_ZONES.map((z) => rushLaneColumnDefenseOnly(defenseLaneCell(oppTeam, z))).join("");
  const defHeader = `<div class="rush-lanes-team-tag">${teamLogoMini(oppTeam)} ${oppTeam} run defense</div><div class="rush-lanes-cols">${defRow}</div>`;
  const players = (DATA.player_props[team] || []).filter((p) => p.carries > 0).sort((a, b) => b.carries - a.carries);
  if (!players.length) {
    return `<div class="rush-lanes">${defHeader}<p class="no-data-note">No qualifying rushers yet this season.</p></div>`;
  }
  const pools = buildRushZonePools();
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
        <div class="rush-lanes-team-tag">${playerClick(team, p.name, p.name, oppTeam)} <span class="muted-label">(${p.position})</span></div>
        <div class="rush-lanes-cols">${cols}</div>
      </div>`;
    })
    .join("");
  return `<div class="rush-lanes">${defHeader}<div class="rush-lanes-all-players">${playerBlocks}</div></div>`;
}

// No carry minimum and no top-4 cap -- same targets>=5-style bug already
// fixed on the Receiving table, just here instead (a real rotational back
// with 3 carries was invisible). Every rusher with at least one carry
// shows now.
function renderRushingTable(team, oppTeam) {
  const players = (DATA.player_props[team] || [])
    .filter((p) => p.carries > 0)
    .sort((a, b) => b.carries - a.carries);
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
  return `${teamBannerHeader(team, true)}
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
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${playerClick(r.team, r.name)}</td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
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
  // Current starter first (common.js currentStarterQb), then by attempts.
  const starter = normName(currentStarterQb(team, DATA.current_week) || "");
  const all = (DATA.player_props[team] || [])
    .filter((p) => p.pass_att >= 10)
    .sort((a, b) => (normName(b.name) === starter) - (normName(a.name) === starter) || b.pass_att - a.pass_att);
  return showBackupQbs ? all.slice(0, 2) : all.slice(0, 1);
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
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${playerClick(r.team, r.name)}</td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
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


// Sum of a team's own attempts across all 3 locations at ONE depth (a row
// total) or across all 4 depths at ONE location (a column total) -- same
// share-of-attempts math as passZoneVolumeShare, just aggregated across
// the whole row/column instead of one cell, so "how popular is this DEPTH
// overall" and "how popular is this SIDE of the field overall" are each
// answered right on the label instead of needing to add 3-4 cells by eye.
function passZoneRowShare(chart, rowKey) {
  if (!chart || !chart.pass_attempts) return null;
  const sum = PASS_ZONE_COLS.reduce((s, loc) => s + (chart.zones[`${rowKey}_${loc}`]?.attempts || 0), 0);
  return sum / chart.pass_attempts;
}
function passZoneColShare(chart, colKey) {
  if (!chart || !chart.pass_attempts) return null;
  const sum = PASS_ZONE_ROWS.reduce((s, r) => s + (chart.zones[`${r.key}_${colKey}`]?.attempts || 0), 0);
  return sum / chart.pass_attempts;
}
// This team's OWN other row/column shares -- same self-referential-only
// principle as passZoneCompositeZ above, just at the row/column-total
// level instead of per-cell. A row/column pool has just 4 or 3 values
// (this team's own depths/sides), which is why zScore's 3-sample floor
// matters here: a column pool (Left/Middle/Right) sits exactly at that
// floor.
function passZoneRowSharePool(chart) {
  if (!chart) return [];
  return PASS_ZONE_ROWS.map((r) => passZoneRowShare(chart, r.key)).filter((v) => v !== null);
}
function passZoneColSharePool(chart) {
  if (!chart) return [];
  return PASS_ZONE_COLS.map((c) => passZoneColShare(chart, c)).filter((v) => v !== null);
}
// Big colored pill instead of a small muted number -- same self-only
// invert convention as passZoneCompositeZ (more share than this team's
// own other rows/columns = a soft spot = red), so the badge's color means
// the same thing the cells around it already do.
// In League-rank mode the badge instead grades the whole row/column
// (zoneKeys) against the league with the same composite as the cells.
// Share of throws for a whole row/column: a big number shaded red ->
// yellow -> green by how it compares (same z the cells use), with a fill
// bar underneath showing the share itself.
function passZoneTotalBadge(share, pool, league) {
  if (share === null) return "";
  const z = passZoneColorMode === "league" && league ? passZoneLeagueCompositeZ(league.team, league.side, league.zoneKeys) : zScore(share, pool, true);
  const q = z === null || z === undefined ? 0.5 : Math.max(0, Math.min(1, 0.5 + z / 3));
  const hue = Math.round(q * 120);
  const pct = Math.round(share * 100);
  return `<span class="pz-share" style="--pz-hue:${hue}"><b>${pct}%</b><span class="pz-bar"><span style="width:${Math.min(100, pct * 2)}%"></span></span></span>`;
}

// Tinted the same way every other team table on the site headers its
// columns (schemeTableHeader, teamBannerHeader) -- plain "Left/Middle/
// Right" text read as generic and out of place next to those. Each header
// also carries that location's own total share of attempts (all 4 depths
// combined), same idea as the row labels' own depth total. `chart` is
// optional -- renderPlayerPassZoneGrid reuses this header for a per-player
// grid with no team-level share data, and gets the styled label with no
// badge (passZoneColShare/passZoneColSharePool both no-op on an
// undefined chart).
function passZoneGridHeader(team, chart, side) {
  const rgb = teamAccentRgb(team);
  const style = `background:rgba(${rgb.join(",")},0.35)`;
  const col = (label, key) => {
    const share = passZoneColShare(chart, key);
    const league = side ? { team, side, zoneKeys: PASS_ZONE_ROWS.map((r) => `${r.key}_${key}`) } : null;
    const badge = passZoneTotalBadge(share, passZoneColSharePool(chart), league);
    return `<th style="${style}"><span class="pass-zone-col-label">${label}</span>${badge}</th>`;
  };
  return `<tr><th></th>${col("Left", "left")}${col("Middle", "middle")}${col("Right", "right")}</tr>`;
}

// Share of this team's OWN attempts (this side) that land in one zone --
// the volume story the cell is actually built around now, instead of
// completion rate (which used to be the printed number even though the
// cell's COLOR was 75% volume/25% EPA -- two different stats sharing one
// box). Denominator is this side's own total pass attempts, not the raw
// sum of zone attempts, so screens/spikes without a charted location
// don't quietly inflate every real zone's share.
function passZoneVolumeShare(chart, zone) {
  if (!chart || !chart.pass_attempts || !zone) return null;
  return zone.attempts / chart.pass_attempts;
}

// Defense cell: how often this zone gets attacked (the big share number)
// and what the defense allows when it does (completion % + the raw sample
// underneath it), stacked as one story instead of a corner badge fighting
// a cramped caption line for space -- this is now the ONLY thing a
// pass-zone grid on the main page shows (the offense side moved to
// renderOffensePlayerZoneCards' per-player heat grids), so the cell has
// the whole box to itself instead of needing to also leave room for a
// player list. Player-level detail for a specific defense cell is still
// one click away -- see renderPassZoneOpponentBlock.
function passZoneCellDefenseDetail(zone) {
  if (!zone || !zone.attempts) return "";
  const rate = passZoneRate(zone);
  return `<span class="pass-zone-cell-comp">${Math.round(rate * 100)}% comp</span><span class="pass-zone-cell-sample">(${zone.completions}/${zone.attempts})</span>`;
}

function renderPassZoneGrid(team, side, opponent) {
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  if (!chart) return `<p class="no-data-note">No pass-zone data yet.</p>`;
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = chart.zones[zk];
      const z = passZoneCellZ(chart, team, side, zk);
      const cls = tierFromZ(z);
      const alpha = alphaAttrFromZ(z);
      const share = passZoneVolumeShare(chart, zone);
      const shareDisplay = share === null ? "--" : `${Math.round(share * 100)}%`;
      const detail = passZoneCellDefenseDetail(zone);
      const payload = { team, side, zoneKey: zk, opponent };
      // min-height on a <td> itself isn't reliably respected by browsers
      // (row height quietly ignores it) -- wrapping the content in a real
      // block element and putting min-height THERE is the standard fix,
      // and it's what actually makes every cell in the grid a uniform
      // size regardless of how many player lines it has.
      return `<td class="num pass-zone-cell pass-zone-rank-click ${cls}"${alpha} data-entry="${encodeDataAttr(payload)}"><div class="pass-zone-cell-inner"><span class="pass-zone-rate">${shareDisplay}</span>${detail}</div></td>`;
    }).join("");
    const rowShare = passZoneRowShare(chart, r.key);
    const rowLeague = { team, side, zoneKeys: PASS_ZONE_COLS.map((c) => `${r.key}_${c}`) };
    const rowBadge = passZoneTotalBadge(rowShare, passZoneRowSharePool(chart), rowLeague);
    return `<tr><th class="pass-zone-row-label"><span class="pass-zone-row-label-text">${r.label}</span>${rowBadge}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid">
    <thead>${passZoneGridHeader(team, chart, side)}</thead>
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
      const g = DATA.team_stats[t]?.games_played || 0;
      return { team: t, rate: passZoneRate(zone), epa: passZoneEpaPerPlay(zone), zone, perG: g && zone ? zone.attempts / g : null };
    })
    .filter((r) => r.rate !== null)
    // Per game, not raw attempts -- teams can have played different numbers
    // of games (byes, Monday night).
    .sort((a, b) => b.perG - a.perG || b.zone.attempts - a.zone.attempts);
  if (!rows.length) return `<p class="no-data-note">No attempts anywhere in this zone yet.</p>`;
  const body = rows
    .map((r, i) => {
      const rowCls = r.team === team ? ' class="stat-rank-current"' : "";
      const epaSign = r.epa >= 0 ? "+" : "";
      return `<tr${rowCls}><td class="num">${i + 1}</td><td>${teamLogoMini(r.team)} ${TEAM_NAMES[r.team] || r.team}</td><td class="num">${r.perG === null ? "--" : r.perG.toFixed(1)}</td><td class="num">${r.zone.completions}/${r.zone.attempts}</td><td class="num">${Math.round(r.rate * 100)}%</td><td class="num">${epaSign}${r.epa.toFixed(2)}</td></tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table pass-zone-rank-table">
    <thead><tr><th class="num">#</th><th>Team</th><th class="num">Att/G</th><th class="num">C/A</th><th class="num">Comp %</th><th class="num">EPA/pl</th></tr></thead>
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
      g.long = Math.max(g.long || 0, p.yards || 0);
    }
    g.epa += p.epa || 0;
    g.plays.push(p);
    if (!g.position || g.position === "?") g.position = p.position || "?";
  });
  return Object.values(groups).sort((a, b) => b.targets - a.targets);
}

function renderPassZonePlayerSummaryTable(summary, team = null) {
  const body = summary
    .map((g) => {
      const epaCls = g.epa > 0 ? "tier-good" : g.epa < 0 ? "tier-bad" : "";
      const epaSign = g.epa >= 0 ? "+" : "";
      return `<tr>
        <td>${team ? playerClick(team, g.name) : g.name}</td>
        <td>${g.position}</td>
        <td class="num">${g.targets}</td>
        <td class="num">${g.rec}</td>
        <td class="num">${g.targets ? Math.round((g.rec / g.targets) * 100) : 0}%</td>
        <td class="num">${g.yards}</td>
        <td class="num">${g.yac}</td>
        <td class="num">${g.rec ? fmt(g.yac / g.rec, 1) : "--"}</td>
        <td class="num">${g.rec ? g.long : "--"}</td>
        <td class="num ${epaCls}">${epaSign}${g.epa.toFixed(1)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="data-table player-odds-table pass-zone-summary-table">
    <thead><tr><th>Player</th><th>Pos</th><th class="num">Tgt</th><th class="num">Rec</th><th class="num">Catch%</th><th class="num">Yds</th><th class="num">YAC</th><th class="num">YAC/R</th><th class="num">Long</th><th class="num">EPA</th></tr></thead>
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
// The other team in a given week's game (for the play list's Opp column).
function weekOpponent(team, week) {
  const g = (DATA.schedule || []).find((x) => x.week === week && (x.away === team || x.home === team));
  return g ? (g.away === team ? g.home : g.away) : "";
}

// oppTeamOf(play): the team on the other side of that throw.
function renderPassZonePlayList(summary, team = null, oppTeamOf = null) {
  return summary
    .map((g) => {
      const rows = g.plays
        .slice()
        .sort((a, b) => b.week - a.week)
        .map((p) => {
          const result = p.complete
            ? `<b class="pz-play-yds">${p.yards} yds</b>`
            : p.defender
            ? `Inc &mdash; PBU ${p.defender}`
            : "Incomplete";
          const epaCls = p.epa > 0 ? "tier-good" : p.epa < 0 ? "tier-bad" : "";
          const epaSign = p.epa >= 0 ? "+" : "";
          const opp = oppTeamOf ? oppTeamOf(p) : "";
          return `<tr${p.complete ? "" : ' class="pz-play-inc"'}><td class="num">${p.week}</td><td>${opp ? `${teamLogoMini(opp, 14)} ${opp}` : ""}</td><td>${result}</td><td class="num">${p.air_yards ?? "--"}</td><td class="num">${p.complete ? p.yac ?? 0 : "--"}</td><td class="num ${epaCls}">${p.epa === null ? "--" : `${epaSign}${p.epa.toFixed(1)}`}</td></tr>`;
        })
        .join("");
      return `<div class="pass-zone-plays-player">
        <div class="stat-column-title">${team ? playerClick(team, g.name) : g.name} <span class="muted-label">(${g.position} &middot; ${g.rec}/${g.targets})</span></div>
        <table class="data-table player-odds-table pz-play-table">
          <thead><tr><th class="num">Wk</th><th>Opp</th><th>Result</th><th class="num">Air</th><th class="num">YAC</th><th class="num">EPA</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
}

// Zone at a glance: volume, catch rate, yards, how much came after the
// catch, efficiency, and big plays.
function renderPassZoneSummaryTiles(plays) {
  const att = plays.length;
  const comp = plays.filter((p) => p.complete).length;
  const yds = plays.reduce((s, p) => s + (p.complete ? p.yards || 0 : 0), 0);
  const yac = plays.reduce((s, p) => s + (p.complete ? p.yac || 0 : 0), 0);
  const epa = plays.reduce((s, p) => s + (p.epa || 0), 0);
  const big = plays.filter((p) => p.complete && (p.yards || 0) >= 20).length;
  const tile = (label, value, sub = "") => `<div class="pz-tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  return `<div class="pz-tiles">
    ${tile("Throws", att)}
    ${tile("Catches", comp, att ? `${Math.round((comp / att) * 100)}%` : "")}
    ${tile("Yards", fmt(yds, 0), comp ? `${fmt(yds / comp, 1)} / catch` : "")}
    ${tile("YAC", fmt(yac, 0), yds > 0 ? `${Math.round((yac / yds) * 100)}% of yds` : "")}
    ${tile("EPA / throw", att ? `${epa / att >= 0 ? "+" : ""}${fmt(epa / att, 2)}` : "--")}
    ${tile("20+ yd plays", big)}
  </div>`;
}

// Offense side: what THIS WEEK'S defense allows in the same zone, so the
// read is two-sided (who gets it here, and does this defense give it up).
function renderPassZoneDefenseBlock(opponent, zoneKey) {
  const zone = (DATA.pass_shot_charts[opponent] || {}).def?.zones?.[zoneKey];
  if (!zone || !zone.attempts) return `<h4 class="pass-zone-modal-subhead">${teamLogoMini(opponent)} ${opponent} Defense Here</h4><p class="no-data-note">No throws against them here yet.</p>`;
  const g = DATA.team_stats[opponent]?.games_played || 1;
  const { yds, yac } = zoneYards(zone);
  const rank = DATA.teams
    .map((t) => ({ t, z: (DATA.pass_shot_charts[t] || {}).def?.zones?.[zoneKey], gp: DATA.team_stats[t]?.games_played || 1 }))
    .filter((r) => r.z && r.z.attempts)
    .sort((a, b) => b.z.attempts / b.gp - a.z.attempts / a.gp)
    .findIndex((r) => r.t === opponent) + 1;
  const epa = zone.epa_sum / zone.attempts;

  // League context for this zone: every defense's numbers here, rates
  // pulled toward the league rate with PZ_DEF_PRIOR throws so a 2-throw
  // sample can't paint a cell. Colors are the DEFENSE's point of view
  // (green = gives up less than the league), like every allowed stat.
  const PZ_DEF_PRIOR = 8;
  const league = DATA.teams
    .map((t) => {
      const z = (DATA.pass_shot_charts[t] || {}).def?.zones?.[zoneKey];
      if (!z || !z.attempts) return null;
      const yy = zoneYards(z);
      return { t, att: z.attempts, comp: z.completions, yds: yy.yds, yac: yy.yac, epa: z.epa_sum, gp: DATA.team_stats[t]?.games_played || 1 };
    })
    .filter(Boolean);
  const sum = (k) => league.reduce((s, r) => s + r[k], 0);
  const L = { att: sum("att"), comp: sum("comp"), yds: sum("yds"), yac: sum("yac"), epa: sum("epa") };
  const shrink = (num, den, lNum, lDen, prior = PZ_DEF_PRIOR) => (num + prior * (lNum / (lDen || 1))) / (den + prior);
  const metrics = {
    vol: (r) => r.att / r.gp,
    comp: (r) => shrink(r.comp, r.att, L.comp, L.att),
    ypt: (r) => shrink(r.yds, r.att, L.yds, L.att),
    yacpc: (r) => shrink(r.yac, r.comp, L.yac, L.comp, 4),
    epa: (r) => shrink(r.epa, r.att, L.epa, L.att),
  };
  const me = league.find((r) => r.t === opponent);
  const cellAttr = (key) => {
    if (!me) return ' class="num"';
    const z = zScore(metrics[key](me), league.map(metrics[key]), true);
    return ` class="num ${tierFromZ(z)}"${alphaAttrFromZ(z)}`;
  };
  const lgAvg = {
    vol: league.length ? sum("att") / league.reduce((s, r) => s + r.gp, 0) : 0,
    comp: L.att ? L.comp / L.att : 0,
    ypt: L.att ? L.yds / L.att : 0,
    yacpc: L.comp ? L.yac / L.comp : 0,
    epa: L.att ? L.epa / L.att : 0,
  };
  const sign = (v) => `${v >= 0 ? "+" : ""}${fmt(v, 2)}`;
  // Verdict from the same sample-shrunk softness Zone Targets uses (half the
  // zone's own numbers pulled toward league average, half the opponent-
  // adjusted depth band), so a 2-throw fluke can't read "soft" -- and the
  // raw EPA below stays uncolored so the box never argues with itself.
  // (The pill and the one-line blurb below come from the same league
  // ranking of that softness, so they always agree.)
  let verdict = "";
  // One-line read: where this defense's softness here ranks league-wide,
  // from the offense's side (1st-softest = best matchup).
  let blurb = "";
  if (typeof ztDefenseSoftness === "function") {
    const all = ztDefenseSoftness();
    const ranked = Object.entries(all)
      .map(([t, zones]) => ({ t, v: zones[zoneKey] }))
      .filter((r) => r.v !== null && r.v !== undefined)
      .sort((a, b) => b.v - a.v);
    const pos = ranked.findIndex((r) => r.t === opponent);
    if (pos >= 0) {
      const n = ranked.length;
      const place = pos + 1;
      const where = zoneLabel(zoneKey).toLowerCase();
      // Soft/firm by league third OR by the same 0.5 softness line Zone
      // Targets uses for its zone chips, so the two never disagree.
      const v = ranked[pos].v;
      const isSoft = place <= Math.ceil(n / 3) || v >= 0.5;
      const isFirm = !isSoft && (place > n - Math.ceil(n / 3) || v <= -0.5);
      if (isSoft) {
        verdict = `<span class="pz-verdict pz-verdict-soft">Soft spot</span>`;
        blurb =`<p class="pz-blurb pz-blurb-good"><b>Top ${Math.max(1, Math.round((place / n) * 100))}% matchup</b> &mdash; ${opponent} is the ${ordinal(place)}-softest ${where} defense.</p>`;
      } else if (isFirm) {
        const fromBottom = n - place + 1;
        verdict = `<span class="pz-verdict pz-verdict-firm">Holds up</span>`;
        blurb =`<p class="pz-blurb pz-blurb-bad"><b>Bottom ${Math.max(1, Math.round((fromBottom / n) * 100))}% matchup</b> &mdash; ${opponent} is the ${ordinal(fromBottom)}-toughest ${where} defense.</p>`;
      } else {
        verdict = `<span class="pz-verdict">Average</span>`;
        blurb = `<p class="pz-blurb"><b>Neutral matchup</b> &mdash; ${opponent} ranks ${ordinal(place)} of ${n} in ${where} softness.</p>`;
      }
    }
  }
  return `<h4 class="pass-zone-modal-subhead">${teamLogoMini(opponent)} ${opponent} Defense Here ${verdict}</h4>
    <table class="data-table player-odds-table pass-zone-summary-table pz-def-table">
      <thead><tr><th></th><th class="num">${opponent}</th><th class="num">League avg</th></tr></thead>
      <tbody>
        <tr><td>Throws faced / game</td><td${cellAttr("vol")}>${fmt(zone.attempts / g, 1)} <span class="muted-label">(${ordinal(rank)} most)</span></td><td class="num muted-label">${fmt(lgAvg.vol, 1)}</td></tr>
        <tr><td>Completion % allowed</td><td${cellAttr("comp")}>${Math.round((zone.completions / zone.attempts) * 100)}% <span class="muted-label">(${zone.completions}/${zone.attempts})</span></td><td class="num muted-label">${Math.round(lgAvg.comp * 100)}%</td></tr>
        <tr><td>Yards / throw allowed</td><td${cellAttr("ypt")}>${fmt(yds / zone.attempts, 1)}</td><td class="num muted-label">${fmt(lgAvg.ypt, 1)}</td></tr>
        <tr><td>YAC / catch allowed</td><td${cellAttr("yacpc")}>${zone.completions ? fmt(yac / zone.completions, 1) : "--"}</td><td class="num muted-label">${fmt(lgAvg.yacpc, 1)}</td></tr>
        <tr><td>EPA / throw allowed</td><td${cellAttr("epa")}>${sign(epa)}</td><td class="num muted-label">${sign(lgAvg.epa)}</td></tr>
      </tbody>
    </table>
    ${blurb}
    <p class="pz-note">Colors vs the league from ${opponent}'s side (green = allows less), sample-adjusted for ${zone.attempts} throw${zone.attempts === 1 ? "" : "s"}.</p>`;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// On the defense side, this week's actual opponent's offense in this
// SAME zone -- "BUF's middle 10-19 is soft" is only actionable once you
// know DET (this week's opponent, not a league-wide guess) has Williams
// and LaPorta living there. Reuses the exact same player-summary table as
// the offense side's "who's getting targeted."
function renderPassZoneOpponentBlock(opponent, zoneKey) {
  const oppZone = (DATA.pass_shot_charts[opponent] || {}).off?.zones?.[zoneKey];
  const oppPlays = (oppZone && oppZone.plays) || [];
  if (!oppPlays.length) {
    return `<h4 class="pass-zone-modal-subhead">${opponent} Offense in This Zone</h4><p class="no-data-note">No attempts here yet.</p>`;
  }
  const oppSummary = passZonePlayerSummary(oppPlays);
  return `<h4 class="pass-zone-modal-subhead">${teamLogoMini(opponent)} ${opponent} Offense in This Zone</h4>${renderPassZonePlayerSummaryTable(oppSummary, opponent)}`;
}

// Everything in one wide view -- league rank, the who-to-target summary,
// and the plays themselves side by side, instead of a narrow box that
// made you toggle between them to hold two numbers in your head.
// receiver (optional): only that pass-catcher's throws in the zone -- what
// a receiver grid cell opens.
function renderPassZoneModalContent(team, side, zoneKey, opponent, receiver = null) {
  const zone = (DATA.pass_shot_charts[team] || {})[side]?.zones?.[zoneKey];
  let plays = (zone && zone.plays) || [];
  if (receiver) plays = plays.filter((p) => normName(p.receiver || "") === normName(receiver));
  const sideLabel = side === "off" ? "Offense" : "Defense Allowed";
  const who = receiver ? `${playerClick(team, receiver)} &mdash; ` : `${teamLogoMini(team)} ${team} &mdash; `;
  const heading = `${who}${zoneLabel(zoneKey)} ${receiver ? "Targets" : sideLabel}`;
  const summary = passZonePlayerSummary(plays);
  // Opponent of each throw: the defense (offense view) or the offense
  // (defense view) that team played that week.
  const oppOf = (p) => weekOpponent(team, p.week);
  const summaryBlock = !plays.length
    ? `<p class="no-data-note">No attempts in this zone yet.</p>`
    : side === "def"
    ? `<h4 class="pass-zone-modal-subhead">By Position</h4>${renderPassZonePositionTable(summary)}
       <h4 class="pass-zone-modal-subhead">By Player</h4>${renderPassZonePlayerSummaryTable(summary)}
       ${opponent ? renderPassZoneOpponentBlock(opponent, zoneKey) : ""}`
    : `${receiver ? "" : `<h4 class="pass-zone-modal-subhead">Who's Getting Targeted <span class="muted-label">(most targets first)</span></h4>${renderPassZonePlayerSummaryTable(summary, team)}`}
       ${opponent ? renderPassZoneDefenseBlock(opponent, zoneKey) : ""}`;
  return `<h3>${heading}</h3>
    ${plays.length ? renderPassZoneSummaryTiles(plays) : ""}
    <div class="pass-zone-modal-layout">
      <div class="pass-zone-modal-col pass-zone-modal-col-rank">
        <h4 class="pass-zone-modal-subhead">League Rank <span class="muted-label">(team volume)</span></h4>
        ${renderPassZoneRankTable(team, side, zoneKey)}
      </div>
      <div class="pass-zone-modal-col">
        ${summaryBlock}
      </div>
      <div class="pass-zone-modal-col pass-zone-modal-col-plays">
        ${plays.length ? `<h4 class="pass-zone-modal-subhead">Every Throw <span class="muted-label">(by player, newest first)</span></h4><div class="pass-zone-plays-wrap">${renderPassZonePlayList(summary, side === "off" ? team : null, oppOf)}</div>` : ""}
      </div>
    </div>`;
}

function openPassZoneRankModal(team, side, zoneKey, opponent, receiver = null) {
  ensurePassZoneModal();
  document.getElementById("pass-zone-modal-content").innerHTML = renderPassZoneModalContent(team, side, zoneKey, opponent, receiver);
  document.getElementById("pass-zone-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".pass-zone-rank-click");
  if (!cell) return;
  const { team, side, zoneKey, opponent, receiver } = decodeDataAttr(cell.dataset.entry);
  openPassZoneRankModal(team, side, zoneKey, opponent, receiver);
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
    return `<div class="pass-zone-identity-stat ${cls}"${alpha}><span>${label}</span><strong>${value}</strong></div>`;
  };
  return `<div class="pass-zone-identity">
    ${statRow("Lead Zone", zoneLabel(s.leadZoneKey), "leadZoneShare", s.leadZoneShare)}
    ${statRow("Deep-Target Rate", `${Math.round(s.deepRate * 100)}%`, "deepRate", s.deepRate)}
    ${statRow("Pass Rate", s.passRate === null ? "--" : `${Math.round(s.passRate * 100)}%`, "passRate", s.passRate)}
    ${statRow("Attempts", s.attempts, "attempts", s.attempts)}
  </div>`;
}

// Team-color banner (matches teamBannerHeader's look elsewhere on the
// site) doubles as the "see players" trigger on the offense side --
// clicking the team's own name/logo to drill into its players is the
// same affordance props-team-click already uses for the full prop
// catalog, so this reuses that pattern instead of a separate button
// competing for space in the header. Defense side isn't clickable --
// "who's exploiting this defense" is answered by clicking a CELL (which
// now surfaces the specific opposing offense), not by browsing this
// team's own defenders.
function passZoneTeamHeader(team, side) {
  const rgb = teamAccentRgb(team);
  const sideLabel = side === "off" ? "Passing Offense" : "Pass D Allowed";
  const clickable = side === "off";
  const cls = `pass-zone-team-banner${clickable ? " pass-zone-team-click" : ""}`;
  return `<div class="${cls}" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})"${clickable ? ` data-team="${team}"` : ""}>
    <img src="${teamLogoUrl(team)}" class="team-logo" alt="${team}" loading="lazy">
    <span class="pass-zone-team-name">${TEAM_NAMES[team] || team}</span>
    <span class="pass-zone-team-side">${sideLabel}${clickable ? " &rsaquo;" : ""}</span>
  </div>`;
}

function renderPassZoneBlock(team, side, opponent) {
  // Under a defense grid: the facing offense's pass catchers whose targets
  // land in this defense's soft zones (props-summary.js zoneTargets).
  const targets = side === "def" && opponent && typeof renderZoneTargets === "function" ? renderZoneTargets(opponent, team) : "";
  return `<div class="pass-zone-block">
    ${passZoneTeamHeader(team, side)}
    ${renderPassZoneGrid(team, side, opponent)}
    ${renderPassIdentityCard(team, side)}
    ${targets}
  </div>`;
}

// ---- Offense side, main page: one mini hotspot grid per pass-catcher
// instead of a single team-level grid with everyone's line crammed into
// each cell. Same shell as renderPlayerZoneCard (the "See All Players"
// modal card), just sized down to sit inline on the page and reused as-is
// -- clicking the team banner above still opens that modal for the full
// roster. Deliberately NOT the league-percentile rate coloring the team
// grid uses: this is "where does THIS guy actually get used," a
// self-referential heatmap (each player's own busiest zone reads darkest),
// not a comparison to the rest of the league. No % anywhere -- raw
// receptions/targets counts only, same as a broadcast target chart. */

function renderPlayerZoneMiniCard(team, name, player, oppTeam) {
  const headshot = (DATA.player_headshots[team] || {})[name];
  const photo = headshot
    ? `<img src="${headshot}" class="pass-zone-player-photo pass-zone-player-photo-mini" alt="${name}" loading="lazy">`
    : `<div class="pass-zone-player-photo pass-zone-player-photo-mini pass-zone-player-photo-blank"></div>`;
  const totalTgt = Object.values(player.zones).reduce((s, z) => s + (z.targets || 0), 0);
  return `<div class="pass-zone-player-mini-card">
    <div class="pass-zone-player-banner pass-zone-player-banner-mini player-click" data-entry="${encodeDataAttr({ team, name, oppTeam })}">
      ${photo}
      <div class="pass-zone-player-info">
        <span class="pass-zone-player-name">${name}</span>
        <span class="pass-zone-player-pos">${player.position || "?"} &middot; ${totalTgt} tgt</span>
      </div>
    </div>
    ${renderPlayerZoneHeatGrid(player.zones, oppTeam, { team, name })}
  </div>`;
}

// No target minimum -- the Receiving table's targets>=5 bar made sense for
// stabilizing a per-game RATE, but it was quietly dropping real
// pass-catchers from this raw volume view (a WR with 3 targets in Week 2
// just vanished entirely). No cap either -- a top-5 cutoff was still
// hiding real target-earners on a deep receiving corps (Carolina had more
// than 5 players with charted targets); every qualifying player shows,
// most-targeted first, sized small enough (see .pass-zone-player-mini-card)
// that a long roster still wraps into a manageable grid instead of one
// giant row.
function renderOffensePlayerZoneCards(team, side, opponent) {
  const players = DATA.player_pass_zones[team] || {};
  const totalTgt = (name) => Object.values(players[name].zones).reduce((s, z) => s + (z.targets || 0), 0);
  const names = Object.keys(players)
    .filter((n) => totalTgt(n) > 0)
    .sort((a, b) => totalTgt(b) - totalTgt(a));
  const body = names.length
    ? `<div class="pass-zone-players-inline">${names.map((n) => renderPlayerZoneMiniCard(team, n, players[n], opponent)).join("")}</div>`
    : `<p class="no-data-note">No qualifying pass-catchers yet this season.</p>`;
  return `<div class="pass-zone-block">
    ${passZoneTeamHeader(team, side)}
    ${body}
    ${renderPassIdentityCard(team, side)}
  </div>`;
}

// ---- QB perspective for the Passing tab's Pass Zones (Receiving tab's
// Target Zones keeps the per-receiver cards above -- this is a separate
// view, not a replacement). Attempts/completions by zone instead of
// targets/receptions, sourced from build_stats.py's compute_pass_shot_
// chart -- the same team-level chart the old team grid used before the
// Receiving-tab revamp, just given a QB banner and reused as-is here.
// It's genuinely the whole team's passing (any backup snaps included),
// not isolated to one arm -- no per-QB zone split exists on the backend --
// but for the one real starter most teams run out there in a given week,
// that distinction doesn't show up in practice. Always the single top
// passer by attempts regardless of the backup-QB toggle: two QBs would
// just render the same team chart twice, which isn't a second data point.
function mainPasser(team) {
  return (DATA.player_props[team] || [])
    .filter((p) => p.pass_att >= 10)
    .sort((a, b) => b.pass_att - a.pass_att)[0] || null;
}

// Yards and YAC for one zone's completions (from its play list).
function zoneYards(zone) {
  const plays = (zone && zone.plays) || [];
  let yds = 0;
  let yac = 0;
  plays.forEach((p) => {
    if (p.complete) {
      yds += p.yards || 0;
      yac += p.yac || 0;
    }
  });
  return { yds, yac };
}

function renderQbZoneHeatGrid(chart, oppTeam, team) {
  let maxAtt = 0;
  PASS_ZONE_ROWS.forEach((r) =>
    PASS_ZONE_COLS.forEach((c) => {
      const a = chart.zones[`${r.key}_${c}`]?.attempts || 0;
      if (a > maxAtt) maxAtt = a;
    })
  );
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = chart.zones[zk];
      const att = zone?.attempts || 0;
      const comp = zone?.completions || 0;
      const style = att
        ? ` style="background: rgba(var(--accent-rgb), ${(PLAYER_ZONE_HEAT_MIN_ALPHA + (att / maxAtt) * (PLAYER_ZONE_HEAT_MAX_ALPHA - PLAYER_ZONE_HEAT_MIN_ALPHA)).toFixed(2)})"`
        : "";
      const { yds, yac } = zoneYards(zone);
      const display = att ? `<b>${comp}/${att}</b><small>${fmt(yds, 0)} yds &middot; ${fmt(yac, 0)} YAC</small>` : "--";
      const tier = att && oppTeam ? defenseZoneTier(oppTeam, zk) : "";
      const exploitCls = tier === "tier-bad" ? " pass-zone-heat-cell-exploit-bad" : tier === "tier-mid" ? " pass-zone-heat-cell-exploit-mid" : "";
      // Click a zone: every throw there -- who it went to, the result, air + YAC.
      const click = att && team ? ` pass-zone-rank-click" data-entry="${encodeDataAttr({ team, side: "off", zoneKey: zk, opponent: oppTeam })}` : "";
      return `<td class="num pass-zone-heat-cell pass-zone-heat-cell-qb${exploitCls}${click}"${style}>${display}</td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label-qb">${r.short}</th>${cells}</tr>`;
  }).join("");
  // Its own (bigger) class, not the receiver row's .pass-zone-grid-mini --
  // one QB card never has to share a row with 3-4 siblings the way the
  // receiver hotspot cards do, so there's no reason to shrink it down to
  // that same size.
  return `<table class="data-table pass-zone-grid pass-zone-grid-qb">
    <thead><tr><th></th><th>L</th><th>M</th><th>R</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderQbZoneMiniCard(team, qb, chart, oppTeam) {
  const headshot = (DATA.player_headshots[team] || {})[qb.name];
  const photo = headshot
    ? `<img src="${headshot}" class="pass-zone-player-photo pass-zone-player-photo-qb" alt="${qb.name}" loading="lazy">`
    : `<div class="pass-zone-player-photo pass-zone-player-photo-qb pass-zone-player-photo-blank"></div>`;
  return `<div class="pass-zone-qb-card">
    <div class="pass-zone-player-banner pass-zone-player-banner-qb player-click" data-entry="${encodeDataAttr({ team, name: qb.name, oppTeam })}">
      ${photo}
      <div class="pass-zone-player-info">
        <span class="pass-zone-player-name pass-zone-player-name-qb">${qb.name}</span>
        <span class="pass-zone-player-pos pass-zone-player-pos-qb">QB &middot; ${chart.pass_attempts} att</span>
      </div>
    </div>
    ${renderQbZoneHeatGrid(chart, oppTeam, team)}
    <p class="pass-zone-qb-hint">Click a zone for every throw there.</p>
  </div>`;
}

function renderQbPassZoneCards(team, side, opponent) {
  const qb = mainPasser(team);
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  const body = qb && chart
    ? `<div class="pass-zone-players-inline pzm-row">${renderQbZoneMiniCard(team, qb, chart, opponent)}${opponent ? renderZoneMatchupPanel(team, opponent) : ""}</div>`
    : `<p class="no-data-note">No qualifying passers yet this season.</p>`;
  return `<div class="pass-zone-block">
    ${passZoneTeamHeader(team, side)}
    ${body}
    ${renderPassIdentityCard(team, side)}
    ${qb && chart && opponent ? renderZoneMatchupRead(team, opponent) : ""}
  </div>`;
}

// ---- Zone matchup: this offense vs this week's defense, by depth and side ----
// Each depth row (20+ / 10-19 / 0-9 / SCR) rolls up its 3 zones, each side
// (L / M / R) its 4 depths -- the same numbers the zone popup shows, per
// group: catch %, yards/throw, YAC/catch, EPA/throw, success rate.
// Game script: throws in garbage time (win prob under 10% or over 90%, the
// build's "gt" flag) count HALF, so a defense that sat on big leads isn't
// punished for soft prevent yards, and the read uses only per-throw
// efficiency -- never throw volume, which is what game script inflates.
// Rates are pulled toward the league with PZM_PRIOR throws. Offense and
// defense are each graded against the league at that same group, then read
// with the two-sided matchup rule; the % is where this pairing ranks among
// every offense-vs-defense pairing in the league for that group.
const PZM_PRIOR = 10;
const PZM_WEIGHTS = { epa: 0.35, ypt: 0.25, succ: 0.2, comp: 0.1, yacpc: 0.1 };
function pzmGroups() {
  return [
    ...PASS_ZONE_ROWS.map((r) => ({ key: r.key, label: r.short, zones: PASS_ZONE_COLS.map((c) => `${r.key}_${c}`), kind: "depth" })),
    ...PASS_ZONE_COLS.map((c) => ({ key: c, label: c[0].toUpperCase() + c.slice(1), zones: PASS_ZONE_ROWS.map((r) => `${r.key}_${c}`), kind: "side" })),
  ];
}
function pzmAgg(team, side, zones) {
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  // Weighted sums (garbage time = half) drive the grades; raw sums are what
  // gets displayed.
  const a = { w: 0, n: 0, compN: 0, comp: 0, yds: 0, yac: 0, epa: 0, succ: 0, rYds: 0, rYac: 0, rEpa: 0, total: chart?.pass_attempts || 0 };
  zones.forEach((zk) =>
    ((chart?.zones?.[zk]?.plays) || []).forEach((p) => {
      const wt = p.gt ? 0.5 : 1;
      a.n += 1;
      a.w += wt;
      if (p.complete) {
        a.compN += 1;
        a.comp += wt;
        a.yds += wt * (p.yards || 0);
        a.yac += wt * (p.yac || 0);
        a.rYds += p.yards || 0;
        a.rYac += p.yac || 0;
      }
      a.epa += wt * (p.epa || 0);
      a.rEpa += p.epa || 0;
      a.succ += wt * (p.s || 0);
    })
  );
  a.raw = {
    comp: a.n ? a.compN / a.n : null,
    ypt: a.n ? a.rYds / a.n : null,
    yacpc: a.compN ? a.rYac / a.compN : null,
    epa: a.n ? a.rEpa / a.n : null,
  };
  return a;
}
// League table for one group + side: every team's shrunk rates and z's.
function pzmLeague(groupKey, zones, side) {
  pzmLeague.cache = pzmLeague.cache || {};
  const ck = `${groupKey}|${side}`;
  if (pzmLeague.cache[ck]) return pzmLeague.cache[ck];
  const rows = DATA.teams.map((t) => ({ t, a: pzmAgg(t, side, zones) }));
  const L = rows.reduce((s, r) => ({ w: s.w + r.a.w, comp: s.comp + r.a.comp, yds: s.yds + r.a.yds, yac: s.yac + r.a.yac, epa: s.epa + r.a.epa, succ: s.succ + r.a.succ }), { w: 0, comp: 0, yds: 0, yac: 0, epa: 0, succ: 0 });
  const sh = (num, den, lNum, lDen, prior = PZM_PRIOR) => (num + prior * (lDen ? lNum / lDen : 0)) / (den + prior);
  rows.forEach((r) => {
    r.m = {
      comp: sh(r.a.comp, r.a.w, L.comp, L.w),
      ypt: sh(r.a.yds, r.a.w, L.yds, L.w),
      yacpc: sh(r.a.yac, r.a.comp, L.yac, L.comp, 4),
      epa: sh(r.a.epa, r.a.w, L.epa, L.w),
      succ: sh(r.a.succ, r.a.w, L.succ, L.w),
    };
  });
  Object.keys(PZM_WEIGHTS).forEach((k) => {
    const pool = rows.map((r) => r.m[k]);
    rows.forEach((r) => ((r.z = r.z || {}), (r.z[k] = zScore(r.m[k], pool, false) || 0)));
  });
  rows.forEach((r) => (r.score = Object.entries(PZM_WEIGHTS).reduce((s, [k, w]) => s + w * r.z[k], 0)));
  const out = { byTeam: Object.fromEntries(rows.map((r) => [r.t, r])) };
  pzmLeague.cache[ck] = out;
  return out;
}
// This pairing's read for one group: z's, label, top/bottom %.
function pzmRead(group, offTeam, defTeam) {
  const off = pzmLeague(group.key, group.zones, "off");
  const def = pzmLeague(group.key, group.zones, "def");
  const o = off.byTeam[offTeam];
  const d = def.byTeam[defTeam];
  if (!o || !d) return null;
  const score = (o.score + d.score) / 2;
  const all = [];
  Object.values(off.byTeam).forEach((x) => Object.values(def.byTeam).forEach((y) => all.push((x.score + y.score) / 2)));
  const better = all.filter((s) => s > score).length;
  const topPct = Math.max(1, Math.ceil(((better + 1) / all.length) * 100));
  const contra = (o.score >= TIER_Z_THRESHOLD && d.score <= -MATCHUP_CONTRA) || (d.score >= TIER_Z_THRESHOLD && o.score <= -MATCHUP_CONTRA);
  let label = "Neutral";
  let cls = "";
  if (contra) label = "Mixed";
  else if (topPct <= 33) {
    label = `Top ${topPct}%`;
    cls = "pzm-good";
  } else if (topPct > 67) {
    label = `Bottom ${101 - topPct}%`;
    cls = "pzm-bad";
  }
  return { o, d, score, topPct, label, cls, share: o.a.total ? o.a.n / o.a.total : 0 };
}

function renderZoneMatchupPanel(offTeam, defTeam) {
  const cell = (v, z, fmtV, defSide) => {
    const zz = defSide ? -z : z; // defense colored from its own side
    return `<span class="pzm-v ${tierFromZ(zz)}"${alphaAttrFromZ(zz)}>${v === null || v === undefined ? "--" : fmtV(v)}</span>`;
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const one = (v) => fmt(v, 1);
  const epa = (v) => `${v >= 0 ? "+" : ""}${fmt(v, 2)}`;
  const rowsFor = (kind) =>
    pzmGroups()
      .filter((g) => g.kind === kind)
      .map((g) => {
        const r = pzmRead(g, offTeam, defTeam);
        if (!r) return "";
        const pair = (k, f) => `<td class="num pzm-pair">${cell(r.o.a.raw[k], r.o.z[k], f, false)}${cell(r.d.a.raw[k], r.d.z[k], f, true)}</td>`;
        return `<tr>
          <td class="pzm-label">${g.label}</td>
          <td class="num pzm-share">${pct(r.share)}</td>
          ${pair("comp", pct)}${pair("ypt", one)}${pair("yacpc", one)}${pair("epa", epa)}
          <td class="num"><span class="pzm-chip ${r.cls}">${r.label}</span></td>
        </tr>`;
      })
      .join("");
  const head = (first) => `<tr><th>${first}</th><th class="num" title="Share of ${offTeam}'s throws">Share</th><th class="num">Catch%</th><th class="num">Yds/T</th><th class="num">YAC/C</th><th class="num">EPA/T</th><th class="num">Matchup</th></tr>`;
  return `<div class="pzm-panel">
    <div class="pzm-title">${teamLogoMini(offTeam, 16)} ${offTeam} vs ${teamLogoMini(defTeam, 16)} ${defTeam} pass D</div>
    <div class="pzm-key"><span>${offTeam} gets</span><span>${defTeam} allows</span></div>
    <table class="data-table pzm-table">
      <thead>${head("Depth")}</thead>
      <tbody>${rowsFor("depth")}</tbody>
      <thead>${head("Side")}</thead>
      <tbody>${rowsFor("side")}</tbody>
    </table>
    <p class="pz-note">Each pair: ${offTeam}'s number, then what ${defTeam} allows (colored vs the league from each unit's side). Garbage-time throws count half; rates are sample-adjusted.</p>
  </div>`;
}

// Short overall read under the lead-zone tiles: the pass game as a whole
// (depths weighted by how often this offense throws there), plus the best
// and toughest spots it actually uses.
function renderZoneMatchupRead(offTeam, defTeam) {
  const depth = pzmGroups().filter((g) => g.kind === "depth").map((g) => ({ g, r: pzmRead(g, offTeam, defTeam) })).filter((x) => x.r);
  const all = pzmGroups().map((g) => ({ g, r: pzmRead(g, offTeam, defTeam) })).filter((x) => x.r && x.r.share >= 0.1);
  if (!depth.length) return "";
  // Overall: share-weighted depth score vs every pairing's share-weighted score.
  const weighted = (o, d) => depth.reduce((s, x) => {
    const off = pzmLeague(x.g.key, x.g.zones, "off").byTeam[o];
    const def = pzmLeague(x.g.key, x.g.zones, "def").byTeam[d];
    const share = off.a.total ? off.a.n / off.a.total : 0;
    return s + share * (off.score + def.score) / 2;
  }, 0);
  const mine = weighted(offTeam, defTeam);
  const scores = [];
  DATA.teams.forEach((o) => DATA.teams.forEach((d) => o !== d && scores.push(weighted(o, d))));
  const top = Math.max(1, Math.ceil(((scores.filter((s) => s > mine).length + 1) / scores.length) * 100));
  const overall = top <= 33 ? { t: `Top ${top}% passing matchup`, c: "pzm-good" } : top > 67 ? { t: `Bottom ${101 - top}% passing matchup`, c: "pzm-bad" } : { t: "Neutral passing matchup", c: "" };
  const sorted = all.slice().sort((a, b) => a.r.topPct - b.r.topPct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const chip = (x, pre) => `<span class="pzm-read-item"><small>${pre}</small><b>${x.g.label}</b><span class="pzm-chip ${x.r.cls}">${x.r.label}</span></span>`;
  return `<div class="pzm-read">
    <span class="pzm-read-main ${overall.c}">${overall.t}</span>
    ${best ? chip(best, "Best spot") : ""}
    ${worst && worst !== best ? chip(worst, "Toughest") : ""}
  </div>`;
}

// ---- Per-player target zones ("See Players") -- who actually gets
// targeted where, the offense-side complement to the team grid above.
// Same visual grid, sourced from build_stats.py's compute_player_pass_
// zone_splits instead of the team aggregate. Pattern-matched on the
// per-player rush lanes list (renderRushLanesPlayers). ----
function passZonePlayerRate(zone) {
  return zone && zone.targets ? zone.receptions / zone.targets : null;
}
function passZonePlayerPool(zoneKey) {
  const pool = [];
  for (const players of Object.values(DATA.player_pass_zones || {})) {
    for (const p of Object.values(players)) {
      const rate = passZonePlayerRate(p.zones[zoneKey]);
      if (rate !== null) pool.push(rate);
    }
  }
  return pool;
}
function renderPlayerPassZoneGrid(zones, team) {
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = zones[zk];
      const rate = passZonePlayerRate(zone);
      const cls = rate === null ? "" : percentileTier(rate, passZonePlayerPool(zk), false);
      const rateDisplay = rate === null ? "--" : `${Math.round(rate * 100)}%`;
      return `<td class="num pass-zone-cell ${cls}"><span class="pass-zone-rate">${rateDisplay}</span></td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label">${r.label}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid">
    <thead>${passZoneGridHeader(team)}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}
// Photo + name + position banner above each player's grid -- the same
// "who am I even looking at" context a real broadcast graphic gives you,
// instead of a plain text label. Falls back to a blank placeholder (not a
// broken image) when nflverse doesn't have a headshot on file for someone.
function renderPlayerZoneCard(team, name, player) {
  const headshot = (DATA.player_headshots[team] || {})[name];
  const photo = headshot
    ? `<img src="${headshot}" class="pass-zone-player-photo" alt="${name}" loading="lazy">`
    : `<div class="pass-zone-player-photo pass-zone-player-photo-blank"></div>`;
  const totalTgt = Object.values(player.zones).reduce((s, z) => s + z.targets, 0);
  return `<div class="pass-zone-block">
    <div class="pass-zone-player-banner player-click" data-entry="${encodeDataAttr({ team, name })}">
      ${photo}
      <div class="pass-zone-player-info">
        <span class="pass-zone-player-name">${name}</span>
        <span class="pass-zone-player-pos">${player.position || "?"} &middot; ${totalTgt} tgt</span>
      </div>
    </div>
    ${renderPlayerPassZoneGrid(player.zones, team)}
  </div>`;
}
function renderPassZoneAllPlayersContent(team) {
  const heading = `<h3>${teamLogoMini(team)} ${TEAM_NAMES[team] || team} &mdash; Target Zones by Player</h3>`;
  const players = DATA.player_pass_zones[team] || {};
  const totalTargets = (name) => Object.values(players[name].zones).reduce((s, z) => s + z.targets, 0);
  const names = Object.keys(players)
    .filter((n) => totalTargets(n) > 0)
    .sort((a, b) => totalTargets(b) - totalTargets(a));
  if (!names.length) return `${heading}<p class="no-data-note">No charted targets yet this season.</p>`;
  const blocks = names.map((name) => renderPlayerZoneCard(team, name, players[name])).join("");
  return `${heading}<div class="stat-columns pass-zone-players-grid">${blocks}</div>`;
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
  const banner = e.target.closest(".pass-zone-team-click");
  if (!banner) return;
  openPassZoneAllPlayersModal(banner.dataset.team);
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
// as every other percentile cell on the site, with an adjustable invert
// direction so it can serve a defense "allowed" stat (invert=true,
// lower=green) or a neutral team tendency (invert=false), reused by both
// the scramble-containment and red-zone-mix panels below.
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
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${playerClick(r.team, r.name)}</td><td class="num ${cls}"${alpha}>${Math.round(r.value * 100)}%</td></tr>`;
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

// ---- QB card (Passing tab): one tidy block per starter ----
// Replaces the loose Passing table / Coverage & Pressure / QB Rushing / Red
// Zone stack. Order, top to bottom: header (photo, name, sample), eight
// equal season tiles, his posted lines, a 2x2 of equal boxes (matchup vs
// this week's pass D, pressure splits, QB rushing, red zone), then his
// recent weeks shaded against his own games.

// Y/A and TD/G aren't build fields -- derived once from the game logs onto
// the QB rows so tiles, pools and the rank popup all read them the same way.
function enrichQbRows() {
  if (enrichQbRows.done) return;
  enrichQbRows.done = true;
  for (const [team, rows] of Object.entries(DATA.player_props || {})) {
    rows
      .filter((p) => p.position === "QB" && p.pass_att)
      .forEach((p) => {
        const logs = (pcGameLogs(team, p.name) || { logs: [] }).logs.filter((r) => r.pass_att > 0);
        const td = logs.reduce((s, r) => s + (r.pass_td || 0), 0);
        const games = p.pass_games || logs.length || 1;
        p.ypa = p.pass_yards / p.pass_att;
        p.pass_td_per_g = td / games;
      });
  }
}

const QB_TILES = [
  { key: "pass_att_per_g", label: "Att/G", tip: "Pass Attempts/Game" },
  { key: "comp_pct", label: "Cmp%", tip: "Completion %", percent: true },
  { key: "pass_yards_per_g", label: "Yds/G", tip: "Passing Yards/Game" },
  { key: "ypa", label: "Y/A", tip: "Yards per Attempt" },
  { key: "pass_td_per_g", label: "TD/G", tip: "Passing TDs/Game", digits: 2 },
  { key: "int_per_g", label: "INT/G", tip: "Interceptions/Game", digits: 2, invert: true },
  { key: "epa_per_att", label: "EPA/Att", tip: "EPA per Attempt", digits: 2 },
  { key: "adot_thrown", label: "ADOT", tip: "Average Depth of Target" },
];

function qbTile(p, t) {
  const v = p[t.key];
  const display = v === null || v === undefined ? "--" : t.percent ? `${Math.round(v * 100)}%` : fmt(v, t.digits ?? 1);
  let cls = "";
  let alpha = "";
  if (v !== null && v !== undefined) {
    const pool = passStatPool(t.key);
    cls = percentileTier(v, pool, !!t.invert);
    alpha = tierAlphaAttr(v, pool, !!t.invert);
  }
  const payload = { team: p.team, name: p.name, statKey: t.key, label: t.tip, invert: !!t.invert, percent: !!t.percent, digits: t.digits };
  return `<div class="qb-tile ${cls} player-stat-rank-click"${alpha} data-entry="${encodeDataAttr(payload)}" title="${t.tip} -- click for every QB"><span>${t.label}</span><b>${display}</b></div>`;
}

// QB vs what this week's defense allows -- both sides of every row, and
// the edge only when the two-sided rule (matchupCall) says so.
const QB_MATCHUP_ROWS = [
  { label: "Cmp%", qbKey: "comp_pct", defKey: "comp_pct_allowed", percent: true },
  { label: "Y/A", qbKey: "ypa", defKey: "yards_per_att_allowed" },
  { label: "Yds/G", qbKey: "pass_yards_per_g", defKey: "pass_yards_allowed_per_g", digits: 0 },
  { label: "TD/G", qbKey: "pass_td_per_g", defKey: "pass_td_allowed_per_g", digits: 2 },
  { label: "EPA/Att", qbKey: "epa_per_att", defKey: "epa_per_play_pass_allowed", digits: 2 },
];
function qbMatchupTable(p, team, oppTeam) {
  const qbPool = (key) => passStatPool(key);
  const teamPool = (key) => teamsWithGames().map((t) => DATA.team_stats[t]?.[key]).filter((v) => v !== null && v !== undefined);
  const fmtV = (v, r) => (v === null || v === undefined ? "--" : r.percent ? `${Math.round(v * 100)}%` : fmt(v, r.digits ?? 1));
  const rows = QB_MATCHUP_ROWS.map((r) => {
    const qv = p[r.qbKey];
    const dv = DATA.team_stats[oppTeam]?.[r.defKey];
    const qz = qv === null || qv === undefined ? null : zScore(qv, qbPool(r.qbKey), false);
    const dz = dv === null || dv === undefined ? null : zScore(dv, teamPool(r.defKey), false);
    const call = matchupCall(qz, dz);
    const edgeTeam = call.dir > 0 ? team : call.dir < 0 ? oppTeam : null;
    const edge = edgeTeam
      ? `<td class="edge-cell edge-hit" style="background:rgba(${teamAccentRgb(edgeTeam).join(",")},0.16)">${teamLogoMini(edgeTeam)}</td>`
      : `<td class="edge-cell">--</td>`;
    const qCls = qv === null || qv === undefined ? "" : `${percentileTier(qv, qbPool(r.qbKey), false)}`;
    const qA = qv === null || qv === undefined ? "" : tierAlphaAttr(qv, qbPool(r.qbKey), false);
    return `<tr><td>${r.label}</td><td class="num ${qCls}"${qA}>${fmtV(qv, r)}</td>${teamRateCell(oppTeam, r.defKey, `${r.label} Allowed`, { percent: !!r.percent, digits: r.digits, invert: true })}${edge}</tr>`;
  }).join("");
  return `<table class="data-table qb-box-table">
    <thead><tr><th></th><th class="num">${playerClick(team, p.name, shortName(p.name))}</th><th class="num">${teamLogoMini(oppTeam, 16)} Allows</th><th class="edge-hdr">Edge</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function qbPressureTable(p, team, oppTeam) {
  const splits = (DATA.player_pass_splits[team] || {})[p.name];
  if (!splits) return `<p class="no-data-note">No charted pressure data yet.</p>`;
  const rows = PASS_SPLIT_ROWS.map((r) => {
    const cond = splits[r.key] || {};
    const successPool = passSplitPool(r.key, "success");
    return `<tr>
      <td>${r.label}</td>
      ${passSplitOppRateCell(oppTeam, r.tendKey, r.tendLabel)}
      ${passSplitRateCell(cond.comp_pct, passSplitPool(r.key, "comp_pct"), { team, name: p.name, condition: r.key, stat: "comp_pct", label: `${r.label} Comp %`, percent: true })}
      ${passSplitRateCell(cond.ypa, passSplitPool(r.key, "ypa"), { team, name: p.name, condition: r.key, stat: "ypa", label: `${r.label} YPA`, digits: 1 })}
      ${passSplitRateCell(cond.success, successPool, { team, name: p.name, condition: r.key, stat: "success", label: `${r.label} Success %`, percent: true })}
    </tr>`;
  }).join("");
  return `<table class="data-table qb-box-table">
    <thead><tr><th></th><th class="num" title="How often ${oppTeam} gets pressure / lets the QB sit clean">${teamLogoMini(oppTeam, 16)} Rate</th><th class="num">Cmp%</th><th class="num">YPA</th><th class="num">Succ%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function qbRushTable(p, team, oppTeam) {
  const s = (DATA.player_scramble_splits[team] || {})[p.name];
  const scr = !s
    ? ""
    : SCRAMBLE_ROWS.map((r) => {
        const pool = scrambleRatePool(r.rateField);
        return `<tr><td>Scramble when ${r.label === "Pressured" ? "pressured" : "clean"}</td>${scrambleRateCell(s[r.rateField], pool, { team, name: p.name, field: r.rateField, label: `${r.label} Scramble Rate` })}${teamRateCell(oppTeam, r.oppRateKey, `Opp Scramble Rate Allowed (${r.label})`, { percent: true, invert: true })}</tr>`;
      }).join("");
  const car = (p.designed_carries || 0) + (p.scramble_carries || 0);
  const yds = (p.designed_rush_yards || 0) + (p.scramble_rush_yards || 0);
  const games = p.pass_games || 1;
  const ypc = car ? yds / car : null;
  return `<table class="data-table qb-box-table">
    <thead><tr><th></th><th class="num">${shortName(p.name)}</th><th class="num">${teamLogoMini(oppTeam, 16)} Allows</th></tr></thead>
    <tbody>
      ${scr}
      <tr><td>Rush att / game</td><td class="num">${fmt(car / games, 1)}</td>${teamRateCell(oppTeam, "rush_att_allowed_qb_per_g", "QB Rush Att Allowed/G", { digits: 1, invert: true })}</tr>
      <tr><td>Rush yds / game</td><td class="num">${fmt(yds / games, 1)}</td><td class="num muted-label">${ypc === null ? "--" : `${fmt(ypc, 1)} ypc`}</td></tr>
    </tbody>
  </table>`;
}

function qbRedZoneTable(team, oppTeam) {
  const rows = RZ_MIX_ROWS.map(
    (r) => `<tr>
      <td>${r.label}</td>
      ${teamRateCell(team, r.rateKey, `${r.label} Rate (Red Zone)`, { percent: true })}
      ${teamRateCell(team, r.tdKey, `${r.label} TD Rate (Red Zone)`, { percent: true })}
      ${teamRateCell(oppTeam, r.oppRateKey, `Opp ${r.label} Rate Allowed (Red Zone)`, { percent: true })}
      ${teamRateCell(oppTeam, r.oppTdKey, `Opp ${r.label} TD Rate Allowed (Red Zone)`, { percent: true, invert: true })}
    </tr>`
  ).join("");
  return `<table class="data-table qb-box-table">
    <thead><tr><th></th><th class="num">${teamLogoMini(team, 16)} Mix</th><th class="num">TD%</th><th class="num">${teamLogoMini(oppTeam, 16)} Mix</th><th class="num">TD% Alw</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Always exactly one line tall (chips that don't fit are cut off, "All
// lines" stays pinned right) and always present, so the two teams' cards
// line up box for box even when only one QB has lines posted.
function qbLinesStrip(p, team) {
  // Passing markets first -- they're the QB lines people look for.
  const rows = playerPropsAcrossMarkets(team, p.name).sort((a, b) => b.marketKey.startsWith("passing") - a.marketKey.startsWith("passing"));
  const chips = rows.length
    ? rows.map((r) => `<span class="qb-line">${r.market} <b>${fmt(r.line, 1)}</b></span>`).join("")
    : `<span class="qb-line-none">No lines posted yet this week</span>`;
  return `<div class="qb-lines"><div class="qb-lines-chips">${chips}</div><span class="qb-line-hint">${playerClick(team, p.name, rows.length ? "All lines &rsaquo;" : "Player card &rsaquo;")}</span></div>`;
}

function qbRecentWeeks(p, team) {
  const found = pcGameLogs(team, p.name);
  const rows = found ? found.logs.filter((r) => r.pass_att > 0).slice(0, 6) : [];
  if (!rows.length) return "";
  const oppFor = (r) => r.opp || "";
  return pcLogTable(
    "Recent weeks",
    [
      { label: "Wk", raw: (r) => r.week, cls: "num" },
      { label: "Opp", raw: (r) => `${teamLogoMini(oppFor(r), 16)} ${oppFor(r)}` },
      { label: "Cmp", get: (r) => r.completions },
      { label: "Att", get: (r) => r.pass_att },
      { label: "Yds", get: (r) => r.pass_yards, fmt: (v) => fmt(v, 0) },
      { label: "Y/A", get: (r) => r.pass_yards / r.pass_att, fmt: (v) => fmt(v, 1) },
      { label: "TD", get: (r) => r.pass_td },
      { label: "INT", get: (r) => r.interceptions, invert: true },
      { label: "Long", get: (r) => r.longest_pass, fmt: (v) => fmt(v, 0) },
    ],
    rows
  );
}

function renderQbCards(team, oppTeam) {
  enrichQbRows();
  const players = qualifyingPassers(team);
  if (!players.length) return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying passers yet this season.</p>`;
  const cards = players
    .map((p) => {
      const games = p.pass_games || 0;
      const box = (title, inner) => `<div class="qb-box"><div class="qb-box-title">${title}</div>${inner}</div>`;
      return `<div class="qb-card">
        <div class="qb-hero player-click" data-entry="${encodeDataAttr({ team, name: p.name, oppTeam })}">
          ${summaryHeadshot(team, p.name, 60)}
          <div class="qb-hero-id"><div class="qb-hero-name">${p.name}</div><div class="qb-hero-sub">QB &middot; ${games} game${games === 1 ? "" : "s"} &middot; ${p.pass_att} att</div></div>
        </div>
        <div class="qb-tiles">${QB_TILES.map((t) => qbTile(p, t)).join("")}</div>
        ${qbLinesStrip(p, team)}
        <div class="qb-boxes">
          ${box(`vs ${teamLogoMini(oppTeam, 16)} ${oppTeam} pass D`, qbMatchupTable(p, team, oppTeam))}
          ${box("Pressure", qbPressureTable(p, team, oppTeam))}
          ${box("QB rushing", qbRushTable(p, team, oppTeam))}
          ${box("Red zone", qbRedZoneTable(team, oppTeam))}
        </div>
        ${qbRecentWeeks(p, team)}
      </div>`;
    })
    .join("");
  return `${teamBannerHeader(team, true)}${cards}`;
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
        <td>${teamLogoMini(p.team)} ${playerClick(p.team, p.name)} <span class="muted-label">(${p.position || "?"})</span></td>
        <td class="num props-line">${fmt(p.line, 1)}</td>
        <td class="num">${ouCheckboxCell(showOdds(p.over_odds), over)}</td>
        <td class="num">${ouCheckboxCell(showOdds(p.under_odds), under)}</td>
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
  document.getElementById("props-modal-content").innerHTML = renderPropsModalContent(awayTeam, homeTeam);
  document.getElementById("props-modal").hidden = false;
}




document.addEventListener("click", (e) => {
  // Player names/photos open the shared player card (player-card.js).
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

const ALL_SECTIONS = ["receiving", "rushing", "passing", "summary"];

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
  btn.addEventListener("click", () => {
    setActivePropsView(btn.dataset.view);
    if (btn.dataset.view === "summary") render();
  });
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

  document.querySelectorAll(".pass-zone-mode-toggle").forEach((el) => (el.innerHTML = renderPassZoneColorToggle()));
  document.getElementById("col-away-receiving").innerHTML = renderReceivingTeamTable(away, home);
  document.getElementById("col-home-receiving").innerHTML = renderReceivingTeamTable(home, away);
  document.getElementById("col-away-rushing").innerHTML = renderRushingTable(away, home);
  document.getElementById("col-away-rushlanes").innerHTML = renderRushLanesPlayers(away, home);
  document.getElementById("col-home-rushing").innerHTML = renderRushingTable(home, away);
  document.getElementById("col-home-rushlanes").innerHTML = renderRushLanesPlayers(home, away);
  document.getElementById("col-away-qb").innerHTML = renderQbCards(away, home);
  document.getElementById("col-home-qb").innerHTML = renderQbCards(home, away);
  document.getElementById("col-away-passzones-off").innerHTML = renderQbPassZoneCards(away, "off", home);
  document.getElementById("col-away-passzones-def").innerHTML = renderPassZoneBlock(away, "def", home);
  document.getElementById("col-home-passzones-off").innerHTML = renderQbPassZoneCards(home, "off", away);
  document.getElementById("col-home-passzones-def").innerHTML = renderPassZoneBlock(home, "def", away);
  document.getElementById("col-away-recvzones-off").innerHTML = renderOffensePlayerZoneCards(away, "off", home);
  document.getElementById("col-away-recvzones-def").innerHTML = renderPassZoneBlock(away, "def", home);
  document.getElementById("col-home-recvzones-off").innerHTML = renderOffensePlayerZoneCards(home, "off", away);
  document.getElementById("col-home-recvzones-def").innerHTML = renderPassZoneBlock(home, "def", away);

  // Only built while it's showing -- it projects every line in the game.
  if (currentPropsView === "summary") renderPropsSummaryCard(away, home);

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
