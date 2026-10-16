// ---- GMG NHL Suite: Line Stacks (2-4 "1+ point" legs on teammates on the ice together) ----
// The owner, 2026-10-16: "points parlays from players on the ice together".
// No stack math lives here: the build (nfl_tool/nhl/stacks_model.py, written
// to stacks.json) sends every stack of a posted projected lineup with its
// chance, fair price, correlation and Score; the page draws, filters and
// sorts them. This season's numbers only, like every NHL prop tool.

let STACKS = null;
let dayIndex = 0;
let gameId = null;
const PAGE = 50; // stacks drawn before "Show more"
const stacksView = { kind: "all", legs: "all", sort: "score", when: "all", shown: PAGE };

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
const boardFor = (g) => ((STACKS || {}).games || {})[g.game_id] || null;
const kindName = (kind) => ((STACKS || {}).kinds || {})[kind] || kind;
function gameState(g) {
  const board = boardFor(g) || {};
  if (g.status === "final" || board.final) return "final";
  return board.locked || g.status === "live" || (g.start_utc && Date.now() >= Date.parse(g.start_utc)) ? "live" : "open";
}
const STATE_ORDER = { open: 0, live: 1, final: 2 };
const dayIsMixed = (date) => new Set(gamesOn(date).filter((g) => (boardFor(g) || {}).posted).map((g) => (gameState(g) === "open" ? "open" : "started"))).size === 2;

// ---- rows ----
const SORTS = {
  score: (x) => x.s.score,
  chance: (x) => x.s.chance,
  lift: (x) => x.s.lift,
  payout: (x) => -x.s.chance,
};
function rowsFor(date) {
  const rows = [];
  gamesOn(date).forEach((g) => {
    if (gameId && g.game_id !== gameId) return;
    const board = boardFor(g);
    if (!board || !board.stacks) return;
    board.stacks.forEach((s) => rows.push({ s, game: g, board, state: gameState(g) }));
  });
  return rows;
}
function sortedRows(date) {
  const get = SORTS[stacksView.sort] || SORTS.score;
  return rowsFor(date)
    .filter((x) => stacksView.kind === "all" || x.s.kind === stacksView.kind)
    .filter((x) => stacksView.legs === "all" || x.s.legs.length === Number(stacksView.legs))
    .filter((x) => !dayIsMixed(date) || stacksView.when === "all" || (stacksView.when === "open") === (x.state === "open"))
    .sort((a, b) => (a.state !== b.state ? STATE_ORDER[a.state] - STATE_ORDER[b.state] : get(b) - get(a) || b.s.chance - a.s.chance));
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
          : `<span class="shots-card-lineup" title="Stacks come from the NHL's projected lineup, usually posted around midday Eastern">No lineup yet</span>`;
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}${board ? "" : " shots-card-empty"}" data-game="${g.game_id}" title="${board ? "Show only this game (click again for the whole day)" : "No stacks for this game yet"}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
        ${lineup}
      </button>`;
    })
    .join("");
}
function renderToolbar() {
  const menu = (key, label, options, tip) =>
    `<label class="shots-menu"${tip ? ` title="${tip}"` : ""}><span>${label}</span><select class="shots-filter-select" data-filter="${key}">${options.map(([value, text]) => `<option value="${value}"${String(stacksView[key]) === String(value) ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
  const group = (key, options) =>
    `<span class="shots-filter">${options.map(([value, label, tip]) => `<button type="button" class="view-toggle-btn shots-filter-btn${String(stacksView[key]) === String(value) ? " active" : ""}" data-filter="${key}" data-value="${value}" title="${tip}">${label}</button>`).join("")}</span>`;
  el("shots-toolbar").innerHTML =
    menu("kind", "Stack", [["all", "All stack types"], ...Object.entries((STACKS || {}).kinds || {})]) +
    menu("legs", "Legs", [["all", "2, 3 and 4 legs"], ["2", "2 legs"], ["3", "3 legs"], ["4", "4 legs"]]) +
    menu("sort", "Sort", [["score", "Best score"], ["chance", "Best chance"], ["lift", "Most correlation"], ["payout", "Biggest payout"]]) +
    (dayIsMixed(days()[dayIndex])
      ? group("when", [
          ["all", "All games", "Every stack of the day: games still to come first, started games grayed underneath"],
          ["open", "Not started", "Only games that haven't started"],
          ["started", "Live / final", "Only games that have started: locked before puck drop"],
        ])
      : "");
}
function legNovig(p) {
  if (p.line === 0.5 && has(p.over)) return `<span class="stk-tag">Novig</span><span class="shots-play shots-play-ou shots-play-over stk-leg-price"><b>o0.5</b><span>${odds(p.over)}</span></span>`;
  return `<span class="stk-tag">Novig</span><span class="stk-noodds">${p.line === 1.5 ? "o1.5 only" : "no price"}</span>`;
}
function legLine(id, players) {
  const p = players[id] || {};
  const found = findPlayer(id);
  return `<div class="stk-leg">${playerClick(id, `${headshot((found && found.row) || {})}<span>${p.name}</span>`)}<span class="muted-label">${p.pos} &middot; ${stackSlotWords(p.slot)}</span>
    <span class="stk-leg-fair" title="GMG's fair price for him to get 1+ point"><span class="stk-tag">GMG fair</span><b>${odds(p.fair)}</b></span>${legNovig(p)}${has(p.actual) ? `<span class="stk-leg-actual${p.actual > 0 ? " tier-good" : " tier-bad"}">${p.actual} P</span>` : ""}</div>`;
}
function where(s) {
  if (s.kind === "pp_pair") return "First power-play unit";
  const [line, pair] = s.line.split("+");
  return `${stackSlotWords(line)}${pair ? ` + ${stackSlotWords(pair)}` : ""}`;
}
function resultCell(s) {
  if (!("hit" in s)) return "";
  return `<td class="num">${s.hit === null ? `<span class="muted-label" title="A leg didn't play">Void</span>` : s.hit ? `<span class="tier-good"><b>Hit</b></span>` : `<span class="tier-bad">Miss</span>`}</td>`;
}
function renderTable() {
  const date = days()[dayIndex];
  const rows = sortedRows(date);
  const shownGames = gamesOn(date).filter((g) => boardFor(g) && (!gameId || g.game_id === gameId));
  if (!rows.length) {
    const waiting = shownGames.length && shownGames.every((g) => !boardFor(g).posted);
    el("shots-content").innerHTML = !shownGames.length
      ? `<p class="no-data-note">No stacks for ${gameId ? "this game" : "this day"} yet. They are made for games in the next two days.</p>`
      : waiting
        ? `<p class="no-data-note shots-waiting">Stacks are made only from the NHL's projected lineup, and none is in yet for ${shownGames.length === 1 ? "this game" : "these games"}. The NHL posts each one around midday Eastern on game day; this page refreshes through the day.</p>`
        : `<p class="no-data-note">No stacks match these filters.</p>`;
    return;
  }
  const showResult = rows.some((x) => "hit" in x.s);
  const columns = 6 + (showResult ? 1 : 0);
  const body = rows
    .slice(0, stacksView.shown)
    .map((x, i) => {
      const s = x.s;
      const g = x.game;
      const prev = rows[i - 1];
      const divider =
        x.state !== "open" && i > 0 && prev.state !== x.state
          ? `<tr class="group-row shots-state-head"><td colspan="${columns}">${x.state === "live" ? "Live now: these games have started. The numbers are the last ones from before puck drop." : "Final: locked before puck drop and graded."}</td></tr>`
          : "";
      const [a, z] = s.team === g.home ? [g.home, g.away] : [g.away, g.home];
      return `${divider}<tr class="shots-row stk-row${x.state === "live" ? " shots-live" : ""}" data-state="${x.state}">
        <td class="num stk-score-cell">${stackScore(s)}</td>
        <td class="stk-legs">${s.legs.map((id) => legLine(id, x.board.players)).join("")}</td>
        <td class="stk-stack"><div class="stk-type">${kindName(s.kind)}</div><div class="stk-where">${where(s)} &middot; ${s.legs.length} legs</div>
          <div class="stk-game">${logo(a, 22)}<span class="at">${a === g.home ? "vs" : "@"}</span>${logo(z, 22)}<span>${g.status === "final" ? "Final" : fmtTime(g.time).replace(" ET", "")}</span></div></td>
        <td class="num"><div class="stk-fair-big">${odds(s.fair)}</div><div class="muted-label">${pct(s.chance, 1)}</div></td>
        <td class="num"><span class="stk-corr" title="How much more often these legs hit together than if they had nothing to do with each other">${fmt(s.lift, 1)}x</span><div class="muted-label stk-sub">Non-correlated ${odds(fairPrice(s.indep))}</div></td>
        <td class="num">${stackCopyButton(s, x.board.players, g)}</td>
        ${showResult ? resultCell(s) : ""}
      </tr>
      <tr class="stk-copyline"><td></td><td colspan="${columns - 1}"><span class="stk-tag">Copy puts this on your clipboard:</span> <code>${stackCopyText(s, x.board.players, g)}</code></td></tr>`;
    })
    .join("");
  const more = rows.length > stacksView.shown ? `<p class="stk-more"><button type="button" class="view-toggle-btn" id="stk-more">Show ${Math.min(PAGE, rows.length - stacksView.shown)} more</button> <span class="muted-label">${stacksView.shown} of ${rows.length} stacks shown</span></p>` : "";
  el("shots-content").innerHTML = `<div class="nba-box shots-box"><div class="shots-scroll"><table class="data-table shots-table stk-table">
      <thead><tr><th class="num" title="${STACK_SCORE_TIP}">Score</th><th>Legs (1+ point each)</th><th>Stack</th><th class="num" title="GMG's fair price for every leg hitting (no cut), with the chance under it">Fair</th><th class="num" title="How much more often the legs hit together than if they had nothing to do with each other">Correlation</th><th></th>${showResult ? `<th title="Hit = every leg got a point; Void = a leg didn't play">Result</th>` : ""}</tr></thead>
      <tbody>${body}</tbody>
    </table></div></div>${more}`;
}
const fairPrice = (p) => (!has(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));

// ---- the record (the build grades it: stacks_record_summary) ----
function renderRecord() {
  const record = (STACKS || {}).record;
  const box = el("shots-results");
  if (!record || !record.stacks) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first games that finish after this page went live: every stack shown, graded as locked before puck drop.</p>`;
    return;
  }
  const row = (label, b) => `<tr><td>${label}</td><td class="num">${b.stacks.toLocaleString()}</td><td class="num">${pct(b.said / b.stacks, 1)}</td><td class="num"><b>${pct(b.hit / b.stacks, 1)}</b></td></tr>`;
  const table = (title, rows) =>
    rows.length ? `<div class="shots-detail-label">${title}</div><table class="data-table shots-ladder"><thead><tr><th></th><th>Stacks</th><th title="The model's average chance">Said</th><th title="How often every leg got a point">Hit</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "";
  const honest = Object.entries(record.honest).flatMap(([n, bins]) => bins.filter((b) => b.stacks).map((b) => row(`${n} legs, said ${Math.round(b.lo * 100)}-${Math.min(100, Math.round(b.hi * 100))}%`, b)));
  box.innerHTML = `<p class="shots-record-note">${record.stacks.toLocaleString()} stacks graded in ${record.games} games (${record.since} to ${record.through}). A stack with a leg who didn't play isn't counted. No units yet: there is no free history of same-game parlay prices.</p>
    ${table("By Score", record.scores.filter((b) => b.stacks).map((b) => row(b.band, b)))}
    ${table("By stack type", Object.entries(record.kinds).filter(([, b]) => b.stacks).map(([k, b]) => row(kindName(k), b)))}
    ${table("Said vs hit", honest)}`;
}
function renderNote() {
  const date = days()[dayIndex];
  const g = currentGame();
  el("shots-title").innerHTML = `Line Stacks${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const open = gamesOn(date).filter((g) => boardFor(g) && !boardFor(g).locked);
  const lined = open.filter((g) => boardFor(g).posted).length;
  el("shots-lineups").hidden = !open.length;
  el("shots-lineups").textContent = open.length ? `Lineups are in for ${lined} of ${open.length} games. Stacks are made only from the NHL's projected lineup and fill in through the day.` : "";
  const locked = gamesOn(date).filter((g) => (boardFor(g) || {}).locked).length;
  el("shots-locked").hidden = !locked;
  el("shots-locked").textContent = locked ? `${locked} of these games have started: their stacks are the last ones from before puck drop.` : "";
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
  dayIndex = Math.max(0, Math.min(days().length - 1, i));
  gameId = null;
  stacksView.shown = PAGE;
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
  stacksView[menu.dataset.filter] = menu.value;
  stacksView.shown = PAGE;
  render();
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#shots-record-open")) return showRecord(true);
  if (e.target.id === "shots-record-modal" || e.target.closest("#shots-record-modal .modal-close")) return showRecord(false);
  if (e.target.closest("#stk-more")) {
    stacksView.shown += PAGE;
    return renderTable();
  }
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = gameId === card.dataset.game ? null : card.dataset.game;
    stacksView.shown = PAGE;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const filter = e.target.closest(".shots-filter-btn");
  if (filter) {
    stacksView[filter.dataset.filter] = filter.dataset.value;
    return render();
  }
});

fetch("stacks.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((stacks) => Promise.all([loadNhlData(), stacks]))
  .then(([, stacks]) => {
    STACKS = stacks || { games: {} };
    const all = days();
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
