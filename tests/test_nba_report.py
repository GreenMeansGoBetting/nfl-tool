"""The NBA's official injury report (nfl_tool/nba/nba_report.py, 2026-10-25),
the sim's second injury source: on 10-25 its 1:00 pm report had Embiid Out 8
minutes before ESPN. The sample is that report (tests/fixtures).

What is pinned: the report's address for a 15-minute slot (Eastern time) and
the slot back from the address; the newest posted report found by stepping
back; every row read by column (the team and the name share a line, so plain
text runs them together); names matched to ESPN ids among tonight's teams
(a name matching no one or two players is left out; a player's first row,
tonight's game, counts); the build's merge (the newer of ESPN and the
report wins; Available takes him off; a new Out / Questionable is added);
the refresh's first step stops when tonight's statuses didn't change."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "nfl_tool"))
import build_nba  # noqa: E402
import nba_report  # noqa: E402

PDF = (ROOT / "tests" / "fixtures" / "nba_injury_report_2026-10-25_0100PM.pdf").read_bytes()
BASE = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_"
PLAYERS = {"3059318": ("Joel Embiid", "PHI"), "4277811": ("Walker Kessler", "UTA"), "4433134": ("Cameron Carr", "LAL"),
           "1": ("Tyrese Maxey", "PHI")}


class Addresses(unittest.TestCase):
    def test_the_slot_and_back(self):
        at = lambda h, m: datetime(2026, 10, 25, h, m, tzinfo=timezone.utc)  # noqa: E731
        self.assertEqual(nba_report.slot_url(at(17, 8)), BASE + "2026-10-25_01_00PM.pdf")  # 1:08 pm Eastern
        self.assertEqual(nba_report.slot_url(at(16, 0)), BASE + "2026-10-25_12_00PM.pdf")
        self.assertEqual(nba_report.slot_url(at(3, 59)), BASE + "2026-10-24_11_45PM.pdf")
        self.assertEqual(nba_report.slot_utc(BASE + "2026-10-25_01_00PM.pdf"), "2026-10-25T17:00Z")
        self.assertEqual(nba_report.slot_utc(BASE + "2026-10-25_12_15AM.pdf"), "2026-10-25T04:15Z")
        self.assertIsNone(nba_report.slot_utc("elsewhere.pdf"))

    def test_the_newest_posted_report(self):
        posted = {BASE + "2026-10-25_01_00PM.pdf": PDF}
        pdf, url = nba_report.fetch_latest(datetime(2026, 10, 25, 17, 44, tzinfo=timezone.utc), posted.get)  # 1:30 not up yet
        self.assertEqual((pdf, url), (PDF, BASE + "2026-10-25_01_00PM.pdf"))
        self.assertEqual(nba_report.fetch_latest(datetime(2026, 10, 25, 23, 0, tzinfo=timezone.utc), posted.get), (None, None))


class Rows(unittest.TestCase):
    def test_every_row_by_column(self):
        stamp, rows = nba_report.rows(nba_report.fragments(PDF))
        self.assertEqual(stamp, "01:00 PM")
        self.assertEqual(len(rows), 47)
        self.assertIn(("Joel Embiid", "Out"), rows)
        self.assertIn(("Walker Kessler", "Available"), rows)
        self.assertTrue(all(s in nba_report.STATUSES for _, s in rows))
        self.assertFalse([n for n, _ in rows if any(w in n for w in ("Lakers", "Nets", "Jazz", "@"))])  # no team text in a name

    def test_names_to_ids_among_tonights_teams(self):
        found = nba_report.tonight(PDF, PLAYERS, {"PHI", "UTA"})
        self.assertEqual(found, {"3059318": "Out", "4277811": "Available"})  # LAL not tonight; Maxey not on it
        twins = {**PLAYERS, "9": ("Joel Embiid", "PHI")}
        self.assertNotIn("3059318", nba_report.tonight(PDF, twins, {"PHI"}))
        self.assertEqual(nba_report.statuses([("Joel Embiid", "Out"), ("Joel Embiid", "Questionable")], PLAYERS, {"PHI"}), {"3059318": "Out"})
        self.assertEqual(nba_report.tonight(None, PLAYERS, {"PHI"}), {})


class Merge(unittest.TestCase):
    def test_the_newer_source_wins(self):
        injuries = {"PHI": [{"id": "3059318", "name": "Joel Embiid", "status": "Questionable", "updated": "2026-10-25T16:40Z"}],
                    "UTA": [{"id": "4277811", "name": "Walker Kessler", "status": "Day-To-Day", "updated": "2026-10-25T16:00Z"}],
                    "DET": [{"id": "5", "name": "Jalen Duren", "status": "Out", "updated": "2026-10-25T17:30Z"}]}
        report = {"3059318": "Out", "4277811": "Available", "5": "Questionable", "6": "Doubtful", "7": "Probable"}
        players = {**PLAYERS, "5": ("Jalen Duren", "DET"), "6": ("Ausar Thompson", "DET"), "7": ("Cade Cunningham", "DET")}
        got = build_nba.add_report(injuries, report, "2026-10-25T17:00Z", players)
        self.assertEqual([(r["id"], r["status"]) for r in got["PHI"]], [("3059318", "Out")])  # the report is newer
        self.assertEqual(got["UTA"], [])  # Available: off the list
        self.assertEqual(sorted((r["id"], r["status"]) for r in got["DET"]), [("5", "Out"), ("6", "Doubtful")])  # ESPN newer; Probable not added
        self.assertEqual(got["PHI"][0]["source"], "nba")


class Check(unittest.TestCase):
    def test_the_first_step_stops_when_nothing_changed(self):
        data = {"teams": {"PHI": {"id": 20}, "UTA": {"id": 26}}, "players": {"PHI": [{"id": "3059318", "name": "Joel Embiid"}],
                                                                           "UTA": [{"id": "4277811", "name": "Walker Kessler"}]}}
        same = nba_report.digest({"3059318": "Out", "4277811": "Available"})
        version = lambda rep: {"nba": {"watch": {"teams": [20, 26], "rep": rep}}}  # noqa: E731
        url = BASE + "2026-10-25_01_00PM.pdf"
        self.assertFalse(nba_report.changed(version(same), data, PDF, url)[0])
        self.assertTrue(nba_report.changed(version("0" * 16), data, PDF, url)[0])
        self.assertTrue(nba_report.changed(version(None), data, PDF, url)[0])  # nothing to compare: go
        self.assertTrue(nba_report.changed(version(same), None, PDF, url)[0])  # the live data couldn't be read: go
        self.assertFalse(nba_report.changed(version(same), data, None, None)[0])  # no report posted


if __name__ == "__main__":
    unittest.main()
