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
  * nhl_shots.json.gz   -- the Shots page's shots.json for that same build:
                           the 16 games of 10-13 projected from the 89 games
                           before them, and the three 10-12 games as they
                           were projected that morning, locked, with each
                           player's real shots on goal. One game (STL @ OTT)
                           has the NHL's projected lineup, the saved story
                           below; the other 15 have none yet. Its "record"
                           block is made up (the real one comes from
                           model_history).
  * nhl_lineup_story.json.gz -- one "projected lineups" story exactly as the
                           NHL serves it (STL @ OTT, posted 2026-10-13 16:04
                           UTC: Warren Foegele moved up to Ottawa's top line).

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


def nhl_game_shifts():
    """The saved NHL game's shift chart, as build_nhl.fetch_shifts keeps it on a game."""
    return json.loads(_fixture_bytes("nhl_game_shifts.json.gz"))


def nhl_novig_event():
    """A fresh copy of the saved NHL Novig game, same shape as novig_event()."""
    return json.loads(_fixture_bytes("nhl_novig_event.json.gz"))


def nhl_data_bytes():
    """The NHL data sample exactly as the NHL page would download it."""
    return _fixture_bytes("nhl_data.json.gz")


def nhl_data():
    return json.loads(nhl_data_bytes())


def nhl_shots_bytes():
    """The Shots sample exactly as the Shots page would download it."""
    return _fixture_bytes("nhl_shots.json.gz")


def nhl_shots():
    return json.loads(nhl_shots_bytes())


def nhl_goals_bytes():
    """The Goals sample (nhl/goals.json) built the way the build would have from the same
    games: as of 2026-10-12 14:00 UTC, then 2026-10-13 14:12 with that file as the live one,
    so 10/12's games are locked and final and 10/13's are open with Novig's prices."""
    return _fixture_bytes("nhl_goals.json.gz")


def nhl_goals():
    return json.loads(nhl_goals_bytes())


def nhl_points_bytes():
    """The Points sample (nhl/points.json), built from the same games and prices as the data
    sample at the Goals sample's two moments (tools/make_nhl_points_sample.py)."""
    return _fixture_bytes("nhl_points.json.gz")


def nhl_points():
    return json.loads(nhl_points_bytes())


def nhl_crease_bytes():
    """The King of the Crease sample (nhl/crease.json, built 2026-10-13 from the same games) as the page would download it."""
    return _fixture_bytes("nhl_crease.json.gz")


def nhl_crease():
    return json.loads(nhl_crease_bytes())


def nhl_icebreaker_bytes():
    """The Icebreaker sample (nhl/icebreaker.json): icebreaker_board run on the Goals sample and
    the data sample's schedule and Novig prices, as of 2026-10-13 14:12 UTC, with `fast` from the
    89 games before 10/13. Hand-made: no SmartStake prices but two on 10/15's 7:00 slate (its
    first row: DraftKings +750; its second: no DraftKings, only another book's +900, which the page must not show), and
    an empty Winners `history` (the tests write their own)."""
    return _fixture_bytes("nhl_icebreaker.json.gz")


def nhl_icebreaker():
    return json.loads(nhl_icebreaker_bytes())


def nhl_lineup_story():
    """The saved projected-lineups story: {"game_id", "away", "home", "posted", "markdown"}."""
    return json.loads(_fixture_bytes("nhl_lineup_story.json.gz"))


def nhl_players():
    """The saved per-team player files (the player card's game logs and shot
    areas) from the same build as nhl_data(): {"NJD": {...}, "DET": {...}}."""
    return json.loads(_fixture_bytes("nhl_players.json.gz"))


def nhl_stacks():
    """The Line Stacks sample (nhl/stacks.json), built at test time from the Points sample by
    the build's own game_stacks and record functions (no saved file: it can't drift from the
    build). Each player's posted slot, or his usual one where the sample has no posted lineup,
    so every game has stacks; no shared-ice history (stacks_model's rho alone). 10/12's games
    are final: graded, written to a throwaway record and summed."""
    if "nhl_stacks" not in _cache:
        import tempfile

        import build_nhl
        import stacks_model

        history = stacks_model.StacksHistory()
        games, finals = {}, []
        for gid, g in nhl_points()["games"].items():
            rows = [{**r, "slot": r.get("slot") or r.get("usual_slot")} for r in g["players"] if not r.get("out") and (r.get("slot") or r.get("usual_slot"))]
            away = next(r["team"] for r in g["players"] if not r["home"])
            home = next(r["team"] for r in g["players"] if r["home"])
            players, stacks = build_nhl.game_stacks(rows, away, home, history)
            entry = {"locked": bool(g.get("locked")), "posted": True, "players": players, "stacks": stacks}
            if g.get("final"):
                actual = {r["id"]: r.get("actual") for r in g["players"]}
                for pid, p in players.items():
                    p["actual"] = actual.get(pid)
                entry["final"] = True
                entry["stacks"] = [{**s, "hit": build_nhl.stack_hit(s["legs"], players)} for s in stacks]
                finals.append({"game_id": gid, "date": "2026-10-12", "away": away, "home": home})
            games[gid] = entry
        with tempfile.TemporaryDirectory() as folder:
            build_nhl.record_stack_games(Path(folder), games, finals)
            record = build_nhl.stacks_record_summary(Path(folder))
        _cache["nhl_stacks"] = {"season": 2027, "generated_at": "2026-10-13T14:12Z", "kinds": stacks_model.KINDS, "games": games, "record": record}
    return _cache["nhl_stacks"]


def nhl_stacks_bytes():
    return json.dumps(nhl_stacks()).encode("utf-8")
