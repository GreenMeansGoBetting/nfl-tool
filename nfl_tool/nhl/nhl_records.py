"""Graded records every NHL prop page shares: each play's factor values, the
ledger the YTD tracker reads, and the past days' files.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
from nhl_games import AREAS


def factor_values(row: dict, names: tuple, average) -> list:
    """The parts behind a Shots or Goals row's number, in `names` order
    (SHOTS_FACTORS / GOALS_FACTORS). `average` = his season number a game,
    for `vs_avg`. A row locked before a part was kept has None for it."""
    lift, shares = row.get("lift") or {}, row.get("shares") or {}
    mean = row.get("mean")
    value = {**{k: row.get(k) for k in names}, "home": int(bool(row.get("home"))),
             "vs_avg": round(mean - average, 3) if mean is not None and average is not None else None,
             "zone": (row.get("zone") or {}).get("area"),
             **{f"s_{area}": shares.get(area) for area in AREAS}, **{f"l_{k}": v for k, v in lift.items()}}
    return [value.get(k) for k in names]


def record_ledger(plays: list) -> list:
    """Every graded play that declared an edge, the whole season, as short rows
    `[date, edge, won (1/0), units]`, oldest first: what Best Plays' record popup
    filters by days back and minimum edge (the owner, 2026-10-16: "how are SOG
    Best plays with a 10% edge doing in the last 15 days"). `plays` keeps only
    the latest days, with every detail; this keeps every day, with only these.
    A fifth column, the play's tags (side, bucket, with / against his average,
    Zone Match, thin), feeds the split tiles of the shared YTD tracker (site
    ytd.js: the same filters and sliders on every page, 2026-10-22)."""
    def tags(p: dict) -> list:
        out = [t for t in (p.get("side"), p.get("size")) if t]
        if "fade" in p:
            out.append("fade" if p["fade"] else "with")
        out += [t for t in ("zone", "thin") if p.get(t)]
        return out
    return [[p["date"], p["edge"], int(p["won"]), p["units"], tags(p)] for p in sorted(plays, key=lambda p: (p["date"], -p["edge"]))]
