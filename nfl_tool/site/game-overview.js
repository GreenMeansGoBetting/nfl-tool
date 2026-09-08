// "Normal" broadcast-style box score stats, one simple team-vs-team table
// (not an offense-vs-opponent's-defense mismatch table like the TD pages --
// this page is a quick overview, not a matchup-exploit finder). Red zone
// and explosive plays are included but kept to one row each, not their own
// section, per feedback that they shouldn't be massive categories here.
// Same set picked via the Game Overview Stat Picker checklist, but paired
// one offense stat per row with its defense mirror -- half the rows, and
// each row reads as a matchup ("this team's pass volume vs that team's
// pass defense") instead of two separate lines. Penalty Yards had no
// defense-side mirror selected/computed, so it's left out of this table.
const GENERAL_STAT_ROWS = [
  { label: "Points", offKey: "points_for_per_g", offInvert: false, defKey: "points_against_per_g", defInvert: true },
  { label: "Pass Attempts", offKey: "pass_att_per_g", offInvert: false, defKey: "pass_att_allowed_per_g", defInvert: true },
  { label: "Pass Yards", offKey: "pass_yards_per_g", offInvert: false, defKey: "pass_yards_allowed_per_g", defInvert: true },
  { label: "Sacks", offKey: "sacks_allowed_per_g", offInvert: true, defKey: "sacks_made_per_g", defInvert: false },
  { label: "Rush Attempts", offKey: "rush_att_per_g", offInvert: false, defKey: "rush_att_allowed_per_g", defInvert: true },
  { label: "Rush Yards", offKey: "rush_yards_per_g", offInvert: false, defKey: "rush_yards_allowed_per_g", defInvert: true },
  { label: "Yards / Carry", offKey: "yards_per_carry", offInvert: false, defKey: "yards_per_carry_allowed", defInvert: true },
  { label: "Turnovers", offKey: "turnovers_per_g", offInvert: true, defKey: "takeaways_per_g", defInvert: false },
  { label: "Red Zone TD %", offKey: "rz_td_rate", offInvert: false, defKey: "rz_td_rate_allowed", defInvert: true, pct: true },
  { label: "Explosive Play Rate", offKey: "explosive_rate", offInvert: false, defKey: "explosive_rate_allowed", defInvert: true, pct: true },
];

const MARKETS = [
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "moneyline", label: "Moneyline" },
];
const COLORS = [
  { key: "green", label: "Good Play" },
  { key: "yellow", label: "Lean" },
  { key: "red", label: "No Confidence" },
];

const SECTIONS = ["injuries", "odds", "general", "recent", "picks"];

let weekGames = [];
let currentGameIndex = 0;
let draftPicks = {};

function resetDraftPicks() {
  draftPicks = { spread: {}, total: {}, moneyline: {} };
}

function gamesForWeek(week) {
  if (week == null) return [];
  return (DATA.schedule || []).filter((g) => g.week === week);
}

function currentGame() {
  return weekGames[currentGameIndex] || null;
}

// ---- formatting helpers ----
function fmtSigned(n) {
  if (n === null || n === undefined) return "";
  return n > 0 ? `+${fmt(n, 1)}` : fmt(n, 1);
}
function fmtOdds(n) {
  if (n === null || n === undefined) return "";
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}
function fmtPct(p) {
  return p === null || p === undefined ? "" : `${Math.round(p * 100)}%`;
}
// nflverse's schedule "gametime" is already Eastern -- just reformat to
// 12-hour, no timezone math needed.
function fmtGameTime(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period} ET`;
}

function renderGameHeader(game) {
  const headerEl = document.getElementById("game-header");
  headerEl.hidden = false;
  const dateLabel = game.date
    ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  const timeLabel = fmtGameTime(game.time);
  headerEl.innerHTML = `
    <div class="game-header-teams">
      <img src="${teamLogoUrl(game.away)}" class="team-logo-lg" alt="${game.away}" loading="lazy">
      <span class="game-header-team">${TEAM_NAMES[game.away] || game.away}</span>
      <span class="at">@</span>
      <span class="game-header-team">${TEAM_NAMES[game.home] || game.home}</span>
      <img src="${teamLogoUrl(game.home)}" class="team-logo-lg" alt="${game.home}" loading="lazy">
    </div>
    <div class="game-header-meta">${dateLabel}${timeLabel ? " &middot; " + timeLabel : ""}</div>
  `;
}

// One combined box: team logos as row headers, Spread/Total/Moneyline as
// columns -- a single glance instead of three separate boxes.
function renderOddsBar(game) {
  const hasSpread = game.away_team_spread !== null && game.away_spread_odds !== null;
  const hasTotal = game.total_line !== null;
  const hasMl = game.away_moneyline !== null && game.home_moneyline !== null;

  if (!hasSpread && !hasTotal && !hasMl) {
    return `<p class="no-data-note">Odds not posted yet for this game.</p>`;
  }

  const spreadCell = (team, line, odds) => (hasSpread ? `${fmtSigned(line)} <span class="odds-price">(${fmtOdds(odds)})</span>` : "--");
  const totalCell = (label, odds) => (hasTotal ? `${label} ${fmt(game.total_line, 1)} <span class="odds-price">(${fmtOdds(odds)})</span>` : "--");
  const mlCell = (odds, prob) => (hasMl ? `${fmtOdds(odds)} <span class="odds-price">${fmtPct(prob)}</span>` : "--");

  return `<table class="data-table odds-table">
    <thead><tr><th></th><th>Spread</th><th>Total</th><th>Moneyline</th></tr></thead>
    <tbody>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.away)}" class="team-logo" alt="${game.away}" loading="lazy">${game.away}</td>
        <td class="num">${spreadCell(game.away, game.away_team_spread, game.away_spread_odds)}</td>
        <td class="num">${totalCell("O", game.over_odds)}</td>
        <td class="num">${mlCell(game.away_moneyline, game.away_ml_implied_prob)}</td>
      </tr>
      <tr>
        <td class="odds-team-cell"><img src="${teamLogoUrl(game.home)}" class="team-logo" alt="${game.home}" loading="lazy">${game.home}</td>
        <td class="num">${spreadCell(game.home, game.home_team_spread, game.home_spread_odds)}</td>
        <td class="num">${totalCell("U", game.under_odds)}</td>
        <td class="num">${mlCell(game.home_moneyline, game.home_ml_implied_prob)}</td>
      </tr>
    </tbody>
  </table>`;
}

// One number per side (not the Total/Per-Game pair headerRow() expects),
// so this gets its own compact header instead of reusing that function.
function pairedStatHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  return `<tr><th></th><th style="${offStyle}">${offTeam}<span class="col-sub">OFF</span></th><th style="${defStyle}">${defTeam}<span class="col-sub">DEF</span></th><th class="edge-hdr">Edge</th></tr>`;
}

// Each row pairs an offense stat with its defense mirror, framed as a
// matchup: offTeam's own number vs defTeam's own "allowed" number on the
// same stat -- e.g. "Sacks" shows offTeam's own sacks-allowed rate next to
// defTeam's own sacks-made rate. Call twice (away-vs-home, home-vs-away)
// for the two side-by-side tables.
function renderGeneralStatsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const format = (v, pct) => (v === null || v === undefined ? "--" : pct ? `${Math.round(v * 100)}%` : fmt(v, 1));
  const rows = GENERAL_STAT_ROWS.map((r) => {
    const offCls = tierFor(r.offKey, offTeam, r.offInvert);
    const defCls = tierFor(r.defKey, defTeam, r.defInvert);
    return `<tr><td>${r.label}</td><td class="num ${offCls}">${format(off[r.offKey], r.pct)}</td><td class="num ${defCls}">${format(def[r.defKey], r.pct)}</td>${edgeCell(offCls, defCls, offTeam, defTeam)}</tr>`;
  }).join("");

  return `<table class="data-table general-stat-table">
    <thead>${pairedStatHeader(offTeam, defTeam)}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRecentGamesPanel(team) {
  const games = (DATA.recent_games[team] || []).slice().reverse();
  if (games.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No games played yet this season.</p>`;
  }
  const rows = games
    .map((g) => {
      const oppLabel = g.home_away === "away" ? `@ ${g.opponent}` : g.opponent;
      const resultCls = g.result === "W" ? "tier-good" : g.result === "L" ? "tier-bad" : "tier-mid";
      const halfLabel = g.ht_for === null || g.ht_against === null ? "--" : `${g.ht_for}-${g.ht_against}`;
      return `<tr><td>${g.week}</td><td>${oppLabel}</td><td class="num">${halfLabel}</td><td class="num">${g.final_for}-${g.final_against}</td><td class="num ${resultCls}">${g.result}</td></tr>`;
    })
    .join("");
  return `<h3>${team}</h3>
    <details class="recent-games-dropdown">
      <summary>Recent Games (${games.length})</summary>
      <table class="data-table recent-games-table">
        <thead><tr><th>Wk</th><th>Opp</th><th>Half</th><th>Final</th><th>W/L</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function statusAbbr(status) {
  if (!status) return "?";
  const s = status.toLowerCase();
  if (s.includes("out")) return "Out";
  if (s.includes("doubtful")) return "Doubtful";
  if (s.includes("questionable")) return "Questionable";
  if (s.includes("did not participate")) return "DNP";
  if (s.includes("limited")) return "Limited";
  if (s.includes("full")) return "Full";
  return status;
}
function statusClass(status) {
  if (!status) return "tier-mid";
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("doubtful") || s.includes("did not participate")) return "tier-bad";
  if (s.includes("questionable") || s.includes("limited")) return "tier-mid";
  return "tier-good";
}

function renderInjuryPanel(team, week) {
  const list = (DATA.injuries[team] && DATA.injuries[team][String(week)]) || [];
  if (list.length === 0) {
    return `<h3>${team}</h3><p class="no-data-note">No one listed on the injury report.</p>`;
  }
  const groups = { OFF: [], DEF: [], ST: [] };
  list.forEach((p) => {
    (groups[p.position_group] || groups.ST).push(p);
  });
  const groupLabel = { OFF: "Offense", DEF: "Defense", ST: "Special Teams" };
  const sections = ["OFF", "DEF", "ST"]
    .filter((g) => groups[g].length > 0)
    .map((g) => {
      const badges = groups[g]
        .map((p) => `<span class="injury-badge ${statusClass(p.status)}">${p.full_name} (${p.position}) &mdash; ${statusAbbr(p.status)}</span>`)
        .join("");
      return `<div class="injury-group"><span class="injury-group-label">${groupLabel[g]}</span><div class="injury-badges">${badges}</div></div>`;
    })
    .join("");
  return `<h3>${team}</h3>${sections}`;
}

// ---- pick tracker ----
function marketSides(game, market) {
  if (market === "spread") {
    return [
      { side: "away", label: `${game.away} ${fmtSigned(game.away_team_spread)}`, line: game.away_team_spread, odds: game.away_spread_odds, available: game.away_team_spread !== null },
      { side: "home", label: `${game.home} ${fmtSigned(game.home_team_spread)}`, line: game.home_team_spread, odds: game.home_spread_odds, available: game.home_team_spread !== null },
    ];
  }
  if (market === "total") {
    return [
      { side: "over", label: `Over ${fmt(game.total_line, 1)}`, line: game.total_line, odds: game.over_odds, available: game.total_line !== null },
      { side: "under", label: `Under ${fmt(game.total_line, 1)}`, line: game.total_line, odds: game.under_odds, available: game.total_line !== null },
    ];
  }
  return [
    { side: "away", label: `${game.away} ${fmtOdds(game.away_moneyline)}`, line: null, odds: game.away_moneyline, available: game.away_moneyline !== null },
    { side: "home", label: `${game.home} ${fmtOdds(game.home_moneyline)}`, line: null, odds: game.home_moneyline, available: game.home_moneyline !== null },
  ];
}

function renderPickMarketRow(game, market) {
  const existing = getPick(game.game_id, market.key);
  const sides = marketSides(game, market.key);

  if (existing) {
    const sideInfo = sides.find((s) => s.side === existing.side);
    const colorInfo = COLORS.find((c) => c.key === existing.color);
    const resultTag = existing.graded
      ? `<span class="pick-result pick-result-${existing.graded}">${existing.graded.toUpperCase()}</span>`
      : `<span class="pick-result pick-result-pending">Pending</span>`;
    return `<div class="pick-market-row">
      <span class="pick-market-label">${market.label}</span>
      <span class="pick-badge pick-color-${existing.color}">${sideInfo ? sideInfo.label : existing.side} &middot; ${colorInfo ? colorInfo.label : existing.color}</span>
      ${resultTag}
      <button type="button" class="pick-edit-btn" data-market="${market.key}" data-action="edit">Edit</button>
      <button type="button" class="pick-edit-btn" data-market="${market.key}" data-action="delete">Delete</button>
    </div>`;
  }

  const allAvailable = sides.every((s) => s.available);
  if (!allAvailable) {
    return `<div class="pick-market-row"><span class="pick-market-label">${market.label}</span><span class="no-data-note">Odds not posted yet.</span></div>`;
  }
  const draft = draftPicks[market.key] || {};
  const sideBtns = sides
    .map((s) => `<button type="button" class="pick-side-btn${draft.side === s.side ? " selected" : ""}" data-market="${market.key}" data-action="side" data-side="${s.side}">${s.label}</button>`)
    .join("");
  const colorBtns = COLORS.map(
    (c) => `<button type="button" class="pick-color-btn pick-color-${c.key}${draft.color === c.key ? " selected" : ""}" data-market="${market.key}" data-action="color" data-color="${c.key}">${c.label}</button>`
  ).join("");
  const canSave = draft.side && draft.color;
  return `<div class="pick-market-row pick-market-form">
    <span class="pick-market-label">${market.label}</span>
    <div class="pick-side-group">${sideBtns}</div>
    <div class="pick-color-group">${colorBtns}</div>
    <button type="button" class="pick-save-btn" data-market="${market.key}" data-action="save"${canSave ? "" : " disabled"}>Save Pick</button>
  </div>`;
}

function renderPickSummary() {
  const picks = regradeAllPicks(DATA.schedule);
  const summary = pickSummary(picks);
  const row = (label, t) => `<div class="pick-summary-row"><span>${label}</span><span>${t.win}-${t.loss}-${t.push}${t.winPct !== null ? ` (${t.winPct}%)` : ""}</span></div>`;
  const recent = picks
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8)
    .map(
      (p) =>
        `<div class="pick-recent-row"><span class="pick-color-dot pick-color-${p.color}"></span><span>${p.away} @ ${p.home} &mdash; ${p.market} ${p.side}</span><span>${p.graded ? p.graded.toUpperCase() : "Pending"}</span></div>`
    )
    .join("");
  document.getElementById("picks-summary").innerHTML = `
    <h3>Your Record</h3>
    ${row("Overall", summary.overall)}
    ${row("Green", summary.green)}
    ${row("Yellow", summary.yellow)}
    ${row("Red", summary.red)}
    ${recent ? `<h3>Recent Picks</h3>${recent}` : ""}
  `;
}

function attachPickTrackerHandlers(game) {
  const wrap = document.getElementById("picks-content");
  wrap.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const market = btn.dataset.market;
      const action = btn.dataset.action;
      if (action === "side") {
        draftPicks[market] = { ...draftPicks[market], side: btn.dataset.side };
        renderPickTracker(game);
      } else if (action === "color") {
        draftPicks[market] = { ...draftPicks[market], color: btn.dataset.color };
        renderPickTracker(game);
      } else if (action === "save") {
        const draft = draftPicks[market] || {};
        if (!draft.side || !draft.color) return;
        const sideInfo = marketSides(game, market).find((s) => s.side === draft.side);
        upsertPick({
          game_id: game.game_id,
          season: DATA.requested_season,
          week: game.week,
          away: game.away,
          home: game.home,
          market,
          side: draft.side,
          line_at_pick: sideInfo.line,
          odds_at_pick: sideInfo.odds,
          color: draft.color,
          created_at: new Date().toISOString(),
        });
        draftPicks[market] = {};
        renderPickTracker(game);
      } else if (action === "edit") {
        const existing = getPick(game.game_id, market);
        draftPicks[market] = existing ? { side: existing.side, color: existing.color } : {};
        deletePick(game.game_id, market);
        renderPickTracker(game);
      } else if (action === "delete") {
        deletePick(game.game_id, market);
        renderPickTracker(game);
      }
    });
  });
}

function renderPickTracker(game) {
  regradeAllPicks(DATA.schedule);
  document.getElementById("picks-content").innerHTML = `<div class="pick-markets">${MARKETS.map((m) => renderPickMarketRow(game, m)).join("")}</div>`;
  attachPickTrackerHandlers(game);
  renderPickSummary();
}

// ---- flipper / render ----
function ensureCurrentGame() {
  const fresh = gamesForWeek(scheduleWeek);
  const sameWeek = weekGames.length && weekGames[0].week === scheduleWeek;
  weekGames = fresh;
  if (!sameWeek) currentGameIndex = 0;
  if (currentGameIndex >= weekGames.length) currentGameIndex = Math.max(0, weekGames.length - 1);
}

function render() {
  ensureCurrentGame();
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = SECTIONS.map((s) => document.getElementById(`section-${s}`));
  const flipperEl = document.getElementById("game-flipper");
  const headerEl = document.getElementById("game-header");

  const game = currentGame();
  if (!game) {
    sectionEls.forEach((el) => (el.hidden = true));
    flipperEl.hidden = true;
    headerEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.innerHTML = "<p>No games scheduled for this week.</p>";
    return;
  }

  renderGameHeader(game);
  flipperEl.hidden = false;
  document.getElementById("game-flipper-label").textContent = `Game ${currentGameIndex + 1} of ${weekGames.length}`;
  document.getElementById("game-prev").disabled = currentGameIndex <= 0;
  document.getElementById("game-next").disabled = currentGameIndex >= weekGames.length - 1;
  // Keep the scroller's card highlight in sync -- the flipper's own
  // prev/next buttons move currentGameIndex without going through the
  // scroller's click handler, so its "selected" card would otherwise go stale.
  renderMatchupRow(document.getElementById("matchup-row"), scheduleWeek, game.away, game.home);

  const { away, home } = game;
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

  document.getElementById("col-away-injuries").innerHTML = renderInjuryPanel(away, game.week);
  document.getElementById("col-home-injuries").innerHTML = renderInjuryPanel(home, game.week);
  document.getElementById("odds-content").innerHTML = renderOddsBar(game);
  document.getElementById("col-away-general").innerHTML = renderGeneralStatsTable(away, home);
  document.getElementById("col-home-general").innerHTML = renderGeneralStatsTable(home, away);
  document.getElementById("col-away-recent").innerHTML = renderRecentGamesPanel(away);
  document.getElementById("col-home-recent").innerHTML = renderRecentGamesPanel(home);

  renderPickTracker(game);
}

function handlePick() {
  resetDraftPicks();
  render();
}

function initFlipper() {
  initScheduleScroller(handlePick, {
    getSelected: () => {
      const g = currentGame();
      return g ? { away: g.away, home: g.home } : {};
    },
    onSelect: (away, home) => {
      const games = gamesForWeek(scheduleWeek);
      const idx = games.findIndex((g) => g.away === away && g.home === home);
      currentGameIndex = idx === -1 ? 0 : idx;
    },
    onWeekChange: handlePick,
  });

  document.getElementById("game-prev").addEventListener("click", () => {
    if (currentGameIndex > 0) {
      currentGameIndex--;
      resetDraftPicks();
      render();
    }
  });
  document.getElementById("game-next").addEventListener("click", () => {
    if (currentGameIndex < weekGames.length - 1) {
      currentGameIndex++;
      resetDraftPicks();
      render();
    }
  });
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
    resetDraftPicks();
    initFlipper();
    render();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
