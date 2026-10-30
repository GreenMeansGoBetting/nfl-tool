// ---- GMG NBA Suite: Game Predictions, drawn ----
// One game's prediction (nba/predict.py, data.json `predictions`) as two
// pieces both pages use: the Points Ledger (where each team's points come
// from tonight, row by row, adding up to the projected score) and Model Vs
// Book (GMG Score, then a row a team: the book's lines and prices beside our
// own numbers). Shared by the League Stats Chart's Matchup Keys and the Game
// Predictions page; each page defines `team(abbr)` and `logo(abbr, size)`.
// Every piece is a grid in the League Stats Chart's look (style.css .od-grid:
// colored group bands, equal-width tiles; the owner, 2026-10-30).

const PV_ROWS = {
  base: ["League Average", "An average offense against an average defense, at the league's average pace"],
  pace: ["Pace", "More or fewer possessions than an average game, at an average offense's points each"],
  threes: ["Threes", "How often it shoots threes tonight (the shot mix) and how well it makes them, offense and defense together"],
  paint: ["The Paint", "How often it shoots in the paint tonight and how well it finishes"],
  mid: ["Mid-Range", "How often it shoots from mid-range tonight and how well it makes them"],
  tov: ["Turnovers", "Possessions lost to turnovers: its own rate plus how many this defense forces"],
  glass: ["Offensive Glass", "Extra possessions off its own misses: its crashing plus this defense's boxing out"],
  ft: ["Free Throws", "Trips to the line (its own plus this defense's fouling) and how well it shoots them"],
  rest: ["Everything Else", "What the team's real scoring has that the rows above don't (and-ones, late-clock luck), pulled hard toward zero early in the season"],
  home: ["Home Court", "2 points to the home team (split across both scores)"],
};
// Matchup Keys topics -> the ledger rows that put points on them (keys.js topics).
const PV_TOPIC_ROWS = { threes: ["threes"], paint: ["paint"], mid: ["mid"], turnovers: ["tov"], glass: ["glass"], ft: ["ft"], pace: ["pace"] };

const pvSigned = (v) => (v === null || v === undefined ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`);
const pvLine = (v) => (v === null || v === undefined ? "" : v > 0 ? `+${v}` : v === 0 ? "PK" : `${v}`);
const pvPct = (p) => `${(p * 100).toFixed(0)}%`;
// Points shading: green = points for that team, red = points against; full at 4.
const pvShade = (v, full = 4) => {
  const a = Math.min(1, Math.abs(v) / full);
  return a < 0.05 ? "" : ` style="background:${scaleHsla(v > 0 ? 120 : 0, 65, 45, 0.12 + 0.38 * a)}"`;
};
function pvAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
function pvImplied(price) {
  if (price === null || price === undefined) return null;
  const v = Number(price);
  return v < 0 ? -v / (-v + 100) : 100 / (v + 100);
}
const pvRgb = (abbr) => {
  const hex = String(team(abbr).color || "555555").replace("#", "").padEnd(6, "5");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0).join(", ");
};

// A topic's points tonight: {swing (home minus away), total (both added)} or null.
function pvTopicPoints(pred, topic) {
  if (!pred) return null;
  const rows = Object.fromEntries(pred.rows.map((r) => [r[0], r]));
  let a = 0, h = 0;
  if (topic === "diet") {
    // Inside Vs Outside = the shot mix parts of the three zones
    ["threes", "paint", "mid"].forEach((k) => {
      const d = rows[k] && rows[k][3];
      if (d) [a, h] = [a + d[0][0], h + d[1][0]];
    });
  } else if (PV_TOPIC_ROWS[topic]) {
    PV_TOPIC_ROWS[topic].forEach((k) => {
      if (rows[k]) [a, h] = [a + rows[k][1], h + rows[k][2]];
    });
  } else return null;
  return { swing: Math.round((h - a) * 10) / 10, total: Math.round((a + h) * 10) / 10, pace: topic === "pace" };
}
// The chip on a Matchup Keys card: "WSH +3.1" toward the team it helps, and the total's move.
function pvChip(pred, topic) {
  const pts = pvTopicPoints(pred, topic);
  if (!pts) return "";
  const side = pts.swing >= 0 ? pred.home : pred.away;
  const swing = pts.pace ? "" : `<span class="pv-chip"${pvShade(Math.abs(pts.swing))} title="Points this swings tonight, toward ${team(side).name}">${logo(side, 14)}${side} ${pvSigned(Math.abs(pts.swing))}</span>`;
  const total = `<span class="pv-chip pv-chip-total" title="Points this adds to (or takes off) the game total">Total ${pvSigned(pts.total)}</span>`;
  return `<span class="pv-chips">${swing}${total}</span>`;
}
const pvChipSize = (pred, topic) => {
  const pts = pvTopicPoints(pred, topic);
  return pts ? Math.max(Math.abs(pts.swing), Math.abs(pts.total) / 2) : -1;
};

// ---- The grid: the League Stats Chart's look, ONE header row (the owner, 2026-10-30: the band
// over sub-labels read as "two different weird stacks") ----
// groups = [[od-g class, labels]]: labels = an array (one head a column) or [title, n] as a string
// and a count (one head across n columns). rows = [[left cell or null, [[cell html per column] per
// group], tr class]]. `left` = [head, width] for the label column, or null. Stat columns share one width.
const pvTile = (text, shade = "", tip = "", cls = "") => `<div class="od-tile pv-tile${cls ? ` ${cls}` : ""}"${shade}${tip ? ` title="${tip}"` : ""}><b>${text}</b></div>`;
const PV_NONE = `<div class="od-tile pv-tile pv-none"><b>--</b></div>`;
function pvGrid(cls, left, groups, rows) {
  const gap = (tag) => `<${tag} class="od-ggap"></${tag}>`;
  const at = (g, i, n) => `${g} od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const n = (grp) => (Array.isArray(grp[1]) ? grp[1].length : grp[2]);
  const across = (tag, fn) => groups.map((grp, gi) => `${gi ? gap(tag) : ""}${fn(grp, gi)}`).join("");
  const cols = `<colgroup>${left ? `<col style="width:${left[1]}px">` : ""}${groups.map((grp, gi) => `${gi ? '<col class="od-ggap-col">' : ""}${"<col>".repeat(n(grp))}`).join("")}</colgroup>`;
  const head = `<tr class="od-glabels">${left ? `<th class="pv-left-h">${left[0]}</th>` : ""}${across("th", (grp) => {
    const [g, labels] = grp;
    return Array.isArray(labels) ? labels.map((lab, i) => `<th class="${at(g, i, labels.length)}">${lab}</th>`).join("") : `<th class="${at(g, 0, 1)}" colspan="${n(grp)}">${labels}</th>`;
  })}</tr>`;
  const body = rows.map(([lab, cells, trCls]) => `<tr${trCls ? ` class="${trCls}"` : ""}>${left ? `<td class="pv-left">${lab}</td>` : ""}${across("td", (grp, gi) => cells[gi].map((c, i) => `<td class="${at(grp[0], i, cells[gi].length)}">${c}</td>`).join(""))}</tr>`).join("");
  return `<table class="data-table od-grid pv-grid ${cls}">${cols}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}
// A team's logo on a box shaded in its color (the League Stats Chart's team cell).
const pvTeam = (t) => `<div class="pv-team" style="--team:${pvRgb(t)}" title="${team(t).name}">${logo(t, 22)}</div>`;

function pvLedger(pred) {
  const { away, home } = pred;
  const head = (t) => `${logo(t, 14)}${t}`;
  const avgTotal = pred.rows[0][1] + pred.rows[0][2];
  const rows = pred.rows.map(([key, a, h, detail]) => {
    const [name, tip] = PV_ROWS[key];
    const base = key === "base";
    const cell = (t, v, d) => {
      const why = d ? (key === "ft" ? `Trips ${pvSigned(d[0])} · Shooting ${pvSigned(d[1])}` : `Shot Mix ${pvSigned(d[0])} · Makes ${pvSigned(d[1])}`) : "";
      return base ? pvTile(v.toFixed(1)) : pvTile(pvSigned(v) || "0.0", pvShade(v), `${team(t).name} · ${name}${why ? `: ${why}` : ""}`);
    };
    const swing = Math.round((h - a) * 10) / 10;
    const toward = swing >= 0 ? home : away;
    const swingCell = base || key === "pace" || Math.abs(swing) < 0.05 ? PV_NONE : pvTile(`${logo(toward, 14)}${toward} ${pvSigned(Math.abs(swing))}`, pvShade(Math.abs(swing)), `${name}: ${pvSigned(Math.abs(swing))} points toward ${team(toward).name}`);
    const total = pvTile(base ? avgTotal.toFixed(1) : pvSigned(Math.round((a + h) * 10) / 10) || "0.0");
    const label = `<span title="${tip}">${name}${key === "pace" ? ` <span class="muted-label">(${pred.poss} Poss.)</span>` : ""}</span>`;
    return [label, [[cell(away, a, detail && detail[0]), cell(home, h, detail && detail[1])], [swingCell, total]]];
  });
  const win = pred.margin >= 0 ? home : away;
  rows.push(["Projected Score", [[pvTile(pred.pts[0].toFixed(1)), pvTile(pred.pts[1].toFixed(1))], [pvTile(`${logo(win, 14)}${win} ${pvSigned(Math.abs(pred.margin))}`), pvTile(pred.total.toFixed(1))]], "pv-total"]);
  return pvGrid("pv-ledger", ["Point Breakdown", 150], [["od-g1", [head(away), head(home)]], ["od-g2", ["Swing", "Total"]]], rows);
}

// Our number (our spread, our total, our moneyline), shaded by our fair price AT THE BOOK'S
// LINE: green = our chance there is above the book price's, red = below. The chances and that
// price live in the hover (no percent under a price; the owner, 2026-10-30).
function pvOurs(text, p, price, bookLine) {
  if (p === null || p === undefined) return text ? pvTile(text, "", "", "pv-gmg") : PV_NONE;
  const imp = pvImplied(price);
  const edge = imp === null ? 0 : p - imp;
  const at = bookLine ? `At the book's ${bookLine}: ` : "";
  return pvTile(text, pvShade(edge * 100, 8), `${at}our price ${showOdds(pvAmerican(p))} (${pvPct(p)})${imp === null ? "" : ` · the book's ${showOdds(price)} (${pvPct(imp)})`}`, "pv-gmg");
}
// The book's line with its price smaller beside it; a moneyline (no line) is the price, full size.
const pvBook = (line, price) => {
  const has = price !== null && price !== undefined;
  if (!line) return has ? pvTile(showOdds(price)) : PV_NONE;
  return pvTile(`${line}${has ? ` <span class="pv-price">${showOdds(price)}</span>` : ""}`);
};

// GMG Score: each team's projected points on a tile in its color, under one head.
function pvScore(pred) {
  const score = (t, v) => `<div class="pv-score" style="--team:${pvRgb(t)}" title="${team(t).name}: GMG projected points">${logo(t, 26)}<b>${v.toFixed(1)}</b></div>`;
  return pvGrid("pv-proj", null, [["od-g0", "GMG Score", 2]], [[null, [[score(pred.away, pred.pts[0]), score(pred.home, pred.pts[1])]]]]);
}

// A row a team: the book's lines and prices on the left, our own numbers on the right.
// The total reads like a sportsbook: the Over on the road row, the Under on the home row.
function pvLines(pred) {
  const { away, home, book, fair } = pred;
  const spread = (book.spread || []).map(pvLine);
  const tot = book.total === null || book.total === undefined ? null : book.total;
  const ou = (i, v) => (v === null ? "" : `${i ? "U" : "O"} ${v}`);
  // fair_spread is the home side's: the road side's is the same number the other way
  const ourSpread = [-pred.fair_spread, pred.fair_spread].map((v) => pvLine(Math.round(v * 10) / 10) || "PK");
  const ourTotal = pred.total.toFixed(1);
  const row = (t, i) => [pvTeam(t), [
    [pvBook(spread[i] || "", book.spread_odds[i]), pvBook(ou(i, tot), book.total_odds[i]), pvBook("", book.ml[i])],
    [pvOurs(ourSpread[i], fair.spread && fair.spread[i], book.spread_odds[i], spread[i]),
      pvOurs(ou(i, ourTotal), fair.total && fair.total[i], book.total_odds[i], ou(i, tot)),
      pvOurs(showOdds(pvAmerican(fair.ml[i])), fair.ml[i], book.ml[i], "")],
  ]];
  return pvGrid("pv-lines", ["", 56], [
    ["od-g3", ["Book Spread", "Book Total", "Book ML"]],
    ["od-g0", ["GMG Spread", "GMG Total", "GMG ML"]],
  ], [row(away, 0), row(home, 1)]);
}
