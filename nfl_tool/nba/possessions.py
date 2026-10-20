"""The NBA engine: every game's play-by-play rebuilt into possessions, with
the ten players on the floor for each one.

Every NBA tool reads this instead of the raw play-by-play: pace, possession
length, transition, shot diet (offense and allowed), turnovers made and
forced, rotations, lineups, with / without, who shoots more when, blowouts.

    py nfl_tool/nba/possessions.py --season 2026 --data-dir data/nba   # check a season

Three tables (pandas DataFrames), one season at a time:

- possessions: one row a possession. Offense / defense team, the 5 on the
  floor for each (`o1`..`o5`, `d1`..`d5`, ESPN athlete ids, at the start),
  how it started (`start`: make, miss, steal, dead_to, period, other), when
  (`t0`, seconds into the game), how long (`secs`), the score margin for the
  offense at the start, points, shots, free throws, turnovers, offensive
  rebounds, and the seconds to its first shot or turnover (`first_secs`).
- actions: one row a shot, free throw, turnover, rebound or foul, with the
  player, his team, the possession it belongs to and both lineups at that
  moment. Shots carry distance, zone (rim, short, mid, corner3, above3),
  how they were made (`kind`: catch, pullup, stepback, fade, drive, cut,
  post, floater, putback, lob, other) and the assister.
- stints: one row each time a team's five changes (start, end, the five).

How the lineups are found: ESPN's play-by-play has every substitution but
not who starts each quarter. A player who does something in a quarter (or
is subbed OUT) before being subbed in started it. The rare quarter a player
plays all of without showing up is filled from the box score: the player on
that team whose box-score minutes are furthest above what was rebuilt.
Technical fouls and ejections are skipped for this (bench players get them).

How possessions are found: the offense is the team shooting, turning it
over or rebounding its own miss; a possession ends when the other team does
one of those (a defensive rebound starts the other team's). An offensive
rebound keeps the same possession, as the NBA counts it. Technical free
throws count as points but never change the possession.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

REGULAR_SEASON = 2
QUARTER = 720
OVERTIME = 300
FOOT = re.compile(r"(\d+)-foot")
TEAM_COLS = ("o1", "o2", "o3", "o4", "o5")
OPP_COLS = ("d1", "d2", "d3", "d4", "d5")


# ---- reading one row ----
def period_start(period: int) -> int:
    """Seconds into the game when a period starts."""
    return QUARTER * min(period - 1, 4) + OVERTIME * max(period - 5, 0)


def period_length(period: int) -> int:
    return QUARTER if period <= 4 else OVERTIME


def elapsed(period: int, minutes, seconds) -> float:
    left = (0 if pd.isna(minutes) else float(minutes)) * 60 + (0 if pd.isna(seconds) else float(seconds))
    return period_start(period) + period_length(period) - left


def kind_of(type_text: str) -> str:
    """What an event is, for the engine."""
    t = type_text or ""
    if t == "Substitution":
        return "sub"
    if t.startswith("Free Throw"):
        return "ft_tech" if "Technical" in t else "ft"
    if t == "Offensive Rebound":
        return "oreb"
    if t == "Defensive Rebound":
        return "dreb"
    if "Turnover" in t and t != "No Turnover":
        return "to"
    if "Technical" in t or t in ("Ejection", "Delay Technical"):
        return "tech"
    if "Foul" in t:
        return "foul"
    return "other"


def shot_kind(type_text: str) -> str:
    """How a shot was made, from ESPN's shot name ("Pullup Jump Shot" -> pullup).
    A plain "Jump Shot" is mostly catch-and-shoot."""
    t = (type_text or "").lower()
    if "alley oop" in t:
        return "lob"
    if "putback" in t or "tip" in t:
        return "putback"
    if "step back" in t:
        return "stepback"
    if "pullup" in t:
        return "pullup"
    if "hook" in t or "post" in t:
        return "post"
    if "fade" in t or "turnaround" in t:
        return "fade"
    if "floating" in t or "floater" in t:
        return "floater"
    if "cutting" in t:
        return "cut"
    if "driving" in t or "running" in t:
        return "drive"
    if t == "jump shot" or t == "jump bank shot":
        return "catch"
    if "dunk" in t or "layup" in t or "finger roll" in t:
        return "drive"
    return "other"


def shot_zone(points: int, distance, x, y) -> str:
    """rim (0-4 ft), short (5-9), mid (10 ft to the line), corner3, above3.
    The court runs along x with the baskets near x = +/-41.75; a corner 3 is
    out wide (|y| 21.5+) and near the baseline (|x| 33+). That puts a quarter
    of 2025-26's threes in the corner, the NBA's own split."""
    if points == 3:
        try:
            if abs(float(y)) >= 21.5 and abs(float(x)) >= 33:
                return "corner3"
        except (TypeError, ValueError):
            pass
        return "above3"
    d = 0 if distance is None else distance
    if d <= 4:
        return "rim"
    if d <= 9:
        return "short"
    return "mid"


def foot(text: str):
    m = FOOT.search(text or "")
    return int(m.group(1)) if m else None


def ids(*values) -> list:
    out = []
    for v in values:
        if v is not None and not pd.isna(v):
            out.append(int(v))
    return out


# ---- lineups ----
def period_starters(events: list, team_of: dict) -> dict:
    """{team: set of players} who started a period, from its events (see top)."""
    entered, starters = {}, {}
    for ev in events:
        if ev["kind"] == "sub":
            for pid, came_in in ((ev["a1"], True), (ev["a2"], False)):
                if pid is None:
                    continue
                team = team_of.get(pid)
                if team is None:
                    continue
                ent = entered.setdefault(team, set())
                if came_in:
                    ent.add(pid)
                elif pid not in ent:
                    starters.setdefault(team, set()).add(pid)
            continue
        if ev["kind"] in ("tech", "ft_tech"):
            continue
        for pid in ids(ev["a1"], ev["a2"], ev["a3"]):
            team = team_of.get(pid)
            if team is not None and pid not in entered.get(team, set()):
                starters.setdefault(team, set()).add(pid)
    return starters


def walk_lineups(periods: dict, starters: dict, team_of: dict) -> tuple:
    """Play the subs through each period. Returns (seconds played by player,
    stints [(team, start, end, five)], on-floor at each event index)."""
    played, stints, floor_at = {}, [], {}
    for period, events in periods.items():
        floor = {team: set(five) for team, five in starters[period].items()}
        since = {team: float(period_start(period)) for team in floor}
        for ev in events:
            if ev["kind"] == "sub":
                team = team_of.get(ev["a1"]) or team_of.get(ev["a2"])
                if team is not None and team in floor:
                    t = ev["t"]
                    stints.append((team, since[team], t, tuple(sorted(floor[team]))))
                    for pid in floor[team]:
                        played[pid] = played.get(pid, 0.0) + t - since[team]
                    since[team] = t
                    if ev["a2"] is not None:
                        floor[team].discard(ev["a2"])
                    if ev["a1"] is not None:
                        floor[team].add(ev["a1"])
            floor_at[ev["i"]] = {team: tuple(sorted(five)) for team, five in floor.items()}
        end = float(period_start(period) + period_length(period))
        for team, five in floor.items():
            stints.append((team, since[team], end, tuple(sorted(five))))
            for pid in five:
                played[pid] = played.get(pid, 0.0) + end - since[team]
    return played, stints, floor_at


def find_lineups(periods: dict, team_of: dict, box_minutes: dict, teams: tuple, problems: list, game_id) -> tuple:
    """Each period's starting five for both teams, filled / trimmed against
    the box score when the events don't show exactly five."""
    starters = {p: period_starters(evs, team_of) for p, evs in periods.items()}
    for p in starters:
        for team in teams:
            starters[p].setdefault(team, set())
    for _ in range(12):
        bad = [(p, team) for p in starters for team in teams if len(starters[p][team]) != 5]
        if not bad:
            break
        played, _, _ = walk_lineups(periods, starters, team_of)
        for p, team in bad:
            five = starters[p][team]
            gap = {pid: box_minutes.get(pid, 0) * 60 - played.get(pid, 0.0)
                   for pid, t in team_of.items() if t == team}
            if len(five) < 5:
                # a player who first came in by a sub this period can't have started it
                first_in = set()
                seen = set()
                for ev in periods[p]:
                    if ev["kind"] == "sub":
                        if ev["a1"] not in seen:
                            first_in.add(ev["a1"])
                        seen.update(ids(ev["a1"], ev["a2"]))
                    else:
                        seen.update(ids(ev["a1"], ev["a2"], ev["a3"]))
                pool = [pid for pid in gap if pid not in five and pid not in first_in and gap[pid] > 0]
                pool.sort(key=lambda pid: -gap[pid])
                if not pool:
                    problems.append((game_id, p, team, f"only {len(five)} on the floor"))
                    starters[p][team] = set(five) | {-1 - k for k in range(5 - len(five))}
                    continue
                five.add(pool[0])
            else:
                drop = min(five, key=lambda pid: gap.get(pid, 0))
                five.discard(drop)
    return starters


# ---- one game ----
def build_game(pbp: pd.DataFrame, box: pd.DataFrame, problems: list) -> tuple:
    """(possessions, actions, stints, played) for one game. `played` is
    {player: seconds} rebuilt, for checking against the box score."""
    game_id = int(pbp["game_id"].iloc[0])
    pbp = pbp.sort_values("game_play_number")
    team_of = {int(a): int(t) for a, t in zip(box["athlete_id"], box["team_id"]) if not pd.isna(a)}
    box_minutes = {int(a): (0 if pd.isna(m) else float(m)) for a, m in zip(box["athlete_id"], box["minutes"])
                   if not pd.isna(a)}
    home = int(pbp["home_team_id"].iloc[0])
    away = int(pbp["away_team_id"].iloc[0])
    teams = (home, away)
    # a player now and then has no id in the box score: take his team from his own plays
    own = pbp[~pbp["type_text"].map(kind_of).isin(("foul", "tech", "sub", "other"))]
    for pid, grp in own.dropna(subset=["athlete_id_1", "team_id"]).groupby("athlete_id_1"):
        if int(pid) not in team_of:
            team_of[int(pid)] = int(grp["team_id"].mode().iloc[0])

    events, periods = [], {}
    last_score = (0, 0)
    for i, r in enumerate(pbp.itertuples(index=False)):
        period = int(r.period_number)
        a1 = None if pd.isna(r.athlete_id_1) else int(r.athlete_id_1)
        kind = kind_of(r.type_text)
        # ESPN's team_id is sometimes the wrong side; the player's own team never is
        # (a foul's athlete_id_1 is the fouler, on the defense, so keep its team_id).
        team = team_of.get(a1) if a1 is not None and kind not in ("foul", "tech", "sub") else None
        if team is None:
            team = None if pd.isna(r.team_id) else int(r.team_id)
        # points from the scoreboard's change, which is always right
        hs = last_score[0] if pd.isna(r.home_score) else int(r.home_score)
        aw = last_score[1] if pd.isna(r.away_score) else int(r.away_score)
        gained = (max(hs - last_score[0], 0), max(aw - last_score[1], 0))
        last_score = (max(hs, last_score[0]), max(aw, last_score[1]))
        ev = {
            "i": i, "period": period, "t": elapsed(period, r.clock_minutes, r.clock_seconds),
            "kind": kind, "type": r.type_text, "text": r.text,
            "team": team, "gained": gained,
            "a1": a1,
            "a2": None if pd.isna(r.athlete_id_2) else int(r.athlete_id_2),
            "a3": None if pd.isna(r.athlete_id_3) else int(r.athlete_id_3),
            "shot": bool(r.shooting_play) and not str(r.type_text).startswith("Free Throw"),
            "scoring": bool(r.scoring_play), "value": 0 if pd.isna(r.score_value) else int(r.score_value),
            "pts_att": 0 if pd.isna(r.points_attempted) else int(r.points_attempted),
            "x": r.coordinate_x, "y": r.coordinate_y,
            "home_score": r.home_score, "away_score": r.away_score,
        }
        if ev["kind"] == "other" and ev["shot"]:
            ev["kind"] = "shot"
        events.append(ev)
        periods.setdefault(period, []).append(ev)

    starters = find_lineups(periods, team_of, box_minutes, teams, problems, game_id)
    played, stints, floor_at = walk_lineups(periods, starters, team_of)

    # possessions
    poss, acts = [], []
    cur = None
    score = {home: 0, away: 0}
    last_end = ("period", 0.0)  # how the last possession ended and when

    def close(at: float):
        nonlocal cur
        if cur is not None:
            cur["secs"] = round(max(at - cur["t0"], 0.0), 1)
            poss.append(cur)
        cur = None

    def open_(team: int, ev: dict, start: str, t0: float):
        nonlocal cur
        opp = away if team == home else home
        floor = floor_at.get(ev["i"], {})
        o, d = floor.get(team, ()), floor.get(opp, ())
        cur = {"game_id": game_id, "n": len(poss), "period": ev["period"], "off": team, "def": opp,
               "start": start, "t0": round(t0, 1), "margin": score[team] - score[opp],
               "pts": 0, "fga": 0, "fg3a": 0, "fta": 0, "tov": 0, "oreb": 0, "first_secs": None}
        for k, c in enumerate(TEAM_COLS):
            cur[c] = o[k] if k < len(o) else None
        for k, c in enumerate(OPP_COLS):
            cur[c] = d[k] if k < len(d) else None

    def bank(ev: dict):
        """Add an event's points (the scoreboard's change) to the score and,
        for the team on offense, to its possession. Technical free throws by
        the defense count for the game score but no possession."""
        for side, g in zip(teams, ev["gained"]):
            if g:
                score[side] += g
                if cur is not None and cur["off"] == side:
                    cur["pts"] += g

    period_now = None
    for ev in events:
        if ev["period"] != period_now:
            if cur is not None:
                close(float(period_start(period_now) + period_length(period_now)))
            period_now = ev["period"]
            last_end = ("period", float(period_start(period_now)))
        k = ev["kind"]
        team = ev["team"]
        if k not in ("shot", "ft", "to", "oreb", "dreb") or team not in score:
            if k == "foul" and ev["a1"] is not None:
                acts.append(action(ev, "foul", team_of.get(ev["a1"], team), cur, floor_at, teams))
            bank(ev)
            continue
        if cur is None or cur["off"] != team:
            if cur is not None:
                close(ev["t"] if k == "dreb" else last_end[1])
            if k == "dreb":
                start, t0 = "miss", ev["t"]
            else:
                start, t0 = last_end
            open_(team, ev, start, t0)
        if k == "shot":
            cur["fga"] += 1
            cur["fg3a"] += ev["pts_att"] == 3
        elif k == "ft":
            cur["fta"] += 1
        elif k == "to":
            cur["tov"] += 1
        elif k == "oreb":
            cur["oreb"] += 1
        if k in ("shot", "to") or (k == "ft" and cur["fta"] == 1):
            if cur["first_secs"] is None:
                cur["first_secs"] = round(max(ev["t"] - cur["t0"], 0.0), 1)
        bank(ev)
        # how this possession would end if the other team's next action starts one
        if k == "shot" and ev["scoring"]:
            last_end = ("make", ev["t"])
        elif k == "ft" and ev["scoring"]:
            last_end = ("make", ev["t"])
        elif k == "to":
            stolen = ev["a2"] is not None and "steal" in (ev["text"] or "")
            last_end = ("steal" if stolen else "dead_to", ev["t"])
        elif k in ("shot", "ft"):
            last_end = ("miss", ev["t"])
        acts.append(action(ev, k, team, cur, floor_at, teams))
    if cur is not None:
        close(float(period_start(period_now) + period_length(period_now)))

    st = [{"game_id": game_id, "team": team, "t0": round(a, 1), "t1": round(b, 1), "five": five}
          for team, a, b, five in stints if b > a]
    return poss, acts, st, played, score


def action(ev: dict, kind: str, team, cur: dict | None, floor_at: dict, teams: tuple) -> dict:
    floor = floor_at.get(ev["i"], {})
    opp = teams[1] if team == teams[0] else teams[0]
    row = {"game_id": None if cur is None else cur["game_id"], "n": None if cur is None else cur["n"],
           "period": ev["period"], "t": round(ev["t"], 1), "kind": kind, "team": team, "player": ev["a1"],
           "made": bool(ev["scoring"]), "pts": ev["value"] if ev["scoring"] else 0,
           "type": ev["type"], "kind2": None, "dist": None, "zone": None, "three": False,
           "assist": None, "block": None, "steal": None,
           "with": floor.get(team, ()), "against": floor.get(opp, ())}
    text = ev["text"] or ""
    if kind == "shot":
        d = foot(text)
        if d is None and any(w in (ev["type"] or "").lower() for w in ("dunk", "layup", "tip", "finger roll", "putback")):
            d = 1
        row.update(dist=d, three=ev["pts_att"] == 3, kind2=shot_kind(ev["type"]),
                   zone=shot_zone(ev["pts_att"], d, ev["x"], ev["y"]))
        if ev["scoring"] and "assist" in text:
            row["assist"] = ev["a2"]
        if "block" in text:
            row["block"] = ev["a2"]
    elif kind == "to" and "steal" in text:
        row["steal"] = ev["a2"]
    return row


# ---- a season ----
class Season:
    """The engine's three tables for one season, plus the box-score check."""

    def __init__(self, pbp: pd.DataFrame, box: pd.DataFrame):
        pbp = pbp[pbp["season_type"] == REGULAR_SEASON]
        box = box[box["season_type"] == REGULAR_SEASON]
        # the 30 real teams: All-Star / exhibition sides play a game or two while
        # the real teams have dozens (half the most-played team's games, at most 20,
        # so opening week still counts)
        games_by_team = box.groupby("team_id")["game_id"].nunique()
        cut = min(20, games_by_team.max() / 2) if len(games_by_team) else 0
        teams_real = set(games_by_team[games_by_team >= cut].index.astype(int))
        boxes = {g: b for g, b in box.groupby("game_id")}
        self.problems: list = []
        poss, acts, stints, check = [], [], [], []
        for game_id, g in pbp.groupby("game_id"):
            b = boxes.get(game_id)
            if b is None or not {int(g["home_team_id"].iloc[0]), int(g["away_team_id"].iloc[0])} <= teams_real:
                continue
            p, a, s, played, score = build_game(g, b, self.problems)
            poss += p
            acts += a
            stints += s
            for row in b.itertuples(index=False):
                if pd.isna(row.athlete_id) or bool(row.did_not_play):
                    continue
                check.append((int(game_id), int(row.athlete_id), int(row.team_id),
                              0.0 if pd.isna(row.minutes) else float(row.minutes),
                              played.get(int(row.athlete_id), 0.0) / 60))
            team_pts = b.groupby("team_id")["team_score"].max()
            for team, pts in score.items():
                check.append((int(game_id), None, team, float(team_pts.get(team, 0)), float(pts)))
        self.possessions = pd.DataFrame(poss)
        self.actions = pd.DataFrame(acts)
        self.stints = pd.DataFrame(stints)
        self.check = pd.DataFrame(check, columns=["game_id", "player", "team", "box", "rebuilt"])

    def report(self) -> dict:
        """How well the rebuild matches the box scores (the engine's health)."""
        pl = self.check[self.check["player"].notna()]
        tm = self.check[self.check["player"].isna()]
        err = (pl["rebuilt"] - pl["box"]).abs()
        per_game = self.possessions.groupby(["game_id", "off"]).size().unstack()
        per_game_diff = per_game.max(axis=1) - per_game.min(axis=1) if len(per_game) else pd.Series(dtype=float)
        return {
            "games": int(self.possessions["game_id"].nunique()) if len(self.possessions) else 0,
            "possessions_per_team_game": round(float(per_game.stack().mean()), 1) if len(per_game) else None,
            "team_possession_gap_max": int(per_game_diff.max()) if len(per_game_diff) else None,
            "team_possession_gap_over_3": int((per_game_diff > 3).sum()) if len(per_game_diff) else None,
            "team_points_match": round(float((tm["box"] == tm["rebuilt"]).mean()), 4) if len(tm) else None,
            "minutes_within_1": round(float((err <= 1).mean()), 4) if len(err) else None,
            "minutes_within_2": round(float((err <= 2).mean()), 4) if len(err) else None,
            "minutes_off_5_plus": int((err > 5).sum()),
            "lineup_problems": len(self.problems),
        }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--data-dir", default="data/nba")
    args = ap.parse_args()
    d = Path(args.data_dir)
    s = Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"),
               pd.read_parquet(d / f"player_box_{args.season}.parquet"))
    for k, v in s.report().items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
