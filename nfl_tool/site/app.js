let DATA = null;

const POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

const LENGTH_BUCKETS = [
  { key: "under_10", label: "< 10 yd" },
  { key: "10_19", label: "10-19 yd" },
  { key: "20_29", label: "20-29 yd" },
  { key: "30_39", label: "30-39 yd" },
  { key: "40_49", label: "40-49 yd" },
  { key: "50_plus", label: "50+ yd" },
];

// Every row in the combined offense/defense stat table -- each side shows
// BOTH the season total and the per-game rate, so nothing needs a second
// row. offKey/rateOffKey read off the offense-side team, the Def variants
// off the defense-side (opponent) team.
const STAT_ROWS = [
  { label: "Pass TD", totalOffKey: "pass_td", rateOffKey: "pass_td_per_g", totalDefKey: "pass_td_allowed", rateDefKey: "pass_td_allowed_per_g" },
  { label: "Rush TD", totalOffKey: "rush_td", rateOffKey: "rush_td_per_g", totalDefKey: "rush_td_allowed", rateDefKey: "rush_td_allowed_per_g" },
  { label: "Total TD", totalOffKey: "total_td", rateOffKey: "total_td_per_g", totalDefKey: "total_td_allowed", rateDefKey: "total_td_allowed_per_g" },
  { label: "DST TD", totalOffKey: "dst_td", rateOffKey: "dst_td_per_g", totalDefKey: "dst_td_allowed", rateDefKey: "dst_td_allowed_per_g" },
  { label: "First TD", special: "first" },
];

const RED_ZONE_ROWS = [
  { label: "RZ TD", totalOffKey: "rz_td", rateOffKey: "rz_td_per_g", totalDefKey: "rz_td_allowed", rateDefKey: "rz_td_allowed_per_g" },
  { label: "RZ Plays", totalOffKey: "rz_plays", rateOffKey: "rz_plays_per_g", totalDefKey: "rz_plays_allowed", rateDefKey: "rz_plays_allowed_per_g" },
  { label: "RZ Carries", totalOffKey: "rz_carries", rateOffKey: "rz_carries_per_g", totalDefKey: "rz_carries_allowed", rateDefKey: "rz_carries_allowed_per_g" },
  { label: "RZ Targets", totalOffKey: "rz_targets", rateOffKey: "rz_targets_per_g", totalDefKey: "rz_targets_allowed", rateDefKey: "rz_targets_allowed_per_g" },
];

function teamsWithGames() {
  return DATA.teams.filter((t) => (DATA.team_stats[t]?.games_played || 0) > 0);
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function hexToHsl(hex) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// Real team colors vary wildly in lightness/saturation (some are near-black
// or two teams share a color family, e.g. MIN/BAL both lean purple) --
// normalize toward a consistent vivid mid-tone so every team reads clearly
// against the dark theme and close hues stay distinguishable.
function teamAccentRgb(team) {
  const hex = TEAM_COLORS[team] || "#5b8def";
  const { h, s, l } = hexToHsl(hex);
  return hslToRgb(h, Math.max(s, 55), Math.min(Math.max(l, 40), 58));
}

// Percentile tier across every team currently with games played.
// invert=true means a LOWER raw value is the good outcome (e.g. TDs allowed).
function percentileTier(value, allValues, invert) {
  if (allValues.length < 3) return "";
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.indexOf(value);
  let pct = rank / (sorted.length - 1);
  if (invert) pct = 1 - pct;
  if (pct >= 0.667) return "tier-good";
  if (pct >= 0.333) return "tier-mid";
  return "tier-bad";
}

function tierFor(statKey, team, invert) {
  const pool = teamsWithGames();
  const values = pool.map((t) => DATA.team_stats[t][statKey]);
  return percentileTier(DATA.team_stats[team][statKey], values, invert);
}

// A team's own share of its games where the OPPONENT scored first -- the
// complement of first_td_rate (exactly one team scores first per game), so
// it's a fully derived, no-new-data "how often does this defense let the
// other side score first" stat.
function firstTdAllowedRate(team) {
  const s = DATA.team_stats[team];
  return s.games_played ? 1 - s.first_td_rate : 0;
}
function firstTdAllowedGames(team) {
  const s = DATA.team_stats[team];
  return s.games_played - s.first_td_games;
}
function tierForFirstTdAllowed(team) {
  const pool = teamsWithGames();
  const values = pool.map((t) => firstTdAllowedRate(t));
  return percentileTier(firstTdAllowedRate(team), values, true);
}

// Share/count percentile helpers for any {key: count} bucket dict (position
// breakdown, TD-length breakdown). Not inverted either way -- a high share
// is a strong tendency toward that bucket, not a quality judgment.
function bucketCountTier(dictKey, bucketKey, team) {
  const pool = teamsWithGames();
  const countOf = (t) => DATA.team_stats[t][dictKey][bucketKey] || 0;
  return percentileTier(countOf(team), pool.map(countOf), false);
}
function bucketShareTier(dictKey, totalKey, bucketKey, team) {
  const pool = teamsWithGames();
  const shareOf = (t) => {
    const s = DATA.team_stats[t];
    return s[totalKey] ? (s[dictKey][bucketKey] || 0) / s[totalKey] : 0;
  };
  return percentileTier(shareOf(team), pool.map(shareOf), false);
}

function headerRow(offTeam, defTeam, subLabels) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th colspan="2" style="${offStyle}">${offTeam}<span class="col-sub">OFF</span></th><th colspan="2" style="${defStyle}">${defTeam}<span class="col-sub">DEF</span></th></tr>
    <tr><th></th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th></tr>`;
}

function renderStatTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = STAT_ROWS.map((r) => {
    if (r.special === "first") {
      const offTotal = off.first_td_games;
      const offRate = off.first_td_rate * 100;
      const defTotal = firstTdAllowedGames(defTeam);
      const defRate = firstTdAllowedRate(defTeam) * 100;
      const offTotalCls = percentileTier(offTotal, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
      const offRateCls = tierFor("first_td_rate", offTeam, false);
      const defTotalCls = percentileTier(defTotal, teamsWithGames().map(firstTdAllowedGames), true);
      const defRateCls = tierForFirstTdAllowed(defTeam);
      return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${offTotal}</td><td class="num ${offRateCls}">${fmt(offRate, 0)}%</td><td class="num ${defTotalCls}">${defTotal}</td><td class="num ${defRateCls}">${fmt(defRate, 0)}%</td></tr>`;
    }
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${off[r.totalOffKey]}</td><td class="num ${offRateCls}">${fmt(off[r.rateOffKey], 2)}</td><td class="num ${defTotalCls}">${def[r.totalDefKey]}</td><td class="num ${defRateCls}">${fmt(def[r.rateDefKey], 2)}</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRedZoneTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = RED_ZONE_ROWS.map((r) => {
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${off[r.totalOffKey]}</td><td class="num ${offRateCls}">${fmt(off[r.rateOffKey], 2)}</td><td class="num ${defTotalCls}">${def[r.totalDefKey]}</td><td class="num ${defRateCls}">${fmt(def[r.rateDefKey], 2)}</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLengthTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = LENGTH_BUCKETS.map(({ key, label }) => {
    const offCount = off.td_by_length[key] || 0;
    const defCount = def.td_by_length_allowed[key] || 0;
    const offCountCls = bucketCountTier("td_by_length", key, offTeam);
    const offShareCls = bucketShareTier("td_by_length", "total_td", key, offTeam);
    const defCountCls = bucketCountTier("td_by_length_allowed", key, defTeam);
    const defShareCls = bucketShareTier("td_by_length_allowed", "total_td_allowed", key, defTeam);
    const offShare = off.total_td ? Math.round((offCount / off.total_td) * 100) : 0;
    const defShare = def.total_td_allowed ? Math.round((defCount / def.total_td_allowed) * 100) : 0;
    return `<tr><td>${label}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${offShare}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${defShare}%</td></tr>`;
  }).join("");

  return `<table class="data-table pos-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderPositionTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const rows = POSITIONS.map((pos) => {
    const offCount = off.off_position_td[pos];
    const defCount = def.def_position_td_allowed[pos];
    const offShare = off.total_td ? offCount / off.total_td : 0;
    const defShare = def.total_td_allowed ? defCount / def.total_td_allowed : 0;
    const offCountCls = bucketCountTier("off_position_td", pos, offTeam);
    const offShareCls = bucketShareTier("off_position_td", "total_td", pos, offTeam);
    const defCountCls = bucketCountTier("def_position_td_allowed", pos, defTeam);
    const defShareCls = bucketShareTier("def_position_td_allowed", "total_td_allowed", pos, defTeam);
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${Math.round(offShare * 100)}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${Math.round(defShare * 100)}%</td></tr>`;
  }).join("");

  return `<table class="data-table pos-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Simple white (fewest TDs on this team) -> green (most TDs on this team)
// scale, scoped to just this team's own roster -- not a league percentile.
function whiteToGreen(ratio) {
  const start = [255, 255, 255];
  const end = [62, 201, 114];
  const rgb = start.map((c, i) => Math.round(c + (end[i] - c) * ratio));
  return `rgb(${rgb.join(",")})`;
}

function renderLeaderboard(team) {
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No TDs scored yet this season.</p>`;
  }
  const maxTds = Math.max(...players.map((p) => p.tds));
  const rows = players
    .map((p) => {
      const tag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
      const ratio = maxTds ? p.tds / maxTds : 0;
      const bg = whiteToGreen(ratio);
      return `<tr><td>${p.name}${tag}</td><td>${p.position}</td><td class="num" style="background:${bg}; color:#0f1115">${p.tds}</td><td class="num">${p.first_tds}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table lb-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">TDs</th><th class="num">1st TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const SECTIONS = ["type", "position", "distance", "redzone", "player"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>Choose both teams above to see the matchup.</p>";
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

  document.getElementById("col-away-type").innerHTML = renderStatTable(away, home);
  document.getElementById("col-home-type").innerHTML = renderStatTable(home, away);
  document.getElementById("col-away-position").innerHTML = renderPositionTable(away, home);
  document.getElementById("col-home-position").innerHTML = renderPositionTable(home, away);
  document.getElementById("col-away-distance").innerHTML = renderLengthTable(away, home);
  document.getElementById("col-home-distance").innerHTML = renderLengthTable(home, away);
  document.getElementById("col-away-redzone").innerHTML = renderRedZoneTable(away, home);
  document.getElementById("col-home-redzone").innerHTML = renderRedZoneTable(home, away);
  document.getElementById("lb-away").innerHTML = renderLeaderboard(away);
  document.getElementById("lb-home").innerHTML = renderLeaderboard(home);
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
    let note = `${data.season} season — through week ${data.through_week}`;
    if (data.is_fallback_season) {
      note = `Showing final ${data.season} season — ${data.requested_season} season data isn't published on nflverse yet`;
    }
    document.getElementById("season-note").textContent = note;
    populateSelects();
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
