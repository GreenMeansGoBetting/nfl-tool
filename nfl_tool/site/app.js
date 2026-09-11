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
    return `<tr><td><span class="dist-row-click" data-bucket="${key}">${label}</span></td><td class="num ${offCountCls}"${offCountA}>${offCount}</td><td class="num ${offShareCls}"${offShareA}>${offShare}%</td><td class="num ${defCountCls}"${defCountA}>${defCount}</td><td class="num ${defShareCls}"${defShareA}>${defShare}%</td>${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
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
    return `<tr><td><span class="pos-row-click" data-pos="${pos}">${pos}</span></td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${Math.round(offShare * 100)}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${Math.round(defShare * 100)}%</td>${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- TD breakdown modal: clicking a Position or Distance row shows the
// actual players behind that team-level number, both teams at once, grouped
// by every position (or every distance bucket) so the clicked row is a
// starting point to scroll to -- not a filter that hides the rest. Reuses
// the .modal-overlay/.modal-box shell pattern (own instance, matching how
// every other modal on this site is its own self-contained overlay rather
// than a shared one) but is otherwise independent of the player-odds modal.
function tdBreakdownGroups(kind, awayTeam, homeTeam) {
  const allPlayers = [awayTeam, homeTeam].flatMap((t) => (DATA.player_stats[t] || []).map((p) => ({ ...p, team: t })));
  if (kind === "position") {
    return POSITIONS.map((pos) => ({
      key: pos,
      label: pos,
      players: allPlayers
        .filter((p) => p.position === pos)
        .map((p) => ({ ...p, count: p.tds }))
        .sort((a, b) => b.count - a.count),
    }));
  }
  return LENGTH_BUCKETS.map(({ key, label }) => ({
    key,
    label,
    players: allPlayers
      .filter((p) => (p.tds_by_length[key] || 0) > 0)
      .map((p) => ({ ...p, count: p.tds_by_length[key] }))
      .sort((a, b) => b.count - a.count),
  }));
}

function tdBreakdownPlayerRow(p, kind) {
  const rgb = teamAccentRgb(p.team);
  const rowStyle = `border-left:4px solid rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.07);`;
  let countLabel = `${p.count} TD${p.count === 1 ? "" : "s"}`;
  // Only worth calling out when it's actually a mix -- a pure rusher or
  // pure receiver doesn't need "(N rush)" restating what the position
  // column already implies.
  if (kind === "position" && p.rush_tds > 0 && p.rec_tds > 0) {
    countLabel += ` <span class="muted-label">(${p.rush_tds} rush / ${p.rec_tds} rec)</span>`;
  }
  const dstTag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
  // Season-long target rank within the player's own team (1 = most
  // targeted WR) -- tells you whether a defense gave up a TD to a team's
  // clear #1 option or someone further down the depth chart.
  const wrRankTag = p.position === "WR" && p.wr_rank ? ` <span class="muted-label">(WR${p.wr_rank})</span>` : "";
  return `<tr style="${rowStyle}"><td>${teamLogoMini(p.team)} ${p.name}${wrRankTag}${dstTag}</td><td class="num">${countLabel}</td></tr>`;
}

function renderTdBreakdownModalContent(kind, awayTeam, homeTeam, highlightKey) {
  const title = kind === "position" ? "Touchdowns by Position" : "Touchdowns by Distance";
  const groups = tdBreakdownGroups(kind, awayTeam, homeTeam);
  const sections = groups
    .map((g) => {
      const rows = g.players.length
        ? g.players.map((p) => tdBreakdownPlayerRow(p, kind)).join("")
        : `<tr><td colspan="2" class="no-data-note">No one yet</td></tr>`;
      const highlightCls = g.key === highlightKey ? " td-breakdown-group-highlight" : "";
      return `<div class="td-breakdown-group${highlightCls}" id="td-breakdown-group-${g.key}">
        <h3>${g.label}</h3>
        <table class="data-table td-breakdown-table">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
  return `<h3>${awayTeam} @ ${homeTeam} &mdash; ${title}</h3>${sections}`;
}

function ensureTdBreakdownModal() {
  if (document.getElementById("td-breakdown-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "td-breakdown-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="td-breakdown-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTdBreakdownModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeTdBreakdownModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTdBreakdownModal();
  });
}

function closeTdBreakdownModal() {
  const el = document.getElementById("td-breakdown-modal");
  if (el) el.hidden = true;
}

function openTdBreakdownModal(kind, awayTeam, homeTeam, highlightKey) {
  ensureTdBreakdownModal();
  document.getElementById("td-breakdown-modal-content").innerHTML = renderTdBreakdownModalContent(kind, awayTeam, homeTeam, highlightKey);
  document.getElementById("td-breakdown-modal").hidden = false;
  const target = document.getElementById(`td-breakdown-group-${highlightKey}`);
  if (target) target.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (e) => {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  if (!away || !home) return;
  const posBtn = e.target.closest(".pos-row-click");
  if (posBtn) {
    openTdBreakdownModal("position", away, home, posBtn.dataset.pos);
    return;
  }
  const distBtn = e.target.closest(".dist-row-click");
  if (distBtn) openTdBreakdownModal("distance", away, home, distBtn.dataset.bucket);
});

// Shared full-width header for every per-team player table (Season TDs'
// leaderboard, First TD's Red Zone Usage) so both read as the same
// component -- these boxes run tall with rows of player data, so there's
// plenty of width to spare for a real logo and the full team name instead
// of a bare "<h3>NE</h3>".
function renderLeaderboard(team) {
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No TDs scored yet this season.</p>`;
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
  return `${teamBannerHeader(team)}
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
// just skip the logo. Writes to every ".td-possible-plays-list" on the page,
// not just one -- Season TDs and First TD each have their own copy of this
// list (same underlying data), since only one view is visible at a time.
function renderTdPossiblePlaysList(away, home) {
  // Exact team-code match (split on " @ "), not a substring check -- LA is
  // a substring of LAC, so .includes() would wrongly match one team's
  // plays onto an unrelated matchup involving the other.
  const list = loadPossiblePlays().filter((p) => {
    if (!p.matchup) return false;
    const teams = p.matchup.split(" @ ");
    return teams.includes(away) && teams.includes(home);
  });
  const els = document.querySelectorAll(".td-possible-plays-list");
  if (!els.length) return;
  const html = !list.length
    ? `<p class="no-data-note">None yet for this matchup -- check a player in the TD odds modal to add one.</p>`
    : list
    .slice()
    .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
    .map(
      (p) =>
        `<div class="td-pp-row">${p.team ? teamLogoMini(p.team) : ""}<span class="td-pp-desc">${p.description}</span><span class="td-pp-odds">${p.odds}</span></div>`
    )
    .join("");
  els.forEach((el) => (el.innerHTML = html));
}

// ---- First TD view: everything that happens in a game before the very
// first touchdown is scored, condensed from the same team_stats already
// loaded above. Ported in from the old standalone first-td.html/first-td.js
// so both views can share one page, one data.json fetch, and one toggle. ----

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

const percentileClsFor = (statKey, team, invert) => {
  const val = DATA.team_stats[team][statKey];
  if (val === null) return "";
  const pool = teamsWithGames().map((t) => DATA.team_stats[t][statKey]).filter((v) => v !== null);
  return percentileTier(val, pool, invert);
};
const rzConvDisplay = (statKey, team) => {
  const val = DATA.team_stats[team][statKey];
  return val === null ? "&mdash;" : `${Math.round(val * 100)}%`;
};

// Condensed to answer exactly three things at a glance: who's more likely
// to score first, does a team finish the red-zone trips it gets on its own
// (offense), and does its own defense bail it out by stopping the other
// side's (defense) -- deliberately drops games-played (implied by the X-of-Y
// in Scored First) and the trailing-possession detail that doesn't serve
// those three questions.
function renderOpportunitiesSummary(awayTeam, homeTeam) {
  const headerCell = (team) => `<th style="background:rgba(${teamAccentRgb(team).join(",")},0.4)">${teamLogoMini(team)}${team}</th>`;

  const scoredFirstCell = (team) => {
    const s = DATA.team_stats[team];
    return `<td class="num ${tierFor("first_td_rate", team, false)}">${fmt(s.first_td_rate * 100, 0)}% <span class="muted">(${s.first_td_games}/${s.games_played})</span></td>`;
  };

  const rzCell = (team, statKey, tripsKey, invert) => {
    const val = DATA.team_stats[team][statKey];
    const cls = val === null ? "" : percentileClsFor(statKey, team, invert);
    const suffix = val === null ? "" : ` <span class="muted">(n=${DATA.team_stats[team][tripsKey]})</span>`;
    return `<td class="num ${cls}">${rzConvDisplay(statKey, team)}${suffix}</td>`;
  };

  const rzRow = (label, statKey, tripsKey, invert) =>
    `<tr><td>${label}</td>${rzCell(awayTeam, statKey, tripsKey, invert)}${rzCell(homeTeam, statKey, tripsKey, invert)}</tr>`;

  return `<table class="data-table opp-table">
    <thead><tr><th></th>${headerCell(awayTeam)}${headerCell(homeTeam)}</tr></thead>
    <tbody>
      <tr><td>Scored First</td>${scoredFirstCell(awayTeam)}${scoredFirstCell(homeTeam)}</tr>
      ${rzRow("RZ Finish %", "pre_first_td_rz_conversion_rate", "pre_first_td_rz_trips", false)}
      ${rzRow("RZ Allowed %", "pre_first_td_rz_conversion_rate_allowed", "pre_first_td_rz_trips_allowed", true)}
    </tbody>
  </table>`;
}

function renderRzUsageTable(team) {
  const usage = (DATA.pre_first_td_usage[team] || []).filter((p) => p.carries + p.targets > 0);
  if (usage.length === 0) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No red zone touches yet before a first TD this season.</p>`;
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
  return `${teamBannerHeader(team)}
    <table class="data-table rzusage-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">1st TDs</th><th class="num">Carries</th><th class="num">Targets</th><th class="num">Rec</th></tr></thead>
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

const ALL_SECTIONS = ["type", "player", "basics", "rzusage"];

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

  const notesKey = `${away}_${home}`;
  const savedNote = loadTdNotes()[notesKey] || "";
  document.querySelectorAll(".td-notes-input").forEach((el) => {
    el.value = savedNote;
    el.dataset.key = notesKey;
  });
  renderTdPossiblePlaysList(away, home);

  // First TD view
  document.getElementById("col-away-basics").innerHTML = renderBasicsTable(away, home);
  document.getElementById("col-home-basics").innerHTML = renderBasicsTable(home, away);
  document.getElementById("opportunities-summary").innerHTML = renderOpportunitiesSummary(away, home);
  document.getElementById("rzusage-away").innerHTML = renderRzUsageTable(away);
  document.getElementById("rzusage-home").innerHTML = renderRzUsageTable(home);
}

// Delegated (not one listener per textarea) since Season TDs and First TD
// each have their own notes box for the same matchup -- typing in either
// saves to the shared key and mirrors the text into the other immediately,
// so neither ever shows stale text even without a re-render in between.
document.addEventListener("input", (e) => {
  if (!e.target.classList.contains("td-notes-input")) return;
  saveTdNote(e.target.dataset.key, e.target.value);
  document.querySelectorAll(".td-notes-input").forEach((el) => {
    if (el !== e.target) el.value = e.target.value;
  });
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
