"""The NHL Promo Tools page (site/nhl/promo-tools.js: King of the Crease), run
in a real browser on the saved NHL data and crease samples.

What is pinned: one row per starter, best Upside first; the page shows the
build's numbers and tags and adds none of its own; every column sorts and a
goalie with nothing to sort on sinks; the whole slate is always shown and only Value gets a chip; a goalie with no line has no
Value; the model-and-line gap is marked; the two matchup columns are on the
eight rank colors; a day with no board says so; logos come from a host the
saved image can carry."""
import unittest

from helpers import nhl_crease  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT = "2026-10-13"

ROWS = """() => [...document.querySelectorAll('.crease-row')].map((tr) => {
    const cells = [...tr.children].filter((td) => !td.classList.contains('koe-gap'));
    const text = (i) => cells[i].textContent.trim();
    return { team: tr.dataset.team, name: tr.querySelector('.koe-name').textContent, sure: !!tr.querySelector('.crease-sure'), split: (tr.querySelector('.crease-split') || { textContent: '' }).textContent,
        tags: [...tr.querySelectorAll('.crease-tag')].map((t) => t.textContent.toLowerCase()),
        line: text(1), avg: text(2), opp: text(5), allowed: text(6), shots: text(7), saves: text(8), big: text(9), upside: text(10), value: text(11),
        check: !!tr.querySelector('.crease-pill-check'), ranked: [5, 6].map((i) => cells[i].classList.contains('nhl-rank-cell')), colored: [1, 2].map((i) => cells[i].classList.contains('nhl-rank-cell')) };
})"""


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/promo-tools.html")
        PAGE.wait_for_function("() => typeof CREASE !== 'undefined' && CREASE !== null && !document.getElementById('crease-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def reset(day=TONIGHT, **view):
    PAGE.evaluate(
        """([day, view]) => { Object.assign(creaseView, { sort: 'top', dir: -1 }, view); selectDay(days().indexOf(day)); }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def built(day=TONIGHT):
    return nhl_crease()["days"][day]["goalies"]


class Board(unittest.TestCase):
    def test_no_script_errors(self):
        self.assertEqual(SITE.errors, [])

    def test_it_opens_on_the_days_board(self):
        self.assertEqual(PAGE.evaluate("() => days()[dayIndex]"), TONIGHT)

    def test_one_row_per_starter_best_upside_first(self):
        rows = reset()
        want = sorted(built(), key=lambda r: -r["top"])
        self.assertEqual([r["team"] for r in rows], [r["team"] for r in want])
        self.assertEqual(len(rows), 32)

    def test_the_numbers_and_tags_are_the_builds(self):
        rows = {r["team"]: r for r in reset()}
        for b in built():
            r = rows[b["team"]]
            self.assertEqual(r["name"], b["name"] or "Starter TBD")
            self.assertEqual(r["saves"], f"{b['mean']:.1f}")
            self.assertEqual(r["line"], "" if b["line"] is None else f"{b['line']:.1f}")
            self.assertEqual(r["tags"], [t for t in b["tags"] if t == "value"])  # Upside has its column, not a chip
            self.assertEqual(r["colored"], [b["line"] is not None, b["saves_avg"] is not None])
            self.assertEqual(r["sure"], b["source"] == "both")  # a check mark needs two sources
            self.assertEqual(r["split"], f"\u26a0 or {b['other']}" if b["source"] == "split" else "\u26a0" if b["doubt"] else "")
            self.assertEqual(r["value"].rstrip("?"), "" if b["value"] is None else f"{b['value']:.2f}")
            self.assertEqual(r["check"], bool(b["check"]) and b["value"] is not None)
            self.assertEqual(r["ranked"], [True, True])

    def test_a_goalie_with_no_line_has_no_value(self):
        rows = {r["team"]: r for r in reset()}
        unlined = [b for b in built() if b["line"] is None]
        self.assertTrue(unlined)
        for b in unlined:
            self.assertEqual((rows[b["team"]]["line"], rows[b["team"]]["value"]), ("", ""))

    def test_the_count_line(self):
        reset()
        rows = built()
        split = sum(r["source"] == "split" for r in rows)
        self.assertEqual(PAGE.inner_text("#crease-count"), f"32 starters · two sources agree on {sum(r['source'] == 'both' for r in rows)}{f' · {split} in dispute' if split else ''} · lines for {sum(r['line'] is not None for r in rows)}")


class Sorting(unittest.TestCase):
    def test_every_column_sorts(self):
        reset()
        keys = PAGE.evaluate("() => [...document.querySelectorAll('.crease-table .koe-sort')].map((th) => th.dataset.sort)")
        self.assertEqual(keys, ["name", "line", "saves_avg", "sv_pct", "high", "opp_shots", "allowed", "shots", "mean", "big", "top", "value"])
        for key in keys:
            PAGE.click(f'.crease-table .koe-sort[data-sort="{key}"]')
            self.assertEqual(PAGE.evaluate("() => creaseView.sort"), key)
            self.assertEqual(len(PAGE.evaluate(ROWS)), 32)

    def test_by_line_and_back(self):
        rows = reset(sort="line")
        lined = [float(r["line"]) for r in rows if r["line"]]
        self.assertEqual(lined, sorted(lined, reverse=True))
        self.assertTrue(all(not r["line"] for r in rows[len(lined):]))  # no line: at the bottom
        PAGE.click('.crease-table .koe-sort[data-sort="line"]')
        rows = PAGE.evaluate(ROWS)
        again = [float(r["line"]) for r in rows if r["line"]]
        self.assertEqual(again, sorted(again))
        self.assertTrue(all(not r["line"] for r in rows[len(again):]))  # still at the bottom

    def test_by_name(self):
        rows = reset(sort="name", dir=1)
        self.assertEqual(rows[0]["name"], min(b["name"] for b in built() if b["name"]))

    def test_the_whole_slate_whatever_the_sort(self):
        self.assertEqual(len(reset(sort="value")), 32)
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.crease-show-btn').length"), 0)


class Page(unittest.TestCase):
    def test_a_day_without_a_board_says_so(self):
        last = PAGE.evaluate("() => days()[days().length - 1]")
        self.assertEqual(reset(last), [])
        self.assertIn("No board for this day", PAGE.inner_text("#crease-table"))
        reset()

    def test_the_title_bar_names_the_day(self):
        reset()
        self.assertIn("16 games", PAGE.evaluate("() => document.getElementById('crease-capture-sub').textContent"))

    def test_logos_the_saved_image_can_carry(self):
        reset()
        hosts = PAGE.evaluate("() => [...new Set([...document.querySelectorAll('.crease-table img')].map((img) => new URL(img.src).host))]")
        self.assertEqual(hosts, ["a.espncdn.com"])
        codes = PAGE.evaluate("() => ['LAK', 'NJD', 'SJS', 'TBL', 'UTA', 'TOR'].map((t) => /nhl\\/500(-dark)?\\/(\\w+)\\.png/.exec(shareLogo(t))[2])")
        self.assertEqual(codes, ["la", "nj", "sj", "tb", "utah", "tor"])

    def test_the_record_waits_for_a_finished_day(self):
        self.assertIn("The record starts", PAGE.inner_text("#crease-record"))

    def test_the_other_nhl_pages_link_here(self):
        for path in ("nhl/index.html", "nhl/shots.html"):
            page = SITE.open(path)
            self.assertEqual(page.evaluate("() => !!document.querySelector('.page-nav a[href=\"promo-tools.html\"]')"), True)
            page.close()


if __name__ == "__main__":
    unittest.main()
