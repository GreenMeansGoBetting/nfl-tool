"""The NHL factor report: which parts of a play have been winning.

Reads the three graded records the deploy commits (model_history/nhl_shots,
nhl_goals, nhl_points), grades every play the way the pages do (the build's
shots_play / goals_play, so the record and this report can't disagree), and
groups the plays by each factor saved with them (SHOTS_FACTORS, GOALS_FACTORS,
POINTS_FACTORS in build_nhl.py): win rate, the win rate the prices needed,
units risking 1 a play, and how many plays. Groundwork for the owner's
"learning which factors win" (2026-10-16); it changes no weight.

    python tools/nhl_factor_report.py                 every market, plays with an edge
    python tools/nhl_factor_report.py --market shots  one market
    python tools/nhl_factor_report.py --every         also the plays with no edge (the better side of every priced line)
    python tools/nhl_factor_report.py --since 2026-11-01 --json out.json

How a factor is grouped:
  * a matchup piece's lift (Shots `l_*`, Goals `l_*`, Points `a_*` / `g_*`)
    and `mates`: by whether it pushed TOWARD the play (more for an over or a
    goal, fewer for an under), against it, or barely moved it (under 2%);
  * `vs_avg` (tonight's number minus his season average): the same way;
  * a label (position, line, line move, home, Zone Match, rest days): by value;
  * any other number (games, minutes, shares, ...): low / middle / top third
    of the plays that have it.
Groups under --min plays (100) are marked "early": a few dozen plays can't
tell a factor from luck (the Goals page's 3-point edge needs ~900). Rows saved
before the factors were kept still count where their own columns say enough
(line move, season average, Zone Match). Not a member page.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nfl_tool" / "nhl"))
import build_nhl as b  # noqa: E402

LABELS = ("pos", "slot", "move", "home", "zone", "rest", "opp_rest", "side", "size")
NEUTRAL = 0.02  # a lift inside +/-2% "barely moved it"
VS_AVG_NEUTRAL = {"shots": 0.1, "goals": 0.02, "points": 0.05}  # in shots / goals / points a game


def play_units(price: float, won: bool) -> float:
    return (100 / -price if price < 0 else price / 100) if won else -1.0


def read_months(folder: Path, since: str | None):
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for game in saved["games"].values():
            if since and game["date"] < since:
                continue
            yield saved, game


def factor_dict(names, values) -> dict:
    return dict(zip(names, values)) if values else {}


def shots_plays(folder: Path, since=None, every=False) -> list:
    out = []
    for saved, game in read_months(folder, since):
        names = saved.get("factors") or b.SHOTS_FACTORS
        for pid, name, team, line, over, under, mean, chance_over, actual, *rest in game["plays"]:
            avg, move, _fl, _fo, _fu, factors = (*rest, None, None, None, None, None, None)[:6]
            play = b.shots_play(chance_over, line, over, under, avg, move)
            if play is None or actual == line or (play["size"] == "none" and not every):
                continue
            won = (actual > line) == (play["side"] == "over")
            f = {**factor_dict(names, factors), "move": move, **({"vs_avg": round(mean - avg, 3)} if avg is not None else {})}
            out.append({"market": "shots", "date": game["date"], "name": name, "side": play["side"], "size": play["size"], "price": play["price"],
                        "edge": play["edge"], "won": won, "units": play_units(play["price"], won), "factors": f})
    return out


def goals_plays(folder: Path, since=None, every=False) -> list:
    out = []
    for saved, game in read_months(folder, since):
        names = saved.get("factors") or b.GOALS_FACTORS
        for pid, name, team, chance, mean, odds, first_odds, thin, zone, actual, move, *rest in game["plays"]:
            play = b.goals_play(chance, odds, move)
            if play is None or (play["size"] == "none" and not every):
                continue
            won = actual > 0
            f = {**factor_dict(names, rest[0] if rest else None), "move": move, "zone": zone}
            out.append({"market": "goals", "date": game["date"], "name": name, "side": "yes", "size": play["size"], "price": odds,
                        "edge": play["edge"], "won": won, "units": play_units(odds, won), "factors": f})
    return out


def points_plays(folder: Path, since=None, every=False) -> list:
    out = []
    for saved, game in read_months(folder, since):
        names = saved.get("factors") or b.POINTS_FACTORS
        for pid, name, team, line, over, under, mean, chance, chance_over, actual, avg, move, _fl, _fo, _fu, factors in game["plays"]:
            if line is None or chance_over is None:
                continue
            play = b.shots_play(chance_over, line, over, under, avg, move, b.POINTS_EDGES)
            if play is None or actual == line or (play["size"] == "none" and not every):
                continue
            won = (actual > line) == (play["side"] == "over")
            f = {**factor_dict(names, factors), "move": move, **({"vs_avg": round(mean - avg, 3)} if avg is not None else {})}
            out.append({"market": "points", "date": game["date"], "name": name, "side": play["side"], "size": play["size"], "price": play["price"],
                        "edge": play["edge"], "won": won, "units": play_units(play["price"], won), "factors": f})
    return out


def is_lift(name: str) -> bool:
    return name.startswith(("l_", "a_", "g_")) and name not in ("a_mean", "g_mean")


def group_key(name: str, value, play: dict, cuts: dict, market: str) -> str | None:
    """Which group of `name` a play falls in, or None when the play doesn't
    have that factor."""
    toward = -1 if play["side"] == "under" else 1
    if name in LABELS:
        if name in ("rest", "opp_rest"):
            return None if value is None else ("b2b (1 day)" if value == 1 else "3+ days" if value >= 3 else f"{value} days")
        if name == "home":
            return None if value is None else ("home" if value else "away")
        return {"move": "no move", "slot": "no lineup", "zone": "no tag"}.get(name, "--") if value is None else str(value)
    if value is None or not isinstance(value, (int, float)):
        return None
    if is_lift(name) or name == "mates":
        moved = (value - 1) * toward
        return "toward the play" if moved > NEUTRAL else "against the play" if moved < -NEUTRAL else "barely moved (<2%)"
    if name == "vs_avg":
        # Toward the play: an over where tonight's number is above his own average a game (or an under below it).
        moved, band = value * toward, VS_AVG_NEUTRAL[market]
        return "toward the play" if moved > band else "against the play" if moved < -band else "about his average"
    lo, hi = cuts.get(name, (None, None))
    if lo is None:
        return None
    return f"low third (<{lo:g})" if value < lo else f"top third (>={hi:g})" if value >= hi else "middle third"


def thirds(plays: list, name: str):
    values = sorted(p["factors"][name] for p in plays if isinstance(p["factors"].get(name), (int, float)) and not isinstance(p["factors"].get(name), bool))
    if len(values) < 6:
        return None, None
    return round(values[len(values) // 3], 3), round(values[2 * len(values) // 3], 3)


def tally(plays: list) -> dict:
    n = len(plays)
    wins = sum(p["won"] for p in plays)
    units = sum(p["units"] for p in plays)
    need = sum(b.break_even(p["price"]) for p in plays) / n if n else None
    return {"plays": n, "wins": wins, "losses": n - wins, "win_pct": round(wins / n, 3) if n else None,
            "need_pct": round(need, 3) if need is not None else None, "units": round(units, 2), "roi": round(units / n, 3) if n else None}


def factor_report(plays: list, market: str, minimum: int) -> dict:
    names = []
    for p in plays:
        for k in ("side", "size", *p["factors"]):
            if k not in names:
                names.append(k)
    cuts = {k: thirds(plays, k) for k in names if k not in LABELS and not is_lift(k) and k not in ("mates", "vs_avg")}
    out = {"market": market, "total": tally(plays), "factors": {}}
    for name in names:
        groups = {}
        for p in plays:
            value = p.get(name) if name in ("side", "size") else p["factors"].get(name)
            if name not in ("side", "size") and name not in p["factors"]:
                continue
            key = group_key(name, value, p, cuts, market)
            if key is not None:
                groups.setdefault(key, []).append(p)
        if len(groups) < 2:
            continue
        out["factors"][name] = [{"group": key, **tally(rows), "early": len(rows) < minimum} for key, rows in sorted(groups.items())]
    return out


def print_report(report: dict, minimum: int):
    t = report["total"]
    print(f"\n=== {report['market'].upper()}: {t['plays']} graded plays, {t['wins']}-{t['losses']} ({pct(t['win_pct'])}, needed {pct(t['need_pct'])}), {t['units']:+.2f}u ===")
    if not t["plays"]:
        print("  nothing graded yet")
        return
    for name, rows in report["factors"].items():
        print(f"\n  {name}")
        for r in rows:
            flag = "  early (<%d)" % minimum if r["early"] else ""
            print(f"    {r['group']:<26} {r['plays']:>5}  {r['wins']:>4}-{r['losses']:<4} {pct(r['win_pct']):>6}  need {pct(r['need_pct']):>6}  {r['units']:+8.2f}u  {roi(r['roi']):>7}{flag}")


def pct(x):
    return "--" if x is None else f"{x * 100:.1f}%"


def roi(x):
    return "--" if x is None else f"{x * 100:+.1f}%"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--market", choices=("shots", "goals", "points"), action="append", help="One market (repeatable); all three by default")
    parser.add_argument("--every", action="store_true", help="Also grade the plays with no edge (the better side of every priced line)")
    parser.add_argument("--since", help="Only games on or after this date (YYYY-MM-DD)")
    parser.add_argument("--min", type=int, default=100, help="Groups with fewer plays are marked early (default 100)")
    parser.add_argument("--json", type=Path, help="Also write the report here as JSON")
    parser.add_argument("--history", type=Path, default=ROOT / "model_history", help="The folder holding nhl_shots / nhl_goals / nhl_points")
    args = parser.parse_args(argv)
    readers = {"shots": shots_plays, "goals": goals_plays, "points": points_plays}
    reports = []
    for market in args.market or ("shots", "goals", "points"):
        plays = readers[market](args.history / f"nhl_{market}", args.since, args.every)
        report = factor_report(plays, market, args.min)
        reports.append(report)
        print_report(report, args.min)
    print("\nWin % alone misleads on long prices: compare it with 'need' (the win rate the prices needed) and units.")
    if args.json:
        args.json.write_text(json.dumps(reports, indent=1), encoding="utf-8")
        print(f"Wrote {args.json}")
    return reports


if __name__ == "__main__":
    main()
