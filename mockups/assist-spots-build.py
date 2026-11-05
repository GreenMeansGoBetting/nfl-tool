"""Mockup data for the Assist Spots page: tonight's two games, real numbers."""
import sys, json
import pandas as pd, numpy as np
from pathlib import Path
sys.path.insert(0, 'nfl_tool/nba')
import possessions as P, build_nba as B

d = Path(sys.argv[1]); out = sys.argv[2]
box = B.fetch_file('player_box', 2027, d, False)
s = P.Season(B.fetch_file('pbp', 2027, d, False), box)
A, PO = s.actions, s.possessions
box = box[box.season_type == 2]
name = dict(zip(box.athlete_id.dropna().astype(int), box.athlete_display_name))
abbr = dict(zip(box.team_id.astype(int), box.team_abbreviation))
tid = {v: k for k, v in abbr.items()}
date = dict(zip(box.game_id.astype(int), box.game_date.astype(str)))
po = PO.set_index(['game_id', 'n'])
sh = A[A.kind == 'shot'].join(po[['t0']], on=['game_id', 'n']).copy()


def fam(r):
    if r.three:
        return 'k3' if r.kind2 == 'catch' else 'd3'
    if r.kind2 == 'drive':
        return 'dr'
    if r.kind2 in ('cut', 'lob') or r.zone == 'rim':
        return 'cl'
    return 'mid'


sh['fam'] = sh.apply(fam, axis=1)
FAMS = ['k3', 'dr', 'cl', 'd3', 'mid']
gteams = PO.groupby('game_id')['off'].unique().to_dict()
sh['opp'] = [next((t for t in gteams.get(g, []) if t != tm), None) for g, tm in zip(sh.game_id, sh.team)]
made = sh[sh.made].copy()
asts = made[made.assist.notna()].copy()
asts['assist'] = asts.assist.astype(int)
league_mix = asts.fam.value_counts(normalize=True).reindex(FAMS).fillna(0)
# defense: attempts allowed per 100 possessions by family; pace; assisted share allowed
dposs = PO.groupby('def').size()
opp_att = sh.groupby(['opp', 'fam']).size().unstack(fill_value=0).reindex(columns=FAMS, fill_value=0)
opp_rate = opp_att.div(dposs, axis=0) * 100
lg_rate = opp_att.sum() / dposs.sum() * 100
pace = PO.groupby('off').size() / PO.groupby('off').game_id.nunique()
ast_allowed = made.groupby('opp').apply(lambda x: x.assist.notna().mean())


def rank(series, key, high_good=True):
    r = series.rank(ascending=not high_good, method='min')
    return [int(r.get(key)), int(series.notna().sum())]


bx = box[box.athlete_id.notna() & ~box.did_not_play.fillna(False).astype(bool)].copy()
bx['athlete_id'] = bx.athlete_id.astype(int)
bx['game_id'] = bx.game_id.astype(int)


def opp_of(g, team):
    t = [x for x in gteams.get(g, []) if x != team]
    return abbr.get(int(t[0]), '?') if t else '?'


def player_games(pid, team):
    rows = []
    mine = made[(made.team == team) & made['with'].apply(lambda w: pid in w) & (made.player != pid)]
    allmine = sh[(sh.team == team) & sh['with'].apply(lambda w: pid in w) & (sh.player != pid)]
    for _, r in bx[bx.athlete_id == pid].sort_values('game_date').iterrows():
        g = r.game_id
        mk = mine[mine.game_id == g]
        tsh = allmine[allmine.game_id == g]
        k3 = tsh[tsh.fam == 'k3']
        other = mk[mk.assist.notna() & (mk.assist != pid)].assist.astype(int).value_counts()
        rows.append(dict(gid=int(g), date=date[g][5:10], opp=opp_of(g, team),
                         min=int(r.minutes or 0), ast=int(r.assists or 0), ch=len(mk), mine=int((mk.assist == pid).sum()),
                         k3m=int(k3.made.sum()), k3a=len(k3),
                         selfc=float(tsh.kind2.isin(['pullup', 'stepback', 'fade']).mean()) if len(tsh) else 0.0,
                         top=[name.get(int(other.index[0]), '?'), int(other.iloc[0])] if len(other) else None))
    return rows


agg = bx.groupby('athlete_id').agg(g=('game_id', 'nunique'), mn=('minutes', 'mean'), a=('assists', 'mean'), team=('team_id', 'last'))
pool = agg[(agg.g >= 5) & (agg.mn >= 15) & (agg.a >= 2)]
pstats = {}
for pid, r in pool.iterrows():
    team = int(r.team)
    on = made[(made.team == team) & made['with'].apply(lambda w: pid in w) & (made.player != pid)]
    mins = bx[bx.athlete_id == pid].minutes.sum()
    pstats[pid] = dict(ch36=len(on) / mins * 36 if mins else 0, share=(on.assist == pid).mean() if len(on) else 0)
ps = pd.DataFrame(pstats).T
lines = json.load(open(sys.argv[3]))
try:
    inj = B.live_injuries(abbr) or {}
except Exception as ex:
    inj = {}
    print('injuries failed', ex)


def status_of(team_ab, nm):
    t = inj.get(team_ab) if isinstance(inj, dict) else None
    if isinstance(t, dict):
        v = t.get(nm)
        return v if isinstance(v, str) else (v.get('status') if isinstance(v, dict) else None)
    if isinstance(t, list):
        for e in t:
            if isinstance(e, dict) and e.get('name') == nm:
                return e.get('status')
    return None


slate = [('MIA', 'GS'), ('ORL', 'PHX')]
players = []
for away, home in slate:
    for team_ab, opp_ab in ((away, home), (home, away)):
        team, opp = tid[team_ab], tid[opp_ab]
        roster = agg[(agg.team == team) & (agg.g >= 3)].sort_values('a', ascending=False)
        for pid, r in roster.iterrows():
            nm = name[pid]
            if nm not in lines or r.a < 2:
                continue
            games = player_games(pid, team)
            if not games:
                continue
            a = np.array([x['ast'] for x in games])
            ch = np.array([x['ch'] for x in games])
            mine_n = sum(x['mine'] for x in games)
            chs = ch.sum()
            avg_share = mine_n / chs if chs else 0
            avg_ch = ch.mean()
            avg_min = np.mean([x['min'] for x in games])
            pa = asts[asts.assist == pid]
            mix = pa.fam.value_counts(normalize=True).reindex(FAMS).fillna(0)
            lift = mix / league_mix
            best = lift.idxmax()
            recipe = best if (mix[best] >= 0.25 and lift[best] >= 1.3 and len(pa) >= 15) else None
            didx = opp_rate.loc[opp] / lg_rate
            fit = float((mix * didx).sum() - 1) if len(pa) else None
            all_fit = (opp_rate / lg_rate).mul(mix, axis=1).sum(axis=1).drop(team, errors='ignore')
            fit_rank = rank(all_fit, opp) if len(pa) else None
            rec = pa.groupby('player').agg(n=('fam', 'size'), top=('fam', lambda x: x.value_counts().index[0]))
            rec = rec.sort_values('n', ascending=False).head(4)
            receivers = [dict(name=name.get(int(k), '?'), n=int(v.n), how=v.top, status=status_of(team_ab, name.get(int(k), ''))) for k, v in rec.iterrows()]
            mineon = made[(made.team == team) & made['with'].apply(lambda w: pid in w) & (made.player != pid)]
            best_t = None
            for t2 in agg[agg.team == team].index:
                if t2 == pid or agg.loc[t2, 'mn'] < 12:
                    continue
                withm = mineon['with'].apply(lambda w: t2 in w)
                a_on, a_off = mineon[withm], mineon[~withm]
                if len(a_on) < 25 or len(a_off) < 25:
                    continue
                s_on, s_off = (a_on.assist == pid).mean(), (a_off.assist == pid).mean()
                if best_t is None or abs(s_on - s_off) > abs(best_t['on'] - best_t['off']):
                    best_t = dict(name=name[t2], on=round(float(s_on), 3), off=round(float(s_off), 3), n_on=len(a_on), n_off=len(a_off),
                                  status=status_of(team_ab, name[t2]))
            ln = lines.get(nm)
            for x in games:
                tags = []
                if x['min'] <= avg_min - 5:
                    tags.append(['Low Minutes', -1])
                if x['ch'] < 0.8 * avg_ch:
                    tags.append(['Fewer Chances', -1])
                elif x['ch'] > 1.2 * avg_ch:
                    tags.append(['More Chances', 1])
                if x['k3a'] >= 8 and x['k3m'] / x['k3a'] < 0.25:
                    tags.append([f"Teammates Cold {x['k3m']}/{x['k3a']}", -1])
                elif x['k3a'] >= 8 and x['k3m'] / x['k3a'] > 0.47:
                    tags.append([f"Teammates Hot {x['k3m']}/{x['k3a']}", 1])
                sh_g = x['mine'] / x['ch'] if x['ch'] else 0
                if sh_g < 0.75 * avg_share:
                    tags.append([f"Shared Hub ({x['top'][0].split()[-1]} {x['top'][1]})" if x['top'] and x['top'][1] >= 6 else 'Lower Share', -1])
                elif sh_g > 1.25 * avg_share:
                    tags.append(['Ran The Offense', 1])
                x['tags'] = tags
                x['share'] = round(sh_g, 3)
            last = games[-1]
            bounce = bool(last['ast'] < a.mean() and any('Cold' in t[0] for t in last['tags'])
                          and not any(t[0] in ('Fewer Chances', 'Low Minutes') for t in last['tags']))
            pr = ps.loc[pid] if pid in ps.index else None
            if pr is None:
                mins = bx[bx.athlete_id == pid].minutes.sum()
                pr = pd.Series(dict(ch36=len(mineon) / mins * 36 if mins else 0))
            players.append(dict(
                name=nm, team=team_ab, opp=opp_ab, home=team_ab == home,
                line=ln[0] if ln else None, over=ln[1] if ln else None, under=ln[2] if ln else None,
                avg=round(float(a.mean()), 1), l5=round(float(a[-5:].mean()), 1), lo=int(a.min()), hi=int(a.max()),
                over_n=int((a > ln[0]).sum()) if ln else None, n=len(a), log=games, min=round(float(avg_min), 1),
                ch36=round(float(pr.ch36), 1) if pr is not None else None, ch36_rank=rank(ps.ch36, pid) if pid in ps.index else None,
                share=round(float(avg_share), 3), share_rank=rank(ps.share, pid) if pid in ps.index else None,
                selfc=round(float(np.mean([x['selfc'] for x in games])), 3),
                pace=round(float(pace[opp]), 1), pace_rank=rank(pace, opp),
                astd=round(float(ast_allowed[opp]), 3), astd_rank=rank(ast_allowed, opp),
                mix={f: round(float(mix[f]), 3) for f in FAMS}, n_ast=len(pa), recipe=recipe,
                defidx={f: round(float(didx[f]), 3) for f in FAMS}, defrank={f: rank(opp_rate[f], opp) for f in FAMS},
                fit=round(fit, 3) if fit is not None else None, fit_rank=fit_rank,
                receivers=receivers, effect=best_t, bounce=bounce, status=status_of(team_ab, nm)))
# rank self-created share among the slate's players' teammates later in JS
res = dict(date='2026-11-05', games=[f'{a} @ {h}' for a, h in slate],
           league_mix={f: round(float(league_mix[f]), 3) for f in FAMS}, players=players)
json.dump(res, open(out, 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
for p in players:
    print(f"{p['name']:24s} {p['team']} line {p['line']} avg {p['avg']} {p['lo']}-{p['hi']} share {p['share']:.0%} "
          f"recipe {p['recipe']} fit {p['fit']} effect {p['effect'] and (p['effect']['name'], p['effect']['on'], p['effect']['off'])} "
          f"bounce {p['bounce']} status {p['status']}")
print('injury keys sample:', str(inj)[:400])
