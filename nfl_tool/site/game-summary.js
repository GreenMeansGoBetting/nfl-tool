// ---- Game Previews Summary: one screenshot-ready card per game ----
// Same 1160x980 card as the TD / Props summaries, read top to bottom: The
// Line (market score next to the GMG model score), one panel per team
// (record, results, ratings, injuries), The Matchups (each A-F grade with
// the stats behind it), Keys (the three biggest edges) and My Picks, which
// saves to the same picks as the full page. Boxes and chips, no sentences.

const GS_VIEW_KEY = "nfl-tool.preview-view.v1";
let gsView = "full";
try {
  gsView = localStorage.getItem(GS_VIEW_KEY) || "full";
} catch (e) {
  // localStorage unavailable -- opens on the full preview.
}
const GS_EDGE_Z = TIER_Z_THRESHOLD; // same line as the page's green/red tiers
const GS_EDGES_SHOWN = 8;
// Matchup tagging (reworked with the user 2026-10-01). Both numbers are
// "good for its own side" z-scores (offense: produces; defense: stops).
// The GAP between them decides Mismatch/Tough, so a bad offense against an
// average defense still flags -- requiring BOTH sides to be extreme hid real
// edges (PIT bad vs blitz, CLE allowing sacks, PIT's red zone). Same-
// direction pairs past GS_BOTH_Z read Good vs Good / Bad vs Bad.
const GS_GAP_Z = 1.0;
const GS_BOTH_Z = 0.4;
// A defensive look counts once a defense shows it this often; how often only
// scales how high the edge ranks (frequency = relevance, never a gate on
// whether a matchup is real).
const GS_MIN_LOOK_RATE = 0.12;
const GS_INJURIES_SHOWN = 5;

// ---- matchup tags ----
// good/bad from each side's own point of view (offense: produces a lot;
// defense: allows little).
const GS_TAGS = {
  mismatch: { label: "Mismatch", cls: "gs-tag-mismatch" },
  tough: { label: "Tough", cls: "gs-tag-tough" },
  strong: { label: "Good vs Good", cls: "gs-tag-strong" },
  weak: { label: "Bad vs Bad", cls: "gs-tag-weak" },
};
function gsTag(offGood, offBad, defGood, defBad) {
  if (offGood && defBad) return "mismatch";
  if (offBad && defGood) return "tough";
  if (offGood && defGood) return "strong";
  if (offBad && defBad) return "weak";
  return null;
}
function gsMatchupTag(offZ, defZ) {
  if (offZ === null || offZ === undefined || defZ === null || defZ === undefined) return null;
  if (offZ >= GS_BOTH_Z && defZ >= GS_BOTH_Z) return "strong";
  if (offZ <= -GS_BOTH_Z && defZ <= -GS_BOTH_Z) return "weak";
  const gap = offZ - defZ;
  if (gap >= GS_GAP_Z) return "mismatch";
  if (gap <= -GS_GAP_Z) return "tough";
  return null;
}
// How strongly an edge should rank: the gap for Mismatch/Tough, how far both
// sides lean for Good vs Good / Bad vs Bad.
function gsEdgeStrength(offZ, defZ, tag) {
  return tag === "strong" || tag === "weak" ? 0.6 * (Math.abs(offZ) + Math.abs(defZ)) : Math.abs(offZ - defZ);
}
function gsTagHtml(key) {
  return key ? `<span class="gs-tag ${GS_TAGS[key].cls}">${GS_TAGS[key].label}</span>` : `<span class="gs-tag gs-tag-even">Even</span>`;
}
function gsGradeBox(grade) {
  return `<span class="gs-grade ${gradeClass(grade)}"${gradeAlphaAttr(grade)}>${grade || "--"}</span>`;
}
function gsStatZ(key, team, invert) {
  const pool = teamsWithGames();
  return zScore(tierValue(team, key), pool.map((t) => tierValue(t, key)), invert);
}
function gsZClass(z) {
  if (z === null || z === undefined) return "";
  return z >= GS_EDGE_Z ? "gs-good" : z <= -GS_EDGE_Z ? "gs-bad" : "";
}

// "Scheme" on the full page = how an offense does against the looks a
// defense throws at it (blitzes, pressure, 7+ or 6- man boxes), and how a
// defense does when it shows them. Named for what it is on the card.
const GS_CATEGORY_LABELS = { Scheme: "Blitz & Box" };

// Team grades, offense vs the other defense.
function gsGradeRows(offTeam, defTeam) {
  return SUMMARY_CATEGORIES.map((cat) => {
    const offZ = categoryZ(cat, offTeam, "off");
    const defZ = categoryZ(cat, defTeam, "def");
    const og = gradeForZ(offZ);
    const dg = gradeForZ(defZ);
    const tag = gsMatchupTag(offZ, defZ);
    return `<div class="gs-row"><span class="gs-row-label">${GS_CATEGORY_LABELS[cat.label] || cat.label}</span>${gsGradeBox(og)}<span class="gs-vs">vs</span>${gsGradeBox(dg)}${gsTagHtml(tag)}</div>`;
  }).join("");
}

const GS_SCHEME_SHORT = {
  "Heavy Box (7+)": "Heavy box",
  "Light Box (≤6)": "Light box",
  "Blitz (5+ rushers)": "Blitz",
  "Standard Rush": "4-man rush",
  Pressured: "Pressure",
  "Clean Pocket": "Clean pocket",
};

// Biggest General Stats + Scheme + Trenches edges for this offense vs that
// defense, ranked by gsEdgeStrength. Left out: pace (plays/game isn't good
// or bad), quarter splits (noise at this size) and the red zone composite
// (it has its own grade row above). Turnovers are mostly random, so they
// only show as good vs bad -- never Good vs Good / Bad vs Bad filler.
const GS_SKIP_ROWS = new Set(["Plays / Game", "Red Zone"]);
const GS_GOOD_VS_BAD_ONLY = new Set(["Turnovers"]);
// Plain production rows are already summed up by the Passing/Rushing grades
// above, so they rank a step below the specific situational edges.
const GS_PRODUCTION_RANK = 0.75;
// Which grade a stat row backs up, and its label with the unit spelled out.
const GS_ROW_CATEGORY = { "Pass Yards": "Passing", "Rush Yards": "Rushing", "Yards / Carry": "Rushing", Sacks: "Trenches" };
const GS_ROW_LABELS = { Points: "Points / game", "Pass Yards": "Pass yds / game", "Rush Yards": "Rush yds / game", "Yards / Carry": "Yds / carry", Sacks: "Sacks / game", Turnovers: "Turnovers / game", "Penalty Yards": "Penalty yds / game", "Explosive Plays": "Explosive play %" };
// Each grade shows at most this many stats under it, and a side at most this many in all.
const GS_PROOF_PER_GRADE = 2;
const GS_PROOF_PER_SIDE = 7;
function gsStatEdges(offTeam, defTeam, all) {
  const edges = [];
  // Small per-game counts (sacks, turnovers) get one decimal on the card --
  // whole numbers turned 2.6 vs 3.4 into a confusing "3 vs 3".
  const fmtV = (v, r) => {
    if (v === null || v === undefined) return "--";
    if (r.pct) return `${Math.round(v * 100)}%`;
    if (r.digits === undefined && Math.abs(v) < 10) return fmt(v, 1);
    return fmt(v, r.digits ?? 0);
  };
  GENERAL_STAT_GROUPS.filter((g) => g.label !== "Scoring by Quarter").forEach((g) =>
    g.rows.forEach((r) => {
      if (r.composite || GS_SKIP_ROWS.has(r.label)) return;
      const offZ = gsStatZ(r.offKey, offTeam, r.offInvert);
      const defZ = gsStatZ(r.defKey, defTeam, r.defInvert);
      const tag = gsMatchupTag(offZ, defZ);
      if (!tag) return;
      if (GS_GOOD_VS_BAD_ONLY.has(r.label)) {
        const goodVsBad = (offZ >= GS_EDGE_Z && defZ <= -GS_EDGE_Z) || (offZ <= -GS_EDGE_Z && defZ >= GS_EDGE_Z);
        if (!goodVsBad) return;
      }
      edges.push({
        label: GS_ROW_LABELS[r.label] || r.label,
        cat: GS_ROW_CATEGORY[r.label] || "Overall",
        offZ,
        defZ,
        off: `<span class="gs-val ${gsZClass(offZ)}">${fmtV(tierValue(offTeam, r.offKey), r)}</span>`,
        def: `<span class="gs-val ${gsZClass(defZ)}">${fmtV(tierValue(defTeam, r.defKey), r)}</span>`,
        tag,
        weight: gsEdgeStrength(offZ, defZ, tag) * (g.label === "Production" ? GS_PRODUCTION_RANK : 1),
      });
    })
  );
  // Scheme: the offense's result against a look vs the defense's own result
  // when it shows that look (two-sided). How often the defense shows it
  // scales the ranking only.
  SCHEME_GROUPS.forEach((group) =>
    group.rows.forEach((r) => {
      const tend = DATA.team_stats[defTeam][r.tendKey];
      if (tend === null || tend === undefined || tend < GS_MIN_LOOK_RATE) return;
      const offZ = gsStatZ(r.perfKey, offTeam, false);
      const leakZ = gsStatZ(r.defSuccessKey, defTeam, false); // + = leaky
      if (offZ === null || leakZ === null) return;
      const defZ = -leakZ; // good-for-the-defense orientation
      const tag = gsMatchupTag(offZ, defZ);
      if (!tag) return;
      const perf = DATA.team_stats[offTeam][r.perfKey];
      const allowed = DATA.team_stats[defTeam][r.defSuccessKey];
      const txt = (v) => (group.pct ? `${Math.round(v * 100)}%` : `${fmt(v, 1)}`);
      const relevance = Math.min(1.25, Math.max(0.7, 0.55 + tend)); // 15% look ~0.7x, 70%+ ~1.25x
      edges.push({
        label: `${GS_SCHEME_SHORT[r.label] || r.label} ${group.pct ? "success" : "yds/carry"}`,
        note: `${defTeam} shows it ${Math.round(tend * 100)}%`,
        cat: "Scheme",
        offZ,
        defZ,
        off: `<span class="gs-val ${gsZClass(offZ)}">${txt(perf)}</span>`,
        def: `<span class="gs-val ${gsZClass(defZ)}" title="${defTeam} allows this when it shows the look">${txt(allowed)}</span>`,
        tag,
        weight: gsEdgeStrength(offZ, defZ, tag) * relevance,
        scheme: true,
      });
    })
  );
  // Trenches parts: this line vs that front (overall already has a grade row).
  if (DATA.line_grades) {
    [["Pass pro vs rush", "pass_pro", "pass_rush"], ["Run block vs run D", "run_block", "run_defense"]].forEach(([label, og, dg]) => {
      const oe = trenchesEntry(offTeam, "off", og);
      const de = trenchesEntry(defTeam, "def", dg);
      if (!oe || !de || oe.z === null || de.z === null) return;
      const tag = gsMatchupTag(oe.z, de.z);
      if (!tag) return;
      edges.push({
        label,
        cat: "Trenches",
        offZ: oe.z,
        defZ: de.z,
        off: `<span class="gs-val ${gsZClass(oe.z)}">${oe.grade} ${oe.score}</span>`,
        def: `<span class="gs-val ${gsZClass(de.z)}">${de.grade} ${de.score}</span>`,
        tag,
        weight: gsEdgeStrength(oe.z, de.z, tag),
      });
    });
  }
  edges.sort((a, b) => b.weight - a.weight);
  return all ? edges : edges.slice(0, GS_EDGES_SHOWN);
}

// One side of the ball: each grade row, with the one or two stats behind it
// tucked underneath (claim, then proof). Only real edges are listed -- a stat
// where both sides are bad is not an edge -- and each is marked by who it
// favors: green bar = the offense, red = the defense, yellow = strength on
// strength. Leftover edges that belong to no grade go under "Overall".
function gsProofRow(e) {
  return `<div class="g2-proof g2-proof-${e.tag}"><span class="g2-proof-label">${e.label}</span>${e.off}${e.def}<span class="g2-proof-note">${e.note || ""}</span></div>`;
}
function gsMatchupColumn(offTeam, defTeam) {
  const edges = gsStatEdges(offTeam, defTeam, true).filter((e) => e.tag !== "weak");
  let left = GS_PROOF_PER_SIDE;
  const take = (cat) => {
    const picked = edges.filter((e) => e.cat === cat).slice(0, Math.min(GS_PROOF_PER_GRADE, left));
    left -= picked.length;
    return picked.map(gsProofRow).join("");
  };
  const head = (team, side) => {
    const rgb = teamAccentRgb(team);
    return `<span class="gs-head" style="background:rgba(${rgb.join(",")},0.35);border-bottom:3px solid rgb(${rgb.join(",")})">${teamLogoMini(team, 16)}<span>${team} ${side}</span></span>`;
  };
  // Proof is handed out strongest grade first so the cap never starves the
  // biggest mismatch, then printed in the usual grade order.
  const cats = SUMMARY_CATEGORIES.map((cat) => {
    const offZ = categoryZ(cat, offTeam, "off");
    const defZ = categoryZ(cat, defTeam, "def");
    return { cat, offZ, defZ, tag: gsMatchupTag(offZ, defZ), gap: offZ === null || defZ === null ? 0 : Math.abs(offZ - defZ) };
  });
  const proof = {};
  [...cats].sort((x, y) => y.gap - x.gap).forEach((c) => (proof[c.cat.label] = take(c.cat.label)));
  const overall = take("Overall");
  const blocks = cats
    .map((c) => {
      const tag = c.tag && c.tag !== "weak" ? gsTagHtml(c.tag) : `<span class="g2-notag">${c.tag === "weak" ? "Bad vs Bad" : "Even"}</span>`;
      return `<div class="g2-block${c.tag && c.tag !== "weak" ? ` g2-block-${c.tag}` : ""}">
        <div class="g2-grade-row"><span class="g2-cat">${GS_CATEGORY_LABELS[c.cat.label] || c.cat.label}</span>${gsGradeBox(gradeForZ(c.offZ))}${gsGradeBox(gradeForZ(c.defZ))}${tag}</div>
        ${proof[c.cat.label]}
      </div>`;
    })
    .join("");
  return `<div class="sc-col g2-col">
    <div class="g2-grade-row g2-col-head"><span></span>${head(offTeam, "OFF")}${head(defTeam, "DEF")}<span></span></div>
    ${blocks}
    ${overall ? `<div class="g2-block"><div class="g2-grade-row"><span class="g2-cat g2-cat-plain">Overall</span></div>${overall}</div>` : ""}
  </div>`;
}

// ---- GMG score model ----
// The projection itself is built in the data build (nfl_tool/gmg_model.py ->
// DATA.gmg_model[game_id]) and locked at kickoff, so the card, the record
// popup and the graded picks all read one number that can't be re-run after
// the game. A game with no entry (it started before tracking began) shows "--".
const GS_MODEL_EDGE = 2.5; // "bigger edge" = the model is this far from the line
function gsModelEntry(game) {
  return (DATA.gmg_model || {})[game.game_id] || null;
}
// The team's No. 1 QB: most games as its lead passer (10+ attempts) before
// this week, a tie going to whoever led more recently. Mirrors _regular_qb
// in gmg_model.py.
function gsRegularQb(team, week) {
  const leads = {};
  Object.entries((DATA.player_game_logs || {})[team] || {}).forEach(([name, games]) =>
    games.forEach((g) => {
      const att = g.pass_att || 0;
      if (g.week < week && att >= 10 && att > (leads[g.week] ? leads[g.week][0] : 0)) leads[g.week] = [att, name];
    })
  );
  const starts = {};
  const last = {};
  Object.entries(leads).forEach(([wk, [, name]]) => {
    starts[name] = (starts[name] || 0) + 1;
    last[name] = Math.max(last[name] || 0, Number(wk));
  });
  return Object.keys(starts).sort((a, b) => starts[b] - starts[a] || last[b] - last[a])[0] || null;
}
// That QB's name if he is ruled Out this week (injury report or IR). A
// backup who filled in and is now Out himself does not count -- the first
// version flagged Mariota the week Jayden Daniels returned (user 2026-10-10).
function gsQbOut(team, week) {
  const qb = gsRegularQb(team, week);
  if (!qb) return null;
  const listed = (((DATA.injuries || {})[team] || {})[String(week)] || []).some((p) => normName(p.full_name) === normName(qb) && statusAbbr(p.status) === "Out");
  return listed || rosterOut(team, qb) ? qb : null;
}

// ---- GMG model record: every locked projection, its picks and results ----
function gsModelTally(entries, key, minEdge) {
  const t = { win: 0, loss: 0, push: 0 };
  entries.forEach((e) => {
    const result = e[`${key}_result`];
    if (result && (e[`${key}_edge`] || 0) >= minEdge) t[result] += 1;
  });
  return `${t.win}-${t.loss}${t.push ? `-${t.push}` : ""}`;
}
function gsModelPickCell(e, key) {
  if (!e[`${key}_pick`]) return `<td class="muted-label">--</td><td></td>`;
  const side = e[`${key}_pick`];
  const label = key === "spread" ? `${teamLogoMini(e[side], 16)} ${e[side]} ${gsSigned(side === "home" ? e.spread : -e.spread)}` : `${side === "over" ? "Over" : "Under"} ${fmt(e.total, 1).replace(/\.0$/, "")}`;
  const big = e[`${key}_edge`] >= GS_MODEL_EDGE;
  const result = e[`${key}_result`];
  return `<td class="gm-pick${big ? " gm-pick-big" : ""}">${label} <span class="gm-edge" title="How far the model is from the line">${fmt(e[`${key}_edge`], 1)}</span></td>
    <td><span class="pick-result pick-result-${result || "pending"}">${result ? result.toUpperCase() : "Pending"}</span></td>`;
}
function renderModelRecord() {
  const entries = Object.values(DATA.gmg_model || {});
  if (!entries.length) return `<h2 class="modal-title">GMG Model record</h2><p class="no-data-note">No projections yet. They appear with the next data update.</p>`;
  const tile = (label, value) => `<div class="gm-tile"><div class="gs-tile-label">${label}</div><div class="gm-tile-big">${value}</div></div>`;
  const weeks = [...new Set(entries.map((e) => e.week))].sort((a, b) => b - a);
  const tables = weeks
    .map((w) => {
      const rows = entries
        .filter((e) => e.week === w)
        .map(
          (e) => `<tr>
            <td class="gm-game">${teamLogoMini(e.away, 16)} ${e.away} @ ${teamLogoMini(e.home, 16)} ${e.home}${(e.qb_out || []).length ? ` <span class="muted-label" title="Starting QB ruled out: ${GS_MODEL_QB_NOTE}">QB out: ${e.qb_out.join(", ")}</span>` : ""}</td>
            <td class="num">${fmt(e.away_pts, 1)} - ${fmt(e.home_pts, 1)}</td>
            <td class="num">${e.final ? `${e.final[0]} - ${e.final[1]}` : `<span class="muted-label">${e.frozen ? "In progress" : "Not started"}</span>`}</td>
            ${gsModelPickCell(e, "spread")}${gsModelPickCell(e, "total")}
          </tr>`
        )
        .join("");
      return `<h3 class="stat-column-title">Week ${w}</h3>
        <table class="data-table gm-table"><thead><tr><th>Game</th><th>Model score</th><th>Final</th><th>Spread pick</th><th></th><th>Total pick</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");
  return `<h2 class="modal-title">GMG Model record</h2>
    <div class="gm-tiles">
      ${tile("Spread picks", gsModelTally(entries, "spread", 0))}
      ${tile("Total picks", gsModelTally(entries, "total", 0))}
      ${tile(`Spread, ${GS_MODEL_EDGE}+ pt edge`, gsModelTally(entries, "spread", GS_MODEL_EDGE))}
      ${tile(`Total, ${GS_MODEL_EDGE}+ pt edge`, gsModelTally(entries, "total", GS_MODEL_EDGE))}
    </div>
    <p class="section-note">Every game gets a spread pick and a total pick: whichever side of the line the model's score lands on. The small number is how many points the model is from the line; ${GS_MODEL_EDGE}+ is highlighted. Scores and lines lock at kickoff and are graded against the line at that moment. Tracking started Week 5, 2026.</p>
    ${tables}`;
}
const GS_MODEL_QB_NOTE = "3.5 points taken off that team";
function openModelRecord() {
  let overlay = document.getElementById("model-record-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "model-record-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="model-record-content"></div></div>`;
    document.body.appendChild(overlay);
    const close = () => (overlay.hidden = true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".modal-close").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }
  document.getElementById("model-record-content").innerHTML = renderModelRecord();
  overlay.hidden = false;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#model-record-btn, .g2-line-model")) openModelRecord();
});

// ---- Keys to the game: the few things that matter most ----
// The biggest graded matchups from both sides of the ball (same tags as the
// grade rows below), plus a starting QB who is out. Tiles, no sentences.
const GS_KEYS_SHOWN = 3;
const GS_KEY_UNITS = {
  Passing: ["pass game", "pass D"],
  Rushing: ["run game", "run D"],
  "Red Zone": ["red zone O", "red zone D"],
  Trenches: ["O-line", "front"],
  Scheme: ["offense", "blitz & box looks"],
};
function gsKeys(game) {
  const { away, home, week } = game;
  const keys = [];
  [[away, home], [home, away]].forEach(([team, opp]) => {
    const qb = gsQbOut(team, week);
    if (qb) keys.push({ weight: 9, adv: team, plain: true, label: "QB out", title: `${team} without ${shortName(qb)}`, right: summaryHeadshot(team, qb, 34) });
  });
  [[away, home], [home, away]].forEach(([off, def]) =>
    SUMMARY_CATEGORIES.forEach((cat) => {
      const offZ = categoryZ(cat, off, "off");
      const defZ = categoryZ(cat, def, "def");
      const tag = gsMatchupTag(offZ, defZ);
      if (!tag || tag === "weak") return;
      const [offUnit, defUnit] = GS_KEY_UNITS[cat.label] || [cat.label, cat.label];
      keys.push({
        weight: gsEdgeStrength(offZ, defZ, tag),
        adv: tag === "mismatch" ? off : tag === "tough" ? def : null,
        label: tag === "strong" ? "Strength vs strength" : "Advantage",
        title: tag === "tough" ? `${def} ${defUnit} vs ${off} ${offUnit}` : `${off} ${offUnit} vs ${def} ${defUnit}`,
        right: tag === "tough" ? `${gsGradeBox(gradeForZ(defZ))}${gsGradeBox(gradeForZ(offZ))}` : `${gsGradeBox(gradeForZ(offZ))}${gsGradeBox(gradeForZ(defZ))}`,
      });
    })
  );
  const shown = keys.sort((a, b) => b.weight - a.weight).slice(0, GS_KEYS_SHOWN);
  if (!shown.length) return `<div class="gs-none">No clear edges on either side</div>`;
  return shown
    .map((k) => {
      const rgb = k.adv ? teamAccentRgb(k.adv).join(",") : null;
      const style = rgb ? ` style="border-left-color:rgb(${rgb});background:rgba(${rgb},0.16)"` : "";
      return `<div class="g2-key-tile"${style}>
        <div class="g2-key-text"><span class="g2-key-label">${k.label}${k.adv && !k.plain ? ` ${teamLogoMini(k.adv, 15)} ${k.adv}` : ""}</span><span class="g2-key-title">${k.title}</span></div>
        <span class="g2-key-right">${k.right}</span>
      </div>`;
    })
    .join("");
}

// ---- The line: what the market says, read left to right ----
function gsLineStrip(game) {
  const { away, home } = game;
  const hs = pv(game, "home_team_spread");
  const hasSpread = hs !== null && hs !== undefined;
  const fav = hasSpread ? (hs <= 0 ? home : away) : null;
  const favLine = fav === home ? hs : pv(game, "away_team_spread");
  const total = pv(game, "total_line");
  const num = (n) => fmt(n, 1).replace(/\.0$/, "");
  const tile = (label, body, cls = "", title = "") => `<div class="g2-line-tile ${cls}"${title ? ` title="${title}"` : ""}><div class="gs-tile-label">${label}</div><div class="g2-line-big">${body}</div></div>`;
  const pair = (a, b) => `<span class="g2-line-side">${a}</span><span class="g2-line-side">${b}</span>`;
  const m = gsModelEntry(game);
  const model = m ? pair(`${teamLogoMini(away, 20)} ${fmt(m.away_pts, 1)}`, `${teamLogoMini(home, 20)} ${fmt(m.home_pts, 1)}`) : "--";
  const implied = hasSpread && total ? pair(`${teamLogoMini(away, 20)} ${num((total + hs) / 2)}`, `${teamLogoMini(home, 20)} ${num((total - hs) / 2)}`) : "--";
  const hasMl = pv(game, "away_moneyline") !== null && pv(game, "away_moneyline") !== undefined;
  const mlSide = (team, odds, prob) => `${teamLogoMini(team, 20)} ${fmtOddsSigned(odds)}${prob ? ` <small>${Math.round(prob * 100)}%</small>` : ""}`;
  const ml = hasMl ? pair(mlSide(away, pv(game, "away_moneyline"), pv(game, "away_ml_implied_prob")), mlSide(home, pv(game, "home_moneyline"), pv(game, "home_ml_implied_prob"))) : "--";
  return `<div class="g2-line">
    ${tile("Spread", fav ? `${teamLogoMini(fav, 22)} ${gsSigned(favLine)}` : "--")}
    ${tile("Total", total ? num(total) : "--")}
    ${tile("Market score", implied, "g2-line-wide", "The score the spread and total imply")}
    ${tile("GMG model", model, "g2-line-wide g2-line-model", "GMG projected score, locked at kickoff: ESPN FPI ratings, each team's opponent-adjusted scoring, and every graded matchup on this card, plus home field; 3.5 points off when the starting QB is out. Click for the model's record.")}
    ${tile("Win chance", ml, "g2-line-wide")}
  </div>`;
}

// ---- One panel per team: record, results, ratings, injuries ----
function gsTeamPanel(team, week) {
  const rgb = teamAccentRgb(team).join(",");
  const games = resumeGamesFor(team, week).sort((a, b) => a.week - b.week);
  const s = resumeSummary(games);
  const chips = games.length
    ? games
        .map((g) => {
          const q = g.label[0] === "Q" ? "q" : g.label[0] === "B" ? "b" : "n";
          const wl = g.margin > 0 ? "W" : g.margin < 0 ? "L" : "T";
          return `<span class="gs-res gs-res-${q} gs-res-${wl.toLowerCase()}" title="Wk ${g.week} ${g.isHome ? "vs" : "@"} ${g.opp} ${g.pf}-${g.pa} (${RESUME_LABELS[g.label]})">${teamLogoMini(g.opp, 16)}<b>${wl}</b></span>`;
        })
        .join("")
    : `<span class="gs-none">No games yet</span>`;
  const r = (DATA.espn_ratings || {})[team];
  const rt = (label, tile) => `<span class="g2-rt"><i>${label}</i>${tile}</span>`;
  const ratings = r ? rt("Off", gsRatingTile(r.off_rating, r.off)) + rt("Def", gsRatingTile(r.def_rating, r.def)) + rt("Overall", gsRatingTile(r.fpi_rating, r.fpi)) + rt("Schedule", gsSosTile(r.sos_rank)) : `<span class="gs-none">No ratings</span>`;
  return `<div class="g2-team">
    <div class="g2-team-head" style="background:rgba(${rgb},0.3);border-left:4px solid rgb(${rgb})">
      ${teamLogoMini(team, 26)}<b>${TEAM_NAMES[team] || team}</b>
      <span class="g2-rec"><span><i>Record</i>${s.su}</span><span><i>vs spread</i>${s.ats}</span></span>
    </div>
    <div class="g2-team-row"><span class="g2-lbl">Results</span><span class="gs-res-chips">${chips}</span></div>
    <div class="g2-team-row"><span class="g2-lbl">Ratings</span><span class="g2-rts">${ratings}</span></div>
    <div class="g2-team-row"><span class="g2-lbl">Injuries</span>${gsInjuryChips(team, week)}</div>
  </div>`;
}

// ---- lines ----
function gsSigned(n) {
  if (n === null || n === undefined) return "--";
  if (n === 0) return "PK";
  return n > 0 ? `+${fmt(n, 1).replace(/\.0$/, "")}` : fmt(n, 1).replace(/\.0$/, "");
}
// ---- Ratings: ESPN FPI (offense, defense, overall) as 1-100 league-normed
// ratings (build_stats.py compute_espn_ratings), plus schedule strength.
// Red (1) -> yellow (50) -> green (99); SOS rank 1 = toughest schedule so
// far, colored red, 32 = easiest, green. ----
function gsRatingStyle(hue) {
  return `background:hsla(${hue},70%,45%,0.28);border-color:hsl(${hue},70%,45%)`;
}
function gsRatingTile(rating, raw) {
  if (rating === null || rating === undefined) return `<span class="gs-rt">--</span>`;
  const sign = raw > 0 ? "+" : "";
  return `<span class="gs-rt" style="${gsRatingStyle(Math.round(rating * 1.2))}"><b>${rating}</b><small>${sign}${fmt(raw, 1)}</small></span>`;
}
function gsSosTile(rank) {
  if (!rank) return `<span class="gs-rt">--</span>`;
  return `<span class="gs-rt" style="${gsRatingStyle(Math.round(((rank - 1) / 31) * 120))}"><b>${propOrdinalSafe(rank)}</b><small>${rank <= 8 ? "tough" : rank >= 25 ? "easy" : "avg"}</small></span>`;
}
function propOrdinalSafe(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}
// ---- key injuries: starters only ----
const GS_STATUS_RANK = { Out: 0, Doubtful: 1, DNP: 2, Questionable: 3, Limited: 4 };
function gsInjuryChips(team, week) {
  const list = ((DATA.injuries || {})[team] || {})[String(week)] || [];
  const starters = list
    .map((p) => ({ ...p, abbr: statusAbbr(p.status) }))
    .filter((p) => (p.snap_share || 0) >= INJURY_STARTER_SNAP_SHARE && p.abbr in GS_STATUS_RANK)
    .sort((a, b) => GS_STATUS_RANK[a.abbr] - GS_STATUS_RANK[b.abbr] || (b.snap_share || 0) - (a.snap_share || 0));
  const shown = starters.slice(0, GS_INJURIES_SHOWN);
  const chips = shown
    .map((p) => `<span class="gs-inj">${SKILL_POSITIONS.has(p.position) ? playerClick(team, p.full_name, `${summaryHeadshot(team, p.full_name, 22)}<span class="gs-inj-name">${shortName(p.full_name)} <span class="muted">${p.position}</span></span>`) : `${summaryHeadshot(team, p.full_name, 22)}<span class="gs-inj-name">${shortName(p.full_name)} <span class="muted">${p.position}</span></span>`}<span class="gs-inj-status ${statusClass(p.status)}">${p.abbr === "Questionable" ? "Q" : p.abbr}</span></span>`)
    .join("");
  const more = starters.length > shown.length ? `<span class="gs-inj-more">+${starters.length - shown.length}</span>` : "";
  return `<span class="gs-inj-list">${chips || `<span class="gs-none">No starters listed</span>`}${more}</span>`;
}

// ---- Pick Tracker rail (same saved picks as the full page) ----
let gsDraft = {};
function gsPickMarket(game, m) {
  const pick = getPick(game.game_id, m.key);
  const sides = marketSides(game, m.key);
  if (!sides.every((s) => s.available)) {
    return `<div class="gs-pick"><div class="gs-pick-label">${m.label}</div><div class="gs-none">Not posted</div></div>`;
  }
  const chosen = pick ? pick.side : gsDraft[m.key];
  const color = pick ? pick.color : null;
  const sideBtns = sides
    .map((s) => {
      const on = chosen === s.side;
      const odds = m.key === "moneyline" ? "" : ` <span class="gs-price">${fmtOddsSigned(s.odds)}</span>`;
      return `<button type="button" class="gs-pick-side${on ? ` gs-on${color ? ` pick-color-${color}` : " gs-pending"}` : ""}" data-market="${m.key}" data-side="${s.side}">${s.label}${odds}</button>`;
    })
    .join("");
  const colorBtns = COLORS.map((c) => `<button type="button" class="gs-pick-color pick-color-${c.key}${color === c.key ? " gs-on" : ""}" data-market="${m.key}" data-color="${c.key}">${c.label}</button>`).join("");
  const result = pick && pick.graded ? `<span class="pick-result pick-result-${pick.graded}">${pick.graded.toUpperCase()}</span>` : "";
  return `<div class="gs-pick${pick ? " gs-pick-set" : ""}">
    <div class="gs-pick-label">${m.label} ${result}</div>
    <div class="gs-pick-sides">${sideBtns}</div>
    <div class="gs-pick-colors">${colorBtns}</div>
  </div>`;
}
// My Picks: one strip across the bottom of the card, the three markets side
// by side (the Novig QR block is off the card for now, user 2026-10-10).
function gsPickStrip(game) {
  regradeAllPicks(DATA.schedule);
  return `<section class="sc-section g2-sec g2-picks">
    <div class="sc-section-title">My Picks</div>
    ${MARKETS.map((m) => gsPickMarket(game, m)).join("")}
  </section>`;
}

function renderGameSummaryCard(game) {
  const card = document.getElementById("summary-card");
  if (!card || !game) return;
  const { away, home } = game;
  const when = game.date ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  const railHidden = summaryRailHidden("game");
  syncSummaryRailButton("game", "My Picks");
  card.dataset.kind = "game";
  card.dataset.away = away;
  card.dataset.home = home;
  card.innerHTML = `<div class="sc-inner gs-card sc-grow${railHidden ? " sc-no-rail" : ""}">
    <div class="sc-header">
      <div class="sc-title-row">
        <img src="${teamLogoUrl(away)}" crossorigin="anonymous" class="sc-logo" alt="">
        <div class="sc-matchup">${TEAM_NAMES[away] || away} <span class="sc-at">@</span> ${TEAM_NAMES[home] || home}</div>
        <img src="${teamLogoUrl(home)}" crossorigin="anonymous" class="sc-logo" alt="">
      </div>
      <div class="sc-meta">Week ${game.week}${when ? ` &middot; ${when}` : ""}${game.time ? ` &middot; ${fmtGameTime(game.time)}` : ""} &middot; ${away} ${teamCurrentRecord(away)} &middot; ${home} ${teamCurrentRecord(home)}${statsMode === "adj" ? ` &middot; <span class="gs-adj-badge">Stats vs opponents</span>` : ""}</div>
      <div class="sc-brand"><span class="brand-mark">GMG</span><span class="sc-brand-name">Game Summary</span></div>
    </div>
    <div class="sc-body">
      <div class="sc-main">
        <section class="sc-section g2-sec g2-line-sec"><div class="sc-section-title">The Line</div>${gsLineStrip(game)}</section>
        <div class="g2-teams">${gsTeamPanel(away, game.week)}${gsTeamPanel(home, game.week)}</div>
        <section class="sc-section g2-sec gs-matchups"><div class="sc-section-title">The Matchups</div>
          <div class="sc-cols">${gsMatchupColumn(away, home)}${gsMatchupColumn(home, away)}</div>
        </section>
        <section class="sc-section g2-sec g2-keys"><div class="sc-section-title">Keys</div>${gsKeys(game)}</section>
        ${railHidden ? "" : gsPickStrip(game)}
      </div>
    </div>
    <div class="sc-footer g2-footer">
      <span>Grades A-F vs the league &middot; under each grade: the stats behind it, offense | what the defense allows</span>
      <span><span class="g2-key g2-key-mismatch"></span> favors the offense <span class="g2-key g2-key-tough"></span> favors the defense <span class="g2-key g2-key-strong"></span> strength vs strength</span>
    </div>
  </div>`;
  fitWideSummaryCard();
  card.querySelectorAll("img").forEach((img) => img.addEventListener("load", fitWideSummaryCard, { once: true }));
}

// Pick clicks: a side, then a confidence saves it; clicking the chosen side
// again clears it; changing either on a saved pick updates it in place.
document.addEventListener("click", (e) => {
  if (!e.target.closest("#summary-rail-btn")) return;
  setSummaryRailHidden("game", !summaryRailHidden("game"));
  const game = currentGame();
  if (game) renderGameSummaryCard(game);
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#summary-card .gs-pick-side, #summary-card .gs-pick-color");
  if (!btn) return;
  const game = currentGame();
  if (!game) return;
  const market = btn.dataset.market;
  const existing = getPick(game.game_id, market);
  const save = (side, color) => {
    const sideInfo = marketSides(game, market).find((s) => s.side === side);
    upsertPick({
      game_id: game.game_id,
      season: DATA.requested_season,
      week: game.week,
      away: game.away,
      home: game.home,
      market,
      side,
      line_at_pick: sideInfo.line,
      odds_at_pick: sideInfo.odds,
      color,
      created_at: existing ? existing.created_at : new Date().toISOString(),
    });
  };
  if (btn.dataset.side) {
    const side = btn.dataset.side;
    if (existing && existing.side === side) deletePick(game.game_id, market);
    else if (existing) save(side, existing.color);
    else gsDraft[market] = gsDraft[market] === side ? undefined : side;
  } else {
    const side = existing ? existing.side : gsDraft[market];
    if (!side) return;
    save(side, btn.dataset.color);
    delete gsDraft[market];
  }
  renderGameSummaryCard(game);
});

// ---- Raw / vs Opponents stats toggle ----
// Swaps DATA.team_stats for a copy with the opponent-adjusted numbers
// (build_stats.py compute_opponent_adjusted_stats) laid over the raw ones,
// so every table, color, grade, tag and the Summary card follow along.
const STATS_MODE_KEY = "nfl-tool.stats-mode.v1";
let statsMode = "raw";
function initStatsMode() {
  DATA.team_stats_raw = DATA.team_stats;
  const adj = DATA.team_stats_adj || {};
  DATA.team_stats_opp = {};
  Object.entries(DATA.team_stats_raw).forEach(([t, s]) => (DATA.team_stats_opp[t] = { ...s, ...(adj[t] || {}) }));
  try {
    statsMode = localStorage.getItem(STATS_MODE_KEY) || "raw";
  } catch (e) {
    // localStorage unavailable -- raw stats.
  }
  if (!DATA.team_stats_adj) statsMode = "raw";
  applyStatsMode();
}
function applyStatsMode() {
  DATA.team_stats = statsMode === "adj" ? DATA.team_stats_opp : DATA.team_stats_raw;
  document.querySelectorAll(".stats-mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === statsMode);
    b.disabled = !DATA.team_stats_adj;
  });
}
document.querySelectorAll(".stats-mode-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    statsMode = btn.dataset.mode;
    try {
      localStorage.setItem(STATS_MODE_KEY, statsMode);
    } catch (e) {
      // localStorage unavailable -- toggle just won't stick.
    }
    applyStatsMode();
    render();
  })
);

// ---- view toggle: Full Preview / Summary ----
function applyPreviewView(game) {
  const summary = gsView === "summary";
  document.querySelectorAll(".preview-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === gsView));
  const wrap = document.getElementById("section-game-summary");
  if (!game) {
    wrap.hidden = true;
    return;
  }
  SECTIONS.forEach((s) => {
    const el = document.getElementById(`section-${s}`);
    if (el && summary) el.hidden = true;
  });
  document.querySelectorAll("#game-flipper-bottom").forEach((el) => (el.hidden = summary));
  wrap.hidden = !summary;
  if (summary) {
    gsDraft = {};
    renderGameSummaryCard(game);
  }
}
document.querySelectorAll(".preview-view-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    gsView = btn.dataset.view;
    try {
      localStorage.setItem(GS_VIEW_KEY, gsView);
    } catch (e) {
      // localStorage unavailable -- toggle just won't stick.
    }
    render();
  })
);
