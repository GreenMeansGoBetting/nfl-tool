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
