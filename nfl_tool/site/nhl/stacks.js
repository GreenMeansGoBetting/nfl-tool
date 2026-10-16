// ---- GMG NHL Suite: Line Stacks (2-4 "1+ point" legs on teammates on the ice together) ----
// The owner, 2026-10-16: "points parlays from players on the ice together".
// No stack math lives here: the build (nfl_tool/nhl/stacks_model.py, written
// to stacks.json) sends every stack of a posted projected lineup with its
// chance, fair price, correlation and Score; the page draws, filters and
// sorts them. This season's numbers only, like every NHL prop tool.

let STACKS = null;
// The owner's SGP price log (/api/sgp-prices, D1): what each book charged for a stack.
let SGP = { stacks: {}, books: [] };
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
        <td class="num stk-actions">${stackCopyButton(s, x.board.players, g)}<button type="button" class="view-toggle-btn stk-log" data-log="${g.game_id}|${s.legs.join(",")}" title="Log what books charge for this stack (owner only)">Log price</button>${loggedChips(g, s)}</td>
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

// ---- the SGP price log (the owner's; /api/sgp-prices) ----
// Books price a parlay's correlation themselves, each its own way. The owner
// logs what they charge; the page shows it on the stack and, in the record
// popup, each book's markup over its own legs and its price against GMG fair.
const decimal = (price) => (price > 0 ? 1 + price / 100 : 1 + 100 / -price);
const sgpKey = (gameId, legs) => `${gameId}:${[...legs].map(String).sort().join(",")}`;
const BOOK_SHORT = { DraftKings: "DK", FanDuel: "FD", BetMGM: "MGM", Caesars: "CZR", Fanatics: "FAN", bet365: "365", BetRivers: "BR", "ESPN BET": "ESPN", "Hard Rock": "HR", Other: "Other" };
function loadSgp() {
  return fetch("/api/sgp-prices", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((got) => {
      SGP = got && got.stacks ? got : { stacks: {}, books: SGP.books };
      if (STACKS) render();
    });
}
// What the books charged, on the row: green = pays more than GMG fair, red = less.
function loggedChips(g, s) {
  const entry = SGP.stacks[sgpKey(g.game_id, s.legs)];
  if (!entry) return "";
  return `<div class="stk-logged">${entry.books
    .map((b) => {
      const better = decimal(b.price) > decimal(s.fair);
      return `<span class="stk-book ${better ? "tier-good" : "tier-bad"}" title="${b.book} SGP ${odds(b.price)}: ${better ? "pays more" : "pays less"} than GMG fair ${odds(s.fair)}">${BOOK_SHORT[b.book] || b.book} ${odds(b.price)}</span>`;
    })
    .join("")}</div>`;
}
let LOGGING = null; // {g, stack, players} while the form is open
function openLog(ref) {
  const [gameId, legs] = ref.split("|");
  const board = ((STACKS || {}).games || {})[gameId];
  const stack = board && board.stacks.find((x) => x.legs.join(",") === legs);
  if (!stack) return;
  const g = DATA.schedule.find((x) => x.game_id === gameId);
  LOGGING = { g, stack, players: board.players };
  const entry = SGP.stacks[sgpKey(gameId, stack.legs)];
  el("stk-log-title").textContent = stack.legs.map((p) => (board.players[p] || {}).name).join(" + ");
  el("stk-log-sub").textContent = `${kindName(stack.kind)} · ${g.away} @ ${g.home} · GMG fair ${odds(stack.fair)}`;
  el("stk-log-books").innerHTML = "";
  (entry ? entry.books : [null]).forEach(addLogBook);
  el("stk-log-error").textContent = "";
  el("stk-log-modal").hidden = false;
}
const priceText = (n) => (has(n) ? `${n > 0 ? "+" : ""}${n}` : "");
function addLogBook(book) {
  if (!LOGGING) return;
  const b = book && book.legs ? book : { book: "", price: null, legs: LOGGING.stack.legs.map(() => null) };
  const books = SGP.books && SGP.books.length ? SGP.books : Object.keys(BOOK_SHORT);
  const last = (p) => ((LOGGING.players[p] || {}).name || "").split(" ").slice(-1)[0];
  const line = document.createElement("div");
  line.className = "stk-log-book";
  line.innerHTML = `<select class="shots-filter-select stk-log-name"><option value="">Book</option>${books.map((n) => `<option${n === b.book ? " selected" : ""}>${n}</option>`).join("")}</select>
    <label>SGP <input class="stk-log-price" inputmode="numeric" placeholder="+250" value="${priceText(b.price)}"></label>
    ${LOGGING.stack.legs.map((p, i) => `<label>${last(p)} <input class="stk-log-leg" inputmode="numeric" placeholder="optional" value="${priceText(b.legs[i])}"></label>`).join("")}`;
  el("stk-log-books").appendChild(line);
}
function closeLog() {
  LOGGING = null;
  if (el("stk-log-modal")) el("stk-log-modal").hidden = true;
}
// "+250" / "-140" -> a number; blank -> null; anything else -> NaN.
const readOdds = (text) => {
  const clean = String(text).replace(/\s/g, "");
  if (clean === "") return null;
  const n = Number(clean);
  return Number.isInteger(n) && Math.abs(n) >= 100 ? n : NaN;
};
async function saveLog(clear) {
  if (!LOGGING) return;
  const { g, stack, players } = LOGGING;
  const books = [];
  for (const line of clear ? [] : el("stk-log-books").querySelectorAll(".stk-log-book")) {
    const book = line.querySelector(".stk-log-name").value;
    const price = readOdds(line.querySelector(".stk-log-price").value);
    const legs = [...line.querySelectorAll(".stk-log-leg")].map((i) => readOdds(i.value));
    if (!book && price === null) continue;
    if (!book || price === null || Number.isNaN(price) || legs.some(Number.isNaN) || books.some((b) => b.book === book)) {
      el("stk-log-error").textContent = "Each line needs a book (once) and an American price like +250 or -140; leg prices are optional.";
      return;
    }
    books.push({ book, price, legs });
  }
  const body = { game: g.game_id, date: g.date, legs: stack.legs, names: stack.legs.map((p) => players[p].name), kind: stack.kind, chance: stack.chance, indep: stack.indep, fair: stack.fair, books };
  const res = await fetch("/api/sgp-prices", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res || !res.ok) {
    el("stk-log-error").textContent = res && res.status === 403 ? "Only the owner can log prices." : "Couldn't save. Try again.";
    return;
  }
  closeLog();
  loadSgp();
}
// Each book's markup over its own legs (only lines with every leg priced) and
// its price against GMG fair (our chance x its payout - 1), overall and by stack type.
function bookMarkup() {
  const entries = Object.values(SGP.stacks || {});
  const label = `<div class="shots-detail-label">Book markup <span class="muted-label">from the SGP price log${entries.length ? `, ${entries.length} stacks` : ""}</span></div>`;
  if (!entries.length) return `${label}<p class="shots-record-note">No SGP prices logged yet. Log price on a stack records what each book charges, and builds each book's correlation markup by stack type here.</p>`;
  const groups = {};
  entries.forEach((e) =>
    e.books.forEach((b) => {
      const ev = e.chance * decimal(b.price) - 1;
      const own = b.legs.every(has) ? 1 / decimal(b.price) / b.legs.reduce((a, x) => a / decimal(x), 1) : null;
      [b.book, `${b.book}|${e.kind}`].forEach((k) => {
        const t = (groups[k] = groups[k] || { n: 0, ev: 0, own: 0, owned: 0 });
        t.n += 1;
        t.ev += ev;
        if (has(own)) {
          t.own += own;
          t.owned += 1;
        }
      });
    })
  );
  const books = Object.keys(groups).filter((k) => !k.includes("|")).sort((a, b) => groups[b].n - groups[a].n);
  const row = (name, t, sub) => `<tr${sub ? ' class="stk-markup-sub"' : ""}><td>${name}</td><td class="num">${t.n}</td>
    <td class="num" title="Its SGP price against its own legs multiplied: 1.20x = it prices the parlay 20% likelier than the legs alone">${t.owned ? `${fmt(t.own / t.owned, 2)}x` : "--"}</td>
    <td class="num ${t.ev >= 0 ? "tier-good" : "tier-bad"}" title="GMG's chance x the book's payout - 1, averaged: what its price is worth on our numbers">${signed((100 * t.ev) / t.n, 1)}%</td></tr>`;
  const body = books
    .map((b) => row(`<b>${b}</b>`, groups[b]) + Object.keys(groups).filter((k) => k.startsWith(`${b}|`)).map((k) => row(kindName(k.split("|")[1]), groups[k], true)).join(""))
    .join("");
  return `${label}<table class="data-table shots-ladder stk-markup"><thead><tr><th>Book</th><th>Prices</th><th title="SGP price against the book's own legs multiplied">Over its legs</th><th title="What its price is worth on GMG's numbers">vs GMG fair</th></tr></thead><tbody>${body}</tbody></table>`;
}

// ---- the record (the build grades it: stacks_record_summary) ----
function renderRecord() {
  const record = (STACKS || {}).record;
  const box = el("shots-results");
  const markup = bookMarkup();
  if (!record || !record.stacks) {
    box.innerHTML = `${markup}<p class="shots-record-note">The record starts with the first games that finish after this page went live: every stack shown, graded as locked before puck drop.</p>`;
    return;
  }
  const row = (label, b) => `<tr><td>${label}</td><td class="num">${b.stacks.toLocaleString()}</td><td class="num">${pct(b.said / b.stacks, 1)}</td><td class="num"><b>${pct(b.hit / b.stacks, 1)}</b></td></tr>`;
  const table = (title, rows) =>
    rows.length ? `<div class="shots-detail-label">${title}</div><table class="data-table shots-ladder"><thead><tr><th></th><th>Stacks</th><th title="The model's average chance">Said</th><th title="How often every leg got a point">Hit</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "";
  const honest = Object.entries(record.honest).flatMap(([n, bins]) => bins.filter((b) => b.stacks).map((b) => row(`${n} legs, said ${Math.round(b.lo * 100)}-${Math.min(100, Math.round(b.hi * 100))}%`, b)));
  box.innerHTML = `${markup}<p class="shots-record-note">${record.stacks.toLocaleString()} stacks graded in ${record.games} games (${record.since} to ${record.through}). A stack with a leg who didn't play isn't counted. No units yet: there is no free history of same-game parlay prices.</p>
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
  if (e.key === "Escape") {
    showRecord(false);
    closeLog();
  }
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
  const log = e.target.closest(".stk-log");
  if (log) return openLog(log.dataset.log);
  if (e.target.closest("#stk-log-add")) return addLogBook();
  if (e.target.closest("#stk-log-save")) return saveLog(false);
  if (e.target.closest("#stk-log-clear")) return saveLog(true);
  if (e.target.id === "stk-log-modal" || e.target.closest("#stk-log-modal .modal-close")) return closeLog();
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

loadSgp();
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
