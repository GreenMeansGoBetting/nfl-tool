"""The Shots page's data for the NHL build: the board, the defense table, the
graded record. The model itself is shots_model.py.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import shots_model
from nhl_games import AREAS, OUT_STATUSES, plain
from nhl_stats import num
from nhl_prices import CLV_COLS, break_even, clv_add, clv_done, clv_move, clv_tally, novig_prices, ou_looks, ou_nv_col
from nhl_records import factor_values, record_ledger
# The Shots page projects games through this many days out (books post
# shots-on-goal lines about a day ahead) and keeps the chance of 1+ ... 8+.
SHOTS_DAYS_AHEAD = 2
SHOTS_LADDER = 8
# An edge is the model's chance minus the chance the price needs to break
# even. SHOTS_EDGES still sizes the every-book price tags (book-odds.js) and
# Best Plays' Goals / Points cutoff; the Shots plays themselves use SHOTS_BAR.
SHOTS_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
# The Shots bar (the owner, 2026-10-19, after an audit of every graded play):
# a play is shown or left out, no "lean" and no "check". Shown = an edge of
# SHOTS_BAR or more on a player NOT moved down a line tonight. On the first six
# nights, edges of 3-6 went 50-72 and moved-down players lost on both sides
# (38-56) in both halves; the bar's plays went 154-117, +6.5% (in sample).
# A gap of 12+ is no longer set apart (those went 53-43), and an under on a
# player moved UP is a play (45-23). Points and Goals keep their buckets until
# they have more games graded.
SHOTS_BAR = 0.06
# The safety net, every NHL prop (the owner, 2026-10-22): an edge this big
# means the model is missing something, not that the book is 25 points off.
# Jake Sanderson's u0.5 points (+47.3) and u2.5 shots (+37.7) on 2026-10-21
# were the only two Shots / Points plays past it; both lost. Such a play is
# "unsure": listed, never a play, never in the plays' record (its own bucket).
UNSURE_EDGE = 0.25
# The Shots page lists the graded plays of the latest days that have any (the
# buckets and the day-by-day line cover the whole season; listing every play
# of a season would make shots.json a megabyte heavier by spring).
SHOTS_RECORD_DAYS = 14
# Every graded play, one file a month (2026-10.json ...), committed by the
# deploy like the NFL model's record so it survives anything the site loses.
SHOTS_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_shots"
# The same for every graded Shots play and every priced Goals player (the
# owner, 2026-10-16: Shots and Goals "up to the Points record's standard"):
# who he is and his usage, tonight's line, home and rest days, `vs_avg`
# (tonight's number minus his season average a game), where he shoots
# (`s_*`, his share from each rink area), and each matchup piece's lift
# (`l_*`, 1.06 = +6%). tools/nhl_factor_report.py groups the record by them.
SHOTS_FACTORS = ("pos", "games", "avg", "vs_avg", "minutes", "pp_share", "slot", "move", "home", "rest", "opp_rest",
                 "s_low_slot", "s_slot", "s_left", "s_right", "s_point", "s_long",
                 "l_opp", "l_pos", "l_area", "l_pp", "l_line", "l_home", "l_b2b", "l_opp_b2b")


# ---- the Shots page ----
def shots_model_for(records: list):
    """The shots-on-goal model fed every finished game of this season, and
    nothing from last season (the owner's rule: see shots_model.py)."""
    model = shots_model.ShotsModel()
    for record in records:
        model.add_game(record)
    return model


def line_move(slot: str | None, usual_slot: str | None) -> str | None:
    """"up" when tonight's line is above the one his own minutes say he has
    been on ("F1" against "F3"), "down" when below, None when it is the same
    or no lineup is posted."""
    if not slot or not usual_slot or slot[0] != usual_slot[0] or slot[1:] == usual_slot[1:]:
        return None
    return "up" if int(slot[1:]) < int(usual_slot[1:]) else "down"


def shot_row(model, player: dict, opp: str, home: bool, rest, opp_rest, out: bool, slot: str | None = None) -> dict | None:
    """One skater's projection for one game, with what it is made of. `slot`
    = his line or pair in the NHL's projected lineup ("F1" ... "D3"), when
    one is posted: the projection then moves with tonight's line."""
    proj = model.project(player["id"], opp, home, rest, opp_rest, player["team"], slot)
    if proj is None:
        return None
    usual = proj["base"] * math.exp(model.w["scale"])
    games = proj["games"]
    usual_slot = model.usual_slot(player["id"], player["team"])
    return {
        "id": player["id"], "name": player["name"], "team": player["team"], "opp": opp, "home": home, "pos": player["pos"], "out": out,
        # What his game log says, plain: shots on goal a game this season.
        "games": games, "avg": round(proj["season"]["sog"] / games, 2) if games else None,
        # mean = usual x matchup: his shot rate in tonight's minutes, then what tonight changes.
        "mean": round(proj["mean"], 2), "usual": round(usual, 2), "matchup": round(proj["mean"] / usual, 3) if usual else 1.0,
        # Tonight's line, the one his own minutes say he has been on, what tonight's line
        # plays, and whether that is a move up or down.
        "slot": slot, "usual_slot": usual_slot, "line_minutes": num(proj["line_minutes"], 1), "move": line_move(slot, usual_slot),
        "rest": rest, "opp_rest": opp_rest,
        "minutes": round(proj["minutes"], 1), "rate60": round(proj["rate"]["per_min"] * 60, 2), "att60": round(proj["rate"]["attempts"] * 60, 1),
        "thru": round(proj["rate"]["thru"], 3), "pp_share": round(proj["pp_share"], 3),
        "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "shares": {area: round(share, 3) for area, share in proj["shares"].items()},
        # The chance of 1 or more, 2 or more ... shots on goal.
        "chances": [round(shots_model.chance_at_least(proj["mean"], n), 3) for n in range(1, SHOTS_LADDER + 1)],
    }


def shots_defense(model, teams) -> dict:
    """{team: {stat: what its defense allows a game}} for the stats the
    model reads: this season's number and where it ranks (`season_rank`,
    1 = allows the most), the steadied number the model uses (`blend`: this
    season mixed with a league-average defense, and its `rank`), and the
    league's number."""
    stats = ["sog", "f_sog", "d_sog", "pp_unb", *(f"a_{area}" for area in AREAS)]
    out = {team: {key: model.allowed(team, key) for key in stats} for team in teams}
    games_played = {team: (model.teams.get(team) or {}).get("games", 0) for team in teams}
    for key in stats:
        order = sorted(out, key=lambda team: -out[team][key]["blend"])
        # The rank a person would quote: this season's own number, most allowed first.
        plain = sorted(out, key=lambda team: -(out[team][key]["season"] or 0))
        for team in out:
            row = out[team][key]
            out[team][key] = {
                "season": num(row["season"]), "blend": num(row["blend"]), "league": num(row["league"]),
                "factor": num(row["factor"], 3), "rank": order.index(team) + 1, "season_rank": plain.index(team) + 1, "games": games_played[team],
            }
    return out


def shots_board(model, games: list, lineups: dict, injuries: dict, records: list, previous: dict | None, now_utc: datetime, tonight: dict | None = None, skaters: dict | None = None, player_odds: dict | None = None) -> dict:
    """{game id: {"locked", "players": [rows]}} for the Shots page. A game
    that hasn't started gets fresh projections; one that has started keeps
    the last build's (the same lock as the lines: a projection made after
    puck drop would already know the game), and a finished one gets each
    player's real shots on goal next to it.

    Who is projected: the skaters in the NHL's projected lineup for the game
    (`tonight`: fetch_lineups), each on the line it lists him on. Until that
    is posted: the team's usual lineup by ice time (`lineups`), less anyone
    ESPN lists as out.

    `first_sog` = the first main line and prices the site saw for him
    ({line, over, under}, carried from the live shots.json), for the
    record's closing line value."""
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
                entry["players"] = [{**row, "actual": (record["skaters"].get(row["id"]) or {}).get("sog")} for row in kept["players"]]
            out[g["game_id"]] = entry
            continue
        if g["date"] > last_day:
            continue
        rows, posted = [], (tonight or {}).get(g["game_id"]) or {}
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            slots = (posted.get(team) or {}).get("skaters")
            if slots:
                # The lineup is posted: exactly the skaters it lists (a scratch or an injury isn't in it).
                dressed = [(skaters[pid], slot, False) for pid, slot in slots.items() if pid in (skaters or {})]
            else:
                out_ids = {p["id"] for p in injuries.get(team) or [] if p.get("id") and p.get("status") in OUT_STATUSES}
                dressed = [(player, None, player["id"] in out_ids) for player in lineups.get(team) or []]
            seen = {row["id"]: row.get("first_sog") for row in (prev_games.get(g["game_id"]) or {}).get("players") or []}
            seen_nv = {row["id"]: row.get("first_nv") for row in (prev_games.get(g["game_id"]) or {}).get("players") or []}
            for player, slot, is_out in dressed:
                row = shot_row(model, {**player, "team": team}, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), is_out, slot)
                if row:
                    market = (((player_odds or {}).get(g["game_id"]) or {}).get(player["id"]) or {}).get("sog")
                    row["first_sog"] = seen.get(player["id"]) or ({k: market.get(k) for k in ("line", "over", "under")} if market else None)
                    row["nv"] = novig_prices(market)
                    row["first_nv"] = seen_nv.get(player["id"]) or row["nv"]
                    rows.append(row)
        if rows:
            out[g["game_id"]] = {"locked": False, "posted": posted.get("posted"), "players": sorted(rows, key=lambda row: -row["mean"])}
    return out


def shots_play(chance_over: float, line: float, over, under, avg=None, move=None, edges: dict | None = None) -> dict | None:
    """The side of a main line the model likes more, at the book's price
    (the page's "Best side": shots.js pickSide).
    `fade` = the play goes against his own season average (an under on a line
    he averages more than, or the other way round): the model thinks a small
    sample has run hot or cold.
    `size` = how the page files it. Shots (no `edges`): "play" at an edge of
    SHOTS_BAR or more on a player not moved down a line tonight, else "none".
    Points (`edges` = POINTS_EDGES): "strong" / "lean" / "none" by the edge,
    or "check" (set apart, not a play) when the gap is too big to take at face
    value OR the play goes against tonight's line change: an under on a
    player moved up a line (`move` "up"), an over on one moved down.
    Either way, "unsure" from UNSURE_EDGE up (the safety net)."""
    sides = [(side, price, chance) for side, price, chance in (("over", over, chance_over), ("under", under, 1 - chance_over)) if price is not None]
    if not sides:
        return None
    side, price, chance = max(sides, key=lambda x: x[2] - break_even(x[1]))
    edge = chance - break_even(price)
    fade = avg is not None and (avg > line if side == "under" else avg < line)
    against_move = move == ("up" if side == "under" else "down")
    if edges is None:
        size = "play" if edge >= SHOTS_BAR and move != "down" else "none"
    else:
        size = next((key for key in ("check", "strong", "lean") if edge >= edges[key]), "none")
        if against_move and size != "none":
            size = "check"
    if edge >= UNSURE_EDGE:
        size = "unsure"
    return {"side": side, "line": line, "price": price, "chance": chance, "edge": edge, "fade": fade, "against_move": against_move, "size": size}


SHOTS_RECORD_COLS = ("id", "name", "team", "line", "over", "under", "mean", "chance_over", "actual", "avg", "move",
                     "first_line", "first_over", "first_under", "factors", "nv")


def shot_factors(row: dict) -> list:
    return factor_values(row, SHOTS_FACTORS, row.get("avg"))


def record_finished_games(folder: Path, board: dict, player_odds: dict, games: list) -> int:
    """Adds each newly finished game to the record: every player who had a
    main shots-on-goal line and played, with the projection and the prices
    that were locked before puck drop, his real shots on goal, and the parts
    behind his number (`factors`, SHOTS_FACTORS order: what "learning which
    factors win" reads; rows saved before 2026-10-16 end without it). A game
    is written once and never changed. Returns how many were added."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = []
            for row in entry["players"]:
                market = ((player_odds.get(g["game_id"]) or {}).get(row["id"]) or {}).get("sog")
                need = math.floor(market["line"]) + 1 if market else 0
                if not market or row.get("actual") is None or not 1 <= need <= len(row["chances"]):
                    continue
                first = row.get("first_sog") or {}
                plays.append([row["id"], row["name"], row["team"], market["line"], market.get("over"), market.get("under"), row["mean"], row["chances"][need - 1], row["actual"], row.get("avg"), row.get("move"),
                              first.get("line"), first.get("over"), first.get("under"), shot_factors(row), ou_nv_col({**row, "nv": novig_prices(market)})])
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "plays": plays}
        if len(saved["games"]) > before:
            saved.update(cols=SHOTS_RECORD_COLS, factors=SHOTS_FACTORS, nv=CLV_COLS["ou"])  # older rows are just shorter
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def shots_record_summary(folder: Path) -> dict:
    """The record so far, by how big the edge was when the game locked:
    wins, losses and units won risking 1 unit a play at the locked price.
    `fade` / `with` split the called plays by whether they went against the
    player's own season average: the record of "the model doesn't believe his
    hot (or cold) start" next to everything else.

    Also the plays themselves (the owner, 2026-10-13: "a way to see plays that
    declared any edge and have a record of it, possibly grouped into buckets"):
    `days` = every day's tally of the plays (shots_play's "play": the bar),
    oldest first, and `plays` = each graded play on the latest
    SHOTS_RECORD_DAYS days, newest day first and biggest edge first within a
    day. Every saved game is graded by today's bar, the games before it too."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "play": tally(), "none": tally(), "unsure": tally(), "over": tally(), "under": tally(), "fade": tally(), "with": tally(),
           "clv": clv_tally()}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, line, over, under, mean, chance_over, actual, *rest in game["plays"]:
                # Rows saved before these were kept have none of them.
                avg, move, first_line, first_over, first_under, _factors, nv = (*rest, None, None, None, None, None, None, None)[:7]
                play = shots_play(chance_over, line, over, under, avg, move)
                if play is None or actual == line:
                    continue
                won = (actual > line) == (play["side"] == "over")
                units = (100 / -play["price"] if play["price"] < 0 else play["price"] / 100) if won else -1.0
                size = play["size"]
                # Overs against unders, and plays against his season average
                # ("fade") against plays with it: only the plays.
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
                    "mean": mean, "actual": actual, "won": won, "units": round(units, 2),
                })
    clv_done(out["clv"])
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    out["ledger"] = record_ledger(plays)
    latest = set(sorted({play["date"] for play in plays})[-SHOTS_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out
