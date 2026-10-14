"""Walk-forward replay for an NHL anytime-goal model (not built yet: this is
step 1, deciding whether it's worth building and what goes in it).

Every skater in every game of a season is projected ONLY from that season's
games before it, the way the live build would run (the owner's rule: this
season only, the league's own yardsticks included). It answers:

  1. Expected goals: how much is a shot worth from where and how it was
     taken (area, distance, angle, shot type, rebound, rush, power play)?
     Fitted only on the season's games before each day, refitted weekly.
  2. Does "his expected goals a minute x his minutes x the matchup" predict
     goals better than his goals a game, or his shots x the league's
     shooting %? Which matchup pieces earn their place (the defense's
     expected goals allowed, tonight's goalie, the areas he shoots from, his
     own finishing, the power play, his line, home / rest)?
  3. Honest chances: when it says 30% to score, does he score 30% of the time?
  4. The Zone Match flag (the owner's idea, 2026-10-14: Brandsegg-Nygard
     takes his shots from the low slot, New Jersey gives up goals there):
     when a player's heavy area lines up with a defense that gives up a lot
     from it, does he score MORE than the model already expected? Tested
     three ways for the defense side: shots allowed from the area, goals
     allowed from it, and tonight's goalie in that area.

    python tools/backtest/nhl_goals.py 2026          (replay 2025-26)
    python tools/backtest/nhl_goals.py 2026 2025     (2025-26 and 2024-25, each its own replay)

What it can NOT say: whether any of this beats the price. There is no free
history of anytime-goal prices; Novig's market-implied team totals can't be
replayed either. The site would keep its own record from launch.
"""
import argparse
import gzip
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_nhl as b  # noqa: E402
import shots_model as sm  # noqa: E402
from nhl_shots import DATA, deviance, game_slots, load_previews, poisson_fit  # noqa: E402

AREAS = b.AREAS
TYPES = ("wrist", "snap", "slap", "backhand", "tip", "other")
MIN_GAMES = 5          # his games this season before a projection is judged
REFIT_DAYS = 7         # the expected-goals table is refitted this often
DECAY = 0.985          # each game further back counts this much (the shots model's)
PAD_MINUTES = 50       # minutes of an average skater with his ice time mixed into his rate
TEAM_PAD_GAMES = 20    # games of a league-average defense mixed into a defense's numbers
GOALIE_PAD_XG = 25     # expected goals of an average goalie mixed into a goalie's record
FINISH_PAD_XG = 8      # expected goals of an average finisher mixed into his goals / expected goals
AREA_PAD = 40          # shots at his position's usual spots mixed into where he shoots from
X_KEYS = ("opp", "goalie", "area", "finish", "pp", "line", "home", "b2b", "opp_b2b")


# ---- shots, one game ----
def game_shots(raw: dict) -> list:
    """Every unblocked shot with a goalie in net (no empty nets, penalty
    shots or shootouts), with what an expected-goals table reads."""
    pbp = raw["pbp"]
    home, away = pbp["homeTeam"], pbp["awayTeam"]
    abbr = {home["id"]: home["abbrev"], away["id"]: away["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    plays = sorted(pbp.get("plays") or [], key=lambda p: p.get("sortOrder", 0))
    directions = b.attack_directions(plays, team_of, home["id"])
    out, prev = [], None
    for p in plays:
        period = p.get("periodDescriptor") or {}
        if period.get("periodType") == "SO":
            continue
        d = p.get("details") or {}
        kind = p.get("typeDescKey")
        t = (period.get("number") or 0) * 1200 + b.clock_seconds(p.get("timeInPeriod"))
        owner = d.get("eventOwnerTeamId")
        if kind in ("goal", "shot-on-goal", "missed-shot"):
            shooter = d.get("scoringPlayerId") or d.get("shootingPlayerId")
            team_id = team_of.get(shooter, owner)
            man = b.strength(p.get("situationCode"), team_id == home["id"])
            spot = b.normalize_xy(d, directions.get((period.get("number"), team_id)))
            if team_id in abbr and man not in ("en", "ps", "extra") and spot:
                x, y = spot
                rebound = rush = False
                if prev and prev["period"] == period.get("number") and t - prev["t"] <= 4:
                    rebound = prev["shot"] and prev["team"] == team_id and t - prev["t"] <= 3
                    # The play before was outside his team's attacking zone (the
                    # rink's x read from his end): a rush.
                    rush = not prev["shot"] and prev["x"] is not None and prev["x"] * directions.get((period.get("number"), team_id), 1) < b.BLUE_LINE_X
                out.append({
                    "shooter": str(shooter), "team": abbr[team_id], "goalie": str(d.get("goalieInNetId")),
                    "area": b.shot_area(x, y), "dist": math.hypot(b.GOAL_LINE_X - x, y),
                    "angle": abs(math.degrees(math.atan2(y, b.GOAL_LINE_X - x))) if x <= b.GOAL_LINE_X else 90.0,
                    "type": b.SHOT_TYPES.get(d.get("shotType"), "other"), "rebound": rebound, "rush": rush,
                    "pp": man == "pp", "sh": man == "sh", "goal": kind == "goal",
                })
        if kind in ("goal", "shot-on-goal", "missed-shot", "blocked-shot", "hit", "giveaway", "takeaway", "faceoff"):
            prev = {"t": t, "period": period.get("number"), "team": owner, "x": d.get("xCoord"),
                    "shot": kind in ("goal", "shot-on-goal", "missed-shot", "blocked-shot")}  # a blocked shot's owner is the shooting team
    return out


def load_season(season: int) -> list:
    folder = DATA / "games" / str(season)
    games = []
    for path in sorted(folder.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        record = b.reduce_game(raw)
        record["shots"] = game_shots(raw)
        games.append(record)
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


# ---- expected goals ----
def xg_features(s: dict) -> list:
    return [
        1.0, math.log(max(s["dist"], 1.0)), s["angle"] / 45,
        *(1.0 if s["area"] == a else 0.0 for a in AREAS[1:]),
        *(1.0 if s["type"] == t else 0.0 for t in TYPES[1:]),
        float(s["rebound"]), float(s["rush"]), float(s["pp"]), float(s["sh"]),
    ]


XG_NAMES = ["const", "log dist", "angle/45", *(f"area {a}" for a in AREAS[1:]), *(f"type {t}" for t in TYPES[1:]), "rebound", "rush", "pp", "sh"]


def fit_xg(shots: list) -> np.ndarray:
    """Logistic regression (Newton's method, a touch of ridge)."""
    X = np.array([xg_features(s) for s in shots])
    y = np.array([s["goal"] for s in shots], dtype=float)
    w = np.zeros(X.shape[1])
    w[0] = math.log(y.mean() / (1 - y.mean()))
    for _ in range(30):
        p = 1 / (1 + np.exp(-(X @ w)))
        grad = X.T @ (y - p) - 1.0 * w * (np.arange(len(w)) > 0)
        hess = X.T @ (X * (p * (1 - p))[:, None]) + 1.0 * np.diag(np.arange(len(w)) > 0)
        step = np.linalg.solve(hess, grad)
        w += step
        if np.abs(step).max() < 1e-7:
            break
    return w


def xg_of(shots: list, w: np.ndarray | None, area_rate: dict) -> None:
    for s in shots:
        if w is None:
            s["xg"] = area_rate.get(s["area"], 0.07)
        else:
            s["xg"] = float(1 / (1 + math.exp(-sum(a * c for a, c in zip(xg_features(s), w)))))


# ---- the replay ----
class GoalsState:
    """Everything the goal projection reads, from this season's games so far."""

    def __init__(self):
        self.players = {}   # pid -> decayed totals
        self.teams = {}     # team -> allowed totals (season, not decayed)
        self.goalies = {}   # goalie -> {xg, g, n}
        self.league = Counter()

    def player(self, pid):
        return self.players.setdefault(pid, {"toi": 0.0, "xg": 0.0, "g": 0.0, "gx": 0.0, "pp_xg": 0.0, "areas": Counter(), "raw_areas": Counter(), "games": 0, "goals_season": 0, "sog_season": 0})

    def add_game(self, r: dict) -> None:
        by_shooter = {}
        for s in r["shots"]:
            by_shooter.setdefault(s["shooter"], []).append(s)
            other = r["away"] if s["team"] == r["home"] else r["home"]
            t = self.teams.setdefault(other, Counter())
            t["xg"] += s["xg"]
            t["g"] += s["goal"]
            t[f"n_{s['area']}"] += 1
            t[f"xg_{s['area']}"] += s["xg"]
            t[f"g_{s['area']}"] += s["goal"]
            t["pp_xg"] += s["xg"] if s["pp"] else 0
            self.league["xg"] += s["xg"]
            self.league["g"] += s["goal"]
            self.league[f"n_{s['area']}"] += 1
            self.league[f"xg_{s['area']}"] += s["xg"]
            self.league[f"g_{s['area']}"] += s["goal"]
            self.league["pp_xg"] += s["xg"] if s["pp"] else 0
            g = self.goalies.setdefault(s["goalie"], Counter())
            g["xg"] += s["xg"]
            g["g"] += s["goal"]
            g[f"xg_{s['area']}"] += s["xg"]
            g[f"g_{s['area']}"] += s["goal"]
        for team in (r["home"], r["away"]):
            self.teams.setdefault(team, Counter())["games"] += 1
            self.league["team_games"] += 1
        for pid, line in r["skaters"].items():
            p = self.player(pid)
            grp = sm.group(line["pos"])
            mine = by_shooter.get(pid, [])
            xg = sum(s["xg"] for s in mine)
            p["toi"] = p["toi"] * DECAY + line["toi"]
            p["xg"] = p["xg"] * DECAY + xg
            goals_located = sum(s["goal"] for s in mine)
            p["g"] = p["g"] * DECAY + goals_located
            p["gx"] = p["gx"] * DECAY + xg
            p["pp_xg"] = p["pp_xg"] * DECAY + sum(s["xg"] for s in mine if s["pp"])
            for a in list(p["areas"]):
                p["areas"][a] *= DECAY
            for s in mine:
                p["areas"][s["area"]] += 1
                p["raw_areas"][s["area"]] += 1
                self.league[f"{grp}_a_{s['area']}"] += 1
            p["games"] += 1
            p["goals_season"] += line["g"]
            p["sog_season"] += line["sog"]
            p["pos"] = line["pos"]
            self.league[f"{grp}_toi"] += line["toi"]
            self.league[f"{grp}_xg"] += xg
            self.league[f"{grp}_g"] += line["g"]
            self.league[f"{grp}_sog"] += line["sog"]
            self.league[f"{grp}_games"] += 1

    # ---- pieces ----
    def allowed_factor(self, team: str, key: str) -> float:
        t = self.teams.get(team) or Counter()
        games = self.league["team_games"]
        league = self.league[key] / games if games else 0
        if not league:
            return 1.0
        return ((t[key] + TEAM_PAD_GAMES * league) / (t["games"] + TEAM_PAD_GAMES)) / league

    def goalie_factor(self, goalie: str | None) -> float:
        """His goals allowed against his expected goals, with an average goalie mixed in (1.0 = average)."""
        g = self.goalies.get(goalie) or Counter()
        lg = self.league["g"] / self.league["xg"] if self.league["xg"] else 1.0
        return (g["g"] + GOALIE_PAD_XG * lg) / (g["xg"] + GOALIE_PAD_XG) / lg

    def shares(self, p: dict, grp: str) -> dict:
        total_lg = sum(self.league[f"{grp}_a_{a}"] for a in AREAS)
        total = sum(p["areas"].values()) + AREA_PAD
        return {a: (p["areas"][a] + AREA_PAD * (self.league[f"{grp}_a_{a}"] / total_lg if total_lg else 0)) / total for a in AREAS}

    def ranks(self, key: str) -> dict:
        """1 = allows the most a game, among teams with games."""
        rows = sorted(((t[key] / t["games"], team) for team, t in self.teams.items() if t["games"]), reverse=True)
        return {team: i + 1 for i, (_, team) in enumerate(rows)}


def replay(games: list, previews: dict) -> dict:
    shots_model = sm.ShotsModel()
    state = GoalsState()
    xg_w, history, last_fit = None, [], None
    last_played, rows = {}, []
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    dates = sorted(by_date)
    for n, date in enumerate(dates):
        day = np.datetime64(date)
        # Refit the expected-goals table on the season's shots so far.
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(REFIT_DAYS, "D")):
            xg_w, last_fit = fit_xg(history), day
        area_rate = {a: (state.league[f"g_{a}"] + 1) / (state.league[f"n_{a}"] + 12) for a in AREAS}
        for r in by_date[date]:
            xg_of(r["shots"], xg_w, area_rate)
        # League yardsticks for tonight.
        lg_goal_rank = {a: state.ranks(f"g_{a}") for a in AREAS}
        lg_shot_rank = {a: state.ranks(f"n_{a}") for a in AREAS}
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            for pid, line in r["skaters"].items():
                p = state.players.get(pid)
                if not p or p["games"] < MIN_GAMES:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = shots_model.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid))
                if parts is None:
                    continue
                grp = parts["group"]
                minutes = parts["minutes"]
                lg_rate = state.league[f"{grp}_xg"] / state.league[f"{grp}_toi"] * 60 if state.league[f"{grp}_toi"] else 0
                role = shots_model.role(grp, minutes)
                pad = PAD_MINUTES
                xg_rate = (p["xg"] + pad * lg_rate * role) / (p["toi"] / 60 + pad)
                base = xg_rate * minutes
                # Finishing: his goals over his expected goals, with an average finisher mixed in.
                finish = (p["g"] + FINISH_PAD_XG) / (p["gx"] + FINISH_PAD_XG)
                opp_f = state.allowed_factor(opp, "xg")
                shares = state.shares(p, grp)
                area_fit = sum(shares[a] * state.allowed_factor(opp, f"xg_{a}") for a in AREAS)
                pp_share = (p["pp_xg"] + 2 * (state.league["pp_xg"] / state.league["xg"] if state.league["xg"] else 0.2)) / (p["xg"] + 2) if p["xg"] + 2 else 0
                pp_f = state.allowed_factor(opp, "pp_xg")
                goalie = starters.get(opp)
                x = {
                    "opp": math.log(opp_f),
                    "goalie": math.log(state.goalie_factor(goalie)),
                    "area": math.log(area_fit / opp_f) if area_fit > 0 else 0.0,
                    "finish": math.log(finish),
                    "pp": pp_share * math.log(pp_f / opp_f) if pp_f > 0 else 0.0,
                    "line": parts["x"]["line"], "home": parts["x"]["home"], "b2b": parts["x"]["b2b"], "opp_b2b": parts["x"]["opp_b2b"],
                }
                # The Zone Match candidates: his heaviest area against the defense.
                raw_total = sum(p["raw_areas"].values())
                lg_total = sum(state.league[f"{grp}_a_{a}"] for a in AREAS)
                zone = {}
                for a in ("low_slot", "slot"):
                    lg_share = state.league[f"{grp}_a_{a}"] / lg_total if lg_total else 0
                    heavy = raw_total >= 15 and lg_share and p["raw_areas"][a] / raw_total >= 1.35 * lg_share
                    zone[a] = {
                        "heavy": bool(heavy),
                        "shots_rank": lg_shot_rank[a].get(opp, 32),
                        "goals_rank": lg_goal_rank[a].get(opp, 32),
                        "goalie": state.goalies.get(goalie) or Counter(),
                        "lg_g_per_xg": (state.league[f"g_{a}"] / state.league[f"xg_{a}"]) if state.league[f"xg_{a}"] else 1,
                    }
                g_area = {}
                for a, z in zone.items():
                    gl = z["goalie"]
                    exp = gl[f"xg_{a}"] * z["lg_g_per_xg"]
                    # Goalie weak there: goals past what luck explains (1.5 standard deviations, 5+ expected).
                    g_area[a] = exp >= 5 and (gl[f"g_{a}"] - exp) / math.sqrt(exp) >= 1.5
                rows.append({
                    "day": n, "pid": pid, "group": grp, "goals": line["g"], "sog": line["sog"], "base": base,
                    "naive": p["goals_season"] / p["games"],
                    "by_shots": parts["base"] * (state.league[f"{grp}_g"] / state.league[f"{grp}_sog"] if state.league[f"{grp}_sog"] else 0.1),
                    "games": p["games"],
                    **{f"x_{k}": v for k, v in x.items()},
                    "flag_shots": any(z["heavy"] and z["shots_rank"] <= 10 for z in zone.values()),
                    "flag_goals": any(z["heavy"] and z["goals_rank"] <= 10 for z in zone.values()),
                    "flag_goalie": any(z["heavy"] and g_area[a] for a, z in zone.items()),
                    "flag_low_shots": zone["low_slot"]["heavy"] and zone["low_slot"]["shots_rank"] <= 10,
                    "flag_low_goals": zone["low_slot"]["heavy"] and zone["low_slot"]["goals_rank"] <= 10,
                    "heavy": any(z["heavy"] for z in zone.values()),
                    "low_share": p["raw_areas"]["low_slot"] / raw_total if raw_total >= 15 else 0.0,
                    "low_srank": zone["low_slot"]["shots_rank"], "low_grank": zone["low_slot"]["goals_rank"],
                })
        for r in by_date[date]:
            shots_model.add_game(r)
            state.add_game(r)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
    cols = {k: np.array([row[k] for row in rows]) for k in rows[0]}
    for k in cols:
        if k not in ("pid", "group"):
            cols[k] = cols[k].astype(float)
    return {"rows": cols, "xg_w": xg_w, "history": history}


# ---- report ----
def logloss(y_any: np.ndarray, lam: np.ndarray) -> float:
    p = np.clip(1 - np.exp(-lam), 1e-6, 1 - 1e-6)
    return float(-np.mean(y_any * np.log(p) + (1 - y_any) * np.log(1 - p)))


def design(d, keys):
    return np.column_stack([np.ones(len(d["goals"]))] + [d[f"x_{k}"] for k in keys])


def report(out: dict, label: str) -> None:
    d = out["rows"]
    y, base = d["goals"], d["base"]
    y_any = (y > 0).astype(float)
    n = len(y)
    half = d["day"] <= np.median(d["day"])
    test = ~half
    print(f"\n=== {label}: {n:,} skater-games, {y.mean():.3f} goals a game, scored in {100 * y_any.mean():.1f}% ===")

    # 1. The expected-goals table.
    shots = out["history"]
    xg = np.array([s["xg"] for s in shots])
    g = np.array([s["goal"] for s in shots], dtype=float)
    print(f"\n1. Expected goals (the last weekly fit, {len(shots):,} unblocked shots on a goalie)")
    for name, w in zip(XG_NAMES, out["xg_w"]):
        print(f"   {name:<14} {w:+.3f}")
    print("   area        shots   goals  sh%    xG/shot   (on the season's shots, each scored by the table it had that day)")
    for a in AREAS:
        m = np.array([s["area"] == a for s in shots])
        print(f"   {a:<10} {int(m.sum()):>7,} {int(g[m].sum()):>6,} {100 * g[m].mean():5.1f}%  {100 * xg[m].mean():5.1f}%")
    for name, key in (("rebound", "rebound"), ("rush", "rush"), ("power play", "pp")):
        m = np.array([s[key] for s in shots])
        print(f"   {name:<10} {int(m.sum()):>7,} {int(g[m].sum()):>6,} {100 * g[m].mean():5.1f}%  {100 * xg[m].mean():5.1f}%")
    bins = [0, 0.03, 0.06, 0.1, 0.15, 0.25, 1]
    print("   table said   shots    scored")
    for lo, hi in zip(bins, bins[1:]):
        m = (xg >= lo) & (xg < hi)
        print(f"   {100 * lo:4.0f}-{100 * hi:<4.0f}% {int(m.sum()):>8,} {100 * g[m].mean():8.1f}%  (said {100 * xg[m].mean():.1f}%)")

    # 2. Weights and accuracy.
    print("\n2. How much each piece counts (exponent; 1.0 = take the number at face value)")
    # A piece that never moves (no projected lineups saved for the season: "line") is left out.
    keys_all = tuple(k for k in X_KEYS if np.ptp(d[f"x_{k}"]) > 0)
    X = design(d, keys_all)
    w_all = poisson_fit(X, y, np.log(base))
    w_first = poisson_fit(X[half], y[half], np.log(base[half]))
    w_second = poisson_fit(X[test], y[test], np.log(base[test]))
    mu = np.exp(np.log(base) + X @ w_all)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    print("   piece        whole season   (+/-)    first half   second half")
    for i, key in enumerate(("scale",) + keys_all):
        print(f"   {key:<10} {w_all[i]:>12.3f}   {se[i]:.3f} {w_first[i]:>12.3f} {w_second[i]:>12.3f}")

    print("\n   How far each piece moves a projection (middle 80% of players)")
    for i, key in enumerate(keys_all):
        eff = np.exp(w_all[i + 1] * d[f"x_{key}"])
        lo, hi = np.percentile(eff, [10, 90])
        print(f"   {key:<10} {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%")

    print("\n   Accuracy on the SECOND half, weights from the FIRST half (lower = better)")
    yt, yat = y[test], y_any[test]
    rows = [
        ("his goals a game this season", np.maximum(d["naive"][test], 0.005)),
        ("his shots (shots model) x league sh%", d["by_shots"][test]),
        ("his expected goals x minutes (the base)", base[test]),
    ]
    steps = [((), "base, rescaled"), (("opp",), "+ defense's expected goals allowed"), (("opp", "goalie"), "+ tonight's goalie"),
             (("opp", "goalie", "area"), "+ the areas he shoots from"), (("opp", "goalie", "area", "finish"), "+ his finishing"),
             (("opp", "goalie", "area", "finish", "pp"), "+ power play"), (keys_all, "+ line, home, rest (everything)")]
    for keys, name in steps:
        Xk = design(d, keys)
        wk = poisson_fit(Xk[half], y[half], np.log(base[half]))
        rows.append((name, np.exp(np.log(base[test]) + Xk[test] @ wk)))
    print(f"   {'':<42} deviance   log loss (scored or not)")
    for name, lam in rows:
        lam = np.asarray(lam, dtype=float) * yt.sum() / np.asarray(lam, dtype=float).sum() if name.startswith("his") else np.asarray(lam, dtype=float)
        print(f"   {name:<42} {deviance(yt, lam):.4f}    {logloss(yat, lam):.4f}")
    lam_all = rows[-1][1]
    print(f"   (always the same chance for everyone:      log loss {logloss(yat, np.full(len(yt), -math.log(1 - yat.mean()))):.4f})")

    # 3. Honest chances.
    print("\n3. Is it honest? Chance to score (second half, first-half weights)")
    chance = 1 - np.exp(-lam_all)
    print("   model said        games    scored   (price at that chance)")
    for lo, hi in zip([0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 1], [0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 1, 1]):
        if lo >= hi:
            continue
        m = (chance >= lo) & (chance < hi)
        if m.sum() >= 100:
            fair = sm.fair_american(chance[m].mean())
            print(f"   {100 * lo:3.0f}-{100 * hi:<3.0f}%   {int(m.sum()):>9,} {100 * yat[m].mean():8.1f}%   (said {100 * chance[m].mean():.1f}%, {fair:+d})")
    top = np.argsort(-chance)
    for share in (0.02, 0.05, 0.1):
        k = int(len(top) * share)
        print(f"   the model's top {int(share * 100)}%: said {100 * chance[top[:k]].mean():.1f}%, scored {100 * yat[top[:k]].mean():.1f}%")

    # 4. The Zone Match flag.
    print("\n4. Zone Match: did flagged players score MORE than the model already expected? (whole season, whole-season weights)")
    print("   'heavy' = 35%+ more of his shots from the low slot or slot than his position, 15+ located shots")
    print("   flag                                         games  goals  model said  actual/model   (+/- 1 s.e.)  scored%")
    flags = [
        ("heavy shooter, any defense", d["heavy"] > 0),
        ("heavy + D allows top-10 SHOTS from the area", d["flag_shots"] > 0),
        ("heavy + D allows top-10 GOALS from the area", d["flag_goals"] > 0),
        ("  low slot only, shots allowed", d["flag_low_shots"] > 0),
        ("  low slot only, goals allowed", d["flag_low_goals"] > 0),
        ("heavy + tonight's goalie weak in the area", d["flag_goalie"] > 0),
        ("not flagged (shots version)", d["flag_shots"] == 0),
    ]
    for name, m in flags:
        if m.sum() < 50:
            print(f"   {name:<45} {int(m.sum()):>5,}  (too few)")
            continue
        got, said = y[m].sum(), mu[m].sum()
        print(f"   {name:<45} {int(m.sum()):>5,} {int(got):>6,} {said:>11.1f} {got / said:>12.2f}       {math.sqrt(got) / said:.2f}     {100 * y_any[m].mean():5.1f}%")
    # The same flags against a model without the area piece: is the flag the area piece in disguise?
    keys = tuple(k for k in keys_all if k != "area")
    Xk = design(d, keys)
    mu_na = np.exp(np.log(base) + Xk @ poisson_fit(Xk, y, np.log(base)))
    print("   ... and against a model WITHOUT the area piece:")
    for name, m in flags[1:3]:
        if m.sum() >= 50:
            print(f"   {name:<45} actual/model {y[m].sum() / mu_na[m].sum():.2f}")
    print("\n   The owner's example, tighter: 40%+ of his located shots from the low slot")
    print("   defense side                         games  goals  model said  actual/model  (+/- 1 s.e.)  scored%")
    big = d["low_share"] >= 0.40
    for name, m in (
        ("any defense", big),
        ("top-10 low-slot SHOTS allowed", big & (d["low_srank"] <= 10)),
        ("top-5 low-slot SHOTS allowed", big & (d["low_srank"] <= 5)),
        ("top-10 low-slot GOALS allowed", big & (d["low_grank"] <= 10)),
        ("top-5 low-slot GOALS allowed", big & (d["low_grank"] <= 5)),
        ("bottom-10 low-slot SHOTS allowed", big & (d["low_srank"] >= 23)),
    ):
        if m.sum() < 50:
            print(f"   {name:<36} {int(m.sum()):>5,}  (too few)")
            continue
        got, said = y[m].sum(), mu[m].sum()
        print(f"   {name:<36} {int(m.sum()):>5,} {int(got):>6,} {said:>11.1f} {got / said:>12.2f}      {math.sqrt(got) / said:.2f}     {100 * y_any[m].mean():5.1f}%")
    print("\n   Fitted on the whole season:", {k: round(float(v), 3) for k, v in zip(("scale",) + keys_all, w_all)})


def persistence(games: list, label: str) -> None:
    """Does a defense's low-slot number early in a season say anything about
    the rest of it? Each team's first N games against its games after them,
    correlated across the 32 teams (1 = keeps its place exactly, 0 = no
    relation)."""
    print(f"\n5. {label}: does a defense's low-slot number after N games carry over to the rest of the season?")
    print("   (correlation across the 32 teams: 1 = keeps its place, 0 = no relation at all)")
    print("   after    shots allowed   goals allowed   shooting % allowed     goals a game allowed (all areas)")
    for first in (6, 10, 20, 41):
        early, late = {}, {}
        seen = Counter()
        for r in games:
            for team in (r["home"], r["away"]):
                seen[team] += 1
                bucket = early if seen[team] <= first else late
                c = bucket.setdefault(team, Counter())
                c["games"] += 1
                for s in r["shots"]:
                    if s["team"] != team:
                        c["n"] += s["area"] == "low_slot"
                        c["g"] += s["goal"] and s["area"] == "low_slot"
                        c["all_g"] += s["goal"]
        teams = sorted(set(early) & set(late))
        def corr(f):
            a = np.array([f(early[t]) for t in teams])
            z = np.array([f(late[t]) for t in teams])
            return float(np.corrcoef(a, z)[0, 1])
        print(f"   {first:>3} games   {corr(lambda c: c['n'] / c['games']):>9.2f}   {corr(lambda c: c['g'] / c['games']):>13.2f}   {corr(lambda c: c['g'] / max(c['n'], 1)):>16.2f}   {corr(lambda c: c['all_g'] / c['games']):>22.2f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("seasons", type=int, nargs="+", help="Seasons by the year they end (2026 = 2025-26)")
    args = parser.parse_args()
    for season in args.seasons:
        print(f"Loading {b.season_label(season)}...", flush=True)
        games = load_season(season)
        previews = load_previews(season, games) if (DATA / "previews" / str(season)).exists() else {}
        print(f"{len(games):,} games, projected lineups for {len(previews):,}.", flush=True)
        report(replay(games, previews), b.season_label(season))
        persistence(games, b.season_label(season))


if __name__ == "__main__":
    main()
