"""Player Props numbers for the NFL build: the prop matchup model, pass and rush
zone splits, the pass shot chart, scrambles, volume stats and build_player_props.

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import pandas as pd

from nfl_common import EXPLOSIVE_RUSH_YARDS, GARBAGE_WP, PASS_DEPTH_BUCKETS, PASS_LOCATIONS, bucket_position, pass_depth_bucket
from nfl_td import OPP_ADJ_SHRINK_GAMES


def compute_pass_shot_chart(pbp: pd.DataFrame, teams, pos_lookup) -> dict:
    """Where each team's passing game actually attacks the field, and
    what each defense allows there -- see PASS_DEPTH_BUCKETS' docstring.
    Returns {team: {"off": {...}, "def": {...}}}, off/def each shaped
    {"zones": {"<depth>_<location>": {attempts, completions, success,
    epa_sum, plays}}, "pass_attempts": int, "total_plays": int (pass+rush,
    for computing pass rate on the frontend)}. Every team in `teams` gets
    a zero-filled entry even with no pass attempts yet (bye week, season's
    first game not yet played) -- callers shouldn't need a fallback.

    "plays" is every individual pass attempt in that zone this season
    (week, receiver, position, complete, yards, air_yards, yac, epa,
    defender -- who broke it up, if anyone), most recent week first --
    powers the drill-down on the frontend instead of leaving the aggregate
    as a dead end. position is carried per play so the defense-side view
    can break a zone down by WR/RB/TE (which position group actually finds
    this soft spot) without a second join."""
    passes = pbp[
        (pbp["pass_attempt"] == 1)
        & (pbp["two_point_attempt"] != 1)
        & pbp["pass_location"].notna()
        & pbp["air_yards"].notna()
    ].copy()
    passes["zone_key"] = passes["air_yards"].map(pass_depth_bucket) + "_" + passes["pass_location"]

    scrimmage = pbp[((pbp["pass_attempt"] == 1) | (pbp["rush_attempt"] == 1)) & (pbp["two_point_attempt"] != 1)]
    total_plays_off = scrimmage.groupby("posteam").size()
    total_plays_def = scrimmage.groupby("defteam").size()

    def play_records(sub):
        recs = []
        for row in sub.sort_values("week", ascending=False).itertuples(index=False):
            pos = None
            full_name = None
            if pd.notna(row.receiver_player_id):
                pos, _, full_name = pos_lookup(row.receiver_player_id, row.week)
            recs.append({
                "week": int(row.week),
                # pbp's own short form ("D.Kincaid") is the fallback -- the
                # roster join gives a full name, but misses on the handful
                # of players pos_lookup can't resolve for that week.
                "receiver": full_name or (row.receiver_player_name if pd.notna(row.receiver_player_name) else None),
                "position": pos,
                "complete": bool(row.complete_pass == 1),
                "yards": None if pd.isna(row.yards_gained) else int(row.yards_gained),
                "air_yards": None if pd.isna(row.air_yards) else int(row.air_yards),
                # air_yards + yac = yards (confirmed against real plays) --
                # air_yards is where the ball was caught (the same depth
                # this whole zone grid buckets by), yac is what happened
                # after that catch, kept separate so a short completion
                # that housed it on YAC doesn't look identical to one that
                # just fell a yard short.
                "yac": None if pd.isna(row.yards_after_catch) else int(row.yards_after_catch),
                "epa": None if pd.isna(row.epa) else round(float(row.epa), 2),
                "defender": row.pass_defense_1_player_name if pd.notna(row.pass_defense_1_player_name) else None,
                # Game script: 1 when the throwing team's win probability was
                # under 10% or over 90% (garbage time / game decided) -- a
                # defense sitting on a big lead gives up soft yards there, so
                # the frontend's zone matchup counts these at half weight.
                "gt": 1 if pd.notna(row.wp) and (row.wp < GARBAGE_WP or row.wp > 1 - GARBAGE_WP) else 0,
                "s": 1 if row.success == 1 else 0,
            })
        return recs

    def empty_side(team_col, total_plays):
        zones = {
            f"{depth}_{loc}": {"attempts": 0, "completions": 0, "success": 0, "epa_sum": 0.0, "plays": []}
            for depth, _, _ in PASS_DEPTH_BUCKETS
            for loc in PASS_LOCATIONS
        }
        return {"zones": zones, "pass_attempts": 0, "total_plays": int(total_plays.get(team_col, 0))}

    def side_stats(team_col):
        grouped = passes.groupby(team_col)
        totals = total_plays_off if team_col == "posteam" else total_plays_def
        result = {}
        for team in teams:
            if team not in grouped.groups:
                result[team] = empty_side(team, totals)
                continue
            grp = grouped.get_group(team)
            zones = {}
            for depth, _, _ in PASS_DEPTH_BUCKETS:
                for loc in PASS_LOCATIONS:
                    zk = f"{depth}_{loc}"
                    sub = grp[grp["zone_key"] == zk]
                    zones[zk] = {
                        "attempts": int(len(sub)),
                        "completions": int(sub["complete_pass"].sum()),
                        "success": int(sub["success"].sum()),
                        "epa_sum": round(float(sub["epa"].sum()), 2),
                        "plays": play_records(sub),
                    }
            result[team] = {"zones": zones, "pass_attempts": int(len(grp)), "total_plays": int(totals.get(team, 0))}
        return result

    off = side_stats("posteam")
    deff = side_stats("defteam")
    return {team: {"off": off[team], "def": deff[team]} for team in teams}


def compute_player_pass_zone_splits(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Per receiver: their own targets/receptions/yards/EPA by the same
    depth x location zone as compute_pass_shot_chart -- the individual-
    player complement to that team-level view (same idea as
    compute_player_rush_zone_splits for rush lanes), for seeing WHO
    actually gets used in a defense's weak zones. Keyed by (team,
    full_name) -> {"position": str, "zones": {...}}. No sample floor --
    targets is returned right alongside everything else, so a 1-target
    zone is visibly thin, not hidden."""
    passes = pbp[
        (pbp["pass_attempt"] == 1)
        & (pbp["two_point_attempt"] != 1)
        & pbp["pass_location"].notna()
        & pbp["air_yards"].notna()
    ].dropna(subset=["receiver_player_id"]).copy()
    passes["zone_key"] = passes["air_yards"].map(pass_depth_bucket) + "_" + passes["pass_location"]

    by_player = {}
    positions = {}
    for row in passes.itertuples(index=False):
        pos, _, name = pos_lookup(row.receiver_player_id, row.week)
        if not name:
            continue
        by_player.setdefault((row.posteam, name), []).append(row)
        positions[(row.posteam, name)] = pos

    out = {}
    for (team, name), rows in by_player.items():
        zones = {}
        for depth, _, _ in PASS_DEPTH_BUCKETS:
            for loc in PASS_LOCATIONS:
                zk = f"{depth}_{loc}"
                zone_rows = [r for r in rows if r.zone_key == zk]
                n = len(zone_rows)
                comps = [r for r in zone_rows if r.complete_pass == 1]
                zones[zk] = {
                    "targets": n,
                    "receptions": len(comps),
                    "yards": int(sum(r.yards_gained for r in comps)),
                    "epa_sum": round(sum(r.epa for r in zone_rows), 2) if n else 0.0,
                }
        out.setdefault(team, {})[name] = {"position": positions[(team, name)], "zones": zones}
    return out


# ---- Player Props summary: opponent-adjusted "what this defense allows" ----
# Per-game counts and per-attempt rates for every stat a player prop is
# settled on, split by position (WR/TE/RB targets, RB/QB carries) and by
# throw depth. Rates are weighted by attempts. Same opponent adjustment as
# the TD model, then each team's number is shrunk toward the league by
# OPP_ADJ_SHRINK_GAMES games of league-average data so a 2-3 game sample
# can't swing a factor too far.
PROP_COUNT_METRICS = [
    "pass_att", "completions", "pass_yards", "pass_td", "ints", "sacks",
    "tgt_WR", "rec_WR", "recyds_WR", "tgt_TE", "rec_TE", "recyds_TE", "tgt_RB", "rec_RB", "recyds_RB",
    "car_RB", "rushyds_RB", "car_QB", "rushyds_QB", "rush_att", "rush_yards",
    "att_short", "att_int", "att_deep", "yds_short", "yds_int", "yds_deep",
    "expl_pass", "expl_rush", "long_pass", "long_rush", "plays",
]
# rate name -> (numerator, denominator)
PROP_RATE_METRICS = {
    "comp": ("completions", "pass_att"),
    "ypa": ("pass_yards", "pass_att"),
    "td_rate": ("pass_td", "pass_att"),
    "int_rate": ("ints", "pass_att"),
    "ypt_WR": ("recyds_WR", "tgt_WR"),
    "ypt_TE": ("recyds_TE", "tgt_TE"),
    "ypt_RB": ("recyds_RB", "tgt_RB"),
    "catch_WR": ("rec_WR", "tgt_WR"),
    "catch_TE": ("rec_TE", "tgt_TE"),
    "catch_RB": ("rec_RB", "tgt_RB"),
    "ypc_RB": ("rushyds_RB", "car_RB"),
    "ypc_QB": ("rushyds_QB", "car_QB"),
    "ypa_short": ("yds_short", "att_short"),
    "ypa_int": ("yds_int", "att_int"),
    "ypa_deep": ("yds_deep", "att_deep"),
}
PROP_EXPLOSIVE_PASS_YARDS = 20  # completions long enough to decide a Longest Reception line
PROP_CONTEXT_WEIGHT = 0.3  # weight of a bad-weather / backup-QB game in passing numbers
PROP_BAD_WIND_MPH = 15
PROP_PASSING_METRICS = {
    "pass_att", "completions", "pass_yards", "pass_td", "ints", "sacks", "expl_pass", "long_pass",
    "tgt_WR", "rec_WR", "recyds_WR", "tgt_TE", "rec_TE", "recyds_TE", "tgt_RB", "rec_RB", "recyds_RB",
    "att_short", "att_int", "att_deep", "yds_short", "yds_int", "yds_deep",
}


def compute_prop_matchup_model(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Returns {"league": {metric: value}, "teams": {team: {"off": {...},
    "def": {...}}}} where each side's metric is {"v": adjusted value,
    "raw": plain per game / rate, "rk": rank 1-32 (1 = most produced /
    most allowed)}. Counts are per game, rates per attempt."""
    plays = pbp[(pbp["two_point_attempt"] != 1) & pbp["posteam"].notna() & pbp["defteam"].notna()].copy()
    pos_cache: dict = {}

    def pos_of(pid, week):
        if not isinstance(pid, str):
            return None
        key = (pid, week)
        if key not in pos_cache:
            pos = pos_lookup(pid, week)[0]
            pos_cache[key] = bucket_position(pos) if pos else None
        return pos_cache[key]

    passes = plays[(plays["pass_attempt"] == 1) & (plays["sack"] != 1) & plays["passer_player_id"].notna()].copy()
    rushes = plays[(plays["rush_attempt"] == 1) & plays["rusher_player_id"].notna()].copy()
    sacks = plays[plays["sack"] == 1]
    comp = passes["complete_pass"] == 1
    passes["cyds"] = passes["yards_gained"].where(comp, 0.0).fillna(0.0)
    passes["rpos"] = [pos_of(pid, wk) for pid, wk in zip(passes["receiver_player_id"], passes["week"])]
    rushes["rpos"] = [pos_of(pid, wk) for pid, wk in zip(rushes["rusher_player_id"], rushes["week"])]
    air = passes["air_yards"]
    passes["depth"] = None
    passes.loc[air.notna(), "depth"] = "short"
    passes.loc[air >= 10, "depth"] = "int"
    passes.loc[air >= 20, "depth"] = "deep"

    keys = ["game_id", "posteam"]

    def pass_counts(frame):
        c: dict = {}
        pg = frame.groupby(keys)
        c["pass_att"] = pg.size()
        c["completions"] = pg["complete_pass"].sum()
        c["pass_yards"] = pg["cyds"].sum()
        c["pass_td"] = pg["pass_touchdown"].sum()
        c["ints"] = pg["interception"].sum()
        done = frame["complete_pass"] == 1
        c["expl_pass"] = frame[done & (frame["yards_gained"] >= PROP_EXPLOSIVE_PASS_YARDS)].groupby(keys).size()
        for pos in ("WR", "TE", "RB"):
            g = frame[frame["rpos"] == pos].groupby(keys)
            c[f"tgt_{pos}"] = g.size()
            c[f"rec_{pos}"] = g["complete_pass"].sum()
            c[f"recyds_{pos}"] = g["cyds"].sum()
        for d in ("short", "int", "deep"):
            g = frame[frame["depth"] == d].groupby(keys)
            c[f"att_{d}"] = g.size()
            c[f"yds_{d}"] = g["cyds"].sum()
        return c

    cols: dict = pass_counts(passes)
    cols["long_pass"] = passes.groupby(keys)["cyds"].max()
    cols["sacks"] = sacks.groupby(keys).size()
    # The same passing counts from garbage-time throws only (the offense
    # under GARBAGE_WP to win, chasing a big deficit). Not used in the
    # numbers; the Props Summary tags a stat when much of it came this way.
    garbage_cols = pass_counts(passes[passes["wp"] < GARBAGE_WP])
    rg = rushes.groupby(keys)
    cols["rush_att"] = rg.size()
    cols["rush_yards"] = rg["yards_gained"].sum()
    cols["expl_rush"] = rushes[rushes["yards_gained"] >= EXPLOSIVE_RUSH_YARDS].groupby(keys).size()
    cols["long_rush"] = rg["yards_gained"].max()
    for pos in ("RB", "QB"):
        g = rushes[rushes["rpos"] == pos].groupby(keys)
        cols[f"car_{pos}"] = g.size()
        cols[f"rushyds_{pos}"] = g["yards_gained"].sum()

    games = pbp.groupby("game_id").agg(home=("home_team", "first"), away=("away_team", "first")).reset_index()
    sides = pd.concat(
        [
            games.rename(columns={"home": "off", "away": "def"})[["game_id", "off", "def"]],
            games.rename(columns={"away": "off", "home": "def"})[["game_id", "off", "def"]],
        ],
        ignore_index=True,
    )
    idx = pd.MultiIndex.from_frame(sides[["game_id", "off"]])
    for col, series in cols.items():
        sides[col] = series.reindex(idx).fillna(0).astype(float).to_numpy()
    for col, series in garbage_cols.items():
        sides[f"gt_{col}"] = series.reindex(idx).fillna(0).astype(float).to_numpy()
    sides["plays"] = sides["pass_att"] + sides["sacks"] + sides["rush_att"]
    # Games with no plays at all (not yet played) would read as zeros.
    sides = sides[sides["plays"] > 0].reset_index(drop=True)
    if sides.empty:
        return {"league": {}, "teams": {}}

    # Context weights for PASSING numbers only: a game in rain/snow or 15+
    # mph wind (outdoors) counts PROP_CONTEXT_WEIGHT as much for both teams,
    # and a game where the offense had a backup QB throwing counts that much
    # for the DEFENSE's numbers (a good day against Carson Wentz in the rain
    # isn't proof of a good pass defense). Rushing numbers are unweighted.
    gmeta = pbp.groupby("game_id").agg(weather=("weather", "first"), wind=("wind", "first"), roof=("roof", "first"))
    wx = gmeta["weather"].fillna("").str.contains("rain|snow|sleet", case=False)
    windy = pd.to_numeric(gmeta["wind"], errors="coerce").fillna(0) >= PROP_BAD_WIND_MPH
    outdoors = gmeta["roof"].fillna("outdoors").isin(["outdoors", "open"])
    bad_weather = ((wx | windy) & outdoors).to_dict()
    lead_passer = passes.groupby(["game_id", "posteam", "passer_player_id"]).size().reset_index(name="n")
    lead_passer = lead_passer.sort_values("n", ascending=False).drop_duplicates(["game_id", "posteam"])
    usual = passes.groupby(["posteam", "passer_player_id"]).size().reset_index(name="n").sort_values("n", ascending=False).drop_duplicates("posteam")
    usual_qb = dict(zip(usual["posteam"], usual["passer_player_id"]))
    game_qb = {(r.game_id, r.posteam): r.passer_player_id for r in lead_passer.itertuples(index=False)}
    backup = [game_qb.get((g, o)) not in (None, usual_qb.get(o)) for g, o in zip(sides["game_id"], sides["off"])]
    wxw = [PROP_CONTEXT_WEIGHT if bad_weather.get(g) else 1.0 for g in sides["game_id"]]
    sides["w_off"] = wxw
    sides["w_def"] = [w * (PROP_CONTEXT_WEIGHT if b else 1.0) for w, b in zip(wxw, backup)]
    sides["backup"] = backup
    sides["bad_wx"] = [bool(bad_weather.get(g)) for g in sides["game_id"]]

    k = OPP_ADJ_SHRINK_GAMES
    out: dict = {}
    league: dict = {}

    def put(team, side, metric, v, raw):
        out.setdefault(team, {"off": {}, "def": {}})[side][metric] = {"v": v, "raw": raw}

    def weight_col(metric, side):
        return f"w_{side}" if metric in PROP_PASSING_METRICS else None

    def count_metric(col):
        L = sides[col].mean()
        league[col] = round(L, 3)
        tables = {s: sides.groupby(s)[col].agg(["sum", "count"]) for s in ("off", "def")}

        def normal(table, team, value):
            s, n = (table.loc[team, "sum"], table.loc[team, "count"]) if team in table.index else (0.0, 0)
            return (s - value + k * L) / (n - 1 + k)

        for side, other in (("off", "def"), ("def", "off")):
            res = sides.apply(lambda r: r[col] - normal(tables[other], r[other], r[col]), axis=1)
            wc = weight_col(col, side)
            wts = sides[wc] if wc else pd.Series(1.0, index=sides.index)
            by = pd.DataFrame({"team": sides[side], "res": res, "val": sides[col], "w": wts}).groupby("team")
            for team, grp in by:
                n = grp["w"].sum()
                adj = L + (grp["res"] * grp["w"]).sum() / n
                raw = (grp["val"] * grp["w"]).sum() / n
                put(team, side, col, round(float((adj * n + k * L) / (n + k)), 3), round(float(raw), 2))

    def rate_metric(name, num, den):
        tot_den = sides[den].sum()
        if tot_den <= 0:
            return
        L = sides[num].sum() / tot_den
        league[name] = round(L, 4)
        kw = k * sides[den].mean()
        tables = {s: sides.groupby(s)[[num, den]].sum() for s in ("off", "def")}

        def normal(table, team, n_g, d_g):
            n_t, d_t = (table.loc[team, num], table.loc[team, den]) if team in table.index else (0.0, 0.0)
            return (n_t - n_g + kw * L) / (d_t - d_g + kw)

        for side, other in (("off", "def"), ("def", "off")):
            valid = sides[sides[den] > 0]
            res = valid.apply(lambda r: r[num] / r[den] - normal(tables[other], r[other], r[num], r[den]), axis=1)
            wc = weight_col(num, side)
            ctx = valid[wc] if wc else 1.0
            frame = pd.DataFrame({"team": valid[side], "res": res, "w": valid[den] * ctx, "num": valid[num] * ctx})
            for team, grp in frame.groupby("team"):
                w = grp["w"].sum()
                adj = L + (grp["res"] * grp["w"]).sum() / w
                put(team, side, name, round(float((adj * w + kw * L) / (w + kw)), 4), round(float(grp["num"].sum() / w), 4))

    for col in PROP_COUNT_METRICS:
        count_metric(col)
    for name, (num, den) in PROP_RATE_METRICS.items():
        rate_metric(name, num, den)

    # Rank 1 = most produced (offense) / most allowed (defense).
    for side in ("off", "def"):
        for metric in league:
            vals = sorted(
                ((t, s[side][metric]["v"]) for t, s in out.items() if metric in s[side]),
                key=lambda x: -x[1],
            )
            for rank, (team, _) in enumerate(vals, start=1):
                out[team][side][metric]["rk"] = rank

    # "gt" = share of a passing count that came in garbage time (plain
    # totals, no weights); gt_median = the typical defense's share (the
    # league mean: rare stats like 20+ yd plays have a median of 0).
    gt_median: dict = {}
    for col in garbage_cols:
        for side in ("off", "def"):
            tot = sides.groupby(side)[[col, f"gt_{col}"]].sum()
            shares = []
            for team, r in tot.iterrows():
                if r[col] > 0 and col in out.get(team, {}).get(side, {}):
                    share = float(r[f"gt_{col}"] / r[col])
                    out[team][side][col]["gt"] = round(share, 3)
                    shares.append(share)
            if side == "def" and shares:
                gt_median[col] = round(float(pd.Series(shares).mean()), 3)

    # Game-by-game rows behind every number, for the Props Summary tag
    # popups: each game's counts, the context flags that weight them, the
    # garbage-time part, and the players who produced them.
    weeks = pbp.groupby("game_id")["week"].first().to_dict()

    def name_of(pid, week):
        return pos_lookup(pid, week)[2] or pid

    players: dict = {}

    def add(key, pid, week, pos, field, vals):
        # Roster position (bucketed), so a WR's trick-play pass stays a WR.
        row = players.setdefault(key, {}).setdefault(pid, {"n": name_of(pid, week), "pos": pos_of(pid, week) or pos})
        row[field] = vals

    for (g, t, pid), grp in passes.groupby(["game_id", "posteam", "passer_player_id"]):
        add((g, t), pid, weeks[g], "QB", "pass", [int(len(grp)), int(grp["complete_pass"].sum()), int(grp["cyds"].sum()), int(grp["pass_touchdown"].sum())])
    rec = passes[passes["rpos"].isin(["WR", "TE", "RB"])]
    for (g, t, pid, pos), grp in rec.groupby(["game_id", "posteam", "receiver_player_id", "rpos"]):
        done = grp["complete_pass"] == 1
        deep = grp["depth"] == "deep"
        add((g, t), pid, weeks[g], pos, "rec", [
            int(len(grp)), int(done.sum()), int(grp["cyds"].sum()),
            int((done & (grp["yards_gained"] >= PROP_EXPLOSIVE_PASS_YARDS)).sum()),
            int(grp.loc[deep, "cyds"].sum()), int(deep.sum()),
        ])
    run = rushes[rushes["rpos"].isin(["RB", "QB"])]
    for (g, t, pid, pos), grp in run.groupby(["game_id", "posteam", "rusher_player_id", "rpos"]):
        add((g, t), pid, weeks[g], pos, "rush", [int(len(grp)), int(grp["yards_gained"].sum()), int((grp["yards_gained"] >= EXPLOSIVE_RUSH_YARDS).sum())])

    def num(v):
        return int(v) if float(v).is_integer() else round(float(v), 1)

    games_out = []
    for rd in sides.to_dict("records"):
        games_out.append({
            "g": rd["game_id"], "wk": int(weeks.get(rd["game_id"], 0)), "off": rd["off"], "def": rd["def"],
            "v": {c: num(rd[c]) for c in cols},
            "gt": {c: num(rd[f"gt_{c}"]) for c in garbage_cols if rd[f"gt_{c}"]},
            "bq": bool(rd["backup"]), "wx": bool(rd["bad_wx"]),
            "p": list(players.get((rd["game_id"], rd["off"]), {}).values()),
        })
    return {"league": league, "teams": out, "gt_median": gt_median, "games": games_out}


# ---- Player Props ----
# Volume/efficiency (targets, carries, pass attempts and what they turned
# into) -- distinct from player_stats above, which is TD-scorer-oriented
# only. Reuses the same full-season pbp already loaded for everything else;
# no new download.

# Any real season volume in ONE category is enough to show up on the
# Player Props page at all -- this used to require 5 targets/5 carries/10
# pass attempts, which was meant to filter out trick plays but actually
# just deleted every low-volume rookie/role player from the underlying
# data entirely (not just hidden by a display filter -- gone from
# data.json, so no frontend fix could ever surface them). A single charted
# target or carry IS real involvement, exactly what a props bettor wants
# to see; each page's own display filter (Rushing's carries>=5, Passing's
# qualifyingPassers) still controls what's shown where.
PROPS_MIN_TARGETS = 1
PROPS_MIN_CARRIES = 1
PROPS_MIN_PASS_ATT = 1


# Rush direction/gap ("run_location" + "run_gap", both standard nflverse
# pbp columns, confirmed directly against a real season file) -- 7 real
# lanes; "middle" carries no gap value (there's no left/right on an
# up-the-middle run), the other 6 are location+gap. A small number of rows
# (scrambles, kneels, spikes) have neither and are dropped rather than
# forced into a lane they were never charted for.
RUSH_ZONES = [
    "left_end", "left_tackle", "left_guard", "middle", "right_guard", "right_tackle", "right_end",
]


def _rush_zone(loc, gap):
    if pd.isna(loc):
        return None
    if loc == "middle":
        return "middle"
    if pd.isna(gap):
        return None
    return f"{loc}_{gap}"


def compute_rush_zone_splits(pbp: pd.DataFrame, teams) -> dict:
    """Per team, per rush lane: this offense's own usage share/YPC/success
    rate running into that lane, and what its DEFENSE allows when opponents
    run into it -- offense effectiveness and defense effectiveness in the
    SAME lane, side by side, so "this team loves running left end and the
    opponent is bad defending left end" reads as one signal. Powers the
    Rushing tab's rush-lane visual. Same floor/pattern as compute_route_
    splits, just keyed by rush lane instead of route type."""
    rushes = pbp[(pbp["rush_attempt"] == 1) & (pbp["two_point_attempt"] != 1)].copy()
    rushes["zone"] = [
        _rush_zone(loc, gap) for loc, gap in zip(rushes["run_location"], rushes["run_gap"])
    ]
    rushes = rushes.dropna(subset=["zone"])

    team_stats = {t: {} for t in teams}
    for team in teams:
        off = rushes[rushes["posteam"] == team]
        deff = rushes[rushes["defteam"] == team]
        off_total = len(off)
        d = team_stats[team]
        for zone_key in RUSH_ZONES:
            off_zone = off[off["zone"] == zone_key]
            def_zone = deff[deff["zone"] == zone_key]
            # No MIN_SAMPLE floor on YPC/success here -- the play COUNT is
            # returned right alongside every rate below, so the frontend
            # (and whoever's reading it) can judge for themselves whether a
            # 2-carry lane's number means anything, rather than the number
            # being hidden outright.
            d[f"rush_rate_{zone_key}"] = round(len(off_zone) / off_total, 3) if off_total else None
            d[f"rush_ypc_{zone_key}"] = round(off_zone["yards_gained"].mean(), 2) if len(off_zone) else None
            d[f"rush_success_{zone_key}"] = round((off_zone["success"] == 1).mean(), 3) if len(off_zone) else None
            d[f"rush_carries_{zone_key}"] = len(off_zone)
            d[f"rush_ypc_allowed_{zone_key}"] = round(def_zone["yards_gained"].mean(), 2) if len(def_zone) else None
            d[f"rush_success_allowed_{zone_key}"] = round((def_zone["success"] == 1).mean(), 3) if len(def_zone) else None
            d[f"rush_carries_allowed_{zone_key}"] = len(def_zone)
    return team_stats


def compute_player_rush_zone_splits(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Per player: their OWN usage share, YPC, and success rate by rush
    lane -- the individual-back complement to compute_rush_zone_splits'
    team-level view, for the Player Props page's per-player "Rush Lanes"
    tab (does THIS back actually run well to a side, not just his team in
    general). Keyed by (team, full_name), the same pos_lookup-derived join
    used by build_player_props/compute_player_game_logs. No MIN_SAMPLE
    floor -- carries is returned right alongside YPC/success so a thin
    lane is visibly thin, not silently hidden."""
    rushes = pbp[(pbp["rush_attempt"] == 1) & (pbp["two_point_attempt"] != 1)].dropna(subset=["rusher_player_id"]).copy()
    rushes["zone"] = [
        _rush_zone(loc, gap) for loc, gap in zip(rushes["run_location"], rushes["run_gap"])
    ]
    rushes = rushes.dropna(subset=["zone"])

    by_player = {}
    for row in rushes.itertuples(index=False):
        _, _, name = pos_lookup(row.rusher_player_id, row.week)
        if not name:
            continue
        key = (row.posteam, name)
        by_player.setdefault(key, []).append((row.zone, row.yards_gained, row.success))

    out = {}
    for (team, name), plays in by_player.items():
        total = len(plays)
        zones = {}
        for zone_key in RUSH_ZONES:
            zone_plays = [p for p in plays if p[0] == zone_key]
            n = len(zone_plays)
            zones[zone_key] = {
                "carries": n,
                "share": round(n / total, 3) if total else None,
                "ypc": round(sum(p[1] for p in zone_plays) / n, 2) if n else None,
                "success": round(sum(1 for p in zone_plays if p[2] == 1) / n, 3) if n else None,
            }
        out.setdefault(team, {})[name] = zones
    return out


# Lower than compute_scheme_splits' team-level MIN_SAMPLE=8 would need to be
# raised for, not lowered -- a single QB's own dropbacks clear 8 per
# condition almost every week (unlike a specific coverage shell), so the
# same floor works fine here too.
PLAYER_PASS_SPLIT_MIN_SAMPLE = 8


def compute_player_pass_splits(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Per-QB complement to compute_scheme_splits' team-level pass-rush
    numbers: how THIS passer actually performs vs pressure/a clean pocket.
    Paired on the frontend with the opponent's own pressure_rate/
    clean_pocket_rate (how often they show it) and def_success_allowed_
    pressure/clean_pocket (what they allow in it) -- same team_stats
    fields compute_scheme_splits already produces, just matched up
    against a specific passer instead of a whole offense. Same sack-or-
    QB-hit pressure proxy as compute_scheme_splits (see its docstring),
    computed straight from pbp -- no participation dependency, so this
    stays live all season. Zone/man splits were dropped entirely along
    with compute_scheme_splits' own zone_rate/man_rate -- there's no live
    source for coverage type and nothing left to pair a QB's zone/man
    splits against. Floored at PLAYER_PASS_SPLIT_MIN_SAMPLE per condition;
    att is always shown (a count, not a rate that needs stabilizing)."""
    passp = pbp.loc[
        (pbp["pass_attempt"] == 1) & (pbp["two_point_attempt"] != 1),
        ["week", "posteam", "passer_player_id", "complete_pass",
         "yards_gained", "success", "interception", "pass_touchdown", "sack", "qb_hit"],
    ].dropna(subset=["passer_player_id"]).copy()
    passp["pressure"] = (passp["sack"] == 1) | (passp["qb_hit"] == 1)

    by_player = {}
    for row in passp.itertuples(index=False):
        _, _, name = pos_lookup(row.passer_player_id, row.week)
        if not name:
            continue
        by_player.setdefault((row.posteam, name), []).append(row)

    def summarize(rows):
        n = len(rows)
        enough = n >= PLAYER_PASS_SPLIT_MIN_SAMPLE
        comp = sum(1 for r in rows if r.complete_pass == 1)
        return {
            "att": n,
            "comp_pct": round(comp / n, 3) if enough else None,
            "ypa": round(sum(r.yards_gained for r in rows) / n, 2) if enough else None,
            "success": round(sum(1 for r in rows if r.success == 1) / n, 3) if enough else None,
            "pass_td": sum(1 for r in rows if r.pass_touchdown == 1),
            "interceptions": sum(1 for r in rows if r.interception == 1),
        }

    out = {}
    for (team, name), rows in by_player.items():
        out.setdefault(team, {})[name] = {
            "pressure": summarize([r for r in rows if r.pressure]),
            "clean": summarize([r for r in rows if not r.pressure]),
        }
    return out


# Same floor as PLAYER_PASS_SPLIT_MIN_SAMPLE -- a QB's pressured/clean
# dropback counts clear this easily most weeks.
SCRAMBLE_MIN_SAMPLE = 8


def compute_scramble_splits(pbp: pd.DataFrame, pos_lookup, teams) -> tuple:
    """Returns (player_scramble_splits, team_scramble_containment).

    player_scramble_splits[(team)][name]: this QB's OWN scramble rate out
    of every dropback (not just his rushing -- see build_player_props'
    scramble_share_of_rushing for that angle), split by whether the play
    was pressured or clean -- "does pressure actually make him take off"
    (e.g. Josh Allen: ~14% of pressured dropbacks in 2025 vs ~7% clean).
    Uses qb_dropback==1 (pass attempts, sacks, AND scrambles), unlike
    compute_player_pass_splits which is pass_attempt==1 only and would
    silently exclude every scramble (scrambles carry pass_attempt=0).

    team_scramble_containment[team]: this team's DEFENSE -- scramble rate
    ALLOWED overall, and split by whether ITS OWN pressure got home, so
    "how often is this defense's pressure actually forcing him to run"
    (rate) can be checked against "and how much does he gain when he does"
    (avg_scramble_yards) -- pressure without containment (e.g. a defense
    that gets to the QB but still gives up 9+ yards a scramble when it
    does) is a real, checkable distinction, not just raw pressure rate.
    """
    # nflverse leaves passer_player_id NULL on every scramble row (confirmed
    # directly: 1221/1221 in a real season file) -- it logs the scrambling
    # QB under rusher_player_id instead, since the play resolved as a run.
    # A naive dropna(subset=["passer_player_id"]) silently drops every
    # scramble before it can ever be counted. qb_player_id falls back to
    # rusher_player_id so the same QB is grouped across pass/sack/scramble
    # outcomes alike.
    db = pbp.loc[
        (pbp["qb_dropback"] == 1) & (pbp["two_point_attempt"] != 1),
        ["week", "posteam", "defteam", "passer_player_id", "rusher_player_id", "qb_scramble", "yards_gained", "sack", "qb_hit"],
    ].copy()
    db["qb_player_id"] = db["passer_player_id"].fillna(db["rusher_player_id"])
    merged = db.dropna(subset=["qb_player_id"]).copy()
    # Same sack-or-QB-hit pressure proxy as compute_scheme_splits/
    # compute_player_pass_splits -- no participation dependency, so this
    # stays live all season instead of needing a fallback.
    merged["pressure"] = (merged["sack"] == 1) | (merged["qb_hit"] == 1)
    merged["scramble"] = merged["qb_scramble"] == 1

    by_player = {}
    for row in merged.itertuples(index=False):
        _, _, name = pos_lookup(row.qb_player_id, row.week)
        if not name:
            continue
        by_player.setdefault((row.posteam, name), []).append(row)

    def rate(rows):
        n = len(rows)
        if n < SCRAMBLE_MIN_SAMPLE:
            return None
        return round(sum(1 for r in rows if r.scramble) / n, 3)

    player_splits = {}
    for (team, name), rows in by_player.items():
        pressured = [r for r in rows if r.pressure]
        clean = [r for r in rows if not r.pressure]
        scrambles = [r for r in rows if r.scramble]
        player_splits.setdefault(team, {})[name] = {
            "dropbacks": len(rows),
            "scramble_rate": rate(rows),
            "scramble_rate_pressured": rate(pressured),
            "scramble_rate_clean": rate(clean),
            "avg_scramble_yards": (
                round(sum(r.yards_gained for r in scrambles) / len(scrambles), 2)
                if len(scrambles) >= SCRAMBLE_MIN_SAMPLE else None
            ),
        }

    team_containment = {}
    for team in teams:
        def_rows = merged[merged["defteam"] == team]
        pressured = def_rows[def_rows["pressure"]]
        clean = def_rows[~def_rows["pressure"]]
        scrambles_pressured = pressured[pressured["scramble"]]
        scrambles_clean = clean[clean["scramble"]]
        team_containment[team] = {
            "scramble_rate_allowed": (
                round(def_rows["scramble"].sum() / len(def_rows), 3)
                if len(def_rows) >= SCRAMBLE_MIN_SAMPLE else None
            ),
            "scramble_rate_allowed_pressured": (
                round(len(scrambles_pressured) / len(pressured), 3)
                if len(pressured) >= SCRAMBLE_MIN_SAMPLE else None
            ),
            "scramble_rate_allowed_clean": (
                round(len(scrambles_clean) / len(clean), 3)
                if len(clean) >= SCRAMBLE_MIN_SAMPLE else None
            ),
            "scramble_yards_allowed_pressured": (
                round(scrambles_pressured["yards_gained"].mean(), 2)
                if len(scrambles_pressured) >= SCRAMBLE_MIN_SAMPLE else None
            ),
            "scramble_yards_allowed_clean": (
                round(scrambles_clean["yards_gained"].mean(), 2)
                if len(scrambles_clean) >= SCRAMBLE_MIN_SAMPLE else None
            ),
        }
    return player_splits, team_containment


def compute_volume_stats(pbp: pd.DataFrame, pos_lookup, games_played: dict) -> tuple:
    """Returns (players, defense_allowed_by_position) from a single pass over
    every target/carry/dropback, so the same per-play position lookup isn't
    done twice.

    players[(team, player_id)]: season totals for whichever of receiving/
    rushing/passing that player actually did (targets/receptions/rec_yards,
    carries/rush_yards, pass_att/completions/pass_yards/interceptions), plus
    each side's own game count (own games with a qualifying look, NOT the
    team's overall games_played -- a player who missed time shouldn't have
    his rate diluted by games he didn't play).

    defense_allowed_by_position[team]: what that team's DEFENSE allows per
    game to each skill-position bucket (WR/RB/TE for receiving, RB/QB/WR for
    rushing) -- the matchup-context half of the props page, same offense-
    volume/defense-allowed pairing used everywhere else on this site.

    team_targets[team]: total pass targets THIS TEAM'S OFFENSE threw all
    season, across every receiver -- the denominator for each player's own
    target share below.
    """
    scrimmage = pbp[pbp["two_point_attempt"] != 1]
    targets = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["receiver_player_id"])
    rushes = scrimmage[scrimmage["rush_attempt"] == 1].dropna(subset=["rusher_player_id"])
    dropbacks = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["passer_player_id"])

    players = {}
    def_totals = {t: {"targets": {}, "rec": {}, "rec_yds": {}, "rush_att": {}, "rush_yds": {}} for t in games_played}
    team_targets = {t: 0 for t in games_played}

    def ensure(pid, team, week):
        key = (team, pid)
        if key not in players:
            pos, _, name = pos_lookup(pid, week)
            players[key] = {
                "player_id": pid,
                "name": name,
                "team": team,
                "position": bucket_position(pos) if pos else "DST",
                "targets": 0, "receptions": 0, "rec_yards": 0.0, "rec_games": set(),
                "air_yards_sum": 0.0, "yac_sum": 0.0,
                "carries": 0, "rush_yards": 0.0, "rush_games": set(),
                "explosive_rushes": 0, "rz_carries": 0,
                "scramble_rushes": 0, "scramble_rush_yards": 0.0,
                "pass_att": 0, "completions": 0, "pass_yards": 0.0, "interceptions": 0, "pass_games": set(),
                "epa_sum_pass": 0.0, "air_yards_thrown_sum": 0.0, "air_yards_thrown_n": 0,
            }
        return players[key]

    def bump(defteam, bucket, field, amount=1):
        if defteam not in def_totals:
            return
        b = def_totals[defteam][field]
        b[bucket] = b.get(bucket, 0) + amount

    for row in targets.itertuples(index=False):
        pos, _, _ = pos_lookup(row.receiver_player_id, row.week)
        bucket = bucket_position(pos) if pos else "DST"
        p = ensure(row.receiver_player_id, row.posteam, row.week)
        p["targets"] += 1
        p["rec_games"].add(row.game_id)
        if pd.notna(row.air_yards):
            p["air_yards_sum"] += row.air_yards
        if row.posteam in team_targets:
            team_targets[row.posteam] += 1
        bump(row.defteam, bucket, "targets")
        if row.complete_pass == 1:
            p["receptions"] += 1
            p["rec_yards"] += row.yards_gained
            if pd.notna(row.yards_after_catch):
                p["yac_sum"] += row.yards_after_catch
            bump(row.defteam, bucket, "rec")
            bump(row.defteam, bucket, "rec_yds", row.yards_gained)

    for row in rushes.itertuples(index=False):
        pos, _, _ = pos_lookup(row.rusher_player_id, row.week)
        bucket = bucket_position(pos) if pos else "DST"
        p = ensure(row.rusher_player_id, row.posteam, row.week)
        p["carries"] += 1
        p["rush_yards"] += row.yards_gained
        p["rush_games"].add(row.game_id)
        if row.yards_gained >= EXPLOSIVE_RUSH_YARDS:
            p["explosive_rushes"] += 1
        if pd.notna(row.yardline_100) and row.yardline_100 <= 20:
            p["rz_carries"] += 1
        if row.qb_scramble == 1:
            p["scramble_rushes"] += 1
            p["scramble_rush_yards"] += row.yards_gained
        bump(row.defteam, bucket, "rush_att")
        bump(row.defteam, bucket, "rush_yds", row.yards_gained)

    for row in dropbacks.itertuples(index=False):
        p = ensure(row.passer_player_id, row.posteam, row.week)
        p["pass_att"] += 1
        p["pass_games"].add(row.game_id)
        if pd.notna(row.epa):
            p["epa_sum_pass"] += row.epa
        if pd.notna(row.air_yards):
            p["air_yards_thrown_sum"] += row.air_yards
            p["air_yards_thrown_n"] += 1
        if row.complete_pass == 1:
            p["completions"] += 1
            p["pass_yards"] += row.yards_gained
        if row.interception == 1:
            p["interceptions"] += 1

    for p in players.values():
        p["rec_games"] = len(p["rec_games"])
        p["rush_games"] = len(p["rush_games"])
        p["pass_games"] = len(p["pass_games"])

    defense_allowed = {}
    for team, agg in def_totals.items():
        gp = games_played.get(team) or 0
        d = {}
        for pos in ("WR", "RB", "TE"):
            d[f"targets_allowed_{pos.lower()}_per_g"] = round(agg["targets"].get(pos, 0) / gp, 2) if gp else None
            d[f"rec_allowed_{pos.lower()}_per_g"] = round(agg["rec"].get(pos, 0) / gp, 2) if gp else None
            d[f"rec_yards_allowed_{pos.lower()}_per_g"] = round(agg["rec_yds"].get(pos, 0) / gp, 2) if gp else None
        for pos in ("RB", "QB", "WR"):
            d[f"rush_att_allowed_{pos.lower()}_per_g"] = round(agg["rush_att"].get(pos, 0) / gp, 2) if gp else None
            d[f"rush_yards_allowed_{pos.lower()}_per_g"] = round(agg["rush_yds"].get(pos, 0) / gp, 2) if gp else None
        defense_allowed[team] = d

    return players, defense_allowed, team_targets


def build_player_props(players: dict, teams, team_targets: dict, snap_shares: dict) -> dict:
    """Turns compute_volume_stats' raw players dict into the sorted,
    derived-rate, per-team lists the Player Props page actually renders --
    same season-totals-in/per-game-rates-out split as build_team_stats.
    snap_shares (see compute_player_snap_shares) is keyed by the snap-count
    file's OWN player-name spelling, not pos_lookup's roster name, so a
    join miss (accented characters, suffix formatting) leaves snap_pct
    None rather than crashing -- same disclosed limitation as every other
    join between nflverse sources on this site."""
    by_team = {t: [] for t in teams}
    for (team, pid), p in players.items():
        if team not in by_team or p["position"] not in ("QB", "RB", "WR", "TE"):
            continue
        qualifies = (
            p["targets"] >= PROPS_MIN_TARGETS
            or p["carries"] >= PROPS_MIN_CARRIES
            or p["pass_att"] >= PROPS_MIN_PASS_ATT
        )
        if not qualifies:
            continue
        row = dict(p)
        row["snap_pct"] = snap_shares.get(team, {}).get(p["name"])
        row["ypt"] = round(p["rec_yards"] / p["targets"], 2) if p["targets"] else None
        row["catch_rate"] = round(p["receptions"] / p["targets"], 3) if p["targets"] else None
        row["adot"] = round(p["air_yards_sum"] / p["targets"], 1) if p["targets"] else None
        row["yac_per_rec"] = round(p["yac_sum"] / p["receptions"], 1) if p["receptions"] else None
        team_total_targets = team_targets.get(team)
        row["target_share"] = round(p["targets"] / team_total_targets, 3) if team_total_targets else None
        row["targets_per_g"] = round(p["targets"] / p["rec_games"], 1) if p["rec_games"] else None
        row["rec_per_g"] = round(p["receptions"] / p["rec_games"], 1) if p["rec_games"] else None
        row["rec_yards_per_g"] = round(p["rec_yards"] / p["rec_games"], 1) if p["rec_games"] else None
        row["ypc"] = round(p["rush_yards"] / p["carries"], 2) if p["carries"] else None
        row["carries_per_g"] = round(p["carries"] / p["rush_games"], 1) if p["rush_games"] else None
        row["rush_yards_per_g"] = round(p["rush_yards"] / p["rush_games"], 1) if p["rush_games"] else None
        row["explosive_rush_rate"] = round(p["explosive_rushes"] / p["carries"], 3) if p["carries"] else None
        row["rz_carries_per_g"] = round(p["rz_carries"] / p["rush_games"], 1) if p["rush_games"] else None
        row["comp_pct"] = round(p["completions"] / p["pass_att"], 3) if p["pass_att"] else None
        row["pass_att_per_g"] = round(p["pass_att"] / p["pass_games"], 1) if p["pass_games"] else None
        row["pass_yards_per_g"] = round(p["pass_yards"] / p["pass_games"], 1) if p["pass_games"] else None
        row["int_per_g"] = round(p["interceptions"] / p["pass_games"], 2) if p["pass_games"] else None
        row["epa_per_att"] = round(p["epa_sum_pass"] / p["pass_att"], 3) if p["pass_att"] else None
        row["adot_thrown"] = (
            round(p["air_yards_thrown_sum"] / p["air_yards_thrown_n"], 1) if p["air_yards_thrown_n"] else None
        )
        # Designed vs scramble split of this player's OWN season rushing
        # (qb_scramble flag -- true for almost everyone except a QB, whose
        # "carries" otherwise conflate broken-play scrambles with schemed
        # runs). scramble_share is share of THIS player's rushing that's
        # scrambles -- descriptive, not the pressure-conditioned rate (see
        # compute_scramble_splits for "does pressure make him run more").
        designed_carries = p["carries"] - p["scramble_rushes"]
        designed_rush_yards = p["rush_yards"] - p["scramble_rush_yards"]
        row["scramble_carries"] = p["scramble_rushes"]
        row["scramble_rush_yards"] = round(p["scramble_rush_yards"], 0)
        row["scramble_ypc"] = round(p["scramble_rush_yards"] / p["scramble_rushes"], 2) if p["scramble_rushes"] else None
        row["scramble_share_of_rushing"] = round(p["scramble_rushes"] / p["carries"], 3) if p["carries"] else None
        row["designed_carries"] = designed_carries
        row["designed_rush_yards"] = round(designed_rush_yards, 0)
        row["designed_ypc"] = round(designed_rush_yards / designed_carries, 2) if designed_carries else None
        by_team[team].append(row)
    for t in by_team:
        by_team[t].sort(key=lambda r: -(r["targets"] + r["carries"] + r["pass_att"]))
    return by_team
