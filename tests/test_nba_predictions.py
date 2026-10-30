"""NBA Game Predictions (nba/predict.py; build_nba.py compute_predictions / predictions_record;
site/nba/game-predictions.html + predict-view.js; the League Stats Chart's Points Ledger, 2026-10-30).

What is pinned: every row reads the offense AND what tonight's defense allows (the site's matchup
rule); the rows add up to the projected score; an average team against an average team is the
league average plus home court; the rows explain most of why teams' real ratings differ (the honesty
check on the real 2026-10-30 numbers); fair prices at the book's line; the record locks at tip,
grades finals and feeds the YTD tracker (favorite = a minus price or line); the pages draw it."""
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from statistics import correlation

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import build_nba  # noqa: E402
import predict  # noqa: E402
from site_browser import SiteBrowser  # noqa: E402

CHART = json.loads((ROOT / "tests" / "fixtures" / "nba_predictions_chart_2026-10-30.json").read_text(encoding="utf-8"))


def flat_row(**kw):
    row = {"games": 8, "pace": 100.0, "o_rtg": 112.0, "d_rtg": 112.0, "o_reb": 0.27, "d_reb": 0.73}
    for side in ("o", "d"):
        row.update({f"{side}_3par": 0.42, f"{side}_3pct": 0.36, f"{side}_paint_share": 0.48, f"{side}_paint_pct": 0.58,
                    f"{side}_mid_share": 0.10, f"{side}_mid_pct": 0.42, f"{side}_tov": 0.13, f"{side}_ftr": 0.25,
                    f"{side}_ftpct": 0.78, f"{side}_fgapp": 0.88})
    row.update(kw)
    return row


def game(gid, date, start, away, home, status="scheduled", score=(None, None), **lines):
    return {"game_id": gid, "date": date, "start_utc": start, "away": away, "home": home, "status": status,
            "away_score": score[0], "home_score": score[1], **lines}


class Model(unittest.TestCase):
    def test_average_against_average_is_the_league_plus_home_court(self):
        table = {t: flat_row() for t in ("A", "B", "C")}
        p = predict.predict(table, "A", "B")
        self.assertEqual(p["pts"], [111.0, 113.0])  # 112 a 100 at 100 possessions, 2 points of home court
        self.assertEqual(p["margin"], 2.0)
        self.assertTrue(all(abs(a) < 0.05 and abs(h) < 0.05 for k, a, h, _ in p["rows"] if k not in ("base", "home")))

    def test_both_sides_count_the_offense_and_what_the_defense_allows(self):
        table = {t: flat_row() for t in ("A", "B", "C", "D")}
        table["A"]["o_tov"] = 0.16  # A turns it over
        table["B"]["d_tov"] = 0.16  # B forces turnovers
        rows = {k: (a, h) for k, a, h, _ in predict.predict(table, "A", "B")["rows"]}
        alone = {k: (a, h) for k, a, h, _ in predict.predict(table, "A", "C")["rows"]}
        self.assertLess(alone["tov"][0], 0)  # A's own turnovers cost it
        self.assertLess(rows["tov"][0], alone["tov"][0] - 0.5)  # and more against a defense that forces them
        table["A"]["o_3pct"] = 0.40  # a better shooter
        rows = {k: (a, h) for k, a, h, d in predict.predict(table, "A", "C")["rows"]}
        self.assertGreater(rows["threes"][0], 0)

    def test_the_rows_add_up_to_the_projected_score(self):
        for away, home in (("CHA", "WSH"), ("ORL", "TOR"), ("LAL", "GS")):
            p = predict.predict(CHART, away, home)
            for i in (0, 1):
                self.assertAlmostEqual(sum(r[1 + i] for r in p["rows"]), p["pts"][i], delta=0.4)
            self.assertAlmostEqual(p["pts"][1] - p["pts"][0], p["margin"], delta=0.11)

    def test_the_rows_explain_most_of_each_teams_real_rating(self):
        """The ingredients are the real recipe: unshrunk, the rows track each team's real rating."""
        lg = predict.League(CHART)
        for side in ("o", "d"):
            explained, real = [], []
            for t in CHART:
                rows = lg.per100(t, None, False) if side == "o" else lg.per100(None, t, False)
                explained.append(lg.avg["o", "rtg"] + sum(r["pts"] for r in rows.values()))
                real.append(CHART[t][f"{side}_rtg"])
            self.assertGreater(correlation(explained, real), 0.85, side)

    def test_missing_numbers_give_no_prediction(self):
        table = {t: {k: v for k, v in flat_row().items() if k != "o_3pct"} for t in ("A", "B")}
        self.assertIsNone(predict.predict(table, "A", "B"))
        self.assertIsNone(predict.predict({"A": flat_row()}, "A", "ZZZ"))

    def test_fair_prices_at_the_books_line(self):
        o = predict.odds(0.0, 220.0, {"home_team_spread": 0.0, "away_team_spread": 0.0, "total_line": 220.0})
        self.assertEqual(o["fair"]["spread"], [0.5, 0.5])
        self.assertEqual(o["fair"]["total"], [0.5, 0.5])
        o = predict.odds(6.0, 230.0, {"home_team_spread": -3.0, "total_line": 220.0})
        self.assertGreater(o["fair"]["spread"][1], 0.55)  # home by 6 covers -3 more often than not
        self.assertGreater(o["fair"]["ml"][1], o["fair"]["spread"][1])  # winning is easier than covering
        self.assertGreater(o["fair"]["total"][0], 0.65)
        self.assertEqual(predict.fair_american(0.6), -150)
        self.assertEqual(predict.fair_american(0.4), 150)
        self.assertIsNone(predict.odds(1.0, 220.0, {})["fair"]["spread"])  # no line, no spread price


class Record(unittest.TestCase):
    def test_locks_at_tip_grades_finals_and_feeds_the_ytd_tracker(self):
        table = {t: flat_row() for t in ("A", "B", "C", "D")}
        table["B"]["o_3pct"] = 0.40  # B the better team: home favorite
        chart = {"season": table}
        lines = dict(home_team_spread=-1.5, away_team_spread=1.5, home_spread_odds=-110, away_spread_odds=-110,
                     total_line=230.0, over_odds=-110, under_odds=-110, home_moneyline=-120, away_moneyline=100)
        games = [game("1", "2026-10-30", "2026-10-30T23:00Z", "A", "B", **lines), game("2", "2026-10-30", "2026-10-31T02:00Z", "C", "D", **lines)]
        with tempfile.TemporaryDirectory() as tmp:
            build_nba.PRED_RECORD_DIR, kept = Path(tmp), build_nba.PRED_RECORD_DIR
            try:
                before = build_nba.compute_predictions(chart, games, 2027, datetime(2026, 10, 30, 12))
                self.assertEqual(set(before["upcoming"]["season"]), {"1", "2"})
                self.assertEqual(before["upcoming"]["season"]["1"]["date"], "2026-10-30")
                # game 1 tips; the line moves and B's shooting changes: its record stays as it was at tip
                games[0]["home_team_spread"] = -9.5
                table["B"]["o_3pct"] = 0.30
                during = build_nba.compute_predictions(chart, games, 2027, datetime(2026, 10, 30, 23, 30))
                self.assertNotIn("1", during["upcoming"]["season"])
                self.assertEqual(during["record"]["1"]["book"]["spread"][1], -1.5)
                self.assertEqual(during["record"]["1"]["pts"], before["record"]["1"]["pts"])
                # final: B wins 120-110 (covers -1.5; 230 total = push)
                games[0].update(status="final", away_score=110, home_score=120)
                after = build_nba.compute_predictions(chart, games, 2027, datetime(2026, 10, 31, 12))
                self.assertEqual(after["record"]["1"]["result"], [110, 120])
                ledger = after["ledger"]
                self.assertEqual([r[2] for r in ledger["spread"]], [1])  # our side: B -1.5, won
                self.assertEqual(ledger["spread"][0][4], ["fav", "home"])
                self.assertEqual(ledger["total"], [])  # a push is left out
                ml = ledger["ml"][0]
                self.assertEqual(ml[4][1], "home")
                self.assertEqual(ml[4][0], "fav")  # -120: a minus price is the favorite
                self.assertAlmostEqual(ml[3], 100 / 120, places=3)
                saved = json.loads((Path(tmp) / "2027.json").read_text())
                self.assertNotIn("graded", saved["1"])  # the page's list only
            finally:
                build_nba.PRED_RECORD_DIR = kept

    def test_grading(self):
        rec = {"result": [100, 103], "book": {"spread": [3.5, -3.5], "total": 203.0}}
        self.assertEqual(predict.grade({"market": "spread", "side": 0}, rec), 1.0)  # +3.5, lost by 3
        self.assertEqual(predict.grade({"market": "spread", "side": 1}, rec), 0.0)
        self.assertIsNone(predict.grade({"market": "total", "side": 0}, rec))  # 203 on 203
        self.assertEqual(predict.grade({"market": "ml", "side": 1}, rec), 1.0)
        self.assertEqual(predict.units(-110, 1.0), 100 / 110)
        self.assertEqual(predict.units(150, 0.0), -1.0)


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class Pages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        today = __import__("datetime").date.today().isoformat()
        lines = dict(home_team_spread=-3.5, away_team_spread=3.5, home_spread_odds=-110, away_spread_odds=-110,
                     total_line=224.5, over_odds=-108, under_odds=-112, home_moneyline=-150, away_moneyline=130)
        schedule = [{**game("88", today, f"{today}T23:30Z", "CHA", "WSH", **lines), "time": "19:30"}]
        chart = {w: CHART for w in ("season", "10", "5", "3")}
        with tempfile.TemporaryDirectory() as tmp:
            build_nba.PRED_RECORD_DIR, kept = Path(tmp), build_nba.PRED_RECORD_DIR
            try:
                preds = build_nba.compute_predictions(chart, schedule, 2027, datetime.strptime(f"{today}T12:00", "%Y-%m-%dT%H:%M"))
            finally:
                build_nba.PRED_RECORD_DIR = kept
        cls.pred = preds["upcoming"]["season"]["88"]
        teams = {t: {"name": f"Team {t}", "short": t, "logo": "", "color": "336699"} for t in CHART}
        SITE.nba = {"season": 2027, "season_label": "2026-27", "teams": teams, "schedule": schedule,
                    "league_chart": chart, "predictions": preds}

    def test_game_predictions_page(self):
        page = SITE.open("nba/game-predictions.html")
        page.wait_for_selector(".gp-card")
        self.assertEqual(SITE.errors, [])
        text = page.inner_text(".gp-card")
        score = page.inner_text(".pv-proj tbody")
        self.assertIn(f"{self.pred['pts'][0]:.1f}", score)
        self.assertIn("GMG FAIR ODDS", text.upper())
        # book odds and our fair odds side by side, a row a team; no percent under a price (the
        # owner, 2026-10-30): the chances live in the hover
        fair = page.evaluate("() => [...document.querySelectorAll('.pv-lines tbody tr')][1].textContent")
        p = self.pred["fair"]["ml"][1]
        ml = round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)
        self.assertIn(f"+{ml}" if ml > 0 else str(ml), fair)
        self.assertNotIn("%", text)
        # the breakdown is always open and adds up to the projected score
        self.assertTrue(page.is_visible(".gp-card .pv-ledger"))
        total = page.evaluate("() => document.querySelector('.pv-ledger tr.pv-total').textContent")
        self.assertIn(f"{self.pred['pts'][1]:.1f}", total)
        page.click("#gp-ytd")
        page.wait_for_selector(".gp-ytd-tracker .ytd-tile, .gp-ytd-tracker *")
        self.assertIn("Graded after tonight", page.inner_text("#gp-ytd-modal"))
        self.assertEqual(SITE.errors, [])

    def test_matchup_keys_show_the_ledger_and_points_on_each_card(self):
        page = SITE.open("nba/league.html")
        page.wait_for_selector(".lsc-grid")
        page.click(".matchup-card")
        page.click("#lsc-keys")
        page.wait_for_selector(".pv-ledger")
        self.assertEqual(SITE.errors, [])
        chips = page.evaluate("() => [...document.querySelectorAll('.lsc-keys:not(.lsc-keys-more) .lsc-key')].map((k) => !!k.querySelector('.pv-chip'))")
        self.assertTrue(chips[0])  # the biggest points first
        self.assertEqual(chips, sorted(chips, reverse=True))  # keys with no points (a trend) come after
        glass = page.evaluate("() => [...document.querySelectorAll('.lsc-key-top')].find((k) => k.textContent.includes('Glass')).textContent")
        a, h = next((r[1], r[2]) for r in self.pred["rows"] if r[0] == "glass")
        self.assertIn(f"{'CHA' if a > h else 'WSH'} +{abs(h - a):.1f}", glass.replace("−", "-"))


if __name__ == "__main__":
    unittest.main()
