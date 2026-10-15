"""Icebreaker: what predicts the QUICKEST goal of the 7:00 PM ET slate?

    python tools/backtest/nhl_icebreaker.py      (2024-25 and 2025-26; needs data/nhl/games
                                                  and data/nhl/shifts for 2025 and 2026)

Asked by the owner 2026-10-15 for DraftKings' Icebreaker promo (a share of $250K for a
first goal scorer bet on whoever scores the slate's quickest goal, by game clock). Each
test uses only games before the one it predicts. What it showed (both seasons):
- When: on 4-6 game slates the quickest goal came by about 2:00 of the 1st on most nights
  (1:30-2:05 middle night on 5 games). No ties. The first two minutes are 15-20% slower
  than the rest of the 1st period, for every team alike.
- Teams: goals in the first 10 minutes (Poisson on games before) were barely predictable,
  and early-game numbers (goals in the first 10 minutes, 1st-period goals, shots in the
  first 10 minutes, for and against) did no better than plain goals / shots for and against.
- Players: who scores his team's early 5v5 goal is best read by his scoring rate x his ice
  time (log score -2.74 / -2.76 a goal, a flat guess -2.84); his early ice time was no
  better than his 1st-period ice time; his early shots were no better than a flat guess;
  being on the opening shift didn't help (only 35% of Icebreakers were on it, and only 40%
  of a team's opening forwards started its next game too). Defensemen: 10-15% of winners;
  not five a side: about 20%.
- The promo itself: the real Icebreaker's pregame place among ~175 skaters by that
  ranking: top 10 on 22% / 11% of 3+ game slates (ten random picks: 6%), top 20 on 33% /
  26%; the favorite's chance about 2%. The winner's team was the top team 14% of the time
  (random 10%), a top-three team 40% (random 30%).
So the page ranks players by expected goals tonight (build_nhl.py icebreaker_board) and
shows the fast-start numbers without counting them.
"""

import gzip, json, math, sys
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
EARLY = 300  # first 5 minutes of the 1st period


def secs(mmss):
    m, s = mmss.split(":")
    return int(m) * 60 + int(s)


def load(season):
    games = []
    gdir = ROOT / "data/nhl/games" / str(season)
    sdir = ROOT / "data/nhl/shifts" / str(season)
    for f in sorted(gdir.iterdir()):
        raw = json.load(gzip.open(f, "rt", encoding="utf-8"))
        p = raw["pbp"]
        if p.get("gameType") != 2:
            continue
        off = int(p["easternUTCOffset"].split(":")[0])
        st = datetime.strptime(p["startTimeUTC"], "%Y-%m-%dT%H:%M:%SZ") + timedelta(hours=off)
        home, away = p["homeTeam"]["abbrev"], p["awayTeam"]["abbrev"]
        hid, aid = p["homeTeam"]["id"], p["awayTeam"]["id"]
        team_of = {hid: home, aid: away}
        pos = {r["playerId"]: r["positionCode"] for r in p.get("rosterSpots", [])}
        goals, shots = [], []
        for e in p["plays"]:
            pd = (e.get("periodDescriptor") or {}).get("number")
            if pd != 1 or not e.get("timeInPeriod"):
                continue
            t = secs(e["timeInPeriod"])
            d = e.get("details") or {}
            tm = team_of.get(d.get("eventOwnerTeamId"))
            if e["typeDescKey"] == "goal":
                goals.append((t, tm, d.get("scoringPlayerId"), e.get("situationCode")))
            if e["typeDescKey"] in ("shot-on-goal", "goal", "missed-shot"):
                shots.append((t, tm, d.get("shootingPlayerId") or d.get("scoringPlayerId"), e["typeDescKey"]))
        sh = []
        sf = sdir / f.name
        if sf.exists():
            sh = [s for s in json.load(gzip.open(sf, "rt", encoding="utf-8")) if s[2] == 1]
        games.append(dict(id=p["id"], date=p["gameDate"], et=st, home=home, away=away, pos=pos,
                          goals=sorted(goals), shots=shots, shifts=sh))
    games.sort(key=lambda g: (g["et"], g["id"]))
    return games


def report(season):
    G = load(season)
    print(f"\n===== {season-1}-{str(season)[2:]}: {len(G)} games, shifts for {sum(1 for g in G if g['shifts'])}")
    # League: goal rate by minute of the 1st period vs overall regulation
    mins = Counter()
    for g in G:
        for t, *_ in g["goals"]:
            mins[t // 60] += 1
    n = len(G)
    print("1st-period goals per game by minute:", " ".join(f"{m}:{mins[m]/n:.3f}" for m in range(20)))
    print(f"first 2 min rate/min {sum(mins[m] for m in (0,1))/n/2:.3f} vs 1st-period rate/min {sum(mins.values())/n/20:.3f}")

    # Slates: games scheduled exactly 7:00 PM ET
    slates = defaultdict(list)
    for g in G:
        if g["et"].hour == 19 and g["et"].minute == 0:
            slates[g["et"].date()].append(g)
    sizes = Counter(len(v) for v in slates.values())
    print("7:00 slates:", len(slates), "sizes", dict(sorted(sizes.items())))
    win_t = defaultdict(list)
    winners = []
    for d, gs in slates.items():
        firsts = [(g["goals"][0][0], g) for g in gs if g["goals"]]
        if not firsts:
            continue
        t, g = min(firsts, key=lambda x: x[0])
        tie = sum(1 for x in firsts if x[0] == t) > 1
        win_t[len(gs)].append(t)
        gl = g["goals"][0]
        winners.append((d, len(gs), t, g, gl, tie))
    for k in sorted(win_t):
        v = sorted(win_t[k])
        print(f"  slate {k} games: n={len(v)} median winning time {np.median(v)/60:.1f} min, 75th pct {np.percentile(v,75)/60:.1f}, max {max(v)/60:.1f}")
    print("  ties for quickest:", sum(1 for w in winners if w[5]))
    # Winner traits
    started = d_men = pp = has = 0
    for d, k, t, g, gl, tie in winners:
        if not g["shifts"]:
            continue
        has += 1
        openers = {s[0] for s in g["shifts"] if secs(s[3]) == 0}
        started += gl[2] in openers
        d_men += g["pos"].get(gl[2]) == "D"
        pp += gl[3] not in ("1551",)
    print(f"  winners with shifts {has}: scorer on ice for opening faceoff {started}, defensemen {d_men}, not 5v5 {pp}")
    return G


def team_test(G):
    """Poisson: goals a team scores in the first 10 min of P1, from prior games only."""
    hist = defaultdict(list)  # team -> list of dict per game
    rows = []
    for g in G:
        for side, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            th, oh = hist[side], hist[opp]
            if len(th) >= 10 and len(oh) >= 10:
                def avg(h, k):
                    return sum(x[k] for x in h) / len(h)
                rows.append(dict(
                    y=sum(1 for t, tm, *_ in g["goals"] if tm == side and t < 600),
                    gf=avg(th, "gf"), ga=avg(oh, "ga"),
                    egf=avg(th, "egf"), ega=avg(oh, "ega"),
                    p1f=avg(th, "p1f"), p1a=avg(oh, "p1a"),
                    esf=avg(th, "esf"), esa=avg(oh, "esa"),
                    sf=avg(th, "sf"), sa=avg(oh, "sa"),
                    home=1 if side == g["home"] else 0))
        # then add this game to each team's history (full-game goals come from gf_totals)
        for side, opp in ((g["home"], g["away"]), (g["away"], g["home"])):
            rec = dict(
                egf=sum(1 for t, tm, *_ in g["goals"] if tm == side and t < 600),
                ega=sum(1 for t, tm, *_ in g["goals"] if tm == opp and t < 600),
                p1f=sum(1 for t, tm, *_ in g["goals"] if tm == side),
                p1a=sum(1 for t, tm, *_ in g["goals"] if tm == opp),
                esf=sum(1 for t, tm, _, k in g["shots"] if tm == side and t < 600),
                esa=sum(1 for t, tm, _, k in g["shots"] if tm == opp and t < 600),
                sf=sum(1 for t, tm, _, k in g["shots"] if tm == side),
                sa=sum(1 for t, tm, _, k in g["shots"] if tm == opp),
                gf=g["gf"][side], ga=g["gf"][opp])
            hist[side].append(rec)
    y = np.array([r["y"] for r in rows], float)
    print(f"  team-games {len(rows)}, mean goals first 10 min {y.mean():.3f}")

    def fit(keys):
        X = np.column_stack([np.ones(len(rows))] + [np.log(np.array([max(r[k], 0.02) for r in rows])) if k != "home" else np.array([r[k] for r in rows], float) for k in keys])
        b = np.zeros(X.shape[1]); b[0] = math.log(y.mean())
        for _ in range(50):
            mu = np.exp(X @ b)
            H = X.T @ (X * mu[:, None])
            b = b + np.linalg.solve(H, X.T @ (y - mu))
        mu = np.exp(X @ b)
        ll = float(np.sum(y * np.log(mu) - mu))
        se = np.sqrt(np.diag(np.linalg.inv(X.T @ (X * mu[:, None]))))
        return ll, b, se
    base, _, _ = fit([])
    for keys in (["gf", "ga", "home"], ["egf", "ega", "home"], ["p1f", "p1a", "home"], ["gf", "ga", "home", "egf", "ega"],
                 ["gf", "ga", "home", "p1f", "p1a"], ["gf", "ga", "home", "sf", "sa"], ["gf", "ga", "home", "sf", "sa", "esf", "esa"]):
        ll, b, se = fit(keys)
        print(f"   {'+'.join(keys):32s} ll gain {ll-base:7.1f}  " + " ".join(f"{k}={bb:+.2f}({s:.2f})" for k, bb, s in zip(keys, b[1:], se[1:])))


def player_test(G):
    """Among each team's skaters, who scores the team's goal in the first 5 minutes of P1?
    Candidate score = his rate x his minutes. Compare 'minutes' = overall P1 share vs early share."""
    stat = defaultdict(lambda: dict(gp=0, p1=0.0, early=0.0, open=0, shots=0, eshots=0, g=0, eg=0))
    lg = dict(shots=0, g=0)
    res = defaultdict(float)
    count = 0
    for g in G:
        if not g["shifts"]:
            continue
        sk = {pid for pid, pz in g["pos"].items() if pz != "G"}
        team = {}
        for s in g["shifts"]:
            team[s[0]] = s[1]
        early_goals = [x for x in g["goals"] if x[0] < EARLY and x[3] == "1551"]
        for t, tm, scorer, _ in early_goals:
            cands = [pid for pid in sk if team.get(pid) == tm and stat[pid]["gp"] >= 10]
            if scorer not in cands or len(cands) < 15:
                continue
            sh_lg = (lg["g"] + 1) / (lg["shots"] + 10)
            def rate(pid):
                s = stat[pid]
                return ((s["shots"] + 1) / s["gp"]) * ((s["g"] + 20 * sh_lg) / (s["shots"] + 20)) / max(s["p1"] / s["gp"], 60)
            models = {
                "flat": {p: 1.0 for p in cands},
                "gpg": {p: (stat[p]["g"] + 1) / stat[p]["gp"] for p in cands},
                "rate x P1 TOI": {p: rate(p) * (stat[p]["p1"] + 30) for p in cands},
                "rate x early TOI": {p: rate(p) * (stat[p]["early"] + 30) for p in cands},
                "rate x open%": {p: rate(p) * (stat[p]["open"] + 1) for p in cands},
                "rate x early TOI x open": {p: rate(p) * (stat[p]["early"] + 30) * ((stat[p]["open"] + 1) / (stat[p]["gp"] + 2)) ** 0.0 for p in cands},
                "early shots": {p: (stat[p]["eshots"] + 1) / stat[p]["gp"] for p in cands},
            }
            for name, sc in models.items():
                tot = sum(sc.values())
                res[name] += math.log(sc[scorer] / tot)
            count += 1
        # update
        for pid in sk:
            if pid not in team:
                continue
            s = stat[pid]
            s["gp"] += 1
            for sft in g["shifts"]:
                if sft[0] != pid:
                    continue
                a, b = secs(sft[3]), secs(sft[4])
                s["p1"] += b - a
                s["early"] += max(0, min(b, EARLY) - a)
                if a == 0:
                    s["open"] += 1
            for t, tm, shooter, k in g["shots"]:
                if shooter == pid and k != "missed-shot":
                    s["shots"] += 1; lg["shots"] += 1
                    if t < EARLY:
                        s["eshots"] += 1
            for t, tm, scorer, _ in g["goals"]:
                if scorer == pid:
                    s["g"] += 1; lg["g"] += 1
                    if t < EARLY:
                        s["eg"] += 1
    print(f"  early 5v5 goals tested: {count} (log score per goal; higher = better)")
    for k, v in res.items():
        print(f"   {k:32s} {v/count:.4f}")


def gf_totals(G, season):
    # full-game goals from box score is not loaded; recompute from saved raw summary
    gdir = ROOT / "data/nhl/games" / str(season)
    for g in G:
        raw = json.load(gzip.open(gdir / f"{g['id']}.json.gz", "rt", encoding="utf-8"))
        p = raw["pbp"]
        g["gf"] = {p["homeTeam"]["abbrev"]: p["homeTeam"].get("score", 0), p["awayTeam"]["abbrev"]: p["awayTeam"].get("score", 0)}


def opener_consistency(G):
    """Does the team's opening five match its last game's? And is it the top-TOI line?"""
    last = {}
    same = tot = 0
    per_player = []
    for g in G:
        if not g["shifts"]:
            continue
        op = defaultdict(set)
        for s in g["shifts"]:
            if secs(s[3]) == 0 and g["pos"].get(s[0]) in ("C", "L", "R"):
                op[s[1]].add(s[0])
        for tm, fw in op.items():
            if tm in last:
                tot += 1
                same += len(fw & last[tm]) >= 2
                for p in last[tm]:
                    per_player.append(p in fw)
            last[tm] = fw
    print(f"  opening forwards: 2+ of last game's opening forwards started again {same}/{tot} = {same/tot:.0%}; a forward who started last game started again {np.mean(per_player):.0%}")


def slate_rank(G):
    """Rank of the real Icebreaker among every skater on the 7:00 slate, scored before puck drop
    by (shots/min x shrunk sh%) x his minutes a game (all from games before)."""
    stat = defaultdict(lambda: dict(gp=0, toi=0.0, shots=0, g=0))
    lg = dict(shots=1, g=0)
    by_date = defaultdict(list)
    for g in G:
        if g["et"].hour == 19 and g["et"].minute == 0:
            by_date[g["et"].date()].append(g["id"])
    done = set()
    ranks, shares, team_ranks, nplayers, top_share = [], [], [], [], []
    for g in G:
        d = g["et"].date()
        if g["id"] in by_date.get(d, []) and d not in done and len(by_date[d]) >= 3:
            done.add(d)
            gs = [x for x in G if x["id"] in by_date[d]]
            if all(x["shifts"] for x in gs) and any(x["goals"] for x in gs):
                sh = (lg["g"] + 1) / lg["shots"]
                score, team = {}, {}
                for x in gs:
                    for s in x["shifts"]:
                        team[s[0]] = s[1]
                    for pid in {s[0] for s in x["shifts"]}:
                        st = stat[pid]
                        if x["pos"].get(pid) == "G" or st["gp"] < 3:
                            continue
                        rate = (st["shots"] + 1) / max(st["toi"], 60) * (st["g"] + 30 * sh) / (st["shots"] + 30)
                        score[pid] = rate * st["toi"] / st["gp"]
                t, w = min(((x["goals"][0][0], x) for x in gs if x["goals"]), key=lambda z: z[0])
                scorer = w["goals"][0][2]
                if len(score) < 50:
                    continue
                tot = sum(score.values())
                order = sorted(score, key=score.get, reverse=True)
                nplayers.append(len(order))
                top_share.append(score[order[0]] / tot)
                if scorer in score:
                    ranks.append(order.index(scorer) + 1)
                    shares.append(score[scorer] / tot)
                tsum = defaultdict(float)
                for p, v in score.items():
                    tsum[team[p]] += v
                torder = sorted(tsum, key=tsum.get, reverse=True)
                wt = team.get(scorer)
                if wt in torder:
                    team_ranks.append((torder.index(wt) + 1, len(torder)))
        for s in g["shifts"]:
            pass
        toi = defaultdict(float)
        for s in g["shifts"]:
            toi[s[0]] += secs(s[4]) - secs(s[3])
        for pid, v in toi.items():
            stat[pid]["gp"] += 1
            stat[pid]["toi"] += v
        for t, tm, shooter, k in g["shots"]:
            if k != "missed-shot" and shooter:
                stat[shooter]["shots"] += 1; lg["shots"] += 1
        for t, tm, scorer, _ in g["goals"]:
            if scorer:
                stat[scorer]["g"] += 1; lg["g"] += 1
    r = np.array(ranks)
    print(f"  slates of 3+ games: {len(team_ranks)}; skaters per slate median {np.median(nplayers):.0f}")
    print(f"  real Icebreaker's pregame rank: top 1 {np.mean(r<=1):.0%}, top 5 {np.mean(r<=5):.0%}, top 10 {np.mean(r<=10):.0%}, top 20 {np.mean(r<=20):.0%}, median {np.median(r):.0f}")
    print(f"  model's chance for the real winner: median {np.median(shares):.1%}; the favorite's chance median {np.median(top_share):.1%}; a random pick {np.median([1/n for n in nplayers]):.1%}")
    tr = [a / b for a, b in team_ranks]
    print(f"  winner's team pregame rank: top 1 {np.mean([a==1 for a,b in team_ranks]):.0%}, top 3 {np.mean([a<=3 for a,b in team_ranks]):.0%}, teams median {np.median([b for a,b in team_ranks]):.0f}")


if __name__ == "__main__":
    for season in (2025, 2026):
        G = report(season)
        gf_totals(G, season)
        print(" TEAM: goals in the first 10 min of the 1st (Poisson, from games before)")
        team_test(G)
        print(" PLAYER: who scores his team's early 5v5 goal")
        player_test(G)
        opener_consistency(G)
        print(" THE PROMO: the real Icebreaker's place before puck drop")
        slate_rank(G)
