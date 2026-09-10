const LENGTH_BUCKETS = [
  { key: "10_or_less", label: "≤10 yd" },
  { key: "11_20", label: "11-20 yd" },
  { key: "21_40", label: "21-40 yd" },
  { key: "41_plus", label: "41+ yd" },
];

// For the Matchup Snapshot only (the detailed Touchdown Distance table
// below keeps all 4 buckets) -- rolling up into short/big-play tells the
// same "explosive or not" story on a more solid count.
const MACRO_LENGTH_BUCKETS = [
  { key: "short", keys: ["10_or_less", "11_20"], label: "short TDs" },
  { key: "bigplay", keys: ["21_40", "41_plus"], label: "big plays" },
];
function sumBucketKeys(dict, keys) {
  return keys.reduce((sum, k) => sum + (dict[k] || 0), 0);
}

// Every row in the combined offense/defense stat table -- each side shows
// BOTH the season total and the per-game rate, so nothing needs a second
// row. offKey/rateOffKey read off the offense-side team, the Def variants
// off the defense-side (opponent) team.
const STAT_ROWS = [
  { label: "Pass TD", totalOffKey: "pass_td", rateOffKey: "pass_td_per_g", totalDefKey: "pass_td_allowed", rateDefKey: "pass_td_allowed_per_g" },
  { label: "Rush TD", totalOffKey: "rush_td", rateOffKey: "rush_td_per_g", totalDefKey: "rush_td_allowed", rateDefKey: "rush_td_allowed_per_g" },
  { label: "Total TD", totalOffKey: "total_td", rateOffKey: "total_td_per_g", totalDefKey: "total_td_allowed", rateDefKey: "total_td_allowed_per_g" },
  { label: "DST TD", totalOffKey: "dst_td", rateOffKey: "dst_td_per_g", totalDefKey: "dst_td_allowed", rateDefKey: "dst_td_allowed_per_g" },
  { label: "First TD", special: "first" },
];

function topOpportunity(candidates) {
  const valid = candidates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (c.magnitude > best.magnitude ? c : best));
}

// One direction (offTeam's offense against defTeam's defense) worth of
// targetable opportunities across every category on this page. Called
// twice (away-vs-home and home-vs-away) and combined for the full
// snapshot. Each entry is tagged with a category/subject so
// renderMatchupSnapshot can merge same-subject opportunities that show up
// in both directions (e.g. both teams leaning on TEs) into one line.
function directionInsights(offTeam, defTeam) {
  const insights = [];

  const firstTd = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].first_td_rate, (t) => firstTdAllowedRate(t), false, true);
  if (firstTd) insights.push({ ...firstTd, category: "first_td", subject: null, team: offTeam, label: "for the first TD" });

  const posOpp = topOpportunity(
    POSITIONS.map((pos) => {
      const r = checkOpportunity(
        offTeam,
        defTeam,
        (t) => (DATA.team_stats[t].total_td ? DATA.team_stats[t].off_position_td[pos] / DATA.team_stats[t].total_td : null),
        (t) => (DATA.team_stats[t].total_td_allowed ? DATA.team_stats[t].def_position_td_allowed[pos] / DATA.team_stats[t].total_td_allowed : null),
        false,
        true
      );
      return r && { ...r, category: "position", subject: pos, team: offTeam, label: `${pos}s` };
    })
  );
  if (posOpp) insights.push(posOpp);

  const distOpp = topOpportunity(
    MACRO_LENGTH_BUCKETS.map(({ key, keys, label }) => {
      const r = checkOpportunity(
        offTeam,
        defTeam,
        (t) => {
          const s = DATA.team_stats[t];
          const count = sumBucketKeys(s.td_by_length, keys);
          return s.total_td && count >= 3 ? count / s.total_td : null;
        },
        (t) => {
          const s = DATA.team_stats[t];
          const count = sumBucketKeys(s.td_by_length_allowed, keys);
          return s.total_td_allowed && count >= 3 ? count / s.total_td_allowed : null;
        },
        false,
        true
      );
      return r && { ...r, category: "distance", subject: key, team: offTeam, label: label };
    })
  );
  if (distOpp) insights.push(distOpp);

  const rzOpp = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].rz_td_per_g, (t) => DATA.team_stats[t].rz_td_allowed_per_g, false, true);
  if (rzOpp) insights.push({ ...rzOpp, category: "redzone", subject: "td", team: offTeam, label: "red zone TDs" });

  return insights;
}

function computeMatchupInsights(awayTeam, homeTeam) {
  return [...directionInsights(awayTeam, homeTeam), ...directionInsights(homeTeam, awayTeam)];
}

function renderStatTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = STAT_ROWS.map((r) => {
    if (r.special === "first") {
      const offTotal = off.first_td_games;
      const offRate = off.first_td_rate * 100;
      const defTotal = firstTdAllowedGames(defTeam);
      const defRate = firstTdAllowedRate(defTeam) * 100;
      const offTotalCls = percentileTier(offTotal, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
      const offRateCls = tierFor("first_td_rate", offTeam, false);
      const defTotalCls = percentileTier(defTotal, teamsWithGames().map(firstTdAllowedGames), true);
      const defRateCls = tierForFirstTdAllowed(defTeam);
      const offRateExtreme = tierFor("first_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
      const defRateExtreme = tierForFirstTdAllowed(defTeam, TIER_Z_EXTREME_THRESHOLD);
      const offTotalA = tierAlphaAttr(offTotal, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
      const offRateA = tierForAlphaAttr("first_td_rate", offTeam, false);
      const defTotalA = tierAlphaAttr(defTotal, teamsWithGames().map(firstTdAllowedGames), true);
      const defRateA = tierForFirstTdAllowedAlphaAttr(defTeam);
      return `<tr><td>${r.label}</td><td class="num ${offTotalCls}"${offTotalA}>${offTotal}</td><td class="num ${offRateCls}"${offRateA}>${fmt(offRate, 0)}%</td><td class="num ${defTotalCls}"${defTotalA}>${defTotal}</td><td class="num ${defRateCls}"${defRateA}>${fmt(defRate, 0)}%</td>${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;
    }
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    const offRateExtreme = tierFor(r.rateOffKey, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defRateExtreme = tierFor(r.rateDefKey, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offTotalA = tierForAlphaAttr(r.totalOffKey, offTeam, false);
    const offRateA = tierForAlphaAttr(r.rateOffKey, offTeam, false);
    const defTotalA = tierForAlphaAttr(r.totalDefKey, defTeam, true);
    const defRateA = tierForAlphaAttr(r.rateDefKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}"${offTotalA}>${off[r.totalOffKey]}</td><td class="num ${offRateCls}"${offRateA}>${fmt(off[r.rateOffKey], 2)}</td><td class="num ${defTotalCls}"${defTotalA}>${def[r.totalDefKey]}</td><td class="num ${defRateCls}"${defRateA}>${fmt(def[r.rateDefKey], 2)}</td>${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLengthTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = LENGTH_BUCKETS.map(({ key, label }) => {
    const offCount = off.td_by_length[key] || 0;
    const defCount = def.td_by_length_allowed[key] || 0;
    const offCountCls = bucketCountTier("td_by_length", key, offTeam);
    const offShareCls = bucketShareTier("td_by_length", "total_td", key, offTeam);
    const defCountCls = bucketCountTier("td_by_length_allowed", key, defTeam, true);
    const defShareCls = bucketShareTier("td_by_length_allowed", "total_td_allowed", key, defTeam, true);
    const offShareExtreme = bucketShareTier("td_by_length", "total_td", key, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("td_by_length_allowed", "total_td_allowed", key, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offCountA = bucketCountAlphaAttr("td_by_length", key, offTeam);
    const offShareA = bucketShareAlphaAttr("td_by_length", "total_td", key, offTeam);
    const defCountA = bucketCountAlphaAttr("td_by_length_allowed", key, defTeam, true);
    const defShareA = bucketShareAlphaAttr("td_by_length_allowed", "total_td_allowed", key, defTeam, true);
    const offShare = off.total_td ? Math.round((offCount / off.total_td) * 100) : 0;
    const defShare = def.total_td_allowed ? Math.round((defCount / def.total_td_allowed) * 100) : 0;
    return `<tr><td>${label}</td><td class="num ${offCountCls}"${offCountA}>${offCount}</td><td class="num ${offShareCls}"${offShareA}>${offShare}%</td><td class="num ${defCountCls}"${defCountA}>${defCount}</td><td class="num ${defShareCls}"${defShareA}>${defShare}%</td>${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  // A 5th row, same Total/% shape as the length buckets above -- Total here
  // is red zone trips (not a TD-length bucket), % is the conversion rate
  // once there: how often a trip inside the 20 actually ends in a score,
  // offense's own rate vs. what this defense allows. Rounds Distance out to
  // the same row count as TD Type/Position instead of running one short.
  const rzOffTripsCls = tierFor("rz_trips", offTeam, false);
  const rzDefTripsCls = tierFor("rz_trips_allowed", defTeam, true);
  const rzOffTripsA = tierForAlphaAttr("rz_trips", offTeam, false);
  const rzDefTripsA = tierForAlphaAttr("rz_trips_allowed", defTeam, true);
  const rzOffCls = tierFor("rz_td_rate", offTeam, false);
  const rzDefCls = tierFor("rz_td_rate_allowed", defTeam, true);
  const rzOffExtreme = tierFor("rz_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
  const rzDefExtreme = tierFor("rz_td_rate_allowed", defTeam, true, TIER_Z_EXTREME_THRESHOLD);
  const rzOffA = tierForAlphaAttr("rz_td_rate", offTeam, false);
  const rzDefA = tierForAlphaAttr("rz_td_rate_allowed", defTeam, true);
  const rzRow = `<tr><td>RZ %</td><td class="num ${rzOffTripsCls}"${rzOffTripsA}>${off.rz_trips}</td><td class="num ${rzOffCls}"${rzOffA}>${Math.round(off.rz_td_rate * 100)}%</td><td class="num ${rzDefTripsCls}"${rzDefTripsA}>${def.rz_trips_allowed}</td><td class="num ${rzDefCls}"${rzDefA}>${Math.round(def.rz_td_rate_allowed * 100)}%</td>${edgeCell(rzOffCls, rzDefCls, offTeam, defTeam, rzOffExtreme, rzDefExtreme)}</tr>`;

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}${rzRow}</tbody>
  </table>`;
}

function renderPositionTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const rows = POSITIONS.map((pos) => {
    const offCount = off.off_position_td[pos];
    const defCount = def.def_position_td_allowed[pos];
    const offShare = off.total_td ? offCount / off.total_td : 0;
    const defShare = def.total_td_allowed ? defCount / def.total_td_allowed : 0;
    const offCountCls = bucketCountTier("off_position_td", pos, offTeam);
    const offShareCls = bucketShareTier("off_position_td", "total_td", pos, offTeam);
    const defCountCls = bucketCountTier("def_position_td_allowed", pos, defTeam, true);
    const defShareCls = bucketShareTier("def_position_td_allowed", "total_td_allowed", pos, defTeam, true);
    const offShareExtreme = bucketShareTier("off_position_td", "total_td", pos, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("def_position_td_allowed", "total_td_allowed", pos, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${Math.round(offShare * 100)}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${Math.round(defShare * 100)}%</td>${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLeaderboard(team) {
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No TDs scored yet this season.</p>`;
  }
  const maxTds = Math.max(...players.map((p) => p.tds));
  const maxFirstTds = Math.max(...players.map((p) => p.first_tds));
  const rows = players
    .map((p) => {
      const tag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
      const tdBg = teamFade(team, maxTds ? p.tds / maxTds : 0);
      const firstTdBg = teamFade(team, maxFirstTds ? p.first_tds / maxFirstTds : 0);
      return `<tr><td>${p.name}${tag}</td><td>${p.position}</td><td class="num" style="background:${tdBg}">${p.tds}</td><td class="num" style="background:${firstTdBg}">${p.first_tds}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table lb-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">TDs</th><th class="num">1st TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Per-matchup notes (localStorage, keyed by away_home -- TD Data has
// no single "game_id" the way Game Previews does, since away/home here are
// just whatever's picked in the selects, not necessarily a real scheduled
// game) ----
const TD_NOTES_KEY = "nfl-tool.td-notes.v1";
function loadTdNotes() {
  try {
    return JSON.parse(localStorage.getItem(TD_NOTES_KEY)) || {};
  } catch (e) {
    return {};
  }
}
function saveTdNote(key, text) {
  try {
    const all = loadTdNotes();
    if (text) all[key] = text;
    else delete all[key];
    localStorage.setItem(TD_NOTES_KEY, JSON.stringify(all));
  } catch (e) {
    // localStorage unavailable -- notes just won't stick.
  }
}

// Live mirror of the shared Possible Plays list (same data the standalone
// Possible Plays page and every odds-modal checkbox read/write) -- shown
// right here so a play checked in the TD-odds modal shows up without
// leaving the page. Filtered to the currently selected away/home matchup
// only (matching both team codes against the entry's own matchup string,
// order-independent) -- switching to a different matchup should show that
// matchup's plays, not everything ever saved. Logo + name + odds only, no
// book: the whole point of "best price across a handful of books" is to
// shop it yourself, a single book name here would read as more final than
// it is. Entries without a team on file (older saves, or non-player picks)
// just skip the logo.
function renderTdPossiblePlaysList(away, home) {
  // Exact team-code match (split on " @ "), not a substring check -- LA is
  // a substring of LAC, so .includes() would wrongly match one team's
  // plays onto an unrelated matchup involving the other.
  const list = loadPossiblePlays().filter((p) => {
    if (!p.matchup) return false;
    const teams = p.matchup.split(" @ ");
    return teams.includes(away) && teams.includes(home);
  });
  const el = document.getElementById("td-possible-plays-list");
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<p class="no-data-note">None yet for this matchup -- check a player in the TD odds modal to add one.</p>`;
    return;
  }
  el.innerHTML = list
    .slice()
    .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
    .map(
      (p) =>
        `<div class="td-pp-row">${p.team ? teamLogoMini(p.team) : ""}<span class="td-pp-desc">${p.description}</span><span class="td-pp-odds">${p.odds}</span></div>`
    )
    .join("");
}

// ---- First TD view: everything that happens in a game before the very
// first touchdown is scored, condensed from the same team_stats already
// loaded above. Ported in from the old standalone first-td.html/first-td.js
// so both views can share one page, one data.json fetch, and one toggle. ----

// Same idea as topOpportunity/directionInsights above, but sourced from the
// First-TD-specific stats (who scores/allows the FIRST TD, not season
// totals) rather than the season-long Type/Position/Distance stats.
function firstTdDirectionInsights(offTeam, defTeam) {
  const insights = [];

  const firstTd = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].first_td_rate, (t) => firstTdAllowedRate(t), false, true);
  if (firstTd) insights.push({ ...firstTd, category: "first_td", subject: null, team: offTeam, label: "for the first TD" });

  const posOpp = topOpportunity(
    POSITIONS.map((pos) => {
      const r = checkOpportunity(
        offTeam,
        defTeam,
        (t) => (DATA.team_stats[t].first_td_games ? DATA.team_stats[t].first_td_position[pos] / DATA.team_stats[t].first_td_games : null),
        (t) => (DATA.team_stats[t].trailing_games ? DATA.team_stats[t].first_td_position_allowed[pos] / DATA.team_stats[t].trailing_games : null),
        false,
        true
      );
      return r && { ...r, category: "first_td_position", subject: pos, team: offTeam, label: `${pos}s for the first TD` };
    })
  );
  if (posOpp) insights.push(posOpp);

  const rzOpp = checkOpportunity(
    offTeam,
    defTeam,
    (t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate,
    (t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate_allowed,
    false,
    true
  );
  if (rzOpp) insights.push({ ...rzOpp, category: "first_td_rz", subject: "conv", team: offTeam, label: "converting an early red zone trip into the first TD" });

  const speedOpp = checkOpportunity(
    offTeam,
    defTeam,
    (t) => DATA.team_stats[t].avg_possessions_to_first_td,
    (t) => DATA.team_stats[t].avg_possessions_allowed_before_first_td,
    true,
    false
  );
  if (speedOpp) insights.push({ ...speedOpp, category: "first_td_speed", subject: "speed", team: offTeam, label: "for a fast first TD" });

  return insights;
}

function computeFirstTdInsights(awayTeam, homeTeam) {
  return [...firstTdDirectionInsights(awayTeam, homeTeam), ...firstTdDirectionInsights(homeTeam, awayTeam)];
}

function renderBasicsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const offRateCls = tierFor("first_td_rate", offTeam, false);
  const defRateCls = tierForFirstTdAllowed(defTeam);
  const offRateExtreme = tierFor("first_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
  const defRateExtreme = tierForFirstTdAllowed(defTeam, TIER_Z_EXTREME_THRESHOLD);
  const offGamesCls = percentileTier(off.first_td_games, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
  const defGamesCls = percentileTier(firstTdAllowedGames(defTeam), teamsWithGames().map(firstTdAllowedGames), true);
  const offGamesA = tierAlphaAttr(off.first_td_games, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
  const offRateA = tierForAlphaAttr("first_td_rate", offTeam, false);
  const defGamesA = tierAlphaAttr(firstTdAllowedGames(defTeam), teamsWithGames().map(firstTdAllowedGames), true);
  const defRateA = tierForFirstTdAllowedAlphaAttr(defTeam);

  let rows = `<tr><td>First TD</td><td class="num ${offGamesCls}"${offGamesA}>${off.first_td_games}</td><td class="num ${offRateCls}"${offRateA}>${fmt(off.first_td_rate * 100, 0)}%</td><td class="num ${defGamesCls}"${defGamesA}>${firstTdAllowedGames(defTeam)}</td><td class="num ${defRateCls}"${defRateA}>${fmt(firstTdAllowedRate(defTeam) * 100, 0)}%</td>${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;

  rows += POSITIONS.map((pos) => {
    const offCount = off.first_td_position[pos];
    const defCount = def.first_td_position_allowed[pos];
    const offSharePct = off.first_td_games ? Math.round((offCount / off.first_td_games) * 100) : 0;
    const defSharePct = def.trailing_games ? Math.round((defCount / def.trailing_games) * 100) : 0;
    const offCountCls = bucketCountTier("first_td_position", pos, offTeam);
    const defCountCls = bucketCountTier("first_td_position_allowed", pos, defTeam, true);
    const offShareCls = bucketShareTier("first_td_position", "first_td_games", pos, offTeam);
    const defShareCls = bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true);
    const offShareExtreme = bucketShareTier("first_td_position", "first_td_games", pos, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${offSharePct}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${defSharePct}%</td>${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"], "first_td")}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Two separate panels instead of one table with two columns whose meaning
// flips depending on which side you're looking at. Offenses panel: both
// teams' own scoring-first record, offense-phrased throughout. Defenses
// panel: both teams' own allowing/preventing record, defense-phrased
// throughout -- same underlying possession data as the offense panel
// (see build_stats.py's trailing_possessions/possessions_to_score
// comments), just credited and worded from the other side of the ball.
// Every row uses ONE consistent meaning for both the Away and Home column,
// so there's nothing to mentally flip while reading either panel.
function teamPairTable(awayTeam, homeTeam, groups) {
  const headerCell = (team) => `<th style="background:rgba(${teamAccentRgb(team).join(",")},0.4)">${team}</th>`;
  const rows = groups
    .map((group) => {
      const label = `<tr><td class="section-group-label" colspan="3">${group.label}</td></tr>`;
      const dataRows = group.rows
        .map((r) => `<tr><td>${r.label}</td><td class="num ${r.awayCls || ""}">${r.away}</td><td class="num ${r.homeCls || ""}">${r.home}</td></tr>`)
        .join("");
      return label + dataRows;
    })
    .join("");
  return `<table class="data-table">
    <thead><tr><th></th>${headerCell(awayTeam)}${headerCell(homeTeam)}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const avgDisplay = (val, n) => (val === null ? "&mdash;" : `${fmt(val, 2)} <span class="muted">(n=${n})</span>`);
const percentileClsFor = (statKey, team, invert) => {
  const val = DATA.team_stats[team][statKey];
  if (val === null) return "";
  const pool = teamsWithGames().map((t) => DATA.team_stats[t][statKey]).filter((v) => v !== null);
  return percentileTier(val, pool, invert);
};
const rzConvCls = (statKey, team, invert) => {
  const val = DATA.team_stats[team][statKey];
  if (val === null) return "";
  const pool = teamsWithGames().map((t) => DATA.team_stats[t][statKey]).filter((v) => v !== null);
  return percentileTier(val, pool, invert);
};
const rzConvDisplay = (statKey, team) => {
  const val = DATA.team_stats[team][statKey];
  return val === null ? "&mdash;" : `${Math.round(val * 100)}%`;
};

function renderOffensesPanel(awayTeam, homeTeam) {
  const a = DATA.team_stats[awayTeam];
  const h = DATA.team_stats[homeTeam];
  const groups = [
    {
      label: "Scoring First",
      rows: [
        { label: "Games Played", away: a.games_played, home: h.games_played },
        {
          label: "Scored First",
          away: `${a.first_td_games} of ${a.games_played}`,
          home: `${h.first_td_games} of ${h.games_played}`,
          awayCls: tierFor("first_td_rate", awayTeam, false),
          homeCls: tierFor("first_td_rate", homeTeam, false),
        },
        {
          label: "When That Happened, Avg. Possessions It Took",
          away: avgDisplay(a.avg_possessions_to_first_td, a.possessions_to_first_td_games),
          home: avgDisplay(h.avg_possessions_to_first_td, h.possessions_to_first_td_games),
          awayCls: percentileClsFor("avg_possessions_to_first_td", awayTeam, true),
          homeCls: percentileClsFor("avg_possessions_to_first_td", homeTeam, true),
        },
      ],
    },
    {
      label: "Trailing",
      rows: [
        { label: "Didn't Score First", away: a.trailing_games, home: h.trailing_games },
        {
          label: "Of Those, Had a Possession First",
          away: `${a.trailing_games_with_possession} <span class="muted">(0: ${a.trailing_games_zero_possession})</span>`,
          home: `${h.trailing_games_with_possession} <span class="muted">(0: ${h.trailing_games_zero_possession})</span>`,
        },
        {
          label: "Avg. Possessions Before the Other Side Scored",
          away: a.avg_trailing_possessions === null ? "&mdash;" : fmt(a.avg_trailing_possessions, 2),
          home: h.avg_trailing_possessions === null ? "&mdash;" : fmt(h.avg_trailing_possessions, 2),
        },
      ],
    },
    {
      label: "Red Zone",
      rows: [
        {
          label: "RZ Trips Before First TD (Total / Per Game)",
          away: `<span class="${tierFor("pre_first_td_rz_trips", awayTeam, false)}">${a.pre_first_td_rz_trips}</span> / <span class="${tierFor("pre_first_td_rz_trips_per_g", awayTeam, false)}">${fmt(a.pre_first_td_rz_trips_per_g, 2)}</span>`,
          home: `<span class="${tierFor("pre_first_td_rz_trips", homeTeam, false)}">${h.pre_first_td_rz_trips}</span> / <span class="${tierFor("pre_first_td_rz_trips_per_g", homeTeam, false)}">${fmt(h.pre_first_td_rz_trips_per_g, 2)}</span>`,
        },
        {
          label: "Of Those, Converted to That TD",
          away: `${a.pre_first_td_rz_conversions} trip${a.pre_first_td_rz_conversions === 1 ? "" : "s"}`,
          home: `${h.pre_first_td_rz_conversions} trip${h.pre_first_td_rz_conversions === 1 ? "" : "s"}`,
        },
        {
          label: "Conversion Rate",
          away: rzConvDisplay("pre_first_td_rz_conversion_rate", awayTeam),
          home: rzConvDisplay("pre_first_td_rz_conversion_rate", homeTeam),
          awayCls: rzConvCls("pre_first_td_rz_conversion_rate", awayTeam, false),
          homeCls: rzConvCls("pre_first_td_rz_conversion_rate", homeTeam, false),
        },
      ],
    },
  ];
  return `<h3>Offenses</h3>${teamPairTable(awayTeam, homeTeam, groups)}`;
}

function renderDefensesPanel(awayTeam, homeTeam) {
  const a = DATA.team_stats[awayTeam];
  const h = DATA.team_stats[homeTeam];
  const groups = [
    {
      label: "Allowing First",
      rows: [
        { label: "Games Played", away: a.games_played, home: h.games_played },
        {
          label: "Allowed First Score",
          away: `${firstTdAllowedGames(awayTeam)} of ${a.games_played}`,
          home: `${firstTdAllowedGames(homeTeam)} of ${h.games_played}`,
          awayCls: tierForFirstTdAllowed(awayTeam),
          homeCls: tierForFirstTdAllowed(homeTeam),
        },
        {
          label: "When Allowed, Avg. Opponent's Possessions It Took Them",
          away: avgDisplay(a.avg_possessions_allowed_before_first_td, a.possessions_allowed_before_first_td_games),
          home: avgDisplay(h.avg_possessions_allowed_before_first_td, h.possessions_allowed_before_first_td_games),
          awayCls: percentileClsFor("avg_possessions_allowed_before_first_td", awayTeam, false),
          homeCls: percentileClsFor("avg_possessions_allowed_before_first_td", homeTeam, false),
        },
      ],
    },
    {
      label: "Preventing First",
      rows: [
        { label: "Prevented First Score / Scored First Themselves", away: a.first_td_games, home: h.first_td_games },
        {
          label: "Of Those, Opponent Had a Possession First",
          away: `${a.forced_games_with_possession} <span class="muted">(0: ${a.forced_games_zero_possession})</span>`,
          home: `${h.forced_games_with_possession} <span class="muted">(0: ${h.forced_games_zero_possession})</span>`,
        },
        {
          label: "Avg. Opponent Possessions Before This Team Scored",
          away: a.avg_opponent_possessions_forced === null ? "&mdash;" : fmt(a.avg_opponent_possessions_forced, 2),
          home: h.avg_opponent_possessions_forced === null ? "&mdash;" : fmt(h.avg_opponent_possessions_forced, 2),
        },
      ],
    },
    {
      label: "Red Zone",
      rows: [
        {
          label: "RZ Trips Allowed Before First TD (Total / Per Game)",
          away: `<span class="${tierFor("pre_first_td_rz_trips_allowed", awayTeam, true)}">${a.pre_first_td_rz_trips_allowed}</span> / <span class="${tierFor("pre_first_td_rz_trips_allowed_per_g", awayTeam, true)}">${fmt(a.pre_first_td_rz_trips_allowed_per_g, 2)}</span>`,
          home: `<span class="${tierFor("pre_first_td_rz_trips_allowed", homeTeam, true)}">${h.pre_first_td_rz_trips_allowed}</span> / <span class="${tierFor("pre_first_td_rz_trips_allowed_per_g", homeTeam, true)}">${fmt(h.pre_first_td_rz_trips_allowed_per_g, 2)}</span>`,
        },
        {
          label: "Of Those, Opponent Converted to That TD",
          away: `${a.pre_first_td_rz_conversions_allowed} trip${a.pre_first_td_rz_conversions_allowed === 1 ? "" : "s"}`,
          home: `${h.pre_first_td_rz_conversions_allowed} trip${h.pre_first_td_rz_conversions_allowed === 1 ? "" : "s"}`,
        },
        {
          label: "Conversion Rate Allowed",
          away: rzConvDisplay("pre_first_td_rz_conversion_rate_allowed", awayTeam),
          home: rzConvDisplay("pre_first_td_rz_conversion_rate_allowed", homeTeam),
          awayCls: rzConvCls("pre_first_td_rz_conversion_rate_allowed", awayTeam, true),
          homeCls: rzConvCls("pre_first_td_rz_conversion_rate_allowed", homeTeam, true),
        },
      ],
    },
  ];
  return `<h3>Defenses</h3>${teamPairTable(awayTeam, homeTeam, groups)}`;
}

function renderRzUsageTable(team) {
  const usage = (DATA.pre_first_td_usage[team] || []).filter((p) => p.carries + p.targets > 0);
  if (usage.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No red zone touches yet before a first TD this season.</p>`;
  }
  const firstTdsById = {};
  (DATA.player_stats[team] || []).forEach((p) => {
    firstTdsById[p.player_id] = p.first_tds;
  });

  const maxFirstTds = Math.max(...usage.map((p) => firstTdsById[p.player_id] || 0));
  const maxCarries = Math.max(...usage.map((p) => p.carries));
  const maxTargets = Math.max(...usage.map((p) => p.targets));
  const maxReceptions = Math.max(...usage.map((p) => p.receptions));
  const rows = usage
    .map((p) => {
      const firstTds = firstTdsById[p.player_id] || 0;
      const firstTdBg = teamFade(team, maxFirstTds ? firstTds / maxFirstTds : 0);
      const carriesBg = teamFade(team, maxCarries ? p.carries / maxCarries : 0);
      const targetsBg = teamFade(team, maxTargets ? p.targets / maxTargets : 0);
      const receptionsBg = teamFade(team, maxReceptions ? p.receptions / maxReceptions : 0);
      return `<tr><td>${p.name}</td><td>${p.position}</td><td class="num" style="background:${firstTdBg}">${firstTds}</td><td class="num" style="background:${carriesBg}">${p.carries}</td><td class="num" style="background:${targetsBg}">${p.targets}</td><td class="num" style="background:${receptionsBg}">${p.receptions}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">First TDs</th><th class="num">Carries</th><th class="num">Targets</th><th class="num">Rec</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Season TDs / First TD view toggle (localStorage so it survives a
// reload during a stream; a "?view=first" URL param wins on first load so
// the old first-td.html redirect can still land you on the right tab) ----
const TD_VIEW_KEY = "nfl-tool.td-view.v1";
let currentView = "season";

function loadSavedView() {
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl === "first" || fromUrl === "season") return fromUrl;
  try {
    return localStorage.getItem(TD_VIEW_KEY) || "season";
  } catch (e) {
    return "season";
  }
}

function setActiveView(view) {
  currentView = view;
  document.getElementById("view-season").hidden = view !== "season";
  document.getElementById("view-first").hidden = view !== "first";
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  try {
    localStorage.setItem(TD_VIEW_KEY, view);
  } catch (e) {
    // localStorage unavailable -- toggle just won't stick across reloads.
  }
  render();
}

document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

const ALL_SECTIONS = ["type", "player", "snapshot", "basics", "opportunities", "rzusage"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = ALL_SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML =
      currentView === "first"
        ? "<p>Choose both teams above to see the mini-game -- everything that happens before the game's very first touchdown.</p>"
        : "<p>Choose both teams above to see the matchup.</p>";
    return;
  }

  const awayStats = DATA.team_stats[away];
  const homeStats = DATA.team_stats[home];
  const awayReady = awayStats && awayStats.games_played > 0;
  const homeReady = homeStats && homeStats.games_played > 0;

  if (!awayReady || !homeReady) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    const missing = [!awayReady && away, !homeReady && home].filter(Boolean).join(" and ");
    emptyEl.innerHTML = `<p>${missing} ${missing.includes(" and ") ? "have" : "has"} no games played yet this season.</p>`;
    return;
  }
  emptyEl.hidden = true;
  sectionEls.forEach((el) => (el.hidden = false));

  // Season TDs view
  document.getElementById("col-away-type").innerHTML = renderStatTable(away, home);
  document.getElementById("col-home-type").innerHTML = renderStatTable(home, away);
  document.getElementById("col-away-position").innerHTML = renderPositionTable(away, home);
  document.getElementById("col-home-position").innerHTML = renderPositionTable(home, away);
  document.getElementById("col-away-distance").innerHTML = renderLengthTable(away, home);
  document.getElementById("col-home-distance").innerHTML = renderLengthTable(home, away);
  document.getElementById("lb-away").innerHTML = renderLeaderboard(away);
  document.getElementById("lb-home").innerHTML = renderLeaderboard(home);

  const notesEl = document.getElementById("td-notes");
  const notesKey = `${away}_${home}`;
  notesEl.value = loadTdNotes()[notesKey] || "";
  notesEl.dataset.key = notesKey;
  renderTdPossiblePlaysList(away, home);

  // First TD view
  document.getElementById("snapshot-content").innerHTML = renderMatchupSnapshot(computeFirstTdInsights(away, home));
  document.getElementById("col-away-basics").innerHTML = renderBasicsTable(away, home);
  document.getElementById("col-home-basics").innerHTML = renderBasicsTable(home, away);
  document.getElementById("panel-offenses").innerHTML = renderOffensesPanel(away, home);
  document.getElementById("panel-defenses").innerHTML = renderDefensesPanel(away, home);
  document.getElementById("rzusage-away").innerHTML = renderRzUsageTable(away);
  document.getElementById("rzusage-home").innerHTML = renderRzUsageTable(home);
}

document.getElementById("td-notes").addEventListener("input", (e) => {
  saveTdNote(e.target.dataset.key, e.target.value);
});

// Delegated so it catches a checkbox toggled inside the (dynamically
// created) odds modal too, not just ones already in the page at load time.
document.addEventListener("change", (e) => {
  if (e.target.closest(".pp-toggle")) {
    renderTdPossiblePlaysList(document.getElementById("away-select").value, document.getElementById("home-select").value);
  }
});

function populateSelects() {
  const awaySel = document.getElementById("away-select");
  const homeSel = document.getElementById("home-select");
  const opts = DATA.teams
    .slice()
    .sort((a, b) => (TEAM_NAMES[a] || a).localeCompare(TEAM_NAMES[b] || b))
    .map((t) => `<option value="${t}">${TEAM_NAMES[t] || t}</option>`)
    .join("");
  awaySel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  homeSel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  awaySel.addEventListener("change", render);
  homeSel.addEventListener("change", render);
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    let note = `${data.season} season — through week ${data.through_week}`;
    if (data.is_fallback_season) {
      note = `Showing final ${data.season} season — ${data.requested_season} season data isn't published on nflverse yet`;
    }
    document.getElementById("season-note").textContent = note;
    populateSelects();
    initScheduleScroller(render);
    setActiveView(loadSavedView());
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
