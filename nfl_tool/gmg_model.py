"""GMG score model + its pick record (2026-10-10, designed with the user).

Projects both teams' points for every upcoming game, turns the gap between
that and the betting line into a spread pick and a total pick, and FREEZES
the projection once the game kicks off so the record is honest: a finished
game's numbers are whatever the last build before kickoff said, never a
re-run with that game already inside the stats.

Each team's points = league average + three reads of its offense against
that defense, blended (BLEND):
  * ratings  -- ESPN FPI offense minus defense point values (steady early:
    they carry preseason priors and QB changes).
  * scoring  -- the team's opponent-adjusted points for, and the other
    team's points against, pulled toward average until PRIOR_GAMES played.
  * matchups -- everything graded on the Game Summary card: the offense's z
    minus the defense's z for each piece (the same two-sided gap the card's
    tags use), weighted by GRADE_WEIGHTS / STAT_WEIGHTS, POINTS_PER_Z each.
Home field is split across the two teams, and a starting QB ruled Out costs
his team QB_OUT_POINTS (the stats were built with him playing).

The grade math mirrors game-overview.js (compositeZ, schemeCompositeZ,
trenchesZ, SUMMARY_CATEGORIES) on opponent-adjusted stats -- if a grade's
recipe changes there, change it here too. Weights were set from the 2026
season's first 65 finished games and marked down for being in-sample; the
model has NOT been backtested on other seasons.
"""
from datetime import datetime, timedelta, timezone

BLEND = {"ratings": 0.4, "scoring": 0.2, "matchups": 0.4}
PRIOR_GAMES = 4
HOME_FIELD = 1.6
POINTS_PER_Z = 4.0
FULL_TRUST_GAMES = 4
QB_OUT_POINTS = 3.5
# A pick counts as a "bigger edge" when the model is this far from the line.
EDGE_POINTS = 2.5

# (key, invert, weight) per side -- SUMMARY_CATEGORIES in game-overview.js.
CATEGORIES = {
    "Passing": {
        "off": [("epa_per_play_pass", False, 2), ("yards_per_att", False, 1), ("explosive_pass_rate", False, 1)],
        "def": [("epa_per_play_pass_allowed", True, 2), ("yards_per_att_allowed", True, 1), ("explosive_pass_rate_allowed", True, 1)],
    },
    "Rushing": {
        "off": [("epa_per_play_rush", False, 2), ("yards_per_carry", False, 1), ("explosive_rush_rate", False, 1)],
        "def": [("epa_per_play_rush_allowed", True, 2), ("yards_per_carry_allowed", True, 1), ("explosive_rush_rate_allowed", True, 1)],
    },
    "Red Zone": {
        "off": [("rz_trips_per_g", False, 7), ("rz_avg_points", False, 3)],
        "def": [("rz_trips_allowed_per_g", True, 7), ("rz_avg_points_allowed", True, 3)],
    },
}
# (offense's result vs the look, defense's result allowed in it) -- SCHEME_GROUPS.
SCHEME_ROWS = [
    ("ypc_vs_heavy_box", "def_ypc_allowed_heavy_box"),
    ("ypc_vs_light_box", "def_ypc_allowed_light_box"),
    ("success_vs_blitz", "def_success_allowed_blitz"),
    ("success_vs_standard_rush", "def_success_allowed_standard_rush"),
    ("success_vs_pressure", "def_success_allowed_pressure"),
    ("success_vs_clean_pocket", "def_success_allowed_clean_pocket"),
]
GRADE_WEIGHTS = {"Passing": 0.25, "Rushing": 0.12, "Red Zone": 0.13, "Trenches": 0.15, "Scheme": 0.08}
# (offense key, invert, defense key, invert, weight)
STAT_WEIGHTS = [
    ("epa_per_play", False, "epa_per_play_allowed", True, 0.12),
    ("third_down_rate", False, "third_down_rate_allowed", True, 0.05),
    ("explosive_rate", False, "explosive_rate_allowed", True, 0.04),
    ("turnovers_per_g", True, "takeaways_per_g", False, 0.03),
    ("sacks_allowed_per_g", True, "sacks_made_per_g", False, 0.02),
    ("penalty_yards_off_per_g", True, "penalty_yards_def_per_g", True, 0.01),
]


def _z(value, values, invert=False):
    clean = [v for v in values if v is not None]
    if len(clean) < 3 or value is None:
        return None
    mean = sum(clean) / len(clean)
    sd = (sum((v - mean) ** 2 for v in clean) / len(clean)) ** 0.5
    if sd == 0:
        return 0.0
    return -(value - mean) / sd if invert else (value - mean) / sd


class _Grades:
    """Every z the model reads, on opponent-adjusted stats."""

    def __init__(self, blob):
        self.raw = blob["team_stats"]
        adj = blob.get("team_stats_adj") or {}
        self.stats = {t: {**s, **(adj.get(t) or {})} for t, s in self.raw.items()}
        self.pool = [t for t in blob["teams"] if (self.raw.get(t) or {}).get("games_played")]
        self.lines = blob.get("line_grades") or {}
        self.league = sum(self.raw[t]["points_for_per_g"] for t in self.pool) / len(self.pool) if self.pool else None

    def value(self, team, key):
        s = self.stats[team]
        per_g = s.get(key + "_per_g")
        return per_g if per_g is not None else s.get(key)

    def stat_z(self, team, key, invert):
        return _z(self.value(team, key), [self.value(t, key) for t in self.pool], invert)

    def composite(self, team, metrics):
        total = weight_sum = 0.0
        for key, invert, weight in metrics:
            z = self.stat_z(team, key, invert)
            if z is None:
                continue
            total += z * weight
            weight_sum += weight
        return total / weight_sum if weight_sum else None

    def scheme(self, team, side):
        total = weight_sum = 0.0
        for off_key, def_key in SCHEME_ROWS:
            key = off_key if side == "off" else def_key
            weight = self.stats[team].get(key + "_plays")
            value = self.stats[team].get(key)
            if not weight or value is None:
                continue
            z = _z(value, [self.stats[t].get(key) for t in self.pool], side == "def")
            if z is None:
                continue
            total += z * weight
            weight_sum += weight
        return total / weight_sum if weight_sum else None

    def trenches(self, team, side):
        entry = ((self.lines.get(team) or {}).get("ol" if side == "off" else "dl") or {}).get("overall") or {}
        return entry.get("z")

    def category(self, label, team, side):
        if label == "Scheme":
            return self.scheme(team, side)
        if label == "Trenches":
            return self.trenches(team, side)
        return self.composite(team, CATEGORIES[label][side])

    def matchup_gap(self, off, dfn):
        gap = 0.0
        for label, weight in GRADE_WEIGHTS.items():
            off_z, def_z = self.category(label, off, "off"), self.category(label, dfn, "def")
            if off_z is not None and def_z is not None:
                gap += weight * (off_z - def_z)
        for off_key, off_inv, def_key, def_inv, weight in STAT_WEIGHTS:
            off_z, def_z = self.stat_z(off, off_key, off_inv), self.stat_z(dfn, def_key, def_inv)
            if off_z is not None and def_z is not None:
                gap += weight * (off_z - def_z)
        return gap


def _norm_name(name):
    words = "".join(ch for ch in (name or "").lower() if ch.isalnum() or ch == " ").split()
    return " ".join(w for w in words if w not in ("jr", "sr", "ii", "iii", "iv"))


def _regular_qb(blob, team, week):
    """The team's No. 1 QB: most games as its lead passer (10+ attempts)
    before `week`, a tie going to whoever led more recently. Mirrors
    gsRegularQb in game-summary.js."""
    leads = {}
    for name, games in ((blob.get("player_game_logs") or {}).get(team) or {}).items():
        for g in games:
            att, wk = g.get("pass_att") or 0, g.get("week")
            if wk is not None and wk < week and att >= 10 and att > leads.get(wk, (0, None))[0]:
                leads[wk] = (att, name)
    starts, last = {}, {}
    for wk, (_, name) in leads.items():
        starts[name] = starts.get(name, 0) + 1
        last[name] = max(last.get(name, 0), wk)
    return max(starts, key=lambda n: (starts[n], last[n])) if starts else None


def _qb_out(blob, team, week):
    """The team's regular QB, if he is ruled Out this week (injury report or
    IR). A backup who filled in and is now Out himself does NOT count: the
    first version flagged Mariota (Out) the week Jayden Daniels returned
    (user 2026-10-10)."""
    qb = _regular_qb(blob, team, week)
    if not qb:
        return None
    key = _norm_name(qb)
    for p in ((blob.get("injuries") or {}).get(team) or {}).get(str(week)) or []:
        if _norm_name(p.get("full_name")) == key and "out" in (p.get("status") or "").lower():
            return qb
    for p in (blob.get("roster_out") or {}).get(team) or []:
        if _norm_name(p.get("name")) == key:
            return qb
    return None


def _line(game, key):
    """Novig's number first, best-of-books when Novig has none (pv() in game-overview.js)."""
    value = (game.get("novig") or {}).get(key)
    return value if value is not None else game.get(key)


def _started(game, now_et):
    if game.get("status") == "final" or game.get("home_score") is not None:
        return True
    try:
        return datetime.strptime(f"{game['date']} {game.get('time') or '00:00'}", "%Y-%m-%d %H:%M") <= now_et
    except (KeyError, TypeError, ValueError):
        return False


def _project(blob, grades, game):
    ratings = blob.get("espn_ratings") or {}
    away, home = game["away"], game["home"]
    if grades.league is None or away not in ratings or home not in ratings or away not in grades.pool or home not in grades.pool:
        return None
    played = lambda t: grades.raw[t].get("games_played") or 0
    trust = lambda t: played(t) / (played(t) + PRIOR_GAMES)

    def points(off, dfn):
        rating = ratings[off]["off"] - ratings[dfn]["def"]
        scoring = (grades.stats[off]["points_for_per_g"] - grades.league) * trust(off) + (grades.stats[dfn]["points_against_per_g"] - grades.league) * trust(dfn)
        matchups = grades.matchup_gap(off, dfn) * POINTS_PER_Z * min(1.0, (played(off) + played(dfn)) / 2 / FULL_TRUST_GAMES)
        return grades.league + BLEND["ratings"] * rating + BLEND["scoring"] * scoring + BLEND["matchups"] * matchups

    qb_out = [t for t in (away, home) if _qb_out(blob, t, game["week"])]
    away_pts = points(away, home) - HOME_FIELD / 2 - (QB_OUT_POINTS if away in qb_out else 0)
    home_pts = points(home, away) + HOME_FIELD / 2 - (QB_OUT_POINTS if home in qb_out else 0)
    entry = {"week": game["week"], "away": away, "home": home, "away_pts": round(away_pts, 1), "home_pts": round(home_pts, 1), "qb_out": qb_out}
    spread, total = _line(game, "home_team_spread"), _line(game, "total_line")
    if spread is not None:
        # Home is expected to win by -spread; the model's margin past that picks a side.
        lean = (home_pts - away_pts) + spread
        entry.update({"spread": spread, "spread_pick": "home" if lean > 0 else "away", "spread_edge": round(abs(lean), 1)})
    if total is not None:
        lean = (away_pts + home_pts) - total
        entry.update({"total": total, "total_pick": "over" if lean > 0 else "under", "total_edge": round(abs(lean), 1)})
    return entry


def _grade(entry, game):
    """win / loss / push for each pick against the line it was made at."""
    if game.get("home_score") is None or game.get("away_score") is None:
        return
    margin = game["home_score"] - game["away_score"]
    result = lambda v: "win" if v > 0 else "loss" if v < 0 else "push"
    entry["final"] = [game["away_score"], game["home_score"]]
    if entry.get("spread_pick"):
        cover = margin + entry["spread"]
        entry["spread_result"] = result(cover if entry["spread_pick"] == "home" else -cover)
    if entry.get("total_pick"):
        over = game["home_score"] + game["away_score"] - entry["total"]
        entry["total_result"] = result(over if entry["total_pick"] == "over" else -over)


def compute_gmg_model(blob, previous):
    """{game_id: projection + picks (+ results once final)}. `previous` is
    the last build's copy (None if it couldn't be read): games that have
    kicked off keep that copy untouched; a started game with no earlier copy
    is left out rather than projected after the fact."""
    previous = previous or {}
    out = {gid: dict(entry) for gid, entry in previous.items()}
    grades = _Grades(blob)
    # Kickoff times are Eastern. UTC-4 is exact until November and an hour
    # early after, which only freezes a projection an hour sooner.
    now_et = (datetime.now(timezone.utc) - timedelta(hours=4)).replace(tzinfo=None)
    for game in blob.get("schedule") or []:
        gid = game.get("game_id")
        if not gid:
            continue
        if _started(game, now_et):
            if gid in out:
                out[gid]["frozen"] = True
                _grade(out[gid], game)
            continue
        if game.get("week") != blob.get("current_week"):
            continue  # only this week's games get a projection
        entry = _project(blob, grades, game)
        if entry:
            entry["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
            out[gid] = entry
    return out
