"""The Prop Research Reads, frozen at tip (nfl_tool/nba/reads_record.py, 2026-11-05).

The owner: "lock the info that comprises those boxes before that game is played ... then i get up
on tuesday and go back i just see the info that was relevant to prior to last nights game". Pinned:
a game's Reads are rewritten only until it tips; a tipped or final game keeps what it had; a game
not on the schedule is never added; the file round-trips one game a line."""
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))

import reads_record  # noqa: E402

NOW = datetime(2026, 11, 5, 20, 0)  # 3 pm Eastern
GAMES = [{"game_id": "1", "start_utc": "2026-11-06T00:00Z", "status": "scheduled"},  # tonight, not tipped
         {"game_id": "2", "start_utc": "2026-11-05T19:00Z", "status": "in"},  # tipped an hour ago
         {"game_id": "3", "start_utc": "2026-11-04T23:30Z", "status": "final"}]


def entry(o):
    return {"date": "2026-11-05", "tabs": {"points": ["Form"]}, "m": {"points": {"9": [o, 1, 4, 0.3, [[o, 1, 4, 0]]]}}}


class Merge(unittest.TestCase):
    def test_rewritten_until_tip_never_after(self):
        record = {"2": entry(1), "3": entry(2)}
        changed = reads_record.merge(record, {"1": entry(3), "2": entry(4), "3": entry(4), "99": entry(4)}, GAMES, NOW)
        self.assertEqual(changed, 1)
        self.assertEqual(record["1"], entry(3))  # not tipped: saved
        self.assertEqual(record["2"], entry(1))  # tipped: keeps the Reads from before tip
        self.assertEqual(record["3"], entry(2))
        self.assertNotIn("99", record)  # not on the schedule
        self.assertEqual(reads_record.merge(record, {"1": entry(3)}, GAMES, NOW), 0)  # nothing new
        self.assertEqual(reads_record.merge(record, {"1": entry(5)}, GAMES, NOW), 1)  # a later build before tip wins

    def test_no_start_time_is_never_rewritten(self):
        record = {}
        self.assertEqual(reads_record.merge(record, {"4": entry(1)}, [{"game_id": "4", "status": "scheduled"}], NOW), 0)

    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            record = {"1": entry(3), "3": entry(2)}
            reads_record.save(record, 2027, Path(d))
            self.assertEqual(reads_record.load(2027, Path(d)), record)
            self.assertEqual(len((Path(d) / "2027.json").read_text(encoding="utf-8").splitlines()), 4)  # braces + a game a line
            self.assertEqual(reads_record.load(2099, Path(d)), {})


if __name__ == "__main__":
    unittest.main()
