"""The NHL saves model and the King of the Crease board (saves_model.py and
the crease_* functions in build_nhl.py), on hand-made games.

What is pinned: the spread adds up and averages what was projected; a line
and price turn back into the saves the book expects; the chance to lead the
day (ties count, a finished night counts as what he made); both sides of the
matchup move a projection and nothing from last season is in it; Novig's
saves lines are read even with no price on them; who is named as the starter;
the lineup reader's two fixes (a seventh defenseman on his own line is not a
goalie, and "A --B" is still a pair); Value changes only his own number; the
tags; the lock at puck drop; and the record."""
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from helpers import nhl_game  # first: puts the build's folders on the import path

import build_nhl
import saves_model

NOW = datetime(2026, 10, 13, 18, 0)


def game(game_id, date, home, away, shots, goalies):
    """A finished game as reduce_game returns it: shots on goal by team and each starter's line."""
    return {
        "id": game_id, "date": date, "home": home, "away": away, "score": {home: 3, away: 2}, "ended": "REG",
        "teams": {team: {"sog": n, "att": n * 2, "g": 2} for team, n in shots.items()},
        "skaters": {},
        "goalies": {pid: {"team": team, "name": name, "headshot": None, "toi": 3600, "sa": sa, "ga": ga, "start": True, "dec": "W", "hd_sa": 0, "hd_ga": 0, "areas": {}} for pid, (team, name, sa, ga) in goalies.items()},
    }


def season():
    """Four teams, six games: BUSY shoots a lot, LEAKY gives up a lot."""
    rows = []
    for n in range(3):
        rows.append(game(100 + n, f"2026-10-0{n + 1}", "BUSY", "LEAKY", {"BUSY": 38, "LEAKY": 24}, {"gb": ("BUSY", "Bo Busy", 24, 2), "gl": ("LEAKY", "Lee Leaky", 38, 3)}))
        rows.append(game(200 + n, f"2026-10-0{n + 1}", "CALM", "TIGHT", {"CALM": 22, "TIGHT": 24}, {"gc": ("CALM", "Cal Calm", 24, 2), "gt": ("TIGHT", "Ty Tight", 22, 2)}))
    return sorted(rows, key=lambda r: (r["date"], r["id"]))


def model_for(records):
    return build_nhl.saves_model_for(records)


def scheduled(game_id, date, away, home, start="2026-10-13T23:00Z", status="scheduled", **rest):
    return {"game_id": game_id, "date": date, "away": away, "home": home, "start_utc": start, "status": status, **rest}


class Spread(unittest.TestCase):
    def test_adds_to_one_and_averages_the_projection(self):
        for mean in (18.0, 24.4, 31.0):
            spread = saves_model.save_spread(mean)
            self.assertAlmostEqual(sum(spread), 1.0, places=6)
            self.assertAlmostEqual(sum(n * p for n, p in enumerate(spread)), mean, places=3)

    def test_some_starts_end_early(self):
        # A plain count around 26 almost never stops at 10; a starter does get pulled.
        self.assertGreater(sum(saves_model.save_spread(26.0)[:11]), 0.015)

    def test_a_line_and_price_turn_back_into_saves(self):
        for line, chance in ((24.5, 0.5), (27.5, 0.42), (21.5, 0.6)):
            mean = saves_model.mean_for_chance(line, chance)
            self.assertAlmostEqual(saves_model.chance_over(mean, line), chance, places=3)
        self.assertGreater(saves_model.mean_for_chance(27.5, 0.5), saves_model.mean_for_chance(24.5, 0.5))

    def test_more_expected_means_a_better_chance_at_a_big_night(self):
        self.assertGreater(saves_model.chance_at_least(28, 35), 2 * saves_model.chance_at_least(23, 35))


class LeadingTheDay(unittest.TestCase):
    def test_equal_goalies_share_it_and_ties_count_for_both(self):
        chances = saves_model.top_chances([24.0] * 4)
        self.assertTrue(all(abs(c - chances[0]) < 1e-9 for c in chances))
        self.assertGreater(sum(chances), 1.0)  # a tie is a win for each
        self.assertLess(sum(chances), 1.15)

    def test_the_bigger_projection_leads_more_often(self):
        low, high = saves_model.top_chances([22.0, 28.0])
        self.assertGreater(high, 0.7)
        self.assertLess(low, 0.3)

    def test_a_finished_night_is_the_bar_to_clear(self):
        done = saves_model.known_spread(40)
        chances = saves_model.lead_chances([done, saves_model.save_spread(24.0)])
        self.assertAlmostEqual(chances[1], saves_model.chance_at_least(24.0, 40), places=6)
        self.assertGreater(chances[0], 0.97)


class Projection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = model_for(season())

    def test_both_sides_of_the_matchup_move_it(self):
        base = self.model.project("CALM", "TIGHT", True, goalie="gc")["mean"]
        self.assertGreater(self.model.project("CALM", "BUSY", True, goalie="gc")["mean"], base)   # the other team shoots more
        self.assertGreater(self.model.project("LEAKY", "TIGHT", True, goalie="gl")["mean"], base)  # his own team gives up more

    def test_a_few_games_are_only_partly_believed(self):
        # LEAKY has allowed 38 a game; three games in, the model stops well short of that.
        proj = self.model.project("LEAKY", "BUSY", False, goalie="gl")
        self.assertLess(proj["shots"], 38)
        self.assertGreater(proj["shots"], self.model.per_game("sog"))

    def test_road_and_rest(self):
        home = self.model.project("CALM", "TIGHT", True)["mean"]
        self.assertGreater(self.model.project("CALM", "TIGHT", False)["mean"], home)
        self.assertGreater(self.model.project("CALM", "TIGHT", True, rest=1)["mean"], home)
        self.assertLess(self.model.project("CALM", "TIGHT", True, opp_rest=1)["mean"], home)

    def test_an_unknown_goalie_is_a_league_average_one(self):
        proj = self.model.project("CALM", "TIGHT", True, goalie="nobody")
        self.assertAlmostEqual(proj["sv"], proj["league_sv"])
        self.assertEqual(proj["lift"]["sv"], 1.0)

    def test_this_season_only(self):
        # The model takes games and nothing else: no prior to hand it.
        self.assertIsNone(saves_model.SavesModel().project("CALM", "TIGHT", True))
        self.assertNotIn("prior", saves_model.SavesModel.__init__.__code__.co_varnames)

    def test_it_reads_a_real_game(self):
        record = build_nhl.reduce_game(nhl_game())
        model = model_for([record])
        # Both starters were pulled in the saved game (7 and 9 saves): that is the whole "league" here.
        self.assertEqual(model.base(), 8.0)
        self.assertAlmostEqual(model.project(record["home"], record["away"], True)["mean"], 8.0, delta=1.0)


class NovigSaves(unittest.TestCase):
    TEAMS = {"Aces": "AAA", "Bears": "BBB"}

    def market(self, name, team, strike, over, under, main=True):
        return {"type": "SAVES", "strike": strike, "is_consensus": main, "player": {"full_name": name, "player_competitors": [{"competitor": {"name": team}}]},
                "outcomes": [{"description": f"Over {strike}", "available": over}, {"description": f"Under {strike}", "available": under}]}

    def read(self, markets, find=lambda team, name: {"Al Net": "g1"}.get(name)):
        return build_nhl.saves_lines_from_event({"markets": markets}, self.TEAMS.get, find)

    def test_main_line_prices_and_the_other_lines(self):
        rows = self.read([self.market("Al Net", "Aces", 26.5, 0.48, 0.56), self.market("Al Net", "Aces", 28.5, 0.36, None, main=False), self.market("Al Net", "Aces", 22.5, None, 0.4, main=False)])
        row = rows["AAA"][0]
        self.assertEqual((row["id"], row["line"], row["over"], row["under"], row["thin"]), ("g1", 26.5, 108, -127, False))
        self.assertAlmostEqual(row["chance"], 0.48 / 1.04, places=3)
        self.assertEqual(row["alts"], [[28.5, 178]])  # overs only

    def test_a_line_with_no_price_is_kept_at_even(self):
        row = self.read([self.market("Bo Mask", "Bears", 24.5, None, None)])["BBB"][0]
        self.assertEqual((row["id"], row["line"], row["over"], row["under"], row["chance"], row["thin"]), (None, 24.5, None, None, 0.5, True))

    def test_one_price_and_junk_prices(self):
        self.assertAlmostEqual(build_nhl.saves_over_chance(0.42, None), 0.4)
        self.assertAlmostEqual(build_nhl.saves_over_chance(None, 0.63), 0.4)
        self.assertEqual(build_nhl.saves_over_chance(0.999, 0.999), 0.5)
        self.assertEqual(build_nhl.saves_over_chance(0.9, None), 0.65)  # a thin ask can only pull so far

    def test_only_goalies_with_a_main_line_and_a_team(self):
        rows = self.read([self.market("Al Net", "Aces", 28.5, 0.4, None, main=False), self.market("Cy Else", "Nobody", 25.5, 0.5, 0.5)])
        self.assertEqual(rows, {})


class LineupReader(unittest.TestCase):
    POSITIONS = {"f1": "C", "f2": "L", "f3": "R", "d1": "D", "d2": "D", "d7": "D"}
    IDS = {"F One": "f1", "F Two": "f2", "F Three": "f3", "D One": "d1", "D Two": "d2", "Seventh Dman": "d7", "Star Goalie": "g1"}

    def slots(self, text):
        lineup = build_nhl.parse_lineups(text)["Aces"]
        return lineup, build_nhl.lineup_slots(lineup, "AAA", lambda team, name: self.IDS.get(name), self.POSITIONS)

    def test_a_seventh_defenseman_on_his_own_line_is_not_the_goalie(self):
        _, out = self.slots("**Aces projected lineup**\nF One -- F Two -- F Three\nD One -- D Two\nSeventh Dman\nStar Goalie\nBackup Goalie\n**Scratched:** None")
        self.assertEqual(out["goalie"], "g1")
        self.assertIn("d7", out["skaters"])      # dressed...
        self.assertIsNone(out["skaters"]["d7"])  # ...with no pair to read
        self.assertEqual(out["skaters"]["d1"], "D1")

    def test_a_lone_skater_nobody_knows_yet_still_isnt_the_goalie(self):
        _, out = self.slots("**Aces projected lineup**\nF One -- F Two -- F Three\nD One -- D Two\nNew Callup\nStar Goalie\nBackup Goalie")
        self.assertEqual(out["goalie"], "g1")
        self.assertIn("New Callup", out["unknown"])

    def test_a_goalie_the_site_doesnt_know_is_named(self):
        _, out = self.slots("**Aces projected lineup**\nF One -- F Two -- F Three\nD One -- D Two\nFirst Start\nStar Goalie")
        self.assertEqual(out["goalie"], "First Start")

    def test_a_pair_typed_without_a_space(self):
        lineup, out = self.slots("**Aces projected lineup**\nF One -- F Two -- F Three\nD One --D Two\nStar Goalie\nBackup Goalie")
        self.assertEqual(lineup["groups"][1], ["D One", "D Two"])
        self.assertEqual(lineup["goalies"], ["Star Goalie", "Backup Goalie"])
        self.assertEqual(out["skaters"]["d2"], "D1")


class Starter(unittest.TestCase):
    GOALIES = [{"id": "g1", "name": "Number One", "starts": 5}, {"id": "g2", "name": "Number Two", "starts": 1}]
    ALL = {g["id"]: g for g in GOALIES}

    def pick(self, posted=None, listed=(), rest=None, last=None):
        return build_nhl.crease_starter(posted, list(listed), self.GOALIES, self.ALL, rest, last)

    def test_two_sources_agreeing_is_the_most_it_can_say(self):
        got = self.pick({"goalie": "g2"}, [{"id": "g2", "name": "N. Two"}])
        self.assertEqual(got, {"id": "g2", "name": "Number Two", "source": "both", "other": None, "doubt": False})
        # A goalie the site doesn't know yet, spelled two ways.
        self.assertEqual(self.pick({"goalie": "Bránd New"}, [{"id": None, "name": "Brand New"}])["source"], "both")

    def test_a_disagreement_is_shown_never_settled_quietly(self):
        """New Jersey, 2026-10-13: the NHL's lineup had Nico Daws (who started the
        night before), the book had a line for Jake Allen only, and the page
        showed Daws with a check mark. The book's goalie is the one shown, and
        the other name rides along."""
        got = self.pick({"goalie": "g2"}, [{"id": "g1", "name": "Number One"}], rest=1, last="g2")
        self.assertEqual(got, {"id": "g1", "name": "Number One", "source": "split", "other": "Number Two", "doubt": False})

    def test_one_source_alone_is_only_expected(self):
        self.assertEqual(self.pick({"goalie": "g2"})["source"], "lineup")
        self.assertEqual(self.pick({"goalie": "Brand New"}), {"id": None, "name": "Brand New", "source": "lineup", "other": None, "doubt": False})
        self.assertEqual(self.pick(None, [{"id": "g2", "name": "N. Two"}])["source"], "market")
        self.assertEqual(self.pick(None, [{"id": "g2", "name": "N. Two"}])["name"], "Number Two")

    def test_the_lineup_naming_last_nights_starter_is_doubted(self):
        self.assertTrue(self.pick({"goalie": "g2"}, rest=1, last="g2")["doubt"])
        self.assertFalse(self.pick({"goalie": "g2"}, rest=1, last="g1")["doubt"])
        self.assertFalse(self.pick({"goalie": "g2"}, rest=3, last="g2")["doubt"])

    def test_two_goalies_listed_by_the_book(self):
        both = [{"id": "g2", "name": "x"}, {"id": "g1", "name": "y"}]
        self.assertEqual(self.pick({"goalie": None}, both)["id"], "g1")  # no lineup: the usual one
        self.assertEqual((self.pick({"goalie": "g2"}, both)["id"], self.pick({"goalie": "g2"}, both)["source"]), ("g2", "both"))

    def test_with_no_source_the_usual_one_and_the_other_on_a_back_to_back(self):
        self.assertEqual(self.pick()["id"], "g1")
        self.assertEqual(self.pick(rest=1, last="g1")["id"], "g2")
        self.assertEqual(self.pick(rest=1, last="g2")["id"], "g1")
        self.assertEqual(build_nhl.crease_starter(None, [], [], {}, None, None), {"id": None, "name": None, "source": "usual", "other": None, "doubt": False})

    def test_no_source_is_ever_called_confirmed(self):
        page = (Path(build_nhl.__file__).parent.parent / "site" / "nhl" / "promo-tools.js").read_text(encoding="utf-8")
        self.assertNotIn("confirmed", page.lower().replace("never confirmed", ""))


class Board(unittest.TestCase):
    """One day, two games: BUSY @ LEAKY (lines posted) and TIGHT @ CALM (none)."""

    @classmethod
    def setUpClass(cls):
        cls.records = season()
        cls.model = model_for(cls.records)
        cls.goalies = {"BUSY": [{"id": "gb", "name": "Bo Busy"}], "LEAKY": [{"id": "gl", "name": "Lee Leaky"}], "CALM": [{"id": "gc", "name": "Cal Calm"}], "TIGHT": [{"id": "gt", "name": "Ty Tight"}]}
        cls.games = [scheduled("1", "2026-10-13", "BUSY", "LEAKY"), scheduled("2", "2026-10-13", "TIGHT", "CALM")]
        line = lambda pid, name, strike, chance: {"id": pid, "name": name, "line": strike, "over": -110, "under": -110, "chance": chance, "thin": False, "alts": []}
        cls.lines = {"1": {"LEAKY": [line("gl", "Lee Leaky", 22.5, 0.5)], "BUSY": [line("gb", "Bo Busy", 21.5, 0.5)]}}
        cls.tonight = {"1": {"posted": "x", "LEAKY": {"goalie": "gl"}}}
        cls.board = build_nhl.crease_board(cls.model, cls.games, cls.tonight, cls.lines, cls.goalies, cls.records, None, NOW)
        cls.rows = {row["team"]: row for row in cls.board["2026-10-13"]["goalies"]}

    def test_one_row_per_team_named_for_its_starter(self):
        self.assertEqual(set(self.rows), {"BUSY", "LEAKY", "CALM", "TIGHT"})
        self.assertEqual((self.rows["LEAKY"]["name"], self.rows["LEAKY"]["source"]), ("Lee Leaky", "both"))
        self.assertEqual(self.rows["BUSY"]["source"], "market")
        self.assertEqual(self.rows["CALM"]["source"], "usual")
        self.assertEqual(self.board["2026-10-13"]["starters"], 4)

    def test_both_sides_of_the_matchup_are_on_the_row(self):
        row = self.rows["LEAKY"]
        self.assertEqual((row["opp_shots"], row["opp_shots_rank"]), (38.0, 1))  # BUSY takes the most
        self.assertEqual((row["allowed"], row["allowed_rank"]), (38.0, 1))      # LEAKY allows the most
        self.assertEqual((row["starts"], row["saves_avg"], row["high"]), (3, 35.0, 35))

    def test_early_in_a_season_the_line_does_most_of_the_talking(self):
        row = self.rows["LEAKY"]
        self.assertAlmostEqual(row["weight"], 0.5 * 3 / 20)  # three games in
        self.assertAlmostEqual(row["blend"], row["weight"] * row["mean"] + (1 - row["weight"]) * row["mkt_mean"], places=1)
        self.assertEqual(self.rows["CALM"]["blend"], self.rows["CALM"]["mean"])  # no line: the model alone
        self.assertIsNone(self.rows["CALM"]["value"])

    def test_value_is_his_own_number_against_the_same_field(self):
        row = self.rows["LEAKY"]
        self.assertGreater(row["mean"], row["mkt_mean"])  # the model sees more than the line
        self.assertGreater(row["value"], 1.0)
        self.assertAlmostEqual(row["value"], row["top"] / row["mkt_top"], places=2)
        # Changing another goalie's line moves the field for both chances, not the gap between them much.
        other = json.loads(json.dumps(self.lines))
        other["1"]["BUSY"][0]["line"] = 27.5
        again = {r["team"]: r for r in build_nhl.crease_board(self.model, self.games, self.tonight, other, self.goalies, self.records, None, NOW)["2026-10-13"]["goalies"]}
        self.assertLess(again["LEAKY"]["top"], row["top"])
        self.assertAlmostEqual(again["LEAKY"]["value"], row["value"], delta=0.12)

    def test_check_and_tags(self):
        self.assertTrue(self.rows["LEAKY"]["check"])   # model 4+ saves over the line
        self.assertNotIn("value", self.rows["LEAKY"]["tags"])
        tagged = [team for team, row in self.rows.items() if "upside" in row["tags"]]
        self.assertEqual(len(tagged), 1)  # four starters: one Upside tag
        self.assertEqual(tagged[0], max(self.rows, key=lambda team: self.rows[team]["top"]))

    def test_the_value_tag_needs_a_real_chance_and_no_check(self):
        row = lambda **over: {"locked": False, "top": 0.2, "value": 1.3, "check": False, **over}
        rows = [row(), row(check=True), row(value=1.1), row(top=0.01), row(value=None)]
        build_nhl.crease_tags(rows)
        self.assertEqual(["value" in r["tags"] for r in rows], [True, False, False, False, False])

    def test_chances_cover_the_day(self):
        total = sum(row["top"] for row in self.rows.values())
        self.assertGreater(total, 1.0)
        self.assertLess(total, 1.2)

    def test_a_far_off_game_is_left_out(self):
        board = build_nhl.crease_board(self.model, [scheduled("9", "2026-10-20", "BUSY", "CALM", start="2026-10-20T23:00Z")], None, None, self.goalies, self.records, None, NOW)
        self.assertEqual(board, {})


class LockAndRecord(unittest.TestCase):
    def setUp(self):
        self.records = season()
        self.goalies = Board.goalies if hasattr(Board, "goalies") else None
        self.goalies = {"BUSY": [{"id": "gb", "name": "Bo Busy"}], "LEAKY": [{"id": "gl", "name": "Lee Leaky"}], "CALM": [{"id": "gc", "name": "Cal Calm"}], "TIGHT": [{"id": "gt", "name": "Ty Tight"}]}
        self.games = [scheduled("1", "2026-10-13", "BUSY", "LEAKY"), scheduled("2", "2026-10-13", "TIGHT", "CALM")]
        self.before = {"days": build_nhl.crease_board(model_for(self.records), self.games, None, None, self.goalies, self.records, None, NOW)}

    def test_a_started_game_keeps_the_rows_from_before_puck_drop(self):
        later = datetime(2026, 10, 14, 0, 30)
        board = build_nhl.crease_board(model_for(self.records), self.games, None, {"1": {"LEAKY": [{"id": "gl", "name": "x", "line": 40.5, "over": 100, "under": 100, "chance": 0.5, "thin": False, "alts": []}]}}, self.goalies, self.records, self.before, later)
        rows = {row["team"]: row for row in board["2026-10-13"]["goalies"]}
        old = {row["team"]: row for row in self.before["days"]["2026-10-13"]["goalies"]}
        self.assertTrue(rows["LEAKY"]["locked"])
        self.assertIsNone(rows["LEAKY"]["line"])  # the in-game line never shows
        self.assertEqual(rows["LEAKY"]["top"], old["LEAKY"]["top"])

    def test_a_started_game_with_nothing_saved_has_no_rows(self):
        board = build_nhl.crease_board(model_for(self.records), self.games, None, None, self.goalies, self.records, None, datetime(2026, 10, 14, 0, 30))
        self.assertEqual(board, {})

    def finished(self):
        """Both games final: Lee Leaky made 41, the day's best; a backup started for CALM."""
        played = [
            game(1, "2026-10-13", "LEAKY", "BUSY", {"BUSY": 44, "LEAKY": 25}, {"gb": ("BUSY", "Bo Busy", 25, 2), "gl": ("LEAKY", "Lee Leaky", 44, 3)}),
            game(2, "2026-10-13", "CALM", "TIGHT", {"CALM": 20, "TIGHT": 30}, {"gc2": ("CALM", "Backup Calm", 30, 1), "gt": ("TIGHT", "Ty Tight", 20, 2)}),
        ]
        games = [{**g, "status": "final"} for g in self.games]
        records = self.records + played
        return build_nhl.crease_board(model_for(records), games, None, None, self.goalies, records, self.before, datetime(2026, 10, 14, 12, 0))

    def test_a_final_day_names_who_led_it(self):
        day = self.finished()["2026-10-13"]
        rows = {row["team"]: row for row in day["goalies"]}
        self.assertEqual((day["final"], day["best"]), (True, 41))
        self.assertEqual((rows["LEAKY"]["actual"], rows["LEAKY"]["led"]), (41, True))
        self.assertFalse(rows["BUSY"]["led"])
        # The promo counts whoever started for the team.
        self.assertEqual((rows["CALM"]["actual"], rows["CALM"]["started"]), (29, "Backup Calm"))

    def test_the_record_is_written_once_and_summed(self):
        board = self.finished()
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(build_nhl.record_crease_days(folder, board), 1)
            self.assertEqual(build_nhl.record_crease_days(folder, board), 0)
            saved = json.loads((folder / "2026-10.json").read_text())
            self.assertEqual(saved["cols"], list(build_nhl.CREASE_RECORD_COLS))
            self.assertEqual(len(saved["days"]["2026-10-13"]["goalies"]), 4)
            summary = build_nhl.crease_record_summary(folder)
        self.assertEqual((summary["days"], summary["since"], summary["through"]), (1, "2026-10-13", "2026-10-13"))
        rows = {row["team"]: row for row in board["2026-10-13"]["goalies"]}
        favorite = max(rows.values(), key=lambda row: row["top"])
        self.assertEqual(summary["favorite"]["led"], int(favorite["team"] == "LEAKY"))
        self.assertEqual(summary["upside"]["tagged"], 1)
        self.assertEqual(summary["miss"]["goalies"], 0)  # nobody had a line
        self.assertEqual(build_nhl.crease_record_summary(Path(tmp) / "nowhere")["days"], 0)

    def test_an_open_day_is_not_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(build_nhl.record_crease_days(Path(tmp), self.before["days"]), 0)


if __name__ == "__main__":
    unittest.main()
