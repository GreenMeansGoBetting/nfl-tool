// ---- GMG NBA Suite: Promo Tools, King of the Court ----
// DraftKings pays out on the night's most points + rebounds + assists (PRA).
// Everything comes from nba/data.json `kotc` (nfl_tool/nba/kotc.py): both
// seasons' boards, the next few nights' slates projected from each, and the
// record of each night's board. The page does no projection math; it picks a
// season and a night, sorts and colors.

let DATA = null;
let KOTC = null;
let season = null;
let dayIndex = 0;
let showAll = false;
let nightsShown = 15;
const playerSort = { key: "lead", dir: -1 };
const defSort = { key: "score", dir: -1 };
let defPlayingOnly = false;  // defense board: only the night's teams (for screenshots)
const SEASON_KEY = "nba-tool.kotc-season.v1";
const TOP_ROWS = 25;

const el = (id) => document.getElementById(id);
const fmt = (n, digits = 1) => (n === null || n === undefined ? "--" : Number(n).toFixed(digits));
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const headshot = (id) => `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${id}.png&w=96&h=70&scale=crop`;
const signed = (n) => (n === null || n === undefined ? "--" : n === 0 ? "PK" : `${n > 0 ? "+" : ""}${String(Number(n.toFixed(1))).replace(/\.0$/, "")}`);
const dayWords = (date, opts = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, opts);

// Red (0) to green (120) through the member's color set (sync.js).
function heat(value, lo, hi, flip) {
  if (value === null || value === undefined || hi === lo) return "";
  let t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  if (flip) t = 1 - t;
  return ` style="background:${scaleHsla(Math.round(t * 120), 70, 45, 0.3)}"`;
}
const range = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 0];
};

const block = () => KOTC.seasons[season];
const slate = () => KOTC.slates[season] || {};
const days = () => Object.keys(KOTC.slates[KOTC.default] || slate()).sort();
const gameOf = (id) => DATA.schedule.find((g) => g.game_id === id) || {};

// ---- season switch ----
function renderSeasons() {
  el("kotc-seasons").innerHTML = Object.keys(KOTC.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${KOTC.seasons[s].label}</button>`)
    .join("") + (KOTC.seasons[DATA.season] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  const note = el("kotc-note");
  const b = block();
  const thisSeason = String(DATA.season);
  note.hidden = false;
  note.textContent = season === thisSeason
    ? `${b.label} numbers: ${b.games} games so far. Each player's average starts with 5 games of his last season mixed in, so a hot first week can't run away with it.`
    : `${b.label} numbers, with players on their current teams.${KOTC.seasons[thisSeason] ? ` ${KOTC.seasons[thisSeason].label} has ${KOTC.seasons[thisSeason].games} games so far.` : ` ${DATA.season_label} numbers take over once teams have a few games in.`}`;
}

// PG / SG / SF / PF / C from ESPN's depth charts (positions.py).
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const POS_NAMES = { PG: "Point Guards", SG: "Shooting Guards", SF: "Small Forwards", PF: "Power Forwards", C: "Centers" };

// ---- player board ----
const PLAYER_COLS = [
  { key: "rank", label: "#", sort: false },
  { key: "name", label: "Player", value: (r) => r.p.name },
  { key: "lead", label: "Lead %", title: "His chance to have the most PRA of the night", value: (r) => r.lead },
  { key: "proj", label: "Proj", title: "Tonight's projected PRA", value: (r) => r.proj },
  { key: "pra", label: "Avg", title: "PRA a game this season", value: (r) => r.p.pra },
  { key: "l10", label: "L10", title: "PRA a game, last 10 games", value: (r) => r.p.l10 },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `b${i}`, label: "", bucket: i, value: (r) => r.p.buckets[i] })),
  { key: "score", label: "Score", title: "40+ x1, 45+ x2, 50+ x3, 55+ x4, 60+ x5", value: (r) => r.p.score },
  { key: "opp", label: "Opp", value: (r) => r.opp },
  { key: "matchup", label: "Matchup", title: "The other team's Score for PRA given up (green = gives up the most)", value: (r) => r.def && r.def.score },
  { key: "vspos", label: "vs Pos", title: "PRA a minute the other team allows his position, against the league. The projection still reads guards / forwards / centers for now", value: (r) => r.def && r.def.pos_f && r.def.pos_f[r.p.pos] },
  { key: "total", label: "Total", title: "The game's total (Novig)", value: (r) => r.game.total_line },
  { key: "spread", label: "Spread", title: "His team's spread. 10+ point games produced fewer leaders last season (starters sit)", value: (r) => r.spread },
];

function playerRows(date) {
  const b = block();
  return (slate()[date] || [])
    .map((r) => {
      const p = b.players[r.id];
      if (!p) return null;
      const game = gameOf(r.game_id);
      const side = r.home ? "home" : "away";
      return { ...r, p, game, def: b.defense[r.opp], spread: game[`${side}_team_spread`] ?? null, lead: r.out ? null : r.lead ?? 0 };
    })
    .filter(Boolean);
}

function renderPlayers() {
  const date = days()[dayIndex];
  const rows = playerRows(date);
  const games = new Set(rows.map((r) => r.game_id)).size;
  el("kotc-capture-sub").textContent = date ? `${dayWords(date, { weekday: "long", month: "long", day: "numeric" })} · ${games} game${games === 1 ? "" : "s"} · ${block().label} numbers` : "";
  if (!rows.length) {
    el("kotc-players").innerHTML = `<p class="no-data-note">No players to show for this night.</p>`;
    return;
  }
  const col = PLAYER_COLS.find((c) => c.key === playerSort.key) || PLAYER_COLS[2];
  const live = rows.filter((r) => !r.out);
  const out = rows.filter((r) => r.out);
  const cmp = (a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * playerSort.dir;
    return ((va ?? -Infinity) - (vb ?? -Infinity)) * playerSort.dir || b.proj - a.proj;
  };
  live.sort(cmp);
  const shown = showAll ? live : live.slice(0, TOP_ROWS);
  const scale = (fn) => range(live.map(fn));
  const leadMax = Math.max(...live.map((r) => r.lead || 0), 0.0001);
  const [pLo, pHi] = scale((r) => r.proj);
  const [aLo, aHi] = scale((r) => r.p.pra);
  const [sLo, sHi] = scale((r) => r.p.score);
  const bucketHi = [0, 1, 2, 3, 4].map((i) => Math.max(1, ...live.map((r) => r.p.buckets[i])));
  const [mLo, mHi] = range(Object.values(block().defense).map((d) => d.score));
  const [tLo, tHi] = scale((r) => r.game.total_line);
  const thresholds = KOTC.thresholds;

  const head = PLAYER_COLS.map((c) => {
    const label = c.bucket !== undefined ? `${thresholds[c.bucket]}+` : c.label;
    const sorted = playerSort.key === c.key ? (playerSort.dir < 0 ? " &#9662;" : " &#9652;") : "";
    return c.sort === false ? `<th>${label}</th>` : `<th class="koe-sort${c.key === "name" ? "" : " num"}" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${label}${sorted}</th>`;
  }).join("");

  const row = (r, i) => {
    const p = r.p;
    const tags = [];
    if (r.b2b) tags.push(`<span class="kotc-tag" title="His team played last night">B2B</span>`);
    if (p.team && p.team !== r.team) tags.push(`<span class="kotc-tag kotc-tag-new" title="These numbers are from ${p.team}">from ${p.team}</span>`);
    if (r.out) tags.push(`<span class="gs-inj-status tier-bad">Out</span>`);
    const pf = r.def && r.def.pos_f && r.def.pos_f[p.pos];
    const blow = r.spread !== null && Math.abs(r.spread) >= 10;
    return `<tr class="${r.out ? "kotc-out" : ""}" data-player="${p.id}">
      <td class="num kotc-rank">${r.out ? "" : i + 1}</td>
      <td class="kotc-player"><img src="${headshot(p.id)}" alt="" class="kotc-face" loading="lazy" onerror="this.style.visibility='hidden'"><span class="kotc-who"><b>${playerClick(p.id, p.name)}</b><span class="kotc-sub">${logo(r.team, 14)} ${r.team} · ${p.pos} · ${p.games} GP</span></span>${tags.join("")}</td>
      <td class="num kotc-lead"${r.out ? "" : heat(r.lead, 0, leadMax)}>${r.out ? "--" : `${(r.lead * 100).toFixed(r.lead < 0.1 ? 1 : 0)}%`}</td>
      <td class="num"${r.out ? "" : heat(r.proj, pLo, pHi)}><b>${fmt(r.proj)}</b></td>
      <td class="num"${heat(p.pra, aLo, aHi)}>${fmt(p.pra)}</td>
      <td class="num">${fmt(p.l10)}</td>
      ${p.buckets.map((c, k) => `<td class="num"${heat(c, 0, bucketHi[k])}>${c}</td>`).join("")}
      <td class="num"${heat(p.score, sLo, sHi)}><b>${p.score}</b></td>
      <td class="kotc-opp">${r.home ? "vs" : "@"} ${logo(r.opp, 18)} ${r.opp}</td>
      <td class="num"${r.def ? heat(r.def.score, mLo, mHi) : ""}>${r.def ? r.def.score : "--"}</td>
      <td class="num"${pf ? heat(pf, 0.9, 1.1) : ""} title="${pf ? `${r.opp} allows ${(POS_NAMES[p.pos] || p.pos).toLowerCase()} ${fmt(r.def.pos[p.pos])} PRA per 48 minutes` : ""}">${pf ? `${pf >= 1 ? "+" : ""}${Math.round((pf - 1) * 100)}%` : "--"}</td>
      <td class="num"${heat(r.game.total_line, tLo, tHi)}>${r.game.total_line ? fmt(r.game.total_line).replace(/\.0$/, "") : "--"}</td>
      <td class="num${blow ? " kotc-blowout" : ""}"${blow ? ' title="Blowout risk: stars can sit the 4th quarter"' : ""}>${signed(r.spread)}</td>
    </tr>`;
  };
  const more = live.length > TOP_ROWS
    ? `<button type="button" id="kotc-more" class="view-toggle-btn kotc-more">${showAll ? `Show top ${TOP_ROWS}` : `Show all ${live.length}`}</button>`
    : "";
  el("kotc-players").innerHTML = `<table class="data-table kotc-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${shown.map(row).join("")}${out.length ? `<tr class="kotc-group"><td colspan="${PLAYER_COLS.length}">Out tonight</td></tr>${out.map((r) => row(r, 0)).join("")}` : ""}</tbody>
    </table>${more}`;
}

// ---- defense board ----
const TARGET_TOP = 100;
const DEF_COLS = [
  { key: "team", label: "Team", value: (t) => t.abbr },
  { key: "tonight", label: "Tonight", value: (t) => t.opp || "" },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `b${i}`, bucket: i, value: (t) => t.d.buckets[i] })),
  { key: "score", label: "Score", value: (t) => t.d.score },
  { key: "star", label: "Best opp", title: "Most PRA by one opponent, average a game", value: (t) => t.d.star },
  ...POSITIONS.map((p) => ({ key: `pos${p}`, label: `vs ${p}`, title: `PRA per 48 minutes allowed to ${POS_NAMES[p].toLowerCase()}`, value: (t) => t.d.pos[p] })),
  { key: "games", label: "GP", value: (t) => t.d.games },
  { key: "targets", label: "Targets", title: `Tonight's opponents in the top ${TARGET_TOP} on the player board (Lead %)`, value: (t) => t.targets.length },
];

function renderDefense() {
  const date = days()[dayIndex];
  const tonight = {};
  const b2b = new Set();
  for (const r of slate()[date] || []) {
    tonight[r.team] = { opp: r.opp, home: r.home };
    if (r.b2b) b2b.add(r.team);
  }
  // Targets: the player board's top 100 by Lead % (as it sorts by default), listed on the defense they face.
  const targets = {};
  playerRows(date).filter((r) => !r.out).sort((a, b) => b.lead - a.lead || b.proj - a.proj).slice(0, TARGET_TOP)
    .forEach((r) => (targets[r.opp] = targets[r.opp] || []).push(r.p.name));
  const rows = Object.entries(block().defense).map(([abbr, d]) => ({ abbr, d, opp: tonight[abbr] ? tonight[abbr].opp : null, home: tonight[abbr] && tonight[abbr].home, targets: targets[abbr] || [] }));
  const col = DEF_COLS.find((c) => c.key === defSort.key) || DEF_COLS[7];
  rows.sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * defSort.dir;
    return ((va ?? -Infinity) - (vb ?? -Infinity)) * defSort.dir;
  });
  const hi = [0, 1, 2, 3, 4].map((i) => range(rows.map((t) => t.d.buckets[i])));
  const sc = range(rows.map((t) => t.d.score));
  const st = range(rows.map((t) => t.d.star));
  const pos = POSITIONS.map((p) => range(rows.map((t) => t.d.pos[p])));
  // Hiding the idle teams keeps the colors against all 30 (ranges above use every row).
  const hide = defPlayingOnly && Object.keys(tonight).length > 0;
  el("kotc-def-playing").textContent = defPlayingOnly ? "Show All Teams" : "Hide Teams Not Playing";
  el("kotc-def-sub").textContent = `${block().label} · ${date ? `teams playing ${dayWords(date)}${hide ? "" : " in bold"}` : ""}`;
  const head = DEF_COLS.map((c) => {
    const label = c.bucket !== undefined ? `${KOTC.thresholds[c.bucket]}+` : c.label;
    const sorted = defSort.key === c.key ? (defSort.dir < 0 ? " &#9662;" : " &#9652;") : "";
    return `<th class="koe-sort${c.key === "team" ? "" : " num"}" data-defsort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${label}${sorted}</th>`;
  }).join("");
  // Defense view: red = gives up the most (bad defense), so the scale is flipped.
  const body = rows.filter((t) => !hide || t.opp).map((t) => `<tr class="${t.opp ? "kotc-playing" : "kotc-idle"}">
      <td class="kotc-team">${logo(t.abbr, 20)} <b>${t.abbr}</b>${b2b.has(t.abbr) ? ` <span class="kotc-tag" title="Played last night">B2B</span>` : ""}</td>
      <td class="kotc-opp">${t.opp ? `${t.home ? "vs" : "@"} ${logo(t.opp, 16)} ${t.opp}` : ""}</td>
      ${t.d.buckets.map((c, k) => `<td class="num"${heat(c, hi[k][0], hi[k][1], true)}>${c}</td>`).join("")}
      <td class="num"${heat(t.d.score, sc[0], sc[1], true)}><b>${t.d.score}</b></td>
      <td class="num"${heat(t.d.star, st[0], st[1], true)}>${fmt(t.d.star)}</td>
      ${POSITIONS.map((p, k) => `<td class="num"${heat(t.d.pos[p], pos[k][0], pos[k][1], true)}>${fmt(t.d.pos[p])}</td>`).join("")}
      <td class="num">${t.d.games}</td>
      <td class="kotc-targets">${t.targets.map((n) => `<span title="${n}">${n.split(" ").slice(1).join(" ") || n}</span>`).join(", ")}</td>
    </tr>`).join("");
  el("kotc-defense").innerHTML = `<table class="data-table kotc-table kotc-def-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- nightly leaders ----
function renderNights() {
  const nights = (block().nights || []).slice().reverse();
  const record = String(DATA.season) === season ? KOTC.record || {} : {};
  if (!nights.length) {
    el("kotc-nights").innerHTML = `<p class="no-data-note">No finished nights yet this season.</p>`;
    return;
  }
  const list = nights.slice(0, nightsShown).map((n) => {
    const lead = n.leaders[0];
    const board = (record[n.date] || {}).board;
    const pre = board ? board.findIndex((b) => n.leaders.some((l) => l.id === b.id)) : -2;
    const preTag = pre >= 0 ? `<span class="koe-win-rank" title="His place on this page's board before the first tip">Pre ${pre + 1}</span>` : pre === -1 ? `<span class="koe-win-rank" title="Not in the board's top ${board.length}">Pre ${board.length}+</span>` : "";
    const line = [lead.total ? `O/U ${fmt(lead.total).replace(/\.0$/, "")}` : null, lead.spread !== null && lead.spread !== undefined ? `${lead.team} ${signed(lead.spread)}` : null].filter(Boolean).join(" · ");
    return `<div class="kotc-night">
      <span class="koe-win-date">${dayWords(n.date, { month: "numeric", day: "numeric" })}<small>${n.games} G</small></span>
      <span class="koe-win-who">${logo(lead.team, 18)}<span class="koe-win-names">${n.leaders.map((l) => l.name).join(" / ")}</span></span>
      <span class="kotc-night-line" title="${lead.pts} pts, ${lead.reb} reb, ${lead.ast} ast vs ${lead.opp}${n.second ? `; next best ${n.second}` : ""}">${line}</span>
      ${preTag}
      <span class="koe-win-yds">${n.pra}</span>
    </div>`;
  });
  el("kotc-nights").innerHTML = list.join("") + (nights.length > nightsShown ? `<button type="button" id="kotc-nights-more" class="view-toggle-btn kotc-more">Show more</button>` : "");
}

// ---- Historical Data ----
function renderHistory() {
  // This season's popup needs a few weeks of nights; until then it shows last season's.
  let s = season;
  if ((KOTC.seasons[s].summary || {}).nights < 20) s = Object.keys(KOTC.seasons).sort()[0];
  const b = KOTC.seasons[s];
  const sum = b.summary;
  el("kotc-hist-season").textContent = `${b.label}, ${sum.nights} nights`;
  const pct = (x) => (x === null || x === undefined ? "--" : `${Math.round(x * 100)}%`);
  const ratio = (r) => (r.fair ? r.share / r.fair : null);
  const mixRows = (rows) => rows.map((r) => {
    const x = ratio(r);
    return `<tr><td>${r.label}</td><td>${pct(r.share)}</td><td>${pct(r.fair)}</td><td class="${x >= 1.15 ? "tier-good" : x <= 0.85 ? "tier-bad" : ""}">${x ? `${x.toFixed(2)}x` : "--"}</td></tr>`;
  }).join("");
  const posTotal = Object.values(sum.positions).reduce((a, v) => a + v, 0) || 1;
  const typicalRange = range(sum.by_size.map((r) => r.median));  // greener = a bigger night needed
  el("kotc-hist-body").innerHTML = `
    <div class="kotc-hist-tiles">
      <div class="kotc-hist-tile"><b>${fmt(sum.mean ?? sum.median, 0)}</b><span>AVG Winning PRA</span></div>
      <div class="kotc-hist-tile"><b>${pct(sum.favored)}</b><span>Winners Team Favored</span></div>
      <div class="kotc-hist-tile"><b>${fmt(sum.leader_total, 0)}</b><span>Winners AVG Game Total</span></div>
      <div class="kotc-hist-tile"><b>65%</b><span>Winner in Top 5</span></div>
    </div>
    <h3 class="kotc-hist-h kotc-hist-center">What it took to win</h3>
    <table class="kotc-hist-table kotc-hist-center"><thead><tr><th>Games on the slate</th><th>Nights</th><th>Typical winner</th><th>Middle half</th><th>Best night</th></tr></thead>
      <tbody>${sum.by_size.map((r) => `<tr><td>${r.games}</td><td>${r.nights}</td><td${heat(r.median, ...typicalRange)}><b>${fmt(r.median, 0)}</b></td><td>${fmt(r.low, 0)} - ${fmt(r.high, 0)}</td><td>${r.max}</td></tr>`).join("")}</tbody></table>
    <div class="kotc-hist-two kotc-hist-center">
      <div><h3 class="kotc-hist-h">The game total</h3>
        <table class="kotc-hist-table"><thead><tr><th>Total</th><th>Leaders</th><th>Games</th><th>Rate</th></tr></thead><tbody>${mixRows(sum.by_total)}</tbody></table></div>
      <div><h3 class="kotc-hist-h">The spread</h3>
        <table class="kotc-hist-table"><thead><tr><th>Spread</th><th>Leaders</th><th>Games</th><th>Rate</th></tr></thead><tbody>${mixRows(sum.by_spread)}</tbody></table></div>
    </div>
    <p class="kotc-hist-note">Totals and spreads are the pregame lines at tip-off, not the final score. <b>Leaders:</b> how often the night's leader played in that kind of game. <b>Games:</b> that kind of game's share of the games on those nights. <b>Rate</b> over 1 = more leaders than its share of games. High totals and close games produce more leaders; blowouts fewer (starters sit). The projection counts the total lightly: in the replay the matchup by position mattered far more, and the spread added nothing beyond it.</p>
    <div class="kotc-hist-two">
      <div><h3 class="kotc-hist-h">Who wins it</h3>
        <table class="kotc-hist-table"><thead><tr><th>Position</th><th>Nights</th><th>Share</th></tr></thead><tbody>${POSITIONS.map((k) => [k, POS_NAMES[k]]).map(([k, n]) => `<tr><td>${n}</td><td>${sum.positions[k]}</td><td>${pct(sum.positions[k] / posTotal)}</td></tr>`).join("")}</tbody></table></div>
      <div><h3 class="kotc-hist-h">Most nights led</h3>
        <table class="kotc-hist-table"><thead><tr><th>Player</th><th>Nights</th></tr></thead><tbody>${sum.most.map((m) => `<tr><td>${m.name}</td><td>${m.nights}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <h3 class="kotc-hist-h">How far to trust the board</h3>
    <ul class="kotc-hist-list">
      <li>Replayed on 2025-26, each night projected only from the games before it: the night's leader was the board's #1 on 30% of nights, in its top 5 on 65% and its top 10 on 83%. A plain PRA average got 27% / 63% / 79%.</li>
      <li>The Lead % numbers were honest: players given about 14% led about 14% of the time; 26% led 27%.</li>
      <li>The matchup by position was the biggest addition. The game total helped a little. Back-to-backs and the spread added nothing once those were in, so they are tags, not part of the number.</li>
      <li>The replay knew who played. The live page only knows the injury report, so a late scratch can move a night.</li>
    </ul>`;
}

// ---- page ----
function render() {
  if (!KOTC) return;
  const all = days();
  el("kotc-day-label").textContent = all[dayIndex] ? dayWords(all[dayIndex]) : "No games";
  el("kotc-day-prev").disabled = dayIndex <= 0;
  el("kotc-day-next").disabled = dayIndex >= all.length - 1;
  renderSeasons();
  renderPlayers();
  renderDefense();
  renderNights();
}

function setSeason(s) {
  if (!KOTC.seasons[s]) return;
  season = s;
  nightsShown = 15;
  try {
    localStorage.setItem(SEASON_KEY, s);
  } catch (e) {
    // localStorage unavailable -- the choice just won't be remembered.
  }
  render();
}

// The image (same as King of the Crease: html-to-image, fonts inlined).
let fontCSSCache = null;
async function embeddedFontCSS() {
  if (fontCSSCache !== null) return fontCSSCache;
  try {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css"]');
    const css = await fetch(link.href).then((r) => r.text());
    const latin = css.split("/* ").filter((b) => b.startsWith("latin */")).map((b) => b.slice("latin */".length));
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
    fontCSSCache = inlined.join("\n");
  } catch (e) {
    fontCSSCache = "";
  }
  return fontCSSCache;
}
async function saveImage(btnId, cardId, name) {
  const btn = el(btnId);
  const card = el(cardId);
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
    card.classList.add("kotc-capturing");
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
    a.download = `${name}-${days()[dayIndex] || "today"}.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  card.classList.remove("kotc-capturing");
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}

document.addEventListener("click", (e) => {
  if (!KOTC) return;
  const s = e.target.closest("[data-season]");
  if (s) return setSeason(s.dataset.season);
  if (e.target.closest("#kotc-day-prev")) return (dayIndex = Math.max(0, dayIndex - 1)), render();
  if (e.target.closest("#kotc-day-next")) return (dayIndex = Math.min(days().length - 1, dayIndex + 1)), render();
  if (e.target.closest("#kotc-more")) return (showAll = !showAll), renderPlayers();
  if (e.target.closest("#kotc-nights-more")) return (nightsShown += 30), renderNights();
  if (e.target.closest("#kotc-save")) return saveImage("kotc-save", "kotc-capture", "king-of-the-court");
  if (e.target.closest("#kotc-def-playing")) return (defPlayingOnly = !defPlayingOnly), renderDefense();
  if (e.target.closest("#kotc-def-save")) return saveImage("kotc-def-save", "kotc-def-capture", "kotc-defense");
  if (e.target.closest("#kotc-history-btn")) {
    renderHistory();
    el("kotc-history-modal").hidden = false;
    return;
  }
  if (e.target.closest("#kotc-history-modal .modal-close") || e.target.id === "kotc-history-modal") {
    el("kotc-history-modal").hidden = true;
    return;
  }
  const sort = e.target.closest("[data-sort]");
  if (sort) {
    const key = sort.dataset.sort;
    Object.assign(playerSort, playerSort.key === key ? { dir: -playerSort.dir } : { key, dir: key === "name" ? 1 : -1 });
    return renderPlayers();
  }
  const dsort = e.target.closest("[data-defsort]");
  if (dsort) {
    const key = dsort.dataset.defsort;
    Object.assign(defSort, defSort.key === key ? { dir: -defSort.dir } : { key, dir: key === "team" || key === "tonight" ? 1 : -1 });
    return renderDefense();
  }
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
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("kotc-history-modal").hidden) el("kotc-history-modal").hidden = true;
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    KOTC = data.kotc;
    el("empty-state").hidden = true;
    if (!KOTC || !Object.keys(KOTC.seasons || {}).length) {
      el("empty-state").hidden = false;
      el("empty-state").innerHTML = "<p>King of the Court isn't available right now. Check back after the next update.</p>";
      return;
    }
    let saved = null;
    try {
      saved = localStorage.getItem(SEASON_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    season = KOTC.seasons[saved] ? saved : KOTC.default;
    const today = new Date().toLocaleDateString("en-CA");
    const all = days();
    dayIndex = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[0]));
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
