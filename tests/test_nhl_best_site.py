"""The NHL Best Plays page (site/nhl/best.js), run in a real browser on the saved
NHL data, Shots and Goals samples.

What is pinned (the owner, 2026-10-15: "I am in a rush, what are my best overall
bets tonight"): every play the Shots and Goals pages call an edge (3+ points) is
listed, and nothing else; the Shots plays are the build's shots_play (the side,
price and edge the record grades); no cap and no "Check" group, biggest edge
first; every column sorts (Odds = the biggest payout first); the market
switches; the notes (no lineup yet, a line change); the lineup banner; a row
opens that player's own row on the Shots or Goals page; and Best Plays leads
the Player Props menu."""
import math
import unittest

from helpers import nhl_data, nhl_goals, nhl_points, nhl_shots  # first: puts tools/ on the import path

import build_nhl
from site_browser import SiteBrowser

SITE = PAGE = None
TONIGHT = "2026-10-13"
LEAN = build_nhl.SHOTS_EDGES["lean"]

ROWS = """() => [...document.querySelectorAll('.best-row')].map((tr) => {
  const text = (sel) => (tr.querySelector(sel) || {}).textContent?.trim().replace(/\\s+/g, ' ') || '';
  const chip = tr.querySelector('.best-play');
  return { key: tr.dataset.key, href: tr.dataset.href, play: `${chip.querySelector('b').textContent} ${chip.querySelector('span').textContent}`, odds: text('.best-odds'), fair: text('.best-fair'), edge: text('.shots-edge'), notes: text('.best-notes') };
})"""


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/best.html")
        PAGE.wait_for_function("() => typeof GOALS !== 'undefined' && GOALS !== null && !document.getElementById('best-app').hidden")
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
            Object.assign(bestView, { markets: { sog: true, goal: true, pts: true }, sort: 'edge', dir: -1, when: 'all' }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def expected(day=TONIGHT):
    """{"market:game:player": play} for every play with an edge, as the build files them."""
    data, shots, goals, pts = nhl_data(), nhl_shots(), nhl_goals(), nhl_points()
    games = [g["game_id"] for g in data["schedule"] if g["date"] == day]
    out = {}
    for gid in games:
        for row in (shots["games"].get(gid) or {}).get("players", []):
            market = ((data["player_odds"].get(gid) or {}).get(row["id"]) or {}).get("sog")
            if row["out"] or not market:
                continue
            play = build_nhl.shots_play(row["chances"][math.floor(market["line"])], market["line"], market.get("over"), market.get("under"), row["avg"], row["move"])
            if play and play["edge"] >= LEAN:
                out[f"sog:{gid}:{row['id']}"] = {**play, "row": row}
        for row in (goals["games"].get(gid) or {}).get("players", []):
            if not row["out"] and row["odds"] is not None and row["edge"] is not None and row["edge"] >= LEAN:
                out[f"goal:{gid}:{row['id']}"] = {"price": row["odds"], "edge": row["edge"], "size": row["size"], "fair": row["fair"], "row": row}
        # Points: the build's play as points.json files it.
        for row in (pts["games"].get(gid) or {}).get("players", []):
            if not row["out"] and row["side"] and row["edge"] is not None and row["edge"] >= LEAN:
                chance = row["chance_over"] if row["side"] == "over" else 1 - row["chance_over"]
                out[f"pts:{gid}:{row['id']}"] = {"side": row["side"], "line": row["line"], "price": row["price"], "edge": row["edge"], "size": row["size"], "chance": chance, "row": row}
    return out


def fair(p):
    """shots.js fairPrice: the American price at which a chance p breaks even."""
    return round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def price(n):
    return f"+{n}" if n > 0 else str(n)


class Listing(unittest.TestCase):
    def test_every_edge_from_both_pages_and_nothing_else(self):
        rows = reset()
        plays = expected()
        self.assertEqual({r["key"] for r in rows}, set(plays))
        self.assertTrue(all(any(k.startswith(f"{m}:") for k in plays) for m in ("sog", "goal", "pts")))
        self.assertEqual(SITE.errors, [])

    def test_the_plays_are_the_builds(self):
        """Shots: the side, line, price and edge the record grades (build_nhl.shots_play). Goals and Points: the build's play and edge."""
        plays = expected()
        for r in reset():
            play = plays[r["key"]]
            self.assertEqual(r["odds"], price(play["price"]), r)
            # GMG Fair (the owner, 2026-10-15): the model's chance as a price with no cut, as the Shots / Goals pages show it.
            self.assertEqual(r["fair"], price(play["fair"]) if r["key"].startswith("goal:") else price(fair(play["chance"])), r)
            self.assertLessEqual(abs(float(r["edge"]) - play["edge"] * 100), 0.05 + 1e-9, r)
            if r["key"].startswith("goal:"):
                self.assertEqual(r["play"], "Scores goal", r)
            else:
                self.assertEqual(r["play"], f"{play['side'][0]}{play['line']:.1f} {'shots' if r['key'].startswith('sog:') else 'points'}", r)

    def test_no_cap_and_no_check_group_biggest_edge_first(self):
        """The owner: "if the model notices an edge, we shouldn't punish ourselves". The big gaps the
        Shots and Goals pages set apart as "check" are ranked like any other play."""
        rows = reset()
        edges = [float(r["edge"]) for r in rows]
        self.assertEqual(edges, sorted(edges, reverse=True))
        sizes = {expected()[r["key"]]["size"] for r in rows}
        self.assertIn("check", sizes)
        self.assertNotIn("check", PAGE.inner_text("#best-content").lower())
        self.assertNotIn("Win %", PAGE.inner_text("#best-content"))

    def test_every_column_sorts_and_odds_means_the_biggest_payout(self):
        reset()
        PAGE.click('.shots-sort[data-sort="odds"]')
        payouts = [(lambda n: n / 100 if n > 0 else 100 / -n)(int(r["odds"])) for r in PAGE.evaluate(ROWS)]
        self.assertEqual(payouts, sorted(payouts, reverse=True))
        PAGE.click('.shots-sort[data-sort="odds"]')  # again: the other way
        payouts = [(lambda n: n / 100 if n > 0 else 100 / -n)(int(r["odds"])) for r in PAGE.evaluate(ROWS)]
        self.assertEqual(payouts, sorted(payouts))
        PAGE.click('.shots-sort[data-sort="time"]')
        starts = PAGE.evaluate("() => [...document.querySelectorAll('.best-row')].map((tr) => DATA.schedule.find((g) => g.game_id === tr.dataset.key.split(':')[1]).start_utc)")
        self.assertEqual(starts, sorted(starts))

    def test_market_switches(self):
        reset()
        PAGE.click('.best-market[data-market="sog"]')
        PAGE.click('.best-market[data-market="pts"]')
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith("goal:") for r in rows))
        # The last market on can't be switched off.
        PAGE.click('.best-market[data-market="goal"]')
        self.assertEqual(PAGE.evaluate("() => bestView.markets"), {"sog": False, "goal": True, "pts": False})
        PAGE.click('.best-market[data-market="pts"]')
        PAGE.click('.best-market[data-market="goal"]')
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith("pts:") for r in rows))


class Notes(unittest.TestCase):
    def test_no_lineup_and_line_change_notes_and_the_banner(self):
        rows = reset()
        # Each play says whether ITS projection had the lineup (its own page's board).
        boards = {"sog": nhl_shots()["games"], "goal": nhl_goals()["games"], "pts": nhl_points()["games"]}
        plays = expected()
        for r in rows:
            market, gid, _ = r["key"].split(":")
            self.assertEqual("No lineup" in r["notes"], not boards[market][gid].get("posted"), r)
            move = plays[r["key"]]["row"].get("move")
            self.assertEqual("▲" in r["notes"] or "▼" in r["notes"], bool(move), r)
        posted = PAGE.evaluate("(day) => Object.fromEntries(gamesOn(day).filter(anyBoard).map((g) => [g.game_id, !!anyBoard(g).posted]))", TONIGHT)
        waiting = sum(1 for v in posted.values() if not v)
        banner = PAGE.inner_text("#best-lineups") if waiting else ""
        if waiting:
            self.assertIn(f"Lineups are in for {len(posted) - waiting} of {len(posted)} games", banner)
        else:
            self.assertTrue(PAGE.locator("#best-lineups").is_hidden())


class Record(unittest.TestCase):
    """The YTD popup filters each market's season-long ledger by days back and a minimum edge
    (the owner, 2026-10-16: "How are SOG Best plays with a 10% edge doing in the last 15 days")."""

    def setUp(self):
        # The Points sample was built with a ledger, the Shots and Goals samples before there was one.
        PAGE.evaluate("() => { try { localStorage.removeItem('nfl-tool.nhl-best-record.v1'); } catch (e) {} delete POINTS.record.ledger; }")

    def tearDown(self):
        PAGE.evaluate("() => { delete SHOTS.record.ledger; delete GOALS.record.ledger; delete POINTS.record.ledger; Object.assign(recordView, { days: 0, sog: 3, goal: 3, pts: 3 }); document.getElementById('best-record-modal').hidden = true; }")

    def tiles(self):
        return PAGE.evaluate("() => Object.fromEntries(['all', 'sog', 'goal', 'pts'].map((k) => [k, document.querySelector(`[data-rec-body=\"${k}\"] b`).textContent]))")

    def test_days_back_and_minimum_edge(self):
        PAGE.evaluate("""() => {
            const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
            SHOTS.record.ledger = [[ago(40), 0.15, 1, 0.9], [ago(10), 0.04, 0, -1], [ago(10), 0.0996, 1, 0.8], [ago(2), 0.12, 0, -1], [ago(1), 0.03, 1, 1.1]];
            GOALS.record.ledger = [[ago(20), 0.05, 1, 4], [ago(3), 0.08, 0, -1]];
            POINTS.record.ledger = [[ago(30), 0.07, 1, 0.9], [ago(5), 0.04, 1, 1.2]];
            Object.assign(recordView, { days: 0, sog: 3, goal: 3, pts: 3 });
            renderRecord();
        }""")
        reset()
        PAGE.click("#best-record-open")
        self.assertEqual(self.tiles(), {"all": "6-3", "sog": "3-2", "goal": "1-1", "pts": "2-0"})
        PAGE.click('[data-rec-days="15"]')  # the 40-, 30- and 20-day-old plays drop out
        self.assertEqual(self.tiles(), {"all": "3-3", "sog": "2-2", "goal": "0-1", "pts": "1-0"})
        # 10+ points: 9.96 counts (the table shows it as 10.0); each market's slider is its own.
        PAGE.fill('[data-rec-edge="sog"]', "10")
        self.assertEqual(self.tiles(), {"all": "2-2", "sog": "1-1", "goal": "0-1", "pts": "1-0"})
        PAGE.fill('[data-rec-edge="pts"]', "5")
        self.assertEqual(self.tiles()["pts"], "0-0")
        self.assertIn("SHOTS 10+", PAGE.inner_text('[data-rec-sub="all"]').upper())
        self.assertIn("POINTS 5+", PAGE.inner_text('[data-rec-sub="all"]').upper())
        # Remembered on this device.
        self.assertEqual(PAGE.evaluate("() => JSON.parse(localStorage.getItem('nfl-tool.nhl-best-record.v1'))"), {"days": 15, "sog": 10, "goal": 3, "pts": 5})
        self.assertEqual(SITE.errors, [])

    def test_without_ledgers_the_season_buckets(self):
        """A shots.json from before the ledger (the saved samples): the season's strong + lean + check, no filters."""
        reset()
        PAGE.click("#best-record-open")
        self.assertEqual(PAGE.locator("[data-rec-days]").count(), 0)
        rec = nhl_shots()["record"]
        wins = sum(rec[k]["wins"] for k in ("strong", "lean", "check"))
        self.assertIn(f"{wins}-", PAGE.inner_text("#best-results"))


class Links(unittest.TestCase):
    def test_a_row_opens_his_row_on_the_shots_goals_or_points_page(self):
        rows = reset()
        pages = {"sog": "shots", "goal": "goals", "pts": "points"}
        for r in rows:
            market, gid, pid = r["key"].split(":")
            self.assertEqual(r["href"], f"{pages[market]}.html#row={gid}:{pid}")
        for market, page, view in (("sog", "shots", "shotsView"), ("goal", "goals", "goalsView"), ("pts", "points", "pointsView")):
            _, gid, pid = next(r["key"] for r in rows if r["key"].startswith(market + ":")).split(":")
            other = SITE.open(f"nhl/{page}.html#row={gid}:{pid}")
            try:
                other.wait_for_function("() => !document.getElementById('shots-app').hidden")
                self.assertEqual(other.evaluate(f"() => [gameId, {view}.open]"), [gid, f"{gid}:{pid}"])
                self.assertTrue(other.locator(f'.shots-row.shots-open[data-row="{gid}:{pid}"]').is_visible())
            finally:
                other.close()
        self.assertEqual(SITE.errors, [])

    def test_best_plays_leads_the_player_props_menu(self):
        reset()
        PAGE.click(".page-nav .nhl-trigger")
        items = PAGE.evaluate("() => [...document.querySelectorAll('.nhl-menu a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('promo-current')])")
        self.assertEqual(items, [["Game Previews", "/nhl/", False], ["Best Plays", "/nhl/best.html", True], ["Shots", "/nhl/shots.html", False], ["Goals", "/nhl/goals.html", False], ["Points", "/nhl/points.html", False], ["Line Stacks", "/nhl/stacks.html", False]])
        PAGE.keyboard.press("Escape")


if __name__ == "__main__":
    unittest.main()
