"""The NBA game simulation (the owner, 2026-10-24): every game played 10,000
times, possession by possession, so Points, Threes, Rebounds and Assists
come from the game itself, not from the books' line ("I just dont want to mimic the vegas
line again and be back where we started"). Since 2026-10-28 (the owner: "Start
from the line") the line comes in at the very end: each player's outcomes are
moved so their middle sits near his main line, 35% of the way toward the sim's
own (`nudge_to_line`), and the price judges the play.

One simulated game, a quarter at a time (all 10,000 at once, numpy):
1. Possessions: the two teams' pace this season (both get the same number).
2. Plays: each possession gives the offense its plays-per-possession this
   season (an offensive rebound is another play), less or more against this
   defense.
3. Who: each play goes to one of the players on the floor, by his minutes
   (who's on the floor) x his plays a minute (how much he shoots when there).
   Players listed Out aren't in it; their minutes go to the rest. So is a
   usual starter on the injury report who isn't in the NBA's posted five.
4. What: the play is a shot from a zone (rim, short, mid, corner 3, above the
   break 3), a trip to the line or a turnover, by his own mix, tilted toward
   what this defense gives up.
5. Does it go in: his make rate in that zone, times what this defense allows
   there against the league, times the night's dials (`DIALS`: the spots
   tools/backtest/nba_spots.py found real over ten seasons) and home court.
6. After three quarters, a blowout sends the starters to the bench (garbage
   time); a tie after four plays overtime.
Every player also gets a minutes night and a shooting night (some nights he
plays 30 instead of 34, some nights everything drops), and each team a team
night, so the spread of outcomes is a real game's, not a coin flip's.

THIS SEASON ONLY: early on a player's rates lean on the league's numbers for
his position this season (`K_*`), less as his own games come in. Never last
season. (2026-10-25 to 10-27 each player started from his own last season,
`prior_block` / `K_PRIOR_*`, now only for the replay's --prior-season. It read
Toumani Camara's 17 threes in 2 games and Damian Lillard, back from a missed
season on a new team, as last season's players: unders. The owner: "stop using
last seasons data i've told you 10000 times its not relevant".)

    py nfl_tool/nba/sim.py --season 2027 --data-dir data/nba --game <espn id>
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import date as Date
from pathlib import Path

import numpy as np
import pandas as pd

import possessions as P

N_SIMS = 10000
ZONES = ("rim", "short", "mid", "corner3", "above3")
OUTCOMES = ZONES + ("ft", "to")
THREE = np.array([0, 0, 0, 1, 1])
POS_GROUP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}

# Early-season shrink: a player's own rate counts like this many plays /
# shots / minutes of the league's (his position, this season) on top of his own.
# What he shoots and how often shows up within a game or two (Camara: 17 threes,
# 4 twos), so it trusts him fast; whether it goes in is mostly luck, so make
# rates stay slow. 2025-26's opening month replayed this season only (2026-10-27):
# 5 plays / 10 minutes beat 40 / 60 (threes miss 0.912 -> 0.896, log score
# -1.355 -> -1.334; points miss 4.65 -> 4.58) and 15 / 20.
K_MIX = 5           # plays, for what his plays turn into
K_ZONE = {"rim": 40, "short": 60, "mid": 80, "corner3": 200, "above3": 200}  # shots (threes: mostly luck)
K_FT = 40           # free throws
K_USE = 10          # minutes, for his plays a minute
K_TEAM = 5          # games, for a team's pace and plays a possession
K_DEF = 150         # shots allowed in a zone, for a defense's make rate there
K_OREB = 150        # misses, for a team's offensive rebound rate (and a defense's allowed)
# Rebounds and Assists (2026-10-28, the owner: "build it in the exact same way and structure as
# the current points and threes"). Who grabs a board: the five on the floor by their floor time x
# their boards a minute (his own, leaning on his position's this season), x what tonight's other
# team gives up to his POSITION (PG / SG / SF / PF / C; the owner: "if you can do actual position
# rather than bigs forwards and guards"): its opponents' share of the boards at each spot against
# the league's. How many boards there are comes from the game itself: the other team's misses
# (its shooting x this defense) and the offensive rebound rate (both teams). Who gets the assist on
# a make: the shooter's assisted share by zone (his own, leaning on his group's) x how often this
# defense gives up assisted makes, then a teammate on the floor by his assists a minute.
K_REB = 60          # minutes, for his rebounds a minute (a role shows fast)
K_AST = 25          # minutes, for his assists a minute (60 read a playmaking PF like Jalen Johnson, 8.5 a game, at 5.9: players the sim had at 4-6 really got 5.5; 25 gives 4.9 vs 5.2, 10 overshoots the top)
K_AST_SHOT = 30     # makes, for his assisted share in a zone
K_DEF_AST = 150     # makes allowed, for a defense's assisted share
K_POS_REB = 400     # rebounds, for a team's boards given up at one position (80 read 5 games' noise: miss 2.16 vs 2.11)
POS5 = ("PG", "SG", "SF", "PF", "C")
DEFAULT_RATES = {"oreb": 0.035, "dreb": 0.12, "ast": 0.08}  # a minute, before any games (tests, a new league)
DEFAULT_SHARES = {"oreb_player": 0.8, "dreb_player": 0.9, "ft_oreb": 0.1, "ft_dreb": 0.75, "assisted": 0.62}
# His own last season as the starting point (2026-10-25): what it counts like,
# on top of this season's own (fitted on the 2025-26 opening weeks with
# 2024-25 as the prior, tools/backtest/nba_sim.py --prior-season).
# A quick fade (about 4 games) beat a slow one (16) a little on every measure:
# new roles show up fast.
K_PRIOR_MIX = 80       # plays
K_PRIOR_ZONE = {"rim": 80, "short": 120, "mid": 160, "corner3": 300, "above3": 300}  # shots
K_PRIOR_FT = 40        # free throws
K_PRIOR_USE = 120      # minutes
DEF_MIX_W = 0.5     # how hard a defense's shot mix allowed tilts a player's (half: both sides count)
# Minutes: the 2025-26 replay's last-5 overshoot (tools/backtest/nba_points.py): a dip bounces back, a rise mostly sticks.
MIN_LAST = 5
MIN_W_SEASON = 0.365
# A blowout's minutes aren't a player's role (the owner, 2026-10-27: Derrick White's
# 18 minutes in a 35-point win read his threes under). From the moment a lead
# reaches BLOWOUT_LEAD and never drops back under it in regulation (looked for
# from BLOWOUT_FROM on: nobody empties the bench in the first half), the game is
# over; his minutes before then, scaled to 48, are his minutes that night.
BLOWOUT_LEAD = 20
BLOWOUT_FROM = 24 * 60
# Only ever DOWN (2026-10-27, second look): garbage-time minutes aren't a role.
# The owner on BOS-BKN: the sim's total was 3 over the line yet every player but
# one read under. It gave 14-15 players minutes every night (Garza, Harper,
# Conley... who had played only in blowouts' garbage time), about 21 of Boston's
# 113 points, so Tatum, George, White, Pritchard all came up short. Replayed on
# this season's first 5 nights with the morning injury report: starters' points
# 15.2 -> 15.6 (real 15.7), points miss 4.74 -> 4.66, threes 0.929 -> 0.925 (the
# exact-number log score a little worse on that small sample). Raising a pulled
# starter to 48 minutes' worth (BLOWOUT_UP 1) overshot: 2025-26's opening month,
# starters 30.4-30.7 minutes vs 29.9 real.
BLOWOUT_SHARE = 1.0
BLOWOUT_UP = 0
REG_SECS = 48 * 60
MIN_CAP = 40.0
ROTATION_GONE = 3   # a player under 20 minutes who missed his team's last 3 games isn't in tonight's rotation
# Injuries and the starting five (the owner, 2026-10-24: "is this going to be
# able to price a roleplayer who has 10 minutes per game but tonight is
# starting"): a player listed Out leaves the rotation and fill_minutes hands
# his minutes to everyone in proportion (the 2025-26 replay: handing them to
# his own position first missed minutes by more, 5.1-6.3 against 4.8); a
# player in the NBA's starting five for tonight (Expected, then Confirmed ~30
# minutes before tip) plays at least STARTER_TRUST of his team's usual
# starter minutes. Once the five is posted, a usual starter on the injury
# report (Questionable, Doubtful, Day-To-Day) who isn't in it sits too: the
# owner, 2026-10-25, Embiid was Questionable with Bona in the posted five at
# the noon build, so the sim had him playing 30 minutes off the bench and his
# teammates (LeBron, Brown, Edgecombe) all read unders; ESPN ruled him Out 40
# minutes later.
# Who plays (the owner, 2026-10-27: 80% of plays were unders). The sim gave full
# minutes to players who then sat, about 13 minutes a team a night, so everyone
# else read low. Now each player plays in only some of the 10,000 games: a listed
# player by his status (Day-To-Day measured on this season's morning reports: 42%
# of 85 played), a bench player by the share of his team's games he has played
# (steadied by SHOWS_K games of playing); a usual starter not on the report, or
# anyone in the NBA's posted five, always. His own numbers count only the games he plays.
PLAY_CHANCE = {"Probable": 0.95, "Questionable": 0.55, "Day-To-Day": 0.45, "Doubtful": 0.15}
SHOWS_K = 2
STARTER_TRUST = 0.8  # the 2025-26 replay: fill-in starters played 25.5 minutes (0.8 gives 25.9, 0.9 gave 28.2, no floor 19.9)
NBA_ABBR = {"GSW": "GS", "NOP": "NO", "NYK": "NY", "SAS": "SA", "UTA": "UTAH", "WAS": "WSH"}
# The nights (fitted on the 2025-26 replay, tools/backtest/nba_sim.py)
SD_MIN = 0.12       # a player's minutes night (log scale) at SD_MIN_AT minutes ...
SD_MIN_AT = 34.0
SD_MIN_STEP = 0.012  # ... and this much wider a minute less (a bench player's minutes swing more)
SHORT_NIGHT = 0.04  # the chance a player's night ends early (an injury, fouls, a benching) ...
SHORT_KEEP = (0.2, 0.6)  # ... keeping this share of his minutes
SD_SHOOT = 0.10     # a player's shooting night
# A player's rebounding and passing nights (his share of the boards / assists). This season's
# first 6 nights (tools/backtest/nba_sim.py, 42 games): with none, 14% of real results fell under
# the sims' 10th percentile and 14% over the 90th; 0.4 gives 9-12% each end, 79% inside 10-90%.
SD_REB = 0.4
SD_AST = 0.4
REB_LEVEL = 0.965   # every credited board x this: the same replay ran +0.16 rebounds a player high without it
SD_TEAM = 0.035     # a team's shooting night
SD_GAME = 0.03      # the game's shooting night, both teams (refs, rims, a fast or slow night)
# A lead shrinks: the team ahead eases off and the team behind presses (real
# margins swing less than independent possessions would): from the 2nd quarter
# on, each point of lead takes this much off the leader's make rate and gives it
# to the trailer (fitted on the 2025-26 replay).
LEAD_DRAG = 0.003
LEAD_DRAG_MAX = 0.12
SD_PACE = 0.045     # the game's pace night
HOME_EDGE = 2.2     # points of margin (ten seasons: tools/backtest/nba_spots.py's ratings)
PTS_BASE = 113.0    # points a team scores a game, to turn a dial's points into a make rate
LEVEL = 0.99        # every make rate x this: the 2025-26 replay ran 1 point a team high without it
# Garbage time: a blowout after three quarters sends the starters to the bench
# for part of the 4th (their share of the floor x GARBAGE_FLOOR at GARBAGE_FULL+ points).
GARBAGE_FROM = 12
GARBAGE_FULL = 28
GARBAGE_FLOOR = 0.3
SCRIPT_MARGIN = 10  # a win by this many or more = a blowout script

# The dials: spots tools/backtest/nba_spots.py found real on ten seasons
# (2026-10-24), as (label, the team's own points, the other team's points)
# against each team's normal. One schedule dial and one last-game dial a
# team at most (the first that applies, in this order), so a tired team isn't
# counted twice.
SCHEDULE_DIALS = (
    ("rest_edge", "Rest Edge", -0.72, 1.89),       # back-to-back, the other team 2+ days off
    ("b2b", "Back-To-Back", -0.84, 0.58),
    ("3in4", "3 In 4 Nights", -0.65, 0.16),
    ("4in6", "4 In 6 Nights", -0.57, -0.01),
)
LAST_GAME_DIALS = (
    ("ot_win", "Letdown: OT Win", -1.81, 0.46),      # won its last game in overtime
    ("ot_legs", "Overtime Legs", -1.12, -0.18),      # played overtime last game, 1 day of rest or less
    ("close_win", "Letdown: Close Win", -0.78, -0.03),  # won its last game by 1-3 in regulation
    ("big_win", "Off A 20+ Win", 0.25, -0.58),       # won its last game by 20+ (no letdown: the opposite)
)
DIAL_INFO = {k: (label, own, opp) for k, label, own, opp in SCHEDULE_DIALS + LAST_GAME_DIALS}


# ---- this season's inputs ----
def season_inputs(season: P.Season, box: pd.DataFrame, before: str | None = None, prior: dict | None = None) -> dict:
    """Everything the sim reads, from this season's engine tables and box
    scores: players (minutes log, plays, what they turn into, make rates),
    teams (pace, plays a possession, history for the dials), defenses (what
    they allow) and the league (by position). `before` = only games before
    that date (the replay)."""
    reg = box[(box["season_type"] == P.REGULAR_SEASON) & box["athlete_id"].notna()].copy()
    reg["date"] = pd.to_datetime(reg["game_date"]).dt.strftime("%Y-%m-%d")
    if before:
        reg = reg[reg["date"] < before]
    kept = set(reg["game_id"].astype(int))
    reg["pid"] = reg["athlete_id"].astype(int)
    played = reg[~reg["did_not_play"].astype(bool) & (reg["minutes"].fillna(0) > 0)]
    abbr = dict(zip(reg["team_id"].astype(int), reg["team_abbreviation"]))

    acts = season.actions
    acts = acts[acts["player"].notna() & acts["game_id"].isin(kept)]
    shots = acts[acts["kind"] == "shot"]
    fts = acts[acts["kind"] == "ft"]
    tos = acts[acts["kind"] == "to"]

    players = {}
    for pid, rows in played.sort_values("date").groupby("pid"):
        last = rows.iloc[-1]
        players[int(pid)] = {
            "name": last["athlete_display_name"], "team": last["team_abbreviation"],
            "group": POS_GROUP.get(str(last.get("athlete_position_abbreviation") or ""), "F"),
            "dates": list(rows["date"]), "games": [int(g) for g in rows["game_id"]],
            "min": [float(m) for m in rows["minutes"]], "start": [bool(s) for s in rows["starter"]],
            "counts": np.zeros(len(OUTCOMES)), "made": np.zeros(len(ZONES)), "ftm": 0.0, "fta": 0.0,
            "pos": pos5(last.get("athlete_position_abbreviation")),
            "oreb": 0.0, "dreb": 0.0, "ast": 0.0, "amade": np.zeros(len(ZONES)),
        }
    zi = {z: i for i, z in enumerate(ZONES)}
    assisted = shots["assist"].notna() & shots["made"].astype(bool)
    for pid, z, made, helped in zip(shots["player"].astype(int), shots["zone"], shots["made"], assisted):
        p = players.get(pid)
        if p is None or z not in zi:
            continue
        p["counts"][zi[z]] += 1
        p["made"][zi[z]] += bool(made)
        p["amade"][zi[z]] += bool(helped)
    for pid in shots.loc[assisted, "assist"].astype(int):
        p = players.get(pid)
        if p is not None:
            p["ast"] += 1
    for pid, made in zip(fts["player"].astype(int), fts["made"]):
        p = players.get(pid)
        if p is not None:
            p["fta"] += 1
            p["ftm"] += bool(made)
    for pid in tos["player"].astype(int):
        p = players.get(pid)
        if p is not None:
            p["counts"][6] += 1
    poss = season.possessions
    poss = poss[poss["game_id"].isin(kept)]
    starts = blowout_starts(poss)
    before_min = minutes_before(season.stints, starts)
    for pid, p in players.items():
        p["role_min"] = [role_minutes(m, before_min.get((g, pid), 0.0), starts[g]) if g in starts else m
                         for g, m in zip(p["games"], p["min"])]
    for p in players.values():
        p["counts"][5] = p["fta"] / 2  # trips to the line, two shots each
        p["plays"] = float(p["counts"].sum())
        p["minutes"] = float(sum(p["min"]))

    # league by position group
    league = {"groups": {}}
    for g in ("G", "F", "C"):
        ps = [p for p in players.values() if p["group"] == g]
        counts = sum((p["counts"] for p in ps), np.zeros(len(OUTCOMES)))
        made = sum((p["made"] for p in ps), np.zeros(len(ZONES)))
        mins = sum(p["minutes"] for p in ps)
        league["groups"][g] = {
            "mix": counts / counts.sum() if counts.sum() else np.full(len(OUTCOMES), 1 / len(OUTCOMES)),
            "pct": np.where(counts[:5] > 0, made / np.maximum(counts[:5], 1), 0.45),
            "use": counts.sum() / mins if mins else 0.45,
        }
    all_counts = sum((p["counts"] for p in players.values()), np.zeros(len(OUTCOMES)))
    all_made = sum((p["made"] for p in players.values()), np.zeros(len(ZONES)))
    league["mix"] = all_counts / max(all_counts.sum(), 1)
    league["pct"] = all_made / np.maximum(all_counts[:5], 1)
    ftm = sum(p["ftm"] for p in players.values())
    fta = sum(p["fta"] for p in players.values())
    league["ft"] = ftm / fta if fta else 0.78
    # assists a minute by position, and the assisted share of makes by group and zone
    for g in ("G", "F", "C"):
        ps = [p for p in players.values() if p["group"] == g]
        made = sum((p["made"] for p in ps), np.zeros(len(ZONES)))
        amade = sum((p["amade"] for p in ps), np.zeros(len(ZONES)))
        league["groups"][g]["assisted"] = np.where(made > 0, amade / np.maximum(made, 1), DEFAULT_SHARES["assisted"])

    # teams: pace (possessions a team gets in 48 regulation minutes), how
    # often a miss comes back (offensive rebounds), and what each defense allows
    reg_poss = poss[poss["period"] <= 4]
    per_game = reg_poss.groupby(["game_id", "off"]).size().rename("n").reset_index()
    game_pace = per_game.groupby("game_id")["n"].mean()
    teams = {}
    for tid, rows in per_game.groupby("off"):
        teams[abbr.get(int(tid), str(tid))] = {"pace_games": [float(game_pace[g]) for g in rows["game_id"]]}
    # an offensive rebound right after a missed shot (a player's, or a "team" one off
    # the defense out of bounds); not the dead ball between two free throws
    every = season.actions[season.actions["game_id"].isin(kept)]
    after_shot = (every["kind"].shift(1) == "shot") & (every["game_id"].shift(1) == every["game_id"])
    orebs = every[(every["kind"] == "oreb") & (every["player"].notna() | after_shot)]
    missed = shots[~shots["made"].astype(bool)]
    # the defense of each action = the other team in that game
    game_teams = poss.groupby("game_id")["off"].unique()
    other = {(g, int(t)): int(next((x for x in ts if x != t), -1)) for g, ts in game_teams.items() for t in ts}
    def_of = lambda df: [other.get((g, int(t)), -1) for g, t in zip(df["game_id"], df["team"])]  # noqa: E731
    sh = shots.assign(defense=def_of(shots))
    fd = fts.assign(defense=def_of(fts))
    td = tos.assign(defense=def_of(tos))
    od = orebs.assign(defense=def_of(orebs))
    md = missed.assign(defense=def_of(missed))
    # rebounds: each player's boards, the share of each pool a player is credited with (the rest
    # are team rebounds, which no box score gives anyone), and each team's boards given up at each
    # position (its opponents' boards there: offensive off its defense, defensive off its misses)
    rebs = every[every["kind"].isin(("oreb", "dreb")) & every["player"].notna()]
    for pid, kind in zip(rebs["player"].astype(int), rebs["kind"]):
        p = players.get(pid)
        if p is not None:
            p[kind] += 1
    league["pos"] = {}
    for pos in POS5:
        ps = [p for p in players.values() if p["pos"] == pos]
        mins = sum(p["minutes"] for p in ps)
        league["pos"][pos] = {k: (sum(p[k] for p in ps) / mins if mins else DEFAULT_RATES[k]) for k in ("oreb", "dreb", "ast")}
    prev_kind = every["kind"].shift(1)
    prev_made = every["made"].shift(1).fillna(False).astype(bool)
    same = every["game_id"].shift(1) == every["game_id"]
    off_miss = same & (prev_kind == "shot") & ~prev_made
    last_ft = every["type"].fillna("").str.match(r"^Free Throw - (\d) of \1$")
    ft_miss = same & (prev_kind == "ft") & ~prev_made & last_ft.shift(1).fillna(False).astype(bool)
    is_o, is_d, by = every["kind"] == "oreb", every["kind"] == "dreb", every["player"].notna()
    miss_n = float(len(missed))
    o_any = float((off_miss & is_o).sum())
    ft_n = float(((every["kind"] == "ft") & ~every["made"].astype(bool) & last_ft).sum())
    if miss_n and o_any:
        league["oreb_player"] = float((off_miss & is_o & by).sum()) / o_any
        league["dreb_player"] = float((off_miss & is_d & by).sum()) / max(miss_n - o_any, 1)
    if ft_n:
        league["ft_oreb"] = float((ft_miss & is_o & by).sum()) / ft_n
        league["ft_dreb"] = float((ft_miss & is_d & by).sum()) / ft_n
    pos_of = {pid: p["pos"] for pid, p in players.items()}
    rd = rebs.assign(defense=def_of(rebs), pos=[pos_of.get(int(x)) for x in rebs["player"]])
    league["reb_share"] = {}
    for kind in ("oreb", "dreb"):
        k = rd[rd["kind"] == kind]
        total = max(len(k), 1)
        league["reb_share"][kind] = {pos: float((k["pos"] == pos).sum()) / total for pos in POS5}
    for tid, name in abbr.items():
        t = teams.setdefault(name, {"pace_games": []})
        t["oreb"] = [float((orebs["team"] == tid).sum()), float((missed["team"] == tid).sum())]
        t["allowed_oreb"] = [float((od["defense"] == tid).sum()), float((md["defense"] == tid).sum())]
        a = sh[sh["defense"] == tid]
        counts = np.array([(a["zone"] == z).sum() for z in ZONES] + [(fd["defense"] == tid).sum() / 2, (td["defense"] == tid).sum()], float)
        t["allowed"] = counts
        t["allowed_made"] = np.array([a.loc[a["zone"] == z, "made"].sum() for z in ZONES], float)
        made_a = a[a["made"].astype(bool)]
        t["allowed_assisted"] = [float(made_a["assist"].notna().sum()), float(len(made_a))]
        r = rd[rd["defense"] == tid]  # the boards this team's opponents grabbed, by position
        t["reb_pos"] = {kind: {pos: float(((r["kind"] == kind) & (r["pos"] == pos)).sum()) for pos in POS5} for kind in ("oreb", "dreb")}
    league["oreb"] = len(orebs) / max(len(missed), 1)
    made_all = shots[shots["made"].astype(bool)]
    league["assisted"] = float(made_all["assist"].notna().mean()) if len(made_all) else DEFAULT_SHARES["assisted"]
    league["miss_pg"] = len(missed) / max(len(per_game), 1)  # missed shots a team-game (the Misses Coming tag)
    league["pace"] = float(game_pace.mean()) if len(game_pace) else 99.0

    # each team's games for the dials: date, margin, overtime
    ot_games = set(poss.loc[poss["period"] > 4, "game_id"].astype(int))
    tb = reg.drop_duplicates(["game_id", "team_id"])
    history = {}
    for r in tb.sort_values("date").itertuples(index=False):
        if pd.isna(r.team_score) or pd.isna(r.opponent_team_score):
            continue
        history.setdefault(r.team_abbreviation, []).append(
            {"date": r.date, "game": int(r.game_id), "margin": int(r.team_score) - int(r.opponent_team_score), "ot": int(r.game_id) in ot_games})
    return {"players": players, "teams": teams, "league": league, "history": history, "prior": prior or {}}


def pos5(pos) -> str:
    """One of the five positions (the build relabels box scores to them;
    ESPN's G / F / C read as SG / SF / C)."""
    pos = str(pos or "")
    return pos if pos in POS5 else {"G": "SG", "F": "SF", "C": "C"}.get(pos[:1], "SF")


def reb_tilt(inputs: dict, opp: str, pos: str, kind: str) -> float:
    """How much more of the boards (kind oreb / dreb) players at `pos` get
    against `opp` than the league's share there, shrunk by K_POS_REB."""
    share = ((inputs["league"].get("reb_share") or {}).get(kind) or {}).get(pos)
    got = ((inputs["teams"].get(opp) or {}).get("reb_pos") or {}).get(kind)
    if not share or not got:
        return 1.0
    return float((got.get(pos, 0.0) + K_POS_REB * share) / (sum(got.values()) + K_POS_REB) / share)


def glass(inputs: dict, pid: int, opp: str) -> list:
    """[the position tilt tonight (by his offensive / defensive boards' mix),
    his boards a minute against his position's]: the Glass Fit / Tough Glass
    tag reads both sides."""
    p = inputs["players"].get(pid) or {}
    pos = p.get("pos") or pos5(p.get("group"))
    lgp = (inputs["league"].get("pos") or {}).get(pos) or DEFAULT_RATES
    o, d = p.get("oreb", 0.0), p.get("dreb", 0.0)
    w = (o + K_REB * lgp["oreb"]) / max(o + d + K_REB * (lgp["oreb"] + lgp["dreb"]), 1e-9)
    tilt = w * reb_tilt(inputs, opp, pos, "oreb") + (1 - w) * reb_tilt(inputs, opp, pos, "dreb")
    both = lgp["oreb"] + lgp["dreb"]
    own = (o + d) / p["minutes"] / both if p.get("minutes") and both else None
    return [round(tilt, 3), None if own is None else round(own, 3)]


def blowout_starts(poss: pd.DataFrame) -> dict:
    """{game id: seconds into the game it became a blowout for good}: the
    first possession after the last one with the lead under BLOWOUT_LEAD
    (never before BLOWOUT_FROM), for games that end in regulation that way."""
    out = {}
    for gid, g in poss.groupby("game_id"):
        if (g["period"] > 4).any():
            continue
        g = g.sort_values("t0")
        close = np.flatnonzero(np.abs(g["margin"].to_numpy()) < BLOWOUT_LEAD)
        first = close[-1] + 1 if len(close) else 0  # the first possession of the lead that held
        if first >= len(g):
            continue
        start = max(float(g["t0"].iloc[first]), BLOWOUT_FROM)
        if start < REG_SECS:
            out[int(gid)] = start
    return out


def role_minutes(played: float, before: float, start: float) -> float:
    """A blowout night's minutes as his role: his minutes before the blowout
    scaled to 48, only ever DOWN from what he played (BLOWOUT_UP 0)."""
    role = before * REG_SECS / start
    if role >= played and not BLOWOUT_UP:
        return played
    return played + BLOWOUT_SHARE * (role - played)


def minutes_before(stints: pd.DataFrame, starts: dict) -> dict:
    """{(game id, player id): his minutes on the floor before the game's
    blowout start}, for the blowout games."""
    out = {}
    st = stints[stints["game_id"].isin(starts.keys())] if len(stints) else stints
    for gid, a, b, five in zip(st["game_id"], st["t0"], st["t1"], st["five"]):
        secs = min(b, starts[gid]) - a
        if secs <= 0:
            continue
        for pid in five:
            out[(int(gid), int(pid))] = out.get((int(gid), int(pid)), 0.0) + secs / 60
    return out


def prior_block(inputs: dict) -> dict:
    """Last season's rates for next season's start (sim_prior_<season>.json):
    {player id: [position group, minutes, counts (OUTCOMES), made (ZONES),
    ftm, fta]} from a full season's season_inputs."""
    return {str(pid): [p["group"], round(p["minutes"], 1), [round(float(x), 1) for x in p["counts"]],
                       [int(x) for x in p["made"]], int(p["ftm"]), int(p["fta"])]
            for pid, p in inputs["players"].items() if p["minutes"] > 0}


def starting_point(lg: dict, group: str, last) -> tuple:
    """What a player's rates shrink toward and how hard: his last season
    (itself steadied toward the league's position numbers by the K_*), or with
    no last season the league's position numbers alone. Returns (mix, k_mix,
    pct, k_zone, ft, k_ft, use, k_use)."""
    g = lg["groups"][group]
    kz = np.array([K_ZONE[z] for z in ZONES], float)
    if not last:
        return g["mix"], K_MIX, g["pct"], kz, lg["ft"], K_FT, g["use"], K_USE
    _, minutes, counts, made, ftm, fta = last
    counts, made = np.array(counts, float), np.array(made, float)
    mix = (counts + K_MIX * g["mix"]) / (counts.sum() + K_MIX)
    pct = (made + kz * g["pct"]) / (counts[:5] + kz)
    ft = (ftm + K_FT * lg["ft"]) / (fta + K_FT)
    use = (counts.sum() + K_USE * g["use"]) / (minutes + K_USE)
    return mix, K_PRIOR_MIX, pct, np.array([K_PRIOR_ZONE[z] for z in ZONES], float), ft, K_PRIOR_FT, use, K_PRIOR_USE


# ---- the dials ----
def days_between(a: str, b: str) -> int:
    return (Date.fromisoformat(b) - Date.fromisoformat(a)).days


def team_dials(history: list, date: str, opp_history: list) -> list:
    """The dial keys that apply to a team tonight (at most one schedule and
    one last-game dial), from this season's games before `date`."""
    past = [h for h in history if h["date"] < date]
    opp_past = [h for h in opp_history if h["date"] < date]
    out = []
    if past:
        rest = days_between(past[-1]["date"], date) - 1
        opp_rest = days_between(opp_past[-1]["date"], date) - 1 if opp_past else 9
        in4 = sum(1 for h in past if days_between(h["date"], date) <= 3) + 1
        in6 = sum(1 for h in past if days_between(h["date"], date) <= 5) + 1
        if rest == 0 and opp_rest >= 2:
            out.append("rest_edge")
        elif rest == 0:
            out.append("b2b")
        elif in4 >= 3:
            out.append("3in4")
        elif in6 >= 4:
            out.append("4in6")
        last = past[-1]
        if last["ot"] and last["margin"] > 0:
            out.append("ot_win")
        elif last["ot"] and rest <= 1:
            out.append("ot_legs")
        elif 1 <= last["margin"] <= 3:
            out.append("close_win")
        elif last["margin"] >= 20:
            out.append("big_win")
    return out


def dial_points(own: list, opp: list) -> float:
    """Points a team scores above its normal from both teams' dials: its own
    dials' own effect plus the other team's dials' effect on its opponent."""
    return sum(DIAL_INFO[k][1] for k in own) + sum(DIAL_INFO[k][2] for k in opp)


# ---- one team's side of a game ----
def project_minutes(mins: list) -> float:
    """His minutes tonight: season^0.365 x last-5^0.635 (a dip bounces back)."""
    if not mins:
        return 0.0
    season = sum(mins) / len(mins)
    last = mins[-MIN_LAST:]
    recent = sum(last) / len(last)
    if season <= 0 or recent <= 0:
        return season
    return season ** MIN_W_SEASON * recent ** (1 - MIN_W_SEASON)


def fill_minutes(m: np.ndarray, total: float = 240.0) -> np.ndarray:
    """Fits minutes to the team's 240: too many and the smaller roles give
    up the most (the way a coach shortens a rotation; the biggest keep
    theirs); too few (players Out) and everyone's go up in proportion, no one
    past MIN_CAP."""
    m = np.minimum(m.astype(float), MIN_CAP)
    for _ in range(20):
        extra = m.sum() - total
        if extra <= 1e-6:
            break
        room = np.where(m > 0, MIN_CAP - m, 0.0)  # the smaller the role, the more it gives up
        if room.sum() <= 1e-9:  # everyone at the cap: all give up the same share
            m = m * total / m.sum()
            break
        m = np.maximum(0.0, m - extra * room / room.sum())
    for _ in range(10):
        free = m < MIN_CAP - 1e-9
        short = total - m.sum()
        if abs(short) < 1e-6 or not free.any():
            break
        m[free] += short * m[free] / m[free].sum()
        m = np.minimum(m, MIN_CAP)
    return m


def rotation(inputs: dict, team: str, date: str, out_ids: set, roster_team: dict | None = None) -> list:
    """Tonight's players for a team: this season's games, on this team, not
    listed Out, and not a fringe player who has missed the team's last few
    games (a starter who missed them without being listed Out plays)."""
    hist = [h for h in inputs["history"].get(team, []) if h["date"] < date]
    recent_games = {h["game"] for h in hist[-ROTATION_GONE:]}
    out = []
    for pid, p in inputs["players"].items():
        now = (roster_team or {}).get(str(pid), p["team"])
        if now != team or str(pid) in out_ids:
            continue
        games = [(d, m) for d, m in zip(p["dates"], p["min"]) if d < date]
        if not games:
            continue
        avg = sum(m for _, m in games) / len(games)
        if len(hist) >= ROTATION_GONE and avg < 20 and not recent_games & set(p["games"]):
            continue
        if avg < 4:
            continue
        out.append(pid)
    return out


def name_key(name) -> str:
    """A name for matching across sources (first_basket.name_key)."""
    import re
    import unicodedata
    n = unicodedata.normalize("NFD", str(name or ""))
    n = "".join(c for c in n if unicodedata.category(c) != "Mn").lower()
    n = re.sub(r"[^a-z0-9 ]", "", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def lineup_starters(day: dict | None, team: str, home: str, away: str, names: dict) -> set:
    """The ESPN ids of a team's starting five in the NBA's lineups file for
    the night ({games: [{homeTeam, awayTeam: {teamAbbreviation, players}}]}),
    matched by name among `names` ({pid: name}, the team's players); empty
    until the NBA posts all five."""
    code = lambda t: NBA_ABBR.get(t.get("teamAbbreviation"), t.get("teamAbbreviation"))  # noqa: E731
    for g in (day or {}).get("games") or []:
        if code(g.get("homeTeam") or {}) != home or code(g.get("awayTeam") or {}) != away:
            continue
        t = g["homeTeam"] if team == home else g["awayTeam"]
        listed = [x for x in t.get("players") or [] if x.get("rosterStatus") != "Inactive"
                  and x.get("lineupStatus") in ("Confirmed", "Expected")]
        keys = {name_key(n): pid for pid, n in names.items()}
        out = set()
        for x in listed[:5]:
            pid = keys.get(name_key(x.get("playerName")))
            if pid is None:  # a name the two sources spell apart (accents): first name + start of the last
                first, last = name_key(x.get("firstName")), name_key(x.get("lastName"))[:4]
                pid = next((q for k, q in keys.items() if k.startswith(first + " ") and k.split(" ")[-1].startswith(last)), None)
            if pid is not None:
                out.add(pid)
        return out if len(out) == 5 else set()
    return set()


def usual_starter(p: dict, date: str) -> bool:
    """He started at least half his games this season before the date."""
    st = [s for d, s in zip(p["dates"], p["start"]) if d < date]
    return bool(st) and 2 * sum(st) >= len(st)


def starter_minutes(inputs: dict, team: str) -> float:
    """A team's usual minutes for a starter this season."""
    mins = [m for p in inputs["players"].values() if p["team"] == team for m, st in zip(p.get("role_min", p["min"]), p["start"]) if st]
    return sum(mins) / len(mins) if mins else 30.0


def play_chance(inputs: dict, pid: int, team: str, date: str, status: str | None, posted: bool) -> float:
    """His chance to play tonight (PLAY_CHANCE, SHOWS_K)."""
    if posted:
        return 1.0
    chance = PLAY_CHANCE.get(status, 1.0) if status else 1.0
    p = inputs["players"][pid]
    if not usual_starter(p, date):
        mine = [d for d in p["dates"] if d < date]
        team_games = sum(1 for h in inputs["history"].get(team, []) if mine and mine[0] <= h["date"] < date)
        chance *= min(1.0, (len(mine) + SHOWS_K) / (max(team_games, len(mine)) + SHOWS_K))
    return chance


def side(inputs: dict, pids: list, opp: str, make_mult: float, starters: set = frozenset(), starter_min: float = 30.0,
         chance: list | None = None) -> dict:
    """One team's arrays for the sim: minutes, plays a minute, play mix
    (tilted to this defense), make rates (x this defense, the dials, home),
    the chance each plays. starters = tonight's listed five."""
    lg = inputs["league"]
    d = inputs["teams"].get(opp) or {}
    allowed = d.get("allowed")
    if allowed is not None and allowed.sum() > 0:
        tilt = ((allowed + K_MIX * lg["mix"]) / (allowed.sum() + K_MIX)) / np.maximum(lg["mix"], 1e-9)
        dz = (d["allowed_made"] + K_DEF * lg["pct"]) / (allowed[:5] + K_DEF) / np.maximum(lg["pct"], 1e-9)
    else:
        tilt = np.ones(len(OUTCOMES))
        dz = np.ones(len(ZONES))
    # how often this defense's makes allowed come off a pass, against the league
    lg_assisted = lg.get("assisted", DEFAULT_SHARES["assisted"])
    aa = d.get("allowed_assisted") or [0.0, 0.0]
    ast_tilt = (aa[0] + K_DEF_AST * lg_assisted) / (aa[1] + K_DEF_AST) / lg_assisted
    rows = []
    for pid in pids:
        p = inputs["players"][pid]
        mins = p["min"]
        counts, made = p["counts"], p["made"]
        minutes = sum(mins)
        mix0, k_mix, pct0, k_zone, ft0, k_ft, use0, k_use = starting_point(lg, p["group"], inputs.get("prior", {}).get(str(pid)))
        mix = (counts + k_mix * mix0) / (counts.sum() + k_mix)
        mix = mix * tilt ** DEF_MIX_W
        mix = mix / mix.sum()
        pct = (made + k_zone * pct0) / (counts[:5] + k_zone)
        pct = np.clip(pct * dz * make_mult * LEVEL, 0.02, 0.95)
        ft = (p["ftm"] + k_ft * ft0) / (p["fta"] + k_ft)
        use = (counts.sum() + k_use * use0) / (minutes + k_use)
        pos = p.get("pos") or pos5(p["group"])
        lgp = (lg.get("pos") or {}).get(pos) or DEFAULT_RATES
        rate = lambda k, kk: (p.get(k, 0.0) + kk * lgp[k]) / (minutes + kk)  # noqa: E731
        lg_ast = (lg["groups"].get(p["group"]) or {}).get("assisted")
        lg_ast = np.full(len(ZONES), DEFAULT_SHARES["assisted"]) if lg_ast is None else lg_ast
        amade = p.get("amade", np.zeros(len(ZONES)))
        helped = np.clip((amade + K_AST_SHOT * lg_ast) / (made + K_AST_SHOT) * ast_tilt, 0.02, 0.98)
        rows.append({"pid": pid, "min": project_minutes(p.get("role_min", mins)), "use": use, "mix": mix, "pct": pct, "ft": ft,
                     "oreb": rate("oreb", K_REB) * reb_tilt(inputs, opp, pos, "oreb"),
                     "dreb": rate("dreb", K_REB) * reb_tilt(inputs, opp, pos, "dreb"),
                     "pass": rate("ast", K_AST), "helped": helped,
                     "helped_all": float((mix[:5] * pct * helped).sum() / max((mix[:5] * pct).sum(), 1e-9))})
    m = np.array([r["min"] for r in rows], float)
    listed = np.array([pid in starters for pid in pids], bool)
    m = np.where(listed, np.maximum(m, STARTER_TRUST * starter_min), m)
    m = fill_minutes(m) if rows else np.zeros(0)
    if listed.sum() == 5:
        starter = listed
    else:
        starter = np.zeros(len(rows), bool)
        starter[np.argsort(-m)[:5]] = True
    return {"pids": pids, "min": m, "use": np.array([r["use"] for r in rows]), "mix": np.array([r["mix"] for r in rows]),
            "pct": np.array([r["pct"] for r in rows]), "ft": np.array([r["ft"] for r in rows]), "starter": starter,
            "oreb": np.array([r["oreb"] for r in rows]), "dreb": np.array([r["dreb"] for r in rows]),
            "pass": np.array([r["pass"] for r in rows]), "helped_all": np.array([r["helped_all"] for r in rows]),
            "avail": np.array(chance if chance is not None else [1.0] * len(rows), float)}


def team_pace(inputs: dict, team: str) -> float:
    """A team's possessions in 48 minutes, shrunk toward the league."""
    lg = inputs["league"]
    paces = (inputs["teams"].get(team) or {}).get("pace_games") or []
    return (sum(paces) + K_TEAM * lg["pace"]) / (len(paces) + K_TEAM)


def oreb_rate(inputs: dict, team: str, opp: str) -> float:
    """How often the team's miss comes back to it tonight: its own rate and
    what the other defense allows, each against the league (both sides)."""
    lg = inputs["league"]["oreb"]
    rate = lambda pair: (pair[0] + K_OREB * lg) / (pair[1] + K_OREB)  # noqa: E731
    own = rate((inputs["teams"].get(team) or {}).get("oreb") or [0, 0])
    allowed = rate((inputs["teams"].get(opp) or {}).get("allowed_oreb") or [0, 0])
    return float(np.clip(own * allowed / lg, 0.05, 0.5))


# ---- the game ----
SIM_STATS = ("pts", "fg3m", "fg3a", "reb", "ast", "min")  # per player, n x players
POOL_KEYS = ("oreb_player", "dreb_player", "ft_oreb", "ft_dreb")


def simulate(home: dict, away: dict, pace: float, oreb: tuple, n: int = N_SIMS, seed: int = 0, shares: dict | None = None) -> dict:
    """Plays one game n times. home / away from `side`; oreb = (home's chance
    a miss comes back, away's); shares = the league's credited-rebound shares
    (POOL_KEYS, from season_inputs' league). Returns per-team arrays: pts (n x
    players), fg3m, fg3a, reb, ast, min, the team's missed shots, and the home margin."""
    rng = np.random.default_rng(seed)
    sh = {k: (shares or {}).get(k, DEFAULT_SHARES[k]) for k in POOL_KEYS}
    sides = (home, away)
    state = []
    for s, back in zip(sides, oreb):
        k = len(s["pids"])
        # who plays in each game: a player who sits leaves his minutes to the rest (each period's share fills the five)
        on = rng.random((n, k)) < s.get("avail", np.ones(k))[None, :]
        state.append({
            "s": s, "oreb": back, "on": on,
            "minnight": np.exp(rng.normal(0, 1, (n, k)) * (SD_MIN + SD_MIN_STEP * np.maximum(0, SD_MIN_AT - s["min"]))[None, :])
            * np.where(rng.random((n, k)) < SHORT_NIGHT, rng.uniform(*SHORT_KEEP, (n, k)), 1.0) * on,
            "night": np.exp(rng.normal(0, SD_SHOOT, (n, k)) + rng.normal(0, SD_TEAM, (n, 1))),
            "rebnight": np.exp(rng.normal(0, SD_REB, (n, k))), "astnight": np.exp(rng.normal(0, SD_AST, (n, k))),
            "pts": np.zeros((n, k), np.int32), "fg3m": np.zeros((n, k), np.int32), "fg3a": np.zeros((n, k), np.int32),
            "reb": np.zeros((n, k), np.int32), "ast": np.zeros((n, k), np.int32), "miss": np.zeros(n, np.int32),
            "min": np.zeros((n, k)), "f": None,
        })
    game_pace = pace * np.exp(rng.normal(0, SD_PACE, n))
    game_night = np.exp(rng.normal(0, SD_GAME, n))
    score = lambda st: st["pts"].sum(axis=1)  # noqa: E731

    def period(length_min: float, garbage: np.ndarray | None, drag: bool):
        # the night's pace sets the possessions (a game's count swings ~4%, not like a coin's)
        want = game_pace * length_min / 48.0
        poss = np.floor(want + rng.random(n)).astype(np.int64)
        lead = (score(state[0]) - score(state[1])).astype(float)
        tilt = np.clip(LEAD_DRAG * lead, -LEAD_DRAG_MAX, LEAD_DRAG_MAX) if drag else np.zeros(n)
        for st in state:
            st["f"] = None
        for side_i, st in enumerate(state):
            s = st["s"]
            if not len(s["pids"]):
                continue
            mood = game_night * (1 - tilt if side_i == 0 else 1 + tilt)
            f = (s["min"] / 48.0)[None, :] * st["minnight"]
            if garbage is not None:
                cut = np.clip((garbage - GARBAGE_FROM) / (GARBAGE_FULL - GARBAGE_FROM), 0, 1)
                f = np.where(s["starter"][None, :], f * (1 - cut[:, None] * (1 - GARBAGE_FLOOR)), f)
            f = f * 5.0 / f.sum(axis=1, keepdims=True)
            st["f"] = f
            st["min"] += f * length_min
            made_nk = np.zeros((n, len(s["pids"])), np.int64)  # made shots by shooter this period
            trips_nk = np.zeros((n, len(s["pids"])), np.int64)  # trips to the line
            o_pool = np.zeros(n, np.int64)  # offensive boards a player is credited with
            d_pool = np.zeros(n, np.int64)  # defensive boards for the other team's players
            share = f * s["use"][None, :]
            share = share / share.sum(axis=1, keepdims=True)
            # every possession is a play; a missed shot that comes back
            # (an offensive rebound) is another, so misses and second chances go together
            plays = poss
            for _ in range(4):
                counts = rng.multinomial(plays, share)
                misses = np.zeros(n, np.int64)
                for j in range(len(s["pids"])):
                    out = rng.multinomial(counts[:, j], s["mix"][j])
                    p = np.clip(s["pct"][j][None, :] * (st["night"][:, j] * mood)[:, None], 0.01, 0.97)
                    made = rng.binomial(out[:, :5], p)
                    ftm = rng.binomial(2 * out[:, 5], min(0.99, s["ft"][j]))
                    made_nk[:, j] += made.sum(axis=1)
                    trips_nk[:, j] += out[:, 5]
                    st["pts"][:, j] += (made * np.where(THREE, 3, 2)).sum(axis=1) + ftm
                    st["fg3m"][:, j] += made[:, 3] + made[:, 4]
                    st["fg3a"][:, j] += out[:, 3] + out[:, 4]
                    misses += (out[:, :5] - made).sum(axis=1)
                st["miss"] += misses.astype(np.int32)
                plays = rng.binomial(misses, st["oreb"])
                o_pool += rng.binomial(plays, sh["oreb_player"] * REB_LEVEL)
                d_pool += rng.binomial(misses - plays, sh["dreb_player"] * REB_LEVEL)
                if not plays.any():
                    break
            # once a period (one draw each, not one a play: the sim's speed): the assisted makes
            # (his assisted share over his makes' usual zones) and the boards off a missed last free throw
            helped = rng.binomial(made_nk, s["helped_all"][None, :]) if "helped_all" in s else np.zeros_like(made_nk)
            last_miss = rng.binomial(trips_nk, np.clip(1 - s["ft"], 0.01, 0.99)[None, :]).sum(axis=1)
            ft_o = rng.binomial(last_miss, sh["ft_oreb"] * REB_LEVEL)
            o_pool += ft_o
            d_pool += rng.binomial(last_miss - ft_o, min(1.0, REB_LEVEL * sh["ft_dreb"] / max(1 - sh["ft_oreb"], 1e-9)))
            st["pools"] = (helped, o_pool, d_pool)
        # the boards and the assists, to the players on the floor this period
        for side_i, st in enumerate(state):
            s, other = st["s"], state[1 - side_i]
            if st["f"] is None or "oreb" not in s:
                continue
            helped, o_pool, d_pool = st["pools"]
            st["reb"] += draw(rng, o_pool, st["f"] * s["oreb"][None, :] * st["rebnight"])
            if other["f"] is not None and "dreb" in other["s"]:
                other["reb"] += draw(rng, d_pool, other["f"] * other["s"]["dreb"][None, :] * other["rebnight"])
            # a teammate on the floor gets it, never the shooter: passer i's share of shooter j's
            # assisted makes is w_i / (W - w_j), so one draw a period with each passer's expected
            # count exactly that (sum over the other shooters; 13 draws a period cost a second a game)
            w = st["f"] * s["pass"][None, :] * st["astnight"]
            r = helped / np.maximum(w.sum(axis=1, keepdims=True) - w, 1e-12)
            st["ast"] += draw(rng, helped.sum(axis=1), w * (r.sum(axis=1, keepdims=True) - r))

    for q in range(4):
        garbage = np.abs(score(state[0]) - score(state[1])) if q == 3 else None
        period(12.0, garbage, q > 0)
    for _ in range(4):
        tied = score(state[0]) == score(state[1])
        if not tied.any():
            break
        before = [{k: st[k].copy() for k in SIM_STATS + ("miss",)} for st in state]
        period(5.0, None, False)
        for st, b in zip(state, before):  # only the tied games play it
            for k in SIM_STATS:
                st[k] = np.where(tied[:, None], st[k], b[k])
            st["miss"] = np.where(tied, st["miss"], b["miss"])
    return {"home": state[0], "away": state[1], "margin": score(state[0]) - score(state[1]),
            "total": score(state[0]) + score(state[1])}


def draw(rng, counts: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """counts (n,) handed out over the players by weights (n x players)."""
    total = weights.sum(axis=1, keepdims=True)
    p = np.where(total > 0, weights / np.where(total > 0, total, 1), 1.0 / weights.shape[1])
    return rng.multinomial(counts, p).astype(np.int32)


def team_now(inputs: dict, team: str, date: str, roster_team: dict | None) -> dict:
    """{pid: name} of everyone on the team tonight with a game this season."""
    return {pid: p["name"] for pid, p in inputs["players"].items()
            if (roster_team or {}).get(str(pid), p["team"]) == team and any(d < date for d in p["dates"])}


def game(inputs: dict, home: str, away: str, date: str, out_ids: set, roster_team: dict | None = None,
         n: int = N_SIMS, seed: int = 0, dials: bool = True, lineups: dict | None = None, hurt: set = frozenset(),
         status: dict | None = None) -> dict:
    """One game, start to finish: tonight's rotations (lineups = the NBA's
    lineups file for the night, for the starting fives; hurt = ids on the
    injury report but not Out; status = {id: injury status} for the chance to
    play), the dials, the sim. "sat" = {home, away: the players who'd be in the
    rotation but sit tonight}."""
    hd = team_dials(inputs["history"].get(home, []), date, inputs["history"].get(away, [])) if dials else []
    ad = team_dials(inputs["history"].get(away, []), date, inputs["history"].get(home, [])) if dials else []
    h_mult = 1 + (HOME_EDGE / 2 + dial_points(hd, ad)) / PTS_BASE
    a_mult = 1 + (-HOME_EDGE / 2 + dial_points(ad, hd)) / PTS_BASE
    built, sat = {}, {}
    for team, opp, mult in ((home, away, h_mult), (away, home, a_mult)):
        names = team_now(inputs, team, date, roster_team)
        starters = lineup_starters(lineups, team, home, away, {pid: nm for pid, nm in names.items() if str(pid) not in out_ids})
        gone = set(out_ids)
        if starters:  # the five is posted: a usual starter on the injury report who isn't in it sits
            gone |= {str(pid) for pid in names if str(pid) in hurt and pid not in starters and usual_starter(inputs["players"][pid], date)}
        pids = rotation(inputs, team, date, gone, roster_team)
        pids += [pid for pid in starters if pid not in pids]  # a listed starter plays, whatever his last few games
        sat[team] = [pid for pid in rotation(inputs, team, date, set(), roster_team) if pid not in pids]
        chance = [play_chance(inputs, pid, team, date, (status or {}).get(str(pid)), pid in starters) for pid in pids]
        built[team] = side(inputs, pids, opp, mult, starters, starter_minutes(inputs, team), chance)
    hs, aw = built[home], built[away]
    pace = (team_pace(inputs, home) + team_pace(inputs, away)) / 2
    out = simulate(hs, aw, pace, (oreb_rate(inputs, home, away), oreb_rate(inputs, away, home)), n, seed, inputs["league"])
    out.update({"home_dials": hd, "away_dials": ad, "sat": {"home": sat[home], "away": sat[away]},
                "glass": {str(pid): glass(inputs, pid, opp) for side_, opp in ((hs, away), (aw, home)) for pid in side_["pids"]}})
    return out


# ---- what the page reads ----
def scripts(margin: np.ndarray) -> dict:
    """{name: mask}: away by SCRIPT_MARGIN+, close, home by SCRIPT_MARGIN+."""
    return {"all": np.ones(len(margin), bool), "away": margin <= -SCRIPT_MARGIN,
            "close": np.abs(margin) < SCRIPT_MARGIN, "home": margin >= SCRIPT_MARGIN}


def ladder(values: np.ndarray) -> list:
    """[first k, chances of k or more in permille for k = first .. last]: from
    the 2nd percentile to the 99.5th, so any line in that range can be priced."""
    if not len(values):
        return [0, []]
    lo = max(0, int(np.percentile(values, 2)))
    hi = max(lo + 1, int(np.percentile(values, 99.5)) + 1)
    counts = np.bincount(np.clip(values, 0, hi), minlength=hi + 1)
    at_least = counts[::-1].cumsum()[::-1] / len(values)
    return [lo, [int(round(1000 * at_least[k])) for k in range(lo, hi + 1)]]


def at_least(lad: list, k: int) -> float:
    """Chance of k or more from a `ladder`."""
    lo, xs = lad
    if not xs:
        return 0.0
    if k <= lo:
        return xs[0] / 1000 if k == lo else 1.0
    i = k - lo
    return xs[i] / 1000 if i < len(xs) else 0.0


def chance_over(lad: list, line: float) -> float:
    """Chance of going over a line (a whole-number line's push left out)."""
    if float(line).is_integer():
        k = int(line)
        over, push = at_least(lad, k + 1), at_least(lad, k) - at_least(lad, k + 1)
        return over / max(1 - push, 1e-9)
    return at_least(lad, math.floor(line) + 1)


def summary(out: dict, names: dict) -> dict:
    """props.json `sim[<game>]`: the game (median margin and total, the script
    shares) and every player: minutes, his chance to play (`plays`), and per
    stat the median in each script and the ladder (all / away / close / home),
    all from the games he plays."""
    masks = scripts(out["margin"])
    shares = {k: round(float(m.mean()), 3) for k, m in masks.items() if k != "all"}
    players = {}
    for key in ("home", "away"):
        st = out[key]
        for j, pid in enumerate(st["s"]["pids"]):
            on = st["on"][:, j]  # his numbers: only the games he plays (a book voids a no-show)
            if not on.any():
                continue
            row = {"team": key, "min": round(float(st["min"][on, j].mean()), 1), "name": names.get(pid, str(pid)),
                   "plays": round(float(on.mean()), 2)}
            row["glass"] = (out.get("glass") or {}).get(str(pid))
            for stat in STATS.values():
                v = st[stat][:, j]
                masks_on = {k: m & on for k, m in masks.items()}
                v_on = v[on]
                row[stat] = {
                    "med": {k: (float(np.median(v[m])) if m.sum() else None) for k, m in masks_on.items()},
                    "mean": round(float(v_on.mean()), 2),
                    "lad": {k: ladder(v[m]) for k, m in masks_on.items() if m.sum() >= 200},
                }
            players[str(pid)] = row
    misses = {k: round(float(out[k]["miss"].mean()), 1) for k in ("home", "away") if "miss" in out[k]}
    return {"margin": float(np.median(out["margin"])), "total": float(np.median(out["total"])), "misses": misses,
            "margin_mean": round(float(out["margin"].mean()), 1), "total_mean": round(float(out["total"].mean()), 1),
            "scripts": shares, "dials": {"home": out["home_dials"], "away": out["away_dials"]}, "players": players}


# ---- tonight's plays ----
# Every player's main line (the line most books hang), Over and Under, at the
# best price across the books, against the sim's chance there. A play = his
# better side with MIN_EDGE+ (points of chance over what the price needs to
# break even), every one of them, like the NHL pages (the owner, 2026-10-25:
# "Why only 8 plays?! display everything with its edge just like hockey is";
# main lines only, "most users are going to play his under X - x being his
# main line": a ladder rung is a tag on the page, never the play). Every play
# is Strong (the owner, 2026-10-26: "can we not say TOP PLAY anymore - just
# call everything STRONG"; 10-24 to 10-25's Top Plays count as Strong in the
# record). A play is graded at its best
# price at tip-off, 1 unit, Points and Threes apart. (2026-10-24 and 10-25:
# the best of every rung, one a game, 8 a night.)
STATS = {"points": "pts", "threes": "fg3m", "rebounds": "reb", "assists": "ast"}  # book market -> the sim's stat (= the game log's field)
MIN_EDGE = 0.04
PRICE_RANGE = (-250, 400)  # past +400 a rung's chance rests on a few hundred sims' tails
MIN_GAMES = 2              # games this season before his numbers can make a play (3 left no one on 2026-10-24:
                           # every team had played 2; his rates already lean on his position's league numbers)
MIN_MINUTES = 18           # minutes the sim gives him


def implied(price) -> float:
    return 100 / (price + 100) if price > 0 else -price / (-price + 100)


def best_prices(quotes: list) -> dict:
    """{(side, line): (price, book)}: the best price across the books at each
    line ("o" / "u"); quotes are [book, side, line, price, (the bet link)]."""
    out = {}
    for book, side_, line, price in (q[:4] for q in quotes):
        if line is None or price is None:
            continue
        key = (side_, float(line))
        if key not in out or implied(price) < implied(out[key][0]):
            out[key] = (price, book)
    return out


def side_chance(lad: list, side_: str, line: float) -> float:
    over = chance_over(lad, line)
    return over if side_ == "o" else 1 - over


def kind_of(script_chances: dict, needs: float) -> str | None:
    """Script-Proof (beats its price in every script the sims play enough),
    Chaos (loses in a close game, wins when it goes sideways), Close (only a
    close game), or None."""
    have = {k: v for k, v in script_chances.items() if v is not None}
    if not have:
        return None
    if all(v >= needs for v in have.values()):
        return "proof"
    close = have.get("close")
    sideways = [v for k, v in have.items() if k != "close"]
    if close is not None and close < needs and any(v >= needs for v in sideways):
        return "chaos"
    if close is not None and close >= needs:
        return "close"
    return None


def player_best(row: dict, stat_key: str, quotes: list, main_line) -> dict | None:
    """His better side at the main line for one market, or None."""
    lad = row[stat_key]["lad"]
    if "all" not in lad:
        return None
    best = None
    for (side_, line), (price, book) in best_prices(quotes).items():
        if main_line is None or line != float(main_line) or not PRICE_RANGE[0] <= price <= PRICE_RANGE[1]:
            continue
        chance = side_chance(lad["all"], side_, line)
        edge = chance - implied(price)
        if best is None or edge > best["edge"]:
            best = {"side": side_, "line": line, "price": price, "book": book, "chance": round(chance, 4), "edge": round(edge, 4), "main": True}
    if best is None:
        return None
    needs = implied(best["price"])
    best["scripts"] = {k: (round(side_chance(lad[k], best["side"], best["line"]), 4) if k in lad else None) for k in ("away", "close", "home")}
    best["kind"] = kind_of(best["scripts"], needs)
    return best


def middle_line(quotes: list):
    ls = sorted(float(q[2]) for q in quotes if q[2] is not None)
    return ls[len(ls) // 2] if ls else None


# ---- start from the line (the owner, 2026-10-28: "Start from the line") ----
# REVERSES 2026-10-24's "the line is never an input". Points + Threes went
# -12.0u over 10-24..27 (the sim said 62%, hit 48%); on the players who played
# the book's main line missed points by 4.84, the sim by 5.54. A replay of those
# four nights: center each player's simulated MIDDLE (median, not mean: points
# skew right, so centering the mean leaves fake under edges) on the main line,
# then move it LINE_NUDGE of the way toward the sim's own median, keeping the
# sim's spread and shape. With MIN_EDGE 4: 85-89, +2.2u, the top half by edge
# +2.8u vs the bottom half -14.7u. Break-even on four nights, not a proven edge;
# the record grades it.
LINE_NUDGE = 0.35


def shift_ladder(lad: list, d: float) -> list:
    """A `ladder` with every outcome moved by d (any size, not just whole
    numbers). Each whole number k is spread evenly over k-0.5 .. k+0.5, moved,
    and read back as whole numbers: the chance of k or more = the chance the
    moved value is past k - 0.5. Threes and points alike; d = 0 gives the same
    ladder back. Nothing goes below 0 (a moved 0 stays 0)."""
    lo, xs = lad
    if not xs or not d:
        return lad
    hi = lo + len(xs) - 1

    def past(t):  # chance the spread-out sim value is past t
        j = math.floor(t + 0.5)
        here = at_least(lad, j) - at_least(lad, j + 1)
        return at_least(lad, j + 1) + here * (j + 0.5 - t)
    new_lo = max(0, math.floor(lo + d))
    new_hi = max(new_lo + 1, math.ceil(hi + d) + 1)
    out = [round(1000 * past(k - 0.5 - d), 1) for k in range(new_lo, new_hi + 1)]
    if new_lo == 0:
        out[0] = 1000.0
    return [new_lo, out]


def nudge_to_line(sim_game: dict, props: dict) -> None:
    """Moves every player's outcomes (each script's ladder and median, the
    mean) so his median sits at line + LINE_NUDGE x (sim median - line), at
    his main line (`middle_line`) per market, in place. A player with no main
    line keeps the sim's own. `sim_med` keeps the sim's own medians, `nudge`
    the move, `line` the line it started from."""
    for market, stat in STATS.items():
        main = props.get(market) or {}
        for pid, row in sim_game["players"].items():
            block = row.get(stat)
            line = middle_line((main.get(pid) or {}).get("q") or [])
            if not block or line is None or block["med"].get("all") is None or "nudge" in block:
                continue
            d = (1 - LINE_NUDGE) * (line - block["med"]["all"])
            block["lad"] = {k: shift_ladder(lad, d) for k, lad in block["lad"].items()}
            block["sim_med"] = block["med"]
            block["med"] = {k: (round(v + d, 2) if v is not None else None) for k, v in block["med"].items()}
            if "mean" in block:
                block["mean"] = round(block["mean"] + d, 2)
            block["line"], block["nudge"] = line, round(d, 2)


def game_candidates(gid: str, game_row: dict, sim_game: dict, props: dict, games_played: dict, market: str) -> list:
    """Every eligible player's play in one game for one market (points /
    threes): his better side at the main line, MIN_EDGE+, best first. props =
    the game's book_odds props; only the main market is read (a ladder rung
    is never the play)."""
    stat = STATS[market]
    main = props.get(market) or {}
    out = []
    for pid, row in sim_game["players"].items():
        if row["min"] < MIN_MINUTES or games_played.get(pid, 0) < MIN_GAMES:
            continue
        quotes = (main.get(pid) or {}).get("q") or []
        if not quotes:
            continue
        best = player_best(row, stat, quotes, middle_line(quotes))
        if best is None or best["edge"] < MIN_EDGE:
            continue
        team = game_row["home"] if row["team"] == "home" else game_row["away"]
        opp = game_row["away"] if row["team"] == "home" else game_row["home"]
        dials = sim_game["dials"][row["team"]] + sim_game["dials"]["away" if row["team"] == "home" else "home"]
        out.append({"game": gid, "date": game_row["date"], "pid": pid, "team": team, "opp": opp, "stat": market,
                    "med": row[stat]["med"]["all"], "dials": dials, **best})
    return sorted(out, key=lambda c: -c["edge"])


def pick_plays(candidates: list) -> list:
    """The night's plays: every candidate (each MIN_EDGE+ already), best
    first, every one Strong."""
    picked = sorted(candidates, key=lambda c: -c["edge"])
    for p in picked:
        p["tier"] = "strong"
    return picked


# The record: model_history/nba_props/sim_<season>.json = {game id: {"date",
# "points": [play], "threes": [play]}} as the last build before tip-off had
# them (a started game is never rewritten); a play = PLAY_FIELDS.
PLAY_FIELDS = ["pid", "side", "line", "price", "book", "chance", "edge", "tier", "kind", "main", "dials"]


def ledger(record: dict, logs: dict, market: str) -> list:
    """The shared YTD tracker's rows (site ytd.js): [date, edge, won 1/0,
    units at its price, tags], oldest first. logs = {(game id, player id):
    the stat}; a player who didn't play or a push isn't graded."""
    out = []
    for gid, g in record.items():
        for row in g.get(market) or []:
            p = dict(zip(PLAY_FIELDS, row))
            got = logs.get((str(gid), str(p["pid"])))
            if got is None or got == p["line"]:
                continue
            over = p["side"] == "o"
            won = (got > p["line"]) == over
            units = (p["price"] / 100 if p["price"] > 0 else 100 / -p["price"]) if won else -1.0
            tags = ["strong", "over" if over else "under", "main" if p["main"] else "alt"]  # a 10-24 / 10-25 "top" too
            if p["kind"]:
                tags.append(p["kind"])
            if p["dials"]:
                tags.append("dials")
            out.append([g["date"], p["edge"], int(won), round(units, 3), tags])
    return sorted(out, key=lambda r: (r[0], -r[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2027)
    ap.add_argument("--data-dir", default="data/nba")
    ap.add_argument("--home")
    ap.add_argument("--away")
    ap.add_argument("--date")
    ap.add_argument("--write-prior", action="store_true", help="save this (finished) season as next season's starting point")
    args = ap.parse_args()
    d = Path(__file__).resolve().parents[2] / args.data_dir
    if args.write_prior:
        box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
        block = prior_block(season_inputs(P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box), box))
        out = Path(__file__).resolve().parent / f"sim_prior_{args.season}.json"
        out.write_text(json.dumps(block, separators=(",", ":")))
        print(f"{len(block)} players -> {out.name}")
        return
    box = pd.read_parquet(d / f"player_box_{args.season}.parquet")
    season = P.Season(pd.read_parquet(d / f"play_by_play_{args.season}.parquet"), box)
    inputs = season_inputs(season, box, args.date)
    import time
    t = time.time()
    out = game(inputs, args.home, args.away, args.date, set())
    print(f"{N_SIMS} games in {time.time() - t:.1f}s; dials {out['home_dials']} / {out['away_dials']}")
    s = summary(out, {pid: p["name"] for pid, p in inputs["players"].items()})
    print(f"home pts {out['home']['pts'].sum(1).mean():.1f} away {out['away']['pts'].sum(1).mean():.1f}")
    print(f"home margin median {s['margin']:+.0f} (mean {s['margin_mean']:+.1f}), total {s['total']:.0f}; scripts {s['scripts']}")
    for pid, r in sorted(s["players"].items(), key=lambda kv: -kv[1]["pts"]["mean"]):
        print(f"  {r['team']:4} {r['name']:26} {r['min']:5.1f} min  pts {r['pts']['mean']:5.1f} (med {r['pts']['med']['all']:.0f})"
              f"  3PM {r['fg3m']['mean']:.2f}  reb {r['reb']['mean']:.1f}  ast {r['ast']['mean']:.1f}")


if __name__ == "__main__":
    main()
