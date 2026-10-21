// ---- NBA shot charts (the owner, 2026-10-21: "as detailed as possible ... frequency and success") ----
// Draws one player's shots from nba/shots.json (nfl_tool/nba/shots.py): THIS season only.
//   Zones    -- 12 areas (rim, paint, five mid-range, both corners, both wing 3s,
//               top 3): made / tried, make rate, share of his shots; colored by
//               his make rate against the league's from the same area.
//   Heat Map -- hexagons: size = how often he shoots from there, color = his make
//               rate from around that spot against the league's from the same spot.
// Filters: games (Season / Last 10 / Last 5), 2PT / 3PT, how the shot came
// (self-created, catch and shoot, drives and cuts), time (1st Qtr, first 3 min).
// The basket is at the top, so the left of the drawing is the shooter's left.
// Used by the player card (nba-card.js); built to be reused by a Shot Charts page.
// Every name here starts with nbaShot / NBA_SHOT.

let NBA_SHOT_FILE; // nba/shots.json: undefined until asked for, then a promise, then the file (null if it can't be read)
const NBA_SHOT_STATE = { view: "zones", games: "all", pts: "all", kind: "all", time: "all" };
const NBA_SHOT_OPTIONS = [
  ["view", [["zones", "Zones"], ["heat", "Heat Map"]]],
  ["games", [["all", "Season"], ["10", "Last 10"], ["5", "Last 5"]]],
  ["pts", [["all", "All Shots"], ["2", "2PT"], ["3", "3PT"]]],
  ["kind", [["all", "Every Type"], ["1", "Self-Created"], ["2", "Catch & Shoot"], ["3", "Drives & Cuts"]]],
  ["time", [["all", "Full Game"], ["q1", "1st Qtr"], ["open", "First 3 Min"]]],
];
const NBA_SHOT_PX = 9; // pixels a foot
const NBA_SHOT_W = 50 * NBA_SHOT_PX;
const NBA_SHOT_H = 36 * NBA_SHOT_PX; // baseline to 30.75 ft out from the basket
const NBA_SHOT_ARC_Y = Math.sqrt(23.75 ** 2 - 22 ** 2); // where the 3-point arc meets the corner lines
const NBA_SHOT_PRIOR = 6; // color only: his make rate is pulled toward the league's by 6 shots
const NBA_SHOT_FULL = 0.08; // full color at 8 points above / below the league
const NBA_SHOT_HEX = 1.6; // hexagon size, feet
const NBA_SHOT_NEAR = 3.5; // the heat map's color reads every shot this close to a hexagon
const NBA_SHOT_SMALL = 50; // fewer shots than this = a small-sample note
let nbaShotUid = 0;

function nbaShotFile() {
  if (NBA_SHOT_FILE === undefined) {
    NBA_SHOT_FILE = fetch("shots.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((file) => (NBA_SHOT_FILE = file));
  }
  return NBA_SHOT_FILE instanceof Promise ? undefined : NBA_SHOT_FILE;
}

// ---- zones ----
// x, y: feet (x 0-50 across, the basket at 25; y out from the basket). three: 1 / 0.
function nbaShotZone(x, y, three) {
  const dx = x - 25;
  const deg = (Math.atan2(Math.max(y, 0), dx) * 180) / Math.PI; // 0 = right baseline, 90 = straight out, 180 = left baseline
  if (three) {
    if (Math.abs(dx) >= 22 && y <= 9) return dx > 0 ? "c3R" : "c3L";
    return deg < 60 ? "w3R" : deg < 120 ? "t3" : "w3L";
  }
  if (Math.hypot(dx, y) <= 4) return "ra";
  if (Math.abs(dx) <= 8 && y <= 13.75) return "paint";
  return ["mBR", "mWR", "mT", "mWL", "mBL"][Math.min(Math.floor(deg / 36), 4)];
}
// The table's groups, left to right across the floor; the label spot on the drawing (feet).
const NBA_SHOT_GROUPS = [
  ["Close", [["ra", "At The Rim", [0, 1.6]], ["paint", "Paint", [0, 9]]]],
  ["Mid-Range", [["mBL", "Left Baseline", [-14.5, 4.5]], ["mWL", "Left Wing", [-13, 13.5]], ["mT", "Top", [0, 18.5]], ["mWR", "Right Wing", [13, 13.5]], ["mBR", "Right Baseline", [14.5, 4.5]]]],
  ["Threes", [["c3L", "Left Corner", [-21.2, 1]], ["w3L", "Left Wing", [-19.5, 22]], ["t3", "Top", [0, 27.3]], ["w3R", "Right Wing", [19.5, 22]], ["c3R", "Right Corner", [21.2, 1]]]],
];

// ---- drawing helpers ----
const nbaShotX = (dx) => (dx + 25) * NBA_SHOT_PX;
const nbaShotY = (dy) => (dy + 5.25) * NBA_SHOT_PX;
const nbaShotPct = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : "--");
// Red below the league, green above (the member's color set, through scaleHsla).
function nbaShotColor(diff, alpha = 1) {
  const t = Math.max(-1, Math.min(1, diff / NBA_SHOT_FULL));
  const hue = 60 + 60 * t;
  return typeof scaleHsla === "function" ? scaleHsla(hue, 75, 45, alpha) : `hsla(${hue},75%,45%,${alpha})`;
}
// His make rate pulled toward the league's, minus the league's (color only; the numbers shown are his own).
const nbaShotDiff = (m, a, lg) => (lg === null ? 0 : (m + NBA_SHOT_PRIOR * lg) / (a + NBA_SHOT_PRIOR) - lg);

function nbaShotWedge(a0, a1) {
  const pts = [[nbaShotX(0), nbaShotY(0)]];
  for (let k = 0; k <= 12; k++) {
    const a = ((a0 + ((a1 - a0) * k) / 12) * Math.PI) / 180;
    pts.push([nbaShotX(80 * Math.cos(a)), nbaShotY(80 * Math.sin(a))]);
  }
  return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" L")}Z`;
}
const NBA_SHOT_R = 23.75 * NBA_SHOT_PX;
const NBA_SHOT_ARC = `M${nbaShotX(-22)},${nbaShotY(-6)} L${nbaShotX(-22)},${nbaShotY(NBA_SHOT_ARC_Y)} A${NBA_SHOT_R},${NBA_SHOT_R} 0 0 0 ${nbaShotX(22)},${nbaShotY(NBA_SHOT_ARC_Y)} L${nbaShotX(22)},${nbaShotY(-6)} Z`;
const NBA_SHOT_PAINT = `M${nbaShotX(-8)},${nbaShotY(-6)} H${nbaShotX(8)} V${nbaShotY(13.75)} H${nbaShotX(-8)} Z`;
const NBA_SHOT_RA = `M${nbaShotX(-4)},${nbaShotY(-6)} V${nbaShotY(0)} A${4 * NBA_SHOT_PX},${4 * NBA_SHOT_PX} 0 0 0 ${nbaShotX(4)},${nbaShotY(0)} V${nbaShotY(-6)} Z`;
// zone: [area, mask] -- the mid-range wedges are cut to inside the arc and outside the paint, the 3s to outside the arc.
const NBA_SHOT_AREAS = {
  ra: [NBA_SHOT_RA, null],
  paint: [NBA_SHOT_PAINT, "ra"],
  mBR: [nbaShotWedge(-30, 36), "mid"],
  mWR: [nbaShotWedge(36, 72), "mid"],
  mT: [nbaShotWedge(72, 108), "mid"],
  mWL: [nbaShotWedge(108, 144), "mid"],
  mBL: [nbaShotWedge(144, 210), "mid"],
  c3R: [`M${nbaShotX(22)},${nbaShotY(-6)} H${nbaShotX(26)} V${nbaShotY(9)} H${nbaShotX(22)} Z`, null],
  c3L: [`M${nbaShotX(-26)},${nbaShotY(-6)} H${nbaShotX(-22)} V${nbaShotY(9)} H${nbaShotX(-26)} Z`, null],
  w3R: [nbaShotWedge(-10, 60), "three"],
  t3: [nbaShotWedge(60, 120), "three"],
  w3L: [nbaShotWedge(120, 190), "three"],
};
function nbaShotDefs(uid) {
  const all = `<rect x="-99" y="-99" width="999" height="999"`;
  return `<defs><clipPath id="nbs-court${uid}"><rect width="${NBA_SHOT_W}" height="${NBA_SHOT_H}"/></clipPath>
    <mask id="nbs-mid${uid}">${all} fill="black"/><path d="${NBA_SHOT_ARC}" fill="white"/><path d="${NBA_SHOT_PAINT}" fill="black"/></mask>
    <mask id="nbs-three${uid}">${all} fill="white"/><path d="${NBA_SHOT_ARC}" fill="black"/><rect width="${NBA_SHOT_W}" height="${nbaShotY(9)}" fill="black"/></mask>
    <mask id="nbs-ra${uid}">${all} fill="white"/><path d="${NBA_SHOT_RA}" fill="black"/></mask></defs>`;
}
function nbaShotLines() {
  const X = nbaShotX;
  const Y = nbaShotY;
  const px = NBA_SHOT_PX;
  return `<g class="nba-shot-lines">
    <rect width="${NBA_SHOT_W}" height="${NBA_SHOT_H}"/>
    <path d="M${X(-22)},${Y(-5.25)} L${X(-22)},${Y(NBA_SHOT_ARC_Y)} A${NBA_SHOT_R},${NBA_SHOT_R} 0 0 0 ${X(22)},${Y(NBA_SHOT_ARC_Y)} L${X(22)},${Y(-5.25)}"/>
    <rect x="${X(-8)}" y="${Y(-5.25)}" width="${16 * px}" height="${19 * px}"/>
    <circle cx="${X(0)}" cy="${Y(13.75)}" r="${6 * px}"/>
    <path d="M${X(-4)},${Y(0)} A${4 * px},${4 * px} 0 0 0 ${X(4)},${Y(0)}"/>
    <line x1="${X(-3)}" y1="${Y(-1.25)}" x2="${X(3)}" y2="${Y(-1.25)}"/>
    <circle cx="${X(0)}" cy="${Y(0)}" r="${0.75 * px}"/></g>
    <text class="nba-shot-side" x="8" y="${NBA_SHOT_H - 8}" text-anchor="start">Left Side</text>
    <text class="nba-shot-side" x="${NBA_SHOT_W - 8}" y="${NBA_SHOT_H - 8}" text-anchor="end">Right Side</text>`;
}
const nbaShotSvg = (uid, inner) =>
  `<svg class="nba-shot-svg" viewBox="0 0 ${NBA_SHOT_W} ${NBA_SHOT_H}" role="img">${nbaShotDefs(uid)}<g clip-path="url(#nbs-court${uid})"><rect class="nba-shot-floor" width="${NBA_SHOT_W}" height="${NBA_SHOT_H}"/>${inner}</g></svg>`;

// ---- the numbers ----
// His shots after the filters. shot = [x, y, made, three, game index, flags, kind].
function nbaShotPick(shots, state) {
  let keep = shots;
  if (state.games !== "all") {
    const games = [...new Set(shots.map((s) => s[4]))].sort((a, b) => a - b).slice(-Number(state.games));
    keep = keep.filter((s) => games.includes(s[4]));
  }
  if (state.pts !== "all") keep = keep.filter((s) => s[3] === (state.pts === "3" ? 1 : 0));
  if (state.kind !== "all") keep = keep.filter((s) => s[6] === Number(state.kind));
  if (state.time === "q1") keep = keep.filter((s) => s[5] & 1);
  if (state.time === "open") keep = keep.filter((s) => s[5] & 2);
  return keep;
}
// {zone: [made, tried]} for a list of [x, y, three, made, tried] spots or shots.
function nbaShotZoneTotals(rows, fromLeague) {
  const out = {};
  rows.forEach((r) => {
    const [z, m, a] = fromLeague ? [nbaShotZone(r[0], r[1], r[2]), r[3], r[4]] : [nbaShotZone(r[0], r[1], r[3]), r[2], 1];
    const t = (out[z] = out[z] || [0, 0]);
    t[0] += m;
    t[1] += a;
  });
  return out;
}

// ---- Zones ----
function nbaShotZonesView(shots, league) {
  const uid = ++nbaShotUid;
  const mine = nbaShotZoneTotals(shots, false);
  const lg = nbaShotZoneTotals(league, true);
  const lgRate = (z) => (lg[z] && lg[z][1] ? lg[z][0] / lg[z][1] : null);
  const total = shots.length;
  let fills = "";
  let labels = "";
  NBA_SHOT_GROUPS.forEach(([, zones]) =>
    zones.forEach(([z, , [lx, ly]]) => {
      const [area, mask] = NBA_SHOT_AREAS[z];
      const [m, a] = mine[z] || [0, 0];
      const fill = a ? nbaShotColor(nbaShotDiff(m, a, lgRate(z)), 0.78) : "rgba(135,151,176,0.14)";
      fills += `<path d="${area}" fill="${fill}"${mask ? ` mask="url(#nbs-${mask}${uid})"` : ""} class="nba-shot-zone" data-zone="${z}"/>`;
      if (!a) return;
      labels += `<g transform="translate(${nbaShotX(lx).toFixed(0)},${nbaShotY(ly).toFixed(0)})" class="nba-shot-tag">
        <rect x="-31" y="-22" width="62" height="44" rx="6"/>
        <text y="-8" class="nba-shot-ma">${m}/${a}</text><text y="8" class="nba-shot-pct">${nbaShotPct(m, a)}</text>
        <text y="18" class="nba-shot-share">${Math.round((a / total) * 100)}% of FGA</text></g>`;
    }),
  );
  const legend = `<div class="nba-shot-legend"><span>Below League</span><b class="nba-shot-scale">${[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map((t) => `<i style="background:${nbaShotColor(t * NBA_SHOT_FULL, 0.85)}"></i>`).join("")}</b><span>Above League</span></div>`;
  return `${nbaShotSvg(uid, fills + nbaShotLines() + labels)}${legend}`;
}
// The zone table beside the drawing: every area named, his make rate vs the league's.
function nbaShotTable(shots, league) {
  const mine = nbaShotZoneTotals(shots, false);
  const lg = nbaShotZoneTotals(league, true);
  const total = shots.length;
  const rows = NBA_SHOT_GROUPS.map(([group, zones]) => {
    const body = zones
      .map(([z, name]) => {
        const [m, a] = mine[z] || [0, 0];
        const lr = lg[z] && lg[z][1] ? lg[z][0] / lg[z][1] : null;
        const vs = a && lr !== null ? Math.round((m / a - lr) * 100) : null;
        const tint = a ? ` style="background:${nbaShotColor(nbaShotDiff(m, a, lr), 0.32)}"` : "";
        return `<tr><td>${name}</td><td class="num">${a ? `${m}/${a}` : "--"}</td><td class="num"${tint}><b>${nbaShotPct(m, a)}</b></td><td class="num">${vs === null ? "--" : `${vs > 0 ? "+" : ""}${vs}`}</td><td class="num">${total ? `${Math.round((a / total) * 100)}%` : "--"}</td></tr>`;
      })
      .join("");
    return `<tr class="nba-shot-group"><td colspan="5">${group}</td></tr>${body}`;
  }).join("");
  return `<table class="data-table nba-shot-table"><thead><tr><th>Zone</th><th class="num">FG</th><th class="num">FG%</th><th class="num" title="His make rate minus the league's from the same zone, in points">vs Lg</th><th class="num" title="Share of his shots">Share</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- Heat Map ----
// Flat-top hexagons NBA_SHOT_HEX feet across the corners; [q, r] axial coordinates.
function nbaShotHexOf(dx, dy) {
  const R = NBA_SHOT_HEX;
  const q = ((2 / 3) * dx) / R;
  const r = ((-1 / 3) * dx + (Math.sqrt(3) / 3) * dy) / R;
  let [rx, ry, rz] = [Math.round(q), Math.round(-q - r), Math.round(r)];
  const [ex, ey, ez] = [Math.abs(rx - q), Math.abs(ry + q + r), Math.abs(rz - r)];
  if (ex > ey && ex > ez) rx = -ry - rz;
  else if (ey <= ez) rz = -rx - ry;
  return [rx, rz];
}
const nbaShotHexCenter = (q, r) => [NBA_SHOT_HEX * 1.5 * q, NBA_SHOT_HEX * Math.sqrt(3) * (r + q / 2)];
function nbaShotHexPath(cx, cy, size) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    pts.push(`${(nbaShotX(cx) + size * NBA_SHOT_PX * Math.cos(a)).toFixed(1)},${(nbaShotY(cy) + size * NBA_SHOT_PX * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}Z`;
}
function nbaShotHeatView(shots, league) {
  const bins = new Map();
  shots.forEach((s) => {
    const [q, r] = nbaShotHexOf(s[0] - 25, s[1]);
    const key = `${q},${r}`;
    if (!bins.has(key)) bins.set(key, { q, r, shots: [] });
    bins.get(key).shots.push(s);
  });
  const counts = [...bins.values()].map((b) => b.shots.length).sort((a, b) => a - b);
  const top = Math.max(3, counts[Math.floor(counts.length * 0.92)] || 0); // the size scale tops out here, so one hot spot can't shrink the rest
  const near = (x, y, cx, cy) => Math.hypot(x - 25 - cx, y - cy) <= NBA_SHOT_NEAR;
  const hexes = [...bins.values()]
    .sort((a, b) => a.shots.length - b.shots.length)
    .map((b) => {
      const [cx, cy] = nbaShotHexCenter(b.q, b.r);
      const three = b.shots.filter((s) => s[3]).length * 2 >= b.shots.length ? 1 : 0;
      // his shots of the same kind (2 or 3) around this spot, and the league's
      const his = shots.filter((s) => s[3] === three && near(s[0], s[1], cx, cy));
      let lm = 0;
      let la = 0;
      league.forEach((c) => {
        if (c[2] === three && near(c[0], c[1], cx, cy)) {
          lm += c[3];
          la += c[4];
        }
      });
      const made = his.reduce((n, s) => n + s[2], 0);
      const diff = nbaShotDiff(made, his.length, la ? lm / la : null);
      const size = NBA_SHOT_HEX * (0.3 + 0.7 * Math.sqrt(Math.min(b.shots.length / top, 1)));
      const own = b.shots.reduce((n, s) => n + s[2], 0);
      return `<path d="${nbaShotHexPath(cx, cy, size * 0.98)}" fill="${nbaShotColor(diff)}" class="nba-shot-hex"><title>${own}/${b.shots.length} here, ${nbaShotPct(made, his.length)} around this spot (league ${nbaShotPct(lm, la)})</title></path>`;
    })
    .join("");
  const hex = (size, fill) => `<svg width="22" height="20" viewBox="-11 -10 22 20"><path d="${[0, 1, 2, 3, 4, 5].map((k) => `${k ? "L" : "M"}${(size * Math.cos((Math.PI / 3) * k)).toFixed(1)},${(size * Math.sin((Math.PI / 3) * k)).toFixed(1)}`).join(" ")}Z" fill="${fill}"/></svg>`;
  const legend = `<div class="nba-shot-legend"><span>Colder</span>${[-1, -0.5, 0, 0.5, 1].map((t) => hex(9, nbaShotColor(t * NBA_SHOT_FULL))).join("")}<span>Hotter</span>
    <span class="nba-shot-gap"></span><span>Fewer</span>${[3.5, 6, 8, 10].map((s) => hex(s, "var(--muted)")).join("")}<span>More Shots</span></div>`;
  return `${nbaShotSvg(++nbaShotUid, nbaShotLines() + hexes)}${legend}`;
}

// ---- the whole view ----
// id: ESPN player id. Returns HTML; buttons change NBA_SHOT_STATE and fire "nba-shot-changed".
function nbaShotView(id) {
  const file = nbaShotFile();
  if (file === undefined) return `<p class="no-data-note">Loading&hellip;</p>`;
  if (!file) return `<p class="no-data-note">Shot charts aren't available right now.</p>`;
  const all = (file.players || {})[String(id)] || [];
  if (!all.length) return `<p class="no-data-note">No shots this season yet.</p>`;
  const state = NBA_SHOT_STATE;
  const shots = nbaShotPick(all, state);
  const controls = NBA_SHOT_OPTIONS.map(
    ([key, opts]) => `<div class="nba-shot-seg">${opts.map(([v, label]) => `<button type="button" class="nba-shot-opt${state[key] === v ? " active" : ""}" data-shot-key="${key}" data-shot-value="${v}">${label}</button>`).join("")}</div>`,
  ).join("");
  const games = new Set(shots.map((s) => s[4])).size;
  const made = shots.reduce((n, s) => n + s[2], 0);
  const threes = shots.filter((s) => s[3]);
  const threesMade = threes.reduce((n, s) => n + s[2], 0);
  const noteId = `nba-shot-note-${id}`;
  const summary = `<div class="nba-shot-sum"><b>${shots.length}</b> Shots &middot; <b>${games}</b> Game${games === 1 ? "" : "s"} &middot; FG <b>${made}/${shots.length}</b> (${nbaShotPct(made, shots.length)}) &middot; 3PT <b>${threesMade}/${threes.length}</b> (${nbaShotPct(threesMade, threes.length)})
    <button type="button" class="info-i" aria-controls="${noteId}" aria-expanded="false" title="How to read it">i</button></div>
    <div class="info-note" id="${noteId}" hidden>This season's shots only. Color = his make rate against the league's from the same area (green above, red below); areas with only a few shots are pulled toward the league for the color, the numbers are his own. Heat Map: a bigger hexagon = more of his shots from that spot, its color reads every shot within 3.5 feet. The basket is at the top, so Left Side is the shooter's left. Spots are ESPN's, to the nearest foot; heaves (35+ ft) and free throws are left out.</div>`;
  const small = shots.length && shots.length < NBA_SHOT_SMALL ? `<p class="no-data-note">Small sample: ${shots.length} shot${shots.length === 1 ? "" : "s"}.</p>` : "";
  const chart = !shots.length
    ? `<p class="no-data-note">No shots with these filters.</p>`
    : `<div class="nba-shot-body"><div class="nba-shot-chart">${state.view === "heat" ? nbaShotHeatView(shots, file.league || []) : nbaShotZonesView(shots, file.league || [])}</div>${nbaShotTable(shots, file.league || [])}</div>`;
  return `<div class="nba-shot"><div class="nba-shot-controls">${controls}</div>${summary}${small}${chart}</div>`;
}

document.addEventListener("click", (e) => {
  const opt = e.target.closest(".nba-shot-opt");
  if (!opt) return;
  e.stopPropagation();
  NBA_SHOT_STATE[opt.dataset.shotKey] = opt.dataset.shotValue;
  document.dispatchEvent(new CustomEvent("nba-shot-changed"));
}, true);
