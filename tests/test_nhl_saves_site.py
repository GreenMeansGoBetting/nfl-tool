"""The NHL Saves page (site/nhl/saves.js), run in a real browser on the saved
NHL data and the Saves sample (built at test time from the King of the Crease
sample: helpers.nhl_saves).

What is pinned: the page shows what the build sent (the play's side, line and
price, the fair price, the edge and its bucket: it does no saves math, so the
record and the page can't disagree); the ranking (check first, then the plays
by edge, then goalies with no odds); the starter tag never says "confirmed";
the Starters and Odds filters; the breakdown (the projection's steps, both
sides of the matchup, the price table with the other lines); a finished game
shows the real saves, a win or loss, and "Void" when someone else started;
the record popup before any game is graded; the Saves link in the menu."""
import unittest
from pathlib import Path

from helpers import nhl_saves  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT = "2026-10-13"

HEADS = """const heads = [...document.querySelectorAll('.shots-table thead th')].map((th) => (th.childNodes[0] || {}).textContent || '');"""
ROWS = """() => { """ + HEADS + """
  return [...document.querySelectorAll('.shots-row')].map((tr) => {
    const td = (label) => tr.children[heads.indexOf(label)];
    const cell = (label) => td(label).textContent.trim().replace(/\\s+/g, ' ');
    return { key: tr.dataset.row, play: cell('Play'), rating: cell('Rating'), fair: cell('Fair'), edge: cell('Edge'), proj: cell('Proj'), starter: cell('Starter'),
             amber: td('Edge').classList.contains('tier-mid'), green: td('Edge').classList.contains('tier-good'),
             result: heads.includes('Result') ? cell('Result') : null };
  });
}"""


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/saves.html")
        PAGE.wait_for_function("() => typeof SAVES !== 'undefined' && SAVES !== null && !document.getElementById('shots-app').hidden")
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
            Object.assign(savesView, { starter: 'all', minEdge: 'all', odds: 'all', sort: 'edge', dir: -1, open: null, when: 'all', checks: true, adv: false }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def built(day=TONIGHT):
    games = PAGE.evaluate("(day) => gamesOn(day).map((g) => g.game_id)", day)
    return {f"{gid}:{r['id'] or 'null'}": r for gid, g in nhl_saves()["games"].items() if gid in games for r in g["goalies"]}


def odds(price):
    return f"+{price}" if price > 0 else str(price)


class Table(unittest.TestCase):
    def test_every_goalie_shows_what_the_build_sent(self):
        rows = reset()
        want = built()
        self.assertEqual(sorted(r["key"] for r in rows), sorted(want))
        for row in rows:
            r = want[row["key"]]
            if r["side"]:
                self.assertEqual(row["play"], f"{r['side'][0]}{r['line']:g}{odds(r['price'])}")
                self.assertEqual(row["fair"], odds(r["fair"]))
                self.assertEqual(row["edge"].replace("thin", ""), f"{'+' if r['edge'] > 0 else ''}{r['edge'] * 100:.1f}")
                self.assertEqual(row["green"], r["size"] in ("strong", "lean"), row)
                self.assertEqual(row["amber"], r["size"] == "check", row)
                self.assertEqual(row["rating"].startswith({"strong": "Strong", "lean": "Lean", "check": "Check", "none": "--"}[r["size"]]), True, row)
            else:
                self.assertIn(row["play"], ("No odds", "No price"))
            self.assertEqual(row["proj"], f"{r['mean']:.1f}")
        self.assertEqual(SITE.errors, [])

    def test_ranked_check_first_then_plays_by_edge(self):
        rows = reset()
        want = built()
        groups = [0 if want[r["key"]]["size"] == "check" else 1 if want[r["key"]]["edge"] is not None else 2 for r in rows]
        self.assertEqual(groups, sorted(groups))
        plays = [want[r["key"]]["edge"] for r, gr in zip(rows, groups) if gr == 1]
        self.assertEqual(plays, sorted(plays, reverse=True))

    def test_the_starter_is_never_called_confirmed(self):
        reset()
        script = (Path(__file__).resolve().parents[1] / "nfl_tool" / "site" / "nhl" / "saves.js").read_text(encoding="utf-8")
        self.assertNotIn("confirmed", script.replace("never a confirmation", "").lower())
        rows = reset()
        want = built()
        for row in rows:
            if want[row["key"]]["source"] == "both":
                self.assertIn("agree", row["starter"].lower())

    def test_filters(self):
        want = built()
        agree = reset(starter="agree")
        self.assertTrue(agree)
        self.assertTrue(all(want[r["key"]]["source"] == "both" for r in agree))
        priced = reset(odds="priced")
        self.assertTrue(all(want[r["key"]]["line"] is not None for r in priced))
        no_checks = reset(checks=False)
        self.assertTrue(all(want[r["key"]]["size"] != "check" for r in no_checks))
        edge = reset(minEdge="6")
        self.assertTrue(all(want[r["key"]]["edge"] is not None and want[r["key"]]["edge"] >= 0.0595 for r in edge))

    def test_the_open_row(self):
        rows = reset()
        key = next(r["key"] for r in rows if built()[r["key"]]["alts"])
        PAGE.click(f'.shots-row[data-row="{key}"] .shots-rank')
        text = PAGE.inner_text(".shots-detail").lower()
        r = built()[key]
        self.assertIn("League start".lower(), text)
        self.assertIn(f"{r['opp']} shooting".lower(), text)
        self.assertIn(f"Over {r['line']:g}".lower(), text)
        self.assertIn(f"Over {r['alts'][0][0]:g}".lower(), text)
        self.assertIn("In net (expected)".lower(), text)
        self.assertEqual(SITE.errors, [])


class Finished(unittest.TestCase):
    def test_real_saves_a_result_and_void(self):
        rows = reset()
        want = built()
        played = next(r["key"] for r in rows if want[r["key"]]["side"])
        other = next(r["key"] for r in rows if r["key"] != played)
        PAGE.evaluate(
            """([played, other]) => {
                for (const g of Object.values(SAVES.games)) for (const r of g.goalies) {
                    const key = `${r.game_id}:${r.id}`;
                    if (key === played) Object.assign(r, { actual: r.side === 'over' ? Math.ceil(r.line) + 3 : Math.floor(r.line) - 3, started: r.name });
                    if (key === other) Object.assign(r, { actual: 30, started: 'Someone Else', void: true });
                }
                render();
            }""",
            [played, other],
        )
        rows = {r["key"]: r for r in PAGE.evaluate(ROWS)}
        self.assertTrue(rows[played]["result"].startswith("W"))
        self.assertEqual(rows[other]["result"], "Void")
        PAGE.reload()
        PAGE.wait_for_function("() => typeof SAVES !== 'undefined' && SAVES !== null && !document.getElementById('shots-app').hidden")


class RecordAndMenu(unittest.TestCase):
    def test_the_record_before_any_game_is_graded(self):
        reset()
        PAGE.click("#shots-record-open")
        self.assertIn("The record starts with the first games", PAGE.inner_text("#shots-results"))
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.locator("#shots-record-modal").is_hidden())

    def test_saves_is_in_the_menu(self):
        links = PAGE.evaluate("() => [...document.querySelectorAll('.topbar a')].map((a) => [a.textContent.trim(), new URL(a.href).pathname])")
        self.assertIn(["Saves", "/nhl/saves.html"], links)


if __name__ == "__main__":
    unittest.main()
