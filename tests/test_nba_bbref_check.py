"""The weekly Basketball-Reference cross-check (nfl_tool/nba/bbref_check.py).

Made-up players and numbers in Basketball-Reference's table layout: no data of
theirs is copied here (their terms bar AI use of their content)."""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "nfl_tool" / "nba"))
import bbref_check as B  # noqa: E402


def row(name, team, games, dist, three, dunk):
    return (f'<tr><th data-stat="ranker">1</th><td data-stat="name_display"><a href="/p.html">{name}</a></td>'
            f'<td data-stat="team_name_abbr">{team}</td><td data-stat="games"><strong>{games}</strong></td>'
            f'<td data-stat="avg_dist">{dist}</td><td data-stat="pct_fga_fg3a">{three}</td>'
            f'<td data-stat="pct_fga_dunk">{dunk}</td></tr>')


PAGE = ('<html><table id="shooting"><thead><tr><th data-stat="name_display">Player</th></tr></thead><tbody>'
        + row("Al Able", "AAA", 10, "15.0", ".400", ".050")
        + row("Bo B&#243;nez Jr.", "2TM", 12, "8.0", ".100", ".200")  # traded: his total comes first
        + row("Bo B&#243;nez Jr.", "BBB", 5, "7.0", ".050", ".300")
        + row("Cy Cole", "CCC", 9, "20.0", ".700", ".010")
        + "</tbody></table></html>")


def actions(player, games, shots):
    """`shots`: [(distance, three, type)], spread over `games` games."""
    return [{"kind": "shot", "player": player, "game_id": i % games, "dist": d, "three": t, "type": ty}
            for i, (d, t, ty) in enumerate(shots)]


class Parse(unittest.TestCase):
    def test_reads_the_table_and_keeps_a_traded_players_total(self):
        bb = B.parse_page(PAGE)
        self.assertEqual(len(bb), 3)
        bo = bb.loc[B.key("Bo Bonez")]
        self.assertEqual((bo["games"], bo["avg_dist"], bo["three"]), (12, 8.0, 0.1))

    def test_names_match_without_accents_or_suffixes(self):
        self.assertEqual(B.key("Bo B&#243;nez Jr."), B.key("Bo Bonez"))
        self.assertEqual(B.key("Nikola Jokić"), B.key("Nikola Jokic"))


class Compare(unittest.TestCase):
    def frames(self, able_dist=8, cy_games=9):
        acts = (actions(1, 10, [(able_dist, False, "Jump Shot")] * 30 + [(25, True, "Jump Shot")] * 20)
                + actions(2, 12, [(1, False, "Dunk Shot")] * 12 + [(9, False, "Driving Layup Shot")] * 33
                          + [(24, True, "Jump Shot")] * 5)
                + actions(3, cy_games, [(24, True, "Jump Shot")] * 35 + [(10, False, "Pullup Jump Shot")] * 15))
        names = {1: "Al Able", 2: "Bo Bonez", 3: "Cy Cole"}
        return B.ours(pd.DataFrame(acts), names), B.parse_page(PAGE)

    def test_close_numbers_are_all_clear(self):
        res = B.compare(*self.frames())
        self.assertEqual(res["drift"], [], res)
        self.assertEqual(res["players"], 3)

    def test_a_player_three_feet_apart_is_flagged(self):
        res = B.compare(*self.frames(able_dist=2))
        self.assertEqual([d["name"] for d in res["drift"]], ["Al Able"])
        self.assertIn("avg_dist", res["drift"][0]["bad"])
        self.assertTrue(any("Al Able" in p for p in res["problems"]))

    def test_a_different_number_of_games_is_skipped_not_flagged(self):
        res = B.compare(*self.frames(able_dist=2, cy_games=8))
        self.assertEqual(res["skipped"], 1)
        self.assertNotIn("Cy Cole", [d["name"] for d in res["drift"]])

    def test_heaves_are_left_out_like_basketball_reference_does(self):
        # 2026-11-11: Isaiah Collier's 5 heaves in 67 shots put him 5.4 ft off; their numbers skip heaves
        us, them = self.frames()
        heaves = actions(1, 10, [(55, True, "Heave Jump Shot")] * 6)
        with_heaves = B.ours(pd.DataFrame(heaves + actions(1, 10, [(8, False, "Jump Shot")] * 30
                                                             + [(25, True, "Jump Shot")] * 20)), {1: "Al Able"})
        self.assertEqual(int(with_heaves.loc[B.key("Al Able"), "shots"]), 50)
        self.assertAlmostEqual(with_heaves.loc[B.key("Al Able"), "avg_dist"], us.loc[B.key("Al Able"), "avg_dist"])
        self.assertAlmostEqual(with_heaves.loc[B.key("Al Able"), "three"], 0.4)
        self.assertEqual(B.compare(with_heaves, them)["drift"], [])

    def test_too_few_matches_means_the_page_changed(self):
        res = B.compare(*self.frames())
        self.assertTrue(any("only 3 players matched" in p for p in res["problems"]))
        self.assertIn("PROBLEM", B.report(res))


if __name__ == "__main__":
    unittest.main()
