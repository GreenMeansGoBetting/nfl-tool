// ---- Parlay Wheel (My Plays, every sport) ----
// A fun, ephemeral (not saved anywhere) randomizer: spin picks one of the
// chosen plays at random, then removes every OTHER play from the same
// game before the next spin -- so a finished parlay can never carry two
// legs from the same matchup. Keeps spinning until the requested leg
// count is hit or the wheel runs out of distinct games, whichever's first.
//
// The page that opens it says how a play looks, since each sport keeps its
// own teams: openParlayWheel(plays, { gameKey, text, logo, color, onRestart }).
//   gameKey(p): one game (sport + day + matchup, so two sports never clash)
//   text(p): the play as it reads (the slip); short(p), optional: the same on a slice; logo(p): a logo URL or ""; color(p): a CSS color or ""
//   onRestart(): "New Parlay" (My Plays goes back to its play picker)

let wheelLook = null;
let wheelState = null;

function distinctGameCount(list) {
  return new Set(list.map(wheelLook.gameKey)).size;
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
// The modal at its small, centered size (the play picker, the leg count).
function showWheelModal(html) {
  ensureWheelModal();
  document.querySelector("#wheel-modal .modal-box").classList.remove("wheel-modal-wide");
  document.getElementById("wheel-modal-content").innerHTML = html;
  document.getElementById("wheel-modal").hidden = false;
}

// Fallback palette for plays with no team color (general totals/spreads).
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

// "First initial. Last name" for a player play (Amon-Ra St. Brown Over 60.5
// -> A. St. Brown Over 60.5). Game-line plays (Spread/Total/Moneyline)
// aren't player names at all ("Bills -3.5"), so those pass through
// untouched. Collision-aware: if two players in the SAME wheel would
// abbreviate to the same string (Bijan Robinson / Brian Robinson Jr. both
// land on "B. Robinson"), grows the shared prefix just for that colliding
// group until they're distinct again, capped at the shorter first name's
// own length so it never asks for more letters than exist.
function wheelIsPlayerName(p) {
  return !!p.team && !GAME_LINE_CATEGORIES[p.category] && p.market !== "stack";
}
function wheelAbbreviate(name, prefixLen) {
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  return `${parts[0].slice(0, prefixLen)}. ${parts.slice(1).join(" ")}`;
}
// Groups by initial+surname with generational suffixes (Jr./Sr./II-IV)
// stripped out, NOT by the exact abbreviated string -- "B. Robinson" and
// "B. Robinson Jr." never collide as literal strings, but they're exactly
// the confusing pair, so the check has to see past that trailing suffix.
const NAME_SUFFIX_RE = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
function wheelCollisionKey(name) {
  const parts = name.trim().split(" ").filter((w) => !NAME_SUFFIX_RE.test(w));
  if (parts.length < 2) return name.toLowerCase();
  return `${parts[0][0]}.${parts[parts.length - 1]}`.toLowerCase();
}
function wheelLabels(pool) {
  const texts = pool.map(wheelLook.short || wheelLook.text);
  const base = pool.map((p, i) => (wheelIsPlayerName(p) ? wheelAbbreviate(texts[i], 1) : texts[i]));
  const groups = {};
  pool.forEach((p, i) => {
    const key = wheelIsPlayerName(p) ? wheelCollisionKey(texts[i]) : `__${i}`;
    (groups[key] = groups[key] || []).push(i);
  });
  const result = base.slice();
  Object.values(groups).forEach((idxs) => {
    if (idxs.length < 2) return;
    const maxLen = Math.max(...idxs.map((i) => texts[i].split(" ")[0].length));
    for (let n = 2; n <= maxLen; n++) {
      const attempt = idxs.map((i) => wheelAbbreviate(texts[i], n));
      if (new Set(attempt).size === attempt.length) {
        idxs.forEach((i, k) => (result[i] = attempt[k]));
        return;
      }
    }
    idxs.forEach((i) => (result[i] = texts[i]));
  });
  return result;
}

function renderWheelSvg(pool) {
  const n = pool.length;
  const size = WHEEL_SIZE;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  const segAngle = 360 / n;
  // More slices -> less arc length per label -> trim harder so text
  // doesn't run into its neighbors.
  const maxChars = n <= 8 ? 22 : n <= 16 ? 16 : n <= 24 ? 12 : 9;
  const labels = wheelLabels(pool);
  const slices = pool
    .map((p, i) => {
      const start = i * segAngle;
      const end = start + segAngle;
      const mid = start + segAngle / 2;
      const color = wheelLook.color(p) || WHEEL_FALLBACK_COLORS[i % WHEEL_FALLBACK_COLORS.length];
      // The label runs ALONG the spoke (radially); the +180 on the wheel's
      // left/bottom half keeps it right-side-up for the viewer.
      let rot = mid - 90;
      if (mid > 90 && mid < 270) rot += 180;
      const labelPos = polarToCartesian(cx, cy, r * 0.58, mid);
      const label = labels[i].length > maxChars ? `${labels[i].slice(0, maxChars - 1)}…` : labels[i];
      const src = wheelLook.logo(p);
      const logo = src
        ? (() => {
            const logoPos = polarToCartesian(cx, cy, r * 0.85, mid);
            const logoSize = n <= 12 ? 26 : n <= 24 ? 20 : 16;
            return `<image href="${src}" x="${(logoPos.x - logoSize / 2).toFixed(2)}" y="${(logoPos.y - logoSize / 2).toFixed(2)}" width="${logoSize}" height="${logoSize}"/>`;
          })()
        : "";
      return `<path d="${wheelSliceD(cx, cy, r, start, end)}" fill="${color}" stroke="#fff" stroke-width="1.5"/>
        ${logo}
        <text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" transform="rotate(${rot.toFixed(2)}, ${labelPos.x.toFixed(2)}, ${labelPos.y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${label}</text>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${slices}</svg>`;
}

// The leg-count screen for the chosen plays.
function openParlayWheel(plays, look) {
  wheelLook = look;
  const maxLegs = Math.min(10, distinctGameCount(plays));
  if (maxLegs < 1) {
    showWheelModal(`<h3>&#127920; Parlay Wheel</h3><p class="no-data-note">Pick at least one play first.</p>`);
    return;
  }
  const options = Array.from({ length: maxLegs }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === maxLegs ? " selected" : ""}>${n} Leg${n > 1 ? "s" : ""}</option>`)
    .join("");
  showWheelModal(`
    <div id="wheel-setup">
      <h3>&#127920; Parlay Wheel</h3>
      <p class="no-data-note">${plays.length} plays across ${distinctGameCount(plays)} games. Landing on a play clears the rest of its game from the wheel before the next spin.</p>
      <label class="wheel-legs-label">Parlay Legs:
        <select id="wheel-legs-select">${options}</select>
      </label>
      <button type="button" id="wheel-start-btn" class="wheel-spin-btn">Start Spinning</button>
    </div>
    <div id="wheel-arena"></div>
  `);
  document.getElementById("wheel-start-btn").addEventListener("click", () => {
    const targetCount = parseInt(document.getElementById("wheel-legs-select").value, 10);
    wheelState = { pool: plays.slice(), legs: [], targetCount };
    document.getElementById("wheel-setup").hidden = true;
    document.querySelector("#wheel-modal .modal-box").classList.add("wheel-modal-wide");
    renderWheelRound();
  });
}

function renderWheelSlip(legs, targetCount) {
  const items = legs.length
    ? legs.map((l) => {
        const src = wheelLook.logo(l);
        return `<li>${src ? `<img src="${src}" class="team-logo-mini" alt="" width="16" height="16">` : ""} ${wheelLook.text(l)} <span class="muted-label">${l.odds !== null && l.odds !== undefined && l.odds !== "" ? showOdds(l.odds) : ""}</span></li>`;
      }).join("")
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
    document.getElementById("wheel-restart-btn").addEventListener("click", () => wheelLook.onRestart());
    return;
  }

  // Only one game left standing -- nothing to randomize, just lock it in.
  if (pool.length === 1) {
    wheelState.legs = [...legs, pool[0]];
    wheelState.pool = [];
    renderWheelRound();
    return;
  }

  // Wheel on the left, the running parlay slip to the right of it.
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
    const game = wheelLook.gameKey(winner);
    wheelState.legs = [...wheelState.legs, winner];
    wheelState.pool = pool.filter((p) => wheelLook.gameKey(p) !== game);
    renderWheelRound();
  }, 4200);
}
