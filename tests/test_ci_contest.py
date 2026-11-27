"""$100 CONTEST: /api/contest in the login middleware (nfl_tool/functions/_middleware.js),
added 2026-11-20. Pinned: only the owner opens a contest (locks the prices), a member saves one
entry per account (a second save replaces it), every game needs a real pick, nothing changes after
the lock, picks stay hidden from other members until the lock, and the contact is only ever sent
to the owner. Loaded like test_ci_crease_payouts (a blank page in the test browser), with a small
stand-in for the two D1 tables."""
import json
import time
import unittest

from helpers import ROOT  # noqa: F401  first: puts tools/ on the import path

import test_ci_crease_payouts as base

OWNER = base.OWNER
URL = "https://nfl.gmgsports.org/api/contest"

# A stand-in for D1 that knows the contest's statements.
CONTEST_DB = r"""
window.contestDB = () => {
  const contests = new Map();
  const entries = new Map(); // "contest|uid" -> row
  const live = new Map(); // "contest|kind" -> row (the live feed and the owner's marks)
  const stmt = (sql, a = []) => ({
    bind: (...args) => stmt(sql, args),
    run: async () => {
      if (sql.startsWith("INSERT INTO contest_live")) live.set(`${a[0]}|${a[1]}`, { contest: a[0], kind: a[1], data: a[2], updated: a[3] });
      else if (sql.startsWith("INSERT INTO contests")) contests.set(a[0], { id: a[0], config: a[1], created: a[2] });
      else if (sql.startsWith("INSERT INTO contest_entries")) entries.set(`${a[0]}|${a[1]}`, { contest: a[0], uid: a[1], name: a[2], contact: a[3], picks: a[4], updated: a[5] });
      else if (sql.startsWith("DELETE FROM contest_entries WHERE contest = ? AND uid = ?")) entries.delete(`${a[0]}|${a[1]}`);
      else if (sql.startsWith("DELETE FROM contest_entries")) for (const k of [...entries.keys()]) if (k.startsWith(`${a[0]}|`)) entries.delete(k);
      return {};
    },
    first: async () => (sql.includes("FROM contest_entries") ? entries.get(`${a[0]}|${a[1]}`) || null : [...contests.values()].sort((x, y) => y.created - x.created)[0] || null),
    all: async () => ({ results: sql.includes("FROM contest_live") ? [...live.values()].filter((r) => r.contest === a[0]) : [...entries.values()].filter((r) => r.contest === a[0]).sort((x, y) => x.updated - y.updated) }),
  });
  return { prepare: (sql) => stmt(sql), live };
};
// ESPN stood in for: MIA @ BUF on (Achane has a rushing TD, Cook played, Allen threw one: a
// passing TD doesn't count), CIN @ WSH not started (ESPN's WSH = nflverse's WAS).
window.espnCalls = [];
window.espnState = "in";
window.fetch = async (url) => {
  espnCalls.push(url);
  const ok = (body) => ({ ok: true, json: async () => body });
  const team = (abbr, side) => ({ homeAway: side, team: { abbreviation: abbr } });
  if (url.includes("/scoreboard")) return ok({ events: [
    { id: "101", status: { type: { state: espnState, shortDetail: espnState === "post" ? "Final" : "5:32 - 2nd" } }, competitions: [{ competitors: [team("BUF", "home"), team("MIA", "away")] }] },
    { id: "102", status: { type: { state: "pre", shortDetail: "11/23 - 8:15 PM EST" } }, competitions: [{ competitors: [team("WSH", "home"), team("CIN", "away")] }] },
  ] });
  // Scoring plays out of order on purpose: a BUF field goal first, then Achane's TD, then a BUF TD.
  if (url.includes("event=101")) return ok({ scoringPlays: [
    { type: { abbreviation: "TD", text: "Passing Touchdown" }, text: "Dalton Kincaid 8 Yd pass from Josh Allen (Tyler Bass Kick)", team: { abbreviation: "BUF" }, period: { number: 2 }, clock: { value: 400 } },
    { type: { abbreviation: "FG", text: "Field Goal" }, text: "Tyler Bass 40 Yd Field Goal", team: { abbreviation: "BUF" }, period: { number: 1 }, clock: { value: 600 } },
    { type: { abbreviation: "TD", text: "Rushing Touchdown" }, text: "De'Von Achane 5 Yd Run (Jason Sanders Kick)", team: { abbreviation: "MIA" }, period: { number: 1 }, clock: { value: 120 } },
  ], boxscore: { players: [
    { team: { abbreviation: "MIA" }, statistics: [{ name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"], athletes: [{ athlete: { displayName: "De'Von Achane" }, stats: ["12", "60", "1"] }] }] },
    { team: { abbreviation: "BUF" }, statistics: [
      { name: "passing", keys: ["passingYards", "passingTouchdowns"], athletes: [{ athlete: { displayName: "Josh Allen" }, stats: ["200", "1"] }] },
      { name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"], athletes: [{ athlete: { displayName: "James Cook" }, stats: ["15", "70", "0"] }] }] },
  ] } });
  return { ok: false, status: 404, json: async () => ({}) };
};
true;
"""


def contest(lock_in_s=3600):
    return {
        "id": "2026_11", "season": 2026, "week": 11, "lock_at": int((time.time() + lock_in_s) * 1000), "book": "FanDuel",
        "games": [
            {"id": "2026_11_MIA_BUF", "away": "MIA", "home": "BUF", "day": "Sunday", "time": "13:00", "players": [
                {"k": "BUF|James Cook", "name": "James Cook", "pos": "RB", "team": "BUF", "odds": -150},
                {"k": "MIA|De'Von Achane", "name": "De'Von Achane", "pos": "RB", "team": "MIA", "odds": 130}]},
            {"id": "2026_11_CIN_WAS", "away": "CIN", "home": "WAS", "day": "Monday", "time": "20:15", "players": [
                {"k": "CIN|Ja'Marr Chase", "name": "Ja'Marr Chase", "pos": "WR", "team": "CIN", "odds": 140}]},
        ],
    }


PICKS = {"2026_11_MIA_BUF": "MIA|De'Von Achane", "2026_11_CIN_WAS": "CIN|Ja'Marr Chase"}


def setUpModule():
    base.setUpModule()
    base.PAGE.evaluate(CONTEST_DB)


def tearDownModule():
    base.tearDownModule()


def api(**opts):
    return base.api(URL, **opts)


def enter(uid, **extra):
    return api(uid=uid, method="POST", body={"action": "enter", "name": "Bet Wizard", "contact": "@betwizard", "picks": PICKS, **extra})


class Contest(unittest.TestCase):
    def setUp(self):
        base.PAGE.evaluate("() => { window.DB = contestDB(); }")

    def open(self, **kw):
        return api(uid=OWNER, method="POST", body={"action": "open", "contest": contest(**kw)})

    def test_signed_out_gets_nothing(self):
        self.assertEqual(api()["status"], 401)

    def test_nothing_open_until_the_owner_locks_prices(self):
        got = api(uid="123")["body"]
        self.assertIsNone(got["contest"])
        self.assertEqual(enter("123")["status"], 409)
        self.assertEqual(api(uid="123", method="POST", body={"action": "open", "contest": contest()})["status"], 403)
        self.assertEqual(self.open()["status"], 200)
        self.assertEqual(api(uid="123")["body"]["contest"]["games"][0]["players"][0]["odds"], -150)

    def test_one_entry_per_account_replaced_on_save(self):
        self.open()
        self.assertEqual(enter("123")["status"], 200)
        self.assertEqual(enter("123", name="Wizard 2")["status"], 200)
        got = api(uid="123")["body"]
        self.assertEqual(len(got["entries"]), 1)
        self.assertEqual(got["me"]["name"], "Wizard 2")
        self.assertEqual(got["me"]["picks"], PICKS)

    def test_every_game_needs_a_real_pick_and_a_name_and_contact(self):
        self.open()
        self.assertEqual(enter("123", picks={"2026_11_MIA_BUF": "MIA|De'Von Achane"})["body"]["error"], "picks")
        self.assertEqual(enter("123", picks={**PICKS, "2026_11_CIN_WAS": "WAS|Nobody"})["body"]["error"], "picks")
        self.assertEqual(enter("123", name=" ")["body"]["error"], "name")
        self.assertEqual(enter("123", contact="")["body"]["error"], "contact")
        self.assertEqual(api(uid="123")["body"]["entries"], [])

    def test_picks_and_contacts_hidden_before_the_lock(self):
        self.open()
        enter("123")
        other = api(uid="456")["body"]["entries"][0]
        self.assertEqual(other["name"], "Bet Wizard")
        self.assertNotIn("picks", other)
        self.assertNotIn("contact", other)
        owner = api(uid=OWNER)["body"]["entries"][0]
        self.assertEqual((owner["picks"], owner["contact"], owner["uid"]), (PICKS, "@betwizard", "123"))

    def test_after_the_lock_nothing_changes_and_picks_show(self):
        self.open()
        enter("123")
        # Move the lock into the past (the owner re-locks with lock_at in the past).
        api(uid=OWNER, method="POST", body={"action": "open", "contest": contest(lock_in_s=-60)})
        self.assertEqual(enter("123", name="Late Change")["body"]["error"], "locked")
        self.assertEqual(enter("789")["body"]["error"], "locked")
        other = api(uid="456")["body"]
        self.assertTrue(other["locked"])
        self.assertEqual(other["entries"][0]["picks"], PICKS)
        self.assertEqual(other["entries"][0]["name"], "Bet Wizard")
        self.assertNotIn("contact", other["entries"][0])

    def test_owner_can_remove_an_entry_or_clear_them_all(self):
        self.open()
        enter("123")
        enter("456")
        self.assertEqual(api(uid="456", method="POST", body={"action": "remove", "uid": "123"})["status"], 403)
        api(uid=OWNER, method="POST", body={"action": "remove", "uid": "123"})
        self.assertEqual([e["uid"] for e in api(uid=OWNER)["body"]["entries"]], ["456"])
        api(uid=OWNER, method="POST", body={"action": "open", "contest": contest(), "clear": True})
        self.assertEqual(api(uid=OWNER)["body"]["entries"], [])

    def locked(self):
        self.open()
        self.assertEqual(enter("123")["status"], 200)
        self.open(lock_in_s=-60)
        base.PAGE.evaluate("() => { espnCalls.length = 0; espnState = 'in'; }")

    def test_no_live_feed_before_the_lock(self):
        self.open()
        base.PAGE.evaluate("() => { espnCalls.length = 0; }")
        got = api(uid="123")["body"]
        self.assertNotIn("live", got)
        self.assertEqual(base.PAGE.evaluate("() => espnCalls.length"), 0)

    def test_live_tds_after_the_lock_from_espn(self):
        self.locked()
        live = api(uid="456")["body"]["live"]
        buf = live["games"]["2026_11_MIA_BUF"]
        self.assertEqual((buf["state"], buf["detail"]), ("in", "5:32 - 2nd"))
        self.assertEqual(buf["teams"]["MIA"]["tds"], {"De'Von Achane": 1})
        self.assertEqual(buf["teams"]["BUF"]["tds"], {})  # Allen's passing TD doesn't count
        self.assertIn("James Cook", buf["teams"]["BUF"]["played"])
        self.assertFalse(buf.get("final"))
        self.assertEqual(live["games"]["2026_11_CIN_WAS"]["state"], "pre")  # WSH matched to WAS
        # Asked once per 2 minutes, however many members load the page.
        calls = base.PAGE.evaluate("() => espnCalls.length")
        self.assertEqual(calls, 2)  # the scoreboard + the one started game
        api(uid="789")
        self.assertEqual(base.PAGE.evaluate("() => espnCalls.length"), calls)

    def test_a_final_game_is_saved_and_never_fetched_again(self):
        self.locked()
        base.PAGE.evaluate("() => { espnState = 'post'; }")
        self.assertTrue(api(uid="456")["body"]["live"]["games"]["2026_11_MIA_BUF"]["final"])
        # Two minutes later: the scoreboard again, but not the finished game's box score.
        base.PAGE.evaluate("""() => { const r = DB.live.get('2026_11|feed'); const d = JSON.parse(r.data); d.fetched = 0; r.data = JSON.stringify(d); espnCalls.length = 0; }""")
        got = api(uid="456")["body"]["live"]["games"]["2026_11_MIA_BUF"]
        self.assertEqual(got["teams"]["MIA"]["tds"], {"De'Von Achane": 1})
        self.assertEqual([u for u in base.PAGE.evaluate("() => espnCalls") if "event=101" in u], [])

    def test_espn_down_keeps_the_page_working(self):
        self.locked()
        base.PAGE.evaluate("() => { window.realFetch = window.fetch; window.fetch = async () => { throw new Error('down'); }; }")
        try:
            got = api(uid="456")
        finally:
            base.PAGE.evaluate("() => { window.fetch = window.realFetch; }")
        self.assertEqual(got["status"], 200)
        self.assertEqual(got["body"]["live"]["error"], "espn")
        self.assertEqual(len(got["body"]["entries"]), 1)

    def test_owner_marks_a_result_by_hand(self):
        self.locked()
        mark = {"action": "mark", "g": "2026_11_CIN_WAS", "k": "CIN|Ja'Marr Chase", "result": "hit"}
        self.assertEqual(api(uid="456", method="POST", body=mark)["status"], 403)
        self.assertEqual(api(uid=OWNER, method="POST", body={**mark, "result": "maybe"})["status"], 400)
        self.assertEqual(api(uid=OWNER, method="POST", body={**mark, "k": "CIN|Nobody"})["status"], 400)
        self.assertEqual(api(uid=OWNER, method="POST", body=mark)["status"], 200)
        self.assertEqual(api(uid="456")["body"]["marks"], {"2026_11_CIN_WAS": {"CIN|Ja'Marr Chase": "hit"}})
        api(uid=OWNER, method="POST", body={**mark, "result": None})  # Auto: back to the feed
        self.assertEqual(api(uid="456")["body"]["marks"], {})

    def test_owner_resets_every_hand_result(self):
        self.locked()
        for k in ("CIN|Ja'Marr Chase", "WAS|Terry McLaurin"):
            api(uid=OWNER, method="POST", body={"action": "mark", "g": "2026_11_CIN_WAS", "k": k, "result": "void"})
        self.assertEqual(api(uid="456", method="POST", body={"action": "unmark"})["status"], 403)
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "unmark"})["status"], 200)
        self.assertEqual(api(uid="456")["body"]["marks"], {})

    def test_marks_wait_for_the_lock(self):
        self.open()
        mark = {"action": "mark", "g": "2026_11_CIN_WAS", "k": "CIN|Ja'Marr Chase", "result": "hit"}
        self.assertEqual(api(uid=OWNER, method="POST", body=mark)["status"], 409)

    def test_espn_first_td_is_the_earliest_scoring_play_that_is_a_td(self):
        self.locked()
        buf = api(uid="456")["body"]["live"]["games"]["2026_11_MIA_BUF"]
        self.assertEqual((buf["first"]["team"], buf["first"]["name"]), ("MIA", "De'Von Achane"))
        self.assertIsNone(api(uid="456")["body"]["live"]["games"]["2026_11_CIN_WAS"]["first"])

    def test_bad_contest_refused(self):
        bad = contest()
        bad["games"][0]["players"][0]["odds"] = 50  # not American odds
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)
        bad = contest()
        bad["games"][0]["players"][0]["team"] = "KC"  # not in this game
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)
        self.assertIsNone(api(uid=OWNER)["body"]["contest"])
        bad = three_contest(60, 120)
        bad["games"][0]["first"][0]["team"] = "KC"  # a First TD pick from another game
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)
        bad = three_contest(60, 120)
        bad["games"][0]["lock_at"] = bad["lock_at"] + 1  # a game locking after the contest closes
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)


# Three picks a game (2026-11-24): the game's First TD + one anytime per team; Wednesday locks alone.
WED, THU = "2026_12_GB_LA", "2026_12_CHI_DET"


def three_contest(wed_in_s, thu_in_s):
    now = time.time()
    wed, thu = int((now + wed_in_s) * 1000), int((now + thu_in_s) * 1000)
    p = lambda team, name, odds: {"k": f"{team}|{name}", "name": name, "pos": "RB", "team": team, "odds": odds}
    return {
        "id": "2026_12", "season": 2026, "week": 12, "lock_at": max(wed, thu), "book": "FanDuel", "first_book": "FanDuel", "title": "$100 Thanksgiving Contest",
        "games": [
            {"id": WED, "away": "GB", "home": "LA", "day": "Wednesday", "time": "20:00", "lock_at": wed,
             "players": [p("GB", "Josh Jacobs", -120), p("GB", "Tucker Kraft", 250), p("LA", "Kyren Williams", -150)],
             "first": [p("GB", "Josh Jacobs", 550), p("LA", "Kyren Williams", 450)]},
            {"id": THU, "away": "CHI", "home": "DET", "day": "Thursday", "time": "13:00", "lock_at": thu,
             "players": [p("CHI", "D'Andre Swift", 120), p("DET", "Jahmyr Gibbs", -200)],
             "first": [p("CHI", "D'Andre Swift", 800), p("DET", "Jahmyr Gibbs", 350)]},
        ],
    }


WED_PICKS = {f"{WED}:F": "LA|Kyren Williams", f"{WED}:A": "GB|Josh Jacobs", f"{WED}:H": "LA|Kyren Williams"}
THU_PICKS = {f"{THU}:F": "DET|Jahmyr Gibbs", f"{THU}:A": "CHI|D'Andre Swift", f"{THU}:H": "DET|Jahmyr Gibbs"}


class ThreePicks(unittest.TestCase):
    def setUp(self):
        base.PAGE.evaluate("() => { window.DB = contestDB(); espnCalls.length = 0; espnState = 'in'; }")

    def open(self, wed_in_s, thu_in_s):
        return api(uid=OWNER, method="POST", body={"action": "open", "contest": three_contest(wed_in_s, thu_in_s)})

    def test_every_open_pick_needed(self):
        self.assertEqual(self.open(3600, 7200)["status"], 200)
        self.assertEqual(api(uid="123")["body"]["contest"]["title"], "$100 Thanksgiving Contest")
        five = {**WED_PICKS, **THU_PICKS}
        del five[f"{THU}:H"]
        self.assertEqual(enter("123", picks=five)["body"]["error"], "picks")
        self.assertEqual(enter("123", picks={**WED_PICKS, **THU_PICKS, f"{THU}:A": "DET|Jahmyr Gibbs"})["body"]["error"], "picks")  # a DET player in CHI's pick
        self.assertEqual(enter("123", picks={**WED_PICKS, **THU_PICKS})["status"], 200)
        self.assertEqual(api(uid="123")["body"]["me"]["picks"], {**WED_PICKS, **THU_PICKS})

    def test_wednesday_locks_alone_late_entries_and_the_picks_that_show(self):
        self.open(3600, 7200)
        enter("123", picks={**WED_PICKS, **THU_PICKS})
        self.open(-60, 7200)  # Wednesday's game has kicked off
        changed = {**WED_PICKS, f"{WED}:F": "GB|Josh Jacobs", **THU_PICKS, f"{THU}:F": "CHI|D'Andre Swift"}
        self.assertEqual(enter("123", picks=changed)["status"], 200)
        mine = api(uid="123")["body"]["me"]["picks"]
        self.assertEqual(mine[f"{WED}:F"], "LA|Kyren Williams")  # locked: the change is ignored
        self.assertEqual(mine[f"{THU}:F"], "CHI|D'Andre Swift")  # still open: changed
        # A member entering Thursday morning: only the open games' picks.
        self.assertEqual(enter("789", picks=THU_PICKS)["status"], 200)
        self.assertEqual(api(uid="789")["body"]["me"]["picks"], THU_PICKS)
        # Everyone sees Wednesday's picks, nobody else's Thursday ones; the owner sees everything.
        got = api(uid="456")["body"]
        self.assertFalse(got["locked"])
        by = {e["name"]: e for e in got["entries"]}
        self.assertEqual(by["Bet Wizard"]["picks"], {})  # 789 made no Wednesday picks (same name: newest last)
        self.assertIn("live", got)  # the live feed starts with the first lock
        first = got["entries"][0]
        self.assertEqual(first["picks"], WED_PICKS)
        self.assertEqual(len(api(uid=OWNER)["body"]["entries"][0]["picks"]), 6)
        # Hand results: by pick, only for a locked game.
        mark = {"action": "mark", "g": f"{WED}:F", "k": "LA|Kyren Williams", "result": "hit"}
        self.assertEqual(api(uid=OWNER, method="POST", body=mark)["status"], 200)
        self.assertEqual(api(uid=OWNER, method="POST", body={**mark, "g": f"{THU}:F", "k": "DET|Jahmyr Gibbs"})["status"], 409)
        # Thursday's kickoff: entries close.
        self.open(-120, -60)
        self.assertEqual(enter("999", picks={})["body"]["error"], "locked")


if __name__ == "__main__":
    unittest.main()
