"""Replays 2024-25 and 2025-26 through the SHIPPED goals model
(nfl_tool/nhl/goals_model.py), each season on its own games only, so the
site's model is the one that was tested (nhl_goals_ideas.py chose its pieces).

  1. Weights fitted on 2024-25, scored on 2025-26 (the held-out check: it
     should match nhl_goals_ideas.py's "everything that passed").
  2. Weights fitted on both seasons together: what goals_model.WEIGHTS holds.
  3. Honest chances, and the Zone Match tag against what the model expected.

    python tools/backtest/nhl_goals_check.py

The expected-goals tables are refitted weekly with numpy here (the same
logistic regression goals_model.fit_xg solves in plain Python for the site).
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nhl_goals import DATA, b, deviance, game_slots, logloss, poisson_fit, sm  # noqa: E402
from nhl_shots import load_previews  # noqa: E402
import goals_model as gm  # noqa: E402  (nfl_tool/nhl is on the path via nhl_goals)

KEYS = tuple(k for k in gm.WEIGHTS if k != "scale")
MIN_GAMES = 5
REFIT_DAYS = 7


def load(season):
    """A season's games as the build reads them, with each skater's
    power-play seconds from the league's per-game report (kept in
    data/nhl/pp_toi/<season>.json.gz: {game id: {player id: seconds}})."""
    pp_path = DATA / "pp_toi" / f"{season}.json.gz"
    with gzip.open(pp_path, "rt", encoding="utf-8") as f:
        pp = json.load(f)
    games = []
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        raw.setdefault("pp_toi", pp.get(path.name.split(".")[0]))
        games.append(b.reduce_game(raw))
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


def np_fit(shots, wing):
    k = 18 if wing else 17
    X = np.zeros((len(shots), k))
    for n, s in enumerate(shots):
        for i, v in gm.xg_features(s, wing):
            X[n, i] = v
    y = np.array([s["goal"] for s in shots], dtype=float)
    w = np.zeros(k)
    w[0] = math.log(y.mean() / (1 - y.mean()))
    ridge = np.diag(np.arange(k) > 0).astype(float) * gm.XG_RIDGE
    for _ in range(30):
        p = 1 / (1 + np.exp(-(X @ w)))
        step = np.linalg.solve(X.T @ (X * (p * (1 - p))[:, None]) + ridge, X.T @ (y - p) - ridge @ w)
        w += step
        if np.abs(step).max() < 1e-7:
            break
    return list(w)


def replay(games, previews, hand):
    shots_model = sm.ShotsModel()
    model = gm.GoalsModel(shots_model, hand)
    history, last_fit, last_played, rows = [], None, {}, []
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    for date in sorted(by_date):
        day = np.datetime64(date)
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(REFIT_DAYS, "D")):
            for s in history:
                s["offwing"] = gm.off_wing(s, hand)
            model.xg = {False: np_fit(history, False), True: np_fit(history, True)}
            last_fit = day
        ranks = {a: model.area_ranks(a) for a in gm.ZONE["areas"]}
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            for pid, line in r["skaters"].items():
                p = model.players.get(pid)
                if not p or p["season"]["games"] < MIN_GAMES:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = model.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid), starters.get(opp))
                if parts is None:
                    continue
                rows.append({"goals": line["g"], "base": parts["base"], "zone": model.zone_match(pid, opp, ranks) is not None, **{f"x_{k}": parts["x"][k] for k in KEYS}})
        for r in by_date[date]:
            shots_model.add_game(r)
            model.add_game(r)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
    return {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}


def X_of(d):
    return np.column_stack([np.ones(len(d["goals"]))] + [d[f"x_{k}"] for k in KEYS])


def main():
    hand = {}
    for season in (2025, 2026):
        for pid, row in b.fetch_report("skater/timeonice", season, "playerId").items():
            if row.get("shootsCatches"):
                hand[str(pid)] = row["shootsCatches"]
    data = {}
    for season in (2025, 2026):
        print(f"Replaying {b.season_label(season)} through goals_model.py...", flush=True)
        games = load(season)
        data[season] = replay(games, load_previews(season, games), hand)
    f, t = data[2025], data[2026]

    w = poisson_fit(X_of(f), f["goals"], np.log(f["base"]))
    lam = np.exp(np.log(t["base"]) + X_of(t) @ w)
    y_any = (t["goals"] > 0).astype(float)
    print(f"\n1. Weights from 2024-25, on 2025-26: log loss {logloss(y_any, lam):.5f}, deviance {deviance(t['goals'], lam):.5f}  (nhl_goals_ideas.py, on shift-chart PP time: 0.39621; on the league's report: 0.39625)")
    print("   ", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, w)})
    chance = 1 - np.exp(-lam)
    print("   model said        games    scored")
    for lo, hi in zip([0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35], [0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 1]):
        m = (chance >= lo) & (chance < hi)
        if m.sum() >= 100:
            print(f"   {100 * lo:3.0f}-{100 * hi:<3.0f}%   {int(m.sum()):>9,} {100 * y_any[m].mean():8.1f}%   (said {100 * chance[m].mean():.1f}%)")
    z = t["zone"] > 0
    print(f"   Zone Match tag: {int(z.sum()):,} games, scored {t['goals'][z].sum() / lam[z].sum():.2f} of what the model said "
          f"(+/- {math.sqrt(t['goals'][z].sum()) / lam[z].sum():.2f}); scored in {100 * y_any[z].mean():.1f}% vs {100 * y_any[~z].mean():.1f}% untagged")

    both = {k: np.concatenate([f[k], t[k]]) for k in f}
    X = X_of(both)
    w_all = poisson_fit(X, both["goals"], np.log(both["base"]))
    mu = np.exp(np.log(both["base"]) + X @ w_all)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    print("\n2. Both seasons together (copy into goals_model.WEIGHTS):")
    print("   WEIGHTS =", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, w_all)})
    print("   (+/-)    ", {k: round(float(v), 3) for k, v in zip(("scale",) + KEYS, se)})
    print("   How far each piece moves the expected goals (middle 80% of players):")
    for i, key in enumerate(KEYS):
        lo, hi = np.percentile(np.exp(w_all[i + 1] * both[f"x_{key}"]), [10, 90])
        print(f"   {key:<10} {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%")


if __name__ == "__main__":
    main()
