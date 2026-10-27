"""The NBA Shot Charts page (site/nba/shot-charts.html + shot-charts.js) on hand-made shots.json.

What is pinned (the owner, 2026-10-21: "pick an offensive player and then a defensive team to
compare", this season only): the page opens on tonight's road team's top shooter against the home
defense; the left chart is his shots, the right one every shot that defense allowed (shot[8] = the
defense), with the colors flipped (red = it allows more than the league); the filters apply to both
sides (Last 5 = each side's own last 5 games); the zone table reads BOTH sides: Target / Tough only
when one side clearly points one way and the other doesn't point the other way (CLAUDE.md), and
never on a zone he rarely shoots from; the player's name opens the player card."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from site_browser import SiteBrowser  # noqa: E402

TEAMS = ["AAA", "BBB", "CCC"]
RIM, CORNER, TOP3 = (25, 1, 0), (3, 2, 1), (25, 26, 1)


def spot(where, made, tries, team, defense, game=lambda i: i % 6):
    x, y, three = where
    return [[x, y, 1 if i < made else 0, three, game(i), 0, 2, team, defense] for i in range(tries)]


# Player 1 (AAA) against CCC: hot at the rim, cold in the left corner, hot at the top.
P1 = spot(RIM, 9, 10, 0, 2) + spot(CORNER, 1, 10, 0, 2) + spot(TOP3, 8, 10, 0, 2)
# Player 2 (CCC) against BBB: BBB leaks at the rim, holds the corner and the top; 3 shots a game over 10 games.
P2 = [s for w, m in ((RIM, 9), (CORNER, 1), (TOP3, 0)) for s in spot(w, m, 10, 2, 1, game=lambda i: i)]
P3 = spot(RIM, 1, 2, 0, 1)  # a second AAA player with fewer shots, against BBB
SHOTS = {"season": 2027, "label": "2026-27", "games": list(range(100, 110)), "teams": TEAMS,
         "players": {"1": P1, "2": P2, "3": P3},
         "who": {"1": ["Player One", "AAA"], "2": ["Player Two", "CCC"], "3": ["Player Three", "AAA"]},
         "league": [[25, 1, 0, 60, 100], [3, 2, 1, 40, 100], [25, 26, 1, 35, 100]]}
DATA = {"season": 2027, "season_label": "2026-27", "injuries": {}, "identity": None, "players": {"AAA": [{"id": "1", "name": "Player One", "position": "PG"}]},
        "schedule": [{"game_id": "900", "date": "2099-10-25", "time": "19:30", "away": "AAA", "home": "BBB", "status": "scheduled"}],
        "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS}}


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba, SITE.nba_shots, SITE.nba_props = DATA, SHOTS, {"default": "2027", "seasons": {}}
        PAGE = SITE.open("nba/shot-charts.html")
        PAGE.wait_for_selector(".shc-table")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def counts():
    """[his shots, shots the defense allowed] from the two summaries."""
    return [PAGE.inner_text(f"#{box} .nba-shot-sum b") for box in ("shc-off", "shc-defbox")]


def rows():
    """{zone|group: [his FG, allowed FG, call]}."""
    return PAGE.evaluate("""() => {
        const out = {};
        let group = "";
        document.querySelectorAll('.shc-table tbody tr').forEach((tr) => {
          if (tr.classList.contains('nba-shot-group')) group = tr.textContent.trim();
          else out[`${tr.cells[0].textContent}|${group}`] = [tr.cells[1].textContent, tr.cells[5].textContent, tr.cells[10].textContent];
        });
        return out;
      }""")


def pick(key, value):
    PAGE.click(f".nba-shot-opt[data-shot-key='{key}'][data-shot-value='{value}']")
    PAGE.wait_for_selector(f".nba-shot-opt.active[data-shot-key='{key}'][data-shot-value='{value}']")


class ShotCharts(unittest.TestCase):
    def test_opens_on_tonights_road_shooter_vs_the_home_defense(self):
        self.assertEqual(PAGE.input_value("#shc-player"), "1")  # most shots on AAA
        self.assertEqual(PAGE.input_value("#shc-def"), "BBB")
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('#shc-player option')].map((o) => o.value)"), ["1", "3"])
        self.assertEqual(PAGE.get_attribute("#shc-off .player-click", "data-nba-player"), "1")
        self.assertEqual(counts(), ["30", "32"])  # BBB allowed Player Two's 30 and Player Three's 2
        self.assertEqual(SITE.errors, [])

    def test_the_name_opens_the_player_card(self):
        PAGE.click("#shc-off .player-click[data-nba-player='1']")
        try:
            PAGE.wait_for_selector("#player-card-modal:not([hidden]) .pc-name")
            self.assertEqual(PAGE.text_content("#player-card-modal .pc-name"), "Player One")
        finally:
            PAGE.keyboard.press("Escape")
        self.assertEqual(SITE.errors, [])

    def test_the_table_reads_both_sides(self):
        r = rows()
        self.assertEqual(r["At The Rim|Close"], ["9/10", "10/12", "Target"])  # he's hot, BBB leaks
        self.assertEqual(r["Left Corner|Threes"], ["1/10", "1/10", "Tough"])  # he's cold, BBB holds
        self.assertEqual(r["Top|Threes"][2], "")  # he's hot but BBB holds: the sides disagree, no call
        self.assertEqual(r["Paint|Close"], ["--", "--", ""])

    def test_defense_colors_flip(self):
        """BBB allows more than the league at the rim: red there; his rim (above the league) green."""
        hue = "(sel) => parseFloat(document.querySelector(sel).getAttribute('fill').match(/hsla?\\(([-\\d.]+)/)[1])"
        self.assertLess(PAGE.evaluate(f"({hue})('#shc-defbox .nba-shot-zone[data-zone=\"ra\"]')"), 60)
        self.assertGreater(PAGE.evaluate(f"({hue})('#shc-off .nba-shot-zone[data-zone=\"ra\"]')"), 60)
        self.assertIn("Allows More", PAGE.inner_text("#shc-defbox .nba-shot-legend"))

    def test_filters_apply_to_both_sides(self):
        try:
            pick("pts", "3")
            self.assertEqual(counts(), ["20", "20"])
            pick("pts", "all")
            pick("games", "5")  # his last 5 games (1-5: 24 shots); BBB's last 5 (games 5-9: 15 shots, Player Three's are older)
            self.assertEqual(counts(), ["24", "15"])
            pick("view", "heat")
            self.assertGreater(PAGE.locator("#shc-defbox .nba-shot-hex").count(), 0)
        finally:
            pick("games", "all")
            pick("view", "zones")
        self.assertEqual(SITE.errors, [])

    def test_changing_the_picks(self):
        try:
            PAGE.select_option("#shc-def", "CCC")
            PAGE.wait_for_function("() => location.hash === '#p=1&d=CCC'")
            self.assertEqual(counts(), ["30", "30"])
            PAGE.select_option("#shc-team", "CCC")  # his top shooter; the defense can't be his own team
            PAGE.wait_for_function("() => document.getElementById('shc-player').value === '2'")
            self.assertNotEqual(PAGE.input_value("#shc-def"), "CCC")
        finally:
            PAGE.select_option("#shc-team", "AAA")
            PAGE.select_option("#shc-def", "BBB")
        self.assertEqual(SITE.errors, [])

    def test_the_slate_picks_a_team_and_its_opponent(self):
        """The owner, 2026-10-27: click a team in the day's games, get its roster, the defense it plays fills in."""
        try:
            self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.shc-slate-team')].map((b) => b.dataset.team)"), ["AAA", "BBB"])
            self.assertEqual(PAGE.get_attribute(".shc-slate-team.selected", "data-team"), "AAA")
            self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.shc-roster-btn')].map((b) => b.dataset.player)"), ["1", "3"])
            PAGE.click(".shc-roster-btn[data-player='3']")
            PAGE.wait_for_function("() => document.getElementById('shc-player').value === '3'")
            self.assertEqual(PAGE.input_value("#shc-def"), "BBB")
            PAGE.select_option("#shc-def", "CCC")  # no team on the slate is selected now
            PAGE.wait_for_function("() => !document.querySelector('.shc-slate-team.selected')")
            PAGE.click(".shc-slate-team[data-team='AAA']")  # back: AAA's top shooter vs BBB
            PAGE.wait_for_function("() => location.hash === '#p=1&d=BBB'")
            self.assertEqual(PAGE.get_attribute(".shc-roster-btn.selected", "data-player"), "1")
        finally:
            PAGE.select_option("#shc-team", "AAA")
            PAGE.select_option("#shc-def", "BBB")
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
