"""Sign in with Buildr (2026-10-22): members who join on Buildr without
Discord sign in through Buildr's OpenID Connect, and access follows their
CURRENT Buildr subscription (login code: nfl_tool/functions/_middleware.js,
the "Buildr members" block).

Pinned against a fake Buildr: everything stays off until the keys exist;
the sign-in sends PKCE; a paid member gets a session and an unpaid one
doesn't; a wrong state is refused; the email lookup finds a member whose id
differs from the sign-in's; the 15-minute re-check cuts a cancelled member
off but rides out a short Buildr outage; sign-in on the hockey address runs
on the NFL address. Loaded the same way as test_ci_hosting. Named test_ci_*
so it runs with every test."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"

EXTRA = r"""
// The fake Buildr: window.B holds what it answers.
window.resetBuildr = () => {
  window.B = { me: { sub: "m1", email: "fan@example.com", name: "Fan" }, members: { m1: "active" }, byEmail: {}, down: false, calls: [] };
};
resetBuildr();
const reply = (status, obj) => ({ ok: status < 300, status, json: async () => obj });
const member = (id, sub) => ({ id, object: "member", email: "fan@example.com", name: "Fan", image: null, role: "member", status: "active",
  has_active_subscription: sub === "active", active_subscriptions: [{ id: "s1", product_id: "p1", product_name: "GMG", status: sub, payment_collection_paused: false, current_period_end: null }] });
window.fetch = async (url, init = {}) => {
  url = String(url);
  B.calls.push({ url, method: init.method || "GET", body: init.body ? String(init.body) : "", auth: (init.headers || {}).Authorization || "" });
  if (B.down) return reply(503, {});
  if (url.endsWith("/api/oidc/token")) return reply(200, { access_token: "at" });
  if (url.endsWith("/api/oidc/me")) return reply(200, B.me);
  if (url.endsWith("/api/v1/members/lookup")) {
    const id = B.byEmail[JSON.parse(init.body).email];
    return reply(200, id ? { found: true, member: member(id, B.members[id]) } : { found: false, member: null });
  }
  const m = url.match(/\/api\/v1\/members\/([^/?]+)$/);
  if (m) return B.members[m[1]] ? reply(200, member(m[1], B.members[m[1]])) : reply(404, { error: { code: "not_found", message: "no", status: 404 } });
  throw new Error(`unexpected fetch ${url}`);
};
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
window.sessionCookie = async (payload) => {
  const base = await crypto.subtle.importKey("raw", enc.encode("x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, enc.encode("gmg-session-v1"));
  const key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = b64(enc.encode(JSON.stringify(payload)));
  return `gmg_session=${encodeURIComponent(`${body}.${b64(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`)}`;
};
window.go = async (url, { keys = true, cookie = "" } = {}) => {
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", STRIPE_SECRET_KEY: "sk_live_x", DB: {} };
  if (keys) Object.assign(env, { BUILDR_CLIENT_ID: "gmg-site", BUILDR_API_KEY: "bld_sk_test" });
  const req = new Request(url, { headers: cookie ? { Cookie: cookie } : {} });
  const res = await window.MW.onRequest({ request: req, env, next: async () => new Response("file") });
  return { status: res.status, body: String(res.body), location: res.headers.get("location"), cookies: res.headers.getSetCookie() };
};
// Sign in from the start: login, then Buildr sends them back with a code.
window.signIn = async ({ state = null } = {}) => {
  const login = await go("https://nfl.gmgsports.org/auth/buildr/login?next=/player-props.html");
  const sent = new URL(login.location);
  const stateCookie = login.cookies[0].split(";")[0];
  const back = await go(`https://nfl.gmgsports.org/auth/buildr/callback?code=c1&state=${state || sent.searchParams.get("state")}&iss=${encodeURIComponent("https://auth.buildr.bet/api/oidc")}`, { cookie: stateCookie });
  return { login, sent: Object.fromEntries(sent.searchParams), back };
};
true;
"""

NFL = "https://nfl.gmgsports.org/"


def setUpModule():
    global PW, BROWSER, PAGE
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(INSTALL_HELP) from None
    PW = sync_playwright().start()
    BROWSER = PW.chromium.launch()
    PAGE = BROWSER.new_page()
    PAGE.route("https://middleware.test/", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>middleware</title>"))
    PAGE.goto("https://middleware.test/")
    PAGE.evaluate(FAKES)
    PAGE.evaluate(EXTRA)
    src = base64.b64encode(MIDDLEWARE.read_bytes()).decode()
    PAGE.evaluate(f'async () => {{ window.MW = await import("data:text/javascript;base64,{src}"); }}')


def tearDownModule():
    BROWSER.close()
    PW.stop()


def js(expr):
    return PAGE.evaluate(f"async () => {expr}")


def go(url, **opts):
    return PAGE.evaluate(f"() => go({json.dumps(url)}, {json.dumps(opts)})")


def session_cookie(uid="buildr:m1", minutes_ago=0):
    return js(f"sessionCookie({{ uid: {json.dumps(uid)}, name: 'Fan', kind: 'buildr', checked: Date.now() - {minutes_ago} * 60000, exp: Date.now() + 864e5 }})")


class BuildrMembers(unittest.TestCase):
    def setUp(self):
        js("resetBuildr()")

    def test_off_until_the_keys_exist(self):
        page = go(NFL, keys=False)
        self.assertEqual(page["status"], 401)
        self.assertNotIn("Sign in with Buildr", page["body"])
        self.assertNotIn("buildr.bet/api/oidc", str(go(NFL + "auth/buildr/login", keys=False)["location"]))

    def test_sign_in_page_offers_buildr(self):
        body = go(NFL)["body"]
        self.assertIn("Sign in with Buildr", body)
        # Join goes to the website-only product, never the Discord one
        self.assertIn('href="https://gmgsports.buildr.bet/checkout/3e042f6f-d087-46ad-a4da-9ac1d7b7b4e1"', body)
        self.assertIn("Hate Discord? No problem", body)
        self.assertIn("Already joined with email?", body)  # Stripe members still sign in
        self.assertNotIn("/stripe/checkout", body)

    def test_login_sends_pkce_and_a_state(self):
        sent = js("signIn()")["sent"]
        self.assertEqual(sent["client_id"], "gmg-site")
        self.assertEqual(sent["code_challenge_method"], "S256")
        self.assertTrue(sent["code_challenge"] and sent["state"])
        self.assertEqual(sent["redirect_uri"], "https://nfl.gmgsports.org/auth/buildr/callback")
        token = [c for c in js("B.calls") if c["url"].endswith("/token")][0]
        self.assertIn("code_verifier=", token["body"])

    def test_a_paid_member_gets_in_and_lands_where_they_started(self):
        back = js("signIn()")["back"]
        self.assertEqual(back["status"], 302)
        self.assertEqual(back["location"], "/player-props.html")
        self.assertTrue(any(c.startswith("gmg_session=") and "Max-Age=0" not in c for c in back["cookies"]))
        # the API key goes to the members API, never to the sign-in endpoints
        for c in js("B.calls"):
            self.assertEqual("bld_sk_test" in c["auth"], "/api/v1/" in c["url"], c["url"])

    def test_an_unpaid_member_is_turned_away(self):
        for status in ("canceled", "past_due", "unpaid"):
            js(f"(B.members.m1 = {json.dumps(status)}, true)")
            back = js("signIn()")["back"]
            self.assertEqual(back["status"], 403, status)
            self.assertIn("doesn't have an active GMG membership", back["body"])
            self.assertFalse(any(c.startswith("gmg_session=") and "Max-Age=0" not in c for c in back["cookies"]), status)

    def test_a_trial_counts(self):
        js("(B.members.m1 = 'trialing', true)")
        self.assertEqual(js("signIn()")["back"]["status"], 302)

    def test_a_wrong_state_is_refused(self):
        back = js("signIn({ state: 'forged' })")["back"]
        self.assertEqual(back["status"], 401)
        self.assertFalse([c for c in js("B.calls") if c["url"].endswith("/token")])

    def test_email_lookup_when_the_ids_differ(self):
        js("(B.members = { member_9: 'active' }, B.byEmail = { 'fan@example.com': 'member_9' }, true)")
        back = js("signIn()")["back"]
        self.assertEqual(back["status"], 302)
        self.assertTrue(any("/members/lookup" in c["url"] for c in js("B.calls")))

    def test_recheck_cuts_off_a_cancelled_member(self):
        old = session_cookie(minutes_ago=20)
        self.assertEqual(go(NFL + "game-overview.html", cookie=old)["status"], 200)
        js("(B.members.m1 = 'canceled', true)")
        self.assertEqual(go(NFL + "game-overview.html", cookie=old)["status"], 403)
        fresh = session_cookie(minutes_ago=1)  # checked a minute ago: no new check yet
        self.assertEqual(go(NFL + "game-overview.html", cookie=fresh)["status"], 200)

    def test_a_short_buildr_outage_keeps_members_in(self):
        js("(B.down = true, true)")
        self.assertEqual(go(NFL + "game-overview.html", cookie=session_cookie(minutes_ago=20))["status"], 200)
        self.assertEqual(go(NFL + "game-overview.html", cookie=session_cookie(minutes_ago=180))["status"], 403)

    def test_hockey_address_signs_in_on_the_nfl_address(self):
        got = go("https://nhl.gmgsports.org/auth/buildr/login?next=/shots")
        self.assertEqual(got["status"], 302)
        self.assertEqual(got["location"], "https://nfl.gmgsports.org/auth/buildr/login?next=" + "https%3A%2F%2Fnhl.gmgsports.org%2Fshots")


if __name__ == "__main__":
    unittest.main()
