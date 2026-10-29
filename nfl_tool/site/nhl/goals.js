// ---- GMG NHL Suite: Goals (anytime goal scorer) ----
// Every skater in the day's games, priced or not, ranked by value: the
// model's chance to score (nfl_tool/nhl/goals_model.py, written to
// goals.json by the build) next to Novig's anytime price. The owner,
// 2026-10-14: "displayed similarly to shots for ease of use", and Novig
// doesn't have liquidity on every player, so a player with no price is still
// listed with the model's fair price (under the plays). This season's numbers
// only, like every NHL prop tool.
// No goal math lives here: the build sends each player's chance, fair price,
// edge and bucket (`size`, the same one the record is graded by); the page
// draws them. The rink's defense boxes come from shots.json (the Shots page's
// defense numbers: shots a game allowed from each area).

let GOALS = null;
let SHOTS = null; // shots.json: each defense's shots allowed by area, and tonight's posted lineups
let dayIndex = 0;
let gameId = null;
// adv: the "advanced stats" columns shown or folded away (shared with the Shots page, per device).
const goalsView = { pos: "all", lineup: "all", minEdge: "all", odds: "all", zone: "all", sort: "edge", dir: -1, open: null, record: "edge", when: "all", checks: true, adv: nhlAdvancedStats() };

const edgeAt = (size) => ((GOALS || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
// Set apart, the Shots page's way: a gap of 12+ points, or a player moved down a line tonight
// (the build's goals_play files both as "check").
const needsCheck = (x) => x.r.size === "check";
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
const ZONE_WORD = { low_slot: "low slot", slot: "slot" };
// Home ice and rest; the net-front trim and the off wing ("Style").
const siteLift = (r) => r.lift.home * r.lift.b2b * r.lift.opp_b2b;
const styleLift = (r) => r.lift.low * r.lift.onetimer;
// 2 or more goals when `mean` are expected (the model's count is a plain one).
const twoPlus = (mean) => 1 - Math.exp(-mean) * (1 + mean);

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
const boardFor = (g) => ((GOALS || {}).games || {})[g.game_id] || null;
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
function rowsFor(date) {
  const rows = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const board = boardFor(g);
    if (!board) return;
    board.players.forEach((row) => {
      // The member's own books first (memberPrice); the bucket stays the build's.
      const mine = memberPrice({ r: row, game: g }, "goals", "over", 0.5, row.odds, buildBook({ r: row, game: g }, "goal"));
      const r = mine ? { ...row, odds: mine.price, edge: row.chance - breakEven(mine.price) } : row;
      const result = has(r.actual) && has(r.odds) ? (r.actual > 0 ? "win" : "loss") : null;
      rows.push({ r, game: g, board, season: seasonLine(r.id), result, state: gameState(g) });
    });
  });
  return rows;
}
const SORTS = {
  edge: (x) => x.r.edge,
  chance: (x) => x.r.chance,
  proj: (x) => x.r.mean,
  goals: (x) => x.r.goals,
  xg: (x) => x.r.xg,
  minutes: (x) => x.r.minutes,
  opp: (x) => x.r.lift.opp,
  goalie: (x) => x.r.lift.goalie,
  finish: (x) => x.r.lift.finish,
  split: (x) => x.r.lift.split,
  style: (x) => styleLift(x.r),
  site: (x) => siteLift(x.r),
  line: (x) => (x.r.slot ? x.r.lift.line : null),
};
const rankedByEdge = () => goalsView.sort === "edge" && goalsView.dir < 0;
// Ranked by edge: "check first" on top (as on the Shots page), then the plays, then Model Unsure, then
// everyone with no odds by his chance to score.
const rankGroup = (x) => (needsCheck(x) ? 0 : x.r.size === "unsure" ? 2 : has(x.r.edge) ? 1 : 3);
function sortedRows(date, lineup = goalsView.lineup, checks = goalsView.checks) {
  const get = SORTS[goalsView.sort] || SORTS.edge;
  return rowsFor(date)
    .filter((x) => !x.r.out)
    .filter((x) => nameMatches(x.r.name))
    .filter((x) => goalsView.pos === "all" || positionGroup(x.r.pos) === goalsView.pos)
    .filter((x) => lineup === "all" || x.r.slot)
    .filter((x) => edgeAtLeast(x.r.edge, goalsView.minEdge))
    .filter((x) => goalsView.odds === "all" || has(x.r.odds))
    .filter((x) => goalsView.zone === "all" || x.r.zone)
    .filter((x) => checks || !needsCheck(x))
    .filter((x) => !dayIsMixed(date) || goalsView.when === "all" || (goalsView.when === "open") === (x.state === "open"))
    .sort((a, b) => {
      if (a.state !== b.state) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (rankedByEdge() && rankGroup(a) !== rankGroup(b)) return rankGroup(a) - rankGroup(b);
      const [va, vb] = [get(a), get(b)];
      if (!has(va) || !has(vb)) return has(va) ? -1 : has(vb) ? 1 : b.r.chance - a.r.chance;
      return (va - vb) * goalsView.dir || b.r.chance - a.r.chance;
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
        <span class="matchup-date">${final ? "Final" : fmtTime(g, false)}</span>
        ${lineup}
      </button>`;
    })
    .join("");
}
function renderToolbar() {
  const group = (key, options) =>
    `<span class="shots-filter">${options.map(([value, label, tip]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(goalsView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}"${tip ? ` title="${tip}"` : ""}>${label}</button>`).join("")}</span>`;
  const menu = (key, label, options, tip) =>
    `<label class="shots-menu"${tip ? ` title="${tip}"` : ""}><span>${label}</span><select class="shots-filter-select" data-filter="${key}">${options.map(([value, text]) => `<option value="${value}"${String(goalsView[key]) === String(value) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  const checks = sortedRows(days()[dayIndex], goalsView.lineup, true).filter(needsCheck).length;
  el("shots-toolbar").innerHTML =
    menu("pos", "Skaters", [["all", "All skaters"], ["F", "Forwards"], ["D", "Defense"]]) +
    menu("lineup", "Lineups", [["all", "All players"], ["confirmed", "Lineup Confirmed"]], "All players: every game, including those still waiting on the NHL's projected lineup. Lineup Confirmed: only games whose lineup is in, each player on tonight's line or pair") +
    menu("minEdge", "Edge", edgeOptions(), "Only plays with at least this much edge (the model's chance minus the chance the price needs, in points)") +
    menu("odds", "Odds", [["all", "Priced or not"], ["priced", "Priced only"]], "Priced or not: every player, the ones Novig hasn't priced with the model's fair price only") +
    menu("zone", "Zone Match", [["all", "Everyone"], ["only", "Zone Match only"]], "His heavy shooting area against a defense that allows a lot from it. Tracked, not in the number") +
    `<span class="shots-filter"><button type="button" class="view-toggle-btn shots-filter-btn shots-check-toggle${goalsView.checks ? " active" : ""}" data-filter="checks" data-value="${!goalsView.checks}" title="Check plays: a gap to the market of ${Math.round(edgeAt("check") * 100)}+ points, or a player moved down a line tonight. They lead the ranking; click to ${goalsView.checks ? "hide" : "show"} them.">Check plays: ${goalsView.checks ? "Shown" : `Hidden${checks ? ` (${checks})` : ""}`}</button></span>` +
    advancedToggle(goalsView.adv) +
    (dayIsMixed(days()[dayIndex])
      ? group("when", [
          ["all", "All games", "Every player of the day: games still to come first, started games grayed underneath"],
          ["open", "Not started", "Only games that haven't started"],
          ["started", "Live / final", "Only games that have started: locked at the last price before puck drop"],
        ])
      : "");
}
const zoneTip = (r) => `Zone Match: ${Math.round(r.zone.share * 100)}% of his shots come from the ${ZONE_WORD[r.zone.area]} (his position: ${Math.round(r.zone.lg_share * 100)}%), and ${r.opp} allows ${fmt(r.zone.opp_pg)} shots a game from there (${rankWord(r.zone.opp_rank)}). Shown and graded in the record; not in the number.`;
// The anytime price alone (the owner, 2026-10-15: shrink the Anytime column); the Zone Match
// tag has its own column.
function priceChip(r) {
  return has(r.odds)
    ? `<span class="shots-play shots-play-over goals-price" title="Best anytime goal price across your books"><b>${odds(r.odds)}</b></span>`
    : `<span class="goals-noodds" title="Novig has no anytime price for him yet. The fair price is there to shop elsewhere; prices fill in through the day.">No odds</span>`;
}
function zoneCell(r) {
  return `<td class="goals-zone-cell">${r.zone ? `<span class="goals-zone" title="${zoneTip(r)}">${ZONE_WORD[r.zone.area].toUpperCase()}</span>` : `<span class="muted-label">--</span>`}</td>`;
}
// The build's bucket (the one the record grades), said on the row: Strong / Lean / Check.
function ratingCell(x) {
  const tag = bucketTag(x.r, { lean: edgeAt("lean"), strong: edgeAt("strong"), check: edgeAt("check") });
  return `<td class="shots-rating">${tag || `<span class="muted-label">--</span>`}</td>`;
}
function edgeCell(x) {
  const r = x.r;
  if (!has(r.edge)) return `<td class="num muted-label shots-edge" title="No price to compare with">--</td>`;
  const lean = edgeAt("lean");
  // Colored by the build's bucket (the one the record grades), never by the rounded edge.
  const cls = needsCheck(x) ? "tier-mid" : r.size === "lean" || r.size === "strong" ? "tier-good" : "";
  const alpha = cls === "tier-good" ? ` style="--tier-a:${Math.min(0.34, 0.08 + (r.edge - lean) * 3).toFixed(2)}"` : "";
  // Check / New line are said in the Rating column.
  const flag = r.thin ? `<span class="shots-flag" title="Only one side priced on Novig: treat the price with care">thin</span>` : "";
  return `<td class="num shots-edge ${cls}"${alpha} title="The model's ${Math.round(r.chance * 100)}% minus the ${Math.round(breakEven(r.odds) * 100)}% this price needs to break even">${points(r.edge)}${flag}</td>`;
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
const plainName = (name) => (name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function liftCell(lift, tip) {
  return `<td class="num shots-lift ${liftTier(lift)}" title="${tip}">${liftText(lift)}</td>`;
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
  const d = ((GOALS.defense || {})[r.opp] || {}).xg;
  return d ? `${r.opp} allows ${fmt(d.season, 2)} expected goals a game this season (${rankWord(d.rank)}). The model counts it as ${liftText(r.lift.opp)}.` : "";
};
const PIECE_TIPS = {
  goalie: (r) => `${goalieName(r.goalie)}, the expected starter (a projection, never confirmed): goals he has allowed against what the shots on him should have scored, pulled toward an average goalie.`,
  finish: () => "His goals against his expected goals, pulled hard toward average: most of a hot or cold start is luck.",
  split: (r) => `His even-strength rate times ${fmt(r.ev_min)} even-strength minutes, plus his power-play rate times ${fmt(r.pp_min)} power-play minutes, against one blended rate.`,
  style: (r) => `Net-front trim ${liftText(r.lift.low)} (low-slot shooters ran a little under in the replay) and off-wing shots ${liftText(r.lift.onetimer)}.`,
};
function actualCell(x) {
  if (!has(x.r.actual)) return `<td class="num muted-label">--</td>`;
  const pill = x.result ? `<span class="pick-result pick-result-${x.result}">${x.result === "win" ? "W" : "L"}</span> ` : "";
  return `<td class="num">${pill}<b>${x.r.actual}</b></td>`;
}

// The open row: how the chance is built, what the other defense allows, the
// price at the model's fair price, and where he shoots against what the
// defense allows from there (the Shots page's rink).
function areaShares() {
  if (!SHOTS || !SHOTS.defense) return {};
  if (SHOTS.area_shares) return SHOTS.area_shares;
  const keys = RINK_ZONES.map((z) => z.key);
  const out = {};
  Object.entries(SHOTS.defense).forEach(([abbr, d]) => {
    const all = keys.reduce((a, k) => a + ((d[`a_${k}`] || {}).season || 0), 0);
    out[abbr] = all ? Object.fromEntries(keys.map((k) => [k, { share: ((d[`a_${k}`] || {}).season || 0) / all }])) : {};
  });
  keys.forEach((k) => {
    Object.keys(out)
      .filter((abbr) => out[abbr][k])
      .sort((a, b) => out[b][k].share - out[a][k].share)
      .forEach((abbr, i) => {
        out[abbr][k].rank = i + 1;
      });
  });
  SHOTS.area_shares = out;
  return out;
}
function detailRow(x, columns) {
  const r = x.r;
  const usual = r.mean / Object.values(r.lift).reduce((a, b) => a * b, 1);
  const step = (label, lift, tip) => `<span class="shots-step ${liftTier(lift)}" title="${tip || ""}"><small>${label}</small><b>${liftText(lift)}</b></span>`;
  const build = `<div class="shots-build">
      <span class="shots-step shots-step-end" title="Goals and expected goals this season"><small>Season &middot; ${r.games} gp</small><b>${r.goals} G &middot; ${fmt(r.xg, 1)} xG</b></span>
      <span class="shots-step shots-step-end" title="The model's expected goals a game for him (his rate with an average skater mixed in, ${fmt(r.xg60, 2)} a 60 minutes) at his minutes, before tonight's matchup"><small>Model's usual xG</small><b>${fmt(usual, 2)}</b></span>
      ${r.slot ? step(`${slotName(r.slot)} tonight`, r.lift.line, lineTip(r)) : ""}
      ${step(`${r.opp} defense`, r.lift.opp, oppTip(r))}
      ${step(goalieName(r.goalie), r.lift.goalie, PIECE_TIPS.goalie(r))}
      ${step("Finishing", r.lift.finish, PIECE_TIPS.finish())}
      ${step(`EV ${fmt(r.ev_min, 0)} / PP ${fmt(r.pp_min, 1)} min`, r.lift.split, PIECE_TIPS.split(r))}
      ${step("Net-front trim", r.lift.low, "Shooters who live in the low slot ran a little under their projection in the replay")}
      ${step("Off wing", r.lift.onetimer, "His off-wing (one-timer side) shots, worth a little more than the same shot from his own side")}
      ${step("Home / rest", siteLift(r), siteTip(r))}
      <span class="shots-step shots-step-end"><small>Tonight</small><b>${fmt(r.mean, 2)} xG &middot; ${pct(r.chance, 0)}</b></span>
    </div>`;
  const posted = (((SHOTS || {}).lineups || {})[x.game.game_id] || {})[r.team];
  const mates = posted ? (posted.lines.find((names) => names.some((name) => plainName(name) === plainName(r.name))) || []).join(" &ndash; ") : "";
  const lineNote = posted
    ? `<p class="shots-lineup">${mates ? `<b>${slotWords(r.slot)}:</b> ${mates}. ` : ""}${posted.injured.length ? `Injured: ${posted.injured.join(", ")}. ` : ""}${posted.scratched.length ? `Scratched: ${posted.scratched.join(", ")}.` : ""}</p>`
    : `<p class="shots-lineup">The NHL hasn't posted ${r.team}'s projected lineup yet (usually around midday Eastern): his recent ice time stands in.</p>`;

  const d = (GOALS.defense || {})[r.opp] || {};
  const tag = (f) => (f - 1 >= LIFT_CALL ? `<span class="gs-tag gs-tag-mismatch">Leaky</span>` : f - 1 <= -LIFT_CALL ? `<span class="gs-tag gs-tag-tough">Stingy</span>` : `<span class="nba-notag">Average</span>`);
  const tile = (label, value, rank, extra, tip) => `<div class="nba-tile" title="${tip || ""}"><div class="gs-tile-label">${label}</div><b>${value}</b><small>${has(rank) ? rankWord(rank) : ""}</small>${extra || ""}</div>`;
  const tiles = `<div class="nba-tiles shots-allows">
      ${d.xg ? tile("Expected goals allowed", fmt(d.xg.season, 2), d.xg.rank, tag(d.xg.factor), `The model counts it as ${liftText(r.lift.opp)}`) : ""}
      ${d.low_slot ? tile("Low-slot shots allowed", fmt(d.low_slot.season, 1), d.low_slot.rank) : ""}
      ${d.slot ? tile("Slot shots allowed", fmt(d.slot.season, 1), d.slot.rank) : ""}
      <div class="nba-tile" title="${PIECE_TIPS.goalie(r)}"><div class="gs-tile-label">In net (expected)</div><b class="goals-goalie">${goalieName(r.goalie)}</b><small>${liftText(r.lift.goalie)} for shooters</small><span class="nba-notag">projection</span></div>
    </div>`;

  // The price: anytime (the main line) and 2 or more, at the model's fair price.
  const alts = ((((DATA.player_odds || {})[x.game.game_id] || {})[r.id] || {}).goal_alts) || [];
  const twoPrice = (alts.find((a) => a[0] === 1.5) || [])[1];
  const priceRow = (label, chance, price, first, main) => {
    const edge = has(price) ? chance - breakEven(price) : null;
    return `<tr${main ? ' class="shots-main-line"' : ""}><td>${label}</td><td class="num">${pct(chance, 0)}</td><td class="num">${odds(fairPrice(chance)) || "--"}</td><td class="num"><b>${has(price) ? odds(price) : "--"}</b></td><td class="num">${has(first) ? odds(first) : "--"}</td><td class="num ${has(edge) && edge >= edgeAt("lean") ? "tier-good" : ""}">${points(edge)}</td></tr>`;
  };
  const ladder = `<table class="data-table shots-ladder"><thead><tr><th>Goals</th><th title="The model's chance">Model</th><th title="The price with no cut at which the model's chance breaks even">Fair price</th><th>Novig</th><th title="The first price the page saw for him: the record grades how far it moved by puck drop">First seen</th><th title="The model's chance minus the chance the price needs to break even, in points">Edge</th></tr></thead><tbody>
      ${priceRow("Anytime (1+)", r.chance, r.odds, r.first_odds, true)}${priceRow("2 or more", twoPlus(r.mean), twoPrice, null, false)}</tbody></table>`;

  // The rink: his share from each zone, the defense's three boxes (shots.json), as on the Shots page.
  const shares = areaShares();
  const teams = teamsInLeague();
  const mine = seasonCounts(r.team, r.id);
  const rink = rinkSvg(`goals-rink-${r.id}`, `Where ${r.name} shoots from against what ${r.opp} allows`, (z) => {
    // His real share from each zone (seasonCounts), never the model's mixed-in one.
    const share = mine ? mine.shares[z.key] : null;
    const dd = (((SHOTS || {}).defense || {})[r.opp] || {})[`a_${z.key}`];
    const of = (shares[r.opp] || {})[z.key];
    if (!dd) return { big: pct(share, 0), tip: `${z.label}: ${pct(share, 0)} of his shots this season${mine ? ` (${Math.round(share * mine.located)} of ${mine.located})` : ""}.` };
    const st = rankStep(dd.season_rank, teams);
    const tip = `${z.label}: ${pct(share, 0)} of his shots this season${mine ? ` (${Math.round(share * mine.located)} of ${mine.located})` : ""}. ${r.opp} allows ${fmt(dd.season)} a game from here this season (${rankWord(dd.season_rank)}; the league allows ${fmt(dd.league)}).`;
    // A click lists his team's shooters from here (him outlined), then every defense.
    const league = leagueAttr({ area: z.key, def: r.opp, who: r.team, me: r.id });
    const click = `Click for ${r.team}'s shooters from here and every team.`;
    if (z.small) return { big: pct(share, 0), small: `allows ${fmt(dd.season)}/g &middot; ${rankWord(dd.season_rank)}`, tip, league, click };
    return {
      ...zoneOnStep(st),
      big: pct(share, 0),
      boxes: [{ text: `${fmt(dd.season)}/g`, step: st, w: 6.6 }, { text: of ? pct(of.share, 0) : "--", step: of ? rankStep(of.rank, teams) : null, w: 4.7 }, { ...rankBoxText(dd.season_rank, teams), step: st, w: 5.2 }],
      tip,
      league,
      click,
    };
  });
  const callout = r.zone
    ? `<div class="goals-callout" title="${zoneTip(r)}"><span class="goals-zone">ZONE MATCH</span> <b>${Math.round(r.zone.share * 100)}%</b> of his shots from the ${ZONE_WORD[r.zone.area]} <span class="muted-label">(${positionGroup(r.pos) === "D" ? "defensemen" : "forwards"} ${Math.round(r.zone.lg_share * 100)}%)</span> &middot; ${r.opp} allows <b>${fmt(r.zone.opp_pg)}</b> a game there, <b>${rankWord(r.zone.opp_rank)}</b>. <span class="muted-label">Tracked in the record; not in the number.</span></div>`
    : "";
  // The model's chance to score once (anytime) or twice.
  const scoreAt = (at) => (at === 0.5 ? r.chance : at === 1.5 ? twoPlus(r.mean) : null);
  const bookCol = bookPanelFor(x, "goals", 0.5, "Anytime goal",
    (side, at) => (has(scoreAt(at)) ? (side === "o" ? scoreAt(at) : 1 - scoreAt(at)) : null), GOALS.edges, { o: "Scores", u: "No goal" });
  return `<tr class="shots-detail"><td colspan="${columns}">
      <div class="shots-detail-grid${bookCol ? " has-odds" : ""}">
        <div class="shots-detail-main">
          <div class="shots-detail-label">How tonight's chance is built</div>${build}${lineNote}
          <div class="shots-detail-label">${logo(r.opp, 16)} What ${r.opp} allows a game <span class="muted-label">this season, and where that ranks</span></div>${tiles}
          <div class="shots-detail-label">The price, at the model's fair price</div>${ladder}
        </div>
        <div class="shots-detail-rink">
          <div class="shots-detail-label">Where he shoots <span class="muted-label">and what ${r.opp} allows from there</span> <button type="button" class="info-i" aria-expanded="false" aria-controls="rink-key-${r.id}" title="How to read the rink">i</button></div>${callout}${rink}
          <p class="shots-rink-key info-note" id="rink-key-${r.id}" hidden>Big number: the share of his shots from that spot. Boxes, what ${r.opp} allows from there: <b>shots a game</b>, the <b>share</b> of all the shots it allows, and its <b>league rank</b> there. Click a zone to see ${r.team}'s shooters from there (him outlined) and every team. Colors are his side: ${rankScaleKey("most shots for him", "fewest")}</p>
        </div>
        ${bookCol}
      </div>
    </td></tr>`;
}

// Each column draws its own cell. `adv`: folded away until "Expand advanced stats" (the owner,
// 2026-10-15). No Proj or Model % column: the Fair price tells that story.
const COLUMNS = [
  { key: null, label: "#", cell: (x, i) => `<td class="num shots-rank">${i + 1}</td>` },
  { key: null, label: "Player", search: true, cls: "shots-th-player", cell: (x) => `<td class="nba-player shots-player">${playerClick(x.r.id, `${headshot(x.season || {})}<span>${x.r.name}</span>`)}<span class="muted-label">${x.r.pos}</span><span class="shots-vs">${logo(x.r.team, 30)}<span class="at">${x.r.home ? "vs" : "@"}</span>${logo(x.r.opp, 30)}</span></td>` },
  { key: "line", label: "Line", title: "His line (L1 to L4) or pair (D1 to D3) in the NHL's projected lineup for tonight. An arrow = above or below the line his minutes say he has been on. -- = not posted yet.", cell: (x) => lineCell(x.r) },
  { key: null, label: "Anytime", title: "The best price across books for him to score (No odds = not priced yet)", cell: (x) => `<td class="shots-play-cell">${priceChip(x.r)}${has(x.r.odds) ? nhlPlayBox(nhlPlayEntry({ market: "goal", g: x.game, r: x.r, price: x.r.odds })) : ""}</td>` },
  { key: null, label: "Rating", title: "How the record files the play: Strong (an edge of 6 to 12 points), Lean (3 to 6), Check (12+, or moved down a line tonight: look for news first)", cell: ratingCell },
  { key: null, label: "Zone", title: "Zone Match: his heavy shooting area (low slot or slot) against a defense that allows a lot from it. Tracked in the record, not in the number", cell: (x) => zoneCell(x.r) },
  { key: "goals", label: "G", title: "His goals this season", cell: (x) => `<td class="num" title="${x.r.goals} goals in ${x.r.games} games this season">${x.r.goals}<small class="muted-label"> /${x.r.games}gp</small></td>` },
  { key: "xg", label: "xG", title: "His expected goals this season: what his shots should have scored from where and how they were taken", cell: (x) => `<td class="num">${fmt(x.r.xg, 1)}</td>` },
  { key: "chance", label: "Fair", title: "The price with no cut at which the model's chance to score breaks even", cell: (x) => `<td class="num" title="The model's chance he scores: ${pct(x.r.chance, 0)}">${odds(x.r.fair) || "--"}</td>` },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points. Green from 3; from 12 it is set apart to be checked.", cell: edgeCell },
  { key: "minutes", label: "Min", adv: true, title: "Ice time the model expects tonight (even strength + power play)", cell: minutesCell },
  { key: "opp", label: "Opp", adv: true, title: "The other defense's expected goals allowed against the league", cell: (x) => liftCell(x.r.lift.opp, oppTip(x.r)) },
  { key: "goalie", label: "Goalie", adv: true, title: "Tonight's expected goalie: goals he has allowed against what the shots on him should have scored", cell: (x) => liftCell(x.r.lift.goalie, PIECE_TIPS.goalie(x.r)) },
  { key: "finish", label: "Finish", adv: true, title: "His goals against his expected goals, pulled hard toward average", cell: (x) => liftCell(x.r.lift.finish, PIECE_TIPS.finish()) },
  { key: "split", label: "EV/PP", adv: true, title: "His even-strength and power-play rates read apart, each times his minutes there", cell: (x) => liftCell(x.r.lift.split, PIECE_TIPS.split(x.r)) },
  { key: "style", label: "Style", adv: true, title: "The net-front trim and his off-wing shots", cell: (x) => liftCell(styleLift(x.r), PIECE_TIPS.style(x.r)) },
  { key: "site", label: "Home/rest", adv: true, title: "Home ice and back-to-backs", cell: (x) => liftCell(siteLift(x.r), siteTip(x.r)) },
];
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const shown = gamesOn(date).filter((g) => boardFor(g) && (!gameId || g.game_id === gameId));
  const showResult = rows.some((x) => has(x.r.actual));
  const cols = shownColumns(COLUMNS, goalsView.adv);
  // +1: the empty last column that takes the spare width, so the others stay narrow.
  const columns = cols.length + (showResult ? 1 : 0) + 1;
  if (!rows.length && !nameSearching()) {
    const waiting = goalsView.lineup === "confirmed" && sortedRows(date, "all").length;
    el("shots-content").innerHTML = !shown.length
      ? `<p class="no-data-note">No projections for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.</p>`
      : waiting
        ? `<p class="no-data-note shots-waiting">No lineup is in yet for ${shown.length === 1 ? "this game" : "these games"}. The NHL posts each one around midday Eastern on game day. <button type="button" class="view-toggle-btn shots-filter-btn" data-filter="lineup" data-value="all">Show all players</button></p>`
        : `<p class="no-data-note">No players match these filters.</p>`;
    return;
  }
  const head = cols.map((c) => {
    const active = c.key && c.key === goalsView.sort;
    return `<th${c.key ? ` class="shots-sort${active ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}" data-sort="${c.key}"` : c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${c.search ? nameSearchBox() : ""}${active ? `<span class="shots-arrow">${goalsView.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const heading = (text, cls, i) => `${i > 0 ? `<tr class="group-gap"><td colspan="${columns}"></td></tr>` : ""}<tr class="group-row ${cls}"><td colspan="${columns}">${text}</td></tr>`;
  const body = rows
    .map((x, i) => {
      const r = x.r;
      const open = goalsView.open === `${x.game.game_id}:${r.id}`;
      const prev = rows[i - 1];
      let divider = "";
      if (x.state !== "open" && i > 0 && prev.state !== x.state && rows[0].state !== x.state) {
        divider = heading(x.state === "live" ? "Live now: these games have started. The price and chance are the last ones from before puck drop." : "Final: locked before puck drop and graded.", "shots-state-head", i);
      } else if (rankedByEdge() && (!prev || prev.state !== x.state || rankGroup(prev) !== rankGroup(x))) {
        const n = (size) => Math.round(edgeAt(size) * 100);
        const text = [
          `Check first. The biggest gaps to the market (${n("check")}+ points: a handful of games against everything the book knows), or a player moved down a line tonight. Look for news before you bet.`,
          `Plays: Novig prices them; best edge first.`,
          unsureHead(GOALS),
          `No odds yet: the model's fair price only, best chance first. Shop it elsewhere, or wait for Novig to post.`,
        ][rankGroup(x)];
        if (i > 0 || rankGroup(x) !== 1) divider = heading(text, ["shots-check-head", "shots-plays-head", "goals-noodds-head", "goals-noodds-head"][rankGroup(x)], i);
      }
      const row = `${divider}<tr class="shots-row${open ? " shots-open" : ""}${x.state === "live" ? " shots-live" : ""}" data-state="${x.state}" data-row="${x.game.game_id}:${r.id}">
        ${cols.map((c) => c.cell(x, i)).join("")}
        ${showResult ? actualCell(x) : ""}<td class="shots-spacer"></td>
      </tr>`;
      return row + (open ? detailRow(x, columns) : "");
    })
    .join("");
  el("shots-content").innerHTML = `<div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table goals-table">
      <thead><tr>${head}${showResult ? `<th title="His real goals, and whether the anytime bet won">Result</th>` : ""}<th class="shots-spacer"></th></tr></thead>
      <tbody>${body || nameSearchMiss(columns)}</tbody>
    </table></div></div>`;
}

// ---- the record (the build grades it: goals_record_summary) ----
const RECORD_BUCKETS = [["edge", "Every Edge", ["strong", "lean"]], ["strong", "Strong", ["strong"]], ["lean", "Lean", ["lean"]], ["check", "Check First", ["check"]], ["zone", "Zone Match", null]];
function renderRecord() {
  const record = GOALS.record;
  const box = el("shots-results");
  if (!record || !record.games) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first games that finish after this page went live: every player graded at the price locked before puck drop, and how far that price moved from the first one the page saw.</p>`;
    return;
  }
  const n = (size) => Math.round(edgeAt(size) * 100);
  const za = record.zone_all || {};
  const honest = (record.honest || []).filter((b) => b.players).map((b) => `<tr><td>${Math.round(b.lo * 100)}-${Math.round(Math.min(b.hi, 1) * 100)}%</td><td class="num">${b.players}</td><td class="num">${pct(b.said / b.players, 0)}</td><td class="num"><b>${pct(b.scored / b.players, 0)}</b></td></tr>`).join("");
  nhlYtd(box, {
    record,
    intro: `<div class="shots-detail-label">The record so far <span class="muted-label">${shortDate(record.since)} to ${shortDate(record.through)}, ${record.games} games, ${record.players} players graded; anytime bets at the price at the last refresh before puck drop, up to 30 minutes before; u = units won risking 1 a play</span></div>`,
    tracker: {
      key: "nhl-goals",
      markets: [
        { key: "play", label: "Plays", ledger: record.ledger, only: ["strong", "lean"], min: n("lean"), max: 20, tip: `Strong and Lean plays: an edge of ${n("lean")} to ${n("check")} points`,
          splits: [["strong", "Strong", `Edge ${n("strong")} to ${n("check")}: the plays the model liked most`], ["lean", "Lean", `Edge ${n("lean")} to ${n("strong")}`], ["zone", "Zone Match", "Plays with the Zone Match tag"], ["thin", "Thin Prices", "Plays with only one side priced on Novig"]] },
        { key: "check", label: "Check First", ledger: record.ledger, only: ["check"], min: n("lean"), max: 30, tip: "Gaps too big to take at face value, and players moved down a line" },
      ],
    },
    season: `${ytdSeasonTile(`Under ${n("lean")}: No Edge`, record.none, "Every other priced player: about what blind betting does")}${ytdSeasonTile("Zone Match, Priced", record.zone, "Every tagged player with a price, whatever the edge")}${ytdSeasonTile("Thin Prices", record.thin, "Every player with only one side priced on Novig, whatever the edge")}${clvTile(record.clv)}`,
    after: `<div class="shots-detail-label">Said vs scored <span class="muted-label">every graded player, priced or not; the Zone Match tag: ${za.players ? `${za.players} players, model said ${pct(za.said / za.players, 0)}, scored ${pct(za.scored / za.players, 0)}` : "none yet"}</span></div>
    ${honest ? `<table class="data-table shots-ladder goals-honest"><thead><tr><th>Model said</th><th>Players</th><th>Said</th><th>Scored</th></tr></thead><tbody>${honest}</tbody></table>` : ""}`,
    list: () => recordPlays(record),
  });
}
function recordPlays(record) {
  const all = record.plays || [];
  if (!all.length) return "";
  const bucket = RECORD_BUCKETS.find(([key]) => key === goalsView.record) || RECORD_BUCKETS[0];
  const shown = all.filter((play) => (bucket[2] ? bucket[2].includes(play.size) : !!play.zone) && ytdKeeps("nhl-goals", play.size === "check" ? "check" : "play", play.date, play.edge));
  const sum = (plays) => plays.reduce((t, play) => ({ wins: t.wins + (play.won ? 1 : 0), losses: t.losses + (play.won ? 0 : 1), units: t.units + play.units }), { wins: 0, losses: 0, units: 0 });
  const line = (t) => `${t.wins}-${t.losses} &middot; ${signed(t.units, 2)}u`;
  const buttons = RECORD_BUCKETS.map(([key, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${bucket[0] === key ? " active" : ""}" data-filter="record" data-value="${key}">${label}</button>`).join("");
  const sizeTag = { strong: "Strong", lean: "Lean", check: "Check" };
  let body = "";
  let day = null;
  shown.forEach((play) => {
    if (play.date !== day) {
      day = play.date;
      body += `<tr class="shots-record-day"><td colspan="8">${new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} <span class="muted-label">${line(sum(shown.filter((x) => x.date === day)))}</span></td></tr>`;
    }
    body += `<tr>
        <td class="nba-player shots-player">${playerClick(play.id, `<b>${play.name}</b>`)}<span class="shots-vs">${logo(play.team, 30)}<span class="at">${play.home ? "vs" : "@"}</span>${logo(play.opp, 30)}</span></td>
        <td class="shots-play-cell"><span class="shots-play shots-play-over"><b>Yes</b><span>${odds(play.price)}</span></span>${play.zone ? `<span class="goals-zone">ZONE</span>` : ""}</td>
        <td class="num"><span class="shots-record-size shots-record-${play.size}">${sizeTag[play.size] || ""}</span></td>
        <td class="num">${points(play.edge)}</td>
        <td class="num" title="The first price the page saw">${has(play.first) ? odds(play.first) : "--"}</td>
        <td class="num"><b>${play.actual}</b></td>
        <td class="num"><span class="pick-result pick-result-${play.won ? "win" : "loss"}">${play.won ? "W" : "L"}</span></td>
        <td class="num ${play.won ? "tier-good" : "tier-bad"}">${signed(play.units, 2)}</td>
      </tr>`;
  });
  return `<div class="shots-detail-label shots-record-head">Graded plays <span class="muted-label">every priced player with an edge (or the tag), at the price locked before puck drop</span></div>
    <div class="view-toggle shots-toolbar shots-record-buckets">${buttons}<span class="shots-record-total">${shown.length ? line(sum(shown)) : "none yet"}</span></div>
    ${shown.length ? `<div class="shots-record-scroll"><table class="data-table shots-record-table">
      <thead><tr><th class="shots-th-player">Player</th><th>Anytime</th><th>Bucket</th><th>Edge</th><th>First seen</th><th title="His real goals">Goals</th><th>Result</th><th title="Units won risking 1">Units</th></tr></thead>
      <tbody>${body}</tbody></table></div>` : `<p class="shots-record-note">No graded plays in this bucket yet.</p>`}`;
}

function renderNote() {
  const date = days()[dayIndex];
  const boards = gamesOn(date).map(boardFor).filter(Boolean);
  const locked = gamesOn(date).filter((g) => boardFor(g) && gameState(g) !== "open").length;
  const g = currentGame();
  el("shots-title").innerHTML = `Anytime Goals${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((g) => boardFor(g) && !boardFor(g).locked);
  const lined = open.filter((g) => boardFor(g).posted).length;
  const priced = open.filter((g) => boardFor(g).players.some((r) => has(r.odds))).length;
  el("shots-lineups").hidden = !open.length;
  el("shots-lineups").textContent = !open.length
    ? ""
    : `Lineups are in for ${lined} of ${open.length} games; Novig has anytime prices up for ${priced} of ${open.length}. Both fill in through the day as the page refreshes.`;
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
  goalsView.open = null;
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
  goalsView[menu.dataset.filter] = menu.value;
  goalsView.open = null;
  render();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#shots-record-open")) return showRecord(true);
  if (e.target.id === "shots-record-modal" || e.target.closest("#shots-record-modal .modal-close")) return showRecord(false);
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    goalsView.open = null;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const filter = e.target.closest(".shots-filter-btn");
  if (filter) {
    const value = filter.dataset.value;
    goalsView[filter.dataset.filter] = value === "true" ? true : value === "false" ? false : value;
    if (filter.dataset.filter === "adv") nhlAdvancedStats(goalsView.adv);
    else if (filter.dataset.filter !== "record") goalsView.open = null;
    return render();
  }
  const sort = e.target.closest(".shots-sort");
  if (sort) {
    if (goalsView.sort === sort.dataset.sort) goalsView.dir = -goalsView.dir;
    else Object.assign(goalsView, { sort: sort.dataset.sort, dir: -1 });
    return renderTable();
  }
  const row = e.target.closest(".shots-row");
  if (row && !e.target.closest(".player-click")) {
    goalsView.open = goalsView.open === row.dataset.row ? null : row.dataset.row;
    renderTable();
  }
});

const getJson = (url) =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
Promise.all([loadNhlData(), getJson("goals.json"), getJson("shots.json")])
  .then(([, goals, shots]) => {
    GOALS = goals || { games: {}, defense: {} };
    SHOTS = shots || { defense: {}, lineups: {} };
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
      goalsView.open = link.row;
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
