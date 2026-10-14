"""One address per sport: nfl. / nba. / nhl.gmgsports.org (2026-10-14).

The login middleware (nfl_tool/functions/_middleware.js) runs on Cloudflare,
and there is no Node on the owner's PC, so it is loaded into a blank page in
the test browser with a stand-in for Cloudflare (Request / Response / Headers,
the asset server and next()). Named test_ci_* so it runs with every test: the
middleware is shared by all three sports."""
import base64
import json
import unittest
from urllib.parse import unquote

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"

# Simple stand-ins: the browser's own Response drops Set-Cookie headers.
FAKES = r"""
class Headers {
  constructor(init) {
    this.l = [];
    if (init instanceof Headers) this.l = init.l.map((x) => [...x]);
    else if (init) for (const [k, v] of Object.entries(init)) this.l.push([k.toLowerCase(), v]);
  }
  get(k) { const e = this.l.find((x) => x[0] === k.toLowerCase()); return e ? e[1] : null; }
  set(k, v) { this.delete(k); this.l.push([k.toLowerCase(), v]); }
  append(k, v) { this.l.push([k.toLowerCase(), v]); }
  delete(k) { this.l = this.l.filter((x) => x[0] !== k.toLowerCase()); }
  getSetCookie() { return this.l.filter((x) => x[0] === "set-cookie").map((x) => x[1]); }
}
class Response {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = new Headers(init.headers); }
}
class Request {
  constructor(input, init = {}) {
    this.url = typeof input === "string" ? input : input.url;
    this.method = init.method || "GET";
    this.headers = new Headers(init.headers);
  }
}
window.Headers = Headers; window.Response = Response; window.Request = Request;
window.call = async (url, { signedIn = false, assets = {} } = {}) => {
  const served = [];
  const env = signedIn ? { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x" } : {};
  env.ASSETS = { fetch: async (r) => { served.push(["assets", new URL(r.url).pathname]); return new Response("file", assets[new URL(r.url).pathname] || {}); } };
  const next = async (r) => { served.push(["next", new URL(r ? r.url : url).pathname]); return new Response("file"); };
  const res = await window.MW.onRequest({ request: new Request(url), env, next });
  return { status: res.status, location: res.headers.get("location"), cookies: res.headers.getSetCookie(), served };
};
true; // (a script that ends in a function would be called by Playwright)
"""


def setUpModule():
    global PW, BROWSER, PAGE
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(INSTALL_HELP) from None
    PW = sync_playwright().start()
    BROWSER = PW.chromium.launch()
    PAGE = BROWSER.new_page()
    PAGE.set_content("<!doctype html><title>middleware</title>")
    PAGE.evaluate(FAKES)
    src = base64.b64encode(MIDDLEWARE.read_bytes()).decode()
    PAGE.evaluate(f'async () => {{ window.MW = await import("data:text/javascript;base64,{src}"); }}')


def tearDownModule():
    BROWSER.close()
    PW.stop()


def call(url, **opts):
    return PAGE.evaluate(f"() => call({json.dumps(url)}, {json.dumps(opts)})")


class SportAddresses(unittest.TestCase):
    def test_a_sport_address_serves_that_sports_folder(self):
        self.assertEqual(call("https://nhl.gmgsports.org/")["served"], [["assets", "/nhl/"]])
        self.assertEqual(call("https://nhl.gmgsports.org/shots")["served"], [["assets", "/nhl/shots"]])
        self.assertEqual(call("https://nhl.gmgsports.org/players/TOR.json")["served"], [["assets", "/nhl/players/TOR.json"]])
        self.assertEqual(call("https://nba.gmgsports.org/data.json")["served"], [["assets", "/nba/data.json"]])

    def test_shared_files_come_from_the_root(self):
        for path in ("/style.css", "/suite.css", "/sync.js", "/version.json", "/brand/gmg-logo.png"):
            self.assertEqual(call(f"https://nhl.gmgsports.org{path}")["served"], [["next", path]], path)

    def test_cloudflares_own_redirects_drop_the_folder_name(self):
        r = call("https://nhl.gmgsports.org/shots.html", assets={"/nhl/shots.html": {"status": 308, "headers": {"Location": "/nhl/shots"}}})
        self.assertEqual((r["status"], r["location"]), (308, "/shots"))
        r = call("https://nhl.gmgsports.org/index.html", assets={"/nhl/index.html": {"status": 308, "headers": {"Location": "/nhl/"}}})
        self.assertEqual(r["location"], "/")

    def test_old_folder_links_and_nfl_pages_move(self):
        self.assertEqual(call("https://nhl.gmgsports.org/nhl/shots.html?x=1")["location"], "/shots.html?x=1")
        self.assertEqual(call("https://nhl.gmgsports.org/nhl")["location"], "/")
        self.assertEqual(call("https://nhl.gmgsports.org/game-overview.html")["location"], "https://nfl.gmgsports.org/game-overview.html")

    def test_old_nfl_address_links_go_to_the_sports_own_address(self):
        self.assertEqual(call("https://nfl.gmgsports.org/nhl/")["location"], "https://nhl.gmgsports.org/")
        self.assertEqual(call("https://nfl.gmgsports.org/nhl")["location"], "https://nhl.gmgsports.org/")
        self.assertEqual(call("https://nfl.gmgsports.org/nhl/shots.html?g=1")["location"], "https://nhl.gmgsports.org/shots.html?g=1")
        self.assertEqual(call("https://nfl.gmgsports.org/nba/")["location"], "https://nba.gmgsports.org/")
        # Data files stay put (the build reads them here), and so does the NFL.
        self.assertIsNone(call("https://nfl.gmgsports.org/nhl/players/TOR.json")["location"])
        self.assertIsNone(call("https://nfl.gmgsports.org/game-overview.html")["location"])
        self.assertIsNone(call("https://nfl.gmgsports.org/nhlish.html")["location"])

    def test_the_nfl_address_is_the_site_as_it_is_on_disk(self):
        self.assertEqual(call("https://nfl.gmgsports.org/game-overview.html")["served"], [["next", "/game-overview.html"]])
        # The build reads the sports' data here; data files never move.
        self.assertEqual(call("https://nfl.gmgsports.org/nhl/data.json")["served"], [["next", "/nhl/data.json"]])


class OneSignIn(unittest.TestCase):
    def test_the_session_cookie_covers_every_sport(self):
        cookies = call("https://nhl.gmgsports.org/auth/logout", signedIn=True)["cookies"]
        self.assertEqual(len(cookies), 2)
        self.assertNotIn("Domain=", cookies[0])  # the old one-address cookie, cleared
        self.assertTrue(cookies[1].startswith("gmg_session=;") and cookies[1].endswith("; Domain=gmgsports.org"))

    def test_the_login_still_guards_a_sport_address(self):
        self.assertEqual(call("https://nhl.gmgsports.org/", signedIn=True)["status"], 401)
        self.assertEqual(call("https://nhl.gmgsports.org/data.json", signedIn=True)["served"], [])
        # Public before sign-in: the sign-in screen's logo and the deploy check.
        self.assertEqual(call("https://nhl.gmgsports.org/brand/gmg-logo.png", signedIn=True)["served"], [["next", "/brand/gmg-logo.png"]])
        self.assertEqual(call("https://nba.gmgsports.org/version.json", signedIn=True)["served"], [["next", "/version.json"]])

    def test_other_addresses_keep_one_address_cookies(self):
        cookies = call("https://gmg-nfl.pages.dev/auth/logout", signedIn=True)["cookies"]
        self.assertEqual(len(cookies), 1)
        self.assertNotIn("Domain=", cookies[0])

    def test_discord_sign_in_runs_on_the_nfl_address_and_comes_back(self):
        r = call("https://nhl.gmgsports.org/auth/login?next=%2Fshots", signedIn=True)
        self.assertEqual(r["location"], "https://nfl.gmgsports.org/auth/login?next=" + "https%3A%2F%2Fnhl.gmgsports.org%2Fshots")
        r = call(r["location"], signedIn=True)
        self.assertTrue(r["location"].startswith("https://discord.com/oauth2/authorize"))
        self.assertIn("redirect_uri=https%3A%2F%2Fnfl.gmgsports.org%2Fauth%2Fcallback", r["location"])
        self.assertEqual(json.loads(unquote(r["cookies"][0].split(";")[0].split("=", 1)[1]))["next"], "https://nhl.gmgsports.org/shots")

    def test_sign_in_never_sends_people_to_another_site(self):
        for bad in ("//evil.example/x", "https://evil.example/", "https://gmgsports.org.evil.example/"):
            r = call(f"https://nfl.gmgsports.org/auth/login?next={bad}", signedIn=True)
            state = json.loads(unquote(r["cookies"][0].split(";")[0].split("=", 1)[1]))
            self.assertEqual(state["next"], "/", bad)


if __name__ == "__main__":
    unittest.main()
