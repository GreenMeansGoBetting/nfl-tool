"""NBA Matchup Keys (site/nba/keys.js rules + matchup-keys.html / .js page, its own page since 2026-11-04).

What is pinned: keys.js on the real league numbers of 2026-10-30 (tests/fixtures), the owner's CHA @
WSH read; every key in one of three groups (edge, clash, same style; Fits / Takes Away are the favored
side's Edge). The page (rebuilt 2026-11-06 in the Points Research look, the owner: "segmented ... this
is where BOS have an edge vs this is where CHA is weak vs this is where they are both x"): Overview =
the road team's Edges | the Matchup Summary | the home team's Edges (its own column first; stat names
with an OFF / DEF tag, no phrases), Both Teams under; the Summary reads one matchup a side (road Off vs
home Def | home Off vs road Def); Categories = a line a category with a Read (keys.js decides it) that
opens two research boxes; injuries by name; Show All Summaries two a row for the video frame."""
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
        injuries = {"CHA": [{"id": "9001", "name": "Test Guard", "position": "PG", "status": "Out", "injury": "Knee"}]}
        players = {"CHA": [{"id": "9001", "name": "Test Guard", "position": "PG", "games": 5, "min": 30.0, "pts": 20.0, "reb": 3.0, "ast": 6.0, "threes": 2.0, "l5_pts": 22.0},
                           {"id": "9002", "name": "Test Big", "position": "C", "games": 5, "min": 28.0, "pts": 14.0, "reb": 11.0, "ast": 2.0, "threes": 0.0, "l5_pts": 12.0}]}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": schedule, "injuries": injuries, "players": players,
                    "league_chart": {"season": TABLE, "10": TABLE, "5": TABLE, "3": last3}}
        PAGE = SITE.open("nba/matchup-keys.html")
        PAGE.wait_for_function("() => !!document.querySelector('.mk-ov')")
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
        want = {"edge": "edge", "fits": "edge", "strength": "clash", "clash": "clash", "untested": "clash", "volume": "clash",
                "style": "style", "trend": "style"}
        for k in self.keys:
            self.assertEqual(k["group"], want[k["type"]], k["title"])
            if k["group"] == "edge":
                # an Edge belongs to one team and reads as that side's
                self.assertRegex(k["title"], rf"^{k['team']} (Offense|Defense): ")

    def test_fits_is_the_offenses_edge_strength_vs_strength_a_clash(self):
        # WSH gets to the line, CHA allows it: written as WSH's Edge, never "Fits"
        table = {t: dict(row) for t, row in TABLE.items()}
        hi = max(r["o_ftr"] for r in table.values() if r.get("o_ftr") is not None)
        dhi = max(r["d_ftr"] for r in table.values() if r.get("d_ftr") is not None)
        table["WSH"]["o_ftr"], table["CHA"]["d_ftr"] = hi + 0.05, dhi + 0.05
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", table)
        fits = [k for k in keys if k["type"] == "fits" and k["topic"] == "ft"]
        self.assertEqual([(k["title"], k["team"], k["group"]) for k in fits], [("WSH Offense: Free Throws", "WSH", "edge")])
        table["CHA"]["d_ftr"] = min(r["d_ftr"] for r in table.values() if r.get("d_ftr") is not None) - 0.05
        keys = PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", table)
        # WSH gets to the line, CHA allows it the least: each side points its own way, so no one's Edge
        # (the owner, 2026-11-07: DEN 6th vs IND 9th read "IND Edge")
        both = [k for k in keys if k["type"] == "strength" and k["topic"] == "ft"]
        self.assertEqual([(k["title"], k["team"], k["group"]) for k in both], [("WSH Free Throws Vs CHA Defense: Strength Vs Strength", None, "clash")])
        self.assertFalse([k for k in keys if k["group"] == "edge" and k["topic"] == "ft"])
        # the Categories line reads Clash on WSH's side (home Off vs road Def = the second read)
        SITE.nba["league_chart"]["season"] = table
        PAGE.evaluate("(t) => { DATA.league_chart.season = t; view.tab = 'categories'; view.open = new Set(['ft']); render(); }", table)
        try:
            reads = PAGE.evaluate("() => [...document.querySelector('.mk-crow[data-cat=ft] .mk-cline').querySelectorAll('.rs-read')].map((t) => t.textContent.trim())")
            self.assertEqual(reads[1], "Clash")
            box = PAGE.evaluate("() => [...document.querySelectorAll('.mk-crow[data-cat=ft] .rs-sb .rs-read')].map((t) => t.textContent.trim())")
            self.assertEqual(box[1], "Clash")
        finally:
            PAGE.evaluate("(t) => { DATA.league_chart.season = t; view.tab = 'overview'; render(); }", TABLE)
            SITE.nba["league_chart"]["season"] = TABLE


class Page(unittest.TestCase):
    def setUp(self):
        PAGE.evaluate("() => { view.window = 'season'; view.all = false; view.tab = 'overview'; view.open = new Set(['scoring']); gameId = '88'; dayIndex = 0; render(); }")

    def keys(self):
        return PAGE.evaluate("(t) => nbaMatchupKeys(t, 'CHA', 'WSH')", TABLE)

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_overview_edges_summary_edges_then_both_teams(self):
        boxes = PAGE.evaluate("""() => [...document.querySelector('.mk-ov').children].map((b) => b.dataset.team || (b.classList.contains('mks-card') ? 'summary' : '?'))""")
        self.assertEqual(boxes, ["CHA", "summary", "WSH"])  # road team left
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.mk-ov + .mk-both')"))

    def test_each_edge_box_lists_its_teams_edges_own_column_first(self):
        keys = self.keys()
        for abbr, opp in (("CHA", "WSH"), ("WSH", "CHA")):
            box = PAGE.evaluate(f"""() => {{
                const b = document.querySelector('.mk-edges[data-team={abbr}]');
                return {{heads: [...b.querySelectorAll('.rs-h')].map((h) => h.textContent.trim()),
                        labels: [...b.querySelectorAll('.mk-lab')].map((l) => l.title),
                        tags: [...b.querySelectorAll('.mk-lab .mk-side')].map((t) => t.textContent)}};
            }}""")
            self.assertEqual(box["heads"], [abbr, opp])
            want = [k["title"] for k in sorted((k for k in keys if k["group"] == "edge" and k["team"] == abbr), key=lambda k: -k["score"])]
            self.assertEqual(box["labels"], want)  # every Edge, strongest first, nothing dropped
            self.assertEqual(box["tags"], ["OFF" if " Offense: " in t else "DEF" for t in want])

    def test_labels_are_stat_names_not_phrases(self):
        labels = PAGE.evaluate("() => [...document.querySelectorAll('.mk-lab > span:first-child')].map((s) => s.textContent)")
        self.assertTrue(labels)
        for label in labels:
            self.assertNotRegex(label, r"Both|Neither|Live|Crash|Run|Stay|Play")

    def test_every_number_tile_is_rank_big_value_small_shaded(self):
        tiles = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-k')].map((t) => ({
            r: t.querySelector('b').textContent, small: t.querySelector('small').textContent, bg: !!t.getAttribute('style')}))""")
        self.assertTrue(tiles)
        for t in tiles:
            self.assertRegex(t["r"], r"^\d+(st|nd|rd|th)$")
            self.assertTrue(t["small"].strip() and t["bg"])

    def test_both_teams_holds_the_same_style_keys(self):
        keys = self.keys()
        want = sorted(k["title"] for k in keys if k["group"] == "style")
        got = PAGE.evaluate("() => [...document.querySelectorAll('.mk-both .mk-lab')].map((l) => l.title)")
        self.assertTrue(want)
        self.assertEqual(sorted(got), want)

    def test_the_window_buttons(self):
        PAGE.click('#mk-window .view-toggle-btn[data-window="3"]')
        self.assertEqual(PAGE.evaluate("view.window"), "3")
        self.assertTrue(PAGE.evaluate("document.querySelector('#mk-window [data-window=\"3\"]').classList.contains('active')"))
        # the research boxes' tabs are the same windows
        PAGE.click('[data-mk-tab="categories"]')
        PAGE.click('.mk-crow[data-cat=scoring] .rs-tabs [data-window="10"]')
        self.assertEqual(PAGE.evaluate("view.window"), "10")
        self.assertTrue(PAGE.evaluate("document.querySelector('#mk-window [data-window=\"10\"]').classList.contains('active')"))

    def test_picking_a_game_opens_it_and_shares_it_with_matchup_data(self):
        PAGE.click('.matchup-card[data-game="89"]')
        self.assertEqual(PAGE.evaluate("document.querySelector('.mk-head').textContent.replace(/\\s+/g, '')"), "BOS@NY")
        self.assertEqual(PAGE.evaluate("localStorage.getItem('nba-tool.game.v1')"), "89")
        self.assertTrue(PAGE.evaluate("document.querySelector('.matchup-card[data-game=\"89\"]').classList.contains('selected')"))

    def test_injuries_list_every_name(self):
        boxes = PAGE.evaluate("() => [...document.querySelectorAll('.mk-injt')].map((b) => b.textContent)")
        self.assertEqual(len(boxes), 2)
        self.assertIn("Test Guard", boxes[0])
        self.assertIn("Out", boxes[0])
        self.assertIn("None Listed", boxes[1])
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.mk-injt [data-nba-player=\"9001\"]')"))  # the player card

    def test_the_summary_reads_one_matchup_a_side(self):
        # road Off vs home Def | category | home Off vs road Def (the owner, 2026-11-06)
        card = PAGE.evaluate("""() => {
            const c = document.querySelector('.mk-ov .mks-card');
            return {cats: [...c.querySelectorAll('.mks-cat b')].map((b) => b.textContent),
                    teams: [...c.querySelectorAll('.mks-team b')].map((b) => b.textContent),
                    heads: [...c.querySelectorAll('.rs-h')].map((h) => [h.textContent.trim(), (h.querySelector('img') || {}).alt || '']),
                    tov: [...c.querySelectorAll('.mks-grid > .rs-t[title]')].filter((t) => t.title.includes('Turnover')).map((t) => t.title)};
        }""")
        self.assertEqual(card["cats"], ["Scoring Efficiency", "Pace", "Three-Point Shooting", "Paint Scoring", "Turnovers", "Rebounding", "Free Throws"])
        self.assertEqual(card["teams"], ["CHA", "WSH"])
        self.assertEqual([h for h in card["heads"] if h[1]], [["Off", "CHA"], ["Def", "WSH"], ["Off", "WSH"], ["Def", "CHA"]])
        self.assertEqual([t.split(" · ")[0] for t in card["tov"]], ["Charlotte Hornets", "Washington Wizards", "Washington Wizards", "Charlotte Hornets"])

    def test_a_logo_marks_each_edge_on_its_matchups_side(self):
        keys = self.keys()
        topics = {"scoring": 0, "pace": 1, "threes": 2, "paint": 3, "turnovers": 4, "glass": 5, "ft": 6}
        want = sorted({(topics[k["topic"]], 0 if k["tiles"][0]["team"] == "CHA" else 1, k["team"]) for k in keys if k["group"] == "edge" and k["topic"] in topics})
        got = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-ov .mks-cat')].flatMap((c, i) =>
            [...c.querySelectorAll('.mks-edge')].map((m, j) => m.querySelector('img') ? [i, j, m.querySelector('img').alt] : null).filter(Boolean))""")
        self.assertTrue(want)
        self.assertEqual(sorted(tuple(g) for g in got), want)

    def test_categories_lines_read_from_keys_and_open_on_click(self):
        PAGE.click('[data-mk-tab="categories"]')
        lines = PAGE.evaluate("() => [...document.querySelectorAll('.mk-crow')].map((r) => r.dataset.cat)")
        self.assertEqual(lines, ["scoring", "pace", "transition", "threes", "paint", "turnovers", "glass", "ft"])
        # Scoring opens by default: CHA Off vs WSH Def, then WSH Off vs CHA Def
        offs = PAGE.evaluate("() => [...document.querySelectorAll('.mk-crow[data-cat=scoring] .rs-sb .rs-h.rs-him')].filter((h) => h.textContent.trim() === 'Off').map((h) => h.querySelector('img').alt)")
        self.assertEqual(offs, ["CHA", "WSH"])  # the offense's logo on its column
        PAGE.click('.mk-cline[data-cat="turnovers"]')
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.mk-crow[data-cat=turnovers] .rs-sb').length"), 2)
        PAGE.click('.mk-cline[data-cat="turnovers"]')
        self.assertFalse(PAGE.evaluate("() => !!document.querySelector('.mk-crow[data-cat=turnovers] .rs-sb')"))
        # a category line's Read = the first Edge key in its topics that way (keys.js order), its team named
        keys = self.keys()
        reads = PAGE.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.mk-crow')].map((r) =>
            [r.dataset.cat, [...r.querySelector('.mk-cline').querySelectorAll('.rs-read')].map((t) => t.textContent.trim())]))""")
        topics = {"scoring": ["scoring"], "transition": ["transition"], "threes": ["threes"], "paint": ["paint", "mid"], "turnovers": ["turnovers"], "glass": ["glass"], "ft": ["ft"]}
        checked = 0
        for cat, tops in topics.items():
            for side, off in ((0, "CHA"), (1, "WSH")):
                edges = [k for k in keys if k["group"] == "edge" and k["topic"] in tops and k["tiles"][0]["team"] == off]
                if edges:
                    checked += 1
                    self.assertEqual(reads[cat][side], f"{edges[0]['team']} Edge", cat)
        self.assertTrue(checked)
        # the owner's "WSH is bad in transition but cha doesn't really push the pace": Not Tested on CHA's side
        self.assertEqual(reads["transition"][0], "Not Tested")

    def test_rebounding_allows_is_the_offensive_rebound_rate_given_up(self):
        # the owner, 2026-11-07: "Allows 71.8%" (the defense's own DREB%) beside a 26.8% OREB% read wrong
        PAGE.evaluate("() => { view.tab = 'categories'; view.open = new Set(['glass']); render(); }")
        got = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-crow[data-cat=glass] .rs-sb')].map((b) => {
            const t = [...b.querySelectorAll('.rs-g:not(.rs-bands) > .rs-t')];
            return [t[9].textContent.trim(), t[9].title];  // corner + 5 heads, then label, Off, Rank, Allows
        })""")
        for (text, tip), d in zip(got, ("WSH", "CHA")):
            want = f"{(1 - TABLE[d]['d_reb']) * 100:.1f}%"
            self.assertEqual(text, want)
            self.assertIn("Offensive Rebound % Allowed", tip)

    def test_four_big_tabs_under_the_injuries(self):
        # Summary (The Matchup) joined as the fourth when Matchup Data was retired (the owner, 2026-11-09)
        tabs = PAGE.evaluate("""() => [...document.querySelectorAll('.mk-tabs [data-mk-tab]')].map((b) => {
            const r = b.getBoundingClientRect(); return {t: b.textContent, w: Math.round(r.width), h: r.height}; })""")
        self.assertEqual([t["t"] for t in tabs], ["Overview", "Categories", "Rotations & History", "Summary"])
        self.assertTrue(max(t["w"] for t in tabs) - min(t["w"] for t in tabs) <= 1)  # a quarter each
        self.assertGreaterEqual(tabs[0]["h"], 44)
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.mk-inj + .mk-tabs')"))

    def test_rotations_and_history_on_this_page(self):
        # the owner, 2026-11-06: the roster and the games on this page, not a link to Matchup Data
        PAGE.click('[data-mk-tab="rotations"]')
        got = PAGE.evaluate("""() => ({
            rot: [...document.querySelectorAll('.mh-rotbox')].map((b) => b.dataset.team),
            rec: [...document.querySelectorAll('.mh-recbox')].map((b) => b.dataset.team),
            h2h: !!document.querySelector('.mh-h2h [data-mh-h2h="quarters"]'),
            wl: [...document.querySelectorAll('.mh-wl [data-mh-wl]')].map((b) => b.dataset.mhWl),
            link: !!document.querySelector('.mk-tab-link')})""")
        self.assertEqual(got["rot"], ["CHA", "WSH"])
        self.assertEqual(got["rec"], ["CHA", "WSH"])
        self.assertTrue(got["h2h"])
        self.assertEqual(got["wl"], ["CHA", "WSH"])
        self.assertFalse(got["link"])
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.mh-rotbox[data-team=CHA] .mh-prow')].map((r) => [r.textContent.includes('Test Guard'), r.classList.contains('mh-isout')])")
        self.assertEqual(rows, [[True, True], [False, False]])  # the Out player marked, the box in roster order
        PAGE.click('.mh-rotbox[data-team=CHA] [data-mh-sort="reb"]')  # most rebounds first
        self.assertIn("Test Big", PAGE.evaluate("() => document.querySelector('.mh-rotbox[data-team=CHA] .mh-prow').textContent"))
        PAGE.click('[data-mh-h2h="blowouts"]')
        self.assertTrue(PAGE.evaluate("() => document.querySelector('.mh-h2h .rs-tabs .on').dataset.mhH2h === 'blowouts'"))
        PAGE.click('[data-mh-wl="WSH"]')
        self.assertTrue(PAGE.evaluate("() => document.querySelector('.mh-wl .rs-tabs .on').dataset.mhWl === 'WSH'"))
        self.assertEqual(SITE.errors, [])
        PAGE.click('[data-mk-tab="overview"]')

    def test_show_all_summaries_two_a_row_then_back(self):
        PAGE.click("#mk-all")
        cards = PAGE.evaluate("""() => [...document.querySelectorAll('.mks-all .mks-card')].map((c) => {
            const r = c.getBoundingClientRect(); return {game: c.dataset.game, top: Math.round(r.top), w: r.width}; })""")
        self.assertEqual([c["game"] for c in cards], ["88", "89"])  # every game of the day
        self.assertEqual(cards[0]["top"], cards[1]["top"])  # side by side: one screenshot = two games
        self.assertLessEqual(cards[0]["w"] * 2, 1160)  # two fit the video frame
        self.assertFalse(PAGE.evaluate("() => !!document.querySelector('.mk-ov')"))
        self.assertTrue(PAGE.evaluate("document.getElementById('mk-all').classList.contains('active')"))
        PAGE.click('.matchup-card[data-game="89"]')  # a game card goes back to that game
        self.assertFalse(PAGE.evaluate("view.all"))
        self.assertTrue(PAGE.evaluate("() => !!document.querySelector('.mk-ov')"))

    def test_the_league_stats_chart_lost_its_button(self):
        html = (ROOT / "nfl_tool" / "site" / "nba" / "league.html").read_text(encoding="utf-8")
        self.assertNotIn('id="lsc-keys"', html)
        self.assertNotIn("keys.js", html)


if __name__ == "__main__":
    unittest.main()
