"""King of the Court: DraftKings' NBA promo paid on the night's most points +
rebounds + assists (PRA). Built 2026-10-19 for the NBA Promo Tools page.

Everything here reads one season's player box scores (`player_games`), so the
page can show either season (the owner's 2025-26 / 2026-27 toggle):

  * defense board -- how many 40 / 45 / 50 / 55 / 60+ PRA games each team has
    given up, a weighted score of those, how much its best opponent each night
    gets (`star`), and PRA per 48 minutes allowed to guards, forwards and bigs;
  * player board -- the same buckets for every player, his PRA average, last
    10 and last 5, minutes;
  * nights -- every finished night's leader, how many games were on, the
    leader's game total and spread;
  * the slate -- each player's projected PRA for tonight and his chance to
    lead the night (`lead_chances`, a simulation of the whole slate).

ESPN only labels positions G / F / C (a few PG / PF / SF slip through), so
those are the three groups.
"""
import math

import numpy as np
import pandas as pd

REGULAR_SEASON = 2
THRESHOLDS = (40, 45, 50, 55, 60)
BUCKET_WEIGHTS = (1, 2, 3, 4, 5)  # 40+ counts once, 60+ five times (each bucket includes the ones above it)
POS_GROUP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}
POSITIONS = ("G", "F", "C")
SHRINK_GAMES = 10  # a defense's position numbers start as 10 games of a league-average team
PRIOR_GAMES = 5  # this season's PRA average starts as 5 games of last season's
MIN_GAMES = 3  # fewer games than this and a player isn't on the board
MIN_MINUTES = 15
SIMULATIONS = 6000

# Fitted on 2025-26 (tools/backtest/nba_kotc.py, each night projected only
# from the games before it, 150 nights). See nba.md "King of the Court".
WEIGHTS = {
    "l10": 0.5,  # share of the last 10 games in the base (the rest is the season average)
    "opp": 1.0,  # exponent on the other defense's PRA allowed to his position vs the league (fit: 0.99)
    "total": 0.2,  # exponent on the game total vs the league's average total (fit: 0.17)
    # Blowouts and back-to-backs measured as nothing (fit: -0.0025 a point, +0.007);
    # kept at 0 so the page shows them as tags without moving the number.
    "blowout": 0.0,
    "blowout_from": 6.0,
    "b2b": 0.0,
    "sd_a": 4.0,  # spread of one night's PRA around the projection: sd_a + sd_b * projection
    "sd_b": 0.22,
}


def num(value, digits=1):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return round(float(value), digits)


def player_games(player_box: pd.DataFrame, teams) -> pd.DataFrame:
    """One row per player per regular-season game he played, real teams only."""
    box = player_box[(player_box["season_type"] == REGULAR_SEASON) & (player_box["did_not_play"] != True)].copy()  # noqa: E712
    box["min"] = pd.to_numeric(box["minutes"], errors="coerce")
    box = box[(box["min"] > 0) & box["team_abbreviation"].isin(teams) & box["opponent_team_abbreviation"].isin(teams)]
    out = pd.DataFrame({
        "game_id": box["game_id"].astype(str),
        "date": box["game_date"].astype(str),
        "id": box["athlete_id"].astype(int).astype(str),
        "name": box["athlete_display_name"],
        "team": box["team_abbreviation"],
        "opp": box["opponent_team_abbreviation"],
        "home": box["home_away"] == "home",
        "pos": box["athlete_position_abbreviation"].map(POS_GROUP).fillna("F"),
        "headshot": box["athlete_headshot_href"],
        "min": box["min"],
        "pts": box["points"].fillna(0).astype(int),
        "reb": box["rebounds"].fillna(0).astype(int),
        "ast": box["assists"].fillna(0).astype(int),
    })
    out["pra"] = out["pts"] + out["reb"] + out["ast"]
    return out.sort_values(["date", "game_id"]).reset_index(drop=True)


def bucket_counts(pra: pd.Series) -> list:
    return [int((pra >= t).sum()) for t in THRESHOLDS]


def bucket_score(counts) -> int:
    return int(sum(w * c for w, c in zip(BUCKET_WEIGHTS, counts)))


def league_numbers(pg: pd.DataFrame, lines: dict) -> dict:
    """League-wide yardsticks: PRA per 48 by position, minutes a team plays at
    each position a game, the average game total (from the lines)."""
    team_games = max(1, pg.groupby(["game_id", "team"]).ngroups)
    pos = {}
    for p in POSITIONS:
        sub = pg[pg["pos"] == p]
        pos[p] = {
            "per48": 48 * sub["pra"].sum() / sub["min"].sum() if len(sub) else None,
            "min_per_game": sub["min"].sum() / team_games,
        }
    totals = [v[0] for v in lines.values() if v and v[0]]
    return {"pos": pos, "total": float(np.mean(totals)) if totals else 228.0}


def compute_defense(pg: pd.DataFrame, league: dict) -> dict:
    """{team: board row} from what each team's opponents did against it."""
    out = {}
    for team, g in pg.groupby("opp"):
        games = g["game_id"].nunique()
        counts = bucket_counts(g["pra"])
        pos, pos_f = {}, {}
        for p in POSITIONS:
            lg = league["pos"][p]
            sub = g[g["pos"] == p]
            if not lg["per48"]:
                continue
            pos[p] = num(48 * sub["pra"].sum() / sub["min"].sum()) if sub["min"].sum() else None
            # Shrunk toward the league: SHRINK_GAMES games' worth of minutes at the league rate.
            m0 = SHRINK_GAMES * lg["min_per_game"]
            rate = (sub["pra"].sum() + lg["per48"] / 48 * m0) / (sub["min"].sum() + m0)
            pos_f[p] = num(rate * 48 / lg["per48"], 3)
        out[team] = {
            "games": games,
            "buckets": counts,
            "score": bucket_score(counts),
            "star": num(g.groupby("game_id")["pra"].max().mean()),
            "pos": pos,
            "pos_f": pos_f,
        }
    return out


def compute_players(pg: pd.DataFrame, prior: dict | None = None) -> dict:
    """{player id: board row}. `prior` (last season's rows) seeds the average
    with PRIOR_GAMES games of last season, so two games this season can't
    make a star."""
    out = {}
    for pid, g in pg.groupby("id"):
        last = g.iloc[-1]
        games = len(g)
        avg = g["pra"].mean()
        l10 = g["pra"].tail(10).mean()
        base = (1 - WEIGHTS["l10"]) * avg + WEIGHTS["l10"] * l10
        if prior and pid in prior and games < 30:
            k = PRIOR_GAMES
            base = (games * base + k * prior[pid]["base"]) / (games + k)
        counts = bucket_counts(g["pra"])
        out[pid] = {
            "id": pid,
            "name": last["name"],
            "team": last["team"],
            "pos": last["pos"],
            "headshot": last["headshot"] if isinstance(last["headshot"], str) else None,
            "games": games,
            "min": num(g["min"].mean()),
            "l5_min": num(g["min"].tail(5).mean()),
            "pra": num(avg),
            "pts": num(g["pts"].mean()),
            "reb": num(g["reb"].mean()),
            "ast": num(g["ast"].mean()),
            "l10": num(l10),
            "l5": num(g["pra"].tail(5).mean()),
            "high": int(g["pra"].max()),
            "buckets": counts,
            "score": bucket_score(counts),
            "base": num(base, 2),
        }
    return out


def project(player: dict, opp: dict | None, total, team_spread, b2b: bool, league: dict, w: dict = WEIGHTS) -> float:
    """Tonight's PRA: his base x the matchup, the game total, blowout risk, rest."""
    f = 1.0
    if opp and opp.get("pos_f", {}).get(player["pos"]):
        f *= opp["pos_f"][player["pos"]] ** w["opp"]
    if total:
        f *= (total / league["total"]) ** w["total"]
    if team_spread is not None:
        f *= math.exp(w["blowout"] * max(0.0, abs(team_spread) - w["blowout_from"]))
    if b2b:
        f *= math.exp(w["b2b"])
    return player["base"] * f


def lead_chances(projections: list, w: dict = WEIGHTS, sims: int = SIMULATIONS, seed: int = 7) -> list:
    """Each projected PRA's chance to be the night's highest, ties split.
    One night = everyone's projection plus a normal miss of sd_a + sd_b x proj."""
    if not projections:
        return []
    mu = np.array(projections, dtype=float)
    sd = w["sd_a"] + w["sd_b"] * mu
    rng = np.random.default_rng(seed)
    draws = np.rint(rng.normal(mu, sd, size=(sims, len(mu))))
    best = draws.max(axis=1, keepdims=True)
    top = draws == best
    share = top / top.sum(axis=1, keepdims=True)
    return (share.sum(axis=0) / sims).tolist()


def played_yesterday(dates_by_team: dict, team: str, date: str) -> bool:
    prev = (pd.Timestamp(date) - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    return prev in dates_by_team.get(team, set())


def compute_nights(pg: pd.DataFrame, lines: dict) -> list:
    """Every finished night: games played, the leader(s), the runner-up's PRA,
    and the leader's game line (total, his team's spread)."""
    out = []
    for date, g in pg.groupby("date"):
        best = int(g["pra"].max())
        leaders = g[g["pra"] == best]
        second = g.loc[g["pra"] < best, "pra"].max()
        rows = []
        for r in leaders.itertuples(index=False):
            line = lines.get(r.game_id) or [None, None]
            spread = None if line[1] is None else (line[1] if r.home else -line[1])
            rows.append({"id": r.id, "name": r.name, "team": r.team, "opp": r.opp, "pos": r.pos,
                         "pts": int(r.pts), "reb": int(r.reb), "ast": int(r.ast), "total": line[0], "spread": spread})
        out.append({
            "date": date,
            "games": int(g["game_id"].nunique()),
            "pra": best,
            "second": None if pd.isna(second) else int(second),
            "leaders": rows,
        })
    return out


SLATE_SIZES = ((1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 15))
TOTAL_BUCKETS = ((0, 219.5, "Under 220"), (219.5, 229.5, "220-229"), (229.5, 239.5, "230-239"), (239.5, 999, "240+"))
SPREAD_BUCKETS = ((0, 3.5, "0-3"), (3.5, 7, "3.5-6.5"), (7, 10, "7-9.5"), (10, 99, "10+"))


def compute_summary(pg: pd.DataFrame, lines: dict, nights: list) -> dict:
    """The Historical Data popup: the winning PRA by slate size, and whether
    the leader's game total / spread differed from the games on the night.
    `share` = how often the leader came from that kind of game; `fair` = how
    often he would have if every game on the night were equally likely."""
    by_size = []
    for lo, hi in SLATE_SIZES:
        pra = [n["pra"] for n in nights if lo <= n["games"] <= hi]
        if pra:
            q = np.percentile(pra, [25, 50, 75])
            by_size.append({"games": f"{lo}-{hi}" if hi < 15 else f"{lo}+", "nights": len(pra), "median": num(q[1], 0),
                            "low": num(q[0], 0), "high": num(q[2], 0), "max": int(max(pra))})
    night_games = pg.groupby("date")["game_id"].unique()

    def mix(buckets, value_of):
        out = []
        for lo, hi, label in buckets:
            share = fair = 0.0
            counted = 0
            for n in nights:
                lead = n["leaders"][0]
                v = value_of([lead.get("total"), lead.get("spread")])
                vals = [x for x in (value_of(lines.get(g)) for g in night_games.get(n["date"], [])) if x is not None]
                if not vals or v is None:
                    continue
                counted += 1
                share += lo <= v < hi
                fair += sum(lo <= x < hi for x in vals) / len(vals)
            if counted:
                out.append({"label": label, "share": num(share / counted, 3), "fair": num(fair / counted, 3)})
        return out

    total_of = lambda line: line[0] if line and line[0] else None  # noqa: E731
    spread_of = lambda line: abs(line[1]) if line and line[1] is not None else None  # noqa: E731
    fav = [n["leaders"][0]["spread"] for n in nights if n["leaders"][0].get("spread") not in (None, 0)]
    pos = pd.Series([n["leaders"][0]["pos"] for n in nights]).value_counts()
    most = pd.Series([(n["leaders"][0]["id"], n["leaders"][0]["name"]) for n in nights]).value_counts().head(8)
    totals = [n["leaders"][0]["total"] for n in nights if n["leaders"][0].get("total")]
    all_totals = [v[0] for g in pg["game_id"].unique() if (v := lines.get(g)) and v[0]]
    return {
        "nights": len(nights),
        "median": num(np.median([n["pra"] for n in nights]), 0) if nights else None,
        "mean": num(np.mean([n["pra"] for n in nights]), 1) if nights else None,
        "ties": sum(len(n["leaders"]) > 1 for n in nights),
        "by_size": by_size,
        "by_total": mix(TOTAL_BUCKETS, total_of),
        "by_spread": mix(SPREAD_BUCKETS, spread_of),
        "leader_total": num(np.mean(totals)) if totals else None,
        "game_total": num(np.mean(all_totals)) if all_totals else None,
        "favored": num(np.mean([s < 0 for s in fav]), 3) if fav else None,
        "positions": {p: int(pos.get(p, 0)) for p in POSITIONS},
        "most": [{"id": pid, "name": name, "nights": int(c)} for (pid, name), c in most.items()],
    }


def season_block(pg: pd.DataFrame, lines: dict, label: str, prior: dict | None = None) -> dict:
    league = league_numbers(pg, lines)
    nights = compute_nights(pg, lines)
    return {
        "label": label,
        "games": int(pg["game_id"].nunique()),
        "league": {"total": num(league["total"]), "pos": {p: num(v["per48"]) for p, v in league["pos"].items()}},
        "defense": compute_defense(pg, league),
        "players": compute_players(pg, prior),
        "nights": nights,
        "summary": compute_summary(pg, lines, nights),
        "_league": league,
    }


def slate(block: dict, games: list, rosters_team: dict, out_ids: set, dates: list) -> dict:
    """{date: [player rows]} for the next few nights: who plays, his projection
    and his chance to lead the night. `rosters_team` puts a player on his team
    today (a summer trade); `out_ids` are players listed Out."""
    league = block["_league"]
    team_dates = {}
    for g in games:
        for t in (g["away"], g["home"]):
            team_dates.setdefault(t, set()).add(g["date"])
    by_team = {}
    for p in block["players"].values():
        team = rosters_team.get(p["id"], p["team"]) if rosters_team else p["team"]
        if team is None:
            continue
        by_team.setdefault(team, []).append(p)
    out = {}
    for date in dates:
        rows = []
        for g in (x for x in games if x["date"] == date):
            for side, opp in (("away", "home"), ("home", "away")):
                team = g[side]
                spread = g.get(f"{side}_team_spread")
                b2b = played_yesterday(team_dates, team, date)
                for p in by_team.get(team, []):
                    if p["games"] < MIN_GAMES or (p["min"] or 0) < MIN_MINUTES:
                        continue
                    proj = project(p, block["defense"].get(g[opp]), g.get("total_line"), spread, b2b, league)
                    rows.append({"id": p["id"], "team": team, "opp": g[opp], "game_id": g["game_id"], "home": side == "home",
                                 "proj": round(proj, 1), "b2b": b2b, "out": p["id"] in out_ids})
        live = [r for r in rows if not r["out"]]
        for r, chance in zip(live, lead_chances([r["proj"] for r in live])):
            r["lead"] = round(chance, 4)
        rows.sort(key=lambda r: -r["proj"])
        out[date] = rows
    return out
