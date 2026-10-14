"""SmartStake book odds on the NHL pages (nfl_tool/smartstake.py,
fetch_nhl_book_odds; the Shots and Goals open rows' right column).

What is pinned: shots on goal and goals become rows keyed by the NHL's own
player id (found on either team in the game), a player the site doesn't list
is left out, only the games on the site's schedule are kept, and no key never
breaks the hockey build.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "nfl_tool"))
import smartstake  # noqa: E402

TEAMS = {"montreal canadiens": "MTL", "washington capitals": "WSH", "dallas stars": "DAL", "colorado avalanche": "COL"}


def quote(market, side, line, odds, participant, player_id, away="Montreal Canadiens", home="Washington Capitals", book="fanduel"):
    return {"event_id": f"{away}{home}", "away": away, "home": home, "starts_at": "2026-10-14T23:00:00Z", "book": book,
            "market_key": market, "side": side, "line": line, "odds": odds, "participant": participant,
            "player_id": player_id, "bet_url": "https://x.test/", "alternate": False, "live": False}


class NhlBookOdds(unittest.TestCase):
    def build(self, quotes, keep=None):
        # Like the build's player_finder: capitals don't matter.
        ids = {("WSH", "tom wilson"): 8476880, ("MTL", "nick suzuki"): 8480018}
        original = smartstake.fetch_quotes
        smartstake.fetch_quotes = lambda *a, **k: quotes
        try:
            return smartstake.fetch_nhl_book_odds(
                "key", lambda full: TEAMS.get((full or "").lower()),
                lambda name, away, home: ids.get((away, name.lower())) or ids.get((home, name.lower())),
                None, "2026-10-14T12:00:00Z", keep=keep)
        finally:
            smartstake.fetch_quotes = original

    def test_rows_are_keyed_by_the_nhl_player_id(self):
        odds, debug = self.build([
            quote("hockey_player_shots_on_goal", "over", 2.5, -130, "Tom Wilson", 1),
            quote("hockey_player_goals", "over", 0.5, 217, "SUZUKI, NICK", 2),
            quote("hockey_player_goals", "over", 0.5, 400, "Somebody New", 3),
        ])
        game = odds["MTL_WSH"]["props"]
        self.assertEqual(game["sog"]["8476880"]["q"][0][:4], ["fanduel", "o", 2.5, -130])
        self.assertIn("8480018", game["goals"])
        self.assertEqual(len(game["goals"]), 1)  # the player the site doesn't list is left out
        self.assertEqual(debug["games"], 1)

    def test_only_the_schedules_games_are_kept(self):
        odds, _ = self.build([
            quote("hockey_player_shots_on_goal", "over", 2.5, -130, "Tom Wilson", 1),
            quote("hockey_player_shots_on_goal", "over", 2.5, -110, "Tom Wilson", 1, away="Dallas Stars", home="Colorado Avalanche"),
        ], keep={"MTL_WSH"})
        self.assertEqual(list(odds), ["MTL_WSH"])

    def test_no_key_never_breaks_the_build(self):
        odds, debug = smartstake.fetch_nhl_book_odds(None, TEAMS.get, lambda *a: None, None, "2026-10-14T12:00:00Z")
        self.assertEqual((odds, list(debug)), ({}, ["skipped"]))


if __name__ == "__main__":
    unittest.main()
