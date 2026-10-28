"""NBA Zone Matchup Targets: the reads (nfl_tool/nba/zone_matchups.py) and the page (site/nba/zones.html).

What is pinned (the owner, 2026-10-27): a player's read is where and how HE shoots against what
tonight's defense allows players like him (guards / forwards / bigs) from those spots; shots and
makes are both counted, so a defense that gives up lots of his shots but few makes lands near Toss
Up; the numbers are RAW (no pulling toward the league, no minimum sample); never priced (the main
line is reference only); the Python zones match shot-chart.js to the letter; the page opens on the
night's Best / Worst Spots and a player click opens both charts."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(ROOT / "tests"))
import zone_matchups as Z  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402

TEAMS = ["AAA", "BBB", "CCC"]
RIM, TOP3, CORNER = (25, 1, 0), (25, 26, 1), (3, 2, 1)


def spot(where, made, tries, team, defense, kind=3):
    x, y, three = where
    return [[x, y, 1 if i < made else 0, three, i % 5, 0, kind, team, defense] for i in range(tries)]


# Big 1 (AAA): all rim. BBB lets bigs make 9 of 10 at the rim, CCC 3 of 10; both see the same rim share.
# Guard 3 (AAA): top threes, catch and shoot. Bigs from CCC shoot at BBB / BBB's at CCC, guards fill the rest.
SHOTS = {"season": 2027, "label": "2026-27", "games": list(range(100, 105)), "teams": TEAMS,
         "players": {
             "1": spot(RIM, 6, 10, 0, 1) + spot(RIM, 6, 10, 0, 2),
             "2": spot(RIM, 9, 10, 2, 1) + spot(TOP3, 1, 10, 2, 1, kind=2),
             "4": spot(RIM, 3, 10, 1, 2) + spot(TOP3, 1, 10, 1, 2, kind=2),
             "3": spot(TOP3, 4, 10, 0, 1, kind=2) + spot(TOP3, 4, 10, 0, 2, kind=2),
         },
         "who": {"1": ["Big One", "AAA"], "2": ["Big Two", "CCC"], "4": ["Big Four", "BBB"], "3": ["Guard Three", "AAA"]},
         "league": []}
POS = {"1": "C", "2": "C", "4": "C", "3": "SG"}
GAMES = [{"game_id": "900", "date": "2099-10-25", "time": "19:30", "away": "AAA", "home": "BBB", "start_utc": "2099-10-25T23:30Z"}]
ODDS = {"AAA_BBB": {"props": {"points": {"1": {"q": [["dk", "o", 11.5, -110], ["fd", "o", 12.5, -110], ["mgm", "o", 12.5, -115]]},
                                         "3": {"q": [["dk", "o", 9.5, -110]]}},
                              "threes": {"3": {"q": [["dk", "o", 2.5, -110]]}}}}}


def build():
    return Z.block(SHOTS, POS, GAMES, ODDS, "2099-10-25", "2099-10-25T12:00Z")


class Reads(unittest.TestCase):
    def test_zones_match_the_chart(self):
        """shot-chart.js nbaShotZone, spot for spot (the page colors and the reads must agree)."""
        cases = {(25, 1, 0): "ra", (25, 10, 0): "paint", (10, 2, 0): "mBL", (40, 2, 0): "mBR", (25, 18, 0): "mT",
                 (12, 14, 0): "mWL", (38, 14, 0): "mWR", (2, 3, 1): "c3L", (48, 3, 1): "c3R", (25, 27, 1): "t3",
                 (8, 20, 1): "w3L", (42, 20, 1): "w3R"}
        for (x, y, three), z in cases.items():
            self.assertEqual(Z.zone(x, y, three), z, (x, y, three))

    def test_the_big_reads_the_defense_on_bigs(self):
        """Big One plays at BBB: BBB let bigs make 15 of 20 at the rim (Big Two's 9/10 and his own 6/10),
        the league's bigs 24 of 40: raw (no pull toward the league), makes +(0.75 - 0.6) x 2 points over 2 x 0.6."""
        r = build()["players"]["1"]["points"]
        self.assertEqual(r["side"], "over")
        self.assertTrue(r["strong"])
        self.assertAlmostEqual(r["makes"], (0.75 - 0.6) / 0.6, places=3)
        self.assertEqual(r["zones"][0]["z"], "ra")
        self.assertEqual([r["zones"][0]["dmade"], r["zones"][0]["dtried"]], [15, 20])
        self.assertEqual(r["n"], 20)

    def test_never_priced_the_line_is_reference(self):
        r = build()["players"]["1"]["points"]
        self.assertEqual(r["line"], 12.5)  # the line most books hang (two of three), the player card's rule
        self.assertNotIn("edge", r)

    def test_guards_are_read_against_guards(self):
        """Guard Three's top threes: no guard shot against BBB yet (BBB's top-3s allowed came from a big),
        so his makes read nothing from the bigs' shots there."""
        p = build()["players"]["3"]
        self.assertEqual(p["group"], "G")
        self.assertEqual(p["points"]["dn"], 10)  # his own 10 shots against BBB are the guards' shots it allowed
        self.assertIn("threes", p)

    def test_lots_of_shots_few_makes_is_a_toss_up(self):
        lg = Z.Tally()
        d = Z.Tally()
        for i in range(100):
            lg.add("ra", 3, 1 if i < 60 else 0)
            lg.add("t3", 2, 1 if i < 35 else 0)
        for i in range(40):  # gives up the rim twice as often, makes 45% there (league 60%)
            d.add("ra", 3, 1 if i < 18 else 0)
        for i in range(10):
            d.add("t3", 2, 1 if i < 4 else 0)
        rim = [[25, 1, 1, 0, 0, 0, 3]] * 10
        r = Z.read(rim, "points", d, lg, d, lg)
        self.assertGreater(r["shots"], 0.5)
        self.assertLess(r["makes"], -0.2)
        self.assertEqual(r["side"], "toss" if abs(r["score"]) < Z.LEAN else r["side"])
        self.assertLess(abs(r["score"]), abs(r["shots"]))


class Grid(unittest.TestCase):
    """Matchup View's defense grid: five positions x where / how they shoot, by market; ranks of 30
    with 30th = gives up the most (here of 2 defenses)."""

    def test_ranks_and_counts(self):
        g = build()["grid"]
        rim = g["teams"]["BBB"]["points"]["C"]["rim"]
        self.assertEqual(rim[:2], [15, 20])  # Big Two's 9/10 and Big One's 6/10 at BBB
        self.assertEqual(rim[3], 2)  # more makes allowed than CCC's 9/20: ranked last (gives up the most)
        self.assertEqual(g["teams"]["CCC"]["points"]["C"]["rim"][3], 1)
        self.assertAlmostEqual(g["teams"]["BBB"]["points"]["C"]["rim"][2], 20 / 30, places=3)  # 20 of the 30 bigs' shots at BBB
        self.assertNotIn("rim", g["teams"]["BBB"]["threes"]["C"])  # the threes grid has only threes' columns
        self.assertEqual(g["teams"]["BBB"]["threes"]["C"]["t3"][:2], [1, 10])
        self.assertIsNone(g["teams"]["BBB"]["points"]["PG"]["rim"][3])  # never faced: no rank
        # the owner, 2026-10-28: three groups, Wing 3 and Top 3 apart (no Above-Break 3)
        self.assertEqual([c[0] for c in g["cols"]["points"]], ["rim", "paint", "mid", "c3", "w3", "t3", "self", "catch", "drive"])
        self.assertEqual(sorted({c[2] for c in g["cols"]["points"]}), ["Inside The Arc", "Shot Type", "Three-Point Zones"])
        self.assertEqual(g["teams"]["BBB"]["points"]["C"]["t3"][:2], [1, 10])  # the top threes land in Top 3


class Record(unittest.TestCase):
    """Reads lock at tip (a started game is never rewritten), Toss Ups aren't saved, and the grade is
    against his main line, in units at the best price across every book at tip (the owner, 2026-10-28:
    "give them a W/L and also track the units for just the sake of seeing"; never an EV), split Strong /
    Lean and Over / Under; a read saved before prices were has units None."""

    def test_locks_at_tip_and_grades_by_bucket(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "2027.json"
            m = build()
            rec = Z.update_record(2027, m, path)
            self.assertEqual([r[0] for r in rec["900"]["points"]], ["1"])  # Guard Three's read is a Toss Up: not saved
            saved = json.loads(path.read_text(encoding="utf-8"))
            started = dict(m, games=[dict(m["games"][0], started=True)])
            started["players"] = {"1": dict(m["players"]["1"], points=dict(m["players"]["1"]["points"], side="under"))}
            self.assertEqual(Z.update_record(2027, started, path), saved)  # after tip: unchanged
        logs = {"points": {("900", "1"): 14.0}}
        rows = Z.ledger(rec, logs["points"], "points")
        self.assertEqual(rec["900"]["points"][0][-2:], [-110, "fd"])  # main line 12.5: fd -110 beats mgm -115 (dk's 11.5 isn't it)
        self.assertEqual(rows, [["2099-10-25", round(abs(m["players"]["1"]["points"]["score"]), 4), 1, 0.909, ["strong", "over"]]])
        self.assertEqual(Z.ledger(rec, {("900", "1"): 10.0}, "points")[0][2:4], [0, -1.0])
        old = {"900": {"date": "2099-10-25", "points": [rec["900"]["points"][0][:8]]}}  # saved before prices were
        self.assertIsNone(Z.ledger(old, logs["points"], "points")[0][3])
        self.assertEqual(Z.ledger(rec, {("900", "1"): 12.5}, "points"), [])  # a push
        self.assertEqual(Z.ledger(rec, {}, "points"), [])  # sat / no box score yet

    def test_past_nights_for_the_day_arrows(self):
        """The owner, 2026-10-28: "no back button to look at yesterday to analyze results"."""
        rec = {"900": {"date": "2099-10-24", "points": [["1", "Big One", "AAA", "BBB", 0.2, "over", True, 12.5],
                                                        ["3", "Guard Three", "AAA", "BBB", -0.07, "under", False, 9.5]], "threes": []},
               "901": {"date": "2099-10-25", "points": [["1", "Big One", "AAA", "BBB", 0.2, "over", True, 12.5]]}}
        got = Z.past(rec, {"points": {("900", "1"): 14.0, ("900", "9"): 3.0}, "threes": {}}, "2099-10-25")
        self.assertEqual([(p["pid"], p["got"], p["result"], p["units"]) for p in got["points"]], [("1", 14.0, "hit", None), ("3", None, "sat", None)])  # tonight's left out; no price saved
        rec["900"]["points"][0] += [120, "dk"]
        self.assertEqual(Z.past(rec, {"points": {("900", "1"): 14.0}}, "2099-10-25")["points"][0]["units"], 1.2)
        self.assertEqual(Z.past(rec, {"points": {}, "threes": {}}, "2099-10-25")["points"][0]["result"], None)  # waiting on the box score
        self.assertEqual(Z.past(rec, {"points": {("900", "1"): 11.0, ("900", "3"): 9.0}}, "2099-10-25")["points"][1]["result"], "hit")  # the under


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        past = {"points": [{"pid": "1", "name": "Big One", "team": "AAA", "opp": "BBB", "score": 0.2, "side": "over", "strong": True,
                            "line": 12.5, "game": "800", "date": "2099-10-24", "got": 14.0, "result": "hit", "price": 150, "book": "dk", "units": 1.5},
                           {"pid": "3", "name": "Guard Three", "team": "AAA", "opp": "BBB", "score": -0.07, "side": "under", "strong": False,
                            "line": 9.5, "game": "800", "date": "2099-10-24", "got": 12.0, "result": "miss", "price": -110, "book": "fd", "units": -1.0}], "threes": []}
        shots = dict(SHOTS, matchups=dict(build(), past=past))
        SITE.nba = {"season": 2027, "season_label": "2026-27", "injuries": {}, "players": {}, "schedule": GAMES, "book_odds": ODDS,
                    "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS}}
        SITE.nba_shots, SITE.nba_props = shots, {"default": "2027", "seasons": {}}
        PAGE = SITE.open("nba/zones.html")
        PAGE.wait_for_selector(".zm-row")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Page(unittest.TestCase):
    def test_opens_on_best_and_worst_spots(self):
        self.assertEqual(PAGE.get_attribute(".zm-head-over + * .zm-row, .zm-head-over ~ * .zm-row", "data-player"), "1")
        row = PAGE.inner_text(".zm-row[data-player='1']")
        self.assertNotIn("Strong", row)  # the owner, 2026-10-27: no read cell; the shade says how strong
        self.assertIn("o12.5", row)  # the line most books hang, the player card's rule
        self.assertIn("-110", row)  # the best Over price across the books (dk -110 beats mgm -115), no book name
        self.assertEqual(PAGE.locator(".zm-row[data-player='1'] .zm-chip").count(), 2)
        heights = PAGE.evaluate("() => [...document.querySelectorAll('.zm-row')].map((r) => r.getBoundingClientRect().height)")
        self.assertEqual(len(set(heights)), 1)  # every row the same height
        self.assertEqual(SITE.errors, [])

    def test_a_click_opens_both_charts_raw(self):
        PAGE.click(".zm-row[data-player='1'] .zm-n")
        PAGE.wait_for_selector("#zm-detail:not([hidden]) .nba-shot-zone")
        self.assertEqual(PAGE.locator("#zm-detail .nba-shot-legend").count(), 2)
        self.assertIn("More Makes", PAGE.inner_text("#zm-detail .nba-box:nth-child(2) .nba-shot-legend"))
        self.assertEqual(PAGE.evaluate("() => NBA_SHOT_PRIOR"), 0)
        self.assertIn("15/20", PAGE.inner_text("#zm-detail .zm-why"))
        PAGE.click("#zm-kind [data-kind='2']")  # Catch & Shoot: Big One has none; BBB allowed Big Two's 10 top threes
        PAGE.wait_for_selector("#zm-kind .active[data-kind='2']")
        self.assertIn("No shots", PAGE.inner_text("#zm-detail .nba-box:nth-child(1)"))
        self.assertIn("allowed to bigs · 10", PAGE.inner_text("#zm-detail .nba-box:nth-child(2) .shc-sub").lower())
        PAGE.click("#zm-kind [data-kind='all']")
        self.assertEqual(SITE.errors, [])

    def test_matchup_view_lists_every_player_and_the_defense(self):
        try:
            PAGE.click("#zm-view [data-view='matchup']")
            PAGE.wait_for_selector(".zm-game")
            self.assertEqual(sorted(PAGE.evaluate("() => [...document.querySelectorAll('.zm-game .zm-row')].map((r) => r.dataset.player)")), ["1", "3"])
            self.assertEqual(PAGE.locator(".zm-game .zm-grid").count(), 1)  # BBB's grid; AAA hasn't defended a shot here
            self.assertEqual(PAGE.locator(".zm-game .zm-grid tbody tr").count(), 5)  # the five positions
            self.assertEqual(PAGE.locator(".zm-game .zm-grid .zm-gname").count(), 3)  # the three boxed groups
            widths = PAGE.evaluate("() => [...document.querySelectorAll('.zm-game .zm-grid tbody tr:first-child .zm-gcell')].map((c) => Math.round(c.getBoundingClientRect().width))")
            self.assertLessEqual(max(widths) - min(widths), 1)  # every column the same width
            tints = PAGE.evaluate("() => [0, 1, 2].map((i) => getComputedStyle(document.querySelector(`.zm-game .zm-grid tbody td.zm-g${i}`)).backgroundColor)")
            self.assertEqual(len(set(tints)), 3)  # each group on its own shade (the owner, 2026-10-28)
            self.assertIn("2nd", PAGE.inner_text(".zm-game .nba-box:nth-child(1) .zm-grid tbody tr:last-child"))  # BBB vs centers at the rim
            PAGE.click(".zm-game .zm-grid-toggle [data-grid='share']")
            PAGE.wait_for_selector(".zm-grid-toggle .active[data-grid='share']")
            self.assertIn("Strong Over", PAGE.inner_text(".zm-game .zm-row[data-player='1']"))  # the read words, Matchup View only
            self.assertIn("Toss Up", PAGE.inner_text(".zm-game .zm-row[data-player='3']"))
            PAGE.click("#zm-market [data-market='threes']")
            PAGE.wait_for_function("() => [...document.querySelectorAll('.zm-game .zm-row')].map((r) => r.dataset.player).join() === '3'")
        finally:
            PAGE.click("#zm-market [data-market='points']")
            PAGE.click("#zm-view [data-view='spots']")
        self.assertEqual(SITE.errors, [])

    def test_the_day_arrows_show_last_night(self):
        """The owner, 2026-10-28: a back button "to look at yesterday to analyze results ... as i can see best plays"."""
        self.assertTrue(PAGE.is_disabled("#day-next"))  # opens on tonight
        PAGE.click("#day-prev")
        try:
            PAGE.wait_for_selector(".zm-night")
            self.assertIn("1-1", PAGE.inner_text(".zm-night"))
            self.assertIn("+0.50u", PAGE.inner_text(".zm-night"))  # +1.5 at +150, -1 at -110
            self.assertIn("+1.50u", PAGE.inner_text(".zm-past.zm-hit"))
            self.assertIn("Hit", PAGE.inner_text(".zm-past.zm-hit"))
            self.assertIn("14", PAGE.inner_text(".zm-past.zm-hit"))
            self.assertIn("Miss", PAGE.inner_text(".zm-past.zm-miss"))
            self.assertTrue(PAGE.is_hidden("#zm-view"))
        finally:
            PAGE.click("#day-next")
        PAGE.wait_for_selector(".zm-row")
        self.assertEqual(SITE.errors, [])

    def test_the_ytd_tracker_opens(self):
        PAGE.click("#zm-ytd")
        try:
            PAGE.wait_for_selector("#zm-ytd-modal:not([hidden]) .ytd-tile")
            self.assertIn("min score", PAGE.inner_text("#zm-ytd-modal").lower())
        finally:
            PAGE.keyboard.press("Escape")
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
