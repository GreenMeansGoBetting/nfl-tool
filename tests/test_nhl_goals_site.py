"""The NHL Goals page (site/nhl/goals.js), run in a real browser on the saved
NHL data, Shots and Goals samples (the Goals sample is built from the same
games: see helpers.nhl_goals_bytes).

What is pinned: the page shows what the build sent (chance, fair price, edge,
the price and the Zone Match tag: it does no goal math, so the record and the
page can't disagree); the ranking (check first, then the priced plays by edge,
then players with no odds by their chance); players who are out are left off;
the filters (Odds, Zone Match, Skaters); the breakdown (the pieces multiply out
to tonight's expected goals, the price table with the first price seen, the
Zone Match note, the rink on the eight rank colors); a finished game shows
real goals and a win or loss only for a priced player; the record popup; and
the Goals link on every NHL page."""
import unittest

from helpers import nhl_goals  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT, LAST_NIGHT = "2026-10-13", "2026-10-12"

# Columns are found by their header (the advanced stats can be folded away). The model's chance
# is in the Fair cell's hover since the Model column went (2026-10-15).
HEADS = """const heads = [...document.querySelectorAll('.shots-table thead th')].map((th) => (th.childNodes[0] || {}).textContent || '');"""
ROWS = """() => { """ + HEADS + """
  return [...document.querySelectorAll('.shots-row')].map((tr) => {
    const td = (label) => tr.children[heads.indexOf(label)];
    const cell = (label) => td(label).textContent.trim().replace(/\\s+/g, ' ');
    return { key: tr.dataset.row, id: tr.dataset.row.split(':')[1], rank: cell('#'), anytime: cell('Anytime'), rating: cell('Rating'), model: `${(/(\\d+)%/.exec(td('Fair').title) || [])[1]}%`, fair: cell('Fair'), edge: cell('Edge'),
             zone: !!tr.querySelector('.goals-zone'), noodds: !!tr.querySelector('.goals-noodds'), amber: td('Edge').classList.contains('tier-mid'),
             green: td('Edge').classList.contains('tier-good'), result: heads.includes('Result') ? cell('Result') : null };
  });
}"""
HEADERS = "() => { " + HEADS + " return heads; }"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/goals.html")
        PAGE.wait_for_function("() => typeof GOALS !== 'undefined' && GOALS !== null && !document.getElementById('shots-app').hidden")
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
            Object.assign(goalsView, { pos: 'all', lineup: 'all', odds: 'all', zone: 'all', sort: 'edge', dir: -1, open: null, when: 'all', checks: true, adv: false }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def built(day=TONIGHT):
    """Every player the build sent for the day's games, by id (the page lists who isn't out)."""
    data = nhl_goals()
    games = [gid for gid, g in data["games"].items() if gid in PAGE.evaluate("(day) => gamesOn(day).map((g) => g.game_id)", day)]
    return {f"{gid}:{r['id']}": r for gid in games for r in data["games"][gid]["players"]}


class Rows(unittest.TestCase):
    def test_the_page_shows_what_the_build_sent(self):
        rows = reset()
        sent = built()
        self.assertEqual({r["key"] for r in rows}, {k for k, r in sent.items() if not r["out"]})
        for row in rows:
            r = sent[row["key"]]
            # The build's chance to the nearest point (an exact half can land either way in floating point).
            self.assertLessEqual(abs(int(row["model"].rstrip("%")) - r["chance"] * 100), 0.5 + 1e-6, r["name"])
            self.assertEqual(row["fair"], f"+{r['fair']}" if r["fair"] > 0 else str(r["fair"]))
            if r["odds"] is None:
                self.assertTrue(row["noodds"])
                self.assertEqual(row["edge"], "--")
            else:
                self.assertIn(f"+{r['odds']}" if r["odds"] > 0 else str(r["odds"]), row["anytime"])
                self.assertTrue(row["edge"].startswith(f"{r['edge'] * 100:+.1f}".replace("+0.0", "0.0").replace("-0.0", "0.0")), (row, r["edge"]))
                self.assertEqual(row["amber"], r["size"] == "check")
                self.assertEqual(row["green"], r["size"] in ("lean", "strong"))
            self.assertEqual(row["zone"], bool(r["zone"]))
            # The Rating column says the build's bucket.
            rating = {"strong": "Strong", "lean": "Lean", "none": "--", "check": "Check" if (r["edge"] or 0) >= nhl_goals()["edges"]["check"] else "New line"}.get(r["size"], "--")
            self.assertEqual(row["rating"], rating, (r["name"], r["size"], r["edge"]))

    def test_the_columns(self):
        """The owner, 2026-10-15: no Proj or Model % (the fair price tells it), Rating beside Anytime,
        Zone in its own column, the advanced stats folded away until asked for."""
        reset()
        self.assertEqual(PAGE.evaluate(HEADERS), ["#", "Player", "Line", "Anytime", "Rating", "Zone", "G", "xG", "Fair", "Edge", ""])
        PAGE.click("#shots-adv-toggle")
        self.assertEqual(PAGE.evaluate(HEADERS)[10:], ["Min", "Opp", "Goalie", "Finish", "EV/PP", "Style", "Home/rest", ""])
        PAGE.click("#shots-adv-toggle")
        self.assertEqual(len(PAGE.evaluate(HEADERS)), 11)

    def test_check_first_then_plays_by_edge_then_no_odds_by_chance(self):
        rows = reset()
        sent = built()
        group = lambda r: 0 if r["size"] == "check" else 1 if r["odds"] is not None else 2
        groups = [group(sent[row["key"]]) for row in rows]
        self.assertEqual(groups, sorted(groups))
        self.assertIn(1, groups)
        for g, key in ((0, "edge"), (1, "edge"), (2, "chance")):
            values = [sent[row["key"]][key] for row in rows if group(sent[row["key"]]) == g]
            self.assertEqual(values, sorted(values, reverse=True))
        heads = PAGE.evaluate("() => [...document.querySelectorAll('.group-row')].map((tr) => tr.textContent)")
        if 2 in groups:
            self.assertTrue(any(h.startswith("No odds yet") for h in heads))

    def test_the_filters(self):
        everyone = reset()
        priced = reset(odds="priced")
        self.assertTrue(priced and all(not r["noodds"] for r in priced))
        self.assertLess(len(priced), len(everyone) + 1)
        zone = reset(zone="only")
        self.assertTrue(zone and all(r["zone"] for r in zone))
        self.assertEqual(len(zone), sum(1 for r in everyone if r["zone"]))
        defense = reset(pos="D")
        sent = built()
        self.assertTrue(all(sent[r["key"]]["pos"] == "D" for r in defense))


class Breakdown(unittest.TestCase):
    def test_a_row_opens_how_its_chance_is_built(self):
        rows = reset()
        key = next(r["key"] for r in rows if not r["noodds"])
        r = built()[key]
        PAGE.click(f'.shots-row[data-row="{key}"] td.shots-rank')
        detail = PAGE.locator(".shots-detail")
        text = detail.inner_text()
        self.assertIn("how tonight's chance is built", text.lower())
        self.assertIn(f"{r['mean']:.2f} xG", text)
        # The price table: anytime at the model's fair price, Novig's price and the first one seen.
        price = PAGE.evaluate("() => [...document.querySelectorAll('.shots-ladder tbody tr')][0].textContent.replace(/\\s+/g, ' ')")
        self.assertIn("Anytime (1+)", price)
        self.assertIn(f"+{r['first_odds']}", price)
        # Every zone of the rink is on the eight rank colors (the defense's numbers come from shots.json).
        self.assertGreaterEqual(PAGE.locator(".shots-detail .nhl-zone-rank").count(), 5)

    def test_the_zone_match_note(self):
        rows = reset(zone="only")
        key = rows[0]["key"]
        r = built()[key]
        PAGE.click(f'.shots-row[data-row="{key}"] td.shots-rank')
        note = PAGE.locator(".goals-callout").inner_text()
        self.assertIn(f"{round(r['zone']['share'] * 100)}%", note)
        self.assertIn("not in the number", note)


class Finished(unittest.TestCase):
    def test_last_nights_games_show_real_goals(self):
        rows = reset(LAST_NIGHT)
        sent = built(LAST_NIGHT)
        self.assertTrue(rows)
        for row in rows:
            r = sent[row["key"]]
            self.assertTrue(row["result"].endswith(str(r["actual"])) if r["actual"] is not None else row["result"] == "--")
            # A win or loss only for a player who had a price.
            self.assertEqual(row["result"][:1] in "WL" and row["result"][1:2] == " ", r["odds"] is not None and r["actual"] is not None)


class Record(unittest.TestCase):
    def test_the_record_popup(self):
        reset()
        PAGE.click("#shots-record-open")
        text = PAGE.locator("#shots-results").inner_text()
        record = nhl_goals()["record"]
        self.assertIn(f"{record['games']} games, {record['players']} players graded", text)
        self.assertIn("closing line value", text.lower())
        self.assertIn("said vs scored", text.lower())
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.locator("#shots-record-modal").is_hidden())


class Nav(unittest.TestCase):
    def test_every_nhl_page_has_the_same_nav(self):
        """The owner, 2026-10-15: Games, Player Props (a list: Best Plays, Shots, Goals), Promo Tools; no "More tools coming"."""
        import re
        from pathlib import Path
        site = Path(__file__).resolve().parents[1] / "nfl_tool" / "site"
        for page in ("index.html", "best.html", "shots.html", "goals.html", "promo-tools.html"):
            nav = re.search(r'<nav class="page-nav">(.*?)</nav>', (site / "nhl" / page).read_text(encoding="utf-8"), re.S).group(1)
            self.assertEqual(re.findall(r">([^<>]+)</(?:a|span)>", nav), ["Games", "Player Props", "Promo Tools"], page)
            self.assertIn('data-nav-menu="props"', nav, page)
        for page in ("nhl/index.html", "nhl/shots.html", "nhl/goals.html", "nhl/promo-tools.html", "nba/index.html"):
            self.assertNotIn("More tools coming", (site / page).read_text(encoding="utf-8"), page)
        sync = (site / "sync.js").read_text(encoding="utf-8")
        self.assertIn('{ name: "Best Plays", href: "best.html" }', sync)
        self.assertIn('{ name: "Shots", href: "shots.html" }', sync)
        self.assertIn('{ name: "Goals", href: "goals.html" }', sync)


if __name__ == "__main__":
    unittest.main()
