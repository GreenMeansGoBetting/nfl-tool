"""Walk-forward replay of the GMG model's inputs.

For every finished game of a season, each piece the model reads (scoring,
every matchup grade gap, QB out) is computed ONLY from games played before
that week, the way the site would have seen it. One row per game goes to
data/backtest/features_<season>.csv (data/ is not in git).

    python tools/backtest/features.py 2024 2025      (about 4 minutes a season)
    python tools/backtest/analyze.py 2024 2025

The ESPN ratings part of the model is NOT replayed: ESPN keeps no history
of its week-by-week ratings. nflverse has no weekly roster file for 2023
and earlier, so those seasons fail on download."""
import sys, json, time, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "nfl_tool"))
import pandas as pd
import build_stats as b
import gmg_model as m
from line_grades import compute_line_grades, load_ngs

DATA = ROOT / "data"
OUT = ROOT / "data" / "backtest"
OUT.mkdir(parents=True, exist_ok=True)

def stats_as_of(pbp, ftn, teams):
    team_games = b.compute_team_game_td_counts(pbp)
    team_games_allowed = b.compute_team_game_td_allowed(pbp)
    games_played = b.compute_games_played(pbp)
    pos_lookup = stats_as_of.pos
    first_td_by_game = b.compute_first_td_per_game(pbp, pos_lookup)
    scoring_df = b.scoring_plays_with_position(pbp, pos_lookup)
    red_zone = b.compute_red_zone(pbp)
    red_zone_trips = b.compute_red_zone_trips(pbp)
    length_buckets = b.compute_length_buckets(pbp)
    explosive = b.compute_explosive_plays(pbp)
    epa = b.compute_epa_per_play(pbp)
    general = b.compute_general_stats(pbp)
    recent_games = b.compute_recent_games(pbp)
    possessions_to_score = b.compute_possessions_to_score(pbp, first_td_by_game)
    trailing_possessions = b.compute_trailing_possessions(pbp, first_td_by_game)
    a1, a2, a3, a4 = b.compute_pre_first_td_red_zone(pbp, first_td_by_game)
    fp, fpa = b.compute_first_td_position_breakdown(first_td_by_game, teams)
    ts = b.build_team_stats(team_games, team_games_allowed, games_played, first_td_by_game, scoring_df, red_zone, red_zone_trips,
                            length_buckets, explosive, epa, general, recent_games, possessions_to_score, trailing_possessions,
                            a1, a2, a3, a4, fp, fpa, teams)
    scheme = b.compute_scheme_splits(pbp, ftn, teams)
    for t in teams:
        ts[t].update(scheme.get(t, {}))
    adj = b.compute_opponent_adjusted_stats(pbp, ftn, ts)
    return ts, adj

def run(season, first_week=3):
    pbp_all = b.load_pbp(DATA, season)
    rosters = b.load_rosters(DATA, season)
    stats_as_of.pos = b.build_position_lookup(rosters)
    ftn_all = b.load_ftn_charting(DATA, season)
    try:
        inj = b.load_injuries(DATA, season)
    except Exception as e:
        print("no injuries", e); inj = None
    ngs_pass_all, ngs_rush_all = load_ngs(DATA, season)
    schedule = b.compute_schedule(DATA, season)
    teams = sorted(set(g["away"] for g in schedule) | set(g["home"] for g in schedule))
    rows = []
    weeks = sorted({g["week"] for g in schedule if g["home_score"] is not None})
    for wk in weeks:
        if wk < first_week:
            continue
        t0 = time.time()
        pbp = pbp_all[pbp_all["week"] < wk]
        gids = set(pbp["game_id"].unique())
        ftn = ftn_all[ftn_all["nflverse_game_id"].isin(gids)] if ftn_all is not None and len(ftn_all) else ftn_all
        ngp = ngs_pass_all[ngs_pass_all["week"] < wk] if ngs_pass_all is not None else None
        ngr = ngs_rush_all[ngs_rush_all["week"] < wk] if ngs_rush_all is not None else None
        ts, adj = stats_as_of(pbp, ftn, teams)
        try:
            lines = compute_line_grades(pbp, ftn, ngp, ngr, stats_as_of.pos, teams)
        except Exception as e:
            print("line grades failed", season, wk, e); lines = {}
        logs = b.compute_player_game_logs(pbp, stats_as_of.pos)
        blob = {"team_stats": ts, "team_stats_adj": adj, "teams": teams, "line_grades": lines, "player_game_logs": logs}
        g = m._Grades(blob)
        played = lambda t: g.raw[t].get("games_played") or 0
        trust = lambda t: played(t) / (played(t) + m.PRIOR_GAMES)
        outs = {}
        if inj is not None:
            w = inj[inj["week"] == wk]
            for r in w.itertuples(index=False):
                if isinstance(r.report_status, str) and r.report_status.lower() == "out":
                    outs.setdefault(b.normalize_team(r.team), set()).add(m._norm_name(r.full_name))
        def side(off, dfn):
            f = {}
            f["scoring"] = (g.stats[off]["points_for_per_g"] - g.league) * trust(off) + (g.stats[dfn]["points_against_per_g"] - g.league) * trust(dfn)
            ramp = min(1.0, (played(off) + played(dfn)) / 2 / m.FULL_TRUST_GAMES)
            for label in m.GRADE_WEIGHTS:
                oz, dz = g.category(label, off, "off"), g.category(label, dfn, "def")
                f["m_" + label] = (oz - dz) * ramp if oz is not None and dz is not None else None
            for ok, oi, dk, di, _ in m.STAT_WEIGHTS:
                oz, dz = g.stat_z(off, ok, oi), g.stat_z(dfn, dk, di)
                f["m_" + ok] = (oz - dz) * ramp if oz is not None and dz is not None else None
            f["matchups_default"] = g.matchup_gap(off, dfn) * m.POINTS_PER_Z * ramp
            qb = m._regular_qb(blob, off, wk)
            f["qb_out"] = int(bool(qb) and m._norm_name(qb) in outs.get(off, set()))
            return f
        for game in schedule:
            if game["week"] != wk or game["home_score"] is None:
                continue
            a, h = game["away"], game["home"]
            if a not in g.pool or h not in g.pool:
                continue
            row = {"season": season, "week": wk, "game_id": game["game_id"], "away": a, "home": h,
                   "away_score": game["away_score"], "home_score": game["home_score"],
                   "home_spread": game.get("home_team_spread"), "total": game.get("total_line"), "league": g.league}
            for k, v in side(h, a).items(): row["h_" + k] = v
            for k, v in side(a, h).items(): row["a_" + k] = v
            rows.append(row)
        print(season, wk, len(rows), "%.1fs" % (time.time() - t0), flush=True)
    pd.DataFrame(rows).to_csv(OUT / f"features_{season}.csv", index=False)

if __name__ == "__main__":
    for s in sys.argv[1:]:
        run(int(s))
