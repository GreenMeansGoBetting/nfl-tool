// GMG NBA Suite: Assist Spots (2026-11-05). Loaded after research.js on assist-spots.html: the Prop
// Research list, prices, day arrows, drop-down panel and Vs The Line are research.js's own; this file
// swaps the list's columns, the panel's tabs and adds the Reads.
// The owner (mock-ups 1-5, 2026-11-05): a read per player at a glance ("I don't know what's good or
// bad"), every factor in its own row so one never hides another ("its not taking into account all the
// info": Draymond's Under came off Santos alone while 39% of his assists go to Curry and MIA is the worst
// at guarding PGs), defense ranks read from the defense (30th = allows the most, red), every tile colored
// against its own column. No projection: each read is his side x tonight's side, and the member decides.
// Assists = chances (teammates' makes while he's on the floor) x his share of them.
// Votes: Targets (who he passes to x what the defense allows their positions), Types (how he sets them up
// x what the defense allows of each type), Lineup (a teammate newly out: his share without him vs his
// season). Context, never a vote: Chances (the same for everyone in the game, and the total prices it),
// Volume (lots of threes off a pass: his number swings with how they fall).
// Data: props.json `research` (research.py): `ap`, `wa`, `acg`, `dag`, `linesa` and Assist Spots' own
// `af`, `ag`, `k3g`, `dfa`, `tm`; `spots_frozen` = the reads saved before tip (spotsCapture).

const ASSIST_TYPES = ["k3", "dr", "cl", "d3", "mid"];
const TYPE_NAME = { k3: "Kick-Out 3s", dr: "Catch & Drive", cl: "Cuts & Lobs", d3: "Off-Dribble 3s", mid: "Short & Mid" };
const TYPE_HEAD = { k3: "Kick-Out 3", dr: "Drive", cl: "Cut / Lob", d3: "Dribble 3", mid: "Mid" };
const SPOT_POS = ["PG", "SG", "SF", "PF", "C"];
const SMALL_AST = 20; // fewer assists than this this season: Targets and Types are a Small Sample, no vote
const LEAN = 0.5, STRONG = 1; // a factor's pull: 0.5+ Lean, 1+ Strong
const SCALE = { ch: 0.05, tg: 0.10, ty: 0.06, lu: 0.05 }; // what one step of pull is for each factor
const MIN_SPLIT = 25; // teammate makes each way (with / without) before a Lineup split counts
const SPOT_TABS = { left: ["Who He Assists", "Assist Types", "Game Log"], right: ["The Read", "Vs The Line", "Lineup"] };
RSV.left = "Who He Assists";
RSV.right = "The Read";
LIST.sort = "call";

const clip2 = (v) => Math.max(-2, Math.min(2, v));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? "--" : `${Math.round(v * 100)}%`);
const sgnPct = (v) => `${v >= 0 ? "+" : "&minus;"}${Math.abs(Math.round(v * 100))}%`;
// a tile with its own style (research.js T takes a signed strength)
const LBc = (v, tip, cls) => `<div class="rs-t rs-l${cls ? ` ${cls}` : ""}"${tipAttr(tip)}>${v}</div>`; // a row label (+ rs-out)
const TS = (v, style = "", tip = "", cls = "") => `<div class="rs-t${cls ? ` ${cls}` : ""}"${style ? ` style="${style}"` : ""}${tipAttr(tip)}>${v}</div>`;
// -1..1 by where a value sits between the lowest and highest of its own column (its "relative counterparts")
const relS = (v, vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); return hi > lo ? ((v - lo) / (hi - lo)) * 2 - 1 : null; };
// A defense's rank read from the defense: dRank / dWords (research.js). `r` = its rank by most allowed.
const dTxt = (r, n) => `#${dRank(r, n)}`;
const dStyle = (r, n) => rankStyle(dRank(r, n), n);

// ---- league and team numbers (cached per page load) ----
let SPOT_LG = null;
function spotLeague() {
  if (SPOT_LG) return SPOT_LG;
  const R = RS(), dfa = R.dfa || {}, tm = R.tm || {};
  const teams = Object.keys(dfa).filter((t) => (dfa[t][5] || 0) > 0);
  const by = (f) => teamRanks((t) => (teams.includes(t) ? f(t) : null));
  // the league's mix of assists by type
  const lgAf = ASSIST_TYPES.map(() => 0);
  for (const p of Object.values(R.players || {})) (p.af || []).forEach((n, i) => (lgAf[i] += n));
  const lgN = sum(lgAf) || 1;
  // shots of each type each defense allows a 100 possessions
  const per100 = ASSIST_TYPES.map((_, i) => Object.fromEntries(teams.map((t) => [t, (dfa[t][i] / dfa[t][5]) * 100])));
  const lgPer100 = ASSIST_TYPES.map((_, i) => (sum(teams.map((t) => dfa[t][i])) / (sum(teams.map((t) => dfa[t][5])) || 1)) * 100);
  const typeRank = ASSIST_TYPES.map((_, i) => by((t) => per100[i][t]));
  // assisted baskets each defense allows each position a game (research `dag`)
  const dpos = {}, dposLg = {};
  for (const pos of SPOT_POS) {
    const i = SPOT_POS.indexOf(pos);
    const v = {};
    for (const [t, games] of Object.entries(R.dag || {})) {
      const rows = Object.values(games);
      if (rows.length) v[t] = sum(rows.map((r) => r[i] || 0)) / rows.length;
    }
    dpos[pos] = { v, rank: teamRanks((t) => v[t] ?? null) };
    dposLg[pos] = avg(Object.values(v)) || 0;
  }
  const mkOff = (t) => (tm[t] && tm[t][0] ? (tm[t][1] / tm[t][0]) * 100 : null);
  const mkDef = (t) => (tm[t] && tm[t][2] ? (tm[t][3] / tm[t][2]) * 100 : null);
  const tot = (i) => sum(Object.values(tm).map((r) => r[i] || 0));
  const paces = Object.fromEntries(Object.entries(identityTeams()).map(([t, x]) => [t, x.off_pace]).filter(([, v]) => v));
  SPOT_LG = {
    teams, mix: lgAf.map((n) => n / lgN), per100, lgPer100, typeRank, dpos, dposLg,
    mkOff, mkDef, mkLg: tot(2) ? (tot(1) / tot(0)) * 100 : null, mkOffRank: by(mkOff), mkDefRank: by(mkDef),
    t3: (t) => (tm[t] && tm[t][4] ? tm[t][5] / tm[t][4] : null), t3Lg: tot(4) ? tot(5) / tot(4) : null,
    t3a: (t) => (tm[t] && tm[t][6] ? tm[t][7] / tm[t][6] : null), t3aLg: tot(6) ? tot(7) / tot(6) : null,
    o3: (t) => (tm[t] && tm[t][8] ? tm[t][9] / tm[t][8] : null),
    paces, paceLg: avg(Object.values(paces)),
  };
  SPOT_LG.t3Rank = by(SPOT_LG.t3);
  SPOT_LG.t3aRank = by(SPOT_LG.t3a);
  SPOT_LG.o3Rank = by(SPOT_LG.o3);
  SPOT_LG.paceRank = teamRanks((t) => paces[t] ?? null);
  // how much each defense allows his whole mix: the fit, for every defense (for its rank)
  SPOT_LG.fitOf = (mix, t) => sum(ASSIST_TYPES.map((_, i) => mix[i] * ((per100[i][t] || 0) / (lgPer100[i] || 1)))) - 1;
  return SPOT_LG;
}

// His team's last 3 games before tonight (a teammate who played 2 of them and is out tonight is new).
const TEAM_LAST = {};
function teamLast3(tm, before) {
  const k = `${tm}|${before}`;
  if (TEAM_LAST[k]) return TEAM_LAST[k];
  const f = logFields();
  const games = new Map();
  for (const p of Object.values(seasonBlock().players)) {
    if (p.team !== tm) continue;
    for (const r of p.log || []) if (r[f.date] < before) games.set(String(r[f.game]), r[f.date]);
  }
  return (TEAM_LAST[k] = [...games.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).slice(-3).map(([g]) => g));
}

// ---- one player tonight: the numbers and the factors ----
const SPOT_CACHE = {};
function spotOf(x) {
  const key = `${x.g.game_id}:${x.pid}`;
  if (SPOT_CACHE[key]) return SPOT_CACHE[key];
  const L = spotLeague(), r = rsOf(x.pid), af = r.af || ASSIST_TYPES.map(() => 0), nAst = sum(af);
  const mix = af.map((n) => (nAst ? n / nAst : 0));
  const share = r.ap && r.ap[0] ? r.ap[1] / r.ap[0] : null;
  const small = nAst < SMALL_AST;
  // who he assists: top 4 teammates, everyone else folded
  const rec = Object.entries(r.ag || {}).map(([id, c]) => ({ id, c, n: sum(c), pos: (playerOf(id) || {}).pos || "" })).sort((a, b) => b.n - a.n);
  const grid = rec.slice(0, 4);
  const rest = rec.slice(4);
  if (rest.length) grid.push({ id: "", rest: true, c: ASSIST_TYPES.map((_, i) => sum(rest.map((q) => q.c[i]))), n: sum(rest.map((q) => q.n)), pos: "" });
  // Targets: his share to each top teammate x what tonight's defense allows that teammate's position
  const tg = grid.filter((q) => !q.rest && L.dpos[q.pos] && L.dpos[q.pos].v[x.opp] !== undefined && L.dposLg[q.pos])
    .map((q) => ({ ...q, sh: q.n / (nAst || 1), eff: (q.n / (nAst || 1)) * (L.dpos[q.pos].v[x.opp] / L.dposLg[q.pos] - 1) }));
  const tgv = sum(tg.map((q) => q.eff));
  const tgTop = tg.slice().sort((a, b) => Math.abs(b.eff) - Math.abs(a.eff))[0];
  // Types: his mix x what tonight's defense allows of each type
  const fit = L.teams.includes(x.opp) && nAst ? L.fitOf(mix, x.opp) : null;
  const fitRank = fit === null ? null : teamRanks((t) => (L.teams.includes(t) ? L.fitOf(mix, t) : null));
  const topType = ASSIST_TYPES.slice().sort((a, b) => mix[ASSIST_TYPES.indexOf(b)] - mix[ASSIST_TYPES.indexOf(a)])[0];
  // Lineup: every teammate's split; a new absence = Out / Doubtful tonight after playing 2 of the last 3
  const last3 = teamLast3(x.team, x.g.date);
  const lineup = Object.entries(r.wa || {}).map(([id, w]) => {
    const status = statusOf(x.team, id);
    const played = new Set(logOf(id).map((q) => String(q[logFields().game])));
    const recent = last3.filter((g) => played.has(g)).length;
    return { id, name: nameOf(id), on: w[1] ? w[0] / w[1] : null, off: w[3] ? w[2] / w[3] : null, nOn: w[1], nOff: w[3], status, recent,
      out: isOut(status), isNew: isOut(status) && recent >= 2 };
  }).filter((q) => q.on !== null && q.off !== null && q.nOn >= MIN_SPLIT && q.nOff >= MIN_SPLIT)
    .sort((a, b) => b.isNew - a.isNew || Math.abs(b.off - b.on) - Math.abs(a.off - a.on));
  const newOut = share === null ? null : lineup.filter((q) => q.isNew).sort((a, b) => Math.abs(b.off - share) - Math.abs(a.off - share))[0] || null;
  // Chances: the game's pace x the baskets his team makes and tonight's defense allows
  const pace = L.paces[x.team] && L.paces[x.opp] ? (L.paces[x.team] + L.paces[x.opp]) / 2 : null;
  const mo = L.mkOff(x.team), md = L.mkDef(x.opp);
  const ch = pace && L.paceLg && mo !== null && md !== null && L.mkLg ? (pace / L.paceLg) * ((mo + md - L.mkLg) / L.mkLg) - 1 : null;
  // Volume: his team shoots a lot of threes, they mostly come off a pass, he sets them up, the defense allows them
  const t3 = L.t3(x.team), t3a = L.t3a(x.team), o3r = L.o3Rank.r[x.opp];
  const vol = t3 !== null && t3a !== null && t3 > L.t3Lg && t3a > L.t3aLg && nAst && mix[0] >= L.mix[0] && o3r && o3r <= 20;
  const nT = L.teams.length || 30;
  const fs = [
    { k: "ch", name: "Chances", vote: false, s: ch === null ? null : clip2(ch / SCALE.ch),
      him: mo === null ? "--" : `${x.team} Makes #${L.mkOffRank.r[x.team]} &middot; Pace #${L.paceRank.r[x.team] || "--"}`,
      tonight: md === null ? "--" : `${x.opp} Allows ${dTxt(L.mkDefRank.r[x.opp], L.mkDefRank.n)} &middot; Pace #${L.paceRank.r[x.opp] || "--"}`,
      tsty: md === null ? "" : dStyle(L.mkDefRank.r[x.opp], L.mkDefRank.n),
      tip: ch === null ? "Not enough games yet" : `Teammates' baskets he can assist: ${x.team} makes ${fmt(mo)} a 100 possessions (league ${fmt(L.mkLg)}), ${x.opp} allows ${fmt(md)}; the game's pace ${fmt(pace)} (league ${fmt(L.paceLg)}). About ${sgnPct(ch)} chances. Context only: the same for everyone in this game, and the total already prices it.` },
    { k: "tg", name: "Targets", tag: "Targets", vote: !small && tg.length > 0, small, s: tg.length ? clip2(tgv / SCALE.tg) : null,
      him: tgTop ? `${pct(tgTop.sh)} To ${lastName(nameOf(tgTop.id))} (${tgTop.pos})` : "--",
      tonight: tgTop ? `${x.opp} Vs ${tgTop.pos}s ${dTxt(L.dpos[tgTop.pos].rank.r[x.opp], L.dpos[tgTop.pos].rank.n)}` : "--",
      tsty: tgTop ? dStyle(L.dpos[tgTop.pos].rank.r[x.opp], L.dpos[tgTop.pos].rank.n) : "",
      tip: tg.map((q) => `${nameOf(q.id)} (${q.pos}): ${pct(q.sh)} of his assists; ${x.opp} allows ${fmt(L.dpos[q.pos].v[x.opp])} assisted baskets a game to ${q.pos}s (league ${fmt(L.dposLg[q.pos])})`).join(". ") + (small ? `. Only ${nAst} assists this season: a Small Sample.` : "") },
    { k: "ty", name: "Assist Types", tag: "Types", vote: !small && fit !== null, small, s: fit === null ? null : clip2(fit / SCALE.ty),
      him: nAst ? `${pct(mix[ASSIST_TYPES.indexOf(topType)])} ${TYPE_NAME[topType]}` : "--",
      tonight: fitRank ? `${x.opp} Vs His Mix ${dTxt(fitRank.r[x.opp], fitRank.n)}` : "--", tsty: fitRank ? dStyle(fitRank.r[x.opp], fitRank.n) : "",
      tip: nAst ? ASSIST_TYPES.map((t, i) => `${TYPE_NAME[t]}: ${pct(mix[i])} of his assists; ${x.opp} ${dTxt(L.typeRank[i].r[x.opp], L.typeRank[i].n)}`).join(". ") + (small ? `. Only ${nAst} assists this season: a Small Sample.` : "") : "No assists yet" },
    { k: "lu", name: "Lineup", tag: newOut ? `${lastName(newOut.name)} Out` : "", vote: Boolean(newOut), s: newOut ? clip2((newOut.off - share) / SCALE.lu) : 0,
      him: newOut ? `${pct(newOut.off)} Without &middot; ${pct(share)} Season` : "No Swing", tonight: newOut ? `${lastName(newOut.name)} Out (New)` : "No New Absence",
      tsty: newOut ? stepStyle(-0.7) : "",
      tip: newOut ? `He assisted ${pct(newOut.off)} of his teammates' makes without ${newOut.name} (${newOut.nOff} makes), ${pct(share)} on the season. ${newOut.name} played ${newOut.recent} of the last 3 and is ${newOut.status} tonight.` : "No teammate who played 2 of the last 3 is out tonight" },
    { k: "vol", name: "Volume", tag: vol ? "Volume" : "", vote: false, info: Boolean(vol), s: 0,
      him: t3 === null ? "--" : `${x.team} 3s #${L.t3Rank.r[x.team]} &middot; Off A Pass #${L.t3aRank.r[x.team]}`,
      tonight: o3r ? `${x.opp} Allows 3s ${dTxt(o3r, L.o3Rank.n)}` : "--", tsty: "",
      tip: t3 === null ? "" : `${x.team}: ${pct(t3)} of shots are threes (league ${pct(L.t3Lg)}), ${pct(t3a)} of made threes come off a pass (league ${pct(L.t3aLg)}); ${pct(mix[0])} of his assists are kick-out 3s.${vol ? " Lots of threes off a pass: his number swings with how they fall, both ways. Context only." : ""}` },
  ];
  return (SPOT_CACHE[key] = { af, nAst, mix, share, small, grid, fs, fit, fitRank, lineup, nT });
}
// 1 Over, -1 Under, 2 Mixed (real pulls both ways), 0 No Read
function spotCall(fs) {
  const votes = fs.filter((f) => f.vote && f.s !== null);
  const up = votes.filter((f) => f.s >= LEAN), dn = votes.filter((f) => f.s <= -LEAN);
  if (up.length && dn.length) return 2;
  const net = sum(votes.filter((f) => Math.abs(f.s) >= LEAN).map((f) => f.s));
  return net >= STRONG ? 1 : net <= -STRONG ? -1 : 0;
}
const CALL = { 1: ["Over", 1], "-1": ["Under", -1], 2: ["Mixed", 0.1], 0: ["No Read", null] };
const pullWord = (f) => (f.small ? "Small" : !f.vote || f.s === null ? (f.info ? "Info" : "--") : f.s >= STRONG ? "Over" : f.s >= LEAN ? "Lean Over" : f.s <= -STRONG ? "Under" : f.s <= -LEAN ? "Lean Under" : "Even");
const pullS = (f) => (!f.vote || f.small || f.s === null || Math.abs(f.s) < LEAN ? null : f.s >= STRONG ? 1 : f.s >= LEAN ? 0.5 : f.s <= -STRONG ? -1 : -0.5);
const callOf = (x) => (x.past ? frozenSpot(x) : spotCall(spotOf(x).fs));
// a past night: the reads as they stood before tip (spotsCapture, model_history/nba_assist_spots)
const frozenRow = (x) => ((((RS().spots_frozen || {})[String(x.g.game_id)] || {}).m || {})[x.pid]) || null;
const frozenSpot = (x) => { const z = frozenRow(x); return z ? z[0] : null; };

// ---- the list ----
const spotCols = () => [
  { label: "Player", cls: "sim-th-player" },
  { label: "Line", key: "line", title: "His main line: the middle of the books' lines" },
  { label: "Over", title: "The best Over price across your books (click for every book; click a price there to save it to My Plays)" },
  { label: "Under", title: "The best Under price across your books (click for every book; click a price there to save it to My Plays)" },
  { label: "Avg", key: "avg", title: "His assists a game this season (colored against his position)" },
  { label: "Rate", key: "vol", title: "His assist rate: the share of his teammates' made shots he assisted while on the floor (colored against his position)" },
  { label: "L5", key: "l5", hit: true, title: "His last 5 games over tonight's line" },
  { label: "Season", key: "all", hit: true, title: "This season's games over tonight's line" },
  { label: "Targets", key: "tg", read: true, title: "Who he passes to x what tonight's defense allows their positions (click his row: Who He Assists)" },
  { label: "Types", key: "ty", read: true, title: "How he sets them up x what tonight's defense allows of each type (Assist Types)" },
  { label: "Lineup", key: "lu", read: true, title: "A teammate out tonight who played 2 of the last 3: his share without him vs his season (Lineup)" },
  { label: "Read", key: "call", read: true, title: "Over / Under when the reads agree, Mixed when they pull both ways, No Read when nothing pulls enough. Not a pick: the member decides." },
  { label: "Chances", key: "ch", game: true, title: "Pace x the baskets his team makes and tonight's defense allows. Context only: the same for everyone in this game" },
  { label: "Volume", game: true, title: "His team shoots a lot of threes and they mostly come off a pass: his number swings with how they fall. Context only" },
];
const CALL_ORDER = { 1: 3, "-1": 2, 2: 1, 0: 0 };
const factorSort = (k) => (x) => { if (x.past) return -9; const f = spotOf(x).fs.find((q) => q.k === k); return f && f.s !== null && (f.vote || k === "ch") ? f.s : -9; };
Object.assign(SORTS, { call: (x) => (callOf(x) === null ? -1 : CALL_ORDER[callOf(x)]), tg: factorSort("tg"), ty: factorSort("ty"), lu: factorSort("lu"), ch: factorSort("ch") });

function spotReadCell(f, frozenS = undefined) {
  if (frozenS !== undefined) return `<td class="num rs-read"${frozenS === null ? "" : ` style="${stepStyle(frozenS)}"`}><b>${frozenS === null ? "--" : frozenS > 0 ? "Over" : "Under"}</b></td>`;
  const s = pullS(f);
  return `<td class="num rs-read"${s === null ? "" : ` style="${stepStyle(s)}"`}${tipAttr(f.tip)}><b>${pullWord(f)}</b></td>`;
}
function spotRow(x) {
  const pool = listPool(x.p.pos, x.cut);
  const one = (text, v, vals, tip) => { const st = stepStyle(spread(v, vals)); return `<td class="num rs-two"${st ? ` style="${st}"` : ""} title="${tip} (colored against the league's ${x.p.pos}s)"><b>${text}</b></td>`; };
  const ln = x.past ? "that night's line, games before it" : "tonight's line";
  let reads;
  if (x.past) {
    const z = frozenRow(x);
    const sOf = (v) => (v === null || v === undefined || Math.abs(v) < LEAN ? null : Math.max(-1, Math.min(1, v)));
    const c = z ? CALL[z[0]] : null, hit = z ? spotHit(x.g.game_id, x.pid) : null;
    const graded = hit ? `<small>${hit.won ? "Hit" : "Miss"}</small>` : "";
    const tip = !z ? "Not saved for this night: the reads are saved before tip from 11/5 on" : hit ? `The read before tip: ${hit.won ? "hit" : "missed"} (${hit.ast} assists, his line was ${fmt(hit.line)})` : "The read as it stood before tip";
    reads = (z ? [1, 2, 3].map((i) => spotReadCell(null, sOf(z[i]))).join("") : '<td class="num rs-read"><b>--</b></td>'.repeat(3))
      + `<td class="num rs-read sp-call${hit ? (hit.won ? " sp-hit" : " sp-miss") : ""}"${c && c[1] !== null ? ` style="${stepStyle(c[1])}"` : ""} title="${tip}"><b>${c ? c[0] : "--"}</b>${graded}</td>`
      + '<td class="num rs-two"><b>--</b></td><td class="num rs-two"><b>--</b></td>';
  } else {
    const sp = spotOf(x), call = spotCall(sp.fs), [word, s] = CALL[call], F = (k) => sp.fs.find((f) => f.k === k);
    const pulls = sp.fs.filter((f) => f.vote && f.s !== null && Math.abs(f.s) >= LEAN).map((f) => `${f.name} ${f.s > 0 ? "Over" : "Under"}`);
    const ch = F("ch"), vo = F("vol");
    reads = spotReadCell(F("tg")) + spotReadCell(F("ty")) + spotReadCell(F("lu"))
      + `<td class="num rs-read sp-call"${s === null ? "" : ` style="${stepStyle(s)}"`} title="${pulls.length ? pulls.join(", ") : "Nothing pulls enough either way"}"><b>${word}</b></td>`
      + `<td class="num rs-two"${ch.s === null ? "" : ` style="${stepStyle(Math.max(-1, Math.min(1, ch.s / 1.5)))}"`}${tipAttr(ch.tip)}><b>${ch.s === null ? "--" : sgnPct(ch.s * SCALE.ch)}</b></td>`
      + `<td class="num rs-two"${vo.info ? ` style="${stepStyle(0.1)}"` : ""}${tipAttr(vo.tip)}><b>${vo.info ? "Yes" : "--"}</b></td>`;
  }
  return `<tr class="sim-row${x.live ? " live" : ""}${!x.past ? " rs-click" : ""}${OPEN === openKey(x) ? " open" : ""}" data-open="${openKey(x)}">
    <td class="sim-plcell"><span class="sim-pl-in">${headshot(x.pid)}<span class="rs-pl-txt" title="${nameOf(x.pid)}">${playerClick(x.pid, `<b>${nameOf(x.pid)}</b>`)}<span class="rs-pl-sub"><span class="muted-label">${x.p.pos || ""}</span>${statusPill(x.status)}<span class="sim-vs">${logo(x.team, 15)}<span>${x.home ? "vs" : "@"}</span>${logo(x.opp, 15)}</span></span></span></span></td>
    <td class="num rs-line">${x.line === null ? '<span class="muted-label">No Line</span>' : `<b>${fmt(x.line)}</b>`}</td>
    ${x.past ? "" : sideCell(x.g, x.pid, "o", x.line, x.team) + sideCell(x.g, x.pid, "u", x.line, x.team)}
    ${one(fmt(x.avg), x.avg, pool.avgV, `${fmt(x.avg)} assists a game in ${x.gp} games`)}
    ${one(pctT(x.vol), x.vol, pool.vol, `He assisted ${pctT(x.vol)} of his teammates' made shots while on the floor`)}
    ${hitCell(x.hits.l5, `Last 5 games over ${ln}`)}${hitCell(x.hits.all, `This season's games over ${ln}`)}
    ${reads}
    ${x.past ? resultCell(x) : ""}
  </tr>`;
}

// ---- the panel's tabs (research.js's grid: a label column and seven equal columns) ----
const BAND = (kind, from, span) => [kind, from, span];
function whoTab(x) {
  const sp = spotOf(x), L = spotLeague();
  const head = HD(`${lastName(nameOf(x.pid))} To`, "plain") + ASSIST_TYPES.map((t) => HD(TYPE_HEAD[t], "him", "", TYPE_NAME[t])).join("") + HD("Total", "him")
    + HD("Vs Pos", "def", "", `Assisted baskets ${x.opp} allows each position a game (30th = allows the most)`);
  if (!sp.nAst) return gridOf(head, [LB("") + TS("No assists yet this season", "", "", "rs-s7")], { fill: true });
  const cells = sp.grid.flatMap((q) => q.c), mx = Math.max(...cells, 1);
  const tots = sp.grid.map((q) => q.n);
  const rows = sp.grid.map((q) => {
    const st = q.rest ? "" : statusOf(x.team, q.id);
    const dp = !q.rest && L.dpos[q.pos] && L.dpos[q.pos].rank.r[x.opp] ? L.dpos[q.pos] : null;
    return LBc(q.rest ? "Everyone Else" : `${playerClick(q.id, shortName(nameOf(q.id)))}<span class="rs-gn">${q.pos}</span>`, q.rest ? "Every other teammate" : `${nameOf(q.id)}${st ? `: ${st} tonight` : ""}`, st && isOut(st) ? "rs-out" : "")
      + ASSIST_TYPES.map((t, i) => T(q.c[i], (q.c[i] / mx) * 2 - 1, `${q.c[i]} ${TYPE_NAME[t]} to ${q.rest ? "everyone else" : nameOf(q.id)}`)).join("")
      + T(pct(q.n / sp.nAst), relS(q.n, tots), `${q.n} of his ${sp.nAst} assists`)
      + (dp ? TS(dTxt(dp.rank.r[x.opp], dp.rank.n), dStyle(dp.rank.r[x.opp], dp.rank.n), `${x.opp} allows ${fmt(dp.v[x.opp])} assisted baskets a game to ${q.pos}s (league ${fmt(L.dposLg[q.pos])}): ${dWords(dp.rank.r[x.opp], dp.rank.n)}`) : TS("", "", "", "rs-blank"));
  });
  rows.push(TS("Total", "", "", "rs-l sp-him") + ASSIST_TYPES.map((t, i) => T(pct(sp.mix[i]), L.mix[i] ? Math.max(-1, Math.min(1, (sp.mix[i] / L.mix[i] - 1) * 1.5)) : null, `${pct(sp.mix[i])} of his assists are ${TYPE_NAME[t]} (league ${pct(L.mix[i])})`)).join("")
    + TS(sp.nAst, "", `${sp.nAst} assists this season`, "rs-count") + TS("", "", "", "rs-blank"));
  rows.push(TS(`${x.opp} Allows`, "", "", "rs-l sp-def") + ASSIST_TYPES.map((t, i) => (L.typeRank[i].r[x.opp]
    ? TS(dTxt(L.typeRank[i].r[x.opp], L.typeRank[i].n), dStyle(L.typeRank[i].r[x.opp], L.typeRank[i].n), `${x.opp} allows ${fmt(L.per100[i][x.opp])} ${TYPE_NAME[t]} a 100 possessions (league ${fmt(L.lgPer100[i])}): ${dWords(L.typeRank[i].r[x.opp], L.typeRank[i].n)}`)
    : TS("--"))).join("") + TS("", "", "", "rs-blank") + TS("", "", "", "rs-blank"));
  return gridOf(head, rows, { fill: true, n: 7, bands: [BAND("him", 2, 6), BAND("def", 8, 1)] });
}
function typesTab(x) {
  const sp = spotOf(x), L = spotLeague();
  const head = HD("", "plain") + HD("AST", "him") + HD("Share", "him") + HD("League", "him") + HD("Allows", "def", "", "Shots of that type the defense allows a 100 possessions, vs the league")
    + HD("Rank", "def", "", "30th = allows the most") + HD("Read", "rd", "rs-s2");
  if (!sp.nAst) return gridOf(head, [LB("") + TS("No assists yet this season", "", "", "rs-s7")], { fill: true });
  const rd = (word, s, tip) => TS(word, s === null ? "" : stepStyle(s), tip, "rs-s2");
  const rows = ASSIST_TYPES.map((t, i) => {
    const lift = L.mix[i] ? sp.mix[i] / L.mix[i] : 0, sig = !sp.small && sp.mix[i] >= 0.2 && lift >= 1.3;
    const r = L.typeRank[i].r[x.opp], n = L.typeRank[i].n, d = L.lgPer100[i] ? (L.per100[i][x.opp] || 0) / L.lgPer100[i] - 1 : 0;
    const read = !sig || !r ? rd("--", null, sp.small ? "A Small Sample" : "Not one of his signature types") : r <= 6 ? rd("Over", 1, `His signature type, and ${x.opp} allows the ${ordinal(r)}-most`) : r >= n - 5 ? rd("Under", -1, `His signature type, and ${x.opp} allows the ${ordinal(n - r + 1)}-least`) : rd("Even", 0.1, "");
    return LB(TYPE_NAME[t]) + T(sp.af[i], relS(sp.af[i], sp.af), `${sp.af[i]} of his ${sp.nAst} assists`)
      + T(pct(sp.mix[i]), Math.max(-1, Math.min(1, (lift - 1) * 1.5)), `${pct(sp.mix[i])} of his assists (league ${pct(L.mix[i])})`)
      + T(pct(L.mix[i]), relS(L.mix[i], L.mix), "The league's mix of assists")
      + TS(sgnPct(d), stepStyle(Math.max(-1, Math.min(1, -d * 4))), `${x.opp} allows ${fmt(L.per100[i][x.opp])} a 100 possessions (league ${fmt(L.lgPer100[i])})`)
      + (r ? TS(dTxt(r, n), dStyle(r, n), dWords(r, n)) : TS("--")) + read;
  });
  const ty = sp.fs.find((f) => f.k === "ty");
  const fr = sp.fitRank && sp.fitRank.r[x.opp];
  rows.push(LB("His Whole Mix") + TS(sp.nAst, "", "", "rs-count") + TS("100%", "", "", "rs-count") + TS("", "", "", "rs-blank")
    + (sp.fit === null ? TS("--") : TS(sgnPct(sp.fit), stepStyle(Math.max(-1, Math.min(1, -sp.fit * 10))), `${x.opp} allows his mix ${sgnPct(sp.fit)} vs the league`))
    + (fr ? TS(dTxt(fr, sp.fitRank.n), dStyle(fr, sp.fitRank.n), dWords(fr, sp.fitRank.n)) : TS("--"))
    + rd(pullWord(ty), pullS(ty), ty.tip));
  return gridOf(head, rows, { bands: [BAND("him", 2, 3), BAND("def", 5, 2), BAND("rd", 7, 2)] });
}
function logTab(x) {
  const sp = spotOf(x), f = logFields(), r = rsOf(x.pid), acg = r.acg || {}, k3g = r.k3g || {}, lines = r.linesa || {};
  const games = logOf(x.pid).filter((q) => !x.cut || q[f.date] < x.cut);
  const head = HD("", "plain") + ["Min", "Chances", "Share", "C&amp;S 3s", "AST", "Line"].map((h) => HD(h, "him", "", h === "C&amp;S 3s" ? "Teammates' catch-and-shoot threes while he was on the floor" : h === "Line" ? "His line that night (saved from 11/3)" : "")).join("") + HD("Vs Tonight", "rd");
  const chs = games.map((q) => (acg[String(q[f.game])] || [null])[0]).filter((v) => v !== null);
  const avgCh = avg(chs), avgMin = avg(games.map((q) => q[f.min] || 0));
  const rows = games.slice(-6).reverse().map((q) => {
    const gid = String(q[f.game]), a = acg[gid], k = k3g[gid], then = lines[gid];
    const shr = a && a[0] ? a[1] / a[0] : null, k3 = k && k[1] ? k[0] / k[1] : null, ast = q[f.ast] || 0;
    return LB(`${gameDate(q[f.date])} ${q[f.home] ? "" : "@"}${q[f.opp]}`)
      + T(q[f.min], avgMin ? Math.max(-1, Math.min(1, (q[f.min] - avgMin) / 6)) : null, `${q[f.min]} min (avg ${fmt(avgMin)})`)
      + (a ? T(a[0], avgCh ? Math.max(-1, Math.min(1, (a[0] / avgCh - 1) * 4)) : null, `${a[0]} teammate makes while he played (avg ${fmt(avgCh)})`) : TS("--"))
      + (shr === null ? TS("--") : T(pct(shr), sp.share ? Math.max(-1, Math.min(1, (shr - sp.share) * 10)) : null, `He assisted ${a[1]} of them (season ${pct(sp.share)})`))
      + (k3 === null ? TS("--") : T(`${k[0]}/${k[1]}`, Math.max(-1, Math.min(1, (k3 - 0.36) * 8)), "Teammates' catch-and-shoot threes while he was on the floor"))
      + T(ast, x.line === null ? null : Math.max(-1, Math.min(1, (ast - x.line) / 2)), `${ast} assists`)
      + (then === undefined || then === null ? TS("--") : T(fmt(then), ast > then ? 0.6 : -0.6, `His line that night: ${fmt(then)} (${ast > then ? "cleared" : "missed"})`))
      + (x.line === null ? TS("--") : TS(ast > x.line ? "Over" : "Under", stepStyle(ast > x.line ? 1 : -1), `Against tonight's ${fmt(x.line)}`));
  });
  if (!rows.length) rows.push(LB("") + TS("No games yet this season", "", "", "rs-s7"));
  return gridOf(head, rows, { bands: [BAND("him", 2, 6), BAND("rd", 8, 1)] });
}
function readTab(x) {
  const sp = spotOf(x), call = spotCall(sp.fs), [word, s] = CALL[call];
  const head = HD("", "plain") + HD("Him", "him", "rs-s3") + HD("Tonight", "def", "rs-s3") + HD("Pull", "rd");
  const rows = sp.fs.map((f) => LB(f.name, f.vote || f.small ? "Counts toward the read" : "Context: never makes the call")
    + TS(f.him, "", f.tip, "rs-s3 sp-txt") + TS(f.tonight, f.tsty || "", f.tip, "rs-s3 sp-txt")
    + TS(pullWord(f), f.info ? stepStyle(0.1) : pullS(f) === null ? "" : stepStyle(pullS(f)), f.tip, `sp-txt${f.small ? " rs-small" : ""}`));
  const pulls = sp.fs.filter((f) => f.vote && f.s !== null && Math.abs(f.s) >= LEAN).map((f) => `${f.tag} ${f.s > 0 ? "Over" : "Under"}`);
  rows.push(LB("The Read") + TS(`${word}${pulls.length ? `: ${pulls.join(" &middot; ")}` : ""}`, s === null ? "" : stepStyle(s), "Over / Under when the reads agree, Mixed when they pull both ways. Not a pick: you decide.", "rs-s7"));
  return gridOf(head, rows, { bands: [BAND("him", 2, 3), BAND("def", 5, 3), BAND("rd", 8, 1)] });
}
function lineupTab(x) {
  const sp = spotOf(x);
  const head = HD("Teammate", "plain") + HD("With", "him", "", "His share of teammates' makes with him on the floor") + HD("Without", "him", "", "...and with him off it")
    + HD("If Out", "him", "", "His share without him, minus his season share") + HD("Last 3", "def", "", "Games that teammate played of his team's last 3") + HD("Tonight", "def", "rs-s3");
  if (!sp.lineup.length || sp.share === null) return gridOf(head, [LB("") + TS(`No teammate with ${MIN_SPLIT}+ makes each way yet`, "", "", "rs-s7")], { cls: "rs-wide", fill: true });
  const rows = sp.lineup.slice(0, 6).map((q) => {
    const d = q.off - sp.share;
    return LBc(playerClick(q.id, shortName(q.name)), q.name, q.out ? "rs-out" : "")
      + T(pct(q.on), Math.max(-1, Math.min(1, (q.on - sp.share) * 10)), `${q.nOn} teammate makes with ${q.name}`)
      + T(pct(q.off), Math.max(-1, Math.min(1, d * 10)), `${q.nOff} teammate makes without ${q.name}`)
      + T(`${d >= 0 ? "+" : "&minus;"}${Math.abs(Math.round(d * 100))}`, Math.max(-1, Math.min(1, d * 10)), `Without ${q.name}: ${pct(q.off)} vs ${pct(sp.share)} on the season`)
      + TS(`${q.recent}/3`, "", "", "rs-count")
      + TS(!q.status ? "Playing" : q.isNew ? "Out (New)" : q.out ? "Out" : q.status, q.isNew ? stepStyle(-0.7) : "", q.isNew ? `Played ${q.recent} of the last 3: new` : q.out ? "Out in his last games too: the line already knows" : "", "rs-s3 sp-txt");
  });
  return gridOf(head, rows, { cls: "rs-wide", fill: rows.length < RS_ROWS });
}
Object.assign(RS_TAB, { "Who He Assists": whoTab, "Assist Types": typesTab, "Game Log": logTab, "The Read": readTab, Lineup: lineupTab });
const SPOT_TIPS = {
  "Who He Assists": "Who he passes to (down the side) and how (across): his assists to each teammate by type, the share of his assists to each, his mix by type against the league, and what tonight's defense allows each type and each teammate's position (30th = allows the most, red).",
  "Assist Types": "How he sets them up: his assists by type against the league's mix, beside how many shots of each type tonight's defense allows (30th = the most), and the read on his signature types and his whole mix.",
  "Game Log": "His last 6 games: minutes, chances (teammates' makes while he played), his share of them, how his teammates shot their catch-and-shoot threes, his assists, his line that night and how he did against tonight's line.",
  "The Read": "Every factor in its own row, his side beside tonight's: Targets, Assist Types and Lineup make the call; Chances and Volume are context. Over / Under when they agree, Mixed when they pull both ways.",
  "Vs The Line": RS_TAB_TIP["Vs The Line"],
  Lineup: "His share of his teammates' makes with each teammate on the floor and off it, against his season. A teammate out tonight who played 2 of the last 3 is new: the Lineup read.",
};

// ---- the swap: research.js calls these by name ----
const baseSetMarket = window.setMarket;
window.setMarket = function (m) {
  baseSetMarket(m);
  RS_TABS = SPOT_TABS;
  RS_TAB_TIP = { ...RS_TAB_TIP, ...SPOT_TIPS };
  COLS = spotCols();
};
window.row = spotRow;
setMarket("assists");

// The deploy's freeze (tools/nba_reads_capture.py): every untipped game's reads, exactly what a member
// sees, kept until tip in model_history/nba_assist_spots/<season>.json (a past night shows them).
// {game id: {date, m: {player id: [call, targets, types, lineup, line]}}} (a pull is null when it doesn't vote).
function spotsCapture() {
  const keep = { ...LIST };
  Object.assign(LIST, { game: "", pos: "", every: false });
  const out = {};
  try {
    for (const d of days().filter((day) => !isPast(day))) {
      for (const x of rowsOn(d)) {
        if (x.line === null || x.live) continue;
        const sp = spotOf(x), F = (k) => sp.fs.find((f) => f.k === k);
        const v = (f) => (f.vote && f.s !== null ? Math.round(f.s * 100) / 100 : null);
        const e = (out[String(x.g.game_id)] = out[String(x.g.game_id)] || { date: d, m: {} });
        e.m[x.pid] = [spotCall(sp.fs), v(F("tg")), v(F("ty")), v(F("lu")), x.line];
      }
    }
  } finally {
    Object.assign(LIST, keep);
  }
  return out;
}

// ---- how the reads did (the owner, 2026-11-05: "the same grading feature as the player props ... so
// people can go back and check how it performed") ----
// Every Over / Under read as it stood before tip (spots_frozen), graded against his line then with his
// assists that night (his game log). Mixed and No Read aren't sides, so they aren't graded; a player who
// sat (no log row) or a game not final yet doesn't count. No prices were saved with the reads: W / L only.
// The pull = the votes that leaned that way, added up (1+ by the Read's rule): the tracker's slider.
function spotGraded() {
  const f = logFields(), out = [];
  for (const [gid, e] of Object.entries(RS().spots_frozen || {})) {
    for (const [pid, z] of Object.entries(e.m || {})) {
      const call = z[0], line = z[4];
      if ((call !== 1 && call !== -1) || line === null || line === undefined) continue;
      const night = logOf(pid).find((r) => String(r[f.game]) === String(gid));
      if (!night) continue;
      const ast = night[f.ast] || 0;
      if (ast === line) continue; // a push
      const pull = Math.abs([z[1], z[2], z[3]].filter((v) => v !== null && v !== undefined && Math.sign(v) === call && Math.abs(v) >= LEAN).reduce((a, b) => a + b, 0));
      out.push({ date: e.date, gid, pid, call, line, ast, won: call > 0 ? ast > line : ast < line, pull });
    }
  }
  return out;
}
const spotHit = (gid, pid) => spotGraded().find((g) => String(g.gid) === String(gid) && String(g.pid) === String(pid)) || null;
// one night's tally: {over: [won, lost], under: [won, lost]}
function spotTally(date) {
  const t = { over: [0, 0], under: [0, 0] };
  for (const g of spotGraded().filter((x) => x.date === date)) t[g.call > 0 ? "over" : "under"][g.won ? 0 : 1] += 1;
  return t;
}
function spotLedger() {
  return spotGraded().map((g) => [g.date, Math.round(g.pull * 100) / 100, g.won ? 1 : 0, null, [g.call > 0 ? "over" : "under"]]);
}
function spotYtd() {
  const overlay = ensureBookModal("sp-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="sp-ytd-tracker"></div>
    <p class="no-data-note">Every Over / Under read as it stood before tip (saved from 11/5 on), graded against his line then. Mixed and No Read aren't graded, and players who sat don't count. No prices were saved with the reads, so it's wins and losses only. The slider cuts on how hard the reads pulled: 1 = the least a read needs, 2+ = more than one factor or one pulling hard. Not picks: a record of how the reads did.</p>`;
  ytdTracker(content.querySelector(".sp-ytd-tracker"), {
    key: "nba-assist-spots",
    markets: [{ key: "spots-reads", label: "Assist Reads", short: "Reads", ledger: spotLedger(), min: 1, max: 3, step: 0.5, scale: 1, unit: "+", slider: "Min Pull",
      tip: "Every Over / Under read with at least this much pull", splits: [["over", "Overs"], ["under", "Unders"]] }],
  });
  overlay.hidden = false;
}
document.addEventListener("click", (e) => { if (e.target.closest("#sp-ytd")) spotYtd(); });
// a past night: the tally beside research.js's note
const baseRenderList = window.renderList;
window.renderList = function () {
  baseRenderList();
  if (!PAST) return;
  const t = spotTally(days()[dayIndex]), n = t.over[0] + t.over[1] + t.under[0] + t.under[1];
  const note = document.getElementById("rs-note");
  if (note) note.innerHTML += ` &middot; <b>Reads that night: ${n ? `Over ${t.over[0]}-${t.over[1]}, Under ${t.under[0]}-${t.under[1]}` : "none graded"}</b>`;
};
