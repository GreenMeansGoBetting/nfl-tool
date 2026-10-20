"""Replay King of the Court on a past NBA season, night by night.

Each night every player who played is projected only from that season's games
before the night (kotc.compute_players / compute_defense), then:
  * fits the matchup / total / blowout / back-to-back weights (least squares
    on log(PRA / base), players with a base of 20+, the ones who can win);
  * reports where the night's actual leader ranked, and whether the lead
    chances were honest.

Players are the ones who actually played, so injuries are known in advance
here -- the live page only knows the injury report.

    py tools/backtest/nba_kotc.py --season 2026 --data-dir data/nba

2025-26 (run 2026-10-19, 150 nights after the first 15): fit opp 0.99,
total 0.17, blowout -0.0025 a point, b2b +0.007, last 10 at 0.5. The night's
leader was the board's #1 30% of nights, top 5 64-67%, top 10 83% (season
average alone: 27 / 63 / 79). Lead chances with sd 4 + 0.22 x proj came out
honest: said 7 / 14 / 26 / 42%, happened 6 / 14 / 27 / 41%.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "nfl_tool" / "nba"))
import kotc  # noqa: E402

SKIP_NIGHTS = 15  # the first nights have too little to project from


def rows_for_season(pg: pd.DataFrame, lines: dict) -> pd.DataFrame:
    dates = sorted(pg["date"].unique())
    team_dates = pg.groupby("team")["date"].apply(set).to_dict()
    out = []
    for i, date in enumerate(dates):
        if i < SKIP_NIGHTS:
            continue
        before = pg[pg["date"] < date]
        league = kotc.league_numbers(before, {k: v for k, v in lines.items()})
        defense = kotc.compute_defense(before, league)
        players = kotc.compute_players(before)
        tonight = pg[pg["date"] == date]
        for r in tonight.itertuples(index=False):
            p = players.get(r.id)
            if not p or p["games"] < kotc.MIN_GAMES or (p["min"] or 0) < kotc.MIN_MINUTES:
                continue
            line = lines.get(r.game_id) or [None, None]
            spread = None if line[1] is None else (line[1] if r.home else -line[1])
            opp = defense.get(r.opp) or {}
            out.append({
                "date": date, "id": r.id, "name": r.name, "pra": r.pra, "pos": r.pos,
                "avg": p["pra"], "l10": p["l10"], "base": p["base"],
                "pos_f": (opp.get("pos_f") or {}).get(r.pos) or 1.0,
                "total_r": (line[0] / league["total"]) if line[0] else 1.0,
                "has_total": line[0] is not None,
                "excess": max(0.0, abs(spread) - kotc.WEIGHTS["blowout_from"]) if spread is not None else 0.0,
                "b2b": kotc.played_yesterday(team_dates, r.team, date),
            })
    return pd.DataFrame(out)


def fit(df: pd.DataFrame) -> dict:
    d = df[(df["base"] >= 20) & (df["pra"] > 0) & df["has_total"]].copy()
    best = None
    for l10 in (0.0, 0.2, 0.35, 0.5, 0.7):
        base = (1 - l10) * d["avg"] + l10 * d["l10"]
        y = np.log(d["pra"] / base)
        x = np.column_stack([np.ones(len(d)), np.log(d["pos_f"]), np.log(d["total_r"]), d["excess"], d["b2b"].astype(float)])
        coef, *_ = np.linalg.lstsq(x, y, rcond=None)
        mse = float(np.mean((y - x @ coef) ** 2))
        if best is None or mse < best[0]:
            best = (mse, l10, coef)
    mse, l10, coef = best
    return {"l10": l10, "intercept": round(float(coef[0]), 4), "opp": round(float(coef[1]), 3), "total": round(float(coef[2]), 3),
            "blowout": round(float(coef[3]), 4), "b2b": round(float(coef[4]), 3), "n": len(d), "mse": round(mse, 4)}


def evaluate(df: pd.DataFrame, w: dict, label: str) -> None:
    df = df.copy()
    base = (1 - w["l10"]) * df["avg"] + w["l10"] * df["l10"]
    df["proj"] = base * df["pos_f"] ** w["opp"] * df["total_r"] ** w["total"] * np.exp(w["blowout"] * df["excess"]) * np.exp(w["b2b"] * df["b2b"])
    resid = df["pra"] - df["proj"]
    big = df["proj"] >= 30
    print(f"\n[{label}] PRA miss sd for projections 30+: {resid[big].std():.1f} (mean proj {df.loc[big, 'proj'].mean():.1f})")
    for lo, hi in ((20, 30), (30, 40), (40, 50), (50, 80)):
        m = (df["proj"] >= lo) & (df["proj"] < hi)
        print(f"   proj {lo}-{hi}: n={m.sum()}, actual mean {df.loc[m, 'pra'].mean():.1f}, miss sd {resid[m].std():.1f}")
    ranks, chances, hits = [], [], []
    for date, g in df.groupby("date"):
        g = g.sort_values("proj", ascending=False).reset_index(drop=True)
        best = g["pra"].max()
        winners = g.index[g["pra"] == best]
        ranks.append(int(winners.min()) + 1)
        lead = kotc.lead_chances(g["proj"].tolist(), {**kotc.WEIGHTS, **w}, sims=2000)
        win = (g["pra"] == best).astype(float) / (g["pra"] == best).sum()
        chances.extend(lead)
        hits.extend(win.tolist())
    ranks = np.array(ranks)
    print(f"   nights {len(ranks)}: leader was our #1 {np.mean(ranks == 1):.0%}, top 3 {np.mean(ranks <= 3):.0%}, top 5 {np.mean(ranks <= 5):.0%}, top 10 {np.mean(ranks <= 10):.0%}, median rank {np.median(ranks):.0f}")
    chances, hits = np.array(chances), np.array(hits)
    for lo, hi in ((0.02, 0.05), (0.05, 0.1), (0.1, 0.2), (0.2, 0.35), (0.35, 1.0)):
        m = (chances >= lo) & (chances < hi)
        if m.sum():
            print(f"   lead chance {lo:.0%}-{hi:.0%}: n={m.sum()}, said {chances[m].mean():.1%}, happened {hits[m].mean():.1%}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    args = ap.parse_args()
    box = pd.read_parquet(args.data_dir / f"player_box_{args.season}.parquet")
    teams = set(pd.read_parquet(args.data_dir / "nba_schedule_2027.parquet")["home_abbreviation"]) - {"TBD"}
    lines = json.loads((Path(__file__).resolve().parents[2] / "nfl_tool" / "nba" / f"lines_{args.season}.json").read_text())
    pg = kotc.player_games(box, teams)
    df = rows_for_season(pg, lines)
    print(f"{len(df)} player-nights")
    f = fit(df)
    print("fit:", f)
    evaluate(df, {"l10": 0.0, "opp": 0, "total": 0, "blowout": 0, "b2b": 0}, "season average only")
    evaluate(df, {k: f[k] for k in ("l10", "opp", "total", "blowout", "b2b")}, "fitted")
    evaluate(df, {k: kotc.WEIGHTS[k] for k in ("l10", "opp", "total", "blowout", "b2b")}, "kotc.WEIGHTS")


if __name__ == "__main__":
    main()
