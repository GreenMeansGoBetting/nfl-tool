// ---- GMG NHL Suite: Shots ----
// Every skater on the day's slate ranked by shots-on-goal value: the model's
// projection (nfl_tool/nhl/shots_model.py, written to shots.json by the
// build) next to Novig's line. The data, helpers, rink drawing and the
// player card are in nhl-common.js (loaded first); this file is the page.
// No shot math lives here: the build sends each player's chance of 1+, 2+ ...
// shots, and the page only compares those with the prices.

let SHOTS = null;
let dayIndex = 0;
let gameId = null; // one game picked in the strip, or null for the whole day
const shotsView = { side: "best", pos: "all", lined: true, sort: "edge", dir: -1, open: null };

// An edge is the model's chance minus the chance the price needs to break
// even. The sizes that matter come from the build (SHOTS_EDGES in
// build_nhl.py, which grades the record by the same ones): a play is colored
// from "lean"; at "check" the gap is more often news the model can't see (a
// line change, a scratch) than a gift. Those plays are never hidden: they are
// marked, and in the best-to-worst ranking they sit in their own group under
// the rest.
const edgeAt = (size) => ((SHOTS || {}).edges || { lean: 0.03, strong: 0.06, check: 0.12 })[size];
const needsCheck = (x) => !!x.play && x.play.edge >= edgeAt("check");
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
// carries the model's chance, the price, and the edge at that price.
function sidesFor(r, market) {
  const sides = {};
  if (!market || !has(market.line)) return sides;
  const over = chanceOver(r, market.line);
  if (!has(over)) return sides;
  if (has(market.over)) sides.over = { side: "over", line: market.line, price: market.over, chance: over, edge: over - breakEven(market.over) };
  if (has(market.under)) sides.under = { side: "under", line: market.line, price: market.under, chance: 1 - over, edge: 1 - over - breakEven(market.under) };
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
// His line on the page's data (this season, with last season riding along as .prev).
function seasonLine(id) {
  const found = findPlayer(id);
  return found ? found.row : null;
}
const SORTS = {
  edge: (x) => (x.play ? x.play.edge : null),
  proj: (x) => x.r.mean,
  chance: (x) => (x.play ? x.play.chance : null),
  usual: (x) => x.r.usual,
  minutes: (x) => x.r.minutes,
  sog: (x) => (x.season ? x.season.sog_pg : null),
  opp: (x) => x.r.lift.opp,
  pos: (x) => x.r.lift.pos,
  area: (x) => x.r.lift.area,
  pp: (x) => x.r.lift.pp,
  site: (x) => siteLift(x.r),
};
// Home ice and rest, the two pieces that are about the night, not the opponent.
const siteLift = (r) => r.lift.home * r.lift.b2b * r.lift.opp_b2b;
// The ranking as first opened (best edge first) keeps the "check" plays
// apart: the believable plays, then the "check" group, then anyone with no line.
const rankedByEdge = () => shotsView.sort === "edge" && shotsView.dir < 0;
const rankGroup = (x) => (!x.play ? 2 : needsCheck(x) ? 1 : 0);
function sortedRows(date) {
  const get = SORTS[shotsView.sort] || SORTS.edge;
  return rowsFor(date)
    .filter((x) => !x.r.out)
    .filter((x) => shotsView.pos === "all" || positionGroup(x.r.pos) === shotsView.pos)
    .filter((x) => !shotsView.lined || x.play)
    .sort((a, b) => {
      if (rankedByEdge() && rankGroup(a) !== rankGroup(b)) return rankGroup(a) - rankGroup(b);
      const [va, vb] = [get(a), get(b)];
      // Rows with nothing to sort on (no line) sink, whichever way the sort runs.
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
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}${boardFor(g) ? "" : " shots-card-empty"}" data-game="${g.game_id}" data-away="${g.away}" data-home="${g.home}" title="${boardFor(g) ? "Show only this game (click again for the whole day)" : "No projections for this game yet"}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
      </button>`;
    })
    .join("");
}
function renderToolbar() {
  const group = (key, options) =>
    `<span class="shots-filter">${options.map(([value, label]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(shotsView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}">${label}</button>`).join("")}</span>`;
  el("shots-toolbar").innerHTML =
    group("side", [["best", "Best side"], ["over", "Overs"], ["under", "Unders"]]) +
    group("pos", [["all", "All skaters"], ["F", "Forwards"], ["D", "Defense"]]) +
    group("lined", [[true, "With a line"], [false, "Everyone"]]);
}
function playChip(play) {
  if (!play) return `<span class="shots-noline">No line</span>`;
  return `<span class="shots-play shots-play-${play.side}"><b>${play.side === "over" ? "Over" : "Under"} ${fmt(play.line)}</b><span>${odds(play.price)}</span></span>`;
}
function edgeCell(x) {
  const play = x.play;
  if (!play) return `<td class="num muted-label">--</td>`;
  const edge = play.edge;
  const thin = x.book.sog && x.book.sog.thin;
  const lean = edgeAt("lean");
  const cls = edge >= lean ? "tier-good" : "";
  const alpha = edge >= lean ? ` style="--tier-a:${Math.min(0.34, 0.08 + (edge - lean) * 3).toFixed(2)}"` : "";
  const flag = needsCheck(x) ? `<span class="shots-flag" title="A gap this big usually means news the model can't see: a line change, a scratch, a new role. Check before you bet.">check</span>` : thin ? `<span class="shots-flag" title="Barely traded on Novig: treat the price with care">thin</span>` : "";
  return `<td class="num shots-edge ${cls}"${alpha} title="The model's ${Math.round(play.chance * 100)}% minus the ${Math.round(breakEven(play.price) * 100)}% this price needs to break even">${points(edge)}${flag}</td>`;
}
function minutesCell(x) {
  const s = x.season;
  const trend = s && has(s.toi) ? x.r.minutes - s.toi : 0;
  const tip = s ? `Season ${fmt(s.toi)} min a game, last five ${fmt(s.l5_toi)}${s.prev ? `, last season ${fmt(s.prev.toi)}` : ""}` : "";
  const arrow = trend >= MINUTES_TREND ? `<small class="shots-up">&#9650;</small>` : trend <= -MINUTES_TREND ? `<small class="shots-down">&#9660;</small>` : "";
  return `<td class="num" title="${tip}">${fmt(x.r.minutes)}${arrow}</td>`;
}
function liftCell(lift, tip) {
  return `<td class="num shots-lift ${liftTier(lift)}" title="${tip}">${liftText(lift)}</td>`;
}
function allowsTip(opp, key, what) {
  const d = ((SHOTS.defense || {})[opp] || {})[key];
  if (!d) return "";
  return `${opp} allows ${fmt(d.blend)} ${what} a game (${ordinal(d.rank)} most; the league allows ${fmt(d.league)}). This season ${fmt(d.season)}, last season ${fmt(d.prev)}.`;
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
  const build = `<div class="shots-build">
      <span class="shots-step shots-step-end" title="His own shot rate in the minutes he should play tonight, against an average defense"><small>His usual</small><b>${fmt(r.usual, 2)}</b></span>
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
  const ladder = rungs.length
    ? `<table class="data-table shots-ladder"><thead><tr><th>Shots on goal</th><th title="The model's chance">Model</th><th title="The price with no cut at which the model's chance breaks even">Fair price</th><th>Novig</th><th title="The model's chance minus the chance the price needs to break even, in points">Edge</th></tr></thead><tbody>${rungs.join("")}</tbody></table>`
    : `<p class="no-data-note">No shots-on-goal line posted for him.</p>`;

  const tile = (label, key) => {
    const d = defense[key];
    if (!d) return "";
    const tier = d.factor - 1 >= LIFT_CALL ? "tier-good" : d.factor - 1 <= -LIFT_CALL ? "tier-bad" : "";
    return `<div class="nba-tile ${tier}" title="This season ${fmt(d.season)}, last season ${fmt(d.prev)}; the league allows ${fmt(d.league)}"><div class="gs-tile-label">${label}</div><b>${fmt(d.blend)}</b><small>${ordinal(d.rank)} most</small></div>`;
  };
  const tiles = `<div class="nba-tiles shots-allows">${tile("Shots on goal allowed", "sog")}${tile(forward ? "To forwards" : "To defensemen", forward ? "f_sog" : "d_sog")}${tile("Power-play shots allowed", "pp_unb")}</div>`;

  // The rink reads both sides: a zone is colored only where he actually
  // shoots from AND the defense clearly allows more (or fewer) than the league.
  const rink = rinkSvg(`shots-rink-${r.id}`, `Where ${r.name} shoots from against what ${r.opp} allows`, (z) => {
    const share = r.shares[z.key] || 0;
    const d = defense[`a_${z.key}`];
    const tilt = d ? d.factor - 1 : 0;
    const matters = !z.small && share >= 0.15;
    return {
      cls: matters && tilt >= 0.05 ? "nhl-zone-more" : matters && tilt <= -0.05 ? "nhl-zone-fewer" : "",
      big: pct(share, 0),
      small: d ? `${r.opp} ${tilt >= 0 ? "+" : ""}${Math.round(tilt * 100)}%` : "",
      tip: `${z.label}: ${pct(share, 0)} of his shots. ${d ? `${r.opp} allows ${fmt(d.blend)} a game from here (${ordinal(d.rank)} most; the league allows ${fmt(d.league)}).` : ""}`,
    };
  });
  return `<tr class="shots-detail"><td colspan="${columns}">
      <div class="shots-detail-grid">
        <div class="shots-detail-main">
          <div class="shots-detail-label">How tonight's number is built</div>${build}
          <div class="shots-detail-label">${logo(r.opp, 16)} ${r.opp} defense <span class="muted-label">this season blended with last</span></div>${tiles}
          <div class="shots-detail-label">Every line, at the model's fair price</div>${ladder}
        </div>
        <div class="shots-detail-rink">
          <div class="shots-detail-label">Where he shoots <span class="muted-label">and what ${r.opp} allows there vs the league</span></div>${rink}
        </div>
      </div>
    </td></tr>`;
}

const COLUMNS = [
  { key: null, label: "#" },
  { key: null, label: "Player", cls: "shots-th-player" },
  { key: null, label: "Play", title: "The side of his main line the model likes more, at Novig's price" },
  { key: "proj", label: "Proj", title: "Shots on goal the model expects tonight" },
  { key: "chance", label: "Model", title: "The model's chance the play wins" },
  { key: null, label: "Fair", title: "The price with no cut at which that chance breaks even" },
  { key: "edge", label: "Edge", title: "The model's chance minus the chance the price needs to break even, in points. Green from 3 points; from 12 it is set apart to be checked for news." },
  { key: "usual", label: "Usual", title: "His own shot rate in tonight's minutes against an average defense: what he would project for with no matchup" },
  { key: "minutes", label: "Min", title: "Ice time the model expects tonight, from his recent games. An arrow means a minute or more above or below his season average." },
  { key: "sog", label: "SOG/g", title: "Shots on goal a game this season" },
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
    </div>`;
}
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const anyBoard = gamesOn(date).some((g) => boardFor(g));
  const showResult = rows.some((x) => has(x.r.actual));
  const columns = COLUMNS.length + (showResult ? 1 : 0);
  if (!rows.length) {
    el("shots-content").innerHTML = `<p class="no-data-note">${anyBoard ? "No players match these filters. Lines usually post the morning of the game: try Everyone." : "No projections for this day yet. They are made for games in the next two days."}</p>`;
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
      const divider = rankedByEdge() && needsCheck(x) && (i === 0 || !needsCheck(rows[i - 1])) ? `<tr class="group-gap"><td colspan="${columns}"></td></tr><tr class="group-row shots-check-head"><td colspan="${columns}">Gap too big to take at face value: look for news first (a line change, a scratch, a new role)</td></tr>` : "";
      const row = `${divider}<tr class="shots-row${open ? " shots-open" : ""}" data-row="${x.game.game_id}:${r.id}">
        <td class="num shots-rank">${i + 1}</td>
        <td class="nba-player shots-player">${playerClick(r.id, who)}<span class="muted-label">${r.pos}</span><span class="shots-vs">${logo(r.team, 16)}<span class="at">${r.home ? "vs" : "@"}</span>${logo(r.opp, 16)}</span></td>
        <td class="shots-play-cell">${playChip(x.play)}</td>
        <td class="num shots-proj"><b>${fmt(r.mean, 2)}</b></td>
        <td class="num">${x.play ? pct(x.play.chance, 0) : "--"}</td>
        <td class="num">${x.play ? odds(fairPrice(x.play.chance)) || "--" : "--"}</td>
        ${edgeCell(x)}
        <td class="num">${fmt(r.usual, 2)}</td>
        ${minutesCell(x)}
        <td class="num"${x.season && x.season.prev ? ` title="Last season ${fmt(x.season.prev.sog_pg)} a game in ${x.season.prev.games} games"` : ""}>${x.season ? fmt(x.season.sog_pg) : "--"}</td>
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

document.addEventListener("click", (e) => {
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
    shotsView.open = null;
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
