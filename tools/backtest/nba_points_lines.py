"""Grade the points factors against THIS season's real lines: when a factor
pointed one way, how often did the Over hit?

The replay (nba_points.py) can only say which factors predict a player's
points; last season has no saved prop lines, so it can't say whether any of
them beat the line. Every build saves each player's main points line at
tip-off (model_history/nba_props/lines_<season>.json), and this report reads
those: each player-game with a line gets the replay's factors (from that
season's games before it, the live rule), and each factor's top third and
bottom third are graded Over / Under. Also graded: the build's own number
(`ours`, `proj`), and the owner's idea C, star lines and the line against the
player's own number.

    py tools/backtest/nba_points_lines.py --season 2027 --data-dir data/nba

Needs officials_<season>.json (tools/backtest/nba_refs.py) for the referee
factors. -110 needs 52.4% to break even; "+/-" is one standard error, so a
gap means something only once it is 2-3 of those away from 50%.
"""
import argparse
import json
import math
from pathlib import Path

import pandas as pd

import nba_points as R

STAR_LINE = 24.5  # a star's line (the owner's idea C: the public's overs push these up)


def graded(df: pd.DataFrame, lines: dict) -> pd.DataFrame:
    rows = []
    for r in df.itertuples(index=False):
        got = (lines.get(str(r.game_id)) or {}).get(str(int(r.player)))
        if got and got[0] is not None:
            rows.append((r.game_id, r.player, *got[:3]))
    g = pd.DataFrame(rows, columns=["game_id", "player", "line", "proj", "ours"]).astype(float)  # ours is None before a player has games
    g = df.astype({"game_id": float, "player": float}).merge(g, on=["game_id", "player"])
    g["over"] = (g["pts"] > g["line"]).astype(float)
    return g[g["pts"] != g["line"]]  # pushes don't count


def row(label: str, over: pd.Series, side: str = "Over"):
    n = len(over)
    if not n:
        print(f"  {label:38} {'':>6}  no plays yet")
        return
    hit = over.mean() if side == "Over" else 1 - over.mean()
    se = math.sqrt(0.25 / n)
    print(f"  {label:38} {n:>6}  {side} {hit:6.1%}  +/- {se:.1%}")


def report(g: pd.DataFrame):
    print(f"{len(g)} player-games with a tip-off line (no pushes)")
    row("every line", g["over"])
    print("\nthe build's own numbers:")
    row("ours above the line", g.loc[g["ours"] > g["line"], "over"])
    row("ours below the line", g.loc[g["ours"] < g["line"], "over"], "Under")
    row("proj above the line", g.loc[g["proj"] > g["line"], "over"])
    row("proj below the line", g.loc[g["proj"] < g["line"], "over"], "Under")
    print("\nidea C (star lines, the line against his own minutes x rate):")
    row(f"line {STAR_LINE}+", g.loc[g["line"] >= STAR_LINE, "over"], "Under")
    row(f"line under {STAR_LINE}", g.loc[g["line"] < STAR_LINE, "over"])
    gap = g["line"] - g["base"]
    row("line 2+ above his base", g.loc[gap >= 2, "over"], "Under")
    row("line 2+ below his base", g.loc[gap <= -2, "over"])
    print("\neach factor, top third vs bottom third (Over %):")
    for c in R.FACTORS:
        v = g[c]
        if v.nunique() <= 2:  # yes / no factors
            row(f"{c} yes", g.loc[v > 0, "over"])
            continue
        lo, hi = v.quantile(1 / 3), v.quantile(2 / 3)
        if lo == hi:
            continue
        row(f"{c} top third", g.loc[v > hi, "over"])
        row(f"{c} bottom third", g.loc[v < lo, "over"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2027)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--min-games", type=int, default=3, help="a player's games this season before the line (the replay uses 5)")
    args = ap.parse_args()
    d = Path(args.data_dir)
    R.MIN_PRIOR_GAMES = args.min_games
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    season = R.P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box)
    refs_file = d / f"officials_{args.season}.json"
    officials = json.loads(refs_file.read_text()) if refs_file.exists() else {}
    df = R.build(season, box, {}, officials)
    lines = json.loads((R.ROOT / "model_history" / "nba_props" / f"lines_{args.season}.json").read_text())
    report(graded(df, lines))


if __name__ == "__main__":
    main()
