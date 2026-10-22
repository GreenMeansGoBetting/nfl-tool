"""The owner's members page (/admin/members in nfl_tool/functions/_middleware.js):
a pasted list of emails gets free access in one click (2026-10-22, moving the
Stripe members to Buildr with 30 days free). Pinned: a list separated by
commas, spaces or new lines grants every email the same date and note; one
email still works; a bad address in the list stops the whole list; a reset
takes one email only; only the owner gets in. Loaded the same way as
test_ci_hosting, with a small stand-in for the D1 database. Named test_ci_*
so it runs with every test."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
OWNER = "613105360286253076"

EXTRA = r"""
window.Request = class extends Request {
  constructor(input, init = {}) { super(input, init); this.form = init.form || {}; }
  async formData() { const f = this.form; return { get: (k) => (k in f ? f[k] : null) }; }
};
// A D1 stand-in that knows the members page's statements.
window.fakeDB = () => {
  const rows = new Map();
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT INTO members")) {
        const [email, until, note] = args;
        rows.set(email, { ...(rows.get(email) || { email }), manual_until: until, note });
      } else if (sql.startsWith("UPDATE members SET manual_until = NULL")) {
        if (rows.has(args[0])) rows.get(args[0]).manual_until = null;
      }
      return {};
    },
    first: async () => rows.get(args[0]) || null,
    all: async () => ({ results: [...rows.values()] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; }, rows };
};
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
window.cookieFor = async (uid) => {
  const base = await crypto.subtle.importKey("raw", enc.encode("x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, enc.encode("gmg-session-v1"));
  const key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = b64(enc.encode(JSON.stringify({ uid, name: "t", checked: Date.now(), exp: Date.now() + 864e5 })));
  return `gmg_session=${encodeURIComponent(`${body}.${b64(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`)}`;
};
window.DB = fakeDB();
window.admin = async (form, uid = "613105360286253076") => {
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", STRIPE_SECRET_KEY: "sk_live_x", DB: window.DB };
  const req = new Request("https://nfl.gmgsports.org/admin/members", { method: form ? "POST" : "GET", headers: { Cookie: await cookieFor(uid) }, form: form || {} });
  const res = await window.MW.onRequest({ request: req, env, next: async () => new Response("file") });
  return { status: res.status, body: String(res.body), rows: Object.fromEntries([...window.DB.rows].map(([k, v]) => [k, v])) };
};
true;
"""

LIST = "a@example.com, B@Example.com\nc@example.com  d@example.com;a@example.com"


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


def admin(form=None, uid=OWNER):
    return PAGE.evaluate(f"() => admin({json.dumps(form)}, {json.dumps(uid)})")


class AdminMembers(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { window.DB = fakeDB(); }")

    def test_a_pasted_list_is_granted_in_one_go(self):
        got = admin({"email": LIST, "until": "2026-11-21", "note": "Moving to Buildr", "action": "grant"})
        self.assertIn("4 members have access through", got["body"])
        self.assertEqual(sorted(got["rows"]), ["a@example.com", "b@example.com", "c@example.com", "d@example.com"])
        self.assertEqual({r["note"] for r in got["rows"].values()}, {"Moving to Buildr"})
        self.assertEqual(len({r["manual_until"] for r in got["rows"].values()}), 1)

    def test_one_email_still_works(self):
        got = admin({"email": " One@Example.com ", "until": "2026-11-21", "note": "", "action": "grant"})
        self.assertIn("one@example.com has access through", got["body"])
        self.assertEqual(list(got["rows"]), ["one@example.com"])

    def test_a_bad_address_stops_the_list(self):
        got = admin({"email": "a@example.com, not-an-email", "until": "2026-11-21", "note": "", "action": "grant"})
        self.assertIn("Not a valid email: not-an-email", got["body"])
        self.assertEqual(got["rows"], {})

    def test_remove_takes_a_list_and_reset_takes_one(self):
        admin({"email": LIST, "until": "2026-11-21", "note": "", "action": "grant"})
        got = admin({"email": "a@example.com, b@example.com", "until": "", "note": "", "action": "remove"})
        self.assertIn("Removed manual access for 2 members", got["body"])
        self.assertIsNone(got["rows"]["a@example.com"]["manual_until"])
        self.assertIsNotNone(got["rows"]["c@example.com"]["manual_until"])
        self.assertIn("Reset one password at a time", admin({"email": "a@example.com b@example.com", "until": "", "note": "", "action": "reset"})["body"])

    def test_owner_only(self):
        self.assertNotIn("Grant access until that date", admin(uid="123")["body"])
        self.assertIn("<textarea name=\"email\"", admin()["body"])


if __name__ == "__main__":
    unittest.main()
