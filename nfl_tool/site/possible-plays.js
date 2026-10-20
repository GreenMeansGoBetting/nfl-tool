// Renders the shared Possible Plays list (storage layer lives in common.js
// since the odds modal and Game Previews' mainline checkboxes both write to
// it too) grouped by week, most recent week first. This is the only page
// that doesn't fetch data.json -- everything it needs is already in
// localStorage.

// Which play IDs are checked for the Parlay Wheel -- separate from the
// plays list itself (a play can be saved without ever being wheel-checked),
// kept as a plain Set rather than persisted anywhere, since this is a
// same-session "let's build a parlay right now" tool, not a saved feature.
const wheelSelected = new Set();

function updateWheelActionBar() {
  const bar = document.getElementById("wheel-action-bar");
  if (!bar) return;
  if (wheelSelected.size === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  document.getElementById("wheel-selected-count").textContent = `${wheelSelected.size} selected`;
}

// Which week the quick-select controls are scoped to -- a plain module
// variable, not persisted, since it's just a same-session filter on the
// tool itself (the plays list below still always shows every week). Old
// behavior had "Select all: Anytime TD" grab that category across EVERY
// saved week at once, which is exactly the "why did it just pick last
// week's plays too" complaint -- picking a week first scopes every
// category checkbox underneath it to that week only.
let quickSelectWeek = null;

// Every play ID for one (week, category) combo -- both the dropdown
// checkbox's own checked state and its change handler key off this same
// list, so they can't drift apart.
function quickSelectIds(week, category) {
  return loadPossiblePlays()
    .filter((p) => p.week === week && p.category === category)
    .map((p) => p.id);
}

// Week buttons + a "Categories" dropdown of checkboxes for the chosen
// week, replacing the old flat row of "Select all: X" buttons (which had
// no notion of week at all). A checkbox mirrors whether EVERY play in that
// (week, category) is currently wheel-selected -- checking/unchecking it
// adds/removes exactly that set, so multiple categories layer together
// instead of each one wiping out the last (the old buttons' "replaces the
// whole selection" behavior doesn't fit checkbox semantics).
function renderQuickSelectBar() {
  const bar = document.getElementById("quick-select-bar");
  if (!bar) return;
  const allPlays = loadPossiblePlays();
  if (allPlays.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const weeks = [...new Set(allPlays.map((p) => p.week))].sort((a, b) => b - a);
  if (quickSelectWeek === null || !weeks.includes(quickSelectWeek)) quickSelectWeek = weeks[0];

  const weekButtons = weeks
    .map((w) => `<button type="button" class="quick-select-week-btn${w === quickSelectWeek ? " active" : ""}" data-week="${w}">Week ${w}</button>`)
    .join("");

  const categories = [...new Set(allPlays.filter((p) => p.week === quickSelectWeek).map((p) => p.category))].sort();
  const categoryItems = categories.length
    ? categories
        .map((c) => {
          const ids = quickSelectIds(quickSelectWeek, c);
          const allChecked = ids.every((id) => wheelSelected.has(id));
          return `<label class="quick-select-menu-item"><input type="checkbox" class="quick-select-check" data-entry="${encodeDataAttr(c)}"${allChecked ? " checked" : ""}> ${c}</label>`;
        })
        .join("")
    : `<p class="no-data-note">No plays saved for Week ${quickSelectWeek}.</p>`;

  bar.innerHTML = `
    <span class="quick-select-label">Quick select:</span>
    <div class="quick-select-weeks">${weekButtons}</div>
    <div class="quick-select-dropdown">
      <button type="button" id="quick-select-dropdown-btn" class="quick-select-btn">Categories &#9662;</button>
      <div id="quick-select-menu" class="quick-select-menu-panel" hidden>
        ${categoryItems}
        <button type="button" id="quick-select-clear" class="quick-select-btn quick-select-clear-btn">Clear selection</button>
      </div>
    </div>`;
}

document.addEventListener("click", (e) => {
  const weekBtn = e.target.closest(".quick-select-week-btn");
  if (weekBtn) {
    quickSelectWeek = Number(weekBtn.dataset.week);
    renderQuickSelectBar();
    return;
  }
  const dropdownBtn = e.target.closest("#quick-select-dropdown-btn");
  if (dropdownBtn) {
    document.getElementById("quick-select-menu").hidden = !document.getElementById("quick-select-menu").hidden;
    return;
  }
  const clearBtn = e.target.closest("#quick-select-clear");
  if (clearBtn) {
    wheelSelected.clear();
    renderPossiblePlays();
    return;
  }
  // Click anywhere outside the dropdown closes it -- but not a click
  // inside the menu itself (a checkbox toggle re-renders the rows, not
  // this bar, precisely so the open menu doesn't get yanked shut on every
  // category you check).
  const menu = document.getElementById("quick-select-menu");
  if (menu && !menu.hidden && !e.target.closest(".quick-select-dropdown")) {
    menu.hidden = true;
  }
});

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".quick-select-check");
  if (!cb) return;
  const category = decodeDataAttr(cb.dataset.entry);
  const ids = quickSelectIds(quickSelectWeek, category);
  if (cb.checked) ids.forEach((id) => wheelSelected.add(id));
  else ids.forEach((id) => wheelSelected.delete(id));
  renderPlaysList();
});

// Grading, bet types and units: plays-grading.js (My Plays uses them too).

function ensureResultsModal() {
  if (document.getElementById("results-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "results-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box results-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="results-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeResultsModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeResultsModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeResultsModal();
  });
}
function closeResultsModal() {
  const el = document.getElementById("results-modal");
  if (el) el.hidden = true;
}

// ---- Results modal: filter/sort state ----
// Sticky for the page session (not persisted across reloads) -- picking a
// week/type filter or a sort column while flipping between shows should
// stay put until the modal is closed and the page reloaded, not reset on
// every open.
let resultsWeekFilter = "all";
let resultsTypeFilters = new Set(BET_TYPES);
let resultsSort = { col: "week", dir: "desc" };

function filteredResultsPlays() {
  return loadPossiblePlays().filter((p) => {
    if (resultsWeekFilter !== "all" && p.week !== resultsWeekFilter) return false;
    return resultsTypeFilters.has(betTypeGroup(p.category));
  });
}

const RESULT_RANK = { win: 0, push: 1, void: 1, loss: 2 };
function resultRank(p) {
  return p.result ? RESULT_RANK[p.result] ?? 3 : 3; // Pending sorts last
}
const RESULT_SORT_COLUMNS = [
  { key: "week", label: "Week" },
  { key: "matchup", label: "Matchup" },
  { key: "type", label: "Type" },
  { key: "play", label: "Play" },
  { key: "odds", label: "Odds" },
  { key: "units", label: "Units" },
  { key: "result", label: "Result" },
];
// New column click: numeric columns default to biggest-first, text/result
// columns to A-first/win-first -- whichever reads as the more useful
// initial order. Clicking the SAME column again just flips it.
const SORT_DEFAULT_DIR = { week: "desc", matchup: "asc", type: "asc", play: "asc", odds: "desc", units: "desc", result: "asc" };
function sortResultsValue(p, col) {
  switch (col) {
    case "week": return p.week;
    case "matchup": return p.matchup;
    case "type": return p.category;
    case "play": return p.description;
    case "odds": return parseFloat(p.odds) || 0;
    case "units": return unitsForPlay(p);
    case "result": return resultRank(p);
    default: return 0;
  }
}
function setResultsSort(col) {
  resultsSort = resultsSort.col === col ? { col, dir: resultsSort.dir === "asc" ? "desc" : "asc" } : { col, dir: SORT_DEFAULT_DIR[col] || "asc" };
}
function sortResultsPlays(list) {
  const { col, dir } = resultsSort;
  const mult = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = sortResultsValue(a, col);
    const bv = sortResultsValue(b, col);
    if (av < bv) return -1 * mult;
    if (av > bv) return 1 * mult;
    return new Date(b.added_at) - new Date(a.added_at);
  });
}
function sortArrowFor(col) {
  if (resultsSort.col !== col) return "";
  return resultsSort.dir === "asc" ? " ↑" : " ↓";
}

function renderResultsFilterBar(allPlays) {
  const weeks = [...new Set(allPlays.map((p) => p.week))].sort((a, b) => b - a);
  const weekOptions = [`<option value="all"${resultsWeekFilter === "all" ? " selected" : ""}>All Weeks (Cumulative)</option>`]
    .concat(weeks.map((w) => `<option value="${w}"${resultsWeekFilter === w ? " selected" : ""}>Week ${w}</option>`))
    .join("");
  const typeChecks = BET_TYPES.map(
    (t) => `<label class="results-type-check"><input type="checkbox" class="results-type-checkbox" data-type="${t}"${resultsTypeFilters.has(t) ? " checked" : ""}> ${t}</label>`
  ).join("");
  return `<div class="results-filter-bar">
    <label class="results-week-label">Week <select class="results-week-select">${weekOptions}</select></label>
    <div class="results-type-checks">${typeChecks}</div>
  </div>`;
}

// Overall record/units for the current filter, plus the same broken out
// per bet-type group -- directly answers "how are my TDs doing vs my
// Props" without needing to flip the type checkboxes back and forth.
function renderResultsSummary(list) {
  const overall = tallyResults(list);
  const pushVoid = overall.push + overall.void;
  const overallLine = `<p class="results-summary">${overall.win}-${overall.loss}-${pushVoid}${overall.winPct !== null ? ` <span class="muted-label">(${overall.winPct}%)</span>` : ""} <strong>${fmtUnits(overall.units)}</strong>${overall.pending ? ` <span class="muted-label">&middot; ${overall.pending} pending</span>` : ""}</p>`;
  const typeRows = BET_TYPES.map((t) => ({ type: t, ...tallyResults(list.filter((p) => betTypeGroup(p.category) === t)) }))
    .filter((t) => t.win + t.loss + t.push + t.void + t.pending > 0)
    .map((t) => `<div class="results-type-summary-row"><span>${t.type}</span><span>${t.win}-${t.loss}-${t.push + t.void}${t.winPct !== null ? ` (${t.winPct}%)` : ""}</span><span>${fmtUnits(t.units)}</span></div>`)
    .join("");
  return `${overallLine}${typeRows ? `<div class="results-type-summary">${typeRows}</div>` : ""}`;
}

// Hand-picked bets (user 2026-10-06: "just summarize last night's MNF").
// When any visible bet is checked, the summary covers only the checked
// ones. Kept for this page visit only.
const resultsSelected = new Set();
function renderResultsQuickSelect(list) {
  const counts = {};
  list.forEach((p) => (counts[p.matchup] = (counts[p.matchup] || 0) + 1));
  const chips = Object.entries(counts)
    .map(([m, n]) => {
      const ids = list.filter((p) => p.matchup === m).map((p) => p.id);
      const on = ids.every((id) => resultsSelected.has(id));
      return `<button type="button" class="results-game-chip${on ? " active" : ""}" data-matchup="${encodeURIComponent(m)}">${m} <span class="muted-label">(${n})</span></button>`;
    })
    .join("");
  return `<div class="results-quick-select"><span class="results-quick-label">Select by game</span>${chips}</div>`;
}

function renderResultsModalContent() {
  const allPlays = loadPossiblePlays();
  if (!allPlays.length) {
    return `<h3>Possible Plays &mdash; Results</h3><p class="no-data-note">Nothing saved yet.</p>`;
  }
  const filterBar = renderResultsFilterBar(allPlays);
  const list = filteredResultsPlays();
  if (!list.length) {
    return `<h3>Possible Plays &mdash; Results</h3>${filterBar}<p class="no-data-note">No plays match these filters.</p>`;
  }
  const picked = list.filter((p) => resultsSelected.has(p.id));
  const summary = picked.length
    ? `<div class="results-selected-note">Summary of <b>${picked.length}</b> selected bet${picked.length === 1 ? "" : "s"} <button type="button" class="results-clear-selection">Clear selection</button></div>${renderResultsSummary(picked)}`
    : renderResultsSummary(list);
  const allOn = list.every((p) => resultsSelected.has(p.id));
  const headerCells = RESULT_SORT_COLUMNS.map((c) => `<th class="results-sort-th" data-col="${c.key}">${c.label}${sortArrowFor(c.key)}</th>`).join("");
  const rows = sortResultsPlays(list)
    .map((p) => {
      const resultLabel = p.result ? RESULT_LABELS[p.result] : "Pending";
      const unitsDisplay = p.result === "win" || p.result === "loss" ? fmtUnits(unitsForPlay(p)) : "--";
      const overrideBtns = ["win", "loss", "void"]
        .map((r) => `<button type="button" class="result-override-btn${p.result === r && p.result_source === "manual" ? " active" : ""}" data-id="${p.id}" data-result="${r}">${RESULT_LABELS[r]}</button>`)
        .join("");
      const sel = resultsSelected.has(p.id);
      return `<tr class="result-row-${p.result || "pending"}${sel ? " result-row-selected" : ""}">
        <td><input type="checkbox" class="results-select" data-id="${p.id}"${sel ? " checked" : ""} aria-label="Include in summary"></td>
        <td>${p.week}</td>
        <td>${p.matchup}</td>
        <td>${p.category}</td>
        <td>${p.team ? teamLogoMini(p.team) : ""} ${playDescriptionHtml(p)}</td>
        <td class="num">${showOdds(p.odds)}</td>
        <td class="num">${unitsDisplay}</td>
        <td><span class="pick-result pick-result-${p.result || "pending"}">${resultLabel}</span></td>
        <td class="result-override-group">${overrideBtns}</td>
      </tr>`;
    })
    .join("");
  return `<h3>Possible Plays &mdash; Results</h3>
    ${filterBar}
    ${renderResultsQuickSelect(list)}
    ${summary}
    <div class="results-table-scroll">
      <table class="data-table results-table">
        <thead><tr><th><input type="checkbox" class="results-select-all"${allOn ? " checked" : ""} title="Select / clear every bet shown" aria-label="Select all"></th>${headerCells}<th>Override</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

document.addEventListener("change", (e) => {
  const weekSel = e.target.closest(".results-week-select");
  if (weekSel) {
    resultsWeekFilter = weekSel.value === "all" ? "all" : Number(weekSel.value);
    document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
    return;
  }
  const typeCb = e.target.closest(".results-type-checkbox");
  if (typeCb) {
    if (typeCb.checked) resultsTypeFilters.add(typeCb.dataset.type);
    else resultsTypeFilters.delete(typeCb.dataset.type);
    document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
  }
});

function refreshResultsModal() {
  document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
}
document.addEventListener("change", (e) => {
  const cb = e.target.closest(".results-select");
  const all = e.target.closest(".results-select-all");
  if (cb) {
    if (cb.checked) resultsSelected.add(cb.dataset.id);
    else resultsSelected.delete(cb.dataset.id);
    refreshResultsModal();
  } else if (all) {
    filteredResultsPlays().forEach((p) => (all.checked ? resultsSelected.add(p.id) : resultsSelected.delete(p.id)));
    refreshResultsModal();
  }
});
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".results-game-chip");
  if (chip) {
    const m = decodeURIComponent(chip.dataset.matchup);
    const ids = filteredResultsPlays().filter((p) => p.matchup === m).map((p) => p.id);
    const on = ids.every((id) => resultsSelected.has(id));
    ids.forEach((id) => (on ? resultsSelected.delete(id) : resultsSelected.add(id)));
    refreshResultsModal();
  } else if (e.target.closest(".results-clear-selection")) {
    resultsSelected.clear();
    refreshResultsModal();
  }
});

document.addEventListener("click", (e) => {
  const th = e.target.closest(".results-sort-th");
  if (!th) return;
  setResultsSort(th.dataset.col);
  document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
});

function openResultsModal() {
  ensureResultsModal();
  regradeAllPossiblePlays(DATA);
  document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
  document.getElementById("results-modal").hidden = false;
}

document.addEventListener("click", (e) => {
  const overrideBtn = e.target.closest(".result-override-btn");
  if (!overrideBtn) return;
  setManualResult(overrideBtn.dataset.id, overrideBtn.dataset.result);
  regradeAllPossiblePlays(DATA);
  document.getElementById("results-modal-content").innerHTML = renderResultsModalContent();
  renderPossiblePlays();
});

document.getElementById("view-results-btn").addEventListener("click", openResultsModal);

// ---- Photo export ----
// One compact image of the saved plays for chosen categories (the user's
// Discord wants every TD play in one picture, not a stack of screenshots).
// Each row is just team logo, play, odds; rows flow into columns so a long
// list still fits one image. Once games are graded, "Show results" shades
// each row green / red with its units and puts the record in the title bar
// (a member wanted a card of his bets with the greens and reds). Per-visit
// state, nothing saved.
let exportWeek = null;
let exportCats = null; // Set of categories; null = pick the default on open
let exportOnlyChecked = false;
let exportCols = 0; // 0 = auto
let exportShowResults = false;

function exportResultCell(p) {
  if (!exportShowResults) return "";
  if (p.result === "win" || p.result === "loss") return `<span class="pe-units">${fmtUnits(unitsForPlay(p))}</span>`;
  return `<span class="pe-units pe-units-muted">${p.result ? RESULT_LABELS[p.result] : "Pending"}</span>`;
}

function exportWeekPlays() {
  return loadPossiblePlays().filter((p) => p.week === exportWeek);
}
function exportPlays() {
  let list = exportWeekPlays().filter((p) => exportCats.has(p.category));
  if (exportOnlyChecked) list = list.filter((p) => wheelSelected.has(p.id));
  return list;
}
// TDs first, then props A-Z, main lines last.
function exportCategoryOrder(a, b) {
  const rank = (c) => (c === "Anytime TD" ? 0 : c === "First TD" ? 1 : GAME_LINE_CATEGORIES[c] ? 3 : 2);
  return rank(a) - rank(b) || a.localeCompare(b);
}
function exportAutoCols(rowCount, groupCount) {
  const units = rowCount + groupCount * 1.5;
  return units <= 14 ? 1 : units <= 32 ? 2 : units <= 60 ? 3 : 4;
}
function exportTitle(cats) {
  if (cats.length === 1) return `${cats[0]} Plays`;
  if (cats.length && cats.every((c) => betTypeGroup(c) === "TDs")) return "TD Plays";
  if (cats.length && cats.every((c) => betTypeGroup(c) === "Props")) return "Player Props";
  return "Plays";
}
function renderExportCard() {
  const list = exportPlays();
  if (!list.length) return `<p class="no-data-note">No plays match. Check a category above.</p>`;
  const cats = [...new Set(list.map((p) => p.category))].sort(exportCategoryOrder);
  const cols = exportCols || exportAutoCols(list.length, cats.length);
  const groups = cats
    .map((c) => {
      const rows = list
        .filter((p) => p.category === c)
        .sort((a, b) => a.matchup.localeCompare(b.matchup) || parseFloat(a.odds) - parseFloat(b.odds))
        .map(
          (p) => `<div class="pe-row${exportShowResults ? ` pe-row-${p.result || "pending"}` : ""}">
            <span class="pe-logo">${exportPlayLogo(p)}</span>
            <span class="pe-play">${exportPlayText(p)}</span>
            <span class="pe-odds">${showOdds(p.odds)}</span>${exportResultCell(p)}
          </div>`
        )
        .join("");
      const count = list.filter((p) => p.category === c).length;
      return `<div class="pe-group-head"><span>${c}</span><span class="pe-count">${count}</span></div>${rows}`;
    })
    .join("");
  // Prop rows carry "Over 67.5" after the name, so they get wider columns.
  // A results column adds room for "+1.50u".
  const colWidth = (list.some((p) => exportPlayText(p).length > 20) ? 300 : 250) + (exportShowResults ? 62 : 0);
  // The record and "N pending" need the title bar wider than one column.
  const width = Math.max(cols * colWidth + (cols - 1) * 14 + 28, exportShowResults ? 440 : 0);
  let total = `<span class="pe-total">${list.length} plays</span>`;
  if (exportShowResults) {
    const t = tallyResults(list);
    const pushVoid = t.push + t.void;
    const tone = t.win + t.loss === 0 ? "" : t.units >= 0 ? " pe-record-up" : " pe-record-down";
    total = `<span class="pe-record${tone}">${t.win}-${t.loss}${pushVoid ? `-${pushVoid}` : ""}<b>${fmtUnits(t.units)}</b></span>${t.pending ? `<span class="pe-total">${t.pending} pending</span>` : ""}`;
  }
  return `<div id="plays-export-card" class="pe-card" style="width:${width}px">
    <div class="pe-head"><span class="brand-mark">GMG</span><span class="pe-title">Week ${exportWeek} &middot; ${exportTitle(cats)}</span>${total}</div>
    <div class="pe-body" style="column-count:${cols}">${groups}</div>
  </div>`;
}
function renderExportModalContent() {
  const all = loadPossiblePlays();
  const weeks = [...new Set(all.map((p) => p.week))].sort((a, b) => b - a);
  const weekButtons = weeks
    .map((w) => `<button type="button" class="quick-select-week-btn pe-week-btn${w === exportWeek ? " active" : ""}" data-week="${w}">Week ${w}</button>`)
    .join("");
  const weekPlays = exportWeekPlays();
  const cats = [...new Set(weekPlays.map((p) => p.category))].sort(exportCategoryOrder);
  const catChecks = cats
    .map((c) => {
      const n = weekPlays.filter((p) => p.category === c).length;
      return `<label class="pe-check"><input type="checkbox" class="pe-cat" data-entry="${encodeDataAttr(c)}"${exportCats.has(c) ? " checked" : ""}> ${c} <span class="muted-label">(${n})</span></label>`;
    })
    .join("");
  const checkedHere = weekPlays.filter((p) => wheelSelected.has(p.id)).length;
  const onlyChecked = checkedHere
    ? `<label class="pe-check"><input type="checkbox" id="pe-only-checked"${exportOnlyChecked ? " checked" : ""}> Only the ${checkedHere} plays I checked in the list</label>`
    : "";
  const colButtons = [0, 1, 2, 3, 4]
    .map((n) => `<button type="button" class="quick-select-week-btn pe-col-btn${n === exportCols ? " active" : ""}" data-cols="${n}">${n || "Auto"}</button>`)
    .join("");
  return `<h2 class="modal-title">&#128247; Photo export</h2>
    <div class="pe-controls">
      <div class="pe-control-row"><span class="quick-select-label">Week:</span>${weekButtons}</div>
      <div class="pe-control-row"><span class="quick-select-label">Include:</span>${catChecks}</div>
      ${onlyChecked ? `<div class="pe-control-row">${onlyChecked}</div>` : ""}
      <div class="pe-control-row"><label class="pe-check"><input type="checkbox" id="pe-show-results"${exportShowResults ? " checked" : ""}> Show results (wins, losses, units)</label></div>
      <div class="pe-control-row"><span class="quick-select-label">Columns:</span>${colButtons}
        <button type="button" id="pe-save-btn" class="wheel-spin-btn pe-save-btn">Save image</button></div>
    </div>
    <div class="pe-preview">${renderExportCard()}</div>`;
}
function refreshExportModal() {
  document.getElementById("export-modal-content").innerHTML = renderExportModalContent();
}
function exportDefaultCats() {
  const cats = [...new Set(exportWeekPlays().map((p) => p.category))];
  const tds = cats.filter((c) => betTypeGroup(c) === "TDs");
  exportCats = new Set(tds.length ? tds : cats);
}
function openExportModal() {
  if (!document.getElementById("export-modal")) {
    const overlay = document.createElement("div");
    overlay.id = "export-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box">
      <button type="button" class="modal-close" aria-label="Close">&times;</button>
      <div id="export-modal-content"></div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => (overlay.hidden = true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".modal-close").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  const weeks = [...new Set(loadPossiblePlays().map((p) => p.week))].sort((a, b) => b - a);
  if (!weeks.includes(exportWeek)) {
    exportWeek = weeks.includes(quickSelectWeek) ? quickSelectWeek : weeks[0];
    exportCats = null;
  }
  if (!exportCats) exportDefaultCats();
  exportOnlyChecked = exportPlays().some((p) => wheelSelected.has(p.id));
  exportShowResults = exportWeekPlays().some((p) => p.result);
  refreshExportModal();
  document.getElementById("export-modal").hidden = false;
}
async function saveExportImage() {
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
    a.download = `gmg-week-${exportWeek}-${exportTitle([...exportCats]).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
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

document.addEventListener("click", (e) => {
  if (e.target.closest("#photo-export-btn")) return openExportModal();
  if (e.target.closest("#pe-save-btn")) return saveExportImage();
  const weekBtn = e.target.closest(".pe-week-btn");
  if (weekBtn) {
    exportWeek = Number(weekBtn.dataset.week);
    exportDefaultCats();
    exportShowResults = exportWeekPlays().some((p) => p.result);
    return refreshExportModal();
  }
  const colBtn = e.target.closest(".pe-col-btn");
  if (colBtn) {
    exportCols = Number(colBtn.dataset.cols);
    refreshExportModal();
  }
});
document.addEventListener("change", (e) => {
  const cat = e.target.closest(".pe-cat");
  if (cat) {
    const c = decodeDataAttr(cat.dataset.entry);
    if (cat.checked) exportCats.add(c);
    else exportCats.delete(c);
    return refreshExportModal();
  }
  if (e.target.closest("#pe-only-checked")) {
    exportOnlyChecked = e.target.checked;
    refreshExportModal();
  }
  if (e.target.closest("#pe-show-results")) {
    exportShowResults = e.target.checked;
    refreshExportModal();
  }
});

// Rows + week sections only -- deliberately NOT touching quick-select-bar,
// so a quick-select checkbox toggle (see the "change" handler above) can
// call just this and leave the open dropdown alone. renderPossiblePlays
// (below) calls both, for everything else (initial load, add/remove a
// play, week-independent state changes).
function renderPlaysList() {
  const plays = loadPossiblePlays();
  const emptyEl = document.getElementById("empty-state");
  const contentEl = document.getElementById("plays-content");

  if (plays.length === 0) {
    emptyEl.hidden = false;
    contentEl.innerHTML = "";
    updateWheelActionBar();
    return;
  }
  emptyEl.hidden = true;

  const byWeek = {};
  plays.forEach((p) => {
    (byWeek[p.week] = byWeek[p.week] || []).push(p);
  });
  const weeks = Object.keys(byWeek)
    .map(Number)
    .sort((a, b) => b - a);

  contentEl.innerHTML = weeks
    .map((week, i) => {
      // Newest plays always land at the very top (both a new week's own
      // section, and the top row within a week -- see the sorts below),
      // so pin the reminder to the top of the top section only, right
      // between its header and the first play -- it always stays the
      // first thing visible instead of getting buried under a growing list.
      const reminder = i === 0 ? `<p class="pikkit-reminder">Always line shop with Pikkit! (Use Code "GMG")</p>` : "";
      const rows = byWeek[week]
        .slice()
        .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
        .map((p) => {
          const pct = oddsToImpliedPct(p.odds);
          const checked = wheelSelected.has(p.id) ? " checked" : "";
          const resultLabel = p.result ? RESULT_LABELS[p.result] : "Pending";
          return `<tr>
            <td><input type="checkbox" class="wheel-select" data-id="${p.id}"${checked}></td>
            <td>${p.matchup}</td>
            <td>${p.category}</td>
            <td>${p.team ? teamLogoMini(p.team) : ""} ${playDescriptionHtml(p)}</td>
            <td class="num">${showOdds(p.odds)}${pct !== null ? ` <span class="muted-label">(${pct}%)</span>` : ""}${p.book ? ` <span class="muted-label">(${p.book})</span>` : ""}</td>
            <td><span class="pick-result pick-result-${p.result || "pending"}">${resultLabel}</span></td>
            <td><button type="button" class="pick-edit-btn" data-remove-id="${p.id}">Remove</button></td>
          </tr>`;
        })
        .join("");
      return `<div class="section-wrap">
        <h2 class="section-title">Week ${week}</h2>
        ${reminder}
        <table class="data-table possible-plays-table">
          <thead><tr><th></th><th>Matchup</th><th>Type</th><th>Play</th><th>Odds</th><th>Result</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");

  contentEl.querySelectorAll("[data-remove-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wheelSelected.delete(btn.dataset.removeId);
      savePossiblePlays(loadPossiblePlays().filter((p) => p.id !== btn.dataset.removeId));
      renderPossiblePlays();
    });
  });

  updateWheelActionBar();
}

function renderPossiblePlays() {
  renderQuickSelectBar();
  renderPlaysList();
}

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".wheel-select");
  if (!cb) return;
  if (cb.checked) wheelSelected.add(cb.dataset.id);
  else wheelSelected.delete(cb.dataset.id);
  updateWheelActionBar();
});

// ---- Parlay Wheel ----
// A fun, ephemeral (not saved anywhere) randomizer: spin picks one of the
// checked plays at random, then removes every OTHER play from the same
// game before the next spin -- so a finished parlay can never carry two
// legs from the same matchup. Keeps spinning until the requested leg
// count is hit or the wheel runs out of distinct games, whichever's first.

function distinctGameCount(list) {
  return new Set(list.map((p) => p.matchup)).size;
}

function ensureWheelModal() {
  if (document.getElementById("wheel-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "wheel-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box wheel-modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="wheel-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeWheelModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeWheelModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeWheelModal();
  });
}
function closeWheelModal() {
  const el = document.getElementById("wheel-modal");
  if (el) el.hidden = true;
}

// Fallback palette for plays with no team (general totals/spreads) -- team
// plays use their own accent color like everywhere else on the site.
const WHEEL_FALLBACK_COLORS = ["#e63946", "#f4a261", "#2a9d8f", "#8338ec", "#ffb703", "#118ab2", "#ef476f", "#06d6a0"];

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function wheelSliceD(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

// 600px -- big enough that even a wheel with 30+ slices keeps names and
// logos readable, per the explicit ask to size this for "see everything
// clearly" rather than optimizing for a compact modal.
const WHEEL_SIZE = 600;

// "First initial. Last name" for a real player description (Amon-Ra St.
// Brown -> A. St. Brown) -- game-line plays (Spread/Total/Moneyline)
// aren't player names at all ("Bills -3.5"), so those pass through
// untouched. Collision-aware: if two players in the SAME wheel would
// abbreviate to the same string (Bijan Robinson / Brian Robinson Jr. both
// land on "B. Robinson"), grows the shared prefix just for that colliding
// group until they're distinct again, capped at the shorter first name's
// own length so it never asks for more letters than exist.
function wheelIsPlayerName(p) {
  return !GAME_LINE_CATEGORIES[p.category];
}
// A saved player play's description with the player's name opening the
// player card ("Name Over 13.5" -> linked "Name" + " Over 13.5").
function playDescriptionHtml(p) {
  if (!p.team || !wheelIsPlayerName(p) || typeof playerClick !== "function") return p.description;
  const m = p.description.match(/^(.*?)( (?:Over|Under) [\d.]+)?$/);
  return `${playerClick(p.team, m[1])}${m[2] || ""}`;
}
function wheelAbbreviate(name, prefixLen) {
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  return `${parts[0].slice(0, prefixLen)}. ${parts.slice(1).join(" ")}`;
}
// Groups by initial+surname with generational suffixes (Jr./Sr./II-IV)
// stripped out, NOT by the exact abbreviated string -- "B. Robinson" and
// "B. Robinson Jr." never collide as literal strings (Bijan Robinson /
// Brian Robinson Jr.), but they're exactly the confusing pair the request
// called out, so the check has to see past that trailing suffix to catch
// it.
const NAME_SUFFIX_RE = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
function wheelCollisionKey(name) {
  const parts = name.trim().split(" ").filter((w) => !NAME_SUFFIX_RE.test(w));
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[0][0]}.${parts[parts.length - 1]}`.toLowerCase();
}
function wheelLabels(pool) {
  const base = pool.map((p) => (wheelIsPlayerName(p) ? wheelAbbreviate(p.description, 1) : p.description));
  const groups = {};
  pool.forEach((p, i) => {
    const key = wheelIsPlayerName(p) ? wheelCollisionKey(p.description) : `__${i}`;
    (groups[key] = groups[key] || []).push(i);
  });
  const result = base.slice();
  Object.values(groups).forEach((idxs) => {
    if (idxs.length < 2) return;
    const maxLen = Math.max(...idxs.map((i) => pool[i].description.split(" ")[0].length));
    for (let n = 2; n <= maxLen; n++) {
      const attempt = idxs.map((i) => wheelAbbreviate(pool[i].description, n));
      if (new Set(attempt).size === attempt.length) {
        idxs.forEach((i, k) => (result[i] = attempt[k]));
        return;
      }
    }
    idxs.forEach((i) => (result[i] = pool[i].description));
  });
  return result;
}

function renderWheelSvg(pool) {
  const n = pool.length;
  const size = WHEEL_SIZE;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  const segAngle = 360 / n;
  // More slices -> less arc length per label -> trim harder so text
  // doesn't run into its neighbors; a wheel of 3-4 plays gets to keep much
  // longer names than one with 30+.
  const maxChars = n <= 8 ? 22 : n <= 16 ? 16 : n <= 24 ? 12 : 9;
  const labels = wheelLabels(pool);
  const slices = pool
    .map((p, i) => {
      const start = i * segAngle;
      const end = start + segAngle;
      const mid = start + segAngle / 2;
      const color = p.team ? `rgb(${teamAccentRgb(p.team).join(",")})` : WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
      // Rotate the label to run ALONG the spoke (radially) instead of
      // tangent to the rim -- rotate(mid) alone points text along the
      // circle's circumference, which is what made every label curve
      // around the wheel instead of reading outward from center. The
      // extra -90 aligns it with the radius instead; the +180 on the
      // wheel's left/bottom half keeps it right-side-up for the viewer
      // rather than upside-down (same convention every prize-wheel
      // graphic uses), still along the same spoke either way.
      let rot = mid - 90;
      if (mid > 90 && mid < 270) rot += 180;
      const labelPos = polarToCartesian(cx, cy, r * 0.58, mid);
      const label = labels[i].length > maxChars ? `${labels[i].slice(0, maxChars - 1)}…` : labels[i];
      const logo = p.team
        ? (() => {
            const logoPos = polarToCartesian(cx, cy, r * 0.85, mid);
            const logoSize = n <= 12 ? 26 : n <= 24 ? 20 : 16;
            return `<image href="${teamLogoUrl(p.team)}" x="${(logoPos.x - logoSize / 2).toFixed(2)}" y="${(logoPos.y - logoSize / 2).toFixed(2)}" width="${logoSize}" height="${logoSize}"/>`;
          })()
        : "";
      return `<path d="${wheelSliceD(cx, cy, r, start, end)}" fill="${color}" stroke="#fff" stroke-width="1.5"/>
        ${logo}
        <text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" transform="rotate(${rot.toFixed(2)}, ${labelPos.x.toFixed(2)}, ${labelPos.y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${label}</text>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices}</svg>`;
}

let wheelState = null;

function openWheelModal(selectedPlays) {
  ensureWheelModal();
  // Always starts back at the small, centered leg-count screen -- the wide
  // layout only kicks in once a round with a real wheel is showing.
  document.querySelector("#wheel-modal .modal-box").classList.remove("wheel-modal-wide");
  const maxLegs = Math.min(10, distinctGameCount(selectedPlays));
  const content = document.getElementById("wheel-modal-content");
  if (maxLegs < 1) {
    content.innerHTML = `<h3>&#127920; Parlay Wheel</h3><p class="no-data-note">Check at least one play in the list first.</p>`;
    document.getElementById("wheel-modal").hidden = false;
    return;
  }
  const options = Array.from({ length: maxLegs }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === maxLegs ? " selected" : ""}>${n} leg${n > 1 ? "s" : ""}</option>`)
    .join("");
  content.innerHTML = `
    <div id="wheel-setup">
      <h3>&#127920; Parlay Wheel</h3>
      <p class="no-data-note">${selectedPlays.length} plays checked across ${distinctGameCount(selectedPlays)} games. Landing on a play clears the rest of its game from the wheel before the next spin.</p>
      <label class="wheel-legs-label">Parlay legs:
        <select id="wheel-legs-select">${options}</select>
      </label>
      <button type="button" id="wheel-start-btn" class="wheel-spin-btn">Start Spinning</button>
    </div>
    <div id="wheel-arena"></div>
  `;
  document.getElementById("wheel-modal").hidden = false;
  document.getElementById("wheel-start-btn").addEventListener("click", () => {
    const targetCount = parseInt(document.getElementById("wheel-legs-select").value, 10);
    wheelState = { pool: selectedPlays.slice(), legs: [], targetCount, original: selectedPlays };
    document.getElementById("wheel-setup").hidden = true;
    document.querySelector("#wheel-modal .modal-box").classList.add("wheel-modal-wide");
    renderWheelRound();
  });
}

function renderWheelSlip(legs, targetCount) {
  const items = legs.length
    ? legs.map((l) => `<li>${l.team ? teamLogoMini(l.team) : ""} ${l.description} <span class="muted-label">${showOdds(l.odds)}</span></li>`).join("")
    : `<li class="muted-label">No legs yet -- spin to add one.</li>`;
  return `<div class="wheel-slip"><h4>Your Parlay (${legs.length}/${targetCount})</h4><ul>${items}</ul></div>`;
}

function renderWheelRound() {
  const { pool, legs, targetCount } = wheelState;
  const arena = document.getElementById("wheel-arena");

  if (legs.length >= targetCount || pool.length === 0) {
    const shortNote = pool.length === 0 && legs.length < targetCount ? `<p class="no-data-note">Ran out of distinct games before reaching ${targetCount} legs.</p>` : "";
    arena.innerHTML = `${renderWheelSlip(legs, targetCount)}${shortNote}<p class="wheel-done">&#127881; Parlay complete &mdash; ${legs.length} leg${legs.length === 1 ? "" : "s"}!</p>
      <button type="button" id="wheel-restart-btn" class="wheel-spin-btn">New Parlay</button>`;
    document.getElementById("wheel-restart-btn").addEventListener("click", () => openWheelModal(wheelState.original));
    return;
  }

  // Only one game left standing -- nothing to randomize, just lock it in.
  if (pool.length === 1) {
    wheelState.legs = [...legs, pool[0]];
    wheelState.pool = [];
    renderWheelRound();
    return;
  }

  // Wheel on the left, the running parlay slip to the right of it -- both
  // side by side rather than the slip stacked above a now-much-bigger wheel.
  arena.innerHTML = `<div class="wheel-round-layout">
      <div class="wheel-col">
        <div class="wheel-wrap">
          <div class="wheel-pointer"></div>
          <div id="wheel-spinner">${renderWheelSvg(pool)}</div>
        </div>
        <button type="button" id="wheel-spin-btn" class="wheel-spin-btn">SPIN</button>
      </div>
      <div class="wheel-slip-col">${renderWheelSlip(legs, targetCount)}</div>
    </div>`;
  document.getElementById("wheel-spin-btn").addEventListener("click", spinWheel);
}

function spinWheel() {
  const spinBtn = document.getElementById("wheel-spin-btn");
  spinBtn.disabled = true;
  const { pool } = wheelState;
  const n = pool.length;
  const winIdx = Math.floor(Math.random() * n);
  const segAngle = 360 / n;
  const segCenter = winIdx * segAngle + segAngle / 2;
  const jitter = (Math.random() - 0.5) * (segAngle * 0.5);
  const extraSpins = 5 + Math.floor(Math.random() * 3);
  const targetRotation = extraSpins * 360 + (360 - segCenter - jitter);

  const spinner = document.getElementById("wheel-spinner");
  requestAnimationFrame(() => {
    spinner.style.transform = `rotate(${targetRotation}deg)`;
  });

  setTimeout(() => {
    const winner = pool[winIdx];
    wheelState.legs = [...wheelState.legs, winner];
    wheelState.pool = pool.filter((p) => p.matchup !== winner.matchup);
    renderWheelRound();
  }, 4200);
}

document.getElementById("open-wheel-btn").addEventListener("click", () => {
  const all = loadPossiblePlays();
  const chosen = all.filter((p) => wheelSelected.has(p.id));
  openWheelModal(chosen);
});

// This page normally reads localStorage only (see file-top comment), but
// grading needs the schedule's final scores and that week's TD scoring
// data, both of which only live in data.json -- so this is the one place
// on this page that fetches it. Render immediately off localStorage first
// (so the list isn't blank while the fetch is in flight), then re-render
// once graded.
renderPossiblePlays();
fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    document.getElementById("fallback-note").hidden = !data.is_fallback_season;
    regradeAllPossiblePlays(DATA);
    renderPossiblePlays();
  })
  .catch((err) => console.error("Couldn't load data.json for grading:", err));
