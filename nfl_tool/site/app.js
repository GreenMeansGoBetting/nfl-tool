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

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
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

const SECTIONS = ["snapshot", "type", "player"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>Choose both teams above to see the matchup.</p>";
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

  document.getElementById("snapshot-content").innerHTML = renderMatchupSnapshot(computeMatchupInsights(away, home));
  document.getElementById("col-away-type").innerHTML = renderStatTable(away, home);
  document.getElementById("col-home-type").innerHTML = renderStatTable(home, away);
  document.getElementById("col-away-position").innerHTML = renderPositionTable(away, home);
  document.getElementById("col-home-position").innerHTML = renderPositionTable(home, away);
  document.getElementById("col-away-distance").innerHTML = renderLengthTable(away, home);
  document.getElementById("col-home-distance").innerHTML = renderLengthTable(home, away);
  document.getElementById("lb-away").innerHTML = renderLeaderboard(away);
  document.getElementById("lb-home").innerHTML = renderLeaderboard(home);
}

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
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
