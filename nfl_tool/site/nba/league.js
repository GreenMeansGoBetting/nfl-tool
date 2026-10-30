// ---- GMG NBA Suite: League Stats Chart ----
// Every team down the left, its numbers across the top: Offense, then Defense
// (what its opponents do against it), then the game and the betting records.
// Each cell is the team's number (no decimals) on the 8-step rank colors of
// 30, green = good for that team (the owner, 2026-10-30: "good green most
// green"; how-often numbers too: the most threes, the fastest pace = green;
// on defense allowing the least = green). Sortable; the day's games above pull
// two teams to the top. Data: nba/data.json `league_chart` (build_nba.py
// league_chart). Stands on its own (no common.js), like Matchup Breakdown.

let DATA = null;
let dayIndex = 0;
let pinned = null; // the game whose two teams sit on top
const view = { window: "season", rank: false, today: false, sort: "net", dir: 1 }; // never remembered (the owner)
const NBA_GAME_KEY = "nba-tool.game.v1"; // Matchup Breakdown's open game (nba.js)

const el = (id) => document.getElementById(id);
const team = (abbr) => DATA.teams[abbr] || { name: abbr, color: "555555", logo: "" };
const teamRgb = (abbr) => [0, 2, 4].map((i) => parseInt((team(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
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
const COL_W = 46; // every stat column the same width (the owner: "I JUST WANT COLUMNS ALL equal")
const TEAM_W = 58;
const GAP_W = 6;

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
  return `background:${scaleHsla(hue, 78, 44, fill)};border-color:${scaleHsla(hue, 78, 48)}`;
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

// ---- schedule ----
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
const logo = (abbr, size) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const side = (abbr, pts, opp) =>
        final ? `<span class="matchup-team-col">${logo(abbr, 28)}<span class="matchup-score${pts > opp ? " matchup-score-win" : " matchup-score-loss"}">${pts}</span></span>` : logo(abbr, 28);
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === pinned ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${side(g.away, g.away_score, g.home_score)}<span class="at">@</span>${side(g.home, g.home_score, g.away_score)}</span>
        ${final ? "" : `<span class="matchup-date">${gmgGameTime(g, false)}</span>`}
      </button>`;
    })
    .join("");
}

// ---- the chart ----
function sortedTeams(table) {
  const key = view.sort;
  const way = (COLS.find((c) => c[0] === key) || [])[4] || 1;
  const teams = Object.keys(table).sort();
  return teams.sort((a, b) => {
    const va = sortValue(table[a], key), vb = sortValue(table[b], key);
    if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1; // no data last either way
    return (vb - va) * way * view.dir;
  });
}
function renderChart() {
  const table = (DATA.league_chart || {})[view.window];
  el("empty-state").hidden = !!table;
  if (!table) {
    el("empty-state").innerHTML = "<p>The league numbers aren't available right now.</p>";
    el("lsc-body").innerHTML = "";
    return;
  }
  const ranks = ranksOf(table);
  const game = DATA.schedule.find((g) => g.game_id === pinned);
  const top = game ? [game.away, game.home].filter((t) => table[t]) : [];
  const playing = new Set(gamesOn(days()[dayIndex]).flatMap((g) => [g.away, g.home]));
  const rest = sortedTeams(table).filter((t) => !top.includes(t) && (!view.today || playing.has(t)));

  const gap = (tag) => `<${tag} class="od-ggap"></${tag}>`;
  const cls = (group, i, n) => `${group} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const groupRow = `<tr class="od-ggroups"><th class="lsc-corner"></th>${GROUPS.map(([name, cols, g], gi) =>
    `${gi ? gap("th") : ""}<th class="${g}" colspan="${cols.length}">${name}</th>`).join("")}</tr>`;
  const labelRow = `<tr class="od-glabels"><th class="lsc-corner lsc-team-h">Team</th>${GROUPS.map(([, cols, g], gi) =>
    `${gi ? gap("th") : ""}${cols.map(([key, label, name], i) => {
      const on = key === view.sort;
      return `<th class="${cls(g, i, cols.length)} lsc-sort${on ? " lsc-sorted" : ""}" data-sort="${key}" title="${name}: click to sort best first, again for worst first">${label}${on ? `<i class="lsc-arrow">${view.dir > 0 ? "&#9660;" : "&#9650;"}</i>` : ""}</th>`;
    }).join("")}`).join("")}</tr>`;

  const row = (abbr, isTop) => {
    const r = table[abbr];
    const cells = GROUPS.map(([, cols, g], gi) => `${gi ? gap("td") : ""}${cols.map(([key, , name, fmt], i) => {
      const v = r[key];
      const rk = ranks[key].r[abbr];
      const text = v === null || v === undefined ? "" : view.rank ? ordinal(rk) : show(v, fmt);
      const tip = `${team(abbr).name} · ${name}: ${exact(v, fmt)}${rk ? ` · ${ordinal(rk)} of ${ranks[key].n}` : ""}`;
      return `<td class="${cls(g, i, cols.length)}"><div class="od-tile lsc-tile"${rk ? ` style="${rankStyle(rk, ranks[key].n)}"` : ""} title="${tip}"><b>${text}</b></div></td>`;
    }).join("")}`).join("");
    return `<tr class="${isTop ? "lsc-top" : ""}"><td class="lsc-team"><button type="button" class="lsc-logo" data-team="${abbr}" style="--team:${teamRgb(abbr)}" title="${team(abbr).name} (${r.games} game${r.games === 1 ? "" : "s"}): open its game in Matchup Breakdown"><img src="${team(abbr).logo}" alt="${abbr}" loading="lazy"></button></td>${cells}</tr>`;
  };
  const width = TEAM_W + COLS.length * COL_W + (GROUPS.length - 1) * GAP_W;
  const cols = `<colgroup><col style="width:${TEAM_W}px">${GROUPS.map(([, c], gi) => `${gi ? `<col style="width:${GAP_W}px">` : ""}${c.map(() => `<col style="width:${COL_W}px">`).join("")}`).join("")}</colgroup>`;
  const spacer = top.length && rest.length ? `<tr class="lsc-spacer"><td colspan="${1 + COLS.length + GROUPS.length - 1}"></td></tr>` : "";
  el("lsc-body").innerHTML = `<table class="data-table od-grid lsc-grid${view.rank ? " lsc-ranks" : ""}" style="width:${width}px">${cols}
    <thead>${groupRow}${labelRow}</thead>
    <tbody>${top.map((t) => row(t, true)).join("")}${spacer}${rest.map((t) => row(t, false)).join("")}</tbody></table>`;
}
function renderControls() {
  document.querySelectorAll("#lsc-window .view-toggle-btn").forEach((b) => b.classList.toggle("active", b.dataset.window === view.window));
  [["lsc-rank", view.rank], ["lsc-today", view.today]].forEach(([id, on]) => {
    el(id).classList.toggle("active", on);
    el(id).setAttribute("aria-pressed", String(on));
  });
}
function render() {
  renderSchedule();
  renderControls();
  renderChart();
}

// A team's game for Matchup Breakdown: today's (or its next), else its last.
function openTeam(abbr) {
  const today = new Date().toLocaleDateString("en-CA");
  const mine = DATA.schedule.filter((g) => g.away === abbr || g.home === abbr);
  const g = mine.find((x) => x.date >= today) || mine[mine.length - 1];
  try {
    if (g) localStorage.setItem(NBA_GAME_KEY, g.game_id);
  } catch (e) {
    // localStorage unavailable -- Matchup Breakdown opens on tonight's first game.
  }
  location.href = "./";
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) {
    pinned = pinned === card.dataset.game ? null : card.dataset.game;
    return render();
  }
  if (e.target.closest("#day-prev") || e.target.closest("#day-next")) {
    dayIndex = Math.max(0, Math.min(days().length - 1, dayIndex + (e.target.closest("#day-prev") ? -1 : 1)));
    return render();
  }
  const win = e.target.closest("#lsc-window .view-toggle-btn");
  if (win) {
    view.window = win.dataset.window;
    return render();
  }
  if (e.target.closest("#lsc-rank")) {
    view.rank = !view.rank;
    return render();
  }
  if (e.target.closest("#lsc-today")) {
    view.today = !view.today;
    return render();
  }
  const sort = e.target.closest("th.lsc-sort");
  if (sort) {
    view.dir = view.sort === sort.dataset.sort ? -view.dir : 1;
    view.sort = sort.dataset.sort;
    return renderChart();
  }
  const logoBtn = e.target.closest(".lsc-logo");
  if (logoBtn) return openTeam(logoBtn.dataset.team);
  const theme = e.target.closest("#theme-toggle");
  if (theme) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
  }
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    dayIndex = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
