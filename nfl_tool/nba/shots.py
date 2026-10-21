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
- `players[<espn id>]`: his shots, each [x, y, made 1/0, three 1/0, game index,
  flags, kind]. flags: 1 = 1st quarter, 2 = the game's first 3 minutes.
  kind: 1 = self-created (pull-up, step-back, fade), 2 = catch and shoot,
  3 = drive / cut / finish at the rim (lob, putback, floater, post), 0 = other.
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


def season_block(pbp: pd.DataFrame, label: str) -> dict | None:
    """shots.json for one season's play-by-play (regular season only)."""
    pbp = pbp[pbp["season_type"] == P.REGULAR_SEASON]
    is_shot = pbp["shooting_play"].fillna(False).astype(bool) & ~pbp["type_text"].fillna("").str.startswith("Free Throw")
    sh = pbp[is_shot].dropna(subset=["athlete_id_1", "coordinate_x_raw", "coordinate_y_raw"])
    if sh.empty:
        return None
    dates = sh.groupby("game_id")["game_date"].first()
    games = [int(g) for g in sorted(dates.index, key=lambda g: (str(dates[g]), g))]
    index = {g: i for i, g in enumerate(games)}
    players, league = {}, {}
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
        players.setdefault(str(int(r.athlete_id_1)), []).append([x, y, made, three, index[int(r.game_id)], flags, kind])
        spot = league.setdefault((x, y, three), [0, 0])
        spot[0] += made
        spot[1] += 1
    return {"label": label, "games": games, "players": players,
            "league": [[x, y, t, m, a] for (x, y, t), (m, a) in sorted(league.items())]}
