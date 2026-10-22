"""New Stripe signups are closed (2026-10-22): the owner is moving memberships
to Buildr, so nobody new may start an email trial, while existing email
members keep signing in (login code: nfl_tool/functions/_middleware.js,
STRIPE_JOIN_OPEN).

Pinned with the live Stripe key in place: the sign-in page shows no trial
form or plan buttons, and a checkout sent straight to /stripe/checkout never
reaches Stripe. Loaded the same way as test_ci_hosting. Named test_ci_* so it
runs with every test."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"

EXTRA = r"""
window.stripeCalls = [];
window.fetch = async (url) => { window.stripeCalls.push(String(url)); throw new Error("no network in tests"); };
window.join = async (path, method = "GET") => {
  const env = { DISCORD_CLIENT_SECRET: "x", DISCORD_BOT_TOKEN: "x", STRIPE_SECRET_KEY: "sk_live_x", DB: {} };
  const res = await window.MW.onRequest({ request: new Request(`https://nfl.gmgsports.org${path}`, { method }), env, next: async () => new Response("file") });
  return { status: res.status, body: String(res.body), stripe: window.stripeCalls };
};
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


def join(path, method="GET"):
    return PAGE.evaluate(f"() => join({json.dumps(path)}, {json.dumps(method)})")


class StripeJoinClosed(unittest.TestCase):
    def test_sign_in_page_has_no_trial_form(self):
        for path in ("/join", "/"):
            body = join(path)["body"]
            self.assertNotIn("/stripe/checkout", body, path)
            self.assertNotIn("Start free trial", body, path)
            self.assertIn("Log in with Discord", body, path)
            self.assertIn("Already joined with email?", body, path)  # existing members still sign in

    def test_a_checkout_never_reaches_stripe(self):
        got = join("/stripe/checkout", "POST")
        self.assertNotIn("Start free trial", got["body"])
        self.assertEqual([u for u in got["stripe"] if "stripe.com" in u], [])


if __name__ == "__main__":
    unittest.main()
