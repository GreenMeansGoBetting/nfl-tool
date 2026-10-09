// ---- Game Previews Summary: one screenshot-ready card per game ----
// Same 1160x980 card as the TD / Props summaries. Lines, each team's
// wins & losses vs the spread, graded matchups (with the biggest General
// Stats / Scheme edges under them), starters on the injury report, and a
// live Pick Tracker on the right that saves to the same picks as the full
// page and shows up in the saved image. Boxes and chips, no sentences.

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
function gsStatEdges(offTeam, defTeam) {
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
        label: r.label,
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
        label: `vs ${GS_SCHEME_SHORT[r.label] || r.label} <span class="gs-freq-tag" title="How often ${defTeam} shows this look">${Math.round(tend * 100)}%</span>`,
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
        off: `<span class="gs-val ${gsZClass(oe.z)}">${oe.grade} ${oe.score}</span>`,
        def: `<span class="gs-val ${gsZClass(de.z)}">${de.grade} ${de.score}</span>`,
        tag,
        weight: gsEdgeStrength(oe.z, de.z, tag),
      });
    });
  }
  return edges.sort((a, b) => b.weight - a.weight).slice(0, GS_EDGES_SHOWN);
}

function gsMatchupColumn(offTeam, defTeam) {
  const edges = gsStatEdges(offTeam, defTeam);
  const edgeRows = edges.length
    ? edges.map((e) => `<div class="gs-row gs-edge"><span class="gs-row-label">${e.label}</span>${e.off}<span class="gs-vs">vs</span>${e.def}${gsTagHtml(e.tag)}</div>`).join("")
    : `<div class="gs-none">No big stat edges</div>`;
  const head = (team, side) => {
    const rgb = teamAccentRgb(team);
    return `<span class="gs-head" style="background:rgba(${rgb.join(",")},0.35);border-bottom:3px solid rgb(${rgb.join(",")})">${teamLogoMini(team, 22)}<span>${side}</span></span>`;
  };
  return `<div class="sc-col gs-col">
    <div class="gs-row gs-head-row"><span></span>${head(offTeam, "OFF")}<span></span>${head(defTeam, "DEF")}<span></span></div>
    <div class="gs-rows">${gsGradeRows(offTeam, defTeam)}</div>
    <div class="gs-sub">Key stat edges</div>
    <div class="gs-rows">${edgeRows}</div>
  </div>`;
}

// ---- lines ----
function gsSigned(n) {
  if (n === null || n === undefined) return "--";
  if (n === 0) return "PK";
  return n > 0 ? `+${fmt(n, 1).replace(/\.0$/, "")}` : fmt(n, 1).replace(/\.0$/, "");
}
// Novig's main line and price first (pv), best-of-books when Novig has none.
function gsLines(game) {
  const { away, home } = game;
  const homeSpread = pv(game, "home_team_spread");
  const hasSpread = homeSpread !== null && homeSpread !== undefined;
  const fav = hasSpread ? (homeSpread <= 0 ? home : away) : null;
  const favLine = fav === home ? homeSpread : pv(game, "away_team_spread");
  const total = pv(game, "total_line");
  const ml = (team, odds, prob) => `<div class="gs-ml">${teamLogoMini(team, 16)}<b>${fmtOddsSigned(odds)}</b><span>${prob ? `${Math.round(prob * 100)}%` : ""}</span></div>`;
  return `<div class="gs-lines">
    <div class="gs-tile"><div class="gs-tile-label">Spread</div><div class="gs-tile-big">${fav ? `${teamLogoMini(fav, 20)} ${gsSigned(favLine)}` : "--"}</div></div>
    <div class="gs-tile"><div class="gs-tile-label">Total</div><div class="gs-tile-big">${total ? fmt(total, 1).replace(/\.0$/, "") : "--"}</div></div>
    <div class="gs-tile"><div class="gs-tile-label">Moneyline</div>${pv(game, "away_moneyline") !== null && pv(game, "away_moneyline") !== undefined ? ml(away, pv(game, "away_moneyline"), pv(game, "away_ml_implied_prob")) + ml(home, pv(game, "home_moneyline"), pv(game, "home_ml_implied_prob")) : `<div class="gs-tile-big">--</div>`}</div>
  </div>`;
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
function gsRatings(away, home) {
  const r = DATA.espn_ratings;
  if (!r || !r[away] || !r[home]) return "";
  const row = (team) => {
    const t = r[team];
    return `<div class="gs-rt-row"><span class="gs-res-team">${teamLogoMini(team, 18)} ${team}</span>${gsRatingTile(t.off_rating, t.off)}${gsRatingTile(t.def_rating, t.def)}${gsRatingTile(t.fpi_rating, t.fpi)}${gsSosTile(t.sos_rank)}</div>`;
  };
  return `<div class="gs-ratings"><div class="sc-section-title">Ratings</div>
    <div class="gs-rt-row gs-rt-head"><span></span><span title="ESPN FPI offense, 1-100 vs the league">Off</span><span title="ESPN FPI defense, 1-100 vs the league">Def</span><span title="ESPN FPI overall, 1-100 vs the league">FPI</span><span title="Strength of schedule so far (1st = toughest)">SOS</span></div>
    ${row(away)}${row(home)}
    <div class="gs-rt-note">1-100 vs the league (ESPN FPI) &middot; SOS 1st = toughest so far</div>
  </div>`;
}

// ---- wins & losses vs the spread ----
function gsResumeRow(team, week) {
  const games = resumeGamesFor(team, week).sort((a, b) => a.week - b.week);
  const s = resumeSummary(games);
  const chips = games.length
    ? games
        .map((g) => {
          const q = g.label[0] === "Q" ? "q" : g.label[0] === "B" ? "b" : g.label === "T" ? "n" : "n";
          const wl = g.margin > 0 ? "W" : g.margin < 0 ? "L" : "T";
          return `<span class="gs-res gs-res-${q} gs-res-${wl.toLowerCase()}" title="Wk ${g.week} ${g.isHome ? "vs" : "@"} ${g.opp} ${g.pf}-${g.pa} (${RESUME_LABELS[g.label]})">${teamLogoMini(g.opp, 16)}<b>${wl}</b></span>`;
        })
        .join("")
    : `<span class="gs-none">No games yet</span>`;
  return `<div class="gs-res-row">
    <span class="gs-res-team">${teamLogoMini(team, 20)} ${team}</span>
    <span class="gs-res-chips">${chips}</span>
    <span class="gs-res-recs"><span><span class="gs-res-lbl">SU</span> ${s.su}</span><span><span class="gs-res-lbl">ATS</span> ${s.ats}</span></span>
  </div>`;
}

// ---- key injuries: starters only ----
const GS_STATUS_RANK = { Out: 0, Doubtful: 1, DNP: 2, Questionable: 3, Limited: 4 };
function gsInjuries(team, week) {
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
  return `<div class="gs-inj-row"><span class="gs-res-team">${teamLogoMini(team, 18)} ${team}</span><span class="gs-inj-list">${chips || `<span class="gs-none">No starters listed</span>`}${more}</span></div>`;
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
function gsPickRail(game) {
  regradeAllPicks(DATA.schedule);
  return `<section class="sc-section sc-section-odds gs-picks">
    <div class="sc-section-title">Lines</div>
    ${gsLines(game)}
    ${gsRatings(game.away, game.home)}
    <div class="sc-section-title gs-picks-title">My Picks</div>
    ${MARKETS.map((m) => gsPickMarket(game, m)).join("")}
    <div class="gs-novig">
      <div class="gs-novig-head"><img src="novig-logo.jpg" alt="Novig" class="gs-novig-logo"><span>Odds provided by <b>Novig</b></span></div>
      <img src="novig-qr.png" alt="Scan to sign up for Novig" class="gs-novig-qr">
      <p class="gs-novig-offer">New users: deposit <b>$10</b>, get <b>$50</b> in trade credits with code <span class="gs-novig-code">GMGO</span></p>
    </div>
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
        <section class="sc-section gs-compact"><div class="sc-section-title">Key Injuries</div><div class="gs-two">${gsInjuries(away, game.week)}${gsInjuries(home, game.week)}</div></section>
        <div class="gs-top${railHidden ? " gs-top-3" : " gs-top-1"}">
          ${railHidden ? `<section class="sc-section gs-compact"><div class="sc-section-title">Lines</div>${gsLines(game)}</section>` : ""}
          <section class="sc-section gs-compact"><div class="sc-section-title">Wins &amp; Losses vs the Spread</div>${gsResumeRow(away, game.week)}${gsResumeRow(home, game.week)}</section>
          ${railHidden ? `<section class="sc-section gs-compact">${gsRatings(away, home)}</section>` : ""}
        </div>
        <section class="sc-section gs-matchups"><div class="sc-section-title">Matchups</div>
          <div class="sc-cols">${gsMatchupColumn(away, home)}${gsMatchupColumn(home, away)}</div>
        </section>
      </div>
      ${railHidden ? "" : gsPickRail(game)}
    </div>
    <div class="sc-footer">
      <span><span class="gs-res gs-res-q gs-res-w"><b>W</b></span> quality <span class="gs-res gs-res-n gs-res-w"><b>W</b></span> neutral <span class="gs-res gs-res-b gs-res-w"><b>W</b></span> bad (vs the spread) &middot; grades A-F vs the league</span>
      <span><span class="gs-val gs-good">green</span> good for that side &middot; <span class="gs-val gs-bad">red</span> bad &middot; Blitz / Box rows: offense's result vs the defense's result in that look, % = how often the defense shows it</span>
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
