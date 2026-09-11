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

// One button per distinct market present in the saved list (Anytime TD,
// First TD, Receiving Yards, whatever's actually there) -- replaces the
// current wheel selection with exactly that market's plays, so "select all
// Anytime TD" means just those, not those added on top of whatever else
// was already checked. Manual checkboxes still work fine afterward for
// mixing in extras.
function renderQuickSelectBar() {
  const bar = document.getElementById("quick-select-bar");
  if (!bar) return;
  const categories = [...new Set(loadPossiblePlays().map((p) => p.category))].sort();
  if (categories.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const buttons = categories
    .map((c) => `<button type="button" class="quick-select-btn" data-entry="${encodeDataAttr(c)}">Select all: ${c}</button>`)
    .join("");
  bar.innerHTML = `<span class="quick-select-label">Quick select:</span>${buttons}<button type="button" id="quick-select-clear" class="quick-select-btn quick-select-clear-btn">Clear</button>`;
}

document.addEventListener("click", (e) => {
  const qsBtn = e.target.closest(".quick-select-btn");
  if (!qsBtn) return;
  if (qsBtn.id === "quick-select-clear") {
    wheelSelected.clear();
  } else {
    const category = decodeDataAttr(qsBtn.dataset.entry);
    wheelSelected.clear();
    loadPossiblePlays()
      .filter((p) => p.category === category)
      .forEach((p) => wheelSelected.add(p.id));
  }
  renderPossiblePlays();
});

function renderPossiblePlays() {
  const plays = loadPossiblePlays();
  const emptyEl = document.getElementById("empty-state");
  const contentEl = document.getElementById("plays-content");

  if (plays.length === 0) {
    emptyEl.hidden = false;
    contentEl.innerHTML = "";
    updateWheelActionBar();
    renderQuickSelectBar();
    return;
  }
  emptyEl.hidden = true;
  renderQuickSelectBar();

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
          const checked = wheelSelected.has(p.id) ? " checked" : "";
          return `<tr>
            <td><input type="checkbox" class="wheel-select" data-id="${p.id}"${checked}></td>
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
          <thead><tr><th></th><th>Matchup</th><th>Type</th><th>Play</th><th>Odds</th><th></th></tr></thead>
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

// 520px -- big enough that even a wheel with 30+ slices keeps names
// readable, per the explicit ask to size this for "see all player names"
// rather than optimizing for a compact modal.
const WHEEL_SIZE = 520;

function renderWheelSvg(pool) {
  const n = pool.length;
  const size = WHEEL_SIZE;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  const segAngle = 360 / n;
  // More slices -> less arc length per label -> trim harder so text
  // doesn't run into its neighbors; a wheel of 3-4 plays gets to keep much
  // longer names than one with 30+.
  const maxChars = n <= 8 ? 22 : n <= 16 ? 16 : n <= 24 ? 12 : 9;
  const slices = pool
    .map((p, i) => {
      const start = i * segAngle;
      const end = start + segAngle;
      const mid = start + segAngle / 2;
      const color = p.team ? `rgb(${teamAccentRgb(p.team).join(",")})` : WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
      const labelPos = polarToCartesian(cx, cy, r * 0.62, mid);
      const label = p.description.length > maxChars ? `${p.description.slice(0, maxChars - 1)}…` : p.description;
      return `<path d="${wheelSliceD(cx, cy, r, start, end)}" fill="${color}" stroke="#fff" stroke-width="1.5"/>
        <text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" transform="rotate(${mid.toFixed(2)}, ${labelPos.x.toFixed(2)}, ${labelPos.y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${label}</text>`;
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

renderPossiblePlays();
