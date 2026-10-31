"""King of the Hat Trick's build (build_nhl.py: big_games, hattrick_players / _teams /
_goalies / _days / _file), on hand-made games.

What is pinned: a 2+ goal game counts every goal (empty-net ones too: the promo counts
them) and charges a goalie only for goals scored on him; a player's 2G / HT / last-10
counts; a team's 2G / HT for and against and its 5+ goal games; a goalie's 2G / HT
allowed; the board copies the Goals page's players without prices and leaves outs off;
the league's hat trick days. No price anywhere in the file (the owner, 2026-10-31)."""
import json
import unittest

from helpers import nhl_game  # noqa: F401  first: puts nfl_tool/nhl on the import path

import build_nhl as b


def skater(team, g, name="P", pp_toi=60):
    return {"team": team, "name": name, "g": g, "sog": g + 2, "att": g + 4, "hd": g, "toi": 1000, "pp_toi": pp_toi}


def game(gid, date, home, away, hg, ag, skaters, shots=(), goalies=None, pp=()):
    return {
        "id": gid, "date": date, "home": home, "away": away,
        "teams": {home: {"g": hg}, away: {"g": ag}},
        "skaters": skaters, "goalies": goalies or {},
        "shots": [{"shooter": s, "goalie": gl, "goal": True} for s, gl in shots],
        "goal_events": [{"scorer": s, "pp": True} for s in pp],
    }


RECORDS = [
    # 1 (BOS) scores 3 on BOS's home ice vs NYR: 2 on goalie 30, one into an empty net.
    game(1, "2026-10-10", "BOS", "NYR", 5, 2,
         {"1": skater("BOS", 3, "Hat Man"), "2": skater("BOS", 2, "Two Man"), "3": skater("NYR", 1)},
         shots=[("1", "30"), ("1", "30"), ("2", "30"), ("2", "30"), ("3", "40")],
         goalies={"30": {"team": "NYR", "name": "Goalie Thirty", "start": True, "sa": 30, "ga": 4}, "40": {"team": "BOS", "name": "Goalie Forty", "start": True, "sa": 25, "ga": 1}},
         pp=["1"]),
    game(2, "2026-10-11", "NYR", "BOS", 1, 1,
         {"1": skater("BOS", 0, "Hat Man"), "3": skater("NYR", 1)},
         shots=[("3", "40")],
         goalies={"30": {"team": "NYR", "name": "Goalie Thirty", "start": True, "sa": 20, "ga": 1}, "40": {"team": "BOS", "name": "Goalie Forty", "start": True, "sa": 22, "ga": 1}}),
]


class HatTrick(unittest.TestCase):
    def test_big_games_count_every_goal_and_charge_the_goalie_only_his(self):
        big = b.big_games(RECORDS)
        self.assertEqual([(x["id"], x["g"], x["opp"]) for x in big], [("1", 3, "NYR"), ("2", 2, "NYR")])
        self.assertEqual(big[0]["vs"], {"30": 2})  # the third went into an empty net
        self.assertEqual(big[0]["pp"], 1)

    def test_player_team_and_goalie_counts(self):
        big = b.big_games(RECORDS)
        p = b.hattrick_players(RECORDS, {"1", "3"})
        self.assertEqual({k: p["1"][k] for k in ("gp", "g", "two", "three", "max", "pp_g", "l10", "l10_gp")},
                         {"gp": 2, "g": 3, "two": 1, "three": 1, "max": 3, "pp_g": 1, "l10": 3, "l10_gp": 2})
        self.assertNotIn("2", p)  # only the board's players
        t = b.hattrick_teams(RECORDS, big)
        self.assertEqual((t["BOS"]["two_for"], t["BOS"]["three_for"], t["BOS"]["five_for"]), (2, 1, 1))
        self.assertEqual((t["NYR"]["two_against"], t["NYR"]["three_against"], t["NYR"]["five_against"], t["NYR"]["ga"]), (2, 1, 1, 6))
        g = b.hattrick_goalies(RECORDS, big)
        self.assertEqual((g["30"]["two"], g["30"]["three"], g["30"]["starts"]), (2, 0, 2))
        self.assertEqual(g["40"]["two"], 0)

    def test_the_board_has_no_prices_and_no_outs(self):
        games = [{"game_id": "9", "date": "2026-10-12", "away": "NYR", "home": "BOS", "time": "19:00", "start_utc": "2026-10-12T23:00Z", "total_line": 6.5}]
        goals_games = {"9": {"locked": False, "players": [
            {"id": "1", "name": "Hat Man", "team": "BOS", "opp": "NYR", "home": True, "mean": 0.5, "goalie": "30", "odds": -110, "edge": 0.05, "chance": 0.4},
            {"id": "5", "name": "Hurt", "team": "BOS", "opp": "NYR", "home": True, "mean": 0.6, "out": True},
        ]}}
        f = b.hattrick_file(2027, "now", RECORDS, goals_games, games)
        day = f["days"]["2026-10-12"]
        self.assertEqual([r["id"] for r in day["players"]], ["1"])
        self.assertEqual(day["games"][0]["total"], 6.5)
        text = json.dumps(f)
        for word in ("odds", "edge", "chance", "fair", "price"):
            self.assertNotIn(f'"{word}"', text)
        self.assertEqual(f["league"], {"games": 2, "days": 2, "hat_days": 1, "hat_tricks": 1, "two_plus": 2, "skater_games": 5})


if __name__ == "__main__":
    unittest.main()
