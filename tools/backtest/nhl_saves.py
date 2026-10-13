"""Walk-forward replay of the NHL saves model (King of the Crease).

Every starting goalie in every game of a season is projected ONLY from that
season's games before it, the way the live build runs (the owner's rule: this
season only). It answers:

  1. How much should each piece count? (the WEIGHTS in
     nfl_tool/nhl/saves_model.py)
  2. Does the projection beat "his saves a start so far" and "what his team
     allows"? How early in a season?
  3. When the model says 20% to make 30 saves, does it happen 20% of the time?
  4. The promo's question: when it says a goalie has a 12% chance to lead the
     day in saves, does he lead it 12% of the time? How often does its
     favorite win?

    python tools/backtest/nhl_saves.py 2026 2025     (replay 2025-26 and 2024-25 together)
    python tools/backtest/nhl_saves.py 2026 --tune   (also try other settings)

The games come from the build's own folder (data/nhl/games/<season>); a
season that isn't there is downloaded first (about 4 minutes).

What it can NOT say: whether the model beats the betting line. There is no
free history of saves lines; the site keeps its own record from the day the
page went live (model_history/nhl_crease/).
"""
import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_nhl as b  # noqa: E402
import saves_model as sv  # noqa: E402
from nhl_shots import deviance, fit_dispersion, load_records, poisson_fit  # noqa: E402

X_KEYS = ("off", "def", "home", "b2b", "opp_b2b", "sv")
MIN_TEAM_GAMES = 3   # games each team has played before a start is judged
MIN_DAY_STARTERS = 8 # a day counts toward the promo check with 4+ games
SAVE_MARKS = (20, 24, 28, 30, 33, 35, 38, 40)


def replay(records: list, params: dict | None = None) -> dict:
    """One row per start: what the model had before the game, and what happened."""
    model = sv.SavesModel(params)
    last_played, rows = {}, []
    by_date = {}
    for r in records:
        by_date.setdefault(r["date"], []).append(r)
    for n, date in enumerate(sorted(by_date)):
        day = np.datetime64(date)
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            for team, opp in ((r["home"], r["away"]), (r["away"], r["home"])):
                starter = next(((pid, g) for pid, g in r["goalies"].items() if g["team"] == team and g["start"]), None)
                if not starter:
                    continue
                pid, line = starter
                parts = model.parts(team, opp, team == r["home"], rest[team], rest[opp], pid)
                if parts is None or min(parts["team_games"], parts["opp_games"]) < MIN_TEAM_GAMES:
                    continue
                rows.append({
                    "day": n, "saves": line["sa"] - line["ga"], "base": parts["base"], "starts": parts["starts"],
                    # The plain yardsticks: his saves a start so far, and the shots his team has allowed a game times the league's save rate.
                    "naive": parts["start_saves"] / parts["starts"] if parts["starts"] >= 3 else np.nan,
                    "team_allows": parts["def"]["season"] * parts["league_sv"],
                    "x_off_sog": np.log(parts["off"]["factor"]), "x_def_sog": np.log(parts["def"]["factor"]),
                    "x_off_att": np.log(parts["off_att"]["factor"]), "x_def_att": np.log(parts["def_att"]["factor"]),
                    **{f"x_{k}": parts["x"][k] for k in X_KEYS},
                })
        for r in by_date[date]:
            model.add_game(r)
            last_played[r["home"]] = last_played[r["away"]] = day
    return {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}


def pooled(seasons: list, params: dict | None = None) -> dict:
    """Several seasons' replays as one table (`season` tells them apart)."""
    parts = []
    for season in seasons:
        d = replay(load_records(season), params)
        d["season"] = np.full(len(d["saves"]), season, dtype=float)
        parts.append(d)
    return {k: np.concatenate([d[k] for d in parts]) for k in parts[0]}


def design(d: dict, keys=X_KEYS) -> np.ndarray:
    return np.column_stack([np.ones(len(d["saves"]))] + [d[f"x_{k}"] for k in keys])


def site_projection(d: dict) -> np.ndarray:
    """The projection as the site makes it: saves_model.WEIGHTS on the replay's pieces."""
    return d["base"] * np.exp(sv.WEIGHTS["scale"] + sum(sv.WEIGHTS[k] * d[f"x_{k}"] for k in X_KEYS))


def report(d: dict, label: str) -> dict:
    y, base = d["saves"], d["base"]
    print(f"\n=== {label}: {len(y):,} starts, {y.mean():.2f} saves a start ===")

    print("\n1. How much each piece counts (the exponent on each number; 1.0 = take it at face value)")
    X = design(d)
    w_all = poisson_fit(X, y, np.log(base))
    mu = np.exp(np.log(base) + X @ w_all)
    # Saves are streakier than a pure count, so the plain +/- is widened by the spread seen.
    k_all = fit_dispersion(y, mu)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None])))) * np.sqrt(np.mean(1 + k_all * mu))
    seasons = sorted(set(d["season"]))
    by_season = [poisson_fit(X[d["season"] == s], y[d["season"] == s], np.log(base[d["season"] == s])) for s in seasons]
    print("   piece        every start    (+/-)   the site uses   " + "   ".join(b.season_label(int(s)) for s in seasons))
    for i, key in enumerate(("scale",) + X_KEYS):
        print(f"   {key:<10} {w_all[i]:>12.3f}   {se[i]:.3f} {sv.WEIGHTS[key]:>12.2f}       " + "   ".join(f"{w[i]:>7.3f}" for w in by_season))

    print("\n2. Accuracy, each yardstick on the same starts (lower = better)")
    site = site_projection(d)
    ok = ~np.isnan(d["naive"])
    half = d["day"] <= np.median(d["day"])
    rows = [("the league's average start", base), ("his own saves a start so far", d["naive"]), ("what his team allows x league save rate", d["team_allows"])]
    for names, name in ((("x_def_sog",), "fitted: his team's shots allowed"), (("x_off_sog", "x_def_sog"), "fitted: + the other team's shots"), (("x_off_att", "x_def_att"), "fitted: the same two, from attempts"), (("x_off", "x_def"), "fitted: the same two, blended"), (("x_off", "x_def", "x_home"), "fitted: + home or away"), (("x_off", "x_def", "x_home", "x_sv"), "fitted: + his save rate"), (tuple(f"x_{k}" for k in X_KEYS), "fitted: + rest (everything)")):
        # Fitted on each season's first half, judged on all of it: close enough to see what a piece adds.
        Xk = np.column_stack([np.ones(len(y))] + [d[n] for n in names])
        rows.append((name, np.exp(np.log(base) + Xk @ poisson_fit(Xk[half], y[half], np.log(base[half])))))
    rows.append(("THE SITE'S PROJECTION (its own weights)", site))
    print(f"   {'':<44} deviance    avg miss   (on the {int(ok.sum()):,} with 3+ starts)")
    for name, mu_k in rows:
        mu_k = np.asarray(mu_k, dtype=float)
        print(f"   {name:<44} {deviance(y[ok], mu_k[ok]):.4f}     {np.mean(np.abs(y[ok] - mu_k[ok])):.3f}")
    print("\n   How early in a season does it help? (the site's projection against the league's average start)")
    for lo, hi in ((0, 14), (14, 28), (28, 60), (60, 400)):
        m = (d["day"] >= lo) & (d["day"] < hi)
        print(f"   season days {lo:>3}-{hi:<3} {int(m.sum()):>6,} starts: miss {np.mean(np.abs(y[m] - site[m])):.3f} against {np.mean(np.abs(y[m] - base[m])):.3f}")

    print("\n3. Is it honest? Starts sorted by the site's projection, and the chance of each total (said / was)")
    print(f"   (a plain count's spread would be m + {fit_dispersion(y, site):.3f} m^2; the site uses {sv.DISPERSION} plus {sv.PULLED_SHARE:.0%} of starts ending early)")
    print("   projected      starts   projected   actual   " + "".join(f"{mark}+        " for mark in SAVE_MARKS))
    edges = [0, 21, 22.5, 24, 25.5, 27, 28.5, 99]
    for lo, hi in list(zip(edges, edges[1:])) + [(0, 99)]:
        m = (site >= lo) & (site < hi)
        if m.sum():
            marks = "".join(f"{100 * np.mean([sv.chance_at_least(v, mark) for v in site[m]]):3.0f}/{100 * np.mean(y[m] >= mark):3.0f}    " for mark in SAVE_MARKS)
            print(f"   {'all' if hi - lo > 90 else f'{lo:>4}-{hi:<6}':<11} {int(m.sum()):>8,} {site[m].mean():>10.2f} {y[m].mean():>9.2f}   {marks}")

    print(f"\n4. The promo: who leads the day in saves (days with {MIN_DAY_STARTERS // 2}+ games)")
    said, won, favorites, fav_said, sizes, uniform, top3, ranks, winning = [], [], 0, [], [], [], 0, {}, []
    for season in seasons:
        for day in np.unique(d["day"][d["season"] == season]):
            m = (d["season"] == season) & (d["day"] == day)
            if m.sum() < MIN_DAY_STARTERS:
                continue
            chances = np.array(sv.top_chances(list(site[m])))
            best = y[m] == y[m].max()
            order = np.argsort(-chances)
            said.extend(chances)
            won.extend(best)
            favorites += bool(best[order[0]])
            top3 += bool(best[order[:3]].any())
            fav_said.append(chances.max())
            sizes.append(int(m.sum()))
            uniform.append(best.sum() / m.sum())
            winning.append(y[m].max())
            for place, i in enumerate(order):
                ranks.setdefault(min(place, 9), []).append(best[i])
    said, won = np.array(said), np.array(won, dtype=float)
    n = len(sizes)
    print(f"   {n} days, {np.mean(sizes):.1f} starters a day; the day's best was {np.mean(winning):.1f} saves on average ({np.percentile(winning, 10):.0f} to {np.percentile(winning, 90):.0f} most days).")
    print(f"   The model's favorite led (or tied) on {100 * favorites / n:.0f}% of days; it gave him {100 * np.mean(fav_said):.0f}% on average. Its top three had the leader on {100 * top3 / n:.0f}%. A random pick: {100 * np.mean(uniform):.0f}%.")
    print("   model said       goalies   said    led the day")
    bins = [0, 0.03, 0.05, 0.07, 0.10, 0.14, 0.20, 1.01]
    for lo, hi in zip(bins, bins[1:]):
        m = (said >= lo) & (said < hi)
        if m.sum() >= 30:
            print(f"   {int(lo * 100):>3}-{int(min(hi, 1) * 100):<3}%     {int(m.sum()):>8,}   {100 * said[m].mean():4.1f}%   {100 * won[m].mean():4.1f}%")
    print("   by the model's rank that day: " + "  ".join(f"{'10th+' if place == 9 else f'#{place + 1}'} {100 * np.mean(v):.0f}%" for place, v in sorted(ranks.items())))

    print("\n5. How far each piece moves a projection (the middle 80% of starts, the site's weights)")
    for key in X_KEYS:
        lo, hi = np.percentile(np.exp(sv.WEIGHTS[key] * d[f"x_{key}"]), [10, 90])
        print(f"   {key:<10} {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%")
    return {"weights": dict(zip(("scale",) + X_KEYS, w_all.tolist()))}


def tune(seasons: list) -> None:
    """Try other settings, one at a time: the deviance with every piece refitted."""
    def score(params):
        d = pooled(seasons, params)
        X = design(d)
        w = poisson_fit(X, d["saves"], np.log(d["base"]))
        return deviance(d["saves"], np.exp(np.log(d["base"]) + X @ w))

    start = score({})
    print(f"\n=== Settings (deviance with every piece refitted; now {start:.4f}) ===")
    for key, values in {"team_decay": (0.9, 0.95, 0.98), "team_pad_games": (3, 6, 15, 25), "attempt_blend": (0.0, 0.5, 0.75, 1.0), "sv_pad_shots": (200, 1200, 3000)}.items():
        print(f"   {key:<18} now {sv.PARAMS[key]:<6} " + "  ".join(f"{v}: {score({key: v}) - start:+.4f}" for v in values))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("seasons", type=int, nargs="+", help="Seasons to replay, by the year each ends (2026 = 2025-26)")
    parser.add_argument("--tune", action="store_true")
    args = parser.parse_args()
    if args.tune:
        tune(args.seasons)
    fitted = report(pooled(args.seasons), " and ".join(b.season_label(s) for s in args.seasons))
    print("\nFitted on every start (round these into saves_model.py if they hold up in each season):")
    print("  WEIGHTS =", {k: round(v, 3) for k, v in fitted["weights"].items()})


if __name__ == "__main__":
    main()
