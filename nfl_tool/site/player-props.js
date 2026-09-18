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
function renderReceivingTeamTable(team, oppTeam) {
  let rows = (DATA.player_props[team] || []).filter((p) => p.targets > 0);
  if (!rows.length) {
    return `${teamBannerHeader(team, true)}<p class="no-data-note">No qualifying pass-catchers yet this season.</p>`;
  }
  if (receivingSort.key) {
    const getVal = (p) => {
      const zones = ((DATA.player_pass_zones[p.team] || {})[p.name] || {}).zones;
      const share = playerZoneDepthShare(zones, receivingSort.key);
      return share === null ? -1 : share;
    };
    rows = [...rows].sort((a, b) => (receivingSort.dir === "desc" ? getVal(b) - getVal(a) : getVal(a) - getVal(b)));
  } else {
    rows = [...rows].sort((a, b) => b.targets - a.targets);
  }

  const statHeader = (label, statKey, opts = {}) =>
    `<th class="num receiving-col-rank-click" data-entry="${encodeDataAttr({ statKey, label, ...opts })}">${label}</th>`;
  const distHeader = ({ key, label }) => {
    const active = receivingSort.key === key;
    const arrow = active ? (receivingSort.dir === "desc" ? " ▼" : " ▲") : "";
    return `<th class="num receiving-dist-sort-click${active ? " active" : ""}" data-rowkey="${key}">${label}${arrow}</th>`;
  };

  const body = rows
    .map((p) => {
      const zones = ((DATA.player_pass_zones[p.team] || {})[p.name] || {}).zones;
      const distCells = RECEIVING_DIST_COLS.map((r) => {
        const share = playerZoneDepthShare(zones, r.key);
        if (share === null) return `<td class="num">--</td>`;
        const pool = playerZoneDepthSharePool(r.key);
        const cls = percentileTier(share, pool, false);
        const alpha = tierAlphaAttr(share, pool, false);
        return `<td class="num ${cls}"${alpha}>${Math.round(share * 100)}%</td>`;
      }).join("");
      return `<tr>
        <td><span class="player-name player-click" data-entry="${encodeDataAttr({ team: p.team, name: p.name, oppTeam })}">${p.name}</span></td>
        <td>${p.position}</td>
        <td class="num">${fmt(p.targets_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_per_g, 1)}</td>
        <td class="num">${fmt(p.rec_yards_per_g, 1)}</td>
        <td class="num">${p.adot != null ? fmt(p.adot, 1) : "--"}</td>
        <td class="num">${p.yac_per_rec != null ? fmt(p.yac_per_rec, 1) : "--"}</td>
        <td class="num">${p.target_share != null ? Math.round(p.target_share * 100) + "%" : "--"}</td>
        <td class="num">${p.snap_pct != null ? Math.round(p.snap_pct * 100) + "%" : "--"}</td>
        ${distCells}
      </tr>`;
    })
    .join("");

  return `${teamBannerHeader(team, true)}
    <table class="data-table props-rec-table">
      <thead><tr>
        <th class="lb-player">Player</th>
        <th class="lb-pos">Pos</th>
        ${statHeader("Tgt/g", "targets_per_g")}
        ${statHeader("Rec/g", "rec_per_g")}
        ${statHeader("Yds/g", "rec_yards_per_g")}
        ${statHeader("ADOT", "adot")}
        ${statHeader("YAC", "yac_per_rec")}
        ${statHeader("Tgt%", "target_share", { percent: true })}
        ${statHeader("Snap%", "snap_pct", { percent: true })}
        ${RECEIVING_DIST_COLS.map(distHeader).join("")}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// League-wide rank for one Receiving-table column, across every
// qualifying pass-catcher on ANY team (not position-scoped -- a TE and a
// WR on the same list, position shown per row for context) -- opened by
// clicking that column's header, same "click a label, see everyone"
// pattern as the rest of the site.
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
      return `<tr><td>${teamLogoMini(r.team)} ${r.name} <span class="muted-label">(${r.position})</span></td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
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
  const rankTh = e.target.closest(".receiving-col-rank-click");
  if (rankTh) {
    const { statKey, label, invert, percent, digits } = decodeDataAttr(rankTh.dataset.entry);
    openReceivingColumnRankModal(statKey, label, { invert, percent, digits });
    return;
  }
  const sortTh = e.target.closest(".receiving-dist-sort-click");
  if (sortTh) {
    const rowKey = sortTh.dataset.rowkey;
    receivingSort = receivingSort.key === rowKey ? { key: rowKey, dir: receivingSort.dir === "desc" ? "asc" : "desc" } : { key: rowKey, dir: "desc" };
    const away = document.getElementById("away-select").value;
    const home = document.getElementById("home-select").value;
    document.getElementById("col-away-receiving").innerHTML = renderReceivingTeamTable(away, home);
    document.getElementById("col-home-receiving").innerHTML = renderReceivingTeamTable(home, away);
  }
});

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

// League-wide success-rate pool per lane -- every player with a qualifying
// sample in DATA.player_rush_zones, regardless of position. Tiering a
// back's own lane success against this answers "does he actually run well
// to that side" (vs. the league), not just "well relative to his other
// lanes."
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

// The individual-player complement to renderRushLanesPlayers below: this
// player's own success rate/YPC and usage frequency per lane, paired with
// the SAME opponent-allowed box -- "does this back like this lane, is he
// actually good at it, and is this defense's own weak side lined up with
// it." Reachable by clicking ANY player's name (the shared player-detail
// modal's "Rush Lanes" tab), including a receiver/QB who also carries --
// not redundant with the main page's per-team view below, which only
// covers that team's own qualifying rushers in place. No click-through-
// to-rank-modal here (a single player's number isn't a team to rank
// against other teams).
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
        <div class="rush-lanes-team-tag">${p.name} <span class="muted-label">(${p.position})</span></div>
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
// short=0-9, screen=behind the LOS). Spelled out now that each grid gets
// a real row-label box instead of a cramped narrow column (see
// .pass-zone-row-label) -- there's room.
const PASS_ZONE_ROWS = [
  { key: "deep", label: "20+ yards", short: "20+" },
  { key: "intermediate", label: "10-19 yards", short: "10-19" },
  { key: "short", label: "0-9 yards", short: "0-9" },
  { key: "screen", label: "SCREEN", short: "SCR" },
];
const PASS_ZONE_COLS = ["left", "middle", "right"];

// Completion rate -- no longer the headline % on the cell (that's volume
// share now, see passZoneVolumeShare/passZoneCellDefenseDetail) or what
// drives the cell color (see passZoneCompositeZ), but still shown as the
// defense side's success detail line, and still used as-is in the
// league-rank modal's own column.
function passZoneRate(zone) {
  return zone && zone.attempts ? zone.completions / zone.attempts : null;
}
function passZoneEpaPerPlay(zone) {
  return zone && zone.attempts ? zone.epa_sum / zone.attempts : null;
}

// Self-referential ONLY -- deliberately no comparison to the other 31
// defenses. The old version z-scored this zone's volume/EPA against every
// OTHER team's own version of the same zone, which answered "is this an
// unusual zone leaguewide" -- a completely different, and much less
// useful, question than "where do teams actually exploit THIS defense."
// A zone that gets modest volume by league standards can still be this
// specific defense's clear soft spot if it's where THEY, relative to
// their OWN other 11 zones, get attacked most and/or hold up worst -- and
// that's exactly what this compares now: this zone's attempts/EPA against
// this same team's other zones, nothing else.
//
// 75% how often this zone gets used (volume -- a raw attempts count, not
// a rate) + 25% EPA/play there. Deliberately NOT completion rate -- 2/2
// and 7/8 read as the same "100%"-ish color under a rate-only scheme
// despite being very different signals (one snapshot, one a real,
// repeatable tendency), and a huge-volume zone at moderate efficiency is
// a more real "soft spot" than a tiny-sample zone that happened to hit.
// Both components invert (bad = red): getting thrown at often in one zone
// relative to this defense's own other areas, or allowing better EPA
// there than elsewhere, are both exactly the "this is where they go after
// this defense" signal.
function passZoneCompositeZ(chart, zoneKey, zone) {
  if (!zone || !zone.attempts) return null;
  const allZones = Object.values(chart.zones);
  const volumePool = allZones.map((z) => (z && z.attempts ? z.attempts : null)).filter((v) => v !== null);
  const epaPool = allZones.map(passZoneEpaPerPlay).filter((v) => v !== null);
  const volZ = zScore(zone.attempts, volumePool, true);
  const epaZ = zScore(passZoneEpaPerPlay(zone), epaPool, true);
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
function passZoneTotalBadge(share, pool) {
  if (share === null) return "";
  const cls = tierFromZ(zScore(share, pool, true));
  const alpha = alphaAttrFromZ(zScore(share, pool, true));
  return `<span class="pass-zone-total-badge ${cls}"${alpha}>${Math.round(share * 100)}%</span>`;
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
function passZoneGridHeader(team, chart) {
  const rgb = teamAccentRgb(team);
  const style = `background:rgba(${rgb.join(",")},0.35)`;
  const col = (label, key) => {
    const share = passZoneColShare(chart, key);
    const badge = passZoneTotalBadge(share, passZoneColSharePool(chart));
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
      const z = passZoneCompositeZ(chart, zk, zone);
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
    const rowBadge = passZoneTotalBadge(rowShare, passZoneRowSharePool(chart));
    return `<tr><th class="pass-zone-row-label"><span class="pass-zone-row-label-text">${r.label}</span>${rowBadge}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid">
    <thead>${passZoneGridHeader(team, chart)}</thead>
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
  return `<h4 class="pass-zone-modal-subhead">${teamLogoMini(opponent)} ${opponent} Offense in This Zone</h4>${renderPassZonePlayerSummaryTable(oppSummary)}`;
}

// Everything in one wide view -- league rank, the who-to-target summary,
// and the plays themselves side by side, instead of a narrow box that
// made you toggle between them to hold two numbers in your head.
function renderPassZoneModalContent(team, side, zoneKey, opponent) {
  const zone = (DATA.pass_shot_charts[team] || {})[side]?.zones?.[zoneKey];
  const plays = (zone && zone.plays) || [];
  const sideLabel = side === "off" ? "Offense" : "Defense Allowed";
  const heading = `${teamLogoMini(team)} ${team} &mdash; ${zoneLabel(zoneKey)} ${sideLabel}`;
  const summary = passZonePlayerSummary(plays);
  const summaryBlock = !plays.length
    ? `<p class="no-data-note">No attempts in this zone yet.</p>`
    : side === "def"
    ? `<h4 class="pass-zone-modal-subhead">By Position</h4>${renderPassZonePositionTable(summary)}
       <h4 class="pass-zone-modal-subhead">By Player</h4>${renderPassZonePlayerSummaryTable(summary)}
       ${opponent ? renderPassZoneOpponentBlock(opponent, zoneKey) : ""}`
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
      <div class="pass-zone-modal-col pass-zone-modal-col-plays">
        ${plays.length ? `<h4 class="pass-zone-modal-subhead">Every Play</h4><div class="pass-zone-plays-wrap">${renderPassZonePlayList(summary)}</div>` : ""}
      </div>
    </div>`;
}

function openPassZoneRankModal(team, side, zoneKey, opponent) {
  ensurePassZoneModal();
  document.getElementById("pass-zone-modal-content").innerHTML = renderPassZoneModalContent(team, side, zoneKey, opponent);
  document.getElementById("pass-zone-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".pass-zone-rank-click");
  if (!cell) return;
  const { team, side, zoneKey, opponent } = decodeDataAttr(cell.dataset.entry);
  openPassZoneRankModal(team, side, zoneKey, opponent);
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
  const sideLabel = side === "off" ? "Passing Offense" : "Pass Defense Allowed";
  const clickable = side === "off";
  const cls = `pass-zone-team-banner${clickable ? " pass-zone-team-click" : ""}`;
  return `<div class="${cls}" style="background:rgba(${rgb.join(",")},0.16)"${clickable ? ` data-team="${team}"` : ""}>
    <img src="${teamLogoUrl(team)}" class="team-logo" alt="${team}" loading="lazy">
    <span class="pass-zone-team-name">${TEAM_NAMES[team] || team}</span>
    <span class="pass-zone-team-side">${sideLabel}${clickable ? " &rsaquo;" : ""}</span>
  </div>`;
}

function renderPassZoneBlock(team, side, opponent) {
  return `<div class="pass-zone-block">
    ${passZoneTeamHeader(team, side)}
    ${renderPassZoneGrid(team, side, opponent)}
    ${renderPassIdentityCard(team, side)}
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
const PLAYER_ZONE_HEAT_MIN_ALPHA = 0.06;
const PLAYER_ZONE_HEAT_MAX_ALPHA = 0.85;

// Same composite (volume+EPA, defense-inverted) the defense grid colors
// its own cells with -- evaluated for one zone instead of a whole grid, so
// a hotspot card can flag "this is also a soft spot for the exact defense
// he's facing" without making the reader cross-reference the two grids by
// eye. tier-bad/tier-mid on the defense grid mean "exposed"/"average" --
// tier-good means the defense actually handles this zone, nothing to flag.
function defenseZoneTier(oppTeam, zoneKey) {
  const chart = (DATA.pass_shot_charts[oppTeam] || {}).def;
  if (!chart) return "";
  return tierFromZ(passZoneCompositeZ(chart, zoneKey, chart.zones[zoneKey]));
}

function renderPlayerZoneHeatGrid(zones, oppTeam) {
  let maxTargets = 0;
  PASS_ZONE_ROWS.forEach((r) =>
    PASS_ZONE_COLS.forEach((c) => {
      const t = zones[`${r.key}_${c}`]?.targets || 0;
      if (t > maxTargets) maxTargets = t;
    })
  );
  const rows = PASS_ZONE_ROWS.map((r) => {
    const cells = PASS_ZONE_COLS.map((loc) => {
      const zk = `${r.key}_${loc}`;
      const zone = zones[zk];
      const targets = zone?.targets || 0;
      const rec = zone?.receptions || 0;
      const style = targets
        ? ` style="background: rgba(var(--accent-rgb), ${(PLAYER_ZONE_HEAT_MIN_ALPHA + (targets / maxTargets) * (PLAYER_ZONE_HEAT_MAX_ALPHA - PLAYER_ZONE_HEAT_MIN_ALPHA)).toFixed(2)})"`
        : "";
      const display = targets ? `${rec}/${targets}` : "--";
      // Only a real zone gets the outline -- flagging an empty "--" cell as
      // a soft spot the player has never actually been sent to is a
      // meaningless signal, not an insight.
      const tier = targets && oppTeam ? defenseZoneTier(oppTeam, zk) : "";
      const exploitCls = tier === "tier-bad" ? " pass-zone-heat-cell-exploit-bad" : tier === "tier-mid" ? " pass-zone-heat-cell-exploit-mid" : "";
      return `<td class="num pass-zone-heat-cell${exploitCls}"${style}>${display}</td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label-mini">${r.short}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid pass-zone-grid-mini">
    <thead><tr><th></th><th>L</th><th>M</th><th>R</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderPlayerZoneMiniCard(team, name, player, oppTeam) {
  const headshot = (DATA.player_headshots[team] || {})[name];
  const photo = headshot
    ? `<img src="${headshot}" class="pass-zone-player-photo pass-zone-player-photo-mini" alt="${name}" loading="lazy">`
    : `<div class="pass-zone-player-photo pass-zone-player-photo-mini pass-zone-player-photo-blank"></div>`;
  const totalTgt = Object.values(player.zones).reduce((s, z) => s + (z.targets || 0), 0);
  return `<div class="pass-zone-player-mini-card">
    <div class="pass-zone-player-banner pass-zone-player-banner-mini">
      ${photo}
      <div class="pass-zone-player-info">
        <span class="pass-zone-player-name">${name}</span>
        <span class="pass-zone-player-pos">${player.position || "?"} &middot; ${totalTgt} tgt</span>
      </div>
    </div>
    ${renderPlayerZoneHeatGrid(player.zones, oppTeam)}
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

function renderQbZoneHeatGrid(chart, oppTeam) {
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
      const display = att ? `${comp}/${att}` : "--";
      const tier = att && oppTeam ? defenseZoneTier(oppTeam, zk) : "";
      const exploitCls = tier === "tier-bad" ? " pass-zone-heat-cell-exploit-bad" : tier === "tier-mid" ? " pass-zone-heat-cell-exploit-mid" : "";
      return `<td class="num pass-zone-heat-cell${exploitCls}"${style}>${display}</td>`;
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
    <div class="pass-zone-player-banner pass-zone-player-banner-qb">
      ${photo}
      <div class="pass-zone-player-info">
        <span class="pass-zone-player-name pass-zone-player-name-qb">${qb.name}</span>
        <span class="pass-zone-player-pos pass-zone-player-pos-qb">QB &middot; ${chart.pass_attempts} att</span>
      </div>
    </div>
    ${renderQbZoneHeatGrid(chart, oppTeam)}
  </div>`;
}

function renderQbPassZoneCards(team, side, opponent) {
  const qb = mainPasser(team);
  const chart = (DATA.pass_shot_charts[team] || {})[side];
  const body = qb && chart
    ? `<div class="pass-zone-players-inline">${renderQbZoneMiniCard(team, qb, chart, opponent)}</div>`
    : `<p class="no-data-note">No qualifying passers yet this season.</p>`;
  return `<div class="pass-zone-block">
    ${passZoneTeamHeader(team, side)}
    ${body}
    ${renderPassIdentityCard(team, side)}
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
    <div class="pass-zone-player-banner">
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

// One table instead of two stacked ones -- the pressure-split rows
// (Scr%/OppAllow%/OppYds/ADV) and the designed-vs-scramble rows (Car/Yds/
// YPC) don't share a column meaning, so this isn't a single shared header;
// it's one bordered table with two inline group-header rows, which reads
// as "one table" (no gap, no second box) without forcing Car/Yds into
// columns labeled Scr%/OppAllow%.
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
        <tr><td>Designed</td><td class="num">${p.designed_carries}</td><td class="num">${fmt(p.designed_rush_yards, 0)}</td>${passStatCell(p, "designed_ypc", { label: "Designed Rush YPC" })}<td></td></tr>
        <tr><td>Scramble</td><td class="num">${p.scramble_carries}</td><td class="num">${fmt(p.scramble_rush_yards, 0)}</td>${passStatCell(p, "scramble_ypc", { label: "Scramble YPC" })}<td></td></tr>
      `;
      return `<div class="player-name-row"><span class="player-name">${p.name}</span></div>
        <table class="data-table scramble-table qb-rushing-combined-table">
          <tbody>
            <tr class="qb-rushing-group-header"><th>Split</th><th class="num">Scr%</th><th class="num">OppAllow%</th><th class="num">OppYds</th><th class="edge-hdr">ADV</th></tr>
            ${scrambleRows}
            <tr class="qb-rushing-group-header"><th>Type</th><th class="num">Car</th><th class="num">Yds</th><th class="num">YPC</th><th></th></tr>
            ${typeRows}
          </tbody>
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

document.addEventListener("click", (e) => {
  const playerEl = e.target.closest(".player-click");
  if (playerEl) {
    const { team, name, oppTeam } = decodeDataAttr(playerEl.dataset.entry);
    openPlayerMarketsModal(team, name, oppTeam);
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

  document.getElementById("col-away-receiving").innerHTML = renderReceivingTeamTable(away, home);
  document.getElementById("col-home-receiving").innerHTML = renderReceivingTeamTable(home, away);
  document.getElementById("col-away-rushing").innerHTML = renderRushingTable(away, home);
  document.getElementById("col-away-rushlanes").innerHTML = renderRushLanesPlayers(away, home);
  document.getElementById("col-home-rushing").innerHTML = renderRushingTable(home, away);
  document.getElementById("col-home-rushlanes").innerHTML = renderRushLanesPlayers(home, away);
  document.getElementById("col-away-passing").innerHTML = renderPassingTable(away, home);
  document.getElementById("col-home-passing").innerHTML = renderPassingTable(home, away);
  document.getElementById("col-away-passcoverage").innerHTML = renderPassCoveragePanel(away, home);
  document.getElementById("col-home-passcoverage").innerHTML = renderPassCoveragePanel(home, away);
  document.getElementById("col-away-scramble").innerHTML = renderQbRushingPanel(away, home) + renderRedZoneMixPanel(away, home);
  document.getElementById("col-home-scramble").innerHTML = renderQbRushingPanel(home, away) + renderRedZoneMixPanel(home, away);
  document.getElementById("col-away-passzones-off").innerHTML = renderQbPassZoneCards(away, "off", home);
  document.getElementById("col-away-passzones-def").innerHTML = renderPassZoneBlock(away, "def", home);
  document.getElementById("col-home-passzones-off").innerHTML = renderQbPassZoneCards(home, "off", away);
  document.getElementById("col-home-passzones-def").innerHTML = renderPassZoneBlock(home, "def", away);
  document.getElementById("col-away-recvzones-off").innerHTML = renderOffensePlayerZoneCards(away, "off", home);
  document.getElementById("col-away-recvzones-def").innerHTML = renderPassZoneBlock(away, "def", home);
  document.getElementById("col-home-recvzones-off").innerHTML = renderOffensePlayerZoneCards(home, "off", away);
  document.getElementById("col-home-recvzones-def").innerHTML = renderPassZoneBlock(home, "def", away);

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
