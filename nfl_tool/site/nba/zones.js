// GMG NBA Suite: Zone Matchup Targets (the owner, 2026-10-27: "If we can develop a
// system that uses all the components we have data for to determine how teams
// will allow other teams to beat them ... THIS is the tool I want to create").
// Each player with a points / threes line tonight: where and how he shoots
// against what tonight's defense allows players like him (guards / forwards /
// bigs) from those spots. The reads are built in nfl_tool/nba/zone_matchups.py
// (shots.json `matchups`); this page lists them (Best & Worst Spots, Matchup
// View) and opens both shot charts for a player. RAW numbers, nothing pulled
// toward the league (NBA_SHOT_PRIOR = 0 here). No EV (the owner, 2026-10-28: not
// "calculate ev based on an artform"); the record grades W / L and in units at the best price at tip. Loads before shot-chart.js / nba-card.js. Every name starts zm / ZM.

let DATA = null; // data.json: teams, schedule; the player card reads it too
let ZF = null; // shots.json
const ZM_KEY = "nba-tool.zones.v1"; // display prefs on this device: view, market, his-shots filter
const ZM = { day: 0, strongOnly: false, view: "spots", market: "points", min: 0, game: null, player: null, all: false, chart: "zones", kind: "all", grid: "make" };
const ZM_GROUP = { G: "Guards", F: "Forwards", C: "Bigs" };
const ZM_ZONE = { ra: "At The Rim", paint: "Paint", mBL: "Left Baseline Mid", mWL: "Left Wing Mid", mT: "Top Mid", mWR: "Right Wing Mid", mBR: "Right Baseline Mid", c3L: "Left Corner 3", w3L: "Left Wing 3", t3: "Top 3", w3R: "Right Wing 3", c3R: "Right Corner 3" };
const ZM_KIND = { 1: "Self-Created", 2: "Catch & Shoot", 3: "Drives & Cuts" };
const ZM_TOP = 15;

const zmEl = (id) => document.getElementById(id);
const zmM = () => (ZF && ZF.matchups) || null;
const zmTeam = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const zmLogo = (abbr, size = 20) => (abbr && zmTeam(abbr).logo ? `<img src="${zmTeam(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
function zmRgb(abbr) {
  const hex = zmTeam(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
const zmBanner = (abbr, inner) => `<div class="nba-box-title shc-title" style="background:rgba(${zmRgb(abbr)},0.22);border-left:4px solid rgb(${zmRgb(abbr)})">${zmLogo(abbr, 24)}${inner}</div>`;
const zmPct = (v, digits = 0) => (v === null || v === undefined ? "--" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);
const zmPts = (v) => (v === null || v === undefined ? "--" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`);
// The site's red-to-green scale (the owner, 2026-10-27: the full Green / Red scale, "less on only
// shades of green and red"): red hurts the shooter, yellow about even, green helps; the end colors at
// `full` (25% for a score). Through nbaShotColor / scaleHsla, so the member's color set applies.
function zmShade(v, full, alpha = 0.5) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return nbaShotColor(Math.max(-1, Math.min(1, v / full)) * NBA_SHOT_FULL, alpha);
}
// The read in words, Matchup View only (the owner: "it was helpful there"). Too few shots (his, or the
// defense's against his group) is Small Sample, never a read (zone_matchups.py MIN_SHOTS).
const zmReadWord = (r) => (r.thin ? "Small Sample" : r.side === "toss" ? "Toss Up" : `${r.strong ? "Strong " : ""}${r.side === "over" ? "Over" : "Under"}`);
const zmGame = (id) => (zmM().games || []).find((g) => g.game_id === id) || null;
const zmWord = (r) => (r.side === "over" ? "OVER" : r.side === "under" ? "UNDER" : "TOSS UP");

// A zone's Shots and Makes together for him (the score's own rule, zone_matchups.py zone_effect): + helps,
// - hurts. The Shots part counts at most double the league's (VOL_CAP: one small spot can't carry him).
const zmVol = (z) => Math.min(z.vol || 0, (zmM() && zmM().vol_cap) || 1);
const zmZoneEffect = (z) => (z.vol === null && z.fg === null ? null : (1 + zmVol(z)) * (1 + (z.fg !== null && z.lg ? z.fg / z.lg : 0)) - 1);
const zmKindEffect = (k) => (k.fg !== null && k.lg ? k.fg / k.lg : null);
const zmMakeRate = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : "--");
const zmLgRate = (lg) => (lg === null || lg === undefined ? "--" : `${Math.round(lg * 100)}%`);
const zmMakesWords = (fg) => (fg === null ? "" : ` That's ${Math.abs(Math.round(fg * 100))} points ${fg >= 0 ? "MORE makes: helps him" : "FEWER makes: hurts him"}.`);
// The hover: what each number means, in words, and which way it points for him.
function zmZoneWhy(p, z) {
  const g = ZM_GROUP[p.group].toLowerCase();
  const lines = [`${Math.round(z.share * 100)}% of his ${ZM.market === "threes" ? "threes" : "shots"} come from here (${z.n}).`];
  if (z.dtried) lines.push(`Makes: ${p.opp} has let ${g} make ${z.dmade} of ${z.dtried} here (${zmMakeRate(z.dmade, z.dtried)}); league ${g} make ${zmLgRate(z.lg)}.${zmMakesWords(z.fg)}`);
  else lines.push(`Makes: ${p.opp} hasn't faced a shot by ${g} here yet.`);
  if (z.vol !== null) lines.push(`Shots: ${g} take ${Math.abs(Math.round(z.vol * 100))}% ${z.vol >= 0 ? "MORE" : "FEWER"} of their shots here against ${p.opp} than against the league: ${z.vol >= 0 ? "more chances, helps him" : "fewer chances, hurts him"}.`);
  const e = zmZoneEffect(z);
  if (e !== null) lines.push(`Together: ${zmPct(e)} for him here.`);
  return lines.join("\n");
}
function zmKindWhy(p, k) {
  const g = ZM_GROUP[p.group].toLowerCase();
  const head = `${Math.round(k.share * 100)}% of his ${ZM.market === "threes" ? "threes" : "shots"} are ${ZM_KIND[k.k]} (${k.n}).`;
  if (!k.dtried) return `${head}\n${p.opp} hasn't faced one by ${g} yet.`;
  return `${head}\nMakes: ${p.opp} has let ${g} make ${k.dmade} of ${k.dtried} of these (${zmMakeRate(k.dmade, k.dtried)}); league ${g} ${zmLgRate(k.lg)}.${zmMakesWords(k.fg)}`;
}
// Why he's surfaced, in a few words (the owner, 2026-10-30: the percentages and spots "don't really do
// much for me or the users ... something like '3s volume' or 'Self Creates'", one row): his areas (15%+
// of his shots) and shot types (25%+) that this defense moves 5%+ either way, the biggest first (his
// share x how much it moves him). Volume / Makes = which part moves it. Color = for him (green helps, red
// hurts: a red tag on an Over is the counterpoint); the numbers are in the hover.
const ZM_AREAS = {
  points: [["Rim", ["ra"]], ["Paint", ["paint"]], ["Mid-Range", ["mBL", "mWL", "mT", "mWR", "mBR"]], ["Corner 3s", ["c3L", "c3R"]], ["Above-Break 3s", ["w3L", "w3R", "t3"]]],
  threes: [["Corner 3s", ["c3L", "c3R"]], ["Wing 3s", ["w3L", "w3R"]], ["Top 3s", ["t3"]]],
};
const ZM_KIND_TAG = { 1: "Self Creates", 2: "Catch & Shoot", 3: "Drives & Cuts" };
function zmDiet(p, r) {
  const even = (zmM() && zmM().even) || 0.05;
  const tags = [];
  ZM_AREAS[ZM.market].forEach(([name, keys]) => {
    const zs = r.zones.filter((z) => keys.includes(z.z) && zmZoneEffect(z) !== null);
    const share = zs.reduce((t, z) => t + z.share, 0);
    if (share < 0.15) return;
    const avg = (f) => zs.reduce((t, z) => t + z.share * f(z), 0) / share;
    const effect = avg(zmZoneEffect);
    const vol = avg(zmVol);
    const makes = avg((z) => (z.fg !== null && z.lg ? z.fg / z.lg : 0));
    const head = `${Math.round(share * 100)}% of his ${ZM.market === "threes" ? "threes" : "shots"}. Together: ${zmPct(effect)} for him.`;
    const why = [head, ...zs.map((z) => `${ZM_ZONE[z.z]}: ${zmZoneWhy(p, z)}`)].join("\n\n");
    tags.push({ label: `${name} ${Math.abs(vol) >= Math.abs(makes) ? "Volume" : "Makes"}`, share, effect, why });
  });
  r.kinds.forEach((k) => {
    const effect = zmKindEffect(k);
    if (k.share >= 0.25 && effect !== null) tags.push({ label: ZM_KIND_TAG[k.k], share: k.share, effect, why: zmKindWhy(p, k) });
  });
  return tags
    .filter((t) => Math.abs(t.effect) >= even)
    .sort((a, b) => b.share * Math.abs(b.effect) - a.share * Math.abs(a.effect))
    .map((t) => `<span class="zm-chip" style="background:${zmShade(t.effect, 0.3, 0.45)}" title="${t.why.replace(/"/g, "&quot;")}">${t.label}</span>`)
    .join("");
}
// The main line (the player card's rule: the line most books hang) and the best price on the read's
// side across the member's books, live from data.json's odds; a click shows every book. Falls back to
// the build's line.
function zmPrice(id, p, r) {
  const g = zmGame(p.game_id);
  const spec = { kind: "prop", team: p.team, pid: id, stat: ZM.market, game: g ? `${g.away}_${g.home}` : undefined, title: `${p.name} &middot; ${ZM.market === "threes" ? "3-Pointers Made" : "Points"}`, sub: g ? `${g.away} @ ${g.home}` : "" };
  const quotes = typeof bookQuotes === "function" ? bookQuotes(spec) : [];
  const line = quotes.length && typeof nbaCardMainLine === "function" ? nbaCardMainLine(quotes) : r.line;
  if (line === null || line === undefined) return { line: "--", price: "--" };
  const side = r.side === "under" ? "u" : "o";
  const best = quotes.length ? bookBest(quotes, side, line) : null;
  const price = best ? `<button type="button" class="bo-pill zm-price" data-bo="${boEnc({ ...spec, side, line })}" title="Best price across your books. Click for every book.">${boOdds(best[3])}</button>` : "--";
  return { line: `${side}${line}`, price };
}

function zmRows(filter) {
  const m = zmM();
  return Object.entries(m.players)
    .map(([id, p]) => ({ id, p, r: p[ZM.market] }))
    .filter((x) => x.r && x.r.n >= ZM.min && (!filter || filter(x)));
}
function zmTable(rows, opts = {}) {
  if (!rows.length) return `<p class="no-data-note">No players here with these filters.</p>`;
  const body = rows
    .map(({ id, p, r }) => {
      const g = zmGame(p.game_id);
      const { line, price } = zmPrice(id, p, r);
      return `<tr class="zm-row${id === ZM.player ? " selected" : ""}${g && g.started ? " zm-started" : ""}" data-player="${id}">
        <td class="zm-name">${zmLogo(p.team, 18)} ${playerClick(id, p.name)} <small>${p.pos || ZM_GROUP[p.group]}</small></td>
        ${opts.noVs ? "" : `<td>${zmLogo(p.opp, 18)}</td>`}
        ${opts.read ? `<td><span class="zm-read" style="background:${zmShade(r.score, 0.25)}">${zmReadWord(r)}</span></td>` : ""}
        <td class="num" style="background:${zmShade(r.score, 0.25)}" title="${zmWord(r)}"><b>${zmPct(r.score)}</b></td>
        <td class="num" style="background:${zmShade(r.shots, 0.25)}">${zmPct(r.shots)}</td>
        <td class="num" style="background:${zmShade(r.makes, 0.25)}">${zmPct(r.makes)}</td>
        <td class="num zm-line">${line}</td>
        <td class="num">${price}</td>
        <td class="zm-diet"><div class="zm-tags">${zmDiet(p, r)}</div></td>
        <td class="num zm-n" title="His ${ZM.market === "threes" ? "threes" : "shots"} this season / the shots this defense has allowed ${ZM_GROUP[p.group].toLowerCase()}">${r.n} / ${r.dn}</td>
      </tr>`;
    })
    .join("");
  return `<div class="shc-scroll"><table class="data-table zm-table"><thead><tr>
    <th>Player</th>${opts.noVs ? "" : "<th>Vs</th>"}${opts.read ? '<th title="Strong past 12%, Toss Up inside 5%">Read</th>' : ""}
    <th class="num" title="Shots and Makes together: green = Over, red = Under, deeper = stronger">Score</th>
    <th class="num" title="How much more of his group's shooting this defense gives up from his spots than the league does (more chances)">Shots</th>
    <th class="num" title="How much more his kind of shots go in against this defense, from his zones and shot types">Makes</th>
    <th class="num" title="The line most books hang, on the read's side">Line</th>
    <th class="num" title="The best price on that side across your books (click for every book). No EV from us.">Odds</th>
    <th title="Where and how he shoots that this defense moves the most, biggest first. Volume = more / fewer of those shots, Makes = more / fewer go in. Green = helps him, red = hurts (the counterpoint). Hover a tag for the numbers.">Why</th>
    <th class="num" title="His shots this season / shots this defense allowed his group">Sample</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}
// Tags fill one line (zones.css .zm-tags), the same box on every row; the ones that don't fit fold into a
// "+N" pill naming them on hover (sim-board.js fitTags, the site's table rule).
function zmFitTags() {
  document.querySelectorAll(".zm-tags").forEach((box) => {
    box.querySelectorAll(".zm-more").forEach((m) => m.remove());
    const tags = [...box.children];
    tags.forEach((t) => (t.hidden = false));
    if (box.scrollHeight <= box.clientHeight + 1) return;
    const more = document.createElement("span");
    more.className = "zm-chip zm-more";
    box.appendChild(more);
    let shown = tags.length;
    while (shown > 0) {
      shown -= 1;
      tags[shown].hidden = true;
      const rest = tags.slice(shown);
      more.textContent = `+${rest.length}`;
      more.title = rest.map((t) => `${t.textContent.trim()}: ${t.title}`).join("\n\n");
      if (box.scrollHeight <= box.clientHeight + 1) break;
    }
  });
}
window.addEventListener("resize", () => {
  clearTimeout(zmFitTags.wait);
  zmFitTags.wait = setTimeout(zmFitTags, 120);
});

function zmSpots() {
  const live = (x) => !(zmGame(x.p.game_id) || {}).started;
  const best = zmRows((x) => live(x) && x.r.side === "over").sort((a, b) => b.r.score - a.r.score);
  const worst = zmRows((x) => live(x) && x.r.side === "under").sort((a, b) => a.r.score - b.r.score);
  const cut = (list) => (ZM.all ? list : list.slice(0, ZM_TOP));
  const more = best.length > ZM_TOP || worst.length > ZM_TOP ? `<button type="button" class="view-toggle-btn zm-all">${ZM.all ? "Show Top 15" : "Show All"}</button>` : "";
  return `<p class="zm-legend">Green helps him, yellow is about even, red hurts. A red tag on an Over (or green on an Under) is the counterpoint: hover any tag for the numbers in words.</p><div class="zm-spots">
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-over">Best Spots &middot; Overs <span>${best.length}</span></div>${zmTable(cut(best))}</div>
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-under">Worst Spots &middot; Unders <span>${worst.length}</span></div>${zmTable(cut(worst))}</div>
    </div>${more}`;
}

// ---- the defense grid (the owner, 2026-10-27: "a color coded layout/chart where i can know 'this is
// BOS weakness vs this position'"): the five positions down, where / how they shoot across (the
// market's columns), each cell the defense's rank of 30 (30th = gives up the most), red = gives up the
// most, green = takes it away; Overall at the end; each row's worst spot outlined. Makes / Shots /
// Points Per Shot toggle. Raw counts on hover. ----
const ZM_POS = ["PG", "SG", "SF", "PF", "C"];
const ZM_POS_NAME = { PG: "Point Guards", SG: "Shooting Guards", SF: "Small Forwards", PF: "Power Forwards", C: "Centers" };
const ZM_METRIC = { make: ["Makes", 3, "make rate allowed"], share: ["Shots", 4, "share of shots allowed"], pps: ["Points Per Shot", 5, "points a shot allowed"] };
// A rank of 30 as a color: 30th (gives up the most) red, 1st green (the defense charts' sides).
const zmRankShade = (rank, teams) => (rank ? nbaShotColor(-(((rank - 1) / Math.max(1, teams - 1)) * 2 - 1) * NBA_SHOT_FULL, 0.5) : "");
function zmGridWhy(abbr, p, label, c, lg, metric) {
  const name = ZM_POS_NAME[p];
  const rate = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : "--");
  const where = label === "Overall" ? "overall" : label.match(/Self|Catch|Drives/) ? `on ${label} shots` : `from ${label}`;
  if (!c[1]) return `${name} haven't shot ${where} against ${abbr} yet.`;
  const lines = [`${name} made ${c[0]} of ${c[1]} ${where} against ${abbr} (${rate(c[0], c[1])}); league ${name.toLowerCase()} ${rate(lg[0], lg[1])}.`];
  if (label === "Overall") lines.push(`${Math.round(c[2] * 100)}% of the shots ${abbr} allows are by ${name.toLowerCase()} (league ${Math.round(lg[2] * 100)}%).`);
  else lines.push(`${Math.round(c[2] * 100)}% of ${name.toLowerCase()}' shots against ${abbr} come ${where.replace(/^from |^on /, label.match(/Self|Catch|Drives/) ? "as " : "from ")} (league ${Math.round(lg[2] * 100)}%).`);
  lines.push(`Ranks of 30 (30th = gives up the most): makes ${c[3] || "--"}, shots ${c[4] || "--"}, points per shot ${c[5] || "--"}.`);
  return lines.join("\n");
}
function zmGrid(abbr) {
  const gr = zmM().grid;
  const d = gr && gr.teams[abbr] && gr.teams[abbr][ZM.market];
  if (!d) return "";
  const teams = Object.keys(gr.teams).length;
  const cols = gr.cols[ZM.market];
  const [, at] = ZM_METRIC[ZM.grid];
  const lg = gr.league[ZM.market];
  // The columns in their groups (the owner, 2026-10-28: Rim / Paint / Mid, Corner / Wing / Top, the
  // shot types), each group boxed under its own header with a gap between, then Overall alone.
  const groups = [];
  cols.forEach(([k, label, g]) => {
    const last = groups[groups.length - 1];
    if (last && last.name === (g || "")) last.cols.push([k, label]);
    else groups.push({ name: g || "", cols: [[k, label]] });
  });
  groups.push({ name: "", cols: [["all", "Overall"]], overall: true });
  // Each group sits on its own tint (the owner, 2026-10-28: "background shading grouping"): every cell
  // of a group (header, labels, ranks) carries zm-g<i>, the rank is a tile inside it, ends rounded.
  const edge = (grp, i) => `zm-g${groups.indexOf(grp)}${i === 0 ? " zm-gl" : ""}${i === grp.cols.length - 1 ? " zm-gr" : ""}`;
  const gap = `<td class="zm-ggap"></td>`;
  const rows = ZM_POS.map((p) => {
    const worst = cols.reduce((best, [k]) => ((d[p][k][at] || 0) > ((d[p][best] || [])[at] || 0) ? k : best), cols[0][0]);
    const cell = (k, label, cls) => {
      const c = d[p][k];
      const rank = c[at];
      const why = zmGridWhy(abbr, p, label, c, lg[p][k], ZM.grid).replace(/"/g, "&quot;");
      const shade = zmRankShade(rank, teams);
      return `<td class="num zm-gcell ${cls}${k === worst && rank ? " zm-worst" : ""}" title="${why}"><div class="zm-gtile"${shade ? ` style="background:linear-gradient(${shade},${shade}),var(--panel-2)"` : ""}>${rank ? `${rank}${zmOrd(rank)}` : "--"}<small>${c[1]}</small></div></td>`;
    };
    return `<tr><th class="zm-gpos" title="${ZM_POS_NAME[p]}">${p}</th>${groups.map((grp) => gap + grp.cols.map(([k, label], i) => cell(k, label, edge(grp, i))).join("")).join("")}</tr>`;
  }).join("");
  const colgroup = `<colgroup><col class="zm-gpos-col">${groups.map((grp) => `<col class="zm-ggap-col">${grp.cols.map(() => "<col>").join("")}`).join("")}</colgroup>`;
  const gapTh = `<th class="zm-ggap"></th>`;
  const groupRow = `<tr class="zm-ggroups"><th></th>${groups.map((grp) => `${gapTh}<th colspan="${grp.cols.length}" class="zm-g${groups.indexOf(grp)} zm-gl zm-gr${grp.name ? " zm-gname" : ""}">${grp.name}</th>`).join("")}</tr>`;
  const labelRow = `<tr class="zm-glabels"><th></th>${groups.map((grp) => gapTh + grp.cols.map(([, label], i) => `<th class="num ${edge(grp, i)}">${label}</th>`).join("")).join("")}</tr>`;
  const toggle = Object.entries(ZM_METRIC).map(([k, [label]]) => `<button type="button" class="view-toggle-btn${ZM.grid === k ? " active" : ""}" data-grid="${k}">${label}</button>`).join("");
  return `<div class="zm-grid-head"><span class="zm-def-title">${zmLogo(abbr, 16)} ${abbr} Defense By Position &middot; ${ZM.market === "threes" ? "Threes" : "Every Shot"}</span><div class="view-toggle zm-grid-toggle">${toggle}</div></div>
    <div class="shc-scroll"><table class="data-table zm-grid">${colgroup}<thead>${groupRow}${labelRow}</thead><tbody>${rows}</tbody></table></div>
    <p class="zm-legend">Rank of 30 by ${ZM_METRIC[ZM.grid][2]}: <b>30th = gives up the most</b> (red), 1st = takes it away (green). Outlined = that position's biggest weak spot. Small number = shots faced; hover for the numbers.</p>`;
}

const zmOrd = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");

function zmMatchup() {
  const g = zmGame(ZM.game);
  if (!g) return `<p class="no-data-note">Pick a game.</p>`;
  const side = (team, opp) => {
    const rows = zmRows((x) => x.p.game_id === g.game_id && x.p.team === team).sort((a, b) => b.r.score - a.r.score);
    return `<div class="nba-box">${zmBanner(team, `<span class="shc-name">${zmTeam(team).name}</span><span class="shc-sub">Shooters vs ${opp} Defense</span>`)}
      <div class="zm-inner">${zmGrid(opp)}${zmTable(rows, { noVs: true, read: true })}</div></div>`;
  };
  return `<div class="zm-game">${side(g.away, g.home)}${side(g.home, g.away)}</div>`;
}

// ---- both charts for one player: his shots and what this defense allowed his group, raw, vs his group's league ----
const zmCache = new Map();
function zmGroupLeague(g) {
  const key = `lg:${g}`;
  if (!zmCache.has(key)) {
    const spots = new Map();
    const pos = zmM().pos || {};
    Object.entries(ZF.players || {}).forEach(([id, list]) => {
      if ((pos[id] || "F") !== g) return;
      list.forEach((s) => {
        const k = `${s[0]},${s[1]},${s[3]}`;
        const t = spots.get(k) || spots.set(k, [s[0], s[1], s[3], 0, 0]).get(k);
        t[3] += s[2];
        t[4] += 1;
      });
    });
    zmCache.set(key, [...spots.values()]);
  }
  return zmCache.get(key);
}
function zmAllowed(abbr, g) {
  const key = `d:${abbr}:${g}`;
  if (!zmCache.has(key)) {
    const t = (ZF.teams || []).indexOf(abbr);
    const pos = zmM().pos || {};
    const out = [];
    Object.entries(ZF.players || {}).forEach(([id, list]) => (pos[id] || "F") === g && list.forEach((s) => s[8] === t && out.push(s)));
    zmCache.set(key, out);
  }
  return zmCache.get(key);
}
function zmDetail() {
  const box = zmEl("zm-detail");
  const p = ZM.player && zmM().players[ZM.player];
  const r = p && p[ZM.market];
  if (!p || !r) {
    box.hidden = true;
    return;
  }
  const threes = ZM.market === "threes";
  const keep = (s) => !threes || s[3];
  const kindOk = (s) => ZM.kind === "all" || s[6] === Number(ZM.kind);
  const mine = (ZF.players[ZM.player] || []).filter((s) => keep(s) && kindOk(s));
  const allowed = zmAllowed(p.opp, p.group).filter((s) => keep(s) && kindOk(s));
  const league = zmGroupLeague(p.group).filter((s) => !threes || s[2]);
  const view = (shots, opts) => (!shots.length ? `<p class="no-data-note">No shots.</p>` : `<div class="nba-shot-chart shc-chart">${ZM.chart === "heat" ? nbaShotHeatView(shots, league, opts) : nbaShotZonesView(shots, league, opts)}</div>`);
  const g = ZM_GROUP[p.group];
  const d = ((zmM().defense || {})[p.opp] || {})[p.group] || {};
  // The Why table (the owner, 2026-10-28: "WAYYYY too wide ... color code everything"): his side left,
  // the zone / type in the middle, the defense's side right, every cell shaded. His Shots / Share in
  // the accent (how much of his diet, never good or bad); the rest red-to-green from HIS side, so a
  // rank of 30 (gives up the most) is green here. Shots vs Lg on a log scale: +231% and +79% differ.
  const teams = Object.keys(zmM().defense || {}).length || 30;
  const rankCell = (rank) => `<td class="num" style="background:${rank ? nbaShotColor((((rank - 1) / Math.max(1, teams - 1)) * 2 - 1) * NBA_SHOT_FULL, 0.5) : ""}">${rank ? `${rank}${zmOrd(rank)}` : "--"}</td>`;
  const volShade = (v) => (v === null || v === undefined ? "" : zmShade(Math.log(Math.max(0.05, 1 + v)), Math.log(4)));
  const dietMax = (list) => Math.max(0.01, ...list.map((x) => x.share));
  const diet = (x, max) => `background:rgba(var(--accent-rgb),${(0.08 + 0.42 * (x.share / max)).toFixed(2)})`;
  const gap = `<td class="zm-ggap"></td>`;
  const hisCells = (x, max) => `<td class="num" style="${diet(x, max)}">${x.n}</td><td class="num" style="${diet(x, max)}">${Math.round(x.share * 100)}%</td>`;
  const zMax = dietMax(r.zones);
  const kMax = dietMax(r.kinds);
  const zoneRows = r.zones
    .map((z) => {
      const rk = d[z.z] || [];
      return `<tr>${hisCells(z, zMax)}${gap}<td class="zm-wlabel">${ZM_ZONE[z.z]}</td>${gap}
        <td class="num">${z.dtried ? `${z.dmade}/${z.dtried}` : "--"}</td><td class="num" style="background:${zmShade(z.fg, 0.3)}">${zmPts(z.fg)}</td>${rankCell(rk[2])}<td class="num" style="background:${volShade(z.vol)}">${zmPct(z.vol)}</td>${rankCell(rk[3])}</tr>`;
    })
    .join("");
  const kindRows = r.kinds
    .map((k) => `<tr>${hisCells(k, kMax)}${gap}<td class="zm-wlabel">${ZM_KIND[k.k]}</td>${gap}<td class="num">${k.dtried ? `${k.dmade}/${k.dtried}` : "--"}</td><td class="num" style="background:${zmShade(k.fg, 0.3)}">${zmPts(k.fg)}</td><td class="num zm-wnone">--</td><td class="num zm-wnone">--</td><td class="num zm-wnone">--</td></tr>`)
    .join("");
  const groupRow = (label) => `<tr class="zm-wgroup"><td colspan="2"></td>${gap}<td class="zm-wlabel">${label}</td>${gap}<td colspan="5"></td></tr>`;
  box.hidden = false;
  box.innerHTML = `<h2 class="section-title">${zmLogo(p.team, 22)} ${p.name} vs ${zmLogo(p.opp, 22)} ${p.opp} Defense &middot; ${threes ? "Threes" : "Points"} <span class="zm-read" style="background:${zmShade(r.score, 0.25)}">${zmWord(r)}</span></h2>
    <div class="zm-bar"><div class="view-toggle" id="zm-chart"><button type="button" class="view-toggle-btn${ZM.chart === "zones" ? " active" : ""}" data-chart="zones">Zones</button><button type="button" class="view-toggle-btn${ZM.chart === "heat" ? " active" : ""}" data-chart="heat">Heat Map</button></div>
    <div class="view-toggle" id="zm-kind">${[["all", "Every Type"], ["1", "Self-Created"], ["2", "Catch & Shoot"], ["3", "Drives & Cuts"]].map(([k, label]) => `<button type="button" class="view-toggle-btn${ZM.kind === k ? " active" : ""}" data-kind="${k}">${label}</button>`).join("")}</div>
    <span class="zm-sum">Score <b>${zmPct(r.score)}</b> &middot; Shots <b>${zmPct(r.shots)}</b> &middot; Makes <b>${zmPct(r.makes)}</b> &middot; Line <b>${r.line ?? "--"}</b></span></div>
    <div class="nba-two shc-two">
      <div class="nba-box">${zmBanner(p.team, `${playerClick(ZM.player, `<span class="shc-name">${p.name}</span>`)}<span class="shc-sub">${threes ? "His Threes" : "His Shots"} &middot; ${mine.length} &middot; vs League ${g}</span>`)}<div class="shc-inner">${view(mine)}</div></div>
      <div class="nba-box">${zmBanner(p.opp, `<span class="shc-name">${zmTeam(p.opp).name}</span><span class="shc-sub">Allowed To ${g} &middot; ${allowed.length}</span>`)}<div class="shc-inner">${view(allowed, { allowed: true })}</div></div>
    </div>
    <div class="shc-scroll"><table class="data-table zm-why"><thead>
      <tr class="zm-wsides"><th colspan="2" class="zm-wside">${zmLogo(p.team, 16)} ${p.name}</th><th class="zm-ggap"></th><th></th><th class="zm-ggap"></th><th colspan="5" class="zm-wside">${zmLogo(p.opp, 16)} ${p.opp} Allows ${g}</th></tr>
      <tr><th class="num" title="His ${threes ? "threes" : "shots"} from here this season">Shots</th><th class="num" title="Share of his ${threes ? "threes" : "shots"}: deeper = more of his diet">Share</th><th class="zm-ggap"></th><th class="zm-wlabel">Zone / Type</th><th class="zm-ggap"></th><th class="num" title="Made / tried by ${g.toLowerCase()} against ${p.opp}">FG</th><th class="num" title="Make rate allowed minus the league's for ${g.toLowerCase()}, in points. Green = more makes: helps him">FG% vs Lg</th><th class="num" title="Rank of 30 in make rate allowed (30th = gives up the most: green for him)">FG% Rank</th><th class="num" title="Share of ${g.toLowerCase()}' shots given up here vs the league's share. Green = more chances: helps him">Shots vs Lg</th><th class="num" title="Rank of 30 in share of shots allowed here (30th = gives up the most: green for him)">Shots Rank</th></tr>
    </thead><tbody>${groupRow("Where He Shoots")}${zoneRows}${groupRow("How He Shoots")}${kindRows}</tbody></table></div>
    <p class="zm-legend zm-why-legend">Green helps him, red hurts him. Ranks of 30: 30th = ${p.opp} gives up the most (green here). Shots / Share: deeper = more of his diet.</p>`;
}

// ---- the record: every OVER / UNDER read locked at tip, graded against his main line, units at the best price then ----
function zmYtd() {
  const overlay = ensureBookModal("zm-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="zm-ytd-tracker"></div>
    <p class="no-data-note">Every Over / Under read as it stood at tip, graded against his main line then, 1 unit at the best price across every book at tip (reads from before Oct 28 have no price: W / L only). No EV: the units are just for seeing. Toss Ups, pushes and players who sat don't count. The slider cuts on the read's score.</p>`;
  const rec = zmM().record || {};
  const splits = [["strong", "Strong", "Score 12%+"], ["lean", "Lean", "Score 5-12%"], ["over", "Overs"], ["under", "Unders"]];
  ytdTracker(content.querySelector(".zm-ytd-tracker"), {
    key: "nba-zones",
    all: "All Reads",
    markets: [["points", "Points"], ["threes", "Threes"]].map(([key, label]) => ({ key: `zones-${key}`, label, short: label, ledger: (rec[key] || {}).ledger || [],
      min: 5, max: 30, step: 1, scale: 100, unit: "%+", slider: "Min Score", tip: "Every read with at least the minimum score", splits })),
  });
  overlay.hidden = false;
}

// ---- a past night (the owner, 2026-10-28: "no back button to look at yesterday to analyze results ...
// as i can see best plays"): every Over / Under read as locked at tip, Hit / Miss and what he got ----
function zmDays() {
  const m = zmM();
  const past = Object.values(m.past || {}).flat().map((p) => p.date);
  return [...new Set([...past, m.date])].sort();
}
const zmDay = () => zmDays()[ZM.day] || zmM().date;
function zmPast(date) {
  const reads = ((zmM().past || {})[ZM.market] || []).filter((p) => p.date === date && (!ZM.strongOnly || p.strong));
  const graded = reads.filter((p) => p.result === "hit" || p.result === "miss");
  const zmUnits = (u) => `${u >= 0 ? "+" : "&minus;"}${Math.abs(u).toFixed(2)}u`;
  const tile = (label, list) => {
    const g = list.filter((p) => p.result === "hit" || p.result === "miss");
    const w = g.filter((p) => p.result === "hit").length;
    const priced = g.filter((p) => p.units !== null && p.units !== undefined);
    const u = priced.reduce((a, p) => a + p.units, 0);
    const units = priced.length ? ` &middot; <em class="${u >= 0 ? "zm-up" : "zm-down"}">${zmUnits(u)}</em>` : "";
    return `<div><small>${label}</small><b>${g.length ? `${w}-${g.length - w}` : "--"}</b><span>${g.length ? `${Math.round((w / g.length) * 100)}%${units}` : ""}</span></div>`;
  };
  const waiting = reads.filter((p) => !p.result).length;
  const table = (list) => {
    if (!list.length) return `<p class="no-data-note">No reads here.</p>`;
    const body = list.map((p) => {
      const [cls, word] = { hit: ["zm-hit", "Hit"], miss: ["zm-miss", "Miss"], push: ["", "Push"], sat: ["", "Didn't Play"] }[p.result] || ["", "Waiting"];
      return `<tr class="zm-past ${cls}"><td class="zm-name">${zmLogo(p.team, 18)} ${playerClick(p.pid, p.name)}</td><td>${zmLogo(p.opp, 18)}</td>
        <td><span class="zm-read" style="background:${zmShade(p.score, 0.25)}">${zmReadWord(p)}</span></td>
        <td class="num" style="background:${zmShade(p.score, 0.25)}"><b>${zmPct(p.score)}</b></td>
        <td class="num zm-line">${p.side === "under" ? "u" : "o"}${p.line ?? "--"}</td>
        <td class="num" title="${p.book ? `Best price across every book at tip: ${p.book}` : "Saved before prices were"}">${p.price === null || p.price === undefined ? "--" : boOdds(p.price)}</td>
        <td class="num zm-result ${cls}"><b>${word}</b>${p.got === null || p.got === undefined ? "" : ` <span>${p.got}</span>`}</td>
        <td class="num ${p.units > 0 ? "zm-up" : p.units < 0 ? "zm-down" : ""}">${p.units === null || p.units === undefined ? "--" : zmUnits(p.units)}</td></tr>`;
    }).join("");
    return `<div class="shc-scroll"><table class="data-table zm-table"><thead><tr><th>Player</th><th>Vs</th><th>Read</th>
      <th class="num" title="The read's score at tip">Score</th><th class="num" title="His main line at tip, on the read's side">Line</th>
      <th class="num" title="The best price across every book at tip">Odds</th>
      <th class="num" title="Hit / Miss and his ${ZM.market === "threes" ? "threes" : "points"}">Result</th><th class="num" title="1 unit at the price at tip (no EV: just for seeing)">Units</th></tr></thead><tbody>${body}</tbody></table></div>`;
  };
  const over = reads.filter((p) => p.side === "over").sort((a, b) => b.score - a.score);
  const under = reads.filter((p) => p.side === "under").sort((a, b) => a.score - b.score);
  const strongBtn = `<button type="button" class="view-toggle-btn zm-strong${ZM.strongOnly ? " active" : ""}">Strong Only</button>`;
  return `<p class="zm-legend">Results &middot; ${reads.length} read${reads.length === 1 ? "" : "s"} as locked at tip, graded against his main line then, 1 unit at the best price at tip${waiting ? ` &middot; ${waiting} waiting on the box score` : ""} ${strongBtn}</p>
    <div class="zm-night">${tile("All Reads", reads)}${tile("Strong", reads.filter((p) => p.strong))}${tile("Overs", over)}${tile("Unders", under)}</div>
    ${reads.length ? `<div class="zm-spots">
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-over">Overs <span>${over.length}</span></div>${table(over)}</div>
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-under">Unders <span>${under.length}</span></div>${table(under)}</div>
    </div>` : `<p class="no-data-note">No reads this night.</p>`}`;
}

// ---- the page ----
function zmSlate() {
  const m = zmM();
  const days = zmDays();
  const date = zmDay();
  const today = date === m.date;
  zmEl("matchup-row").hidden = ZM.view !== "matchup" || !today;
  zmEl("day-prev").disabled = ZM.day <= 0;
  zmEl("day-next").disabled = ZM.day >= days.length - 1;
  zmEl("day-label").textContent = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  zmEl("matchup-row").innerHTML = m.games
    .map((g) => `<button type="button" class="matchup-card${g.game_id === ZM.game ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${zmLogo(g.away, 28)}<span class="at">@</span>${zmLogo(g.home, 28)}</span>
        <span class="matchup-date">${g.started ? "Started" : gmgGameTime(g, false)}</span>
      </button>`)
    .join("");
}
function zmRender() {
  if (!zmM()) return;
  document.querySelectorAll("#zm-view [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === ZM.view));
  document.querySelectorAll("#zm-market [data-market]").forEach((b) => b.classList.toggle("active", b.dataset.market === ZM.market));
  zmEl("zm-min").value = String(ZM.min);
  zmSlate();
  const past = zmDay() !== zmM().date;
  zmEl("zm-view").hidden = past; // a past night = its Results (both views read tonight's slate)
  zmEl("zm-body").innerHTML = past ? zmPast(zmDay()) : ZM.view === "matchup" ? zmMatchup() : zmSpots();
  zmFitTags();
  if (past) zmEl("zm-detail").hidden = true;
  else zmDetail();
  try {
    localStorage.setItem(ZM_KEY, JSON.stringify({ view: ZM.view, market: ZM.market, min: ZM.min, grid: ZM.grid }));
  } catch (e) {
    // localStorage unavailable -- the view just won't stick.
  }
}

document.addEventListener("click", (e) => {
  if (!zmM()) return;
  const v = e.target.closest("#zm-view [data-view]");
  if (v) return ((ZM.view = v.dataset.view), zmRender());
  const mk = e.target.closest("#zm-market [data-market]");
  if (mk) return ((ZM.market = mk.dataset.market), zmRender());
  const card = e.target.closest(".matchup-card[data-game]");
  if (card) return ((ZM.game = card.dataset.game), zmRender());
  const gd = e.target.closest(".zm-grid-toggle [data-grid]");
  if (gd) return ((ZM.grid = gd.dataset.grid), zmRender());
  const kd = e.target.closest("#zm-kind [data-kind]");
  if (kd) return ((ZM.kind = kd.dataset.kind), zmDetail());
  const ch = e.target.closest("#zm-chart [data-chart]");
  if (ch) return ((ZM.chart = ch.dataset.chart), zmDetail());
  if (e.target.closest(".zm-all")) return ((ZM.all = !ZM.all), zmRender());
  if (e.target.closest(".zm-strong")) return ((ZM.strongOnly = !ZM.strongOnly), zmRender());
  if (e.target.closest("#day-prev") && ZM.day > 0) return ((ZM.day -= 1), zmRender());
  if (e.target.closest("#day-next") && ZM.day < zmDays().length - 1) return ((ZM.day += 1), zmRender());
  if (e.target.closest("#zm-ytd")) return zmYtd();
  const row = e.target.closest(".zm-row");
  if (row && !e.target.closest(".player-click")) {
    ZM.player = row.dataset.player;
    const p = zmM().players[ZM.player];
    if (p) ZM.game = p.game_id;
    zmRender();
    zmEl("zm-detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "zm-min" && zmM()) {
    ZM.min = Number(e.target.value) || 0;
    zmRender();
  }
});
document.addEventListener("click", (e) => {
  const theme = e.target.closest("#theme-toggle");
  if (!theme) return;
  const light = document.documentElement.dataset.theme !== "light";
  if (light) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
  } catch (err) {
    // localStorage unavailable -- the theme just won't stick.
  }
});

window.addEventListener("load", () => {
  NBA_SHOT_PRIOR = 0; // raw on this page (the owner, 2026-10-27: "Yes take that out. make it raw.")
  try {
    Object.assign(ZM, JSON.parse(localStorage.getItem(ZM_KEY) || "{}"));
  } catch (e) {
    // localStorage unavailable or bad JSON.
  }
  if (!["spots", "matchup"].includes(ZM.view)) ZM.view = "spots";
  if (!["points", "threes"].includes(ZM.market)) ZM.market = "points";
  if (!ZM_METRIC[ZM.grid]) ZM.grid = "make";
  Promise.all([
    fetch("data.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("shots.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([data, file]) => {
    DATA = data || { teams: {}, schedule: [] };
    ZF = file;
    const m = zmM();
    if (!m || !Object.keys(m.players || {}).length) {
      zmEl("empty-state").innerHTML = `<p>${file ? "No players with a points or threes line on the next slate yet." : "Zone matchups aren't available right now."}</p>`;
      return;
    }
    zmEl("empty-state").hidden = true;
    ZM.game = (m.games.find((g) => !g.started) || m.games[0] || {}).game_id || null;
    ZM.day = zmDays().length - 1; // opens on tonight's slate
    zmRender();
  });
});
