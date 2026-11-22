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


def open_page(api, owner=False, data=None):
    data = DATA if data is None else data  # read at call time: some tests swap DATA
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
    page.route("**/data.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(data)))
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

    def test_lock_refused_on_the_page_when_a_game_has_no_fanduel_prices(self):
        # 2026-11-21: the build had no FanDuel TD prices and the server answered "bad contest".
        global DATA
        saved = DATA
        DATA = json.loads(json.dumps(saved))
        DATA["player_td_odds"]["CIN"][0]["fd"] = None
        DATA["player_td_odds"]["WAS"][0]["fd"] = None
        try:
            page, posts = open_page({"contest": None}, owner=True)
            page.wait_for_selector(".ct-row")
            said = []
            page.on("dialog", lambda d: (said.append(d.message), d.accept()))
            page.locator("[data-act=open]").click()
            page.wait_for_function("() => true")
            self.assertEqual(posts, [])
            self.assertIn("CIN @ WAS", said[0])
            page.close()
        finally:
            DATA = saved

    def test_a_flexed_game_takes_the_books_kickoff(self):
        # 2026-11-21: PIT @ PHI flexed to 1:00, JAX @ NYG to 4:25; the schedule still had the old times.
        global DATA
        saved = DATA
        DATA = json.loads(json.dumps(saved))
        DATA["book_odds"] = {"CIN_WAS": {"kickoff": "2099-11-22T21:25:00Z"}}  # moved to Sunday 4:25 PM ET
        try:
            page, posts = open_page({"contest": None}, owner=True)
            page.wait_for_selector(".ct-row")
            slots = page.locator(".ct-slot").all_inner_texts()
            self.assertEqual(slots, ["Sunday 1:00 PM ET", "Sunday 4:25 PM ET"])
            page.on("dialog", lambda d: d.accept())
            page.locator("[data-act=open]").click()
            page.wait_for_function("() => true")
            moved = posts[0]["contest"]["games"][1]
            self.assertEqual((moved["id"], moved["day"], moved["time"]), ("2026_11_CIN_WAS", "Sunday", "16:25"))
            page.close()
        finally:
            DATA = saved

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

    def test_live_feed_grades_before_the_morning_and_tracking_lists_every_pick(self):
        # Sunday afternoon: data.json has nothing for MIA @ BUF yet (no snaps, no TDs).
        a = {"name": "Achane Fan", "updated": 1, "picks": {"2026_11_MIA_BUF": "MIA|De'Von Achane", "2026_11_CIN_WAS": "CIN|Ja'Marr Chase"}}
        b = {"name": "Cook Fan", "updated": 2, "picks": {"2026_11_MIA_BUF": "BUF|James Cook", "2026_11_CIN_WAS": "CIN|Ja'Marr Chase"}}
        live = {"fetched": 1795000000000, "games": {
            "2026_11_MIA_BUF": {"state": "in", "detail": "5:32 - 2nd", "teams": {
                "MIA": {"tds": {"De'Von Achane": 1}, "played": ["De'Von Achane"]},
                "BUF": {"tds": {}, "played": ["James Cook"]}}},
            "2026_11_CIN_WAS": {"state": "pre", "detail": "", "teams": None}}}
        data = {**DATA, "player_td_results": {}, "player_snaps": {}}
        page, posts = open_page({"contest": {**CONTEST, "lock_at": EARLIER}, "locked": True, "entries": [b, a], "live": live, "marks": {}}, owner=True, data=data)
        page.locator("[data-tab=board]").click()
        rows = page.locator(".ct-lbrow")
        self.assertEqual(rows.nth(0).locator(".ct-name").inner_text(), "Achane Fan")
        self.assertIn("$33", rows.nth(0).inner_text())  # $20 + $13: the TD counts now
        self.assertIn("$20", rows.nth(1).inner_text())  # Cook: no TD yet, nothing lost while it's on
        page.locator("[data-tab=track]").click()
        res = page.locator(".ct-track .ct-res")
        self.assertEqual(res.count(), 3)  # Achane, Cook, Chase (picked twice: one row)
        text = page.locator(".ct-track").inner_text()
        self.assertIn("5:32 - 2nd", text)
        self.assertIn("No TD Yet", res.nth(0).inner_text())  # Cook (one pick each: shorter price first)
        self.assertIn("Scored", res.nth(1).inner_text())  # Achane
        self.assertIn("Not Started", res.nth(2).inner_text())
        # The owner's hand result goes to the server and beats the feed.
        page.locator(".ct-marks [data-r=hit]").nth(2).click()
        page.wait_for_function("() => true")
        self.assertEqual(posts[-1], {"action": "mark", "g": "2026_11_CIN_WAS", "k": "CIN|Ja'Marr Chase", "result": "hit"})
        page.close()

    def test_live_final_no_td_is_a_miss_and_missing_from_the_box_score_is_money_back(self):
        live = {"fetched": 1, "games": {"2026_11_MIA_BUF": {"state": "post", "final": True, "detail": "Final", "teams": {
            "MIA": {"tds": {}, "played": ["De'Von Achane"]}, "BUF": {"tds": {"J. Cook": 1}, "played": ["J. Cook"]}}}}}
        page, _ = open_page({"contest": {**CONTEST, "lock_at": EARLIER}, "locked": True, "live": live, "marks": {"2026_11_CIN_WAS": {"CIN|Ja'Marr Chase": "hit"}}}, data={**DATA, "player_td_results": {}, "player_snaps": {}})
        got = page.evaluate("""() => {
          const c = """ + json.dumps({**CONTEST, "week": 11}) + """;
          const p = (g, k) => c.games[g].players.find((x) => x.k === k);
          const G = window.GMGContest.gradePick;
          return [G(c, c.games[0], p(0, "MIA|De'Von Achane")), G(c, c.games[0], p(0, "BUF|James Cook")), G(c, c.games[1], p(1, "CIN|Ja'Marr Chase")), G(c, c.games[1], p(1, "WAS|Terry McLaurin"))];
        }""")
        # Final with no TD = miss; "J. Cook" on his team = James Cook; the owner's mark wins; not started = pending.
        self.assertEqual(got, ["miss", "hit", "hit", "pending"])
        page.close()

    def test_nflverse_never_replaces_espn_the_owner_gets_the_differences(self):
        # ESPN's final: McLaurin scored, Chase not in the box score (money back). The morning's
        # nflverse: no TD for McLaurin (he played), Chase didn't play. Achane / Cook agree (game 1).
        entries = [{"name": "A", "updated": 1, "picks": {"2026_11_MIA_BUF": "MIA|De'Von Achane", "2026_11_CIN_WAS": "WAS|Terry McLaurin"}},
                   {"name": "B", "updated": 2, "picks": {"2026_11_MIA_BUF": "BUF|James Cook", "2026_11_CIN_WAS": "CIN|Ja'Marr Chase"}}]
        live = {"fetched": 1, "games": {
            "2026_11_MIA_BUF": {"state": "post", "final": True, "detail": "Final", "teams": {"MIA": {"tds": {"De'Von Achane": 1}, "played": ["De'Von Achane"]}, "BUF": {"tds": {}, "played": ["James Cook"]}}},
            "2026_11_CIN_WAS": {"state": "post", "final": True, "detail": "Final", "teams": {"WAS": {"tds": {"Terry McLaurin": 1}, "played": ["Terry McLaurin"]}, "CIN": {"tds": {}, "played": []}}}}}
        api = {"contest": {**CONTEST, "lock_at": EARLIER}, "locked": True, "entries": entries, "live": live, "marks": {}}
        page, posts = open_page(api, owner=True)
        page.locator("[data-tab=board]").click()
        self.assertIn("$54", page.locator(".ct-lbrow").nth(0).inner_text())  # A: $20 + $13 + $21 (ESPN stands)
        rows = page.locator(".ct-diff-row")
        self.assertEqual(rows.count(), 1)  # McLaurin; Chase agrees (didn't play both ways)
        self.assertIn("Terry McLaurin", rows.nth(0).inner_text())
        self.assertIn("Scored", rows.nth(0).locator(".ct-res").nth(0).inner_text())
        self.assertIn("No TD", rows.nth(0).locator(".ct-res").nth(1).inner_text())
        page.locator(".ct-diff-row button", has_text="Use nflverse").click()
        page.wait_for_function("() => true")
        self.assertEqual(posts[-1], {"action": "mark", "g": "2026_11_CIN_WAS", "k": "WAS|Terry McLaurin", "result": "miss"})
        page.close()
        # A member: the same Tracking tab, no differences list, no buttons.
        member, _ = open_page(api)
        self.assertEqual(member.locator(".ct-diff").count(), 0)
        member.locator("[data-tab=track]").click()
        self.assertEqual(member.locator(".ct-track .ct-res").count(), 4)
        self.assertEqual(member.locator(".ct-marks").count(), 0)
        member.close()

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
