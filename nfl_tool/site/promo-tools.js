// ---- Promo Tools: King of the Endzone ----
// DraftKings' weekly promo pays on whoever scores the game's LONGEST TD
// (D/ST included). This page ranks every player on the checked teams by
// long-play upside -- TD lengths so far, 20+/40+ yard plays, how deep he's
// used -- next to how many big plays this week's defense gives up, plus a
// D/ST table (return TDs, takeaways, the opponent's giveaways). Data:
// build_stats.py compute_koe -> DATA.koe.

const KOE_TEAMS_KEY = "nfl-tool.koe.teams"; // per-device view preference
const KOE_POS = ["All", "RB", "WR", "TE", "QB"];
const KOE_MIN_TOUCHES_PG = 1.5; // shown if this involved, or any TD / 20+ play
// Upside = weighted z-scores vs every qualifying player in the league,
// shown as a league percentile. Each part is what he should do TONIGHT:
// touches per game x how often a touch becomes that play, the per-touch rate
// pulled toward his position's average by KOE_PRIOR_TOUCHES touches, so a
// 2-touch fullback with one long catch can't outrank a starter (2026-10-19:
// Juszczyk over Diggs / McCaffrey). The defense part is sized to his touches.
// Picked on a weeks 2-6 replay of every game's longest TD (it tied or beat the
// old per-game blend; the longest TD is mostly random either way).
const KOE_PRIOR_TOUCHES = 40;
const KOE_UPSIDE_PARTS = [
  { key: "e_big", w: 0.3, label: "Expected 20+ yd plays tonight" },
  { key: "e_huge", w: 0.15, label: "Expected 40+ yd plays tonight" },
  { key: "e_role", w: 0.15, label: "Expected deep role tonight (10+ yd runs or deep targets)" },
  { key: "e_td", w: 0.2, label: "Expected TDs tonight" },
  { key: "e_def", w: 0.2, label: "This week's defense's big plays allowed, sized to his touches" },
];

let koePos = "All";
let koeWeekSel = null; // a past week picked with the week toggle; null = this week
// Past weeks' boards (as they stood going into each week) and every finished
// game's longest TD: koe_weeks.json, written by the build (koe_week_boards,
// koe_game_results). Payouts: typed in by the owner (/api/koe-payouts).
let KOE_WEEKS = { boards: {}, results: {} };
let KOE_PAYOUTS = {};
let koeSort = { key: "upside", dir: -1 };
let koeTeams = new Set();

function koeWeekGames() {
  const games = (DATA.schedule || []).filter((g) => g.week === DATA.current_week);
  const open = games.filter((g) => g.status !== "final");
  if (open.length) return open;
  const next = (DATA.schedule || []).filter((g) => g.week === DATA.current_week + 1);
  return next.length ? next : games;
}
function koeLiveWeek() {
  const games = koeWeekGames();
  return games.length ? games[0].week : DATA.current_week;
}
const koeWeek = () => koeWeekSel || koeLiveWeek();
const koeIsLive = (w) => w === koeLiveWeek();
function koeGamesOf(w = koeWeek()) {
  return koeIsLive(w) ? koeWeekGames() : (DATA.schedule || []).filter((g) => g.week === w);
}
// This week: the live numbers. A past week: its board from before it started.
function koeData(w = koeWeek()) {
  return koeIsLive(w) ? DATA.koe : (KOE_WEEKS.boards || {})[String(w)] || null;
}
function koeWeeks() {
  const live = koeLiveWeek();
  return [...new Set([...Object.keys(KOE_WEEKS.boards || {}).map(Number).filter((w) => w < live), live])].sort((a, b) => a - b);
}
function koeOpponent(team, w = koeWeek()) {
  const g = koeGamesOf(w).find((x) => x.away === team || x.home === team);
  return g ? (g.away === team ? g.home : g.away) : null;
}
function loadKoeTeams() {
  try {
    const saved = JSON.parse(localStorage.getItem(KOE_TEAMS_KEY));
    if (Array.isArray(saved)) return new Set(saved);
  } catch (e) {
    // localStorage unavailable -- default below.
  }
  const first = koeWeekGames()[0];
  return new Set(first ? [first.away, first.home] : []);
}
function saveKoeTeams() {
  try {
    localStorage.setItem(KOE_TEAMS_KEY, JSON.stringify([...koeTeams]));
  } catch (e) {
    // localStorage unavailable -- selection just won't stick.
  }
}

// ---- per-player numbers ----
// Touches he should get TONIGHT: his touches per team game with the site's
// lineup weights (common.js lineupWeights): a game he filled in for a regular
// who's healthy now counts 15%, a game he left early doesn't count. Raw Tch/g
// (2 games as Barkley's fill-in, 16/g) put Dameon Pierce over Darius Cooper
// with Barkley back (2026-10-26). The Tch/g column stays the real count.
function koeTouchesNow(team, p, w) {
  const raw = (p.carries + p.targets) / (p.games || 1);
  const logs = ((DATA.player_game_logs || {})[team] || {})[p.name];
  if (!logs) return raw;
  const weights = lineupWeights(team, p.name, p.position, w);
  const weeks = Object.keys(weights);
  const wSum = weeks.reduce((s, wk) => s + weights[wk], 0);
  if (!wSum) return raw;
  const byWeek = Object.fromEntries(logs.map((x) => [x.week, (x.carries || 0) + (x.targets || 0)]));
  return weeks.reduce((s, wk) => s + weights[wk] * (byWeek[wk] || 0), 0) / wSum;
}
function koeRow(team, p, w = koeWeek(), k = koeData(w)) {
  const g = p.games || 1;
  const opp = koeOpponent(team, w);
  const ot = (k.teams || {})[opp] || null;
  const og = ot ? ot.games || 1 : 1;
  const big = p.runs20 + p.catches20;
  const huge = p.runs40 + p.catches40;
  const tds = p.tds || [];
  const longTds = tds.filter((y) => y >= k.big).length;
  // The defense's big plays allowed that fit this player: runs for RBs/QBs,
  // catches for WRs/TEs, both halves for anyone used both ways.
  const runShare = p.carries + p.targets ? p.carries / (p.carries + p.targets) : 0;
  const oppBig = ot ? (runShare * ot.runs20_allowed + (1 - runShare) * ot.catches20_allowed) / og : null;
  const oppLongTds = ot ? ot.tds_allowed.filter((y) => y >= k.big).length : null;
  return {
    team,
    opp,
    name: p.name,
    pos: p.position,
    games: g,
    touches_pg: (p.carries + p.targets) / g,
    touches_now: koeTouchesNow(team, p, w),
    touches: p.carries + p.targets,
    role_n: p.position === "RB" || p.position === "QB" ? p.runs10 : p.deep_targets,
    tds: tds.length,
    avg_td: tds.length ? tds.reduce((a, b) => a + b, 0) / tds.length : null,
    long_td: tds.length ? tds[0] : null,
    b10: tds.filter((y) => y <= 10).length,
    b20: tds.filter((y) => y > 10 && y <= 20).length,
    b40: tds.filter((y) => y > 20 && y <= 40).length,
    b41: tds.filter((y) => y > 40).length,
    big_pg: big / g,
    big,
    huge,
    huge_pg: huge / g,
    long_play: Math.max(p.long_rush || 0, p.long_rec || 0),
    runs20: p.runs20,
    catches20: p.catches20,
    adot: p.position === "WR" || p.position === "TE" ? p.adot : null,
    deep_pg: p.deep_targets / g,
    role: p.position === "RB" || p.position === "QB" ? p.runs10 / g : p.deep_targets / g,
    long_tds: longTds,
    opp_big_pg: oppBig,
    opp_long_tds: oppLongTds,
    opp_avg_td: ot && ot.tds_allowed.length ? ot.tds_allowed.reduce((a, b) => a + b, 0) / ot.tds_allowed.length : null,
    opp_g: og,
  };
}
function koeQualifies(r, p) {
  return r.touches_pg >= KOE_MIN_TOUCHES_PG || (p.tds || []).length > 0 || r.big > 0;
}

// League pool (every team) so colors and Upside don't depend on which
// teams are checked.
function koeLeague(w = koeWeek(), k = koeData(w)) {
  const cache = (koeLeague.cache = koeLeague.cache || new Map());
  if (!k) return [];
  if (cache.has(k)) return cache.get(k);
  const rows = [];
  Object.entries(k.players || {}).forEach(([team, list]) =>
    list.forEach((p) => {
      const r = koeRow(team, p, w, k);
      if (koeQualifies(r, p)) rows.push(r);
    })
  );
  // Per-touch rates by position (the prior a thin sample is pulled toward).
  const counts = { big: "big", huge: "huge", td: "tds", role: "role_n" };
  const posRate = {};
  rows.forEach((r) => {
    const a = (posRate[r.pos] = posRate[r.pos] || { touches: 0, big: 0, huge: 0, td: 0, role: 0 });
    a.touches += r.touches;
    Object.entries(counts).forEach(([key, src]) => (a[key] += r[src]));
  });
  const meanTouches = rows.reduce((s, r) => s + r.touches_now, 0) / (rows.length || 1);
  rows.forEach((r) => {
    const a = posRate[r.pos];
    const rate = (key) => (r[counts[key]] + (a.touches ? a[key] / a.touches : 0) * KOE_PRIOR_TOUCHES) / (r.touches + KOE_PRIOR_TOUCHES);
    r.e_big = r.touches_now * rate("big");
    r.e_huge = r.touches_now * rate("huge");
    r.e_role = r.touches_now * rate("role");
    r.e_td = r.touches_now * rate("td");
    // The defense's big plays (and 20+ TDs) allowed per game, scaled by how
    // much he has the ball (league-average touches = 1x, capped at 2x).
    const opp = r.opp_big_pg === null ? 0 : r.opp_big_pg + (r.opp_long_tds || 0) / (r.opp_g || 1);
    r.e_def = opp * Math.min(meanTouches ? r.touches_now / meanTouches : 0, 2);
  });
  const pools = Object.fromEntries(KOE_UPSIDE_PARTS.map((part) => [part.key, rows.map((r) => r[part.key])]));
  rows.forEach((r) => {
    r.parts = KOE_UPSIDE_PARTS.map((part) => ({ ...part, z: zScore(r[part.key], pools[part.key], false) || 0 }));
    r.score = r.parts.reduce((s, part) => s + part.w * part.z, 0);
  });
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  rows.forEach((r) => (r.upside = Math.round((100 * scores.filter((s) => s <= r.score).length) / scores.length)));
  cache.set(k, rows);
  return rows;
}

// Who is left off a week's board: this week the site's usual rules; a past
// week that week's injury report, and the QB who started that week.
function koeOut(team, name, w) {
  if (koeIsLive(w)) return lineupOutOn(team, name, w);
  const list = ((DATA.injuries || {})[team] || {})[String(w)] || [];
  return list.some((i) => normName(i.full_name) === normName(name) && /out|doubtful|reserve|injured|suspend/i.test(i.report_status || ""));
}
function koeStarterQb(team, w) {
  if (koeIsLive(w)) return currentStarterQb(team, w);
  const logs = Object.entries((DATA.player_game_logs || {})[team] || {});
  for (let wk = w; wk >= 1; wk--) {
    const best = logs.map(([name, games]) => [name, (games.find((g) => g.week === wk) || {}).pass_att || 0]).filter(([, a]) => a >= 10).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return null;
}
// One game's board as the table shows it: both teams, starters only, best Upside first.
function koeBoard(w, teams, k = koeData(w)) {
  return koeLeague(w, k)
    .filter((r) => teams.includes(r.team) && !(r.pos === "QB" && normName(r.name) !== normName(koeStarterQb(r.team, w) || "")) && !koeOut(r.team, r.name, w))
    .sort((a, b) => b.score - a.score);
}
// His longest TD in this week's game, once it is final (null = not final).
function koeResult(r, w) {
  const g = koeGamesOf(w).find((x) => x.away === r.team || x.home === r.team);
  const res = g && (KOE_WEEKS.results || {})[g.game_id];
  if (!res) return g && g.status === "final" ? { yds: null, led: false } : null;
  const hit = res.tds.find(([n, t]) => t === r.team && normName(n) === normName(r.name));
  return { yds: hit ? hit[2] : null, led: !!hit && hit[2] === res.longest };
}

// ---- rendering ----
const KOE_COLS = [
  { key: "tds", label: "TDs", group: "Touchdowns", fmt: (v) => v || "", title: "Rushing + receiving TDs" },
  { key: "avg_td", label: "Avg", group: "Touchdowns", fmt: (v) => (v === null ? "" : fmt(v, 0)), title: "Average TD length (yds)" },
  { key: "long_td", label: "Long", group: "Touchdowns", fmt: (v) => (v === null ? "" : v), title: "Longest TD (yds)" },
  { key: "b10", label: "1-10", group: "TDs by distance", fmt: (v) => v || "", title: "TDs of 10 yds or less" },
  { key: "b20", label: "11-20", group: "TDs by distance", fmt: (v) => v || "", title: "TDs of 11-20 yds" },
  { key: "b40", label: "21-40", group: "TDs by distance", fmt: (v) => v || "", title: "TDs of 21-40 yds" },
  { key: "b41", label: "41+", group: "TDs by distance", fmt: (v) => v || "", title: "TDs of 41+ yds" },
  { key: "big_pg", label: "20+/g", group: "Big plays", fmt: (v) => (v ? fmt(v, 1) : ""), title: "Runs + catches of 20+ yds per game" },
  { key: "huge", label: "40+", group: "Big plays", fmt: (v) => v || "", title: "Runs + catches of 40+ yds (season)" },
  { key: "long_play", label: "Long", group: "Big plays", fmt: (v) => v || "", title: "Longest run or catch (yds)" },
  { key: "touches_pg", label: "Tch/g", group: "Role", fmt: (v) => fmt(v, 1), title: "Carries + targets per game" },
  { key: "runs20", label: "Run 20+", group: "Role", fmt: (v) => v || "", title: "Runs of 20+ yds (season)" },
  { key: "catches20", label: "Rec 20+", group: "Role", fmt: (v) => v || "", title: "Catches of 20+ yds (season)" },
  { key: "adot", label: "ADOT", group: "Role", fmt: (v) => (v === null ? "" : fmt(v, 1)), title: "Average depth of target (air yds)" },
  { key: "deep_pg", label: "Deep/g", group: "Role", fmt: (v) => (v ? fmt(v, 1) : ""), title: "Targets 20+ yds downfield per game" },
  { key: "opp_big_pg", label: "20+ alw/g", group: "vs this week's D", zero: true, fmt: (v) => (v === null ? "" : fmt(v, 1)), title: "20+ yd plays this defense allows per game -- runs for runners, catches for receivers" },
  { key: "opp_long_tds", label: "20+ TDs", group: "vs this week's D", zero: true, fmt: (v) => (v === null ? "" : v), title: "TDs of 20+ yds this defense has allowed" },
  { key: "opp_avg_td", label: "Avg TD", group: "vs this week's D", fmt: (v) => (v === null ? "" : fmt(v, 0)), title: "Average length of TDs this defense has allowed" },
];

const KOE_GROUP_CLASS = { Touchdowns: "td", "TDs by distance": "dist", "Big plays": "big", Role: "role", "vs this week's D": "def" };

function koeCell(col, r, league) {
  const v = r[col.key];
  if (v === null || v === undefined) return `<td class="num"></td>`;
  if (v === 0) return `<td class="num">${col.zero ? 0 : ""}</td>`;
  const pool = league.map((x) => x[col.key]).filter((x) => x !== null && x !== undefined);
  return `<td class="num ${percentileTier(v, pool, false)}"${tierAlphaAttr(v, pool, false)}>${col.fmt(v)}</td>`;
}
function koeUpsideCell(r) {
  const hue = Math.round((r.upside / 100) * 120);
  const why = r.parts.map((p) => `${p.label}: ${p.z >= 0 ? "+" : ""}${p.z.toFixed(1)}`).join("\n");
  return `<td class="num"><span class="koe-upside" style="background:${scaleHsla(hue, 70, 45, 0.22)};border-color:${scaleHsla(hue, 70, 45, 0.6)}" title="League percentile. Touches tonight: ${fmt(r.touches_now, 1)} (fill-in games count 15%)\nParts (z vs league):\n${why}">${r.upside}</span></td>`;
}

function koeResultCell(res) {
  if (!res) return `<td class="num muted-label">--</td>`;
  if (res.yds === null) return `<td class="num"></td>`;
  return `<td class="num${res.led ? " tier-good" : ""}" title="${res.led ? "The game's longest TD" : "His longest TD this game"}"><b>${res.yds}</b>${res.led ? ` <span class="koe-crown">&#9733;</span>` : ""}</td>`;
}

function renderKoePlayers() {
  const el = document.getElementById("koe-players");
  if (!koeTeams.size) {
    el.innerHTML = `<p class="no-data-note">Check one or more teams above.</p>`;
    document.getElementById("koe-count").textContent = "";
    return;
  }
  const week = koeWeek();
  if (!koeData(week)) {
    el.innerHTML = `<p class="no-data-note">Week ${week} has no games before it to read.</p>`;
    document.getElementById("koe-count").textContent = "";
    return;
  }
  const league = koeLeague(week);
  let out = 0;
  const rows = league.filter((r) => {
    if (!koeTeams.has(r.team) || (koePos !== "All" && r.pos !== koePos)) return false;
    if (r.pos === "QB" && normName(r.name) !== normName(koeStarterQb(r.team, week) || "")) return false;
    if (koeOut(r.team, r.name, week)) {
      out += 1;
      return false;
    }
    return true;
  });
  const { key, dir } = koeSort;
  rows.sort((a, b) => dir * (((a[key] ?? -1e9) > (b[key] ?? -1e9)) - ((a[key] ?? -1e9) < (b[key] ?? -1e9))) || b.upside - a.upside);
  document.getElementById("koe-count").textContent = `${rows.length} players${out ? ` · ${out} ruled out hidden` : ""}`;
  // Column groups become header bubbles spanning their columns, with an
  // empty gap column between groups so each reads as its own block.
  const groups = [];
  KOE_COLS.forEach((c) => (groups.length && groups[groups.length - 1].name === c.group ? groups[groups.length - 1].cols.push(c) : groups.push({ name: c.group, cols: [c] })));
  const gcls = (name) => `koe-g-${KOE_GROUP_CLASS[name]}`;
  const sortCls = (k) => (koeSort.key === k ? ` koe-sorted${koeSort.dir > 0 ? " koe-asc" : ""}` : "");
  const gap = (tag) => `<${tag} class="koe-gap"></${tag}>`;
  const upTitle = "Long-TD upside: league percentile of what he should do tonight (his touches, with fill-in games for a starter who's back counting 15%, x his per-touch rates): 20+ yd plays (30%), 40+ yd plays (15%), deep role (15%), TDs (20%) and this week's defense's big plays allowed, sized to his touches (20%)";
  // Once a game is final, his longest TD in it (a star for the game's longest).
  rows.forEach((r) => (r.result = koeResult(r, week)));
  const showResult = rows.some((r) => r.result);
  const cols = `<colgroup><col class="koe-c-player">${groups.map((g) => `<col class="koe-c-gap">${g.cols.map(() => `<col class="${g.name === "TDs by distance" ? "koe-c-dist" : "koe-c-stat"}">`).join("")}`).join("")}<col class="koe-c-gap"><col class="koe-c-up">${showResult ? `<col class="koe-c-gap"><col class="koe-c-up">` : ""}</colgroup>`;
  const head = `<tr class="koe-group-row"><th></th>${groups.map((g) => `${gap("th")}<th colspan="${g.cols.length}" class="koe-group ${gcls(g.name)}"><span>${g.name}</span></th>`).join("")}${gap("th")}<th class="koe-group koe-g-up"><span>Upside</span></th>${showResult ? `${gap("th")}<th class="koe-group koe-g-dist"><span>Result</span></th>` : ""}</tr>
    <tr class="koe-label-row"><th class="koe-sort${sortCls("name")}" data-sort="name">Player</th>${groups.map((g) => `${gap("th")}${g.cols.map((c) => `<th class="num koe-sort ${gcls(g.name)}${sortCls(c.key)}" data-sort="${c.key}" title="${c.title}">${c.label}</th>`).join("")}`).join("")}${gap("th")}<th class="num koe-sort koe-g-up${sortCls("upside")}" data-sort="upside" title="${upTitle}">0-100</th>${showResult ? `${gap("th")}<th class="num koe-g-dist" title="His longest TD in this game, and a star for the game's longest">TD</th>` : ""}</tr>`;
  const body = rows
    .map((r) => {
      const who = playerClick(r.team, r.name, `${summaryHeadshot(r.team, r.name, 24)}<span class="koe-name">${r.name}</span>`, r.opp);
      return `<tr>
        <td class="koe-player"><span class="koe-who">${who}<span class="koe-meta">${teamLogoMini(r.team, 14)}${r.pos}</span></span></td>
        ${groups.map((g) => `${gap("td")}${g.cols.map((c) => koeCell(c, r, league)).join("")}`).join("")}
        ${gap("td")}${koeUpsideCell(r)}
        ${showResult ? `${gap("td")}${koeResultCell(r.result)}` : ""}
      </tr>`;
    })
    .join("");
  el.innerHTML = rows.length
    ? `<section class="koe-section"><table class="data-table koe-table">${cols}<thead>${head}</thead><tbody>${body}</tbody></table></section>`
    : `<p class="no-data-note">No players at this position on the checked teams.</p>`;
  wrapWideTablesForPhone();
}

// D/ST: return TDs so far, takeaways, and this week's opponent's giveaways
// and D/ST TDs allowed.
function renderKoeDst() {
  const el = document.getElementById("koe-dst");
  const k = koeData();
  const teams = k ? [...koeTeams].filter((t) => k.teams[t]) : [];
  if (!teams.length || (koePos !== "All")) {
    el.innerHTML = "";
    return;
  }
  const ts = DATA.team_stats || {};
  const chip = (t) => `<span class="koe-dst-td" title="Week ${t.week} vs ${t.opp}">${t.kind} <b>${t.yds}</b></span>`;
  const all = (key) => Object.values(ts).map((s) => s[key]).filter((v) => v !== null && v !== undefined);
  const tier = (v, key) => (v === null || v === undefined ? `<td class="num">--</td>` : `<td class="num ${percentileTier(v, all(key), false)}"${tierAlphaAttr(v, all(key), false)}>${fmt(v, 1)}</td>`);
  const rows = teams
    .map((team) => {
      const kt = k.teams[team];
      const opp = koeOpponent(team);
      const ok = opp ? k.teams[opp] : null;
      return `<tr>
        <td class="koe-player"><span class="koe-dst-team">${teamLogoMini(team, 26)} <b>${team}</b> D/ST</span></td>
        <td class="koe-gap"></td>
        <td>${kt.dst_tds.length ? kt.dst_tds.map(chip).join("") : `<span class="muted">none</span>`}</td>
        <td class="koe-gap"></td>
        ${tier((ts[team] || {}).takeaways_per_g, "takeaways_per_g")}
        ${tier(opp ? (ts[opp] || {}).turnovers_per_g : null, "turnovers_per_g")}
        <td class="koe-gap"></td>
        <td>${ok && ok.dst_tds_allowed.length ? ok.dst_tds_allowed.map(chip).join("") : `<span class="muted">none</span>`}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `<section class="koe-section">
    <h3 class="koe-sub">D/ST <span class="section-note">counts in the promo: pick-sixes, fumble returns, kick and punt returns</span></h3>
    <table class="data-table koe-table koe-dst"><colgroup><col class="koe-c-player"><col class="koe-c-gap"><col class="koe-c-list"><col class="koe-c-gap"><col class="koe-c-wide"><col class="koe-c-wide"><col class="koe-c-gap"><col class="koe-c-list"></colgroup><thead><tr class="koe-label-row"><th>D/ST</th><th class="koe-gap"></th><th class="koe-g-td">D/ST TDs (yds)</th><th class="koe-gap"></th><th class="num koe-g-big" title="Interceptions + fumble recoveries per game">Takeaways/g</th><th class="num koe-g-big" title="This week's opponent: giveaways per game">Opp giveaways/g</th><th class="koe-gap"></th><th class="koe-g-def" title="D/ST TDs this week's opponent has given up">Opp has allowed</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function renderKoeTeamPicker() {
  const games = koeGamesOf();
  const weeks = koeWeeks();
  const w = koeWeek();
  const i = weeks.indexOf(w);
  document.getElementById("koe-week").innerHTML = `<button type="button" class="week-nav-btn" id="koe-wk-prev"${i <= 0 ? " disabled" : ""} aria-label="Earlier week">&lsaquo;</button><span class="koe-week-label">Week ${w}</span><button type="button" class="week-nav-btn" id="koe-wk-next"${i >= weeks.length - 1 ? " disabled" : ""} aria-label="Later week">&rsaquo;</button>${koeIsLive(w) ? "" : `<span class="koe-week-note">as it stood going into the week</span>`}`;
  document.getElementById("koe-games").innerHTML = games
    .map((g) => {
      const btn = (t) => `<button type="button" class="koe-team${koeTeams.has(t) ? " active" : ""}" data-team="${t}">${teamLogoMini(t, 20)} ${t}</button>`;
      const both = koeTeams.has(g.away) && koeTeams.has(g.home);
      return `<div class="koe-game${both ? " koe-game-on" : ""}">${btn(g.away)}<button type="button" class="koe-at" data-game="${g.away}|${g.home}" title="Check / uncheck both teams">@</button>${btn(g.home)}</div>`;
    })
    .join("");
  document.getElementById("koe-pos").innerHTML = KOE_POS.map((p) => `<button type="button" class="view-toggle-btn${koePos === p ? " active" : ""}" data-pos="${p}">${p}</button>`).join("");
}

function renderKoe() {
  if (!DATA.koe) {
    document.getElementById("koe-players").innerHTML = `<p class="no-data-note">King of the Endzone appears after the next data refresh.</p>`;
    return;
  }
  renderKoeTeamPicker();
  // Saved-image title: the checked games ("ATL @ NO") and the week.
  const games = koeGamesOf().filter((g) => koeTeams.has(g.away) || koeTeams.has(g.home));
  const label = games.length && games.length <= 3 ? games.map((g) => `${g.away} @ ${g.home}`).join(" · ") : `${games.length} games`;
  document.getElementById("koe-capture-title").textContent = `King of the Endzone · ${label} · Week ${koeWeek()}`;
  renderKoePlayers();
  renderKoeDst();
  renderKoeWinners();
}

// ---- Winners: who had each contest's longest TD, and what DraftKings paid ----
// A contest = a game the owner has logged payouts for (/api/koe-payouts).
// The pregame place is from that week's board as it stood going into the
// week (koe_weeks.json), ranked like the table: both teams, starters only.
// The pool is split evenly among everyone on the winner whatever they bet,
// so pool / payout = about how many people were on him. Never in the image.
const koeOrd = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const koeMoney = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const koeLast = (name) => (/ D\/ST$/.test(name) ? name : String(name || "").split(" ").slice(-1)[0]);
const koeShort = (name) => {
  if (/ D\/ST$/.test(name)) return name;
  const parts = String(name || "").split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
};
const koeGame = (id) => (DATA.schedule || []).find((g) => g.game_id === id) || null;
function koeLoadPayouts() {
  return fetch("/api/koe-payouts", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.days ? d.days : {}))
    .catch(() => ({}));
}
// Everyone a pasted name can be: both teams' players on that week's board,
// every TD scorer in the game, and both D/STs.
function koeCandidates(g) {
  const out = new Map();
  const add = (name, team) => out.set(`${normName(name)}|${team}`, { name, team });
  const k = (KOE_WEEKS.boards || {})[String(g.week)] || (koeIsLive(g.week) ? DATA.koe : null);
  [g.away, g.home].forEach((t) => (((k || {}).players || {})[t] || []).forEach((p) => add(p.name, t)));
  ((KOE_WEEKS.results || {})[g.game_id] || { tds: [] }).tds.forEach(([n, t]) => add(n, t));
  [g.away, g.home].forEach((t) => add(`${t} D/ST`, t));
  return [...out.values()];
}
function koeMatch(name, g, list) {
  if (/\b(d\/?st|dst|defen[cs]e|special teams)\b/i.test(name)) {
    const words = name.toLowerCase();
    const team = [g.away, g.home].find((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(words) || (TEAM_NAMES[t] || "").toLowerCase().split(" ").some((w) => w.length > 3 && words.includes(w)));
    return team ? list.find((c) => c.name === `${team} D/ST`) : null;
  }
  const want = normName(name);
  const exact = list.filter((c) => normName(c.name) === want);
  if (exact.length === 1) return exact[0];
  const last = normName(String(name).trim().split(/\s+/).pop());
  const hits = list.filter((c) => !/ D\/ST$/.test(c.name) && normName(c.name.split(" ").pop()) === last);
  return hits.length === 1 ? hits[0] : null;
}
// DraftKings' list, one player a line: "Bijan Robinson - $1,234 in Bonus Bets".
function koeParse(text, g) {
  const list = koeCandidates(g);
  const read = [];
  const missed = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    const name = raw.slice(0, m.index).replace(/^[^\p{L}]+/u, "").replace(/[\s\-–—:|=]+$/, "").trim();
    if (!name) continue;
    const hit = koeMatch(name, g, list);
    if (hit) read.push({ id: hit.team, name: hit.name, paid: Math.round(Number(m[1].replace(/,/g, ""))) });
    else missed.push(name);
  }
  return { read, missed };
}
function koeWinnerDay(id) {
  const g = koeGame(id);
  if (!g) return "";
  const logged = KOE_PAYOUTS[id];
  const pool = logged.pool;
  const res = (KOE_WEEKS.results || {})[id] || { longest: null, winners: [], tds: [] };
  const pre = (KOE_WEEKS.boards || {})[String(g.week)] || null;
  const board = pre ? koeBoard(g.week, [g.away, g.home], pre) : [];
  const place = (name, team) => board.findIndex((r) => r.team === team && normName(r.name) === normName(name));
  const tdOf = (name, team) => (res.tds.find(([n, t]) => t === team && normName(n) === normName(name)) || [])[2] ?? null;
  const rows = new Map();
  const add = (name, team, paid) => {
    const key = `${normName(name)}|${team}`;
    const i = place(name, team);
    rows.set(key, { name, team, paid: paid ?? (rows.get(key) || {}).paid ?? null, yds: tdOf(name, team), rank: i >= 0 ? i + 1 : null, upside: i >= 0 ? board[i].upside : null });
  };
  res.winners.forEach((w) => add(w.name, w.team, null));
  (logged.payouts || []).forEach((p) => add(p.name, p.id || "", p.paid));
  const shown = [...rows.values()].sort((a, b) => (b.yds ?? -1) - (a.yds ?? -1) || (a.rank ?? 99) - (b.rank ?? 99));
  const led = (r) => r.yds !== null && r.yds === res.longest;
  const winners = shown.filter(led);
  const crown = ` <span class="koe-crown">&#9733;</span>`;
  const rankText = (r) => (r.rank ? `${r.rank}<span class="muted-label">/${board.length}</span>` : `<span class="muted-label">--</span>`);
  const body = shown
    .map((r) => {
      const name = / D\/ST$/.test(r.name) ? `<span>${r.name}</span>` : playerClick(r.team, r.name, `<span title="${r.name}">${koeShort(r.name)}</span>`);
      return `<tr${led(r) ? ` class="koe-win-row"` : ""}><td class="koe-win-name">${teamLogoMini(r.team, 16)}${name}${led(r) ? crown : ""}</td><td>${r.yds === null ? "" : `<b>${r.yds}</b>`}</td><td>${rankText(r)}</td><td>${r.upside ?? ""}</td><td>${r.paid === null ? "" : koeMoney(r.paid)}</td></tr>`;
    })
    .join("");
  const w = winners[0];
  const wPaid = w ? w.paid : null;
  const top = board[0];
  const picked = shown.filter((r) => r.paid).sort((a, b) => a.paid - b.paid)[0];
  const cap = [
    top && !winners.some((r) => r.team === top.team && normName(r.name) === normName(top.name)) ? `Our top Upside: ${teamLogoMini(top.team, 14)} <b>${koeLast(top.name)}</b> (${top.upside})${tdOf(top.name, top.team) !== null ? `, longest TD ${tdOf(top.name, top.team)}` : ", no TD"}` : "",
    picked && pool ? `Most picked: <b>${koeLast(picked.name)}</b> (&asymp;${Math.round(pool / picked.paid).toLocaleString("en-US")})` : "",
  ].filter(Boolean).join(" &middot; ");
  return `<details class="koe-win-day" data-game="${id}">
    <summary class="koe-win-sum">
      <span class="koe-win-date" title="${g.away} @ ${g.home}">Wk ${g.week} &middot; ${g.away}@${g.home}</span>
      <span class="koe-win-who">${winners.map((r) => teamLogoMini(r.team, 20)).join("")}<span class="koe-win-names">${winners.map((r) => koeLast(r.name)).join(" / ") || "--"}</span> <b class="koe-win-yds">${res.longest ?? ""}</b>${winners.length ? crown : ""}</span>
      <span class="koe-win-rank" title="Where the board had ${winners.length > 1 ? "them" : "him"} going into the week, by Upside">${winners.length ? winners.map((r) => (r.rank ? koeOrd(r.rank) : "--")).join(" / ") + ` of ${board.length}` : "--"}</span>
      <span class="koe-win-paid">${wPaid ? koeMoney(wPaid) : `<span class="muted-label">not logged</span>`}</span>
    </summary>
    <div class="koe-win-body">
      <div class="koe-win-meta">${res.longest !== null ? `Longest TD ${res.longest} yds` : "No TD"}${pool ? ` &middot; ${koeMoney(pool)} pool` : ""}${wPaid && pool ? ` &middot; &asymp;${Math.round(pool / wPaid).toLocaleString("en-US")} on ${winners.length > 1 ? "the winners" : koeLast(w.name)}` : ""}</div>
      ${shown.length > winners.length ? `<div class="koe-win-label">If they'd won</div>` : ""}
      <table class="koe-win-table"><thead><tr><th>Player</th><th title="His longest TD in the game (yds)">TD</th><th title="His place on the board going into the week, by Upside (both teams)">Pre</th><th title="His Upside (0-100) going into the week">Up</th><th title="What DraftKings paid (or would have paid) each person on him">Paid</th></tr></thead><tbody>${body}</tbody></table>
      ${cap ? `<div class="koe-win-cap">${cap}</div>` : ""}
    </div>
  </details>`;
}
function renderKoeWinners() {
  const box = document.getElementById("koe-winners-list");
  if (!box) return;
  const ids = Object.keys(KOE_PAYOUTS).filter(koeGame).sort((a, b) => {
    const [ga, gb] = [koeGame(a), koeGame(b)];
    return `${gb.date} ${gb.time}` < `${ga.date} ${ga.time}` ? -1 : 1;
  });
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.game));
  const first = !box.dataset.drawn;
  box.innerHTML = ids.length ? ids.map(koeWinnerDay).join("") : `<p class="no-data-note">Each contest shows up here once its payouts are logged: who had the longest TD, where the board had him, and what it paid.</p>`;
  box.dataset.drawn = "1";
  box.querySelectorAll("details").forEach((d, i) => (d.open = first ? i === 0 : open.has(d.dataset.game)));
  renderKoeLogForm();
}
// The owner's box: pick a game, the pool, paste DraftKings' list, save. Shown
// only to the owner (html.is-owner) and on localhost; the server checks again.
function koeFinishedGames() {
  return (DATA.schedule || []).filter((g) => g.status === "final").sort((a, b) => (`${b.date} ${b.time}` < `${a.date} ${a.time}` ? -1 : 1));
}
function renderKoeLogForm() {
  const pick = document.getElementById("koe-log-game");
  if (!pick) return;
  const games = koeFinishedGames();
  const keep = pick.value;
  pick.innerHTML = games.map((g) => `<option value="${g.game_id}">Wk ${g.week} · ${g.away} @ ${g.home}${g.weekday ? ` (${g.weekday.slice(0, 3)})` : ""}</option>`).join("");
  const lastMonday = games.find((g) => /^mon/i.test(g.weekday || ""));
  pick.value = keep && games.some((g) => g.game_id === keep) ? keep : (lastMonday || games[0] || {}).game_id || "";
  document.getElementById("koe-log").hidden = !games.length;
  fillKoeLogForm();
}
function fillKoeLogForm() {
  const id = document.getElementById("koe-log-game").value;
  const logged = KOE_PAYOUTS[id];
  const lastPool = Object.values(KOE_PAYOUTS).map((d) => d.pool).filter(Boolean).pop();
  const pool = (logged && logged.pool) || lastPool;
  document.getElementById("koe-log-pool").value = pool ? pool.toLocaleString("en-US") : "";
  document.getElementById("koe-log-text").value = logged ? logged.payouts.map((p) => `${p.name} - ${koeMoney(p.paid)}`).join("\n") : "";
  checkKoeLogForm();
}
function koeLogRead() {
  const g = koeGame(document.getElementById("koe-log-game").value);
  return g ? koeParse(document.getElementById("koe-log-text").value, g) : { read: [], missed: [] };
}
const koeLogPool = () => Math.round(Number(document.getElementById("koe-log-pool").value.replace(/[^\d.]/g, ""))) || 0;
function checkKoeLogForm() {
  const { read, missed } = koeLogRead();
  const status = document.getElementById("koe-log-status");
  const noPool = read.length && !koeLogPool();
  status.className = `koe-log-status${missed.length || noPool ? " koe-log-bad" : read.length ? " koe-log-good" : ""}`;
  status.textContent = missed.length ? `Not in that game: ${missed.join(", ")}` : noPool ? "Enter the pool" : read.length ? `✓ ${read.length} player${read.length === 1 ? "" : "s"} matched` : "Paste DraftKings' list: one player and $ amount a line";
  document.getElementById("koe-log-save").disabled = !!missed.length || !!noPool;
}
async function saveKoePayouts() {
  const btn = document.getElementById("koe-log-save");
  const game = document.getElementById("koe-log-game").value;
  const pool = koeLogPool();
  const { read, missed } = koeLogRead();
  if (missed.length || (read.length && !pool)) return;
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const res = await fetch("/api/koe-payouts", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game, pool: pool || 1, payouts: read }) });
    if (!res.ok) throw new Error(String(res.status));
    if (read.length) KOE_PAYOUTS[game] = { pool, payouts: read };
    else delete KOE_PAYOUTS[game];
    btn.textContent = "Saved";
    renderKoeWinners();
  } catch (e) {
    btn.textContent = "Couldn't save";
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save";
  }, 2000);
}

async function saveKoeImage() {
  const btn = document.getElementById("koe-save");
  const el = document.getElementById("koe-capture");
  btn.disabled = true;
  btn.textContent = "Saving...";
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
    // Capture at the table's full width even if the window is narrower.
    el.classList.add("koe-capturing");
    const url = await window.htmlToImage.toPng(el, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      fontEmbedCSS: await summaryFontCSS(),
      includeQueryParams: true,
      width: el.scrollWidth,
      height: el.scrollHeight,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `king-of-the-endzone-${[...koeTeams].sort().join("-") || "week"}.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  el.classList.remove("koe-capturing");
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}

document.addEventListener("input", (e) => {
  if (e.target.closest("#koe-log-text, #koe-log-pool")) checkKoeLogForm();
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#koe-log-game")) fillKoeLogForm();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#koe-save")) {
    saveKoeImage();
    return;
  }
  if (e.target.closest("#koe-log-save")) {
    saveKoePayouts();
    return;
  }
  if (e.target.closest(".koe-win-day, #koe-log")) return;
  const team = e.target.closest(".koe-team");
  const game = e.target.closest(".koe-at");
  const pos = e.target.closest("[data-pos]");
  const sort = e.target.closest(".koe-sort");
  if (team) {
    const t = team.dataset.team;
    koeTeams.has(t) ? koeTeams.delete(t) : koeTeams.add(t);
  } else if (game) {
    const [a, h] = game.dataset.game.split("|");
    const on = koeTeams.has(a) && koeTeams.has(h);
    [a, h].forEach((t) => (on ? koeTeams.delete(t) : koeTeams.add(t)));
  } else if (e.target.closest("#koe-wk-prev, #koe-wk-next")) {
    const weeks = koeWeeks();
    const i = weeks.indexOf(koeWeek()) + (e.target.closest("#koe-wk-prev") ? -1 : 1);
    if (i < 0 || i >= weeks.length) return;
    koeWeekSel = koeIsLive(weeks[i]) ? null : weeks[i];
  } else if (e.target.closest("#koe-all")) {
    koeGamesOf().forEach((g) => (koeTeams.add(g.away), koeTeams.add(g.home)));
  } else if (e.target.closest("#koe-none")) {
    koeTeams.clear();
  } else if (pos) {
    koePos = pos.dataset.pos;
  } else if (sort) {
    const k = sort.dataset.sort;
    koeSort = koeSort.key === k ? { key: k, dir: -koeSort.dir } : { key: k, dir: k === "name" ? 1 : -1 };
  } else {
    return;
  }
  saveKoeTeams();
  renderKoe();
});

Promise.all([
  fetch("data.json").then((r) => r.json()),
  fetch("koe_weeks.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
  koeLoadPayouts(),
])
  .then(([data, weeks, payouts]) => {
    DATA = data;
    KOE_WEEKS = weeks && weeks.season === data.season ? weeks : { boards: {}, results: {} };
    KOE_PAYOUTS = payouts;
    koeTeams = loadKoeTeams();
    renderKoe();
  })
  .catch((err) => {
    document.getElementById("koe-players").innerHTML = "<p>Couldn't load data.json.</p>";
    console.error(err);
  });
