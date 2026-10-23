"""Which projected-lineups story belongs to which game (build_nhl.fetch_lineups).

What is pinned: NHL.com tags its stories by hand, and on 2026-10-22 it tagged
"Red Wings at Canucks projected lineups" with Utah at Seattle's game id and gave
the Canucks game no story, so both late games went the night with no lineup (a
member found it). A story counts for a game only if every team it lists plays
in it, and a game whose own tag has none is matched from the day's other
preview stories."""
import unittest
from datetime import datetime
from unittest import mock

import helpers  # noqa: F401  first: puts nfl_tool/nhl on the import path

import build_nhl

TEAMS = {abbr: {"mascot": mascot} for abbr, mascot in (("UTA", "Mammoth"), ("SEA", "Kraken"), ("DET", "Red Wings"), ("VAN", "Canucks"))}
SLUG = "https://forge-dapi.d3.nhle.com/v2/content/en-us/stories/{}-game-preview-october-22-2026"


def story(away, home):
    lines = []
    for team in (away, home):
        lines += [f"**{team} projected lineup**", "A One -- B Two -- C Three", "D Four -- E Five", "G Six", "H Seven", "Scratched: None", "Injured: None"]
    return {"parts": [{"type": "markdown", "content": "\n".join(lines)}]}


DET_VAN = {"selfUrl": SLUG.format("detroit-red-wings-vancouver-canucks"), "contentDate": "2026-10-22T20:02:00Z"}
UTA_SEA = {"selfUrl": SLUG.format("utah-mammoth-seattle-kraken"), "contentDate": "2026-10-22T16:58:37Z"}
BODIES = {DET_VAN["selfUrl"]: story("Red Wings", "Canucks"), UTA_SEA["selfUrl"]: story("Mammoth", "Kraken")}


def fake_request(url, **kw):
    if url in BODIES:
        return BODIES[url]
    if "gameid-164" in url:
        return {"items": [DET_VAN, UTA_SEA]}  # newest first: the wrong one leads
    if "gameid-" in url:
        return {"items": []}
    return {"items": [DET_VAN, UTA_SEA]}  # the day's preview stories


class MisTaggedStories(unittest.TestCase):
    def test_each_game_gets_its_own_story(self):
        games = [
            {"game_id": "164", "away": "UTA", "home": "SEA", "date": "2026-10-22", "start_utc": "2026-10-23T02:00Z", "status": "pre"},
            {"game_id": "165", "away": "DET", "home": "VAN", "date": "2026-10-22", "start_utc": "2026-10-23T02:00Z", "status": "pre"},
        ]
        slots = lambda lineup, team, find, positions: {"lines": lineup["groups"]}  # noqa: E731
        with mock.patch.object(build_nhl, "_request", fake_request), mock.patch.object(build_nhl, "lineup_slots", slots):
            out, error = build_nhl.fetch_lineups(games, TEAMS, None, {}, datetime(2026, 10, 22, 18, 0))
        self.assertIsNone(error)
        self.assertEqual(sorted(k for k in out["164"] if k != "posted"), ["SEA", "UTA"])
        self.assertEqual(sorted(k for k in out["165"] if k != "posted"), ["DET", "VAN"])


if __name__ == "__main__":
    unittest.main()
