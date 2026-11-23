"""Touchdown numbers for the NFL build: TDs per game, first TDs, scoring plays by
position, the TD matchup model, possessions before the first TD and King of the
Endzone (KOE).

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import json
from pathlib import Path

import pandas as pd

from nfl_common import POSITION_BUCKETS, POSITION_KEYS, RED_ZONE_YARDLINE, bucket_position, length_bucket, normalize_team


def compute_team_game_td_counts(pbp: pd.DataFrame) -> pd.DataFrame:
    td_plays = pbp[pbp["touchdown"] == 1].copy()
    # Offensive scoring plays only (exclude defensive/ST return TDs) for the
    # pass/rush per-team-offense breakdown.
    off_td = td_plays[(td_plays["pass_touchdown"] == 1) | (td_plays["rush_touchdown"] == 1)].copy()
    off_td["td_type"] = off_td["pass_touchdown"].map(lambda v: "pass" if v == 1 else "rush")

    per_game = (
        off_td.groupby(["posteam", "game_id", "td_type"]).size().unstack(fill_value=0)
    )
    per_game = per_game.rename(columns={"pass": "pass_td", "rush": "rush_td"})
    for c in ("pass_td", "rush_td"):
        if c not in per_game.columns:
            per_game[c] = 0
    per_game["total_td"] = per_game["pass_td"] + per_game["rush_td"]
    per_game = per_game.reset_index()
    return per_game


def compute_team_game_td_allowed(pbp: pd.DataFrame) -> pd.DataFrame:
    """Same as compute_team_game_td_counts but grouped by the defending team
    (i.e. touchdowns given up), for the matchup's 'what does the opponent's
    defense tend to allow' view."""
    td_plays = pbp[pbp["touchdown"] == 1].copy()
    off_td = td_plays[(td_plays["pass_touchdown"] == 1) | (td_plays["rush_touchdown"] == 1)].copy()
    off_td["td_type"] = off_td["pass_touchdown"].map(lambda v: "pass" if v == 1 else "rush")

    per_game = (
        off_td.groupby(["defteam", "game_id", "td_type"]).size().unstack(fill_value=0)
    )
    per_game = per_game.rename(columns={"pass": "pass_td_allowed", "rush": "rush_td_allowed"})
    for c in ("pass_td_allowed", "rush_td_allowed"):
        if c not in per_game.columns:
            per_game[c] = 0
    per_game["total_td_allowed"] = per_game["pass_td_allowed"] + per_game["rush_td_allowed"]
    per_game = per_game.reset_index()
    return per_game


def compute_games_played(pbp: pd.DataFrame) -> dict:
    games = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        gids = pbp.loc[
            (pbp["home_team"] == team) | (pbp["away_team"] == team), "game_id"
        ].unique()
        games[team] = len(gids)
    return games


def compute_first_td_per_game(pbp: pd.DataFrame, pos_lookup):
    """Returns dict game_id -> detail about the game's very first TD: which
    team scored/allowed it, the scorer, and (for the "opportunities before
    first TD" and pre-first-TD red zone analysis) the play_id/drive number
    and whether it was a normal offensive scrimmage score."""
    td_plays = pbp[pbp["touchdown"] == 1].copy()
    td_plays = td_plays.sort_values(["game_id", "play_id"])
    first = td_plays.groupby("game_id").first()
    result = {}
    for game_id, row in first.iterrows():
        team = normalize_team(row.get("td_team"))
        allowed_team = row["away_team"] if team == row["home_team"] else row["home_team"]
        is_offense_td = row.get("pass_touchdown") == 1 or row.get("rush_touchdown") == 1
        player_id = row.get("td_player_id")
        player_name = row.get("td_player_name")
        week = row.get("week")
        pos, _, full_name = pos_lookup(player_id, week)
        result[game_id] = {
            "team": team,
            "allowed_team": allowed_team,
            "player_id": player_id,
            "player_name": full_name or player_name,
            "position": bucket_position(pos) if pos else None,
            "play_id": row["play_id"],
            "drive": row["drive"],
            "is_offense_td": bool(is_offense_td),
            "week": int(week) if pd.notna(week) else None,
        }
    return result


def scoring_plays_with_position(pbp: pd.DataFrame, pos_lookup) -> pd.DataFrame:
    """One row per TD play of ANY type (offensive pass/rush AND defensive/
    special-teams returns) with the scorer's id/name/position, which team
    scored it, and which team allowed it. Unlike posteam/defteam (who had
    the ball at snap), scoring_team/allowed_team always reflect who actually
    benefited -- correct for a pick-six or a blocked-punt return where the
    "offense" at snap is the team that got scored on."""
    td_plays = pbp[pbp["touchdown"] == 1].copy()

    def scorer_id(row):
        if row["pass_touchdown"] == 1:
            return row.get("receiver_player_id")
        if row["rush_touchdown"] == 1:
            return row.get("rusher_player_id")
        return row.get("td_player_id")

    def scorer_name(row):
        if row["pass_touchdown"] == 1:
            return row.get("receiver_player_name")
        if row["rush_touchdown"] == 1:
            return row.get("rusher_player_name")
        return row.get("td_player_name")

    def td_type(row):
        if row["pass_touchdown"] == 1:
            return "pass"
        if row["rush_touchdown"] == 1:
            return "rush"
        return "dst"

    def scoring_team(row):
        if row["pass_touchdown"] == 1 or row["rush_touchdown"] == 1:
            return row["posteam"]
        return normalize_team(row.get("td_team"))

    def allowed_team(row):
        if row["pass_touchdown"] == 1 or row["rush_touchdown"] == 1:
            return row["defteam"]
        scorer = normalize_team(row.get("td_team"))
        return row["away_team"] if scorer == row["home_team"] else row["home_team"]

    td_plays["scorer_id"] = td_plays.apply(scorer_id, axis=1)
    td_plays["scorer_name_raw"] = td_plays.apply(scorer_name, axis=1)
    td_plays["td_type"] = td_plays.apply(td_type, axis=1)
    td_plays["scoring_team"] = td_plays.apply(scoring_team, axis=1)
    td_plays["allowed_team"] = td_plays.apply(allowed_team, axis=1)

    positions, full_names = [], []
    for _, row in td_plays.iterrows():
        pos, _, full_name = pos_lookup(row["scorer_id"], row["week"])
        positions.append(bucket_position(pos) if pos else "DST")
        full_names.append(full_name or row["scorer_name_raw"])
    td_plays["position"] = positions
    td_plays["scorer_name"] = full_names

    # Same length-bucket rule as compute_length_buckets: only a rush/pass
    # scrimmage TD has a meaningful "length" -- a return score doesn't.
    td_plays["length_bucket"] = None
    scrimmage_mask = td_plays["td_type"].isin(["pass", "rush"])
    td_plays.loc[scrimmage_mask, "length_bucket"] = (
        td_plays.loc[scrimmage_mask, "yards_gained"].clip(lower=0).map(length_bucket)
    )
    return td_plays


# Field-position bins for expected TDs (yardline_100 = yards to the end
# zone at the snap). Finer inside the 10, where TD odds change fastest.
XTD_YARDLINE_BINS = [0, 2, 5, 10, 15, 20, 30, 50, 100]
XTD_MIN_CELL = 25  # plays needed before a (spot, throw depth) cell's own TD rate is trusted
# Opponent adjustment shrinks each opponent's "normal" toward the league
# average by this many league-average games -- with 1-3 games of data, a
# single opponent game can't be trusted on its own.
OPP_ADJ_SHRINK_GAMES = 2.0


def compute_td_matchup_model(pbp: pd.DataFrame, scoring_df: pd.DataFrame, pos_lookup) -> dict:
    """Backs the TD Data page's Targets column. Two things the raw TD
    tables can't show:

    1. Expected TDs (xTD) from usage: every target and carry gets the
       league's TD rate for that play type from that spot on the field, so
       an offense feeding its WRs targets at the 5 shows up even if those
       WRs haven't scored yet (and a defense that keeps allowing them
       shows up as exposed even if it got lucky).
    2. Opponent adjustment: each game's number is compared with what that
       opponent normally allows (offense) or scores (defense) in its OTHER
       games, so two games against weak defenses don't make an offense look
       elite, and a defense that faced two great offenses isn't buried.

    Returns {team: {"off": {metric: {"adj": x, "xtd": y}}, "def": {...}}},
    all per game, where metric is a position (QB/RB/WR/TE/DST), "pass",
    "rush", "first" (1st TD of the game) or a length bucket."""
    plays = pbp[(pbp["two_point_attempt"] != 1) & pbp["yardline_100"].notna()].copy()
    targets = plays[(plays["pass_attempt"] == 1) & (plays["sack"] != 1) & plays["receiver_player_id"].notna()].copy()
    carries = plays[(plays["rush_attempt"] == 1) & plays["rusher_player_id"].notna()].copy()
    targets["kind"], targets["td"], targets["pid"] = "pass", targets["pass_touchdown"].fillna(0), targets["receiver_player_id"]
    carries["kind"], carries["td"], carries["pid"] = "rush", carries["rush_touchdown"].fillna(0), carries["rusher_player_id"]
    opp = pd.concat([targets, carries], ignore_index=True)
    opp["bin"] = pd.cut(opp["yardline_100"], XTD_YARDLINE_BINS, include_lowest=True)
    # Targets also keyed by where the ball was thrown: into the end zone
    # (air_yards >= distance to goal -- ~50% of these score, vs ~2-4% for
    # anything short of it), or short/intermediate/deep otherwise. Field
    # position alone valued every deep shot as near-worthless, which hid
    # big-play passing offenses and defenses that give up end-zone throws.
    air, ydl = opp["air_yards"], opp["yardline_100"]
    opp["air"] = "run"
    is_pass = opp["kind"] == "pass"
    opp.loc[is_pass, "air"] = "short"
    opp.loc[is_pass & (air >= 10), "air"] = "mid"
    opp.loc[is_pass & (air >= 20), "air"] = "deep"
    opp.loc[is_pass & (air >= ydl), "air"] = "ez"
    fine = opp.groupby(["kind", "bin", "air"], observed=True)["td"].agg(["mean", "size"])
    coarse = opp.groupby(["kind", "bin"], observed=True)["td"].mean()

    def xtd_rate(k, b, a):
        # Fall back to the field-position-only rate when a cell is too thin.
        if (k, b, a) in fine.index and fine.loc[(k, b, a), "size"] >= XTD_MIN_CELL:
            return fine.loc[(k, b, a), "mean"]
        return coarse.get((k, b), 0.0)

    cache = {}
    opp["xtd"] = [cache.setdefault(key, xtd_rate(*key)) for key in zip(opp["kind"], opp["bin"], opp["air"])]
    opp["position"] = [
        bucket_position(pos_lookup(pid, wk)[0]) if pos_lookup(pid, wk)[0] else None
        for pid, wk in zip(opp["pid"], opp["week"])
    ]

    # First-TD window: plays before the game's first touchdown (the whole
    # game if nobody scored one) -- the usage that actually decides a
    # First TD bet, as opposed to garbage-time volume.
    first_td_play = scoring_df.groupby("game_id")["play_id"].min()
    opp["early"] = opp["play_id"] < opp["game_id"].map(first_td_play).fillna(float("inf"))
    opp["early_xtd"] = opp["xtd"].where(opp["early"], 0.0)

    games = pbp.groupby("game_id").agg(home=("home_team", "first"), away=("away_team", "first")).reset_index()
    sides = pd.concat(
        [
            games.rename(columns={"home": "off", "away": "def"})[["game_id", "off", "def"]],
            games.rename(columns={"away": "off", "home": "def"})[["game_id", "off", "def"]],
        ],
        ignore_index=True,
    )

    # One row per (game, offense, defense), one column per metric.
    tds = scoring_df.sort_values(["game_id", "play_id"]).copy()
    tds["first"] = ~tds.duplicated("game_id")
    metric_cols = {}
    for pos in ("QB", "RB", "WR", "TE", "DST"):
        metric_cols[f"td_{pos}"] = tds[tds["position"] == pos].groupby(["game_id", "scoring_team"]).size()
        if pos != "DST":  # return/defensive TDs have no target/carry usage
            metric_cols[f"xtd_{pos}"] = opp[opp["position"] == pos].groupby(["game_id", "posteam"])["xtd"].sum()
    for kind in ("pass", "rush"):
        metric_cols[f"td_{kind}"] = tds[tds["td_type"] == kind].groupby(["game_id", "scoring_team"]).size()
        metric_cols[f"xtd_{kind}"] = opp[opp["kind"] == kind].groupby(["game_id", "posteam"])["xtd"].sum()
    metric_cols["td_first"] = tds[tds["first"]].groupby(["game_id", "scoring_team"]).size()
    metric_cols["xtd_first"] = opp.groupby(["game_id", "posteam"])["early_xtd"].sum()
    for pos in ("QB", "RB", "WR", "TE"):
        metric_cols[f"td_first_{pos}"] = tds[tds["first"] & (tds["position"] == pos)].groupby(["game_id", "scoring_team"]).size()
        metric_cols[f"xtd_first_{pos}"] = opp[opp["position"] == pos].groupby(["game_id", "posteam"])["early_xtd"].sum()
    for bucket in ("10_or_less", "11_20", "21_40", "41_plus"):
        metric_cols[f"td_{bucket}"] = tds[tds["length_bucket"] == bucket].groupby(["game_id", "scoring_team"]).size()

    # Deep-ball / end-zone exposure counts (targets, not TDs): end-zone
    # throws and 20+ air-yard throws per game, for the matchup tags.
    is_target = opp["kind"] == "pass"
    metric_cols["cnt_ez"] = opp[is_target & (opp["air"] == "ez")].groupby(["game_id", "posteam"]).size()
    metric_cols["cnt_deep"] = opp[is_target & (opp["air_yards"] >= 20)].groupby(["game_id", "posteam"]).size()

    key = pd.MultiIndex.from_frame(sides[["game_id", "off"]])
    for col, series in metric_cols.items():
        sides[col] = series.reindex(key).fillna(0).to_numpy()

    def adjusted(col: str) -> tuple[dict, dict]:
        """Per-team opponent-adjusted per-game value, offense and defense."""
        league = sides[col].mean()
        off_sum = sides.groupby("off")[col].agg(["sum", "count"])
        def_sum = sides.groupby("def")[col].agg(["sum", "count"])

        def normal(table, team, value):
            # That opponent's average EXCLUDING this game, shrunk to league.
            s, n = (table.loc[team, "sum"], table.loc[team, "count"]) if team in table.index else (0.0, 0)
            s, n = s - value, n - 1
            return (s + OPP_ADJ_SHRINK_GAMES * league) / (n + OPP_ADJ_SHRINK_GAMES)

        off_res = sides.apply(lambda r: r[col] - normal(def_sum, r["def"], r[col]), axis=1)
        def_res = sides.apply(lambda r: r[col] - normal(off_sum, r["off"], r[col]), axis=1)
        off_adj = (league + off_res.groupby(sides["off"]).mean()).round(3).to_dict()
        def_adj = (league + def_res.groupby(sides["def"]).mean()).round(3).to_dict()
        return off_adj, def_adj

    out: dict = {}
    metrics = ["QB", "RB", "WR", "TE", "DST", "pass", "rush", "first", "10_or_less", "11_20", "21_40", "41_plus"]
    metrics += [f"first_{pos}" for pos in ("QB", "RB", "WR", "TE")]
    for m in metrics:
        off_adj, def_adj = adjusted(f"td_{m}")
        xtd = adjusted(f"xtd_{m}") if f"xtd_{m}" in sides.columns else ({}, {})
        for team in set(off_adj) | set(def_adj):
            t = out.setdefault(team, {"off": {}, "def": {}})
            t["off"][m] = {"adj": off_adj.get(team)}
            t["def"][m] = {"adj": def_adj.get(team)}
            if xtd[0]:
                t["off"][m]["xtd"] = xtd[0].get(team)
                t["def"][m]["xtd"] = xtd[1].get(team)

    for m in ("ez", "deep"):
        off_adj, def_adj = adjusted(f"cnt_{m}")
        for team in set(off_adj) | set(def_adj):
            t = out.setdefault(team, {"off": {}, "def": {}})
            t["off"][m] = {"adj": off_adj.get(team)}
            t["def"][m] = {"adj": def_adj.get(team)}

    # Per player: usage-based expected TDs per team game, whole game and
    # first-TD window, plus actual TDs/first TDs -- the player layer of the
    # First TD targets. Per TEAM game (not games the player appeared in),
    # so a part-timer's share reads as a share of the team's opportunity.
    team_games = sides.groupby("off")["game_id"].nunique()
    td_by_player = tds.groupby("scorer_id").agg(tds=("game_id", "size"), first_tds=("first", "sum"))
    players: dict = {}
    # Per-player usage counts for the Summary card's key-player matching
    # (who gets the red zone / end zone / deep looks behind a tag).
    opp["is_tgt"] = opp["kind"] == "pass"
    opp["is_car"] = opp["kind"] == "rush"
    opp["rz_tgt"] = opp["is_tgt"] & (opp["yardline_100"] <= 20)
    opp["rz_car"] = opp["is_car"] & (opp["yardline_100"] <= 20)
    opp["ez_tgt"] = opp["is_tgt"] & (opp["air"] == "ez")
    opp["deep_tgt"] = opp["is_tgt"] & (opp["air_yards"] >= 20)
    grouped = opp.groupby(["posteam", "pid"]).agg(
        xtd=("xtd", "sum"), early_xtd=("early_xtd", "sum"), week=("week", "max"),
        targets=("is_tgt", "sum"), carries=("is_car", "sum"), rz_targets=("rz_tgt", "sum"),
        rz_carries=("rz_car", "sum"), ez_targets=("ez_tgt", "sum"), deep_targets=("deep_tgt", "sum"),
    )
    # Same numbers per game, so the TD page can drop a game a player left
    # early or discount one a regular teammate missed (see the page's
    # lineupWeights) instead of trusting raw season totals.
    weekly = opp.groupby(["posteam", "pid", "week"]).agg(
        xtd=("xtd", "sum"), early_xtd=("early_xtd", "sum"),
        targets=("is_tgt", "sum"), carries=("is_car", "sum"), rz_targets=("rz_tgt", "sum"),
        rz_carries=("rz_car", "sum"), ez_targets=("ez_tgt", "sum"), deep_targets=("deep_tgt", "sum"),
    )
    tds["week"] = tds["game_id"].map(pbp.groupby("game_id")["week"].first())
    td_weekly = tds.groupby(["scorer_id", "week"]).agg(tds=("game_id", "size"), first_tds=("first", "sum"))
    WEEK_FIELDS = ["xtd", "early_xtd", "targets", "carries", "rz_targets", "rz_carries", "ez_targets", "deep_targets", "tds", "first_tds"]

    def by_week(team, pid):
        out = {}
        if (team, pid) in weekly.index.droplevel(2):
            for wk, r in weekly.loc[(team, pid)].iterrows():
                out[int(wk)] = [round(float(r["xtd"]), 3), round(float(r["early_xtd"]), 3)] + [int(r[k]) for k in ("targets", "carries", "rz_targets", "rz_carries", "ez_targets", "deep_targets")] + [0, 0]
        if pid in td_weekly.index.get_level_values(0):
            for wk, r in td_weekly.loc[pid].iterrows():
                row = out.setdefault(int(wk), [0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0])
                row[8], row[9] = int(r["tds"]), int(r["first_tds"])
        return out

    for (team, pid), row in grouped.iterrows():
        pos, _, name = pos_lookup(pid, row["week"])
        pos = bucket_position(pos) if pos else None
        if pos not in ("QB", "RB", "WR", "TE") or row["xtd"] <= 0:
            continue
        g = team_games.get(team, 0) or 1
        actual = td_by_player.loc[pid] if pid in td_by_player.index else None
        players.setdefault(team, []).append(
            {
                "player_id": pid,
                "name": name,
                "position": pos,
                "xtd_pg": round(row["xtd"] / g, 3),
                "early_xtd_pg": round(row["early_xtd"] / g, 3),
                "tds": int(actual["tds"]) if actual is not None else 0,
                "first_tds": int(actual["first_tds"]) if actual is not None else 0,
                **{k: int(row[k]) for k in ("targets", "carries", "rz_targets", "rz_carries", "ez_targets", "deep_targets")},
                # {week: [xtd, early_xtd, targets, carries, rz_targets,
                #  rz_carries, ez_targets, deep_targets, tds, first_tds]}
                "by_week": by_week(team, pid),
            }
        )
    for team in players:
        players[team].sort(key=lambda p: -p["xtd_pg"])
    return {"teams": out, "players": players}


def compute_td_allowed_log(scoring_df: pd.DataFrame) -> dict:
    """Every TD each team has allowed, one entry per play, in game order --
    backs the TD Data page's click-a-defense-header modal. score_before is
    the scoring team's score first, then the allowing team's, as of the
    snap (posteam_score/defteam_score are pre-play; a return TD's scoring
    team is the snap's DEFENSE, so the pair flips)."""
    df = scoring_df.sort_values(["game_id", "play_id"]).copy()
    df["first_td"] = ~df.duplicated("game_id")
    out: dict = {}
    for _, row in df.iterrows():
        team = row["allowed_team"]
        if not isinstance(team, str):
            continue
        off_scored = row["td_type"] in ("pass", "rush")
        own, opp = (row.get("posteam_score"), row.get("defteam_score")) if off_scored else (row.get("defteam_score"), row.get("posteam_score"))
        score_before = f"{int(own)}-{int(opp)}" if pd.notna(own) and pd.notna(opp) else None
        yards = row.get("yards_gained") if off_scored else row.get("return_yards")
        out.setdefault(team, []).append(
            {
                "week": int(row["week"]),
                "opp": row["scoring_team"],
                "qtr": int(row["qtr"]) if pd.notna(row.get("qtr")) else None,
                "clock": row.get("time") if isinstance(row.get("time"), str) else None,
                "player": row["scorer_name"] if isinstance(row["scorer_name"], str) else None,
                "position": row["position"],
                "type": row["td_type"],
                "yards": int(yards) if pd.notna(yards) else None,
                "passer": row.get("passer_player_name") if row["td_type"] == "pass" and isinstance(row.get("passer_player_name"), str) else None,
                "score_before": score_before,
                "first_td": bool(row["first_td"]),
            }
        )
    return out


# ---- Promo Tools: King of the Endzone (DraftKings' longest-TD promo) ----
# Who has the upside to score the game's LONGEST touchdown: each player's
# TD lengths plus the long-play profile that produces long TDs (20+/40+
# runs and catches, deep targets, ADOT), each defense's big plays and long
# TDs allowed, and every team's D/ST TDs (the promo counts D/ST: pick-sixes,
# fumble returns, kick and punt returns).
KOE_BIG = 20
KOE_HUGE = 40
KOE_DEEP_AIR = 20


def compute_koe(pbp: pd.DataFrame, pos_lookup) -> dict:
    plays = pbp[(pbp["two_point_attempt"] != 1) & pbp["posteam"].notna() & pbp["defteam"].notna()].copy()
    yds = plays["yards_gained"].fillna(0)
    games = pbp.groupby("game_id").agg(home=("home_team", "first"), away=("away_team", "first"), week=("week", "first"))
    played = {}
    for g in games.itertuples():
        played.setdefault(g.home, set()).add(g.Index)
        played.setdefault(g.away, set()).add(g.Index)

    rush = plays[(plays["rush_attempt"] == 1) & plays["rusher_player_id"].notna()]
    tgt = plays[(plays["pass_attempt"] == 1) & (plays["sack"] != 1) & plays["receiver_player_id"].notna()]
    catch = tgt[tgt["complete_pass"] == 1]
    off_td = plays[((plays["rush_touchdown"] == 1) | (plays["pass_touchdown"] == 1)) & (plays["td_team"] == plays["posteam"]) & plays["td_player_id"].notna()]

    out_players: dict = {}

    def row(team, pid, week):
        pos, _, name = pos_lookup(pid, week)
        pos = bucket_position(pos) if pos else None
        if pos not in POSITION_BUCKETS:
            return None
        rows = out_players.setdefault(team, {})
        if pid not in rows:
            rows[pid] = {"name": name or pid, "position": pos, "g": set(), "car": 0, "tgt": 0, "rec": 0,
                         "r10": 0, "r20": 0, "r40": 0, "c20": 0, "c40": 0, "long_rush": 0, "long_rec": 0,
                         "air": 0.0, "air_n": 0, "deep_tgt": 0, "deep_rec": 0, "tds": []}
        return rows[pid]

    for r in rush.itertuples():
        p = row(r.posteam, r.rusher_player_id, r.week)
        if not p:
            continue
        y = r.yards_gained if pd.notna(r.yards_gained) else 0
        p["g"].add(r.game_id)
        p["car"] += 1
        p["r10"] += y >= 10
        p["r20"] += y >= KOE_BIG
        p["r40"] += y >= KOE_HUGE
        p["long_rush"] = max(p["long_rush"], y)
    for r in tgt.itertuples():
        p = row(r.posteam, r.receiver_player_id, r.week)
        if not p:
            continue
        p["g"].add(r.game_id)
        p["tgt"] += 1
        if pd.notna(r.air_yards):
            p["air"] += r.air_yards
            p["air_n"] += 1
            if r.air_yards >= KOE_DEEP_AIR:
                p["deep_tgt"] += 1
                p["deep_rec"] += r.complete_pass == 1
        if r.complete_pass == 1:
            y = r.yards_gained if pd.notna(r.yards_gained) else 0
            p["rec"] += 1
            p["c20"] += y >= KOE_BIG
            p["c40"] += y >= KOE_HUGE
            p["long_rec"] = max(p["long_rec"], y)
    for r in off_td.itertuples():
        p = row(r.posteam, r.td_player_id, r.week)
        if p:
            p["g"].add(r.game_id)
            p["tds"].append(int(r.yards_gained) if pd.notna(r.yards_gained) else 0)

    players = {}
    for team, rows in out_players.items():
        lst = []
        for p in rows.values():
            n = len(p["g"])
            if not n:
                continue
            lst.append({
                "name": p["name"], "position": p["position"], "games": n,
                "carries": p["car"], "targets": p["tgt"], "receptions": p["rec"],
                "runs10": int(p["r10"]), "runs20": int(p["r20"]), "runs40": int(p["r40"]),
                "catches20": int(p["c20"]), "catches40": int(p["c40"]),
                "long_rush": int(p["long_rush"]), "long_rec": int(p["long_rec"]),
                "adot": round(p["air"] / p["air_n"], 1) if p["air_n"] else None,
                "deep_targets": p["deep_tgt"], "deep_catches": int(p["deep_rec"]),
                "tds": sorted(p["tds"], reverse=True),
            })
        players[team] = sorted(lst, key=lambda x: -(x["carries"] + x["targets"]))

    # Defense: big plays and long TDs allowed. Offense: big plays made.
    big = plays[((plays["rush_attempt"] == 1) | (plays["complete_pass"] == 1)) & (yds >= KOE_BIG)]
    teams: dict = {}
    for t, gs in played.items():
        teams[t] = {"games": len(gs), "runs20_allowed": 0, "catches20_allowed": 0, "plays40_allowed": 0,
                    "tds_allowed": [], "big_plays": 0, "plays40": 0, "dst_tds": [], "dst_tds_allowed": []}
    for r in big.itertuples():
        y = r.yards_gained
        d, o = teams.get(r.defteam), teams.get(r.posteam)
        if d:
            d["runs20_allowed" if r.rush_attempt == 1 else "catches20_allowed"] += 1
            d["plays40_allowed"] += y >= KOE_HUGE
        if o:
            o["big_plays"] += 1
            o["plays40"] += y >= KOE_HUGE
    for r in off_td.itertuples():
        if r.defteam in teams:
            teams[r.defteam]["tds_allowed"].append(int(r.yards_gained) if pd.notna(r.yards_gained) else 0)

    # D/ST TDs: any return TD (interception, fumble, kickoff, punt, blocked kick).
    ret = pbp[(pbp["return_touchdown"] == 1) & pbp["td_team"].notna()]
    for r in ret.itertuples():
        ry = r.return_yards if pd.notna(r.return_yards) and r.return_yards > 0 else r.fumble_recovery_1_yards
        length = int(ry) if pd.notna(ry) else 0
        if r.play_type == "kickoff":
            kind = "KR"
        elif r.play_type == "punt":
            kind = "PR"
        elif r.interception == 1:
            kind = "INT"
        elif r.fumble == 1 or r.fumble_lost == 1:
            kind = "FUM"
        else:
            kind = "RET"
        scorer, victim = r.td_team, (r.home_team if r.td_team == r.away_team else r.away_team)
        if scorer in teams:
            teams[scorer]["dst_tds"].append({"yds": length, "kind": kind, "week": int(r.week), "opp": victim})
        if victim in teams:
            teams[victim]["dst_tds_allowed"].append({"yds": length, "kind": kind, "week": int(r.week), "opp": scorer})
    for t in teams.values():
        t["tds_allowed"].sort(reverse=True)
    return {"players": players, "teams": teams, "big": KOE_BIG, "huge": KOE_HUGE, "deep_air": KOE_DEEP_AIR}


KOE_WEEKS_DIR = Path(__file__).resolve().parent.parent / "model_history" / "nfl_koe"


def koe_game_results(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Every finished game's King of the Endzone answer: `longest` (yds),
    `winners` (everyone whose TD was that long; D/ST as "<TEAM> D/ST") and
    `tds` = each scorer's longest TD that game. Names are the roster's full
    names, the same as the board's, so the page can match them."""
    out = {}
    tds = pbp[(pbp["touchdown"] == 1) & pbp["td_team"].notna() & (pbp["two_point_attempt"] != 1)]
    for gid, g in tds.groupby("game_id"):
        best: dict = {}
        for r in g.itertuples():
            if r.return_touchdown == 1 or r.td_team != r.posteam:
                ry = r.return_yards if pd.notna(r.return_yards) and r.return_yards > 0 else r.fumble_recovery_1_yards
                yds, name, team = int(ry) if pd.notna(ry) else 0, f"{r.td_team} D/ST", r.td_team
            else:
                if not isinstance(r.td_player_id, str):
                    continue
                _, _, full = pos_lookup(r.td_player_id, r.week)
                yds, name, team = int(r.yards_gained) if pd.notna(r.yards_gained) else 0, full or r.td_player_name, r.td_team
            key = (name, team)
            best[key] = max(best.get(key, -1), yds)
        if not best:
            continue
        longest = max(best.values())
        out[gid] = {
            "longest": longest,
            "winners": [{"name": n, "team": t, "yds": y} for (n, t), y in best.items() if y == longest],
            "tds": [[n, t, y] for (n, t), y in sorted(best.items(), key=lambda kv: -kv[1])],
        }
    return out


def koe_week_boards(pbp: pd.DataFrame, pos_lookup, schedule: list, folder: Path | None, season: int) -> dict:
    """King of the Endzone as it stood going into each week: compute_koe on
    the games before week W, for W = 2 through the week now being played
    (week 1 has nothing before it). The page's week toggle shows a past week
    from these, and the Winners list reads its pregame ranks from them.
    A board is saved to `folder` once every earlier game is final and read
    back from then on, so the build doesn't redo the whole season every run."""
    weeks = sorted({g["week"] for g in schedule if g.get("week")})
    final = lambda w: all(g.get("status") == "final" for g in schedule if g.get("week") and g["week"] < w)
    started = {g["week"] for g in schedule if g.get("week") and g.get("status") == "final"}
    if not started:
        return {}
    now = max(started)
    if all(g.get("status") == "final" for g in schedule if g.get("week") == now) and now + 1 in weeks:
        now += 1
    boards = {}
    for w in range(2, now + 1):
        path = folder / str(season) / f"week-{w:02d}.json" if folder else None
        if path and path.exists():
            boards[str(w)] = json.loads(path.read_text(encoding="utf-8"))
            continue
        board = compute_koe(pbp[pbp["week"] < w], pos_lookup)
        boards[str(w)] = board
        if path and final(w):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(board, separators=(",", ":")) + "\n", encoding="utf-8")
    return boards


def compute_possessions_to_score(pbp: pd.DataFrame, first_td_by_game: dict) -> dict:
    """For games where the first TD was a normal offensive score, returns
    dict game_id -> possession_number: which of the scoring team's OWN
    drives (1st, 2nd, 3rd...) produced the first TD. Games where the first
    score was a defensive/special-teams return are excluded -- "how many of
    my own possessions did it take" doesn't map onto a play that happens on
    defense/special teams rather than during one of the team's own drives."""
    result = {}
    for game_id, info in first_td_by_game.items():
        if not info["is_offense_td"]:
            continue
        team = info["team"]
        game_plays = pbp[(pbp["game_id"] == game_id) & (pbp["posteam"] == team)]
        own_drives = sorted(game_plays["drive"].dropna().unique())
        if info["drive"] not in own_drives:
            continue
        result[game_id] = own_drives.index(info["drive"]) + 1
    return result


def compute_trailing_possessions(pbp: pd.DataFrame, first_td_by_game: dict) -> dict:
    """For every game, how many of the OTHER team's own possessions
    happened before the game's first TD -- i.e. for the team that did NOT
    score first, how many of their own chances they'd gotten by the time
    the opponent got there. 0 means the opponent scored before this team's
    offense ever took the field. Keyed by game_id since each game has
    exactly one such team (first_td_by_game[game_id]["allowed_team"])."""
    result = {}
    for game_id, info in first_td_by_game.items():
        team = info["allowed_team"]
        team_plays = pbp[(pbp["game_id"] == game_id) & (pbp["posteam"] == team) & (pbp["play_id"] <= info["play_id"])]
        own_drives = team_plays["drive"].dropna().unique()
        result[game_id] = len(own_drives)
    return result


def compute_pre_first_td_red_zone(pbp: pd.DataFrame, first_td_by_game: dict) -> tuple:
    """Red zone trips that started at or before the game's very first TD
    (regardless of who eventually scored it), and how many of those trips
    were the actual drive that produced it -- a "before anyone's scored"
    red zone conversion rate, both for this team's own offense and what its
    defense allowed. Uses play_id <= the first-TD play (not strictly before)
    so a touchdown scored on a drive's very first snap inside the red zone
    still counts as a red-zone trip for that drive, not a miss."""
    off_trips, off_conversions = {}, {}
    def_trips, def_conversions = {}, {}
    for game_id, info in first_td_by_game.items():
        pre = pbp[
            (pbp["game_id"] == game_id) & (pbp["play_id"] <= info["play_id"]) & (pbp["yardline_100"] <= RED_ZONE_YARDLINE)
        ]
        scoring_team = info["team"] if info["is_offense_td"] else None
        scoring_drive = info["drive"] if info["is_offense_td"] else None

        for team, drives in pre.groupby("posteam")["drive"]:
            unique_drives = drives.unique()
            off_trips[team] = off_trips.get(team, 0) + len(unique_drives)
            if team == scoring_team and scoring_drive in unique_drives:
                off_conversions[team] = off_conversions.get(team, 0) + 1
        for team, drives in pre.groupby("defteam")["drive"]:
            unique_drives = drives.unique()
            def_trips[team] = def_trips.get(team, 0) + len(unique_drives)
            if scoring_team is not None and team != scoring_team and scoring_drive in unique_drives:
                def_conversions[team] = def_conversions.get(team, 0) + 1
    return off_trips, off_conversions, def_trips, def_conversions


def compute_pre_first_td_player_usage(pbp: pd.DataFrame, first_td_by_game: dict, pos_lookup) -> dict:
    """Per-player carries/targets/receptions inside the red zone before the
    game's first TD (same window as compute_pre_first_td_red_zone) --
    who was actually getting the ball in the "opening act" red zone chances."""
    tally = {}

    def ensure(team, pid, name, pos):
        key = (team, pid)
        if key not in tally:
            tally[key] = {"player_id": pid, "name": name, "team": team, "position": pos, "carries": 0, "targets": 0, "receptions": 0}
        return tally[key]

    for game_id, info in first_td_by_game.items():
        pre = pbp[
            (pbp["game_id"] == game_id) & (pbp["play_id"] <= info["play_id"]) & (pbp["yardline_100"] <= RED_ZONE_YARDLINE)
        ]
        for _, row in pre[pre["rush_attempt"] == 1].iterrows():
            pid = row.get("rusher_player_id")
            if pd.isna(pid):
                continue
            pos, _, name = pos_lookup(pid, row["week"])
            p = ensure(row["posteam"], pid, name or row.get("rusher_player_name"), bucket_position(pos) if pos else "DST")
            p["carries"] += 1
        for _, row in pre[pre["pass_attempt"] == 1].iterrows():
            pid = row.get("receiver_player_id")
            if pd.isna(pid):
                continue
            pos, _, name = pos_lookup(pid, row["week"])
            p = ensure(row["posteam"], pid, name or row.get("receiver_player_name"), bucket_position(pos) if pos else "DST")
            p["targets"] += 1
            if row.get("complete_pass") == 1:
                p["receptions"] += 1

    by_team = {}
    for (team, _pid), rec in tally.items():
        by_team.setdefault(team, []).append(rec)
    for team in by_team:
        by_team[team].sort(key=lambda r: (-(r["carries"] + r["targets"]), r["name"] or ""))
    return by_team


def compute_first_td_position_breakdown(first_td_by_game: dict, teams) -> dict:
    """Which position scores a team's own game-opening TD, and (symmetrically)
    which position tends to beat a team's defense to it."""
    scored = {t: {p: 0 for p in POSITION_KEYS} for t in teams}
    allowed = {t: {p: 0 for p in POSITION_KEYS} for t in teams}
    for info in first_td_by_game.values():
        pos = info["position"] or "DST"
        if info["team"] in scored:
            scored[info["team"]][pos] += 1
        if info["allowed_team"] in allowed:
            allowed[info["allowed_team"]][pos] += 1
    return scored, allowed
