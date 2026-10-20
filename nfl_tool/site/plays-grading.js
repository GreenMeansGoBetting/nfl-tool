// ---- NFL saved plays: grading and units ----
// Shared by Possible Plays (possible-plays.js) and My Plays (my-plays.js):
// both grade the same saved NFL plays (common.js loadPossiblePlays) the
// same way. Needs data.json (DATA) for the scores and stats.

// ---- Grading ----
// Auto-grades every saved play win/loss/push once data.json has the final
// score (Spread/Total/Moneyline, sourced from game-overview.js) or that
// week's scoring data (Anytime TD/First TD, sourced from common.js's odds
// modal) -- these are the only two shapes of entry anything on the site
// ever adds to Possible Plays. A manual override (win/loss/void, from the
// Results modal below) always wins over a later auto re-grade, since a
// name-format mismatch between SGO's odds names and nflverse's play-by-play
// names is a known, accepted limitation everywhere else this site joins
// the two sources (see build_roster_position_lookup's docstring).
const GAME_LINE_CATEGORIES = { Spread: "spread", Total: "total", Moneyline: "moneyline" };

// game_overview.js builds ids as "<game_id>_<market>_<side>", and game_id
// itself contains underscores (e.g. "2025_01_KC_LAC") -- splitting on the
// known "_<market>_" substring instead of a naive split keeps the game_id
// intact.
function parseGameLineId(id, marketKey) {
  const suffix = `_${marketKey}_`;
  const idx = id.indexOf(suffix);
  if (idx === -1) return null;
  return { gameId: id.slice(0, idx), side: id.slice(idx + suffix.length) };
}

function gradeGameLinePlay(play, schedule) {
  const marketKey = GAME_LINE_CATEGORIES[play.category];
  if (!marketKey) return null;
  const parsed = parseGameLineId(play.id, marketKey);
  if (!parsed) return null;
  const game = (schedule || []).find((g) => g.game_id === parsed.gameId);
  if (!game || game.away_score == null || game.home_score == null) return null;

  if (marketKey === "moneyline") {
    if (game.home_score === game.away_score) return "push";
    const winner = game.home_score > game.away_score ? "home" : "away";
    return parsed.side === winner ? "win" : "loss";
  }
  const lineMatch = play.description.match(/([+-]?[\d.]+)\s*$/);
  const line = lineMatch ? parseFloat(lineMatch[1]) : null;
  if (line === null) return null;
  if (marketKey === "total") {
    const total = game.away_score + game.home_score;
    if (total === line) return "push";
    const over = total > line;
    return parsed.side === "over" ? (over ? "win" : "loss") : over ? "loss" : "win";
  }
  // spread -- description's trailing number is already signed from the
  // picked side's own perspective (build_stats.py's away/home_team_spread).
  const ownScore = parsed.side === "home" ? game.home_score : game.away_score;
  const oppScore = parsed.side === "home" ? game.away_score : game.home_score;
  const margin = ownScore - oppScore + line;
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}

function gradeTdPlay(play, tdResults) {
  const weekResults = (tdResults || {})[play.week];
  const teamResults = weekResults && weekResults[play.team];
  if (!teamResults) return null;
  const field = play.category === "First TD" ? "first_td" : "any_td";
  // Loose name match (common.js normName: no Jr./Sr./II, punctuation or
  // case) -- the bet keeps the sportsbook's "Brian Robinson Jr." while the
  // results list nflverse's "Brian Robinson"; an exact match graded his
  // MNF TD a loss (user 2026-10-06).
  const target = normName(play.description);
  return teamResults[field].some((n) => normName(n) === target) ? "win" : "loss";
}

// Player-prop O/U markets (Player Props page's "Add to Possible Plays"
// checkboxes) -- these fell through autoGradePlay to a silent `null`
// (permanently Pending) until now, since only the TD and Spread/Total/ML
// shapes above ever had grading logic. Sourced from build_stats.py's
// compute_player_game_logs, which -- like the game-line schedule scores
// above -- is built from standard pbp columns only, so it's real and
// current the same week the game is played. "Fantasy Score" is deliberately left out:
// no fixed scoring format (PPR/half/standard) has been confirmed against
// SGO's own definition yet, and grading it against a guessed formula
// would be worse than leaving it Pending.
const PLAYER_OU_STAT_FIELDS = {
  "Receiving Yards": (g) => g.rec_yards,
  "Receptions": (g) => g.receptions,
  "Longest Reception": (g) => g.longest_rec,
  "Rushing Yards": (g) => g.rush_yards,
  "Rush Attempts": (g) => g.carries,
  "Longest Rush": (g) => g.longest_rush,
  "Rushing TDs": (g) => g.rush_td,
  "Passing Yards": (g) => g.pass_yards,
  "Pass Attempts": (g) => g.pass_att,
  "Completions": (g) => g.completions,
  "INTs Thrown": (g) => g.interceptions,
  "Longest Completion": (g) => g.longest_pass,
  "Passing TDs": (g) => g.pass_td,
  "Rush + Rec Yards": (g) => g.rush_yards + g.rec_yards,
  "Pass + Rush Yards": (g) => g.pass_yards + g.rush_yards,
};

// Strips a trailing generational suffix for a looser name match -- SGO and
// nflverse don't consistently agree on whether "Jr."/"II"/etc is part of a
// player's name (confirmed: SGO's "Omar Cooper" vs nflverse's own "Omar
// Cooper Jr." for the same person). A genuine nickname-vs-legal-name gap
// (e.g. "Chig" vs "Chigoziem" Okonkwo) is NOT handled here -- too easy to
// false-match a different player -- and stays the known, accepted
// limitation documented elsewhere in this codebase.
function stripNameSuffix(name) {
  return name.replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, "").trim();
}

function gradePlayerPropPlay(play, data) {
  const statFn = PLAYER_OU_STAT_FIELDS[play.category];
  if (!statFn || !play.team) return null;
  const m = play.description.match(/^(.*) (Over|Under) ([\d.]+)$/);
  if (!m) return null;
  const [, name, side, lineStr] = m;
  const line = parseFloat(lineStr);
  const teamLogs = data.player_game_logs[play.team] || {};
  let gameLogs = teamLogs[name];
  if (!gameLogs) {
    const target = stripNameSuffix(name);
    const matchKey = Object.keys(teamLogs).find((k) => stripNameSuffix(k) === target);
    if (matchKey) gameLogs = teamLogs[matchKey];
  }
  const gameLog = gameLogs && gameLogs.find((g) => g.week === play.week);
  if (!gameLog) return null;
  const actual = statFn(gameLog);
  if (actual === undefined || actual === null) return null;
  if (actual === line) return "push";
  const over = actual > line;
  return side === "Over" ? (over ? "win" : "loss") : over ? "loss" : "win";
}

function autoGradePlay(play, data) {
  if (play.category === "Anytime TD" || play.category === "First TD") {
    // player_td_results comes from play-by-play, which during a season's
    // fallback window (build_stats.py's resolve_season -- true whenever
    // nflverse hasn't published BOTH the season's pbp and participation
    // files yet) is a WHOLE DIFFERENT SEASON's data, just keyed by the
    // same week numbers. Grading a real current-season play against last
    // season's results for that week/team either silently finds no entry
    // (stays stuck on Pending) or, worse, coincidentally matches an
    // unrelated result from last year and confidently grades it wrong.
    // Skip TD grading entirely until real current-season data is live --
    // see regradeAllPossiblePlays for resetting any play already wrongly
    // graded this way before this fix shipped.
    if (data.is_fallback_season) return null;
    return gradeTdPlay(play, data.player_td_results);
  }
  if (GAME_LINE_CATEGORIES[play.category]) {
    return gradeGameLinePlay(play, data.schedule);
  }
  return gradePlayerPropPlay(play, data);
}

function regradeAllPossiblePlays(data) {
  if (!data) return loadPossiblePlays();
  const plays = loadPossiblePlays();
  let changed = false;
  const updated = plays.map((p) => {
    if (p.result_source === "manual") return p;
    // A TD play auto-graded during an earlier fallback-season run may
    // already be sitting on a wrong result -- reset it back to pending
    // rather than leaving a stale wrong grade in place forever.
    const isTdPlay = p.category === "Anytime TD" || p.category === "First TD";
    if (data.is_fallback_season && isTdPlay && p.result_source === "auto") {
      changed = true;
      return { ...p, result: null, result_source: null };
    }
    const result = autoGradePlay(p, data);
    if (result && result !== p.result) {
      changed = true;
      return { ...p, result, result_source: "auto" };
    }
    return p;
  });
  if (changed) savePossiblePlays(updated);
  return updated;
}

// Clicking the same active manual override again clears it, falling back
// to auto-grading (re-run right after) rather than leaving no way to undo
// a manual call.
function setManualResult(id, result) {
  const plays = loadPossiblePlays();
  const updated = plays.map((p) => {
    if (p.id !== id) return p;
    if (p.result_source === "manual" && p.result === result) {
      const { result: _r, result_source: _rs, ...rest } = p;
      return rest;
    }
    return { ...p, result, result_source: "manual" };
  });
  savePossiblePlays(updated);
}

const RESULT_LABELS = { win: "Win", loss: "Loss", push: "Push", void: "Void" };

// ---- Bet-type grouping (Results modal filters) ----
// Three buckets for the shows-content workflow: Main Lines (game-level),
// TDs (the site's original bread and butter), Props (everything else --
// every player O/U market). Deliberately a lookup for the two small,
// fixed-size categories rather than listing every prop category by name,
// so a new PLAYER_OU_MARKETS entry added in build_stats.py automatically
// falls into Props with no matching frontend change needed.
const BET_TYPE_GROUPS = {
  Spread: "Main Lines",
  Total: "Main Lines",
  Moneyline: "Main Lines",
  "Anytime TD": "TDs",
  "First TD": "TDs",
};
const BET_TYPES = ["Main Lines", "TDs", "Props"];
function betTypeGroup(category) {
  return BET_TYPE_GROUPS[category] || "Props";
}

// ---- Units ----
// Stake size scales down as the odds get longer, per a fixed house rule:
// 1u up through +500, 0.5u from +501-+1000, 0.25u beyond +1000 -- so one
// deep-longshot prop hit doesn't blow the unit ledger out of proportion to
// how big a bet it actually was. Negative odds (favorites) and anything up
// to +500 are always 1u.
function stakeForOdds(oddsStr) {
  const odds = parseFloat(oddsStr);
  if (isNaN(odds) || odds <= 500) return 1;
  if (odds <= 1000) return 0.5;
  return 0.25;
}
// American odds -> profit per 1u staked (e.g. -110 -> 0.91u, +150 -> 1.5u).
function americanOddsProfit(odds) {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
// Net units for one graded play at its own tiered stake size. 0 for a
// push/void or anything still Pending.
function unitsForPlay(play) {
  if (isNaN(parseFloat(play.odds))) return 0; // a saved Line Stack with no price entered yet
  const stake = stakeForOdds(play.odds);
  if (play.result === "win") return stake * americanOddsProfit(parseFloat(play.odds));
  if (play.result === "loss") return -stake;
  return 0;
}

function tallyResults(list) {
  const win = list.filter((p) => p.result === "win").length;
  const loss = list.filter((p) => p.result === "loss").length;
  const push = list.filter((p) => p.result === "push").length;
  const voidCt = list.filter((p) => p.result === "void").length;
  const pending = list.filter((p) => !p.result).length;
  const decided = win + loss;
  const units = Math.round(list.reduce((sum, p) => sum + unitsForPlay(p), 0) * 100) / 100;
  return { win, loss, push, void: voidCt, pending, winPct: decided ? Math.round((win / decided) * 100) : null, units };
}
function fmtUnits(units) {
  return `${units >= 0 ? "+" : ""}${units.toFixed(2)}u`;
}

// ---- How a play reads on a picture (Photo Export on both pages) ----
// A game line has no player, so its row names the game: a total shows both
// teams ("BUF @ KC Over 54.5"), a spread / moneyline the picked side's logo.
function exportPlayLogo(p) {
  if (p.team) return teamLogoMini(p.team, 18);
  const marketKey = GAME_LINE_CATEGORIES[p.category];
  const parsed = marketKey && parseGameLineId(p.id, marketKey);
  const [away, home] = (p.matchup || "").split(" @ ");
  if (!parsed || !away || !home) return "";
  if (marketKey === "total") return `${teamLogoMini(away, 18)}${teamLogoMini(home, 18)}`;
  return teamLogoMini(parsed.side === "home" ? home : away, 18);
}
function exportPlayText(p) {
  return p.category === "Total" && p.matchup ? `${p.matchup} ${p.description}` : p.description;
}
