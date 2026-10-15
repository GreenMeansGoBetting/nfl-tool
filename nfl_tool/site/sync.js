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
    el.innerHTML = `<span class="acct-name"></span>${user.email ? `<a href="/account">Manage membership</a><a href="/set-password">Password</a>` : ""}${window.GMGBookOdds ? `<a href="#" class="my-books-link">My Books</a>` : ""}<a href="/auth/logout">Log out</a>`;
    el.querySelector(".acct-name").textContent = user.name || "Signed in";
    bar.prepend(el);
    showRequestButton(user);
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
    chip.before(btn);
  }

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
      nav.insertBefore(trigger, nav.querySelector(".page-nav-soon"));
    }
    trigger.classList.add("promo-trigger");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.insertAdjacentHTML("beforeend", '<span class="promo-caret" aria-hidden="true">&#9662;</span>');
    const menu = document.createElement("div");
    menu.className = "promo-menu";
    menu.hidden = true;
    menu.innerHTML = PROMOS.map(
      (p) => `<a href="${p.href}" class="promo-item${onPromo && p.sport === sport && (p.view || "") === location.hash.slice(1) ? " promo-current" : ""}"><span class="promo-sport">${p.label}</span><span class="promo-name">${p.name}</span></a>`
    ).join("");
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
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".promo-trigger, .promo-menu")) menu.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") menu.hidden = true;
    });
  }
  addPromoMenu();

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

  if (["localhost", "127.0.0.1"].includes(location.hostname)) document.documentElement.classList.add("local-dev");
  pull();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pull();
  });
})();
