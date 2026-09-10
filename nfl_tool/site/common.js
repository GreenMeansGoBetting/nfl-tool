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

// How far from the league mean (in standard deviations) a value has to sit
// before it earns a hard green/red instead of yellow. Percentile-rank tiering
// (the old approach) assigns colors by RANK ORDER alone, so on a
// tightly-bunched stat (e.g. rush attempts/game, which every team runs
// 24-29 of) two teams 0.1 apart can land on opposite sides of a rank cutoff
// and flip from green to yellow to red for no meaningful reason. Z-score
// tiering colors by actual DISTANCE from the pack instead, so a stat that's
// naturally bunched league-wide stays mostly yellow, and only a genuinely
// separated value (a real outlier, not a rounding artifact) goes green/red --
// consistent across every stat on the site without hand-tuning per category.
const TIER_Z_THRESHOLD = 0.6;

// How many standard deviations above (positive) or below (negative) the
// league mean a value sits, across every team currently with games played.
// invert=true means a LOWER raw value is the good outcome (e.g. TDs
// allowed), so the sign flips to match. Returns null when there isn't
// enough of a pool to mean anything (same floor percentileTier always used).
// Shared by every tier/opportunity calculation on the site so nothing
// quietly reverts to raw percentile-rank tiering (see TIER_Z_THRESHOLD's
// comment for why that broke on tightly-bunched stats).
function zScore(value, allValues, invert) {
  const clean = allValues.filter((v) => v !== null && v !== undefined);
  if (clean.length < 3 || value === null || value === undefined) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return invert ? -(value - mean) / sd : (value - mean) / sd;
}

// A team can be a real outlier -- not just "bottom third" but historically,
// drastically bad (or good) at something -- strongly enough that it creates
// a real edge for/against even a perfectly average opponent, not just an
// elite one. threshold lets a caller ask "is this an EXTREME outlier" with
// the exact same z-score math as the normal tier cutoff, just a stricter bar.
const TIER_Z_EXTREME_THRESHOLD = 1.5;

// Percentile tier across every team currently with games played.
// invert=true means a LOWER raw value is the good outcome (e.g. TDs allowed).
function percentileTier(value, allValues, invert, threshold = TIER_Z_THRESHOLD) {
  const z = zScore(value, allValues, invert);
  if (z === null) return "";
  if (z >= threshold) return "tier-good";
  if (z <= -threshold) return "tier-bad";
  return "tier-mid";
}

// A value that just barely crosses into tier-good/tier-bad (right past the
// z-score threshold) shouldn't look as loud as a genuine outlier -- same
// two tiers, continuous intensity instead of jumping straight to full
// strength the instant it crosses the line (this is what was behind report
// like "146 red, 147 yellow" reading as a jarring flip for a tiny real
// difference: the CLASSIFICATION was already correct, but every tier-bad
// cell rendered at identical strength regardless of how far past the
// cutoff it actually was). tier-mid is untouched -- it never had a hard-
// boundary flip the way crossing INTO bad/good does, since the whole mid
// band shares one flat color already. Returns null for mid (or no
// signal), meaning "use the CSS default" -- see TIER_ALPHA_MIN/MAX below.
// Same idea as teamFade()'s continuous ratio-based shading, just driven by
// z-score distance instead of a 0-1 ratio.
const TIER_Z_SATURATE = 2;
const TIER_ALPHA_MIN = 0.1;
const TIER_ALPHA_MAX = 0.32;
function tierAlpha(value, allValues, invert, threshold = TIER_Z_THRESHOLD) {
  const z = zScore(value, allValues, invert);
  if (z === null) return null;
  const az = Math.abs(z);
  if (az < threshold) return null;
  const t = Math.min((az - threshold) / (TIER_Z_SATURATE - threshold), 1);
  return TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * t;
}
// `style="--tier-a:0.18"` (or "" for mid/no-signal, letting the CSS
// fallback apply) -- ready to splice straight into a <td ...> tag.
function tierAlphaAttr(value, allValues, invert, threshold = TIER_Z_THRESHOLD) {
  const a = tierAlpha(value, allValues, invert, threshold);
  return a === null ? "" : ` style="--tier-a:${a.toFixed(2)}"`;
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

function tierFor(statKey, team, invert, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => DATA.team_stats[t][statKey]);
  return percentileTier(DATA.team_stats[team][statKey], values, invert, threshold);
}
// Companion to tierFor -- same lookup, continuous shading instead of a class.
function tierForAlphaAttr(statKey, team, invert, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => DATA.team_stats[t][statKey]);
  return tierAlphaAttr(DATA.team_stats[team][statKey], values, invert, threshold);
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
function tierForFirstTdAllowed(team, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => firstTdAllowedRate(t));
  return percentileTier(firstTdAllowedRate(team), values, true, threshold);
}
function tierForFirstTdAllowedAlphaAttr(team, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => firstTdAllowedRate(t));
  return tierAlphaAttr(firstTdAllowedRate(team), values, true, threshold);
}

// Share/count percentile helpers for any {key: count} bucket dict (position
// breakdown, TD-length breakdown). invert follows the same site-wide rule
// as every other stat: offense side non-inverted (a high share is just a
// notable tendency), defense/"allowed" side inverted (a high share allowed
// to one position/length is a real vulnerability, same "green = fewest
// allowed" promise the legend makes everywhere else).
function bucketCountTier(dictKey, bucketKey, team, invert = false, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const countOf = (t) => DATA.team_stats[t][dictKey][bucketKey] || 0;
  return percentileTier(countOf(team), pool.map(countOf), invert, threshold);
}
function bucketShareTier(dictKey, totalKey, bucketKey, team, invert = false, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const shareOf = (t) => {
    const s = DATA.team_stats[t];
    return s[totalKey] ? (s[dictKey][bucketKey] || 0) / s[totalKey] : 0;
  };
  return percentileTier(shareOf(team), pool.map(shareOf), invert, threshold);
}
// Alpha companions to bucketCountTier/bucketShareTier -- same lookups,
// continuous shading instead of a class (see tierAlpha's comment).
function bucketCountAlphaAttr(dictKey, bucketKey, team, invert = false, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const countOf = (t) => DATA.team_stats[t][dictKey][bucketKey] || 0;
  return tierAlphaAttr(countOf(team), pool.map(countOf), invert, threshold);
}
function bucketShareAlphaAttr(dictKey, totalKey, bucketKey, team, invert = false, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const shareOf = (t) => {
    const s = DATA.team_stats[t];
    return s[totalKey] ? (s[dictKey][bucketKey] || 0) / s[totalKey] : 0;
  };
  return tierAlphaAttr(shareOf(team), pool.map(shareOf), invert, threshold);
}

// One-click week/matchup picker, shared by all pages. Reads DATA.schedule
// (the real schedule for whatever season was requested, even if the stats
// themselves fell back to last season -- see build_stats.py) and
// DATA.current_week. Clicking a matchup card calls options.onSelect (by
// default: sets the away/home selects) then onPick (each page's own
// render()) -- the manual dropdowns stay fully functional on their own on
// the two-select pages, this is just a faster path to the same state.
// Game Overviews has no selects at all, so it supplies its own
// getSelected/onSelect that read/write its own "current game" index instead.
let scheduleWeek = null;

// The three pages (TD Data, First TD Data, Game Previews) are separate page
// loads, not a single-page app, so carrying "the game I'm looking at" across
// a tab click can't just live in memory -- localStorage is what makes that
// survive the navigation. Only an EXPLICIT pick (a matchup card click, or
// Game Previews' flipper) gets saved here; the default "first game of the
// week" every page falls back to on its own is deterministic and doesn't
// need it, so a page nobody has ever clicked into still opens on the
// upcoming game instead of something stale.
const SELECTED_GAME_KEY = "nfl-tool.selected-game.v1";

function loadSelectedGame() {
  try {
    return JSON.parse(localStorage.getItem(SELECTED_GAME_KEY));
  } catch (e) {
    return null;
  }
}

function saveSelectedGame(week, away, home) {
  try {
    localStorage.setItem(SELECTED_GAME_KEY, JSON.stringify({ week, away, home }));
  } catch (e) {
    // localStorage unavailable -- selection just won't carry across pages.
  }
}

function renderMatchupRow(rowEl, week, selectedAway, selectedHome) {
  const games = (DATA.schedule || []).filter((g) => g.week === week);
  if (games.length === 0) {
    rowEl.innerHTML = `<p class="no-data-note">No games scheduled for this week.</p>`;
    return;
  }
  rowEl.innerHTML = games
    .map((g) => {
      const selected = g.away === selectedAway && g.home === selectedHome ? " selected" : "";
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

function initScheduleScroller(onPick, options = {}) {
  const getSelected =
    options.getSelected ||
    (() => ({
      away: document.getElementById("away-select").value,
      home: document.getElementById("home-select").value,
    }));
  const onSelect =
    options.onSelect ||
    ((away, home) => {
      document.getElementById("away-select").value = away;
      document.getElementById("home-select").value = home;
    });
  const onWeekChange = options.onWeekChange || (() => {});

  const wrap = document.getElementById("schedule-scroller");
  if (!wrap) return;
  if (!DATA.schedule || DATA.schedule.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const weeks = [...new Set(DATA.schedule.map((g) => g.week))].sort((a, b) => a - b);
  scheduleWeek = DATA.current_week && weeks.includes(DATA.current_week) ? DATA.current_week : weeks[0];

  // Apply a stored explicit pick if it matches this week's slate, else fall
  // back to the week's earliest game (schedule is already date/time-sorted)
  // -- either way, the page opens on a real game instead of blank selects.
  const weekGames = DATA.schedule.filter((g) => g.week === scheduleWeek);
  const stored = loadSelectedGame();
  const storedMatch = stored && stored.week === scheduleWeek && weekGames.find((g) => g.away === stored.away && g.home === stored.home);
  const initialGame = storedMatch || weekGames[0];
  if (initialGame) onSelect(initialGame.away, initialGame.home);

  const label = document.getElementById("week-label");
  const row = document.getElementById("matchup-row");
  const prevBtn = document.getElementById("week-prev");
  const nextBtn = document.getElementById("week-next");

  function refresh() {
    label.textContent = `Week ${scheduleWeek}`;
    const { away, home } = getSelected();
    renderMatchupRow(row, scheduleWeek, away, home);
    prevBtn.disabled = scheduleWeek <= weeks[0];
    nextBtn.disabled = scheduleWeek >= weeks[weeks.length - 1];
  }

  prevBtn.addEventListener("click", () => {
    const idx = weeks.indexOf(scheduleWeek);
    if (idx > 0) {
      scheduleWeek = weeks[idx - 1];
      refresh();
      onWeekChange();
    }
  });
  nextBtn.addEventListener("click", () => {
    const idx = weeks.indexOf(scheduleWeek);
    if (idx < weeks.length - 1) {
      scheduleWeek = weeks[idx + 1];
      refresh();
      onWeekChange();
    }
  });
  row.addEventListener("click", (e) => {
    const card = e.target.closest(".matchup-card");
    if (!card) return;
    onSelect(card.dataset.away, card.dataset.home);
    saveSelectedGame(scheduleWeek, card.dataset.away, card.dataset.home);
    [...row.querySelectorAll(".matchup-card")].forEach((c) => c.classList.toggle("selected", c === card));
    onPick();
  });

  refresh();
}

// ---- Matchup Snapshot: automated mismatch finder ----
// Surfaces places where one team's own tendency (a real, z-scored outlier
// league-wide) lines up with the other team's own tendency on the exact
// same stat -- e.g. a team that feeds a position a lot meeting a defense
// that leaks to that position a lot. Every insight is stated as a plain
// fact pair (both raw numbers, both percentile context), never a pick or
// a "target this" recommendation -- consistent with this site's color
// coding being a magnitude signal, not a verdict.

// 0 (both sides sit at the league mean, least interesting) and up from
// there (both sides further from the pack, more interesting) -- same
// z-score scale as every tier color on the site, not a fixed 0-1 range, so
// this is only ever compared relatively (sorting candidate insights
// against each other), never against an absolute cutoff.
function insightMagnitude(offZ, defZ) {
  return Math.abs(offZ) + Math.abs(defZ);
}

// offGetter/defGetter: (team) => raw value for that stat. offInvert/
// defInvert: same meaning as percentileTier's invert. Returns
// {magnitude, offVal, defVal} ONLY when offTeam's own value is a real
// z-scored outlier on the good side AND defTeam's own (allowed-side) value
// is an outlier on the bad side, on the exact same stat -- a real "good
// offense meets bad defense" opportunity, using the same TIER_Z_THRESHOLD
// every colored cell on the site uses (was its own raw percentile-rank cutoff
// before, which could flip on a fractional difference the same way the old
// tier coloring used to). Deliberately one-directional: this summary
// surfaces angles that ARE likely, never the inverse "both sides weak,
// unlikely to happen" case.
function checkOpportunity(offTeam, defTeam, offGetter, defGetter, offInvert, defInvert) {
  const pool = teamsWithGames();
  if (pool.length < 3) return null;
  const offVal = offGetter(offTeam);
  const defVal = defGetter(defTeam);
  if (offVal === null || offVal === undefined || defVal === null || defVal === undefined) return null;

  const offZ = zScore(offVal, pool.map(offGetter), offInvert);
  const defZ = zScore(defVal, pool.map(defGetter), defInvert);
  if (offZ === null || defZ === null) return null;

  if (offZ >= TIER_Z_THRESHOLD && defZ <= -TIER_Z_THRESHOLD) {
    return { magnitude: insightMagnitude(offZ, defZ), offVal, defVal };
  }
  return null;
}

// Each opportunity carries {category, subject, team, magnitude, label}.
// subject is the shared thing being targeted (a position, a distance
// bucket, etc.) -- when BOTH matchup directions produce an opportunity
// with the same category+subject (e.g. both teams lean on TEs against
// each other), they're merged into one "both teams" line instead of two
// near-duplicate ones. category "first_td" never merges since its
// subject is inherently which team, not a shared thing.
function renderMatchupSnapshot(opportunities) {
  const valid = opportunities.filter(Boolean);
  if (valid.length === 0) {
    return `<p class="no-data-note">No standout opportunities turned up between these two teams this time.</p>`;
  }

  const merged = [];
  const used = new Set();
  valid.forEach((o, i) => {
    if (used.has(i)) return;
    if (o.subject) {
      const partnerIdx = valid.findIndex(
        (other, j) => j !== i && !used.has(j) && other.category === o.category && other.subject === o.subject
      );
      if (partnerIdx !== -1) {
        used.add(i);
        used.add(partnerIdx);
        merged.push({
          magnitude: Math.max(o.magnitude, valid[partnerIdx].magnitude),
          text: `Target ${o.label} &mdash; both teams lean on it.`,
        });
        return;
      }
    }
    used.add(i);
    merged.push({ magnitude: o.magnitude, text: `Target ${o.team} ${o.label}.` });
  });

  const items = merged
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 8)
    .map((i) => `<li>${i.text}</li>`)
    .join("");
  return `<ul class="snapshot-list">${items}</ul>`;
}

// TD Data's Red Zone Touchdowns section. Dropped the volume rows this used
// to have (Plays/Carries/Targets) entirely -- they only count how much
// action a defense allowed inside the 20, not what happened once it got
// there (a defense that allows one red zone snap and it's a touchdown
// looked great on every volume row despite a 100% TD rate; a defense that
// stones three straight trips on 4th down looked bad despite a 0% TD rate),
// and being raw counts on a league spread that's tight-but-real, they were
// also prone to flipping color on a single-play difference sitting right at
// the z-score cutoff (verified: MIN/TB at 146 red-zone plays sat at
// z=-0.624, CAR at 147 sat at z=-0.587 -- one side of a threshold that's
// inherent to any hard cutoff on a volume count, not a bug, but exactly
// why a real rate metric is worth trusting more). RZ TD % (trips that
// actually ended in a score) is the number that answers "what actually
// happens when this defense is backed up."
const RED_ZONE_ROWS = [
  { label: "RZ TD %", totalOffKey: "rz_trips", rateOffKey: "rz_td_rate", totalDefKey: "rz_trips_allowed", rateDefKey: "rz_td_rate_allowed", ratePct: true },
  { label: "RZ TD", totalOffKey: "rz_td", rateOffKey: "rz_td_per_g", totalDefKey: "rz_td_allowed", rateDefKey: "rz_td_allowed_per_g" },
  { label: "RZ Trips", totalOffKey: "rz_trips", rateOffKey: "rz_trips_per_g", totalDefKey: "rz_trips_allowed", rateDefKey: "rz_trips_allowed_per_g" },
];

function renderRedZoneTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = RED_ZONE_ROWS.map((r) => {
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    const offRateExtreme = tierFor(r.rateOffKey, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defRateExtreme = tierFor(r.rateDefKey, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offTotalA = tierForAlphaAttr(r.totalOffKey, offTeam, false);
    const offRateA = tierForAlphaAttr(r.rateOffKey, offTeam, false);
    const defTotalA = tierForAlphaAttr(r.totalDefKey, defTeam, true);
    const defRateA = tierForAlphaAttr(r.rateDefKey, defTeam, true);
    const offRateDisplay = r.ratePct ? `${Math.round(off[r.rateOffKey] * 100)}%` : fmt(off[r.rateOffKey], 2);
    const defRateDisplay = r.ratePct ? `${Math.round(def[r.rateDefKey] * 100)}%` : fmt(def[r.rateDefKey], 2);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}"${offTotalA}>${off[r.totalOffKey]}</td><td class="num ${offRateCls}"${offRateA}>${offRateDisplay}</td><td class="num ${defTotalCls}"${defTotalA}>${def[r.totalDefKey]}</td><td class="num ${defRateCls}"${defRateA}>${defRateDisplay}</td>${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// market picks which player-prop odds a team-header click opens in the
// modal -- "anytime_td" everywhere by default, "first_td" on the First TD
// Data page (see that page's headerRow call).
function headerRow(offTeam, defTeam, subLabels, market = "anytime_td") {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th colspan="2" style="${offStyle}"><span class="team-click" data-team="${offTeam}" data-market="${market}">${teamLogoMini(offTeam)} ${offTeam}</span><span class="col-sub">OFF</span></th><th colspan="2" style="${defStyle}"><span class="team-click" data-team="${defTeam}" data-market="${market}">${teamLogoMini(defTeam)} ${defTeam}</span><span class="col-sub">DEF</span></th><th rowspan="2" class="edge-hdr">ADV</th></tr>
    <tr><th></th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th></tr>`;
}

// Plain-language decode of a row's two tier colors -- which team the stat
// favors, so a viewer doesn't have to mentally cross-reference green/red
// against which side is offense vs defense. Fires on a real top-third-vs-
// bottom-third mismatch (the same bar checkOpportunity() uses), OR when
// one side is a genuine EXTREME outlier (TIER_Z_EXTREME_THRESHOLD, not just
// "bottom third") and the other is merely average -- a historically bad
// bottom-3-in-the-league defense gets exploited by an average offense too,
// not just a great one, and the mirror holds for a dominant defense/offense
// against an average opponent. offExtreme/defExtreme are optional (a caller
// that doesn't pass them just gets the original two-case behavior).
// extreme is always a strict subset of its own non-extreme tier (the
// threshold is stricter), so by the time an extreme check is reached the
// matching non-extreme case above it has already ruled out the exact-
// opposite-extreme pairing -- these can't double-fire.
function advantageTeam(offTier, defTier, offTeam, defTeam, offExtreme = "", defExtreme = "") {
  if (offTier === "tier-good" && defTier === "tier-bad") return offTeam;
  if (offTier === "tier-bad" && defTier === "tier-good") return defTeam;
  if (defExtreme === "tier-bad" && offTier === "tier-mid") return offTeam;
  if (offExtreme === "tier-bad" && defTier === "tier-mid") return defTeam;
  if (defExtreme === "tier-good" && offTier === "tier-mid") return defTeam;
  if (offExtreme === "tier-good" && defTier === "tier-mid") return offTeam;
  return "--";
}
// Colored in the WINNING team's own accent (same normalized color the
// header bars use), not a fixed site accent -- two teams that both happen
// to be blue-ish still need to read as different teams here.
function edgeCell(offTier, defTier, offTeam, defTeam, offExtreme = "", defExtreme = "") {
  const team = advantageTeam(offTier, defTier, offTeam, defTeam, offExtreme, defExtreme);
  if (team === "--") return `<td class="edge-cell">--</td>`;
  const rgb = teamAccentRgb(team);
  return `<td class="edge-cell edge-hit" style="background:rgba(${rgb.join(",")},0.14)">${teamLogoMini(team)}</td>`;
}

// ---- Player anytime-TD odds modal ----
// Every team name on every stat table (headerRow, and Game Overviews'
// pairedStatHeader/schemeTableHeader) is wrapped in a .team-click span --
// one delegated listener here handles all of them, on every page, so a
// table that gets re-rendered (innerHTML replaced) never needs its own
// listener reattached.
function fmtOddsSigned(n) {
  if (n === null || n === undefined) return "--";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function ensurePlayerOddsModal() {
  if (document.getElementById("player-odds-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "player-odds-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="player-odds-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePlayerOddsModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePlayerOddsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlayerOddsModal();
  });
}

function closePlayerOddsModal() {
  const el = document.getElementById("player-odds-modal");
  if (el) el.hidden = true;
}

// ---- Possible Plays ----
// A "napkin math" notes list, deliberately separate from the graded Pick
// Tracker -- checking a box here just remembers a player/side worth
// considering as you browse, nothing gets graded. Shared across every page
// (the odds modal on TD Data/First TD Data/Game Previews, the mainline
// checkboxes on Game Previews, and the Possible Plays page that lists them
// all back out grouped by week).
const POSSIBLE_PLAYS_KEY = "nfl-tool.possible-plays.v1";

// Round-trips a JS object through a data-* attribute regardless of what
// characters are in it (player names with apostrophes/periods, etc.) --
// base64 of the UTF-8 JSON sidesteps HTML-attribute-escaping entirely.
function encodeDataAttr(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function decodeDataAttr(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str))));
}

function loadPossiblePlays() {
  try {
    return JSON.parse(localStorage.getItem(POSSIBLE_PLAYS_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function savePossiblePlays(list) {
  try {
    localStorage.setItem(POSSIBLE_PLAYS_KEY, JSON.stringify(list));
  } catch (e) {
    // localStorage unavailable -- the checkbox just won't stick.
  }
}
function isPossiblePlay(id) {
  return loadPossiblePlays().some((p) => p.id === id);
}
// Plain checkbox semantics: present -> removed, absent -> added.
function togglePossiblePlay(entry) {
  const list = loadPossiblePlays();
  const idx = list.findIndex((p) => p.id === entry.id);
  if (idx === -1) list.push({ ...entry, added_at: new Date().toISOString() });
  else list.splice(idx, 1);
  savePossiblePlays(list);
}

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".pp-toggle");
  if (!cb) return;
  togglePossiblePlay(decodeDataAttr(cb.dataset.entry));
});

// ---- Player prop odds modal ----
const PLAY_MARKET_LABELS = { anytime_td: "Anytime TD", first_td: "First TD" };

// From build_stats.py's SportsGameOdds pull -- entirely optional
// (DATA.player_td_odds/player_first_td_odds are null if no API key was
// configured at build time), so this degrades to a plain message rather
// than a broken modal when it's missing.
// Shows BOTH teams in the game, not just whichever team header was clicked
// -- clicking either side opens the same full list, merged and sorted by
// implied probability so the most likely scorers in the whole game float
// to the top regardless of which team they're on. Each row tagged with its
// own team (not the clicked team) and highlighted in that team's color so
// a mixed list still reads at a glance.
function renderPlayerOddsModalContent(team, market) {
  const marketLabel = PLAY_MARKET_LABELS[market] || PLAY_MARKET_LABELS.anytime_td;
  const dataField = market === "first_td" ? DATA.player_first_td_odds : DATA.player_td_odds;
  const game = (DATA.schedule || []).find((g) => g.week === scheduleWeek && (g.away === team || g.home === team));
  const matchup = game ? `${game.away} @ ${game.home}` : team;
  const heading = `<h3>${matchup} &mdash; ${marketLabel} Odds</h3>`;
  if (!dataField) {
    return `${heading}<p class="no-data-note">Player odds aren't configured for this build.</p>`;
  }
  const weekNum = game ? game.week : scheduleWeek;
  const gameTeams = game ? [game.away, game.home] : [team];
  const rows = gameTeams.flatMap((t) => (dataField[t] || []).map((p) => ({ ...p, team: t }))).sort((a, b) => b.implied_prob - a.implied_prob);
  if (rows.length === 0) {
    return `${heading}<p class="no-data-note">No ${marketLabel.toLowerCase()} odds posted for this game yet.</p>`;
  }

  const body = rows
    .map((p) => {
      const entry = {
        id: `${weekNum}_${market}_${p.team}_${p.name}`,
        week: weekNum,
        matchup,
        category: marketLabel,
        description: `${p.name} (${p.team})`,
        odds: fmtOddsSigned(p.best_odds),
        book: p.best_book,
      };
      const checked = isPossiblePlay(entry.id) ? " checked" : "";
      const rgb = teamAccentRgb(p.team);
      const rowStyle = `border-left:4px solid rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.07);`;
      return `<tr style="${rowStyle}"><td><label class="pp-row-label"><input type="checkbox" class="pp-toggle" data-entry="${encodeDataAttr(entry)}"${checked}> ${p.name} <span class="muted-label">(${p.team})</span></label></td><td class="num">${fmtOddsSigned(p.best_odds)}</td><td class="muted-label">${p.best_book}</td><td class="num">${Math.round(p.implied_prob * 100)}%</td></tr>`;
    })
    .join("");
  return `${heading}
    <p class="no-data-note">${marketLabel} scorer -- best price found across a handful of books (SportsGameOdds free tier). A ballpark, not every book, not live. Only players with an actual posted line show up here -- someone missing usually means they're out or hurt. Check a player to add them to Possible Plays.</p>
    <table class="data-table player-odds-table">
      <thead><tr><th>Player</th><th>Odds</th><th>Book</th><th>Implied %</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function openPlayerOddsModal(team, market = "anytime_td") {
  ensurePlayerOddsModal();
  document.getElementById("player-odds-modal-content").innerHTML = renderPlayerOddsModalContent(team, market);
  document.getElementById("player-odds-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".team-click");
  if (btn) openPlayerOddsModal(btn.dataset.team, btn.dataset.market || "anytime_td");
});
