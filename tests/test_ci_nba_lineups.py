"""/api/nba-lineups in the login middleware (nfl_tool/functions/_middleware.js),
added 2026-10-20: the NBA's daily lineup file, read live for First Basket.

Pinned: members only; a bad date is refused; the NBA's games pass through with
the time they were read; when the NBA turns the request away the page gets a
502 (and falls back), never a broken answer. The NBA is stood in for with a
fake fetch. Loaded like test_ci_crease_payouts; named test_ci_* so it runs with
every test."""
import base64
import json
import unittest

from helpers import ROOT  # first: puts tools/ on the import path

from check_site import INSTALL_HELP
from test_ci_crease_payouts import EXTRA
from test_ci_hosting import FAKES

MIDDLEWARE = ROOT / "nfl_tool" / "functions" / "_middleware.js"
URL = "https://nba.gmgsports.org/api/nba-lineups?date=20261020"
GAMES = [{"gameId": "0022600003", "homeTeam": {"teamAbbreviation": "SAS", "players": []}, "awayTeam": {"teamAbbreviation": "OKC", "players": []}}]

# The NBA as a fake fetch: answers with window.nbaReply and keeps what was asked.
FAKE_NBA = r"""
window.nbaAsked = [];
window.fetch = async (url) => {
  window.nbaAsked.push(String(url));
  const r = window.nbaReply;
  return { ok: r.status === 200, status: r.status, json: async () => r.body };
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
    PAGE.evaluate(FAKE_NBA)
    src = base64.b64encode(MIDDLEWARE.read_bytes()).decode()
    PAGE.evaluate(f'async () => {{ window.MW = await import("data:text/javascript;base64,{src}"); }}')


def tearDownModule():
    BROWSER.close()
    PW.stop()


def api(url=URL, reply=None, **opts):
    PAGE.evaluate("(r) => { window.nbaAsked = []; window.nbaReply = r; }", reply or {"status": 200, "body": {"games": GAMES}})
    return PAGE.evaluate(f"() => api({json.dumps(url)}, {json.dumps(opts)})")


class NbaLineups(unittest.TestCase):
    def test_members_only(self):
        self.assertEqual(api()["status"], 401)
        self.assertEqual(PAGE.evaluate("() => window.nbaAsked"), [])

    def test_passes_the_nbas_games_through(self):
        got = api(uid="123")
        self.assertEqual(got["status"], 200)
        self.assertEqual(got["body"]["games"], GAMES)
        self.assertTrue(got["body"]["fetched"].startswith("20"))
        self.assertEqual(PAGE.evaluate("() => window.nbaAsked"), ["https://stats.nba.com/js/data/leaders/00_daily_lineups_20261020.json"])

    def test_a_bad_date_is_refused(self):
        self.assertEqual(api(URL.replace("20261020", "2026-10-20"), uid="123")["status"], 400)
        self.assertEqual(PAGE.evaluate("() => window.nbaAsked"), [])

    def test_when_the_nba_says_no_the_page_gets_a_502(self):
        got = api(uid="123", reply={"status": 403, "body": None})
        self.assertEqual((got["status"], got["body"]), (502, {"error": "nba", "status": 403}))


if __name__ == "__main__":
    unittest.main()
