"""Projected lineups for the NHL build, from NHL.com's projected-lineups stories.

Split out of build_nhl.py on 2026-11-23 (moved verbatim)."""
import re
from datetime import datetime, timedelta

from nhl_games import _request, utc_text
from nhl_stats import lineup
from nhl_prices import team_namer
# The NHL's own "projected lineups" story for each game (NHL.com's game
# preview: tonight's forward lines, defense pairs, goalies, scratches and
# injuries), usually posted around midday Eastern on game day.
STORIES = "https://forge-dapi.d3.nhle.com/v2/content/en-us/stories"


# ---- tonight's lines (the NHL's projected lineups) ----
def parse_lineups(markdown: str) -> dict:
    """The NHL's "projected lineups" story as {team label: lineup}. The story
    is plain text: a "<Team> projected lineup" heading, then one line of text
    per forward line ("A -- B -- C") and defense pair ("A -- B"), then the
    goalies one to a line (the first is the expected starter), then
    "Scratched:" and "Injured:". A lineup is {"groups": [[names]], "goalies":
    [names], "scratched": [names], "injured": [names]}."""
    out, team = {}, None
    # The story is typed by hand: non-breaking spaces, curly apostrophes and
    # long dashes turn up where plain ones are meant.
    tidy = markdown.replace("\u00a0", " ").replace("\u2019", "'").replace("\u2018", "'")
    tidy = re.sub("\\s+[\u2013\u2014]\\s+", " -- ", tidy)
    for raw in tidy.splitlines():
        text = re.sub(r"[*#_]", "", raw).strip()
        if not text:
            continue
        heading = re.match(r"^(.+?) projected lineup$", text, re.IGNORECASE)
        if heading:
            team = out.setdefault(heading.group(1).strip(), {"groups": [], "goalies": [], "scratched": [], "injured": []})
        elif re.match(r"^status report", text, re.IGNORECASE):
            team = None
        elif team is not None:
            label, colon, rest = text.partition(":")
            if colon and label.strip().lower() in ("scratched", "injured", "suspended"):
                # "Kirby Dach (broken foot), Alex Newhook (broken ankle)": the reasons go, the names stay.
                names = [n.strip() for n in re.sub(r"\([^)]*\)", "", rest).split(",") if n.strip() and n.strip().lower() != "none"]
                team["scratched" if label.strip().lower() == "scratched" else "injured"].extend(names)
            elif "--" in text:
                # Split on the dashes alone: the story is typed by hand ("Tony DeAngelo --Scott Mayfield").
                team["groups"].append([n.strip() for n in text.split("--") if n.strip()])
            elif not colon and len(text.split()) <= 4:
                team["goalies"].append(text)
    return out


def lineup_slots(lineup: dict, team: str, find, positions: dict) -> dict:
    """One team's parsed lineup with the NHL's player ids: {"skaters":
    {player id: slot}, ...}. A slot is "F1" (first line) to "F4" or "D1"
    (first pair) to "D3", read from the order the story lists them. A group
    is a defense pair if its players are defensemen (by this season's
    position; two names nobody knows yet count as a pair, three as a line).

    Names on a line of their own are the two goalies, starter first, but not
    always only them: a team dressing seven defensemen lists the seventh on
    his own line above the goalies ("Victor Hedman", Tampa Bay, 2026-10-13).
    A lone name the site knows as a skater, or any lone name before the last
    two, is a skater in the lineup with no line or pair (slot None)."""
    skaters, unknown, counts = {}, [], {"F": 0, "D": 0}
    alone = [(find(team, name), name) for name in lineup["goalies"]]
    in_net = [(pid, name) for pid, name in alone if pid not in positions]
    extra = [(pid, name) for pid, name in alone if pid in positions] + in_net[:-2]
    in_net = in_net[-2:]
    for names in lineup["groups"]:
        ids = [find(team, name) for name in names]
        known = [positions[pid] for pid in ids if pid in positions]
        defense = sum(pos == "D" for pos in known) > len(known) / 2 if known else len(names) == 2
        kind = "D" if defense else "F"
        counts[kind] += 1
        for pid, name in zip(ids, names):
            if pid:
                skaters[pid] = f"{kind}{counts[kind]}"
            else:
                unknown.append(name)
    for pid, name in extra:
        if pid:
            skaters.setdefault(pid, None)
        else:
            unknown.append(name)
    return {
        "skaters": skaters, "unknown": unknown, "lines": lineup["groups"],
        "goalie": (in_net[0][0] or in_net[0][1]) if in_net else None,
        "scratched": lineup["scratched"], "injured": lineup["injured"],
        "out": [pid for pid in (find(team, name) for name in lineup["scratched"] + lineup["injured"]) if pid],
    }


def _lineup_story(item: dict) -> dict | None:
    story = _request(item["selfUrl"], tries=2, timeout=12)
    text = "\n".join(part.get("content") or "" for part in story.get("parts") or [] if part.get("type") == "markdown")
    if "projected lineup" not in text.lower():
        return None
    return {"posted": utc_text((item.get("lastUpdatedDate") or item["contentDate"])[:19] + "Z"), "markdown": text}


def fetch_lineup_story(game_id, wanted=None, fallback=None) -> dict | None:
    """{"posted", "markdown"} for one game's projected-lineups story, or None
    if it isn't up yet. Short waits: this is asked for every game on the
    slate, and a slow day at NHL.com must not hold up the deploy.
    `wanted(markdown)` says whether a story is about THIS game: NHL.com tags
    them by hand, and on 2026-10-22 it tagged Red Wings at Canucks with Utah at
    Seattle's game id (and gave the Canucks game none), so both games went the
    night with no lineup. `fallback()` = the day's other preview stories, read
    when this game's own tag has no story that fits."""
    listing = _request(f"{STORIES}?tags.slug=gameid-{game_id}&tags.slug=game-preview&context.slug=nhl&$limit=5", tries=2, timeout=12)
    for item in listing.get("items") or []:
        story = _lineup_story(item)
        if story and (wanted is None or wanted(story["markdown"])):
            return story
    for story in (fallback() if fallback and wanted else []):
        if wanted(story["markdown"]):
            return story
    return None


def day_lineup_stories(date: str) -> list:
    """Every projected-lineups story NHL.com has posted for one day's games (its
    slugs end "-game-preview-october-22-2026"), newest first."""
    stamp = datetime.strptime(date, "%Y-%m-%d")
    suffix = f"-game-preview-{stamp.strftime('%B').lower()}-{stamp.day}-{stamp.year}"
    listing = _request(f"{STORIES}?tags.slug=game-preview&context.slug=nhl&$limit=40", tries=2, timeout=12)
    stories = []
    for item in listing.get("items") or []:
        if not (item.get("selfUrl") or "").endswith(suffix):
            continue
        story = _lineup_story(item)
        if story:
            stories.append(story)
    return stories


def fetch_lineups(games: list, teams: dict, find, positions: dict, now_utc: datetime) -> tuple:
    """({game id: {"posted", team: lineup_slots(...)}}, error) for games that
    haven't started and are close enough to have a story. Never raises: with
    no story the Shots page falls back to each player's recent minutes."""
    team_of = team_namer(teams)
    last_day = (now_utc - timedelta(hours=4) + timedelta(days=1)).strftime("%Y-%m-%d")
    out, error, failed = {}, None, 0
    by_day = {}  # the day's preview stories, read once and only if a game's own tag misses

    def day_stories(date):
        if date not in by_day:
            by_day[date] = day_lineup_stories(date)
        return by_day[date]

    for g in games:
        if g["status"] == "final" or g["date"] > last_day or datetime.strptime(g["start_utc"], "%Y-%m-%dT%H:%MZ") <= now_utc:
            continue
        if failed >= 2:
            break  # the stories aren't answering: stop asking, the rest fall back too
        try:
            # A story is this game's only if every team it lists plays in it.
            def wanted(text, g=g):
                named = {team_of(label) for label in parse_lineups(text)} - {None}
                return bool(named) and named <= {g["away"], g["home"]}
            story = fetch_lineup_story(g["game_id"], wanted, lambda g=g: day_stories(g["date"]))
            failed = 0
            if not story:
                continue
            entry = {"posted": story["posted"]}
            for label, lineup in parse_lineups(story["markdown"]).items():
                team = team_of(label)
                if team in (g["away"], g["home"]) and lineup["groups"]:
                    entry[team] = lineup_slots(lineup, team, find, positions)
            if len(entry) > 1:
                out[g["game_id"]] = entry
        except Exception as e:  # one game's story must never cost the others theirs
            error, failed = f"{g['game_id']}: {e}", failed + 1
    return out, error


def lineups_for_page(tonight: dict, goalies: dict) -> dict:
    """Tonight's lines as posted, for the page to show a player's linemates,
    who is hurt or scratched, and who is expected in net: {game id:
    {"posted", team: {"lines": [[names]], "goalie", "scratched", "injured"}}}."""
    name = lambda who: (goalies.get(who) or {}).get("name") or who
    return {
        gid: {"posted": entry["posted"], **{team: {"lines": posted["lines"], "goalie": name(posted["goalie"]), "scratched": posted["scratched"], "injured": posted["injured"]} for team, posted in entry.items() if team != "posted"}}
        for gid, entry in tonight.items()
    }
