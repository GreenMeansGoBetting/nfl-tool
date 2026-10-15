"""Icebreaker on the NHL Promo Tools page (site/nhl/icebreaker.js), run in a real browser
on the saved NHL data and Icebreaker samples.

What is pinned: #icebreaker opens it and the tabs switch both ways; a day opens on its 7:00 PM
ET games; each player's chance is his rate over everyone's in the games picked, and a team's
is its players' added up; taking a game out (or picking another start time) does the sum
again; clicking a team shows only its players; the fast-start cells are the build's
numbers; DraftKings' first goal price, or another book's in grey; the Historical Data popup;
the Winners list from the build's history; logos from a host the saved image can carry."""
import unittest

from helpers import nhl_icebreaker  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
DAY = "2026-10-15"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/promo-tools.html#icebreaker")
        PAGE.wait_for_function("() => typeof ICE !== 'undefined' && ICE !== null && !document.getElementById('ice-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def open_day(day=DAY):
    PAGE.evaluate("(day) => { iceView.day = iceDays().indexOf(day); Object.assign(iceView, { games: null, team: null, all: true }); renderIce(); }", day)


def built(day=DAY):
    return nhl_icebreaker()["days"][day]


PLAYERS = """() => [...document.querySelectorAll('#ice-players tbody tr')].map((tr) => ({
    name: tr.querySelector('.koe-name').textContent, chance: tr.querySelector('.ice-pill').textContent,
    price: (tr.querySelector('.ice-odds') || { textContent: '' }).textContent, other: !!tr.querySelector('.ice-odds-other') }))"""
TEAMS = """() => [...document.querySelectorAll('#ice-teams .ice-team-row')].map((tr) => {
    const cells = [...tr.children].filter((td) => !td.classList.contains('koe-gap'));
    return { team: tr.dataset.team, chance: parseFloat(tr.querySelector('.ice-pill').textContent), first: cells[4].textContent.trim(), sog: cells[6].textContent.trim() };
})"""


def pct(x):
    return f"{x * 100:.1f}%"


class Page(unittest.TestCase):
    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_the_address_opens_icebreaker_and_the_tabs_switch(self):
        self.assertTrue(PAGE.evaluate("() => document.getElementById('crease-app').hidden"))
        PAGE.click(".promo-views [data-promo=crease]")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('ice-app').hidden && !document.getElementById('crease-app').hidden && location.hash === ''"))
        PAGE.click(".promo-views [data-promo=icebreaker]")
        self.assertTrue(PAGE.evaluate("() => !document.getElementById('ice-app').hidden && location.hash === '#icebreaker'"))

    def test_a_day_opens_on_its_7pm_games(self):
        open_day()
        want = sorted(g["game_id"] for g in built()["games"] if g["time"] == "19:00")
        self.assertEqual(len(want), 5)
        self.assertEqual(sorted(PAGE.evaluate("() => [...iceView.games]")), want)
        self.assertEqual(PAGE.evaluate("() => document.querySelector('.ice-chip.ice-on').dataset.slot"), "19:00")


class Chances(unittest.TestCase):
    def picked(self, ids):
        rows = [r for r in built()["players"] if r["game_id"] in ids]
        total = sum(r["rate"] for r in rows)
        return sorted(rows, key=lambda r: -r["rate"]), total

    def test_his_chance_is_his_rate_over_everyones(self):
        open_day()
        ids = {g["game_id"] for g in built()["games"] if g["time"] == "19:00"}
        rows, total = self.picked(ids)
        shown = PAGE.evaluate(PLAYERS)
        self.assertEqual(len(shown), len(rows))
        for want, got in list(zip(rows, shown))[:20]:
            self.assertEqual(got["name"], want["name"])
            self.assertEqual(got["chance"], pct(want["rate"] / total))

    def test_a_teams_chance_is_its_players_added_up(self):
        open_day()
        ids = {g["game_id"] for g in built()["games"] if g["time"] == "19:00"}
        rows, total = self.picked(ids)
        teams = PAGE.evaluate(TEAMS)
        self.assertEqual(len(teams), 10)
        for t in teams:
            self.assertAlmostEqual(t["chance"], round(sum(r["rate"] for r in rows if r["team"] == t["team"]) / total * 100, 1), places=1)
        self.assertAlmostEqual(sum(t["chance"] for t in teams), 100, delta=0.3)

    def test_taking_a_game_out_does_the_sum_again(self):
        open_day()
        gone = sorted(g["game_id"] for g in built()["games"] if g["time"] == "19:00")[0]
        PAGE.click(f"#ice-games [data-game='{gone}']")
        ids = {g["game_id"] for g in built()["games"] if g["time"] == "19:00"} - {gone}
        rows, total = self.picked(ids)
        shown = PAGE.evaluate(PLAYERS)
        self.assertEqual(len(shown), len(rows))
        self.assertEqual(shown[0]["chance"], pct(rows[0]["rate"] / total))
        self.assertEqual(len(PAGE.evaluate(TEAMS)), 8)
        self.assertIsNone(PAGE.evaluate("() => iceView.slot"))

    def test_another_start_time_picks_its_games(self):
        open_day()
        PAGE.click("#ice-slots [data-slot='20:00']")
        want = sorted(g["game_id"] for g in built()["games"] if g["time"] == "20:00")
        self.assertEqual(sorted(PAGE.evaluate("() => [...iceView.games]")), want)

    def test_clicking_a_team_shows_only_its_players(self):
        open_day()
        team = PAGE.evaluate(TEAMS)[2]["team"]
        PAGE.click(f".ice-team-row[data-team='{team}']")
        teams_shown = PAGE.evaluate("() => [...document.querySelectorAll('#ice-players tbody tr .koe-who > img:first-child')].map((i) => i.alt)")
        self.assertTrue(teams_shown and set(teams_shown) == {team})
        PAGE.click("[data-ice-team]")
        self.assertIsNone(PAGE.evaluate("() => iceView.team"))

    def test_the_top_15_until_show_all(self):
        PAGE.evaluate("() => { iceView.day = iceDays().indexOf('2026-10-15'); Object.assign(iceView, { games: null, team: null, all: false }); renderIce(); }")
        self.assertEqual(len(PAGE.evaluate(PLAYERS)), 15)
        PAGE.click("[data-ice-all]")
        self.assertGreater(len(PAGE.evaluate(PLAYERS)), 15)


class Cells(unittest.TestCase):
    def test_fast_starts_are_the_builds(self):
        open_day()
        fast = nhl_icebreaker()["fast"]
        for t in PAGE.evaluate(TEAMS):
            f = fast[t["team"]]
            self.assertEqual(t["first"], f"{f['first']}/{f['gp']}")
            self.assertEqual(t["sog"], f"{f['sog5']:.1f}")

    def test_draftkings_price_or_another_books_in_grey(self):
        open_day()
        rows = {r["name"]: r for r in PAGE.evaluate(PLAYERS)}
        priced = [r for r in built()["players"] if r.get("fg") or r.get("fg_best")]
        self.assertEqual(len(priced), 2)
        dk = next(r for r in priced if r["fg"])
        other = next(r for r in priced if not r["fg"])
        self.assertEqual((rows[dk["name"]]["price"], rows[dk["name"]]["other"]), ("+750", False))
        self.assertEqual((rows[other["name"]]["price"], rows[other["name"]]["other"]), ("+900", True))

    def test_logos_can_go_in_the_saved_image(self):
        open_day()
        srcs = PAGE.evaluate("() => [...document.querySelectorAll('#ice-capture img')].map((i) => i.src)")
        self.assertTrue(srcs and all(s.startswith("https://a.espncdn.com/") for s in srcs))


class Extras(unittest.TestCase):
    def test_historical_data_opens_and_closes(self):
        PAGE.click("#ice-history-btn")
        self.assertFalse(PAGE.evaluate("() => document.getElementById('ice-history-modal').hidden"))
        self.assertIn("first shift", PAGE.inner_text("#ice-history-modal").lower())
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('ice-history-modal').hidden"))

    def test_winners_list_from_the_history(self):
        history = [{"date": "2026-10-14", "games": 5, "time": 15, "players": 170,
                    "winners": [{"t": 15, "team": "TOR", "id": None, "name": "Some Skater", "rank": 12, "chance": 0.0123, "fg": 1400}],
                    "top": {"id": None, "name": "Top Pick", "team": "FLA", "chance": 0.019}}]
        PAGE.evaluate("(h) => { ICE.history = h; renderIce(); }", history)
        row = PAGE.inner_text("#ice-winners-list tbody tr")
        for text in ("Some Skater", "1st 0:15", "12th", "1.2%", "+1400"):
            self.assertIn(text, row)
        PAGE.evaluate("() => { ICE.history = []; renderIce(); }")
        self.assertIn("first finished", PAGE.inner_text("#ice-winners-list"))


if __name__ == "__main__":
    unittest.main()
