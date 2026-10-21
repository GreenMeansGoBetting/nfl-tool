"""NHL Line Matchups: the 5-on-5 counting (nfl_tool/nhl/lines_model.py) and its
half of the build (build_nhl.lines_file), on the saved game with its shift
chart and hand-made ones.

What is pinned: a game's 5-on-5 seconds, attempts and goals add up the same
for the team, its trios and its pairs, and mirror the other team; trio
against trio seconds add up to the 5-on-5 time; a goal at the very end of a
shift belongs to the players it ended (not the ones coming on); no shift
chart = nothing; a unit's season and last-three-games numbers; usual lines
come from the latest game's players (no one in two lines); the home coach's
habit against each of the other team's lines, with mixed groups apart;
earlier meetings; the file uses a posted lineup's lines in its order, keeps a
started game as it was before puck drop, and leaves out games past the
Shots page's days."""
import unittest
from datetime import datetime

import helpers  # first: puts nfl_tool/nhl on the import path

import build_nhl
import lines_model as lm


def saved_game():
    raw = helpers.nhl_game()
    raw["shifts"] = helpers.nhl_game_shifts()
    return raw


def tiny_game(goal_at="01:00"):
    """Two teams of 3 F + 2 D + G, all on from 0:00 to 1:00; then the home
    forwards change for three new ones until 2:00. One home goal at `goal_at`."""
    def stats(base):
        return {"forwards": [{"playerId": base + i} for i in range(6)], "defense": [{"playerId": base + 10 + i} for i in range(2)], "goalies": [{"playerId": base + 20}]}

    shifts = []
    for base, team in ((100, "HOM"), (200, "AWY")):
        for pid in [base + 10, base + 11, base + 20]:
            shifts.append([pid, team, 1, "00:00", "02:00"])
        if base == 100:
            shifts += [[base + i, team, 1, "00:00", "01:00"] for i in range(3)] + [[base + i, team, 1, "01:00", "02:00"] for i in range(3, 6)]
        else:
            shifts += [[base + i, team, 1, "00:00", "02:00"] for i in range(3)]
    plays = [
        {"typeDescKey": "goal", "periodDescriptor": {"number": 1, "periodType": "REG"}, "timeInPeriod": goal_at, "details": {"eventOwnerTeamId": 1}},
        {"typeDescKey": "shot-on-goal", "periodDescriptor": {"number": 1, "periodType": "REG"}, "timeInPeriod": "01:30", "details": {"eventOwnerTeamId": 2}},
    ]
    return {
        "shifts": shifts,
        "pbp": {"homeTeam": {"id": 1, "abbrev": "HOM"}, "awayTeam": {"id": 2, "abbrev": "AWY"}, "plays": plays},
        "box": {"homeTeam": {"abbrev": "HOM"}, "awayTeam": {"abbrev": "AWY"}, "playerByGameStats": {"homeTeam": stats(100), "awayTeam": stats(200)}},
    }


FIRST = lm.unit_key(["100", "101", "102"])
SECOND = lm.unit_key(["103", "104", "105"])
AWAY_LINE = lm.unit_key(["200", "201", "202"])


class GameUnits(unittest.TestCase):
    def test_no_shift_chart_is_nothing(self):
        self.assertIsNone(lm.game_units(helpers.nhl_game()))

    def test_the_saved_game_adds_up(self):
        units = lm.game_units(saved_game())
        home, away = units["home"], units["away"]
        self.assertEqual((away, home), ("FLA", "BUF"))
        h, a = units[home]["team"], units[away]["team"]
        self.assertEqual(h[0], a[0])  # the same 5-on-5 seconds
        self.assertGreater(h[0], 30 * 60)
        self.assertEqual((h[1], h[2], h[3], h[4]), (a[2], a[1], a[4], a[3]))  # one team's for is the other's against
        for team in (home, away):
            for kind, size in (("F", 3), ("D", 2)):
                rows = units[team][kind]
                self.assertTrue(all(len(k.split("-")) == size for k in rows))
                for i in range(5):
                    self.assertEqual(sum(r[i] for r in rows.values()), units[team]["team"][i], (team, kind, i))
        self.assertEqual(sum(s for _, _, s in units["vs"]), h[0])
        self.assertLessEqual(h[3] + h[4], 7)  # 5-on-5 goals are some of the game's goals

    def test_a_goal_belongs_to_the_shift_it_ended(self):
        units = lm.game_units(tiny_game("01:00"))
        self.assertEqual(units["HOM"]["F"][FIRST], [60, 1, 0, 1, 0])
        self.assertEqual(units["HOM"]["F"][SECOND], [60, 0, 1, 0, 0])
        self.assertEqual(units["AWY"]["team"], [120, 1, 1, 0, 1])
        self.assertEqual(sorted(units["vs"]), sorted([[FIRST, AWAY_LINE, 60], [SECOND, AWAY_LINE, 60]]))
        # One second later it is the new line's goal.
        later = lm.game_units(tiny_game("01:01"))
        self.assertEqual(later["HOM"]["F"][SECOND][3], 1)
        self.assertEqual(later["HOM"]["F"][FIRST][3], 0)

    def test_reduce_game_keeps_it(self):
        self.assertEqual(build_nhl.reduce_game(saved_game())["lines5"], lm.game_units(saved_game()))
        self.assertIsNone(build_nhl.reduce_game(helpers.nhl_game())["lines5"])


def record(gid, date, home, away, home_units, away_units, vs):
    """A hand-made reduced game: units as {key: [secs, cf, ca, gf, ga]}."""
    def team(units):
        f = {k: v for k, v in units.items() if len(k.split("-")) == 3}
        d = {k: v for k, v in units.items() if len(k.split("-")) == 2}
        total = [sum(v[i] for v in f.values()) for i in range(5)]
        return {"team": total, "F": f, "D": d}
    return {"id": gid, "date": date, "lines5": {"home": home, "away": away, home: team(home_units), away: team(away_units), "vs": vs}}


def trio(*ids):
    return lm.unit_key(ids)


class History(unittest.TestCase):
    def setUp(self):
        self.history = lm.LinesHistory()
        a1, a2, a3 = trio("a1", "a2", "a3"), trio("a4", "a5", "a6"), trio("a7", "a8", "a9")
        b1, b2 = trio("b1", "b2", "b3"), trio("b4", "b5", "b6")
        for i, date in enumerate(["2026-10-10", "2026-10-12", "2026-10-14", "2026-10-16"]):
            # AAA at home: its line 2 (a4-a6) takes BBB's top line, its line 1 the rest.
            self.history.add_game(record(i, date, "AAA", "BBB",
                                         {a1: [700, 10, 5, 1, 0], a2: [500, 4, 6, 0, 1], a3: [50, 1, 1, 0, 0]},
                                         {b1: [800, 9, 9, 1, 1], b2: [500, 3, 4, 0, 0]},
                                         [[a2, b1, 450], [a1, b1, 200], [a3, b1, 150], [a1, b2, 500]]))
        self.a1, self.a2, self.b1 = a1, a2, b1

    def test_a_unit_season_and_last_three(self):
        u = self.history.unit("AAA", "F", ["a3", "a1", "a2"])
        self.assertEqual((u["gp"], u["toi"], u["cf"], u["ca"], u["gf"], u["ga"]), (4, 2800, 40, 20, 4, 0))
        self.assertEqual((u["l3"]["gp"], u["l3"]["toi"]), (3, 2100))
        # Under a minute together in a game doesn't count as a game together.
        self.assertEqual(self.history.unit("AAA", "F", ["a7", "a8", "a9"])["gp"], 0)
        self.assertEqual(self.history.unit("AAA", "F", ["x", "y", "z"])["gp"], 0)

    def test_usual_lines_no_one_twice(self):
        usual = self.history.usual("AAA")
        self.assertEqual([sorted(ids) for ids in usual["F"]], [["a1", "a2", "a3"], ["a4", "a5", "a6"], ["a7", "a8", "a9"]])
        flat = [p for ids in usual["F"] for p in ids]
        self.assertEqual(len(flat), len(set(flat)))

    def test_the_home_coach_habit(self):
        deploy = self.history.deploy("AAA", True)
        self.assertEqual(deploy["games"], 4)
        rows = lm.likely_matchups(deploy)
        top = rows[0]
        # Against BBB's top line (by its ice time), AAA's line 2 was out 450 of 800 seconds.
        self.assertEqual((top["their"], top["ours"], top["share"]), (1, 2, round(450 / 800, 3)))
        self.assertEqual((rows[1]["their"], rows[1]["ours"], rows[1]["share"]), (2, 1, 1.0))
        self.assertEqual(self.history.deploy("AAA", False), {"games": 0, "rows": []})
        self.assertEqual(lm.likely_matchups({"games": 0, "rows": []}), [])

    def test_mixed_groups_stay_apart(self):
        rows = lm.likely_matchups({"games": 1, "rows": [[1, 0, 300], [1, 2, 200], [1, 1, 100]]})
        self.assertEqual(rows, [{"their": 1, "ours": 2, "share": round(200 / 600, 3), "mixed": 0.5, "secs": 600}])

    def test_meetings(self):
        met = self.history.meetings("BBB", "AAA")
        self.assertEqual(met["games"], 4)
        self.assertEqual(met["vs"][(self.b1, self.a2)], 4 * 450)  # BBB's own trio first
        self.assertEqual(self.history.meetings("AAA", "CCC"), {"games": 0, "vs": {}})


class File(unittest.TestCase):
    def game(self, gid="9", status="scheduled", start="2026-10-20T23:00Z", date="2026-10-20"):
        return {"game_id": gid, "away": "BBB", "home": "AAA", "status": status, "start_utc": start, "date": date}

    def setUp(self):
        self.records = []
        for i, date in enumerate(["2026-10-10", "2026-10-12"]):
            self.records.append(record(i, date, "AAA", "BBB",
                                       {trio("a1", "a2", "a3"): [700, 10, 5, 1, 0], trio("a4", "a5", "a6"): [600, 2, 8, 0, 1], "d1-d2": [900, 9, 9, 1, 1]},
                                       {trio("b1", "b2", "b3"): [800, 9, 9, 1, 1], trio("b4", "b5", "b6"): [500, 3, 4, 0, 0]},
                                       [[trio("a4", "a5", "a6"), trio("b1", "b2", "b3"), 600], [trio("a1", "a2", "a3"), trio("b1", "b2", "b3"), 200], [trio("a1", "a2", "a3"), trio("b4", "b5", "b6"), 500]]))
        self.skaters = {p: {"name": f"Player {p}", "pos": "D" if p[1] == "d" else "C", "headshot": None} for p in ["a1", "a2", "a3", "a4", "a5", "a6", "b1", "b2", "b3"]}
        self.now = datetime(2026, 10, 20, 16, 0)

    def test_usual_lines_until_the_lineup_is_posted(self):
        out = build_nhl.lines_file(2027, "x", self.records, [self.game()], {}, self.skaters, None, self.now)
        g = out["games"]["9"]
        self.assertEqual(out["rules"], build_nhl.LINES_RULES)
        self.assertEqual(g["teams"]["AAA"]["source"], "usual")
        self.assertEqual([u["slot"] for u in g["teams"]["AAA"]["lines"]], ["F1", "F2"])
        self.assertEqual(g["players"]["a1"][0], "Player a1")
        self.assertEqual(g["matchups"]["rows"][0]["ours"], 2)  # AAA's 2nd line on BBB's top line
        self.assertEqual(g["meetings"]["games"], 2)
        self.assertEqual(g["meetings"]["rows"][0][2], 1200)
        self.assertEqual(len(g["meetings"]["rows"]), 3)

    def test_a_posted_lineup_in_its_order(self):
        posted = {"9": {"posted": "2026-10-20T16:00Z", "AAA": {"skaters": {"a4": "F1", "a5": "F1", "a6": "F1", "a1": "F2", "a2": "F2", "zz": "F2", "a3": None}}}}
        g = build_nhl.lines_file(2027, "x", self.records, [self.game()], posted, self.skaters, None, self.now)["games"]["9"]
        lines = g["teams"]["AAA"]["lines"]
        self.assertEqual(g["teams"]["AAA"]["source"], "posted")
        self.assertEqual([(u["slot"], u["ids"]) for u in lines], [("F1", ["a4", "a5", "a6"]), ("F2", ["a1", "a2", "zz"])])
        self.assertEqual(lines[0]["toi"], 1200)
        self.assertEqual((lines[1]["gp"], lines[1]["l3"]["gp"]), (0, 0))  # never together
        self.assertEqual(g["teams"]["BBB"]["source"], "usual")

    def test_a_started_game_keeps_what_it_said(self):
        kept = {"games": {"9": {"locked": False, "teams": {"AAA": "before"}}}}
        out = build_nhl.lines_file(2027, "x", self.records, [self.game(start="2026-10-20T15:00Z")], {}, self.skaters, kept, self.now)
        self.assertEqual(out["games"]["9"], {"locked": True, "teams": {"AAA": "before"}})
        self.assertEqual(build_nhl.lines_file(2027, "x", self.records, [self.game(status="final")], {}, self.skaters, None, self.now)["games"], {})

    def test_only_the_shots_page_days(self):
        far = self.game(gid="10", start="2026-10-30T23:00Z", date="2026-10-30")
        self.assertEqual(list(build_nhl.lines_file(2027, "x", self.records, [self.game(), far], {}, self.skaters, None, self.now)["games"]), ["9"])


if __name__ == "__main__":
    unittest.main()
