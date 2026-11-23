"""Player numbers for the NFL build: snap shares, the injury report, target
ranks, TD scorers, game logs and box scores.

Split out of build_stats.py on 2026-11-23 (moved verbatim)."""
import re

import pandas as pd

from nfl_common import EXPLOSIVE_RUSH_YARDS, LENGTH_BUCKETS, bucket_position, pass_depth_bucket, position_group
from nfl_lines import _norm_player


def compute_player_snap_shares(snap_counts: pd.DataFrame) -> dict:
    """Season-long (so far) offensive/defensive snap share per player,
    from real nflverse/Pro-Football-Reference weekly snap-count data (see
    load_snap_counts) -- published weekly during the season, unlike the
    official participation file's own offense_players/defense_players
    columns this used to read from. Used to flag whether an injured player
    is a real regular contributor or a deep
    backup/special-teamer. A two-way player's higher of the two shares
    wins, same as before this swapped data sources. Averaged across
    however many weeks the player has a row for so far this season (PFR's
    own offense_pct/defense_pct are already per-game rates)."""
    df = snap_counts.dropna(subset=["player"])
    grouped = df.groupby(["team", "player"])[["offense_pct", "defense_pct"]].mean().fillna(0.0)
    shares = {}
    for (team, name), row in grouped.iterrows():
        share = max(row["offense_pct"], row["defense_pct"])
        shares.setdefault(team, {})[name] = round(float(share), 3)
    return shares


def compute_player_weekly_snaps(snap_counts: pd.DataFrame) -> dict:
    """Offensive snap share per game for skill players:
    {team: {player: {"pos": "WR", "w": {week: pct}}}}. The Player Props
    Summary uses it to spot games a player left early (a 31% game after
    76% the week before) and games a regular teammate missed (a WR2's
    numbers the week the WR1 sat out), so neither skews a baseline."""
    df = snap_counts.dropna(subset=["player"])
    df = df[df["position"].isin(["QB", "RB", "FB", "WR", "TE"]) & (df["offense_snaps"] > 0)]
    out: dict = {}
    for row in df.itertuples(index=False):
        entry = out.setdefault(row.team, {}).setdefault(row.player, {"pos": "RB" if row.position == "FB" else row.position, "w": {}})
        entry["w"][int(row.week)] = round(float(row.offense_pct), 2)
    return out

def compute_injury_report(injuries_df: pd.DataFrame, teams, snap_shares: dict) -> dict:
    """{team: {week: [ {full_name, position, position_group, report_status,
    practice_status, status, status_source, snap_share} ]}}. status/
    status_source precompute the report_status-else-practice_status
    fallback -- early in the week the official Q/D/O designation is often
    still blank while the practice-participation status is already
    posted. snap_share (see compute_player_snap_shares) lets the frontend
    flag a real starter vs. a deep backup/special-teamer -- None when the
    player hasn't logged a charted snap yet (name-format mismatch between
    the injury report and pbp, or truly hasn't played)."""
    result = {t: {} for t in teams}
    team_lookups = {t: _snap_share_lookup(shares) for t, shares in snap_shares.items()}
    for row in injuries_df.itertuples(index=False):
        if row.team not in result:
            continue
        report = row.report_status if pd.notna(row.report_status) and row.report_status else None
        practice = row.practice_status if pd.notna(row.practice_status) and row.practice_status else None
        entry = {
            "full_name": row.full_name,
            "position": row.position,
            "position_group": position_group(row.position),
            "report_status": report,
            "practice_status": practice,
            "status": report or practice,
            "status_source": "report" if report else ("practice" if practice else None),
            "snap_share": team_lookups.get(row.team, _snap_share_lookup({}))(row.full_name),
        }
        result[row.team].setdefault(str(int(row.week)), []).append(entry)
    return result


def _snap_share_lookup(shares: dict):
    """One team's name -> snap share, forgiving the spellings the injury
    report and the snap counts disagree on: "Pat Surtain II" vs "Patrick
    Surtain II", "Cam Lewis" vs "Cameron Lewis", "D.J. Moore" vs "DJ Moore",
    "Michael Pittman" vs "Michael Pittman Jr.". Exact name first, then the
    name without punctuation or suffix, then last name + first initial when
    only one player on the team fits it. A miss hid injured starters from
    the Summary card (snap_share None reads as "not a starter")."""
    def last_and_initial(name):
        words = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", (name or "").lower()).replace(".", "").split()
        return (words[-1], words[0][0]) if len(words) >= 2 else None

    by_norm, by_last = {}, {}
    for name, share in shares.items():
        by_norm.setdefault(_norm_player(name), []).append(share)
        key = last_and_initial(name)
        if key:
            by_last.setdefault(key, []).append(share)

    def lookup(name):
        if name in shares:
            return shares[name]
        for found in (by_norm.get(_norm_player(name)), by_last.get(last_and_initial(name))):
            if found and len(found) == 1:
                return found[0]
        return None
    return lookup


def compute_target_ranks(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Season-long target rank within each team's own WR corps (1 = most
    targeted), used to describe a scoring receiver's role in the TD
    breakdown modal -- e.g. a defense allowing a TD to someone's WR1 reads
    very differently than to their WR4. Ranked by raw target count, which
    orders identically to true target share (same team, same denominator),
    so there's no need to also compute team pass-attempt totals."""
    targets = pbp[pbp["pass_attempt"] == 1]
    tally = {}
    for _, row in targets.iterrows():
        pid = row.get("receiver_player_id")
        if pd.isna(pid):
            continue
        pos, _, _ = pos_lookup(pid, row["week"])
        if not pos or bucket_position(pos) != "WR":
            continue
        key = (row.get("posteam"), pid)
        tally[key] = tally.get(key, 0) + 1

    by_team = {}
    for (team, pid), count in tally.items():
        by_team.setdefault(team, []).append((pid, count))

    ranks = {}
    for players in by_team.values():
        players.sort(key=lambda x: -x[1])
        for i, (pid, _) in enumerate(players, start=1):
            ranks[pid] = i
    return ranks


def build_player_stats(scoring_df, first_td_by_game, teams, target_ranks):
    players = {}

    def blank_player(pid, name, team, pos):
        return {
            "player_id": pid,
            "name": name,
            "team": team,
            "position": pos,
            "tds": 0,
            "first_tds": 0,
            "dst_tds": 0,
            "rush_tds": 0,
            "rec_tds": 0,
            "tds_by_length": {key: 0 for key, _, _ in LENGTH_BUCKETS},
            "wr_rank": target_ranks.get(pid) if pos == "WR" else None,
        }

    def ensure(pid, name, team, pos):
        if pid not in players:
            players[pid] = blank_player(pid, name, team, pos)
        return players[pid]

    for _, row in scoring_df.iterrows():
        pid = row["scorer_id"]
        if pd.isna(pid):
            continue
        p = ensure(pid, row["scorer_name"], row["scoring_team"], row["position"])
        p["tds"] += 1
        if row["td_type"] == "dst":
            p["dst_tds"] += 1
        elif row["td_type"] == "rush":
            p["rush_tds"] += 1
        elif row["td_type"] == "pass":
            p["rec_tds"] += 1
        bucket = row.get("length_bucket")
        if bucket:
            p["tds_by_length"][bucket] += 1

    for game_id, info in first_td_by_game.items():
        pid = info["player_id"]
        if pd.isna(pid) or pid is None:
            continue
        if pid not in players:
            players[pid] = blank_player(pid, info["player_name"], info["team"], info["position"] or "DST")
        players[pid]["first_tds"] += 1

    by_team = {t: [] for t in teams}
    for p in players.values():
        if p["team"] in by_team:
            by_team[p["team"]].append(p)
    for t in by_team:
        by_team[t].sort(key=lambda p: (-p["tds"], -p["first_tds"], p["name"] or ""))
    return by_team


def compute_player_td_results(scoring_df, first_td_by_game) -> dict:
    """Per (week, team): full names that scored an offensive TD ("any_td")
    and whoever scored that game's very first TD ("first_td") -- lets the
    Possible Plays page auto-grade saved Anytime TD / First TD plays once a
    week's pbp data is in. Keyed by full_name, NOT gsis_id, since that's the
    only join key a saved play has (the books' odds rows carry a name, no
    gsis_id -- same limitation build_roster_position_lookup already
    documents); a handful of name-format mismatches are possible, same
    accepted tradeoff as everywhere else that joins across the two sources.
    """
    results = {}

    def bucket(week, team):
        if week is None or pd.isna(week) or not team:
            return None
        week = int(week)
        results.setdefault(week, {})
        results[week].setdefault(team, {"any_td": [], "first_td": []})
        return results[week][team]

    off_scores = scoring_df[scoring_df["td_type"].isin(["pass", "rush"])]
    for _, row in off_scores.iterrows():
        name = row["scorer_name"]
        if not name or pd.isna(name):
            continue
        b = bucket(row["week"], row["scoring_team"])
        if b is not None and name not in b["any_td"]:
            b["any_td"].append(name)

    for info in first_td_by_game.values():
        if not info.get("is_offense_td") or not info.get("player_name"):
            continue
        b = bucket(info.get("week"), info.get("team"))
        if b is not None and info["player_name"] not in b["first_td"]:
            b["first_td"].append(info["player_name"])

    return results


def compute_player_game_logs(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Per-game (not season-total) stat lines for every skill player with a
    qualifying snap that week -- powers the Player Props modal's "Game Log"
    view, and (via possible-plays.js's gradePlayerPropPlay) auto-grading
    saved player-prop O/U plays once the game is final. Keyed by (team,
    full_name), the same pos_lookup-derived name used to join
    build_player_props' own rows, so a click from either the props table
    or the odds modal resolves to the same player."""
    scrimmage = pbp[pbp["two_point_attempt"] != 1]
    targets = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["receiver_player_id"])
    rushes = scrimmage[scrimmage["rush_attempt"] == 1].dropna(subset=["rusher_player_id"])
    dropbacks = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["passer_player_id"])

    logs = {}

    def ensure(pid, team, week, opp):
        pos, _, name = pos_lookup(pid, week)
        if not name:
            return None
        key = (team, name)
        by_week = logs.setdefault(key, {})
        return by_week.setdefault(
            int(week),
            {
                "week": int(week),
                "opp": opp,
                "targets": 0, "receptions": 0, "rec_yards": 0.0, "rec_td": 0, "longest_rec": 0.0,
                "carries": 0, "rush_yards": 0.0, "rush_td": 0, "longest_rush": 0.0,
                "pass_att": 0, "completions": 0, "pass_yards": 0.0, "pass_td": 0, "interceptions": 0, "longest_pass": 0.0,
                # Extended per-game lines for the player popup's Game Log --
                # the same stats the Receiving/Rushing tables show for the
                # season, week by week (targets by depth use
                # PASS_DEPTH_BUCKETS, like the season columns).
                "air_yards": 0.0, "air_n": 0, "yac": 0.0, "rz_targets": 0,
                "tgt_deep": 0, "tgt_intermediate": 0, "tgt_short": 0, "tgt_screen": 0,
                "explosive_rushes": 0, "rz_carries": 0,
                "pass_air_yards": 0.0, "pass_air_n": 0,
            },
        )

    for row in targets.itertuples(index=False):
        g = ensure(row.receiver_player_id, row.posteam, row.week, row.defteam)
        if g is None:
            continue
        g["targets"] += 1
        if pd.notna(row.air_yards):
            g["air_yards"] += row.air_yards
            g["air_n"] += 1
            g["tgt_" + pass_depth_bucket(row.air_yards)] += 1
        if pd.notna(row.yardline_100) and row.yardline_100 <= 20:
            g["rz_targets"] += 1
        if row.complete_pass == 1:
            g["receptions"] += 1
            g["rec_yards"] += row.yards_gained
            if pd.notna(row.yards_after_catch):
                g["yac"] += row.yards_after_catch
            g["longest_rec"] = max(g["longest_rec"], row.yards_gained)
            if row.pass_touchdown == 1:
                g["rec_td"] += 1

    for row in rushes.itertuples(index=False):
        g = ensure(row.rusher_player_id, row.posteam, row.week, row.defteam)
        if g is None:
            continue
        g["carries"] += 1
        g["rush_yards"] += row.yards_gained
        g["longest_rush"] = max(g["longest_rush"], row.yards_gained)
        if row.yards_gained >= EXPLOSIVE_RUSH_YARDS:
            g["explosive_rushes"] += 1
        if pd.notna(row.yardline_100) and row.yardline_100 <= 20:
            g["rz_carries"] += 1
        if row.rush_touchdown == 1:
            g["rush_td"] += 1

    for row in dropbacks.itertuples(index=False):
        g = ensure(row.passer_player_id, row.posteam, row.week, row.defteam)
        if g is None:
            continue
        g["pass_att"] += 1
        if pd.notna(row.air_yards):
            g["pass_air_yards"] += row.air_yards
            g["pass_air_n"] += 1
        if row.complete_pass == 1:
            g["completions"] += 1
            g["pass_yards"] += row.yards_gained
            g["longest_pass"] = max(g["longest_pass"], row.yards_gained)
            if row.pass_touchdown == 1:
                g["pass_td"] += 1
        if row.interception == 1:
            g["interceptions"] += 1

    # Team targets per game, for each week's target share.
    team_targets = targets.groupby(["posteam", "week"]).size().to_dict()

    out = {}
    for (team, name), by_week in logs.items():
        rows = sorted(by_week.values(), key=lambda r: -r["week"])
        for r in rows:
            r["team_targets"] = int(team_targets.get((team, r["week"]), 0))
            r["air_yards"] = round(r["air_yards"], 1)
            r["yac"] = round(r["yac"], 1)
            r["pass_air_yards"] = round(r["pass_air_yards"], 1)
            r["rush_yards"] = round(r["rush_yards"], 0)
            r["rec_yards"] = round(r["rec_yards"], 0)
            r["pass_yards"] = round(r["pass_yards"], 0)
            r["longest_rec"] = round(r["longest_rec"], 0)
            r["longest_rush"] = round(r["longest_rush"], 0)
            r["longest_pass"] = round(r["longest_pass"], 0)
        out.setdefault(team, {})[name] = rows
    return out


def compute_player_box_scores(pbp: pd.DataFrame, pos_lookup) -> dict:
    """Per-game player box score: Passing/Rushing/Receiving/Defense stat
    lines for every player involved, grouped by (game_id, team) so a
    single game's full two-team box score can be pulled by game_id alone
    -- the shape a box-score modal needs (click one game, see both teams'
    complete stat lines), distinct from compute_player_game_logs (keyed
    by player, across the whole season).

    Defense follows nflverse's own tackle-crediting convention: a plain
    solo tackle or a "tackle with assist" (the primary tackler on a
    two-man tackle, credited with a full tackle) both count as SOLO here;
    the secondary player on that same play (a plain "assist" tackle)
    counts as ASSIST -- the same split a broadcast box score shows as
    e.g. "8 (6 solo, 2 ast)". Half-sacks aren't split out (sack_player_id
    only ever names one credited sacker in this data), so a shared sack
    shows as a full sack for the named player -- accepted simplification.
    """
    scrimmage = pbp[pbp["two_point_attempt"] != 1]
    targets = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["receiver_player_id"])
    rushes = scrimmage[scrimmage["rush_attempt"] == 1].dropna(subset=["rusher_player_id"])
    dropbacks = scrimmage[scrimmage["pass_attempt"] == 1].dropna(subset=["passer_player_id"])

    box = {}

    def player_row(game_id, team, category, pid, week, template):
        players = box.setdefault(game_id, {}).setdefault(team, {}).setdefault(category, {})
        if pid not in players:
            _, _, name = pos_lookup(pid, week)
            if not name:
                return None
            players[pid] = {"name": name, **template}
        return players[pid]

    for row in targets.itertuples(index=False):
        r = player_row(row.game_id, row.posteam, "receiving", row.receiver_player_id, row.week,
                        {"targets": 0, "receptions": 0, "yards": 0.0, "td": 0})
        if r is None:
            continue
        r["targets"] += 1
        if row.complete_pass == 1:
            r["receptions"] += 1
            r["yards"] += row.yards_gained
            if row.pass_touchdown == 1:
                r["td"] += 1

    for row in rushes.itertuples(index=False):
        r = player_row(row.game_id, row.posteam, "rushing", row.rusher_player_id, row.week,
                        {"carries": 0, "yards": 0.0, "td": 0})
        if r is None:
            continue
        r["carries"] += 1
        r["yards"] += row.yards_gained
        if row.rush_touchdown == 1:
            r["td"] += 1

    for row in dropbacks.itertuples(index=False):
        r = player_row(row.game_id, row.posteam, "passing", row.passer_player_id, row.week,
                        {"att": 0, "cmp": 0, "yards": 0.0, "td": 0, "int": 0})
        if r is None:
            continue
        r["att"] += 1
        if row.complete_pass == 1:
            r["cmp"] += 1
            r["yards"] += row.yards_gained
            if row.pass_touchdown == 1:
                r["td"] += 1
        if row.interception == 1:
            r["int"] += 1

    def_template = {"solo": 0, "assist": 0, "sacks": 0.0, "tfl": 0, "qb_hits": 0, "int": 0, "fumble_rec": 0}

    def bump_def(game_id, team, pid, week, field, amount=1):
        r = player_row(game_id, team, "defense", pid, week, def_template)
        if r is not None:
            r[field] += amount

    for row in scrimmage.itertuples(index=False):
        if pd.notna(row.solo_tackle_1_player_id):
            bump_def(row.game_id, row.defteam, row.solo_tackle_1_player_id, row.week, "solo")
        if pd.notna(row.solo_tackle_2_player_id):
            bump_def(row.game_id, row.defteam, row.solo_tackle_2_player_id, row.week, "solo")
        if pd.notna(row.tackle_with_assist_1_player_id):
            bump_def(row.game_id, row.defteam, row.tackle_with_assist_1_player_id, row.week, "solo")
        if pd.notna(row.tackle_with_assist_2_player_id):
            bump_def(row.game_id, row.defteam, row.tackle_with_assist_2_player_id, row.week, "solo")
        for i in (1, 2, 3, 4):
            pid = getattr(row, f"assist_tackle_{i}_player_id")
            if pd.notna(pid):
                bump_def(row.game_id, row.defteam, pid, row.week, "assist")
        if pd.notna(row.tackle_for_loss_1_player_id):
            bump_def(row.game_id, row.defteam, row.tackle_for_loss_1_player_id, row.week, "tfl")
        if pd.notna(row.tackle_for_loss_2_player_id):
            bump_def(row.game_id, row.defteam, row.tackle_for_loss_2_player_id, row.week, "tfl")
        if pd.notna(row.qb_hit_1_player_id):
            bump_def(row.game_id, row.defteam, row.qb_hit_1_player_id, row.week, "qb_hits")
        if pd.notna(row.qb_hit_2_player_id):
            bump_def(row.game_id, row.defteam, row.qb_hit_2_player_id, row.week, "qb_hits")
        if pd.notna(row.sack_player_id):
            bump_def(row.game_id, row.defteam, row.sack_player_id, row.week, "sacks", 1.0)
        if pd.notna(row.interception_player_id):
            bump_def(row.game_id, row.defteam, row.interception_player_id, row.week, "int")
        if pd.notna(row.fumble_recovery_1_player_id):
            bump_def(row.game_id, row.defteam, row.fumble_recovery_1_player_id, row.week, "fumble_rec")
        if pd.notna(row.fumble_recovery_2_player_id):
            bump_def(row.game_id, row.defteam, row.fumble_recovery_2_player_id, row.week, "fumble_rec")

    # Round accumulated yards, sort each category by its headline stat
    # (yards for offense, combined tackles for defense) so the frontend
    # can render straight through without re-sorting.
    for game_teams in box.values():
        for team_cats in game_teams.values():
            for category, players in team_cats.items():
                rows = list(players.values())
                for r in rows:
                    if "yards" in r:
                        r["yards"] = round(r["yards"], 0)
                if category == "defense":
                    rows.sort(key=lambda r: -(r["solo"] + r["assist"]))
                else:
                    rows.sort(key=lambda r: -r.get("yards", 0))
                team_cats[category] = rows

    return box
