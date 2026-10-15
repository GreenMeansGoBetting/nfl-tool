"""Injured starters must reach the Summary card (build_stats.compute_injury_report).

The injury report and the snap counts spell names differently ("Pat
Surtain II" vs "Patrick Surtain II"). A miss left snap_share empty, which the
card reads as "not a starter", so Denver's top corner, ruled Out for a
Thursday game, never showed (2026-10-15; 14 starters hidden that week)."""
import unittest

import pandas as pd

import helpers  # noqa: F401 -- first: puts nfl_tool/ on the import path

import build_stats

SHARES = {
    "DEN": {"Patrick Surtain II": 0.86, "Riley Moss": 0.9},
    "BUF": {"DJ Moore": 0.53},
    "CHI": {"Cameron Lewis": 0.78},
    "PIT": {"Michael Pittman Jr.": 0.78},
    "NYG": {"Jalin Smith": 0.7, "Jordan Smith": 0.3},
}


def report(rows):
    df = pd.DataFrame([
        {"team": t, "week": 6, "full_name": n, "position": "CB", "report_status": "Out", "practice_status": None}
        for t, n in rows
    ])
    out = build_stats.compute_injury_report(df, list(SHARES), SHARES)
    return {(t, p["full_name"]): p["snap_share"] for t, weeks in out.items() for p in weeks.get("6", [])}


class InjuryNameMatch(unittest.TestCase):
    def test_spelling_differences_still_find_the_snap_share(self):
        got = report([
            ("DEN", "Pat Surtain II"),
            ("BUF", "D.J. Moore"),
            ("CHI", "Cam Lewis"),
            ("PIT", "Michael Pittman"),
            ("DEN", "Riley Moss"),
        ])
        self.assertEqual(got[("DEN", "Pat Surtain II")], 0.86)
        self.assertEqual(got[("BUF", "D.J. Moore")], 0.53)
        self.assertEqual(got[("CHI", "Cam Lewis")], 0.78)
        self.assertEqual(got[("PIT", "Michael Pittman")], 0.78)
        self.assertEqual(got[("DEN", "Riley Moss")], 0.9)

    def test_never_guesses_between_two_players(self):
        # Two J. Smiths on the team: "Jay Smith" could be either, so no share.
        got = report([("NYG", "Jay Smith"), ("DEN", "Pat Moss")])
        self.assertIsNone(got[("NYG", "Jay Smith")])
        # Same last name, different first initial: a different player.
        self.assertIsNone(got[("DEN", "Pat Moss")])


if __name__ == "__main__":
    unittest.main()
