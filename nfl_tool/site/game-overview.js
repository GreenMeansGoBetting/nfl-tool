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
  { label: "Explosive Plays", offKey: "explosive_rate", offInvert: false, defKey: "explosive_rate_allowed", defInvert: true, pct: true },
];

// Schematic tendency (how a defense lines up, from nflverse's free
// participation charting) paired with how the facing offense performs
// against that specific look. Grouped so the table reads as sections, not
// one long list. perfLabel is the caption shown above the performance
// column for that whole group (Yards/Carry for run splits, Success Rate
// for every pass-rush/coverage split -- see build_stats.py's
// compute_scheme_splits for exactly what "success" means).
// defTendKey/defSuccessKey pair with each row's tendency bar: not just how
// often the defense uses a look (frequency, no color judgment) but how well
// it actually works for them when they do (a real value judgment, tiered
// invert=true since it's stored as the OPPOSING offense's success/yards --
// lower is a better defensive result). Run Defense's def-side number is
// yards allowed (fmtYc), every other group's is a success rate (pct).
const SCHEME_GROUPS = [
  {
    label: "Run Defense",
    perfLabel: "Y/C",
    inlineUnit: "Y/C",
    rows: [
      { label: "Heavy Box (7+)", tendKey: "box_heavy_rate", perfKey: "ypc_vs_heavy_box", defSuccessKey: "def_ypc_allowed_heavy_box" },
      { label: "Light Box (≤6)", tendKey: "box_light_rate", perfKey: "ypc_vs_light_box", defSuccessKey: "def_ypc_allowed_light_box" },
    ],
  },
  {
    label: "Pass Rush",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Blitz (5+ rushers)", tendKey: "blitz_rate", perfKey: "success_vs_blitz", defSuccessKey: "def_success_allowed_blitz" },
      { label: "Standard Rush", tendKey: "standard_rush_rate", perfKey: "success_vs_standard_rush", defSuccessKey: "def_success_allowed_standard_rush" },
    ],
  },
  {
    label: "Coverage Style",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Zone", tendKey: "zone_rate", perfKey: "success_vs_zone", defSuccessKey: "def_success_allowed_zone" },
      { label: "Man", tendKey: "man_rate", perfKey: "success_vs_man", defSuccessKey: "def_success_allowed_man" },
    ],
  },
  {
    label: "Coverage Scheme",
    perfLabel: "Success %",
    pct: true,
    rows: [
      { label: "Cover 0", tendKey: "cover0_rate", perfKey: "success_vs_cover0", defSuccessKey: "def_success_allowed_cover0" },
      { label: "Cover 1", tendKey: "cover1_rate", perfKey: "success_vs_cover1", defSuccessKey: "def_success_allowed_cover1" },
      { label: "Cover 2", tendKey: "cover2_rate", perfKey: "success_vs_cover2", defSuccessKey: "def_success_allowed_cover2" },
      { label: "Cover 3", tendKey: "cover3_rate", perfKey: "success_vs_cover3", defSuccessKey: "def_success_allowed_cover3" },
      { label: "Cover 4", tendKey: "cover4_rate", perfKey: "success_vs_cover4", defSuccessKey: "def_success_allowed_cover4" },
      { label: "Cover 6", tendKey: "cover6_rate", perfKey: "success_vs_cover6", defSuccessKey: "def_success_allowed_cover6" },
      { label: "2-Man", tendKey: "twoman_rate", perfKey: "success_vs_twoman", defSuccessKey: "def_success_allowed_twoman" },
    ],
  },
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

const SECTIONS = ["injuries", "odds", "general", "scheme", "recent", "picks"];

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
  return `<tr><th class="per-game-hdr">PER GAME</th><th style="${offStyle}"><span class="pair-hdr">${offTeam}</span> <span class="pair-hdr-sub">- OFF</span></th><th style="${defStyle}"><span class="pair-hdr">${defTeam}</span> <span class="pair-hdr-sub">- DEF</span></th><th class="edge-hdr">ADV</th></tr>`;
}

// Each row pairs an offense stat with its defense mirror, framed as a
// matchup: offTeam's own number vs defTeam's own "allowed" number on the
// same stat -- e.g. "Sacks" shows offTeam's own sacks-allowed rate next to
// defTeam's own sacks-made rate. Call twice (away-vs-home, home-vs-away)
// for the two side-by-side tables.
function renderGeneralStatsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const format = (v, pct) => (v === null || v === undefined ? "--" : pct ? `${Math.round(v * 100)}%` : fmt(v, 2));
  const rows = GENERAL_STAT_ROWS.map((r) => {
    const offCls = tierFor(r.offKey, offTeam, r.offInvert);
    const defCls = tierFor(r.defKey, defTeam, r.defInvert);
    const labelHtml = r.note ? `${r.label}<br><span class="muted-label">${r.note}</span>` : r.label;
    return `<tr><td>${labelHtml}</td><td class="num ${offCls}">${format(off[r.offKey], r.pct)}</td><td class="num ${defCls}">${format(def[r.defKey], r.pct)}</td>${edgeCell(offCls, defCls, offTeam, defTeam)}</tr>`;
  }).join("");

  return `<table class="data-table general-stat-table">
    <thead>${pairedStatHeader(offTeam, defTeam)}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// One schedule-strength bullet per team (not per row -- every condition is
// just a slice of the same ~17-game schedule, so a per-row version came
// back saying almost the same thing on every line), surfaced once at the
// TOP of the section so it's read before the tables, not buried inside one
// of them. Silent when the schedule was genuinely average. schedule_quality
// is a computed AVERAGE across ~17 opponents, so it won't exactly match any
// single team's own value -- percentileTier()'s indexOf-based lookup would
// silently fail here, so this ranks by comparison instead.
function scheduleQualityText(team) {
  const q = DATA.team_stats[team].schedule_quality;
  if (q === null || q === undefined) return null;
  const pool = teamsWithGames()
    .map((t) => DATA.team_stats[t].points_against_per_g)
    .filter((v) => v !== null && v !== undefined);
  if (pool.length < 3) return null;
  const pct = pool.filter((v) => v < q).length / pool.length;
  if (pct < 0.333) return `${team} has faced a tougher-than-average slate of defenses this season -- these performance splits may understate them.`;
  if (pct >= 0.667) return `${team} has faced a weaker-than-average slate of defenses this season -- these performance splits may overstate them.`;
  return null;
}

function renderSchemeNotes(away, home) {
  return [away, home]
    .map(scheduleQualityText)
    .filter(Boolean)
    .map((t) => `<li>${t}</li>`)
    .join("");
}

function schemeTableHeader(offTeam, defTeam) {
  const offRgb = teamAccentRgb(offTeam);
  const defRgb = teamAccentRgb(defTeam);
  const defStyle = `background:rgba(${defRgb.join(",")},0.4); border-bottom:3px solid rgb(${defRgb.join(",")})`;
  const offStyle = `background:rgba(${offRgb.join(",")},0.4); border-bottom:3px solid rgb(${offRgb.join(",")})`;
  return `<tr><th></th><th style="${offStyle}"><span class="pair-hdr">${offTeam}</span> <span class="pair-hdr-sub">- OFF</span></th><th style="${defStyle}"><span class="pair-hdr">${defTeam}</span> <span class="pair-hdr-sub">- DEF</span></th><th style="${defStyle}" class="freq-hdr">FREQ</th><th class="edge-hdr">ADV</th></tr>`;
}

// Below this, a look doesn't come up often enough for an edge here to be
// worth flagging, no matter how it ranks against other equally-rare looks
// (a specialty package used on 7% of snaps can still z-score as "tier-good"
// relative to a league where everyone runs it under 5% -- that's true but
// meaningless for gameplanning, since it barely happens either way).
const SCHEME_ADV_MIN_TENDENCY = 0.2;

// Tendency is a frequency signal, not a value judgment (see SCHEME_GROUPS
// comment) -- so this can't reuse edgeCell's good/bad-tier logic straight
// across. An edge only gets flagged when the look is actually common
// (SCHEME_ADV_MIN_TENDENCY) AND the offense's performance tier AND the
// defense's tendency tier point the SAME direction: offense performs well
// against a look the defense uses often (real, likely-to-matter advantage)
// or performs poorly against a look the defense leans on heavily (real
// risk). A good performance number against a look the defense rarely shows
// (e.g. "HOU beats the blitz, but BUF barely blitzes") deliberately falls
// through to "--" -- it's true but unlikely to come up.
function schemeEdgeCell(perfCls, tendCls, tendVal, offTeam, defTeam) {
  if (tendVal === null || tendVal === undefined || tendVal < SCHEME_ADV_MIN_TENDENCY) {
    return `<td class="edge-cell">--</td>`;
  }
  if (perfCls === "tier-good" && tendCls === "tier-good") {
    const rgb = teamAccentRgb(offTeam);
    return `<td class="edge-cell edge-hit" style="color:rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.14)">${offTeam}</td>`;
  }
  if (perfCls === "tier-bad" && tendCls === "tier-good") {
    const rgb = teamAccentRgb(defTeam);
    return `<td class="edge-cell edge-hit" style="color:rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.14)">${defTeam}</td>`;
  }
  return `<td class="edge-cell">--</td>`;
}

// Frequency bar + % on its own now (defense success moved out into its own
// column, right beside offense performance, so the two directly-comparable
// numbers sit next to each other same as General Stats' OFF/DEF columns).
// % first, then the bar fills whatever width is left.
function tendencyCell(r, defTeam) {
  const tendVal = DATA.team_stats[defTeam][r.tendKey];
  if (tendVal === null || tendVal === undefined) return { html: `<span class="no-data-note">--</span>`, tendVal: null, tendCls: "" };
  const tendCls = tierFor(r.tendKey, defTeam, false);
  const html = `<div class="tend-row">
    <span class="tend-bar-num">${Math.round(tendVal * 100)}%</span>
    <span class="tend-bar-track"><span class="tend-bar-fill ${tendCls}" style="width:${Math.round(tendVal * 100)}%"></span></span>
  </div>`;
  return { html, tendVal, tendCls };
}

// Defense success is a real value judgment (unlike the tendency bar, a pure
// frequency signal) -- always stored as the OPPOSING offense's raw
// success/yards, so invert=true regardless of group, same "lower is better
// defense" convention as every other *_allowed stat.
function defSuccessCell(group, r, defTeam) {
  const succVal = DATA.team_stats[defTeam][r.defSuccessKey];
  if (succVal === null || succVal === undefined) return `<td class="num">--</td>`;
  const cls = tierFor(r.defSuccessKey, defTeam, true);
  const unit = group.inlineUnit ? ` ${group.inlineUnit}` : "";
  const display = group.pct ? `${Math.round(succVal * 100)}%` : `${fmt(succVal, 2)}${unit}`;
  return `<td class="num ${cls}">${display}</td>`;
}

function renderSchemeGroup(group, offTeam, defTeam) {
  const rows = group.rows
    .map((r) => {
      const perfVal = DATA.team_stats[offTeam][r.perfKey];
      const { html: tendHtml, tendVal, tendCls } = tendencyCell(r, defTeam);
      const perfCls = perfVal === null || perfVal === undefined ? "" : tierFor(r.perfKey, offTeam, false);
      const perfUnit = group.inlineUnit ? ` ${group.inlineUnit}` : "";
      const perfDisplay =
        perfVal === null || perfVal === undefined ? "--" : group.pct ? `${Math.round(perfVal * 100)}%` : `${fmt(perfVal, 2)}${perfUnit}`;
      return `<tr><td>${r.label}</td><td class="num ${perfCls}">${perfDisplay}</td>${defSuccessCell(group, r, defTeam)}<td>${tendHtml}</td>${schemeEdgeCell(perfCls, tendCls, tendVal, offTeam, defTeam)}</tr>`;
    })
    .join("");
  const perfCaption = group.inlineUnit ? "" : group.perfLabel;
  return `<tr class="group-row"><td>${group.label}</td><td class="metric-caption" colspan="2">${perfCaption}</td><td class="metric-caption"></td><td class="metric-caption"></td></tr>${rows}`;
}

function renderSchemeTable(offTeam, defTeam) {
  const groups = SCHEME_GROUPS.map((g) => renderSchemeGroup(g, offTeam, defTeam)).join("");
  return `<table class="data-table scheme-table">
    <thead>${schemeTableHeader(offTeam, defTeam)}</thead>
    <tbody>${groups}</tbody>
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
  return `<div class="pick-market-row pick-market-form">
    <span class="pick-market-label">${market.label}</span>
    <div class="pick-side-group">${sideBtns}</div>
    <div class="pick-color-group">${colorBtns}</div>
  </div>`;
}

// Every fully-picked (side + color) draft market saves in one click, instead
// of a separate Save per market -- draftPicks accumulates selections across
// all three markets as the user clicks side/color buttons, untouched until
// this fires.
function anyDraftReady(game) {
  return MARKETS.some((m) => {
    const draft = draftPicks[m.key];
    return draft && draft.side && draft.color && !getPick(game.game_id, m.key);
  });
}

const MARKET_LABELS = { spread: "Spread", total: "Total", moneyline: "Moneyline" };
const COLOR_LABELS = { green: "Good Play", yellow: "Lean", red: "No Confidence" };

function matrixCellText(t) {
  return `${t.win}-${t.loss}-${t.push}${t.winPct !== null ? ` (${t.winPct}%)` : ""}`;
}

function renderPickMatrix(picks) {
  const m = pickMatrix(picks);
  if (picks.length === 0) return "";
  const header = `<tr><th></th>${m.colors.map((c) => `<th>${COLOR_LABELS[c]}</th>`).join("")}<th>Total</th></tr>`;
  const rows = m.rows
    .map(
      (r) =>
        `<tr><td>${MARKET_LABELS[r.market]}</td>${r.cells.map((c) => `<td>${matrixCellText(c)}</td>`).join("")}<td class="matrix-total-col">${matrixCellText(r.total)}</td></tr>`
    )
    .join("");
  const totalRow = `<tr class="matrix-total-row"><td>Total</td>${m.colTotals.map((c) => `<td>${matrixCellText(c)}</td>`).join("")}<td class="matrix-total-col">${matrixCellText(m.grandTotal)}</td></tr>`;
  return `<table class="data-table pick-matrix-table">
    <thead>${header}</thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>`;
}

function renderPickSummary() {
  const picks = regradeAllPicks(DATA.schedule);
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
    ${renderPickMatrix(picks) || `<p class="no-data-note">No picks saved yet.</p>`}
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
      } else if (action === "save-all") {
        MARKETS.forEach((m) => {
          const draft = draftPicks[m.key];
          if (!draft || !draft.side || !draft.color || getPick(game.game_id, m.key)) return;
          const sideInfo = marketSides(game, m.key).find((s) => s.side === draft.side);
          upsertPick({
            game_id: game.game_id,
            season: DATA.requested_season,
            week: game.week,
            away: game.away,
            home: game.home,
            market: m.key,
            side: draft.side,
            line_at_pick: sideInfo.line,
            odds_at_pick: sideInfo.odds,
            color: draft.color,
            created_at: new Date().toISOString(),
          });
        });
        resetDraftPicks();
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
  const saveAllBtn = `<div class="pick-save-all-row"><button type="button" class="pick-save-all-btn" data-action="save-all"${anyDraftReady(game) ? "" : " disabled"}>Save Picks</button></div>`;
  document.getElementById("picks-content").innerHTML = `<div class="pick-markets">${MARKETS.map((m) => renderPickMarketRow(game, m)).join("")}${saveAllBtn}</div>`;
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
  document.getElementById("scheme-notes").innerHTML = renderSchemeNotes(away, home);
  document.getElementById("col-away-scheme").innerHTML = renderSchemeTable(away, home);
  document.getElementById("col-home-scheme").innerHTML = renderSchemeTable(home, away);
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

document.getElementById("scheme-info-btn").addEventListener("click", () => {
  const el = document.getElementById("scheme-info-text");
  el.hidden = !el.hidden;
});

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
