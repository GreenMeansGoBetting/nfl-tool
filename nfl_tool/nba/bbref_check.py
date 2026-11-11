"""Weekly cross-check of our NBA shot data against Basketball-Reference.

The owner, 2026-11-11: use Basketball-Reference "in conjunction with ESPN to make
sure we are accurate". It can't be a source: it has no shot types (pull-up,
catch-and-shoot, fade, floater, post, drive, cut), which only ESPN's play-by-play
names. It can be an alarm. Its season shooting page comes from the NBA's own
tracking, a different feed from ESPN's, so where the two cover the same thing
(how far out a player shoots, how many of his shots are threes, how many are
dunks) they should agree. On 2026-11-11 they did: three-point share 0.999,
average distance 0.975 (0.7 ft apart on average) over 223 players.

This reads ONE page a week (.github/workflows/nba-bbref-check.yml), with a plain
script, never shown on the site. Sports Reference's terms welcome reuse with
credit but bar a competing database, more than 20 requests a minute, and feeding
their content to AI; a check that only compares and warns does none of those.
If any of it is ever shown to members, credit Sports Reference.

Heaves are left out on our side, as Basketball-Reference does.
A player is compared only when both sources have him in the same number of games
(a night one has and the other doesn't is timing, not an error) and he has
`MIN_SHOTS` shots. The run fails (GitHub emails the owner) when any player is
`MAX_DIST_FT` feet or `MAX_SHARE_PTS` points apart, or when the whole league's
match drops under `MIN_CORR`.

    py nfl_tool/nba/bbref_check.py --season 2027 --data-dir data/nba
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import build_nba  # noqa: E402
import possessions as P  # noqa: E402

PAGE = "https://www.basketball-reference.com/leagues/NBA_{season}_shooting.html"
USER_AGENT = "Mozilla/5.0 (compatible; gmg-nba-check/1.0)"
MIN_SHOTS = 50
MAX_DIST_FT = 3.0
MAX_SHARE_PTS = 8.0
MIN_CORR = {"avg_dist": 0.93, "three": 0.98, "dunk": 0.97}
LABELS = {"avg_dist": "Avg Distance", "three": "3PA Share", "dunk": "Dunk Share"}
NOT_COMPARED = ("Heave Jump Shot", "No Shot (Default Shot)")


def key(name: str) -> str:
    """A name both sources spell the same: no accents, suffixes, punctuation or case."""
    x = unicodedata.normalize("NFKD", html.unescape(name or "")).encode("ascii", "ignore").decode().lower()
    x = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", x)
    return re.sub(r"[^a-z]", "", x)


def parse_page(text: str) -> pd.DataFrame:
    """Basketball-Reference's shooting table: one row a player (a traded player's
    first row is his season total). Shares are 0-1, distance in feet."""
    tab = text[text.find('id="shooting"'):]
    tab = tab[tab.find("<tbody"):tab.find("</tbody>")]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tab, re.S):
        cells = {k: re.sub(r"<[^>]+>", "", v) for k, v in re.findall(r'data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>', tr)}
        if cells.get("name_display"):
            rows.append(cells)
    out = pd.DataFrame(rows, columns=["name_display", "games", "avg_dist", "pct_fga_fg3a", "pct_fga_dunk"])
    out["key"] = out["name_display"].map(key)
    out = out.drop_duplicates("key")
    frame = pd.DataFrame({"key": out["key"], "name": out["name_display"].map(html.unescape),
                          "games": pd.to_numeric(out["games"], errors="coerce"),
                          "avg_dist": pd.to_numeric(out["avg_dist"], errors="coerce"),
                          "three": pd.to_numeric(out["pct_fga_fg3a"], errors="coerce"),
                          "dunk": pd.to_numeric(out["pct_fga_dunk"], errors="coerce")})
    return frame.set_index("key")


def ours(actions: pd.DataFrame, names: dict) -> pd.DataFrame:
    """The same three numbers from the engine's shots, heaves left out: Basketball-Reference
    keeps heaves out of its distance and shot-share numbers (they have their own columns).
    2026-11-11: counting them put Isaiah Collier (5 heaves, 45-63 ft, in 67 shots) 5.4 ft
    and 7 points of threes away from them; without them, 2.3 ft and 1 point."""
    sh = actions[(actions["kind"] == "shot") & ~actions["type"].isin(NOT_COMPARED)]
    g = sh.groupby("player")
    out = pd.DataFrame({"shots": g.size(), "games": g["game_id"].nunique(), "avg_dist": g["dist"].mean(),
                        "three": g["three"].mean(),
                        "dunk": sh["type"].fillna("").str.contains("Dunk").groupby(sh["player"]).mean()})
    out["name"] = [names.get(int(p), str(p)) for p in out.index]
    out["key"] = out["name"].map(key)
    return out.drop_duplicates("key").set_index("key")


def compare(us: pd.DataFrame, them: pd.DataFrame) -> dict:
    """{'players', 'skipped', 'corr', 'drift': [rows], 'problems': [text]}."""
    both = us[us["shots"] >= MIN_SHOTS].join(them, rsuffix="_bb", how="inner")
    same = both[both["games"] == both["games_bb"]]
    corr = {c: float(np.corrcoef(same[c], same[c + "_bb"])[0, 1]) if len(same) > 2 else None for c in LABELS}
    drift = []
    for k, r in same.iterrows():
        gaps = {"avg_dist": abs(r["avg_dist"] - r["avg_dist_bb"]),
                "three": 100 * abs(r["three"] - r["three_bb"]), "dunk": 100 * abs(r["dunk"] - r["dunk_bb"])}
        bad = [c for c, v in gaps.items() if v >= (MAX_DIST_FT if c == "avg_dist" else MAX_SHARE_PTS)]
        if bad:
            drift.append({"name": r["name"], "shots": int(r["shots"]), "bad": bad,
                          "us": [r["avg_dist"], r["three"], r["dunk"]], "bb": [r["avg_dist_bb"], r["three_bb"], r["dunk_bb"]]})
    problems = [f"{LABELS[c]}: league match {v:.3f}, under {MIN_CORR[c]}" for c, v in corr.items()
                if v is not None and v < MIN_CORR[c]]
    problems += [f"{d['name']}: " + ", ".join(LABELS[c] for c in d["bad"]) for d in drift]
    if len(same) < 20:
        problems.append(f"only {len(same)} players matched: the page or the names may have changed")
    return {"players": len(same), "skipped": len(both) - len(same), "corr": corr, "drift": drift, "problems": problems}


def report(res: dict) -> str:
    lines = [f"Basketball-Reference cross-check: {res['players']} players compared "
             f"({res['skipped']} skipped: a different number of games in the two sources)."]
    for c, v in res["corr"].items():
        lines.append(f"  {LABELS[c]:13} league match {v:.3f}" if v is not None else f"  {LABELS[c]}: no data")
    for d in res["drift"]:
        us, bb = d["us"], d["bb"]
        lines.append(f"  DRIFT {d['name']} ({d['shots']} shots): distance {us[0]:.1f} vs {bb[0]:.1f} ft, "
                     f"3PA {us[1]:.0%} vs {bb[1]:.0%}, dunks {us[2]:.0%} vs {bb[2]:.0%}")
    lines.append("PROBLEM " + "; ".join(res["problems"]) if res["problems"] else "All clear.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--season", type=int, default=2027, help="the year the season ENDS (2027 = 2026-27)")
    ap.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    ap.add_argument("--cached", action="store_true", help="reuse downloaded hoopR files")
    args = ap.parse_args()
    pbp = build_nba.fetch_file("pbp", args.season, args.data_dir, not args.cached)
    box = build_nba.fetch_file("player_box", args.season, args.data_dir, not args.cached)
    if pbp is None or box is None:
        print("No play-by-play yet this season; nothing to check.")
        return 0
    season = P.Season(pbp, box)
    names = box.dropna(subset=["athlete_id"]).groupby("athlete_id")["athlete_display_name"].last()
    req = urllib.request.Request(PAGE.format(season=args.season), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        page = resp.read().decode("utf-8", "replace")
    res = compare(ours(season.actions, {int(k): v for k, v in names.items()}), parse_page(page))
    print(report(res))
    return 1 if res["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
