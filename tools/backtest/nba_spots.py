"""Situational spots (the owner's list, 2026-10-24): does a schedule, last-game
or streak spot change how an NBA game goes, and does Vegas already price it?

The owner's question after the Pacers (favored by 7 at home, two days after a
3-point win) got blown out by Dallas (off an 18-point loss): can we see those
games coming? Every spot is flagged by a fixed rule from what was known before
tip, then measured on ten past regular seasons (2014-15 to 2018-19 and
2021-22 to 2025-26; the 2020 bubble and the 2021 no-fans season left out).

Every team-game is measured against the team's "normal" for that game: a
season rating fit on every game (margin = home edge + team - opponent, the
same for points scored and threes made). So "Margin +1.2" = the team in the
spot beat its normal margin by 1.2 points. Player spots compare a player's
game with his season average without that game. Also reported:
  Short 10   how often the team fell 10+ short of its normal (base about 21%)
  ATS        against the closing spread (2025-26 only, the saved DraftKings
             lines in nfl_tool/nba/lines_2026.json): points past the spread
             and cover %. A real spot with ATS near 0 = Vegas already has it.
  Total      points past the closing total (2025-26 only, 979 games).
  t          the effect over its noise; 2 or more is unlikely to be luck,
             3 or more very unlikely. With ~60 rows tested, one or two land
             past 2 by luck alone.
  Seasons    how many of the ten seasons point the same way.

    py tools/backtest/nba_spots.py --data-dir data/nba

Needs the hoopR schedule / team_box / player_box files for 2014-2026 (2014
and 2021 for last-season ratings only) in --data-dir; --download fetches
the missing ones. Player spots also show the game against his last 10
(pts10 / 3PM10: the recent form a line leans on) and given the minutes he
played (ptsMin / 3PMMin: form, not role).

Run 2026-10-24 (24,602 team-games, about a minute). Margin swings 12.8 around
normal, so even the real spots are 1-3 points of it.
  Real, and Vegas already prices them (ATS near 0 in 2025-26):
    rest edge (B2B vs 2+ off) -2.6 margin, the rested side scores +1.9;
    back-to-back -1.4 (home-home -1.8), points -0.8; 3 in 4 -0.8; 4 in 6 -0.6;
    OT legs -0.9 (points -1.1); top scorer out -2.8 (no "rally": games 1-2
    of the absence are no better than 3+).
  Real, and 2025-26 says Vegas was behind (ONE season; with ~40 ATS rows,
  one or two pass t 2 by luck; grade on this season's lines):
    off any close win (1-3 or OT) -1.2, covered 40.2% (209, ATS -2.4, t -2.7);
      regulation 1-3 wins 37.8% (156); OT wins are the bigger margin hit
      (-2.3, 10/10) but covered 47%.
    off a 20+ win: +0.8 (no letdown: the opposite), covered 58.3% (271, t +2.7).
    favored by 10+: covered 54.4% (340, t +2.9).
  Points against the total (2025-26, faint): after OT on short rest -6.1
    (66 games, t -2.5); off a 15+ loss +2.2 (t 2.2); 3 in 4 +1.7 (t 2.0).
  Players: streaks are mostly minutes. Hot from three (last 3 +4): +0.16
    threes vs his season with +1.3 minutes; given his minutes +0.07; against
    his last 10 -0.40 (heaters come back down). Big night (+10): +1.3 points,
    +0.5 given minutes, -0.4 vs last 10. Slump (-8 twice): -1.9, mostly
    minutes (-2.8). Starters of 10+ favorites +0.5 points on fewer minutes
    (+0.75 a minute); 10+ dogs' starters +1.1 minutes, net 0; rotation bench
    in lopsided games -2.6 minutes, -1.0 points. Former team +0.4 (faint).
  Early-season form is real: games 6-15, a team 5+ better than last season
    keeps beating last season's number by 4.1 (t 8, 10/10); worse, -4.0.
    Worse-than-last-year teams covered 40.5% (79, faint).
  Nothing: 4+ days rest (margin), long road trip, home from the road, time
  zone jumps, body clock (West early East: 97 games, -2.2, too few), altitude
  (-0.9, t -1.8), bounce-back margin, snapped streak, quick rematch / revenge,
  win and losing streaks, team three-point heater, star back, new teammate
  (margin), national TV (0.00), lookahead.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SEASONS = [2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025, 2026]
PRIOR = {2015: 2014, 2016: 2015, 2017: 2016, 2018: 2017, 2019: 2018,
         2022: 2021, 2023: 2022, 2024: 2023, 2025: 2024, 2026: 2025}
LINES_SEASON = 2026
RELEASES = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
FILES = {
    "schedule": "espn_nba_schedules/nba_schedule_{s}.parquet",
    "team_box": "espn_nba_team_boxscores/team_box_{s}.parquet",
    "player_box": "espn_nba_player_boxscores/player_box_{s}.parquet",
}
# ESPN team id -> hours behind Eastern (winter; Phoenix keeps Mountain time).
TZ = {1: 0, 2: 0, 3: -1, 4: -1, 5: 0, 6: -1, 7: -2, 8: 0, 9: -3, 10: -1, 11: 0, 12: -3, 13: -3, 14: 0,
      15: -1, 16: -1, 17: 0, 18: 0, 19: 0, 20: 0, 21: -2, 22: -3, 23: -3, 24: -1, 25: -1, 26: -2,
      27: 0, 28: 0, 29: -1, 30: 0}
ALTITUDE = {7, 26}  # Denver, Utah
NATIONAL = {"ESPN", "ABC", "TNT", "NBC", "NBC/Peacock", "Peacock", "Prime Video"}
ROTATION_MIN = 20.0


def download(data_dir: Path) -> None:
    for s in sorted(set(SEASONS) | set(PRIOR.values())):
        for kind, rel in FILES.items():
            if kind == "schedule" and s not in SEASONS:
                continue
            rel = rel.format(s=s)
            path = data_dir / rel.split("/")[-1]
            if not path.exists():
                req = urllib.request.Request(f"{RELEASES}/{rel}", headers={"User-Agent": "Mozilla/5.0"})
                path.write_bytes(urllib.request.urlopen(req, timeout=120).read())


# ---- one season's team-games ----
def team_games(season: int, data_dir: Path) -> pd.DataFrame:
    tb = pd.read_parquet(data_dir / f"team_box_{season}.parquet")
    tb = tb[(tb.season_type == 2) & tb.team_id.isin(TZ) & tb.opponent_team_id.isin(TZ)]
    df = pd.DataFrame({
        "game_id": tb.game_id.astype(str), "date": pd.to_datetime(tb.game_date),
        "team": tb.team_id.astype(int), "opp": tb.opponent_team_id.astype(int),
        "home": tb.team_home_away == "home", "pts": tb.team_score.astype(float),
        "opp_pts": tb.opponent_team_score.astype(float),
        "fg3m": tb.three_point_field_goals_made.astype(float),
        "fg3a": tb.three_point_field_goals_attempted.astype(float),
    }).drop_duplicates(["game_id", "team"])
    df["margin"] = df.pts - df.opp_pts
    df["season"] = season
    return df


def fit_ratings(df: pd.DataFrame) -> dict:
    """{'margin': (home edge, {team: rating}), 'pts': (mean, home, off, def),
    'fg3m': same}. Least squares; ratings are relative (min-norm solution)."""
    teams = sorted(TZ)
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    h = df[df.home]
    X = np.zeros((len(h), n + 1))
    X[:, n] = 1.0
    for row, (t, o) in enumerate(zip(h.team, h.opp)):
        X[row, idx[t]] += 1
        X[row, idx[o]] -= 1
    sol = np.linalg.lstsq(X, h.margin.to_numpy(), rcond=None)[0]
    out = {"margin": (sol[n], {t: sol[idx[t]] for t in teams})}
    for col in ("pts", "fg3m"):
        X = np.zeros((len(df), 2 * n + 2))
        X[:, 2 * n] = 1.0
        X[:, 2 * n + 1] = df.home.to_numpy(float)
        for row, (t, o) in enumerate(zip(df.team, df.opp)):
            X[row, idx[t]] = 1
            X[row, n + idx[o]] = 1
        sol = np.linalg.lstsq(X, df[col].to_numpy(), rcond=None)[0]
        out[col] = (sol[2 * n], sol[2 * n + 1], {t: sol[idx[t]] for t in teams}, {t: sol[n + idx[t]] for t in teams})
    return out


def expected(df: pd.DataFrame, r: dict) -> pd.DataFrame:
    h, rt = r["margin"]
    sign = np.where(df.home, 1.0, -1.0)
    df = df.copy()
    df["exp_margin"] = sign * h + df.team.map(rt) - df.opp.map(rt)
    for col in ("pts", "fg3m"):
        mu, hm, off, de = r[col]
        df[f"exp_{col}"] = mu + hm * df.home + df.team.map(off) + df.opp.map(de)
    df["res_margin"] = df.margin - df.exp_margin
    df["res_pts"] = df.pts - df.exp_pts
    df["res_fg3m"] = df.fg3m - df.exp_fg3m
    return df


def season_frame(season: int, data_dir: Path, lines: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = expected(team_games(season, data_dir), fit_ratings(team_games(season, data_dir)))
    prior = fit_ratings(team_games(PRIOR[season], data_dir))
    ph, pr = prior["margin"]
    mean_r = np.mean(list(pr.values()))
    sign = np.where(df.home, 1.0, -1.0)
    df["prior_exp"] = sign * ph + df.team.map(pr).fillna(mean_r) - df.opp.map(pr).fillna(mean_r)

    sc = pd.read_parquet(data_dir / f"nba_schedule_{season}.parquet")
    sc = sc[sc.season_type == 2]
    sc = pd.DataFrame({
        "game_id": sc.game_id.astype(str), "neutral": sc.neutral_site.fillna(False).astype(bool),
        "tip_et": pd.to_datetime(sc.game_date_time, utc=True).dt.tz_convert("America/New_York"),
        "tv": sc["broadcast_name"].astype(str) if "broadcast_name" in sc else "",
        "has_tv": "broadcast_name" in sc,
    }).drop_duplicates("game_id")
    df = df.merge(sc, on="game_id", how="left")
    df["neutral"] = df.neutral.fillna(False)
    df["national"] = df.tv.isin(NATIONAL)

    pb = pd.read_parquet(data_dir / f"player_box_{season}.parquet")
    pb = pb[pb.season_type == 2].copy()
    pb["game_id"] = pb.game_id.astype(str)
    mins = pb.groupby(["game_id", "team_id"]).minutes.sum().rename("team_min").reset_index()
    mins["team"] = mins.team_id.astype(int)
    df = df.merge(mins[["game_id", "team", "team_min"]], on=["game_id", "team"], how="left")
    df["ot"] = df.team_min >= 255

    # spread and total (2025-26)
    if season == LINES_SEASON:
        sp = df.game_id.map(lambda g: (lines.get(g) or [None, None])[1])
        tot = df.game_id.map(lambda g: (lines.get(g) or [None, None])[0])
        df["spread"] = np.where(df.home, sp.astype(float), -sp.astype(float))
        df["ats"] = df.margin + df.spread
        df["total"] = tot.astype(float)
        df["vs_total"] = df.pts + df.opp_pts - df.total
    else:
        df["spread"] = df["ats"] = df["total"] = df["vs_total"] = np.nan
    return add_spots(df, pb), pb


# ---- spots ----
def add_spots(df: pd.DataFrame, pb: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["team", "date"]).reset_index(drop=True)
    df["venue_tz"] = np.where(df.neutral, np.nan, np.where(df.home, df.team.map(TZ), df.opp.map(TZ)))
    df["win"] = df.margin > 0
    g = df.groupby("team", group_keys=False)
    df["gnum"] = g.cumcount() + 1
    df["prev_date"] = g.date.shift(1)
    df["rest"] = (df.date - df.prev_date).dt.days - 1
    df["prev_home"] = g.home.shift(1)
    df["prev_margin"] = g.margin.shift(1)
    df["prev_ot"] = g.ot.shift(1)
    df["prev_opp"] = g.opp.shift(1)
    df["prev_venue_tz"] = g.venue_tz.shift(1)
    df["next_national"] = g.national.shift(-1)
    df["next_opp"] = g.opp.shift(-1)
    # games in the last N days, tonight included
    for days, col in ((3, "in4"), (5, "in6")):
        df[col] = [((grp.date >= d - pd.Timedelta(days=days)) & (grp.date <= d)).sum()
                   for _, grp in df.groupby("team") for d in grp.date]
    # streaks before tonight
    def streaks(s: pd.Series) -> pd.Series:
        out, run = [], 0
        for w in s:
            out.append(run)
            run = (run + 1 if run >= 0 else 1) if w else (run - 1 if run <= 0 else -1)
        return pd.Series(out, index=s.index)
    df["streak"] = g.win.apply(streaks)
    df["prev_streak"] = g.streak.shift(1)
    def road_run(s: pd.Series) -> pd.Series:
        out, run = [], 0
        for home in s:
            run = 0 if home else run + 1
            out.append(run)
        return pd.Series(out, index=s.index)
    df["road_run"] = g.home.apply(road_run)  # tonight's road game counted
    df["prev_road_run"] = g.road_run.shift(1)
    # pregame win %
    df["wins_before"] = g.win.cumsum() - df.win
    df["winpct"] = np.where(df.gnum > 1, df.wins_before / (df.gnum - 1), np.nan)
    wp = df.set_index(["game_id", "team"]).winpct
    df["opp_winpct"] = [wp.get((gid, o), np.nan) for gid, o in zip(df.game_id, df.opp)]
    final_wp = df.groupby("team").win.mean()
    df["prev_opp_final_wp"] = df.prev_opp.map(final_wp)
    # next game's opponent's record going into that game
    nxt = g.game_id.shift(-1)
    df["next_opp_winpct"] = [wp.get((gid, o), np.nan) if isinstance(gid, str) else np.nan
                             for gid, o in zip(nxt, df.next_opp)]
    # team 3P% last 3 vs season
    df["fg3m_l3"] = g.fg3m.transform(lambda s: s.shift(1).rolling(3).sum())
    df["fg3a_l3"] = g.fg3a.transform(lambda s: s.shift(1).rolling(3).sum())
    season_pct = df.groupby("team").fg3m.sum() / df.groupby("team").fg3a.sum()
    df["hot3"] = df.fg3m_l3 / df.fg3a_l3 - df.team.map(season_pct)
    # quick rematch: same opponent within 7 days
    last_meet = {}
    rem, rem_res = [], []
    for i, r in df.sort_values("date").iterrows():
        key = (r.team, r.opp)
        prev = last_meet.get(key)
        rem.append((i, prev is not None and (r.date - prev[0]).days <= 7, prev[1] if prev else np.nan))
        last_meet[key] = (r.date, r.margin)
    rem = pd.DataFrame(rem, columns=["i", "rematch", "rematch_margin"]).set_index("i")
    df = df.join(rem)
    # reputation lag: form so far (games before tonight) vs last season's rating
    df["prior_res"] = df.margin - df.prior_exp
    df["form"] = df.groupby("team").prior_res.transform(lambda s: s.shift(1).expanding().mean())
    df = add_star_spots(df, pb)
    return df


def add_star_spots(df: pd.DataFrame, pb: pd.DataFrame) -> pd.DataFrame:
    """Top scorer out / back, and new rotation player after a trade."""
    played = pb[(pb.did_not_play != True) & (pb.minutes.fillna(0) > 0)]  # noqa: E712
    played = played.assign(team=played.team_id.astype(int), pid=played.athlete_id.astype(int))
    df["star_out_run"] = 0
    df["star_back_n"] = 0
    df["new_mate_n"] = 0
    for team, grp in df.groupby("team"):
        tp = played[played.team == team]
        if tp.empty:
            continue
        star = tp.groupby("pid").points.sum().idxmax()
        sgames = set(tp[tp.pid == star].game_id)
        dates = df.loc[grp.index, "date"]
        sd = dates[grp.game_id.isin(sgames)]
        first, last = sd.min(), sd.max()
        run, back = 0, 0
        for i, gid, d in zip(grp.index, grp.game_id, dates):
            if d < first or d > last:
                run = 0
                continue
            if gid in sgames:
                if run >= 3:
                    back = 3
                df.at[i, "star_back_n"] = back
                back = max(0, back - 1)
                run = 0
            else:
                run += 1
                df.at[i, "star_out_run"] = run
        # new rotation player: first game with this team after playing for
        # another team this season, 20+ minutes a game here
        for pid, pg in tp.groupby("pid"):
            other = played[(played.pid == pid) & (played.team != team)]
            if other.empty or pg.minutes.mean() < ROTATION_MIN or len(pg) < 10:
                continue
            first_here = df.loc[grp.index][grp.game_id.isin(set(pg.game_id))].date.min()
            if other.game_id.isin(set(df.game_id)).any() and \
                    df[df.game_id.isin(set(other.game_id))].date.max() < first_here:
                idx = grp.index[(dates >= first_here)][:5]
                df.loc[idx, "new_mate_n"] = 1
    return df


# ---- player-games ----
def player_frame(season: int, df: pd.DataFrame, pb: pd.DataFrame, prev_pb: pd.DataFrame) -> pd.DataFrame:
    p = pb[(pb.did_not_play != True) & (pb.minutes.fillna(0) > 0)].copy()  # noqa: E712
    p = p.assign(team=p.team_id.astype(int), opp=p.opponent_team_id.astype(int), pid=p.athlete_id.astype(int),
                 date=pd.to_datetime(p.game_date), pts=p.points.astype(float),
                 fg3m=p.three_point_field_goals_made.astype(float), fg3a=p.three_point_field_goals_attempted.astype(float),
                 mins=p.minutes.astype(float))
    p = p[p.team.isin(TZ) & p.opp.isin(TZ)].sort_values(["pid", "date"])
    g = p.groupby(["pid", "team"])
    n = g.pts.transform("count")
    for col in ("pts", "fg3m", "fg3a", "mins"):
        tot = g[col].transform("sum")
        p[f"avg_{col}"] = (tot - p[col]) / (n - 1)
        p[f"res_{col}"] = p[col] - p[f"avg_{col}"]
        p[f"l1_{col}"] = g[col].shift(1)
        p[f"l2_{col}"] = g[col].shift(2)
        p[f"l3sum_{col}"] = g[col].transform(lambda s: s.shift(1).rolling(3).sum())
        # last 10 before tonight: the recent form a book's line leans on
        p[f"l10_{col}"] = g[col].transform(lambda s: s.shift(1).rolling(10, min_periods=5).mean())
        p[f"rec_{col}"] = p[col] - p[f"l10_{col}"]
    # the same, given the minutes he actually played (form, not role)
    for col in ("pts", "fg3m"):
        p[f"rate_{col}"] = p[col] - p[f"avg_{col}"] / p.avg_mins * p.mins
    p = p[(n >= 20) & (p.avg_mins >= ROTATION_MIN)]
    # former team: his most-played team last season
    pp = prev_pb[(prev_pb.did_not_play != True) & (prev_pb.minutes.fillna(0) > 0)]  # noqa: E712
    main = pp.groupby("athlete_id").team_id.agg(lambda s: s.value_counts().idxmax())
    main.index = main.index.astype(int)
    p["former"] = (p.pid.map(main) == p.opp) & (p.pid.map(main) != p.team)
    side = df.set_index(["game_id", "team"])[["exp_margin", "spread"]]
    p["game_id"] = p.game_id.astype(str)
    p = p.join(side, on=["game_id", "team"])
    p["season"] = season
    return p


# ---- report ----
def summarize(rows: pd.DataFrame, col: str, base: pd.DataFrame | None = None) -> dict:
    x = rows[col].dropna()
    if len(x) < 2:
        return {"n": len(x), "mean": np.nan, "t": np.nan, "seasons": ""}
    mean = x.mean()
    t = mean / (x.std(ddof=1) / np.sqrt(len(x)))
    per = rows.groupby("season")[col].mean().dropna()
    same = int((np.sign(per) == np.sign(mean)).sum())
    return {"n": len(x), "mean": mean, "t": t, "seasons": f"{same}/{len(per)}"}


def team_line(name: str, rows: pd.DataFrame, short_base: float) -> str:
    m = summarize(rows, "res_margin")
    pts = summarize(rows, "res_pts")
    f3 = summarize(rows, "res_fg3m")
    short = (rows.res_margin <= -10).mean() * 100 if len(rows) else np.nan
    a = rows.dropna(subset=["ats"])
    a = a[a.ats != 0]
    ats = summarize(a, "ats")
    cover = (a.ats > 0).mean() * 100 if len(a) else np.nan
    vt = summarize(rows, "vs_total")
    return (f"{name:<34} {m['n']:>6} {m['mean']:+6.2f} {m['t']:+6.1f} {m['seasons']:>6} "
            f"{pts['mean']:+6.2f} {pts['t']:+5.1f} {f3['mean']:+6.2f} {f3['t']:+5.1f} {short:5.1f}% "
            f"{ats['n']:>4} {ats['mean']:+6.2f} {ats['t']:+5.1f} {cover:5.1f}% {vt['n']:>4} {vt['mean']:+6.2f} {vt['t']:+5.1f}")


def player_line(name: str, rows: pd.DataFrame) -> str:
    out = [f"{name:<34} {len(rows):>6}"]
    for col in ("res_pts", "res_fg3m", "res_fg3a", "res_mins", "rec_pts", "rec_fg3m", "rate_pts", "rate_fg3m"):
        s = summarize(rows, col)
        out.append(f"{s['mean']:+6.2f} {s['t']:+5.1f} {s['seasons']:>5}")
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    data_dir = ROOT / args.data_dir
    if args.download:
        download(data_dir)
    lines = json.loads((ROOT / "nfl_tool" / "nba" / f"lines_{LINES_SEASON}.json").read_text())

    teams, players = [], []
    for s in SEASONS:
        df, pb = season_frame(s, data_dir, lines)
        prev_pb = pd.read_parquet(data_dir / f"player_box_{PRIOR[s]}.parquet")
        prev_pb = prev_pb[prev_pb.season_type == 2]
        teams.append(df)
        players.append(player_frame(s, df, pb, prev_pb))
        print(f"{s}: {df.game_id.nunique()} games", file=sys.stderr)
    T = pd.concat(teams, ignore_index=True)
    P = pd.concat(players, ignore_index=True)
    short_base = (T.res_margin <= -10).mean() * 100
    fav = T.exp_margin > 0

    print(f"All team-games: {len(T)}, fell 10+ short of normal {short_base:.1f}%; "
          f"2025-26 with a spread {T.ats.notna().sum()}, with a total {T.vs_total.notna().sum()}")
    print(f"Margin sd around normal {T.res_margin.std():.1f}; points {T.res_pts.std():.1f}; threes {T.res_fg3m.std():.2f}")
    print()
    print(f"{'Team spot':<34} {'games':>6} {'margin':>6} {'t':>6} {'seas':>6} {'pts':>6} {'t':>5} "
          f"{'3PM':>6} {'t':>5} {'short':>6} {'ATSn':>4} {'ATS':>6} {'t':>5} {'cover':>6} {'Totn':>4} {'Total':>6} {'t':>5}")
    first = T.gnum == 1
    b2b = (T.rest == 0)
    opp_rest = T.set_index(["game_id", "team"]).rest
    T["opp_rest"] = [opp_rest.get((gid, o), np.nan) for gid, o in zip(T.game_id, T.opp)]
    spots = [
        ("1 Back-To-Back", b2b),
        ("1a  road-road", b2b & ~T.home & (T.prev_home == False)),  # noqa: E712
        ("1b  home-home", b2b & T.home & (T.prev_home == True)),  # noqa: E712
        ("2 Rest Edge (B2B vs 2+ off)", b2b & (T.opp_rest >= 2)),
        ("2a  the rested side", (T.rest >= 2) & (T.opp_rest == 0)),
        ("3 3 In 4 Nights", T.in4 >= 3),
        ("4 4 In 6 Nights", T.in6 >= 4),
        ("5 Rust (4+ days off)", (T.rest >= 4) & ~first),
        ("6 Long Road Trip (4th+ away)", T.road_run >= 4),
        ("7 Home From The Road", T.home & (T.prev_road_run >= 4)),
        ("8 Time Zone Jump", (abs(T.venue_tz - T.prev_venue_tz) >= 2) & (T.rest <= 1)),
        ("9a Body Clock: West early East", (T.team.map(TZ) <= -2) & (T.venue_tz == 0) & (T.tip_et.dt.hour < 18)),
        ("9b Body Clock: East late West", (T.team.map(TZ) == 0) & (T.venue_tz == -3) & (T.tip_et.dt.hour >= 22)),
        ("10 Altitude (road at DEN/UTA)", ~T.home & T.opp.isin(ALTITUDE)),
        ("10a  on a back-to-back", ~T.home & T.opp.isin(ALTITUDE) & b2b),
        ("11 Letdown (won by 1-3 or OT, fav)", fav & (((T.prev_margin > 0) & (T.prev_margin <= 3)) | ((T.prev_margin > 0) & (T.prev_ot == True)))),  # noqa: E712
        ("11b  won by 1-3 in regulation", (T.prev_margin > 0) & (T.prev_margin <= 3) & (T.prev_ot == False)),  # noqa: E712
        ("11c  won in OT", (T.prev_margin > 0) & (T.prev_ot == True)),  # noqa: E712
        ("11d  lost by 1-3 or in OT", ((T.prev_margin < 0) & (T.prev_margin >= -3)) | ((T.prev_margin < 0) & (T.prev_ot == True))),  # noqa: E712
        ("11a  any team, won by 1-3 or OT", ((T.prev_margin > 0) & (T.prev_margin <= 3)) | ((T.prev_margin > 0) & (T.prev_ot == True))),  # noqa: E712
        ("12 Big-Win Letdown (won by 20+)", T.prev_margin >= 20),
        ("12a  beat a winning team", (T.prev_margin > 0) & (T.prev_opp_final_wp > 0.5)),
        ("13 Bounce-Back (lost by 15+)", T.prev_margin <= -15),
        ("13a  lost by 25+", T.prev_margin <= -25),
        ("14 Overtime Legs (OT, <=1 day)", (T.prev_ot == True) & (T.rest <= 1)),  # noqa: E712
        ("15 Snapped Streak (4+ ended)", (T.prev_margin < 0) & (T.prev_streak >= 4)),
        ("16 Quick Rematch (<=7 days)", T.rematch == True),  # noqa: E712
        ("16a  lost the first one", (T.rematch == True) & (T.rematch_margin < 0)),  # noqa: E712
        ("17 Win Streak 4+", T.streak >= 4),
        ("18 Losing Streak 4+", T.streak <= -4),
        ("19 Team Heater (3P% +5 last 3)", T.hot3 >= 0.05),
        ("20 Team Cold Spell (3P% -5 last 3)", T.hot3 <= -0.05),
        ("24 Star Back (first 3 back)", T.star_back_n > 0),
        ("25 Star Out: first 2 games", T.star_out_run.between(1, 2)),
        ("25b Star Out: games 3+", T.star_out_run >= 3),
        ("27 New Teammate (first 5 games)", T.new_mate_n > 0),
        ("28 National TV (2022-26)", T.national & T.has_tv.fillna(False)),
        ("29 Lookahead", (T.opp_winpct < 0.5) & (T.gnum > 5) & ((T.next_national == True) | (T.next_opp_winpct >= 0.6))),  # noqa: E712
        ("30 Big Spread (fav by 10+)", T.exp_margin >= 10),
        ("30a Big Spread (dog by 10+)", T.exp_margin <= -10),
        ("31a Reputation: better than last yr", T.gnum.between(6, 15) & (T.form >= 5)),
        ("31b Reputation: worse than last yr", T.gnum.between(6, 15) & (T.form <= -5)),
    ]
    for name, mask in spots:
        print(team_line(name, T[mask.fillna(False).astype(bool)], short_base))
    print()
    print("31 Reputation, measured against LAST season's number (does the new form last?):")
    for name, mask in (("31a better than last yr", T.gnum.between(6, 15) & (T.form >= 5)),
                       ("31b worse than last yr", T.gnum.between(6, 15) & (T.form <= -5))):
        s = summarize(T[mask], "prior_res")
        print(f"  {name:<28} {s['n']:>5} games, beat last season's number by {s['mean']:+.2f} (t {s['t']:+.1f}, {s['seasons']})")

    print()
    print(f"{'Player spot':<34} {'games':>6} {'pts':>6} {'t':>5} {'seas':>5} {'3PM':>6} {'t':>5} {'seas':>5} "
          f"{'3PA':>6} {'t':>5} {'seas':>5} {'min':>6} {'t':>5} {'seas':>5} "
          f"{'pts10':>6} {'t':>5} {'seas':>5} {'3PM10':>6} {'t':>5} {'seas':>5} "
          f"{'ptsMin':>6} {'t':>5} {'seas':>5} {'3PMMin':>6} {'t':>5} {'seas':>5}")
    shooter = P.avg_fg3a >= 3
    pspots = [
        ("21 Player Heater (3PM last 3 +4)", shooter & (P.l3sum_fg3m >= 3 * P.avg_fg3m + 4)),
        ("21a  last 3 +6", shooter & (P.l3sum_fg3m >= 3 * P.avg_fg3m + 6)),
        ("21b Player Cold (3PM last 3 -4)", shooter & (P.l3sum_fg3m <= 3 * P.avg_fg3m - 4)),
        ("22 Player Big Night (+10 last)", P.l1_pts >= P.avg_pts + 10),
        ("22a  +15 last game", P.l1_pts >= P.avg_pts + 15),
        ("23 Player Slump (-8 twice)", (P.l1_pts <= P.avg_pts - 8) & (P.l2_pts <= P.avg_pts - 8)),
        ("26 Former Team", P.former),
        ("30 Starters, fav by 10+", P.starter.fillna(False).astype(bool) & (P.exp_margin >= 10)),
        ("30a Starters, dog by 10+", P.starter.fillna(False).astype(bool) & (P.exp_margin <= -10)),
        ("30b Bench, either side 10+", ~P.starter.fillna(False).astype(bool) & (P.exp_margin.abs() >= 10)),
    ]
    # star back, the star himself
    for name, mask in pspots:
        print(player_line(name, P[mask.fillna(False).astype(bool)]))


if __name__ == "__main__":
    main()
