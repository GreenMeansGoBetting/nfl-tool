let DATA = null;

const POSITIONS = ["QB", "RB", "WR", "TE", "OTHER"];

// Every row in the combined offense/defense stat table. offKey is read off
// the offense-side team, defKey off the defense-side (opponent) team --
// same row, both numbers, so the tension is visible without flipping
// between sections.
const STAT_ROWS = [
  { label: "Pass TD / G", offKey: "pass_td_per_g", defKey: "pass_td_allowed_per_g", digits: 2 },
  { label: "Rush TD / G", offKey: "rush_td_per_g", defKey: "rush_td_allowed_per_g", digits: 2 },
  { label: "Total TD / G", offKey: "total_td_per_g", defKey: "total_td_allowed_per_g", digits: 2 },
  { label: "first-td-rate" },
  { label: "Pass TD", offKey: "pass_td", defKey: "pass_td_allowed", digits: 0 },
  { label: "Rush TD", offKey: "rush_td", defKey: "rush_td_allowed", digits: 0 },
  { label: "Total TDs", offKey: "total_td", defKey: "total_td_allowed", digits: 0 },
  { label: "first-td-count" },
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

function renderStatTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = STAT_ROWS.map((r) => {
    if (r.label === "first-td-rate") {
      const offCls = tierFor("first_td_rate", offTeam, false);
      const defCls = tierForFirstTdAllowed(defTeam);
      return `<tr><td>First TD Rate</td><td class="num ${offCls}">${fmt(off.first_td_rate * 100, 0)}%</td><td class="num ${defCls}">${fmt(firstTdAllowedRate(defTeam) * 100, 0)}%</td></tr>`;
    }
    if (r.label === "first-td-count") {
      const offCls = tierFor("first_td_rate", offTeam, false);
      const defCls = tierForFirstTdAllowed(defTeam);
      return `<tr><td>First TDs</td><td class="num ${offCls}">${off.first_td_games}</td><td class="num ${defCls}">${firstTdAllowedGames(defTeam)}</td></tr>`;
    }
    const offCls = tierFor(r.offKey, offTeam, false);
    const defCls = tierFor(r.defKey, defTeam, true);
    return `<tr><td>${r.label}</td><td class="num ${offCls}">${fmt(off[r.offKey], r.digits)}</td><td class="num ${defCls}">${fmt(def[r.defKey], r.digits)}</td></tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    <thead><tr><th></th><th>${offTeam}<span class="col-sub">OFF</span></th><th>${defTeam}<span class="col-sub">DEF</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderPositionTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const rows = POSITIONS.map((pos) => {
    const offShare = off.total_td ? off.off_position_td[pos] / off.total_td : 0;
    const defShare = def.total_td_allowed ? def.def_position_td_allowed[pos] / def.total_td_allowed : 0;
    const offCls = positionShareTier("off", pos, offTeam);
    const defCls = positionShareTier("def", pos, defTeam);
    return `<tr><td>${pos}</td><td class="num ${offCls}">${Math.round(offShare * 100)}%</td><td class="num ${defCls}">${Math.round(defShare * 100)}%</td></tr>`;
  }).join("");

  return `<table class="data-table">
    <thead><tr><th></th><th>${offTeam}<span class="col-sub">OFF</span></th><th>${defTeam}<span class="col-sub">DEF</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLeaderboard(team) {
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No TDs scored yet this season.</p>`;
  }
  const rows = players
    .map(
      (p) =>
        `<tr><td>${p.name}</td><td>${p.position}</td><td class="num">${p.tds}</td><td class="num">${p.first_tds}</td></tr>`
    )
    .join("");
  return `<h3>${team}</h3>
    <table class="data-table lb-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">TDs</th><th class="num">1st TDs</th></tr></thead>
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
