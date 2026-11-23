"""The NHL promo pages' data: Icebreaker (first goal) and Hat Trick.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import math
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

from nhl_stats import num
from goals_page import goal_row





# ---- Icebreaker (the Promo Tools page) ----
# DraftKings' promo: everyone with a qualifying first goal scorer bet on the
# player who scores the QUICKEST goal of the 7:00 PM ET slate (game clock, not
# wall clock) splits $250K. A replay of 2024-25 and 2025-26
# (tools/backtest/nhl_icebreaker.py) found that who scores early is who scores:
# a player's scoring rate x his ice time beat every "fast start" number, his
# early shots and the first shift. Under a steady scoring rate, a player's
# chance to score the slate's first goal is his expected goals tonight over
# everyone's, so `rate` is the Goals model's mean, moved toward his anytime
# price the way King of the Crease leans on the saves line. The page divides
# by the games the member picks. The fast-start numbers are shown, never used.
ICEBREAKER_RULES = {"blend": 0.5, "full_games": 20, "slot": "19:00"}
ICEBREAKER_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_icebreaker"


ICEBREAKER_RECORD_COLS = ("id", "name", "team", "rate", "mean", "mkt_mean", "fg")


def fast_starts(records: list) -> dict:
    """{team: {"gp", "first" (games it scored the game's first goal),
    "first_time" (the middle game's time of its own first goal, in seconds;
    None when it went scoreless in more than half), "sog5" / "sog5_against"
    (shots on goal a game in the first five minutes, and allowed)}}.
    This season's games; shown on the page, never in the chances."""
    teams = {}
    for r in records:
        first = r.get("first_goal")
        for team, opp in ((r["home"], r["away"]), (r["away"], r["home"])):
            row = teams.setdefault(team, {"gp": 0, "first": 0, "times": [], "sog5": 0, "sog5_against": 0})
            row["gp"] += 1
            row["first"] += bool(first) and first["team"] == team
            row["times"].append((r.get("first_goals") or {}).get(team))
            row["sog5"] += (r["teams"].get(team) or {}).get("sog_early", 0)
            row["sog5_against"] += (r["teams"].get(opp) or {}).get("sog_early", 0)
    out = {}
    for team, row in teams.items():
        times = sorted(row["times"], key=lambda t: float("inf") if t is None else t)
        out[team] = {
            "gp": row["gp"], "first": row["first"], "first_time": times[(len(times) - 1) // 2],
            "sog5": num(row["sog5"] / row["gp"]), "sog5_against": num(row["sog5_against"] / row["gp"]),
        }
    return out


def first_ten(records: list, ids: set) -> dict:
    """{player id: [games, goals, shots on goal, games with a shift chart,
    seconds on the ice]} in the first ten minutes of this season's games,
    for the players on the board (`ids`). Shown, never in the chances."""
    out = {}
    for r in records:
        for pid, s in r["skaters"].items():
            if pid not in ids:
                continue
            row = out.setdefault(pid, [0, 0, 0, 0, 0])
            row[0] += 1
            row[1] += s.get("g10", 0)
            row[2] += s.get("sog10", 0)
            if s.get("toi10") is not None:
                row[3] += 1
                row[4] += s["toi10"]
    return out


def first_goal_prices(book_odds: dict, game: dict, pid: str) -> dict:
    """His DraftKings first goal scorer price from SmartStake (the promo's
    book and bet). Only DraftKings: the owner, 2026-10-15, "other books don't
    matter, its only dk or bust"."""
    entry = ((((book_odds or {}).get(f"{game['away']}_{game['home']}") or {}).get("props") or {}).get("first_goal") or {}).get(pid)
    return {"fg": next((q[3] for q in (entry or {}).get("q") or [] if q[0] == "draftkings" and q[1] == "o"), None)}


def icebreaker_row(goal_row: dict, game: dict, odds: dict | None, book_odds: dict, games_played: int) -> dict:
    """One skater's row: the Goals model's expected goals (`mean`), the
    market's (`mkt_mean`, from Novig's anytime price), and `rate` = the
    market moved toward the model by as much as the season has earned
    (ICEBREAKER_RULES, as King of the Crease); the model alone without a price."""
    chance = ((odds or {}).get("goal") or {}).get("chance")
    mkt = round(-math.log(1 - chance), 4) if chance and 0 < chance < 1 else None
    weight = ICEBREAKER_RULES["blend"] * min(1.0, games_played / ICEBREAKER_RULES["full_games"])
    rate = goal_row["mean"] if mkt is None else mkt + weight * (goal_row["mean"] - mkt)
    keep = ("id", "name", "team", "opp", "home", "pos", "slot", "usual_slot", "move", "games", "goals", "xg", "minutes")
    return {
        **{k: goal_row.get(k) for k in keep}, "game_id": game["game_id"],
        "mean": goal_row["mean"], "mkt_mean": mkt, "rate": round(rate, 4),
        **first_goal_prices(book_odds, game, goal_row["id"]),
    }


def icebreaker_board(goals_games: dict, games: list, records: list, player_odds: dict, book_odds: dict, previous: dict | None, now_utc: datetime) -> dict:
    """{date: {"games": [...], "players": [rows]}} for the Goals page's days.
    Same lock as everything else: a started game keeps the last build's rows
    (none saved = no rows, never ones made after puck drop). A finished
    game's entry gets `first`: its first goal's time and scorer."""
    kept = {}
    for day in ((previous or {}).get("days") or {}).values():
        for row in day.get("players") or []:
            kept.setdefault(row["game_id"], []).append(row)
    finished = {str(r["id"]): r for r in records}
    team_games = Counter()
    for r in records:
        team_games[r["home"]] += 1
        team_games[r["away"]] += 1
    days = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        entry = goals_games.get(g["game_id"])
        if started:
            rows = kept.get(g["game_id"]) or []
        elif entry:
            played = min(team_games[g["away"]], team_games[g["home"]])
            odds = player_odds.get(g["game_id"]) or {}
            rows = [icebreaker_row(row, g, odds.get(row["id"]), book_odds, played) for row in entry["players"] if not row.get("out")]
        else:
            continue
        if not rows and not started:
            continue
        record = finished.get(g["game_id"])
        info = {
            "game_id": g["game_id"], "away": g["away"], "home": g["home"], "time": g["time"], "start_utc": g["start_utc"],
            "locked": started, "final": bool(record), "first": record.get("first_goal") if record else None,
        }
        day = days.setdefault(g["date"], {"games": [], "players": []})
        day["games"].append(info)
        day["players"] += rows
    for day in days.values():
        day["players"].sort(key=lambda row: -row["rate"])
    return days


def icebreaker_slate(day: dict) -> dict | None:
    """The promo's own slate for a finished day: the 7:00 PM ET games
    (ICEBREAKER_RULES "slot"), each player's chance among them, and who broke
    the ice (ties: everyone on the quickest time). None until every one of
    those games is final."""
    games = [g for g in day["games"] if g["time"] == ICEBREAKER_RULES["slot"]]
    if not games or not all(g["final"] for g in games):
        return None
    ids = {g["game_id"] for g in games}
    rows = [row for row in day["players"] if row["game_id"] in ids]
    total = sum(row["rate"] for row in rows)
    firsts = [g["first"] for g in games if g.get("first")]
    if not rows or not total or not firsts:
        return None
    quickest = min(f["t"] for f in firsts)
    return {"games": len(games), "time": quickest, "winners": [f for f in firsts if f["t"] == quickest], "rows": rows, "total": total}


def record_icebreaker_days(folder: Path, board: dict) -> int:
    """Adds each finished 7:00 slate to the record once: every player's
    locked rate and price, and who broke the ice. Returns how many were added."""
    added = 0
    for date, day in sorted(board.items()):
        slate = icebreaker_slate(day)
        if not slate:
            continue
        path = folder / f"{date[:7]}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": list(ICEBREAKER_RECORD_COLS), "days": {}}
        if date in saved["days"]:
            continue
        saved["days"][date] = {
            "games": slate["games"], "time": slate["time"], "winners": slate["winners"],
            "players": [[row.get(col) for col in saved["cols"]] for row in slate["rows"]],
        }
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
        added += 1
    return added


def icebreaker_history(folder: Path) -> list:
    """Every recorded slate for the page's Winners list, newest first: who
    broke the ice and when, his place before puck drop by chance (`rank` of
    `players`), that chance, his DraftKings first goal price, and our top
    pick. A winner the page didn't list (a late call-up) has no rank."""
    out = []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in saved["days"].items():
            rows = sorted((dict(zip(saved["cols"], values)) for values in day["players"]), key=lambda row: -row["rate"])
            if not rows:
                continue
            total = sum(row["rate"] for row in rows) or 1
            order = [row["id"] for row in rows]
            winners = []
            for w in day["winners"]:
                row = rows[order.index(w["id"])] if w.get("id") in order else None
                winners.append({**w, "rank": order.index(w["id"]) + 1 if row else None, "chance": round(row["rate"] / total, 4) if row else None, "fg": row["fg"] if row else None})
            top = rows[0]
            out.append({
                "date": date, "games": day["games"], "time": day["time"], "players": len(rows), "winners": winners,
                "top": {"id": top["id"], "name": top["name"], "team": top["team"], "chance": round(top["rate"] / total, 4)},
            })
    return sorted(out, key=lambda d: d["date"], reverse=True)


def icebreaker_file(season: int, generated_at: str, records: list, goals_games: dict, games: list, player_odds: dict, book_odds: dict,
                    previous: dict | None, now_utc: datetime, record_dir: Path) -> dict:
    """site/nhl/icebreaker.json: the board, every team's fast starts, the
    board's players' first ten minutes and the Winners history."""
    board = icebreaker_board(goals_games, games, records, player_odds, book_odds, previous, now_utc)
    try:
        record_icebreaker_days(record_dir, board)
        history = icebreaker_history(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Icebreaker record couldn't be updated ({e}).", file=sys.stderr)
        history = None
    ids = {row["id"] for day in board.values() for row in day["players"]}
    return {"season": season, "generated_at": generated_at, "rules": ICEBREAKER_RULES, "days": board, "fast": fast_starts(records),
            "first10": first_ten(records, ids), "history": history}


# ---- King of the Hat Trick (Promo Tools) ----
# DraftKings' promo: an anytime goal scorer bet on a player who scores a hat
# trick (3+ goals in one game) splits a pool. No prices on this page (the
# owner, 2026-10-31: "this isnt about finding fair value"): it is this
# season's scoring, usage and matchup data, the 2- and 3-goal games each
# player has had and each defense and goalie has given up to one player.
# Every goal counts here, empty-net ones too (they count for the promo).
HATTRICK_RECENT = 10  # "last 10 games" goals


def big_games(records: list) -> list:
    """Every game a skater scored 2+ goals this season, oldest first:
    `date`, `game`, `id`, `name`, `team`, `opp`, `g`, `pp` (power-play goals)
    and `vs` ({goalie id: goals scored on him}, empty nets left out)."""
    out = []
    for r in records:
        pp = Counter(e["scorer"] for e in r.get("goal_events") or [] if e.get("pp"))
        on = {}
        for s in r.get("shots") or []:
            if s.get("goal") and s.get("goalie") not in (None, "None"):
                on.setdefault(s["shooter"], Counter())[s["goalie"]] += 1
        for pid, s in r["skaters"].items():
            if s.get("g", 0) >= 2:
                opp = r["away"] if s["team"] == r["home"] else r["home"]
                out.append({"date": r["date"], "game": str(r["id"]), "id": pid, "name": s["name"], "team": s["team"], "opp": opp,
                            "g": s["g"], "pp": pp.get(pid, 0), "vs": dict(on.get(pid) or {})})
    return out


def hattrick_players(records: list, ids: set) -> dict:
    """{player id: this season's real counts} for the board's players: `gp`,
    `g`, `two` / `three` (games with 2+ / 3+ goals), `max`, `pp_g`, `l10` /
    `l10_gp` (goals in his last HATTRICK_RECENT games), `sog`, `att`, `hd`
    (shots from the low slot), `toi` (seconds), `pp_toi` / `pp_gp` (power-play
    seconds over the games the league reported them for)."""
    logs = {}
    for r in records:
        pp = Counter(e["scorer"] for e in r.get("goal_events") or [] if e.get("pp"))
        for pid, s in r["skaters"].items():
            if pid in ids:
                logs.setdefault(pid, []).append((s, pp.get(pid, 0)))
    out = {}
    for pid, rows in logs.items():
        goals = [s.get("g", 0) for s, _ in rows]
        recent = goals[-HATTRICK_RECENT:]
        pp_rows = [s["pp_toi"] for s, _ in rows if s.get("pp_toi") is not None]
        out[pid] = {
            "gp": len(rows), "g": sum(goals), "two": sum(g >= 2 for g in goals), "three": sum(g >= 3 for g in goals), "max": max(goals),
            "pp_g": sum(p for _, p in rows), "l10": sum(recent), "l10_gp": len(recent),
            "sog": sum(s.get("sog", 0) for s, _ in rows), "att": sum(s.get("att", 0) for s, _ in rows), "hd": sum(s.get("hd", 0) for s, _ in rows),
            "toi": sum(s.get("toi", 0) for s, _ in rows), "pp_toi": sum(pp_rows), "pp_gp": len(pp_rows),
        }
    return out


def hattrick_teams(records: list, big: list) -> dict:
    """{team: `gp`, `gf` / `ga`, `five_for` / `five_against` (games it scored
    / allowed 5+), `two_for` / `three_for` (its players' 2+ / 3+ goal games)
    and `two_against` / `three_against` (given up to one player)}."""
    out = {}
    for r in records:
        for team, opp in ((r["home"], r["away"]), (r["away"], r["home"])):
            t = out.setdefault(team, Counter())
            gf, ga = r["teams"].get(team, {}).get("g", 0), r["teams"].get(opp, {}).get("g", 0)
            t["gp"] += 1
            t["gf"] += gf
            t["ga"] += ga
            t["five_for"] += gf >= 5
            t["five_against"] += ga >= 5
    for b in big:
        out.setdefault(b["team"], Counter())["two_for"] += 1
        out[b["team"]]["three_for"] += b["g"] >= 3
        out.setdefault(b["opp"], Counter())["two_against"] += 1
        out[b["opp"]]["three_against"] += b["g"] >= 3
    keys = ("gp", "gf", "ga", "five_for", "five_against", "two_for", "three_for", "two_against", "three_against")
    return {team: {k: t.get(k, 0) for k in keys} for team, t in out.items()}


def hattrick_goalies(records: list, big: list) -> dict:
    """{goalie id: `name`, `team`, `starts`, `sa`, `ga`, and `two` / `three`:
    games a shooter scored 2+ / 3+ goals ON HIM (empty nets not his)}."""
    out = {}
    for r in records:
        for gid, s in r["goalies"].items():
            row = out.setdefault(gid, {"name": s["name"], "team": s["team"], "starts": 0, "sa": 0, "ga": 0, "two": 0, "three": 0})
            row.update(name=s["name"], team=s["team"])
            row["starts"] += bool(s.get("start"))
            row["sa"] += s.get("sa", 0)
            row["ga"] += s.get("ga", 0)
    for b in big:
        for gid, n in b["vs"].items():
            if gid in out and n >= 2:
                out[gid]["two"] += 1
                out[gid]["three"] += n >= 3
    return out


def hattrick_days(goals_games: dict, games: list) -> dict:
    """{date: {"games": [...], "players": [rows]}} from the Goals page's
    board (so the same players, lineups and lock): each skater's line
    tonight, the goalie he should face and the Goals model's own expected
    goals (`mean`, usage x matchup; no price in it). Outs left off."""
    days = {}
    for g in games:
        entry = goals_games.get(g["game_id"])
        if not entry:
            continue
        keep = ("id", "name", "team", "opp", "home", "pos", "slot", "usual_slot", "move", "goalie", "mean", "minutes", "ev_min", "pp_min", "actual")
        rows = [{k: row.get(k) for k in keep} for row in entry.get("players") or [] if not row.get("out")]
        if not rows:
            continue
        day = days.setdefault(g["date"], {"games": [], "players": []})
        day["games"].append({
            "game_id": g["game_id"], "away": g["away"], "home": g["home"], "time": g["time"], "start_utc": g["start_utc"],
            "locked": bool(entry.get("locked")), "final": bool(entry.get("final")), "total": g.get("total_line"),
        })
        day["players"] += [{**row, "game_id": g["game_id"]} for row in rows]
    for day in days.values():
        day["players"].sort(key=lambda row: -(row["mean"] or 0))
    return days


def hattrick_file(season: int, generated_at: str, records: list, goals_games: dict, games: list) -> dict:
    """site/nhl/hattrick.json: the board, every 2+ goal game this season,
    the board's players' counts, every team's and goalie's, and the league's
    hat trick rate (`league`: team games, hat tricks, days with games and
    days with a hat trick, the share of the promo's days that rolled over)."""
    big = big_games(records)
    days = hattrick_days(goals_games, games)
    ids = {row["id"] for day in days.values() for row in day["players"]}
    dates = Counter(r["date"] for r in records)
    hat_days = {b["date"] for b in big if b["g"] >= 3}
    return {
        "season": season, "generated_at": generated_at, "days": days, "big": big,
        "players": hattrick_players(records, ids), "teams": hattrick_teams(records, big), "goalies": hattrick_goalies(records, big),
        "league": {"games": len(records), "days": len(dates), "hat_days": len(hat_days), "hat_tricks": sum(b["g"] >= 3 for b in big),
                   "two_plus": len(big), "skater_games": sum(len(r["skaters"]) for r in records)},
    }
