// ---- GMG NBA Suite: Game Predictions, drawn ----
// One game's prediction (nba/predict.py, data.json `predictions`) as two
// pieces both pages use: the Points Ledger (where each team's points come
// from tonight, row by row, adding up to the projected score) and Model Vs
// Book (the book's lines beside our fair prices). Shared by the League Stats
// Chart's Matchup Keys and the Game Predictions page; each page defines
// `team(abbr)` and `logo(abbr, size)`.

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

function pvLedger(pred) {
  const { away, home } = pred;
  const head = (t) => `<th class="pv-team-h">${logo(t, 18)}${t}</th>`;
  const avgTotal = pred.rows[0][1] + pred.rows[0][2];
  const body = pred.rows.map(([key, a, h, detail]) => {
    const [name, tip] = PV_ROWS[key];
    const base = key === "base";
    const cell = (v, d) => {
      const why = d ? (key === "ft" ? `Trips ${pvSigned(d[0])} · Shooting ${pvSigned(d[1])}` : `Shot Mix ${pvSigned(d[0])} · Makes ${pvSigned(d[1])}`) : "";
      return base ? `<td><b>${v.toFixed(1)}</b></td>` : `<td${pvShade(v)}${why ? ` title="${why}"` : ""}><b>${pvSigned(v)}</b></td>`;
    };
    const swing = Math.round((h - a) * 10) / 10;
    const toward = swing >= 0 ? home : away;
    const swingCell = base || key === "pace" || Math.abs(swing) < 0.05 ? `<td class="muted-label">--</td>` : `<td${pvShade(Math.abs(swing))}><span class="pv-swing">${logo(toward, 14)}${toward} ${pvSigned(Math.abs(swing))}</span></td>`;
    const total = base ? `<td><b>${avgTotal.toFixed(1)}</b></td>` : `<td><b>${pvSigned(Math.round((a + h) * 10) / 10)}</b></td>`;
    return `<tr><td class="pv-label" title="${tip}">${name}${key === "pace" ? ` <span class="muted-label">(${pred.poss} Poss.)</span>` : ""}</td>${cell(a, detail && detail[0])}${cell(h, detail && detail[1])}${swingCell}${total}</tr>`;
  }).join("");
  const win = pred.margin >= 0 ? home : away;
  const foot = `<tr class="pv-total"><td class="pv-label">Projected Score</td><td><b>${pred.pts[0].toFixed(1)}</b></td><td><b>${pred.pts[1].toFixed(1)}</b></td>
    <td><span class="pv-swing">${logo(win, 14)}${win} ${pvSigned(Math.abs(pred.margin))}</span></td><td><b>${pred.total.toFixed(1)}</b></td></tr>`;
  return `<table class="data-table pv-table pv-ledger"><thead><tr><th class="pv-label">Points From</th>${head(away)}${head(home)}<th title="The row's points, net, toward the team it helps">Swing</th><th title="The row's points added to the game total">Total</th></tr></thead>
    <tbody>${body}${foot}</tbody></table>`;
}

// Our fair price beside the book's: big American price, chance small under; shaded by
// how far our chance is above (green) or below (red) the book price's.
function pvFair(p, price) {
  if (p === null || p === undefined) return `<td class="muted-label">--</td>`;
  const imp = pvImplied(price);
  const edge = imp === null ? 0 : p - imp;
  return `<td${pvShade(edge * 100, 8)} title="Our chance ${pvPct(p)}${imp === null ? "" : ` · the book price's ${pvPct(imp)}`}"><b>${showOdds(pvAmerican(p))}</b><small>${pvPct(p)}</small></td>`;
}
const pvBook = (line, price) => (line === null && (price === null || price === undefined) ? `<td class="muted-label">--</td>` : `<td>${line === null ? "" : `<b>${line}</b> `}${price === null || price === undefined ? "" : `<span class="pv-price">${showOdds(price)}</span>`}</td>`);

function pvLines(pred) {
  const { away, home, book, fair } = pred;
  const head = (t) => `<th class="pv-team-h">${logo(t, 18)}${t}</th>`;
  const spread = book.spread.map(pvLine);
  const side = `<table class="data-table pv-table pv-lines"><thead><tr><th class="pv-label"></th>${head(away)}${head(home)}</tr></thead><tbody>
    <tr><td class="pv-label">Spread (Book)</td>${pvBook(spread[0] || null, book.spread_odds[0])}${pvBook(spread[1] || null, book.spread_odds[1])}</tr>
    <tr><td class="pv-label">Spread (Fair)</td>${fair.spread ? pvFair(fair.spread[0], book.spread_odds[0]) + pvFair(fair.spread[1], book.spread_odds[1]) : `<td colspan="2" class="muted-label">No line yet</td>`}</tr>
    <tr><td class="pv-label">Moneyline (Book)</td>${pvBook(null, book.ml[0])}${pvBook(null, book.ml[1])}</tr>
    <tr><td class="pv-label">Moneyline (Fair)</td>${pvFair(fair.ml[0], book.ml[0])}${pvFair(fair.ml[1], book.ml[1])}</tr>
  </tbody></table>`;
  const tot = book.total;
  const total = `<table class="data-table pv-table pv-lines"><thead><tr><th class="pv-label"></th><th>Over</th><th>Under</th></tr></thead><tbody>
    <tr><td class="pv-label">Total (Book)</td>${pvBook(tot === null ? null : `O ${tot}`, book.total_odds[0])}${pvBook(tot === null ? null : `U ${tot}`, book.total_odds[1])}</tr>
    <tr><td class="pv-label">Total (Fair)</td>${fair.total ? pvFair(fair.total[0], book.total_odds[0]) + pvFair(fair.total[1], book.total_odds[1]) : `<td colspan="2" class="muted-label">No line yet</td>`}</tr>
  </tbody></table>`;
  const fav = pred.fair_spread <= 0 ? home : away;
  const summary = `<div class="pv-summary"><span>GMG Projection</span><b>${logo(away, 18)}${away} ${pred.pts[0].toFixed(0)}</b><b>${logo(home, 18)}${home} ${pred.pts[1].toFixed(0)}</b>
    <span>Fair Spread</span><b>${fav} ${pvLine(-Math.abs(pred.fair_spread))}</b><span>Fair Total</span><b>${pred.total.toFixed(1)}</b></div>`;
  return `${summary}<div class="pv-lines-row">${side}${total}</div>`;
}
