// ---- The NBA player card (the owner, 2026-10-21: "consistency" with the NFL and NHL cards) ----
// The ONE popup for every NBA player on every NBA page: wrap any name or photo
// with playerClick(id, inner) (id = ESPN's player id) and it opens. Same shell as
// the NFL / NHL cards (#player-card-modal, .pc-box, .pc-head, .player-modal-toggle).
//   Game Log -- THIS season's games only (the owner: "do not add past years"),
//               newest first, a per-game row on top, from nba/props.json.
//   Odds     -- every player market SmartStake prices for his next game
//               (GMG_NBA_PROP_STATS in sync.js), the best price across the
//               member's books for each side (click: every book), a box beside
//               each that saves the play to My Plays, and how often he cleared
//               the line this season. First Basket too, when a book lists him.
//   Shot Chart -- this season's shots: Zones / Heat Map and filters (shot-chart.js).
// Needs the page's DATA (nba/data.json), sync.js, ../book-odds.js and shot-chart.js. Every
// name here starts with nbaCard / NBA_CARD so it can't clash with a page's own.

let NBA_CARD_PROPS; // nba/props.json: undefined until asked for, then a promise, then the file (null if it can't be read)
let nbaCardState = null; // { id, tab }
const NBA_CARD_TABS = [["log", "Game Log"], ["odds", "Odds"], ["shots", "Shot Chart"]];
const NBA_CARD_SMALL = 10; // fewer games than this = a small-sample note

const nbaCardHas = (n) => n !== null && n !== undefined && !Number.isNaN(n);
const nbaCardFmt = (n, d = 1) => (nbaCardHas(n) ? Number(n).toFixed(d) : "--");
const nbaCardTeam = (abbr) => (DATA && DATA.teams && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const nbaCardLogo = (abbr, size = 16) => (abbr && nbaCardTeam(abbr).logo ? `<img src="${nbaCardTeam(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
const nbaCardDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// props.json, read once per page (the Points page already has it as PROPS).
function nbaCardProps() {
  if (NBA_CARD_PROPS === undefined && typeof PROPS !== "undefined" && PROPS) NBA_CARD_PROPS = PROPS;
  if (NBA_CARD_PROPS === undefined) {
    NBA_CARD_PROPS = fetch("props.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((file) => (NBA_CARD_PROPS = file));
  }
  return NBA_CARD_PROPS instanceof Promise ? undefined : NBA_CARD_PROPS;
}
// This season's block of props.json, or null.
function nbaCardSeason() {
  const props = nbaCardProps();
  return (props && DATA && (props.seasons || {})[String(DATA.season)]) || null;
}
// { id, name, team, pos } from today's rosters (data.json players), else this season's logs.
function nbaCardPlayer(id) {
  id = String(id);
  for (const [abbr, list] of Object.entries((DATA && DATA.players) || {})) {
    const p = (list || []).find((x) => String(x.id) === id);
    if (p) return { id, name: p.name, team: abbr, pos: p.position || "" };
  }
  const p = ((nbaCardSeason() || {}).players || {})[id];
  return p ? { id, name: p.name, team: p.team, pos: p.pos || "" } : null;
}
function playerClick(id, inner) {
  return id ? `<span class="player-click" data-nba-player="${id}">${inner}</span>` : inner;
}
// His team's game the card talks about: the one open on the page, else the next one not finished.
function nbaCardGame(abbr) {
  const open = typeof currentGame === "function" ? currentGame() : null;
  if (open && [open.away, open.home].includes(abbr)) return open;
  return ((DATA && DATA.schedule) || []).find((g) => g.status !== "final" && [g.away, g.home].includes(abbr)) || null;
}
// His games this season as rows of named fields, newest first.
function nbaCardLog(id) {
  const block = nbaCardSeason();
  const p = block && block.players[String(id)];
  if (!p) return [];
  return p.log.map((r) => Object.fromEntries(block.fields.map((f, i) => [f, r[i] === undefined ? null : r[i]]))).reverse();
}

// ---- Game Log tab ----
// Shade a cell against his own games (the NFL / NHL cards' thirds).
function nbaCardTier(v, pool) {
  const vals = pool.filter(nbaCardHas);
  if (!nbaCardHas(v) || vals.length < 2) return ` class="num"`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return ` class="num"`;
  const q = (v - lo) / (hi - lo);
  if (q >= 0.67) return ` class="num tier-good" style="--tier-a:${(0.1 + 0.22 * ((q - 0.67) / 0.33)).toFixed(2)}"`;
  if (q <= 0.33) return ` class="num tier-bad" style="--tier-a:${(0.1 + 0.22 * ((0.33 - q) / 0.33)).toFixed(2)}"`;
  return ` class="num tier-mid"`;
}
const nbaCardMean = (rows, get, d = 1) => {
  const vals = rows.map(get).filter(nbaCardHas);
  return vals.length ? nbaCardFmt(vals.reduce((a, v) => a + v, 0) / vals.length, d) : "--";
};
const nbaCardMade = (made, tried) => (nbaCardHas(made) ? `${made}-${tried}` : `--`);
function nbaCardResult(r) {
  if (!nbaCardHas(r.score) || !nbaCardHas(r.opp_score)) return `<td class="muted-label">--</td>`;
  const won = r.score > r.opp_score;
  return `<td><span class="pick-result pick-result-${won ? "win" : "loss"}">${won ? "W" : "L"}</span> ${r.score}-${r.opp_score}</td>`;
}
const NBA_CARD_LOG_COLS = [
  { label: "Min", get: (r) => r.min, shade: true, show: (r) => `${r.min}${r.start ? "" : ' <span class="nba-pc-bench" title="Came off the bench">B</span>'}` },
  { label: "Pts", get: (r) => r.pts, shade: true },
  { label: "Reb", get: (r) => r.reb, shade: true },
  { label: "Ast", get: (r) => r.ast, shade: true },
  { label: "3PM", title: "Threes made", get: (r) => r.fg3m, shade: true },
  { label: "3PA", title: "Threes tried", get: (r) => r.fg3a },
  { label: "FG", title: "Shots made - tried", get: (r) => r.fga, show: (r) => nbaCardMade(r.fgm, r.fga), avg: (all) => `${nbaCardMean(all, (r) => r.fgm)}-${nbaCardMean(all, (r) => r.fga)}` },
  { label: "FT", title: "Free throws made - tried", get: (r) => r.fta, show: (r) => nbaCardMade(r.ftm, r.fta), avg: (all) => `${nbaCardMean(all, (r) => r.ftm)}-${nbaCardMean(all, (r) => r.fta)}` },
  { label: "PRA", title: "Points + rebounds + assists", get: (r) => gmgNbaStatValue("pra", r), shade: true },
  { label: "Stl", get: (r) => r.stl },
  { label: "Blk", get: (r) => r.blk },
  { label: "TO", title: "Turnovers", get: (r) => r.tov },
  { label: "PF", title: "Fouls", get: (r) => r.pf },
  { label: "+/-", get: (r) => r.pm, show: (r) => (nbaCardHas(r.pm) ? (r.pm > 0 ? `+${r.pm}` : r.pm) : "--"), avg: (all) => nbaCardMean(all, (r) => r.pm).replace(/^(?=\d)/, "+") },
];
function nbaCardLogView(rows) {
  if (!rows.length) return `<p class="no-data-note">No games this season yet.</p>`;
  const cols = NBA_CARD_LOG_COLS;
  const pools = cols.map((c) => (c.shade ? rows.map((r) => c.get(r)) : null));
  const cell = (c, r, i) => {
    const v = c.get(r);
    return `<td${c.shade ? nbaCardTier(v, pools[i]) : ' class="num"'}>${c.show ? c.show(r) : nbaCardHas(v) ? v : "--"}</td>`;
  };
  const body = rows
    .map((r) => `<tr><td>${nbaCardDate(r.date)}</td><td>${r.home ? "vs" : "@"} ${nbaCardLogo(r.opp)} ${r.opp}</td>${nbaCardResult(r)}${cols.map((c, i) => cell(c, r, i)).join("")}</tr>`)
    .join("");
  const avg = cols.map((c) => `<td class="num">${c.avg ? c.avg(rows) : nbaCardMean(rows, c.get)}</td>`).join("");
  const small = rows.length < NBA_CARD_SMALL ? `<p class="no-data-note">Small sample: ${rows.length} game${rows.length === 1 ? "" : "s"} this season.</p>` : "";
  return `${small}<div class="nba-pc-scroll"><table class="data-table nba-pc-log">
      <thead><tr><th>Date</th><th>Opp</th><th>Result</th>${cols.map((c) => `<th${c.title ? ` title="${c.title}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody><tr class="nba-pc-avg"><td colspan="3">Per Game (${rows.length})</td>${avg}</tr>${body}</tbody>
    </table></div>`;
}

// ---- Odds tab ----
// The line most books hang for this market (a book or two may sit a half point off).
function nbaCardMainLine(quotes) {
  const count = {};
  quotes.forEach((q) => nbaCardHas(q[2]) && (count[q[2]] = (count[q[2]] || 0) + 1));
  const best = Object.keys(count).sort((a, b) => count[b] - count[a] || a - b)[0];
  return best === undefined ? null : Number(best);
}
// One saved play per player, market and game: Over and Under share it, so
// checking one side switches the play to it.
const nbaCardPlayId = (stat, g, id) => `nba:${stat === "first_basket" ? "fb" : stat}:${g.game_id}:${id}`;
function nbaCardEntry(stat, g, p, side, line, best) {
  const t = nbaCardTeam(p.team);
  const fb = stat === "first_basket";
  const [label, unit] = GMG_NBA_PROP_STATS[stat] || ["First Basket"];
  return {
    id: nbaCardPlayId(stat, g, p.id), sport: "nba", market: stat, category: label,
    date: g.date, game_id: g.game_id, matchup: `${g.away} @ ${g.home}`, team: p.team, player_id: p.id,
    side: fb ? null : side === "u" ? "under" : "over", line: fb ? null : line,
    description: fb ? `${p.name} first basket` : `${p.name} ${side === "u" ? "Under" : "Over"} ${line} ${unit}`,
    logo: t.logo, color: `#${t.color || "555555"}`, book: best[0], odds: best[3],
  };
}
function nbaCardSaveBox(entry) {
  const saved = loadNbaPlays().find((x) => x.id === entry.id);
  const on = saved && (entry.side === null || saved.side === entry.side);
  return `<label class="pp-check-inline nba-pc-save" title="Save to My Plays"><input type="checkbox" class="nba-pc-toggle" data-entry="${encodeURIComponent(JSON.stringify(entry))}"${on ? " checked" : ""}></label>`;
}
// The best price for one side and its save box, or "--".
function nbaCardSide(spec, g, p, stat) {
  const pill = bookPricePill(spec);
  const best = bookBest(bookQuotes(spec), spec.side, spec.line);
  return pill && best ? `${pill}${nbaCardSaveBox(nbaCardEntry(stat, g, p, spec.side, spec.line, best))}` : `<span class="muted-label">--</span>`;
}
// How often he went over this line this season, "x of y", colored from 3 games like the Points page.
function nbaCardHits(stat, line, rows) {
  const vals = rows.map((r) => gmgNbaStatValue(stat, r)).filter(nbaCardHas);
  if (!vals.length || !nbaCardHas(line)) return `<td class="num muted-label">--</td>`;
  const over = vals.filter((v) => v > line).length;
  const rate = over / vals.length;
  const tier = vals.length >= 3 ? (rate >= 0.6 ? " tier-good" : rate <= 0.4 ? " tier-bad" : "") : "";
  return `<td class="num${tier}" title="Games over ${line} this season">${over} of ${vals.length}</td>`;
}
function nbaCardOddsView(p, g, rows) {
  if (!g) return `<p class="no-data-note">No game on the schedule.</p>`;
  if (typeof bookPricePill !== "function") return `<p class="no-data-note">No lines posted for this player.</p>`;
  const base = { kind: "prop", team: p.team, pid: p.id, game: `${g.away}_${g.home}`, sub: `${g.away} @ ${g.home}`, color: `#${nbaCardTeam(p.team).color || "555555"}` };
  const lines = Object.entries(GMG_NBA_PROP_STATS)
    .map(([stat, [label]]) => {
      const spec = { ...base, stat, title: `${p.name} &middot; ${label}` };
      const line = nbaCardMainLine(bookQuotes(spec));
      if (line === null) return "";
      const side = (s) => nbaCardSide({ ...spec, side: s, line }, g, p, stat);
      return `<tr><td>${label}</td><td class="num props-line">${nbaCardFmt(line)}</td><td class="num">${side("o")}</td><td class="num">${side("u")}</td>${nbaCardHits(stat, line, rows)}</tr>`;
    })
    .join("");
  const fbSpec = { ...base, stat: "first_basket", side: "o", line: null, oneSide: true, noLine: true, title: `${p.name} First Basket` };
  const fb = bookQuotes(fbSpec).length ? `<tr><td>First Basket</td><td class="num props-line">--</td><td class="num">${nbaCardSide(fbSpec, g, p, "first_basket")}</td><td class="num">--</td><td class="num">--</td></tr>` : "";
  if (!lines && !fb) return `<p class="no-data-note">No lines posted for this player yet.</p>`;
  return `<p class="no-data-note">Best price across your books (click it for every book). Checkboxes save a side to My Plays.</p>
    <div class="nba-pc-scroll"><table class="data-table player-odds-table nba-pc-odds">
      <thead><tr><th>Market</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th><th class="num" title="Games over the line this season">This Season</th></tr></thead>
      <tbody>${lines}${fb}</tbody>
    </table></div>
    <p class="section-note">${g.away} @ ${g.home}, ${nbaCardDate(g.date)}${g.lines_locked ? ", locked at tip-off" : ""}.</p>`;
}

// ---- The card ----
function nbaCardEnsure() {
  if (document.getElementById("player-card-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "player-card-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pc-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="player-card-content"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".modal-close")) nbaCardClose();
  });
  document.addEventListener("keydown", (e) => {
    const odds = document.getElementById("book-odds-modal");
    if (e.key === "Escape" && !(odds && !odds.hidden)) nbaCardClose();
  });
}
function nbaCardClose() {
  const overlay = document.getElementById("player-card-modal");
  if (overlay) overlay.hidden = true;
  nbaCardState = null;
}
function nbaCardRender() {
  const { id, tab } = nbaCardState;
  const p = nbaCardPlayer(id);
  if (!p) return `<p class="no-data-note">Player not found.</p>`;
  const g = nbaCardGame(p.team);
  const opp = g ? (g.away === p.team ? g.home : g.away) : null;
  const t = nbaCardTeam(p.team);
  const rgb = [0, 2, 4].map((i) => parseInt((t.color || "555555").slice(i, i + 2), 16)).join(",");
  const facts = [p.pos, `${nbaCardLogo(p.team)} ${t.name}`, opp ? `${g.away === p.team ? "@" : "vs"} ${nbaCardLogo(opp)} ${opp} ${nbaCardDate(g.date)}` : ""].filter(Boolean);
  const head = `<div class="pc-head" style="background:rgba(${rgb},0.22);border-left:4px solid rgb(${rgb})">
      <img src="https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${p.id}.png&w=96&h=70&scale=crop" alt="" class="nba-pc-photo" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="pc-id"><div class="pc-name">${p.name}</div><div class="pc-sub">${facts.join(" &middot; ")}</div></div>
    </div>`;
  const loading = nbaCardProps() === undefined;
  const rows = loading ? [] : nbaCardLog(p.id);
  const tile = (label, value) => `<div class="nba-tile"><div class="gs-tile-label">${label}</div><b>${value}</b></div>`;
  const per = (get) => nbaCardMean(rows, get);
  const tiles = rows.length
    ? `<div class="nba-tiles nba-pc-tiles">${tile("Games", rows.length)}${tile("Min", per((r) => r.min))}${tile("Pts", per((r) => r.pts))}${tile("Reb", per((r) => r.reb))}${tile("Ast", per((r) => r.ast))}${tile("3PM", per((r) => r.fg3m))}${tile("PRA", per((r) => gmgNbaStatValue("pra", r)))}</div>`
    : "";
  const tabs = NBA_CARD_TABS.map(([key, label]) => `<button type="button" class="player-modal-toggle-btn nba-pc-tab${tab === key ? " active" : ""}" data-tab="${key}">${label}</button>`).join("");
  const body = loading ? `<p class="no-data-note">Loading&hellip;</p>` : tab === "odds" ? nbaCardOddsView(p, g, rows) : tab === "shots" ? nbaShotView(p.id) : nbaCardLogView(rows);
  return `${head}${tiles}
    <div class="player-modal-toggle nba-pc-tabs">${tabs}</div>
    <div id="player-modal-body">${body}</div>`;
}
function nbaCardRefresh() {
  if (nbaCardState) document.getElementById("player-card-content").innerHTML = nbaCardRender();
}
function openPlayerCard(id, tab = "log") {
  if (!DATA) return;
  nbaCardEnsure();
  nbaCardState = { id: String(id), tab };
  nbaCardRefresh();
  document.getElementById("player-card-modal").hidden = false;
  if (nbaCardProps() === undefined) Promise.resolve(NBA_CARD_PROPS).then(nbaCardRefresh);
}

// Capture: names sit inside rows that open on a click (the Points page), so the card takes the click.
document.addEventListener("click", (e) => {
  const name = e.target.closest(".player-click[data-nba-player]");
  if (name && !e.target.closest(".bo-pill")) {
    e.stopPropagation();
    e.preventDefault();
    return openPlayerCard(name.dataset.nbaPlayer);
  }
  const tab = e.target.closest("#player-card-modal .nba-pc-tab");
  if (tab && nbaCardState) {
    nbaCardState.tab = tab.dataset.tab;
    if (tab.dataset.tab === "shots" && nbaShotFile() === undefined) Promise.resolve(NBA_SHOT_FILE).then(nbaCardRefresh);
    return nbaCardRefresh();
  }
  if (e.target.closest(".nba-pc-save")) e.stopPropagation();
}, true);
document.addEventListener("change", (e) => {
  const box = e.target.closest(".nba-pc-toggle");
  if (!box) return;
  const entry = JSON.parse(decodeURIComponent(box.dataset.entry));
  const rest = loadNbaPlays().filter((x) => x.id !== entry.id);
  saveNbaPlays(box.checked ? [...rest, { ...entry, added_at: new Date().toISOString() }] : rest);
  nbaCardRefresh(); // the other side's box unchecks
  if (typeof render === "function" && document.querySelector(".fb-best")) render(); // First Basket's check marks
});
document.addEventListener("my-books-changed", nbaCardRefresh);
document.addEventListener("nba-shot-changed", nbaCardRefresh);
