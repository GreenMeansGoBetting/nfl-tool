// Renders the shared Possible Plays list (storage layer lives in common.js
// since the odds modal and Game Previews' mainline checkboxes both write to
// it too) grouped by week, most recent week first. This is the only page
// that doesn't fetch data.json -- everything it needs is already in
// localStorage.
function renderPossiblePlays() {
  const plays = loadPossiblePlays();
  const emptyEl = document.getElementById("empty-state");
  const contentEl = document.getElementById("plays-content");

  if (plays.length === 0) {
    emptyEl.hidden = false;
    contentEl.innerHTML = "";
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
    .map((week) => {
      const rows = byWeek[week]
        .slice()
        .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
        .map((p) => {
          const pct = oddsToImpliedPct(p.odds);
          return `<tr>
            <td>${p.matchup}</td>
            <td>${p.category}</td>
            <td>${p.team ? teamLogoMini(p.team) : ""} ${p.description}</td>
            <td class="num">${p.odds}${pct !== null ? ` <span class="muted-label">(${pct}%)</span>` : ""}${p.book ? ` <span class="muted-label">(${p.book})</span>` : ""}</td>
            <td><button type="button" class="pick-edit-btn" data-remove-id="${p.id}">Remove</button></td>
          </tr>`;
        })
        .join("");
      return `<div class="section-wrap">
        <h2 class="section-title">Week ${week}</h2>
        <table class="data-table possible-plays-table">
          <thead><tr><th>Matchup</th><th>Type</th><th>Play</th><th>Odds</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");

  contentEl.querySelectorAll("[data-remove-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      savePossiblePlays(loadPossiblePlays().filter((p) => p.id !== btn.dataset.removeId));
      renderPossiblePlays();
    });
  });
}

renderPossiblePlays();
