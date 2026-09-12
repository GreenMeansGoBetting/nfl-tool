// Pick tracker for Game Overviews: localStorage-only Spread/Total/Moneyline
// confidence picks (green/yellow/red), auto-graded once DATA.schedule shows
// a final score for that game. This is the only page that uses
// localStorage, kept isolated here on purpose.
const PICKS_KEY = "nfl-tool.picks.v1";

function loadPicks() {
  try {
    return JSON.parse(localStorage.getItem(PICKS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function savePicks(picks) {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  } catch (e) {
    // localStorage unavailable (private browsing, quota, etc) -- picks just
    // won't persist this session, nothing else to do about it.
  }
  window.NFLSync?.push(PICKS_KEY, picks);
}

function pickId(gameId, market) {
  return `${gameId}_${market}`;
}

function getPick(gameId, market) {
  return loadPicks().find((p) => p.id === pickId(gameId, market)) || null;
}

function upsertPick(pick) {
  const picks = loadPicks();
  const id = pickId(pick.game_id, pick.market);
  const idx = picks.findIndex((p) => p.id === id);
  const record = { ...pick, id, graded: null, graded_at: null };
  if (idx === -1) picks.push(record);
  else picks[idx] = record;
  savePicks(picks);
  return record;
}

function deletePick(gameId, market) {
  const id = pickId(gameId, market);
  savePicks(loadPicks().filter((p) => p.id !== id));
}

// Compares the frozen line/side at pick-time against the game's final
// score. Returns the pick unchanged if the game isn't final yet.
function gradePick(pick, game) {
  if (!game || game.away_score == null || game.home_score == null) return pick;
  let result;
  if (pick.market === "moneyline") {
    const winner = game.home_score > game.away_score ? "home" : game.away_score > game.home_score ? "away" : "push";
    result = winner === "push" ? "push" : pick.side === winner ? "win" : "loss";
  } else if (pick.market === "total") {
    const total = game.away_score + game.home_score;
    if (total === pick.line_at_pick) result = "push";
    else {
      const over = total > pick.line_at_pick;
      result = pick.side === "over" ? (over ? "win" : "loss") : over ? "loss" : "win";
    }
  } else {
    // spread: line_at_pick is already signed from the picked team's own
    // perspective (see build_stats.py's away_team_spread/home_team_spread).
    const ownScore = pick.side === "home" ? game.home_score : game.away_score;
    const oppScore = pick.side === "home" ? game.away_score : game.home_score;
    const margin = ownScore - oppScore + pick.line_at_pick;
    result = margin > 0 ? "win" : margin < 0 ? "loss" : "push";
  }
  return { ...pick, graded: result, graded_at: new Date().toISOString() };
}

// Re-grades every ungraded pick against the current schedule (called once
// per render) -- this is what lets a Wednesday pick get graded automatically
// once build_stats.py is re-run with that week's final score baked in.
function regradeAllPicks(schedule) {
  const gamesById = Object.fromEntries((schedule || []).map((g) => [g.game_id, g]));
  const picks = loadPicks();
  let changed = false;
  const updated = picks.map((p) => {
    if (p.graded) return p;
    const graded = gradePick(p, gamesById[p.game_id]);
    if (graded.graded) changed = true;
    return graded;
  });
  if (changed) savePicks(updated);
  return updated;
}

// Spread/total prices vary pick to pick (and this site doesn't even store
// enough of a "market standard" to assume one), so unit tracking assumes a
// flat -105 on both -- a standard, easy-to-reason-about number instead of
// pretending the actual frozen price at pick time is what got bet. Moneyline
// keeps its real frozen price (odds_at_pick) since that's the whole point of
// a moneyline number -- there's no "standard" price to substitute.
const STANDARD_SPREAD_TOTAL_ODDS = -105;

// American odds -> profit on a 1-unit stake (e.g. -105 -> 0.95u, +150 -> 1.5u).
function americanOddsProfit(odds) {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

// Net units for one graded pick, assuming a flat 1u stake. 0 for a push or
// a pick that hasn't graded yet.
function unitsForPick(pick) {
  if (pick.graded === "win") {
    const odds = pick.market === "moneyline" ? pick.odds_at_pick : STANDARD_SPREAD_TOTAL_ODDS;
    return americanOddsProfit(odds);
  }
  if (pick.graded === "loss") return -1;
  return 0;
}

function tallyPicks(list) {
  const win = list.filter((p) => p.graded === "win").length;
  const loss = list.filter((p) => p.graded === "loss").length;
  const push = list.filter((p) => p.graded === "push").length;
  const decided = win + loss;
  const units = Math.round(list.reduce((sum, p) => sum + unitsForPick(p), 0) * 100) / 100;
  return { win, loss, push, winPct: decided ? Math.round((win / decided) * 100) : null, units };
}

function pickSummary(picks) {
  return {
    overall: tallyPicks(picks),
    green: tallyPicks(picks.filter((p) => p.color === "green")),
    yellow: tallyPicks(picks.filter((p) => p.color === "yellow")),
    red: tallyPicks(picks.filter((p) => p.color === "red")),
  };
}

// Record broken out by market AND color/confidence at once -- a 3x3 grid
// (Spread/Total/Moneyline x Green/Yellow/Red) plus a totals row and column,
// so a 4x4 table. Answers both "how do my Green picks do" and "how do my
// Spread picks do" in one place, instead of two separate summaries.
function pickMatrix(picks) {
  const markets = ["spread", "total", "moneyline"];
  const colors = ["green", "yellow", "red"];
  const rows = markets.map((market) => ({
    market,
    cells: colors.map((color) => tallyPicks(picks.filter((p) => p.market === market && p.color === color))),
    total: tallyPicks(picks.filter((p) => p.market === market)),
  }));
  const colTotals = colors.map((color) => tallyPicks(picks.filter((p) => p.color === color)));
  const grandTotal = tallyPicks(picks);
  return { markets, colors, rows, colTotals, grandTotal };
}
