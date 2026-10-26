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

// ---- Tonight's Edges and The Angles (the owner, 2026-10-26: "revamp the
// entire identities page in a way where a user can't possibly miss what the
// page is trying to say. establish the matchup the edges and the angles") ----
// An EDGE favors one team and always reads both sides:
//   season matchups: the offense's number and the other defense's allowed
//   number, called with the site's matchup rule (one side clearly pointing one
//   way, EDGE_Z league spreads, the other not pointing the other way past
//   EDGE_CONTRA, like common.js matchupCall);
//   types: tonight's opponent is a type this team plays far from normal against
//   (Matchup Extremes' colored points cell, EX_MIN_GP+ games);
//   schedule spots: the same for a spot the team is in tonight.
// An ANGLE favors no one: how OFTEN a team does something (pace, shot mix) is
// never good or bad, so Fits / Takes Away describe the game, not a winner.
const EDGE_Z = 0.6;
const EDGE_CONTRA = 0.3;
const EDGE_BIG = 1.0; // the two sides' average this far = Big Edge
// key, stat name on the proof line, how it prints, way (+1 offense wants it
// high, -1 low), headline when the offense has the edge, when the defense
// does, and for a zone's make rate the share it needs (the offense takes at
// least the league's usual share of its shots there).
const EDGE_ROWS = [
  ["ppp", "Pts / Possession", "ppp", 1, (o) => `${o} Should Score Efficiently`, (o, d) => `${d} Should Slow ${o} Down`],
  ["half_ppp", "Half-Court Pts / Poss", "ppp", 1, (o) => `${o} Scores In The Half Court`, (o, d) => `${d} Locks Up The Half Court`],
  ["trans_ppp", "Transition Pts / Poss", "ppp", 1, (o) => `${o} Scores In Transition`, (o, d) => `${d} Shuts Down ${o}'s Transition`],
  ["tov_rate", "Turnover Rate", "pct", -1, (o) => `${o} Takes Care Of The Ball`, (o, d) => `${d} Forces ${o} Turnovers`],
  ["steal_share", "TOs That Are Steals", "pct", -1, (o) => `${o} Avoids Live-Ball Steals`, (o, d) => `${d} Gets Steals`],
  ["oreb_rate", "Offensive Rebound %", "pct", 1, (o) => `${o} Wins The Offensive Glass`, (o, d) => `${d} Cleans The Defensive Glass`],
  ["fta_rate", "Free Throws / Shot", "pct", 1, (o) => `${o} Gets To The Line`, (o, d) => `${d} Keeps ${o} Off The Line`],
  ["rim_pct", "FG% At The Rim", "pct", 1, (o) => `${o} Finishes At The Rim`, (o, d) => `${d} Protects The Rim`, "rim_share"],
  ["short_pct", "FG% In The Paint", "pct", 1, (o) => `${o} Scores In The Paint`, (o, d) => `${d} Defends The Paint`, "short_share"],
  ["mid_pct", "Mid-Range FG%", "pct", 1, (o) => `${o} Hits Mid-Range Shots`, (o, d) => `${d} Defends The Mid-Range`, "mid_share"],
  ["corner3_pct", "Corner 3 FG%", "pct", 1, (o) => `${o} Hits Corner 3s`, (o, d) => `${d} Defends Corner 3s`, "corner3_share"],
  ["above3_pct", "Above-Break 3 FG%", "pct", 1, (o) => `${o} Hits Above-Break 3s`, (o, d) => `${d} Defends Above-Break 3s`, "above3_share"],
];
// How-often rows for The Angles: key, the offense does it a lot, the defense
// allows it a lot, the defense rarely allows it.
const ANGLE_ROWS = [
  ["pace", "Plays Fast", "Lets Teams Play Fast", "Slows Teams Down"],
  ["trans_freq", "Runs In Transition", "Gives Up Transition Chances", "Shuts Off Transition"],
  ["three_rate", "Lives Beyond The Arc", "Gives Up A Lot Of 3s", "Runs Teams Off The Line"],
  ["rim_share", "Attacks The Rim", "Gives Up The Rim", "Walls Off The Rim"],
  ["short_share", "Lives In The Paint", "Gives Up Paint Shots", "Takes Away The Paint"],
  ["mid_share", "Shoots Mid-Range", "Allows Mid-Range Shots", "Takes Away The Mid-Range"],
  ["corner3_share", "Hunts Corner 3s", "Gives Up Corner 3s", "Takes Away Corner 3s"],
  ["self_made", "Creates Off The Dribble", "Allows Pull-Ups", "Takes Away Pull-Ups"],
  ["catch", "Lives On Catch-And-Shoot", "Allows Catch-And-Shoot", "Takes Away Catch-And-Shoot"],
  ["assisted", "Moves The Ball", "Lets Teams Move The Ball", "Breaks Up Ball Movement"],
];

// "3rd Best" / "2nd Worst" among the teams with the number (1 = best for that
// unit); `words` renames the pair (the angles say Most / Fewest).
function rankWords(abbr, key, bestHigh, words = ["Best", "Worst"]) {
  const n = rank(abbr, key, bestHigh);
  const of = Object.values(block().teams).filter((s) => s[key] !== null && s[key] !== undefined).length;
  if (!n) return "";
  if (n === 1) return words[0];
  if (n === of) return words[1];
  return n <= of / 2 ? `${ordinal(n)} ${words[0]}` : `${ordinal(of + 1 - n)} ${words[1]}`;
}
const proofLine = (abbr, text) => `<div class="ed-proof">${logo(abbr, 16)}<span>${text}</span></div>`;
function edgeCard(headline, proof, size, kind) {
  const big = size >= EDGE_BIG ? '<span class="gs-tag gs-tag-mismatch">Big Edge</span>' : "";
  return { size, html: `<div class="ed-card"><div class="ed-head"><span class="ed-kind">${kind}</span>${big}</div><div class="ed-title">${headline}</div>${proof}</div>` };
}

// Season matchup edges for `off`'s offense against `de`'s defense: {team: [cards]}.
function seasonEdges(off, de) {
  const out = { [off]: [], [de]: [] };
  if (!stats(off) || !stats(de)) return out;
  const called = {};
  for (const [key, name, kind, way, offHead, defHead, shareKey] of EDGE_ROWS) {
    const oz = z(off, `off_${key}`);
    const dz = z(de, `def_${key}`);
    if (oz === null || dz === null) continue;
    if (shareKey && (z(off, `off_${shareKey}`) ?? -1) < 0) continue;
    const a = oz * way; // + = good for the offense
    const b = dz * way; // + = this defense allows a lot (good for the offense)
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    const dir = hi >= EDGE_Z && lo > -EDGE_CONTRA ? 1 : lo <= -EDGE_Z && hi < EDGE_CONTRA ? -1 : 0;
    if (!dir) continue;
    // Half-court scoring is most of all scoring: no second card the same way.
    if (key === "half_ppp" && called.ppp === dir) continue;
    // Transition scoring only helps a team that runs.
    if (key === "trans_ppp" && dir === 1 && (z(off, "off_trans_freq") ?? -1) < 0) continue;
    called[key] = dir;
    const o = stats(off)[`off_${key}`];
    const d = stats(de)[`def_${key}`];
    const proof = proofLine(off, `${off} Offense: <b>${fmt(o, kind)}</b> ${name} &middot; ${rankWords(off, `off_${key}`, way > 0)}`)
      + proofLine(de, `${de} Defense Allows: <b>${fmt(d, kind)}</b> &middot; ${rankWords(de, `def_${key}`, way < 0)}`)
      + `<div class="ed-proof ed-league">League Average: ${fmt((block().league[`off_${key}`] || {}).avg, kind)}</div>`;
    out[dir > 0 ? off : de].push(edgeCard(dir > 0 ? offHead(off, de) : defHead(off, de), proof, Math.abs(a + b) / 2, `${off} Offense Vs ${de} Defense`));
  }
  return out;
}

// Opponent-type and schedule-spot edges for team `t` (tonight's opponent `opp`).
// A type / spot card's size: the gap over its color line (6 points a 100).
function typeEdges(t, opp, g) {
  const out = { [t]: [], [opp]: [] };
  const ex = block().extremes;
  const num = (c) => `<b>${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}</b>`;
  if (ex && ex.teams[t]) {
    for (const type of ex.types.filter((x) => x.teams.includes(opp))) {
      const c = exCell(ex, t, type, EX_OUTCOMES[0]);
      if (!c || !c.far) continue;
      const good = c.good > 0;
      const head = type.side === "off"
        ? (good ? `${t} Defense Shuts Down ${type.label}` : `${t} Defense Leaks Vs ${type.label}`)
        : (good ? `${t} Offense Thrives Vs ${type.label}` : `${t} Offense Stalls Vs ${type.label}`);
      const proof = proofLine(opp, `${opp} Is One Of The ${type.label}`)
        + proofLine(t, `${t} Vs Them: ${num(c)} ${type.side === "off" ? "Pts Allowed" : "Pts Scored"} / 100 Beyond Its Normal (League-Adjusted) &middot; ${ex.teams[t][type.key].n} Games`);
      out[good ? t : opp].push(edgeCard(head, proof, Math.abs(c.gap) / 6, "Opponent Type"));
    }
  }
  const spots = block().spots;
  if (spots && spots.teams[t]) {
    const now = ((spots.tonight || {})[g.game_id] || {})[t] || [];
    for (const type of spots.types.filter((x) => now.includes(x.key))) {
      for (const o of SPOT_OUTCOMES.slice(0, 2)) {
        const c = exCell(spots, t, type, o);
        if (!c || !c.far) continue;
        const good = c.good > 0;
        const head = o[0] === "pts" ? (good ? `${t} Offense Thrives In This Spot` : `${t} Offense Sags In This Spot`) : (good ? `${t} Defense Steps Up In This Spot` : `${t} Defense Sags In This Spot`);
        const proof = proofLine(t, `${t} Tonight: ${type.label}`)
          + proofLine(t, `In This Spot: ${num(c)} ${o[0] === "pts" ? "Pts Scored" : "Pts Allowed"} / 100 Beyond Its Normal (League-Adjusted) &middot; ${spots.teams[t][type.key].n} Games`);
        out[good ? t : opp].push(edgeCard(head, proof, Math.abs(c.gap) / 6, "Schedule Spot"));
      }
    }
  }
  return out;
}

function edgesSection(g) {
  const a = g.away;
  const h = g.home;
  const all = { [a]: [], [h]: [] };
  for (const part of [seasonEdges(a, h), seasonEdges(h, a), typeEdges(a, h, g), typeEdges(h, a, g)]) {
    for (const t of [a, h]) all[t].push(...part[t]);
  }
  const col = (t, other) => {
    const cards = all[t].sort((x, y) => y.size - x.size);
    const n = cards.length;
    const lead = n > all[other].length ? " ed-lead" : "";
    return `<div class="nba-box ed-col">${banner(t)}<div class="ed-count${lead}"><b>${n}</b> Edge${n === 1 ? "" : "s"} For ${t}</div>${cards.map((c) => c.html).join("") || '<p class="no-data-note">No Clear Edges</p>'}</div>`;
  };
  return col(a, h) + col(h, a);
}

function anglesSection(g) {
  const rows = [];
  for (const [off, de] of [[g.away, g.home], [g.home, g.away]]) {
    if (!stats(off) || !stats(de)) continue;
    for (const [key, does, allows, rarely] of ANGLE_ROWS) {
      const oz = z(off, `off_${key}`);
      const dz = z(de, `def_${key}`);
      if (oz === null || dz === null || oz < FREQ_GAP) continue;
      const fits = dz >= FREQ_GAP;
      if (!fits && dz > -FREQ_GAP) continue;
      const words = ["Most", "Fewest"];
      rows.push({ size: oz + Math.abs(dz), html: `<div class="ed-angle"><span class="gs-tag ${fits ? "gs-tag-strong" : "gs-tag-weak"}">${fits ? "Fits" : "Takes Away"}</span>
        <span class="ed-angle-side">${logo(off, 18)}<b>${off}</b> ${does} <span class="ed-rank">${rankWords(off, `off_${key}`, true, words)}</span></span>
        <span class="ed-angle-side">${logo(de, 18)}<b>${de}</b> ${fits ? allows : rarely} <span class="ed-rank">${rankWords(de, `def_${key}`, true, ["Most Allowed", "Fewest Allowed"])}</span></span></div>` });
    }
  }
  rows.sort((x, y) => y.size - x.size);
  return `<div class="nba-box ed-angles">${rows.map((r) => r.html).join("") || '<p class="no-data-note">No Style Clashes Stand Out In This Game.</p>'}</div>`;
}

// ---- Matchup Extremes and Schedule Spots (extremes.js) ----
function extremesBox(abbr, opp) {
  const table = exTable(block().extremes, abbr, opp, false);
  return `<div class="nba-box">${banner(abbr)}${table || '<p class="no-data-note">No games on file.</p>'}</div>`;
}
function spotsBox(abbr, g) {
  const table = spotTable(block().spots, abbr, g.game_id, false);
  return `<div class="nba-box">${banner(abbr)}${table || '<p class="no-data-note">No games on file.</p>'}</div>`;
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
  el("id-edges").innerHTML = edgesSection(g);
  el("id-angles").innerHTML = anglesSection(g);
  el("id-extremes").innerHTML = extremesBox(g.away, g.home) + extremesBox(g.home, g.away);
  el("id-spots").innerHTML = spotsBox(g.away, g) + spotsBox(g.home, g);
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
