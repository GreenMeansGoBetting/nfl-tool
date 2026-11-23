"""The past days' files every NHL prop page shows (each market's plays, graded).

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import sys
from pathlib import Path

from shots_page import shots_play
from goals_page import goals_play
from points_page import points_play
from goalie_pages import saves_play
# ---- Past days (site/nhl/past_<market>.json) ----
# Each prop page's record, every graded player, filed by today's rules, so the
# day arrows and the date picker reach any day of the season, not just
# yesterday (the owner, 2026-11-03: "go back to or pick any date that has
# already happened to see how those performed").
PAST_COLS = ("game", "id", "name", "team", "line", "side", "price", "chance", "edge", "size", "actual")


def past_play(market: str, r: dict):
    """(side, line, play) for one saved record row, the way its page files it
    today, or None (no price)."""
    if market == "goals":
        play = goals_play(r.get("chance"), r.get("odds"), r.get("move"))
        return ("yes", 0.5, play) if play else None
    if r.get("line") is None or r.get("chance_over") is None:
        return None
    if market == "shots":
        play = shots_play(r["chance_over"], r["line"], r.get("over"), r.get("under"), r.get("avg"), r.get("move"))
    elif market == "points":
        play = points_play(r["chance_over"], r["line"], r.get("over"), r.get("under"), r.get("avg"), r.get("move"))
    else:
        play = saves_play(r["chance_over"], r["line"], r.get("over"), r.get("under"), r.get("avg"), r["mean"], r.get("mkt_mean"))
    return (play["side"], r["line"], play) if play else None


def past_file(market: str, folder: Path, cols: tuple) -> dict:
    """{"cols": PAST_COLS, "games": {game: [away, home]}, "days": {date: [row]}}:
    every priced row of one page's record, biggest edge first in a day. `cols`
    = the record's columns (older files without a `cols` header use them)."""
    games, days = {}, {}
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        names = saved.get("cols") or cols
        for gid, game in saved["games"].items():
            games[gid] = [game["away"], game["home"]]
            for raw in game["plays"]:
                r = dict(zip(names, raw))  # rows saved before a column was kept are just shorter
                found = past_play(market, r)
                if found is None or r.get("actual") is None:
                    continue
                side, line, play = found
                days.setdefault(game["date"], []).append([gid, r["id"], r["name"], r["team"], line, side, play["price"],
                                                          round(play["chance"], 3), round(play["edge"], 3), play["size"], r["actual"]])
    for rows in days.values():
        rows.sort(key=lambda row: -row[8])
    return {"cols": PAST_COLS, "games": games, "days": {d: days[d] for d in sorted(days)}}


def write_past_files(site: Path, dirs: dict) -> None:
    """past_<market>.json for every prop page; a damaged record costs only its own file."""
    for market, (folder, cols) in dirs.items():
        try:
            blob = past_file(market, folder, cols)
        except Exception as e:
            print(f"WARNING: the {market} past days couldn't be built ({e}).", file=sys.stderr)
            blob = {"cols": PAST_COLS, "games": {}, "days": {}, "error": str(e)[:200]}
        with open(site / f"past_{market}.json", "w") as f:
            json.dump(blob, f, separators=(",", ":"))
