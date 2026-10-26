// GMG NBA Suite: Team Identity. How each team plays, from the engine
// (nfl_tool/nba/identity.py): pace, transition, shot diet, shot creation,
// turnovers, glass, the line, 4th-quarter blowouts and quarters. Every matchup
// row reads both sides (the offense's number next to what the other defense
// allows), like Game Previews. The page does no math beyond coloring.
// The owner, 2026-10-20: its own tab for now; it may merge with Game
// Previews later.

let DATA = null;
let ID = null;
let season = null;
let dayIndex = 0;
let gameId = null;
const ID_GAME_KEY = "nba-tool.id-game.v1";
const ID_SEASON_KEY = "nba-tool.id-season.v1";

const el = (id) => document.getElementById(id);
const team = (abbr) => (DATA && DATA.teams[abbr]) || { name: abbr, short: abbr, logo: "", color: "555555" };
const logo = (abbr, size = 18) => (abbr ? `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">` : "");
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr) {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span></div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

const block = () => ID.seasons[season];
const stats = (abbr) => block().teams[abbr] || null;

// ---- league comparison ----
// How far a team's number sits from the league average, in league spreads.
function z(abbr, key) {
  const s = stats(abbr);
  const lg = block().league[key];
  if (!s || !lg || s[key] === null || s[key] === undefined) return null;
  return (s[key] - lg.avg) / (lg.sd || 1);
}
function rank(abbr, key, highFirst) {
  const rows = Object.entries(block().teams).filter(([, s]) => s[key] !== null && s[key] !== undefined);
  rows.sort((a, b) => (highFirst ? b[1][key] - a[1][key] : a[1][key] - b[1][key]));
  const i = rows.findIndex(([t]) => t === abbr);
  return i === -1 ? null : i + 1;
}
const tierClass = (zv) => (zv === null ? "" : zv >= 0.5 ? "tier-good" : zv <= -0.5 ? "tier-bad" : "tier-mid");
function fmt(v, kind) {
  if (v === null || v === undefined) return "--";
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "secs") return `${v.toFixed(1)}s`;
  if (kind === "ppp") return v.toFixed(2);
  return v.toFixed(1);
}

// Two-sided tags. good / bad rows: the same rule as Game Previews (a full
// spread apart = Mismatch / Tough; both clearly good = Good vs Good). How-often
// rows (no good or bad): Fits = the offense does it a lot and this defense
// gives it up a lot; Takes away = the offense does it a lot and this defense
// rarely allows it.
const FREQ_GAP = 0.7;
function tag(offZ, defZ, often) {
  if (offZ === null || defZ === null) return "";
  if (often) {
    if (offZ >= FREQ_GAP && defZ >= FREQ_GAP) return `<span class="gs-tag gs-tag-mismatch">Fits</span>`;
    if (offZ >= FREQ_GAP && defZ <= -FREQ_GAP) return `<span class="gs-tag gs-tag-tough">Takes away</span>`;
    return "";
  }
  if (offZ >= 0.4 && defZ >= 0.4) return `<span class="gs-tag gs-tag-strong">Good vs Good</span>`;
  if (offZ - defZ >= 1) return `<span class="gs-tag gs-tag-mismatch">Mismatch</span>`;
  if (offZ - defZ <= -1) return `<span class="gs-tag gs-tag-tough">Tough</span>`;
  return `<span class="nba-notag">Even</span>`;
}

// key (identity.py, without off_ / def_), label, how it prints, way: +1 the
// offense wants it high, -1 low, 0 = how often (no good or bad).
const GROUPS = [
  ["Pace & Transition", [
    ["pace", "Possessions / 48", "num", 0],
    ["poss_secs", "Seconds / possession", "secs", 0],
    ["trans_freq", "Transition (shot in 8s)", "pct", 0],
    ["trans_ppp", "Pts / transition poss.", "ppp", 1],
    ["half_ppp", "Pts / half-court poss.", "ppp", 1],
  ]],
  ["Shot Creation", [
    ["three_rate", "Shots that are 3s", "pct", 0],
    ["assisted", "Makes assisted", "pct", 0],
    ["self_made", "Pull-up / step-back / fade", "pct", 0],
    ["catch", "Catch-and-shoot jumpers", "pct", 0],
  ]],
  ["Ball Security & Extras", [
    ["tov_rate", "Possessions ending in a TO", "pct", -1],
    ["steal_share", "TOs that are steals", "pct", -1],
    ["oreb_rate", "Offensive rebound %", "pct", 1],
    ["fta_rate", "Free throws / shot", "pct", 1],
  ]],
];
const ZONES = [["rim", "Rim (0-4 ft)"], ["short", "Paint (5-9 ft)"], ["mid", "Mid-range"], ["corner3", "Corner 3"], ["above3", "Above-break 3"]];

function matchupRow(off, de, key, label, kind, way) {
  const o = stats(off)[`off_${key}`];
  const d = stats(de)[`def_${key}`];
  const oz = z(off, `off_${key}`);
  const dz = z(de, `def_${key}`);
  if (way === 0) {
    const oTitle = `${ordinal(rank(off, `off_${key}`, true) || 0)} most in the league`;
    const dTitle = `${ordinal(rank(de, `def_${key}`, true) || 0)} most allowed`;
    return `<tr><td>${label}</td><td class="num id-plain" title="${oTitle}">${fmt(o, kind)}</td><td class="num id-plain" title="${dTitle}">${fmt(d, kind)}</td><td class="nba-tag-cell">${tag(oz, dz, true)}</td></tr>`;
  }
  // positive = good for the offense / bad for this defense
  const ozz = oz === null ? null : oz * way;
  const dzz = dz === null ? null : dz * way;
  const oTitle = `${ordinal(rank(off, `off_${key}`, way > 0) || 0)} in the league`;
  const dTitle = `${ordinal(rank(de, `def_${key}`, way < 0) || 0)} in the league`;
  return `<tr><td>${label}</td><td class="num ${tierClass(ozz)}" title="${oTitle}">${fmt(o, kind)}</td><td class="num ${tierClass(dzz === null ? null : -dzz)}" title="${dTitle}">${fmt(d, kind)}</td><td class="nba-tag-cell">${tag(ozz, dzz === null ? null : -dzz, false)}</td></tr>`;
}

function matchupBox(off, de) {
  if (!stats(off) || !stats(de)) return `<div class="nba-box"><div class="nba-box-title">${logo(off, 20)} ${off} offense <span class="at">vs</span> ${logo(de, 20)} ${de} defense</div><p class="no-data-note">No games on file.</p></div>`;
  const rows = [matchupRow(off, de, "ppp", "<b>Points / possession</b>", "ppp", 1)];
  for (const [title, items] of GROUPS) {
    rows.push(`<tr class="id-group"><td colspan="4">${title}</td></tr>`);
    for (const item of items) rows.push(matchupRow(off, de, ...item));
  }
  const bar = (v) => `<span class="id-bar"><i style="width:${Math.min((v || 0) / 0.45, 1) * 100}%"></i></span>`;
  const zoneRows = ZONES.map(([k, label]) => {
    const share = stats(off)[`off_${k}_share`];
    const allowed = stats(de)[`def_${k}_share`];
    const made = stats(off)[`off_${k}_pct`];
    const madeAllowed = stats(de)[`def_${k}_pct`];
    const sz = z(off, `off_${k}_share`);
    const az = z(de, `def_${k}_share`);
    const mz = z(off, `off_${k}_pct`);
    const maz = z(de, `def_${k}_pct`);
    // a volume tag (Fits / Takes away) when the offense lives there, else the make-rate matchup
    const t = tag(sz, az, true) || tag(mz, maz === null ? null : -maz, false);
    return `<tr><td>${label}</td><td class="num id-plain" title="${ordinal(rank(off, `off_${k}_share`, true) || 0)} most">${bar(share)}${fmt(share, "pct")}</td><td class="num id-plain" title="${ordinal(rank(de, `def_${k}_share`, true) || 0)} most allowed">${bar(allowed)}${fmt(allowed, "pct")}</td><td class="num ${tierClass(mz)}">${fmt(made, "pct")}</td><td class="num ${tierClass(maz === null ? null : -maz)}">${fmt(madeAllowed, "pct")}</td><td class="nba-tag-cell">${t}</td></tr>`;
  }).join("");
  return `<div class="nba-box">
      <div class="nba-box-title">${logo(off, 20)} ${off} offense <span class="at">vs</span> ${logo(de, 20)} ${de} defense</div>
      <div class="id-scroll"><table class="data-table nba-matchup-table id-table id-main"><thead><tr><th></th><th>${off} does</th><th>${de} allows</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
      <div class="id-sub">Where the shots come from</div>
      <div class="id-scroll"><table class="data-table nba-matchup-table id-table id-zones"><thead><tr><th></th><th>${off} shots</th><th>${de} allows</th><th>${off} FG%</th><th>${de} allows FG%</th><th></th></tr></thead><tbody>${zoneRows}</tbody></table></div>
    </div>`;
}

// Identity tags: [key, way, tag when far above the league, tag when far below].
// way -1 = the key is good when low, so "above" means far better.
const CHIPS = [
  ["off_pace", 1, "Fast pace", "Slow pace"], ["off_three_rate", 1, "3-point heavy", "Few 3s"],
  ["off_rim_share", 1, "Attacks the rim", "Avoids the rim"], ["off_mid_share", 1, "Mid-range team", null],
  ["off_self_made", 1, "Off the dribble", null], ["off_assisted", 1, "Ball movement", "Low assist rate"],
  ["off_trans_freq", 1, "Runs in transition", "Walks it up"], ["off_tov_rate", -1, "Protects the ball", "Turnover prone"],
  ["off_oreb_rate", 1, "Crashes the glass", "Gets back, no crash"], ["off_fta_rate", 1, "Lives at the line", null],
  ["def_tov_rate", 1, "Forces turnovers", null], ["def_rim_share", -1, "Walls off the rim", "Gives up the rim"],
  ["def_three_rate", -1, "Runs teams off the line", "Gives up 3s"], ["def_ppp", -1, "Elite defense", "Leaky defense"],
  ["def_oreb_rate", -1, "Ends possessions", "Gives up 2nd chances"],
];
const CHIP_AT = 1;
const CHIP_MAX = 4;
function chips(abbr, side) {
  const out = [];
  for (const [key, way, high, low] of CHIPS) {
    if (!key.startsWith(side)) continue;
    const zv = z(abbr, key);
    if (zv === null) continue;
    if (zv * way >= CHIP_AT && high) out.push([Math.abs(zv), high]);
    else if (zv * way <= -CHIP_AT && low) out.push([Math.abs(zv), low]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, CHIP_MAX).map(([, t]) => `<span class="id-chip">${t}</span>`).join("") || `<span class="id-none">Nothing far from average</span>`;
}

function teamBox(abbr) {
  const s = stats(abbr);
  if (!s) return `<div class="nba-box">${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
  const pct = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
  const of5 = (v) => (v === null || v === undefined ? "--" : `${v.toFixed(1)} of 5`);
  const quarters = [1, 2, 3, 4].map((q) => {
    const v = s[`q${q}_net`];
    return `<td class="num ${tierClass(z(abbr, `q${q}_net`))}">${v === null || v === undefined ? "--" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`}</td>`;
  }).join("");
  return `<div class="nba-box">${banner(abbr)}
      <div class="id-chips"><span class="id-chip-label">Offense</span>${chips(abbr, "off")}</div>
      <div class="id-chips"><span class="id-chip-label">Defense</span>${chips(abbr, "def")}</div>
      <table class="data-table id-table id-script"><thead><tr><th>4th quarter</th><th>Games</th><th>Starters on floor</th></tr></thead><tbody>
        <tr><td>Up 15+</td><td class="num">${pct(s.blowout_up_share)}</td><td class="num">${of5(s.blowout_up_starters)}</td></tr>
        <tr><td>Down 15+</td><td class="num">${pct(s.blowout_down_share)}</td><td class="num">${of5(s.blowout_down_starters)}</td></tr>
        <tr><td>Within 5</td><td class="num"></td><td class="num">${of5(s.close_starters)}</td></tr>
      </tbody></table>
      <table class="data-table id-table id-quarters"><thead><tr><th>By quarter</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead><tbody><tr><td>Net pts / 100</td>${quarters}</tr></tbody></table>
    </div>`;
}

// ---- Matchup Extremes (identity.py matchup_extremes, the owner 2026-10-26) ----
// Each number = the team's split against a type of opponent minus the
// league's split against that type. [key, label, a gap this big gets colored,
// +1 = more is good for the team's offense]
const EX_OUTCOMES = [["pts", "Pts", 6, 1], ["pace", "Pace", 3, 0], ["fg3m", "3PM", 3, 1], ["fta", "FTA", 6, 1], ["tov", "TOV", 3, -1]];
const EX_WORDS = { pts: "points", pace: "possessions a 48", fg3m: "3s made", fta: "free throws", tov: "turnovers" };
function extremesBox(abbr, opp) {
  const ex = block().extremes;
  const mine = ex && ex.teams[abbr];
  if (!mine) return `<div class="nba-box">${banner(abbr)}<p class="no-data-note">No games on file.</p></div>`;
  const row = (t) => {
    const c = mine[t.key] || { n: 0 };
    const tonight = t.teams.includes(opp);
    const cells = EX_OUTCOMES.map(([o, , at, way]) => {
      const v = c[o];
      const lg = ex.league[t.key] && ex.league[t.key][o];
      if (!c.n || !v || v[1] === null || lg === null || lg === undefined) return `<td class="num id-plain">--</td>`;
      const gap = v[1] - lg;
      // positive = good for this team: its offense up (def types), or its opponents down (off types)
      const good = way === 0 ? 0 : gap * way * (t.side === "def" ? 1 : -1);
      const cls = way === 0 || Math.abs(gap) < at ? "id-plain" : good > 0 ? "tier-good" : "tier-bad";
      const who = t.side === "off" ? `${t.label} had` : `${abbr} had`;
      const title = `${who} ${v[0]} ${EX_WORDS[o]}${o === "pace" ? "" : " a 100"} in ${c.n} game${c.n === 1 ? "" : "s"}: ${v[1] > 0 ? "+" : ""}${v[1]} vs ${abbr}'s usual. League: ${lg > 0 ? "+" : ""}${lg}.`;
      return `<td class="num ${cls}" title="${title}">${gap > 0 ? "+" : ""}${gap.toFixed(1)}</td>`;
    }).join("");
    return [tonight, `<tr${tonight ? ' class="ex-tonight"' : ""}><td class="ex-type" title="${t.teams.join(", ")}">${t.label}${tonight ? ' <span class="gs-tag gs-tag-strong">Tonight</span>' : ""}</td><td class="num id-plain">${c.n}</td>${cells}</tr>`];
  };
  const group = (side, title) => {
    const rows = ex.types.filter((t) => t.side === side).map(row);
    rows.sort((a, b) => b[0] - a[0]); // tonight's types first, the rest in their usual order
    return `<tr class="id-group"><td colspan="${EX_OUTCOMES.length + 2}">${title}</td></tr>${rows.map((r) => r[1]).join("")}`;
  };
  return `<div class="nba-box">${banner(abbr)}
      <div class="id-scroll"><table class="data-table id-table ex-table"><thead><tr><th>Facing</th><th>GP</th>${EX_OUTCOMES.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>${group("off", `Facing Offenses: ${abbr} Defense`)}${group("def", `Facing Defenses: ${abbr} Offense`)}</tbody></table></div>
    </div>`;
}

// ---- season buttons ----
function renderSeasons() {
  const thisSeason = String(DATA.season);
  el("id-seasons").innerHTML = Object.keys(ID.seasons)
    .sort()
    .map((s) => `<button type="button" class="view-toggle-btn${s === season ? " active" : ""}" data-season="${s}">${ID.seasons[s].label}</button>`)
    .join("") + (ID.seasons[thisSeason] ? "" : `<button type="button" class="view-toggle-btn" disabled title="After the first games">${DATA.season_label}</button>`);
  const b = block();
  const cur = ID.seasons[thisSeason];
  el("id-season-note").textContent = season === thisSeason
    ? `${b.label}: ${b.team_games} game${b.team_games === 1 ? "" : "s"} a team so far, so small samples swing.`
    : `${b.label} reference: rosters have changed since.${cur ? ` ${cur.label} has ${cur.team_games} game${cur.team_games === 1 ? "" : "s"} a team so far.` : ` ${DATA.season_label} numbers start after the first games.`}`;
}
function setSeason(s, remember) {
  if (!ID.seasons[s]) return;
  season = s;
  if (!remember) return;
  // Kept only while the build's default stays the same, so the page still
  // moves to this season on its own once it takes over.
  try {
    localStorage.setItem(ID_SEASON_KEY, JSON.stringify({ season: s, default: ID.default }));
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
}

// ---- schedule ----
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
const game = () => DATA.schedule.find((g) => g.game_id === gameId) || null;
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => `<button type="button" class="matchup-card${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${fmtTime(g.time).replace(" ET", "")}</span>
      </button>`)
    .join("");
}
function renderHeader(g) {
  const dateLabel = new Date(`${g.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  el("game-header").hidden = false;
  el("game-header").innerHTML = `<div class="game-header-teams">
      <img src="${team(g.away).logo}" class="team-logo-lg" alt="${g.away}"><span class="game-header-team">${team(g.away).name}</span>
      <span class="at">@</span>
      <span class="game-header-team">${team(g.home).name}</span><img src="${team(g.home).logo}" class="team-logo-lg" alt="${g.home}">
    </div>
    <div class="game-header-meta">${dateLabel} &middot; ${fmtTime(g.time)}${g.tv ? ` &middot; ${g.tv}` : ""}</div>`;
}

function render() {
  renderSchedule();
  renderSeasons();
  const g = game();
  el("empty-state").hidden = !!g;
  el("id-game").hidden = !g;
  if (!g) {
    el("game-header").hidden = true;
    el("empty-state").innerHTML = "<p>No upcoming games on file.</p>";
    return;
  }
  renderHeader(g);
  el("id-extremes").innerHTML = extremesBox(g.away, g.home) + extremesBox(g.home, g.away);
  el("id-teams").innerHTML = teamBox(g.away) + teamBox(g.home);
  el("id-matchups").innerHTML = matchupBox(g.away, g.home) + matchupBox(g.home, g.away);
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(ID_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}
function selectDay(i) {
  const all = days();
  if (i < 0 || i >= all.length) return;
  dayIndex = i;
  gameId = (gamesOn(all[i])[0] || {}).game_id || null;
  render();
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) return selectGame(card.dataset.game);
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const s = e.target.closest("#id-seasons [data-season]");
  if (s) {
    setSeason(s.dataset.season, true);
    return render();
  }
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
    ID = data.identity;
    if (!ID || !Object.keys(ID.seasons || {}).length) {
      el("empty-state").innerHTML = "<p>Team Identity data isn't available right now.</p>";
      return;
    }
    let pick = null;
    try {
      pick = JSON.parse(localStorage.getItem(ID_SEASON_KEY) || "null");
    } catch (e) {
      // localStorage unavailable or bad JSON.
    }
    setSeason(pick && pick.default === ID.default && ID.seasons[pick.season] ? pick.season : ID.default, false);
    if (!season) setSeason(Object.keys(ID.seasons)[0], false);
    let saved = null;
    try {
      saved = localStorage.getItem(ID_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    const all = days();
    const savedGame = DATA.schedule.find((g) => g.game_id === saved);
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame && savedGame.date >= today ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame && savedGame.date === day ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
