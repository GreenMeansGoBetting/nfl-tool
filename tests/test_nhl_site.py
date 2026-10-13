"""The NHL page's JavaScript (site/nhl/nhl.js), run in a real browser on the
saved NHL data sample: every game draws, the season switch swaps the numbers,
and the rink's "more / fewer shots from here" call reads both sides."""
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path

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
    def test_every_game_in_both_seasons_without_a_script_error(self):
        drawn = PAGE.evaluate(
            """() => {
                let count = 0;
                for (const season of ["season", "prev"]) {
                    view = season;
                    for (const g of DATA.schedule) {
                        selectGame(g.game_id);
                        if (document.querySelectorAll("#rink-content svg").length !== 2) throw new Error(`no rinks for ${g.away} @ ${g.home}`);
                        if (!document.querySelector("#players-content tbody tr")) throw new Error(`no skaters for ${g.away} @ ${g.home}`);
                        count++;
                    }
                }
                return count;
            }"""
        )
        self.assertEqual(drawn, 2 * len(nhl_data()["schedule"]))
        self.assertEqual(SITE.errors, [])

    def test_opens_on_last_season_while_the_sample_is_small(self):
        blob = nhl_data()
        self.assertEqual((blob["default_view"], blob["middle_games_played"]), ("prev", 5.0))
        page = SITE.open("nhl/index.html")
        self.assertEqual(page.evaluate("() => view"), "prev")
        self.assertEqual(page.evaluate("() => stats().NJD.wins"), blob["team_stats_prev"]["NJD"]["wins"])
        page.close()

    def test_season_switch_swaps_team_and_player_numbers(self):
        blob = nhl_data()
        game = next(g for g in blob["schedule"] if g["away"] == "NJD" and g["home"] == "DET")
        hughes = next(p for p in blob["skaters"]["NJD"] if p["name"] == "Jack Hughes")
        read = """([id, season]) => {
            view = season;
            selectGame(id);
            const row = [...document.querySelectorAll("#players-content tbody tr")].find((tr) => tr.textContent.includes("Jack Hughes"));
            return { record: document.querySelector("#teams-content .nba-banner-right").textContent.trim(), games: row.children[1].textContent };
        }"""
        now = PAGE.evaluate(read, [game["game_id"], "season"])
        last = PAGE.evaluate(read, [game["game_id"], "prev"])
        self.assertEqual(now["games"], str(hughes["games"]))
        self.assertEqual(last["games"], str(hughes["prev"]["games"]))
        self.assertTrue(last["record"].startswith("42-37-3"), last["record"])
        self.assertNotEqual(now["record"], last["record"])


class PlayerCard(unittest.TestCase):
    """The one popup behind every skater and goalie name (NJD @ DET; the two
    teams whose player files are saved)."""

    # Opens a card on one tab and season, waits for the team's file, and reads it back.
    OPEN = """async ([id, season, tab]) => {
        view = season;
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

    def card(self, player, season="prev", tab="log"):
        return PAGE.evaluate(self.OPEN, [player["id"], season, tab])

    def test_every_name_on_the_page_opens_the_card(self):
        links = PAGE.evaluate("() => ({ skaters: document.querySelectorAll('#players-content .player-click').length, goalies: document.querySelectorAll('#goalies-content .player-click').length })")
        self.assertEqual(links, {"skaters": 36, "goalies": 4})
        PAGE.evaluate("() => { closePlayerCard(); document.querySelector('#players-content .player-click').click(); }")
        self.assertTrue(PAGE.evaluate("() => !document.getElementById('player-card-modal').hidden"))

    def test_every_player_in_every_tab_and_season(self):
        opened = PAGE.evaluate(
            """async () => {
                let count = 0;
                const g = currentGame();
                for (const t of [g.away, g.home]) {
                    await loadTeamPlayers(t);
                    for (const p of [...DATA.skaters[t], ...DATA.goalies[t]]) {
                        for (const season of ["season", "prev"]) {
                            for (const tab of ["log", "map", "odds"]) {
                                view = season;
                                openPlayerCard(p.id, tab);
                                await new Promise((r) => setTimeout(r, 0));
                                const text = document.getElementById("player-modal-body").textContent;
                                if (!text.trim() || text.includes("Loading")) throw new Error(`${p.name} ${season} ${tab} is empty`);
                                count++;
                            }
                        }
                    }
                }
                return count;
            }"""
        )
        self.assertEqual(opened, 40 * 6)
        self.assertEqual(SITE.errors, [])

    def test_game_log(self):
        last = self.card(self.hughes, "prev", "log")
        self.assertEqual((last["open"], last["name"]), (True, "Jack Hughes"))
        self.assertEqual(last["tiles"][:5], ["61", "21.3", "27", "50", "77"])  # games, ice time, goals, assists, points
        self.assertEqual(len(last["log"]), 61 + 1)  # every game plus the per-game row on top
        self.assertEqual(last["log"][0][0], "Per game (61 games)")
        now = self.card(self.hughes, "season", "log")
        self.assertEqual(len(now["log"]), self.hughes["games"] + 1)
        # Newest game first: 10/12 vs OTT, a 1-4 loss, 20:41 of ice time, 0 goals, 1 assist, 2 shots on goal.
        self.assertEqual(now["log"][1][:8], ["10/12", "vs OTT", "L 1-4", "20:41", "0", "1", "1", "2"])
        self.assertIn("Small sample: 5 games this season.", now["text"])
        self.assertNotIn("Small sample", last["text"])

    def test_shot_map(self):
        card = self.card(self.hughes, "prev", "map")
        league = self.blob["league"]["prev"]["slot"]["sh_pct"]
        self.assertEqual(card["areaHead"][-1], "DET allows")  # the other side of tonight's game
        self.assertEqual([row[0] for row in card["areas"]], ["Low slot", "Slot", "Left side", "Right side", "Point", "Outside the zone"])
        # Slot: 102 shots in 61 games, 81 on goal, 11 goals; 305 shots placed in all.
        self.assertEqual(card["areas"][1][:7], ["Slot", "1.7", "33%", "81", "11", "13.6%", f"{league * 100:.1f}%"])
        self.assertEqual(card["heat"], 5)  # every zone he shot from, but never the strip outside the zone
        self.assertIn("FROM THESE SPOTS 26.3 goals expectedhe scored 24".lower(), " ".join(card["chips"]).lower().replace("expected he", "expectedhe"))
        self.assertTrue(any(chip.lower().startswith("wrist 53%") for chip in card["chips"]), card["chips"])

    def test_goalie_card(self):
        card = self.card(self.allen, "prev", "map")
        self.assertEqual(card["tiles"][:4], ["37", "36", "17-17-2", ".903"])
        self.assertEqual(card["areaHead"], ["Area", "Shots / g", "Share", "GA", "SV%", "Lg SV%", "Saved vs avg"])
        self.assertEqual(card["areas"][0][:5], ["Low slot", "7.3", "26%", "54", ".801"])  # 271 shots, 54 goals in 37 games
        log = self.card(self.allen, "season", "log")["log"]
        self.assertEqual(log[1][:5], ["10/10", "vs VAN", "W 4-1", "Start", "W"])

    def test_odds_tab(self):
        card = self.card(self.hughes, "prev", "odds")
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
        self.assertIn("No lines posted", self.card(self.allen, "prev", "odds")["text"])

    def test_the_season_switch_in_the_card_moves_the_page_too(self):
        self.card(self.hughes, "prev", "log")
        PAGE.evaluate("() => document.querySelector('#player-card-modal .nhl-view-btn[data-view=\"season\"]').click()")
        state = PAGE.evaluate("() => ({ view, page: document.querySelector('#view-toggle .active').dataset.view, games: document.querySelector('#player-card-content .nhl-pc-tiles b').textContent })")
        self.assertEqual(state, {"view": "season", "page": "season", "games": str(self.hughes["games"])})

    def test_a_team_whose_file_is_missing_still_opens(self):
        other = next(p for team, players in self.blob["skaters"].items() if team not in ("NJD", "DET") for p in players)
        card = self.card(other, "prev", "log")
        self.assertTrue(card["open"])
        self.assertIn("games on file", card["text"])
        self.assertEqual(SITE.errors, [])

    def test_escape_closes_it(self):
        self.card(self.hughes)
        PAGE.keyboard.press("Escape")
        self.assertTrue(PAGE.evaluate("() => document.getElementById('player-card-modal').hidden"))


class RinkCall(unittest.TestCase):
    """A zone is called from both sides: one side clearly above (or below) the
    league and the other side not pointing the other way."""

    def call(self, takes, allows):
        return PAGE.evaluate("([a, b]) => rinkCall(a, b)", [takes, allows])

    def test_more(self):
        self.assertEqual(self.call(0.8, 0.6), "more")
        self.assertEqual(self.call(0.8, 0.0), "more")   # the defense is average: the offense's habit stands
        self.assertEqual(self.call(-0.2, 0.9), "more")  # a leaky defense, an offense that isn't shy there

    def test_fewer(self):
        self.assertEqual(self.call(-0.8, -0.6), "fewer")
        self.assertEqual(self.call(0.1, -0.9), "fewer")

    def test_no_call_when_the_sides_disagree_or_neither_is_clear(self):
        self.assertEqual(self.call(0.9, -0.9), "")
        self.assertEqual(self.call(0.9, -0.4), "")
        self.assertEqual(self.call(0.4, 0.4), "")
        self.assertEqual(self.call(None, 1.2), "")

    def test_long_shots_are_never_colored(self):
        colored = PAGE.evaluate(
            """() => {
                view = "season";
                let found = 0;
                for (const g of DATA.schedule) {
                    selectGame(g.game_id);
                    // The strip below the blue line is the last zone drawn in each rink.
                    for (const svg of document.querySelectorAll("#rink-content svg")) {
                        const zones = svg.querySelectorAll(".nhl-zone");
                        if (/nhl-zone-(more|fewer)/.test(zones[zones.length - 1].getAttribute("class"))) found++;
                    }
                }
                return found;
            }"""
        )
        self.assertEqual(colored, 0)


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
