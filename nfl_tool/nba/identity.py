"""Team Identity: how each team plays, from the engine (possessions.py).

Every number is kept twice, like the Game Previews' Offense vs Defense:
`off_<key>` is what the team does with the ball and `def_<key>` is the same
thing its OPPONENTS do against it, so a matchup row always reads both sides.

    py nfl_tool/nba/identity.py --season 2026 --data-dir data/nba --team BOS
    py nfl_tool/nba/identity.py --season 2026 --data-dir data/nba --write   # re-save 2025-26

A finished season's numbers never change, so 2025-26's are saved once in
identity_2026.json (the build reads it; re-save after changing a formula).
This season's are worked out on every build.

Groups (`ROWS` lists them for the page):
- Pace: possessions a 48 minutes, seconds a possession, seconds to the first
  shot.
- Transition: share of possessions that get a shot or turnover off within
  8 seconds of a defensive rebound or a steal, and points a possession in
  them; half-court points a possession.
- Shot diet: share of shots from each zone (rim, short, mid, corner 3, above
  the break 3) and the make rate there.
- Creation: share of made shots assisted; share of shots that are pull-ups,
  step-backs or fades (made off the dribble, mostly alone); catch-and-shoot.
- Turnovers: share of possessions ending in one; share of turnovers that are
  steals (live ball, the other way at once); points a possession after a steal.
- Glass and line: offensive rebound rate, free throws a shot.
- Game script: when up or down 15+ in the 4th quarter, how many of the
  night's starters are still on the floor; net points a 100 possessions by
  quarter.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

TRANSITION_SECS = 8
BLOWOUT = 15
ZONES = ("rim", "short", "mid", "corner3", "above3")
SELF_MADE = ("pullup", "stepback", "fade")


def share(num, den):
    return float(num) / float(den) if den else None


def side_numbers(poss: pd.DataFrame, acts: pd.DataFrame, games_secs: pd.Series) -> dict:
    """One side's numbers: `poss` / `acts` are the possessions and actions of
    the team on offense (its own for off_, its opponents' for def_)."""
    out = {}
    n = len(poss)
    if not n:
        return out
    secs = games_secs.reindex(poss["game_id"].unique()).sum()
    out["pace"] = n / secs * 2880 if secs else None
    out["poss_secs"] = poss["secs"].mean()
    out["first_secs"] = poss["first_secs"].dropna().mean()
    live = poss["start"].isin(("miss", "steal"))
    fast = live & (poss["first_secs"] <= TRANSITION_SECS)
    out["trans_freq"] = fast.mean()
    out["trans_ppp"] = poss.loc[fast, "pts"].mean() if fast.any() else None
    out["half_ppp"] = poss.loc[~fast, "pts"].mean()
    out["ppp"] = poss["pts"].mean()

    shots = acts[acts["kind"] == "shot"]
    fga = len(shots)
    for z in ZONES:
        zs = shots[shots["zone"] == z]
        out[f"{z}_share"] = share(len(zs), fga)
        out[f"{z}_pct"] = zs["made"].mean() if len(zs) else None
    out["three_rate"] = share(shots["three"].sum(), fga)
    # threes tried a possession and
    # the catch-and-shoot share of them (def_: allowed; help defense leaving shooters)
    threes = shots[shots["three"]]
    out["three_pp"] = share(len(threes), n)
    out["catch3"] = share((threes["kind2"] == "catch").sum(), len(threes))
    makes = shots[shots["made"]]
    out["assisted"] = share(makes["assist"].notna().sum(), len(makes))
    out["self_made"] = share(shots["kind2"].isin(SELF_MADE).sum(), fga)
    out["catch"] = share((shots["kind2"] == "catch").sum(), fga)

    tos = acts[acts["kind"] == "to"]
    out["tov_rate"] = share((poss["tov"] > 0).sum(), n)
    out["steal_share"] = share(tos["steal"].notna().sum(), len(tos))
    out["fta_rate"] = share((acts["kind"] == "ft").sum(), fga)
    return out


def team_identity(season, abbr_of: dict) -> dict:
    """{team abbreviation: {off_*, def_*, games, game script}} plus `league`
    (the league-wide average and spread of each key, for coloring)."""
    poss = season.possessions
    ends = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max()
    games_secs = ends.clip(lower=2880)  # overtime games run longer
    # each action with its possession's offense; the offense's own actions only
    acts = season.actions[season.actions["n"].notna()].merge(
        poss[["game_id", "n", "off", "def"]], on=["game_id", "n"])
    acts = acts[(acts["team"] == acts["off"]) & (acts["kind"] != "foul")]
    boards = season.actions[season.actions["kind"].isin(("oreb", "dreb"))]

    out = {}
    for team in sorted(set(poss["off"])):
        gids = poss.loc[poss["off"] == team, "game_id"].unique()
        b = boards[boards["game_id"].isin(gids)]
        row = {"games": int(len(gids))}
        for side, col in (("off", "off"), ("def", "def")):
            nums = side_numbers(poss[poss[col] == team], acts[acts[col] == team], games_secs)
            # offensive rebound rate: the offense's offensive boards against the defense's defensive ones
            attackers = (b["team"] == team) if side == "off" else (b["team"] != team)
            o = int(((b["kind"] == "oreb") & attackers).sum())
            d = int(((b["kind"] == "dreb") & ~attackers).sum())
            nums["oreb_rate"] = share(o, o + d)
            for k, v in nums.items():
                row[f"{side}_{k}"] = None if v is None or pd.isna(v) else float(v)
        row.update(game_script(poss, team))
        out[abbr_of.get(team, str(team))] = row

    keys = sorted({k for r in out.values() for k in r if k != "games"})
    league = {}
    for k in keys:
        vals = np.array([r[k] for r in out.values() if r.get(k) is not None], dtype=float)
        if len(vals):
            league[k] = {"avg": float(vals.mean()), "sd": float(vals.std()) or 1.0}
    return {"teams": out, "league": league}


def game_script(poss: pd.DataFrame, team: int) -> dict:
    """Starters left on the floor in 4th-quarter blowouts (and close games), how
    often the team is in one, and net points a 100 possessions by quarter."""
    out = {}
    mine = poss[(poss["off"] == team) | (poss["def"] == team)].sort_values(["game_id", "t0"])
    if mine.empty:
        return out
    is_off = (mine["off"] == team).to_numpy()
    five = np.where(is_off[:, None], mine[["o1", "o2", "o3", "o4", "o5"]].to_numpy(),
                    mine[["d1", "d2", "d3", "d4", "d5"]].to_numpy())
    gid = mine["game_id"].to_numpy()
    first_row = {}
    for i, g in enumerate(gid):
        first_row.setdefault(g, i)
    starters_on = np.array([len(set(five[i]) & set(five[first_row[g]])) for i, g in enumerate(gid)])
    lead = np.where(is_off, mine["margin"], -mine["margin"])
    q4 = mine["period"].to_numpy() == 4
    games = len(first_row)
    for label, cut in (("up", q4 & (lead >= BLOWOUT)), ("down", q4 & (lead <= -BLOWOUT))):
        out[f"blowout_{label}_starters"] = float(starters_on[cut].mean()) if cut.any() else None
        out[f"blowout_{label}_share"] = share(len(set(gid[cut])), games)
    close = q4 & (np.abs(lead) <= 5)
    out["close_starters"] = float(starters_on[close].mean()) if close.any() else None
    pts = mine["pts"].to_numpy()
    period = mine["period"].to_numpy()
    for q in (1, 2, 3, 4):
        o, d = (period == q) & is_off, (period == q) & ~is_off
        if o.any() and d.any():
            out[f"q{q}_net"] = float((pts[o].mean() - pts[d].mean()) * 100)
    return out


# ---- Matchup Extremes (the owner, 2026-10-26) ----
# "Brooklyn gives up 14 more points to teams that shoot a lot of threes, while
# the league only moves 3": for each team, how its games against one TYPE of
# opponent differ from its games against everyone, next to how the whole
# league's differ. A league average near zero can hide one team that falls
# apart and one that doesn't care; this finds them.
#
# A type is the top (or bottom) third of the 30 teams in one identity number.
# `side` "off" = the type describes the opponent's offense, so the rows are the
# team's DEFENSE (what the opponent did); "def" = the opponent's defense, so
# the rows are the team's OFFENSE. [key, label, profile key, top or bottom, side]
TYPES = [
    ["fast", "Fast Teams", "off_pace", "top", "off"],
    ["slow", "Slow Teams", "off_pace", "bottom", "off"],
    ["threes", "High 3-Point Volume", "off_three_rate", "top", "off"],
    ["rim", "Rim Attackers", "off_rim_share", "top", "off"],
    ["mid", "Mid-Range Teams", "off_mid_share", "top", "off"],
    ["corner", "Corner-3 Teams", "off_corner3_share", "top", "off"],
    ["line", "Foul-Line Attackers", "off_fta_rate", "top", "off"],
    ["glass", "Offensive Glass Teams", "off_oreb_rate", "top", "off"],
    ["transition", "Transition Teams", "off_trans_freq", "top", "off"],
    ["sloppy", "Turnover-Prone Teams", "off_tov_rate", "top", "off"],
    ["iso", "Pull-Up / Iso Teams", "off_self_made", "top", "off"],
    ["movement", "Ball-Movement Teams", "off_assisted", "top", "off"],
    ["star", "One-Star Offenses", "star_share", "top", "off"],
    ["bench", "Deep Benches", "bench_share", "top", "off"],
    ["hawks", "Ball-Hawk Defenses", "def_tov_rate", "top", "def"],
    ["foulers", "Defenses That Foul", "def_fta_rate", "top", "def"],
    ["protect", "Elite Rim Protection", "def_rim_pct", "bottom", "def"],
    ["nothrees", "Defenses That Take Away 3s", "def_three_rate", "bottom", "def"],
]
# What each game is measured on, a 100 possessions except pace.
OUTCOMES = ("pts", "pace", "fg3m", "fta", "tov")


def game_rows(season) -> pd.DataFrame:
    """One row a team-game on offense: points, 3s made, free throws, turnovers
    a 100 possessions, and the game's pace."""
    poss = season.possessions
    ends = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max().clip(lower=2880)
    g = poss.groupby(["game_id", "off", "def"]).agg(n=("pts", "size"), pts=("pts", "sum"), fta=("fta", "sum"),
                                                    tov=("tov", lambda s: int((s > 0).sum()))).reset_index()
    shots = season.actions[(season.actions["kind"] == "shot") & season.actions["three"] & season.actions["made"]]
    made3 = shots.groupby(["game_id", "team"]).size()
    g["fg3m"] = [made3.get((gid, t), 0) for gid, t in zip(g["game_id"], g["off"])]
    both = g.groupby("game_id")["n"].transform("mean")
    g["pace"] = both / g["game_id"].map(ends) * 2880
    for k in ("pts", "fg3m", "fta", "tov"):
        g[k] = g[k] / g["n"] * 100
    return g


def shot_shares(season) -> dict:
    """{team: {star_share, bench_share}}: the top player's share of his team's
    shots (FGA + 0.44 FTA), and the share taken by players who didn't start."""
    acts = season.actions[season.actions["kind"].isin(("shot", "ft"))]
    weight = np.where(acts["kind"] == "shot", 1.0, 0.44)
    a = acts.assign(w=weight)
    by_player = a.groupby(["team", "player"])["w"].sum()
    totals = a.groupby("team")["w"].sum()
    first = season.possessions.sort_values("t0").groupby(["game_id", "off"]).first()
    starters = {(gid, t): {r.o1, r.o2, r.o3, r.o4, r.o5} for (gid, t), r in first.iterrows()}
    bench = a[[p not in starters.get((gid, t), ()) for gid, t, p in zip(a["game_id"], a["team"], a["player"])]]
    bench_w = bench.groupby("team")["w"].sum()
    out = {}
    for team, tot in totals.items():
        out[team] = {"star_share": share(by_player[team].max(), tot), "bench_share": share(bench_w.get(team, 0), tot)}
    return out


def matchup_extremes(season, ident: dict, abbr_of: dict) -> dict:
    """{types: [{key, label, side, teams}], league: {type: {outcome: split}},
    teams: {abbr: {type: {n, outcome: [vs, split]}}}}.

    split = the team's average against that type minus its average against
    everyone (for "off" types, what its opponents did; for "def" types, what
    it did). The league's split is the same over every game, so the page's gap
    (team split minus league split) is how far this team is from normal."""
    rows = game_rows(season)
    rows["off"] = rows["off"].map(lambda t: abbr_of.get(t, str(t)))
    rows["def"] = rows["def"].map(lambda t: abbr_of.get(t, str(t)))
    shares = {abbr_of.get(t, str(t)): v for t, v in shot_shares(season).items()}
    prof = {t: {**r, **shares.get(t, {})} for t, r in ident["teams"].items()}
    out_types, league, teams = [], {}, {t: {} for t in prof}
    third = max(1, round(len(prof) / 3))
    for key, label, pkey, end, side in TYPES:
        vals = sorted(((r[pkey], t) for t, r in prof.items() if r.get(pkey) is not None), reverse=(end == "top"))
        members = {t for _, t in vals[:third]}
        out_types.append({"key": key, "label": label, "side": side, "teams": sorted(members)})
        # side off: the opponent is on offense -> rows where `off` is the opponent, judged for `def`
        me, them = ("def", "off") if side == "off" else ("off", "def")
        vs = rows[rows[them].isin(members)]
        league[key] = {o: r1(vs[o].mean() - rows[o].mean()) if len(vs) else None for o in OUTCOMES}
        for team, mine in rows.groupby(me):
            v = mine[mine[them].isin(members)]
            cell = {"n": int(len(v))}
            for o in OUTCOMES:
                cell[o] = [r1(v[o].mean()), r1(v[o].mean() - mine[o].mean())] if len(v) else None
            teams.setdefault(team, {})[key] = cell
    return {"types": out_types, "league": league, "teams": teams}


def r1(v):
    return None if v is None or pd.isna(v) else round(float(v), 1)


def rounded(v):
    return None if v is None else round(float(v), 4)


def season_block(pbp: pd.DataFrame, box: pd.DataFrame, label: str) -> dict | None:
    """One season for the page: {label, team_games (the middle team's games),
    teams {abbr: numbers}, league {key: {avg, sd}}}; None before any game."""
    import possessions as P
    season = P.Season(pbp, box)
    if season.possessions.empty:
        return None
    reg = box[box["season_type"] == P.REGULAR_SEASON]
    abbr = dict(zip(reg["team_id"].astype(int), reg["team_abbreviation"]))
    ident = team_identity(season, abbr)
    teams = {t: {k: (v if k == "games" else rounded(v)) for k, v in row.items()} for t, row in ident["teams"].items()}
    played = sorted(r["games"] for r in teams.values())
    return {
        "label": label,
        "team_games": played[len(played) // 2] if played else 0,
        "teams": teams,
        "league": {k: {"avg": rounded(v["avg"]), "sd": rounded(v["sd"])} for k, v in ident["league"].items()},
        "extremes": matchup_extremes(season, ident, abbr),
    }


REFERENCE = Path(__file__).parent / "identity_{season}.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--team", default="BOS")
    ap.add_argument("--label", default="2025-26")
    ap.add_argument("--write", action="store_true", help="save the finished season as nfl_tool/nba/identity_<season>.json")
    args = ap.parse_args()
    d = Path(args.data_dir)
    block = season_block(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"),
                         pd.read_parquet(d / f"player_box_{args.season}.parquet"), args.label)
    if args.write:
        out = Path(str(REFERENCE).format(season=args.season))
        out.write_text(json.dumps(block, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {out}")
    for k, v in sorted(block["teams"][args.team].items()):
        lg = block["league"].get(k)
        print(f"{k:24} {v!s:>10}  league {lg['avg']}" if lg and v is not None else f"{k:24} {v}")


if __name__ == "__main__":
    main()
