"""The two big parts of the NFL data that live in their own files (2026-11-23):
box_scores.json (only Game Previews shows box scores) and pass_plays.json (every
pass play behind the pass charts: only Player Props lists them), so the other
pages read about 40% less.

What is pinned: the build's split loses nothing (putting the parts back gives
the same data); Game Previews and Player Props load their part and put it back
where their code reads it; a page that doesn't show them never asks for them;
a part that fails to load leaves the page working with that part empty; and a
data.json that still carries the parts (an older build) is used as it is."""
import copy
import json
import unittest

import helpers  # noqa: F401 -- first: puts nfl_tool/ and tools/ on the import path
from helpers import site_data

import build_stats
from site_browser import SiteBrowser

SITE = None


def split_sample():
    blob = copy.deepcopy(site_data())
    parts = build_stats.split_page_parts(blob)
    return blob, parts


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class TheBuildSplit(unittest.TestCase):
    def test_nothing_is_lost(self):
        original = site_data()
        blob, parts = split_sample()
        self.assertEqual(sorted(parts), ["box_scores.json", "pass_plays.json"])
        self.assertNotIn("player_box_scores", blob)
        zones = [z for sides in blob["pass_shot_charts"].values() for chart in sides.values() for z in chart["zones"].values()]
        self.assertTrue(zones)
        self.assertFalse(any("plays" in z for z in zones))
        self.assertTrue(all("attempts" in z for z in zones))  # the counts pages rank by stay
        # Put back the way common.js loadDataPart does: the original, exactly.
        blob["player_box_scores"] = parts["box_scores.json"]["player_box_scores"]
        for team, sides in parts["pass_plays.json"]["pass_plays"].items():
            for side, by_zone in sides.items():
                for key, plays in by_zone.items():
                    blob["pass_shot_charts"][team][side]["zones"][key]["plays"] = plays
        self.assertEqual(json.dumps(blob, sort_keys=True), json.dumps(original, sort_keys=True))

    def test_the_parts_are_most_of_the_file(self):
        blob, parts = split_sample()
        size = lambda x: len(json.dumps(x, separators=(",", ":")))  # noqa: E731
        moved = sum(size(p) for p in parts.values())
        self.assertGreater(moved / (moved + size(blob)), 0.25)


class ThePages(unittest.TestCase):
    """Each page opened on the split files, the way the live site serves them."""

    def open_split(self, path, missing=()):
        blob, parts = split_sample()
        asked = []
        page = SITE.context.new_page()
        page.on("pageerror", lambda err: SITE.errors.append(f"{path}: {str(err).splitlines()[0][:200]}"))
        page.route("**/data.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(blob)))
        def answerer(name, part):
            def answer(route):
                asked.append(name)
                if name in missing:
                    route.fulfill(status=404, body="")
                else:
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(part))
            return answer
        for name, part in parts.items():
            page.route(f"**/{name}", answerer(name, part))
        page.goto(f"{SITE.origin}/{path}")
        page.wait_for_function("() => typeof DATA !== 'undefined' && DATA !== null", timeout=20000)
        return page, asked

    def setUp(self):
        SITE.errors.clear()

    def test_game_previews_puts_the_box_scores_back(self):
        page, asked = self.open_split("game-overview.html")
        page.wait_for_function("() => DATA.player_box_scores && Object.keys(DATA.player_box_scores).length > 0", timeout=20000)
        self.assertEqual(page.evaluate("() => Object.keys(DATA.player_box_scores).length"), len(site_data()["player_box_scores"]))
        self.assertEqual(asked, ["box_scores.json"])
        self.assertEqual(SITE.errors, [])
        page.close()

    def test_player_props_puts_every_pass_play_back(self):
        page, asked = self.open_split("player-props.html")
        count = "() => Object.values(DATA.pass_shot_charts).reduce((n, s) => n + Object.values(s).reduce((m, c) => m + Object.values(c.zones).reduce((k, z) => k + (z.plays || []).length, 0), 0), 0)"
        expected = sum(len(z.get("plays", [])) for s in site_data()["pass_shot_charts"].values() for c in s.values() for z in c["zones"].values())
        page.wait_for_function(f"() => ({count})() === {expected}", timeout=20000)
        page.wait_for_selector("#empty-state", state="attached")
        self.assertEqual(asked, ["pass_plays.json"])
        self.assertEqual(SITE.errors, [])
        page.close()

    def test_other_pages_never_ask_for_them(self):
        page, asked = self.open_split("index.html")
        page.wait_for_timeout(1500)
        self.assertEqual(asked, [])
        self.assertEqual(SITE.errors, [])
        page.close()

    def test_a_part_that_fails_leaves_the_page_working(self):
        page, asked = self.open_split("game-overview.html", missing={"box_scores.json"})
        page.wait_for_function("() => document.querySelector('.matchup-card')", timeout=20000)
        self.assertEqual(asked, ["box_scores.json"])
        self.assertIsNone(page.evaluate("() => DATA.player_box_scores || null"))
        self.assertEqual(SITE.errors, [])
        page.close()

    def test_an_older_data_file_with_the_parts_still_in_it_is_used_as_is(self):
        page = SITE.open("game-overview.html")  # the saved sample still carries both parts
        asked = []
        page.on("request", lambda req: asked.append(req.url.split("/")[-1].split("?")[0]))
        page.evaluate("() => Promise.all([loadDataPart('box_scores'), loadDataPart('pass_plays')])")
        self.assertNotIn("box_scores.json", asked)
        self.assertNotIn("pass_plays.json", asked)
        self.assertEqual(SITE.errors, [])
        page.close()


if __name__ == "__main__":
    unittest.main()
