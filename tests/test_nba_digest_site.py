"""Dunk Digest (nba/digest.html, owner only): the owner's daily video card.

Runs the page on a hand-made slate: twelve teams, each with a shooting guard
who has played six games, and one defense (CHA) that gives shooting guards
three times the threes everyone else does.

    python tools/run_tests.py --only nba
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_browser import SiteBrowser  # noqa: E402

TEAMS = ["BOS", "NY", "DET", "MIA", "ATL", "CHA", "CHI", "CLE", "DAL", "DEN", "HOU", "LAL"]
FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta", "fgm", "ftm", "reb", "ast"]
LEAKY = "CHA"  # gives shooting guards 6 threes a game, everyone else 2
NIGHT = "2026-11-04"
# Tonight: BOS's shooter and NY's non-shooter both face the leaky defense.
GAMES = [("g1", "BOS", "CHA", -4.5, 231.5), ("g2", "NY", "CHA", 2.5, 224.5), ("g3", "DET", "MIA", -1, 220),
         ("g4", "ATL", "CHI", 6, 228), ("g5", "CLE", "DAL", -7, 233), ("g6", "DEN", "HOU", -3, 226)]


def log_row(game, opp, minutes, threes):
    row = {"date": "2026-10-25", "game": game, "opp": opp, "home": 0, "start": 1, "min": minutes, "pts": 12, "fga": 10,
           "fg3m": threes, "fg3a": 6, "fta": 2, "fgm": 4, "ftm": 2, "reb": 4, "ast": 3}
    return [row[f] for f in FIELDS]


def props():
    players = {}
    for i, team in enumerate(TEAMS):
        made = {"BOS": 3, "NY": 0}.get(team, 2)  # BOS's guard is a shooter; NY's never shoots threes
        log = []
        for k in range(1, 7):
            opp = TEAMS[(i + k) % len(TEAMS)]
            log.append(log_row(100 * i + k, opp, 30, 6 if opp == LEAKY and team != "NY" else made))
        players[f"{team}-sg"] = {"name": f"Guard {team.title()}", "team": team, "pos": "SG", "log": log}
    # BOS's star (34 minutes a game) and a bench player (10), both Out tonight.
    players["BOS-star"] = {"name": "Star Bostonian", "team": "BOS", "pos": "SF", "log": [log_row(900 + k, "NY", 34, 1) for k in range(5)]}
    players["BOS-bench"] = {"name": "Bench Bostonian", "team": "BOS", "pos": "C", "log": [log_row(950 + k, "NY", 10, 0) for k in range(5)]}
    return {"default": "2027", "seasons": {"2027": {"label": "2026-27", "fields": FIELDS, "players": players, "out": {}}}}


def data():
    schedule = [{"game_id": gid, "date": NIGHT, "time": "19:00", "start_utc": f"{NIGHT}T23:{10 + n}Z", "away": a, "home": h, "status": "scheduled",
                 "home_team_spread": hs, "total_line": total} for n, (gid, a, h, hs, total) in enumerate(GAMES)]
    slates = {gid: {"away": {"starters": [f"{a}-sg"], "jumper": f"{a}-sg"}, "home": {"starters": [f"{h}-sg"], "jumper": f"{h}-sg"},
                    "fair": {"tip_home": 0.6, "first_home": 0.57, "players": {}}} for gid, a, h, _, _ in GAMES}
    fb_players = {f"{t}-sg": {"name": f"Guard {t.title()}", "pos": "SG", "team": t, "starts": 6, "team_first_shot": 2 + (t == "BOS")} for t in TEAMS}
    # League Stats Chart rows: BOS makes the most threes, CHA allows the most; pace by list order.
    chart = {t: {"pace": 104 - i, "o_3pm": 13 - i * 0.1, "d_3pm": 12 + i * 0.1} for i, t in enumerate(TEAMS)}
    chart["BOS"]["o_3pm"] = 18
    chart["CHA"]["d_3pm"] = 17
    return {
        "season": 2027, "season_label": "2026-27",
        "teams": {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in TEAMS},
        "schedule": schedule, "players": {}, "book_odds": {},
        "injuries": {"BOS": [{"id": "BOS-star", "name": "Star Bostonian", "status": "Out"}, {"id": "BOS-bench", "name": "Bench Bostonian", "status": "Out"}]},
        "league_chart": {"season": chart},
        "first_basket": {"default": "2027", "slates": {"2027": slates}, "seasons": {"2027": {"players": fb_players}}},
        "identity": {"default": "2027", "seasons": {"2027": {"spots": {"types": [{"key": "b2b", "label": "Back-To-Back (2nd Night)"}], "tonight": {"g1": {"CHA": ["b2b"]}}}}}},
    }


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba = data()
        SITE.nba_props = props()
        PAGE = SITE.open("nba/digest.html")
        PAGE.wait_for_selector(".dd-card")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def row(team, column):
    """The text of a team's cell in a column (by header)."""
    return PAGE.evaluate("""([team, column]) => {
        const box = document.querySelector(`.dd-team[data-team="${team}"]`);
        const board = box.closest('.dd-board');
        const heads = [...board.querySelectorAll('.dd-h')].map((h) => h.textContent);
        let cell = box;
        for (let i = 0; i < heads.indexOf(column); i++) {
            cell = cell.nextElementSibling;
            if (cell.classList.contains('dd-notes')) cell = cell.nextElementSibling; // the home row skips the shared notes
        }
        return cell.innerText.replace(/\\s+/g, ' ').trim();
    }""", [team, column])


class Digest(unittest.TestCase):
    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_five_games_a_card_at_the_summary_card_size(self):
        cards = PAGE.evaluate("() => [...document.querySelectorAll('.dd-card')].map((c) => [c.dataset.games, c.offsetWidth, c.offsetHeight])")
        self.assertEqual(cards, [["5", 1160, 980], ["1", 1160, 980]])

    def test_nothing_spills_out_of_its_box(self):
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.dd-card, .dd-box')].filter((b) => b.scrollHeight > b.clientHeight + 1).length"), 0)

    def test_the_favorite_shows_the_spread_and_the_underdog_the_total(self):
        self.assertEqual((row("BOS", "Line"), row("CHA", "Line")), ("231.5", "-4.5"))  # CHA (home) -4.5: favored
        self.assertEqual(row("NY", "Line"), "-2.5")  # home +2.5: NY (away) favored
        self.assertEqual((row("DET", "Line"), row("MIA", "Line")), ("220", "-1"))

    def test_pace_is_each_teams_rank(self):
        self.assertEqual(row("BOS", "Pace"), "1st Fast")
        self.assertEqual(row("HOU", "Pace"), "11th Slow")

    def test_a_spot_reads_both_sides(self):
        # The leaky defense lights the shooter's spot, with his name under it...
        self.assertEqual(row("BOS", "Threes"), "SG Bos")
        # ...but not a guard who never shoots threes (the both-sides rule)...
        self.assertEqual(row("NY", "Threes"), "")
        # ...and an ordinary defense lights nothing.
        self.assertEqual(row("DET", "Threes"), "")
        self.assertEqual(row("BOS", "Points"), "")

    def test_first_basket(self):
        self.assertEqual(row("CHA", "First Basket"), "Scores 1st 57% Tip: Cha 60% 1st Shot: Cha 2 of 6")
        self.assertEqual(row("BOS", "First Basket"), "Scores 1st 43% Tip: Bos 40% 1st Shot: Bos 3 of 6")

    def test_notes_are_plain_facts(self):
        notes = PAGE.evaluate("() => document.querySelector('.dd-notes').innerText")
        self.assertIn("CHA: 2nd Night Of B2B", notes)
        self.assertIn("BOS Out: Bostonian", notes)  # the 34-minute starter
        self.assertEqual(notes.count("Out"), 1)  # the 10-minute bench player gets no note
        self.assertIn("BOS: most threes made; CHA: most threes allowed", notes)

    def test_the_menu_link_is_owner_only(self):
        self.assertTrue(PAGE.evaluate("() => document.querySelector('.nba-menu a[href=\"/nba/digest.html\"]').classList.contains('owner-only')"))


if __name__ == "__main__":
    unittest.main()
