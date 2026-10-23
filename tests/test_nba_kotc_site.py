"""The NBA Promo Tools page (site/nba/kotc.js: King of the Court) in a real
browser, on a hand-made nba/data.json built by kotc.py's own functions from
test_nba_kotc's small season.

What is pinned: the page shows the build's projections and chances and does
no math of its own; best chance first, Out players last with no chance; every
column sorts; this season only (no season switch); stepping back to a
finished night shows its pregame board against what happened; the defense
board sits beside the player board, lists every team, dims the ones not
playing and names each team's top 3 targets; the nightly leaders list; the
payout box reads DraftKings' list, and Est Pay shows only once enough payouts
are logged; the Historical Data popup (last season's, labeled, until this
season has 20 nights); the Promo Tools menu links here."""
import unittest

from helpers import SAMPLE_BUILT_UTC  # noqa: F401  first: puts tools/ on the import path

from site_browser import SiteBrowser
from test_nba_kotc import LINES, SEASON, TEAMS, kotc

SITE = PAGE = None
NIGHT = "2026-10-20"
PAST = "2026-01-02"  # a finished night in SEASON (Star A and Star C tie at 50)
FIRST = "2026-01-01"  # the night before (Star A alone, 62)
RECORD = {PAST: {"season_used": "2026-27", "board": [{"id": "20", "name": "Star B", "team": "BBB", "proj": 41.0, "lead": 0.5},
                                                   {"id": "10", "name": "Star A", "team": "AAA", "proj": 38.0, "lead": 0.3},
                                                   {"id": "30", "name": "Star C", "team": "CCC", "proj": 33.0, "lead": 0.1},
                                                   {"id": "40", "name": "Star D", "team": "DDD", "proj": 32.0, "lead": 0.06},
                                                   {"id": "11", "name": "Big A", "team": "AAA", "proj": 25.0, "lead": 0.02},
                                                   {"id": "99", "name": "Scratch Guy", "team": "DDD", "proj": 30.0, "lead": 0.02}]},
          FIRST: {"season_used": "2026-27", "board": [{"id": "10", "name": "Star A", "team": "AAA", "proj": 40.0, "lead": 0.4},
                                                    {"id": "20", "name": "Star B", "team": "BBB", "proj": 38.0, "lead": 0.3},
                                                    {"id": "30", "name": "Star C", "team": "CCC", "proj": 34.0, "lead": 0.15},
                                                    {"id": "40", "name": "Star D", "team": "DDD", "proj": 33.0, "lead": 0.1},
                                                    {"id": "11", "name": "Big A", "team": "AAA", "proj": 26.0, "lead": 0.05}]}}


def nba_data():
    old = kotc.MIN_GAMES
    kotc.MIN_GAMES = 1
    try:
        pg = kotc.player_games(SEASON, TEAMS)
        blocks = {"2027": kotc.season_block(pg, LINES, "2026-27")}
        games = [
            {"game_id": "9", "date": NIGHT, "time": "19:30", "start_utc": "2026-10-20T23:30Z", "away": "BBB", "home": "AAA", "status": "scheduled",
             "home_team_spread": -4.0, "away_team_spread": 4.0, "total_line": 232.0},
            {"game_id": "8", "date": "2026-10-21", "time": "19:00", "start_utc": "2026-10-21T23:00Z", "away": "DDD", "home": "CCC", "status": "scheduled"},
        ]
        teams_now = {"10": "AAA", "11": "AAA", "20": "BBB", "21": "BBB", "30": "CCC", "40": "DDD"}
        slates = {s: kotc.slate(b, games, teams_now, {"11"}, [NIGHT, "2026-10-21"]) for s, b in blocks.items()}
    finally:
        kotc.MIN_GAMES = old
    for b in blocks.values():
        b.pop("_league")
    past = kotc.past_nights(pg, RECORD, NIGHT)
    teams = {t: {"name": t, "short": t, "logo": "", "color": "555555"} for t in TEAMS}
    return {
        "season": 2027, "season_label": "2026-27", "teams": teams, "schedule": games, "team_stats": {}, "players": {}, "injuries": {},
        "kotc": {"default": "2027", "weights": kotc.WEIGHTS, "thresholds": list(kotc.THRESHOLDS), "seasons": blocks, "slates": slates,
                 "past": past, "reference": {"label": "2025-26", "summary": blocks["2027"]["summary"]}, "record": RECORD},
    }


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        SITE.nba = nba_data()
        PAGE = SITE.open("nba/promo-tools.html")
        PAGE.wait_for_function("() => KOTC && document.querySelector('.kotc-table')")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


ROWS = """() => [...document.querySelectorAll('#kotc-players tbody tr[data-player]')].map((tr) => ({
    id: tr.dataset.player, out: tr.classList.contains('kotc-out'), lead: tr.children[2].textContent.trim(), proj: tr.children[3].textContent.trim() }))"""


def show(date):
    PAGE.evaluate(f"() => {{ Object.assign(playerSort, {{ key: 'lead', dir: -1 }}); Object.assign(pastSort, {{ key: 'pra', dir: -1 }}); defPlayingOnly = false; dayIndex = days().indexOf('{date}'); render(); }}")


class Board(unittest.TestCase):
    def setUp(self):
        show(NIGHT)

    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_shows_the_builds_numbers_best_chance_first_out_last(self):
        rows = PAGE.evaluate(ROWS)
        built = {r["id"]: r for r in SITE.nba["kotc"]["slates"]["2027"][NIGHT]}
        self.assertEqual({r["id"] for r in rows}, set(built))
        live = [r for r in rows if not r["out"]]
        self.assertEqual([r["id"] for r in live], [r["id"] for r in sorted((b for b in built.values() if not b["out"]), key=lambda b: -b["lead"])])
        for r in live:
            self.assertEqual(r["proj"], f"{built[r['id']]['proj']:.1f}")
        self.assertEqual([r["id"] for r in rows if r["out"]], ["11"])
        self.assertEqual(rows[-1], {"id": "11", "out": True, "lead": "--", "proj": rows[-1]["proj"]})

    def test_every_column_sorts(self):
        heads = PAGE.evaluate("() => [...document.querySelectorAll('#kotc-players thead th')].map((th) => th.textContent.replace(/[^A-Za-z0-9 %+]/g, '').trim())")
        for gone in ("L10", "Score", "Matchup", "Est Pay"):  # Est Pay waits for logged payouts
            self.assertNotIn(gone, heads)
        self.assertIn("Opp Top", heads)
        self.assertNotIn("from", PAGE.inner_text("#kotc-players"))
        for key in ("name", "proj", "pra", "b0", "b4", "opp", "oppTop", "vspos", "total", "spread"):
            PAGE.evaluate(f"() => document.querySelector('[data-sort=\"{key}\"]').click()")
            rows = PAGE.evaluate(ROWS)
            self.assertEqual(len(rows), len(SITE.nba["kotc"]["slates"]["2027"][NIGHT]), key)
            self.assertEqual(rows[-1]["id"], "11", key)  # Out stays last whatever the sort
        self.assertEqual(SITE.errors, [])

    def test_this_season_only(self):
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('[data-season]').length"), 0)
        self.assertEqual(PAGE.evaluate("() => season"), "2027")

    def test_the_defense_board_sits_beside_the_players(self):
        PAGE.set_viewport_size({"width": 1920, "height": 1000})
        try:
            box = PAGE.evaluate("() => [document.getElementById('kotc-capture'), document.querySelector('.kotc-def')].map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right])")
            (pl, pt, pr), (dl, dt, _) = box
            self.assertGreaterEqual(dl, pr)
            self.assertAlmostEqual(pt, dt, delta=40)
        finally:
            PAGE.set_viewport_size({"width": 1280, "height": 900})


class FinishedNight(unittest.TestCase):
    def setUp(self):
        show(PAST)

    def test_back_arrow_reaches_it(self):
        show(NIGHT)
        PAGE.click("#kotc-day-prev")
        self.assertEqual(PAGE.evaluate("() => days()[dayIndex]"), PAST)
        self.assertTrue(PAGE.evaluate("() => document.getElementById('kotc-day-next').disabled === false"))

    def test_pregame_board_against_what_happened(self):
        rows = PAGE.evaluate("""() => [...document.querySelectorAll('.kotc-past-table tbody tr')].map((tr) => ({
            id: tr.dataset.player, pre: tr.children[0].textContent.trim(), pra: tr.children[2].textContent.trim(), won: tr.classList.contains('kotc-won'), dnp: tr.textContent.includes('DNP') }))""")
        self.assertEqual([r["pra"] for r in rows if not r["dnp"]], ["50", "50", "39", "35", "25"])
        self.assertEqual(sorted(r["id"] for r in rows if r["won"]), ["10", "30"])  # the tie: both crowned
        self.assertEqual(rows[-1], {"id": "99", "pre": "6", "pra": "--", "won": False, "dnp": True})  # didn't play: last
        self.assertEqual({r["id"]: r["pre"] for r in rows}["20"], "1")
        self.assertIn("final", PAGE.text_content("#kotc-capture-sub"))
        self.assertEqual(SITE.errors, [])

    def test_its_columns_sort_and_dnp_stays_last(self):
        for key in ("rank", "name", "lead", "proj", "opp", "pra"):
            PAGE.evaluate(f"() => document.querySelector('[data-pastsort=\"{key}\"]').click()")
            last = PAGE.evaluate("() => [...document.querySelectorAll('.kotc-past-table tbody tr')].pop().dataset.player")
            self.assertEqual(last, "99", key)

    def test_defense_board_shows_that_nights_teams(self):
        playing = PAGE.evaluate("() => [...document.querySelectorAll('.kotc-def-table tbody tr.kotc-playing .kotc-team b')].map((b) => b.textContent)")
        self.assertEqual(sorted(playing), sorted(TEAMS))


class Payouts(unittest.TestCase):
    def tearDown(self):
        PAGE.evaluate("() => { PAYOUTS = {}; fitCache = undefined; render(); }")

    def test_the_box_reads_draftkings_list(self):
        show(PAST)
        PAGE.select_option("#kotc-log-date", PAST)
        PAGE.fill("#kotc-log-pool", "250,000")
        PAGE.fill("#kotc-log-text", "\u2b50 Star A - $1,250 in Bonus Bets\nStár C - $900\nNobody - $5")
        self.assertIn("Nobody", PAGE.inner_text("#kotc-log-status"))
        self.assertTrue(PAGE.evaluate("() => document.getElementById('kotc-log-save').disabled"))
        PAGE.fill("#kotc-log-text", "Star A - $1,250 in Bonus Bets\nStar C - $900")
        self.assertEqual(PAGE.evaluate("() => payoutFormRead().read"), [{"id": "10", "name": "Star A", "paid": 1250}, {"id": "30", "name": "Star C", "paid": 900}])
        self.assertFalse(PAGE.evaluate("() => document.getElementById('kotc-log-save').disabled"))

    def test_est_pay_shows_once_six_are_logged_and_follows_the_fit(self):
        show(NIGHT)
        # Paid = 30 / Lead % on each board player: the fit must give it back.
        log = lambda date, keep: f"past()['{date}'].rows.filter((r) => r.lead && {keep}).map((r) => ({{ id: r.id, name: r.name, paid: Math.round(30 / r.lead) }}))"
        PAGE.evaluate(f"() => {{ PAYOUTS = {{ '{FIRST}': {{ pool: 250000, payouts: {log(FIRST, 'true')} }} }}; fitCache = undefined; render(); }}")
        self.assertNotIn("Est Pay", PAGE.text_content("#kotc-players thead"))  # 5 is too few
        PAGE.evaluate(f"() => {{ PAYOUTS['{PAST}'] = {{ pool: 250000, payouts: {log(PAST, 'r.pra !== 50')} }}; fitCache = undefined; render(); }}")
        self.assertIn("Est Pay", PAGE.text_content("#kotc-players thead"))
        self.assertAlmostEqual(PAGE.evaluate("() => estPay(0.1)"), 300, delta=3)
        self.assertEqual(SITE.errors, [])

    def test_a_logged_payout_shows_on_the_night(self):
        PAGE.evaluate(f"() => {{ PAYOUTS = {{ '{PAST}': {{ pool: 250000, payouts: [{{ id: '10', name: 'Star A', paid: 1250 }}] }} }}; render(); }}")
        show(PAST)
        paid = PAGE.evaluate("() => Object.fromEntries([...document.querySelectorAll('.kotc-past-table tbody tr')].map((tr) => [tr.dataset.player, tr.lastElementChild.textContent.trim()]))")
        self.assertEqual(paid["10"], "$1,250")
        self.assertEqual(paid["30"], "")


class DefenseAndHistory(unittest.TestCase):
    def setUp(self):
        show(NIGHT)

    def test_defense_board_lists_every_team_and_dims_idle_ones(self):
        rows = PAGE.evaluate("() => [...document.querySelectorAll('.kotc-def-table tbody tr')].map((tr) => [tr.querySelector('b').textContent, tr.classList.contains('kotc-playing')])")
        self.assertEqual(sorted(t for t, _ in rows), sorted(TEAMS))
        self.assertEqual(sorted(t for t, playing in rows if playing), ["AAA", "BBB"])

    def test_hide_teams_not_playing_and_back(self):
        teams = "() => [...document.querySelectorAll('.kotc-def-table tbody .kotc-team b')].map((b) => b.textContent)"
        PAGE.click("#kotc-def-playing")
        self.assertEqual(sorted(PAGE.evaluate(teams)), ["AAA", "BBB"])
        PAGE.click("#kotc-def-playing")
        self.assertEqual(sorted(PAGE.evaluate(teams)), sorted(TEAMS))

    def test_targets_are_the_top_3_by_lead_on_the_team_they_face(self):
        cells = PAGE.evaluate("() => Object.fromEntries([...document.querySelectorAll('.kotc-def-table tbody tr')].map((tr) => [tr.querySelector('.kotc-team b').textContent, [...tr.querySelectorAll('.kotc-targets span')].map((s) => s.title)]))")
        names = SITE.nba["kotc"]["seasons"]["2027"]["players"]
        # Four players against AAA: only the 3 best chances are named, best first.
        extra = [{"id": "30", "team": "BBB", "opp": "AAA", "game_id": "9", "home": False, "proj": 20.0, "b2b": False, "out": False, "lead": 0.001},
                 {"id": "40", "team": "BBB", "opp": "AAA", "game_id": "9", "home": False, "proj": 19.0, "b2b": False, "out": False, "lead": 0.0005}]
        rows = [r for r in SITE.nba["kotc"]["slates"]["2027"][NIGHT] if not r.get("out")]
        for d in TEAMS:
            want = [names[r["id"]]["name"] for r in sorted((r for r in rows if r["opp"] == d), key=lambda r: -r["lead"])][:3]
            self.assertEqual(cells[d], want, d)
        PAGE.evaluate(f"() => {{ KOTC.slates['2027']['{NIGHT}'].push(...{extra!r}.map((r) => JSON.parse(JSON.stringify(r)))); render(); }}".replace("False", "false"))
        try:
            got = PAGE.evaluate("() => [...[...document.querySelectorAll('.kotc-def-table tbody tr')].find((tr) => tr.querySelector('.kotc-team b').textContent === 'AAA').querySelectorAll('.kotc-targets span')].map((s) => s.title)")
            self.assertEqual(len(got), 3)
            self.assertNotIn("Star D", got)
        finally:
            PAGE.evaluate(f"() => {{ KOTC.slates['2027']['{NIGHT}'].splice(-2); render(); }}")

    def test_nightly_leaders_newest_first_with_ties(self):
        nights = PAGE.evaluate("""() => [...document.querySelectorAll('.kotc-night')].map((n) => ({
            names: [...n.querySelectorAll('.koe-win-names')].map((e) => e.textContent), tie: !!n.querySelector('.kotc-tie-tag'),
            cut: [...n.querySelectorAll('.koe-win-names')].some((e) => e.scrollWidth > e.clientWidth + 1),
            pre: [...n.querySelectorAll('.kotc-night-one')].map((e) => (e.querySelector('.koe-win-rank') || {}).textContent || '') }))""")
        # A tie: both co-leaders on their own line, each with his own Pre place, neither name cut off.
        self.assertEqual(nights[0], {"names": ["Star A", "Star C"], "tie": True, "cut": False, "pre": ["Pre 2", "Pre 3"]})
        self.assertEqual(nights[1]["names"], ["Star A"])
        self.assertFalse(nights[1]["tie"])

    def test_a_tie_shows_each_winners_payout_and_stays_out_of_the_fit(self):
        PAGE.evaluate(f"() => {{ PAYOUTS = {{ '{PAST}': {{ pool: 250000, payouts: [{{ id: '10', name: 'Star A', paid: 600 }}, {{ id: '30', name: 'Star C', paid: 600 }}] }} }}; fitCache = undefined; render(); }}")
        try:
            paid = PAGE.evaluate("() => [...[...document.querySelectorAll('.kotc-night')][0].querySelectorAll('.kotc-night-paid')].map((e) => e.textContent.trim())")
            self.assertEqual(paid, ["$600", "$600"])
            # Four more: six logged, but the two tied winners don't count, so no fit yet (it needs 6).
            PAGE.evaluate(f"() => {{ PAYOUTS['{PAST}'].payouts.push(...past()['{PAST}'].rows.filter((r) => r.lead && r.pra !== 50).map((r) => ({{ id: r.id, name: r.name, paid: Math.round(30 / r.lead) }}))); fitCache = undefined; }}")
            self.assertEqual(PAGE.evaluate(f"() => PAYOUTS['{PAST}'].payouts.length"), 6)
            self.assertIsNone(PAGE.evaluate("() => payoutFit()"))
        finally:
            PAGE.evaluate("() => { PAYOUTS = {}; fitCache = undefined; render(); }")

    def test_historical_data_opens_and_closes(self):
        PAGE.click("#kotc-history-btn")
        self.assertFalse(PAGE.evaluate("() => document.getElementById('kotc-history-modal').hidden"))
        # This season only, however few nights (the owner, 2026-10-23: last season's reference came off).
        self.assertIn("2026-27", PAGE.inner_text("#kotc-hist-season"))
        self.assertNotIn("reference", PAGE.text_content("#kotc-hist-season"))
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.kotc-hist-tile').length"), 4)
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('kotc-history-modal').hidden"))

    def test_promo_menu_links_here(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.promo-menu a')].map((a) => a.getAttribute('href'))")
        self.assertIn("/nba/promo-tools.html", links)


if __name__ == "__main__":
    unittest.main()
