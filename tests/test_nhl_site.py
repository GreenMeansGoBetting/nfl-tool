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
