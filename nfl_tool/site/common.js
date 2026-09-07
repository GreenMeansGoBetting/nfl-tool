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

// No-color-at-zero fade in the TEAM's own color, scoped to whatever list
// of values is passed in (a team's own roster, not a league percentile).
// ratio=0 renders fully transparent (the plain dark table row shows
// through, no white/no color at all); ratio=1 renders at maxAlpha over
// the dark panel background, using the same normalized team accent color
// as the header cells so the whole table reads as one consistent tint.
function teamFade(team, ratio, maxAlpha = 0.6) {
  const rgb = teamAccentRgb(team);
  return `rgba(${rgb.join(",")},${(ratio * maxAlpha).toFixed(3)})`;
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

// One-click week/matchup picker, shared by both pages. Reads DATA.schedule
// (the real schedule for whatever season was requested, even if the stats
// themselves fell back to last season -- see build_stats.py) and
// DATA.current_week. Clicking a matchup card sets the existing away/home
// selects and calls onPick (each page's own render()) -- the manual
// dropdowns stay fully functional on their own, this is just a faster path
// to the same state.
let scheduleWeek = null;

function renderMatchupRow(rowEl, week) {
  const games = (DATA.schedule || []).filter((g) => g.week === week);
  if (games.length === 0) {
    rowEl.innerHTML = `<p class="no-data-note">No games scheduled for this week.</p>`;
    return;
  }
  const awayVal = document.getElementById("away-select").value;
  const homeVal = document.getElementById("home-select").value;
  rowEl.innerHTML = games
    .map((g) => {
      const selected = g.away === awayVal && g.home === homeVal ? " selected" : "";
      const dateLabel = g.date ? new Date(g.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }) : "";
      return `<button type="button" class="matchup-card${selected}" data-away="${g.away}" data-home="${g.home}">
        <span class="matchup-teams-row">
          <img src="${teamLogoUrl(g.away)}" class="team-logo" alt="${g.away}" loading="lazy">
          <span class="at">@</span>
          <img src="${teamLogoUrl(g.home)}" class="team-logo" alt="${g.home}" loading="lazy">
        </span>
        <span class="matchup-date">${dateLabel}</span>
      </button>`;
    })
    .join("");
}

function initScheduleScroller(onPick) {
  const wrap = document.getElementById("schedule-scroller");
  if (!wrap) return;
  if (!DATA.schedule || DATA.schedule.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const weeks = [...new Set(DATA.schedule.map((g) => g.week))].sort((a, b) => a - b);
  scheduleWeek = DATA.current_week && weeks.includes(DATA.current_week) ? DATA.current_week : weeks[0];

  const label = document.getElementById("week-label");
  const row = document.getElementById("matchup-row");
  const prevBtn = document.getElementById("week-prev");
  const nextBtn = document.getElementById("week-next");

  function refresh() {
    label.textContent = `Week ${scheduleWeek}`;
    renderMatchupRow(row, scheduleWeek);
    prevBtn.disabled = scheduleWeek <= weeks[0];
    nextBtn.disabled = scheduleWeek >= weeks[weeks.length - 1];
  }

  prevBtn.addEventListener("click", () => {
    const idx = weeks.indexOf(scheduleWeek);
    if (idx > 0) {
      scheduleWeek = weeks[idx - 1];
      refresh();
    }
  });
  nextBtn.addEventListener("click", () => {
    const idx = weeks.indexOf(scheduleWeek);
    if (idx < weeks.length - 1) {
      scheduleWeek = weeks[idx + 1];
      refresh();
    }
  });
  row.addEventListener("click", (e) => {
    const card = e.target.closest(".matchup-card");
    if (!card) return;
    document.getElementById("away-select").value = card.dataset.away;
    document.getElementById("home-select").value = card.dataset.home;
    [...row.querySelectorAll(".matchup-card")].forEach((c) => c.classList.toggle("selected", c === card));
    onPick();
  });

  refresh();
}

function headerRow(offTeam, defTeam, subLabels) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th colspan="2" style="${offStyle}">${offTeam}<span class="col-sub">OFF</span></th><th colspan="2" style="${defStyle}">${defTeam}<span class="col-sub">DEF</span></th></tr>
    <tr><th></th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th></tr>`;
}
