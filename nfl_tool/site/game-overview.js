const EXPLOSIVE_ROWS = [
  { label: "Explosive Rush", totalOffKey: "explosive_rush", rateOffKey: "explosive_rush_per_g", totalDefKey: "explosive_rush_allowed", rateDefKey: "explosive_rush_allowed_per_g" },
  { label: "Explosive Pass", totalOffKey: "explosive_pass", rateOffKey: "explosive_pass_per_g", totalDefKey: "explosive_pass_allowed", rateDefKey: "explosive_pass_allowed_per_g" },
  { label: "Explosive Plays", totalOffKey: "explosive_plays", rateOffKey: "explosive_plays_per_g", totalDefKey: "explosive_plays_allowed", rateDefKey: "explosive_plays_allowed_per_g" },
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

const SECTIONS = ["odds", "angles", "firsttd", "redzone", "explosive", "injuries", "picks"];

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

// ---- explosive-play mismatch / red zone / first-TD "angles" ----
// Reuses checkOpportunity/renderMatchupSnapshot unchanged from common.js --
// this page is deliberately framed as general handicapping angles, never
// "TD"/"touchdown" wording, even though two of the three inputs are
// TD-derived stats shared with the TD Data page.
function overviewInsights(offTeam, defTeam) {
  const insights = [];

  const expl = checkOpportunity(
    offTeam,
    defTeam,
    (t) => DATA.team_stats[t].explosive_rate,
    (t) => DATA.team_stats[t].explosive_rate_allowed,
    false,
    true
  );
  if (expl) insights.push({ ...expl, category: "explosive", subject: null, team: offTeam, label: "explosive plays" });

  const rz = checkOpportunity(
    offTeam,
    defTeam,
    (t) => DATA.team_stats[t].rz_td_per_g,
    (t) => DATA.team_stats[t].rz_td_allowed_per_g,
    false,
    true
  );
  if (rz) insights.push({ ...rz, category: "redzone", subject: null, team: offTeam, label: "red zone touchdowns" });

  const first = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].first_td_rate, (t) => firstTdAllowedRate(t), false, true);
  if (first) insights.push({ ...first, category: "first_td", subject: null, team: offTeam, label: "getting on the board first" });

  return insights;
}

function renderGameHeader(game) {
  const headerEl = document.getElementById("game-header");
  headerEl.hidden = false;
  const dateLabel = game.date
    ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "";
  headerEl.innerHTML = `
    <img src="${teamLogoUrl(game.away)}" class="team-logo-lg" alt="${game.away}" loading="lazy">
    <span class="game-header-team">${TEAM_NAMES[game.away] || game.away}</span>
    <span class="at">@</span>
    <span class="game-header-team">${TEAM_NAMES[game.home] || game.home}</span>
    <img src="${teamLogoUrl(game.home)}" class="team-logo-lg" alt="${game.home}" loading="lazy">
    <span class="game-header-meta">${dateLabel}${game.time ? " &middot; " + game.time : ""}</span>
  `;
}

function renderOddsBar(game) {
  const hasSpread = game.away_team_spread !== null && game.away_spread_odds !== null;
  const hasTotal = game.total_line !== null;
  const hasMl = game.away_moneyline !== null && game.home_moneyline !== null;

  const spreadHtml = hasSpread
    ? `<div class="odds-line"><span class="odds-team">${game.away}</span><span class="odds-num">${fmtSigned(game.away_team_spread)}</span><span class="odds-price">(${fmtOdds(game.away_spread_odds)})</span></div>
       <div class="odds-line"><span class="odds-team">${game.home}</span><span class="odds-num">${fmtSigned(game.home_team_spread)}</span><span class="odds-price">(${fmtOdds(game.home_spread_odds)})</span></div>`
    : `<p class="no-data-note">Not posted yet.</p>`;

  const totalHtml = hasTotal
    ? `<div class="odds-line"><span class="odds-team">Over</span><span class="odds-num">${fmt(game.total_line, 1)}</span><span class="odds-price">(${fmtOdds(game.over_odds)})</span></div>
       <div class="odds-line"><span class="odds-team">Under</span><span class="odds-num">${fmt(game.total_line, 1)}</span><span class="odds-price">(${fmtOdds(game.under_odds)})</span></div>`
    : `<p class="no-data-note">Not posted yet.</p>`;

  const mlHtml = hasMl
    ? `<div class="odds-line"><span class="odds-team">${game.away}</span><span class="odds-num">${fmtOdds(game.away_moneyline)}</span><span class="odds-price">${fmtPct(game.away_ml_implied_prob)} no-vig</span></div>
       <div class="odds-line"><span class="odds-team">${game.home}</span><span class="odds-num">${fmtOdds(game.home_moneyline)}</span><span class="odds-price">${fmtPct(game.home_ml_implied_prob)} no-vig</span></div>`
    : `<p class="no-data-note">Not posted yet.</p>`;

  return `<div class="odds-bar">
    <div class="odds-box"><span class="odds-label">Spread</span>${spreadHtml}</div>
    <div class="odds-box"><span class="odds-label">Total</span>${totalHtml}</div>
    <div class="odds-box"><span class="odds-label">Moneyline</span>${mlHtml}</div>
  </div>`;
}

function renderFirstTdBox(team) {
  const s = DATA.team_stats[team];
  const scoredCls = tierFor("first_td_rate", team, false);
  const allowedCls = tierForFirstTdAllowed(team);
  return `<section class="mini-stat-box">
    <h3>${team}</h3>
    <div class="mini-stat-row"><span>Scores first</span><span class="num ${scoredCls}">${fmt(s.first_td_rate * 100, 0)}% <span class="muted">(${s.first_td_games}/${s.games_played})</span></span></div>
    <div class="mini-stat-row"><span>Allows first</span><span class="num ${allowedCls}">${fmt(firstTdAllowedRate(team) * 100, 0)}% <span class="muted">(${firstTdAllowedGames(team)}/${s.games_played})</span></span></div>
  </section>`;
}

function renderExplosiveTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = EXPLOSIVE_ROWS.map((r) => {
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

  document.getElementById("odds-content").innerHTML = renderOddsBar(game);
  document.getElementById("angles-content").innerHTML = renderMatchupSnapshot([...overviewInsights(away, home), ...overviewInsights(home, away)]);
  document.getElementById("firsttd-content").innerHTML = renderFirstTdBox(away) + renderFirstTdBox(home);
  document.getElementById("col-away-redzone").innerHTML = renderRedZoneTable(away, home);
  document.getElementById("col-home-redzone").innerHTML = renderRedZoneTable(home, away);
  document.getElementById("col-away-explosive").innerHTML = renderExplosiveTable(away, home);
  document.getElementById("col-home-explosive").innerHTML = renderExplosiveTable(home, away);
  document.getElementById("col-away-injuries").innerHTML = renderInjuryPanel(away, game.week);
  document.getElementById("col-home-injuries").innerHTML = renderInjuryPanel(home, game.week);

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
