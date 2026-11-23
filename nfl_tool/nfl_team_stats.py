"""Team numbers for the NFL build: scheme splits, opponent-adjusted stats,
opening drives, red zone, play lengths, explosives, EPA, recent games, scoring
by quarter, and build_team_stats, which puts each team's block together.

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import pandas as pd

from nfl_common import EXPLOSIVE_PASS_YARDS, EXPLOSIVE_RUSH_YARDS, LENGTH_BUCKETS, POSITION_KEYS, RED_ZONE_YARDLINE, length_bucket
from nfl_td import OPP_ADJ_SHRINK_GAMES


def compute_scheme_splits(pbp: pd.DataFrame, ftn: pd.DataFrame, teams) -> dict:
    """Schematic tendency (how a defense lines up) paired with how the
    FACING OFFENSE performs against that specific look. Tendency = this
    team's own defense's rate of using a look, out of its own defensive
    snaps. Performance = this team's own offense's result specifically
    when facing that look, aggregated across every defense it played this
    season (not one opponent) -- paired for display the same way every
    other offense/defense stat on this site is paired.

    Box count (defenders_in_box equivalent) and blitz volume come from FTN
    charting (n_defense_box/n_pass_rushers), joined to pbp by game_id/
    play_id -- FTN is published weekly during the season (see FTN_URL),
    unlike the NFL's own official participation charting this used to
    read from, which isn't published until after the season ends. Pressure
    is a plain-pbp proxy (sack or QB hit on the play) rather than the
    participation file's own was_pressure flag (which also catches
    hurries/knockdowns that don't show up as a hit or sack) -- a narrower
    definition, but real and current every week instead of a whole season
    behind.

    Coverage (zone/man, specific shells) is NOT computed here anymore --
    that data ONLY exists in the NFL's own participation charting, which
    has no live-during-season source anywhere (confirmed independently
    against nflsavant.com's own team pages hitting the identical gap), so
    showing it would mean permanently stale data with no way to fix it.
    It was dropped rather than kept stale.

    No MIN_SAMPLE floor -- every performance number is returned as soon as
    there's at least one play, with its own play count returned alongside
    it (the `_plays` fields) so a thin sample is visibly thin instead of
    silently hidden.

    Opponent quality (the "is this team's schedule skewing these numbers"
    question) is handled once per team, not per condition -- see
    compute_schedule_quality(). A first pass computed it per condition
    sample, but since every condition is just a different slice of the
    SAME ~17-game schedule, it came back nearly identical on every row
    (redundant, not per-row signal) -- one team-level number is the honest
    version of this.
    """
    merged = pbp[["game_id", "play_id", "posteam", "defteam", "rush_attempt", "pass_attempt", "yards_gained", "success", "two_point_attempt", "qb_hit", "sack"]].merge(
        ftn[["nflverse_game_id", "nflverse_play_id", "n_defense_box", "n_pass_rushers"]],
        left_on=["game_id", "play_id"],
        right_on=["nflverse_game_id", "nflverse_play_id"],
        how="left",
    )
    merged = merged[merged["two_point_attempt"] != 1]
    run = merged[merged["rush_attempt"] == 1].dropna(subset=["n_defense_box"]).copy()
    passp = merged[merged["pass_attempt"] == 1].copy()
    run["heavy_box"] = run["n_defense_box"] >= 7
    passp["blitz"] = passp["n_pass_rushers"] >= 5
    passp["pressure"] = (passp["sack"] == 1) | (passp["qb_hit"] == 1)

    result = {t: {} for t in teams}
    for team in teams:
        d = result[team]

        # ---- Run defense: box count ----
        def_run = run[run["defteam"] == team]
        off_run = run[run["posteam"] == team]
        def_total = len(def_run)
        heavy_def = int(def_run["heavy_box"].sum())
        d["box_heavy_rate"] = round(heavy_def / def_total, 3) if def_total else None
        d["box_light_rate"] = round(1 - heavy_def / def_total, 3) if def_total else None
        off_heavy = off_run[off_run["heavy_box"]]
        off_light = off_run[~off_run["heavy_box"]]
        d["ypc_vs_heavy_box"] = round(off_heavy["yards_gained"].mean(), 2) if len(off_heavy) else None
        d["ypc_vs_light_box"] = round(off_light["yards_gained"].mean(), 2) if len(off_light) else None
        d["ypc_vs_heavy_box_plays"] = len(off_heavy)
        d["ypc_vs_light_box_plays"] = len(off_light)
        # Mirror image: THIS team's own defense's yards-per-carry ALLOWED
        # when it plays that box count (how good the defense actually is in
        # that alignment, not just how often it uses it -- tendency alone
        # doesn't say whether a look works).
        def_heavy = def_run[def_run["heavy_box"]]
        def_light = def_run[~def_run["heavy_box"]]
        d["def_ypc_allowed_heavy_box"] = round(def_heavy["yards_gained"].mean(), 2) if len(def_heavy) else None
        d["def_ypc_allowed_light_box"] = round(def_light["yards_gained"].mean(), 2) if len(def_light) else None
        d["def_ypc_allowed_heavy_box_plays"] = len(def_heavy)
        d["def_ypc_allowed_light_box_plays"] = len(def_light)

        # ---- Pass rush: blitz ----
        def_pass = passp[passp["defteam"] == team]
        off_pass = passp[passp["posteam"] == team]
        pr_total = len(def_pass)
        blitz_def = int(def_pass["blitz"].sum())
        d["blitz_rate"] = round(blitz_def / pr_total, 3) if pr_total else None
        d["standard_rush_rate"] = round(1 - blitz_def / pr_total, 3) if pr_total else None
        off_blitzed = off_pass[off_pass["blitz"]]
        off_standard = off_pass[~off_pass["blitz"]]
        d["success_vs_blitz"] = round(off_blitzed["success"].mean(), 3) if len(off_blitzed) else None
        d["success_vs_standard_rush"] = round(off_standard["success"].mean(), 3) if len(off_standard) else None
        d["success_vs_blitz_plays"] = len(off_blitzed)
        d["success_vs_standard_rush_plays"] = len(off_standard)
        # Defense-side mirror: the opposing OFFENSE's success rate specifically
        # against THIS team's own blitz/standard rush -- i.e. how good this
        # defense actually is when it makes that call, not just how often it
        # makes it. Stored un-inverted (raw offense success rate allowed);
        # the frontend applies invert=true same as every other "allowed" stat.
        def_blitzed = def_pass[def_pass["blitz"]]
        def_standard = def_pass[~def_pass["blitz"]]
        d["def_success_allowed_blitz"] = round(def_blitzed["success"].mean(), 3) if len(def_blitzed) else None
        d["def_success_allowed_standard_rush"] = round(def_standard["success"].mean(), 3) if len(def_standard) else None
        d["def_success_allowed_blitz_plays"] = len(def_blitzed)
        d["def_success_allowed_standard_rush_plays"] = len(def_standard)

        # ---- Pass rush: pressure (sack-or-QB-hit proxy -- see docstring) ----
        pressure_def = int(def_pass["pressure"].sum())
        d["pressure_rate"] = round(pressure_def / pr_total, 3) if pr_total else None
        d["clean_pocket_rate"] = round(1 - pressure_def / pr_total, 3) if pr_total else None
        off_pressured = off_pass[off_pass["pressure"]]
        off_clean = off_pass[~off_pass["pressure"]]
        d["success_vs_pressure"] = round(off_pressured["success"].mean(), 3) if len(off_pressured) else None
        d["success_vs_clean_pocket"] = round(off_clean["success"].mean(), 3) if len(off_clean) else None
        d["success_vs_pressure_plays"] = len(off_pressured)
        d["success_vs_clean_pocket_plays"] = len(off_clean)
        def_pressured = def_pass[def_pass["pressure"]]
        def_clean = def_pass[~def_pass["pressure"]]
        d["def_success_allowed_pressure"] = round(def_pressured["success"].mean(), 3) if len(def_pressured) else None
        d["def_success_allowed_clean_pocket"] = round(def_clean["success"].mean(), 3) if len(def_clean) else None
        d["def_success_allowed_pressure_plays"] = len(def_pressured)
        d["def_success_allowed_clean_pocket_plays"] = len(def_clean)
    return result


# ---- Game Previews: opponent-adjusted team stats (the Raw / vs Opponents
# toggle) ----
# Every offense stat gets corrected for the defenses it faced, every defense
# stat for the offenses it faced. Correction = league average minus what
# those opponents normally allow/produce in their OTHER games (their "normal",
# shrunk toward the league by OPP_ADJ_SHRINK_GAMES games so a 1-2 game
# opponent can't swing it), averaged over the schedule and weighted by volume
# for rates. The corrected value is the site's own raw number plus that
# correction, so every stat keeps its existing definition. Penalty yards and
# scoring by quarter stay raw (not opponent-driven / too noisy); defensive
# tendencies (blitz rate, box rate) are the defense's own choice, not adjusted.
# (metric, numerator column, denominator column or None for per-game counts,
#  offense key, defense key)
OPP_ADJ_METRICS = [
    ("points", "pts", None, "points_for_per_g", "points_against_per_g"),
    ("epa", "epa_sum", "epa_n", "epa_per_play", "epa_per_play_allowed"),
    ("epa_pass", "epa_pass_sum", "epa_pass_n", "epa_per_play_pass", "epa_per_play_pass_allowed"),
    ("epa_rush", "epa_rush_sum", "epa_rush_n", "epa_per_play_rush", "epa_per_play_rush_allowed"),
    ("pass_yards", "pass_yds", None, "pass_yards_per_g", "pass_yards_allowed_per_g"),
    ("rush_yards", "rush_yds", None, "rush_yards_per_g", "rush_yards_allowed_per_g"),
    ("ypc", "rush_yds", "rush_att", "yards_per_carry", "yards_per_carry_allowed"),
    ("ypa", "pass_yds", "pass_att", "yards_per_att", "yards_per_att_allowed"),
    ("third", "third_conv", "third_att", "third_down_rate", "third_down_rate_allowed"),
    ("explosive", "expl", "plays", "explosive_rate", "explosive_rate_allowed"),
    ("explosive_pass", "expl_pass", "pass_plays", "explosive_pass_rate", "explosive_pass_rate_allowed"),
    ("explosive_rush", "expl_rush", "rush_att", "explosive_rush_rate", "explosive_rush_rate_allowed"),
    ("rz_trips", "rz_trips", None, "rz_trips_per_g", "rz_trips_allowed_per_g"),
    ("rz_points", "rz_pts", "rz_trips", "rz_avg_points", "rz_avg_points_allowed"),
    ("plays", "plays", None, "off_plays_per_g", "def_plays_faced_per_g"),
    ("sacks", "sacks", None, "sacks_allowed_per_g", "sacks_made_per_g"),
    ("turnovers", "tos", None, "turnovers_per_g", "takeaways_per_g"),
    ("heavy_box", "hb_yds", "hb_n", "ypc_vs_heavy_box", "def_ypc_allowed_heavy_box"),
    ("light_box", "lb_yds", "lb_n", "ypc_vs_light_box", "def_ypc_allowed_light_box"),
    ("blitz", "bl_succ", "bl_n", "success_vs_blitz", "def_success_allowed_blitz"),
    ("standard", "st_succ", "st_n", "success_vs_standard_rush", "def_success_allowed_standard_rush"),
    ("pressure", "pr_succ", "pr_n", "success_vs_pressure", "def_success_allowed_pressure"),
    ("clean", "cl_succ", "cl_n", "success_vs_clean_pocket", "def_success_allowed_clean_pocket"),
]


def compute_opponent_adjusted_stats(pbp: pd.DataFrame, ftn: pd.DataFrame, team_stats: dict) -> dict:
    """{team: {team_stats key: opponent-adjusted value}} for every key in
    OPP_ADJ_METRICS the team has a raw value for."""
    p = pbp[(pbp["two_point_attempt"] != 1) & pbp["posteam"].notna() & pbp["defteam"].notna()].copy()
    p = p.merge(
        ftn[["nflverse_game_id", "nflverse_play_id", "n_defense_box", "n_pass_rushers"]],
        left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "nflverse_play_id"], how="left",
    ) if ftn is not None and len(ftn) else p.assign(n_defense_box=float("nan"), n_pass_rushers=float("nan"))
    keys = ["game_id", "posteam"]
    is_pass = p["pass"] == 1
    is_rush = p["rush"] == 1
    play = is_pass | is_rush
    has_epa = p["epa"].notna()
    att = (p["pass_attempt"] == 1) & (p["sack"] != 1)
    rush_att = p["rush_attempt"] == 1
    pass_yds = p["passing_yards"].fillna(0)
    rush_yds = p["rushing_yards"].fillna(0)
    comp = p["complete_pass"] == 1
    third = (p["down"] == 3) & play
    succ = p["success"].fillna(0)
    pressure = (p["sack"] == 1) | (p["qb_hit"] == 1)
    blitz = p["n_pass_rushers"] >= 5
    box_known = p["n_defense_box"].notna()
    heavy = p["n_defense_box"] >= 7

    def agg(mask, col=None):
        grp = p[mask].groupby(keys)
        return grp.size() if col is None else grp[col].sum()

    p["_pass_yds"], p["_rush_yds"], p["_succ"] = pass_yds, rush_yds, succ
    p["_conv"] = ((p["first_down"] == 1) | (p["touchdown"] == 1)).astype(int)
    p["_to"] = p["interception"].fillna(0) + p["fumble_lost"].fillna(0)
    cols = {
        "plays": agg(play),
        "epa_sum": agg(play & has_epa, "epa"), "epa_n": agg(play & has_epa),
        "epa_pass_sum": agg(is_pass & has_epa, "epa"), "epa_pass_n": agg(is_pass & has_epa),
        "epa_rush_sum": agg(is_rush & has_epa, "epa"), "epa_rush_n": agg(is_rush & has_epa),
        "pass_yds": agg(p.index == p.index, "_pass_yds"), "rush_yds": agg(rush_att, "_rush_yds"),
        "pass_att": agg(att), "rush_att": agg(rush_att), "pass_plays": agg(is_pass),
        "third_att": agg(third), "third_conv": agg(third, "_conv"),
        "expl": agg((rush_att & (rush_yds >= EXPLOSIVE_RUSH_YARDS)) | (comp & (p["yards_gained"] >= EXPLOSIVE_PASS_YARDS))),
        "expl_pass": agg(comp & (p["yards_gained"] >= EXPLOSIVE_PASS_YARDS)),
        "expl_rush": agg(rush_att & (rush_yds >= EXPLOSIVE_RUSH_YARDS)),
        "sacks": agg(p["sack"] == 1), "tos": agg(p.index == p.index, "_to"),
        "hb_yds": agg(rush_att & box_known & heavy, "yards_gained"), "hb_n": agg(rush_att & box_known & heavy),
        "lb_yds": agg(rush_att & box_known & ~heavy, "yards_gained"), "lb_n": agg(rush_att & box_known & ~heavy),
        "bl_succ": agg(att & blitz, "_succ"), "bl_n": agg(att & blitz),
        "st_succ": agg(att & ~blitz & p["n_pass_rushers"].notna(), "_succ"), "st_n": agg(att & ~blitz & p["n_pass_rushers"].notna()),
        "pr_succ": agg(att & pressure, "_succ"), "pr_n": agg(att & pressure),
        "cl_succ": agg(att & ~pressure, "_succ"), "cl_n": agg(att & ~pressure),
    }
    # Red zone trips (drives reaching the 20) and points on them (TD 6, FG 3).
    drives = p[p["drive"].notna()].groupby(["game_id", "posteam", "drive"]).agg(
        best=("yardline_100", "min"), result=("fixed_drive_result", "first")
    ).reset_index()
    rz = drives[drives["best"] <= RED_ZONE_YARDLINE].copy()
    rz["pts"] = rz["result"].map({"Touchdown": 6, "Field goal": 3}).fillna(0)
    cols["rz_trips"] = rz.groupby(keys).size()
    cols["rz_pts"] = rz.groupby(keys)["pts"].sum()

    games = pbp.groupby("game_id").agg(home=("home_team", "first"), away=("away_team", "first"), hs=("home_score", "max"), as_=("away_score", "max")).reset_index()
    sides = pd.concat(
        [
            games.rename(columns={"home": "off", "away": "def", "hs": "pts"})[["game_id", "off", "def", "pts"]],
            games.rename(columns={"away": "off", "home": "def", "as_": "pts"})[["game_id", "off", "def", "pts"]],
        ],
        ignore_index=True,
    )
    idx = pd.MultiIndex.from_frame(sides[["game_id", "off"]])
    for col, series in cols.items():
        sides[col] = series.reindex(idx).fillna(0).astype(float).to_numpy()
    sides = sides[sides["plays"] > 0].reset_index(drop=True)
    if sides.empty:
        return {}

    k = OPP_ADJ_SHRINK_GAMES
    deltas: dict = {}

    def opp_delta(num, den):
        """(offense deltas, defense deltas) by team."""
        out = ({}, {})
        if den is None:
            L = sides[num].mean()
            tables = {s: sides.groupby(s)[num].agg(["sum", "count"]) for s in ("off", "def")}
            for i, (side, other) in enumerate((("off", "def"), ("def", "off"))):
                t = tables[other]
                normal = sides.apply(lambda r: (t.loc[r[other], "sum"] - r[num] + k * L) / (t.loc[r[other], "count"] - 1 + k), axis=1)
                out[i].update((L - normal.groupby(sides[side]).mean()).to_dict())
            return out
        total = sides[den].sum()
        if total <= 0:
            return out
        L = sides[num].sum() / total
        kw = k * sides[den].mean()
        tables = {s: sides.groupby(s)[[num, den]].sum() for s in ("off", "def")}
        valid = sides[sides[den] > 0]
        for i, (side, other) in enumerate((("off", "def"), ("def", "off"))):
            t = tables[other]
            normal = valid.apply(lambda r: (t.loc[r[other], num] - r[num] + kw * L) / (t.loc[r[other], den] - r[den] + kw), axis=1)
            frame = pd.DataFrame({"team": valid[side], "n": normal, "w": valid[den]})
            for team, grp in frame.groupby("team"):
                out[i][team] = L - (grp["n"] * grp["w"]).sum() / grp["w"].sum()
        return out

    result: dict = {}
    for _name, num, den, off_key, def_key in OPP_ADJ_METRICS:
        off_d, def_d = opp_delta(num, den)
        for team, stats in team_stats.items():
            for key, dmap in ((off_key, off_d), (def_key, def_d)):
                raw = stats.get(key)
                if raw is None or team not in dmap:
                    continue
                result.setdefault(team, {})[key] = round(float(raw + dmap[team]), 4)
    return result


# Opening Drive Tool (the owner, 2026-10-29): the book grades a team's first
# drive four ways -- Offensive TD, FG Attempt (made, missed or blocked), Punt
# (a blocked punt too), and Any Other (turnover, downs, safety, defensive or
# special-teams score, end of half). A drive is one with a real snap: a
# kickoff returned for a TD isn't the offense's first time with the ball.
OPENING_DRIVE_OUTCOMES = ("td", "fg", "punt", "other")
_DRIVE_SNAPS = {"run", "pass", "punt", "field_goal", "qb_kneel", "qb_spike"}


def _drive_outcome(result, transition) -> str:
    t = str(transition or "")
    if t.startswith("BLOCKED_FG"):
        return "fg"
    if t.startswith("BLOCKED_PUNT"):
        return "punt"
    return {"Touchdown": "td", "Field goal": "fg", "Missed field goal": "fg", "Punt": "punt"}.get(result, "other")


def compute_opening_drives(pbp: pd.DataFrame) -> dict:
    """Every team's games: how its offense's first drive ended (plus plays,
    yards, a 3-and-out flag, and whether it had the ball first), and how all
    its first-half and full-game drives ended, as [td, fg, punt, other]. The
    page reads a defense from its opponents' rows, so both sides come from
    the same drives. Raw counts only: no pull toward the league average
    (the owner: teams have identities)."""
    p = pbp[pbp["posteam"].notna() & pbp["fixed_drive"].notna() & pbp["play_type"].isin(_DRIVE_SNAPS)].copy()
    if p.empty:
        return {"teams": {}}
    p["_scrim"] = p["play_type"].isin({"run", "pass"})
    p["_yds"] = p["yards_gained"].where(p["_scrim"], 0).fillna(0)
    drives = p.groupby(["game_id", "posteam", "fixed_drive"]).agg(
        week=("week", "first"), home=("home_team", "first"), away=("away_team", "first"),
        qtr=("qtr", "min"), first_play=("play_id", "min"), result=("fixed_drive_result", "first"),
        transition=("drive_end_transition", "first"), first_downs=("drive_first_downs", "first"),
        plays=("_scrim", "sum"), yards=("_yds", "sum"),
    ).reset_index()
    drives["out"] = [_drive_outcome(r, t) for r, t in zip(drives["result"], drives["transition"])]
    teams: dict = {}
    for (game_id, team), d in drives.sort_values("first_play").groupby(["game_id", "posteam"], sort=False):
        first = d.iloc[0]
        opp = first["away"] if team == first["home"] else first["home"]
        game_first = drives[drives["game_id"] == game_id]["first_play"].min()
        count = lambda rows: [int((rows["out"] == o).sum()) for o in OPENING_DRIVE_OUTCOMES]
        teams.setdefault(team, []).append({
            "game_id": game_id, "week": int(first["week"]), "opp": opp, "home": bool(team == first["home"]),
            "out": first["out"], "plays": int(first["plays"]), "yards": int(first["yards"]),
            "three_out": bool(first["out"] == "punt" and (first["first_downs"] or 0) == 0),
            "received": bool(first["first_play"] == game_first),
            "half": count(d[d["qtr"] <= 2]), "game": count(d),
        })
    for games in teams.values():
        games.sort(key=lambda g: g["week"])
    return {"teams": teams}


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
        off_rz_td = rz_td[rz_td["posteam"] == team]
        def_rz_td = rz_td[rz_td["defteam"] == team]
        result[team] = {
            "rz_td": int((rz_td["posteam"] == team).sum()),
            "rz_td_allowed": int((rz_td["defteam"] == team).sum()),
            # Split by play type -- pairs with rz_carries/rz_targets below to
            # answer "does this team lean pass or run near the goal line, and
            # which one actually converts" (rz_pass_td_rate/rz_rush_td_rate
            # in build_team_stats), not just overall RZ TD volume.
            "rz_pass_td": int((off_rz_td["pass_touchdown"] == 1).sum()),
            "rz_rush_td": int((off_rz_td["rush_touchdown"] == 1).sum()),
            "rz_pass_td_allowed": int((def_rz_td["pass_touchdown"] == 1).sum()),
            "rz_rush_td_allowed": int((def_rz_td["rush_touchdown"] == 1).sum()),
            "rz_plays": int(len(off_plays)),
            "rz_plays_allowed": int(len(def_plays)),
            "rz_carries": int((off_plays["rush_attempt"] == 1).sum()),
            "rz_carries_allowed": int((def_plays["rush_attempt"] == 1).sum()),
            "rz_targets": int((off_plays["pass_attempt"] == 1).sum()),
            "rz_targets_allowed": int((def_plays["pass_attempt"] == 1).sum()),
        }
    return result


def compute_red_zone_trips(pbp: pd.DataFrame) -> dict:
    """Full-season red zone TRIPS (drives that reached the red zone) and
    how each one ended -- touchdown, made field goal, or neither
    (turnover, turnover on downs, missed FG, clock) -- both this team's
    own trips and what its defense allows (a drive belongs to exactly one
    offense, so a defense's "allowed" trip is looked up by the same
    (game_id, drive) key rather than needing the opponent's identity).
    Offensive scrimmage TDs only, same convention as everywhere else in
    this pipeline.

    Also tallies rz_points (6 per TD trip, 3 per FG trip, 0 otherwise) so
    build_team_stats can derive average points per trip -- the volume-
    weighted Red Zone grade (game-overview.js's RED_ZONE_CATEGORY) treats
    that as a truer efficiency signal than a bare TD-conversion rate,
    since it doesn't score a missed FG the same as a turnover.

    Excludes extra-point and two-point conversion snaps from the red-zone
    filter -- those are always run from the 15 (PAT) or 2 (2-point), so
    without this exclusion EVERY touchdown drive looked like a red zone
    trip regardless of where the offense actually was, even a 43-yard
    bomb thrown from midfield. Confirmed directly: 3 of a real team's 4
    "red zone touchdowns" in one game had never actually run a play
    inside the 20 -- the PAT/2-point snap after the score was the only
    thing making the drive register as a trip at all."""
    rz = pbp[
        (pbp["yardline_100"] <= RED_ZONE_YARDLINE)
        & (pbp["extra_point_attempt"] != 1)
        & (pbp["two_point_attempt"] != 1)
    ]
    off_trip_drives = rz.groupby(["game_id", "posteam"])["drive"].unique()
    def_trip_drives = rz.groupby(["game_id", "defteam"])["drive"].unique()

    off_td = pbp[(pbp["touchdown"] == 1) & ((pbp["pass_touchdown"] == 1) | (pbp["rush_touchdown"] == 1))]
    td_drive_keys = set(zip(off_td["game_id"], off_td["drive"]))
    td_drives_by_scorer = off_td.groupby(["game_id", "posteam"])["drive"].apply(set)

    fg_made = pbp[(pbp["field_goal_attempt"] == 1) & (pbp["field_goal_result"] == "made")]
    fg_drive_keys = set(zip(fg_made["game_id"], fg_made["drive"]))
    fg_drives_by_scorer = fg_made.groupby(["game_id", "posteam"])["drive"].apply(set)

    def blank():
        return {
            "rz_trips": 0, "rz_trips_td": 0, "rz_trips_fg": 0, "rz_points": 0,
            "rz_trips_allowed": 0, "rz_trips_td_allowed": 0, "rz_trips_fg_allowed": 0, "rz_points_allowed": 0,
        }

    result = {}
    for (game_id, team), drives in off_trip_drives.items():
        if pd.isna(team):
            continue
        d = result.setdefault(team, blank())
        scored_td = td_drives_by_scorer.get((game_id, team), set())
        scored_fg = fg_drives_by_scorer.get((game_id, team), set())
        for drv in set(drives):
            d["rz_trips"] += 1
            if drv in scored_td:
                d["rz_trips_td"] += 1
                d["rz_points"] += 6
            elif drv in scored_fg:
                d["rz_trips_fg"] += 1
                d["rz_points"] += 3

    for (game_id, team), drives in def_trip_drives.items():
        if pd.isna(team):
            continue
        d = result.setdefault(team, blank())
        for drv in set(drives):
            d["rz_trips_allowed"] += 1
            if (game_id, drv) in td_drive_keys:
                d["rz_trips_td_allowed"] += 1
                d["rz_points_allowed"] += 6
            elif (game_id, drv) in fg_drive_keys:
                d["rz_trips_fg_allowed"] += 1
                d["rz_points_allowed"] += 3
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


def compute_epa_per_play(pbp: pd.DataFrame) -> dict:
    """EPA (expected points added) per scrimmage play -- the standard modern
    efficiency metric, generally a stronger predictor of a team's real
    strength (and next week's results) than raw yardage or the success-rate
    splits already tracked elsewhere. Same scrimmage definition as
    compute_explosive_plays (rush/pass attempts, two-point tries excluded --
    EPA runs on a different scale there and it's a tiny fraction of plays
    anyway). Split by play type (not just an overall figure) since the
    Game Overviews summary grades Passing and Rushing separately. Stored as
    a sum + play count rather than an average so the per-play rate is
    derived in build_team_stats alongside every other derived rate in this
    pipeline."""
    scrimmage = pbp[((pbp["rush_attempt"] == 1) | (pbp["pass_attempt"] == 1)) & (pbp["two_point_attempt"] != 1)]
    result = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        off = scrimmage[scrimmage["posteam"] == team]
        deff = scrimmage[scrimmage["defteam"] == team]
        off_pass = off[off["pass_attempt"] == 1]
        off_rush = off[off["rush_attempt"] == 1]
        def_pass = deff[deff["pass_attempt"] == 1]
        def_rush = deff[deff["rush_attempt"] == 1]
        result[team] = {
            "epa_sum": float(off["epa"].sum()),
            "epa_plays": int(len(off)),
            "epa_sum_allowed": float(deff["epa"].sum()),
            "epa_plays_allowed": int(len(deff)),
            "epa_sum_pass": float(off_pass["epa"].sum()),
            "epa_plays_pass": int(len(off_pass)),
            "epa_sum_pass_allowed": float(def_pass["epa"].sum()),
            "epa_plays_pass_allowed": int(len(def_pass)),
            "epa_sum_rush": float(off_rush["epa"].sum()),
            "epa_plays_rush": int(len(off_rush)),
            "epa_sum_rush_allowed": float(def_rush["epa"].sum()),
            "epa_plays_rush_allowed": int(len(def_rush)),
        }
    return result


def compute_general_stats(pbp: pd.DataFrame) -> dict:
    """"Normal" box-score volume stats for the Game Overviews page -- raw
    season totals, both this team's own offense and its defense's mirror
    (what it allows/takes away). per-game rates and derived shares (comp %,
    yards/attempt, turnover margin, ...) are computed in build_team_stats
    alongside every other derived rate in this pipeline."""
    result = {}
    for team in pd.unique(pbp[["home_team", "away_team"]].values.ravel()):
        if pd.isna(team):
            continue
        off = pbp[pbp["posteam"] == team]
        deff = pbp[pbp["defteam"] == team]
        off_3rd = off[off["down"] == 3]
        deff_3rd = deff[deff["down"] == 3]

        result[team] = {
            "third_down_att": int(((off_3rd["third_down_converted"] == 1) | (off_3rd["third_down_failed"] == 1)).sum()),
            "third_down_conv": int((off_3rd["third_down_converted"] == 1).sum()),
            "third_down_att_allowed": int(
                ((deff_3rd["third_down_converted"] == 1) | (deff_3rd["third_down_failed"] == 1)).sum()
            ),
            "third_down_conv_allowed": int((deff_3rd["third_down_converted"] == 1).sum()),
            "pass_att": int((off["pass_attempt"] == 1).sum()),
            "completions": int((off["complete_pass"] == 1).sum()),
            "pass_yards": float(off.loc[off["complete_pass"] == 1, "yards_gained"].sum()),
            "int_thrown": int((off["interception"] == 1).sum()),
            "sacks_allowed": int((off["sack"] == 1).sum()),
            "sack_yards_lost": float(-off.loc[off["sack"] == 1, "yards_gained"].sum()),
            "rush_att": int((off["rush_attempt"] == 1).sum()),
            "rush_yards": float(off.loc[off["rush_attempt"] == 1, "yards_gained"].sum()),
            "fumbles_lost": int((off["fumble_lost"] == 1).sum()),
            "pass_att_allowed": int((deff["pass_attempt"] == 1).sum()),
            "completions_allowed": int((deff["complete_pass"] == 1).sum()),
            "pass_yards_allowed": float(deff.loc[deff["complete_pass"] == 1, "yards_gained"].sum()),
            "sacks_made": int((deff["sack"] == 1).sum()),
            "int_made": int((deff["interception"] == 1).sum()),
            "rush_att_allowed": int((deff["rush_attempt"] == 1).sum()),
            "rush_yards_allowed": float(deff.loc[deff["rush_attempt"] == 1, "yards_gained"].sum()),
            "fumbles_recovered": int((deff["fumble_lost"] == 1).sum()),
            # Split by which side of the ball the penalty happened on
            # (posteam vs defteam on that play), not just credited to the
            # team blindly -- an OFFENSIVE penalty (false start, holding,
            # illegal shift) and a DEFENSIVE one (offside, DPI, defensive
            # holding) are different units doing different jobs, and mixing
            # them into one team-wide number couldn't tell you which.
            "penalties_off": int(((pbp["penalty_team"] == team) & (pbp["posteam"] == team)).sum()),
            "penalty_yards_off": float(
                pbp.loc[(pbp["penalty_team"] == team) & (pbp["posteam"] == team), "penalty_yards"].sum()
            ),
            "penalties_def": int(((pbp["penalty_team"] == team) & (pbp["defteam"] == team)).sum()),
            "penalty_yards_def": float(
                pbp.loc[(pbp["penalty_team"] == team) & (pbp["defteam"] == team), "penalty_yards"].sum()
            ),
        }
    return result


def compute_recent_games(pbp: pd.DataFrame) -> dict:
    """Per-team game log: opponent, home/away, halftime score, and final
    score, oldest to newest -- grows week over week as the season goes.
    Halftime score comes from the last play of the "Half1" game_half (the
    running total_home_score/total_away_score at that point); final score
    reuses pbp's own home_score/away_score columns (constant per game_id)."""
    half1 = pbp[pbp["game_half"] == "Half1"].sort_values(["game_id", "play_id"])
    half1_last = half1.groupby("game_id").last()

    games = pbp.groupby("game_id").agg(
        week=("week", "first"),
        home_team=("home_team", "first"),
        away_team=("away_team", "first"),
        home_score=("home_score", "last"),
        away_score=("away_score", "last"),
    )

    result = {}
    for game_id, row in games.sort_values("week").iterrows():
        home_ht = away_ht = None
        if game_id in half1_last.index:
            ht_row = half1_last.loc[game_id]
            if pd.notna(ht_row["total_home_score"]):
                home_ht = int(ht_row["total_home_score"])
            if pd.notna(ht_row["total_away_score"]):
                away_ht = int(ht_row["total_away_score"])

        for team, opp, is_home in (
            (row["home_team"], row["away_team"], True),
            (row["away_team"], row["home_team"], False),
        ):
            if pd.isna(team):
                continue
            own_final = int(row["home_score"] if is_home else row["away_score"])
            opp_final = int(row["away_score"] if is_home else row["home_score"])
            own_ht = home_ht if is_home else away_ht
            opp_ht = away_ht if is_home else home_ht
            result.setdefault(team, []).append(
                {
                    "week": int(row["week"]),
                    "game_id": game_id,
                    "opponent": opp,
                    "home_away": "home" if is_home else "away",
                    "ht_for": own_ht,
                    "ht_against": opp_ht,
                    "final_for": own_final,
                    "final_against": opp_final,
                    "result": "W" if own_final > opp_final else ("L" if own_final < opp_final else "T"),
                }
            )
    return result


def compute_scoring_by_quarter(pbp: pd.DataFrame) -> dict:
    """Average points scored/allowed PER QUARTER across the season --
    fast starters (a lot of 1st-quarter points) vs. slow/comeback-heavy
    teams (scoring picks up in the second half), for whoever's deciding
    whether a 1st-half line is worth a look. Same technique
    compute_recent_games already uses for halftime score (the running
    total_home_score/total_away_score at the LAST play of a quarter),
    just done for all four instead of only the halfway point, and
    differenced quarter-to-quarter to get that quarter's OWN points
    rather than the cumulative total. Overtime (qtr 5+) folds into Q4 --
    most games never reach it, and it's sudden-death when they do, not
    four more quarters worth comparing on its own.
    """
    snap = pbp[pbp["qtr"].notna()].copy()
    snap["qtr_bucket"] = snap["qtr"].clip(upper=4).astype(int)
    last = (
        snap.sort_values(["game_id", "play_id"])
        .groupby(["game_id", "qtr_bucket"])
        .agg(
            home_team=("home_team", "first"),
            away_team=("away_team", "first"),
            home_score=("total_home_score", "last"),
            away_score=("total_away_score", "last"),
        )
        .reset_index()
        .sort_values(["game_id", "qtr_bucket"])
    )
    last["home_pts"] = last.groupby("game_id")["home_score"].diff().fillna(last["home_score"])
    last["away_pts"] = last.groupby("game_id")["away_score"].diff().fillna(last["away_score"])

    QUARTER_KEYS = {1: "q1", 2: "q2", 3: "q3", 4: "q4"}
    totals = {}

    def bump(team, bucket, scored, allowed, game_id):
        d = totals.setdefault(team, {}).setdefault(bucket, {"scored": 0.0, "allowed": 0.0, "games": set()})
        d["scored"] += scored
        d["allowed"] += allowed
        d["games"].add(game_id)

    for row in last.itertuples(index=False):
        bucket = QUARTER_KEYS[int(row.qtr_bucket)]
        bump(row.home_team, bucket, row.home_pts, row.away_pts, row.game_id)
        bump(row.away_team, bucket, row.away_pts, row.home_pts, row.game_id)

    out = {}
    for team, buckets in totals.items():
        out[team] = {}
        for bucket, vals in buckets.items():
            gp = len(vals["games"])
            out[team][bucket] = {
                "scored_per_g": round(vals["scored"] / gp, 2) if gp else None,
                "allowed_per_g": round(vals["allowed"] / gp, 2) if gp else None,
            }
    return out


# A team's full-season red zone attempts by play type run out fast (~40-80
# per team) -- floors rz_pass_td_rate/rz_rush_td_rate below this so a
# handful of red zone pass attempts can't produce a noisy 100%/0% TD rate.
RZ_TD_RATE_MIN_SAMPLE = 8


def build_team_stats(
    team_games,
    team_games_allowed,
    games_played,
    first_td_by_game,
    scoring_df,
    red_zone,
    red_zone_trips,
    length_buckets,
    explosive,
    epa,
    general,
    recent_games,
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
        epa_d = epa.get(team, {})

        gen = general.get(team, {})
        rz_trip = red_zone_trips.get(team, {})
        team_recent = recent_games.get(team, [])
        points_for = sum(g["final_for"] for g in team_recent)
        points_against = sum(g["final_against"] for g in team_recent)
        turnovers = gen.get("int_thrown", 0) + gen.get("fumbles_lost", 0)
        takeaways = gen.get("int_made", 0) + gen.get("fumbles_recovered", 0)

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
            # Red zone play-calling mix (this offense's own pass-vs-run
            # SHARE of its red zone snaps) and each type's own TD conversion
            # rate -- "does this team lean pass or run near the goal line,
            # and which one actually works for them," floored the same as
            # every other rate stat in this pipeline. _allowed mirrors it
            # for the DEFENSE side (what it faces/allows by play type).
            "rz_pass_rate": (
                round(rz.get("rz_targets", 0) / (rz.get("rz_targets", 0) + rz.get("rz_carries", 0)), 3)
                if (rz.get("rz_targets", 0) + rz.get("rz_carries", 0)) else None
            ),
            "rz_rush_rate": (
                round(rz.get("rz_carries", 0) / (rz.get("rz_targets", 0) + rz.get("rz_carries", 0)), 3)
                if (rz.get("rz_targets", 0) + rz.get("rz_carries", 0)) else None
            ),
            "rz_pass_td_rate": (
                round(rz.get("rz_pass_td", 0) / rz.get("rz_targets", 0), 3)
                if rz.get("rz_targets", 0) >= RZ_TD_RATE_MIN_SAMPLE else None
            ),
            "rz_rush_td_rate": (
                round(rz.get("rz_rush_td", 0) / rz.get("rz_carries", 0), 3)
                if rz.get("rz_carries", 0) >= RZ_TD_RATE_MIN_SAMPLE else None
            ),
            "rz_pass_rate_allowed": (
                round(rz.get("rz_targets_allowed", 0) / (rz.get("rz_targets_allowed", 0) + rz.get("rz_carries_allowed", 0)), 3)
                if (rz.get("rz_targets_allowed", 0) + rz.get("rz_carries_allowed", 0)) else None
            ),
            "rz_rush_rate_allowed": (
                round(rz.get("rz_carries_allowed", 0) / (rz.get("rz_targets_allowed", 0) + rz.get("rz_carries_allowed", 0)), 3)
                if (rz.get("rz_targets_allowed", 0) + rz.get("rz_carries_allowed", 0)) else None
            ),
            "rz_pass_td_rate_allowed": (
                round(rz.get("rz_pass_td_allowed", 0) / rz.get("rz_targets_allowed", 0), 3)
                if rz.get("rz_targets_allowed", 0) >= RZ_TD_RATE_MIN_SAMPLE else None
            ),
            "rz_rush_td_rate_allowed": (
                round(rz.get("rz_rush_td_allowed", 0) / rz.get("rz_carries_allowed", 0), 3)
                if rz.get("rz_carries_allowed", 0) >= RZ_TD_RATE_MIN_SAMPLE else None
            ),
            "td_by_length": lb["scored"],
            "td_by_length_allowed": lb["allowed"],
            "off_plays": off_plays,
            "off_plays_per_g": per_g(off_plays),
            "def_plays_faced": def_plays_faced,
            "def_plays_faced_per_g": per_g(def_plays_faced),
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
            "epa_per_play": round(epa_d["epa_sum"] / epa_d["epa_plays"], 3) if epa_d.get("epa_plays") else None,
            "epa_per_play_allowed": round(epa_d["epa_sum_allowed"] / epa_d["epa_plays_allowed"], 3)
            if epa_d.get("epa_plays_allowed")
            else None,
            "epa_per_play_pass": round(epa_d["epa_sum_pass"] / epa_d["epa_plays_pass"], 3)
            if epa_d.get("epa_plays_pass")
            else None,
            "epa_per_play_pass_allowed": round(epa_d["epa_sum_pass_allowed"] / epa_d["epa_plays_pass_allowed"], 3)
            if epa_d.get("epa_plays_pass_allowed")
            else None,
            "epa_per_play_rush": round(epa_d["epa_sum_rush"] / epa_d["epa_plays_rush"], 3)
            if epa_d.get("epa_plays_rush")
            else None,
            "epa_per_play_rush_allowed": round(epa_d["epa_sum_rush_allowed"] / epa_d["epa_plays_rush_allowed"], 3)
            if epa_d.get("epa_plays_rush_allowed")
            else None,
            "explosive_rush_rate": round(expl.get("explosive_rush", 0) / gen["rush_att"], 3) if gen.get("rush_att") else None,
            "explosive_rush_rate_allowed": round(expl.get("explosive_rush_allowed", 0) / gen["rush_att_allowed"], 3)
            if gen.get("rush_att_allowed")
            else None,
            "explosive_pass_rate": round(expl.get("explosive_pass", 0) / gen["pass_att"], 3) if gen.get("pass_att") else None,
            "explosive_pass_rate_allowed": round(expl.get("explosive_pass_allowed", 0) / gen["pass_att_allowed"], 3)
            if gen.get("pass_att_allowed")
            else None,
            "points_for": points_for,
            "points_for_per_g": per_g(points_for),
            "points_against": points_against,
            "points_against_per_g": per_g(points_against),
            "third_down_att": gen.get("third_down_att", 0),
            "third_down_conv": gen.get("third_down_conv", 0),
            "third_down_rate": round(gen["third_down_conv"] / gen["third_down_att"], 3) if gen.get("third_down_att") else None,
            "third_down_att_allowed": gen.get("third_down_att_allowed", 0),
            "third_down_conv_allowed": gen.get("third_down_conv_allowed", 0),
            "third_down_rate_allowed": round(gen["third_down_conv_allowed"] / gen["third_down_att_allowed"], 3)
            if gen.get("third_down_att_allowed")
            else None,
            "pass_att": gen.get("pass_att", 0),
            "pass_att_per_g": per_g(gen.get("pass_att", 0)),
            "completions": gen.get("completions", 0),
            "comp_pct": round(gen.get("completions", 0) / gen["pass_att"], 3) if gen.get("pass_att") else None,
            "pass_yards": gen.get("pass_yards", 0),
            "pass_yards_per_g": per_g(gen.get("pass_yards", 0)),
            "yards_per_att": round(gen.get("pass_yards", 0) / gen["pass_att"], 2) if gen.get("pass_att") else None,
            "int_thrown": gen.get("int_thrown", 0),
            "int_thrown_per_g": per_g(gen.get("int_thrown", 0)),
            "sacks_allowed": gen.get("sacks_allowed", 0),
            "sacks_allowed_per_g": per_g(gen.get("sacks_allowed", 0)),
            "sack_yards_lost": gen.get("sack_yards_lost", 0),
            "rush_att": gen.get("rush_att", 0),
            "rush_att_per_g": per_g(gen.get("rush_att", 0)),
            "rush_yards": gen.get("rush_yards", 0),
            "rush_yards_per_g": per_g(gen.get("rush_yards", 0)),
            "yards_per_carry": round(gen.get("rush_yards", 0) / gen["rush_att"], 2) if gen.get("rush_att") else None,
            "fumbles_lost": gen.get("fumbles_lost", 0),
            "fumbles_lost_per_g": per_g(gen.get("fumbles_lost", 0)),
            "pass_att_allowed": gen.get("pass_att_allowed", 0),
            "pass_att_allowed_per_g": per_g(gen.get("pass_att_allowed", 0)),
            "completions_allowed": gen.get("completions_allowed", 0),
            "comp_pct_allowed": round(gen.get("completions_allowed", 0) / gen["pass_att_allowed"], 3)
            if gen.get("pass_att_allowed")
            else None,
            "pass_yards_allowed": gen.get("pass_yards_allowed", 0),
            "pass_yards_allowed_per_g": per_g(gen.get("pass_yards_allowed", 0)),
            "yards_per_att_allowed": round(gen.get("pass_yards_allowed", 0) / gen["pass_att_allowed"], 2)
            if gen.get("pass_att_allowed")
            else None,
            "sacks_made": gen.get("sacks_made", 0),
            "sacks_made_per_g": per_g(gen.get("sacks_made", 0)),
            "int_made": gen.get("int_made", 0),
            "int_made_per_g": per_g(gen.get("int_made", 0)),
            "rush_att_allowed": gen.get("rush_att_allowed", 0),
            "rush_att_allowed_per_g": per_g(gen.get("rush_att_allowed", 0)),
            "rush_yards_allowed": gen.get("rush_yards_allowed", 0),
            "rush_yards_allowed_per_g": per_g(gen.get("rush_yards_allowed", 0)),
            "yards_per_carry_allowed": round(gen.get("rush_yards_allowed", 0) / gen["rush_att_allowed"], 2)
            if gen.get("rush_att_allowed")
            else None,
            "fumbles_recovered": gen.get("fumbles_recovered", 0),
            "fumbles_recovered_per_g": per_g(gen.get("fumbles_recovered", 0)),
            "turnovers": turnovers,
            "turnovers_per_g": per_g(turnovers),
            "takeaways": takeaways,
            "takeaways_per_g": per_g(takeaways),
            "turnover_margin_per_g": per_g(takeaways - turnovers),
            "penalties_off": gen.get("penalties_off", 0),
            "penalties_off_per_g": per_g(gen.get("penalties_off", 0)),
            "penalty_yards_off": gen.get("penalty_yards_off", 0),
            "penalty_yards_off_per_g": per_g(gen.get("penalty_yards_off", 0)),
            "penalties_def": gen.get("penalties_def", 0),
            "penalties_def_per_g": per_g(gen.get("penalties_def", 0)),
            "penalty_yards_def": gen.get("penalty_yards_def", 0),
            "penalty_yards_def_per_g": per_g(gen.get("penalty_yards_def", 0)),
            "rz_trips": rz_trip.get("rz_trips", 0),
            "rz_trips_per_g": per_g(rz_trip.get("rz_trips", 0)),
            "rz_trips_td": rz_trip.get("rz_trips_td", 0),
            "rz_trips_fg": rz_trip.get("rz_trips_fg", 0),
            "rz_points": rz_trip.get("rz_points", 0),
            "rz_avg_points": round(rz_trip.get("rz_points", 0) / rz_trip["rz_trips"], 2) if rz_trip.get("rz_trips") else None,
            "rz_td_rate": round(rz_trip.get("rz_trips_td", 0) / rz_trip["rz_trips"], 3) if rz_trip.get("rz_trips") else None,
            "rz_trips_allowed": rz_trip.get("rz_trips_allowed", 0),
            "rz_trips_allowed_per_g": per_g(rz_trip.get("rz_trips_allowed", 0)),
            "rz_trips_td_allowed": rz_trip.get("rz_trips_td_allowed", 0),
            "rz_trips_fg_allowed": rz_trip.get("rz_trips_fg_allowed", 0),
            "rz_points_allowed": rz_trip.get("rz_points_allowed", 0),
            "rz_avg_points_allowed": round(rz_trip.get("rz_points_allowed", 0) / rz_trip["rz_trips_allowed"], 2)
            if rz_trip.get("rz_trips_allowed")
            else None,
            "rz_td_rate_allowed": round(rz_trip.get("rz_trips_td_allowed", 0) / rz_trip["rz_trips_allowed"], 3)
            if rz_trip.get("rz_trips_allowed")
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
