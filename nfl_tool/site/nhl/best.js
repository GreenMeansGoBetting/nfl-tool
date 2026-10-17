// ---- GMG NHL Suite: Best Plays ----
// The owner, 2026-10-15: "I don't care about the noise, I am in a rush: what
// are my best overall bets tonight." Every play the Shots, Goals and Points
// pages call an edge (3+ points), in one list, biggest edge first, every column sortable.
// No cap and no "Check" group: a big gap is ranked like any other (the owner:
// "if the model notices an edge, we shouldn't punish ourselves"); what the
// model may not know yet is said as a note on the row instead (no lineup, a
// line change, a small sample, a thin price). The detail stays on the Shots,
// Goals and Points pages: a row opens its own row there.
// No math beyond the Shots page's: the build sends each player's chances, the
// page compares them with the prices exactly as shots.js does (the build's
// shots_play), and Goals and Points send their play and edge ready-made.

let SHOTS = null;
let GOALS = null;
let POINTS = null;
let dayIndex = 0;
let gameId = null; // one game picked in the strip, or null for the whole day
// markets: which markets are listed. sort / dir: the column and which way.
const bestView = { markets: { sog: true, goal: true, pts: true }, sort: "edge", dir: -1, when: "all", minEdge: 3, lineup: "all" };
const MARKETS = [
  ["sog", "Shots on goal", "shots.html"],
  ["goal", "Anytime goal", "goals.html"],
  ["pts", "Points", "points.html"],
];
const PAGE_NAME = { sog: "Shots", goal: "Goals", pts: "Points" };
// A play from this many games is said to be a small sample.
const SMALL_SAMPLE = 5;

const edgeAt = (size) => ((SHOTS || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
const breakEven = (price) => (has(price) ? (price < 0 ? -price / (100 - price) : 100 / (price + 100)) : null);
// What $1 returns if it wins (the Odds sort: biggest payout first).
const payout = (price) => (price > 0 ? price / 100 : 100 / -price);
// The price with no cut at which the model's chance breaks even (the Shots and Goals pages' Fair).
const fairPrice = (p) => (!has(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
function points(edge) {
  if (!has(edge)) return "--";
  const text = (edge * 100).toFixed(1);
  return Number(text) === 0 ? "0.0" : `${edge > 0 ? "+" : ""}${text}`;
}
function chanceOver(r, lineValue) {
  const need = Math.floor(lineValue) + 1;
  return need >= 1 && need <= r.chances.length ? r.chances[need - 1] : null;
}
// The Shots page's best side of his main line (shots.js sidesFor + pickSide).
function shotsPlay(r, market) {
  if (!market || !has(market.line)) return null;
  const over = chanceOver(r, market.line);
  if (!has(over)) return null;
  const line = market.line;
  const sides = [];
  if (has(market.over)) sides.push({ side: "over", line, price: market.over, chance: over, edge: over - breakEven(market.over), fade: has(r.avg) && r.avg < line });
  if (has(market.under)) sides.push({ side: "under", line, price: market.under, chance: 1 - over, edge: 1 - over - breakEven(market.under), fade: has(r.avg) && r.avg > line });
  return sides.length ? sides.reduce((a, b) => (b.edge > a.edge ? b : a)) : null;
}

// ---- schedule ----
function days() {
  return [...new Set(DATA.schedule.map((g) => g.date))].sort();
}
function gamesOn(date) {
  return DATA.schedule.filter((g) => g.date === date);
}
function currentGame() {
  return DATA.schedule.find((g) => g.game_id === gameId) || null;
}
const shotsBoard = (g) => ((SHOTS || {}).games || {})[g.game_id] || null;
const goalsBoard = (g) => ((GOALS || {}).games || {})[g.game_id] || null;
const pointsBoard = (g) => ((POINTS || {}).games || {})[g.game_id] || null;
const anyBoard = (g) => shotsBoard(g) || goalsBoard(g) || pointsBoard(g);
function gameState(g) {
  const board = anyBoard(g) || {};
  if (g.status === "final" || board.final) return "final";
  return board.locked || g.status === "live" || (g.start_utc && Date.now() >= Date.parse(g.start_utc)) ? "live" : "open";
}
const STATE_ORDER = { open: 0, live: 1, final: 2 };
const dayIsMixed = (date) => new Set(gamesOn(date).filter(anyBoard).map((g) => (gameState(g) === "open" ? "open" : "started"))).size === 2;

// ---- one row per play ----
// Each: the market, the player's row from that page's data, the play (side,
// line, price, chance, edge), the game, and whether it won once final.
function playsFor(date) {
  const out = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const state = gameState(g);
    const sb = shotsBoard(g);
    const gameOdds = (DATA.player_odds || {})[g.game_id] || {};
    if (sb && bestView.markets.sog) {
      sb.players.forEach((r) => {
        if (r.out) return;
        const book = (gameOdds[r.id] || {}).sog;
        const play = shotsPlay(r, book);
        if (!play || play.edge < edgeAt("lean")) return;
        const result = has(r.actual) && r.actual !== play.line ? ((play.side === "over") === r.actual > play.line ? "win" : "loss") : null;
        out.push({ market: "sog", r, g, posted: !!sb.posted, play, thin: !!(book && book.thin), result, state });
      });
    }
    const gb = goalsBoard(g);
    if (gb && bestView.markets.goal) {
      gb.players.forEach((r) => {
        if (r.out || !has(r.odds) || !has(r.edge) || r.edge < edgeAt("lean")) return;
        const play = { side: "yes", price: r.odds, chance: r.chance, edge: r.edge, fair: r.fair };
        const result = has(r.actual) ? (r.actual > 0 ? "win" : "loss") : null;
        out.push({ market: "goal", r, g, posted: !!gb.posted, play, thin: !!r.thin, result, state });
      });
    }
    // Points: points.json's play as the build filed it (shots_play at the Points buckets).
    const pb = pointsBoard(g);
    if (pb && bestView.markets.pts) {
      pb.players.forEach((r) => {
        if (r.out || !r.side || !has(r.edge) || r.edge < edgeAt("lean")) return;
        const chance = r.side === "over" ? r.chance_over : 1 - r.chance_over;
        const play = { side: r.side, line: r.line, price: r.price, chance, edge: r.edge, fade: !!r.fade };
        const result = has(r.actual) && r.actual !== r.line ? ((r.side === "over") === r.actual > r.line ? "win" : "loss") : null;
        out.push({ market: "pts", r, g, posted: !!pb.posted, play, thin: !!r.thin, result, state });
      });
    }
  });
  return out;
}
const SORTS = {
  edge: (x) => x.play.edge,
  odds: (x) => payout(x.play.price),
  fair: (x) => -x.play.chance, // most first = the longest fair price
  time: (x) => -Date.parse(x.g.start_utc || 0), // earliest first when "most first"
  market: (x) => ({ goal: 0, sog: 1, pts: 2 })[x.market],
};
function sortedPlays(date) {
  const get = SORTS[bestView.sort] || SORTS.edge;
  return playsFor(date)
    .filter((x) => nameMatches(x.r.name))
    .filter((x) => Math.round(x.play.edge * 1000) / 10 >= bestView.minEdge)
    .filter((x) => bestView.lineup === "all" || x.posted)
    .filter((x) => !dayIsMixed(date) || bestView.when === "all" || (bestView.when === "open") === (x.state === "open"))
    .sort((a, b) => {
      // Plays still to come first, then games in progress, then finished ones, whatever the sort.
      if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
      return (get(a) - get(b)) * bestView.dir || b.play.edge - a.play.edge;
    });
}

// ---- drawing ----
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const board = anyBoard(g);
      const lineup = !board
        ? ""
        : board.posted
          ? `<span class="shots-card-lineup shots-card-lineup-in" title="The NHL's projected lineup for this game is in">&#10003; Lineup</span>`
          : `<span class="shots-card-lineup" title="The NHL hasn't posted this game's projected lineup yet (usually around midday Eastern)">No lineup yet</span>`;
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}${board ? "" : " shots-card-empty"}" data-game="${g.game_id}" data-away="${g.away}" data-home="${g.home}" title="${board ? "Show only this game (click again for the whole day)" : "No projections for this game yet"}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
        ${lineup}
      </button>`;
    })
    .join("");
}
function renderToolbar() {
  const date = days()[dayIndex];
  // Market switches: each on or off on its own (at least one stays on).
  const markets = MARKETS.map(([key, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn best-market${bestView.markets[key] ? " active" : ""}" data-market="${key}" aria-pressed="${bestView.markets[key]}"><span class="best-check" aria-hidden="true">${bestView.markets[key] ? "&#10003;" : ""}</span>${label}</button>`).join("");
  const when = dayIsMixed(date)
    ? `<span class="shots-filter">${[["all", "All games"], ["open", "Not started"], ["started", "Live / final"]].map(([v, t]) => `<button type="button" class="view-toggle-btn shots-filter-btn${bestView.when === v ? " active" : ""}" data-when="${v}">${t}</button>`).join("")}</span>`
    : "";
  const menu = (key, label, options, tip) =>
    `<label class="shots-menu" title="${tip}"><span>${label}</span><select class="shots-filter-select" data-filter="${key}">${options.map(([value, text]) => `<option value="${value}"${String(bestView[key]) === String(value) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  const lean = Math.round(edgeAt("lean") * 100);
  const edges = [lean, 5, 7, 10, 15].filter((v, i, a) => v >= lean && a.indexOf(v) === i).map((v) => [v, `${v}+ points`]);
  const filters = menu("minEdge", "Edge", edges, "Only plays with at least this much edge (the model's chance minus the chance the price needs, in points)") +
    menu("lineup", "Lineups", [["all", "All plays"], ["posted", "Lineup confirmed"]], "Lineup confirmed = the NHL's projected lineup for the game is in");
  el("best-toolbar").innerHTML = `<span class="shots-filter best-markets"><span class="best-filter-label">Markets</span>${markets}</span>${filters}${when}`;
}
// The lineup banner: plays in a game whose lineup isn't in can still change.
function renderNote() {
  const date = days()[dayIndex];
  const g = currentGame();
  el("best-title").innerHTML = `Best Plays${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((x) => anyBoard(x) && gameState(x) === "open" && (!gameId || x.game_id === gameId));
  const waiting = open.filter((x) => !anyBoard(x).posted).length;
  el("best-lineups").hidden = !waiting;
  el("best-lineups").innerHTML = waiting
    ? `<b>Lineups are in for ${open.length - waiting} of ${open.length} games.</b> Plays marked <span class="best-note best-note-wait">No lineup</span> can change when the NHL posts it (around midday ET; the page refreshes every hour).`
    : "";
  const started = gamesOn(date).filter((x) => anyBoard(x) && gameState(x) !== "open").length;
  el("best-locked").hidden = !started;
  el("best-locked").textContent = started ? `${started} of these games have started: their plays are grayed, at the last price from before puck drop.` : "";
}
const slotName = (slot) => (slot ? `${slot[0] === "F" ? "L" : "D"}${slot.slice(1)}` : "");
// What the model may not know yet, said as small notes (never a verdict).
function notesFor(x) {
  const r = x.r;
  const notes = [];
  if (!x.posted) notes.push(["wait", "No lineup", "The NHL hasn't posted this game's projected lineup: his recent ice time stands in. The play can change when it does."]);
  if (r.move) {
    const against = x.market === "goal" ? r.move === "down" : r.move === (x.play.side === "under" ? "up" : "down");
    notes.push([against ? "warn" : "info", `${slotName(r.slot)} ${r.move === "up" ? "&#9650;" : "&#9660;"}`, `On a ${r.move === "up" ? "higher" : "lower"} line tonight (${slotName(r.slot)}) than his minutes this season say.${against ? " This play goes the other way: his games so far don't describe tonight's role." : ""}`]);
  }
  if (has(r.games) && r.games < SMALL_SAMPLE) notes.push(["warn", `${r.games} GP`, `Only ${r.games} game${r.games === 1 ? "" : "s"} this season: a small sample.`]);
  if (x.market !== "goal" && x.play.fade) notes.push(["info", "vs avg", `Goes against his season average (${fmt(r.avg, 2)} ${x.market === "pts" ? "points" : "shots"} a game): the model thinks a small sample has run ${x.play.side === "under" ? "hot" : "cold"}.`]);
  if (x.thin) notes.push(["warn", "Thin", "Barely traded on Novig: treat the price with care."]);
  return notes.map(([kind, text, tip]) => `<span class="best-note best-note-${kind}" title="${tip}">${text}</span>`).join("");
}
function playCell(x) {
  if (x.market === "goal") return `<span class="shots-play shots-play-over best-play" title="Anytime goal: he scores at least once"><b>Scores</b><span>goal</span></span>`;
  const p = x.play;
  const what = x.market === "pts" ? "points" : "shots";
  return `<span class="shots-play shots-play-ou shots-play-${p.side} best-play" title="${p.side === "over" ? "Over" : "Under"} ${fmt(p.line)} ${x.market === "pts" ? "points" : "shots on goal"}"><b>${p.side[0]}${fmt(p.line)}</b><span>${what}</span></span>`;
}
function edgeCell(x) {
  const edge = x.play.edge;
  const alpha = Math.min(0.34, 0.08 + (edge - edgeAt("lean")) * 3).toFixed(2);
  return `<td class="num shots-edge tier-good" style="--tier-a:${alpha}" title="The model's ${Math.round(x.play.chance * 100)}% minus the ${Math.round(breakEven(x.play.price) * 100)}% this price needs to break even">${points(edge)}</td>`;
}
function bestResultCell(x) {
  if (!x.result) return `<td class="num muted-label">--</td>`;
  const got = `${x.r.actual} ${{ sog: "SOG", goal: "G", pts: "PTS" }[x.market]}`;
  return `<td class="num"><span class="pick-result pick-result-${x.result}">${x.result === "win" ? "W" : "L"}</span> <small>${got}</small></td>`;
}
const COLUMNS = [
  { key: null, label: "#", cell: (x, i) => `<td class="num shots-rank">${i + 1}</td>` },
  { key: null, label: "Player", search: true, cls: "shots-th-player", cell: (x) => {
    const found = findPlayer(x.r.id);
    return `<td class="nba-player shots-player">${playerClick(x.r.id, `${headshot(found ? found.row : {})}<span>${x.r.name}</span>`)}<span class="muted-label">${x.r.pos}</span><span class="shots-vs">${logo(x.r.team, 16)}<span class="at">${x.r.home ? "vs" : "@"}</span>${logo(x.r.opp, 16)}</span></td>`;
  } },
  { key: "market", label: "Play", title: "The bet: o / u = over / under his shots on goal or points line; Scores = anytime goal", cell: (x) => `<td class="shots-play-cell">${playCell(x)}</td>` },
  { key: "fair", label: "GMG Fair", title: "The price the GMG model says this bet is worth, with no cut: its chance turned into odds. Odds longer than this are the edge", cell: (x) => `<td class="num best-fair" title="The GMG model gives it ${Math.round(x.play.chance * 100)}%">${odds(has(x.play.fair) ? x.play.fair : fairPrice(x.play.chance)) || "--"}</td>` },
  { key: "odds", label: "Odds", title: "The price, from Novig (logo and name under it). Sort by it for the biggest payout first", cell: (x) => `<td class="num best-odds"><span class="best-book" title="Price from Novig"><img src="../novig-logo.jpg" alt="Novig" class="best-book-logo" width="18" height="18"><b>${odds(x.play.price)}</b></span><small class="best-book-name">Novig</small></td>` },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points", cell: edgeCell },
  { key: null, label: "Notes", title: "What the model may not know yet: no lineup, a line change tonight, a small sample, a thin price", cell: (x) => `<td class="best-notes">${notesFor(x) || `<span class="muted-label">--</span>`}</td>` },
  { key: "time", label: "Puck drop", cell: (x) => `<td class="num muted-label">${fmtTime(x.g.time).replace(" ET", "")}</td>` },
  { key: null, label: "", cell: (x) => `<td class="best-more"><a href="${MARKETS.find(([k]) => k === x.market)[2]}#row=${x.g.game_id}:${x.r.id}" title="The full breakdown on the ${PAGE_NAME[x.market]} page">${PAGE_NAME[x.market]} &rsaquo;</a></td>` },
];
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedPlays(date);
  const showResult = rows.some((x) => x.result);
  const width = COLUMNS.length + (showResult ? 1 : 0) + 1;
  if (!rows.length && !nameSearching()) {
    const any = gamesOn(date).some(anyBoard);
    el("best-content").innerHTML = `<p class="no-data-note">${!any ? `No projections for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.` : "No plays with an edge right now. Prices and lineups fill in through the day as the page refreshes."}</p>`;
    return;
  }
  const head = COLUMNS.map((c) => {
    const active = c.key && c.key === bestView.sort;
    return `<th${c.key ? ` class="shots-sort${active ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}" data-sort="${c.key}"` : c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${c.search ? nameSearchBox() : ""}${active ? `<span class="shots-arrow">${bestView.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const heading = (text, i) => `${i > 0 ? `<tr class="group-gap"><td colspan="${width}"></td></tr>` : ""}<tr class="group-row shots-state-head"><td colspan="${width}">${text}</td></tr>`;
  const body = rows
    .map((x, i) => {
      const prev = rows[i - 1];
      const divider = x.state !== "open" && i > 0 && prev.state !== x.state
        ? heading(x.state === "live" ? "Live now: these games have started. Prices and chances are the last ones from before puck drop." : "Final: locked before puck drop and graded.", i)
        : "";
      return `${divider}<tr class="shots-row best-row${x.state === "live" ? " shots-live" : ""}" data-state="${x.state}" data-key="${x.market}:${x.g.game_id}:${x.r.id}" data-href="${MARKETS.find(([k]) => k === x.market)[2]}#row=${x.g.game_id}:${x.r.id}">
        ${COLUMNS.map((c) => c.cell(x, i)).join("")}${showResult ? bestResultCell(x) : ""}<td class="shots-spacer"></td>
      </tr>`;
    })
    .join("");
  const counts = MARKETS.filter(([k]) => bestView.markets[k]).map(([k, label]) => `${rows.filter((x) => x.market === k).length} ${label.toLowerCase()}`).join(" &middot; ");
  el("best-content").innerHTML = `<p class="best-count">${rows.length} plays with an edge of ${Math.round(edgeAt("lean") * 100)}+ points <span class="muted-label">${counts}</span></p>
    <div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table best-table">
      <thead><tr>${head}${showResult ? `<th>Result</th>` : ""}<th class="shots-spacer"></th></tr></thead>
      <tbody>${body || nameSearchMiss(width)}</tbody>
    </table></div></div>`;
}

// ---- the record: every play this page lists, from the Shots, Goals and Points records ----
// The owner, 2026-10-16: "How are SOG Best plays with a 10% edge doing in the last
// 15 days". Each record's `ledger` is every graded play of the season ([date,
// edge, won, units]); the popup filters it by days back and, per market, a
// minimum edge. A per-device choice, like the other views.
const RECORD_KEY = "nfl-tool.nhl-best-record.v1";
const RECORD_WINDOWS = [[3, "Last 3 days"], [7, "Last 7 days"], [15, "Last 15 days"], [30, "Last 30 days"], [0, "Season"]];
const EDGE_MAX = 20;
const recordView = (() => {
  const lean = Math.round(edgeAt("lean") * 100);
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(RECORD_KEY)) || {};
    } catch (e) {
      return {};
    }
  })();
  const minEdge = (v) => (Number.isFinite(v) ? Math.max(lean, Math.min(EDGE_MAX, v)) : lean);
  return { days: RECORD_WINDOWS.some(([d]) => d === saved.days) ? saved.days : 0, sog: minEdge(saved.sog), goal: minEdge(saved.goal), pts: minEdge(saved.pts) };
})();
function saveRecordView() {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(recordView));
  } catch (e) {
    /* private window: the choice just isn't remembered */
  }
}
const signedU = (u) => `${u >= 0 ? "+" : ""}${u.toFixed(1)}u`;
// The first day inside "the last N days", counting today.
function windowStart(n) {
  if (!n) return "";
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toLocaleDateString("en-CA");
}
// The ledger's plays from `since` on with an edge of `min`+ points (as the table rounds it: 9.96 shows as 10.0).
function tally(ledger, since, min) {
  return (ledger || []).reduce((t, [date, edge, won, units]) => {
    if (date < since || Math.round(edge * 1000) / 10 < min) return t;
    return { wins: t.wins + (won ? 1 : 0), losses: t.losses + (won ? 0 : 1), units: t.units + units };
  }, { wins: 0, losses: 0, units: 0 });
}
function tileBody(t) {
  const played = t.wins + t.losses;
  const kind = !played ? "" : t.units > 0.05 ? " best-rec-up" : t.units < -0.05 ? " best-rec-down" : "";
  return `<b>${t.wins}-${t.losses}</b><small class="best-rec-line${kind}">${played ? `${Math.round((100 * t.wins) / played)}% &middot; ${signedU(t.units)}` : "no graded plays"}</small>`;
}
// Before the build sent ledgers: the season's buckets, unfiltered.
function renderRecordBuckets(box) {
  const sum = (rec) => ["strong", "lean", "check"].reduce((t, k) => {
    const b = (rec || {})[k] || {};
    return { wins: t.wins + (b.wins || 0), losses: t.losses + (b.losses || 0), units: t.units + (b.units || 0) };
  }, { wins: 0, losses: 0, units: 0 });
  const shots = sum(SHOTS.record);
  const goals = sum(GOALS.record);
  const pts = sum(POINTS.record);
  const all = { wins: shots.wins + goals.wins + pts.wins, losses: shots.losses + goals.losses + pts.losses, units: shots.units + goals.units + pts.units };
  const tile = (label, t, tip) => `<div class="nba-tile" title="${tip}"><div class="gs-tile-label">${label}</div>${tileBody(t)}</div>`;
  box.innerHTML = `<div class="shots-detail-label">Every play with an edge of ${Math.round(edgeAt("lean") * 100)}+ points <span class="muted-label">graded at the price locked before puck drop; u = units won risking 1 a play. The full records are on the Shots, Goals and Points pages.</span></div>
    <div class="nba-tiles shots-record">
      ${tile("All plays", all, "Every play this page lists")}
      ${tile("Shots on goal", shots, "Shots plays with an edge")}
      ${tile("Anytime goal", goals, "Goal plays with an edge")}
      ${tile("Points", pts, "Points plays with an edge")}
    </div>`;
}
const LEDGERS = () => ({ sog: (SHOTS.record || {}).ledger, goal: (GOALS.record || {}).ledger, pts: (POINTS.record || {}).ledger });
function renderRecord() {
  const box = el("best-results");
  const ledgers = LEDGERS();
  if (!ledgers.sog && !ledgers.goal && !ledgers.pts) return renderRecordBuckets(box);
  const lean = Math.round(edgeAt("lean") * 100);
  const windows = RECORD_WINDOWS.map(([d, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${recordView.days === d ? " active" : ""}" data-rec-days="${d}">${label}</button>`).join("");
  const slider = (key) => `<label class="best-rec-edge"><span>Min edge</span><input type="range" min="${lean}" max="${EDGE_MAX}" step="1" value="${recordView[key]}" data-rec-edge="${key}" aria-label="Minimum edge, ${{ sog: "shots on goal", goal: "anytime goal", pts: "points" }[key]}"><output data-rec-out="${key}"></output></label>`;
  box.innerHTML = `<div class="shots-detail-label">Graded plays <span class="muted-label">at the price locked before puck drop; u = units won risking 1 a play. Slide a market's minimum edge (in points) to see how the bigger edges have done. The full records are on the Shots, Goals and Points pages.</span></div>
    <div class="view-toggle shots-filter best-rec-windows">${windows}</div>
    <div class="nba-tiles best-rec-tiles">
      <div class="nba-tile" data-rec-tile="all" title="Both markets, each at its own minimum edge"><div class="gs-tile-label">All plays</div><div data-rec-body="all"></div><small class="best-rec-sub" data-rec-sub="all"></small></div>
      <div class="nba-tile" data-rec-tile="sog" title="Shots on goal plays at or above the minimum edge"><div class="gs-tile-label">Shots on goal</div><div data-rec-body="sog"></div>${slider("sog")}</div>
      <div class="nba-tile" data-rec-tile="goal" title="Anytime goal plays at or above the minimum edge"><div class="gs-tile-label">Anytime goal</div><div data-rec-body="goal"></div>${slider("goal")}</div>
      <div class="nba-tile" data-rec-tile="pts" title="Points plays at or above the minimum edge"><div class="gs-tile-label">Points</div><div data-rec-body="pts"></div>${slider("pts")}</div>
    </div>`;
  updateRecord();
}
// Only the numbers: a slider being dragged keeps its place.
function updateRecord() {
  const box = el("best-results");
  const ledgers = LEDGERS();
  const since = windowStart(recordView.days);
  const sog = tally(ledgers.sog, since, recordView.sog);
  const goal = tally(ledgers.goal, since, recordView.goal);
  const pts = tally(ledgers.pts, since, recordView.pts);
  const all = { wins: sog.wins + goal.wins + pts.wins, losses: sog.losses + goal.losses + pts.losses, units: sog.units + goal.units + pts.units };
  const put = (sel, html) => {
    const node = box.querySelector(sel);
    if (node) node.innerHTML = html;
  };
  put('[data-rec-body="all"]', tileBody(all));
  put('[data-rec-body="sog"]', tileBody(sog));
  put('[data-rec-body="goal"]', tileBody(goal));
  put('[data-rec-body="pts"]', tileBody(pts));
  put('[data-rec-out="sog"]', `${recordView.sog}+`);
  put('[data-rec-out="goal"]', `${recordView.goal}+`);
  put('[data-rec-out="pts"]', `${recordView.pts}+`);
  put('[data-rec-sub="all"]', `Shots ${recordView.sog}+ &middot; Goals ${recordView.goal}+ &middot; Points ${recordView.pts}+`);
}
document.addEventListener("input", (e) => {
  const key = e.target.dataset && e.target.dataset.recEdge;
  if (!key) return;
  recordView[key] = Number(e.target.value);
  saveRecordView();
  updateRecord();
});

function render() {
  if (!DATA) return;
  renderSchedule();
  renderToolbar();
  renderNote();
  renderRecord();
  renderTable();
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  gameId = null;
  render();
}
const showRecord = (open) => {
  el("best-record-modal").hidden = !open;
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") showRecord(false);
});
document.addEventListener("change", (e) => {
  const menu = e.target.closest(".shots-filter-select");
  if (!menu) return;
  const key = menu.dataset.filter;
  bestView[key] = key === "minEdge" ? Number(menu.value) : menu.value;
  render();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#best-record-open")) return showRecord(true);
  if (e.target.id === "best-record-modal" || e.target.closest("#best-record-modal .modal-close")) return showRecord(false);
  const window_ = e.target.closest("[data-rec-days]");
  if (window_) {
    recordView.days = Number(window_.dataset.recDays);
    saveRecordView();
    return renderRecord();
  }
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const market = e.target.closest(".best-market");
  if (market) {
    const key = market.dataset.market;
    const on = !bestView.markets[key];
    // At least one market stays on.
    if (on || Object.values(bestView.markets).filter(Boolean).length > 1) bestView.markets[key] = on;
    return render();
  }
  const when = e.target.closest("[data-when]");
  if (when) {
    bestView.when = when.dataset.when;
    return render();
  }
  const sort = e.target.closest(".shots-sort");
  if (sort) {
    if (bestView.sort === sort.dataset.sort) bestView.dir = -bestView.dir;
    else Object.assign(bestView, { sort: sort.dataset.sort, dir: -1 });
    return renderTable();
  }
  // A row opens its own row on the Shots, Goals or Points page (a name opens the player card instead).
  const row = e.target.closest(".best-row");
  if (row && !e.target.closest(".player-click, a")) location.href = row.dataset.href;
});

const getJson = (url) =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
Promise.all([loadNhlData(), getJson("shots.json"), getJson("goals.json"), getJson("points.json")])
  .then(([, shots, goals, pts]) => {
    SHOTS = shots || { games: {} };
    GOALS = goals || { games: {} };
    POINTS = pts || { games: {} };
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    const day = all.find((d) => d >= today && gamesOn(d).some(anyBoard)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    el("empty-state").hidden = true;
    el("best-app").hidden = false;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
