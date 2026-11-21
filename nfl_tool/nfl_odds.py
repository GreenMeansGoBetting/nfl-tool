"""The NFL's SmartStake prices (moved out of smartstake.py 2026-11-21, so an NFL odds change
rebuilds only the NFL: the owner, after an NFL-only fix rebuilt NBA and NHL too, "WE AREN'T
DOING THOSE SPORTS"). The shared plumbing (the API, the books, quotes -> prices) stays in
smartstake.py; this file is the NFL's markets, teams and fetch. build_stats.py reads it.
"""
import sys

import smartstake as ss

NFL_PROP_MARKETS = {
    "football_player_receiving_yards": "receiving_yards",
    "football_player_receptions": "receiving_receptions",
    "football_player_longest_reception": "receiving_longestReception",
    "football_player_rushing_yards": "rushing_yards",
    "football_player_rushing_attempts": "rushing_attempts",
    "football_player_longest_rush": "rushing_longestRush",
    "football_player_passing_yards": "passing_yards",
    "football_player_passing_attempts": "passing_attempts",
    "football_player_passing_completions": "passing_completions",
    "football_player_passing_touchdowns": "passing_touchdowns",
    "football_player_interceptions": "passing_interceptions",
    "football_player_longest_pass_completion": "passing_longestCompletion",
    "football_player_rushing_receiving_yards": "rushing+receiving_yards",
    "football_player_passing_rushing_yards": "passing+rushing_yards",
}
NFL_TD_MARKET = "football_player_touchdowns"  # Anytime TD, quoted as Over 0.5
NFL_LINE_MARKETS = {"football_moneyline": "ml", "football_points_handicap": "spread", "football_points": "total"}

NFL_TEAMS = {
    "arizona cardinals": "ARI", "atlanta falcons": "ATL", "baltimore ravens": "BAL", "buffalo bills": "BUF",
    "carolina panthers": "CAR", "chicago bears": "CHI", "cincinnati bengals": "CIN", "cleveland browns": "CLE",
    "dallas cowboys": "DAL", "denver broncos": "DEN", "detroit lions": "DET", "green bay packers": "GB",
    "houston texans": "HOU", "indianapolis colts": "IND", "jacksonville jaguars": "JAX", "kansas city chiefs": "KC",
    "las vegas raiders": "LV", "los angeles chargers": "LAC", "los angeles rams": "LA", "miami dolphins": "MIA",
    "minnesota vikings": "MIN", "new england patriots": "NE", "new orleans saints": "NO", "new york giants": "NYG",
    "new york jets": "NYJ", "philadelphia eagles": "PHI", "pittsburgh steelers": "PIT", "san francisco 49ers": "SF",
    "seattle seahawks": "SEA", "tampa bay buccaneers": "TB", "tennessee titans": "TEN", "washington commanders": "WAS",
}


def build_nfl_book_odds(quotes: list, roster_names=()) -> dict:
    """SmartStake quotes -> the NFL's book_odds (smartstake.build_book_odds with the NFL's markets)."""
    return ss.build_book_odds(quotes, NFL_TEAMS, roster_names, prop_markets=NFL_PROP_MARKETS, td_market=NFL_TD_MARKET,
                              line_markets=NFL_LINE_MARKETS, yes_markets=(NFL_TD_MARKET,))


def fetch_nfl_book_odds(api_key: str | None, roster_names, previous: dict | None, now_iso: str, keep=None) -> tuple:
    """(book_odds, debug). Never raises: no key or any error = ({}, reason),
    and the previous build's started games still carry over."""
    if not api_key:
        return ss.only_games(ss.lock_started({}, previous, now_iso), keep), {"skipped": "no SMARTSTAKE_API_KEY"}
    try:
        markets = [*NFL_PROP_MARKETS, *NFL_LINE_MARKETS]
        quotes = ss.fetch_quotes(api_key, "nfl", markets)
        # Anytime TD on its own call WITH alternate quotes (2026-11-21): FanDuel, DraftKings and the
        # other one-sided (Yes only) books come back flagged alternate, so the main-line call above
        # kept only Fliff, 4CX, Fanatics and Pinnacle and the $100 CONTEST had no FanDuel prices.
        # build_book_odds keeps the 0.5 line only (2+ TDs dropped); a book's Yes counts as the Over.
        # A failed TD call costs only the TD prices.
        td_debug = None
        try:
            quotes += ss.fetch_quotes(api_key, "nfl", [NFL_TD_MARKET], max_pages=60, alternate=True)
        except Exception as e:
            print(f"WARNING: SmartStake anytime TD fetch failed ({e}) -- TD prices left out this run.", file=sys.stderr)
            td_debug = str(e)[:200]
        games = build_nfl_book_odds(quotes, roster_names)
        books = sorted({q["book"] for q in quotes})
        td_books = sorted({q["book"] for q in quotes if q.get("market_key") == NFL_TD_MARKET})
        debug = {"quotes": len(quotes), "games": len(games), "books": books, "td_books": td_books}
        if td_debug:
            debug["td_error"] = td_debug
        return ss.only_games(ss.lock_started(games, previous, now_iso), keep), debug
    except Exception as e:
        print(f"WARNING: SmartStake fetch failed ({e}) -- book odds left out this run.", file=sys.stderr)
        return ss.only_games(ss.lock_started({}, previous, now_iso), keep), {"error": str(e)[:200]}
