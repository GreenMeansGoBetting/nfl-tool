"""Shared setup for the tests.

The tests never read this week's live data. They use saved samples in
tests/fixtures/, so the right answers can't change from week to week:

  * data.json.gz        -- the site's data.json as built 2026-10-12 12:19 UTC
                           (week 5: 14 games final, BUF @ LA still to play).
                           Its stored gmg_model scores were made by the model as
                           it was that morning (before the 1.2x margin stretch),
                           so tests work scores out again rather than read them.
  * novig_event.json.gz -- one game's markets from Novig's public feed, as the
                           build receives them (HOU @ JAX, captured 2026-10-13).
  * nhl_game.json.gz    -- one finished NHL game exactly as the NHL build keeps
                           it (FLA @ BUF, 2026-10-12: play-by-play + box score).
  * nhl_novig_event.json.gz -- one NHL game's Novig markets (NJD @ DET,
                           captured 2026-10-13, before puck drop).
  * nhl_data.json.gz    -- the NHL page's data.json as built 2026-10-13 14:12
                           UTC (teams about 5 games into 2026-27).
  * nhl_players.json.gz -- two of that build's per-team player files (NJD and
                           DET: game logs and shot areas for the player card).

tests/ sits outside nfl_tool/, so none of it is deployed and a push that only
touches tests doesn't rebuild the site.
"""
import gzip
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
for folder in (ROOT / "nfl_tool", ROOT / "nfl_tool" / "nhl", ROOT / "tools"):
    if str(folder) not in sys.path:
        sys.path.insert(0, str(folder))

# The moment the data sample was built, as the build's own clock reads it
# (gmg_model.eastern_now: Eastern time, no timezone attached). Tests pin the
# clock here, so "has this game kicked off?" always has the same answer.
SAMPLE_BUILT_UTC = "2026-10-12T12:19:00Z"
SAMPLE_BUILT_ET = datetime(2026, 10, 12, 8, 19)

_cache = {}


def _fixture_bytes(name):
    if name not in _cache:
        _cache[name] = gzip.decompress((FIXTURES / name).read_bytes())
    return _cache[name]


def site_data_bytes():
    """The data sample exactly as the site would download it."""
    return _fixture_bytes("data.json.gz")


def site_data():
    """A fresh copy of the data sample (safe for a test to change)."""
    return json.loads(site_data_bytes())


def novig_event():
    """A fresh copy of the saved Novig game: {"description", "event": {"game", "markets", ...}}."""
    return json.loads(_fixture_bytes("novig_event.json.gz"))


def nhl_game():
    """A fresh copy of the saved NHL game: {"pbp": play-by-play, "box": box score}."""
    return json.loads(_fixture_bytes("nhl_game.json.gz"))


def nhl_novig_event():
    """A fresh copy of the saved NHL Novig game, same shape as novig_event()."""
    return json.loads(_fixture_bytes("nhl_novig_event.json.gz"))


def nhl_data_bytes():
    """The NHL data sample exactly as the NHL page would download it."""
    return _fixture_bytes("nhl_data.json.gz")


def nhl_data():
    return json.loads(nhl_data_bytes())


def nhl_players():
    """The saved per-team player files (the player card's game logs and shot
    areas) from the same build as nhl_data(): {"NJD": {...}, "DET": {...}}."""
    return json.loads(_fixture_bytes("nhl_players.json.gz"))
