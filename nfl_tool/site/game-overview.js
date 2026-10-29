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
// Shared by GENERAL_STAT_GROUPS' "Red Zone" row and SUMMARY_CATEGORIES'
// "Red Zone" grade -- one definition so both places' grades (and the
// modal behind either) always agree. Weighted 70/30 toward volume
// (trips/game) over efficiency (points/trip) rather than a bare TD
// conversion rate: 3-for-4 and 1-for-1 both read as "100%" under a rate,
// despite one being a real, repeatable trip volume and the other a tiny
// sample. rz_avg_points already accounts for FGs (3) vs TDs (6) vs
// nothing (turnover/turnover on downs/missed FG), so it's a truer
// efficiency number than the raw TD rate alone. Defense side inverts
// both -- allowing MORE trips and MORE points per trip are both bad for
// that defense, same "green = good for the team it's on" rule as
// everywhere else.
const RED_ZONE_CATEGORY = {
  label: "Red Zone",
  off: [
    { key: "rz_trips_per_g", invert: false, weight: 7 },
    { key: "rz_avg_points", invert: false, weight: 3 },
  ],
  def: [
    { key: "rz_trips_allowed_per_g", invert: true, weight: 7 },
    { key: "rz_avg_points_allowed", invert: true, weight: 3 },
  ],
  // Shown as extra columns in the grade-rank modal only (not in the
  // compact grade tables themselves) -- Trips/TDs/FGs/Avg Points behind
  // the composite so "why is this a B" is never a mystery. Each column is
  // colored by its own league-wide percentile (see openGradeRankModal) --
  // offInvert/defInvert follow the same "green = good for the team it's
  // on" rule as everywhere else. FGs is left uncolored (no offInvert/
  // defInvert): a low FG count means EITHER more TDs (great) or more
  // empty-handed trips (terrible), and there's no way to tell those apart
  // from the FG count alone -- coloring it either direction risks
  // painting a stalled, scoreless trip as a good result, which it never
  // is. Avg Pts already folds TD (6) vs FG (3) vs nothing (0) into one
  // real number, so it's the column that actually carries that signal.
  extraCols: [
    { label: "Trips", off: "rz_trips", def: "rz_trips_allowed", offInvert: false, defInvert: true },
    { label: "TDs", off: "rz_trips_td", def: "rz_trips_td_allowed", offInvert: false, defInvert: true },
    { label: "FGs", off: "rz_trips_fg", def: "rz_trips_fg_allowed" },
    { label: "Avg Pts", off: "rz_avg_points", def: "rz_avg_points_allowed", digits: 2, offInvert: false, defInvert: true },
  ],
};

const GENERAL_STAT_GROUPS = [
  {
    label: "Production",
    rows: [
      { label: "Points", offKey: "points_for_per_g", offInvert: false, defKey: "points_against_per_g", defInvert: true },
      { label: "EPA / Play", offKey: "epa_per_play", offInvert: false, defKey: "epa_per_play_allowed", defInvert: true, digits: 2 },
      // Attempts (pass or rush) deliberately excluded -- a team trailing
      // late passes more and a team leading runs more out of game script,
      // not because that's a real tendency, so a raw attempts count without
      // that context reads as signal it isn't. Yards and Yards/Carry stay
      // since those measure production, not play-calling circumstance.
      { label: "Pass Yards", offKey: "pass_yards_per_g", offInvert: false, defKey: "pass_yards_allowed_per_g", defInvert: true },
      { label: "Rush Yards", offKey: "rush_yards_per_g", offInvert: false, defKey: "rush_yards_allowed_per_g", defInvert: true },
      { label: "Yards / Carry", offKey: "yards_per_carry", offInvert: false, defKey: "yards_per_carry_allowed", defInvert: true, digits: 1 },
      { label: "3rd Down %", offKey: "third_down_rate", offInvert: false, defKey: "third_down_rate_allowed", defInvert: true, pct: true },
      { label: "Red Zone", composite: RED_ZONE_CATEGORY },
      { label: "Explosive Plays", offKey: "explosive_rate", offInvert: false, defKey: "explosive_rate_allowed", defInvert: true, pct: true },
      // Plays run per game -- a fast-tempo offense facing another
      // fast-tempo offense suggests a track meet; two slow, run-first
      // teams suggests a grind. Not a real value judgment either
      // direction (pace isn't "good," it's a style), tiered anyway for
      // visual consistency with every other row in this table.
      { label: "Plays / Game", offKey: "off_plays_per_g", offInvert: false, defKey: "def_plays_faced_per_g", defInvert: true },
    ],
  },
  {
    label: "Turnovers & Pressure",
    rows: [
      { label: "Sacks", offKey: "sacks_allowed_per_g", offInvert: true, defKey: "sacks_made_per_g", defInvert: false },
      { label: "Turnovers", offKey: "turnovers_per_g", offInvert: true, defKey: "takeaways_per_g", defInvert: false },
      // Split by which side of the ball the flag actually happened on
      // (false start/holding/illegal shift while on offense vs
      // offside/DPI/defensive holding while on defense) -- these are two
      // different units doing different jobs, not one team-wide number.
      // Yards over count: a holding call and a defensive holding call cost
      // very different amounts, so yards is the more honest measure of
      // actual damage done.
      { label: "Penalty Yards", offKey: "penalty_yards_off_per_g", offInvert: true, defKey: "penalty_yards_def_per_g", defInvert: true },
    ],
  },
  {
    // Fast starter vs. slow/comeback-heavy team -- relevant to anyone
    // who bets 1st-half lines specifically, not just full-game totals.
    // OT folds into Q4 (build_stats.py's compute_scoring_by_quarter).
    label: "Scoring by Quarter",
    rows: [
      { label: "1st Quarter", offKey: "q1_scored_per_g", offInvert: false, defKey: "q1_allowed_per_g", defInvert: true },
      { label: "2nd Quarter", offKey: "q2_scored_per_g", offInvert: false, defKey: "q2_allowed_per_g", defInvert: true },
      { label: "3rd Quarter", offKey: "q3_scored_per_g", offInvert: false, defKey: "q3_allowed_per_g", defInvert: true },
      { label: "4th Quarter", offKey: "q4_scored_per_g", offInvert: false, defKey: "q4_allowed_per_g", defInvert: true },
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
    // still win often. Unlike the CALL rows (blitzing more or less isn't
    // inherently good or bad -- see tendencyCell), Pressured/Clean Pocket's
    // own frequency IS a real value judgment for the defense: pressuring
    // the QB more is good (tendInvert left at the default false -- high
    // reads green, already correct), and letting the QB sit clean more
    // is bad, the exact opposite direction, hence tendInvert: true here.
    label: "Pass Rush",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Blitz (5+ rushers)", tendKey: "blitz_rate", perfKey: "success_vs_blitz", defSuccessKey: "def_success_allowed_blitz" },
      { label: "Standard Rush", tendKey: "standard_rush_rate", perfKey: "success_vs_standard_rush", defSuccessKey: "def_success_allowed_standard_rush" },
      { label: "Pressured", tendKey: "pressure_rate", perfKey: "success_vs_pressure", defSuccessKey: "def_success_allowed_pressure" },
      { label: "Clean Pocket", tendKey: "clean_pocket_rate", perfKey: "success_vs_clean_pocket", defSuccessKey: "def_success_allowed_clean_pocket", tendInvert: true },
    ],
  },
  // Coverage (Zone/Man, specific shells) was dropped entirely -- that data
  // only exists in the NFL's own participation charting, which has no
  // live-during-season source anywhere (see build_stats.py's
  // compute_scheme_splits docstring), so it would only ever be stale.
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
  RED_ZONE_CATEGORY,
  // Offensive line vs the opposing defensive front (build_stats.py ->
  // line_grades.py). Offense side = this team's OL overall, defense side =
  // the other team's front overall. Clicking opens the Trenches modal.
  { label: "Trenches", trenches: true },
  {
    // Built from every row in SCHEME_GROUPS rather than a fixed list, so it
    // always reflects whatever the Scheme & Tendencies table above is
    // actually showing -- see schemeCompositeZ().
    label: "Scheme",
    scheme: true,
  },
];

// ---- Trenches (offensive line / defensive front grades) ----
// z/letter/0-100 score come precomputed from line_grades.py; letters use the
// same bands as GRADE_BANDS below, so gradeForZ(z) matches the build's letter.
function trenchesEntry(team, side, group) {
  const t = (DATA.line_grades || {})[team];
  return (t && t[side === "off" ? "ol" : "dl"] && t[side === "off" ? "ol" : "dl"][group]) || null;
}
function trenchesZ(team, side, group = "overall") {
  const e = trenchesEntry(team, side, group);
  return e && e.z !== null && e.z !== undefined ? e.z : null;
}
// Color for a 0-100 score, same cut points as the letters (A 88+, B 66-87,
// C 35-65, D 12-34, F <12): green above, yellow middle, red below, deeper
// toward the ends.
function trenchesScoreStyle(score) {
  if (score === null || score === undefined) return { cls: "", attr: "" };
  let cls, t;
  if (score >= 66) { cls = "tier-good"; t = (score - 66) / 33; }
  else if (score >= 35) { cls = "tier-mid"; t = 0; }
  else { cls = "tier-bad"; t = (35 - score) / 34; }
  const alpha = TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * Math.min(Math.max(t, 0), 1);
  return { cls, attr: cls === "tier-mid" ? "" : ` style="--tier-a:${alpha.toFixed(2)}"` };
}
function trenchesCellInner(e) {
  return e && e.grade ? `<b class="tr-letter">${e.grade}</b><span class="tr-score">${e.score}</span>` : "--";
}

// Which category's z for this team/side -- one place for the three kinds.
function categoryZ(cat, team, side) {
  if (cat.scheme) return schemeCompositeZ(team, side);
  if (cat.trenches) return trenchesZ(team, side);
  return compositeZ(side === "off" ? cat.off : cat.def, team);
}

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
    const value = tierValue(team, m.key);
    if (value === null || value === undefined) continue;
    const values = pool.map((t) => tierValue(t, m.key));
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
  return `<tr><th></th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${teamLogoMini(offTeam, 20)}</span> <span class="pair-hdr-sub">OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${teamLogoMini(defTeam, 20)}</span> <span class="pair-hdr-sub">DEF</span></th><th class="edge-hdr">ADV</th></tr>`;
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
  return `<td class="edge-cell edge-hit" style="background:rgba(${rgb.join(",")},${alpha.toFixed(2)})">${teamLogoMini(team)}</td>`;
}

// Paired by MATCHUP (offTeam's offense against defTeam's defense), same
// convention as General Stats/Scheme -- call twice (away-vs-home,
// home-vs-away) for the two side-by-side tables.
// Every team's grade for one category+side, sorted best to worst -- same
// shell/highlight convention as common.js's openStatRankModal, just
// showing the LETTER GRADE (gradeForZ) instead of a raw number, since a
// composite z-score on its own means nothing to look at directly. A
// dedicated function rather than folding into openStatRankModal's
// STAT_RANK_COMPUTED path since a grade needs its own display format
// (letter, not a percent/digit number) that function doesn't support.
// cat.extraCols (currently just RED_ZONE_CATEGORY) adds the raw counting
// stats behind the grade -- Trips/TDs/FGs/Avg Points -- so the composite
// is never a black box.
// Paired version: the category's offense grades beside its defense grades
// (TEAM | off | def | TEAM), with any extra raw-stat columns on each half.
function openPairedGradeModal(cat, offTeam, defTeam) {
  const half = (side) => {
    const rows = gradeRankRows(cat, side);
    const heads = (cat.extraCols || []).map((c) => c.label).concat(["Grade"]);
    return { heads, rows, current: side === "off" ? offTeam : defTeam };
  };
  openPairedRankModal(`${cat.label}: Offense vs Defense`, half("off"), half("def"));
}

function gradeRankRows(cat, side) {
  return teamsWithGames()
    .map((t) => {
      const z = categoryZ(cat, t, side);
      return { team: t, z, grade: gradeForZ(z) };
    })
    .filter((r) => r.grade !== null)
    .sort((a, b) => b.z - a.z)
    .map((r) => {
      const extra = (cat.extraCols || []).map((c) => {
        const statKey = side === "off" ? c.off : c.def;
        const v = DATA.team_stats[r.team][statKey];
        if (v === null || v === undefined) return `<td class="num">--</td>`;
        const display = c.digits ? fmt(v, c.digits) : v;
        const invert = side === "off" ? c.offInvert : c.defInvert;
        if (invert === undefined) return `<td class="num">${display}</td>`;
        return `<td class="num ${tierFor(statKey, r.team, invert)}"${tierForAlphaAttr(statKey, r.team, invert)}>${display}</td>`;
      });
      return { team: r.team, cells: extra.concat([`<td class="num grade-cell ${gradeClass(r.grade)}"${gradeAlphaAttr(r.grade)}>${r.grade}</td>`]) };
    });
}

function openGradeRankModal(cat, side, currentTeam) {
  ensureStatRankModal();
  const rows = teamsWithGames()
    .map((t) => {
      const z = categoryZ(cat, t, side);
      return { team: t, z, grade: gradeForZ(z) };
    })
    .filter((r) => r.grade !== null)
    .sort((a, b) => b.z - a.z);
  const label = `${cat.label} (${side === "off" ? "Offense" : "Defense"})`;
  const extraHeaders = cat.extraCols ? cat.extraCols.map((c) => `<th class="num">${c.label}</th>`).join("") : "";
  const body = rows
    .map((r) => {
      const rowCls = r.team === currentTeam ? ' class="stat-rank-current"' : "";
      // Same league-wide percentile shading every other stat cell on the
      // site uses (tierFor/tierForAlphaAttr) -- each column carries its
      // own offInvert/defInvert (see extraCols above). A column with
      // neither (FGs) renders as a plain uncolored number instead of
      // guessing a direction that's wrong half the time.
      const extraCells = cat.extraCols
        ? cat.extraCols
            .map((c) => {
              const statKey = side === "off" ? c.off : c.def;
              const v = DATA.team_stats[r.team][statKey];
              if (v === null || v === undefined) return `<td class="num">--</td>`;
              const display = c.digits ? fmt(v, c.digits) : v;
              const invert = side === "off" ? c.offInvert : c.defInvert;
              if (invert === undefined) return `<td class="num">${display}</td>`;
              const cls = tierFor(statKey, r.team, invert);
              const alpha = tierForAlphaAttr(statKey, r.team, invert);
              return `<td class="num ${cls}"${alpha}>${display}</td>`;
            })
            .join("")
        : "";
      return `<tr${rowCls}><td>${teamLogoMini(r.team)} ${TEAM_NAMES[r.team] || r.team}</td>${extraCells}<td class="num grade-cell ${gradeClass(r.grade)}"${gradeAlphaAttr(r.grade)}>${r.grade}</td></tr>`;
    })
    .join("");
  document.getElementById("stat-rank-modal-content").innerHTML = `<h3>${label} &mdash; All Teams</h3>
    <table class="data-table player-odds-table stat-rank-table">
      <thead><tr><th>Team</th>${extraHeaders}<th class="num">Grade</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  document.getElementById("stat-rank-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const cell = e.target.closest(".grade-rank-click");
  if (!cell) return;
  const { cat, side, team } = decodeDataAttr(cell.dataset.entry);
  const both = [...cell.closest("tr").querySelectorAll(".grade-rank-click")].map((c) => decodeDataAttr(c.dataset.entry));
  const off = both.find((p) => p.side === "off");
  const def = both.find((p) => p.side === "def");
  if (cat.trenches) openTrenchesModal(off ? off.team : team, def ? def.team : null);
  else if (off && def) openPairedGradeModal(cat, off.team, def.team);
  else openGradeRankModal(cat, side, team);
});

function renderSummaryTable(offTeam, defTeam) {
  const rows = SUMMARY_CATEGORIES.map((cat) => {
    const offZ = categoryZ(cat, offTeam, "off");
    const defZ = categoryZ(cat, defTeam, "def");
    const offGrade = gradeForZ(offZ);
    const defGrade = gradeForZ(defZ);
    const advCell = summaryAdvCell(offZ, defZ, offTeam, defTeam);
    const offEntry = encodeDataAttr({ cat, side: "off", team: offTeam });
    const defEntry = encodeDataAttr({ cat, side: "def", team: defTeam });
    return `<tr><td>${cat.label}</td><td class="num grade-cell grade-rank-click ${gradeClass(offGrade)}" data-entry="${offEntry}"${gradeAlphaAttr(offGrade)}>${offGrade || "--"}</td><td class="num grade-cell grade-rank-click ${gradeClass(defGrade)}" data-entry="${defEntry}"${gradeAlphaAttr(defGrade)}>${defGrade || "--"}</td>${advCell}</tr>`;
  }).join("");
  return `<table class="data-table summary-grade-table">
    <thead>${summaryTableHeader(offTeam, defTeam)}</thead>
    <tbody><tr><td class="section-group-label" colspan="4">Team Grades</td></tr>${rows}</tbody>
  </table>`;
}

// Trenches section (between Pass Rush and Team Grades): this offense's line
// vs the other team's front, part by part. Discipline is offense-only (a
// front has no matching number), so its DEF cell is left blank on purpose.
const TRENCHES_ROWS = [
  { label: "Pass Protection", off: "pass_pro", def: "pass_rush" },
  { label: "Run Blocking", off: "run_block", def: "run_defense" },
  { label: "Discipline", off: "discipline", def: null },
  { label: "Overall", off: "overall", def: "overall", overall: true },
];
function renderTrenchesTable(offTeam, defTeam) {
  if (!DATA.line_grades) return "";
  const cell = (team, side, group) => {
    if (!group) return `<td class="num trenches-cell trenches-blank"></td>`;
    const e = trenchesEntry(team, side, group);
    const { cls, attr } = trenchesScoreStyle(e && e.score);
    const entry = encodeDataAttr({ off: offTeam, def: defTeam });
    return `<td class="num grade-cell trenches-cell trenches-click ${cls}"${attr} data-entry="${entry}" title="See every team's line grades">${trenchesCellInner(e)}</td>`;
  };
  const rows = TRENCHES_ROWS.map((r) => {
    const adv = r.def ? summaryAdvCell(trenchesZ(offTeam, "off", r.off), trenchesZ(defTeam, "def", r.def), offTeam, defTeam) : `<td class="edge-cell"></td>`;
    return `<tr${r.overall ? ' class="trenches-overall"' : ""}><td>${r.label}</td>${cell(offTeam, "off", r.off)}${cell(defTeam, "def", r.def)}${adv}</tr>`;
  }).join("");
  return `<table class="data-table summary-grade-table trenches-table">
    <thead>${summaryTableHeader(offTeam, defTeam)}</thead>
    <tbody><tr><td class="section-group-label" colspan="4">Trenches</td></tr>${rows}</tbody>
  </table>`;
}

// ---- Trenches modal: every team's OL + defensive front grades, same
// layout as the draft the user signed off on (2026-10-01). ----
const TRENCHES_METRIC_FMT = {
  pressure_4man: "pct", pressure_blitz: "pct", sack_rate: "pct", clean_pocket: "pct", stuff_rate: "pct",
  short_yardage: "pct", rush_success: "pct", pressure_vs_ttt: "ttt", xry_per_carry: "yds", ypc_vs_box: "pm", ol_penalties: "pg",
};
function trenchesMetricText(key, v) {
  if (v === null || v === undefined) return "--";
  switch (TRENCHES_METRIC_FMT[key]) {
    case "pct": return `${(v * 100).toFixed(1)}%`;
    case "ttt": return `QB holds ${v.toFixed(2)}s`;
    case "yds": return `${v.toFixed(2)} yds`;
    case "pm": return `${v >= 0 ? "+" : ""}${v.toFixed(2)} yds`;
    case "pg": return `${v.toFixed(1)}/game`;
    default: return String(v);
  }
}
function trenchesTip(team, side, group) {
  const t = DATA.line_grades[team];
  const block = t && t[side === "off" ? "ol" : "dl"];
  if (!block || group === "overall") return "";
  return Object.entries(block.metrics)
    .filter(([, m]) => m.group === group)
    .map(([k, m]) => `${m.label}: ${trenchesMetricText(k, m.value)} -> ${m.score ?? "--"}`)
    .join("\n");
}
function ensureTrenchesModal() {
  if (document.getElementById("trenches-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "trenches-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box trenches-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="trenches-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => (overlay.hidden = true);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
function openTrenchesModal(offTeam, defTeam) {
  if (!DATA.line_grades) return;
  ensureTrenchesModal();
  const teams = Object.keys(DATA.line_grades).sort(
    (a, b) => (DATA.line_grades[b].ol.overall.z ?? -9) - (DATA.line_grades[a].ol.overall.z ?? -9)
  );
  const gcell = (team, side, group) => {
    const e = trenchesEntry(team, side, group);
    const { cls, attr } = trenchesScoreStyle(e && e.score);
    const tip = trenchesTip(team, side, group);
    return `<td class="num grade-cell trenches-cell ${cls}"${attr}${tip ? ` title="${tip.replace(/"/g, "&quot;")}"` : ""}>${trenchesCellInner(e)}</td>`;
  };
  const body = teams.map((t, i) => {
    const cur = t === offTeam || t === defTeam ? ' class="stat-rank-current"' : "";
    return `<tr${cur}><td class="tr-rank">${i + 1}</td><td class="tr-team">${teamLogoMini(t)} ${TEAM_NAMES[t] || t}</td>
      ${gcell(t, "off", "overall")}${gcell(t, "off", "pass_pro")}${gcell(t, "off", "run_block")}${gcell(t, "off", "discipline")}
      <td class="tr-sep"></td>${gcell(t, "def", "overall")}${gcell(t, "def", "pass_rush")}${gcell(t, "def", "run_defense")}</tr>`;
  }).join("");
  const legend = [[95, "A 88+"], [75, "B 66–87"], [50, "C 35–65"], [25, "D 12–34"], [5, "F <12"]]
    .map(([s, l]) => { const { cls, attr } = trenchesScoreStyle(s); return `<span class="tr-legend-chip ${cls}"${attr}>${l}</span>`; })
    .join("");
  document.getElementById("trenches-modal-content").innerHTML = `
    <h3>Trenches &mdash; Offensive Line &amp; Defensive Front Grades</h3>
    <p class="no-data-note">Letter + 0&ndash;100 score (league percentile; 50 = average). Opponent-adjusted and pulled toward average while samples are small. Hover any grade for the stats behind it. Pressure = sack or QB hit; sacks the QB caused don't count against the line.</p>
    <div class="tr-legend">${legend}</div>
    <div class="trenches-rank-wrap"><table class="data-table trenches-rank-table">
      <thead>
        <tr><th></th><th></th><th class="tr-group" colspan="4">Offensive Line</th><th></th><th class="tr-group" colspan="3">Defensive Front</th></tr>
        <tr><th>#</th><th>Team</th><th>Overall</th><th>Pass Pro</th><th>Run Block</th><th>Discipline</th><th></th><th>Overall</th><th>Pass Rush</th><th>Run D</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table></div>`;
  document.getElementById("trenches-modal").hidden = false;
}
document.addEventListener("click", (e) => {
  const cell = e.target.closest(".trenches-click");
  if (!cell) return;
  const { off, def } = decodeDataAttr(cell.dataset.entry);
  openTrenchesModal(off, def);
});


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

// "summary" (Team Grades) is no longer its own top-level section -- it
// moved inside #section-general, sitting under the (now shorter, Coverage-
// free) Scheme tables, so "general" alone covers hiding/showing it too.
const SECTIONS = ["injuries", "odds", "general", "recent", "picks"];

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
    window.NFLSync?.push(GAME_NOTES_KEY, all);
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
// nflverse's schedule "gametime" is Eastern; shown in the member's time zone
// ("1:00 PM CT", sync.js gmgGameTime; the owner, 2026-10-29).
function fmtGameTime(time, date) {
  return gmgGameTime({ time, date });
}

function renderGameHeader(game) {
  const headerEl = document.getElementById("game-header");
  headerEl.hidden = false;
  const dateLabel = game.date
    ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  const timeLabel = fmtGameTime(game.time, game.date);
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
// Novig's main line and price first (pv), best-of-books when Novig has
// none -- the All Odds button still lists every book.
function renderOddsBar(baseGame) {
  const game = { ...baseGame, ...(baseGame.novig || {}) };
  const hasSpread = game.away_team_spread !== null && game.away_spread_odds !== null;
  const hasTotal = game.total_line !== null;
  const hasMl = game.away_moneyline !== null && game.home_moneyline !== null;

  if (!hasSpread && !hasTotal && !hasMl) {
    return `<p class="no-data-note">Odds not posted yet for this game.</p>`;
  }

  // The best price across the member's books (book-odds.js) when SmartStake
  // has this line; click it for every book.
  const matchup = `${game.away} @ ${game.home}`;
  const pill = (kind, team, side, line, title) =>
    typeof bookPricePill === "function" ? bookPricePill({ kind, team, side, line, title, sub: matchup }) : "";
  const sideOf = (team) => (team === game.away ? "away" : "home");
  const spreadCell = (team, line, odds) => {
    if (!hasSpread) return "--";
    const best = pill("spread", team, sideOf(team), line, `${matchup} &middot; Spread`);
    return `${fmtSigned(line)} ${best || `<span class="odds-price">(${showOdds(odds)})</span>`}`;
  };
  const totalCell = (label, odds) => {
    if (!hasTotal) return "--";
    const best = pill("total", game.home, label === "O" ? "o" : "u", game.total_line, `${matchup} &middot; Total`);
    return `${label} ${fmt(game.total_line, 1)} ${best || `<span class="odds-price">(${showOdds(odds)})</span>`}`;
  };
  const mlCell = (odds, prob, team) => {
    if (!hasMl) return "--";
    const best = pill("ml", team, sideOf(team), null, `${matchup} &middot; Moneyline`);
    return best ? `${best} <span class="odds-price">${fmtPct(prob)}</span>` : `${showOdds(odds)} <span class="odds-price">${fmtPct(prob)}</span>`;
  };
  // Ballpark projected score off the two numbers already shown (total split
  // by each team's own share of the spread) -- not a new data source, just
  // the same math a viewer would otherwise do in their head from the
  // Spread/Total columns. Whole numbers print plain; a real half-point
  // score (e.g. 18.5) keeps its .5 instead of rounding it away.
  const impliedScore = (teamSpread) => {
    if (!hasSpread || !hasTotal) return "";
    const score = (game.total_line - teamSpread) / 2;
    const display = Number.isInteger(score) ? score : score.toFixed(1);
    return ` <span class="odds-implied-score">(${display})</span>`;
  };

  return `<table class="data-table odds-table">
    <thead><tr><th></th><th>Spread</th><th>Total</th><th>Moneyline</th></tr></thead>
    <tbody>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.away)}" class="team-logo" alt="${game.away}" loading="lazy">${game.away}${impliedScore(game.away_team_spread)}</td>
        <td class="num">${spreadCell(game.away, game.away_team_spread, game.away_spread_odds)}</td>
        <td class="num">${totalCell("O", game.over_odds)}</td>
        <td class="num">${mlCell(game.away_moneyline, game.away_ml_implied_prob, game.away)}</td>
      </tr>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.home)}" class="team-logo" alt="${game.home}" loading="lazy">${game.home}${impliedScore(game.home_team_spread)}</td>
        <td class="num">${spreadCell(game.home, game.home_team_spread, game.home_spread_odds)}</td>
        <td class="num">${totalCell("U", game.under_odds)}</td>
        <td class="num">${mlCell(game.home_moneyline, game.home_ml_implied_prob, game.home)}</td>
      </tr>
    </tbody>
  </table>`;
}

// ---- Wins & Losses quality (each result vs. its pregame spread) ----
// The spread already prices in opponent strength, home field, and injuries
// (a backup QB start, etc.), so it's the yardstick for "was this result
// better or worse than expected" -- a record-based opponent tier means
// little two games into a season. Labels freeze the market's pregame view;
// the detail modal shows each opponent's CURRENT record for hindsight.
const RESUME_PICKEM = 2.5; // |spread| at or under this = near pick'em
const RESUME_BAD_WIN_MISS = 7; // favorite won but missed the spread by 7+

const RESUME_LABELS = {
  QW: "Quality Win", NW: "Neutral Win", BW: "Bad Win",
  QL: "Quality Loss", NL: "Neutral Loss", BL: "Bad Loss", T: "Tie",
};

// spread is the team's own line (betting notation: + = underdog);
// ats = margin + spread (>0 covered, 0 push, <0 didn't cover). A game with
// no line on file grades as a pick'em (Neutral).
function resumeLabel(margin, spread, ats) {
  if (margin === 0) return "T";
  const hasLine = spread !== null && spread !== undefined;
  const dog = hasLine && spread > RESUME_PICKEM;
  const fav = hasLine && spread < -RESUME_PICKEM;
  if (margin > 0) {
    if (dog) return "QW";
    if (fav && ats <= -RESUME_BAD_WIN_MISS) return "BW";
    return "NW";
  }
  if (fav) return "BL";
  if (dog && ats >= 0) return "QL";
  return "NL";
}

// Final games only, and only weeks BEFORE the game being previewed -- so
// flipping back to an old week shows the résumé as it stood then.
function resumeGamesFor(team, beforeWeek) {
  return (DATA.schedule || [])
    .filter((g) => g.status === "final" && g.week < beforeWeek && (g.away === team || g.home === team))
    .map((g) => {
      const isHome = g.home === team;
      const pf = isHome ? g.home_score : g.away_score;
      const pa = isHome ? g.away_score : g.home_score;
      const spread = isHome ? g.home_team_spread : g.away_team_spread;
      const margin = pf - pa;
      const ats = spread === null || spread === undefined ? null : margin + spread;
      return { week: g.week, opp: isHome ? g.away : g.home, isHome, pf, pa, spread, margin, ats, label: resumeLabel(margin, spread, ats) };
    });
}

function fmtRecord(w, l, t) {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

// Current full-season record (hindsight), not as of the résumé week.
function teamCurrentRecord(team) {
  let w = 0, l = 0, t = 0;
  for (const g of DATA.schedule || []) {
    if (g.status !== "final" || (g.away !== team && g.home !== team)) continue;
    const diff = g.home === team ? g.home_score - g.away_score : g.away_score - g.home_score;
    if (diff > 0) w++;
    else if (diff < 0) l++;
    else t++;
  }
  return fmtRecord(w, l, t);
}

function resumeSummary(games) {
  const count = (lbl) => games.filter((g) => g.label === lbl).length;
  const su = [games.filter((g) => g.margin > 0).length, games.filter((g) => g.margin < 0).length, count("T")];
  const lined = games.filter((g) => g.ats !== null);
  const ats = [lined.filter((g) => g.ats > 0).length, lined.filter((g) => g.ats < 0).length, lined.filter((g) => g.ats === 0).length];
  return {
    Q: [count("QW"), count("QL")], N: [count("NW"), count("NL")], B: [count("BW"), count("BL")],
    su: fmtRecord(...su), ats: fmtRecord(...ats),
  };
}

function resumeWLCell([w, l]) {
  const n = (v) => `<span class="${v ? "resume-count" : "resume-zero"}">${v}</span>`;
  return `${n(w)}-${n(l)}`;
}

function renderResumeChart(game) {
  const rows = [game.away, game.home]
    .map((team) => {
      const s = resumeSummary(resumeGamesFor(team, game.week));
      return `<tr>
        <td class="resume-team">${teamLogoMini(team, 18)} ${team}</td>
        <td class="num">${resumeWLCell(s.Q)}</td>
        <td class="num">${resumeWLCell(s.N)}</td>
        <td class="num">${resumeWLCell(s.B)}</td>
        <td class="num resume-rec">${s.su}</td>
        <td class="num resume-rec">${s.ats}</td>
      </tr>`;
    })
    .join("");
  return `<button type="button" class="resume-chart" data-away="${game.away}" data-home="${game.home}" data-week="${game.week}" title="Click for the game-by-game breakdown">
    <table class="data-table resume-table">
      <thead>
        <tr><th class="resume-caption">W-L vs. pregame spread</th><th class="resume-hdr-q">Quality</th><th class="resume-hdr-n">Neutral</th><th class="resume-hdr-b">Bad</th><th>SU</th><th>ATS</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <span class="resume-more">Game-by-game &rsaquo;</span>
  </button>`;
}

function fmtSpreadLine(n) {
  if (n === null || n === undefined) return "--";
  if (n === 0) return "PK";
  const v = Number.isInteger(n) ? n : n.toFixed(1);
  return n > 0 ? `+${v}` : `${v}`;
}

function renderResumeTeamLog(team, beforeWeek) {
  const games = resumeGamesFor(team, beforeWeek);
  const heading = `<h4 class="resume-log-heading">${teamLogoMini(team, 22)} ${TEAM_NAMES[team] || team} <span class="muted-label">(${teamCurrentRecord(team)})</span></h4>`;
  if (!games.length) return `${heading}<p class="no-data-note">No completed games before this week.</p>`;
  const rows = games
    .map((g) => {
      const atsCls = g.ats === null ? "" : g.ats > 0 ? "resume-ats-cover" : g.ats < 0 ? "resume-ats-miss" : "";
      const atsText = g.ats === null ? "--" : g.ats === 0 ? "Push" : fmtSpreadLine(g.ats);
      return `<tr>
        <td class="num">${g.week}</td>
        <td class="resume-opp">${g.isHome ? "vs" : "@"} ${teamLogoMini(g.opp, 16)} ${g.opp} <span class="muted-label">(${teamCurrentRecord(g.opp)})</span></td>
        <td class="num">${fmtSpreadLine(g.spread)}</td>
        <td class="num">${g.margin > 0 ? "W" : g.margin < 0 ? "L" : "T"} ${g.pf}-${g.pa}</td>
        <td class="num ${atsCls}">${atsText}</td>
        <td><span class="resume-chip resume-chip-${g.label}">${RESUME_LABELS[g.label]}</span></td>
      </tr>`;
    })
    .join("");
  return `${heading}
    <table class="data-table resume-log-table">
      <thead><tr><th>Wk</th><th>Opponent (current record)</th><th>Line</th><th>Result</th><th>vs. Spread</th><th>Label</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function ensureResumeModal() {
  if (document.getElementById("resume-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "resume-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="resume-modal-content"></div>
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

function openResumeModal(away, home, week) {
  ensureResumeModal();
  document.getElementById("resume-modal-content").innerHTML = `
    <h3>${TEAM_NAMES[away] || away} @ ${TEAM_NAMES[home] || home} &mdash; Wins &amp; Losses</h3>
    <p class="no-data-note">Each result graded against its pregame spread (Line = that team's own number, + = underdog). <b>Quality Win</b>: won as a 3+ pt underdog. <b>Bad Loss</b>: lost as a 3+ pt favorite. <b>Quality Loss</b>: lost as an underdog but covered. <b>Bad Win</b>: won as a favorite but missed the spread by 7+. Everything else, including games within 2.5 pts, is <b>Neutral</b>. Opponent records are current, for hindsight.</p>
    <div class="resume-log-cols">
      <div>${renderResumeTeamLog(away, week)}</div>
      <div>${renderResumeTeamLog(home, week)}</div>
    </div>`;
  document.getElementById("resume-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const chart = e.target.closest(".resume-chart");
  if (chart) openResumeModal(chart.dataset.away, chart.dataset.home, Number(chart.dataset.week));
});

// One number per side (not the Total/Per-Game pair headerRow() expects),
// so this gets its own compact header instead of reusing that function.
function pairedStatHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th class="per-game-hdr">PER GAME</th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${teamLogoMini(offTeam, 20)}</span> <span class="pair-hdr-sub">OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${teamLogoMini(defTeam, 20)}</span> <span class="pair-hdr-sub">DEF</span></th><th class="edge-hdr">ADV</th></tr>`;
}

// Each row pairs an offense stat with its defense mirror, framed as a
// matchup: offTeam's own number vs defTeam's own "allowed" number on the
// same stat -- e.g. "Sacks" shows offTeam's own sacks-allowed rate next to
// defTeam's own sacks-made rate. Call twice (away-vs-home, home-vs-away)
// for the two side-by-side tables.
function renderGeneralStatsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  // Whole numbers by default (points, yards, plays, sacks, turnovers --
  // none of these need decimal precision to be readable) -- a row with a
  // genuinely fractional rate (EPA/Play, Yards/Carry) sets its own digits
  // to opt back in, same convention openStatRankModal already uses.
  const format = (v, r) => (v === null || v === undefined ? "--" : r.pct ? `${Math.round(v * 100)}%` : fmt(v, r.digits ?? 0));
  const groups = GENERAL_STAT_GROUPS.map((group) => {
    const rows = group.rows
      .map((r) => {
        // Composite rows (currently just Red Zone) show a letter grade
        // instead of a raw percent/number -- same compositeZ/gradeForZ
        // machinery Team Grades uses, and the SAME cat object (see
        // RED_ZONE_CATEGORY), so this row's grade and Team Grades' Red
        // Zone grade always agree, and clicking either opens the
        // identical Trips/TDs/FGs/Avg Points modal.
        if (r.composite) {
          const cat = r.composite;
          const offZ = compositeZ(cat.off, offTeam);
          const defZ = compositeZ(cat.def, defTeam);
          const offGrade = gradeForZ(offZ);
          const defGrade = gradeForZ(defZ);
          const offEntry = encodeDataAttr({ cat, side: "off", team: offTeam });
          const defEntry = encodeDataAttr({ cat, side: "def", team: defTeam });
          return `<tr><td>${r.label}</td><td class="num grade-cell grade-rank-click ${gradeClass(offGrade)}" data-entry="${offEntry}"${gradeAlphaAttr(offGrade)}>${offGrade || "--"}</td><td class="num grade-cell grade-rank-click ${gradeClass(defGrade)}" data-entry="${defEntry}"${gradeAlphaAttr(defGrade)}>${defGrade || "--"}</td>${summaryAdvCell(offZ, defZ, offTeam, defTeam)}</tr>`;
        }
        const offCls = tierFor(r.offKey, offTeam, r.offInvert);
        const defCls = tierFor(r.defKey, defTeam, r.defInvert);
        const offExtreme = tierFor(r.offKey, offTeam, r.offInvert, TIER_Z_EXTREME_THRESHOLD);
        const defExtreme = tierFor(r.defKey, defTeam, r.defInvert, TIER_Z_EXTREME_THRESHOLD);
        const offA = tierForAlphaAttr(r.offKey, offTeam, r.offInvert);
        const defA = tierForAlphaAttr(r.defKey, defTeam, r.defInvert);
        const labelHtml = r.note ? `${r.label}<br><span class="muted-label">${r.note}</span>` : r.label;
        const offCell = numCell(format(off[r.offKey], r), offCls, offA, { team: offTeam, statKey: r.offKey, label: r.label, invert: r.offInvert, percent: !!r.pct, digits: r.digits });
        const defCell = numCell(format(def[r.defKey], r), defCls, defA, { team: defTeam, statKey: r.defKey, label: `${r.label} Allowed`, invert: r.defInvert, percent: !!r.pct, digits: r.digits });
        return `<tr><td>${labelHtml}</td>${offCell}${defCell}${edgeCell(offCls, defCls, offTeam, defTeam, offExtreme, defExtreme)}</tr>`;
      })
      .join("");
    return `<tr class="group-gap"><td colspan="4"></td></tr><tr><td class="section-group-label" colspan="4">${group.label}</td></tr>${rows}`;
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
  // Box count/blitz/pressure (FTN charting + plain pbp) and snap share
  // (PFR via nflverse) are all live, current-season data now -- see
  // build_stats.py's compute_scheme_splits/compute_player_snap_shares.
  // No participation-fallback note needed here anymore.
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
  return `<tr><th></th><th style="${offStyle}"><span class="pair-hdr team-click" data-team="${offTeam}">${teamLogoMini(offTeam, 20)}</span> <span class="pair-hdr-sub">OFF</span></th><th style="${defStyle}"><span class="pair-hdr team-click" data-team="${defTeam}">${teamLogoMini(defTeam, 20)}</span> <span class="pair-hdr-sub">DEF</span></th><th class="freq-hdr"></th><th class="edge-hdr">ADV</th></tr>`;
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
// ADV for a scheme row: only when this defense shows the look a lot, and
// judged on BOTH sides of it (matchupCall) -- the offense's result against
// the look and the defense's own result when it shows it.
function schemeEdgeCell(r, tendVal, offTeam, defTeam) {
  if (tendVal === null || tendVal === undefined || tendVal < SCHEME_ADV_MIN_TENDENCY) {
    return `<td class="edge-cell">--</td>`;
  }
  const pool = teamsWithGames();
  const z = (key, team) => zScore(tierValue(team, key), pool.map((t) => tierValue(t, key)), false);
  const call = matchupCall(z(r.perfKey, offTeam), z(r.defSuccessKey, defTeam));
  if (!call.dir) return `<td class="edge-cell">--</td>`;
  const team = call.dir > 0 ? offTeam : defTeam;
  const rgb = teamAccentRgb(team);
  return `<td class="edge-cell edge-hit" style="background:rgba(${rgb.join(",")},0.14)">${teamLogoMini(team)}</td>`;
}

// Just the tiered percentage now -- the bar chart this used to also draw
// said the same thing a second time in a less legible form ("is it a lot
// or a little" was already answered by the color), so it's gone. Tiered
// against the league same as everywhere else on the site: an unusually
// extreme tendency is worth flagging visually even though raw frequency
// alone isn't inherently good or bad.
function tendencyCell(r, defTeam) {
  const tendVal = DATA.team_stats[defTeam][r.tendKey];
  if (tendVal === null || tendVal === undefined) return { html: `<td class="num">--</td>`, tendVal: null, freqCls: "" };
  const invert = !!r.tendInvert;
  const tendCls = tierFor(r.tendKey, defTeam, invert);
  const tendA = tierForAlphaAttr(r.tendKey, defTeam, invert);
  // schemeEdgeCell's "is this look common enough to matter" check needs
  // the plain high-frequency reading regardless of which direction THIS
  // row colors as good/bad for the defense (tendInvert) -- a tendInvert
  // row still counts as "common" when the raw number is high, not when
  // its (flipped) display color happens to land on tier-good.
  const freqCls = invert ? tierFor(r.tendKey, defTeam, false) : tendCls;
  const payload = { team: defTeam, statKey: r.tendKey, label: `${r.label} Tendency`, invert, percent: true, noPair: true };
  const html = numCell(`${Math.round(tendVal * 100)}%`, tendCls, tendA, payload);
  return { html, tendVal, freqCls };
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
  return numCell(display, cls, a, { team: defTeam, statKey: r.defSuccessKey, label: group.inlineUnit ? `${r.label} ${group.inlineUnit} Allowed` : `${r.label} Success Allowed`, invert: true, percent: !!group.pct, digits: group.pct ? undefined : 2 });
}

function renderSchemeGroup(group, offTeam, defTeam) {
  let orderedRows = group.rows;
  // sortFrom: N keeps the first N rows in their written order (e.g.
  // Zone/Man, which shouldn't reshuffle) and sorts only the rest by this
  // defense's own usage -- lets one group mix a fixed-order lead-in with
  // a frequency-sorted tail instead of needing two separate group headers.
  if (group.sortFrom !== undefined) {
    const fixed = group.rows.slice(0, group.sortFrom);
    const sortable = [...group.rows.slice(group.sortFrom)].sort((a, b) => {
      const av = DATA.team_stats[defTeam][a.tendKey];
      const bv = DATA.team_stats[defTeam][b.tendKey];
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });
    orderedRows = [...fixed, ...sortable];
  }
  const rows = orderedRows
    .map((r, idx) => {
      const perfVal = DATA.team_stats[offTeam][r.perfKey];
      const { html: tendHtml, tendVal, freqCls } = tendencyCell(r, defTeam);
      const perfCls = perfVal === null || perfVal === undefined ? "" : tierFor(r.perfKey, offTeam, false);
      const perfA = perfVal === null || perfVal === undefined ? "" : tierForAlphaAttr(r.perfKey, offTeam, false);
      const perfUnit = group.inlineUnit ? ` ${group.inlineUnit}` : "";
      const perfDisplay =
        perfVal === null || perfVal === undefined ? "--" : group.pct ? `${Math.round(perfVal * 100)}%` : `${fmt(perfVal, 2)}${perfUnit}`;
      const dim = tendVal !== null && tendVal !== undefined && tendVal < SCHEME_MIN_TENDENCY_SHOWN;
      const perfCell =
        perfVal === null || perfVal === undefined
          ? `<td class="num">--</td>`
          : numCell(perfDisplay, perfCls, perfA, { team: offTeam, statKey: r.perfKey, label: group.inlineUnit ? `${r.label} ${group.inlineUnit}` : `${r.label} Success`, invert: false, percent: !!group.pct, digits: group.pct ? undefined : 2 });
      // Thin border under the last fixed-order row (e.g. "Man") -- visually
      // separates Zone/Man (coverage STYLE) from the specific shells sorted
      // in below them (coverage SCHEME), even though they share one group.
      const styleBoundary = group.sortFrom !== undefined && idx === group.sortFrom - 1;
      const rowCls = [dim ? "scheme-row-dim" : "", styleBoundary ? "scheme-style-boundary" : ""].filter(Boolean).join(" ");
      return `<tr${rowCls ? ` class="${rowCls}"` : ""}><td>${r.label}</td>${perfCell}${defSuccessCell(group, r, defTeam)}${tendHtml}${schemeEdgeCell(r, tendVal, offTeam, defTeam)}</tr>`;
    })
    .join("");
  const perfCaption = group.inlineUnit ? "" : group.perfLabel;
  return `<tr class="group-gap"><td colspan="5"></td></tr><tr class="group-row"><td colspan="5"><span class="group-row-label">${group.label}</span>${perfCaption ? `<span class="group-row-caption">${perfCaption}</span>` : ""}</td></tr>${rows}`;
}

// Header bar for one matchup box in General Stats & Scheme: this team's
// offense against the other team's defense, in the offense's colors.
function matchupPanelHead(offTeam, defTeam) {
  const rgb = teamAccentRgb(offTeam).join(",");
  return `<div class="gen-panel-head" style="background:rgba(${rgb},0.22);border-left:4px solid rgb(${rgb})">
    ${teamLogoMini(offTeam, 26)}<span class="gen-panel-team">${TEAM_NAMES[offTeam] || offTeam}</span><span class="gen-panel-side">Offense</span>
    <span class="gen-panel-vs">vs</span>
    ${teamLogoMini(defTeam, 22)}<span class="gen-panel-opp">${defTeam} Defense</span>
  </div>`;
}

function renderSchemeTable(offTeam, defTeam) {
  const groups = SCHEME_GROUPS.map((g) => renderSchemeGroup(g, offTeam, defTeam)).join("");
  return `<table class="data-table scheme-table">
    <thead>${schemeTableHeader(offTeam, defTeam)}</thead>
    <tbody>${groups}</tbody>
  </table>`;
}

function renderRecentGamesPanel(team) {
  // Oldest first (Week 1 at the top), each game with the closing spread and
  // total from the schedule file plus how it landed against both.
  const games = (DATA.recent_games[team] || []).slice().sort((a, b) => a.week - b.week);
  if (games.length === 0) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No games played yet this season.</p>`;
  }
  const schedById = {};
  (DATA.schedule || []).forEach((g) => (schedById[g.game_id] = g));
  const chip = (text, cls) => `<td class="num ${cls}">${text}</td>`;
  const rows = games
    .map((g) => {
      const isAway = g.home_away === "away";
      const oppLabel = `<span class="rg-opp">${isAway ? "@" : "vs"} ${teamLogoMini(g.opponent, 20)} ${g.opponent}</span>`;
      const resultCls = g.result === "W" ? "tier-good" : g.result === "L" ? "tier-bad" : "tier-mid";
      const halfLabel = g.ht_for === null || g.ht_against === null ? "--" : `${g.ht_for}-${g.ht_against}`;
      const away = isAway ? team : g.opponent;
      const home = isAway ? g.opponent : team;
      const payload = { gameId: g.game_id, away, home };
      const sched = schedById[g.game_id] || {};
      const spread = isAway ? sched.away_team_spread : sched.home_team_spread;
      const total = sched.total_line;
      const margin = g.final_for - g.final_against;
      const points = g.final_for + g.final_against;
      let spreadTd = `<td class="num">--</td>`;
      let atsTd = `<td class="num">--</td>`;
      if (spread !== null && spread !== undefined) {
        spreadTd = `<td class="num">${spread > 0 ? "+" : ""}${fmt(spread, 1)}</td>`;
        const ats = margin + spread;
        atsTd = ats > 0 ? chip("Covered", "tier-good") : ats < 0 ? chip("Missed", "tier-bad") : chip("Push", "tier-mid");
      }
      let totalTd = `<td class="num">--</td>`;
      let ouTd = `<td class="num">--</td>`;
      if (total !== null && total !== undefined) {
        totalTd = `<td class="num">${fmt(total, 1)}</td>`;
        ouTd = points > total ? chip("Over", "rg-over") : points < total ? chip("Under", "rg-under") : chip("Push", "tier-mid");
      }
      return `<tr class="recent-game-row" data-entry="${encodeDataAttr(payload)}"><td class="num">${g.week}</td><td>${oppLabel}</td><td class="num">${halfLabel}</td><td class="num">${g.final_for}-${g.final_against}</td><td class="num ${resultCls}">${g.result}</td>${spreadTd}${atsTd}${totalTd}${ouTd}</tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table recent-games-table">
      <thead><tr><th>Wk</th><th>Opp</th><th>Half</th><th>Final</th><th>W/L</th><th>Spread</th><th>ATS</th><th>Total</th><th>O/U</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Box score modal (click any Recent Games row) ----
// build_stats.py's compute_player_box_scores: full Passing/Rushing/
// Receiving/Defense stat lines for both teams in one specific game,
// toggled between away/home rather than shown side by side (a real box
// score is dense enough per team that both at once would be unreadable
// at this page's column widths).
function boxScoreTable(title, headers, rows, rowFn) {
  if (!rows || !rows.length) return "";
  const headHtml = headers.map((h) => `<th${h === "Player" ? "" : ' class="num"'}>${h}</th>`).join("");
  return `<table class="data-table box-score-table">
    <thead><tr><th colspan="${headers.length}" class="box-score-cat-hdr">${title}</th></tr><tr>${headHtml}</tr></thead>
    <tbody>${rows.map(rowFn).join("")}</tbody>
  </table>`;
}

function renderBoxScoreTeamContent(gameId, team) {
  const cats = ((DATA.player_box_scores || {})[gameId] || {})[team] || {};
  const tables = [
    boxScoreTable("Passing", ["Player", "C/ATT", "Yds", "TD", "INT"], cats.passing, (p) =>
      `<tr><td>${playerClick(team, p.name)}</td><td class="num">${p.cmp}/${p.att}</td><td class="num">${fmt(p.yards, 0)}</td><td class="num">${p.td}</td><td class="num">${p.int}</td></tr>`),
    boxScoreTable("Rushing", ["Player", "Car", "Yds", "TD"], cats.rushing, (p) =>
      `<tr><td>${playerClick(team, p.name)}</td><td class="num">${p.carries}</td><td class="num">${fmt(p.yards, 0)}</td><td class="num">${p.td}</td></tr>`),
    boxScoreTable("Receiving", ["Player", "Tgt", "Rec", "Yds", "TD"], cats.receiving, (p) =>
      `<tr><td>${playerClick(team, p.name)}</td><td class="num">${p.targets}</td><td class="num">${p.receptions}</td><td class="num">${fmt(p.yards, 0)}</td><td class="num">${p.td}</td></tr>`),
    // Tkl shown as "solo-assist" (e.g. "6-2"), same convention a
    // broadcast box score uses -- see compute_player_box_scores for
    // exactly what counts as solo vs assist.
    boxScoreTable("Defense", ["Player", "Tkl", "Sck", "TFL", "QBH", "INT", "FR"], cats.defense, (p) =>
      `<tr><td>${p.name}</td><td class="num">${p.solo}-${p.assist}</td><td class="num">${p.sacks}</td><td class="num">${p.tfl}</td><td class="num">${p.qb_hits}</td><td class="num">${p.int}</td><td class="num">${p.fumble_rec}</td></tr>`),
  ]
    .filter(Boolean)
    .join("");
  return tables ? `<div class="box-score-grid">${tables}</div>` : `<p class="no-data-note">No box score data for this team.</p>`;
}

function ensureBoxScoreModal() {
  if (document.getElementById("box-score-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "box-score-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box box-score-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="box-score-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBoxScoreModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeBoxScoreModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBoxScoreModal();
  });
}

function closeBoxScoreModal() {
  const el = document.getElementById("box-score-modal");
  if (el) el.hidden = true;
}

let boxScoreState = null;

function renderBoxScoreModal() {
  if (!boxScoreState) return;
  const { gameId, away, home, activeTeam } = boxScoreState;
  const teamBtn = (t) => `<button type="button" class="box-score-team-btn${t === activeTeam ? " active" : ""}" data-team="${t}">${TEAM_NAMES[t] || t}</button>`;
  document.getElementById("box-score-modal-content").innerHTML = `
    <h3>Box Score</h3>
    <div class="box-score-team-toggle">${teamBtn(away)}${teamBtn(home)}</div>
    ${renderBoxScoreTeamContent(gameId, activeTeam)}
  `;
  document.querySelectorAll(".box-score-team-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      boxScoreState.activeTeam = btn.dataset.team;
      renderBoxScoreModal();
    });
  });
}

function openBoxScoreModal(gameId, away, home) {
  ensureBoxScoreModal();
  boxScoreState = { gameId, away, home, activeTeam: away };
  renderBoxScoreModal();
  document.getElementById("box-score-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const row = e.target.closest(".recent-game-row");
  if (!row) return;
  const { gameId, away, home } = decodeDataAttr(row.dataset.entry);
  openBoxScoreModal(gameId, away, home);
});

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

// Season-long snap share (build_stats.py's compute_player_snap_shares --
// share of the team's own offensive/defensive plays this player was on
// the field for, works for every position including the O/D-line since
// it's just presence, not a stat) -- tells you whether an injury is to a
// real every-down piece or a deep backup/special-teamer. Unknown (name
// didn't resolve against pbp) shows no tag at all rather than guessing.
const INJURY_STARTER_SNAP_SHARE = 0.4;
function starterTag(snapShare) {
  if (snapShare === null || snapShare === undefined) return "";
  const isStarter = snapShare >= INJURY_STARTER_SNAP_SHARE;
  const cls = isStarter ? "injury-starter-tag-starter" : "injury-starter-tag-depth";
  const label = isStarter ? "Starter" : "Depth";
  return `<span class="injury-starter-tag ${cls}" title="${Math.round(snapShare * 100)}% of offensive/defensive snaps this season">${label}</span>`;
}

function renderInjuryPanel(team, week) {
  const byWeek = DATA.injuries[team] || {};
  let list = byWeek[String(week)] || [];
  let note = "";
  // Early in the week (before Wednesday's first practice report) this
  // week's report is empty -- show the team's most recent earlier report,
  // labeled, instead of a blank panel.
  if (list.length === 0) {
    const prior = Object.keys(byWeek)
      .map(Number)
      .filter((w) => w < week && (byWeek[String(w)] || []).length)
      .sort((a, b) => b - a)[0];
    if (prior === undefined) {
      return `<h3>${team}</h3><p class="no-data-note">No one listed on the injury report.</p>`;
    }
    list = byWeek[String(prior)];
    note = `<p class="no-data-note injury-fallback-note">No Week ${week} report yet (first one posts Wednesday afternoon). Showing the Week ${prior} final report.</p>`;
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
        .map((p) => `<span class="injury-badge ${statusClass(p.status)}">${SKILL_POSITIONS.has(p.position) ? playerClick(team, p.full_name) : p.full_name} (${p.position}) &mdash; ${statusAbbr(p.status)} ${starterTag(p.snap_share)}</span>`)
        .join("");
      return `<div class="injury-group"><span class="injury-group-label">${groupLabel[g]}</span><div class="injury-badges">${badges}</div></div>`;
    })
    .join("");
  return `<h3>${team}</h3>${note}${sections}`;
}

// ---- pick tracker ----
// Pick tracking wants what a bet placed on Novig itself actually pays, not
// the best price found across every book (that's what the Odds bar/general
// handicapping numbers above still show) -- game.novig carries Novig's own
// line+price per market when build_stats.py's extract_novig_game_lines
// found one. Falls back to the top-level (best-of-books) field per KEY,
// not per market, since Novig can post one side of a market without the
// other (e.g. a spread side pulled for liquidity).
function pv(game, key) {
  const v = game.novig?.[key];
  return v !== undefined && v !== null ? v : game[key];
}

function marketSides(game, market) {
  if (market === "spread") {
    const awaySpread = pv(game, "away_team_spread");
    const homeSpread = pv(game, "home_team_spread");
    return [
      { side: "away", label: `${game.away} ${fmtSigned(awaySpread)}`, line: awaySpread, odds: pv(game, "away_spread_odds"), available: awaySpread !== null },
      { side: "home", label: `${game.home} ${fmtSigned(homeSpread)}`, line: homeSpread, odds: pv(game, "home_spread_odds"), available: homeSpread !== null },
    ];
  }
  if (market === "total") {
    const totalLine = pv(game, "total_line");
    return [
      { side: "over", label: `Over ${fmt(totalLine, 1)}`, line: totalLine, odds: pv(game, "over_odds"), available: totalLine !== null },
      { side: "under", label: `Under ${fmt(totalLine, 1)}`, line: totalLine, odds: pv(game, "under_odds"), available: totalLine !== null },
    ];
  }
  const awayMl = pv(game, "away_moneyline");
  const homeMl = pv(game, "home_moneyline");
  return [
    { side: "away", label: `${game.away} ${showOdds(awayMl)}`, line: null, odds: awayMl, available: awayMl !== null },
    { side: "home", label: `${game.home} ${showOdds(homeMl)}`, line: null, odds: homeMl, available: homeMl !== null },
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
      <span class="pick-badge pick-color-${existing.color}">${pickLabel(game, market.key, existing)} &middot; ${colorInfo ? colorInfo.label : existing.color}</span>
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
// Full label, colored in the same green/yellow/red the pick-color picker
// itself uses (tier-good/mid/bad) -- header wraps within its column's
// fixed width rather than forcing the table wide (abbreviations read as
// meaningless on their own, so the header carries the confidence-level
// meaning through color instead of through a shortened label).
const COLOR_LABELS = { green: "Good Play", yellow: "Lean", red: "No Confidence" };
const COLOR_HEADER_CLASS = { green: "tier-good", yellow: "tier-mid", red: "tier-bad" };

// Units assume a flat 1u stake on every pick at its real frozen price
// (Novig's when it had one) -- see picks.js' unitsForPick. Win% dropped
// from display entirely -- see unitsStyle() below for why it's also no
// longer what colors the cell.
function matrixCellText(t) {
  const unitsStr = `${t.units >= 0 ? "+" : ""}${t.units.toFixed(2)}u`;
  return `${t.win}-${t.loss}-${t.push}<br>(${unitsStr})`;
}

// Colors the cell by REAL PROFIT, not win%. A moneyline column especially
// can go .500 and still be a loser (laying big favorites) or a big winner
// (hitting live dogs) -- win% alone read as neutral either way, which
// hid exactly the signal this table exists to show. Straight 2-color
// gradient centered on 0u: green above it, red below it, white at exactly
// breakeven, saturating fully by UNITS_SATURATE so one huge outlier
// column doesn't wash out the color range for every other cell.
const UNITS_SATURATE = 3;
function unitsStyle(units) {
  if (!units) return { cls: "", attr: "" };
  const cls = units > 0 ? "tier-good" : "tier-bad";
  const t = Math.min(Math.abs(units) / UNITS_SATURATE, 1);
  const alpha = TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * t;
  return { cls, attr: ` style="--tier-a:${alpha.toFixed(2)}"` };
}

function renderPickMatrix(picks) {
  const m = pickMatrix(picks);
  if (picks.length === 0) return "";
  const cellTd = (t, extraCls = "") => {
    const { cls, attr } = unitsStyle(t.units);
    return `<td class="${[extraCls, cls].filter(Boolean).join(" ")}"${attr}>${matrixCellText(t)}</td>`;
  };
  const header = `<tr><th></th>${m.colors.map((c) => `<th class="${COLOR_HEADER_CLASS[c]}">${COLOR_LABELS[c]}</th>`).join("")}<th class="matrix-total-col">Total</th></tr>`;
  const rows = m.rows
    .map((r) => `<tr><td>${MARKET_LABELS[r.market]}</td>${r.cells.map((c) => cellTd(c)).join("")}${cellTd(r.total, "matrix-total-col")}</tr>`)
    .join("");
  const totalRow = `<tr class="matrix-total-row"><td>Total</td>${m.colTotals.map((c) => cellTd(c)).join("")}${cellTd(m.grandTotal, "matrix-total-col")}</tr>`;
  return `<table class="data-table pick-matrix-table">
    <thead>${header}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;
}

// Week filter for Your Record: checkbox chips (All weeks + one per week that
// has picks). Nothing checked = all weeks. The choice is a per-device view
// preference, so it lives in localStorage only (not synced to the profile).
const PICK_WEEKS_KEY = "nfl-tool.picks.weekFilter";
function loadPickWeekFilter() {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_WEEKS_KEY));
    return Array.isArray(v) ? v.map(Number) : [];
  } catch (e) {
    return [];
  }
}
function savePickWeekFilter(weeks) {
  try {
    localStorage.setItem(PICK_WEEKS_KEY, JSON.stringify(weeks));
  } catch (e) {
    // View preference only -- fine if it doesn't persist.
  }
}
function pickWeek(pick, gamesById) {
  return pick.week ?? gamesById[pick.game_id]?.week ?? null;
}
function renderPickWeekFilter(weeks, selected, shownCount) {
  if (!weeks.length) return "";
  const chip = (value, label, checked) =>
    `<label class="wk-chip"><input type="checkbox" data-week="${value}"${checked ? " checked" : ""}>${label}</label>`;
  const showing = selected.length ? selected.map((w) => `Wk ${w}`).join(" + ") : "All weeks";
  return `<div class="pick-week-filter">
      ${chip("all", "All weeks", !selected.length)}
      ${weeks.map((w) => chip(w, `Wk ${w}`, selected.includes(w))).join("")}
    </div>
    <p class="pick-week-showing">Showing ${showing} &middot; ${shownCount} pick${shownCount === 1 ? "" : "s"}</p>`;
}
document.addEventListener("change", (e) => {
  const box = e.target.closest(".pick-week-filter input[type=checkbox]");
  if (!box) return;
  if (box.dataset.week === "all") {
    savePickWeekFilter([]);
  } else {
    const week = Number(box.dataset.week);
    const current = new Set(loadPickWeekFilter());
    if (box.checked) current.add(week);
    else current.delete(week);
    savePickWeekFilter([...current].sort((a, b) => a - b));
  }
  renderPickSummary();
});

function renderPickSummary() {
  const allPicks = regradeAllPicks(DATA.schedule);
  const gamesById = Object.fromEntries((DATA.schedule || []).map((g) => [g.game_id, g]));
  const weeks = [...new Set(allPicks.map((p) => pickWeek(p, gamesById)).filter((w) => w != null))].sort((a, b) => a - b);
  // Drop saved weeks that no longer have picks; none left = all weeks.
  const selected = loadPickWeekFilter().filter((w) => weeks.includes(w));
  const picks = selected.length ? allPicks.filter((p) => selected.includes(pickWeek(p, gamesById))) : allPicks;
  const recent = allPicks
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8)
    .map(
      (p) =>
        `<div class="pick-recent-row"><span class="pick-color-dot pick-color-${p.color}"></span><span>${p.away} @ ${p.home} &mdash; ${p.market} ${p.side}</span><span>${p.graded ? p.graded.toUpperCase() : "Pending"}</span></div>`
    )
    .join("");
  document.getElementById("picks-record").innerHTML = `
    <h3>Your Record</h3>
    ${renderPickWeekFilter(weeks, selected, picks.length)}
    ${picks.length ? `<p class="no-data-note">Units assume 1u per pick at the price saved when you made it (Novig's price when it had one).</p>` : ""}
    ${renderPickMatrix(picks) || `<p class="no-data-note">No picks saved yet.</p>`}
  `;
  document.getElementById("picks-recent").innerHTML = `
    <h3>Recent Picks</h3>
    ${recent || `<p class="no-data-note">No picks saved yet.</p>`}
  `;
}

// ---- Pick reveal modal (on-stream "flare" after Save Picks) ----
function ensurePickRevealModal() {
  if (document.getElementById("pick-reveal-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "pick-reveal-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="pick-reveal-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePickRevealModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePickRevealModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePickRevealModal();
  });
}

function closePickRevealModal() {
  const el = document.getElementById("pick-reveal-modal");
  if (el) el.hidden = true;
}

function renderPickRevealContent(game) {
  const heading = `<h3>${TEAM_NAMES[game.away] || game.away} @ ${TEAM_NAMES[game.home] || game.home}</h3>`;
  const sections = MARKETS.map((m) => {
    const pick = getPick(game.game_id, m.key);
    if (!pick) return "";
    const sideInfo = marketSides(game, m.key).find((s) => s.side === pick.side);
    const ppId = `${game.game_id}_${m.key}_${pick.side}`;
    const star = isPossiblePlay(ppId) ? `<span class="reveal-star" title="Possible Play">&#9733;</span>` : "";
    const visual =
      m.key === "total"
        ? `<div class="reveal-big-text">${pick.side.toUpperCase()}</div>`
        : `<img src="${teamLogoUrl(pick.side === "home" ? game.home : game.away)}" class="reveal-team-logo" alt="">`;
    // Moneyline's own label already embeds the price (see marketSides) --
    // spread/total's don't, so those get it appended separately.
    const numberText =
      m.key === "moneyline"
        ? pickLabel(game, m.key, pick)
        : `${pickLabel(game, m.key, pick)}${pick.odds_at_pick !== null && pick.odds_at_pick !== undefined ? ` (${showOdds(pick.odds_at_pick)})` : ""}`;
    return `<div class="reveal-section pick-color-${pick.color}">
      ${star}
      <div class="reveal-market-label">${MARKET_LABELS[m.key]}</div>
      ${visual}
      <div class="reveal-number">${numberText}</div>
    </div>`;
  })
    .filter(Boolean)
    .join("");
  if (!sections) return `${heading}<p class="no-data-note">No picks saved for this game yet.</p>`;
  return `${heading}<div class="reveal-grid">${sections}</div>
    <p class="pikkit-reminder">Novig likely has the best price. Always line shop with Pikkit. Prices are estimates.</p>`;
}

function openPickRevealModal(game) {
  ensurePickRevealModal();
  document.getElementById("pick-reveal-modal-content").innerHTML = renderPickRevealContent(game);
  document.getElementById("pick-reveal-modal").hidden = false;
}

// A saved pick reads as the line and price it was MADE at, never today's
// number -- the badge used to show the current line, so a pick taken at
// SF +3.5 read "SF -4.5" once the line moved (user 2026-10-11).
function pickLabel(game, market, pick) {
  const current = marketSides(game, market).find((s) => s.side === pick.side);
  const team = pick.side === "home" ? game.home : game.away;
  if (market === "spread" && pick.line_at_pick !== null && pick.line_at_pick !== undefined) return `${team} ${fmtSigned(pick.line_at_pick)}`;
  if (market === "total" && pick.line_at_pick !== null && pick.line_at_pick !== undefined) return `${pick.side === "over" ? "Over" : "Under"} ${fmt(pick.line_at_pick, 1)}`;
  if (market === "moneyline" && pick.odds_at_pick !== null && pick.odds_at_pick !== undefined) return `${team} ${showOdds(pick.odds_at_pick)}`;
  return current ? current.label : pick.side;
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
        openPickRevealModal(game);
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
  const flipperEls = document.querySelectorAll(".game-flipper");
  const headerEl = document.getElementById("game-header");

  const game = currentGame();
  if (!game) {
    sectionEls.forEach((el) => (el.hidden = true));
    flipperEls.forEach((el) => (el.hidden = true));
    headerEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>No games scheduled for this week.</p>";
    applyPreviewView(null);
    return;
  }

  renderGameHeader(game);
  // Bottom flipper (under Recent Picks) mirrors the top one 1:1 -- same
  // class-based selectors so both stay in sync from one update instead of
  // needing every render/prev/next path to remember two separate ids.
  flipperEls.forEach((el) => (el.hidden = false));
  document.querySelectorAll(".game-flipper-label").forEach((el) => {
    el.textContent = `Game ${currentGameIndex + 1} of ${weekGames.length}`;
  });
  document.querySelectorAll(".game-prev-btn").forEach((el) => (el.disabled = currentGameIndex <= 0));
  document.querySelectorAll(".game-next-btn").forEach((el) => (el.disabled = currentGameIndex >= weekGames.length - 1));
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
    applyPreviewView(null);
    return;
  }
  emptyEl.hidden = true;
  sectionEls.forEach((el) => (el.hidden = false));

  document.getElementById("col-away-injuries").innerHTML = renderInjuryPanel(away, game.week);
  document.getElementById("col-home-injuries").innerHTML = renderInjuryPanel(home, game.week);
  document.getElementById("odds-content").innerHTML = renderOddsBar(game);
  document.getElementById("resume-content").innerHTML = renderResumeChart(game);
  document.getElementById("col-away-matchup-head").innerHTML = matchupPanelHead(away, home);
  document.getElementById("col-home-matchup-head").innerHTML = matchupPanelHead(home, away);
  document.getElementById("col-away-general").innerHTML = renderGeneralStatsTable(away, home);
  document.getElementById("col-home-general").innerHTML = renderGeneralStatsTable(home, away);
  document.getElementById("scheme-notes").innerHTML = renderSchemeNotes(away, home);
  document.getElementById("col-away-scheme").innerHTML = renderSchemeTable(away, home);
  document.getElementById("col-home-scheme").innerHTML = renderSchemeTable(home, away);
  document.getElementById("col-away-recent").innerHTML = renderRecentGamesPanel(away);
  document.getElementById("col-home-recent").innerHTML = renderRecentGamesPanel(home);
  document.getElementById("col-away-trenches").innerHTML = renderTrenchesTable(away, home);
  document.getElementById("col-home-trenches").innerHTML = renderTrenchesTable(home, away);
  document.getElementById("col-away-summary").innerHTML = renderSummaryTable(away, home);
  document.getElementById("col-home-summary").innerHTML = renderSummaryTable(home, away);

  const notesEl = document.getElementById("game-notes");
  notesEl.value = loadGameNotes()[game.game_id] || "";
  notesEl.dataset.gameId = game.game_id;

  renderPickTracker(game);
  applyPreviewView(game);
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

  // Same handler on both the top flipper and the bottom one (under Recent
  // Picks) -- querySelectorAll instead of one id lookup since there are now
  // two of these buttons in the DOM, both static (never re-created via
  // innerHTML), so attaching once here at init is safe for both.
  document.querySelectorAll(".game-prev-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentGameIndex > 0) {
        currentGameIndex--;
        resetDraftPicks();
        render();
        saveSelectedGame(scheduleWeek, currentGame().away, currentGame().home);
      }
    });
  });
  document.querySelectorAll(".game-next-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (currentGameIndex < weekGames.length - 1) {
        currentGameIndex++;
        resetDraftPicks();
        render();
        saveSelectedGame(scheduleWeek, currentGame().away, currentGame().home);
      }
    });
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
    initStatsMode();
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
