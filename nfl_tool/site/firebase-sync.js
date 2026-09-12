// ---- Cross-device sync (Firebase) ----
// Mirrors a small set of localStorage keys (possible plays, notes, picks)
// to one Firestore document so the same picks/notes show up on every
// device signed into the same account. Everything else on the site (view
// toggles, which matchup is selected, etc.) stays localStorage-only on
// purpose -- those are just per-device display preferences, not data
// worth syncing.
//
// Design: every EXISTING load*/save*/isPossiblePlay-style function in
// common.js/game-overview.js/picks.js keeps localStorage as its source of
// truth and stays fully synchronous -- this file just mirrors it to/from
// Firestore in the background so none of those call sites need to become
// async. A local write flows: save*() -> localStorage.setItem (unchanged)
// -> NFLSync.push(key, value) (new, one line added per save* function) ->
// Firestore. A remote change (from another device) flows: Firestore
// onSnapshot -> localStorage.setItem (overwrite) -> whatever the current
// page's own render function is, so the page updates without the user
// touching anything.
//
// Security: the config below (including apiKey) is not a secret -- it's
// always visible in any Firebase web app's source, by design. What
// actually protects this data is the Firestore security rule restricting
// reads/writes to this one specific account's UID (see firestore rules),
// not the config being hidden.
const firebaseConfig = {
  apiKey: "AIzaSyCcGNoCOcP5EOMBDwyZc7t7JXKAxrXRBNk",
  authDomain: "gmg-nfl-suite.firebaseapp.com",
  projectId: "gmg-nfl-suite",
  storageBucket: "gmg-nfl-suite.firebasestorage.app",
  messagingSenderId: "631906959151",
  appId: "1:631906959151:web:0963bad0211d56486bebda",
};

// localStorage key -> Firestore field name, for every piece of state that
// should follow the user between devices. Add a new key here (and one
// NFLSync.push() call in whatever save* function owns it) to sync
// something new later.
const SYNCED_KEYS = {
  "nfl-tool.possible-plays.v1": "possiblePlays",
  "nfl-tool.td-notes.v1": "tdNotes",
  "nfl-tool.game-notes.v1": "gameNotes",
  "nfl-tool.picks.v1": "picks",
};

firebase.initializeApp(firebaseConfig);
const syncAuth = firebase.auth();
const syncDb = firebase.firestore();

let syncUid = null;
let unsubscribeSnapshot = null;
// Guards against a remote snapshot's own localStorage writes immediately
// bouncing back out to Firestore as if they were a new local change.
let applyingRemoteChange = false;

function refreshCurrentPage() {
  if (typeof DATA === "undefined" || !DATA) return; // data.json hasn't loaded yet
  if (typeof window.render === "function") window.render();
  else if (typeof window.renderPossiblePlays === "function") window.renderPossiblePlays();
}

window.NFLSync = {
  push(key, value) {
    if (!syncUid || applyingRemoteChange) return;
    const field = SYNCED_KEYS[key];
    if (!field) return;
    syncDb.collection("users").doc(syncUid).set({ [field]: value }, { merge: true }).catch((err) => {
      console.error("Sync write failed", err);
    });
  },
};

function applySnapshot(data) {
  applyingRemoteChange = true;
  try {
    for (const [key, field] of Object.entries(SYNCED_KEYS)) {
      if (data[field] !== undefined) {
        localStorage.setItem(key, JSON.stringify(data[field]));
      }
    }
  } finally {
    applyingRemoteChange = false;
  }
  refreshCurrentPage();
}

// First sign-in on a brand-new account has no Firestore doc yet -- seed it
// from whatever's already in this device's localStorage (almost always
// the primary desktop, which already has real picks/notes) rather than
// starting the cloud copy empty and overwriting that data on the next
// snapshot.
function seedFromLocalStorage(uid) {
  const seed = {};
  for (const [key, field] of Object.entries(SYNCED_KEYS)) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      seed[field] = JSON.parse(raw);
    } catch (e) {
      // Malformed local value -- skip rather than seed garbage.
    }
  }
  if (Object.keys(seed).length) {
    syncDb.collection("users").doc(uid).set(seed, { merge: true }).catch((err) => {
      console.error("Sync seed failed", err);
    });
  }
}

function startSync(uid) {
  syncUid = uid;
  unsubscribeSnapshot = syncDb.collection("users").doc(uid).onSnapshot(
    (doc) => {
      if (doc.exists) applySnapshot(doc.data());
      else seedFromLocalStorage(uid);
    },
    (err) => console.error("Sync listen failed", err)
  );
}

function stopSync() {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = null;
  syncUid = null;
}

// ---- Minimal login UI ----
// One slim bar at the top of the page -- a login form when signed out, a
// "Synced as ..." status + sign-out button once signed in. Firebase
// persists the signed-in session across reloads on its own, so this is a
// one-time thing per browser, not a login prompt every visit.
function ensureSyncBar() {
  if (document.getElementById("sync-bar")) return;
  const bar = document.createElement("div");
  bar.id = "sync-bar";
  bar.className = "sync-bar";
  document.body.prepend(bar);
}

function renderSignedOut() {
  ensureSyncBar();
  document.getElementById("sync-bar").innerHTML = `
    <form id="sync-login-form" class="sync-login-form">
      <span class="sync-label">Sign in to sync picks/notes across devices:</span>
      <input type="email" id="sync-email" placeholder="Email" autocomplete="username" required>
      <input type="password" id="sync-password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <span id="sync-error" class="sync-error"></span>
    </form>`;
  document.getElementById("sync-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("sync-email").value;
    const password = document.getElementById("sync-password").value;
    const errEl = document.getElementById("sync-error");
    errEl.textContent = "";
    syncAuth.signInWithEmailAndPassword(email, password).catch((err) => {
      errEl.textContent = "Sign-in failed -- check email/password.";
      console.error(err);
    });
  });
}

function renderSignedIn(user) {
  ensureSyncBar();
  document.getElementById("sync-bar").innerHTML = `
    <span class="sync-status">Synced as ${user.email}</span>
    <button type="button" id="sync-signout-btn">Sign out</button>`;
  document.getElementById("sync-signout-btn").addEventListener("click", () => syncAuth.signOut());
}

syncAuth.onAuthStateChanged((user) => {
  if (user) {
    renderSignedIn(user);
    startSync(user.uid);
  } else {
    stopSync();
    renderSignedOut();
  }
});
