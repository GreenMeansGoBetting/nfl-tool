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


def first_basket_look():
    """NBA First Basket (2026-10-21: only ProphetX and Novig reached the site):
    per book, how many 1st Points Scorer quotes, which sides, whether each has
    a player_id / participant / line, and the label / side text they use.
    Names and counts only, never prices."""
    quotes, cursor = [], None
    for _ in range(6):
        page = get("/v1/odds", league="nba", market="basketball_first_points_scorer", alternate="false", live="false",
                   state="NJ", cursor=cursor)
        if "http_error" in page:
            return {"error": page}
        quotes += page.get("data") or []
        cursor = page.get("next_cursor")
        if not cursor:
            break
        time.sleep(7)
    books = collections.defaultdict(lambda: {"quotes": 0, "sides": collections.Counter(), "player_id": 0, "participant": 0,
                                             "line": collections.Counter(), "labels": set(), "fields": None})
    for q in quotes:
        b = books[q.get("book")]
        b["quotes"] += 1
        b["sides"][str(q.get("side"))] += 1
        b["player_id"] += q.get("player_id") is not None
        b["participant"] += bool(q.get("participant"))
        b["line"][str(q.get("line"))] += 1
        if len(b["labels"]) < 6:
            b["labels"].add(f"side={q.get('side')!r} label={q.get('label')!r} participant={q.get('participant')!r}")
        if b["fields"] is None:
            b["fields"] = sorted(k for k in q if k not in ("odds", "price", "decimal_odds", "american_odds"))
    return {"quotes": len(quotes), "more_pages": bool(cursor),
            "by_book": {k: {**v, "sides": dict(v["sides"]), "line": dict(v["line"]), "labels": sorted(v["labels"])}
                        for k, v in sorted(books.items(), key=lambda kv: -kv[1]["quotes"])}}


def main():
    if not os.environ.get("SMARTSTAKE_API_KEY"):
        sys.exit("SMARTSTAKE_API_KEY is not set")
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
