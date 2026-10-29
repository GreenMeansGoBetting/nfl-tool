// ---- Opening Drive Tool ----
// The owner, 2026-10-29: the Discord plays a "First Drive - Punt" parlay on
// primetime games (both teams punt on their first drive). The book grades a
// first drive four ways -- Off TD, FG Att, Punt, Any Other -- and this page
// shows how often each has happened for every team's offense and against
// every defense (DATA.opening_drives, compute_opening_drives in the build).
// Raw season numbers, no pull toward league average (the owner: "teams have
// identities"); First Half / Full Game swap in every drive of that span for
// a bigger sample of the same outcomes. Fair = the offense and the other
// team's defense averaged, as an American price (these aren't on exchanges).

const OD_OUTCOMES = [
  ["td", "Off TD", "TD"],
  ["fg", "FG Att", "FG"],
  ["punt", "Punt", "P"],
  ["other", "Any Other", "O"],
];
const OD_SAMPLES = { open: "Opening Drive", half: "First Half", game: "Full Game" };
const OD_VIEW_KEY = "nfl-tool.opening-drives-view.v1";
const odView = loadOdView();

function loadOdView() {
  const base = { sample: "open", last: 0, sort: "o_punt", dir: -1 };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(OD_VIEW_KEY)) || {}) };
  } catch (e) {
    return base;
  }
}
function saveOdView() {
  try {
    localStorage.setItem(OD_VIEW_KEY, JSON.stringify(odView));
  } catch (e) {
    // localStorage unavailable -- the view just won't stick.
  }
}

const odTeamGames = (team) => {
  const games = (DATA.opening_drives?.teams || {})[team] || [];
  return odView.last > 0 ? games.slice(-odView.last) : games;
};
// The opponent's own row for the same game: a defense is read from the
// drives its opponents had against it.
function odOpponentRow(game) {
  return ((DATA.opening_drives?.teams || {})[game.opp] || []).find((g) => g.game_id === game.game_id) || null;
}

// Counts of each outcome (in the chosen sample), plus the opening drive's
// own detail: 3 & outs, plays, yards and the received / kicked split.
function odTally(rows) {
  const counts = { td: 0, fg: 0, punt: 0, other: 0 };
  const split = { received: { n: 0, td: 0, fg: 0, punt: 0, other: 0 }, kicked: { n: 0, td: 0, fg: 0, punt: 0, other: 0 } };
  let n = 0, threeOut = 0, plays = 0, yards = 0;
  for (const g of rows) {
    if (odView.sample === "open") {
      counts[g.out] += 1;
      n += 1;
    } else {
      const list = odView.sample === "half" ? g.half : g.game;
      OD_OUTCOMES.forEach(([k], i) => { counts[k] += list[i]; n += list[i]; });
    }
    if (g.three_out) threeOut += 1;
    plays += g.plays;
    yards += g.yards;
    const s = split[g.received ? "received" : "kicked"];
    s.n += 1;
    s[g.out] += 1;
  }
  const games = rows.length;
  const rate = (k) => (n ? counts[k] / n : null);
  return { games, n, counts, rate, split, threeOut, threeOutRate: games ? threeOut / games : null, plays: games ? plays / games : null, yards: games ? yards / games : null, log: rows };
}
function odOffense(team) {
  return odTally(odTeamGames(team));
}
function odDefense(team) {
  return odTally(odTeamGames(team).map(odOpponentRow).filter(Boolean));
}

function odAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
}
const odPrice = (p) => {
  const v = odAmerican(p);
  return v === null ? "—" : showOdds(Math.round(v));
};
const odPct = (r) => (r === null ? "—" : `${Math.round(r * 100)}%`);

// League pools for the tier shading, one per outcome and side.
function odPools(teams) {
  const pools = {};
  const all = teams.map((t) => ({ off: odOffense(t), def: odDefense(t) }));
  for (const [k] of OD_OUTCOMES) {
    pools[`off_${k}`] = all.map((x) => x.off.rate(k));
    pools[`def_${k}`] = all.map((x) => x.def.rate(k));
  }
  pools.off_3o = all.map((x) => x.off.threeOutRate);
  pools.def_3o = all.map((x) => x.def.threeOutRate);
  return pools;
}
function odRateCell(tally, k, pool, extra = "") {
  const r = tally.rate(k);
  if (r === null) return `<td class="num od-rate${extra}">—</td>`;
  return `<td class="num od-rate ${percentileTier(r, pool, false)}${extra}"${tierAlphaAttr(r, pool, false)}><b>${odPct(r)}</b><small>${tally.counts[k]}/${tally.n}</small></td>`;
}
function odLog(rows, defense) {
  if (!rows.length) return `<span class="od-none">No games</span>`;
  return `<span class="od-log">${rows.map((g) => {
    const [, name, short] = OD_OUTCOMES.find(([k]) => k === g.out);
    const who = defense ? `${g.opp_of} vs them` : `vs ${g.opp}`;
    const tip = `Week ${g.week} ${who}: ${name}${g.three_out ? " (3 & Out)" : ""}, ${g.plays} plays, ${g.yards} yds, ${g.received ? "had the ball first" : "kicked off first"}`;
    return `<span class="od-chip od-c-${g.out}" title="${tip}">${short}</span>`;
  }).join("")}</span>`;
}
// A defense's log: its opponents' opening drives, named by who had the ball.
const odDefLog = (team) => odTeamGames(team).map((g) => {
  const row = odOpponentRow(g);
  return row ? { ...row, opp_of: g.opp } : null;
}).filter(Boolean);

function odTeamLabel(team) {
  return `<span class="od-team">${teamLogoMini(team, 20)}<b>${team}</b></span>`;
}

function renderOdMatchup(pools) {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const box = document.getElementById("od-matchup");
  if (!away || !home || away === home) {
    box.innerHTML = "";
    return;
  }
  const side = (off, def) => ({ off: odOffense(off), def: odDefense(def) });
  const a = side(away, home), h = side(home, away);
  const fair = (s, k) => {
    const o = s.off.rate(k), d = s.def.rate(k);
    return o === null || d === null ? null : (o + d) / 2;
  };
  const sample = OD_SAMPLES[odView.sample];
  const rows = OD_OUTCOMES.map(([k, name]) => {
    const pa = fair(a, k), ph = fair(h, k);
    const both = pa === null || ph === null ? null : pa * ph;
    return `<tr class="${k === "punt" ? "od-punt-row" : ""}">
      <td class="od-label">${name}</td>
      ${odRateCell(a.off, k, pools[`off_${k}`])}${odRateCell(a.def, k, pools[`def_${k}`])}
      <td class="num od-fair">${odPrice(pa)}</td>
      ${odRateCell(h.off, k, pools[`off_${k}`], " od-split")}${odRateCell(h.def, k, pools[`def_${k}`])}
      <td class="num od-fair">${odPrice(ph)}</td>
      <td class="num od-fair od-both od-split">${odPrice(both)}</td>
    </tr>`;
  }).join("");
  const det = (label, fa, fh) => `<tr><td class="od-label">${label}</td><td class="num">${fa}</td><td class="num od-split">${fh}</td></tr>`;
  // A shaded box, not the whole cell: these columns are as wide as the week-by-week rows.
  const threeCell = (t, pool) => (t.threeOutRate === null ? `<td class="num">—</td>` : `<td class="num"><span class="od-rate od-box ${percentileTier(t.threeOutRate, pool, false)}"${tierAlphaAttr(t.threeOutRate, pool, false)}><b>${odPct(t.threeOutRate)}</b><small>${t.threeOut}/${t.games}</small></span></td>`);
  const splitText = (s) => (s.n ? OD_OUTCOMES.map(([k, , short]) => `<span class="od-chip od-c-${k} od-chip-n">${short} ${s[k]}</span>`).join("") + `<span class="od-of">of ${s.n}</span>` : `<span class="od-none">None</span>`);
  // The detail rows are always the opening drive itself (the 3 & out, plays
  // and the received / kicked split only mean something for that drive).
  const offA = odTally(odTeamGames(away)), offH = odTally(odTeamGames(home));
  const defA = odTally(odDefLog(away)), defH = odTally(odDefLog(home));
  box.innerHTML = `
    <div class="od-match">
      <table class="data-table od-table od-fair-table">
        <thead>
          <tr><th rowspan="2" class="od-label">${sample}</th>
            <th colspan="3">${odTeamLabel(away)} Drive</th>
            <th colspan="3" class="od-split">${odTeamLabel(home)} Drive</th>
            <th rowspan="2" class="od-split">Both<br>Fair</th></tr>
          <tr><th>${away} Offense</th><th>${home} Defense</th><th>Fair</th>
            <th class="od-split">${home} Offense</th><th>${away} Defense</th><th>Fair</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <table class="data-table od-table od-detail">
        <thead><tr><th class="od-label">Opening Drive</th><th>${odTeamLabel(away)}</th><th class="od-split">${odTeamLabel(home)}</th></tr></thead>
        <tbody>
          <tr><td class="od-label">3 &amp; Out (Offense)</td>${threeCell(offA, pools.off_3o)}${threeCell(offH, pools.off_3o).replace("<td class=\"num", "<td class=\"num od-split")}</tr>
          <tr><td class="od-label">3 &amp; Out Forced (Defense)</td>${threeCell(defA, pools.def_3o)}${threeCell(defH, pools.def_3o).replace("<td class=\"num", "<td class=\"num od-split")}</tr>
          ${det("Avg Plays", offA.plays === null ? "—" : offA.plays.toFixed(1), offH.plays === null ? "—" : offH.plays.toFixed(1))}
          ${det("Avg Yards", offA.yards === null ? "—" : offA.yards.toFixed(0), offH.yards === null ? "—" : offH.yards.toFixed(0))}
          ${det("Had The Ball First", splitText(offA.split.received), splitText(offH.split.received))}
          ${det("Kicked Off First", splitText(offA.split.kicked), splitText(offH.split.kicked))}
          ${det("Offense By Week", odLog(odTeamGames(away), false), odLog(odTeamGames(home), false))}
          ${det("Defense By Week", odLog(odDefLog(away), true), odLog(odDefLog(home), true))}
        </tbody>
      </table>
    </div>`;
}

const OD_SORTS = {
  team: (t) => t.team,
  games: (t) => t.off.games,
  o_3o: (t) => t.off.threeOutRate,
  d_3o: (t) => t.def.threeOutRate,
  plays: (t) => t.off.plays,
  yards: (t) => t.off.yards,
};
for (const [k] of OD_OUTCOMES) {
  OD_SORTS[`o_${k}`] = (t) => t.off.rate(k);
  OD_SORTS[`d_${k}`] = (t) => t.def.rate(k);
}

function renderOdTeams(teams, pools) {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const rows = teams.map((team) => ({ team, off: odOffense(team), def: odDefense(team), log: odTeamGames(team) }));
  const key = OD_SORTS[odView.sort] ? odView.sort : "o_punt";
  rows.sort((x, y) => {
    const a = OD_SORTS[key](x), b = OD_SORTS[key](y);
    if (a === b) return x.team.localeCompare(y.team);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a > b ? 1 : -1) * (key === "team" ? 1 : odView.dir);
  });
  const th = (k, label, extra = "", attrs = "") => `<th${attrs} class="bp-sort${key === k ? " bp-sort-on" : ""}${extra}" data-sort="${k}">${label}${key === k ? (odView.dir < 0 && k !== "team" ? " ▼" : " ▲") : ""}</th>`;
  const three = (t, pool) => (t.threeOutRate === null ? `<td class="num">—</td>` : `<td class="num od-rate ${percentileTier(t.threeOutRate, pool, false)}"${tierAlphaAttr(t.threeOutRate, pool, false)}><b>${odPct(t.threeOutRate)}</b><small>${t.threeOut}/${t.games}</small></td>`);
  const body = rows.map((r) => `<tr class="${r.team === away || r.team === home ? "od-sel" : ""}">
      <td class="od-label">${odTeamLabel(r.team)}</td>
      <td class="num">${r.off.games}</td>
      ${OD_OUTCOMES.map(([k], i) => odRateCell(r.off, k, pools[`off_${k}`], i === 0 ? " od-split" : "")).join("")}
      ${OD_OUTCOMES.map(([k], i) => odRateCell(r.def, k, pools[`def_${k}`], i === 0 ? " od-split" : "")).join("")}
      ${three(r.off, pools.off_3o).replace("<td class=\"num", "<td class=\"num od-split")}${three(r.def, pools.def_3o)}
      <td class="num">${r.off.plays === null ? "—" : r.off.plays.toFixed(1)}</td>
      <td class="num">${r.off.yards === null ? "—" : r.off.yards.toFixed(0)}</td>
      <td class="od-log-cell od-split">${odLog(r.log, false)}</td>
    </tr>`).join("");
  document.getElementById("od-teams").innerHTML = `
    <table class="data-table od-table od-all">
      <thead>
        <tr>${th("team", "Team", " od-label", ' rowspan="2"')}${th("games", "G", "", ' rowspan="2"')}
          <th colspan="4" class="od-split">Offense: ${OD_SAMPLES[odView.sample]}</th>
          <th colspan="4" class="od-split">Defense: Opponents' ${OD_SAMPLES[odView.sample]}</th>
          <th colspan="4" class="od-split">Opening Drive</th>
          <th rowspan="2" class="od-split od-label od-log-head">Offense By Week</th></tr>
        <tr>${OD_OUTCOMES.map(([k, name], i) => th(`o_${k}`, name, i === 0 ? " od-split" : "")).join("")}
          ${OD_OUTCOMES.map(([k, name], i) => th(`d_${k}`, name, i === 0 ? " od-split" : "")).join("")}
          ${th("o_3o", "3 &amp; Out", " od-split")}${th("d_3o", "3 &amp; Out Forced")}${th("plays", "Plays")}${th("yards", "Yards")}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function odIsPrimetime(g) {
  return g.weekday !== "Sunday" || (g.time || "") >= "19:00";
}
function tagOdPrimetime() {
  const games = (DATA.schedule || []).filter((g) => g.week === scheduleWeek);
  document.querySelectorAll("#matchup-row .matchup-card").forEach((card) => {
    const g = games.find((x) => x.away === card.dataset.away && x.home === card.dataset.home);
    if (g && odIsPrimetime(g) && !card.querySelector(".od-prime")) card.insertAdjacentHTML("beforeend", `<span class="od-prime">Primetime</span>`);
  });
}

function renderOd() {
  const teams = Object.keys(DATA.opening_drives?.teams || {}).sort();
  const pools = odPools(teams);
  document.querySelectorAll("#od-toolbar [data-sample]").forEach((b) => b.classList.toggle("active", b.dataset.sample === odView.sample));
  document.getElementById("od-last").value = String(odView.last);
  if (!teams.length) {
    document.getElementById("od-matchup").innerHTML = `<p class="no-data-note">No drives yet this season.</p>`;
    document.getElementById("od-teams").innerHTML = "";
    return;
  }
  renderOdMatchup(pools);
  renderOdTeams(teams, pools);
}

function odStart() {
  document.getElementById("empty-state").hidden = true;
  document.getElementById("od-app").hidden = false;
  const options = [...DATA.teams].sort().map((t) => `<option value="${t}">${t}</option>`).join("");
  for (const id of ["away-select", "home-select"]) document.getElementById(id).innerHTML = options;
  initScheduleScroller(renderOd, { onWeekChange: tagOdPrimetime });
  tagOdPrimetime();
  for (const id of ["away-select", "home-select"]) {
    document.getElementById(id).addEventListener("change", () => {
      document.querySelectorAll("#matchup-row .matchup-card").forEach((c) => c.classList.remove("selected"));
      renderOd();
    });
  }
  document.getElementById("od-toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sample]");
    if (!b) return;
    odView.sample = b.dataset.sample;
    saveOdView();
    renderOd();
  });
  document.getElementById("od-last").addEventListener("change", (e) => {
    odView.last = Number(e.target.value) || 0;
    saveOdView();
    renderOd();
  });
  document.getElementById("od-teams").addEventListener("click", (e) => {
    const h = e.target.closest("th[data-sort]");
    if (!h) return;
    if (odView.sort === h.dataset.sort) odView.dir = -odView.dir;
    else {
      odView.sort = h.dataset.sort;
      odView.dir = -1;
    }
    saveOdView();
    renderOd();
  });
  renderOd();
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    odStart();
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML = "<p>Couldn't load this week's data. Try a refresh.</p>";
    console.error(err);
  });
