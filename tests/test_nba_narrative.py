"""Dunk Digest's Narrative box (nfl_tool/nba/narrative.py), on made-up players.

Pinned (the owner, 2026-11-18): who counts as a Revenge Game, Back To Hometown and Back To College, and
every wrong story the first real slate turned up. A spot the sources don't back stays empty."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import narrative as N  # noqa: E402

AT = {"akron": [41.081, -81.522], "newark": [40.736, -74.172], "pinetown": [35.610, -76.861], "glencoe": [42.135, -87.758], "bethlehem": [40.626, -75.370],
      "parker": [39.519, -104.761], "boulder": [40.015, -105.271], "brooklyn": [40.650, -73.950], "montverde": [28.600, -81.674]}
TEAM_IDS = {k: i + 1 for i, k in enumerate(sorted(N.ARENAS))}


def place(where, text=None):
    return {"t": text or where.title(), "at": AT[where]}


def player(**kw):
    return {"name": "P", "checked": "2026-11-18", "teams": [], "town": None, "born": None, "hs": [], "col": [], **kw}


def school(where, prep=False):
    return {"n": f"{where} High", "t": where.title(), "at": AT[where], "prep": prep}


class ReadingWikipedia(unittest.TestCase):
    def test_a_school_in_the_avoid_wrap_form(self):
        got = N.schools("[[Charlotte Christian School|Charlotte Christian]] {{avoid wrap|([[Charlotte, North Carolina]])}}")
        self.assertEqual([(s["name"], s["place"], s["prep"]) for s in got], [("Charlotte Christian", "Charlotte, North Carolina", False)])
        self.assertEqual(got[0]["titles"][0], "Charlotte, North Carolina")

    def test_every_school_in_order_and_national_preps_marked(self):
        got = N.schools("* [[James Bowie High School (Arlington, Texas)|James Bowie]]<br />([[Arlington, Texas]])\n* [[Montverde Academy]]<br />([[Montverde, Florida]])")
        self.assertEqual([(s["name"], s["prep"]) for s in got], [("James Bowie", False), ("Montverde Academy", True)])

    def test_a_local_school_sharing_a_prep_word_is_not_a_prep(self):
        self.assertFalse(N.schools("[[Hillcrest High School (Dallas)|Hillcrest]] ([[Dallas, Texas]])")[0]["prep"])

    def test_colleges_use_espns_team_name(self):
        got = N.colleges("[[Texas Longhorns men's basketball|Texas]] (2006–2007)")
        self.assertEqual(got, [{"team": "Texas Longhorns", "name": "Texas", "years": "2006–2007"}])


class Revenge(unittest.TestCase):
    def test_who_counts(self):
        ok = lambda gp, last: N.counts_as_revenge({"gp": gp, "first": last, "last": last}, 2027)
        self.assertFalse(ok(8, 2024))  # a short stint (Oscar Tshiebwe)
        self.assertFalse(ok(52, 2023))  # a real stint, too long ago (Jarred Vanderbilt)
        self.assertTrue(ok(50, 2025))
        self.assertTrue(ok(204, 2023))  # 200+ counts however long ago (Saddiq Bey)

    def test_tags(self):
        at = "2026-11-19T00:30Z"
        tag = N.revenge_tag
        self.assertEqual(tag({"games": []}, False, at, False), "First Time Facing Them")
        self.assertEqual(tag({"games": []}, True, at, False), "First Game Back")
        self.assertEqual(tag({"games": [["2026-01-01T00:00Z", "vs"]]}, True, at, False), "First Game Back")  # faced them, never there
        self.assertIsNone(tag({"games": [["2026-01-01T00:00Z", "@"]]}, True, at, False))
        self.assertIsNone(tag({"games": [["2026-01-01T00:00Z", "vs"]]}, False, at, False))
        self.assertEqual(tag({"games": [[at, "@"]]}, True, at, False), "First Game Back")  # tonight itself doesn't count
        self.assertEqual(tag({"games": []}, True, at, True), "First Time Facing Them")  # a neutral site isn't "back"
        self.assertIsNone(tag(None, True, at, False))  # not known: say nothing

    def test_preseason_never_counts_and_only_games_after_he_left(self):
        def ev(when, team, opp, at="vs"):
            return {"gameDate": when + ":00.000+00:00", "team": {"id": str(team)}, "opponent": {"id": str(opp)}, "atVs": at}
        log = {"seasonTypes": [{"displayName": "2025-26 Regular Season", "categories": [{"events": [{"eventId": "1"}, {"eventId": "2"}, {"eventId": "3"}]}]},
                               {"displayName": "2025-26 Preseason", "categories": [{"events": [{"eventId": "4"}]}]}],
               "events": {"1": ev("2025-11-01T00:00", 9, 5), "2": ev("2026-01-01T00:00", 7, 9), "3": ev("2026-02-01T00:00", 7, 9, "@"), "4": ev("2026-10-01T00:00", 7, 9)}}
        self.assertEqual(N.games_since([log], 9), {"left": "2025-11-01T00:00Z", "games": [["2026-01-01T00:00Z", "vs"], ["2026-02-01T00:00Z", "@"]]})


class Hometown(unittest.TestCase):
    def test_two_sources_agree(self):
        rec = player(town=place("parker", "Parker, CO"), born=place("parker"), hs=[school("parker")])
        self.assertEqual(N.hometown(rec, "DEN", "BOS"), {"place": "Parker, CO", "school": "parker High"})

    def test_one_source_alone_is_not_enough(self):
        self.assertIsNone(N.hometown(player(born=place("parker")), "DEN", "BOS"))

    def test_born_there_but_high_school_elsewhere_is_no_hometown(self):
        # Bam Adebayo at New York: both say Newark, his high schools are in North Carolina
        self.assertIsNone(N.hometown(player(town=place("newark"), born=place("newark"), hs=[school("pinetown")]), "NY", "MIA"))

    def test_a_prep_school_never_counts(self):
        self.assertIsNone(N.hometown(player(hs=[school("montverde", True)]), "ORL", "DET"))  # Cade Cunningham
        rec = player(town=place("parker"), born=place("parker"), hs=[school("montverde", True)])
        self.assertTrue(N.hometown(rec, "DEN", "BOS"))  # a prep elsewhere doesn't say he isn't from here

    def test_the_arena_must_be_the_closest_one(self):
        # Danny Wolf: Glencoe is 64 miles from Milwaukee but a Chicago suburb
        rec = player(town=place("glencoe"), born=place("glencoe"), hs=[school("glencoe")])
        self.assertIsNone(N.hometown(rec, "MIL", "BKN"))
        self.assertTrue(N.hometown(rec, "CHI", "BKN"))

    def test_same_city_arenas_count_as_one(self):
        rec = player(town=place("brooklyn"), born=place("brooklyn"), hs=[school("brooklyn")])
        self.assertTrue(N.hometown(rec, "NY", "MIA"))
        self.assertTrue(N.hometown(rec, "BKN", "MIA"))

    def test_his_own_teams_backyard_is_no_trip(self):
        rec = player(town=place("brooklyn"), born=place("brooklyn"), hs=[school("brooklyn")])
        self.assertIsNone(N.hometown(rec, "BKN", "NY"))


class OneGame(unittest.TestCase):
    GAME = {"game_id": "1", "date": "2026-11-18", "start_utc": "2026-11-19T00:30Z", "away": "BOS", "home": "DEN"}
    ROT = {"BOS": [{"id": "7", "name": "Road Guy", "position": "PG"}], "DEN": [{"id": "8", "name": "Home Guy", "position": "C"}]}
    PLAYERS = {
        "7": player(town=place("parker"), born=place("parker"), hs=[school("parker")], col=[{"n": "Colorado", "y": "2016–2017", "t": "Boulder, Colorado", "at": AT["boulder"], "espn": True}],
                    teams=[[2025, TEAM_IDS["DEN"], 82, 30.0], [2026, TEAM_IDS["DEN"], 40, 30.0]]),
        "8": player(town=place("parker"), born=place("parker"), hs=[school("parker")], col=[{"n": "Colorado", "y": None, "t": "Boulder, Colorado", "at": AT["boulder"], "espn": True}],
                    teams=[[2026, TEAM_IDS["BOS"], 300, 30.0]]),
    }

    def stories(self, neutral=False, meetings=None):
        return N.game_stories(self.GAME, self.ROT, self.PLAYERS, meetings or {}, TEAM_IDS, 2027, neutral)

    def test_revenge_reads_both_teams_with_the_former_teams_games(self):
        got = {r["name"]: r for r in self.stories()["revenge"]}
        self.assertEqual((got["Road Guy"]["gp"], got["Road Guy"]["opp"], got["Road Guy"]["span"]), (122, "DEN", "2024-25 To 2025-26"))
        self.assertEqual((got["Home Guy"]["gp"], got["Home Guy"]["opp"], got["Home Guy"]["span"]), (300, "BOS", "2025-26"))

    def test_first_timers_lead_the_list(self):
        got = self.stories(meetings={"7:DEN": {"games": []}})["revenge"]
        self.assertEqual([(r["name"], r["tag"]) for r in got], [("Road Guy", "First Game Back"), ("Home Guy", None)])

    def test_only_the_road_player_goes_back(self):
        s = self.stories()
        self.assertEqual([r["name"] for r in s["hometown"]], ["Road Guy"])
        self.assertEqual([(r["name"], r["school"]) for r in s["college"]], [("Road Guy", "Colorado")])

    def test_college_goes_to_the_closest_arena(self):
        # CJ McCollum: Lehigh is within 75 miles of New York but closer to Philadelphia
        rec = player(col=[{"n": "Lehigh", "at": AT["bethlehem"], "t": "Bethlehem"}])
        for home, n in (("NY", 0), ("PHI", 1)):
            g = {**self.GAME, "home": home, "away": "ATL"}
            got = N.game_stories(g, {"ATL": [{"id": "1", "name": "C", "position": "SG"}]}, {"1": rec}, {}, TEAM_IDS, 2027)
            self.assertEqual(len(got["college"]), n, home)

    def test_a_neutral_site_has_no_hometown_or_college_answer(self):
        s = self.stories(neutral=True)
        self.assertIsNone(s["hometown"])
        self.assertIsNone(s["college"])
        self.assertEqual(len(s["revenge"]), 2)

    def test_a_hand_correction_hides_one_story(self):
        with mock.patch.dict(N.HIDE, {"7": {"hometown"}}):
            s = self.stories()
        self.assertEqual(s["hometown"], [])
        self.assertEqual(len(s["college"]), 1)

    def test_a_player_with_no_saved_facts_tells_no_story(self):
        got = N.game_stories(self.GAME, self.ROT, {}, {}, TEAM_IDS, 2027)
        self.assertEqual(got, {"revenge": [], "hometown": [], "college": []})


class TheSavedFile(unittest.TestCase):
    TEAMS = {k: {"id": i} for k, i in TEAM_IDS.items()}

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        patch = mock.patch.object(N, "HISTORY", Path(self.dir.name))
        patch.start()
        self.addCleanup(patch.stop)

    def test_new_players_first_then_the_oldest(self):
        saved = {"a": {"checked": "2026-11-01"}, "b": {"checked": "2026-10-01"}, "c": {"checked": "2026-11-17"}}
        self.assertEqual(N.to_refresh(["a", "b", "c", "d"], saved, "2026-11-18", None), ["d", "b", "a"])
        self.assertEqual(N.to_refresh(["a", "b", "c", "d"], saved, "2026-11-18", 2), ["d", "b"])

    def test_nothing_saved_means_no_data(self):
        self.assertIsNone(N.block(2027, [], {}, self.TEAMS, [], [], "2026-11-18", refresh=False))

    def test_the_injury_refresh_asks_no_source(self):
        N.save(2027, {"players": {"7": OneGame.PLAYERS["7"]}, "meetings": {}})
        with mock.patch.object(N, "update", side_effect=AssertionError("asked a source")):
            got = N.block(2027, [OneGame.GAME], OneGame.ROT, self.TEAMS, [], [], "2026-11-18", refresh=False)
        self.assertEqual(got["games"]["1"]["hometown"][0]["name"], "Road Guy")

    def test_a_source_being_down_keeps_what_is_saved(self):
        N.save(2027, {"players": {"7": OneGame.PLAYERS["7"]}, "meetings": {}})
        with mock.patch.object(N, "refresh_players", side_effect=RuntimeError("wikipedia down")), mock.patch("sys.stderr"):
            got = N.block(2027, [OneGame.GAME], OneGame.ROT, self.TEAMS, ["9"], [], "2026-11-18")
        self.assertEqual(len(got["games"]["1"]["college"]), 1)
        self.assertIn("7", json.loads((N.HISTORY / "2027.json").read_text(encoding="utf-8"))["players"])

    def test_the_game_site_list_decides_neutral(self):
        N.save(2027, {"players": {"7": OneGame.PLAYERS["7"]}, "meetings": {}})
        got = N.block(2027, [OneGame.GAME], OneGame.ROT, self.TEAMS, [], [1], "2026-11-18", refresh=False)
        self.assertIsNone(got["games"]["1"]["hometown"])


class Arenas(unittest.TestCase):
    def test_all_thirty_teams(self):
        self.assertEqual(len(N.ARENAS), 30)
        self.assertTrue(set(N.SAME_CITY) <= set(N.ARENAS))


if __name__ == "__main__":
    unittest.main()
