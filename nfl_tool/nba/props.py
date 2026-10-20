"""NBA player props data (site/nba/props.json): what the Points page (and
later Rebounds / Assists / 3s) shows, all pure data, no projection.

Per season (`seasons[<year>]`):
- `players[<espn id>]`: name, team (today's roster team for a past season),
  position, and
  - `log`: one row a game, `LOG_FIELDS` order (date, game id, opponent,
    home 1/0, starter 1/0, minutes, points, shots, 3s made, 3s tried, free
    throws tried);
  - `share`: his share of his team's shots while he's on the floor;
  - `zones` / `kinds`: where his shots come from (rim, short, mid, corner3,
    above3) and how they're made (self = pull-up / step-back / fade, catch,
    drive, other); `assisted`: share of his makes assisted;
  - `with[<teammate id>]`: [minutes with him on the floor, points then,
    shots then, minutes with him OFF the floor, points then, shots then],
    for the "off the floor" filter.
- `out[<team>][<game id>]`: teammates who didn't play, [id, why]: "rest",
  "injury" or "coach" (from the box score's DNP reason).

A finished season never changes, so 2025-26 is saved once in
props_2026.json (rebuilding it would add over a minute to every deploy);
re-save after changing a formula:
    py nfl_tool/nba/props.py --season 2026 --data-dir data/nba --write
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

import possessions as P

LOG_FIELDS = ["date", "game", "opp", "home", "start", "min", "pts", "fga", "fg3m", "fg3a", "fta"]
SELF_MADE = ("pullup", "stepback", "fade")
REST_WORDS = ("REST", "LOAD", "MANAGEMENT")
MIN_TOGETHER = 20  # minutes on the floor together before a teammate gets a with / without row
REFERENCE = Path(__file__).parent / "props_{season}.json"


def why_out(reason) -> str:
    text = str(reason or "").upper()
    if "COACH" in text:
        return "coach"
    if any(w in text for w in REST_WORDS):
        return "rest"
    return "injury"


def r3(v):
    return None if v is None or pd.isna(v) else round(float(v), 3)


def season_block(pbp: pd.DataFrame, box: pd.DataFrame, label: str) -> dict | None:
    season = P.Season(pbp, box)
    if season.possessions.empty:
        return None
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    games = set(season.possessions["game_id"].unique())
    reg = reg[reg["game_id"].isin(games)]
    abbr = dict(zip(reg["team_id"].astype(int), reg["team_abbreviation"]))
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    played = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)]

    players = {}
    for pid, rows in played.sort_values("date").groupby("athlete_id"):
        last = rows.iloc[-1]
        players[str(int(pid))] = {
            "name": last["athlete_display_name"], "team": last["team_abbreviation"],
            "pos": last.get("athlete_position_abbreviation") or "",
            "log": [[r.date, int(r.game_id), r.opponent_team_abbreviation, int(r.home_away == "home"), int(bool(r.starter)),
                     int(round(r.minutes or 0)), int(r.points or 0), int(r.field_goals_attempted or 0),
                     int(r.three_point_field_goals_made or 0), int(r.three_point_field_goals_attempted or 0),
                     int(r.free_throws_attempted or 0)] for r in rows.itertuples(index=False)],
        }

    acts = season.actions
    shots = acts[acts["kind"] == "shot"]
    # his share of his team's shots while he's on the floor
    team_shots_on = {}
    for five in shots["with"]:
        for p in five:
            team_shots_on[p] = team_shots_on.get(p, 0) + 1
    own = shots.groupby("player")
    for pid, g in own:
        p = players.get(str(int(pid)))
        if p is None:
            continue
        n = len(g)
        p["share"] = r3(n / team_shots_on[pid]) if team_shots_on.get(pid) else None
        p["zones"] = {z: r3((g["zone"] == z).mean()) for z in ("rim", "short", "mid", "corner3", "above3")}
        kinds = g["kind2"]
        p["kinds"] = {"self": r3(kinds.isin(SELF_MADE).mean()), "catch": r3((kinds == "catch").mean()),
                      "drive": r3(kinds.isin(("drive", "cut", "floater", "lob", "putback")).mean()),
                      "other": r3(kinds.isin(("post", "other")).mean())}
        makes = g[g["made"]]
        p["assisted"] = r3(makes["assist"].notna().mean()) if len(makes) else None

    # with / without each teammate on the floor: minutes from the stints,
    # points and shots from his own actions (who was on the floor at the time)
    mins, mins_with = {}, {}
    for st in season.stints.itertuples(index=False):
        secs = st.t1 - st.t0
        for p in st.five:
            mins[p] = mins.get(p, 0.0) + secs
            row = mins_with.setdefault(p, {})
            for q in st.five:
                if q != p:
                    row[q] = row.get(q, 0.0) + secs
    pts, pts_with, fga, fga_with = {}, {}, {}, {}
    scoring = acts[acts["kind"].isin(("shot", "ft")) & acts["player"].notna()]
    for player, kind, got, five in zip(scoring["player"], scoring["kind"], scoring["pts"], scoring["with"]):
        p = int(player)
        pts[p] = pts.get(p, 0) + got
        is_shot = int(kind == "shot")
        fga[p] = fga.get(p, 0) + is_shot
        pw, fw = pts_with.setdefault(p, {}), fga_with.setdefault(p, {})
        for q in five:
            if q != p:
                pw[q] = pw.get(q, 0) + got
                fw[q] = fw.get(q, 0) + is_shot
    for pid, row in mins_with.items():
        p = players.get(str(int(pid)))
        if p is None:
            continue
        total_m, total_p, total_f = mins.get(pid, 0) / 60, pts.get(pid, 0), fga.get(pid, 0)
        out = {}
        for q, secs in row.items():
            if secs < 60 * MIN_TOGETHER:
                continue
            m_on = secs / 60
            p_on = pts_with.get(pid, {}).get(q, 0)
            f_on = fga_with.get(pid, {}).get(q, 0)
            out[str(int(q))] = [round(m_on, 1), p_on, f_on, round(total_m - m_on, 1), total_p - p_on, total_f - f_on]
        p["with"] = out

    out_by_team = {}
    dnp = reg[reg["did_not_play"].astype(bool)]
    for r in dnp.itertuples(index=False):
        out_by_team.setdefault(abbr.get(int(r.team_id), str(r.team_id)), {}).setdefault(str(int(r.game_id)), []).append(
            [str(int(r.athlete_id)), why_out(r.reason)])
    return {"label": label, "fields": LOG_FIELDS, "players": players, "out": out_by_team}


# ---- the points projection: the line, moved toward our number ----
# The owner, 2026-10-20: "I would like projections to start day one - even if
# its weighing heavily towards the line. I want the framework in." So the
# projection starts AT the line (no games = the line) and moves toward ours as
# this season's games come in: weight = PROJ_MAX x games / (games + PROJ_K).
# Ours: expected minutes (last 5) x points a minute (season), then each factor
# the 2025-26 replay kept (tools/backtest/nba_points.py), at its weight: the
# game's pace, what the other defense allows a possession, its transition
# share allowed (each against the league, this season), and teammates listed
# Out (their shot share); the base's own 3% lean is taken off. Zone fit, free
# throws and turnovers forced added nothing in the replay: tags only.
# PROJ_MAX stays at half until a replay on this season's saved tip-off lines
# says ours deserves more (or less).
PROJ_K = 10
PROJ_MAX = 0.5
PROJ_LAST = 5
W_PACE = 0.9
W_DEF = 0.35
W_TRANS = 0.15
W_OUT = 0.5
LEAN = -0.03


def our_points(log: list, fields: list, team: dict | None, opp: dict | None, league: dict | None, out_share: float = 0.0):
    """(our points number, expected minutes, points a minute), or Nones
    before he has played this season. out_share: the season shot share of
    rotation teammates listed Out tonight."""
    if not log:
        return None, None, None
    i_min, i_pts = fields.index("min"), fields.index("pts")
    total_min = sum(r[i_min] for r in log)
    if total_min <= 0:
        return None, None, None
    ppm = sum(r[i_pts] for r in log) / total_min
    recent = log[-PROJ_LAST:]
    minutes = sum(r[i_min] for r in recent) / len(recent)
    pace_f = def_f = trans_f = 1.0
    if team and opp and league:
        lg_pace = (league.get("off_pace") or {}).get("avg")
        lg_ppp = (league.get("def_ppp") or {}).get("avg")
        lg_trans = (league.get("def_trans_freq") or {}).get("avg")
        if lg_pace and team.get("off_pace") and opp.get("off_pace"):
            pace_f = (team["off_pace"] + opp["off_pace"]) / 2 / lg_pace
        if lg_ppp and opp.get("def_ppp"):
            def_f = opp["def_ppp"] / lg_ppp
        if lg_trans and opp.get("def_trans_freq"):
            trans_f = opp["def_trans_freq"] / lg_trans
    ours = (minutes * ppm * (1 + LEAN) * pace_f ** W_PACE * def_f ** W_DEF * trans_f ** W_TRANS
            * (1 + W_OUT * out_share))
    return ours, minutes, ppm


def project_points(line, games: int, ours):
    """(projection, weight on ours): the line, moved toward ours by weight."""
    if line is None:
        return None, 0.0
    if ours is None or games <= 0:
        return float(line), 0.0
    w = PROJ_MAX * games / (games + PROJ_K)
    return line + w * (ours - line), w


def on_rosters(block: dict, roster_team: dict) -> dict:
    """A past season's players on the team today's roster lists them with;
    anyone on no roster is left out (the same rule as King of the Court)."""
    players = {pid: {**p, "team": roster_team[pid]} for pid, p in block["players"].items() if pid in roster_team}
    return {**block, "players": players}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--label", default="2025-26")
    ap.add_argument("--player", default="Payton Pritchard")
    ap.add_argument("--write", action="store_true", help="save the finished season as nfl_tool/nba/props_<season>.json")
    args = ap.parse_args()
    d = Path(args.data_dir)
    block = season_block(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"),
                         pd.read_parquet(d / f"player_box_{args.season}.parquet"), args.label)
    if args.write:
        out = Path(str(REFERENCE).format(season=args.season))
        out.write_text(json.dumps(block, separators=(",", ":")), encoding="utf-8")
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    for pid, p in block["players"].items():
        if p["name"] == args.player:
            print(pid, p["name"], p["team"], len(p["log"]), "games; share", p.get("share"), p.get("kinds"), p.get("assisted"))
            names = {k: v["name"] for k, v in block["players"].items()}
            for q, w in sorted(p.get("with", {}).items(), key=lambda kv: -kv[1][0])[:5]:
                print(f"  with {names.get(q, q):24} on {w[0]:6.0f} min {w[1] / max(w[0], 1) * 36:5.1f} pts/36 | off {w[3]:6.0f} min {w[4] / max(w[3], 1) * 36:5.1f} pts/36")


if __name__ == "__main__":
    main()
