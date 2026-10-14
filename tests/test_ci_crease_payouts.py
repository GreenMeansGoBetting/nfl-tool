"""King of the Crease payouts: /api/crease-payouts in the login middleware
(nfl_tool/functions/_middleware.js), added 2026-10-14.

The owner pastes what DraftKings paid after each contest on the NHL Promo
Tools page; every member reads it in the Winners list. Pinned: any signed-in
member can read, only the owner can save, a day is replaced (never added to)
and an empty list removes it, bad input is refused, and it works on the
hockey address. Loaded the same way as test_ci_hosting (a blank page in the
test browser, Cloudflare stood in for), with a small stand-in for the D1
database. Named test_ci_* so it runs with every test."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
OWNER = "613105360286253076"

# Request with a body; a D1 stand-in that knows this table's four statements;
# a session cookie signed the way the middleware signs one (key "x").
EXTRA = r"""
Request.prototype.json = async function () { return JSON.parse(this.body); };
const OldRequest = Request;
window.Request = class extends OldRequest { constructor(input, init = {}) { super(input, init); this.body = init.body; } };
window.fakeDB = () => {
  const rows = new Map();
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT INTO crease_payouts")) rows.set(args[0], { date: args[0], pool: args[1], payouts: args[2] });
      if (sql.startsWith("DELETE FROM crease_payouts")) rows.delete(args[0]);
      return {};
    },
    all: async () => ({ results: [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) }),
  });
  return { prepare: (sql) => stmt(sql), rows };
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
window.api = async (url, { uid = null, method = "GET", body = null } = {}) => {
  const headers = uid ? { Cookie: await cookieFor(uid) } : {};
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", DB: window.DB };
  const req = new Request(url, { method, headers, body: body === null ? null : JSON.stringify(body) });
  const res = await window.MW.onRequest({ request: req, env, next: async () => new Response("file") });
  let out = null;
  try { out = JSON.parse(res.body); } catch (e) { out = res.body; }
  return { status: res.status, body: out };
};
true;
"""

URL = "https://nfl.gmgsports.org/api/crease-payouts"
DAY = {"date": "2026-10-13", "pool": 500000, "payouts": [{"id": "8482221", "name": "Devon Levi", "paid": 1961}, {"id": "8480045", "name": "Ukko-Pekka Luukkonen", "paid": 2748}]}


def setUpModule():
    global PW, BROWSER, PAGE
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(INSTALL_HELP) from None
    PW = sync_playwright().start()
    BROWSER = PW.chromium.launch()
    PAGE = BROWSER.new_page()
    # An https page: signing a session needs crypto.subtle, which a blank page lacks.
    PAGE.route("https://middleware.test/", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>middleware</title>"))
    PAGE.goto("https://middleware.test/")
    PAGE.evaluate(FAKES)
    PAGE.evaluate(EXTRA)
    src = base64.b64encode(MIDDLEWARE.read_bytes()).decode()
    PAGE.evaluate(f'async () => {{ window.MW = await import("data:text/javascript;base64,{src}"); }}')


def tearDownModule():
    BROWSER.close()
    PW.stop()


def api(url=URL, **opts):
    return PAGE.evaluate(f"() => api({json.dumps(url)}, {json.dumps(opts)})")


class Payouts(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { window.DB = fakeDB(); }")

    def test_signed_out_gets_nothing(self):
        self.assertEqual(api()["status"], 401)

    def test_a_member_reads_but_cannot_save(self):
        self.assertEqual(api(uid=OWNER, method="PUT", body=DAY)["status"], 200)
        self.assertEqual(api(uid="123", method="PUT", body={**DAY, "pool": 1})["status"], 403)
        got = api(uid="123")
        self.assertEqual(got["status"], 200)
        self.assertEqual(got["body"]["days"]["2026-10-13"], {"pool": 500000, "payouts": DAY["payouts"]})

    def test_a_day_is_replaced_and_an_empty_list_removes_it(self):
        api(uid=OWNER, method="PUT", body=DAY)
        api(uid=OWNER, method="PUT", body={**DAY, "payouts": DAY["payouts"][:1]})
        self.assertEqual(len(api(uid=OWNER)["body"]["days"]["2026-10-13"]["payouts"]), 1)
        api(uid=OWNER, method="PUT", body={**DAY, "payouts": []})
        self.assertEqual(api(uid=OWNER)["body"]["days"], {})

    def test_bad_input_is_refused(self):
        for bad in ({**DAY, "date": "10/13"}, {**DAY, "pool": 0}, {**DAY, "payouts": [{"name": "", "paid": 5}]},
                    {**DAY, "payouts": [{"name": "A", "paid": -1}]}, {**DAY, "payouts": "Levi 1961"}):
            self.assertEqual(api(uid=OWNER, method="PUT", body=bad)["status"], 400, bad)
        self.assertEqual(api(uid=OWNER)["body"]["days"], {})

    def test_it_answers_on_the_hockey_address(self):
        api(uid=OWNER, method="PUT", body=DAY)
        self.assertIn("2026-10-13", api("https://nhl.gmgsports.org/api/crease-payouts", uid="123")["body"]["days"])


if __name__ == "__main__":
    unittest.main()
