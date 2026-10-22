// ---- NFL Best Plays ----
// The owner, 2026-10-20: members asked for "top plays" for player props and
// TDs. Five or six games is little to go on, so the page says so up top and
// every number starts from the books' own line and moves only as far as the
// games played back it up.
//   Props: the projection engine in props-summary.js (propTeamLines): the
//     player's lineup-aware games, the two-sided matchup (what this defense
//     allows to his position), throw depth, game script, teammates Out.
//   Anytime TD: the team's implied points -> expected offensive TDs, split by
//     each player's share (touches, red zone looks, expected TDs; the First
//     TD model's pieces) and the defense by position, then blended with the
//     market's own split by games played.
//   First TD: TD Data's First TD model as is (firstTdPlayerTargets, app.js).
// Every play is compared with the best price across the member's books.
// Unlike the Props Summary card (directional only), this page IS a list of
// model plays: the owner's call for this page only.

// Edge = the model's chance minus the chance the price needs, in points.
// Check = so far from every book that the model probably lacks news.
// Set on Week 7 2026's lines (Novig only, ~240 props): ~27 props, ~7 Anytime TDs.
// A TD long shot the model gives 1.8x the price's chance is Check too.
const BP_EDGES = {
  prop: { lean: 0.04, strong: 0.07, check: 0.12 },
  any: { lean: 0.03, strong: 0.05, check: 0.12 },
  first: { lean: 0.015, strong: 0.03, check: 0.08 },
};
const BP_CHECK_RATIO = 1.8;
const BP_TD_PER_POINT = 0.105; // offensive TDs per point a team scores, league-wide
const BP_TD_STABILITY = 6; // games before a team's TD split counts as much as the market's
const BP_ANY_W = { touches: 0.2, rz: 0.35, xtd: 0.45 };
const BP_SMALL_SAMPLE = 3; // games behind a prop this short gets a note
const BP_VIEW_KEY = "nfl-tool.best-plays-view.v1";
const BP_GROUPS = [
  ["rec", "Receiving"],
  ["rush", "Rushing"],
  ["pass", "Passing"],
  ["any", "Anytime TD"],
  ["first", "First TD"],
];
const BP_RATING_ORDER = { Strong: 3, Check: 2, Lean: 1 };

const bpView = loadBpView();
let bpRows = [];

function loadBpView() {
  const base = { groups: { rec: true, rush: true, pass: true, any: true, first: true }, game: "", strongOnly: false, sort: "edge", dir: -1 };
  try {
    const saved = JSON.parse(localStorage.getItem(BP_VIEW_KEY)) || {};
    return { ...base, ...saved, groups: { ...base.groups, ...(saved.groups || {}) } };
  } catch (e) {
    return base;
  }
}
function saveBpView() {
  try {
    localStorage.setItem(BP_VIEW_KEY, JSON.stringify(bpView));
  } catch (e) {
    // localStorage unavailable -- the filters just won't stick.
  }
}

const bpBreakEven = (price) => (price === null || price === undefined ? null : propImplied(price));
const bpPayout = (price) => (price > 0 ? price / 100 : 100 / -price);
function bpRating(kind, edge, chance) {
  const e = BP_EDGES[kind];
  if (edge === null || edge < e.lean) return null;
  const ratio = kind === "prop" ? 0 : chance / (chance - edge);
  return edge >= e.check || ratio >= BP_CHECK_RATIO ? "Check" : edge >= e.strong ? "Strong" : "Lean";
}
// Kickoff in Eastern time; the -04:00 offset makes a game drop off an hour
// early after the clocks change rather than an hour late (odds lock at kickoff).
function bpStarted(g) {
  if (g.status && g.status !== "scheduled") return true;
  const t = Date.parse(`${g.date}T${g.time || "13:00"}:00-04:00`);
  return Number.isFinite(t) && Date.now() >= t;
}
const bpGameKey = (g) => `${g.away}_${g.home}`;
const bpMatchup = (g) => `${g.away} @ ${g.home}`;

// ---- props ----
// Every posted line this week with the engine's chance.
function bpPropLines(game) {
  const out = [];
  [[game.away, game.home], [game.home, game.away]].forEach(([team, opp]) => {
    propTeamLines(team, opp, game.week, game, true).forEach((r) => {
      if (r.pOver !== null && r.pOver !== undefined && r.mktOver !== null) out.push({ game, team, opp, r });
    });
  });
  return out;
}
// The engine leans one way market-wide (Week 7 2026: receptions above the
// books on 47 of 58 players, pass attempts 14 points high on average): that
// is the engine, not 47 edges. So each market's average gap to the books
// this week (in log-odds) comes off every line in it: the market sets the
// level, the model only says who it rates above or below the rest.
// A market with few lines keeps part of its gap (BP_CALIBRATE_N).
const BP_CALIBRATE_N = 4;
// Then the model moves only this share of the way from the books' no-vig
// chance (on top of the engine's own games-played trust, ~0.6 by Week 7):
// on a handful of games the line carries most of the weight.
const BP_MODEL_TRUST = 0.5;
const bpLogit = (p) => Math.log(p / (1 - p));
const bpUnlogit = (x) => 1 / (1 + Math.exp(-x));
function bpCalibrate(lines) {
  const gaps = {};
  lines.forEach(({ r }) => {
    const p = propClamp(r.pOver, 0.01, 0.99);
    const m = propClamp(r.mktOver, 0.01, 0.99);
    (gaps[r.marketKey] = gaps[r.marketKey] || []).push(bpLogit(p) - bpLogit(m));
  });
  const shift = {};
  Object.entries(gaps).forEach(([k, list]) => {
    shift[k] = (list.reduce((a, b) => a + b, 0) / list.length) * (list.length / (list.length + BP_CALIBRATE_N));
  });
  lines.forEach(({ r }) => {
    const before = propClamp(r.pOver, 0.01, 0.99);
    const mkt = bpLogit(propClamp(r.mktOver, 0.01, 0.99));
    r.pOver = bpUnlogit(mkt + BP_MODEL_TRUST * (bpLogit(before) - shift[r.marketKey] - mkt));
    r.side = r.pOver >= r.mktOver ? "over" : "under";
    r.odds = r.side === "over" ? r.over : r.under;
    // The shown projection moves with the chance, so the two never disagree:
    // Poisson markets re-solve the mean; the rest keep the same spread around the line.
    if (PROP_MARKETS[r.marketKey]?.kind === "poisson") r.proj = propPoissonMeanFor(r.line, r.pOver);
    else {
      const z0 = propNormInv(before);
      const z1 = propNormInv(r.pOver);
      r.proj = Math.abs(z0) >= 0.05 ? r.line + ((r.proj - r.line) * z1) / z0 : r.line;
    }
  });
  return lines;
}
function bpPropRows(lines) {
  const out = [];
  lines.forEach(({ game, team, opp, r }) => {
      const side = r.side;
      const chance = side === "over" ? r.pOver : 1 - r.pOver;
      // The engine's hit count was for its own side; recount for this one.
      r.hits = r.values.filter((v) => (side === "over" ? v > r.line : v < r.line)).length;
      r.reasons = r.reasons.filter((x) => x.dir === (side === "over" ? 1 : -1) || !x.dir);
      const entries = propOuEntries(r.marketKey, r.market, team, r.name, r.line, r.over, r.under, bpMatchup(game));
      const entry = entries[side];
      const spec = BOOK_SPECS.get(entry);
      spec.game = bpGameKey(game);
      spec.model = { [`o|${r.line}`]: r.pOver, [`u|${r.line}`]: 1 - r.pOver };
      spec.edges = BP_EDGES.prop;
      const best = bookBest(bookQuotes(spec), spec.side, r.line);
      const price = best ? best[3] : r.odds;
      const edge = price === null || price === undefined ? null : chance - bpBreakEven(price);
      const rating = bpRating("prop", edge, chance);
      if (!rating) return;
      const unit = PROP_MARKETS[r.marketKey]?.unit || "";
      const notes = [];
      if (r.injury === "Q") notes.push(["Q", "Questionable on the injury report"]);
      if (r.thin) notes.push(["Thin", "A thin market: few books, the price may move"]);
      if (r.values.length < BP_SMALL_SAMPLE) notes.push([`${r.values.length} gm`, `Only ${r.values.length} full game${r.values.length === 1 ? "" : "s"} behind this`]);
      out.push({
        group: r.section === "rush" ? "rush" : r.section === "pass" ? "pass" : "rec",
        kind: "prop", game, team, opp, name: r.name, position: r.position,
        market: r.marketKey, side, line: r.line, book: best ? best[0] : "novig",
        bet: `${side === "over" ? "Over" : "Under"} ${fmt(r.line, 1)} ${r.market}`,
        gmg: `${fmt(r.proj, r.proj < 10 ? 1 : 0)} ${unit}`,
        chance, price, edge, rating, entry, priceText: showOdds(r.odds),
        hits: r.values.length ? `${r.hits}/${r.values.length}` : null,
        reasons: r.reasons.length ? r.reasons.map((x) => x.text).slice(0, 3) : [`Rated ${side === "over" ? "above" : "below"} the rest of the ${r.market} market`],
        notes,
      });
  });
  return out;
}

// ---- Anytime TD ----
function bpTeamPoints(game, team) {
  const spread = game.away === team ? game.away_team_spread : game.home_team_spread;
  if (game.total_line === null || game.total_line === undefined || spread === null || spread === undefined) return null;
  return game.total_line / 2 - spread / 2;
}
function bpAnytime(team, opp, game) {
  const week = game.week;
  const pts = bpTeamPoints(game, team);
  const odds = (DATA.player_td_odds || {})[team] || [];
  if (pts === null || !odds.length) return [];
  const injured = propInjuries(team, week);
  const players = lineupAdjustedXtd(team, week, { qbStarter: currentStarterQb(team, week) })
    .filter((p) => injured[normName(p.name)]?.tag !== "out" && (p.position !== "QB" || qbIsRunner(team, p.name)));
  if (!players.length) return [];
  const rzOpp = (p) => (p.rz_targets || 0) + (p.rz_carries || 0);
  const tot = {
    touches: players.reduce((s, p) => s + (p.touches || 0), 0) || 1,
    xtd: players.reduce((s, p) => s + (p.xtd_pg || 0), 0),
    rz: players.reduce((s, p) => s + rzOpp(p), 0),
  };
  const games = DATA.team_stats[team]?.games_played || 1;
  const allowed = DATA.team_stats[opp]?.def_position_td_allowed || {};
  const defZ = {};
  const weighted = players.map((p) => {
    if (!(p.position in defZ)) {
      const z = modelSideZ(opp, "def", p.position).z || 0;
      defZ[p.position] = (allowed[p.position] || 0) >= FIRST_TD_DEF_MIN_TDS ? propClamp(z, -1, 1) : 0;
    }
    const touchShare = (p.touches || 0) / tot.touches;
    const xtdShare = ((p.xtd_pg || 0) + FIRST_TD_XTD_PRIOR * touchShare) / (tot.xtd + FIRST_TD_XTD_PRIOR);
    const rzShare = (rzOpp(p) + FIRST_TD_RZ_PRIOR * touchShare) / (tot.rz + FIRST_TD_RZ_PRIOR);
    const share = BP_ANY_W.touches * touchShare + BP_ANY_W.rz * rzShare + BP_ANY_W.xtd * xtdShare;
    return { p, w: share * Math.exp(FIRST_TD_DEF_K * defZ[p.position]) };
  });
  const wSum = weighted.reduce((s, x) => s + x.w, 0) || 1;
  const teamTds = pts * BP_TD_PER_POINT * (1 - FIRST_TD_NON_OFFENSE);
  const trust = games / (games + BP_TD_STABILITY);
  const byName = {};
  weighted.forEach((x) => (byName[normName(x.p.name)] = x));
  const out = [];
  odds.forEach((o) => {
    const x = byName[normName(o.name)];
    if (!x || !o.implied_prob || o.implied_prob >= 1) return;
    const p = x.p;
    const mkt = -Math.log(1 - o.implied_prob); // the market's expected TDs (no-vig chance)
    const data = (teamTds * x.w) / wSum;
    const lambda = mkt + trust * (data - mkt);
    const chance = 1 - Math.exp(-lambda);
    const entry = { id: `${week}_anytime_td_${team}_${o.name}`, week, matchup: bpMatchup(game), category: "Anytime TD", description: o.name, team, odds: fmtOddsSigned(o.best_odds), book: o.best_book };
    const spec = { kind: "td", team, name: o.name, side: "o", line: 0.5, game: bpGameKey(game), title: `${o.name} &middot; Anytime TD`, sub: entry.matchup, model: { "o|0.5": chance }, edges: BP_EDGES.any };
    BOOK_SPECS.set(entry, spec);
    const best = bookBest(bookQuotes(spec), "o", 0.5);
    const price = best ? best[3] : o.best_odds;
    const edge = price === null || price === undefined ? null : chance - bpBreakEven(price);
    const rating = bpRating("any", edge, chance);
    if (!rating) return;
    const reasons = [`${fmt(p.xtd_pg || 0, 2)} xTD/g`, `${fmt(rzOpp(p) / games, 1)} RZ looks/g`, `team total ${fmt(pts, 1)}`];
    if (defZ[p.position] >= 0.5) reasons.push(`${opp} allows ${allowed[p.position]} ${p.position} TDs`);
    const notes = [];
    if (injured[normName(p.name)]?.tag === "Q") notes.push(["Q", "Questionable on the injury report"]);
    if (o.thin) notes.push(["Thin", "A thin market: few books, the price may move"]);
    out.push({
      group: "any", kind: "any", game, team, opp, name: o.name, position: p.position || o.position,
      market: "anytime_td", side: "yes", line: 0.5, book: best ? best[0] : o.best_book || null,
      bet: "Anytime TD", gmg: `${fmt(lambda, 2)} TD`, chance, price, edge, rating, entry, priceText: showOdds(o.best_odds),
      hits: null, reasons, notes,
    });
  });
  return out;
}

// ---- First TD (TD Data's model) ----
function bpFirstTd(game) {
  const out = [];
  const pAway = firstTdTeamChance(game.away, game.home);
  [[game.away, game.home, pAway], [game.home, game.away, 1 - pAway]].forEach(([team, opp, teamChance]) => {
    firstTdPlayerTargets(team, opp, teamChance, game.week).forEach((p) => {
      if (p.odds === null || p.injury === "out") return;
      const edge = p.est - bpBreakEven(p.odds);
      const rating = bpRating("first", edge, p.est);
      if (!rating) return;
      const entry = { id: `${game.week}_first_td_${team}_${p.name}`, week: game.week, matchup: bpMatchup(game), category: "First TD", description: p.name, team, odds: fmtOddsSigned(p.odds) };
      out.push({
        group: "first", kind: "first", game, team, opp, name: p.name, position: p.position,
        market: "first_td", side: "yes", line: null, book: p.book || null,
        bet: "First TD", gmg: `${(p.est * 100).toFixed(1)}%`, chance: p.est, price: p.odds, edge, rating, entry, priceText: showOdds(p.odds),
        hits: null, reasons: [`${team} scores first ${Math.round(teamChance * 100)}%`, `${fmt(p.xtd_pg || 0, 2)} xTD/g`],
        notes: p.injury === "Q" ? [["Q", "Questionable on the injury report"]] : [],
      });
    });
  });
  return out;
}

// The TD Summary's Key Player stars for both teams: normName -> stars.
function bpStars(game) {
  const stars = {};
  try {
    const parts = td2Parts(game.away, game.home);
    [[game.away, game.home, parts.itemsAway, parts.tagsAway], [game.home, game.away, parts.itemsHome, parts.tagsHome]].forEach(([team, opp, items, tags]) => {
      td2KeyList(team, opp, game.week, items, tags).forEach((e) => (stars[`${team}|${normName(e.name)}`] = Math.min(5, e.n)));
    });
  } catch (e) {
    console.error("Best Plays: stars", e);
  }
  return stars;
}

function bpBuild(games) {
  const rows = [];
  // One game's failure must not empty the whole page.
  const lines = [];
  games.forEach((game) => {
    try { lines.push(...bpPropLines(game)); } catch (e) { console.error("Best Plays: props", bpMatchup(game), e); }
  });
  const propsByGame = new Map();
  bpPropRows(bpCalibrate(lines)).forEach((r) => propsByGame.set(r.game, [...(propsByGame.get(r.game) || []), r]));
  games.forEach((game) => {
    const stars = bpStars(game);
    const add = (list) => list.forEach((r) => rows.push({ ...r, stars: stars[`${r.team}|${normName(r.name)}`] || 0 }));
    add(propsByGame.get(game) || []);
    try { add([...bpAnytime(game.away, game.home, game), ...bpAnytime(game.home, game.away, game)]); } catch (e) { console.error("Best Plays: anytime", bpMatchup(game), e); }
    try { add(bpFirstTd(game)); } catch (e) { console.error("Best Plays: first TD", bpMatchup(game), e); }
  });
  return rows;
}

// What the deploy saves for the graded record (tools/best_plays_capture.py
// reads it on a fresh browser: no member, so the best price is across every
// US book). `games` = every game this list covered, so a play the page has
// dropped since the last capture is dropped from the record too.
function bpCapture() {
  const games = (DATA.schedule || []).filter((g) => g.week === DATA.current_week && !bpStarted(g));
  return {
    week: DATA.current_week,
    games: games.map((g) => `${bpGameKey(g)}_${g.week}`),
    plays: bpRows.map((r) => ({
      game: bpGameKey(r.game), game_id: r.game.game_id || null, week: r.game.week, date: r.game.date,
      team: r.team, opp: r.opp, name: r.name, position: r.position || null, group: r.group,
      market: r.market, bet: r.bet, side: r.side, line: r.line, price: r.price, book: r.book,
      edge: r.edge, chance: r.chance, rating: r.rating,
    })),
  };
}

// ---- drawing ----
const BP_SORTS = {
  edge: (r) => r.edge,
  chance: (r) => r.chance,
  odds: (r) => bpPayout(r.price),
  rating: (r) => BP_RATING_ORDER[r.rating] * 1000 + r.edge,
  stars: (r) => r.stars * 1000 + r.edge,
};
function bpFairPrice(p) {
  return p <= 0 || p >= 1 ? "--" : showOdds(probToAmerican(p));
}
function bpRow(r) {
  const rgb = teamAccentRgb(r.team).join(",");
  const tier = r.rating === "Strong" ? "tier-good" : r.rating === "Lean" ? "tier-good bp-lean" : "tier-mid";
  const ratingTitle = r.rating === "Check" ? "The model is far from every book: usually news it doesn't know. Look before you bet." : `${r.rating}: edge of ${(r.edge * 100).toFixed(1)} points`;
  const notes = r.notes.map(([t, title]) => `<span class="bp-note" title="${title}">${t}</span>`).join("");
  const stars = r.stars ? `<span class="bp-stars" title="TD Summary Key Player: fits ${r.stars} of the team's TD targets / tags">${"★".repeat(r.stars)}</span>` : "";
  return `<tr style="border-left:4px solid rgb(${rgb});background:rgba(${rgb},0.06)">
    <td><span class="bp-rating ${tier}" title="${ratingTitle}">${r.rating}</span></td>
    <td class="bp-player">${teamLogoMini(r.team)} ${playerClick(r.team, r.name, r.name, r.opp)} <span class="muted-label">${r.position || ""}</span>${stars}<div class="bp-sub">${r.team === r.game.away ? "@" : "vs"} ${r.opp} &middot; ${r.game.weekday ? r.game.weekday.slice(0, 3) : ""}</div></td>
    <td class="bp-bet"><b>${r.bet}</b>${notes}</td>
    <td class="num">${r.gmg}</td>
    <td class="num">${(r.chance * 100).toFixed(r.chance < 0.1 ? 1 : 0)}%</td>
    <td class="num">${bpFairPrice(r.chance)}</td>
    <td class="num bp-price">${ouCheckboxCell(r.priceText, r.entry)}</td>
    <td class="num"><span class="bp-edge ${tier}">+${(r.edge * 100).toFixed(1)}</span></td>
    <td class="num">${r.hits || "--"}</td>
    <td class="bp-why">${r.reasons.join(" &middot; ")}</td>
  </tr>`;
}
function bpRender() {
  const content = document.getElementById("bp-content");
  const rows = bpRows
    .filter((r) => bpView.groups[r.group])
    .filter((r) => !bpView.game || bpGameKey(r.game) === bpView.game)
    .filter((r) => !bpView.strongOnly || r.rating === "Strong")
    .sort((a, b) => bpView.dir * (BP_SORTS[bpView.sort](a) - BP_SORTS[bpView.sort](b)));
  const th = (key, label, cls = "num") => {
    const on = bpView.sort === key;
    return `<th class="${cls} bp-sort${on ? " bp-sort-on" : ""}" data-sort="${key}">${label}${on ? (bpView.dir < 0 ? " ▾" : " ▴") : ""}</th>`;
  };
  if (!rows.length) {
    content.innerHTML = `<p class="no-data-note">No plays clear the bar with these filters. Lines fill in through the week; check back closer to kickoff.</p>`;
    return;
  }
  content.innerHTML = `<p class="bp-count">${rows.length} play${rows.length === 1 ? "" : "s"}</p>
    <div class="bp-table-wrap"><table class="data-table bp-table">
      <thead><tr>${th("rating", "Rating", "")}<th>Player</th><th>Bet</th><th class="num">GMG</th>${th("chance", "Chance")}<th class="num">Fair</th>${th("odds", "Best price")}${th("edge", "Edge")}<th class="num" title="Games he cleared this line (props)">Hit</th><th>Why</th></tr></thead>
      <tbody>${rows.map(bpRow).join("")}</tbody>
    </table></div>`;
}
function bpToolbar(games) {
  const bar = document.getElementById("bp-toolbar");
  const groupBtns = BP_GROUPS.map(([k, label]) => `<button type="button" class="view-toggle-btn bp-group${bpView.groups[k] ? " active" : ""}" data-group="${k}">${label}</button>`).join("");
  const gameOpts = games.map((g) => `<option value="${bpGameKey(g)}"${bpView.game === bpGameKey(g) ? " selected" : ""}>${bpMatchup(g)}</option>`).join("");
  bar.innerHTML = `${groupBtns}
    <button type="button" class="view-toggle-btn bp-strong${bpView.strongOnly ? " active" : ""}">Strong only</button>
    <label class="bp-game-pick">Game <select id="bp-game"><option value="">All games</option>${gameOpts}</select></label>`;
}

document.addEventListener("click", (e) => {
  const group = e.target.closest(".bp-group");
  const strong = e.target.closest(".bp-strong");
  const sort = e.target.closest(".bp-sort");
  if (group) {
    bpView.groups[group.dataset.group] = !bpView.groups[group.dataset.group];
    group.classList.toggle("active", bpView.groups[group.dataset.group]);
  } else if (strong) {
    bpView.strongOnly = !bpView.strongOnly;
    strong.classList.toggle("active", bpView.strongOnly);
  } else if (sort) {
    if (bpView.sort === sort.dataset.sort) bpView.dir = -bpView.dir;
    else Object.assign(bpView, { sort: sort.dataset.sort, dir: -1 });
  } else return;
  saveBpView();
  bpRender();
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "bp-game") return;
  bpView.game = e.target.value;
  saveBpView();
  bpRender();
});

function bpStart() {
  const week = DATA.current_week;
  scheduleWeek = week; // propOuEntries and the player card read the week from here
  const games = (DATA.schedule || []).filter((g) => g.week === week && !bpStarted(g));
  const gp = Object.values(DATA.team_stats || {}).map((t) => t.games_played || 0).filter((n) => n > 0).sort((a, b) => a - b);
  const typical = gp.length ? gp[Math.floor(gp.length / 2)] : 0;
  document.getElementById("bp-title").textContent = `Best Plays · Week ${week}`;
  document.getElementById("bp-warning").innerHTML = `<b>&#9888; Small sample.</b> Most teams have played <b>${typical} game${typical === 1 ? "" : "s"}</b>. Every number here starts from the books' own line and moves only part of the way toward what those games say, but a few games can still be one odd matchup. Treat this list as a starting point, not a pick sheet, and check injury news before you bet.`;
  if (bpView.game && !games.some((g) => bpGameKey(g) === bpView.game)) bpView.game = "";
  bpRows = bpBuild(games);
  bpToolbar(games);
  document.getElementById("empty-state").hidden = true;
  document.getElementById("bp-app").hidden = false;
  if (!games.length) {
    document.getElementById("bp-content").innerHTML = `<p class="no-data-note">Every Week ${week} game has kicked off. Next week's plays show once its lines are up.</p>`;
    return;
  }
  bpRender();
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    bpStart();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML = "<p>Couldn't load this week's data. Try a refresh.</p>";
    console.error(err);
  });
