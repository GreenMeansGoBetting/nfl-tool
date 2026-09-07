// Shared helpers used by both index.html (matchup data) and
// first-td.html (first-TD mini-game view). Each page fetches its own
// data.json and sets the shared DATA variable before calling any of these.
let DATA = null;

const POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

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
  const clean = allValues.filter((v) => v !== null && v !== undefined);
  if (clean.length < 3 || value === null || value === undefined) return "";
  const sorted = [...clean].sort((a, b) => a - b);
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
