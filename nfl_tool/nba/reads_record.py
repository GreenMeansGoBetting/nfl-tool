"""The Prop Research Reads, frozen at tip (the owner, 2026-11-05).

The O / U counts on the Prop Research lists come from the research panel, and most panel tabs are
built from season totals with no game-by-game breakdown, so a past night can't be rebuilt from
today's data without that night's own game (and every game after it) leaking in. The owner: "lock
the info that comprises those boxes before that game is played ... then i get up on tuesday and go
back i just see the info that was relevant to prior to last nights game".

So every NBA build that can open a browser (deploy.yml, nba-refresh.yml) reads the All Props page's
own numbers for every game that hasn't tipped (tools/nba_reads_capture.py, research.js
`rsCapture()`) and keeps them here, rewritten until tip and never after:

model_history/nba_reads/<season>.json
    {game id: {"date": "YYYY-MM-DD",
               "tabs": {market: [the tabs with Reads, in order]},
               "m": {market: {player id: [o, u, n, volume, [o, u, n, no data] a tab...]}}}}

The build copies the file into props.json `research.frozen` (build_nba.compute_props), and a past
night on the page shows those counts beside the Result.
"""
import json
from datetime import datetime
from pathlib import Path

RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_reads"


def path_for(season: int, folder: Path | None = None) -> Path:
    return (folder or RECORD_DIR) / f"{season}.json"


def load(season: int, folder: Path | None = None) -> dict:
    path = path_for(season, folder)
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except ValueError:
        return {}


def save(record: dict, season: int, folder: Path | None = None) -> None:
    """One game a line (small diffs in the model_history commits)."""
    path = path_for(season, folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{json.dumps(gid)}:{json.dumps(record[gid], separators=(',', ':'), sort_keys=True)}" for gid in sorted(record)]
    path.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


def started(g: dict, now_utc: datetime) -> bool:
    """Tipped (or final) by now: its Reads are frozen. No start time = treated as started (never rewritten)."""
    if g.get("status") == "final":
        return True
    try:
        return datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
    except (KeyError, TypeError, ValueError):
        return True


def merge(record: dict, captured: dict, games: list, now_utc: datetime) -> int:
    """Writes the captured games that haven't tipped into `record`; a game that has tipped keeps the
    Reads it had before tip. Returns how many games changed."""
    by_id = {str(g.get("game_id")): g for g in games or []}
    changed = 0
    for gid, entry in (captured or {}).items():
        g = by_id.get(str(gid))
        if g is None or started(g, now_utc) or not (entry or {}).get("m"):
            continue
        if record.get(str(gid)) != entry:
            record[str(gid)] = entry
            changed += 1
    return changed
