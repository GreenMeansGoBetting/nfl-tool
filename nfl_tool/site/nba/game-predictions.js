// ---- GMG NBA Suite: Game Predictions ----
// Every game's GMG projection (nba/predict.py: the League Stats Chart's
// numbers turned into points, offense against what this defense allows)
// beside the book's real lines, with our fair price for the spread, the
// total and the moneyline (the owner, 2026-10-30). Season numbers; a game
// that has tipped shows the prediction it had at tip, graded once it's
// final, and the YTD Model Performance popup keeps the record. Each game's
// Point Breakdown (the Points Ledger, predict-view.js) is always open. Stands on its own
// (no common.js), like the League Stats Chart.

let DATA = null;
let dayIndex = 0;
const el = (id) => document.getElementById(id);
const team = (abbr) => DATA.teams[abbr] || { name: abbr, color: "555555", logo: "" };
const logo = (abbr, size) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
const PRED_MARKETS = { spread: "Spread", total: "Total", ml: "Moneyline" };

// {game id: prediction}: tonight's (and the next nights') before tip, the record's after.
function predictions() {
  const P = DATA.predictions || {};
  return { ...(P.record || {}), ...((P.upcoming || {}).season || {}) };
}
const days = () => [...new Set(Object.values(predictions()).map((p) => p.date))].sort();

// A graded play: the side, its price, won / lost.
function playText(pred, play) {
  const side = play.market === "total" ? (play.side ? "Under" : "Over") : play.side ? pred.home : pred.away;
  const line = play.market === "spread" ? ` ${pvLine(pred.book.spread[play.side])}` : play.market === "total" ? ` ${pred.book.total}` : "";
  return `${PRED_MARKETS[play.market]}: ${side}${line} ${showOdds(play.price)}`;
}
function card(pred, g) {
  const result = pred.result;
  const when = result ? `Final ${pred.away} ${result[0]} - ${pred.home} ${result[1]}` : g ? gmgGameTime(g) : "";
  const graded = (pred.graded || [])
    .filter((p) => p.edge >= 0)
    .map((p) => `<span class="gp-play" style="background:${p.won === null ? "rgba(127,127,127,0.18)" : scaleHsla(p.won ? 120 : 0, 65, 45, 0.3)}" title="Our edge ${(p.edge * 100).toFixed(1)}% over the book price at tip">${playText(pred, p)}${p.won === null ? " (Push)" : ""}</span>`)
    .join("");
  return `<div class="gp-card">
    <div class="gp-head">${logo(pred.away, 26)}<b>${pred.away}</b><span class="at">@</span>${logo(pred.home, 26)}<b>${pred.home}</b><span class="gp-when">${when}</span></div>
    ${pvLines(pred)}
    ${graded ? `<div class="gp-graded"><span>Model Plays At Tip</span>${graded}</div>` : ""}
    ${pvLedger(pred)}
  </div>`;
}
function render() {
  const all = days();
  const date = all[dayIndex];
  el("empty-state").hidden = !!date;
  if (!date) {
    el("empty-state").innerHTML = `<p>${DATA.predictions ? "No games to predict yet." : "Game Predictions aren't available right now."}</p>`;
    el("gp-body").innerHTML = "";
    return;
  }
  el("day-label").textContent = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  const games = Object.fromEntries((DATA.schedule || []).map((g) => [g.game_id, g]));
  const list = Object.entries(predictions())
    .filter(([, p]) => p.date === date)
    .sort(([a], [b]) => ((games[a] || {}).start_utc || a).localeCompare((games[b] || {}).start_utc || b));
  el("gp-body").innerHTML = `<div class="gp-list">${list.map(([id, p]) => card(p, games[id])).join("")}</div>`;
}

// ---- YTD Model Performance (ytd.js): the model's side in each market at tip, graded ----
function ytdList() {
  const rec = Object.values((DATA.predictions || {}).record || {}).filter((p) => p.result).sort((a, b) => b.date.localeCompare(a.date));
  if (!rec.length) return `<p class="no-data-note">Graded after tonight's games.</p>`;
  const rows = rec
    .map((p) => {
      const plays = (p.graded || []).filter((x) => x.won !== null && ytdKeeps("nba-predictions", x.market, p.date, x.edge));
      if (!plays.length) return "";
      const day = new Date(`${p.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `<tr><td class="muted-label">${day}</td><td>${logo(p.away, 16)}${p.away} ${p.result[0]} @ ${logo(p.home, 16)}${p.home} ${p.result[1]}</td>
        <td>${p.pts[0].toFixed(0)}-${p.pts[1].toFixed(0)}</td>
        <td class="gp-ytd-plays">${plays.map((x) => `<span class="gp-play" style="background:${scaleHsla(x.won ? 120 : 0, 65, 45, 0.3)}">${playText(p, x)}</span>`).join("")}</td></tr>`;
    })
    .join("");
  return rows
    ? `<div class="gp-ytd-scroll"><table class="data-table gp-ytd-table"><thead><tr><th>Date</th><th>Final</th><th title="Our projected score at tip">GMG</th><th>Model Plays</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="no-data-note">No graded plays in this window.</p>`;
}
function renderYtd() {
  const ledger = (DATA.predictions || {}).ledger || {};
  const overlay = ensureBookModal("gp-ytd-modal");
  const content = overlay.querySelector(".bo-content");
  content.innerHTML = `<h2 class="section-title">YTD Model Performance</h2><div class="gp-ytd-tracker"></div><div class="gp-ytd-list"></div>`;
  const draw = () => {
    content.querySelector(".gp-ytd-list").innerHTML = ytdList();
  };
  const market = (key, tip, splits) => ({ key, label: PRED_MARKETS[key], tip, ledger: ledger[key] || [], min: 0, max: 15, step: 1, slider: "Min Edge", unit: "%+", splits });
  ytdTracker(content.querySelector(".gp-ytd-tracker"), {
    key: "nba-predictions",
    all: "All Plays",
    markets: [
      market("spread", "Our side of each game's spread at tip, when our chance beats the book price by at least the minimum", [["fav", "Favorites"], ["dog", "Underdogs"], ["home", "Home"], ["away", "Away"]]),
      market("total", "Our side of each game's total at tip", [["over", "Overs"], ["under", "Unders"]]),
      market("ml", "Our moneyline side at tip (the side whose chance beats its price by more)", [["fav", "Favorites"], ["dog", "Underdogs"]]),
    ],
    onChange: draw,
  });
  draw();
  overlay.hidden = false;
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#day-prev") || e.target.closest("#day-next")) {
    dayIndex = Math.max(0, Math.min(days().length - 1, dayIndex + (e.target.closest("#day-prev") ? -1 : 1)));
    return render();
  }
  if (e.target.closest("#gp-ytd")) return renderYtd();
  const theme = e.target.closest("#theme-toggle");
  if (theme) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
  }
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    dayIndex = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
