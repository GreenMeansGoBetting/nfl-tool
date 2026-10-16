"""Replays 2024-25 and 2025-26 through the SHIPPED points model
(nfl_tool/nhl/points_model.py, on top of the shipped goals and shots
models), each season on its own games only, so the site's model is the one
that was tested (nhl_points.py chose the approach).

  1. SPREAD_MEAN: the assists number's average over both seasons.
  2. The assists weights and the re-scaling fitted on 2024-25, scored on
     2025-26 (the held-out check: it should match nhl_points.py's 6, about
     0.5953, and a touch better with the re-scaling). The goals half is the
     Goals model as shipped (its weights saw both seasons).
  3. Both seasons together: what points_model.WEIGHTS and CALIBRATION hold.
  4. Honest chances, and the tracked `mates` factor against what the model said.

    python tools/backtest/nhl_points_check.py      (about 4 minutes)

Needs data/nhl/games, shifts, previews and pp_toi for 2025 and 2026.
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nhl_goals import DATA, b, game_slots, logloss, poisson_fit, sm  # noqa: E402
from nhl_goals_check import np_fit  # noqa: E402
from nhl_shots import load_previews  # noqa: E402
import goals_model as gm  # noqa: E402
import points_model as pm  # noqa: E402

KEYS = tuple(k for k in pm.WEIGHTS if k != "scale")
MIN_GAMES = 5
REFIT_DAYS = 7


def load(season):
    """A season's games as the build reads them: each kept game with its
    power-play seconds and shift chart attached (the replays keep those apart)."""
    with gzip.open(DATA / "pp_toi" / f"{season}.json.gz", "rt", encoding="utf-8") as f:
        pp = json.load(f)
    games = []
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        raw.setdefault("pp_toi", pp.get(path.name.split(".")[0]))
        sp = DATA / "shifts" / str(season) / path.name
        if "shifts" not in raw and sp.exists():
            with gzip.open(sp, "rt", encoding="utf-8") as f:
                raw["shifts"] = json.load(f)
        games.append(b.reduce_game(raw))
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


def replay(games, previews, hand):
    shots = sm.ShotsModel()
    goals = gm.GoalsModel(shots, hand)
    points = pm.PointsModel(goals)
    history, last_fit, last_played, rows = [], None, {}, []
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    for date in sorted(by_date):
        day = np.datetime64(date)
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(REFIT_DAYS, "D")):
            for s in history:
                s["offwing"] = gm.off_wing(s, hand)
            goals.xg = {False: np_fit(history, False), True: np_fit(history, True)}
            last_fit = day
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            for pid, line in r["skaters"].items():
                p = points.players.get(pid)
                if not p or p["season"]["games"] < MIN_GAMES:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = points.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid), starters.get(opp))
                if parts is None:
                    continue
                mates = [(q, other["pos"]) for q, other in r["skaters"].items()
                         if q != pid and other["team"] == team and slots.get(q) and slots.get(q) == slots.get(pid)]
                rows.append({"pts": line["g"] + line["a"], "a": line["a"], "goals": parts["goals"]["mean"], "base": parts["base"],
                             "mates": points.mates(pid, mates) or 1.0, **{f"x_{k}": parts["x"][k] for k in KEYS}})
        for r in by_date[date]:
            shots.add_game(r)
            goals.add_game(r)
            points.add_game(r)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
    return {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}


def X_of(d):
    return np.column_stack([np.ones(len(d["a"]))] + [d[f"x_{k}"] for k in KEYS])


def fit_assists(d):
    X, off = X_of(d), np.log(d["base"])
    start = math.log(d["a"].sum() / d["base"].sum())
    w = poisson_fit(X, d["a"], off + start)
    w[0] += start
    mu = np.exp(off + X @ w)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    return w, se


def mean_of(d, w):
    return d["goals"] + np.exp(np.log(d["base"]) + X_of(d) @ w)


def fit_calibration(lam, y):
    z = np.log((1 - np.exp(-lam)) / np.exp(-lam))
    X = np.column_stack([np.ones_like(z), z])
    c = np.array([0.0, 1.0])
    for _ in range(30):
        p = 1 / (1 + np.exp(-(X @ c)))
        c += np.linalg.solve(X.T @ (X * (p * (1 - p))[:, None]), X.T @ (y - p))
    return c


def calibrated(lam, c):
    z = np.log((1 - np.exp(-lam)) / np.exp(-lam))
    return 1 / (1 + np.exp(-(c[0] + c[1] * z)))


def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def honest(y, p):
    for lo, hi in zip([0, .15, .25, .35, .45, .55, .65], [.15, .25, .35, .45, .55, .65, 1.01]):
        m = (p >= lo) & (p < hi)
        if m.sum() >= 100:
            print(f"     {100 * lo:3.0f}-{100 * hi:<3.0f}% {int(m.sum()):>8,}  got a point {100 * y[m].mean():5.1f}%  (said {100 * p[m].mean():.1f}%)")


def main():
    hand = {}
    for season in (2025, 2026):
        for pid, row in b.fetch_report("skater/timeonice", season, "playerId").items():
            if row.get("shootsCatches"):
                hand[str(pid)] = row["shootsCatches"]
    data = {}
    for season in (2025, 2026):
        print(f"Replaying {b.season_label(season)} through points_model.py...", flush=True)
        games = load(season)
        data[season] = replay(games, load_previews(season, games), hand)
    f, t = data[2025], data[2026]

    spread_mean = float(np.concatenate([f["base"], t["base"]]).mean())
    print(f"\n1. SPREAD_MEAN = {spread_mean:.4f}  (the file has {pm.SPREAD_MEAN})")
    for d in (f, t):  # read against the measured average, whatever the file says now
        d["x_spread"] = np.log(d["base"] / spread_mean)

    w, se = fit_assists(f)
    lam_f, lam_t = mean_of(f, w), mean_of(t, w)
    yf, yt = (f["pts"] > 0).astype(float), (t["pts"] > 0).astype(float)
    c = fit_calibration(lam_f, yf)
    print(f"\n2. Weights from 2024-25, on 2025-26: log loss {logloss(yt, lam_t):.5f}; re-scaled {ll(yt, calibrated(lam_t, c)):.5f}  (nhl_points.py's 6: 0.59535)")
    print("   ", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, w)}, " re-scaling", [round(float(v), 3) for v in c])
    honest(yt, calibrated(lam_t, c))

    both = {k: np.concatenate([f[k], t[k]]) for k in f}
    w_all, se_all = fit_assists(both)
    lam = mean_of(both, w_all)
    y = (both["pts"] > 0).astype(float)
    c_all = fit_calibration(lam, y)
    print("\n3. Both seasons together (copy into points_model.py):")
    print(f"   SPREAD_MEAN = {spread_mean:.4f}")
    print("   WEIGHTS =", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, w_all)})
    print("   (+/-)    ", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, se_all)})
    print("   CALIBRATION =", tuple(round(float(v), 3) for v in c_all))
    print("   How far each piece moves the expected assists (middle 80% of players):")
    for i, key in enumerate(KEYS):
        lo, hi = np.percentile(np.exp(w_all[i + 1] * both[f"x_{key}"]), [10, 90])
        print(f"   {key:<8} {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%")
    p = calibrated(lam, c_all)
    print(f"\n4. Both seasons, said vs got (log loss {ll(y, p):.5f}):")
    honest(y, p)
    for lo, hi, label in ((0, 0.85, "linemates tonight 15%+ worse"), (0.85, 1.15, "about the same"), (1.15, 9, "15%+ better")):
        m = (both["mates"] >= lo) & (both["mates"] < hi) & (both["mates"] != 1.0)
        if m.sum():
            print(f"   {label:<30} {int(m.sum()):>7,}  got a point {100 * y[m].mean():.1f}%  (said {100 * p[m].mean():.1f}%)")


if __name__ == "__main__":
    main()
