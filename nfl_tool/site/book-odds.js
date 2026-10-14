// Every US book's price (SmartStake, data.json book_odds; build side in
// nfl_tool/smartstake.py). Wherever a price shows, bookPricePill() swaps in the
// best price across the member's books; clicking it lists every book, best to
// worst, each tagged against the FAIR price: Pinnacle + Novig with the vig
// removed (the market's yardstick, never the GMG model). Play = +1% or better
// per dollar, Pass = -2% or worse, Close in between. No Pinnacle / Novig price
// = no fair price = no tags (never guessed from the other books).
// My Books (synced per member): books to hide. Links are built for New Jersey.

const BOOK_NAMES = {
  draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", caesars: "Caesars", fanatics: "Fanatics",
  bet365: "bet365", thescore: "theScore", betrivers: "BetRivers", hard_rock: "Hard Rock", bally_bet: "Bally Bet",
  circa: "Circa", pinnacle: "Pinnacle", novig: "Novig", prophetx: "ProphetX", kalshi: "Kalshi",
  polymarket_us: "Polymarket", fliff: "Fliff",
};
const BOOK_INITIALS = {
  draftkings: "DK", fanduel: "FD", betmgm: "MGM", caesars: "CZ", fanatics: "FAN", bet365: "365", thescore: "SC",
  betrivers: "BR", hard_rock: "HR", bally_bet: "BAL", circa: "CIR", pinnacle: "PIN", novig: "NV", prophetx: "PX",
  kalshi: "KAL", polymarket_us: "PM", fliff: "FL",
};
const FAIR_BOOKS = ["pinnacle", "novig"];
const BOOK_TAG_PLAY = 0.01;
const BOOK_TAG_PASS = -0.02;
const MY_BOOKS_KEY = "nfl-tool.my-books.v1"; // { hidden: [book ids] }

function myBooks() {
  try { return JSON.parse(localStorage.getItem(MY_BOOKS_KEY)) || {}; } catch (e) { return {}; }
}
function saveMyBooks(value) {
  try { localStorage.setItem(MY_BOOKS_KEY, JSON.stringify(value)); } catch (e) {}
  window.NFLSync?.push(MY_BOOKS_KEY, value);
}
const bookHidden = (book) => (myBooks().hidden || []).includes(book);

const oddsDecimal = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);
const oddsProb = (o) => 1 / oddsDecimal(o);
const probToAmerican = (p) => (p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
const OPPOSITE_SIDE = { o: "u", u: "o", away: "home", home: "away" };

// The game a team plays in this week's book odds.
function bookGameFor(team) {
  const all = DATA.book_odds || {};
  const key = Object.keys(all).find((k) => k.split("_").includes(team));
  return key ? { key, game: all[key] } : null;
}

// spec: {kind: "prop"|"td"|"ml"|"spread"|"total", team, name?, stat?}
function bookQuotes(spec) {
  const found = bookGameFor(spec.team);
  if (!found) return [];
  const g = found.game;
  if (spec.kind === "prop") return ((g.props || {})[spec.stat] || {})[normName(spec.name)]?.q || [];
  if (spec.kind === "td") return (g.td || {})[normName(spec.name)]?.q || [];
  return (g.lines || {})[spec.kind] || [];
}

// The two sides of one bet at one line (a spread's other side is the minus line).
const sameBet = (q, side, line) => q[1] === side && (line === null || line === undefined || q[2] === line);
const otherLine = (side, line) => (line === null || line === undefined ? line : side === "away" || side === "home" ? -line : line);

// The market's fair chance for this side: each of Pinnacle / Novig with both
// sides priced, vig removed, averaged.
function bookFairProb(quotes, side, line) {
  const probs = FAIR_BOOKS.map((book) => {
    const mine = quotes.find((q) => q[0] === book && sameBet(q, side, line));
    const theirs = quotes.find((q) => q[0] === book && sameBet(q, OPPOSITE_SIDE[side], otherLine(side, line)));
    if (!mine || !theirs) return null;
    const a = oddsProb(mine[3]);
    return a / (a + oddsProb(theirs[3]));
  }).filter((p) => p !== null);
  return probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : null;
}

function bookBest(quotes, side, line) {
  return quotes
    .filter((q) => sameBet(q, side, line) && !bookHidden(q[0]))
    .sort((a, b) => oddsDecimal(b[3]) - oddsDecimal(a[3]))[0] || null;
}

function bookTag(fair, odds) {
  if (fair === null) return null;
  const edge = fair * oddsDecimal(odds) - 1;
  const kind = edge >= BOOK_TAG_PLAY ? "play" : edge <= BOOK_TAG_PASS ? "pass" : "close";
  return { kind, edge };
}

// The clickable best price, or "" when no book has this bet (callers keep
// their own price then). spec adds side, line, title, sub.
function bookPricePill(spec) {
  const quotes = bookQuotes(spec);
  const best = bookBest(quotes, spec.side, spec.line);
  if (!best) return "";
  const tag = bookTag(bookFairProb(quotes, spec.side, spec.line), best[3]);
  return `<button type="button" class="bo-pill${tag ? ` bo-${tag.kind}` : ""}" data-bo="${encodeDataAttr(spec)}" title="Best price across your books. Click for every book.">${fmtOddsSigned(best[3])} <small>${BOOK_NAMES[best[0]] || best[0]}</small></button>`;
}

function bookSideLabel(spec, side) {
  const line = side === spec.side ? spec.line : otherLine(spec.side, spec.line);
  if (side === "o" || side === "u") return `${side === "o" ? "Over" : "Under"}${line !== null && line !== undefined ? ` ${fmt(line, 1)}` : ""}`;
  const found = bookGameFor(spec.team);
  const [away, home] = found ? found.key.split("_") : ["Away", "Home"];
  const team = side === "away" ? away : home;
  return spec.kind === "spread" ? `${team} ${line > 0 ? "+" : ""}${fmt(line, 1)}` : team;
}

function renderBookOdds(spec) {
  const quotes = bookQuotes(spec);
  const fair = bookFairProb(quotes, spec.side, spec.line);
  const rows = quotes.filter((q) => q[1] === spec.side && !bookHidden(q[0])).sort((a, b) => oddsDecimal(b[3]) - oddsDecimal(a[3]));
  const main = rows.filter((q) => sameBet(q, spec.side, spec.line));
  const others = rows.filter((q) => !sameBet(q, spec.side, spec.line));
  const row = (q, i, alt) => {
    const tag = alt ? null : bookTag(fair, q[3]);
    const tagCell = alt
      ? '<span class="bo-tag bo-muted">Different line</span>'
      : tag ? `<span class="bo-tag bo-${tag.kind}">${tag.kind}<small>${tag.edge >= 0 ? "+" : "&minus;"}${Math.abs(tag.edge * 100).toFixed(1)}%</small></span>` : "";
    const link = q[4] ? `<a class="bo-bet" href="${q[4]}" target="_blank" rel="noopener">Bet &rsaquo;</a>` : "";
    return `<tr class="${!alt && i === 0 ? "bo-best" : ""}${alt ? " bo-alt" : ""}"><td><div class="bo-book"><span class="bo-ini">${BOOK_INITIALS[q[0]] || "?"}</span>${BOOK_NAMES[q[0]] || q[0]}${!alt && i === 0 ? ' <span class="bo-bestchip">BEST</span>' : ""}</div></td>
      <td class="bo-line">${q[2] !== null && q[2] !== undefined ? bookSideLabel({ ...spec, line: q[2] }, q[1]).replace(/^[A-Z]{2,3} /, "") : ""}</td><td class="bo-odds">${fmtOddsSigned(q[3])}</td><td>${tagCell}</td><td class="bo-go">${link}</td></tr>`;
  };
  const sides = spec.kind === "td" ? [spec.side] : [spec.side, OPPOSITE_SIDE[spec.side]];
  const tabs = sides.length > 1
    ? `<div class="bo-tabs">${sides.map((s) => `<button type="button" class="bo-tab${s === spec.side ? " bo-on" : ""}" data-bo="${encodeDataAttr({ ...spec, side: s, line: s === spec.side ? spec.line : otherLine(spec.side, spec.line) })}">${bookSideLabel(spec, s)}</button>`).join("")}</div>`
    : "";
  const hidden = myBooks().hidden || [];
  const color = typeof TEAM_COLORS !== "undefined" && TEAM_COLORS[spec.team] ? TEAM_COLORS[spec.team] : "var(--accent)";
  return `<div class="bo-banner" style="--bo-team:${color}"><h3>${spec.title}</h3><div class="bo-sub">${spec.sub || ""}${spec.sub ? " &middot; " : ""}${main.length + others.length} books</div></div>
    ${tabs}
    <div class="bo-fair">${fair !== null
      ? `<div><div class="bo-lbl">Fair price</div><div class="bo-big">${fmtOddsSigned(probToAmerican(fair))}</div></div><div><div class="bo-lbl">Chance</div><div class="bo-big">${(fair * 100).toFixed(1)}%</div></div><div class="bo-src">Pinnacle + Novig<br>with the vig removed</div>`
      : '<div class="bo-src bo-src-left">No Pinnacle or Novig price on both sides of this bet, so there is no fair price to tag against. Every book is still listed, best first.</div>'}</div>
    ${main.length || others.length ? `<table class="bo-table"><thead><tr><th>Book</th><th>Line</th><th>Odds</th><th>${fair !== null ? "vs fair price" : ""}</th><th></th></tr></thead><tbody>
      ${main.map((q, i) => row(q, i, false)).join("")}
      ${others.length ? `<tr class="bo-group"><td colspan="5">Other lines</td></tr>${others.map((q) => row(q, 1, true)).join("")}` : ""}
    </tbody></table>` : '<p class="no-data-note">None of your books has this bet right now.</p>'}
    <div class="bo-foot"><span>Links open for New Jersey${hidden.length ? ` &middot; ${hidden.length} book${hidden.length === 1 ? "" : "s"} hidden (${hidden.map((b) => BOOK_NAMES[b] || b).join(", ")})` : ""}</span><a href="#" class="bo-edit-books">Edit my books &rsaquo;</a></div>`;
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

function openMyBooks() {
  const overlay = ensureBookModal("my-books-modal");
  const hidden = myBooks().hidden || [];
  overlay.querySelector(".bo-content").innerHTML = `<h3 class="bo-title">My Books</h3>
    <div class="bo-sub">Only the books you turn on are shown and used for the best price.</div>
    <div class="bo-lbl bo-field">Books</div>
    <div class="bo-chips">${Object.entries(BOOK_NAMES).map(([id, name]) => `<button type="button" class="bo-chip${hidden.includes(id) ? "" : " bo-on"}" data-book="${id}"><span class="bo-box">${hidden.includes(id) ? "" : "&#10003;"}</span>${name}</button>`).join("")}</div>
    <div class="bo-note">The fair price always uses Pinnacle + Novig, even if you hide them, so the Play / Pass tags stay the same for everyone. Bet links open for New Jersey.</div>`;
  overlay.hidden = false;
}

document.addEventListener("click", (e) => {
  const pill = e.target.closest(".bo-pill, .bo-tab");
  if (pill) {
    e.preventDefault();
    e.stopPropagation();
    openBookOdds(decodeDataAttr(pill.dataset.bo));
    return;
  }
  if (e.target.closest(".bo-edit-books, .my-books-link")) {
    e.preventDefault();
    const odds = document.getElementById("book-odds-modal");
    if (odds) odds.hidden = true;
    openMyBooks();
    return;
  }
  const chip = e.target.closest(".bo-chip");
  if (chip) {
    const hidden = new Set(myBooks().hidden || []);
    hidden.has(chip.dataset.book) ? hidden.delete(chip.dataset.book) : hidden.add(chip.dataset.book);
    saveMyBooks({ hidden: [...hidden] });
    openMyBooks();
    document.dispatchEvent(new CustomEvent("my-books-changed"));
  }
}, true); // capture: the player card stops clicks inside it from bubbling
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  ["book-odds-modal", "my-books-modal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
});
window.GMGBookOdds = { openMyBooks };
