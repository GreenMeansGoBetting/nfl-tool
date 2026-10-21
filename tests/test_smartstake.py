"""SmartStake book odds (nfl_tool/smartstake.py): how the API's quotes become
data.json `book_odds`.

What is pinned: only US books are kept; one player is one row however each
book spells him (grouped by the API's player_id, the site's spelling wins);
Anytime TD keeps only the 0.5 line; spread / moneyline sides are away / home;
a started game keeps the previous build's pregame copy or shows nothing (odds
lock at kickoff); and no key or a failed fetch never breaks the build.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "nfl_tool"))
import smartstake  # noqa: E402

GAME = {"event_id": "evt_1", "away": "Cincinnati Bengals", "home": "pittsburgh steelers", "starts_at": "2026-10-18T17:00:00Z"}


def quote(book, market, side, line, odds, participant=None, player_id=None, **extra):
    return {**GAME, "book": book, "market_key": market, "side": side, "line": line, "odds": odds,
            "participant": participant, "player_id": player_id, "bet_url": f"https://{book}.test/x",
            "alternate": False, "live": False, **extra}


class BookOdds(unittest.TestCase):
    def test_one_player_across_spellings_and_us_books_only(self):
        quotes = [
            quote("fanduel", "football_player_receptions", "over", 6.5, 105, "CHASE, JA'MARR", 7),
            quote("draftkings", "football_player_receptions", "over", 6.5, -110, "Ja'Marr Chase", 7),
            quote("pinnacle", "football_player_receptions", "under", 6.5, -108, "JA'MARR CHASE", 7),
        ]
        quotes = [q for q in quotes if q["book"] in smartstake.US_BOOKS] + [quote("bet99", "football_player_receptions", "over", 6.5, 120, "Ja'Marr Chase", 7)]
        games = smartstake.build_book_odds([q for q in quotes if q["book"] in smartstake.US_BOOKS], smartstake.NFL_TEAMS, ["Ja'Marr Chase"])
        row = games["CIN_PIT"]["props"]["receiving_receptions"]["jamarrchase"]
        self.assertEqual(row["name"], "Ja'Marr Chase")
        self.assertEqual(sorted(q[0] for q in row["q"]), ["draftkings", "fanduel", "pinnacle"])
        self.assertIn(["fanduel", "o", 6.5, 105, "https://fanduel.test/x"], row["q"])
        self.assertNotIn("bet99", smartstake.US_BOOKS)

    def test_anytime_td_is_the_half_point_line_only(self):
        games = smartstake.build_book_odds([
            quote("fanduel", "football_player_touchdowns", "over", 0.5, 150, "Chase Brown", 9),
            quote("fanduel", "football_player_touchdowns", "over", 1.5, 900, "Chase Brown", 9),
        ], smartstake.NFL_TEAMS)
        self.assertEqual(games["CIN_PIT"]["td"]["chasebrown"]["q"], [["fanduel", "o", 0.5, 150, "https://fanduel.test/x"]])

    def test_game_lines_use_away_and_home(self):
        games = smartstake.build_book_odds([
            quote("betmgm", "football_moneyline", "awayteam", None, 140),
            quote("betmgm", "football_points_handicap", "hometeam", -3.5, -105),
            quote("betmgm", "football_points", "under", 44.5, -110),
        ], smartstake.NFL_TEAMS)
        lines = games["CIN_PIT"]["lines"]
        self.assertEqual(lines["ml"][0][:4], ["betmgm", "away", None, 140])
        self.assertEqual(lines["spread"][0][:4], ["betmgm", "home", -3.5, -105])
        self.assertEqual(lines["total"][0][:4], ["betmgm", "u", 44.5, -110])

    def test_started_game_keeps_its_pregame_copy_or_nothing(self):
        before = {"CIN_PIT": {"kickoff": "2026-10-18T17:00:00Z", "props": {"x": 1}, "td": {}, "lines": {}}}
        fresh = {"CIN_PIT": {"kickoff": "2026-10-18T17:00:00Z", "props": {"x": 2}, "td": {}, "lines": {}},
                 "BUF_MIA": {"kickoff": "2026-10-18T20:00:00Z", "props": {}, "td": {}, "lines": {}}}
        after_kickoff = "2026-10-18T18:00:00Z"
        locked = smartstake.lock_started(fresh, before, after_kickoff)
        self.assertEqual(locked["CIN_PIT"]["props"], {"x": 1})
        self.assertIn("BUF_MIA", locked)
        self.assertNotIn("CIN_PIT", smartstake.lock_started(fresh, None, after_kickoff))

    def test_no_key_or_failure_never_breaks_the_build(self):
        odds, debug = smartstake.fetch_nfl_book_odds(None, [], None, "2026-10-18T00:00:00Z")
        self.assertEqual(odds, {})
        self.assertIn("skipped", debug)
        original = smartstake.fetch_quotes
        smartstake.fetch_quotes = lambda *a, **k: (_ for _ in ()).throw(OSError("boom"))
        try:
            odds, debug = smartstake.fetch_nfl_book_odds("key", [], None, "2026-10-18T00:00:00Z")
        finally:
            smartstake.fetch_quotes = original
        self.assertEqual(odds, {})
        self.assertIn("boom", debug["error"])


if __name__ == "__main__":
    unittest.main()


class FirstBasket(unittest.TestCase):
    """NBA First Basket (the owner, 2026-10-21: SmartStake added the first points market)."""

    def test_the_first_points_scorer_market_is_found_not_quarters_teams_or_field_goals(self):
        listed = [{"key": "basketball_first_points_scorer", "name": "1st Points Scorer"},
                  {"key": "basketball_first_team_to_score", "name": "First Team to Score"},
                  {"key": "basketball_first_field_goal", "name": "First Field Goal Scorer"},
                  {"key": "basketball_1q_first_basket", "name": "1st Quarter First Basket"},
                  {"key": "basketball_player_points", "name": "Player Points"}]
        self.assertEqual(smartstake.first_basket_market_keys(listed), ["basketball_first_points_scorer"])
        self.assertEqual(smartstake.first_basket_market_keys([]), [])

    def test_yes_prices_are_kept_by_player(self):
        game = {"event_id": "evt_9", "away": "Milwaukee Bucks", "home": "Washington Wizards", "starts_at": "2026-10-21T23:00:00Z"}
        q = lambda book, side, odds: {**game, "book": book, "market_key": "basketball_first_points_scorer", "side": side, "line": None,
                                       "odds": odds, "participant": "Myles Turner", "player_id": 5, "bet_url": "", "alternate": False, "live": False}
        teams = {"milwaukee bucks": "MIL", "washington wizards": "WSH"}
        found = smartstake.build_book_odds([q("draftkings", "yes", 900), q("fanduel", "yes", 1000), q("fanduel", "no", -2000)], teams,
                                           prop_markets={"basketball_first_points_scorer": "first_basket"}, td_market=None, line_markets={},
                                           player_key=lambda name, away, home: "3032976", yes_markets={"basketball_first_points_scorer"})
        row = found["MIL_WSH"]["props"]["first_basket"]["3032976"]
        self.assertEqual(sorted((x[0], x[1], x[3]) for x in row["q"]), [("draftkings", "o", 900), ("fanduel", "o", 1000)])

    def test_the_sportsbooks_alternate_quotes_are_asked_for_and_kept(self):
        # The probe (2026-10-21): DraftKings, FanDuel and most books send 1st Points
        # Scorer as alternate quotes; asking for main lines only left just the exchanges.
        asked = []
        page = {"data": [
            {"book": "draftkings", "alternate": True, "live": False, "side": "yes"},
            {"book": "novig", "alternate": False, "live": False, "side": "yes"},
            {"book": "bet99", "alternate": True, "live": False, "side": "yes"},  # not a US book
        ]}
        old = smartstake._get
        smartstake._get = lambda key, path, params: asked.append(params) or page
        try:
            got = smartstake.fetch_quotes("k", "nba", ["basketball_first_points_scorer"], alternate=True)
            self.assertEqual([q["book"] for q in got], ["draftkings", "novig"])
            self.assertIsNone(asked[-1]["alternate"])  # not "false": the alternate quotes come back
            main = smartstake.fetch_quotes("k", "nba", ["basketball_player_points"])
            self.assertEqual([q["book"] for q in main], ["novig"])  # every other market: main lines only
            self.assertEqual(asked[-1]["alternate"], "false")
        finally:
            smartstake._get = old

