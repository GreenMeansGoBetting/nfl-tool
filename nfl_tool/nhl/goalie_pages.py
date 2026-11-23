"""King of the Crease and the Saves page for the NHL build: the expected starter,
the boards, the graded records, crease.json and saves.json. The model itself is
saves_model.py.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import saves_model
import shots_model
from nhl_games import plain
from nhl_stats import lineup, num, ratio
from nhl_prices import CLV_COLS, clv_add, clv_done, clv_move, clv_tally, novig_prices, ou_looks, ou_nv_col
from nhl_records import record_ledger
from shots_page import SHOTS_DAYS_AHEAD, UNSURE_EDGE, shots_play
# King of the Crease (DraftKings' promo: the goalie with the most saves of the
# day wins). The board covers the same days as the Shots page.
#   blend   how far a goalie's chance to lead the day leans on the model's own
#           projection once the season has depth; the rest is the book's
#           line, which knows things the model can't (who is hurt, what a
#           team was before this season)
#   full_games  ...reached when both teams have played this many games. Before
#           that the model counts for less, in step: in the replay its edge
#           over "every goalie is average" was a quarter of its full size in
#           a season's first two weeks and whole by about game 20.
#   value   the Value tag: his chance to lead the day is at least this many
#           times what it would be if he were exactly what his line says
#   floor   ...and at least this share of an even split of the day (half of
#           1 in 20 on a ten-game day), so a no-hoper doubling to 2% isn't one
#   check   model and line this many saves apart: more often news the model
#           can't see than a gift. Marked, never tagged.
#   upside  the Upside tag: the day's best chances, this many at most (one
#           for every four starters on a short slate)
#   big_night  the save total the "big night" chance is quoted at (the day's
#           best averaged 36.7 saves in the replay)
CREASE_RULES = {"blend": 0.5, "full_games": 20, "value": 1.15, "floor": 0.5, "check": 4.0, "upside": 3, "big_night": 35}
# Every finished day, one file a month, committed by the deploy like the Shots record.
CREASE_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_crease"
CREASE_RECORD_COLS = ("id", "name", "team", "opp", "mean", "line", "over", "under", "mkt_mean", "blend", "top", "mkt_top", "tags", "actual")
# The Saves page (goalie saves over / under; saves.json, from King of the
# Crease's board): the Points page's buckets, plus "check" when the model and
# the line are CREASE_RULES["check"] saves apart.
SAVES_EDGES = {"lean": 0.03, "strong": 0.06, "check": 0.12}
SAVES_RECORD_DAYS = 14
SAVES_RECORD_DIR = Path(__file__).resolve().parent.parent.parent / "model_history" / "nhl_saves"
SAVES_HONEST = (0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01)  # the record's "said vs went over" buckets
SAVES_RECORD_COLS = ("id", "name", "team", "line", "over", "under", "mean", "chance_over", "mkt_mean", "actual", "avg",
                     "first_line", "first_over", "first_under", "factors", "nv")
SAVES_FACTORS = ("starts", "saves_avg", "sv_pct", "opp_shots", "opp_shots_rank", "allowed", "allowed_rank", "home", "b2b", "opp_b2b",
                 "source", "gap", "l_off", "l_def", "l_home", "l_b2b", "l_opp_b2b", "l_sv")


# ---- King of the Crease (the Promo Tools page) ----
def saves_model_for(records: list):
    """The saves model fed every finished game of this season, and nothing
    from last season (the owner's rule for the NHL prop tools)."""
    model = saves_model.SavesModel()
    for record in records:
        model.add_game(record)
    return model


def last_starters(records: list) -> dict:
    """{team: the id of the goalie who started its latest game}."""
    out = {}
    for record in records:  # in date order
        for pid, line in record["goalies"].items():
            if line["start"]:
                out[line["team"]] = pid
    return out


def crease_starter(posted: dict | None, listed: list, team_goalies: list, all_goalies: dict, rest, last_start) -> dict:
    """Who should start in net for a team tonight. NOTHING the site can read
    is a confirmation: starters are official at warmups, and no feed carries
    that. There are two outside sources, and each is one opinion:
      * the first goalie in the NHL's projected lineup for the game. Right
        92% of the time in 2025-26 (2,378 of 2,583), written around midday,
        sometimes with no morning skate to go on. When it named the goalie
        who had started the night before, it was right 55% of the time.
      * the goalie the book has a saves line for. Books post the expected
        starter and take the line down when that changes.
    `source` says how much stands behind the name:
      "both"    the two agree (the page's check mark)
      "split"   they name different goalies: the book's is shown, since it
                is the later and the one with money behind it, and `other`
                carries the name the NHL's lineup has (Jake Allen against
                Nico Daws, New Jersey, 2026-10-13: the book was right)
      "lineup" / "market"   only one of them has spoken
      "usual"   neither: the goalie with the most starts this season, or the
                other one on the second night of a back-to-back he started
                the first night of
    `doubt` = the lineup alone names the goalie who started last night.
    Returns {"id" (None for a goalie with no game this season), "name" (None
    when nobody can be named), "source", "other", "doubt"}. The promo moves a
    pick to whoever does start for the team, so a wrong name never changes
    whose saves count; it must still never be shown as settled."""
    usual = team_goalies[0] if team_goalies else None
    if usual and rest == 1 and last_start == usual["id"] and len(team_goalies) > 1:
        usual = team_goalies[1]

    def named(who, name=None):
        """{"id", "name"} for an id the site knows, or a goalie it doesn't (by the name given)."""
        known = all_goalies.get(who)
        return {"id": known["id"] if known else None, "name": known["name"] if known else name or who}

    same = lambda a, b: bool(a and b) and ((a["id"] and a["id"] == b["id"]) or plain(a["name"]) == plain(b["name"]))
    lineup = named(posted["goalie"]) if posted and posted.get("goalie") else None
    # Two goalies listed for one team: the one the lineup has, else the usual starter, else the first.
    priced = [named(row["id"], row["name"]) for row in listed]
    market = next((g for g in priced if same(g, lineup)), None) or next((g for g in priced if usual and g["id"] == usual["id"]), None) or (priced[0] if priced else None)
    if lineup and market:
        if same(lineup, market):
            return {**market, "source": "both", "other": None, "doubt": False}
        return {**market, "source": "split", "other": lineup["name"], "doubt": False}
    if lineup:
        return {**lineup, "source": "lineup", "other": None, "doubt": rest == 1 and bool(lineup["id"]) and lineup["id"] == last_start}
    if market:
        return {**market, "source": "market", "other": None, "doubt": False}
    return {"id": usual["id"] if usual else None, "name": usual["name"] if usual else None, "source": "usual", "other": None, "doubt": False}


def crease_line(starter: dict, listed: list) -> dict | None:
    """The book's saves line for that goalie, if it lists him."""
    for row in listed:
        if (starter["id"] and row["id"] == starter["id"]) or (starter["name"] and plain(row["name"]) == plain(starter["name"])):
            return row
    return None


def crease_team_ranks(model) -> dict:
    """{team: {"shots": rank, "allowed": rank}}: where each team ranks this
    season for shots on goal a game (1 = the most) and for shots on goal
    allowed a game (1 = allows the most). Either way 1 = more work for a goalie."""
    out = {team: {} for team in model.teams}
    for key, side in (("shots", "for"), ("allowed", "against")):
        order = sorted(model.teams, key=lambda team: -(model.team_rate(team, side, "sog")["season"] or 0))
        for team in out:
            out[team][key] = order.index(team) + 1
    return out


def crease_row(model, g: dict, team: str, opp: str, side: str, other: str, starter: dict, line: dict | None, ranks: dict) -> dict | None:
    """One team's starter for one game: his season so far, both sides of the
    matchup, the model's projection, the book's line, and the two blended."""
    proj = model.project(team, opp, side == "home", g.get(f"{side}_rest"), g.get(f"{other}_rest"), starter["id"])
    if proj is None:
        return None
    mean = proj["mean"]
    # The saves the book expects: its line and price turned back into a projection.
    mkt_mean = saves_model.mean_for_chance(line["line"], line["chance"]) if line else None
    # What his chance to lead the day is worked out from: the line, moved toward
    # the model by as much as the season so far has earned (CREASE_RULES).
    weight = CREASE_RULES["blend"] * min(1.0, min(proj["team_games"], proj["opp_games"]) / CREASE_RULES["full_games"])
    blend = weight * mean + (1 - weight) * mkt_mean if line else mean
    starts = proj["starts"]
    return {
        "game_id": g["game_id"], "team": team, "opp": opp, "home": side == "home", "locked": False,
        "id": starter["id"], "name": starter["name"], "source": starter["source"], "other": starter["other"], "doubt": starter["doubt"],
        # His season so far, as his game log says it.
        "starts": starts, "saves_avg": num(proj["start_saves"] / starts, 1) if starts else None, "sv_pct": ratio(proj["sa"] - proj["ga"], proj["sa"]), "high": proj["high"] or None,
        # Both sides of the matchup: what the other team puts on net a game, and what his own team gives up.
        "opp_shots": num(proj["off"]["season"], 1), "opp_shots_rank": (ranks.get(opp) or {}).get("shots"),
        "allowed": num(proj["def"]["season"], 1), "allowed_rank": (ranks.get(team) or {}).get("allowed"),
        "b2b": g.get(f"{side}_rest") == 1, "opp_b2b": g.get(f"{other}_rest") == 1,
        "shots": num(proj["shots"], 1), "mean": num(mean), "lift": {key: round(value, 3) for key, value in proj["lift"].items()},
        "line": line["line"] if line else None, "over": line["over"] if line else None, "under": line["under"] if line else None,
        # The book each price came from (best_saves_prices; none = Novig's own).
        "over_book": (line or {}).get("over_book"), "under_book": (line or {}).get("under_book"),
        "nv_over": (line or {}).get("nv_over", (line or {}).get("over")), "nv_under": (line or {}).get("nv_under", (line or {}).get("under")),
        "thin": line["thin"] if line else None, "alts": line["alts"] if line else [],
        "mkt_mean": num(mkt_mean), "blend": num(blend), "weight": round(weight, 3) if line else None,
        # Model and line too far apart to take at face value.
        "check": bool(line) and abs(mean - mkt_mean) >= CREASE_RULES["check"],
        "big": round(saves_model.chance_at_least(blend, CREASE_RULES["big_night"]), 3),
    }


def crease_chances(rows: list) -> None:
    """Each open row's chance to finish with the day's most saves (`top`),
    what that chance would be if he were exactly what his line says against
    the same field (`mkt_top`), and the first over the second (`value`: above
    1, the market may be underselling him). Only his own number changes
    between the two, so a value can't come from the rest of the day's goalies.
    A goalie whose game is final counts as what he made, so a late game's
    chance is the chance to catch the leader; a started game's rows keep the
    numbers they locked with."""
    spreads = [saves_model.known_spread(row["actual"]) if row.get("actual") is not None else saves_model.save_spread(row["blend"]) for row in rows]
    ceilings = [saves_model.at_most(spread) for spread in spreads]
    for i, row in enumerate(rows):
        if row["locked"]:
            continue
        field = ceilings[:i] + ceilings[i + 1:]
        chance = saves_model.lead_chance(spreads[i], field)
        line_chance = saves_model.lead_chance(saves_model.save_spread(row["mkt_mean"]), field) if row["line"] is not None else None
        row["top"] = round(chance, 4)
        row["mkt_top"] = round(line_chance, 4) if line_chance is not None else None
        row["value"] = round(chance / line_chance, 3) if line_chance else None


def crease_tags(rows: list) -> None:
    """The two tags, on the rows still open:
      "upside"  the best chances to lead the day (CREASE_RULES "upside", one
                for every four starters on a short slate)
      "value"   his chance is well above what his line alone says ("value"),
                he has a real chance to begin with ("floor"), and the gap
                isn't one to check for news first ("check")"""
    open_rows = [row for row in rows if not row["locked"]]
    best = sorted(open_rows, key=lambda row: -row["top"])[:max(1, min(CREASE_RULES["upside"], round(len(open_rows) / 4)))]
    floor = CREASE_RULES["floor"] / len(rows) if rows else 0
    for row in open_rows:
        tags = ["upside"] if any(row is top for top in best) else []
        if row["value"] is not None and row["value"] >= CREASE_RULES["value"] and row["top"] >= floor and not row["check"]:
            tags.append("value")
        row["tags"] = tags


def crease_board(model, games: list, tonight: dict | None, saves_lines: dict | None, goalies: dict, records: list, previous: dict | None, now_utc: datetime) -> dict:
    """{date: {"goalies": [rows], "final", "best"}} for King of the Crease:
    one row per team playing that day, named for its expected starter. Same
    lock as the lines: a game that has started keeps the rows of the last
    build before puck drop (with nothing saved it has no rows, never ones
    made after the puck dropped), and a finished one gets `actual`: the saves
    of the goalie who did start, which is who the promo counts. Once every
    game of a day is final, `best` is the day's top total and `led` marks who
    made it."""
    all_goalies = {row["id"]: row for rows in goalies.values() for row in rows}
    kept_rows = {(row["game_id"], row["team"]): row for day in ((previous or {}).get("days") or {}).values() for row in day.get("goalies") or []}
    finished = {str(r["id"]): r for r in records}
    last_start = last_starters(records)
    ranks = crease_team_ranks(model)
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=SHOTS_DAYS_AHEAD)).strftime("%Y-%m-%d")
    starters_in = lambda record: [line for line in record["goalies"].values() if line["start"]]
    days = {}
    for g in games:
        started = g["status"] == "final" or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc
        if not started and g["date"] > last_day:
            continue
        for team, opp, side, other in ((g["away"], g["home"], "away", "home"), (g["home"], g["away"], "home", "away")):
            if started:
                kept = kept_rows.get((g["game_id"], team))
                if not kept:
                    continue
                row = {**kept, "locked": True}
                played = next((line for line in starters_in(finished[g["game_id"]]) if line["team"] == team), None) if g["game_id"] in finished else None
                if played:
                    row["actual"], row["started"] = played["sa"] - played["ga"], played["name"]
            else:
                listed = ((saves_lines or {}).get(g["game_id"]) or {}).get(team) or []
                starter = crease_starter(((tonight or {}).get(g["game_id"]) or {}).get(team), listed, goalies.get(team) or [], all_goalies, g.get(f"{side}_rest"), last_start.get(team))
                # Tomorrow's second night of a back-to-back reads tonight's expected starter.
                last_start[team] = starter["id"]
                row = crease_row(model, g, team, opp, side, other, starter, crease_line(starter, listed), ranks)
                if not row:
                    continue
            days.setdefault(g["date"], []).append(row)
    out = {}
    for date, rows in days.items():
        crease_chances(rows)
        crease_tags(rows)
        day_games = [g for g in games if g["date"] == date]
        final = all(g["game_id"] in finished for g in day_games)
        best = max((line["sa"] - line["ga"] for g in day_games for line in starters_in(finished[g["game_id"]])), default=None) if final else None
        if final:
            for row in rows:
                if row.get("actual") is not None:
                    row["led"] = row["actual"] == best
        out[date] = {"goalies": sorted(rows, key=lambda row: -(row.get("top") or 0)), "starters": 2 * len(day_games), "final": final, "best": best}
    return out


def record_crease_days(folder: Path, board: dict) -> int:
    """Adds each finished day to the record: every goalie who had a row and
    started, with the projection, the line and the chances that were locked
    before puck drop, and what he made. A day is written once and never
    changed. Returns how many were added."""
    added = 0
    for month in sorted({date[:7] for date, day in board.items() if day["final"]}):
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": list(CREASE_RECORD_COLS), "days": {}}
        before = len(saved["days"])
        for date, day in sorted(board.items()):
            if not day["final"] or date[:7] != month or date in saved["days"]:
                continue
            rows = [[row.get(col) for col in saved["cols"]] for row in day["goalies"] if row.get("actual") is not None and row.get("top") is not None]
            if rows:
                saved["days"][date] = {"best": day["best"], "starters": day["starters"], "goalies": rows}
        if len(saved["days"]) > before:
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["days"]) - before
    return added


def crease_record_summary(folder: Path) -> dict:
    """The record so far, in the promo's own terms:
      favorite  the day's highest chance: how often he led (or tied for) the
                day, next to how often his chances said he would (`said`)
      upside    the Upside tags: days one of them led, of the days recorded
      value     the Value tags: how many led, next to what the chances said
                (`said`) and what their lines alone said (`line_said`)
      miss      on goalies with a line, the average miss in saves of the
                model, of the line, and of the two blended"""
    out = {
        "since": None, "through": None, "days": 0,
        "favorite": {"led": 0, "said": 0.0}, "upside": {"days_led": 0, "tagged": 0, "led": 0, "said": 0.0},
        "value": {"tagged": 0, "led": 0, "said": 0.0, "line_said": 0.0}, "miss": {"goalies": 0, "model": 0.0, "line": 0.0, "blend": 0.0},
    }
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in sorted(saved["days"].items()):
            rows = [dict(zip(saved["cols"], values)) for values in day["goalies"]]
            if not rows:
                continue
            out["days"] += 1
            out["since"] = min(out["since"] or date, date)
            out["through"] = max(out["through"] or date, date)
            led = lambda row: row["actual"] == day["best"]
            favorite = max(rows, key=lambda row: row["top"])
            out["favorite"]["led"] += led(favorite)
            out["favorite"]["said"] += favorite["top"]
            tagged = [row for row in rows if "upside" in (row["tags"] or [])]
            out["upside"]["days_led"] += any(led(row) for row in tagged)
            for key, group in (("upside", tagged), ("value", [row for row in rows if "value" in (row["tags"] or [])])):
                out[key]["tagged"] += len(group)
                out[key]["led"] += sum(led(row) for row in group)
                out[key]["said"] += sum(row["top"] for row in group)
            out["value"]["line_said"] += sum(row["mkt_top"] or 0 for row in rows if "value" in (row["tags"] or []))
            for row in rows:
                if row["mkt_mean"] is not None:
                    out["miss"]["goalies"] += 1
                    for key, col in (("model", "mean"), ("line", "mkt_mean"), ("blend", "blend")):
                        out["miss"][key] += abs(row["actual"] - row[col])
    n = out["miss"]["goalies"]
    for key in ("model", "line", "blend"):
        out["miss"][key] = round(out["miss"][key] / n, 2) if n else None
    for group in ("favorite", "upside", "value"):
        for key in ("said", "line_said"):
            if key in out[group]:
                out[group][key] = round(out[group][key], 2)
    return out


CREASE_HISTORY_COLS = ("id", "name", "team", "line", "top", "actual")


def crease_history(folder: Path) -> dict:
    """Every recorded day for the page's Winners list: `best`, `starters`
    and each goalie as `CREASE_HISTORY_COLS`, highest pregame chance first
    (so his place in the list is his pregame rank). The payouts DraftKings
    showed are typed in by the owner on the page (D1 `crease_payouts`), not
    here."""
    out = {}
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        saved = json.loads(path.read_text(encoding="utf-8"))
        for date, day in saved["days"].items():
            rows = sorted((dict(zip(saved["cols"], values)) for values in day["goalies"]), key=lambda row: -(row["top"] or 0))
            if rows:
                out[date] = {"best": day["best"], "starters": day["starters"], "goalies": [[row.get(col) for col in CREASE_HISTORY_COLS] for row in rows]}
    return {"cols": list(CREASE_HISTORY_COLS), "days": dict(sorted(out.items()))}


def crease_file(season: int, generated_at: str, records: list, games: list, tonight: dict | None, saves_lines: dict | None, goalies: dict, previous: dict | None, now_utc: datetime, record_dir: Path) -> dict:
    """site/nhl/crease.json: the board, the rules it was tagged by, the
    league's yardsticks and the record."""
    model = saves_model_for(records)
    board = crease_board(model, games, tonight, saves_lines, goalies, records, previous, now_utc)
    try:
        record_crease_days(record_dir, board)
        record = crease_record_summary(record_dir)
        history = crease_history(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the King of the Crease record couldn't be updated ({e}).", file=sys.stderr)
        record, history = None, None
    return {
        "season": season, "generated_at": generated_at, "weights": model.w, "rules": CREASE_RULES,
        "league": {"saves": num(model.base(), 1), "sv": num(model.league_sv(), 4), "shots": num(model.per_game("sog"), 1)},
        "days": board, "record": record, "history": history,
    }


# ---- Saves (goalie saves over / under; the Saves page) ----
# The same goalies, starters, projections and lock as King of the Crease (its
# board is the input), read the Points page's way: the model's chance of the
# over at Novig's main saves line against the better side's price. The model
# is the King of the Crease one, unblended: the promo's ranking leans on the
# line, a prop edge can't. Nothing on the page is worked out there.
CREASE_ONLY_KEYS = ("blend", "weight", "big", "top", "mkt_top", "value", "tags", "led")


def saves_play(chance_over: float, line: float, over, under, avg, mean: float, mkt_mean) -> dict | None:
    """shots_play at SAVES_EDGES, with one more "check": a called play
    where the model and what the line says are CREASE_RULES["check"] saves
    apart (most often a starter the book knows about and the model doesn't)."""
    play = shots_play(chance_over, line, over, under, avg, None, SAVES_EDGES)
    if play and play["size"] in ("strong", "lean") and mkt_mean is not None and abs(mean - mkt_mean) >= CREASE_RULES["check"]:
        play["size"] = "check"
    return play


def saves_row(row: dict, first, first_nv=None) -> dict:
    """One King of the Crease row as a saves prop: the chance of the over at
    his main line and each of its other lines, the better side, its edge and
    bucket, and the first line and prices the site saw (closing line value).
    `void` = someone else started (a book voids the bet)."""
    line = row.get("line")
    # Rounded first, so the page, the record and this row grade the same number.
    chance_over = round(saves_model.chance_over(row["mean"], line), 3) if line is not None else None
    play = saves_play(chance_over, line, row.get("over"), row.get("under"), row.get("saves_avg"), row["mean"], row.get("mkt_mean")) if line is not None else None
    chance = (play["chance"] if play else chance_over) if line is not None else None
    started = row.get("started")
    return {
        **{k: v for k, v in row.items() if k not in CREASE_ONLY_KEYS},
        "chance_over": chance_over,
        "alts": [[at, price, round(saves_model.chance_over(row["mean"], at), 3)] for at, price in row.get("alts") or []],
        "fair": shots_model.fair_american(chance) if chance is not None else None,
        "gap": round(row["mean"] - row["mkt_mean"], 1) if row.get("mkt_mean") is not None else None,
        "first": first if first is not None else ({k: row.get(k) for k in ("line", "over", "under")} if line is not None else None),
        # Novig's own line and prices now and at the first look (closing line value).
        "nv": novig_prices(row), "first_nv": first_nv or novig_prices(row),
        "side": play["side"] if play else None, "price": play["price"] if play else None,
        "edge": round(play["edge"], 3) if play else None, "size": play["size"] if play else None, "fade": play["fade"] if play else None,
        "void": bool(started) and plain(started) != plain(row.get("name") or ""),
    }


def saves_board(days: dict, previous: dict | None, records: list) -> dict:
    """{game id: {"date", "locked", "final", "goalies": [rows]}} from King of
    the Crease's board, best edge first (no line last). A row's first line
    and prices are carried from the live saves.json while it names the same
    goalie."""
    seen = {(gid, row["team"]): row for gid, g in ((previous or {}).get("games") or {}).items() for row in g.get("goalies") or []}
    finished = {str(r["id"]) for r in records}
    out = {}
    for date, day in sorted(days.items()):
        for row in day["goalies"]:
            kept = seen.get((row["game_id"], row["team"])) or {}
            same = plain(kept.get("name") or "") == plain(row.get("name") or "")
            first, first_nv = (kept.get("first"), kept.get("first_nv")) if same else (None, None)
            entry = out.setdefault(row["game_id"], {"date": date, "locked": row["locked"], "final": row["game_id"] in finished, "goalies": []})
            entry["goalies"].append(saves_row(row, first, first_nv))
    for entry in out.values():
        entry["goalies"].sort(key=lambda r: -(r["edge"] if r["edge"] is not None else -1))
    return out


def saves_factors(row: dict) -> list:
    """The parts behind a priced goalie's number, in SAVES_FACTORS order."""
    lift = row.get("lift") or {}
    value = {**{k: row.get(k) for k in SAVES_FACTORS}, "home": int(bool(row.get("home"))), "b2b": int(bool(row.get("b2b"))),
             "opp_b2b": int(bool(row.get("opp_b2b"))), **{f"l_{k}": v for k, v in lift.items()}}
    return [value.get(k) for k in SAVES_FACTORS]


def record_saves_games(folder: Path, board: dict, games: list) -> int:
    """Adds each newly finished game to the Saves record: every goalie with
    a main line who started, at the line and prices locked before puck drop,
    the first ones the site saw, his saves and the parts behind his number.
    A goalie who didn't start isn't graded (the books void it). Written
    once, never changed."""
    by_month = {}
    for g in games:
        entry = board.get(g["game_id"]) or {}
        if entry.get("final"):
            by_month.setdefault(g["date"][:7], []).append((g, entry))
    added = 0
    for month, finals in by_month.items():
        path = folder / f"{month}.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cols": SAVES_RECORD_COLS, "factors": SAVES_FACTORS, "games": {}}
        before = len(saved["games"])
        for g, entry in finals:
            if g["game_id"] in saved["games"]:
                continue
            plays = []
            for row in entry["goalies"]:
                if row.get("line") is None or row.get("actual") is None or row.get("void"):
                    continue
                first = row.get("first") or {}
                plays.append([row["id"], row["name"], row["team"], row["line"], row.get("over"), row.get("under"), row["mean"], row["chance_over"],
                              row.get("mkt_mean"), row["actual"], row.get("saves_avg"), first.get("line"), first.get("over"), first.get("under"), saves_factors(row), ou_nv_col(row)])
            if plays:
                saved["games"][g["game_id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "plays": plays}
        if len(saved["games"]) > before:
            saved.update(cols=SAVES_RECORD_COLS, nv=CLV_COLS["ou"])  # older rows are just shorter
            folder.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(saved, separators=(",", ":")) + "\n", encoding="utf-8")
            added += len(saved["games"]) - before
    return added


def saves_record_summary(folder: Path) -> dict:
    """The Saves record so far, the Points record's way: the better side of
    each main line by bucket (strong / lean / none / check), overs and
    unders, `fade` / `with` (against or with his season saves a start),
    closing line value, `days`, `plays` (latest SAVES_RECORD_DAYS days) and
    `ledger`; plus `honest`: every graded goalie by the model's chance of
    the over against how often he went over."""
    tally = lambda: {"wins": 0, "losses": 0, "units": 0.0}
    out = {"since": None, "through": None, "games": 0, "goalies": 0,
           **{k: tally() for k in ("check", "strong", "lean", "none", "unsure", "over", "under", "fade", "with")},
           "clv": clv_tally(),
           "honest": [{"lo": lo, "hi": hi, "goalies": 0, "said": 0.0, "got": 0} for lo, hi in zip(SAVES_HONEST, SAVES_HONEST[1:])]}
    days, plays = {}, []
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        for game in json.loads(path.read_text(encoding="utf-8"))["games"].values():
            out["games"] += 1
            out["since"] = min(out["since"] or game["date"], game["date"])
            out["through"] = max(out["through"] or game["date"], game["date"])
            for pid, name, team, line, over, under, mean, chance_over, mkt_mean, actual, avg, first_line, first_over, first_under, _factors, *more in game["plays"]:
                nv = more[0] if more else None
                out["goalies"] += 1
                for bucket in out["honest"]:
                    if bucket["lo"] <= chance_over < bucket["hi"]:
                        bucket["goalies"] += 1
                        bucket["said"] += chance_over
                        bucket["got"] += actual > line
                play = saves_play(chance_over, line, over, under, avg, mean, mkt_mean)
                if play is None or actual == line:
                    continue
                won = (actual > line) == (play["side"] == "over")
                units = (100 / -play["price"] if play["price"] < 0 else play["price"] / 100) if won else -1.0
                size = play["size"]
                called = [play["side"], "fade" if play["fade"] else "with"] if size in ("strong", "lean") else []
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
    for bucket in out["honest"]:
        bucket["said"] = round(bucket["said"], 2)
    clv_done(out["clv"])
    out["days"] = [{"date": date, **days[date]} for date in sorted(days)]
    out["ledger"] = record_ledger(plays)
    latest = set(sorted({play["date"] for play in plays})[-SAVES_RECORD_DAYS:])
    out["plays"] = sorted((play for play in plays if play["date"] in latest), key=lambda play: (play["date"], play["edge"]), reverse=True)
    return out


def saves_file(season: int, generated_at: str, crease: dict, records: list, games: list, previous: dict | None, record_dir: Path) -> dict:
    """site/nhl/saves.json: the board (from crease.json's), the rules and the record."""
    board = saves_board(crease.get("days") or {}, previous, records)
    try:
        record_saves_games(record_dir, board, games)
        record = saves_record_summary(record_dir)
    except Exception as e:  # a damaged record file must never cost the page its board
        print(f"WARNING: the Saves record couldn't be updated ({e}).", file=sys.stderr)
        record = None
    return {"season": season, "generated_at": generated_at, "weights": crease.get("weights"), "league": crease.get("league"), "edges": SAVES_EDGES, "unsure": UNSURE_EDGE,
            "check_saves": CREASE_RULES["check"], "factors": SAVES_FACTORS, "games": board, "record": record}
