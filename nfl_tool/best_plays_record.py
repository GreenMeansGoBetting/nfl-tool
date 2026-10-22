"""NFL Best Plays' graded record (the owner, 2026-10-22).

Best Plays is worked out in each visitor's browser (best-plays.js), so the
deploy opens the page on the fresh data and reads its play list
(tools/best_plays_capture.py: "capture what members see"). This file keeps
those plays and grades them:

- A play is kept per game, player, market and line side. Each capture before
  kickoff replaces the game's plays with the page's latest list (a play the
  page dropped is dropped here too): the record is the list as it stood at the
  last capture before kickoff. A game that has kicked off is never touched
  again (odds lock at kickoff; never an in-game line). The first price a play
  was seen at is kept beside the last one, for closing line value later.
- A capture with no plays for a game that had some keeps the old ones (the
  odds feed may have been down for that run).
- Finished games are graded from the build's own play-by-play numbers in
  data.json (player_game_logs, player_td_results, player_snaps). A player
  with no snap and no touch didn't play: a void, left out (not a loss). An
  exact push is a void too. Grading runs again on every build, so a late stat
  correction lands.
- The season `ledger` is one list per market of [date, edge, won, units, tags]
  rows, the format site/ytd.js reads (tags: market, side, rating).

Saved to model_history/nfl_best_plays/<season>.json (committed by the deploy
bot like the other records); the site reads best_plays_record.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

RECORD_DIR = Path(__file__).resolve().parent.parent / "model_history" / "nfl_best_plays"
# Kickoff is Eastern time; -04:00 like the page's bpStarted, so after the
# clocks change a game locks an hour early rather than an hour late.
KICKOFF_TZ = timezone(timedelta(hours=-4))
# What each prop market counts in a game log row (props-summary.js PROP_MARKETS).
PROP_STATS = {
    "passing_attempts": lambda g: g["pass_att"],
    "passing_completions": lambda g: g["completions"],
    "passing_yards": lambda g: g["pass_yards"],
    "passing_touchdowns": lambda g: g["pass_td"],
    "passing_interceptions": lambda g: g["interceptions"],
    "passing_longestCompletion": lambda g: g["longest_pass"],
    "passing+rushing_yards": lambda g: g["pass_yards"] + g["rush_yards"],
    "rushing_attempts": lambda g: g["carries"],
    "rushing_yards": lambda g: g["rush_yards"],
    "rushing_longestRush": lambda g: g["longest_rush"],
    "rushing+receiving_yards": lambda g: g["rush_yards"] + g["rec_yards"],
    "receiving_receptions": lambda g: g["receptions"],
    "receiving_yards": lambda g: g["rec_yards"],
    "receiving_longestReception": lambda g: g["longest_rec"],
}
GROUPS = ("rec", "rush", "pass", "any", "first")
# What a capture row carries (best-plays.js bpCapture), and what the record keeps.
FIELDS = ("game", "game_id", "week", "date", "team", "opp", "name", "position", "group", "market", "bet",
          "side", "line", "price", "book", "edge", "chance", "rating")


def norm_name(name: str) -> str:
    """The site's boNorm: lower case, no suffix, letters only."""
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", (name or "").lower())
    return re.sub(r"[^a-z]", "", name)


def play_key(p: dict) -> str:
    return f"{p['game']}|{p['market']}|{p['team']}|{norm_name(p['name'])}"


def kickoff(game: dict) -> datetime | None:
    try:
        return datetime.strptime(f"{game['date']} {game.get('time') or '13:00'}", "%Y-%m-%d %H:%M").replace(tzinfo=KICKOFF_TZ)
    except (KeyError, TypeError, ValueError):
        return None


def started(game: dict | None, now: datetime) -> bool:
    """Kicked off (or no schedule entry to tell): never change its plays."""
    if not game:
        return True
    if game.get("status") and game["status"] != "scheduled":
        return True
    ko = kickoff(game)
    return ko is None or now >= ko


def games_by_key(data: dict) -> dict:
    return {f"{g['away']}_{g['home']}_{g['week']}": g for g in data.get("schedule") or []}


def merge_capture(record: dict, capture: dict, data: dict, now: datetime) -> dict:
    """Put a capture's plays for games not yet started into the record."""
    plays = record.setdefault("plays", {})
    games = games_by_key(data)
    stamp = now.strftime("%Y-%m-%dT%H:%MZ") if now.tzinfo is None else now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    fresh: dict = {}
    for row in capture.get("plays") or []:
        p = {k: row.get(k) for k in FIELDS}
        if p["price"] is None or p["edge"] is None or p["group"] not in GROUPS:
            continue
        fresh.setdefault(f"{p['game']}_{p['week']}", {})[play_key(p)] = p
    for gkey in capture.get("games") or []:
        if started(games.get(gkey), now):
            continue
        new = fresh.get(gkey, {})
        old = {k: v for k, v in plays.items() if f"{v['game']}_{v['week']}" == gkey}
        if not new:
            continue  # nothing came back for this game: keep what it had
        for k in old:
            if k not in new:
                del plays[k]
        for k, p in new.items():
            before = old.get(k) or {}
            first = {"first_price": before.get("first_price", p["price"]),
                     "first_book": before.get("first_book", p["book"]),
                     "first_seen": before.get("first_seen", stamp)}
            plays[k] = {**p, **first, "last_seen": stamp}
    return record


def _logs(data: dict) -> dict:
    """team -> normalized name -> week -> game log row."""
    out: dict = {}
    for team, players in (data.get("player_game_logs") or {}).items():
        for name, rows in players.items():
            out.setdefault(team, {})[norm_name(name)] = {int(r["week"]): r for r in rows}
    return out


def _snapped(data: dict, team: str, name: str, week: int) -> bool:
    for full, info in ((data.get("player_snaps") or {}).get(team) or {}).items():
        if norm_name(full) == name and ((info or {}).get("w") or {}).get(str(week)):
            return True
    return False


def grade_play(p: dict, data: dict, logs: dict | None = None) -> int | None:
    """1 won, 0 lost, None = not graded (not final yet, a void or a push)."""
    logs = _logs(data) if logs is None else logs
    game = games_by_key(data).get(f"{p['game']}_{p['week']}")
    if not game or game.get("status") != "final":
        return None
    week, team, who = int(p["week"]), p["team"], norm_name(p["name"])
    team_logs = logs.get(team) or {}
    # The play-by-play is in once the team has any game log row that week.
    if not any(week in by_week for by_week in team_logs.values()):
        return None
    row = (team_logs.get(who) or {}).get(week)
    played = row is not None or _snapped(data, team, who, week)
    if not played:
        return None
    if p["group"] in ("any", "first"):
        scored = ((data.get("player_td_results") or {}).get(str(week)) or {}).get(team) or {}
        names = {norm_name(n) for n in scored.get("any_td" if p["group"] == "any" else "first_td") or []}
        return 1 if who in names else 0
    stat = PROP_STATS.get(p["market"])
    if stat is None or p["line"] is None:
        return None
    value = stat(row) if row is not None else 0
    if value == p["line"]:
        return None
    return 1 if (value > p["line"]) == (p["side"] == "over") else 0


def payout(price: float) -> float:
    return price / 100 if price > 0 else 100 / -price


def grade(record: dict, data: dict) -> dict:
    logs = _logs(data)
    for p in (record.get("plays") or {}).values():
        result = grade_play(p, data, logs)
        if result is None:
            p.pop("won", None)
        else:
            p["won"] = result
    return record


def ledger(record: dict) -> dict:
    """market -> [date, edge, won, units, tags] rows, oldest first."""
    out = {g: [] for g in GROUPS}
    for p in sorted((record.get("plays") or {}).values(), key=lambda p: (p["date"], p["name"])):
        if p.get("won") is None:
            continue
        units = round(payout(p["price"]) if p["won"] else -1.0, 3)
        out[p["group"]].append([p["date"], round(p["edge"], 4), p["won"], units, [p["group"], p["side"], (p["rating"] or "").lower()]])
    return out


def site_file(record: dict) -> dict:
    """What best-plays.js reads: the ledger and every graded play for the list."""
    graded = [{k: p.get(k) for k in ("date", "week", "game", "team", "opp", "name", "position", "group", "market", "bet",
                                    "side", "line", "price", "book", "first_price", "edge", "chance", "rating", "won")}
              for p in (record.get("plays") or {}).values() if p.get("won") is not None]
    graded.sort(key=lambda p: (p["date"], -p["edge"]), reverse=True)
    return {"season": record.get("season"), "ledger": ledger(record), "plays": graded}


def load(season: int, folder: Path = RECORD_DIR) -> dict:
    path = folder / f"{season}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"season": season, "plays": {}}


def save(record: dict, season: int, folder: Path = RECORD_DIR) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    record = {"season": season, "plays": dict(sorted((record.get("plays") or {}).items()))}
    (folder / f"{season}.json").write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
