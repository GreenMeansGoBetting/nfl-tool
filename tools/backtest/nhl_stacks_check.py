"""Fits the SHIPPED line stacks model's numbers (nfl_tool/nhl/stacks_model.py)
on the replay's stacks (tools/backtest/nhl_stacks.py chose the approach), and
checks the file's plain-Python math against the replay's.

Only what the site shows: the kinds in stacks_model.KINDS, in games with a
posted projected lineup (the owner: "the projected line only").

  1. Shared ice: stacks_model.shared_ice (plain Python) against the replay's
     table on a handful of saved games. Must agree to the second.
  2. Held out: rho (K = 32, step 1's pick) and the two factors fitted on
     2024-25, scored on 2025-26: log loss against the legs multiplied and
     the joint chance alone, and said vs hit.
  3. Both seasons together: what stacks_model.RHO, WEIGHTS and XG_AVG hold.
  4. stacks_model.adjust(joint_chance(...)) on 3,000 stacks against the
     replay's numbers. Must agree to 1e-9.

First run (2026-10-16): 1. 0 seconds apart. 2. 203,358 stacks on 2025-26:
log loss 0.36474 (legs multiplied 0.37544, joint alone 0.36511); two bins
off by about 2.6 points (pairs said 45%+ hit 48.5% vs 51.1%; 4 legs said
15-20% hit 14.4% vs 17.0%); a re-scaling per number of legs gained 0.00004
and didn't fix them, so it was left out. 3. The numbers now in the file;
said 14.67% / hit 14.58% on 2025-26. 4. 2.9e-16 apart.

    python tools/backtest/nhl_stacks_check.py --rows <folder>   (the folder nhl_stacks.py kept its rows in)
"""
import argparse
import gzip
import json
import math
import pickle
import sys
from itertools import combinations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nhl_stacks as ns  # noqa: E402
from nhl_stacks import DATA, b  # noqa: E402
import stacks_model as km  # noqa: E402

SHIPPED = {"line_pair", "line_trio", "d_pair", "line_fd", "line_pair_d", "line_trio_d", "line_pair_dd", "pp_cross"}


def check_ice(season=2026, count=6):
    worst = 0
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz"))[100:100 + count]:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        with gzip.open(DATA / "shifts" / str(season) / path.name, "rt", encoding="utf-8") as f:
            raw["shifts"] = json.load(f)
        rec = b.reduce_game(raw)
        want = ns.shared_ice(raw, rec)
        marks = []
        for p in sorted(raw["pbp"].get("plays") or [], key=lambda p: p.get("sortOrder", 0)):
            per = p.get("periodDescriptor") or {}
            if per.get("periodType") == "SO" or not per.get("number") or per["number"] > 4:
                continue
            code = p.get("situationCode")
            marks.append(((per["number"] - 1) * ns.PERIOD + b.clock_seconds(p.get("timeInPeriod")), b.strength(code, True), b.strength(code, False)))
        even, pp = km.phases(marks, ns.SPAN)
        for team, side in ((rec["home"], "home"), (rec["away"], "away")):
            spans = {pid: [] for pid, s in rec["skaters"].items() if s["team"] == team}
            for pid, _t, per, on, off in raw["shifts"]:
                if str(pid) in spans and per <= 4:
                    a, z = (per - 1) * ns.PERIOD + b.clock_seconds(on), (per - 1) * ns.PERIOD + b.clock_seconds(off)
                    spans[str(pid)].append((a, z))
            got = km.shared_ice(spans, even, pp[side])
            ids, ev, ppm = want[team]
            for i, p in enumerate(ids):
                worst = max(worst, abs(got["toi"][p][0] - ev[i, i]), abs(got["toi"][p][1] - ppm[i, i]))
                for j in range(i + 1, len(ids)):
                    pair = got["pairs"].get(tuple(sorted((p, ids[j]))), [0, 0])
                    worst = max(worst, abs(pair[0] - ev[i, j]), abs(pair[1] - ppm[i, j]))
    print(f"1. Shared ice, plain Python vs the replay, {count} games: largest gap {worst:.0f} seconds")


def shipped(d):
    st = d["stacks"]
    posted = set(st["game"][np.char.startswith(st["kind"].astype(str), "u_line")])
    m = np.isin(st["kind"], list(SHIPPED)) & np.isin(st["game"], list(posted))
    used = np.unique(np.concatenate([st["idx2"][m].ravel(), st["idx3"][m].ravel()]))
    sub_m = np.zeros(len(d["subsets"]["rel"]), dtype=bool)
    sub_m[used[used >= 0]] = True
    return m, sub_m


def masked(sub, m):
    return {k: v[m] for k, v in sub.items()}


def factors(st, m, xg_avg):
    n = st["n"][m]
    x = st["x"][m].astype(float)
    return np.column_stack([np.ones(m.sum()), np.log(x[:, 0] / np.array([xg_avg[k] for k in n])), x[:, 4]])


def fit(datasets):
    """rho, XG_AVG and the factor weights from these seasons' shipped stacks."""
    subs = [masked(d["subsets"], d["sub_m"]) for d in datasets]
    rho = ns.rho_fit({k: np.concatenate([s[k] for s in subs]) for k in subs[0]}, km.K)
    xs, ns_ = np.concatenate([d["stacks"]["x"][d["m"]][:, 0].astype(float) for d in datasets]), np.concatenate([d["stacks"]["n"][d["m"]] for d in datasets])
    xg_avg = {n: float(xs[ns_ == n].mean()) for n in (2, 3, 4)}
    X, y, off, g = [], [], [], []
    shift = 0
    for d in datasets:
        st, m = d["stacks"], d["m"]
        joint = ns.joint(st, ns.subset_lam(d["subsets"], rho, km.K))
        X.append(factors(st, m, xg_avg))
        y.append(st["hit"][m])
        off.append(ns.logit(joint[m]))
        g.append(st["game"][m] + shift)
        shift += st["game"].max() + 1
    w, se = ns.logistic(np.concatenate(X), np.concatenate(y), np.concatenate(off), np.concatenate(g))
    return rho, xg_avg, w, se


def predict(d, rho, xg_avg, w):
    st, m = d["stacks"], d["m"]
    joint = ns.joint(st, ns.subset_lam(d["subsets"], rho, km.K))[m]
    z = ns.logit(joint) + factors(st, m, xg_avg) @ w
    return joint, np.minimum(1 / (1 + np.exp(-z)), np.nanmin(st["p"][m], axis=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True, help="the folder nhl_stacks.py --rows kept its rows in")
    args = ap.parse_args()
    data = {}
    for season in (ns.FIT, ns.TEST):
        with open(Path(args.rows) / f"stacks_{season}.pkl", "rb") as f:
            d = pickle.load(f)
        d["stacks"]["hit"] = d["stacks"]["hit"].astype(float)
        d["stacks"]["prod"] = ns.product(d["stacks"])
        d["m"], d["sub_m"] = shipped(d)
        data[season] = d
    check_ice()

    f, t = data[ns.FIT], data[ns.TEST]
    rho, xg_avg, w, se = fit([f])
    joint, p = predict(t, rho, xg_avg, w)
    y = t["stacks"]["hit"][t["m"]]
    print(f"\n2. Fitted on 2024-25, scored on 2025-26 ({int(t['m'].sum()):,} stacks the site would show):")
    print(f"   log loss: legs multiplied {ns.logloss(y, t['stacks']['prod'][t['m']]):.5f}, joint {ns.logloss(y, joint):.5f}, with the factors {ns.logloss(y, p):.5f}")
    print("   weights (const, xg, pp):", np.round(w, 3), " +/-", np.round(se, 3))
    n = t["stacks"]["n"][t["m"]]
    for legs in (2, 3, 4):
        ns.honest(y[n == legs], p[n == legs], f"{legs} legs:")
    kinds = t["stacks"]["kind"][t["m"]]
    print("   By kind: said / hit / legs multiplied")
    for kind in sorted(SHIPPED):
        k = kinds == kind
        print(f"     {kind:<13} {int(k.sum()):>7,}  said {100 * p[k].mean():5.1f}%  hit {100 * y[k].mean():5.1f}%  multiplied {100 * t['stacks']['prod'][t['m']][k].mean():5.1f}%")

    rho, xg_avg, w, se = fit([f, t])
    print("\n3. Both seasons together (copy into stacks_model.py):")
    print("   RHO =", {k: round(float(v), 3) for k, v in sorted(rho.items()) if k != "opp"})
    print("   WEIGHTS =", {"const": round(float(w[0]), 3), "xg": round(float(w[1]), 3), "pp": round(float(w[2]), 3)}, " +/-", np.round(se, 3))
    print("   XG_AVG =", {k: round(v, 3) for k, v in xg_avg.items()})
    for season, d in data.items():
        _, p = predict(d, rho, xg_avg, w)
        y = d["stacks"]["hit"][d["m"]]
        print(f"   {b.season_label(season)}: said {100 * p.mean():.2f}%, hit {100 * y.mean():.2f}%, log loss {ns.logloss(y, p):.5f}")

    # 4. The file's own math on a sample of 2025-26 stacks, with these numbers.
    weights = {"const": float(w[0]), "xg": float(w[1]), "pp": float(w[2])}
    km.XG_AVG.update(xg_avg)
    _, want = predict(t, rho, xg_avg, w)
    st, sub = t["stacks"], t["subsets"]
    rows = np.flatnonzero(t["m"])
    pick = np.random.default_rng(1).choice(len(rows), 3000, replace=False)
    worst = 0.0
    for i in pick:
        r = rows[i]
        legs = int(st["n"][r])
        chances = list(st["p"][r][:legs])
        rates = [-math.log(1 - c) for c in chances]
        shared = {}
        for c, pq in enumerate(combinations(range(legs), 2)):
            s = st["idx2"][r][c]
            shared[pq] = km.shared_rate(str(sub["rel"][s]), [rates[j] for j in pq], sub["co"][s], sub["base"][s], rho)
        for c, tr in enumerate(combinations(range(legs), 3)):
            s = st["idx3"][r][c]
            shared[tr] = km.shared_rate(str(sub["rel"][s]), [rates[j] for j in tr], sub["co"][s], sub["base"][s], rho)
        joint = km.joint_chance(chances, shared)
        got = km.adjust(joint, legs, float(st["x"][r][0]), float(st["x"][r][4]), min(chances), weights)
        worst = max(worst, abs(got - want[i]))
    print(f"\n4. stacks_model.py against the replay on 3,000 stacks: largest gap {worst:.2e}")


if __name__ == "__main__":
    main()
