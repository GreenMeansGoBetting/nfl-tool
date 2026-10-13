"""Odds lock at kickoff (build_stats.lock_started_game_odds).

Books keep quoting in-game lines, and the build once published them as the
pregame number (SF +3.5 / 46.5 became "SF -4.5, Under 56.5" mid-game). Once a
game has started, its odds must come from a copy known to be pregame."""
import copy
import unittest
from datetime import datetime
from unittest import mock

import helpers  # noqa: F401 -- first: puts nfl_tool/ on the import path

import build_stats

GID = "2026_05_AAA_HHH"
LATER = "2026_05_CCC_DDD"
IN_GAME = datetime(2026, 10, 11, 14, 30)  # Eastern; AAA @ HHH kicked off at 13:00
PREGAME = {
    "spread_line": 3.5, "away_team_spread": 3.5, "home_team_spread": -3.5, "away_spread_odds": -108, "home_spread_odds": -112,
    "total_line": 46.5, "over_odds": -110, "under_odds": -110, "away_moneyline": 160, "home_moneyline": -190,
    "away_ml_implied_prob": 0.37, "home_ml_implied_prob": 0.63,
}
LIVE = {
    "spread_line": -4.5, "away_team_spread": -4.5, "home_team_spread": 4.5, "away_spread_odds": -115, "home_spread_odds": -105,
    "total_line": 56.5, "over_odds": -120, "under_odds": 100, "away_moneyline": -245, "home_moneyline": 200,
    "away_ml_implied_prob": 0.69, "home_ml_implied_prob": 0.31,
}
PREGAME_NOVIG = {"home_team_spread": -3.5, "away_team_spread": 3.5, "total_line": 46.5, "home_moneyline": -185, "away_moneyline": 165}
LIVE_NOVIG = {"home_team_spread": 4.5, "away_team_spread": -4.5, "total_line": 56.5, "home_moneyline": 210, "away_moneyline": -250}


def schedule_game(odds, novig, gid=GID, away="AAA", home="HHH", time="13:00", week=5):
    return {"game_id": gid, "week": week, "away": away, "home": home, "date": "2026-10-11", "time": time, "status": "scheduled", "home_score": None, "away_score": None, **odds, "novig": dict(novig)}


def player_odds(tag):
    """Every per-player odds table, with rows marked pregame or live."""
    rows = lambda team: [{"name": f"{team} Player", "best_odds": 150, "tag": tag}]
    teams = ("AAA", "HHH", "CCC", "DDD")
    return {
        "player_td_odds": {t: rows(t) for t in teams},
        "player_first_td_odds": {t: rows(t) for t in teams},
        "player_prop_markets": {"receiving_yards": {t: rows(t) for t in teams}},
        "general_odds": {"AAA_HHH": [{"market": "Spread", "tag": tag}], "CCC_DDD": [{"market": "Spread", "tag": tag}]},
    }


def this_build():
    """What this run fetched: in-game numbers for AAA @ HHH, fresh pregame
    numbers for the 20:20 game."""
    return {"current_week": 5, "schedule": [schedule_game(LIVE, LIVE_NOVIG), schedule_game(LIVE, LIVE_NOVIG, LATER, "CCC", "DDD", "20:20")], **player_odds("live")}


def previous_build(generated_at, locked=()):
    return {"generated_at": generated_at, "lines_locked": list(locked), "schedule": [schedule_game(PREGAME, PREGAME_NOVIG), schedule_game(PREGAME, PREGAME_NOVIG, LATER, "CCC", "DDD", "20:20")], **player_odds("pregame")}


def lock(blob, previous, model_history=None):
    with mock.patch.object(build_stats, "eastern_now", return_value=IN_GAME):
        return build_stats.lock_started_game_odds(blob, previous, model_history or {})


def tags(rows):
    return {r["tag"] for r in rows}


class StartedGameKeepsItsStoredLine(unittest.TestCase):
    def assert_pregame(self, blob):
        g = blob["schedule"][0]
        self.assertEqual({k: g[k] for k in PREGAME}, PREGAME)
        self.assertEqual(g["novig"], PREGAME_NOVIG)
        for team in ("AAA", "HHH"):
            self.assertEqual(tags(blob["player_td_odds"][team]), {"pregame"})
            self.assertEqual(tags(blob["player_first_td_odds"][team]), {"pregame"})
            self.assertEqual(tags(blob["player_prop_markets"]["receiving_yards"][team]), {"pregame"})
        self.assertEqual(tags(blob["general_odds"]["AAA_HHH"]), {"pregame"})

    def test_from_a_build_made_before_kickoff(self):
        blob = this_build()
        locked = lock(blob, previous_build("2026-10-11T16:19Z"))  # kickoff is 17:00 UTC
        self.assertEqual(locked, [GID])
        self.assert_pregame(blob)

    def test_from_a_build_that_had_already_locked_it(self):
        blob = this_build()
        lock(blob, previous_build("2026-10-11T18:19Z", locked=[GID]))
        self.assert_pregame(blob)

    def test_a_game_that_has_not_started_keeps_this_runs_odds(self):
        blob = this_build()
        untouched = copy.deepcopy(blob["schedule"][1])
        lock(blob, previous_build("2026-10-11T16:19Z"))
        self.assertEqual(blob["schedule"][1], untouched)
        self.assertEqual(tags(blob["player_td_odds"]["CCC"]), {"live"})
        self.assertEqual(tags(blob["general_odds"]["CCC_DDD"]), {"live"})


class NoTrustedPregameCopy(unittest.TestCase):
    """The previous build was itself made after kickoff (or couldn't be read),
    so its numbers may be in-game too."""

    def assert_no_live_numbers(self, g):
        for key, value in LIVE.items():
            self.assertNotEqual(g.get(key), value, f"{key} still shows the in-game number")
        self.assertNotEqual(g.get("novig"), LIVE_NOVIG)

    def test_falls_back_to_the_line_the_model_locked(self):
        blob = this_build()
        locked = lock(blob, previous_build("2026-10-11T18:19Z"), {GID: {"spread": -3.5, "total": 46.5}})
        g = blob["schedule"][0]
        self.assertEqual(locked, [GID])
        self.assert_no_live_numbers(g)
        self.assertEqual((g["home_team_spread"], g["away_team_spread"], g["total_line"], g["spread_line"]), (-3.5, 3.5, 46.5, 3.5))
        self.assertIsNone(g["home_moneyline"])
        self.assertIsNone(g["away_moneyline"])

    def test_shows_no_line_when_nothing_pregame_is_known(self):
        for previous in (None, previous_build("2026-10-11T18:19Z")):
            blob = this_build()
            lock(blob, previous)
            g = blob["schedule"][0]
            self.assert_no_live_numbers(g)
            self.assertEqual({g[k] for k in PREGAME}, {None})
            self.assertNotIn("novig", g)


class EarlierWeeks(unittest.TestCase):
    def test_finished_weeks_are_listed_but_left_alone(self):
        blob = this_build()
        old = schedule_game(PREGAME, PREGAME_NOVIG, "2026_04_EEE_FFF", "EEE", "FFF", week=4)
        old.update(date="2026-10-04", status="final", home_score=24, away_score=17)
        blob["schedule"].insert(0, copy.deepcopy(old))
        locked = lock(blob, None)
        self.assertEqual(locked, ["2026_04_EEE_FFF", GID])
        self.assertEqual(blob["schedule"][0], old)


if __name__ == "__main__":
    unittest.main()
