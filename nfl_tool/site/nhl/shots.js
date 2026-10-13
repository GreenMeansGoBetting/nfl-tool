// ---- GMG NHL Suite: Shots ----
// Every skater on the day's slate with a shots-on-goal line, ranked by
// value: the model's projection (nfl_tool/nhl/shots_model.py, written to
// shots.json by the build) next to Novig's line. It opens on the players
// whose lineup is in ("Lineup Confirmed": the NHL has posted the game's
// projected lineup, so the page knows who is dressed and on which line);
// "All" adds the games still waiting on one. This season's numbers only, here and in the
// model: the owner's rule for every NHL prop tool. The data, helpers, rink
// drawing and the player card are in nhl-common.js (loaded first); this file
// is the page.
// No shot math lives here: the build sends each player's chance of 1+, 2+ ...
// shots, and the page only compares those with the prices.

let SHOTS = null;
let dayIndex = 0;
let gameId = null; // one game picked in the strip, or null for the whole day
const shotsView = { side: "best", pos: "all", lineup: "confirmed", sort: "edge", dir: -1, open: null, record: "edge" };

// An edge is the model's chance minus the chance the price needs to break
// even. The sizes that matter come from the build (SHOTS_EDGES in
// build_nhl.py, which grades the record by the same ones): a play is colored
// from "lean"; at "check" the gap is more often news the model can't see (a
// line change, a scratch) than a gift. Those plays are never hidden: they are
// marked, and in the best-to-worst ranking they sit in their own group under
// the rest.
const edgeAt = (size) => ((SHOTS || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
// Also set apart: a play against tonight's line change (an under on a player
// the NHL's projected lineup has moved up a line, an over on one moved down).
// His games so far don't describe tonight's role, and the book knows it. Same
// rule as the build's shots_play ("size": "check").
const needsCheck = (x) => !!x.play && (x.play.edge >= edgeAt("check") || (x.play.againstMove && x.play.edge >= edgeAt("lean")));
// A matchup piece is colored once it moves the projection this much.
const LIFT_CALL = 0.025;
const MINUTES_TREND = 1.0;

const breakEven = (price) => (has(price) ? (price < 0 ? -price / (100 - price) : 100 / (price + 100)) : null);
const fairPrice = (p) => (!has(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
// An edge in points ("+5.2"); a hair either side of nothing reads "0.0", never "-0.0".
function points(edge) {
  if (!has(edge)) return "--";
  const text = (edge * 100).toFixed(1);
  return Number(text) === 0 ? "0.0" : `${edge > 0 ? "+" : ""}${text}`;
}
const liftText = (lift) => `${lift >= 1 ? "+" : ""}${Math.round((lift - 1) * 100)}%`;
const liftTier = (lift) => (lift - 1 >= LIFT_CALL ? "tier-good" : lift - 1 <= -LIFT_CALL ? "tier-bad" : "");
const positionGroup = (pos) => (pos === "D" ? "D" : "F");
// Where a defense ranks for what it allows, said from the nearer end so it
// can't be read backwards: "3rd most" or "2nd fewest".
function rankWord(rank) {
  const teams = Object.keys((SHOTS || {}).defense || {}).length || 32;
  if (rank <= teams / 2) return rank === 1 ? "the most" : `${ordinal(rank)} most`;
  return rank === teams ? "the fewest" : `${ordinal(teams - rank + 1)} fewest`;
}
// The model's chance of clearing a line: over 2.5 = 3 or more.
function chanceOver(r, lineValue) {
  const need = Math.floor(lineValue) + 1;
  return need >= 1 && need <= r.chances.length ? r.chances[need - 1] : null;
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
const boardFor = (g) => ((SHOTS || {}).games || {})[g.game_id] || null;

// ---- one row per skater ----
// The play is the side of his main line the model likes more; each side
// carries the model's chance, the price, and the edge at that price. "fade"
// = the side goes against his own season average (an under on a line he
// averages more than, or the other way round): the model thinks a small
// sample has run hot or cold. Same rule as the build's shots_play.
function sidesFor(r, market) {
  const sides = {};
  if (!market || !has(market.line)) return sides;
  const over = chanceOver(r, market.line);
  if (!has(over)) return sides;
  const line = market.line;
  if (has(market.over)) sides.over = { side: "over", line, price: market.over, chance: over, edge: over - breakEven(market.over), fade: has(r.avg) && r.avg < line, againstMove: r.move === "down" };
  if (has(market.under)) sides.under = { side: "under", line, price: market.under, chance: 1 - over, edge: 1 - over - breakEven(market.under), fade: has(r.avg) && r.avg > line, againstMove: r.move === "up" };
  return sides;
}
function pickSide(sides, want) {
  if (want === "over" || want === "under") return sides[want] || null;
  const both = Object.values(sides);
  return both.length ? both.reduce((a, b) => (b.edge > a.edge ? b : a)) : null;
}
function gradePlay(play, actual) {
  if (!play || !has(actual) || actual === play.line) return null;
  return (play.side === "over") === actual > play.line ? "win" : "loss";
}
function rowsFor(date) {
  const rows = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const board = boardFor(g);
    if (!board) return;
    const gameOdds = (DATA.player_odds || {})[g.game_id] || {};
    board.players.forEach((r) => {
      const book = gameOdds[r.id] || {};
      const sides = sidesFor(r, book.sog);
      const play = pickSide(sides, shotsView.side);
      rows.push({ r, game: g, board, book, sides, play, season: seasonLine(r.id), result: gradePlay(play, r.actual) });
    });
  });
  return rows;
}
// His line on the page's data.
function seasonLine(id) {
  const found = findPlayer(id);
  return found ? found.row : null;
}
const SORTS = {
  edge: (x) => x.play.edge,
  proj: (x) => x.r.mean,
  avg: (x) => x.r.avg,
  chance: (x) => x.play.chance,
  minutes: (x) => x.r.minutes,
  opp: (x) => x.r.lift.opp,
  pos: (x) => x.r.lift.pos,
  area: (x) => x.r.lift.area,
  pp: (x) => x.r.lift.pp,
  site: (x) => siteLift(x.r),
  line: (x) => (x.r.slot ? x.r.lift.line : null),
};
// Home ice and rest, the two pieces that are about the night, not the opponent.
const siteLift = (r) => r.lift.home * r.lift.b2b * r.lift.opp_b2b;
// The ranking as first opened (best edge first) keeps the "check" plays
// apart: the believable plays, then the "check" group.
const rankedByEdge = () => shotsView.sort === "edge" && shotsView.dir < 0;
const rankGroup = (x) => (needsCheck(x) ? 1 : 0);
// Who is listed: only players with a shots-on-goal line to play (the owner:
// no "everyone" view), and under "Lineup Confirmed" only those the NHL's
// projected lineup has on a line or pair tonight.
function sortedRows(date, lineup = shotsView.lineup) {
  const get = SORTS[shotsView.sort] || SORTS.edge;
  return rowsFor(date)
    .filter((x) => !x.r.out && x.play)
    .filter((x) => shotsView.pos === "all" || positionGroup(x.r.pos) === shotsView.pos)
    .filter((x) => lineup === "all" || x.r.slot)
    .sort((a, b) => {
      if (rankedByEdge() && rankGroup(a) !== rankGroup(b)) return rankGroup(a) - rankGroup(b);
      const [va, vb] = [get(a), get(b)];
      // Rows with nothing to sort on (no lineup yet, under Line) sink, whichever way the sort runs.
      if (!has(va) || !has(vb)) return has(va) ? -1 : has(vb) ? 1 : b.r.mean - a.r.mean;
      return (va - vb) * shotsView.dir || b.r.mean - a.r.mean;
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
      // Whether the NHL's projected lineup for the game was in at the last refresh.
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
    `<span class="shots-filter">${options.map(([value, label, tip]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(shotsView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}"${tip ? ` title="${tip}"` : ""}>${label}</button>`).join("")}</span>`;
  el("shots-toolbar").innerHTML =
    group("side", [["best", "Best side"], ["over", "Overs"], ["under", "Unders"]]) +
    group("pos", [["all", "All skaters"], ["F", "Forwards"], ["D", "Defense"]]) +
    group("lineup", [
      ["confirmed", "Lineup Confirmed", "Only players in a game whose lineup the NHL has posted: each is listed on tonight's line or pair"],
      ["all", "All", "Also the games still waiting on a lineup: those players are projected from their recent ice time"],
    ]);
}
function playChip(play, r) {
  // Said out loud when a play the page calls an edge goes against what his game log shows.
  const fade = play.fade && play.edge >= edgeAt("lean") ? `<span class="shots-flag shots-fade" title="This goes against his season average (${fmt(r.avg, 2)} a game in ${r.games} games): the model thinks a small sample has run ${play.side === "under" ? "hot" : "cold"}. Click the row to see how much it discounts it.">vs his avg</span>` : "";
  return `<span class="shots-play shots-play-${play.side}"><b>${play.side === "over" ? "Over" : "Under"} ${fmt(play.line)}</b><span>${odds(play.price)}</span></span>${fade}`;
}
function edgeCell(x) {
  const play = x.play;
  const edge = play.edge;
  const thin = x.book.sog && x.book.sog.thin;
  const lean = edgeAt("lean");
  // A play is green; a gap that is set apart is amber, never green.
  const cls = needsCheck(x) ? "tier-mid" : edge >= lean ? "tier-good" : "";
  const alpha = cls === "tier-good" ? ` style="--tier-a:${Math.min(0.34, 0.08 + (edge - lean) * 3).toFixed(2)}"` : "";
  const flag = !needsCheck(x)
    ? thin ? `<span class="shots-flag" title="Barely traded on Novig: treat the price with care">thin</span>` : ""
    : edge >= edgeAt("check")
      ? `<span class="shots-flag" title="A gap this big usually means the market knows something this season's few games don't: his usual level, a line change, a scratch, a new role. Check before you bet.">check</span>`
      : `<span class="shots-flag" title="${x.r.name} is on a ${x.r.move === "up" ? "higher" : "lower"} line tonight than his minutes this season say he has been on, and this play goes the other way. His games so far don't describe tonight's role.">new line</span>`;
  return `<td class="num shots-edge ${cls}"${alpha} title="The model's ${Math.round(play.chance * 100)}% minus the ${Math.round(breakEven(play.price) * 100)}% this price needs to break even">${points(edge)}${flag}</td>`;
}
function minutesCell(x) {
  const s = x.season;
  const trend = s && has(s.toi) ? x.r.minutes - s.toi : 0;
  const tip = s ? `Season ${fmt(s.toi)} min a game, last five ${fmt(s.l5_toi)}` : "";
  const arrow = trend >= MINUTES_TREND ? `<small class="shots-up">&#9650;</small>` : trend <= -MINUTES_TREND ? `<small class="shots-down">&#9660;</small>` : "";
  return `<td class="num" title="${tip}">${fmt(x.r.minutes)}${arrow}</td>`;
}
// His line in the NHL's projected lineup: "L1" to "L4", or "D1" to "D3".
const slotName = (slot) => (slot ? `${slot[0] === "F" ? "L" : "D"}${slot.slice(1)}` : "");
const slotWords = (slot) => (slot ? `${["first", "second", "third", "fourth", "fifth"][Number(slot.slice(1)) - 1] || ""} ${slot[0] === "F" ? "line" : "pair"}` : "");
function lineTip(r) {
  if (!r.slot) return "The NHL hasn't posted a projected lineup for this game yet: his recent ice time stands in.";
  const base = `On the ${slotWords(r.slot)} in the NHL's projected lineup for tonight.`;
  if (!r.move) return `${base} That is where his minutes say he has been playing.`;
  return `${base} His minutes this season (${fmt(r.minutes)} a game) are a ${slotWords(r.usual_slot)} player's; tonight's ${r.slot[0] === "F" ? "line" : "pair"} has been playing ${fmt(r.line_minutes)}. The replay's number for a move like that: ${liftText(r.lift.line)} shots.`;
}
function lineCell(r) {
  if (!r.slot) return `<td class="num muted-label" title="${lineTip(r)}">--</td>`;
  const arrow = r.move === "up" ? `<small class="shots-up">&#9650;</small>` : r.move === "down" ? `<small class="shots-down">&#9660;</small>` : "";
  return `<td class="num shots-line ${liftTier(r.lift.line)}" title="${lineTip(r)}">${slotName(r.slot)}${arrow}</td>`;
}
// A name as the NHL's story spells it against ours (accents dropped on both).
const plainName = (name) => (name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function liftCell(lift, tip) {
  return `<td class="num shots-lift ${liftTier(lift)}" title="${tip}">${liftText(lift)}</td>`;
}
// Each rink area's share of all the shots a defense allows, and where that
// share ranks in the league (1st = the biggest share): { team: { area: { share, rank } } }.
// Display only: the model reads shots a game (shots.json's `defense`), never shares.
function areaShares() {
  if (SHOTS.area_shares) return SHOTS.area_shares;
  const keys = RINK_ZONES.map((z) => z.key);
  const out = {};
  Object.entries(SHOTS.defense || {}).forEach(([abbr, d]) => {
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
function allowsTip(opp, key, what) {
  const d = ((SHOTS.defense || {})[opp] || {})[key];
  if (!d) return "";
  return `${opp} allows ${fmt(d.season)} ${what} a game this season (${rankWord(d.season_rank)}; the league allows ${fmt(d.league)}). After ${d.games} games the model counts that as ${liftText(d.factor)}.`;
}
function siteTip(r) {
  const parts = [r.home ? "Home ice" : "On the road"];
  if (r.lift.b2b !== 1) parts.push(`${r.team} played yesterday`);
  if (r.lift.opp_b2b !== 1) parts.push(`${r.opp} played yesterday`);
  return parts.join(". ");
}
function actualCell(x) {
  if (!has(x.r.actual)) return `<td class="num muted-label">--</td>`;
  const pill = x.result ? `<span class="pick-result pick-result-${x.result}">${x.result === "win" ? "W" : "L"}</span> ` : "";
  return `<td class="num">${pill}<b>${x.r.actual}</b></td>`;
}

// What the open row shows: how the projection is built, every line the book
// prices next to the model's fair price, and where he shoots against where
// the other team gives shots up.
function detailRow(x, columns) {
  const r = x.r;
  const defense = (SHOTS.defense || {})[r.opp] || {};
  const forward = positionGroup(r.pos) === "F";
  const step = (label, lift, tip) => `<span class="shots-step ${liftTier(lift)}" title="${tip}"><small>${label}</small><b>${liftText(lift)}</b></span>`;
  // From what his game log says to what the model believes: after a handful
  // of games it only partly trusts his average (a league-average skater at
  // his position is mixed in, and his rate is read mostly from his attempts).
  const sampleTip = `After ${r.games} game${r.games === 1 ? "" : "s"} the model only partly trusts his average: it mixes in a league-average ${forward ? "forward" : "defenseman"} and reads his rate mostly from his shot attempts (${fmt(r.att60)} per 60 minutes, ${pct(r.thru, 0)} of them on goal), for the ${fmt(r.minutes)} minutes he should play. The more he plays, the less this moves him.`;
  const start = r.avg
    ? `<span class="shots-step shots-step-end" title="Shots on goal a game this season"><small>Season avg &middot; ${r.games} gp</small><b>${fmt(r.avg, 2)}</b></span>${step(`${r.games}-game sample`, r.usual / r.avg, sampleTip)}`
    : `<span class="shots-step shots-step-end" title="${sampleTip}"><small>Model's rate &middot; ${r.games} gp</small><b>${fmt(r.usual, 2)}</b></span>`;
  // Tonight's line, as its own piece, and who he is out there with.
  const posted = ((SHOTS.lineups || {})[x.game.game_id] || {})[r.team];
  const mates = posted ? (posted.lines.find((names) => names.some((name) => plainName(name) === plainName(r.name))) || []).join(" &ndash; ") : "";
  const lineStep = r.slot ? step(`${slotName(r.slot)} tonight`, r.lift.line, lineTip(r)) : "";
  const lineNote = posted
    ? `<p class="shots-lineup">${mates ? `<b>${slotWords(r.slot)}:</b> ${mates}. ` : ""}${posted.injured.length ? `Injured: ${posted.injured.join(", ")}. ` : ""}${posted.scratched.length ? `Scratched: ${posted.scratched.join(", ")}.` : ""}</p>`
    : `<p class="shots-lineup">The NHL hasn't posted ${r.team}'s projected lineup yet (usually around midday Eastern): his recent ice time stands in, and anyone ESPN lists as out is left off.</p>`;
  const build = `<div class="shots-build">
      ${start}
      ${lineStep}
      ${step(`${r.opp} defense`, r.lift.opp, allowsTip(r.opp, "sog", "shots on goal"))}
      ${step(forward ? "vs forwards" : "vs defensemen", r.lift.pos, allowsTip(r.opp, forward ? "f_sog" : "d_sog", forward ? "shots on goal to forwards" : "shots on goal to defensemen"))}
      ${step("His spots", r.lift.area, `Where he shoots from against where ${r.opp} gives shots up`)}
      ${step("Power play", r.lift.pp, `${pct(r.pp_share, 0)} of his shots come on the power play. ${allowsTip(r.opp, "pp_unb", "power-play shots")}`)}
      ${step("Home / rest", siteLift(r), siteTip(r))}
      <span class="shots-step shots-step-end"><small>Tonight</small><b>${fmt(r.mean, 2)}</b></span>
    </div>`;

  // The ladder: the main line (both sides) and the book's other lines (overs only).
  const main = x.book.sog;
  const rungs = [];
  const rung = (label, chance, price, isMain) => {
    const edge = has(price) && has(chance) ? chance - breakEven(price) : null;
    rungs.push(`<tr${isMain ? ' class="shots-main-line"' : ""}><td>${label}</td><td class="num">${has(chance) ? pct(chance, 0) : "--"}</td><td class="num">${odds(fairPrice(chance)) || "--"}</td><td class="num"><b>${odds(price) || "--"}</b></td><td class="num ${has(edge) && edge >= edgeAt("lean") ? "tier-good" : ""}">${points(edge)}</td></tr>`);
  };
  const overs = [...(x.book.sog_alts || []).map(([strike, price]) => [strike, price, false]), ...(main && has(main.over) ? [[main.line, main.over, true]] : [])].sort((a, b) => a[0] - b[0]);
  overs.forEach(([strike, price, isMain]) => rung(`${Math.ceil(strike)} or more`, chanceOver(r, strike), price, isMain));
  if (main && has(main.under)) rung(`Under ${fmt(main.line)}`, has(chanceOver(r, main.line)) ? 1 - chanceOver(r, main.line) : null, main.under, true);
  const ladder = `<table class="data-table shots-ladder"><thead><tr><th>Shots on goal</th><th title="The model's chance">Model</th><th title="The price with no cut at which the model's chance breaks even">Fair price</th><th>Novig</th><th title="The model's chance minus the chance the price needs to break even, in points">Edge</th></tr></thead><tbody>${rungs.join("")}</tbody></table>`;

  // A defense's tile says which way it points in words, never by color alone:
  // "Stingy" is a tough night for a shooter, "Leaky" a good one.
  const tile = (label, key) => {
    const d = defense[key];
    if (!d) return "";
    const tilt = d.factor - 1;
    const tag = tilt >= LIFT_CALL ? `<span class="gs-tag gs-tag-mismatch">Leaky</span>` : tilt <= -LIFT_CALL ? `<span class="gs-tag gs-tag-tough">Stingy</span>` : `<span class="nba-notag">Average</span>`;
    return `<div class="nba-tile" title="${d.games} games this season; the league allows ${fmt(d.league)}. The model counts it as ${liftText(d.factor)}."><div class="gs-tile-label">${label}</div><b>${fmt(d.season)}</b><small>${rankWord(d.season_rank)}</small>${tag}</div>`;
  };
  const tiles = `<div class="nba-tiles shots-allows">${tile("Shots on goal allowed", "sog")}${tile(forward ? "To forwards" : "To defensemen", forward ? "f_sog" : "d_sog")}${tile("Power-play shots allowed", "pp_unb")}</div>`;

  // The rink shows both sides in every zone. His side: the big number, the
  // share of his shots he takes from there. The defense's side: three boxes
  // (the owner, 2026-10-13: "allows 3rd fewest" was all relative, and wordy):
  // shots a game it allows from there, that zone's share of all the shots it
  // allows, and the league rank, each box on the eight rank colors.
  // The zone itself and the rank are the league-wide count (shots a game), not
  // the share: a shooter's shots come from how many a defense allows from a
  // spot, and a team that allows few shots can give up most of them from one
  // zone and still allow fewer there than anyone. The share box carries its
  // own league rank's color, so a defense that funnels shots to a zone still
  // shows. The strip outside the zone is never colored.
  const teams = Object.keys(SHOTS.defense || {}).length || 32;
  const shares = areaShares();
  const rink = rinkSvg(`shots-rink-${r.id}`, `Where ${r.name} shoots from against what ${r.opp} allows`, (z) => {
    const share = r.shares[z.key] || 0;
    const d = defense[`a_${z.key}`];
    const of = (shares[r.opp] || {})[z.key];
    if (!d) return { big: pct(share, 0), tip: `${z.label}: ${pct(share, 0)} of his shots.` };
    const step = rankStep(d.season_rank, teams);
    const allowed = `${fmt(d.season)}/g`;
    const ofAll = of ? pct(of.share, 0) : "--";
    const tip = `${z.label}: ${pct(share, 0)} of his shots. ${r.opp} allows ${fmt(d.season)} a game from here this season (${rankWord(d.season_rank)}; the league allows ${fmt(d.league)})${of ? `, ${pct(of.share, 0)} of all the shots it allows (${rankWord(of.rank)} share)` : ""}.`;
    if (z.small) return { big: pct(share, 0), small: `allows ${allowed} &middot; ${ofAll} &middot; ${ordinal(d.season_rank)}`, tip };
    return {
      ...zoneOnStep(step),
      big: pct(share, 0),
      // Widths in feet on the rink: "10.8/g" needs the most room, and the three still fit the low slot.
      boxes: [{ text: allowed, step, w: 6.6 }, { text: ofAll, step: of ? rankStep(of.rank, teams) : null, w: 4.7 }, { text: ordinal(d.season_rank), step, w: 5.2 }],
      tip,
    };
  });
  return `<tr class="shots-detail"><td colspan="${columns}">
      <div class="shots-detail-grid">
        <div class="shots-detail-main">
          <div class="shots-detail-label">How tonight's number is built</div>${build}${lineNote}
          <div class="shots-detail-label">${logo(r.opp, 16)} What ${r.opp} allows a game <span class="muted-label">this season, and where that ranks</span></div>${tiles}
          <div class="shots-detail-label">Every line, at the model's fair price</div>${ladder}
        </div>
        <div class="shots-detail-rink">
          <div class="shots-detail-label">Where he shoots <span class="muted-label">and what ${r.opp} allows from there</span></div>${rink}
          <p class="shots-rink-key">Big number: the share of his shots from that spot. Boxes, what ${r.opp} allows from there: <b>shots a game</b>, the <b>share</b> of all the shots it allows, and its <b>league rank</b> for shots a game (1st = the most). ${rankScaleKey("the most", "the fewest")}</p>
        </div>
      </div>
    </td></tr>`;
}

const COLUMNS = [
  { key: null, label: "#" },
  { key: null, label: "Player", cls: "shots-th-player" },
  { key: "line", label: "Line", title: "His line (L1 to L4) or pair (D1 to D3) in the NHL's projected lineup for tonight. An arrow means it is above or below the line his own minutes say he has been on: green adds shots, red takes some away. -- = not posted yet." },
  { key: null, label: "Play", title: "The side of his main line the model likes more, at Novig's price" },
  { key: "avg", label: "Avg", title: "His shots on goal a game this season: what his game log says" },
  { key: "proj", label: "Proj", title: "Shots on goal the model expects tonight" },
  { key: "chance", label: "Model", title: "The model's chance the play wins" },
  { key: null, label: "Fair", title: "The price with no cut at which that chance breaks even" },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points. Green from 3 points; from 12 it is set apart to be checked for news." },
  { key: "minutes", label: "Min", title: "Ice time the model expects tonight, from his recent games. An arrow means a minute or more above or below his season average." },
  { key: "opp", label: "Opp", title: "What the other team's defense does to the projection: shots on goal it allows against the league" },
  { key: "pos", label: "Pos", title: "Beyond that: what the defense allows to his position (forwards or defensemen)" },
  { key: "area", label: "Spots", title: "Beyond that: the parts of the ice he shoots from against where the defense gives shots up" },
  { key: "pp", label: "PP", title: "Power-play shots the other team gives up, for the share of his shots that come on the power play" },
  { key: "site", label: "Home/rest", title: "Home ice (+3%), the second night of a back-to-back (-3.5%), an opponent on one (+3.5%)" },
];
// The record: every finished game's plays, graded by the build at the price
// that was locked before puck drop and kept in the repo (model_history/nhl_shots).
function renderRecord() {
  const record = SHOTS.record;
  const box = el("shots-results");
  if (!record || !record.games) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first games that finish after this page went live: every play is graded at the price locked before puck drop.</p>`;
    return;
  }
  const n = (size) => Math.round(edgeAt(size) * 100);
  const tile = (label, t, tip) => {
    const played = t.wins + t.losses;
    return `<div class="nba-tile" title="${tip}"><div class="gs-tile-label">${label}</div><b>${t.wins}-${t.losses}</b><small>${played ? `${Math.round((100 * t.wins) / played)}% &middot; ${signed(t.units)}u` : "none yet"}</small></div>`;
  };
  box.innerHTML = `<div class="shots-detail-label">The record so far <span class="muted-label">${shortDate(record.since)} to ${shortDate(record.through)}, ${record.games} games, graded at the price locked before puck drop; u = units won risking 1 a play</span></div>
    <div class="nba-tiles shots-record">
      ${tile(`Edge ${n("strong")} to ${n("check")}`, record.strong, "Plays the model liked most")}
      ${tile(`Edge ${n("lean")} to ${n("strong")}`, record.lean, "Leans")}
      ${tile(`Under ${n("lean")}: no edge`, record.none, "The better side of every other line: about what blind betting does")}
      ${tile(`${n("check")}+: check first`, record.check, "Gaps too big to take at face value")}
      ${tile("Overs with an edge", record.over, `Overs with an edge of ${n("lean")} to ${n("check")}`)}
      ${tile("Unders with an edge", record.under, `Unders with an edge of ${n("lean")} to ${n("check")}`)}
      ${record.fade ? tile("Against his average", record.fade, `Plays with an edge that went against the player's own season average: the model not believing a hot or cold start`) : ""}
      ${record.with ? tile("With his average", record.with, `Plays with an edge that his own season average agreed with`) : ""}
    </div>
    ${recordPlays(record)}`;
}
// The graded plays themselves, under the buckets: every play that declared an
// edge on a finished game, newest day first, each day headed by its own record.
// Buckets: the plays with an edge (lean + strong, how it opens), either one
// alone, or the "check first" group the page sets apart as not plays.
const RECORD_BUCKETS = [["edge", "Every edge", ["strong", "lean"]], ["strong", "Strong", ["strong"]], ["lean", "Lean", ["lean"]], ["check", "Check first", ["check"]]];
function recordPlays(record) {
  const all = record.plays || [];
  if (!all.length) return "";
  const n = (size) => Math.round(edgeAt(size) * 100);
  const range = { edge: `${n("lean")} to ${n("check")}`, strong: `${n("strong")} to ${n("check")}`, lean: `${n("lean")} to ${n("strong")}`, check: `${n("check")}+ or against a line change` };
  const bucket = RECORD_BUCKETS.find(([key]) => key === shotsView.record) || RECORD_BUCKETS[0];
  const shown = all.filter((play) => bucket[2].includes(play.size));
  const sum = (plays) => plays.reduce((t, play) => ({ wins: t.wins + (play.won ? 1 : 0), losses: t.losses + (play.won ? 0 : 1), units: t.units + play.units }), { wins: 0, losses: 0, units: 0 });
  const line = (t) => `${t.wins}-${t.losses} &middot; ${signed(t.units, 2)}u`;
  const buttons = RECORD_BUCKETS.map(([key, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${bucket[0] === key ? " active" : ""}" data-filter="record" data-value="${key}" title="Edge of ${range[key]} points">${label}</button>`).join("");
  const sizeTag = { strong: "Strong", lean: "Lean", check: "Check" };
  let body = "";
  let day = null;
  shown.forEach((play) => {
    if (play.date !== day) {
      day = play.date;
      body += `<tr class="shots-record-day"><td colspan="8">${new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} <span class="muted-label">${line(sum(shown.filter((x) => x.date === day)))}</span></td></tr>`;
    }
    const who = playerClick(play.id, `<b>${play.name}</b>`);
    body += `<tr>
        <td class="nba-player shots-player">${who}<span class="shots-vs">${logo(play.team, 16)}<span class="at">${play.home ? "vs" : "@"}</span>${logo(play.opp, 16)}</span></td>
        <td class="shots-play-cell">${playChip({ ...play, fade: false }, {})}${play.fade ? ` <span class="shots-fade" title="Against his own season average at the time">vs his avg</span>` : ""}</td>
        <td class="num"><span class="shots-record-size shots-record-${play.size}">${sizeTag[play.size]}</span></td>
        <td class="num">${points(play.edge)}</td>
        <td class="num">${fmt(play.mean, 2)}</td>
        <td class="num"><b>${play.actual}</b></td>
        <td class="num"><span class="pick-result pick-result-${play.won ? "win" : "loss"}">${play.won ? "W" : "L"}</span></td>
        <td class="num ${play.won ? "tier-good" : "tier-bad"}">${signed(play.units, 2)}</td>
      </tr>`;
  });
  const dayCount = new Set(all.map((play) => play.date)).size;
  return `<div class="shots-detail-label shots-record-head">Graded plays <span class="muted-label">every play that declared an edge, at the price locked before puck drop; the latest ${dayCount} day${dayCount === 1 ? "" : "s"} with games</span></div>
    <div class="view-toggle shots-toolbar shots-record-buckets">${buttons}<span class="shots-record-total">${shown.length ? line(sum(shown)) : "none yet"}</span></div>
    ${shown.length ? `<div class="shots-record-scroll"><table class="data-table shots-record-table">
      <thead><tr><th class="shots-th-player">Player</th><th>Play</th><th>Bucket</th><th title="The model's chance minus the chance the price needed, in points">Edge</th><th title="Shots on goal the model expected">Proj</th><th title="His real shots on goal">Shots</th><th>Result</th><th title="Units won risking 1">Units</th></tr></thead>
      <tbody>${body}</tbody></table></div>` : `<p class="shots-record-note">No graded plays in this bucket yet.</p>`}`;
}
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const shown = gamesOn(date).filter((g) => boardFor(g) && (!gameId || g.game_id === gameId));
  const showResult = rows.some((x) => has(x.r.actual));
  const columns = COLUMNS.length + (showResult ? 1 : 0);
  if (!rows.length) {
    const one = shown.length === 1;
    // Nothing under "Lineup Confirmed" but there is under "All": say why, and offer the switch.
    const waiting = shotsView.lineup === "confirmed" && sortedRows(date, "all").length;
    el("shots-content").innerHTML = !shown.length
      ? `<p class="no-data-note">No projections for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.</p>`
      : waiting
        ? `<p class="no-data-note shots-waiting">${shown.every((g) => boardFor(g).locked)
            ? `No lineup was in for ${one ? "this game" : "these games"} before puck drop.`
            : `No lineup is in yet for ${one ? "this game" : "these games"}. The NHL posts each one around midday Eastern on game day, and the page picks it up at its next refresh.`} <button type="button" class="view-toggle-btn shots-filter-btn" data-filter="lineup" data-value="all">Show all players</button></p>`
        : `<p class="no-data-note">${shown.every((g) => boardFor(g).locked) ? `No shots-on-goal lines were saved for ${one ? "this game" : "these games"}.` : "No players match these filters. Shots-on-goal lines usually post the morning of the game."}</p>`;
    return;
  }
  const head = COLUMNS.map((c) => {
    const active = c.key && c.key === shotsView.sort;
    return `<th${c.key ? ` class="shots-sort${active ? " active" : ""}${c.cls ? ` ${c.cls}` : ""}" data-sort="${c.key}"` : c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${c.title}"` : ""}>${c.label}${active ? `<span class="shots-arrow">${shotsView.dir < 0 ? "&#9662;" : "&#9652;"}</span>` : ""}</th>`;
  }).join("");
  const body = rows
    .map((x, i) => {
      const r = x.r;
      const forward = positionGroup(r.pos) === "F";
      const open = shotsView.open === `${x.game.game_id}:${r.id}`;
      const who = `${headshot(x.season || {})}<span>${r.name}</span>`;
      // The first "check" play in the ranking starts its group.
      const divider = rankedByEdge() && needsCheck(x) && (i === 0 || !needsCheck(rows[i - 1])) ? `<tr class="group-gap"><td colspan="${columns}"></td></tr><tr class="group-row shots-check-head"><td colspan="${columns}">Not plays. A gap too big to take at face value (a handful of games against everything the market knows), or a play against tonight's line change.</td></tr>` : "";
      const row = `${divider}<tr class="shots-row${open ? " shots-open" : ""}" data-row="${x.game.game_id}:${r.id}">
        <td class="num shots-rank">${i + 1}</td>
        <td class="nba-player shots-player">${playerClick(r.id, who)}<span class="muted-label">${r.pos}</span><span class="shots-vs">${logo(r.team, 16)}<span class="at">${r.home ? "vs" : "@"}</span>${logo(r.opp, 16)}</span></td>
        ${lineCell(r)}
        <td class="shots-play-cell">${playChip(x.play, r)}</td>
        <td class="num" title="${r.games} game${r.games === 1 ? "" : "s"} this season">${has(r.avg) ? fmt(r.avg, 2) : "--"}</td>
        <td class="num shots-proj"><b>${fmt(r.mean, 2)}</b></td>
        <td class="num">${pct(x.play.chance, 0)}</td>
        <td class="num">${odds(fairPrice(x.play.chance)) || "--"}</td>
        ${edgeCell(x)}
        ${minutesCell(x)}
        ${liftCell(r.lift.opp, allowsTip(r.opp, "sog", "shots on goal"))}
        ${liftCell(r.lift.pos, allowsTip(r.opp, forward ? "f_sog" : "d_sog", forward ? "shots on goal to forwards" : "shots on goal to defensemen"))}
        ${liftCell(r.lift.area, `Where he shoots from against where ${r.opp} gives shots up. Click the row for the rink.`)}
        ${liftCell(r.lift.pp, `${pct(r.pp_share, 0)} of his shots come on the power play. ${allowsTip(r.opp, "pp_unb", "power-play shots")}`)}
        ${liftCell(siteLift(r), siteTip(r))}
        ${showResult ? actualCell(x) : ""}
      </tr>`;
      return row + (open ? detailRow(x, columns) : "");
    })
    .join("");
  el("shots-content").innerHTML = `<div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table">
      <thead><tr>${head}${showResult ? `<th title="His real shots on goal, and whether the play won">Result</th>` : ""}</tr></thead>
      <tbody>${body}</tbody>
    </table></div></div>`;
}
function renderNote() {
  const date = days()[dayIndex];
  const boards = gamesOn(date).map(boardFor).filter(Boolean);
  const locked = boards.filter((b) => b.locked).length;
  const g = currentGame();
  el("shots-title").innerHTML = `Shots on Goal${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((g) => boardFor(g) && !boardFor(g).locked);
  const lined = open.filter((g) => boardFor(g).posted).length;
  el("shots-lineups").hidden = !open.length;
  el("shots-lineups").textContent = !open.length
    ? ""
    : lined === open.length
      ? `Lineups are in for all ${open.length} games (the NHL's projected lineups).`
      : `Lineups are in for ${lined} of ${open.length} games. The NHL posts each game's projected lineup around midday Eastern; a game is marked in the strip above once its lineup is in. Until then its players are under All, projected from their recent ice time, with -- under Line.`;
  el("shots-locked").hidden = !locked;
  el("shots-locked").textContent = locked ? `${locked === boards.length ? "These games have" : `${locked} of these games have`} started: their projections and prices are the last ones from before puck drop.` : "";
}
function render() {
  if (!DATA) return;
  renderSchedule();
  renderToolbar();
  renderNote();
  renderRecord();
  renderTable();
  // Have the teams' player files on hand before a name is clicked.
  const g = currentGame();
  if (g) [g.away, g.home].forEach(loadTeamPlayers);
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  gameId = null;
  shotsView.open = null;
  render();
}

// The record lives in its own popup, opened by "YTD Model Performance" next to the title.
function showRecord(open) {
  el("shots-record-modal").hidden = !open;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") showRecord(false);
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#shots-record-open")) return showRecord(true);
  if (e.target.id === "shots-record-modal" || e.target.closest("#shots-record-modal .modal-close")) return showRecord(false);
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    shotsView.open = null;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const filter = e.target.closest(".shots-filter-btn");
  if (filter) {
    const value = filter.dataset.value;
    shotsView[filter.dataset.filter] = value === "true" ? true : value === "false" ? false : value;
    if (filter.dataset.filter !== "record") shotsView.open = null;
    return render();
  }
  const sort = e.target.closest(".shots-sort");
  if (sort) {
    if (shotsView.sort === sort.dataset.sort) shotsView.dir = -shotsView.dir;
    else Object.assign(shotsView, { sort: sort.dataset.sort, dir: -1 });
    return renderTable();
  }
  // A click on a row (anywhere but the name, which opens the player card) opens its detail.
  const row = e.target.closest(".shots-row");
  if (row && !e.target.closest(".player-click")) {
    shotsView.open = shotsView.open === row.dataset.row ? null : row.dataset.row;
    renderTable();
  }
});

Promise.all([
  loadNhlData(),
  fetch("shots.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
])
  .then(([, shots]) => {
    SHOTS = shots || { games: {}, defense: {} };
    // This page is this season only, so the player card opens on this season too
    // (its own switch still reaches last season).
    const all = days();
    // Open on today's slate if it has projections, else the first day that does.
    const today = new Date().toLocaleDateString("en-CA");
    const withBoard = (d) => gamesOn(d).some((g) => boardFor(g));
    const day = all.find((d) => d >= today && withBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    el("empty-state").hidden = true;
    el("shots-app").hidden = false;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
