// ---- My Plays: every saved play, every sport (the owner, 2026-10-20) ----
// NFL plays are the Possible Plays list (common.js loadPossiblePlays, graded by
// plays-grading.js against data.json). NHL plays are the boxes on the NHL
// prop pages (sync.js loadNhlPlays), graded here from each team's box scores
// (nhl/players/<TEAM>.json). Both keep the price saved with them. Filter by
// sport and week / day, check rows, and save a picture with the greens and
// reds (Photo Export, the same card as Possible Plays').

let NHL = null; // nhl/data.json (schedule, team logos)
const nhlFiles = {}; // team -> nhl/players/<TEAM>.json, fetched for grading
const mpView = { sport: "all", when: "all" };
const mpSelected = new Set(); // checked rows (ids), this visit only
const MP_SPORTS = [["all", "All"], ["nfl", "NFL"], ["nhl", "NHL"]];

const mpHas = (n) => n !== null && n !== undefined;
const sportOf = (p) => p.sport || "nfl";
const nhlDay = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
// "nfl:7" or "nhl:2026-10-18": a play's week (NFL) or day (NHL).
const periodOf = (p) => (sportOf(p) === "nhl" ? `nhl:${p.date}` : `nfl:${p.week}`);
const periodName = (key) => {
  const [sport, v] = key.split(":");
  return sport === "nhl" ? nhlDay(v) : `Week ${v}`;
};

function allPlays() {
  return [...loadPossiblePlays().map((p) => ({ ...p, sport: "nfl" })), ...loadNhlPlays()];
}
function shownPlays() {
  return allPlays()
    .filter((p) => mpView.sport === "all" || sportOf(p) === mpView.sport)
    .filter((p) => mpView.when === "all" || periodOf(p) === mpView.when)
    .sort((a, b) => (sportOf(a) !== sportOf(b) ? (sportOf(a) === "nfl" ? -1 : 1) : sportOf(a) === "nhl" ? b.date.localeCompare(a.date) : b.week - a.week) || (a.matchup || "").localeCompare(b.matchup || ""));
}

// ---- NHL grading ----
// A player's line in one game from his team's file: the box score row, null
// when the game is final and he isn't in it (didn't play), undefined when
// it can't be told yet.
function nhlGameRow(pid, teamAbbr, date) {
  const file = nhlFiles[teamAbbr];
  if (!file) return undefined;
  const lead = file.log_lead.length;
  const skater = (file.skaters || {})[pid];
  const goalie = (file.goalies || {})[pid];
  const find = (who, cols) => {
    const row = who && who.season.log.find((r) => r[0] === date);
    return row ? Object.fromEntries(cols.map((c, i) => [c, row[lead + i]])) : null;
  };
  return find(skater, file.skater_cols) || find(goalie, file.goalie_cols);
}
function overUnder(side, actual, line) {
  if (actual === line) return "push";
  return (side === "under") === actual < line ? "win" : "loss";
}
function gradeNhlPlay(p) {
  const game = ((NHL || {}).schedule || []).find((g) => g.game_id === p.game_id);
  if (!game || game.status !== "final") return null;
  if (p.market === "stack") {
    const rows = p.legs.map((l) => nhlGameRow(l.id, l.team, p.date));
    if (rows.some((r) => r === undefined)) return null;
    if (rows.some((r) => r === null)) return "void";
    return rows.every((r) => r.g + r.a >= 1) ? "win" : "loss";
  }
  const row = nhlGameRow(p.player_id, p.team, p.date);
  if (row === undefined) return null;
  if (row === null) return "void";
  if (p.market === "goal") return row.g > 0 ? "win" : "loss";
  if (p.market === "sog") return overUnder(p.side, row.sog, p.line);
  if (p.market === "pts") return overUnder(p.side, row.g + row.a, p.line);
  if (p.market === "saves") return mpHas(row.sa) ? overUnder(p.side, row.sa - row.ga, p.line) : "void";
  return null;
}
function regradeNhlPlays() {
  let changed = false;
  const updated = loadNhlPlays().map((p) => {
    if (p.result_source === "manual") return p;
    const result = gradeNhlPlay(p);
    if (result && result !== p.result) {
      changed = true;
      return { ...p, result, result_source: "auto" };
    }
    return p;
  });
  if (changed) saveNhlPlays(updated);
}
const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// Only the teams with an ungraded play in a finished game.
async function loadNhlForGrading() {
  const plays = loadNhlPlays();
  if (!plays.length) return;
  NHL = NHL || (await getJson("nhl/data.json"));
  if (!NHL) return;
  const finals = new Set(NHL.schedule.filter((g) => g.status === "final").map((g) => g.game_id));
  const teams = new Set();
  plays.filter((p) => !p.result && finals.has(p.game_id)).forEach((p) => (p.legs || [p]).forEach((l) => teams.add(l.team)));
  await Promise.all([...teams].filter((t) => !nhlFiles[t]).map(async (t) => {
    const file = await getJson(`nhl/players/${t}.json`);
    if (file) nhlFiles[t] = file;
  }));
  regradeNhlPlays();
}

// ---- results by hand, prices, removing ----
function updatePlay(p, change) {
  if (sportOf(p) === "nhl") saveNhlPlays(loadNhlPlays().map((x) => (x.id === p.id ? change(x) : x)));
  else savePossiblePlays(loadPossiblePlays().map((x) => (x.id === p.id ? change(x) : x)));
}
function setResult(p, result) {
  if (sportOf(p) === "nfl") return setManualResult(p.id, result);
  updatePlay(p, (x) => {
    if (x.result_source === "manual" && x.result === result) {
      const { result: _r, result_source: _rs, ...rest } = x;
      return { ...rest, result: gradeNhlPlay(rest), result_source: gradeNhlPlay(rest) ? "auto" : null };
    }
    return { ...x, result, result_source: "manual" };
  });
}
function removePlay(p) {
  if (sportOf(p) === "nhl") saveNhlPlays(loadNhlPlays().filter((x) => x.id !== p.id));
  else savePossiblePlays(loadPossiblePlays().filter((x) => x.id !== p.id));
  mpSelected.delete(p.id);
}
// "+450", "450", "-120": a price typed in for a Line Stack (the books price those, not us).
function readPrice(text) {
  const n = Math.round(Number(String(text).trim().replace(/^\+/, "")));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
}

// ---- drawing ----
function mpLogo(p, size = 18) {
  if (sportOf(p) === "nfl") return exportPlayLogo(p);
  const t = NHL && NHL.teams[p.team];
  const src = t && (document.documentElement.dataset.theme === "light" ? t.logo : t.logo_dark || t.logo);
  return src ? `<img src="${src}" alt="${p.team}" class="team-logo-mini" width="${size}" height="${size}">` : "";
}
// The play as it reads: a total names its game ("BUF @ KC Over 54.5").
const playText = exportPlayText;
function renderControls() {
  const plays = allPlays();
  const sportChips = MP_SPORTS.map(([key, label]) => {
    const n = key === "all" ? plays.length : plays.filter((p) => sportOf(p) === key).length;
    return `<button type="button" class="quick-select-week-btn mp-sport${mpView.sport === key ? " active" : ""}" data-sport="${key}">${label} <span class="muted-label">(${n})</span></button>`;
  }).join("");
  const inSport = plays.filter((p) => mpView.sport === "all" || sportOf(p) === mpView.sport);
  const periods = [...new Set(inSport.map(periodOf))].sort((a, b) => {
    const [sa, va] = a.split(":");
    const [sb, vb] = b.split(":");
    return sa !== sb ? (sa === "nfl" ? -1 : 1) : sa === "nfl" ? vb - va : vb.localeCompare(va);
  });
  if (mpView.when !== "all" && !periods.includes(mpView.when)) mpView.when = "all";
  const group = (sport, label) => {
    const opts = periods.filter((k) => k.startsWith(`${sport}:`)).map((k) => `<option value="${k}"${mpView.when === k ? " selected" : ""}>${periodName(k)}</option>`).join("");
    return opts ? `<optgroup label="${label}">${opts}</optgroup>` : "";
  };
  document.getElementById("mp-controls").innerHTML = `
    <div class="mp-chips">${sportChips}</div>
    <label class="results-week-label">When <select id="mp-when"><option value="all"${mpView.when === "all" ? " selected" : ""}>Everything</option>${group("nfl", "NFL weeks")}${group("nhl", "NHL days")}</select></label>
    <button type="button" id="photo-export-btn" class="wheel-spin-btn">&#128247; Photo Export</button>`;
}
function recordLine(label, list) {
  const t = tallyResults(list);
  const pv = t.push + t.void;
  const tone = t.win + t.loss === 0 ? "" : t.units >= 0 ? " mp-up" : " mp-down";
  return `<div class="results-type-summary-row${tone}"><span>${label}</span><span>${t.win}-${t.loss}${pv ? `-${pv}` : ""}${t.winPct !== null ? ` (${t.winPct}%)` : ""}</span><span><b>${fmtUnits(t.units)}</b>${t.pending ? ` <small class="muted-label">${t.pending} pending</small>` : ""}</span></div>`;
}
function renderSummary(list) {
  const picked = list.filter((p) => mpSelected.has(p.id));
  const use = picked.length ? picked : list;
  const lines = [recordLine(picked.length ? `${picked.length} checked` : "All shown", use)];
  if (mpView.sport === "all") {
    ["nfl", "nhl"].forEach((s) => {
      const part = use.filter((p) => sportOf(p) === s);
      if (part.length && part.length < use.length) lines.push(recordLine(s.toUpperCase(), part));
    });
  }
  const clear = picked.length ? `<button type="button" class="results-clear-selection" id="mp-clear">Clear checked</button>` : "";
  document.getElementById("mp-summary").innerHTML = list.length ? `<div class="results-type-summary mp-summary">${lines.join("")}</div>${clear}` : "";
}
function oddsCell(p) {
  if (mpHas(p.odds) && p.odds !== "") return `<td class="num">${showOdds(p.odds)}</td>`;
  return `<td class="num"><input type="text" class="mp-price" data-id="${encodeURIComponent(p.id)}" placeholder="Price" size="5" title="The price your book gave you for this stack"></td>`;
}
function renderTable() {
  const list = shownPlays();
  renderSummary(list);
  const box = document.getElementById("mp-content");
  if (!allPlays().length) {
    box.innerHTML = `<div class="empty-state"><p>Nothing saved yet. Check the box beside a play on any page (NFL Game Previews, TD Data and Player Props; NHL Shots, Goals, Points, Saves and Best Plays) and it shows up here.</p></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<p class="no-data-note">No plays for this filter.</p>`;
    return;
  }
  const allOn = list.every((p) => mpSelected.has(p.id));
  const rows = list.map((p) => {
    const id = encodeURIComponent(p.id);
    const graded = p.result === "win" || p.result === "loss";
    const overrides = ["win", "loss", "push", "void"].map((r) => `<button type="button" class="result-override-btn${p.result === r && p.result_source === "manual" ? " active" : ""}" data-id="${id}" data-result="${r}">${RESULT_LABELS[r]}</button>`).join("");
    return `<tr class="result-row-${p.result || "pending"}${mpSelected.has(p.id) ? " result-row-selected" : ""}">
      <td><input type="checkbox" class="mp-select" data-id="${id}"${mpSelected.has(p.id) ? " checked" : ""} aria-label="Check this play"></td>
      <td><span class="mp-sport-tag">${sportOf(p).toUpperCase()}</span></td>
      <td>${periodName(periodOf(p))}</td>
      <td>${p.matchup || ""}</td>
      <td>${p.category}</td>
      <td><span class="mp-play">${mpLogo(p)}<span>${playText(p)}</span></span></td>
      ${oddsCell(p)}
      <td class="num">${graded ? fmtUnits(unitsForPlay(p)) : "--"}</td>
      <td><span class="pick-result pick-result-${p.result || "pending"}">${p.result ? RESULT_LABELS[p.result] : "Pending"}</span></td>
      <td class="result-override-group">${overrides}<button type="button" class="result-override-btn mp-remove" data-id="${id}" title="Remove this play">&times;</button></td>
    </tr>`;
  }).join("");
  box.innerHTML = `<div class="results-table-scroll"><table class="data-table results-table mp-table">
    <thead><tr><th><input type="checkbox" id="mp-select-all"${allOn ? " checked" : ""} aria-label="Check every play shown"></th><th>Sport</th><th>When</th><th>Game</th><th>Type</th><th>Play</th><th class="num">Odds</th><th class="num">Units</th><th>Result</th><th>Set result</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
function render() {
  renderControls();
  renderTable();
  const modal = document.getElementById("export-modal");
  if (modal && !modal.hidden) refreshExport();
}
window.render = render; // sync.js redraws after another device's change

// ---- Photo Export (the Possible Plays card, every sport) ----
let exportShowResults = false;
let exportCols = 0; // 0 = auto
const exportOrder = (p) => `${sportOf(p) === "nfl" ? 0 : 1}|${p.category}`;
function exportList() {
  const list = shownPlays();
  const picked = list.filter((p) => mpSelected.has(p.id));
  return picked.length ? picked : list;
}
function exportTitleText(list) {
  const sports = new Set(list.map(sportOf));
  const periods = new Set(list.map(periodOf));
  const when = periods.size === 1 ? periodName([...periods][0]) : "";
  const sport = sports.size === 1 ? [...sports][0].toUpperCase() : "";
  return [sport, when, "Plays"].filter(Boolean).join(" · ");
}
function exportRow(p) {
  const units = !exportShowResults ? "" : p.result === "win" || p.result === "loss" ? `<span class="pe-units">${fmtUnits(unitsForPlay(p))}</span>` : `<span class="pe-units pe-units-muted">${p.result ? RESULT_LABELS[p.result] : "Pending"}</span>`;
  return `<div class="pe-row${exportShowResults ? ` pe-row-${p.result || "pending"}` : ""}">
    <span class="pe-logo">${mpLogo(p)}</span><span class="pe-play">${playText(p)}</span>
    <span class="pe-odds">${mpHas(p.odds) && p.odds !== "" ? showOdds(p.odds) : "--"}</span>${units}
  </div>`;
}
function renderExportCard() {
  const list = exportList();
  if (!list.length) return `<p class="no-data-note">No plays to show.</p>`;
  const multiSport = new Set(list.map(sportOf)).size > 1;
  const groups = [...new Set(list.map(exportOrder))].sort();
  const autoCols = (n) => (n <= 14 ? 1 : n <= 32 ? 2 : n <= 60 ? 3 : 4);
  const cols = exportCols || autoCols(list.length + groups.length * 1.5);
  const body = groups.map((key) => {
    const rows = list.filter((p) => exportOrder(p) === key);
    const head = `${multiSport ? `${sportOf(rows[0]).toUpperCase()} · ` : ""}${rows[0].category}`;
    return `<div class="pe-group-head"><span>${head}</span><span class="pe-count">${rows.length}</span></div>${rows.map(exportRow).join("")}`;
  }).join("");
  const colWidth = (list.some((p) => playText(p).length > 20) ? 300 : 250) + (exportShowResults ? 62 : 0);
  const width = Math.max(cols * colWidth + (cols - 1) * 14 + 28, exportShowResults ? 440 : 0);
  let total = `<span class="pe-total">${list.length} plays</span>`;
  if (exportShowResults) {
    const t = tallyResults(list);
    const pv = t.push + t.void;
    const tone = t.win + t.loss === 0 ? "" : t.units >= 0 ? " pe-record-up" : " pe-record-down";
    total = `<span class="pe-record${tone}">${t.win}-${t.loss}${pv ? `-${pv}` : ""}<b>${fmtUnits(t.units)}</b></span>${t.pending ? `<span class="pe-total">${t.pending} pending</span>` : ""}`;
  }
  return `<div id="plays-export-card" class="pe-card" style="width:${width}px">
    <div class="pe-head"><span class="brand-mark">GMG</span><span class="pe-title">${exportTitleText(list)}</span>${total}</div>
    <div class="pe-body" style="column-count:${cols}">${body}</div>
  </div>`;
}
function refreshExport() {
  const n = exportList().length;
  const checked = shownPlays().some((p) => mpSelected.has(p.id));
  const colButtons = [0, 1, 2, 3, 4].map((c) => `<button type="button" class="quick-select-week-btn pe-col-btn${c === exportCols ? " active" : ""}" data-cols="${c}">${c || "Auto"}</button>`).join("");
  document.getElementById("export-modal-content").innerHTML = `<h2 class="modal-title">&#128247; Photo export</h2>
    <p class="muted-label">${checked ? `The ${n} plays you checked.` : `Every play shown (${n}). Check rows in the list to picture just those.`}</p>
    <div class="pe-controls">
      <div class="pe-control-row"><label class="pe-check"><input type="checkbox" id="pe-show-results"${exportShowResults ? " checked" : ""}> Show results (wins, losses, units)</label></div>
      <div class="pe-control-row"><span class="quick-select-label">Columns:</span>${colButtons}
        <button type="button" id="pe-save-btn" class="wheel-spin-btn pe-save-btn">Save image</button></div>
    </div>
    <div class="pe-preview">${renderExportCard()}</div>`;
}
function openExport() {
  if (!document.getElementById("export-modal")) {
    const overlay = document.createElement("div");
    overlay.id = "export-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="export-modal-content"></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest(".modal-close")) overlay.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") overlay.hidden = true;
    });
  }
  exportShowResults = exportList().some((p) => p.result);
  refreshExport();
  document.getElementById("export-modal").hidden = false;
}
async function saveImage() {
  const btn = document.getElementById("pe-save-btn");
  const card = document.getElementById("plays-export-card");
  if (!card) return;
  btn.disabled = true;
  btn.textContent = "Saving...";
  let label = "Saved";
  try {
    if (!window.htmlToImage) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const url = await window.htmlToImage.toPng(card, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      fontEmbedCSS: await summaryFontCSS(),
      includeQueryParams: true,
      width: card.offsetWidth,
      height: card.offsetHeight,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmg-${exportTitleText(exportList()).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
  } catch (e) {
    label = "Couldn't save -- screenshot instead";
  }
  const again = document.getElementById("pe-save-btn");
  if (!again) return;
  again.textContent = label;
  setTimeout(() => {
    const b = document.getElementById("pe-save-btn");
    if (b) {
      b.disabled = false;
      b.textContent = "Save image";
    }
  }, 2500);
}

// ---- events ----
const playById = (encoded) => allPlays().find((p) => p.id === decodeURIComponent(encoded));
document.addEventListener("click", (e) => {
  const sport = e.target.closest(".mp-sport");
  if (sport) {
    mpView.sport = sport.dataset.sport;
    return render();
  }
  if (e.target.closest("#photo-export-btn")) return openExport();
  if (e.target.closest("#pe-save-btn")) return saveImage();
  const col = e.target.closest(".pe-col-btn");
  if (col) {
    exportCols = Number(col.dataset.cols);
    return refreshExport();
  }
  if (e.target.closest("#mp-clear")) {
    mpSelected.clear();
    return renderTable();
  }
  const remove = e.target.closest(".mp-remove");
  if (remove) {
    const p = playById(remove.dataset.id);
    if (p && confirm(`Remove "${playText(p)}" from your plays?`)) removePlay(p);
    return render();
  }
  const override = e.target.closest(".result-override-btn");
  if (override) {
    const p = playById(override.dataset.id);
    if (p) setResult(p, override.dataset.result);
    return render();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "mp-when") {
    mpView.when = e.target.value;
    return render();
  }
  if (e.target.id === "pe-show-results") {
    exportShowResults = e.target.checked;
    return refreshExport();
  }
  if (e.target.id === "mp-select-all") {
    shownPlays().forEach((p) => (e.target.checked ? mpSelected.add(p.id) : mpSelected.delete(p.id)));
    return renderTable();
  }
  const box = e.target.closest(".mp-select");
  if (box) {
    const id = decodeURIComponent(box.dataset.id);
    if (box.checked) mpSelected.add(id);
    else mpSelected.delete(id);
    return renderTable();
  }
  const price = e.target.closest(".mp-price");
  if (price) {
    const p = playById(price.dataset.id);
    const n = readPrice(price.value);
    if (p && n !== null) updatePlay(p, (x) => ({ ...x, odds: n }));
    return render();
  }
});

// Draw from what's saved right away, then grade and draw again.
render();
Promise.all([
  getJson("data.json").then((data) => {
    if (!data) return;
    DATA = data;
    regradeAllPossiblePlays(DATA);
  }),
  loadNhlForGrading(),
]).then(render);
