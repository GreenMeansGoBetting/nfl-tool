"""NBA positions: PG / SG / SF / PF / C for every player.

The owner, 2026-10-21: "Guards are drastically different roles and its
unacceptable to not have PG vs SG established." ESPN's box scores and roster
files only say G / F / C, but ESPN's depth charts (one a team, the same
player ids) list every rostered player under PG / SG / SF / PF / C, often
under more than one. A player's position is the slot where he ranks highest
(a tie goes to the first of PG, SG, SF, PF, C): Payton Pritchard is 2nd at PG
and 3rd at SG, so a PG.

`positions.json` (next to this file) keeps every player ever placed, so a
player who leaves the league keeps his last position for last season's
numbers; each build adds today's depth charts on top. A player on no depth
chart, ever, is placed from his own box scores (`guess`): G -> PG on
assists a 36, F -> PF on rebounds a 36, C stays C. Every NBA build reads its
box scores and rosters through `relabel`, so all tools see the five
positions. ESPN's own G / F / C stays beside it in `espn_group` (King of
the Court's projection still reads those, until the owner says otherwise).

    py nfl_tool/nba/positions.py --write   # save today's depth charts into positions.json
"""
import argparse
import json
import urllib.request
from pathlib import Path

import pandas as pd

POSITIONS = ("PG", "SG", "SF", "PF", "C")
SAVED = Path(__file__).parent / "positions.json"
DEPTH_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team}/depthcharts"
ESPN_TEAM_IDS = range(1, 31)  # ESPN's NBA team ids are 1-30
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nba/1.0)"
# `guess` cut points, from 2025-26 players (200+ minutes) with a depth-chart
# position, 2026-10-21: a G with 4.5+ assists a 36 is a PG (right for 82% of
# guards), an F with 6.5+ rebounds a 36 is a PF (65% of forwards; the best
# cut). Players on no depth chart played 7.6% of 2025-26's minutes.
PG_ASSISTS_36 = 4.5
PF_REBOUNDS_36 = 6.5


def primary(slots: dict) -> dict:
    """{position: [athlete ids in depth order]} -> {id: position} for one team."""
    best = {}
    for pos in POSITIONS:
        for rank, pid in enumerate(slots.get(pos, [])):
            if pid not in best or rank < best[pid][0]:
                best[pid] = (rank, pos)
    return {pid: pos for pid, (rank, pos) in best.items()}


def fetch_depth(team_ids=ESPN_TEAM_IDS) -> dict:
    """{athlete id: position} from today's ESPN depth charts. Teams that fail
    are skipped (their players keep their saved positions)."""
    out = {}
    for team in team_ids:
        try:
            req = urllib.request.Request(DEPTH_URL.format(team=team), headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                chart = json.load(resp)["depthchart"][0]["positions"]
        except Exception as e:  # noqa: BLE001 -- one team's chart never stops the build
            print(f"  depth chart {team}: {e}")
            continue
        slots = {k.upper(): [str(a["id"]) for a in v.get("athletes", [])] for k, v in chart.items()}
        out.update(primary(slots))
    return out


def load(live: bool = True) -> dict:
    """{athlete id: position}: the saved table with today's depth charts on top."""
    table = json.loads(SAVED.read_text(encoding="utf-8")) if SAVED.exists() else {}
    if live:
        table.update(fetch_depth())
    return table


def guess(box: pd.DataFrame) -> dict:
    """{athlete id: position} for every player in a box score file, from his
    ESPN group and his assists / rebounds a 36."""
    played = box[pd.to_numeric(box["minutes"], errors="coerce") > 0]
    g = played.groupby(played["athlete_id"].astype(int).astype(str)).agg(
        group=("athlete_position_abbreviation", "last"), min=("minutes", "sum"),
        ast=("assists", "sum"), reb=("rebounds", "sum"))
    out = {}
    for pid, r in g.iterrows():
        per36 = 36 / r["min"] if r["min"] else 0
        group = r["group"] if r["group"] in POSITIONS else str(r["group"] or "F")[:1]
        if group in POSITIONS:
            out[pid] = group
        elif group == "G":
            out[pid] = "PG" if r["ast"] * per36 >= PG_ASSISTS_36 else "SG"
        else:
            out[pid] = "PF" if r["reb"] * per36 >= PF_REBOUNDS_36 else "SF"
    return out


def relabel(frame: pd.DataFrame, table: dict, id_col: str = "athlete_id", pos_col: str = "athlete_position_abbreviation") -> pd.DataFrame:
    """The frame with its position column set to the five positions: the
    table's, else a box-score guess (box files), else G -> SG / F -> SF.
    ESPN's G / F / C is kept in `espn_group`."""
    if frame is None or frame.empty or pos_col not in frame.columns:
        return frame
    ids = frame[id_col].astype("Int64").astype(str)
    guessed = guess(frame) if {"minutes", "assists", "rebounds"} <= set(frame.columns) else {}
    fallback = {"G": "SG", "F": "SF", "C": "C"}
    frame = frame.copy()
    group = {"PG": "G", "SG": "G", "SF": "F", "PF": "F"}
    frame["espn_group"] = [group.get(old, str(old or "F")[:1]) for old in frame[pos_col]]
    frame[pos_col] = [table.get(pid) or guessed.get(pid) or fallback.get(str(old or "F")[:1], old if old in POSITIONS else "SF")
                      for pid, old in zip(ids, frame[pos_col])]
    return frame


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="Save today's depth charts into positions.json")
    args = parser.parse_args()
    table = load()
    counts = pd.Series(table).value_counts().to_dict()
    print(f"{len(table)} players: {counts}")
    if args.write:
        SAVED.write_text(json.dumps(dict(sorted(table.items())), separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"saved {SAVED}")


if __name__ == "__main__":
    main()
