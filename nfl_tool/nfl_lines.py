"""Game lines and prop odds for the NFL build: the Novig feed, every book's TD
prices, the odds lock at kickoff and the GMG model's locked record it protects.
(nfl_odds.py fetches the SmartStake book lists this file merges.)

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd

from gmg_model import eastern_now, game_has_started, kickoff_utc
from smartstake import US_BOOKS
from nfl_common import normalize_team
from nfl_sources import moneyline_to_implied_prob, novig_moneyline_probs


# ---- Novig: player prop lines, First TD and its own game lines ----
# Novig's public site reads every market for a game (main lines,
# alternates, prices) from one GraphQL request per game, no login. Every
# book's price comes from SmartStake (smartstake.py); Novig adds the
# over/under lines, First TD (SmartStake has no such market) and its own
# game prices. Novig only accepts the exact query its own site sends, saved
# verbatim in novig_event_markets.graphql -- if Novig changes its site the
# request starts erroring and this returns nothing until the file is
# refreshed (copy the EventMarkets_Query request body from the browser's
# network tab on any novig.com game page).
NOVIG_EVENTS_URL = "https://api.novig.us/v3/public/catalog/events?league=NFL"
NOVIG_GRAPHQL_URL = "https://api.novig.us/v1/graphql"
NOVIG_QUERY_PATH = Path(__file__).parent / "novig_event_markets.graphql"
NOVIG_MARKET_FILTER = {
    "_and": [
        {"status": {"_eq": "OPEN"}},
        {"_or": [{"is_consensus": {"_eq": True}}, {"outcomes": {"available": {"_is_null": False}}}]},
        {"_and": [
            {"_not": {"market_locks": {"_and": [{"deleted_at": {"_is_null": True}}]}}},
            {"event": {"_not": {"event_locks": {"_and": [{"deleted_at": {"_is_null": True}}]}}}},
        ]},
    ]
}
# Novig market type -> our PLAYER_OU_MARKETS stat id.
NOVIG_OU_TYPES = {
    "RECEIVING_YARDS": "receiving_yards",
    "RECEPTIONS": "receiving_receptions",
    "LONGEST_RECEPTION": "receiving_longestReception",
    "RUSHING_YARDS": "rushing_yards",
    "RUSHING_ATTEMPTS": "rushing_attempts",
    "LONGEST_RUSH": "rushing_longestRush",
    "PASSING_YARDS": "passing_yards",
    "PASSING_ATTEMPTS": "passing_attempts",
    "PASSING_COMPLETIONS": "passing_completions",
    "PASSING_TOUCHDOWNS": "passing_touchdowns",
    "INTERCEPTIONS_THROWN": "passing_interceptions",
    "LONGEST_COMPLETION": "passing_longestCompletion",
    "RUSHING_AND_RECEIVING_YARDS": "rushing+receiving_yards",
    "PASSING_AND_RUSHING_YARDS": "passing+rushing_yards",
    "KICKING_POINTS": "kicking_points",
    "FIELD_GOALS_MADE": "field_goals_made",
    "TACKLES_ASSISTS": "defense_tackles_assists",
}
# Novig team symbols that differ from ours.
NOVIG_TEAM_FIXES = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX", "LVR": "LV"}
# The two LA teams by full name: Novig's `symbol` for the Chargers became
# "LA" (our Rams code) in Nov 2026, which dropped every Chargers line.
NOVIG_NAME_TEAMS = {"Los Angeles Chargers": "LAC", "Los Angeles Rams": "LA"}
# Novig competitor id -> our team code, filled from each game's own two teams
# (game lines' outcomes carry only id + symbol, not the name).
_NOVIG_TEAM_IDS: dict = {}


def _novig_team(comp: dict | None):
    """Our team code for a Novig competitor: its id (from the game header),
    then its full name for the LA teams, then short_name / symbol."""
    comp = comp or {}
    if comp.get("id") in _NOVIG_TEAM_IDS:
        return _NOVIG_TEAM_IDS[comp["id"]]
    if comp.get("name") in NOVIG_NAME_TEAMS:
        return NOVIG_NAME_TEAMS[comp["name"]]
    sym = comp.get("short_name") or comp.get("symbol")
    return normalize_team(NOVIG_TEAM_FIXES.get(sym, sym)) if sym else None


def _novig_request(url: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"accept": "*/*", "User-Agent": "Mozilla/5.0 (compatible; nfl-tool/1.0)"}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def novig_price_to_american(p):
    """Novig prices an outcome as the cost of a $1 contract (0.535 = 53.5%)."""
    if p is None or p <= 0 or p >= 1:
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def fetch_novig_week(week_games: list, starts_after: str, starts_before: str) -> tuple:
    """Every market for this week's games, keyed by our (away, home).
    Returns (games, debug). Never raises -- a Novig problem just means no
    Novig props this run (SmartStake still has every book's price)."""
    debug = {"events": 0, "games": [], "error": None}
    out = {}
    try:
        query = NOVIG_QUERY_PATH.read_text(encoding="utf-8").rstrip("\n")
        lo = datetime.fromisoformat(starts_after).timestamp() * 1000
        hi = datetime.fromisoformat(starts_before).timestamp() * 1000
        wanted = {(g["away"], g["home"]) for g in week_games}
        events = [e for e in _novig_request(NOVIG_EVENTS_URL).get("items", []) if lo <= (e.get("startsTs") or 0) <= hi]
        debug["events"] = len(events)
        for e in events:
            resp = _novig_request(NOVIG_GRAPHQL_URL, {
                "operationName": "EventMarkets_Query",
                "variables": {"eventId": e["eventId"], "marketVisibleWhere": NOVIG_MARKET_FILTER},
                "query": query,
            })
            if resp.get("errors"):
                debug["error"] = str(resp["errors"][0].get("message"))
                continue
            rows = (resp.get("data") or {}).get("event") or []
            if not rows or not rows[0].get("game"):
                continue
            ev = rows[0]
            away_c, home_c = ev["game"]["awayTeam"], ev["game"]["homeTeam"]
            key = (_novig_team({**away_c, "id": None}), _novig_team({**home_c, "id": None}))
            if key not in wanted:
                continue
            _NOVIG_TEAM_IDS[away_c.get("id")] = key[0]
            _NOVIG_TEAM_IDS[home_c.get("id")] = key[1]
            out[key] = ev.get("markets") or []
            debug["games"].append(f"{key[0]}@{key[1]}:{len(out[key])}")
    except Exception as ex:  # network, JSON, or a changed query
        debug["error"] = str(ex)
        print(f"WARNING: Novig fetch failed ({ex}) -- no Novig props this run.", file=sys.stderr)
    return out, debug


def _novig_player_team(market):
    comps = ((market.get("player") or {}).get("player_competitors") or [])
    return _novig_team(comps[0]["competitor"]) if comps else None


# Highest believable Yes price per TD market (a first-TD favorite is ~30%).
TD_YES_MAX = {"TOUCHDOWNS": 0.95, "FIRST_TOUCHDOWN_SCORER": 0.5}


def extract_novig_props(novig_games: dict, teams, roster_positions: dict, unavailable: set) -> tuple:
    """(ou, anytime, first): ou is {stat_id: {team: [rows]}}, each row
    {name, position, line, over_odds, under_odds, source, thin}; anytime /
    first are {team: [rows]}, each {name, position, best_odds, best_book,
    fair_odds, implied_prob, thin}. Main (consensus) lines only."""
    ou = {stat: {t: [] for t in teams} for stat in PLAYER_OU_MARKETS}
    anytime = {t: [] for t in teams}
    first = {t: [] for t in teams}
    for markets in novig_games.values():
        game_td_rows = []  # (type, team, yes, no, row) -- chances set once the whole game is read
        for m in markets:
            if not m.get("is_consensus") or not m.get("player"):
                continue
            name = m["player"].get("full_name")
            team = _novig_player_team(m)
            if not name or team not in teams:
                continue
            outcomes = {(o.get("description") or "").split(" ")[0].lower(): o.get("available") for o in m.get("outcomes") or []}
            mtype = m.get("type")
            position = (roster_positions or {}).get(name)
            if mtype in NOVIG_OU_TYPES and m.get("strike") is not None:
                over, under = novig_price_to_american(outcomes.get("over")), novig_price_to_american(outcomes.get("under"))
                if over is None and under is None:
                    continue
                # Barely traded: both asks far apart (implied chances adding
                # well past 100%) -- still Novig's price, just flagged.
                po, pu = outcomes.get("over"), outcomes.get("under")
                thin = bool(po and pu and po + pu > 1.15) or po is None or pu is None
                ou[NOVIG_OU_TYPES[mtype]][team].append({"name": name, "position": position, "line": float(m["strike"]), "over_odds": over, "under_odds": under, "source": "novig", "thin": thin})
            elif mtype in ("TOUCHDOWNS", "FIRST_TOUCHDOWN_SCORER") and name not in (unavailable or ()):
                yes_p = outcomes.get("over") if mtype == "TOUCHDOWNS" else outcomes.get("yes")
                no_p = outcomes.get("under") if mtype == "TOUCHDOWNS" else outcomes.get("no")
                if mtype == "TOUCHDOWNS" and float(m.get("strike") or 0) != 0.5:
                    continue
                odds = novig_price_to_american(yes_p)
                if odds is None or yes_p > TD_YES_MAX[mtype] or (no_p and yes_p + no_p > 1.5):
                    continue  # junk quote (e.g. 99.9c on both sides of a backup TE's First TD)
                game_td_rows.append((mtype, team, yes_p, no_p, {"name": name, "position": position, "best_odds": odds, "best_book": "Novig", "thin": not no_p}))
        # Chances. Most Novig First TD markets (and ~40% of Anytime) are
        # one-sided -- a Yes price but no one selling No -- and used to be
        # dropped, leaving 2-5 First TD prices a game (user, 2026-10-09:
        # "a lot of first TDs not populating"). Now every Yes price is kept:
        #  * First TD is one race per game, so each Yes is de-vigged against
        #    the sum of every player's Yes in that game (never inflated when
        #    the list is short and sums under 1).
        #  * Anytime uses Yes/(Yes+No) when both sides trade; a one-sided
        #    one gets the game's median fair/Yes ratio from the two-sided ones.
        first_sum = sum(y for t, _, y, _, _ in game_td_rows if t == "FIRST_TOUCHDOWN_SCORER")
        ratios = sorted((y / (y + n)) / y for t, _, y, n, _ in game_td_rows if t == "TOUCHDOWNS" and n)
        any_ratio = ratios[len(ratios) // 2] if ratios else 0.9
        for mtype, team, yes_p, no_p, row in game_td_rows:
            if mtype == "FIRST_TOUCHDOWN_SCORER":
                fair = yes_p / max(first_sum, 1.0)
            else:
                fair = yes_p / (yes_p + no_p) if no_p else min(yes_p * any_ratio, 0.99)
            row.update({"fair_odds": novig_price_to_american(fair), "implied_prob": round(fair, 3)})
            (anytime if mtype == "TOUCHDOWNS" else first)[team].append(row)
    for stat in ou:
        for t in ou[stat]:
            ou[stat][t].sort(key=lambda r: -(r["line"] or 0))
    return ou, anytime, first


def _norm_player(name: str) -> str:
    """Letters only, without Jr./Sr./II/III/IV -- the same player however a
    book spells him (normName in common.js does the same on the site)."""
    return "".join(ch for ch in re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (name or "").lower()) if ch.isalpha())


def canonicalize_odds_names(blob: dict, roster_positions: dict | None) -> int:
    """Rewrites every odds row's player name to the site's own spelling.
    Books disagree ("Brian Robinson Jr." on one, "Brian Robinson" on Novig
    and in nflverse), and which book a row comes from can change from one
    build to the next -- so the same player's name flipped, a saved Possible
    Play stopped matching its checkbox, and saving it again listed him twice
    (user 2026-10-11). The site's spelling = the team's own game-log names,
    then any roster / headshot name that only one player in the league has.
    Rows that end up sharing a name on a team keep the first. Returns how
    many names changed."""
    by_team = {t: {_norm_player(n): n for n in names} for t, names in (blob.get("player_game_logs") or {}).items()}
    league, clashes = {}, set()
    for name in list(roster_positions or {}) + list(blob.get("player_headshots") or {}):
        key = _norm_player(name)
        if league.setdefault(key, name) != name:
            clashes.add(key)
    changed = 0

    def fix(team, rows):
        nonlocal changed
        seen, out = set(), []
        for row in rows or []:
            key = _norm_player(row.get("name"))
            site = by_team.get(team, {}).get(key) or (league.get(key) if key not in clashes else None)
            if site and site != row["name"]:
                row["name"] = site
                changed += 1
            if not row.get("position") and roster_positions:
                row["position"] = roster_positions.get(row["name"])
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
        return out

    for field in ("player_td_odds", "player_first_td_odds"):
        for team, rows in (blob.get(field) or {}).items():
            blob[field][team] = fix(team, rows)
    for by_stat in (blob.get("player_prop_markets") or {}).values():
        for team, rows in (by_stat or {}).items():
            by_stat[team] = fix(team, rows)
    return changed


ODDS_OUT_STATUSES = ("out", "doubtful", "injured reserve", "ir", "suspended")


def odds_unavailable_names(injuries_df: pd.DataFrame, week: int, roster_out: dict | None) -> set:
    """Who the TD odds leave off: ruled out on his team's LATEST report up to
    this week (Mon-Wed that is last week's final one), or on reserve / cut
    (roster_out). Never an earlier week's report: Barkley, Out in Weeks 5-6,
    was missing from every Week 7 TD list while FanDuel priced him (the
    owner, 2026-10-26)."""
    out = {r["name"] for rows in (roster_out or {}).values() for r in rows}
    if injuries_df is None or not len(injuries_df):
        return out
    df = injuries_df[injuries_df["week"] <= week]
    latest = df.groupby("team")["week"].transform("max")
    for row in df[df["week"] == latest].itertuples(index=False):
        if isinstance(row.report_status, str) and row.report_status.lower() in ODDS_OUT_STATUSES:
            out.add(row.full_name)
    return out


# Exchanges, where a stale resting order can be the only "price" on a fringe
# player (Jaydon Blue: Novig +100, ProphetX Yes -286, no sportsbook). A row
# needs a sportsbook's price; the exchanges still count toward the best price
# and the two-sided no-vig chance.
TD_EXCHANGES = {"novig", "prophetx", "kalshi", "polymarket_us"}


def book_td_odds(book_odds: dict, roster_teams: dict, roster_positions: dict | None, unavailable) -> dict:
    """{team: [rows]} Anytime TD from SmartStake (every US book), shaped like
    extract_novig_props' rows: the best Over 0.5 price and its book, and a
    no-vig chance -- the median, across books quoting both sides, of
    Yes / (Yes + No); with no two-sided book, the median sportsbook Yes
    chance x 0.9. A player only an exchange prices is left off (TD_EXCHANGES).
    A player's team is whichever side of the game his roster lists; one who
    has been on BOTH teams this season goes to the newer one (roster_teams
    lists each player's teams oldest to newest: Joe Milton III, DAL then
    PHI, was dropped from PHI @ DAL)."""
    by_norm = {}
    for name, teams in (roster_teams or {}).items():
        have = by_norm.setdefault(_norm_player(name), [])
        for t in teams:
            if t in have:
                have.remove(t)
            have.append(t)
    prob = moneyline_to_implied_prob
    out = {}
    for key, game in (book_odds or {}).items():
        away, home = key.split("_", 1)
        for row in (game.get("td") or {}).values():
            name = row.get("name")
            if not name or name in (unavailable or ()):
                continue
            teams = by_norm.get(_norm_player(name), [])
            side = [t for t in teams if t in (away, home)][-1:]  # the newer of the two
            if not side:
                continue
            by_book = {}
            for book, s, _line, odds, _url in row.get("q") or []:
                if book in US_BOOKS and odds:
                    by_book.setdefault(book, {})[s] = odds
            overs = sorted(((b, p["o"]) for b, p in by_book.items() if "o" in p), key=lambda x: prob(x[1]))
            yes = [prob(o) for b, o in overs if b not in TD_EXCHANGES]
            if not yes:
                continue
            best_book, best = overs[0]  # the longest price pays the most
            two = sorted(prob(p["o"]) / (prob(p["o"]) + prob(p["u"])) for p in by_book.values() if "o" in p and "u" in p)
            fair = two[len(two) // 2] if two else min(yes[len(yes) // 2] * 0.9, 0.99)
            out.setdefault(side[0], []).append({
                "name": name, "position": (roster_positions or {}).get(name), "best_odds": int(best),
                "best_book": US_BOOKS[best_book], "fair_odds": novig_price_to_american(fair), "implied_prob": round(fair, 3),
                # FanDuel's own price: the $100 CONTEST's one price for everyone (contest.js).
                "fd": int(by_book["fanduel"]["o"]) if "o" in by_book.get("fanduel", {}) else None,
            })
    return out


def merge_td_odds(book: dict, novig: dict) -> dict:
    """Anytime TD per team: SmartStake's list whenever it prices the team (the
    owner, 2026-10-23: SmartStake "will always reign supreme"; 2026-10-26:
    "reroute ... to smartstake, not novig default"), its own best price and
    chance (Novig is one of its books). Novig's own feed only for a team
    SmartStake has nothing on (no key, a failed fetch)."""
    merged = {}
    for team in set(book or {}) | set(novig or {}):
        rows = (book or {}).get(team) or (novig or {}).get(team) or []
        merged[team] = sorted((dict(r) for r in rows), key=lambda r: -(r.get("implied_prob") or 0))
    return merged


def _last_name(name: str) -> str:
    words = [w for w in (name or "").replace(".", " ").split() if w.lower() not in ("jr", "sr", "ii", "iii", "iv")]
    return _norm_player(words[-1]) if words else ""


def first_td_on_book_list(first: dict, book: dict) -> dict:
    """Novig's First TD rows (SmartStake has no First TD market), kept only
    for players on SmartStake's Anytime list when it prices that team, in
    its spelling; a different first name with the same last name on that
    team is the same player (Novig "Hollywood Brown" = "Marquise Brown").
    Keeps Novig's leftovers off the TD Summary (E.J. Jenkins, released, at
    +900 for PHI, 2026-10-26)."""
    out = {}
    for team, rows in (first or {}).items():
        listed = [r["name"] for r in (book or {}).get(team) or []]
        if not listed:
            out[team] = rows
            continue
        by_norm = {_norm_player(n): n for n in listed}
        by_last = {}
        for n in listed:
            by_last.setdefault(_last_name(n), []).append(n)
        kept = []
        for r in rows:
            same = by_last.get(_last_name(r["name"])) or []
            name = by_norm.get(_norm_player(r["name"])) or (same[0] if len(same) == 1 else None)
            if name:
                kept.append({**r, "name": name})
        out[team] = kept
    return out


def _consensus_line(quotes: list, side: str):
    """The line most US books post for one side (ties: nearest the middle)."""
    lines = [q[2] for q in quotes if q[1] == side and q[0] in US_BOOKS and q[3] and q[2] is not None]
    if not lines:
        return None
    counts = Counter(lines)
    mid = sorted(lines)[len(lines) // 2]
    return sorted(counts, key=lambda ln: (-counts[ln], abs(ln - mid), ln))[0]


def _best_at(quotes: list, side: str, line):
    """The best US-book price for one side at one line (None = any line)."""
    prices = [q[3] for q in quotes if q[1] == side and q[0] in US_BOOKS and q[3] and (line is None or q[2] == line)]
    return min(prices, key=moneyline_to_implied_prob) if prices else None


def apply_book_schedule_lines(schedule: list, book_odds: dict) -> None:
    """Each game's top-level spread/total/moneyline from SmartStake (in place):
    the line most US books post, at the best price there. nflverse's
    games.csv line is only re-scraped a few times a day and sits behind the
    market. A game or market no book lists keeps nflverse's number; Novig's
    own copy rides in game["novig"] (extract_novig_game_lines)."""
    for game in schedule:
        lines = ((book_odds or {}).get(f"{game['away']}_{game['home']}") or {}).get("lines") or {}
        spread = lines.get("spread") or []
        away_line = _consensus_line(spread, "away")
        if away_line is not None:
            away_price, home_price = _best_at(spread, "away", away_line), _best_at(spread, "home", -away_line)
            if away_price and home_price:
                game["spread_line"] = game["away_team_spread"] = away_line
                game["home_team_spread"] = -away_line
                game["away_spread_odds"], game["home_spread_odds"] = away_price, home_price
        total = lines.get("total") or []
        total_line = _consensus_line(total, "o")
        if total_line is not None:
            over, under = _best_at(total, "o", total_line), _best_at(total, "u", total_line)
            if over and under:
                game["total_line"], game["over_odds"], game["under_odds"] = total_line, over, under
        ml = lines.get("ml") or []
        away_ml, home_ml = _best_at(ml, "away", None), _best_at(ml, "home", None)
        if away_ml and home_ml:
            game["away_moneyline"], game["home_moneyline"] = away_ml, home_ml
            game["away_ml_implied_prob"], game["home_ml_implied_prob"] = novig_moneyline_probs(away_ml, home_ml)


LIVE_SITE_DATA_URL = "https://nfl.gmgsports.org/data.json"


_PREVIOUS_SNAPSHOT: list = []  # one successful read is reused for the whole build


def fetch_previous_odds_snapshot() -> dict | None:
    """The deployed site's data.json (the previous build): the odds lock's
    pregame copies, SmartStake's started games and ESPN's ratings when
    ESPN fails. Returns None on ANY failure -- reading the live site is a
    nice-to-have, never allowed to break the build itself."""
    if _PREVIOUS_SNAPSHOT:
        return _PREVIOUS_SNAPSHOT[0]
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; nfl-tool/1.0)"}
        # The live site sits behind the Discord login (nfl_tool/functions/
        # _middleware.js); the build proves itself with a key derived from
        # the bot token, which only CI and Cloudflare hold.
        bot_token = os.environ.get("DISCORD_BOT_TOKEN")
        if bot_token:
            import hashlib
            import hmac
            headers["X-GMG-Build"] = hmac.new(bot_token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        req = urllib.request.Request(LIVE_SITE_DATA_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            _PREVIOUS_SNAPSHOT.append(json.load(resp))
            return _PREVIOUS_SNAPSHOT[0]
    except Exception as e:
        print(f"WARNING: could not fetch previous odds snapshot for fallback ({e}).", file=sys.stderr)
        return None


# Every odds field on a schedule entry (the top-level best-of-books numbers;
# Novig's own copy rides along in game["novig"]).
SCHEDULE_ODDS_FIELDS = (
    "spread_line", "away_team_spread", "home_team_spread", "away_spread_odds", "home_spread_odds",
    "total_line", "over_odds", "under_odds", "away_moneyline", "home_moneyline",
    "away_ml_implied_prob", "home_ml_implied_prob",
)


# A game["novig"] holding only these (or nothing) is the no-pregame-copy fallback.
LOCK_FALLBACK_FIELDS = {"home_team_spread", "away_team_spread", "total_line"}


def lock_started_game_odds(blob: dict, previous: dict | None, model_history: dict) -> list:
    """Once a game kicks off its odds stop moving on the site. Novig (and
    the books) keep quoting IN-GAME lines, and the build was publishing those as
    if they were the pregame number: SF +3.5 / 46.5 turned into "SF -4.5,
    Under 56.5, SF -245" on the Pick Tracker mid-game (user 2026-10-11).

    For every game that has started, the odds are taken from the previous
    build instead of this run's fetch -- but only when that build is known
    to hold pregame numbers: it had already locked the game, or it was
    generated before kickoff. Covers the schedule lines (top-level and
    Novig), and both teams' TD and prop odds (book_odds locks itself, smartstake.lock_started).
    When there's no trustworthy earlier copy (the previous build couldn't
    be read, or predates this feature), Novig's live copy is dropped and the
    spread/total fall back to the line the GMG model locked at kickoff, then
    to the schedule's own closing line. Returns the locked game ids, which
    go into the blob for the next build to trust."""
    now_et = eastern_now()
    previous = previous or {}
    prev_locked = set(previous.get("lines_locked") or [])
    prev_games = {g.get("game_id"): g for g in previous.get("schedule") or []}
    try:
        prev_made = datetime.strptime(previous.get("generated_at") or "", "%Y-%m-%dT%H:%MZ")
    except ValueError:
        prev_made = None
    locked = []
    for game in blob.get("schedule") or []:
        gid = game.get("game_id")
        if not gid or not game_has_started(game, now_et):
            continue
        locked.append(gid)
        if game.get("week") != blob.get("current_week"):
            continue  # earlier weeks already sit on closing lines
        kickoff = kickoff_utc(game)
        prev_game = prev_games.get(gid)
        trusted = prev_game is not None and (gid in prev_locked or (prev_made is not None and kickoff is not None and prev_made < kickoff))
        if trusted:
            for field in SCHEDULE_ODDS_FIELDS:
                if prev_game.get(field) is not None:
                    game[field] = prev_game[field]
            if prev_game.get("novig"):
                game["novig"] = prev_game["novig"]
            else:
                game.pop("novig", None)
            for team in (game["away"], game["home"]):
                for field in ("player_td_odds", "player_first_td_odds"):
                    if isinstance(blob.get(field), dict) and team in (previous.get(field) or {}):
                        blob[field][team] = previous[field][team]
                for stat, by_team in (blob.get("player_prop_markets") or {}).items():
                    prev_rows = ((previous.get("player_prop_markets") or {}).get(stat) or {}).get(team)
                    if prev_rows is not None:
                        by_team[team] = prev_rows
        else:
            game.pop("novig", None)
            entry = model_history.get(gid) or {}
            if entry.get("spread") is not None and entry.get("total") is not None:
                game["novig"] = {"home_team_spread": entry["spread"], "away_team_spread": -entry["spread"], "total_line": entry["total"]}
        # A game locked WITHOUT a pregame copy still has this run's (possibly
        # in-game) numbers in its top-level fields. Until it goes final and
        # the schedule's closing line takes over, show only what is known to
        # be pregame: the locked spread/total, and no moneyline.
        pregame = game.get("novig") or {}
        if set(pregame) <= LOCK_FALLBACK_FIELDS and game.get("status") != "final" and game.get("home_score") is None:
            for field in SCHEDULE_ODDS_FIELDS:
                game[field] = pregame.get(field)
            if pregame.get("home_team_spread") is not None:
                game["spread_line"] = -pregame["home_team_spread"]
    return locked


GMG_HISTORY_PATH = Path(__file__).parent.parent / "model_history" / "gmg_model.json"


def previous_gmg_model() -> dict:
    """Last build's GMG model entries. Two sources, because the record must
    survive a bad day: the deployed data.json (has the freshest projections
    for games that haven't kicked off; three tries) and the repo's own
    model_history/gmg_model.json, which deploy.yml commits whenever a game
    locks or gets graded. A locked entry in the repo file is never replaced
    by an unlocked one."""
    history = {}
    try:
        history = json.loads(GMG_HISTORY_PATH.read_text())
    except (OSError, ValueError):
        pass
    live = {}
    for _ in range(3):
        prev = fetch_previous_odds_snapshot()
        if prev is not None:
            live = prev.get("gmg_model") or {}
            break
    merged = {**history, **live}
    for gid, entry in history.items():
        if entry.get("frozen") and not (live.get(gid) or {}).get("frozen"):
            merged[gid] = entry
    return merged


def save_gmg_history(model: dict) -> None:
    """Only locked entries -- the file then changes a few times a week (a
    game kicks off or goes final), not on every build."""
    locked = {gid: entry for gid, entry in model.items() if entry.get("frozen")}
    GMG_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(GMG_HISTORY_PATH, "w", newline=chr(10)) as f:  # same bytes on Windows and in CI
        f.write(json.dumps(locked, indent=1, sort_keys=True) + chr(10))


# The player over/under markets Novig lists (Player Props page and the
# player card), by the site's stat ids. The site's sections are
# skill-position offense, plus kickers and defenders.
PLAYER_OU_MARKETS = {
    "receiving_yards": "Receiving Yards",
    "receiving_receptions": "Receptions",
    "receiving_longestReception": "Longest Reception",
    "rushing_yards": "Rushing Yards",
    "rushing_attempts": "Rush Attempts",
    "rushing_longestRush": "Longest Rush",
    "rushing_touchdowns": "Rushing TDs",
    "passing_yards": "Passing Yards",
    "passing_attempts": "Pass Attempts",
    "passing_completions": "Completions",
    "passing_interceptions": "INTs Thrown",
    "passing_longestCompletion": "Longest Completion",
    "passing_touchdowns": "Passing TDs",
    "rushing+receiving_yards": "Rush + Rec Yards",
    "passing+rushing_yards": "Pass + Rush Yards",
    "fantasyScore": "Fantasy Score",
    # Kickers and defenders.
    "kicking_points": "Kicking Points",
    "field_goals_made": "FGs Made",
    "defense_tackles_assists": "Tackles + Ast",
}


def extract_novig_game_lines(novig_games: dict) -> dict:
    """Novig's main (consensus) spread, total and moneyline per game, with
    Novig's own prices -- same field names as a schedule row, keyed
    "AWAY_HOME". Straight from Novig's feed (every build), so the Lines
    tiles and the Pick Tracker's frozen price are Novig's real current number."""
    out = {}
    for (away, home), markets in novig_games.items():
        odds = {}
        for m in markets:
            if not m.get("is_consensus") or m.get("player"):
                continue
            mtype = m.get("type")
            outs = m.get("outcomes") or []
            if mtype == "SPREAD":
                for o in outs:
                    sym = _novig_team(o.get("competitor"))
                    parts = (o.get("description") or "").split()
                    try:
                        line = float(parts[-1])
                    except (ValueError, IndexError):
                        continue
                    side = "away" if sym == away else "home" if sym == home else None
                    if side:
                        odds[f"{side}_team_spread"] = line
                        odds[f"{side}_spread_odds"] = novig_price_to_american(o.get("available"))
            elif mtype == "TOTAL" and m.get("strike") is not None:
                odds["total_line"] = float(m["strike"])
                for o in outs:
                    word = (o.get("description") or "").split(" ")[0].lower()
                    if word in ("over", "under"):
                        odds[f"{word}_odds"] = novig_price_to_american(o.get("available"))
            elif mtype == "MONEY":
                prices = {}
                for o in outs:
                    sym = _novig_team(o.get("competitor"))
                    side = "away" if sym == away else "home" if sym == home else None
                    if side:
                        odds[f"{side}_moneyline"] = novig_price_to_american(o.get("available"))
                        prices[side] = o.get("available")
                if prices.get("away") and prices.get("home"):
                    tot = prices["away"] + prices["home"]
                    odds["away_ml_implied_prob"] = round(prices["away"] / tot, 3)
                    odds["home_ml_implied_prob"] = round(prices["home"] / tot, 3)
        # A market only counts when Novig prices BOTH sides -- otherwise the
        # whole market falls back to best-of-books, so a line and a price
        # from two different places never get paired.
        groups = {
            "spread": ["away_team_spread", "home_team_spread", "away_spread_odds", "home_spread_odds"],
            "total": ["total_line", "over_odds", "under_odds"],
            "moneyline": ["away_moneyline", "home_moneyline", "away_ml_implied_prob", "home_ml_implied_prob"],
        }
        clean = {}
        for fields in groups.values():
            if all(odds.get(f) is not None for f in fields):
                clean.update({f: odds[f] for f in fields})
        if clean:
            out[f"{away}_{home}"] = clean
    return out
