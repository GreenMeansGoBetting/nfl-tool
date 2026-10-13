// ---- GMG NHL Suite: shared by every NHL page ----
// The data, the helpers, the rink drawing and the ONE player card. Loaded
// before the page's own script (nhl.js for Game Previews). Like the NBA
// page it stands apart from the NFL site's common.js but shares style.css:
// layout classes are the NBA page's (.nba-*), hockey-only ones are .nhl-*.
// Data: nhl/data.json plus one file per team in nhl/players/ (the card's
// game logs and shot areas), all built by nfl_tool/nhl/build_nhl.py.

// This season only: there is no last-season data on any NHL page (the owner,
// 2026-10-13: "Let's scrap all of last year's data on the site").
let DATA = null;

const el = (id) => document.getElementById(id);
const has = (n) => n !== null && n !== undefined;
const fmt = (n, digits = 1) => (has(n) ? Number(n).toFixed(digits) : "--");
const pct = (n, digits = 1) => (has(n) ? `${(n * 100).toFixed(digits)}%` : "--");
const svPct = (n) => (has(n) ? n.toFixed(3).replace(/^0/, "") : "--");
const signed = (n, digits = 1) => (has(n) ? `${n > 0 ? "+" : ""}${Number(n).toFixed(digits)}` : "--");
const odds = (n) => (has(n) ? (n > 0 ? `+${n}` : `${n}`) : "");
const team = (abbr) => DATA.teams[abbr] || { name: abbr, short: abbr, color: "555555", logo: "" };
const isLight = () => document.documentElement.dataset.theme === "light";
const logoUrl = (abbr) => (isLight() ? team(abbr).logo : team(abbr).logo_dark || team(abbr).logo) || "";
const logo = (abbr, size = 18) => `<img src="${logoUrl(abbr)}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
const stats = () => DATA.team_stats || {};
const viewLabel = () => DATA.season_label;
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr, right = "") {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span>${right ? `<span class="nba-banner-right">${right}</span>` : ""}</div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
const headshot = (p, cls = "nhl-headshot") => (p.headshot ? `<img src="${p.headshot}" alt="" class="${cls}" loading="lazy">` : `<span class="${cls}"></span>`);

// ---- league comparison ----
// z-score of one team's stat against all 32, flipped when lower is better,
// so positive always means "good for the unit this number belongs to".
function zScore(key, abbr, lowerIsBetter) {
  const values = Object.values(stats()).map((s) => s[key]).filter(has);
  const value = (stats()[abbr] || {})[key];
  if (values.length < 3 || !has(value)) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (!sd) return 0;
  return ((value - mean) / sd) * (lowerIsBetter ? -1 : 1);
}
const tierClass = (z) => (z === null ? "" : z >= 0.5 ? "tier-good" : z <= -0.5 ? "tier-bad" : "tier-mid");
function leagueRank(key, abbr, lowerIsBetter) {
  const sorted = Object.entries(stats())
    .filter(([, s]) => has(s[key]))
    .sort((a, b) => (lowerIsBetter ? a[1][key] - b[1][key] : b[1][key] - a[1][key]));
  const i = sorted.findIndex(([t]) => t === abbr);
  return i === -1 ? null : i + 1;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

// ---- league rank on the site's eight colors ----
// The NFL Summary cards' scale (RANK_SCALE in common.js, which NHL pages
// don't load: keep the two lists the same): two greens, lime, yellow, amber,
// orange, red-orange, red, four teams to a step, the ends filled hardest.
// On a rink it says how many shots the matchup points to from a spot, so
// 1st = the most = green and last = the fewest = red.
const RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const rankStep = (rank, total) => Math.min(RANK_SCALE.length - 1, Math.max(0, Math.floor(((rank - 1) / total) * RANK_SCALE.length)));
const stepFill = (step) => `hsla(${RANK_SCALE[step][0]},78%,44%,${RANK_SCALE[step][1]})`;
const stepEdge = (step) => `hsl(${RANK_SCALE[step][0]},78%,48%)`;
// A rink zone on a step (what rinkSvg's zoneFn hands back), and a table cell on one.
const zoneOnStep = (step) => ({ cls: `nhl-zone-rank nhl-zone-step-${step + 1}`, style: `--zone-fill:${stepFill(step)};--zone-edge:${stepEdge(step)}` });
const cellOnStep = (step) => ` style="background-color:${stepFill(step)};box-shadow:inset 0 0 0 1px ${stepEdge(step)}"`;
// The key under a rink: the eight colors, from the most shots to the fewest.
const rankScaleKey = (most, fewest) => `<span class="nhl-scale-key">${most}<span class="g5-scale">${RANK_SCALE.map((_, step) => `<i style="background:${stepFill(step)};border-color:${stepEdge(step)}"></i>`).join("")}</span>${fewest}</span>`;

// ---- the rink ----
// The offensive zone, net at the top, as the shooter sees it. Drawn in feet:
// 85 wide, the end boards at y = 0, the goal line at 11, the blue line at 75.
// The shapes match shot_area() in build_nhl.py (change both together).
const RINK_ZONES = [
  { key: "point", label: "Point", shape: `<rect x="0" y="46" width="85" height="29"/>`, at: [42.5, 58] },
  { key: "left", label: "Left side", shape: `<polygon points="20.5,46 0,46 0,0 42.5,0 42.5,11 33.5,11 33.5,16.95 20.5,31"/>`, at: [11, 29] },
  { key: "right", label: "Right side", shape: `<polygon points="64.5,46 85,46 85,0 42.5,0 42.5,11 51.5,11 51.5,16.95 64.5,31"/>`, at: [74, 29] },
  { key: "slot", label: "Slot", shape: `<polygon points="20.5,31 20.5,46 64.5,46 64.5,31 51.5,16.95 51.5,31 33.5,31 33.5,16.95"/>`, at: [42.5, 34.4] },
  { key: "low_slot", label: "Low slot", shape: `<rect x="33.5" y="11" width="18" height="20"/>`, at: [42.5, 18.6] },
  { key: "long", label: "Outside the zone", shape: `<rect x="0" y="75" width="85" height="9"/>`, at: [42.5, 78.2], small: true },
];
// Tables list the areas from the net out (the drawing order above is back to front).
const AREA_ROWS = ["low_slot", "slot", "left", "right", "point", "long"].map((key) => RINK_ZONES.find((z) => z.key === key));
// One rink. zoneFn(zone) -> { cls, style, tip, big, small, boxes } says how
// each zone is filled and what it reads; the strip outside the zone gets one
// line ("big · small"). Drawn in layers: the zones' colors, the rink's lines
// over them, the numbers on top.
// `boxes` ([{ text, step, w }], in place of `small`) is a row of small boxes
// under the big number, each on its own rank color (`step`, as rankStep
// gives it): the three things a defense allows from that zone. Sized so three
// fit across the low slot, the narrowest zone (18 ft).
const ZONE_BOX = { w: 5.5, h: 3.7, gap: 0.4 };
function zoneBoxes(x, top, boxes) {
  const widths = boxes.map((b) => b.w || ZONE_BOX.w);
  let left = x - (widths.reduce((a, w) => a + w, 0) + (boxes.length - 1) * ZONE_BOX.gap) / 2;
  return boxes
    .map((b, i) => {
      const at = `x="${left.toFixed(2)}" y="${top.toFixed(2)}" width="${widths[i]}" height="${ZONE_BOX.h}" rx="0.7"`;
      const mid = left + widths[i] / 2;
      left += widths[i] + ZONE_BOX.gap;
      // A solid back first, so a box stands out from a zone filled with the same color.
      return `<g class="nhl-zone-box${has(b.step) ? ` nhl-zone-box-step-${b.step + 1}` : ""}"><rect class="nhl-zone-box-back" ${at}/><rect class="nhl-zone-box-fill" ${at}${has(b.step) ? ` style="fill:${stepFill(b.step)};stroke:${stepEdge(b.step)}"` : ""}/><text x="${mid.toFixed(2)}" y="${(top + 2.62).toFixed(2)}">${b.text}</text></g>`;
    })
    .join("");
}
function rinkSvg(uid, ariaLabel, zoneFn) {
  let shapes = "";
  let labels = "";
  RINK_ZONES.forEach((z) => {
    const d = zoneFn(z) || {};
    const [x, y] = z.at;
    shapes += `<g class="nhl-zone${d.cls ? ` ${d.cls}` : ""}"${d.style ? ` style="${d.style}"` : ""}><title>${d.tip || z.label}</title>${z.shape}</g>`;
    // The small print over a colored zone is drawn in the full text color so it stays readable.
    labels += `<g${d.cls ? ` class="nhl-zone-on-color"` : ""}>${z.small
      ? `<text class="nhl-zone-label" x="${x}" y="${y + 2.4}">${z.label}: ${d.big ?? "--"}${d.small ? ` &middot; ${d.small}` : ""}</text>`
      : d.boxes
        ? `<text class="nhl-zone-label" x="${x}" y="${y}">${z.label}</text><text class="nhl-zone-big nhl-zone-big-boxed" x="${x}" y="${y + 5.9}">${d.big ?? "--"}</text>${zoneBoxes(x, y + 7, d.boxes)}`
        : `<text class="nhl-zone-label" x="${x}" y="${y}">${z.label}</text><text class="nhl-zone-big" x="${x}" y="${y + 6.6}">${d.big ?? "--"}</text>${d.small ? `<text class="nhl-zone-small" x="${x}" y="${y + 10.4}">${d.small}</text>` : ""}`}</g>`;
  });
  return `<svg class="nhl-rink" viewBox="0 0 85 84" role="img" aria-label="${ariaLabel}">
      <defs><clipPath id="${uid}"><path d="M0,84 L0,28 A28,28 0 0 1 28,0 L57,0 A28,28 0 0 1 85,28 L85,84 Z"/></clipPath></defs>
      <g clip-path="url(#${uid})">
        <rect class="nhl-ice" x="0" y="0" width="85" height="84"/>
        ${shapes}
        <g class="nhl-marks">
          <line class="nhl-goal-line" x1="0" y1="11" x2="85" y2="11"/>
          <line class="nhl-blue-line" x1="0" y1="75" x2="85" y2="75"/>
          <circle cx="20.5" cy="31" r="15"/><circle cx="64.5" cy="31" r="15"/>
          <circle class="nhl-dot" cx="20.5" cy="31" r="1"/><circle class="nhl-dot" cx="64.5" cy="31" r="1"/>
          <path class="nhl-crease" d="M36.5,11 A6,6 0 0 0 48.5,11 Z"/>
          <rect class="nhl-net" x="39.5" y="7.7" width="6" height="3.3"/>
        </g>
        <g class="nhl-zone-text">${labels}</g>
      </g>
      <path class="nhl-boards" d="M0,84 L0,28 A28,28 0 0 1 28,0 L57,0 A28,28 0 0 1 85,28 L85,84"/>
    </svg>`;
}

// ---- the player card ----
// The ONE popup for every skater and goalie on every NHL page. Wrap any name
// or photo with playerClick(id, inner) and it opens the card: Game Log, Shot
// Map and Odds.
const PLAYER_FILES = {}; // team -> promise of its players file (null if it can't be read)
function loadTeamPlayers(abbr) {
  if (!PLAYER_FILES[abbr]) {
    PLAYER_FILES[abbr] = fetch(`players/${abbr}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return PLAYER_FILES[abbr];
}
// { kind: "skater" | "goalie", row } for a player id, from the page's data.
function findPlayer(id) {
  for (const [kind, group] of [["skater", DATA.skaters], ["goalie", DATA.goalies]]) {
    for (const rows of Object.values(group || {})) {
      const row = rows.find((p) => p.id === id);
      if (row) return { kind, row };
    }
  }
  return null;
}
function playerClick(id, inner) {
  return id && findPlayer(id) ? `<span class="player-click" data-player="${id}">${inner}</span>` : inner;
}
// The game the card talks about: the one open on the page if this player's
// team is in it, else that team's next game on the schedule.
function playerGame(abbr) {
  const open = typeof currentGame === "function" ? currentGame() : null;
  if (open && [open.away, open.home].includes(abbr)) return open;
  return DATA.schedule.find((g) => g.status !== "final" && [g.away, g.home].includes(abbr)) || null;
}

let playerCardState = null; // { id, tab, file }
const CARD_TABS = [["log", "Game Log"], ["map", "Shot Map"], ["odds", "Odds"]];

// Shade a log cell against the player's own games (same thirds as the NFL card).
function selfTier(v, pool) {
  const vals = pool.filter(has);
  if (!has(v) || vals.length < 2) return ` class="num"`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return ` class="num"`;
  const q = (v - lo) / (hi - lo);
  if (q >= 0.67) return ` class="num tier-good" style="--tier-a:${(0.1 + 0.22 * ((q - 0.67) / 0.33)).toFixed(2)}"`;
  if (q <= 0.33) return ` class="num tier-bad" style="--tier-a:${(0.1 + 0.22 * ((0.33 - q) / 0.33)).toFixed(2)}"`;
  return ` class="num tier-mid"`;
}
// Goals, assists and points are zero most nights: light up the nights he
// scored instead of painting every zero red.
const scoredTier = (v) => (v > 0 ? ` class="num tier-good" style="--tier-a:${Math.min(0.32, 0.1 + 0.08 * v).toFixed(2)}"` : ` class="num"`);
const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
// A player's season in his team's file, as rows of named fields.
function cardLog(file, kind, id) {
  const group = file && file[kind === "goalie" ? "goalies" : "skaters"];
  const season = group && group[id] && group[id].season;
  if (!season) return { season: null, rows: [] };
  const cols = [...file.log_lead, ...(kind === "goalie" ? file.goalie_cols : file.skater_cols)];
  const rows = season.log.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))).reverse();
  return { season, rows };
}
function resultCell(r) {
  const won = r.gf > r.ga;
  const label = won ? "W" : r.ended === "REG" ? "L" : "OTL";
  return `<td><span class="pick-result pick-result-${won ? "win" : label === "L" ? "loss" : "push"}">${label}</span> ${r.gf}-${r.ga}${r.ended !== "REG" ? ` <span class="muted-label">${r.ended}</span>` : ""}</td>`;
}
function logTable(cols, rows, avgLabel) {
  if (!rows.length) return `<p class="no-data-note">No ${viewLabel()} games on file.</p>`;
  const pools = cols.map((c) => (c.shade ? rows.map((r) => c.get(r)) : null));
  const body = rows
    .map((r) => `<tr><td>${shortDate(r.date)}</td><td>${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}</td>${resultCell(r)}${cols.map((c, i) => `<td${c.scored ? scoredTier(c.get(r)) : c.shade ? selfTier(c.get(r), pools[i]) : ' class="num"'}>${c.show ? c.show(r) : c.get(r)}</td>`).join("")}</tr>`)
    .join("");
  const avg = cols.map((c) => `<td class="num">${c.avg ? c.avg(rows) : ""}</td>`).join("");
  return `<div class="nhl-pc-scroll"><table class="data-table nhl-pc-log">
      <thead><tr><th>Date</th><th>Opp</th><th>Result</th>${cols.map((c) => `<th${c.title ? ` title="${c.title}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody><tr class="nhl-pc-avg"><td colspan="3">${avgLabel} (${rows.length} games)</td>${avg}</tr>${body}</tbody>
    </table></div>`;
}
const mean = (rows, get, digits = 1) => fmt(rows.reduce((a, r) => a + get(r), 0) / rows.length, digits);
const total = (rows, get) => rows.reduce((a, r) => a + get(r), 0);
function skaterLogView(rows) {
  const col = (label, key, title) => ({ label, title, get: (r) => r[key], shade: key === "sog" || key === "att", scored: key === "g" || key === "a", avg: (all) => mean(all, (r) => r[key], key === "sog" || key === "att" ? 1 : 2) });
  return logTable(
    [
      { label: "TOI", title: "Ice time", get: (r) => r.toi, show: (r) => minutes(r.toi), shade: true, avg: (all) => minutes(Math.round(total(all, (r) => r.toi) / all.length)) },
      col("G", "g"),
      col("A", "a"),
      { label: "Pts", get: (r) => r.g + r.a, scored: true, avg: (all) => mean(all, (r) => r.g + r.a, 2) },
      col("SOG", "sog", "Shots on goal"),
      col("Att", "att", "Shot attempts: on goal, wide or blocked"),
      { label: "PPP", title: "Power play points", get: (r) => r.ppp, avg: (all) => mean(all, (r) => r.ppp, 2) },
      { label: "Hits", get: (r) => r.hits, avg: (all) => mean(all, (r) => r.hits) },
      { label: "Blk", title: "Blocked shots", get: (r) => r.blk, avg: (all) => mean(all, (r) => r.blk) },
      { label: "+/-", get: (r) => r.pm, show: (r) => (r.pm > 0 ? `+${r.pm}` : r.pm), avg: (all) => signed(total(all, (r) => r.pm), 0) },
      { label: "PIM", title: "Penalty minutes", get: (r) => r.pim, avg: (all) => mean(all, (r) => r.pim) },
    ],
    rows,
    "Per game"
  );
}
function goalieLogView(rows) {
  const sv = (sa, ga) => (sa ? (sa - ga) / sa : null);
  return logTable(
    [
      { label: "Role", get: (r) => r.start, show: (r) => (r.start ? "Start" : "Relief") },
      { label: "Dec", title: "Decision: win, loss or overtime loss", get: (r) => r.dec, show: (r) => (r.dec === "O" ? "OTL" : r.dec || "--") },
      { label: "TOI", get: (r) => r.toi, show: (r) => minutes(r.toi), avg: (all) => minutes(Math.round(total(all, (r) => r.toi) / all.length)) },
      { label: "Shots", title: "Shots on goal against", get: (r) => r.sa, shade: true, avg: (all) => mean(all, (r) => r.sa) },
      { label: "Saves", get: (r) => r.sa - r.ga, shade: true, avg: (all) => mean(all, (r) => r.sa - r.ga) },
      { label: "GA", title: "Goals against", get: (r) => r.ga, avg: (all) => mean(all, (r) => r.ga, 2) },
      { label: "SV%", get: (r) => sv(r.sa, r.ga), show: (r) => svPct(sv(r.sa, r.ga)), shade: true, avg: (all) => svPct(sv(total(all, (r) => r.sa), total(all, (r) => r.ga))) },
      { label: "Low slot", title: "Low-slot shots faced and goals allowed on them", get: (r) => r.hd_sa, show: (r) => `${r.hd_sa - r.hd_ga}/${r.hd_sa}`, avg: (all) => svPct(sv(total(all, (r) => r.hd_sa), total(all, (r) => r.hd_ga))) },
    ],
    rows,
    "Per game"
  );
}

// ---- Shot Map tab ----
// The league's numbers this season: { area: { share, sh_pct } }.
const leagueAreas = () => (DATA.league || {}).season || {};
const SMALL_SAMPLE_GAMES = 10;
const HEAT_MIN_ALPHA = 0.04;
const HEAT_MAX_ALPHA = 0.7;
// What the other team's defense gives up from an area, on the eight rank
// colors from the shooter's side, the same color as that zone on the rink
// beside it: green = allows the most from there, red = the fewest.
const allowsRank = (opp, area) => (opp ? leagueRank(`def_${area}_pg`, opp, false) : null); // 1st = allows the most
const teamCount = () => Object.keys(stats()).length || 32;
function oppAllowsCell(opp, area) {
  if (!opp) return "";
  const value = (stats()[opp] || {})[`def_${area}_pg`];
  const rank = allowsRank(opp, area);
  // Like the strip on the rink, the row for shots from outside the zone is never colored: too rare to read.
  return `<td class="num nhl-rank-cell"${rank && area !== "long" ? cellOnStep(rankStep(rank, teamCount())) : ""} title="${opp} allows the ${rank ? ordinal(rank) : "?"} most shots from here">${fmt(value)}<small class="nhl-pc-rank">${rank ? ` ${ordinal(rank)} most` : ""}</small></td>`;
}
function skaterMapView(season, games, opp, uid) {
  const areas = season.areas || {};
  const located = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
  if (!located) return `<p class="no-data-note">No ${viewLabel()} shots on file.</p>`;
  const league = leagueAreas();
  const most = Math.max(...RINK_ZONES.map((z) => (areas[z.key] || [])[0] || 0));
  let expected = 0;
  let scored = 0;
  const rows = AREA_ROWS.map((z) => {
    const [shots = 0, onGoal = 0, goals = 0] = areas[z.key] || [];
    const lg = league[z.key] || {};
    expected += onGoal * (lg.sh_pct || 0);
    scored += goals;
    return `<tr><td>${z.label}</td><td class="num"><b>${fmt(shots / games)}</b></td><td class="num">${pct(shots / located, 0)}</td><td class="num">${onGoal}</td><td class="num">${goals}</td><td class="num">${onGoal ? pct(goals / onGoal) : "--"}</td><td class="num muted-label">${pct(lg.sh_pct)}</td>${oppAllowsCell(opp, z.key)}</tr>`;
  }).join("");
  // Every zone is colored by what the other team allows from there (the same
  // chart as the Shots page's "Where he shoots"). With no game to read it
  // against, the zones are shaded by his own shots instead.
  const svg = rinkSvg(uid, "Where he shoots from", (z) => {
    const [shots = 0, , goals = 0] = areas[z.key] || [];
    const rank = z.small ? null : allowsRank(opp, z.key);
    // Squared, so his favorite spot stands out from the places he merely visits.
    const alpha = shots ? HEAT_MIN_ALPHA + (shots / most) ** 2 * (HEAT_MAX_ALPHA - HEAT_MIN_ALPHA) : 0;
    const fill = rank ? zoneOnStep(rankStep(rank, teamCount())) : shots && !z.small && !opp ? { cls: "nhl-zone-heat", style: `--heat:${alpha.toFixed(2)}` } : {};
    return {
      ...fill,
      big: fmt(shots / games),
      small: z.small ? "" : `${pct(shots / located, 0)} &middot; ${goals} G`,
      tip: `${z.label}: ${shots} shots in ${games} games, ${goals} goals${rank ? `. ${opp} allows the ${ordinal(rank)} most shots from here` : ""}`,
    };
  });
  const colorNote = opp
    ? `The color is what ${opp} allows from that spot: ${rankScaleKey("the most", "the fewest")}`
    : "Brighter green = more of his shots.";
  const types = Object.entries(season.types || {})
    .sort((a, b) => b[1][0] - a[1][0])
    .map(([name, [shots, goals]]) => `<span class="nhl-pc-chip"><b>${name[0].toUpperCase()}${name.slice(1)}</b> ${pct(shots / located, 0)}<small>${goals} G</small></span>`)
    .join("");
  return `<div class="nhl-pc-map">
      <div class="nhl-pc-rink">${svg}<p class="section-note">Shots per game from each area (on goal or wide). Below each: share of his shots and goals from there. ${colorNote}</p></div>
      <div class="nhl-pc-side">
        <div class="nhl-pc-scroll"><table class="data-table nhl-pc-areas">
          <thead><tr><th>Area</th><th title="Shots per game, on goal or wide">Shots / g</th><th title="Share of his shots">Share</th><th>On goal</th><th>Goals</th><th title="Goals per shot on goal from here">Sh%</th><th title="The league's shooting % from here">Lg Sh%</th>${opp ? `<th title="Shots per game ${opp} allows from here, and where that ranks">${opp} allows</th>` : ""}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="nhl-pc-facts">
          <span class="nhl-pc-chip" title="What a league-average shooter would score on the same shots on goal from the same areas"><b>From these spots</b> ${fmt(expected)} goals expected<small>he scored ${scored}</small></span>
          <span class="nhl-pc-chip"><b>Power play</b> ${pct(season.unb ? season.pp_unb / season.unb : null, 0)} of his shots</span>
        </div>
        <div class="nhl-pc-facts">${types}</div>
      </div>
    </div>`;
}
// A goalie's zones are colored only when the gap from the league's save rate
// there is bigger than luck alone would explain on that many shots: at least
// GOALIE_AREA_MIN_SHOTS faced, and goals allowed GOALIE_AREA_Z standard
// deviations away from what the league gives up on them. Returns
// "tier-good" (fewer goals than expected), "tier-bad" or "".
const GOALIE_AREA_Z = 1.5;
const GOALIE_AREA_MIN_SHOTS = 30;
function goalieAreaTier(shots, goals, leagueShPct) {
  const spread = Math.sqrt(shots * leagueShPct * (1 - leagueShPct));
  if (shots < GOALIE_AREA_MIN_SHOTS || !spread) return "";
  const z = (shots * leagueShPct - goals) / spread;
  return z >= GOALIE_AREA_Z ? "tier-good" : z <= -GOALIE_AREA_Z ? "tier-bad" : "";
}
function goalieMapView(season, games, uid) {
  const areas = season.areas || {};
  const faced = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
  if (!faced) return `<p class="no-data-note">No ${viewLabel()} shots on file.</p>`;
  const league = leagueAreas();
  let expectedAll = 0;
  let allowedAll = 0;
  const read = (z) => {
    const [shots = 0, goals = 0] = areas[z.key] || [];
    const p = (league[z.key] || {}).sh_pct || 0;
    return { shots, goals, p, expected: shots * p, tier: goalieAreaTier(shots, goals, p) };
  };
  const rows = AREA_ROWS.map((z) => {
    const a = read(z);
    expectedAll += a.expected;
    allowedAll += a.goals;
    return `<tr><td>${z.label}</td><td class="num"><b>${fmt(a.shots / games)}</b></td><td class="num">${pct(a.shots / faced, 0)}</td><td class="num">${a.goals}</td><td class="num ${a.tier}"><b>${a.shots ? svPct(1 - a.goals / a.shots) : "--"}</b></td><td class="num muted-label">${svPct(1 - a.p)}</td><td class="num">${signed(a.expected - a.goals)}</td></tr>`;
  }).join("");
  const svg = rinkSvg(uid, "Where the shots he faces come from", (z) => {
    const a = read(z);
    return {
      cls: z.small || !a.tier ? "" : a.tier === "tier-good" ? "nhl-zone-more" : "nhl-zone-fewer",
      big: a.shots ? svPct(1 - a.goals / a.shots) : "--",
      small: z.small ? "" : `${a.shots} shots &middot; ${a.goals} GA`,
      tip: `${z.label}: ${a.shots} shots on goal, ${a.goals} goals; the league saves ${svPct(1 - a.p)} from here`,
    };
  });
  return `<div class="nhl-pc-map">
      <div class="nhl-pc-rink">${svg}<p class="section-note">Save % on shots from each area. Green or red only where the gap from the league is more than luck would explain on that many shots.</p></div>
      <div class="nhl-pc-side">
        <div class="nhl-pc-scroll"><table class="data-table nhl-pc-areas">
          <thead><tr><th>Area</th><th title="Shots on goal faced per game">Shots / g</th><th title="Share of the shots he faces">Share</th><th title="Goals against">GA</th><th>SV%</th><th title="The league's save % from here">Lg SV%</th><th title="Goals saved against what a league-average goalie allows on the same shots (+ is good)">Saved vs avg</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="nhl-pc-facts"><span class="nhl-pc-chip" title="What a league-average goalie would allow on the same shots from the same areas"><b>From these spots</b> ${fmt(expectedAll)} goals expected<small>he allowed ${allowedAll}</small></span></div>
      </div>
    </div>`;
}

// ---- Odds tab ----
function oddsView(id, game) {
  const o = game ? ((DATA.player_odds || {})[game.game_id] || {})[id] : null;
  if (!o) return `<p class="no-data-note">No lines posted for this player${game ? "" : " (no game on the schedule)"}.</p>`;
  const chance = (c) => (has(c) ? `${Math.round(c * 100)}%` : "--");
  const thin = (m) => (m.thin ? ` <span class="nhl-pc-thin" title="Barely traded: treat the price with care">thin</span>` : "");
  const rows = [];
  if (o.goal) rows.push(`<tr><td>Anytime goal${thin(o.goal)}</td><td class="num props-line">--</td><td class="num"><b>${odds(o.goal.odds)}</b></td><td class="num">${odds(o.goal.no_odds) || "--"}</td><td class="num">${chance(o.goal.chance)}</td></tr>`);
  if (o.first_goal) rows.push(`<tr><td>First goal${thin(o.first_goal)}</td><td class="num props-line">--</td><td class="num"><b>${odds(o.first_goal.odds)}</b></td><td class="num">--</td><td class="num">${chance(o.first_goal.chance)}</td></tr>`);
  [["sog", "Shots on goal"], ["points", "Points"], ["assists", "Assists"], ["saves", "Saves"]].forEach(([key, label]) => {
    const m = o[key];
    if (m) rows.push(`<tr><td>${label}${thin(m)}</td><td class="num props-line">${fmt(m.line)}</td><td class="num"><b>${odds(m.over) || "--"}</b></td><td class="num">${odds(m.under) || "--"}</td><td class="num">${chance(m.chance)}</td></tr>`);
  });
  // The other lines the book prices, as "N or more" (over 2.5 = 3+).
  const ladder = (label, alts) =>
    (alts || []).length ? `<div class="nhl-pc-facts"><span class="nhl-pc-ladder">${label}</span>${alts.map(([strike, price]) => `<span class="nhl-pc-chip"><b>${Math.ceil(strike)}+</b> ${odds(price)}</span>`).join("")}</div>` : "";
  if (!rows.length && !o.sog_alts && !o.goal_alts && !o.saves_alts) return `<p class="no-data-note">No lines posted for this player.</p>`;
  return `<div class="nhl-pc-scroll"><table class="data-table player-odds-table nhl-pc-odds">
      <thead><tr><th>Market</th><th class="num">Line</th><th class="num">Over / Yes</th><th class="num">Under / No</th><th class="num" title="The price with the book's cut taken out">Chance</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    ${ladder("Shots on goal", o.sog_alts)}${ladder("Goals", o.goal_alts)}${ladder("Saves", o.saves_alts)}
    <p class="section-note">Novig, ${game.away} @ ${game.home}${game.lines_locked ? ", locked at puck drop" : ""}.</p>`;
}

function ensurePlayerCard() {
  if (el("player-card-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "player-card-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pc-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="player-card-content"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePlayerCard();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePlayerCard);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlayerCard();
  });
}
function closePlayerCard() {
  if (el("player-card-modal")) el("player-card-modal").hidden = true;
  playerCardState = null;
}
function renderPlayerCard() {
  const { id, tab, file } = playerCardState;
  const found = findPlayer(id);
  if (!found) return `<p class="no-data-note">Player not found.</p>`;
  const { kind, row } = found;
  const s = row;
  const game = playerGame(row.team);
  const opp = game ? (game.away === row.team ? game.home : game.away) : null;
  const rgb = teamRgb(row.team);
  const facts = [kind === "goalie" ? "G" : row.pos, row.shoots ? `Shoots ${row.shoots}` : "", `${logo(row.team, 16)} ${team(row.team).name}`, opp ? `${game.away === row.team ? "@" : "vs"} ${logo(opp, 16)} ${opp} ${shortDate(game.date)}` : ""].filter(Boolean);
  const head = `<div class="pc-head" style="background:rgba(${rgb},0.22);border-left:4px solid rgb(${rgb})">
      ${headshot(row, "nhl-pc-photo")}
      <div class="pc-id"><div class="pc-name">${row.name}</div><div class="pc-sub">${facts.join(" &middot; ")}</div></div>
    </div>`;
  const tile = (label, value) => `<div class="nba-tile"><div class="gs-tile-label">${label}</div><b>${value}</b></div>`;
  const tiles = !s
    ? `<p class="no-data-note">No ${viewLabel()} games.</p>`
    : kind === "goalie"
      ? `<div class="nba-tiles nhl-pc-tiles">${tile("Games", s.games)}${tile("Starts", s.starts)}${tile("Record", s.record)}${tile("SV%", svPct(s.sv_pct))}${tile("GAA", fmt(s.gaa, 2))}${tile("Shots / start", fmt(s.sa_pg))}${tile("Low slot SV%", svPct(s.hd_sv_pct))}</div>`
      : `<div class="nba-tiles nhl-pc-tiles">${tile("Games", s.games)}${tile("TOI", fmt(s.toi))}${tile("Goals", s.g)}${tile("Assists", s.a)}${tile("Points", s.p)}${tile("SOG / game", fmt(s.sog_pg))}${tile("PP TOI", fmt(s.pp_toi))}</div>`;
  const tabs = CARD_TABS.map(([key, label]) => `<button type="button" class="player-modal-toggle-btn nhl-pc-tab${tab === key ? " active" : ""}" data-tab="${key}">${label}</button>`).join("");
  let body;
  if (tab === "odds") body = oddsView(id, game);
  else if (file === undefined) body = `<p class="no-data-note">Loading&hellip;</p>`;
  else {
    const { season, rows } = cardLog(file, kind, id);
    const small = rows.length && rows.length < SMALL_SAMPLE_GAMES ? `<p class="no-data-note">Small sample: ${rows.length} game${rows.length === 1 ? "" : "s"} this season.</p>` : "";
    if (!season) body = `<p class="no-data-note">No ${viewLabel()} games on file.</p>`;
    else if (tab === "map") body = small + (kind === "goalie" ? goalieMapView(season, rows.length, "nhl-pc-rink-clip") : skaterMapView(season, rows.length, opp, "nhl-pc-rink-clip"));
    else body = small + (kind === "goalie" ? goalieLogView(rows) : skaterLogView(rows));
  }
  return `${head}${tiles}
    <div class="player-modal-toggle nhl-pc-tabs">${tabs}</div>
    <div id="player-modal-body">${body}</div>`;
}
function refreshPlayerCard() {
  if (playerCardState) el("player-card-content").innerHTML = renderPlayerCard();
}
function openPlayerCard(id, tab = "log") {
  const found = DATA && findPlayer(id);
  if (!found) return;
  ensurePlayerCard();
  playerCardState = { id, tab, file: undefined };
  refreshPlayerCard();
  el("player-card-modal").hidden = false;
  loadTeamPlayers(found.row.team).then((file) => {
    if (playerCardState && playerCardState.id === id) {
      playerCardState.file = file;
      refreshPlayerCard();
    }
  });
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest("#player-card-modal .nhl-pc-tab");
  if (tab && playerCardState) {
    playerCardState.tab = tab.dataset.tab;
    return refreshPlayerCard();
  }
  const name = e.target.closest(".player-click[data-player]");
  if (name) return openPlayerCard(name.dataset.player);
  if (e.target.closest("#theme-toggle")) {
    const light = !isLight();
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
    if (DATA && typeof render === "function") render(); // the logos have a light and a dark version
    refreshPlayerCard();
  }
});

// Every NHL page starts here: read data.json, then draw.
function loadNhlData() {
  return fetch("data.json")
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      return data;
    });
}
