"""Member Activity, the login side (nfl_tool/functions/_middleware.js, 2026-11-18): the owner's DAU
and MAU. Pinned: a member's profile request counts them once a day, however many pages they open;
the owner isn't counted; a counting failure never touches the member; /api/activity answers only
the owner, sends counts and never who, and MAU counts each member once over a rolling 30 days.
Loaded the same way as test_ci_hosting, with a small stand-in for D1. Named test_ci_* so it runs
with every test: the middleware is shared by all three sports."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
DEPLOY = ROOT / ".github" / "workflows" / "deploy.yml"
OWNER = "613105360286253076"

EXTRA = r"""
window.fakeDB = (seed = [], { failInsert = false } = {}) => {
  const rows = seed.map(([day, uid]) => ({ day, uid }));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (sql.startsWith("INSERT OR IGNORE INTO member_activity")) {
        if (failInsert) throw new Error("no such table");
        const [day, uid] = args;
        if (!rows.some((r) => r.day === day && r.uid === uid)) rows.push({ day, uid });
      }
      return {};
    },
    all: async () => {
      if (sql.startsWith("SELECT day, uid FROM member_activity")) return { results: rows.filter((r) => r.day >= args[0]) };
      return { results: [] };
    },
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
window.hit = async (path, uid, method = "GET") => {
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", DB: window.DB };
  const request = new Request(`https://nfl.gmgsports.org${path}`, { method, headers: { Cookie: await cookieFor(uid) } });
  request.json = async () => ({});
  const jobs = [];
  const res = await window.MW.onRequest({ request, env, next: async () => new Response("file"), waitUntil: (p) => jobs.push(p) });
  await Promise.all(jobs);
  return { status: res.status, body: String(res.body), rows: window.DB.rows.map((r) => [r.day, r.uid]) };
};
window.easternToday = () => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = (t) => p.find((x) => x.type === t).value;
  return `${v("year")}-${v("month")}-${v("day")}`;
};
window.daysAgo = (n) => new Date(Date.parse(`${easternToday()}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
true;
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
    PAGE.route("https://middleware.test/", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>middleware</title>"))
    PAGE.goto("https://middleware.test/")
    PAGE.evaluate(FAKES)
    PAGE.evaluate(EXTRA)
    src = base64.b64encode(MIDDLEWARE.read_bytes()).decode()
    PAGE.evaluate(f'async () => {{ window.MW = await import("data:text/javascript;base64,{src}"); }}')


def tearDownModule():
    BROWSER.close()
    PW.stop()


def hit(path, uid="123", method="GET"):
    return PAGE.evaluate("([p, u, m]) => hit(p, u, m)", [path, uid, method])


def seed(rows, **opts):
    """rows: [days ago, member]."""
    PAGE.evaluate("([rows, opts]) => { window.DB = fakeDB(rows.map(([n, u]) => [daysAgo(n), u]), opts); }", [rows, opts])


class Counting(unittest.TestCase):
    def setUp(self):
        seed([])

    def test_a_member_counts_once_a_day_however_many_pages_they_open(self):
        hit("/api/state", "111")
        hit("/api/state", "111")
        got = hit("/api/state", "222")
        self.assertEqual(sorted(u for _, u in got["rows"]), ["111", "222"])
        self.assertEqual(len({d for d, _ in got["rows"]}), 1)

    def test_only_the_profile_request_counts(self):
        self.assertEqual(hit("/game-overview.html")["rows"], [])
        self.assertEqual(hit("/style.css")["rows"], [])

    def test_the_owner_is_not_counted(self):
        self.assertEqual(hit("/api/state", OWNER)["rows"], [])

    def test_a_counting_failure_never_reaches_the_member(self):
        seed([], failInsert=True)
        got = hit("/api/state", "111")
        self.assertEqual(got["status"], 200)
        self.assertEqual(got["rows"], [])

    def test_the_deploy_creates_the_table(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS member_activity (day TEXT NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (day, uid))", DEPLOY.read_text(encoding="utf-8"))


class OwnerNumbers(unittest.TestCase):
    def activity(self):
        got = hit("/api/activity", OWNER)
        self.assertEqual(got["status"], 200)
        return json.loads(got["body"]), got["body"]

    def test_only_the_owner_gets_in(self):
        seed([[0, "111"]])
        got = hit("/api/activity", "111")
        self.assertEqual(got["status"], 403)
        self.assertNotIn("dau", got["body"])

    def test_it_sends_counts_and_never_who(self):
        seed([[0, "member-one"], [1, "member-two"]])
        _, body = self.activity()
        self.assertNotIn("member-one", body)
        self.assertNotIn("member-two", body)

    def test_dau_and_a_rolling_mau_count_each_member_once(self):
        seed([[0, "a"], [0, "b"], [1, "a"], [29, "c"], [30, "d"]])
        data, _ = self.activity()
        today, yesterday = data["days"][:2]
        self.assertEqual((today["dau"], today["mau"]), (2, 3))  # a, b, c; d is 30 days back, out of the window
        self.assertEqual((yesterday["dau"], yesterday["mau"]), (1, 3))  # a, c, d

    def test_a_quiet_day_shows_as_zero_and_days_before_counting_are_left_off(self):
        seed([[0, "a"], [3, "b"]])
        data, _ = self.activity()
        self.assertEqual([d["dau"] for d in data["days"]], [1, 0, 0, 1])
        self.assertEqual(data["first"], PAGE.evaluate("daysAgo(3)"))

    def test_it_lists_at_most_30_days(self):
        seed([[n, "a"] for n in range(45)])
        data, _ = self.activity()
        self.assertEqual(len(data["days"]), 30)
        self.assertEqual(data["days"][0]["day"], data["today"])

    def test_nothing_counted_yet(self):
        seed([])
        data, _ = self.activity()
        self.assertEqual((data["first"], data["days"]), (None, []))


if __name__ == "__main__":
    unittest.main()
