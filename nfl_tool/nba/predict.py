"""Game Predictions: the League Stats Chart's numbers cooked into a score.

The owner, 2026-10-30: "we have a lot of ingredients right now - high quality
ones - with no recipes", and "weighting their ability ... with the defense
they are facing and what they are likely to surrender". Every ingredient is
turned into the one currency the game is decided in, points:

- each number for tonight = league average + (the offense's number - average)
  + (what the defense allows - average), both pulled toward the league average
  until a team has played enough games for it to mean something (`SHRINK`, in
  games: a shot mix settles in a few games, three-point making takes many);
- shooting, zone by zone (threes, the paint, mid-range): how often it shoots
  there against the zone's average worth (`mix`), and how well it makes them
  (`makes`); turnovers (a lost possession); the offensive glass (an extra
  possession on a miss); free throws (trips, and how well it shoots them);
- "Everything Else": what a team's real rating has that those rows don't
  (and-ones, timing, luck), pulled hard toward zero;
- pace sets how many possessions there are to score on; home court is
  `HOME_EDGE` points.

Transition and ball movement are not rows of their own: they are HOW the
shots and turnovers happen, so their points are already inside those rows
(counting them again would count the same points twice).

Fair chances: the margin and the total on a bell curve (`MARGIN_SD`,
`TOTAL_SD`, the NBA's usual misses against a closing line). This season's
numbers only (the owner's rule); the two curve widths and HOME_EDGE are
long-standing basketball constants, not last season's data.
"""

from math import erf, sqrt

# Games of real numbers before a team's own number counts half (the rest is league average).
SHRINK = {"pace": 3, "3par": 3, "paint_share": 3, "mid_share": 3, "tov": 6, "reb": 6, "ftr": 6,
          "paint_pct": 8, "mid_pct": 12, "3pct": 15, "ftpct": 20, "rest": 10}
SHRINK_DEF = {"3pct": 30}  # what a defense allows from three is mostly the shooters' luck
HOME_EDGE = 2.0
MARGIN_SD = 12.0
TOTAL_SD = 18.0
ROWS = ("threes", "paint", "mid", "tov", "glass", "ft", "rest")


def _value(row: dict, side: str, key: str):
    """A team's number; the defense's offensive-rebound number is what it allows (1 - its own)."""
    if key == "reb" and side == "d":
        v = row.get("d_reb")
        return None if v is None else 1 - v
    return row.get("pace") if key == "pace" else row.get(f"{side}_{key}")


class League:
    def __init__(self, table: dict):
        self.table = table
        self.avg = {}
        for side in ("o", "d"):
            for key in list(SHRINK) + ["rtg", "fgapp"]:
                vals = [v for r in table.values() if (v := _value(r, side, key)) is not None]
                self.avg[side, key] = sum(vals) / len(vals) if vals else None

    def own(self, team: str | None, side: str, key: str, shrink: bool = True) -> float:
        """The team's number pulled toward the league average (None team = an average team)."""
        avg = self.avg[side, key]
        row = self.table.get(team) if team else None
        v = _value(row, side, key) if row else None
        if v is None:
            return avg
        if not shrink:
            return v
        k = (SHRINK_DEF if side == "d" else {}).get(key, SHRINK[key])
        g = row.get("games") or 0
        return avg + (v - avg) * g / (g + k)

    def matchup(self, off: str | None, dfn: str | None, key: str, shrink: bool = True) -> float:
        """Tonight's number: the offense's own plus what the defense allows, each against the average."""
        d = 0.0 if key == "ftpct" else self.own(dfn, "d", key, shrink) - self.avg["d", key]  # a defense can't miss its free throws for them
        return self.own(off, "o", key, shrink) + d

    def per100(self, off: str | None, dfn: str | None, shrink: bool = True) -> dict:
        """Points a 100 possessions against an average offense, row by row (no `rest`)."""
        m = lambda k: self.matchup(off, dfn, k, shrink)
        a = lambda k: self.avg["o", k]
        fga = 100 * a("fgapp")
        rtg = a("rtg")
        tov_l = a("tov")
        ppp = rtg / 100

        def shares(s3, sp, sm):
            rest = sp + sm
            return {"threes": s3, "paint": (1 - s3) * sp / rest, "mid": (1 - s3) * sm / rest}

        worth = {"threes": 3, "paint": 2, "mid": 2}
        pct_key = {"threes": "3pct", "paint": "paint_pct", "mid": "mid_pct"}
        s_l = shares(a("3par"), a("paint_share"), a("mid_share"))
        s_m = shares(m("3par"), m("paint_share"), m("mid_share"))
        pps_l = sum(s_l[z] * worth[z] * a(pct_key[z]) for z in worth)
        fg_l = sum(s_l[z] * a(pct_key[z]) for z in worth)
        out = {}
        for z in worth:
            p_l, p_m = a(pct_key[z]), m(pct_key[z])
            mix = fga * (s_m[z] - s_l[z]) * (worth[z] * p_l - pps_l)
            makes = fga * s_m[z] * worth[z] * (p_m - p_l)
            out[z] = {"mix": mix, "makes": makes, "pts": mix + makes}
        out["tov"] = {"pts": -(m("tov") - tov_l) * 100 * ppp / (1 - tov_l)}
        out["glass"] = {"pts": fga * (1 - fg_l) * (m("reb") - a("reb")) * ppp}
        trips = fga * (m("ftr") - a("ftr")) * a("ftpct")
        shooting = fga * m("ftr") * (m("ftpct") - a("ftpct"))
        out["ft"] = {"pts": trips + shooting, "trips": trips, "shooting": shooting}
        return out

    def leftover(self, team: str, side: str) -> float:
        """What the team's real rating has that the rows don't (unshrunk rows, so it isn't noise put back)."""
        rows = self.per100(team, None, False) if side == "o" else self.per100(None, team, False)
        explained = self.avg["o", "rtg"] + sum(r["pts"] for r in rows.values())
        real = self.table[team].get(f"{side}_rtg")
        if real is None:
            return 0.0
        # the defense's rows are from the offense's side: allowing more is a positive row
        g = self.table[team].get("games") or 0
        return (real - explained) * g / (g + SHRINK["rest"])


def norm_cdf(z: float) -> float:
    return 0.5 * (1 + erf(z / sqrt(2)))


def fair_american(p: float | None):
    if p is None or p <= 0 or p >= 1:
        return None
    return round(-100 * p / (1 - p)) if p >= 0.5 else round(100 * (1 - p) / p)


def implied(price) -> float | None:
    """A book price's chance (its vig left in)."""
    if price is None:
        return None
    price = float(price)
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def predict(table: dict, away: str, home: str, game: dict | None = None) -> dict | None:
    """One game: {rows: [[key, away pts, home pts, detail]], poss, pts, margin (home), total, fair, book}."""
    if away not in table or home not in table:
        return None
    lg = League(table)
    if any(lg.avg["o", k] is None for k in list(SHRINK) + ["rtg", "fgapp"] if k != "rest"):
        return None  # a number missing league-wide (an older data file): no prediction rather than a wrong one
    pace_l = lg.avg["o", "pace"]
    # a game's pace: each team's own (its games' possessions), both against the average
    poss = pace_l + (lg.own(away, "o", "pace") - pace_l) + (lg.own(home, "o", "pace") - pace_l)
    scale = poss / 100
    base = lg.avg["o", "rtg"]
    sides = {}
    for o, d in ((away, home), (home, away)):
        rows = lg.per100(o, d)
        rows["rest"] = {"pts": lg.leftover(o, "o") + lg.leftover(d, "d")}
        sides[o] = rows
    out_rows = [["base", round(pace_l / 100 * base, 1), round(pace_l / 100 * base, 1), None],
                ["pace", round((poss - pace_l) / 100 * base, 1), round((poss - pace_l) / 100 * base, 1), None]]
    for key in ROWS:
        a, h = sides[away][key], sides[home][key]
        detail = None
        if "mix" in a:
            detail = [[round(a["mix"] * scale, 1), round(a["makes"] * scale, 1)], [round(h["mix"] * scale, 1), round(h["makes"] * scale, 1)]]
        elif "trips" in a:
            detail = [[round(a["trips"] * scale, 1), round(a["shooting"] * scale, 1)], [round(h["trips"] * scale, 1), round(h["shooting"] * scale, 1)]]
        out_rows.append([key, round(a["pts"] * scale, 1), round(h["pts"] * scale, 1), detail])
    out_rows.append(["home", -HOME_EDGE / 2, HOME_EDGE / 2, None])
    pts = [scale * (base + sum(sides[t][k]["pts"] for k in ROWS)) for t in (away, home)]
    pts = [pts[0] - HOME_EDGE / 2, pts[1] + HOME_EDGE / 2]
    margin = pts[1] - pts[0]
    total = pts[0] + pts[1]
    res = {"away": away, "home": home, "poss": round(poss, 1), "rows": out_rows,
           "pts": [round(p, 1) for p in pts], "margin": round(margin, 1), "total": round(total, 1)}
    res.update(odds(margin, total, game or {}))
    return res


def odds(margin: float, total: float, g: dict) -> dict:
    """Fair chances and prices at the book's numbers (or ours with no line), beside the book's."""
    book = {"spread": [g.get("away_team_spread"), g.get("home_team_spread")],
            "spread_odds": [g.get("away_spread_odds"), g.get("home_spread_odds")],
            "total": g.get("total_line"), "total_odds": [g.get("over_odds"), g.get("under_odds")],
            "ml": [g.get("away_moneyline"), g.get("home_moneyline")]}
    home_spread = book["spread"][1]
    p_home_cover = norm_cdf((margin + home_spread) / MARGIN_SD) if home_spread is not None else None
    p_home_win = norm_cdf(margin / MARGIN_SD)
    p_over = norm_cdf((total - book["total"]) / TOTAL_SD) if book["total"] is not None else None
    pair = lambda p: None if p is None else [round(1 - p, 4), round(p, 4)]
    fair = {"spread": pair(p_home_cover), "ml": pair(p_home_win),
            "total": None if p_over is None else [round(p_over, 4), round(1 - p_over, 4)]}
    return {"fair": fair, "book": book, "fair_spread": round(-margin, 1)}


def plays(p: dict) -> list:
    """The model's side in each market, its chance and edge (chance - the book price's), for the record."""
    out = []
    book, fair = p["book"], p["fair"]
    for market, chances, prices in (("spread", fair["spread"], book["spread_odds"]), ("total", fair["total"], book["total_odds"]),
                                    ("ml", fair["ml"], book["ml"])):
        if not chances:
            continue
        side = 0 if chances[0] >= chances[1] else 1
        if market == "ml":  # the side whose chance beats its price by more (a favorite can be the wrong price)
            edges = [chances[i] - (implied(prices[i]) or 0.5) if prices[i] is not None else None for i in (0, 1)]
            if None in edges:
                continue
            side = 0 if edges[0] >= edges[1] else 1
        price = prices[side] if prices[side] is not None else (-110 if market != "ml" else None)
        if price is None:
            continue
        out.append({"market": market, "side": side, "chance": chances[side], "price": price,
                    "edge": round(chances[side] - implied(price), 4)})
    return out


def grade(play: dict, rec: dict) -> float | None:
    """1 win, 0 loss, None push / no line."""
    a, h = rec["result"]
    book = rec["book"]
    if play["market"] == "ml":
        return float((h > a) == (play["side"] == 1))
    if play["market"] == "spread":
        line = book["spread"][play["side"]]
        mine, theirs = (a, h) if play["side"] == 0 else (h, a)
        diff = mine + line - theirs
    else:
        diff = (a + h - book["total"]) * (1 if play["side"] == 0 else -1)
    return None if diff == 0 else float(diff > 0)


def units(price: float, won: float) -> float:
    if not won:
        return -1.0
    return price / 100 if price > 0 else 100 / -price
