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
const whoAttr = (key) => (whoTopic(key) ? ` data-who="${whoTopic(key)}"` : "");
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
  return `<div class="nba-box mb-teambox mb-whobox" style="--team:${whoRgb(abbr)}"><div class="team-banner" style="background:rgba(${whoRgb(abbr)},0.22);border-left:4px solid rgb(${whoRgb(abbr)})">${t.logo ? `<img src="${t.logo}" alt="${abbr}" class="team-logo" style="width:22px;height:22px">` : ""}<span class="team-banner-name">${t.name}</span></div><table class="mb-table mb-who-table"><tbody>${head}${rows || `<tr><td class="mb-none" colspan="${cols.length + 4}">No rotation players yet</td></tr>`}</tbody></table></div>`;
}
function whoRender(topic, g) {
  const spec = WHO[topic];
  const label = spec.title;
  const body = !g ? `<p class="no-data-note">No game picked.</p>` : nbaCardProps() === undefined ? `<p class="no-data-note">Loading&hellip;</p>`
    : !whoPlayers() ? `<p class="no-data-note">Player numbers aren't available right now.</p>`
    : `<div class="mb-who-pair">${whoTeam(g.away, spec)}${whoTeam(g.home, spec)}</div>`;
  document.getElementById("mb-who-content").innerHTML = `<h2 class="section-title mb-who-title">${label}: Who's Behind It</h2>
    <p class="mb-who-note">This season, rotation players (${WHO_MIN}+ minutes, ${WHO_GP}+ games), a game. Colors: where he sits among the league's rotation players (green = more; turnovers: red = more).</p>${body}`;
}
function whoOpen(topic, g) {
  if (!WHO[topic]) return;
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
  whoRender(topic, g);
  if (nbaCardProps() === undefined) Promise.resolve(NBA_CARD_PROPS).then(() => whoRender(topic, g));
}
