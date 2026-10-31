// ---- GMG NHL Suite: Promo Tools, King of the Hat Trick ----
// DraftKings' promo: an anytime goal scorer bet on a player who scores a hat
// trick (3+ goals in one game) splits the pool; no hat trick rolls it over.
// No prices here (the owner, 2026-10-31: "this isnt about finding fair value
// ... this is about finding opportunities in matchup and usage that could
// lead to a man scoring 3"). The build (hattrick_file in build_nhl.py) sends
// this season's real counts: each player's 2- and 3-goal games and usage,
// what each defense and goalie has given up to one player, and the Goals
// model's own expected goals tonight (usage x matchup, no price in it). This
// page only picks the games, colors and sorts. Every goal counts, empty-net
// ones too (the promo counts them); a goalie is charged only for goals on him.
// Loaded after promo-tools.js, whose shareLogo, embeddedFontCSS, lastName
// and longDate it shares.

let HAT = null;
const hatView = { day: 0, games: null, team: null, all: false, sort: "mean", dir: -1 };
// Teams Tonight sorts on its own: every column, click again to flip (the owner, 2026-10-31).
const hatTeamView = { sort: "xg", dir: -1 };
const hatTs = (team) => ((typeof DATA !== "undefined" && DATA && DATA.team_stats) || {})[team] || {};
const hatRate = (t, key) => (t && t.gp ? t[key] / t.gp : null);
const HAT_TEAM_SORT = {
  team: (t) => t.team,
  xg: (t) => t.xg,
  total: (t) => t.total,
  gf: (t) => hatRate(hatTeam(t.team), "gf"),
  five: (t) => (hatTeam(t.team) || {}).five_for,
  two: (t) => (hatTeam(t.team) || {}).two_for,
  ht: (t) => (hatTeam(t.team) || {}).three_for,
  pp: (t) => hatTs(t.team).off_pp_pct,
  ga: (t) => hatRate(hatTeam(t.opp), "ga"),
  fivea: (t) => (hatTeam(t.opp) || {}).five_against,
  twoa: (t) => (hatTeam(t.opp) || {}).two_against,
  hta: (t) => (hatTeam(t.opp) || {}).three_against,
  pk: (t) => hatTs(t.opp).def_pp_pct,
  goalie: (t) => (hatGoalie(t.goalie) || {}).name,
  sv: (t) => { const g = hatGoalie(t.goalie); return g && g.sa ? (g.sa - g.ga) / g.sa : null; },
  gtwo: (t) => (hatGoalie(t.goalie) || {}).two,
  ght: (t) => (hatGoalie(t.goalie) || {}).three,
};
const HAT_TEAM_UP = new Set(["team", "goalie", "sv"]); // first click: A to Z, the leakiest save % first
function hatTTh(key, label, title, num = true) {
  const on = hatTeamView.sort === key ? ` koe-sorted${hatTeamView.dir > 0 ? " koe-asc" : ""}` : "";
  return `<th class="${num ? "num " : ""}koe-sort${on}" data-hat-tsort="${key}"${title ? ` title="${title}"` : ""}>${label}</th>`;
}
const HAT_SHOWN = 25;
const HAT_SLOT = { F1: "L1", F2: "L2", F3: "L3", F4: "L4", D1: "D1", D2: "D2", D3: "D3" };

const hatDays = () => Object.keys((HAT || {}).days || {}).sort();
const hatDay = () => ((HAT || {}).days || {})[hatDays()[hatView.day]] || null;
const hatPlayer = (id) => ((HAT || {}).players || {})[id] || null;
const hatTeam = (t) => ((HAT || {}).teams || {})[t] || null;
const hatGoalie = (id) => ((HAT || {}).goalies || {})[id] || null;
const hatPer = (n, d, digits = 2) => (d ? fmt(n / d, digits) : "--");
const hatClock = (sec) => (has(sec) ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "--");
const hatDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });

// ---- the slate ----
function hatRows() {
  const day = hatDay();
  if (!day) return [];
  const games = new Map(day.games.map((g) => [g.game_id, g]));
  return day.players.filter((r) => hatView.games.has(r.game_id)).map((r) => ({ ...r, locked: (games.get(r.game_id) || {}).locked, final: (games.get(r.game_id) || {}).final }));
}
// The 2+ goal games behind a count, for a hover: "10/21 vs BOS: 3 G".
function hatBig(test, label) {
  const list = ((HAT || {}).big || []).filter(test).slice().reverse();
  return list.length ? list.map(label).join("\n") : "None this season";
}

// ---- colors ----
// A value's place in a pool on the eight colors (1st = green: more goals for the shooter).
// Zero of a rare thing (a hat trick) stays plain rather than red.
function hatStep(value, pool, text, tip, opts = {}) {
  if (!has(value)) return `<td class="num muted-label" title="${tip || ""}">--</td>`;
  if (opts.zeroPlain && !value) return `<td class="num muted-label" title="${tip || ""}">${text}</td>`;
  const valid = pool.filter(has);
  const higher = opts.lowIsGreen ? valid.filter((v) => v < value).length : valid.filter((v) => v > value).length;
  return `<td class="num nhl-rank-cell"${cellOnStep(rankStep(higher + 1, valid.length || 1))} title="${tip || ""}">${text}</td>`;
}
// League ranks for every team on one rate (1 = the most).
function hatLeagueRank(key, team, lowIsMost = false) {
  const teams = Object.entries((HAT || {}).teams || {}).filter(([, t]) => t.gp);
  const val = ([abbr, t]) => (typeof key === "function" ? key(abbr) : t[key] / t.gp);
  const mine = teams.find(([abbr]) => abbr === team);
  if (!mine) return null;
  const v = val(mine);
  return 1 + teams.filter((e) => (lowIsMost ? val(e) < v : val(e) > v)).length;
}
function hatLeague(team, key, text, tip, opts = {}) {
  const rank = hatLeagueRank(key, team, opts.lowIsMost);
  if (!rank) return `<td class="num muted-label">--</td>`;
  const n = Object.keys((HAT || {}).teams || {}).length || 32;
  if (opts.zeroPlain && opts.raw === 0) return `<td class="num muted-label" title="${tip}">${text}</td>`;
  return `<td class="num nhl-rank-cell"${cellOnStep(rankStep(rank, n))} title="${tip} (${rankWords(rank, n)} in the league)">${text}</td>`;
}
// Goalies with 3+ starts, ranked on one number (1 = the most goals given up).
function hatGoalieRank(id, val) {
  const pool = Object.entries((HAT || {}).goalies || {}).filter(([, g]) => g.starts >= 3);
  const mine = pool.find(([gid]) => gid === id);
  if (!mine) return null;
  return { rank: 1 + pool.filter(([, g]) => val(g) > val(mine[1])).length, of: pool.length };
}
function hatGoalieCell(id, val, text, tip, zeroPlain) {
  const r = hatGoalieRank(id, val);
  if (!r) return `<td class="num${has(text) ? "" : " muted-label"}" title="${tip}${has(text) ? " (under 3 starts: not ranked)" : ""}">${has(text) ? text : "--"}</td>`;
  if (zeroPlain && !val(hatGoalie(id))) return `<td class="num muted-label" title="${tip}">${text}</td>`;
  return `<td class="num nhl-rank-cell"${cellOnStep(rankStep(r.rank, r.of))} title="${tip} (${ordinal(r.rank)} most of ${r.of} goalies with 3+ starts)">${text}</td>`;
}
const hatSv = (g) => (g && g.sa ? (g.sa - g.ga) / g.sa : null);

// ---- drawing ----
function renderHatSlate() {
  const day = hatDay();
  const all = hatDays();
  el("hat-day-label").textContent = all[hatView.day] ? longDate(all[hatView.day]) : "";
  el("hat-day-prev").disabled = hatView.day <= 0;
  el("hat-day-next").disabled = hatView.day >= all.length - 1;
  el("hat-games").innerHTML = day
    ? day.games
        .map((g) => {
          const on = hatView.games.has(g.game_id);
          return `<button type="button" class="ice-game${on ? " ice-on" : ""}" data-hat-game="${g.game_id}" title="${on ? "Click to take this game out" : "Click to add this game"}"><span class="ice-check">${on ? "&#10003;" : "+"}</span>${shareLogo(g.away, 18)}<span class="at">@</span>${shareLogo(g.home, 18)}<span class="ice-gt">${g.final ? "Final" : g.locked ? "Live" : fmtTime(g, false)}</span></button>`;
        })
        .join("")
    : "";
  const L = (HAT || {}).league || {};
  const tile = (big, label, sub) => `<div class="ice-hist-tile hat-tile"><b>${big}</b><span>${label}</span><i>${sub}</i></div>`;
  el("hat-tiles").innerHTML = L.games
    ? [
        tile(L.hat_tricks, "Hat Tricks", `in ${L.games} games this season`),
        tile(L.hat_tricks ? `1 in ${Math.round(L.games / L.hat_tricks)}` : "--", "Games", "with a hat trick"),
        tile(`${L.hat_days}/${L.days}`, "Days With One", `${L.days - L.hat_days} days rolled over`),
        tile(L.two_plus, "2+ Goal Games", `1 in ${Math.round(L.skater_games / Math.max(1, L.two_plus))} skater games`),
      ].join("")
    : "";
}

function renderHatTeams(rows) {
  const box = el("hat-teams");
  const day = hatDay();
  const teams = [];
  for (const g of day ? day.games.filter((g) => hatView.games.has(g.game_id)) : []) {
    for (const [team, opp] of [[g.away, g.home], [g.home, g.away]]) {
      const mine = rows.filter((r) => r.team === team);
      const goalie = (mine.find((r) => r.goalie) || {}).goalie;
      teams.push({ team, opp, home: team === g.home, total: g.total, goalie, xg: mine.reduce((s, r) => s + (r.mean || 0), 0) });
    }
  }
  if (!teams.length) return (box.innerHTML = "");
  const get = HAT_TEAM_SORT[hatTeamView.sort] || HAT_TEAM_SORT.xg;
  const ok = (v) => has(v) && v !== "" && !Number.isNaN(v);
  teams.sort((a, b) => {
    const [va, vb] = [get(a), get(b)];
    if (!ok(va) || !ok(vb)) return ok(va) ? -1 : ok(vb) ? 1 : b.xg - a.xg;
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * hatTeamView.dir || b.xg - a.xg;
  });
  const ts = DATA.team_stats || {};
  const xgPool = teams.map((t) => t.xg);
  const body = teams
    .map((t) => {
      const o = hatTeam(t.team) || {};
      const d = hatTeam(t.opp) || {};
      const g = hatGoalie(t.goalie);
      const pp = (ts[t.team] || {}).off_pp_pct;
      const pk = (ts[t.opp] || {}).def_pp_pct;
      const bigFor = hatBig((b) => b.team === t.team, (b) => `${hatDate(b.date)} ${b.name} vs ${b.opp}: ${b.g} G`);
      const bigAgainst = hatBig((b) => b.opp === t.opp, (b) => `${hatDate(b.date)} ${b.name} (${b.team}): ${b.g} G`);
      const onGoalie = hatBig((b) => (b.vs[t.goalie] || 0) >= 2, (b) => `${hatDate(b.date)} ${b.name} (${b.team}): ${b.vs[t.goalie]} on him`);
      return `<tr class="ice-team-row${hatView.team === t.team ? " ice-sel" : ""}" data-hat-team="${t.team}" title="Click to see only ${t.team}'s players">
        <td class="koe-player"><span class="koe-who">${shareLogo(t.team, 22)}<span class="koe-name">${t.team}</span><span class="koe-meta">${t.home ? "vs" : "@"} ${shareLogo(t.opp, 18)}</span></span></td>
        ${hatStep(t.xg, xgPool, fmt(t.xg, 2), `${t.team}'s skaters' expected goals tonight added up (the Goals model: usage x matchup)`)}
        <td class="num" title="The game's total goals line">${has(t.total) ? fmt(t.total, 1) : "--"}</td>
        <td class="koe-gap"></td>
        ${hatLeague(t.team, "gf", hatPer(o.gf, o.gp), `${t.team} scores ${hatPer(o.gf, o.gp)} goals a game`)}
        ${hatLeague(t.team, "five_for", `${o.five_for || 0}`, `${t.team} has scored 5+ in ${o.five_for || 0} of ${o.gp} games`)}
        ${hatLeague(t.team, "two_for", `${o.two_for || 0}`, `${t.team} players' 2+ goal games:\n${bigFor}`)}
        ${hatLeague(t.team, "three_for", `${o.three_for || 0}`, `${t.team}'s hat tricks this season`, { zeroPlain: true, raw: o.three_for || 0 })}
        ${hatLeague(t.team, (abbr) => (ts[abbr] || {}).off_pp_pct || 0, has(pp) ? `${Math.round(pp * 100)}%` : "--", `${t.team}'s power play scores on ${has(pp) ? Math.round(pp * 100) : "--"}% of chances`)}
        <td class="koe-gap"></td>
        ${hatLeague(t.opp, "ga", hatPer(d.ga, d.gp), `${t.opp} allows ${hatPer(d.ga, d.gp)} goals a game`)}
        ${hatLeague(t.opp, "five_against", `${d.five_against || 0}`, `${t.opp} has allowed 5+ in ${d.five_against || 0} of ${d.gp} games`)}
        ${hatLeague(t.opp, "two_against", `${d.two_against || 0}`, `Players with 2+ goals against ${t.opp}:\n${bigAgainst}`)}
        ${hatLeague(t.opp, "three_against", `${d.three_against || 0}`, `Hat tricks scored against ${t.opp} this season`, { zeroPlain: true, raw: d.three_against || 0 })}
        ${hatLeague(t.opp, (abbr) => (ts[abbr] || {}).def_pp_pct || 0, has(pk) ? `${Math.round(pk * 100)}%` : "--", `${t.opp}'s penalty kill gives up a goal on ${has(pk) ? Math.round(pk * 100) : "--"}% of power plays`)}
        <td class="koe-gap"></td>
        <td class="hat-goalie" title="The goalie ${t.team} should face (the NHL's projected lineup, else ${t.opp}'s busiest starter; never confirmed)">${g ? `${playerClick(t.goalie, `<span>${lastName(g.name)}</span>`)}` : "--"}</td>
        ${hatGoalieCell(t.goalie, (x) => -(hatSv(x) || 1), g && g.sa ? (hatSv(g)).toFixed(3).replace(/^0/, "") : null, `${g ? g.name : ""}'s save % this season`)}
        ${hatGoalieCell(t.goalie, (x) => x.two / Math.max(1, x.starts), g ? `${g.two}` : null, `Shooters with 2+ goals on ${g ? g.name : "him"}:\n${onGoalie}`)}
        ${hatGoalieCell(t.goalie, (x) => x.three / Math.max(1, x.starts), g ? `${g.three}` : null, `Hat tricks scored on ${g ? g.name : "him"} (empty nets not his)`, true)}
      </tr>`;
    })
    .join("");
  box.innerHTML = `<table class="data-table koe-table ice-table hat-table hat-teams-table">
    <colgroup><col class="ice-c-team"><col class="hat-c-stat"><col class="hat-c-stat"><col class="koe-c-gap"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="koe-c-gap"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"><col class="koe-c-gap"><col class="hat-c-goalie"><col class="hat-c-stat"><col class="hat-c-stat"><col class="hat-c-stat"></colgroup>
    <thead><tr class="koe-group-row"><th></th><th colspan="2" class="koe-group koe-g-up"><span>Tonight</span></th><th class="koe-gap"></th><th colspan="5" class="koe-group koe-g-td"><span>Offense</span></th><th class="koe-gap"></th><th colspan="5" class="koe-group koe-g-def"><span>Opponent Defense</span></th><th class="koe-gap"></th><th colspan="4" class="koe-group koe-g-big"><span>Opponent Goalie</span></th></tr>
    <tr class="koe-label-row">${hatTTh("team", "Team", "", false)}${hatTTh("xg", "xG", "Its skaters' expected goals tonight, added up")}${hatTTh("total", "Total", "The game's total goals line")}<th class="koe-gap"></th>
      ${hatTTh("gf", "GF/GP", "Goals a game")}${hatTTh("five", "5+ G", "Games it scored 5 or more")}${hatTTh("two", "2G", "Its players' games with 2+ goals")}${hatTTh("ht", "HT", "Its hat tricks")}${hatTTh("pp", "PP%", "Power play %")}<th class="koe-gap"></th>
      ${hatTTh("ga", "GA/GP", "Goals allowed a game")}${hatTTh("fivea", "5+ GA", "Games it allowed 5 or more")}${hatTTh("twoa", "2G", "Games it let one player score 2+")}${hatTTh("hta", "HT", "Hat tricks it allowed")}${hatTTh("pk", "PK GA%", "Power-play goals allowed per chance (100% minus its penalty kill)")}<th class="koe-gap"></th>
      ${hatTTh("goalie", "Goalie", "", false)}${hatTTh("sv", "SV%", "Save % (first click: lowest first)")}${hatTTh("gtwo", "2G", "Games a shooter scored 2+ on him")}${hatTTh("ght", "HT", "Hat tricks scored on him")}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

// ---- the Players table: every column sorts (click again to flip) ----
const HAT_SORT = {
  name: (r) => r.name || "",
  slot: (r) => (Object.keys(HAT_SLOT).includes(r.slot || r.usual_slot) ? Object.keys(HAT_SLOT).indexOf(r.slot || r.usual_slot) : null),
  mean: (r) => r.mean,
  gp: (r) => (hatPlayer(r.id) || {}).gp,
  g: (r) => (hatPlayer(r.id) || {}).g,
  gpg: (r) => { const p = hatPlayer(r.id); return p && p.gp ? p.g / p.gp : null; },
  two: (r) => (hatPlayer(r.id) || {}).two,
  three: (r) => (hatPlayer(r.id) || {}).three,
  l10: (r) => (hatPlayer(r.id) || {}).l10,
  ppg: (r) => (hatPlayer(r.id) || {}).pp_g,
  toi: (r) => { const p = hatPlayer(r.id); return p && p.gp ? p.toi / p.gp : null; },
  pptoi: (r) => { const p = hatPlayer(r.id); return p && p.pp_gp ? p.pp_toi / p.pp_gp : null; },
  sog: (r) => { const p = hatPlayer(r.id); return p && p.gp ? p.sog / p.gp : null; },
  hd: (r) => { const p = hatPlayer(r.id); return p && p.gp ? p.hd / p.gp : null; },
  oga: (r) => { const t = hatTeam(r.opp); return t && t.gp ? t.ga / t.gp : null; },
  otwo: (r) => (hatTeam(r.opp) || {}).two_against,
  othree: (r) => (hatTeam(r.opp) || {}).three_against,
  gtwo: (r) => (hatGoalie(r.goalie) || {}).two,
  actual: (r) => r.actual,
};
const HAT_SORT_UP = new Set(["name", "slot"]);
function hatSorted(rows) {
  const get = HAT_SORT[hatView.sort] || HAT_SORT.mean;
  const ok = (v) => has(v) && v !== "";
  return [...rows].sort((a, b) => {
    const [va, vb] = [get(a), get(b)];
    if (!ok(va) || !ok(vb)) return ok(va) ? -1 : ok(vb) ? 1 : (b.mean || 0) - (a.mean || 0);
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * hatView.dir || (b.mean || 0) - (a.mean || 0);
  });
}
function hatTh(key, label, title, num = true) {
  const on = hatView.sort === key ? ` koe-sorted${hatView.dir > 0 ? " koe-asc" : ""}` : "";
  return `<th class="${num ? "num " : ""}koe-sort${on}" data-hat-sort="${key}"${title ? ` title="${title}"` : ""}>${label}</th>`;
}
function hatLine(r) {
  const slot = r.slot || r.usual_slot;
  if (!slot) return `<td class="num muted-label">--</td>`;
  const tip = r.slot ? "Tonight's line in the NHL's projected lineup" : "The line his ice time says he has been on (tonight's lineup isn't posted yet)";
  return `<td class="num" title="${tip}"><span class="ice-line${r.slot ? "" : " ice-line-usual"}">${HAT_SLOT[slot] || slot}</span></td>`;
}

function renderHatPlayers(rows) {
  const box = el("hat-players");
  if (!rows.length) return (box.innerHTML = `<p class="no-data-note">No players for these games yet.</p>`);
  const picked = hatSorted(hatView.team ? rows.filter((r) => r.team === hatView.team) : rows);
  const shown = hatView.all || hatView.team ? picked : picked.slice(0, HAT_SHOWN);
  const pool = (key) => rows.map((r) => HAT_SORT[key](r));
  const pools = Object.fromEntries(Object.keys(HAT_SORT).map((k) => [k, k === "name" || k === "slot" ? [] : pool(k)]));
  const result = rows.some((r) => r.final);
  const body = shown
    .map((r) => {
      const p = hatPlayer(r.id) || { gp: 0, g: 0, two: 0, three: 0, l10: 0, l10_gp: 0, pp_g: 0, toi: 0, pp_toi: 0, pp_gp: 0, sog: 0, hd: 0 };
      const d = hatTeam(r.opp) || {};
      const gl = hatGoalie(r.goalie);
      const mine = hatBig((b) => b.id === r.id, (b) => `${hatDate(b.date)} vs ${b.opp}: ${b.g} G${b.pp ? ` (${b.pp} PP)` : ""}`);
      const against = hatBig((b) => b.opp === r.opp, (b) => `${hatDate(b.date)} ${b.name} (${b.team}): ${b.g} G`);
      const onGoalie = hatBig((b) => (b.vs[r.goalie] || 0) >= 2, (b) => `${hatDate(b.date)} ${b.name} (${b.team}): ${b.vs[r.goalie]} on him`);
      return `<tr class="${r.locked && !r.final ? "ice-live" : ""}">
        <td class="koe-player"><span class="koe-who">${shareLogo(r.team, 22)}${playerClick(r.id, `<span class="koe-name">${r.name}</span>`)}<span class="koe-meta">${r.home ? "vs" : "@"} ${shareLogo(r.opp, 18)}</span></span></td>
        ${hatLine(r)}
        ${hatStep(r.mean, pools.mean, fmt(r.mean, 2), `The Goals model's expected goals for him tonight: his scoring rate x tonight's ice time x what ${r.opp} and its goalie allow. No price in it.`)}
        <td class="koe-gap"></td>
        <td class="num" title="Games played">${p.gp}</td>
        ${hatStep(p.g, pools.g, p.g, `${p.g} goals in ${p.gp} games`)}
        ${hatStep(HAT_SORT.gpg(r), pools.gpg, hatPer(p.g, p.gp), "Goals a game")}
        ${hatStep(p.two, pools.two, p.two, `His 2+ goal games:\n${mine}`, { zeroPlain: true })}
        ${hatStep(p.three, pools.three, p.three, "His hat tricks this season", { zeroPlain: true })}
        ${hatStep(p.l10, pools.l10, `${p.l10}<span class="muted-label">/${p.l10_gp}</span>`, `Goals in his last ${p.l10_gp} games`)}
        ${hatStep(p.pp_g, pools.ppg, p.pp_g, "Power-play goals")}
        <td class="koe-gap"></td>
        ${hatStep(HAT_SORT.toi(r), pools.toi, hatClock(p.gp ? p.toi / p.gp : null), "Ice time a game")}
        ${hatStep(HAT_SORT.pptoi(r), pools.pptoi, hatClock(p.pp_gp ? p.pp_toi / p.pp_gp : null), `Power-play ice time a game${p.pp_gp < p.gp ? ` (the ${p.pp_gp} games the league reported)` : ""}`)}
        ${hatStep(HAT_SORT.sog(r), pools.sog, hatPer(p.sog, p.gp, 1), `${p.sog} shots on goal in ${p.gp} games`)}
        ${hatStep(HAT_SORT.hd(r), pools.hd, hatPer(p.hd, p.gp, 1), `Shots a game from the low slot, in front of the net (${p.hd} in all)`)}
        <td class="koe-gap"></td>
        ${hatLeague(r.opp, "ga", hatPer(d.ga, d.gp), `${r.opp} allows ${hatPer(d.ga, d.gp)} goals a game`)}
        ${hatLeague(r.opp, "two_against", `${d.two_against || 0}`, `Players with 2+ goals against ${r.opp}:\n${against}`)}
        ${hatLeague(r.opp, "three_against", `${d.three_against || 0}`, `Hat tricks scored against ${r.opp}`, { zeroPlain: true, raw: d.three_against || 0 })}
        <td class="hat-goalie" title="The goalie he should face (never confirmed)">${gl ? playerClick(r.goalie, `<span>${lastName(gl.name)}</span>`) : "--"}</td>
        ${hatGoalieCell(r.goalie, (x) => x.two / Math.max(1, x.starts), gl ? `${gl.two}` : null, `Shooters with 2+ goals on ${gl ? gl.name : "him"}:\n${onGoalie}`)}
        ${result ? `<td class="num${r.actual >= 3 ? " hat-hit" : ""}" title="His goals tonight">${has(r.actual) ? r.actual : "--"}</td>` : ""}
      </tr>`;
    })
    .join("");
  const more = hatView.team
    ? `${hatView.team}'s ${picked.length} skaters &middot; <button type="button" class="ice-link" data-hat-team-reset="1">Show every team</button>`
    : picked.length > HAT_SHOWN
      ? `${hatView.all ? `All ${picked.length}` : `The top ${HAT_SHOWN} of ${picked.length}`} &middot; <button type="button" class="ice-link" data-hat-all="${hatView.all ? "" : "1"}">${hatView.all ? `Show the top ${HAT_SHOWN}` : "Show all"}</button>`
      : "";
  box.innerHTML = `<table class="data-table koe-table ice-table hat-table hat-players-table">
    <colgroup><col class="ice-c-player"><col class="ice-c-line"><col class="hat-c-stat"><col class="koe-c-gap">${'<col class="hat-c-stat">'.repeat(7)}<col class="koe-c-gap">${'<col class="hat-c-stat">'.repeat(4)}<col class="koe-c-gap">${'<col class="hat-c-stat">'.repeat(3)}<col class="hat-c-goalie"><col class="hat-c-stat">${result ? '<col class="hat-c-stat">' : ""}</colgroup>
    <thead><tr class="koe-group-row"><th></th><th></th><th class="koe-group koe-g-up"><span>Tonight</span></th><th class="koe-gap"></th><th colspan="7" class="koe-group koe-g-td"><span>Scoring &middot; This Season</span></th><th class="koe-gap"></th><th colspan="4" class="koe-group koe-g-role"><span>Usage</span></th><th class="koe-gap"></th><th colspan="5" class="koe-group koe-g-def"><span>Matchup</span></th>${result ? "<th></th>" : ""}</tr>
    <tr class="koe-label-row">${hatTh("name", "Player", "", false)}${hatTh("slot", "Line")}${hatTh("mean", "xG", "The Goals model's expected goals for him tonight (usage x matchup)")}<th class="koe-gap"></th>
      ${hatTh("gp", "GP", "Games played")}${hatTh("g", "G", "Goals")}${hatTh("gpg", "G/GP", "Goals a game")}${hatTh("two", "2G", "Games with 2+ goals")}${hatTh("three", "HT", "Hat tricks")}${hatTh("l10", "L10", "Goals in his last 10 games")}${hatTh("ppg", "PPG", "Power-play goals")}<th class="koe-gap"></th>
      ${hatTh("toi", "TOI", "Ice time a game")}${hatTh("pptoi", "PP TOI", "Power-play ice time a game")}${hatTh("sog", "SOG", "Shots on goal a game")}${hatTh("hd", "Slot", "Low-slot shots a game")}<th class="koe-gap"></th>
      ${hatTh("oga", "Opp GA", "Goals a game tonight's opponent allows")}${hatTh("otwo", "Opp 2G", "Games the opponent let one player score 2+")}${hatTh("othree", "Opp HT", "Hat tricks the opponent allowed")}<th>Goalie</th>${hatTh("gtwo", "G 2G", "Games a shooter scored 2+ on tonight's goalie")}${result ? hatTh("actual", "Result", "His goals tonight") : ""}</tr></thead>
    <tbody>${body}</tbody></table>
    ${more ? `<div class="ice-more">${more}</div>` : ""}`;
}

// Beside the tables (never in the saved image): every hat trick this season,
// and every defense by the 2+ goal games it has given up to one player.
function renderHatSide() {
  const big = (HAT || {}).big || [];
  const hats = big.filter((b) => b.g >= 3).slice().reverse();
  const goalieOf = (b) => Object.entries(b.vs).sort((x, y) => y[1] - x[1]).map(([gid, n]) => `${lastName((hatGoalie(gid) || {}).name || "")} ${n}`).join(", ");
  el("hat-list").innerHTML = hats.length
    ? `<table class="crease-win-table hat-list-table"><thead><tr><th>Day</th><th>Hat Trick</th><th>Vs</th><th title="Goals on each goalie (the rest went in empty nets)">On</th></tr></thead><tbody>${hats
        .map((b) => `<tr><td class="ice-win-date">${hatDate(b.date)}</td><td class="crease-win-name">${shareLogo(b.team, 16)}${playerClick(b.id, `<span>${b.name}</span>`)}${b.g > 3 ? ` <b>${b.g}</b>` : ""}</td><td>${shareLogo(b.opp, 16)}</td><td class="hat-on">${goalieOf(b) || "--"}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="no-data-note">No hat tricks yet this season.</p>`;
  const teams = Object.entries((HAT || {}).teams || {}).sort(([, a], [, b]) => b.two_against / Math.max(1, b.gp) - a.two_against / Math.max(1, a.gp) || b.three_against - a.three_against);
  const n = teams.length;
  el("hat-defenses").innerHTML = teams.length
    ? `<table class="crease-win-table hat-def-table"><thead><tr><th>Defense</th><th title="Games played">GP</th><th title="Goals allowed a game">GA/GP</th><th title="Games it let one player score 2+">2G</th><th title="Hat tricks allowed">HT</th></tr></thead><tbody>${teams
        .map(([abbr, t], i) => `<tr><td>${shareLogo(abbr, 16)} ${abbr}</td><td>${t.gp}</td><td>${hatPer(t.ga, t.gp)}</td><td class="nhl-rank-cell"${cellOnStep(rankStep(i + 1, n))} title="${hatBig((b) => b.opp === abbr, (b) => `${hatDate(b.date)} ${b.name} (${b.team}): ${b.g} G`)}">${t.two_against}</td><td>${t.three_against || '<span class="muted-label">0</span>'}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
}

function renderHat() {
  if (!DATA || !HAT) return;
  const day = hatDay();
  if (day && !hatView.games) hatView.games = new Set(day.games.map((g) => g.game_id));
  if (!day) hatView.games = new Set();
  renderHatSlate();
  const rows = hatRows();
  el("hat-note").hidden = !!rows.length;
  el("hat-note").textContent = day ? "No players for these games yet." : "No NHL games with players on the board yet.";
  renderHatTeams(rows);
  renderHatPlayers(rows);
  renderHatSide();
  const n = hatView.games.size;
  el("hat-capture-sub").textContent = day ? `${longDate(hatDays()[hatView.day])} · ${n} game${n === 1 ? "" : "s"}` : "";
}

// ---- the image ----
async function saveHatImage() {
  const btn = el("hat-save");
  const card = el("hat-capture");
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
    card.classList.add("ice-capturing");
    const url = await window.htmlToImage.toPng(card, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      fontEmbedCSS: await embeddedFontCSS(),
      includeQueryParams: true,
      width: card.scrollWidth,
      height: card.scrollHeight,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `king-of-the-hat-trick-${hatDays()[hatView.day] || "today"}.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  card.classList.remove("ice-capturing");
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#hat-app")) return;
  if (e.target.closest("#hat-save")) return saveHatImage();
  const day = e.target.closest("#hat-day-prev, #hat-day-next");
  if (day) {
    hatView.day = Math.max(0, Math.min(hatDays().length - 1, hatView.day + (day.id === "hat-day-next" ? 1 : -1)));
    hatView.games = null;
    hatView.team = null;
    return renderHat();
  }
  const game = e.target.closest("[data-hat-game]");
  if (game) {
    const id = game.dataset.hatGame;
    hatView.games.has(id) ? hatView.games.delete(id) : hatView.games.add(id);
    hatView.team = null;
    return renderHat();
  }
  if (e.target.closest("[data-hat-team-reset]")) {
    hatView.team = null;
    return renderHat();
  }
  const tsort = e.target.closest("[data-hat-tsort]");
  if (tsort) {
    const key = tsort.dataset.hatTsort;
    Object.assign(hatTeamView, hatTeamView.sort === key ? { dir: -hatTeamView.dir } : { sort: key, dir: HAT_TEAM_UP.has(key) ? 1 : -1 });
    return renderHat();
  }
  const sort = e.target.closest("[data-hat-sort]");
  if (sort) {
    const key = sort.dataset.hatSort;
    Object.assign(hatView, hatView.sort === key ? { dir: -hatView.dir } : { sort: key, dir: HAT_SORT_UP.has(key) ? 1 : -1 });
    return renderHat();
  }
  const all = e.target.closest("[data-hat-all]");
  if (all) {
    hatView.all = !!all.dataset.hatAll;
    return renderHat();
  }
  const team = e.target.closest("[data-hat-team]");
  if (team && !e.target.closest(".player-click")) {
    hatView.team = hatView.team === team.dataset.hatTeam ? null : team.dataset.hatTeam;
    return renderHat();
  }
});

function loadHat() {
  return fetch("hattrick.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((hat) => {
      HAT = hat || { days: {}, big: [], players: {}, teams: {}, goalies: {}, league: {} };
      const all = hatDays();
      const today = new Date().toLocaleDateString("en-CA");
      const day = all.find((d) => d >= today) || all[all.length - 1];
      hatView.day = Math.max(0, all.indexOf(day));
    });
}
