"""One-off look at what the SmartStake Odds API returns, before the site uses it.

Runs in GitHub Actions (.github/workflows/smartstake-probe.yml), the only
place SMARTSTAKE_API_KEY exists. Writes tools/smartstake_probe_result.json
with COUNTS and NAMES only (books, leagues, market keys, quote fields, how
team and player names are spelled): never prices, never the key. The
workflow commits that file so it can be read from the repo.

Docs: https://www.smartstake.app/api (every request needs Accept-Encoding: gzip).
"""
import collections
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api.server.smartstake.ca"
OUT = Path(__file__).with_name("smartstake_probe_result.json")


def get(path, **params):
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(f"{BASE}{path}{'?' + query if query else ''}", headers={
        "Authorization": f"Bearer {os.environ['SMARTSTAKE_API_KEY']}",
        "Accept-Encoding": "gzip",
        "User-Agent": "gmg-sports-probe",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            body = gzip.decompress(body)
        except OSError:
            pass
        return {"http_error": e.code, "body": body.decode("utf-8", "replace")[:300]}


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in value.items()}
    return type(value).__name__


def league_snapshot(league, max_pages=4):
    quotes, cursor, pages = [], None, 0
    while pages < max_pages:
        page = get("/v1/odds", league=league, cursor=cursor)
        pages += 1
        if "http_error" in page:
            return {"error": page}, quotes
        quotes += page.get("data") or []
        cursor = page.get("next_cursor")
        if not cursor:
            break
        time.sleep(7)  # 10 snapshot pages a minute
    return {"pages_read": pages, "more_pages": bool(cursor)}, quotes


def summarize(quotes):
    by_book = collections.Counter(q.get("book") for q in quotes)
    by_market = collections.Counter(q.get("market_key") for q in quotes)
    market_names = {}
    for q in quotes:
        market_names.setdefault(q.get("market_key"), q.get("market_name"))
    books_per_market = collections.defaultdict(set)
    for q in quotes:
        books_per_market[q.get("market_key")].add(q.get("book"))
    players = sorted({q["participant"] for q in quotes if q.get("player_id") and q.get("participant")})
    teams = sorted({t for q in quotes for t in (q.get("home"), q.get("away")) if t})
    link_hosts = {}
    for q in quotes:
        if q.get("bet_url") and q.get("book") not in link_hosts:
            link_hosts[q["book"]] = urllib.parse.urlsplit(q["bet_url"]).netloc
    sample = next((q for q in quotes if q.get("player_id")), quotes[0] if quotes else {})
    return {
        "quotes": len(quotes),
        "events": len({q.get("event_id") for q in quotes}),
        "quotes_by_book": dict(by_book.most_common()),
        "markets": {k: {"name": market_names[k], "quotes": n, "books": sorted(b for b in books_per_market[k] if b)}
                    for k, n in by_market.most_common()},
        "sides": dict(collections.Counter(q.get("side") for q in quotes)),
        "alternate_quotes": sum(1 for q in quotes if q.get("alternate")),
        "live_quotes": sum(1 for q in quotes if q.get("live")),
        "with_bet_url": sum(1 for q in quotes if q.get("bet_url")),
        "with_max_bet": sum(1 for q in quotes if q.get("max_bet") is not None),
        "bet_link_host_by_book": link_hosts,
        "team_spellings": teams,
        "player_count": len(players),
        "player_spellings_sample": players[:60],
        "quote_fields": shape(sample),
        "label_examples": sorted({str(q.get("label")) for q in quotes})[:40],
    }


def first_basket_variant(max_pages=8, **params):
    """Books on the 1st Points Scorer market for one way of asking."""
    quotes, cursor, pages = [], None, 0
    while pages < max_pages:
        page = get("/v1/odds", league="nba", cursor=cursor, **params)
        pages += 1
        if "http_error" in page:
            return {"error": page}
        quotes += [q for q in page.get("data") or [] if q.get("market_key") == "basketball_first_points_scorer"
                   or "points scorer" in str(q.get("market_name") or "").lower()]
        cursor = page.get("next_cursor")
        if not cursor:
            break
        time.sleep(7)
    books = collections.defaultdict(collections.Counter)
    for q in quotes:
        books[q.get("book")][f"{q.get('side')}|alt={q.get('alternate')}|live={q.get('live')}|key={q.get('market_key')}"] += 1
    return {"pages": pages, "more_pages": bool(cursor), "quotes": len(quotes), "books": {b: dict(c) for b, c in sorted(books.items())}}


def first_basket_look():
    """NBA First Basket (2026-10-21): the Odds Screen shows DraftKings, FanDuel
    and others on 1st Points Scorer, but the build's request (state=NJ,
    alternate=false, live=false) got only Fliff, Novig, ProphetX and Stake.
    Asks each way, dropping one filter at a time. Names and counts only."""
    key = "basketball_first_points_scorer"
    return {
        "build_request": first_basket_variant(market=key, alternate="false", live="false", state="NJ"),
        "no_state": first_basket_variant(market=key, alternate="false", live="false"),
        "no_alternate_filter": first_basket_variant(market=key, live="false", state="NJ"),
        "market_only": first_basket_variant(market=key),
        "other_state_PA": first_basket_variant(market=key, alternate="false", live="false", state="PA"),
    }


def first_td_look():
    """NFL First TD (2026-11-24, the owner: "smartstake most certainly has FIRST TD market"),
    for the $100 CONTEST's First TD picks at FanDuel's price. The 2026-10-21 market list had no
    NFL first-scorer key, but the NBA's 1st Points Scorer only showed the big books as alternate
    quotes. Today's market list, every market whose key or name says first / 1st / scorer, which
    books quote it and how (side, alternate), with and without the alternate filter. Names and
    counts only, never prices."""
    out = {}
    listed = get("/v1/markets", league="nfl")
    keys = [m.get("key") for m in (listed.get("data") or []) if isinstance(m, dict)]
    out["market_list_count"] = len(keys)
    out["market_list_first"] = [k for k in keys if k and ("first" in k or "1st" in k or "scorer" in k)
                                and "first_downs" not in k]
    def scan(**params):
        seen = collections.defaultdict(collections.Counter)
        names = {}
        quotes, cursor, pages = 0, None, 0
        while pages < 30:
            page = get("/v1/odds", league="nfl", cursor=cursor, **params)
            pages += 1
            if "http_error" in page:
                return {"error": page}
            for q in page.get("data") or []:
                key = str(q.get("market_key") or "")
                name = str(q.get("market_name") or "")
                low = f"{key} {name}".lower()
                if ("first" in low or "1st" in low or "scorer" in low) and "first_downs" not in key and "first downs" not in low                         and "half_1" not in key and "quarter_1" not in key:
                    quotes += 1
                    names[key] = name
                    seen[key][f"{q.get('book')}|{q.get('side')}|alt={q.get('alternate')}"] += 1
            cursor = page.get("next_cursor")
            if not cursor:
                break
            time.sleep(7)
        return {"pages": pages, "more_pages": bool(cursor), "quotes": quotes,
                "markets": {k: {"name": names[k], "books": dict(c)} for k, c in seen.items()}}
    out["alternate_only"] = scan(alternate="true", live="false", state="NJ")
    out["main_only"] = scan(alternate="false", live="false", state="NJ")
    for key in out["market_list_first"][:4]:
        out[f"market={key}"] = scan(market=key, live="false", state="NJ")
    return out


def main():
    if not os.environ.get("SMARTSTAKE_API_KEY"):
        sys.exit("SMARTSTAKE_API_KEY is not set")
    if os.environ.get("PROBE") == "first_td":
        result = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        result["nfl_first_td"] = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **first_td_look()}
        OUT.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
        print(f"wrote {OUT.name}: NFL First TD markets {result['nfl_first_td'].get('market_list_first')}")
        return
    if os.environ.get("PROBE") == "first_basket":
        # Only the First Basket look; the rest of the saved result stays as it was.
        result = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        result["nba_first_basket"] = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **first_basket_look()}
        OUT.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
        print(f"wrote {OUT.name}: First Basket {result['nba_first_basket'].get('quotes')} quotes")
        return
    result = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    result["status"] = shape(get("/v1/status"))
    result["books"] = get("/v1/books")
    result["leagues"] = get("/v1/leagues")
    for league in ("nfl", "nba", "nhl"):
        markets = get("/v1/markets", league=league)
        result[f"{league}_market_list"] = markets
    for league in ("nfl", "nhl"):
        info, quotes = league_snapshot(league)
        info.update(summarize(quotes))
        result[f"{league}_odds"] = info
    OUT.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    print(f"wrote {OUT.name}: nfl {result['nfl_odds'].get('quotes')} quotes, nhl {result['nhl_odds'].get('quotes')} quotes")


if __name__ == "__main__":
    main()
