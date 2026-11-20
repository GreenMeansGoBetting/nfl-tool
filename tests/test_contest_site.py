"""$100 CONTEST, the page (nfl_tool/site/contest.html + contest.js, 2026-11-20). Pinned: a member
picks one player a game and the entry is sent whole; the owner's preview builds the contest from
FanDuel's prices in data.json (started games left out) and "Lock" sends them; after the lock the
picks grade from data.json (a TD = hit, no snaps = the $10 back, else lost) and the leaderboard
ranks by bankroll, ties to fewer correct picks, then the longest price that hit."""
import json
import unittest

from site_browser import SiteBrowser


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    SITE.close()


LATER = 4102444800000  # 2100: never locked
EARLIER = 1000  # 1970: long locked

CONTEST = {
    "id": "2026_11", "season": 2026, "week": 11, "book": "FanDuel", "priced_at": 1795000000000,
    "games": [
        {"id": "2026_11_MIA_BUF", "away": "MIA", "home": "BUF", "day": "Sunday", "time": "13:00", "players": [
            {"k": "BUF|James Cook", "name": "James Cook", "pos": "RB", "team": "BUF", "odds": -150},
            {"k": "MIA|De'Von Achane", "name": "De'Von Achane", "pos": "RB", "team": "MIA", "odds": 130}]},
        {"id": "2026_11_CIN_WAS", "away": "CIN", "home": "WAS", "day": "Monday", "time": "20:15", "players": [
            {"k": "CIN|Ja'Marr Chase", "name": "Ja'Marr Chase", "pos": "WR", "team": "CIN", "odds": 140},
            {"k": "WAS|Terry McLaurin", "name": "Terry McLaurin", "pos": "WR", "team": "WAS", "odds": 210}]},
    ],
}

# Week 11 results: Achane scored; Chase didn't play (no snaps); Cook and McLaurin played, no TD.
DATA = {
    "season": 2026, "current_week": 11,
    "schedule": [
        {"game_id": "2026_11_IND_HOU", "week": 11, "date": "2026-11-19", "weekday": "Thursday", "time": "20:15", "away": "IND", "home": "HOU", "status": "final"},
        {"game_id": "2026_11_MIA_BUF", "week": 11, "date": "2099-11-22", "weekday": "Sunday", "time": "13:00", "away": "MIA", "home": "BUF"},
        {"game_id": "2026_11_CIN_WAS", "week": 11, "date": "2099-11-23", "weekday": "Monday", "time": "20:15", "away": "CIN", "home": "WAS"},
    ],
    "player_td_odds": {
        "BUF": [{"name": "James Cook", "position": "RB", "best_odds": -140, "fd": -150}, {"name": "Novig Only", "position": "WR", "best_odds": 400, "fd": None}],
        "MIA": [{"name": "De'Von Achane", "position": "RB", "best_odds": 140, "fd": 130}],
        "CIN": [{"name": "Ja'Marr Chase", "position": "WR", "best_odds": 150, "fd": 140}],
        "WAS": [{"name": "Terry McLaurin", "position": "WR", "best_odds": 220, "fd": 210}],
        "IND": [{"name": "Jonathan Taylor", "position": "RB", "best_odds": -200, "fd": -200}],
    },
    "player_td_results": {"11": {"MIA": {"any_td": ["De'Von Achane"], "first_td": []}}},
    "player_snaps": {
        "MIA": {"De'Von Achane": {"pos": "RB", "w": {"11": 0.7}}},
        "BUF": {"James Cook": {"pos": "RB", "w": {"11": 0.6}}},
        "CIN": {"Ja'Marr Chase": {"pos": "WR", "w": {"10": 0.9}}, "Joe Burrow": {"pos": "QB", "w": {"11": 1.0}}},
        "WAS": {"Terry McLaurin": {"pos": "WR", "w": {"11": 0.8}}},
    },
}


def open_page(api, owner=False):
    posts = []
    page = SITE.context.new_page()
    page.on("pageerror", lambda err: SITE.errors.append(str(err)))

    def handle(route):
        if route.request.method == "POST":
            posts.append(json.loads(route.request.post_data))
            route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"owner": owner, "defaults": {"name": "Wiz", "contact": "Wiz"}, "entries": [], "me": None, **api}))

    page.route("**/api/contest", handle)
    page.route("**/data.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(DATA)))
    page.goto(f"{SITE.origin}/contest.html")
    page.wait_for_selector(".ct-title")
    page.wait_for_function("() => !document.querySelector('#ct-app').textContent.includes('Loading')")
    return page, posts


class Page(unittest.TestCase):
    def setUp(self):
        SITE.errors.clear()
        SITE.user = None

    def tearDown(self):
        self.assertEqual(SITE.errors, [])

    def test_a_member_picks_every_game_and_submits(self):
        page, posts = open_page({"contest": {**CONTEST, "lock_at": LATER}})
        self.assertEqual(page.locator(".ct-row").count(), 2)
        self.assertIn("Pick 2 More", page.locator(".ct-go").inner_text())
        page.locator(".ct-p", has_text="De'Von Achane").click()  # first game opens on its own
        page.locator(".ct-p", has_text="Terry McLaurin").click()  # then the next unpicked one
        self.assertEqual(page.locator(".ct-go").inner_text(), "Submit Entry")
        page.locator(".ct-go").click()
        page.wait_for_function("() => true")
        self.assertEqual(posts[0]["action"], "enter")
        self.assertEqual(posts[0]["picks"], {"2026_11_MIA_BUF": "MIA|De'Von Achane", "2026_11_CIN_WAS": "WAS|Terry McLaurin"})
        self.assertEqual((posts[0]["name"], posts[0]["contact"]), ("Wiz", "Wiz"))
        page.close()

    def test_nothing_to_pick_until_the_owner_opens_it(self):
        page, _ = open_page({"contest": None})
        self.assertIn("opens soon", page.locator("#ct-app").inner_text())
        self.assertEqual(page.locator(".ct-row").count(), 0)
        page.close()

    def test_owner_preview_uses_fanduel_prices_and_lock_sends_them(self):
        page, posts = open_page({"contest": None}, owner=True)
        page.wait_for_selector(".ct-row")
        self.assertEqual(page.locator(".ct-row").count(), 2)  # the finished Thursday game left out
        page.on("dialog", lambda d: d.accept())
        page.locator("[data-act=open]").click()
        page.wait_for_function("() => true")
        sent = posts[0]["contest"]
        self.assertEqual(sent["id"], "2026_11")
        buf = [p for p in sent["games"][0]["players"] if p["team"] == "BUF"]
        self.assertEqual([(p["name"], p["odds"]) for p in buf], [("James Cook", -150)])  # no FanDuel price, not listed
        # Sunday 1:00 PM Eastern on the Sunday game's date (EST: 18:00 UTC).
        self.assertEqual(sent["lock_at"], 4099053600000)
        page.close()

    def test_after_the_lock_picks_grade_and_rank(self):
        a = {"name": "Achane Fan", "updated": 1, "picks": {"2026_11_MIA_BUF": "MIA|De'Von Achane", "2026_11_CIN_WAS": "CIN|Ja'Marr Chase"}}
        b = {"name": "Cook Fan", "updated": 2, "picks": {"2026_11_MIA_BUF": "BUF|James Cook", "2026_11_CIN_WAS": "WAS|Terry McLaurin"}}
        page, _ = open_page({"contest": {**CONTEST, "lock_at": EARLIER}, "locked": True, "entries": [b, a]})
        page.locator("[data-tab=board]").click()
        rows = page.locator(".ct-lbrow")
        self.assertEqual(rows.nth(0).locator(".ct-name").inner_text(), "Achane Fan")
        # $20 + $13 (Achane +130 hit), Chase didn't play: $10 back.
        self.assertIn("$33", rows.nth(0).inner_text())
        self.assertIn("$0", rows.nth(1).inner_text())  # two misses
        rows.nth(0).click()
        tiles = page.locator(".ct-pk")
        self.assertIn("hit", tiles.nth(0).get_attribute("class"))
        self.assertIn("void", tiles.nth(1).get_attribute("class"))
        page.close()

    def test_ties_go_to_fewer_correct_picks_then_the_longest_hit(self):
        page, _ = open_page({"contest": {**CONTEST, "lock_at": LATER}})
        order = page.evaluate("""() => {
          const e = (name, bank, hits, odds) => ({ name, bank, hits, longest: odds ? { odds } : null });
          const list = [e("Two Hits", 50, 2, 300), e("One Hit", 50, 1, 300), e("One Hit Longer", 50, 1, 500), e("Top", 60, 3, 100)];
          return list.sort(window.GMGContest.compareEntries).map((x) => x.name);
        }""")
        self.assertEqual(order, ["Top", "One Hit Longer", "One Hit", "Two Hits"])
        page.close()


if __name__ == "__main__":
    unittest.main()
