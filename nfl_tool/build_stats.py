#!/usr/bin/env python3
"""
Build the NFL TD Cheatsheet data blob from nflverse play-by-play + weekly roster data.

Usage:
    python3 build_stats.py --season 2026 --out site/data.json

Downloads the season's play-by-play and weekly-roster files from the public
nflverse-data GitHub release (no API key needed) into --data-dir (default
./data, gitignored) if they aren't already there, then computes:

For each team, computes (regular season, to date):
  - Pass TD / Rush TD / Total TD per game
  - First-TD-of-game rate (share of the team's games in which they scored the
    game's first touchdown, of any type)
  - Season totals for the above
  - Offensive TDs scored by position (QB/RB/WR/TE) and defensive TDs allowed
    by position
For each player who has scored at least one TD:
  - Team, position, season TD count, season "scored the game's first TD" count
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv.gz"

TEAM_NAME_FIXES = {
    # nflverse occasionally uses different abbreviations across seasons for
    # relocated/renamed franchises; normalize to the current abbreviation.
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

POSITION_BUCKETS = {"QB", "RB", "WR", "TE"}


def normalize_team(abbr):
    if pd.isna(abbr):
        return abbr
    return TEAM_NAME_FIXES.get(abbr, abbr)


def bucket_position(pos):
    if pos in POSITION_BUCKETS:
        return pos
    if pos in ("FB",):
        return "RB"
    if pos in ("HB",):
        return "RB"
    return "OTHER"


def remote_exists(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status == 200
    except urllib.error.HTTPError:
        return False


def download_if_missing(url: str, dest: Path):
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url} -> {dest}")
    try:
        urllib.request.urlretrieve(url, dest)
    except Exception as e:
        print(
            f"ERROR: could not download {url} ({e}). "
            "If this is very early in the season, nflverse may not have "
            "published this season's file yet -- check "
            "https://github.com/nflverse/nflverse-data/releases/tag/pbp",
            file=sys.stderr,
        )
        raise


def resolve_season(season: int, data_dir: Path) -> tuple[int, bool]:
    """Returns (season_to_use, is_fallback). Falls back one season back if
    nflverse hasn't published the requested season's pbp file yet (common
    very early in a season -- their pipeline lags kickoff by a few days)."""
    if (data_dir / f"play_by_play_{season}.csv.gz").exists():
        return season, False
    if remote_exists(PBP_URL.format(season=season)):
        return season, False
    fallback = season - 1
    print(
        f"NOTE: play_by_play_{season}.csv.gz isn't published on nflverse yet -- "
        f"falling back to {fallback} season data until it appears.",
        file=sys.stderr,
    )
    return fallback, True


def load_pbp(data_dir: Path, season: int) -> pd.DataFrame:
    path = data_dir / f"play_by_play_{season}.csv.gz"
    download_if_missing(PBP_URL.format(season=season), path)
    df = pd.read_csv(path, compression="gzip", low_memory=False)
    df = df[df["season_type"] == "REG"].copy()
    for col in ("posteam", "defteam", "home_team", "away_team", "td_team"):
        if col in df.columns:
            df[col] = df[col].map(normalize_team)
    return df


def load_rosters(data_dir: Path, season: int) -> pd.DataFrame:
    path = data_dir / f"roster_weekly_{season}.csv.gz"
    download_if_missing(ROSTER_URL.format(season=season), path)
    df = pd.read_csv(path, compression="gzip", low_memory=False)
    df["team"] = df["team"].map(normalize_team)
    # Keep one row per (gsis_id, week); prefer the most complete position value.
    df = df.dropna(subset=["gsis_id"])
    return df[["season", "week", "team", "gsis_id", "position", "full_name"]]


def build_position_lookup(rosters: pd.DataFrame):
    # gsis_id + week -> position/team/name, with a fallback keyed only by gsis_id
    # (most recent week on file) for edge cases like playoff-only IDs.
    by_week = {}
    by_id_latest = {}
    for row in rosters.sort_values("week").itertuples(index=False):
        by_week[(row.gsis_id, row.week)] = (row.position, row.team, row.full_name)
        by_id_latest[row.gsis_id] = (row.position, row.team, row.full_name)

    def lookup(gsis_id, week):
        if pd.isna(gsis_id):
            return (None, None, None)
        key = (gsis_id, week)
        if key in by_week:
            return by_week[key]
        return by_id_latest.get(gsis_id, (None, None, None))

    return lookup


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
    """Returns dict game_id -> (team, player_id, player_name, position)."""
    td_plays = pbp[pbp["touchdown"] == 1].copy()
    td_plays = td_plays.sort_values(["game_id", "play_id"])
    first = td_plays.groupby("game_id").first()
    result = {}
    for game_id, row in first.iterrows():
        team = normalize_team(row.get("td_team"))
        player_id = row.get("td_player_id")
        player_name = row.get("td_player_name")
        week = row.get("week")
        pos, _, full_name = pos_lookup(player_id, week)
        result[game_id] = {
            "team": team,
            "player_id": player_id,
            "player_name": full_name or player_name,
            "position": bucket_position(pos) if pos else None,
        }
    return result


def scoring_plays_with_position(pbp: pd.DataFrame, pos_lookup) -> pd.DataFrame:
    """One row per offensive TD play with the scorer's id/name/position/team."""
    off_td = pbp[(pbp["touchdown"] == 1) & ((pbp["pass_touchdown"] == 1) | (pbp["rush_touchdown"] == 1))].copy()

    def scorer_id(row):
        if row["pass_touchdown"] == 1:
            return row.get("receiver_player_id")
        return row.get("rusher_player_id")

    def scorer_name(row):
        if row["pass_touchdown"] == 1:
            return row.get("receiver_player_name")
        return row.get("rusher_player_name")

    off_td["scorer_id"] = off_td.apply(scorer_id, axis=1)
    off_td["scorer_name_raw"] = off_td.apply(scorer_name, axis=1)
    off_td["td_type"] = off_td["pass_touchdown"].map(lambda v: "pass" if v == 1 else "rush")

    positions, full_names = [], []
    for _, row in off_td.iterrows():
        pos, _, full_name = pos_lookup(row["scorer_id"], row["week"])
        positions.append(bucket_position(pos) if pos else "OTHER")
        full_names.append(full_name or row["scorer_name_raw"])
    off_td["position"] = positions
    off_td["scorer_name"] = full_names
    return off_td


def build_team_stats(team_games, team_games_allowed, games_played, first_td_by_game, scoring_df, teams):
    stats = {}
    for team in teams:
        g = games_played.get(team, 0)
        tg = team_games[team_games["posteam"] == team]
        pass_td = int(tg["pass_td"].sum())
        rush_td = int(tg["rush_td"].sum())
        total_td = pass_td + rush_td

        tga = team_games_allowed[team_games_allowed["defteam"] == team]
        pass_td_allowed = int(tga["pass_td_allowed"].sum())
        rush_td_allowed = int(tga["rush_td_allowed"].sum())
        total_td_allowed = pass_td_allowed + rush_td_allowed

        team_first_td_games = sum(1 for v in first_td_by_game.values() if v["team"] == team)
        first_td_rate = round(team_first_td_games / g, 3) if g else 0.0

        off_pos_counts = {p: 0 for p in ("QB", "RB", "WR", "TE", "OTHER")}
        off_team_scores = scoring_df[scoring_df["posteam"] == team]
        for pos, cnt in off_team_scores["position"].value_counts().items():
            off_pos_counts[pos] = int(cnt)

        def_pos_counts = {p: 0 for p in ("QB", "RB", "WR", "TE", "OTHER")}
        def_team_allowed = scoring_df[scoring_df["defteam"] == team]
        for pos, cnt in def_team_allowed["position"].value_counts().items():
            def_pos_counts[pos] = int(cnt)

        stats[team] = {
            "games_played": g,
            "pass_td": pass_td,
            "rush_td": rush_td,
            "total_td": total_td,
            "pass_td_per_g": round(pass_td / g, 2) if g else 0.0,
            "rush_td_per_g": round(rush_td / g, 2) if g else 0.0,
            "total_td_per_g": round(total_td / g, 2) if g else 0.0,
            "pass_td_allowed": pass_td_allowed,
            "rush_td_allowed": rush_td_allowed,
            "total_td_allowed": total_td_allowed,
            "pass_td_allowed_per_g": round(pass_td_allowed / g, 2) if g else 0.0,
            "rush_td_allowed_per_g": round(rush_td_allowed / g, 2) if g else 0.0,
            "total_td_allowed_per_g": round(total_td_allowed / g, 2) if g else 0.0,
            "first_td_games": team_first_td_games,
            "first_td_rate": first_td_rate,
            "off_position_td": off_pos_counts,
            "def_position_td_allowed": def_pos_counts,
        }
    return stats


def build_player_stats(scoring_df, first_td_by_game, teams):
    players = {}

    def ensure(pid, name, team, pos):
        if pid not in players:
            players[pid] = {
                "player_id": pid,
                "name": name,
                "team": team,
                "position": pos,
                "tds": 0,
                "first_tds": 0,
            }
        return players[pid]

    for _, row in scoring_df.iterrows():
        pid = row["scorer_id"]
        if pd.isna(pid):
            continue
        p = ensure(pid, row["scorer_name"], row["posteam"], row["position"])
        p["tds"] += 1

    for game_id, info in first_td_by_game.items():
        pid = info["player_id"]
        if pd.isna(pid) or pid is None:
            continue
        if pid not in players:
            players[pid] = {
                "player_id": pid,
                "name": info["player_name"],
                "team": info["team"],
                "position": info["position"] or "OTHER",
                "tds": 0,
                "first_tds": 0,
            }
        players[pid]["first_tds"] += 1

    by_team = {t: [] for t in teams}
    for p in players.values():
        if p["team"] in by_team:
            by_team[p["team"]].append(p)
    for t in by_team:
        by_team[t].sort(key=lambda p: (-p["tds"], -p["first_tds"], p["name"] or ""))
    return by_team


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    season, is_fallback = resolve_season(args.season, args.data_dir)

    pbp = load_pbp(args.data_dir, season)
    rosters = load_rosters(args.data_dir, season)
    pos_lookup = build_position_lookup(rosters)

    teams = sorted(set(pbp["home_team"].dropna()) | set(pbp["away_team"].dropna()))

    team_games = compute_team_game_td_counts(pbp)
    team_games_allowed = compute_team_game_td_allowed(pbp)
    games_played = compute_games_played(pbp)
    first_td_by_game = compute_first_td_per_game(pbp, pos_lookup)
    scoring_df = scoring_plays_with_position(pbp, pos_lookup)

    team_stats = build_team_stats(team_games, team_games_allowed, games_played, first_td_by_game, scoring_df, teams)
    player_stats = build_player_stats(scoring_df, first_td_by_game, teams)

    max_week = int(pbp["week"].max())

    blob = {
        "season": season,
        "requested_season": args.season,
        "is_fallback_season": is_fallback,
        "through_week": max_week,
        "generated_by": "nflverse-data pbp + weekly rosters",
        "teams": teams,
        "team_stats": team_stats,
        "player_stats": player_stats,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)

    print(f"Wrote {args.out} -- season {season}, through week {max_week}, {len(teams)} teams")


if __name__ == "__main__":
    main()
