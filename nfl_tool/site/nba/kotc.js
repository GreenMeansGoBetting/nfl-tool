// ---- GMG NBA Suite: Promo Tools, King of the Court ----
// DraftKings pays out on the night's most points + rebounds + assists (PRA).
// Everything comes from nba/data.json `kotc` (nfl_tool/nba/kotc.py): this
// season's board (this season only since 2026-10-22), the next few nights'
// slates, every finished night as its pregame board had it (`past`), and the
// record of each night's board. The page does no projection math; it picks a
// night, sorts and colors. The one fit here is the payout estimate, from the
// payouts the owner logs (/api/court-payouts).

let DATA = null;
let KOTC = null;
let season = null;
let dayIndex = 0;
let showAll = false;
let nightsShown = 15;
const playerSort = { key: "lead", dir: -1 };
const pastSort = { key: "pra", dir: -1 };
const defSort = { key: "star", dir: -1 };
let defPlayingOnly = false;  // defense board: only the night's teams (for screenshots)
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
const past = () => KOTC.past || {};
// Finished nights (as their pregame boards had them), then tonight and the next few.
const days = () => [...new Set([...Object.keys(past()), ...Object.keys(slate())])].sort();
const isPast = (date) => !!past()[date] && !slate()[date];
const gameOf = (id) => DATA.schedule.find((g) => g.game_id === id) || {};

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
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `b${i}`, label: "", bucket: i, value: (r) => r.p.buckets[i] })),
  { key: "opp", label: "Opp", value: (r) => r.opp },
  { key: "oppTop", label: "Opp Top", title: "In the other team's games this season, the most PRA any one opponent had, on average (green = it lets the other team's best player go big)", value: (r) => r.def && r.def.star },
  { key: "vspos", label: "vs Pos", title: "PRA a minute the other team allows his position, against the league. The projection still reads guards / forwards / centers for now", value: (r) => r.def && r.def.pos_f && r.def.pos_f[r.p.pos] },
  { key: "total", label: "Total", title: "The game's total (Novig)", value: (r) => r.game.total_line },
  { key: "spread", label: "Spread", title: "His team's spread. 10+ point games produced fewer leaders last season (starters sit)", value: (r) => r.spread },
  { key: "est", label: "Est Pay", fit: true, title: "About what DraftKings would pay each person on him if he wins, fit from the payouts logged so far", value: (r) => estPay(r.lead) },
];
const playerCols = () => PLAYER_COLS.filter((c) => !c.fit || payoutFit());

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
  if (isPast(date)) return renderPast(date);
  const rows = playerRows(date);
  const COLS = playerCols();
  const games = new Set(rows.map((r) => r.game_id)).size;
  el("kotc-capture-sub").textContent = date ? `${dayWords(date, { weekday: "long", month: "long", day: "numeric" })} · ${games} game${games === 1 ? "" : "s"} · ${block().label} numbers` : "";
  if (!rows.length) {
    el("kotc-players").innerHTML = `<p class="no-data-note">No players to show for this night.</p>`;
    return;
  }
  const col = COLS.find((c) => c.key === playerSort.key) || COLS[2];
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
  const bucketHi = [0, 1, 2, 3, 4].map((i) => Math.max(1, ...live.map((r) => r.p.buckets[i])));
  const [mLo, mHi] = range(Object.values(block().defense).map((d) => d.star));
  const [tLo, tHi] = scale((r) => r.game.total_line);
  const thresholds = KOTC.thresholds;

  const head = COLS.map((c) => {
    const label = c.bucket !== undefined ? `${thresholds[c.bucket]}+` : c.label;
    const sorted = playerSort.key === c.key ? (playerSort.dir < 0 ? " &#9662;" : " &#9652;") : "";
    return c.sort === false ? `<th>${label}</th>` : `<th class="koe-sort${c.key === "name" ? "" : " num"}" data-sort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${label}${sorted}</th>`;
  }).join("");

  const row = (r, i) => {
    const p = r.p;
    const tags = [];
    if (r.b2b) tags.push(`<span class="kotc-tag" title="His team played last night">B2B</span>`);
    if (r.out) tags.push(`<span class="gs-inj-status tier-bad">Out</span>`);
    const pf = r.def && r.def.pos_f && r.def.pos_f[p.pos];
    const blow = r.spread !== null && Math.abs(r.spread) >= 10;
    return `<tr class="${r.out ? "kotc-out" : ""}" data-player="${p.id}">
      <td class="num kotc-rank">${r.out ? "" : i + 1}</td>
      <td class="kotc-player"><img src="${headshot(p.id)}" alt="" class="kotc-face" loading="lazy" onerror="this.style.visibility='hidden'"><span class="kotc-who"><b>${playerClick(p.id, p.name)}</b><span class="kotc-sub">${logo(r.team, 14)} ${r.team} · ${p.pos} · ${p.games} GP</span></span>${tags.join("")}</td>
      <td class="num kotc-lead"${r.out ? "" : heat(r.lead, 0, leadMax)}>${r.out ? "--" : `${(r.lead * 100).toFixed(r.lead < 0.1 ? 1 : 0)}%`}</td>
      <td class="num"${r.out ? "" : heat(r.proj, pLo, pHi)}><b>${fmt(r.proj)}</b></td>
      <td class="num"${heat(p.pra, aLo, aHi)}>${fmt(p.pra)}</td>
      ${p.buckets.map((c, k) => `<td class="num"${heat(c, 0, bucketHi[k])}>${c}</td>`).join("")}
      <td class="kotc-opp">${r.home ? "vs" : "@"} ${logo(r.opp, 18)} ${r.opp}</td>
      <td class="num"${r.def ? heat(r.def.star, mLo, mHi) : ""}>${r.def ? fmt(r.def.star) : "--"}</td>
      <td class="num"${pf ? heat(pf, 0.9, 1.1) : ""} title="${pf ? `${r.opp} allows ${(POS_NAMES[p.pos] || p.pos).toLowerCase()} ${fmt(r.def.pos[p.pos])} PRA per 48 minutes` : ""}">${pf ? `${pf >= 1 ? "+" : ""}${Math.round((pf - 1) * 100)}%` : "--"}</td>
      <td class="num"${heat(r.game.total_line, tLo, tHi)}>${r.game.total_line ? fmt(r.game.total_line).replace(/\.0$/, "") : "--"}</td>
      <td class="num${blow ? " kotc-blowout" : ""}"${blow ? ' title="Blowout risk: stars can sit the 4th quarter"' : ""}>${signed(r.spread)}</td>
      ${payoutFit() ? `<td class="num kotc-est">${r.out ? "--" : moneyShort(estPay(r.lead))}</td>` : ""}
    </tr>`;
  };
  const more = live.length > TOP_ROWS
    ? `<button type="button" id="kotc-more" class="view-toggle-btn kotc-more">${showAll ? `Show top ${TOP_ROWS}` : `Show all ${live.length}`}</button>`
    : "";
  el("kotc-players").innerHTML = `<table class="data-table kotc-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${shown.map(row).join("")}${out.length ? `<tr class="kotc-group"><td colspan="${COLS.length}">Out tonight</td></tr>${out.map((r) => row(r, 0)).join("")}` : ""}</tbody>
    </table>${more}`;
}

// ---- a finished night: the pregame board against what happened ----
const PAST_COLS = [
  { key: "rank", label: "Pre", title: "His place on the board before the night's first tip (by Lead %)", value: (r) => r.rank },
  { key: "name", label: "Player", value: (r) => r.name },
  { key: "pra", label: "PRA", title: "What he had", value: (r) => r.pra },
  { key: "line", label: "P / R / A", sort: false },
  { key: "lead", label: "Lead %", title: "His chance to lead the night, before the first tip", value: (r) => r.lead },
  { key: "proj", label: "Proj", title: "His projected PRA, before the first tip", value: (r) => r.proj },
  { key: "opp", label: "Opp", value: (r) => r.opp || "" },
  { key: "paid", label: "Paid", title: "What DraftKings paid (or would have paid) each person on him, as logged", value: (r) => paidOn(r) },
];

function renderPast(date) {
  const night = past()[date];
  const rows = night.rows.slice();
  const best = night.best;
  el("kotc-capture-sub").textContent = `${dayWords(date, { weekday: "long", month: "long", day: "numeric" })} · ${night.games} game${night.games === 1 ? "" : "s"} · final`;
  if (!rows.length) {
    el("kotc-players").innerHTML = `<p class="no-data-note">Nothing recorded for this night.</p>`;
    return;
  }
  const col = PAST_COLS.find((c) => c.key === pastSort.key) || PAST_COLS[2];
  rows.sort((a, b) => {
    // Didn't play goes last whatever the sort.
    if ((a.pra === null) !== (b.pra === null)) return a.pra === null ? 1 : -1;
    const va = col.value(a), vb = col.value(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * pastSort.dir;
    const missing = pastSort.dir < 0 ? -Infinity : Infinity;
    return ((va ?? missing) - (vb ?? missing)) * pastSort.dir || (b.pra ?? -1) - (a.pra ?? -1);
  });
  const shown = showAll ? rows : rows.slice(0, TOP_ROWS);
  const [xLo, xHi] = range(rows.map((r) => r.pra));
  const leadMax = Math.max(...rows.map((r) => r.lead || 0), 0.0001);
  const [pLo, pHi] = range(rows.map((r) => r.proj));
  const head = PAST_COLS.map((c) => {
    const sorted = pastSort.key === c.key ? (pastSort.dir < 0 ? " &#9662;" : " &#9652;") : "";
    return c.sort === false ? `<th class="num">${c.label}</th>` : `<th class="koe-sort${c.key === "name" ? "" : " num"}" data-pastsort="${c.key}"${c.title ? ` title="${c.title}"` : ""}>${c.label}${sorted}</th>`;
  }).join("");
  const has = (x) => x !== null && x !== undefined;
  const body = shown.map((r) => {
    const won = has(r.pra) && r.pra === best;
    const paid = paidOn(r);
    return `<tr class="${won ? "kotc-won" : has(r.pra) ? "" : "kotc-out"}" data-player="${r.id}">
      <td class="num kotc-rank">${r.rank ?? ""}</td>
      <td class="kotc-player"><img src="${headshot(r.id)}" alt="" class="kotc-face" loading="lazy" onerror="this.style.visibility='hidden'"><span class="kotc-who"><b>${playerClick(r.id, r.name)}</b><span class="kotc-sub">${logo(r.team, 14)} ${r.team || ""}</span></span>${won ? `<span class="kotc-crown" title="Most PRA of the night">&#9733;</span>` : ""}${has(r.pra) ? "" : `<span class="gs-inj-status tier-bad">DNP</span>`}</td>
      <td class="num kotc-lead"${has(r.pra) ? heat(r.pra, xLo, xHi) : ""}>${r.pra ?? "--"}</td>
      <td class="num kotc-pra-line">${has(r.pra) ? `${r.pts} / ${r.reb} / ${r.ast}` : ""}</td>
      <td class="num"${has(r.lead) ? heat(r.lead, 0, leadMax) : ""}>${has(r.lead) ? `${(r.lead * 100).toFixed(r.lead < 0.1 ? 1 : 0)}%` : "--"}</td>
      <td class="num"${has(r.proj) ? heat(r.proj, pLo, pHi) : ""}>${fmt(r.proj)}</td>
      <td class="kotc-opp">${r.opp ? `${r.home ? "vs" : "@"} ${logo(r.opp, 18)} ${r.opp}` : ""}</td>
      <td class="num kotc-est">${has(paid) ? moneyShort(paid) : ""}</td>
    </tr>`;
  }).join("");
  const more = rows.length > TOP_ROWS
    ? `<button type="button" id="kotc-more" class="view-toggle-btn kotc-more">${showAll ? `Show top ${TOP_ROWS}` : `Show all ${rows.length}`}</button>`
    : "";
  el("kotc-players").innerHTML = `<table class="data-table kotc-table kotc-past-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

// ---- defense board ----
const TARGET_TOP = 100;
const TARGETS_PER_TEAM = 3;
const DEF_COLS = [
  { key: "team", label: "Team", value: (t) => t.abbr },
  { key: "tonight", label: "Tonight", value: (t) => t.opp || "" },
  ...[0, 1, 2, 3, 4].map((i) => ({ key: `b${i}`, bucket: i, value: (t) => t.d.buckets[i] })),
  { key: "star", label: "Top Opp", title: "The most PRA any one opponent had against them, average a game", value: (t) => t.d.star },
  ...POSITIONS.map((p) => ({ key: `pos${p}`, label: `vs ${p}`, title: `PRA per 48 minutes allowed to ${POS_NAMES[p].toLowerCase()}`, value: (t) => t.d.pos[p] })),
  { key: "games", label: "GP", value: (t) => t.d.games },
  { key: "targets", label: "Targets", title: `The other team's top ${TARGETS_PER_TEAM} on the player board by Lead % (of the night's top ${TARGET_TOP})`, value: (t) => t.targets.length },
];

function renderDefense() {
  const date = days()[dayIndex];
  const tonight = {};
  const b2b = new Set();
  const finished = isPast(date);
  // A finished night: its teams and pregame board; else tonight's slate.
  const nightRows = finished
    ? past()[date].rows.filter((r) => r.opp).map((r) => ({ ...r, out: false, lead: r.lead ?? 0, proj: r.proj ?? 0 }))
    : playerRows(date).map((r) => ({ ...r, name: r.p.name }));
  for (const r of nightRows) {
    tonight[r.team] = { opp: r.opp, home: r.home };
    if (r.b2b) b2b.add(r.team);
  }
  // Targets: each team's top 3 by Lead % (of the board's top 100), listed on the defense they face.
  const targets = {};
  nightRows.filter((r) => !r.out && (!finished || r.rank)).sort((a, b) => b.lead - a.lead || b.proj - a.proj).slice(0, TARGET_TOP)
    .forEach((r) => {
      const list = (targets[r.opp] = targets[r.opp] || []);
      if (list.length < TARGETS_PER_TEAM) list.push(r.name);
    });
  const rows = Object.entries(block().defense).map(([abbr, d]) => ({ abbr, d, opp: tonight[abbr] ? tonight[abbr].opp : null, home: tonight[abbr] && tonight[abbr].home, targets: targets[abbr] || [] }));
  const col = DEF_COLS.find((c) => c.key === defSort.key) || DEF_COLS[7];  // 7 = Top Opp
  rows.sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * defSort.dir;
    return ((va ?? -Infinity) - (vb ?? -Infinity)) * defSort.dir;
  });
  const hi = [0, 1, 2, 3, 4].map((i) => range(rows.map((t) => t.d.buckets[i])));
  const st = range(rows.map((t) => t.d.star));
  const pos = POSITIONS.map((p) => range(rows.map((t) => t.d.pos[p])));
  // Hiding the idle teams keeps the colors against all 30 (ranges above use every row).
  const hide = defPlayingOnly && Object.keys(tonight).length > 0;
  el("kotc-def-playing").textContent = defPlayingOnly ? "Show All Teams" : "Hide Teams Not Playing";
  el("kotc-def-sub").textContent = `${block().label}${finished ? " as of today" : ""} · ${date ? `teams playing ${dayWords(date)}${hide ? "" : " in bold"}` : ""}`;
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
      <td class="num"${heat(t.d.star, st[0], st[1], true)}><b>${fmt(t.d.star)}</b></td>
      ${POSITIONS.map((p, k) => `<td class="num"${heat(t.d.pos[p], pos[k][0], pos[k][1], true)}>${fmt(t.d.pos[p])}</td>`).join("")}
      <td class="num">${t.d.games}</td>
      <td class="kotc-targets">${t.targets.map((n) => `<span title="${n}">${n.split(" ").slice(1).join(" ") || n}</span>`).join(", ")}</td>
    </tr>`).join("");
  el("kotc-defense").innerHTML = `<table class="data-table kotc-table kotc-def-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- nightly leaders ----
function renderNights() {
  const nights = (block().nights || []).slice().reverse();
  const record = KOTC.record || {};
  if (!nights.length) {
    el("kotc-nights").innerHTML = `<p class="no-data-note">No finished nights yet this season.</p>`;
    return;
  }
  // A tie: every co-leader gets his own line (DraftKings splits the pool among them).
  const list = nights.slice(0, nightsShown).map((n) => {
    const board = (record[n.date] || {}).board;
    const tie = n.leaders.length > 1;
    const one = (l) => {
      const pre = board ? board.findIndex((b) => b.id === l.id) : -2;
      const preTag = pre >= 0 ? `<span class="koe-win-rank" title="His place on this page's board before the first tip">Pre ${pre + 1}</span>` : pre === -1 ? `<span class="koe-win-rank" title="Not in the board's top ${board.length}">Pre ${board.length}+</span>` : "<span></span>";
      const line = [l.total ? `O/U ${fmt(l.total).replace(/\.0$/, "")}` : null, l.spread !== null && l.spread !== undefined ? `${l.team} ${signed(l.spread)}` : null].filter(Boolean).join(" · ");
      const paid = paidOn(l, n.date);
      return `<div class="kotc-night-one" data-leader="${l.id}">
        <span class="koe-win-who">${logo(l.team, 18)}<span class="kotc-night-name"><span class="koe-win-names" title="${l.name}">${l.name}</span><span class="kotc-night-line" title="${l.pts} pts, ${l.reb} reb, ${l.ast} ast vs ${l.opp}${n.second ? `; next best ${n.second}` : ""}">${line}</span></span></span>
        ${preTag}
        <span class="kotc-night-paid" title="What DraftKings paid each person on him (logged)${tie ? "; a tie splits the pool" : ""}">${paid !== null ? moneyShort(paid) : ""}</span>
      </div>`;
    };
    return `<div class="kotc-night${tie ? " kotc-night-tie" : ""}">
      <span class="koe-win-date">${dayWords(n.date, { month: "numeric", day: "numeric" })}<small>${n.games} G</small>${tie ? `<span class="kotc-tag kotc-tie-tag" title="${n.leaders.length} players tied for the most PRA">Tie</span>` : ""}</span>
      <div class="kotc-night-who">${n.leaders.map(one).join("")}</div>
      <span class="koe-win-yds">${n.pra}</span>
    </div>`;
  });
  el("kotc-nights").innerHTML = list.join("") + (nights.length > nightsShown ? `<button type="button" id="kotc-nights-more" class="view-toggle-btn kotc-more">Show more</button>` : "");
}

// ---- Leader Trends (the owner, 2026-11-10) ----
// Every night's leader as a dot: Pregame Rank = games on the slate against where
// the board had him before the first tip; Spread & Total = his team's spread
// against his game's total. Co-leaders each get a dot (a tie counts half in the
// tiles); dots on the same spot merge into one bigger dot with the count in it.
let trendTab = "rank";
// Board rank steps on the site's 8-step scale (common.js RANK_SCALE; this page doesn't load common.js).
const TREND_STEPS = [[1, "1"], [3, "2-3"], [5, "4-5"], [10, "6-10"], [15, "11-15"], [25, "16-25"], [40, "26-40"], [Infinity, "41+"]];
const TREND_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const trendStep = (rank) => TREND_STEPS.findIndex(([hi]) => rank <= hi);
const stepFill = (i, alpha) => (i < 0 ? "" : scaleHsla(TREND_SCALE[i][0], 78, 44, alpha ?? TREND_SCALE[i][1]));
const stepEdge = (i) => (i < 0 ? "var(--border-strong)" : scaleHsla(TREND_SCALE[i][0], 78, 48));
// A how-often number on the same 8 steps: 100% = the greenest.
const rateStyle = (x) => (x === null ? "" : (([h, a]) => `background:${scaleHsla(h, 78, 44, a)};border-color:${scaleHsla(h, 78, 48)}`)(TREND_SCALE[Math.min(7, Math.floor((1 - x) * 8))]));

// One row per leader: rank = his place on the night's pregame board (the bottom
// "Off" row, top + 1, if he wasn't on it; null if that night has no board), off =
// that board's length when he wasn't on it, share = 1 / co-leaders.
function trendPoints() {
  const record = KOTC.record || {};
  const top = Math.max(0, ...Object.values(record).map((r) => (r.board || []).length)) || 60;
  const out = [];
  (block().nights || []).forEach((n) => n.leaders.forEach((l) => {
    const board = (record[n.date] || {}).board;
    const at = board ? board.findIndex((b) => b.id === l.id) : -2;
    out.push({ date: n.date, games: n.games, pra: n.pra, id: l.id, name: l.name, team: l.team, share: 1 / n.leaders.length,
      rank: at >= 0 ? at + 1 : at === -1 ? top + 1 : null, off: at === -1 ? board.length : null, total: l.total ?? null, spread: l.spread ?? null });
  }));
  return { points: out, top };
}

const preWords = (p) => (p.off !== null ? `Pre ${p.off}+ (not on the board)` : `Pre ${p.rank}`);

function trendChart(pts, opt) {
  const W = 440, H = 290, L = 46, R = 12, T = 12, B = 38;
  const x = (v) => L + ((v - opt.x[0]) / (opt.x[1] - opt.x[0])) * (W - L - R);
  const y = (v) => T + ((opt.yPos(v) - opt.yPos(opt.y[0])) / (opt.yPos(opt.y[1]) - opt.yPos(opt.y[0]))) * (H - T - B);
  const groups = new Map();
  pts.forEach((p) => {
    const k = `${opt.xOf(p)}|${opt.yOf(p)}`;
    groups.set(k, [...(groups.get(k) || []), p]);
  });
  const grid = opt.yTicks.map(([v, label]) => `<line class="kotc-tr-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="kotc-tr-tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${label}</text>`).join("")
    + opt.xTicks.map(([v, label]) => `<line class="kotc-tr-grid${v === opt.xZero ? " kotc-tr-zero" : ""}" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}"/><text class="kotc-tr-tick" x="${x(v)}" y="${H - B + 14}" text-anchor="middle">${label}</text>`).join("");
  // Bigger dots first, so a small one never hides under a big one.
  const dots = [...groups.values()].sort((a, b) => b.length - a.length).map((g) => {
    const p = g[0];
    const step = p.rank === null ? -1 : trendStep(p.rank);
    const r = Math.min(15, 6 + 3 * (g.length - 1));
    const tip = g.map((q) => `${dayWords(q.date, { month: "numeric", day: "numeric" })}: ${q.name}, ${q.pra} PRA, ${opt.tip(q)}`).join("\n");
    return `<g class="kotc-tr-dot" data-tip="${tip.replace(/"/g, "&quot;")}" data-n="${g.length}"><title>${tip}</title>
      <circle cx="${x(opt.xOf(p)).toFixed(1)}" cy="${y(opt.yOf(p)).toFixed(1)}" r="${r}" fill="${stepFill(step, 0.8) || "var(--panel-2)"}" stroke="${stepEdge(step)}"/>
      ${g.length > 1 ? `<text x="${x(opt.xOf(p)).toFixed(1)}" y="${(y(opt.yOf(p)) + 4).toFixed(1)}" text-anchor="middle">${g.length}</text>` : ""}</g>`;
  }).join("");
  return `<svg class="kotc-tr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.label}">${grid}
    <text class="kotc-tr-axis" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${opt.xTitle}</text>
    <text class="kotc-tr-axis" x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${opt.yTitle}</text>${dots}</svg>`;
}

// Three tiles under the chart: each a share of the nights (a tie splits its night).
function trendTiles(groups) {
  return `<div class="kotc-tr-tiles">${groups.map(([label, rows, hit, word]) => {
    const n = rows.reduce((a, p) => a + p.share, 0);
    const rate = n ? rows.filter(hit).reduce((a, p) => a + p.share, 0) / n : null;
    const nights = Number(n.toFixed(1)).toString();
    return `<div class="od-tile kotc-tr-tile"${rate === null ? "" : ` style="${rateStyle(rate)}"`} title="${rate === null ? "No nights yet" : `${word} on ${Math.round(rate * 100)}% of ${nights} night${n === 1 ? "" : "s"}`}">
      <span>${label}</span><b>${rate === null ? "--" : `${Math.round(rate * 100)}%`}</b><small>${word} · ${nights} Night${n === 1 ? "" : "s"}</small></div>`;
  }).join("")}</div>`;
}

function renderTrends() {
  const box = el("kotc-trends");
  if (!box) return;
  const { points, top } = trendPoints();
  el("kotc-trend-tabs").innerHTML = [["rank", "Pregame Rank"], ["lines", "Spread & Total"]]
    .map(([k, t]) => `<button type="button" class="${k === trendTab ? "on" : ""}" data-kotc-trend="${k}">${t}</button>`).join("");
  const legend = `<div class="kotc-tr-legend"><span>Pregame Rank</span>${TREND_STEPS.map(([hi, label], i) => `<i style="background:${stepFill(i, 0.8)};border-color:${stepEdge(i)}">${label}</i>`).join("")}</div>`;
  const read = `<p id="kotc-tr-read" class="kotc-tr-read">Hover or tap a dot</p>`;
  if (trendTab === "rank") {
    const pts = points.filter((p) => p.rank !== null);
    if (!pts.length) return (box.innerHTML = `<p class="no-data-note">No pregame boards saved yet.</p>`);
    const most = Math.max(15, ...pts.map((p) => p.games));
    const ticks = [1, 5, 10, 20, 30, 40].filter((v) => v < top).map((v) => [v, v]).concat([[top + 1, "Off"]]);
    box.innerHTML = trendChart(pts, {
      label: "Each night's leader: games that night against his pregame rank",
      x: [0.5, most + 0.5], xOf: (p) => p.games, xTicks: Array.from({ length: most }, (_, i) => [i + 1, i + 1]), xTitle: "Games That Night",
      // Square-root scale: room at the top, where the board's best picks sit.
      y: [1, top + 1], yOf: (p) => p.rank, yPos: Math.sqrt, yTicks: ticks, yTitle: "Pregame Rank",
      tip: (p) => `${p.games} games, ${preWords(p)}`,
    }) + legend + trendTiles([
      ["1-5 Games", pts.filter((p) => p.games <= 5)],
      ["6-10 Games", pts.filter((p) => p.games >= 6 && p.games <= 10)],
      ["11+ Games", pts.filter((p) => p.games >= 11)],
    ].map(([label, rows]) => [label, rows, (p) => p.rank <= 5, "Top 5"])) + read;
    return;
  }
  const pts = points.filter((p) => p.spread !== null && p.total !== null);
  if (!pts.length) return (box.innerHTML = `<p class="no-data-note">No lines saved yet.</p>`);
  const reach = Math.max(15, Math.ceil(Math.max(...pts.map((p) => Math.abs(p.spread))) / 5) * 5);
  const lo = Math.floor(Math.min(...pts.map((p) => p.total)) / 5) * 5 - 5;
  const hi = Math.ceil(Math.max(...pts.map((p) => p.total)) / 5) * 5 + 5;
  const step = hi - lo > 40 ? 10 : 5;
  box.innerHTML = trendChart(pts, {
    label: "Each night's leader: his team's spread against his game's total",
    x: [-reach, reach], xOf: (p) => p.spread, xZero: 0, xTicks: Array.from({ length: (2 * reach) / 5 + 1 }, (_, i) => -reach + 5 * i).map((v) => [v, v === 0 ? "PK" : v > 0 ? `+${v}` : v]),
    xTitle: "Favored  ←  His Team's Spread  →  Underdog",
    y: [hi, lo], yOf: (p) => p.total, yPos: (v) => -v, yTicks: Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + step * i).map((v) => [v, v]), yTitle: "Game Total",
    tip: (p) => `${p.team} ${signed(p.spread)}, O/U ${fmt(p.total).replace(/\.0$/, "")}${p.rank === null ? "" : `, ${preWords(p)}`}`,
  }) + legend + trendTiles([
    ["Favored By 5+", (p) => p.spread <= -5],
    ["Within 5", (p) => p.spread > -5 && p.spread < 5],
    ["Underdog By 5+", (p) => p.spread >= 5],
  ].map(([label, hit]) => [label, pts, hit, "Of Leaders"])) + read;
}

// ---- Historical Data ----
function renderHistory() {
  // This season only (the owner, 2026-10-23: last season's reference numbers came off).
  const b = block();
  const sum = b.summary;
  el("kotc-hist-season").textContent = `${b.label}, ${sum.nights} night${sum.nights === 1 ? "" : "s"}`;
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
        <table class="kotc-hist-table"><thead><tr><th>Position</th><th>Nights</th><th>Share</th></tr></thead><tbody>${POSITIONS.map((k) => [k, POS_NAMES[k]]).map(([k, n]) => `<tr><td>${n}</td><td>${fmt(sum.positions[k], 1).replace(/\.0$/, "")}</td><td>${pct(sum.positions[k] / posTotal)}</td></tr>`).join("")}</tbody></table></div>
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
  el("kotc-note").hidden = false;
  el("kotc-note").textContent = isPast(all[dayIndex])
    ? "A finished night: the board as it stood before the first tip (Pre, Lead %, Proj) against what each player had."
    : `${block().label} numbers only: ${block().games} games so far.`;
  renderPlayers();
  renderDefense();
  renderNights();
  renderTrends();
  renderPayoutForm();
}

// ---- payouts ----
// After each night DraftKings shows what a few players paid (or would have
// paid) each person on them; the pool is split evenly among everyone on the
// winner, so pool / paid = about how many people were on him. The owner pastes
// that list (/api/court-payouts, D1). With enough logged, paid / pool is fit
// against each player's pregame Lead % (a straight line in logs: favorites
// are on more entries, so they pay less), and the board shows Est Pay.
let PAYOUTS = {};
const FIT_MIN = 6;  // logged payouts with a pregame Lead % before Est Pay shows
const plainName = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const moneyShort = (n) => (n === null || n === undefined ? "--" : n >= 10000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : money(n));
function paidOn(r, date = days()[dayIndex]) {
  const logged = PAYOUTS[date];
  if (!logged || !r) return null;
  const p = logged.payouts.find((x) => (x.id && r.id ? String(x.id) === String(r.id) : plainName(x.name) === plainName(r.name)));
  return p ? p.paid : null;
}
let fitCache;
function payoutFit() {
  if (fitCache !== undefined) return fitCache;
  const pts = [];
  let pool = null;
  for (const date of Object.keys(PAYOUTS).sort()) {
    const night = past()[date];
    const logged = PAYOUTS[date];
    if (!night || !logged.pool) continue;
    pool = logged.pool;
    const tied = night.rows.filter((x) => x.pra !== null && x.pra === night.best).length > 1;
    for (const p of logged.payouts) {
      const r = night.rows.find((x) => String(x.id) === String(p.id));
      // A tied winner was paid from a split pool, so his number says nothing about how many were on him alone.
      if (tied && r && r.pra === night.best) continue;
      if (r && r.lead > 0 && p.paid > 0) pts.push([Math.log(r.lead), Math.log(p.paid / logged.pool)]);
    }
  }
  if (pts.length < FIT_MIN) return (fitCache = null);
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const b = sxx ? pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx : 0;
  return (fitCache = { a: my - b * mx, b, n: pts.length, pool });
}
function estPay(lead) {
  const f = payoutFit();
  if (!f || !lead) return null;
  return f.pool * Math.exp(f.a) * lead ** f.b;
}
// A pasted name to one of the night's players: the whole name with accents
// dropped, else a last name only one of them has.
function matchPlayer(name, rows) {
  const want = plainName(name);
  const exact = rows.find((r) => plainName(r.name) === want);
  if (exact) return exact;
  const last = want.split(" ").pop();
  const hits = rows.filter((r) => plainName(r.name).split(" ").pop() === last);
  return hits.length === 1 ? hits[0] : null;
}
// DraftKings' list, one player a line: "Nikola Jokic - $140 in Bonus Bets".
function parsePayouts(text, rows) {
  const read = [];
  const missed = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    const name = raw.slice(0, m.index).replace(/^[^\p{L}]+/u, "").replace(/[\s\-–—:|=]+$/, "").trim();
    if (!name) continue;
    const r = matchPlayer(name, rows);
    if (r) read.push({ id: r.id, name: r.name, paid: Math.round(Number(m[1].replace(/,/g, ""))) });
    else missed.push(name);
  }
  return { read, missed };
}
// The owner's box (html.is-owner, and on localhost; the server checks again).
function renderPayoutForm() {
  const pick = el("kotc-log-date");
  const nights = Object.keys(past()).filter((d) => past()[d].best !== null).sort().reverse();
  el("kotc-log").hidden = !nights.length;
  const keep = isPast(days()[dayIndex]) ? days()[dayIndex] : pick.value || nights[0];
  pick.innerHTML = nights.map((d) => `<option value="${d}">${dayWords(d)}</option>`).join("");
  if (nights.includes(keep)) pick.value = keep;
  if (pick.dataset.filled !== pick.value) fillPayoutForm();
  const f = payoutFit();
  const logged = Object.values(PAYOUTS).reduce((a, d) => a + d.payouts.length, 0);
  el("kotc-fit").innerHTML = f
    ? `<b>Est Pay</b> is on the board: fit from ${f.n} logged payouts against each player's pregame Lead %, at a ${moneyShort(f.pool)} pool. A 10% player pays about ${moneyShort(estPay(0.1))}, a 2% player about ${moneyShort(estPay(0.02))}.`
    : `${logged} payout${logged === 1 ? "" : "s"} logged. <b>Est Pay</b> joins the board once ${FIT_MIN} are in for players who were on the pregame board.`;
}
function fillPayoutForm() {
  const pick = el("kotc-log-date");
  const logged = PAYOUTS[pick.value];
  const lastPool = Object.keys(PAYOUTS).sort().map((d) => PAYOUTS[d].pool).filter(Boolean).pop();
  const pool = (logged && logged.pool) || lastPool;
  el("kotc-log-pool").value = pool ? pool.toLocaleString("en-US") : "";
  el("kotc-log-text").value = logged ? logged.payouts.map((p) => `${p.name} - ${money(p.paid)}`).join("\n") : "";
  pick.dataset.filled = pick.value;
  checkPayoutForm();
}
function payoutFormRead() {
  const night = past()[el("kotc-log-date").value];
  return night ? parsePayouts(el("kotc-log-text").value, night.rows) : { read: [], missed: [] };
}
const poolTyped = () => Math.round(Number(el("kotc-log-pool").value.replace(/[^\d.]/g, ""))) || 0;
function checkPayoutForm() {
  const { read, missed } = payoutFormRead();
  const pool = poolTyped();
  const status = el("kotc-log-status");
  status.className = `kotc-log-status${missed.length || !pool ? " kotc-log-bad" : read.length ? " kotc-log-good" : ""}`;
  status.textContent = missed.length
    ? `Not on that night's list: ${missed.join(", ")}`
    : !pool ? "Type the prize pool" : read.length ? `✓ ${read.length} player${read.length === 1 ? "" : "s"} matched` : "Paste DraftKings' list: one player and $ amount a line";
  el("kotc-log-save").disabled = !!missed.length || !pool;
}
async function savePayouts() {
  const btn = el("kotc-log-save");
  const date = el("kotc-log-date").value;
  const pool = poolTyped();
  const { read, missed } = payoutFormRead();
  if (missed.length || !pool) return;
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const res = await fetch("/api/court-payouts", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, pool, payouts: read }) });
    if (!res.ok) throw new Error(String(res.status));
    if (read.length) PAYOUTS[date] = { pool, payouts: read };
    else delete PAYOUTS[date];
    fitCache = undefined;
    btn.textContent = "Saved";
    render();
  } catch (e) {
    btn.textContent = "Couldn't save";
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save";
  }, 2000);
}
function loadPayouts() {
  return fetch("/api/court-payouts", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.days ? d.days : {}))
    .catch(() => ({}));
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

// Leader Trends: hovering a dot names it under the chart (a tap does the same, in the click handler).
document.addEventListener("mouseover", (e) => {
  const dot = e.target.closest && e.target.closest(".kotc-tr-dot");
  if (dot && el("kotc-tr-read")) el("kotc-tr-read").textContent = dot.dataset.tip;
});

document.addEventListener("click", (e) => {
  if (!KOTC) return;
  if (e.target.closest("#kotc-day-prev")) return (dayIndex = Math.max(0, dayIndex - 1)), (showAll = false), render();
  if (e.target.closest("#kotc-day-next")) return (dayIndex = Math.min(days().length - 1, dayIndex + 1)), (showAll = false), render();
  if (e.target.closest("#kotc-log-save")) return savePayouts();
  if (e.target.closest("#kotc-more")) return (showAll = !showAll), renderPlayers();
  if (e.target.closest("#kotc-nights-more")) return (nightsShown += 30), renderNights();
  if (e.target.closest("#kotc-save")) return saveImage("kotc-save", "kotc-capture", "king-of-the-court");
  if (e.target.closest("#kotc-def-playing")) return (defPlayingOnly = !defPlayingOnly), renderDefense();
  if (e.target.closest("#kotc-def-save")) return saveImage("kotc-def-save", "kotc-def-capture", "kotc-defense");
  if (e.target.closest("#kotc-trend-save")) return saveImage("kotc-trend-save", "kotc-trend-capture", "kotc-trends");
  const tab = e.target.closest("[data-kotc-trend]");
  if (tab) return (trendTab = tab.dataset.kotcTrend), renderTrends();
  const dot = e.target.closest(".kotc-tr-dot");
  if (dot && el("kotc-tr-read")) el("kotc-tr-read").textContent = dot.dataset.tip;
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
  const psort = e.target.closest("[data-pastsort]");
  if (psort) {
    const key = psort.dataset.pastsort;
    Object.assign(pastSort, pastSort.key === key ? { dir: -pastSort.dir } : { key, dir: key === "name" || key === "opp" || key === "rank" ? 1 : -1 });
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
document.addEventListener("input", (e) => {
  if (e.target.id === "kotc-log-text" || e.target.id === "kotc-log-pool") checkPayoutForm();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "kotc-log-date") fillPayoutForm();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("kotc-history-modal").hidden) el("kotc-history-modal").hidden = true;
});

Promise.all([fetch("data.json").then((r) => r.json()), loadPayouts()])
  .then(([data, payouts]) => {
    PAYOUTS = payouts;
    DATA = data;
    KOTC = data.kotc;
    el("empty-state").hidden = true;
    if (!KOTC || !KOTC.seasons || !KOTC.seasons[KOTC.default]) {
      el("empty-state").hidden = false;
      el("empty-state").innerHTML = "<p>King of the Court isn't available right now. Check back after the next update.</p>";
      return;
    }
    season = KOTC.default;
    const today = new Date().toLocaleDateString("en-CA");
    const all = days();
    // Tonight (or the next night with games); with none ahead, the last finished one.
    const next = all.findIndex((d) => d >= today);
    dayIndex = next >= 0 ? next : Math.max(0, all.length - 1);
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
