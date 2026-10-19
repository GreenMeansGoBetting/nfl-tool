// ---- GMG NHL Suite: Saves (goalie saves over / under) ----
// Every expected starting goalie in the day's games, ranked by value: the
// King of the Crease saves model's chance of the over at Novig's main saves
// line (nfl_tool/nhl/saves_model.py, written to saves.json by the build from
// crease.json's board) against the better side's price. Set up like Shots,
// Goals and Points; this season's numbers only, like every NHL prop tool.
// No saves math lives here: the build sends each goalie's chances, fair
// price, the play (side, price, edge) and its bucket (`size`, the one the
// record is graded by); the page draws them.

let SAVES = null;
let dayIndex = 0;
let gameId = null;
// adv: the "advanced stats" columns shown or folded away (shared with the other prop pages, per device).
const savesView = { starter: "all", minEdge: "all", odds: "all", sort: "edge", dir: -1, open: null, record: "edge", when: "all", checks: true, adv: nhlAdvancedStats() };

const edgeAt = (size) => ((SAVES || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
const checkSaves = () => (SAVES || {}).check_saves || 4;
// Set apart, the Points page's way: a gap of 12+ points, or the model 4+ saves from what the line says
// (the build's saves_play files both as "check").
const needsCheck = (x) => x.r.size === "check";
const LIFT_CALL = 0.025;
const breakEven = (price) => (has(price) ? (price < 0 ? -price / (100 - price) : 100 / (price + 100)) : null);
const fairPrice = (p) => (!has(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
function points(edge) {
  if (!has(edge)) return "--";
  const text = (edge * 100).toFixed(1);
  return Number(text) === 0 ? "0.0" : `${edge > 0 ? "+" : ""}${text}`;
}
const liftText = (lift) => `${lift >= 1 ? "+" : ""}${Math.round((lift - 1) * 100)}%`;
const liftTier = (lift) => (lift - 1 >= LIFT_CALL ? "tier-good" : lift - 1 <= -LIFT_CALL ? "tier-bad" : "");
const rankWord = (rank) => rankWords(rank, 32);
const siteLift = (r) => r.lift.home * r.lift.b2b * r.lift.opp_b2b;
// The play's own chance: the over at his line, or the under.
const playChance = (r) => (r.side === "over" ? r.chance_over : r.side === "under" ? 1 - r.chance_over : null);
// The two sources behind the name agree (the only check mark; never "settled").
const agrees = (r) => r.source === "both";

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
const boardFor = (g) => ((SAVES || {}).games || {})[g.game_id] || null;
function seasonLine(id) {
  const found = id ? findPlayer(id) : null;
  return found ? found.row : null;
}
function gameState(g) {
  const board = boardFor(g) || {};
  if (g.status === "final" || board.final) return "final";
  return board.locked || g.status === "live" || (g.start_utc && Date.now() >= Date.parse(g.start_utc)) ? "live" : "open";
}
const STATE_ORDER = { open: 0, live: 1, final: 2 };
const dayIsMixed = (date) => new Set(gamesOn(date).filter(boardFor).map((g) => (gameState(g) === "open" ? "open" : "started"))).size === 2;

// ---- rows ----
function gradePlay(r) {
  if (!has(r.actual) || r.void || !r.side || r.actual === r.line) return null;
  return (r.side === "over") === r.actual > r.line ? "win" : "loss";
}
function rowsFor(date) {
  const rows = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const board = boardFor(g);
    if (!board) return;
    board.goalies.forEach((r) => rows.push({ r, game: g, board, season: seasonLine(r.id), result: gradePlay(r), state: gameState(g) }));
  });
  return rows;
}
const SORTS = {
  edge: (x) => x.r.edge,
  avg: (x) => x.r.saves_avg,
  mean: (x) => x.r.mean,
  chance: (x) => playChance(x.r),
  shots: (x) => x.r.shots,
  off: (x) => x.r.lift.off,
  def: (x) => x.r.lift.def,
  sv: (x) => x.r.lift.sv,
  site: (x) => siteLift(x.r),
};
const rankedByEdge = () => savesView.sort === "edge" && savesView.dir < 0;
// Ranked by edge: "check first" on top (as on the other prop pages), then the plays, then
// every goalie with no odds by his projection.
const rankGroup = (x) => (needsCheck(x) ? 0 : has(x.r.edge) ? 1 : 2);
function sortedRows(date, starter = savesView.starter, checks = savesView.checks) {
  const get = SORTS[savesView.sort] || SORTS.edge;
  return rowsFor(date)
    .filter((x) => nameMatches(x.r.name || ""))
    .filter((x) => starter === "all" || agrees(x.r))
    .filter((x) => edgeAtLeast(x.r.edge, savesView.minEdge))
    .filter((x) => savesView.odds === "all" || has(x.r.line))
    .filter((x) => checks || !needsCheck(x))
    .filter((x) => !dayIsMixed(date) || savesView.when === "all" || (savesView.when === "open") === (x.state === "open"))
    .sort((a, b) => {
      if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (rankedByEdge() && rankGroup(a) !== rankGroup(b)) return rankGroup(a) - rankGroup(b);
      const [va, vb] = [get(a), get(b)];
      if (!has(va) || !has(vb)) return has(va) ? -1 : has(vb) ? 1 : b.r.mean - a.r.mean;
      return (va - vb) * savesView.dir || b.r.mean - a.r.mean;
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
      const board = boardFor(g);
      const both = board && board.goalies.filter(agrees).length;
      const starters = !board
        ? ""
        : both === board.goalies.length
          ? `<span class="shots-card-lineup shots-card-lineup-in" title="For both teams, the NHL's projected lineup and the goalie Novig prices name the same starter (a projection, never a confirmation)">&#10003; Starters</span>`
          : `<span class="shots-card-lineup" title="The NHL's projected lineup and Novig's saves lines don't name the same starter for both teams yet">Starters: ${both} of ${board.goalies.length}</span>`;
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}${board ? "" : " shots-card-empty"}" data-game="${g.game_id}" data-away="${g.away}" data-home="${g.home}" title="${board ? "Show only this game (click again for the whole day)" : "No projections for this game yet"}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
        ${starters}
      </button>`;
    })
    .join("");
}
function renderToolbar() {
  const group = (key, options) =>
    `<span class="shots-filter">${options.map(([value, label, tip]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(savesView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}"${tip ? ` title="${tip}"` : ""}>${label}</button>`).join("")}</span>`;
  const menu = (key, label, options, tip) =>
    `<label class="shots-menu"${tip ? ` title="${tip}"` : ""}><span>${label}</span><select class="shots-filter-select" data-filter="${key}">${options.map(([value, text]) => `<option value="${value}"${String(savesView[key]) === String(value) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  const checks = sortedRows(days()[dayIndex], savesView.starter, true).filter(needsCheck).length;
  el("shots-toolbar").innerHTML =
    menu("starter", "Starters", [["all", "All goalies"], ["agree", "Lineup + book agree"]], "All goalies: every team's expected starter. Lineup + book agree: only goalies the NHL's projected lineup and Novig's saves line both name (a projection, never a confirmation)") +
    menu("minEdge", "Edge", edgeOptions(), "Only plays with at least this much edge (the model's chance minus the chance the price needs, in points)") +
    menu("odds", "Odds", [["all", "Priced or not"], ["priced", "Priced only"]], "Priced or not: every goalie, the ones Novig hasn't priced with the model's projection only") +
    `<span class="shots-filter"><button type="button" class="view-toggle-btn shots-filter-btn shots-check-toggle${savesView.checks ? " active" : ""}" data-filter="checks" data-value="${!savesView.checks}" title="Check plays: a gap to the market of ${Math.round(edgeAt("check") * 100)}+ points, or the model ${checkSaves()}+ saves from what the line says. They lead the ranking; click to ${savesView.checks ? "hide" : "show"} them.">Check plays: ${savesView.checks ? "Shown" : `Hidden${checks ? ` (${checks})` : ""}`}</button></span>` +
    advancedToggle(savesView.adv) +
    (dayIsMixed(days()[dayIndex])
      ? group("when", [
          ["all", "All games", "Every goalie of the day: games still to come first, started games grayed underneath"],
          ["open", "Not started", "Only games that haven't started"],
          ["started", "Live / final", "Only games that have started: locked at the last price before puck drop"],
        ])
      : "");
}
// The play as a bettor writes it: "o27.5" / "u27.5" (the Shots page's chip), green over, red under.
function playChip(r) {
  if (!r.side) {
    return has(r.line)
      ? `<span class="goals-noodds" title="Novig has a saves line for him but no price on either side yet">No price</span>`
      : `<span class="goals-noodds" title="Novig has no saves line for him yet. The projection is there to shop elsewhere; lines fill in through the day.">No odds</span>`;
  }
  return `<span class="shots-play shots-play-ou shots-play-${r.side}" title="${r.side === "over" ? "Over" : "Under"} ${fmt(r.line)} saves at Novig's price"><b>${r.side[0]}${fmt(r.line)}</b><span>${odds(r.price)}</span></span>`;
}
// Who should start, and how much stands behind the name (crease_starter in build_nhl.py).
function starterTip(r) {
  return {
    both: "The NHL's projected lineup and the goalie Novig prices agree. A projection, never a confirmation: starters are official at warmups.",
    split: `Novig prices ${r.name}; the NHL's projected lineup has ${r.other}. The book's goalie is shown (it is the later of the two). If the other one starts, the bet is void.`,
    lineup: `Only the NHL's projected lineup names him so far${r.doubt ? ". He started last night, so check before you bet" : ""}.`,
    market: "Only Novig's saves line names him so far: the NHL hasn't posted this game's projected lineup.",
    usual: "Neither the NHL's lineup nor a saves line names a starter yet: the goalie with the most starts, or his partner on the second night of a back-to-back.",
  }[r.source] || "";
}
function starterTag(r) {
  if (r.source === "both") return `<span class="shots-flag saves-agree" title="${starterTip(r)}">&#10003; agree</span>`;
  if (r.source === "split") return `<span class="shots-flag shots-fade" title="${starterTip(r)}">Lineup: ${(r.other || "").split(" ").slice(-1)[0]}</span>`;
  if (r.doubt) return `<span class="shots-flag shots-fade" title="${starterTip(r)}">Started last night</span>`;
  return `<span class="shots-flag saves-plain" title="${starterTip(r)}">${{ lineup: "Lineup only", market: "Book only", usual: "Usual starter" }[r.source] || ""}</span>`;
}
// The build's bucket (the one the record grades), said on the row: Strong / Lean / Check.
function ratingCell(x) {
  const r = x.r;
  const n = (size) => Math.round(edgeAt(size) * 100);
  const fade = r.fade && r.edge >= edgeAt("lean") ? `<span class="shots-flag shots-fade" title="This goes against his season average (${fmt(r.saves_avg, 1)} saves a start in ${r.starts} starts): the model reads tonight's matchup differently.">vs his avg</span>` : "";
  const tag = r.size === "strong"
    ? ratingTag("strong", "Strong", `An edge of ${n("strong")} to ${n("check")} points`)
    : r.size === "lean"
      ? ratingTag("lean", "Lean", `An edge of ${n("lean")} to ${n("strong")} points`)
      : !needsCheck(x)
        ? ""
        : r.edge >= edgeAt("check")
          ? ratingTag("check", "Check", "A gap this big usually means the market knows something this season's few games don't. Check before you bet.")
          : ratingTag("check", "Check", `The model has ${fmt(r.mean, 1)} saves; the line and price say ${fmt(r.mkt_mean, 1)}. ${checkSaves()}+ saves apart is more often a starter or news the book knows. Check before you bet.`);
  return `<td class="shots-rating">${tag || `<span class="muted-label">--</span>`}${fade}</td>`;
}
function edgeCell(x) {
  const r = x.r;
  if (!has(r.edge)) return `<td class="num muted-label shots-edge" title="No price to compare with">--</td>`;
  const lean = edgeAt("lean");
  // Colored by the build's bucket (the one the record grades), never by the rounded edge.
  const cls = needsCheck(x) ? "tier-mid" : r.size === "lean" || r.size === "strong" ? "tier-good" : "";
  const alpha = cls === "tier-good" ? ` style="--tier-a:${Math.min(0.34, 0.08 + (r.edge - lean) * 3).toFixed(2)}"` : "";
  const flag = r.thin ? `<span class="shots-flag" title="Novig prices only one side of this line: treat the price with care">thin</span>` : "";
  return `<td class="num shots-edge ${cls}"${alpha} title="The model's ${Math.round(playChance(r) * 100)}% minus the ${Math.round(breakEven(r.price) * 100)}% this price needs to break even">${points(r.edge)}${flag}</td>`;
}
function fairCell(x) {
  const r = x.r;
  if (!r.side) return `<td class="num muted-label">--</td>`;
  return `<td class="num" title="The model's chance of ${r.side} ${fmt(r.line)}: ${pct(playChance(r), 0)}">${odds(r.fair) || "--"}</td>`;
}
// Avg and Proj side by side: his season and tonight's number, the line between them.
function avgCell(r) {
  if (!r.starts) return `<td class="num muted-label" title="No starts this season">--</td>`;
  return `<td class="num" title="${r.starts} starts, ${fmt(r.sv_pct * 100, 1)}% saved, high ${r.high || "--"}">${fmt(r.saves_avg, 1)}<small class="muted-label"> /${r.starts}gs</small></td>`;
}
function projCell(r) {
  const vs = has(r.line) ? r.mean - r.line : 0;
  const cls = has(r.line) ? (vs >= 1 ? "tier-good" : vs <= -1 ? "tier-bad" : "") : "";
  const tip = has(r.line) ? `The model's saves tonight; Novig's line is ${fmt(r.line)}${has(r.mkt_mean) ? `, and the line with its price says ${fmt(r.mkt_mean, 1)}` : ""}` : "The model's saves tonight";
  return `<td class="num ${cls}" title="${tip}"><b>${fmt(r.mean, 1)}</b></td>`;
}
function liftCell(lift, tip) {
  return `<td class="num shots-lift ${liftTier(lift)}" title="${tip}">${liftText(lift)}</td>`;
}
const offTip = (r) => `${r.opp} puts ${fmt(r.opp_shots, 1)} shots on goal a game this season (${rankWord(r.opp_shots_rank)}). The model counts it as ${liftText(r.lift.off)} on his saves.`;
const defTip = (r) => `${r.team} gives up ${fmt(r.allowed, 1)} shots on goal a game this season (${rankWord(r.allowed_rank)}). The model counts it as ${liftText(r.lift.def)} on his saves.`;
const svTip = (r) => `His save rate this season (${has(r.sv_pct) ? `${fmt(r.sv_pct * 100, 1)}%` : "none yet"}), pulled hard toward the league's: ${liftText(r.lift.sv)}. Over a handful of starts it is mostly luck.`;
function siteTip(r) {
  const parts = [r.home ? "Home ice (the road goalie sees more shots)" : "On the road (the road goalie sees more shots)"];
  if (r.b2b) parts.push(`${r.team} played yesterday`);
  if (r.opp_b2b) parts.push(`${r.opp} played yesterday`);
  return parts.join(". ");
}
function actualCell(x) {
  const r = x.r;
  if (!has(r.actual)) return `<td class="num muted-label">--</td>`;
  if (r.void) return `<td class="num muted-label" title="${r.started} started instead: books void the bet, and the record leaves it out">Void</td>`;
  const pill = x.result ? `<span class="pick-result pick-result-${x.result}">${x.result === "win" ? "W" : "L"}</span> ` : "";
  return `<td class="num">${pill}<b>${r.actual}</b></td>`;
}

// The open row: how the projection is built, both sides of the matchup, the
// prices at the model's fair price, and what stands behind the starter.
function detailRow(x, columns) {
  const r = x.r;
  const league = (SAVES.league || {}).saves;
  const step = (label, lift, tip) => `<span class="shots-step ${liftTier(lift)}" title="${tip || ""}"><small>${label}</small><b>${liftText(lift)}</b></span>`;
  const build = `<div class="shots-build">
      <span class="shots-step shots-step-end" title="Saves a start by every starter this season"><small>League start</small><b>${fmt(league, 1)}</b></span>
      ${step(`${r.opp} shooting`, r.lift.off, offTip(r))}
      ${step(`${r.team} defense`, r.lift.def, defTip(r))}
      ${step("Home / rest", siteLift(r), siteTip(r))}
      ${step("Save rate", r.lift.sv, svTip(r))}
      <span class="shots-step shots-step-end" title="Saves tonight, and the shots on goal that go with them"><small>Tonight</small><b>${fmt(r.mean, 1)} saves &middot; ${fmt(r.shots, 1)} shots</b></span>
    </div>`;
  const rankCell = (rank) => (has(rank) ? cellOnStep(rankStep(rank, 32)) : "");
  const tiles = `<div class="nba-tiles shots-allows">
      <div class="nba-tile"${rankCell(r.opp_shots_rank)} title="${offTip(r)}"><div class="gs-tile-label">${r.opp} shots a game</div><b>${fmt(r.opp_shots, 1)}</b><small>${rankWord(r.opp_shots_rank)}</small></div>
      <div class="nba-tile"${rankCell(r.allowed_rank)} title="${defTip(r)}"><div class="gs-tile-label">${r.team} allows a game</div><b>${fmt(r.allowed, 1)}</b><small>${rankWord(r.allowed_rank)}</small></div>
      <div class="nba-tile" title="His starts this season"><div class="gs-tile-label">His season</div><b>${r.starts ? `${fmt(r.saves_avg, 1)} a start` : "No starts"}</b><small>${r.starts ? `${r.starts} starts &middot; ${fmt(r.sv_pct * 100, 1)}% &middot; high ${r.high || "--"}` : ""}</small></div>
    </div>`;
  // The prices: the main line both ways, then the other lines Novig prices (overs only).
  const first = r.first || {};
  const priceRow = (label, chance, price, firstPrice, main) => {
    const edge = has(price) ? chance - breakEven(price) : null;
    return `<tr${main ? ' class="shots-main-line"' : ""}><td>${label}</td><td class="num">${pct(chance, 0)}</td><td class="num">${odds(fairPrice(chance)) || "--"}</td><td class="num"><b>${has(price) ? odds(price) : "--"}</b></td><td class="num">${has(firstPrice) ? odds(firstPrice) : "--"}</td><td class="num ${has(edge) && edge >= edgeAt("lean") ? "tier-good" : ""}">${points(edge)}</td></tr>`;
  };
  const sameFirst = first.line === r.line;
  const ladder = has(r.line)
    ? `<table class="data-table shots-ladder"><thead><tr><th>Saves</th><th title="The model's chance">Model</th><th title="The price with no cut at which the model's chance breaks even">Fair price</th><th>Novig</th><th title="The first price the page saw for him: the record grades how far it moved by puck drop">First seen</th><th title="The model's chance minus the chance the price needs to break even, in points">Edge</th></tr></thead><tbody>
      ${priceRow(`Over ${fmt(r.line)}`, r.chance_over, r.over, sameFirst ? first.over : null, r.side === "over")}
      ${priceRow(`Under ${fmt(r.line)}`, 1 - r.chance_over, r.under, sameFirst ? first.under : null, r.side === "under")}
      ${(r.alts || []).map(([at, price, chance]) => priceRow(`Over ${fmt(at)}`, chance, price, null, false)).join("")}</tbody></table>
      ${has(first.line) && !sameFirst ? `<p class="shots-lineup muted-label">The first line the page saw was ${fmt(first.line)}.</p>` : ""}`
    : `<p class="shots-lineup">Novig has no saves line for him yet. Lines fill in through the day as the page refreshes.</p>`;
  const gap = has(r.gap) ? `<p class="shots-lineup${Math.abs(r.gap) >= checkSaves() ? " saves-gap-far" : ""}">The model has <b>${fmt(r.mean, 1)}</b> saves; Novig's line and price say <b>${fmt(r.mkt_mean, 1)}</b> (${r.gap > 0 ? "+" : ""}${fmt(r.gap, 1)}).${Math.abs(r.gap) >= checkSaves() ? ` That is ${checkSaves()}+ saves apart: look for news on the starter first.` : ""}</p>` : "";
  const net = `<div class="shots-detail-label">In net (expected) ${starterTag(r)}</div>
      <p class="shots-lineup">${starterTip(r)}</p>${gap}
      <p class="shots-lineup muted-label">Early in a season the model knows little: in the first two weeks of the replay it was barely better than calling every goalie average. It has not been shown to beat the line; the record says how it does.</p>`;
  return `<tr class="shots-detail"><td colspan="${columns}">
      <div class="shots-detail-grid">
        <div class="shots-detail-main">
          <div class="shots-detail-label">How tonight's projection is built</div>${build}
          <div class="shots-detail-label">${logo(r.opp, 16)} Both sides of the matchup <span class="muted-label">this season, and where that ranks (green = more work for him)</span></div>${tiles}
          <div class="shots-detail-label">The price, at the model's fair price</div>${ladder}
        </div>
        <div class="shots-detail-rink">${net}</div>
      </div>
    </td></tr>`;
}

// Each column draws its own cell. `adv`: folded away until "Expand advanced stats".
const COLUMNS = [
  { key: null, label: "#", cell: (x, i) => `<td class="num shots-rank">${i + 1}</td>` },
  { key: null, label: "Goalie", search: true, cls: "shots-th-player", cell: (x) => `<td class="nba-player shots-player">${playerClick(x.r.id, `${headshot(x.season || {})}<span>${x.r.name || "Not named yet"}</span>`)}<span class="shots-vs">${logo(x.r.team, 16)}<span class="at">${x.r.home ? "vs" : "@"}</span>${logo(x.r.opp, 16)}</span></td>` },
  { key: null, label: "Starter", title: "What stands behind the name: the NHL's projected lineup and the goalie Novig prices. A check mark = they agree. Never a confirmation: starters are official at warmups", cell: (x) => `<td class="shots-rating">${starterTag(x.r)}</td>` },
  { key: null, label: "Play", title: "The better side of Novig's saves line for him at its price (o27.5 = 28 or more saves). No odds = not priced yet", cell: (x) => `<td class="shots-play-cell">${playChip(x.r)}</td>` },
  { key: null, label: "Rating", title: "How the record files the play: Strong (an edge of 6 to 12 points), Lean (3 to 6), Check (12+, or the model 4+ saves from what the line says: look for news first)", cell: ratingCell },
  { key: "avg", label: "Avg", title: "His saves a start this season", cell: (x) => avgCell(x.r) },
  { key: "mean", label: "Proj", title: "The model's saves tonight (green / red: a save or more above / below the line)", cell: (x) => projCell(x.r) },
  { key: "chance", label: "Fair", title: "The price with no cut at which the model's chance of the play breaks even", cell: fairCell },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points. Green from 3; from 12 it is set apart to be checked.", cell: edgeCell },
  { key: "shots", label: "Shots", adv: true, title: "Shots on goal the model expects him to face tonight", cell: (x) => `<td class="num">${fmt(x.r.shots, 1)}</td>` },
  { key: "off", label: "Opp shots", adv: true, title: "How much the other team shoots against the league", cell: (x) => liftCell(x.r.lift.off, offTip(x.r)) },
  { key: "def", label: "His D", adv: true, title: "How many shots his own team gives up against the league", cell: (x) => liftCell(x.r.lift.def, defTip(x.r)) },
  { key: "sv", label: "Save rate", adv: true, title: "His save rate this season, pulled hard toward the league's", cell: (x) => liftCell(x.r.lift.sv, svTip(x.r)) },
  { key: "site", label: "Home/rest", adv: true, title: "Home ice and back-to-backs", cell: (x) => liftCell(siteLift(x.r), siteTip(x.r)) },
];
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const shown = gamesOn(date).filter((g) => boardFor(g) && (!gameId || g.game_id === gameId));
  const showResult = rows.some((x) => has(x.r.actual));
  const cols = shownColumns(COLUMNS, savesView.adv);
  // +1: the empty last column that takes the spare width, so the others stay narrow.
  const columns = cols.length + (showResult ? 1 : 0) + 1;
  if (!rows.length && !nameSearching()) {
    const waiting = savesView.starter === "agree" && sortedRows(date, "all").length;
    el("shots-content").innerHTML = !shown.length
      ? `<p class="no-data-note">No projections for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.</p>`
      : waiting
        ? `<p class="no-data-note shots-waiting">The NHL's lineup and Novig's lines don't agree on a starter yet for ${shown.length === 1 ? "this game" : "these games"}. Both fill in through game day. <button type="button" class="view-toggle-btn shots-filter-btn" data-filter="starter" data-value="all">Show all goalies</button></p>`
        : `<p class="no-data-note">No goalies match these filters.</p>`;
    return;
  }
  const head = cols.map((c) => {
    const active = c.key && c.key === savesView.sort;
    return `<th${c.key ? ` class="shots-sort${active ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}" data-sort="${c.key}"` : c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${c.search ? nameSearchBox() : ""}${active ? `<span class="shots-arrow">${savesView.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const heading = (text, cls, i) => `${i > 0 ? `<tr class="group-gap"><td colspan="${columns}"></td></tr>` : ""}<tr class="group-row ${cls}"><td colspan="${columns}">${text}</td></tr>`;
  const body = rows
    .map((x, i) => {
      const r = x.r;
      const open = savesView.open === `${x.game.game_id}:${r.id}`;
      const prev = rows[i - 1];
      let divider = "";
      if (x.state !== "open" && i > 0 && prev.state !== x.state && rows[0].state !== x.state) {
        divider = heading(x.state === "live" ? "Live now: these games have started. The price and chance are the last ones from before puck drop." : "Final: locked before puck drop and graded.", "shots-state-head", i);
      } else if (rankedByEdge() && (!prev || prev.state !== x.state || rankGroup(prev) !== rankGroup(x))) {
        const n = (size) => Math.round(edgeAt(size) * 100);
        const text = [
          `Check first. The biggest gaps to the market (${n("check")}+ points), or the model ${checkSaves()}+ saves from what the line says. Look for news on the starter before you bet.`,
          `Plays: Novig prices them; best edge first.`,
          `No odds yet: the model's projection only. Shop it elsewhere, or wait for Novig to post.`,
        ][rankGroup(x)];
        if (i > 0 || rankGroup(x) !== 1) divider = heading(text, ["shots-check-head", "shots-plays-head", "goals-noodds-head"][rankGroup(x)], i);
      }
      const row = `${divider}<tr class="shots-row${open ? " shots-open" : ""}${x.state === "live" ? " shots-live" : ""}" data-state="${x.state}" data-row="${x.game.game_id}:${r.id}">
        ${cols.map((c) => c.cell(x, i)).join("")}
        ${showResult ? actualCell(x) : ""}<td class="shots-spacer"></td>
      </tr>`;
      return row + (open ? detailRow(x, columns) : "");
    })
    .join("");
  el("shots-content").innerHTML = `<div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table goals-table saves-table">
      <thead><tr>${head}${showResult ? `<th title="His real saves, and whether the play won">Result</th>` : ""}<th class="shots-spacer"></th></tr></thead>
      <tbody>${body || nameSearchMiss(columns)}</tbody>
    </table></div></div>`;
}

// ---- the record (the build grades it: saves_record_summary) ----
const RECORD_BUCKETS = [["edge", "Every edge", ["strong", "lean"]], ["strong", "Strong", ["strong"]], ["lean", "Lean", ["lean"]], ["check", "Check first", ["check"]]];
function renderRecord() {
  const record = SAVES.record;
  const box = el("shots-results");
  if (!record || !record.games) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first games that finish after this page went live: every starter with a saves line graded at the line and price locked before puck drop, and how far that price moved from the first one the page saw. A goalie who doesn't start is left out (books void the bet).</p>`;
    return;
  }
  const n = (size) => Math.round(edgeAt(size) * 100);
  const tile = (label, t, tip) => {
    const played = t.wins + t.losses;
    return `<div class="nba-tile" title="${tip}"><div class="gs-tile-label">${label}</div><b>${t.wins}-${t.losses}</b><small>${played ? `${Math.round((100 * t.wins) / played)}% &middot; ${signed(t.units)}u` : "none yet"}</small></div>`;
  };
  const clv = record.clv || {};
  const clvTile = `<div class="nba-tile" title="Closing line value on the plays with an edge: how far the price moved from the first one the page saw to the one locked at puck drop, in points of chance (+ = the price shortened, the market moved toward the model)."><div class="gs-tile-label">Closing line value</div><b>${has(clv.points) ? points(clv.points) : "--"}</b><small>${clv.plays ? `${clv.shortened} shortened &middot; ${clv.drifted} drifted &middot; ${clv.plays} plays` : "none yet"}</small></div>`;
  const honest = (record.honest || []).filter((b) => b.goalies).map((b) => `<tr><td>${Math.round(b.lo * 100)}-${Math.round(Math.min(b.hi, 1) * 100)}%</td><td class="num">${b.goalies}</td><td class="num">${pct(b.said / b.goalies, 0)}</td><td class="num"><b>${pct(b.got / b.goalies, 0)}</b></td></tr>`).join("");
  box.innerHTML = `<div class="shots-detail-label">The record so far <span class="muted-label">${shortDate(record.since)} to ${shortDate(record.through)}, ${record.games} games, ${record.goalies} starters graded; the better side of each saves line at the price locked before puck drop; u = units won risking 1 a play</span></div>
    <div class="nba-tiles shots-record">
      ${tile(`Edge ${n("strong")} to ${n("check")}`, record.strong, "Plays the model liked most")}
      ${tile(`Edge ${n("lean")} to ${n("strong")}`, record.lean, "Leans")}
      ${tile(`Under ${n("lean")}: no edge`, record.none, "Every other priced line: about what blind betting does")}
      ${tile(`${n("check")}+: check first`, record.check, `Gaps too big to take at face value, and a model ${checkSaves()}+ saves from the line`)}
      ${tile("Overs", record.over, "Called plays (lean + strong) on the over")}
      ${tile("Unders", record.under, "Called plays (lean + strong) on the under")}
      ${tile("Against his avg", record.fade, "Called plays that went against his season saves a start")}
      ${clvTile}
    </div>
    <div class="shots-detail-label">Said vs went over <span class="muted-label">every graded starter: the model's chance of the over against how often he went over</span></div>
    ${honest ? `<table class="data-table shots-ladder goals-honest"><thead><tr><th>Model said</th><th>Goalies</th><th>Said</th><th>Went over</th></tr></thead><tbody>${honest}</tbody></table>` : ""}
    ${recordPlays(record)}`;
}
function recordPlays(record) {
  const all = record.plays || [];
  if (!all.length) return "";
  const bucket = RECORD_BUCKETS.find(([key]) => key === savesView.record) || RECORD_BUCKETS[0];
  const shown = all.filter((play) => bucket[2].includes(play.size));
  const sum = (plays) => plays.reduce((t, play) => ({ wins: t.wins + (play.won ? 1 : 0), losses: t.losses + (play.won ? 0 : 1), units: t.units + play.units }), { wins: 0, losses: 0, units: 0 });
  const line = (t) => `${t.wins}-${t.losses} &middot; ${signed(t.units, 2)}u`;
  const buttons = RECORD_BUCKETS.map(([key, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${bucket[0] === key ? " active" : ""}" data-filter="record" data-value="${key}">${label}</button>`).join("");
  const sizeTag = { strong: "Strong", lean: "Lean", check: "Check" };
  let body = "";
  let day = null;
  shown.forEach((play) => {
    if (play.date !== day) {
      day = play.date;
      body += `<tr class="shots-record-day"><td colspan="7">${new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} <span class="muted-label">${line(sum(shown.filter((x) => x.date === day)))}</span></td></tr>`;
    }
    body += `<tr>
        <td class="nba-player shots-player">${playerClick(play.id, `<b>${play.name}</b>`)}<span class="shots-vs">${logo(play.team, 16)}<span class="at">${play.home ? "vs" : "@"}</span>${logo(play.opp, 16)}</span></td>
        <td class="shots-play-cell">${playChip({ side: play.side, line: play.line, price: play.price })}${play.fade ? ` <span class="shots-fade" title="Against his own season average at the time">vs his avg</span>` : ""}</td>
        <td class="num"><span class="shots-record-size shots-record-${play.size}">${sizeTag[play.size] || ""}</span></td>
        <td class="num">${points(play.edge)}</td>
        <td class="num"><b>${play.actual}</b></td>
        <td class="num"><span class="pick-result pick-result-${play.won ? "win" : "loss"}">${play.won ? "W" : "L"}</span></td>
        <td class="num ${play.won ? "tier-good" : "tier-bad"}">${signed(play.units, 2)}</td>
      </tr>`;
  });
  return `<div class="shots-detail-label shots-record-head">Graded plays <span class="muted-label">every priced line with an edge, at the price locked before puck drop</span></div>
    <div class="view-toggle shots-toolbar shots-record-buckets">${buttons}<span class="shots-record-total">${shown.length ? line(sum(shown)) : "none yet"}</span></div>
    ${shown.length ? `<div class="shots-record-scroll"><table class="data-table shots-record-table">
      <thead><tr><th class="shots-th-player">Goalie</th><th>Play</th><th>Bucket</th><th>Edge</th><th title="His real saves">Saves</th><th>Result</th><th title="Units won risking 1">Units</th></tr></thead>
      <tbody>${body}</tbody></table></div>` : `<p class="shots-record-note">No graded plays in this bucket yet.</p>`}`;
}

function renderNote() {
  const date = days()[dayIndex];
  const boards = gamesOn(date).map(boardFor).filter(Boolean);
  const locked = gamesOn(date).filter((g) => boardFor(g) && gameState(g) !== "open").length;
  const g = currentGame();
  el("shots-title").innerHTML = `Saves${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((g) => boardFor(g) && !boardFor(g).locked);
  const goalies = open.flatMap((g) => boardFor(g).goalies);
  el("shots-lineups").hidden = !open.length;
  el("shots-lineups").textContent = !open.length
    ? ""
    : `The NHL's lineup and Novig's line agree on ${goalies.filter(agrees).length} of ${goalies.length} starters; Novig has saves lines up for ${goalies.filter((r) => has(r.line)).length}. Both fill in through the day as the page refreshes.`;
  el("shots-locked").hidden = !locked;
  el("shots-locked").textContent = locked ? `${locked === boards.length ? "These games have" : `${locked} of these games have`} started: their chances and prices are the last ones from before puck drop.` : "";
}
function render() {
  if (!DATA) return;
  renderSchedule();
  renderToolbar();
  renderNote();
  renderRecord();
  renderTable();
  const g = currentGame();
  if (g) [g.away, g.home].forEach(loadTeamPlayers);
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  gameId = null;
  savesView.open = null;
  render();
}
function showRecord(open) {
  el("shots-record-modal").hidden = !open;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") showRecord(false);
});
document.addEventListener("change", (e) => {
  const menu = e.target.closest(".shots-filter-select");
  if (!menu) return;
  savesView[menu.dataset.filter] = menu.value;
  savesView.open = null;
  render();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#shots-record-open")) return showRecord(true);
  if (e.target.id === "shots-record-modal" || e.target.closest("#shots-record-modal .modal-close")) return showRecord(false);
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    savesView.open = null;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const filter = e.target.closest(".shots-filter-btn");
  if (filter) {
    const value = filter.dataset.value;
    savesView[filter.dataset.filter] = value === "true" ? true : value === "false" ? false : value;
    if (filter.dataset.filter === "adv") nhlAdvancedStats(savesView.adv);
    else if (filter.dataset.filter !== "record") savesView.open = null;
    return render();
  }
  const sort = e.target.closest(".shots-sort");
  if (sort) {
    if (savesView.sort === sort.dataset.sort) savesView.dir = -savesView.dir;
    else Object.assign(savesView, { sort: sort.dataset.sort, dir: -1 });
    return renderTable();
  }
  const row = e.target.closest(".shots-row");
  if (row && !e.target.closest(".player-click")) {
    savesView.open = savesView.open === row.dataset.row ? null : row.dataset.row;
    renderTable();
  }
});

fetch("saves.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((saves) => Promise.all([loadNhlData(), saves]))
  .then(([, saves]) => {
    SAVES = saves || { games: {} };
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    const withBoard = (d) => gamesOn(d).some((g) => boardFor(g));
    const day = all.find((d) => d >= today && withBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    const link = linkedRow();
    if (link) {
      dayIndex = Math.max(0, all.indexOf(link.game.date));
      gameId = link.game.game_id;
      savesView.open = link.row;
    }
    el("empty-state").hidden = true;
    el("shots-app").hidden = false;
    render();
    if (link) scrollToRow(link.row);
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
