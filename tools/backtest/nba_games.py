"""Replay an NBA game model on a past season, night by night.

Each night every game is projected only from that season's games BEFORE the
night (the live rule: plays come from this season only), then compared with
the final score and with DraftKings' closing line (nfl_tool/nba/lines_2026.json).

Models (all from the engine's possessions, nfl_tool/nba/possessions.py):
  raw     points a possession for and against, and pace, each steadied toward
          the league with K games of the league average
  adj     the same after taking out who each team played (offense and
          defense ratings solved together, like a power rating)
  blend   the market's line moved toward `adj` by a weight fitted on the
          season (how far to trust our number over the line)

Reported: how far each is from the final margin / total (mean absolute
error), how that shrinks as the season goes on, and the record against the
closing line when our number disagrees with it by 1, 2, 3, 4+ points.

    py tools/backtest/nba_games.py --season 2026 --data-dir data/nba

2025-26 (run 2026-10-20, 1,158 games after the first 10 nights, about 2
minutes): NONE of them beats DraftKings' closing line. Mean miss on the final
margin: raw 11.50, adj 11.54, lineup 11.55 (11.56 with players pulled in
less, --lam 800), the line 10.86; on the total 15.29 / 15.76 / 15.26 against
14.66. The fitted blend puts a NEGATIVE weight on ours (-0.10 to -0.15), and
where ours and the line disagree the result sides with the line (correlation
of ours-minus-line with result-minus-line -0.03; against the spread 41-56%
by gap, no gap size over 52.4% on enough games). The lineup model knew who
played and still lost, so the line's edge isn't only injury news. Margins
vary around ours with an sd of 14.7. The owner was told: no fair value
"edge" on full-game spreads / totals; our record against Novig's opening and
tip-off lines this season is the next test.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import possessions as P  # noqa: E402

SKIP_NIGHTS = 10


def team_games(season: P.Season, box: pd.DataFrame) -> pd.DataFrame:
    """One row a team a game: date, home, opponent, possessions, points, seconds."""
    poss = season.possessions
    end = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max().clip(lower=2880)
    g = poss.groupby(["game_id", "off"]).agg(poss=("pts", "size"), pts=("pts", "sum")).reset_index()
    g = g.rename(columns={"off": "team"})
    reg = box[box["season_type"] == P.REGULAR_SEASON]
    info = reg.groupby(["game_id", "team_id"]).agg(date=("game_date", "first"), home=("home_away", "first"),
                                                   final=("team_score", "max")).reset_index()
    info = info.rename(columns={"team_id": "team"})
    g = g.merge(info, on=["game_id", "team"])
    g["home"] = g["home"] == "home"
    g["secs"] = g["game_id"].map(end)
    opp = g[["game_id", "team", "poss", "pts", "final"]].rename(
        columns={"team": "opp", "poss": "opp_poss", "pts": "opp_pts", "final": "opp_final"})
    g = g.merge(opp, on="game_id")
    g = g[g["team"] != g["opp"]]
    g["date"] = pd.to_datetime(g["date"]).dt.strftime("%Y-%m-%d")
    return g.sort_values(["date", "game_id"]).reset_index(drop=True)


def ratings(prior: pd.DataFrame, k: float, adjust: bool) -> tuple:
    """({team: (off ppp, def ppp, pace)}, league ppp, league pace, home edge in points)."""
    lg_ppp = prior["pts"].sum() / prior["poss"].sum()
    lg_pace = (prior["poss"].sum() * 2880 / prior["secs"].sum())
    home = prior[prior["home"]]
    home_edge = float((home["final"] - home["opp_final"]).mean()) if len(home) else 0.0
    by = prior.groupby("team")
    n = by.size()
    off = by["pts"].sum() / by["poss"].sum()
    de = by["opp_pts"].sum() / by["opp_poss"].sum()
    pace = by["poss"].sum() * 2880 / by["secs"].sum()
    if adjust:
        # take out who each team played: a game's ppp ~ league + offense edge + other defense edge
        o_edge = (off - lg_ppp).to_dict()
        d_edge = (de - lg_ppp).to_dict()
        p_edge = (pace - lg_pace).to_dict()
        games = prior[["team", "opp", "pts", "poss", "secs"]].to_numpy()
        for _ in range(8):
            o_sum, d_sum, p_sum, w = {}, {}, {}, {}
            for team, opp, pts, ps, secs in games:
                ppp = pts / ps
                o_sum[team] = o_sum.get(team, 0) + (ppp - lg_ppp - d_edge.get(opp, 0)) * ps
                d_sum[opp] = d_sum.get(opp, 0) + (ppp - lg_ppp - o_edge.get(team, 0)) * ps
                p_sum[team] = p_sum.get(team, 0) + (ps * 2880 / secs - lg_pace - p_edge.get(opp, 0))
                w[team] = w.get(team, 0) + ps
            o_edge = {t: o_sum[t] / w[t] for t in o_sum}
            d_edge = {t: d_sum[t] / w[t] for t in d_sum}
            p_edge = {t: p_sum[t] / n[t] for t in p_sum}
        off = pd.Series({t: lg_ppp + v for t, v in o_edge.items()})
        de = pd.Series({t: lg_ppp + v for t, v in d_edge.items()})
        pace = pd.Series({t: lg_pace + v / 2 for t, v in p_edge.items()})
    shrink = n / (n + k)
    out = {}
    for t in n.index:
        s = shrink[t]
        out[t] = (lg_ppp + (off[t] - lg_ppp) * s, lg_ppp + (de[t] - lg_ppp) * s, lg_pace + (pace[t] - lg_pace) * s)
    return out, lg_ppp, lg_pace, home_edge


def player_ratings(poss: pd.DataFrame, home_of: dict, lam: float) -> tuple:
    """Each player's points a possession added on offense and allowed on defense
    with him on the floor, all ten players solved together (ridge regression,
    pulled toward 0 = average by `lam` possessions), plus the home offense's
    edge a possession. ({player: offense}, {player: defense}, home edge)."""
    o = poss[["o1", "o2", "o3", "o4", "o5"]].to_numpy()
    d = poss[["d1", "d2", "d3", "d4", "d5"]].to_numpy()
    ok = ~(pd.isna(o).any(axis=1) | pd.isna(d).any(axis=1))
    o, d = o[ok].astype(np.int64), d[ok].astype(np.int64)
    y = poss["pts"].to_numpy()[ok].astype(float)
    y = y - y.mean()
    home = (poss["off"].to_numpy()[ok] == poss["game_id"].map(home_of).to_numpy()[ok]).astype(float) * 2 - 1
    players = np.unique(np.concatenate([o.ravel(), d.ravel()]))
    idx = {p: i for i, p in enumerate(players)}
    n = len(players)
    cols = np.concatenate([np.vectorize(idx.get)(o), np.vectorize(idx.get)(d) + n, np.full((len(y), 1), 2 * n)], axis=1)
    size = 2 * n + 1
    vals = np.concatenate([np.ones((len(y), 10)), home[:, None]], axis=1)
    # X'X and X'y from the 11 entries in each row
    xtx = np.zeros(size * size)
    for a in range(11):
        for b in range(11):
            np.add.at(xtx, cols[:, a] * size + cols[:, b], vals[:, a] * vals[:, b])
    xtx = xtx.reshape(size, size)
    xty = np.zeros(size)
    for a in range(11):
        np.add.at(xty, cols[:, a], vals[:, a] * y)
    reg = np.full(size, lam)
    reg[-1] = 1.0  # the home edge is barely pulled in
    beta = np.linalg.solve(xtx + np.diag(reg), xty)
    return ({int(p): beta[i] for p, i in idx.items()}, {int(p): beta[i + n] for p, i in idx.items()}, float(beta[-1]))


def project(r, lg_ppp, lg_pace, home_edge, home, away):
    """(home points, away points)."""
    ho, hd, hp = r.get(home, (lg_ppp, lg_ppp, lg_pace))
    ao, ad, ap = r.get(away, (lg_ppp, lg_ppp, lg_pace))
    pace = lg_pace + (hp - lg_pace) + (ap - lg_pace)
    h = (ho + ad - lg_ppp) * pace
    a = (ao + hd - lg_ppp) * pace
    return h + home_edge / 2, a - home_edge / 2


REFIT_NIGHTS = 7


def replay(tg: pd.DataFrame, lines: dict, k: float, poss: pd.DataFrame, minutes: pd.DataFrame, lam: float) -> pd.DataFrame:
    """minutes: one row a player a game (game_id, date, team, player, min)."""
    dates = sorted(tg["date"].unique())
    home_of = tg[tg["home"]].set_index("game_id")["team"].to_dict()
    date_of = tg.drop_duplicates("game_id").set_index("game_id")["date"]
    poss = poss.assign(date=poss["game_id"].map(date_of))
    rows = []
    pr = None
    for i, date in enumerate(dates):
        if i < SKIP_NIGHTS:
            continue
        if pr is None or (i - SKIP_NIGHTS) % REFIT_NIGHTS == 0:
            pr = player_ratings(poss[poss["date"] < date], home_of, lam)
        o_r, d_r, home_ppp = pr
        before = minutes[minutes["date"] < date]
        avg_min = before.groupby("player")["min"].mean()
        prior = tg[tg["date"] < date]
        today = tg[(tg["date"] == date) & tg["home"]]
        fits = {name: ratings(prior, k, adj) for name, adj in (("raw", False), ("adj", True))}
        games_before = prior.groupby("team").size()
        for g in today.itertuples(index=False):
            line = lines.get(str(g.game_id)) or [None, None]
            row = {"date": date, "night": i, "game_id": g.game_id, "home": g.team, "away": g.opp,
                   "margin": g.final - g.opp_final, "total": g.final + g.opp_final,
                   "games": min(games_before.get(g.team, 0), games_before.get(g.opp, 0)),
                   "line_total": line[0], "line_margin": None if line[1] is None else -line[1]}
            for name, (r, lp, lpace, he) in fits.items():
                h, a = project(r, lp, lpace, he, g.team, g.opp)
                row[f"{name}_margin"] = h - a
                row[f"{name}_total"] = h + a
            # lineup: the players who played tonight, each at his average minutes
            # so far (the replay knows who played; live, the injury report and
            # the NBA's lineups say), rated on every possession before tonight
            r, lp, lpace, he = fits["raw"]
            tonight = minutes[minutes["game_id"] == g.game_id]
            eff = {}
            for side in (g.team, g.opp):
                ps = tonight[tonight["team"] == side]["player"]
                m = avg_min.reindex(ps).fillna(0)
                if m.sum() > 0:
                    m = m * 240 / m.sum()
                eff[side] = (sum(o_r.get(int(p), 0) * v / 48 for p, v in m.items()),
                             sum(d_r.get(int(p), 0) * v / 48 for p, v in m.items()))
            pace = lpace + (r.get(g.team, (0, 0, lpace))[2] - lpace) + (r.get(g.opp, (0, 0, lpace))[2] - lpace)
            h = (lp + eff[g.team][0] + eff[g.opp][1] + home_ppp) * pace
            a = (lp + eff[g.opp][0] + eff[g.team][1] - home_ppp) * pace
            row["lineup_margin"] = h - a
            row["lineup_total"] = h + a
            rows.append(row)
    return pd.DataFrame(rows)


def ats(df, ours, line, actual, label):
    """Record of the side our number picks against the line, by how far apart."""
    d = df.dropna(subset=[line])
    gap = d[ours] - d[line]
    res = d[actual] - d[line]
    print(f"  {label}: our side against the closing line")
    for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 99)):
        m = (gap.abs() >= lo) & (gap.abs() < hi) & (res != 0)
        if not m.any():
            continue
        win = (np.sign(gap[m]) == np.sign(res[m])).mean()
        print(f"    {lo}-{hi if hi < 99 else '+'} pts apart: {m.sum():4d} games, {win * 100:5.1f}% (52.4% breaks even at -110)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--k", type=float, default=8)
    ap.add_argument("--lam", type=float, default=3000, help="possessions pulling each player toward average")
    args = ap.parse_args()
    d = Path(args.data_dir)
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    season = P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box)
    tg = team_games(season, box)
    lines = json.loads((ROOT / "nfl_tool" / "nba" / f"lines_{args.season}.json").read_text())
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & ~box["did_not_play"].astype(bool) & box["athlete_id"].notna()]
    minutes = pd.DataFrame({"game_id": reg["game_id"], "date": pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d"),
                            "team": reg["team_id"].astype(int), "player": reg["athlete_id"].astype(int),
                            "min": reg["minutes"].fillna(0).astype(float)})
    minutes = minutes[minutes["min"] > 0]
    df = replay(tg, lines, args.k, season.possessions, minutes, args.lam)
    df.to_csv(Path(args.data_dir) / f"game_replay_{args.season}.csv", index=False)
    report(df)


def report(df):
    print(f"{len(df)} games after the first {SKIP_NIGHTS} nights")
    m = df.dropna(subset=["line_margin"])
    t = df.dropna(subset=["line_total"])
    print(f"\nMean miss on the final MARGIN ({len(m)} games with a closing spread):")
    for c in ("raw_margin", "adj_margin", "lineup_margin", "line_margin"):
        print(f"  {c:12} {(m[c] - m['margin']).abs().mean():.2f}")
    print(f"Mean miss on the final TOTAL ({len(t)} games with a closing total):")
    for c in ("raw_total", "adj_total", "lineup_total", "line_total"):
        print(f"  {c:12} {(t[c] - t['total']).abs().mean():.2f}")
    # how far to trust our number over the line (least squares on the residual)
    for kind in ("margin", "total"):
        dd = df.dropna(subset=[f"line_{kind}"])
        x = dd[f"lineup_{kind}"] - dd[f"line_{kind}"]
        y = dd[kind] - dd[f"line_{kind}"]
        w = float((x * y).sum() / (x * x).sum())
        blend = dd[f"line_{kind}"] + w * x
        print(f"  blend {kind}: weight on ours {w:.2f}, mean miss {(blend - dd[kind]).abs().mean():.2f}")
    print("\nBy how many games the teams had played (margin mean miss: adj / line):")
    for lo, hi in ((0, 10), (10, 20), (20, 40), (40, 90)):
        x = m[(m["games"] >= lo) & (m["games"] < hi)]
        if len(x):
            print(f"  {lo:2d}-{hi:2d} games: {len(x):4d} games  {(x['lineup_margin'] - x['margin']).abs().mean():.2f} / {(x['line_margin'] - x['margin']).abs().mean():.2f}")
    print()
    ats(df, "lineup_margin", "line_margin", "margin", "Spread")
    ats(df, "lineup_total", "line_total", "total", "Total")
    sd = (m["lineup_margin"] - m["margin"]).std()
    print(f"\nSpread of the final margin around ours: sd {sd:.1f} (for win chances)")


if __name__ == "__main__":
    main()
