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
    el.innerHTML = `<span class="acct-name"></span>${user.email ? `<a href="/account">Manage membership</a><a href="/set-password">Password</a>` : ""}<a href="/auth/logout">Log out</a>`;
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
