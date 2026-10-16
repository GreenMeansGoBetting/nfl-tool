"""The NHL Line Stacks page (site/nhl/stacks.js) and the Points page's "Best
stacks" box, run in a real browser on the saved NHL data and a Line Stacks
sample built from the Points sample by the build's own functions
(helpers.nhl_stacks).

What is pinned: the page shows what the build sent (Score, each leg's GMG
fair price, the stack's fair price, the correlation; it does no stack math);
best Score first; the filters; the exact text Copy puts on the clipboard; a
finished game's Hit / Miss / Void; the record popup; the Points page's box
(his stacks, best Score first); the nav and the Player Props menu."""
import re
import unittest
from pathlib import Path

from helpers import nhl_stacks  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT, LAST_NIGHT = "2026-10-13", "2026-10-12"
ROWS = """() => [...document.querySelectorAll('.stk-row')].map((tr) => ({
  score: Number(tr.querySelector('.stk-score').textContent),
  legs: tr.querySelectorAll('.stk-leg').length,
  fair: tr.querySelector('.stk-fair-big').textContent.trim(),
  copy: tr.querySelector('.stk-copy').dataset.copy,
  shown: tr.nextElementSibling.querySelector('code').textContent,
  result: (tr.lastElementChild.textContent || '').trim(),
}))"""


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/stacks.html")
        PAGE.wait_for_function("() => typeof STACKS !== 'undefined' && STACKS !== null && !document.getElementById('shots-app').hidden")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def show(day=TONIGHT, **view):
    PAGE.evaluate(
        """([day, view]) => {
            Object.assign(stacksView, { kind: 'all', legs: 'all', sort: 'score', when: 'all', shown: 50 }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


class LineStacksPage(unittest.TestCase):
    def test_best_score_first_as_the_build_sent_it(self):
        rows = show()
        self.assertEqual(len(rows), 50)
        self.assertEqual([r["score"] for r in rows], sorted((r["score"] for r in rows), reverse=True))
        sent = {(s["score"], s["fair"]) for g in nhl_stacks()["games"].values() for s in g["stacks"]}
        for r in rows:
            fair = int(r["fair"].replace("+", ""))
            self.assertIn((r["score"], fair), sent)
        self.assertIn("Show 50 more", PAGE.inner_text("#shots-content"))
        self.assertEqual(SITE.errors, [])

    def test_the_filters(self):
        self.assertEqual({r["legs"] for r in show(legs="3")}, {3})
        show()
        kinds = PAGE.evaluate("() => [...new Set(sortedRows(days()[dayIndex]).map((x) => x.s.kind))]")
        self.assertEqual(len(kinds), 7)  # every kind but power play (the sample has no shared-ice history)
        show(kind="d_pair")
        self.assertEqual(set(PAGE.evaluate("() => sortedRows(days()[dayIndex]).map((x) => x.s.kind)")), {"d_pair"})

    def test_copy_says_exactly_what_is_shown(self):
        for r in show()[:5]:
            self.assertEqual(r["copy"], r["shown"])
            self.assertRegex(r["copy"], r"^[^/]+ 1\+ Point( / [^/]+ 1\+ Point){1,3} \([A-Z]{3} @ [A-Z]{3}\)$")
        SITE.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=SITE.origin)
        PAGE.click(".stk-copy")
        PAGE.wait_for_function("() => document.querySelector('.stk-copy').textContent === 'Copied'", timeout=5000)
        self.assertEqual(PAGE.evaluate("() => navigator.clipboard.readText()"), show()[0]["copy"])

    def test_a_finished_game_is_graded(self):
        rows = show(LAST_NIGHT)
        self.assertTrue(rows)
        self.assertTrue({r["result"] for r in rows} <= {"Hit", "Miss", "Void"})
        self.assertIn("RESULT", PAGE.inner_text(".stk-table thead").upper())

    def test_the_record_popup(self):
        PAGE.click("#shots-record-open")
        text = PAGE.inner_text("#shots-results")
        self.assertIn("stacks graded in 3 games", text)
        self.assertIn("BY STACK TYPE", text.upper())
        PAGE.keyboard.press("Escape")

    def test_nav_and_words(self):
        site = Path(__file__).resolve().parent.parent / "nfl_tool" / "site" / "nhl"
        nav = re.search(r'<nav class="page-nav">(.*?)</nav>', (site / "stacks.html").read_text(encoding="utf-8"), re.S).group(1)
        self.assertEqual(re.findall(r">([^<>]+)</(?:a|span)>", nav), ["Games", "Player Props", "Promo Tools"])
        self.assertNotIn("confirmed", (site / "stacks.js").read_text(encoding="utf-8").lower())


class PointsBox(unittest.TestCase):
    def test_his_best_stacks_in_the_open_row(self):
        page = SITE.open("nhl/points.html")
        page.wait_for_function("() => typeof STACKS !== 'undefined' && STACKS !== null && !document.getElementById('shots-app').hidden")
        key = page.evaluate("""() => {
            const g = gamesOn('2026-10-13').find((g) => (STACKS.games[g.game_id] || {}).stacks);
            const id = STACKS.games[g.game_id].stacks[0].legs[0];
            pointsView.open = `${g.game_id}:${id}`; dayIndex = days().indexOf('2026-10-13'); render();
            return [g.game_id, id];
        }""")
        names = page.eval_on_selector_all(".stk-mini .stk-with", "(els) => els.map((e) => e.textContent)")
        scores = page.eval_on_selector_all(".stk-mini .stk-score", "(els) => els.map((e) => Number(e.textContent))")
        self.assertTrue(1 <= len(names) <= 4)
        self.assertEqual(scores, sorted(scores, reverse=True))
        board = nhl_stacks()["games"][key[0]]
        last = board["players"][key[1]]["name"].split(" ")[-1]
        self.assertTrue(all(n.startswith(f"{last} + ") for n in names))
        page.close()


if __name__ == "__main__":
    unittest.main()
