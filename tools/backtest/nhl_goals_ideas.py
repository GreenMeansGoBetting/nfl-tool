"""Five "bottom up" ideas for the NHL anytime-goal model, tested the way a
statistician would (2026-10-14, the owner: "what would a statistician do?").

Written down BEFORE the first run, with the bar each idea must clear:

  1. Empty-net goals. Anytime props pay on them; the step-1 model only had
     them in its overall scale. His expected empty-net goals = his team's
     empty-net goals a game (good teams get more) x the share of his team's
     empty-net time he is on the ice / 6 skaters x his shooting rate against
     his position's.
  2a. Even strength and power play apart. His expected goals a minute at
     even strength x his even-strength minutes, plus the same on the power
     play, instead of one blended rate x all his minutes. (From the NHL's
     shift charts.)
  2b. The penalty matchup. His power-play part scaled by how much power-play
     time his team draws a game x how much the other team gives up.
  3. Backup goalie. The other team's starter tonight is not its usual one
     (beyond what the goalie's own record already says).
  4. Score effects / team strength. The gap between the two teams' goal
     differential a game (a team that trails more shoots more).
  5. One-timer side. A shot from the off wing (a right-handed shot from the
     left side, or the reverse) added to the expected-goals table.
  (6. The low-slot trim: NOT blind. Step 1 saw heavy low-slot shooters run
     5-10% under their projection in both seasons; it is measured here with
     the same bar, but it was found by looking.)

The bar (all three, or the idea stays out):
  a. Fitted on 2024-25, its weight is at least 2 standard errors from zero.
  b. Added to the step-1 pieces with weights fitted on 2024-25 ONLY, it
     lowers the log loss (scored or not) on 2025-26. 2025-26 is not touched
     until then.
  c. Fitted on 2025-26 alone, its weight has the same sign.
  For 5, also: the expected-goals table with it, fitted on all of 2024-25's
  shots, scores 2025-26's shots better than the table without it.

Each season is still replayed walk-forward on its own games only (the
owner's this-season-only rule); "fitted on 2024-25" means the weights.

    python tools/backtest/nhl_goals_ideas.py

Needs data/nhl/games, data/nhl/shifts and data/nhl/previews for 2025 and 2026.
"""
import gzip
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nhl_goals as ng  # noqa: E402
from nhl_goals import AREAS, DATA, DECAY, b, deviance, game_slots, logloss, poisson_fit, sm  # noqa: E402
from nhl_shots import load_previews  # noqa: E402

FIT, TEST = 2025, 2026
BASE_KEYS = ("opp", "goalie", "finish", "line", "home", "b2b", "opp_b2b")  # step 1's pieces that counted
IDEAS = {"1 empty net": "en", "2a EV / PP apart": "split", "2b penalty matchup": "ppenv", "3 backup goalie": "backup",
         "4 team strength gap": "gap", "5 one-timer side": "onetimer", "(6) low-slot trim, not blind": "low"}
PP_PAD = 15            # power-play minutes of an average skater mixed into his power-play rate
EN_PAD = 300           # seconds of his team's empty-net time at his position's usual share
TOI_DECAY = 0.8        # minutes, as the shots model reads them


# ---- extra per game: who was on the ice on the power play and at an empty net ----
def secs(text):
    m, s = text.split(":")
    return int(m) * 60 + int(s)


def state_seconds(raw: dict, shifts: list | None) -> dict:
    """Team and player seconds on the power play (pp), short-handed (sh) and
    shooting at an empty net (en), from the play-by-play's situationCode
    between events and the shift charts."""
    pbp = raw["pbp"]
    home, away = pbp["homeTeam"]["abbrev"], pbp["awayTeam"]["abbrev"]
    plays = [p for p in sorted(pbp["plays"], key=lambda p: p.get("sortOrder", 0))
             if p.get("situationCode") and p.get("timeInPeriod") and (p.get("periodDescriptor") or {}).get("number", 9) <= 4]
    spans = {(t, k): [] for t in (home, away) for k in ("pp", "sh", "en")}
    prev = None
    for p in plays:
        per, t, code = p["periodDescriptor"]["number"], secs(p["timeInPeriod"]), p["situationCode"]
        if prev and prev[0] == per and t > prev[1] and len(code) == 4 and code.isdigit():
            ag, ask, hsk, hg = (int(c) for c in code)
            span = (per, prev[1], t)
            if ag == 1 and hg == 1 and ask != hsk:
                up, down = (home, away) if hsk > ask else (away, home)
                spans[(up, "pp")].append(span)
                spans[(down, "sh")].append(span)
            elif ag == 0 and hg == 1:
                spans[(home, "en")].append(span)
            elif hg == 0 and ag == 1:
                spans[(away, "en")].append(span)
        prev = (per, t)
    team = {k: sum(e - s for _, s, e in v) for k, v in spans.items()}
    players = {}
    for pid, tm, per, start, end in shifts or []:
        a, z = secs(start), secs(end)
        row = players.setdefault(str(pid), Counter())
        for kind in ("pp", "en"):
            row[kind] += sum(max(0, min(z, e) - max(a, s)) for p, s, e in spans.get((tm, kind), []) if p == per)
    en_goals = Counter()
    for p in pbp["plays"]:
        if p.get("typeDescKey") == "goal" and (p.get("periodDescriptor") or {}).get("periodType") != "SO":
            d = p.get("details") or {}
            tid = d.get("eventOwnerTeamId")
            if b.strength(p.get("situationCode"), tid == pbp["homeTeam"]["id"]) == "en":
                en_goals[home if tid == pbp["homeTeam"]["id"] else away] += 1
    return {"team": team, "players": players, "en_goals": en_goals, "have_shifts": shifts is not None}


def load(season: int, hand: dict) -> list:
    games = []
    for path in sorted((DATA / "games" / str(season)).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            raw = json.load(f)
        r = b.reduce_game(raw)
        r["shots"] = ng.game_shots(raw)
        for s in r["shots"]:
            h = hand.get(s["shooter"])
            s["offwing"] = bool(h and s["area"] not in ("point", "long") and ((h == "R" and s["y"] > 0) or (h == "L" and s["y"] < 0)))
        sp = DATA / "shifts" / str(season) / path.name
        shifts = None
        if sp.exists():
            with gzip.open(sp, "rt", encoding="utf-8") as f:
                shifts = json.load(f)
        r["states"] = state_seconds(raw, shifts)
        games.append(r)
    games.sort(key=lambda r: (r["date"], r["id"]))
    return games


# ---- expected goals, with and without the one-timer side ----
def feats(s, ow):
    f = ng.xg_features(s)
    return f + [float(s["offwing"])] if ow else f


def fit_table(shots, ow):
    X = np.array([feats(s, ow) for s in shots])
    y = np.array([s["goal"] for s in shots], dtype=float)
    w = np.zeros(X.shape[1])
    w[0] = math.log(y.mean() / (1 - y.mean()))
    ridge = np.diag(np.arange(len(w)) > 0).astype(float)
    for _ in range(30):
        p = 1 / (1 + np.exp(-(X @ w)))
        step = np.linalg.solve(X.T @ (X * (p * (1 - p))[:, None]) + ridge, X.T @ (y - p) - ridge @ w)
        w += step
        if np.abs(step).max() < 1e-7:
            break
    return w


def score_table(shots, w, ow):
    X = np.array([feats(s, ow) for s in shots])
    p = 1 / (1 + np.exp(-(X @ w)))
    for s, v in zip(shots, p):
        s["xg_ow" if ow else "xg"] = float(v)


# ---- the replay ----
def replay(games: list, previews: dict) -> dict:
    shots_model, state = sm.ShotsModel(), ng.GoalsState()
    extra = {}                     # pid -> his decayed state numbers
    teams = {}                     # team -> season counts (pp / sh / en seconds, en goals, goals for / against, starts)
    league = Counter()
    w0 = w1 = None
    history, last_fit, last_played, rows = [], None, {}, []
    by_date = {}
    for r in games:
        by_date.setdefault(r["date"], []).append(r)
    for n, date in enumerate(sorted(by_date)):
        day = np.datetime64(date)
        if len(history) > 3000 and (last_fit is None or (day - last_fit) >= np.timedelta64(ng.REFIT_DAYS, "D")):
            w0, w1, last_fit = fit_table(history, False), fit_table(history, True), day
        for r in by_date[date]:
            if w0 is None:
                for s in r["shots"]:
                    s["xg"] = s["xg_ow"] = 0.07
            else:
                score_table(r["shots"], w0, False)
                score_table(r["shots"], w1, True)
        tg = league["team_games"] or 1
        for r in by_date[date]:
            rest = {t: int((day - last_played[t]) / np.timedelta64(1, "D")) if t in last_played else None for t in (r["home"], r["away"])}
            slots = game_slots(r, previews.get(r["id"]))
            starters = {g["team"]: gid for gid, g in r["goalies"].items() if g["start"]}
            for pid, line in r["skaters"].items():
                p = state.players.get(pid)
                e = extra.get(pid)
                if not p or p["games"] < ng.MIN_GAMES or not e:
                    continue
                team = line["team"]
                opp = r["away"] if team == r["home"] else r["home"]
                parts = shots_model.parts(pid, opp, team == r["home"], rest[team], rest[opp], team, slots.get(pid))
                if parts is None:
                    continue
                grp, minutes = parts["group"], parts["minutes"]
                role = shots_model.role(grp, minutes)
                lg = lambda key: league[f"{grp}_{key}"]
                # Step 1's base and pieces.
                lg_rate = state.league[f"{grp}_xg"] / state.league[f"{grp}_toi"] * 60 if state.league[f"{grp}_toi"] else 0
                xg_rate = (p["xg"] + ng.PAD_MINUTES * lg_rate * role) / (p["toi"] / 60 + ng.PAD_MINUTES)
                base = xg_rate * minutes
                opp_f = state.allowed_factor(opp, "xg")
                finish = (p["g"] + ng.FINISH_PAD_XG) / (p["gx"] + ng.FINISH_PAD_XG)
                x = {
                    "opp": math.log(opp_f), "goalie": math.log(state.goalie_factor(starters.get(opp))), "finish": math.log(finish),
                    "line": parts["x"]["line"], "home": parts["x"]["home"], "b2b": parts["x"]["b2b"], "opp_b2b": parts["x"]["opp_b2b"],
                }
                # 5. The same base read from the table with the one-timer side.
                lg_ow = lg("xg_ow") / lg("toi") * 60 if lg("toi") else lg_rate
                ow_rate = (e["xg_ow"] + ng.PAD_MINUTES * lg_ow * role) / (e["toi"] / 60 + ng.PAD_MINUTES)
                x["onetimer"] = math.log(ow_rate * minutes / base) if base > 0 and ow_rate > 0 else 0.0
                # 2a. Even strength and power play apart.
                ev_lg = (lg("xg") - lg("pp_xg")) / max(lg("toi") - lg("pp_toi"), 1) * 60
                pp_lg = lg("pp_xg") / max(lg("pp_toi"), 1) * 60
                ev_min = e["ev_num"] / e["min_den"] / 60
                pp_min = e["pp_num"] / e["min_den"] / 60
                ev_rate = (e["xg"] - e["pp_xg"] + ng.PAD_MINUTES * ev_lg * role) / ((e["toi"] - e["pp_toi"]) / 60 + ng.PAD_MINUTES)
                pp_rate = (e["pp_xg"] + PP_PAD * pp_lg) / (e["pp_toi"] / 60 + PP_PAD)
                split = ev_rate * ev_min + pp_rate * pp_min
                x["split"] = math.log(split / base) if split > 0 and base > 0 else 0.0
                # 2b. The penalty matchup: power-play time his team draws x what the other team gives up.
                t_me, t_op = teams.get(team) or Counter(), teams.get(opp) or Counter()
                lg_pp = league["pp"] / tg
                draw = ((t_me["pp"] + 20 * lg_pp) / (t_me["games"] + 20)) / lg_pp if lg_pp else 1
                give = ((t_op["sh"] + 20 * lg_pp) / (t_op["games"] + 20)) / lg_pp if lg_pp else 1
                pp_part = pp_rate * pp_min
                x["ppenv"] = math.log((split - pp_part + pp_part * draw * give) / split) if split > 0 else 0.0
                # 1. Empty-net goals.
                lg_en = league["en_goals"] / tg
                team_en = (t_me["en_goals"] + 20 * lg_en) / (t_me["games"] + 20)
                share_lg = lg("en_on") / lg("en_team") if lg("en_team") else 0.3
                share = (e["en_on"] + EN_PAD * share_lg) / (e["en_team"] + EN_PAD)
                rel = min(2.0, max(0.5, xg_rate / lg_rate)) if lg_rate else 1.0
                en_lam = team_en * share / 6 * rel
                x["en"] = math.log(1 + en_lam / base) if base > 0 else 0.0
                # 3. Backup goalie: tonight's starter isn't the one with the most starts.
                starts = t_op.get("starts") or Counter()
                g_opp = starters.get(opp)
                x["backup"] = 1.0 if t_op["games"] >= 5 and starts and g_opp and starts[g_opp] < max(starts.values()) and starts[g_opp] / t_op["games"] < 0.5 else 0.0
                # 4. Team strength gap (goal differential a game, 20 games of an even team mixed in).
                gd = lambda c: (c["gf"] - c["ga"]) / (c["games"] + 20)
                x["gap"] = gd(t_op) - gd(t_me)
                # (6) Low-slot trim.
                lg_tot = sum(state.league[f"{grp}_a_{a}"] for a in AREAS)
                x["low"] = state.shares(p, grp)["low_slot"] - (state.league[f"{grp}_a_low_slot"] / lg_tot if lg_tot else 0.25)
                rows.append({"goals": line["g"], "base": base, "day": n, **{f"x_{k}": v for k, v in x.items()}})
        for r in by_date[date]:
            shots_model.add_game(r)
            state.add_game(r)
            history.extend(r["shots"])
            last_played[r["home"]] = last_played[r["away"]] = day
            st = r["states"]
            by_shooter = {}
            for s in r["shots"]:
                by_shooter.setdefault(s["shooter"], []).append(s)
            for tm in (r["home"], r["away"]):
                c = teams.setdefault(tm, Counter())
                other = r["away"] if tm == r["home"] else r["home"]
                c["games"] += 1
                c["pp"] += st["team"][(tm, "pp")]
                c["sh"] += st["team"][(tm, "sh")]
                c["en_goals"] += st["en_goals"][tm]
                c["gf"] += r["score"][tm]
                c["ga"] += r["score"][other]
                league["pp"] += st["team"][(tm, "pp")]
                league["en_goals"] += st["en_goals"][tm]
                league["team_games"] += 1
            for gid, g in r["goalies"].items():
                if g["start"]:
                    teams[g["team"]].setdefault("starts", Counter())[gid] += 1
            for pid, line in r["skaters"].items():
                grp = sm.group(line["pos"])
                mine = by_shooter.get(pid, [])
                on = st["players"].get(pid) or Counter()
                pp_secs = on["pp"] if st["have_shifts"] else 0
                e = extra.setdefault(pid, Counter())
                for key, val in (("toi", line["toi"]), ("xg_ow", sum(s["xg_ow"] for s in mine)), ("xg", sum(s["xg"] for s in mine)),
                                 ("pp_xg", sum(s["xg"] for s in mine if s["pp"])), ("pp_toi", pp_secs)):
                    e[key] = e[key] * DECAY + val
                    league[f"{grp}_{key}"] += val
                e["ev_num"] = e["ev_num"] * TOI_DECAY + (line["toi"] - pp_secs)
                e["pp_num"] = e["pp_num"] * TOI_DECAY + pp_secs
                e["min_den"] = e["min_den"] * TOI_DECAY + 1
                e["en_on"] += on["en"]
                e["en_team"] += st["team"][(line["team"], "en")]
                league[f"{grp}_en_on"] += on["en"]
                league[f"{grp}_en_team"] += st["team"][(line["team"], "en")]
    return {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}


# ---- judging ----
def X_of(d, keys):
    return np.column_stack([np.ones(len(d["goals"]))] + [d[f"x_{k}"] for k in keys])


def fit(d, keys):
    X = X_of(d, keys)
    w = poisson_fit(X, d["goals"], np.log(d["base"]))
    mu = np.exp(np.log(d["base"]) + X @ w)
    se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
    return w, se


def held_out(fit_d, test_d, keys):
    w, _ = fit(fit_d, keys)
    lam = np.exp(np.log(test_d["base"]) + X_of(test_d, keys) @ w)
    return logloss((test_d["goals"] > 0).astype(float), lam), deviance(test_d["goals"], lam), lam


def main():
    hand = {}
    for season in (FIT, TEST):
        for pid, row in b.fetch_report("skater/timeonice", season, "playerId").items():
            if row.get("shootsCatches"):
                hand[str(pid)] = row["shootsCatches"]
    print(f"Handedness for {len(hand):,} skaters.")
    data, shots = {}, {}
    for season in (FIT, TEST):
        print(f"Loading {b.season_label(season)}...", flush=True)
        games = load(season, hand)
        previews = load_previews(season, games)
        have = sum(g["states"]["have_shifts"] for g in games)
        print(f"  {len(games):,} games, shift charts for {have:,}, projected lineups for {len(previews):,}", flush=True)
        data[season] = replay(games, previews)
        shots[season] = [s for g in games for s in g["shots"]]
        en = sum(sum(g["states"]["en_goals"].values()) for g in games)
        allg = sum(sum(g["score"].values()) for g in games)
        print(f"  empty-net goals: {en:,} of {allg:,} ({100 * en / allg:.1f}%, shootout winners included in the total)")

    f, t = data[FIT], data[TEST]
    print(f"\n{b.season_label(FIT)}: {len(f['goals']):,} skater-games to fit on; {b.season_label(TEST)}: {len(t['goals']):,} to test on.")

    # 5, per shot: the table fitted on all of one season, scored on the other.
    def shot_ll(s_fit, s_test, ow):
        w = fit_table(s_fit, ow)
        X = np.array([feats(s, ow) for s in s_test])
        y = np.array([s["goal"] for s in s_test], dtype=float)
        p = np.clip(1 / (1 + np.exp(-(X @ w))), 1e-6, 1 - 1e-6)
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))), w
    ll0, _ = shot_ll(shots[FIT], shots[TEST], False)
    ll1, w1 = shot_ll(shots[FIT], shots[TEST], True)
    ow = np.array([s["offwing"] for s in shots[TEST]])
    gl = np.array([s["goal"] for s in shots[TEST]], dtype=float)
    print("\nIdea 5 per shot (expected-goals table fitted on 2024-25, scored on 2025-26's shots):")
    print(f"   off-wing shots {int(ow.sum()):,} of {len(ow):,}; scored {100 * gl[ow].mean():.1f}% vs {100 * gl[~ow].mean():.1f}% (before distance and angle)")
    print(f"   table weight for the off wing {w1[-1]:+.3f};  log loss {ll0:.5f} without, {ll1:.5f} with  ({'better' if ll1 < ll0 else 'not better'})")

    base_ll, base_dev, _ = held_out(f, t, BASE_KEYS)
    print(f"\nThe step-1 pieces alone, fitted on {b.season_label(FIT)}, on {b.season_label(TEST)}: log loss {base_ll:.5f}, deviance {base_dev:.5f}")
    print("\nidea                          2024-25 weight (+/- se)  z     2025-26 log loss  change    2025-26 weight  moves (middle 80%)   a  b  c   verdict")
    passed = []
    for name, key in IDEAS.items():
        keys = BASE_KEYS + (key,)
        w_f, se_f = fit(f, keys)
        w_t, _ = fit(t, keys)
        ll, _, _ = held_out(f, t, keys)
        z = w_f[-1] / se_f[-1]
        eff = np.exp(w_f[-1] * t[f"x_{key}"])
        lo, hi = np.percentile(eff, [10, 90])
        a, bb, c = abs(z) >= 2, ll < base_ll, np.sign(w_t[-1]) == np.sign(w_f[-1])
        ok = a and bb and c
        if ok:
            passed.append(key)
        mark = lambda v: "Y" if v else "n"
        print(f"{name:<30} {w_f[-1]:>+8.3f} ({se_f[-1]:.3f}) {z:>+6.1f}   {ll:.5f}   {1e4 * (ll - base_ll):>+6.1f}e-4   {w_t[-1]:>+8.3f}   {100 * (lo - 1):+5.1f}% to {100 * (hi - 1):+5.1f}%   {mark(a)}  {mark(bb)}  {mark(c)}   {'PASSES' if ok else 'out'}")

    keys = BASE_KEYS + tuple(passed)
    ll, dev, lam = held_out(f, t, keys)
    w_f, se_f = fit(f, keys)
    print(f"\nEverything that passed {passed}, fitted on {b.season_label(FIT)}, on {b.season_label(TEST)}: log loss {ll:.5f} (step-1 pieces {base_ll:.5f}), deviance {dev:.5f}")
    print("   weights:", {k: round(float(v), 3) for k, v in zip(("scale",) + keys, w_f)})
    y_any = (t["goals"] > 0).astype(float)
    chance = 1 - np.exp(-lam)
    print("   model said        games    scored")
    for lo, hi in zip([0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35], [0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 1]):
        m = (chance >= lo) & (chance < hi)
        if m.sum() >= 100:
            print(f"   {100 * lo:3.0f}-{100 * hi:<3.0f}%   {int(m.sum()):>9,} {100 * y_any[m].mean():8.1f}%   (said {100 * chance[m].mean():.1f}%)")
    top = np.argsort(-chance)
    for share in (0.02, 0.05, 0.1):
        k = int(len(top) * share)
        print(f"   top {int(share * 100)}%: said {100 * chance[top[:k]].mean():.1f}%, scored {100 * y_any[top[:k]].mean():.1f}%")


if __name__ == "__main__":
    main()
