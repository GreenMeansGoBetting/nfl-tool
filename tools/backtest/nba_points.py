"""Replay NBA player points on a past season: which Team Identity factors
make a player's points number better?

Every player-game is projected only from that season's games BEFORE its
date (the live rule). The base is the live projection's own number:
last-5 minutes x season points a minute. Each factor is a log ratio
against the league (0 = average), and the fit is least squares on
actual / base - 1, weighted by the base (bigger scorers count more):

  pace      both teams' pace against the league's
  def_ppp   the other defense's points a possession allowed
  zone_fit  his shot zones x the make rate this defense allows in each,
            against the league's make rate in those same zones
  ft        the other defense's free throws allowed a shot x how much he
            lives at the line (his free throws a shot against the league's)
  tov       the other defense's turnovers forced
  trans     the other defense's transition share allowed
  out_share his team's missing shots tonight: the season shot share of
            rotation teammates who didn't play (the live page would know
            this from the injury report)
  blowout   for starters, how far the spread is past 6 points
  home, b2b home game; played the night before

Reported: mean miss of the base and of each factor added alone, the full
fit's weights (with t values), and a check fitted on the first half of the
season and scored on the second.

    py tools/backtest/nba_points.py --season 2026 --data-dir data/nba

2025-26 (run 2026-10-20, 17,338 player-games, about 1.5 minutes): a player's
points miss by 5.2 on average whatever we do (most of it is a single game's
noise). Fitted on the first half and scored on the second, the factors cut
the miss from 5.167 to 5.125 (about 1%); all of that comes from four:
  out_share  t +11.6 (the biggest: teammates who sat; +0.54 x their shot share)
  pace       t +3.7  (weight about 0.8-1.0)
  trans      t +2.5  (about 0.1-0.2)
  def_ppp    t +1.6  (about 0.3-0.4, not 1.0)
zone_fit adds nothing once def_ppp is in (t +0.4, though alone it helps as
much as def_ppp), nor do ft (+0.9), tov (-0.6); blowout, home and b2b are
small (+0.4%, +1.3%, +2.3%) and left out. The base itself runs 2-4% high
(const -0.025 to -0.039). The replay knew who sat; the live page has the
injury report.

Added 2026-10-23 (the owner's ideas A minutes, B referees, D rest, plus the
position matchup): `NEW` below. Referee crews come from ESPN's game summary
(tools/backtest/nba_refs.py -> officials_<season>.json). Run on 2025-26:
  min_trend  t -14.3 (-0.37 to -0.45): the base's last-5 minutes overshoot.
             Last 5 down 15%+ from his season: he scores 17% over the base;
             up 15%+: right on it. Minutes dips bounce back, rises stick.
  out_x_share t -10.3: teammates' missing shots go mostly to role players
             (share under 15%: +18% when 15%+ of the team's shots sit;
             15-22%: +6%; too few stars in that spot to say).
  opp_out    t +2.1 (+0.09 x the other team's missing shot share), back
             (first 3 games after sitting 3+) t -2.1; neither earned a place
             on the first half alone.
  Nothing: the referee crew (free throws or fouls, alone or x his own foul
  / free-throw rate, all |t| under 0.5), 3 games in 4 nights, 3+ days rest,
  the other team on a back-to-back, Denver / Utah, 4+ road games in a row,
  and the position matchup once team defense is in (t +0.6).
Fitted on the first half and scored on the second: the four 5.125, the four
+ min_trend + out_x_share 5.106. Whether any of it beats the LINE is
tools/backtest/nba_points_lines.py's job (this season's saved tip-off lines).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nba"))
import positions  # noqa: E402
import possessions as P  # noqa: E402

MIN_PRIOR_GAMES = 5
MIN_BASE = 6.0
ZONES = ("rim", "short", "mid", "corner3", "above3")
OLD = ("pace", "def_ppp", "zone_fit", "ft", "tov", "trans", "out_share", "blowout", "home", "b2b")
NEW = ("min_trend", "back", "ref_ft", "ref_x_ft", "ref_pf", "ref_x_pf", "three_in_four", "rest3",
       "opp_b2b", "altitude", "long_trip", "pos_def", "opp_out", "out_x_share")
FACTORS = OLD + NEW
KEEP = ("pace", "def_ppp", "trans", "out_share")  # the live projection's four (props.py)
CONST = "const"  # the base's own lean (in every fit)
REF_PRIOR = 15   # games a referee's foul / free-throw rate is pulled toward the league with
POS_PRIOR = 5    # games a defense's points allowed to a position is pulled toward the league with
ALTITUDE = ("DEN", "UTAH")


def schedule_spots(reg: pd.DataFrame) -> pd.DataFrame:
    """Each team-game's rest and road trip: days since its last game, days
    since the one before that, and away games in a row through this one."""
    s = reg.drop_duplicates(["game_id", "team_id"])[["game_id", "team_id", "date", "home_away"]].copy()
    s["team"] = s["team_id"].astype(int)
    s = s.sort_values(["team", "date"])
    s["d"] = pd.to_datetime(s["date"])
    g = s.groupby("team")["d"]
    s["rest"] = (s["d"] - g.shift(1)).dt.days
    s["rest2"] = (s["d"] - g.shift(2)).dt.days
    away = s["home_away"].ne("home")
    s["trip"] = away.astype(int).groupby([s["team"], (~away).cumsum()]).cumsum()
    return s[["game_id", "team", "rest", "rest2", "trip"]]


def games_back(reg: pd.DataFrame) -> pd.Series:
    """For each game a player played: his games played since he last sat 3+
    team games in a row (99 = no such absence)."""
    r = reg[["game_id", "athlete_id", "date", "did_not_play", "minutes"]].copy()
    r["player"] = r["athlete_id"].astype(int)
    r["played"] = ~r["did_not_play"].astype(bool) & (r["minutes"].fillna(0) > 0)
    out = {}
    for pid, g in r.sort_values(["player", "date"]).groupby("player"):
        miss, since = 0, 99
        for gid, played in zip(g["game_id"], g["played"]):
            if not played:
                miss += 1
                continue
            since = 1 if miss >= 3 else min(since + 1, 99)
            miss = 0
            out[(gid, pid)] = since
    return pd.Series(out, name="since_back")


def ref_crews(reg: pd.DataFrame, officials: dict, date_of: pd.Series) -> pd.DataFrame:
    """Each game's crew: the three referees' free throws and fouls a game in
    their EARLIER games, each pulled REF_PRIOR games toward the league, as a
    log ratio against the league to date (0 = average crew)."""
    g = reg.groupby("game_id")[["free_throws_attempted", "fouls"]].sum().rename(columns={"free_throws_attempted": "fta", "fouls": "pf"})
    g["date"] = g.index.map(date_of)
    rows = [(int(gid), name) for gid, names in officials.items() for name in names if int(gid) in g.index]
    if not rows:
        return pd.DataFrame(columns=["game_id", "ref_ft", "ref_pf"])
    r = pd.DataFrame(rows, columns=["game_id", "ref"]).join(g, on="game_id").sort_values(["ref", "date"])
    for c in ("fta", "pf"):
        r[f"p_{c}"] = r.groupby("ref")[c].cumsum() - r[c]
    r["n"] = r.groupby("ref").cumcount()
    lg = g.groupby("date")[["fta", "pf"]].agg(["sum", "size"]).sort_index().cumsum().shift(1)
    for c in ("fta", "pf"):
        avg = r["date"].map(lg[(c, "sum")] / lg[(c, "size")])
        r[f"r_{c}"] = np.log((r[f"p_{c}"] + REF_PRIOR * avg) / (r["n"] + REF_PRIOR) / avg)
    crew = r.groupby("game_id")[["r_fta", "r_pf"]].mean().rename(columns={"r_fta": "ref_ft", "r_pf": "ref_pf"})
    return crew.reset_index()


def pos_allowed(pl: pd.DataFrame) -> np.ndarray:
    """Each player-game: the other defense's points a game allowed to his
    position in its EARLIER games (pulled POS_PRIOR games toward the
    league), as a log ratio against the league's per team-game."""
    games = pl.drop_duplicates(["game_id", "opp"])[["game_id", "opp", "date"]]
    grid = games.merge(pd.DataFrame({"pos": positions.POSITIONS}), how="cross")
    pts = pl.groupby(["game_id", "opp", "pos"])["pts"].sum().rename("allowed").reset_index()
    a = grid.merge(pts, how="left").fillna({"allowed": 0}).sort_values(["opp", "pos", "date"])
    grp = a.groupby(["opp", "pos"])["allowed"]
    a["p_sum"] = grp.cumsum() - a["allowed"]
    a["n"] = grp.cumcount()
    lg = a.groupby(["pos", "date"])["allowed"].agg(["sum", "size"]).groupby(level="pos").cumsum()
    lg = lg.groupby(level="pos").shift(1)
    avg = (lg["sum"] / lg["size"]).to_dict()
    a["lg"] = [avg.get((p, d), np.nan) for p, d in zip(a["pos"], a["date"])]
    a["pos_def"] = np.log((a["p_sum"] + POS_PRIOR * a["lg"]) / (a["n"] + POS_PRIOR) / a["lg"])
    return pl.merge(a[["game_id", "opp", "pos", "pos_def"]], on=["game_id", "opp", "pos"], how="left")["pos_def"].to_numpy()


def prior(df: pd.DataFrame, key: str, cols: list) -> pd.DataFrame:
    """Each row's sums over that key's EARLIER rows (sorted by date)."""
    df = df.sort_values([key, "date"])
    sums = df.groupby(key)[cols].cumsum() - df[cols]
    return df.assign(**{f"p_{c}": sums[c] for c in cols})


def build(season: P.Season, box: pd.DataFrame, lines: dict, officials: dict) -> pd.DataFrame:
    poss = season.possessions
    acts = season.actions[season.actions["n"].notna()].merge(poss[["game_id", "n", "off", "def", "start", "first_secs"]], on=["game_id", "n"])
    acts = acts[acts["team"] == acts["off"]]
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    reg = positions.relabel(reg, positions.load(live=False))
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    date_of = reg.drop_duplicates("game_id").set_index("game_id")["date"]

    # ---- each defense, game by game: what its opponents did against it ----
    shots = acts[acts["kind"] == "shot"]
    ends = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max().clip(lower=2880)
    d = poss.groupby(["game_id", "def"]).agg(poss=("pts", "size"), pts=("pts", "sum"), tov=("tov", lambda s: (s > 0).sum())).reset_index()
    live = poss["start"].isin(("miss", "steal")) & (poss["first_secs"] <= 8)
    d = d.merge(poss[live].groupby(["game_id", "def"]).size().rename("trans").reset_index(), how="left").fillna({"trans": 0})
    d = d.merge(shots.groupby(["game_id", "def"]).size().rename("fga").reset_index(), how="left")
    d = d.merge(acts[acts["kind"] == "ft"].groupby(["game_id", "def"]).size().rename("fta").reset_index(), how="left").fillna(0)
    for z in ZONES:
        zs = shots[shots["zone"] == z]
        d = d.merge(zs.groupby(["game_id", "def"]).agg(**{f"{z}_a": ("made", "size"), f"{z}_m": ("made", "sum")}).reset_index(), how="left")
    d = d.fillna(0)
    d["secs"] = d["game_id"].map(ends)
    d["date"] = d["game_id"].map(date_of)
    sum_cols = ["poss", "pts", "tov", "trans", "fga", "fta", "secs"] + [f"{z}_{k}" for z in ZONES for k in ("a", "m")]
    d = prior(d.rename(columns={"def": "team"}), "team", sum_cols)
    # the team's own pace (its possessions on offense)
    o = poss.groupby(["game_id", "off"]).size().rename("o_poss").reset_index().rename(columns={"off": "team"})
    o["secs"] = o["game_id"].map(ends)
    o["date"] = o["game_id"].map(date_of)
    o = prior(o, "team", ["o_poss", "secs"]).rename(columns={"p_secs": "p_o_secs"})
    teams = d.merge(o[["game_id", "team", "p_o_poss", "p_o_secs"]], on=["game_id", "team"])

    # league to date (all games before the date)
    by_date = d.groupby("date")[sum_cols].sum().sort_index().cumsum().shift(1)

    # ---- each player, game by game ----
    pl = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)].copy()
    pl = pl.rename(columns={"athlete_id": "player"})
    pl["player"] = pl["player"].astype(int)
    pl["team"] = pl["team_id"].astype(int)
    own = shots.groupby(["game_id", "player"]).agg(**{f"z_{z}": ("zone", lambda s, z=z: (s == z).sum()) for z in ZONES}).reset_index()
    pl = pl.merge(own, on=["game_id", "player"], how="left").fillna({f"z_{z}": 0 for z in ZONES})
    pl["min"] = pl["minutes"].astype(float)
    pl["pts"] = pl["points"].astype(float)
    pl["fga"] = pl["field_goals_attempted"].astype(float)
    pl["fta"] = pl["free_throws_attempted"].astype(float)
    pl["pf"] = pl["fouls"].fillna(0).astype(float)
    pl["pos"] = pl["athlete_position_abbreviation"]
    pcols = ["min", "pts", "fga", "fta", "pf"] + [f"z_{z}" for z in ZONES]
    pl = prior(pl, "player", pcols)
    pl["games_before"] = pl.groupby("player").cumcount()
    pl["l5_min"] = pl.groupby("player")["min"].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    pl["prev_date"] = pl.groupby("player")["date"].shift(1)
    # team shots a game so far, for each player's shot share (out_share)
    team_fga = pl.groupby(["game_id", "team"])["fga"].sum().rename("team_fga").reset_index()
    pl = pl.merge(team_fga, on=["game_id", "team"])
    pl["p_share"] = pl["p_fga"] / pl.groupby("player")["team_fga"].transform(lambda s: s.cumsum() - s)

    # who sat tonight: rotation teammates' prior shot share
    share_now = pl[["game_id", "team", "player", "p_share", "l5_min"]]
    dnp = reg[reg["did_not_play"].astype(bool)][["game_id", "team_id", "athlete_id"]].rename(columns={"team_id": "team", "athlete_id": "player"})
    dnp["player"] = dnp["player"].astype(int)
    dnp["team"] = dnp["team"].astype(int)
    last_share = pl.sort_values("date").groupby("player")[["p_share", "l5_min", "date"]].apply(lambda g: g.reset_index(drop=True))
    # a player's share and minutes as of each date (latest game before it)
    latest = pl[["player", "date", "fga", "team_fga", "min"]].sort_values("date")
    latest["c_fga"] = latest.groupby("player")["fga"].cumsum()
    latest["c_tfga"] = latest.groupby("player")["team_fga"].cumsum()
    latest["c_min"] = latest.groupby("player")["min"].cumsum()
    latest["c_g"] = latest.groupby("player").cumcount() + 1
    del last_share
    out_rows = []
    lat = {pid: g for pid, g in latest.groupby("player")}
    for r in dnp.itertuples(index=False):
        g = lat.get(r.player)
        date = date_of.get(r.game_id)
        if g is None or date is None:
            continue
        before = g[g["date"] < date]
        if before.empty:
            continue
        b = before.iloc[-1]
        if b["c_min"] / b["c_g"] < 20:  # rotation players only
            continue
        out_rows.append((r.game_id, r.team, b["c_fga"] / b["c_tfga"] if b["c_tfga"] else 0))
    outs = pd.DataFrame(out_rows, columns=["game_id", "team", "out_share"]).groupby(["game_id", "team"])["out_share"].sum().reset_index()
    pl = pl.merge(outs, on=["game_id", "team"], how="left").fillna({"out_share": 0})

    # opponent
    opp = reg.drop_duplicates(["game_id", "team_id"])[["game_id", "team_id", "opponent_team_id", "home_away"]]
    opp = opp.rename(columns={"team_id": "team", "opponent_team_id": "opp"}).astype({"team": int, "opp": int})
    pl = pl.merge(opp, on=["game_id", "team"], suffixes=("", "_o"))
    pl = pl.merge(teams.add_prefix("D_").rename(columns={"D_game_id": "game_id", "D_team": "opp"}), on=["game_id", "opp"])
    pl = pl.merge(teams[["game_id", "team", "p_o_poss", "p_o_secs"]].rename(columns={"p_o_poss": "T_poss", "p_o_secs": "T_secs"}), on=["game_id", "team"])
    pl = pl.join(by_date.add_prefix("L_"), on="date")

    # ---- factors ----
    f = pd.DataFrame(index=pl.index)
    lg_pace = pl["L_poss"] / pl["L_secs"] * 2880
    team_pace = pl["T_poss"] / pl["T_secs"] * 2880
    opp_pace = pl["D_p_o_poss"] / pl["D_p_o_secs"] * 2880
    f["pace"] = np.log(((team_pace + opp_pace) / 2) / lg_pace)
    f["def_ppp"] = np.log((pl["D_p_pts"] / pl["D_p_poss"]) / (pl["L_pts"] / pl["L_poss"]))
    zs = np.stack([pl[f"p_z_{z}"] for z in ZONES], axis=1)
    zs = zs / np.maximum(zs.sum(axis=1, keepdims=True), 1)
    allowed = np.stack([pl[f"D_p_{z}_m"] / pl[f"D_p_{z}_a"].clip(lower=1) for z in ZONES], axis=1)
    league = np.stack([pl[f"L_{z}_m"] / pl[f"L_{z}_a"].clip(lower=1) for z in ZONES], axis=1)
    f["zone_fit"] = np.log((zs * allowed).sum(axis=1).clip(min=1e-6) / (zs * league).sum(axis=1).clip(min=1e-6))
    lg_ft = pl["L_fta"] / pl["L_fga"]
    f["ft"] = (pl["p_fta"] / pl["p_fga"].clip(lower=1) / lg_ft) * np.log((pl["D_p_fta"] / pl["D_p_fga"]) / lg_ft)
    f["tov"] = np.log((pl["D_p_tov"] / pl["D_p_poss"]) / (pl["L_tov"] / pl["L_poss"]))
    f["trans"] = np.log((pl["D_p_trans"] / pl["D_p_poss"]) / (pl["L_trans"] / pl["L_poss"]))
    f["out_share"] = pl["out_share"]
    spread = pl["game_id"].astype(str).map(lambda g: (lines.get(g) or [None, None])[1]).astype(float)
    f["blowout"] = (spread.abs() - 6).clip(lower=0).fillna(0) * pl["starter"].astype(float)
    f["home"] = (pl["home_away"] == "home").astype(float)
    f["b2b"] = (pd.to_datetime(pl["date"]) - pd.to_datetime(pl["prev_date"])).dt.days.eq(1).astype(float)

    # ---- minutes (A), referees (B), rest (D), the position matchup, the other side's missing players ----
    f["min_trend"] = np.log(pl["l5_min"] / (pl["p_min"] / pl["games_before"].clip(lower=1)))
    since = games_back(reg)
    f["back"] = [float(since.get((g, p), 99) <= 3) for g, p in zip(pl["game_id"], pl["player"])]
    crew = ref_crews(reg, officials, date_of).set_index("game_id")
    ref_ft = pl["game_id"].map(crew["ref_ft"]).fillna(0)
    ref_pf = pl["game_id"].map(crew["ref_pf"]).fillna(0)
    f["ref_ft"] = ref_ft
    f["ref_x_ft"] = (pl["p_fta"] / pl["p_fga"].clip(lower=1) / lg_ft) * ref_ft
    lg_pf36 = pl["p_pf"].sum() / pl["p_min"].sum() * 36  # the sample's fouls a 36 (a scale only)
    f["ref_pf"] = ref_pf
    f["ref_x_pf"] = (pl["p_pf"] / pl["p_min"].clip(lower=1) * 36 / lg_pf36) * ref_pf
    spots = schedule_spots(reg)
    mine = pl[["game_id", "team"]].merge(spots, on=["game_id", "team"], how="left")
    theirs = pl[["game_id", "opp"]].merge(spots.rename(columns={"team": "opp"}), on=["game_id", "opp"], how="left")
    f["three_in_four"] = mine["rest2"].le(3).astype(float).to_numpy()
    f["rest3"] = mine["rest"].ge(3).astype(float).to_numpy()
    f["opp_b2b"] = theirs["rest"].eq(1).astype(float).to_numpy()
    f["long_trip"] = mine["trip"].ge(4).astype(float).to_numpy()
    alt = set(reg.loc[reg["team_abbreviation"].isin(ALTITUDE), "team_id"].astype(int))
    f["altitude"] = ((pl["home_away"] != "home") & pl["opp"].isin(alt)).astype(float)
    f["pos_def"] = pos_allowed(pl)
    f["opp_out"] = pl[["game_id", "opp"]].merge(outs.rename(columns={"team": "opp"}), on=["game_id", "opp"], how="left")["out_share"].fillna(0).to_numpy()
    f["out_x_share"] = pl["out_share"] * pl["p_share"] / 0.2
    pl["base"] = pl["l5_min"] * pl["p_pts"] / pl["p_min"].clip(lower=1)
    out = pd.concat([pl[["game_id", "date", "player", "athlete_display_name", "pts", "base", "games_before"]], f], axis=1)
    out = out.replace([np.inf, -np.inf], np.nan).dropna()
    out[CONST] = 1.0
    return out[(out["games_before"] >= MIN_PRIOR_GAMES) & (out["base"] >= MIN_BASE)]


def fit(df: pd.DataFrame, cols) -> np.ndarray:
    """Weights for actual / base - 1 ~ factors (least squares, weighted by the base)."""
    cols = [CONST, *cols]
    w = np.sqrt(df["base"].to_numpy())
    X = df[list(cols)].to_numpy() * w[:, None]
    y = (df["pts"] / df["base"] - 1).to_numpy() * w
    return np.linalg.lstsq(X, y, rcond=None)[0]


def predict(df, cols, beta):
    return df["base"] * (1 + df[[CONST, *cols]].to_numpy() @ beta)


def mae(df, pred):
    return float((pred - df["pts"]).abs().mean())


def report(df: pd.DataFrame):
    print(f"{len(df)} player-games (5+ games before, base {MIN_BASE}+ points)")
    print(f"base (last-5 minutes x season points a minute): mean miss {mae(df, df['base']):.3f}")
    b0 = fit(df, [])
    base = mae(df, predict(df, [], b0))
    print(f"base with its own lean ({b0[0]:+.3f}): mean miss {base:.3f}")
    print("\neach factor added alone (fitted on the whole season):")
    for c in FACTORS:
        bc = fit(df, [c])
        m = mae(df, predict(df, [c], bc))
        print(f"  {c:10} weight {bc[1]:+.3f}  mean miss {m:.3f}  ({m - base:+.3f})")
    cols = [CONST, *FACTORS]
    ball = fit(df, FACTORS)
    w = np.sqrt(df["base"].to_numpy())
    X = df[cols].to_numpy() * w[:, None]
    resid = (df["pts"] / df["base"] - 1).to_numpy() * w - X @ ball
    cov = np.linalg.inv(X.T @ X) * (resid @ resid) / (len(df) - len(cols))
    m = mae(df, predict(df, FACTORS, ball))
    print(f"\nall together: mean miss {m:.3f} ({m - base:+.3f})")
    for c, v, se in zip(cols, ball, np.sqrt(np.diag(cov))):
        print(f"  {c:10} {v:+.3f}  t {v / se:+.1f}")
    dates = sorted(df["date"].unique())
    half = dates[len(dates) // 2]
    first, second = df[df["date"] < half], df[df["date"] >= half]
    keep = list(KEEP)
    print(f"\nfitted on the first half, scored on the second ({len(second)} player-games):")
    print(f"  base {mae(second, second['base']):.3f}")
    print(f"  base + lean {mae(second, predict(second, [], fit(first, []))):.3f}")
    print(f"  all factors {mae(second, predict(second, FACTORS, fit(first, FACTORS))):.3f}")
    bk = fit(first, keep)
    print(f"  just {', '.join(keep)} {mae(second, predict(second, keep, bk)):.3f}  weights {', '.join(f'{c} {v:+.3f}' for c, v in zip([CONST, *keep], bk))}")
    # the new factors that earn a place on the FIRST half alone (|t| 2+ next to the four), scored on the second
    cols = [CONST, *keep, *NEW]
    b1 = fit(first, [*keep, *NEW])
    w1 = np.sqrt(first["base"].to_numpy())
    X1 = first[cols].to_numpy() * w1[:, None]
    r1 = (first["pts"] / first["base"] - 1).to_numpy() * w1 - X1 @ b1
    t1 = b1 / np.sqrt(np.diag(np.linalg.inv(X1.T @ X1) * (r1 @ r1) / (len(first) - len(cols))))
    earned = [c for c, t in zip(cols, t1) if c in NEW and abs(t) >= 2]
    be = fit(first, [*keep, *earned])
    print(f"  the four + {', '.join(earned) or 'nothing new'} {mae(second, predict(second, [*keep, *earned], be)):.3f}  "
          f"weights {', '.join(f'{c} {v:+.3f}' for c, v in zip([CONST, *keep, *earned], be))}")


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
    refs_file = d / f"officials_{args.season}.json"  # tools/backtest/nba_refs.py
    officials = json.loads(refs_file.read_text()) if refs_file.exists() else {}
    df = build(season, box, lines, officials)
    df.to_csv(d / f"points_replay_{args.season}.csv", index=False)
    report(df)


if __name__ == "__main__":
    main()
