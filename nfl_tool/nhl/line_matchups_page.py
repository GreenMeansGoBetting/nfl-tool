"""The Line Matchups page's data for the NHL build (lines.json). The model
itself is lines_model.py.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
from datetime import datetime, timedelta

import lines_model
from shots_page import SHOTS_DAYS_AHEAD
# Line Matchups (lines_model.py; the page decides the tags from these):
# Strong / Weak needs `min_toi` seconds together at 5-on-5 and a shot share
# at or past `strong` / `weak`; Hot / Cold needs `form_toi` seconds over the
# last 3 games together and a shot share `form_gap` from its season, or a
# goal difference of `form_goals` over those games.
LINES_RULES = {"min_toi": 1200, "strong": 0.56, "weak": 0.44, "form_toi": 600, "form_gap": 0.05, "form_goals": 2}
LINES_MEETING_ROWS = 6


# ---- Line Matchups (lines_model.py) ----
def lines_history_for(records: list) -> "lines_model.LinesHistory":
    """Every line and pair's 5-on-5 numbers, this season's games only."""
    history = lines_model.LinesHistory()
    for record in records:
        history.add_game(record)
    return history


def lines_team(history, team: str, slots: dict | None) -> dict:
    """One team's lines and pairs for a game: tonight's projected lineup when
    it is posted (`slots`: {player id: "F1".."D3"}, in the story's order), else
    its usual lines lately. Each unit carries its numbers together this season."""
    if slots:
        groups = {}
        for pid, slot in slots.items():
            if slot:
                groups.setdefault(slot, []).append(pid)
        units = {kind: [(slot, ids) for slot, ids in sorted(groups.items(), key=lambda kv: int(kv[0][1:])) if slot[0] == kind] for kind in ("F", "D")}
        source = "posted"
    else:
        usual = history.usual(team)
        units = {kind: [(f"{kind}{i + 1}", ids) for i, ids in enumerate(usual[kind])] for kind in ("F", "D")}
        source = "usual"

    def unit(kind, slot, ids):
        full = len(ids) == (3 if kind == "F" else 2)
        numbers = history.unit(team, kind, ids) if full else {"gp": 0, "toi": 0, "cf": 0, "ca": 0, "gf": 0, "ga": 0, "l3": None}
        return {"slot": slot, "ids": ids, **numbers}

    return {"source": source, "games": len(history.team_games(team)), "team": history.team_total(team),
            "lines": [unit("F", slot, ids) for slot, ids in units["F"]], "pairs": [unit("D", slot, ids) for slot, ids in units["D"]]}


def lines_game(history, g: dict, posted: dict, skaters: dict) -> dict:
    """One game's Line Matchups: both teams' units, the home coach's habit
    against the other team's lines (he has the last change), and earlier
    meetings' trio-against-trio minutes."""
    away, home = g["away"], g["home"]
    teams = {team: lines_team(history, team, (posted.get(team) or {}).get("skaters")) for team in (away, home)}
    deploy = history.deploy(home, True)
    met = history.meetings(home, away)
    meetings = sorted(([h.split("-"), a.split("-"), s] for (h, a), s in met["vs"].items() if s >= lines_model.SEEN_SECONDS), key=lambda m: -m[2])[:LINES_MEETING_ROWS]
    ids = {pid for t in teams.values() for u in t["lines"] + t["pairs"] for pid in u["ids"]} | {pid for h, a, _ in meetings for pid in h + a}
    players = {pid: [skaters[pid].get("name"), skaters[pid].get("pos"), skaters[pid].get("headshot")] for pid in ids if pid in skaters}
    return {"locked": False, "posted": posted.get("posted"), "teams": teams, "players": players,
            "matchups": {"games": deploy["games"], "rows": lines_model.likely_matchups(deploy)},
            "meetings": {"games": met["games"], "rows": meetings}}


def lines_file(season: int, generated_at: str, records: list, games: list, tonight: dict, skaters: dict, previous: dict | None, now_utc: datetime) -> dict:
    """site/nhl/lines.json: Line Matchups for the games through SHOTS_DAYS_AHEAD
    days out. A started game keeps the last build's entry (what the page said
    before puck drop); none saved = left off. No picks, no prices, no record."""
    history = lines_history_for(records)
    prev_games = (previous or {}).get("games") or {}
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    out = {}
    for g in games:
        if g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            if g["game_id"] in prev_games:
                out[g["game_id"]] = {**prev_games[g["game_id"]], "locked": True}
            continue
        if g["date"] <= last_day:
            out[g["game_id"]] = lines_game(history, g, (tonight or {}).get(g["game_id"]) or {}, skaters)
    return {"season": season, "generated_at": generated_at, "rules": LINES_RULES, "games": out}
