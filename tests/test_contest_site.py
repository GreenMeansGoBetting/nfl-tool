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
    page.add_init_script("try { localStorage.removeItem('nfl-tool.contest-draft.v1'); } catch (e) {}")  # each test starts with no draft

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
        page.locator("[data-act=format][data-three='0']").click()  # two games default to three picks a game
        page.on("dialog", lambda d: d.accept())
        page.locator("[data-act=open]").click()
        page.wait_for_function("() => true")
        sent = posts[0]["contest"]
        self.assertEqual(sent["id"], "2026_11")
        self.assertEqual(sent["title"], "$100 CONTEST")  # a normal week keeps the usual name
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
            page.locator("[data-act=format][data-three='0']").click()
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
            page.locator("[data-act=format][data-three='0']").click()
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
          const S = window.GMGContest.slotsOf(c);
          const p = (g, k) => S[g].list.find((x) => x.k === k);
          const G = window.GMGContest.gradePick;
          return [G(c, S[0], p(0, "MIA|De'Von Achane")), G(c, S[0], p(0, "BUF|James Cook")), G(c, S[1], p(1, "CIN|Ja'Marr Chase")), G(c, S[1], p(1, "WAS|Terry McLaurin"))];
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


# Three picks a game (2026-11-24, Thanksgiving week): the game's First TD scorer (either team) plus
# one anytime TD per team; the Wednesday game locks at its kickoff, Thursday / Friday together.
WED, THU = "2026_12_GB_LA", "2026_12_CHI_DET"
THREE = {
    "id": "2026_12", "season": 2026, "week": 12, "book": "FanDuel", "first_book": "Novig", "priced_at": 1795000000000,
    "games": [
        {"id": WED, "away": "GB", "home": "LA", "day": "Wednesday", "time": "20:00", "kickoff": "2099-11-26T01:00:00.000Z", "players": [
            {"k": "GB|Josh Jacobs", "name": "Josh Jacobs", "pos": "RB", "team": "GB", "odds": -120},
            {"k": "GB|Tucker Kraft", "name": "Tucker Kraft", "pos": "TE", "team": "GB", "odds": 250},
            {"k": "LA|Kyren Williams", "name": "Kyren Williams", "pos": "RB", "team": "LA", "odds": -150},
            {"k": "LA|Puka Nacua", "name": "Puka Nacua", "pos": "WR", "team": "LA", "odds": 110}],
         "first": [
            {"k": "GB|Josh Jacobs", "name": "Josh Jacobs", "pos": "RB", "team": "GB", "odds": 550},
            {"k": "LA|Kyren Williams", "name": "Kyren Williams", "pos": "RB", "team": "LA", "odds": 450},
            {"k": "LA|Puka Nacua", "name": "Puka Nacua", "pos": "WR", "team": "LA", "odds": 650}]},
        {"id": THU, "away": "CHI", "home": "DET", "day": "Thursday", "time": "13:00", "kickoff": "2099-11-26T18:00:00.000Z", "players": [
            {"k": "CHI|D'Andre Swift", "name": "D'Andre Swift", "pos": "RB", "team": "CHI", "odds": 120},
            {"k": "DET|Jahmyr Gibbs", "name": "Jahmyr Gibbs", "pos": "RB", "team": "DET", "odds": -200}],
         "first": [
            {"k": "CHI|D'Andre Swift", "name": "D'Andre Swift", "pos": "RB", "team": "CHI", "odds": 800},
            {"k": "DET|Jahmyr Gibbs", "name": "Jahmyr Gibbs", "pos": "RB", "team": "DET", "odds": 350}]},
    ],
}


def three(wed_lock, thu_lock):
    c = json.loads(json.dumps(THREE))
    c["games"][0]["lock_at"], c["games"][1]["lock_at"] = wed_lock, thu_lock
    c["lock_at"] = max(wed_lock, thu_lock)
    return c


WEEK12 = {
    "season": 2026, "current_week": 12,
    "schedule": [
        {"game_id": "2026_12_GB_LA", "week": 12, "date": "2099-11-25", "time": "20:00", "away": "GB", "home": "LA"},
        {"game_id": "2026_12_CHI_DET", "week": 12, "date": "2099-11-26", "time": "13:00", "away": "CHI", "home": "DET"},
        {"game_id": "2026_12_DEN_PIT", "week": 12, "date": "2099-11-27", "time": "15:00", "away": "DEN", "home": "PIT"},
        {"game_id": "2026_12_SF_SEA", "week": 12, "date": "2099-11-29", "time": "13:00", "away": "SF", "home": "SEA"},
    ],
    "player_td_odds": {t: [{"name": f"{t} Back", "position": "RB", "best_odds": 100, "fd": 110}] for t in ("GB", "LA", "CHI", "DET", "DEN", "PIT", "SF", "SEA")},
    # SmartStake's First TD market: FanDuel's Yes as "o" (Novig's First TD in player_first_td_odds is never used).
    "book_odds": {f"{a}_{h}": {"props": {"first_td": {
        f"{t.lower()}back": {"name": f"{t} Back", "q": [["draftkings", "o", None, 650, ""], ["fanduel", "o", None, 700, ""]]} for t in (a, h)}}}
        for a, h in (("GB", "LA"), ("CHI", "DET"), ("DEN", "PIT"), ("SF", "SEA"))},
    "player_first_td_odds": {t: [{"name": f"{t} Back", "position": "RB", "best_odds": 600}] for t in ("GB", "LA", "CHI", "DET", "DEN", "PIT", "SF", "SEA")},
}


class ThreePicks(unittest.TestCase):
    def setUp(self):
        SITE.errors.clear()
        SITE.user = None

    def tearDown(self):
        self.assertEqual(SITE.errors, [])

    def test_three_picks_a_game_first_td_from_either_team_then_one_per_team(self):
        page, posts = open_page({"contest": three(LATER, LATER)})
        self.assertIn("Pick 6 More", page.locator(".ct-go").inner_text())
        # The First TD pick opens first, with both teams' First TD prices.
        self.assertEqual(page.locator(".ct-drop .ct-team").count(), 2)
        self.assertIn("+450", page.locator(".ct-p", has_text="Kyren Williams").inner_text())
        page.locator(".ct-p", has_text="Kyren Williams").click()
        self.assertEqual(page.locator(".ct-drop .ct-team").count(), 1)  # then GB's anytime list alone
        page.locator(".ct-p", has_text="Josh Jacobs").click()
        page.locator(".ct-p", has_text="Kyren Williams").click()  # the same player again is fine
        page.locator(".ct-p", has_text="Jahmyr Gibbs").click()
        page.locator(".ct-p", has_text="D'Andre Swift").click()
        page.locator(".ct-p", has_text="Jahmyr Gibbs").click()
        self.assertEqual(page.locator(".ct-go").inner_text(), "Submit Entry")
        self.assertIn("6 of 6", page.locator(".ct-strip").inner_text())
        page.locator(".ct-go").click()
        page.wait_for_function("() => true")
        self.assertEqual(posts[0]["picks"], {
            f"{WED}:F": "LA|Kyren Williams", f"{WED}:A": "GB|Josh Jacobs", f"{WED}:H": "LA|Kyren Williams",
            f"{THU}:F": "DET|Jahmyr Gibbs", f"{THU}:A": "CHI|D'Andre Swift", f"{THU}:H": "DET|Jahmyr Gibbs"})
        page.close()

    def test_a_late_entry_skips_the_locked_game_and_is_told_it_costs_30(self):
        page, posts = open_page({"contest": three(EARLIER, LATER)})
        wed = page.locator(".ct-row").nth(0)
        self.assertIn("Locked", wed.inner_text())
        self.assertEqual(wed.locator(".ct-pickbtn", has_text="No Pick").count(), 3)
        self.assertIn("Pick 3 More", page.locator(".ct-go").inner_text())
        self.assertIn("Count As Losses", page.locator(".ct-submit").inner_text())
        self.assertIn("$30", page.locator(".ct-submit").inner_text())
        for name in ("Jahmyr Gibbs", "D'Andre Swift", "Jahmyr Gibbs"):
            page.locator(".ct-p", has_text=name).click()
        page.locator(".ct-go").click()
        page.wait_for_function("() => true")
        self.assertEqual(sorted(posts[0]["picks"]), [f"{THU}:A", f"{THU}:F", f"{THU}:H"])
        page.close()

    def test_first_td_grades_from_espn_and_a_missed_pick_loses_10(self):
        live = {"fetched": 1, "games": {WED: {"state": "post", "final": True, "detail": "Final", "first": {"team": "LA", "name": "Kyren Williams"}, "teams": {
            "LA": {"tds": {"Kyren Williams": 1, "Puka Nacua": 1}, "played": ["Kyren Williams", "Puka Nacua"]},
            "GB": {"tds": {}, "played": ["Josh Jacobs"]}}}}}
        a = {"name": "Early", "updated": 1, "picks": {f"{WED}:F": "LA|Kyren Williams", f"{WED}:A": "GB|Josh Jacobs", f"{WED}:H": "LA|Puka Nacua",
                                                      f"{THU}:F": "DET|Jahmyr Gibbs", f"{THU}:A": "CHI|D'Andre Swift", f"{THU}:H": "DET|Jahmyr Gibbs"}}
        b = {"name": "Stacker", "updated": 2, "picks": {f"{WED}:F": "LA|Puka Nacua", f"{WED}:A": "GB|Tucker Kraft", f"{WED}:H": "LA|Kyren Williams",
                                                        f"{THU}:F": "DET|Jahmyr Gibbs", f"{THU}:A": "CHI|D'Andre Swift", f"{THU}:H": "DET|Jahmyr Gibbs"}}
        late = {"name": "Late", "updated": 3, "picks": {f"{THU}:F": "DET|Jahmyr Gibbs", f"{THU}:A": "CHI|D'Andre Swift", f"{THU}:H": "DET|Jahmyr Gibbs"}}
        data = {**DATA, "current_week": 12, "player_td_results": {}, "player_snaps": {}}
        page, _ = open_page({"contest": three(EARLIER, EARLIER), "locked": True, "entries": [late, b, a], "live": live, "marks": {}}, data=data)
        page.locator("[data-tab=board]").click()
        rows = page.locator(".ct-lbrow")
        self.assertEqual([rows.nth(i).locator(".ct-name").inner_text() for i in range(3)], ["Early", "Stacker", "Late"])
        self.assertIn("$106", rows.nth(0).inner_text())  # $60 + $45 (Kyren first, +450) - $10 (Jacobs) + $11 (Puka)
        self.assertIn("$56.67", rows.nth(1).inner_text())  # - $10 (Puka not first), Kraft not in the box: back, + $6.67
        self.assertIn("$30", rows.nth(2).inner_text())  # three missed Wednesday picks
        page.locator("[data-tab=track]").click()
        track = page.locator(".ct-track").inner_text()
        self.assertIn("1st TD: Kyren Williams", track)
        self.assertIn("Scored First", track)
        self.assertIn("Not First", track)
        page.close()

    def test_owner_preview_three_a_game_wed_alone_then_thu_fri_together(self):
        page, posts = open_page({"contest": None}, owner=True, data=WEEK12)
        page.wait_for_selector(".ct-row")
        self.assertEqual(page.locator(".ct-row").count(), 3)  # Sunday left out by default
        self.assertEqual(page.locator(".ct-chip.on[data-act=game]").count(), 3)
        self.assertEqual(page.locator(".ct-chip.on[data-act=format]").inner_text(), "Three A Game: First TD + One Per Team")
        page.on("dialog", lambda d: d.accept())
        page.locator("[data-act=open]").click()
        page.wait_for_function("() => true")
        sent = posts[0]["contest"]
        wed = page.evaluate("() => window.GMGContest.easternToUtc('2099-11-25', '20:00')")
        thu = page.evaluate("() => window.GMGContest.easternToUtc('2099-11-26', '13:00')")
        self.assertEqual([g["lock_at"] for g in sent["games"]], [wed, thu, thu])
        self.assertEqual(sent["lock_at"], thu)
        self.assertEqual(sent["title"], "$100 Thanksgiving Contest")  # Thanksgiving week's own name
        self.assertEqual(page.locator(".ct-title").inner_text(), "$100 Thanksgiving Contest")
        self.assertEqual(sent["first_book"], "FanDuel")
        self.assertEqual(sent["games"][0]["first"][0]["odds"], 700)  # FanDuel's, not DraftKings' or Novig's
        self.assertEqual(sent["games"][0]["players"][0]["odds"], 110)  # anytime: FanDuel
        page.close()

    def test_no_fanduel_first_td_for_a_game_refuses_the_lock(self):
        # 2026-11-24: SmartStake had DraftKings' First TD but not FanDuel's yet. The owner: FanDuel only.
        data = json.loads(json.dumps(WEEK12))
        for row in data["book_odds"]["CHI_DET"]["props"]["first_td"].values():
            row["q"] = [q for q in row["q"] if q[0] != "fanduel"]
        page, posts = open_page({"contest": None}, owner=True, data=data)
        page.wait_for_selector(".ct-row")
        said = []
        page.on("dialog", lambda d: (said.append(d.message), d.accept()))
        page.locator("[data-act=open]").click()
        page.wait_for_function("() => true")
        self.assertEqual(posts, [])
        self.assertIn("CHI @ DET (First TD)", said[0])
        page.close()


if __name__ == "__main__":
    unittest.main()
