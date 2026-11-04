"""NBA Prop Research panel data (props.json `research`, 2026-11-03).

The owner, 2026-11-03: "click a player and have the expandable box below be
full of data and other research-esque tools" ... "Think of this like a
dashboard. You are someone who has 1-2 minutes to look at a player and get an
idea about a line." Real counts only (a research site: no projection, no
pick). This file adds what the page can't work out from the game logs alone;
everything here comes from the engine (possessions.py) for THIS season.

`players[<id>]`:
- `feed`: [his made shots in the play-by-play, [[passer id, assisted makes], ...]]
  (top FEED_TOP passers).
- `trans`: [points on transition possessions, points in all].
  A transition possession is identity.py's: it starts off a miss or a steal
  and its first shot / turnover comes within TRANSITION_SECS.
- `units`: [possessions on offense vs the other team's bench units, his points
  then, possessions vs starter units, his points then]. A bench unit has
  BENCH_UNIT or fewer of that night's starters on the floor.
- `q`: his points by quarter (1st-4th, overtime left out), summed.
- `rot`: games he was on the floor at each of the 48 game minutes (season),
  `rot5`: the same over his last 5 games, `rot1`: his last game (1 / 0), `rotn`: [games, last-5 games].
- `q4`: [close games, 4th-quarter minutes in them, not-close games, minutes]:
  close = the score within CLOSE_Q4 entering the 4th.
- `foul`: game ids with early foul trouble (EARLY_Q1 fouls in the 1st quarter
  or EARLY_H1 by halftime).
- `pz`: his points [threes, mid-range, paint (rim + short), free throws], summed.
Threes (the Threes page's panel, 2026-11-04):
- `t3`: his threes [made, tried] by how they came, flat, THREE_KINDS order then every three:
  [catch m, a, pull-up m, a, step-back m, a, transition m, a, second chance m, a, all m, a].
  Catch = ESPN's plain "Jump Shot"; pull-up takes fades too; transition = the three itself within
  TRANSITION_SECS of a transition possession's start (a three after an offensive rebound in one is
  not); second chance = after his team's offensive rebound, same possession.
- `q3`: his threes [made, tried] by quarter, flat [q1 m, a, ... q4 m, a] (overtime left out).
- `feed3`: [his made threes, [[passer id, assisted threes], ...]] (top FEED_TOP passers).
- `w3[<teammate>]`: [threes made, tried with him on the floor, made, tried with him off]
  (only teammates in props.py's `with`).
`def3[<abbr>][<pos>]`: what that defense allowed the position from three, the same 12 numbers as `t3`.
Rebounds (the Rebounds page's panel, 2026-11-04). A rebound chance = a player's rebound in the
play-by-play (team rebounds left out, the standard rebound-rate count). A defensive chance = one off the other team's miss, an offensive chance =
off his own team's miss, while he's on the floor:
- `rb`: [defensive chances, his DREB, offensive chances, his OREB, seconds on the floor].
- `rz`: his DREB by where the miss came from, MISS_ZONES order.
- `qr`: [REB, OREB] by quarter, flat (q1 reb, oreb, ... q4).
- `rcg`: {game id: chances (both ends) while he was on the floor} (Game Script).
- `wr[<teammate>]`: [his REB, chances with him on the floor, his REB, chances with him off]
  (only teammates in props.py's `with`).
`rbt[<abbr>]`: [games, rebounds off their misses, their OREB, rebounds off their opponents' misses,
  their DREB, opponents' made shots, opponents' shots] (their offense and defense on the glass).
`mz[<abbr>]`: rebounds off their misses by MISS_ZONES (where they miss from).
Assists (the Assists page's panel, 2026-11-04; no turnovers, the owner: too noisy). An assist chance =
a teammate's made shot while he's on the floor (our stand-in for the NBA's "potential assists"):
- `ap`: [chances, his assists, his assists in transition (the shot within TRANSITION_SECS)].
- `az`: his assists by where the made shot came from, ASSIST_ZONES order.
- `qa`: his assists by quarter.
- `acg`: {game id: [chances, assists, assists to a PG, SG, SF, PF, C]} (Game Script; Vs The Line's
  hover: chances x rate that night; Form: his assists to each position, the owner 2026-11-04).
- `wa[<teammate>]`: [assists, chances with him on the floor, assists, chances with him off];
  `to[<teammate>]`: his assists to that teammate (both only teammates in props.py's `with`).
`daz[<abbr>]`: assisted makes against that defense by ASSIST_ZONES.
`dag[<abbr>]`: {game id: assisted makes against that defense by the shooter's position, POSITIONS order}.
`defpos[<abbr>][<pos>]`: what that defense allowed the position: [threes, mid-range, paint, free
  throw points, made shots, assisted makes, transition points, points, shots]; `deffga[<abbr>]`:
  every shot against it (the position's share of them).
`teams[<abbr>]` (on defense): [possessions vs bench units, points allowed,
  possessions vs starter units, points allowed].
`games[<game id>]`: [pace, total at tip, home spread at tip] (lines None
  until the game has one).
`spots[<game id>][<abbr>]`: that team's schedule spots that night (identity.py keys).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import identity
import possessions as P

FEED_TOP = 4
BENCH_UNIT = 2
CLOSE_Q4 = 10
EARLY_Q1, EARLY_H1 = 2, 3
MINUTES = 48
THREE_KINDS = ("catch", "pullup", "stepback", "trans", "second")
MISS_ZONES = ("rim", "short", "mid", "corner3", "above3", "ft")
ASSIST_ZONES = ("rim", "short", "mid", "corner3", "above3")
POSITIONS = ("PG", "SG", "SF", "PF", "C")
PULLUP = ("pullup", "fade")


def three_counts(g: pd.DataFrame) -> list:
    """[made, tried] by THREE_KINDS then every three, flat (12 ints), from shot actions carrying
    `three`, `made`, `kind2`, `early` and `second`."""
    t = g[g["three"].astype(bool)]
    made = t["made"].astype(bool)
    masks = (t["kind2"] == "catch", t["kind2"].isin(PULLUP), t["kind2"] == "stepback",
             t["early"].fillna(False).astype(bool), t["second"].astype(bool), pd.Series(True, index=t.index))
    out = []
    for m in masks:
        out += [int((m & made).sum()), int(m.sum())]
    return out


def zone_points(g: pd.DataFrame) -> list:
    """[points on threes, mid-range, in the paint (rim + short), free throws] from scoring actions."""
    made = g[(g["kind"] == "shot") & g["made"]]
    three = made["three"].astype(bool)
    return [int(made.loc[three, "pts"].sum()), int(made.loc[~three & (made["zone"] == "mid"), "pts"].sum()),
            int(made.loc[~three & made["zone"].isin(("rim", "short")), "pts"].sum()), int(g.loc[g["kind"] == "ft", "pts"].sum())]


def _starters(box: pd.DataFrame) -> dict:
    s = box[box["starter"].fillna(False).astype(bool) & box["athlete_id"].notna()]
    out = {}
    for gid, pid in zip(s["game_id"].astype(int), s["athlete_id"].astype(int)):
        out.setdefault(gid, set()).add(pid)
    return out


def block(engine: P.Season, box: pd.DataFrame, players: dict, lines: dict | None = None,
          schedule: pd.DataFrame | None = None) -> dict:
    poss = engine.possessions
    acts = engine.actions
    stints = engine.stints
    out = {"players": {}, "teams": {}, "games": {}, "spots": {}, "defpos": {}, "deffga": {}, "def3": {}, "rbt": {}, "mz": {}, "daz": {}, "dag": {}}
    if poss.empty:
        return out
    mine = lambda pid: out["players"].setdefault(str(int(pid)), {})  # noqa: E731
    starters = _starters(box)

    # each possession: transition, and how many of the defense's starters were on the floor
    poss = poss.copy()
    poss["fast"] = poss["start"].isin(("miss", "steal")) & (poss["first_secs"] <= identity.TRANSITION_SECS)
    dcols = [f"d{i}" for i in range(1, 6)]
    poss["d_st"] = [sum(int(p) in starters.get(int(g), ()) for p in ps if pd.notna(p))
                    for g, ps in zip(poss["game_id"], poss[dcols].itertuples(index=False, name=None))]
    poss["bench"] = poss["d_st"] <= BENCH_UNIT
    key = poss.set_index(["game_id", "n"])[["fast", "bench", "def", "t0"]]

    abbr = dict(zip(box["team_id"].astype(int), box["team_abbreviation"]))
    for team, g in poss.groupby("def"):
        b = g[g["bench"]]
        s = g[~g["bench"]]
        out["teams"][str(abbr.get(int(team), team))] = [len(b), int(b["pts"].sum()), len(s), int(s["pts"].sum())]

    # his possessions vs bench / starter units
    ocols = [f"o{i}" for i in range(1, 6)]
    on = poss[ocols + ["bench"]].melt(id_vars="bench", value_name="pid").dropna(subset=["pid"])
    counts = on.groupby(["pid", "bench"]).size()

    scoring = acts[acts["kind"].isin(("shot", "ft")) & acts["player"].notna() & acts["n"].notna()].copy()
    scoring["n"] = scoring["n"].astype(int)
    # second chance: a shot after his team's offensive rebound in the same possession
    orebs = acts[(acts["kind"] == "oreb") & acts["n"].notna()]
    first_oreb = orebs.assign(n=orebs["n"].astype(int)).groupby(["game_id", "n"])["t"].min()
    after = scoring.join(first_oreb.rename("oreb_t"), on=["game_id", "n"])["oreb_t"]
    scoring["second"] = after.notna() & (scoring["t"] > after)
    joined = scoring.join(key, on=["game_id", "n"])
    joined["early"] = joined["fast"].fillna(False).astype(bool) & ((joined["t"] - joined["t0"]) <= identity.TRANSITION_SECS)
    for pid, g in joined.groupby("player"):
        if str(int(pid)) not in players:
            continue
        p = mine(pid)
        total = int(g["pts"].sum())
        p["trans"] = [int(g.loc[g["fast"].fillna(False).astype(bool), "pts"].sum()), total]
        bench = g["bench"].fillna(False).astype(bool)
        p["units"] = [int(counts.get((pid, True), 0)), int(g.loc[bench, "pts"].sum()),
                      int(counts.get((pid, False), 0)), int(g.loc[~bench, "pts"].sum())]
        by_q = g[g["period"] <= 4].groupby("period")["pts"].sum()
        p["q"] = [int(by_q.get(q, 0)) for q in (1, 2, 3, 4)]
        p["pz"] = zone_points(g)
        shots = g[g["kind"] == "shot"]
        if shots["three"].astype(bool).any():
            p["t3"] = three_counts(shots)
            q3 = []
            for q in (1, 2, 3, 4):
                t = shots[(shots["period"] == q) & shots["three"].astype(bool)]
                q3 += [int(t["made"].astype(bool).sum()), len(t)]
            p["q3"] = q3
            # with / without each teammate (props.py `with`): his threes with him on the floor
            mates = (players.get(str(int(pid))) or {}).get("with") or {}
            if mates:
                t = shots[shots["three"].astype(bool)]
                tm, ta = int(t["made"].astype(bool).sum()), len(t)
                w3 = {}
                for mate in mates:
                    on = t["with"].map(lambda five, q=int(mate): q in {int(x) for x in five})
                    om, oa = int((on & t["made"].astype(bool)).sum()), int(on.sum())
                    w3[mate] = [om, oa, tm - om, ta - oa]
                p["w3"] = w3

    # what each defense allowed each position: points by zone, makes and assisted makes, transition
    # points, shots (and every position's shots, for the position's share)
    joined["pos"] = joined["player"].map(lambda q: (players.get(str(int(q))) or {}).get("pos") or "")
    joined["dabbr"] = joined["def"].map(lambda t: abbr.get(int(t), t) if pd.notna(t) else None)
    for (team, pos), g in joined[joined["dabbr"].notna() & (joined["pos"] != "")].groupby(["dabbr", "pos"]):
        shots = g[g["kind"] == "shot"]
        made = shots[shots["made"]]
        out["defpos"].setdefault(str(team), {})[pos] = zone_points(g) + [
            len(made), int(made["assist"].notna().sum()), int(g.loc[g["fast"].fillna(False).astype(bool), "pts"].sum()),
            int(g["pts"].sum()), len(shots)]
        three = g[(g["kind"] == "shot") & g["three"].astype(bool)]
        if len(three):
            out["def3"].setdefault(str(team), {})[pos] = three_counts(three)
    for team, g in joined[joined["dabbr"].notna() & (joined["kind"] == "shot")].groupby("dabbr"):
        out["deffga"][str(team)] = len(g)

    # who sets him up
    makes = acts[(acts["kind"] == "shot") & acts["made"] & acts["player"].notna()]
    for pid, g in makes.groupby("player"):
        if str(int(pid)) not in players:
            continue
        top = g["assist"].dropna().astype(int).value_counts().head(FEED_TOP)
        mine(pid)["feed"] = [len(g), [[str(a), int(n)] for a, n in top.items()]]
        threes = g[g["three"].astype(bool)]
        if len(threes):
            top3 = threes["assist"].dropna().astype(int).value_counts().head(FEED_TOP)
            mine(pid)["feed3"] = [len(threes), [[str(a), int(n)] for a, n in top3.items()]]

    # the rotation: on the floor at each game minute (its middle), and 4th-quarter minutes
    q4_start = poss[poss["period"] == 4].sort_values("t0").groupby("game_id").first()
    close = {int(g): abs(m) <= CLOSE_Q4 for g, m in zip(q4_start.index, q4_start["margin"])}
    mids = (np.arange(MINUTES) + 0.5) * 60
    on_min, q4_secs = {}, {}
    for st in stints.itertuples(index=False):
        hit = (mids >= st.t0) & (mids < st.t1)
        q4 = max(0.0, min(st.t1, 2880.0) - max(st.t0, 2160.0))
        for pid in st.five:
            pid = int(pid)
            row = on_min.setdefault(pid, {}).setdefault(int(st.game_id), np.zeros(MINUTES, dtype=bool))
            row |= hit
            q = q4_secs.setdefault(pid, {})
            q[int(st.game_id)] = q.get(int(st.game_id), 0.0) + q4
    first = box.drop_duplicates("game_id")
    when = dict(zip(first["game_id"].astype(int), pd.to_datetime(first["game_date"])))
    for pid, games in on_min.items():
        if str(pid) not in players:
            continue
        ids = sorted(games, key=lambda g: when.get(g, pd.Timestamp(0)))
        last5 = ids[-5:]
        p = mine(pid)
        p["rot"] = [int(sum(games[g][m] for g in ids)) for m in range(MINUTES)]
        p["rot5"] = [int(sum(games[g][m] for g in last5)) for m in range(MINUTES)]
        p["rot1"] = [int(v) for v in games[ids[-1]]]  # his last game, minute by minute
        p["rotn"] = [len(ids), len(last5)]
        cg = [g for g in ids if close.get(g)]
        og = [g for g in ids if g in close and not close[g]]
        secs = q4_secs.get(pid, {})
        p["q4"] = [len(cg), round(sum(secs.get(g, 0) for g in cg) / 60, 1),
                   len(og), round(sum(secs.get(g, 0) for g in og) / 60, 1)]

    rebounds_block(out, acts, stints, players, abbr)
    assists_block(out, joined, players)

    # early foul trouble
    fouls = acts[(acts["kind"] == "foul") & acts["player"].notna()]
    for pid, g in fouls.groupby("player"):
        if str(int(pid)) not in players:
            continue
        early = []
        for gid, f in g.groupby("game_id"):
            if (f["period"] == 1).sum() >= EARLY_Q1 or (f["period"] <= 2).sum() >= EARLY_H1:
                early.append(str(int(gid)))
        mine(pid)["foul"] = early

    # each game's pace (both teams' possessions over the game's length) and its line at tip
    ends = poss.assign(end=poss["t0"] + poss["secs"]).groupby("game_id")["end"].max().clip(lower=2880)
    per = poss.groupby("game_id").size() / 2
    lines = lines or {}
    for gid, n in per.items():
        total, spread = (lines.get(str(int(gid))) or [None, None])[:2]
        out["games"][str(int(gid))] = [round(float(n / ends[gid] * 2880), 1), total, spread]

    if schedule is not None:
        played = set(out["games"])
        for (gid, team), keys in identity.situation_tags(schedule).items():
            if str(gid) in played and keys:
                out["spots"].setdefault(str(gid), {})[team] = keys
    return out


# The books' main line for every player, every market, saved until tip:
# model_history/nba_lines/<season>.json {game id: {date, lines: {player id: [pts, 3pm, reb, ast]}}}.
LINE_MARKETS = ("points", "threes", "rebounds", "assists")


def line_record(record: dict, book_odds: dict, games: list, is_started, main_line) -> bool:
    """Writes tonight's untipped games' main lines into `record`; True when it changed."""
    changed = False
    for g in games:
        if is_started(g):
            continue
        props = ((book_odds or {}).get(f"{g['away']}_{g['home']}") or {}).get("props") or {}
        by = {}
        for i, m in enumerate(LINE_MARKETS):
            for pid, row in (props.get(m) or {}).items():
                line = main_line((row or {}).get("q"))
                if line is not None:
                    by.setdefault(str(pid), [None] * len(LINE_MARKETS))[i] = line
        if not by:
            continue
        entry = {"date": g["date"], "lines": by}
        if record.get(str(g["game_id"])) != entry:
            record[str(g["game_id"])] = entry
            changed = True
    return changed


def miss_sources(acts: pd.DataFrame) -> pd.DataFrame:
    """Every player rebound in the play-by-play with the miss it came off: `src` (MISS_ZONES) and
    `shooter` (the team that missed). Team rebounds are left out (the standard rebound-rate count)."""
    a = acts.reset_index(drop=True)
    shot = a["kind"] == "shot"
    tried = shot | (a["kind"] == "ft")
    made = a["made"].astype(bool)
    miss = tried & ~made
    zone = pd.Series(None, index=a.index, dtype=object)
    zone[shot & miss] = a.loc[shot & miss, "zone"]
    zone[(a["kind"] == "ft") & miss] = "ft"
    zone[tried & made] = "-"  # a make ends the trail
    team = pd.Series(np.nan, index=a.index)
    team[miss] = a.loc[miss, "team"]
    team[tried & made] = -1
    src = zone.groupby(a["game_id"]).ffill()
    who = team.groupby(a["game_id"]).ffill()
    reb = a["kind"].isin(("oreb", "dreb"))
    out = a[reb].copy()
    out["src"], out["shooter"] = src[reb], who[reb]
    out = out[out["src"].isin(MISS_ZONES) & out["shooter"].notna() & (out["shooter"] != -1)]
    return out[out["player"].notna()]


def rebounds_block(out: dict, acts: pd.DataFrame, stints: pd.DataFrame, players: dict, abbr: dict) -> None:
    """The Rebounds panel's numbers (see the module notes): `rb`, `rz`, `qr`, `rcg`, `wr` per player,
    `rbt` and `mz` per team."""
    rebs = miss_sources(acts)
    if rebs.empty:
        return
    secs = {}
    for st in stints.itertuples(index=False):
        for pid in st.five:
            secs[int(pid)] = secs.get(int(pid), 0.0) + (st.t1 - st.t0)
    # each rebound: the five of the team that missed (an offensive chance) and the other five (defensive)
    off_five, def_five = [], []
    for w, a, t, s in zip(rebs["with"], rebs["against"], rebs["team"], rebs["shooter"]):
        mine, other = {int(x) for x in w}, {int(x) for x in a}
        off_five.append(mine if t == s else other)
        def_five.append(other if t == s else mine)
    tally, zones, games = {}, {}, {}
    for kind, player, src, gid, off, dfn in zip(rebs["kind"], rebs["player"], rebs["src"], rebs["game_id"], off_five, def_five):
        for p in dfn:
            tally.setdefault(p, [0, 0, 0, 0])[0] += 1
        for p in off:
            tally.setdefault(p, [0, 0, 0, 0])[2] += 1
        for p in dfn | off:
            g = games.setdefault(p, {})
            g[int(gid)] = g.get(int(gid), 0) + 1
        if pd.notna(player):
            row = tally.setdefault(int(player), [0, 0, 0, 0])
            if kind == "dreb":
                row[1] += 1
                zones.setdefault(int(player), [0] * len(MISS_ZONES))[MISS_ZONES.index(src)] += 1
            else:
                row[3] += 1
    by_q = rebs[rebs["player"].notna() & (rebs["period"] <= 4)].groupby([rebs["player"].astype("Int64"), "period", "kind"]).size()
    grabbed = [int(p) if pd.notna(p) else None for p in rebs["player"]]
    floor = [d | o for d, o in zip(def_five, off_five)]
    for pid, row in tally.items():
        if str(pid) not in players:
            continue
        p = out["players"].setdefault(str(pid), {})
        p["rb"] = row + [round(secs.get(pid, 0.0))]
        p["rz"] = zones.get(pid, [0] * len(MISS_ZONES))
        qr = []
        for q in (1, 2, 3, 4):
            o = int(by_q.get((pid, q, "oreb"), 0))
            qr += [o + int(by_q.get((pid, q, "dreb"), 0)), o]
        p["qr"] = qr
        p["rcg"] = {str(g): n for g, n in games.get(pid, {}).items()}
        # with / without each teammate: his rebounds and the chances, with him on the floor and off
        mates = (players.get(str(pid)) or {}).get("with") or {}
        if mates:
            mine = [(g == pid, f) for g, f in zip(grabbed, floor) if pid in f]
            total_r, total_c = sum(g for g, _ in mine), len(mine)
            wr = {}
            for mate in mates:
                q = int(mate)
                r_on = c_on = 0
                for g, f in mine:
                    if q in f:
                        c_on += 1
                        r_on += g
                wr[mate] = [r_on, c_on, total_r - r_on, total_c - c_on]
            p["wr"] = wr
    # each team on the glass, and where it misses from
    shots = acts[acts["kind"] == "shot"]
    for t, g_ids in rebs.groupby("shooter")["game_id"].agg(lambda s: set(s)).items():
        t = int(t)
        mine = rebs[rebs["shooter"] == t]
        theirs = rebs[rebs["game_id"].isin(g_ids) & (rebs["shooter"] != t)]
        allowed = shots[shots["game_id"].isin(g_ids) & (shots["team"] != t)]
        key = str(abbr.get(t, t))
        out["rbt"][key] = [len(g_ids), len(mine), int(((mine["kind"] == "oreb") & (mine["team"] == t)).sum()),
                           len(theirs), int(((theirs["kind"] == "dreb") & (theirs["team"] == t)).sum()),
                           int(allowed["made"].astype(bool).sum()), len(allowed)]
        out["mz"][key] = [int((mine["src"] == z).sum()) for z in MISS_ZONES]


def assists_block(out: dict, joined: pd.DataFrame, players: dict) -> None:
    """The Assists panel's numbers (see the module notes): `ap`, `az`, `qa`, `acg`, `wa`, `to` per
    player, `daz` per defense. `joined` = the scoring actions with `early` and `dabbr` (block())."""
    made = joined[(joined["kind"] == "shot") & joined["made"].astype(bool) & joined["player"].notna()]
    if made.empty:
        return
    tally, zones, quarters, games, to = {}, {}, {}, {}, {}
    seen = {}  # pid: [(assisted it, the five)] for the with / without split
    for shooter, ast, zone, period, early, gid, five, d in zip(made["player"], made["assist"], made["zone"], made["period"],
                                                                made["early"].fillna(False).astype(bool), made["game_id"], made["with"], made["dabbr"]):
        shooter = int(shooter)
        passer = int(ast) if pd.notna(ast) else None
        floor = {int(x) for x in five}
        for p in floor:
            if p == shooter:
                continue
            row = tally.setdefault(p, [0, 0, 0])
            row[0] += 1
            g = games.setdefault(p, {}).setdefault(int(gid), [0] * 7)
            g[0] += 1
            seen.setdefault(p, []).append((passer == p, floor))
        if passer is None:
            continue
        row = tally.setdefault(passer, [0, 0, 0])
        row[1] += 1
        row[2] += int(early)
        g = games.setdefault(passer, {}).setdefault(int(gid), [0] * 7)
        g[1] += 1
        pos = (players.get(str(shooter)) or {}).get("pos")
        if pos in POSITIONS:
            g[2 + POSITIONS.index(pos)] += 1
            if d is not None and pd.notna(d):
                dg = out["dag"].setdefault(str(d), {}).setdefault(str(int(gid)), [0] * len(POSITIONS))
                dg[POSITIONS.index(pos)] += 1
        if zone in ASSIST_ZONES:
            zones.setdefault(passer, [0] * len(ASSIST_ZONES))[ASSIST_ZONES.index(zone)] += 1
            if d is not None and pd.notna(d):
                out["daz"].setdefault(str(d), [0] * len(ASSIST_ZONES))[ASSIST_ZONES.index(zone)] += 1
        if period <= 4:
            quarters.setdefault(passer, [0, 0, 0, 0])[int(period) - 1] += 1
        t = to.setdefault(passer, {})
        t[str(shooter)] = t.get(str(shooter), 0) + 1
    for pid, row in tally.items():
        if str(pid) not in players:
            continue
        p = out["players"].setdefault(str(pid), {})
        p["ap"] = row
        p["az"] = zones.get(pid, [0] * len(ASSIST_ZONES))
        p["qa"] = quarters.get(pid, [0, 0, 0, 0])
        p["acg"] = {str(g): v for g, v in games.get(pid, {}).items()}
        mates = (players.get(str(pid)) or {}).get("with") or {}
        if mates:
            mine = seen.get(pid, [])
            total_a, total_c = sum(a for a, _ in mine), len(mine)
            wa = {}
            for mate in mates:
                q = int(mate)
                a_on = c_on = 0
                for a, f in mine:
                    if q in f:
                        c_on += 1
                        a_on += a
                wa[mate] = [a_on, c_on, total_a - a_on, total_c - c_on]
            p["wa"] = wa
            p["to"] = {m: n for m, n in to.get(pid, {}).items() if m in mates}
