"""The site's JavaScript, run in a real browser on the saved data sample.

Game Previews (game-overview.html) and TD Data (index.html) are opened once;
each test calls the page's own functions. Rules that exist twice (once in the
build, once in the browser) are checked against each other here."""
import unittest

from helpers import site_data  # first: puts nfl_tool/ and tools/ on the import path

import gmg_model
from site_browser import SiteBrowser

SITE = GAME = TD = None


def setUpModule():
    global SITE, GAME, TD
    SITE = SiteBrowser()
    try:
        GAME = SITE.open("game-overview.html")
        TD = SITE.open("index.html")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class PagesLoad(unittest.TestCase):
    def test_no_script_errors_on_the_sample(self):
        self.assertEqual(SITE.errors, [])
        self.assertEqual(GAME.evaluate("() => DATA.generated_at"), "2026-10-12T12:19Z")


class ModelMatchesTheBuild(unittest.TestCase):
    """The GMG model is written twice: gmg_model.py (the locked score) and
    gsModelCompute in game-summary.js (the sliders). On GMG default weights
    they must give the same score."""

    def test_same_score_for_every_game(self):
        blob = site_data()
        grades = gmg_model._Grades(blob)
        rows = GAME.evaluate(
            """() => DATA.schedule.filter((g) => g.week === DATA.current_week || g.week === DATA.current_week + 1).map((g) => ({
                id: g.game_id,
                score: gsModelCompute(g, gsModelDefaults()),
                qb_out: [g.away, g.home].filter((t) => gsQbOut(t, g.week)),
            }))"""
        )
        self.assertGreaterEqual(len(rows), 25)
        qb_out_games = 0
        for row in rows:
            game = next(g for g in blob["schedule"] if g["game_id"] == row["id"])
            build = gmg_model._project(blob, grades, game)
            self.assertIsNotNone(build, row["id"])
            self.assertIsNotNone(row["score"], row["id"])
            # The build rounds to a tenth of a point; the browser rounds when it draws.
            for side in ("away_pts", "home_pts"):
                self.assertAlmostEqual(row["score"][side], build[side], delta=0.0501, msg=f"{row['id']} {side}: browser {row['score'][side]:.2f}, build {build[side]}")
            self.assertEqual(row["qb_out"], build["qb_out"], f"{row['id']}: starting QB out")
            qb_out_games += bool(build["qb_out"])
        self.assertGreaterEqual(qb_out_games, 1, "the sample should include a game with a starting QB out")

    def test_weights_lists_match(self):
        js = GAME.evaluate(
            """() => ({
                blend: Object.fromEntries(GS_MODEL_BLEND.map((f) => [f.key, f.base])),
                grades: Object.fromEntries(GS_MODEL_MATCHUPS.filter((f) => f.cat).map((f) => [f.cat, f.base])),
                stats: GS_MODEL_MATCHUPS.filter((f) => !f.cat).map((f) => [f.offKey, f.offInvert, f.defKey, f.defInvert, f.base]),
                total: GS_MODEL_MATCHUPS.reduce((sum, f) => sum + f.base, 0),
                points: Object.fromEntries(GS_MODEL_POINTS.map((f) => [f.key, f.base])),
                prior: GS_MODEL_PRIOR_GAMES,
                trust: GS_MODEL_FULL_TRUST_GAMES,
            })"""
        )
        percent = lambda weights: {k: round(v * 100, 6) for k, v in weights.items()}
        self.assertEqual(js["blend"], percent(gmg_model.BLEND))
        self.assertEqual(js["grades"], percent(gmg_model.GRADE_WEIGHTS))
        self.assertEqual(
            sorted(map(tuple, js["stats"])),
            sorted((off, off_inv, dfn, def_inv, round(w * 100, 6)) for off, off_inv, dfn, def_inv, w in gmg_model.STAT_WEIGHTS),
        )
        self.assertEqual(js["total"], 100, "the browser turns the matchup weights into shares of their total")
        self.assertEqual(
            js["points"],
            {"homeField": gmg_model.HOME_FIELD, "qbOut": gmg_model.QB_OUT_POINTS, "impact": gmg_model.POINTS_PER_Z, "stretch": gmg_model.MARGIN_STRETCH},
        )
        self.assertEqual((js["prior"], js["trust"]), (gmg_model.PRIOR_GAMES, gmg_model.FULL_TRUST_GAMES))

    def test_grade_recipes_match(self):
        js = GAME.evaluate(
            """() => ({
                cats: Object.fromEntries(SUMMARY_CATEGORIES.filter((c) => c.off).map((c) => [c.label, Object.fromEntries(["off", "def"].map((side) => [side, c[side].map((m) => [m.key, !!m.invert, m.weight || 1])]))])),
                kinds: SUMMARY_CATEGORIES.map((c) => c.label),
                scheme: ALL_SCHEME_ROWS.map((r) => [r.perfKey, r.defSuccessKey]),
            })"""
        )
        build = {label: {side: [list(m) for m in metrics] for side, metrics in sides.items()} for label, sides in gmg_model.CATEGORIES.items()}
        self.assertEqual(js["cats"], build)
        self.assertEqual(sorted(js["kinds"]), sorted(gmg_model.GRADE_WEIGHTS))
        self.assertEqual(js["scheme"], [list(row) for row in gmg_model.SCHEME_ROWS])


class PickNeedsFourPoints(unittest.TestCase):
    def test_same_number_in_the_build_and_the_browser(self):
        self.assertEqual(GAME.evaluate("() => GS_MODEL_EDGE"), gmg_model.EDGE_POINTS)

    def test_under_four_points_is_a_lean(self):
        cells = GAME.evaluate(
            """() => [3.9, 4.0].map((edge) => gsModelPickCell({ away: "BUF", home: "LA", spread: -3.5, spread_pick: "away", spread_edge: edge }, "spread"))"""
        )
        self.assertIn("gm-lean", cells[0])
        self.assertNotIn("gm-pick-big", cells[0])
        self.assertIn("gm-pick-big", cells[1])

    def test_the_record_only_counts_picks(self):
        record = GAME.evaluate(
            """() => gsModelTally([
                { spread_result: "win", spread_edge: 3.9 },
                { spread_result: "win", spread_edge: 0.5 },
                { spread_result: "loss", spread_edge: 4.0 },
                { spread_result: "win", spread_edge: 6.5 },
            ], "spread", GS_MODEL_EDGE)"""
        )
        self.assertEqual(record, "1-1")


class GameSummaryEdgeRule(unittest.TestCase):
    """Who has the edge on the Game Summary card, straight from the two ranks
    shown: 16+ ranks apart = clear, 8-15 = slight, both top 8 = strength vs
    strength, anything else = even."""

    @staticmethod
    def expected(off, dfn):
        if not off or not dfn:
            return "none", None
        gap = dfn - off
        if abs(gap) >= 16:
            return "clear", "OFF" if gap > 0 else "DEF"
        if abs(gap) >= 8:
            return "slight", "OFF" if gap > 0 else "DEF"
        if off <= 8 and dfn <= 8:
            return "str", None
        return "none", None

    def test_the_cut_points(self):
        cases = {
            (1, 17): ("clear", "OFF"), (1, 16): ("slight", "OFF"), (1, 9): ("slight", "OFF"), (2, 9): ("none", None),
            (1, 8): ("str", None), (8, 8): ("str", None), (8, 1): ("str", None),
            (9, 1): ("slight", "DEF"), (16, 1): ("slight", "DEF"), (17, 1): ("clear", "DEF"), (32, 1): ("clear", "DEF"),
            (9, 9): ("none", None), (20, 24): ("none", None), (9, 8): ("none", None), (None, 5): ("none", None), (5, None): ("none", None),
        }
        got = GAME.evaluate(
            """(pairs) => {
                const real = gsCategoryRank;
                try {
                    return pairs.map(([off, def]) => {
                        window.gsCategoryRank = (cat, team, side) => (side === "off" ? off : def);
                        const e = gsRankEdge(SUMMARY_CATEGORIES[0], "OFF", "DEF");
                        return [e.kind, e.adv];
                    });
                } finally {
                    window.gsCategoryRank = real;
                }
            }""",
            [list(pair) for pair in cases],
        )
        for (pair, want), have in zip(cases.items(), got):
            self.assertEqual(tuple(have), want, f"offense #{pair[0]} vs defense #{pair[1]}")
            self.assertEqual(want, self.expected(*pair))

    def test_every_chip_agrees_with_the_ranks_beside_it(self):
        rows = GAME.evaluate(
            """() => DATA.schedule.filter((g) => g.week === DATA.current_week).flatMap((g) => [[g.away, g.home], [g.home, g.away]].flatMap(([off, def]) =>
                SUMMARY_CATEGORIES.map((cat) => ({ ...gsRankEdge(cat, off, def), cat: cat.label, off, def }))))"""
        )
        kinds = set()
        for r in rows:
            kind, adv = self.expected(r["offRank"], r["defRank"])
            adv = {"OFF": r["off"], "DEF": r["def"], None: None}[adv]
            self.assertEqual((r["kind"], r["adv"]), (kind, adv), f"{r['cat']}: {r['off']} offense #{r['offRank']} vs {r['def']} defense #{r['defRank']}")
            kinds.add(kind)
        self.assertEqual(kinds, {"clear", "slight", "str", "none"}, "the sample should show every kind of edge")


class TwoSidedMatchupCalls(unittest.TestCase):
    """Every matchup call reads the offense's number AND what the defense
    allows. The bug this guards: "PHI 3.0 Y/C vs heavy box" read as Tough
    while CHI allowed 4.9 Y/C in that same box."""

    def test_matchup_call(self):
        # (offense z, defense-allowed z): + is good for the offense on both.
        cases = {
            (1.0, 1.0): 1, (1.0, 0.0): 1, (0.0, 1.0): 1, (1.0, -0.2): 1,
            (-1.0, -1.0): -1, (-1.0, 0.0): -1, (0.0, -1.0): -1, (-1.0, 0.2): -1,
            (1.0, -0.4): 0, (2.5, -0.4): 0, (-1.0, 0.4): 0, (-2.5, 0.4): 0,
            (-1.2, 1.0): 0,  # PHI heavy box: poor offense number, but the defense gets gashed
            (0.5, 0.5): 0, (-0.5, -0.5): 0, (0.0, 0.0): 0,
            (1.0, None): 0, (-1.0, None): 0, (None, 1.0): 0, (None, None): 0,
        }
        got = GAME.evaluate("(pairs) => pairs.map(([off, def]) => matchupCall(off, def).dir)", [list(p) for p in cases])
        for (pair, want), have in zip(cases.items(), got):
            self.assertEqual(have, want, f"offense z {pair[0]}, defense-allowed z {pair[1]}")
        self.assertEqual(TD.evaluate("() => [matchupCall(-1.2, 1.0).dir, matchupCall(-1.0, null).dir, matchupCall(1.0, 1.0).dir]"), [0, 0, 1])

    def test_matchup_kind(self):
        cases = {
            (1.0, 1.0): "mismatch", (-1.0, -1.0): "tough", (1.0, -1.0): "strong", (-1.0, 1.0): "weak",
            (-1.0, 0.0): None, (1.0, 0.0): None, (-1.0, None): None, (None, -1.0): None,
        }
        got = GAME.evaluate("(pairs) => pairs.map(([off, def]) => matchupKind(off, def))", [list(p) for p in cases])
        for (pair, want), have in zip(cases.items(), got):
            self.assertEqual(have, want, f"offense z {pair[0]}, defense-allowed z {pair[1]}")

    def test_the_heavy_box_case_on_the_scheme_table(self):
        """PHI runs badly into heavy boxes. Whether that is a CHI edge depends
        on what CHI allows in that box, so the same offense number must give
        three different answers."""
        out = GAME.evaluate(
            """() => {
                const row = ALL_SCHEME_ROWS.find((r) => r.perfKey === "ypc_vs_heavy_box");
                const pool = teamsWithGames();
                const all = (key) => pool.map((t) => DATA.team_stats[t][key]).filter((v) => v !== null && v !== undefined);
                const low = (key) => Math.min(...all(key)) - 0.5;
                const high = (key) => Math.max(...all(key)) + 0.5;
                const z = (key, team) => zScore(tierValue(team, key), pool.map((t) => tierValue(t, key)), false);
                const phi = DATA.team_stats.PHI, chi = DATA.team_stats.CHI;
                const saved = [phi[row.perfKey], chi[row.defSuccessKey]];
                const badOffense = low(row.perfKey), goodOffense = high(row.perfKey);
                const gashedDefense = high(row.defSuccessKey), stoutDefense = low(row.defSuccessKey);
                const run = (offValue, defValue, boxRate = 0.34) => {
                    phi[row.perfKey] = offValue;
                    chi[row.defSuccessKey] = defValue;
                    const html = schemeEdgeCell(row, boxRate, "PHI", "CHI");
                    const logo = /alt="([A-Z]+)"/.exec(html);
                    return { offZ: z(row.perfKey, "PHI"), defZ: z(row.defSuccessKey, "CHI"), adv: html.includes("edge-hit") ? logo && logo[1] : null };
                };
                try {
                    return {
                        gashed: run(badOffense, gashedDefense),
                        stout: run(badOffense, stoutDefense),
                        mismatch: run(goodOffense, gashedDefense),
                        rare: run(badOffense, stoutDefense, 0.05),
                        th: TIER_Z_THRESHOLD,
                    };
                } finally {
                    [phi[row.perfKey], chi[row.defSuccessKey]] = saved;
                }
            }"""
        )
        th = out["th"]
        self.assertLessEqual(out["gashed"]["offZ"], -th)
        self.assertGreaterEqual(out["gashed"]["defZ"], th)
        self.assertIsNone(out["gashed"]["adv"], "a poor offense number alone made a call against a defense that gets gashed")
        self.assertEqual(out["stout"]["adv"], "CHI")
        self.assertEqual(out["mismatch"]["adv"], "PHI")
        self.assertIsNone(out["rare"]["adv"], "a look the defense rarely shows should not get a call")


TD_CARD_JS = """
    const wk = DATA.current_week;
    const cards = [];
    for (const g of DATA.schedule.filter((x) => x.week === wk)) {
        const doc = new DOMParser().parseFromString(td2Main(g.away, g.home, wk, firstTdTeamChance(g.away, g.home), g), "text/html");
        cards.push({ g, doc });
    }
"""


class PocketQuarterbacks(unittest.TestCase):
    """A QB is a TD option only if he runs (15+ rush yards or 5+ carries a
    game). Stafford kept showing up off one fluke TD and his red-zone sneaks."""

    # Every QB shown on a TD Summary card this week: in Key Players or the banner photos.
    SHOWN_QBS_JS = "() => {" + TD_CARD_JS + """
        const isRunner = window.realQbIsRunner || qbIsRunner;
        const shown = [];
        for (const { g, doc } of cards) {
            const players = (sel) => [...doc.querySelectorAll(sel)].map((e) => decodeDataAttr(e.dataset.entry));
            const seen = [...players(".td2-keys [data-entry]").map((p) => ({ ...p, where: "Key Players" })), ...players(".td2-banners [data-entry]").map((p) => ({ ...p, where: "banner photo" }))];
            for (const p of seen) {
                const rows = [...((DATA.player_xtd || {})[p.team] || []), ...((DATA.player_props || {})[p.team] || [])];
                if (rows.some((r) => r.position === "QB" && normName(r.name) === normName(p.name))) shown.push({ team: p.team, name: p.name, where: p.where, runner: isRunner(p.team, p.name) });
            }
        }
        return shown;
    }"""

    def test_stafford_and_burrow_are_not_runners_allen_is(self):
        flags = TD.evaluate('() => [qbIsRunner("LA", "Matthew Stafford"), qbIsRunner("CIN", "Joe Burrow"), qbIsRunner("BUF", "Josh Allen")]')
        self.assertEqual(flags, [False, False, True])

    def test_no_pocket_qb_on_any_td_summary_card(self):
        shown = TD.evaluate(self.SHOWN_QBS_JS)
        for p in shown:
            self.assertTrue(p["runner"], f"{p['name']} ({p['team']}) is a pocket QB but shows as a {p['where']}")
        names = {(p["name"], p["where"]) for p in shown}
        self.assertFalse({n for n, _ in names} & {"Matthew Stafford", "Joe Burrow"})
        # A running QB stays: Allen has 7 TDs and BUF @ LA is on the sample's slate.
        self.assertIn(("Josh Allen", "Key Players"), names)
        self.assertIn(("Josh Allen", "banner photo"), names)

    def test_the_sample_would_show_pocket_qbs_without_the_rule(self):
        """Proof the check above can fail: switch the rule off in the page and
        pocket QBs appear."""
        shown = TD.evaluate(
            """() => {
                window.realQbIsRunner = qbIsRunner;
                window.qbIsRunner = () => true;
                try {
                    return (""" + self.SHOWN_QBS_JS + """)();
                } finally {
                    window.qbIsRunner = window.realQbIsRunner;
                    delete window.realQbIsRunner;
                }
            }"""
        )
        pocket = {(p["name"], p["where"]) for p in shown if not p["runner"]}
        self.assertTrue(any(where == "Key Players" for _, where in pocket), pocket)
        self.assertTrue(any(where == "banner photo" for _, where in pocket), pocket)


class TdFirstTdPosition(unittest.TestCase):
    """The First TD section's "1st TD by" row (2026-10-16) reads both sides
    for the SAME position: the one that scored this offense's game-opening
    TDs most, and how often that position beat the other defense to it."""

    def test_both_sides_show_the_offense_top_position(self):
        rows = TD.evaluate("""() => DATA.schedule.filter((g) => g.week === DATA.current_week).flatMap((g) => [[g.away, g.home], [g.home, g.away]]).map(([o, d]) => {
            const r = td2FirstPos(o, d);
            const off = DATA.team_stats[o].first_td_position, def = DATA.team_stats[d].first_td_position_allowed;
            return { o, d, ...r, offMax: Math.max(...POSITIONS.filter((p) => p !== "DST").map((p) => off[p] || 0)), defAt: def[r.pos] || 0, offGames: DATA.team_stats[o].first_td_games };
        })""")
        self.assertTrue(rows)
        for r in rows:
            self.assertNotEqual(r["pos"], "DST")
            self.assertEqual(r["off"], r["offMax"], r)
            self.assertEqual(r["def"], r["defAt"], r)
        # Each offense's first TDs by position add up to its first-TD games.
        self.assertTrue(any(r["offOf"] == r["offGames"] for r in rows))

    def test_the_row_is_on_the_card(self):
        labels = TD.evaluate("() => {" + TD_CARD_JS + """
            return cards.map(({ doc }) => [...doc.querySelectorAll(".g5-label")].map((e) => e.textContent));
        }""")
        for card in labels:
            self.assertIn("1st TD by", card)


class TdSummaryTargets(unittest.TestCase):
    """No target chip on a TD Summary row where the defense's number on the
    card ranks in the league's top 8 (TD2_GOOD_DEF_RANK): a logo next to a
    green defense reads as a mistake (DAL run game vs TB, #7 vs #3)."""

    def test_the_cutoff_is_the_top_eight(self):
        self.assertEqual(TD.evaluate("() => TD2_GOOD_DEF_RANK"), 8)

    def test_no_chip_beside_a_top_eight_defense(self):
        rows = TD.evaluate(
            "() => {" + TD_CARD_JS + """
                const rank = (cell) => { const m = /#(\\d+)/.exec(cell.querySelector(".g5-rank").textContent); return m ? Number(m[1]) : null; };
                const chip = (el) => !el.classList.contains("g5-adv-none");
                const out = [];
                for (const { g, doc } of cards) for (const row of doc.querySelectorAll(".g5-row:not(.g5-head-row):not(.td2-chance-row)")) {
                    const c = [...row.children];
                    if (c.length !== 7) throw new Error("TD Summary row layout changed: " + row.outerHTML.slice(0, 200));
                    const label = row.querySelector(".g5-label").textContent;
                    out.push({ label, off: g.away, def: g.home, defRank: rank(c[2]), chip: chip(c[0]) });
                    out.push({ label, off: g.home, def: g.away, defRank: rank(c[5]), chip: chip(c[6]) });
                }
                return out;
            }"""
        )
        self.assertGreaterEqual(len(rows), 15 * 2 * 8)
        chips = 0
        for r in rows:
            chips += r["chip"]
            if r["defRank"] is not None and r["defRank"] <= 8:
                self.assertFalse(r["chip"], f"{r['label']}: {r['off']} has a target chip against {r['def']}, ranked #{r['defRank']}")
        self.assertGreaterEqual(chips, 10, "the sample should still show target chips against weaker defenses")

    def test_the_sample_has_targets_the_rule_removes(self):
        """Proof the check above can fail: the target model does flag these."""
        dropped = TD.evaluate(
            """() => {
                const on_card = new Set([...TD2_ROWS.map((r) => r.metric), "first"]);
                const out = [];
                for (const g of DATA.schedule.filter((x) => x.week === DATA.current_week)) for (const [off, def] of [[g.away, g.home], [g.home, g.away]]) {
                    const kept = td2TargetItems(off, def);
                    for (const item of targetGroupsAll(off, def).flatMap((group) => group.items)) {
                        if (!on_card.has(item.metric)) continue;
                        const defRank = leagueRank(def, (t) => td2Value(item.metric, t, "def"), false);
                        if (defRank !== null && defRank <= TD2_GOOD_DEF_RANK) out.push({ off, def, metric: item.metric, defRank, kept: item.metric in kept });
                    }
                }
                return out;
            }"""
        )
        self.assertIn(("DAL", "TB", "rush"), {(d["off"], d["def"], d["metric"]) for d in dropped})
        for d in dropped:
            self.assertFalse(d["kept"], d)


if __name__ == "__main__":
    unittest.main()
