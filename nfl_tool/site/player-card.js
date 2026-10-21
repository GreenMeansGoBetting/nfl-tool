// ---- player-card.js: shared on every page (loaded after common.js) ----
// The player card popup, plus the rush-lane and pass-zone drawing code it
// shares with the Player Props page (moved here from player-props.js so
// every page can draw them; player-props.js still uses them from here).

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
// Success rate allowed alone is blind to explosive severity -- a lane
// with 2 stuffs and 2 backbreaking long runs can average 20+ YPC while
// still landing near a normal success%, since "success" is a binary
// per-play efficiency call, not a magnitude. Blends in YPC allowed (50/50)
// so a lane that's actually getting gashed reads red even when the
// per-play tally looks unremarkable. Self-referential only, same
// principle as the pass zone grid: this team's own other 6 lanes are the
// pool, not the other 31 teams' own (often equally thin) samples.
function rushLaneDefenseCompositeZ(team, zoneKey) {
  const val = DATA.team_stats[team][`rush_success_allowed_${zoneKey}`];
  if (val === null || val === undefined) return null;
  const successPool = RUSH_ZONES.map((z) => DATA.team_stats[team][`rush_success_allowed_${z.key}`]).filter((v) => v !== null && v !== undefined);
  const ypcPool = RUSH_ZONES.map((z) => DATA.team_stats[team][`rush_ypc_allowed_${z.key}`]).filter((v) => v !== null && v !== undefined);
  const successZ = zScore(val, successPool, true);
  const ypcZ = zScore(DATA.team_stats[team][`rush_ypc_allowed_${zoneKey}`], ypcPool, true);
  if (successZ === null && ypcZ === null) return null;
  return 0.5 * (successZ || 0) + 0.5 * (ypcZ || 0);
}

function defenseLaneCell(team, zone) {
  const successKey = `rush_success_allowed_${zone.key}`;
  const ypcKey = `rush_ypc_allowed_${zone.key}`;
  const val = DATA.team_stats[team][successKey];
  const ypc = DATA.team_stats[team][ypcKey];
  const n = DATA.team_stats[team][`rush_carries_allowed_${zone.key}`] || 0;
  const hasSample = val !== null && val !== undefined;
  let cls = "rush-lane-nosample";
  let alpha = "";
  let clickAttrs = "";
  if (hasSample) {
    const z = rushLaneDefenseCompositeZ(team, zone.key);
    cls = tierFromZ(z);
    alpha = alphaAttrFromZ(z);
    const payload = { team, statKey: successKey, label: `${zone.full} Rush Success % Allowed`, invert: true, percent: true };
    clickAttrs = ` stat-rank-click" data-entry="${encodeDataAttr(payload)}`;
  }
  const display = hasSample ? `${Math.round(val * 100)}%` : "--";
  const ypcDisplay = ypc !== null && ypc !== undefined ? fmt(ypc, 1) : "--";
  return `<div class="rush-lane-box ${cls}${clickAttrs}"${alpha}>
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
  if (!zones || !oppTeam) {
    return `<p class="no-data-note">No charted rush attempts for this player yet.</p>`;
  }
  const pools = buildRushZonePools();
  const cols = RUSH_ZONES.map((z) => {
    const zd = zones[z.key] || {};
    const off = offenseSuccessCell(zd.success, zd.ypc, pools[z.key], z.full, null, zd.carries);
    const freq = offenseFreqCell(zd.share);
    return rushLaneColumn(defenseLaneCell(oppTeam, z), off, freq);
  }).join("");
  return `<div class="rush-lanes">
      <div class="rush-lanes-team-tag">${teamLogoMini(oppTeam)} ${oppTeam} run defense</div>
      <div class="rush-lanes-cols">${cols}</div>
      <div class="rush-lanes-team-tag">${name} carries</div>
    </div>`;
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
// ---- League-rank coloring (toggle) ----
// The self-referential composite above answers "where do teams go after
// THIS defense"; this answers "how does this zone rank against the other
// 31 defenses' same zone." Per game (games played differ -- bye/MNF weeks),
// three parts:
//   40% attempts allowed per game (volume -- how often it gets tested)
//   25% completion % allowed
//   35% EPA per attempt allowed
// Efficiency (60% combined) outweighs volume on purpose: a defense that
// gets thrown at a lot but shuts it down (e.g. 1/5 deep) is being tested,
// not beaten, and shouldn't read red just for the volume. Completion % and
// EPA are shrunk toward the league average for that zone by
// PASS_ZONE_SHRINK_ATT phantom attempts, so a 1/1 or 0/2 sample can't
// swing the color on its own -- the rate has to hold over real volume.
const PASS_ZONE_LEAGUE_WEIGHTS = { volume: 0.4, comp: 0.25, epa: 0.35 };
const PASS_ZONE_SHRINK_ATT = 5;
const PASS_ZONE_COLOR_MODE_KEY = "nfl-tool.pass-zone-color-mode.v1";
let passZoneColorMode = loadPassZoneColorMode();

function loadPassZoneColorMode() {
  try {
    return localStorage.getItem(PASS_ZONE_COLOR_MODE_KEY) === "league" ? "league" : "self";
  } catch (e) {
    return "self";
  }
}
function setPassZoneColorMode(mode) {
  passZoneColorMode = mode;
  try {
    localStorage.setItem(PASS_ZONE_COLOR_MODE_KEY, mode);
  } catch (e) {
    // localStorage unavailable -- toggle just won't stick across reloads.
  }
}

// One or more zones of a chart summed into a single sample -- a single
// cell, or a whole row/column for the total badges.
function passZoneSum(chart, zoneKeys) {
  const out = { attempts: 0, completions: 0, epa_sum: 0 };
  zoneKeys.forEach((k) => {
    const z = chart.zones[k];
    if (!z) return;
    out.attempts += z.attempts || 0;
    out.completions += z.completions || 0;
    out.epa_sum += z.epa_sum || 0;
  });
  return out;
}

// Per-team league samples for one zone set: attempts/game plus shrunk
// completion % and EPA/attempt.
function passZoneLeagueSamples(zoneKeys, side) {
  const raw = DATA.teams
    .map((t) => {
      const chart = (DATA.pass_shot_charts[t] || {})[side];
      const g = DATA.team_stats[t]?.games_played || 0;
      return chart && g ? { team: t, g, ...passZoneSum(chart, zoneKeys) } : null;
    })
    .filter(Boolean);
  const att = raw.reduce((s, r) => s + r.attempts, 0);
  if (!att) return [];
  const lgComp = raw.reduce((s, r) => s + r.completions, 0) / att;
  const lgEpa = raw.reduce((s, r) => s + r.epa_sum, 0) / att;
  const k = PASS_ZONE_SHRINK_ATT;
  return raw.map((r) => ({
    team: r.team,
    perG: r.attempts / r.g,
    comp: (r.completions + k * lgComp) / (r.attempts + k),
    epa: (r.epa_sum + k * lgEpa) / (r.attempts + k),
  }));
}

// Positive = good for this side (defense: less volume/comp/EPA allowed).
function passZoneLeagueCompositeZ(team, side, zoneKeys) {
  const samples = passZoneLeagueSamples(zoneKeys, side);
  const me = samples.find((s) => s.team === team);
  if (!me) return null;
  const invert = side === "def";
  const z = (key) => zScore(me[key], samples.map((s) => s[key]), invert) || 0;
  const w = PASS_ZONE_LEAGUE_WEIGHTS;
  return w.volume * z("perG") + w.comp * z("comp") + w.epa * z("epa");
}

// Whichever mode the toggle is on, for one cell.
function passZoneCellZ(chart, team, side, zoneKey) {
  if (passZoneColorMode === "league") return passZoneLeagueCompositeZ(team, side, [zoneKey]);
  return passZoneCompositeZ(chart, zoneKey, chart.zones[zoneKey]);
}

function renderPassZoneColorToggle() {
  const btn = (mode, label) =>
    `<button type="button" class="pass-zone-mode-btn${passZoneColorMode === mode ? " active" : ""}" data-mode="${mode}">${label}</button>`;
  return `<span class="pass-zone-mode-label">Defense colors:</span>${btn("self", "Own tendencies")}${btn("league", "League rank")}`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pass-zone-mode-btn");
  if (!btn || btn.dataset.mode === passZoneColorMode) return;
  setPassZoneColorMode(btn.dataset.mode);
  render();
});

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
  return tierFromZ(passZoneCellZ(chart, oppTeam, "def", zoneKey));
}

// ctx {team, name} (optional): each zone opens that player's throws there
// (the Player Props zone popup -- only where that page's code is loaded).
function renderPlayerZoneHeatGrid(zones, oppTeam, ctx = null) {
  const clickable = ctx && typeof openPassZoneRankModal === "function";
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
      const click = clickable && targets ? ` pass-zone-rank-click" data-entry="${encodeDataAttr({ team: ctx.team, side: "off", zoneKey: zk, opponent: oppTeam, receiver: ctx.name })}` : "";
      return `<td class="num pass-zone-heat-cell${exploitCls}${click}"${style}>${display}</td>`;
    }).join("");
    return `<tr><th class="pass-zone-row-label-mini">${r.short}</th>${cells}</tr>`;
  }).join("");
  return `<table class="data-table pass-zone-grid pass-zone-grid-mini">
    <thead><tr><th></th><th>L</th><th>M</th><th>R</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// A single O/U market row is really TWO potential plays (Over and Under),
// so it gets two checkboxes, not one -- built from the same shape both
// the team-header market table and the player-only "All Props" modal use,
// so checking a line in either place shows checked in the other too (same
// id scheme). Week is baked into the id since a market's current line is
// only ever this week's -- an old saved play for the same player/market
// from a prior week shouldn't collide with (or show as checked for) this
// week's line.
// Each entry's every-book spec (book-odds.js), kept beside the entry so it
// never ends up inside a saved play.
const BOOK_SPECS = new WeakMap();
function propOuEntries(marketKey, marketLabel, team, name, line, overOdds, underOdds, matchup) {
  const base = { week: scheduleWeek, matchup, category: marketLabel, team };
  const entries = {
    over: { ...base, id: `${scheduleWeek}_${marketKey}_${team}_${name}_over`, description: `${name} Over ${fmt(line, 1)}`, odds: fmtOddsSigned(overOdds) },
    under: { ...base, id: `${scheduleWeek}_${marketKey}_${team}_${name}_under`, description: `${name} Under ${fmt(line, 1)}`, odds: fmtOddsSigned(underOdds) },
  };
  const spec = { kind: "prop", stat: marketKey, team, name, line, title: `${name} &middot; ${marketLabel}`, sub: matchup || "" };
  BOOK_SPECS.set(entries.over, { ...spec, side: "o" });
  BOOK_SPECS.set(entries.under, { ...spec, side: "u" });
  return entries;
}
// The best price across the member's books when SmartStake has this bet
// (click: every book), else the price the row came with.
function bookPriceOr(oddsDisplay, spec) {
  return (spec && typeof bookPricePill === "function" && bookPricePill(spec)) || oddsDisplay;
}
function ouCheckboxCell(oddsDisplay, entry) {
  const checked = isPossiblePlay(entry.id) ? " checked" : "";
  return `${bookPriceOr(oddsDisplay, BOOK_SPECS.get(entry))} <label class="pp-check-inline" title="Add to Possible Plays"><input type="checkbox" class="pp-toggle" data-entry="${encodeDataAttr(entry)}"${checked}></label>`;
}

// ---- Player card: the one popup for every player name/photo on the site ----
// Any element with .player-click and data-entry {team, name, oppTeam?}
// opens it (listener at the bottom), on every page. Three tabs:
//   Odds       -- every posted prop line plus Anytime/First TD, each with
//                 Possible Plays checkboxes (and "+ Summary" on the Player
//                 Props page, where the Props Summary card lives);
//   Game Log   -- week-by-week versions of the Receiving/Rushing/Passing
//                 table stats, each column shaded against the player's OWN
//                 weeks (green = one of his bigger games, red = smaller);
//   Rush/Catch Lanes -- his rush lanes vs this opponent's run defense and
//                 his catch zones vs this opponent's pass defense; RBs see
//                 rushing first, WRs/TEs catching first.

let playerCardState = null; // { team, name, oppTeam, view }

function pcIndex(source, team) {
  const map = {};
  Object.entries((source || {})[team] || {}).forEach(([n, v]) => (map[normName(n)] = { name: n, v }));
  return map;
}
function pcGameLogs(team, name) {
  const hit = pcIndex(DATA.player_game_logs, team)[normName(name)];
  return hit ? { name: hit.name, logs: hit.v } : null;
}
function pcSnaps(team, name) {
  const hit = pcIndex(DATA.player_snaps, team)[normName(name)];
  return hit ? hit.v : null;
}
function pcPosition(team, name) {
  const n = normName(name);
  const fromProps = ((DATA.player_props || {})[team] || []).find((p) => normName(p.name) === n);
  if (fromProps && fromProps.position) return fromProps.position;
  const snaps = pcSnaps(team, name);
  if (snaps && snaps.pos) return snaps.pos;
  const zones = pcIndex(DATA.player_pass_zones, team)[n];
  if (zones && zones.v.position) return zones.v.position;
  for (const src of [DATA.player_td_odds, DATA.player_first_td_odds]) {
    const hit = ((src || {})[team] || []).find((p) => normName(p.name) === n);
    if (hit && hit.position) return hit.position;
  }
  return null;
}
// This week's opponent when the clicked spot didn't say.
function pcGame(team) {
  const week = typeof scheduleWeek !== "undefined" && scheduleWeek ? scheduleWeek : DATA.current_week;
  return (DATA.schedule || []).find((g) => g.week === week && (g.away === team || g.home === team)) || null;
}

// ---- Odds tab ----
function playerPropsAcrossMarkets(team, name) {
  const labels = DATA.player_prop_market_labels || {};
  const markets = DATA.player_prop_markets || {};
  const rows = [];
  for (const stat of Object.keys(labels)) {
    const found = ((markets[stat] || {})[team] || []).find((p) => normName(p.name) === normName(name));
    if (found) rows.push({ marketKey: stat, market: labels[stat], ...found });
  }
  return rows;
}

function pcTdRow(market, label, team, name, game) {
  const src = market === "first_td" ? DATA.player_first_td_odds : DATA.player_td_odds;
  const p = ((src || {})[team] || []).find((x) => normName(x.name) === normName(name));
  if (!p) return "";
  const weekNum = game ? game.week : scheduleWeek;
  const entry = {
    id: `${weekNum}_${market}_${team}_${p.name}`,
    week: weekNum,
    matchup: game ? `${game.away} @ ${game.home}` : team,
    category: label,
    description: p.name,
    team,
    odds: fmtOddsSigned(p.best_odds),
    book: p.best_book,
  };
  // Anytime TD only: SmartStake has no First TD market.
  if (market !== "first_td") BOOK_SPECS.set(entry, { kind: "td", team, name: p.name, side: "o", line: 0.5, title: `${p.name} &middot; Anytime TD`, sub: entry.matchup });
  return `<tr><td>${label}</td><td class="num">--</td><td class="num">${ouCheckboxCell(showOdds(p.best_odds), entry)}</td><td class="num">--</td><td class="num pc-implied">${Math.round(p.implied_prob * 100)}%</td></tr>`;
}

function pcOddsView(team, name, oppTeam, game) {
  const rows = playerPropsAcrossMarkets(team, name);
  const matchup = game ? `${game.away} @ ${game.home}` : team;
  // "+ Summary" only where the Props Summary card lives (Player Props page).
  // Best Plays loads props-summary.js for its math but has no game picker.
  const summaryOn = typeof propsSummaryContext === "function" && typeof propTeamLines === "function"
    && !!document.getElementById("away-select");
  let model = {};
  let chosen = new Set();
  let ctx = null;
  if (summaryOn) {
    ctx = propsSummaryContext();
    const inGame = oppTeam && [ctx.away, ctx.home].includes(team) && [ctx.away, ctx.home].includes(oppTeam);
    if (inGame) {
      propTeamLines(team, oppTeam, ctx.week, ctx.game)
        .filter((r) => normName(r.name) === normName(name))
        .forEach((r) => (model[r.marketKey] = r));
      chosen = new Set(loadPropsSummaryPicks(ctx.gameKey)[team] || []);
    } else ctx = null;
  }
  const full = chosen.size >= (typeof PROPS_SUMMARY_MAX_PICKS !== "undefined" ? PROPS_SUMMARY_MAX_PICKS : 99);
  const propRows = rows
    .map((r) => {
      const { over, under } = propOuEntries(r.marketKey, r.market, team, r.name, r.line, r.over_odds, r.under_odds, matchup);
      let last = "";
      if (ctx) {
        const m = model[r.marketKey];
        last = `<span class="muted">--</span>`;
        if (m) {
          const key = propPickKey(m);
          const on = chosen.has(key);
          const disabled = !on && full ? ` disabled title="${PROPS_SUMMARY_MAX_PICKS} per team max"` : "";
          last = `<button type="button" class="ps-add-btn${on ? " ps-add-on" : ""}" data-team="${team}" data-key="${encodeDataAttr(key)}"${disabled}>${on ? "&#10003; On summary" : "+ Summary"}</button>`;
        }
      } else {
        const pr = r.over_odds ? oddsToImpliedPct(fmtOddsSigned(r.over_odds)) : null;
        last = pr === null ? "--" : `${pr}%`;
      }
      return `<tr><td>${r.market}</td><td class="num props-line">${fmt(r.line, 1)}</td><td class="num">${ouCheckboxCell(showOdds(r.over_odds), over)}</td><td class="num">${ouCheckboxCell(showOdds(r.under_odds), under)}</td><td class="num${ctx ? "" : " pc-implied"}">${last}</td></tr>`;
    })
    .join("");
  const tdRows = pcTdRow("anytime_td", "Anytime TD", team, name, game) + pcTdRow("first_td", "First TD", team, name, game);
  if (!propRows && !tdRows) return `<p class="no-data-note">No lines posted for this player yet this week.</p>`;
  const note = ctx ? `<p class="no-data-note">+ Summary adds the line to the card's Prop Picks (${chosen.size}/${PROPS_SUMMARY_MAX_PICKS} for ${team}). Checkboxes add to Possible Plays.</p>` : `<p class="no-data-note">Checkboxes add a side to your Possible Plays.</p>`;
  return `${note}
    <table class="data-table player-odds-table props-market-table pc-odds-table">
      <thead><tr><th>Market</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th><th class="num">${ctx ? "Summary" : "Implied"}</th></tr></thead>
      <tbody>${propRows}${tdRows}</tbody>
    </table>`;
}

// ---- Game Log tab ----
// Shade against the player's own weeks: top third of his range green,
// bottom third red, deeper the closer to his max/min.
function pcSelfTier(v, pool, invert) {
  if (v === null || v === undefined) return "";
  const vals = pool.filter((x) => x !== null && x !== undefined);
  if (vals.length < 2) return "";
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return "";
  let q = (v - lo) / (hi - lo);
  if (invert) q = 1 - q;
  if (q >= 0.67) return ` class="num tier-good" style="--tier-a:${(0.1 + 0.22 * ((q - 0.67) / 0.33)).toFixed(2)}"`;
  if (q <= 0.33) return ` class="num tier-bad" style="--tier-a:${(0.1 + 0.22 * ((0.33 - q) / 0.33)).toFixed(2)}"`;
  return ` class="num tier-mid"`;
}

function pcLogTable(title, cols, rows) {
  const pools = cols.map((c) => rows.map((r) => (c.get ? c.get(r) : null)));
  const body = rows
    .map((r) => {
      const cells = cols
        .map((c, i) => {
          if (c.raw) return `<td${c.cls ? ` class="${c.cls}"` : ""}>${c.raw(r)}</td>`;
          const v = c.get(r);
          const text = v === null || v === undefined ? "--" : c.fmt ? c.fmt(v) : v;
          const attr = c.color === false ? ' class="num"' : pcSelfTier(v, pools[i], c.invert) || ' class="num"';
          return `<td${attr}>${text}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  // Per-game average row underneath (plain, not shaded).
  const avg = cols
    .map((c, i) => {
      if (c.raw) return i === 0 ? `<td class="pc-avg-label" colspan="1">Avg</td>` : "<td></td>";
      const vals = pools[i].filter((x) => x !== null && x !== undefined);
      if (!vals.length || c.noAvg) return `<td class="num"></td>`;
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      return `<td class="num">${c.fmt ? c.fmt(m) : fmt(m, 1)}</td>`;
    })
    .join("");
  return `<div class="pc-log-section">
    <div class="pc-log-title">${title}</div>
    <div class="pc-log-scroll"><table class="data-table pc-log-table">
      <thead><tr>${cols.map((c) => `<th${c.raw ? "" : ' class="num"'}${c.tip ? ` title="${c.tip}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${body}<tr class="pc-avg-row">${avg}</tr></tbody>
    </table></div>
  </div>`;
}

function pcGameLogView(team, name, position) {
  const found = pcGameLogs(team, name);
  const snaps = pcSnaps(team, name);
  const byWeek = {};
  (found ? found.logs : []).forEach((r) => (byWeek[r.week] = r));
  // Weeks he played with no touches still count (a 0-catch game is a small game).
  Object.entries((snaps && snaps.w) || {}).forEach(([wk, pct]) => {
    if (pct > 0 && !byWeek[wk]) byWeek[wk] = { week: +wk, opp: null, targets: 0, receptions: 0, rec_yards: 0, rec_td: 0, carries: 0, rush_yards: 0, rush_td: 0, pass_att: 0 };
  });
  const weeks = Object.values(byWeek).sort((a, b) => b.week - a.week);
  if (!weeks.length) return `<p class="no-data-note">No games recorded for this player yet.</p>`;
  const oppFor = (r) => r.opp || (DATA.schedule || []).filter((g) => g.week === r.week && (g.away === team || g.home === team)).map((g) => (g.away === team ? g.home : g.away))[0] || "";
  const snap = (r) => (snaps && snaps.w && snaps.w[r.week] !== undefined ? snaps.w[r.week] : null);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const one = (v) => fmt(v, 1);
  const lead = [
    { label: "Wk", raw: (r) => r.week, cls: "num" },
    { label: "Opp", raw: (r) => { const o = oppFor(r); return o ? `${teamLogoMini(o, 16)} ${o}` : "--"; } },
    { label: "Snap%", get: snap, fmt: pct, noAvg: false },
  ];
  const sections = {};
  const qbRows = weeks.filter((r) => r.pass_att > 0);
  if (qbRows.length) {
    sections.pass = pcLogTable("Passing", [
      ...lead,
      { label: "Cmp", get: (r) => r.completions },
      { label: "Att", get: (r) => r.pass_att },
      { label: "Cmp%", get: (r) => (r.pass_att ? r.completions / r.pass_att : null), fmt: pct },
      { label: "Yds", get: (r) => r.pass_yards, fmt: (v) => fmt(v, 0) },
      { label: "Y/A", get: (r) => (r.pass_att ? r.pass_yards / r.pass_att : null), fmt: one },
      { label: "TD", get: (r) => r.pass_td },
      { label: "INT", get: (r) => r.interceptions, invert: true },
      { label: "Long", get: (r) => r.longest_pass, fmt: (v) => fmt(v, 0) },
      { label: "ADOT", get: (r) => (r.pass_air_n ? r.pass_air_yards / r.pass_air_n : null), fmt: one, tip: "Average depth of target (air yards per throw)" },
    ], qbRows);
  }
  const isRb = position === "RB" || position === "FB";
  const rushRows = isRb ? weeks : weeks.filter((r) => r.carries > 0);
  if (rushRows.some((r) => r.carries > 0)) {
    sections.rush = pcLogTable("Rushing", [
      ...lead,
      { label: "Car", get: (r) => r.carries },
      { label: "Yds", get: (r) => r.rush_yards, fmt: (v) => fmt(v, 0) },
      { label: "YPC", get: (r) => (r.carries ? r.rush_yards / r.carries : null), fmt: one },
      { label: "Long", get: (r) => (r.carries ? r.longest_rush : null), fmt: (v) => fmt(v, 0) },
      { label: "TD", get: (r) => r.rush_td },
      { label: "10+", get: (r) => r.explosive_rushes ?? null, tip: "Runs of 10+ yards" },
      { label: "RZ Car", get: (r) => r.rz_carries ?? null, tip: "Carries inside the 20" },
    ], rushRows);
  }
  const recRows = ["WR", "TE", "RB", "FB"].includes(position) ? weeks : weeks.filter((r) => r.targets > 0);
  if (recRows.some((r) => r.targets > 0)) {
    sections.rec = pcLogTable("Receiving", [
      ...lead,
      { label: "Tgt", get: (r) => r.targets },
      { label: "Rec", get: (r) => r.receptions },
      { label: "Yds", get: (r) => r.rec_yards, fmt: (v) => fmt(v, 0) },
      { label: "Long", get: (r) => (r.receptions ? r.longest_rec : null), fmt: (v) => fmt(v, 0) },
      { label: "TD", get: (r) => r.rec_td },
      { label: "Tgt%", get: (r) => (r.team_targets ? r.targets / r.team_targets : null), fmt: pct, tip: "Share of the team's targets that game" },
      { label: "ADOT", get: (r) => (r.air_n ? r.air_yards / r.air_n : null), fmt: one, tip: "Average depth of target (air yards)" },
      { label: "YAC/R", get: (r) => (r.receptions && r.yac !== undefined ? r.yac / r.receptions : null), fmt: one, tip: "Yards after catch per reception" },
      { label: "20+", get: (r) => r.tgt_deep ?? null, tip: "Targets 20+ yards downfield" },
      { label: "10-19", get: (r) => r.tgt_intermediate ?? null },
      { label: "0-9", get: (r) => r.tgt_short ?? null },
      { label: "SCN", get: (r) => r.tgt_screen ?? null, tip: "Targets behind the line (screens)" },
      { label: "RZ Tgt", get: (r) => r.rz_targets ?? null, tip: "Targets inside the 20" },
    ], recRows);
  }
  const order = position === "QB" ? ["pass", "rush", "rec"] : isRb ? ["rush", "rec", "pass"] : ["rec", "rush", "pass"];
  const html = order.filter((k) => sections[k]).map((k) => sections[k]).join("");
  return html
    ? `<p class="no-data-note">Each column is shaded against his own weeks: <span class="pc-key tier-good">bigger games</span> <span class="pc-key tier-bad">smaller games</span>.</p>${html}`
    : `<p class="no-data-note">No qualifying stat lines recorded for this player yet.</p>`;
}

// ---- Rush/Catch Lanes tab ----
function pcCatchZones(team, name, oppTeam) {
  const hit = pcIndex(DATA.player_pass_zones, team)[normName(name)];
  if (!hit) return "";
  const total = Object.values(hit.v.zones || {}).reduce((s, z) => s + (z.targets || 0), 0);
  if (!total) return "";
  return `<div class="pc-lane-section">
    <div class="pc-log-title">Catch zones${oppTeam ? ` <span class="pc-vs">vs ${teamLogoMini(oppTeam, 16)} ${oppTeam} pass D</span>` : ""}</div>
    <p class="no-data-note">Catches / targets by depth and side (${total} targets). Outlined = a soft spot in ${oppTeam || "the opponent"}'s pass defense (red = soft, yellow = average).</p>
    <div class="pc-zone-wrap">${renderPlayerZoneHeatGrid(hit.v.zones, oppTeam, { team, name: hit.name })}</div>
  </div>`;
}
function pcRushLanes(team, name, oppTeam) {
  const hit = pcIndex(DATA.player_rush_zones, team)[normName(name)];
  if (!hit || !oppTeam) return "";
  return `<div class="pc-lane-section">
    <div class="pc-log-title">Rush lanes <span class="pc-vs">vs ${teamLogoMini(oppTeam, 16)} ${oppTeam} run D</span></div>
    <p class="no-data-note">Top row: what ${oppTeam}'s defense allows in each lane. Below: his success rate / YPC there, and how often he runs there.</p>
    ${renderPlayerRushLanesContent(team, hit.name, oppTeam)}
  </div>`;
}
function pcLanesView(team, name, oppTeam, position) {
  const rush = pcRushLanes(team, name, oppTeam);
  const catchZ = pcCatchZones(team, name, oppTeam);
  const parts = position === "RB" || position === "FB" || position === "QB" ? [rush, catchZ] : [catchZ, rush];
  const html = parts.filter(Boolean).join("");
  return html || `<p class="no-data-note">No charted carries or targets for this player yet${oppTeam ? "" : " (no opponent this week)"}.</p>`;
}

// ---- shell ----
function ensurePlayerCard() {
  if (document.getElementById("player-card-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "player-card-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pc-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="player-card-content"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePlayerCard();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePlayerCard);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlayerCard();
  });
}
function closePlayerCard() {
  const el = document.getElementById("player-card-modal");
  if (el) el.hidden = true;
  playerCardState = null;
}

function renderPlayerCard() {
  const { team, name, oppTeam, view } = playerCardState;
  const statName = pcGameLogs(team, name)?.name || name; // book spelling -> roster spelling
  const position = pcPosition(team, statName) || pcPosition(team, name);
  const game = pcGame(team);
  const rgb = teamAccentRgb(team).join(",");
  const head = `<div class="pc-head" style="background:rgba(${rgb},0.22);border-left:4px solid rgb(${rgb})">
      ${summaryHeadshot(team, statName, 56)}
      <div class="pc-id">
        <div class="pc-name">${statName}</div>
        <div class="pc-sub">${position || "?"} &middot; ${teamLogoMini(team, 16)} ${TEAM_NAMES[team] || team}${oppTeam ? ` &middot; Week ${game ? game.week : scheduleWeek} vs ${teamLogoMini(oppTeam, 16)} ${oppTeam}` : ""}</div>
      </div>
    </div>`;
  const tab = (key, label) => `<button type="button" class="player-modal-toggle-btn${view === key ? " active" : ""}" data-view="${key}">${label}</button>`;
  let body;
  if (view === "gamelog") body = pcGameLogView(team, statName, position);
  else if (view === "lanes") body = pcLanesView(team, statName, oppTeam, position);
  else body = pcOddsView(team, name, oppTeam, game);
  return `${head}
    <div class="player-modal-toggle">${tab("odds", "Odds")}${tab("gamelog", "Game Log")}${tab("lanes", "Rush/Catch Lanes")}</div>
    <div id="player-modal-body">${body}</div>`;
}

function openPlayerCard(team, name, oppTeam) {
  if (!team || !name || typeof DATA === "undefined" || !DATA) return;
  ensurePlayerCard();
  if (!oppTeam) {
    const g = pcGame(team);
    if (g) oppTeam = g.away === team ? g.home : g.away;
  }
  playerCardState = { team, name, oppTeam: oppTeam || null, view: "odds" };
  document.getElementById("player-card-content").innerHTML = renderPlayerCard();
  document.getElementById("player-card-modal").hidden = false;
}
function refreshPlayerCard() {
  if (playerCardState) document.getElementById("player-card-content").innerHTML = renderPlayerCard();
}

// Positions the card has data for (odds, game logs, lanes) -- injury lists
// and box scores only link these; linemen and defenders stay plain text.
const SKILL_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);

// Wraps any name/photo so it opens the card -- use for every player shown.
function playerClick(team, name, inner = name, oppTeam = null) {
  return `<span class="player-click" data-entry="${encodeDataAttr({ team, name, oppTeam })}">${inner}</span>`;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest(".player-click");
  if (!el || e.target.closest(".pp-toggle, .sc-pick-toggle, .ps-pick-toggle, input, button")) return;
  const { team, name, oppTeam } = decodeDataAttr(el.dataset.entry);
  e.preventDefault();
  openPlayerCard(team, name, oppTeam);
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#player-card-modal .player-modal-toggle-btn");
  if (!btn || !playerCardState) return;
  playerCardState.view = btn.dataset.view;
  refreshPlayerCard();
});
// Pass-catcher sheet / props checkbox changes elsewhere re-render the card.
document.addEventListener("change", (e) => {
  if (e.target.closest("#player-card-modal .pp-toggle")) setTimeout(refreshPlayerCard, 0);
});

// "+ Summary" in the card (Player Props page): add/remove that line on the
// Summary card's Prop Picks rail (same per-game picks the Pick props list edits).
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest("#player-card-modal .ps-add-btn");
  if (!addBtn || !playerCardState || typeof propsSummaryContext !== "function") return;
  const { gameKey, away, home } = propsSummaryContext();
  const picks = loadPropsSummaryPicks(gameKey);
  const list = new Set(picks[addBtn.dataset.team] || []);
  const key = decodeDataAttr(addBtn.dataset.key);
  if (list.has(key)) list.delete(key);
  else if (list.size < PROPS_SUMMARY_MAX_PICKS) list.add(key);
  picks[addBtn.dataset.team] = [...list];
  savePropsSummaryPicks(gameKey, picks);
  refreshPlayerCard();
  if (typeof currentPropsView !== "undefined" && currentPropsView === "summary" && typeof renderPropsSummaryCard === "function") renderPropsSummaryCard(away, home);
});
