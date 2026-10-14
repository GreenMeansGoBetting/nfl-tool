"""Do power-play units (from the NHL's own shift charts) add to the shots model?

    python tools/backtest/nhl_pp_units.py 2026     (2025-26; needs data/nhl/games/2026)

Asked by the owner 2026-10-14 ("look into adding power play units into the model").
What it showed on 2025-26 (41,789 skater-games): a player's share of his team's
power-play time LAST game (or the last three) added nothing beyond the model
(fitted weight 0.01, moves a projection -2% to +1%). Last game's share was no
better a guess at tonight's than his season share (each within 0.10 of tonight's
59% of the time). THIS game's share, known only afterwards, would move it -16% to
+9%: the most a perfect morning PP-unit report could add, and an overstatement,
since it also carries what happens in the game (a benching, an injury).

1. Download every 2025-26 game's shift chart (kept in data/nhl/shifts/2026, gzip).
2. For each game: the power-play stretches from the play-by-play's situationCode, and each
   skater's seconds on the ice during his team's power plays.
3. Replay the model (tools/backtest/nhl_shots.py) and test new pieces on top of the
   model's full projection:
     - pp_last: his share of the team's PP time LAST game vs his season share so far
       (what we could know before puck drop: "he moved up to PP1")
     - pp_now:  the same with THIS game's share (cheating: the most a perfect PP-unit
       source, e.g. a morning report, could ever add)
"""
import gzip
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "backtest"))
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
import nhl_shots as ns  # noqa: E402
import shots_model as sm  # noqa: E402

SEASON = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
SHIFTS = ROOT / "data" / "nhl" / "shifts" / str(SEASON)
GAMES = ROOT / "data" / "nhl" / "games" / str(SEASON)


def secs(mmss):
    m, s = mmss.split(":")
    return int(m) * 60 + int(s)


def fetch(game_id):
    path = SHIFTS / f"{game_id}.json.gz"
    if path.exists():
        return
    req = urllib.request.Request(f"https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={game_id}", headers={"User-Agent": "Mozilla/5.0"})
    for _ in range(3):
        try:
            data = json.load(urllib.request.urlopen(req, timeout=30))["data"]
            keep = [[s["playerId"], s["teamAbbrev"], s["period"], s["startTime"], s["endTime"]] for s in data if s.get("typeCode") == 517 and s.get("startTime") and s.get("endTime")]
            with gzip.open(path, "wt", encoding="utf-8") as f:
                json.dump(keep, f)
            return
        except Exception:
            continue


def pp_seconds(game_id):
    """{player id (str): [pp seconds, his team's pp seconds]} for one game."""
    with gzip.open(GAMES / f"{game_id}.json.gz", "rt", encoding="utf-8") as f:
        raw = json.load(f)
    pbp = raw["pbp"]
    home, away = pbp["homeTeam"]["abbrev"], pbp["awayTeam"]["abbrev"]
    plays = [p for p in pbp["plays"] if p.get("situationCode") and p.get("timeInPeriod") and (p.get("periodDescriptor") or {}).get("number", 9) <= 4]
    # The state from one event to the next is the state at the next event.
    spans = {home: [], away: []}
    prev = None
    for p in plays:
        per = p["periodDescriptor"]["number"]
        t = secs(p["timeInPeriod"])
        code = p["situationCode"]
        if prev and prev[0] == per and t > prev[1]:
            ag, ask, hsk, hg = int(code[0]), int(code[1]), int(code[2]), int(code[3])
            if ag == 1 and hg == 1 and ask != hsk:
                spans[home if hsk > ask else away].append((per, prev[1], t))
        prev = (per, t)
    with gzip.open(SHIFTS / f"{game_id}.json.gz", "rt", encoding="utf-8") as f:
        shifts = json.load(f)
    out = {}
    team_pp = {team: sum(b - a for _, a, b in s) for team, s in spans.items()}
    for pid, team, per, start, end in shifts:
        a, b = secs(start), secs(end)
        on = sum(max(0, min(b, e) - max(a, s)) for p, s, e in spans.get(team, []) if p == per)
        row = out.setdefault(str(pid), [0, team_pp.get(team, 0)])
        row[0] += on
    return out


def main():
    SHIFTS.mkdir(parents=True, exist_ok=True)
    ids = sorted(p.name.split(".")[0] for p in GAMES.glob("*.json.gz"))
    missing = [g for g in ids if not (SHIFTS / f"{g}.json.gz").exists()]
    if missing:
        print(f"Downloading {len(missing)} shift charts...", flush=True)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(fetch, missing))
    pp = {}
    for g in ids:
        if (SHIFTS / f"{g}.json.gz").exists():
            pp[g] = pp_seconds(g)
    print(f"PP time for {len(pp)} of {len(ids)} games")

    records = ns.load_records(SEASON)
    previews = ns.load_previews(SEASON, records)
    # The replay, with each row's game id kept (a copy of ns.replay's loop).
    model = sm.ShotsModel(None, None)
    last_played, rows = {}, []
    by_date = {}
    for r in records:
        by_date.setdefault(r["date"], []).append(r)
    history = {}  # pid -> list of (pp secs, team pp secs) in his games so far
    for n, date in enumerate(sorted(by_date)):
        day = np.datetime64(date)
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = ns.game_slots(r, previews.get(r["id"]))
            game_pp = pp.get(str(r["id"]))
            for pid, line in r["skaters"].items():
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = model.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid))
                if parts is None or parts["games"] < ns.MIN_HISTORY or game_pp is None:
                    continue
                past = history.get(pid, [])
                if not past:
                    continue
                share = lambda games: sum(p for p, _ in games) / max(1, sum(t for _, t in games))
                season_share = share(past)
                last_share = share(past[-1:])
                last3 = share(past[-3:])
                now = game_pp.get(pid, [0, 0])
                now_share = now[0] / now[1] if now[1] else None
                rows.append({
                    "day": n, "sog": line["sog"], "base": parts["base"], "games": parts["games"],
                    **{f"x_{k}": parts["x"][k] for k in ns.X_KEYS},
                    "season_share": season_share, "last_share": last_share, "last3": last3, "now_share": now_share,
                })
        for r in by_date[date]:
            model.add_game(r)
            last_played[r["home"]] = last_played[r["away"]] = day
            game_pp = pp.get(str(r["id"]))
            if game_pp:
                for pid in r["skaters"]:
                    if pid in game_pp:
                        history.setdefault(pid, []).append(tuple(game_pp[pid]))
    d = {k: np.array([row[k] if row[k] is not None else np.nan for row in rows], dtype=float) for k in rows[0]}
    ok = ~np.isnan(d["now_share"])
    d = {k: v[ok] for k, v in d.items()}
    y, base = d["sog"], d["base"]
    half = d["day"] <= np.median(d["day"])
    X0 = ns.design(d)
    w0 = ns.poisson_fit(X0[half], y[half], np.log(base[half]))
    full = np.log(base) + X0 @ w0  # the model as it is
    print(f"\n{len(y):,} skater-games. Season PP share: mean {d['season_share'].mean():.2f}")
    print(f"How often last game's PP share is within 0.10 of tonight's: {np.mean(np.abs(d['last_share'] - d['now_share']) < 0.10):.0%}")
    print(f"... season share within 0.10 of tonight's: {np.mean(np.abs(d['season_share'] - d['now_share']) < 0.10):.0%}")
    pad = 0.05
    test = ~half
    base_dev = ns.deviance(y[test], np.exp(full[test]))
    print(f"\nSecond-half deviance, the model as it is: {base_dev:.5f}")
    for name, key in (("last game's PP share vs season", "last_share"), ("last 3 games' PP share vs season", "last3"), ("THIS game's PP share vs season (perfect info)", "now_share")):
        x = np.log((d[key] + pad) / (d["season_share"] + pad))
        X = np.column_stack([np.ones(len(y)), x])
        w = ns.poisson_fit(X[half], y[half], full[half])
        mu = np.exp(full[test] + X[test] @ w)
        lo, hi = np.percentile(np.exp(w[1] * x), [5, 95])
        moved = np.abs(x) > np.log(1.5)
        print(f"  {name:<46} weight {w[1]:.3f}  deviance {ns.deviance(y[test], mu):.5f} ({ns.deviance(y[test], mu) - base_dev:+.5f})  5-95%: {100*(lo-1):+.0f}% to {100*(hi-1):+.0f}%  big moves: {moved.mean():.1%}")
        # Players whose role moved a lot: model miss before and after.
        m = moved & test
        if m.sum():
            print(f"      on the {int(m.sum()):,} with a big move: actual {y[m].mean():.2f}, model {np.exp(full[m]).mean():.2f}, with the piece {np.exp(full[m] + X[m] @ w).mean():.2f}")


if __name__ == "__main__":
    main()
