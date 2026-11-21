"""The NBA's SmartStake prices (moved out of smartstake.py 2026-11-21, so an NBA odds change
rebuilds only the NBA). The shared plumbing (the API, the books, quotes -> prices, alt ladders)
stays in smartstake.py; this file is the NBA's markets, First Basket, Double / Triple Double and
the injury refresh's carry-over. build_nba.py reads it.
"""
import sys

import smartstake as ss

# NBA player props (the Points page first; rebounds / assists / 3s later).
# The keys aren't in SmartStake's docs page, so each build reads /v1/markets
# (nba_prop_market_keys) and falls back to these, the NFL / NHL pattern.
NBA_PROP_GUESS = {"points": "basketball_player_points"}


# Every other player market the NBA player card prices (the owner, 2026-10-21:
# "odds for all markets"). The keys are SmartStake's own (tools/smartstake_probe_result.json);
# each is asked for only when /v1/markets lists it, so a renamed key can never
# cost the other prices. Fouls are left out; the yes / no markets (double-double,
# triple-double) come from add_yes_no.
NBA_PROP_MARKETS = {
    "basketball_player_points": "points",
    "basketball_player_rebounds": "rebounds",
    "basketball_player_assists": "assists",
    "basketball_player_made_threes": "threes",
    "basketball_player_points_rebounds_assists": "pra",
    "basketball_player_points_rebounds": "pr",
    "basketball_player_points_assists": "pa",
    "basketball_player_rebounds_assists": "ra",
    "basketball_player_steals": "steals",
    "basketball_player_blocks": "blocks",
    "basketball_player_steals_blocks": "stocks",
    "basketball_player_turnovers": "turnovers",
}


NBA_PROP_SKIP = ("rebound", "assist", "three", "3pt", "first", "1st", "2nd", "3rd", "4th", "quarter", "half", "period",
                 "q1", "q2", "q3", "q4", "team", "double", "triple", "steal", "block", "turnover", "+", "alternate", "milestone",
                 "most", "yes no")  # "most points in the game, yes / no" (found 2026-10-20) is not the points line


# NBA First Basket (the owner, 2026-10-21: SmartStake added the first points
# market). Found in /v1/markets like the first goal: a player market for the
# game's first points / basket, not a team's, a quarter's or a half's; field
# goal only markets are left out (most books, and the page, count free
# throws). Stored as props["first_basket"], side "o" = Yes.
NBA_FIRST_BASKET_GUESS = "basketball_first_points_scorer"


# NBA Double Double / Triple Double (the owner, 2026-11-20: on the player card). Yes / No markets:
# Yes is kept as "o", No as "u" (props["double_double"] / props["triple_double"], no line). The
# keys are SmartStake's (tools/smartstake_probe_result.json); /v1/markets is read for them by
# name first, so a renamed key is still found.
NBA_YES_NO_GUESS = {"basketball_player_double_double_yes_no": "double_double",
                    "basketball_player_triple_double_yes_no": "triple_double"}


YES_NO_SKIP = ("team", "quarter", "half", "1st", "2nd", "3rd", "4th", "first", "alternate")


FIRST_BASKET_SKIP = ("team", "quarter", "half", "2nd", "3rd", "4th", "second", "third", "fourth", "last", "method",
                     "exact", "both", "field goal", "three", "3pt", "rebound", "assist", "race", "wire")


def first_basket_market_keys(markets) -> list:
    """The NBA first points scorer market keys in a /v1/markets reply."""
    keys = []
    for m in markets or []:
        key = m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id"))
        name = m if isinstance(m, str) else (m.get("name") or m.get("market_name") or "")
        text = f"{key} {name}".lower().replace("_", " ")
        if key and ("first" in text or "1st" in text) and ("point" in text or "basket" in text or "scorer" in text) \
                and not any(word in text for word in FIRST_BASKET_SKIP):
            keys.append(key)
    return sorted(set(keys))


def nba_prop_market_keys(listed, stats=("points",)) -> dict:
    """{market key: stat} for the NBA player prop markets in a /v1/markets
    reply: a player market named for the stat alone (no combos, quarters,
    halves or firsts)."""
    found = {}
    for m in listed or []:
        key = m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id"))
        name = m if isinstance(m, str) else (m.get("name") or m.get("market_name") or "")
        text = f"{key} {name}".lower().replace("_", " ")
        if not key or "player" not in text:
            continue
        for stat in stats:
            if stat in text and not any(w in text for w in NBA_PROP_SKIP if w != stat):
                found[key] = stat
    return found


def nba_listed_markets(listed) -> dict:
    """{market key: stat} for the NBA_PROP_MARKETS that /v1/markets lists."""
    keys = {m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id")) for m in listed or []}
    return {k: v for k, v in NBA_PROP_MARKETS.items() if k in keys}


FAST_STATS = ("points", "threes", "rebounds", "assists")  # what the injury refresh fetches fresh (the sim's markets: an Out
# teammate moves a rebounds / assists line as much as a points one, and a stale price would read as an edge)


def carry_previous(games: dict, previous: dict | None, fresh=FAST_STATS) -> dict:
    """The injury refresh's odds (fast=True): the sim's markets just fetched,
    everything else (the player card's other markets, First Basket, the alt
    ladders) carried from the live build. A player's carried ladder is
    dropped when his main line moved (the news moved it: the old rungs are
    stale prices); a game with no fresh prices keeps its old ones."""
    def lines(entry):
        return sorted({q[2] for q in (entry or {}).get("q") or [] if len(q) > 2})
    for key, old in (previous or {}).items():
        g = games.get(key)
        if g is None:
            games[key] = old
            continue
        for market, prices in (old.get("props") or {}).items():
            if market in fresh:
                continue
            base = market[:-4] if market.endswith("_alt") else None
            if base in fresh:
                kept = {pid: v for pid, v in prices.items()
                        if lines((g["props"].get(base) or {}).get(pid)) == lines(((old.get("props") or {}).get(base) or {}).get(pid))}
                if kept:
                    g["props"][market] = kept
            else:
                g["props"].setdefault(market, prices)
        for part in ("td", "lines"):
            if old.get(part) and not g.get(part):
                g[part] = old[part]
    return games


def fetch_nba_book_odds(api_key: str | None, team_of, player_key, previous: dict | None, now_iso: str, keep=None, fast=False) -> tuple:
    """The NBA's (book_odds, debug), same rules as fetch_nfl_book_odds.
    team_of(full team name) -> abbreviation; player_key(name, away, home) ->
    the ESPN player id, or None for a player the site doesn't list. fast =
    the injury refresh (nba-refresh.yml): only the sim's main lines and their
    alt ladders fresh, the rest carried (carry_previous). SmartStake gives 10 pages a
    minute, and the full set took 216 of the build's 275 seconds on 10-25."""
    if not api_key:
        return ss.only_games(ss.lock_started({}, previous, now_iso), keep), {"skipped": "no SMARTSTAKE_API_KEY"}
    try:
        try:
            listed = ss.fetch_markets(api_key, "nba")
        except Exception as e:
            print(f"NOTE: SmartStake NBA market list failed ({e}); using the usual market names.", file=sys.stderr)
            listed = []
        markets = nba_prop_market_keys(listed) or {v: k for k, v in NBA_PROP_GUESS.items()}
        markets.update(nba_listed_markets(listed))
        if fast:
            markets = {k: v for k, v in markets.items() if v in FAST_STATS}
        quotes = ss.fetch_quotes(api_key, "nba", list(markets), max_pages=60)
        games = ss.build_book_odds(quotes, team_of, prop_markets=markets, td_market=None, line_markets={}, player_key=player_key)
        priced = sum(len(g["props"].get("points") or {}) for g in games.values())
        debug = {"quotes": len(quotes), "games": len(games), "players": priced, "markets": sorted(markets),
                 "books": sorted({q["book"] for q in quotes}), "listed": len(listed)}
        if not priced:
            named = [m if isinstance(m, str) else f"{m.get('key') or m.get('market_key')} ({m.get('name') or m.get('market_name') or ''})" for m in listed]
            debug["note"] = "; ".join(n for n in named if "point" in n.lower())[:500]
        if fast:
            debug["fast"] = True
            games = carry_previous(games, previous)  # previous = the live build's book_odds here
        else:
            debug["first_basket"] = add_first_basket(api_key, games, team_of, player_key, listed)
            debug["yes_no"] = add_yes_no(api_key, games, team_of, player_key, listed)
        # every rung of the sim's ladders (the NBA game sim prices them all: points / threes 2026-10-24,
        # rebounds / assists 2026-10-28). The injury refresh fetches them fresh too (2026-11-10): carried,
        # a player's ladder was dropped whenever any book's main line for him changed and stayed gone
        # until the next full build (Silva 3+ / 4+ threes missing all evening while every book had them).
        # A game the fresh fetch finds replaces its carried rungs; a failed fetch keeps the carried ones.
        for stat in ("threes", "points", "rebounds", "assists"):
            key = next((k for k, v in markets.items() if v == stat), None)
            if key:
                debug[f"{stat}_alt"] = ss.add_ladder(api_key, games, team_of, player_key, key, f"{stat}_alt")
        return ss.only_games(ss.lock_started(games, previous, now_iso), keep), debug
    except Exception as e:
        # The live build's prices stay (a tipped game's are locked anyway): 2026-11-06 a 504 here left
        # every untipped NBA game with no price at all until the next build.
        print(f"WARNING: SmartStake NBA fetch failed ({e}) -- the live build's prices kept.", file=sys.stderr)
        return ss.only_games(dict(previous or {}), keep), {"error": str(e)[:200], "kept": len(previous or {})}


def yes_no_market_keys(listed) -> dict:
    """{market key: "double_double" | "triple_double"} for the NBA player double / triple
    double markets in a /v1/markets reply; the known keys when none is found by name."""
    found = {}
    for m in listed or []:
        key = m if isinstance(m, str) else (m.get("key") or m.get("market_key") or m.get("id"))
        name = m if isinstance(m, str) else (m.get("name") or m.get("market_name") or "")
        text = f"{key} {name}".lower().replace("_", " ").replace("-", " ")
        if not key or "player" not in text or any(w in text for w in YES_NO_SKIP):
            continue
        for kind in ("double double", "triple double"):
            if kind in text:
                found[key] = kind.replace(" ", "_")
    return found or dict(NBA_YES_NO_GUESS)


def add_yes_no(api_key: str, games: dict, team_of, player_key, listed) -> dict:
    """Adds every book's Double Double and Triple Double Yes / No prices to the NBA games
    (props["double_double"] / ["triple_double"]). alternate=True: a book that sends it as an
    alternate quote is kept too (First Basket's lesson). Its own try: a failure here never
    costs the other prices. Returns what it found, for the build's debug."""
    try:
        markets = yes_no_market_keys(listed)
        quotes = ss.fetch_quotes(api_key, "nba", list(markets), alternate=True)
        found = ss.build_book_odds(quotes, team_of, prop_markets=markets, td_market=None, line_markets={},
                                player_key=player_key, yes_no_markets=set(markets))
        priced = {}
        for game_key, game in found.items():
            for stat in set(markets.values()):
                prices = game["props"].get(stat)
                if prices:
                    games.setdefault(game_key, {"kickoff": game["kickoff"], "props": {}, "td": {}, "lines": {}})["props"][stat] = prices
                    priced[stat] = priced.get(stat, 0) + len(prices)
        return {"markets": sorted(markets), "quotes": len(quotes), "players": priced, "books": sorted({q["book"] for q in quotes})}
    except Exception as e:
        print(f"WARNING: SmartStake double / triple double prices failed ({e}).", file=sys.stderr)
        return {"error": str(e)[:200]}


def add_first_basket(api_key: str, games: dict, team_of, player_key, listed) -> dict:
    """Adds every book's First Basket (first points scorer) Yes prices to the
    NBA games (props["first_basket"]). Its own try: a failure here never
    costs the points prices. Returns what it found, for the build's debug."""
    try:
        keys = first_basket_market_keys(listed) or [NBA_FIRST_BASKET_GUESS]
        # DraftKings, FanDuel, Caesars, theScore... send this market as
        # alternate quotes (the probe, 2026-10-21); main lines only got
        # Fliff, Novig and ProphetX.
        quotes = ss.fetch_quotes(api_key, "nba", keys, alternate=True)
        found = ss.build_book_odds(quotes, team_of, prop_markets={k: "first_basket" for k in keys}, td_market=None, line_markets={},
                                player_key=player_key, yes_markets=set(keys))
        priced = 0
        for game_key, game in found.items():
            prices = game["props"].get("first_basket")
            if prices:
                games.setdefault(game_key, {"kickoff": game["kickoff"], "props": {}, "td": {}, "lines": {}})["props"]["first_basket"] = prices
                priced += len(prices)
        out = {"markets": keys, "quotes": len(quotes), "players": priced, "books": sorted({q["book"] for q in quotes})}
        if not priced:
            named = [m if isinstance(m, str) else f"{m.get('key') or m.get('market_key')} ({m.get('name') or m.get('market_name') or ''})" for m in listed or []]
            out["note"] = "; ".join(n for n in named if "first" in n.lower() or "1st" in n.lower())[:700]
        return out
    except Exception as e:
        print(f"WARNING: SmartStake First Basket prices failed ({e}).", file=sys.stderr)
        return {"error": str(e)[:200]}
