"""Shared setup for the tests.

The tests never read this week's live data. They use two saved samples in
tests/fixtures/, so the right answers can't change from week to week:

  * data.json.gz        -- the site's data.json as built 2026-10-12 12:19 UTC
                           (week 5: 14 games final, BUF @ LA still to play).
                           Its stored gmg_model scores were made by the model as
                           it was that morning (before the 1.2x margin stretch),
                           so tests work scores out again rather than read them.
  * novig_event.json.gz -- one game's markets from Novig's public feed, as the
                           build receives them (HOU @ JAX, captured 2026-10-13).

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
for folder in (ROOT / "nfl_tool", ROOT / "tools"):
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
