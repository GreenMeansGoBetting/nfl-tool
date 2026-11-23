"""The Goals page's data for the NHL build: the board, the defense table, the graded
record and goals.json. The model itself is goals_model.py.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import goals_model
import shots_model
from nhl_games import AREAS, OUT_STATUSES
from nhl_stats import num
from nhl_prices import BEST_PRICES_FROM, CLV_COLS, break_even, clv_add, clv_done, clv_move, clv_tally, novig_goal_prices
from nhl_records import factor_values, record_ledger
from shots_page import SHOTS_DAYS_AHEAD, UNSURE_EDGE, line_move
# The Goals page (anytime goal scorer): edges in points of chance, the Shots
# page's buckets. Goal prices are long (most +150 to +900), so a 3-point edge
# at 25% is about a 12% return; telling that from luck takes ~900 plays, which
# is why the record also grades closing line value (goals_record_summary).
GOALS_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
GOALS_RECORD_DAYS = 14
GOALS_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_goals"
GOALS_HONEST = (0.0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 1.01)  # the record's "said vs scored" buckets
GOALS_FACTORS = ("pos", "games", "goals", "xg", "vs_avg", "minutes", "ev_min", "pp_min", "slot", "move", "home", "rest", "opp_rest", "zone",
                 "s_low_slot", "s_slot", "s_left", "s_right", "s_point", "s_long",
                 "l_opp", "l_goalie", "l_finish", "l_line", "l_home", "l_b2b", "l_opp_b2b", "l_split", "l_onetimer", "l_low")


def goal_factors(row: dict) -> list:
    games = row.get("games")
    return factor_values(row, GOALS_FACTORS, row["goals"] / games if games and row.get("goals") is not None else None)


# ---- Goals (anytime goal scorer; goals_model.py) ----
def goals_model_for(records: list, shots: "shots_model.ShotsModel", hand: dict) -> "goals_model.GoalsModel":
    """The goals model on this season's games only: both expected-goals
    tables fitted on this season's shots, then every game added."""
    model = goals_model.GoalsModel(shots, hand)
    model.fit(records)
    for record in records:
        model.add_game(record)
    return model


def expected_goalie(team: str, posted: dict, goalies: dict) -> str | None:
    """Tonight's goalie for `team`: the NHL's projected lineup's when it is
    posted (a projection, never called confirmed), else the team's busiest
    starter this season."""
    goalie = (posted.get(team) or {}).get("goalie")
    if goalie and str(goalie).isdigit():
        return str(goalie)
    listed = goalies.get(team) or []
    return str(listed[0]["id"]) if listed and listed[0].get("id") else None


def goals_play(chance: float, odds, move=None) -> dict | None:
    """The anytime goal at the book's Yes price: the edge (model chance minus
    the chance the price needs to break even) and how the page files it,
    the Shots page's way: "strong" / "lean" / "none", or "check" (set
    apart) when the gap is too big to take at face value or he has been
    moved DOWN a line tonight (his games so far describe a bigger role)."""
    if odds is None or chance is None:
        return None
    edge = chance - break_even(odds)
    size = next((key for key in ("check", "strong", "lean") if edge >= GOALS_EDGES[key]), "none")
    against_move = move == "down"
    if against_move and size != "none":
        size = "check"
    if edge >= UNSURE_EDGE:
        size = "unsure"
    return {"price": odds, "chance": chance, "edge": edge, "size": size, "against_move": against_move}


def goal_row(model, player: dict, opp: str, home: bool, rest, opp_rest, out: bool, slot, goalie, ranks: dict, odds: dict | None, first_odds, first_nv=None) -> dict | None:
    """One skater's anytime-goal projection for one game, what it is made
    of, the Zone Match tag, and the book's price (with the first price seen)."""
    proj = model.project(player["id"], opp, home, rest, opp_rest, player["team"], slot, goalie)
    if proj is None:
        return None
    usual_slot = model.shots.usual_slot(player["id"], player["team"])
    move = line_move(slot, usual_slot)
    season = proj["season"]
    price = (odds or {}).get("odds")
    play = goals_play(proj["chance"], price, move)
    return {
        "id": player["id"], "name": player["name"], "team": player["team"], "opp": opp, "home": home, "pos": player["pos"], "out": out,
        "slot": slot, "usual_slot": usual_slot, "move": move, "goalie": goalie, "rest": rest, "opp_rest": opp_rest,
        # What his season says, plain.
        "games": season.get("games", 0), "goals": season.get("goals", 0), "xg": round(season.get("xg", 0.0), 2), "shots": season.get("shots", 0),
        "minutes": round(proj["minutes"], 1), "ev_min": round(proj["ev_min"], 1), "pp_min": round(proj["pp_min"], 1), "xg60": round(proj["rate60"], 3),
        # Tonight: expected goals, the chance of 1+, its fair price, what each piece did.
        "mean": round(proj["mean"], 3), "chance": round(proj["chance"], 3), "fair": shots_model.fair_american(proj["chance"]),
        "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "shares": {area: round(share, 3) for area, share in proj["shares"].items()},
        "zone": model.zone_match(player["id"], opp, ranks),
        "odds": price, "no_odds": (odds or {}).get("no_odds"), "thin": (odds or {}).get("thin"),
        "first_odds": first_odds if first_odds is not None else price,
        # Novig's own Yes / No now and at the first look (closing line value).
        "nv": novig_goal_prices(odds), "first_nv": first_nv or novig_goal_prices(odds),
        "edge": round(play["edge"], 3) if play else None, "size": play["size"] if play else None,
    }


def goals_board(model, games: list, lineups: dict, injuries: dict, records: list, previous: dict | None, now_utc: datetime,
                tonight: dict | None, skaters: dict | None, goalies: dict, player_odds: dict) -> dict:
    """{game id: {"locked", "players": [rows]}} for the Goals page: the same
    games, players and lock as the Shots page (shots_board). Every skater is
    projected, with a price or not (the owner: Novig has no liquidity on
    every player; the fair price is there to shop). A started game keeps the
    last build's rows; a finished one gets each player's real goals."""
    prev_games = (previous or {}).get("games") or {}
    finished = {str(r["id"]): r for r in records}
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    ranks = {area: model.area_ranks(area) for area in goals_model.ZONE["areas"]}
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
                entry["players"] = [{**row, "actual": (record["skaters"].get(row["id"]) or {}).get("g")} for row in kept["players"]]
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
                mine = (odds.get(player["id"]) or {}).get("goal")
                first = (seen.get(player["id"]) or {}).get("first_odds")
                first_nv = (seen.get(player["id"]) or {}).get("first_nv")
                row = goal_row(model, {**player, "team": team}, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), is_out, slot, goalie, ranks, mine, first, first_nv)
                if row:
                    rows.append(row)
        if rows:
            out[g["game_id"]] = {"locked": False, "posted": posted.get("posted"), "players": sorted(rows, key=lambda row: -row["chance"])}
    return out


GOALS_RECORD_COLS = ("id", "name", "team", "chance", "mean", "odds", "first_odds", "thin", "zone", "actual", "move", "factors", "nv")


def record_goal_games(folder: Path, board: dict, games: list) -> int:
    """Adds each newly finished game to the Goals record: every projected
    player who played (priced or not, so the chances and the Zone Match tag
    can be graded on everyone), with the chance and the prices locked before
    puck drop, the first price the site saw (for closing line value), and
    the game's locked total and moneylines (to test the market as an anchor
    later), and for a priced player the parts behind his number (`factors`,
    GOALS_FACTORS order; rows saved before 2026-10-16 end without it).
    Written once, never changed. Returns how many games were added."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": GOALS_RECORD_COLS, "games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = [[row["id"], row["name"], row["team"], row["chance"], row["mean"], row.get("odds"), row.get("first_odds"), row.get("thin"),
                      (row.get("zone") or {}).get("area"), row["actual"], row.get("move"), goal_factors(row) if row.get("odds") is not None else None,
                      [(row.get("first_nv") or {}).get("yes"), (row.get("first_nv") or {}).get("no"), (row.get("nv") or {}).get("yes"), (row.get("nv") or {}).get("no")]]
                     for row in entry["players"] if row.get("actual") is not None]
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"],
                                                "market": {k: g.get(k) for k in ("total_line", "away_ml_implied_prob", "home_ml_implied_prob")}, "plays": plays}
        if len(saved["games"]) > before:
            saved.update(cols=GOALS_RECORD_COLS, factors=GOALS_FACTORS, nv=CLV_COLS["goal"])  # older rows are just shorter
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def goals_record_summary(folder: Path) -> dict:
    """The Goals record so far.
      * By edge bucket (strong / lean / none / check), the Zone Match tag
        (`zone`) and thin prices (`thin`): wins, losses and units risking 1
        a play at the locked Yes price.
      * `clv`: closing line value on the called plays (lean + strong): how
        far the price moved from the first one the site saw to the locked one,
        in points of chance (+ = shortened, the market moved to the model).
        Hundreds of plays say more here than a season of wins and losses.
      * `honest`: every graded player (priced or not) by what the model said
        against how often he scored; `zone_all` the same for every tagged player.
      * `days` and `plays` (latest GOALS_RECORD_DAYS days), as the Shots record."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "players": 0, **{k: tally() for k in ("strong", "lean", "none", "check", "unsure", "zone", "thin")},
           "clv": clv_tally(),
           "honest": [{"lo": lo, "hi": hi, "players": 0, "said": 0.0, "scored": 0} for lo, hi in zip(GOALS_HONEST, GOALS_HONEST[1:])],
           "zone_all": {"players": 0, "said": 0.0, "scored": 0}}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, chance, mean, odds, first_odds, thin, zone, actual, move, *more in game["plays"]:
                nv = more[1] if len(more) > 1 else None
                scored = actual > 0
                out["players"] += 1
                for bucket in out["honest"]:
                    if bucket["lo"] <= chance < bucket["hi"]:
                        bucket["players"] += 1
                        bucket["said"] += chance
                        bucket["scored"] += scored
                if zone:
                    out["zone_all"]["players"] += 1
                    out["zone_all"]["said"] += chance
                    out["zone_all"]["scored"] += scored
                play = goals_play(chance, odds, move)
                if play is None:
                    continue
                units = (100 / -odds if odds < 0 else odds / 100) if scored else -1.0
                size = play["size"]
                for key in (size, *(["zone"] if zone else []), *(["thin"] if thin else [])):
                    out[key]["wins" if scored else "losses"] += 1
                    out[key]["units"] = round(out[key]["units"] + units, 2)
                if size in ("none", "unsure"):
                    continue
                if size in ("strong", "lean"):
                    day = days.setdefault(game["date"], tally())
                    day["wins" if scored else "losses"] += 1
                    day["units"] = round(day["units"] + units, 2)
                    # Closing line value on Novig's own Yes / No (clv_move); before
                    # BEST_PRICES_FROM the saved prices were Novig's Yes alone.
                    if nv and nv[0] is not None:
                        first, lock = {"line": 0.5, "over": nv[0], "under": nv[1]}, {"line": 0.5, "over": nv[2], "under": nv[3]}
                    elif game["date"] < BEST_PRICES_FROM and first_odds is not None:
                        first, lock = {"line": 0.5, "over": first_odds}, {"line": 0.5, "over": odds}
                    else:
                        first = lock = None
                    clv_add(out["clv"], game["date"], *clv_move(first, lock, "over", "under"))
                plays.append({
                    "date": game["date"], "id": pid, "name": name, "team": team, "opp": game["home"] if team == game["away"] else game["away"], "home": team == game["home"],
                    "price": odds, "first": first_odds, "chance": chance, "edge": round(play["edge"], 3), "size": size, "zone": zone, "thin": thin,
                    "actual": actual, "won": scored, "units": round(units, 2),
                })
    for bucket in out["honest"]:
        bucket["said"] = round(bucket["said"], 2)
    out["zone_all"]["said"] = round(out["zone_all"]["said"], 2)
    clv_done(out["clv"])
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    out["ledger"] = record_ledger(plays)
    latest = set(sorted({play["date"] for play in plays})[-GOALS_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out


def goals_defense(model, teams) -> dict:
    """{team: what its defense allows: expected goals a game (`season`, the
    steadied `blend` the model reads, `factor` against the league, `rank`
    1 = allows the most), and shots a game from the low slot and the slot with
    their ranks (what the Zone Match tag reads)}."""
    out = {team: {"xg": model.allowed(team, "xg")} for team in teams}
    order = sorted(out, key=lambda team: -out[team]["xg"]["blend"])
    for area in goals_model.ZONE["areas"]:
        ranks = model.area_ranks(area)
        for team in out:
            t = model.teams.get(team) or {}
            out[team][area] = {"season": num(t.get(f"n_{area}", 0) / t["games"]) if t.get("games") else None, "rank": ranks.get(team)}
    for team in out:
        row = out[team]["xg"]
        out[team]["xg"] = {"season": num(row["season"]), "blend": num(row["blend"]), "factor": num(row["factor"], 3), "rank": order.index(team) + 1}
    return out


def goals_file(season: int, generated_at: str, records: list, shots, games: list, lineups: dict, injuries: dict, previous: dict | None,
               now_utc: datetime, tonight: dict | None, skaters: dict, goalies: dict, player_odds: dict, record_dir: Path, model=None) -> dict:
    """site/nhl/goals.json: the board, the rules, the expected-goals tables and
    the record. `model` = the goals model already built (main shares it with
    the Points page); None builds it here."""
    if model is None:
        model = goals_model_for(records, shots, goals_hand(skaters))
    board = goals_board(model, games, lineups, injuries, records, previous, now_utc, tonight, skaters, goalies, player_odds)
    try:
        record_goal_games(record_dir, board, games)
        record = goals_record_summary(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Goals record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    lg = model.league
    return {
        "season": season, "generated_at": generated_at, "weights": model.w, "edges": GOALS_EDGES, "unsure": UNSURE_EDGE, "zone": goals_model.ZONE,
        "xg": {"names": goals_model.XG_NAMES, "base": model.xg[False], "wing": model.xg[True], "shots": sum(lg[f"n_{a}"] for a in AREAS)},
        "league": {"goals_per_shot": num(lg["g"] / sum(lg[f"n_{a}"] for a in AREAS), 4) if lg["g"] else None, "xg_per_team_game": num(lg["xg"] / lg["team_games"]) if lg["team_games"] else None},
        "games": board, "defense": goals_defense(model, list(model.teams)), "record": record,
    }


def goals_hand(skaters: dict) -> dict:
    """{player id: "L" / "R"}: which way he shoots (the off-wing column)."""
    return {pid: s.get("shoots") for pid, s in skaters.items() if s.get("shoots")}
