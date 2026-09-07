let DATA = null;

const POSITIONS = ["QB", "RB", "WR", "TE", "OTHER"];

// Every row in the combined offense/defense stat table -- each side shows
// BOTH the season total and the per-game rate, so nothing needs a second
// row. offKey/rateOffKey read off the offense-side team, the Def variants
// off the defense-side (opponent) team.
const STAT_ROWS = [
  { label: "Pass TD", totalOffKey: "pass_td", rateOffKey: "pass_td_per_g", totalDefKey: "pass_td_allowed", rateDefKey: "pass_td_allowed_per_g" },
  { label: "Rush TD", totalOffKey: "rush_td", rateOffKey: "rush_td_per_g", totalDefKey: "rush_td_allowed", rateDefKey: "rush_td_allowed_per_g" },
  { label: "Total TD", totalOffKey: "total_td", rateOffKey: "total_td_per_g", totalDefKey: "total_td_allowed", rateDefKey: "total_td_allowed_per_g" },
  { label: "First TD", special: "first" },
];

function teamsWithGames() {
  return DATA.teams.filter((t) => (DATA.team_stats[t]?.games_played || 0) > 0);
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

// Percentile tier across every team currently with games played.
// invert=true means a LOWER raw value is the good outcome (e.g. TDs allowed).
function percentileTier(value, allValues, invert) {
  if (allValues.length < 3) return "";
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.indexOf(value);
  let pct = rank / (sorted.length - 1);
  if (invert) pct = 1 - pct;
  if (pct >= 0.667) return "tier-good";
  if (pct >= 0.333) return "tier-mid";
  return "tier-bad";
}

function tierFor(statKey, team, invert) {
  const pool = teamsWithGames();
  const values = pool.map((t) => DATA.team_stats[t][statKey]);
  return percentileTier(DATA.team_stats[team][statKey], values, invert);
}

// A team's own share of its games where the OPPONENT scored first -- the
// complement of first_td_rate (exactly one team scores first per game), so
// it's a fully derived, no-new-data "how often does this defense let the
// other side score first" stat.
function firstTdAllowedRate(team) {
  const s = DATA.team_stats[team];
  return s.games_played ? 1 - s.first_td_rate : 0;
}
function firstTdAllowedGames(team) {
  const s = DATA.team_stats[team];
  return s.games_played - s.first_td_games;
}
function tierForFirstTdAllowed(team) {
  const pool = teamsWithGames();
  const values = pool.map((t) => firstTdAllowedRate(t));
  return percentileTier(firstTdAllowedRate(team), values, true);
}

// Position-share percentile: this position's TDs as a share of the team's
// total (scored, for 'off'; allowed, for 'def'), ranked across the league.
// Not inverted either way -- a high share is simply a strong tendency
// toward that position, not a quality judgment.
function positionShareTier(kind, pos, team) {
  const pool = teamsWithGames();
  const shareOf = (t) => {
    const s = DATA.team_stats[t];
    const total = kind === "off" ? s.total_td : s.total_td_allowed;
    const counts = kind === "off" ? s.off_position_td : s.def_position_td_allowed;
    return total ? counts[pos] / total : 0;
  };
  return percentileTier(shareOf(team), pool.map(shareOf), false);
}

// Same idea but on the raw count rather than the share -- same
// not-inverted-either-way reasoning.
function positionCountTier(kind, pos, team) {
  const pool = teamsWithGames();
  const countOf = (t) => {
    const s = DATA.team_stats[t];
    const counts = kind === "off" ? s.off_position_td : s.def_position_td_allowed;
    return counts[pos];
  };
  return percentileTier(countOf(team), pool.map(countOf), false);
}

function headerRow(offTeam, defTeam, subLabels) {
  return `<tr><th></th><th colspan="2" class="hdr-off">${offTeam}<span class="col-sub">OFF</span></th><th colspan="2" class="hdr-def">${defTeam}<span class="col-sub">DEF</span></th></tr>
    <tr><th></th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th><th class="sub-hdr">${subLabels[0]}</th><th class="sub-hdr">${subLabels[1]}</th></tr>`;
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
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"])}</thead>
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
    const offCountCls = positionCountTier("off", pos, offTeam);
    const offShareCls = positionShareTier("off", pos, offTeam);
    const defCountCls = positionCountTier("def", pos, defTeam);
    const defShareCls = positionShareTier("def", pos, defTeam);
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
  const games = DATA.team_stats[team]?.games_played || 0;
  const rows = players
    .map((p) => {
      const perG = games ? p.tds / games : 0;
      return `<tr><td>${p.name}</td><td>${p.position}</td><td class="num">${p.tds}</td><td class="num">${fmt(perG, 2)}</td><td class="num">${p.first_tds}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table lb-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">TDs</th><th class="num">TD/G</th><th class="num">1st TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const matchupEl = document.getElementById("matchup");
  const positionsEl = document.getElementById("positions");
  const lbEl = document.getElementById("leaderboards");
  const emptyEl = document.getElementById("empty-state");

  if (!away || !home) {
    matchupEl.hidden = true;
    positionsEl.hidden = true;
    lbEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  const awayStats = DATA.team_stats[away];
  const homeStats = DATA.team_stats[home];
  const awayReady = awayStats && awayStats.games_played > 0;
  const homeReady = homeStats && homeStats.games_played > 0;

  if (!awayReady || !homeReady) {
    matchupEl.hidden = true;
    positionsEl.hidden = true;
    lbEl.hidden = true;
    emptyEl.hidden = false;
    const missing = [!awayReady && away, !homeReady && home].filter(Boolean).join(" and ");
    emptyEl.innerHTML = `<p>${missing} ${missing.includes(" and ") ? "have" : "has"} no games played yet this season.</p>`;
    return;
  }
  emptyEl.hidden = true;
  matchupEl.hidden = false;
  positionsEl.hidden = false;
  lbEl.hidden = false;

  document.getElementById("col-away-off").innerHTML = renderStatTable(away, home);
  document.getElementById("col-home-off").innerHTML = renderStatTable(home, away);
  document.getElementById("pos-away-off").innerHTML = renderPositionTable(away, home);
  document.getElementById("pos-home-off").innerHTML = renderPositionTable(home, away);
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
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
