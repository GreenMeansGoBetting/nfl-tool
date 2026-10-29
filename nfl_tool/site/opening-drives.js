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
  ["td", "TD", "TD"],
  ["fg", "FG Att", "FG"],
  ["punt", "Punt", "P"],
  ["other", "Other", "O"],
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
  pools.plays = all.map((x) => x.off.plays);
  pools.yards = all.map((x) => x.off.yards);
  // Every opening drive of the season, for the week-by-week Plays / Yards shades.
  const drives = Object.values(DATA.opening_drives?.teams || {}).flat();
  pools.drivePlays = drives.map((g) => g.plays);
  pools.driveYards = drives.map((g) => g.yards);
  return pools;
}
// A shaded tile inside the cell (the NBA zone grid's look): rate + count.
function odTile(value, pool, big, small, cls = "") {
  if (value === null || value === undefined) return `<td class="num od-cell${cls}"><div class="od-tile">—</div></td>`;
  return `<td class="num od-cell${cls}"><div class="od-tile ${percentileTier(value, pool, false)}"${tierAlphaAttr(value, pool, false)}><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div></td>`;
}
const odRateCell = (tally, k, pool, cls = "") => odTile(tally.rate(k), pool, odPct(tally.rate(k)), `${tally.counts[k]}/${tally.n}`, cls);
const odLabel = (k) => {
  const [, name] = OD_OUTCOMES.find(([x]) => x === k);
  return `<span class="od-lab od-c-${k}">${name}</span>`;
};
const odChip = (k, text, tip) => `<span class="od-chip od-c-${k}"${tip ? ` title="${tip}"` : ""}>${text}</span>`;
function odLog(rows, defense) {
  if (!rows.length) return `<span class="od-none">No games</span>`;
  return `<span class="od-log">${rows.map((g) => {
    const [, name, short] = OD_OUTCOMES.find(([k]) => k === g.out);
    const who = defense ? `${g.opp_of} vs them` : `vs ${g.opp}`;
    return odChip(g.out, short, `Week ${g.week} ${who}: ${name}${g.three_out ? " (3 & Out)" : ""}, ${g.plays} plays, ${g.yards} yds, ${g.received ? "had the ball first" : "kicked off first"}`);
  }).join("")}</span>`;
}
// A defense's log: its opponents' opening drives, named by who had the ball.
const odDefLog = (team) => odTeamGames(team).map((g) => {
  const row = odOpponentRow(g);
  return row ? { ...row, opp_of: g.opp } : null;
}).filter(Boolean);
// One pill per week from any rule: (game) => [class, text, tip].
const odWeekPills = (rows, pill) => (rows.length ? `<span class="od-log">${rows.map((g) => {
  const [k, text, tip] = pill(g);
  return `<span class="od-chip ${k}" title="${tip}">${text}</span>`;
}).join("")}</span>` : `<span class="od-none">No games</span>`);
// League-wide shade for one drive's plays or yards (every opening drive this
// season): the most = green, the fewest = red, on the shared rank colors.
function odDriveShade(value, pool) {
  const rank = pool.filter((v) => v > value).length + 1;
  return rankScaleStyle(rank, pool.length).replace(/^ style="/, "").replace(/"$/, "");
}

function odTeamLabel(team) {
  return `<span class="od-team">${teamLogoMini(team, 20)}<b>${team}</b></span>`;
}
const odTeamRgb = (team) => teamAccentRgb(team).map(Math.round).join(",");

// The parlay picker's choice per side (not saved: Punt / Punt is the Discord's bet).
const odParlay = { away: "punt", home: "punt" };

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
  const sampleTitle = { open: "Opening Drives", half: "First Half Drives", game: "Full Game Drives" }[odView.sample];
  // Each team's three columns sit on its own team-color tint (the NBA zone grid's grouping).
  const grp = (team, i, n) => ` od-gt${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}" style="--zg:${odTeamRgb(team)}`;
  const gap = `<td class="od-ggap"></td>`;
  const gapTh = `<th class="od-ggap"></th>`;
  const rows = OD_OUTCOMES.map(([k]) => {
    const pa = fair(a, k), ph = fair(h, k);
    return `<tr>
      <td class="od-label">${odLabel(k)}</td>${gap}
      ${odRateCell(a.off, k, pools[`off_${k}`], grp(away, 0, 3))}${odRateCell(a.def, k, pools[`def_${k}`], grp(away, 1, 3))}
      <td class="num od-cell${grp(away, 2, 3)}"><div class="od-tile od-fair">${odPrice(pa)}</div></td>${gap}
      ${odRateCell(h.off, k, pools[`off_${k}`], grp(home, 0, 3))}${odRateCell(h.def, k, pools[`def_${k}`], grp(home, 1, 3))}
      <td class="num od-cell${grp(home, 2, 3)}"><div class="od-tile od-fair">${odPrice(ph)}</div></td>
    </tr>`;
  }).join("");
  const labels = (off, def) => [`${teamLogoMini(off, 16)} ${off} Offense`, `${teamLogoMini(def, 16)} ${def} Defense`, "Fair"];
  const labelRow = (off, def) => labels(off, def).map((l, i) => `<th class="num${grp(off, i, 3)}">${l}</th>`).join("");

  // Fair parlay: one outcome per team, chances multiplied (no correlation).
  const pick = (which, team, s) => `<div class="od-pick-row"><span class="od-team">${teamLogoMini(team, 18)}<b>${team}</b></span>${OD_OUTCOMES.map(([k, name]) =>
    `<button type="button" class="od-pick-btn od-c-${k}${odParlay[which] === k ? " on" : ""}" data-side="${which}" data-k="${k}">${name}</button>`).join("")}<span class="od-pick-fair">${odParlay[which] ? odPrice(fair(s, odParlay[which])) : ""}</span></div>`;
  const chosen = [[away, a, odParlay.away], [home, h, odParlay.home]].filter(([, , k]) => k);
  const chance = chosen.reduce((p, [, s, k]) => (p === null || fair(s, k) === null ? null : p * fair(s, k)), 1);
  const parlayName = chosen.map(([team, , k]) => `${team} ${OD_OUTCOMES.find(([x]) => x === k)[1]}`).join(" + ");

  // Opening drive, week by week: every row lines up with the same games.
  const offRows = (team) => odTeamGames(team);
  const defRows = (team) => odDefLog(team);
  const yn = (on) => [on ? "od-y" : "od-n", on ? "Y" : "N"];
  const three = (rows, def) => odWeekPills(rows, (g) => [...yn(g.three_out), `Week ${g.week}${def ? ` ${g.opp_of} vs them` : ` vs ${g.opp}`}: ${g.three_out ? "3 & out" : "no 3 & out"}`]);
  const shaded = (rows, key, pool, unit) => `<span class="od-log">${rows.map((g) =>
    `<span class="od-chip od-num" style="${odDriveShade(g[key], pool)}" title="Week ${g.week} vs ${g.opp}: ${g[key]} ${unit} on the opening drive">${g[key]}</span>`).join("")}</span>`;
  const first = (rows, def) => odWeekPills(rows, (g) => {
    const theirs = g.received; // a defense's rows are its opponents': they received = this defense was on the field first
    if (!theirs) return ["od-x", "X", `Week ${g.week}: ${def ? "their offense had the ball first" : "kicked off first"}`];
    const [, name, short] = OD_OUTCOMES.find(([k]) => k === g.out);
    return [`od-c-${g.out}`, short, `Week ${g.week}: ${name}`];
  });
  const det = (label, fa, fh) => `<tr><td class="od-label">${label}</td><td class="od-wk">${fa}</td><td class="od-wk od-split">${fh}</td></tr>`;
  box.innerHTML = `
    <div class="od-match">
      <div>
        <table class="data-table od-grid od-fair-table">
          <colgroup><col class="od-lab-col"><col class="od-ggap-col"><col><col><col><col class="od-ggap-col"><col><col><col></colgroup>
          <thead>
            <tr class="od-ggroups"><th></th>${gapTh}<th colspan="7" class="od-gtitle">${sampleTitle}</th></tr>
            <tr class="od-glabels"><th></th>${gapTh}${labelRow(away, home)}${gapTh}${labelRow(home, away)}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="od-parlay">
          <div class="od-parlay-head">Fair Parlay</div>
          ${pick("away", away, a)}${pick("home", home, h)}
          <div class="od-parlay-out">${chosen.length ? `<span>${parlayName}</span><b>${odPrice(chance)}</b>` : `<span class="od-none">Pick an outcome for either team</span>`}</div>
        </div>
      </div>
      <table class="data-table od-table od-detail">
        <thead><tr><th class="od-label">Opening Drive</th><th>${odTeamLabel(away)}</th><th class="od-split">${odTeamLabel(home)}</th></tr></thead>
        <tbody>
          ${det("3 &amp; Out Off", three(offRows(away), false), three(offRows(home), false))}
          ${det("3 &amp; Out Def", three(defRows(away), true), three(defRows(home), true))}
          ${det("Plays", shaded(offRows(away), "plays", pools.drivePlays, "plays"), shaded(offRows(home), "plays", pools.drivePlays, "plays"))}
          ${det("Yards", shaded(offRows(away), "yards", pools.driveYards, "yards"), shaded(offRows(home), "yards", pools.driveYards, "yards"))}
          ${det("Offense First", first(offRows(away), false), first(offRows(home), false))}
          ${det("Defense First", first(defRows(away), true), first(defRows(home), true))}
          ${det("Offense By Week", odLog(offRows(away), false), odLog(offRows(home), false))}
          ${det("Defense By Week", odLog(defRows(away), true), odLog(defRows(home), true))}
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
  const arrow = (k) => (key === k ? (odView.dir < 0 && k !== "team" ? " ▼" : " ▲") : "");
  // Column groups, each on its own tint (the NBA zone grid's look).
  const sample = OD_SAMPLES[odView.sample];
  const groups = [
    { name: `Offense: ${sample}`, cols: OD_OUTCOMES.map(([k]) => [`o_${k}`, odLabel(k)]) },
    { name: `Defense: Opponents' ${sample}`, cols: OD_OUTCOMES.map(([k]) => [`d_${k}`, odLabel(k)]) },
    { name: "Opening Drive", cols: [["o_3o", "3 &amp; Out<br>Off"], ["d_3o", "3 &amp; Out<br>Def"], ["plays", "Plays"], ["yards", "Yards"]] },
  ];
  const edge = (gi, i, n) => ` od-g${gi}${i === 0 ? " od-gl" : ""}${i === n - 1 ? " od-gr" : ""}`;
  const gap = `<td class="od-ggap"></td>`;
  const gapTh = `<th class="od-ggap"></th>`;
  const sortTh = (k, label, cls) => `<th class="num bp-sort${key === k ? " bp-sort-on" : ""}${cls}" data-sort="${k}">${label}${arrow(k)}</th>`;
  const groupRow = `<tr class="od-ggroups"><th></th><th></th>${groups.map((g, gi) => `${gapTh}<th colspan="${g.cols.length}" class="od-g${gi} od-gl od-gr">${g.name}</th>`).join("")}${gapTh}<th class="od-g3 od-gl od-gr">Offense By Week</th></tr>`;
  const labelRow = `<tr class="od-glabels">${sortTh("team", "Team", " od-label")}${sortTh("games", "G", "")}${groups.map((g, gi) => gapTh + g.cols.map(([k, label], i) => sortTh(k, label, edge(gi, i, g.cols.length))).join("")).join("")}${gapTh}<th class="od-g3 od-gl od-gr"></th></tr>`;
  const body = rows.map((r) => {
    const cells = [
      OD_OUTCOMES.map(([k], i) => odRateCell(r.off, k, pools[`off_${k}`], edge(0, i, 4))),
      OD_OUTCOMES.map(([k], i) => odRateCell(r.def, k, pools[`def_${k}`], edge(1, i, 4))),
      [
        odTile(r.off.threeOutRate, pools.off_3o, odPct(r.off.threeOutRate), `${r.off.threeOut}/${r.off.games}`, edge(2, 0, 4)),
        odTile(r.def.threeOutRate, pools.def_3o, odPct(r.def.threeOutRate), `${r.def.threeOut}/${r.def.games}`, edge(2, 1, 4)),
        odTile(r.off.plays, pools.plays, r.off.plays === null ? "" : r.off.plays.toFixed(1), "", edge(2, 2, 4)),
        odTile(r.off.yards, pools.yards, r.off.yards === null ? "" : r.off.yards.toFixed(0), "", edge(2, 3, 4)),
      ],
    ];
    return `<tr class="${r.team === away || r.team === home ? "od-sel" : ""}">
      <td class="od-label">${odTeamLabel(r.team)}</td>
      <td class="num">${r.off.games}</td>
      ${cells.map((c) => gap + c.join("")).join("")}${gap}
      <td class="od-log-cell od-g3 od-gl od-gr">${odLog(r.log, false)}</td>
    </tr>`;
  }).join("");
  document.getElementById("od-teams").innerHTML = `
    <table class="data-table od-grid od-all">
      <colgroup><col class="od-team-col"><col class="od-g-col">${groups.map((g) => `<col class="od-ggap-col">${g.cols.map(() => '<col class="od-rate-col">').join("")}`).join("")}<col class="od-ggap-col"><col></colgroup>
      <thead>${groupRow}${labelRow}</thead>
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
  document.getElementById("od-matchup").addEventListener("click", (e) => {
    const b = e.target.closest(".od-pick-btn");
    if (!b) return;
    odParlay[b.dataset.side] = odParlay[b.dataset.side] === b.dataset.k ? null : b.dataset.k;
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
