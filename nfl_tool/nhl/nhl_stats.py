"""Team and player numbers for the NHL build: team stats, recent games, skaters,
goalies, lineups, each player's own file, and stats vs each position.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import json
from collections import Counter
from pathlib import Path

from nhl_games import AREAS, FINISHED_STATES, GOALIE_LOG_COLS, REGULAR_SEASON, REST, SKATER_LOG_COLS, _request, fetch_report, load_games, season_id
RECENT_GAMES = 10
FORWARDS_SHOWN = 12
DEFENSE_SHOWN = 6


# ---- season totals ----
def num(value, digits=2):
    return None if value is None else round(float(value), digits)


def ratio(a, b, digits=4):
    return round(a / b, digits) if b else None


def record_text(wins, losses, ot_losses):
    return f"{wins}-{losses}-{ot_losses}"


def compute_team_stats(records: list, standings: dict, reports: dict, team_ids: dict) -> dict:
    """Season totals turned into rates. Every stat has the offense's number
    (off_*) and the matching number the defense allows (def_*), so matchups
    can read both sides. Goals and shots leave out shootouts; the "where
    shots come from" areas also leave out empty-net shots and blocked shots
    (a blocked shot is logged where it was blocked, not where it was taken)."""
    own, opp, games = {}, {}, Counter()
    for r in records:
        for team, other in ((r["home"], r["away"]), (r["away"], r["home"])):
            own.setdefault(team, Counter()).update(r["teams"][team])
            opp.setdefault(team, Counter()).update(r["teams"][other])
            games[team] += 1
    out = {}
    for team, gp in games.items():
        f, a = own[team], opp[team]
        stats = {"games_played": gp}
        for side, c in (("off", f), ("def", a)):
            stats[f"{side}_gpg"] = num(c["g"] / gp)
            stats[f"{side}_sog_pg"] = num(c["sog"] / gp, 1)
            stats[f"{side}_att_pg"] = num(c["att_5v5"] / gp, 1)
            stats[f"{side}_hd_pg"] = num(c["a_low_slot"] / gp)
            stats[f"{side}_sh_pct"] = ratio(c["g_5v5"], c["sog_5v5"])
            located = sum(c[f"a_{area}"] for area in AREAS)
            for area in AREAS:
                stats[f"{side}_{area}_pg"] = num(c[f"a_{area}"] / gp)
                stats[f"{side}_{area}_share"] = ratio(c[f"a_{area}"], located)
                stats[f"{side}_{area}_g"] = c[f"ag_{area}"]
        stats["att_share"] = ratio(f["att_5v5"], f["att_5v5"] + a["att_5v5"])
        stats["hd_share"] = ratio(f["a_low_slot"], f["a_low_slot"] + a["a_low_slot"])
        stats["goal_diff_pg"] = num((f["g"] - a["g"]) / gp)
        stats["fo_pct"] = ratio(f["fo_won"], f["fo"])
        stats["hits_pg"] = num(f["hits"] / gp, 1)
        stats["pim_pg"] = num(f["pim"] / gp, 1)
        team_id = team_ids.get(team)
        pp, pk = reports.get("powerplay", {}).get(team_id), reports.get("penaltykill", {}).get(team_id)
        stats["off_pp_pct"] = num(pp["powerPlayPct"], 4) if pp else None
        stats["off_pp_opp_pg"] = num(pp["ppOpportunitiesPerGame"]) if pp else None
        # What the penalty kill allows is the other side of a power play row.
        stats["def_pp_pct"] = num(1 - pk["penaltyKillPct"], 4) if pk and pk.get("penaltyKillPct") is not None else None
        stats["def_pp_opp_pg"] = num(pk["timesShorthandedPerGame"]) if pk else None
        stats["pk_pct"] = num(pk["penaltyKillPct"], 4) if pk else None
        s = standings.get(team)
        if s:
            stats.update({
                "wins": s["wins"], "losses": s["losses"], "ot_losses": s["otLosses"], "points": s["points"],
                "home_record": record_text(s["homeWins"], s["homeLosses"], s["homeOtLosses"]),
                "away_record": record_text(s["roadWins"], s["roadLosses"], s["roadOtLosses"]),
                "last10": record_text(s["l10Wins"], s["l10Losses"], s["l10OtLosses"]),
                "streak": f"{s.get('streakCode') or ''}{s.get('streakCount') or ''}" or None,
            })
        out[team] = stats
    return out


def result_for(record: dict, team: str) -> str:
    other = record["away"] if team == record["home"] else record["home"]
    if record["score"][team] > record["score"][other]:
        return "W"
    return "L" if record["ended"] == "REG" else "OTL"


def compute_recent_games(records: list) -> dict:
    out = {}
    for r in records:
        for team, other in ((r["home"], r["away"]), (r["away"], r["home"])):
            starter = next((g["name"] for g in r["goalies"].values() if g["team"] == team and g["start"]), None)
            out.setdefault(team, []).append({
                "date": r["date"], "opp": other, "home": team == r["home"], "gf": r["score"][team], "ga": r["score"][other],
                "result": result_for(r, team), "ended": r["ended"], "sog": r["teams"][team].get("sog", 0), "sog_against": r["teams"][other].get("sog", 0),
                "goalie": starter,
            })
    return {team: games[-RECENT_GAMES:] for team, games in out.items()}


def compute_skaters(records: list, toi_report: dict) -> dict:
    """{player id: season line}. A player belongs to the team of his latest game."""
    games = {}
    for r in records:
        for pid, line in r["skaters"].items():
            games.setdefault(pid, []).append(line)
    out = {}
    for pid, lines in games.items():
        last, gp = lines[-1], len(lines)
        total = lambda key, rows=lines: sum(row[key] for row in rows)
        last5 = lines[-5:]
        report = toi_report.get(int(pid)) or {}
        out[pid] = {
            "id": pid, "name": last["name"], "team": last["team"], "pos": last["pos"], "headshot": last["headshot"],
            "shoots": report.get("shootsCatches"), "games": gp, "toi": num(total("toi") / gp / 60, 1),
            "g": total("g"), "a": total("a"), "p": total("g") + total("a"), "ppp": total("ppp"),
            "sog_pg": num(total("sog") / gp), "att_pg": num(total("att") / gp), "hd": total("hd"),
            "hits_pg": num(total("hits") / gp, 1), "blk_pg": num(total("blk") / gp, 1),
            "pp_toi": num(report["ppTimeOnIcePerGame"] / 60, 1) if report.get("ppTimeOnIcePerGame") is not None else None,
            "l5_sog_pg": num(total("sog", last5) / len(last5)), "l5_p": total("g", last5) + total("a", last5),
            "l5_toi": num(total("toi", last5) / len(last5) / 60, 1),
        }
    return out


def compute_goalies(records: list) -> dict:
    """{player id: season line}, shootouts left out (as the league counts saves)."""
    games = {}
    for r in records:
        for pid, line in r["goalies"].items():
            games.setdefault(pid, []).append(line)
    out = {}
    for pid, lines in games.items():
        last = lines[-1]
        total = lambda key, rows=lines: sum(row[key] for row in rows)
        starts = [row for row in lines if row["start"]]
        last5 = starts[-5:]
        decisions = Counter(row["dec"] for row in lines)
        out[pid] = {
            "id": pid, "name": last["name"], "team": last["team"], "headshot": last["headshot"], "games": len(lines), "starts": len(starts),
            "record": record_text(decisions["W"], decisions["L"], decisions["O"]),
            "sv_pct": ratio(total("sa") - total("ga"), total("sa")), "gaa": num(total("ga") * 3600 / total("toi")) if total("toi") else None,
            "sa_pg": num(total("sa", starts) / len(starts), 1) if starts else None,
            "hd_sv_pct": ratio(total("hd_sa") - total("hd_ga"), total("hd_sa")), "hd_sa": total("hd_sa"),
            "l5_sv_pct": ratio(total("sa", last5) - total("ga", last5), total("sa", last5)) if last5 else None,
        }
    return out


def last_dressed(records: list) -> dict:
    """{team: the ids of the skaters who dressed in its latest game}."""
    out = {}
    for r in records:  # in date order
        for team in (r["home"], r["away"]):
            out[team] = {pid for pid, line in r["skaters"].items() if line["team"] == team}
    return out


def lineup(skaters: dict, team_games: Counter, dressed: dict | None = None) -> dict:
    """{team: forwards then defensemen, most ice time first}. Ice time is
    discounted for a player with only a game or two, so a one-night fill-in
    doesn't jump the list, but never for one who dressed in his team's latest
    game (`dressed`): he is in the lineup now. Charlie McAvoy missed Boston's
    first six games, came back with 24:41, and the discount ranked him last
    of eight defensemen and off every prop page (2026-10-16)."""
    by_team = {}
    for s in skaters.values():
        by_team.setdefault(s["team"], []).append(s)
    out = {}
    for team, rows in by_team.items():
        full = min(10, max(1, team_games.get(team, 1))) / 2
        current = (dressed or {}).get(team) or set()
        rank = lambda s: -(s["toi"] or 0) * (1 if s["id"] in current else min(1, s["games"] / full))
        forwards = sorted((s for s in rows if s["pos"] != "D"), key=rank)[:FORWARDS_SHOWN]
        defense = sorted((s for s in rows if s["pos"] == "D"), key=rank)[:DEFENSE_SHOWN]
        out[team] = forwards + defense
    return out


# ---- the player card's data ----
def add_counts(total: dict, part: dict) -> None:
    """Adds {key: [numbers]} into a running total of the same shape."""
    for key, values in part.items():
        have = total.setdefault(key, [0] * len(values))
        for i, v in enumerate(values):
            have[i] += v


def compute_player_details(records: list) -> dict:
    """What the player card shows beyond the season line: every game's box
    score line, where a skater's shots came from and with what kind of shot,
    and where the shots a goalie faced came from. Log rows point at a shared
    list of games so the saved last-season file stays small."""
    games = {str(r["id"]): [r["date"], r["home"], r["away"], r["score"][r["home"]], r["score"][r["away"]], r["ended"]] for r in records}
    skaters, goalies = {}, {}
    for r in records:
        game = str(r["id"])
        for pid, line in r["skaters"].items():
            d = skaters.setdefault(pid, {"log": [], "areas": {}, "types": {}, "unb": 0, "pp_unb": 0})
            d["log"].append([game, line["team"], *(line[c] for c in SKATER_LOG_COLS)])
            add_counts(d["areas"], line["areas"])
            add_counts(d["types"], line["types"])
            d["unb"] += line["unb"]
            d["pp_unb"] += line["pp_unb"]
        for pid, line in r["goalies"].items():
            d = goalies.setdefault(pid, {"log": [], "areas": {}})
            d["log"].append([game, line["team"], *(int(line[c]) if isinstance(line[c], bool) else line[c] for c in GOALIE_LOG_COLS)])
            add_counts(d["areas"], line["areas"])
    return {"games": games, "skaters": skaters, "goalies": goalies}


def league_areas(records: list) -> dict:
    """The whole league's numbers for each rink area, the yardstick on the
    player card: the share of shots taken there and how often a shot on goal
    from there goes in."""
    total = Counter()
    for r in records:
        for counts in r["teams"].values():
            total.update(counts)
    located = sum(total[f"a_{a}"] for a in AREAS)
    return {a: {"share": ratio(total[f"a_{a}"], located), "sh_pct": ratio(total[f"ag_{a}"], total[f"as_{a}"])} for a in AREAS}


def player_file(detail: dict | None, pid: str) -> dict | None:
    """One player's card data with each log row spelled out: [date, opponent,
    at home (1/0), goals for, goals against, how it ended, then the stat columns]."""
    for group in ("skaters", "goalies"):
        d = ((detail or {}).get(group) or {}).get(pid)
        if not d:
            continue
        rows = []
        for game, team, *numbers in d["log"]:
            date, home, away, home_score, away_score, ended = detail["games"][game]
            mine, theirs = (home_score, away_score) if team == home else (away_score, home_score)
            rows.append([date, away if team == home else home, int(team == home), mine, theirs, ended, *numbers])
        return {**d, "log": rows}
    return None


def write_player_files(folder: Path, teams: dict, stats: dict, generated_at: str) -> int:
    """site/nhl/players/<TEAM>.json: the card data for everyone on that team,
    this season. The page loads a team's file only when one of its
    games is opened, so data.json stays small."""
    folder.mkdir(parents=True, exist_ok=True)
    on_team = {}
    for group in ("skaters", "goalies"):
        for pid, row in stats[group].items():
            on_team.setdefault(row["team"], {}).setdefault(group, []).append(pid)
    for abbr in teams:
        blob = {"team": abbr, "generated_at": generated_at, "log_lead": ["date", "opp", "home", "gf", "ga", "ended"], "skater_cols": list(SKATER_LOG_COLS), "goalie_cols": list(GOALIE_LOG_COLS)}
        for group in ("skaters", "goalies"):
            blob[group] = {pid: {"season": player_file(stats["detail"], pid)} for pid in on_team.get(abbr, {}).get(group, [])}
        with open(folder / f"{abbr}.json", "w") as f:
            json.dump(blob, f, separators=(",", ":"))
    return len(teams)


VS_POS = ("C", "L", "R", "D")  # the box score's positions: center, left wing, right wing, defense
VS_POS_LAST = 10


def compute_vs_position(records: list) -> dict:
    """What each defense allows to each skater position (the Vs Position page; a member, 2026-11-13:
    "the shots that each team gives to each position. LW/C/RW/D"): shots on goal and goals by the
    other team's centers, left wings, right wings and defensemen, in all its games, at home, on
    the road and its last 10. Per team and window: [games, C shots, C goals, L shots, L goals,
    R shots, R goals, D shots, D goals, C points, L points, R points, D points] (points last, so
    a saved file from before them still reads). The box score's skater lines leave shootouts out."""
    width = 1 + 3 * len(VS_POS)
    games = {}
    for r in records:  # oldest first (load_games sorts by date)
        for team, other in ((r["home"], r["away"]), (r["away"], r["home"])):
            row = [1] + [0] * (width - 1)
            for s in r["skaters"].values():
                if s["team"] == other and s["pos"] in VS_POS:
                    k = VS_POS.index(s["pos"])
                    i = 1 + 2 * k
                    row[i] += s.get("sog") or 0
                    row[i + 1] += s.get("g") or 0
                    row[1 + 2 * len(VS_POS) + k] += (s.get("g") or 0) + (s.get("a") or 0)
            games.setdefault(team, []).append((team == r["home"], row))

    def add(rows):
        return [sum(x[k] for x in rows) for k in range(width)]

    teams = {team: {
        "season": add([x for _, x in rows]),
        "home": add([x for home, x in rows if home]),
        "away": add([x for home, x in rows if not home]),
        "10": add([x for _, x in rows[-VS_POS_LAST:]]),
    } for team, rows in games.items()}
    return {"positions": list(VS_POS), "teams": teams}


def season_stats(season: int, data_dir: Path, standings: dict, team_ids: dict) -> dict:
    """Everything worked out from one season's finished games."""
    listing = _request(f"{REST}/game?cayenneExp=season={season_id(season)}%20and%20gameType={REGULAR_SEASON}").get("data") or []
    finished = sorted(g["id"] for g in listing if g.get("gameStateId") in FINISHED_STATES)
    records, debug = load_games(finished, season, data_dir)
    reports = {"powerplay": fetch_report("team/powerplay", season), "penaltykill": fetch_report("team/penaltykill", season)}
    return {
        "listing": listing,
        "records": records,
        "debug": debug,
        "team_stats": compute_team_stats(records, standings, reports, team_ids),
        "vs_position": compute_vs_position(records),
        "skaters": compute_skaters(records, fetch_report("skater/timeonice", season, "playerId")),
        "goalies": compute_goalies(records),
        "detail": compute_player_details(records),
        "league": league_areas(records),
    }
