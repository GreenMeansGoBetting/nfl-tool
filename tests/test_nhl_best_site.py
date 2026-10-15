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

from helpers import nhl_data, nhl_goals, nhl_shots  # first: puts tools/ on the import path

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
            Object.assign(bestView, { markets: { sog: true, goal: true }, sort: 'edge', dir: -1, when: 'all' }, view);
            gameId = null;
            dayIndex = days().indexOf(day);
            render();
        }""",
        [day, view],
    )
    return PAGE.evaluate(ROWS)


def expected(day=TONIGHT):
    """{"market:game:player": play} for every play with an edge, as the build files them."""
    data, shots, goals = nhl_data(), nhl_shots(), nhl_goals()
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
        self.assertTrue(any(k.startswith("sog:") for k in plays) and any(k.startswith("goal:") for k in plays))
        self.assertEqual(SITE.errors, [])

    def test_the_plays_are_the_builds(self):
        """Shots: the side, line, price and edge the record grades (build_nhl.shots_play). Goals: the build's edge."""
        plays = expected()
        for r in reset():
            play = plays[r["key"]]
            self.assertEqual(r["odds"], price(play["price"]), r)
            # GMG Fair (the owner, 2026-10-15): the model's chance as a price with no cut, as the Shots / Goals pages show it.
            self.assertEqual(r["fair"], price(play["fair"]) if r["key"].startswith("goal:") else price(fair(play["chance"])), r)
            self.assertLessEqual(abs(float(r["edge"]) - play["edge"] * 100), 0.05 + 1e-9, r)
            if r["key"].startswith("sog:"):
                self.assertEqual(r["play"], f"{play['side'][0]}{play['line']:.1f} shots", r)
            else:
                self.assertEqual(r["play"], "Scores goal", r)

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
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith("goal:") for r in rows))
        # The last market on can't be switched off.
        PAGE.click('.best-market[data-market="goal"]')
        self.assertEqual(PAGE.evaluate("() => bestView.markets"), {"sog": False, "goal": True})
        PAGE.click('.best-market[data-market="sog"]')
        PAGE.click('.best-market[data-market="goal"]')
        rows = PAGE.evaluate(ROWS)
        self.assertTrue(rows and all(r["key"].startswith("sog:") for r in rows))


class Notes(unittest.TestCase):
    def test_no_lineup_and_line_change_notes_and_the_banner(self):
        rows = reset()
        # Each play says whether ITS projection had the lineup (its own page's board).
        boards = {"sog": nhl_shots()["games"], "goal": nhl_goals()["games"]}
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


class Links(unittest.TestCase):
    def test_a_row_opens_his_row_on_the_shots_or_goals_page(self):
        rows = reset()
        for r in rows:
            market, gid, pid = r["key"].split(":")
            self.assertEqual(r["href"], f"{'shots' if market == 'sog' else 'goals'}.html#row={gid}:{pid}")
        for market, page, view in (("sog", "shots", "shotsView"), ("goal", "goals", "goalsView")):
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
        PAGE.click(".page-nav .props-trigger")
        items = PAGE.evaluate("() => [...document.querySelectorAll('.props-menu a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('promo-current')])")
        self.assertEqual(items, [["Best Plays", "best.html", True], ["Shots", "shots.html", False], ["Goals", "goals.html", False]])
        PAGE.keyboard.press("Escape")


if __name__ == "__main__":
    unittest.main()
