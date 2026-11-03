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
    out = {"players": {}, "teams": {}, "games": {}, "spots": {}, "defpos": {}, "deffga": {}}
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
    key = poss.set_index(["game_id", "n"])[["fast", "bench", "def"]]

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
    joined = scoring.join(key, on=["game_id", "n"])
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
    for team, g in joined[joined["dabbr"].notna() & (joined["kind"] == "shot")].groupby("dabbr"):
        out["deffga"][str(team)] = len(g)

    # who sets him up
    makes = acts[(acts["kind"] == "shot") & acts["made"] & acts["player"].notna()]
    for pid, g in makes.groupby("player"):
        if str(int(pid)) not in players:
            continue
        top = g["assist"].dropna().astype(int).value_counts().head(FEED_TOP)
        mine(pid)["feed"] = [len(g), [[str(a), int(n)] for a, n in top.items()]]

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
