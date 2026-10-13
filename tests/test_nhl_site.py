"""The NHL page's JavaScript (site/nhl/nhl.js), run in a real browser on the
saved NHL data sample: every game draws, there is no last season anywhere,
and the rink's "more / fewer shots from here" call reads both sides."""
import unittest

from helpers import nhl_data, nhl_players  # first: puts tools/ on the import path

from site_browser import SiteBrowser

SITE = PAGE = None


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/index.html")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class PageDraws(unittest.TestCase):
    def test_the_suite_is_open_to_every_member(self):
        """Launched 2026-10-13. Before that, a member who opened an NHL link got
        "GMG NHL Suite is being built ... Check back soon" and took the site
        for broken. A member is neither the owner nor on localhost: with both
        of those marks taken off, the page itself must still show."""
        page = SITE.open("nhl/index.html")
        page.wait_for_function("() => typeof DATA !== 'undefined' && DATA !== null")
        seen = page.evaluate(
            """() => {
                document.documentElement.classList.remove("is-owner", "local-dev");
                const shown = (selector) => getComputedStyle(document.querySelector(selector)).display !== "none";
                return { app: shown(".nba-app"), wall: shown(".nba-soon"), open: document.documentElement.classList.contains("suite-public"), menu: document.querySelectorAll(".suite-menu .suite-item").length };
            }"""
        )
        page.close()
        self.assertEqual(seen, {"app": True, "wall": False, "open": True, "menu": 3})  # NFL, NBA and NHL in the dropdown

    def test_every_game_without_a_script_error(self):
        drawn = PAGE.evaluate(
            """() => {
                let count = 0;
                for (const g of DATA.schedule) {
                    selectGame(g.game_id);
                    if (document.querySelectorAll("#rink-content svg").length !== 2) throw new Error(`no rinks for ${g.away} @ ${g.home}`);
                    if (!document.querySelector("#players-content tbody tr")) throw new Error(`no skaters for ${g.away} @ ${g.home}`);
                    count++;
                }
                return count;
            }"""
        )
        self.assertEqual(drawn, len(nhl_data()["schedule"]))
        self.assertEqual(SITE.errors, [])

    def test_this_season_only(self):
        """The owner, 2026-10-13: "Let's scrap all of last year's data on the
        site." No switch, no last-season numbers, and a note while the sample
        is small."""
        blob = nhl_data()
        self.assertEqual(blob["middle_games_played"], 5.0)
        page = SITE.open("nhl/index.html")
        page.wait_for_function("() => typeof DATA !== 'undefined' && DATA !== null && !document.getElementById('section-teams').hidden")
        state = page.evaluate(
            """() => ({
                wins: stats().NJD.wins,
                switches: document.querySelectorAll('.nhl-view-btn, #view-toggle').length,
                note: document.getElementById('fallback-note').hidden ? '' : document.getElementById('fallback-note').textContent,
                text: document.body.textContent,
            })"""
        )
        page.close()
        self.assertEqual(state["wins"], blob["team_stats"]["NJD"]["wins"])
        self.assertEqual(state["switches"], 0)
        self.assertEqual(state["note"], "Small sample: teams are only about 5 games into 2026-27.")
        self.assertNotIn("2025-26", state["text"])
        self.assertNotIn("last season", state["text"].lower())


class PlayerCard(unittest.TestCase):
    """The one popup behind every skater and goalie name (NJD @ DET; the two
    teams whose player files are saved)."""

    # Opens a card on one tab, waits for the team's file, and reads it back.
    OPEN = """async ([id, tab]) => {
        render();
        openPlayerCard(id, tab);
        await loadTeamPlayers(findPlayer(id).row.team);
        await new Promise((r) => setTimeout(r, 0));
        const body = document.getElementById("player-modal-body");
        const cells = (tr) => [...tr.children].map((td) => td.textContent.trim().replace(/\\s+/g, " "));
        return {
            open: !document.getElementById("player-card-modal").hidden,
            name: document.querySelector("#player-card-content .pc-name").textContent,
            tiles: [...document.querySelectorAll("#player-card-content .nhl-pc-tiles .nba-tile b")].map((b) => b.textContent),
            text: body.textContent.trim().replace(/\\s+/g, " "),
            log: [...body.querySelectorAll(".nhl-pc-log tbody tr")].map(cells),
            areas: [...body.querySelectorAll(".nhl-pc-areas tbody tr")].map(cells),
            areaHead: [...body.querySelectorAll(".nhl-pc-areas thead th")].map((th) => th.textContent.trim()),
            heat: body.querySelectorAll("svg .nhl-zone-heat").length,
            steps: [...body.querySelectorAll("svg .nhl-zone")].map((z) => (/nhl-zone-step-(\\d)/.exec(z.getAttribute("class")) || [])[1] || null),
            allows: [...body.querySelectorAll(".nhl-pc-areas tbody tr")].map((tr) => tr.lastElementChild.style.backgroundColor),
            key: body.querySelectorAll(".nhl-pc-rink .g5-scale i").length,
            switches: document.querySelectorAll("#player-card-content .nhl-view-btn").length,
            odds: [...body.querySelectorAll(".nhl-pc-odds tbody tr")].map(cells),
            chips: [...body.querySelectorAll(".nhl-pc-chip")].map((c) => c.textContent.trim().replace(/\\s+/g, " ")),
        };
    }"""

    @classmethod
    def setUpClass(cls):
        cls.blob = nhl_data()
        cls.game = next(g for g in cls.blob["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        cls.hughes = next(p for p in cls.blob["skaters"]["NJD"] if p["name"] == "Jack Hughes")
        cls.allen = next(p for p in cls.blob["goalies"]["NJD"] if p["name"] == "Jake Allen")
        PAGE.evaluate("(id) => selectGame(id)", cls.game["game_id"])

    def card(self, player, tab="log"):
        return PAGE.evaluate(self.OPEN, [player["id"], tab])

    @staticmethod
    def js_round(x, digits=0):
        """A number as the page's toFixed prints it (a tie rounds up)."""
        return f"{int(x * 10 ** digits + 0.5) / 10 ** digits:.{digits}f}"

    def test_every_name_on_the_page_opens_the_card(self):
        links = PAGE.evaluate("() => ({ skaters: document.querySelectorAll('#players-content .player-click').length, goalies: document.querySelectorAll('#goalies-content .player-click').length })")
        self.assertEqual(links, {"skaters": 36, "goalies": 4})
        PAGE.evaluate("() => { closePlayerCard(); document.querySelector('#players-content .player-click').click(); }")
        self.assertTrue(PAGE.evaluate("() => !document.getElementById('player-card-modal').hidden"))

    def test_every_player_in_every_tab(self):
        opened = PAGE.evaluate(
            """async () => {
                let count = 0;
                const g = currentGame();
                for (const t of [g.away, g.home]) {
                    await loadTeamPlayers(t);
                    for (const p of [...DATA.skaters[t], ...DATA.goalies[t]]) {
                        for (const tab of ["log", "map", "odds"]) {
                            openPlayerCard(p.id, tab);
                            await new Promise((r) => setTimeout(r, 0));
                            const text = document.getElementById("player-modal-body").textContent;
                            if (!text.trim() || text.includes("Loading")) throw new Error(`${p.name} ${tab} is empty`);
                            count++;
                        }
                    }
                }
                return count;
            }"""
        )
        self.assertEqual(opened, 40 * 3)
        self.assertEqual(SITE.errors, [])

    def test_game_log(self):
        now = self.card(self.hughes, "log")
        self.assertEqual((now["open"], now["name"], now["switches"]), (True, "Jack Hughes", 0))
        self.assertEqual(now["tiles"][0], str(self.hughes["games"]))
        self.assertEqual(len(now["log"]), self.hughes["games"] + 1)  # every game plus the per-game row on top
        self.assertEqual(now["log"][0][0], "Per game (5 games)")
        # Newest game first: 10/12 vs OTT, a 1-4 loss, 20:41 of ice time, 0 goals, 1 assist, 2 shots on goal.
        self.assertEqual(now["log"][1][:8], ["10/12", "vs OTT", "L 1-4", "20:41", "0", "1", "1", "2"])
        self.assertIn("Small sample: 5 games this season.", now["text"])

    def test_shot_map(self):
        card = self.card(self.hughes, "map")
        league = self.blob["league"]["season"]["slot"]["sh_pct"]
        self.assertEqual(card["areaHead"][-1], "DET allows")  # the other side of tonight's game
        self.assertEqual([row[0] for row in card["areas"]], ["Low slot", "Slot", "Left side", "Right side", "Point", "Outside the zone"])
        # The slot's row, from his saved file: shots a game, share of his shots, on goal, goals, shooting %, the league's.
        areas = nhl_players()["NJD"]["skaters"][self.hughes["id"]]["season"]["areas"]
        shots, on_goal, goals = areas["slot"]
        located = sum(a[0] for a in areas.values())
        self.assertGreater(shots, 0)
        self.assertEqual(card["areas"][1][:7], ["Slot", self.js_round(shots / self.hughes["games"], 1), f"{self.js_round(shots / located * 100)}%", str(on_goal), str(goals), f"{self.js_round(goals / on_goal * 100, 1)}%" if on_goal else "--", f"{league * 100:.1f}%"])
        # No zone is left plain: each is on the eight rank colors by where DET ranks for shots allowed
        # from there (1st = the most = green), never the strip outside the zone, and the "DET allows"
        # cell beside it is the same color.
        allowed = {t: s for t, s in self.blob["team_stats"].items()}
        rank = lambda area: sorted(allowed, key=lambda t: -allowed[t][f"def_{area}_pg"]).index("DET") + 1
        drawn = ["point", "left", "right", "slot", "low_slot"]  # the order the rink draws them, then the strip
        self.assertEqual(card["steps"], [str((rank(area) - 1) * 8 // 32 + 1) for area in drawn] + [None])
        self.assertEqual((card["heat"], card["key"]), (0, 8))
        self.assertTrue(all(card["allows"][:5]), card["allows"])
        self.assertEqual(card["allows"][5], "")  # the row for shots from outside the zone
        self.assertEqual(len(set(card["allows"][:5])), len(set(card["steps"][:5])))

    def test_shot_map_with_no_game_to_read_it_against(self):
        """Without an opponent the zones are shaded by his own shots, as before."""
        PAGE.evaluate("() => { window.keptPlayerGame = playerGame; playerGame = () => null; }")
        try:
            card = self.card(self.hughes, "map")
        finally:
            PAGE.evaluate("() => { playerGame = window.keptPlayerGame; }")
        season = nhl_players()["NJD"]["skaters"][self.hughes["id"]]["season"]
        shot_from = sum(1 for area, counts in season["areas"].items() if area != "long" and counts[0])
        self.assertEqual((card["heat"], card["key"], card["steps"]), (shot_from, 0, [None] * 6))
        self.assertNotIn("allows", card["areaHead"][-1])
        chips = [chip.lower() for chip in card["chips"]]
        goals = sum(counts[2] for counts in season["areas"].values())
        self.assertTrue(any(chip.startswith("from these spots") and chip.endswith(f"he scored {goals}") for chip in chips), chips)
        most = max(season["types"], key=lambda name: season["types"][name][0])
        self.assertTrue(any(chip.startswith(most.lower()) for chip in chips), chips)

    def test_goalie_card(self):
        card = self.card(self.allen, "map")
        self.assertEqual(card["tiles"][:3], [str(self.allen["games"]), str(self.allen["starts"]), self.allen["record"]])
        self.assertEqual(card["areaHead"], ["Area", "Shots / g", "Share", "GA", "SV%", "Lg SV%", "Saved vs avg"])
        faced, against = nhl_players()["NJD"]["goalies"][self.allen["id"]]["season"]["areas"]["low_slot"]
        self.assertEqual((card["areas"][0][0], card["areas"][0][3]), ("Low slot", str(against)))
        self.assertGreater(faced, 0)
        log = self.card(self.allen, "log")["log"]
        self.assertEqual(log[1][:5], ["10/10", "vs VAN", "W 4-1", "Start", "W"])

    def test_odds_tab(self):
        card = self.card(self.hughes, "odds")
        odds = self.blob["player_odds"][self.game["game_id"]][self.hughes["id"]]
        signed = lambda n: f"+{n}" if n > 0 else str(n)
        rows = {row[0]: row[1:] for row in card["odds"]}
        self.assertEqual(rows["Shots on goal"], ["3.5", signed(odds["sog"]["over"]), signed(odds["sog"]["under"]), f"{round(odds['sog']['chance'] * 100)}%"])
        self.assertEqual(rows["Anytime goal"][1:], ["+178", "-213", "35%"])
        self.assertEqual(rows["First goal"][1:], ["+1076", "--", "8%"])
        # The ladder is the book's other lines as "N or more"; the main 3.5 isn't repeated.
        self.assertEqual([chip for chip in card["chips"] if chip[1] == "+"][:5], ["2+ -590", "3+ -203", "5+ +251", "6+ +488", "7+ +900"])
        self.assertIn("Novig, NJD @ DET.", card["text"])

    def test_goalie_zones_need_enough_shots_and_a_real_gap(self):
        tier = lambda shots, goals, league: PAGE.evaluate("([s, g, p]) => goalieAreaTier(s, g, p)", [shots, goals, league])
        self.assertEqual(tier(269, 4, 0.041), "tier-good")   # 11 expected, 4 allowed
        self.assertEqual(tier(271, 75, 0.192), "tier-bad")   # 52 expected, 75 allowed
        self.assertEqual(tier(271, 54, 0.192), "")           # 52 expected, 54 allowed: nothing to see
        self.assertEqual(tier(90, 8, 0.063), "")             # 5.7 expected, 8 allowed: within luck
        self.assertEqual(tier(12, 0, 0.192), "")             # a clean sheet on 12 shots is too few to color
        self.assertEqual(tier(0, 0, 0.192), "")

    def test_no_lines_for_a_goalie(self):
        self.assertIn("No lines posted", self.card(self.allen, "odds")["text"])

    def test_a_team_whose_file_is_missing_still_opens(self):
        other = next(p for team, players in self.blob["skaters"].items() if team not in ("NJD", "DET") for p in players)
        card = self.card(other, "log")
        self.assertTrue(card["open"])
        self.assertIn("games on file", card["text"])
        self.assertEqual(SITE.errors, [])

    def test_escape_closes_it(self):
        self.card(self.hughes)
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('player-card-modal').hidden"))


class RinkColors(unittest.TestCase):
    """Every zone is on the eight rank colors, read from both sides: the
    offense's league rank for shots from there and the defense's rank for
    shots allowed from there, as one (step 0 = the most shots = green)."""

    def step(self, takes, allows, total=32):
        return PAGE.evaluate("([a, b, n]) => rinkStep(a, b, n)", [takes, allows, total])

    def test_both_sides_pointing_the_same_way(self):
        self.assertEqual(self.step(1, 1), 0)     # shoots from there the most, allows the most
        self.assertEqual(self.step(4, 6), 0)
        self.assertEqual(self.step(32, 32), 7)   # the fewest on both sides
        self.assertEqual(self.step(28, 30), 7)

    def test_sides_that_disagree_land_in_the_middle(self):
        self.assertEqual(self.step(1, 32), 4)
        self.assertEqual(self.step(32, 1), 4)    # either way round
        self.assertIn(self.step(16, 17), (3, 4))

    def test_a_better_rank_on_either_side_never_moves_a_zone_toward_red(self):
        for other in (1, 9, 17, 25, 32):
            steps = [self.step(rank, other) for rank in range(1, 33)]
            self.assertEqual(steps, sorted(steps), other)
            self.assertEqual(steps, [self.step(other, rank) for rank in range(1, 33)], other)

    def test_no_rank_no_color(self):
        self.assertIsNone(self.step(None, 5))
        self.assertIsNone(self.step(5, None))

    def test_every_zone_is_colored_but_never_the_long_shots(self):
        found = PAGE.evaluate(
            """() => {
                view = "season";
                const out = { plain: 0, strip: 0, steps: new Set(), key: 0 };
                for (const g of DATA.schedule) {
                    selectGame(g.game_id);
                    for (const svg of document.querySelectorAll("#rink-content svg")) {
                        const zones = [...svg.querySelectorAll(".nhl-zone")];
                        // The strip below the blue line is the last zone drawn in each rink.
                        const strip = zones.pop();
                        if (/nhl-zone-(rank|more|fewer|heat)/.test(strip.getAttribute("class"))) out.strip++;
                        zones.forEach((z) => {
                            const step = /nhl-zone-step-(\\d)/.exec(z.getAttribute("class"));
                            if (step) out.steps.add(step[1]);
                            else out.plain++;
                        });
                    }
                }
                out.key = document.querySelectorAll("#rink-key .g5-scale i").length;
                return { ...out, steps: [...out.steps].sort() };
            }"""
        )
        self.assertEqual((found["plain"], found["strip"], found["key"]), (0, 0, 8))
        self.assertEqual(found["steps"], [str(n) for n in range(1, 9)])  # across the slate, all eight colors turn up

    def test_a_zone_is_the_color_of_its_two_ranks(self):
        """NJD's shots against DET, this season: the slot."""
        game = next(g for g in nhl_data()["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        stats = nhl_data()["team_stats"]
        rank = lambda key, team: sorted((t for t in stats if stats[t].get(key) is not None), key=lambda t: -stats[t][key]).index(team) + 1
        shown = PAGE.evaluate(
            """(id) => {
                view = "season";
                selectGame(id);
                const slot = document.querySelectorAll("#rink-content svg")[0].querySelectorAll(".nhl-zone")[3];
                return { step: Number(/nhl-zone-step-(\\d)/.exec(slot.getAttribute("class"))[1]) - 1, tip: slot.querySelector("title").textContent };
            }""",
            game["game_id"],
        )
        self.assertEqual(shown["step"], self.step(rank("off_slot_pg", "NJD"), rank("def_slot_pg", "DET"), len(stats)))
        self.assertIn("NJD", shown["tip"])
        self.assertIn("DET allows", shown["tip"])


class MatchupTag(unittest.TestCase):
    """Same two-sided tags as the NFL and NBA pages (each z is from that unit's own side)."""

    def tag(self, off, dfn):
        return PAGE.evaluate("([a, b]) => matchupTag(a, b).replace(/<[^>]+>/g, '')", [off, dfn])

    def test_tags(self):
        self.assertEqual(self.tag(0.9, -0.3), "Mismatch")
        self.assertEqual(self.tag(-0.6, 0.6), "Tough")
        self.assertEqual(self.tag(0.6, 0.6), "Good vs Good")
        self.assertEqual(self.tag(-0.6, -0.6), "Bad vs Bad")
        self.assertEqual(self.tag(0.3, 0.0), "Even")


if __name__ == "__main__":
    unittest.main()
