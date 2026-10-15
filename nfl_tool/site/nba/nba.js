// ---- GMG NBA Suite: Game Previews ----
// Stands on its own (no common.js -- that file is NFL through and through)
// but uses the same stylesheet, so it looks like the NFL pages: tiles, shaded
// boxes, team-color banners. Data comes from nba/data.json, built by
// nfl_tool/nba/build_nba.py.

let DATA = null;
let dayIndex = 0;
let gameId = null;
const NBA_GAME_KEY = "nba-tool.game.v1";

const el = (id) => document.getElementById(id);
const fmt = (n, digits = 1) => (n === null || n === undefined ? "--" : Number(n).toFixed(digits));
const pct = (n, digits = 1) => (n === null || n === undefined ? "--" : `${(n * 100).toFixed(digits)}%`);
const signed = (n) => (n === null || n === undefined ? "--" : n === 0 ? "PK" : `${n > 0 ? "+" : ""}${String(Number(n.toFixed(1))).replace(/\.0$/, "")}`);
const odds = (n) => (n === null || n === undefined ? "" : showOdds(n)); // the member's odds format (sync.js)
const team = (abbr) => DATA.teams[abbr] || { name: abbr, short: abbr, color: "555555", logo: "" };
const logo = (abbr, size = 18) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr, right = "") {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span>${right ? `<span class="nba-banner-right">${right}</span>` : ""}</div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}

// ---- league comparison ----
// z-score of one team's stat against all 30, flipped when lower is better,
// so positive always means "good for the unit this number belongs to".
function zScore(key, abbr, lowerIsBetter) {
  const values = Object.values(DATA.team_stats).map((s) => s[key]).filter((v) => v !== null && v !== undefined);
  const value = (DATA.team_stats[abbr] || {})[key];
  if (values.length < 3 || value === null || value === undefined) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (!sd) return 0;
  return ((value - mean) / sd) * (lowerIsBetter ? -1 : 1);
}
const tierClass = (z) => (z === null ? "" : z >= 0.5 ? "tier-good" : z <= -0.5 ? "tier-bad" : "tier-mid");
function leagueRank(key, abbr, lowerIsBetter) {
  const sorted = Object.entries(DATA.team_stats)
    .filter(([, s]) => s[key] !== null && s[key] !== undefined)
    .sort((a, b) => (lowerIsBetter ? a[1][key] - b[1][key] : b[1][key] - a[1][key]));
  const i = sorted.findIndex(([t]) => t === abbr);
  return i === -1 ? null : i + 1;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

// Offense vs defense rows. off / def = data keys; `low` = the OFFENSE wants
// this number low (turnovers). The defense always wants the opposite of the
// offense for the same stat. kind: how the value prints.
const MATCHUP_ROWS = [
  { label: "Rating (pts / 100 poss)", off: "off_rating", def: "def_rating", kind: "num" },
  { label: "Points / game", off: "off_ppg", def: "def_ppg", kind: "num" },
  { label: "Effective FG %", off: "off_efg", def: "def_efg", kind: "pct" },
  { label: "Turnover %", off: "off_tov_pct", def: "def_tov_pct", kind: "pct", low: true },
  { label: "Off. rebound %", off: "oreb_pct", def: "opp_oreb_pct", kind: "pct" },
  { label: "Free throw rate", off: "off_ft_rate", def: "def_ft_rate", kind: "pct" },
  { label: "3-point attempt rate", off: "off_three_rate", def: "def_three_rate", kind: "pct" },
  { label: "3-point %", off: "off_three_pct", def: "def_three_pct", kind: "pct" },
  { label: "3-pointers / game", off: "off_threes_pg", def: "def_threes_pg", kind: "num" },
  { label: "Paint points / game", off: "off_paint_pg", def: "def_paint_pg", kind: "num" },
  { label: "Fast break points / game", off: "off_fast_break_pg", def: "def_fast_break_pg", kind: "num" },
  { label: "Points off turnovers / game", off: "off_pts_off_tov_pg", def: "def_pts_off_tov_pg", kind: "num" },
  { label: "Assists / game", off: "off_ast_pg", def: "def_ast_pg", kind: "num" },
];
// Same two-sided rule as the NFL cards: a gap of a full standard deviation
// between the two units is an edge; both clearly good / bad is its own tag.
function matchupTag(offZ, defZ) {
  if (offZ === null || defZ === null) return "";
  if (offZ >= 0.4 && defZ >= 0.4) return `<span class="gs-tag gs-tag-strong">Good vs Good</span>`;
  if (offZ <= -0.4 && defZ <= -0.4) return `<span class="nba-notag">Bad vs Bad</span>`;
  if (offZ - defZ >= 1) return `<span class="gs-tag gs-tag-mismatch">Mismatch</span>`;
  if (offZ - defZ <= -1) return `<span class="gs-tag gs-tag-tough">Tough</span>`;
  return `<span class="nba-notag">Even</span>`;
}

// ---- schedule ----
function days() {
  return [...new Set(DATA.schedule.map((g) => g.date))].sort();
}
function gamesOn(date) {
  return DATA.schedule.filter((g) => g.date === date);
}
function currentGame() {
  return DATA.schedule.find((g) => g.game_id === gameId) || null;
}
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const side = (abbr, pts, opp) =>
        final
          ? `<span class="matchup-team-col">${logo(abbr, 28)}<span class="matchup-score${pts > opp ? " matchup-score-win" : " matchup-score-loss"}">${pts}</span></span>`
          : logo(abbr, 28);
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${side(g.away, g.away_score, g.home_score)}<span class="at">@</span>${side(g.home, g.home_score, g.away_score)}</span>
        ${final ? "" : `<span class="matchup-date">${fmtTime(g.time).replace(" ET", "")}</span>`}
      </button>`;
    })
    .join("");
}

// ---- sections ----
function renderHeader(g) {
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  el("game-header").hidden = false;
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${team(g.away).logo}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${team(g.home).logo}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g.time)}${g.tv ? ` &middot; ${g.tv}` : ""}</div>`;
  const note = el("fallback-note");
  note.hidden = !DATA.is_fallback_season;
  note.textContent = `Team and player numbers are from the ${DATA.stats_season_label} season until ${DATA.season_label} games are played. Players are shown on their current team.`;
}
function renderLines(g) {
  const hs = g.home_team_spread;
  const total = g.total_line;
  const has = hs !== null && hs !== undefined;
  const fav = has ? (hs <= 0 ? g.home : g.away) : null;
  const tile = (label, body, wide) => `<div class="g2-line-tile${wide ? " g2-line-wide" : ""}"><div class="gs-tile-label">${label}</div><div class="g2-line-big">${body}</div></div>`;
  const pair = (a, b) => `<span class="g2-line-side">${a}</span><span class="g2-line-side">${b}</span>`;
  const implied = has && total ? pair(`${logo(g.away, 20)} ${fmt((total + hs) / 2)}`, `${logo(g.home, 20)} ${fmt((total - hs) / 2)}`) : "--";
  const ml = (abbr, price, prob) => `${logo(abbr, 20)} ${odds(price) || "--"}${prob ? ` <small>${Math.round(prob * 100)}%</small>` : ""}`;
  el("lines-content").innerHTML = has || total
    ? `<div class="g2-line nba-line">
        ${tile("Spread", fav ? `${logo(fav, 22)} ${signed(fav === g.home ? hs : g.away_team_spread)}` : "--")}
        ${tile("Total", total ? fmt(total).replace(/\.0$/, "") : "--")}
        ${tile("Market score", implied, true)}
        ${tile("Win chance", pair(ml(g.away, g.away_moneyline, g.away_ml_implied_prob), ml(g.home, g.home_moneyline, g.home_ml_implied_prob)), true)}
      </div>${g.lines_locked ? `<p class="section-note">Locked at tip-off.</p>` : ""}`
    : `<p class="no-data-note">No line posted yet.</p>`;
}
function renderTeams(g) {
  const panel = (abbr) => {
    const s = DATA.team_stats[abbr];
    if (!s) return `<div>${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
    const tile = (label, value, key, low) => {
      const z = key ? zScore(key, abbr, low) : null;
      const rank = key ? leagueRank(key, abbr, low) : null;
      return `<div class="nba-tile ${tierClass(z)}"${rank ? ` title="${ordinal(rank)} of ${Object.keys(DATA.team_stats).length}"` : ""}><div class="gs-tile-label">${label}</div><b>${value}</b>${rank ? `<small>${ordinal(rank)}</small>` : ""}</div>`;
    };
    return `<div class="nba-team">
      ${banner(abbr, `${s.wins}-${s.losses}`)}
      <div class="nba-tiles">
        ${tile("Net rating", signed(s.net_rating), "net_rating")}
        ${tile("Offense", fmt(s.off_rating), "off_rating")}
        ${tile("Defense", fmt(s.def_rating), "def_rating", true)}
        ${tile("Pace", fmt(s.pace))}
        ${tile("Home", s.home_record)}
        ${tile("Away", s.away_record)}
        ${tile("Last 10", s.last10)}
      </div>
    </div>`;
  };
  el("teams-content").innerHTML = panel(g.away) + panel(g.home);
}
function renderMatchups(g) {
  const table = (offTeam, defTeam) => {
    const rows = MATCHUP_ROWS.map((r) => {
      const offZ = zScore(r.off, offTeam, !!r.low);
      const defZ = zScore(r.def, defTeam, !r.low);
      const show = (abbr, key) => {
        const v = (DATA.team_stats[abbr] || {})[key];
        return r.kind === "pct" ? pct(v) : fmt(v);
      };
      const cell = (abbr, key, z, low) => `<td class="num ${tierClass(z)}" title="${ordinal(leagueRank(key, abbr, low) || 0)} in the league">${show(abbr, key)}</td>`;
      return `<tr><td>${r.label}</td>${cell(offTeam, r.off, offZ, !!r.low)}${cell(defTeam, r.def, defZ, !r.low)}<td class="nba-tag-cell">${matchupTag(offZ, defZ)}</td></tr>`;
    }).join("");
    return `<div class="nba-box">
      <div class="nba-box-title">${logo(offTeam, 20)} ${offTeam} offense <span class="at">vs</span> ${logo(defTeam, 20)} ${defTeam} defense</div>
      <table class="data-table nba-matchup-table"><thead><tr><th></th><th>${offTeam} OFF</th><th>${defTeam} allows</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };
  el("matchups-content").innerHTML = table(g.away, g.home) + table(g.home, g.away);
}
function renderPlayers(g) {
  const out = (abbr) => new Set((DATA.injuries[abbr] || []).filter((p) => p.status === "Out").map((p) => p.id));
  const table = (abbr) => {
    const injured = out(abbr);
    const rows = (DATA.players[abbr] || [])
      .map((p) => {
        const trend = p.l5_pts !== null && p.pts !== null ? p.l5_pts - p.pts : 0;
        return `<tr${injured.has(p.id) ? ' class="nba-out-row"' : ""}>
          <td class="nba-player">${p.headshot ? `<img src="${p.headshot}" alt="" class="nba-headshot" loading="lazy">` : `<span class="nba-headshot"></span>`}<span>${p.name}</span><span class="muted-label">${p.position || ""}</span>${p.prev_team ? `<span class="nba-new" title="Numbers are from ${p.prev_team} last season">from ${p.prev_team}</span>` : ""}${injured.has(p.id) ? `<span class="gs-inj-status tier-bad">Out</span>` : ""}</td>
          <td class="num">${p.games}</td><td class="num">${fmt(p.min)}</td><td class="num"><b>${fmt(p.pts)}</b></td><td class="num">${fmt(p.reb)}</td><td class="num">${fmt(p.ast)}</td><td class="num">${fmt(p.threes)}</td>
          <td class="num ${trend >= 2 ? "tier-good" : trend <= -2 ? "tier-bad" : ""}">${fmt(p.l5_pts)}</td>
        </tr>`;
      })
      .join("");
    return `<div class="nba-box">${banner(abbr)}
      <table class="data-table nba-player-table"><thead><tr><th>Player</th><th>GP</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>3PM</th><th title="Points per game, last five games">L5 Pts</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="no-data-note">No players on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("players-content").innerHTML = table(g.away) + table(g.home);
}
function renderInjuries(g) {
  const list = (abbr) => {
    const rows = (DATA.injuries[abbr] || [])
      .map((p) => `<div class="nba-inj"${p.note ? ` title="${p.note.replace(/"/g, "&quot;")}"` : ""}><span class="gs-inj-status ${p.status === "Out" ? "tier-bad" : "tier-mid"}">${p.status === "Out" ? "Out" : "DTD"}</span><b>${p.name}</b><span class="muted-label">${p.position || ""}</span><span class="nba-inj-what">${p.injury || ""}</span></div>`)
      .join("");
    return `<div class="nba-box">${banner(abbr)}${rows || `<p class="no-data-note">Nobody listed.</p>`}</div>`;
  };
  el("injuries-content").innerHTML = list(g.away) + list(g.home);
}
function renderRecent(g) {
  const table = (abbr) => {
    const rows = (DATA.recent_games[abbr] || [])
      .slice()
      .reverse()
      .map((r) => `<tr><td>${new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td><td>${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}</td><td><span class="pick-result pick-result-${r.win ? "win" : "loss"}">${r.win ? "W" : "L"}</span></td><td class="num">${r.pf}-${r.pa}</td><td class="num">${r.pf + r.pa}</td><td class="num">${fmt(r.pace, 0)}</td></tr>`)
      .join("");
    return `<div class="nba-box">${banner(abbr)}
      <table class="data-table"><thead><tr><th>Date</th><th>Opp</th><th></th><th>Score</th><th>Total</th><th title="Possessions in the game">Pace</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="no-data-note">No games on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("recent-content").innerHTML = table(g.away) + table(g.home);
}

function render() {
  renderSchedule();
  const g = currentGame();
  const sections = ["lines", "teams", "matchups", "players", "injuries", "recent"];
  el("empty-state").hidden = !!g;
  sections.forEach((s) => (el(`section-${s}`).hidden = !g));
  if (!g) {
    el("game-header").hidden = true;
    el("empty-state").innerHTML = "<p>No games in the next two weeks.</p>";
    return;
  }
  renderHeader(g);
  renderLines(g);
  renderTeams(g);
  renderMatchups(g);
  renderPlayers(g);
  renderInjuries(g);
  renderRecent(g);
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(NBA_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  const first = gamesOn(all[dayIndex])[0];
  selectGame(first ? first.game_id : null);
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) return selectGame(card.dataset.game);
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const theme = e.target.closest("#theme-toggle");
  if (theme) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
  }
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const all = days();
    let saved = null;
    try {
      saved = localStorage.getItem(NBA_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    const savedGame = DATA.schedule.find((g) => g.game_id === saved);
    // Open on the saved game if it's still in the window, else today's
    // (or the next day's) first game.
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
