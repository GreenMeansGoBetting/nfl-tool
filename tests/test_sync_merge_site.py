"""Saved plays never lost to a stale device (site/sync.js), run in a real browser
against a stand-in profile server.

What is pinned (2026-11-19, a member's NBA plays saved in the morning were gone):
My Plays grades yesterday's plays when it opens and saves the list before the
profile has answered. That device's copy was older than the profile (plays saved
since on another device), but its fresh stamp made it "newest", and it replaced
the profile. Now a device that saved on top of an older copy merges with the
profile (lists by id, its own edits winning a tie), while a device that is in
step with the profile still sends its change as is (a delete sticks)."""
import json
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None
KEY = "nfl-tool.nba-plays.v1"


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class StaleDevice(unittest.TestCase):
    def open(self, local, meta, bases, server):
        """support.html with this device's storage, the profile's answer held back."""
        self.server = {k: dict(v) for k, v in server.items()}
        self.held, self.puts = [], []
        page = SITE.context.new_page()
        self.addCleanup(page.close)

        def route(r):
            if r.request.method == "GET":
                self.held.append(r)
            else:
                body = json.loads(r.request.post_data)
                self.puts.append(body)
                old = self.server.get(body["k"])
                if not old or body["updated"] >= old["updated"]:
                    self.server[body["k"]] = {"v": body["v"], "updated": body["updated"]}
                r.fulfill(status=200, content_type="application/json", body='{"ok":true}')

        page.route("**/api/state", route)
        page.add_init_script(f"""(() => {{ if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
          localStorage.setItem({json.dumps(KEY)}, {json.dumps(json.dumps(local))});
          localStorage.setItem("nfl-tool.sync-meta.v1", {json.dumps(json.dumps(meta))});
          localStorage.setItem("nfl-tool.sync-base.v1", {json.dumps(json.dumps(bases))});
          localStorage.setItem("nfl-tool.updates-seen.v1", "[]"); }})()""")
        page.goto(f"{SITE.origin}/support.html")
        page.wait_for_function("() => window.NFLSync")
        self.page = page

    def answer(self):
        """The profile answers the held GET with what it holds now."""
        while not self.held:
            self.page.wait_for_timeout(20)
        r = self.held.pop(0)
        r.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"user": {"name": "Pat Lee", "owner": False}, "state": self.server}))

    def ids(self, raw):
        return sorted(p["id"] for p in json.loads(raw))

    def test_a_stale_device_saving_before_the_profile_answers_keeps_the_other_devices_plays(self):
        yesterday = {"id": "a", "player": "Yesterday"}
        this_morning = {"id": "c", "player": "Saved This Morning On The Phone"}
        self.open(local=[yesterday], meta={KEY: 1000}, bases={},
                  server={KEY: {"v": json.dumps([yesterday, this_morning]), "updated": 2000}})
        # My Plays grades yesterday's play and saves, before the profile has answered
        self.page.evaluate("() => saveNbaPlays([{ ...loadNbaPlays()[0], result: 'win' }])")
        self.answer()
        self.page.wait_for_function("() => document.getElementById('acct-chip')")
        self.page.wait_for_timeout(200)
        local = self.page.evaluate(f"() => localStorage.getItem({json.dumps(KEY)})")
        self.assertEqual(self.ids(local), ["a", "c"])
        self.assertEqual(self.ids(self.server[KEY]["v"]), ["a", "c"])
        graded = {p["id"]: p for p in json.loads(self.server[KEY]["v"])}["a"]
        self.assertEqual(graded.get("result"), "win")  # this device's edit wins its own play

    def test_a_device_in_step_with_the_profile_still_deletes(self):
        a, c = {"id": "a"}, {"id": "c"}
        self.open(local=[a, c], meta={KEY: 2000}, bases={KEY: 2000},
                  server={KEY: {"v": json.dumps([a, c]), "updated": 2000}})
        self.page.evaluate("() => saveNbaPlays(loadNbaPlays().filter((p) => p.id !== 'c'))")
        self.answer()
        self.page.wait_for_function("() => document.getElementById('acct-chip')")
        self.page.wait_for_timeout(200)
        self.assertEqual(self.ids(self.server[KEY]["v"]), ["a"])

    def test_a_save_later_merges_what_another_device_saved_meanwhile(self):
        a = {"id": "a"}
        self.open(local=[a], meta={KEY: 2000}, bases={KEY: 2000},
                  server={KEY: {"v": json.dumps([a]), "updated": 2000}})
        self.answer()
        self.page.wait_for_function("() => document.getElementById('acct-chip')")
        # the phone saves a play while this tab sits open
        self.server[KEY] = {"v": json.dumps([a, {"id": "c"}]), "updated": 3000}
        self.page.evaluate("() => saveNbaPlays([...loadNbaPlays(), { id: 'b' }])")
        self.answer()  # the save asks the profile first
        self.page.wait_for_function(f"() => JSON.parse(localStorage.getItem({json.dumps(KEY)})).length === 3")
        self.page.wait_for_timeout(200)
        self.assertEqual(self.ids(self.server[KEY]["v"]), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
