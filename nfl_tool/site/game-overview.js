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
    label: "Pass Rush",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Blitz (5+ rushers)", tendKey: "blitz_rate", perfKey: "success_vs_blitz", defSuccessKey: "def_success_allowed_blitz" },
      { label: "Standard Rush", tendKey: "standard_rush_rate", perfKey: "success_vs_standard_rush", defSuccessKey: "def_success_allowed_standard_rush" },
    ],
  },
  {
    // A sack isn't the only way a pass rush wins -- a QB who's hit or
    // hurried but not sacked still shows up here (NGS's own pressure
    // charting), unlike sack totals alone.
    label: "QB Pressure",
    perfLabel: "Success %",
    pct: true,
    rows: [
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
// more graduation than a single raw stat gets. TIER_Z_THRESHOLD (0.6) sits
// inside the B/D bands here, same scale as the color underneath it.
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
// tier class + continuous alpha, driven directly off an already-computed z
// (tierAlpha/percentileTier take a raw value + pool and z-score it
// themselves -- these operate one step downstream of that, since a
// composite has no single raw value/pool of its own).
function tierClassForZ(z, threshold = TIER_Z_THRESHOLD) {
  if (z === null || z === undefined) return "";
  if (z >= threshold) return "tier-good";
  if (z <= -threshold) return "tier-bad";
  return "tier-mid";
}
function tierAlphaAttrForZ(z, threshold = TIER_Z_THRESHOLD) {
  if (z === null || z === undefined) return "";
  const az = Math.abs(z);
  if (az < threshold) return "";
  const t = Math.min((az - threshold) / (TIER_Z_SATURATE - threshold), 1);
  const a = TIER_ALPHA_MIN + (TIER_ALPHA_MAX - TIER_ALPHA_MIN) * t;
  return ` style="--tier-a:${a.toFixed(2)}"`;
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
    const offA = tierAlphaAttrForZ(offZ);
    const defA = tierAlphaAttrForZ(defZ);
    const advCell = summaryAdvCell(offZ, defZ, offTeam, defTeam);
    return `<tr><td>${cat.label}</td><td class="num grade-cell ${tierClassForZ(offZ)}"${offA}>${offGrade || "--"}</td><td class="num grade-cell ${tierClassForZ(defZ)}"${defA}>${defGrade || "--"}</td>${advCell}</tr>`;
  }).join("");
  return `<table class="data-table summary-grade-table">
    <thead>${summaryTableHeader(offTeam, defTeam)}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const GRADE_VALUE = { A: 4, B: 3, C: 2, D: 1, F: 0 };

// This team's own four category grades for one side of the ball, plus its
// average z (used to rank all four graded units against each other) and
// its own single weakest category. Returns null when this side has no
// graded categories at all (shouldn't happen once games_played > 0, but
// keeps renderSummaryFacts from crashing on a partial-data edge case).
function unitProfile(team, side) {
  const cats = SUMMARY_CATEGORIES.map((cat) => ({
    label: cat.label,
    z: cat.scheme ? schemeCompositeZ(team, side) : compositeZ(cat[side], team),
  }));
  const known = cats.filter((c) => c.z !== null && c.z !== undefined);
  if (!known.length) return null;
  const avgZ = known.reduce((a, c) => a + c.z, 0) / known.length;
  const worst = known.reduce((a, c) => (c.z < a.z ? c : a));
  const grades = cats.map((c) => (c.z === null || c.z === undefined ? "--" : gradeForZ(c.z)));
  const knownValues = grades.filter((g) => g !== "--").map((g) => GRADE_VALUE[g]);
  return {
    team,
    side,
    grades,
    avgZ,
    worstLabel: worst.label,
    worstGrade: gradeForZ(worst.z),
    spread: knownValues.length > 1 ? Math.max(...knownValues) - Math.min(...knownValues) : null,
  };
}

// This team's own offense: which category it grades highest and lowest at
// (a shape, not a level -- two offenses can share the same shape while
// grading at completely different average levels).
function offenseShape(team) {
  const cats = SUMMARY_CATEGORIES.map((cat) => ({
    label: cat.label,
    z: cat.scheme ? schemeCompositeZ(team, "off") : compositeZ(cat.off, team),
  })).filter((c) => c.z !== null && c.z !== undefined);
  if (cats.length < 2) return null;
  const best = cats.reduce((a, c) => (c.z > a.z ? c : a));
  const worst = cats.reduce((a, c) => (c.z < a.z ? c : a));
  return { best: best.label, worst: worst.label };
}

// Every category where offTeam's offense (vs defTeam's defense) clears a
// real gap (TIER_Z_THRESHOLD), split by which side it favors -- the same
// per-cell logic summaryAdvCell uses, just collected into two lists
// instead of colored one cell at a time.
function edgeLists(offTeam, defTeam) {
  const offList = [];
  const defList = [];
  for (const cat of SUMMARY_CATEGORIES) {
    const offZ = cat.scheme ? schemeCompositeZ(offTeam, "off") : compositeZ(cat.off, offTeam);
    const defZ = cat.scheme ? schemeCompositeZ(defTeam, "def") : compositeZ(cat.def, defTeam);
    if (offZ === null || offZ === undefined || defZ === null || defZ === undefined) continue;
    const gap = offZ - defZ;
    if (Math.abs(gap) < TIER_Z_THRESHOLD) continue;
    (gap > 0 ? offList : defList).push(cat.label);
  }
  return { offList, defList };
}

function joinList(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

// Whole-game synthesis, computed once (not per table) since these
// paragraphs compare across BOTH matchup directions at once. Plain
// descriptive statements only -- no "likely"/"expect"/"decided by"
// language, since these describe what the grades already say, not a
// prediction about the game. Same shape every week (four fixed
// paragraphs), built entirely from the same composite z-scores driving
// the tables and ADV column -- nothing here is authored per matchup.
function renderSummaryFacts(away, home) {
  const phase = (s) => (s === "off" ? "offense" : "defense");
  const paragraphs = [];

  // 1. Most/least consistent unit on the board.
  const units = [unitProfile(away, "off"), unitProfile(away, "def"), unitProfile(home, "off"), unitProfile(home, "def")].filter(
    Boolean
  );
  if (units.length === 4) {
    const best = units.reduce((a, b) => (b.avgZ > a.avgZ ? b : a));
    const worst = units.reduce((a, b) => (b.avgZ < a.avgZ ? b : a));
    const consistencyClause = best.spread !== null && best.spread <= 1 ? ", with every category in the same tier" : "";
    paragraphs.push(
      `${best.team} ${phase(best.side)} grades ${best.grades.join("/")} across Passing/Rushing/Red Zone/Scheme -- the highest average of the four graded units${consistencyClause}. ${worst.team} ${phase(
        worst.side
      )} grades ${worst.grades.join("/")} -- the lowest average of the four, weakest at ${worst.worstLabel} (${worst.worstGrade}).`
    );
  }

  // 2. Do the two offenses share a shape (same strong/weak category), or not.
  const awayShape = offenseShape(away);
  const homeShape = offenseShape(home);
  if (awayShape && homeShape) {
    if (awayShape.best === homeShape.best && awayShape.worst === homeShape.worst) {
      paragraphs.push(
        `${away} and ${home} offenses share the same shape: both grade highest at ${awayShape.best} and lowest at ${awayShape.worst}.`
      );
    } else {
      paragraphs.push(
        `${away} offense grades highest at ${awayShape.best} and lowest at ${awayShape.worst}. ${home} offense grades highest at ${homeShape.best} and lowest at ${homeShape.worst}.`
      );
    }
  }

  // 3. Full edge breakdown for both matchup directions (the same two ADV
  // columns, spelled out in full instead of a count).
  const t1 = edgeLists(away, home);
  const t2 = edgeLists(home, away);
  const t1OffText = joinList(t1.offList);
  const t1DefText = joinList(t1.defList);
  const t2OffText = joinList(t2.offList);
  const t2DefText = joinList(t2.defList);
  if (t1OffText || t1DefText || t2OffText || t2DefText) {
    const clause1 = t1OffText
      ? `${away} offense grades ahead of ${home} defense in ${t1OffText}`
      : `${away} offense does not grade ahead of ${home} defense in any category`;
    const clause2 = t1DefText
      ? `${home} defense grades ahead in ${t1DefText}`
      : `${home} defense does not grade ahead in any category`;
    const clause3 = t2OffText
      ? `${home} offense grades ahead of ${away} defense in ${t2OffText}`
      : `${home} offense does not grade ahead of ${away} defense in any category`;
    const clause4 = t2DefText
      ? `${away} defense grades ahead in ${t2DefText}`
      : `${away} defense does not grade ahead in any category`;
    paragraphs.push(`${clause1}; ${clause2}. ${clause3}; ${clause4}.`);
  }

  // 4. Category with the smallest grade gap on both sides of the ball.
  const combined = SUMMARY_CATEGORIES.map((cat) => {
    const offZ1 = cat.scheme ? schemeCompositeZ(away, "off") : compositeZ(cat.off, away);
    const defZ1 = cat.scheme ? schemeCompositeZ(home, "def") : compositeZ(cat.def, home);
    const offZ2 = cat.scheme ? schemeCompositeZ(home, "off") : compositeZ(cat.off, home);
    const defZ2 = cat.scheme ? schemeCompositeZ(away, "def") : compositeZ(cat.def, away);
    const known = offZ1 !== null && offZ1 !== undefined && defZ1 !== null && defZ1 !== undefined && offZ2 !== null && offZ2 !== undefined && defZ2 !== null && defZ2 !== undefined;
    if (!known) return null;
    const avgAbs = (Math.abs(offZ1 - defZ1) + Math.abs(offZ2 - defZ2)) / 2;
    return { label: cat.label, avgAbs, awayOffGrade: gradeForZ(offZ1), homeDefGrade: gradeForZ(defZ1), homeOffGrade: gradeForZ(offZ2), awayDefGrade: gradeForZ(defZ2) };
  }).filter(Boolean);
  if (combined.length) {
    const closest = combined.reduce((a, b) => (b.avgAbs < a.avgAbs ? b : a));
    paragraphs.push(
      `${closest.label} shows the smallest grade gap between the two teams on both sides of the ball: ${away} offense grades ${closest.awayOffGrade} against ${home} defense's ${closest.homeDefGrade}, and ${home} offense grades ${closest.homeOffGrade} against ${away} defense's ${closest.awayDefGrade}.`
    );
  }

  if (!paragraphs.length) return "";
  return `<div class="grade-facts">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>`;
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

const SECTIONS = ["injuries", "odds", "general", "scheme", "recent", "summary", "picks"];

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
  </table>`;
}

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
  document.getElementById("summary-facts").innerHTML = renderSummaryFacts(away, home);

  renderPickTracker(game);
}

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
