// "First TD mini-game" view: everything that happens in a game before the
// very first touchdown is scored, condensed from the same data.json used
// by the main matchup page.

function firstTdTopInsight(candidates) {
  const valid = candidates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (c.magnitude > best.magnitude ? c : best));
}

// Same idea as the Matchup page's snapshot, but sourced from the First-TD-
// specific stats on this page (who scores/allows the FIRST TD, not season
// totals) rather than the season-long Type of Touchdown/Position/Distance
// stats.
function firstTdDirectionInsights(offTeam, defTeam) {
  const insights = [];

  const firstTd = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].first_td_rate, (t) => firstTdAllowedRate(t), false, true);
  if (firstTd) insights.push({ ...firstTd, category: "first_td", subject: null, team: offTeam, label: "for the first TD" });

  const posOpp = firstTdTopInsight(
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

const SECTIONS = ["snapshot", "basics", "opportunities", "rzusage"];

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

  document.getElementById("snapshot-content").innerHTML = renderMatchupSnapshot(computeFirstTdInsights(away, home));
  document.getElementById("col-away-basics").innerHTML = renderBasicsTable(away, home);
  document.getElementById("col-home-basics").innerHTML = renderBasicsTable(home, away);
  document.getElementById("panel-offenses").innerHTML = renderOffensesPanel(away, home);
  document.getElementById("panel-defenses").innerHTML = renderDefensesPanel(away, home);
  document.getElementById("rzusage-away").innerHTML = renderRzUsageTable(away);
  document.getElementById("rzusage-home").innerHTML = renderRzUsageTable(home);
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
