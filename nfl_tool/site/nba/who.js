// ---- GMG NBA Suite: who's behind a matchup number (who.js) ----
// A member, 2026-11-09: click Paint FG% "and have it pop up with a few players that score high in paint
// for that team ... a good amount of guards who score primarily in paint too"; the owner added
// transition ("assists or scoring in transition") and then every colored box on Matchup Keys
// (Overview, Categories, Summary). whoOpen(topic, game) opens both teams' players for that topic:
// this season's per-game numbers from props.json (nba-card.js loads it), rotation players only
// (WHO_MIN minutes, WHO_GP games), the top WHO_TOP by the topic's main number plus anyone top 3 in its
// `also` number. Every number a tile colored by where it sits among the league's rotation players
// (green = more; turnovers red = more). Numbers only, no calls. Pace, totals and records have no
// player split, so they open nothing. Transition reads props.json research `trans` / `ap`.
// whoTopic(key) maps a league-chart column (o_paint_pct ...) or a Matchup row (paint_pct ...) to a topic;
// whoAttr(key) is the attribute a clickable tile carries. Uses: DATA, nba-card.js (nbaCardProps,
// nbaCardSeason, playerClick), sync.js (scaleHsla).
const WHO_MIN = 12;
const WHO_GP = 3;
const WHO_TOP = 6;
const pctW = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
const numW = (v) => (v === null || v === undefined ? "--" : v.toFixed(1));
// [label, key, format, hover, flip (more is bad: red)]
const WHO_COLS = {
  pts: ["PTS", "pts", numW, "Points a game"], fga: ["FGA", "fga", numW, "Shots a game"], fgp: ["FG%", "fgp", pctW, "Field goal %"],
  tov: ["TOV", "tov", numW, "Turnovers a game", true], stl: ["STL", "stl", numW, "Steals a game"],
  oreb: ["OREB", "oreb", numW, "Offensive rebounds a game"], dreb: ["DREB", "dreb", numW, "Defensive rebounds a game"], reb: ["REB", "reb", numW, "Rebounds a game"],
  fta: ["FTA", "fta", numW, "Free throws tried a game"], ftp: ["FT%", "ftp", pctW, "Free throw %"],
  fg3a: ["3PA", "fg3a", numW, "Threes tried a game"], fg3m: ["3PM", "fg3m", numW, "Threes made a game"], fg3p: ["3P%", "fg3p", pctW, "Three-point %"],
  paintA: ["Paint FGA", "paintA", numW, "Shots at the rim and in the paint a game"], paintP: ["Paint FG%", "paintP", pctW, "FG% at the rim and in the paint"],
  midA: ["Mid FGA", "midA", numW, "Mid-range shots a game"], midP: ["Mid FG%", "midP", pctW, "Mid-range FG%"],
  transP: ["Trans PTS", "transP", numW, "Points a game in transition (off a miss or steal, shot within 8 seconds)"],
  transS: ["% Of His PTS", "transS", pctW, "Share of his points that came in transition"],
  transA: ["Trans AST", "transA", numW, "Assists a game in transition"],
  ast: ["AST", "ast", numW, "Assists a game"], catchS: ["Catch & Shoot", "catchS", pctW, "Share of his shots that are catch-and-shoot"], assisted: ["Assisted", "assisted", pctW, "Share of his makes that were assisted"],
};
// row key -> what the popup shows: title, columns, main sort, also-include, the team share column
// topic -> what the popup shows: title, columns, main sort, also-include, the team share column
const WHO = {
  scoring: { title: "Scoring", cols: ["pts", "fga", "fgp"], sort: "pts", share: "pts" },
  transition: { title: "Transition", cols: ["transP", "transS", "transA"], sort: "transP", also: "transA", share: "transP" },
  turnovers: { title: "Turnovers & Steals", cols: ["tov", "stl"], sort: "tov", also: "stl", share: "tov" },
  glass: { title: "Rebounding", cols: ["oreb", "dreb", "reb"], sort: "oreb", also: "dreb", share: "oreb" },
  ft: { title: "Free Throws", cols: ["fta", "ftp"], sort: "fta", share: "fta" },
  threes: { title: "Threes", cols: ["fg3a", "fg3m", "fg3p"], sort: "fg3a", share: "fg3a" },
  paint: { title: "Paint Scoring", cols: ["paintA", "paintP"], sort: "paintA", share: "paintA" },
  mid: { title: "Mid-Range", cols: ["midA", "midP"], sort: "midA", share: "midA" },
  ballmove: { title: "Ball Movement", cols: ["ast", "catchS", "assisted"], sort: "ast", also: "catchS", share: "ast" },
};
// a number's key without its o_ / d_ side -> topic (league-cols.js keys and The Matchup's identity rows)
const WHO_TOPIC = {
  rtg: "scoring", ppg: "scoring", ppp: "scoring", ball_move: "ballmove",
  trans_freq: "transition", trans_ppp: "transition",
  "3pm": "threes", "3par": "threes", three_rate: "threes",
  paint_share: "paint", paint_pct: "paint", mid_share: "mid", mid_pct: "mid",
  tov: "turnovers", tov_rate: "turnovers", reb: "glass", oreb_rate: "glass", ftr: "ft", fta_rate: "ft",
};
const whoTopic = (key) => (key ? WHO_TOPIC[String(key).replace(/^[od]_/, "")] || null : null);
// A clickable box: its topic and the ONE matchup it reads (the owner, 2026-11-09: "if im clicking on one
// teams offense, its because i think theres an edge to be explored at a player level, so populating the
// defensive teams offense is a waste"): off / def = the offense and the defense in it, left = which of
// the two sits on the left (the order the two boxes are drawn in, so the popup reads the same way).
// No teams (a Summary stat name) = both directions.
const whoAttr = (key, off = null, def = null, left = "o") =>
  (!whoTopic(key) ? "" : ` data-who="${whoTopic(key)}"${off && def ? ` data-o="${off}" data-d="${def}" data-l="${left}"` : ""}`);
// For a tile of team t on number key (o_ / d_ side) against opp; first = it's the first of its pair.
function whoTile_(key, t, opp, first) {
  const side = String(key).startsWith("d_") ? "d" : "o";
  const off = side === "o" ? t : opp, def = side === "o" ? opp : t;
  return whoAttr(key, off, def, first ? side : side === "o" ? "d" : "o");
}
// The directions a clicked box opens: [{off, def, left}].
function whoDirs(el, g) {
  if (el.dataset.o && el.dataset.d) return [{ off: el.dataset.o, def: el.dataset.d, left: el.dataset.l || "o" }];
  return [{ off: g.away, def: g.home, left: "o" }, { off: g.home, def: g.away, left: "o" }];
}
const whoEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const whoTeamOf = (abbr) => (DATA.teams || {})[abbr] || { name: abbr, color: "555555", logo: "" };
const whoRgb = (abbr) => [0, 2, 4].map((i) => parseInt((whoTeamOf(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
let WHO_PLAYERS = null; // [{id, name, team, pos, gp, min, ...per game}] for the season, built once
function whoPlayers() {
  if (WHO_PLAYERS) return WHO_PLAYERS;
  const s = nbaCardSeason();
  if (!s) return null;
  const F = s.fields;
  const at = (k) => F.indexOf(k);
  const out = [];
  for (const [id, p] of Object.entries(s.players || {})) {
    const log = p.log || [];
    if (!log.length) continue;
    const sum = (k) => (at(k) < 0 ? null : log.reduce((n, r) => n + (Number(r[at(k)]) || 0), 0));
    const pg = (k) => { const t = sum(k); return t === null ? null : t / log.length; };
    const rate = (m, a) => (a ? m / a : null);
    const zn = p.zones || {};
    const zp = p.zone_pct || {}; // zone -> [his make rate, shots]
    const rs = ((nbaCardProps() || {}).research || {}).players?.[id] || {};
    const fga = pg("fga");
    const paintShare = (zn.rim || 0) + (zn.short || 0);
    const [rimR, rimN] = zp.rim || [0, 0];
    const [shortR, shortN] = zp.short || [0, 0];
    const paintP = rimN + shortN ? ((rimR || 0) * rimN + (shortR || 0) * shortN) / (rimN + shortN) : null;
    out.push({
      id, name: p.name, team: p.team, pos: p.pos, gp: log.length, min: pg("min"),
      pts: pg("pts"), fga, fgp: rate(sum("fgm"), sum("fga")), tov: pg("tov"), stl: pg("stl"),
      oreb: pg("oreb"), dreb: pg("dreb"), reb: pg("reb"), fta: pg("fta"), ftp: rate(sum("ftm"), sum("fta")),
      fg3a: pg("fg3a"), fg3m: pg("fg3m"), fg3p: rate(sum("fg3m"), sum("fg3a")),
      paintA: fga === null ? null : fga * paintShare, paintP,
      midA: fga === null || zn.mid === undefined ? null : fga * zn.mid, midP: zp.mid && zp.mid[1] ? zp.mid[0] : null,
      ast: pg("ast"), catchS: (p.kinds || {}).catch ?? null, assisted: p.assisted ?? null,
      // research.py: trans = [points on transition possessions, all points], ap = [chances, assists, transition assists]
      transP: rs.trans ? rs.trans[0] / log.length : null, transS: rs.trans && rs.trans[1] ? rs.trans[0] / rs.trans[1] : null,
      transA: rs.ap ? (rs.ap[2] || 0) / log.length : null,
    });
  }
  return (WHO_PLAYERS = out);
}
const whoRotation = (list) => list.filter((x) => x.gp >= WHO_GP && (x.min || 0) >= WHO_MIN);
// where v sits among the league's rotation players on key: 0 (least) .. 1 (most)
function whoPct(key, v) {
  if (v === null || v === undefined) return null;
  const vals = whoRotation(whoPlayers()).map((x) => x[key]).filter((x) => x !== null && x !== undefined);
  return vals.length ? (vals.filter((x) => x < v).length + 0.5 * vals.filter((x) => x === v).length) / vals.length : null;
}
function whoTile(key, v, fmtV, tip, flip = false) {
  const raw = whoPct(key, v);
  const p = raw === null ? null : flip ? 1 - raw : raw;
  const style = p === null ? "" : ` style="background:${scaleHsla(Math.round(p * 120), 70, 45, 0.32)}"`;
  return `<td class="mb-v"${style} title="${whoEsc(tip)}"><b>${fmtV(v)}</b></td>`;
}
function whoTeam(abbr, spec) {
  const out = new Set(((DATA.injuries || {})[abbr] || []).filter((p) => p.status === "Out").map((p) => String(p.id)));
  const dtd = new Set(((DATA.injuries || {})[abbr] || []).filter((p) => p.status !== "Out").map((p) => String(p.id)));
  const mine = whoPlayers().filter((x) => x.team === abbr);
  const rot = whoRotation(mine);
  const by = (k) => [...rot].filter((x) => x[k] !== null && x[k] !== undefined).sort((a, b) => b[k] - a[k]);
  const pick = by(spec.sort).slice(0, WHO_TOP);
  if (spec.also) by(spec.also).slice(0, 3).forEach((x) => !pick.includes(x) && pick.push(x));
  const total = mine.reduce((n, x) => n + (x[spec.share] || 0) * x.gp, 0);
  const cols = spec.cols.map((k) => WHO_COLS[k]);
  const head = `<tr class="mb-heads"><th>Player</th><th title="Games played">GP</th><th title="Minutes a game">MIN</th>${cols.map(([l, , , t]) => `<th title="${t}">${l}</th>`).join("")}<th title="His share of the team's ${WHO_COLS[spec.share][0]} this season">Team Share</th></tr>`;
  const rows = pick.map((x) => {
    const tag = out.has(String(x.id)) ? `<span class="gs-inj-status tier-bad">Out</span>` : dtd.has(String(x.id)) ? `<span class="gs-inj-status tier-mid">DTD</span>` : "";
    const share = total ? ((x[spec.share] || 0) * x.gp) / total : null;
    return `<tr${out.has(String(x.id)) ? ' class="nba-out-row"' : ""}><td class="mb-stat mb-who-name">${playerClick(x.id, x.name)} <span class="muted-label">${x.pos || ""}</span>${tag}</td>
      <td class="mb-v mb-plain">${x.gp}</td><td class="mb-v mb-plain">${numW(x.min)}</td>
      ${cols.map(([l, k, f, t, flip]) => whoTile(k, x[k], f, `${x.name}: ${t} ${f(x[k])}`, flip)).join("")}
      <td class="mb-v"${share === null ? "" : ` style="background:${scaleHsla(Math.round(Math.min(1, share / 0.35) * 120), 70, 45, 0.32)}"`} title="${whoEsc(`${x.name}: ${pctW(share)} of ${abbr}'s ${WHO_COLS[spec.share][3].toLowerCase()} this season`)}"><b>${pctW(share)}</b></td></tr>`;
  }).join("");
  const t = whoTeamOf(abbr);
  return `<div class="nba-box mb-teambox mb-whobox" style="--team:${whoRgb(abbr)}">${whoBanner(abbr, `${t.name} Offense`)}<table class="mb-table mb-who-table"><tbody>${head}${rows || `<tr><td class="mb-none" colspan="${cols.length + 4}">No rotation players yet</td></tr>`}</tbody></table></div>`;
}
const whoBanner = (abbr, text) => {
  const t = whoTeamOf(abbr);
  return `<div class="team-banner" style="background:rgba(${whoRgb(abbr)},0.22);border-left:4px solid rgb(${whoRgb(abbr)})">${t.logo ? `<img src="${t.logo}" alt="${abbr}" class="team-logo" style="width:22px;height:22px">` : ""}<span class="team-banner-name">${text}</span></div>`;
};

// ---- The defense's side: what it allows each position (the owner, 2026-11-09: "shows the defenses
// info related - allowed per position"). From every player's game log this season (his number goes to
// the defense he played, by his position), plus research `defpos` for paint / mid-range / transition
// points; a game a team played counts once. Ranked among the 30 defenses for that position: 1st = the
// stingiest (green), 30th = allows the most (red); forced turnovers 1st = forces the most.
const WHO_POS = ["PG", "SG", "SF", "PF", "C"];
const whoOrd = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
// [label, value(sums, games), format, hover, more is good for the defense]
const WHO_DEF_COLS = {
  pts: ["PTS", (s, n) => s.pts / n, numW, "Points a game it allows the position"],
  fgp: ["FG%", (s) => (s.fga ? s.fgm / s.fga : null), pctW, "FG% it allows the position"],
  transP: ["Trans PTS", (s, n, d) => (d ? d[6] / n : null), numW, "Transition points a game it allows the position"],
  tov: ["TOV Forced", (s, n) => s.tov / n, numW, "Turnovers a game the position commits against it", true],
  oreb: ["OREB", (s, n) => s.oreb / n, numW, "Offensive rebounds a game it allows the position"],
  reb: ["REB", (s, n) => s.reb / n, numW, "Rebounds a game it allows the position"],
  fta: ["FTA", (s, n) => s.fta / n, numW, "Free throws a game it allows the position"],
  fg3a: ["3PA", (s, n) => s.fg3a / n, numW, "Threes tried a game it allows the position"],
  fg3m: ["3PM", (s, n) => s.fg3m / n, numW, "Threes made a game it allows the position"],
  fg3p: ["3P%", (s) => (s.fg3a ? s.fg3m / s.fg3a : null), pctW, "Three-point % it allows the position"],
  paintP: ["Paint PTS", (s, n, d) => (d ? d[2] / n : null), numW, "Paint points a game it allows the position"],
  paintS: ["% Of PTS", (s, n, d) => (d && d[7] ? d[2] / d[7] : null), pctW, "Share of the points it allows the position that come in the paint"],
  midP: ["Mid PTS", (s, n, d) => (d ? d[1] / n : null), numW, "Mid-range points a game it allows the position"],
  ast: ["AST", (s, n) => s.ast / n, numW, "Assists a game it allows the position"],
  astS: ["Assisted", (s, n, d) => (d && d[4] ? d[5] / d[4] : null), pctW, "Share of the position's makes against it that were assisted"],
};
const WHO_DEF = {
  scoring: ["pts", "fgp"], transition: ["transP"], turnovers: ["tov"], glass: ["oreb", "reb"], ft: ["fta"],
  threes: ["fg3a", "fg3m", "fg3p"], paint: ["paintP", "paintS"], mid: ["midP"], ballmove: ["ast", "astS"],
};
let WHO_ALLOWED = null; // {team: {pos: sums}, games: {team: n}}
function whoAllowed() {
  if (WHO_ALLOWED) return WHO_ALLOWED;
  const s = nbaCardSeason();
  if (!s) return null;
  const F = s.fields, at = (k) => F.indexOf(k);
  const keys = ["pts", "fga", "fgm", "tov", "oreb", "reb", "fta", "fg3a", "fg3m", "ast"];
  const sums = {}, games = {};
  for (const p of Object.values(s.players || {})) {
    if (!WHO_POS.includes(p.pos)) continue;
    for (const r of p.log || []) {
      const opp = r[at("opp")];
      (games[opp] = games[opp] || new Set()).add(String(r[at("game")]));
      const box = ((sums[opp] = sums[opp] || {})[p.pos] = sums[opp][p.pos] || Object.fromEntries(keys.map((k) => [k, 0])));
      keys.forEach((k) => { if (at(k) >= 0) box[k] += Number(r[at(k)]) || 0; });
    }
  }
  return (WHO_ALLOWED = { sums, games: Object.fromEntries(Object.entries(games).map(([t, g]) => [t, g.size])) });
}
function whoDefBox(def, off, topic) {
  const A = whoAllowed();
  const defpos = ((nbaCardProps() || {}).research || {}).defpos || {};
  const cols = WHO_DEF[topic].map((k) => [k, ...WHO_DEF_COLS[k]]);
  const val = (t, pos, get) => { const n = A.games[t]; const s = (A.sums[t] || {})[pos]; return n && s ? get(s, n, (defpos[t] || {})[pos]) : null; };
  // the positions the offense leans on for this topic first (its rotation's share of the main number)
  const main = WHO[topic];
  const offRot = whoRotation(whoPlayers().filter((x) => x.team === off));
  const lean = Object.fromEntries(WHO_POS.map((p) => [p, offRot.filter((x) => x.pos === p).reduce((n, x) => n + (x[main.sort] || 0), 0)]));
  const head = `<tr class="mb-heads"><th>Position</th>${cols.map(([, l, , , t]) => `<th title="${t}">${l}</th>`).join("")}<th title="How much of ${off}'s ${WHO_COLS[main.sort][0]} a game its rotation players at this position put up">${off} ${WHO_COLS[main.sort][0]}</th></tr>`;
  const rows = WHO_POS.map((pos) => {
    const tiles = cols.map(([k, l, get, f, tip, good]) => {
      const v = val(def, pos, get);
      const all = Object.keys(A.sums).map((t) => val(t, pos, get)).filter((x) => x !== null && x !== undefined);
      if (v === null || v === undefined || !all.length) return `<td class="mb-v">--</td>`;
      // 1st = best for the defense: allows the least (forced turnovers: forces the most)
      const rank = 1 + all.filter((x) => (good ? x > v : x < v)).length;
      const hue = all.length > 1 ? Math.round((120 * (all.length - rank)) / (all.length - 1)) : 60;
      return `<td class="mb-v" style="background:${scaleHsla(hue, 70, 45, 0.32)}" title="${whoEsc(`${def}: ${tip} (${pos}s) ${f(v)}, ${whoOrd(rank)} of ${all.length}`)}"><b>${f(v)}</b><small>${whoOrd(rank)}</small></td>`;
    }).join("");
    return `<tr><td class="mb-stat">${pos}</td>${tiles}<td class="mb-v mb-plain">${numW(lean[pos])}</td></tr>`;
  }).join("");
  return `<div class="nba-box mb-teambox mb-whobox" style="--team:${whoRgb(def)}">${whoBanner(def, `${whoTeamOf(def).name} Defense: Allowed By Position`)}<table class="mb-table mb-who-table"><tbody>${head}${rows}</tbody></table></div>`;
}

function whoRender(topic, g, dirs) {
  const spec = WHO[topic];
  const ready = g && nbaCardProps() !== undefined && whoPlayers() && whoAllowed();
  const body = !g ? `<p class="no-data-note">No game picked.</p>` : nbaCardProps() === undefined ? `<p class="no-data-note">Loading&hellip;</p>`
    : !ready ? `<p class="no-data-note">Player numbers aren't available right now.</p>`
    : dirs.map((d) => {
      const o = whoTeam(d.off, spec), df = whoDefBox(d.def, d.off, topic);
      return `<div class="mb-who-dir"><div class="mb-who-dirhead">${d.off} Offense vs ${d.def} Defense</div><div class="mb-who-pair">${d.left === "d" ? df + o : o + df}</div></div>`;
    }).join("");
  document.getElementById("mb-who-content").innerHTML = `<h2 class="section-title mb-who-title">${spec.title}: Who's Behind It</h2>
    <p class="mb-who-note">This season. Offense: its rotation players (${WHO_MIN}+ minutes, ${WHO_GP}+ games), a game, colored by where he sits among the league's rotation players (green = more; turnovers red = more). Defense: what it allows each position a game, ranked of 30 (1st = stingiest, green; 30th = allows the most, red). The last column: the offense's numbers at that position.</p>${body}`;
}
// dirs: [{off, def, left}] (whoDirs); none = both directions
function whoOpen(topic, g, dirs = null) {
  if (!WHO[topic]) return;
  dirs = dirs || (g ? [{ off: g.away, def: g.home, left: "o" }, { off: g.home, def: g.away, left: "o" }] : []);
  if (!document.getElementById("mb-who-modal")) {
    const overlay = document.createElement("div");
    overlay.id = "mb-who-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box mb-who-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="mb-who-content"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest(".modal-close")) overlay.hidden = true; });
    document.addEventListener("keydown", (e) => { const card = document.getElementById("player-card-modal"); if (e.key === "Escape" && !(card && !card.hidden)) overlay.hidden = true; });
  }
  document.getElementById("mb-who-modal").hidden = false;
  whoRender(topic, g, dirs);
  if (nbaCardProps() === undefined) Promise.resolve(NBA_CARD_PROPS).then(() => whoRender(topic, g, dirs));
}
