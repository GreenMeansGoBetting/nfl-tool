"""Replay the First Basket tip Prediction on a past season: every opening tip
predicted from the jumps BEFORE its date (ratings refit each night), scored
by hit rate and log loss. Compares counting every jump ball (opening tips,
held balls, overtimes) against opening tips only, and tries a few
TIP_PER_INCH / TIP_PULL settings for the opening-tips-only version.

    py tools/backtest/nba_tips.py --season 2026 --data-dir data/nba

Findings (2025-26, 1,230 opening tips of 2,285 jump balls, heights from the
2026-27 roster file, 2026-10-21): every jump ball 64.3% right / log loss
0.627; opening tips only 63.3% / 0.627 (the same fit); height alone 59.7% /
0.657. Over TIP_PER_INCH 0.12-0.18 x TIP_PULL 1.5-5 the log loss stays
0.626-0.631, so 0.15 / 3 stays. The owner's call (2026-10-21): held balls
and the like are dirty data, opening tips only. About 5 minutes.
"""
import argparse
import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "nfl_tool" / "nba"))
import first_basket as fb  # noqa: E402


def all_jumps(pbp, box):
    """(date, game, winner, loser, opening?) for every regular-season jump ball."""
    team_of = {(str(r.game_id), int(r.athlete_id)): r.team_abbreviation for r in box.dropna(subset=["athlete_id"]).itertuples(index=False)}
    date_of = {str(r.game_id): str(r.game_date) for r in box.itertuples(index=False)}
    jumps = pbp[(pbp["season_type"] == 2) & (pbp["type_text"] == "Jumpball")].sort_values(["game_id", "sequence_number"])
    out, seen = [], set()
    for r in jumps.itertuples(index=False):
        gid = str(r.game_id)
        opening = r.period_number == 1 and gid not in seen
        if r.period_number == 1:
            seen.add(gid)
        if pd.isna(r.athlete_id_1) or pd.isna(r.athlete_id_2) or pd.isna(r.team_id):
            continue
        got = {r.home_team_id: r.home_team_abbrev, r.away_team_id: r.away_team_abbrev}.get(r.team_id)
        a, b = int(r.athlete_id_1), int(r.athlete_id_2)
        ta, tb = team_of.get((gid, a)), team_of.get((gid, b))
        if got is None or ta == tb or got not in (ta, tb):
            continue
        w, l = (a, b) if got == ta else (b, a)
        out.append((date_of.get(gid, ""), gid, w, l, opening))
    return out


def replay(jumps, heights, opening_only, per_inch, pull):
    fb.TIP_PER_INCH, fb.TIP_PULL = per_inch, pull
    hits = n = 0
    loss = 0.0
    dates = sorted({j[0] for j in jumps if j[4]})
    for d in dates:
        train = [(w, l) for (dd, _, w, l, op) in jumps if dd < d and (op or not opening_only)]
        ratings = fb.tip_ratings(train, heights) if train else {}
        rate = lambda pid: ratings.get(str(pid), fb.height_rating(heights.get(str(pid))))
        for (dd, _, w, l, op) in jumps:
            if dd != d or not op:
                continue
            p = 1 / (1 + math.exp(rate(l) - rate(w)))  # the winner's predicted chance
            if p == 0.5:
                continue
            n += 1
            hits += p > 0.5
            loss -= math.log(max(1e-9, p))
    return hits / n, loss / n, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    args = ap.parse_args()
    d = Path(args.data_dir)
    pbp = pd.read_parquet(d / f"play_by_play_{args.season}.parquet")
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    rosters = sorted(d.glob("rosters_*.parquet"))
    heights = {}
    for f in rosters:
        for r in pd.read_parquet(f).itertuples(index=False):
            if (h := fb.inches(r.height)):
                heights[str(r.athlete_id)] = h
    jumps = all_jumps(pbp, box)
    print(f"{len(jumps)} jump balls, {sum(j[4] for j in jumps)} opening tips, {len(heights)} heights")
    for label, only in (("every jump ball", False), ("opening tips only", True)):
        hit, ll, n = replay(jumps, heights, only, 0.15, 3.0)
        print(f"{label:20s} per_inch 0.15 pull 3.0: {hit:.1%} right, log loss {ll:.3f} ({n} tips)")
    for per_inch in (0.12, 0.15, 0.18):
        for pull in (1.5, 3.0, 5.0):
            hit, ll, n = replay(jumps, heights, True, per_inch, pull)
            print(f"opening only  per_inch {per_inch:.2f} pull {pull:.1f}: {hit:.1%} right, log loss {ll:.3f}")
    hit, ll, n = replay(jumps, heights, True, 0.15, 1e9)
    print(f"height alone: {hit:.1%} right, log loss {ll:.3f}")


if __name__ == "__main__":
    main()
