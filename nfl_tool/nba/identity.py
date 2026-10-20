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
