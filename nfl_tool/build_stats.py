#!/usr/bin/env python3
"""
Build the NFL TD Cheatsheet data blob from nflverse play-by-play + weekly roster data.

Usage:
    python3 build_stats.py --season 2026 --out site/data.json

Downloads the season's play-by-play and weekly-roster files from the public
nflverse-data GitHub release (no API key needed) into --data-dir (default
./data, gitignored) if they aren't already there, then computes, for each
team (regular season, to date):
  - Pass TD / Rush TD / Total TD, and defensive/special-teams (DST) TDs
    (pick-sixes, fumble/kick/punt/blocked-kick returns) -- season totals
    and per-game rates, both scored and allowed
  - First-TD-of-game rate/count, both scored (this team) and allowed
    (opponent scored first instead)
  - Red zone (own side's 20-yard-line-in) TDs, plays, carries, and targets,
    both this team's own offense and what its defense allows
  - TDs bucketed by the scoring play's length (10-19/20-29/.../50+ yards),
    both scored and allowed
  - Offensive TDs scored by position (QB/RB/WR/TE/DST) and defensive TDs
    allowed by position
For each player who has scored at least one TD:
  - Team, position, season TD count, "scored the game's first TD" count,
    and how many of their TDs came via a DST-type score (so a WR who also
    returns punts is flagged rather than blended into their receiving line)
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv.gz"
SCHEDULE_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
INJURIES_URL = "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"

TEAM_NAME_FIXES = {
    # nflverse occasionally uses different abbreviations across seasons for
    # relocated/renamed franchises; normalize to the current abbreviation.
    "OAK": "LV",
    "SD": "LAC",
    "STL": "LA",
}

POSITION_BUCKETS = {"QB", "RB", "WR", "TE"}
POSITION_KEYS = ("QB", "RB", "WR", "TE", "DST")

RED_ZONE_YARDLINE = 20

# TD-length buckets, keyed by the scoring play's own yards_gained. Only
# applies to offensive scrimmage TDs (pass/rush) -- a return TD's "length"
# isn't a comparable/meaningful prop signal the same way a long catch-and-run
# or breakaway run is.
LENGTH_BUCKETS = [
    ("under_10", 0, 9),
    ("10_19", 10, 19),
    ("20_29", 20, 29),
    ("30_39", 30, 39),
    ("40_49", 40, 49),
    ("50_plus", 50, 9999),
]

# "Explosive play" thresholds for the Game Overviews page -- a completed
# pass needs more yardage than a run to count as a chunk play, per common
# usage. Tunable if the on-air feel doesn't match these.
EXPLOSIVE_RUSH_YARDS = 10
EXPLOSIVE_PASS_YARDS = 15

# Injury-report position grouping -- distinct from POSITION_BUCKETS/
# bucket_position() above, which is TD-scorer-oriented and dumps every
# non-skill position into "DST". An injury report needs to show offensive
# and defensive line/secondary players too, so it gets its own map.
OFFENSE_POSITIONS = {"QB", "RB", "FB", "HB", "WR", "TE", "T", "G", "C", "OL", "OT", "OG"}
DEFENSE_POSITIONS = {
    "DE", "DT", "NT", "DL", "LB", "ILB", "OLB", "MLB", "EDGE",
    "CB", "S", "SS", "FS", "SAF", "DB",
}


def position_group(pos):
    if pos in OFFENSE_POSITIONS:
        return "OFF"
    if pos in DEFENSE_POSITIONS:
        return "DEF"
    return "ST"


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
    return "DST"


def length_bucket(yards):
    for key, lo, hi in LENGTH_BUCKETS:
        if lo <= yards <= hi:
            return key
    return LENGTH_BUCKETS[-1][0]


def remote_exists(url: str) -> bool:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status == 200
    except urllib.error.HTTPError:
        return False


def download_if_missing(url: str, dest: Path, force: bool = False):
    if dest.exists() and not force:
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


def load_injuries(data_dir: Path, season: int) -> pd.DataFrame:
    """Weekly official injury/practice reports. force=True: like the
    schedule, this changes daily within a season (practice status updates
    through the week, final Q/D/O designation usually lands Thu/Fri) --
    never worth caching past the first run."""
    path = data_dir / f"injuries_{season}.csv"
    download_if_missing(INJURIES_URL.format(season=season), path, force=True)
    df = pd.read_csv(path, low_memory=False)
    df["team"] = df["team"].map(normalize_team)
    return df[["team", "week", "position", "full_name", "report_status", "practice_status"]]


def moneyline_to_implied_prob(ml):
    """American odds -> raw (vig-included) implied win probability."""
    if ml is None or pd.isna(ml):
        return None
    ml = float(ml)
    return 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)


def novig_moneyline_probs(away_ml, home_ml):
    """Normalizes both sides' implied probabilities to sum to 1.0, removing
    the sportsbook's vig. Returns (away_prob, home_prob), or (None, None) if
    either side's moneyline isn't posted yet."""
    away_p = moneyline_to_implied_prob(away_ml)
    home_p = moneyline_to_implied_prob(home_ml)
    if away_p is None or home_p is None:
        return None, None
    total = away_p + home_p
    return round(away_p / total, 3), round(home_p / total, 3)


def compute_schedule(data_dir: Path, season: int) -> list:
    """The requested season's schedule (one file covering every season the
    NFL has ever played, filtered down here) -- used for the site's
    week/matchup picker AND (for Game Overviews) odds/scores, so it
    deliberately uses the REQUESTED season, not whatever season the stats
    themselves fell back to. The NFL publishes the full season schedule
    (and betting lines) well before it's played, so this exists even when
    play-by-play for that season doesn't yet.

    force=True on the download: unlike pbp/roster archives, this file
    changes daily within a season (line movement, final scores as games
    complete) -- caching it after the first run would freeze odds/scores
    at whatever they were the first time build_stats.py was ever run."""
    path = data_dir / "games.csv"
    download_if_missing(SCHEDULE_URL, path, force=True)
    df = pd.read_csv(path, low_memory=False)
    df = df[(df["season"] == season) & (df["game_type"] == "REG")].copy()
    for col in ("away_team", "home_team"):
        df[col] = df[col].map(normalize_team)
    df = df.sort_values(["week", "gameday", "gametime"])

    def num_or_none(v):
        return float(v) if pd.notna(v) else None

    games = []
    for _, row in df.iterrows():
        away_score = num_or_none(row.get("away_score"))
        home_score = num_or_none(row.get("home_score"))
        spread_line = num_or_none(row.get("spread_line"))
        away_ml = num_or_none(row.get("away_moneyline"))
        home_ml = num_or_none(row.get("home_moneyline"))
        away_ml_prob, home_ml_prob = novig_moneyline_probs(away_ml, home_ml)
        games.append(
            {
                "game_id": row["game_id"],
                "week": int(row["week"]),
                "date": row["gameday"],
                "weekday": row["weekday"],
                "time": row["gametime"] if pd.notna(row["gametime"]) else None,
                "away": row["away_team"],
                "home": row["home_team"],
                "away_score": int(away_score) if away_score is not None else None,
                "home_score": int(home_score) if home_score is not None else None,
                "status": "final" if away_score is not None and home_score is not None else "scheduled",
                # spread_line is away-team-referenced in nflverse's schedule
                # file (negative = away favored) -- precomputed both signed
                # per-team numbers here so nothing downstream has to re-derive it.
                "spread_line": spread_line,
                "away_team_spread": spread_line,
                "home_team_spread": -spread_line if spread_line is not None else None,
                "away_spread_odds": num_or_none(row.get("away_spread_odds")),
                "home_spread_odds": num_or_none(row.get("home_spread_odds")),
                "total_line": num_or_none(row.get("total_line")),
                "over_odds": num_or_none(row.get("over_odds")),
                "under_odds": num_or_none(row.get("under_odds")),
                "away_moneyline": away_ml,
                "home_moneyline": home_ml,
                "away_ml_implied_prob": away_ml_prob,
                "home_ml_implied_prob": home_ml_prob,
            }
        )
    return games


def compute_current_week(schedule: list) -> int:
    if not schedule:
        return 1
    today = date.today().isoformat()
    upcoming = [g for g in schedule if g["date"] >= today]
    if upcoming:
        return upcoming[0]["week"]
    return schedule[-1]["week"]


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
    return td_plays


def compute_red_zone(pbp: pd.DataFrame) -> dict:
    """Red zone = own offense's snap inside the opponent's 20. Excludes
    two-point attempts (not a normal drive play). Returns per-team dict of
    raw counts -- TDs, total plays, carries (rush attempts), and targets
    (pass attempts) -- both this team's own red zone offense and what its
    defense allows. This is play-level volume, not drive-level red-zone
    trips/conversion rate (that needs drive reconstruction, deliberately
    left out of this first pass)."""
    rz = pbp[(pbp["yardline_100"] <= RED_ZONE_YARDLINE) & (pbp["two_point_attempt"] != 1)].copy()
    scrimmage = rz[(rz["rush_attempt"] == 1) | (rz["pass_attempt"] == 1)]
    rz_td = rz[(rz["touchdown"] == 1) & ((rz["pass_touchdown"] == 1) | (rz["rush_touchdown"] == 1))]

    result = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        off_plays = scrimmage[scrimmage["posteam"] == team]
        def_plays = scrimmage[scrimmage["defteam"] == team]
        result[team] = {
            "rz_td": int((rz_td["posteam"] == team).sum()),
            "rz_td_allowed": int((rz_td["defteam"] == team).sum()),
            "rz_plays": int(len(off_plays)),
            "rz_plays_allowed": int(len(def_plays)),
            "rz_carries": int((off_plays["rush_attempt"] == 1).sum()),
            "rz_carries_allowed": int((def_plays["rush_attempt"] == 1).sum()),
            "rz_targets": int((off_plays["pass_attempt"] == 1).sum()),
            "rz_targets_allowed": int((def_plays["pass_attempt"] == 1).sum()),
        }
    return result


def compute_length_buckets(pbp: pd.DataFrame) -> dict:
    """TDs bucketed by the scoring play's own yardage, offensive scrimmage
    TDs only (pass/rush -- see LENGTH_BUCKETS)."""
    off_td = pbp[(pbp["touchdown"] == 1) & ((pbp["pass_touchdown"] == 1) | (pbp["rush_touchdown"] == 1))].copy()
    off_td["bucket"] = off_td["yards_gained"].clip(lower=0).map(length_bucket)

    result = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        scored = off_td[off_td["posteam"] == team]["bucket"].value_counts()
        allowed = off_td[off_td["defteam"] == team]["bucket"].value_counts()
        result[team] = {
            "scored": {key: int(scored.get(key, 0)) for key, _, _ in LENGTH_BUCKETS},
            "allowed": {key: int(allowed.get(key, 0)) for key, _, _ in LENGTH_BUCKETS},
        }
    return result


def compute_explosive_plays(pbp: pd.DataFrame) -> dict:
    """Chunk-play rate for the Game Overviews page -- a rush of
    EXPLOSIVE_RUSH_YARDS+ or a COMPLETED pass of EXPLOSIVE_PASS_YARDS+,
    excluding two-point attempts. Both this team's own offense and what its
    defense allows."""
    scrimmage = pbp[
        ((pbp["rush_attempt"] == 1) | (pbp["pass_attempt"] == 1)) & (pbp["two_point_attempt"] != 1)
    ].copy()
    is_expl_rush = (scrimmage["rush_attempt"] == 1) & (scrimmage["yards_gained"] >= EXPLOSIVE_RUSH_YARDS)
    is_expl_pass = (
        (scrimmage["pass_attempt"] == 1)
        & (scrimmage["complete_pass"] == 1)
        & (scrimmage["yards_gained"] >= EXPLOSIVE_PASS_YARDS)
    )
    scrimmage["is_expl_rush"] = is_expl_rush
    scrimmage["is_expl_pass"] = is_expl_pass
    scrimmage["is_explosive"] = is_expl_rush | is_expl_pass

    result = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        off = scrimmage[scrimmage["posteam"] == team]
        deff = scrimmage[scrimmage["defteam"] == team]
        result[team] = {
            "off_plays": int(len(off)),
            "def_plays_faced": int(len(deff)),
            "explosive_rush": int(off["is_expl_rush"].sum()),
            "explosive_pass": int(off["is_expl_pass"].sum()),
            "explosive_plays": int(off["is_explosive"].sum()),
            "explosive_rush_allowed": int(deff["is_expl_rush"].sum()),
            "explosive_pass_allowed": int(deff["is_expl_pass"].sum()),
            "explosive_plays_allowed": int(deff["is_explosive"].sum()),
        }
    return result


def compute_injury_report(injuries_df: pd.DataFrame, teams) -> dict:
    """{team: {week: [ {full_name, position, position_group, report_status,
    practice_status, status, status_source} ]}}. status/status_source
    precompute the report_status-else-practice_status fallback -- early in
    the week the official Q/D/O designation is often still blank while the
    practice-participation status is already posted."""
    result = {t: {} for t in teams}
    for row in injuries_df.itertuples(index=False):
        if row.team not in result:
            continue
        report = row.report_status if pd.notna(row.report_status) and row.report_status else None
        practice = row.practice_status if pd.notna(row.practice_status) and row.practice_status else None
        entry = {
            "full_name": row.full_name,
            "position": row.position,
            "position_group": position_group(row.position),
            "report_status": report,
            "practice_status": practice,
            "status": report or practice,
            "status_source": "report" if report else ("practice" if practice else None),
        }
        result[row.team].setdefault(str(int(row.week)), []).append(entry)
    return result


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


def build_team_stats(
    team_games,
    team_games_allowed,
    games_played,
    first_td_by_game,
    scoring_df,
    red_zone,
    length_buckets,
    explosive,
    possessions_to_score,
    trailing_possessions,
    pre_rz_off_trips,
    pre_rz_off_conv,
    pre_rz_def_trips,
    pre_rz_def_conv,
    first_td_position,
    first_td_position_allowed,
    teams,
):
    stats = {}
    dst_plays = scoring_df[scoring_df["td_type"] == "dst"]

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

        dst_td = int((dst_plays["scoring_team"] == team).sum())
        dst_td_allowed = int((dst_plays["allowed_team"] == team).sum())

        team_first_td_games = sum(1 for v in first_td_by_game.values() if v["team"] == team)
        first_td_rate = round(team_first_td_games / g, 3) if g else 0.0

        off_pos_counts = {p: 0 for p in POSITION_KEYS}
        off_team_scores = scoring_df[scoring_df["scoring_team"] == team]
        for pos, cnt in off_team_scores["position"].value_counts().items():
            off_pos_counts[pos] = int(cnt)

        def_pos_counts = {p: 0 for p in POSITION_KEYS}
        def_team_allowed = scoring_df[scoring_df["allowed_team"] == team]
        for pos, cnt in def_team_allowed["position"].value_counts().items():
            def_pos_counts[pos] = int(cnt)

        rz = red_zone.get(team, {})
        lb = length_buckets.get(team, {"scored": {}, "allowed": {}})
        expl = explosive.get(team, {})
        off_plays = expl.get("off_plays", 0)
        def_plays_faced = expl.get("def_plays_faced", 0)

        def per_g(n):
            return round(n / g, 2) if g else 0.0

        # "When they scored first, how many of their own possessions it
        # took" -- DST (return-TD) first scores are excluded, see
        # compute_possessions_to_score (doesn't apply to a play that
        # happens on defense/special teams rather than one of the team's
        # own drives).
        own_possessions = [
            possessions_to_score[gid]
            for gid, info in first_td_by_game.items()
            if info["team"] == team and gid in possessions_to_score
        ]

        # "When they DIDN'T score first, how many of their own possessions
        # they'd gotten before the opponent did" -- every such game, no DST
        # exclusion needed since this counts the TRAILING team's own
        # offensive drives regardless of how the opponent scored. This is
        # the OFFENSE-side half of the story.
        trailing_list = [trailing_possessions[gid] for gid, info in first_td_by_game.items() if info["allowed_team"] == team]
        trailing_games = len(trailing_list)
        trailing_games_with_possession = sum(1 for c in trailing_list if c >= 1)
        trailing_games_zero_possession = sum(1 for c in trailing_list if c == 0)

        # DEFENSE-side mirror of the two lists above, same underlying data
        # just credited to the other team: when THIS team's defense allowed
        # the first score, how many of the OPPONENT's own possessions did
        # it take them (own_possessions, viewed from the other side); when
        # THIS team scored first themselves, how many of the opponent's own
        # possessions had already happened -- i.e. how many drives this
        # defense forced before its offense got there first (trailing_
        # possessions, viewed from the other side).
        allowed_possessions = [
            possessions_to_score[gid]
            for gid, info in first_td_by_game.items()
            if info["allowed_team"] == team and gid in possessions_to_score
        ]
        forced_list = [trailing_possessions[gid] for gid, info in first_td_by_game.items() if info["team"] == team]
        forced_games_with_possession = sum(1 for c in forced_list if c >= 1)
        forced_games_zero_possession = sum(1 for c in forced_list if c == 0)

        stats[team] = {
            "games_played": g,
            "pass_td": pass_td,
            "rush_td": rush_td,
            "total_td": total_td,
            "pass_td_per_g": per_g(pass_td),
            "rush_td_per_g": per_g(rush_td),
            "total_td_per_g": per_g(total_td),
            "pass_td_allowed": pass_td_allowed,
            "rush_td_allowed": rush_td_allowed,
            "total_td_allowed": total_td_allowed,
            "pass_td_allowed_per_g": per_g(pass_td_allowed),
            "rush_td_allowed_per_g": per_g(rush_td_allowed),
            "total_td_allowed_per_g": per_g(total_td_allowed),
            "dst_td": dst_td,
            "dst_td_per_g": per_g(dst_td),
            "dst_td_allowed": dst_td_allowed,
            "dst_td_allowed_per_g": per_g(dst_td_allowed),
            "first_td_games": team_first_td_games,
            "first_td_rate": first_td_rate,
            "off_position_td": off_pos_counts,
            "def_position_td_allowed": def_pos_counts,
            "rz_td": rz.get("rz_td", 0),
            "rz_td_per_g": per_g(rz.get("rz_td", 0)),
            "rz_td_allowed": rz.get("rz_td_allowed", 0),
            "rz_td_allowed_per_g": per_g(rz.get("rz_td_allowed", 0)),
            "rz_plays": rz.get("rz_plays", 0),
            "rz_plays_per_g": per_g(rz.get("rz_plays", 0)),
            "rz_plays_allowed": rz.get("rz_plays_allowed", 0),
            "rz_plays_allowed_per_g": per_g(rz.get("rz_plays_allowed", 0)),
            "rz_carries": rz.get("rz_carries", 0),
            "rz_carries_per_g": per_g(rz.get("rz_carries", 0)),
            "rz_carries_allowed": rz.get("rz_carries_allowed", 0),
            "rz_carries_allowed_per_g": per_g(rz.get("rz_carries_allowed", 0)),
            "rz_targets": rz.get("rz_targets", 0),
            "rz_targets_per_g": per_g(rz.get("rz_targets", 0)),
            "rz_targets_allowed": rz.get("rz_targets_allowed", 0),
            "rz_targets_allowed_per_g": per_g(rz.get("rz_targets_allowed", 0)),
            "td_by_length": lb["scored"],
            "td_by_length_allowed": lb["allowed"],
            "off_plays": off_plays,
            "def_plays_faced": def_plays_faced,
            "explosive_rush": expl.get("explosive_rush", 0),
            "explosive_rush_per_g": per_g(expl.get("explosive_rush", 0)),
            "explosive_rush_allowed": expl.get("explosive_rush_allowed", 0),
            "explosive_rush_allowed_per_g": per_g(expl.get("explosive_rush_allowed", 0)),
            "explosive_pass": expl.get("explosive_pass", 0),
            "explosive_pass_per_g": per_g(expl.get("explosive_pass", 0)),
            "explosive_pass_allowed": expl.get("explosive_pass_allowed", 0),
            "explosive_pass_allowed_per_g": per_g(expl.get("explosive_pass_allowed", 0)),
            "explosive_plays": expl.get("explosive_plays", 0),
            "explosive_plays_per_g": per_g(expl.get("explosive_plays", 0)),
            "explosive_plays_allowed": expl.get("explosive_plays_allowed", 0),
            "explosive_plays_allowed_per_g": per_g(expl.get("explosive_plays_allowed", 0)),
            "explosive_rate": round(expl.get("explosive_plays", 0) / off_plays, 3) if off_plays else None,
            "explosive_rate_allowed": round(expl.get("explosive_plays_allowed", 0) / def_plays_faced, 3)
            if def_plays_faced
            else None,
            "avg_possessions_to_first_td": round(sum(own_possessions) / len(own_possessions), 2) if own_possessions else None,
            "possessions_to_first_td_games": len(own_possessions),
            "trailing_games": trailing_games,
            "trailing_games_with_possession": trailing_games_with_possession,
            "trailing_games_zero_possession": trailing_games_zero_possession,
            "avg_trailing_possessions": round(sum(trailing_list) / len(trailing_list), 2) if trailing_list else None,
            "avg_possessions_allowed_before_first_td": round(sum(allowed_possessions) / len(allowed_possessions), 2)
            if allowed_possessions
            else None,
            "possessions_allowed_before_first_td_games": len(allowed_possessions),
            "forced_games_with_possession": forced_games_with_possession,
            "forced_games_zero_possession": forced_games_zero_possession,
            "avg_opponent_possessions_forced": round(sum(forced_list) / len(forced_list), 2) if forced_list else None,
            "pre_first_td_rz_trips": pre_rz_off_trips.get(team, 0),
            "pre_first_td_rz_trips_per_g": per_g(pre_rz_off_trips.get(team, 0)),
            "pre_first_td_rz_conversions": pre_rz_off_conv.get(team, 0),
            "pre_first_td_rz_conversion_rate": round(pre_rz_off_conv.get(team, 0) / pre_rz_off_trips[team], 3)
            if pre_rz_off_trips.get(team)
            else None,
            "pre_first_td_rz_trips_allowed": pre_rz_def_trips.get(team, 0),
            "pre_first_td_rz_trips_allowed_per_g": per_g(pre_rz_def_trips.get(team, 0)),
            "pre_first_td_rz_conversions_allowed": pre_rz_def_conv.get(team, 0),
            "pre_first_td_rz_conversion_rate_allowed": round(pre_rz_def_conv.get(team, 0) / pre_rz_def_trips[team], 3)
            if pre_rz_def_trips.get(team)
            else None,
            "first_td_position": first_td_position.get(team, {p: 0 for p in POSITION_KEYS}),
            "first_td_position_allowed": first_td_position_allowed.get(team, {p: 0 for p in POSITION_KEYS}),
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
                "dst_tds": 0,
            }
        return players[pid]

    for _, row in scoring_df.iterrows():
        pid = row["scorer_id"]
        if pd.isna(pid):
            continue
        p = ensure(pid, row["scorer_name"], row["scoring_team"], row["position"])
        p["tds"] += 1
        if row["td_type"] == "dst":
            p["dst_tds"] += 1

    for game_id, info in first_td_by_game.items():
        pid = info["player_id"]
        if pd.isna(pid) or pid is None:
            continue
        if pid not in players:
            players[pid] = {
                "player_id": pid,
                "name": info["player_name"],
                "team": info["team"],
                "position": info["position"] or "DST",
                "tds": 0,
                "first_tds": 0,
                "dst_tds": 0,
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
    # Injuries are about the REQUESTED season's upcoming games, not
    # whatever season the pbp-based stats fell back to -- same reasoning
    # compute_schedule() already documents.
    injuries_df = load_injuries(args.data_dir, args.season)
    pos_lookup = build_position_lookup(rosters)

    teams = sorted(set(pbp["home_team"].dropna()) | set(pbp["away_team"].dropna()))

    team_games = compute_team_game_td_counts(pbp)
    team_games_allowed = compute_team_game_td_allowed(pbp)
    games_played = compute_games_played(pbp)
    first_td_by_game = compute_first_td_per_game(pbp, pos_lookup)
    scoring_df = scoring_plays_with_position(pbp, pos_lookup)
    red_zone = compute_red_zone(pbp)
    length_buckets = compute_length_buckets(pbp)
    explosive = compute_explosive_plays(pbp)
    possessions_to_score = compute_possessions_to_score(pbp, first_td_by_game)
    trailing_possessions = compute_trailing_possessions(pbp, first_td_by_game)
    pre_rz_off_trips, pre_rz_off_conv, pre_rz_def_trips, pre_rz_def_conv = compute_pre_first_td_red_zone(pbp, first_td_by_game)
    first_td_position, first_td_position_allowed = compute_first_td_position_breakdown(first_td_by_game, teams)
    pre_first_td_usage = compute_pre_first_td_player_usage(pbp, first_td_by_game, pos_lookup)

    team_stats = build_team_stats(
        team_games,
        team_games_allowed,
        games_played,
        first_td_by_game,
        scoring_df,
        red_zone,
        length_buckets,
        explosive,
        possessions_to_score,
        trailing_possessions,
        pre_rz_off_trips,
        pre_rz_off_conv,
        pre_rz_def_trips,
        pre_rz_def_conv,
        first_td_position,
        first_td_position_allowed,
        teams,
    )
    player_stats = build_player_stats(scoring_df, first_td_by_game, teams)

    max_week = int(pbp["week"].max())

    schedule = compute_schedule(args.data_dir, args.season)
    current_week = compute_current_week(schedule)
    injury_report = compute_injury_report(injuries_df, teams)

    blob = {
        "season": season,
        "requested_season": args.season,
        "is_fallback_season": is_fallback,
        "through_week": max_week,
        "generated_by": "nflverse-data pbp + weekly rosters",
        "teams": teams,
        "team_stats": team_stats,
        "player_stats": player_stats,
        "pre_first_td_usage": pre_first_td_usage,
        "schedule": schedule,
        "current_week": current_week,
        "injuries": injury_report,
        "injuries_max_week": int(injuries_df["week"].max()) if len(injuries_df) else None,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)

    print(f"Wrote {args.out} -- season {season}, through week {max_week}, {len(teams)} teams")


if __name__ == "__main__":
    main()
