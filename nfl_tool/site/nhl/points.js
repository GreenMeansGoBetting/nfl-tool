// ---- GMG NHL Suite: Points (1+ point: a goal or an assist) ----
// Every skater in the day's games, priced or not, ranked by value: the
// model's chance (nfl_tool/nhl/points_model.py, written to points.json by the
// build) against the better side of Novig's points line. The owner,
// 2026-10-16: "set up the same as we have SOG and Goals". This season's
// numbers only, like every NHL prop tool.
// No points math lives here: the build sends each player's chances, fair
// price, the play (side, price, edge) and its bucket (`size`, the one the
// record is graded by); the page draws them. The defense tiles come from
// goals.json (expected goals allowed), tonight's lines from shots.json.

let POINTS = null;
let GOALS = null; // goals.json: each defense's expected goals allowed
let SHOTS = null; // shots.json: tonight's posted lineups
let dayIndex = 0;
let gameId = null;
// adv: the "advanced stats" columns shown or folded away (shared with the Shots and Goals pages, per device).
const pointsView = { pos: "all", lineup: "all", minEdge: "all", odds: "all", sort: "edge", dir: -1, open: null, record: "play", when: "all", adv: nhlAdvancedStats() };

const edgeAt = (size) => ((POINTS || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
// The Points bar (POINTS_BAR in build_nhl.py, the owner 2026-10-22): a play is shown or left out,
// like Shots. A play = the 0.5 line, an edge of the bar (6 points) or more, never against tonight's
// line change. The build files it (points_play, `size` "play"), and the record grades the same.
const bar = () => (POINTS && has(POINTS.bar) ? POINTS.bar : 0.06);
const isPlay = (x) => x.r.size === "play";
// Over the bar but left out, and why: the 1.5 line, or against tonight's line change.
const againstMove = (r) => r.move === (r.side === "under" ? "up" : "down");
function leftOut(r) {
  if (r.size !== "none" || !has(r.edge) || r.edge < bar()) return null;
  if (r.line !== 0.5) return ["1.5 Line", "Left out: only the 0.5 line is a play. On the first six nights the model's 1.5 lines went 8-20; its chance of 2+ points has not been tuned on results."];
  if (againstMove(r)) return ["New Line", `Left out: ${r.name} is on a ${r.move === "up" ? "higher" : "lower"} line tonight than his minutes this season say he has been on, and this play goes the other way. Those went 42-57 on the first six nights.`];
  return null;
}
const LIFT_CALL = 0.025;
const MINUTES_TREND = 1.0;
const breakEven = (price) => (has(price) ? (price < 0 ? -price / (100 - price) : 100 / (price + 100)) : null);
const fairPrice = (p) => (!has(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
function points(edge) {
  if (!has(edge)) return "--";
  const text = (edge * 100).toFixed(1);
  return Number(text) === 0 ? "0.0" : `${edge > 0 ? "+" : ""}${text}`;
}
const liftText = (lift) => `${lift >= 1 ? "+" : ""}${Math.round((lift - 1) * 100)}%`;
const liftTier = (lift) => (lift - 1 >= LIFT_CALL ? "tier-good" : lift - 1 <= -LIFT_CALL ? "tier-bad" : "");
const positionGroup = (pos) => (pos === "D" ? "D" : "F");
const teamsInLeague = () => Object.keys((GOALS || {}).defense || {}).length || 32;
const rankWord = (rank) => rankWords(rank, teamsInLeague());
// Home ice and rest, on the assists half.
const siteLift = (r) => r.lift.home * r.lift.b2b * r.lift.opp_b2b;
// The play's own chance: the over at his line, or the under.
const playChance = (r) => (r.side === "over" ? r.chance_over : r.side === "under" ? 1 - r.chance_over : null);

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
const boardFor = (g) => ((POINTS || {}).games || {})[g.game_id] || null;
function seasonLine(id) {
  const found = findPlayer(id);
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
  if (!has(r.actual) || !r.side || r.actual === r.line) return null;
  return (r.side === "over") === r.actual > r.line ? "win" : "loss";
}
// The member's own books first (memberPrice); the bucket stays the build's.
function mineFirst(row, g) {
  const mine = row.side && memberPrice({ r: row, game: g }, "points", row.side, row.line, row.price, buildBook({ r: row, game: g }, "points", row.side));
  return mine ? { ...row, price: mine.price, edge: playChance(row) - breakEven(mine.price) } : row;
}
function rowsFor(date) {
  const rows = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const board = boardFor(g);
    if (!board) return;
    board.players.map((row) => mineFirst(row, g)).forEach((r) => rows.push({ r, game: g, board, season: seasonLine(r.id), result: gradePlay(r), state: gameState(g) }));
  });
  return rows;
}
const SORTS = {
  edge: (x) => x.r.edge,
  chance: (x) => x.r.chance,
  points: (x) => x.r.points,
  gmean: (x) => x.r.g_mean,
  amean: (x) => x.r.a_mean,
  minutes: (x) => x.r.minutes,
  opp: (x) => x.r.lift.opp,
  goalie: (x) => x.r.lift.goalie,
  mates: (x) => x.r.mates,
  site: (x) => siteLift(x.r),
  line: (x) => (x.r.slot ? x.r.lift.line : null),
};
const rankedByEdge = () => pointsView.sort === "edge" && pointsView.dir < 0;
// Ranked by edge: the plays, then every other priced line, then Model Unsure, then everyone with
// no odds by his chance of a point.
const rankGroup = (x) => (isPlay(x) ? 0 : x.r.size === "unsure" ? 2 : has(x.r.edge) ? 1 : 3);
function sortedRows(date, lineup = pointsView.lineup) {
  const get = SORTS[pointsView.sort] || SORTS.edge;
  return rowsFor(date)
    .filter((x) => !x.r.out)
    .filter((x) => nameMatches(x.r.name))
    .filter((x) => pointsView.pos === "all" || positionGroup(x.r.pos) === pointsView.pos)
    .filter((x) => lineup === "all" || x.r.slot)
    .filter((x) => edgeAtLeast(x.r.edge, pointsView.minEdge))
    .filter((x) => pointsView.odds === "all" || has(x.r.line))
    .filter((x) => !dayIsMixed(date) || pointsView.when === "all" || (pointsView.when === "open") === (x.state === "open"))
    .sort((a, b) => {
      if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (rankedByEdge() && rankGroup(a) !== rankGroup(b)) return rankGroup(a) - rankGroup(b);
      const [va, vb] = [get(a), get(b)];
      if (!has(va) || !has(vb)) return has(va) ? -1 : has(vb) ? 1 : b.r.chance - a.r.chance;
      return (va - vb) * pointsView.dir || b.r.chance - a.r.chance;
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
  const group = (key, options) =>
    `<span class="shots-filter">${options.map(([value, label, tip]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(pointsView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}"${tip ? ` title="${tip}"` : ""}>${label}</button>`).join("")}</span>`;
  const menu = (key, label, options, tip) =>
    `<label class="shots-menu"${tip ? ` title="${tip}"` : ""}><span>${label}</span><select class="shots-filter-select" data-filter="${key}">${options.map(([value, text]) => `<option value="${value}"${String(pointsView[key]) === String(value) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  el("shots-toolbar").innerHTML =
    menu("pos", "Skaters", [["all", "All skaters"], ["F", "Forwards"], ["D", "Defense"]]) +
    menu("lineup", "Lineups", [["all", "All players"], ["confirmed", "Lineup Confirmed"]], "All players: every game, including those still waiting on the NHL's projected lineup. Lineup Confirmed: only games whose lineup is in, each player on tonight's line or pair") +
    menu("minEdge", "Edge", edgeOptions(), "Only plays with at least this much edge (the model's chance minus the chance the price needs, in points)") +
    menu("odds", "Odds", [["all", "Priced or not"], ["priced", "Priced only"]], "Priced or not: every player, the ones Novig hasn't priced with the model's fair price only") +
    advancedToggle(pointsView.adv) +
    (dayIsMixed(days()[dayIndex])
      ? group("when", [
          ["all", "All games", "Every player of the day: games still to come first, started games grayed underneath"],
          ["open", "Not started", "Only games that haven't started"],
          ["started", "Live / final", "Only games that have started: locked at the last price before puck drop"],
        ])
      : "");
}
// The play as a bettor writes it: "o0.5" / "u0.5" (the Shots page's chip), green over, red under.
function playChip(r) {
  if (!r.side) {
    return has(r.line)
      ? `<span class="goals-noodds" title="Novig has a points line for him but no price on either side yet">No price</span>`
      : `<span class="goals-noodds" title="Novig has no points line for him yet. The fair price is there to shop elsewhere; prices fill in through the day.">No odds</span>`;
  }
  return `<span class="shots-play shots-play-ou shots-play-${r.side}" title="${r.side === "over" ? "Over" : "Under"} ${fmt(r.line)} points at the best price across your books"><b>${r.side[0]}${fmt(r.line)}</b><span>${odds(r.price)}</span></span>`;
}
// The build's bucket (the one the record grades), said on the row: Play, or why a row over the bar is left out.
function ratingCell(x) {
  const r = x.r;
  const out = leftOut(r);
  const fade = r.fade && isPlay(x) ? `<span class="shots-flag shots-fade" title="This goes against his season average (${fmt(r.avg, 2)} points a game in ${r.games} games): the model thinks a small sample has run ${r.side === "under" ? "hot" : "cold"}.">vs his avg</span>` : "";
  const tag = isPlay(x)
    ? ratingTag("play", "Play", `An edge of ${Math.round(bar() * 100)}+ points on the 0.5 line, not against tonight's line change`)
    : r.size === "unsure" ? unsureTag(POINTS)
    : out ? ratingTag("out", out[0], out[1])
    : "";
  return `<td class="shots-rating">${tag || `<span class="muted-label">--</span>`}${fade}</td>`;
}
function edgeCell(x) {
  const r = x.r;
  if (!has(r.edge)) return `<td class="num muted-label shots-edge" title="No price to compare with">--</td>`;
  // A play is green (the build's bucket, never the rounded edge); nothing else is colored.
  const cls = isPlay(x) ? "tier-good" : "";
  const alpha = cls ? ` style="--tier-a:${Math.min(0.34, 0.14 + (r.edge - bar()) * 3).toFixed(2)}"` : "";
  const flag = r.thin ? `<span class="shots-flag" title="Barely traded on Novig: treat the price with care">thin</span>` : "";
  return `<td class="num shots-edge ${cls}"${alpha} title="The model's ${Math.round(playChance(r) * 100)}% minus the ${Math.round(breakEven(r.price) * 100)}% this price needs to break even">${points(r.edge)}${flag}</td>`;
}
// The fair price of the play shown (1+ point when he has no price).
function fairCell(x) {
  const r = x.r;
  const chance = r.side ? playChance(r) : r.chance;
  const what = r.side ? `${r.side === "over" ? "over" : "under"} ${fmt(r.line)}` : "1 or more points";
  return `<td class="num" title="The model's chance of ${what}: ${pct(chance, 0)}">${odds(fairPrice(chance)) || "--"}</td>`;
}
function minutesCell(x) {
  const s = x.season;
  const trend = s && has(s.toi) ? x.r.minutes - s.toi : 0;
  const tip = `${fmt(x.r.ev_min)} at even strength, ${fmt(x.r.pp_min)} on the power play${s ? `. Season ${fmt(s.toi)} min a game, last five ${fmt(s.l5_toi)}` : ""}`;
  const arrow = trend >= MINUTES_TREND ? `<small class="shots-up">&#9650;</small>` : trend <= -MINUTES_TREND ? `<small class="shots-down">&#9660;</small>` : "";
  return `<td class="num" title="${tip}">${fmt(x.r.minutes)}${arrow}</td>`;
}
const slotName = (slot) => (slot ? `${slot[0] === "F" ? "L" : "D"}${slot.slice(1)}` : "");
const slotWords = (slot) => (slot ? `${["first", "second", "third", "fourth", "fifth"][Number(slot.slice(1)) - 1] || ""} ${slot[0] === "F" ? "line" : "pair"}` : "");
function lineTip(r) {
  if (!r.slot) return "The NHL hasn't posted a projected lineup for this game yet: his recent ice time stands in.";
  const base = `On the ${slotWords(r.slot)} in the NHL's projected lineup for tonight.`;
  return r.move ? `${base} His minutes this season are a ${slotWords(r.usual_slot)} player's: ${liftText(r.lift.line)} for the move.` : `${base} That is where his minutes say he has been playing.`;
}
function lineCell(r) {
  if (!r.slot) return `<td class="num muted-label" title="${lineTip(r)}">--</td>`;
  const arrow = r.move === "up" ? `<small class="shots-up">&#9650;</small>` : r.move === "down" ? `<small class="shots-down">&#9660;</small>` : "";
  return `<td class="num shots-line ${liftTier(r.lift.line)}" title="${lineTip(r)}">${slotName(r.slot)}${arrow}</td>`;
}
function liftCell(lift, tip) {
  return `<td class="num shots-lift ${liftTier(lift)}" title="${tip}">${liftText(lift)}</td>`;
}
// Tonight's linemates against his usual ones: tracked, never in the number (blue, like Zone Match).
const matesTip = (r) => `His linemates tonight score ${liftText(r.mates)} the points a minute of the ones he has played with this season. Tracked in the record; not in the number.`;
function matesCell(r) {
  if (!has(r.mates)) return `<td class="num muted-label" title="Shown once the NHL posts tonight's lineup">--</td>`;
  return `<td class="num"><span class="goals-zone points-mates" title="${matesTip(r)}">${liftText(r.mates)}</span></td>`;
}
function goalieName(id) {
  for (const list of Object.values(DATA.goalies || {})) for (const g of list) if (String(g.id) === String(id)) return g.name;
  return "His goalie";
}
function siteTip(r) {
  const parts = [r.home ? "Home ice" : "On the road"];
  if (r.lift.b2b !== 1) parts.push(`${r.team} played yesterday`);
  if (r.lift.opp_b2b !== 1) parts.push(`${r.opp} played yesterday`);
  return parts.join(". ");
}
const oppTip = (r) => {
  const d = (((GOALS || {}).defense || {})[r.opp] || {}).xg;
  return d ? `${r.opp} allows ${fmt(d.season, 2)} expected goals a game this season (${rankWord(d.rank)}). The model counts it as ${liftText(r.lift.opp)} on his assists.` : "";
};
const goalieTip = (r) => `${goalieName(r.goalie)}, the expected starter (a projection, never confirmed): goals he has allowed against what the shots on him should have scored, pulled toward an average goalie.`;
function actualCell(x) {
  if (!has(x.r.actual)) return `<td class="num muted-label">--</td>`;
  const pill = x.result ? `<span class="pick-result pick-result-${x.result}">${x.result === "win" ? "W" : "L"}</span> ` : "";
  return `<td class="num">${pill}<b>${x.r.actual}</b></td>`;
}

// The open row: how the chance is built, what the other defense allows, the
// prices at the model's fair price, and tonight's linemates (a first look at stacks).
function detailRow(x, columns) {
  const r = x.r;
  const usual = r.a_mean / Object.values(r.lift).reduce((a, b) => a * b, 1);
  const step = (label, lift, tip) => `<span class="shots-step ${liftTier(lift)}" title="${tip || ""}"><small>${label}</small><b>${liftText(lift)}</b></span>`;
  const build = `<div class="shots-build">
      <span class="shots-step shots-step-end" title="Goals, assists and points this season"><small>Season &middot; ${r.games} gp</small><b>${r.goals} G &middot; ${r.assists} A &middot; ${r.points} P</b></span>
      <span class="shots-step shots-step-end" title="The Goals page's expected goals for him tonight"><small>Goals tonight</small><b>${fmt(r.g_mean, 2)}</b></span>
      <span class="shots-step shots-step-end" title="The expected goals his teammates make while he is on the ice, times his share of their goals, times his minutes, before tonight's matchup"><small>Model's usual assists</small><b>${fmt(usual, 2)}</b></span>
      ${r.slot ? step(`${slotName(r.slot)} tonight`, r.lift.line, lineTip(r)) : ""}
      ${step(`${r.opp} defense`, r.lift.opp, oppTip(r))}
      ${step(goalieName(r.goalie), r.lift.goalie, goalieTip(r))}
      ${step("Scale", r.lift.spread, "The replay's assists numbers were a touch bunched: big ones run a little bigger, small ones a little smaller")}
      ${step("Home / rest", siteLift(r), siteTip(r))}
      <span class="shots-step shots-step-end" title="Expected goals + expected assists"><small>Tonight</small><b>${fmt(r.g_mean, 2)} G + ${fmt(r.a_mean, 2)} A &middot; ${pct(r.chance, 0)}</b></span>
    </div>`;
  const posted = (((SHOTS || {}).lineups || {})[x.game.game_id] || {})[r.team];
  const lineNote = posted
    ? `<p class="shots-lineup">${posted.injured.length ? `Injured: ${posted.injured.join(", ")}. ` : ""}${posted.scratched.length ? `Scratched: ${posted.scratched.join(", ")}.` : ""}</p>`
    : `<p class="shots-lineup">The NHL hasn't posted ${r.team}'s projected lineup yet (usually around midday Eastern): his recent ice time stands in.</p>`;

  const d = ((GOALS || {}).defense || {})[r.opp] || {};
  const tag = (f) => (f - 1 >= LIFT_CALL ? `<span class="gs-tag gs-tag-mismatch">Leaky</span>` : f - 1 <= -LIFT_CALL ? `<span class="gs-tag gs-tag-tough">Stingy</span>` : `<span class="nba-notag">Average</span>`);
  const tiles = `<div class="nba-tiles shots-allows">
      ${d.xg ? `<div class="nba-tile" title="The model counts it as ${liftText(r.lift.opp)} on his assists"><div class="gs-tile-label">Expected goals allowed</div><b>${fmt(d.xg.season, 2)}</b><small>${rankWord(d.xg.rank)}</small>${tag(d.xg.factor)}</div>` : ""}
      <div class="nba-tile" title="${goalieTip(r)}"><div class="gs-tile-label">In net (expected)</div><b class="goals-goalie">${goalieName(r.goalie)}</b><small>${liftText(r.lift.goalie)} on his assists</small><span class="nba-notag">projection</span></div>
    </div>`;

  // The prices: 1+ point and none (the 0.5 line), 2+ (the 1.5 line), at the model's fair price.
  const first = r.first || {};
  const at = (line) => (r.line === line ? { over: r.over, under: r.under, fo: first.line === line ? first.over : null, fu: first.line === line ? first.under : null } : {});
  const half = at(0.5);
  const one5 = at(1.5);
  const priceRow = (label, chance, price, firstPrice, main) => {
    const edge = has(price) ? chance - breakEven(price) : null;
    return `<tr${main ? ' class="shots-main-line"' : ""}><td>${label}</td><td class="num">${pct(chance, 0)}</td><td class="num">${odds(fairPrice(chance)) || "--"}</td><td class="num"><b>${has(price) ? odds(price) : "--"}</b></td><td class="num">${has(firstPrice) ? odds(firstPrice) : "--"}</td><td class="num ${has(edge) && edge >= edgeAt("lean") ? "tier-good" : ""}">${points(edge)}</td></tr>`;
  };
  const ladder = `<table class="data-table shots-ladder"><thead><tr><th>Points</th><th title="The model's chance">Model</th><th title="The price with no cut at which the model's chance breaks even">Fair price</th><th>Novig</th><th title="The first price the page saw for him: the record grades how far it moved by puck drop">First seen</th><th title="The model's chance minus the chance the price needs to break even, in points">Edge</th></tr></thead><tbody>
      ${priceRow("1 or more (o0.5)", r.chance, half.over, half.fo, r.line === 0.5 && r.side === "over")}
      ${priceRow("None (u0.5)", 1 - r.chance, half.under, half.fu, r.line === 0.5 && r.side === "under")}
      ${priceRow("2 or more (o1.5)", r.two, one5.over, one5.fo, r.line === 1.5 && r.side === "over")}
      ${priceRow("1 or none (u1.5)", 1 - r.two, one5.under, one5.fu, r.line === 1.5 && r.side === "under")}</tbody></table>`;

  // Tonight's line: who he plays with and what each of them is worth tonight.
  const mates = r.slot ? x.board.players.filter((m) => m.team === r.team && m.slot === r.slot && m.id !== r.id) : [];
  const mateRow = (m) => `<tr><td class="nba-player shots-player">${playerClick(m.id, `${headshot(seasonLine(m.id) || {})}<span>${m.name}</span>`)}<span class="muted-label">${m.pos}</span></td><td class="num">${m.points}<small class="muted-label"> /${m.games}gp</small></td><td class="num">${pct(m.chance, 0)}</td><td class="shots-play-cell">${playChip(m)}</td></tr>`;
  const matesBox = r.slot
    ? `<div class="shots-detail-label">${slotWords(r.slot)[0].toUpperCase()}${slotWords(r.slot).slice(1)} tonight ${has(r.mates) ? `<span class="goals-zone points-mates" title="${matesTip(r)}">LINEMATES ${liftText(r.mates)}</span>` : ""}</div>
       ${mates.length ? `<table class="data-table shots-ladder points-mates-table"><thead><tr><th class="shots-th-player">Linemate</th><th title="Points this season">P</th><th title="The model's chance of 1 or more points tonight">1+ pt</th><th>Play</th></tr></thead><tbody>${mates.map(mateRow).join("")}</tbody></table>` : `<p class="shots-lineup">His linemates aren't on this game's list.</p>`}
       <p class="shots-lineup muted-label">Linemates is tracked in the record, not in the number: in two seasons of replays it pointed the right way, but too little to prove once his line and minutes were counted.</p>`
    : `<div class="shots-detail-label">Linemates tonight</div><p class="shots-lineup">Shown once the NHL posts ${r.team}'s projected lineup (usually around midday Eastern).</p>`;
  // Every book's price, as on the Shots and Goals pages: the model's chance of over 0.5 / 1.5 points.
  const overAt = (at) => (at === 0.5 ? r.chance : at === 1.5 ? r.two : null);
  const bookCol = bookPanelFor(x, "points", has(r.line) ? r.line : 0.5, "Points",
    (side, at) => (has(overAt(at)) ? (side === "o" ? overAt(at) : 1 - overAt(at)) : null), POINTS.edges);
  return `<tr class="shots-detail"><td colspan="${columns}">
      <div class="shots-detail-grid${bookCol ? " has-odds" : ""}">
        <div class="shots-detail-main">
          <div class="shots-detail-label">How tonight's chance is built</div>${build}${lineNote}
          <div class="shots-detail-label">${logo(r.opp, 16)} What ${r.opp} allows <span class="muted-label">this season, and where that ranks</span></div>${tiles}
          <div class="shots-detail-label">The price, at the model's fair price</div>${ladder}
        </div>
        <div class="shots-detail-rink points-mates-box">${matesBox}</div>
        ${bookCol}
      </div>
    </td></tr>`;
}

// Each column draws its own cell. `adv`: folded away until "Expand advanced stats".
const COLUMNS = [
  { key: null, label: "#", cell: (x, i) => `<td class="num shots-rank">${i + 1}</td>` },
  { key: null, label: "Player", search: true, cls: "shots-th-player", cell: (x) => `<td class="nba-player shots-player">${playerClick(x.r.id, `${headshot(x.season || {})}<span>${x.r.name}</span>`)}<span class="muted-label">${x.r.pos}</span><span class="shots-vs">${logo(x.r.team, 16)}<span class="at">${x.r.home ? "vs" : "@"}</span>${logo(x.r.opp, 16)}</span></td>` },
  { key: "line", label: "Line", title: "His line (L1 to L4) or pair (D1 to D3) in the NHL's projected lineup for tonight. An arrow = above or below the line his minutes say he has been on. -- = not posted yet.", cell: (x) => lineCell(x.r) },
  { key: null, label: "Play", title: "The better side of Novig's points line for him at its price (o0.5 = 1 or more points, u0.5 = none). No odds = not priced yet", cell: (x) => `<td class="shots-play-cell">${playChip(x.r)}${x.r.side && has(x.r.price) ? nhlPlayBox(nhlPlayEntry({ market: "pts", g: x.game, r: x.r, side: x.r.side, line: x.r.line, price: x.r.price })) : ""}</td>` },
  { key: null, label: "Rating", title: "Play: an edge of 6+ points on the 0.5 line, not against tonight's line change. A row over the bar but left out says why (1.5 Line, New Line)", cell: ratingCell },
  { key: "points", label: "P", title: "His points this season", cell: (x) => `<td class="num" title="${x.r.goals} goals, ${x.r.assists} assists in ${x.r.games} games: ${fmt(x.r.avg, 2)} points a game">${x.r.points}<small class="muted-label"> /${x.r.games}gp</small></td>` },
  { key: "chance", label: "Fair", title: "The price with no cut at which the model's chance of the play breaks even (1 or more points when he has no price)", cell: fairCell },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points. Green on a play", cell: edgeCell },
  { key: "minutes", label: "Min", adv: true, title: "Ice time the model expects tonight (even strength + power play)", cell: minutesCell },
  { key: "gmean", label: "xG", adv: true, title: "His expected goals tonight (the Goals page's number)", cell: (x) => `<td class="num">${fmt(x.r.g_mean, 2)}</td>` },
  { key: "amean", label: "xA", adv: true, title: "His expected assists tonight", cell: (x) => `<td class="num">${fmt(x.r.a_mean, 2)}</td>` },
  { key: "opp", label: "Opp", adv: true, title: "The other defense's expected goals allowed against the league, on his assists", cell: (x) => liftCell(x.r.lift.opp, oppTip(x.r)) },
  { key: "goalie", label: "Goalie", adv: true, title: "Tonight's expected goalie, on his assists", cell: (x) => liftCell(x.r.lift.goalie, goalieTip(x.r)) },
  { key: "mates", label: "Linemates", adv: true, title: "Tonight's projected linemates against the ones he has played with. Tracked in the record, not in the number", cell: (x) => matesCell(x.r) },
  { key: "site", label: "Home/rest", adv: true, title: "Home ice and back-to-backs", cell: (x) => liftCell(siteLift(x.r), siteTip(x.r)) },
];
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const shown = gamesOn(date).filter((g) => boardFor(g) && (!gameId || g.game_id === gameId));
  const showResult = rows.some((x) => has(x.r.actual));
  const cols = shownColumns(COLUMNS, pointsView.adv);
  // +1: the empty last column that takes the spare width, so the others stay narrow.
  const columns = cols.length + (showResult ? 1 : 0) + 1;
  if (!rows.length && !nameSearching()) {
    const waiting = pointsView.lineup === "confirmed" && sortedRows(date, "all").length;
    el("shots-content").innerHTML = !shown.length
      ? `<p class="no-data-note">No projections for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.</p>`
      : waiting
        ? `<p class="no-data-note shots-waiting">No lineup is in yet for ${shown.length === 1 ? "this game" : "these games"}. The NHL posts each one around midday Eastern on game day. <button type="button" class="view-toggle-btn shots-filter-btn" data-filter="lineup" data-value="all">Show all players</button></p>`
        : `<p class="no-data-note">No players match these filters.</p>`;
    return;
  }
  const head = cols.map((c) => {
    const active = c.key && c.key === pointsView.sort;
    return `<th${c.key ? ` class="shots-sort${active ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}" data-sort="${c.key}"` : c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${c.search ? nameSearchBox() : ""}${active ? `<span class="shots-arrow">${pointsView.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const heading = (text, cls, i) => `${i > 0 ? `<tr class="group-gap"><td colspan="${columns}"></td></tr>` : ""}<tr class="group-row ${cls}"><td colspan="${columns}">${text}</td></tr>`;
  const body = rows
    .map((x, i) => {
      const r = x.r;
      const open = pointsView.open === `${x.game.game_id}:${r.id}`;
      const prev = rows[i - 1];
      let divider = "";
      if (x.state !== "open" && i > 0 && prev.state !== x.state && rows[0].state !== x.state) {
        divider = heading(x.state === "live" ? "Live now: these games have started. The price and chance are the last ones from before puck drop." : "Final: locked before puck drop and graded.", "shots-state-head", i);
      } else if (rankedByEdge() && (!prev || prev.state !== x.state || rankGroup(prev) !== rankGroup(x))) {
        const text = [
          `Plays: an edge of ${Math.round(bar() * 100)}+ points on the 0.5 line; best edge first.`,
          `Not Plays: every other priced line, best edge first.`,
          unsureHead(POINTS),
          `No odds yet: the model's fair price only, best chance first. Shop it elsewhere, or wait for Novig to post.`,
        ][rankGroup(x)];
        divider = heading(text, ["shots-plays-head", "shots-plays-head", "goals-noodds-head", "goals-noodds-head"][rankGroup(x)], i);
      }
      const row = `${divider}<tr class="shots-row${open ? " shots-open" : ""}${x.state === "live" ? " shots-live" : ""}" data-state="${x.state}" data-row="${x.game.game_id}:${r.id}">
        ${cols.map((c) => c.cell(x, i)).join("")}
        ${showResult ? actualCell(x) : ""}<td class="shots-spacer"></td>
      </tr>`;
      return row + (open ? detailRow(x, columns) : "");
    })
    .join("");
  el("shots-content").innerHTML = `<div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table goals-table points-table">
      <thead><tr>${head}${showResult ? `<th title="His real points, and whether the play won">Result</th>` : ""}<th class="shots-spacer"></th></tr></thead>
      <tbody>${body || nameSearchMiss(columns)}</tbody>
    </table></div></div>`;
}

// ---- the record (the build grades it: points_record_summary) ----
const RECORD_BUCKETS = [["play", "Every Play", null], ["over", "Overs", "over"], ["under", "Unders", "under"]];
function renderRecord() {
  const record = POINTS.record;
  const box = el("shots-results");
  if (!record || !record.games) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first games that finish after this page went live: every player graded at the line and price locked before puck drop, and how far that price moved from the first one the page saw.</p>`;
    return;
  }
  const n = Math.round(bar() * 100);
  const honest = (record.honest || []).filter((b) => b.players).map((b) => `<tr><td>${Math.round(b.lo * 100)}-${Math.round(Math.min(b.hi, 1) * 100)}%</td><td class="num">${b.players}</td><td class="num">${pct(b.said / b.players, 0)}</td><td class="num"><b>${pct(b.got / b.players, 0)}</b></td></tr>`).join("");
  nhlYtd(box, {
    record,
    intro: `<div class="shots-detail-label">The record so far <span class="muted-label">${shortDate(record.since)} to ${shortDate(record.through)}, ${record.games} games, ${record.players} players graded; the better side of each points line at the price at the last refresh before puck drop, up to 30 minutes before; u = units won risking 1 a play</span></div>`,
    tracker: {
      key: "nhl-points",
      markets: [{
        key: "play", label: "Plays", ledger: record.ledger, min: n, max: Math.max(n, 20),
        tip: `An edge of ${n}+ points on the 0.5 line, not against tonight's line change. Every saved game is graded by today's rule`,
        splits: [["over", "Overs", "Plays on the over"], ["under", "Unders", "Plays on the under"], ["fade", "Against His Avg", "Plays that went against his season points a game"], ["with", "With His Avg", "Plays his season points a game agreed with"]],
      }],
    },
    season: `${ytdSeasonTile("Not Plays", record.none, "Every other priced line: under the bar, the 1.5 line, or against tonight's line change")}${clvTile(record.clv)}`,
    after: `<div class="shots-detail-label">Said vs got <span class="muted-label">every graded player, priced or not: the model's chance of 1 or more points against how often he got one</span></div>
    ${honest ? `<table class="data-table shots-ladder goals-honest"><thead><tr><th>Model said</th><th>Players</th><th>Said</th><th>Got a point</th></tr></thead><tbody>${honest}</tbody></table>` : ""}`,
    list: () => recordPlays(record),
  });
}
function recordPlays(record) {
  const all = record.plays || [];
  if (!all.length) return "";
  const bucket = RECORD_BUCKETS.find(([key]) => key === pointsView.record) || RECORD_BUCKETS[0];
  const shown = all.filter((play) => play.size === "play" && (!bucket[2] || play.side === bucket[2]) && ytdKeeps("nhl-points", "play", play.date, play.edge));
  const sum = (plays) => plays.reduce((t, play) => ({ wins: t.wins + (play.won ? 1 : 0), losses: t.losses + (play.won ? 0 : 1), units: t.units + play.units }), { wins: 0, losses: 0, units: 0 });
  const line = (t) => `${t.wins}-${t.losses} &middot; ${signed(t.units, 2)}u`;
  const buttons = RECORD_BUCKETS.map(([key, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${bucket[0] === key ? " active" : ""}" data-filter="record" data-value="${key}">${label}</button>`).join("");
  let body = "";
  let day = null;
  shown.forEach((play) => {
    if (play.date !== day) {
      day = play.date;
      body += `<tr class="shots-record-day"><td colspan="6">${new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} <span class="muted-label">${line(sum(shown.filter((x) => x.date === day)))}</span></td></tr>`;
    }
    body += `<tr>
        <td class="nba-player shots-player">${playerClick(play.id, `<b>${play.name}</b>`)}<span class="shots-vs">${logo(play.team, 16)}<span class="at">${play.home ? "vs" : "@"}</span>${logo(play.opp, 16)}</span></td>
        <td class="shots-play-cell">${playChip({ side: play.side, line: play.line, price: play.price })}${play.fade ? ` <span class="shots-fade" title="Against his own season average at the time">vs his avg</span>` : ""}</td>
        <td class="num">${points(play.edge)}</td>
        <td class="num"><b>${play.actual}</b></td>
        <td class="num"><span class="pick-result pick-result-${play.won ? "win" : "loss"}">${play.won ? "W" : "L"}</span></td>
        <td class="num ${play.won ? "tier-good" : "tier-bad"}">${signed(play.units, 2)}</td>
      </tr>`;
  });
  return `<div class="shots-detail-label shots-record-head">Graded plays <span class="muted-label">every play, at the price locked before puck drop</span></div>
    <div class="view-toggle shots-toolbar shots-record-buckets">${buttons}<span class="shots-record-total">${shown.length ? line(sum(shown)) : "none yet"}</span></div>
    ${shown.length ? `<div class="shots-record-scroll"><table class="data-table shots-record-table">
      <thead><tr><th class="shots-th-player">Player</th><th>Play</th><th>Edge</th><th title="His real points">Points</th><th>Result</th><th title="Units won risking 1">Units</th></tr></thead>
      <tbody>${body}</tbody></table></div>` : `<p class="shots-record-note">No graded plays in this bucket yet.</p>`}`;
}

function renderNote() {
  const date = days()[dayIndex];
  const boards = gamesOn(date).map(boardFor).filter(Boolean);
  const locked = gamesOn(date).filter((g) => boardFor(g) && gameState(g) !== "open").length;
  const g = currentGame();
  el("shots-title").innerHTML = `Points${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((g) => boardFor(g) && !boardFor(g).locked);
  const lined = open.filter((g) => boardFor(g).posted).length;
  const priced = open.filter((g) => boardFor(g).players.some((r) => has(r.line))).length;
  el("shots-lineups").hidden = !open.length;
  el("shots-lineups").textContent = !open.length
    ? ""
    : `Lineups are in for ${lined} of ${open.length} games; Novig has points lines up for ${priced} of ${open.length}. Both fill in through the day as the page refreshes.`;
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
  pointsView.open = null;
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
  pointsView[menu.dataset.filter] = menu.value;
  pointsView.open = null;
  render();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#shots-record-open")) return showRecord(true);
  if (e.target.id === "shots-record-modal" || e.target.closest("#shots-record-modal .modal-close")) return showRecord(false);
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    pointsView.open = null;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const filter = e.target.closest(".shots-filter-btn");
  if (filter) {
    const value = filter.dataset.value;
    pointsView[filter.dataset.filter] = value === "true" ? true : value === "false" ? false : value;
    if (filter.dataset.filter === "adv") nhlAdvancedStats(pointsView.adv);
    else if (filter.dataset.filter !== "record") pointsView.open = null;
    return render();
  }
  const sort = e.target.closest(".shots-sort");
  if (sort) {
    if (pointsView.sort === sort.dataset.sort) pointsView.dir = -pointsView.dir;
    else Object.assign(pointsView, { sort: sort.dataset.sort, dir: -1 });
    return renderTable();
  }
  const row = e.target.closest(".shots-row");
  if (row && !e.target.closest(".player-click")) {
    pointsView.open = pointsView.open === row.dataset.row ? null : row.dataset.row;
    renderTable();
  }
});

const getJson = (url) =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
Promise.all([loadNhlData(), getJson("points.json"), getJson("goals.json"), getJson("shots.json")])
  .then(([, pts, goals, shots]) => {
    POINTS = pts || { games: {} };
    GOALS = goals || { defense: {} };
    SHOTS = shots || { lineups: {} };
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    const withBoard = (d) => gamesOn(d).some((g) => boardFor(g));
    const day = all.find((d) => d >= today && withBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    // Opened from Best Plays: that player's game, his row open.
    const link = linkedRow();
    if (link) {
      dayIndex = Math.max(0, all.indexOf(link.game.date));
      gameId = link.game.game_id;
      pointsView.open = link.row;
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
