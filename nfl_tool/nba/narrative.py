"""Dunk Digest's Narrative box (the owner, 2026-11-18): tonight's Revenge Games, Back To Hometown and
Back To College. Talking points for the videos, never a pick (an old replay measured no betting effect
from revenge spots), and never a guess: a spot the sources don't back stays empty.

Career teams and college are biography, not stats: the owner OK'd using past seasons for this box only.
Nothing here feeds a model, a tag or a number on any other page.

Sources (free): ESPN's athlete pages (games per team per season, its home place, college, game logs),
Wikipedia's player infobox (birthplace, every high school and college) and Wikipedia's map coordinates;
Wikidata links an ESPN id to its Wikipedia page.

ESPN's "birthplace" behaves like a hometown: on 2026-11-18, where it and Wikipedia's birthplace were 40+
miles apart and a high school was known (54 players), the school sat within 50 miles of ESPN's place 48
times and Wikipedia's once. So a hometown needs two of the three to agree, and never a birthplace alone.

Saved in model_history/nba_bios/<season>.json so a build only asks about new players and the oldest few
(the deploy bot commits it). The injury refresh asks nothing. Re-pull everyone by hand:
    py nfl_tool/nba/narrative.py --season 2027 --seed
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

HISTORY = Path(__file__).resolve().parents[2] / "model_history" / "nba_bios"
ESPN_ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{pid}"
COLLEGE_TEAMS = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500"
COLLEGE_TEAM = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/teams/{tid}?lang=en&region=us"
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA = "https://query.wikidata.org/sparql"
ESPN_ID_PROPERTY = "P3685"  # Wikidata's "ESPN.com NBA player ID"
HEADERS = {"User-Agent": "GMG-Sports-Data/1.0 (player background refresh)"}
WIKI_PAUSE = 1.5  # seconds between Wikipedia requests (it answered 429 at 0.5 on a full re-read)

# ---- the owner's rules (2026-11-18) ----
# Revenge Game: any season he played for tonight's opponent, however long ago (the owner, 2026-11-19, after Jrue
# Holiday at MIL was cut by a games + recency rule: "I like to know if any player is returning to face a familiar foe").
TAG_SEASONS = 3  # the First Game Back / First Time Facing Them game logs are read only if he left within this many
NEAR_MILES = 75
DAYS_AHEAD = 3  # how far ahead the "first time facing them" game logs are read
STALE_DAYS = 7
MAX_REFRESH = 80  # players re-read a build (new players first, then the oldest)
HIDE: dict[str, set] = {}  # a correction by hand: {ESPN id: {"revenge" / "hometown" / "college"}}

ARENAS = {"ATL": (33.757, -84.396), "BOS": (42.366, -71.062), "BKN": (40.683, -73.975), "CHA": (35.225, -80.839), "CHI": (41.881, -87.674),
          "CLE": (41.496, -81.688), "DAL": (32.790, -96.810), "DEN": (39.749, -105.008), "DET": (42.341, -83.055), "GS": (37.768, -122.388),
          "HOU": (29.751, -95.362), "IND": (39.764, -86.155), "LAC": (33.945, -118.343), "LAL": (34.043, -118.267), "MEM": (35.138, -90.051),
          "MIA": (25.781, -80.187), "MIL": (43.045, -87.917), "MIN": (44.979, -93.276), "NO": (29.949, -90.082), "NY": (40.751, -73.994),
          "OKC": (35.463, -97.515), "ORL": (28.539, -81.384), "PHI": (39.901, -75.172), "PHX": (33.446, -112.071), "POR": (45.532, -122.667),
          "SAC": (38.580, -121.500), "SA": (29.427, -98.437), "TOR": (43.643, -79.379), "UTAH": (40.768, -111.901), "WSH": (38.898, -77.021)}
SAME_CITY = {"NY": "BKN", "BKN": "NY", "LAL": "LAC", "LAC": "LAL"}
STATES = dict(AL="Alabama", AK="Alaska", AZ="Arizona", AR="Arkansas", CA="California", CO="Colorado", CT="Connecticut", DE="Delaware", DC="D.C.", FL="Florida",
              GA="Georgia", HI="Hawaii", ID="Idaho", IL="Illinois", IN="Indiana", IA="Iowa", KS="Kansas", KY="Kentucky", LA="Louisiana", ME="Maine", MD="Maryland",
              MA="Massachusetts", MI="Michigan", MN="Minnesota", MS="Mississippi", MO="Missouri", MT="Montana", NE="Nebraska", NV="Nevada", NH="New Hampshire",
              NJ="New Jersey", NM="New Mexico", NY="New York", NC="North Carolina", ND="North Dakota", OH="Ohio", OK="Oklahoma", OR="Oregon", PA="Pennsylvania",
              RI="Rhode Island", SC="South Carolina", SD="South Dakota", TN="Tennessee", TX="Texas", UT="Utah", VT="Vermont", VA="Virginia", WA="Washington",
              WV="West Virginia", WI="Wisconsin", WY="Wyoming", ON="Ontario", QC="Quebec", BC="British Columbia", AB="Alberta", MB="Manitoba", SK="Saskatchewan", NS="Nova Scotia")
# National prep programs players move to: being near one says nothing about where he's from.
PREP = re.compile(r"montverde|img academy|oak hill academy|la lumiere|findlay prep|sunrise christian|prolific prep|brewster academy|huntington prep|hillcrest prep|"
                  r"wasatch academy|compass prep|link academy|link year|overtime elite|spire|combine academy|nba academy|bella vista|notre dame prep|"
                  r"st\.? thomas more school|(?:mount|mt\.?) zion (?:christian|prep)|tilton|vermont academy|putnam science|new hampton|victory rock|orangeville|"
                  r"cia bounce|athlete institute|thrive prep|dream city|woodstock academy|south kent|lee academy|blair academy|phelps school|hamilton heights|"
                  r"kimball union|bridgton|worcester academy|redemption christian|g league|ignite", re.I)


def miles(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


# ---- reading Wikipedia's infobox ----
def _clean(text) -> str:
    s = text or ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{\s*(?:nowrap|nobr|small|avoid wrap|avoidwrap|nowraplinks)\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}", r"\1", s, flags=re.I)
    return re.sub(r"<br\s*/?>", "\n", s)


def _shown(s: str) -> str:
    return re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)


def place_titles(raw) -> tuple[list, str]:
    """A place in wiki text -> (page titles to try, best first; the words shown)."""
    s = re.sub(r"\{\{[^{}]*\}\}", "", _clean(raw)).strip()
    links = re.findall(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]", s)
    show = _shown(s).replace("\n", " ").strip(" ,")
    tries = []
    if len(links) >= 2 and "," not in links[0]:
        tries.append(f"{links[0]}, {links[1]}")
    tries += links[:1]
    parts = [p.strip() for p in show.split(",")]
    if len(parts) >= 2:
        tries.append(f"{parts[0]}, {parts[1]}")
    if parts and parts[0]:
        tries.append(parts[0])
    return list(dict.fromkeys(t for t in tries if t)), show


def schools(raw) -> list:
    """The high_school field -> [{name, place, titles, prep}] in the order listed."""
    s = re.sub(r"\{\{\s*(?:ubl|unbulleted list|plainlist|flatlist|hlist)\s*\|?", "\n", _clean(raw), flags=re.I).replace("}}", "\n").replace("{{", "\n")
    out = []
    for m in re.finditer(r"(\[\[[^\]]+\]\]|[A-Z][^\[\]()|*\n<>]{2,60}?)\s*[\n ]*\(\s*((?:\[\[[^\]]+\]\]|[^()\[\]\n])+?)\s*\)", s):
        if re.fullmatch(r"\d{4}.*", m.group(2).strip()):
            continue
        titles, place = place_titles(m.group(2))
        name = _shown(m.group(1)).strip(" *|")
        out.append({"name": name, "place": place, "titles": titles, "prep": bool(PREP.search(f"{name} {m.group(1)}"))})
    return out


def colleges(raw) -> list:
    """The college field -> [{team (ESPN's name for it), name, years}]."""
    out = []
    for m in re.finditer(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*(?:\(([^)]*)\))?", _clean(raw)):
        team = m.group(1).replace(" men's basketball", "").replace(" basketball", "")
        out.append({"team": team, "name": m.group(2) or m.group(1), "years": m.group(3)})
    return out


def infobox_field(src: str, name: str):
    m = re.search(r"^\s*\|\s*" + name + r"\s*=(.*?)(?=^\s*\|\s*[a-z_0-9]+\s*=|^\}\})", src, re.S | re.M)
    return m.group(1).strip() if m else None


# ---- asking the sources ----
def _json(url, data=None, headers=None, tries=3):
    err = None
    for i in range(tries):
        try:
            body = urllib.parse.urlencode(data).encode() if data else None
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={**HEADERS, **(headers or {})}), timeout=60) as r:
                return json.load(r)
        except Exception as ex:  # one retry pattern for every source: a miss keeps what is saved
            err = ex
            slow_down = getattr(ex, "code", None) == 429  # Wikipedia asks for room: give it what it says
            time.sleep(min(60, int(ex.headers.get("Retry-After") or 30)) if slow_down else 2 + 4 * i)
    raise RuntimeError(f"{url[:70]}: {err!r}")


def _wiki(fields: dict) -> dict:
    return _json(WIKI_API, {"action": "query", "format": "json", "formatversion": 2, "redirects": 1, **fields}, tries=4).get("query", {})


def wiki_titles(ids: list) -> dict:
    out = {}
    for i in range(0, len(ids), 150):
        vals = " ".join(f'"{x}"' for x in ids[i:i + 150])
        q = f"SELECT ?id ?t WHERE {{ VALUES ?id {{ {vals} }} ?p wdt:{ESPN_ID_PROPERTY} ?id . ?a schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?t . }}"
        d = _json(WIKIDATA, {"query": q, "format": "json"}, {"Accept": "application/sparql-results+json"}, tries=4)
        out.update({b["id"]["value"]: b["t"]["value"] for b in d["results"]["bindings"]})
    return out


def _aliases(q: dict) -> dict:
    """{final page title: every title that led to it} from a query's redirects."""
    led = {}
    for key in ("normalized", "redirects"):
        for r in q.get(key) or []:
            led.setdefault(r["to"], []).append(r["from"])
    return led


def wiki_infoboxes(titles: list) -> dict:
    out = {}
    for i in range(0, len(titles), 40):
        q = _wiki({"prop": "revisions", "rvprop": "content", "rvslots": "main", "rvsection": 0, "titles": "|".join(titles[i:i + 40])})
        led = _aliases(q)
        for p in q.get("pages", []):
            if p.get("revisions"):
                text = p["revisions"][0]["slots"]["main"]["content"]
                for t in [p["title"], *led.get(p["title"], [])]:
                    out[t] = text
                    for t2 in led.get(t, []):
                        out[t2] = text
        time.sleep(WIKI_PAUSE)
    return out


def coordinates(titles: list) -> dict:
    out = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 40):
        q = _wiki({"prop": "coordinates", "colimit": "max", "coprimary": "primary", "titles": "|".join(titles[i:i + 40])})
        led = _aliases(q)
        for p in q.get("pages", []):
            c = p.get("coordinates")
            if c:
                at = [round(c[0]["lat"], 3), round(c[0]["lon"], 3)]
                for t in [p["title"], *led.get(p["title"], [])]:
                    out[t] = at
                    for t2 in led.get(t, []):
                        out[t2] = at
        time.sleep(WIKI_PAUSE)
    return out


def espn_player(pid: str):
    """ESPN's half of a player's record; None when ESPN didn't answer."""
    base = ESPN_ATHLETE.format(pid=pid)
    try:
        a = _json(base).get("athlete") or {}
        stats = _json(base + "/stats")
    except RuntimeError:
        return None
    cats = stats.get("categories") or []
    cat = next((c for c in cats if c.get("name") == "averages"), cats[0] if cats else {})
    teams = []
    for s in cat.get("statistics", []):
        if s.get("teamId"):
            teams.append([s["season"]["year"], int(s["teamId"]), int(float(s["stats"][0] or 0)), float(s["stats"][2] or 0)])
    if not teams or not a.get("displayName"):
        return None
    college = a.get("college") or {}
    return {"name": a["displayName"], "teams": teams, "town_text": a.get("displayBirthPlace"), "college_id": str(college["id"]) if college.get("id") else None, "college_name": college.get("name")}


def _town_titles(text: str) -> list:
    parts = [p.strip() for p in (text or "").split(",")]
    return [f"{parts[0]}, {STATES.get(parts[1], parts[1])}", parts[0]] if len(parts) == 2 else []


def refresh_players(ids: list, saved: dict, today: str) -> dict:
    """New records for `ids`. Any source being down raises: the build keeps what is saved and tries next time."""
    with ThreadPoolExecutor(6) as ex:
        espn = dict(zip(ids, ex.map(espn_player, ids)))
    ids = [i for i in ids if espn[i]]
    titles = {i: saved[i]["wiki"] for i in ids if (saved.get(i) or {}).get("wiki")}
    missing = [i for i in ids if i not in titles]
    if missing:
        titles.update(wiki_titles(missing))
    boxes = wiki_infoboxes(sorted(set(titles.values())))
    d1 = {}
    for s in _json(COLLEGE_TEAMS)["sports"][0]["leagues"][0]["teams"]:
        d1[s["team"]["displayName"]] = str(s["team"]["id"])
    d1_name = {v: k for k, v in d1.items()}

    parsed, want, tids = {}, [], set()
    for i in ids:
        box = boxes.get(titles.get(i), "")
        tries, born = place_titles(infobox_field(box, "birth_place"))
        hs = schools(infobox_field(box, "high_school"))
        cols = [c for c in colleges(infobox_field(box, "college")) if c["team"] in d1]
        for c in cols:
            c["tid"] = d1[c["team"]]
        cid = espn[i]["college_id"]
        for c in cols:
            c["espn"] = c["tid"] == cid
        if cid and not any(c["espn"] for c in cols):  # a school Wikipedia spells differently, or lists nowhere
            cols.insert(0, {"team": d1_name.get(cid), "name": espn[i]["college_name"], "years": None, "tid": cid, "espn": True})
        town_tries = _town_titles(espn[i]["town_text"])
        parsed[i] = {"born_tries": tries, "born": born, "town_tries": town_tries, "hs": hs, "col": cols}
        want += tries[:3] + town_tries
        for h in hs:
            want += h["titles"][:3]
        tids.update(c["tid"] for c in cols)

    def venue(tid):
        addr = ((_json(COLLEGE_TEAM.format(tid=tid)).get("venue") or {}).get("address")) or {}
        return tid, addr
    with ThreadPoolExecutor(6) as ex:
        venues = dict(ex.map(venue, sorted(tids)))
    city = {}
    for tid, a in venues.items():
        if a.get("city"):
            city[tid] = [f"{a['city']}, {STATES.get(a.get('state'), a.get('state'))}", a["city"]]
            want += city[tid]
    geo = coordinates([t for t in want if t])
    first = lambda ts: next((geo[t] for t in ts if t in geo), None)

    out = {}
    for i in ids:
        e, p = espn[i], parsed[i]
        rec = {"name": e["name"], "checked": today, "wiki": titles.get(i), "teams": e["teams"]}
        rec["town"] = {"t": e["town_text"], "at": first(p["town_tries"])} if e["town_text"] else None
        rec["born"] = {"t": re.sub(r",\s*(?:U\.S\.A?\.?|USA|United States)$", "", p["born"]), "at": first(p["born_tries"])} if p["born"] else None
        rec["hs"] = [{"n": h["name"], "t": h["place"], "at": first(h["titles"]), "prep": h["prep"]} for h in p["hs"]]
        rec["col"] = [{"n": c["name"], "y": c["years"], "t": (city.get(c["tid"]) or [None])[0], "at": first(city.get(c["tid"]) or []), "espn": c["espn"]} for c in p["col"]]
        out[i] = rec
    return out


def to_refresh(ids, players: dict, today: str, limit) -> list:
    """New players first, then the oldest past STALE_DAYS."""
    cut = (date.fromisoformat(today) - timedelta(days=STALE_DAYS)).isoformat()
    new = [i for i in ids if i not in players]
    old = sorted((i for i in ids if i in players and players[i]["checked"] <= cut), key=lambda i: players[i]["checked"])
    return (new + old)[:limit] if limit else new + old


# ---- has he faced them since leaving? ----
def games_since(logs: list, opp_id: int) -> dict:
    """ESPN game logs (a season each, oldest first) -> his last game FOR the team and every game AGAINST it
    since. Preseason never counts. Dates are cut to the minute with a Z, like the schedule's start_utc."""
    played = []
    for d in logs:
        real = {str(ev.get("eventId")) for t in d.get("seasonTypes") or [] if "preseason" not in (t.get("displayName") or "").lower()
                for c in t.get("categories") or [] for ev in c.get("events") or []}
        played += [e for k, e in (d.get("events") or {}).items() if k in real]
    when = lambda e: (e.get("gameDate") or "")[:16] + "Z"
    left = max((when(e) for e in played if str((e.get("team") or {}).get("id")) == str(opp_id)), default="")
    vs = sorted([when(e), e.get("atVs")] for e in played if str((e.get("opponent") or {}).get("id")) == str(opp_id) and when(e) > left)
    return {"left": left, "games": vs}


def read_meeting(pid, opp_id, last, season, today):
    url = ESPN_ATHLETE.format(pid=pid) + "/gamelog?season={y}"
    try:
        logs = [_json(url.format(y=y)) for y in range(last, season + 1)]
    except RuntimeError:
        return None
    return {**games_since(logs, opp_id), "checked": today}


# ---- the three spots ----
def season_text(year: int) -> str:
    return f"{year - 1}-{str(year)[2:]}"


def former_team(rec: dict, team_id: int):
    rows = [r for r in rec.get("teams", []) if r[1] == team_id and r[2] > 0]
    if not rows:
        return None
    years = sorted({r[0] for r in rows})
    return {"gp": sum(r[2] for r in rows), "first": years[0], "last": years[-1]}


def seasons_ago(x: dict, season: int) -> str:
    n = season - x["last"]
    return "This Season" if n <= 0 else "Last Season" if n == 1 else f"{n} Seasons Ago"


def revenge_tag(meeting, on_road: bool, start: str, neutral: bool):
    """First Game Back (at their building) / First Time Facing Them; None when he has been there, or unknown."""
    if not meeting:
        return None
    before = [m for m in meeting["games"] if m[0] < start]
    back = on_road and not neutral
    if not before:
        return "First Game Back" if back else "First Time Facing Them"
    return "First Game Back" if back and not any(m[1] == "@" for m in before) else None


def _near(at, home, own) -> bool:
    """Within reach of tonight's arena, closest to it of all 30, and not also his own team's backyard."""
    if not at or miles(at, ARENAS[home]) > NEAR_MILES or miles(at, ARENAS[own]) <= NEAR_MILES:
        return False
    return min(ARENAS, key=lambda t: miles(at, ARENAS[t])) in (home, SAME_CITY.get(home))


def hometown(rec: dict, home: str, own: str):
    """Two of ESPN's place, Wikipedia's birthplace and a local high school near here, and any local school
    he has on file must be near too (Bam Adebayo: both say Newark, his high schools are in North Carolina)."""
    town, born = rec.get("town") or {}, rec.get("born") or {}
    local = [h for h in rec.get("hs", []) if h.get("at") and not h["prep"]]
    school = next((h for h in local if _near(h["at"], home, own)), None)
    if local and not school:
        return None
    hits = [x for x in (town, born, school) if x and _near(x.get("at"), home, own)]
    return {"place": hits[0]["t"], "school": school["n"] if school else None} if len(hits) >= 2 else None


def game_stories(g: dict, rotations: dict, players: dict, meetings: dict, team_ids: dict, season: int, neutral=False) -> dict:
    """One game's three lists, every rotation player: the page drops whoever is Out / Doubtful that minute.
    Hometown and College are None at a neutral site (no home arena to measure from)."""
    home, away = g["home"], g["away"]
    out = {"revenge": [], "hometown": None if neutral else [], "college": None if neutral else []}
    for team, opp in ((away, home), (home, away)):
        for p in rotations.get(team, []):
            pid, rec = p["id"], players.get(p["id"])
            if not rec:
                continue
            who = {"id": pid, "name": p["name"], "pos": p.get("position") or "", "team": team}
            hide = HIDE.get(pid, ())
            x = former_team(rec, team_ids[opp])
            if x and "revenge" not in hide:
                span = season_text(x["first"]) if x["first"] == x["last"] else f"{season_text(x['first'])} To {season_text(x['last'])}"
                tag = revenge_tag(meetings.get(f"{pid}:{opp}"), team == away, g.get("start_utc", ""), neutral)
                out["revenge"].append({**who, "opp": opp, "gp": x["gp"], "span": span, "ago": seasons_ago(x, season), "last": x["last"], "tag": tag})
            if neutral or team != away:
                continue  # home players aren't traveling back anywhere
            spot = hometown(rec, home, team)
            if spot and "hometown" not in hide:
                out["hometown"].append({**who, **spot})
            if "college" not in hide:
                for c in rec.get("col", []):
                    if _near(c.get("at"), home, team):
                        out["college"].append({**who, "school": c["n"], "years": c.get("y"), "place": c.get("t")})
    out["revenge"].sort(key=lambda r: (not r["tag"], -r.pop("last"), -r["gp"]))  # first timers, then the most recent
    return out


# ---- the saved file and the build's one call ----
def load(season: int) -> dict:
    path = HISTORY / f"{season}.json"
    store = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {"players": store.get("players", {}), "meetings": store.get("meetings", {})}


def save(season: int, store: dict):
    """A line a player, so the bot's commits stay small."""
    def block(d):
        return ",\n".join(f"{json.dumps(k)}:{json.dumps(d[k], ensure_ascii=False, separators=(',', ':'), sort_keys=True)}" for k in sorted(d))
    HISTORY.mkdir(parents=True, exist_ok=True)
    (HISTORY / f"{season}.json").write_text('{"players":{\n' + block(store["players"]) + '\n},\n"meetings":{\n' + block(store["meetings"]) + "\n}}\n", encoding="utf-8")


def _wanted_meetings(games, rotations, players, team_ids, season, today):
    last_day = (date.fromisoformat(today) + timedelta(days=DAYS_AHEAD)).isoformat()
    wanted = {}
    for g in games:
        if not today <= g["date"] <= last_day:
            continue
        for team, opp in ((g["away"], g["home"]), (g["home"], g["away"])):
            for p in rotations.get(team, []):
                rec = players.get(p["id"])
                x = former_team(rec, team_ids[opp]) if rec else None
                if x and season - x["last"] <= TAG_SEASONS:
                    wanted[f"{p['id']}:{opp}"] = (p["id"], team_ids[opp], x["last"])
    return wanted


def update(store, games, rotations, roster_ids, team_ids, season, today, limit=MAX_REFRESH):
    ids = sorted({str(i) for i in roster_ids} | {p["id"] for ps in rotations.values() for p in ps})
    todo = to_refresh(ids, store["players"], today, limit)
    if todo:
        store["players"].update(refresh_players(todo, store["players"], today))
    wanted = _wanted_meetings(games, rotations, store["players"], team_ids, season, today)
    todo = [k for k in wanted if (store["meetings"].get(k) or {}).get("checked") != today]
    with ThreadPoolExecutor(6) as ex:
        for k, m in zip(todo, ex.map(lambda k: read_meeting(*wanted[k], season, today), todo)):
            if m:
                store["meetings"][k] = m
    cut = (date.fromisoformat(today) - timedelta(days=21)).isoformat()
    store["meetings"] = {k: m for k, m in store["meetings"].items() if m["checked"] >= cut}


def block(season: int, games: list, rotations: dict, teams: dict, roster_ids, neutral_ids, today: str, refresh=True) -> dict:
    """data.json `narrative`. A source being down costs only freshness: the saved facts still draw the box."""
    store = load(season)
    team_ids = {k: t["id"] for k, t in teams.items()}
    if refresh:
        try:
            update(store, games, rotations, roster_ids, team_ids, season, today)
        except Exception as ex:
            print(f"WARNING: Narrative sources weren't refreshed ({ex!r}).", file=sys.stderr)
        save(season, store)
    if not store["players"]:
        return None
    neutral_ids = {str(i) for i in neutral_ids}
    return {"games": {g["game_id"]: game_stories(g, rotations, store["players"], store["meetings"], team_ids, season, g["game_id"] in neutral_ids)
                      for g in games if g["home"] in ARENAS and g["away"] in ARENAS}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--seed", action="store_true", help="re-read every player now")
    ap.add_argument("--site", type=Path, default=Path("nfl_tool/site/nba/data.json"))
    ap.add_argument("--rosters", type=Path, default=Path("data/nba/rosters_{season}.parquet"))
    args = ap.parse_args()
    import pandas as pd
    data = json.loads(args.site.read_text(encoding="utf-8"))
    roster = pd.read_parquet(str(args.rosters).format(season=args.season))["athlete_id"].dropna().astype(int).astype(str)
    store = load(args.season)
    if args.seed:
        store["players"] = {}
    today = date.today().isoformat()
    update(store, data["schedule"], data["players"], roster, {k: t["id"] for k, t in data["teams"].items()}, args.season, today, limit=None)
    save(args.season, store)
    print(f"Saved {len(store['players'])} players, {len(store['meetings'])} meetings")


if __name__ == "__main__":
    main()
