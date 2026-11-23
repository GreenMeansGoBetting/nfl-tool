"""Shared NFL basics every build file uses: team-name fixes, position groups,
red-zone line, play-length and pass-depth buckets.

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import pandas as pd

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
    ("10_or_less", 0, 10),
    ("11_20", 11, 20),
    ("21_40", 21, 40),
    ("41_plus", 41, 9999),
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


# Pass-zone shot chart (Player Props: Passing/Receiving tabs) -- depth of
# target (by air_yards) x pass_location (left/middle/right). Deliberately
# built ONLY from columns nflverse publishes on the standard pbp file
# every week during the season (pass_location, air_yards, epa, success,
# complete_pass) -- unlike compute_scheme_splits' box/blitz/coverage
# charting, none of this depends on the official participation file, which
# is stuck on a season-plus lag. Bucket boundaries match the same depth
# tiers nflsavant.com's own shot chart uses (screen/short/intermediate/deep).
PASS_DEPTH_BUCKETS = [
    ("screen", -9999, -1),
    ("short", 0, 9),
    ("intermediate", 10, 19),
    ("deep", 20, 9999),
]
PASS_LOCATIONS = ["left", "middle", "right"]
# Win probability outside [GARBAGE_WP, 1 - GARBAGE_WP] = garbage time for a
# play (see compute_pass_shot_chart's "gt" flag).
GARBAGE_WP = 0.10


def pass_depth_bucket(air_yards):
    for key, lo, hi in PASS_DEPTH_BUCKETS:
        if lo <= air_yards <= hi:
            return key
    return PASS_DEPTH_BUCKETS[-1][0]
