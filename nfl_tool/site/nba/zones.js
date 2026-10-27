// GMG NBA Suite: Zone Matchup Targets (the owner, 2026-10-27: "If we can develop a
// system that uses all the components we have data for to determine how teams
// will allow other teams to beat them ... THIS is the tool I want to create").
// Each player with a points / threes line tonight: where and how he shoots
// against what tonight's defense allows players like him (guards / forwards /
// bigs) from those spots. The reads are built in nfl_tool/nba/zone_matchups.py
// (shots.json `matchups`); this page lists them (Best & Worst Spots, Matchup
// View) and opens both shot charts for a player. RAW numbers, nothing pulled
// toward the league (NBA_SHOT_PRIOR = 0 here). Never priced: the line is for
// reference. Loads before shot-chart.js / nba-card.js. Every name starts zm / ZM.

let DATA = null; // data.json: teams, schedule; the player card reads it too
let ZF = null; // shots.json
const ZM_KEY = "nba-tool.zones.v1"; // display prefs on this device: view, market, his-shots filter
const ZM = { view: "spots", market: "points", min: 0, game: null, player: null, all: false, chart: "zones" };
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
// green = good for the shooter; full color at 25% (the score) or 10 points (a make rate)
const zmShade = (v, full, alpha = 0.32) => (v === null || v === undefined ? "" : nbaShotColor((Math.max(-1, Math.min(1, v / full)) * NBA_SHOT_FULL), alpha));
const zmGame = (id) => (zmM().games || []).find((g) => g.game_id === id) || null;

function zmRead(r) {
  if (!r) return "";
  const word = r.side === "over" ? "Over" : r.side === "under" ? "Under" : "Toss Up";
  const strong = r.strong && r.side !== "toss" ? "Strong " : "";
  const tint = r.side === "toss" ? "" : ` style="background:${zmShade(r.score, 0.25, 0.3)};border-color:${zmShade(r.score, 0.25, 0.85)}"`;
  return `<span class="zm-read zm-${r.side}"${tint}>${strong}${word}</span>`;
}
// His biggest zones (15%+ of his shots, at least one) and his main shot type, each shaded by what this defense allows there.
function zmDiet(p, r) {
  const g = ZM_GROUP[p.group].toLowerCase();
  const zones = r.zones.filter((z, i) => i === 0 || z.share >= 0.15).slice(0, 3);
  const chip = (label, share, fg, title) => `<span class="zm-chip" style="background:${zmShade(fg, 0.1, 0.28) || "var(--panel-2)"}" title="${title}">${Math.round(share * 100)}% ${label}</span>`;
  const out = zones.map((z) => chip(ZM_ZONE[z.z], z.share, z.fg, `${p.opp} allows ${g} ${z.dmade}/${z.dtried} here (${zmPts(z.fg)} vs league), ${zmPct(z.vol)} shots vs league share`));
  const k = r.kinds[0];
  if (k) out.push(chip(ZM_KIND[k.k], k.share, k.fg, `${p.opp} allows ${g} ${k.dmade}/${k.dtried} on these (${zmPts(k.fg)} vs league)`));
  return out.join("");
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
      return `<tr class="zm-row${id === ZM.player ? " selected" : ""}${g && g.started ? " zm-started" : ""}" data-player="${id}">
        <td class="zm-name">${zmLogo(p.team, 18)} ${playerClick(id, p.name)} <small>${p.pos || ZM_GROUP[p.group]}</small></td>
        ${opts.noVs ? "" : `<td>${zmLogo(p.opp, 18)}</td>`}
        <td>${zmRead(r)}</td>
        <td class="num" style="background:${zmShade(r.score, 0.25)}"><b>${zmPct(r.score)}</b></td>
        <td class="num">${zmPct(r.shots)}</td>
        <td class="num">${zmPct(r.makes)}</td>
        <td class="num">${r.line === null || r.line === undefined ? "--" : r.line}</td>
        <td class="zm-diet">${zmDiet(p, r)}</td>
        <td class="num zm-n" title="His ${ZM.market === "threes" ? "threes" : "shots"} this season / the shots this defense has allowed ${ZM_GROUP[p.group].toLowerCase()}">${r.n} / ${r.dn}</td>
      </tr>`;
    })
    .join("");
  return `<div class="shc-scroll"><table class="data-table zm-table"><thead><tr>
    <th>Player</th>${opts.noVs ? "" : "<th>Vs</th>"}<th>Read</th>
    <th class="num" title="Shots and Makes together">Score</th>
    <th class="num" title="How much more of his group's shooting this defense gives up from his spots than the league does">Shots</th>
    <th class="num" title="How much more his kind of shots go in against this defense, from his zones and shot types">Makes</th>
    <th class="num" title="The main line, for reference only (never priced)">Line</th>
    <th>His Diet vs This Defense</th>
    <th class="num" title="His shots this season / shots this defense allowed his group">Sample</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function zmSpots() {
  const live = (x) => !(zmGame(x.p.game_id) || {}).started;
  const best = zmRows((x) => live(x) && x.r.side === "over").sort((a, b) => b.r.score - a.r.score);
  const worst = zmRows((x) => live(x) && x.r.side === "under").sort((a, b) => a.r.score - b.r.score);
  const cut = (list) => (ZM.all ? list : list.slice(0, ZM_TOP));
  const more = best.length > ZM_TOP || worst.length > ZM_TOP ? `<button type="button" class="view-toggle-btn zm-all">${ZM.all ? "Show Top 15" : "Show All"}</button>` : "";
  return `<div class="zm-spots">
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-over">Best Spots &middot; Overs <span>${best.length}</span></div>${zmTable(cut(best))}</div>
      <div class="nba-box"><div class="nba-box-title zm-head zm-head-under">Worst Spots &middot; Unders <span>${worst.length}</span></div>${zmTable(cut(worst))}</div>
    </div>${more}`;
}

// A defense's softest and toughest zone for each group, among zones that
// group shoots 8%+ of its shots from league-wide (rank of 30 by make rate allowed: 30 = most).
function zmDefense(abbr) {
  const m = zmM();
  const d = (m.defense || {})[abbr] || {};
  const teams = Object.keys(m.defense || {}).length;
  const chips = ["G", "F", "C"].map((g) => {
    const lg = m.league[g] || {};
    const n = (m.league_n || {})[g] || 0;
    const zones = Object.keys(ZM_ZONE).filter((z) => n && (lg[z] || [0, 0])[1] / n >= 0.08 && d[g] && d[g][z] && d[g][z][2]);
    if (!zones.length) return "";
    zones.sort((a, b) => d[g][b][2] - d[g][a][2]);
    const tag = (z, kind) => {
      const [made, tried, rank, shareRank] = d[g][z];
      return `<span class="zm-chip" style="background:${nbaShotColor((kind === "soft" ? -1 : 1) * NBA_SHOT_FULL, 0.28)};border-color:${nbaShotColor((kind === "soft" ? -1 : 1) * NBA_SHOT_FULL, 0.8)}" title="${made}/${tried} allowed to ${ZM_GROUP[g].toLowerCase()} here; ${shareRank}${zmOrd(shareRank)} of ${teams} in shots allowed here (30 = most)">${kind === "soft" ? "Soft" : "Tough"}: ${ZM_ZONE[z]} <b>${rank}${zmOrd(rank)}</b></span>`;
    };
    return `<div class="zm-def-row"><span class="zm-def-g">vs ${ZM_GROUP[g]}</span>${tag(zones[0], "soft")}${tag(zones[zones.length - 1], "tough")}</div>`;
  });
  return `<div class="zm-def">${chips.join("")}</div>`;
}
const zmOrd = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");

function zmMatchup() {
  const g = zmGame(ZM.game);
  if (!g) return `<p class="no-data-note">Pick a game.</p>`;
  const side = (team, opp) => {
    const rows = zmRows((x) => x.p.game_id === g.game_id && x.p.team === team).sort((a, b) => b.r.score - a.r.score);
    return `<div class="nba-box">${zmBanner(team, `<span class="shc-name">${zmTeam(team).name}</span><span class="shc-sub">Shooters vs ${opp} Defense</span>`)}
      <div class="zm-inner"><div class="zm-def-title">${zmLogo(opp, 16)} ${opp} Defense By Group (rank of 30 in make rate allowed; 30th = gives up the most)</div>${zmDefense(opp)}${zmTable(rows, { noVs: true })}</div></div>`;
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
  const mine = (ZF.players[ZM.player] || []).filter(keep);
  const allowed = zmAllowed(p.opp, p.group).filter(keep);
  const league = zmGroupLeague(p.group).filter((s) => !threes || s[2]);
  const view = (shots, opts) => (!shots.length ? `<p class="no-data-note">No shots.</p>` : `<div class="nba-shot-chart shc-chart">${ZM.chart === "heat" ? nbaShotHeatView(shots, league, opts) : nbaShotZonesView(shots, league, opts)}</div>`);
  const g = ZM_GROUP[p.group];
  const d = ((zmM().defense || {})[p.opp] || {})[p.group] || {};
  const zoneRows = r.zones
    .map((z) => {
      const rk = d[z.z] || [];
      return `<tr><td>${ZM_ZONE[z.z]}</td><td class="num">${z.n}</td><td class="num">${Math.round(z.share * 100)}%</td>
        <td class="num zm-split">${z.dtried ? `${z.dmade}/${z.dtried}` : "--"}</td><td class="num" style="background:${zmShade(z.fg, 0.1)}">${zmPts(z.fg)}</td><td class="num">${zmPct(z.vol)}</td><td class="num">${rk[2] ? `${rk[2]}${zmOrd(rk[2])}` : "--"}</td><td class="num">${rk[3] ? `${rk[3]}${zmOrd(rk[3])}` : "--"}</td></tr>`;
    })
    .join("");
  const kindRows = r.kinds
    .map((k) => `<tr><td>${ZM_KIND[k.k]}</td><td class="num">${k.n}</td><td class="num">${Math.round(k.share * 100)}%</td><td class="num zm-split">${k.dtried ? `${k.dmade}/${k.dtried}` : "--"}</td><td class="num" style="background:${zmShade(k.fg, 0.1)}">${zmPts(k.fg)}</td><td class="num">--</td><td class="num">--</td><td class="num">--</td></tr>`)
    .join("");
  box.hidden = false;
  box.innerHTML = `<h2 class="section-title">${zmLogo(p.team, 22)} ${p.name} vs ${zmLogo(p.opp, 22)} ${p.opp} Defense &middot; ${threes ? "Threes" : "Points"} ${zmRead(r)}</h2>
    <div class="zm-bar"><div class="view-toggle" id="zm-chart"><button type="button" class="view-toggle-btn${ZM.chart === "zones" ? " active" : ""}" data-chart="zones">Zones</button><button type="button" class="view-toggle-btn${ZM.chart === "heat" ? " active" : ""}" data-chart="heat">Heat Map</button></div>
    <span class="zm-sum">Score <b>${zmPct(r.score)}</b> &middot; Shots <b>${zmPct(r.shots)}</b> &middot; Makes <b>${zmPct(r.makes)}</b> &middot; Line <b>${r.line ?? "--"}</b></span></div>
    <div class="nba-two shc-two">
      <div class="nba-box">${zmBanner(p.team, `${playerClick(ZM.player, `<span class="shc-name">${p.name}</span>`)}<span class="shc-sub">${threes ? "His Threes" : "His Shots"} &middot; ${mine.length} &middot; vs League ${g}</span>`)}<div class="shc-inner">${view(mine)}</div></div>
      <div class="nba-box">${zmBanner(p.opp, `<span class="shc-name">${zmTeam(p.opp).name}</span><span class="shc-sub">Allowed To ${g} &middot; ${allowed.length}</span>`)}<div class="shc-inner">${view(allowed, { allowed: true })}</div></div>
    </div>
    <div class="shc-scroll"><table class="data-table zm-why"><thead>
      <tr class="shc-head"><th></th><th colspan="2">${p.name}</th><th colspan="5" class="zm-split">${p.opp} Allows ${g}</th></tr>
      <tr><th>Zone / Type</th><th class="num">Shots</th><th class="num">Share</th><th class="num zm-split">FG</th><th class="num" title="Make rate allowed minus the league's for ${g.toLowerCase()}, in points">FG% vs Lg</th><th class="num" title="Share of ${g.toLowerCase()}' shots given up here vs the league's share">Shots vs Lg</th><th class="num" title="Rank of 30 in make rate allowed (30th = most)">FG% Rank</th><th class="num" title="Rank of 30 in share of shots allowed here (30th = most)">Shots Rank</th></tr>
    </thead><tbody>${zoneRows}<tr class="nba-shot-group"><td colspan="8">How He Shoots</td></tr>${kindRows}</tbody></table></div>`;
}

// ---- the page ----
function zmSlate() {
  const m = zmM();
  zmEl("schedule-scroller").hidden = ZM.view !== "matchup";
  zmEl("day-label").textContent = new Date(`${m.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  zmEl("matchup-row").innerHTML = m.games
    .map((g) => `<button type="button" class="matchup-card${g.game_id === ZM.game ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${zmLogo(g.away, 28)}<span class="at">@</span>${zmLogo(g.home, 28)}</span>
        <span class="matchup-date">${g.started ? "Started" : (g.time || "").replace(/^(\d+):(\d+)$/, (s, h, mm) => `${((+h + 11) % 12) + 1}:${mm} ${+h >= 12 ? "PM" : "AM"}`)}</span>
      </button>`)
    .join("");
}
function zmRender() {
  if (!zmM()) return;
  document.querySelectorAll("#zm-view [data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === ZM.view));
  document.querySelectorAll("#zm-market [data-market]").forEach((b) => b.classList.toggle("active", b.dataset.market === ZM.market));
  zmEl("zm-min").value = String(ZM.min);
  zmSlate();
  zmEl("zm-body").innerHTML = ZM.view === "matchup" ? zmMatchup() : zmSpots();
  zmDetail();
  try {
    localStorage.setItem(ZM_KEY, JSON.stringify({ view: ZM.view, market: ZM.market, min: ZM.min }));
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
  const ch = e.target.closest("#zm-chart [data-chart]");
  if (ch) return ((ZM.chart = ch.dataset.chart), zmDetail());
  if (e.target.closest(".zm-all")) return ((ZM.all = !ZM.all), zmRender());
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
    zmRender();
  });
});
