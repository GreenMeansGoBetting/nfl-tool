"""SmartStake Odds API: every US book's price for the markets the site shows.

Docs: https://www.smartstake.app/api. The owner is a SmartStake partner and has
their written permission (2026-10-14) to show these odds to members. The key
is the GitHub secret SMARTSTAKE_API_KEY; with no key, or any failure, the build
carries on without it and the site shows Novig / SGO prices as before.

One league snapshot per build (`/v1/odds?league=`), main lines only
(`alternate=false`), pregame only (`live=false`), and only the markets the site
uses: unfiltered, one NFL game is ~40,000 quotes. Bet links are asked for New
Jersey: without a state they come back for Ontario.

Output (data.json `book_odds`), per game "AWAY_HOME":
  {"kickoff": iso, "props": {stat_id: {norm_name: {"name", "q": [quote, ...]}}},
   "td": {norm_name: {"name", "q": [...]}}, "lines": {"ml"|"spread"|"total": [...]}}
quote = [book, side, line, odds, url]; side is "o"/"u" (props, totals, TDs),
"away"/"home" (moneyline, spread; the line is that team's spread).
"""
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.server.smartstake.ca"
STATE = "NJ"

# The books a US member can use (SmartStake also carries Canadian, offshore and
# pick'em apps). Display names; the order is only a tie-break.
US_BOOKS = {
    "draftkings": "DraftKings",
    "fanduel": "FanDuel",
    "betmgm": "BetMGM",
    "caesars": "Caesars",
    "fanatics": "Fanatics",
    "bet365": "bet365",
    "thescore": "theScore",
    "betrivers": "BetRivers",
    "hard_rock": "Hard Rock",
    "bally_bet": "Bally Bet",
    "circa": "Circa",
    "pinnacle": "Pinnacle",
    "novig": "Novig",
    "prophetx": "ProphetX",
    "kalshi": "Kalshi",
    "polymarket_us": "Polymarket",
    "fliff": "Fliff",
}
# The sharp prices the fair price is made from (vig removed), on the site.
FAIR_BOOKS = ("pinnacle", "novig")

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

# NHL: shots on goal, goals (anytime = the 0.5 line) and points (1+ = the 0.5
# line: Line Stacks shows only stacks a book prices every leg of), keyed by the NHL's player id.
NHL_PROP_MARKETS = {"hockey_player_shots_on_goal": "sog", "hockey_player_goals": "goals", "hockey_player_points": "points"}
# First goal scorer (Icebreaker: DraftKings' promo needs a first goal scorer
# bet). Its key isn't in SmartStake's docs, so each build looks it up in
# /v1/markets: a player market named for the game's first goal, not a team's,
# a period's or the last one. Stored as props["first_goal"], side "o" = Yes.
FIRST_GOAL_SKIP = ("team", "period", "2nd", "3rd", "second", "third", "last", "method", "minute", "interval", "anytime", "both")

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


def norm_player(name: str) -> str:
    """Same rule as build_stats._norm_player / normName in common.js."""
    return "".join(ch for ch in re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (name or "").lower()) if ch.isalpha())


def _readable(name: str) -> str:
    """'Barkley, Saquon' -> 'Saquon Barkley'; books also send ALL CAPS."""
    name = (name or "").strip()
    if name.count(",") == 1:
        last, first = (part.strip() for part in name.split(","))
        name = f"{first} {last}"
    return name


def _get(api_key: str, path: str, params: dict) -> dict:
    query = urllib.parse.urlencode([(k, v) for k, v in params.items() if v is not None])
    req = urllib.request.Request(f"{BASE}{path}?{query}", headers={
        "Authorization": f"Bearer {api_key}",
        "Accept-Encoding": "gzip",
        "User-Agent": "gmg-sports/1.0",
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < 2:
                time.sleep(min(int(e.headers.get("Retry-After") or 10), 30))
                continue
            raise
    raise RuntimeError("SmartStake kept asking to slow down")


def fetch_quotes(api_key: str, league: str, markets, max_pages: int = 30) -> list:
    """Every current pregame main-line quote from the US books for these markets."""
    quotes, cursor = [], None
    for page in range(max_pages):
        body = _get(api_key, "/v1/odds", {
            "league": league, "market": ",".join(markets), "alternate": "false", "live": "false",
            "state": STATE, "cursor": cursor,
        })
        quotes += [q for q in body.get("data") or [] if q.get("book") in US_BOOKS and not q.get("live") and not q.get("alternate")]
        cursor = body.get("next_cursor")
        if not cursor:
            return quotes
        time.sleep(6.5)  # 10 snapshot pages a minute
    print(f"WARNING: SmartStake {league} still had pages after {max_pages}; using what came back.", file=sys.stderr)
    return quotes


def _quote(q, side):
    return [q["book"], side, q.get("line"), int(q["odds"]), q.get("bet_url") or ""]


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


def build_book_odds(quotes: list, teams, roster_names=(), *, prop_markets=None, td_market=NFL_TD_MARKET,
                    line_markets=None, player_key=None, yes_markets=()) -> dict:
    """quotes -> {"AWAY_HOME": {...}} (shape in the module docstring).
    teams maps the API's full team names to the site's abbreviations (a dict
    of lowercase names, or a function); roster_names are the site's own player
    spellings, preferred when they match. player_key(name, away, home) names
    a player's row (default: normName; the NHL uses the league's player id)."""
    prop_markets = NFL_PROP_MARKETS if prop_markets is None else prop_markets
    line_markets = NFL_LINE_MARKETS if line_markets is None else line_markets
    team_of = teams if callable(teams) else (lambda full: teams.get((full or "").lower()))
    roster = {norm_player(n): n for n in roster_names}
    names_by_id = {}
    for q in quotes:
        if q.get("player_id") is not None and q.get("participant"):
            names_by_id.setdefault(q["player_id"], set()).add(_readable(q["participant"]))

    def player_name(q):
        spellings = names_by_id.get(q.get("player_id")) or {_readable(q.get("participant"))}
        for s in spellings:
            if norm_player(s) in roster:
                return roster[norm_player(s)]
        # Otherwise the tidiest spelling: plain letters, not ALL CAPS.
        return sorted(spellings, key=lambda s: (s.isupper(), not s.isascii(), s))[0]

    games, seen = {}, set()
    for q in quotes:
        away, home = team_of(q.get("away")), team_of(q.get("home"))
        if not away or not home or q.get("odds") is None:
            continue
        # One quote per book / market / player / line / side (the newest).
        key = (q.get("event_id"), q["book"], q.get("market_key"), q.get("player_id"), q.get("line"), q.get("side"))
        if key in seen:
            continue
        seen.add(key)
        game = games.setdefault(f"{away}_{home}", {"kickoff": q.get("starts_at"), "props": {}, "td": {}, "lines": {}})
        mkey, side = q.get("market_key"), q.get("side")
        if mkey in prop_markets or (td_market and mkey == td_market):
            if mkey in yes_markets and side == "yes":
                side = "over"  # a yes / no market (first goal scorer): Yes is kept as "o"
            if side not in ("over", "under") or q.get("player_id") is None:
                continue
            name = player_name(q)
            if player_key:  # any spelling a book uses for him will do
                spellings = [name, *sorted(names_by_id.get(q.get("player_id")) or ())]
                key = next((k for k in (player_key(n, away, home) for n in spellings) if k is not None), None)
            else:
                key = norm_player(name)
            if key is None:
                continue
            bucket = game["td"] if mkey == td_market else game["props"].setdefault(prop_markets[mkey], {})
            if mkey == td_market and q.get("line") not in (None, 0.5):
                continue  # 2+ TDs and the like
            bucket.setdefault(str(key), {"name": name, "q": []})["q"].append(_quote(q, side[0]))
        elif mkey in line_markets:
            kind = line_markets[mkey]
            if kind == "total" and side in ("over", "under"):
                game["lines"].setdefault(kind, []).append(_quote(q, side[0]))
            elif kind != "total" and side in ("awayteam", "hometeam"):
                game["lines"].setdefault(kind, []).append(_quote(q, side[:4]))
    return games


def lock_started(games: dict, previous: dict | None, now_iso: str) -> dict:
    """Odds lock at kickoff: a started game keeps the previous build's pregame
    copy, or shows no book prices at all (never an in-game price)."""
    previous = previous or {}
    out = {k: g for k, g in games.items() if not g.get("kickoff") or g["kickoff"] > now_iso}
    for key, g in previous.items():
        if key not in out and g.get("kickoff") and g["kickoff"] <= now_iso:
            out[key] = g
    return out


def only_games(book_odds: dict, keep) -> dict:
    """The board runs days ahead; keep the games on the site's own schedule."""
    return book_odds if keep is None else {k: g for k, g in book_odds.items() if k in keep}


def fetch_nfl_book_odds(api_key: str | None, roster_names, previous: dict | None, now_iso: str, keep=None) -> tuple:
    """(book_odds, debug). Never raises: no key or any error = ({}, reason),
    and the previous build's started games still carry over."""
    if not api_key:
        return only_games(lock_started({}, previous, now_iso), keep), {"skipped": "no SMARTSTAKE_API_KEY"}
    try:
        markets = [*NFL_PROP_MARKETS, NFL_TD_MARKET, *NFL_LINE_MARKETS]
        quotes = fetch_quotes(api_key, "nfl", markets)
        games = build_book_odds(quotes, NFL_TEAMS, roster_names)
        books = sorted({q["book"] for q in quotes})
        return only_games(lock_started(games, previous, now_iso), keep), {"quotes": len(quotes), "games": len(games), "books": books}
    except Exception as e:
        print(f"WARNING: SmartStake fetch failed ({e}) -- book odds left out this run.", file=sys.stderr)
        return only_games(lock_started({}, previous, now_iso), keep), {"error": str(e)[:200]}


def fetch_nhl_book_odds(api_key: str | None, team_of, player_key, previous: dict | None, now_iso: str, keep=None) -> tuple:
    """The NHL's (book_odds, debug), same rules as fetch_nfl_book_odds.
    team_of(full team name) -> abbreviation; player_key(name, away, home) ->
    the NHL player id, or None for a player the site doesn't list."""
    if not api_key:
        return only_games(lock_started({}, previous, now_iso), keep), {"skipped": "no SMARTSTAKE_API_KEY"}
    try:
        quotes = fetch_quotes(api_key, "nhl", list(NHL_PROP_MARKETS))
        games = build_book_odds(quotes, team_of, prop_markets=NHL_PROP_MARKETS, td_market=None, line_markets={}, player_key=player_key)
        debug = {"quotes": len(quotes), "games": len(games), "books": sorted({q["book"] for q in quotes})}
        debug["first_goal"] = add_first_goal(api_key, games, team_of, player_key)
        return only_games(lock_started(games, previous, now_iso), keep), debug
    except Exception as e:
        print(f"WARNING: SmartStake NHL fetch failed ({e}) -- book odds left out this run.", file=sys.stderr)
        return only_games(lock_started({}, previous, now_iso), keep), {"error": str(e)[:200]}


def fetch_markets(api_key: str, league: str) -> list:
    """Every market SmartStake lists for a league (/v1/markets)."""
    body = _get(api_key, "/v1/markets", {"league": league})
    return (body.get("data") if isinstance(body, dict) else body) or []


def add_first_goal(api_key: str, games: dict, team_of, player_key) -> dict:
    """Adds every book's first goal scorer prices to the NHL games
    (props["first_goal"]), from markets found by first_goal_market_keys. Its
    own try: a failure here never costs the shots and goals prices. Returns
    what it found, for the build's debug."""
    try:
        listed = fetch_markets(api_key, "nhl")
        keys = first_goal_market_keys(listed)
        if not keys:
            # Name the likeliest ones, so version.json shows what the market is called (or that it isn't there).
            named = [m if isinstance(m, str) else f"{m.get('key') or m.get('market_key')} ({m.get('name') or m.get('market_name') or ''})" for m in listed]
            near = [n for n in named if any(w in n.lower() for w in ("goal", "first", "scorer"))] or named
            return {"markets": [], "note": f"no first goal scorer market among {len(listed)}: {'; '.join(near)}"[:700]}
        quotes = fetch_quotes(api_key, "nhl", keys)
        found = build_book_odds(quotes, team_of, prop_markets={k: "first_goal" for k in keys}, td_market=None, line_markets={},
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

