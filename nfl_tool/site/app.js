const LENGTH_BUCKETS = [
  { key: "under_10", label: "< 10 yd" },
  { key: "10_19", label: "10-19 yd" },
  { key: "20_29", label: "20-29 yd" },
  { key: "30_39", label: "30-39 yd" },
  { key: "40_49", label: "40-49 yd" },
  { key: "50_plus", label: "50+ yd" },
];

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

const RED_ZONE_ROWS = [
  { label: "RZ TD", totalOffKey: "rz_td", rateOffKey: "rz_td_per_g", totalDefKey: "rz_td_allowed", rateDefKey: "rz_td_allowed_per_g" },
  { label: "RZ Plays", totalOffKey: "rz_plays", rateOffKey: "rz_plays_per_g", totalDefKey: "rz_plays_allowed", rateDefKey: "rz_plays_allowed_per_g" },
  { label: "RZ Carries", totalOffKey: "rz_carries", rateOffKey: "rz_carries_per_g", totalDefKey: "rz_carries_allowed", rateDefKey: "rz_carries_allowed_per_g" },
  { label: "RZ Targets", totalOffKey: "rz_targets", rateOffKey: "rz_targets_per_g", totalDefKey: "rz_targets_allowed", rateDefKey: "rz_targets_allowed_per_g" },
];

function topInsight(candidates) {
  const valid = candidates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (c.magnitude > best.magnitude ? c : best));
}

// One direction (offTeam scoring/scored on defTeam) worth of insights
// across every category on this page. Called twice (away-vs-home and
// home-vs-away) and the results combined for the full matchup snapshot.
function directionInsights(offTeam, defTeam) {
  const insights = [];

  insights.push(
    checkAlignment(
      offTeam,
      defTeam,
      (t) => DATA.team_stats[t].first_td_rate,
      (t) => firstTdAllowedRate(t),
      false,
      true,
      (kind, offVal, defVal) =>
        kind === "likely"
          ? `${offTeam} scores the game's first TD ${pct(offVal)} of the time (top third league-wide); ${defTeam} allows the opponent to score first ${pct(defVal)} of the time (bottom third).`
          : `${offTeam} rarely scores the game's first TD (${pct(offVal)}, bottom third); ${defTeam} rarely allows it either (${pct(defVal)} allowed, top third).`
    )
  );

  insights.push(
    topInsight(
      POSITIONS.map((pos) =>
        checkAlignment(
          offTeam,
          defTeam,
          (t) => (DATA.team_stats[t].total_td ? DATA.team_stats[t].off_position_td[pos] / DATA.team_stats[t].total_td : null),
          (t) => (DATA.team_stats[t].total_td_allowed ? DATA.team_stats[t].def_position_td_allowed[pos] / DATA.team_stats[t].total_td_allowed : null),
          false,
          true,
          (kind, offVal, defVal) =>
            kind === "likely"
              ? `${offTeam}'s TDs skew toward ${pos} (${pct(offVal)} of their total, top third). ${defTeam} allows a similarly high share of TDs to ${pos}s (${pct(defVal)}, bottom third for defense).`
              : `${offTeam} rarely scores via ${pos} (${pct(offVal)}, bottom third). ${defTeam} rarely allows ${pos} scores either (${pct(defVal)}, top third for defense).`
        )
      )
    )
  );

  insights.push(
    topInsight(
      LENGTH_BUCKETS.map(({ key, label }) =>
        checkAlignment(
          offTeam,
          defTeam,
          (t) => (DATA.team_stats[t].total_td ? (DATA.team_stats[t].td_by_length[key] || 0) / DATA.team_stats[t].total_td : null),
          (t) => (DATA.team_stats[t].total_td_allowed ? (DATA.team_stats[t].td_by_length_allowed[key] || 0) / DATA.team_stats[t].total_td_allowed : null),
          false,
          true,
          (kind, offVal, defVal) =>
            kind === "likely"
              ? `${offVal ? pct(offVal) : "0%"} of ${offTeam}'s TDs go for ${label} (top third). ${defTeam} allows a similarly high share of ${label} TDs (${pct(defVal)}, bottom third for defense).`
              : `${offTeam} rarely scores from ${label} (${pct(offVal)}, bottom third). ${defTeam} rarely allows ${label} TDs either (${pct(defVal)}, top third for defense).`
        )
      )
    )
  );

  insights.push(
    topInsight([
      checkAlignment(
        offTeam,
        defTeam,
        (t) => DATA.team_stats[t].rz_td_per_g,
        (t) => DATA.team_stats[t].rz_td_allowed_per_g,
        false,
        true,
        (kind, offVal, defVal) =>
          kind === "likely"
            ? `${offTeam} scores ${fmt(offVal, 2)} red zone TDs/game (top third); ${defTeam} allows ${fmt(defVal, 2)} red zone TDs/game (bottom third).`
            : `${offTeam} rarely scores in the red zone (${fmt(offVal, 2)}/game, bottom third); ${defTeam} rarely allows it either (${fmt(defVal, 2)}/game, top third).`
      ),
      checkAlignment(
        offTeam,
        defTeam,
        (t) => DATA.team_stats[t].rz_plays_per_g,
        (t) => DATA.team_stats[t].rz_plays_allowed_per_g,
        false,
        true,
        (kind, offVal, defVal) =>
          kind === "likely"
            ? `${offTeam} runs ${fmt(offVal, 2)} red zone plays/game (top third); ${defTeam} allows ${fmt(defVal, 2)} red zone plays/game (bottom third).`
            : `${offTeam} rarely gets to the red zone (${fmt(offVal, 2)} plays/game, bottom third); ${defTeam} rarely allows red zone trips either (${fmt(defVal, 2)}/game, top third).`
      ),
    ])
  );

  return insights.filter(Boolean);
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
      return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${offTotal}</td><td class="num ${offRateCls}">${fmt(offRate, 0)}%</td><td class="num ${defTotalCls}">${defTotal}</td><td class="num ${defRateCls}">${fmt(defRate, 0)}%</td></tr>`;
    }
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${off[r.totalOffKey]}</td><td class="num ${offRateCls}">${fmt(off[r.rateOffKey], 2)}</td><td class="num ${defTotalCls}">${def[r.totalDefKey]}</td><td class="num ${defRateCls}">${fmt(def[r.rateDefKey], 2)}</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRedZoneTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = RED_ZONE_ROWS.map((r) => {
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offTotalCls}">${off[r.totalOffKey]}</td><td class="num ${offRateCls}">${fmt(off[r.rateOffKey], 2)}</td><td class="num ${defTotalCls}">${def[r.totalDefKey]}</td><td class="num ${defRateCls}">${fmt(def[r.rateDefKey], 2)}</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
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
    const offShare = off.total_td ? Math.round((offCount / off.total_td) * 100) : 0;
    const defShare = def.total_td_allowed ? Math.round((defCount / def.total_td_allowed) * 100) : 0;
    return `<tr><td>${label}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${offShare}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${defShare}%</td></tr>`;
  }).join("");

  return `<table class="data-table pos-table">
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
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${Math.round(offShare * 100)}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${Math.round(defShare * 100)}%</td></tr>`;
  }).join("");

  return `<table class="data-table pos-table">
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

const SECTIONS = ["snapshot", "type", "position", "distance", "redzone", "player"];

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
  document.getElementById("col-away-redzone").innerHTML = renderRedZoneTable(away, home);
  document.getElementById("col-home-redzone").innerHTML = renderRedZoneTable(home, away);
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
