// Every US book's price (SmartStake, book_odds in data.json / nhl/data.json;
// build side in nfl_tool/smartstake.py). Wherever a price shows,
// bookPricePill() swaps in the best price across the member's books; clicking
// it lists every book, best to worst, with a Bet link.
// Play / Pass tags come ONLY from our own model (the owner: "we aren't top-down
// betting, we're finding an edge from our own number"): a caller passes
// spec.model = {"side|line": the model's chance} and spec.edges (the page's own
// thresholds). The edge is the page's measure: the model's chance minus the
// chance the price needs to break even, in points. With no model number (the
// NFL pop-ups) the list just ranks the books; there is no market "fair" price.
// Saving a price (spec.save, NBA First Basket since 2026-10-21): each book's
// price becomes a button that saves the play at that book and price; the
// page provides window.bookPlaySaver {saved(entry) -> saved play or null,
// toggle(entry, book, odds)}. spec.oneSide: a yes-only market (no other side
// tab); spec.noLine: no Line column.
// My Books (books a member hides) and the book names live in sync.js, with
// the rest of the Settings window; prices show in the member's odds format
// (showOdds, sync.js).

const BOOK_NAMES = GMG_BOOKS;
const BOOK_INITIALS = {
  draftkings: "DK", fanduel: "FD", betmgm: "MGM", caesars: "CZ", fanatics: "FAN", bet365: "365", thescore: "SC",
  betrivers: "BR", hard_rock: "HR", bally_bet: "BAL", circa: "CIR", pinnacle: "PIN", novig: "NV", prophetx: "PX",
  kalshi: "KAL", polymarket_us: "PM", fliff: "FL", "4cx": "4CX", underdog_dfs: "UD",
};
// Own helpers: the NHL pages load this file without the NFL's common.js.
const boNorm = (n) => (n || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const boEnc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const boDec = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));
const boOdds = (n) => (n === null || n === undefined ? "--" : showOdds(n));
const boNum = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
const bookHidden = (book) => (myBooks().hidden || []).includes(book);

const oddsDecimal = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);
const oddsProb = (o) => 1 / oddsDecimal(o);
const probToAmerican = (p) => (p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
const OPPOSITE_SIDE = { o: "u", u: "o", away: "home", home: "away" };

// The game a team plays in the book odds; gameKey ("AWAY_HOME") picks one
// when the schedule holds more than one (the NHL lists yesterday's too).
function bookGameFor(team, gameKey) {
  const all = (typeof DATA !== "undefined" && DATA && DATA.book_odds) || {};
  const key = gameKey && all[gameKey] ? gameKey : Object.keys(all).find((k) => k.split("_").includes(team));
  return key ? { key, game: all[key] } : null;
}

// spec: {kind: "prop"|"td"|"ml"|"spread"|"total", team, name? or pid?, stat?}
function bookQuotes(spec) {
  const found = bookGameFor(spec.team, spec.game);
  if (!found) return [];
  const g = found.game;
  const who = spec.pid !== undefined && spec.pid !== null ? String(spec.pid) : boNorm(spec.name);
  if (spec.kind === "prop") return ((g.props || {})[spec.stat] || {})[who]?.q || [];
  if (spec.kind === "td") return (g.td || {})[who]?.q || [];
  return (g.lines || {})[spec.kind] || [];
}

// The two sides of one bet at one line (a spread's other side is the minus line).
const sameBet = (q, side, line) => q[1] === side && (line === null || line === undefined || q[2] === line);
const otherLine = (side, line) => (line === null || line === undefined ? line : side === "away" || side === "home" ? -line : line);

// Our model's chance for this side at this line, or null (no model, or no
// number at that line).
function bookModelChance(spec, side, line) {
  const chance = (spec.model || {})[`${side}|${line}`];
  return chance === undefined || chance === null ? null : chance;
}

// Pick'em apps: in every list, never the best price (a leg can't be bet alone).
const BO_PICKEM = ["underdog_dfs"];
function bookBest(quotes, side, line) {
  return quotes
    .filter((q) => sameBet(q, side, line) && !bookHidden(q[0]) && !BO_PICKEM.includes(q[0]))
    .sort((a, b) => oddsDecimal(b[3]) - oddsDecimal(a[3]))[0] || null;
}

// The page's own edge (points of chance over the price's break-even) and its
// tag: CHECK from the page's "check" size (look for news first), PLAY from its
// smallest play, PASS below that.
function bookTag(spec, chance, odds) {
  if (chance === null) return null;
  const edges = spec.edges || { lean: 0.03, check: 0.12 };
  const edge = chance - oddsProb(odds);
  const kind = edge >= edges.check ? "check" : edge >= edges.lean ? "play" : "pass";
  return { kind, edge };
}

// The clickable best price, or "" when no book has this bet (callers keep
// their own price then). spec adds side, line, title, sub.
function bookPricePill(spec) {
  const quotes = bookQuotes(spec);
  const best = bookBest(quotes, spec.side, spec.line);
  if (!best) return "";
  const tag = bookTag(spec, bookModelChance(spec, spec.side, spec.line), best[3]);
  return `<button type="button" class="bo-pill${tag && tag.kind !== "pass" ? ` bo-${tag.kind}` : ""}" data-bo="${boEnc(spec)}" title="Best price across your books. Click for every book.">${boOdds(best[3])} <small>${BOOK_NAMES[best[0]] || best[0]}</small></button>`;
}

function bookSideLabel(spec, side, atLine) {
  const line = atLine !== undefined ? atLine : side === spec.side ? spec.line : otherLine(spec.side, spec.line);
  if (spec.labels && spec.labels[side] && line === spec.labelLine) return spec.labels[side];
  if (side === "o" || side === "u") return `${side === "o" ? "Over" : "Under"}${line !== null && line !== undefined ? ` ${boNum(line)}` : ""}`;
  const found = bookGameFor(spec.team, spec.game);
  const [away, home] = found ? found.key.split("_") : ["Away", "Home"];
  const team = side === "away" ? away : home;
  return spec.kind === "spread" ? `${team} ${line > 0 ? "+" : ""}${boNum(line)}` : team;
}

function renderBookOdds(spec) {
  const quotes = bookQuotes(spec);
  const modelOn = !!spec.model;
  const saver = spec.save && window.bookPlaySaver;
  const savedPlay = saver ? saver.saved(spec.save) : null;
  const lineCol = !spec.noLine;
  const chance = bookModelChance(spec, spec.side, spec.line);
  const rows = quotes.filter((q) => q[1] === spec.side && !bookHidden(q[0])).sort((a, b) => oddsDecimal(b[3]) - oddsDecimal(a[3]));
  const main = rows.filter((q) => sameBet(q, spec.side, spec.line));
  const others = rows.filter((q) => !sameBet(q, spec.side, spec.line));
  const row = (q, i, alt) => {
    const tag = modelOn ? bookTag(spec, bookModelChance(spec, q[1], q[2]), q[3]) : null;
    const tagCell = tag
      ? `<span class="bo-tag bo-${tag.kind}">${tag.kind}<small>${tag.edge >= 0 ? "+" : "&minus;"}${Math.abs(tag.edge * 100).toFixed(1)}</small></span>`
      : modelOn ? '<span class="bo-tag bo-muted">No model line</span>' : "";
    const lineText = q[2] !== null && q[2] !== undefined ? bookSideLabel(spec, q[1], q[2]) : "";
    const link = q[4] ? `<a class="bo-bet" href="${q[4]}" target="_blank" rel="noopener">Bet &rsaquo;</a>` : "";
    const isSaved = savedPlay && savedPlay.book === q[0] && Number(savedPlay.odds) === q[3];
    const odds = saver
      ? `<button type="button" class="bo-save${isSaved ? " bo-saved" : ""}" data-bo-save="${boEnc({ book: q[0], odds: q[3] })}" title="${isSaved ? "Saved: click to remove it from My Plays" : "Save to My Plays at this price"}">${boOdds(q[3])}${isSaved ? " <small>Saved</small>" : ""}</button>`
      : boOdds(q[3]);
    return `<tr class="${!alt && i === 0 ? "bo-best" : ""}${alt ? " bo-alt" : ""}"><td><div class="bo-book"><span class="bo-ini">${BOOK_INITIALS[q[0]] || "?"}</span><span>${BOOK_NAMES[q[0]] || q[0]}${alt ? `<small class="bo-alt-line">${lineText}</small>` : ""}</span>${!alt && i === 0 ? ' <span class="bo-bestchip">BEST</span>' : ""}</div></td>
      ${lineCol ? `<td class="bo-line">${lineText}</td>` : ""}<td class="bo-odds">${odds}</td>${modelOn ? `<td>${tagCell}</td>` : ""}<td class="bo-go">${link}</td></tr>`;
  };
  const TAB_ORDER = ["o", "u", "away", "home"];
  const sides = spec.kind === "td" || spec.oneSide ? [spec.side] : [spec.side, OPPOSITE_SIDE[spec.side]].sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b));
  const tabs = sides.length > 1
    ? `<div class="bo-tabs">${sides.map((s) => `<button type="button" class="bo-tab${s === spec.side ? " bo-on" : ""}" data-bo="${boEnc({ ...spec, side: s, line: s === spec.side ? spec.line : otherLine(spec.side, spec.line) })}">${bookSideLabel(spec, s)}</button>`).join("")}</div>`
    : "";
  const hidden = myBooks().hidden || [];
  const color = spec.color || (typeof TEAM_COLORS !== "undefined" && TEAM_COLORS[spec.team]) || "var(--accent)";
  const cols = (modelOn ? 5 : 4) - (lineCol ? 0 : 1);
  const saveNote = !saver ? "" : `<p class="bo-save-note">${savedPlay
    ? `Saved to My Plays at <b>${boOdds(Number(savedPlay.odds))}</b> (${BOOK_NAMES[savedPlay.book] || savedPlay.book}). Click another price to switch, or the same one to remove it.`
    : "Click a price to save it to <b>My Plays</b>."}</p>`;
  const modelBox = !modelOn ? "" : chance !== null
    ? `<div class="bo-fair"><div><div class="bo-lbl">GMG model</div><div class="bo-big">${(chance * 100).toFixed(0)}%</div></div><div><div class="bo-lbl">Its price</div><div class="bo-big">${boOdds(probToAmerican(chance))}</div></div><div class="bo-src">Tags: the model's chance minus<br>what each price needs, in points</div></div>`
    : `<div class="bo-fair"><div class="bo-src bo-src-left">The model has no number for this line, so these prices aren't tagged.</div></div>`;
  return `<div class="bo-banner" style="--bo-team:${color}"><h3>${spec.title}</h3><div class="bo-sub">${spec.sub || ""}${spec.sub ? " &middot; " : ""}${main.length + others.length} books</div></div>
    ${tabs}
    ${modelBox}
    ${saveNote}
    ${main.length || others.length ? `<table class="bo-table${modelOn ? "" : " bo-plain"}"><thead><tr><th>Book</th>${lineCol ? "<th>Line</th>" : ""}<th>Odds</th>${modelOn ? "<th>vs our model</th>" : ""}<th></th></tr></thead><tbody>
      ${main.map((q, i) => row(q, i, false)).join("")}
      ${others.length && !spec.collapseOthers ? `<tr class="bo-group"><td colspan="${cols}">Other lines</td></tr>${others.map((q) => row(q, 1, true)).join("")}` : ""}
      ${others.length && spec.collapseOthers ? `<tr class="bo-group bo-others-toggle"><td colspan="${cols}"><button type="button" class="bo-others-btn" data-bo-others aria-expanded="false">Show Other Lines (${others.length})</button></td></tr>` : ""}
    </tbody>${others.length && spec.collapseOthers ? `<tbody class="bo-others" hidden>${others.map((q) => row(q, 1, true)).join("")}</tbody>` : ""}</table>` : '<p class="no-data-note">None of your books has this bet right now.</p>'}
    <div class="bo-foot"><span>${hidden.length ? `${hidden.length} book${hidden.length === 1 ? "" : "s"} hidden (${hidden.map((b) => BOOK_NAMES[b] || b).join(", ")})` : ""}</span><a href="#" class="bo-edit-books">Edit my books &rsaquo;</a></div>`;
}

// The same list inside a page (the NHL Shots / Goals open rows): "" when no
// book has the bet; its Over / Under tabs switch in place.
function bookOddsPanel(spec) {
  const quotes = bookQuotes(spec);
  if (!quotes.length) return "";
  if ((spec.line === null || spec.line === undefined) && spec.kind === "prop") {
    const count = {};
    quotes.filter((q) => q[1] === spec.side).forEach((q) => (count[q[2]] = (count[q[2]] || 0) + 1));
    const common = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (common !== undefined) spec = { ...spec, line: Number(common) };
  }
  return `<div class="bo-panel">${renderBookOdds(spec)}</div>`;
}
function refreshBookPanels() {
  document.querySelectorAll(".bo-panel").forEach((panel) => {
    const tab = panel.querySelector(".bo-tab.bo-on");
    if (tab) panel.innerHTML = renderBookOdds(boDec(tab.dataset.bo));
  });
}

function ensureBookModal(id) {
  let overlay = document.getElementById(id);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = id;
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = '<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div class="bo-content"></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".modal-close")) overlay.hidden = true;
  });
  return overlay;
}

let bookOddsOpen = null;
function openBookOdds(spec) {
  bookOddsOpen = spec;
  const overlay = ensureBookModal("book-odds-modal");
  overlay.querySelector(".bo-content").innerHTML = renderBookOdds(spec);
  overlay.hidden = false;
}

document.addEventListener("click", (e) => {
  // "Show Other Lines" (spec.collapseOthers: NBA Points, 2026-10-23): main lines only until asked.
  const others = e.target.closest("[data-bo-others]");
  if (others) {
    e.stopPropagation();
    const body = others.closest("table").querySelector(".bo-others");
    const open = body.hidden;
    body.hidden = !open;
    others.setAttribute("aria-expanded", String(open));
    others.textContent = others.textContent.replace(open ? "Show" : "Hide", open ? "Hide" : "Show");
    return;
  }
  const save = e.target.closest(".bo-save");
  if (save && bookOddsOpen && window.bookPlaySaver) {
    e.preventDefault();
    e.stopPropagation();
    const { book, odds } = boDec(save.dataset.boSave);
    window.bookPlaySaver.toggle(bookOddsOpen.save, book, odds);
    openBookOdds(bookOddsOpen);
    return;
  }
  const pill = e.target.closest(".bo-pill, .bo-tab");
  if (pill) {
    e.preventDefault();
    e.stopPropagation();
    const panel = pill.closest(".bo-panel");
    if (panel) {
      panel.innerHTML = renderBookOdds(boDec(pill.dataset.bo));
      return;
    }
    openBookOdds(boDec(pill.dataset.bo));
    return;
  }
  if (e.target.closest(".bo-edit-books")) {
    e.preventDefault();
    const odds = document.getElementById("book-odds-modal");
    if (odds) odds.hidden = true;
    window.GMGSettings?.open("books");
  }
}, true); // capture: the player card stops clicks inside it from bubbling
document.addEventListener("my-books-changed", refreshBookPanels);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const el = document.getElementById("book-odds-modal");
  if (el) el.hidden = true;
});
