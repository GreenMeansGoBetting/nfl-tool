// ---- Discord login gate (Cloudflare Pages Functions) ----
// Every request to nfl.gmgsports.org -- pages AND data.json -- passes
// through here. Access follows the member's CURRENT Discord roles: the bot
// token looks the member up server-side, and a signed session cookie only
// vouches for that check for RECHECK_MS, so losing the role (cancelled
// subscription, left the server, kicked) cuts access within that window.
//
// Setup finished 2026-09-28 (secrets added); ENFORCE below is the on switch.
// Stays switched OFF (site open) until the client ID, allowed roles, and
// both secrets (DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN -- Cloudflare Pages
// secrets, pushed from GitHub secrets by deploy.yml) are all in place.

const GUILD_ID = "1295760852892385290";
const CLIENT_ID = "1554268816521957447"; // Discord app's OAuth2 Client ID (not secret)
const ALLOWED_ROLE_IDS = ["1471877733868109937", "1471880013824393266"]; // roles that get in
const INVITE_URL = "https://gmgsports.buildr.bet/"; // join / get-access page (Buildr)
const OWNER_IDS = ["613105360286253076"]; // Discord user IDs that see owner-only controls (Update Odds)
// false = TEST MODE: the site stays open to everyone, but /auth/login works
// and /auth/check shows whether this Discord account WOULD get in. Flip to
// true (one-line push) once that's confirmed.
const ENFORCE = true;

const COOKIE = "gmg_session";
const STATE_COOKIE = "gmg_oauth_state";
const RECHECK_MS = 15 * 60 * 1000; // re-verify roles with Discord this often
const SESSION_DAYS = 30; // stay logged in this long between visits
const OUTAGE_GRACE_MS = 2 * 60 * 60 * 1000; // Discord API down: honor a check this recent

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64urlText = (s) => b64url(enc.encode(s));
const fromB64urlText = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

// Session signing key derived from the bot token, so there's no extra
// secret to manage (rotating the bot token simply logs everyone out).
async function hmacKey(env) {
  const base = await crypto.subtle.importKey("raw", enc.encode(env.DISCORD_BOT_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, enc.encode("gmg-session-v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const body = b64urlText(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
async function verify(env, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = await sign(env, JSON.parse(fromB64urlText(body)));
  if (expected.split(".")[1] !== sig) return null;
  const payload = JSON.parse(fromB64urlText(body));
  return payload.exp > Date.now() ? payload : null;
}

function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

// Member lookup with the bot token -- the source of truth for roles.
// Returns { ok: true, roles } / { ok: false, reason: "not-member" } /
// { ok: false, reason: "api" } when Discord itself can't answer.
async function memberRoles(env, userId) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (res.status === 404) return { ok: false, reason: "not-member" };
  if (!res.ok) return { ok: false, reason: "api" };
  const m = await res.json();
  return { ok: true, roles: m.roles || [] };
}
const hasAllowedRole = (roles) => roles.some((r) => ALLOWED_ROLE_IDS.includes(r));

// The data build (build_stats.py fetch_previous_odds_snapshot) reads the
// live data.json; it sends HMAC(bot token, "gmg-build-v1") as X-GMG-Build.
async function isBuildRequest(request, env) {
  const sent = request.headers.get("X-GMG-Build");
  if (!sent) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env.DISCORD_BOT_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("gmg-build-v1")));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sent === hex;
}

function gateReady(env) {
  return !!(CLIENT_ID && ALLOWED_ROLE_IDS.length && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN);
}
function gateEnabled(env) {
  return ENFORCE && gateReady(env);
}

// ---- pages ----
function page(title, inner, status = 200, headers = {}, wide = false) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow+Semi+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#070b13;--panel:#0d1422;--panel2:#111a2b;--border:#1d2a41;--text:#e7edf7;--muted:#8797b0;--accent:#22c55e}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(1000px 420px at 50% -80px,rgba(34,197,94,.12),transparent 70%),var(--bg);color:var(--text);font-family:"Barlow Semi Condensed",system-ui,sans-serif}
.wide .box{max-width:900px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;text-align:left;margin-top:14px}
.col{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:18px 18px 16px}
.col h2{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:1.25rem;letter-spacing:.04em;text-transform:uppercase;margin:0 0 4px}
.col.join{border-color:rgba(34,197,94,.55);background:linear-gradient(180deg,rgba(34,197,94,.08),transparent 60%),var(--panel2)}
.col p{margin:0 0 12px}.or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:.8rem;margin:14px 0 2px}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--border)}
@media(max-width:720px){.cols{grid-template-columns:1fr}}
.box{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:28px 26px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.mark{display:inline-block;font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:1.1rem;letter-spacing:.04em;color:#03140a;background:var(--accent);border-radius:7px;padding:3px 9px 2px;box-shadow:0 0 18px rgba(34,197,94,.35)}
h1{font-family:"Barlow Condensed",sans-serif;font-weight:800;font-size:1.9rem;letter-spacing:.03em;text-transform:uppercase;margin:12px 0 6px}h1 b{color:var(--accent)}
p{color:var(--muted);line-height:1.45;margin:0 0 18px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px 16px;border-radius:10px;font-weight:700;font-size:1rem;text-decoration:none;margin-top:10px}
.discord{background:#5865f2;color:#fff}.discord:hover{background:#4752c4}
.ghost{background:var(--panel2);color:var(--text);border:1px solid var(--border)}
small{display:block;margin-top:16px;color:var(--muted);font-size:.78rem}
</style></head><body${wide ? ' class="wide"' : ""}><div class="box"><span class="mark">GMG</span><h1>NFL <b>Suite</b></h1>${inner}</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
const DISCORD_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 -.3 13.5.1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.9 12.9 0 0 1-2 1L18 21a19.9 19.9 0 0 0 6-3c.5-5.2-.8-9.7-3.7-13.6zM8.3 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7.4 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/></svg>`;

function loginPage(next, env = null) {
  return accessPage({ env, next, status: 401 });
}
function deniedPage(reason) {
  const msg =
    reason === "not-member"
      ? "Your Discord account isn't in the GMG server."
      : reason === "api"
      ? "Discord isn't answering right now, so we can't check your access. Try again in a minute."
      : "Your Discord account doesn't have a role with access to the NFL Suite.";
  return page(
    "No access -- GMG's NFL Suite",
    `<p>${msg}</p>
     ${INVITE_URL && reason !== "api" ? `<a class="btn discord" href="${INVITE_URL}" target="_blank" rel="noopener">${DISCORD_ICON}${reason === "no-role" ? "Get access" : "Join the GMG Discord"}</a>` : ""}
     <a class="btn ghost" href="/auth/logout">Use a different Discord account</a>`,
    403,
    // Discord outage keeps the session; a real "no" clears it.
    reason === "api" ? {} : { "Set-Cookie": setCookie(COOKIE, "", 0) }
  );
}

// ---- OAuth routes ----
async function handleLogin(request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/";
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const auth = new URL("https://discord.com/oauth2/authorize");
  auth.searchParams.set("client_id", CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "identify");
  auth.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "none");
  return new Response(null, {
    status: 302,
    headers: { Location: auth.toString(), "Set-Cookie": setCookie(STATE_COOKIE, JSON.stringify({ state, next: next.startsWith("/") ? next : "/" }), 600) },
  });
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  let saved = {};
  try {
    saved = JSON.parse(getCookie(request, STATE_COOKIE) || "{}");
  } catch (e) {
    saved = {};
  }
  if (!url.searchParams.get("code") || !saved.state || saved.state !== url.searchParams.get("state")) return loginPage("/");
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: url.searchParams.get("code"),
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) return deniedPage("api");
  const { access_token } = await tokenRes.json();
  const meRes = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) return deniedPage("api");
  const me = await meRes.json();
  const check = await memberRoles(env, me.id);
  if (!check.ok) return deniedPage(check.reason);
  if (!hasAllowedRole(check.roles)) return deniedPage("no-role");
  const now = Date.now();
  const session = await sign(env, { uid: me.id, name: me.global_name || me.username, checked: now, exp: now + SESSION_DAYS * 864e5 });
  const headers = new Headers({ Location: ENFORCE ? saved.next || "/" : "/auth/check" });
  headers.append("Set-Cookie", setCookie(COOKIE, session, SESSION_DAYS * 86400));
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

// Test page: logs this Discord account's live result without gating anything.
async function handleCheck(request, env) {
  let session = null;
  try {
    session = await verify(env, getCookie(request, COOKIE));
  } catch (e) {
    session = null;
  }
  if (!session) return loginPage("/auth/check");
  const check = await memberRoles(env, session.uid);
  if (!check.ok) return deniedPage(check.reason);
  if (!hasAllowedRole(check.roles)) return deniedPage("no-role");
  return page(
    "Access check -- GMG's NFL Suite",
    `<p><b style="color:#6ee79b">You're in, ${session.name}.</b><br>Your Discord roles give you access to the NFL Suite.</p>
     <a class="btn discord" href="/">Open the site</a>
     <a class="btn ghost" href="/auth/logout">Log out</a>`
  );
}

function handleLogout() {
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", setCookie(COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

// ---- member profiles: saved plays/picks/notes per Discord account ----
// One row per (member, item) in the D1 database bound as DB (created by
// deploy.yml). The browser (site/sync.js) keeps localStorage as its
// working copy and mirrors these keys here, so they follow the member to
// any device. Only the logged-in member's own rows are ever read/written.
const SYNC_KEYS = new Set([
  "nfl-tool.possible-plays.v1",
  "nfl-tool.picks.v1",
  "nfl-tool.game-notes.v1",
  "nfl-tool.td-notes.v1",
  "nfl-tool.manual-outs.v1",
  "nfl-tool.props-summary-picks.v1",
  "nfl-tool.summary-picks.v1",
]);
const SYNC_MAX_BYTES = 512 * 1024;

async function handleApi(request, env, session, json) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/state") return json({ error: "not found" }, 404);
  if (!env.DB) return json({ error: "no database" }, 503);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT k, v, updated FROM user_state WHERE uid = ?").bind(session.uid).all();
    const state = {};
    for (const r of results || []) state[r.k] = { v: r.v, updated: r.updated };
    return json({ user: { name: session.name, owner: isOwnerSession(session), email: session.kind === "email" }, state });
  }
  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "bad json" }, 400);
    }
    const { k, v, updated } = body || {};
    if (!SYNC_KEYS.has(k) || typeof v !== "string" || !Number.isFinite(updated)) return json({ error: "bad item" }, 400);
    if (v.length > SYNC_MAX_BYTES) return json({ error: "too big" }, 413);
    // Newest write wins: an older device catching up can't overwrite a
    // newer save from another device.
    await env.DB.prepare(
      "INSERT INTO user_state (uid, k, v, updated) VALUES (?, ?, ?, ?) ON CONFLICT(uid, k) DO UPDATE SET v = excluded.v, updated = excluded.updated WHERE excluded.updated >= user_state.updated"
    )
      .bind(session.uid, k, v, Math.round(updated))
      .run();
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}

// ---- Email members (Stripe), added 2026-10-08 ----
// For people who'd pay but won't join Discord. They subscribe through
// Stripe Checkout ($5/month or $45/year, 7-day free trial with a card or
// bank account required), pick a password right after paying, and sign
// in with email + password. Every RECHECK_MS the gate asks Stripe for the
// member's subscription and saves it to the D1 `members` table, so a
// failed payment or a cancel cuts access -- the same live rule as Discord
// roles. Only needs the Pages secret STRIPE_SECRET_KEY (pushed from GitHub
// by deploy.yml); no email service, no webhook (the user didn't want the
// DNS / dashboard setup -- an optional webhook still works if
// STRIPE_WEBHOOK_SECRET is ever added). While the Stripe key is a TEST
// key, only the owner (signed in with Discord) can start a checkout, so
// nobody gets in free with Stripe's test cards.
// Prices per Stripe mode; the secret key in use (sk_test_ / sk_live_) picks
// the set, so the GitHub key can be swapped any time. Join stays closed in
// a mode whose IDs are blank.
const STRIPE_PRICE_IDS = {
  test: { monthly: "price_1UOKQhLM3ebsVWbZWbCfXE9X", yearly: "price_1UOKQhLM3ebsVWbZrn3B6uGt" },
  // Live prices + sk_live_ key in place 2026-10-09: memberships open to everyone.
  live: { monthly: "price_1UOg8YLM3ebsVWbZZQXVqT3q", yearly: "price_1UOg99LM3ebsVWbZZwm7LMCD" },
};
const PLANS = {
  monthly: { label: "$5 / month" },
  yearly: { label: "$45 / year", note: "save 25%" },
};
const TRIAL_DAYS = 7;
const PW_MIN = 8;
const PW_ITERATIONS = 100000; // PBKDF2-SHA256 (Workers' maximum)
const LOGIN_FAILS_MAX = 5; // wrong passwords before a short lockout
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const JOIN_DONE_MAX_AGE_S = 60 * 60; // checkout success link signs you in for an hour
const MEMBER_STATUSES_IN = ["active", "trialing"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const membersReady = (env) => !!(env.DB && env.STRIPE_SECRET_KEY);
const stripeTestMode = (env) => (env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");
const priceId = (env, plan) => (STRIPE_PRICE_IDS[stripeTestMode(env) ? "test" : "live"] || {})[plan] || "";
const pricesReady = (env) => Object.keys(PLANS).every((k) => priceId(env, k));
// Join is open: everyone in live mode; only the owner while Stripe is in test mode.
const joinOpen = (env, session) => membersReady(env) && pricesReady(env) && (!stripeTestMode(env) || isOwnerSession(session));
const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe REST call (form-encoded). Throws with Stripe's own message on error.
async function stripeApi(env, method, path, params) {
  let url = `https://api.stripe.com/v1/${path}`;
  const init = { method, headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  if (params && method === "GET") url += `?${new URLSearchParams(params)}`;
  else if (params) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `stripe ${res.status}`);
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

// Stripe-Signature: t=<time>,v1=<hex hmac of "t.body">; 5-minute tolerance.
async function verifyStripeSignature(env, raw, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")).filter((p) => p.length === 2));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.includes(hex);
}

// Passwords: PBKDF2-SHA256 with a random salt, stored as
// "pbkdf2$<iterations>$<salt>$<hash>".
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PW_ITERATIONS}$${b64url(salt)}$${await pbkdf2(password, salt, PW_ITERATIONS)}`;
}
async function checkPassword(password, stored) {
  const [kind, iter, saltB64, hash] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !hash) return false;
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return (await pbkdf2(password, salt, Number(iter))) === hash;
}

// ---- the members table ----
async function getMember(env, email) {
  return env.DB.prepare("SELECT * FROM members WHERE email = ?").bind(email).first();
}
// refresh = ask Stripe for the subscription's live status first (the gate
// does this every RECHECK_MS); if Stripe can't answer, the saved status stands.
async function memberHasAccess(env, email, refresh = false) {
  const m = await getMember(env, email);
  if (!m) return false;
  if (m.manual_until && m.manual_until > Date.now()) return true;
  if (refresh && m.subscription) {
    try {
      const sub = await stripeApi(env, "GET", `subscriptions/${m.subscription}`);
      await saveSubscription(env, email, sub);
      return MEMBER_STATUSES_IN.includes(sub.status);
    } catch (e) {
      if (e.code === "resource_missing") {
        await env.DB.prepare("UPDATE members SET status = 'canceled', updated = ? WHERE email = ?").bind(Date.now(), email).run();
        return false;
      }
      // Stripe unreachable: fall through to the saved status.
    }
  }
  return MEMBER_STATUSES_IN.includes(m.status);
}
// Upsert from a Stripe subscription object.
async function saveSubscription(env, email, sub) {
  const periodEnd = sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || null;
  await env.DB.prepare(
    `INSERT INTO members (email, customer, subscription, status, period_end, trial_used, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET customer = excluded.customer, subscription = excluded.subscription,
       status = excluded.status, period_end = excluded.period_end,
       trial_used = MAX(members.trial_used, excluded.trial_used), updated = excluded.updated`
  )
    .bind(email, sub.customer || null, sub.id, sub.status, periodEnd ? periodEnd * 1000 : null, sub.trial_end ? 1 : 0, Date.now())
    .run();
}
async function emailForSubscription(env, sub) {
  const fromMeta = cleanEmail(sub.metadata && sub.metadata.email);
  if (fromMeta) return fromMeta;
  const row = sub.customer ? await env.DB.prepare("SELECT email FROM members WHERE customer = ?").bind(sub.customer).first() : null;
  if (row) return row.email;
  if (!sub.customer) return null;
  const c = await stripeApi(env, "GET", `customers/${sub.customer}`);
  return cleanEmail(c.email) || null;
}

// One free trial per card / bank account: a payment method that already
// started a trial under another email gets charged right away instead.
async function enforceOneTrialPerCard(env, email, sub) {
  if (sub.status !== "trialing" || !sub.default_payment_method) return;
  const pmId = typeof sub.default_payment_method === "string" ? sub.default_payment_method : sub.default_payment_method.id;
  const pm = await stripeApi(env, "GET", `payment_methods/${pmId}`);
  const fp = (pm.card && pm.card.fingerprint) || (pm.us_bank_account && pm.us_bank_account.fingerprint);
  if (!fp) return;
  const seen = await env.DB.prepare("SELECT email FROM trial_cards WHERE fingerprint = ?").bind(fp).first();
  if (seen && seen.email !== email) {
    await stripeApi(env, "POST", `subscriptions/${sub.id}`, { trial_end: "now" });
    return;
  }
  if (!seen) await env.DB.prepare("INSERT INTO trial_cards (fingerprint, email, created) VALUES (?, ?, ?)").bind(fp, email, Date.now()).run();
}

// ---- sessions for email members ----
function emailSession(env, email) {
  const now = Date.now();
  return sign(env, { uid: `email:${email}`, name: email, kind: "email", checked: now, exp: now + SESSION_DAYS * 864e5 });
}
function redirectWithSession(location, session) {
  const headers = new Headers({ Location: location });
  headers.append("Set-Cookie", setCookie(COOKIE, session, SESSION_DAYS * 86400));
  return new Response(null, { status: 302, headers });
}
// ---- member pages ----
async function readSession(request, env) {
  try {
    return await verify(env, getCookie(request, COOKIE));
  } catch (e) {
    return null;
  }
}
const isOwnerSession = (s) => !!(s && s.kind !== "email" && OWNER_IDS.includes(s.uid));
const FORM_CSS = `<style>
input[type=email],input[type=text],input[type=date]{width:100%;padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:1rem;margin-top:6px}
button.btn{border:none;cursor:pointer;font:inherit;font-weight:700}
.plan{background:var(--accent);color:#03140a}.plan:hover{filter:brightness(1.08)}
.plans{margin-top:14px}.note{color:var(--accent);font-size:.82rem;margin-left:6px}
.err{color:#f87171;margin:0 0 12px}.ok{color:#6ee79b}
table{width:100%;border-collapse:collapse;text-align:left;font-size:.85rem;margin:10px 0}td,th{padding:5px 4px;border-bottom:1px solid var(--border)}
</style>`;

function joinPage(env, session, error = "") {
  return accessPage({ env, session, joinError: error });
}

// The sign-in screen. Left: Discord, or email + password. Right (when Join
// is open): start the free trial. One page, side by side; stacks on phones.
function accessPage({ env = null, session = null, next = "/", signinEmail = "", signinMsg = "", joinError = "", status = 200 }) {
  const email = !!(env && membersReady(env));
  const join = email && joinOpen(env, session);
  const discordBtn = `<a class="btn discord" href="/auth/login?next=${encodeURIComponent(next)}">${DISCORD_ICON}Log in with Discord</a>`;
  const invite = INVITE_URL ? `<a class="btn ghost" href="${INVITE_URL}" target="_blank" rel="noopener">Not in the Discord yet? Join here</a>` : "";
  if (!email) {
    return page(
      "Sign in -- GMG's NFL Suite",
      `<p>Access is for members of the GMG Discord.</p>${discordBtn}${invite}
       <small>We only see your Discord name and your roles in the GMG server.</small>`,
      status
    );
  }
  const pwStyle = "width:100%;padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:1rem;margin-top:6px";
  const signin = `<section class="col">
      <h2>Already a member</h2>
      <p>${signinMsg ? `<span class="${status >= 400 ? "err" : "ok"}">${esc(signinMsg)}</span>` : "Sign in with Discord or your email."}</p>
      ${discordBtn}
      <div class="or">or sign in with email</div>
      <form method="post" action="/auth/email">
        <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" value="${esc(signinEmail)}">
        <input type="password" name="password" required autocomplete="current-password" placeholder="Password" style="${pwStyle}">
        <button class="btn plan">Sign in</button>
      </form>
      <small>Forgot your password? Message GMG and we'll reset it for you.</small>
    </section>`;
  const plans = Object.entries(PLANS)
    .map(([key, p]) => `<button class="btn plan" name="plan" value="${key}">Start free trial &middot; then ${p.label}${p.note ? ` <span style="font-size:.8rem;opacity:.85">(${p.note})</span>` : ""}</button>`)
    .join("");
  const joinCol = join
    ? `<section class="col join">
        <h2>New here?</h2>
        <p><b style="color:var(--text)">${TRIAL_DAYS} days free</b>, then $5/month or $45/year. Every page, every tool, updated all week.</p>
        ${joinError ? `<p class="err">${esc(joinError)}</p>` : ""}
        <form method="post" action="/stripe/checkout">
          <input type="email" name="email" required autocomplete="email" placeholder="Your email (you'll sign in with it)">
          ${plans}
        </form>
        <small>Card or bank account required to start. You won't be charged until day ${TRIAL_DAYS + 1}, and Stripe emails a reminder first. Cancel anytime from <b>Manage membership</b>.${stripeTestMode(env) ? "<br><b>Stripe TEST mode:</b> only you can see this; use Stripe's test cards." : ""}</small>
      </section>`
    : `<section class="col">
        <h2>New here?</h2>
        <p>${joinError ? `<span class="err">${esc(joinError)}</span><br>` : ""}Memberships without Discord are coming soon. For now, join the GMG Discord to get access.</p>
        ${invite}
      </section>`;
  return page("Sign in -- GMG's NFL Suite", `${FORM_CSS}<div class="cols">${signin}${joinCol}</div>`, status, {}, true);
}

async function handleCheckout(request, env) {
  const session = await readSession(request, env);
  if (!joinOpen(env, session)) return joinPage(env, session);
  const form = await request.formData();
  const email = cleanEmail(form.get("email"));
  const plan = PLANS[form.get("plan")] ? { id: priceId(env, form.get("plan")) } : null;
  if (!EMAIL_RE.test(email) || !plan) return joinPage(env, session, "Enter a valid email and pick a plan.");
  const existing = await getMember(env, email);
  if (existing && MEMBER_STATUSES_IN.includes(existing.status)) return emailPage(env, "", "That email already has a membership. Sign in below.");
  const origin = new URL(request.url).origin;
  const params = {
    mode: "subscription",
    customer_email: email,
    "line_items[0][price]": plan.id,
    "line_items[0][quantity]": "1",
    payment_method_collection: "always",
    allow_promotion_codes: "true",
    "metadata[email]": email,
    "subscription_data[metadata][email]": email,
    success_url: `${origin}/join/done?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/join`,
  };
  // One free trial per email (the card check happens in the webhook).
  if (!(existing && existing.trial_used)) params["subscription_data[trial_period_days]"] = String(TRIAL_DAYS);
  try {
    const cs = await stripeApi(env, "POST", "checkout/sessions", params);
    return new Response(null, { status: 303, headers: { Location: cs.url } });
  } catch (e) {
    return joinPage(env, session, `Couldn't start checkout: ${e.message}`);
  }
}

// Stripe sends them back here after paying: record the subscription right
// away (the webhook may land a few seconds later) and sign them in.
async function handleJoinDone(request, env) {
  const id = new URL(request.url).searchParams.get("session_id") || "";
  if (!id.startsWith("cs_")) return joinPage(env, null);
  let cs;
  try {
    cs = await stripeApi(env, "GET", `checkout/sessions/${id}`, { "expand[]": "subscription" });
  } catch (e) {
    return joinPage(env, null, "We couldn't confirm that checkout. If you were charged, sign in with your email below.");
  }
  const email = cleanEmail((cs.metadata && cs.metadata.email) || cs.customer_email || (cs.customer_details && cs.customer_details.email));
  if (!email || cs.status !== "complete" || !cs.subscription || typeof cs.subscription !== "object") return joinPage(env, null, "That checkout isn't finished.");
  await saveSubscription(env, email, cs.subscription);
  try {
    await enforceOneTrialPerCard(env, email, cs.subscription);
  } catch (e) {
    // the card check is best-effort; the trial still stands
  }
  const m = await getMember(env, email);
  if (Date.now() / 1000 - cs.created > JOIN_DONE_MAX_AGE_S || !(await memberHasAccess(env, email))) return emailPage(env, email, "You're all set. Sign in with your email and password.");
  return redirectWithSession(m && m.pw ? "/" : "/set-password", await emailSession(env, email));
}

async function handleStripeWebhook(request, env) {
  const raw = await request.text();
  if (!(await verifyStripeSignature(env, raw, request.headers.get("Stripe-Signature")))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(raw);
  const obj = event.data && event.data.object;
  try {
    if (event.type === "checkout.session.completed" && obj.subscription) {
      const sub = await stripeApi(env, "GET", `subscriptions/${obj.subscription}`);
      const email = cleanEmail((obj.metadata && obj.metadata.email) || obj.customer_email || (obj.customer_details && obj.customer_details.email));
      if (email) await saveSubscription(env, email, sub);
    } else if (event.type.startsWith("customer.subscription.")) {
      const email = await emailForSubscription(env, obj);
      if (email) {
        await saveSubscription(env, email, obj);
        if (event.type === "customer.subscription.created") await enforceOneTrialPerCard(env, email, obj);
      }
    }
  } catch (e) {
    return new Response(`error: ${e.message}`, { status: 500 }); // Stripe retries
  }
  return new Response("ok");
}

function emailPage(env, email = "", message = "", status = 200) {
  return accessPage({ env, signinEmail: email, signinMsg: message, status });
}
async function handleEmailLogin(request, env) {
  const form = await request.formData();
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") || "");
  const m = EMAIL_RE.test(email) ? await getMember(env, email) : null;
  if (m && m.lock_until && m.lock_until > Date.now()) return emailPage(env, email, "Too many wrong passwords. Try again in 15 minutes.", 429);
  // Same answer for an unknown email and a wrong password.
  if (!m || !(await checkPassword(password, m.pw))) {
    if (m) {
      const fails = (m.fail_count || 0) + 1;
      const locked = fails >= LOGIN_FAILS_MAX;
      await env.DB.prepare("UPDATE members SET fail_count = ?, lock_until = ? WHERE email = ?")
        .bind(locked ? 0 : fails, locked ? Date.now() + LOGIN_LOCK_MS : null, email)
        .run();
    }
    return emailPage(env, email, "That email and password don't match.", 401);
  }
  await env.DB.prepare("UPDATE members SET fail_count = 0, lock_until = NULL WHERE email = ?").bind(email).run();
  if (!(await memberHasAccess(env, email, true))) return endedPage(email);
  return redirectWithSession("/", await emailSession(env, email));
}
// Pick (or change) a password -- for a signed-in email member.
async function handleSetPassword(request, env) {
  const session = await readSession(request, env);
  if (!session || session.kind !== "email") return emailPage(env);
  const email = session.name;
  let err = "";
  if (request.method === "POST") {
    const form = await request.formData();
    const pw = String(form.get("password") || "");
    if (pw.length < PW_MIN) err = `Use at least ${PW_MIN} characters.`;
    else if (pw !== String(form.get("confirm") || "")) err = "Those two passwords don't match.";
    else {
      await env.DB.prepare("UPDATE members SET pw = ?, fail_count = 0, lock_until = NULL WHERE email = ?").bind(await hashPassword(pw), email).run();
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }
  }
  const m = await getMember(env, email);
  const field = (name, ph) => `<input type="password" name="${name}" required minlength="${PW_MIN}" autocomplete="new-password" placeholder="${ph}" style="width:100%;padding:11px 12px;border-radius:9px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:1rem;margin-top:6px">`;
  return page(
    "Password -- GMG's NFL Suite",
    `${FORM_CSS}<p>${m && m.pw ? "Change your password" : `<b class="ok">You're in!</b> Pick a password so you can sign in on any device`} for <b>${esc(email)}</b>.</p>
     ${err ? `<p class="err">${esc(err)}</p>` : ""}
     <form method="post" style="text-align:left">${field("password", `New password (${PW_MIN}+ characters)`)}${field("confirm", "Type it again")}
       <button class="btn plan">Save password</button></form>`
  );
}
function endedPage(email) {
  return page(
    "Membership ended -- GMG's NFL Suite",
    `<p>The membership for <b>${esc(email)}</b> isn't active (cancelled, or a payment didn't go through).</p>
     <a class="btn plan" style="background:#22c55e;color:#03140a" href="/account">Manage membership</a>
     <a class="btn ghost" href="/join">Start a new membership</a>`,
    403,
    { "Set-Cookie": setCookie(COOKIE, "", 0) }
  );
}
// Stripe's own page for updating a card or cancelling.
async function handleAccount(request, env) {
  const session = await readSession(request, env);
  const email = session && session.kind === "email" ? session.name : null;
  const m = email ? await getMember(env, email) : null;
  if (!m || !m.customer) return emailPage(env, email || "", "Sign in with your email to manage your membership.");
  try {
    const portal = await stripeApi(env, "POST", "billing_portal/sessions", { customer: m.customer, return_url: new URL(request.url).origin + "/" });
    return new Response(null, { status: 303, headers: { Location: portal.url } });
  } catch (e) {
    return page("Manage membership -- GMG's NFL Suite", `<p class="err">${esc(e.message)}</p><a class="btn ghost" href="/">Back to the site</a>`, 500);
  }
}

// Owner-only: give someone access until a date (Zelle/Venmo payers).
async function handleAdminMembers(request, env) {
  const session = await readSession(request, env);
  if (!isOwnerSession(session)) return loginPage("/admin/members");
  let msg = "";
  if (request.method === "POST") {
    const form = await request.formData();
    const email = cleanEmail(form.get("email"));
    const until = Date.parse(String(form.get("until") || "") + "T23:59:59");
    if (!EMAIL_RE.test(email)) msg = "Enter a valid email.";
    else if (form.get("action") === "reset") {
      const temp = b64url(crypto.getRandomValues(new Uint8Array(6)));
      const hit = await getMember(env, email);
      if (!hit) msg = `No member with ${email}.`;
      else {
        await env.DB.prepare("UPDATE members SET pw = ?, fail_count = 0, lock_until = NULL WHERE email = ?").bind(await hashPassword(temp), email).run();
        msg = `Temporary password for ${email}: ${temp} -- send it to them; they can change it after signing in (Password, next to Log out).`;
      }
    } else if (form.get("action") === "remove") {
      await env.DB.prepare("UPDATE members SET manual_until = NULL WHERE email = ?").bind(email).run();
      msg = `Removed manual access for ${email}.`;
    } else if (!until) msg = "Pick an end date.";
    else {
      await env.DB.prepare(
        `INSERT INTO members (email, manual_until, note, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET manual_until = excluded.manual_until, note = excluded.note, updated = excluded.updated`
      )
        .bind(email, until, String(form.get("note") || "").slice(0, 120), Date.now())
        .run();
      msg = `${email} has access through ${new Date(until).toLocaleDateString("en-US")}.`;
    }
  }
  const { results } = await env.DB.prepare("SELECT email, status, period_end, manual_until, note FROM members ORDER BY updated DESC LIMIT 300").all();
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US") : "");
  const rows = (results || [])
    .map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(r.status || "")}</td><td>${day(r.period_end)}</td><td>${day(r.manual_until)}</td><td>${esc(r.note || "")}</td></tr>`)
    .join("");
  return page(
    "Members -- GMG's NFL Suite",
    `${FORM_CSS}<p>Give someone access until a date (Zelle / Venmo payers), reset a forgotten password, or see every email member. For a manual-access member: grant access, then reset their password to get a temporary one to send them.</p>
     ${msg ? `<p class="ok">${esc(msg)}</p>` : ""}
     <form method="post" style="text-align:left">
       <input type="email" name="email" required placeholder="member@example.com">
       <input type="date" name="until">
       <input type="text" name="note" placeholder="Note (e.g. Zelle Oct)">
       <button class="btn plan" name="action" value="grant">Grant access until that date</button>
       <button class="btn ghost" name="action" value="remove">Remove manual access</button>
       <button class="btn ghost" name="action" value="reset">Reset their password (shows a temporary one)</button>
     </form>
     <table><tr><th>Email</th><th>Stripe</th><th>Renews</th><th>Manual until</th><th>Note</th></tr>${rows || `<tr><td colspan="5">No email members yet.</td></tr>`}</table>
     <a class="btn ghost" href="/">Back to the site</a>`
  );
}

// ---- the gate ----
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // Setup check: which pieces are in place (never the secret values).
  if (url.pathname === "/auth/status") {
    const status = {
      gate: gateEnabled(env) ? "on" : gateReady(env) ? "test mode" : "off",
      clientId: !!CLIENT_ID,
      roles: ALLOWED_ROLE_IDS.length,
      clientSecret: !!env.DISCORD_CLIENT_SECRET,
      botToken: !!env.DISCORD_BOT_TOKEN,
      profiles: !!env.DB,
      emailMembers: membersReady(env) ? (stripeTestMode(env) ? "test mode" : "on") : "off",
      stripeKey: !!env.STRIPE_SECRET_KEY,
      stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
    };
    return new Response(JSON.stringify(status), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  // Email-member routes (they work before sign-in, by design).
  if (gateReady(env) && membersReady(env)) {
    const p = url.pathname;
    const post = request.method === "POST";
    if (p === "/stripe/webhook" && post) return handleStripeWebhook(request, env);
    if (p === "/join") return joinPage(env, await readSession(request, env));
    if (p === "/stripe/checkout" && post) return handleCheckout(request, env);
    if (p === "/join/done") return handleJoinDone(request, env);
    if (p === "/auth/email") return post ? handleEmailLogin(request, env) : emailPage(env);
    if (p === "/set-password") return handleSetPassword(request, env);
    if (p === "/account") return handleAccount(request, env);
    if (p === "/admin/members") return handleAdminMembers(request, env);
  }
  if (gateReady(env)) {
    if (url.pathname === "/auth/login") return handleLogin(request);
    if (url.pathname === "/auth/callback") return handleCallback(request, env);
    if (url.pathname === "/auth/logout") return handleLogout();
    if (url.pathname === "/auth/check") return handleCheck(request, env);
  }
  if (!gateEnabled(env)) return next(); // not configured / test mode: site stays open
  if (await isBuildRequest(request, env)) return next();

  const isApi = url.pathname.startsWith("/api/");
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  let session = null;
  try {
    session = await verify(env, getCookie(request, COOKIE));
  } catch (e) {
    session = null;
  }
  if (!session) return isApi ? json({ error: "login" }, 401) : loginPage(url.pathname + url.search, env);

  // Roles re-checked with Discord whenever the last check is older than
  // RECHECK_MS -- this is what makes a cancelled role stop working.
  const age = Date.now() - session.checked;
  let refreshed = null;
  if (age >= RECHECK_MS && session.kind === "email") {
    if (!env.DB) return isApi ? json({ error: "members" }, 503) : deniedPage("api");
    if (!(await memberHasAccess(env, session.name, true))) return isApi ? json({ error: "membership" }, 403) : endedPage(session.name);
    const m = await getMember(env, session.name);
    if (!isApi && !(m && m.pw)) return new Response(null, { status: 302, headers: { Location: "/set-password" } });
    refreshed = await sign(env, { ...session, checked: Date.now() });
  } else if (age >= RECHECK_MS) {
    const check = await memberRoles(env, session.uid);
    if (!check.ok && check.reason === "api") {
      if (age >= OUTAGE_GRACE_MS) return isApi ? json({ error: "discord" }, 503) : deniedPage("api");
    } else {
      if (!check.ok) return isApi ? json({ error: check.reason }, 403) : deniedPage(check.reason);
      if (!hasAllowedRole(check.roles)) return isApi ? json({ error: "no-role" }, 403) : deniedPage("no-role");
      refreshed = await sign(env, { ...session, checked: Date.now() });
    }
  }
  const res = isApi ? await handleApi(request, env, session, json) : await next();
  if (!refreshed) return res;
  const out = new Response(res.body, res);
  out.headers.append("Set-Cookie", setCookie(COOKIE, refreshed, SESSION_DAYS * 86400));
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}
