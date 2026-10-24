"""Replay the NBA game simulation (nfl_tool/nba/sim.py) on a past season, the
way the live build would have run it: each test night's games simulated from
that season's games BEFORE the night only, with the players who really sat
taken out (the live page has the injury report).

What it checks (the owner, 2026-10-24: "as long as the logic is built in to
rely on the right things"):
  level     the sim's average team score, player points and threes against
            what happened (a sim that runs hot sees Overs everywhere)
  spread    how wide its outcomes are: the share of real results inside the
            sim's own 10-90% range (80% if right), and the PIT deciles (each
            10% if right). Too narrow = chances too sure of themselves.
  vs books  the sim's game total and margin against the closing total and
            spread (2025-26's saved lines), as a yardstick only: the sim never
            reads them.

    py tools/backtest/nba_sim.py --season 2026 --data-dir data/nba [--every 3] [--n 4000] [--starters] [--set NAME=value]

--starters hands the sim each game's real starting fives, the way the NBA's
lineups file does live; --set tries a constant (e.g. --set STARTER_TRUST=0.9).

Run 2026-10-24 on 2025-26 (every 3rd night from Dec 1: 299 games, 6,145
player-games, about 4 minutes). The constants in sim.py were set here:
  level     team points +0.4 a game, player points +0.25, threes +0.04
            (LEVEL 0.99 took off the first run's +1.2)
  spread    inside the sims' 10-90%: margin 80%, total 84%, player points 77%
            (PIT deciles 9-13%; the bottom one a little heavy: real duds are
            still a bit more common than the sims say), threes PIT 9-12%.
            Before possessions were steady, misses tied to second chances and
            the lead shrink (LEAD_DRAG), the margin's spread was 24 points
            (real: about 13) and blowouts came 39% / 30% of games.
  vs books  the closing total missed by 14.5, the sims by 15.2; the closing
            spread by 11.2, the sims by 12.4. The books are better at the
            final score; the record decides whether the sims' disagreements
            with their prices are edges.
  injuries  an Out player's minutes to his own position first made minutes
            worse (miss 5.1 with half of them, 6.3 with all, 4.8 handing them
            to everyone in proportion): not used.
  starters  real fives (--starters, every 2nd night): fill-in starters
            (usually under 20 minutes) really played 25.5; the sims gave 19.9
            with no starting five, 28.2 with a floor of 0.9 of the team's
            starter minutes, 25.9 with 0.8 (STARTER_TRUST, their points 10.7
            against 9.9 real).
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import possessions as P  # noqa: E402
import sim  # noqa: E402


def pit(values: np.ndarray, actual: float, rng) -> float:
    """Where the real result falls in the sim's outcomes (0-1), a tie spread
    evenly (counts are whole numbers)."""
    below = (values < actual).mean()
    at = (values == actual).mean()
    return below + at * rng.random()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--every", type=int, default=3, help="test every Nth game night")
    ap.add_argument("--start", default="2025-12-01")
    ap.add_argument("--n", type=int, default=4000)
    ap.add_argument("--set", action="append", default=[], help="override a sim constant, NAME=value")
    ap.add_argument("--starters", action="store_true", help="hand the sim each game's real starting fives, as the NBA's lineups file would")
    args = ap.parse_args()
    for kv in args.set:
        k, v = kv.split("=")
        setattr(sim, k, float(v))
    d = ROOT / args.data_dir
    t0 = time.time()
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    season = P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box)
    lines_path = ROOT / "nfl_tool" / "nba" / f"lines_{args.season}.json"
    lines = json.loads(lines_path.read_text()) if lines_path.exists() else {}
    print(f"engine built in {time.time() - t0:.0f}s", file=sys.stderr)

    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    games = reg.drop_duplicates(["game_id", "team_id"])
    nights = sorted(d for d in games["date"].unique() if d >= args.start)[::args.every]
    rng = np.random.default_rng(7)
    team_rows, player_rows = [], []
    for night in nights:
        inputs = sim.season_inputs(season, box, night)
        tonight = reg[reg["date"] == night]
        for gid, rows in tonight.groupby("game_id"):
            home = rows[rows["home_away"] == "home"]
            away = rows[rows["home_away"] == "away"]
            if home.empty or away.empty:
                continue
            h, a = home["team_abbreviation"].iloc[0], away["team_abbreviation"].iloc[0]
            # everyone who didn't play is Out (the box score skips some inactive players
            # entirely; the live build has the injury report)
            played = {int(x) for x in rows.loc[~rows["did_not_play"].astype(bool) & (rows["minutes"].fillna(0) > 0), "athlete_id"]}
            out_ids = {str(pid) for pid in inputs["players"] if pid not in played}
            lineups = None
            if args.starters:
                five = lambda side: [{"playerName": r.athlete_display_name, "firstName": "", "lastName": "", "lineupStatus": "Confirmed",  # noqa: E731
                                      "rosterStatus": "Active"} for r in side.itertuples(index=False) if r.starter]
                lineups = {"games": [{"homeTeam": {"teamAbbreviation": h, "players": five(home)}, "awayTeam": {"teamAbbreviation": a, "players": five(away)}}]}
            out = sim.game(inputs, h, a, night, out_ids, n=args.n, seed=int(gid) % 100000, lineups=lineups)
            hs, as_ = int(home["team_score"].iloc[0]), int(away["team_score"].iloc[0])
            line = lines.get(str(gid)) or [None, None]
            for key, score, opp_score in (("home", hs, as_), ("away", as_, hs)):
                team_rows.append({"night": night, "sim": out[key]["pts"].sum(1).mean(), "actual": score})
            game_row = {"night": night, "margin_sim": out["margin"].mean(), "margin": hs - as_,
                        "margin_pit": pit(out["margin"], hs - as_, rng), "total_sim": out["total"].mean(), "total": hs + as_,
                        "total_pit": pit(out["total"], hs + as_, rng), "book_total": line[0],
                        "book_margin": None if line[1] is None else -line[1]}
            team_rows[-2].update(game_row)
            actual = {int(r.athlete_id): r for r in rows.itertuples(index=False) if not r.did_not_play and (r.minutes or 0) > 0}
            for key in ("home", "away"):
                st = out[key]
                for j, pid in enumerate(st["s"]["pids"]):
                    r = actual.get(pid)
                    if r is None:
                        continue
                    pts, f3 = st["pts"][:, j], st["fg3m"][:, j]
                    player_rows.append({
                        "night": night, "min_sim": st["min"][:, j].mean(), "min": float(r.minutes),
                        "pts_sim": pts.mean(), "pts": int(r.points), "pts_pit": pit(pts, int(r.points), rng),
                        "pts_lo": np.percentile(pts, 10), "pts_hi": np.percentile(pts, 90),
                        "f3_sim": f3.mean(), "f3": int(r.three_point_field_goals_made), "f3_pit": pit(f3, int(r.three_point_field_goals_made), rng),
                        "starter": bool(r.starter), "usual_min": sim.project_minutes(inputs["players"][pid]["min"]),
                    })
        print(f"{night}: {len(team_rows) // 2} games so far, {time.time() - t0:.0f}s", file=sys.stderr)

    T = pd.DataFrame(team_rows)
    G = T.dropna(subset=["margin_sim"])
    Pl = pd.DataFrame(player_rows)
    print(f"{len(G)} games, {len(Pl)} player-games, {len(nights)} nights from {nights[0]} ({time.time() - t0:.0f}s)")
    print(f"Team points: sim {T.sim.mean():.1f}, real {T.actual.mean():.1f} (bias {T.sim.mean() - T.actual.mean():+.2f}); "
          f"miss {np.abs(T.sim - T.actual).mean():.2f}, sd {np.std(T.actual - T.sim):.1f}")
    deciles = lambda x: " ".join(f"{v:.0%}" for v in np.histogram(x, bins=10, range=(0, 1))[0] / len(x))  # noqa: E731
    print(f"Margin: miss {np.abs(G.margin_sim - G.margin).mean():.2f}; sd of real - sim {np.std(G.margin - G.margin_sim):.1f}; "
          f"inside sim 10-90% {G.margin_pit.between(0.1, 0.9).mean():.0%}; PIT {deciles(G.margin_pit)}")
    print(f"Total: miss {np.abs(G.total_sim - G.total).mean():.2f}; inside 10-90% {G.total_pit.between(0.1, 0.9).mean():.0%}; PIT {deciles(G.total_pit)}")
    b = G.dropna(subset=["book_total"])
    if len(b):
        print(f"  vs the closing total ({len(b)} games): book miss {np.abs(b.book_total - b.total).mean():.2f}, sim miss {np.abs(b.total_sim - b.total).mean():.2f}")
    b = G.dropna(subset=["book_margin"])
    if len(b):
        print(f"  vs the closing spread ({len(b)} games): book miss {np.abs(b.book_margin - b.margin).mean():.2f}, sim miss {np.abs(b.margin_sim - b.margin).mean():.2f}")
    print(f"Players: points sim {Pl.pts_sim.mean():.2f} real {Pl.pts.mean():.2f} (bias {Pl.pts_sim.mean() - Pl.pts.mean():+.2f}), "
          f"miss {np.abs(Pl.pts_sim - Pl.pts).mean():.2f}; minutes sim {Pl.min_sim.mean():.1f} real {Pl['min'].mean():.1f}, miss {np.abs(Pl.min_sim - Pl['min']).mean():.1f}")
    print(f"  points inside sim 10-90% {Pl.pts_pit.between(0.1, 0.9).mean():.0%}; PIT {deciles(Pl.pts_pit)}")
    for lo, hi, label in ((0, 10, "under 10"), (10, 18, "10-18"), (18, 25, "18-25"), (25, 99, "25+")):
        s = Pl[(Pl.pts_sim >= lo) & (Pl.pts_sim < hi)]
        if len(s):
            print(f"  sim {label:8} {len(s):5}: sim {s.pts_sim.mean():5.1f} real {s.pts.mean():5.1f}; inside 10-90% {s.pts_pit.between(0.1, 0.9).mean():.0%}; PIT {deciles(s.pts_pit)}")
    print(f"Threes: sim {Pl.f3_sim.mean():.2f} real {Pl.f3.mean():.2f} (bias {Pl.f3_sim.mean() - Pl.f3.mean():+.2f}); PIT {deciles(Pl.f3_pit)}")
    for lo, hi, label in ((0, 1, "under 1"), (1, 2, "1-2"), (2, 99, "2+")):
        s = Pl[(Pl.f3_sim >= lo) & (Pl.f3_sim < hi)]
        if len(s):
            print(f"  sim {label:8} {len(s):5}: sim {s.f3_sim.mean():4.2f} real {s.f3.mean():4.2f}; PIT {deciles(s.f3_pit)}")
    st = Pl[Pl.starter]
    print(f"Starters: minutes sim {st.min_sim.mean():.1f} real {st['min'].mean():.1f}; points sim {st.pts_sim.mean():.1f} real {st.pts.mean():.1f}")
    fill = Pl[Pl.starter & (Pl.usual_min < 20)]
    print(f"Fill-in starters (usually under 20 minutes, started): {len(fill)}; minutes sim {fill.min_sim.mean():.1f} real {fill['min'].mean():.1f}; "
          f"points sim {fill.pts_sim.mean():.1f} real {fill.pts.mean():.1f}; inside 10-90% {fill.pts_pit.between(0.1, 0.9).mean():.0%}")


if __name__ == "__main__":
    main()
