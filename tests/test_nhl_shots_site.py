"""The NHL Shots page (site/nhl/shots.js), run in a real browser on the saved
NHL data and Shots samples.

What is pinned: the page and the build agree on every play (the side, the
price and the edge the record is graded by); the ranking is best edge first
with the gaps too big to trust in their own group underneath; players who are
out are left off; the filters, the sort and one-game view; the row breakdown
(the pieces multiply out to the projection, every line the book prices is on
the ladder); names open the one player card; a finished game shows real shots
and a win or loss; the record tiles."""
import math
import unittest

from helpers import nhl_data, nhl_shots  # first: puts tools/ on the import path

import build_nhl
from site_browser import SiteBrowser

SITE = PAGE = OPENED_ON = None
TONIGHT, LAST_NIGHT = "2026-10-13", "2026-10-12"

# Every row on the page as plain values.
ROWS = """() => [...document.querySelectorAll('.shots-row')].map((tr) => {
    const cell = (i) => tr.children[i].textContent.trim().replace(/\\s+/g, ' ');
    const chip = tr.querySelector('.shots-play');
    const play = chip ? `${chip.querySelector('b').textContent} ${chip.querySelector('span').textContent}` : cell(2);
    return { key: tr.dataset.row, id: tr.dataset.row.split(':')[1], rank: cell(0), play, proj: cell(3), model: cell(4), fair: cell(5), edge: cell(6), check: !!tr.querySelector('.shots-flag') && /check/.test(cell(6)) };
})"""


def setUpModule():
    global SITE, PAGE, OPENED_ON
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/shots.html")
        PAGE.wait_for_function("() => typeof SHOTS !== 'undefined' && SHOTS !== null && !document.getElementById('shots-app').hidden")
        OPENED_ON = PAGE.evaluate("() => days()[dayIndex]")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


def reset(day=TONIGHT, **view):
    """Back to how the page opens (or another day / filter), and the rows drawn."""
    PAGE.evaluate(
        """([day, view]) => {
            closePlayerCard();
            Object.assign(shotsView, { side: 'best', pos: 'all', lined: true, sort: 'edge', dir: -1, open: null }, view);
            selectDay(days().indexOf(day));
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def expected_plays(day=TONIGHT):
    """{player id: the play the build would grade} for everyone the page should list."""
    data, shots = nhl_data(), nhl_shots()
    out = {}
    for g in data["schedule"]:
        if g["date"] != day or g["game_id"] not in shots["games"]:
            continue
        for row in shots["games"][g["game_id"]]["players"]:
            market = ((data["player_odds"].get(g["game_id"]) or {}).get(row["id"]) or {}).get("sog")
            if row["out"] or not market:
                continue
            play = build_nhl.shots_play(row["chances"][math.floor(market["line"])], market["line"], market.get("over"), market.get("under"))
            if play:
                out[row["id"]] = {**play, "mean": row["mean"]}
    return out


class Ranking(unittest.TestCase):
    def test_opens_on_today_when_today_has_projections(self):
        # On the sample's clock today is 10-12, whose three games were projected that morning.
        self.assertEqual(OPENED_ON, LAST_NIGHT)

    def test_the_whole_slate_is_listed(self):
        rows = reset()
        self.assertEqual(PAGE.evaluate("() => days()[dayIndex]"), TONIGHT)
        self.assertEqual(len(PAGE.query_selector_all("#matchup-row .matchup-card")), 16)
        self.assertEqual({r["id"] for r in rows}, set(expected_plays()))
        self.assertGreater(len(rows), 200)
        self.assertEqual(SITE.errors, [])

    def test_the_page_and_the_build_agree_on_every_play(self):
        """The record is graded by the build's shots_play; the page must show the same side, price and edge."""
        plays = expected_plays()
        price = lambda n: f"+{n}" if n > 0 else str(n)
        for r in reset():
            play = plays[r["id"]]
            self.assertEqual(r["play"], f"{'Over' if play['side'] == 'over' else 'Under'} {play['line']:.1f} {price(play['price'])}", r)
            shown = r["edge"].replace("check", "").replace("thin", "").strip()
            self.assertLessEqual(abs(float(shown) - play["edge"] * 100), 0.05 + 1e-9, r)
            self.assertNotEqual(shown, "-0.0", r)
            self.assertLessEqual(abs(int(r["model"].rstrip("%")) - play["chance"] * 100), 0.5 + 1e-9, r)
            self.assertEqual(r["proj"], f"{play['mean']:.2f}", r)

    def test_best_edge_first_with_the_too_big_gaps_underneath(self):
        plays = expected_plays()
        rows = reset()
        check = build_nhl.SHOTS_EDGES["check"]
        believable = [r for r in rows if plays[r["id"]]["edge"] < check]
        too_big = [r for r in rows if plays[r["id"]]["edge"] >= check]
        self.assertGreater(len(too_big), 0)
        # The table lists every believable play, best first, then the "check" group.
        self.assertEqual([r["id"] for r in rows], [r["id"] for r in believable] + [r["id"] for r in too_big])
        edges = [plays[r["id"]]["edge"] for r in believable]
        self.assertEqual(edges, sorted(edges, reverse=True))
        self.assertEqual([r["check"] for r in rows], [False] * len(believable) + [True] * len(too_big))
        self.assertEqual([r["rank"] for r in rows[:3]], ["1", "2", "3"])
        self.assertEqual(len(PAGE.query_selector_all(".shots-check-head")), 1)
        head = PAGE.evaluate("() => document.querySelector('.shots-check-head').nextElementSibling.dataset.row.split(':')[1]")
        self.assertEqual(head, too_big[0]["id"])

    def test_sorting_by_another_column_drops_the_grouping(self):
        reset()
        PAGE.evaluate("() => document.querySelector('.shots-sort[data-sort=\"proj\"]').click()")
        rows = PAGE.evaluate(ROWS)
        projections = [float(r["proj"]) for r in rows]
        self.assertEqual(projections, sorted(projections, reverse=True))
        self.assertEqual(len(PAGE.query_selector_all(".shots-check-head")), 0)
        PAGE.evaluate("() => document.querySelector('.shots-sort[data-sort=\"proj\"]').click()")
        self.assertEqual([float(r["proj"]) for r in PAGE.evaluate(ROWS)], sorted(projections))

    def test_players_who_are_out_are_left_off(self):
        shots = nhl_shots()
        out = {row["id"] for entry in shots["games"].values() for row in entry["players"] if row["out"]}
        self.assertGreater(len(out), 0)
        self.assertEqual(out & {r["id"] for r in reset(lined=False)}, set())


class Filters(unittest.TestCase):
    def test_overs_and_unders(self):
        self.assertTrue(all(r["play"].startswith("Over ") for r in reset(side="over")))
        unders = reset(side="under")
        self.assertTrue(all(r["play"].startswith("Under ") for r in unders))
        # The under of a line is 100% minus the over: Jack Hughes, over 3.5.
        data, shots = nhl_data(), nhl_shots()
        hughes = next(p for p in data["skaters"]["NJD"] if p["name"] == "Jack Hughes")
        row = next(r for entry in shots["games"].values() for r in entry["players"] if r["id"] == hughes["id"] and "actual" not in r)
        self.assertEqual(next(r for r in unders if r["id"] == hughes["id"])["model"], f"{(1 - row['chances'][3]) * 100:.0f}%")

    def test_forwards_and_defense(self):
        positions = {p["id"]: p["pos"] for players in nhl_data()["skaters"].values() for p in players}
        self.assertEqual({positions[r["id"]] for r in reset(pos="D")}, {"D"})
        self.assertNotIn("D", {positions[r["id"]] for r in reset(pos="F")})

    def test_everyone_adds_the_players_without_a_line(self):
        shots, data = nhl_shots(), nhl_data()
        tonight = [g["game_id"] for g in data["schedule"] if g["date"] == TONIGHT]
        everyone = sum(1 for gid in tonight for row in shots["games"][gid]["players"] if not row["out"])
        rows = reset(lined=False)
        self.assertEqual(len(rows), everyone)
        self.assertEqual(sum(1 for r in rows if r["play"] == "No line"), everyone - len(expected_plays()))
        # They sit under the players with a line.
        self.assertEqual([r["play"] == "No line" for r in rows], sorted(r["play"] == "No line" for r in rows))

    def test_a_game_in_the_strip_shows_only_that_game(self):
        reset()
        game = next(g for g in nhl_data()["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        PAGE.evaluate("(id) => document.querySelector(`.matchup-card[data-game='${id}']`).click()", game["game_id"])
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith(game["game_id"]) for r in rows))
        self.assertIn("NJD", PAGE.inner_text("#shots-title"))
        self.assertEqual(PAGE.evaluate("() => currentGame().home"), "DET")
        # Clicking it again brings back the whole day.
        PAGE.evaluate("(id) => document.querySelector(`.matchup-card[data-game='${id}']`).click()", game["game_id"])
        self.assertEqual(len(PAGE.evaluate(ROWS)), len(expected_plays()))


class Breakdown(unittest.TestCase):
    """The row a click opens (Jack Hughes, NJD @ DET)."""

    @classmethod
    def setUpClass(cls):
        cls.data, cls.shots = nhl_data(), nhl_shots()
        cls.game = next(g for g in cls.data["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        cls.hughes = next(r for r in cls.shots["games"][cls.game["game_id"]]["players"] if r["name"] == "Jack Hughes")
        cls.odds = cls.data["player_odds"][cls.game["game_id"]][cls.hughes["id"]]

    def open(self):
        reset()
        return PAGE.evaluate(
            """(key) => {
                document.querySelector(`.shots-row[data-row='${key}']`).children[3].click();
                const box = document.querySelector('.shots-detail');
                const text = (el) => el.textContent.trim().replace(/\\s+/g, ' ');
                return {
                    open: document.querySelectorAll('.shots-detail').length,
                    steps: [...box.querySelectorAll('.shots-step')].map((s) => [text(s.querySelector('small')), text(s.querySelector('b'))]),
                    ladder: [...box.querySelectorAll('.shots-ladder tbody tr')].map((tr) => [...tr.children].map(text)),
                    tiles: [...box.querySelectorAll('.shots-allows .nba-tile')].map((t) => [text(t.querySelector('.gs-tile-label')), text(t.querySelector('b')), text(t.querySelector('small'))]),
                    zones: [...box.querySelectorAll('svg .nhl-zone-big')].map(text),
                };
            }""",
            f"{self.game['game_id']}:{self.hughes['id']}",
        )

    def test_the_pieces_multiply_out_to_tonights_number(self):
        detail = self.open()
        self.assertEqual(detail["open"], 1)
        steps = detail["steps"]
        self.assertEqual([s[0] for s in steps], ["His usual", "DET defense", "vs forwards", "His spots", "Power play", "Home / rest", "Tonight"])
        self.assertEqual((steps[0][1], steps[-1][1]), (f"{self.hughes['usual']:.2f}", f"{self.hughes['mean']:.2f}"))
        lift = self.hughes["lift"]
        product = self.hughes["usual"] * lift["opp"] * lift["pos"] * lift["area"] * lift["pp"] * lift["home"] * lift["b2b"] * lift["opp_b2b"]
        self.assertAlmostEqual(product, self.hughes["mean"], delta=0.02)
        # NJD played the night before (10-12 vs OTT): the last piece is the back-to-back.
        self.assertEqual(steps[5][1], "-3%")

    def test_the_ladder_is_every_line_the_book_prices(self):
        ladder = self.open()["ladder"]
        signed = lambda n: f"+{n}" if n > 0 else str(n)
        lines = sorted([*self.odds["sog_alts"], [self.odds["sog"]["line"], self.odds["sog"]["over"]]])
        self.assertEqual([row[0] for row in ladder], [f"{math.ceil(line)} or more" for line, _ in lines] + ["Under 3.5"])
        self.assertEqual([row[3] for row in ladder], [signed(price) for _, price in lines] + [signed(self.odds["sog"]["under"])])
        # 4 or more = over 3.5: the model's chance, the price it would be fair at, and the edge at Novig's price.
        four = next(row for row in ladder if row[0] == "4 or more")
        chance = self.hughes["chances"][3]
        self.assertEqual(four[1:3], [f"{chance * 100:.0f}%", signed(round(100 * (1 - chance) / chance))])
        self.assertEqual(four[4], f"{(chance - build_nhl.break_even(self.odds['sog']['over'])) * 100:+.1f}")

    def test_the_defense_tiles_and_the_rink(self):
        detail = self.open()
        defense = self.shots["defense"]["DET"]
        self.assertEqual(detail["tiles"][0], ["Shots on goal allowed", f"{defense['sog']['blend']:.1f}", f"{defense['sog']['rank']}{'th' if 4 <= defense['sog']['rank'] <= 20 else ''} most"])
        self.assertEqual([t[0] for t in detail["tiles"]], ["Shots on goal allowed", "To forwards", "Power-play shots allowed"])
        # Six zones, each with the share of his shots from there.
        self.assertEqual(len(detail["zones"]), 5)  # the strip outside the zone is one line of text, not a big number
        self.assertIn(f"{self.hughes['shares']['slot'] * 100:.0f}%", detail["zones"])

    def test_clicking_the_open_row_closes_it(self):
        self.open()
        PAGE.evaluate("() => document.querySelector('.shots-row.shots-open').children[3].click()")
        self.assertEqual(len(PAGE.query_selector_all(".shots-detail")), 0)

    def test_every_row_opens(self):
        reset(lined=False)
        opened = PAGE.evaluate(
            """() => {
                let count = 0;
                for (const key of [...document.querySelectorAll('.shots-row')].map((tr) => tr.dataset.row)) {
                    shotsView.open = key;
                    renderTable();
                    if (!document.querySelector('.shots-detail svg')) throw new Error(`no breakdown for ${key}`);
                    count++;
                }
                return count;
            }"""
        )
        self.assertGreater(opened, 500)
        self.assertEqual(SITE.errors, [])

    def test_a_name_opens_the_player_card_not_the_row(self):
        reset()
        PAGE.evaluate("(key) => document.querySelector(`.shots-row[data-row='${key}'] .player-click`).click()", f"{self.game['game_id']}:{self.hughes['id']}")
        state = PAGE.evaluate("() => ({ card: !document.getElementById('player-card-modal').hidden, name: document.querySelector('#player-card-content .pc-name').textContent, sub: document.querySelector('#player-card-content .pc-sub').textContent, rows: document.querySelectorAll('.shots-detail').length })")
        self.assertEqual((state["card"], state["name"], state["rows"]), (True, "Jack Hughes", 0))
        self.assertIn("DET", state["sub"])  # the card talks about his next game even with the whole day showing
        self.assertEqual(PAGE.evaluate("() => document.querySelectorAll('.shots-row .player-click').length"), len(expected_plays()))


class FinishedGames(unittest.TestCase):
    """10-12's three games: projected that morning, locked, then graded."""

    def test_real_shots_and_a_win_or_loss(self):
        data, shots = nhl_data(), nhl_shots()
        game = next(g for g in data["schedule"] if g["date"] == LAST_NIGHT and g["home"] == "BUF")
        entry = shots["games"][game["game_id"]]
        self.assertEqual((entry["locked"], entry["final"]), (True, True))
        benson = next(r for r in entry["players"] if r["name"] == "Zach Benson")
        self.assertEqual(benson["actual"], 2)
        rows = reset(LAST_NIGHT, lined=False)
        self.assertEqual(len(rows), sum(1 for g in data["schedule"] if g["date"] == LAST_NIGHT for r in shots["games"][g["game_id"]]["players"] if not r["out"]))
        self.assertIn("started", PAGE.inner_text("#shots-locked"))
        result = lambda: PAGE.evaluate("(key) => document.querySelector(`.shots-row[data-row='${key}']`).lastElementChild.textContent.trim().replace(/\\s+/g, ' ')", f"{game['game_id']}:{benson['id']}")
        self.assertEqual(result(), "2")  # no line was saved for him: just his shots
        # With a line, the play is graded. He had 2: an under 2.5 won, an over 2.5 lost.
        sides = []
        for over, under in ((-400, 150), (150, -400)):
            PAGE.evaluate("([gid, id, over, under]) => { DATA.player_odds[gid] = { [id]: { sog: { line: 2.5, over, under } } }; render(); }", [game["game_id"], benson["id"], over, under])
            sides.append(build_nhl.shots_play(benson["chances"][2], 2.5, over, under)["side"])
            self.assertEqual(result(), "W 2" if sides[-1] == "under" else "L 2")
        self.assertEqual(sides, ["under", "over"])  # each time the play is the side with the generous price
        PAGE.evaluate("(gid) => { delete DATA.player_odds[gid]; render(); }", game["game_id"])

    def test_the_record_tiles(self):
        reset()
        text = PAGE.inner_text("#shots-results").upper().replace("\n", " ")
        for piece in ("THE RECORD SO FAR", "21 GAMES", "EDGE 6 TO 12", "9-5", "64%", "+3.4U", "EDGE 3 TO 6", "14-12", "12+: CHECK FIRST", "1-2", "UNDERS WITH AN EDGE", "15-8"):
            self.assertIn(piece, text)
        PAGE.evaluate("() => { window.keptRecord = SHOTS.record; SHOTS.record = null; render(); }")
        self.assertIn("The record starts", PAGE.inner_text("#shots-results"))
        PAGE.evaluate("() => { SHOTS.record = window.keptRecord; render(); }")


class NoShotsFile(unittest.TestCase):
    def test_the_page_still_opens_if_the_build_wrote_no_projections(self):
        SITE.missing.add("/nhl/shots.json")
        try:
            page = SITE.open("nhl/shots.html")
            page.wait_for_function("() => typeof SHOTS !== 'undefined' && SHOTS !== null")
            self.assertIn("No projections", page.inner_text("#shots-content"))
            # With nothing projected it opens on today's games (three on the sample's clock, 10-12).
            self.assertEqual(len(page.query_selector_all("#matchup-row .matchup-card")), 3)
        finally:
            SITE.missing.discard("/nhl/shots.json")
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
