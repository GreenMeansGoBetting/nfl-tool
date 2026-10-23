"""Replay NBA threes made on a past season: which ideas make a player's
threes number better? (The owner's 10 ideas + 5 more, 2026-10-23.)

Every player-game is projected only from that season's games BEFORE its
date (the live rule). Threes made = attempts x make rate, and the two are
fitted apart, because attempts are steady and make rate is mostly noise:

  attempts base   last-5 minutes x season threes tried a minute
  makes base      attempts base x his make rate pulled K tries toward the
                  league's (K is picked by the replay: --k)

Each factor is a log ratio against the league (0 = average) or a share
minus the league's, fitted by least squares on actual / base - 1, weighted
by the base (the Points replay's method):

  the owner's ideas
   1 volume       the base itself
   2 three_rate   his threes as a share of his shots, against the league's
   3 corner       his corner share of threes, minus the league's
     corner_x_def his corner share x how many corner threes the defense allows
   4 catch        his catch-and-shoot share of threes, minus the league's
     catch_x_def  his catch share x the defense's threes allowed
   5 def_3pa      the defense's threes allowed a possession
     def_3pct     the defense's three make rate allowed (pulled 300 tries in)
   6 dog          his team's spread / 10 (+ = underdog: trailing teams shoot)
     blowout      for starters, how far the spread is past 6 points / 10
   7 def_rim      the defense's rim shots allowed a possession (few = walls
                  off the paint, kicks it out)
   8 def_catch3   the defense's catch-and-shoot share of threes allowed
                  (help defense leaves shooters)
   9 zone_fit3    his corner / above-the-break split x the make rate this
                  defense allows in each, against the league's
  10 last_luck    last game's makes minus expected (a cold night: does he
                  keep shooting next game?); the in-game version is its
                  own study below
  my five
   A ft_pct       his free-throw % (pulled 50 tries in) against the league's
   B l5_luck      last 5 games' makes minus expected, a game
   C feeder_out   share of his assisted threes made off teammates out
                  tonight (out_share / out_x_share: the Points replay's)
   D the ladder   how wide a night's threes spread around the number
                  (Poisson or wider?), its own study below
   E b2b, three_in_four, altitude (tired legs)
  plus the Points replay's pace, min_trend and home.

Studies printed after the fits:
  hot / cold  in-game: a player's first 3 threes (0-3 .. 3-3), then the rest
              of the game: threes tried per minute on the floor against his
              own season rate, make rate, and how much of the rest he
              played. Players who made 0 of their first 3 are compared with
              ones who made 3 of 3 (same early volume, so it's fair).
  ft study    first half of the season's 3P% and FT% against second-half 3P%.
  ladder      1+ / 2+ / 3+ / 4+ nights against a Poisson count at the base.

    py tools/backtest/nba_threes.py --season 2026 --data-dir data/nba

2025-26 (run 2026-10-23, 19,711 player-games, about 2 minutes):
  make rate   pulled 200 tries toward the league is best (100-400 all close).
  ATTEMPTS    fitted on the first half, scored on the second: miss 1.762 ->
              1.729 (about 2%, twice what Points got). What holds:
                min_trend   t -19 (minutes dips bounce back, as in Points)
                out_share / out_x_share  t +14 / -9 (sitting teammates'
                            shots go to role players; stars get nothing)
                dog         t +8 (+4% threes tried a 10 points of underdog)
                def_3pa     t +7 (weight ~0.55)
                def_catch3  t +5 (defenses that give up catch-and-shoot
                            threes: the owner's help-defense idea, #8)
                pace        t +4.5
                l5_luck / last_luck  t +4 / +3 (made more than expected
                            lately -> shoots a little more next game: a
                            cold run trims volume, idea #10 between games)
              Real alone but the same thing as def_3pa once it's in:
              def_rim (walls off the paint, #7), catch_x_def (#4).
              Nothing: three_rate (#2), corner (#3), blowout once dog is in
              (#6), feeder_out (alone +: his passer out means MORE threes,
              not fewer; none left once out_share is in), b2b / 3-in-4 /
              altitude (small, and up not down).
  MAKES       miss 1.038 -> 1.033 (0.4%): makes are mostly a night's luck.
              Everything about make RATE adds nothing: def_3pct, zone_fit3
              (#9), corner_x_def, ft_pct (t +1.6). Volume carries it.
  FT%         first-half FT% explains 2-3% of second-half 3P%, his own
              3P% 7%, both 8%: a small add, not enough to earn a place.
  ladder      a night's threes spread 1.2-1.4x wider than Poisson: 1+
              hits 2-4 points LESS often than Poisson says, 3+ / 4+ more
              often (proj 0.55: 3+ 4.5% vs 2.0%; 4+ 1.3% vs 0.3%).
  hot / cold  after his first 3 threes: 0-for-3 starters try 0.92x their
              usual the rest of the game and play a little less (57.6% of
              the time left vs 60%); 3-for-3 starters try 1.04x. Neither
              makes more or fewer than usual afterward (no hot hand in the
              make rate; hot catch-and-shoot types 0.93x, harder shots).
  not testable yet: whether books' threes lines chase luck (no saved
  2025-26 threes lines; save this season's tip-off lines to test it).
"""
import argparse
import json
from math import factorial
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import positions  # noqa: E402
import possessions as P  # noqa: E402
from nba_points import ALTITUDE, prior, schedule_spots  # noqa: E402

MIN_PRIOR_GAMES = 5
MIN_BASE = 1.0       # threes tried a game
DEF_PRIOR = 300      # tries a defense's make rate allowed is pulled toward the league with
FT_PRIOR = 50
K_TRIES = (50, 100, 200, 400, 800)
CONST = "const"
ATT = ("pace", "min_trend", "home", "three_rate", "corner", "catch", "catch_x_def", "def_3pa", "dog",
       "blowout", "def_rim", "def_catch3", "last_luck", "l5_luck", "out_share", "out_x_share",
       "feeder_out", "b2b", "three_in_four", "altitude")
MAKE = ("corner", "corner_x_def", "catch", "def_3pct", "zone_fit3", "ft_pct", "l5_luck", "b2b",
        "three_in_four", "altitude", "home")


def build(season: P.Season, box: pd.DataFrame, lines: dict, k: float) -> pd.DataFrame:
    poss = season.possessions
    acts = season.actions[season.actions["n"].notna()].merge(poss[["game_id", "n", "off", "def"]], on=["game_id", "n"])
    acts = acts[acts["team"] == acts["off"]]
    shots = acts[acts["kind"] == "shot"].copy()
    shots["player"] = shots["player"].astype(int)
    threes = shots[shots["three"]]
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    reg = positions.relabel(reg, positions.load(live=False))
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    date_of = reg.drop_duplicates("game_id").set_index("game_id")["date"]

    # ---- each defense, game by game ----
    ends = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max().clip(lower=2880)
    d = poss.groupby(["game_id", "def"]).agg(poss=("pts", "size")).reset_index()
    g3 = threes.groupby(["game_id", "def"])
    d = d.merge(g3.agg(a3=("made", "size"), m3=("made", "sum")).reset_index(), how="left")
    for z in ("corner3", "above3"):
        zs = threes[threes["zone"] == z].groupby(["game_id", "def"]).agg(**{f"{z}_a": ("made", "size"), f"{z}_m": ("made", "sum")})
        d = d.merge(zs.reset_index(), how="left")
    d = d.merge(threes[threes["kind2"] == "catch"].groupby(["game_id", "def"]).size().rename("c3").reset_index(), how="left")
    d = d.merge(shots[shots["zone"] == "rim"].groupby(["game_id", "def"]).size().rename("rim").reset_index(), how="left")
    d = d.merge(shots.groupby(["game_id", "def"]).size().rename("fga").reset_index(), how="left").fillna(0)
    d["date"] = d["game_id"].map(date_of)
    dcols = ["poss", "a3", "m3", "corner3_a", "corner3_m", "above3_a", "above3_m", "c3", "rim", "fga"]
    d = prior(d.rename(columns={"def": "team"}), "team", dcols)
    o = poss.groupby(["game_id", "off"]).size().rename("o_poss").reset_index().rename(columns={"off": "team"})
    o["secs"] = o["game_id"].map(ends)
    o["date"] = o["game_id"].map(date_of)
    o = prior(o, "team", ["o_poss", "secs"]).rename(columns={"p_secs": "p_o_secs"})
    teams = d.merge(o[["game_id", "team", "p_o_poss", "p_o_secs"]], on=["game_id", "team"])
    by_date = d.groupby("date")[dcols].sum().sort_index().cumsum().shift(1)
    lg_pace = o.groupby("date")[["o_poss", "secs"]].sum().sort_index().cumsum().shift(1)

    # ---- each player, game by game ----
    pl = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)].copy()
    pl = pl.rename(columns={"athlete_id": "player"})
    pl["player"] = pl["player"].astype(int)
    pl["team"] = pl["team_id"].astype(int)
    mine = threes.groupby(["game_id", "player"]).agg(
        corner=("zone", lambda s: (s == "corner3").sum()), corner_m=("made", lambda s: 0),
        catch=("kind2", lambda s: (s == "catch").sum())).reset_index()
    cm = threes[(threes["zone"] == "corner3") & threes["made"]].groupby(["game_id", "player"]).size().rename("corner_made")
    mine = mine.drop(columns="corner_m").join(cm, on=["game_id", "player"]).fillna({"corner_made": 0})
    pl = pl.merge(mine, on=["game_id", "player"], how="left").fillna({"corner": 0, "catch": 0, "corner_made": 0})
    pl["min"] = pl["minutes"].astype(float)
    pl["a3"] = pl["three_point_field_goals_attempted"].astype(float)
    pl["m3"] = pl["three_point_field_goals_made"].astype(float)
    pl["fga"] = pl["field_goals_attempted"].astype(float)
    pl["fta"] = pl["free_throws_attempted"].astype(float)
    pl["ftm"] = pl["free_throws_made"].astype(float)
    pcols = ["min", "a3", "m3", "fga", "fta", "ftm", "corner", "corner_made", "catch"]
    pl = prior(pl, "player", pcols)
    pl["games_before"] = pl.groupby("player").cumcount()
    pl["l5_min"] = pl.groupby("player")["min"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    pl["prev_date"] = pl.groupby("player")["date"].shift(1)
    pl = pl.join(by_date.add_prefix("L_"), on="date")
    lg_pct = pl["L_m3"] / pl["L_a3"]
    pl["pct"] = (pl["p_m3"] + k * lg_pct) / (pl["p_a3"] + k)
    pl["base_a"] = pl["l5_min"] * pl["p_a3"] / pl["p_min"].clip(lower=1)
    pl["base_m"] = pl["base_a"] * pl["pct"]
    # luck: makes minus what his own make rate (to date) says, last game and last 5
    pl["luck"] = pl["m3"] - pl["a3"] * pl["pct"]
    grp = pl.groupby("player")["luck"]
    pl["last_luck"] = grp.shift(1)
    pl["l5_luck"] = grp.transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())

    # team shots and who sat (the Points replay's out_share), plus his feeders
    team_fga = pl.groupby(["game_id", "team"])["fga"].sum().rename("team_fga").reset_index()
    pl = pl.merge(team_fga, on=["game_id", "team"])
    pl["p_share"] = pl["p_fga"] / pl.groupby("player")["team_fga"].transform(lambda s: s.cumsum() - s)
    latest = pl[["player", "date", "fga", "team_fga", "min"]].sort_values("date")
    for c, src in (("c_fga", "fga"), ("c_tfga", "team_fga"), ("c_min", "min")):
        latest[c] = latest.groupby("player")[src].cumsum()
    latest["c_g"] = latest.groupby("player").cumcount() + 1
    lat = {pid: g for pid, g in latest.groupby("player")}
    dnp = reg[reg["did_not_play"].astype(bool)][["game_id", "team_id", "athlete_id"]]
    out_rows = []
    for gid, team, pid in zip(dnp["game_id"], dnp["team_id"].astype(int), dnp["athlete_id"].astype(int)):
        g, date = lat.get(pid), date_of.get(gid)
        if g is None or date is None:
            continue
        before = g[g["date"] < date]
        if before.empty:
            continue
        b = before.iloc[-1]
        if b["c_min"] / b["c_g"] < 20:  # rotation players only
            continue
        out_rows.append((gid, team, pid, b["c_fga"] / b["c_tfga"] if b["c_tfga"] else 0))
    sat = pd.DataFrame(out_rows, columns=["game_id", "team", "out", "share"])
    outs = sat.groupby(["game_id", "team"])["share"].sum().rename("out_share").reset_index()
    pl = pl.merge(outs, on=["game_id", "team"], how="left").fillna({"out_share": 0})
    # feeders: who assisted his made threes before tonight
    ast = threes[threes["made"] & threes["assist"].notna()][["game_id", "player", "assist"]].copy()
    ast["assist"] = ast["assist"].astype(int)
    ast["date"] = ast["game_id"].map(date_of)
    sat_by_game = {gid: set(g["out"]) for gid, g in sat.groupby("game_id")}
    by_shooter = {pid: g.sort_values("date") for pid, g in ast.groupby("player")}
    feed = []
    for gid, pid, date in zip(pl["game_id"], pl["player"], pl["date"]):
        g, gone = by_shooter.get(pid), sat_by_game.get(gid)
        if g is None or not gone:
            feed.append(0.0)
            continue
        before = g["assist"][g["date"].to_numpy() < date]
        feed.append(float(before.isin(gone).mean()) if len(before) >= 5 else 0.0)
    pl["feeder_out"] = feed

    opp = reg.drop_duplicates(["game_id", "team_id"])[["game_id", "team_id", "opponent_team_id", "home_away"]]
    opp = opp.rename(columns={"team_id": "team", "opponent_team_id": "opp"}).astype({"team": int, "opp": int})
    pl = pl.merge(opp, on=["game_id", "team"], suffixes=("", "_o"))
    pl = pl.merge(teams.add_prefix("D_").rename(columns={"D_game_id": "game_id", "D_team": "opp"}), on=["game_id", "opp"])
    pl = pl.merge(teams[["game_id", "team", "p_o_poss", "p_o_secs"]].rename(columns={"p_o_poss": "T_poss", "p_o_secs": "T_secs"}), on=["game_id", "team"])
    pl = pl.join(lg_pace.add_prefix("LP_"), on="date")

    # ---- factors ----
    f = pd.DataFrame(index=pl.index)
    lgp = pl["LP_o_poss"] / pl["LP_secs"]
    f["pace"] = np.log(((pl["T_poss"] / pl["T_secs"]) + (pl["D_p_o_poss"] / pl["D_p_o_secs"])) / 2 / lgp)
    f["min_trend"] = np.log(pl["l5_min"] / (pl["p_min"] / pl["games_before"].clip(lower=1)))
    f["home"] = (pl["home_away"] == "home").astype(float)
    f["three_rate"] = np.log((pl["p_a3"] / pl["p_fga"].clip(lower=1)) / (pl["L_a3"] / pl["L_fga"]))
    lg_corner = pl["L_corner3_a"] / pl["L_a3"]
    his_corner = pl["p_corner"] / pl["p_a3"].clip(lower=1)
    f["corner"] = his_corner - lg_corner
    f["corner_x_def"] = his_corner / lg_corner * np.log((pl["D_p_corner3_a"] / pl["D_p_poss"]) / (pl["L_corner3_a"] / pl["L_poss"]))
    lg_catch = pl["L_c3"] / pl["L_a3"]
    his_catch = pl["p_catch"] / pl["p_a3"].clip(lower=1)
    f["catch"] = his_catch - lg_catch
    f["def_3pa"] = np.log((pl["D_p_a3"] / pl["D_p_poss"]) / (pl["L_a3"] / pl["L_poss"]))
    f["catch_x_def"] = (his_catch / lg_catch - 1) * f["def_3pa"]
    f["def_3pct"] = np.log(((pl["D_p_m3"] + DEF_PRIOR * lg_pct) / (pl["D_p_a3"] + DEF_PRIOR)) / lg_pct)
    spread = pl["game_id"].astype(str).map(lambda g: (lines.get(g) or [None, None])[1]).astype(float)
    team_spread = np.where(pl["home_away"] == "home", spread, -spread)  # + = underdog
    f["dog"] = pd.Series(team_spread, index=pl.index).fillna(0) / 10
    f["blowout"] = (spread.abs() - 6).clip(lower=0).fillna(0) / 10 * pl["starter"].astype(float)
    f["def_rim"] = np.log((pl["D_p_rim"] / pl["D_p_poss"]) / (pl["L_rim"] / pl["L_poss"]))
    f["def_catch3"] = np.log((pl["D_p_c3"] / pl["D_p_a3"]) / lg_catch)
    zr = {}
    for z in ("corner3", "above3"):
        lz = pl[f"L_{z}_m"] / pl[f"L_{z}_a"]
        zr[z] = ((pl[f"D_p_{z}_m"] + DEF_PRIOR / 2 * lz) / (pl[f"D_p_{z}_a"] + DEF_PRIOR / 2), lz)
    f["zone_fit3"] = np.log((his_corner * zr["corner3"][0] + (1 - his_corner) * zr["above3"][0])
                            / (his_corner * zr["corner3"][1] + (1 - his_corner) * zr["above3"][1]))
    f["last_luck"] = pl["last_luck"]
    f["l5_luck"] = pl["l5_luck"]
    lg_ft = 0.78
    f["ft_pct"] = np.log(((pl["p_ftm"] + FT_PRIOR * lg_ft) / (pl["p_fta"] + FT_PRIOR)) / lg_ft)
    f["out_share"] = pl["out_share"]
    f["out_x_share"] = pl["out_share"] * pl["p_share"] / 0.2
    f["feeder_out"] = pl["feeder_out"]
    f["b2b"] = (pd.to_datetime(pl["date"]) - pd.to_datetime(pl["prev_date"])).dt.days.eq(1).astype(float)
    spots = schedule_spots(reg)
    sp = pl[["game_id", "team"]].merge(spots, on=["game_id", "team"], how="left")
    f["three_in_four"] = sp["rest2"].le(3).astype(float).to_numpy()
    alt = set(reg.loc[reg["team_abbreviation"].isin(ALTITUDE), "team_id"].astype(int))
    f["altitude"] = ((pl["home_away"] != "home") & pl["opp"].isin(alt)).astype(float)
    keep = ["game_id", "date", "player", "athlete_display_name", "a3", "m3", "base_a", "base_m", "pct",
            "p_a3", "p_m3", "p_fta", "p_ftm", "games_before", "p_share", "starter"]
    out = pd.concat([pl[keep].assign(his_catch=his_catch), f], axis=1)
    out = out.replace([np.inf, -np.inf], np.nan).dropna(subset=list(f.columns) + ["base_a"])
    out[CONST] = 1.0
    return out[(out["games_before"] >= MIN_PRIOR_GAMES) & (out["base_a"] >= MIN_BASE)]


def fit(df, y, base, cols):
    cols = [CONST, *cols]
    w = np.sqrt(df[base].to_numpy())
    X = df[cols].to_numpy() * w[:, None]
    yy = (df[y] / df[base] - 1).to_numpy() * w
    beta = np.linalg.lstsq(X, yy, rcond=None)[0]
    r = yy - X @ beta
    se = np.sqrt(np.diag(np.linalg.pinv(X.T @ X) * (r @ r) / max(len(df) - len(cols), 1)))
    return beta, beta / se


def pred(df, base, cols, beta):
    return df[base] * (1 + df[[CONST, *cols]].to_numpy() @ beta)


def mae(df, y, p):
    return float((p - df[y]).abs().mean())


def report(df, y, base, factors, title):
    print(f"\n==== {title}: {len(df)} player-games ====")
    b0, _ = fit(df, y, base, [])
    m0 = mae(df, y, pred(df, base, [], b0))
    print(f"base mean miss {mae(df, y, df[base]):.4f}; with its own lean ({b0[0]:+.3f}) {m0:.4f}")
    print("each factor alone (whole season):          weight      t    miss change")
    for c in factors:
        bc, tc = fit(df, y, base, [c])
        print(f"  {c:13} {bc[1]:+9.3f} {tc[1]:+7.1f}   {mae(df, y, pred(df, base, [c], bc)) - m0:+.4f}")
    ball, tall = fit(df, y, base, factors)
    print(f"all together: miss {mae(df, y, pred(df, base, factors, ball)) - m0:+.4f}")
    for c, v, t in zip([CONST, *factors], ball, tall):
        print(f"  {c:13} {v:+.3f}  t {t:+.1f}")
    dates = sorted(df["date"].unique())
    half = dates[len(dates) // 2]
    first, second = df[df["date"] < half], df[df["date"] >= half]
    b1, t1 = fit(first, y, base, factors)
    earned = [c for c, t in zip([CONST, *factors], t1) if c != CONST and abs(t) >= 2]
    be, _ = fit(first, y, base, earned)
    bl, _ = fit(first, y, base, [])
    print(f"fitted on the first half, scored on the second ({len(second)}):")
    print(f"  base + lean {mae(second, y, pred(second, base, [], bl)):.4f}   all {mae(second, y, pred(second, base, factors, b1)):.4f}"
          f"   earned ({', '.join(earned) or 'none'}) {mae(second, y, pred(second, base, earned, be)):.4f}")
    print(f"  earned weights: {', '.join(f'{c} {v:+.3f}' for c, v in zip([CONST, *earned], be))}")
    return earned, be


def pick_k(season, box, lines):
    """How hard to pull a shooter's make rate toward the league's: the K
    that best predicts makes from the attempts he actually took."""
    print("\n==== make rate: tries pulled toward the league (scored on his real attempts) ====")
    best = None
    for k in K_TRIES:
        df = build(season, box, lines, k)
        miss = float((df["a3"] * df["pct"] - df["m3"]).abs().mean())
        brier = float(((df["m3"] - df["a3"] * df["pct"]) ** 2).sum() / df["a3"].sum())
        print(f"  K {k:4}: makes miss {miss:.4f}  squared miss a try {brier:.4f}")
        if best is None or brier < best[1]:
            best = (k, brier, df)
    print(f"  best K = {best[0]}")
    return best[0], best[2]


def ladder(df, mean_col):
    print("\n==== the ladder: share of nights with 1+ / 2+ / 3+ / 4+ threes, actual vs Poisson ====")
    df = df.assign(bin=pd.cut(df[mean_col], [0, 0.75, 1.25, 1.75, 2.25, 2.75, 3.5, 9]))
    for b, g in df.groupby("bin", observed=True):
        lam = g[mean_col].to_numpy()
        row = []
        for k in (1, 2, 3, 4):
            pois = 1 - sum(np.exp(-lam) * lam ** j / factorial(j) for j in range(k))
            row.append(f"{k}+ {100 * (g['m3'] >= k).mean():4.1f}% vs {100 * pois.mean():4.1f}%")
        ratio = g["m3"].var() / g["m3"].mean()
        print(f"  {str(b):12} n {len(g):5} mean {g['m3'].mean():.2f} (proj {lam.mean():.2f}) spread/mean {ratio:.2f} | " + " | ".join(row))


def hot_cold(season: P.Season, df: pd.DataFrame, first_n: int = 3):
    """In-game: after his first N threes, the rest of the game."""
    acts = season.actions
    th = acts[(acts["kind"] == "shot") & acts["three"]][["game_id", "t", "player", "made"]].copy()
    th["player"] = th["player"].astype(int)
    th = th.sort_values(["game_id", "player", "t"])
    th["i"] = th.groupby(["game_id", "player"]).cumcount()
    st = season.stints
    rows = []
    for (gid, team), g in st.groupby(["game_id", "team"]):
        for t0, t1, five in zip(g["t0"], g["t1"], g["five"]):
            for p in five:
                rows.append((gid, int(p), t0, t1))
    on = pd.DataFrame(rows, columns=["game_id", "player", "t0", "t1"])
    end = on.groupby("game_id")["t1"].max()
    start = th[th["i"] == first_n - 1][["game_id", "player", "t"]].rename(columns={"t": "tn"})
    early = th[th["i"] < first_n].groupby(["game_id", "player"])["made"].sum().rename("early_made").reset_index()
    rest = th.merge(start, on=["game_id", "player"])
    rest = rest[rest["t"] > rest["tn"]].groupby(["game_id", "player"]).agg(rest_a=("made", "size"), rest_m=("made", "sum")).reset_index()
    o = on.merge(start, on=["game_id", "player"])
    o["after"] = (o["t1"] - o[["t0", "tn"]].max(axis=1)).clip(lower=0)
    secs = o.groupby(["game_id", "player"])["after"].sum().rename("rest_secs").reset_index()
    s = start.merge(early).merge(secs).merge(rest, how="left").fillna({"rest_a": 0, "rest_m": 0})
    s["left"] = s["game_id"].map(end) - s["tn"]
    return s.merge(df[["game_id", "player", "pct", "his_catch", "p_share"]], on=["game_id", "player"])


def hot_cold_report(season, df, box, first_n=3):
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    reg["player"] = reg["athlete_id"].astype(int)
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    reg = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)]
    reg = reg.sort_values(["player", "date"])
    reg["p_min"] = reg.groupby("player")["minutes"].cumsum() - reg["minutes"]
    reg["p_a3m"] = reg.groupby("player")["three_point_field_goals_attempted"].cumsum() - reg["three_point_field_goals_attempted"]
    s = hot_cold(season, df, first_n)
    s = s.merge(reg[["game_id", "player", "p_min", "p_a3m"]], on=["game_id", "player"])
    s["exp_a"] = s["p_a3m"] / (s["p_min"] * 60) * s["rest_secs"]
    s["exp_m"] = s["rest_a"] * s["pct"]
    s["on_share"] = s["rest_secs"] / s["left"].clip(lower=1)
    print(f"\n==== hot / cold: his first {first_n} threes, then the rest of the game ({len(s)} player-games) ====")
    print("  (tries = rest-of-game threes tried vs his season rate for the minutes he played after;")
    print("   makes = rest-of-game make rate vs his own; on floor = share of the time left he played)")
    groups = {"everyone": s, "catch-and-shoot types (60%+ catch)": s[s["his_catch"] >= 0.6],
              "shot creators (under 40% catch)": s[s["his_catch"] < 0.4],
              "role players (under 15% of team shots)": s[s["p_share"] < 0.15],
              "stars (22%+ of team shots)": s[s["p_share"] >= 0.22]}
    for name, g in groups.items():
        print(f"  {name}:")
        for k, h in g.groupby("early_made"):
            tries = h["rest_a"].sum() / h["exp_a"].sum()
            makes = h["rest_m"].sum() / max(h["exp_m"].sum(), 1e-9)
            print(f"    {k}-for-{first_n} start: n {len(h):5}  tries {tries:5.2f}x  makes {makes:5.2f}x"
                  f"  ({h['rest_m'].sum() / max(h['rest_a'].sum(), 1):.3f} vs {(h['pct'] * h['rest_a']).sum() / max(h['rest_a'].sum(), 1):.3f})"
                  f"  on floor {h['on_share'].mean():.3f}")


def ft_study(df):
    """Does free-throw % predict a shooter's 3P% beyond his own 3P%?"""
    dates = sorted(df["date"].unique())
    half = dates[len(dates) // 2]
    last_first = df[df["date"] < half].sort_values("date").groupby("player").last()
    second = df[df["date"] >= half].groupby("player")[["a3", "m3"]].sum()
    j = last_first[["p_a3", "p_m3", "p_fta", "p_ftm"]].join(second, how="inner")
    print("\n==== free-throw % vs three-point %: first half of the season -> second half ====")
    for lo in (50, 100):
        x = j[(j["p_a3"] >= lo) & (j["a3"] >= lo) & (j["p_fta"] >= 30)]
        y = x["m3"] / x["a3"]
        a = x["p_m3"] / x["p_a3"]
        ft = x["p_ftm"] / x["p_fta"]
        w = x["a3"].to_numpy()
        def r2(cols):
            X = np.column_stack([np.ones(len(x)), *cols]) * np.sqrt(w)[:, None]
            b = np.linalg.lstsq(X, y.to_numpy() * np.sqrt(w), rcond=None)[0]
            res = y.to_numpy() - np.column_stack([np.ones(len(x)), *cols]) @ b
            tot = y.to_numpy() - np.average(y, weights=w)
            return 1 - np.average(res ** 2, weights=w) / np.average(tot ** 2, weights=w), b
        r_a, b_a = r2([a])
        r_f, b_f = r2([ft])
        r_b, b_b = r2([a, ft])
        print(f"  {len(x)} shooters with {lo}+ threes in each half and 30+ free throws:")
        print(f"    corr(1st-half 3P%, 2nd-half 3P%) {np.corrcoef(a, y)[0, 1]:+.3f}   corr(1st-half FT%, 2nd-half 3P%) {np.corrcoef(ft, y)[0, 1]:+.3f}")
        print(f"    explained: 3P% alone {r_a:.3f}, FT% alone {r_f:.3f}, both {r_b:.3f} (weights 3P% {b_b[1]:+.3f}, FT% {b_b[2]:+.3f})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    args = ap.parse_args()
    d = Path(args.data_dir)
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    season = P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box)
    lines_file = ROOT / "nfl_tool" / "nba" / f"lines_{args.season}.json"
    lines = json.loads(lines_file.read_text()) if lines_file.exists() else {}
    k, df = pick_k(season, box, lines)
    df.to_csv(d / f"threes_replay_{args.season}.csv", index=False)
    report(df, "a3", "base_a", ATT, "THREES TRIED")
    earned, be = report(df, "m3", "base_m", tuple(dict.fromkeys(ATT + MAKE)), "THREES MADE")
    ladder(df, "base_m")
    ft_study(df)
    hot_cold_report(season, df, box, 3)


if __name__ == "__main__":
    main()
