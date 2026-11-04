"""NBA Matchup Keys (site/nba/keys.js rules + matchup-keys.html / .js page, its own page since 2026-11-04).

What is pinned: keys.js on the real league numbers of 2026-10-30 (tests/fixtures), the owner's CHA @
WSH read; every key in one of the three groups the page stacks (the owner, 2026-11-04: "sorted by
their moniker - edge, clash, and same style ... all fit into that category"; Fits / Takes Away are
the favored side's Edge); the page: Edges a column a team, Clashes, Same Style, strongest first; every
number = its value and its rank side by side, both on the rank colors; the window buttons; the picked
game shared with Matchup Breakdown; the League Stats Chart without its old Matchup Keys button."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

SITE = PAGE = None
TABLE = json.loads((ROOT / "tests" / "fixtures" / "nba_league_chart_2026-10-30.json").read_text(encoding="utf-8"))


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        teams = {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TABLE}
        teams["CHA"] = {"name": "Charlotte Hornets", "short": "CHA", "logo": "", "color": "1d1160"}
        teams["WSH"] = {"name": "Washington Wizards", "short": "WSH", "logo": "", "color": "e31837"}
        today = __import__("datetime").date.today().isoformat()
        schedule = [
            {"game_id": "88", "date": today, "time": "19:00", "start_utc": f"{today}T23:00Z", "away": "CHA", "home": "WSH", "status": "scheduled"},
            {"game_id": "89", "date": today, "time": "19:30", "start_utc": f"{today}T23:30Z", "away": "BOS", "home": "NY", "status": "scheduled"},
        ]
        last3 = {t: dict(row, o_3pm=(row.get("o_3pm") or 0) * (2 if t == "NY" else 1)) for t, row in TABLE.items()}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": schedule,
                    "league_chart": {"season": TABLE, "10": TABLE, "5": TABLE, "3": last3}}
        PAGE = SITE.open("nba/matchup-keys.html")
        PAGE.wait_for_function("() => document.querySelectorAll('.mk-group').length === 3")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Rules(unittest.TestCase):
    """keys.js, the owner's CHA @ WSH read: "their games are 1-9 on Overs. CHA takes a ton of 3s but
    hasn't hit many. CHA doesnt get to the line and WSH does. this is an inside vs outside battle. WSH
    is bad in transition but cha doesn't really push the pace at all." (Both bottom-10 pace: WSH was
    18th on these numbers.)"""

    @classmethod
    def setUpClass(cls):
        cls.keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", TABLE)

    def titles(self, lead=None):
        return [k["title"] for k in self.keys if lead is None or k["lead"] == lead]

    def test_the_owners_read_is_all_there(self):
        shown = self.titles()
        for title in ("Unders 1-9 Combined", "Lots Of Threes, Few Falling", "Free Throws: Opposite Ends", "Inside Vs Outside",
                      "WSH Transition D Weak, Not Tested"):
            self.assertIn(title, shown)

    def test_one_lead_a_subject(self):
        lead = [k for k in self.keys if k["lead"]]
        self.assertEqual(len({k["topic"] for k in lead}), len(lead))
        self.assertTrue([k for k in self.keys if not k["lead"]])
        self.assertEqual([k["lead"] for k in self.keys], sorted([k["lead"] for k in self.keys], reverse=True))

    def test_nothing_told_twice_or_misread(self):
        titles = self.titles()
        self.assertEqual(len(titles), len(set(titles)))
        # an Edge already says the glass; no "Opposite Ends" restating it
        self.assertNotIn("Offensive Glass: Opposite Ends", titles)
        # transition scoring only counts for a team that runs (CHA is near the bottom in running)
        self.assertNotIn("CHA Offense: Transition Scoring", titles)
        # Inside Vs Outside replaces the two volume clashes it explains
        self.assertNotIn("Three-Point Volume: Opposite Ends", titles)
        self.assertNotIn("Paint Volume: Opposite Ends", titles)

    def test_every_key_reads_both_sides_or_one_teams_two_numbers(self):
        for k in self.keys:
            teams = {t["team"] for t in k["tiles"]}
            self.assertTrue(len(teams) == 2 or (k["type"] == "volume" and len(k["tiles"]) == 2), k["title"])

    def test_every_key_is_an_edge_a_clash_or_same_style(self):
        want = {"edge": "edge", "fits": "edge", "away": "edge", "clash": "clash", "untested": "clash", "volume": "clash",
                "style": "style", "trend": "style"}
        for k in self.keys:
            self.assertEqual(k["group"], want[k["type"]], k["title"])
            if k["group"] == "edge":
                # an Edge belongs to one team and reads as that side's
                self.assertRegex(k["title"], rf"^{k['team']} (Offense|Defense): ")

    def test_fits_is_the_offenses_edge_takes_away_the_defenses(self):
        # WSH gets to the line, CHA allows it (or the mirror): written as the side's Edge, never "Fits"
        table = {t: dict(row) for t, row in TABLE.items()}
        hi = max(r["o_ftr"] for r in table.values() if r.get("o_ftr") is not None)
        dhi = max(r["d_ftr"] for r in table.values() if r.get("d_ftr") is not None)
        table["WSH"]["o_ftr"], table["CHA"]["d_ftr"] = hi + 0.05, dhi + 0.05
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", table)
        fits = [k for k in keys if k["type"] == "fits" and k["topic"] == "ft"]
        self.assertEqual([(k["title"], k["team"], k["group"]) for k in fits], [("WSH Offense: Free Throws", "WSH", "edge")])
        table["CHA"]["d_ftr"] = min(r["d_ftr"] for r in table.values() if r.get("d_ftr") is not None) - 0.05
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", table)
        away = [k for k in keys if k["type"] == "away" and k["topic"] == "ft"]
        self.assertEqual([(k["title"], k["team"], k["group"]) for k in away], [("CHA Defense: Free Throws", "CHA", "edge")])


class Page(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { view.window = 'season'; gameId = '88'; render(); }")

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_three_groups_stacked_in_order(self):
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.mk-group')].map((g) => g.dataset.group)")
        self.assertEqual(heads, ["edge", "clash", "style"])
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", TABLE)
        shown = PAGE.evaluate("() => document.querySelectorAll('.mk-key').length")
        self.assertEqual(shown, len(keys))  # nothing dropped, nothing behind a More button
        for group in ("clash", "style"):
            want = [k["title"] for k in sorted((k for k in keys if k["group"] == group), key=lambda k: -k["score"])]
            got = PAGE.evaluate(f"() => [...document.querySelectorAll('.mk-group[data-group={group}] .mk-key-top b')].map((b) => b.textContent)")
            self.assertEqual(got, want)

    def test_edges_a_column_a_team_road_team_left(self):
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", TABLE)
        cols = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-team')].map((c) => ({
            head: c.querySelector('.mk-team-head b').textContent,
            cards: [...c.querySelectorAll('.mk-key-top b')].map((b) => b.textContent)}))""")
        self.assertEqual([c["head"] for c in cols], ["Charlotte Hornets", "Washington Wizards"])
        for col, abbr in zip(cols, ("CHA", "WSH")):
            want = [k["title"].replace(f"{abbr} ", "", 1) for k in sorted((k for k in keys if k["group"] == "edge" and k["team"] == abbr), key=lambda k: -k["score"])]
            self.assertEqual(col["cards"], want)

    def test_every_number_shows_its_value_and_its_rank_both_shaded(self):
        nums = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-pair')].map((p) => {
            const [v, r] = p.querySelectorAll('.od-tile');
            return {v: v.textContent.trim(), r: r.textContent.trim(), same: v.getAttribute('style') === r.getAttribute('style'), bg: !!v.getAttribute('style'),
                    w: [v.getBoundingClientRect().width, r.getBoundingClientRect().width]};
        })""")
        self.assertTrue(nums)
        for n in nums:
            self.assertNotIn(".", n["v"])  # whole numbers, the chart's own
            self.assertRegex(n["r"], r"^\d+(st|nd|rd|th)$")
            self.assertTrue(n["same"] and n["bg"])
            self.assertAlmostEqual(n["w"][0], n["w"][1], delta=1)  # two halves of the old tile

    def test_the_window_buttons(self):
        PAGE.click('#mk-window .view-toggle-btn[data-window="3"]')
        self.assertEqual(PAGE.evaluate("view.window"), "3")
        self.assertTrue(PAGE.evaluate("document.querySelector('#mk-window [data-window=\"3\"]').classList.contains('active')"))

    def test_picking_a_game_opens_it_and_shares_it_with_matchup_breakdown(self):
        PAGE.click('.matchup-card[data-game="89"]')
        self.assertEqual(PAGE.evaluate("document.querySelector('.mk-head').textContent.replace(/\\s+/g, '')"), "BOS@NY")
        self.assertEqual(PAGE.evaluate("localStorage.getItem('nba-tool.game.v1')"), "89")
        self.assertTrue(PAGE.evaluate("document.querySelector('.matchup-card[data-game=\"89\"]').classList.contains('selected')"))

    def test_the_league_stats_chart_lost_its_button(self):
        html = (ROOT / "nfl_tool" / "site" / "nba" / "league.html").read_text(encoding="utf-8")
        self.assertNotIn('id="lsc-keys"', html)
        self.assertNotIn("keys.js", html)


if __name__ == "__main__":
    unittest.main()
