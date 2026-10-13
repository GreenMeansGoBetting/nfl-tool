"""Walk-forward replay of the NHL shots-on-goal model.

Every skater in every game of a season is projected ONLY from the games
before it (plus the season before, the way the live build starts from last
season's saved numbers). It answers three things:

  1. How much should each matchup piece count? (the WEIGHTS in
     nfl_tool/nhl/shots_model.py: fitted on the first half of the season,
     checked on the second half)
  2. Does the projection beat "his season average"? Which pieces earn it?
  3. When the model says 60% to clear a line, does it happen 60% of the time?

    python tools/backtest/nhl_shots.py 2026            (replay 2025-26; needs data/nhl/games/2025 and /2026)
    python tools/backtest/nhl_shots.py 2026 --tune     (also try other settings for the rate and minutes)

The games come from the build's own folder (data/nhl/games/<season>); a
season that isn't there is downloaded first (about 4 minutes).

What it can NOT say: whether the model beats the betting line. There is no
free history of shots-on-goal lines; the site keeps its own record from the
day the page went live (model_history/nhl_shots.json).
"""
import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
import build_nhl as b  # noqa: E402
import shots_model as sm  # noqa: E402

DATA = ROOT / "data" / "nhl"
X_KEYS = ("opp", "pos", "area", "pp", "home", "b2b", "opp_b2b")
MIN_HISTORY = 5  # games on file (either season) before a player's projection is judged
LINES = (0.5, 1.5, 2.5, 3.5, 4.5)


def load_records(season: int) -> list:
    folder = DATA / "games" / str(season)
    if not folder.exists() or len(list(folder.glob("*.json.gz"))) < 1000:
        print(f"Downloading {b.season_label(season)} (kept in {folder})...", flush=True)
        listing = b._request(f"{b.REST}/game?cayenneExp=season={b.season_id(season)}%20and%20gameType={b.REGULAR_SEASON}").get("data") or []
        b.load_games(sorted(g["id"] for g in listing if g.get("gameStateId") in b.FINISHED_STATES), season, DATA)
    records = []
    for path in sorted(folder.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            records.append(b.reduce_game(json.load(f)))
    records.sort(key=lambda r: (r["date"], r["id"]))
    return records


def replay(records: list, prior: dict, params: dict | None = None) -> dict:
    """One row per skater-game: what the model had before the game, and what happened."""
    model = sm.ShotsModel(prior, params)
    last_played, rows = {}, []
    by_date = {}
    for r in records:
        by_date.setdefault(r["date"], []).append(r)
    for n, date in enumerate(sorted(by_date)):
        day = np.datetime64(date)
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            for pid, line in r["skaters"].items():
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = model.parts(pid, opp, team == r["home"], rest[team], rest[opp])
                if parts is None or parts["games"] + parts["prev_games"] < MIN_HISTORY:
                    continue
                season = parts["season"]
                rows.append({
                    "day": n, "pid": pid, "group": parts["group"], "sog": line["sog"], "toi": line["toi"] / 60,
                    "base": parts["base"], "minutes": parts["minutes"], "direct": parts["rate"]["direct"] * parts["minutes"],
                    "by_attempts": parts["rate"]["attempts"] * parts["rate"]["thru"] * parts["minutes"],
                    # The plain yardstick: his shots on goal a game this season (last season until he has 5 games).
                    "naive": season["sog"] / parts["games"] if parts["games"] >= 5 else None,
                    "games": parts["games"], **{f"x_{k}": parts["x"][k] for k in X_KEYS},
                })
        for r in by_date[date]:
            model.add_game(r)
            last_played[r["home"]] = last_played[r["away"]] = day
    return {k: np.array([row[k] for row in rows], dtype=object if k in ("pid", "group", "naive") else float) for k in rows[0]}


def poisson_fit(X: np.ndarray, y: np.ndarray, offset: np.ndarray, ridge: float = 0.0) -> np.ndarray:
    """Weights w that best explain y ~ Poisson(exp(offset + X w)) (Newton's method)."""
    w = np.zeros(X.shape[1])
    for _ in range(50):
        mu = np.exp(offset + X @ w)
        grad = X.T @ (y - mu) - ridge * w
        hess = X.T @ (X * mu[:, None]) + ridge * np.eye(X.shape[1])
        step = np.linalg.solve(hess, grad)
        w += step
        if np.abs(step).max() < 1e-8:
            break
    return w


def deviance(y: np.ndarray, mu: np.ndarray) -> float:
    """Mean Poisson deviance: lower = the projection fits the counts better."""
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(y > 0, y * np.log(y / mu), 0.0)
    return float(2 * np.mean(term - (y - mu)))


def design(d: dict, keys=X_KEYS) -> np.ndarray:
    return np.column_stack([np.ones(len(d["sog"]))] + [d[f"x_{k}"] for k in keys])


def fit_dispersion(y: np.ndarray, mu: np.ndarray) -> float:
    """k in spread = mu + k mu^2, by matching the spread actually seen."""
    return max(0.0, float(np.sum((y - mu) ** 2 - mu) / np.sum(mu ** 2)))


def report(d: dict, label: str) -> dict:
    y, base = d["sog"], d["base"]
    n = len(y)
    half = d["day"] <= np.median(d["day"])
    print(f"\n=== {label}: {n:,} skater-games, {y.mean():.2f} shots on goal a game ===")

    print("\n1. How much each piece counts (the exponent on each number; 1.0 = take it at face value)")
    X = design(d)
    w_all = poisson_fit(X, y, np.log(base))
    w_first = poisson_fit(X[half], y[half], np.log(base[half]))
    w_second = poisson_fit(X[~half], y[~half], np.log(base[~half]))
    # Standard errors from the fitted information matrix.
    mu = np.exp(np.log(base) + X @ w_all)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    print("   piece        whole season   (+/-)    first half   second half")
    for i, key in enumerate(("scale",) + X_KEYS):
        print(f"   {key:<10} {w_all[i]:>12.3f}   {se[i]:.3f} {w_first[i]:>12.3f} {w_second[i]:>12.3f}")

    print("\n2. Accuracy on the SECOND half, with weights fitted on the FIRST half (lower deviance = better)")
    test = ~half
    mu_test = np.exp(np.log(base[test]) + X[test] @ w_first)
    naive = np.array([v if v is not None else np.nan for v in d["naive"]], dtype=float)[test]
    ok = ~np.isnan(naive) & (naive > 0)
    rows = [
        ("his season average (shots a game)", np.where(ok, naive, np.nan)),
        ("rate x minutes, shots on goal only", d["direct"][test]),
        ("rate x minutes, from attempts only", d["by_attempts"][test]),
        ("rate x minutes, blended (the base)", base[test]),
    ]
    for keys, name in (((), "base, rescaled"), (("opp",), "+ what the defense allows"), (("opp", "pos", "area"), "+ position and area"), (("opp", "pos", "area", "pp"), "+ power play"), (X_KEYS, "+ home ice and rest (everything)")):
        Xk = design(d, keys)
        wk = poisson_fit(Xk[half], y[half], np.log(base[half]))
        rows.append((name, np.exp(np.log(base[test]) + Xk[test] @ wk)))
    yt = y[test]
    print(f"   {'':<38} deviance    avg miss   (on the {int(ok.sum()):,} with a season average)")
    for name, mu_k in rows:
        mu_k = np.asarray(mu_k, dtype=float)
        print(f"   {name:<38} {deviance(yt[ok], mu_k[ok]):.4f}     {np.mean(np.abs(yt[ok] - mu_k[ok])):.3f}")

    print("\n3. Is it honest? Players sorted by projection (second half, first-half weights)")
    k = fit_dispersion(y[half], np.exp(np.log(base[half]) + X[half] @ w_first))
    print(f"   spread = m + {k:.3f} m^2  (0 would be pure chance)")
    print("   projected      games   projected   actual")
    edges = [0, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 4, 99]
    for lo, hi in zip(edges, edges[1:]):
        m = (mu_test >= lo) & (mu_test < hi)
        if m.sum():
            print(f"   {lo:.2f}-{hi:<6.2f} {int(m.sum()):>8,} {mu_test[m].mean():>10.2f} {yt[m].mean():>9.2f}")
    print("\n   The chance to clear each line: what the model said vs how often it happened")
    print("   model said      " + "".join(f"over {line:<8}" for line in LINES))
    chance = {line: np.array([sm.chance_over(m, line, k) for m in mu_test]) for line in LINES}
    bins = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.01]
    for lo, hi in zip(bins, bins[1:]):
        cells = []
        for line in LINES:
            m = (chance[line] >= lo) & (chance[line] < hi)
            cells.append(f"{100 * np.mean(yt[m] > line):4.0f}% ({int(m.sum()):>5,})" if m.sum() >= 150 else " " * 13)
        print(f"   {int(lo * 100):>3}-{int(min(hi, 1) * 100):<3}%       " + " ".join(cells))

    print("\n4. How far each piece moves a projection (the middle 80% of players, whole-season weights)")
    for i, key in enumerate(X_KEYS):
        effect = np.exp(w_all[i + 1] * d[f"x_{key}"])
        lo, hi = np.percentile(effect, [10, 90])
        print(f"   {key:<10} {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%")
    return {"weights": dict(zip(("scale",) + X_KEYS, w_all.tolist())), "dispersion": fit_dispersion(y, mu)}


def tune(records: list, prior: dict) -> None:
    """Try other settings for the shot rate and the minutes, one at a time."""
    def score(params):
        d = replay(records, prior, params)
        return deviance(d["sog"], d["base"] * d["sog"].sum() / d["base"].sum()), len(d["sog"])

    start, n = score({})
    print(f"\n=== Settings (deviance of the base projection; now {start:.4f} on {n:,}) ===")
    for key, values in {
        "decay": (0.97, 0.98, 0.99, 1.0), "prev_weight": (0.25, 0.4, 0.7, 1.0), "pad_minutes": (40, 80, 200, 300),
        "attempt_blend": (0.0, 0.25, 0.75, 1.0), "thru_pad": (20, 120, 250), "toi_decay": (0.6, 0.7, 0.85, 0.92),
        "toi_prev_games": (0.5, 3, 6), "short_night": (0.0, 0.5, 0.75),
    }.items():
        print(f"   {key:<15} now {sm.PARAMS[key]:<6} " + "  ".join(f"{v}: {score({key: v})[0] - start:+.4f}" for v in values))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("season", type=int, help="Season to replay, by the year it ends (2026 = 2025-26)")
    parser.add_argument("--tune", action="store_true")
    args = parser.parse_args()
    prior = sm.season_summary(load_records(args.season - 1))
    records = load_records(args.season)
    if args.tune:
        tune(records, prior)
    d = replay(records, prior)
    fitted = report(d, b.season_label(args.season))
    regulars = d["base"] >= 1.5
    report({k: v[regulars] for k, v in d.items()}, f"{b.season_label(args.season)}, players projected for 1.5+ (the ones books post lines on)")
    print("\nFitted on the whole season (copy into shots_model.py if they hold up in both halves):")
    print("  WEIGHTS =", {k: round(v, 3) for k, v in fitted["weights"].items()})
    print("  DISPERSION =", round(fitted["dispersion"], 3))


if __name__ == "__main__":
    main()
