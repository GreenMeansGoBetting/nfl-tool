"""NBA shot charts (site/nba/shots.json): every shot of THIS season with its
spot on the floor, for the player card's Shot Chart tab (site/nba/shot-chart.js).

From ESPN's play-by-play (`coordinate_x_raw` / `coordinate_y_raw`): feet on a
half court, x 0-50 across (the basket at 25), y out from the basket (0 at
the rim, -5 at the baseline). x below 25 is the SHOOTER'S LEFT: checked
2026-10-21 against NBA.com's own 2025-26 shot file (sportsdataverse
`nba_stats_shots`), where its "Left" areas sit on the negative side; ESPN's
side agreed on 90% of 121k shots matched by player, period and clock (the
rest were wrong matches). The spots are to the foot only.

Output:
- `games`: this season's game ids, oldest first (a shot's game is its index).
- `teams`: every team's abbreviation (a shot's teams are indexes into it).
- `players[<espn id>]`: his shots, each [x, y, made 1/0, three 1/0, game index,
  flags, kind, his team, the defense]. flags: 1 = 1st quarter, 2 = the game's
  first 3 minutes. kind: 1 = self-created (pull-up, step-back, fade), 2 = catch
  and shoot, 3 = drive / cut / finish at the rim (lob, putback, floater, post),
  0 = other. The teams (-1 = unknown) come from his box-score team that game,
  never ESPN's play `team_id` (sometimes the wrong side: .claude/rules/nba.md);
  a player missing from the box score gets the play's side. They are what the
  Shot Charts page reads for a defense's shots allowed.
- `who[<espn id>]`: [name, team of his latest game] for the Shot Charts picker.
- `league`: [x, y, three, made, tried] for every spot, the whole league's
  shots: what each zone and each heat-map spot is compared against.

Heaves (35+ feet) are left out. Free throws aren't shots here.
"""
from __future__ import annotations

import math

import pandas as pd

import possessions as P

HEAVE_FT = 35
OPENING_SECS = 180
KIND_CODE = {"pullup": 1, "stepback": 1, "fade": 1, "catch": 2,
             "drive": 3, "cut": 3, "lob": 3, "putback": 3, "floater": 3, "post": 3}


def box_teams(box: pd.DataFrame | None) -> dict:
    """{(game id, player id): [his team, the other team, name]} from the box scores."""
    if box is None or box.empty:
        return {}
    out = {}
    for r in box[["game_id", "athlete_id", "team_abbreviation", "opponent_team_abbreviation", "athlete_display_name"]].dropna(subset=["athlete_id"]).itertuples(index=False):
        out[(int(r.game_id), int(r.athlete_id))] = [r.team_abbreviation, r.opponent_team_abbreviation, r.athlete_display_name]
    return out


def play_teams(r) -> list | None:
    """[shooter's team, defense] from the play's own side, when the box score lacks him."""
    try:
        home, away = int(r.home_team_id), int(r.away_team_id)
        side = int(r.team_id)
    except (AttributeError, TypeError, ValueError):
        return None
    if side not in (home, away):
        return None
    ha, aa = r.home_team_abbrev, r.away_team_abbrev
    return [ha, aa] if side == home else [aa, ha]


def season_block(pbp: pd.DataFrame, label: str, box: pd.DataFrame | None = None) -> dict | None:
    """shots.json for one season's play-by-play (regular season only)."""
    pbp = pbp[pbp["season_type"] == P.REGULAR_SEASON]
    is_shot = pbp["shooting_play"].fillna(False).astype(bool) & ~pbp["type_text"].fillna("").str.startswith("Free Throw")
    sh = pbp[is_shot].dropna(subset=["athlete_id_1", "coordinate_x_raw", "coordinate_y_raw"])
    if {"home_team_abbrev", "away_team_abbrev"} <= set(sh.columns):
        # All-Star sides are left out, like the engine: a team needs half the
        # games of the most-played team (at most 20), so opening week still counts.
        sides = sh.groupby("game_id")[["home_team_abbrev", "away_team_abbrev"]].first()
        played = pd.concat([sides["home_team_abbrev"], sides["away_team_abbrev"]]).value_counts()
        real = set(played[played >= min(played.max(), 20) / 2].index)
        keep = sides[sides["home_team_abbrev"].isin(real) & sides["away_team_abbrev"].isin(real)].index
        sh = sh[sh["game_id"].isin(keep)]
    if sh.empty:
        return None
    dates = sh.groupby("game_id")["game_date"].first()
    games = [int(g) for g in sorted(dates.index, key=lambda g: (str(dates[g]), g))]
    index = {g: i for i, g in enumerate(games)}
    on_box = box_teams(box)
    rows, league = [], {}
    for r in sh.itertuples(index=False):
        x, y = int(round(float(r.coordinate_x_raw))), int(round(float(r.coordinate_y_raw)))
        if math.hypot(x - 25, y) >= HEAVE_FT:
            continue
        made = 1 if bool(r.scoring_play) else 0
        three = 1 if (0 if pd.isna(r.points_attempted) else int(r.points_attempted)) == 3 else 0
        period = int(r.period_number)
        elapsed = P.elapsed(period, r.clock_minutes, r.clock_seconds)
        flags = (1 if period == 1 else 0) | (2 if period == 1 and elapsed < OPENING_SECS else 0)
        kind = KIND_CODE.get(P.shot_kind(r.type_text), 0)
        pid, gi = int(r.athlete_id_1), index[int(r.game_id)]
        found = on_box.get((int(r.game_id), pid))
        sides = found[:2] if found else play_teams(r)
        rows.append((pid, [x, y, made, three, gi, flags, kind], sides))
        spot = league.setdefault((x, y, three), [0, 0])
        spot[0] += made
        spot[1] += 1
    teams = sorted({t for *_, sides in rows if sides for t in sides if isinstance(t, str)})
    at = {t: i for i, t in enumerate(teams)}
    # who: his name and his team in his latest game in the box scores (shots or not)
    latest = {}
    for (g, pid), (team, _, name) in on_box.items():
        if g in index and (pid not in latest or latest[pid][0] < index[g]):
            latest[pid] = (index[g], name, team)
    players = {}
    for pid, shot, sides in rows:
        shot += [at.get(sides[0], -1), at.get(sides[1], -1)] if sides else [-1, -1]
        players.setdefault(str(pid), []).append(shot)
    return {"label": label, "games": games, "teams": teams, "players": players,
            "who": {str(pid): [latest[pid][1], latest[pid][2]] for pid in sorted({r[0] for r in rows}) if pid in latest},
            "league": [[x, y, t, m, a] for (x, y, t), (m, a) in sorted(league.items())]}
