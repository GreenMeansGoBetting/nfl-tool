"""GMG NHL Suite data build -> nfl_tool/site/nhl/data.json.

The NHL twin of nba/build_nba.py, started 2026-10-13. Sources (all free, no key):
  * The NHL's own public feed (api-web.nhle.com and api.nhle.com/stats/rest):
    schedule, standings, every finished game's play-by-play (each shot with
    its spot on the ice) and box score, and the league's season reports for
    power play, penalty kill and ice time.
  * ESPN -- injuries.
  * Novig -- game lines, the same public feed the NFL and NBA builds read
    (league=NHL), pregame numbers only.

Hockey has no ready-made season files (nothing like nflverse or hoopR), so
finished games are downloaded one at a time and kept in --data-dir
(games/<season>/<id>.json.gz). A build only downloads the games it doesn't
have yet; the deploy keeps that folder between runs.

This season only (the owner, 2026-10-13: "Let's scrap all of last year's
data on the site"). Nothing from an earlier season is read or written here;
the replays in tools/backtest download a past season's games when they need one.

The Shots page's projections (site/nhl/shots.json) are worked out here
too, by shots_model.py, from the same finished games, and so is the Promo
Tools page's King of the Crease board (site/nhl/crease.json, saves_model.py).

Seasons are named by the year they END, like the NBA build (2027 = 2026-27).
Team keys are the NHL's own abbreviations (TBL, NJD, SJS, LAK, UTA ...).

This file is the order of the build (main); the work lives in (split by job
2026-11-23, each imports only the files above it):
  nhl_games.py           the NHL feed: games, play-by-play, shifts, schedule, injuries
  nhl_stats.py           team and player numbers, player files, vs position
  nhl_prices.py          Novig, last build's copy, locks, best prices, CLV
  nhl_lineups.py         NHL.com projected lineups
  nhl_records.py         factor values and the YTD ledger every prop page shares
  shots_page.py          Shots board and record      (model: shots_model.py)
  goals_page.py          Goals board and record      (model: goals_model.py)
  points_page.py         Points board and record     (model: points_model.py)
  line_matchups_page.py  Line Matchups               (model: lines_model.py)
  goalie_pages.py        King of the Crease + Saves  (model: saves_model.py)
  promo_pages.py         Icebreaker and Hat Trick
  past_days.py           each prop page's past days
"""

import argparse
import json
import os
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import shots_model
from nhl_games import AREAS, add_rest, fetch_injuries, fetch_schedule, fetch_teams, season_label
from nhl_stats import compute_recent_games, last_dressed, lineup, season_stats, write_player_files
from nhl_prices import LIVE_CREASE_URL, LIVE_GOALS_URL, LIVE_ICEBREAKER_URL, LIVE_LINES_URL, LIVE_POINTS_URL, LIVE_SAVES_URL, LIVE_SHOTS_URL, apply_lines, best_book_prices, best_saves_prices, fetch_novig_lines, fetch_previous, locked_player_odds, player_finder, team_namer, unlisted_priced
from nhl_lineups import fetch_lineups, lineups_for_page
from shots_page import SHOTS_BAR, SHOTS_EDGES, SHOTS_RECORD_COLS, SHOTS_RECORD_DIR, UNSURE_EDGE, record_finished_games, shots_board, shots_defense, shots_model_for, shots_record_summary
from goals_page import GOALS_RECORD_COLS, GOALS_RECORD_DIR, goals_file, goals_hand, goals_model_for
from points_page import POINTS_RECORD_COLS, POINTS_RECORD_DIR, points_file
from line_matchups_page import lines_file
from goalie_pages import CREASE_RECORD_DIR, SAVES_RECORD_COLS, SAVES_RECORD_DIR, crease_file, saves_file
from promo_pages import ICEBREAKER_RECORD_DIR, hattrick_file, icebreaker_file
from past_days import write_past_files

sys.path.insert(1, str(Path(__file__).resolve().parent.parent))  # nfl_tool/, for smartstake.py
import nhl_odds  # noqa: E402  the NHL's own SmartStake markets (smartstake.py is the shared part)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True, help="Year the season ends (2027 = 2026-27)")
    parser.add_argument("--out", type=Path, required=True, help="Where to write data.json")
    parser.add_argument("--data-dir", type=Path, default=Path("data/nhl"), help="Where finished games are kept between builds")
    parser.add_argument("--record-dir", type=Path, default=SHOTS_RECORD_DIR, help="Where the Shots page's graded plays are kept")
    parser.add_argument("--crease-record-dir", type=Path, default=CREASE_RECORD_DIR, help="Where King of the Crease's finished days are kept")
    parser.add_argument("--goals-record-dir", type=Path, default=GOALS_RECORD_DIR, help="Where the Goals page's graded players are kept")
    parser.add_argument("--points-record-dir", type=Path, default=POINTS_RECORD_DIR, help="Where the Points page's graded players are kept")
    parser.add_argument("--saves-record-dir", type=Path, default=SAVES_RECORD_DIR, help="Where the Saves page's graded goalies are kept")
    parser.add_argument("--icebreaker-record-dir", type=Path, default=ICEBREAKER_RECORD_DIR, help="Where Icebreaker's finished slates are kept")
    args = parser.parse_args()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    teams, standings = fetch_teams()
    team_ids = {abbr: t["id"] for abbr, t in teams.items()}
    abbr_by_id = {v: k for k, v in team_ids.items()}
    stats = season_stats(args.season, args.data_dir, standings, team_ids)

    played = [s["games_played"] for s in stats["team_stats"].values()]
    middle_games = statistics.median(played) if played else 0
    team_games = Counter({team: s["games_played"] for team, s in stats["team_stats"].items()})
    goalies = {}
    for g in sorted(stats["goalies"].values(), key=lambda g: -g["starts"]):
        goalies.setdefault(g["team"], []).append(g)

    games = fetch_schedule(now_utc)
    add_rest(games, stats["listing"], abbr_by_id)
    # Book names that match no player the site knows (one yet to play this
    # season, or a new spelling): kept for version.json, never guessed.
    novig_find, unmatched = player_finder(stats["skaters"], stats["goalies"]), set()

    def novig_lookup(team, name):
        pid = novig_find(team, name)
        if pid is None and name:
            unmatched.add(f"{name} ({team})")
        return pid

    novig, novig_players, novig_saves, novig_debug = fetch_novig_lines(games, teams, novig_lookup)
    novig_debug["unmatched"] = sorted(unmatched)
    previous = fetch_previous()
    apply_lines(games, novig, previous, now_utc)
    injuries, injuries_error = fetch_injuries(teams, stats["skaters"], stats["goalies"])
    generated_at = now_utc.strftime("%Y-%m-%dT%H:%MZ")
    lineups = lineup(stats["skaters"], team_games, last_dressed(stats["records"]))
    player_odds = locked_player_odds(games, novig_players, previous, now_utc)
    # Every US book's price (SmartStake) for the Shots and Goals rows' odds
    # panel. Optional: no key or a failed fetch = Novig's price only, as before.
    find = player_finder(stats["skaters"], stats["goalies"])
    book_odds, book_odds_debug = nhl_odds.fetch_nhl_book_odds(
        os.environ.get("SMARTSTAKE_API_KEY"), team_namer(teams),
        lambda name, away, home: find(away, name) or find(home, name),
        (previous or {}).get("book_odds"), now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        keep={f"{g['away']}_{g['home']}" for g in games})
    # Tonight's lines, as the NHL posts them. Everyone in one is on the page's
    # skater list too, so a call-up on the top line still opens the player card.
    tonight, lineups_error = fetch_lineups(games, teams, player_finder(stats["skaters"], stats["goalies"]), {pid: s["pos"] for pid, s in stats["skaters"].items()}, now_utc)
    for entry in tonight.values():
        for team, posted in entry.items():
            if team in lineups:
                listed = {p["id"] for p in lineups[team]}
                lineups[team].extend(stats["skaters"][pid] for pid in posted["skaters"] if pid in stats["skaters"] and pid not in listed)
    shopped = None if "error" in book_odds_debug or "skipped" in book_odds_debug else book_odds
    player_odds = best_book_prices(player_odds, shopped, games)
    novig_saves = best_saves_prices(novig_saves, shopped, games)
    unlisted = unlisted_priced(games, lineups, player_odds, now_utc)
    for p in unlisted:
        print(f"WARNING: {p['name']} ({p['team']}) has a shots line but is on no NHL prop list.", file=sys.stderr)

    blob = {
        "season": args.season,
        "season_label": season_label(args.season),
        "middle_games_played": middle_games,
        "generated_at": generated_at,
        "areas": list(AREAS),
        "league": {"season": stats["league"]},
        "teams": teams,
        "team_stats": stats["team_stats"],
        "vs_position": stats["vs_position"],
        "recent_games": compute_recent_games(stats["records"]),
        "skaters": lineups,
        "goalies": goalies,
        "injuries": injuries,
        "schedule": games,
        "player_odds": player_odds,
        "book_odds": book_odds,
        "book_odds_debug": book_odds_debug,
        "novig_debug": novig_debug,
        "feed_debug": {**stats["debug"], "injuries_error": injuries_error, "lineups": len(tonight), "lineups_error": lineups_error, "unlisted": unlisted},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    write_player_files(args.out.parent / "players", teams, stats, generated_at)
    model = shots_model_for(stats["records"])
    board = shots_board(model, games, lineups, injuries, stats["records"], fetch_previous(LIVE_SHOTS_URL), now_utc, tonight, stats["skaters"], player_odds)
    try:
        record_finished_games(args.record_dir, board, player_odds, games)
        record = shots_record_summary(args.record_dir)
    except Exception as e:  # a damaged record file must never cost the page its projections
        print(f"WARNING: the Shots record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    shots = {
        "season": args.season, "generated_at": generated_at, "weights": model.w, "dispersion": shots_model.DISPERSION, "edges": SHOTS_EDGES, "bar": SHOTS_BAR, "unsure": UNSURE_EDGE,
        "games": board, "defense": shots_defense(model, teams), "record": record, "lineups": lineups_for_page(tonight, stats["goalies"]),
    }
    with open(args.out.parent / "shots.json", "w") as f:
        json.dump(shots, f, separators=(",", ":"))
    crease = None
    try:
        crease = crease_file(args.season, generated_at, stats["records"], games, tonight, novig_saves, goalies, fetch_previous(LIVE_CREASE_URL), now_utc, args.crease_record_dir)
        with open(args.out.parent / "crease.json", "w") as f:
            json.dump(crease, f, separators=(",", ":"))
    except Exception as e:  # King of the Crease must never cost the other NHL pages their data
        print(f"WARNING: King of the Crease couldn't be built ({e}).", file=sys.stderr)
    try:
        if crease is None:
            raise RuntimeError("King of the Crease's board couldn't be built")
        saves = saves_file(args.season, generated_at, crease, stats["records"], games, fetch_previous(LIVE_SAVES_URL), args.saves_record_dir)
    except Exception as e:  # Saves must never cost the other NHL pages their data
        print(f"WARNING: the Saves page couldn't be built ({e}).", file=sys.stderr)
        saves = {"season": args.season, "generated_at": generated_at, "games": {}, "record": None, "error": str(e)[:200]}
    with open(args.out.parent / "saves.json", "w") as f:
        json.dump(saves, f, separators=(",", ":"))
    gmodel = None
    try:
        gmodel = goals_model_for(stats["records"], model, goals_hand(stats["skaters"]))
        goals = goals_file(args.season, generated_at, stats["records"], model, games, lineups, injuries, fetch_previous(LIVE_GOALS_URL), now_utc,
                           tonight, stats["skaters"], goalies, player_odds, args.goals_record_dir, model=gmodel)
    except Exception as e:  # Goals must never cost the other NHL pages their data
        print(f"WARNING: the Goals page couldn't be built ({e}).", file=sys.stderr)
        goals = {"season": args.season, "generated_at": generated_at, "games": {}, "record": None, "error": str(e)[:200]}
    with open(args.out.parent / "goals.json", "w") as f:
        json.dump(goals, f, separators=(",", ":"))
    try:
        if gmodel is None:
            raise RuntimeError("the goals model couldn't be built")
        points = points_file(args.season, generated_at, stats["records"], gmodel, games, lineups, injuries, fetch_previous(LIVE_POINTS_URL), now_utc,
                             tonight, stats["skaters"], goalies, player_odds, args.points_record_dir)
    except Exception as e:  # Points must never cost the other NHL pages their data
        print(f"WARNING: the Points page couldn't be built ({e}).", file=sys.stderr)
        points = {"season": args.season, "generated_at": generated_at, "games": {}, "record": None, "error": str(e)[:200]}
    with open(args.out.parent / "points.json", "w") as f:
        json.dump(points, f, separators=(",", ":"))
    write_past_files(args.out.parent, {"shots": (args.record_dir, SHOTS_RECORD_COLS), "goals": (args.goals_record_dir, GOALS_RECORD_COLS),
                                       "points": (args.points_record_dir, POINTS_RECORD_COLS), "saves": (args.saves_record_dir, SAVES_RECORD_COLS)})
    try:
        lines =lines_file(args.season, generated_at, stats["records"], games, tonight, stats["skaters"], fetch_previous(LIVE_LINES_URL), now_utc)
    except Exception as e:  # Line Matchups must never cost the other NHL pages their data
        print(f"WARNING: Line Matchups couldn't be built ({e}).", file=sys.stderr)
        lines = {"season": args.season, "generated_at": generated_at, "games": {}, "error": str(e)[:200]}
    with open(args.out.parent / "lines.json", "w") as f:
        json.dump(lines, f, separators=(",", ":"))
    try:
        icebreaker = icebreaker_file(args.season, generated_at, stats["records"], goals.get("games") or {}, games, player_odds, book_odds,
                                     fetch_previous(LIVE_ICEBREAKER_URL), now_utc, args.icebreaker_record_dir)
    except Exception as e:  # Icebreaker must never cost the other NHL pages their data
        print(f"WARNING: Icebreaker couldn't be built ({e}).", file=sys.stderr)
        icebreaker = {"season": args.season, "generated_at": generated_at, "days": {}, "fast": {}, "history": None, "error": str(e)[:200]}
    with open(args.out.parent / "icebreaker.json", "w") as f:
        json.dump(icebreaker, f, separators=(",", ":"))
    try:
        hattrick = hattrick_file(args.season, generated_at, stats["records"], goals.get("games") or {}, games)
    except Exception as e:  # King of the Hat Trick must never cost the other NHL pages their data
        print(f"WARNING: King of the Hat Trick couldn't be built ({e}).", file=sys.stderr)
        hattrick = {"season": args.season, "generated_at": generated_at, "days": {}, "big": [], "players": {}, "teams": {}, "goalies": {}, "league": {}, "error": str(e)[:200]}
    with open(args.out.parent / "hattrick.json", "w") as f:
        json.dump(hattrick, f, separators=(",", ":"))
    d = stats["debug"]
    print(f"Wrote {args.out} -- {season_label(args.season)}: {d['games_loaded']} of {d['games_wanted']} finished games ({d['games_downloaded']} downloaded), {len(games)} on the schedule, lines for {novig_debug['matched']}")
    if d["errors"]:
        print("  game errors:", d["errors"], file=sys.stderr)


if __name__ == "__main__":
    main()
