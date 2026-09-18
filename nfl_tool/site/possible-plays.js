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

// ---- Grading ----
// Auto-grades every saved play win/loss/push once data.json has the final
// score (Spread/Total/Moneyline, sourced from game-overview.js) or that
// week's scoring data (Anytime TD/First TD, sourced from common.js's odds
// modal) -- these are the only two shapes of entry anything on the site
// ever adds to Possible Plays. A manual override (win/loss/void, from the
// Results modal below) always wins over a later auto re-grade, since a
// name-format mismatch between SGO's odds names and nflverse's play-by-play
// names is a known, accepted limitation everywhere else this site joins
// the two sources (see build_roster_position_lookup's docstring).
const GAME_LINE_CATEGORIES = { Spread: "spread", Total: "total", Moneyline: "moneyline" };

// game_overview.js builds ids as "<game_id>_<market>_<side>", and game_id
// itself contains underscores (e.g. "2025_01_KC_LAC") -- splitting on the
// known "_<market>_" substring instead of a naive split keeps the game_id
// intact.
function parseGameLineId(id, marketKey) {
  const suffix = `_${marketKey}_`;
  const idx = id.indexOf(suffix);
  if (idx === -1) return null;
  return { gameId: id.slice(0, idx), side: id.slice(idx + suffix.length) };
}

function gradeGameLinePlay(play, schedule) {
  const marketKey = GAME_LINE_CATEGORIES[play.category];
  if (!marketKey) return null;
  const parsed = parseGameLineId(play.id, marketKey);
  if (!parsed) return null;
  const game = (schedule || []).find((g) => g.game_id === parsed.gameId);
  if (!game || game.away_score == null || game.home_score == null) return null;

  if (marketKey === "moneyline") {
    if (game.home_score === game.away_score) return "push";
    const winner = game.home_score > game.away_score ? "home" : "away";
    return parsed.side === winner ? "win" : "loss";
  }
  const lineMatch = play.description.match(/([+-]?[\d.]+)\s*$/);
  const line = lineMatch ? parseFloat(lineMatch[1]) : null;
  if (line === null) return null;
  if (marketKey === "total") {
    const total = game.away_score + game.home_score;
    if (total === line) return "push";
    const over = total > line;
    return parsed.side === "over" ? (over ? "win" : "loss") : over ? "loss" : "win";
  }
  // spread -- description's trailing number is already signed from the
  // picked side's own perspective (build_stats.py's away/home_team_spread).
  const ownScore = parsed.side === "home" ? game.home_score : game.away_score;
  const oppScore = parsed.side === "home" ? game.away_score : game.home_score;
  const margin = ownScore - oppScore + line;
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}

function gradeTdPlay(play, tdResults) {
  const weekResults = (tdResults || {})[play.week];
  const teamResults = weekResults && weekResults[play.team];
  if (!teamResults) return null;
  const field = play.category === "First TD" ? "first_td" : "any_td";
  return teamResults[field].includes(play.description) ? "win" : "loss";
}

// Player-prop O/U markets (Player Props page's "Add to Possible Plays"
// checkboxes) -- these fell through autoGradePlay to a silent `null`
// (permanently Pending) until now, since only the TD and Spread/Total/ML
// shapes above ever had grading logic. Sourced from build_stats.py's
// compute_player_game_logs, which -- like the game-line schedule scores
// above -- is built from standard pbp columns only, so it's real and
// current the same week the game is played. "Fantasy Score" is deliberately left out:
// no fixed scoring format (PPR/half/standard) has been confirmed against
// SGO's own definition yet, and grading it against a guessed formula
// would be worse than leaving it Pending.
const PLAYER_OU_STAT_FIELDS = {
  "Receiving Yards": (g) => g.rec_yards,
  "Receptions": (g) => g.receptions,
  "Longest Reception": (g) => g.longest_rec,
  "Rushing Yards": (g) => g.rush_yards,
  "Rush Attempts": (g) => g.carries,
  "Longest Rush": (g) => g.longest_rush,
  "Rushing TDs": (g) => g.rush_td,
  "Passing Yards": (g) => g.pass_yards,
  "Pass Attempts": (g) => g.pass_att,
  "Completions": (g) => g.completions,
  "INTs Thrown": (g) => g.interceptions,
  "Longest Completion": (g) => g.longest_pass,
  "Passing TDs": (g) => g.pass_td,
  "Rush + Rec Yards": (g) => g.rush_yards + g.rec_yards,
  "Pass + Rush Yards": (g) => g.pass_yards + g.rush_yards,
};

// Strips a trailing generational suffix for a looser name match -- SGO and
// nflverse don't consistently agree on whether "Jr."/"II"/etc is part of a
// player's name (confirmed: SGO's "Omar Cooper" vs nflverse's own "Omar
// Cooper Jr." for the same person). A genuine nickname-vs-legal-name gap
// (e.g. "Chig" vs "Chigoziem" Okonkwo) is NOT handled here -- too easy to
// false-match a different player -- and stays the known, accepted
// limitation documented elsewhere in this codebase.
function stripNameSuffix(name) {
  return name.replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, "").trim();
}

function gradePlayerPropPlay(play, data) {
  const statFn = PLAYER_OU_STAT_FIELDS[play.category];
  if (!statFn || !play.team) return null;
  const m = play.description.match(/^(.*) (Over|Under) ([\d.]+)$/);
  if (!m) return null;
  const [, name, side, lineStr] = m;
  const line = parseFloat(lineStr);
  const teamLogs = data.player_game_logs[play.team] || {};
  let gameLogs = teamLogs[name];
  if (!gameLogs) {
    const target = stripNameSuffix(name);
    const matchKey = Object.keys(teamLogs).find((k) => stripNameSuffix(k) === target);
    if (matchKey) gameLogs = teamLogs[matchKey];
  }
  const gameLog = gameLogs && gameLogs.find((g) => g.week === play.week);
  if (!gameLog) return null;
  const actual = statFn(gameLog);
  if (actual === undefined || actual === null) return null;
  if (actual === line) return "push";
  const over = actual > line;
  return side === "Over" ? (over ? "win" : "loss") : over ? "loss" : "win";
}

function autoGradePlay(play, data) {
  if (play.category === "Anytime TD" || play.category === "First TD") {
    // player_td_results comes from play-by-play, which during a season's
    // fallback window (build_stats.py's resolve_season -- true whenever
    // nflverse hasn't published BOTH the season's pbp and participation
    // files yet) is a WHOLE DIFFERENT SEASON's data, just keyed by the
    // same week numbers. Grading a real current-season play against last
    // season's results for that week/team either silently finds no entry
    // (stays stuck on Pending) or, worse, coincidentally matches an
    // unrelated result from last year and confidently grades it wrong.
    // Skip TD grading entirely until real current-season data is live --
    // see regradeAllPossiblePlays for resetting any play already wrongly
    // graded this way before this fix shipped.
    if (data.is_fallback_season) return null;
    return gradeTdPlay(play, data.player_td_results);
  }
  if (GAME_LINE_CATEGORIES[play.category]) {
    return gradeGameLinePlay(play, data.schedule);
  }
  return gradePlayerPropPlay(play, data);
}

function regradeAllPossiblePlays(data) {
  if (!data) return loadPossiblePlays();
  const plays = loadPossiblePlays();
  let changed = false;
  const updated = plays.map((p) => {
    if (p.result_source === "manual") return p;
    // A TD play auto-graded during an earlier fallback-season run may
    // already be sitting on a wrong result -- reset it back to pending
    // rather than leaving a stale wrong grade in place forever.
    const isTdPlay = p.category === "Anytime TD" || p.category === "First TD";
    if (data.is_fallback_season && isTdPlay && p.result_source === "auto") {
      changed = true;
      return { ...p, result: null, result_source: null };
    }
    const result = autoGradePlay(p, data);
    if (result && result !== p.result) {
      changed = true;
      return { ...p, result, result_source: "auto" };
    }
    return p;
  });
  if (changed) savePossiblePlays(updated);
  return updated;
}

// Clicking the same active manual override again clears it, falling back
// to auto-grading (re-run right after) rather than leaving no way to undo
// a manual call.
function setManualResult(id, result) {
  const plays = loadPossiblePlays();
  const updated = plays.map((p) => {
    if (p.id !== id) return p;
    if (p.result_source === "manual" && p.result === result) {
      const { result: _r, result_source: _rs, ...rest } = p;
      return rest;
    }
    return { ...p, result, result_source: "manual" };
  });
  savePossiblePlays(updated);
}

const RESULT_LABELS = { win: "Win", loss: "Loss", push: "Push", void: "Void" };

// ---- Bet-type grouping (Results modal filters) ----
// Three buckets for the shows-content workflow: Main Lines (game-level),
// TDs (the site's original bread and butter), Props (everything else --
// every player O/U market). Deliberately a lookup for the two small,
// fixed-size categories rather than listing every prop category by name,
// so a new PLAYER_OU_MARKETS entry added in build_stats.py automatically
// falls into Props with no matching frontend change needed.
const BET_TYPE_GROUPS = {
  Spread: "Main Lines",
  Total: "Main Lines",
  Moneyline: "Main Lines",
  "Anytime TD": "TDs",
  "First TD": "TDs",
};
const BET_TYPES = ["Main Lines", "TDs", "Props"];
function betTypeGroup(category) {
  return BET_TYPE_GROUPS[category] || "Props";
}

// ---- Units ----
// Stake size scales down as the odds get longer, per a fixed house rule:
// 1u up through +500, 0.5u from +501-+1000, 0.25u beyond +1000 -- so one
// deep-longshot prop hit doesn't blow the unit ledger out of proportion to
// how big a bet it actually was. Negative odds (favorites) and anything up
// to +500 are always 1u.
function stakeForOdds(oddsStr) {
  const odds = parseFloat(oddsStr);
  if (isNaN(odds) || odds <= 500) return 1;
  if (odds <= 1000) return 0.5;
  return 0.25;
}
// American odds -> profit per 1u staked (e.g. -110 -> 0.91u, +150 -> 1.5u).
function americanOddsProfit(odds) {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
// Net units for one graded play at its own tiered stake size. 0 for a
// push/void or anything still Pending.
function unitsForPlay(play) {
  const stake = stakeForOdds(play.odds);
  if (play.result === "win") return stake * americanOddsProfit(parseFloat(play.odds));
  if (play.result === "loss") return -stake;
  return 0;
}

function tallyResults(list) {
  const win = list.filter((p) => p.result === "win").length;
  const loss = list.filter((p) => p.result === "loss").length;
  const push = list.filter((p) => p.result === "push").length;
  const voidCt = list.filter((p) => p.result === "void").length;
  const pending = list.filter((p) => !p.result).length;
  const decided = win + loss;
  const units = Math.round(list.reduce((sum, p) => sum + unitsForPlay(p), 0) * 100) / 100;
  return { win, loss, push, void: voidCt, pending, winPct: decided ? Math.round((win / decided) * 100) : null, units };
}
function fmtUnits(units) {
  return `${units >= 0 ? "+" : ""}${units.toFixed(2)}u`;
}

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
  const summary = renderResultsSummary(list);
  const headerCells = RESULT_SORT_COLUMNS.map((c) => `<th class="results-sort-th" data-col="${c.key}">${c.label}${sortArrowFor(c.key)}</th>`).join("");
  const rows = sortResultsPlays(list)
    .map((p) => {
      const resultLabel = p.result ? RESULT_LABELS[p.result] : "Pending";
      const unitsDisplay = p.result === "win" || p.result === "loss" ? fmtUnits(unitsForPlay(p)) : "--";
      const overrideBtns = ["win", "loss", "void"]
        .map((r) => `<button type="button" class="result-override-btn${p.result === r && p.result_source === "manual" ? " active" : ""}" data-id="${p.id}" data-result="${r}">${RESULT_LABELS[r]}</button>`)
        .join("");
      return `<tr class="result-row-${p.result || "pending"}">
        <td>${p.week}</td>
        <td>${p.matchup}</td>
        <td>${p.category}</td>
        <td>${p.team ? teamLogoMini(p.team) : ""} ${p.description}</td>
        <td class="num">${p.odds}</td>
        <td class="num">${unitsDisplay}</td>
        <td><span class="pick-result pick-result-${p.result || "pending"}">${resultLabel}</span></td>
        <td class="result-override-group">${overrideBtns}</td>
      </tr>`;
    })
    .join("");
  return `<h3>Possible Plays &mdash; Results</h3>
    ${filterBar}
    ${summary}
    <div class="results-table-scroll">
      <table class="data-table results-table">
        <thead><tr>${headerCells}<th>Override</th></tr></thead>
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
            <td>${p.team ? teamLogoMini(p.team) : ""} ${p.description}</td>
            <td class="num">${p.odds}${pct !== null ? ` <span class="muted-label">(${pct}%)</span>` : ""}${p.book ? ` <span class="muted-label">(${p.book})</span>` : ""}</td>
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
    ? legs.map((l) => `<li>${l.team ? teamLogoMini(l.team) : ""} ${l.description} <span class="muted-label">${l.odds}</span></li>`).join("")
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
