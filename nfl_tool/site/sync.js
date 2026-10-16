// ---- Member profile sync (Discord login) ----
// Saved plays, picks, notes and summary rails follow the logged-in Discord
// member to any device. localStorage stays the working copy -- every
// existing load*/save* function is unchanged and synchronous -- and this
// file mirrors the keys below to /api/state (functions/_middleware.js,
// Cloudflare D1), one row per member per key. Replaced the old
// owner-only Firebase sync.
//
// Merge rules:
//   * Every local save stamps the key's time (SYNC_META_KEY) and sends it
//     up; the server keeps the newest write per key.
//   * On load and whenever the tab regains focus, server values newer than
//     this device's copy replace it and the page redraws.
//   * Data saved in this browser BEFORE profiles existed (no stamp yet) is
//     merged with the profile rather than overwritten -- lists by id,
//     objects by key -- so a second device's old picks aren't lost.
// Off the Cloudflare site (local dev, profiles not set up) /api/state
// isn't there and everything quietly stays local-only.

// ---- Member settings (the gear beside the account chip; the owner, 2026-10-15) ----
// One gear on every page opens Settings: how odds are shown, the color set
// for good / middle / bad numbers, and My Books. Saved per member (synced
// below), read by every page as it draws, so these are globals: showOdds()
// for every price on the site, scaleHsla() for every red-to-green shade.
const GMG_SETTINGS_KEY = "nfl-tool.settings.v1"; // { odds: "american"|"decimal"|"percent", colors: set id, custom: {good, mid, bad} }
let gmgSettingsCache = null;
function gmgSettings() {
  if (!gmgSettingsCache) {
    try { gmgSettingsCache = JSON.parse(localStorage.getItem(GMG_SETTINGS_KEY)) || {}; } catch (e) { gmgSettingsCache = {}; }
  }
  return gmgSettingsCache;
}
function saveGmgSettings(value) {
  gmgSettingsCache = value;
  try { localStorage.setItem(GMG_SETTINGS_KEY, JSON.stringify(value)); } catch (e) {}
  window.NFLSync?.push(GMG_SETTINGS_KEY, value);
}

// A price (American odds: a number or text like "+150") the way this member
// reads odds: American (the default), decimal, or the chance it implies.
// Saved plays keep American; only what is shown changes.
function showOdds(n) {
  if (n === null || n === undefined || n === "") return "";
  const v = typeof n === "number" ? n : parseFloat(String(n).replace(/[^\d.+-]/g, ""));
  if (!Number.isFinite(v) || Math.abs(v) < 100) return String(n);
  const mode = gmgSettings().odds;
  const dec = v > 0 ? 1 + v / 100 : 1 + 100 / -v;
  if (mode === "decimal") return dec.toFixed(2);
  if (mode === "percent") return `${(100 / dec).toFixed(1)}%`;
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}

// Color sets for good / middle / bad numbers. "standard" is the site's own
// green / yellow / red and changes nothing; the others repaint the tier
// tokens (--good, --mid, --bad) and every red-to-green shade.
const GMG_COLOR_SETS = {
  standard: { name: "Green / Red", good: "#22c55e", mid: "#eab308", bad: "#ef4444" },
  blueorange: { name: "Blue / Orange", note: "Easiest with red-green color blindness", good: "#3b82f6", mid: "#eab308", bad: "#e2531d" },
  bluered: { name: "Blue / Red", good: "#3b82f6", mid: "#eab308", bad: "#ef4444" },
  tealpink: { name: "Teal / Pink", good: "#14b8a6", mid: "#eab308", bad: "#ec4899" },
  custom: { name: "Pick my own", good: "#22c55e", mid: "#eab308", bad: "#ef4444" },
};
function gmgColorSet() {
  const s = gmgSettings();
  const id = GMG_COLOR_SETS[s.colors] ? s.colors : "standard";
  if (id === "standard") return null;
  return id === "custom" ? { ...GMG_COLOR_SETS.custom, ...(s.custom || {}) } : GMG_COLOR_SETS[id];
}
const gmgRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const gmgMix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

// A shade on the site's red (hue 0) to yellow (60) to green (120+) scale.
// With the standard colors it is exactly hsla(hue, s%, l%, a); with another
// set, the same spot between that set's bad, middle and good colors.
function scaleHsla(hue, s, l, a = 1) {
  const set = gmgColorSet();
  if (!set) return a === 1 ? `hsl(${hue},${s}%,${l}%)` : `hsla(${hue},${s}%,${l}%,${a})`;
  const [good, mid, bad] = [gmgRgb(set.good), gmgRgb(set.mid), gmgRgb(set.bad)];
  let rgb = hue >= 60 ? gmgMix(mid, good, Math.min(1, (hue - 60) / 60)) : gmgMix(bad, mid, Math.max(0, hue / 60));
  if (l > 45) rgb = gmgMix(rgb, [255, 255, 255], (l - 45) / 55);
  else if (l < 45) rgb = gmgMix(rgb, [0, 0, 0], (45 - l) / 45);
  return `rgba(${rgb.join(",")},${a})`;
}

// The tier tokens for a chosen set, both themes (a style tag after the
// stylesheets, so it wins without touching style.css).
function applyGmgColors() {
  let tag = document.getElementById("gmg-color-set");
  const set = gmgColorSet();
  if (!set) {
    if (tag) tag.remove();
    return;
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "gmg-color-set";
    document.head.appendChild(tag);
  }
  const tokens = (light) => ["good", "mid", "bad"].map((k) => {
    const rgb = gmgRgb(set[k]);
    const text = light ? gmgMix(rgb, [0, 0, 0], 0.55) : gmgMix(rgb, [255, 255, 255], 0.4);
    return `--${k}:rgb(${rgb});--${k}-rgb:${rgb.join(", ")};--${k}-text:rgb(${text});`;
  }).join("");
  tag.textContent = `html:root{${tokens(false)}}html:root[data-theme="light"]{${tokens(true)}}`;
}
applyGmgColors();

// My Books (synced per member): the books a member hides. Every price list
// and best price (book-odds.js) skips them.
const GMG_BOOKS = {
  draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", caesars: "Caesars", fanatics: "Fanatics",
  bet365: "bet365", thescore: "theScore", betrivers: "BetRivers", hard_rock: "Hard Rock", bally_bet: "Bally Bet",
  circa: "Circa", pinnacle: "Pinnacle", novig: "Novig", prophetx: "ProphetX", kalshi: "Kalshi",
  polymarket_us: "Polymarket", fliff: "Fliff",
};
const MY_BOOKS_KEY = "nfl-tool.my-books.v1"; // { hidden: [book ids] }
function myBooks() {
  try { return JSON.parse(localStorage.getItem(MY_BOOKS_KEY)) || {}; } catch (e) { return {}; }
}
function saveMyBooks(value) {
  try { localStorage.setItem(MY_BOOKS_KEY, JSON.stringify(value)); } catch (e) {}
  window.NFLSync?.push(MY_BOOKS_KEY, value);
}

// The Settings window. Books change the open page at once; odds and colors
// redraw it when the window closes (every page draws them as it renders).
const GMG_ODDS_FORMATS = [
  { id: "american", name: "American", sample: "-110 / +150" },
  { id: "decimal", name: "Decimal", sample: "1.91 / 2.50" },
  { id: "percent", name: "Percent", sample: "52.4% / 40.0%" },
];
let gmgSettingsOpenedWith = null;
function gmgSettingsModal() {
  let overlay = document.getElementById("settings-modal");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "settings-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = '<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div class="set-content"></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".modal-close, .set-done")) return closeGmgSettings();
    const fmt = e.target.closest("[data-odds-format]");
    if (fmt) {
      saveGmgSettings({ ...gmgSettings(), odds: fmt.dataset.oddsFormat });
      return drawGmgSettings();
    }
    const set = e.target.closest("[data-color-set]");
    if (set) {
      saveGmgSettings({ ...gmgSettings(), colors: set.dataset.colorSet });
      applyGmgColors();
      return drawGmgSettings();
    }
    const chip = e.target.closest(".bo-chip");
    if (chip) {
      const hidden = new Set(myBooks().hidden || []);
      hidden.has(chip.dataset.book) ? hidden.delete(chip.dataset.book) : hidden.add(chip.dataset.book);
      saveMyBooks({ hidden: [...hidden] });
      drawGmgSettings();
      document.dispatchEvent(new CustomEvent("my-books-changed"));
    }
  });
  overlay.addEventListener("change", (e) => {
    const pick = e.target.closest("[data-custom-color]");
    if (!pick) return;
    const s = gmgSettings();
    const custom = { ...GMG_COLOR_SETS.custom, ...(s.custom || {}), [pick.dataset.customColor]: pick.value };
    saveGmgSettings({ ...s, colors: "custom", custom });
    applyGmgColors();
    drawGmgSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeGmgSettings();
  });
  return overlay;
}
function drawGmgSettings() {
  const overlay = gmgSettingsModal();
  const s = gmgSettings();
  const odds = GMG_ODDS_FORMATS.some((f) => f.id === s.odds) ? s.odds : "american";
  const colors = GMG_COLOR_SETS[s.colors] ? s.colors : "standard";
  const hidden = myBooks().hidden || [];
  const swatches = (set) => {
    const [good, mid, bad] = [gmgRgb(set.good), gmgRgb(set.mid), gmgRgb(set.bad)];
    return [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const t = k / 6;
      const rgb = t <= 0.5 ? gmgMix(good, mid, t * 2) : gmgMix(mid, bad, (t - 0.5) * 2);
      return `<i style="background:rgb(${rgb})"></i>`;
    }).join("");
  };
  const custom = { ...GMG_COLOR_SETS.custom, ...(s.custom || {}) };
  overlay.querySelector(".set-content").innerHTML = `<h3 class="bo-title">Settings</h3>
    <div class="bo-sub">Saved to your account, on every page and device.</div>
    <div class="bo-lbl bo-field">Odds format</div>
    <div class="set-odds">${GMG_ODDS_FORMATS.map((f) => `<button type="button" class="set-opt${f.id === odds ? " set-on" : ""}" data-odds-format="${f.id}"><b>${f.name}</b><small>${f.sample}</small></button>`).join("")}</div>
    <div class="bo-lbl bo-field">Colors <span class="set-hint">good to bad</span></div>
    <div class="set-colors">${Object.entries(GMG_COLOR_SETS).map(([id, set]) => {
      const shown = id === "custom" ? custom : set;
      return `<button type="button" class="set-opt set-color${id === colors ? " set-on" : ""}" data-color-set="${id}"><b>${set.name}</b><span class="set-swatch">${swatches(shown)}</span>${set.note ? `<small>${set.note}</small>` : ""}</button>`;
    }).join("")}</div>
    ${colors === "custom" ? `<div class="set-custom">${[["good", "Good"], ["mid", "Middle"], ["bad", "Bad"]].map(([k, label]) => `<label><input type="color" value="${custom[k]}" data-custom-color="${k}"> ${label}</label>`).join("")}</div>` : ""}
    <div class="bo-lbl bo-field">My Books</div>
    <div class="bo-sub">Only the books you turn on are shown and used for the best price.</div>
    <div class="bo-chips set-books">${Object.entries(GMG_BOOKS).map(([id, name]) => `<button type="button" class="bo-chip${hidden.includes(id) ? "" : " bo-on"}" data-book="${id}"><span class="bo-box">${hidden.includes(id) ? "" : "&#10003;"}</span>${name}</button>`).join("")}</div>
    <div class="set-actions"><button type="button" class="set-done">Done</button></div>`;
}
function openGmgSettings(section) {
  const overlay = gmgSettingsModal();
  gmgSettingsOpenedWith = JSON.stringify({ odds: gmgSettings().odds, colors: gmgSettings().colors, custom: gmgSettings().custom });
  drawGmgSettings();
  overlay.hidden = false;
  if (section === "books") overlay.querySelector(".set-books")?.scrollIntoView({ block: "center" });
}
function closeGmgSettings() {
  const overlay = document.getElementById("settings-modal");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  const now = JSON.stringify({ odds: gmgSettings().odds, colors: gmgSettings().colors, custom: gmgSettings().custom });
  if (now !== gmgSettingsOpenedWith) location.reload(); // every price and shade is drawn with the page
}
window.GMGSettings = { open: openGmgSettings };

// ---- What's new (the owner, 2026-10-15) ----
// The site's updates, in a popup each member sees once: the first page they
// open after a new update is posted shows the ones they haven't seen, with
// the earlier ones folded underneath. "What's new" in the account chip opens
// it again. A NEW UPDATE IS ONE ENTRY AT THE TOP of this list (id = the date;
// a second one on the same day gets "2026-10-15b"). `text` is the owner's
// wording; the first words in <b> name the feature.
const GMG_UPDATES = [
  {
    id: "2026-10-15",
    items: [
      ["🏒", "<b>NHL Icebreaker</b> is live under NHL Promo Tools and helps you find the quickest goal of the 7 PM slate, with a Historical Data popup."],
      ["🏒", "<b>NHL Best Plays</b> is a new page that puts every Shots and Goals edge in one list, with a GMG Fair price next to each play’s odds."],
      ["🏒", "<b>NHL Shots &amp; Goals</b> pages are cleaner, with trimmed tables, a new Rating column and a toggle to show advanced stats."],
      ["🏒", "<b>The NHL top bar</b> has been rebuilt with Games, a Player Props menu (Shots, Goals, Best Plays) and Promo Tools, so everything is one click away."],
      ["⚙️", "<b>A Settings gear</b> on every page lets you pick your odds format, choose a color set and save “My Books” so the prices you see match where you bet."],
      ["🎨", "<b>A new site-wide font</b> makes every page in NFL, NBA and NHL easier to read."],
      ["🏈", "<b>NFL injury matching</b> is more reliable, so injured players get flagged even when the injury report spells a name differently."],
      ["⚡", "<b>Updates go live faster</b> behind the scenes, so fixes and new features reach the site sooner."],
    ],
  },
];
// The newest update id the member has seen (synced: once per member, not
// once per device or per sport address).
const GMG_UPDATES_SEEN_KEY = "nfl-tool.updates-seen.v1";

(function () {
  const KEYS = [
    "nfl-tool.possible-plays.v1",
    "nfl-tool.picks.v1",
    "nfl-tool.game-notes.v1",
    "nfl-tool.td-notes.v1",
    "nfl-tool.manual-outs.v1",
    "nfl-tool.props-summary-picks.v1",
    "nfl-tool.summary-picks.v1",
    "nfl-tool.model-presets.v1",
    "nfl-tool.my-books.v1",
    GMG_SETTINGS_KEY,
    GMG_UPDATES_SEEN_KEY,
  ];
  const SYNC_META_KEY = "nfl-tool.sync-meta.v1"; // { key: last local save (ms) }
  const PUSH_DELAY_MS = 600;

  let enabled = false;
  let applyingRemote = false;
  const pushTimers = {};

  const readMeta = () => {
    try {
      return JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}");
    } catch (e) {
      return {};
    }
  };
  const writeMeta = (meta) => {
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
    } catch (e) {
      // storage full/blocked -- sync just can't track this device
    }
  };

  async function putKey(key, raw, updated) {
    const res = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ k: key, v: raw, updated }),
    });
    if (!res.ok) throw new Error(`sync ${res.status}`);
  }

  // Lists of records merge by id, plain objects by key; `remote` wins a tie.
  function mergeValues(local, remote) {
    if (Array.isArray(local) && Array.isArray(remote)) {
      const byId = new Map();
      const noId = [];
      for (const item of [...local, ...remote]) {
        if (item && typeof item === "object" && item.id !== undefined) byId.set(item.id, item);
        else noId.push(item);
      }
      return [...byId.values(), ...noId.filter((x, i) => noId.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i)];
    }
    if (local && remote && typeof local === "object" && typeof remote === "object" && !Array.isArray(local) && !Array.isArray(remote)) {
      return { ...local, ...remote };
    }
    return remote;
  }

  function refreshPage() {
    if (typeof DATA === "undefined" || !DATA) return; // data.json not loaded yet; its own render picks the values up
    if (typeof window.regradeAllPossiblePlays === "function") window.regradeAllPossiblePlays(DATA);
    if (typeof window.render === "function") window.render();
    else if (typeof window.renderPossiblePlays === "function") window.renderPossiblePlays();
  }

  async function pull() {
    let data;
    try {
      const res = await fetch("/api/state", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return false;
      data = await res.json();
    } catch (e) {
      return false;
    }
    enabled = true;
    showAccount(data.user);
    // Owner-only controls (Update Odds) -- hidden for members by style.css.
    if (data.user && data.user.owner) document.documentElement.classList.add("is-owner");
    const server = data.state || {};
    const meta = readMeta();
    const settingsBefore = localStorage.getItem(GMG_SETTINGS_KEY);
    let changed = false;
    applyingRemote = true;
    try {
      for (const key of KEYS) {
        const localRaw = localStorage.getItem(key);
        const localTime = meta[key] || 0;
        const remote = server[key];
        if (remote && remote.updated > localTime) {
          if (localRaw !== null && !meta[key]) {
            // Pre-profile local data meets the profile: merge, keep both.
            let merged;
            try {
              merged = JSON.stringify(mergeValues(JSON.parse(localRaw), JSON.parse(remote.v)));
            } catch (e) {
              merged = remote.v;
            }
            const now = Date.now();
            if (merged !== localRaw) {
              localStorage.setItem(key, merged);
              changed = true;
            }
            meta[key] = now;
            if (merged !== remote.v) putKey(key, merged, now).catch(() => {});
          } else if (remote.v !== localRaw) {
            localStorage.setItem(key, remote.v);
            meta[key] = remote.updated;
            changed = true;
          } else {
            meta[key] = remote.updated;
          }
        } else if (localRaw !== null && (!remote || localTime > remote.updated)) {
          // This device has something newer (or the profile has nothing yet).
          const t = localTime || Date.now();
          meta[key] = t;
          putKey(key, localRaw, t).catch(() => {});
        }
      }
    } finally {
      applyingRemote = false;
    }
    writeMeta(meta);
    // Settings from another device: odds and colors are drawn with the page.
    if (localStorage.getItem(GMG_SETTINGS_KEY) !== settingsBefore) {
      gmgSettingsCache = null;
      location.reload();
      return true;
    }
    if (changed) refreshPage();
    return true;
  }

  // Small "logged in as" chip + log out, in the topbar.
  function showAccount(user) {
    if (!user || document.getElementById("acct-chip")) return;
    const bar = document.querySelector(".topbar-actions");
    if (!bar) return;
    const el = document.createElement("span");
    el.id = "acct-chip";
    el.className = "acct-chip";
    el.title = user.email ? "Your plays, picks and notes are saved to this email membership" : "Your plays, picks and notes are saved to this Discord account";
    // Email members (Stripe) get Stripe's page for updating a card or cancelling.
    el.innerHTML = `<span class="acct-name"></span>${user.email ? `<a href="/account">Manage membership</a><a href="/set-password">Password</a>` : ""}<a href="#" class="acct-updates">What's new</a><a href="/auth/logout">Log out</a>`;
    el.querySelector(".acct-name").textContent = user.name || "Signed in";
    el.querySelector(".acct-updates").addEventListener("click", (e) => {
      e.preventDefault();
      openUpdates();
    });
    bar.prepend(el);
    addSettingsButton();
    showRequestButton(user);
  }

  // The Settings gear, just left of the account chip (odds format, colors,
  // My Books). Local testing has no account chip, so it gets the gear alone.
  function addSettingsButton() {
    const bar = document.querySelector(".topbar-actions");
    if (!bar || document.getElementById("settings-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "settings-btn";
    btn.className = "settings-btn";
    btn.title = "Settings: odds format, colors, My Books";
    btn.setAttribute("aria-label", "Settings");
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.48.48 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54a7.3 7.3 0 0 0-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.73 8.87a.47.47 0 0 0 .12.61l2.03 1.58a7.4 7.4 0 0 0 0 1.88l-2.03 1.58a.48.48 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
    btn.addEventListener("click", () => openGmgSettings());
    const chip = document.getElementById("acct-chip");
    chip ? chip.before(btn) : bar.prepend(btn);
  }

  // "Request a feature" button beside the account chip. Members get a box to
  // send an idea (POST /api/requests, saved in D1); the owner's button opens
  // the list of everyone's ideas instead, to mark added or delete.
  const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function requestModal() {
    let overlay = document.getElementById("feature-request-modal");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "feature-request-modal";
    overlay.className = "modal-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div class="fr-content"></div></div>`;
    const close = () => (overlay.hidden = true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest(".modal-close")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) close();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openRequestForm() {
    const overlay = requestModal();
    const box = overlay.querySelector(".fr-content");
    box.innerHTML = `<h3 class="fr-title">Have an idea for a tool, data point, or feature? I will do my best to get it added!</h3>
      <textarea class="fr-text" maxlength="1000" rows="6" placeholder="Type your idea here..."></textarea>
      <div class="fr-actions"><span class="fr-msg"></span><button type="button" class="fr-send">Send idea</button></div>`;
    const text = box.querySelector(".fr-text");
    const msg = box.querySelector(".fr-msg");
    const send = box.querySelector(".fr-send");
    send.addEventListener("click", async () => {
      const idea = text.value.trim();
      if (!idea) return text.focus();
      send.disabled = true;
      msg.textContent = "Sending...";
      try {
        const res = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ text: idea }),
        });
        if (res.status === 429) throw new Error("That's a lot of ideas for one day -- try again tomorrow!");
        if (!res.ok) throw new Error("Couldn't send that -- try again in a minute.");
        box.innerHTML = `<h3 class="fr-title">Thanks -- got it!</h3><p class="fr-thanks">Your idea was sent. Keep them coming.</p>
          <div class="fr-actions"><span></span><button type="button" class="fr-send fr-another">Send another</button></div>`;
        box.querySelector(".fr-another").addEventListener("click", openRequestForm);
      } catch (e) {
        msg.textContent = e.message;
        send.disabled = false;
      }
    });
    overlay.hidden = false;
    text.focus();
  }

  async function openRequestList() {
    const overlay = requestModal();
    const box = overlay.querySelector(".fr-content");
    box.innerHTML = `<h3 class="fr-title">Feature requests</h3><p class="fr-thanks">Loading...</p>`;
    overlay.hidden = false;
    let list = [];
    try {
      const res = await fetch("/api/requests", { credentials: "same-origin", cache: "no-store" });
      list = (await res.json()).requests || [];
    } catch (e) {
      box.innerHTML = `<h3 class="fr-title">Feature requests</h3><p class="fr-thanks">Couldn't load them -- try again.</p>`;
      return;
    }
    const fmt = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const fresh = list.filter((r) => r.status === "new").length;
    box.innerHTML = `<h3 class="fr-title">Feature requests <span class="fr-count">${fresh} new &middot; ${list.length} total</span></h3>
      <button type="button" class="fr-own">+ Add my own idea</button>
      <div class="fr-list">${list.length ? list.map((r) => `<div class="fr-item${r.status === "added" ? " fr-added" : ""}" data-id="${r.id}">
        <div class="fr-meta"><b>${escHtml(r.name || "Member")}</b> &middot; ${fmt(r.created)}${r.status === "added" ? ` &middot; <span class="fr-tag">Added</span>` : ""}</div>
        <div class="fr-body">${escHtml(r.text)}</div>
        <div class="fr-item-actions"><button type="button" data-status="${r.status === "added" ? "new" : "added"}">${r.status === "added" ? "Undo added" : "Mark added"}</button><button type="button" data-status="deleted">Delete</button></div>
      </div>`).join("") : `<p class="fr-thanks">No requests yet.</p>`}</div>`;
    box.querySelector(".fr-own").addEventListener("click", openRequestForm);
    box.querySelectorAll(".fr-item-actions button").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = Number(b.closest(".fr-item").dataset.id);
        if (b.dataset.status === "deleted" && !confirm("Delete this request?")) return;
        b.disabled = true;
        await fetch("/api/requests", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id, status: b.dataset.status }),
        }).catch(() => {});
        openRequestList();
      })
    );
  }

  function showRequestButton(user) {
    if (document.getElementById("feature-request-btn")) return;
    const chip = document.getElementById("acct-chip");
    if (!chip) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "feature-request-btn";
    btn.className = "feature-request-btn";
    btn.innerHTML = `<span aria-hidden="true">&#128161;</span><span class="fr-label">${user.owner ? "Feature requests" : "Request a feature"}</span>`;
    btn.title = user.owner ? "See everyone's feature ideas" : "Send an idea for a tool, data point or feature";
    btn.addEventListener("click", user.owner ? openRequestList : openRequestForm);
    (document.getElementById("settings-btn") || chip).before(btn);
  }

  // ---- What's new popup (GMG_UPDATES above) ----
  function updatesSeen() {
    try {
      return JSON.parse(localStorage.getItem(GMG_UPDATES_SEEN_KEY)) || "";
    } catch (e) {
      return "";
    }
  }
  function updatesDue() {
    return GMG_UPDATES.length > 0 && updatesSeen() < GMG_UPDATES[0].id;
  }
  function updateDate(id) {
    return new Date(`${id.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
  function openUpdates() {
    let overlay = document.getElementById("updates-modal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "updates-modal";
      overlay.className = "modal-overlay";
      overlay.hidden = true;
      overlay.innerHTML = '<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div class="upd-content"></div></div>';
      const close = () => (overlay.hidden = true);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay || e.target.closest(".modal-close, .upd-done")) return close();
        if (e.target.closest(".upd-request")) {
          close();
          openRequestForm();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !overlay.hidden) close();
      });
      document.body.appendChild(overlay);
    }
    // The ones they haven't seen on top (or the latest, opened again by hand);
    // everything older folded underneath.
    const seen = updatesSeen();
    const fresh = GMG_UPDATES.filter((u) => u.id > seen);
    const shown = fresh.length ? fresh : GMG_UPDATES.slice(0, 1);
    const earlier = GMG_UPDATES.slice(shown.length);
    const block = (u, isNew) => `<section class="upd-day">
      <div class="upd-date">${updateDate(u.id)}${isNew ? '<span class="upd-new">New</span>' : ""}</div>
      <ul class="upd-list">${u.items.map(([icon, text]) => `<li><span class="upd-icon" aria-hidden="true">${icon}</span><span>${text}</span></li>`).join("")}</ul>
    </section>`;
    overlay.querySelector(".upd-content").innerHTML = `<h3 class="upd-title"><span class="upd-dot" aria-hidden="true"></span>What's new</h3>
      <div class="upd-sub">GMG Sports Data Suite</div>
      ${shown.map((u) => block(u, u.id > seen)).join("")}
      ${earlier.length ? `<details class="upd-earlier"><summary>Earlier updates (${earlier.length})</summary>${earlier.map((u) => block(u, false)).join("")}</details>` : ""}
      <div class="upd-foot">Feel free to click <button type="button" class="upd-request"><span aria-hidden="true">&#128161;</span> Request a feature</button> and send a message for what you'd like to see.</div>
      <div class="set-actions"><button type="button" class="set-done upd-done">Got it</button></div>`;
    overlay.hidden = false;
    overlay.querySelector(".modal-box").scrollTop = 0;
    // Seen once it has been shown, so leaving without closing it doesn't bring it back.
    const newest = GMG_UPDATES[0]?.id;
    if (newest && seen < newest) {
      try {
        localStorage.setItem(GMG_UPDATES_SEEN_KEY, JSON.stringify(newest));
      } catch (e) {}
      window.NFLSync?.push(GMG_UPDATES_SEEN_KEY, newest);
    }
  }
  // After the profile has loaded (it knows what this member saw on another
  // device). Never while a browser is driven by a script: the deploy's page
  // check and the tests open every page fresh, and the popup would sit over them.
  function maybeShowUpdates() {
    if (navigator.webdriver || !updatesDue()) return;
    if (document.querySelector(".modal-overlay:not([hidden])")) return; // another popup is open: next page
    openUpdates();
  }
  window.GMGUpdates = { open: openUpdates, due: updatesDue };

  // ---- Suite switcher (added 2026-10-11) ----
  // The brand in the topbar ("GMG NFL SUITE") becomes a dropdown for moving
  // between suites. LAUNCHED 2026-10-13: the NBA and NHL suites are open to
  // every member (the owner: "I have been advertising it! Get it up and going.
  // You can open both to the public!"). While this was false, members who
  // opened an NHL link got the "being built" note (.nba-soon in suite.css) and
  // took the site for broken. Setting it back to false closes both suites to
  // everyone but the owner: never do that without the owner asking.
  const SUITE_SWITCH_PUBLIC = true;
  // Each sport has its own address (nba.gmgsports.org / nhl.gmgsports.org,
  // served from the site's nba/ and nhl/ folders by the middleware). On those
  // addresses the menu links across by full address; anywhere else (the NFL
  // address, local testing) the folders work as they are.
  const SPORT_HOST = /^(nba|nhl)\.gmgsports\.org$/.exec(location.hostname);
  const SUITES = [
    { key: "nfl", label: "NFL", href: SPORT_HOST ? "https://nfl.gmgsports.org/game-overview.html" : "/game-overview.html" },
    { key: "nba", label: "NBA", href: SPORT_HOST ? "https://nba.gmgsports.org/" : "/nba/" },
    { key: "nhl", label: "NHL", href: SPORT_HOST ? "https://nhl.gmgsports.org/" : "/nhl/" },
  ];
  function suiteSwitchOn() {
    const cls = document.documentElement.classList;
    return SUITE_SWITCH_PUBLIC || cls.contains("is-owner") || cls.contains("local-dev");
  }
  function addSuiteSwitcher() {
    const brand = document.querySelector(".topbar .brand");
    if (!brand || brand.dataset.suite) return;
    const current = SPORT_HOST ? SPORT_HOST[1] : (SUITES.find((s) => s.key !== "nfl" && location.pathname.includes(s.href)) || SUITES[0]).key;
    brand.dataset.suite = current;
    brand.classList.add("suite-brand");
    brand.insertAdjacentHTML("beforeend", '<span class="suite-caret" aria-hidden="true">&#9662;</span>');
    const menu = document.createElement("div");
    menu.className = "suite-menu";
    menu.hidden = true;
    menu.innerHTML = SUITES.map(
      (s) => `<a href="${s.href}" class="suite-item${s.key === current ? " suite-current" : ""}"><span class="brand-mark">GMG</span><span class="brand-name">${s.label} <b>Suite</b></span></a>`
    ).join("");
    brand.after(menu);
    brand.addEventListener("click", (e) => {
      if (!suiteSwitchOn()) return; // plain link home until it's switched on
      e.preventDefault();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".suite-brand, .suite-menu")) menu.hidden = true;
    });
  }
  if (SUITE_SWITCH_PUBLIC) document.documentElement.classList.add("suite-public");
  addSuiteSwitcher();

  // ---- Promo Tools menu (the owner, 2026-10-15) ----
  // "Promo Tools" in every page's nav (NFL, NBA, NHL) opens a list of every
  // promo tool on the site, whichever sport it is for, to jump straight to it.
  // A new promo tool is one line here. Links cross sports the suite switcher's way.
  const PROMOS = [
    { sport: "nfl", label: "NFL", name: "King of the Endzone", href: SPORT_HOST ? "https://nfl.gmgsports.org/promo-tools.html" : "/promo-tools.html" },
    { sport: "nhl", label: "NHL", name: "King of the Crease", href: SPORT_HOST ? "https://nhl.gmgsports.org/promo-tools.html" : "/nhl/promo-tools.html" },
    { sport: "nhl", label: "NHL", name: "Icebreaker", view: "icebreaker", href: SPORT_HOST ? "https://nhl.gmgsports.org/promo-tools.html#icebreaker" : "/nhl/promo-tools.html#icebreaker" },
  ];
  function addPromoMenu() {
    const nav = document.querySelector(".topbar .page-nav");
    const bar = document.querySelector(".topbar");
    if (!nav || !bar || bar.querySelector(".promo-menu")) return;
    const sport = (document.querySelector(".topbar .brand") || {}).dataset?.suite || "nfl";
    const onPromo = /promo-tools\.html$/.test(location.pathname);
    let trigger = [...nav.children].find((item) => item.textContent.trim() === "Promo Tools");
    if (!trigger) {
      // A suite with no promo tool of its own (NBA): the menu still reaches the others.
      trigger = document.createElement("a");
      trigger.href = "#";
      trigger.textContent = "Promo Tools";
      nav.appendChild(trigger);
    }
    navMenu(trigger, "promo", PROMOS.map(
      (p) => `<a href="${p.href}" class="promo-item${onPromo && p.sport === sport && (p.view || "") === location.hash.slice(1) ? " promo-current" : ""}"><span class="promo-sport">${p.label}</span><span class="promo-name">${p.name}</span></a>`
    ).join(""));
  }
  addPromoMenu();

  // ---- Player Props menu (the owner, 2026-10-15) ----
  // On the NHL pages "Player Props" in the nav opens a list of the prop tools
  // (Shots, Goals), the Promo Tools menu's way. A page marks the button with
  // data-nav-menu="props"; a new prop tool is one line here.
  const PROPS = [
    { name: "Best Plays", href: "best.html" },
    { name: "Shots", href: "shots.html" },
    { name: "Goals", href: "goals.html" },
    { name: "Points", href: "points.html" },
    { name: "Line Stacks", href: "stacks.html" },
  ];
  function addPropsMenu() {
    const trigger = document.querySelector('.topbar .page-nav [data-nav-menu="props"]');
    if (!trigger || document.querySelector(".props-menu")) return;
    const page = location.pathname.split("/").pop();
    navMenu(trigger, "props", PROPS.map(
      (p) => `<a href="${p.href}" class="promo-item${p.href === page ? " promo-current" : ""}"><span class="promo-name">${p.name}</span></a>`
    ).join(""));
  }
  addPropsMenu();

  // A nav button that opens a list under it (Promo Tools, Player Props): `kind`
  // names its classes (.promo-trigger / .promo-menu, .props-trigger / .props-menu).
  function navMenu(trigger, kind, itemsHtml) {
    const bar = document.querySelector(".topbar");
    trigger.classList.add(`${kind}-trigger`, "nav-trigger");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.insertAdjacentHTML("beforeend", '<span class="promo-caret" aria-hidden="true">&#9662;</span>');
    const menu = document.createElement("div");
    menu.className = `${kind}-menu nav-menu`;
    menu.hidden = true;
    menu.innerHTML = itemsHtml;
    bar.appendChild(menu);
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      // Under the button, inside the top bar (the nav scrolls sideways on phones and would clip it).
      const at = trigger.getBoundingClientRect();
      const box = bar.getBoundingClientRect();
      menu.style.top = `${at.bottom - box.top + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(at.left - box.left, box.width - 250))}px`;
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    });
    // Any click outside this button and its list closes it (opening the other menu too).
    document.addEventListener("click", (e) => {
      if (!trigger.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") menu.hidden = true;
    });
  }

  // "Odds powered by SmartStake" (the owner's partner; written permission to
  // show their odds, 2026-10-14) beside the suite name, on every page. Links
  // to the owner's referral, the same one gmgsports.org's links.json uses.
  function addOddsCredit() {
    const brand = document.querySelector(".topbar .brand");
    if (!brand || document.querySelector(".odds-credit")) return;
    // The brand and the badge share the top bar's first column.
    const group = document.createElement("div");
    group.className = "brand-group";
    brand.before(group);
    group.appendChild(brand);
    group.insertAdjacentHTML("beforeend", '<a class="odds-credit" href="https://www.smartstake.app/?via=GMG" target="_blank" rel="noopener" title="Odds powered by SmartStake. Code GREEN: 7 days for $1"><span>Odds powered by</span><img src="/brand/smartstake.avif" alt="" height="18"><b>SmartStake</b></a>');
  }
  addOddsCredit();

  // The "i" beside a heading opens its explanation (the long notes stay out of
  // the way until someone asks; the owner, 2026-10-14). Capture: it sits inside
  // rows and cards that react to clicks themselves.
  document.addEventListener("click", (e) => {
    const button = e.target.closest(".info-i");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const note = document.getElementById(button.getAttribute("aria-controls"));
    if (!note) return;
    note.hidden = !note.hidden;
    button.setAttribute("aria-expanded", String(!note.hidden));
  }, true);

  window.NFLSync = {
    push(key, value) {
      if (applyingRemote || !KEYS.includes(key)) return;
      const meta = readMeta();
      meta[key] = Date.now();
      writeMeta(meta);
      if (!enabled) return; // pushed on the next successful pull instead
      clearTimeout(pushTimers[key]);
      pushTimers[key] = setTimeout(() => {
        const raw = localStorage.getItem(key);
        if (raw !== null) putKey(key, raw, readMeta()[key] || Date.now()).catch(() => {});
      }, PUSH_DELAY_MS);
    },
  };

  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    document.documentElement.classList.add("local-dev");
    addSettingsButton();
  }
  pull().then(maybeShowUpdates, maybeShowUpdates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pull();
  });
})();
