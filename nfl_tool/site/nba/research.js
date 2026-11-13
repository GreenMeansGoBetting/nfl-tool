// GMG NBA Suite: the prop research pages, Points / Threes / Rebounds / Assists (2026-11-03).
// They replace the game sim's boards. The owner, 2026-11-03: "I do not feel comfortable giving
// people projections based on incomplete info" (rest days, late scratches, a team going in with
// six players); "I would like people to be able to click into betting categories, like assists and
// rebounds, and get information and data that relates to those categories and see available bets
// and lines." So: no projection, no pick, no edge, no rating. Every number is a real count from
// this season's games, beside every book's line, and the member draws the conclusion.
// One page a market: the page's <body data-market="points"> picks its config below. All Props
// (all-props.html, data-market="all"; the owner, 2026-11-04: for members who "don't care about what
// stats they are") runs the list for every market and puts the rows on one list: setMarket() switches
// everything market-specific (MK, the panel's tabs, their hints), and every cache is kept per market.
// A row: his main line (the middle of the books'), the best Over / Under across the member's books
// (click: every book; the box saves to My Plays), his average and minutes (season, last 5), how
// often he went over tonight's line, what tonight's defense allows to his position, and how he did
// in the games each teammate on tonight's injury report missed (the With / Without read).
// From props.json `seasons[...]`: players {log, pos, team}, out {team: {game: [[id, why]]}}.

const RS_MARKETS = {
  points: { market: "points", stat: "pts", unit: "Points", short: "PTS", swing: 3 },
  threes: { market: "threes", stat: "fg3m", unit: "Threes", short: "3PM", swing: 0.8 },
  rebounds: { market: "rebounds", stat: "reb", unit: "Rebounds", short: "REB", swing: 1.5 },
  assists: { market: "assists", stat: "ast", unit: "Assists", short: "AST", swing: 1.2 },
};
const ALL_PROPS = document.body.dataset.market === "all";
const ALL_ORDER = ["points", "threes", "assists", "rebounds"]; // All Props: the markets, in the menu's order
const STAT_HUE = { points: 210, threes: 275, assists: 330, rebounds: 185 }; // each market's pill color (the menu's)
let MK = RS_MARKETS[document.body.dataset.market] || RS_MARKETS.points;
const ROTATION_MIN = 12; // Every Player: players at this many minutes a game or more
const KEY_MIN = 20; // a teammate this many minutes a game gets a With / Without pill when he's on the report
const SMALL = 3; // fewer games than this without a teammate = Small Sample, never colored
const DAYS_AHEAD = 3; // the day arrows reach this many slates

let DATA = null;
let PROPS = null;
let dayIndex = 0;
let gameId = "";
const LIST = { game: "", pos: "", every: false, sort: ALL_PROPS ? "ro" : "line", dir: -1 };
// The research panel under a clicked row: Points, Threes, Rebounds and Assists (props.json `research`, research.py).
const PANEL = true; // every market has its panel (Assists, 2026-11-04)
let THREES = false, REBS = false, ASTS = false; // the market in play (setMarket)
let OPEN = ""; // "<market>:<game id>:<player id>" of the open row (openKey)
const openKey = (x) => `${x.mk}:${x.g.game_id}:${x.pid}`;

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="nba-headshot" loading="lazy" onerror="this.style.visibility='hidden'">`;
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "--" : Number(n).toFixed(d));
const signed = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "&minus;" : ""}${Math.abs(n).toFixed(d)}`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const lastName = (name) => String(name || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").split(" ").slice(-1)[0];

// ---- this season's games (props.json) ----
const seasonBlock = () => (PROPS.seasons || {})[String(DATA.season)] || Object.values(PROPS.seasons || {})[0] || { players: {}, out: {}, fields: [] };
const logFields = () => Object.fromEntries((seasonBlock().fields || []).map((f, i) => [f, i]));
const playerOf = (pid) => seasonBlock().players[pid] || null;
const logOf = (pid) => (playerOf(pid) || {}).log || [];
const nameOf = (pid) => (playerOf(pid) || {}).name || pid;
const statOf = (r, f) => r[f[MK.stat]] || 0;
// for the player card (nba-card.js): the game open on the page
function currentGame() {
  return DATA ? DATA.schedule.find((g) => g.game_id === gameId) || null : null;
}

// ---- the slate ----
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Every night played this season (the arrows step back to opening night, the owner 2026-11-05: "go
// back days like the other tools and see how things did"), then the next slates from today. The
// page opens on today's slate; with none ahead (the off-season), on the last night played.
let DAYS = null;
function days() {
  if (DAYS) return DAYS.all;
  const today = todayET();
  const sched = [...new Set(DATA.schedule.map((g) => g.date))].sort();
  const ahead = sched.filter((d) => d >= today).slice(0, DAYS_AHEAD);
  const past = [...new Set([...sched, ...Object.keys(pastGames())])].filter((d) => d < today).sort();
  DAYS = { all: [...past, ...ahead], start: ahead.length ? past.length : Math.max(0, past.length - 1) };
  return DAYS.all;
}
const startDay = () => (days(), DAYS.start);
const isPast = (date) => Boolean(date) && date < todayET();
// A past night's games from this season's logs: {date: {game id: {away, home, away_score, home_score}}}
// (data.json's schedule only reaches back to yesterday).
let PAST_GAMES = null;
function pastGames() {
  if (PAST_GAMES) return PAST_GAMES;
  const f = logFields();
  const out = {};
  for (const p of Object.values(seasonBlock().players)) {
    for (const r of p.log || []) {
      const night = (out[r[f.date]] = out[r[f.date]] || {});
      const g = (night[String(r[f.game])] = night[String(r[f.game])] || {});
      const mine = f.score === undefined ? null : r[f.score], theirs = f.opp_score === undefined ? null : r[f.opp_score];
      // a side named as someone's opponent is sure; his own team (today's) only fills a side nobody named
      if (r[f.home]) Object.assign(g, { away: r[f.opp], th: p.team, home_score: mine, away_score: theirs });
      else Object.assign(g, { home: r[f.opp], ta: p.team, away_score: mine, home_score: theirs });
    }
  }
  for (const night of Object.values(out)) {
    for (const g of Object.values(night)) {
      g.away = g.away || g.ta;
      g.home = g.home || g.th;
      delete g.ta;
      delete g.th;
    }
  }
  return (PAST_GAMES = out);
}
function gamesOn(date) {
  const sched = DATA.schedule.filter((g) => g.date === date);
  if (!isPast(date)) return sched;
  // a past night: the schedule's games plus the logs' others; spread and total from research `games`
  const ids = new Set(sched.map((g) => String(g.game_id)));
  const logged = Object.entries(pastGames()[date] || {}).filter(([id, t]) => !ids.has(id) && t.away && t.home)
    .map(([id, t]) => ({ game_id: id, date, time: "", start_utc: "", status: "final", ...t }));
  return [...sched, ...logged].map((g) => {
    const rg = RS().games[String(g.game_id)] || [];
    const lg = (pastGames()[date] || {})[String(g.game_id)] || {};
    return { ...g, home_team_spread: g.home_team_spread ?? rg[2] ?? null, total_line: g.total_line ?? rg[1] ?? null,
      away_score: g.away_score ?? lg.away_score ?? null, home_score: g.home_score ?? lg.home_score ?? null };
  });
}
// A game has started once its tip time has passed (times are Eastern, fixed UTC-4 like the build).
const started = (g) => g.status === "final" || (Boolean(g.time) && Date.now() >= Date.parse(`${g.date}T${g.time}:00-04:00`));

// ---- the books' lines (data.json book_odds) ----
function bookGame(g) {
  return ((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {};
}
// The player card's main-line rule (nba-card.js nbaCardMainLine), never the middle of every line
// listed: the exchanges' side lines pulled that up (2026-11-06, Holiday's threes at 3.5, +400).
function mainLine(g, pid) {
  return nbaCardMainLine((((bookGame(g)[MK.market] || {})[pid] || {}).q) || []);
}
// The best price; clicking it lists every book, and a price there saves the play to My Plays at that
// book and price (the owner, 2026-11-04: no check box in the row, "it allows them to track at the same
// price"). A saved side gets a check mark. Over and Under are one play (the card's rule).
function sideCell(g, pid, side, line, tm) {
  if (line === null) return '<td class="rs-price"><span class="muted-label">--</span></td>';
  const save = { mk: MK.market, gid: g.game_id, date: g.date, away: g.away, home: g.home, pid, tm, side, line };
  const spec = { kind: "prop", stat: MK.market, team: tm, game: `${g.away}_${g.home}`, pid, side, line, title: `${nameOf(pid)} ${MK.unit}`, sub: `${g.away} @ ${g.home}`, short: true, save };
  const pill = bookPricePill(spec);
  if (!pill) return '<td class="rs-price"><span class="muted-label">--</span></td>';
  const mine = window.bookPlaySaver.saved(save);
  if (mine) return `<td class="rs-price">${pill}<span class="rs-saved" title="In My Plays at ${showOdds(Number(mine.odds))} (${GMG_BOOKS[mine.book] || mine.book})">&#10003;</span></td>`;
  // an alt line (or a main line the books have since moved off) on this side: a check with "Alt" (a member, 2026-11-09)
  const alts = otherSaved(save);
  return `<td class="rs-price">${pill}${alts.length ? `<span class="rs-saved rs-saved-alt" title="In My Plays:\n${alts.map((s) => `${s.side === "under" ? "Under" : "Over"} ${s.line} at ${showOdds(Number(s.odds))} (${GMG_BOOKS[s.book] || s.book})`).join("\n")}">&#10003;<small>Alt</small></span>` : ""}</td>`;
}
// Every saved play on this player, stat, game and side at another line than tonight's main one.
function otherSaved(k) {
  const side = k.side === "u" ? "under" : "over";
  return loadNbaPlays().filter((s) => s.market === (k.mk || MK.market) && String(s.game_id) === String(k.gid)
    && String(s.player_id) === String(k.pid) && s.side === side && Number(s.line) !== Number(k.line));
}
const rsEntry = (k, book = null, odds = null) => nbaCardEntry(k.mk || MK.market, { game_id: k.gid, date: k.date, away: k.away, home: k.home },
  { id: k.pid, name: nameOf(k.pid), team: k.tm }, k.side, k.line, [book, null, null, odds]);
window.bookPlaySaver = {
  saved(k) {
    const e = rsEntry(k);
    const s = loadNbaPlays().find((x) => x.id === e.id);
    return s && s.side === e.side && Number(s.line) === Number(e.line) ? s : null;
  },
  toggle(k, book, odds) {
    const e = rsEntry(k, book, odds);
    const now = window.bookPlaySaver.saved(k);
    const rest = loadNbaPlays().filter((x) => x.id !== e.id);
    saveNbaPlays(now && now.book === book && Number(now.odds) === odds ? rest : [...rest, { ...e, added_at: new Date().toISOString() }]);
    renderList();
  },
};

// ---- the injury report (data.json injuries, ESPN's list + the NBA's report) ----
const reportOf = (tm) => (DATA.injuries || {})[tm] || [];
const statusOf = (tm, pid) => (reportOf(tm).find((x) => String(x.id) === String(pid)) || {}).status || "";
const isOut = (status) => /^(out|doubtful)/i.test(status);
const STATUS_SHORT = { "day-to-day": "DTD", questionable: "Q", probable: "P", doubtful: "D", out: "Out" };
const statusPill = (status) => {
  if (!status) return "";
  const short = STATUS_SHORT[status.toLowerCase()] || status;
  return `<span class="rs-inj${isOut(status) ? " out" : ""}" title="Injury report: ${status}">${short}</span>`;
};

// ---- what each defense allows to each position (this season, real games) ----
// Every player's game: his number against that opponent goes to the opponent's total for his
// position; a game a team played counts once. Per game = total / that team's games.
// cut = a past night: only the games before it count (what the defense had allowed going in).
const ALLOWED = {}; // per market (and night)
function allowed(cut = null) {
  const k = `${MK.market}|${cut || ""}`;
  if (ALLOWED[k]) return ALLOWED[k];
  const f = logFields();
  const sums = {}, games = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (!p.pos) continue;
    for (const r of p.log || []) {
      const opp = r[f.opp];
      if (!opp || (cut && r[f.date] >= cut)) continue;
      ((sums[opp] = sums[opp] || {})[p.pos] = (sums[opp][p.pos] || 0) + statOf(r, f));
      (games[opp] = games[opp] || new Set()).add(r[f.game]);
    }
  }
  const per = {};
  for (const [opp, byPos] of Object.entries(sums)) {
    for (const [pos, total] of Object.entries(byPos)) ((per[pos] = per[pos] || {})[opp] = { v: total / games[opp].size, n: games[opp].size });
  }
  const ranks = {};
  for (const [pos, teams] of Object.entries(per)) {
    const sorted = Object.entries(teams).sort((a, b) => b[1].v - a[1].v);
    ranks[pos] = { n: sorted.length, league: avg(sorted.map(([, x]) => x.v)), r: Object.fromEntries(sorted.map(([t], i) => [t, i + 1])) };
  }
  ALLOWED[k] = { per, ranks };
  return ALLOWED[k];
}
// The site's 8-step rank colors (league.js rankStyle), 1st = allows the most = greenest.
const RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const rankStyle = (rank, total) => {
  const [hue, fill] = RANK_SCALE[Math.min(RANK_SCALE.length - 1, Math.floor(((rank - 1) / total) * RANK_SCALE.length))];
  return `background:${scaleHsla(hue, 78, 44, fill)}`;
};

// ---- With / Without: his games each teammate on tonight's report missed ----
// A teammate "missed" a game when the box score lists him as not playing (props.json `out`);
// games he wasn't on the team for count on neither side.
function withoutRows(pid, tm) {
  const f = logFields();
  const mine = logOf(pid);
  const outs = seasonBlock().out[tm] || {};
  const rows = [];
  for (const inj of reportOf(tm)) {
    const mate = String(inj.id);
    if (mate === String(pid) || /^probable/i.test(inj.status)) continue;
    const theirs = logOf(mate);
    const mins = avg(theirs.map((r) => r[f.min] || 0));
    if (!theirs.length || mins < KEY_MIN) continue;
    const played = new Set(theirs.map((r) => String(r[f.game])));
    const sat = (r) => (outs[String(r[f.game])] || []).some(([id]) => String(id) === mate);
    const withHim = mine.filter((r) => played.has(String(r[f.game]))).map((r) => statOf(r, f));
    const without = mine.filter((r) => !played.has(String(r[f.game])) && sat(r)).map((r) => statOf(r, f));
    rows.push({ mate, name: inj.name || nameOf(mate), status: inj.status, out: isOut(inj.status), mins,
      without: avg(without), n: without.length, with: avg(withHim), nWith: withHim.length });
  }
  return rows.sort((a, b) => b.out - a.out || b.mins - a.mins);
}
function withoutPill(w) {
  const label = `${w.out ? "No" : "If No"} ${lastName(w.name)}`;
  const base = `${w.name} (${w.status}, ${fmt(w.mins)} min a game)`;
  if (!w.n) return `<span class="sim-rtag wait" title="${base}: they haven't missed a game together this season">${label}: 0 G</span>`;
  const diff = w.with === null ? null : w.without - w.with;
  const small = w.n < SMALL;
  const cls = small || diff === null || Math.abs(diff) < MK.swing ? "" : diff > 0 ? " good" : " bad";
  const tip = `${base}: ${fmt(w.without)} ${MK.unit.toLowerCase()} a game in the ${w.n} game${w.n === 1 ? "" : "s"} he missed`
    + (w.with === null ? "" : `, ${fmt(w.with)} in ${w.nWith} with him`) + (small ? " (Small Sample)" : "");
  return `<span class="sim-rtag${cls}${w.out ? "" : " rs-maybe"}" title="${tip}">${label}: ${fmt(w.without)}${diff === null ? "" : ` (${signed(diff)})`} &middot; ${w.n} G</span>`;
}

// ---- tonight's game (the owner, 2026-11-03: "add some relevant data past OPP ALLOWS (maybe pace
// stats for the matchup)"): the game's pace (both teams' average, ranked among the 30 teams' own
// paces, 1st = fastest), his team's spread and the total (colored by where it sits among this
// season's game totals, higher = greener) ----
function tonightGame(g, tm, opp) {
  const teams = identityTeams();
  const paces = Object.values(teams).map((t) => t.off_pace).filter((v) => v !== null && v !== undefined);
  const pace = teams[tm] && teams[opp] && teams[tm].off_pace && teams[opp].off_pace ? (teams[tm].off_pace + teams[opp].off_pace) / 2 : null;
  const paceRank = pace === null ? null : paces.filter((v) => v > pace).length + 1;
  const hs = g.home_team_spread;
  const totals = Object.values(RS().games || {}).map((x) => x[1]).filter((v) => v !== null && v !== undefined);
  return { pace, paceRank, paceN: paces.length, spread: hs === null || hs === undefined ? null : tm === g.home ? hs : -hs,
    total: g.total_line ?? null, totalS: g.total_line === null || g.total_line === undefined ? null : spread(g.total_line, totals) };
}

// ---- the rows ----
// The list's season numbers, each colored against his position's rotation players (the same color
// as his Season tile in Form): his average, then minutes (Points) or threes tried (Threes), then
// Volume: his share of his team's shots on the floor (Points) or the share of his shots that are
// threes (Threes). The owner, 2026-11-04: no L5 under them (cluttered), a Volume column, all colored.
// Rebounds: Volume = his share of the rebounds there to get while he's on the floor (research.py `rb`).
function listNums(p, pid, log = p.log || []) {
  const f = logFields();
  const sum = (k) => log.reduce((a, r) => a + (r[f[k]] || 0), 0);
  const fga = sum("fga");
  return { avgV: log.length ? sum(MK.stat) / log.length : null, second: log.length ? sum(THREES ? "fg3a" : "min") / log.length : null,
    vol: THREES ? (fga ? sum("fg3a") / fga : null) : REBS ? rebShare(pid) : ASTS ? astRate(pid) : p.share ?? null };
}
function astRate(pid) {
  const a = (((PROPS.research || {}).players || {})[pid] || {}).ap;
  return a && a[0] ? a[1] / a[0] : null;
}
function rebShare(pid) {
  const r = (((PROPS.research || {}).players || {})[pid] || {}).rb;
  return r && r[0] + r[2] ? (r[1] + r[3]) / (r[0] + r[2]) : null;
}
const LIST_POOL = {};
// cut = a past night: each pool player's games before it
const logBefore = (log, cut) => (cut ? (log || []).filter((r) => r[logFields().date] < cut) : log || []);
function listPool(pos, cut = null) {
  const key = `${MK.market}:${pos}|${cut || ""}`;
  if (!LIST_POOL[key]) {
    const nums = posPool(pos).map(([id, q]) => listNums(q, id, logBefore(q.log, cut)));
    LIST_POOL[key] = { avgV: nums.map((n) => n.avgV), second: nums.map((n) => n.second), vol: nums.map((n) => n.vol) };
  }
  return LIST_POOL[key];
}
function hits(rows, line, f) {
  if (line === null || line === undefined || !rows.length) return null;
  return { over: rows.filter((x) => statOf(x, f) > line).length, of: rows.length };
}
// research `players[id]`: his saved main line by game, in the market in play (the line history)
const lineKey = () => (THREES ? "lines3" : REBS ? "linesr" : ASTS ? "linesa" : "lines");
const NO_READS = { o: 0, u: 0, n: 0, by: [], nums: {} };
// A past night's Reads as they stood before tip (the owner, 2026-11-05: "lock the info that comprises
// those boxes before that game is played"): saved by the deploy (rsCapture, reads_record.py), in
// props.json `research.frozen` {game: {tabs: {market: [tab]}, m: {market: {player: [o, u, n, vol, by]}}}}.
// Nights before the saving began have none ("--"): today's panel would leak that night's game in.
const frozenOf = (gid, pid) => ((((RS().frozen || {})[gid] || {}).m || {})[MK.market] || {})[pid] || null;
function frozenReads(gid, fz) {
  if (!fz) return NO_READS;
  const tabs = ((((RS().frozen || {})[gid] || {}).tabs || {})[MK.market]) || [];
  const by = tabs.map((t, i) => { const c = (fz[4] || [])[i] || [0, 0, 0, 0]; return { t, o: c[0], u: c[1], n: c[2], na: c[3] }; }).filter((c) => c.n);
  return { o: fz[0], u: fz[1], n: fz[2], by, nums: {}, frozen: true };
}
// The deploy's freeze (tools/nba_reads_capture.py, on All Props): every untipped game's O / U Reads and
// Volume in every market, exactly what a member with no filters sees now.
function rsCapture() {
  const keep = { ...LIST }, keepMk = MK.market;
  Object.assign(LIST, { game: "", pos: "", every: false });
  const out = {};
  try {
    for (const d of days().filter((day) => !isPast(day))) {
      for (const m of ALL_ORDER) {
        setMarket(m);
        const tabs = [...RS_TABS.left, ...RS_TABS.right].filter((t) => READ_TABS.includes(t));
        for (const x of rowsOn(d)) {
          if (x.line === null || x.live) continue;
          const gid = String(x.g.game_id);
          const e = (out[gid] = out[gid] || { date: d, tabs: {}, m: {} });
          e.tabs[m] = tabs;
          const by = tabs.map((t) => { const c = x.reads.by.find((b) => b.t === t); return c ? [c.o, c.u, c.n, c.na] : [0, 0, 0, 0]; });
          (e.m[m] = e.m[m] || {})[x.pid] = [x.reads.o, x.reads.u, x.reads.n, x.vol === null || x.vol === undefined ? null : Math.round(x.vol * 10000) / 10000, by];
        }
      }
    }
  } finally {
    Object.assign(LIST, keep);
    setMarket(keepMk);
  }
  return out;
}
// A past night (the owner, 2026-11-05): his line that night (the line history, saved until tip),
// every number from his games BEFORE that night, and the Result: Over / Under and what he put up.
function rowsOn(date) {
  const f = logFields();
  const past = isPast(date);
  const cut = past ? date : null;
  const A = allowed(cut);
  const out = [];
  for (const g of gamesOn(date)) {
    if (LIST.game && String(g.game_id) !== String(LIST.game)) continue;
    const gid = String(g.game_id);
    for (const [pid, p] of Object.entries(seasonBlock().players)) {
      const night = past ? (p.log || []).find((r) => String(r[f.game]) === gid) || null : null;
      const tm = night ? (night[f.home] ? g.home : g.away) : p.team; // a past night: the team he played for
      if (tm !== g.away && tm !== g.home) continue;
      if (LIST.pos && p.pos !== LIST.pos) continue;
      const log = logBefore(p.log, cut);
      const line = past ? ((rsOf(pid)[lineKey()] || {})[gid] ?? null) : mainLine(g, pid);
      const status = past ? "" : statusOf(tm, pid);
      const fz = past ? frozenOf(gid, pid) : null; // his Reads and Volume as saved before tip
      const mins = avg(log.map((r) => r[f.min] || 0));
      if (line === null && (!LIST.every || !log.length || mins < ROTATION_MIN || (past ? !night : isOut(status)))) continue;
      const opp = tm === g.home ? g.away : g.home;
      const vals = log.map((r) => statOf(r, f));
      const last5 = log.slice(-5);
      const lastRow = log.length ? log[log.length - 1] : null;
      out.push({
        last: lastRow ? { v: statOf(lastRow, f), s: spread(statOf(lastRow, f), vals), date: lastRow[f.date], opp: lastRow[f.opp], home: Boolean(lastRow[f.home]) } : null,
        mk: MK.market, g, pid, p, team: tm, opp, home: tm === g.home, line, status, live: past ? false : started(g), gp: log.length, past, cut,
        result: night ? statOf(night, f) : null, resultMin: night ? night[f.min] : null,
        avg: avg(vals), min: mins, ...listNums(p, pid, log), ...(fz && fz[3] !== null && fz[3] !== undefined ? { vol: fz[3] } : {}),
        hits: { l5: hits(last5, line, f), l10: hits(log.slice(-10), line, f), all: hits(log, line, f),
          home: hits(log.filter((r) => r[f.home]), line, f), away: hits(log.filter((r) => !r[f.home]), line, f) },
        allow: ((A.per[p.pos] || {})[opp]) || null, allowRank: ((A.ranks[p.pos] || { r: {} }).r[opp]) ? dRank(A.ranks[p.pos].r[opp], A.ranks[p.pos].n) : null,
        allowN: (A.ranks[p.pos] || {}).n || 0, allowLeague: (A.ranks[p.pos] || {}).league,
        without: past ? [] : withoutRows(pid, tm), game: tonightGame(g, tm, opp),
      });
      // the Reads come from the panel, which reads the whole season: none on a past night
      out[out.length - 1].reads = past ? frozenReads(gid, fz) : readsOf(out[out.length - 1]);
      out[out.length - 1].tm = typeMatch(out[out.length - 1]);
    }
  }
  return out;
}
// ---- Reads: every Read tile in his panel, counted (the owner, 2026-11-04) ----
// The list's O and U columns: how many of the panel's reads say Over / Under, out of every Read tile
// on the page, so every player on a page is out of the same number (the owner: "isn't all players
// going to read /x"); a read with no data yet ("--") and an Even count as neither. Not a pick: the
// same reads the panel shows, added up. Form compares him to his position, so a star facing a weak
// defense leans Over (the owner, 2026-11-04: "luka is facing a weak defense thats why he shows").
const READ_TABS = ["Form", "Scoring", "Matchup", "Shooting", "Rebounding", "Miss Zones", "Playmaking", "Assist Zones"];
const READ_CACHE = {};
function readsOf(x) {
  const key = openKey(x);
  if (READ_CACHE[key]) return READ_CACHE[key];
  const tabs = [...RS_TABS.left, ...RS_TABS.right].filter((t) => READ_TABS.includes(t));
  const r = { o: 0, u: 0, n: 0, by: [], nums: {} }; // nums: "<tab>|<row>" -> the row's numbers (filters)
  if (PROPS.research) {
    for (const t of tabs) {
      READS = [];
      try { RS_TAB[t](x); } catch (e) { READS = []; }
      const got = READS.filter((v) => !v.none).map((v) => v.t);
      const c = { t, o: got.filter((v) => v === "Over").length, u: got.filter((v) => v === "Under").length, n: got.length, na: got.filter((v) => v === "--").length };
      r.o += c.o; r.u += c.u; r.n += c.n;
      if (c.n) r.by.push(c);
      for (const v of READS) if (v.num) r.nums[`${t}|${v.num.label}`] = v.num;
    }
    READS = null;
  }
  return (READ_CACHE[key] = r);
}
const hitShare = (h) => (h ? h.over / h.of : -1);
const SORTS = {
  line: (x) => (x.line === null ? -1 : x.line), avg: (x) => x.avg ?? -1, second: (x) => x.second ?? -1, vol: (x) => x.vol ?? -1,
  l5: (x) => hitShare(x.hits.l5), l10: (x) => hitShare(x.hits.l10), all: (x) => hitShare(x.hits.all),
  home: (x) => hitShare(x.hits.home), away: (x) => hitShare(x.hits.away), allow: (x) => (x.allowRank || -99),
  tmatch: (x) => (x.tm && x.tm.c ? x.tm.c.avg : -99),
  ro: (x) => (x.reads.n ? x.reads.o / x.reads.n : -1), ru: (x) => (x.reads.n ? x.reads.u / x.reads.n : -1),
  pace: (x) => x.game.pace ?? -1, spread: (x) => (x.game.spread === null ? 99 : -x.game.spread), total: (x) => x.game.total ?? -1,
  result: (x) => x.result ?? -1,
  last: (x) => (x.last && x.last.s !== null ? x.last.s : -2),
};
// All Props: every market's rows on one list, each row keeping its market (x.mk)
function rowsOnAll(date) {
  const out = [];
  for (const m of ALL_ORDER) {
    setMarket(m);
    out.push(...rowsOn(date));
  }
  return out;
}
const rowsToday = (date) => (ALL_PROPS ? rowsOnAll(date) : rowsOn(date));
function sortedRows(date) {
  const key = SORTS[LIST.sort] || SORTS.line;
  // the member's filters (filters.js), then: started games at the bottom; a player with no line after the ones with one
  const rows = typeof rfApply === "function" ? rfApply(rowsToday(date)) : rowsToday(date);
  return rows.sort((a, b) => a.live - b.live || (a.line === null) - (b.line === null) || LIST.dir * (key(a) - key(b)) || (b.min || 0) - (a.min || 0));
}

// ---- the table ----
// The columns for the market in play. All Props keeps only the ones that mean the same thing for every
// market (no Min / 3PA, no Volume; the owner, 2026-11-04: "if people want to click into the specific
// category they can") and adds the Stat pill after the player.
let COLS = [];
const colsFor = () => [
  { label: "Player", cls: "sim-th-player" },
  ...(ALL_PROPS ? [{ label: "Stat", title: "The stat this line is for (click it for that stat's own page)" }] : []),
  { label: "Line", key: "line", title: "His main line: the middle of the books' lines" },
  { label: "Over", title: "The best Over price across your books (click for every book; click a price there to save it to My Plays)" },
  { label: "Under", title: "The best Under price across your books (click for every book; click a price there to save it to My Plays)" },
  { label: "Avg", key: "avg", title: `His ${ALL_PROPS ? "number in that stat" : MK.unit.toLowerCase()} a game this season (colored against his position)` },
  ...(ALL_PROPS ? [] : [THREES ? { label: "3PA", key: "second", title: "His threes tried a game this season (colored against his position)" } : { label: "Min", key: "second", title: "His minutes a game this season (colored against his position)" },
  { label: "Volume", key: "vol", title: THREES ? "The share of his shots that are threes this season (colored against his position)"
    : REBS ? "His share of the rebounds there to get while he's on the floor this season (colored against his position)"
    : ASTS ? "His assist rate: the share of his teammates' made shots he assisted while on the floor this season (colored against his position)" : "His share of his team's shots while he's on the floor this season (colored against his position)" }]),
  { label: "Last<br>Game", key: "last", title: `What he put up in his last game, and how far that was from his average (colored against his own games this season: green = one of his best, red = one of his worst; sorts by that)` },
  { label: "L5", key: "l5", hit: true, title: "His last 5 games over tonight's line" },
  { label: "L10", key: "l10", hit: true, title: "His last 10 games over tonight's line" },
  { label: "Season", key: "all", hit: true, title: "This season's games over tonight's line" },
  { label: "Home", key: "home", hit: true, title: "Home games over tonight's line" },
  { label: "Away", key: "away", hit: true, title: "Road games over tonight's line" },
  { label: "Opp<br>Allows", key: "allow", title: `What tonight's opponent allows a game in ${ALL_PROPS ? "that stat" : MK.unit.toLowerCase()} to his position, and where that ranks (1st = the most)` },
  ...(ALL_PROPS || TM_FIELD[MK.market] ? [{ label: "Type<br>Matchup", key: "tmatch", title: "Players of his type (his colored letter, Player Types) against tonight's defense: how far over or under THEIR OWN averages they ran, how many of those games they beat it, ranked of the defenses (30th = gives up the most to his type, red). Points and Threes only (the types are how players shoot)." }] : []),
  { label: "O", key: "ro", read: true, title: `How many of the Reads in his research panel say Over, out of every Read on ${ALL_PROPS ? "that stat's" : "this"} page (colored by that share). The reads compare him to his position, so a star facing a weak defense leans Over: the line knows how good he is.` },
  { label: "U", key: "ru", read: true, title: `How many of the Reads in his research panel say Under, out of every Read on ${ALL_PROPS ? "that stat's" : "this"} page (colored by that share). The reads compare him to his position, so a bench player facing a tough defense leans Under: the line knows his role.` },
  { label: "Pace", key: "pace", game: true, title: "Tonight's pace: both teams' possessions a 48 minutes, averaged, and where that ranks among the 30 teams (1st = fastest)" },
  { label: "Spread", key: "spread", game: true, title: "His team's spread tonight" },
  { label: "Total", key: "total", game: true, title: "Tonight's total (colored by where it sits among this season's game totals)" },
  { label: "Teammates On The Report", cls: "sim-th-tags", title: "His numbers in the games each teammate on tonight's injury report missed (20+ minute players). No = Out or Doubtful, If No = Day-To-Day or Questionable. The number in brackets is the change from his games with that teammate." },
];
// A past night (the owner, 2026-11-05): no prices (the game is over), no Reads (the panel reads the
// whole season, that night included) and Result in place of Teammates On The Report: Over / Under his
// line that night and his number, colored like Avg.
let PAST = false; // the day on screen is a past night
const resultCol = () => ({ label: "Result", key: "result", cls: "sim-th-tags", title: `How he did that night: Over / Under his line, then his ${ALL_PROPS ? "number" : MK.unit.toLowerCase()} (colored against his position, like Avg)` });
const shownCols = () => (PAST ? [...COLS.filter((c) => c.label !== "Over" && c.label !== "Under" && c.cls !== "sim-th-tags"), resultCol()] : COLS);
function listHead() {
  const C = shownCols();
  const ln = PAST ? "That Night's" : "Tonight's";
  let group = "";
  for (let i = 0; i < C.length; i += 1) {
    const kind = C[i].hit ? "hit" : C[i].game ? "game" : C[i].read ? "read" : "";
    if (kind) {
      let n = 0;
      while (C[i + n] && C[i + n][kind]) n += 1;
      group += kind === "hit" ? `<th colspan="${n}" class="sim-hitgroup" title="How often he went OVER ${PAST ? "that night's line, in his games before that night" : "tonight's line"}"><span>Hit Rate - Over ${ln} Line</span></th>`
        : kind === "read" ? `<th colspan="${n}" class="sim-hitgroup rs-readgroup" title="${PAST ? "The Reads in his research panel as they stood before that game (saved before tip; nights before 11/5 weren't saved)" : "The Reads in his research panel (click his row), added up"}"><span>Reads</span></th>`
        : `<th colspan="${n}" class="sim-hitgroup rs-gamegroup" title="${ln} game"><span>${ln} Game</span></th>`;
      i += n - 1;
    } else group += "<th></th>";
  }
  return `<thead><tr class="sim-group-row">${group}</tr><tr>${C.map((c) => {
    const on = c.key && c.key === LIST.sort;
    const cls = [c.key ? "sim-sort" : "", on ? "on" : "", c.cls || "", c.hit || c.game || c.read ? "sim-hit-th" : ""].filter(Boolean).join(" ");
    return `<th${cls ? ` class="${cls}"` : ""}${c.key ? ` data-sort="${c.key}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${on ? `<span class="sim-arrow">${LIST.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("")}</tr></thead>`;
}
// Every hit rate colored by its percentage: red at 20% or less, yellow at 50%, green at 80% or more.
function hitCell(h, title) {
  if (!h) return '<td class="num sim-hit">--</td>';
  const share = h.over / h.of;
  const hue = Math.round(Math.max(0, Math.min(1, (share - 0.2) / 0.6)) * 135);
  const style = ` style="background:${scaleHsla(hue, 78, 44, 0.24 + Math.min(0.3, Math.abs(share - 0.5)) * 1.1)}"`;
  return `<td class="num sim-hit"${style} title="${title}">${Math.round(share * 100)}%<small>${h.over} of ${h.of}</small></td>`;
}
// Last Game (a member, 2026-11-09: "if someone goes extremely above or below their average the game
// before, they tend to bounce back"): his number, colored by where it sits among his own games this
// season, with the gap from his average under it. A number only, never a call.
function lastCell(x) {
  const L = x.last;
  if (!L) return '<td class="num rs-two">--</td>';
  const st = stepStyle(L.s);
  const tip = `${nameOf(x.pid)}: ${L.v} ${MK.unit.toLowerCase()} ${L.home ? "vs" : "@"} ${L.opp} on ${gameDate(L.date)} (his average ${fmt(x.avg)})`;
  return `<td class="num rs-two"${st ? ` style="${st}"` : ""} title="${tip}"><b>${L.v}</b><small>${x.avg === null ? "" : sgn(L.v - x.avg)}</small></td>`;
}
// ---- Type Matchup (Player Types; the owner, 2026-11-11: the letters across the whole site) ----
// His type against tonight's defense, on Slate Standouts' measuring stick (data.json shot_types.log:
// each night against that player's own other-games average). Beside Opp Allows (his position), never
// replacing it. No pull toward the league: under TM_MIN games it's faded and unranked.
// `assisted` = assisted makes over their own averages (Assist Spots' Targets / Vs Type, 2026-11-13), never a list market
const TM_FIELD = { points: "pts_diff", threes: "m3_diff", assisted: "am_diff" };
const TM_SELF = { points: 1, threes: 2 }; // his own average's place in shot_types.players[].avg
const TM_SCALE = { points: 5, threes: 1.4 }; // this far over / under their averages = the deepest color
const TM_MIN = 6; // Slate Standouts' SS_MIN_GAMES
const TM_CACHE = {};
const tmType = (pid) => ((((typeof DATA !== "undefined" && DATA) || {}).shot_types || {}).players || {})[String(pid)] || null;
// {defense: {type: {n, avg, hit, over, rows}}} from the games before `cut` (a past night never sees itself)
function typeStick(market, cut) {
  const key = `${market}|${cut || ""}`;
  if (TM_CACHE[key]) return TM_CACHE[key];
  const st = (DATA && DATA.shot_types) || {};
  const out = {};
  if (st.log && TM_FIELD[market]) {
    const f = Object.fromEntries(st.log_fields.map((k, i) => [k, i]));
    if (!(TM_FIELD[market] in f)) return (TM_CACHE[key] = out); // a build from before that field existed
    st.log.forEach((r) => {
      if (cut && r[f.date] >= cut) return;
      const p = st.players[r[f.player]];
      if (!p) return;
      const c = ((out[r[f.def]] ||= {})[p.type] ||= { n: 0, sum: 0, over: 0, rows: [] });
      const v = r[f[TM_FIELD[market]]];
      c.n += 1;
      c.sum += v;
      if (v > 0) c.over += 1;
      c.rows.push(r);
    });
    Object.values(out).forEach((bt) => Object.values(bt).forEach((c) => { c.avg = c.sum / c.n; c.hit = c.over / c.n; }));
  }
  return (TM_CACHE[key] = out);
}
// {p (his type entry), c (the cell), rank (30th = gives up the most), n (defenses ranked)} or null
function typeMatch(x) {
  const p = tmType(x.pid);
  if (!p || !TM_FIELD[x.mk]) return null;
  const stick = typeStick(x.mk, x.cut);
  const c = (stick[x.opp] || {})[p.type] || null;
  const ranked = Object.values(stick).map((bt) => bt[p.type]).filter((v) => v && v.n >= TM_MIN);
  const rank = c && c.n >= TM_MIN ? 1 + ranked.filter((v) => v.avg < c.avg).length : null;
  return { p, c, rank, n: ranked.length };
}
function typeCell(x) {
  const m = x.tm;
  if (!m) return '<td class="num rs-allow">--</td>';
  const L = nbaTypeBadge(x.pid);
  if (!m.c) return `<td class="num rs-allow" title="No games yet by his type against ${team(x.opp).name}"><b>--</b><small>${L}</small></td>`;
  const thin = m.c.n < TM_MIN;
  const tip = `Type ${m.p.type} against ${team(x.opp).name}: ${sgn(m.c.avg)} ${MK.unit.toLowerCase()} over their own averages, beat it in ${m.c.over} of ${m.c.n} games${m.rank ? `, ${ordinal(m.rank)} of ${m.n} defenses (30th = gives up the most to ${m.p.type})` : `; under ${TM_MIN} games, not ranked`}`;
  return `<td class="num rs-allow${thin ? " rs-thin" : ""}" style="${m.rank ? rankStyle(m.rank, m.n) : ""}" title="${tip}"><b>${sgn(m.c.avg)}</b><small>${L} ${m.c.over}/${m.c.n}</small></td>`;
}
function allowCell(x) {
  if (!x.allow) return '<td class="num rs-allow">--</td>';
  const tip = `${team(x.opp).name} allow ${fmt(x.allow.v)} ${MK.unit.toLowerCase()} a game to ${x.p.pos}s (league ${fmt(x.allowLeague)}), ${dWords(dRank(x.allowRank, x.allowN), x.allowN)}, over ${x.allow.n} games`;
  return `<td class="num rs-allow" style="${rankStyle(x.allowRank, x.allowN)}" title="${tip}"><b>${fmt(x.allow.v)}</b><small>${ordinal(x.allowRank)} &middot; ${x.p.pos}</small></td>`;
}
// O and U: "x/y", colored by that share on the 8-step scale (more = greener, the site's how-often rule).
const READ_FULL = 0.5; // a share this big or more is the greenest
function readCells(x) {
  const r = x.reads;
  const tip = r.by.map((c) => `${c.t}: ${c.o} Over, ${c.u} Under, ${c.n - c.o - c.u - c.na} Even${c.na ? `, ${c.na} not enough data` : ""}`).join("\n");
  const cell = (k, word) => (r.n ? `<td class="num rs-read" style="${stepStyle(Math.min(1, (r[k] / r.n) / READ_FULL) * 2 - 1)}" title="${r[k]} of his ${r.n} Reads say ${word}${x.past ? " (saved before tip)" : ""}\n${tip}"><b>${r[k]}/${r.n}</b></td>` : `<td class="num rs-read"${x.past ? ' title="Not saved for this night: the Reads are saved before tip from 11/5 on"' : ""}>--</td>`);
  return cell("o", "Over") + cell("u", "Under");
}
function gameCells(x) {
  const gm = x.game;
  const pace = gm.pace === null ? '<td class="num rs-two">--</td>'
    : `<td class="num rs-two" style="${rankStyle(gm.paceRank, gm.paceN || 30)}" title="Tonight's pace ${fmt(gm.pace)} possessions a 48 (${x.team} and ${x.opp} averaged), ${ordinal(gm.paceRank)} fastest of ${gm.paceN}"><b>${fmt(gm.pace)}</b><small>${ordinal(gm.paceRank)}</small></td>`;
  const sp = `<td class="num rs-two" title="${x.team}'s spread tonight"><b>${gm.spread === null ? "--" : gm.spread > 0 ? `+${fmt(gm.spread)}` : fmt(gm.spread)}</b><small>${x.team}</small></td>`;
  const tot = `<td class="num rs-two"${gm.totalS === null ? "" : ` style="${stepStyle(gm.totalS)}"`} title="Tonight's total"><b>${gm.total === null ? "--" : fmt(gm.total)}</b><small>O/U</small></td>`;
  return pace + sp + tot;
}
// Result (a past night): Over / Under / Push on the hit colors, then his number on Avg's scale
function resultCell(x) {
  if (x.result === null) return '<td class="sim-tagc rs-result"><span class="muted-label" title="He didn&#39;t play that night">DNP</span></td>';
  const v = x.result;
  const st = stepStyle(spread(v, listPool(x.p.pos, x.cut).avgV));
  const call = x.line === null ? "" : v > x.line ? "Over" : v < x.line ? "Under" : "Push";
  const hue = call === "Over" ? 135 : call === "Under" ? 0 : 58;
  const tip = `${nameOf(x.pid)}: ${v} ${MK.unit.toLowerCase()} in ${x.resultMin ?? "--"} min${x.line === null ? " (no line that night)" : `, his line was ${fmt(x.line)}`}`;
  return `<td class="sim-tagc rs-result" title="${tip}"><span class="rs-res">${call ? `<span class="rs-res-call" style="background:${scaleHsla(hue, 78, 44, 0.5)}">${call}</span>` : ""}<b class="rs-res-num"${st ? ` style="${st}"` : ""}>${v}</b></span></td>`;
}
function row(x) {
  if (x.mk !== MK.market) setMarket(x.mk); // All Props: each row in its own market
  const pool = listPool(x.p.pos, x.cut);
  const ln = x.past ? "that night's line, games before it" : "tonight's line";
  const one = (text, v, vals, tip) => { const st = stepStyle(spread(v, vals)); return `<td class="num rs-two"${st ? ` style="${st}"` : ""} title="${tip} (colored against the league's ${x.p.pos}s)"><b>${text}</b></td>`; };
  const key = openKey(x);
  const stat = ALL_PROPS ? `<td class="rs-stat"><a href="${MK.market}.html" class="rs-stat-pill" style="--pill-h:${STAT_HUE[MK.market]}" title="${MK.unit} Research: every ${MK.unit.toLowerCase()} line">${MK.unit}</a></td>` : "";
  // a past night has no research panel: its tabs read the whole season, that night and after included
  return `<tr class="sim-row${x.live ? " live" : ""}${PANEL && !x.past ? " rs-click" : ""}${OPEN === key ? " open" : ""}" data-open="${key}">
    <td class="sim-plcell"><span class="sim-pl-in">${headshot(x.pid)}<span class="rs-pl-txt" title="${nameOf(x.pid)}">${playerClick(x.pid, `<b>${nameOf(x.pid)}</b>`)}<span class="rs-pl-sub"><span class="muted-label">${x.p.pos || ""}</span>${nbaTypeBadge(x.pid)}${statusPill(x.status)}<span class="sim-vs">${logo(x.team, 15)}<span>${x.home ? "vs" : "@"}</span>${logo(x.opp, 15)}</span></span></span></span></td>
    ${stat}<td class="num rs-line">${x.line === null ? '<span class="muted-label">No Line</span>' : `<b>${fmt(x.line)}</b>`}</td>
    ${x.past ? "" : sideCell(x.g, x.pid, "o", x.line, x.team) + sideCell(x.g, x.pid, "u", x.line, x.team)}
    ${one(fmt(x.avg), x.avg, pool.avgV, `${fmt(x.avg)} ${MK.unit.toLowerCase()} a game in ${x.gp} games`)}
    ${ALL_PROPS ? "" : one(fmt(x.second), x.second, pool.second, THREES ? `${fmt(x.second)} threes tried a game` : `${fmt(x.second)} minutes a game`)}
    ${ALL_PROPS ? "" : one(pctT(x.vol), x.vol, pool.vol, THREES ? `${pctT(x.vol)} of his shots are threes` : REBS ? `He grabs ${pctT(x.vol)} of the rebounds while he's on the floor` : ASTS ? `He assisted ${pctT(x.vol)} of his teammates' made shots while on the floor` : `${pctT(x.vol)} of his team's shots while he's on the floor`)}
    ${lastCell(x)}
    ${hitCell(x.hits.l5, `Last 5 games over ${ln}`)}${hitCell(x.hits.l10, `Last 10 games over ${ln}`)}${hitCell(x.hits.all, `This season's games over ${ln}`)}${hitCell(x.hits.home, `Home games over ${ln}`)}${hitCell(x.hits.away, `Road games over ${ln}`)}
    ${allowCell(x)}
    ${ALL_PROPS || TM_FIELD[MK.market] ? typeCell(x) : ""}
    ${readCells(x)}
    ${gameCells(x)}
    ${x.past ? resultCell(x) : `<td class="sim-tagc"><div class="sim-rtags">${x.without.map(withoutPill).join("") || '<span class="muted-label">None</span>'}</div></td>`}
  </tr>`;
}
// ---- the research panel: two sandboxes (the owner approved the layout 2026-11-03) ----
// The owner: "I crave symmetry. I crave consistency. I crave clear and obvious", and on tabs: "this
// would give us a standard sandbox area so youd always know how to conform data to it, rather than
// making everything a different shape and size every time." Under a clicked Points row: two boxes
// of the same size side by side, each with tabs, and EVERY tab is the same grid (sim.css .rs-g): one
// header row, RS_ROWS rows, a label column and seven equal columns, 3 px between tiles and nothing
// else. Colors mean the same thing on every tab: blue header = him, purple = tonight's defense,
// green = the read; every tile on the 8-step scale (stepStyle). The tabs are the titles. Real counts
// only. A new tab fits this grid: six rows of a label + seven tiles (span 2 / 3 / 7 to merge).
const RS_ROWS = 6;
// Threes (the owner, 2026-11-04): Shooting (how he gets his threes) for Scoring, a Shot Map for
// Matchup (it repeated Form), and a Ladder of how often he hits each number.
// Rebounds (the owner, 2026-11-04): Rebounding (chances and his share of them) and Miss Zones.
let RS_TABS = null; // the market in play's tabs (setMarket)
const tabsFor = () => (THREES ? { left: ["Form", "Shooting", "Shot Map", "Game Script"], right: ["Vs The Line", "Ladder", "Rotation", "Teammates", "Type Matchup", "Shot Fit"] }
  : REBS ? { left: ["Form", "Rebounding", "Miss Zones", "Game Script"], right: ["Vs The Line", "Ladder", "Rotation", "Teammates"] }
  : ASTS ? { left: ["Form", "Playmaking", "Assist Zones", "Game Script"], right: ["Vs The Line", "Ladder", "Rotation", "Teammates"] }
  : { left: ["Form", "Scoring", "Matchup", "Game Script"], right: ["Vs The Line", "Rotation", "Teammates", "Type Matchup", "Shot Fit"] });
const RSV = { left: "Form", right: "Vs The Line" }; // the open tab of each box (kept while the page is open)
const SCRIPT_RANGE = 5; // Game Script: his games within this many points of tonight's spread / total, either way (two possessions)
const PACE_RANGE = 2; // ... and within this many possessions of tonight's pace
const RS = () => PROPS.research || { players: {}, teams: {}, games: {}, spots: {}, defpos: {}, deffga: {} };
const rsOf = (pid) => RS().players[pid] || {};
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// a signed strength (-1..1) on the 8-step scale: +1 = greenest, -1 = reddest, null = an uncolored tile
const stepStyle = (s) => (s === null || s === undefined || Number.isNaN(s) ? "" : rankStyle(1 + Math.round(((1 - clamp1(s)) / 2) * 7), 8));
const per36 = (n, m) => (m ? (n / m) * 36 : null);
const pctT = (v) => (v === null || v === undefined || Number.isNaN(v) ? "--" : `${Math.round(v * 100)}%`);
const sgn = (v, d = 1) => (v === null || v === undefined ? "--" : `${v > 0 ? "+" : v < 0 ? "&minus;" : ""}${Math.abs(v).toFixed(d)}`);
const shortName = (name) => { const parts = String(name || "").split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : String(name || ""); };
const face = (id) => `<img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop" alt="" class="rs-face" loading="lazy" onerror="this.style.visibility='hidden'">`;
const gameDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
const tipAttr = (tip) => (tip ? ` title="${String(tip).replace(/"/g, "&quot;")}"` : "");
// the grid's three tiles: a number (colored by a signed strength), a label, a header (him / def / read / plain)
const T = (v, s, tip = "", cls = "") => `<div class="rs-t${cls ? ` ${cls}` : ""}"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(tip)}>${v}</div>`;
// A Read tile. Every one goes through here so the list's O / U columns count exactly the reads the
// panel shows (readsOf).
let READS = null;
// `num`: the row's numbers for the filters: {label, him, hu, hr, def, du, dr} (his value, its unit "%" / "#",
// his rank among his position; the defense's value, unit, rank of 30). Percents are 0-100.
const RT = (rd, tip, num) => { if (READS) READS.push({ ...rd, num }); return T(rd.t, rd.s, tip); };
const numOf = (v, show) => (v === null || v === undefined || Number.isNaN(v) ? null : show === pctT ? v * 100 : v);
const unitOf = (show) => (show === pctT ? "%" : "#");
const pairNum = (label, a, b) => ({ label, him: a.n, hu: a.u, hr: a.rank, def: b.n, du: b.u, dr: b.rank });
const LB = (v, tip = "") => `<div class="rs-t rs-l"${tipAttr(tip)}>${v}</div>`;
const HD = (v, kind, cls = "", tip = "") => `<div class="rs-t rs-h rs-${kind}${cls ? ` ${cls}` : ""}"${tipAttr(tip)}>${v}</div>`;
// his jersey number on a jersey in his team's color (the owner, 2026-11-03: a long name hid the
// defense in the corner); no number in the data yet = his last name
const jersey = (pid) => {
  const p = playerOf(pid) || {};
  if (!p.num) return `<span class="rs-jname">${lastName(nameOf(pid))}</span>`;
  return `<span class="rs-jersey" style="background:#${team(p.team).color || "555555"}" title="${nameOf(pid)} #${p.num}">${p.num}</span>`;
};
// the key: blue = him (his jersey), purple = tonight's defense against his position
const corner = (x) => `<div class="rs-t rs-corner"><span class="rs-key rs-him">${jersey(x.pid)}</span><span class="rs-key rs-def" title="What ${team(x.opp).name} allow ${x.p.pos}s">${logo(x.opp, 15)}vs ${x.p.pos}s</span></div>`;
// six rows, always: a tab with fewer fills the rest with blank tiles so every box is the same shape.
// `bands`: [kind, first column, columns] shaded behind a group of columns (blue him, purple defense).
// `fill`: fewer rows than RS_ROWS grow to fill the same box (rs-fill), never blank rows.
const gridOf = (head, rows, { bands = [], cls = "", n = RS_ROWS, fill = false } = {}) => {
  const out = rows.slice(0, n);
  if (fill) cls = `${cls} rs-fill`.trim();
  else while (out.length < n) out.push(LB("") + T("", null, "", "rs-s7 rs-blank"));
  const st = fill ? ` style="--rs-n:${out.length}"` : "";
  const back = bands.length ? `<div class="rs-g rs-bands${cls ? ` ${cls}` : ""}"${st} aria-hidden="true">${bands.map(([k, from, span]) => `<i class="rs-band rs-${k}" style="grid-column:${from} / span ${span}"></i>`).join("")}</div>` : "";
  return `<div class="rs-gw"><div class="rs-g${cls ? ` ${cls}` : ""}"${st}>${head}${out.join("")}</div>${back}</div>`;
};
const BANDS_3_3_1 = [["him", 2, 3], ["def", 5, 3], ["rd", 8, 1]];
// A rank of 30 in words: the top half "Nth-most", the bottom half "Nth-least" (the owner, 2026-11-04,
// read "27th most of 30" as near the top).
const rankWords = (r, n) => (r <= Math.ceil(n / 2) ? `${ordinal(r)}-most of ${n}` : `${ordinal(n - r + 1)}-least of ${n} (${ordinal(r)} of ${n})`);
// Tonight's defense is read FROM THE DEFENSE on every Research panel, the list and Assist Spots (the
// owner, 2026-11-05 and 2026-11-06: "bad defense is red"): 1st = the best for the defense (allows the
// fewest, green), 30th = the worst (allows the most, red). `r` = its rank by most allowed.
const dRank = (r, n) => n - r + 1;
const dWords = (r, n) => `${ordinal(dRank(r, n))} of ${n} (${r <= Math.ceil(n / 2) ? `${ordinal(r)}-most` : `${ordinal(n - r + 1)}-least`})`;
// A defense tile: `s` is the strength for HIM (+1 = the defense gives up the most), which the Read
// keeps; the tile is drawn from the defense's side, so -s (red = gives up the most).
const DT = (v, s, tip = "") => T(v, s === null || s === undefined ? s : -s, tip);
// The defense's rank on the five-column tabs: `r` by the most; `flip` rows (more = worse for him, e.g.
// they crash the glass) are already ranked from the defense (1st = the most = the best for it).
const defRank = (r, n, flip = false) => (r ? { r: flip ? r : dRank(r, n), w: `${ordinal(flip ? r : dRank(r, n))} of ${n} (${r <= Math.ceil(n / 2) ? `${ordinal(r)}-most` : `${ordinal(n - r + 1)}-least`})` } : { r: null, w: "" });
// the two-sided read (the site's matchup rule): one side clearly one way, the other not the other way.
// Over / Under / Even (the owner, 2026-11-04: "so we can start framing it as betting").
const readOf = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return { t: "--", s: null };
  if ((a >= 0.4 && b > -0.1) || (b >= 0.4 && a > -0.1)) return { t: "Over", s: 1 };
  if ((a <= -0.4 && b < 0.1) || (b <= -0.4 && a < 0.1)) return { t: "Under", s: -1 };
  return { t: "Even", s: 0.1 };
};
const READ_TIP = { Over: "The Over: one side points to more points for him and the other doesn't point against it", Under: "The Under: one side points to fewer points for him and the other doesn't point against it", Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };

// Rotation players at one position (12+ minutes, 3+ games): the pool a number is ranked in.
function posPool(pos) {
  const f = logFields();
  return Object.entries(seasonBlock().players).filter(([, p]) => p.pos === pos && (p.log || []).length >= 3
    && avg(p.log.map((r) => r[f.min] || 0)) >= ROTATION_MIN);
}
// where a value sits in a pool, as -1..1 (+1 = the most)
function spread(v, pool) {
  const xs = pool.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v === null || v === undefined || Number.isNaN(v) || xs.length < 5) return null;
  return ((xs.filter((x) => x < v).length + 0.5 * xs.filter((x) => x === v).length) / xs.length) * 2 - 1;
}
const rankIn = (v, pool) => { const xs = pool.filter((q) => q !== null && q !== undefined && !Number.isNaN(q)); return v === null || v === undefined || Number.isNaN(v) ? null : { r: xs.filter((q) => q > v).length + 1, n: xs.length }; };
const rankSigned = (rank, n) => (rank && n > 1 ? 1 - ((rank - 1) / (n - 1)) * 2 : null); // 1st = +1, last = -1
const rankTxt = (rk) => (rk && rk.r ? ordinal(rk.r) : "--");
function teamRanks(valueOf) {
  const s = Object.keys(DATA.teams || {}).map((t) => [t, valueOf(t)]).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => b[1] - a[1]);
  return { n: s.length, r: Object.fromEntries(s.map(([t], i) => [t, i + 1])), v: Object.fromEntries(s) };
}
const identityBlock = () => (((DATA.identity || {}).seasons || {})[String((DATA.identity || {}).default)] || {});
const identityTeams = () => identityBlock().teams || {};

// What each defense allowed one position, from every player's game logs: per team its games in date
// order with the position's points, shots, threes, free throws and makes; season, last 10 and last 5, each
// ranked of 30 (1st = allows the most). Kept per position.
const DEF_POS = {};
function defenseByPos(pos) {
  if (DEF_POS[pos]) return DEF_POS[pos];
  const f = logFields();
  const KEYS = ["pts", "fga", "fg3m", "fta", "fgm", "fg3a", "reb", "oreb", "dreb", "ast", "min"];
  const byTeam = {};
  for (const p of Object.values(seasonBlock().players)) {
    if (p.pos !== pos) continue;
    for (const r of p.log || []) {
      const t = r[f.opp];
      if (!t) continue;
      const g = ((byTeam[t] = byTeam[t] || {})[r[f.game]] = byTeam[t][r[f.game]] || { d: r[f.date], pts: 0, fga: 0, fg3m: 0, fta: 0, fgm: 0, fg3a: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, min: 0 });
      for (const k of KEYS) g[k] += r[f[k]] || 0;
    }
  }
  const total = (gs, k) => gs.reduce((a, g) => a + g[k], 0);
  const agg = (gs) => (gs.length ? { pts: total(gs, "pts") / gs.length, fga: total(gs, "fga") / gs.length, fg3m: total(gs, "fg3m") / gs.length, fta: total(gs, "fta") / gs.length,
    fgp: total(gs, "fga") ? (total(gs, "fgm") / total(gs, "fga")) * 100 : null, fg3a: total(gs, "fg3a") / gs.length,
    fg3p: total(gs, "fg3a") ? (total(gs, "fg3m") / total(gs, "fg3a")) * 100 : null, rate3: total(gs, "fga") ? (total(gs, "fg3a") / total(gs, "fga")) * 100 : null,
    reb: total(gs, "reb") / gs.length, oreb: total(gs, "oreb") / gs.length, dreb: total(gs, "dreb") / gs.length,
    ast: total(gs, "ast") / gs.length, ast36: total(gs, "min") ? (total(gs, "ast") / total(gs, "min")) * 36 : null, n: gs.length } : null);
  const teams = {};
  for (const [t, games] of Object.entries(byTeam)) {
    const gs = Object.values(games).sort((a, b) => (a.d < b.d ? -1 : 1));
    teams[t] = { season: agg(gs), l10: agg(gs.slice(-10)), l5: agg(gs.slice(-5)) };
  }
  const ranks = {};
  for (const w of ["season", "l10", "l5"]) {
    ranks[w] = {};
    for (const k of ["pts", "fga", "fg3m", "fta", "fgp", "fg3a", "fg3p", "rate3", "reb", "oreb", "dreb", "ast", "ast36"]) {
      const sorted = Object.keys(teams).filter((t) => teams[t][w] && teams[t][w][k] !== null).sort((a, b) => teams[b][w][k] - teams[a][w][k]);
      ranks[w][k] = { n: sorted.length, r: Object.fromEntries(sorted.map((t, i) => [t, i + 1])) };
    }
  }
  DEF_POS[pos] = { teams, ranks };
  return DEF_POS[pos];
}
// What every defense allowed one position as shares (research.defpos / deffga): shot share,
// assisted makes, transition, and points by zone; rankOf(get) ranks the teams (1st = the most).
function defShares(pos) {
  const D = RS().defpos || {}, F = RS().deffga || {};
  const teams = {};
  for (const [t, byPos] of Object.entries(D)) {
    const v = byPos[pos];
    if (!v) continue;
    const [th, mid, paint, ft, makes, ast, trans, pts, fga] = v;
    teams[t] = { shot: F[t] ? fga / F[t] : null, assisted: makes ? ast / makes : null, trans: pts ? trans / pts : null,
      z: pts ? [th / pts, mid / pts, paint / pts, ft / pts] : null, pts: [th, mid, paint, ft] };
  }
  const rankOf = (get) => { const xs = Object.keys(teams).filter((t) => get(teams[t]) !== null && get(teams[t]) !== undefined).sort((a, b) => get(teams[b]) - get(teams[a])); return { n: xs.length, r: Object.fromEntries(xs.map((t, i) => [t, i + 1])) }; };
  return { teams, rankOf };
}
const ZONES_PTS = [["Threes", "threes"], ["Mid-Range", "mid-range shots"], ["Paint", "the paint (at the rim and short shots)"], ["Free Throws", "free throws"]];

// ---- left box ----
// Form: his season, last 10 and last 5, beside what tonight's defense allows his position (season,
// last 10, last 5), and the read (the owner, 2026-11-04: a Read for the +/- columns, so Form has
// the same him 3 / defense 3 / read shape as Scoring and Shooting). His season is colored against his
// position, his L10 / L5 against his season, the defense's by its rank of 30 in that window (green =
// allows the most). The read goes off the two Season tiles (the site's two-sided rule).
// Assists Form (the owner, 2026-11-04): under his AST row, a row for each OTHER position: his
// assists a game to teammates at that position (season, last 10, last 5), beside the assisted
// baskets tonight's defense gives up to that position a game (season, last 10, last 5, each ranked
// of 30), and the read. research.py `acg` [.., to PG, SG, SF, PF, C] and `dag`.
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
let GAME_DATE = null;
const gameDateOf = (gid) => {
  if (!GAME_DATE) {
    GAME_DATE = {};
    const f = logFields();
    for (const p of Object.values(seasonBlock().players)) for (const r of p.log || []) GAME_DATE[String(r[f.game])] = r[f.date];
  }
  return GAME_DATE[String(gid)] || "";
};
// his assists to one position, game by game in date order (games the play-by-play has)
function astToPos(pid, i) {
  const f = logFields();
  const acg = rsOf(pid).acg || {};
  return logOf(pid).map((r) => acg[String(r[f.game])]).filter((v) => v && v.length > 2 + i).map((v) => v[2 + i]);
}
const DAG = {};
function defAstToPos(i) {
  if (!DAG[i]) {
    const dag = RS().dag || {};
    const teams = {};
    for (const [t, games] of Object.entries(dag)) {
      const vals = Object.entries(games).sort((a, b) => (gameDateOf(a[0]) < gameDateOf(b[0]) ? -1 : 1)).map(([, v]) => v[i]);
      teams[t] = { season: avg(vals), l10: avg(vals.slice(-10)), l5: avg(vals.slice(-5)), n: vals.length };
    }
    const ranks = {};
    for (const w of ["season", "l10", "l5"]) {
      const sorted = Object.keys(teams).filter((t) => teams[t][w] !== null).sort((a, b) => teams[b][w] - teams[a][w]);
      ranks[w] = { n: sorted.length, r: Object.fromEntries(sorted.map((t, k) => [t, k + 1])) };
    }
    DAG[i] = { teams, ranks };
  }
  return DAG[i];
}
function assistPosRows(x) {
  const pool = posPool(x.p.pos);
  return POSITIONS.filter((p) => p !== x.p.pos).map((target) => {
    const i = POSITIONS.indexOf(target);
    const vals = astToPos(x.pid, i);
    const s = avg(vals), a10 = avg(vals.slice(-10)), a5 = avg(vals.slice(-5));
    const pv = pool.map(([id]) => avg(astToPos(id, i)));
    const hs = spread(s, pv);
    const trend = (v, n) => { if (v === null || !s || n >= vals.length) return null; const rel = (v - s) / s / 0.3; return Math.abs(rel) < 0.2 ? null : rel; };
    const D = defAstToPos(i), opp = D.teams[x.opp];
    const rk = (w) => (opp && D.ranks[w].r[x.opp] ? rankSigned(D.ranks[w].r[x.opp], D.ranks[w].n) : null);
    const dtip = (w, label) => (opp ? `${team(x.opp).name} give up ${fmt(opp[w])} assisted baskets a game to ${target}s ${label} (${dWords(D.ranks[w].r[x.opp], D.ranks[w].n)})` : "");
    const rd = readOf(hs, rk("season"));
    const rdTip = { Over: `The Over: one side points to more assists to ${target}s and the other doesn't point against it`, Under: `The Under: one side points to fewer assists to ${target}s and the other doesn't point against it`, Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };
    return LB(`To ${target}`, `His assists a game to his ${target}s`)
      + T(fmt(s), hs, `His assists a game to ${target}s this season, in ${vals.length} games (colored against the league's ${x.p.pos}s)`)
      + T(fmt(a10), trend(a10, 10), `His last ${Math.min(10, vals.length)} games (colored against his season)`) + T(fmt(a5), trend(a5, 5), `His last ${Math.min(5, vals.length)} games (colored against his season)`)
      + DT(fmt(opp ? opp.season : null), rk("season"), dtip("season", "this season")) + DT(fmt(opp ? opp.l10 : null), rk("l10"), dtip("l10", "in their last 10"))
      + DT(fmt(opp ? opp.l5 : null), rk("l5"), dtip("l5", "in their last 5"))
      + RT(rd, rdTip[rd.t], { label: `To ${target}`, him: s, hu: "#", hr: (rankIn(s, pv) || {}).r ?? null, def: opp ? opp.season : null, du: "#", dr: opp && D.ranks.season.r[x.opp] ? dRank(D.ranks.season.r[x.opp], D.ranks.season.n) : null });
  });
}

function formTab(x) {
  const f = logFields();
  const log = logOf(x.pid), l10 = log.slice(-10), l5 = log.slice(-5);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[f[k]] || 0), 0);
  const per = (k) => (rows) => (rows.length ? sum(rows, k) / rows.length : null);
  const fgp = (rows) => (sum(rows, "fga") ? (sum(rows, "fgm") / sum(rows, "fga")) * 100 : null);
  const pool = posPool(x.p.pos);
  const D = defenseByPos(x.p.pos);
  const opp = D.teams[x.opp] || {};
  const ratio = (a, b) => (rows) => (sum(rows, b) ? (sum(rows, a) / sum(rows, b)) * 100 : null);
  // Threes (the owner, 2026-11-04): no FGA (the 3PA rate says it) and no minutes
  // Assists (the owner, 2026-11-04): no turnovers ("too noisy"); a 36 splits passing from minutes
  // Assists: his AST, then his assists to each other position (assistPosRows; the owner, 2026-11-04)
  const ROWS = ASTS ? [["AST", per("ast"), 1, 0.2, "ast", "assists"]]
    : REBS ? [["REB", per("reb"), 1, 0.15, "reb", "rebounds"], ["DREB", per("dreb"), 1, 0.15, "dreb", "defensive rebounds"],
    ["OREB", per("oreb"), 1, 0.3, "oreb", "offensive rebounds"], ["MIN", per("min"), 1, 0.1, null, "minutes"]]
    : THREES ? [["3PM", per("fg3m"), 1, 0.3, "fg3m", "threes made"], ["3PA", per("fg3a"), 1, 0.2, "fg3a", "threes tried"],
    ["3P%", ratio("fg3m", "fg3a"), 0, 0.12, "fg3p", "three-point %"], ["3PA Rate", ratio("fg3a", "fga"), 0, 0.15, "rate3", "share of shots that are threes (%)"]]
    : [["PTS", per("pts"), 1, 0.15, "pts", "points"], ["MIN", per("min"), 1, 0.1, null, "minutes"], ["FGA", per("fga"), 1, 0.15, "fga", "shots"],
      ["3PM", per("fg3m"), 1, 0.3, "fg3m", "threes made"], ["FTA", per("fta"), 1, 0.3, "fta", "free throws tried"], ["FG%", fgp, 0, 0.12, "fgp", "field goal %"]];
  const rows = ROWS.map(([label, get, d, big, key, what]) => {
    const ag = /%|a 36/.test(what) ? "" : " a game";
    const s = get(log), a10 = get(l10), a5 = get(l5);
    const rel = (v) => (v === null || s === null || !s ? null : (v - s) / s / big);
    // his season against his position; L10 / L5 against HIS season (the owner, 2026-11-03: "compared
    // against himself to see trends lately vs long term"). No real change = a plain tile, never a
    // middle color (with 10 games or fewer his L10 IS his season).
    const trend = (v, rows) => (rows.length >= log.length ? null : Math.abs(rel(v) ?? 0) < 0.2 ? null : rel(v));
    const hv = pool.map(([, q]) => get(q.log || []));
    const hs = spread(s, hv);
    let cells = T(fmt(s, d), hs, `His ${what}${ag} this season (colored against the league's ${x.p.pos}s)`)
      + T(fmt(a10, d), trend(a10, l10), `His last ${l10.length} games (colored against his season)`) + T(fmt(a5, d), trend(a5, l5), `His last ${l5.length} games (colored against his season)`);
    let ds = null;
    if (!key || !opp.season) cells += T("--", null, "") + T("--", null, "") + T("--", null, "");
    else {
      const rk = (w) => (opp[w] && D.ranks[w][key].r[x.opp] ? rankSigned(D.ranks[w][key].r[x.opp], D.ranks[w][key].n) : null);
      const val = (w) => (opp[w] ? opp[w][key] : null);
      const tip = (w, label) => (opp[w] ? `${team(x.opp).name} allow ${x.p.pos}s ${fmt(val(w), d)} ${what}${ag} ${label} (${dWords(D.ranks[w][key].r[x.opp], D.ranks[w][key].n)})` : "");
      ds = rk("season");
      cells += DT(fmt(val("season"), d), ds, tip("season", "this season")) + DT(fmt(val("l10"), d), rk("l10"), tip("l10", `in their last ${opp.l10 ? opp.l10.n : 0}`))
        + DT(fmt(val("l5"), d), rk("l5"), tip("l5", `in their last ${opp.l5 ? opp.l5.n : 0}`));
    }
    const rd = key ? readOf(hs, ds) : { t: "--", s: null, none: true }; // none: never a read (no defense side)
    const [up, down] = ag || /a 36/.test(what) ? [`more ${what}`, `fewer ${what}`] : [`a higher ${what}`, `a lower ${what}`];
    const rdTip = { Over: `The Over: one side points to ${up} for him and the other doesn't point against it`, Under: `The Under: one side points to ${down} for him and the other doesn't point against it`,
      Even: "The two sides don't line up one way", "--": key ? "Not enough data on one side yet" : "His number only: no defense side" };
    const u = d === 0 ? "%" : "#"; // the % rows are already 0-100
    cells += RT(rd, `${rdTip[rd.t]} (his season against his position, the defense's season rank)`, { label, him: s, hu: u, hr: (rankIn(s, hv) || {}).r ?? null,
      def: key && opp.season ? opp.season[key] : null, du: u, dr: key && opp.season && D.ranks.season[key].r[x.opp] ? dRank(D.ranks.season[key].r[x.opp], D.ranks.season[key].n) : null });
    return LB(label, `${what[0].toUpperCase()}${what.slice(1)}${ag}`) + cells;
  });
  const head = corner(x) + HD("Season", "him") + HD("L10", "him") + HD("L5", "him") + HD("Season", "def", "", `What ${team(x.opp).name} allow ${x.p.pos}s`) + HD("L10", "def") + HD("L5", "def") + HD("Read", "rd");
  if (ASTS) rows.push(...assistPosRows(x));
  return gridOf(head, rows, { bands: BANDS_3_3_1, fill: rows.length < RS_ROWS });
}

// Scoring: his share, its rank among his position and points a game, beside what the defense allows
// his position (share, rank of 30, points a game), and the read. Points by zone: threes, mid-range,
// the paint (rim + short) and free throws.
function scoringTab(x) {
  const p = playerOf(x.pid) || {};
  const pool = posPool(x.p.pos);
  const DS = defShares(x.p.pos);
  const opp = DS.teams[x.opp] || {};
  const games = (rsOf(x.pid).rotn || [logOf(x.pid).length])[0] || logOf(x.pid).length || 1;
  const dGames = ((defenseByPos(x.p.pos).teams[x.opp] || {}).season || {}).n || 0;
  const row = (label, v, vals, dv, dr, ppg, dppg, tip, dtip) => {
    const rk = rankIn(v, vals), s = spread(v, vals), ds = rankSigned(dr.r[x.opp], dr.n), rd = readOf(s, ds);
    return LB(label, tip) + T(pctT(v), s, tip) + T(rankTxt(rk), s, rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "") + T(ppg === null ? "--" : fmt(ppg), ppg === null ? null : s, ppg === null ? "" : `${fmt(ppg)} points a game`)
      + DT(pctT(dv), ds, `${team(x.opp).name}: ${dtip}`) + DT(dr.r[x.opp] ? ordinal(dRank(dr.r[x.opp], dr.n)) : "--", ds, dr.r[x.opp] ? dWords(dr.r[x.opp], dr.n) : "")
      + DT(dppg === null ? "--" : fmt(dppg), dppg === null ? null : ds, dppg === null ? "" : `${team(x.opp).name} allow ${x.p.pos}s ${fmt(dppg)} points a game this way`)
      + RT(rd, READ_TIP[rd.t], { label, him: numOf(v, pctT), hu: "%", hr: rk ? rk.r : null, def: numOf(dv, pctT), du: "%", dr: dr.r[x.opp] ? dRank(dr.r[x.opp], dr.n) : null });
  };
  const rows = [
    row("Shot Share", p.share ?? null, pool.map(([, q]) => q.share ?? null), opp.shot, DS.rankOf((t) => t.shot), null, null,
      "His share of his team's shots while he's on the floor", `share of their opponents' shots taken by ${x.p.pos}s`),
    row("Assisted", p.assisted ?? null, pool.map(([, q]) => q.assisted ?? null), opp.assisted, DS.rankOf((t) => t.assisted), null, null,
      "Share of his made shots a teammate assisted", `share of ${x.p.pos}s' made shots against them that were assisted`),
  ];
  const pz = rsOf(x.pid).pz;
  const share = (q, i) => { const t = q ? q.reduce((a, b) => a + b, 0) : 0; return t ? q[i] / t : null; };
  ZONES_PTS.forEach(([label, what], i) => {
    rows.push(row(label, share(pz, i), pool.map(([id]) => share(rsOf(id).pz, i)), opp.z ? opp.z[i] : null, DS.rankOf((t) => (t.z ? t.z[i] : null)),
      pz ? pz[i] / games : null, opp.pts && dGames ? opp.pts[i] / dGames : null, `Share of his points from ${what}`, `share of ${x.p.pos}s' points against them from ${what}`));
  });
  const head = corner(x) + HD("Share", "him") + HD("Rank", "him") + HD("Pts / G", "him") + HD("Allowed", "def") + HD("Rank", "def") + HD("Pts / G", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: BANDS_3_3_1 });
}

// Matchup: his side and the defense's side of one thing (value and rank each) and the read.
function matchupTab(x) {
  const f = logFields();
  const pool = posPool(x.p.pos);
  const R = RS();
  const teams = identityTeams();
  const opp = x.opp;
  const perG = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const benchShare = (pid) => { const u = (R.players[pid] || {}).units; return u && u[0] + u[2] ? u[0] / (u[0] + u[2]) : null; };
  const transShare = (pid) => { const t = (R.players[pid] || {}).trans; return t && t[1] ? t[0] / t[1] : null; };
  const fouls36 = (rows) => { const m = rows.reduce((a, r) => a + (r[f.min] || 0), 0); return m ? (rows.reduce((a, r) => a + (r[f.pf] || 0), 0) / m) * 36 : null; };
  const D = defenseByPos(x.p.pos);
  const ptsAllowed = teamRanks((t) => ((D.teams[t] || {}).season || {}).pts ?? null);
  const ftAllowed = teamRanks((t) => ((D.teams[t] || {}).season || {}).fta ?? null);
  const transAllowed = teamRanks((t) => (teams[t] || {}).def_trans_freq ?? null);
  const benchAllowed = teamRanks((t) => { const u = R.teams[t]; return u && u[0] >= 30 ? (u[1] / u[0]) * 100 : null; });
  const pace = teamRanks((t) => (teams[t] || {}).off_pace ?? null);
  // the other team's players at his position: free throws they draw a game (they attack him)
  const draws = teamRanks((t) => { const rows = Object.values(seasonBlock().players).filter((q) => q.team === t && q.pos === x.p.pos).flatMap((q) => q.log || []); const n = new Set(rows.map((r) => r[f.game])).size; return n ? rows.reduce((a, r) => a + (r[f.fta] || 0), 0) / n : null; });
  // each side: the value and its rank (no average columns: the owner, 2026-11-03, they misled)
  const him = (v, vals, show, flip = false) => { const rk = rankIn(v, vals); const s = spread(v, vals); return { s: s === null ? null : flip ? -s : s, v: show(v), r: rk ? `${ordinal(rk.r)}` : "--", rt: rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "", n: numOf(v, show), u: unitOf(show), rank: rk ? rk.r : null }; };
  // tonight's defense is ranked from the defense (defRank); his own team's pace keeps 1st = fastest
  const them = (rk, t, show, flip = false) => { const s = rankSigned(rk.r[t], rk.n); const d = t === opp ? defRank(rk.r[t], rk.n, flip) : { r: rk.r[t] || null, w: rk.r[t] ? `${ordinal(rk.r[t])} of ${rk.n}` : "" }; return { s: s === null ? null : flip ? -s : s, v: show(rk.v[t]), r: d.r ? ordinal(d.r) : "--", rt: d.w, n: numOf(rk.v[t], show), u: unitOf(show), rank: d.r }; };
  const ROWS = [
    ["Points", "His points a game / what the defense allows his position a game", him(perG(logOf(x.pid), "pts"), pool.map(([, q]) => perG(q.log || [], "pts")), (v) => fmt(v)), them(ptsAllowed, opp, (v) => fmt(v))],
    ["Free Throws", "His free throws tried a game / what the defense allows his position", him(perG(logOf(x.pid), "fta"), pool.map(([, q]) => perG(q.log || [], "fta")), (v) => fmt(v)), them(ftAllowed, opp, (v) => fmt(v))],
    ["Transition", "Share of his points on fast breaks / how often the defense's opponents get out in transition", him(transShare(x.pid), pool.map(([id]) => transShare(id)), pctT), them(transAllowed, opp, pctT)],
    ["Vs Bench", "Share of his possessions against bench units (2 or fewer starters) / points a 100 possessions the defense's bench units allow", him(benchShare(x.pid), pool.map(([id]) => benchShare(id)), pctT), them(benchAllowed, opp, (v) => fmt(v, 0))],
    ["Pace", "His team's pace (1st = fastest) / the defense's pace (30th = fastest, red: more possessions against them); possessions a 48 minutes", them(pace, x.team, (v) => fmt(v)), them(pace, opp, (v) => fmt(v))],
    ["Foul Trouble", "His fouls a 36 minutes (red = foul-prone) / free throws the defense's players at his position draw a game (green = they attack him)", him(fouls36(logOf(x.pid)), pool.map(([, q]) => fouls36(q.log || [])), (v) => fmt(v), true), them(draws, opp, (v) => fmt(v), true)],
  ];
  const rows = ROWS.map(([label, tip, a, b]) => {
    const rd = readOf(a.s, b.s);
    return LB(label, tip) + T(a.v, a.s, tip) + T(a.r, a.s, a.rt) + DT(b.v, b.s, tip) + DT(b.r, b.s, b.rt) + RT(rd, READ_TIP[rd.t], pairNum(label, a, b));
  });
  const head = corner(x) + HD(jersey(x.pid), "him", "", nameOf(x.pid)) + HD("Rank", "him") + HD("Allows", "def") + HD("Rank", "def") + HD("Read", "rd");
  // five columns across the same box (every row full, so no blank rows to span)
  return gridOf(head, rows, { bands: [["him", 2, 2], ["def", 4, 2], ["rd", 6, 1]], cls: "rs-five" });
}

// Game Script: his games like tonight (within SCRIPT_RANGE of tonight's spread and total either
// way, PACE_RANGE possessions of tonight's pace, tonight's schedule spots) beside all his games.
function scriptTab(x) {
  const f = logFields();
  const R = RS();
  const log = logOf(x.pid);
  const games = R.games || {};
  const gOf = (r) => games[String(r[f.game])] || [];
  const teams = identityTeams();
  const avgOf = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[f[k]] || 0), 0) / rows.length : null);
  const st = MK.stat, unit = MK.unit.toLowerCase();
  const season = avgOf(log, st), seasonMin = avgOf(log, "min"), seasonFga = avgOf(log, "fga"), seasonAtt = avgOf(log, "fg3a");
  const pct3 = (rows) => { const a = rows.reduce((n, r) => n + (r[f.fg3a] || 0), 0); return a ? (rows.reduce((n, r) => n + (r[f.fg3m] || 0), 0) / a) * 100 : null; };
  const seasonPct = pct3(log);
  const rcg = rsOf(x.pid).rcg || {}, acg = rsOf(x.pid).acg || {};
  const chOf = (g) => (ASTS ? (acg[g] || [])[0] : rcg[g]);
  const chances = (rows) => { const xs = rows.map((r) => chOf(String(r[f.game]))).filter((v) => v !== undefined); return xs.length ? avg(xs) : null; };
  const seasonCh = chances(log);
  const line = x.line;
  const rows = [];
  // every number colored against his own season (fewer than SMALL games: faded, never colored)
  const add = (label, rowsIn, tip, all = false) => {
    const a = avgOf(rowsIn, st), m = avgOf(rowsIn, "min"), s = avgOf(rowsIn, "fga");
    const over = line === null ? null : rowsIn.filter((r) => (r[f[st]] || 0) > line).length;
    const small = rowsIn.length < SMALL;
    const vsSeason = (v, base, k) => (small || v === null || !base ? null : (v - base) / base / k);
    const rel = vsSeason(a, season, THREES ? 0.3 : 0.15);
    const hit = over === null || !rowsIn.length ? null : over / rowsIn.length;
    const hitS = small || hit === null ? null : hit * 2 - 1;
    const sm = small ? " rs-small" : "";
    const smTip = small ? ` (Small Sample: under ${SMALL} games, not colored)` : "";
    // Threes: 3PA and 3P% where Points has minutes and shots (the owner, 2026-11-04: no minutes)
    const att = avgOf(rowsIn, "fg3a"), pc = pct3(rowsIn);
    const ch = REBS || ASTS ? chances(rowsIn) : null;
    const mid = REBS || ASTS ? T(fmt(m), vsSeason(m, seasonMin, 0.1), `Minutes a game (season ${fmt(seasonMin)})${smTip}`, sm.trim())
      + T(fmt(ch), vsSeason(ch, seasonCh, 0.1), `${ASTS ? "Assist chances a game: his teammates' made shots while he was on the floor" : "Rebound chances a game: rebounds by anyone while he was on the floor"} (season ${fmt(seasonCh)})${smTip}`, sm.trim())
      : THREES ? T(fmt(att), vsSeason(att, seasonAtt, 0.2), `Threes tried a game (season ${fmt(seasonAtt)})${smTip}`, sm.trim())
      + T(fmt(pc, 0), small || pc === null || seasonPct === null ? null : (pc - seasonPct) / 12, `Three-point % (season ${fmt(seasonPct, 0)})${smTip}`, sm.trim())
      : T(fmt(m), vsSeason(m, seasonMin, 0.1), `Minutes a game (season ${fmt(seasonMin)})${smTip}`, sm.trim())
      + T(fmt(s), vsSeason(s, seasonFga, 0.15), `Shots a game (season ${fmt(seasonFga)})${smTip}`, sm.trim());
    rows.push(LB(label, tip) + T(String(rowsIn.length), null, `${tip}${smTip}`, `rs-count${sm}`) + T(fmt(a), rel, `${tip}: ${fmt(a)} ${unit} a game (season ${fmt(season)})${smTip}`, sm.trim())
      + T(all ? "--" : sgn(a === null || season === null ? null : a - season), rel, `${MK.unit} a game minus his season${smTip}`, sm.trim())
      + mid
      + T(over === null || !rowsIn.length ? "--" : `${over} of ${rowsIn.length}`, hitS, `Games over tonight's line${smTip}`, sm.trim())
      + T(hit === null ? "--" : `${Math.round(hit * 100)}%`, hitS, `Games over tonight's line${smTip}`, sm.trim()));
  };
  const hs = x.g.home_team_spread;
  const sp = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  const tot = x.g.total_line ?? null;
  const tp = teams[x.team] && teams[x.opp] ? (teams[x.team].off_pace + teams[x.opp].off_pace) / 2 : null;
  // the schedule spots left this tab (the owner, 2026-11-03: "too niche")
  add("All Games", log, "Every game this season", true);
  if (sp !== null) add(`Spread ${sgn(sp)}`, log.filter((r) => { const g = gOf(r); return g[2] !== null && g[2] !== undefined && Math.abs((r[f.home] ? g[2] : -g[2]) - sp) <= SCRIPT_RANGE; }), `His games with his team's spread from ${sgn(sp - SCRIPT_RANGE)} to ${sgn(sp + SCRIPT_RANGE)} (tonight ${sgn(sp)})`);
  if (tot !== null) add(`Total ${fmt(tot)}`, log.filter((r) => { const v = gOf(r)[1]; return v !== null && v !== undefined && Math.abs(v - tot) <= SCRIPT_RANGE; }), `His games with a total from ${fmt(tot - SCRIPT_RANGE)} to ${fmt(tot + SCRIPT_RANGE)} (tonight ${fmt(tot)})`);
  if (tp !== null) add(`Pace ${fmt(tp)}`, log.filter((r) => { const v = gOf(r)[0]; return v !== null && v !== undefined && Math.abs(v - tp) <= PACE_RANGE; }), `His games with a pace from ${fmt(tp - PACE_RANGE)} to ${fmt(tp + PACE_RANGE)} (tonight: ${x.team} and ${x.opp}'s average, ${fmt(tp)})`);
  add(x.home ? "Home Games" : "Road Games", log.filter((r) => Boolean(r[f.home]) === x.home), `His ${x.home ? "home" : "road"} games (tonight he's ${x.home ? "home" : "on the road"})`);
  add("Last 10", log.slice(-10), "His last 10 games");
  const cornerTxt = `<div class="rs-t rs-corner" title="His games in spots like tonight's: spread and total within ${SCRIPT_RANGE} points, pace within ${PACE_RANGE} possessions"><span class="rs-key rs-him">${jersey(x.pid)}</span>Like Tonight</div>`;
  const head = cornerTxt + ["Games", MK.short, "+/-", ...(THREES ? ["3PA", "3P%"] : REBS || ASTS ? ["MIN", "Chances"] : ["MIN", "FGA"]), line === null ? "Over" : `Over ${fmt(line)}`, "Hit %"].map((h) => HD(h, "him")).join("");
  return gridOf(head, rows);
}

// ---- right box ----
// Vs The Line: his last games as bars that touch, tonight's line dashed across them, the line he had
// that night as a line of dots (green = he cleared it); the strip under it counts them.
// The last LINE_DAYS days, one slot a day (the owner, 2026-11-03): a bar when he played, OUT when his
// team played without him, OFF when his team didn't play. His team's days = days 2+ of his current
// teammates played (a player traded in doesn't bring his old team's nights).
const LINE_DAYS = 15;
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
function lineTab(x) {
  const f = logFields();
  const mine = logOf(x.pid);
  const lines = rsOf(x.pid)[THREES ? "lines3" : REBS ? "linesr" : ASTS ? "linesa" : "lines"] || {};
  // Assists: that night's chances (teammates' makes with him on the floor) and his rate, against his
  // season (the owner, 2026-11-04: "why did he pass more that game?")
  const acg = rsOf(x.pid).acg || {};
  const acgAll = Object.values(acg);
  const seasonC = acgAll.length ? avg(acgAll.map((v) => v[0])) : null;
  const seasonR = acgAll.length ? acgAll.reduce((n, v) => n + v[1], 0) / Math.max(1, acgAll.reduce((n, v) => n + v[0], 0)) : null;
  if (!mine.length) return gridOf(corner(x) + HD("", "plain", "rs-s7"), []);
  const line = x.line;
  const byDate = Object.fromEntries(mine.map((r) => [r[f.date], r]));
  const teamDays = {};
  let first = null, latest = null;
  for (const [id, p] of Object.entries(seasonBlock().players)) {
    for (const r of p.log || []) {
      const d = r[f.date];
      if (!first || d < first) first = d;
      if (!latest || d > latest) latest = d;
      if (p.team === x.team && id !== String(x.pid)) (teamDays[d] = teamDays[d] || { n: 0, opp: r[f.opp] }).n += 1;
    }
  }
  // the window ends the night before this game, or at the last night anyone has played
  let end = addDays(x.g.date, -1);
  if (latest && latest < end) end = latest;
  const slots = [];
  for (let i = LINE_DAYS - 1; i >= 0; i -= 1) {
    const d = addDays(end, -i);
    if (first && d < first) continue;
    const r = byDate[d];
    const td = teamDays[d];
    slots.push({ d, r, kind: r ? "played" : td && td.n >= 2 ? "out" : "off", opp: r ? r[f.opp] : td && td.n >= 2 ? td.opp : "" });
  }
  const n = slots.length;
  const played = slots.filter((s) => s.r);
  const vals = played.map((s) => s.r[f[MK.stat]] || 0);
  const thenOf = (s) => (s.r ? lines[String(s.r[f.game])] ?? null : null);
  const max = Math.max(THREES ? 4 : REBS ? 8 : ASTS ? 6 : 10, line || 0, ...played.map(thenOf).filter((v) => v !== null), ...vals) * 1.12;
  const pctY = (v) => (v / max) * 100;
  const pts = [];
  const bars = slots.map((s, i) => {
    const pos = `left:${(i / n) * 100}%;width:${100 / n}%`;
    if (!s.r) {
      const tip = s.kind === "out" ? `${gameDate(s.d)}: his team played ${s.opp} without him` : `${gameDate(s.d)}: no game`;
      return `<div class="rs-vday ${s.kind}" style="${pos}"${tipAttr(tip)}><span>${s.kind === "out" ? "OUT" : "OFF"}</span></div>`;
    }
    const v = s.r[f[MK.stat]] || 0;
    const then = thenOf(s);
    if (then !== null) pts.push({ x: ((i + 0.5) / n) * 100, y: 100 - pctY(then), v: then, hit: v > then });
    const cls = line === null ? "" : v > line ? " over" : " under";
    const did = THREES ? `${v} of ${s.r[f.fg3a] || 0} threes in ${s.r[f.min]} min`
      : REBS ? `${v} reb (${s.r[f.dreb] ?? "?"} defensive, ${s.r[f.oreb] ?? "?"} offensive) in ${s.r[f.min]} min`
      : ASTS ? `${v} ast in ${s.r[f.min]} min${(() => { const a = acg[String(s.r[f.game])]; return a ? `: teammates made ${a[0]} shots with him on the floor (season ${fmt(seasonC)} a game), he assisted ${pctT(a[0] ? a[1] / a[0] : null)} of them (season ${pctT(seasonR)})` : ""; })()}` : `${v} pts in ${s.r[f.min]} min, ${s.r[f.fga]} shots`;
    const tip = `${gameDate(s.d)} ${s.r[f.home] ? "vs" : "@"} ${s.r[f.opp]}: ${did}${then !== null ? `; his line was ${fmt(then)} (${v > then ? "cleared" : "missed"})` : "; no line saved for that night"}`;
    // Threes: makes / tries on the bar (the owner, 2026-11-04); a night with none is a red chip at the floor
    if (THREES && !v) return `<div class="rs-vday zero" style="${pos}"${tipAttr(tip)}><span>0/${s.r[f.fg3a] || 0}</span></div>`;
    return `<div class="rs-vbar${cls}" style="${pos};height:${pctY(v)}%"${tipAttr(tip)}><b>${v}${THREES ? `<small>/${s.r[f.fg3a] || 0}</small>` : ""}</b></div>`;
  }).join("");
  const path = pts.map((p, i) => `${i ? "L" : "M"}${(p.x * 10).toFixed(1)},${(p.y * 10).toFixed(1)}`).join("");
  const dots = pts.map((p) => `<i class="rs-vdot${p.hit ? " hit" : ""}" style="left:${p.x}%;top:${p.y}%"${tipAttr(`His line that night: ${fmt(p.v)} (${p.hit ? "cleared" : "missed"})`)}><em>${fmt(p.v)}</em></i>`).join("");
  const lineMark = line === null ? "" : `<div class="rs-vline" style="bottom:${pctY(line)}%"${tipAttr(`Tonight's line: ${fmt(line)}`)}><em>${fmt(line)}</em></div>`;
  const labels = slots.map((s) => `<span><b>${s.r ? `${s.r[f.home] ? "" : "@"}${s.opp}` : s.kind === "out" ? s.opp : "&nbsp;"}</b>${gameDate(s.d)}</span>`).join("");
  return `<div class="rs-vl"><div class="rs-vplot">${bars}${lineMark}${path ? `<svg class="rs-vpath" viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="${path}"></path></svg>` : ""}${dots}</div><div class="rs-vx">${labels}</div></div>`;
}

// Rotation: when he's on the floor, minute by minute (green = on the floor in most of those games),
// season / last 5 / last game, under quarter headers that carry his points by quarter.
function rotationTab(x) {
  const r = rsOf(x.pid);
  if (!r.rot || !r.rotn || !r.rotn[0]) return gridOf(`<div class="rs-t rs-corner">On The Floor</div>` + HD("", "plain", "rs-s7"), [], { cls: "rs-rot", n: 3 });
  const QN = ["1st", "2nd", "3rd", "4th"];
  // four quarter blocks of 12 minutes, a clear gap between quarters
  const strip = (counts, nGames, label) => LB(label) + `<div class="rs-strip rs-s7">${QN.map((q, qi) => `<span>${counts.slice(qi * 12, qi * 12 + 12).map((c, k) => `<i style="${c ? stepStyle((c / nGames) * 2 - 1) : ""}"${tipAttr(`Minute ${qi * 12 + k + 1} (${q} quarter): on the floor in ${c} of ${nGames} game${nGames === 1 ? "" : "s"}`)}></i>`).join("")}</span>`).join("")}</div>`;
  const games = r.rotn[0];
  const qs = (r.q || [0, 0, 0, 0]).map((v) => v / games);
  const qTot = qs.reduce((a, b) => a + b, 0);
  const rows = [
    strip(r.rot, games, "Season"), strip(r.rot5, r.rotn[1], `Last ${r.rotn[1]}`), r.rot1 ? strip(r.rot1, 1, "Last Game") : LB("Last Game") + T("--", null, "", "rs-s7"),
  ];
  // the quarter headers carry his points a game in that quarter, colored by his share of his points
  // (the owner, 2026-11-03: the rows under the strips were noise answered elsewhere)
  const qHead = (q, i) => {
    const s = qTot ? (qs[i] / qTot - 0.25) / 0.08 : null;
    return `<div class="rs-t rs-h rs-qt"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(`${fmt(qs[i])} points a game in the ${q} quarter (${qTot ? Math.round((qs[i] / qTot) * 100) : 0}% of his points)`)}>${q} Qtr<b>${fmt(qs[i])} Pts</b></div>`;
  };
  const head = `<div class="rs-t rs-corner">On The Floor</div><div class="rs-qh rs-s7">${THREES || REBS ? qHead3(r, games) : ASTS ? qHeadA(r, games) : QN.map(qHead).join("")}</div>`;
  return gridOf(head, rows, { cls: "rs-rot", n: 3 });
}

// Teammates: his shots and points a 36 with each teammate on the floor and off it, how often they
// share the floor, the change, and the teammate's assists on his makes. With and Without are both
// colored against his usual rate (both sides of a pair always get a color).
function teammatesTab(x) {
  const p = playerOf(x.pid) || {};
  const feedRow = rsOf(x.pid).feed || [0, []];
  const feed = Object.fromEntries(feedRow[1]);
  const makes = feedRow[0];
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team).sort((a, b) => b[1][0] - a[1][0]).slice(0, RS_ROWS);
  const all = mates.length ? mates[0][1] : [0, 0, 0, 0, 0, 0];
  const usualPts = per36(all[1] + all[4], all[0] + all[3]), usualShots = per36(all[2] + all[5], all[0] + all[3]);
  const vs = (v, usual, k) => (v === null || usual === null ? null : (v - usual) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, pOn, fOn, mOff, pOff, fOff] = w;
    const together = mOn / (mOn + mOff);
    const on = per36(pOn, mOn), off = mOff >= 20 ? per36(pOff, mOff) : null;
    const sOn = per36(fOn, mOn), sOff = mOff >= 20 ? per36(fOff, mOff) : null;
    const diff = off === null ? null : off - on;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return `<div class="rs-t rs-l${isOut(st) ? " rs-out" : ""}">${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}</div>`
      + T(pctT(together), together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`)
      + T(fmt(sOn), vs(sOn, usualShots, 3), `His shots a 36 with ${name} on the floor (his usual ${fmt(usualShots)})`)
      + T(fmt(sOff), vs(sOff, usualShots, 3), `His shots a 36 with ${name} off the floor (his usual ${fmt(usualShots)})`)
      + T(fmt(on), vs(on, usualPts, 4), `His points a 36 with ${name} on the floor (${Math.round(mOn)} min; his usual ${fmt(usualPts)})`)
      + T(fmt(off), vs(off, usualPts, 4), `His points a 36 with ${name} off the floor (${Math.round(mOff)} min; his usual ${fmt(usualPts)})`)
      + T(diff === null ? "--" : sgn(diff), diff === null ? null : diff / 6, `Points a 36 without ${name} minus with: green = he scores more when ${name} sits`)
      + T(feed[id] ? String(feed[id]) : "--", feed[id] && makes ? (feed[id] / makes) * 8 - 1 : null, `${name}'s assists on his made shots${makes ? ` (${feed[id] || 0} of his ${makes})` : ""}`);
  });
  const head = corner(x) + HD("Together", "plain", "", "Share of his minutes with that teammate on the floor") + HD("Shots With", "him") + HD("Shots W/O", "him") + HD("Pts With", "him") + HD("Pts W/O", "him") + HD("Change", "him", "", "Points a 36 without minus with") + HD("Assists", "plain", "", "That teammate's assists on his made shots");
  return gridOf(head, rows, { cls: "rs-wide" });
}

// ---- Threes (the owner, 2026-11-04) ----
// Shooting: HOW he gets his threes (the Shot Map shows WHERE): his share of his threes each way,
// its rank among his position and threes made a game, beside the share of his position's threes
// against tonight's defense that came that way, its rank of 30, made a game, and the read.
// research.py `t3` / `def3`: [made, tried] by THREE_KINDS, then every three.
const THREE_WAYS = [
  ["Catch & Shoot", "catch-and-shoot threes (a plain jump shot)"],
  ["Pull-Up", "pull-up threes (fades too)"],
  ["Step-Back", "step-back threes"],
  ["Transition", "threes in transition (the first 8 seconds after a miss or a steal)"],
  ["Second Chance", "threes after an offensive rebound, same possession"],
];
const SHARE_MIN_3PA = 10; // a player at his position needs this many threes to rank his shares
const READ_TIP3 = { Over: "The Over: one side points to more threes this way and the other doesn't point against it", Under: "The Under: one side points to fewer threes this way and the other doesn't point against it", Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };
function shootingTab(x) {
  const pool = posPool(x.p.pos);
  const D = defenseByPos(x.p.pos);
  const def3 = RS().def3 || {};
  const t3 = rsOf(x.pid).t3;
  const games = logOf(x.pid).length || 1;
  const of = (arr, i) => (arr && arr[11] ? arr[2 * i + 1] / arr[11] : null);
  const dg = ((D.teams[x.opp] || {}).season || {}).n || 0;
  const rows = THREE_WAYS.map(([label, what], i) => {
    const v = of(t3, i);
    const vals = pool.map(([id]) => { const q = rsOf(id).t3; return q && q[11] >= SHARE_MIN_3PA ? of(q, i) : null; });
    const rk = rankIn(v, vals), s = spread(v, vals);
    const dv = of((def3[x.opp] || {})[x.p.pos], i);
    const sorted = Object.keys(def3).filter((t) => of((def3[t] || {})[x.p.pos], i) !== null).sort((a, b) => of(def3[b][x.p.pos], i) - of(def3[a][x.p.pos], i));
    const dr = sorted.indexOf(x.opp) + 1;
    const ds = dr ? rankSigned(dr, sorted.length) : null;
    const rd = readOf(s, ds);
    const mine = t3 ? [t3[2 * i], t3[2 * i + 1]] : [0, 0];
    const theirs = ((def3[x.opp] || {})[x.p.pos] || []).slice(2 * i, 2 * i + 2);
    const mg = t3 ? mine[0] / games : null, dmg = theirs.length && dg ? theirs[0] / dg : null;
    const tip = `Share of his threes that are ${what}: ${mine[0]} of ${mine[1]} made (${pctT(mine[1] ? mine[0] / mine[1] : null)})`;
    const dtip = `${team(x.opp).name}: share of ${x.p.pos}s' threes against them that are ${what}${theirs.length ? `: ${theirs[0]} of ${theirs[1]} made (${pctT(theirs[1] ? theirs[0] / theirs[1] : null)})` : ""}`;
    return LB(label, `${what[0].toUpperCase()}${what.slice(1)}`) + T(pctT(v), s, tip) + T(rankTxt(rk), s, rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s (${SHARE_MIN_3PA}+ threes)` : "")
      + T(mg === null ? "--" : fmt(mg), mg === null ? null : s, mg === null ? "" : `${fmt(mg)} made a game this way`)
      + DT(pctT(dv), ds, dtip) + DT(dr ? ordinal(dRank(dr, sorted.length)) : "--", ds, dr ? dWords(dr, sorted.length) : "")
      + DT(dmg === null ? "--" : fmt(dmg), dmg === null ? null : ds, dmg === null ? "" : `${team(x.opp).name} allow ${x.p.pos}s ${fmt(dmg)} made a game this way`)
      + RT(rd, READ_TIP3[rd.t], { label, him: numOf(v, pctT), hu: "%", hr: rk ? rk.r : null, def: numOf(dv, pctT), du: "%", dr: dr ? dRank(dr, sorted.length) : null });
  });
  const head = corner(x) + HD("Share", "him") + HD("Rank", "him") + HD("3PM / G", "him") + HD("Allowed", "def") + HD("Rank", "def") + HD("3PM / G", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: BANDS_3_3_1, fill: true });
}

// Shot Map: his threes and tonight's defense's threes allowed to his position, side by side, as
// the player card's heat map (size = how many, color = make rate vs the league from that spot).
// The defense's map is drawn as a defense (the owner, 2026-11-06: "bad defense is red"): red = his
// position makes more there against them than the league does.
const MAP_HEX = 2.6; // feet: bigger than the card's 1.6, the drawing is a third the size
const MAP_DEF = new Map();
function threesAllowed(file, opp, pos) {
  const key = `${opp}:${pos}`;
  if (MAP_DEF.get("file") !== file) {
    MAP_DEF.clear();
    MAP_DEF.set("file", file);
  }
  if (!MAP_DEF.has(key)) {
    const t = (file.teams || []).indexOf(opp);
    const players = seasonBlock().players;
    const out = [];
    if (t >= 0) for (const [id, list] of Object.entries(file.players || {})) if ((players[id] || {}).pos === pos) list.forEach((s) => s[8] === t && s[3] === 1 && out.push(s));
    MAP_DEF.set(key, out);
  }
  return MAP_DEF.get(key);
}
function mapTab(x) {
  const file = typeof nbaShotFile === "function" ? nbaShotFile() : null;
  if (file === undefined) {
    Promise.resolve(NBA_SHOT_FILE).then(() => refreshBox("left"));
    return '<div class="rs-map-note">Loading the shot charts&hellip;</div>';
  }
  if (!file) return '<div class="rs-map-note">The shot charts aren&rsquo;t available right now.</div>';
  const mine = ((file.players || {})[String(x.pid)] || []).filter((s) => s[3] === 1);
  const theirs = threesAllowed(file, x.opp, x.p.pos);
  const sum = (shots) => { const m = shots.reduce((n, s) => n + s[2], 0); return `<b>${m}/${shots.length}</b><b>${pctT(shots.length ? m / shots.length : null)}</b>`; };
  const chart = (shots, allowed = false) => (shots.length ? nbaShotHeatView(shots, file.league || [], { hex: MAP_HEX, legend: false, allowed }) : '<div class="rs-map-note">No threes yet.</div>');
  const hex = (size, fill) => `<svg width="18" height="16" viewBox="-9 -8 18 16"><path d="${[0, 1, 2, 3, 4, 5].map((k) => `${k ? "L" : "M"}${(size * Math.cos((Math.PI / 3) * k)).toFixed(1)},${(size * Math.sin((Math.PI / 3) * k)).toFixed(1)}`).join(" ")}Z" fill="${fill}"/></svg>`;
  const scale = (sign) => [-1, -0.5, 0, 0.5, 1].map((t) => hex(7, nbaShotColor(sign * t * NBA_SHOT_FULL))).join("");
  // a color key under each map (his: green = hotter; the defense's: red = more makes against them);
  // bigger = more threes is in the tab's tip
  const legend = `<div class="rs-map rs-map-keys"><div class="rs-map-key" title="His make rate from each spot vs the league's (bigger = more threes)"><span>Colder</span>${scale(1)}<span>Hotter</span></div><div class="rs-map-key" title="${x.p.pos}s' make rate against them from each spot vs the league's: red = bad defense (bigger = more threes)"><span>Fewer Makes</span>${scale(-1)}<span>More Makes</span></div></div>`;
  return `<div class="rs-map">
    <div class="rs-mapc"><div class="rs-t rs-h rs-him rs-maph" title="His threes this season: made / tried, make rate">${jersey(x.pid)}<span>His Threes</span>${sum(mine)}</div>${chart(mine)}</div>
    <div class="rs-mapc"><div class="rs-t rs-h rs-def rs-maph" title="Every three ${x.p.pos}s took against ${team(x.opp).name} this season: made / tried, make rate. Red = they make more there than the league does (bad defense: good for him).">${logo(x.opp, 15)}<span>Allowed To ${x.p.pos}s</span>${sum(theirs)}</div>${chart(theirs, true)}</div>
  </div>${legend}`;
}

// Ladder (Threes and Rebounds): how often he hit each number (real games), the columns sliding to sit
// around tonight's line (its Over column has the green header); None = nights with no threes.
// Rows: season, last 10, last 5, tonight's venue, games with a spread like tonight's, and games
// against defenses in the same third of the league as tonight's (threes made by his position).
function ladderTab(x) {
  const f = logFields();
  const log = logOf(x.pid);
  const v = (r) => r[f[MK.stat]] || 0;
  const U = MK.unit.toLowerCase();
  const overK = x.line === null ? Math.max(1, Math.round(avg(log.map(v)) || 1)) : Math.floor(x.line) + 1;
  const start = Math.max(0, overK - 3);
  const ks = Array.from({ length: 7 }, (_, i) => start + i);
  const add = (label, rows, tip) => {
    const small = rows.length < SMALL;
    const sm = small ? " rs-small" : "";
    const smTip = small ? ` (Small Sample: under ${SMALL} games, not colored)` : "";
    return LB(`${label}<span class="rs-gn">${rows.length} G</span>`, tip) + ks.map((k) => {
      const c = rows.filter((r) => (k === 0 ? v(r) === 0 : v(r) >= k)).length;
      const p = rows.length ? c / rows.length : null;
      const s = small || p === null ? null : k === 0 ? 1 - 2 * p : 2 * p - 1;
      return T(p === null ? "--" : `${Math.round(p * 100)}%`, s, `${tip}: ${c} of ${rows.length} games with ${k === 0 ? `no ${U}` : `${k}+ ${U}`}${smTip}`, sm.trim());
    }).join("");
  };
  const games = RS().games || {};
  const hs = x.g.home_team_spread;
  const sp = hs === null || hs === undefined ? null : x.home ? hs : -hs;
  const rk = defenseByPos(x.p.pos).ranks.season[MK.stat];
  const third = (t) => (rk.r[t] ? Math.min(2, Math.floor(((rk.r[t] - 1) / rk.n) * 3)) : null);
  const tonight = third(x.opp);
  const rows = [add("Season", log, "Every game this season"), add("Last 10", log.slice(-10), "His last 10 games"), add("Last 5", log.slice(-5), "His last 5 games"),
    add(x.home ? "Home" : "Road", log.filter((r) => Boolean(r[f.home]) === x.home), `His ${x.home ? "home" : "road"} games`)];
  if (sp !== null) {
    rows.push(add(`Spread ${sgn(sp)}`, log.filter((r) => { const g = games[String(r[f.game])] || []; return g[2] !== null && g[2] !== undefined && Math.abs((r[f.home] ? g[2] : -g[2]) - sp) <= SCRIPT_RANGE; }),
      `His games with his team's spread from ${sgn(sp - SCRIPT_RANGE)} to ${sgn(sp + SCRIPT_RANGE)} (tonight ${sgn(sp)})`));
  }
  if (tonight !== null) {
    const lo = Math.floor((tonight * rk.n) / 3) + 1, hi = Math.floor(((tonight + 1) * rk.n) / 3);
    rows.push(add(`Vs Like ${x.opp}`, log.filter((r) => third(r[f.opp]) === tonight),
      `His games against defenses ranked ${ordinal(lo)}-${ordinal(hi)} in ${U} by ${x.p.pos}s against them (tonight's ${x.opp}: ${ordinal(rk.r[x.opp])})`));
  }
  const over = (k) => k === overK && x.line !== null;
  const head = `<div class="rs-t rs-corner" title="How often he hit each number"><span class="rs-key rs-him">${jersey(x.pid)}</span>${THREES ? "Threes Made" : MK.unit}</div>`
    + ks.map((k) => HD(k === 0 ? "None" : `${k}+`, over(k) ? "rd" : "him", "", over(k) ? `Tonight's Over ${fmt(x.line)}` : k === 0 ? `Games with no ${U}` : `Games with ${k} or more ${U}`)).join("");
  return gridOf(head, rows, { cls: "rs-wide", fill: rows.length < RS_ROWS });
}

// Rotation (Threes): the quarter headers carry threes made AND tried a game in that quarter
// (the owner, 2026-11-04), colored by his share of his made threes.
// Rebounds: REB and OREB a quarter (research.py `qr`), colored by his share of his rebounds.
function qHead3(r, games) {
  const q3 = (REBS ? r.qr : r.q3) || [0, 0, 0, 0, 0, 0, 0, 0];
  const [A, B, what] = REBS ? ["REB", "OREB", ["rebounds", "offensive rebounds", "rebounds"]] : ["3PM", "3PA", ["threes made", "tried", "made threes"]];
  const made = [0, 1, 2, 3].map((i) => q3[2 * i] / games), tried = [0, 1, 2, 3].map((i) => q3[2 * i + 1] / games);
  const tot = made.reduce((a, b) => a + b, 0);
  return ["1st", "2nd", "3rd", "4th"].map((q, i) => {
    const s = tot ? (made[i] / tot - 0.25) / 0.08 : null;
    return `<div class="rs-t rs-h rs-qt rs-qt3"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(`${q} quarter: ${fmt(made[i])} ${what[0]}, ${fmt(tried[i])} ${what[1]} a game (${tot ? Math.round((made[i] / tot) * 100) : 0}% of his ${what[2]})`)}>${q} Qtr<b>${fmt(made[i])} ${A} &middot; ${fmt(tried[i])} ${B}</b></div>`;
  }).join("");
}

// Teammates (Threes): his threes tried and made a 36 with each teammate on the floor and off it,
// the change in made, and that teammate's assists on his threes (research.py `w3`, `feed3`).
function teammates3Tab(x) {
  const p = playerOf(x.pid) || {};
  const w3 = rsOf(x.pid).w3 || {};
  const feedRow = rsOf(x.pid).feed3 || [0, []];
  const feed = Object.fromEntries(feedRow[1]);
  const makes = feedRow[0];
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team && w3[id]).sort((a, b) => b[1][0] - a[1][0]).slice(0, RS_ROWS);
  const usual = (k) => { const [id, w] = mates[0] || []; if (!id) return null; const t = w3[id]; return per36(t[k] + t[k + 2], w[0] + w[3]); };
  const usualA = usual(1), usualM = usual(0);
  const vs = (v, u, k) => (v === null || u === null ? null : (v - u) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, , , mOff] = w;
    const [om, oa, fm, fa] = w3[id];
    const together = mOn / (mOn + mOff);
    const aOn = per36(oa, mOn), aOff = mOff >= 20 ? per36(fa, mOff) : null;
    const on = per36(om, mOn), off = mOff >= 20 ? per36(fm, mOff) : null;
    const diff = off === null ? null : off - on;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return `<div class="rs-t rs-l${isOut(st) ? " rs-out" : ""}">${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}</div>`
      + T(pctT(together), together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`)
      + T(fmt(aOn), vs(aOn, usualA, 2), `His threes tried a 36 with ${name} on the floor: ${oa} in ${Math.round(mOn)} min (his usual ${fmt(usualA)})`)
      + T(fmt(aOff), vs(aOff, usualA, 2), `His threes tried a 36 with ${name} off the floor: ${fa} in ${Math.round(mOff)} min (his usual ${fmt(usualA)})`)
      + T(fmt(on), vs(on, usualM, 1), `His threes made a 36 with ${name} on the floor: ${om} (his usual ${fmt(usualM)})`)
      + T(fmt(off), vs(off, usualM, 1), `His threes made a 36 with ${name} off the floor: ${fm} (his usual ${fmt(usualM)})`)
      + T(diff === null ? "--" : sgn(diff), diff === null ? null : diff / 1.5, `Threes made a 36 without ${name} minus with: green = he makes more when ${name} sits`)
      + T(feed[id] ? String(feed[id]) : "--", feed[id] && makes ? (feed[id] / makes) * 8 - 1 : null, `${name}'s assists on his made threes${makes ? ` (${feed[id] || 0} of his ${makes})` : ""}`);
  });
  const head = corner(x) + HD("Together", "plain", "", "Share of his minutes with that teammate on the floor") + HD("3PA With", "him") + HD("3PA W/O", "him") + HD("3PM With", "him") + HD("3PM W/O", "him") + HD("Change", "him", "", "Threes made a 36 without minus with") + HD("Assists", "plain", "", "That teammate's assists on his made threes");
  return gridOf(head, rows, { cls: "rs-wide" });
}

// ---- Rebounds (the owner, 2026-11-04) ----
// Rebounding: why his number is what it is. Chances (every rebound off a miss while he's on the
// floor, a 36) times his share of them, at each end, beside the side of tonight's opponent that
// drives each one: how many misses they leave (defensive chances), how much they crash (fewer for
// him), the shooting they allow (his team's misses), and how well they clean their own glass.
// research.py `rb` / `rbt`. Value and rank each side, then the read (five columns, like Matchup).
const RATE_MIN_CHANCES = 20; // a rate needs this many chances to rank
function reboundingTab(x) {
  const pool = posPool(x.p.pos);
  const TR = RS().rbt || {};
  const teams = identityTeams();
  const rb = (id) => rsOf(id).rb;
  const per36c = (k) => (id) => { const r = rb(id); return r && r[4] ? (r[k] / (r[4] / 60)) * 36 : null; };
  const rate = (c, g) => (id) => { const r = rb(id); return r && r[c] >= RATE_MIN_CHANCES ? r[g] / r[c] : null; };
  const tv = (get) => (t) => { const a = TR[t]; return a && a[0] ? get(a) : null; };
  const him = (get, show) => {
    const v = get(x.pid), vals = pool.map(([id]) => get(id)), rk = rankIn(v, vals), s = spread(v, vals);
    return { s, v: show(v), r: rk ? ordinal(rk.r) : "--", rt: rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "", n: numOf(v, show), u: unitOf(show), rank: rk ? rk.r : null };
  };
  const them = (rk, t, show, flip = false) => {
    const s = rankSigned(rk.r[t], rk.n);
    const d = t === x.opp ? defRank(rk.r[t], rk.n, flip) : { r: rk.r[t] || null, w: rk.r[t] ? rankWords(rk.r[t], rk.n) : "" };
    return { s: s === null ? null : flip ? -s : s, v: show(rk.v[t]), r: d.r ? ordinal(d.r) : "--", rt: d.w, n: numOf(rk.v[t], show), u: unitOf(show), rank: d.r };
  };
  const pace = teamRanks((t) => (teams[t] || {}).off_pace ?? null);
  const name = team(x.opp).name;
  const ROWS = [
    ["Defensive Chances", `Defensive rebounds there to get: misses by the other team a 36 minutes while he's on the floor / misses ${name} leave a game (red = they miss a lot: more chances)`,
      him(per36c(0), (v) => fmt(v)), them(teamRanks(tv((a) => a[1] / a[0])), x.opp, (v) => fmt(v))],
    ["Defensive Rate", `His share of those misses he grabs / how often ${name} get their own misses back (green = they crash: fewer left for him)`,
      him(rate(0, 1), pctT), them(teamRanks(tv((a) => (a[1] ? a[2] / a[1] : null))), x.opp, pctT, true)],
    ["Offensive Chances", `Offensive rebounds there to get: his team's misses a 36 while he's on the floor / the field goal % ${name} allow (green = they let shots go in: fewer misses)`,
      him(per36c(2), (v) => fmt(v)), them(teamRanks(tv((a) => (a[6] ? a[5] / a[6] : null))), x.opp, pctT, true)],
    ["Offensive Rate", `His share of his team's misses he grabs / how often ${name} clean up the other team's misses (green = they do: fewer left for him)`,
      him(rate(2, 3), pctT), them(teamRanks(tv((a) => (a[3] ? a[4] / a[3] : null))), x.opp, pctT, true)],
    ["Pace", "His team's pace / the opponent's pace (possessions a 48 minutes; more possessions = more misses; his team 1st = fastest, the opponent 30th = fastest, red)",
      them(pace, x.team, (v) => fmt(v)), them(pace, x.opp, (v) => fmt(v))],
  ];
  const rows = ROWS.map(([label, tip, a, b]) => {
    const rd = readOf(a.s, b.s);
    return LB(label, tip) + T(a.v, a.s, tip) + T(a.r, a.s, a.rt) + DT(b.v, b.s, tip) + DT(b.r, b.s, b.rt) + RT(rd, READ_TIP_R[rd.t], pairNum(label, a, b));
  });
  const head = corner(x) + HD(jersey(x.pid), "him", "", nameOf(x.pid)) + HD("Rank", "him") + HD(logo(x.opp, 15), "def", "", name) + HD("Rank", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: [["him", 2, 2], ["def", 4, 2], ["rd", 6, 1]], cls: "rs-five rs-wide", fill: true });
}
const READ_TIP_R = { Over: "The Over: one side points to more rebounds for him and the other doesn't point against it", Under: "The Under: one side points to fewer rebounds for him and the other doesn't point against it", Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };

// Miss Zones: where the misses he grabs on defense come from, beside where tonight's opponent
// misses from (research.py `rz` / `mz`, MISS_ZONES order). A big living on rim misses against a
// team that misses at the rim a lot reads Over; a wing who gets long boards against a team that
// misses a lot of threes, the same.
const MISS_ZONE_ROWS = [["Rim", "misses at the rim (0-4 ft)"], ["Paint", "short misses (5-9 ft)"], ["Mid-Range", "mid-range misses"],
  ["Corner 3", "corner three misses"], ["Above-Break 3", "above-the-break three misses"], ["Free Throws", "missed free throws"]];
const ZONE_MIN_BOARDS = 10; // a player of his position needs this many defensive boards to rank his shares
function missZonesTab(x) {
  const pool = posPool(x.p.pos);
  const R = RS();
  const mz = R.mz || {}, TR = R.rbt || {};
  const tot = (a) => (a ? a.reduce((n, v) => n + v, 0) : 0);
  const of = (a, i) => (tot(a) ? a[i] / tot(a) : null);
  const rz = rsOf(x.pid).rz;
  const games = logOf(x.pid).length || 1;
  const rows = MISS_ZONE_ROWS.map(([label, what], i) => {
    const v = of(rz, i);
    const vals = pool.map(([id]) => { const q = rsOf(id).rz; return tot(q) >= ZONE_MIN_BOARDS ? of(q, i) : null; });
    const rk = rankIn(v, vals), s = spread(v, vals);
    const sorted = Object.keys(mz).filter((t) => of(mz[t], i) !== null).sort((a, b) => of(mz[b], i) - of(mz[a], i));
    const dr = sorted.indexOf(x.opp) + 1;
    const ds = dr ? rankSigned(dr, sorted.length) : null;
    const dv = of(mz[x.opp], i);
    const dg = (TR[x.opp] || [])[0] || 0;
    const mg = rz ? rz[i] / games : null, dmg = mz[x.opp] && dg ? mz[x.opp][i] / dg : null;
    const rd = readOf(s, ds);
    return LB(label, `${what[0].toUpperCase()}${what.slice(1)}`)
      + T(pctT(v), s, `Share of his defensive rebounds that came off ${what}${rz ? ` (${rz[i]} of ${tot(rz)})` : ""}`)
      + T(rankTxt(rk), s, rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s (${ZONE_MIN_BOARDS}+ defensive rebounds)` : "")
      + T(mg === null ? "--" : fmt(mg), mg === null ? null : s, mg === null ? "" : `${fmt(mg)} defensive rebounds a game off ${what}`)
      + DT(pctT(dv), ds, `Share of ${team(x.opp).name}'s rebounded misses that are ${what}`)
      + DT(dr ? ordinal(dRank(dr, sorted.length)) : "--", ds, dr ? dWords(dr, sorted.length) : "")
      + DT(dmg === null ? "--" : fmt(dmg), dmg === null ? null : ds, dmg === null ? "" : `${team(x.opp).name} leave ${fmt(dmg)} ${what} a game`)
      + RT(rd, READ_TIP_R[rd.t], { label, him: numOf(v, pctT), hu: "%", hr: rk ? rk.r : null, def: numOf(dv, pctT), du: "%", dr: dr ? dRank(dr, sorted.length) : null });
  });
  const head = corner(x) + HD("Share", "him") + HD("Rank", "him") + HD("DREB / G", "him") + HD("Misses", "def", "", `Where ${team(x.opp).name} miss from`) + HD("Rank", "def") + HD("Per G", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: BANDS_3_3_1 });
}

// Teammates (Rebounds): his rebounds a 36 and his share of the rebounds there to get, with each
// teammate on the floor and off it, the change in rebounds a 36, and that teammate's own rebounds
// a 36 (who he's sharing the glass with). research.py `wr`.
function teammatesRebTab(x) {
  const p = playerOf(x.pid) || {};
  const f = logFields();
  const wr = rsOf(x.pid).wr || {};
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team && wr[id]).sort((a, b) => b[1][0] - a[1][0]).slice(0, RS_ROWS);
  const [id0, w0] = mates[0] || [];
  const u = id0 ? wr[id0] : null;
  const usualR = u ? per36(u[0] + u[2], w0[0] + w0[3]) : null;
  const usualS = u && u[1] + u[3] ? (u[0] + u[2]) / (u[1] + u[3]) : null;
  const vs = (v, base, k) => (v === null || base === null ? null : (v - base) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, , , mOff] = w;
    const [rOn, cOn, rOff, cOff] = wr[id];
    const together = mOn / (mOn + mOff);
    const on = per36(rOn, mOn), off = mOff >= 20 ? per36(rOff, mOff) : null;
    const sOn = cOn ? rOn / cOn : null, sOff = mOff >= 20 && cOff ? rOff / cOff : null;
    const diff = off === null ? null : off - on;
    const log = logOf(id);
    const mins = log.reduce((n, r) => n + (r[f.min] || 0), 0);
    const theirs = mins ? (log.reduce((n, r) => n + (r[f.reb] || 0), 0) / mins) * 36 : null;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return `<div class="rs-t rs-l${isOut(st) ? " rs-out" : ""}">${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}</div>`
      + T(pctT(together), together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`)
      + T(fmt(on), vs(on, usualR, 2), `His rebounds a 36 with ${name} on the floor: ${rOn} in ${Math.round(mOn)} min (his usual ${fmt(usualR)})`)
      + T(fmt(off), vs(off, usualR, 2), `His rebounds a 36 with ${name} off the floor: ${rOff} in ${Math.round(mOff)} min (his usual ${fmt(usualR)})`)
      + T(pctT(sOn), vs(sOn, usualS, 0.03), `His share of the rebounds with ${name} on the floor: ${rOn} of ${cOn} (his usual ${pctT(usualS)})`)
      + T(pctT(sOff), vs(sOff, usualS, 0.03), `His share of the rebounds with ${name} off the floor: ${rOff} of ${cOff} (his usual ${pctT(usualS)})`)
      + T(diff === null ? "--" : sgn(diff), diff === null ? null : diff / 3, `Rebounds a 36 without ${name} minus with: green = he rebounds more when ${name} sits`)
      + T(fmt(theirs), theirs === null ? null : -(theirs - 7.5) / 5, `${name}'s own rebounds a 36 (red = a big rebounder sharing the glass)`);
  });
  const head = corner(x) + HD("Together", "plain", "", "Share of his minutes with that teammate on the floor") + HD("REB With", "him") + HD("REB W/O", "him") + HD("Share With", "him", "", "His share of the rebounds there to get") + HD("Share W/O", "him") + HD("Change", "him", "", "Rebounds a 36 without minus with") + HD("Their REB", "plain", "", "That teammate's own rebounds a 36");
  return gridOf(head, rows, { cls: "rs-wide" });
}

// ---- Assists (the owner, 2026-11-04; no turnovers: "too noisy") ----
// Playmaking: chances (a teammate's made shot while he's on the floor, a 36) times his share of
// them, beside the side of tonight's defense that drives each: the field goal % it allows (more
// makes = more chances), how many of the makes against it are assisted, how often it lets teams
// run, and pace. research.py `ap`; value and rank each side, then the read (five columns).
const AST_RATE_MIN = 30; // chances a rate needs to rank
const AST_TRANS_MIN = 10; // assists his transition share needs
function playmakingTab(x) {
  const pool = posPool(x.p.pos);
  const R = RS();
  const TR = R.rbt || {}, DP = R.defpos || {};
  const teams = identityTeams();
  const ap = (id) => rsOf(id).ap;
  const secs = (id) => ((rsOf(id).rb || [])[4]) || 0;
  const chances = (id) => { const a = ap(id), s = secs(id); return a && s ? (a[0] / (s / 60)) * 36 : null; };
  const rate = (id) => { const a = ap(id); return a && a[0] >= AST_RATE_MIN ? a[1] / a[0] : null; };
  const trans = (id) => { const a = ap(id); return a && a[1] >= AST_TRANS_MIN ? a[2] / a[1] : null; };
  const assistedAllowed = (t) => { const by = DP[t]; if (!by) return null; let m = 0, a = 0; for (const v of Object.values(by)) { m += v[4]; a += v[5]; } return m ? a / m : null; };
  const him = (get, show) => {
    const v = get(x.pid), vals = pool.map(([id]) => get(id)), rk = rankIn(v, vals), s = spread(v, vals);
    return { s, v: show(v), r: rk ? ordinal(rk.r) : "--", rt: rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s` : "", n: numOf(v, show), u: unitOf(show), rank: rk ? rk.r : null };
  };
  const them = (rk, t, show) => {
    const s = rankSigned(rk.r[t], rk.n);
    const d = t === x.opp ? defRank(rk.r[t], rk.n) : { r: rk.r[t] || null, w: rk.r[t] ? rankWords(rk.r[t], rk.n) : "" };
    return { s, v: show(rk.v[t]), r: d.r ? ordinal(d.r) : "--", rt: d.w, n: numOf(rk.v[t], show), u: unitOf(show), rank: d.r };
  };
  const name = team(x.opp).name;
  const pace = teamRanks((t) => (teams[t] || {}).off_pace ?? null);
  const ROWS = [
    ["Assist Chances", `Shots there to assist: his teammates' made shots a 36 minutes while he's on the floor / the field goal % ${name} allow (red = shots go in against them)`,
      him(chances, (v) => fmt(v)), them(teamRanks((t) => { const a = TR[t]; return a && a[6] ? a[5] / a[6] : null; }), x.opp, pctT)],
    ["Assist Rate", `His share of those makes he assisted / the share of made shots against ${name} that were assisted (red = they let the ball move)`,
      him(rate, pctT), them(teamRanks(assistedAllowed), x.opp, pctT)],
    ["Transition", `Share of his assists on fast breaks / how often teams run on ${name}`,
      him(trans, pctT), them(teamRanks((t) => (teams[t] || {}).def_trans_freq ?? null), x.opp, pctT)],
    ["Pace", "His team's pace (1st = fastest) / the opponent's pace (30th = fastest, red); possessions a 48 minutes",
      them(pace, x.team, (v) => fmt(v)), them(pace, x.opp, (v) => fmt(v))],
  ];
  const rows = ROWS.map(([label, tip, a, b]) => {
    const rd = readOf(a.s, b.s);
    return LB(label, tip) + T(a.v, a.s, tip) + T(a.r, a.s, a.rt) + DT(b.v, b.s, tip) + DT(b.r, b.s, b.rt) + RT(rd, READ_TIP_A[rd.t], pairNum(label, a, b));
  });
  const head = corner(x) + HD(jersey(x.pid), "him", "", nameOf(x.pid)) + HD("Rank", "him") + HD(logo(x.opp, 15), "def", "", name) + HD("Rank", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: [["him", 2, 2], ["def", 4, 2], ["rd", 6, 1]], cls: "rs-five rs-wide", fill: true });
}
const READ_TIP_A = { Over: "The Over: one side points to more assists for him and the other doesn't point against it", Under: "The Under: one side points to fewer assists for him and the other doesn't point against it", Even: "The two sides don't line up one way", "--": "Not enough data on one side yet" };

// Assist Zones: where the shots he sets up come from, beside where tonight's defense gives up
// assisted makes (research.py `az` / `daz`, ASSIST_ZONES order).
const ASSIST_ZONE_ROWS = [["Rim", "shots at the rim (0-4 ft)"], ["Paint", "short shots (5-9 ft)"], ["Mid-Range", "mid-range shots"], ["Corner 3", "corner threes"], ["Above-Break 3", "above-the-break threes"]];
const AST_ZONE_MIN = 10;
function assistZonesTab(x) {
  const pool = posPool(x.p.pos);
  const R = RS();
  const daz = R.daz || {}, TR = R.rbt || {};
  const tot = (a) => (a ? a.reduce((n, v) => n + v, 0) : 0);
  const of = (a, i) => (tot(a) ? a[i] / tot(a) : null);
  const az = rsOf(x.pid).az;
  const games = logOf(x.pid).length || 1;
  const rows = ASSIST_ZONE_ROWS.map(([label, what], i) => {
    const v = of(az, i);
    const vals = pool.map(([id]) => { const q = rsOf(id).az; return tot(q) >= AST_ZONE_MIN ? of(q, i) : null; });
    const rk = rankIn(v, vals), s = spread(v, vals);
    const sorted = Object.keys(daz).filter((t) => of(daz[t], i) !== null).sort((a, b) => of(daz[b], i) - of(daz[a], i));
    const dr = sorted.indexOf(x.opp) + 1;
    const ds = dr ? rankSigned(dr, sorted.length) : null;
    const dv = of(daz[x.opp], i);
    const dg = (TR[x.opp] || [])[0] || 0;
    const mg = az ? az[i] / games : null, dmg = daz[x.opp] && dg ? daz[x.opp][i] / dg : null;
    const rd = readOf(s, ds);
    return LB(label, `Assisted ${what}`)
      + T(pctT(v), s, `Share of his assists that set up ${what}${az ? ` (${az[i]} of ${tot(az)})` : ""}`)
      + T(rankTxt(rk), s, rk ? `${ordinal(rk.r)} of ${rk.n} ${x.p.pos}s (${AST_ZONE_MIN}+ assists)` : "")
      + T(mg === null ? "--" : fmt(mg), mg === null ? null : s, mg === null ? "" : `${fmt(mg)} assists a game on ${what}`)
      + DT(pctT(dv), ds, `Share of the assisted makes against ${team(x.opp).name} that are ${what}`)
      + DT(dr ? ordinal(dRank(dr, sorted.length)) : "--", ds, dr ? dWords(dr, sorted.length) : "")
      + DT(dmg === null ? "--" : fmt(dmg), dmg === null ? null : ds, dmg === null ? "" : `${team(x.opp).name} give up ${fmt(dmg)} assisted ${what} a game`)
      + RT(rd, READ_TIP_A[rd.t], { label, him: numOf(v, pctT), hu: "%", hr: rk ? rk.r : null, def: numOf(dv, pctT), du: "%", dr: dr ? dRank(dr, sorted.length) : null });
  });
  const head = corner(x) + HD("Share", "him") + HD("Rank", "him") + HD("AST / G", "him") + HD("Allowed", "def", "", `Where ${team(x.opp).name} give up assisted makes`) + HD("Rank", "def") + HD("Per G", "def") + HD("Read", "rd");
  return gridOf(head, rows, { bands: BANDS_3_3_1, fill: true });
}

// Rotation (Assists): his assists a game in each quarter, colored by his share of his assists.
function qHeadA(r, games) {
  const qa = (r.qa || [0, 0, 0, 0]).map((v) => v / games);
  const tot = qa.reduce((a, b) => a + b, 0);
  return ["1st", "2nd", "3rd", "4th"].map((q, i) => {
    const s = tot ? (qa[i] / tot - 0.25) / 0.08 : null;
    return `<div class="rs-t rs-h rs-qt"${stepStyle(s) ? ` style="${stepStyle(s)}"` : ""}${tipAttr(`${fmt(qa[i])} assists a game in the ${q} quarter (${tot ? Math.round((qa[i] / tot) * 100) : 0}% of his assists)`)}>${q} Qtr<b>${fmt(qa[i])} AST</b></div>`;
  }).join("");
}

// Teammates (Assists): his assists a 36 and his assist rate with each teammate on the floor and
// off it, the change in assists a 36, and To Him: how many of his assists went to that teammate
// (his main target out = fewer finishers). research.py `wa`, `to`.
function teammatesAstTab(x) {
  const p = playerOf(x.pid) || {};
  const r = rsOf(x.pid);
  const wa = r.wa || {}, to = r.to || {};
  const mine = (r.ap || [0, 0])[1];
  const mates = Object.entries(p.with || {}).filter(([id]) => (playerOf(id) || {}).team === x.team && wa[id]).sort((a, b) => b[1][0] - a[1][0]).slice(0, RS_ROWS);
  const [id0, w0] = mates[0] || [];
  const u = id0 ? wa[id0] : null;
  const usualA = u ? per36(u[0] + u[2], w0[0] + w0[3]) : null;
  const usualR = u && u[1] + u[3] ? (u[0] + u[2]) / (u[1] + u[3]) : null;
  const vs = (v, base, k) => (v === null || base === null ? null : (v - base) / k);
  const rows = mates.map(([id, w]) => {
    const [mOn, , , mOff] = w;
    const [aOn, cOn, aOff, cOff] = wa[id];
    const together = mOn / (mOn + mOff);
    const on = per36(aOn, mOn), off = mOff >= 20 ? per36(aOff, mOff) : null;
    const rOn = cOn ? aOn / cOn : null, rOff = mOff >= 20 && cOff ? aOff / cOff : null;
    const diff = off === null ? null : off - on;
    const st = statusOf(x.team, id);
    const name = nameOf(id);
    return `<div class="rs-t rs-l${isOut(st) ? " rs-out" : ""}">${face(id)}${playerClick(id, shortName(name))}${statusPill(st)}</div>`
      + T(pctT(together), together * 2 - 1, `${Math.round(mOn)} of his ${Math.round(mOn + mOff)} minutes came with ${name} on the floor`)
      + T(fmt(on), vs(on, usualA, 2), `His assists a 36 with ${name} on the floor: ${aOn} in ${Math.round(mOn)} min (his usual ${fmt(usualA)})`)
      + T(fmt(off), vs(off, usualA, 2), `His assists a 36 with ${name} off the floor: ${aOff} in ${Math.round(mOff)} min (his usual ${fmt(usualA)})`)
      + T(pctT(rOn), vs(rOn, usualR, 0.06), `His share of teammates' makes he assisted with ${name} on the floor: ${aOn} of ${cOn} (his usual ${pctT(usualR)})`)
      + T(pctT(rOff), vs(rOff, usualR, 0.06), `His share of teammates' makes he assisted with ${name} off the floor: ${aOff} of ${cOff} (his usual ${pctT(usualR)})`)
      + T(diff === null ? "--" : sgn(diff), diff === null ? null : diff / 2, `Assists a 36 without ${name} minus with: green = he assists more when ${name} sits`)
      + T(to[id] ? String(to[id]) : "--", to[id] && mine ? (to[id] / mine) * 6 - 1 : null, `His assists to ${name}${mine ? `: ${to[id] || 0} of his ${mine}` : ""}`);
  });
  const head = corner(x) + HD("Together", "plain", "", "Share of his minutes with that teammate on the floor") + HD("AST With", "him") + HD("AST W/O", "him") + HD("Rate With", "him", "", "His share of teammates' makes he assisted") + HD("Rate W/O", "him") + HD("Change", "him", "", "Assists a 36 without minus with") + HD("To Him", "plain", "", "His assists to that teammate");
  return gridOf(head, rows, { cls: "rs-wide" });
}

// Type Matchup (Points and Threes): his type against tonight's defense for both shooting stats, then the
// latest games by players of his type against that defense (Players Like Him), on the research grid.
function typeTab(x) {
  const p = tmType(x.pid);
  if (!p) return gridOf(HD("", "plain") + HD("Type Matchup", "plain", "rs-s7"), [LB("") + T(`Fewer than ${(DATA.shot_types || {}).min_shots || 50} shots this season: no Player Type yet`, null, "", "rs-s7")]);
  const L = nbaTypeBadge(x.pid);
  const stat = (market, label) => {
    const m = typeMatch({ ...x, mk: market });
    const self = (p.avg || [])[TM_SELF[market]];
    const own = T(self ?? "--", null, `His ${label.toLowerCase()} a game this season`);
    if (!m || !m.c) return LB(label) + own + T("No games yet by his type against this defense", null, "", "rs-s4");
    const s = m.c.n >= TM_MIN ? clamp1(m.c.avg / TM_SCALE[market]) : null;
    const tip = `Type ${p.type} against ${team(x.opp).name}: ${sgn(m.c.avg)} over their own averages in ${m.c.n} games`;
    return LB(label) + own + DT(sgn(m.c.avg), s, tip)
      + DT(`${m.c.over}/${m.c.n}`, m.c.n >= TM_MIN ? clamp1((m.c.hit - 0.5) * 2) : null, `They beat their own average in ${m.c.over} of ${m.c.n} games`)
      + T(m.c.n, null, "Games by his type against this defense")
      + DT(m.rank ? ordinal(m.rank) : "--", s, m.rank ? `${ordinal(m.rank)} of ${m.n} defenses (30th = gives up the most to ${p.type})` : `Under ${TM_MIN} games: not ranked`);
  };
  const key = `<div class="rs-t rs-corner"><span class="rs-key rs-him">${jersey(x.pid)}</span><span class="rs-key rs-def">${logo(x.opp, 15)}vs ${L}</span></div>`;
  const head = key + HD("His Avg", "him") + HD("+/- Avg", "def", "", "How far over / under their own averages players of his type ran against this defense") + HD("Beat Avg", "def") + HD("Games", "def") + HD("Rank", "def");
  const m = typeMatch({ ...x, mk: "points" });
  const st = DATA.shot_types;
  const f = Object.fromEntries(st.log_fields.map((k, i) => [k, i]));
  const recent = m && m.c ? [...m.c.rows].sort((a, b) => (a[f.date] < b[f.date] ? 1 : -1)).slice(0, 3) : [];
  const like = recent.map((r) => {
    const q = st.players[r[f.player]] || {};
    return LB(shortName(q.name), `${q.name}, ${gameDate(r[f.date])}`) + T(gameDate(r[f.date]), null) + T(r[f.pts], null)
      + DT(sgn(r[f.pts_diff]), clamp1(r[f.pts_diff] / 10)) + T(r[f.m3], null) + DT(sgn(r[f.m3_diff]), clamp1(r[f.m3_diff] / 3));
  });
  // ONE grid (the box's six rows): Points and Threes, then a sub-header and the latest games by players like him
  const sub = LB(`Like Him ${logo(x.opp, 15)}`, `The latest games by type ${p.type} players against ${team(x.opp).name}`) + HD("Date", "plain") + HD("PTS", "def") + HD("+/- Avg", "def") + HD("3PM", "def") + HD("+/- Avg", "def");
  const rows = [stat("points", "Points"), stat("threes", "Threes"), sub, ...(like.length ? like : [LB("") + T("No games yet by his type against this defense", null, "", "rs-s5")])];
  return gridOf(head, rows, { bands: [["him", 2, 1], ["def", 3, 4]], cls: "rs-five" });
}

// Shot Fit (the owner, 2026-11-11): one level under the letters. His shot mix (Player Types) beside how
// tonight's defense does against each kind of shot (every shot it faced, so the samples are big early):
// his share, the FG% it allows on that kind, the league's, the difference and its rank of 30 (30th = allows
// the best shooting, red). The last row weighs the defense by his mix: points per 10 of his shots over
// the league's. Under SF_MIN shots of a kind against that defense = faded, unranked.
const SF_KINDS = [["catch", "Catch & Shoot"], ["pullup", "Pull-Up"], ["fade", "Fade"], ["float", "Floater"], ["post", "Post / Hook"], ["drive", "Drive"], ["cut", "Cut"], ["lob", "Lob / Putback"]];
const SF_MIN = 40;
function shotFitTab(x) {
  const st = (DATA && DATA.shot_types) || {};
  const p = tmType(x.pid);
  const D = (st.defense || {}).kinds || {};
  const LG = (st.defense || {}).league_kinds || {};
  if (!p || !D[x.opp]) return gridOf(HD("", "plain") + HD("Shot Fit", "plain", "rs-s7"), [LB("") + T(!p ? "No Player Type yet (fewer than 50 shots): no shot mix" : "No shots against this defense yet", null, "", "rs-s7")]);
  const mix = Object.fromEntries(st.fields.map((k, i) => [k, p.mix[i]]));
  const pct = (a) => (a && a[0] ? a[1] / a[0] : null);
  const pps = (a) => (a && a[0] ? a[2] / a[0] : null);
  const ranked = (k) => Object.values(D).map((t) => t[k]).filter((a) => a && a[0] >= SF_MIN);
  let fit = 0;
  const parts = [];
  const rows = SF_KINDS.map(([k, label]) => ({ k, label, share: mix[k] || 0 })).sort((a, b) => b.share - a.share).slice(0, 5).map(({ k, label, share }) => {
    const a = D[x.opp][k], lg = LG[k];
    const fg = pct(a), lfg = pct(lg);
    const thin = !a || a[0] < SF_MIN;
    const diff = fg === null || lfg === null ? null : fg - lfg;
    const s = thin || diff === null ? null : clamp1(diff / 0.08);
    const rk = thin ? null : 1 + ranked(k).filter((b) => pct(b) < fg).length;
    const n = ranked(k).length;
    if (!thin && pps(a) !== null && pps(lg) !== null) { fit += (share / 100) * (pps(a) - pps(lg)) * 10; parts.push(`${label} ${Math.round(share)}%`); }
    const tip = `${team(x.opp).name} allow ${fg === null ? "--" : pctT(fg)} on ${label.toLowerCase()} shots (league ${pctT(lfg)}), ${a ? a[0] : 0} shots${rk ? `, ${ordinal(rk)} of ${n} (30th = allows the best shooting)` : `; under ${SF_MIN} shots, not ranked`}`;
    return LB(label) + T(`${Math.round(share)}%`, null, `${Math.round(share)}% of his shots are ${label.toLowerCase()}`) + DT(fg === null ? "--" : pctT(fg), s, tip) + T(pctT(lfg), null, "The league's FG% on these shots")
      + DT(diff === null ? "--" : `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)}`, s, tip) + DT(rk ? ordinal(rk) : "--", s, tip);
  });
  const fitRow = LB("Fit", `His mix against ${team(x.opp).name}: ${parts.join(", ")}`) + T(`${fit > 0 ? "+" : ""}${fit.toFixed(1)}`, -clamp1(fit / 1.5), `Points per 10 of his shots over the league's, weighing ${x.opp}'s numbers by his shot mix (${parts.join(", ")})`, "rs-s5");
  const head = `<div class="rs-t rs-corner"><span class="rs-key rs-him">${jersey(x.pid)}</span><span class="rs-key rs-def">${logo(x.opp, 15)}Allows</span></div>` + HD("His Share", "him") + HD("FG% Allowed", "def") + HD("League", "plain") + HD("+/-", "def") + HD("Rank", "def");
  return gridOf(head, [...rows, fitRow], { bands: [["him", 2, 1], ["def", 3, 4]], cls: "rs-five" });
}

const RS_TAB = { "Shot Fit": shotFitTab, "Type Matchup": typeTab, Form: formTab, Scoring: scoringTab, Matchup: matchupTab, "Game Script": scriptTab, "Vs The Line": lineTab, Rotation: rotationTab, Teammates: teammatesTab, // Teammates: setMarket
  Shooting: shootingTab, "Shot Map": mapTab, Ladder: ladderTab, Rebounding: reboundingTab, "Miss Zones": missZonesTab, Playmaking: playmakingTab, "Assist Zones": assistZonesTab };
let RS_TAB_TIP = {};
const BASE_TIPS = {
  "Shot Fit": "His shot mix (how he shoots) beside how tonight's defense does against each kind of shot: his share, the FG% it allows on that kind, the league's, the difference and its rank of 30 (30th = allows the best shooting, red). Fit weighs the defense by his mix: points per 10 of his shots over the league's.",
  "Type Matchup": "Players of his type (his colored letter, Player Types: how he shoots) against tonight's defense: his own average, how far over / under THEIR OWN averages they ran, how many of those games they beat it, the games, and the defense's rank (30th = gives up the most to his type, red). Then the latest of those games. Beside his position's numbers, never instead of them.",
  Form: "His season, last 10 and last 5 beside what tonight's defense allows his position (season, last 10, last 5), and the read. His season is colored against his position; the defense's by its rank of 30 (30th = allows the most, red).",
  Scoring: "Where his points come from (share, rank among his position, points a game) beside what tonight's defense allows his position, and the read.",
  Matchup: "His side and the defense's side of the same thing. Over / Under only when one side clearly points one way and the other doesn't point the other way.",
  "Game Script": `His games like tonight: within ${SCRIPT_RANGE} points of tonight's spread and total either way, within ${PACE_RANGE} possessions of tonight's pace, his home or road games and his last 10, each colored against his season. Fewer than ${SMALL} games is too few to lean on (faded, uncolored).`,
  "Vs The Line": `His last ${LINE_DAYS} days against tonight's line (dashed): a bar a game, OUT when his team played without him, OFF when it didn't play. The dots are the line he had that night (green = cleared).`,
  Rotation: "When he's on the floor at each minute (green = most of his games), with his points a game in each quarter in its header.",
  Teammates: "His shots and points a 36 with each teammate on the floor and off it (green / red = above / below his usual), time together, and that teammate's assists on his makes.",
};
const ASTS_TIPS = {
    Form: "His assists, then his assists to each other position (season, last 10, last 5), beside what tonight's defense gives up (assists to his position; assisted baskets to each other position), and the read. His season is colored against his position, his last 10 / 5 against his season; the defense's by its rank of 30 (30th = gives up the most, red).",
    Playmaking: "Why his number is what it is: his teammates' made shots while he's on the floor (assist chances) and his share of them, beside the side of tonight's defense that drives each (the shooting it allows, how much of it is assisted, how often teams run on it), pace, and the read. His side green = good for him; the defense is colored as a defense (red = it gives up the most).",
    "Assist Zones": "Where the shots he sets up come from (rim, paint, mid-range, corner and above-the-break threes), beside where tonight's defense gives up assisted makes, and the read.",
    "Game Script": `His games like tonight: within ${SCRIPT_RANGE} points of tonight's spread and total either way, within ${PACE_RANGE} possessions of tonight's pace, his home or road games and his last 10, with his minutes and assist chances, each colored against his season. Fewer than ${SMALL} games is too few to lean on (faded, uncolored).`,
    "Vs The Line": `His last ${LINE_DAYS} days against tonight's line (dashed): a bar a game; the hover has that night's assist chances (teammates' makes with him on the floor) and his rate, against his season. OUT when his team played without him, OFF when it didn't play. The dots are the line he had that night (green = cleared).`,
    Ladder: `How often he got each number of assists, the columns around tonight's line (its Over column has the green header). Fewer than ${SMALL} games is faded.`,
    Rotation: "When he's on the floor at each minute (green = most of his games), with his assists a game in each quarter in its header.",
    Teammates: "His assists a 36 and his assist rate with each teammate on the floor and off it (green / red = above / below his usual), time together, and how many of his assists go to that teammate.",
};
const REBS_TIPS = {
    Form: "His rebounds, defensive and offensive rebounds and minutes: season, last 10 and last 5, beside what tonight's defense allows his position (season, last 10, last 5), and the read. His season is colored against his position; the defense's by its rank of 30 (30th = allows the most, red).",
    Rebounding: "Why his number is what it is: the rebounds there to get while he's on the floor (chances) and his share of them, at both ends, beside the side of tonight's opponent that drives each one, and the read. His side green = good for him; the opponent is colored from its side (red = it leaves him the most).",
    "Miss Zones": "Where the misses he grabs on defense come from (rim, paint, mid-range, corner and above-the-break threes, free throws), beside where tonight's opponent misses from, and the read.",
    "Game Script": `His games like tonight: within ${SCRIPT_RANGE} points of tonight's spread and total either way, within ${PACE_RANGE} possessions of tonight's pace, his home or road games and his last 10, with his minutes and rebound chances, each colored against his season. Fewer than ${SMALL} games is too few to lean on (faded, uncolored).`,
    "Vs The Line": `His last ${LINE_DAYS} days against tonight's line (dashed): a bar a game (the hover splits defensive and offensive), OUT when his team played without him, OFF when it didn't play. The dots are the line he had that night (green = cleared).`,
    Ladder: `How often he got each number of rebounds, the columns around tonight's line (its Over column has the green header). Fewer than ${SMALL} games is faded.`,
    Rotation: "When he's on the floor at each minute (green = most of his games), with his rebounds and offensive rebounds a game in each quarter in its header.",
    Teammates: "His rebounds a 36 and his share of the rebounds there to get, with each teammate on the floor and off it (green / red = above / below his usual), time together, and that teammate's own rebounds a 36.",
};
const THREES_TIPS = {
    Form: "His threes made, tried, make rate and the share of his shots that are threes: season, last 10 and last 5, beside what tonight's defense allows his position (season, last 10, last 5), and the read. His season is colored against his position; the defense's by its rank of 30 (30th = allows the most, red).",
    Shooting: "How he gets his threes (catch and shoot, pull-up, step-back, transition, second chance): his share, its rank among his position and made a game, beside the same for his position against tonight's defense, and the read.",
    "Shot Map": "Where he shoots his threes, and where his position shoots them against tonight's defense. Bigger = more threes from that spot; his map green = he makes more than the league there, the defense's red = his position makes more there against them (bad defense). Early in the season the defense's map is thin: spots with few threes lean toward the league for the color.",
    "Vs The Line": `His last ${LINE_DAYS} days against tonight's line (dashed): a bar a game with his makes / tries, OUT when his team played without him, OFF when it didn't play. The dots are the line he had that night (green = cleared).`,
    Ladder: `How often he made each number of threes, the columns around tonight's line (its Over column has the green header; None = nights with no threes). Fewer than ${SMALL} games is faded.`,
    Rotation: "When he's on the floor at each minute (green = most of his games), with his threes made and tried a game in each quarter in its header.",
    Teammates: "His threes tried and made a 36 with each teammate on the floor and off it (green / red = above / below his usual), time together, and that teammate's assists on his threes.",
};
// Switch everything market-specific to market m: the stat pages call it once; All Props for each row.
function setMarket(m) {
  MK = RS_MARKETS[m] || RS_MARKETS.points;
  THREES = MK.market === "threes";
  REBS = MK.market === "rebounds";
  ASTS = MK.market === "assists";
  RS_TABS = tabsFor();
  RS_TAB.Teammates = THREES ? teammates3Tab : REBS ? teammatesRebTab : ASTS ? teammatesAstTab : teammatesTab;
  RS_TAB_TIP = { ...BASE_TIPS, ...(ASTS ? ASTS_TIPS : REBS ? REBS_TIPS : THREES ? THREES_TIPS : {}) };
  if (!ALL_PROPS || !COLS.length) COLS = colsFor();
}
setMarket(MK.market);
// The tab picked stays picked (RSV); a market without it shows its first tab. setMarket never changes
// RSV: All Props switches markets for every row on every redraw, and that undid a click on a Threes-only
// tab (the owner, 2026-11-04: Braun's Shot Map wouldn't open).
const tabOf = (side) => (RS_TABS[side].includes(RSV[side]) ? RSV[side] : RS_TABS[side][0]);
const sandbox = (x, side) => `<div class="rs-sb" data-side="${side}"><div class="rs-tabs">${RS_TABS[side].map((t) => `<button type="button" class="${t === tabOf(side) ? "on" : ""}" data-rs-tab="${side}:${t}" title="${RS_TAB_TIP[t]}">${t}</button>`).join("")}</div><div class="rs-sbody">${RS_TAB[tabOf(side)](x)}</div></div>`;
// Redraw one box of the open panel (a tab click, or the shot charts arriving for the Shot Map).
function refreshBox(side) {
  const box = document.querySelector(`#rs-list .rs-sb[data-side="${side}"]`);
  const x = OPEN && rowsToday(days()[dayIndex]).find((r) => openKey(r) === OPEN);
  if (x) setMarket(x.mk);
  if (box && x) box.outerHTML = sandbox(x, side);
}
function panel(x) {
  if (!PROPS.research) return '<div class="rs-panel"><p class="rs-none">The research data comes with the next data build.</p></div>';
  return `<div class="rs-panel">${sandbox(x, "left")}${sandbox(x, "right")}</div>`;
}

function renderToolbar() {
  const menu = (key, label, options, tip) =>
    `<label class="sim-menu" title="${tip}"><span>${label}</span><select data-list="${key}">${options.map(([v, text]) => `<option value="${v}"${String(LIST[key]) === String(v) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  el("rs-toolbar").innerHTML = menu("pos", "Position", [["", "All"], ["PG", "PG"], ["SG", "SG"], ["SF", "SF"], ["PF", "PF"], ["C", "C"]], "Only players at this position")
    + `<span class="sim-seg">${[[false, "With A Line", "Only players the books have a line for"], [true, "Every Player", `Every rotation player (${ROTATION_MIN}+ minutes a game), with a line or not`]]
      .map(([v, label, tip]) => `<button type="button" class="view-toggle-btn${LIST.every === v ? " active" : ""}" data-list-every="${v}" title="${tip}">${label}</button>`).join("")}</span>`
    + (LIST.game ? `<button type="button" class="view-toggle-btn" data-list-game="" title="Show every game again">${(() => { const g = gamesOn(days()[dayIndex]).find((x) => String(x.game_id) === String(LIST.game)); return g ? `${g.away} @ ${g.home}` : ""; })()} &times;</button>` : "");
}
function renderList() {
  const date = days()[dayIndex];
  PAST = isPast(date);
  const C = shownCols();
  renderToolbar();
  const rows = date ? sortedRows(date) : [];
  const lined = rows.filter((x) => x.line !== null).length;
  const at = DATA.generated_at ? new Date(DATA.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const what = ALL_PROPS ? `line${lined === 1 ? "" : "s"} across Points, Threes, Assists and Rebounds` : `player${lined === 1 ? "" : "s"} with a ${MK.unit.toLowerCase()} line`;
  if (PAST) {
    const over = rows.filter((x) => x.line !== null && x.result !== null && x.result > x.line).length;
    const under = rows.filter((x) => x.line !== null && x.result !== null && x.result < x.line).length;
    el("rs-note").innerHTML = `${lined} ${what} that night: ${over} Over, ${under} Under &middot; each line is the middle of the books' at tip; the averages, hit rates and Opp Allows count only the games before that night`;
  } else el("rs-note").innerHTML = `${lined} ${what}${at ? ` &middot; lines and injury report as of ${at}` : ""} &middot; check the injury report before you bet: NBA lineups change late`;
  if (typeof rfRender === "function") rfRender();
  if (!rows.length && typeof RF !== "undefined" && (RF.on.length || RF.stats.length)) {
    el("rs-list").innerHTML = '<p class="sim-noplay">No player matches these filters. <button type="button" class="view-toggle-btn" data-rf-clear-list>Clear Filters</button></p>';
    return;
  }
  if (!rows.length) {
    const noOdds = !Object.keys(DATA.book_odds || {}).length;
    const why = PAST ? (LIST.every ? "No player matches these filters." : "No lines were saved for this night.")
      : noOdds || !LIST.every ? "The books haven't posted these lines yet." : "No player matches these filters.";
    el("rs-list").innerHTML = `<p class="sim-noplay">${why}${!LIST.every ? ' <button type="button" class="view-toggle-btn" data-list-every="true">Show Every Player</button>' : ""}</p>`;
    return;
  }
  const body = rows.map((x, i) => {
    const head = x.live && (i === 0 || !rows[i - 1].live) ? `<tr class="sim-group"><td colspan="${C.length}">Started: the lines locked at tip.</td></tr>` : "";
    return head + row(x) + (PANEL && !x.past && OPEN === openKey(x) ? `<tr class="rs-panel-row"><td colspan="${C.length}">${panel(x)}</td></tr>` : ""); // row() set its market
  }).join("");
  el("rs-list").innerHTML = `<div class="nba-box sim-listbox"><div class="sim-scroll"><table class="data-table sim-list rs-list">${listHead()}<tbody>${body}</tbody></table></div></div>`;
  fitTags();
}
// Tags fill at most two lines, the same box on every row: the ones that don't fit fold into a
// "+N" pill naming them on hover (the site's table rule).
// Every box is reset, then every box and tag is measured in ONE pass, and the fold is worked out from
// those widths (two lines of tags, sim.css .sim-rtags) before anything is hidden. Measuring box by box
// re-laid out the whole table each time: 4 s on All Props' 1,000+ rows.
const TAG_GAP = 4; // .sim-rtags column gap
const TAG_LINES = 2;
const MORE_W = 32; // room for the "+N" pill
function fitTags() {
  const boxes = [...document.querySelectorAll("#rs-list .sim-rtags")];
  for (const box of boxes) {
    box.querySelectorAll(".sim-rtag.more").forEach((m) => m.remove());
    for (const t of box.children) t.hidden = false;
  }
  const over = boxes.filter((box) => box.scrollHeight > box.clientHeight + 1)
    .map((box) => ({ box, w: box.clientWidth, widths: [...box.children].map((t) => t.offsetWidth) }));
  for (const { box, w, widths } of over) {
    // the first k tags and the "+N" pill fit in TAG_LINES lines of width w
    const fits = (k) => {
      let line = 1, used = 0;
      for (const tw of [...widths.slice(0, k), MORE_W]) {
        if (!used || used + TAG_GAP + tw <= w) used = used ? used + TAG_GAP + tw : tw;
        else if (++line > TAG_LINES) return false;
        else used = tw;
      }
      return true;
    };
    let k = widths.length - 1;
    while (k > 0 && !fits(k)) k -= 1;
    const tags = [...box.children];
    const rest = tags.slice(k);
    rest.forEach((t) => (t.hidden = true));
    const more = document.createElement("span");
    more.className = "sim-rtag more";
    more.textContent = `+${rest.length}`;
    more.title = rest.map((t) => t.title || t.textContent.trim()).join("\n");
    box.appendChild(more);
  }
}
window.addEventListener("resize", () => {
  clearTimeout(fitTags.wait);
  fitTags.wait = setTimeout(fitTags, 120);
});

function renderGamePicker() {
  const games = gamesOn(days()[dayIndex]);
  if (!games.some((g) => String(g.game_id) === String(LIST.game))) LIST.game = "";
  gameId = LIST.game || (games[0] || {}).game_id || "";
  const final = (g) => `Final${g.away_score !== null && g.away_score !== undefined && g.home_score !== null && g.home_score !== undefined ? ` ${g.away_score}-${g.home_score}` : ""}`;
  el("matchup-row").innerHTML = games.map((g) => `<button type="button" class="matchup-card${String(g.game_id) === String(LIST.game) ? " selected" : ""}" data-game="${g.game_id}">
      <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
      <span class="matchup-date">${isPast(g.date) ? final(g) : gmgGameTime(g, false)}</span></button>`).join("");
}
// A date box beside the day arrows: jumps to that night, or the closest one before it with games
// (the same box as the NHL prop pages).
function dayPicker(all) {
  const picker = el("day-label").parentElement;
  if (!picker || !all.length) return;
  let box = picker.querySelector(".sim-day-pick");
  if (!box) {
    box = Object.assign(document.createElement("input"), { type: "date", className: "sim-day-pick", title: "Pick a day" });
    box.setAttribute("aria-label", "Pick a day");
    box.style.cssText = "margin-left:8px;font:inherit;font-size:0.8rem;padding:2px 6px;border-radius:6px;border:1px solid var(--border-strong);background:var(--table-head);color:var(--text);color-scheme:light dark;cursor:pointer";
    box.addEventListener("change", () => {
      if (!box.value) return;
      dayIndex = Math.max(0, days().filter((d) => d <= box.value).length - 1);
      LIST.game = "";
      OPEN = "";
      render();
    });
    picker.appendChild(box);
  }
  Object.assign(box, { min: all[0], max: all[all.length - 1], value: all[dayIndex] || "" });
}
function render() {
  const all = days();
  const date = all[dayIndex];
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "No games";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  dayPicker(all);
  renderGamePicker();
  renderList();
}

document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-list]");
  if (sel) {
    LIST[sel.dataset.list] = sel.value;
    return renderList();
  }
});
document.addEventListener("click", (e) => {
  const card = e.target.closest("#matchup-row [data-game]");
  if (card) {
    LIST.game = LIST.game === card.dataset.game ? "" : card.dataset.game;
    renderGamePicker();
    return renderList();
  }
  if (e.target.closest("[data-list-game]")) {
    LIST.game = "";
    renderGamePicker();
    return renderList();
  }
  const every = e.target.closest("[data-list-every]");
  if (every) {
    LIST.every = every.dataset.listEvery === "true";
    return renderList();
  }
  const tab = e.target.closest("#rs-list [data-rs-tab]");
  if (tab) {
    const [side, name] = tab.dataset.rsTab.split(":");
    RSV[side] = name;
    refreshBox(side);
    return;
  }
  const open = PANEL && e.target.closest("#rs-list tr.rs-click");
  if (open && !e.target.closest("a, button, input, select, label, .rs-price, .player-click, .sim-rtag")) {
    OPEN = OPEN === open.dataset.open ? "" : open.dataset.open;
    return renderList();
  }
  const sort = e.target.closest("#rs-list [data-sort]");
  if (sort) {
    if (LIST.sort === sort.dataset.sort) LIST.dir = -LIST.dir;
    else {
      LIST.sort = sort.dataset.sort;
      LIST.dir = -1;
    }
    return renderList();
  }
  if (e.target.closest("#day-prev") && dayIndex > 0) {
    dayIndex -= 1;
    LIST.game = "";
    OPEN = "";
    return render();
  }
  if (e.target.closest("#day-next") && dayIndex < days().length - 1) {
    dayIndex += 1;
    LIST.game = "";
    OPEN = "";
    return render();
  }
  if (e.target.closest("#theme-toggle")) {
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

Promise.all([fetch("data.json").then((r) => r.json()), fetch("props.json").then((r) => r.json())])
  .then(([data, props]) => {
    DATA = data;
    PROPS = props;
    if (!PROPS || !Object.keys(PROPS.seasons || {}).length) {
      el("rs-app").hidden = true;
      el("empty-state").innerHTML = "<p>The player data isn't available right now. It comes with every data build; check back shortly.</p>";
      return;
    }
    el("empty-state").hidden = true;
    el("rs-app").hidden = false;
    dayIndex = startDay();
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
