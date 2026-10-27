"""Zone Matchup Targets (site/nba/zones.html): where each player's shots come
from against where tonight's defense gives them up (the owner, 2026-10-27).

The idea, in the owner's words: Vegas is perfect except for one gap, shot
zone. Sabonis takes 24 of his 26 shots in the paint; Duncan Robinson 28 of 34
from three, mostly the top and the right. So: where (and how: self-created,
catch and shoot, drive) does HE shoot, and what does tonight's defense allow
to players like him (guards / forwards / bigs: a team can wall off bigs at the
rim and still bleed blow-by layups to guards) from those same spots, in shots
and in makes?

**Raw numbers, no pulling toward the league** (the owner: "We have to stop
taking data and drawing it to the average or setting minimums because then we
just are recreating the sportsbooks numbers"); every read carries its shot
counts, and the user judges the sample. **Never priced:** no edge, no EV; the
main line is shown for reference and grades the record.

For a player, one market (points: every shot; threes: his threes):
- `s[z]` = his share of shots in each of the 12 zones (shot-chart.js
  nbaShotZone), `t[k]` = his share by kind (1 self-created, 2 catch and shoot,
  3 drive / cut / finish).
- Makes: the make rate this defense allows his group in each zone, minus the
  league's for his group there, x the shot's points, weighted by s; the same by
  kind, weighted by t; the two averaged (the same shots, two ways of cutting
  them), as a share of the points a shot his diet is worth at league rates.
- Shots: the share of his group's shots this defense gives up in each zone
  over the league's share for his group there, weighted by s (more shots from
  his spots = more chances).
- Score = (1 + shots) x (1 + makes) - 1: a defense that gives up lots of his
  shots but makes few of them lands near Toss Up, which the owner chose over
  deciding it for the user.
- Read: OVER / UNDER past `LEAN` (Strong past `STRONG`), Toss Up between.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

LEAN = 0.05
STRONG = 0.12
MARKETS = ("points", "threes")
GROUP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}
THREES = ("c3L", "c3R", "w3L", "w3R", "t3")
ZONE_NAMES = {"ra": "At The Rim", "paint": "Paint", "mBL": "Left Baseline Mid", "mWL": "Left Wing Mid", "mT": "Top Mid",
              "mWR": "Right Wing Mid", "mBR": "Right Baseline Mid", "c3L": "Left Corner 3", "w3L": "Left Wing 3",
              "t3": "Top 3", "w3R": "Right Wing 3", "c3R": "Right Corner 3"}
KINDS = {1: "Self-Created", 2: "Catch & Shoot", 3: "Drives & Cuts"}


def zone(x: float, y: float, three: int) -> str:
    """shot-chart.js nbaShotZone, to the letter (a test pins both)."""
    dx = x - 25
    deg = math.degrees(math.atan2(max(y, 0), dx))
    if three:
        if abs(dx) >= 22 and y <= 9:
            return "c3R" if dx > 0 else "c3L"
        return "w3R" if deg < 60 else "t3" if deg < 120 else "w3L"
    if math.hypot(dx, y) <= 4:
        return "ra"
    if abs(dx) <= 8 and y <= 13.75:
        return "paint"
    return ["mBR", "mWR", "mT", "mWL", "mBL"][min(int(deg // 36), 4)]


def group_of(pos) -> str:
    return GROUP.get(str(pos or "").upper(), "F")


def main_line(quotes: list):
    """The line most books hang, ties to the lower one: the player card's rule (nba-card.js
    nbaCardMainLine), so the page, the card and the record agree (the owner, 2026-10-27: Walsh's
    1.5 threes here, no line on his card)."""
    count = {}
    for q in quotes or []:
        if len(q) > 2 and q[2] is not None:
            count[float(q[2])] = count.get(float(q[2]), 0) + 1
    return min(count, key=lambda line: (-count[line], line)) if count else None


class Tally:
    """[made, tried] by zone and by kind, and the shot total, for a set of shots."""

    def __init__(self):
        self.zone, self.kind, self.n = {}, {}, 0

    def add(self, z, k, made):
        for table, key in ((self.zone, z), (self.kind, k)):
            t = table.setdefault(key, [0, 0])
            t[0] += made
            t[1] += 1
        self.n += 1


def tallies(block: dict, pos: dict) -> tuple:
    """({(defense, group, scope): Tally}, {(group, scope): Tally}) over every
    shot this season; scope "all" or "3" (threes only)."""
    teams = block.get("teams") or []
    allowed, league = {}, {}
    for pid, shots in (block.get("players") or {}).items():
        g = group_of(pos.get(str(pid)))
        for s in shots:
            z, made, three, kind, d = zone(s[0], s[1], s[3]), s[2], s[3], s[6], s[8] if len(s) > 8 else -1
            for scope in ("all", "3") if three else ("all",):
                league.setdefault((g, scope), Tally()).add(z, kind, made)
                if 0 <= d < len(teams):
                    allowed.setdefault((teams[d], g, scope), Tally()).add(z, kind, made)
    return allowed, league


def rate(t) -> float | None:
    return t[0] / t[1] if t and t[1] else None


def read(shots: list, market: str, d: Tally | None, lg: Tally | None, d_all: Tally | None, lg_all: Tally | None) -> dict | None:
    """One player's read in one market (see the module note), or None with no shots."""
    mine = [s for s in shots if market == "points" or s[3]]
    if not mine or lg is None:
        return None
    n = len(mine)
    zs, ks, value = {}, {}, {}
    for s in mine:
        z = zone(s[0], s[1], s[3])
        zs[z] = zs.get(z, 0) + 1
        ks[s[6]] = ks.get(s[6], 0) + 1
        value.setdefault(s[6], []).append(3 if s[3] else 2)
    d = d or Tally()
    d_all = d_all or Tally()
    base = make_z = shots_ = 0.0
    zones = []
    for z, c in sorted(zs.items(), key=lambda kv: -kv[1]):
        share, pts = c / n, 3 if z in THREES else 2
        lr = rate(lg.zone.get(z))
        dr = rate(d.zone.get(z))
        if lr is not None:
            base += share * pts * lr
            if dr is not None:
                make_z += share * pts * (dr - lr)
        # the share of his group's shots this defense gives up here, against the league's share
        lq = (lg_all.zone.get(z, [0, 0])[1] / lg_all.n) if lg_all and lg_all.n else 0
        dq = (d_all.zone.get(z, [0, 0])[1] / d_all.n) if d_all.n else None
        vol = dq / lq - 1 if dq is not None and lq else None
        if vol is not None:
            shots_ += share * vol
        zones.append({"z": z, "n": c, "share": round(share, 3), "dmade": (d.zone.get(z) or [0, 0])[0], "dtried": (d.zone.get(z) or [0, 0])[1],
                      "fg": None if dr is None or lr is None else round(dr - lr, 3), "vol": None if vol is None else round(vol, 3),
                      "lg": None if lr is None else round(lr, 3)})
    make_k, kinds = 0.0, []
    counted = sum(c for k, c in ks.items() if k in KINDS)
    for k, c in sorted(ks.items(), key=lambda kv: -kv[1]):
        if k not in KINDS:
            continue
        share, pts = c / counted, sum(value[k]) / len(value[k])
        lr, dr = rate(lg.kind.get(k)), rate(d.kind.get(k))
        if lr is not None and dr is not None:
            make_k += share * pts * (dr - lr)
        kinds.append({"k": k, "n": c, "share": round(c / n, 3), "dmade": (d.kind.get(k) or [0, 0])[0], "dtried": (d.kind.get(k) or [0, 0])[1],
                      "fg": None if dr is None or lr is None else round(dr - lr, 3), "lg": None if lr is None else round(lr, 3)})
    makes = ((make_z + make_k) / 2) / base if base else 0.0
    score = (1 + shots_) * (1 + makes) - 1
    side = "over" if score >= LEAN else "under" if score <= -LEAN else "toss"
    return {"score": round(score, 4), "makes": round(makes, 4), "shots": round(shots_, 4), "side": side,
            "strong": abs(score) >= STRONG, "n": n, "dn": d.n, "zones": zones, "kinds": kinds}


def slate_date(games: list, today: str) -> str | None:
    days = sorted({g["date"] for g in games if g.get("date", "") >= today})
    return days[0] if days else None


def block(shots_block: dict | None, pos: dict, games: list, book_odds: dict, today: str, now_iso: str) -> dict | None:
    """shots.json `matchups`: {date, games: [{game_id, away, home, started}], players: {id: {name,
    team, opp, game_id, group, points / threes: read + line}}, defense: {team: {group: {zone: [made,
    tried, rank by make rate allowed (1 = least), rank by shot share allowed (1 = fewest)]}}}}."""
    if not shots_block or not shots_block.get("players"):
        return None
    date = slate_date(games, today)
    if not date:
        return None
    allowed, league = tallies(shots_block, pos)
    who = shots_block.get("who") or {}
    tonight = [g for g in games if g.get("date") == date]
    out_games, players = [], {}
    for g in tonight:
        key = f"{g['away']}_{g['home']}"
        props = (book_odds.get(key) or {}).get("props") or {}
        out_games.append({"game_id": g["game_id"], "away": g["away"], "home": g["home"], "time": g.get("time"),
                          "started": bool(g.get("start_utc")) and g["start_utc"] <= now_iso})
        ids = {pid for m in MARKETS for pid in (props.get(m) or {})}
        for pid in ids:
            shots = (shots_block["players"] or {}).get(str(pid))
            if not shots or str(pid) not in who:
                continue
            team = who[str(pid)][1]
            opp = g["home"] if team == g["away"] else g["away"] if team == g["home"] else None
            if not opp:
                continue
            grp = group_of(pos.get(str(pid)))
            row = {"name": who[str(pid)][0], "team": team, "opp": opp, "game_id": g["game_id"], "group": grp,
                   "pos": pos.get(str(pid))}
            for m in MARKETS:
                q = ((props.get(m) or {}).get(pid) or {}).get("q")
                scope = "3" if m == "threes" else "all"
                r = read(shots, m, allowed.get((opp, grp, scope)), league.get((grp, scope)),
                         allowed.get((opp, grp, "all")), league.get((grp, "all"))) if q else None
                if r:
                    r["line"] = main_line(q)
                    row[m] = r
            if any(m in row for m in MARKETS):
                players[str(pid)] = row
    # each defense, each group: its make rate and shot share allowed by zone, ranked across the league
    defense = {}
    teams = sorted({t for (t, _, scope) in allowed if scope == "all"})
    for grp in ("G", "F", "C"):
        for z in ZONE_NAMES:
            rows = []
            for t in teams:
                tl = allowed.get((t, grp, "all"))
                c = (tl.zone.get(z) if tl else None) or [0, 0]
                rows.append((t, c[0], c[1], c[1] / tl.n if tl and tl.n else 0))
            by_rate = sorted([r for r in rows if r[2]], key=lambda r: r[1] / r[2])
            by_share = sorted(rows, key=lambda r: r[3])
            rr = {r[0]: i + 1 for i, r in enumerate(by_rate)}
            rs = {r[0]: i + 1 for i, r in enumerate(by_share)}
            for t, m, a, _ in rows:
                defense.setdefault(t, {}).setdefault(grp, {})[z] = [m, a, rr.get(t), rs.get(t)]
    lg = {grp: {z: (league.get((grp, "all")) or Tally()).zone.get(z, [0, 0]) for z in ZONE_NAMES} for grp in ("G", "F", "C")}
    lg_n = {grp: (league.get((grp, "all")) or Tally()).n for grp in ("G", "F", "C")}
    return {"date": date, "games": out_games, "players": players, "defense": defense, "league": lg, "league_n": lg_n,
            "grid": grid(shots_block, pos),
            "pos": {str(k): group_of(v) for k, v in pos.items() if str(k) in (shots_block.get("players") or {})},
            "lean": LEAN, "strong": STRONG}


# ---- the record (the owner, 2026-10-27: "grade based on score buckets") ----
# model_history/nba_zones/<season>.json {game id: {date, points: [read], threes: [read]}}: each
# game's OVER / UNDER reads as the last build before tip had them (a started game is never
# rewritten; Toss Ups aren't saved). Graded against his main line at the time (never a price:
# units are None, the tracker shows the win % alone), split Strong / Lean and Over / Under.
RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_zones"
READ_FIELDS = ("pid", "name", "team", "opp", "score", "side", "strong", "line")


def update_record(season: int, matchups: dict | None, path: Path | None = None) -> dict:
    path = path or RECORD_DIR / f"{season}.json"
    record = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if not matchups:
        return record
    for g in matchups.get("games") or []:
        if g.get("started"):
            continue
        entry = {"date": matchups["date"]}
        for m in MARKETS:
            entry[m] = [[pid, p["name"], p["team"], p["opp"], p[m]["score"], p[m]["side"], p[m]["strong"], p[m]["line"]]
                        for pid, p in sorted(matchups["players"].items())
                        if p["game_id"] == g["game_id"] and m in p and p[m]["side"] != "toss" and p[m].get("line") is not None]
        record[str(g["game_id"])] = entry
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1, sort_keys=True), encoding="utf-8")
    return record


def box_logs(box) -> dict:
    """{market: {(game id, player id): the stat}} for players who played, from the box scores."""
    out = {m: {} for m in MARKETS}
    if box is None or box.empty:
        return out
    played = box[box["minutes"].fillna(0).astype(float) > 0]
    for r in played[["game_id", "athlete_id", "points", "three_point_field_goals_made"]].dropna().itertuples(index=False):
        key = (str(int(r.game_id)), str(int(r.athlete_id)))
        out["points"][key] = float(r.points)
        out["threes"][key] = float(r.three_point_field_goals_made)
    return out


def ledger(record: dict, logs: dict, market: str) -> list:
    """The shared YTD tracker's rows (ytd.js): [date, |score|, won 1/0, None, [strong | lean, over | under]];
    a push or a player who sat isn't graded."""
    out = []
    for gid, g in record.items():
        for row in g.get(market) or []:
            p = dict(zip(READ_FIELDS, row))
            got = logs.get((str(gid), str(p["pid"])))
            if got is None or p["line"] is None or got == p["line"]:
                continue
            over = p["side"] == "over"
            out.append([g["date"], round(abs(p["score"]), 4), int((got > p["line"]) == over), None,
                        ["strong" if p["strong"] else "lean", "over" if over else "under"]])
    return sorted(out, key=lambda r: (r[0], -r[1]))


# ---- the defense grid (Matchup View; the owner, 2026-10-27: "a color coded layout/chart where i can
# know 'this is BOS weakness vs this position'") ----
# Each defense x the five positions x where / how they shoot, changing with the market. A cell:
# [made, tried, share, rank by make rate, rank by share, rank by points a shot]; ranks of the 30,
# 30 = gives up the most (None when the defense hasn't faced that shot). "all" = every shot in the
# market (share = that position's share of all the shots this defense allows). Raw, like the page.
POSITIONS = ("PG", "SG", "SF", "PF", "C")
GRID_COLS = {
    "points": [("rim", "Rim", ("ra",), None), ("paint", "Paint", ("paint",), None),
               ("mid", "Mid", ("mBL", "mWL", "mT", "mWR", "mBR"), None), ("c3", "Corner 3", ("c3L", "c3R"), None),
               ("ab3", "Above-Break 3", ("w3L", "t3", "w3R"), None), ("self", "Self-Created", None, 1),
               ("catch", "Catch & Shoot", None, 2), ("drive", "Drives", None, 3)],
    "threes": [("c3L", "Left Corner", ("c3L",), None), ("c3R", "Right Corner", ("c3R",), None),
               ("w3L", "Left Wing", ("w3L",), None), ("t3", "Top", ("t3",), None), ("w3R", "Right Wing", ("w3R",), None),
               ("catch", "Catch & Shoot", None, 2), ("self", "Self-Created", None, 1)],
}


def grid(block: dict, pos: dict) -> dict:
    teams = block.get("teams") or []
    # cells[(team | None for the league, market, position, col)] = [made, tried, points]
    cells, totals = {}, {}
    for pid, shots in (block.get("players") or {}).items():
        p = str(pos.get(str(pid)) or "").upper()
        if p not in POSITIONS:
            continue
        for s in shots:
            d = s[8] if len(s) > 8 else -1
            team = teams[d] if 0 <= d < len(teams) else None
            z, made, three, kind = zone(s[0], s[1], s[3]), s[2], s[3], s[6]
            pts = made * (3 if three else 2)
            for market, cols in GRID_COLS.items():
                if market == "threes" and not three:
                    continue
                for who in {team, None}:
                    totals[(who, market)] = totals.get((who, market), 0) + 1
                    keys = ["all"] + [k for k, _, zs, kd in cols if (zs and z in zs) or (kd is not None and kd == kind)]
                    for k in keys:
                        c = cells.setdefault((who, market, p, k), [0, 0, 0])
                        c[0] += made
                        c[1] += 1
                        c[2] += pts
    real = sorted({t for (t, *_ ) in cells if t})
    out = {"cols": {m: [[k, label] for k, label, *_ in cols] for m, cols in GRID_COLS.items()}, "teams": {}, "league": {}}

    def share(who, market, p, k):
        c = cells.get((who, market, p, k))
        if not c:
            return 0.0
        base = totals.get((who, market), 0) if k == "all" else (cells.get((who, market, p, "all")) or [0, 1])[1]
        return c[1] / base if base else 0.0

    for market, cols in GRID_COLS.items():
        for p in POSITIONS:
            for k in ["all"] + [c[0] for c in cols]:
                lc = cells.get((None, market, p, k)) or [0, 0, 0]
                out["league"].setdefault(market, {}).setdefault(p, {})[k] = [lc[0], lc[1], round(share(None, market, p, k), 3)]
                rows = []
                for t in real:
                    c = cells.get((t, market, p, k)) or [0, 0, 0]
                    rows.append((t, c, share(t, market, p, k)))
                faced = [r for r in rows if r[1][1]]
                rank = lambda key, pool: {r[0]: i + 1 for i, r in enumerate(sorted(pool, key=key))}  # noqa: E731
                by_make = rank(lambda r: r[1][0] / r[1][1], faced)
                by_share = rank(lambda r: r[2], rows)
                by_pps = rank(lambda r: r[1][2] / r[1][1], faced)
                for t, c, sh in rows:
                    out["teams"].setdefault(t, {}).setdefault(market, {}).setdefault(p, {})[k] = [
                        c[0], c[1], round(sh, 3), by_make.get(t), by_share.get(t), by_pps.get(t)]
    return out
