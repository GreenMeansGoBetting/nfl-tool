"""Novig team codes (build_stats._novig_team).

Nov 2026: Novig's `symbol` for the Chargers became "LA" (our Rams code). The
build keyed LAC @ BAL as LA @ BAL, didn't recognize it, and dropped every
Chargers-game prop line (Player Props / Props Summary showed nothing for MNF).
Teams are now read by Novig's competitor id (from the game header), then full
name, then short_name / symbol."""
import unittest
from unittest import mock

from helpers import novig_event  # noqa: F401  (puts nfl_tool/ on the import path)

import build_stats

LAC = {"id": "lac-id", "name": "Los Angeles Chargers", "symbol": "LA", "short_name": "LAC"}
BAL = {"id": "bal-id", "name": "Baltimore Ravens", "symbol": "BAL", "short_name": "BAL"}
WAS = {"id": "was-id", "name": "Washington Commanders", "symbol": "WAS", "short_name": "WSH"}


def fake_feed(away, home, markets):
    def request(url, body=None):
        if body is None:
            return {"items": [{"eventId": "e1", "startsTs": 1763342100000}]}
        return {"data": {"event": [{"game": {"awayTeam": away, "homeTeam": home}, "markets": markets}]}}
    return request


class NovigTeamCodes(unittest.TestCase):
    def setUp(self):
        build_stats._NOVIG_TEAM_IDS.clear()

    def fetch(self, away, home, wanted, markets=()):
        with mock.patch.object(build_stats, "_novig_request", fake_feed(away, home, list(markets))):
            return build_stats.fetch_novig_week(wanted, "2025-11-16T00:00:00+00:00", "2025-11-18T00:00:00+00:00")

    def test_chargers_labeled_la_still_match_their_game(self):
        games, debug = self.fetch(LAC, BAL, [{"away": "LAC", "home": "BAL"}])
        self.assertIn(("LAC", "BAL"), games)
        self.assertEqual(debug["games"], ["LAC@BAL:0"])

    def test_washington_short_name_maps_to_was(self):
        games, _ = self.fetch(WAS, BAL, [{"away": "WAS", "home": "BAL"}])
        self.assertIn(("WAS", "BAL"), games)

    def test_chargers_player_and_game_lines_land_on_lac(self):
        spread = {"type": "SPREAD", "is_consensus": True, "outcomes": [
            {"competitor": {"id": "lac-id", "symbol": "LA"}, "description": "LAC +4.5", "available": 0.5},
            {"competitor": {"id": "bal-id", "symbol": "BAL"}, "description": "BAL -4.5", "available": 0.5},
        ]}
        games, _ = self.fetch(LAC, BAL, [{"away": "LAC", "home": "BAL"}], [spread])
        player_market = {"player": {"player_competitors": [{"competitor": {"id": "x", "name": "Los Angeles Chargers", "symbol": "LA"}}]}}
        self.assertEqual(build_stats._novig_player_team(player_market), "LAC")
        lines = build_stats.extract_novig_game_lines(games)["LAC_BAL"]
        self.assertEqual(lines["away_team_spread"], 4.5)
        self.assertEqual(lines["home_team_spread"], -4.5)


if __name__ == "__main__":
    unittest.main()
