"""The NHL's SmartStake prices (moved out of smartstake.py 2026-11-21, so an NHL odds change
rebuilds only the NHL). The shared plumbing (the API, the books, quotes -> prices, alt ladders)
stays in smartstake.py; this file is the NHL's markets, saves and first goal scorer. build_nhl.py
reads it.
"""
import sys

import smartstake as ss

# NHL: shots on goal, goals (anytime = the 0.5 line) and points (1+ = the 0.5
# line: Line Stacks shows only stacks a book prices every leg of), keyed by the NHL's player id.
NHL_PROP_MARKETS = {"hockey_player_shots_on_goal": "sog", "hockey_player_goals": "goals", "hockey_player_points": "points"}


# Goalie saves (the Saves page; "Player Saves" on SmartStake's odds screen, the
# owner 2026-10-20). Its key isn't in their docs either, so it is looked up in
# /v1/markets by name, never guessed: an unknown key in the odds call could cost
# every NHL price. Stored as props["saves"], over / under like shots.
SAVES_SKIP = ("team", "period", "1st", "2nd", "3rd", "first", "second", "third", "alternate", "+", "against", "percent", "%")


# First goal scorer (Icebreaker: DraftKings' promo needs a first goal scorer
# bet). Its key isn't in SmartStake's docs, so each build looks it up in
# /v1/markets: a player market named for the game's first goal, not a team's,
# a period's or the last one. Stored as props["first_goal"], side "o" = Yes.
FIRST_GOAL_SKIP = ("team", "period", "2nd", "3rd", "second", "third", "last", "method", "minute", "interval", "anytime", "both")


def first_goal_market_keys(markets) -> list:
    """The first goal scorer market keys in a /v1/markets reply (a list of
    {key, name} objects or of plain keys; either name for the key is read)."""
    keys = []
    for m in markets or []:
        key = m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id"))
        name = m if isinstance(m, str) else (m.get("name") or m.get("market_name") or "")
        text = f"{key} {name}".lower().replace("_", " ")
        if key and ("first" in text or "1st" in text) and "goal" in text and not any(word in text for word in FIRST_GOAL_SKIP):
            keys.append(key)
    return sorted(set(keys))


def saves_market_keys(markets) -> list:
    """The goalie saves market keys in a /v1/markets reply: a player market
    named for saves, not a period's, a team's or save percentage."""
    keys = []
    for m in markets or []:
        key = m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id"))
        name = m if isinstance(m, str) else (m.get("name") or m.get("market_name") or "")
        text = f"{key} {name}".lower().replace("_", " ")
        if key and "save" in text and not any(word in text for word in SAVES_SKIP):
            keys.append(key)
    return sorted(set(keys))


def fetch_nhl_book_odds(api_key: str | None, team_of, player_key, previous: dict | None, now_iso: str, keep=None) -> tuple:
    """The NHL's (book_odds, debug), same rules as fetch_nfl_book_odds.
    team_of(full team name) -> abbreviation; player_key(name, away, home) ->
    the NHL player id, or None for a player the site doesn't list."""
    if not api_key:
        return ss.only_games(ss.lock_started({}, previous, now_iso), keep), {"skipped": "no SMARTSTAKE_API_KEY"}
    try:
        try:
            listed = ss.fetch_markets(api_key, "nhl")
        except Exception as e:
            print(f"NOTE: SmartStake NHL market list failed ({e}); no saves prices this run.", file=sys.stderr)
            listed = None
        saves = saves_market_keys(listed)
        markets = {**NHL_PROP_MARKETS, **{key: "saves" for key in saves}}
        quotes = ss.fetch_quotes(api_key, "nhl", list(markets))
        games = ss.build_book_odds(quotes, team_of, prop_markets=markets, td_market=None, line_markets={}, player_key=player_key)
        debug = {"quotes": len(quotes), "games": len(games), "books": sorted({q["book"] for q in quotes})}
        if saves:
            debug["saves"] = {"markets": saves, "goalies": sum(len(g["props"].get("saves") or {}) for g in games.values())}
        else:
            named = [m if isinstance(m, str) else f"{m.get('key') or m.get('market_key')} ({m.get('name') or m.get('market_name') or ''})" for m in listed or []]
            near = [n for n in named if "save" in n.lower() or "goalie" in n.lower()]
            debug["saves"] = {"note": "no market list" if listed is None else f"no saves market among {len(named)}: {'; '.join(near)}"[:500]}
        debug["first_goal"] = add_first_goal(api_key, games, team_of, player_key, listed)
        # every line each book hangs (2+ shots ... 6+, 2+ goals, a hat trick, 2+ points, the saves
        # ladder), in "sog_alt" / "goals_alt" / "points_alt" / "saves_alt": the prop pages' ladders and
        # the card's alt lines (the owner, 2026-11-02: "use smartstake odds and not just novig")
        debug["ladders"] = ss.add_ladder(api_key, games, team_of, player_key, {k: f"{v}_alt" for k, v in markets.items()}, league="nhl")
        return ss.only_games(ss.lock_started(games, previous, now_iso), keep), debug
    except Exception as e:
        print(f"WARNING: SmartStake NHL fetch failed ({e}) -- book odds left out this run.", file=sys.stderr)
        return ss.only_games(ss.lock_started({}, previous, now_iso), keep), {"error": str(e)[:200]}


def add_first_goal(api_key: str, games: dict, team_of, player_key, listed=None) -> dict:
    """Adds every book's first goal scorer prices to the NHL games
    (props["first_goal"]), from markets found by first_goal_market_keys. Its
    own try: a failure here never costs the shots and goals prices. Returns
    what it found, for the build's debug."""
    try:
        listed = ss.fetch_markets(api_key, "nhl") if listed is None else listed
        keys = first_goal_market_keys(listed)
        if not keys:
            # Name the likeliest ones, so version.json shows what the market is called (or that it isn't there).
            named = [m if isinstance(m, str) else f"{m.get('key') or m.get('market_key')} ({m.get('name') or m.get('market_name') or ''})" for m in listed]
            near = [n for n in named if any(w in n.lower() for w in ("goal", "first", "scorer"))] or named
            return {"markets": [], "note": f"no first goal scorer market among {len(listed)}: {'; '.join(near)}"[:700]}
        quotes = ss.fetch_quotes(api_key, "nhl", keys)
        found = ss.build_book_odds(quotes, team_of, prop_markets={k: "first_goal" for k in keys}, td_market=None, line_markets={},
                                player_key=player_key, yes_markets=set(keys))
        priced = 0
        for game_key, game in found.items():
            prices = game["props"].get("first_goal")
            if prices:
                games.setdefault(game_key, {"kickoff": game["kickoff"], "props": {}, "td": {}, "lines": {}})["props"]["first_goal"] = prices
                priced += len(prices)
        return {"markets": keys, "quotes": len(quotes), "players": priced,
                "draftkings": sum(1 for q in quotes if q.get("book") == "draftkings")}
    except Exception as e:
        print(f"WARNING: SmartStake first goal prices failed ({e}).", file=sys.stderr)
        return {"error": str(e)[:200]}
