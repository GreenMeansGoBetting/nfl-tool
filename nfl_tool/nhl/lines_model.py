"""Line Matchups (site/nhl/lines.html): how each forward line and defense
pair has played together at 5-on-5 this season, and which lines tend to
face each other. Standard library only. No picks and no prices: the page
is a preview (the owner, 2026-10-21, replacing Line Stacks).

Everything comes from the league's shift chart, kept with every finished
game (build_nhl.fetch_shifts):

  * `game_units(raw)`: one game boiled down. Every second with five skaters
    and a goalie a side, and exactly three forwards and two defensemen a
    side, is "5-on-5". For each team, every forward trio and defense pair
    that was on the ice together gets its seconds, shot attempts for and
    against (goals, shots on goal, misses and blocked shots: the usual
    "Corsi") and goals for and against. `vs` is the seconds each home trio
    spent against each away trio. None without a shift chart.
  * `LinesHistory`: this season's games (this season only, like every NHL
    tool), queried by the build for tonight's lines (`unit`), a team's
    usual lines lately (`usual`), how a coach deploys his lines against
    the other team's top line (`deploy`) and earlier meetings (`meetings`).

A shift counts from just after it starts to the moment it ends (the same
rule as build_nhl.on_ice_finder), so a goal belongs to the players it ended
the shift for, not the ones who came on for the faceoff after it.
"""
from bisect import bisect_left

ATTEMPTS = ("goal", "shot-on-goal", "missed-shot", "blocked-shot")
USUAL_GAMES = 5  # a team's usual lines are its most-played trios and pairs over its last 5 games
SEEN_SECONDS = 60  # a unit "played together" in a game with at least a minute at 5-on-5
RECENT_GAMES = 3  # the Last 3 GP numbers
DEPLOY_RANKS = 4  # forward lines ranked 1-4 by their 5-on-5 time that game; anything else is "mixed"


def clock(text) -> int:
    if not text or ":" not in str(text):
        return 0
    m, s = str(text).split(":")[:2]
    return int(m) * 60 + int(s)


def unit_key(ids) -> str:
    return "-".join(sorted(str(i) for i in ids))


def game_units(raw: dict) -> dict | None:
    """{"home", "away", team: {"team": [secs, cf, ca, gf, ga], "F": {key:
    [secs, cf, ca, gf, ga]}, "D": {...}}, "vs": [[home trio, away trio,
    secs]]} for one finished game; None when it has no shift chart."""
    shifts = raw.get("shifts")
    if not shifts:
        return None
    pbp, box = raw["pbp"], raw.get("box") or {}
    sides = {}
    pos = {}
    for side in ("homeTeam", "awayTeam"):
        abbrev = (box.get(side) or {}).get("abbrev") or pbp[side]["abbrev"]
        sides[side] = abbrev
        stats = (box.get("playerByGameStats") or {}).get(side) or {}
        for group, kind in (("forwards", "F"), ("defense", "D"), ("goalies", "G")):
            for p in stats.get(group) or []:
                pos[str(p["playerId"])] = (abbrev, kind)
    home, away = sides["homeTeam"], sides["awayTeam"]
    team_id = {pbp["homeTeam"]["id"]: home, pbp["awayTeam"]["id"]: away}

    starts, ends = {}, {}
    for pid, _team, period, on, off in shifts:
        pid = str(pid)
        if pid not in pos or period > 4:
            continue
        a, b = (period - 1) * 1200 + clock(on), (period - 1) * 1200 + clock(off)
        if b > a:
            starts.setdefault(a, []).append(pid)
            ends.setdefault(b, []).append(pid)
    bounds = sorted(set(starts) | set(ends))
    on_ice, states = set(), []  # states[i]: who is on from bounds[i] to bounds[i + 1]
    for t in bounds:
        on_ice -= set(ends.get(t, ()))
        on_ice |= set(starts.get(t, ()))
        states.append(five_on_five(on_ice, pos, home, away))

    out = {"home": home, "away": away, home: {"team": [0] * 5, "F": {}, "D": {}}, away: {"team": [0] * 5, "F": {}, "D": {}}}
    vs = {}

    def add(team, units, i, n):
        out[team]["team"][i] += n
        for kind, key in units:
            out[team][kind].setdefault(key, [0] * 5)[i] += n

    for i, state in enumerate(states[:-1]):
        if not state:
            continue
        secs = bounds[i + 1] - bounds[i]
        for team in (home, away):
            add(team, state[team], 0, secs)
        pair = (state[home][0][1], state[away][0][1])
        vs[pair] = vs.get(pair, 0) + secs

    for p in pbp.get("plays") or []:
        kind = p.get("typeDescKey")
        period = p.get("periodDescriptor") or {}
        if kind not in ATTEMPTS or period.get("periodType") == "SO" or (period.get("number") or 9) > 4:
            continue
        shooter = team_id.get((p.get("details") or {}).get("eventOwnerTeamId"))
        if not shooter:
            continue
        t = (period["number"] - 1) * 1200 + clock(p.get("timeInPeriod"))
        i = bisect_left(bounds, t) - 1  # the stretch from bounds[i] (exclusive) to bounds[i + 1]
        if i < 0 or i >= len(states) - 1 or not states[i]:
            continue
        for team in (home, away):
            mine = team == shooter
            add(team, states[i][team], 1 if mine else 2, 1)
            if kind == "goal":
                add(team, states[i][team], 3 if mine else 4, 1)
    out["vs"] = [[h, a, s] for (h, a), s in vs.items()]
    return out


def five_on_five(on_ice: set, pos: dict, home: str, away: str) -> dict | None:
    """{team: [("F", trio key), ("D", pair key)]} when both teams have three
    forwards, two defensemen and a goalie on; None otherwise."""
    groups = {home: {"F": [], "D": [], "G": []}, away: {"F": [], "D": [], "G": []}}
    for pid in on_ice:
        team, kind = pos[pid]
        groups[team][kind].append(pid)
    for g in groups.values():
        if len(g["F"]) != 3 or len(g["D"]) != 2 or len(g["G"]) != 1:
            return None
    return {team: [("F", unit_key(g["F"])), ("D", unit_key(g["D"]))] for team, g in groups.items()}


def share(cf, ca):
    return cf / (cf + ca) if cf + ca else None


class LinesHistory:
    """This season's games with a shift chart, by team, oldest first."""

    def __init__(self):
        self.games = {}  # team -> [{"id", "date", "opp", "home", "team", "F", "D", "vs"}]

    def add_game(self, record: dict):
        units = record.get("lines5")
        if not units:
            return
        home, away = units["home"], units["away"]
        for team, opp, at_home in ((home, away, True), (away, home, False)):
            mine = units[team]
            vs = {}
            for h, a, s in units["vs"]:
                key = (h, a) if at_home else (a, h)  # (this team's trio, the other team's)
                vs[key] = vs.get(key, 0) + s
            self.games.setdefault(team, []).append({"id": record["id"], "date": record["date"], "opp": opp, "home": at_home,
                                                    "team": mine["team"], "F": mine["F"], "D": mine["D"], "vs": vs})

    def team_games(self, team: str) -> list:
        return sorted(self.games.get(team, []), key=lambda g: (g["date"], g["id"]))

    def unit(self, team: str, kind: str, ids) -> dict:
        """One trio or pair together this season: games (a minute or more),
        5-on-5 seconds, attempts and goals for and against, and the same over
        its last three games together (`l3`)."""
        key = unit_key(ids)
        rows = [g[kind][key] for g in self.team_games(team) if g[kind].get(key, [0])[0] >= SEEN_SECONDS]
        return {**totals(rows), "l3": totals(rows[-RECENT_GAMES:])}

    def team_total(self, team: str) -> dict:
        return totals([g["team"] for g in self.team_games(team)])

    def usual(self, team: str) -> dict:
        """{"F": [trio ids] x up to 4, "D": [pair ids] x up to 3}: the team's
        lines lately, from the players who dressed in its latest game. Over its
        last USUAL_GAMES games at 5-on-5, the forward with the most ice time and
        the two he shared the most of it with are a line, then the next, and so
        on (pairs for defensemen; build_nhl.game_lines' rule for one game);
        lines are ordered by their players' ice time."""
        recent = self.team_games(team)[-USUAL_GAMES:]
        out = {}
        for kind, size in (("F", 3), ("D", 2)):
            dressed = {pid for key in recent[-1][kind] for pid in key.split("-")} if recent else set()
            alone, shared = {}, {}
            for g in recent:
                for key, row in g[kind].items():
                    ids = key.split("-")
                    for p in ids:
                        alone[p] = alone.get(p, 0) + row[0]
                        for q in ids:
                            if p < q:
                                shared[(p, q)] = shared.get((p, q), 0) + row[0]
            left = sorted((p for p in dressed if p in alone), key=lambda p: (-alone[p], p))
            groups = []
            while len(left) >= size:
                lead = left.pop(0)
                mates = sorted(left, key=lambda q: (-shared.get((min(lead, q), max(lead, q)), 0), q))[:size - 1]
                for m in mates:
                    left.remove(m)
                groups.append([lead, *mates])
            groups.sort(key=lambda ids: -sum(alone[p] for p in ids))
            out[kind] = groups[:4 if kind == "F" else 3]
        return out

    def deploy(self, team: str, at_home: bool) -> dict:
        """How this team's coach has lined up against the other team's lines, in
        its home (or road) games: {"games", "rows": [[their rank, our rank or 0
        (mixed), seconds]]}. Ranks are each game's forward trios by 5-on-5 time
        (1 = most); "their rank" 1 is the other team's top line that night."""
        cells, games = {}, 0
        for g in self.team_games(team):
            if g["home"] != at_home or not g["vs"]:
                continue
            games += 1
            ours, theirs = {}, {}
            for (mine, other), s in g["vs"].items():
                ours[mine] = ours.get(mine, 0) + s
                theirs[other] = theirs.get(other, 0) + s
            our_rank = ranks(ours)
            their_rank = ranks(theirs)
            for (mine, other), s in g["vs"].items():
                r = their_rank.get(other)
                if r:
                    cell = (r, our_rank.get(mine, 0))
                    cells[cell] = cells.get(cell, 0) + s
        return {"games": games, "rows": [[r, h, s] for (r, h), s in sorted(cells.items())]}

    def meetings(self, team: str, opp: str) -> dict:
        """Earlier games between the two this season: {"games", "vs": {(our trio,
        their trio): seconds}}."""
        vs, games = {}, 0
        for g in self.team_games(team):
            if g["opp"] != opp:
                continue
            games += 1
            for pair, s in g["vs"].items():
                vs[pair] = vs.get(pair, 0) + s
        return {"games": games, "vs": vs}


def ranks(secs: dict) -> dict:
    """{key: 1..DEPLOY_RANKS} for the most-played keys."""
    top = sorted(secs, key=lambda k: (-secs[k], k))[:DEPLOY_RANKS]
    return {k: i + 1 for i, k in enumerate(top)}


def totals(rows: list) -> dict:
    t = [sum(r[i] for r in rows) for i in range(5)]
    return {"gp": len(rows), "toi": t[0], "cf": t[1], "ca": t[2], "gf": t[3], "ga": t[4]}


def likely_matchups(deploy: dict) -> list:
    """For the other team's lines 1-4 (by tonight's slot), the line this coach
    has most often sent out against that line, and how often: [{"their",
    "ours" (0 = mixed groups), "share", "secs"}]. Empty with no games."""
    out = []
    for r in range(1, DEPLOY_RANKS + 1):
        cells = {h: s for rr, h, s in deploy["rows"] if rr == r}
        total = sum(cells.values())
        named = {h: s for h, s in cells.items() if h}
        if not total or not named:
            continue
        best = max(named, key=lambda h: (named[h], -h))
        out.append({"their": r, "ours": best, "share": round(named[best] / total, 3), "mixed": round(cells.get(0, 0) / total, 3), "secs": total})
    return out
