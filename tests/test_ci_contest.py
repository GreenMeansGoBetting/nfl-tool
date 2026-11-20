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
  const stmt = (sql, a = []) => ({
    bind: (...args) => stmt(sql, args),
    run: async () => {
      if (sql.startsWith("INSERT INTO contests")) contests.set(a[0], { id: a[0], config: a[1], created: a[2] });
      else if (sql.startsWith("INSERT INTO contest_entries")) entries.set(`${a[0]}|${a[1]}`, { contest: a[0], uid: a[1], name: a[2], contact: a[3], picks: a[4], updated: a[5] });
      else if (sql.startsWith("DELETE FROM contest_entries WHERE contest = ? AND uid = ?")) entries.delete(`${a[0]}|${a[1]}`);
      else if (sql.startsWith("DELETE FROM contest_entries")) for (const k of [...entries.keys()]) if (k.startsWith(`${a[0]}|`)) entries.delete(k);
      return {};
    },
    first: async () => [...contests.values()].sort((x, y) => y.created - x.created)[0] || null,
    all: async () => ({ results: [...entries.values()].filter((r) => r.contest === a[0]).sort((x, y) => x.updated - y.updated) }),
  });
  return { prepare: (sql) => stmt(sql) };
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

    def test_bad_contest_refused(self):
        bad = contest()
        bad["games"][0]["players"][0]["odds"] = 50  # not American odds
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)
        bad = contest()
        bad["games"][0]["players"][0]["team"] = "KC"  # not in this game
        self.assertEqual(api(uid=OWNER, method="POST", body={"action": "open", "contest": bad})["status"], 400)
        self.assertIsNone(api(uid=OWNER)["body"]["contest"])


if __name__ == "__main__":
    unittest.main()
