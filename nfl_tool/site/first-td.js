// "First TD mini-game" view: everything that happens in a game before the
// very first touchdown is scored, condensed from the same data.json used
// by the main matchup page.

function renderBasicsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const offRateCls = tierFor("first_td_rate", offTeam, false);
  const defRateCls = tierForFirstTdAllowed(defTeam);
  const offGamesCls = percentileTier(off.first_td_games, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
  const defGamesCls = percentileTier(firstTdAllowedGames(defTeam), teamsWithGames().map(firstTdAllowedGames), true);

  let rows = `<tr><td>First TD</td><td class="num ${offGamesCls}">${off.first_td_games}</td><td class="num ${offRateCls}">${fmt(off.first_td_rate * 100, 0)}%</td><td class="num ${defGamesCls}">${firstTdAllowedGames(defTeam)}</td><td class="num ${defRateCls}">${fmt(firstTdAllowedRate(defTeam) * 100, 0)}%</td></tr>`;

  rows += POSITIONS.map((pos) => {
    const offCount = off.first_td_position[pos];
    const defCount = def.first_td_position_allowed[pos];
    const defTotal = Object.values(def.first_td_position_allowed).reduce((a, b) => a + b, 0);
    const offSharePct = off.first_td_games ? Math.round((offCount / off.first_td_games) * 100) : 0;
    const defSharePct = defTotal ? Math.round((defCount / defTotal) * 100) : 0;
    const offCountCls = bucketCountTier("first_td_position", pos, offTeam);
    const defCountCls = bucketCountTier("first_td_position_allowed", pos, defTeam);
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num">${offSharePct}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num">${defSharePct}%</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderOpportunitiesTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const ownVals = teamsWithGames()
    .map((t) => DATA.team_stats[t].avg_possessions_to_first_td)
    .filter((v) => v !== null);
  const allowedVals = teamsWithGames()
    .map((t) => DATA.team_stats[t].avg_possessions_allowed_before_first_td)
    .filter((v) => v !== null);

  const offVal = off.avg_possessions_to_first_td;
  const defVal = def.avg_possessions_allowed_before_first_td;
  const offCls = offVal === null ? "" : percentileTier(offVal, ownVals, true);
  const defCls = defVal === null ? "" : percentileTier(defVal, allowedVals, false);

  const offDisplay = offVal === null ? "&mdash;" : fmt(offVal, 2);
  const defDisplay = defVal === null ? "&mdash;" : fmt(defVal, 2);

  return `<table class="data-table">
    <thead><tr><th></th><th style="background:rgba(${teamAccentRgb(offTeam).join(",")},0.4)">${offTeam}<span class="col-sub">OFF</span></th><th style="background:rgba(${teamAccentRgb(defTeam).join(",")},0.4)">${defTeam}<span class="col-sub">DEF</span></th></tr></thead>
    <tbody>
      <tr><td>Avg. Possessions to Score First TD</td><td class="num ${offCls}">${offDisplay}</td><td class="num ${defCls}">${defDisplay}</td></tr>
      <tr><td class="muted-label">Sample size (games)</td><td class="num muted">${off.possessions_to_first_td_games}</td><td class="num muted">${def.possessions_allowed_before_first_td_games}</td></tr>
      <tr><td class="muted-label">First TD was a DST/return score instead</td><td class="num muted">${off.first_td_dst_games}</td><td class="num muted">${def.first_td_dst_allowed_games}</td></tr>
    </tbody>
  </table>`;
}

function renderFieldPosTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const offVals = teamsWithGames().map((t) => DATA.team_stats[t].avg_start_yardline_100_off);
  const defVals = teamsWithGames().map((t) => DATA.team_stats[t].avg_start_yardline_100_def);
  const offCls = percentileTier(off.avg_start_yardline_100_off, offVals, true);
  const defCls = percentileTier(def.avg_start_yardline_100_def, defVals, false);

  const toOwnYard = (v) => `Own ${Math.round(100 - v)}`;

  return `<table class="data-table">
    <thead><tr><th></th><th style="background:rgba(${teamAccentRgb(offTeam).join(",")},0.4)">${offTeam}<span class="col-sub">OFF</span></th><th style="background:rgba(${teamAccentRgb(defTeam).join(",")},0.4)">${defTeam}<span class="col-sub">DEF</span></th></tr></thead>
    <tbody>
      <tr><td>Avg. Starting Field Position</td><td class="num ${offCls}">${toOwnYard(off.avg_start_yardline_100_off)}</td><td class="num ${defCls}">${toOwnYard(def.avg_start_yardline_100_def)}</td></tr>
    </tbody>
  </table>`;
}

function renderRedZoneBeforeTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const offTotalCls = tierFor("pre_first_td_rz_trips", offTeam, false);
  const offRateCls = tierFor("pre_first_td_rz_trips_per_g", offTeam, false);
  const defTotalCls = tierFor("pre_first_td_rz_trips_allowed", defTeam, true);
  const defRateCls = tierFor("pre_first_td_rz_trips_allowed_per_g", defTeam, true);

  const offConvVals = teamsWithGames()
    .map((t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate)
    .filter((v) => v !== null);
  const defConvVals = teamsWithGames()
    .map((t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate_allowed)
    .filter((v) => v !== null);
  const offConvVal = off.pre_first_td_rz_conversion_rate;
  const defConvVal = def.pre_first_td_rz_conversion_rate_allowed;
  const offConvCls = offConvVal === null ? "" : percentileTier(offConvVal, offConvVals, false);
  const defConvCls = defConvVal === null ? "" : percentileTier(defConvVal, defConvVals, true);
  const offConvDisplay = offConvVal === null ? "&mdash;" : `${Math.round(offConvVal * 100)}%`;
  const defConvDisplay = defConvVal === null ? "&mdash;" : `${Math.round(defConvVal * 100)}%`;

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>
      <tr><td>RZ Trips Before First TD</td><td class="num ${offTotalCls}">${off.pre_first_td_rz_trips}</td><td class="num ${offRateCls}">${fmt(off.pre_first_td_rz_trips_per_g, 2)}</td><td class="num ${defTotalCls}">${def.pre_first_td_rz_trips_allowed}</td><td class="num ${defRateCls}">${fmt(def.pre_first_td_rz_trips_allowed_per_g, 2)}</td></tr>
      <tr><td>Of Those, Converted to That TD</td><td class="num" colspan="2">${off.pre_first_td_rz_conversions} trip${off.pre_first_td_rz_conversions === 1 ? "" : "s"}</td><td class="num" colspan="2">${def.pre_first_td_rz_conversions_allowed} trip${def.pre_first_td_rz_conversions_allowed === 1 ? "" : "s"}</td></tr>
      <tr><td>Conversion Rate</td><td class="num ${offConvCls}" colspan="2">${offConvDisplay}</td><td class="num ${defConvCls}" colspan="2">${defConvDisplay}</td></tr>
    </tbody>
  </table>`;
}

function renderRzUsageTable(team) {
  const usage = (DATA.pre_first_td_usage[team] || []).filter((p) => p.carries + p.targets > 0);
  if (usage.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No red zone touches yet before a first TD this season.</p>`;
  }
  const maxCarries = Math.max(...usage.map((p) => p.carries));
  const maxTargets = Math.max(...usage.map((p) => p.targets));
  const maxReceptions = Math.max(...usage.map((p) => p.receptions));
  const rows = usage
    .map((p) => {
      const carriesBg = teamFade(team, maxCarries ? p.carries / maxCarries : 0);
      const targetsBg = teamFade(team, maxTargets ? p.targets / maxTargets : 0);
      const receptionsBg = teamFade(team, maxReceptions ? p.receptions / maxReceptions : 0);
      return `<tr><td>${p.name}</td><td>${p.position}</td><td class="num" style="background:${carriesBg}">${p.carries}</td><td class="num" style="background:${targetsBg}">${p.targets}</td><td class="num" style="background:${receptionsBg}">${p.receptions}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">Carries</th><th class="num">Targets</th><th class="num">Rec</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderScorers(team) {
  const players = (DATA.player_stats[team] || [])
    .filter((p) => p.first_tds > 0)
    .slice()
    .sort((a, b) => b.first_tds - a.first_tds || (a.name || "").localeCompare(b.name || ""));
  if (players.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No first-TD scores yet this season.</p>`;
  }
  const rows = players
    .map((p) => {
      const tag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
      return `<tr><td>${p.name}${tag}</td><td>${p.position}</td><td class="num">${p.first_tds}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">First TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const SECTIONS = ["basics", "opportunities", "fieldpos", "rz", "rzusage", "scorers"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>Choose both teams above to see the mini-game -- everything that happens before the game's very first touchdown.</p>";
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

  document.getElementById("col-away-basics").innerHTML = renderBasicsTable(away, home);
  document.getElementById("col-home-basics").innerHTML = renderBasicsTable(home, away);
  document.getElementById("col-away-opportunities").innerHTML = renderOpportunitiesTable(away, home);
  document.getElementById("col-home-opportunities").innerHTML = renderOpportunitiesTable(home, away);
  document.getElementById("col-away-fieldpos").innerHTML = renderFieldPosTable(away, home);
  document.getElementById("col-home-fieldpos").innerHTML = renderFieldPosTable(home, away);
  document.getElementById("col-away-rz").innerHTML = renderRedZoneBeforeTable(away, home);
  document.getElementById("col-home-rz").innerHTML = renderRedZoneBeforeTable(home, away);
  document.getElementById("rzusage-away").innerHTML = renderRzUsageTable(away);
  document.getElementById("rzusage-home").innerHTML = renderRzUsageTable(home);
  document.getElementById("scorers-away").innerHTML = renderScorers(away);
  document.getElementById("scorers-home").innerHTML = renderScorers(home);
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
