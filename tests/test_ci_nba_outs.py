"""The owner's NBA Mark Out: /api/nba-outs in the login middleware
(nfl_tool/functions/_middleware.js), added 2026-10-25.

The owner sees a player ruled out (an Underdog post) before ESPN or the NBA
list him, clicks Mark Out on the Matchup View, and the sims rerun without
him. Pinned: any signed-in member and the NBA build (its key) can read a
night's list, only the owner can mark or unmark, a mark presses
nba-refresh.yml with the timer's token (and says so when there is none), bad
input is refused. Loaded like test_ci_crease_payouts (a blank page in the
test browser, Cloudflare and D1 stood in for). Named test_ci_* so it runs
with every test."""
import base64
import hashlib
import hmac
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
OWNER = "613105360286253076"

EXTRA = r"""
Request.prototype.json = async function () { return JSON.parse(this.body); };
const OldRequest = Request;
window.Request = class extends OldRequest { constructor(input, init = {}) { super(input, init); this.body = init.body; } };
window.fakeDB = () => {
  const rows = new Map();
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT INTO nba_outs")) rows.set(`${args[0]}|${args[1]}`, { day: args[0], pid: args[1], name: args[2], team: args[3], updated: args[4] });
      else if (sql.startsWith("DELETE FROM nba_outs")) rows.delete(`${args[0]}|${args[1]}`);
      return {};
    },
    all: async () => ({ results: [...rows.values()].filter((r) => r.day === args[0]).map(({ day, ...r }) => r) }),
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
window.pressed = [];
window.fetch = async (url, init) => { window.pressed.push([url, JSON.parse(init.body), init.headers.Authorization]); return new Response(null, { status: 204 }); };
window.api = async (url, { uid = null, method = "GET", body = null, build = null, token = "t0k" } = {}) => {
  const headers = uid ? { Cookie: await cookieFor(uid) } : {};
  if (build) headers["X-GMG-Build"] = build;
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", DB: window.DB, ...(token ? { DISPATCH_TOKEN: token } : {}) };
  const req = new Request(url, { method, headers, body: body === null ? null : JSON.stringify(body) });
  const res = await window.MW.onRequest({ request: req, env, next: async () => new Response("file") });
  let out = null;
  try { out = JSON.parse(res.body); } catch (e) { out = res.body; }
  return { status: res.status, body: out };
};
true;
"""

URL = "https://nfl.gmgsports.org/api/nba-outs"
DAY = "2026-10-25"
MARK = {"day": DAY, "pid": "3059318", "name": "Joel Embiid", "team": "PHI", "out": True}
BUILD_KEY = hmac.new(b"x", b"gmg-build-v1", hashlib.sha256).hexdigest()


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


def api(url=URL + f"?day={DAY}", **opts):
    return PAGE.evaluate(f"() => api({json.dumps(url)}, {json.dumps(opts)})")


class MarkOut(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { window.DB = fakeDB(); window.pressed = []; }")

    def test_signed_out_gets_nothing(self):
        self.assertEqual(api()["status"], 401)
        self.assertEqual(api(method="PUT", body=MARK)["status"], 401)

    def test_the_owner_marks_and_the_sims_rerun(self):
        got = api(URL, uid=OWNER, method="PUT", body=MARK)
        self.assertEqual(got, {"status": 200, "body": {"ok": True, "refresh": "started"}})
        pressed = PAGE.evaluate("() => window.pressed")
        self.assertEqual(pressed, [["https://api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/workflows/nba-refresh.yml/dispatches",
                                    {"ref": "main", "inputs": {"source": "markout"}}, "Bearer t0k"]])
        outs = api(uid="123")["body"]["outs"]  # any member reads it
        self.assertEqual([(o["pid"], o["name"], o["team"]) for o in outs], [("3059318", "Joel Embiid", "PHI")])
        self.assertEqual(api(URL + "?day=2026-10-26", uid="123")["body"]["outs"], [])  # another night
        # Undo
        api(URL, uid=OWNER, method="PUT", body={**MARK, "out": False})
        self.assertEqual(api(uid="123")["body"]["outs"], [])
        # no token on the site yet: saved, and it says the refresh wasn't started
        self.assertEqual(api(URL, uid=OWNER, method="PUT", body=MARK, token=None)["body"]["refresh"], "no token")

    def test_only_the_owner_marks(self):
        self.assertEqual(api(URL, uid="123", method="PUT", body=MARK)["status"], 403)
        self.assertEqual(api(uid="123")["body"]["outs"], [])
        self.assertEqual(PAGE.evaluate("() => window.pressed"), [])

    def test_the_build_reads_with_its_key_and_cannot_write(self):
        api(URL, uid=OWNER, method="PUT", body=MARK)
        got = api(build=BUILD_KEY)
        self.assertEqual((got["status"], [o["pid"] for o in got["body"]["outs"]]), (200, ["3059318"]))
        self.assertEqual(api(URL, method="PUT", body={**MARK, "out": False}, build=BUILD_KEY)["body"], "file")  # passed to the files, never the list
        self.assertEqual(len(api(build=BUILD_KEY)["body"]["outs"]), 1)
        self.assertEqual(api(build="wrong")["status"], 401)

    def test_bad_input_is_refused(self):
        for bad in ({**MARK, "day": "10/25"}, {**MARK, "pid": "x1"}, {**MARK, "team": "phi"}, {**MARK, "out": "yes"}):
            self.assertEqual(api(URL, uid=OWNER, method="PUT", body=bad)["status"], 400, bad)
        self.assertEqual(api(URL + "?day=today", uid="123")["status"], 400)


if __name__ == "__main__":
    unittest.main()
