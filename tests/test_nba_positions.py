"""NBA positions (nfl_tool/nba/positions.py): PG / SG / SF / PF / C from ESPN's
depth charts in place of the box scores' G / F / C (the owner, 2026-10-21:
"Guards are drastically different roles and its unacceptable to not have PG
vs SG established").

What is pinned: a player listed at several spots takes the one where he ranks
highest (a tie goes to the first of PG, SG, SF, PF, C); the saved table
covers every team; a box-score row takes the table's position, a player on no
depth chart is placed from his assists / rebounds a 36, and a roster file
(no stats) falls back to SG / SF / C."""
import json
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import positions  # noqa: E402


class Primary(unittest.TestCase):
    def test_the_highest_ranked_spot_wins(self):
        # Boston's chart, 2026-10-21: Pritchard 2nd at PG, 3rd at SG; Tatum 1st at SF, 2nd at PF.
        slots = {"PG": ["white", "pritchard"], "SG": ["george", "scheierman", "pritchard", "white"],
                 "SF": ["tatum", "hauser", "george"], "PF": ["walsh", "tatum"], "C": ["robinson"]}
        got = positions.primary(slots)
        self.assertEqual((got["pritchard"], got["white"], got["tatum"], got["george"], got["walsh"]), ("PG", "PG", "SF", "SG", "PF"))

    def test_a_tie_goes_to_the_first_position(self):
        self.assertEqual(positions.primary({"SF": ["a", "x"], "PF": ["b", "x"]})["x"], "SF")


class Saved(unittest.TestCase):
    def test_the_saved_table_has_every_team_in_five_positions(self):
        table = json.loads(positions.SAVED.read_text(encoding="utf-8"))
        self.assertGreater(len(table), 400)  # 30 teams' charts
        self.assertEqual(set(table.values()), set(positions.POSITIONS))


def box(rows):
    return pd.DataFrame([{"athlete_id": pid, "athlete_position_abbreviation": grp, "minutes": m, "assists": a, "rebounds": r}
                         for pid, grp, m, a, r in rows])


class Relabel(unittest.TestCase):
    def test_box_scores_take_the_table_then_a_guess(self):
        frame = box([
            (1, "G", 30, 2, 3),    # on a depth chart as a PG: the chart wins over his low assists
            (2, "G", 36, 7, 3),    # no chart, 7 assists a 36: PG
            (3, "G", 36, 2, 3),    # no chart, 2 assists a 36: SG
            (4, "F", 36, 2, 9),    # no chart, 9 rebounds a 36: PF
            (5, "F", 36, 2, 4),    # SF
            (6, "C", 20, 1, 8),    # C stays C
        ])
        out = positions.relabel(frame, {"1": "PG"})
        self.assertEqual(out["athlete_position_abbreviation"].tolist(), ["PG", "PG", "SG", "PF", "SF", "C"])
        self.assertEqual(frame["athlete_position_abbreviation"].tolist()[0], "G")  # the input isn't changed

    def test_rosters_without_stats_fall_back_to_sg_sf_c(self):
        rosters = pd.DataFrame([{"athlete_id": 1, "position_abbreviation": "G"}, {"athlete_id": 7, "position_abbreviation": "G"},
                                {"athlete_id": 8, "position_abbreviation": "F"}, {"athlete_id": 9, "position_abbreviation": "C"}])
        out = positions.relabel(rosters, {"1": "PG"}, pos_col="position_abbreviation")
        self.assertEqual(out["position_abbreviation"].tolist(), ["PG", "SG", "SF", "C"])


if __name__ == "__main__":
    unittest.main()
