"""Where the NFL build's raw data comes from: nflverse downloads (play-by-play,
rosters, injuries, FTN charting, snap counts), the NFL.com injury page, the
schedule, ESPN FPI ratings, roster lookups and player headshots.

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import json
import math
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

from nfl_common import normalize_team

PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv.gz"
SCHEDULE_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
INJURIES_URL = "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"
# Official league injury report page (see fetch_nflcom_injuries) -- live
# source for the upcoming week, layered over nflverse's file.
NFLCOM_INJURIES_URL = "https://www.nfl.com/injuries/league/{season}/reg{week}"
# Third-party charting (FTN Fantasy, distributed via nflverse) -- box count/
# blitzers/pass rushers per play. Unlike the NFL's own official
# participation charting (no longer read by this pipeline at all -- its one
# consumer, route-type splits, was removed since that file isn't published
# until well after a season ends), this is published weekly DURING the
# season (confirmed: ftn_charting_2026.csv already existed the same day as
# 2026's first games), so scheme stats built from it don't need a fallback
# season the way compute_scheme_splits used to.
FTN_URL = "https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/ftn_charting_{season}.csv"
# Real per-player weekly snap counts/percentages, sourced from Pro-Football-
# Reference via nflverse -- also published weekly during the season
# (confirmed: snap_counts_2026.csv created the same day as 2026's first
# games), unlike the old participation file's own snap-participation columns.
SNAP_COUNTS_URL = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv"


def compute_player_headshots(rosters: pd.DataFrame, pos_lookup) -> dict:
    """{team: {full_name: headshot_url}} -- keyed the same way every other
    per-player blob in this file is (pos_lookup-derived name), so a photo
    lookup from a pass-zone summary row (or anywhere else) resolves by the
    exact same (team, name) pair. One row per player (their most recent
    week on file, matching pos_lookup's own fallback preference)."""
    out = {}
    for gsis_id, grp in rosters.groupby("gsis_id"):
        latest = grp.sort_values("week").iloc[-1]
        if pd.isna(latest.headshot_url):
            continue
        _, team, name = pos_lookup(gsis_id, int(latest.week))
        if not team or not name:
            continue
        out.setdefault(team, {})[name] = small_headshot_url(latest.headshot_url)
    return out


# nflverse headshot URLs point at full-size originals (~0.5-1 MB each);
# the site never shows one bigger than ~80px, and pages with dozens of
# them (Summary card, Player Props) were decoding tens of MB of photos.
# NFL's image CDN resizes on the fly: a face-centered 160px square is
# ~2-5 KB and still sharp on high-DPI screens.
HEADSHOT_TRANSFORM = "w_160,h_160,c_fill,g_face"


def small_headshot_url(url: str) -> str:
    marker = "/image/upload/"
    if marker not in url or HEADSHOT_TRANSFORM in url:
        return url
    head, tail = url.split(marker, 1)
    first, _, rest = tail.partition("/")
    if first.startswith(("f_", "q_", "w_", "h_", "c_")):
        return f"{head}{marker}{first},{HEADSHOT_TRANSFORM}/{rest}"
    return f"{head}{marker}{HEADSHOT_TRANSFORM}/{tail}"


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
    """Returns (season_to_use, is_fallback). Falls back one season back
    only if nflverse hasn't published the requested season's pbp file yet.
    Scores, schedule/odds, injuries, TD stats, red zone, explosive plays,
    and general stats all come from pbp alone, so pbp availability is the
    only thing that should gate them.

    This deliberately does NOT also require the official participation
    file -- confirmed directly against nflverse's actual release history
    that participation for a season isn't published until well AFTER that
    season ends (2025's file was created 2026-02-10, months after the
    season; 2023/2024's were both backfilled together in Sept 2025, not
    during either season). Gating the whole season's data on participation
    would mean the site shows last year's scores for the entire season,
    every season, forever. (The participation file itself is no longer
    read at all -- route-type charting, its one remaining consumer, was
    removed since it could never be fresher than last season's data.)"""
    def available(url_template):
        path = data_dir / Path(url_template.format(season=season)).name
        return path.exists() or remote_exists(url_template.format(season=season))

    if available(PBP_URL):
        return season, False
    fallback = season - 1
    print(
        f"NOTE: {season}'s pbp file isn't published on nflverse yet -- "
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


def load_rosters(data_dir: Path, season: int, force: bool = False) -> pd.DataFrame:
    path = data_dir / f"roster_weekly_{season}.csv.gz"
    download_if_missing(ROSTER_URL.format(season=season), path, force=force)
    df = pd.read_csv(path, compression="gzip", low_memory=False)
    df["team"] = df["team"].map(normalize_team)
    # Keep one row per (gsis_id, week); prefer the most complete position value.
    df = df.dropna(subset=["gsis_id"])
    cols = ["season", "week", "team", "gsis_id", "position", "full_name", "headshot_url"]
    if "status" in df.columns:
        cols.append("status")
    return df[cols]


# Roster statuses that mean "not playing" no matter what the injury report
# says. Players on reserve/IR never appear on weekly injury reports at all
# (teams only report active players), so without this an IR'd starter --
# Achane, Week 4 2026 -- kept showing as a key player / First TD pick.
ROSTER_OUT_STATUSES = {"RES": "IR / reserve", "RET": "retired", "CUT": "released", "EXE": "exempt"}


def compute_roster_out(rosters: pd.DataFrame) -> dict:
    """{team: [{name, status}]} from each team's latest roster week."""
    if "status" not in rosters.columns or rosters.empty:
        return {}
    out = {}
    for team, g in rosters.groupby("team"):
        latest = g[g["week"] == g["week"].max()]
        rows = latest[latest["status"].isin(ROSTER_OUT_STATUSES)]
        if len(rows):
            out[team] = [{"name": r.full_name, "status": ROSTER_OUT_STATUSES[r.status]} for r in rows.itertuples(index=False)]
    return out


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


def fetch_nflcom_injuries(season: int, week: int):
    """The league's own injury report page for one regular-season week --
    the source nflverse republishes from, but live: a team's Wednesday
    practice report shows here as soon as it's filed, while nflverse's
    file can lag by hours (user needs Wednesday info for preview videos).
    Returns a DataFrame shaped like load_injuries' output, or None if the
    page can't be fetched/parsed (the build then just keeps nflverse)."""
    import html as html_lib
    import re

    url = NFLCOM_INJURIES_URL.format(season=season, week=week)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            page = resp.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 -- any failure means "use nflverse only"
        print(f"  NFL.com injuries: fetch failed ({e}); using nflverse only", file=sys.stderr)
        return None

    def text(cell):
        return html_lib.unescape(re.sub(r"<[^>]+>", " ", cell)).strip()

    rows = []
    # One "unit" per game: a matchup strip naming both clubs, then one
    # table per club headed by its nickname ("Steelers").
    for unit in page.split("nfl-o-injury-report__unit")[1:]:
        abbrs = re.findall(r'team-abbreviation">\s*([A-Z]{2,3})\s*<', unit)
        names = re.findall(r'team-fullname"[^>]*>\s*([^<]+?)\s*<', unit)
        # NFL.com writes Arizona "AZ" and the Rams "LAR"; the site uses nflverse's codes.
        abbrs = [{"AZ": "ARI", "LAR": "LA"}.get(a, a) for a in abbrs]
        by_name = {n.strip(): a for n, a in zip(names, abbrs)}
        for m in re.finditer(r'section-sub-title"><span>([^<]+)</span>.*?<tbody>(.*?)</tbody>', unit, re.S):
            team = by_name.get(m.group(1).strip())
            if not team:
                continue
            for tr in re.findall(r"<tr>(.*?)</tr>", m.group(2), re.S):
                cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
                if len(cells) < 5 or not cells[0]:
                    continue
                rows.append({
                    "team": normalize_team(team),
                    "week": week,
                    "position": cells[1],
                    "full_name": cells[0],
                    "report_status": cells[4] or None,
                    "practice_status": cells[3] or None,
                })
    if not rows:
        print(f"  NFL.com injuries: no Week {week} reports filed yet", file=sys.stderr)
        return None
    df = pd.DataFrame(rows)
    print(f"  NFL.com injuries: Week {week}, {df['team'].nunique()} teams, {len(df)} players", file=sys.stderr)
    return df


def merge_live_injuries(injuries_df: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """For the upcoming week, any team that has filed on NFL.com uses that
    (fresher) report in place of nflverse's rows for that team/week. Past
    weeks and teams NFL.com doesn't list yet stay on nflverse."""
    live = fetch_nflcom_injuries(season, week)
    if live is None:
        return injuries_df
    filed = set(live["team"])
    keep = injuries_df[~((injuries_df["week"] == week) & (injuries_df["team"].isin(filed)))]
    return pd.concat([keep, live[keep.columns]], ignore_index=True)


def load_ftn_charting(data_dir: Path, season: int) -> pd.DataFrame:
    """See FTN_URL's comment -- box count/blitzers/pass rushers, published
    weekly during the season. Stable once a game's been charted, so no
    force=True (same caching policy as load_pbp)."""
    path = data_dir / f"ftn_charting_{season}.csv"
    download_if_missing(FTN_URL.format(season=season), path)
    return pd.read_csv(path, low_memory=False)


def load_snap_counts(data_dir: Path, season: int) -> pd.DataFrame:
    """See SNAP_COUNTS_URL's comment. force=True: a new week's rows get
    added as the season goes, same reasoning as load_injuries/
    compute_schedule (this changes within a season, unlike pbp/roster
    archives)."""
    path = data_dir / f"snap_counts_{season}.csv"
    download_if_missing(SNAP_COUNTS_URL.format(season=season), path, force=True)
    df = pd.read_csv(path, low_memory=False)
    df["team"] = df["team"].map(normalize_team)
    return df[["week", "team", "player", "position", "offense_snaps", "offense_pct", "defense_pct"]]


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


def build_roster_team_lookup(rosters: pd.DataFrame) -> dict:
    """{full_name: {team, team, ...}} across the whole season on file --
    which team a book's Anytime TD row belongs to (SmartStake's quotes name
    the game, not the player's team; book_td_odds). MUST be built from the
    CURRENT (requested) season's roster, not whatever season the pbp-based
    stats fell back to: the fallback season's roster once still had A.J.
    Brown on his old team after an offseason trade."""
    lookup = {}
    for row in rosters.itertuples(index=False):
        if pd.isna(row.full_name):
            continue
        lookup.setdefault(row.full_name, set()).add(row.team)
    return lookup


def build_roster_position_lookup(rosters: pd.DataFrame) -> dict:
    """{full_name: position} from the most recent week on file -- same
    name-keyed shape as build_roster_team_lookup (the books' player odds only
    carry a name, not a gsis_id), used to label player-odds modal rows by
    position instead of team (the row's own color/border already conveys
    team, so position is the more useful second identifier)."""
    lookup = {}
    for row in rosters.sort_values("week").itertuples(index=False):
        if pd.isna(row.full_name) or pd.isna(row.position):
            continue
        lookup[row.full_name] = row.position
    return lookup


# ---- ESPN FPI ratings (Game Previews Summary's Ratings box) ----
# ESPN's public powerindex feed behind espn.com/nfl/fpi, refreshed weekly:
# FPI plus its offense/defense components (points vs an average team on a
# neutral field -- defense positive = better) and strength-of-schedule
# ranks. Offense/defense/FPI also become 1-100 ratings: each team's
# z-score across the league through the normal curve (50 = league average,
# ~84 = one standard deviation better), clamped to 1-99.
ESPN_FPI_URL = "https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&season={season}"
ESPN_TEAM_FIXES = {"LAR": "LA", "WSH": "WAS"}


def _normed_rating(value, values):
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0
    z = (value - mean) / sd
    return max(1, min(99, round(100 * 0.5 * (1 + math.erf(z / math.sqrt(2))))))


def compute_espn_ratings(season: int) -> dict | None:
    """{team: {fpi, off, def, st, fpi_rank, sos_rank, sos_remaining_rank,
    off_rating, def_rating, fpi_rating}, "_updated": iso time}. None if
    ESPN can't be reached (the caller falls back to the live site's copy)."""
    try:
        req = urllib.request.Request(ESPN_FPI_URL.format(season=season), headers={"User-Agent": "Mozilla/5.0 (compatible; nfl-tool/1.0)"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.load(resp)
    except Exception as e:
        print(f"WARNING: ESPN FPI fetch failed ({e}).", file=sys.stderr)
        return None
    cat = next((c for c in payload.get("categories", []) if c.get("name") == "fpi"), None)
    if not cat:
        return None
    names = cat["names"]
    rows = {}
    for t in payload.get("teams", []):
        abbr = t["team"]["abbreviation"]
        abbr = normalize_team(ESPN_TEAM_FIXES.get(abbr, abbr))
        fpi_cat = next((c for c in t.get("categories", []) if c.get("name") == "fpi"), None)
        if not fpi_cat:
            continue
        v = dict(zip(names, fpi_cat.get("values") or []))
        if v.get("fpi") is None:
            continue
        rows[abbr] = {
            "fpi": round(v["fpi"], 2),
            "off": round(v.get("epaoffense") or 0.0, 2),
            "def": round(v.get("epadefense") or 0.0, 2),
            "st": round(v.get("epaspecialteams") or 0.0, 2),
            "fpi_rank": int(v["fpirank"]) if v.get("fpirank") else None,
            "sos_rank": int(v["avgsosrank"]) if v.get("avgsosrank") else None,
            "sos_remaining_rank": int(v["sosremainingrank"]) if v.get("sosremainingrank") else None,
        }
    if len(rows) < 10:
        return None
    for key in ("fpi", "off", "def"):
        values = [r[key] for r in rows.values()]
        for r in rows.values():
            r[f"{key}_rating"] = _normed_rating(r[key], values)
    rows["_updated"] = payload.get("lastUpdated")
    return rows


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
