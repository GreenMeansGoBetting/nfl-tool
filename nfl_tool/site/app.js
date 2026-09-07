let DATA = null;

const RATE_STATS = [
  { key: "pass_td_per_g", label: "Pass TD / G", invert: false },
  { key: "rush_td_per_g", label: "Rush TD / G", invert: false },
  { key: "total_td_per_g", label: "Total TD / G", invert: false },
];

const ALLOWED_STATS = [
  { key: "pass_td_allowed_per_g", label: "Pass TD Allowed / G", invert: true },
  { key: "rush_td_allowed_per_g", label: "Rush TD Allowed / G", invert: true },
  { key: "total_td_allowed_per_g", label: "Total TD Allowed / G", invert: true },
];

const POSITIONS = ["QB", "RB", "WR", "TE", "OTHER"];

function teamsWithGames() {
  return DATA.teams.filter((t) => (DATA.team_stats[t]?.games_played || 0) > 0);
}

// Percentile-based tier across every team currently with games played.
// invert=true means a LOWER raw value is the good outcome (e.g. TDs allowed).
function tierFor(statKey, team, invert) {
  const pool = teamsWithGames();
  if (pool.length < 3) return "";
  const values = pool.map((t) => DATA.team_stats[t][statKey]).sort((a, b) => a - b);
  const value = DATA.team_stats[team][statKey];
  const rank = values.indexOf(value);
  let pct = rank / (values.length - 1);
  if (invert) pct = 1 - pct;
  if (pct >= 0.667) return "tier-good";
  if (pct >= 0.333) return "tier-mid";
  return "tier-bad";
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function renderRateTable(team, statList) {
  const rows = statList
    .map(({ key, label, invert }) => {
      const val = DATA.team_stats[team][key];
      const cls = tierFor(key, team, invert);
      return `<tr><td>${label}</td><td class="num ${cls}">${fmt(val)}</td></tr>`;
    })
    .join("");
  return `<table class="data-table"><tbody>${rows}</tbody></table>`;
}

function renderPositionTable(offCounts, offTotal, defCounts, defTotal) {
  const rows = POSITIONS.map((pos) => {
    const offN = offCounts[pos] || 0;
    const defN = defCounts[pos] || 0;
    const offPct = offTotal ? Math.round((offN / offTotal) * 100) : 0;
    const defPct = defTotal ? Math.round((defN / defTotal) * 100) : 0;
    return `<tr>
      <td>${pos}</td>
      <td class="num">${offN} (${offPct}%)</td>
      <td class="num">${defN} (${defPct}%)</td>
    </tr>`;
  }).join("");
  return `<table class="data-table">
    <thead><tr><th>Pos</th><th class="num">Scores (this team)</th><th class="num">Allows (opponent)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderTeamColumn(team, opponent, roleLabel) {
  const stats = DATA.team_stats[team];
  const oppStats = DATA.team_stats[opponent];
  const name = TEAM_NAMES[team] || team;

  if (!stats || stats.games_played === 0) {
    return `<h2>${name}</h2><div class="team-role">${roleLabel}</div>
      <p class="no-data-note">No games played yet this season.</p>`;
  }

  let html = `<h2>${name}</h2><div class="team-role">${roleLabel} &middot; ${stats.games_played} games played</div>`;

  html += `<div class="section-label">${team}'s scoring tendency</div>`;
  html += renderRateTable(team, RATE_STATS);

  if (oppStats && oppStats.games_played > 0) {
    html += `<div class="section-label">${opponent}'s defense allows</div>`;
    html += renderRateTable(opponent, ALLOWED_STATS);
  } else {
    html += `<p class="no-data-note">${opponent} has no games played yet this season.</p>`;
  }

  html += `<p class="first-td-line">Scored the game's first TD in <span class="value">${stats.first_td_games}</span> of <span class="value">${stats.games_played}</span> games (<span class="value">${fmt(stats.first_td_rate * 100, 1)}%</span>).</p>`;

  if (oppStats && oppStats.games_played > 0) {
    html += `<div class="section-label">TD scorer position: ${team} offense vs ${opponent} defense</div>`;
    html += renderPositionTable(
      stats.off_position_td,
      stats.total_td,
      oppStats.def_position_td_allowed,
      oppStats.total_td_allowed
    );
  }

  return html;
}

function renderLeaderboard(team) {
  const name = TEAM_NAMES[team] || team;
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `<h3>${name} &mdash; TD Leaderboard</h3><p class="no-data-note">No TDs scored yet this season.</p>`;
  }
  const rows = players
    .map(
      (p) =>
        `<tr><td>${p.name}</td><td>${p.position}</td><td class="num">${p.tds}</td><td class="num">${p.first_tds}</td></tr>`
    )
    .join("");
  return `<h3>${name} &mdash; TD Leaderboard</h3>
    <table class="data-table">
      <thead><tr><th>Player</th><th>Pos</th><th class="num">TDs</th><th class="num">1st TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const matchupEl = document.getElementById("matchup");
  const lbEl = document.getElementById("leaderboards");
  const emptyEl = document.getElementById("empty-state");

  if (!away || !home) {
    matchupEl.hidden = true;
    lbEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  matchupEl.hidden = false;
  lbEl.hidden = false;

  document.getElementById("col-away").innerHTML = renderTeamColumn(away, home, "Away");
  document.getElementById("col-home").innerHTML = renderTeamColumn(home, away, "Home");
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
