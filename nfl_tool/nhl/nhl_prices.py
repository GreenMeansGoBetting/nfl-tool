"""Prices for the NHL build: the Novig feed (game lines, player props, saves),
the last build's copy from the live site, lines locked at puck drop, every
book's best price, and closing-line value (CLV).

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nhl_games import LINE_FIELDS, USER_AGENT, _request, plain

sys.path.insert(1, str(Path(__file__).resolve().parent.parent))  # nfl_tool/, for smartstake.py
import smartstake  # noqa: E402

NOVIG_EVENTS_URL = "https://api.novig.us/v3/public/catalog/events?league=NHL"
NOVIG_GRAPHQL_URL = "https://api.novig.us/v1/graphql"
NOVIG_QUERY_PATH = Path(__file__).parent.parent / "novig_event_markets.graphql"
# Same market filter the NFL and NBA builds send (build_stats.py NOVIG_MARKET_FILTER).
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
LIVE_DATA_URL = "https://nfl.gmgsports.org/nhl/data.json"
LIVE_SHOTS_URL = "https://nfl.gmgsports.org/nhl/shots.json"
LIVE_CREASE_URL = "https://nfl.gmgsports.org/nhl/crease.json"
LIVE_GOALS_URL = "https://nfl.gmgsports.org/nhl/goals.json"
LIVE_POINTS_URL = "https://nfl.gmgsports.org/nhl/points.json"
LIVE_ICEBREAKER_URL = "https://nfl.gmgsports.org/nhl/icebreaker.json"
LIVE_LINES_URL = "https://nfl.gmgsports.org/nhl/lines.json"
LIVE_SAVES_URL = "https://nfl.gmgsports.org/nhl/saves.json"


def unlisted_priced(games: list, lineups: dict, player_odds: dict, now_utc: datetime) -> list:
    """The tripwire: players the book has a shots-on-goal line for in a game
    not started yet who are on none of the prop pages' lists. Each one is a
    player a member can bet and can't find (version.json `nhl.unlisted`)."""
    out = []
    for g in games:
        if g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        listed = {p["id"] for team in (g["away"], g["home"]) for p in lineups.get(team) or []}
        for pid, odds in (player_odds.get(g["game_id"]) or {}).items():
            if odds.get("sog") and pid not in listed:
                out.append({"game": g["game_id"], "team": odds.get("team"), "id": pid, "name": odds.get("name")})
    return out


def price_to_american(p):
    """Novig prices an outcome as the cost of a $1 contract (0.535 = 53.5%)."""
    if p is None or p <= 0 or p >= 1:
        return None
    return int(round(-100 * p / (1 - p))) if p >= 0.5 else int(round(100 * (1 - p) / p))


def lines_from_event(ev: dict) -> dict:
    """One Novig event's main lines: the moneyline, the puck line (the
    "spread", almost always 1.5) and the total."""
    sides = {ev["game"]["awayTeam"]["symbol"]: "away", ev["game"]["homeTeam"]["symbol"]: "home"}
    lines = {}
    for m in ev.get("markets") or []:
        if not m.get("is_consensus") or m.get("player"):
            continue
        outs = m.get("outcomes") or []
        if m.get("type") == "SPREAD":
            for o in outs:
                side = sides.get((o.get("competitor") or {}).get("symbol"))
                try:
                    line = float((o.get("description") or "").split()[-1])
                except (ValueError, IndexError):
                    continue
                if side:
                    lines[f"{side}_team_spread"] = line
                    lines[f"{side}_spread_odds"] = price_to_american(o.get("available"))
        elif m.get("type") == "TOTAL" and m.get("strike") is not None:
            lines["total_line"] = float(m["strike"])
            for o in outs:
                word = (o.get("description") or "").split(" ")[0].lower()
                if word in ("over", "under"):
                    lines[f"{word}_odds"] = price_to_american(o.get("available"))
        elif m.get("type") == "MONEY":
            prices = {}
            for o in outs:
                side = sides.get((o.get("competitor") or {}).get("symbol"))
                if side:
                    lines[f"{side}_moneyline"] = price_to_american(o.get("available"))
                    prices[side] = o.get("available")
            if prices.get("away") and prices.get("home"):
                total = prices["away"] + prices["home"]
                lines["away_ml_implied_prob"] = round(prices["away"] / total, 3)
                lines["home_ml_implied_prob"] = round(prices["home"] / total, 3)
    return lines


# Novig's player markets, as the site names them. The main (consensus) line of
# each becomes a row on the player card; goals at 0.5 is the anytime goal.
PLAYER_OU_MARKETS = {"SHOTS_ON_GOAL": "sog", "POINTS": "points", "ASSISTS": "assists"}
# Highest believable Yes price (same guard as the NFL build's TD markets).
GOAL_YES_MAX = 0.95
# Novig's first-goal book is mostly placeholder asks: on 2026-10-13 it quoted
# 27 of 31 skaters in a game at 21-27% to score first, depth defensemen
# included, with nobody on the other side. A player can't score first without
# scoring, so a one-sided first-goal price is only believed when it is at
# most this share of his own anytime-goal price.
FIRST_GOAL_MAX_SHARE = 0.5


def player_finder(skaters: dict, goalies: dict):
    """Returns find(team, name) -> the NHL's player id or None. Books spell
    names their own way, so after an exact match (accents dropped) it tries
    the same last name and first initial on that team, then a name only one
    player in the league has (a player who just changed teams)."""
    exact, loose, league = {}, {}, {}
    for pid, p in {**goalies, **skaters}.items():
        name = plain(p["name"])
        first, _, last = name.partition(" ")
        exact.setdefault((p["team"], name), set()).add(pid)
        loose.setdefault((p["team"], last, first[:1]), set()).add(pid)
        league.setdefault(name, set()).add(pid)

    def find(team, name):
        name = plain(name)
        first, _, last = name.partition(" ")
        for ids in (exact.get((team, name)), loose.get((team, last, first[:1])), league.get(name)):
            if ids:
                # Two players it could be (Vancouver has had two Elias Petterssons): no guess.
                return next(iter(ids)) if len(ids) == 1 else None
        return None

    return find


def player_odds_from_event(ev: dict, team_of_name, find) -> dict:
    """{player id: odds} from one Novig event. Main lines only for the
    over/unders; the other shots-on-goal and goals lines ride along as
    ladders (sog_alts, goal_alts). Like the NFL build's TD odds, one-sided
    prices are kept and junk quotes dropped; a first-goal price also has to
    make sense next to the player's own anytime price (FIRST_GOAL_MAX_SHARE)."""
    out, goal_rows, first_rows = {}, [], []

    def entry(m):
        player = m.get("player") or {}
        comps = player.get("player_competitors") or []
        team = team_of_name((comps[0].get("competitor") or {}).get("name")) if comps else None
        pid = find(team, player.get("full_name")) if team else None
        return out.setdefault(pid, {"name": player.get("full_name"), "team": team}) if pid else None

    for m in ev.get("markets") or []:
        if not m.get("player"):
            continue
        kind = m.get("type")
        prices = {(o.get("description") or "").split(" ")[0].lower(): o.get("available") for o in m.get("outcomes") or []}
        strike = m.get("strike")
        if kind in PLAYER_OU_MARKETS and strike is not None:
            over, under = prices.get("over"), prices.get("under")
            if m.get("is_consensus"):
                if price_to_american(over) is None and price_to_american(under) is None:
                    continue
                row = entry(m)
                if row is not None:
                    # Barely traded: one side missing, or the two asks adding well past 100%.
                    thin = not over or not under or over + under > 1.15
                    row[PLAYER_OU_MARKETS[kind]] = {"line": float(strike), "over": price_to_american(over), "under": price_to_american(under), "chance": round(over / (over + under), 3) if over and under else None, "thin": thin}
            elif kind == "SHOTS_ON_GOAL" and price_to_american(over) is not None:
                row = entry(m)
                if row is not None:
                    row.setdefault("sog_alts", []).append([float(strike), price_to_american(over)])
        elif kind == "PLAYER_GOALS" and strike is not None:
            yes, no = prices.get("over"), prices.get("under")
            if price_to_american(yes) is None:
                continue
            if float(strike) != 0.5:
                row = entry(m)
                if row is not None:
                    row.setdefault("goal_alts", []).append([float(strike), price_to_american(yes)])
            elif m.get("is_consensus") and yes <= GOAL_YES_MAX and not (no and yes + no > 1.5):
                row = entry(m)
                if row is not None:
                    row["goal"] = {"odds": price_to_american(yes), "no_odds": price_to_american(no), "thin": not no}
                    goal_rows.append((row["goal"], yes, no))
        elif kind == "FIRST_GOAL_SCORER" and m.get("is_consensus"):
            yes, no = prices.get("yes"), prices.get("no")
            if price_to_american(yes) is None or (no and yes + no > 1.5):
                continue
            row = entry(m)
            if row is not None:
                first_rows.append((row, yes, no))

    # Chances, once the whole game is read: Yes/(Yes+No) when both sides
    # trade; a one-sided price gets the game's median fair/Yes ratio.
    def fair(rows):
        ratios = sorted((yes / (yes + no)) / yes for _, yes, no in rows if no)
        typical = ratios[len(ratios) // 2] if ratios else 0.9
        return lambda yes, no: yes / (yes + no) if no else min(yes * typical, 0.99)

    chance = fair(goal_rows)
    anytime_yes = {}
    for goal, yes, no in goal_rows:
        goal["chance"] = round(chance(yes, no), 3)
        anytime_yes[id(goal)] = yes
    chance = fair(first_rows)
    kept = []
    for row, yes, no in first_rows:
        ceiling = anytime_yes.get(id(row.get("goal")))
        if not no and (ceiling is None or yes > FIRST_GOAL_MAX_SHARE * ceiling):
            continue  # a placeholder ask, not a price
        row["first_goal"] = {"odds": price_to_american(yes), "thin": not no}
        kept.append((row["first_goal"], chance(yes, no)))
    # One goal comes first: the chances can add up to less than 1 (not every
    # player is priced) but never more.
    over = max(sum(c for _, c in kept), 1.0)
    for first, c in kept:
        first["chance"] = round(c / over, 3)
    for row in out.values():
        for key in ("sog_alts", "goal_alts"):
            if key in row:
                row[key].sort()
    # A player whose only quote was dropped has nothing left but his name.
    return {pid: row for pid, row in out.items() if len(row) > 2}


# Novig's goalie saves book is thin: often the line with one price, or none
# yet. A lone ask sits about this far above the fair price (where both sides
# trade, the two asks add to about 1.05).
SAVES_OVERROUND = 1.05
# The furthest a price can pull the line off 50/50: a thin ask is not a forecast.
SAVES_CHANCE_RANGE = (0.35, 0.65)


def saves_over_chance(over, under) -> float:
    """The chance the book gives the over at its main line, its cut taken
    out, from Novig's prices (0-1; either can be missing)."""
    over = over if over and 0 < over < 1 else None
    under = under if under and 0 < under < 1 else None
    if over and under and over + under > 1.5:
        over = under = None  # junk quotes (99 cents a side)
    if over and under:
        chance = over / (over + under)
    elif over:
        chance = over / SAVES_OVERROUND
    elif under:
        chance = 1 - under / SAVES_OVERROUND
    else:
        chance = 0.5
    return round(min(SAVES_CHANCE_RANGE[1], max(SAVES_CHANCE_RANGE[0], chance)), 3)


def saves_lines_from_event(ev: dict, team_of_name, find) -> dict:
    """{team: [goalie]} for every goalie Novig lists a main saves line for:
    {"id" (None for a goalie who hasn't played this season), "name", "line",
    "over", "under", "chance" (of the over, the cut taken out), "thin" (a
    side isn't priced), "alts" ([line, over price] for its other lines)}.
    The line is kept even with no price on it: it still says where the
    market is."""
    out = {}
    for m in ev.get("markets") or []:
        player = m.get("player") or {}
        if m.get("type") != "SAVES" or not player.get("full_name") or m.get("strike") is None:
            continue
        comps = player.get("player_competitors") or []
        team = team_of_name((comps[0].get("competitor") or {}).get("name")) if comps else None
        if not team:
            continue
        name = player["full_name"]
        row = out.setdefault(team, {}).setdefault(plain(name), {"id": find(team, name) if find else None, "name": name, "alts": []})
        prices = {(o.get("description") or "").split(" ")[0].lower(): o.get("available") for o in m.get("outcomes") or []}
        over, under = prices.get("over"), prices.get("under")
        if m.get("is_consensus"):
            row.update(line=float(m["strike"]), over=price_to_american(over), under=price_to_american(under), chance=saves_over_chance(over, under))
            row["thin"] = row["over"] is None or row["under"] is None
        elif price_to_american(over) is not None:
            row["alts"].append([float(m["strike"]), price_to_american(over)])
    listed = {}
    for team, rows in out.items():
        for row in rows.values():
            if "line" in row:
                row["alts"].sort()
                listed.setdefault(team, []).append(row)
    return listed


def fetch_novig_lines(games: list, teams: dict, find=None) -> tuple:
    """({game_id: lines}, {game_id: {player id: odds}}, {game_id: {team:
    [goalie saves lines]}}, debug). Pregame events only -- Novig keeps
    quoting in-game lines after puck drop, and those must never be shown as
    the line (the NFL site learned that on 2026-10-11). Never raises."""
    debug = {"events": 0, "matched": 0, "players": 0, "saves": 0, "error": None}
    out, players, saves = {}, {}, {}
    team_of_name = team_namer(teams)
    try:
        query = NOVIG_QUERY_PATH.read_text(encoding="utf-8").rstrip("\n")
        by_matchup = {}
        for g in games:
            by_matchup.setdefault((plain(teams[g["away"]]["mascot"]), plain(teams[g["home"]]["mascot"])), []).append(g)
        events = [e for e in _request(NOVIG_EVENTS_URL).get("items", []) if e.get("status") == "OPEN_PREGAME" and " @ " in (e.get("description") or "")]
        debug["events"] = len(events)
        for e in events:
            away_name, home_name = (plain(part) for part in e["description"].split(" @ ", 1))
            match = next((k for k in by_matchup if away_name.endswith(k[0]) and home_name.endswith(k[1])), None)
            if not match:
                continue
            # Same two teams can meet twice in the window: take the game closest to this event's start.
            starts = datetime.fromtimestamp(e["startsTs"] / 1000, tz=timezone.utc).replace(tzinfo=None)
            game = min(by_matchup[match], key=lambda g: abs(datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") - starts))
            if abs(datetime.strptime(game["start_utc"], "%Y-%m-%dT%H:%MZ") - starts) > timedelta(hours=12):
                continue
            resp = _request(NOVIG_GRAPHQL_URL, {
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
            lines = lines_from_event(rows[0])
            if lines:
                out[game["game_id"]] = lines
                debug["matched"] += 1
            if find:
                odds = player_odds_from_event(rows[0], team_of_name, find)
                goalie_lines = saves_lines_from_event(rows[0], team_of_name, find)
                if goalie_lines:
                    saves[game["game_id"]] = goalie_lines
                    debug["saves"] += sum(len(listed) for listed in goalie_lines.values())
                # A goalie the site knows gets his saves line on the player card too.
                for team, listed in goalie_lines.items():
                    for row in listed:
                        if row["id"]:
                            card = odds.setdefault(row["id"], {"name": row["name"], "team": team})
                            card["saves"] = {key: row[key] for key in ("line", "over", "under", "chance", "thin")}
                            if row["alts"]:
                                card["saves_alts"] = row["alts"]
                if odds:
                    players[game["game_id"]] = odds
                    debug["players"] += len(odds)
    except Exception as ex:  # network, JSON, or a changed query -- the page just shows no lines
        debug["error"] = str(ex)
        print(f"WARNING: Novig NHL fetch failed ({ex}).", file=sys.stderr)
    return out, players, saves, debug


def team_namer(teams: dict):
    """Returns f(a book's team name) -> the NHL abbreviation ("Detroit Red Wings" -> DET)."""
    by_mascot = {plain(t["mascot"]): abbr for abbr, t in teams.items()}
    return lambda name: next((abbr for mascot, abbr in by_mascot.items() if plain(name).endswith(mascot)), None)


def fetch_previous(url: str = LIVE_DATA_URL) -> dict | None:
    """The deployed nhl/data.json or shots.json (behind the member login; the
    build proves itself the same way build_stats.py does). None on any failure."""
    try:
        headers = {"User-Agent": USER_AGENT}
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if token:
            headers["X-GMG-Build"] = hmac.new(token.encode(), b"gmg-build-v1", hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as resp:
            return json.load(resp)
    except Exception as e:
        print(f"NOTE: no previous {url.rsplit('/', 1)[-1]} to carry locked numbers from ({e}).", file=sys.stderr)
        return None


def apply_lines(games: list, novig: dict, previous: dict | None, now_utc: datetime) -> None:
    """Fresh Novig lines for games that haven't started; a game that has
    started keeps whatever the last build before puck drop stored."""
    prev = {g["game_id"]: g for g in (previous or {}).get("schedule") or []}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        source = prev.get(g["game_id"], {}) if started else novig.get(g["game_id"]) or prev.get(g["game_id"], {})
        for field in LINE_FIELDS:
            if source.get(field) is not None:
                g[field] = source[field]
        g["lines_locked"] = started


def locked_player_odds(games: list, fresh: dict, previous: dict | None, now_utc: datetime) -> dict:
    """{game_id: {player id: odds}} for the games on the schedule, under the
    same lock as the game lines: a game that has started keeps the player
    odds of the last build before puck drop, never this run's."""
    prev = (previous or {}).get("player_odds") or {}
    out = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        odds = prev.get(g["game_id"]) if started else fresh.get(g["game_id"]) or prev.get(g["game_id"])
        if odds:
            out[g["game_id"]] = odds
    return out


def decimal_odds(price) -> float:
    return 1 + price / 100 if price > 0 else 1 + 100 / -price


def best_book_prices(player_odds: dict, book_odds: dict | None, games: list) -> dict:
    """player_odds with each main-line price swapped for the best price any US
    book (SmartStake) quotes at the SAME line, when it beats Novig's (the owner,
    2026-10-17: "we should be tracking via the best price available -- bettors
    should be line shopping anyway"). Every edge, play and graded record reads
    these prices, so they are all figured on the price a bettor can actually
    get. The book's id rides along (`over_book`, `under_book`; goal `book`);
    Novig's own price stays as `nv_*`. The chances are the model's or Novig's
    fair chance and are left alone. A started game's book_odds are locked
    (smartstake.lock_started), so this is the same price all night.
    Idempotent: a locked game's player_odds were already swapped."""
    if not book_odds:
        return player_odds
    keys = {g["game_id"]: f"{g['away']}_{g['home']}" for g in games}
    out = {}
    for gid, players in player_odds.items():
        props = ((book_odds.get(keys.get(gid, "")) or {}).get("props")) or {}
        if not props:
            out[gid] = players
            continue
        swapped = {}
        for pid, entry in players.items():
            entry = dict(entry)

            def best(stat, side, line):
                found = [q for q in (((props.get(stat) or {}).get(pid) or {}).get("q") or [])
                         if q[1] == side and q[2] == line and q[3] is not None and q[0] not in smartstake.PICKEM_BOOKS]
                return max(found, key=lambda q: decimal_odds(q[3])) if found else None

            for stat, key in (("sog", "sog"), ("points", "points"), ("saves", "saves")):
                m = entry.get(key)
                if not m or m.get("line") is None:
                    continue
                m = dict(m)
                for side, field in (("o", "over"), ("u", "under")):
                    q = best(stat, side, m["line"])
                    base = m.get(f"nv_{field}", m.get(field))
                    m[f"nv_{field}"] = base
                    if q and (base is None or decimal_odds(q[3]) > decimal_odds(base)):
                        m[field], m[f"{field}_book"] = q[3], q[0]
                entry[key] = m
            goal = entry.get("goal")
            if goal and goal.get("odds") is not None:
                goal = dict(goal)
                q = best("goals", "o", 0.5)
                base = goal.get("nv_odds", goal["odds"])
                goal["nv_odds"] = base
                if q and decimal_odds(q[3]) > decimal_odds(base):
                    goal["odds"], goal["book"] = q[3], q[0]
                entry["goal"] = goal
            swapped[pid] = entry
        out[gid] = swapped
    return out


def best_saves_prices(saves_lines: dict, book_odds: dict | None, games: list) -> dict:
    """best_book_prices for Novig's goalie saves lines ({game id: {team:
    [goalie]}}, what King of the Crease and the Saves page read): each main
    line's over / under swapped for the best US book price at the SAME line
    (`over_book`, `under_book`; Novig's stays as `nv_*`). The fair `chance`
    (King of the Crease's market number) stays Novig's, so the promo is
    unchanged; only the price a bettor gets moves. A goalie the site doesn't
    know (`id` None) keeps Novig's price."""
    if not book_odds:
        return saves_lines
    keys = {g["game_id"]: f"{g['away']}_{g['home']}" for g in games}
    out = {}
    for gid, teams in saves_lines.items():
        priced = ((((book_odds.get(keys.get(gid, "")) or {}).get("props")) or {}).get("saves")) or {}
        out[gid] = {}
        for team, listed in teams.items():
            rows = []
            for row in listed:
                row = dict(row)
                quotes = ((priced.get(str(row["id"])) or {}).get("q") or []) if row.get("id") is not None else []
                for side, field in (("o", "over"), ("u", "under")):
                    base = row.get(f"nv_{field}", row.get(field))
                    row[f"nv_{field}"] = base
                    found = [q for q in quotes if q[1] == side and q[2] == row.get("line") and q[3] is not None and q[0] not in smartstake.PICKEM_BOOKS]
                    best = max(found, key=lambda q: decimal_odds(q[3])) if found else None
                    if best and (base is None or decimal_odds(best[3]) > decimal_odds(base)):
                        row[field], row[f"{field}_book"] = best[3], best[0]
                rows.append(row)
            out[gid][team] = rows
    return out


# ---- the Shots record ----
def break_even(american: int) -> float:
    """The chance a price needs to break even (-150 -> 0.6, +150 -> 0.4)."""
    return -american / (100 - american) if american < 0 else 100 / (american + 100)


# ---- closing line value: Novig's own prices (the owner, 2026-10-22) ----
# Every record grades wins and units at the best price across books
# (best_book_prices, from 2026-10-17), but closing line value compared the best
# price at the first look with the best across many more books at the lock,
# which reads "drifted" by construction (Goals: 145 drifted, 6 shortened). So
# CLV reads Novig alone (an exchange: the cleanest single read of the market),
# both sides with the cut taken out, at the first look and at the lock. Each
# board row carries `nv` (Novig's line and prices at this build) and `first_nv`
# (the first ones the site saw, carried from the live file); each record row
# saves both in its last column, `nv` (CLV_COLS). Records before
# BEST_PRICES_FROM were Novig's prices at both ends and count as they are;
# rows between that and the `nv` column have nothing to compare and are left out.
BEST_PRICES_FROM = "2026-10-17"
CLV_COLS = {"ou": ("first_line", "first_over", "first_under", "over", "under"), "goal": ("first_yes", "first_no", "yes", "no")}


def novig_prices(market: dict | None) -> dict | None:
    """Novig's own main line and prices {line, over, under} from a player_odds
    or saves entry (best_book_prices keeps Novig's as nv_*)."""
    if not market or market.get("line") is None:
        return None
    return {"line": market["line"], "over": market.get("nv_over", market.get("over")), "under": market.get("nv_under", market.get("under"))}


def novig_goal_prices(goal: dict | None) -> dict | None:
    """Novig's own anytime goal prices {yes, no} (the No is always Novig's)."""
    if not goal or goal.get("odds") is None:
        return None
    return {"yes": goal.get("nv_odds", goal["odds"]), "no": goal.get("no_odds")}


def clv_move(first: dict | None, lock: dict | None, side: str, other: str) -> tuple:
    """How far Novig moved toward the play from the first look to the lock:
    (move, same line?). On the same line, the play side's chance with the cut
    taken out (both sides priced at both times; else each time's own price),
    lock minus first, in points (+ = the market moved to the model). A moved
    line counts by direction only: an over whose line went up (+1), an under
    whose line went down. (None, False) when either look has no price."""
    if not first or not lock:
        return None, False
    if first.get("line") != lock.get("line"):
        if first.get("line") is None or lock.get("line") is None:
            return None, False
        return (lock["line"] - first["line"]) * (1 if side == "over" else -1), False
    if first.get(side) is None or lock.get(side) is None:
        return None, False
    both = all(x.get(other) is not None for x in (first, lock))
    chance = lambda x: break_even(x[side]) / (break_even(x[side]) + break_even(x[other])) if both else break_even(x[side])
    return chance(lock) - chance(first), True


def clv_tally() -> dict:
    return {"plays": 0, "points": 0.0, "priced": 0, "shortened": 0, "drifted": 0, "since": None, "book": "novig"}


def clv_add(clv: dict, date: str, moved, same_line: bool) -> None:
    if moved is None:
        return
    clv["plays"] += 1
    clv["since"] = min(clv["since"] or date, date)
    if same_line:
        clv["priced"] += 1
        clv["points"] += moved
    if abs(moved) > 0.0005:
        clv["shortened" if moved > 0 else "drifted"] += 1


def clv_done(clv: dict) -> dict:
    clv["points"] = round(clv["points"] / clv["priced"], 4) if clv["priced"] else None  # average, per play on an unmoved line
    return clv


def ou_looks(date: str, nv, line, over, under, first_line, first_over, first_under) -> tuple:
    """(first, lock) Novig looks for an over / under record row: its `nv`
    column, or before BEST_PRICES_FROM the row's own prices (Novig's then)."""
    if nv and nv[0] is not None:
        fl, fo, fu, lo, lu = nv
        return {"line": fl, "over": fo, "under": fu}, {"line": line, "over": lo, "under": lu}
    if date < BEST_PRICES_FROM and first_line is not None:
        return {"line": first_line, "over": first_over, "under": first_under}, {"line": line, "over": over, "under": under}
    return None, None


def ou_nv_col(row: dict) -> list:
    """A record row's `nv` column for an over / under (CLV_COLS["ou"])."""
    first, lock = row.get("first_nv") or {}, row.get("nv") or {}
    return [first.get("line"), first.get("over"), first.get("under"), lock.get("over"), lock.get("under")]
