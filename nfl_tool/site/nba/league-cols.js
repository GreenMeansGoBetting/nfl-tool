// ---- GMG NBA Suite: the League Stats Chart's columns ----
// One copy of every column (its header, hover name, format and which way is green),
// the formats and the 30-team ranks, for the two pages that show these numbers:
// the League Stats Chart (league.js) and Matchup Keys (matchup-keys.js).

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

// [key, header (two short lines), hover name, format, way]: format n = whole number,
// s = signed, p = percent, h = per 100 (a points-a-possession number), r = a record;
// way +1 = the most is green, -1 = the least is green.
const OFFENSE = [
  ["o_ppg", "PPG", "Points A Game", "n", 1],
  ["o_rtg", "ORtg", "Offensive Rating (Points A 100 Possessions)", "n", 1],
  ["o_3pm", "3PM", "Threes Made A Game", "n", 1],
  ["o_3par", "3PA<br>Rate", "3-Point Attempt Rate (Share Of Shots From Three)", "p", 1],
  ["o_ftr", "FT<br>Rate", "Free Throw Rate (Free Throws A Shot)", "p", 1],
  ["o_tov", "TOV<br>%", "Turnover % (Possessions Ending In A Turnover)", "p", -1],
  ["o_reb", "OREB<br>%", "Offensive Rebound %", "p", 1],
  ["o_paint_share", "Paint<br>Share", "Paint Share (Share Of Shots In The Paint)", "p", 1],
  ["o_paint_pct", "Paint<br>FG%", "Paint FG%", "p", 1],
  ["o_mid_share", "Mid<br>Share", "Mid-Range Share", "p", 1],
  ["o_mid_pct", "Mid<br>FG%", "Mid-Range FG%", "p", 1],
  ["o_trans_freq", "Trans<br>Share", "Transition Share (Possessions In Transition)", "p", 1],
  ["o_trans_ppp", "Trans<br>Pts", "Transition Points A 100 Possessions", "h", 1],
  ["o_ball_move", "Ball<br>Move", "Ball Movement (Assisted Makes And Catch-And-Shoot, Averaged)", "p", 1],
];
const DEFENSE = [
  ["d_ppg", "PPG", "Points Allowed A Game", "n", -1],
  ["d_rtg", "DRtg", "Defensive Rating (Points Allowed A 100 Possessions)", "n", -1],
  ["d_3pm", "3PM", "Threes Allowed A Game", "n", -1],
  ["d_3par", "3PA<br>Rate", "Opponents' 3-Point Attempt Rate", "p", -1],
  ["d_ftr", "FT<br>Rate", "Opponents' Free Throw Rate", "p", -1],
  ["d_tov", "Forced<br>TOV%", "Forced Turnover % (Opponents' Possessions Ending In A Turnover)", "p", 1],
  ["d_reb", "DREB<br>%", "Defensive Rebound %", "p", 1],
  ["d_paint_share", "Paint<br>Share", "Opponents' Paint Share", "p", -1],
  ["d_paint_pct", "Paint<br>FG%", "Opponents' Paint FG%", "p", -1],
  ["d_mid_share", "Mid<br>Share", "Opponents' Mid-Range Share", "p", -1],
  ["d_mid_pct", "Mid<br>FG%", "Opponents' Mid-Range FG%", "p", -1],
  ["d_trans_freq", "Trans<br>Share", "Opponents' Transition Share", "p", -1],
  ["d_trans_ppp", "Trans<br>Pts", "Opponents' Transition Points A 100 Possessions", "h", -1],
  ["d_ball_move", "Ball<br>Move", "Opponents' Ball Movement", "p", -1],
];
const GAME = [
  ["pace", "Pace", "Pace (Possessions A Game)", "n", 1],
  ["net", "Net<br>Rtg", "Net Rating (Points A 100 Possessions, Scored Minus Allowed)", "s", 1],
  ["margin", "Avg<br>Margin", "Average Margin", "s", 1],
  ["total", "Avg<br>Total", "Average Total (Both Teams' Points)", "n", 1],
  ["ats", "ATS", "Against The Spread (Line At Tip)", "r", 1],
  ["ou", "O/U", "Over / Under (Line At Tip)", "r", 1],
];
// [name, columns, Opening Drive grid group]
const GROUPS = [["Offense", OFFENSE, "od-g0"], ["Defense (Allowed)", DEFENSE, "od-g1"], ["Game &amp; Betting", GAME, "od-g2"]];
const COLS = GROUPS.flatMap(([, cols]) => cols);
// A record's sort number: its win (cover / over) share; pushes don't count.
const recShare = (r) => (r && r[0] + r[1] ? r[0] / (r[0] + r[1]) : null);
const sortValue = (row, key) => {
  const v = row ? row[key] : null;
  return Array.isArray(v) ? recShare(v) : v ?? null;
};
function show(v, fmt) {
  if (v === null || v === undefined) return "";
  if (fmt === "r") return `${v[0]}-${v[1]}`;
  if (fmt === "p" || fmt === "h") return String(Math.round(v * 100));
  const n = Math.round(v);
  return fmt === "s" && n > 0 ? `+${n}` : String(n === 0 ? 0 : n);
}
function exact(v, fmt) {
  if (v === null || v === undefined) return "No data";
  if (fmt === "r") return `${v[0]}-${v[1]}${v[2] ? `-${v[2]}` : ""}`;
  if (fmt === "p") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "h") return (v * 100).toFixed(1);
  return `${fmt === "s" && v > 0 ? "+" : ""}${Number(v).toFixed(1)}`;
}

// The site's 8-step rank colors (common.js RANK_SCALE / rankScaleStyle; this page doesn't load common.js).
const RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
function rankStyle(rank, total) {
  const [hue, fill] = RANK_SCALE[Math.min(RANK_SCALE.length - 1, Math.floor(((rank - 1) / total) * RANK_SCALE.length))];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
}

// {key: {team: rank}} over all 30 teams in the window (1 = greenest), ties share a rank.
function ranksOf(table) {
  const out = {};
  COLS.forEach(([key, , , , way]) => {
    const vals = Object.entries(table).map(([t, row]) => [t, sortValue(row, key)]).filter(([, v]) => v !== null);
    out[key] = { n: vals.length, r: {} };
    vals.forEach(([t, v]) => (out[key].r[t] = 1 + vals.filter(([, x]) => (way > 0 ? x > v : x < v)).length));
  });
  return out;
}

