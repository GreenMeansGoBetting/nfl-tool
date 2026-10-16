"""Walk-forward replay for an NHL points model (1+ point = a goal or an
assist): step 1, choosing how to build it (2026-10-16; no model yet).

Every skater in every game of 2024-25 and 2025-26 is projected ONLY from
that season's games before it (the owner's this-season-only rule; past
seasons only set the weights). Points pay on everything (empty-net and
short-handed included), so every point counts here.

Written down BEFORE the first run: the candidates, and how they are judged.

  0. What a bettor sees: his points a game this season (5 games of his
     position's average mixed in). The bar every model must beat.
  1. Plain: his points a minute, even strength and power play apart (50 / 15
     minutes of an average skater with his ice time mixed in), x tonight's
     minutes (the shots model's), x the matchup.
  2. Goals + assists: the Goals model's expected goals (its own pieces) plus
     his assists a minute read the same way as 1; each half fitted on its
     own count, the chance from the sum.
  3. On-ice: the expected goals his team makes while he is on the ice (a
     minute; from the shift charts and the Goals model's expected-goals
     table) x the share of his team's on-ice goals he has a point on (10 / 6
     goals of his position's average mixed in), even strength and power
     play apart, x tonight's minutes, x the matchup. Steadies the luck in
     assists with chances instead of goals.
  4. 3 with a blend piece: log(plain / on-ice), so the fit says how far to
     lean from the steady on-ice number toward his actual points.
  5. Goals model + on-ice assists: the Goals model's goals plus assists
     from his teammates' on-ice expected goals x his share of their goals.

The matchup pieces, the same in each: the other defense's expected goals
allowed, tonight's goalie, his line tonight against his usual one, home,
rest. Plus "team": his own team's expected goals a game (models 1, 2 only;
3 and 5 already carry it).

How they are judged, each one the same way:
  a. Weights fitted on 2024-25 ONLY, scored on 2025-26 (never touched until
     then): log loss on "1+ point" (lower is better), honest chances (when
     it says 55%, did he get a point 55% of the time?), and 2+ points.
  b. A piece stays only if its 2024-25 weight is 2+ standard errors from
     zero AND it has the same sign fitted on 2025-26 alone.
  c. The winner must beat 0 clearly; between models, the lower 2025-26 log
     loss wins, and the simpler one if they are within 0.0005.

Step 1 found (2026-10-16): 5 won (0.59579 against the bettor's 0.60284), the
"team" piece failed the bar, and a "spread" piece (log of the assists number
over its 2024-25 average: the chances were a touch too bunched) passed.

Step 1b, written down BEFORE its first run (the owner, on linemates: "great
idea yes"), each judged by the same bar a-c, added to 6 (= 5 + spread):
  7. Linemates tonight: the average even-strength points a minute of his
     projected linemates (the NHL's projected-lineup story; same line or
     pair) against the same number for the linemates he has actually played
     with this season (the shift charts' lines, recent games counting more).
     In both halves. 0 when the story has no line for him.
  8. Primary assists count more: his share of teammates' on-ice goals with
     a second assist counted as half, scaled back to the league's assists.
     In the assists half only, as log(primary-weighted / plain).
  (Power-play unit 1 tonight: not testable. The NHL's story has no units
  and the sites that list them are paid products: nhl.md, "Power-play units".)

What it can NOT say: whether it beats the price (no free history of points
prices). The live record will grade that from launch.

    python tools/backtest/nhl_points.py          (about 3 minutes)
    python tools/backtest/nhl_points.py --rows <folder>   (keeps each season's rows there, to re-judge without replaying)

Needs data/nhl/games, shifts, previews and pp_toi for 2025 and 2026.
"""
import gzip
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nhl_goals import DATA, b, deviance, game_slots, logloss, poisson_fit, sm  # noqa: E402
from nhl_goals_check import np_fit  # noqa: E402
from nhl_shots import load_previews  # noqa: E402
import goals_model as gm  # noqa: E402

FIT, TEST = 2025, 2026
MIN_GAMES = 5
REFIT_DAYS = 7
DECAY = 0.985          # each game further back counts this much (the Goals model's)
PAD = 50               # even-strength minutes of an average skater with his ice time
PP_PAD = 15            # power-play minutes of an average skater
IPP_PAD = {"ev": 10, "pp": 6}   # on-ice goals of his position's average share
PPG_PAD = 5            # games of his position's average for the bettor's number
TEAM_PAD = 20          # games of a league-average team
MATCHUP = ("opp", "goalie", "line", "home", "b2b", "opp_b2b")
GOAL_KEYS = ("opp", "goalie", "finish", "line", "home", "b2b", "opp_b2b", "split", "onetimer", "low")


# ---- one game: goals with their points, and who was on the ice ----
def secs(text):
    m, s = text.split(":")
    return int(m) * 60 + int(s)


def shot_times(raw):
    """(period, seconds) of every shot game_shots keeps, in the same order."""
    pbp = raw["pbp"]
    home, away = pbp["homeTeam"], pbp["awayTeam"]
    abbr = {home["id"]: home["abbrev"], away["id"]: away["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    plays = sorted(pbp.get("plays") or [], key=lambda p: p.get("sortOrder", 0))
    directions = b.attack_directions(plays, team_of, home["id"])
    out = []
    for p in plays:
        period = p.get("periodDescriptor") or {}
        if period.get("periodType") == "SO" or p.get("typeDescKey") not in ("goal", "shot-on-goal", "missed-shot"):
            continue
        d = p.get("details") or {}
        shooter = d.get("scoringPlayerId") or d.get("shootingPlayerId")
        team_id = team_of.get(shooter, d.get("eventOwnerTeamId"))
        man = b.strength(p.get("situationCode"), team_id == home["id"])
        if team_id in abbr and man not in ("en", "ps", "extra") and b.normalize_xy(d, directions.get((period.get("number"), team_id))):
            out.append((period.get("number"), b.clock_seconds(p.get("timeInPeriod"))))
    return out


def goal_events(raw):
    """Every goal but shootouts: team, when, power play or not, the scorer and assisters."""
    pbp = raw["pbp"]
    home = pbp["homeTeam"]
    abbr = {home["id"]: home["abbrev"], pbp["awayTeam"]["id"]: pbp["awayTeam"]["abbrev"]}
    team_of = {r["playerId"]: r["teamId"] for r in pbp.get("rosterSpots") or []}
    out = []
    for p in pbp.get("plays") or []:
        period = p.get("periodDescriptor") or {}
        if p.get("typeDescKey") != "goal" or period.get("periodType") == "SO":
            continue
        d = p.get("details") or {}
        team_id = team_of.get(d.get("scoringPlayerId"), d.get("eventOwnerTeamId"))
        if team_id not in abbr:
            continue
        out.append({"team": abbr[team_id], "per": period.get("number"), "t": b.clock_seconds(p.get("timeInPeriod")),
                    "pp": b.strength(p.get("situationCode"), team_id == home["id"]) == "pp",
                    "scorer": str(d.get("scoringPlayerId")), "assists": [str(d[k]) for k in ("assist1PlayerId", "assist2PlayerId") if d.get(k)]})
    return out


class OnIce:
    """Who was on the ice for a team at a moment (start < t <= end: a goal ends the shifts on the ice for it)."""

    def __init__(self, shifts):
        self.spans = {}
        for pid, team, per, start, end in shifts:
            self.spans.setdefault((team, per), []).append((secs(start), secs(end), str(pid)))

    def at(self, team, per, t):
        return {pid for a, z, pid in self.spans.get((team, per), []) if a < t <= z}


def load(season):
    pp = json.load(gzip.open(DATA / "pp_toi" / f"{season}.json.gz", "rt", encoding="utf-8"))
    games = []
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        raw.setdefault("pp_toi", pp.get(path.name.split(".")[0]))
        shifts = None
        sp = DATA / "shifts" / str(season) / path.name
        if sp.exists():
            with gzip.open(sp, "rt", encoding="utf-8") as f:
                shifts = json.load(f)
        raw.setdefault("shifts", shifts)  # the lines he played on (reduce_game's `slot`)
        r = b.reduce_game(raw)
        r["goal_events"] = goal_events(raw)
        r["onice"] = None
        if shifts:
            ice = OnIce(shifts)
            times = shot_times(raw)
            assert len(times) == len(r["shots"]), path.name
            r["onice"] = {"shots": [ice.at(s["team"], per, t) for s, (per, t) in zip(r["shots"], times)],
                          "goals": [ice.at(g["team"], g["per"], g["t"]) for g in r["goal_events"]]}
        games.append(r)
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


# ---- what each skater has done so far ----
PKEYS = ("toi", "pp_toi", "pts", "g", "a", "ev_pts", "pp_pts", "ev_a", "pp_a",
         "oi_ev_toi", "oi_pp_toi", "oi_ev_xgf", "oi_pp_xgf", "oi_ev_xgo", "oi_pp_xgo",
         "oi_ev_gf", "oi_pp_gf", "oi_ev_go", "oi_pp_go", "oi_ev_pts", "oi_pp_pts", "oi_ev_a", "oi_pp_a", "oi_ev_a1", "oi_pp_a1")
MATES_CAP = 0.7        # tonight's linemates against his usual ones, at most about 2x either way


def mate_rate(state, league, pid, pos):
    """A skater's even-strength points a minute so far (50 minutes of his position's average mixed in)."""
    grp = sm.group(pos)
    ev_toi = max(league[f"{grp}_toi"] - league[f"{grp}_pp_toi"], 1)
    lg_rate = league[f"{grp}_ev_pts"] / ev_toi * 60
    q = state.get(pid) or Counter()
    return rate(q["ev_pts"], q["toi"] - q["pp_toi"], lg_rate, PAD) if lg_rate else None


def mates_of(skaters, pid, slot_of):
    """His linemates: the same team and the same line or pair."""
    me = skaters[pid]
    return [q for q, line in skaters.items() if q != pid and line["team"] == me["team"] and slot_of(q) == slot_of(pid)]


def add_points(state, league, teams, r):
    """Adds a game's points and on-ice numbers (after GoalsModel.add_game scored its shots)."""
    pts = {pid: Counter() for pid in r["skaters"]}
    for g in r["goal_events"]:
        kind = "pp" if g["pp"] else "ev"
        for pid in [g["scorer"], *g["assists"]]:
            if pid in pts:
                pts[pid][f"{kind}_pts"] += 1
        for i, pid in enumerate(g["assists"]):
            if pid in pts:
                pts[pid][f"{kind}_a"] += 1
                pts[pid][f"{kind}_a1"] += i == 0
    oi = {pid: Counter() for pid in r["skaters"]}
    if r["onice"]:
        for s, on in zip(r["shots"], r["onice"]["shots"]):
            kind = "pp" if s["pp"] else "ev"
            for pid in on:
                if pid in oi:
                    oi[pid][f"oi_{kind}_xgf"] += s["xg"]
                    if pid != s["shooter"]:
                        oi[pid][f"oi_{kind}_xgo"] += s["xg"]
        for g, on in zip(r["goal_events"], r["onice"]["goals"]):
            kind = "pp" if g["pp"] else "ev"
            for pid in on:
                if pid in oi:
                    oi[pid][f"oi_{kind}_gf"] += 1
                    if pid != g["scorer"]:
                        oi[pid][f"oi_{kind}_go"] += 1
    for tm in (r["home"], r["away"]):
        c = teams.setdefault(tm, Counter())
        c["games"] += 1
        c["xgf"] += sum(s["xg"] for s in r["shots"] if s["team"] == tm)
        league["team_games"] += 1
        league["xgf"] += sum(s["xg"] for s in r["shots"] if s["team"] == tm)
    # The linemates he actually played with (the shift chart's lines), rated before this game.
    usual = {}
    for pid, line in r["skaters"].items():
        if line.get("slot"):
            rates = [mate_rate(state, league, q, r["skaters"][q]["pos"]) for q in mates_of(r["skaters"], pid, lambda q: r["skaters"][q].get("slot"))]
            rates = [x for x in rates if x]
            if rates:
                usual[pid] = sum(rates) / len(rates)
    for pid, line in r["skaters"].items():
        grp = sm.group(line["pos"])
        p = state.setdefault(pid, Counter())
        if pid in usual:
            p["mates_num"] = p["mates_num"] * DECAY + usual[pid]
            p["mates_den"] = p["mates_den"] * DECAY + 1
        pp_secs = line.get("pp_toi")
        if pp_secs is None:
            pp_secs = line["toi"] * (p["pp_toi"] / p["toi"]) if p["toi"] else 0.0
        v = Counter({"toi": line["toi"], "pp_toi": pp_secs, "pts": line["g"] + line["a"], "g": line["g"], "a": line["a"], **pts[pid]})
        if r["onice"]:
            v.update(oi_ev_toi=line["toi"] - pp_secs, oi_pp_toi=pp_secs, oi_ev_pts=pts[pid]["ev_pts"], oi_pp_pts=pts[pid]["pp_pts"],
                     oi_ev_a=pts[pid]["ev_a"], oi_pp_a=pts[pid]["pp_a"], oi_ev_a1=pts[pid]["ev_a1"], oi_pp_a1=pts[pid]["pp_a1"], **oi[pid])
        for k in PKEYS:
            p[k] = p[k] * DECAY + v[k]
            league[f"{grp}_{k}"] += v[k]
        p["games"] += 1
        league[f"{grp}_games"] += 1


def rate(num, minutes, lg_rate, pad):
    """A rate a minute (`minutes` in seconds, `lg_rate` a minute) with `pad` minutes of the league's mixed in."""
    return (num + pad * lg_rate) / (minutes / 60 + pad)


def bases(p, league, grp, role, ev_min, pp_min):
    """Each candidate's number before the matchup (expected points, or assists for the halves)."""
    lg = lambda k: league[f"{grp}_{k}"]
    ev_toi, lg_ev_toi = p["toi"] - p["pp_toi"], max(lg("toi") - lg("pp_toi"), 1)
    lg_ev = lambda k: lg(k) / lg_ev_toi * 60
    lg_pp = lambda k: lg(k) / max(lg("pp_toi"), 1) * 60
    out = {}
    out["ppg"] = (p["pts"] + PPG_PAD * lg("pts") / max(lg("games"), 1)) / (p["games_dec"] + PPG_PAD)
    for name, ev_k, pp_k in (("direct", "ev_pts", "pp_pts"), ("ast", "ev_a", "pp_a")):
        out[name] = (rate(p[ev_k], ev_toi, lg_ev(ev_k) * role, PAD) * ev_min + rate(p[pp_k], p["pp_toi"], lg_pp(pp_k), PP_PAD) * pp_min)
    oi_lg_ev = lambda k: lg(k) / max(lg("oi_ev_toi"), 1) * 60
    oi_lg_pp = lambda k: lg(k) / max(lg("oi_pp_toi"), 1) * 60
    onice = oiast = prim = 0.0
    for kind, minutes, pad, lgr in (("ev", ev_min, PAD, oi_lg_ev), ("pp", pp_min, PP_PAD, oi_lg_pp)):
        scale = role if kind == "ev" else 1.0
        xgf = rate(p[f"oi_{kind}_xgf"], p[f"oi_{kind}_toi"], lgr(f"oi_{kind}_xgf") * scale, pad)
        xgo = rate(p[f"oi_{kind}_xgo"], p[f"oi_{kind}_toi"], lgr(f"oi_{kind}_xgo") * scale, pad)
        k = IPP_PAD[kind]
        ipp = (p[f"oi_{kind}_pts"] + k * lg(f"oi_{kind}_pts") / max(lg(f"oi_{kind}_gf"), 1)) / (p[f"oi_{kind}_gf"] + k)
        aipp = (p[f"oi_{kind}_a"] + k * lg(f"oi_{kind}_a") / max(lg(f"oi_{kind}_go"), 1)) / (p[f"oi_{kind}_go"] + k)
        # 8: a second assist counted as half, scaled back to the league's assists.
        weighted = lambda a, a1: a1 + 0.5 * (a - a1)
        lg_w = weighted(lg(f"oi_{kind}_a"), lg(f"oi_{kind}_a1"))
        wipp = (weighted(p[f"oi_{kind}_a"], p[f"oi_{kind}_a1"]) + k * lg_w / max(lg(f"oi_{kind}_go"), 1)) / (p[f"oi_{kind}_go"] + k)
        wipp *= lg(f"oi_{kind}_a") / lg_w if lg_w else 1.0
        onice += xgf * ipp * minutes
        oiast += xgo * aipp * minutes
        prim += xgo * wipp * minutes
    out["onice"], out["oiast"], out["prim"] = onice, oiast, prim
    return out


def replay(games, previews, hand):
    shots_model = sm.ShotsModel()
    model = gm.GoalsModel(shots_model, hand)
    state, league, teams = {}, Counter(), {}
    history, last_fit, last_played, rows = [], None, {}, []
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    for n, date in enumerate(sorted(by_date)):
        day = np.datetime64(date)
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(REFIT_DAYS, "D")):
            for s in history:
                s["offwing"] = gm.off_wing(s, hand)
            model.xg = {False: np_fit(history, False), True: np_fit(history, True)}
            last_fit = day
        lg_xgf = league["xgf"] / league["team_games"] if league["team_games"] else 0.0
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            for pid, line in r["skaters"].items():
                p = state.get(pid)
                if not p or p["games"] < MIN_GAMES:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                gp = model.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid), starters.get(opp))
                if gp is None:
                    continue
                grp = gp["group"]
                role = shots_model.role(grp, gp["minutes"])
                p["games_dec"] = sum(DECAY ** i for i in range(int(p["games"])))
                bs = bases(p, league, grp, role, gp["ev_min"], gp["pp_min"])
                t = teams.get(team) or Counter()
                team_f = (t["xgf"] + TEAM_PAD * lg_xgf) / (t["games"] + TEAM_PAD) / lg_xgf if lg_xgf else 1.0
                x = {k: gp["x"][k] for k in GOAL_KEYS}
                x["team"] = math.log(team_f)
                x["blend"] = math.log(bs["direct"] / bs["onice"])
                x["prim"] = math.log(bs["prim"] / bs["oiast"]) if bs["prim"] > 0 else 0.0
                # 7: tonight's projected linemates against the ones he has played with.
                x["mates"] = 0.0
                if slots.get(pid) and p["mates_den"]:
                    rates = [mate_rate(state, league, q, r["skaters"][q]["pos"]) for q in mates_of(r["skaters"], pid, slots.get)]
                    rates = [v for v in rates if v]
                    if rates:
                        x["mates"] = max(-MATES_CAP, min(MATES_CAP, math.log(sum(rates) / len(rates) / (p["mates_num"] / p["mates_den"]))))
                rows.append({"pts": line["g"] + line["a"], "g": line["g"], "a": line["a"], "day": n,
                             "slot_known": float(pid in slots), "b_goal": gp["base"],
                             **{f"b_{k}": v for k, v in bs.items()}, **{f"x_{k}": v for k, v in x.items()}})
        for r in by_date[date]:
            shots_model.add_game(r)
            model.add_game(r)
            add_points(state, league, teams, r)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
    return {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}


# ---- judging ----
def design(d, keys):
    return np.column_stack([np.ones(len(d["pts"]))] + [d[f"x_{k}"] for k in keys])


def fit(d, y, base, keys):
    X = design(d, keys)
    off = np.log(d[base]) + math.log(d[y].sum() / d[base].sum())  # start at the right average: Newton can run off from far away
    w = poisson_fit(X, d[y], off)
    w[0] += math.log(d[y].sum() / d[base].sum())
    mu = np.exp(np.log(d[base]) + X @ w)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    return w, se


def predict(d, base, keys, w):
    return np.exp(np.log(d[base]) + design(d, keys) @ w)


MODELS = {
    "0 points a game (bettor)": [("pts", "ppg", ())],
    "1 plain points a minute": [("pts", "direct", MATCHUP + ("team",))],
    "2 goals model + assists": [("g", "goal", GOAL_KEYS), ("a", "ast", MATCHUP + ("team",))],
    "3 on-ice": [("pts", "onice", MATCHUP)],
    "4 on-ice + blend": [("pts", "onice", MATCHUP + ("blend",))],
    "5 goals model + on-ice assists": [("g", "goal", GOAL_KEYS), ("a", "oiast", MATCHUP)],
    "6 = 5 + spread": [("g", "goal", GOAL_KEYS), ("a", "oiast", MATCHUP + ("spread",))],
    "7 = 6 + linemates tonight": [("g", "goal", GOAL_KEYS + ("mates",)), ("a", "oiast", MATCHUP + ("spread", "mates"))],
    "8 = 6 + primary assists": [("g", "goal", GOAL_KEYS), ("a", "oiast", MATCHUP + ("spread", "prim"))],
}


def run(name, f, t):
    """Fits each half on 2024-25, adds the halves up on 2025-26."""
    lam_t = np.zeros(len(t["pts"]))
    lam_f = np.zeros(len(f["pts"]))
    pieces = []
    for y, base, keys in MODELS[name]:
        w, se = fit(f, y, f"b_{base}", keys)
        w_t, _ = fit(t, y, f"b_{base}", keys)
        lam_t += predict(t, f"b_{base}", keys, w)
        lam_f += predict(f, f"b_{base}", keys, w)
        pieces.append((y, keys, w, se, w_t))
    return lam_t, lam_f, pieces


def calibration(y_any, lam, two=None):
    chance = 1 - np.exp(-lam)
    lines = []
    for lo, hi in zip([0, .15, .25, .35, .45, .55, .65], [.15, .25, .35, .45, .55, .65, 1]):
        m = (chance >= lo) & (chance < hi)
        if m.sum() >= 100:
            lines.append(f"     {100 * lo:3.0f}-{100 * hi:<3.0f}% {int(m.sum()):>8,}  got a point {100 * y_any[m].mean():5.1f}%  (said {100 * chance[m].mean():.1f}%)")
    return lines


def main():
    hand = {}
    for season in (FIT, TEST) if "--rows" not in sys.argv or not all((Path(sys.argv[sys.argv.index("--rows") + 1]) / f"points_rows_{x}.npz").exists() for x in (FIT, TEST)) else ():
        for pid, row in b.fetch_report("skater/timeonice", season, "playerId").items():
            if row.get("shootsCatches"):
                hand[str(pid)] = row["shootsCatches"]
    data = {}
    cache = Path(sys.argv[sys.argv.index("--rows") + 1]) if "--rows" in sys.argv else None
    for season in (FIT, TEST):
        saved = cache / f"points_rows_{season}.npz" if cache else None
        if saved and saved.exists():
            data[season] = dict(np.load(saved))
        else:
            print(f"Replaying {b.season_label(season)}...", flush=True)
            games = load(season)
            have = sum(1 for g in games if g["onice"])
            print(f"  {len(games):,} games, shift charts for {have:,}", flush=True)
            data[season] = replay(games, load_previews(season, games), hand)
            if saved:
                np.savez(saved, **data[season])
        d = data[season]
        print(f"  {len(d['pts']):,} skater-games; a point in {100 * (d['pts'] > 0).mean():.1f}%, 2+ in {100 * (d['pts'] > 1).mean():.1f}%; "
              f"points a game {d['pts'].mean():.3f} (goals {d['g'].mean():.3f}, assists {d['a'].mean():.3f})", flush=True)
    f, t = data[FIT], data[TEST]
    mean_oiast = f["b_oiast"].mean()  # the spread piece's yardstick, fixed from 2024-25
    for d in (f, t):
        d["x_spread"] = np.log(d["b_oiast"] / mean_oiast)
    for season, d in ((FIT, f), (TEST, t)):
        known = d["x_mates"] != 0
        lo, hi = np.percentile(np.exp(d["x_mates"][known]), [10, 90]) if known.any() else (1, 1)
        print(f"Linemates tonight, {b.season_label(season)}: read for {100 * known.mean():.0f}% of skater-games; middle 80% {lo:.2f}x to {hi:.2f}x his usual linemates")
    y_any, y_two = (t["pts"] > 0).astype(float), (t["pts"] > 1).astype(float)
    print("\nWeights fitted on 2024-25, scored on 2025-26 (1+ point log loss: lower is better)")
    results = {}
    for name in MODELS:
        lam_t, lam_f, pieces = run(name, f, t)
        ll = logloss(y_any, lam_t)
        results[name] = ll
        p2 = 1 - np.exp(-lam_t) * (1 + lam_t)
        print(f"\n{name}: log loss {ll:.5f}  (in-sample 2024-25 {logloss((f['pts'] > 0).astype(float), lam_f):.5f}); "
              f"deviance {deviance(t['pts'], lam_t):.4f}; 2+ points said {100 * p2.mean():.1f}% got {100 * y_two.mean():.1f}%")
        for y, keys, w, se, w_t in pieces:
            cells = [f"{k} {w[i + 1]:+.2f} (z {w[i + 1] / se[i + 1]:+.1f}, 25-26 alone {w_t[i + 1]:+.2f})" for i, k in enumerate(keys)]
            print(f"   [{y}] scale {w[0]:+.3f}; " + "; ".join(cells))
        for line in calibration(y_any, lam_t):
            print(line)
    print("\nSummary (2025-26 log loss):")
    for name, ll in sorted(results.items(), key=lambda kv: kv[1]):
        print(f"   {ll:.5f}  {name}")
    base = 1 - (t["pts"] > 0).mean()
    print(f"   {-(base * math.log(base) + (1 - base) * math.log(1 - base)):.5f}  (everyone at the league's rate)")


if __name__ == "__main__":
    main()
