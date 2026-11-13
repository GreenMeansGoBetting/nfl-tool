"""NBA Player Types: every player grouped by HOW he shoots, not his position.

The owner, 2026-11-11, inspired by an old tool ("Courtside Pal") that typed players by
the shots they take: "not all PGs or PFs play the same style". Letters, never names
(the owner disliked named archetypes; "1a / 1b" would say a PG does one of two things).
A = the deepest shooters ... K = rim runners.

How (every step audited with the owner, 2026-11-11; .claude/rules/nba.md "Player Types"):
- Each player's shot mix this season (`F`): average distance and his share of threes,
  catch-and-shoot, pull-ups / step-backs, fades / turnarounds, floaters, post / hooks,
  drives, cuts, lobs / putbacks and fast-break shots. Every ESPN shot label sits in
  exactly one group (`LABELS`); an unknown label stops the step (`unsorted`). Heaves and
  "No Shot" are left out. Distances are the engine's (text, else the shot's spot).
- `MIN_SHOTS` 50 to be typed (the owner).
- Ten groups by k-means on the standardized mix (numpy, `STARTS` restarts, fixed seed):
  10 fit best (11 / 12 split the scorers, 12 made a one-player group). Then the hand
  split the owner chose: G's bigs under `SPLIT_THREE` 20% threes are their own type, I
  (Sengun, Anthony Davis: the gap sat between 24% and 16%). Eleven types.
- **The groups are saved** (`model_history/nba_shot_types/<season>.json`) and redrawn
  once a week (`REDRAW_DAYS`; the owner: "a weekly check is the longest we should
  wait"). A redraw keeps letters: each new group takes the letter of the old group
  nearest to it. Every build re-types every player against the saved groups.
- Borderline: `fit` = his distance to his own group / to his second (squared, 0 = dead
  center, 1 = on the line). `BORDER` 0.5+ shows two letters ("B / E"): on 2026-11-11
  players under it kept their letter between odd and even games 80% of the time, over it 33%.
- Defense vs Type: every shot by a typed player, credited to the defense he faced:
  [shots, makes, points, threes made] per defense per type, and the defense's games.

    py nfl_tool/nba/shot_types.py --season 2027 --data-dir data/nba --write   # redraw now
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

RECORD_DIR = Path(__file__).resolve().parents[2] / "model_history" / "nba_shot_types"
MIN_SHOTS = 50
K = 10
STARTS = 200
SEED = 7
SPLIT_THREE = 0.20


BORDER = 0.5
REDRAW_DAYS = 7
LETTERS = "ABCDEFGHIJK"
F = ["dist", "three", "catch", "pullup", "fade", "float", "post", "drive", "cut", "lob", "fast"]
LABELS = {
    "catch": ("Jump Shot", "Running Jump Shot", "Jump Shot Bank"),  # 95-97% assisted when made
    "pullup": ("Pullup Jump Shot", "Running Pullup Jump Shot", "Pullup Bank Jump Shot", "Step Back Jump Shot",
               "Step Back Bank Jump Shot"),
    "fade": ("Fade Away Jump Shot", "Turnaround Fade Away Jump Shot", "Turnaround Jump Shot", "Turnaround Bank Jump Shot",
             "Fade Away Bank Jump Shot", "Turnaround Fadeaway Bank Jump Shot"),
    "float": ("Driving Floating Jump Shot", "Floating Jump Shot", "Driving Floating Bank Jump Shot", "Driving Jump Shot Bank"),
    "post": ("Turnaround Hook Shot", "Driving Hook Shot", "Hook Shot", "Hook Driving Bank", "Hook Turnaround Bank",
             "Hook Shot Bank"),
    "lob": ("Tip Shot", "Layup Shot Putback", "Alley Oop Dunk Shot", "Alley Oop Layup Shot", "Tip Dunk Shot",
            "Running Alley Oop Dunk Shot", "Putback Dunk Shot", "Running Alley Oop Layup Shot"),
    # off the ball: cutting, and plain layups / dunks (82-87% assisted when made)
    "cut": ("Cutting Layup Shot", "Cutting Dunk Shot", "Cutting Finger Roll Layup Shot", "Layup Shot", "Dunk Shot",
            "Reverse Layup Shot", "Reverse Dunk Shot"),
    "drive": ("Driving Layup Shot", "Running Layup Shot", "Driving Finger Roll Layup", "Running Dunk Shot", "Driving Dunk Shot",
              "Layup Driving Reverse", "Running Finger Roll Layup", "Layup Running Reverse", "Finger Roll Layup",
              "Running Reverse Dunk Shot", "Driving Reverse Dunk Shot"),
}
LEFT_OUT = ("Heave Jump Shot", "No Shot (Default Shot)")
GROUP_OF = {label: g for g, labels in LABELS.items() for label in labels}
TRANSITION_SECS = 8  # identity.py's: off a miss or a steal, the shot within 8 seconds


def unsorted(types) -> list:
    """ESPN shot labels no group knows (a new label = decide where it goes first)."""
    return sorted(set(types) - set(GROUP_OF) - set(LEFT_OUT))


def shots_of(engine) -> pd.DataFrame:
    """The engine's shots with a column per shot group (True / False), heaves left out."""
    a = engine.actions
    poss = engine.possessions
    sh = a[(a["kind"] == "shot") & ~a["type"].isin(LEFT_OUT)].copy()
    fast = poss.assign(fast=poss["start"].isin(("miss", "steal")))[["game_id", "n", "t0", "fast"]]
    sh = sh.merge(fast, on=["game_id", "n"], how="left")
    sh["fast"] = sh["fast"].fillna(False).astype(bool) & ((sh["t"] - sh["t0"]) <= TRANSITION_SECS)
    group = sh["type"].map(GROUP_OF)
    for g in LABELS:
        sh[g] = group == g
    sh["three"] = sh["three"].astype(bool)
    sh["dist"] = pd.to_numeric(sh["dist"], errors="coerce")
    return sh


def profiles(sh: pd.DataFrame, min_shots: int = MIN_SHOTS) -> pd.DataFrame:
    """One row a player with min_shots+: his mix (`F`) and `n` shots."""
    sh = sh.dropna(subset=["player", "dist"])
    g = sh.groupby("player")
    p = g[F].mean().astype(float)
    p["n"] = g.size()
    p = p[p["n"] >= min_shots]
    p.index = p.index.astype(int)
    return p


def kmeans(Z: np.ndarray, k: int = K, starts: int = STARTS, seed: int = SEED) -> np.ndarray:
    """The k centers with the least spread over `starts` random starts (same answer every run)."""
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(starts):
        c = Z[rng.choice(len(Z), k, replace=False)]
        for _ in range(100):
            lab = ((Z[:, None] - c[None]) ** 2).sum(2).argmin(1)
            nc = np.array([Z[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
            if np.allclose(nc, c):
                break
            c = nc
        sse = float(((Z - c[lab]) ** 2).sum())
        if best is None or sse < best[0]:
            best = (sse, c)
    return best[1]


def bigs_group(raw: np.ndarray) -> int:
    """The bigs who shoot threes: of the groups taking 20%+ threes, the most post-ups,
    lobs and putbacks (2026-11-11: Wembanyama, Jokic, Towns at 24-35% threes)."""
    i3 = F.index("three")
    inside = raw[:, F.index("post")] + raw[:, F.index("lob")]
    return int(np.argmax(np.where(raw[:, i3] >= SPLIT_THREE, inside, -1)))


def draw(prof: pd.DataFrame, old: dict | None = None) -> dict:
    """New groups from the players' mixes: {mu, sd, centers {letter: raw mix}, split}.
    First draw: the eleven types (ten groups + the bigs' split) lettered by their players'
    average distance, deepest first. A redraw: each new group takes the letter of the
    nearest old group (closest pairs first), so letters don't shuffle."""
    X = prof[F].values
    mu, sd = X.mean(0), X.std(0)
    sd[sd == 0] = 1
    raw = kmeans((X - mu) / sd) * sd + mu  # centers back in real units
    if old and len(old.get("centers", {})) == K:
        prev = {L: np.array(v) for L, v in old["centers"].items()}
        pairs = sorted((float((((raw[i] - prev[L]) / sd) ** 2).sum()), i, L) for i in range(K) for L in prev)
        taken_i, taken_L, out = set(), set(), {}
        for _, i, L in pairs:
            if i not in taken_i and L not in taken_L:
                out[L] = raw[i]
                taken_i.add(i)
                taken_L.add(L)
        split = old["split"]
    else:
        lab = (((((X - mu) / sd)[:, None] - ((raw - mu) / sd)[None]) ** 2).sum(2)).argmin(1)
        big = bigs_group(raw)
        low = (lab == big) & (prof["three"].values < SPLIT_THREE)
        dist = prof["dist"].values
        order = [(float(dist[(lab == i) & ~low].mean()), i) for i in range(K)] + [(float(dist[low].mean()), "split")]
        order.sort(key=lambda x: -x[0])
        names = {who: LETTERS[j] for j, (_, who) in enumerate(order)}
        out = {names[i]: raw[i] for i in range(K)}
        split = {"from": names[big], "to": names["split"]}
    return {"mu": mu.round(5).tolist(), "sd": sd.round(5).tolist(), "split": split,
            "centers": {L: np.round(v, 5).tolist() for L, v in sorted(out.items())}}


def assign(prof: pd.DataFrame, groups: dict) -> pd.DataFrame:
    """Each player's type, his lean (second-nearest), fit, and whether he's borderline."""
    mu, sd = np.array(groups["mu"]), np.array(groups["sd"])
    letters = sorted(groups["centers"])
    C = (np.array([groups["centers"][L] for L in letters]) - mu) / sd
    Z = (prof[F].values - mu) / sd
    dd = ((Z[:, None] - C[None]) ** 2).sum(2)
    order = np.argsort(dd, 1)
    srt = np.sort(dd, 1)
    t = np.array([letters[i] for i in order[:, 0]], dtype=object)
    lean = np.array([letters[i] for i in order[:, 1]], dtype=object)
    src, to = groups["split"]["from"], groups["split"]["to"]
    split = (t == src) & (prof["three"].values < SPLIT_THREE)
    t[split] = to
    lean[split] = src  # a split big's other side is the bigs he split from
    fit = srt[:, 0] / np.maximum(srt[:, 1], 1e-9)
    return pd.DataFrame({"type": t, "lean": lean, "fit": fit.round(3), "border": fit >= BORDER}, index=prof.index)


def stability(sh: pd.DataFrame, groups: dict) -> dict:
    """Odd games vs even games (each player's own): how many keep their letter."""
    sh = sh.copy()
    sh["g"] = sh.groupby("player")["game_id"].rank(method="dense").astype(int) % 2
    a = assign(profiles(sh[sh["g"] == 1], MIN_SHOTS // 2), groups)
    b = assign(profiles(sh[sh["g"] == 0], MIN_SHOTS // 2), groups)
    both = a.join(b, lsuffix="_o", rsuffix="_e", how="inner")
    if both.empty:
        return {"players": 0}
    same = both["type_o"] == both["type_e"]
    near = same | (both["type_o"] == both["lean_e"]) | (both["type_e"] == both["lean_o"])
    return {"players": int(len(both)), "same": round(float(same.mean()), 3), "same_or_lean": round(float(near.mean()), 3)}


def groups_for(sh: pd.DataFrame, season: int, today: date, path: Path | None = None, force: bool = False) -> dict:
    """The saved groups, redrawn (and saved) when missing or `REDRAW_DAYS` old."""
    path = path or RECORD_DIR / f"{season}.json"
    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if saved and not force and (today - date.fromisoformat(saved["drawn"])).days < REDRAW_DAYS:
        return saved
    prof = profiles(sh)
    if len(prof) < 3 * K:
        return saved or {}
    new = draw(prof, saved)
    new["drawn"] = today.isoformat()
    new["players"] = int(len(prof))
    new["stability"] = stability(sh, new)
    if saved:  # who changed letters at this redraw
        before, after = assign(prof, saved)["type"], assign(prof, new)["type"]
        new["moved"] = int((before != after).sum())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(new, indent=1), encoding="utf-8")
    return new


def defense(sh: pd.DataFrame, types: pd.Series, team_abbr: dict) -> dict:
    """{defense: {"games": n, "vs": {letter: [shots, makes, points, threes made]}}} and the league's."""
    teams = sh.groupby("game_id")["team"].unique()
    all_sh = sh.copy()
    all_sh["def"] = [next((t for t in teams[g] if t != o), None) for g, o in zip(all_sh["game_id"], all_sh["team"])]
    all_sh = all_sh.dropna(subset=["def"])
    all_sh["pts"] = np.where(all_sh["made"], np.where(all_sh["three"], 3, 2), 0)
    sh = all_sh[all_sh["player"].isin(types.index)].copy()
    sh["type"] = sh["player"].astype(int).map(types)
    sh["m3"] = sh["made"] & sh["three"]
    out, league = {}, {}
    games = sh.groupby("def")["game_id"].nunique()
    for (d, t), q in sh.groupby(["def", "type"]):
        abbr = team_abbr.get(int(d))
        if not abbr:
            continue
        row = out.setdefault(abbr, {"games": int(games[d]), "vs": {}})
        row["vs"][t] = [int(len(q)), int(q["made"].sum()), int(q["pts"].sum()), int(q["m3"].sum())]
    for t, q in sh.groupby("type"):
        league[t] = [int(len(q)), int(q["made"].sum()), int(q["pts"].sum()), int(q["m3"].sum())]
    # Shot Fit (the owner, 2026-11-11): every shot a defense faced, by kind (every shooter, typed or not,
    # so the samples are big early): {defense: {kind: [shots, makes, points]}} and the league's.
    kinds, league_kinds = {}, {}
    for k in LABELS:
        if k not in all_sh:
            continue  # a frame without the shot groups (tests)
        q = all_sh[all_sh[k].astype(bool)]
        league_kinds[k] = [int(len(q)), int(q["made"].sum()), int(q["pts"].sum())]
        for d, qq in q.groupby("def"):
            abbr = team_abbr.get(int(d))
            if abbr:
                kinds.setdefault(abbr, {})[k] = [int(len(qq)), int(qq["made"].sum()), int(qq["pts"].sum())]
    return {"teams": out, "league": league, "team_games": int(games.sum()), "kinds": kinds, "league_kinds": league_kinds}


def block(engine, box: pd.DataFrame, season: int, today: date, path: Path | None = None) -> dict:
    """data.json `shot_types`: the groups, every typed player, and Defense vs Type."""
    sh = shots_of(engine)
    bad = unsorted(sh["type"].dropna().unique())
    if bad:
        raise ValueError(f"ESPN shot labels with no group: {bad}")
    groups = groups_for(sh, season, today, path)
    if not groups:
        return {}
    prof = profiles(sh)
    typed = assign(prof, groups)
    b = box.dropna(subset=["athlete_id"]).sort_values("game_date")
    last = b.groupby("athlete_id").last()
    last.index = last.index.astype(int)
    team_abbr = dict(zip(b["team_id"].astype(int), b["team_abbreviation"]))
    players = {}
    for pid, r in prof.iterrows():
        t = typed.loc[pid]
        info = last.loc[pid] if pid in last.index else None
        players[str(pid)] = {
            "name": None if info is None else info["athlete_display_name"],
            "team": None if info is None else info["team_abbreviation"],
            "pos": None if info is None else info.get("athlete_position_abbreviation"),
            "type": t["type"], "lean": t["lean"], "fit": float(t["fit"]), "border": bool(t["border"]),
            "n": int(r["n"]), "mix": [round(float(r["dist"]), 1)] + [round(float(r[k]) * 100, 1) for k in F[1:]],
        }
    games, avg = baseline_log(b, set(players), assisted_makes(sh))
    for pid, a in avg.items():
        players[pid]["avg"] = a
    return {"drawn": groups["drawn"], "stability": groups.get("stability"), "moved": groups.get("moved"),
            "fields": F, "min_shots": MIN_SHOTS, "border": BORDER, "split": SPLIT_THREE,
            "players": players, "defense": defense(sh, typed["type"], team_abbr),
            "log_fields": LOG_FIELDS, "log": games}


# The measuring stick for Slate Standouts and Defense Vs Type (the owner, 2026-11-11: "avg over
# baseline"): every game a typed player played, against the defense he faced, as HIS number that
# night minus his own average in his OTHER games (leave-one-out, so the night can't pull his
# baseline toward itself). No pull toward the league (the owner): thin samples are counted, not shrunk.
# am = his ASSISTED makes that night (2026-11-13, the owner: Assist Spots asks how a defense treats the
# shots a passer sets up, not a ball-dominant type's self-created points): from the play-by-play.
LOG_STATS = (("points", "pts"), ("three_point_field_goals_made", "m3"), ("am", "am"))
# game: that night's line (props.json research lines); am / am_diff appended last so older readers keep their places
LOG_FIELDS = ["date", "def", "player", "pts", "m3", "pts_diff", "m3_diff", "game", "am", "am_diff"]


def assisted_makes(sh: pd.DataFrame) -> dict:
    """{(player id, game id): his assisted makes that game} from the shots (a make with a passer)."""
    if "assist" not in sh.columns:
        return {}
    q = sh[sh["made"].astype(bool) & sh["assist"].notna() & sh["player"].notna()]
    return {(str(int(p)), str(int(g))): int(n) for (p, g), n in q.groupby(["player", "game_id"]).size().items()}


def baseline_log(box: pd.DataFrame, typed_ids: set, assisted: dict | None = None) -> tuple:
    """([[date, defense, player, pts, 3PM, pts - his other-games avg, 3PM - avg, game id, assisted makes, - avg]],
    {player: [games, pts avg, 3PM avg, assisted makes avg]})."""
    b = box.copy()
    b["pid"] = b["athlete_id"].astype(int).astype(str)
    played = (~b["did_not_play"].fillna(False).astype(bool)) & (pd.to_numeric(b["minutes"], errors="coerce").fillna(0) > 0)
    b = b[b["pid"].isin(typed_ids) & played].copy()
    assisted = assisted or {}
    b["am"] = [assisted.get((p, str(int(g))), 0) for p, g in zip(b["pid"], b["game_id"])]
    for col, _ in LOG_STATS:
        b[col] = pd.to_numeric(b[col], errors="coerce").fillna(0)
    g = b.groupby("pid")
    n = g["pid"].transform("size")
    out_rows, avg = [], {}
    diffs = {}
    for col, short in LOG_STATS:
        total = g[col].transform("sum")
        other = (total - b[col]) / (n - 1).where(n > 1)
        diffs[short] = (b[col] - other).round(2)
    for i, r in enumerate(b.itertuples(index=False)):
        dp, d3, da = diffs["pts"].iloc[i], diffs["m3"].iloc[i], diffs["am"].iloc[i]
        if pd.isna(dp):
            continue  # his only game: no other games to measure it against
        out_rows.append([str(r.game_date)[:10], r.opponent_team_abbreviation, r.pid, int(r.points),
                         int(r.three_point_field_goals_made), float(dp), float(d3), str(int(r.game_id)), int(r.am), float(da)])
    for pid, q in g:
        avg[pid] = [int(len(q)), round(float(q["points"].mean()), 1), round(float(q["three_point_field_goals_made"].mean()), 1),
                    round(float(q["am"].mean()), 2)]
    return out_rows, avg


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--season", type=int, default=2027)
    ap.add_argument("--data-dir", type=Path, default=Path("data/nba"))
    ap.add_argument("--write", action="store_true", help="redraw the groups now and save them")
    args = ap.parse_args()
    import possessions as P
    pbp = pd.read_parquet(args.data_dir / f"play_by_play_{args.season}.parquet")
    box = pd.read_parquet(args.data_dir / f"player_box_{args.season}.parquet")
    engine = P.Season(pbp, box)
    sh = shots_of(engine)
    print("unsorted labels:", unsorted(sh["type"].dropna().unique()))
    g = groups_for(sh, args.season, datetime.now().date(), force=args.write)
    typed = assign(profiles(sh), g)
    print("drawn", g.get("drawn"), "stability", g.get("stability"), "moved", g.get("moved"))
    print(typed["type"].value_counts().sort_index().to_dict(), "borderline", int(typed["border"].sum()))


if __name__ == "__main__":
    main()
