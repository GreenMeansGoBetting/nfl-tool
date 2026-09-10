// "Normal" broadcast-style box score stats, one simple team-vs-team table
// (not an offense-vs-opponent's-defense mismatch table like the TD pages --
// this page is a quick overview, not a matchup-exploit finder). Red zone
// and explosive plays are included but kept to one row each, not their own
// section, per feedback that they shouldn't be massive categories here.
// Same set picked via the Game Overview Stat Picker checklist, but paired
// one offense stat per row with its defense mirror -- half the rows, and
// each row reads as a matchup ("this team's pass volume vs that team's
// pass defense") instead of two separate lines. Penalty Yards had no
// defense-side mirror selected/computed, so it's left out of this table.
// Grouped into two sections (was one flat list that read as a blended wall
// of numbers): the core volume/efficiency picture, then the two "flips
// games" stats that don't fit that story.
const GENERAL_STAT_GROUPS = [
  {
    label: "Production",
    rows: [
      { label: "Points", offKey: "points_for_per_g", offInvert: false, defKey: "points_against_per_g", defInvert: true },
      { label: "EPA / Play", offKey: "epa_per_play", offInvert: false, defKey: "epa_per_play_allowed", defInvert: true },
      { label: "Pass Attempts", offKey: "pass_att_per_g", offInvert: false, defKey: "pass_att_allowed_per_g", defInvert: true },
      { label: "Pass Yards", offKey: "pass_yards_per_g", offInvert: false, defKey: "pass_yards_allowed_per_g", defInvert: true },
      { label: "Rush Attempts", offKey: "rush_att_per_g", offInvert: false, defKey: "rush_att_allowed_per_g", defInvert: true },
      { label: "Rush Yards", offKey: "rush_yards_per_g", offInvert: false, defKey: "rush_yards_allowed_per_g", defInvert: true },
      { label: "Yards / Carry", offKey: "yards_per_carry", offInvert: false, defKey: "yards_per_carry_allowed", defInvert: true },
      { label: "3rd Down %", offKey: "third_down_rate", offInvert: false, defKey: "third_down_rate_allowed", defInvert: true, pct: true },
      { label: "Red Zone TD %", offKey: "rz_td_rate", offInvert: false, defKey: "rz_td_rate_allowed", defInvert: true, pct: true },
      { label: "Explosive Plays", offKey: "explosive_rate", offInvert: false, defKey: "explosive_rate_allowed", defInvert: true, pct: true },
    ],
  },
  {
    label: "Turnovers & Pressure",
    rows: [
      { label: "Sacks", offKey: "sacks_allowed_per_g", offInvert: true, defKey: "sacks_made_per_g", defInvert: false },
      { label: "Turnovers", offKey: "turnovers_per_g", offInvert: true, defKey: "takeaways_per_g", defInvert: false },
      // No off/def mirror here the way Sacks/Turnovers have one (a penalty
      // isn't "drawn" by the other team the way a sack or takeaway is) --
      // both columns show each team's own penalty rate instead, fewer is
      // better for whichever team.
      { label: "Penalties", offKey: "penalties_per_g", offInvert: true, defKey: "penalties_per_g", defInvert: true },
    ],
  },
];

// Schematic tendency (how a defense lines up, from nflverse's free
// participation charting) paired with how the facing offense performs
// against that specific look. Grouped so the table reads as sections, not
// one long list. perfLabel is the caption shown above the performance
// column for that whole group (Yards/Carry for run splits, Success Rate
// for every pass-rush/coverage split -- see build_stats.py's
// compute_scheme_splits for exactly what "success" means).
// defTendKey/defSuccessKey pair with each row's tendency bar: not just how
// often the defense uses a look (frequency, no color judgment) but how well
// it actually works for them when they do (a real value judgment, tiered
// invert=true since it's stored as the OPPOSING offense's success/yards --
// lower is a better defensive result). Run Defense's def-side number is
// yards allowed (fmtYc), every other group's is a success rate (pct).
const SCHEME_GROUPS = [
  {
    label: "Run Defense",
    perfLabel: "Y/C",
    inlineUnit: "Y/C",
    rows: [
      { label: "Heavy Box (7+)", tendKey: "box_heavy_rate", perfKey: "ypc_vs_heavy_box", defSuccessKey: "def_ypc_allowed_heavy_box" },
      { label: "Light Box (≤6)", tendKey: "box_light_rate", perfKey: "ypc_vs_light_box", defSuccessKey: "def_ypc_allowed_light_box" },
    ],
  },
  {
    // Blitz/Standard is the CALL (how many rushers sent); Pressured/Clean
    // Pocket is the RESULT (whether the rush actually got home) -- a team
    // can blitz constantly and still rarely get pressure, or rush four and
    // still win often. Kept as four rows under one header rather than two
    // separate groups: same "how does this pass rush operate" theme, no
    // reason to split them into two header rows on the page.
    label: "Pass Rush",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Blitz (5+ rushers)", tendKey: "blitz_rate", perfKey: "success_vs_blitz", defSuccessKey: "def_success_allowed_blitz" },
      { label: "Standard Rush", tendKey: "standard_rush_rate", perfKey: "success_vs_standard_rush", defSuccessKey: "def_success_allowed_standard_rush" },
      { label: "Pressured", tendKey: "pressure_rate", perfKey: "success_vs_pressure", defSuccessKey: "def_success_allowed_pressure" },
      { label: "Clean Pocket", tendKey: "clean_pocket_rate", perfKey: "success_vs_clean_pocket", defSuccessKey: "def_success_allowed_clean_pocket" },
    ],
  },
  {
    label: "Coverage Style",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Zone", tendKey: "zone_rate", perfKey: "success_vs_zone", defSuccessKey: "def_success_allowed_zone" },
      { label: "Man", tendKey: "man_rate", perfKey: "success_vs_man", defSuccessKey: "def_success_allowed_man" },
    ],
  },
  {
    label: "Coverage Scheme",
    perfLabel: "Success %",
    pct: true,
    // Specific shells run thin (some clear under 5% of a defense's own
    // snaps) -- sorting by this defense's own usage (most-used shell on
    // top) instead of a fixed Cover-0-to-6 list draws the eye to what the
    // defense actually plays first. Rows under SCHEME_MIN_TENDENCY_SHOWN
    // stay visible (still real, still occasionally called) but dimmed --
    // greyed out rather than hidden, since hiding them would make the
    // shell breakdown look incomplete.
    sortByTendency: true,
    rows: [
      { label: "Cover 0", tendKey: "cover0_rate", perfKey: "success_vs_cover0", defSuccessKey: "def_success_allowed_cover0" },
      { label: "Cover 1", tendKey: "cover1_rate", perfKey: "success_vs_cover1", defSuccessKey: "def_success_allowed_cover1" },
      { label: "Cover 2", tendKey: "cover2_rate", perfKey: "success_vs_cover2", defSuccessKey: "def_success_allowed_cover2" },
      { label: "Cover 3", tendKey: "cover3_rate", perfKey: "success_vs_cover3", defSuccessKey: "def_success_allowed_cover3" },
      { label: "Cover 4", tendKey: "cover4_rate", perfKey: "success_vs_cover4", defSuccessKey: "def_success_allowed_cover4" },
      { label: "Cover 6", tendKey: "cover6_rate", perfKey: "success_vs_cover6", defSuccessKey: "def_success_allowed_cover6" },
      { label: "2-Man", tendKey: "twoman_rate", perfKey: "success_vs_twoman", defSuccessKey: "def_success_allowed_twoman" },
    ],
  },
];

// Below this usage rate a coverage shell is still real (worth showing) but
// rare enough for this specific defense that it shouldn't draw the eye the
// same as their bread-and-butter looks -- dimmed, not hidden. Separate from
// SCHEME_ADV_MIN_TENDENCY (0.2) below, which gates the ADV callout itself,
// a stricter bar than mere visibility.
const SCHEME_MIN_TENDENCY_SHOWN = 0.05;

// ---- Team Grades: a scored summary instead of a written one ----
// A prose recap anchors the reader on whatever gets mentioned first and
// invites skipping the rest of the data -- a graded grid compresses the
// same tables into scannable numbers without telling anyone what to
// conclude from them. Each category below averages a handful of z-scores
// (weighted by sample size where the underlying stat has one) into a
// single z, then maps that to a letter using the exact same z-score scale
// driving every tier color already on the page -- the grade and the color
// are the same computation, not a separate judgment layered on top.
// Turnovers were deliberately left out -- one tipped pass or bad-bounce
// fumble swings a team's turnover count more on luck than skill over a
// single season, which doesn't belong next to categories built on
// repeatable tendencies. Third Down was folded into Passing/Rushing
// EPA rather than kept separate -- EPA per play already captures
// down-and-distance efficiency without a dedicated row.
const SUMMARY_CATEGORIES = [
  {
    label: "Passing",
    off: [
      { key: "epa_per_play_pass", invert: false, weight: 2 },
      { key: "yards_per_att", invert: false },
      { key: "explosive_pass_rate", invert: false },
    ],
    def: [
      { key: "epa_per_play_pass_allowed", invert: true, weight: 2 },
      { key: "yards_per_att_allowed", invert: true },
      { key: "explosive_pass_rate_allowed", invert: true },
    ],
  },
  {
    label: "Rushing",
    off: [
      { key: "epa_per_play_rush", invert: false, weight: 2 },
      { key: "yards_per_carry", invert: false },
      { key: "explosive_rush_rate", invert: false },
    ],
    def: [
      { key: "epa_per_play_rush_allowed", invert: true, weight: 2 },
      { key: "yards_per_carry_allowed", invert: true },
      { key: "explosive_rush_rate_allowed", invert: true },
    ],
  },
  {
    label: "Red Zone",
    off: [{ key: "rz_td_rate", invert: false }],
    def: [{ key: "rz_td_rate_allowed", invert: true }],
  },
  {
    // Built from every row in SCHEME_GROUPS rather than a fixed list, so it
    // always reflects whatever the Scheme & Tendencies table above is
    // actually showing -- see schemeCompositeZ().
    label: "Scheme",
    scheme: true,
  },
];

// Weighted-average z-score across a list of {key, invert, weight} metrics
// for one team. A metric this team has no value for (thin sample, stat
// never cleared MIN_SAMPLE) is simply skipped rather than counted as
// average/zero -- a category shouldn't get dragged toward "C" just because
// one input hasn't hit its sample floor yet.
function compositeZ(metrics, team) {
  const pool = teamsWithGames();
  let sum = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const value = DATA.team_stats[team][m.key];
    if (value === null || value === undefined) continue;
    const values = pool.map((t) => DATA.team_stats[t][m.key]);
    const z = zScore(value, values, m.invert);
    if (z === null) continue;
    const w = m.weight || 1;
    sum += z * w;
    weightSum += w;
  }
  return weightSum ? sum / weightSum : null;
}

// Every row across every SCHEME_GROUPS group, flattened -- the Scheme grade
// stays in sync with the table above it automatically, no separate list to
// maintain by hand.
const ALL_SCHEME_ROWS = SCHEME_GROUPS.flatMap((g) => g.rows);

// side: "off" grades this team's own performance against whatever look it
// faced (perfKey); "def" grades this team's own defense's success allowed
// when it made that call (defSuccessKey). Weighted by each row's own play
// count -- the same count already used to dim rare shells in the table
// above, so a 6-play Cover-0 split can't swing the grade any more than it
// swings the visual weight given to that row up there.
function schemeCompositeZ(team, side) {
  const pool = teamsWithGames();
  let sum = 0;
  let weightSum = 0;
  for (const r of ALL_SCHEME_ROWS) {
    const key = side === "off" ? r.perfKey : r.defSuccessKey;
    const weight = DATA.team_stats[team][`${key}_plays`];
    const value = DATA.team_stats[team][key];
    if (!weight || value === null || value === undefined) continue;
    const values = pool.map((t) => DATA.team_stats[t][key]);
    const z = zScore(value, values, side === "def");
    if (z === null) continue;
    sum += z * weight;
    weightSum += weight;
  }
  return weightSum ? sum / weightSum : null;
}

// Finer-grained than the site's usual 3-tier good/mid/bad -- once a
// composite is the only number standing in for a whole category, it earns
// more graduation than a single raw stat gets.
const GRADE_BANDS = [
  { min: 1.2, grade: "A" },
  { min: 0.4, grade: "B" },
  { min: -0.4, grade: "C" },
  { min: -1.2, grade: "D" },
  { min: -Infinity, grade: "F" },
];
function gradeForZ(z) {
  if (z === null || z === undefined) return null;
  return GRADE_BANDS.find((b) => z >= b.min).grade;
}

// Color driven directly off the LETTER, not a separately-thresholded
// z-score -- coloring by z independently of GRADE_BANDS let TIER_Z_THRESHOLD
// (0.6) cut through the middle of the B and D bands, so a B right at the
// edge rendered the same flat yellow as a C, and so did a D. Keying off the
// grade itself makes that impossible: same three hues as everywhere else on
// the site, but five fixed steps instead of a continuous one -- A/F get the
// strongest tint, B/D a light tint of the same hue, C stays flat neutral.
const GRADE_STYLE = {
  A: { cls: "tier-good", alpha: TIER_ALPHA_MAX },
  B: { cls: "tier-good", alpha: TIER_ALPHA_MIN },
  C: { cls: "tier-mid", alpha: null },
  D: { cls: "tier-bad", alpha: TIER_ALPHA_MIN },
  F: { cls: "tier-bad", alpha: TIER_ALPHA_MAX },
};
function gradeClass(grade) {
  return grade && GRADE_STYLE[grade] ? GRADE_STYLE[grade].cls : "";
}
function gradeAlphaAttr(grade) {
  const style = grade && GRADE_STYLE[grade];
  if (!style || style.alpha === null) return "";
  return ` style="--tier-a:${style.alpha.toFixed(2)}"`;
}

// Same header shape as pairedStatHeader/schemeTableHeader (team-accent
// background per column, no "PER GAME" corner label since there's no rate
// here) -- kept as its own function since this table has 3 data columns
// (OFF/DEF/ADV), not pairedStatHeader's 3 plus its per-game label.
function summaryTableHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${offTeam}</span> <span class="pair-hdr-sub">- OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${defTeam}</span> <span class="pair-hdr-sub">- DEF</span></th><th class="edge-hdr">ADV</th></tr>`;
}

// How big is the gap between this offense's grade and the opposing
// defense's grade -- not just which side crossed a fixed line. An A-vs-F
// mismatch should read as a dark, saturated color; an A-vs-B gap should
// barely tint at all. Reuses the site's TIER_ALPHA_MIN/MAX scale, but
// against a wider saturation point (ADV_Z_SATURATE) than a single stat's
// alpha gets, since this is a gap BETWEEN two already-computed z-scores
// (roughly double the spread of one team's distance from the league mean).
const ADV_Z_SATURATE = 3;
function summaryAdvCell(offZ, defZ, offTeam, defTeam) {
  if (offZ === null || offZ === undefined || defZ === null || defZ === undefined) {
    return `<td class="edge-cell">--</td>`;
  }
  const gap = offZ - defZ;
  const gapAbs = Math.abs(gap);
  if (gapAbs < TIER_Z_THRESHOLD) return `<td class="edge-cell">--</td>`;
  const t = Math.min((gapAbs - TIER_Z_THRESHOLD) / (ADV_Z_SATURATE - TIER_Z_THRESHOLD), 1);
  const alpha = TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * t;
  const team = gap > 0 ? offTeam : defTeam;
  const rgb = teamAccentRgb(team);
  return `<td class="edge-cell edge-hit" style="color:rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},${alpha.toFixed(2)})">${team}</td>`;
}

// Paired by MATCHUP (offTeam's offense against defTeam's defense), same
// convention as General Stats/Scheme -- call twice (away-vs-home,
// home-vs-away) for the two side-by-side tables.
function renderSummaryTable(offTeam, defTeam) {
  const rows = SUMMARY_CATEGORIES.map((cat) => {
    const offZ = cat.scheme ? schemeCompositeZ(offTeam, "off") : compositeZ(cat.off, offTeam);
    const defZ = cat.scheme ? schemeCompositeZ(defTeam, "def") : compositeZ(cat.def, defTeam);
    const offGrade = gradeForZ(offZ);
    const defGrade = gradeForZ(defZ);
    const advCell = summaryAdvCell(offZ, defZ, offTeam, defTeam);
    return `<tr><td>${cat.label}</td><td class="num grade-cell ${gradeClass(offGrade)}"${gradeAlphaAttr(offGrade)}>${offGrade || "--"}</td><td class="num grade-cell ${gradeClass(defGrade)}"${gradeAlphaAttr(defGrade)}>${defGrade || "--"}</td>${advCell}</tr>`;
  }).join("");
  return `<table class="data-table summary-grade-table">
    <thead>${summaryTableHeader(offTeam, defTeam)}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}


const MARKETS = [
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "moneyline", label: "Moneyline" },
];
const COLORS = [
  { key: "green", label: "Good Play" },
  { key: "yellow", label: "Lean" },
  { key: "red", label: "No Confidence" },
];

const SECTIONS = ["injuries", "odds", "general", "scheme", "recent", "summary", "notes", "picks"];

// ---- Per-game notes (localStorage, keyed by game_id -- free text, not
// graded or shared anywhere, just a scratchpad while working through a
// game) ----
const GAME_NOTES_KEY = "nfl-tool.game-notes.v1";
function loadGameNotes() {
  try {
    return JSON.parse(localStorage.getItem(GAME_NOTES_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveGameNote(gameId, text) {
  try {
    const all = loadGameNotes();
    if (text) all[gameId] = text;
    else delete all[gameId];
    localStorage.setItem(GAME_NOTES_KEY, JSON.stringify(all));
  } catch (e) {
    // localStorage unavailable -- notes just won't stick.
  }
}

let weekGames = [];
let currentGameIndex = 0;
let draftPicks = {};

function resetDraftPicks() {
  draftPicks = { spread: {}, total: {}, moneyline: {} };
}

function gamesForWeek(week) {
  if (week == null) return [];
  return (DATA.schedule || []).filter((g) => g.week === week);
}

function currentGame() {
  return weekGames[currentGameIndex] || null;
}

// ---- formatting helpers ----
function fmtSigned(n) {
  if (n === null || n === undefined) return "";
  return n > 0 ? `+${fmt(n, 1)}` : fmt(n, 1);
}
function fmtOdds(n) {
  if (n === null || n === undefined) return "";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}
function fmtPct(p) {
  return p === null || p === undefined ? "" : `${Math.round(p * 100)}%`;
}
// nflverse's schedule "gametime" is already Eastern -- just reformat to
// 12-hour, no timezone math needed.
function fmtGameTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period} ET`;
}

function renderGameHeader(game) {
  const headerEl = document.getElementById("game-header");
  headerEl.hidden = false;
  const dateLabel = game.date
    ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  const timeLabel = fmtGameTime(game.time);
  headerEl.innerHTML = `
    <div class="game-header-teams">
      <img src="${teamLogoUrl(game.away)}" class="team-logo-lg" alt="${game.away}" loading="lazy">
      <span class="game-header-team">${TEAM_NAMES[game.away] || game.away}</span>
      <span class="at">@</span>
      <span class="game-header-team">${TEAM_NAMES[game.home] || game.home}</span>
      <img src="${teamLogoUrl(game.home)}" class="team-logo-lg" alt="${game.home}" loading="lazy">
    </div>
    <div class="game-header-meta">${dateLabel}${timeLabel ? " &middot; " + timeLabel : ""}</div>
  `;
}

// One combined box: team logos as row headers, Spread/Total/Moneyline as
// columns -- a single glance instead of three separate boxes.
function renderOddsBar(game) {
  const hasSpread = game.away_team_spread !== null && game.away_spread_odds !== null;
  const hasTotal = game.total_line !== null;
  const hasMl = game.away_moneyline !== null && game.home_moneyline !== null;

  if (!hasSpread && !hasTotal && !hasMl) {
    return `<p class="no-data-note">Odds not posted yet for this game.</p>`;
  }

  const spreadCell = (team, line, odds) => (hasSpread ? `${fmtSigned(line)} <span class="odds-price">(${fmtOdds(odds)})</span>` : "--");
  const totalCell = (label, odds) => (hasTotal ? `${label} ${fmt(game.total_line, 1)} <span class="odds-price">(${fmtOdds(odds)})</span>` : "--");
  const mlCell = (odds, prob) => (hasMl ? `${fmtOdds(odds)} <span class="odds-price">${fmtPct(prob)}</span>` : "--");

  return `<table class="data-table odds-table">
    <thead><tr><th></th><th>Spread</th><th>Total</th><th>Moneyline</th></tr></thead>
    <tbody>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.away)}" class="team-logo" alt="${game.away}" loading="lazy">${game.away}</td>
        <td class="num">${spreadCell(game.away, game.away_team_spread, game.away_spread_odds)}</td>
        <td class="num">${totalCell("O", game.over_odds)}</td>
        <td class="num">${mlCell(game.away_moneyline, game.away_ml_implied_prob)}</td>
      </tr>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.home)}" class="team-logo" alt="${game.home}" loading="lazy">${game.home}</td>
        <td class="num">${spreadCell(game.home, game.home_team_spread, game.home_spread_odds)}</td>
        <td class="num">${totalCell("U", game.under_odds)}</td>
        <td class="num">${mlCell(game.home_moneyline, game.home_ml_implied_prob)}</td>
      </tr>
    </tbody>
  </table>
  ${(DATA.general_odds || {})[`${game.away}_${game.home}`] ? `<button type="button" class="all-odds-btn" data-away="${game.away}" data-home="${game.home}">All Odds</button>` : ""}`;
}

// ---- General (non-player) odds modal ----
// Everything build_stats.py's extract_general_odds pulled out of the SAME
// SportsGameOdds event fetch already paid for by the player-prop pull --
// full-game and 1st-half spread/total/moneyline/team-totals plus a couple
// of game-level derivatives. No extra API cost: SGO bills per event, not
// per market, so this is just reading more of a response already fetched.
// Page-specific (unlike the player-odds modal in common.js, which TD
// Data/First TD Data also use) -- only this page has a per-game odds bar.
function ensureGeneralOddsModal() {
  if (document.getElementById("general-odds-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "general-odds-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="general-odds-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeGeneralOddsModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeGeneralOddsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeGeneralOddsModal();
  });
}

function closeGeneralOddsModal() {
  const el = document.getElementById("general-odds-modal");
  if (el) el.hidden = true;
}

// Spreads get a "+" on a positive line (favorite/dog convention); totals
// and team-totals don't need a sign.
function fmtOddsLine(line, betType) {
  if (line === null || line === undefined) return "";
  if (betType === "sp") return line > 0 ? ` +${line}` : ` ${line}`;
  return ` ${line}`;
}

// Consistent row labels regardless of SGO's own market_name phrasing
// (which varies: "Spread" for the combined market, team names baked into
// team-total market names, etc.) -- market_name is kept as a fallback for
// anything not in this list rather than a hard requirement to keep in sync.
function generalOddsRowLabel(m) {
  if (m.stat_id === "points" && m.bet_type === "ou") return m.team ? `${m.team} Team Total` : "Total";
  if (m.stat_id === "points" && m.bet_type === "sp") return "Spread";
  if (m.stat_id === "points" && m.bet_type === "ml") return "Moneyline";
  if (m.stat_id === "points" && m.bet_type === "eo") return "Odd / Even";
  if (m.stat_id === "firstToScore") return "First to Score";
  if (m.stat_id === "bothTeamsScored") return "Both Teams to Score";
  if (m.stat_id === "touchdowns") return m.bet_type === "ou" ? "Total Touchdowns" : "Any Touchdown Scored";
  if (m.stat_id === "fieldGoals_made") return m.team ? `${m.team} Field Goals Made` : "Field Goals Made";
  return m.market_name;
}

const GENERAL_ODDS_SIDE_ORDER = { away: 0, over: 0, home: 1, under: 1 };
const GENERAL_ODDS_PERIOD_LABELS = { game: "Full Game", "1h": "1st Half" };

function renderGeneralOddsModalContent(away, home) {
  const heading = `<h3>${TEAM_NAMES[away] || away} @ ${TEAM_NAMES[home] || home} &mdash; All Odds</h3>`;
  const markets = (DATA.general_odds || {})[`${away}_${home}`];
  if (!markets || !markets.length) {
    return `${heading}<p class="no-data-note">No additional odds posted for this game yet.</p>`;
  }

  // Group into one row per (period, market[, team]) -- e.g. the Spread's
  // away and home prices become two cells on the same row rather than two
  // separate rows. "ou" markets keep team in the key since it distinguishes
  // three DIFFERENT sub-markets (combined total, each team's own total)
  // that happen to share a bet type -- everything else (spread, moneyline,
  // first-to-score) has home/away as the two SIDES of one single market,
  // so team must NOT split those into separate rows.
  const groups = {};
  for (const m of markets) {
    const gk = m.bet_type === "ou" ? `${m.period}|${m.stat_id}|${m.bet_type}|${m.team || "all"}` : `${m.period}|${m.stat_id}|${m.bet_type}`;
    (groups[gk] = groups[gk] || []).push(m);
  }
  const rowsByPeriod = {};
  for (const gk in groups) {
    const entries = groups[gk];
    entries.sort((a, b) => (GENERAL_ODDS_SIDE_ORDER[a.side] ?? 9) - (GENERAL_ODDS_SIDE_ORDER[b.side] ?? 9));
    const period = entries[0].period;
    (rowsByPeriod[period] = rowsByPeriod[period] || []).push(entries);
  }

  const sections = Object.keys(GENERAL_ODDS_PERIOD_LABELS)
    .filter((p) => rowsByPeriod[p] && rowsByPeriod[p].length)
    .map((p) => {
      const rows = rowsByPeriod[p]
        .map((entries) => {
          const label = generalOddsRowLabel(entries[0]);
          const cells = entries
            .map((e) => {
              const side = e.team || e.side.charAt(0).toUpperCase() + e.side.slice(1);
              return `<span class="odds-price">${side}${fmtOddsLine(e.line, e.bet_type)} (${fmtOddsSigned(e.best_odds)})</span> <span class="muted-label">${e.best_book}</span>`;
            })
            .join("&nbsp;&nbsp;");
          return `<tr><td>${label}</td><td>${cells}</td></tr>`;
        })
        .join("");
      return `<h4 class="odds-period-heading">${GENERAL_ODDS_PERIOD_LABELS[p]}</h4>
        <table class="data-table general-odds-table"><tbody>${rows}</tbody></table>`;
    })
    .join("");

  return `${heading}
    <p class="no-data-note">Every non-player market SportsGameOdds returns for this game -- the same event pull as the player-prop odds, no extra API cost. Best price found across a handful of books. A ballpark, not every book, not live.</p>
    ${sections}`;
}

function openGeneralOddsModal(away, home) {
  ensureGeneralOddsModal();
  document.getElementById("general-odds-modal-content").innerHTML = renderGeneralOddsModalContent(away, home);
  document.getElementById("general-odds-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".all-odds-btn");
  if (btn) openGeneralOddsModal(btn.dataset.away, btn.dataset.home);
});

// One number per side (not the Total/Per-Game pair headerRow() expects),
// so this gets its own compact header instead of reusing that function.
function pairedStatHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th class="per-game-hdr">PER GAME</th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${offTeam}</span> <span class="pair-hdr-sub">- OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${defTeam}</span> <span class="pair-hdr-sub">- DEF</span></th><th class="edge-hdr">ADV</th></tr>`;
}

// Each row pairs an offense stat with its defense mirror, framed as a
// matchup: offTeam's own number vs defTeam's own "allowed" number on the
// same stat -- e.g. "Sacks" shows offTeam's own sacks-allowed rate next to
// defTeam's own sacks-made rate. Call twice (away-vs-home, home-vs-away)
// for the two side-by-side tables.
function renderGeneralStatsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const format = (v, pct) => (v === null || v === undefined ? "--" : pct ? `${Math.round(v * 100)}%` : fmt(v, 2));
  const groups = GENERAL_STAT_GROUPS.map((group) => {
    const rows = group.rows
      .map((r) => {
        const offCls = tierFor(r.offKey, offTeam, r.offInvert);
        const defCls = tierFor(r.defKey, defTeam, r.defInvert);
        const offExtreme = tierFor(r.offKey, offTeam, r.offInvert, TIER_Z_EXTREME_THRESHOLD);
        const defExtreme = tierFor(r.defKey, defTeam, r.defInvert, TIER_Z_EXTREME_THRESHOLD);
        const offA = tierForAlphaAttr(r.offKey, offTeam, r.offInvert);
        const defA = tierForAlphaAttr(r.defKey, defTeam, r.defInvert);
        const labelHtml = r.note ? `${r.label}<br><span class="muted-label">${r.note}</span>` : r.label;
        return `<tr><td>${labelHtml}</td><td class="num ${offCls}"${offA}>${format(off[r.offKey], r.pct)}</td><td class="num ${defCls}"${defA}>${format(def[r.defKey], r.pct)}</td>${edgeCell(offCls, defCls, offTeam, defTeam, offExtreme, defExtreme)}</tr>`;
      })
      .join("");
    return `<tr><td class="section-group-label" colspan="4">${group.label}</td></tr>${rows}`;
  }).join("");

  return `<table class="data-table general-stat-table">
    <thead>${pairedStatHeader(offTeam, defTeam)}</thead>
    <tbody>${groups}</tbody>
  </table>`;
}

// One schedule-strength bullet per team (not per row -- every condition is
// just a slice of the same ~17-game schedule, so a per-row version came
// back saying almost the same thing on every line), surfaced once at the
// TOP of the section so it's read before the tables, not buried inside one
// of them. Silent when the schedule was genuinely average. schedule_quality
// is a computed AVERAGE across ~17 opponents, so it won't exactly match any
// single team's own value -- percentileTier()'s indexOf-based lookup would
// silently fail here, so this ranks by comparison instead.
function scheduleQualityText(team) {
  const q = DATA.team_stats[team].schedule_quality;
  if (q === null || q === undefined) return null;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t].points_against_per_g)
    .filter((v) => v !== null && v !== undefined);
  if (pool.length < 3) return null;
  const pct = pool.filter((v) => v < q).length / pool.length;
  if (pct < 0.333) return `${team} has faced a tougher-than-average slate of defenses this season -- these performance splits may understate them.`;
  if (pct >= 0.667) return `${team} has faced a weaker-than-average slate of defenses this season -- these performance splits may overstate them.`;
  return null;
}

function renderSchemeNotes(away, home) {
  return [away, home]
    .map(scheduleQualityText)
    .filter(Boolean)
    .map((t) => `<li>${t}</li>`)
    .join("");
}

function schemeTableHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  return `<tr><th></th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${offTeam}</span> <span class="pair-hdr-sub">- OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${defTeam}</span> <span class="pair-hdr-sub">- DEF</span></th><th class="freq-hdr"></th><th class="edge-hdr">ADV</th></tr>`;
}

// Below this, a look doesn't come up often enough for an edge here to be
// worth flagging, no matter how it ranks against other equally-rare looks
// (a specialty package used on 7% of snaps can still z-score as "tier-good"
// relative to a league where everyone runs it under 5% -- that's true but
// meaningless for gameplanning, since it barely happens either way).
const SCHEME_ADV_MIN_TENDENCY = 0.2;

// Tendency is a frequency signal, not a value judgment (see SCHEME_GROUPS
// comment) -- so this can't reuse edgeCell's good/bad-tier logic straight
// across. An edge only gets flagged when the look is actually common
// (SCHEME_ADV_MIN_TENDENCY) AND the offense's performance tier AND the
// defense's tendency tier point the SAME direction: offense performs well
// against a look the defense uses often (real, likely-to-matter advantage)
// or performs poorly against a look the defense leans on heavily (real
// risk). A good performance number against a look the defense rarely shows
// (e.g. "HOU beats the blitz, but BUF barely blitzes") deliberately falls
// through to "--" -- it's true but unlikely to come up.
function schemeEdgeCell(perfCls, tendCls, tendVal, offTeam, defTeam) {
  if (tendVal === null || tendVal === undefined || tendVal < SCHEME_ADV_MIN_TENDENCY) {
    return `<td class="edge-cell">--</td>`;
  }
  if (perfCls === "tier-good" && tendCls === "tier-good") {
    const rgb = teamAccentRgb(offTeam);
    return `<td class="edge-cell edge-hit" style="color:rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.14)">${offTeam}</td>`;
  }
  if (perfCls === "tier-bad" && tendCls === "tier-good") {
    const rgb = teamAccentRgb(defTeam);
    return `<td class="edge-cell edge-hit" style="color:rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.14)">${defTeam}</td>`;
  }
  return `<td class="edge-cell">--</td>`;
}

// Frequency bar + % on its own now (defense success moved out into its own
// column, right beside offense performance, so the two directly-comparable
// numbers sit next to each other same as General Stats' OFF/DEF columns).
// % first, then the bar fills whatever width is left.
function tendencyCell(r, defTeam) {
  const tendVal = DATA.team_stats[defTeam][r.tendKey];
  if (tendVal === null || tendVal === undefined) return { html: `<span class="no-data-note">--</span>`, tendVal: null, tendCls: "" };
  const tendCls = tierFor(r.tendKey, defTeam, false);
  const html = `<div class="tend-row">
    <span class="tend-bar-num">${Math.round(tendVal * 100)}%</span>
    <span class="tend-bar-track"><span class="tend-bar-fill ${tendCls}" style="width:${Math.round(tendVal * 100)}%"></span></span>
  </div>`;
  return { html, tendVal, tendCls };
}

// Defense success is a real value judgment (unlike the tendency bar, a pure
// frequency signal) -- always stored as the OPPOSING offense's raw
// success/yards, so invert=true regardless of group, same "lower is better
// defense" convention as every other *_allowed stat.
function defSuccessCell(group, r, defTeam) {
  const succVal = DATA.team_stats[defTeam][r.defSuccessKey];
  if (succVal === null || succVal === undefined) return `<td class="num">--</td>`;
  const cls = tierFor(r.defSuccessKey, defTeam, true);
  const a = tierForAlphaAttr(r.defSuccessKey, defTeam, true);
  const unit = group.inlineUnit ? ` ${group.inlineUnit}` : "";
  const display = group.pct ? `${Math.round(succVal * 100)}%` : `${fmt(succVal, 2)}${unit}`;
  return `<td class="num ${cls}"${a}>${display}</td>`;
}

function renderSchemeGroup(group, offTeam, defTeam) {
  let orderedRows = group.rows;
  if (group.sortByTendency) {
    orderedRows = [...group.rows].sort((a, b) => {
      const av = DATA.team_stats[defTeam][a.tendKey];
      const bv = DATA.team_stats[defTeam][b.tendKey];
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });
  }
  const rows = orderedRows
    .map((r) => {
      const perfVal = DATA.team_stats[offTeam][r.perfKey];
      const { html: tendHtml, tendVal, tendCls } = tendencyCell(r, defTeam);
      const perfCls = perfVal === null || perfVal === undefined ? "" : tierFor(r.perfKey, offTeam, false);
      const perfA = perfVal === null || perfVal === undefined ? "" : tierForAlphaAttr(r.perfKey, offTeam, false);
      const perfUnit = group.inlineUnit ? ` ${group.inlineUnit}` : "";
      const perfDisplay =
        perfVal === null || perfVal === undefined ? "--" : group.pct ? `${Math.round(perfVal * 100)}%` : `${fmt(perfVal, 2)}${perfUnit}`;
      const dim = tendVal !== null && tendVal !== undefined && tendVal < SCHEME_MIN_TENDENCY_SHOWN;
      return `<tr${dim ? ' class="scheme-row-dim"' : ""}><td>${r.label}</td><td class="num ${perfCls}"${perfA}>${perfDisplay}</td>${defSuccessCell(group, r, defTeam)}<td>${tendHtml}</td>${schemeEdgeCell(perfCls, tendCls, tendVal, offTeam, defTeam)}</tr>`;
    })
    .join("");
  const perfCaption = group.inlineUnit ? "" : group.perfLabel;
  return `<tr class="group-row"><td>${group.label}</td><td class="metric-caption" colspan="2">${perfCaption}</td><td class="metric-caption"></td><td class="metric-caption"></td></tr>${rows}`;
}

function renderSchemeTable(offTeam, defTeam) {
  const groups = SCHEME_GROUPS.map((g) => renderSchemeGroup(g, offTeam, defTeam)).join("");
  return `<table class="data-table scheme-table">
    <thead>${schemeTableHeader(offTeam, defTeam)}</thead>
    <tbody>${groups}</tbody>
  </table>`;
}

function renderRecentGamesPanel(team) {
  const games = (DATA.recent_games[team] || []).slice().reverse();
  if (games.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No games played yet this season.</p>`;
  }
  const rows = games
    .map((g) => {
      const oppLabel = g.home_away === "away" ? `@ ${g.opponent}` : g.opponent;
      const resultCls = g.result === "W" ? "tier-good" : g.result === "L" ? "tier-bad" : "tier-mid";
      const halfLabel = g.ht_for === null || g.ht_against === null ? "--" : `${g.ht_for}-${g.ht_against}`;
      return `<tr><td>${g.week}</td><td>${oppLabel}</td><td class="num">${halfLabel}</td><td class="num">${g.final_for}-${g.final_against}</td><td class="num ${resultCls}">${g.result}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <details class="recent-games-dropdown">
      <summary>Recent Games (${games.length})</summary>
      <table class="data-table recent-games-table">
        <thead><tr><th>Wk</th><th>Opp</th><th>Half</th><th>Final</th><th>W/L</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function statusAbbr(status) {
  if (!status) return "?";
  const s = status.toLowerCase();
  if (s.includes("out")) return "Out";
  if (s.includes("doubtful")) return "Doubtful";
  if (s.includes("questionable")) return "Questionable";
  if (s.includes("did not participate")) return "DNP";
  if (s.includes("limited")) return "Limited";
  if (s.includes("full")) return "Full";
  return status;
}
function statusClass(status) {
  if (!status) return "tier-mid";
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("doubtful") || s.includes("did not participate")) return "tier-bad";
  if (s.includes("questionable") || s.includes("limited")) return "tier-mid";
  return "tier-good";
}

function renderInjuryPanel(team, week) {
  const list = (DATA.injuries[team] && DATA.injuries[team][String(week)]) || [];
  if (list.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No one listed on the injury report.</p>`;
  }
  const groups = { OFF: [], DEF: [], ST: [] };
  list.forEach((p) => {
    (groups[p.position_group] || groups.ST).push(p);
  });
  const groupLabel = { OFF: "Offense", DEF: "Defense", ST: "Special Teams" };
  const sections = ["OFF", "DEF", "ST"]
    .filter((g) => groups[g].length > 0)
    .map((g) => {
      const badges = groups[g]
        .map((p) => `<span class="injury-badge ${statusClass(p.status)}">${p.full_name} (${p.position}) &mdash; ${statusAbbr(p.status)}</span>`)
        .join("");
      return `<div class="injury-group"><span class="injury-group-label">${groupLabel[g]}</span><div class="injury-badges">${badges}</div></div>`;
    })
    .join("");
  return `<h3>${team}</h3>${sections}`;
}

// ---- pick tracker ----
function marketSides(game, market) {
  if (market === "spread") {
    return [
      { side: "away", label: `${game.away} ${fmtSigned(game.away_team_spread)}`, line: game.away_team_spread, odds: game.away_spread_odds, available: game.away_team_spread !== null },
      { side: "home", label: `${game.home} ${fmtSigned(game.home_team_spread)}`, line: game.home_team_spread, odds: game.home_spread_odds, available: game.home_team_spread !== null },
    ];
  }
  if (market === "total") {
    return [
      { side: "over", label: `Over ${fmt(game.total_line, 1)}`, line: game.total_line, odds: game.over_odds, available: game.total_line !== null },
      { side: "under", label: `Under ${fmt(game.total_line, 1)}`, line: game.total_line, odds: game.under_odds, available: game.total_line !== null },
    ];
  }
  return [
    { side: "away", label: `${game.away} ${fmtOdds(game.away_moneyline)}`, line: null, odds: game.away_moneyline, available: game.away_moneyline !== null },
    { side: "home", label: `${game.home} ${fmtOdds(game.home_moneyline)}`, line: null, odds: game.home_moneyline, available: game.home_moneyline !== null },
  ];
}

function renderPickMarketRow(game, market) {
  const existing = getPick(game.game_id, market.key);
  const sides = marketSides(game, market.key);

  if (existing) {
    const sideInfo = sides.find((s) => s.side === existing.side);
    const colorInfo = COLORS.find((c) => c.key === existing.color);
    const resultTag = existing.graded
      ? `<span class="pick-result pick-result-${existing.graded}">${existing.graded.toUpperCase()}</span>`
      : `<span class="pick-result pick-result-pending">Pending</span>`;
    return `<div class="pick-market-row">
      <span class="pick-market-label">${market.label}</span>
      <span class="pick-badge pick-color-${existing.color}">${sideInfo ? sideInfo.label : existing.side} &middot; ${colorInfo ? colorInfo.label : existing.color}</span>
      ${resultTag}
      <button type="button" class="pick-edit-btn" data-market="${market.key}" data-action="edit">Edit</button>
      <button type="button" class="pick-edit-btn" data-market="${market.key}" data-action="delete">Delete</button>
    </div>`;
  }

  const allAvailable = sides.every((s) => s.available);
  if (!allAvailable) {
    return `<div class="pick-market-row"><span class="pick-market-label">${market.label}</span><span class="no-data-note">Odds not posted yet.</span></div>`;
  }
  const draft = draftPicks[market.key] || {};
  // Checkbox is independent of the actual side-select/color pick flow --
  // a "worth a look" note for the Possible Plays list, not a graded pick.
  const sideBtns = sides
    .map((s) => {
      const entry = {
        id: `${game.game_id}_${market.key}_${s.side}`,
        week: game.week,
        matchup: `${game.away} @ ${game.home}`,
        category: MARKET_LABELS[market.key],
        description: s.label,
        odds: fmtOdds(s.odds),
        book: null,
      };
      const checked = isPossiblePlay(entry.id) ? " checked" : "";
      return `<span class="pick-side-wrap">
        <button type="button" class="pick-side-btn${draft.side === s.side ? " selected" : ""}" data-market="${market.key}" data-action="side" data-side="${s.side}">${s.label}</button>
        <label class="pp-check-inline" title="Add to Possible Plays"><input type="checkbox" class="pp-toggle" data-entry="${encodeDataAttr(entry)}"${checked}></label>
      </span>`;
    })
    .join("");
  const colorBtns = COLORS.map(
    (c) => `<button type="button" class="pick-color-btn pick-color-${c.key}${draft.color === c.key ? " selected" : ""}" data-market="${market.key}" data-action="color" data-color="${c.key}">${c.label}</button>`
  ).join("");
  return `<div class="pick-market-row pick-market-form">
    <span class="pick-market-label">${market.label}</span>
    <div class="pick-side-group">${sideBtns}</div>
    <div class="pick-color-group">${colorBtns}</div>
  </div>`;
}

// Every fully-picked (side + color) draft market saves in one click, instead
// of a separate Save per market -- draftPicks accumulates selections across
// all three markets as the user clicks side/color buttons, untouched until
// this fires.
function anyDraftReady(game) {
  return MARKETS.some((m) => {
    const draft = draftPicks[m.key];
    return draft && draft.side && draft.color && !getPick(game.game_id, m.key);
  });
}

const MARKET_LABELS = { spread: "Spread", total: "Total", moneyline: "Moneyline" };
const COLOR_LABELS = { green: "Good Play", yellow: "Lean", red: "No Confidence" };

// Units assume a flat 1u stake on every pick, spread/total priced at a
// standardized -105 and moneyline at its real frozen price -- see picks.js'
// unitsForPick for why. Shown on every cell, win% only once picks are decided.
function matrixCellText(t) {
  const unitsStr = `${t.units >= 0 ? "+" : ""}${t.units.toFixed(2)}u`;
  const pct = t.winPct !== null ? `${t.winPct}%, ` : "";
  return `${t.win}-${t.loss}-${t.push} (${pct}${unitsStr})`;
}

function renderPickMatrix(picks) {
  const m = pickMatrix(picks);
  if (picks.length === 0) return "";
  const header = `<tr><th></th>${m.colors.map((c) => `<th>${COLOR_LABELS[c]}</th>`).join("")}<th>Total</th></tr>`;
  const rows = m.rows
    .map(
      (r) =>
        `<tr><td>${MARKET_LABELS[r.market]}</td>${r.cells.map((c) => `<td>${matrixCellText(c)}</td>`).join("")}<td class="matrix-total-col">${matrixCellText(r.total)}</td></tr>`
    )
    .join("");
  const totalRow = `<tr class="matrix-total-row"><td>Total</td>${m.colTotals.map((c) => `<td>${matrixCellText(c)}</td>`).join("")}<td class="matrix-total-col">${matrixCellText(m.grandTotal)}</td></tr>`;
  return `<table class="data-table pick-matrix-table">
    <thead>${header}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;
}

function renderPickSummary() {
  const picks = regradeAllPicks(DATA.schedule);
  const recent = picks
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8)
    .map(
      (p) =>
        `<div class="pick-recent-row"><span class="pick-color-dot pick-color-${p.color}"></span><span>${p.away} @ ${p.home} &mdash; ${p.market} ${p.side}</span><span>${p.graded ? p.graded.toUpperCase() : "Pending"}</span></div>`
    )
    .join("");
  document.getElementById("picks-summary").innerHTML = `
    <h3>Your Record</h3>
    ${picks.length ? `<p class="no-data-note">Units assume 1u per pick -- spread/total priced at a flat -105, moneyline at its real price.</p>` : ""}
    ${renderPickMatrix(picks) || `<p class="no-data-note">No picks saved yet.</p>`}
    ${recent ? `<h3>Recent Picks</h3>${recent}` : ""}
  `;
}

function attachPickTrackerHandlers(game) {
  const wrap = document.getElementById("picks-content");
  wrap.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const market = btn.dataset.market;
      const action = btn.dataset.action;
      if (action === "side") {
        draftPicks[market] = { ...draftPicks[market], side: btn.dataset.side };
        renderPickTracker(game);
      } else if (action === "color") {
        draftPicks[market] = { ...draftPicks[market], color: btn.dataset.color };
        renderPickTracker(game);
      } else if (action === "save-all") {
        MARKETS.forEach((m) => {
          const draft = draftPicks[m.key];
          if (!draft || !draft.side || !draft.color || getPick(game.game_id, m.key)) return;
          const sideInfo = marketSides(game, m.key).find((s) => s.side === draft.side);
          upsertPick({
            game_id: game.game_id,
            season: DATA.requested_season,
            week: game.week,
            away: game.away,
            home: game.home,
            market: m.key,
            side: draft.side,
            line_at_pick: sideInfo.line,
            odds_at_pick: sideInfo.odds,
            color: draft.color,
            created_at: new Date().toISOString(),
          });
        });
        resetDraftPicks();
        renderPickTracker(game);
      } else if (action === "edit") {
        const existing = getPick(game.game_id, market);
        draftPicks[market] = existing ? { side: existing.side, color: existing.color } : {};
        deletePick(game.game_id, market);
        renderPickTracker(game);
      } else if (action === "delete") {
        deletePick(game.game_id, market);
        renderPickTracker(game);
      }
    });
  });
}

function renderPickTracker(game) {
  regradeAllPicks(DATA.schedule);
  const saveAllBtn = `<div class="pick-save-all-row"><button type="button" class="pick-save-all-btn" data-action="save-all"${anyDraftReady(game) ? "" : " disabled"}>Save Picks</button></div>`;
  document.getElementById("picks-content").innerHTML = `<div class="pick-markets">${MARKETS.map((m) => renderPickMarketRow(game, m)).join("")}${saveAllBtn}</div>`;
  attachPickTrackerHandlers(game);
  renderPickSummary();
}

// ---- flipper / render ----
function ensureCurrentGame() {
  const fresh = gamesForWeek(scheduleWeek);
  // Only reset to game 0 on an actual week CHANGE (weekGames already held a
  // different week) -- not on the very first call, where weekGames is still
  // its initial empty array. That first-call case needs to keep whatever
  // currentGameIndex initFlipper's onSelect already set (the stored pick,
  // or the week's first game), not stomp it back to 0.
  const isWeekChange = weekGames.length > 0 && weekGames[0].week !== scheduleWeek;
  weekGames = fresh;
  if (isWeekChange) currentGameIndex = 0;
  if (currentGameIndex >= weekGames.length) currentGameIndex = Math.max(0, weekGames.length - 1);
}

function render() {
  ensureCurrentGame();
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = SECTIONS.map((s) => document.getElementById(`section-${s}`));
  const flipperEl = document.getElementById("game-flipper");
  const headerEl = document.getElementById("game-header");

  const game = currentGame();
  if (!game) {
    sectionEls.forEach((el) => (el.hidden = true));
    flipperEl.hidden = true;
    headerEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>No games scheduled for this week.</p>";
    return;
  }

  renderGameHeader(game);
  flipperEl.hidden = false;
  document.getElementById("game-flipper-label").textContent = `Game ${currentGameIndex + 1} of ${weekGames.length}`;
  document.getElementById("game-prev").disabled = currentGameIndex <= 0;
  document.getElementById("game-next").disabled = currentGameIndex >= weekGames.length - 1;
  // Keep the scroller's card highlight in sync -- the flipper's own
  // prev/next buttons move currentGameIndex without going through the
  // scroller's click handler, so its "selected" card would otherwise go stale.
  renderMatchupRow(document.getElementById("matchup-row"), scheduleWeek, game.away, game.home);

  const { away, home } = game;
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

  document.getElementById("col-away-injuries").innerHTML = renderInjuryPanel(away, game.week);
  document.getElementById("col-home-injuries").innerHTML = renderInjuryPanel(home, game.week);
  document.getElementById("odds-content").innerHTML = renderOddsBar(game);
  document.getElementById("col-away-general").innerHTML = renderGeneralStatsTable(away, home);
  document.getElementById("col-home-general").innerHTML = renderGeneralStatsTable(home, away);
  document.getElementById("scheme-notes").innerHTML = renderSchemeNotes(away, home);
  document.getElementById("col-away-scheme").innerHTML = renderSchemeTable(away, home);
  document.getElementById("col-home-scheme").innerHTML = renderSchemeTable(home, away);
  document.getElementById("col-away-recent").innerHTML = renderRecentGamesPanel(away);
  document.getElementById("col-home-recent").innerHTML = renderRecentGamesPanel(home);
  document.getElementById("col-away-summary").innerHTML = renderSummaryTable(away, home);
  document.getElementById("col-home-summary").innerHTML = renderSummaryTable(home, away);

  const notesEl = document.getElementById("game-notes");
  notesEl.value = loadGameNotes()[game.game_id] || "";
  notesEl.dataset.gameId = game.game_id;

  renderPickTracker(game);
}

document.getElementById("game-notes").addEventListener("input", (e) => {
  saveGameNote(e.target.dataset.gameId, e.target.value);
});

function handlePick() {
  resetDraftPicks();
  render();
}

function initFlipper() {
  initScheduleScroller(handlePick, {
    getSelected: () => {
      const g = currentGame();
      return g ? { away: g.away, home: g.home } : {};
    },
    onSelect: (away, home) => {
      const games = gamesForWeek(scheduleWeek);
      const idx = games.findIndex((g) => g.away === away && g.home === home);
      currentGameIndex = idx === -1 ? 0 : idx;
    },
    onWeekChange: handlePick,
  });

  document.getElementById("game-prev").addEventListener("click", () => {
    if (currentGameIndex > 0) {
      currentGameIndex--;
      resetDraftPicks();
      render();
      saveSelectedGame(scheduleWeek, currentGame().away, currentGame().home);
    }
  });
  document.getElementById("game-next").addEventListener("click", () => {
    if (currentGameIndex < weekGames.length - 1) {
      currentGameIndex++;
      resetDraftPicks();
      render();
      saveSelectedGame(scheduleWeek, currentGame().away, currentGame().home);
    }
  });
}

document.getElementById("scheme-info-btn").addEventListener("click", () => {
  const el = document.getElementById("scheme-info-text");
  el.hidden = !el.hidden;
});

document.getElementById("grades-info-btn").addEventListener("click", () => {
  const el = document.getElementById("grades-info-text");
  el.hidden = !el.hidden;
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    let note = `${data.season} season — through week ${data.through_week}`;
    if (data.is_fallback_season) {
      note = `Showing final ${data.season} season — ${data.requested_season} season data isn't published on nflverse yet`;
    }
    document.getElementById("season-note").textContent = note;
    resetDraftPicks();
    initFlipper();
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
