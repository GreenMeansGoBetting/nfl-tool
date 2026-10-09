// Shared helpers used across index.html (season TDs + first-TD mini-game,
// toggled on one page), game-overview.html, and possible-plays.html. Each
// page fetches its own data.json and sets the shared DATA variable before
// calling any of these.
let DATA = null;

// Light/dark theme -- dark is the default; the choice is remembered per
// browser. Every page's <head> applies the saved theme before first paint
// (no flash); this just wires the header button.
const THEME_KEY = "nfl-tool.theme";
function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const sync = () => {
    const light = document.documentElement.dataset.theme === "light";
    btn.innerHTML = light ? "&#9790;" : "&#9788;";
    btn.title = light ? "Switch to dark theme" : "Switch to light theme";
  };
  sync();
  btn.addEventListener("click", () => {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, light ? "light" : "dark");
    } catch (e) {
      // localStorage unavailable -- theme just won't stick across reloads.
    }
    sync();
  });
}
initThemeToggle();

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

// Full-width team logo + spelled-out name header, tinted in the team's own
// color -- shared by every per-player table on the site (Season TDs'
// leaderboard, First TD's Red Zone Usage, Player Props) since they all have
// room to spare for it. clickable=true (Player Props' full prop catalog
// modal) adds the same affordance the TD-odds ".team-click" header cells
// already use, just its own class/listener since it opens a different modal.
function teamBannerHeader(team, clickable = false) {
  const rgb = teamAccentRgb(team);
  const cls = clickable ? "team-banner props-team-click" : "team-banner";
  return `<div class="${cls}" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})" ${clickable ? `data-team="${team}"` : ""}>
    <img src="${teamLogoUrl(team)}" class="team-logo" alt="${team}" loading="lazy">
    <span class="team-banner-name">${TEAM_NAMES[team] || team}</span>
  </div>`;
}

// Colors are judged PER GAME, not on the displayed season total -- a team
// with 1 game played (e.g. the Monday-night teams on a Monday) has half the
// total of a 2-game team for reasons that have nothing to do with quality,
// which used to inflate/deflate every count-based color. Any stat with a
// "<key>_per_g" sibling is compared on that; the cell still DISPLAYS the
// total. Stats with no per-game sibling are already rates/shares.
function tierValue(t, statKey) {
  const s = DATA.team_stats[t];
  const pg = s[statKey + "_per_g"];
  return pg !== undefined && pg !== null ? pg : s[statKey];
}
function tierFor(statKey, team, invert, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => tierValue(t, statKey));
  return percentileTier(tierValue(team, statKey), values, invert, threshold);
}
// Companion to tierFor -- same lookup, continuous shading instead of a class.
function tierForAlphaAttr(statKey, team, invert, threshold = TIER_Z_THRESHOLD) {
  const pool = teamsWithGames();
  const values = pool.map((t) => tierValue(t, statKey));
  return tierAlphaAttr(tierValue(team, statKey), values, invert, threshold);
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
  // Per game (see tierValue) -- raw bucket counts scale with games played.
  const countOf = (t) => (DATA.team_stats[t][dictKey][bucketKey] || 0) / (DATA.team_stats[t].games_played || 1);
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
  const countOf = (t) => (DATA.team_stats[t][dictKey][bucketKey] || 0) / (DATA.team_stats[t].games_played || 1);
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

// TD Data and Game Previews are separate page loads, not a single-page app,
// so carrying "the game I'm looking at" across a tab click can't just live
// in memory -- localStorage is what makes that
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
      // Finished games show each team's score under its logo (winner bold)
      // instead of the date.
      const final = g.status === "final" && g.away_score !== null && g.away_score !== undefined && g.home_score !== null && g.home_score !== undefined;
      if (final) {
        const score = (team, pts, opp) => `<span class="matchup-team-col"><img src="${teamLogoUrl(team)}" class="team-logo" alt="${team}" loading="lazy"><span class="matchup-score${pts > opp ? " matchup-score-win" : pts < opp ? " matchup-score-loss" : ""}">${pts}</span></span>`;
        return `<button type="button" class="matchup-card matchup-card-final${selected}" data-away="${g.away}" data-home="${g.home}" title="Final">
        <span class="matchup-teams-row">
          ${score(g.away, g.away_score, g.home_score)}
          <span class="at">@</span>
          ${score(g.home, g.home_score, g.away_score)}
        </span>
      </button>`;
      }
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

// Every headerRow()-based table (label + 4 data columns + ADV, 6 total)
// needs this immediately before its <thead> to actually get narrow columns.
// table-layout:fixed's column-width algorithm doesn't reliably honor
// individual th/td widths once the header row has colspan cells (verified:
// browsers redistributed the space unpredictably instead of respecting the
// declared per-column widths) -- <colgroup> is the spec-correct way to pin
// column widths regardless of what the header row's cells span.
const STAT_TABLE_COLGROUP =
  '<colgroup><col style="width:64px"><col style="width:52px"><col style="width:52px"><col style="width:52px"><col style="width:52px"><col style="width:26px"></colgroup>';

// market picks which player-prop odds an OFF team-header click opens in
// the modal -- "anytime_td" everywhere by default, "first_td" on the First
// TD Data page (see that page's headerRow call). The DEF header opens the
// TDs-allowed log instead (openTdAllowedModal).
function headerRow(offTeam, defTeam, subLabels, market = "anytime_td") {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th colspan="2" style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}" data-market="${market}">${teamLogoMini(offTeam, 20)}</span> <span class="pair-hdr-sub">OFF</span></th><th colspan="2" style="${defStyle}"><span class="td-allowed-click" data-team="${defTeam}" title="All TDs allowed by this defense"><span class="pair-hdr">${teamLogoMini(defTeam, 20)}</span> <span class="pair-hdr-sub">DEF</span></span></th><th rowspan="2" class="edge-hdr">ADV</th></tr>
    <tr><th></th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th></tr>`;
}

// ---- The matchup rule: every offense-vs-defense call goes through here ----
// A matchup is only as good as BOTH of its sides, so each side comes in on
// the same footing: + = good for the OFFENSE (the offense produces it / the
// defense allows it), as a z-score or a rank lean. A call needs one side
// pointing clearly one way AND the other side not pointing the other way --
// an average alone would let a great offense hide a great defense (or the
// reverse), which is exactly how a "tough" call used to ignore a defense
// that gets gashed in the very look it leans on. How OFTEN a defense shows
// a look only decides whether the look matters, never which way it points.
const MATCHUP_CONTRA = 0.3;
// dir: +1 offense edge, -1 defense edge, 0 no call.
function matchupCall(offZ, defZ, th = TIER_Z_THRESHOLD, contra = MATCHUP_CONTRA) {
  if (offZ === null || offZ === undefined || defZ === null || defZ === undefined) return { dir: 0, edge: null };
  const edge = (offZ + defZ) / 2;
  const hi = Math.max(offZ, defZ);
  const lo = Math.min(offZ, defZ);
  if (hi >= th && lo > -contra) return { dir: 1, edge };
  if (lo <= -th && hi < contra) return { dir: -1, edge };
  return { dir: 0, edge };
}
// Four-way read from each unit's own point of view (offense: produces a
// lot = good; defense: allows little = good), same z inputs as above.
function matchupKind(offZ, defZ, th = TIER_Z_THRESHOLD) {
  if (offZ === null || offZ === undefined || defZ === null || defZ === undefined) return null;
  const offGood = offZ >= th, offBad = offZ <= -th;
  const defGood = defZ <= -th, defBad = defZ >= th; // defZ is "allows" (+ = leaky)
  if (offGood && defBad) return "mismatch";
  if (offBad && defGood) return "tough";
  if (offGood && defGood) return "strong";
  if (offBad && defBad) return "weak";
  return null;
}

// Plain-language decode of a row's two tier colors -- which team the stat
// favors, so a viewer doesn't have to mentally cross-reference green/red
// against which side is offense vs defense. OFFENSE-ONLY BY DESIGN: the ADV
// column never credits the defense, even when the defense is the lopsided/
// extreme side -- a viewer shouldn't have to double check which side "ADV"
// points to, and "the defense is dominant" is already visible from the row's
// own tier coloring without needing a second callout. "extreme" (a genuine
// outlier, TIER_Z_EXTREME_THRESHOLD) gets the full-strength highlight;
// "marginal" (a plain top-third-vs-bottom-third mismatch that doesn't reach
// outlier territory) still shows the logo, just faded, instead of vanishing.
function offAdvantageStrength(offTier, defTier, offExtreme = "", defExtreme = "") {
  if (offExtreme === "tier-good" && defTier === "tier-mid") return "extreme";
  if (defExtreme === "tier-bad" && offTier === "tier-mid") return "extreme";
  if (offTier === "tier-good" && defTier === "tier-bad") return "marginal";
  return "";
}
// Colored in the offense's own accent (same normalized color the header
// bars use), not a fixed site accent -- two teams that both happen to be
// blue-ish still need to read as different teams here.
function edgeCell(offTier, defTier, offTeam, defTeam, offExtreme = "", defExtreme = "") {
  const strength = offAdvantageStrength(offTier, defTier, offExtreme, defExtreme);
  if (!strength) return `<td class="edge-cell">--</td>`;
  const rgb = teamAccentRgb(offTeam);
  const alpha = strength === "extreme" ? 0.14 : 0.06;
  const cls = strength === "extreme" ? "edge-hit" : "edge-hit edge-hit-marginal";
  return `<td class="edge-cell ${cls}" style="background:rgba(${rgb.join(",")},${alpha})">${teamLogoMini(offTeam)}</td>`;
}

// ---- League-wide stat-rank modal ----
// Click any colored numerical cell to see all teams' values for that EXACT
// stat, so you can gauge how extreme a number really is (e.g. "Colts allow
// 28 TDs under 10 yards -- how bad is that really?"). Getter-based rather
// than a flat key string, since not every stat lives at
// team_stats[team][key] -- some are nested under a bucket dict (TD by
// length/position), some are a share computed from two fields on the fly
// (bucketShareTier's own pattern), and a couple (first-TD-allowed games/
// rate) are derived via their own named functions already used elsewhere
// for tiering. statRankGetter() covers all four shapes from one small
// payload rather than needing a different modal per shape.
//
// Always sorted by raw value descending regardless of invert -- for an
// "allowed" stat that puts the worst offenders at the top, for an offense
// stat it puts the top producers at the top, either way answering "where
// does this number fall" without an explicit rank number (a similar list
// elsewhere on the site showed an explicit worst-to-best rank and it read
// backwards/confusing -- color alone already carries that signal
// correctly, so no rank number here either).
const STAT_RANK_COMPUTED = {
  firstTdAllowedGames: (t) => firstTdAllowedGames(t),
  firstTdAllowedRate: (t) => firstTdAllowedRate(t),
};

function statRankGetter(p) {
  if (p.computed) return STAT_RANK_COMPUTED[p.computed];
  if (p.shareOf) {
    const { dictKey, totalKey, bucketKey } = p.shareOf;
    return (t) => {
      const s = DATA.team_stats[t];
      return s && s[totalKey] ? (s[dictKey][bucketKey] || 0) / s[totalKey] : null;
    };
  }
  if (p.dictKey) return (t) => DATA.team_stats[t]?.[p.dictKey]?.[p.bucketKey];
  return (t) => DATA.team_stats[t]?.[p.statKey];
}

function ensureStatRankModal() {
  // Every opener starts from the normal width; the paired view widens it.
  const existing = document.querySelector("#stat-rank-modal .modal-box");
  if (existing) {
    existing.classList.remove("prk-box");
    existing.style.maxWidth = "";
  }
  if (document.getElementById("stat-rank-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "stat-rank-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="stat-rank-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeStatRankModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeStatRankModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeStatRankModal();
  });
}

function closeStatRankModal() {
  const el = document.getElementById("stat-rank-modal");
  if (el) el.hidden = true;
}

function openStatRankModal(p) {
  ensureStatRankModal();
  const getter = statRankGetter(p);
  const rows = teamsWithGames()
    .map((t) => ({ team: t, value: getter(t) }))
    .filter((r) => r.value !== null && r.value !== undefined)
    .sort((a, b) => b.value - a.value);
  const values = rows.map((r) => r.value);
  const display = (v) => (p.percent ? `${Math.round(v * 100)}%` : fmt(v, p.digits ?? 0));
  const body = rows
    .map((r) => {
      const cls = percentileTier(r.value, values, !!p.invert);
      const alpha = tierAlphaAttr(r.value, values, !!p.invert);
      const rowCls = r.team === p.team ? ' class="stat-rank-current"' : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${TEAM_NAMES[r.team] || r.team}</td><td class="num ${cls}"${alpha}>${display(r.value)}</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${p.label} &mdash; All Teams</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Team</th><th class="num">${p.label}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

// Wraps a tier-colored value in a clickable <td> that opens the league-rank
// modal for that exact number. `display` is the already-formatted cell
// content (a plain value, or a value plus a muted suffix like "(n=12)"),
// `cls`/`alphaAttr` are the same tier class/inline-alpha every other cell
// on the site already computes, `payload` is whatever statRankGetter needs
// plus `team` (for highlighting that row in the modal) and `label`.
function numCell(display, cls, alphaAttr, payload) {
  return `<td class="num ${cls} stat-rank-click"${alphaAttr} data-entry="${encodeDataAttr(payload)}">${display}</td>`;
}

// ---- Paired league ranks: offense beside defense ----
// Clicking a number in an OFF/DEF matchup row shows BOTH league lists side
// by side: TEAM | offense value | defense value | TEAM, each column sorted
// on its own, with this matchup's offense highlighted on the left and its
// defense on the right. The partner is the opposite side's cell in the
// same slot of the same row (total<->total, rate<->rate).
function statRankRows(p) {
  const getter = statRankGetter(p);
  const rows = teamsWithGames()
    .map((t) => ({ team: t, value: getter(t) }))
    .filter((r) => r.value !== null && r.value !== undefined)
    .sort((a, b) => b.value - a.value);
  const values = rows.map((r) => r.value);
  const display = (v) => (p.percent ? `${Math.round(v * 100)}%` : fmt(v, p.digits ?? 0));
  return rows.map((r) => ({
    team: r.team,
    cells: [`<td class="num ${percentileTier(r.value, values, !!p.invert)}"${tierAlphaAttr(r.value, values, !!p.invert)}>${display(r.value)}</td>`],
  }));
}

function statRankKey(p) {
  return JSON.stringify([p.statKey, p.dictKey, p.bucketKey, p.shareOf, p.computed]);
}

// left/right: { heads: [th labels...], rows: [{team, cells: [td html...]}], current: team }
// The right side's value cells are mirrored so both value columns meet in
// the middle; every value column shares one width so the halves match.
function openPairedRankModal(title, left, right) {
  ensureStatRankModal();
  const n = Math.max(left.rows.length, right.rows.length);
  const k = left.heads.length;
  const teamTd = (r, cur) => `<td class="prk-team${r.team === cur ? " prk-current" : ""}">${teamLogoMini(r.team)} <span>${TEAM_NAMES[r.team] || r.team}</span></td>`;
  const blank = (count) => "<td></td>".repeat(count);
  const body = [];
  for (let i = 0; i < n; i++) {
    const l = left.rows[i];
    const r = right.rows[i];
    const lCells = l ? teamTd(l, left.current) + l.cells.map((c) => (l.team === left.current ? c.replace("<td", '<td data-cur="1"') : c)).join("") : blank(k + 1);
    const rCells = r ? r.cells.slice().reverse().map((c) => (r.team === right.current ? c.replace("<td", '<td data-cur="1"') : c)).join("") + teamTd(r, right.current) : blank(k + 1);
    body.push(`<tr><td class="prk-rank">${i + 1}</td>${lCells}<td class="prk-gap"></td>${rCells}</tr>`);
  }
  // One value column per side stays wide; several (Red Zone's Trips/TDs/
  // FGs/Avg + Grade) share narrower ones, and the popup grows to fit.
  const valW = k > 1 ? 58 : 96;
  const teamW = 190;
  const tableW = 30 + 14 + 2 * teamW + 2 * k * valW + (4 * k + 6) * 3;
  const valCol = `<col style="width:${valW}px">`;
  const cols = `<col style="width:30px"><col style="width:${teamW}px">${valCol.repeat(k)}<col style="width:14px">${valCol.repeat(k)}<col style="width:${teamW}px">`;
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${title}</h3>
    <table class="data-table player-odds-table prk-table" style="width:${tableW}px">
      <colgroup>${cols}</colgroup>
      <thead><tr><th></th><th class="prk-team-h">Offense</th>${left.heads.map((h) => `<th class="num">${h}</th>`).join("")}<th></th>${right.heads.slice().reverse().map((h) => `<th class="num">${h}</th>`).join("")}<th class="prk-team-h">Defense</th></tr></thead>
      <tbody>${body.join("")}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
  const box = document.querySelector("#stat-rank-modal .modal-box");
  box.classList.add("prk-box");
  box.style.maxWidth = `min(96vw, ${tableW + 60}px)`;
}

// The opposite-side cell for a clicked cell, or null when the row has no
// real offense/defense counterpart (both cells are the same stat for two
// teams, a blank partner, or the cell opted out with noPair). The partner
// is found by COLUMN: a complete row in the same table (clickable cells for
// two teams, equal counts) shows how far the defense columns sit from the
// offense columns, so a missing "--" cell can never shift the pairing.
function pairedRankPartner(cell, selector) {
  const row = cell.closest("tr");
  const table = cell.closest("table");
  if (!row || !table) return null;
  const me = decodeDataAttr(cell.dataset.entry);
  if (!me || me.noPair) return null;
  let offTeam = null;
  let offset = null;
  for (const tr of table.querySelectorAll("tr")) {
    const cs = [...tr.querySelectorAll(selector)].filter((c) => !decodeDataAttr(c.dataset.entry).noPair);
    if (cs.length < 2 || cs.length % 2) continue;
    const teams = cs.map((c) => decodeDataAttr(c.dataset.entry).team);
    const half = cs.length / 2;
    if (new Set(teams.slice(0, half)).size !== 1 || new Set(teams.slice(half)).size !== 1 || teams[0] === teams[half]) continue;
    offTeam = teams[0];
    offset = cs[half].cellIndex - cs[0].cellIndex;
    break;
  }
  if (!offTeam || !offset) return null;
  const isOff = me.team === offTeam;
  const other = row.cells[cell.cellIndex + (isOff ? offset : -offset)];
  if (!other || !other.matches(selector)) return null;
  const partner = decodeDataAttr(other.dataset.entry);
  if (!partner || partner.noPair || partner.team === me.team) return null;
  return isOff ? { off: me, def: partner } : { off: partner, def: me };
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".stat-rank-click");
  if (!cell) return;
  const pair = pairedRankPartner(cell, ".stat-rank-click");
  if (pair && statRankKey(pair.off) !== statRankKey(pair.def)) {
    openPairedRankModal(
      `${pair.off.label} vs ${pair.def.label}`,
      { heads: [pair.off.label], rows: statRankRows(pair.off), current: pair.off.team },
      { heads: [pair.def.label], rows: statRankRows(pair.def), current: pair.def.team }
    );
    return;
  }
  openStatRankModal(decodeDataAttr(cell.dataset.entry));
});

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

// Raw American-odds -> implied win probability, same formula build_stats.py's
// moneyline_to_implied_prob uses server-side -- computed straight from the
// stored odds string here rather than needing its own stored field, so it
// works for every kind of saved possible play (player props, spreads,
// totals, moneylines) with no extra data to carry around.
function oddsToImpliedPct(oddsStr) {
  const n = parseFloat(oddsStr);
  if (isNaN(n) || n === 0) return null;
  const prob = n > 0 ? 100 / (n + 100) : -n / (-n + 100);
  return Math.round(prob * 100);
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
// (the odds modal on TD Data/Game Previews, the mainline
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
  window.NFLSync?.push(POSSIBLE_PLAYS_KEY, list);
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

// ---- Per-matchup notes (localStorage, keyed by away_home) -- shared by
// every page with a away/home select and a ".td-notes-input" box (TD Data,
// Player Props); "TD" in the key/name is legacy from where this started,
// the feature itself is matchup-generic. ----
const TD_NOTES_KEY = "nfl-tool.td-notes.v1";
function loadTdNotes() {
  try {
    return JSON.parse(localStorage.getItem(TD_NOTES_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveTdNote(key, text) {
  try {
    const all = loadTdNotes();
    if (text) all[key] = text;
    else delete all[key];
    localStorage.setItem(TD_NOTES_KEY, JSON.stringify(all));
    window.NFLSync?.push(TD_NOTES_KEY, all);
  } catch (e) {
    // localStorage unavailable -- notes just won't stick.
  }
}

// Live mirror of the shared Possible Plays list (same data the standalone
// Possible Plays page and every odds-modal checkbox read/write) -- shown
// right on whichever page called it, so a play checked in an odds modal
// shows up without leaving the page. Filtered to the currently selected
// away/home matchup only (matching both team codes against the entry's own
// matchup string, order-independent) -- switching to a different matchup
// should show that matchup's plays, not everything ever saved. Logo + name
// + odds only, no book: the whole point of "best price across a handful of
// books" is to shop it yourself, a single book name here would read as more
// final than it is. Entries without a team on file (older saves, or
// non-player picks) just skip the logo. Writes to every
// ".td-possible-plays-list" on the page, not just one -- TD Data's Season/
// First TD views each have their own copy (same underlying data), since
// only one view is visible at a time.
function renderTdPossiblePlaysList(away, home) {
  // Exact team-code match (split on " @ "), not a substring check -- LA is
  // a substring of LAC, so .includes() would wrongly match one team's
  // plays onto an unrelated matchup involving the other.
  const list = loadPossiblePlays().filter((p) => {
    if (!p.matchup) return false;
    const teams = p.matchup.split(" @ ");
    return teams.includes(away) && teams.includes(home);
  });
  const els = document.querySelectorAll(".td-possible-plays-list");
  if (!els.length) return;
  const html = !list.length
    ? `<p class="no-data-note">None yet for this matchup -- check a player or line in an odds modal to add one.</p>`
    : list
    .slice()
    .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
    .map((p) => {
      const pct = oddsToImpliedPct(p.odds);
      return `<div class="td-pp-row">${p.team ? teamLogoMini(p.team) : ""}<span class="td-pp-desc">${p.description}</span><span class="td-pp-category">${p.category || ""}</span><span class="td-pp-odds">${p.odds}${pct !== null ? ` <span class="td-pp-implied">(${pct}%)</span>` : ""}</span></div>`;
    })
    .join("");
  els.forEach((el) => (el.innerHTML = html));
}

// Mirrors typed notes across every ".td-notes-input" box on the page (TD
// Data's Season/First TD views each have their own copy of the same note)
// so neither ever shows stale text even without a re-render in between.
document.addEventListener("input", (e) => {
  if (!e.target.classList.contains("td-notes-input")) return;
  saveTdNote(e.target.dataset.key, e.target.value);
  document.querySelectorAll(".td-notes-input").forEach((el) => {
    if (el !== e.target) el.value = e.target.value;
  });
});

// Delegated so it catches a checkbox toggled inside a dynamically-created
// odds modal too, not just ones already in the page at load time. Guarded
// for pages with no away/home select at all (Possible Plays, Game
// Previews) -- those don't have a ".td-possible-plays-list" to update
// anyway, but the selects themselves don't exist there either.
document.addEventListener("change", (e) => {
  if (!e.target.closest(".pp-toggle")) return;
  const awaySel = document.getElementById("away-select");
  const homeSel = document.getElementById("home-select");
  if (!awaySel || !homeSel) return;
  renderTdPossiblePlaysList(awaySel.value, homeSel.value);
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
        description: p.name,
        team: p.team,
        odds: fmtOddsSigned(p.best_odds),
        book: p.best_book,
      };
      const checked = isPossiblePlay(entry.id) ? " checked" : "";
      const rgb = teamAccentRgb(p.team);
      const rowStyle = `border-left:4px solid rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.07);`;
      return `<tr style="${rowStyle}"><td><label class="pp-row-label"><input type="checkbox" class="pp-toggle" data-entry="${encodeDataAttr(entry)}"${checked}> ${p.name} <span class="muted-label">(${p.position || "?"})</span></label></td><td class="num">${fmtOddsSigned(p.best_odds)}</td><td class="muted-label">${p.best_book}</td><td class="num">${Math.round(p.implied_prob * 100)}%</td></tr>`;
    })
    .join("");
  return `${heading}
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

// ---- TDs allowed log: clicking a DEF header in a TD stat table lists
// every touchdown that defense has given up (build_stats.py's
// compute_td_allowed_log), one row per play in game order. ----
const TD_ALLOWED_TYPE_LABELS = { pass: "Pass", rush: "Run", dst: "Return/Def" };

function renderTdAllowedModalContent(team) {
  const log = (DATA.td_allowed_log || {})[team];
  const heading = `<h3 class="td-allowed-heading">${teamLogoMini(team, 24)} ${TEAM_NAMES[team] || team} &mdash; TDs Allowed</h3>`;
  if (!log) return `${heading}<p class="no-data-note">TD-by-TD data isn't in this build yet -- it appears after the next data refresh.</p>`;
  if (!log.length) return `${heading}<p class="no-data-note">No touchdowns allowed yet.</p>`;

  const byType = (t) => log.filter((e) => e.type === t).length;
  const posCounts = {};
  log.forEach((e) => (posCounts[e.position] = (posCounts[e.position] || 0) + 1));
  const posSummary = Object.entries(posCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([pos, n]) => `${pos} ${n}`)
    .join(" &middot; ");
  const summary = `<p class="td-allowed-summary"><b>${log.length}</b> TDs &mdash; ${byType("pass")} pass &middot; ${byType("rush")} run${byType("dst") ? ` &middot; ${byType("dst")} return/def` : ""} &nbsp;|&nbsp; ${posSummary}</p>`;

  const rows = log
    .map((e) => {
      const when = e.qtr ? `${e.qtr > 4 ? "OT" : `Q${e.qtr}`} ${e.clock || ""}` : "--";
      const first = e.first_td ? ` <span class="td-allowed-first">1st TD</span>` : "";
      const qb = e.passer ? `<span class="muted-label">${e.passer}</span>` : "";
      return `<tr>
        <td class="num">${e.week}</td>
        <td>${teamLogoMini(e.opp, 16)} ${e.opp}</td>
        <td>${e.player || "--"}${first}</td>
        <td class="num">${e.position || "--"}</td>
        <td class="td-allowed-type-${e.type}">${TD_ALLOWED_TYPE_LABELS[e.type] || e.type}</td>
        <td class="num">${e.yards ?? "--"}</td>
        <td>${qb}</td>
        <td class="num">${when}</td>
        <td class="num">${e.score_before || "--"}</td>
      </tr>`;
    })
    .join("");
  return `${heading}${summary}
    <table class="data-table td-allowed-table">
      <thead><tr><th class="num">Wk</th><th>Scored by</th><th>Player</th><th class="num">Pos</th><th>Type</th><th class="num">Yds</th><th>QB</th><th class="num">When</th><th class="num" title="Scoring team's score first, as of the snap">Score before</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function ensureTdAllowedModal() {
  if (document.getElementById("td-allowed-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "td-allowed-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="td-allowed-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => (overlay.hidden = true);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function openTdAllowedModal(team) {
  ensureTdAllowedModal();
  document.getElementById("td-allowed-modal-content").innerHTML = renderTdAllowedModalContent(team);
  document.getElementById("td-allowed-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".td-allowed-click");
  if (btn) openTdAllowedModal(btn.dataset.team);
});

// ---- Screenshot-ready summary cards (TD Data and Player Props) ----
// Shared by both pages' Summary tabs: photos, team banners, fitting the
// content into the fixed card, and the Save image export.
function normName(n) {
  return (n || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
}

function summaryTeamBanner(team) {
  const rgb = teamAccentRgb(team);
  return `<div class="sc-team" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})">
    <img src="${teamLogoUrl(team)}" crossorigin="anonymous" class="sc-team-logo" alt="">
    <span class="sc-team-name">${TEAM_NAMES[team] || team}</span>
  </div>`;
}

function shortName(name) {
  const parts = (name || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

// Player photo by name -- headshots are keyed by roster full name, odds by
// the sportsbook's spelling, so both go through normName.
function summaryHeadshot(team, name, size = 26) {
  const byTeam = (DATA.player_headshots || {})[team] || {};
  if (!summaryHeadshot.index) summaryHeadshot.index = {};
  if (!summaryHeadshot.index[team]) {
    summaryHeadshot.index[team] = {};
    Object.entries(byTeam).forEach(([n, url]) => (summaryHeadshot.index[team][normName(n)] = url));
  }
  const url = summaryHeadshot.index[team][normName(name)];
  return url
    ? `<img src="${url}" crossorigin="anonymous" class="sc-headshot" style="width:${size}px;height:${size}px" alt="">`
    : `<span class="sc-headshot sc-headshot-empty" style="width:${size}px;height:${size}px"></span>`;
}

// Scale the inner content down (never up) until it fits the fixed card.
function fitSummaryCard() {
  const card = document.getElementById("summary-card");
  const inner = card?.querySelector(".sc-inner");
  if (!inner) return;
  card.style.zoom = "";
  inner.style.transform = "";
  inner.style.width = "";
  const scale = Math.min(1, card.clientHeight / inner.scrollHeight);
  if (scale < 1) {
    inner.style.transform = `scale(${scale})`;
    inner.style.width = `${100 / scale}%`;
  }
  zoomSummaryCardForPhone();
}

// ---- Hide the picks column on a Summary card ----
// Every Summary card (TD, Game, Props) has a picks column on the right. A
// toolbar button (#summary-rail-btn) drops it; the card gets .sc-no-rail,
// the main content takes the full width, and fitWideSummaryCard zooms it to
// the biggest size that still fits so the saved image is easier to read.
// Per-device view preference, one per card kind (not synced).
const SUMMARY_RAIL_KEYS = {
  props: "nfl-tool.props-summary.railHidden",
  game: "nfl-tool.game-summary.railHidden",
  td: "nfl-tool.td-summary.railHidden",
};
function summaryRailHidden(kind) {
  try {
    return localStorage.getItem(SUMMARY_RAIL_KEYS[kind]) === "1";
  } catch (e) {
    return false;
  }
}
function setSummaryRailHidden(kind, hidden) {
  try {
    localStorage.setItem(SUMMARY_RAIL_KEYS[kind], hidden ? "1" : "0");
  } catch (e) {
    // localStorage unavailable -- the choice just won't stick across reloads.
  }
}
// Sync the toolbar button's label ("Hide My Picks" / "Show My Picks").
function syncSummaryRailButton(kind, label) {
  const btn = document.getElementById("summary-rail-btn");
  if (!btn) return;
  const hidden = summaryRailHidden(kind);
  btn.textContent = `${hidden ? "Show" : "Hide"} ${label}`;
  btn.classList.toggle("active", hidden);
}
// ~1.35 is the old main column blown up to the full width; more when the
// content is short. The loop backs off until the card fits, then the usual
// shrink-only fit and phone preview zoom run. html-to-image keeps the zoom.
const SUMMARY_WIDE_ZOOM_MAX = 1.6;
function fitWideSummaryCard() {
  const card = document.getElementById("summary-card");
  const inner = card?.querySelector(".sc-inner");
  // .sc-grow cards (Game Summary) also grow with the rail showing.
  const grow = inner && (inner.classList.contains("sc-no-rail") || inner.classList.contains("sc-grow"));
  // A card can name one part to grow (.sc-zoom-target) instead of the whole
  // main column -- the TD card grows Season TD Targets and lets the bottom row
  // keep its size.
  const main = grow ? inner.querySelector(".sc-zoom-target") || inner.querySelector(".sc-main") : null;
  // A hidden card measures 0 tall, which would read as "fits at max zoom".
  if (main && card.clientHeight > 0) {
    card.style.zoom = "";
    inner.style.transform = "";
    inner.style.width = "";
    // Too big also means something got squeezed sideways: a row label cut
    // off with "...", or a line / rating tile too narrow for its numbers.
    const squeezed = () => [...main.querySelectorAll(".gs-row-label, .gs-ml, .gs-rt, .td-card .sc-col, .td-card .sc-odds-block, .td-card .tdt-head, .td-card .tdt-v, .td-card .tgt-v, .td-card .ftd-row")].some((el) => el.scrollWidth > el.clientWidth + 1);
    let z = SUMMARY_WIDE_ZOOM_MAX;
    main.style.zoom = z;
    while (z > 1 && (inner.scrollHeight > card.clientHeight || squeezed())) {
      z = Math.max(1, Math.round((z - 0.05) * 100) / 100);
      main.style.zoom = z;
    }
  }
  fitSummaryCard();
}

// Phones only (same 760px breakpoint as the mobile block at the end of
// style.css): the Summary card is a fixed 1160px video-template image, so
// shrink the whole card to the screen width as a preview. Desktop never gets
// a zoom. saveSummaryImage lifts the zoom while capturing, so the saved PNG
// is identical on every device.
const PHONE_QUERY = window.matchMedia("(max-width: 760px)");
function zoomSummaryCardForPhone() {
  const card = document.getElementById("summary-card");
  if (!card) return;
  if (!PHONE_QUERY.matches) { card.style.zoom = ""; return; }
  // Width of whatever box the card sits in (it can be nested in padded
  // panels); if that box is hidden right now, fall back to the page width.
  const box = card.parentElement;
  const cs = box ? getComputedStyle(box) : null;
  let avail = box ? box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0;
  if (!(avail > 0)) avail = document.documentElement.clientWidth - 32;
  card.style.zoom = String(Math.min(1, Math.max(0.2, (avail - 2) / card.offsetWidth)));
  // Re-fit when that box changes size, e.g. its tab going from hidden to shown.
  if (box && window.ResizeObserver && !box._summaryZoomObserved) {
    box._summaryZoomObserved = true;
    new ResizeObserver(() => zoomSummaryCardForPhone()).observe(box);
  }
}
window.addEventListener("resize", zoomSummaryCardForPhone);
PHONE_QUERY.addEventListener("change", zoomSummaryCardForPhone);

// Phones only: any table wider than the box it sits in gets wrapped in its
// own sideways scroller (.m-scroll, style.css phone block), so only that
// table scrolls instead of its whole section. Pages re-render by replacing
// innerHTML, so watch <main> and re-check shortly after each change.
// Desktop never runs this.
function wrapWideTablesForPhone() {
  if (!PHONE_QUERY.matches) return;
  for (const table of document.querySelectorAll("main table")) {
    const parent = table.parentElement;
    if (!parent || parent.classList.contains("m-scroll") || table.closest(".summary-card")) continue;
    const cs = getComputedStyle(parent);
    const room = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (room > 0 && table.getBoundingClientRect().width > room + 1) {
      const wrap = document.createElement("div");
      wrap.className = "m-scroll";
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  }
}
let wrapWideTablesTimer = null;
function scheduleWrapWideTables() {
  if (!PHONE_QUERY.matches) return;
  clearTimeout(wrapWideTablesTimer);
  wrapWideTablesTimer = setTimeout(wrapWideTablesForPhone, 120);
}
function startWrapWideTables() {
  const main = document.querySelector("main");
  // attributes: tabs switch by toggling hidden/class, and a table only has a
  // width once its tab is showing.
  if (main) new MutationObserver(scheduleWrapWideTables).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
  scheduleWrapWideTables();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWrapWideTables);
else startWrapWideTables();
window.addEventListener("resize", scheduleWrapWideTables);
PHONE_QUERY.addEventListener("change", scheduleWrapWideTables);

// The exported PNG only uses fonts embedded into it -- html-to-image can't
// read Google Fonts' cross-origin stylesheet itself, so fetch it, keep the
// latin subsets, and inline each font file as a data URL.
let summaryFontCSSCache = null;
async function summaryFontCSS() {
  if (summaryFontCSSCache !== null) return summaryFontCSSCache;
  try {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css"]');
    const css = await fetch(link.href).then((r) => r.text());
    const latin = css.split("/* ").filter((block) => block.startsWith("latin */")).map((block) => block.slice("latin */".length));
    const inlined = await Promise.all(
      latin.map(async (face) => {
        const m = face.match(/url\((https:[^)]+)\)/);
        if (!m) return face;
        const blob = await fetch(m[1]).then((r) => r.blob());
        const dataUrl = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(blob);
        });
        return face.replace(m[1], dataUrl);
      })
    );
    summaryFontCSSCache = inlined.join("\n");
  } catch (e) {
    summaryFontCSSCache = "";
  }
  return summaryFontCSSCache;
}

async function saveSummaryImage() {
  const btn = document.getElementById("summary-save-btn");
  const card = document.getElementById("summary-card");
  btn.disabled = true;
  btn.textContent = "Saving...";
  const phoneZoom = card.style.zoom;
  card.style.zoom = "";
  try {
    if (!window.htmlToImage) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const bg = getComputedStyle(card).backgroundColor;
    const fontEmbedCSS = await summaryFontCSS();
    // includeQueryParams: every team logo is the same ESPN resizer URL with
    // a different ?img=... query -- without this, html-to-image caches
    // images by URL minus the query and stamps the first logo on every team.
    const url = await window.htmlToImage.toPng(card, { pixelRatio: 2, backgroundColor: bg, fontEmbedCSS, includeQueryParams: true });
    const a = document.createElement("a");
    const away = card.dataset.away || document.getElementById("away-select")?.value;
    const home = card.dataset.home || document.getElementById("home-select")?.value;
    a.href = url;
    a.download = `${away}-at-${home}-${card.dataset.kind || "td"}-summary.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  card.style.zoom = phoneZoom;
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#summary-save-btn")) saveSummaryImage();
});


// ---- Lineup-aware game weights (TD Data) ----
// Raw season totals over-reward a backup's one big game and punish a
// starter for a game he left early. Per team game, for one player:
//   - a game he left early (snaps under 60% of his usual) doesn't count;
//   - a game he missed while listed Out doesn't count against him;
//   - a game a regular at his position who's healthy THIS week missed or
//     left early counts LINEUP_DISCOUNT as much (that was a different role).
// "Regular" = played 60%+ of snaps in at least one game; only regulars are
// checked for leaving early (a backup's small normal role isn't "partial").
// Snap shares: build_stats.py player_snaps; injuries: DATA.injuries.
const LINEUP_PARTIAL_RATIO = 0.6;
const LINEUP_REGULAR_SNAP = 0.6; // a regular has played 60%+ of snaps in some game
const LINEUP_DISCOUNT = 0.15;
const LINEUP_GROUPS = { RB: ["RB"], WR: ["WR", "TE"], TE: ["WR", "TE"], QB: ["QB"] };

function lineupSnapIndex(team) {
  if (!lineupSnapIndex.cache) lineupSnapIndex.cache = {};
  if (!lineupSnapIndex.cache[team]) {
    const map = {};
    Object.entries((DATA.player_snaps || {})[team] || {}).forEach(([n, v]) => (map[normName(n)] = { ...v, name: n }));
    lineupSnapIndex.cache[team] = map;
  }
  return lineupSnapIndex.cache[team];
}
// On IR / released / retired per the latest roster (build_stats.py
// compute_roster_out). IR players never appear on injury reports, so this is
// the only way the site knows a season-ending injury.
function rosterOut(team, name) {
  if (!rosterOut.cache) {
    rosterOut.cache = {};
    Object.entries(DATA.roster_out || {}).forEach(([t, list]) =>
      list.forEach((p) => (rosterOut.cache[`${t}|${normName(p.name)}`] = p.status))
    );
  }
  return rosterOut.cache[`${team}|${normName(name)}`] || null;
}
function lineupOutOn(team, name, week) {
  if (rosterOut(team, name)) return true;
  const list = ((DATA.injuries || {})[team] || {})[String(week)] || [];
  const hit = list.find((i) => normName(i.full_name) === normName(name));
  return !!hit && /out|doubtful|reserve|injured|suspend/i.test(hit.report_status || "");
}
// The team's current starting QB: whoever threw the most in its most
// recent game, unless he's ruled out for `week` -- then the starter before
// that. A fill-in with more season attempts doesn't outrank the healthy
// starter (user 2026-10-05: Cooper Rush showed for ATL after Penix was back).
function currentStarterQb(team, week) {
  const byWeek = {};
  Object.entries((DATA.player_game_logs || {})[team] || {}).forEach(([name, games]) =>
    games.forEach((g) => {
      if ((g.pass_att || 0) >= 10) (byWeek[g.week] = byWeek[g.week] || []).push([name, g.pass_att]);
    })
  );
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
  for (const wk of weeks) {
    const [name] = byWeek[wk].sort((a, b) => b[1] - a[1])[0];
    if (!lineupOutOn(team, name, week)) return name;
  }
  return null;
}
function lineupMedian(xs) {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}
// Did this snap-count entry play a normal game in `wk`? (false = absent or left early)
function lineupPlayedNormal(entry, wk) {
  const s = entry.w[wk];
  if (s === undefined || s < 0.15) return false;
  const others = Object.entries(entry.w).filter(([w, v]) => Number(w) !== Number(wk) && v >= 0.15).map(([, v]) => v);
  if (!others.length) return true;
  const usual = lineupMedian(others);
  return !(usual >= 0.4 && s < LINEUP_PARTIAL_RATIO * usual);
}
function teamPlayedWeeks(team, beforeWeek) {
  return (DATA.schedule || [])
    .filter((g) => g.status === "final" && g.week < beforeWeek && (g.away === team || g.home === team))
    .map((g) => g.week);
}
// Who threw the most for `team` in week `wk` (null if nobody threw 10+).
function leadPasserOn(team, wk) {
  let best = null;
  Object.entries((DATA.player_game_logs || {})[team] || {}).forEach(([name, games]) =>
    games.forEach((g) => {
      if (g.week === wk && (g.pass_att || 0) >= 10 && (!best || g.pass_att > best[1])) best = [name, g.pass_att];
    })
  );
  return best ? best[0] : null;
}
// opts.qbStarter (First TD model only): a pass catcher's games thrown by
// someone other than the current starter count LINEUP_QB_CHANGE_WEIGHT --
// London's 4-5 targets from Rush/Strand shouldn't set his role with Penix
// back (user 2026-10-05).
const LINEUP_QB_CHANGE_WEIGHT = 0.5;
function lineupWeights(team, name, position, week, opts = {}) {
  const idx = lineupSnapIndex(team);
  const mine = idx[normName(name)];
  const weeks = teamPlayedWeeks(team, week);
  const group = LINEUP_GROUPS[position] || [];
  const isRegular = (t) => Math.max(0, ...Object.values(t.w)) >= LINEUP_REGULAR_SNAP;
  const regulars = Object.entries(idx).filter(
    ([key, t]) => key !== normName(name) && group.includes(t.pos) && isRegular(t) && !lineupOutOn(team, t.name, week)
  );
  const out = {};
  weeks.forEach((wk) => {
    let w = 1;
    if (mine) {
      const s = mine.w[wk];
      if (s === undefined && lineupOutOn(team, name, wk)) w = 0;
      else if (s !== undefined && isRegular(mine) && !lineupPlayedNormal(mine, wk)) w = 0;
    }
    if (w && regulars.some(([, t]) => !lineupPlayedNormal(t, wk))) w *= LINEUP_DISCOUNT;
    if (w && opts.qbStarter && (position === "WR" || position === "TE")) {
      const lead = leadPasserOn(team, wk);
      if (lead && normName(lead) !== normName(opts.qbStarter)) w *= LINEUP_QB_CHANGE_WEIGHT;
    }
    out[wk] = w;
  });
  if (!Object.values(out).some((w) => w > 0)) weeks.forEach((wk) => (out[wk] = 1));
  return out;
}

// player_xtd rows re-derived from their per-game numbers with the weights
// above: per-game rates (xtd_pg, early_xtd_pg) are weighted averages, and
// counts are that weighted per-game average times the team's games, so
// they stay on the season scale every threshold on the page expects.
// Adds `touches` (targets + carries) on the same basis.
const LINEUP_FIELDS = ["xtd", "early_xtd", "targets", "carries", "rz_targets", "rz_carries", "ez_targets", "deep_targets", "tds", "first_tds"];
function lineupAdjustedXtd(team, week, opts = {}) {
  const rows = (DATA.player_xtd || {})[team] || [];
  return rows.map((p) => {
    if (!p.by_week) return { ...p, touches: (p.targets || 0) + (p.carries || 0) };
    const weights = lineupWeights(team, p.name, p.position, week, opts);
    const weeks = Object.keys(weights);
    const wSum = weeks.reduce((s, wk) => s + weights[wk], 0) || 1;
    const avg = LINEUP_FIELDS.map((_, i) => weeks.reduce((s, wk) => s + weights[wk] * ((p.by_week[wk] || [])[i] || 0), 0) / wSum);
    const n = weeks.length || 1;
    const adj = { ...p, xtd_pg: avg[0], early_xtd_pg: avg[1], lineup_weights: weights };
    LINEUP_FIELDS.slice(2).forEach((f, i) => (adj[f] = avg[i + 2] * n));
    adj.touches = adj.targets + adj.carries;
    return adj;
  });
}
