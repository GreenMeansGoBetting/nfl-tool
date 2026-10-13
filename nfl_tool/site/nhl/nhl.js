// ---- GMG NHL Suite: Game Previews ----
// The hockey twin of nba/nba.js. The data, helpers, rink drawing and the
// player card are in nhl-common.js (loaded first); this file is the page.

let dayIndex = 0;
let gameId = null;
const NHL_GAME_KEY = "nhl-tool.game.v1";

// Offense vs defense rows. off / def = data keys for the same thing: what
// the offense produces and what the other defense allows. In every row the
// offense wants the number high and the defense wants it low.
const MATCHUP_ROWS = [
  { label: "Goals / game", off: "off_gpg", def: "def_gpg", kind: "num2" },
  { label: "Shots on goal / game", off: "off_sog_pg", def: "def_sog_pg", kind: "num" },
  { label: "Shot attempts / game (5v5)", off: "off_att_pg", def: "def_att_pg", kind: "num" },
  { label: "Low-slot shots / game", off: "off_hd_pg", def: "def_hd_pg", kind: "num" },
  { label: "Shooting % (5v5)", off: "off_sh_pct", def: "def_sh_pct", kind: "pct" },
  { label: "Power play %", off: "off_pp_pct", def: "def_pp_pct", kind: "pct" },
  { label: "Power plays / game", off: "off_pp_opp_pg", def: "def_pp_opp_pg", kind: "num2" },
];
// Same two-sided rule as the NFL and NBA pages: a gap of a full standard
// deviation between the two units is an edge; both clearly good / bad is its own tag.
function matchupTag(offZ, defZ) {
  if (offZ === null || defZ === null) return "";
  if (offZ >= 0.4 && defZ >= 0.4) return `<span class="gs-tag gs-tag-strong">Good vs Good</span>`;
  if (offZ <= -0.4 && defZ <= -0.4) return `<span class="nba-notag">Bad vs Bad</span>`;
  if (offZ - defZ >= 1) return `<span class="gs-tag gs-tag-mismatch">Mismatch</span>`;
  if (offZ - defZ <= -1) return `<span class="gs-tag gs-tag-tough">Tough</span>`;
  return `<span class="nba-notag">Even</span>`;
}

// ---- the rink ----
// Where shots come from is about how MANY, not good or bad: a lot of point
// shots isn't a strength. So a zone is called from both sides the way the
// NFL site's matchupCall does it: "more" needs one side clearly above the
// league (the offense shoots from there a lot, or the defense allows a lot)
// and the other side not pointing the other way; "fewer" is the mirror.
const RINK_CALL_Z = 0.5;
const RINK_CONTRA_Z = 0.3;
function rinkCall(takesZ, allowsZ) {
  if (takesZ === null || allowsZ === null) return "";
  const hi = Math.max(takesZ, allowsZ);
  const lo = Math.min(takesZ, allowsZ);
  if (hi >= RINK_CALL_Z && lo > -RINK_CONTRA_Z) return "more";
  if (lo <= -RINK_CALL_Z && hi < RINK_CONTRA_Z) return "fewer";
  return "";
}
function rink(offTeam, defTeam, uid) {
  const off = stats()[offTeam] || {};
  const def = stats()[defTeam] || {};
  const svg = rinkSvg(uid, `${offTeam} shots by area against what ${defTeam} allows`, (z) => {
    const takes = off[`off_${z.key}_pg`];
    const allows = def[`def_${z.key}_pg`];
    // Shots from outside the zone are too rare to read anything into.
    const call = z.small ? "" : rinkCall(zScore(`off_${z.key}_pg`, offTeam, false), zScore(`def_${z.key}_pg`, defTeam, false));
    return {
      cls: call ? `nhl-zone-${call}` : "",
      big: fmt(takes),
      small: `allows ${fmt(allows)}`,
      tip: `${z.label}: ${offTeam} ${fmt(takes)} a game (${pct(off[`off_${z.key}_share`], 0)} of its shots, ${off[`off_${z.key}_g`] ?? 0} goals). ${defTeam} allows ${fmt(allows)} (${pct(def[`def_${z.key}_share`], 0)} of what it gives up, ${def[`def_${z.key}_g`] ?? 0} goals).`,
    };
  });
  return `<div class="nba-box nhl-rink-box">
    <div class="nba-box-title">${logo(offTeam, 20)} ${offTeam} shots <span class="at">vs</span> ${logo(defTeam, 20)} ${defTeam} defense</div>
    ${svg}
  </div>`;
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
      const side = (abbr, goals, opp) =>
        final
          ? `<span class="matchup-team-col">${logo(abbr, 28)}<span class="matchup-score${goals > opp ? " matchup-score-win" : " matchup-score-loss"}">${goals}</span></span>`
          : logo(abbr, 28);
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}" data-away="${g.away}" data-home="${g.home}">
        <span class="matchup-teams-row">${side(g.away, g.away_score, g.home_score)}<span class="at">@</span>${side(g.home, g.home_score, g.away_score)}</span>
        ${final ? "" : `<span class="matchup-date">${fmtTime(g.time).replace(" ET", "")}</span>`}
      </button>`;
    })
    .join("");
}

// ---- sections ----
function renderHeader(g) {
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const finalNote = g.status === "final" ? ` &middot; Final${g.ended && g.ended !== "REG" ? ` (${g.ended})` : ""}: ${g.away} ${g.away_score}, ${g.home} ${g.home_score}` : "";
  // Second night of a back-to-back: a plain schedule fact that matters for who is in net.
  const tired = ["away", "home"].filter((side) => g[`${side}_rest`] === 1).map((side) => `<span class="nba-new">${g[side]} played yesterday</span>`).join(" ");
  el("game-header").hidden = false;
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${logoUrl(g.away)}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${logoUrl(g.home)}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g.time)}${g.tv ? ` &middot; ${g.tv}` : ""}${finalNote}${tired ? ` &nbsp;${tired}` : ""}</div>`;
}
function renderViewToggle() {
  const both = hasBothSeasons();
  const games = Math.round(DATA.middle_games_played || 0);
  el("view-toggle").hidden = !both;
  el("view-toggle").innerHTML = both
    ? [["season", `${DATA.season_label} <small>${games} games in</small>`], ["prev", `${DATA.prev_season_label} <small>full season</small>`]]
        .map(([key, label]) => `<button type="button" class="view-toggle-btn nhl-view-btn${view === key ? " active" : ""}" data-view="${key}">${label}</button>`)
        .join("")
    : "";
  const note = el("fallback-note");
  const early = DATA.default_view === "prev";
  note.hidden = !(both && early);
  note.textContent =
    view === "prev"
      ? `Team and player numbers below are from ${DATA.prev_season_label}, with players on their current team. Teams are about ${games} games into ${DATA.season_label}; this page opens on ${DATA.season_label} once that reaches 10.`
      : `Small sample: teams are only about ${games} games into ${DATA.season_label}.`;
}
function renderLines(g) {
  const total = g.total_line;
  const any = has(g.home_moneyline) || has(g.away_moneyline) || has(total) || has(g.home_team_spread);
  const tile = (label, body, wide) => `<div class="g2-line-tile${wide ? " g2-line-wide" : ""}"><div class="gs-tile-label">${label}</div><div class="g2-line-big">${body}</div></div>`;
  const pair = (a, b) => `<span class="g2-line-side">${a}</span><span class="g2-line-side">${b}</span>`;
  const ml = (abbr, price, prob) => `${logo(abbr, 20)} ${odds(price) || "--"}${prob ? ` <small>${Math.round(prob * 100)}%</small>` : ""}`;
  const puck = (abbr, spread, price) => `${logo(abbr, 20)} ${has(spread) ? signed(spread) : "--"}${has(price) ? ` <small>${odds(price)}</small>` : ""}`;
  const totalBody = has(total) ? `${fmt(total).replace(/\.0$/, "")}${has(g.over_odds) || has(g.under_odds) ? ` <small>O ${odds(g.over_odds) || "--"} &middot; U ${odds(g.under_odds) || "--"}</small>` : ""}` : "--";
  el("lines-content").innerHTML = any
    ? `<div class="g2-line nhl-line">
        ${tile("Moneyline &middot; win chance", pair(ml(g.away, g.away_moneyline, g.away_ml_implied_prob), ml(g.home, g.home_moneyline, g.home_ml_implied_prob)), true)}
        ${tile("Puck line", pair(puck(g.away, g.away_team_spread, g.away_spread_odds), puck(g.home, g.home_team_spread, g.home_spread_odds)), true)}
        ${tile("Total goals", totalBody)}
      </div>${g.lines_locked ? `<p class="section-note">Locked at puck drop.</p>` : ""}`
    : `<p class="no-data-note">No line posted yet.</p>`;
}
function renderTeams(g) {
  const count = Object.keys(stats()).length;
  const panel = (abbr) => {
    const s = stats()[abbr];
    if (!s) return `<div class="nba-team">${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
    const tile = (label, value, key, low) => {
      const z = key ? zScore(key, abbr, low) : null;
      const rank = key ? leagueRank(key, abbr, low) : null;
      return `<div class="nba-tile ${tierClass(z)}"${rank ? ` title="${ordinal(rank)} of ${count}"` : ""}><div class="gs-tile-label">${label}</div><b>${value}</b>${rank ? `<small>${ordinal(rank)}</small>` : ""}</div>`;
    };
    const record = has(s.wins) ? `${s.wins}-${s.losses}-${s.ot_losses}` : "";
    return `<div class="nba-team">
      ${banner(abbr, record ? `${record} <small class="nhl-pts">${s.points} pts</small>` : "")}
      <div class="nba-tiles nhl-tiles">
        ${tile("Goal diff / game", signed(s.goal_diff_pg, 2), "goal_diff_pg")}
        ${tile("Goals / game", fmt(s.off_gpg, 2), "off_gpg")}
        ${tile("Allowed / game", fmt(s.def_gpg, 2), "def_gpg", true)}
        ${tile("Shot share 5v5", pct(s.att_share), "att_share")}
        ${tile("Low-slot share", pct(s.hd_share), "hd_share")}
        ${tile("Power play", pct(s.off_pp_pct), "off_pp_pct")}
        ${tile("Penalty kill", pct(s.pk_pct), "pk_pct")}
        ${tile("Home", s.home_record || "--")}
        ${tile("Away", s.away_record || "--")}
        ${tile("Last 10", s.last10 || "--")}
      </div>
    </div>`;
  };
  el("teams-content").innerHTML = panel(g.away) + panel(g.home);
}
function renderMatchups(g) {
  const table = (offTeam, defTeam) => {
    const rows = MATCHUP_ROWS.map((r) => {
      const offZ = zScore(r.off, offTeam, false);
      const defZ = zScore(r.def, defTeam, true);
      const show = (abbr, key) => {
        const v = (stats()[abbr] || {})[key];
        return r.kind === "pct" ? pct(v) : fmt(v, r.kind === "num2" ? 2 : 1);
      };
      const cell = (abbr, key, z, low) => `<td class="num ${tierClass(z)}" title="${ordinal(leagueRank(key, abbr, low) || 0)} in the league">${show(abbr, key)}</td>`;
      return `<tr><td>${r.label}</td>${cell(offTeam, r.off, offZ, false)}${cell(defTeam, r.def, defZ, true)}<td class="nba-tag-cell">${matchupTag(offZ, defZ)}</td></tr>`;
    }).join("");
    return `<div class="nba-box">
      <div class="nba-box-title">${logo(offTeam, 20)} ${offTeam} offense <span class="at">vs</span> ${logo(defTeam, 20)} ${defTeam} defense</div>
      <table class="data-table nba-matchup-table"><thead><tr><th></th><th>${offTeam} OFF</th><th>${defTeam} allows</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };
  el("matchups-content").innerHTML = table(g.away, g.home) + table(g.home, g.away);
}
function renderRink(g) {
  el("rink-content").innerHTML = rink(g.away, g.home, "nhl-rink-away") + rink(g.home, g.away, "nhl-rink-home");
}
const outIds = (abbr) => new Set((DATA.injuries[abbr] || []).filter((p) => p.id && p.status !== "Day-To-Day").map((p) => p.id));
// Every player name and photo on the page opens the player card.
const nameCell = (p, extra = "") => playerClick(p.id, `${headshot(p)}<span>${p.name}</span>`) + extra;
function renderGoalies(g) {
  const table = (abbr) => {
    const injured = outIds(abbr);
    const rows = (DATA.goalies[abbr] || [])
      .map((p) => {
        const s = line(p);
        const name = `<td class="nba-player">${nameCell(p, injured.has(p.id) ? `<span class="gs-inj-status tier-bad">Out</span>` : "")}</td>`;
        if (!s) return `<tr>${name}<td class="num muted-label" colspan="7">No ${viewLabel()} games</td></tr>`;
        return `<tr${injured.has(p.id) ? ' class="nba-out-row"' : ""}>${name}
          <td class="num">${s.games}</td><td class="num">${s.starts}</td><td class="num">${s.record}</td>
          <td class="num"><b>${svPct(s.sv_pct)}</b></td><td class="num">${fmt(s.gaa, 2)}</td>
          <td class="num" title="${s.hd_sa} low-slot shots faced">${svPct(s.hd_sv_pct)}</td>
          <td class="num">${view === "prev" ? "--" : svPct(s.l5_sv_pct)}</td>
        </tr>`;
      })
      .join("");
    return `<div class="nba-box">${banner(abbr)}
      <table class="data-table nba-player-table"><thead><tr><th>Goalie</th><th>GP</th><th title="Games started">GS</th><th title="Wins, losses, overtime losses">Record</th><th title="Save percentage">SV%</th><th title="Goals against per 60 minutes">GAA</th><th title="Save percentage on shots from the low slot, right in front of the net">Low slot SV%</th><th title="Save percentage over the last five starts">L5 SV%</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="no-data-note">No goalies on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("goalies-content").innerHTML = table(g.away) + table(g.home);
}
function renderPlayers(g) {
  const table = (abbr) => {
    const injured = outIds(abbr);
    const row = (p) => {
      const s = line(p);
      const name = `<td class="nba-player">${nameCell(p, `<span class="muted-label">${p.pos || ""}</span>${injured.has(p.id) ? `<span class="gs-inj-status tier-bad">Out</span>` : ""}`)}</td>`;
      if (!s) return `<tr>${name}<td class="num muted-label" colspan="9">No ${viewLabel()} games</td></tr>`;
      const trend = view === "season" && has(s.l5_sog_pg) && has(s.sog_pg) ? s.l5_sog_pg - s.sog_pg : 0;
      return `<tr${injured.has(p.id) ? ' class="nba-out-row"' : ""}>${name}
        <td class="num">${s.games}</td><td class="num">${fmt(s.toi)}</td><td class="num">${s.g}</td><td class="num">${s.a}</td><td class="num"><b>${s.p}</b></td>
        <td class="num"><b>${fmt(s.sog_pg)}</b></td>
        <td class="num ${trend >= 0.75 ? "tier-good" : trend <= -0.75 ? "tier-bad" : ""}">${view === "prev" ? "--" : fmt(s.l5_sog_pg)}</td>
        <td class="num">${fmt(s.pp_toi)}</td><td class="num">${fmt(s.games ? s.hd / s.games : null)}</td>
      </tr>`;
    };
    const group = (label, players) => (players.length ? `<tr class="group-gap"><td colspan="10"></td></tr><tr class="group-row"><td colspan="10">${label}</td></tr>${players.map(row).join("")}` : "");
    const all = DATA.skaters[abbr] || [];
    const rows = group("Forwards", all.filter((p) => p.pos !== "D")) + group("Defense", all.filter((p) => p.pos === "D"));
    return `<div class="nba-box">${banner(abbr)}
      <table class="data-table nba-player-table"><thead><tr><th>Player</th><th>GP</th><th title="Ice time per game, minutes">TOI</th><th>G</th><th>A</th><th>Pts</th><th title="Shots on goal per game">SOG</th><th title="Shots on goal per game, last five games">L5 SOG</th><th title="Power play ice time per game, minutes">PP TOI</th><th title="Shots per game from the low slot, right in front of the net">Low slot</th></tr></thead><tbody>${rows || `<tr><td colspan="10" class="no-data-note">No players on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("players-content").innerHTML = table(g.away) + table(g.home);
}
const INJURY_CHIP = { Out: ["Out", "tier-bad"], "Injured Reserve": ["IR", "tier-bad"], Suspension: ["Susp", "tier-bad"], "Day-To-Day": ["DTD", "tier-mid"] };
function renderInjuries(g) {
  const list = (abbr) => {
    const rows = (DATA.injuries[abbr] || [])
      .map((p) => {
        const [chip, tier] = INJURY_CHIP[p.status] || [p.status || "?", "tier-mid"];
        return `<div class="nba-inj"${p.note ? ` title="${p.note.replace(/"/g, "&quot;")}"` : ""}><span class="gs-inj-status ${tier}">${chip}</span>${playerClick(p.id, `<b>${p.name}</b>`)}<span class="muted-label">${p.position || ""}</span><span class="nba-inj-what">${p.injury || ""}</span></div>`;
      })
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
      .map((r) => {
        const kind = r.result === "W" ? "win" : r.result === "L" ? "loss" : "push";
        const extra = r.ended && r.ended !== "REG" ? ` <span class="muted-label">${r.ended}</span>` : "";
        return `<tr><td>${shortDate(r.date)}</td><td>${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}</td><td><span class="pick-result pick-result-${kind}">${r.result}</span></td><td class="num">${r.gf}-${r.ga}${extra}</td><td class="num">${r.sog}-${r.sog_against}</td><td>${r.goalie || "--"}</td></tr>`;
      })
      .join("");
    return `<div class="nba-box">${banner(abbr)}
      <table class="data-table"><thead><tr><th>Date</th><th>Opp</th><th></th><th>Score</th><th title="Shots on goal, for and against">Shots</th><th title="The goalie who started">In net</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="no-data-note">No games on file.</td></tr>`}</tbody></table>
    </div>`;
  };
  el("recent-content").innerHTML = table(g.away) + table(g.home);
}

function render() {
  renderSchedule();
  const g = currentGame();
  const sections = ["lines", "teams", "matchups", "rink", "goalies", "players", "injuries", "recent"];
  el("empty-state").hidden = !!g;
  sections.forEach((s) => (el(`section-${s}`).hidden = !g));
  if (!g) {
    el("game-header").hidden = true;
    el("view-toggle").hidden = true;
    el("fallback-note").hidden = true;
    el("empty-state").innerHTML = "<p>No games in the next two weeks.</p>";
    return;
  }
  renderHeader(g);
  renderViewToggle();
  renderLines(g);
  renderTeams(g);
  renderMatchups(g);
  renderRink(g);
  renderGoalies(g);
  renderPlayers(g);
  renderInjuries(g);
  renderRecent(g);
  // Have both teams' player files on hand before a name is clicked.
  [g.away, g.home].forEach(loadTeamPlayers);
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(NHL_GAME_KEY, id);
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
});

loadNhlData()
  .then(() => {
    const all = days();
    let saved = null;
    try {
      saved = localStorage.getItem(NHL_GAME_KEY);
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
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
