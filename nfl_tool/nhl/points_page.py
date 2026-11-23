"""The Points page's data for the NHL build: the board, the graded record and
points.json. The model itself is points_model.py.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import points_model
import shots_model
from nhl_games import OUT_STATUSES
from nhl_stats import ratio
from nhl_prices import CLV_COLS, clv_add, clv_done, clv_move, clv_tally, novig_prices, ou_looks, ou_nv_col
from nhl_records import record_ledger
from shots_page import SHOTS_DAYS_AHEAD, UNSURE_EDGE, line_move, shots_play
from goals_page import expected_goalie
# The Points page (1+ point, Novig's points over / under): the Shots page's
# buckets and best side. Points prices sit near even money (a 0.5 line), so
# a 3-point edge is about a 6% return.
POINTS_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
# The Points bar (the owner, 2026-10-22, after an audit of the first six nights'
# 370 graded plays): a play is shown or left out, like Shots. A play = the 0.5
# line, an edge of POINTS_BAR or more, never against tonight's line change (an
# over on a player moved down, an under on one moved up). What it replaced:
# Strong + Lean went 131-119 (+2.6u), but Check went 49-71 (-34.9u; 42-57 of it
# plays against the line change), the 1.5 lines 8-20 (-17.5u; "2+ points" was
# never calibrated) and edges of 3-6 92-102 (-23.5u). This rule would have gone
# 61-50 (+10.7u), positive in both halves, but in sample: expect less. On the
# priced 0.5 lines the market's own price predicted a point better than the
# model on every one of the six nights: Points is a talking point until the
# record says otherwise. POINTS_EDGES still sizes the every-book price tags.
POINTS_BAR = 0.06
POINTS_RECORD_DAYS = 14
POINTS_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_points"
POINTS_HONEST = (0.0, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 1.01)  # the record's "said vs got" buckets
# What each priced player's record row keeps of the parts behind the number
# (the owner, 2026-10-16: see which things "are leading to more wins ...
# and weighting those"): who he is and his usage, tonight's line, the
# matchup, and each piece's lift on his assists (a_*) and goals (g_*).
POINTS_FACTORS = ("pos", "games", "avg", "g_mean", "a_mean", "ev_min", "pp_min", "slot", "move", "mates", "home",
                  "a_opp", "a_goalie", "a_line", "a_b2b", "a_opp_b2b", "a_spread", "g_opp", "g_goalie", "g_finish", "g_split", "g_low")


# ---- Points (1+ point; points_model.py) ----
def points_model_for(records: list, goals: "goals_model.GoalsModel") -> "points_model.PointsModel":
    """The points model on this season's games only, on top of the goals
    model with every game already added (its table has scored the shots)."""
    model = points_model.PointsModel(goals)
    for record in records:
        model.add_game(record)
    return model


def points_play(chance_over: float, line: float, over, under, avg=None, move=None) -> dict | None:
    """The better side of a points line (shots_play) filed by the Points bar:
    "play" on the 0.5 line at an edge of POINTS_BAR or more, not against
    tonight's line change; "unsure" past the safety net; else "none"."""
    play = shots_play(chance_over, line, over, under, avg, move, POINTS_EDGES)
    if play and play["size"] != "unsure":
        play["size"] = "play" if line == 0.5 and play["edge"] >= POINTS_BAR and not play["against_move"] else "none"
    return play


def point_row(model, player: dict, opp: str, home: bool, rest, opp_rest, out: bool, slot, goalie, market: dict | None, first, mates: list, first_nv=None) -> dict | None:
    """One skater's points projection for one game, what it is made of, the
    better side of Novig's points line (points_play: the Points bar)
    and the first line and prices the site saw (for closing line value).
    `mates` = tonight's projected linemates [(id, position)]: a TRACKED
    factor, never in the number."""
    proj = model.project(player["id"], opp, home, rest, opp_rest, player["team"], slot, goalie)
    if proj is None:
        return None
    market = market or {}
    gp = proj["goals"]
    usual_slot = model.goals.shots.usual_slot(player["id"], player["team"])
    move = line_move(slot, usual_slot)
    season = proj["season"]
    games = season.get("games", 0)
    avg = round(season.get("points", 0) / games, 2) if games else None
    line = market.get("line")
    # Rounded first, so the page, the record and this row grade the same number.
    chance_over = round(points_model.chance_over(proj["mean"], line, model.calibration), 3) if line is not None else None
    play = points_play(chance_over, line, market.get("over"), market.get("under"), avg, move) if chance_over is not None else None
    ratio = model.mates(player["id"], mates)
    return {
        "id": player["id"], "name": player["name"], "team": player["team"], "opp": opp, "home": home, "pos": player["pos"], "out": out,
        "slot": slot, "usual_slot": usual_slot, "move": move, "goalie": goalie,
        # What his season says, plain.
        "games": games, "goals": season.get("goals", 0), "assists": season.get("assists", 0), "points": season.get("points", 0), "avg": avg,
        "minutes": round(gp["minutes"], 1), "ev_min": round(gp["ev_min"], 1), "pp_min": round(gp["pp_min"], 1),
        # Tonight: expected goals (the Goals page's number), expected assists, the chance of 1+ and 2+.
        "g_mean": round(proj["goals_mean"], 3), "a_mean": round(proj["assists_mean"], 3), "mean": round(proj["mean"], 3),
        "chance": round(proj["chance"], 3), "two": round(points_model.chance_at_least(proj["mean"], 2), 3),
        "fair": shots_model.fair_american(proj["chance"]),
        "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "g_lift": {key: round(value, 3) for key, value in gp["lift"].items()},
        "mates": round(ratio, 3) if ratio else None,
        "line": line, "over": market.get("over"), "under": market.get("under"), "thin": market.get("thin"),
        "first": first if first is not None else ({k: market.get(k) for k in ("line", "over", "under")} if line is not None else None),
        # Novig's own line and prices now and at the first look (closing line value).
        "nv": novig_prices(market), "first_nv": first_nv or novig_prices(market),
        "chance_over": chance_over,
        "side": play["side"] if play else None, "price": play["price"] if play else None,
        "edge": round(play["edge"], 3) if play else None, "size": play["size"] if play else None, "fade": play["fade"] if play else None,
    }


def points_board(model, games: list, lineups: dict, injuries: dict, records: list, previous: dict | None, now_utc: datetime,
                 tonight: dict | None, skaters: dict | None, goalies: dict, player_odds: dict) -> dict:
    """{game id: {"locked", "players": [rows]}} for the Points page: the
    Goals page's games, players and lock (goals_board), every skater priced
    or not. A finished game's rows get `actual` (goals + assists; None if he
    didn't play)."""
    prev_games = (previous or {}).get("games") or {}
    finished = {str(r["id"]): r for r in records}
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    out = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        if started:
            kept = prev_games.get(g["game_id"])
            if not kept:
                continue
            entry = {**kept, "locked": True}
            record = finished.get(g["game_id"])
            if record:
                entry["final"] = True
                played = record["skaters"]
                entry["players"] = [{**row, "actual": played[row["id"]]["g"] + played[row["id"]]["a"] if row["id"] in played else None} for row in kept["players"]]
            out[g["game_id"]] = entry
            continue
        if g["date"] > last_day:
            continue
        posted = (tonight or {}).get(g["game_id"]) or {}
        seen = {row["id"]: row for row in (prev_games.get(g["game_id"]) or {}).get("players") or []}
        odds = player_odds.get(g["game_id"]) or {}
        rows = []
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            slots = (posted.get(team) or {}).get("skaters")
            if slots:
                dressed = [(skaters[pid], slot, False) for pid, slot in slots.items() if pid in (skaters or {})]
            else:
                out_ids = {p["id"] for p in injuries.get(team) or [] if p.get("id") and p.get("status") in OUT_STATUSES}
                dressed = [(player, None, player["id"] in out_ids) for player in lineups.get(team) or []]
            goalie = expected_goalie(opp, posted, goalies)
            for player, slot, is_out in dressed:
                mates = [(q, skaters[q]["pos"]) for q, s2 in (slots or {}).items() if slot and q != player["id"] and s2 == slot and q in (skaters or {})]
                market = (odds.get(player["id"]) or {}).get("points")
                first = (seen.get(player["id"]) or {}).get("first")
                row = point_row(model, {**player, "team": team}, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), is_out, slot, goalie,
                                market, first, mates, (seen.get(player["id"]) or {}).get("first_nv"))
                if row:
                    rows.append(row)
        if rows:
            out[g["game_id"]] = {"locked": False, "posted": posted.get("posted"), "players": sorted(rows, key=lambda row: -row["chance"])}
    return out


POINTS_RECORD_COLS = ("id", "name", "team", "line", "over", "under", "mean", "chance", "chance_over", "actual", "avg", "move",
                      "first_line", "first_over", "first_under", "factors", "nv")


def point_factors(row: dict) -> list:
    """The parts behind a priced player's number, in POINTS_FACTORS order."""
    lift, g_lift = row.get("lift") or {}, row.get("g_lift") or {}
    value = {"pos": row.get("pos"), "games": row.get("games"), "avg": row.get("avg"), "g_mean": row.get("g_mean"), "a_mean": row.get("a_mean"),
             "ev_min": row.get("ev_min"), "pp_min": row.get("pp_min"), "slot": row.get("slot"), "move": row.get("move"),
             "mates": row.get("mates"), "home": int(bool(row.get("home"))),
             **{f"a_{k}": lift.get(k) for k in ("opp", "goalie", "line", "b2b", "opp_b2b", "spread")},
             **{f"g_{k}": g_lift.get(k) for k in ("opp", "goalie", "finish", "split", "low")}}
    return [value[k] for k in POINTS_FACTORS]


def record_point_games(folder: Path, board: dict, games: list) -> int:
    """Adds each newly finished game to the Points record: every projected
    player who played (priced or not, so the chances can be graded on
    everyone), with the chance, the line and prices locked before puck drop,
    the first line and prices the site saw, his points, and for a priced
    player the parts behind his number (`factors`, POINTS_FACTORS order:
    what "learning which factors win" reads). Written once, never changed."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": POINTS_RECORD_COLS, "factors": POINTS_FACTORS, "games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = []
            for row in entry["players"]:
                if row.get("actual") is None:
                    continue
                first = row.get("first") or {}
                priced = row.get("line") is not None
                plays.append([row["id"], row["name"], row["team"], row.get("line"), row.get("over"), row.get("under"), row["mean"], row["chance"],
                              row.get("chance_over"), row["actual"], row.get("avg"), row.get("move"),
                              first.get("line"), first.get("over"), first.get("under"), point_factors(row) if priced else None, ou_nv_col(row) if priced else None])
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "plays": plays}
        if len(saved["games"]) > before:
            saved.update(cols=POINTS_RECORD_COLS, nv=CLV_COLS["ou"])  # older rows are just shorter
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def points_record_summary(folder: Path) -> dict:
    """The Points record so far, the Shots record's way: the better side of
    each priced line by bucket (play / none / unsure: points_play), overs and
    unders, `fade` / `with` (against or with his season points a game),
    closing line value, `days`, `plays` (latest POINTS_RECORD_DAYS days) and
    `ledger`; plus `honest`: every graded player, priced or not, by the
    chance of 1+ point the model gave against how often he got one."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "players": 0,
           **{k: tally() for k in ("play", "none", "unsure", "over", "under", "fade", "with")},
           "clv": clv_tally(),
           "honest": [{"lo": lo, "hi": hi, "players": 0, "said": 0.0, "got": 0} for lo, hi in zip(POINTS_HONEST, POINTS_HONEST[1:])]}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, line, over, under, mean, chance, chance_over, actual, avg, move, first_line, first_over, first_under, _factors, *more in game["plays"]:
                nv = more[0] if more else None
                out["players"] += 1
                for bucket in out["honest"]:
                    if bucket["lo"] <= chance < bucket["hi"]:
                        bucket["players"] += 1
                        bucket["said"] += chance
                        bucket["got"] += actual > 0
                if line is None or chance_over is None:
                    continue
                play = points_play(chance_over, line, over, under, avg, move)
                if play is None or actual == line:
                    continue
                won = (actual > line) == (play["side"] == "over")
                units = (100 / -play["price"] if play["price"] < 0 else play["price"] / 100) if won else -1.0
                size = play["size"]
                called = [play["side"], "fade" if play["fade"] else "with"] if size == "play" else []
                for key in (size, *called):
                    out[key]["wins" if won else "losses"] += 1
                    out[key]["units"] = round(out[key]["units"] + units, 2)
                if size in ("none", "unsure"):
                    continue
                if called:
                    # Closing line value on Novig's own prices (clv_move).
                    first, lock = ou_looks(game["date"], nv, line, over, under, first_line, first_over, first_under)
                    clv_add(out["clv"], game["date"], *clv_move(first, lock, play["side"], "under" if play["side"] == "over" else "over"))
                if called:
                    day = days.setdefault(game["date"], tally())
                    day["wins" if won else "losses"] += 1
                    day["units"] = round(day["units"] + units, 2)
                plays.append({
                    "date": game["date"], "id": pid, "name": name, "team": team, "opp": game["home"] if team == game["away"] else game["away"], "home": team == game["home"],
                    "side": play["side"], "line": line, "price": play["price"], "edge": round(play["edge"], 3), "size": size, "fade": play["fade"],
                    "mean": mean, "chance": chance, "actual": actual, "won": won, "units": round(units, 2),
                })
    for bucket in out["honest"]:
        bucket["said"] = round(bucket["said"], 2)
    clv_done(out["clv"])
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    out["ledger"] = record_ledger(plays)
    latest = set(sorted({play["date"] for play in plays})[-POINTS_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out


def points_file(season: int, generated_at: str, records: list, goals, games: list, lineups: dict, injuries: dict, previous: dict | None,
                now_utc: datetime, tonight: dict | None, skaters: dict, goalies: dict, player_odds: dict, record_dir: Path) -> dict:
    """site/nhl/points.json: the board, the rules and the record. `goals` =
    the goals model the Goals page was built from."""
    model = points_model_for(records, goals)
    board = points_board(model, games, lineups, injuries, records, previous, now_utc, tonight, skaters, goalies, player_odds)
    try:
        record_point_games(record_dir, board, games)
        record = points_record_summary(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Points record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    return {"season": season, "generated_at": generated_at, "weights": model.w, "calibration": list(model.calibration), "edges": POINTS_EDGES, "bar": POINTS_BAR, "unsure": UNSURE_EDGE,
            "factors": POINTS_FACTORS, "games": board, "record": record}
