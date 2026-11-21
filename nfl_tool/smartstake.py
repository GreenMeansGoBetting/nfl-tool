"""SmartStake Odds API: every US book's price for the markets the site shows.

This file is the SHARED plumbing only (the API calls, the US books, quotes -> prices, the odds
lock at kickoff, alt ladders): a change here rebuilds every sport. Each sport's own markets and
fetch live in its own file, so a change there rebuilds only that sport (2026-11-21, the owner,
after an NFL-only odds fix rebuilt the NBA and NHL: "WE AREN'T DOING THOSE SPORTS"):
nfl_odds.py (NFL), nba/nba_odds.py (NBA), nhl/nhl_odds.py (NHL).

Docs: https://www.smartstake.app/api. The owner is a SmartStake partner and has
their written permission (2026-10-14) to show these odds to members. The key
is the GitHub secret SMARTSTAKE_API_KEY; with no key, or any failure, the build
carries on without it and the site shows Novig's prices. "HTTP Error 401:
Unauthorized" in version.json (`nba.book_odds`) means SmartStake rejected the
key (it retired the old one 2026-11-10): the owner saves the new key in that
secret, and the next build that rebuilds the data (a push touching this file,
the 6-hour run, or "Run workflow" on Deploy) picks it up. SmartStake's docs:
401 = "missing or unknown" key, 403 = a book or league not on the key. While
the NBA fetch fails the site shows the last good copy, frozen (lines posted
since are missing: Drummond's, 2026-11-10), so a board that looks priced can
still be stale; check version.json.

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
    "4cx": "4CX",
    "underdog_dfs": "Underdog",  # pick'em ("underdog_dfs_best" left out: not documented)
}
# Pick'em apps (the owner, 2026-10-29: members asked for Underdog): listed in
# every price list, never the "best price" a play, edge or record is figured
# on, since a pick'em leg can't be bet on its own.
PICKEM_BOOKS = ("underdog_dfs",)
# The sharp prices the fair price is made from (vig removed), on the site.
FAIR_BOOKS = ("pinnacle", "novig")


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


class SmartStakeError(RuntimeError):
    """A failed call, its message scrubbed of the key."""


def _get(api_key: str, path: str, params: dict) -> dict:
    # 2026-11-10: the new key was saved with a line break after it; Python
    # refused the header and its error, holding the whole key, went into the
    # public version.json. Strip it, and never let the key into an error.
    key = (api_key or "").strip()
    try:
        return _send(key, path, params)
    except Exception as e:
        text = str(e)
        if key and key in text:
            raise SmartStakeError(f"{type(e).__name__}: {text.replace(key, '[key hidden]')}") from None
        if "Bearer" in text:
            raise SmartStakeError(f"{type(e).__name__} (message hidden: it held the key)") from None
        raise


def _send(api_key: str, path: str, params: dict) -> dict:
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
            if e.code in (429, 502, 503, 504) and attempt < 2:  # 504: 2026-11-06's NBA build lost every price to one
                time.sleep(min(int(e.headers.get("Retry-After") or 10), 30))
                continue
            raise
    raise RuntimeError("SmartStake kept asking to slow down")


def fetch_quotes(api_key: str, league: str, markets, max_pages: int = 30, alternate: bool = False) -> list:
    """Every current pregame main-line quote from the US books for these
    markets; alternate=True keeps the books' alternate quotes too (a
    many-player market such as 1st Points Scorer: the sportsbooks list it as
    alternate, Yes only; the exchanges as a main Yes / No)."""
    quotes, cursor = [], None
    for page in range(max_pages):
        body = _get(api_key, "/v1/odds", {
            "league": league, "market": ",".join(markets), "alternate": None if alternate else "false", "live": "false",
            "state": STATE, "cursor": cursor,
        })
        quotes += [q for q in body.get("data") or [] if q.get("book") in US_BOOKS and not q.get("live") and (alternate or not q.get("alternate"))]
        cursor = body.get("next_cursor")
        if not cursor:
            return quotes
        time.sleep(6.5)  # 10 snapshot pages a minute
    print(f"WARNING: SmartStake {league} still had pages after {max_pages}; using what came back.", file=sys.stderr)
    return quotes


def _quote(q, side):
    return [q["book"], side, q.get("line"), int(q["odds"]), q.get("bet_url") or ""]


def build_book_odds(quotes: list, teams, roster_names=(), *, prop_markets=None, td_market=None,
                    line_markets=None, player_key=None, yes_markets=(), yes_no_markets=()) -> dict:
    """quotes -> {"AWAY_HOME": {...}} (shape in the module docstring).
    teams maps the API's full team names to the site's abbreviations (a dict
    of lowercase names, or a function); roster_names are the site's own player
    spellings, preferred when they match. player_key(name, away, home) names
    a player's row (default: normName; the NHL uses the league's player id).
    yes_markets keep Yes only (as "o"); yes_no_markets keep Yes as "o" and No as "u"."""
    prop_markets = {} if prop_markets is None else prop_markets  # each sport names its own (nfl_odds.py, nba/nba_odds.py, nhl/nhl_odds.py)
    line_markets = {} if line_markets is None else line_markets
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
            elif mkey in yes_no_markets and side in ("yes", "no"):
                side = "over" if side == "yes" else "under"  # double-double: both sides
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


def fetch_markets(api_key: str, league: str) -> list:
    """Every market SmartStake lists for a league (/v1/markets)."""
    body = _get(api_key, "/v1/markets", {"league": league})
    return (body.get("data") if isinstance(body, dict) else body) or []


def add_ladder(api_key: str, games: dict, team_of, player_key, key, name=None, league: str = "nba") -> dict:
    """Adds every book's prices for player markets at EVERY line,
    alternates included, to the games (props[name], "threes_alt" /
    "points_alt"): the Points and Threes ladders (20+ / 25+ ..., 1+ / 2+ ...)
    show only rungs a book really prices (the owner: an alt ladder "without
    odds its just filler"). Kept apart from the main market so the main line
    stays the books' main line. key: one market key with its name, or a
    {key: name} dict asked for in ONE call (the NHL's four ladders: SmartStake
    gives 10 pages a minute). Its own try: a failure here never costs the
    other prices."""
    markets = key if isinstance(key, dict) else {key: name}
    label = ", ".join(sorted(set(markets.values())))
    try:
        quotes = fetch_quotes(api_key, league, list(markets), max_pages=60, alternate=True)
        found = build_book_odds(quotes, team_of, prop_markets=markets, td_market=None, line_markets={}, player_key=player_key)
        priced = 0
        for game_key, game in found.items():
            for alt in set(markets.values()):
                prices = game["props"].get(alt)
                if prices:
                    games.setdefault(game_key, {"kickoff": game["kickoff"], "props": {}, "td": {}, "lines": {}})["props"][alt] = prices
                    priced += len(prices)
        return {"quotes": len(quotes), "players": priced, "lines": sorted({q.get("line") for q in quotes if q.get("line") is not None})[:12]}
    except Exception as e:
        print(f"WARNING: SmartStake {label} ladder failed ({e}).", file=sys.stderr)
        return {"error": str(e)[:200]}


