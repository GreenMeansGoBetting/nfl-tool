"""The NFL Promo Tools page (site/promo-tools.js: King of the Endzone): the
week toggle, the Result column and the Winners list, in a real browser on the
saved data sample.

What is pinned: a past week shows that week's board (as it stood going into
the week) and the games' longest TDs; this week stays the live board; the
Winners list ranks the winner on that week's board like the table does and
shows what DraftKings paid; DraftKings' pasted list is read (accents, emoji,
a D/ST line) and a name that isn't in the game, or a missing pool, blocks the
save; the list is never in the saved image and the paste box is the owner's.
koe_weeks.json is answered "not built" and the weeks are handed to the page
here, so nothing depends on a local build."""
import unittest

from helpers import site_data  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
GAME = "2026_04_ATL_NO"


def weeks_file():
    """Week 4's board = the sample's own board (any real board will do), and
    Week 4 Monday's longest TDs as the build writes them."""
    data = site_data()
    return {
        "season": data["season"],
        "boards": {"4": data["koe"]},
        "results": {GAME: {"longest": 59, "winners": [{"name": "Bijan Robinson", "team": "ATL", "yds": 59}],
                           "tds": [["Bijan Robinson", "ATL", 59], ["Jahan Dotson", "ATL", 31], ["Alvin Kamara", "NO", 5]]}},
    }


PASTED = "\U0001f3c8 Bijan Robinson - $812 in Bonus Bets\nJahan Dotson - $2,950 in Bonus Bets\nAlvin Kamara: $640\nFalcons D/ST - $9,000"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    SITE.missing.update({"/koe_weeks.json", "/api/koe-payouts"})
    try:
        PAGE = SITE.open("promo-tools.html")
        PAGE.wait_for_function("() => typeof koeWeeks === 'function' && document.getElementById('koe-players').innerHTML !== ''")
        PAGE.evaluate("""(weeks) => { KOE_WEEKS = weeks; koeTeams = new Set(['ATL', 'NO']); renderKoe(); }""", weeks_file())
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def to_week(week):
    PAGE.evaluate("(w) => { koeWeekSel = koeIsLive(w) ? null : w; renderKoe(); }", week)


def log(payouts):
    PAGE.evaluate("(p) => { KOE_PAYOUTS = p; const box = document.getElementById('koe-winners-list'); delete box.dataset.drawn; renderKoeWinners(); }", payouts)


class WeekToggle(unittest.TestCase):
    def tearDown(self):
        to_week(PAGE.evaluate("() => koeLiveWeek()"))

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_the_weeks_are_the_saved_boards_and_this_week(self):
        live = PAGE.evaluate("() => koeLiveWeek()")
        self.assertEqual(PAGE.evaluate("() => koeWeeks()"), [4, live])

    def test_the_arrows_step_back_and_forward(self):
        live = PAGE.evaluate("() => koeLiveWeek()")
        PAGE.click("#koe-wk-prev")
        self.assertEqual(PAGE.evaluate("() => koeWeek()"), 4)
        self.assertIn("going into the week", PAGE.inner_text("#koe-week").lower())
        self.assertIn("Week 4", PAGE.inner_text("#koe-capture-title"))
        self.assertTrue(PAGE.evaluate("() => document.getElementById('koe-wk-prev').disabled"))
        PAGE.click("#koe-wk-next")
        self.assertEqual(PAGE.evaluate("() => koeWeek()"), live)
        self.assertNotIn("going into the week", PAGE.inner_text("#koe-week").lower())

    def test_a_past_week_lists_that_weeks_games_and_the_longest_td(self):
        to_week(4)
        self.assertIn("ATL", PAGE.inner_text("#koe-games"))
        cell = PAGE.evaluate("""() => { const tr = [...document.querySelectorAll('#koe-players tbody tr')].find((r) => r.textContent.includes('Bijan Robinson')); return tr ? tr.lastElementChild.textContent.trim() : null; }""")
        self.assertEqual(cell, "59 ★")

    def test_a_week_with_no_board_says_so(self):
        PAGE.evaluate("() => { koeWeekSel = 3; renderKoePlayers(); }")
        self.assertIn("no games before it", PAGE.inner_text("#koe-players"))


class Winners(unittest.TestCase):
    def tearDown(self):
        log({})

    def test_with_nothing_logged_it_says_what_comes(self):
        log({})
        self.assertIn("once its payouts are logged", PAGE.inner_text("#koe-winners-list"))

    def test_the_winner_his_place_going_in_and_what_he_paid(self):
        log({GAME: {"pool": 1000000, "payouts": PAGE.evaluate("(t) => koeParse(t, koeGame('2026_04_ATL_NO')).read", PASTED)}})
        board = PAGE.evaluate("() => koeBoard(4, ['ATL', 'NO'], KOE_WEEKS.boards['4']).map((r) => r.name)")
        place = board.index("Bijan Robinson") + 1
        line = PAGE.inner_text(f".koe-win-day[data-game='{GAME}'] summary")
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(place % 10 if place not in (11, 12, 13) else 0, "th")
        for bit in ("Robinson", "59", f"{place}{suffix} of {len(board)}", "$812"):
            self.assertIn(bit, line)
        self.assertIn("≈1,232 ON ROBINSON", PAGE.inner_text(f".koe-win-day[data-game='{GAME}'] .koe-win-meta").upper())
        rows = PAGE.evaluate(f"() => [...document.querySelectorAll(\".koe-win-day[data-game='{GAME}'] tbody tr\")].map((tr) => [...tr.children].map((td) => td.textContent.trim()))")
        self.assertEqual([r[1] for r in rows], ["59", "31", "5", ""])  # longest TD first; the D/ST scored none
        self.assertEqual([r[4] for r in rows], ["$812", "$2,950", "$640", "$9,000"])
        self.assertIn("ATL D/ST", rows[3][0])

    def test_newest_contest_first_and_only_it_open(self):
        log({GAME: {"pool": 1000000, "payouts": [{"id": "ATL", "name": "Bijan Robinson", "paid": 812}]},
             "2026_04_DET_CAR": {"pool": 1000000, "payouts": []}})
        days = PAGE.evaluate("() => [...document.querySelectorAll('.koe-win-day')].map((d) => [d.dataset.game, d.open])")
        self.assertEqual(days[0], [GAME, True])
        self.assertTrue(all(not open_ for _, open_ in days[1:]))

    def test_draftkings_list_is_read(self):
        got = PAGE.evaluate("(t) => koeParse(t, koeGame('2026_04_ATL_NO'))", PASTED)
        self.assertEqual(got["missed"], [])
        self.assertEqual([(p["name"], p["id"], p["paid"]) for p in got["read"]],
                         [("Bijan Robinson", "ATL", 812), ("Jahan Dotson", "ATL", 2950), ("Alvin Kamara", "NO", 640), ("ATL D/ST", "ATL", 9000)])

    def test_a_name_not_in_the_game_or_no_pool_blocks_the_save(self):
        log({})
        fill = """([text, pool]) => { document.getElementById('koe-log-game').value = '2026_04_ATL_NO'; document.getElementById('koe-log-pool').value = pool; const t = document.getElementById('koe-log-text'); t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); return [document.getElementById('koe-log-status').textContent, document.getElementById('koe-log-save').disabled]; }"""
        status, blocked = PAGE.evaluate(fill, [PASTED + "\nJosh Allen - $50", "1,000,000"])
        self.assertIn("Josh Allen", status)
        self.assertTrue(blocked)
        status, blocked = PAGE.evaluate(fill, [PASTED, ""])
        self.assertIn("pool", status.lower())
        self.assertTrue(blocked)
        status, blocked = PAGE.evaluate(fill, [PASTED, "1,000,000"])
        self.assertFalse(blocked)

    def test_never_in_the_saved_image(self):
        self.assertEqual(PAGE.evaluate("() => !!document.querySelector('#koe-capture #koe-winners')"), False)

    def test_the_paste_box_is_only_for_the_owner(self):
        rule = PAGE.evaluate("() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).map((r) => r.cssText).find((t) => t.includes('.koe-log') && t.includes('is-owner'))")
        self.assertIn("display: none", rule or "")


def player(name, pos, games, carries=0, targets=0, runs10=0, runs20=0, catches20=0, deep=0, tds=()):
    return {"name": name, "position": pos, "games": games, "carries": carries, "targets": targets, "receptions": targets,
            "runs10": runs10, "runs20": runs20, "runs40": 0, "catches20": catches20, "catches40": 0, "long_rush": 0,
            "long_rec": 0, "adot": 8.0, "deep_targets": deep, "deep_catches": 0, "tds": list(tds)}


class Upside(unittest.TestCase):
    """2026-10-19: a 2-touch fullback (one 20+ catch, all his touches catches,
    facing a defense that gives up lots of 20+ catches) ranked over Diggs and
    McCaffrey, because Upside was per GAME and the defense bonus ignored how
    much a player has the ball. Now every part is touches x per-touch rate."""

    def test_volume_beats_a_fullbacks_one_long_catch(self):
        board = PAGE.evaluate("""() => {
          const g = koeWeekGames()[0], w = koeLiveWeek();
          const k = {big: 20, huge: 40, deep_air: 20, players: PLAYERS(g.home, g.away), teams: {
            [g.away]: {games: 5, runs20_allowed: 2, catches20_allowed: 30, tds_allowed: [30, 40, 25]},
            [g.home]: {games: 5, runs20_allowed: 5, catches20_allowed: 5, tds_allowed: []}}};
          return koeLeague(w, k).filter((r) => r.team === g.home).sort((a, b) => b.score - a.score).map((r) => r.name);
        }""".replace("PLAYERS(g.home, g.away)", "({[g.home]: %s, [g.away]: %s})" % (
            [player("Fullback", "RB", 3, targets=6, catches20=1, tds=[6]),
             player("Workhorse", "RB", 5, carries=61, targets=25, runs10=10, tds=[11, 1, 1, 1, 1]),
             player("Deep WR", "WR", 4, targets=31, catches20=1, deep=6, tds=[20, 10, 4])],
            [player("Their WR", "WR", 5, targets=30, catches20=3, deep=5, tds=[30]),
             player("Their RB", "RB", 5, carries=70, targets=10, runs10=12, runs20=2, tds=[33, 1])])).replace("True", "true"))
        self.assertEqual(board[-1], "Fullback")


if __name__ == "__main__":
    unittest.main()
