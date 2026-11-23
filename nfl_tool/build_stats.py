#!/usr/bin/env python3
"""
Build the NFL TD Cheatsheet data blob from nflverse play-by-play + weekly roster data.

Usage:
    python3 build_stats.py --season 2026 --out site/data.json

Downloads the season's play-by-play and weekly-roster files from the public
nflverse-data GitHub release (no API key needed) into --data-dir (default
./data, gitignored) if they aren't already there, then computes, for each
team (regular season, to date):
  - Pass TD / Rush TD / Total TD, and defensive/special-teams (DST) TDs
    (pick-sixes, fumble/kick/punt/blocked-kick returns) -- season totals
    and per-game rates, both scored and allowed
  - First-TD-of-game rate/count, both scored (this team) and allowed
    (opponent scored first instead)
  - Red zone (own side's 20-yard-line-in) TDs, plays, carries, and targets,
    both this team's own offense and what its defense allows
  - TDs bucketed by the scoring play's length (10-19/20-29/.../50+ yards),
    both scored and allowed
  - Offensive TDs scored by position (QB/RB/WR/TE/DST) and defensive TDs
    allowed by position
For each player who has scored at least one TD:
  - Team, position, season TD count, "scored the game's first TD" count,
    and how many of their TDs came via a DST-type score (so a WR who also
    returns punts is flagged rather than blended into their receiving line)

This file is the order of the build (main) and the page split; the work lives in
(split by job 2026-11-23, each imports only the files above it):
  nfl_common.py      team-name fixes, position groups, play buckets
  nfl_sources.py     nflverse downloads, NFL.com injuries, schedule, ESPN FPI, headshots
  nfl_lines.py       Novig, book TD odds, odds lock at kickoff, the GMG record
  nfl_td.py          TDs, first TDs, the TD matchup model, King of the Endzone
  nfl_team_stats.py  team splits, opening drives, red zone, build_team_stats
  nfl_players.py     snaps, injury report, game logs, box scores
  nfl_props.py       the prop matchup model, zone splits, build_player_props
"""

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from gmg_model import compute_gmg_model, eastern_now
from line_grades import compute_line_grades, load_ngs
from nfl_odds import fetch_nfl_book_odds
from nfl_sources import build_position_lookup, build_roster_position_lookup, build_roster_team_lookup, compute_current_week, compute_espn_ratings, compute_player_headshots, compute_roster_out, compute_schedule, load_ftn_charting, load_injuries, load_pbp, load_rosters, load_snap_counts, merge_live_injuries, resolve_season
from nfl_lines import PLAYER_OU_MARKETS, apply_book_schedule_lines, book_td_odds, canonicalize_odds_names, extract_novig_game_lines, extract_novig_props, fetch_novig_week, fetch_previous_odds_snapshot, first_td_on_book_list, lock_started_game_odds, merge_td_odds, odds_unavailable_names, previous_gmg_model, save_gmg_history
from nfl_td import KOE_WEEKS_DIR, compute_first_td_per_game, compute_first_td_position_breakdown, compute_games_played, compute_koe, compute_possessions_to_score, compute_pre_first_td_player_usage, compute_pre_first_td_red_zone, compute_td_allowed_log, compute_td_matchup_model, compute_team_game_td_allowed, compute_team_game_td_counts, compute_trailing_possessions, koe_game_results, koe_week_boards, scoring_plays_with_position
from nfl_team_stats import build_team_stats, compute_epa_per_play, compute_explosive_plays, compute_general_stats, compute_length_buckets, compute_opening_drives, compute_opponent_adjusted_stats, compute_recent_games, compute_red_zone, compute_red_zone_trips, compute_scheme_splits, compute_scoring_by_quarter
from nfl_players import build_player_stats, compute_injury_report, compute_player_box_scores, compute_player_game_logs, compute_player_snap_shares, compute_player_td_results, compute_player_weekly_snaps, compute_target_ranks
from nfl_props import build_player_props, compute_pass_shot_chart, compute_player_pass_splits, compute_player_pass_zone_splits, compute_player_rush_zone_splits, compute_prop_matchup_model, compute_rush_zone_splits, compute_scramble_splits, compute_volume_stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    season, is_fallback = resolve_season(args.season, args.data_dir)

    pbp = load_pbp(args.data_dir, season)
    rosters = load_rosters(args.data_dir, season)
    # Injuries are about the REQUESTED season's upcoming games, not
    # whatever season the pbp-based stats fell back to -- same reasoning
    # compute_schedule() already documents.
    injuries_df = load_injuries(args.data_dir, args.season)
    pos_lookup = build_position_lookup(rosters)

    ftn = load_ftn_charting(args.data_dir, season)
    snap_counts_df = load_snap_counts(args.data_dir, season)

    # Schedule (and the full 32-team list derived from it) computed up
    # front: early in a season, `pbp` itself may not yet include every
    # team -- a team whose game hasn't been played yet has zero rows in
    # pbp at all. Deriving `teams` from pbp's own home/away columns
    # instead would silently drop any such team from every team-level
    # stat on the site (confirmed directly: Week 1 with one Monday night
    # game still to come left DEN and KC completely absent -- 30 teams
    # instead of 32). The schedule always lists all 32 regardless of
    # what's been played, so it's the correct source for this.
    schedule = compute_schedule(args.data_dir, args.season)
    teams = sorted(set(g["away"] for g in schedule) | set(g["home"] for g in schedule))

    team_games = compute_team_game_td_counts(pbp)
    team_games_allowed = compute_team_game_td_allowed(pbp)
    games_played = compute_games_played(pbp)
    first_td_by_game = compute_first_td_per_game(pbp, pos_lookup)
    scoring_df = scoring_plays_with_position(pbp, pos_lookup)
    red_zone = compute_red_zone(pbp)
    red_zone_trips = compute_red_zone_trips(pbp)
    length_buckets = compute_length_buckets(pbp)
    explosive = compute_explosive_plays(pbp)
    epa = compute_epa_per_play(pbp)
    general = compute_general_stats(pbp)
    recent_games = compute_recent_games(pbp)
    scoring_by_quarter = compute_scoring_by_quarter(pbp)
    possessions_to_score = compute_possessions_to_score(pbp, first_td_by_game)
    trailing_possessions = compute_trailing_possessions(pbp, first_td_by_game)
    pre_rz_off_trips, pre_rz_off_conv, pre_rz_def_trips, pre_rz_def_conv = compute_pre_first_td_red_zone(pbp, first_td_by_game)
    first_td_position, first_td_position_allowed = compute_first_td_position_breakdown(first_td_by_game, teams)
    pre_first_td_usage = compute_pre_first_td_player_usage(pbp, first_td_by_game, pos_lookup)
    target_ranks = compute_target_ranks(pbp, pos_lookup)

    team_stats = build_team_stats(
        team_games,
        team_games_allowed,
        games_played,
        first_td_by_game,
        scoring_df,
        red_zone,
        red_zone_trips,
        length_buckets,
        explosive,
        epa,
        general,
        recent_games,
        possessions_to_score,
        trailing_possessions,
        pre_rz_off_trips,
        pre_rz_off_conv,
        pre_rz_def_trips,
        pre_rz_def_conv,
        first_td_position,
        first_td_position_allowed,
        teams,
    )
    player_stats = build_player_stats(scoring_df, first_td_by_game, teams, target_ranks)
    player_td_results = compute_player_td_results(scoring_df, first_td_by_game)

    scheme_splits = compute_scheme_splits(pbp, ftn, teams)
    for team in teams:
        team_stats[team].update(scheme_splits.get(team, {}))
    # Flattened (q1_scored_per_g, q1_allowed_per_g, ...) rather than a
    # nested dict -- General Stats' table renderer (and tierFor/numCell,
    # which every other row in that table already goes through) expects a
    # flat team_stats key per cell, same as everything else in this blob.
    for team in teams:
        for bucket, vals in scoring_by_quarter.get(team, {}).items():
            team_stats[team][f"{bucket}_scored_per_g"] = vals.get("scored_per_g")
            team_stats[team][f"{bucket}_allowed_per_g"] = vals.get("allowed_per_g")

    rush_zone_stats = compute_rush_zone_splits(pbp, teams)
    for team in teams:
        team_stats[team].update(rush_zone_stats.get(team, {}))
    player_rush_zones = compute_player_rush_zone_splits(pbp, pos_lookup)
    player_pass_splits = compute_player_pass_splits(pbp, pos_lookup)
    player_scramble_splits, team_scramble_containment = compute_scramble_splits(pbp, pos_lookup, teams)
    for team in teams:
        team_stats[team].update(team_scramble_containment.get(team, {}))
    volume_players, position_allowed, team_targets = compute_volume_stats(pbp, pos_lookup, games_played)
    for team in teams:
        team_stats[team].update(position_allowed.get(team, {}))
    # Computed here (not down with the injury report, its other consumer)
    # so build_player_props can join it onto each row below.
    player_snap_shares = compute_player_snap_shares(snap_counts_df)
    player_props = build_player_props(volume_players, teams, team_targets, player_snap_shares)
    player_game_logs = compute_player_game_logs(pbp, pos_lookup)
    player_box_scores = compute_player_box_scores(pbp, pos_lookup)
    pass_shot_charts = compute_pass_shot_chart(pbp, teams, pos_lookup)
    player_pass_zones = compute_player_pass_zone_splits(pbp, pos_lookup)
    player_headshots = compute_player_headshots(rosters, pos_lookup)

    # One team-level schedule-strength number (not per condition -- see
    # compute_scheme_splits' docstring for why), reusing recent_games'
    # opponent list and team_stats' own points_against_per_g so this
    # doesn't need a second opponent-quality metric.
    for team in teams:
        opponents = [g["opponent"] for g in recent_games.get(team, [])]
        quality_vals = [team_stats[o]["points_against_per_g"] for o in opponents if o in team_stats]
        team_stats[team]["schedule_quality"] = round(sum(quality_vals) / len(quality_vals), 2) if quality_vals else None

    max_week = int(pbp["week"].max())

    current_week = compute_current_week(schedule)
    # Live official reports for the upcoming week (Wednesday practice
    # reports appear here hours before nflverse republishes them).
    injuries_df = merge_live_injuries(injuries_df, args.season, current_week)
    injury_report = compute_injury_report(injuries_df, teams, player_snap_shares)
    roster_out = compute_roster_out(load_rosters(args.data_dir, args.season, force=True))

    # Offensive line + defensive front grades (line_grades.py). Not shown on
    # the site yet -- placement still to be decided with the user.
    ngs_pass, ngs_rush = load_ngs(args.data_dir, season)
    line_grades = compute_line_grades(pbp, ftn, ngs_pass, ngs_rush, pos_lookup, teams)

    # Player prop odds (anytime-TD, first-TD) for whatever week is currently
    # on deck -- requested_season since (like odds/injuries) this is about
    # the upcoming slate, not whatever season the pbp-based stats fell back to.
    week_games = [g for g in schedule if g["week"] == current_week]
    week_dates = sorted(g["date"] for g in week_games if g.get("date"))
    player_td_odds = None
    player_first_td_odds = None
    player_prop_markets = None
    novig_debug = None
    roster_positions = None
    book_odds, book_odds_debug = {}, {"skipped": "no games this week"}
    if week_dates:
        starts_after = week_dates[0]
        # A plain date+1 cutoff is midnight UTC on the day after the last
        # game's LOCAL calendar date -- but a Sunday/Monday night kickoff
        # (~8:15-8:20pm ET) itself lands ~15-20 minutes AFTER that midnight
        # UTC boundary, so the week's last (and often most-watched) game
        # was silently excluded from the odds fetch every single week.
        # Confirmed directly against a real event: a 2026-09-14 Monday
        # night game's real startsAt was 2026-09-15T00:15:00Z, 15 minutes
        # past the old (bare) 2026-09-15 cutoff. An 8-hour pad covers any
        # realistic NFL kickoff (even a 10:15pm ET West Coast game is only
        # ~2-3am UTC) with plenty of room to spare, while staying far short
        # of the next week's games (always 3+ days later) so it can't leak
        # a different week's line onto the same team key.
        next_local_day = date.fromisoformat(week_dates[-1]) + timedelta(days=1)
        starts_before = (datetime.combine(next_local_day, datetime.min.time()) + timedelta(hours=8)).isoformat()
        # NOT `rosters` -- that's the fallback SEASON's roster (2025, whatever
        # nflverse pbp data actually exists for right now), which would still
        # show last year's team for anyone traded this offseason. This needs
        # the REQUESTED season's current roster, force-refreshed every run
        # same as injuries/schedule, since trades/roster moves keep
        # happening throughout the year.
        current_rosters = load_rosters(args.data_dir, args.season, force=True)
        roster_teams = build_roster_team_lookup(current_rosters)
        roster_positions = build_roster_position_lookup(current_rosters)
        unavailable_names = odds_unavailable_names(injuries_df, current_week, roster_out)
        # Every US book's price (SmartStake) leads: the clickable best price,
        # the all-books list, Anytime TD and the schedule's lines. No key or
        # a failed fetch = Novig only.
        book_odds, book_odds_debug = fetch_nfl_book_odds(
            os.environ.get("SMARTSTAKE_API_KEY"), list(roster_positions or {}),
            (fetch_previous_odds_snapshot() or {}).get("book_odds"),
            datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            keep={f"{g['away']}_{g['home']}" for g in week_games})
        print(f"SmartStake book odds: {book_odds_debug}")
        apply_book_schedule_lines(week_games, book_odds)
        # Novig (free, every build): the player over/unders, First TD, and
        # its own game prices in each game's "novig" object.
        novig_games, novig_debug = fetch_novig_week(week_games, starts_after, starts_before)
        novig_lines = extract_novig_game_lines(novig_games) if novig_games else {}
        for g in week_games:
            direct = novig_lines.get(f"{g['away']}_{g['home']}")
            if direct:
                g["novig"] = direct
        n_ou, n_any, n_first = extract_novig_props(novig_games or {}, teams, roster_positions, unavailable_names)
        player_prop_markets = n_ou
        book_any = book_td_odds(book_odds, roster_teams, roster_positions, unavailable_names)
        player_td_odds = merge_td_odds(book_any, n_any)
        player_first_td_odds = first_td_on_book_list(n_first, book_any)

    espn_ratings = compute_espn_ratings(args.season)
    if espn_ratings is None:
        prev_site = fetch_previous_odds_snapshot()
        espn_ratings = (prev_site or {}).get("espn_ratings")

    blob = {
        "season": season,
        "requested_season": args.season,
        "is_fallback_season": is_fallback,
        "through_week": max_week,
        "generated_by": "nflverse-data pbp + weekly rosters",
        "teams": teams,
        "team_stats": team_stats,
        "player_stats": player_stats,
        "player_props": player_props,
        "player_game_logs": player_game_logs,
        "player_box_scores": player_box_scores,
        "pass_shot_charts": pass_shot_charts,
        "player_pass_zones": player_pass_zones,
        "player_headshots": player_headshots,
        "player_snaps": compute_player_weekly_snaps(snap_counts_df),
        "player_rush_zones": player_rush_zones,
        "player_pass_splits": player_pass_splits,
        "player_scramble_splits": player_scramble_splits,
        "player_td_results": player_td_results,
        "td_allowed_log": compute_td_allowed_log(scoring_df),
        **(lambda m: {"td_matchup_model": m["teams"], "player_xtd": m["players"]})(compute_td_matchup_model(pbp, scoring_df, pos_lookup)),
        "pre_first_td_usage": pre_first_td_usage,
        "prop_matchup_model": compute_prop_matchup_model(pbp, pos_lookup),
        "koe": compute_koe(pbp, pos_lookup),
        "team_stats_adj": compute_opponent_adjusted_stats(pbp, ftn, team_stats),
        "opening_drives": compute_opening_drives(pbp),
        "schedule": schedule,
        "current_week": current_week,
        "recent_games": recent_games,
        "injuries": injury_report,
        "roster_out": roster_out,
        "line_grades": line_grades,
        "injuries_max_week": int(injuries_df["week"].max()) if len(injuries_df) else None,
        "player_td_odds": player_td_odds,
        "player_first_td_odds": player_first_td_odds,
        "player_prop_markets": player_prop_markets,
        "novig_debug": novig_debug,
        "book_odds": book_odds,
        "book_odds_debug": book_odds_debug,
        "espn_ratings": espn_ratings,
        "player_prop_market_labels": PLAYER_OU_MARKETS,
    }

    model_history = previous_gmg_model()
    blob["lines_locked"] = lock_started_game_odds(blob, fetch_previous_odds_snapshot(), model_history)
    blob["generated_at"] = (eastern_now() + timedelta(hours=4)).strftime("%Y-%m-%dT%H:%MZ")  # UTC
    renamed = canonicalize_odds_names(blob, roster_positions)
    print(f"Odds names matched to the site's spelling: {renamed} changed")
    blob["gmg_model"] = compute_gmg_model(blob, model_history)
    save_gmg_history(blob["gmg_model"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Two big parts only a few pages show go in their own files (after everything
    # above has used them); common.js loadDataPart puts them back where the pages read them.
    parts = split_page_parts(blob)
    # compact (2026-10-28): indented it was 18.2 MB in week 8 and growing, and Cloudflare Pages
    # takes at most 25 MB a file (ci_steps.py sizes); compact is about 40% smaller
    with open(args.out, "w") as f:
        json.dump(blob, f, separators=(",", ":"))
    for name, part in parts.items():
        (args.out.parent / name).write_text(json.dumps(part, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {args.out} -- season {season}, through week {max_week}, {len(teams)} teams (+ {', '.join(parts)})")

    # King of the Endzone's past weeks and results (its own file: only the
    # Promo Tools page loads it). A failure here must never cost the NFL build.
    try:
        koe_weeks = {"season": season, "boards": koe_week_boards(pbp, pos_lookup, schedule, KOE_WEEKS_DIR, season), "results": koe_game_results(pbp, pos_lookup)}
    except Exception as e:
        print(f"WARNING: King of the Endzone's past weeks couldn't be built ({e}).", file=sys.stderr)
        koe_weeks = {"season": season, "boards": {}, "results": {}, "error": str(e)[:200]}
    (args.out.parent / "koe_weeks.json").write_text(json.dumps(koe_weeks, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote koe_weeks.json -- {len(koe_weeks['boards'])} past boards, {len(koe_weeks['results'])} games")


def split_page_parts(blob: dict) -> dict:
    """Take the two big parts only a few pages show out of data.json (2026-11-23:
    about 40% of the file, which every NFL page used to read):

    - box_scores.json: `player_box_scores` (only Game Previews shows them).
    - pass_plays.json: every pass play behind the pass charts, by team, side and
      zone (Player Props and the player card's pass chart). Each zone's counts stay
      in data.json, which pages rank teams by; only the `plays` list moves.

    Returns {file name: contents} and changes `blob` in place."""
    plays = {}
    for team, sides in (blob.get("pass_shot_charts") or {}).items():
        for side, chart in (sides or {}).items():
            for key, zone in ((chart or {}).get("zones") or {}).items():
                if isinstance(zone, dict) and "plays" in zone:
                    plays.setdefault(team, {}).setdefault(side, {})[key] = zone.pop("plays")
    return {
        "box_scores.json": {"season": blob.get("season"), "player_box_scores": blob.pop("player_box_scores", {})},
        "pass_plays.json": {"season": blob.get("season"), "pass_plays": plays},
    }


if __name__ == "__main__":
    main()
