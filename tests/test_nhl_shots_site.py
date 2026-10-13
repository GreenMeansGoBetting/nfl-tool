"""The NHL Shots page (site/nhl/shots.js), run in a real browser on the saved
NHL data and Shots samples.

What is pinned: the page and the build agree on every play (the side, the
price and the edge the record is graded by, and whether it goes against his
own season average); the ranking is best edge first with the gaps too big to
trust in their own group underneath; players who are out are left off; the
filters (it opens on "Lineup Confirmed", "All" adds the games waiting on a
lineup, and a player with no line is never listed), the sort and one-game
view; the row breakdown (from his season average, the pieces multiply out to
the projection; every line the book prices is on the ladder; a defense's rank
is said in words that can't be read backwards; every zone of the rink is on
the eight rank colors); this season only, on the page and in the card it opens; a
finished game shows real shots and a win or loss; the record tiles; and
tonight's lines: the Line column, a player moved up a line, his linemates
and who is out in the breakdown, a play against the move set apart."""
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
    const play = chip ? `${chip.querySelector('b').textContent} ${chip.querySelector('span').textContent}` : cell(3);
    return { key: tr.dataset.row, id: tr.dataset.row.split(':')[1], rank: cell(0), line: cell(2), play, avg: cell(4), proj: cell(5), model: cell(6), fair: cell(7), edge: cell(8), check: /check|new line/.test(cell(8)), flag: (/(check|new line|thin)/.exec(cell(8)) || [''])[0], amber: tr.children[8].classList.contains('tier-mid'), green: tr.children[8].classList.contains('tier-good'), fade: !!tr.querySelector('.shots-fade') };
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
    """The whole slate ("All"; the page itself opens on "Lineup Confirmed", see
    Filters) on a day, or another filter, and the rows drawn."""
    PAGE.evaluate(
        """([day, view]) => {
            closePlayerCard();
            Object.assign(shotsView, { side: 'best', pos: 'all', lineup: 'all', sort: 'edge', dir: -1, open: null }, view);
            selectDay(days().indexOf(day));
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def rank_word(rank, teams=32):
    """A defense's rank the way the page says it: from the nearer end."""
    ordinal = lambda n: f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
    if rank <= teams / 2:
        return "the most" if rank == 1 else f"{ordinal(rank)} most"
    return "the fewest" if rank == teams else f"{ordinal(teams - rank + 1)} fewest"


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
            play = build_nhl.shots_play(row["chances"][math.floor(market["line"])], market["line"], market.get("over"), market.get("under"), row["avg"], row["move"])
            if play:
                out[row["id"]] = {**play, "mean": row["mean"], "avg": row["avg"], "slot": row["slot"], "move": row["move"]}
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
            shown = r["edge"].replace("check", "").replace("new line", "").replace("thin", "").strip()
            self.assertLessEqual(abs(float(shown) - play["edge"] * 100), 0.05 + 1e-9, r)
            self.assertNotEqual(shown, "-0.0", r)
            self.assertLessEqual(abs(int(r["model"].rstrip("%")) - play["chance"] * 100), 0.5 + 1e-9, r)
            self.assertEqual(r["proj"], f"{play['mean']:.2f}", r)
            self.assertEqual(r["avg"], f"{play['avg']:.2f}", r)
            # "vs his avg" is on exactly the called plays the build's record files as going against his average.
            self.assertEqual(r["fade"], play["fade"] and play["edge"] >= build_nhl.SHOTS_EDGES["lean"], r)
        self.assertGreater(sum(1 for play in plays.values() if play["fade"] and play["edge"] >= build_nhl.SHOTS_EDGES["lean"]), 5)

    def test_best_edge_first_with_the_too_big_gaps_underneath(self):
        plays = expected_plays()
        rows = reset()
        # The build files a play as "check" (a gap too big, or a play against tonight's line change); so must the page.
        believable = [r for r in rows if plays[r["id"]]["size"] != "check"]
        too_big = [r for r in rows if plays[r["id"]]["size"] == "check"]
        self.assertGreater(len(too_big), 0)
        # The table lists every believable play, best first, then the "check" group.
        self.assertEqual([r["id"] for r in rows], [r["id"] for r in believable] + [r["id"] for r in too_big])
        edges = [plays[r["id"]]["edge"] for r in believable]
        self.assertEqual(edges, sorted(edges, reverse=True))
        self.assertEqual([r["check"] for r in rows], [False] * len(believable) + [True] * len(too_big))
        # A play is green; nothing in the set-apart group is.
        self.assertTrue(all(r["amber"] and not r["green"] for r in too_big))
        self.assertTrue(all(r["green"] == (plays[r["id"]]["edge"] >= build_nhl.SHOTS_EDGES["lean"]) and not r["amber"] for r in believable))
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
        self.assertEqual(out & {r["id"] for r in reset()}, set())


class TonightsLines(unittest.TestCase):
    """STL @ OTT is the one game in the sample with the NHL's projected lineup (the saved story)."""

    @classmethod
    def setUpClass(cls):
        cls.data, cls.shots = nhl_data(), nhl_shots()
        cls.game = next(g for g in cls.data["schedule"] if g["away"] == "STL" and g["home"] == "OTT")
        cls.rows = {r["name"]: r for r in cls.shots["games"][cls.game["game_id"]]["players"]}
        cls.foegele = cls.rows["Warren Foegele"]

    def page_rows(self, **view):
        reset(**view)
        PAGE.evaluate("(id) => document.querySelector(`.matchup-card[data-game='${id}']`).click()", self.game["game_id"])
        return {r["id"]: r for r in PAGE.evaluate(ROWS)}

    def test_the_note_says_how_many_games_have_lines(self):
        reset()
        self.assertIn("Lineups are in for 1 of 16 games", PAGE.inner_text("#shots-lineups"))

    def test_the_strip_marks_the_games_whose_lineup_is_in(self):
        reset()
        marks = PAGE.evaluate("() => [...document.querySelectorAll('#matchup-row .matchup-card')].map((c) => [c.dataset.game, !!c.querySelector('.shots-card-lineup-in'), (c.querySelector('.shots-card-lineup') || {}).textContent])")
        self.assertEqual([gid for gid, posted, _ in marks if posted], [self.game["game_id"]])
        self.assertEqual(sorted({text for _, posted, text in marks if not posted}), ["No lineup yet"])

    def test_only_the_listed_skaters_and_each_on_his_line(self):
        self.assertEqual(len(self.rows), 31)  # the story lists 36 skaters; five have no games on the page yet
        self.assertTrue(all(r["slot"] for r in self.rows.values()))
        plays = expected_plays()
        rows = self.page_rows()
        # Everyone in the lineup with a line to play, nobody else.
        self.assertEqual(set(rows), {r["id"] for r in self.rows.values() if r["id"] in plays})
        self.assertEqual(len(rows), 15)
        name = lambda slot: f"{'L' if slot[0] == 'F' else 'D'}{slot[1:]}"
        for r in self.rows.values():
            if r["id"] in rows:
                self.assertTrue(rows[r["id"]]["line"].startswith(name(r["slot"])), r["name"])
        # A game with no lineup posted shows no line.
        others = [r["line"] for r in reset() if not r["key"].startswith(self.game["game_id"])]
        self.assertEqual(set(others), {"--"})

    def test_a_player_moved_up_a_line(self):
        """Warren Foegele: a fourth-liner by his minutes (11.1 a game), on the top line tonight."""
        f = self.foegele
        self.assertEqual((f["slot"], f["usual_slot"], f["move"], f["minutes"], f["line_minutes"]), ("F1", "F4", "up", 11.1, 20.9))
        self.assertAlmostEqual(f["lift"]["line"], math.exp(0.2 * 0.6), places=3)  # +13%: capped, not his new line's full minutes
        self.page_rows()
        detail = PAGE.evaluate(
            """(key) => {
                const tr = document.querySelector(`.shots-row[data-row='${key}']`);
                const cell = tr.children[2];
                tr.children[3].click();
                const box = document.querySelector('.shots-detail');
                const text = (el) => el.textContent.trim().replace(/\\s+/g, ' ');
                return { line: text(cell), up: !!cell.querySelector('.shots-up'), green: cell.classList.contains('tier-good'), tip: cell.title,
                    steps: [...box.querySelectorAll('.shots-step')].map((s) => [text(s.querySelector('small')), text(s.querySelector('b'))]), note: text(box.querySelector('.shots-lineup')) };
            }""",
            f"{self.game['game_id']}:{f['id']}",
        )
        self.assertEqual((detail["line"], detail["up"], detail["green"]), ("L1\u25b2", True, True))
        self.assertIn("fourth line player", detail["tip"])
        self.assertEqual(detail["steps"][2], ["L1 tonight", "+13%"])
        # His linemates and who is out, straight from the story.
        self.assertIn("Warren Foegele \u2013 Tim Stutzle \u2013 Drake Batherson", detail["note"])
        self.assertIn("Injured: Jake Sanderson, Artem Zub, William Eklund", detail["note"])
        self.assertIn("Scratched: Hayden Hodgson", detail["note"])
        # The pieces still multiply out to tonight's number, the line among them.
        lift = f["lift"]
        product = f["usual"] * lift["line"] * lift["opp"] * lift["pos"] * lift["area"] * lift["pp"] * lift["home"] * lift["b2b"] * lift["opp_b2b"]
        self.assertAlmostEqual(product, f["mean"], delta=0.02)

    def test_an_under_on_a_player_moved_up_is_set_apart(self):
        plays = expected_plays()
        against = {pid: p for pid, p in plays.items() if p["against_move"] and build_nhl.SHOTS_EDGES["lean"] <= p["edge"] < build_nhl.SHOTS_EDGES["check"]}
        self.assertGreater(len(against), 0)
        rows = {r["id"]: r for r in reset()}
        for pid, play in against.items():
            self.assertEqual((rows[pid]["flag"], rows[pid]["amber"], rows[pid]["green"]), ("new line", True, False), play)
        # A move that agrees with the play leaves it a play.
        agree = [pid for pid, p in plays.items() if p["move"] and not p["against_move"] and p["size"] in ("lean", "strong")]
        self.assertTrue(all(rows[pid]["green"] and rows[pid]["flag"] != "new line" for pid in agree))


class ThisSeasonOnly(unittest.TestCase):
    """The owner's rule for the NHL prop tools: nothing from last season."""

    def test_the_data_has_no_last_season(self):
        blob = nhl_data()
        self.assertFalse({"default_view", "prev_season_label", "team_stats_prev"} & set(blob))
        self.assertEqual(set(blob["league"]), {"season"})
        self.assertTrue(all("prev" not in p for group in ("skaters", "goalies") for rows in blob[group].values() for p in rows))

    def test_no_last_season_numbers_in_the_data_or_on_the_page(self):
        shots = nhl_shots()
        self.assertTrue(all("prev" not in stat for team in shots["defense"].values() for stat in team.values()))
        # Every projected player has played this season, and his average is this season's.
        rows = [r for entry in shots["games"].values() for r in entry["players"]]
        self.assertTrue(all(r["games"] >= 1 and r["avg"] is not None for r in rows))
        hughes = next(p for p in nhl_data()["skaters"]["NJD"] if p["name"] == "Jack Hughes")
        self.assertEqual(next(r for r in rows if r["id"] == hughes["id"] and "actual" not in r)["avg"], hughes["sog_pg"])
        reset()
        PAGE.evaluate("() => document.querySelector('.shots-row').children[3].click()")
        text = PAGE.evaluate("() => document.querySelector('#shots-content').innerHTML.toLowerCase()")
        self.assertNotIn("last season", text)


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

    def test_it_opens_on_lineup_confirmed(self):
        """The owner's switch: "Lineup Confirmed" (how it opens) / "All". No "Everyone"."""
        page = SITE.open("nhl/shots.html")
        page.wait_for_function("() => typeof SHOTS !== 'undefined' && SHOTS !== null && !document.getElementById('shots-app').hidden")
        state = lambda: page.evaluate("() => ({ lineup: shotsView.lineup, buttons: [...document.querySelectorAll('.shots-filter-btn[data-filter=\"lineup\"]')].map((b) => [b.textContent, b.classList.contains('active')]), toolbar: document.getElementById('shots-toolbar').textContent, rows: document.querySelectorAll('.shots-row').length, text: document.getElementById('shots-content').textContent.trim().replace(/\\s+/g, ' ') })")
        opened = state()
        self.assertEqual(opened["lineup"], "confirmed")
        self.assertEqual(opened["buttons"], [["Lineup Confirmed", True], ["All", False]])
        self.assertNotIn("Everyone", opened["toolbar"])
        self.assertNotIn("With a line", opened["toolbar"])
        # It opens on 10-12 (the sample's clock): three finished games with no line saved,
        # so nothing to list, and it says so instead of showing an empty table.
        self.assertEqual(opened["rows"], 0)
        self.assertIn("No shots-on-goal lines were saved for these games.", opened["text"])
        # Tonight: only the one game whose lineup is in.
        page.evaluate("(day) => selectDay(days().indexOf(day))", TONIGHT)
        confirmed = {r["id"] for r in page.evaluate(ROWS)}
        plays = expected_plays()
        self.assertEqual(confirmed, {pid for pid, play in plays.items() if play["slot"]})
        self.assertEqual(len(confirmed), 15)
        # "All" brings in the games still waiting on one.
        page.evaluate("() => document.querySelector('.shots-filter-btn[data-filter=\"lineup\"][data-value=\"all\"]').click()")
        self.assertEqual({r["id"] for r in page.evaluate(ROWS)}, set(plays))
        self.assertEqual(state()["buttons"], [["Lineup Confirmed", False], ["All", True]])
        self.assertEqual(SITE.errors, [])

    def test_lineup_confirmed_lists_only_players_on_a_line_tonight(self):
        rows = reset(lineup="confirmed")
        plays = expected_plays()
        self.assertEqual({r["id"] for r in rows}, {pid for pid, play in plays.items() if play["slot"]})
        self.assertNotIn("--", {r["line"] for r in rows})
        game = next(g for g in nhl_data()["schedule"] if g["away"] == "STL" and g["home"] == "OTT")
        self.assertTrue(all(r["key"].startswith(game["game_id"]) for r in rows))
        # Still best edge first, the set-apart group underneath.
        believable = [plays[r["id"]]["edge"] for r in rows if plays[r["id"]]["size"] != "check"]
        self.assertEqual(believable, sorted(believable, reverse=True))

    def test_a_game_waiting_on_its_lineup_says_so_and_offers_all(self):
        reset(lineup="confirmed")
        game = next(g for g in nhl_data()["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        PAGE.evaluate("(id) => document.querySelector(`.matchup-card[data-game='${id}']`).click()", game["game_id"])
        self.assertEqual(PAGE.evaluate(ROWS), [])
        self.assertIn("No lineup is in yet for this game.", PAGE.inner_text("#shots-content"))
        PAGE.evaluate("() => document.querySelector('.shots-waiting .shots-filter-btn').click()")
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith(game["game_id"]) for r in rows))
        self.assertEqual(PAGE.evaluate("() => shotsView.lineup"), "all")

    def test_a_player_with_no_line_is_never_listed(self):
        shots, data = nhl_shots(), nhl_data()
        tonight = [g["game_id"] for g in data["schedule"] if g["date"] == TONIGHT]
        everyone = sum(1 for gid in tonight for row in shots["games"][gid]["players"] if not row["out"])
        rows = reset()
        self.assertEqual(len(rows), len(expected_plays()))
        self.assertLess(len(rows), everyone)
        self.assertEqual(PAGE.evaluate("() => [...document.querySelectorAll('.shots-row')].filter((tr) => !tr.querySelector('.shots-play')).length"), 0)

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
                    tags: [...box.querySelectorAll('.shots-allows .nba-tile')].map((t) => text(t.querySelector('.gs-tag, .nba-notag'))),
                    zones: [...box.querySelectorAll('svg .nhl-zone-big')].map(text),
                    zone_colors: [...box.querySelectorAll('svg .nhl-zone')].map((z) => [(/nhl-zone-step-(\\d)/.exec(z.getAttribute('class')) || [])[1] || null, getComputedStyle(z.firstElementChild.nextElementSibling).fill]),
                    key: box.querySelectorAll('.shots-rink-key .g5-scale i').length,
                    // Each zone's three boxes: [text, the step its color is on], in the order the rink draws the zones.
                    zone_boxes: [...box.querySelectorAll('svg .nhl-zone-text > g')].map((g) => [...g.querySelectorAll('.nhl-zone-box')].map((b) => [text(b), (/nhl-zone-box-step-(\\d)/.exec(b.getAttribute('class')) || [])[1] || null])),
                    strip: text(box.querySelector('svg .nhl-zone-text > g:last-child')),
                };
            }""",
            f"{self.game['game_id']}:{self.hughes['id']}",
        )

    def test_the_pieces_multiply_out_to_tonights_number(self):
        detail = self.open()
        self.assertEqual(detail["open"], 1)
        steps = detail["steps"]
        games = self.hughes["games"]
        self.assertEqual([s[0] for s in steps], [f"Season avg \u00b7 {games} gp", f"{games}-game sample", "DET defense", "vs forwards", "His spots", "Power play", "Home / rest", "Tonight"])
        # It starts from what his game log says and ends at tonight's number...
        self.assertEqual((steps[0][1], steps[-1][1]), (f"{self.hughes['avg']:.2f}", f"{self.hughes['mean']:.2f}"))
        # ...the second piece being how far a small sample is discounted (or topped up).
        sample = self.hughes["usual"] / self.hughes["avg"]
        self.assertEqual(steps[1][1], f"{'+' if sample >= 1 else ''}{round((sample - 1) * 100)}%")
        lift = self.hughes["lift"]
        product = self.hughes["avg"] * sample * lift["opp"] * lift["pos"] * lift["area"] * lift["pp"] * lift["home"] * lift["b2b"] * lift["opp_b2b"]
        self.assertAlmostEqual(product, self.hughes["mean"], delta=0.02)
        # NJD played the night before (10-12 vs OTT): the last piece is the back-to-back.
        self.assertEqual(steps[6][1], "-3%")

    def test_the_ladder_is_every_line_the_book_prices(self):
        ladder = self.open()["ladder"]
        signed = lambda n: f"+{n}" if n > 0 else str(n)
        lines = sorted([*self.odds["sog_alts"], [self.odds["sog"]["line"], self.odds["sog"]["over"]]])
        self.assertEqual([row[0] for row in ladder], [f"{math.ceil(line)} or more" for line, _ in lines] + ["Under 3.5"])
        self.assertEqual([row[3] for row in ladder], [signed(price) for _, price in lines] + [signed(self.odds["sog"]["under"])])
        # 4 or more = over 3.5: the model's chance, the price it would be fair at, and the edge at Novig's price.
        four = next(row for row in ladder if row[0] == "4 or more")
        chance = self.hughes["chances"][3]
        self.assertLessEqual(abs(int(four[1].rstrip("%")) - chance * 100), 0.5 + 1e-9)
        self.assertEqual(four[2], signed(round(100 * (1 - chance) / chance)))
        self.assertEqual(four[4], f"{(chance - build_nhl.break_even(self.odds['sog']['over'])) * 100:+.1f}")

    def test_the_defense_tiles_and_the_rink(self):
        detail = self.open()
        defense = self.shots["defense"]["DET"]
        # This season's own number, and its rank said from the nearer end ("3rd most" / "2nd fewest").
        self.assertEqual(detail["tiles"][0], ["Shots on goal allowed", f"{defense['sog']['season']:.1f}", rank_word(defense["sog"]["season_rank"])])
        self.assertEqual([t[0] for t in detail["tiles"]], ["Shots on goal allowed", "To forwards", "Power-play shots allowed"])
        self.assertTrue(all(tag in ("Leaky", "Stingy", "Average") for tag in detail["tags"]), detail["tags"])
        self.assertEqual(len(detail["tags"]), 3)
        # Six zones, each with the share of his shots from there.
        self.assertEqual(len(detail["zones"]), 5)  # the strip outside the zone is one line of text, not a big number
        self.assertIn(f"{self.hughes['shares']['slot'] * 100:.0f}%", detail["zones"])
        # No zone is left plain: each is on the eight rank colors (four teams to a step) by where DET
        # ranks for shots allowed from there, the same rank the zone says in words. 1st = the most = green.
        drawn = ["point", "left", "right", "slot", "low_slot"]  # the order the rink draws them, then the strip
        steps = [str((defense[f"a_{area}"]["season_rank"] - 1) * 8 // 32 + 1) for area in drawn]
        self.assertEqual([step for step, _ in detail["zone_colors"]], [*steps, None])
        fills = {step: fill for step, fill in detail["zone_colors"] if step}
        self.assertEqual(len(set(fills.values())), len(fills))  # a color per step
        self.assertTrue(all(fill not in ("none", "rgba(0, 0, 0, 0)") for fill in fills.values()), fills)
        # The defense's side of each zone is three boxes (the owner: "allows 3rd fewest" was all relative):
        # shots a game it allows from there, that zone's share of all the shots it allows, and the league
        # rank for shots a game. The count and the rank are on the zone's own step; the share is on the
        # step of ITS league rank (1st = the biggest share), worked out here from every team's numbers.
        areas = ["point", "left", "right", "slot", "low_slot", "long"]
        share = {team: {a: d[f"a_{a}"]["season"] / sum(d[f"a_{x}"]["season"] for x in areas) for a in areas} for team, d in self.shots["defense"].items()}
        ordinal = lambda n: f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"
        for area, step, boxes in zip(drawn, steps, detail["zone_boxes"]):
            share_rank = sorted(share, key=lambda team: -share[team][area]).index("DET") + 1
            self.assertEqual([text for text, _ in boxes], [f"{defense[f'a_{area}']['season']:.1f}/g", f"{share['DET'][area] * 100:.0f}%", ordinal(defense[f"a_{area}"]["season_rank"])], area)
            self.assertEqual([on for _, on in boxes], [step, str((share_rank - 1) * 8 // 32 + 1), step], area)
        # The strip outside the zone: one line, the same three numbers, no boxes and no color.
        self.assertEqual(detail["zone_boxes"][5], [])
        self.assertIn(f"allows {defense['a_long']['season']:.1f}/g", detail["strip"])
        self.assertNotIn("fewest", " ".join(z for z in detail["zones"]) + detail["strip"])
        self.assertEqual(detail["zone_colors"][-1][1], "rgba(0, 0, 0, 0)")  # the strip outside the zone is never colored
        self.assertEqual(detail["key"], 8)

    def test_clicking_the_open_row_closes_it(self):
        self.open()
        PAGE.evaluate("() => document.querySelector('.shots-row.shots-open').children[3].click()")
        self.assertEqual(len(PAGE.query_selector_all(".shots-detail")), 0)

    def test_every_row_opens(self):
        reset()
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
        self.assertEqual(opened, len(expected_plays()))
        self.assertGreater(opened, 200)
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
        # No line was saved for these games, and a player with no line is never listed.
        self.assertEqual(reset(LAST_NIGHT), [])
        self.assertIn("started", PAGE.inner_text("#shots-locked"))
        result = lambda: PAGE.evaluate("(key) => document.querySelector(`.shots-row[data-row='${key}']`).lastElementChild.textContent.trim().replace(/\\s+/g, ' ')", f"{game['game_id']}:{benson['id']}")
        # With a line, the play is graded. He had 2: an under 2.5 won, an over 2.5 lost.
        sides = []
        for over, under in ((-400, 150), (150, -400)):
            PAGE.evaluate("([gid, id, over, under]) => { DATA.player_odds[gid] = { [id]: { sog: { line: 2.5, over, under } } }; render(); }", [game["game_id"], benson["id"], over, under])
            sides.append(build_nhl.shots_play(benson["chances"][2], 2.5, over, under)["side"])
            self.assertEqual(result(), "W 2" if sides[-1] == "under" else "L 2")
        self.assertEqual(sides, ["under", "over"])  # each time the play is the side with the generous price
        # Under "Lineup Confirmed" a game that started before its lineup was read says so, and offers All.
        PAGE.evaluate("() => { shotsView.lineup = 'confirmed'; render(); }")
        self.assertIn("No lineup was in for these games before puck drop.", PAGE.inner_text("#shots-content"))
        PAGE.evaluate("() => document.querySelector('.shots-waiting .shots-filter-btn').click()")
        self.assertEqual(len(PAGE.evaluate(ROWS)), 1)
        PAGE.evaluate("(gid) => { delete DATA.player_odds[gid]; render(); }", game["game_id"])

    def test_the_record_tiles(self):
        reset()
        text = PAGE.inner_text("#shots-results").upper().replace("\n", " ")
        for piece in ("THE RECORD SO FAR", "21 GAMES", "EDGE 6 TO 12", "9-5", "64%", "+3.4U", "EDGE 3 TO 6", "14-12", "12+: CHECK FIRST", "1-2", "UNDERS WITH AN EDGE", "15-8", "AGAINST HIS AVERAGE", "6-3", "WITH HIS AVERAGE", "17-14"):
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
