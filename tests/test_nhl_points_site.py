"""The NHL Points page (site/nhl/points.js), run in a real browser on the saved
NHL data, Shots, Goals and Points samples (the Points sample is built from the
same games and prices: tools/make_nhl_points_sample.py).

What is pinned: the page shows what the build sent (the play's side, line and
price, the fair price of that side, the edge and its bucket: it does no
points math, so the record and the page can't disagree); the ranking (check
first, then the priced plays by edge, then players with no odds by their
chance); players who are out are left off; the columns and filters; the
breakdown (expected goals + expected assists, the price table with the first
price seen, the linemates box); a finished game shows real points and a win
or loss only for a player with a play; the record popup; the Points link in
the Player Props menu."""
import math
import unittest

from helpers import nhl_points  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT, LAST_NIGHT = "2026-10-13", "2026-10-12"

HEADS = """const heads = [...document.querySelectorAll('.shots-table thead th')].map((th) => (th.childNodes[0] || {}).textContent || '');"""
ROWS = """() => { """ + HEADS + """
  return [...document.querySelectorAll('.shots-row')].map((tr) => {
    const td = (label) => tr.children[heads.indexOf(label)];
    const cell = (label) => td(label).textContent.trim().replace(/\\s+/g, ' ');
    return { key: tr.dataset.row, play: cell('Play'), rating: cell('Rating'), fair: cell('Fair'), edge: cell('Edge'), p: cell('P'),
             noodds: !!tr.querySelector('.goals-noodds'), amber: td('Edge').classList.contains('tier-mid'),
             green: td('Edge').classList.contains('tier-good'), result: heads.includes('Result') ? cell('Result') : null };
  });
}"""
HEADERS = "() => { " + HEADS + " return heads; }"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/points.html")
        PAGE.wait_for_function("() => typeof POINTS !== 'undefined' && POINTS !== null && !document.getElementById('shots-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def reset(day=TONIGHT, **view):
    PAGE.evaluate(
        """([day, view]) => {
            closePlayerCard();
            Object.assign(pointsView, { pos: 'all', lineup: 'all', odds: 'all', sort: 'edge', dir: -1, open: null, when: 'all', checks: true, adv: false }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def built(day=TONIGHT):
    """Every player the build sent for the day's games, by "game:player"."""
    data = nhl_points()
    games = PAGE.evaluate("(day) => gamesOn(day).map((g) => g.game_id)", day)
    return {f"{gid}:{r['id']}": r for gid in games if gid in data["games"] for r in data["games"][gid]["players"]}


def price(n):
    return f"+{n}" if n > 0 else str(n)


def fair(p):
    """points.js fairPrice, with JavaScript's Math.round (halves round up; Python's round goes to even)."""
    js_round = lambda x: math.floor(x + 0.5)
    return js_round(-100 * p / (1 - p)) if p >= 0.5 else js_round(100 * (1 - p) / p)


class Rows(unittest.TestCase):
    def test_the_page_shows_what_the_build_sent(self):
        rows = reset()
        sent = built()
        self.assertEqual({r["key"] for r in rows}, {k for k, r in sent.items() if not r["out"]})
        self.assertTrue(any(r["side"] for r in sent.values()))
        for row in rows:
            r = sent[row["key"]]
            self.assertEqual(row["p"], f"{r['points']} /{r['games']}gp")
            if not r["side"]:
                self.assertTrue(row["noodds"])
                self.assertEqual(row["edge"], "--")
                self.assertEqual(row["fair"], price(fair(r["chance"])))
                continue
            chance = r["chance_over"] if r["side"] == "over" else 1 - r["chance_over"]
            self.assertEqual(row["play"], f"{r['side'][0]}{r['line']:.1f}{price(r['price'])}")
            self.assertEqual(row["fair"], price(fair(chance)))
            self.assertTrue(row["edge"].startswith(f"{r['edge'] * 100:+.1f}".replace("+0.0", "0.0").replace("-0.0", "0.0")), (row, r["edge"]))
            self.assertEqual(row["amber"], r["size"] == "check")
            self.assertEqual(row["green"], r["size"] in ("lean", "strong"))
            rating = {"strong": "Strong", "lean": "Lean", "none": "--", "check": "Check" if r["edge"] >= nhl_points()["edges"]["check"] else "New line"}[r["size"]]
            self.assertTrue(row["rating"].startswith(rating), (r["name"], r["size"], row["rating"]))
        self.assertEqual(SITE.errors, [])

    def test_the_columns(self):
        reset()
        self.assertEqual(PAGE.evaluate(HEADERS), ["#", "Player", "Line", "Play", "Rating", "P", "Fair", "Edge", ""])
        PAGE.click("#shots-adv-toggle")
        self.assertEqual(PAGE.evaluate(HEADERS)[8:], ["Min", "xG", "xA", "Opp", "Goalie", "Linemates", "Home/rest", ""])
        PAGE.click("#shots-adv-toggle")
        self.assertEqual(len(PAGE.evaluate(HEADERS)), 9)

    def test_check_first_then_plays_by_edge_then_no_odds_by_chance(self):
        rows = reset()
        sent = built()
        group = lambda r: 0 if r["size"] == "check" else 1 if r["edge"] is not None else 2
        groups = [group(sent[row["key"]]) for row in rows]
        self.assertEqual(groups, sorted(groups))
        self.assertIn(1, groups)
        for g, key in ((0, "edge"), (1, "edge"), (2, "chance")):
            values = [sent[row["key"]][key] for row in rows if group(sent[row["key"]]) == g]
            self.assertEqual(values, sorted(values, reverse=True))

    def test_the_filters(self):
        everyone = reset()
        priced = reset(odds="priced")
        sent = built()
        self.assertTrue(priced and all(sent[r["key"]]["line"] is not None for r in priced))
        self.assertLess(len(priced), len(everyone))
        defense = reset(pos="D")
        self.assertTrue(defense and all(sent[r["key"]]["pos"] == "D" for r in defense))


class Breakdown(unittest.TestCase):
    def test_a_row_opens_how_its_chance_is_built(self):
        rows = reset()
        key = next(r["key"] for r in rows if not r["noodds"])
        r = built()[key]
        PAGE.click(f'.shots-row[data-row="{key}"] td.shots-rank')
        text = PAGE.locator(".shots-detail").inner_text()
        self.assertIn("how tonight's chance is built", text.lower())
        self.assertIn(f"{r['g_mean']:.2f} G + {r['a_mean']:.2f} A", text)
        self.assertIn(f"{r['goals']} G · {r['assists']} A · {r['points']} P", text)
        # The price table: the 0.5 line both ways and 2+, Novig's price and the first one seen.
        table = PAGE.evaluate("() => [...document.querySelectorAll('.shots-detail .shots-ladder tbody tr')].map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim())")
        self.assertEqual([t.split(" ")[0] for t in table], ["1", "None", "2", "1"])
        if r["line"] == 0.5:
            self.assertIn(price(r["over"]), table[0])
            self.assertIn(price(r["first"]["over"]), table[0])
        # No lineup posted in the sample: the linemates box says when it fills in.
        self.assertIn("linemates tonight", PAGE.locator(".points-mates-box").inner_text().lower())


class Finished(unittest.TestCase):
    def test_last_nights_games_show_real_points(self):
        rows = reset(LAST_NIGHT)
        sent = built(LAST_NIGHT)
        self.assertTrue(rows)
        for row in rows:
            r = sent[row["key"]]
            self.assertTrue(row["result"].endswith(str(r["actual"])) if r["actual"] is not None else row["result"] == "--")
            graded = r["side"] is not None and r["actual"] is not None and r["actual"] != r["line"]
            self.assertEqual(row["result"][:1] in "WL" and row["result"][1:2] == " ", graded, r["name"])


class Record(unittest.TestCase):
    def test_the_record_popup(self):
        reset()
        PAGE.click("#shots-record-open")
        text = PAGE.locator("#shots-results").inner_text()
        record = nhl_points()["record"]
        self.assertIn(f"{record['games']} games, {record['players']} players graded", text)
        self.assertIn("closing line value", text.lower())
        self.assertIn("said vs got", text.lower())
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.locator("#shots-record-modal").is_hidden())


class Nav(unittest.TestCase):
    def test_points_is_in_the_player_props_menu(self):
        reset()
        PAGE.click(".page-nav .nhl-trigger")
        items = PAGE.evaluate("() => [...document.querySelectorAll('.nhl-menu a')].map((a) => [a.textContent, a.classList.contains('promo-current')])")
        self.assertEqual(items, [["Game Previews", False], ["Best Plays", False], ["Shots", False], ["Goals", False], ["Points", True], ["Line Stacks", False]])
        PAGE.keyboard.press("Escape")


if __name__ == "__main__":
    unittest.main()
