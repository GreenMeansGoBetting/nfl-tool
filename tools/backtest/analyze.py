"""What the walk-forward replay says about the GMG model (see features.py).

Prints: how big the model's margins are next to the market's, its record
against the closing spread and total, how each piece does on its own, the
weights a fit would pick, and an honest test (tune on one season, bet the
other). The model here has no ratings part.

    python tools/backtest/analyze.py 2024 2025
"""
import sys, json
from pathlib import Path
import numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool"))
import gmg_model as m
D = ROOT / "data" / "backtest"
seasons = [int(s) for s in sys.argv[1:]] or [2024, 2025]
f = pd.concat([pd.read_csv(D / f"features_{s}.csv") for s in seasons], ignore_index=True)
f = f.dropna(subset=["home_spread", "total"]).reset_index(drop=True)
pieces = ["m_" + k for k in m.GRADE_WEIGHTS] + ["m_" + s[0] for s in m.STAT_WEIGHTS]
W = {**{"m_" + k: v for k, v in m.GRADE_WEIGHTS.items()}, **{"m_" + s[0]: s[4] for s in m.STAT_WEIGHTS}}
NAMES = {"m_Passing": "Passing", "m_Rushing": "Rushing", "m_Red Zone": "Red Zone", "m_Trenches": "Trenches", "m_Scheme": "Blitz & Box", "m_epa_per_play": "EPA/play",
         "m_third_down_rate": "3rd down", "m_explosive_rate": "Explosive", "m_turnovers_per_g": "Turnovers", "m_sacks_allowed_per_g": "Sacks", "m_penalty_yards_off_per_g": "Penalties"}
for p in pieces + ["scoring"]:
    for s in "ha":
        f[s + "_" + p] = f[s + "_" + p].fillna(0.0)
f["margin"] = f.home_score - f.away_score
f["pts"] = f.home_score + f.away_score
f["mkt_margin"] = -f.home_spread
f["ats"] = f.margin + f.home_spread          # >0 home covered
f["ou"] = f.pts - f.total                    # >0 over
B = m.BLEND
# The model without the ESPN ratings part (no point-in-time history exists for it).
f["h_pts_m"] = f.league + B["scoring"] * f.h_scoring + B["matchups"] * f.h_matchups_default + m.HOME_FIELD / 2 - m.QB_OUT_POINTS * f.h_qb_out
f["a_pts_m"] = f.league + B["scoring"] * f.a_scoring + B["matchups"] * f.a_matchups_default - m.HOME_FIELD / 2 - m.QB_OUT_POINTS * f.a_qb_out
f["mod_margin"] = f.h_pts_m - f.a_pts_m
f["mod_total"] = f.h_pts_m + f.a_pts_m
print(f"games: {len(f)}  seasons: {sorted(f.season.unique())}  weeks {f.week.min()}-{f.week.max()}")


def rec(pick_home, mask=None):
    d = f if mask is None else f[mask]
    ph = pick_home if mask is None else pick_home[mask]
    w = int(((d.ats > 0) & ph).sum() + ((d.ats < 0) & ~ph).sum())
    l = int(((d.ats < 0) & ph).sum() + ((d.ats > 0) & ~ph).sum())
    return w, l, (100 * w / (w + l) if w + l else float("nan"))


def rec_tot(pick_over, mask=None):
    d = f if mask is None else f[mask]
    po = pick_over if mask is None else pick_over[mask]
    w = int(((d.ou > 0) & po).sum() + ((d.ou < 0) & ~po).sum())
    l = int(((d.ou < 0) & po).sum() + ((d.ou > 0) & ~po).sum())
    return w, l, (100 * w / (w + l) if w + l else float("nan"))


print("\n== 1. Scale: how big are the model's margins vs the market's and reality")
print("  avg |margin|: actual %.1f  market %.1f  model(no ratings) %.1f" % (f.margin.abs().mean(), f.mkt_margin.abs().mean(), f.mod_margin.abs().mean()))
sl = np.polyfit(f.mod_margin, f.margin, 1)
slm = np.polyfit(f.mkt_margin, f.margin, 1)
print("  actual margin = %.2f x model margin %+.2f   (market: %.2f x %+.2f)" % (sl[0], sl[1], slm[0], slm[1]))
print("  corr with actual margin: model %.3f  market %.3f" % (np.corrcoef(f.mod_margin, f.margin)[0, 1], np.corrcoef(f.mkt_margin, f.margin)[0, 1]))
print("  MAE margin: model %.2f  market %.2f | MAE total: model %.2f market %.2f" % ((f.mod_margin - f.margin).abs().mean(), (f.mkt_margin - f.margin).abs().mean(), (f.mod_total - f.pts).abs().mean(), (f.total - f.pts).abs().mean()))
st = np.polyfit(f.mod_total - 2 * f.league, f.pts - 2 * f.league, 1)
print("  totals: actual-avg = %.2f x (model-avg) %+.2f ; corr model %.3f market %.3f" % (st[0], st[1], np.corrcoef(f.mod_total, f.pts)[0, 1], np.corrcoef(f.total, f.pts)[0, 1]))

print("\n== 2. Picks vs the closing line (model without ratings, current sliders)")
lean = f.mod_margin + f.home_spread
ph = lean > 0
print("  all spread picks: %d-%d (%.1f%%)" % rec(ph))
for lo, hi in [(0, 1), (1, 2.5), (2.5, 4), (4, 99)]:
    mk = (lean.abs() >= lo) & (lean.abs() < hi)
    print("    edge %s-%s: %d-%d (%.1f%%)" % ((lo, hi) + rec(ph, mk)))
dog = (ph & (f.home_spread > 0)) | (~ph & (f.home_spread < 0))
print("  picks that were underdogs: %.0f%%  | dogs: %d-%d (%.1f%%)  favorites: %d-%d (%.1f%%)" % ((100 * dog.mean(),) + rec(ph, dog) + rec(ph, ~dog & (f.home_spread != 0))))
print("  blindly taking every underdog: %d-%d (%.1f%%)" % rec(f.home_spread > 0, f.home_spread != 0))
tl = f.mod_total - f.total
po = tl > 0
print("  all total picks: %d-%d (%.1f%%)  | overs picked %.0f%%" % (rec_tot(po) + (100 * po.mean(),)))
for lo, hi in [(0, 1.5), (1.5, 3), (3, 99)]:
    mk = (tl.abs() >= lo) & (tl.abs() < hi)
    print("    edge %s-%s: %d-%d (%.1f%%)" % ((lo, hi) + rec_tot(po, mk)))
print("  by season (spread | total):")
for s in sorted(f.season.unique()):
    mk = f.season == s
    print("    %d: %d-%d (%.1f%%) | %d-%d (%.1f%%)" % ((s,) + rec(ph, mk) + rec_tot(po, mk)))

print("\n== 3. Each piece on its own: does the team with the edge win / cover?")
rows = []
for p in pieces + ["scoring"]:
    d = f["h_" + p] - f["a_" + p]
    c = np.corrcoef(d, f.margin)[0, 1]
    ca = np.corrcoef(d, f.ats)[0, 1]
    big = d.abs() >= d.abs().quantile(2 / 3)
    won = (np.sign(d[big]) == np.sign(f.margin[big]))[f.margin[big] != 0].mean()
    wonall = (np.sign(d) == np.sign(f.margin))[(f.margin != 0) & (d != 0)].mean()
    cov = (np.sign(d[big]) == np.sign(f.ats[big]))[f.ats[big] != 0].mean()
    covall = (np.sign(d) == np.sign(f.ats))[(f.ats != 0) & (d != 0)].mean()
    rows.append((p, c, ca, won, wonall, cov, covall))
print("  %-12s slider | corr margin | edge team WON: any / big edge | edge team COVERED: any / big edge | corr ats" % "piece")
for p, c, ca, won, wonall, cov, covall in sorted(rows, key=lambda r: -r[1]):
    print("  %-12s %5.0f%% |    %.3f    |      %.1f%% / %.1f%%            |      %.1f%% / %.1f%%               | %+.3f" % (NAMES.get(p, "Scoring"), 100 * W.get(p, 0), c, 100 * wonall, 100 * won, 100 * covall, 100 * cov, ca))
fav_won = (np.sign(f.mkt_margin) == np.sign(f.margin))[(f.margin != 0) & (f.mkt_margin != 0)].mean()
print("  %-12s        |    %.3f    |      %.1f%% (favorite won)" % ("(market)", np.corrcoef(f.mkt_margin, f.margin)[0, 1], 100 * fav_won))


def design(d):
    X = np.vstack([np.column_stack([d["h_" + p] for p in pieces] + [d.h_scoring, np.ones(len(d)), -d.h_qb_out]),
                   np.column_stack([d["a_" + p] for p in pieces] + [d.a_scoring, -np.ones(len(d)), -d.a_qb_out])])
    y = np.concatenate([d.home_score - d.league, d.away_score - d.league])
    return X, y


def ridge(X, y, lam):
    A = X.T @ X + lam * np.eye(X.shape[1])
    A[-2, -2] -= lam
    A[-1, -1] -= lam
    return np.linalg.solve(A, X.T @ y)


print("\n== 4. Sliders the data would pick (fit on each team's actual points)")
X, y = design(f)
w = ridge(X, y, 50.0)
mw = w[:len(pieces)]
cur_pts = {p: B["matchups"] * m.POINTS_PER_Z * W[p] for p in pieces}
tot = np.clip(mw, 0, None).sum()
print("  %-12s  current share / pts per z   fitted share / pts per z" % "piece")
for p, v in sorted(zip(pieces, mw), key=lambda r: -r[1]):
    print("  %-12s      %4.0f%%  %+.2f              %4.0f%%  %+.2f" % (NAMES[p], 100 * W[p], cur_pts[p], 100 * max(v, 0) / tot, v))
print("  all matchup pieces together: current %.2f pts per z of total gap, fitted %.2f" % (B["matchups"] * m.POINTS_PER_Z, mw.sum()))
print("  scoring: fitted %.2f (current %.2f) | home field: fitted %.2f (current %.1f) | QB out: fitted %.2f (current %.1f)" % (w[len(pieces)], B["scoring"], 2 * w[-2], m.HOME_FIELD, w[-1], m.QB_OUT_POINTS))
json.dump({"pieces": dict(zip(pieces, mw.tolist())), "scoring": float(w[len(pieces)]), "home_field": float(2 * w[-2]), "qb_out": float(w[-1])}, open(D / "fitted.json", "w"), indent=1)

print("\n== 5. Honest test: tune sliders on the other seasons, bet the one left out")
tw = tl_ = dw = dl = 0
for s in sorted(f.season.unique()):
    tr, te = f[f.season != s], f[f.season == s]
    w = ridge(*design(tr), 50.0)

    def pts(d, side):
        sg = 1 if side == "h" else -1
        return d.league + sum(w[i] * d[side + "_" + p] for i, p in enumerate(pieces)) + w[len(pieces)] * d[side + "_scoring"] + sg * w[-2] - w[-1] * d[side + "_qb_out"]
    mm = pts(te, "h") - pts(te, "a")
    mt = pts(te, "h") + pts(te, "a")
    ph2 = (mm + te.home_spread) > 0
    w_ = int(((te.ats > 0) & ph2).sum() + ((te.ats < 0) & ~ph2).sum())
    l_ = int(((te.ats < 0) & ph2).sum() + ((te.ats > 0) & ~ph2).sum())
    po2 = (mt - te.total) > 0
    wt = int(((te.ou > 0) & po2).sum() + ((te.ou < 0) & ~po2).sum())
    lt = int(((te.ou < 0) & po2).sum() + ((te.ou > 0) & ~po2).sum())
    dflt = rec(ph, f.season == s)
    print("    %d: tuned spread %d-%d (%.1f%%)  total %d-%d (%.1f%%) | current sliders spread %d-%d (%.1f%%) | margin miss: tuned %.2f  current %.2f  market %.2f" % (
        s, w_, l_, 100 * w_ / (w_ + l_), wt, lt, 100 * wt / (wt + lt), dflt[0], dflt[1], dflt[2], (mm - te.margin).abs().mean(), (te.mod_margin - te.margin).abs().mean(), (te.mkt_margin - te.margin).abs().mean()))
    tw += w_; tl_ += l_; dw += wt; dl += lt
print("  tuned, out of sample: spread %d-%d (%.1f%%)  total %d-%d (%.1f%%)" % (tw, tl_, 100 * tw / (tw + tl_), dw, dl, 100 * dw / (dw + dl)))
