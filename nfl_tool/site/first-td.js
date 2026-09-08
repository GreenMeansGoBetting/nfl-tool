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
    const offSharePct = off.first_td_games ? Math.round((offCount / off.first_td_games) * 100) : 0;
    const defSharePct = def.trailing_games ? Math.round((defCount / def.trailing_games) * 100) : 0;
    const offCountCls = bucketCountTier("first_td_position", pos, offTeam);
    const defCountCls = bucketCountTier("first_td_position_allowed", pos, defTeam, true);
    const offShareCls = bucketShareTier("first_td_position", "first_td_games", pos, offTeam);
    const defShareCls = bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true);
    return `<tr><td>${pos}</td><td class="num ${offCountCls}">${offCount}</td><td class="num ${offShareCls}">${offSharePct}%</td><td class="num ${defCountCls}">${defCount}</td><td class="num ${defShareCls}">${defSharePct}%</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// Rows 1-6 (scoring-first) compare TWO TEAMS' OWN records side by side --
// not an offense-vs-defense pairing like every other table on this site.
// "Didn't score first" for the away team isn't "what the home defense
// allows," it's just a fact about the away team's own games. Rows 7-9
// (red zone) ARE a genuine off/def pairing (this team's own red zone
// trips vs. what the other team's defense allows), same as elsewhere.
function renderOpportunitiesTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const scoredFirstCls = (team) => tierFor("first_td_rate", team, false);
  const avgPossCls = (team) => {
    const val = DATA.team_stats[team].avg_possessions_to_first_td;
    if (val === null) return "";
    const pool = teamsWithGames().map((t) => DATA.team_stats[t].avg_possessions_to_first_td).filter((v) => v !== null);
    return percentileTier(val, pool, true);
  };
  const avgPossDisplay = (team) => {
    const s = DATA.team_stats[team];
    return s.avg_possessions_to_first_td === null
      ? "&mdash;"
      : `${fmt(s.avg_possessions_to_first_td, 2)} <span class="muted">(n=${s.possessions_to_first_td_games})</span>`;
  };

  const offConvVals = teamsWithGames().map((t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate).filter((v) => v !== null);
  const defConvVals = teamsWithGames().map((t) => DATA.team_stats[t].pre_first_td_rz_conversion_rate_allowed).filter((v) => v !== null);
  const offConvVal = off.pre_first_td_rz_conversion_rate;
  const defConvVal = def.pre_first_td_rz_conversion_rate_allowed;
  const offConvCls = offConvVal === null ? "" : percentileTier(offConvVal, offConvVals, false);
  const defConvCls = defConvVal === null ? "" : percentileTier(defConvVal, defConvVals, true);
  const offConvDisplay = offConvVal === null ? "&mdash;" : `${Math.round(offConvVal * 100)}%`;
  const defConvDisplay = defConvVal === null ? "&mdash;" : `${Math.round(defConvVal * 100)}%`;

  const offRzTotalCls = tierFor("pre_first_td_rz_trips", offTeam, false);
  const offRzRateCls = tierFor("pre_first_td_rz_trips_per_g", offTeam, false);
  const defRzTotalCls = tierFor("pre_first_td_rz_trips_allowed", defTeam, true);
  const defRzRateCls = tierFor("pre_first_td_rz_trips_allowed_per_g", defTeam, true);

  return `<table class="data-table">
    <thead><tr><th></th><th style="background:rgba(${teamAccentRgb(offTeam).join(",")},0.4)">${offTeam}</th><th style="background:rgba(${teamAccentRgb(defTeam).join(",")},0.4)">${defTeam}</th></tr></thead>
    <tbody>
      <tr><td class="section-group-label" colspan="3">Scoring First</td></tr>
      <tr><td>Games Played</td><td class="num">${off.games_played}</td><td class="num">${def.games_played}</td></tr>
      <tr><td>Scored First</td><td class="num ${scoredFirstCls(offTeam)}">${off.first_td_games} of ${off.games_played}</td><td class="num ${scoredFirstCls(defTeam)}">${def.first_td_games} of ${def.games_played}</td></tr>
      <tr><td>When Scored First, Avg. Possessions</td><td class="num ${avgPossCls(offTeam)}">${avgPossDisplay(offTeam)}</td><td class="num ${avgPossCls(defTeam)}">${avgPossDisplay(defTeam)}</td></tr>
      <tr><td>Didn't Score First</td><td class="num">${off.trailing_games}</td><td class="num">${def.trailing_games}</td></tr>
      <tr><td>Of Those, Had a Possession First</td><td class="num">${off.trailing_games_with_possession} (0 poss: ${off.trailing_games_zero_possession})</td><td class="num">${def.trailing_games_with_possession} (0 poss: ${def.trailing_games_zero_possession})</td></tr>
      <tr><td>When Trailing, Avg. Possessions Before Opponent Scored</td><td class="num">${off.avg_trailing_possessions === null ? "&mdash;" : fmt(off.avg_trailing_possessions, 2)}</td><td class="num">${def.avg_trailing_possessions === null ? "&mdash;" : fmt(def.avg_trailing_possessions, 2)}</td></tr>
      <tr><td class="section-group-label" colspan="3">Red Zone</td></tr>
      <tr><td>RZ Trips Before First TD (Total / Per Game)</td><td class="num"><span class="${offRzTotalCls}">${off.pre_first_td_rz_trips}</span> / <span class="${offRzRateCls}">${fmt(off.pre_first_td_rz_trips_per_g, 2)}</span></td><td class="num"><span class="${defRzTotalCls}">${def.pre_first_td_rz_trips_allowed}</span> / <span class="${defRzRateCls}">${fmt(def.pre_first_td_rz_trips_allowed_per_g, 2)}</span></td></tr>
      <tr><td>Of Those, Converted to That TD</td><td class="num">${off.pre_first_td_rz_conversions} trip${off.pre_first_td_rz_conversions === 1 ? "" : "s"}</td><td class="num">${def.pre_first_td_rz_conversions_allowed} trip${def.pre_first_td_rz_conversions_allowed === 1 ? "" : "s"}</td></tr>
      <tr><td>Conversion Rate</td><td class="num ${offConvCls}">${offConvDisplay}</td><td class="num ${defConvCls}">${defConvDisplay}</td></tr>
    </tbody>
  </table>`;
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

const SECTIONS = ["basics", "opportunities", "rzusage", "scorers"];

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
