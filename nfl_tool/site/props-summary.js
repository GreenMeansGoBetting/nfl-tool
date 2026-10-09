// ---- Player Props Summary: one screenshot-ready card ----
// The card is directional, not a pick sheet: per section (Passing /
// Rushing / Receiving), each offense's and defense's strengths and
// weaknesses vs the league (opponent-adjusted ranks) and the market leans
// where they meet. Players only appear on the right, the lines YOU pick.
// (The projection engine below is kept for later but no longer drives
// anything on the card -- a few games is too little to trust it.)
//
// Same 1160x980 card as TD Data's Summary. Every posted prop line in the
// game gets a projection built from:
//   1. the player's own recent games (most recent weighted most),
//   2. volume left behind by teammates ruled Out this week,
//   3. what this defense allows to that position (opponent-adjusted,
//      DATA.prop_matchup_model from build_stats.py), including throw depth,
//   4. game script from the spread/total.
// Two or three games say a lot about a role (carries, targets) and much
// less about yards, so the projection starts from the line the books posted
// and moves toward what the data says by how many games back it up
// (PROP_STABILITY). That becomes a chance to clear the line, compared with
// the no-vig chance in the odds. Lines where the model and the odds disagree
// the most are listed per team in Passing / Rushing / Receiving, with
// the reasons behind each and the player's game-by-game results vs the line.

const PROP_RECENCY = 0.75; // each older game counts 75% of the one after it
const PROP_VOLUME_MATCHUP_POWER = 0.5; // defenses move volume less than efficiency
const PROP_RATE_MATCHUP_POWER = 0.75;
const PROP_VACATED_RETAIN = 0.85; // share of an Out player's volume that stays with teammates
const PROP_EDGE_MIN = 0.1;
// Share of the defense / script / injury adjustment kept on top of the
// line-anchored player baseline (the books price some of it already).
const PROP_CONTEXT_TRUST = 0.8; // model minus no-vig odds, to list a play
const PROP_EDGE_STRONG = 0.18;
// Games of data it takes before the data counts as much as the line
// itself: volume settles fast, yards slower, long plays/TDs/INTs slowest.
const PROP_STABILITY = {
  receiving_receptions: 3, receiving_yards: 4, receiving_longestReception: 5,
  rushing_attempts: 2, rushing_yards: 4, rushing_longestRush: 5, "rushing+receiving_yards": 4,
  passing_attempts: 3, passing_completions: 3, passing_yards: 4, passing_touchdowns: 6,
  passing_interceptions: 8, passing_longestCompletion: 6, "passing+rushing_yards": 4,
};

// Shrink a player's own rate toward the league with this many league-
// average attempts, so two games can't produce a 90% catch rate.
const PROP_RATE_PRIOR = { catch: 15, ypt: 25, ypc: 40, comp: 60, ypa: 80, td: 150, int: 200 };

// stat: game-log field(s) the bet settles on; section: card section.
const PROP_MARKETS = {
  passing_attempts: { section: "pass", label: "Pass Att", stat: (g) => g.pass_att, kind: "att", unit: "att" },
  passing_completions: { section: "pass", label: "Completions", stat: (g) => g.completions, kind: "comp", unit: "comp" },
  passing_yards: { section: "pass", label: "Pass Yds", stat: (g) => g.pass_yards, kind: "passyds", unit: "yds" },
  passing_touchdowns: { section: "pass", label: "Pass TDs", stat: (g) => g.pass_td, kind: "poisson", unit: "TD" },
  passing_interceptions: { section: "pass", label: "INTs", stat: (g) => g.interceptions, kind: "poisson", unit: "INT" },
  passing_longestCompletion: { section: "pass", label: "Long Comp", stat: (g) => g.longest_pass, kind: "long", unit: "long" },
  "passing+rushing_yards": { section: "pass", label: "Pass+Rush Yds", stat: (g) => g.pass_yards + g.rush_yards, kind: "combo", unit: "yds" },
  rushing_attempts: { section: "rush", label: "Rush Att", stat: (g) => g.carries, kind: "car", unit: "car" },
  rushing_yards: { section: "rush", label: "Rush Yds", stat: (g) => g.rush_yards, kind: "rushyds", unit: "yds" },
  rushing_longestRush: { section: "rush", label: "Long Rush", stat: (g) => g.longest_rush, kind: "long", unit: "long" },
  "rushing+receiving_yards": { section: null, label: "Rush+Rec Yds", stat: (g) => g.rush_yards + g.rec_yards, kind: "combo", unit: "yds" },
  receiving_receptions: { section: "rec", label: "Receptions", stat: (g) => g.receptions, kind: "rec", unit: "rec" },
  receiving_yards: { section: "rec", label: "Rec Yds", stat: (g) => g.rec_yards, kind: "recyds", unit: "yds" },
  receiving_longestReception: { section: "rec", label: "Long Rec", stat: (g) => g.longest_rec, kind: "long", unit: "long" },
  kicking_points: { section: "other", label: "Kicking Pts", stat: () => 0, kind: "none", unit: "pts" },
  field_goals_made: { section: "other", label: "FGs Made", stat: () => 0, kind: "none", unit: "FG" },
  defense_tackles_assists: { section: "other", label: "Tackles + Ast", stat: () => 0, kind: "none", unit: "tkl" },
};

// ---- small math helpers ----
function propNormCdf(z) {
  // Abramowitz-Stegun erf approximation, plenty for a betting estimate.
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
function propPoissonOver(mean, line) {
  let p = Math.exp(-mean);
  let cdf = p;
  for (let k = 1; k <= Math.floor(line); k++) {
    p *= mean / k;
    cdf += p;
  }
  return 1 - cdf;
}
// Poisson mean whose chance of going over the line matches pOver.
function propPoissonMeanFor(line, pOver) {
  let lo = 0.01;
  let hi = 12;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (propPoissonOver(mid, line) < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function propNormInv(p) {
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (propNormCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function propImplied(odds) {
  if (odds === null || odds === undefined) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}
function propNoVigOver(overOdds, underOdds) {
  const o = propImplied(overOdds);
  const u = propImplied(underOdds);
  if (o !== null && u !== null) return o / (o + u);
  if (o !== null) return o - 0.025;
  if (u !== null) return 1 - (u - 0.025);
  return null;
}
const propClamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Games carry their own weight (g.w) once propBaselineGames has looked
// at snaps; otherwise plain recency.
function propWeightedMean(games, fn) {
  let s = 0;
  let w = 0;
  games.forEach((g, i) => {
    const wt = g.w !== undefined ? g.w : Math.pow(PROP_RECENCY, i);
    s += fn(g) * wt;
    w += wt;
  });
  return w ? s / w : 0;
}
const propSum = (games, fn) => games.reduce((s, g) => s + fn(g), 0);

// ---- data lookups ----
function propModel() {
  return DATA.prop_matchup_model || { league: {}, teams: {} };
}
// Defense factor vs league (1 = average), and the pieces for a tag.
function propDef(defTeam, metric) {
  const m = propModel();
  const cell = ((m.teams[defTeam] || {}).def || {})[metric];
  const lg = m.league[metric];
  if (!cell || !lg) return { f: 1, raw: null, rk: null };
  return { f: cell.v / lg, raw: cell.raw, rk: cell.rk };
}
function propGameLogs(team, name) {
  const byTeam = (DATA.player_game_logs || {})[team] || {};
  if (!propGameLogs.index) propGameLogs.index = {};
  if (!propGameLogs.index[team]) {
    propGameLogs.index[team] = {};
    Object.entries(byTeam).forEach(([n, logs]) => (propGameLogs.index[team][normName(n)] = { name: n, logs }));
  }
  return propGameLogs.index[team][normName(name)] || null;
}
function propPositions(team) {
  if (!propPositions.cache) propPositions.cache = {};
  if (!propPositions.cache[team]) {
    const map = {};
    ((DATA.player_props || {})[team] || []).forEach((p) => (map[normName(p.name)] = p.position));
    propPositions.cache[team] = map;
  }
  return propPositions.cache[team];
}
function propInjuries(team, week) {
  const byWeek = (DATA.injuries || {})[team] || {};
  const list = byWeek[week] || byWeek[String(week)] || [];
  const out = {};
  list.forEach((i) => {
    const r = (i.report_status || "").toLowerCase();
    const tag = /out|doubtful|reserve|injured|suspend/.test(r) ? "out" : r === "questionable" ? "Q" : null;
    if (tag) out[normName(i.full_name)] = { tag, name: i.full_name };
  });
  // On IR / released per the roster (never on the injury report).
  Object.values((DATA.roster_out || {})[team] || []).forEach((p) => (out[normName(p.name)] = { tag: "out", name: p.name, roster: p.status }));
  // Players you marked Out yourself (late news the injury report doesn't
  // have yet -- e.g. a QB benched the day of the game).
  loadManualOuts(week).forEach((k) => {
    const [t, n] = k.split("|");
    if (t === team) out[n] = { tag: "out", name: n, manual: true };
  });
  return out;
}

// ---- Manual Out: per week, "TEAM|normname" ----
const MANUAL_OUTS_KEY = "nfl-tool.manual-outs.v1";
function loadManualOuts(week) {
  try {
    return (JSON.parse(localStorage.getItem(MANUAL_OUTS_KEY)) || {})[week] || [];
  } catch (e) {
    return [];
  }
}
function toggleManualOut(week, team, name) {
  try {
    const all = JSON.parse(localStorage.getItem(MANUAL_OUTS_KEY)) || {};
    const list = new Set(all[week] || []);
    const key = `${team}|${normName(name)}`;
    if (list.has(key)) list.delete(key);
    else list.add(key);
    all[week] = [...list];
    localStorage.setItem(MANUAL_OUTS_KEY, JSON.stringify(all));
    window.NFLSync?.push(MANUAL_OUTS_KEY, all);
  } catch (e) {
    // localStorage unavailable -- the switch just won't stick.
  }
}
function propGame(away, home) {
  return (DATA.schedule || []).find((g) => g.away === away && g.home === home && g.status !== "final")
    || (DATA.schedule || []).find((g) => g.away === away && g.home === home);
}

// Games that count toward a player's baseline, newest first: any game
// with a touch (QBs: 10+ attempts, so a mop-up cameo doesn't count).
function propPlayerGames(logs, isQb) {
  return logs
    .filter((g) => (isQb ? g.pass_att >= 10 : g.targets + g.carries > 0))
    .slice()
    .sort((a, b) => b.week - a.week);
}

// ---- Snap counts: games that don't reflect this week's role ----
// A game the player left early (snap share well under his normal) is
// dropped from his baseline and hit rate. A game a regular teammate who's
// healthy THIS week sat out (WR1 missed week 2, WR2 soaked up his targets)
// is scaled back: the targets (RBs: carries) that regular usually gets were
// spread over whoever played, so this player's cut of them comes off that
// game before it goes into his baseline (and the game counts a bit less).
const PROP_PARTIAL_SNAP_RATIO = 0.6; // under 60% of his usual share = left early / limited
const PROP_REGULAR_SNAP = 0.5; // teammates averaging 50%+ of snaps are "regulars"
const PROP_LINEUP_WEIGHT = 0.7; // weight of a game a returning regular missed
const PROP_VOLUME_FIELDS = ["targets", "receptions", "rec_yards", "carries", "rush_yards"];

function propSnapIndex(team) {
  if (!propSnapIndex.cache) propSnapIndex.cache = {};
  if (!propSnapIndex.cache[team]) {
    const map = {};
    Object.entries((DATA.player_snaps || {})[team] || {}).forEach(([n, v]) => (map[normName(n)] = { ...v, name: n }));
    propSnapIndex.cache[team] = map;
  }
  return propSnapIndex.cache[team];
}
function propMedian(xs) {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

// This player's games (newest first) with a weight each, plus flags:
// partial (snap share), missing (returning regulars who sat that game).
function propBaselineGames(team, name, position, isQb, week) {
  const found = propGameLogs(team, name);
  if (!found) return [];
  const games = propPlayerGames(found.logs, isQb).map((g) => ({ ...g }));
  const snapsIdx = propSnapIndex(team);
  const mine = snapsIdx[normName(name)] || snapsIdx[normName(found.name)];
  if (mine) {
    games.forEach((g) => (g.snap = mine.w[g.week] ?? null));
    games.forEach((g) => {
      const others = games.filter((o) => o !== g && o.snap !== null).map((o) => o.snap);
      if (g.snap === null || !others.length) return;
      const usual = propMedian(others);
      if (usual >= 0.4 && g.snap < PROP_PARTIAL_SNAP_RATIO * usual) g.partial = true;
    });
  }
  const group = isQb ? [] : position === "RB" ? ["RB"] : ["WR", "TE"];
  const field = position === "RB" ? "carries" : "targets";
  const injuries = propInjuries(team, week);
  const teamLogs = (DATA.player_game_logs || {})[team] || {};
  const posOf = (n) => snapsIdx[normName(n)]?.pos || propPositions(team)[normName(n)];
  games.forEach((g) => (g.orig = { ...g }));
  Object.entries(snapsIdx).forEach(([key, t]) => {
    if (!group.includes(t.pos) || key === normName(name) || key === normName(found.name)) return;
    if (injuries[key]?.tag === "out") return; // handled as vacated volume instead
    const played = Object.values(t.w).filter((p) => p >= 0.15);
    if (!played.length || played.reduce((a, b) => a + b, 0) / played.length < PROP_REGULAR_SNAP) return;
    const theirLogs = propGameLogs(team, t.name);
    const usual = theirLogs ? propWeightedMean(propPlayerGames(theirLogs.logs, false), (g) => g[field]) : 0;
    games.forEach((g) => {
      // Missing = didn't play at all, or ruled Out that week. A backup who
      // barely played before a promotion isn't a "returning" regular.
      const snap = t.w[g.week];
      if (snap !== undefined && !(snap < 0.15 && propInjuries(team, g.week)[key]?.tag === "out")) return;
      (g.missing = g.missing || []).push(t.name);
      g.missingVol = (g.missingVol || 0) + usual;
    });
  });
  // Take this player's cut of the missing regulars' volume back out.
  games.forEach((g) => {
    if (!g.missingVol) return;
    const groupTotal = Object.entries(teamLogs).reduce((sum, [n, logs]) => {
      if (!group.includes(posOf(n))) return sum;
      const row = logs.find((l) => l.week === g.week);
      return sum + (row ? row[field] : 0);
    }, 0);
    if (!groupTotal) return;
    const scale = propClamp(1 - (PROP_VACATED_RETAIN * g.missingVol) / groupTotal, 0.5, 1);
    PROP_VOLUME_FIELDS.forEach((f) => (g[f] = g[f] * scale));
    g.scale = scale;
  });
  let any = false;
  games.forEach((g, i) => {
    g.w = Math.pow(PROP_RECENCY, i) * (g.partial ? 0 : 1) * (g.missing ? PROP_LINEUP_WEIGHT : 1);
    if (g.w > 0) any = true;
  });
  if (!any) games.forEach((g, i) => (g.w = Math.pow(PROP_RECENCY, i))); // every game flagged: nothing better to go on
  return games;
}

// Volume an Out teammate leaves behind, and this player's cut of it.
// Only counts the part not already in this player's recent games (if the
// injured player already missed those games, the player's numbers already
// show the bigger role). Same position gets 1.5x the pull.
function propVacated(team, week, name, position, field, eligible) {
  const injuries = propInjuries(team, week);
  const self = propGameLogs(team, name);
  if (!self) return { add: 0, names: [] };
  const selfGames = propPlayerGames(self.logs, false);
  if (!selfGames.length) return { add: 0, names: [] };
  const positions = propPositions(team);
  const byTeam = (DATA.player_game_logs || {})[team] || {};
  let add = 0;
  const names = [];
  Object.entries(byTeam).forEach(([otherName, logs]) => {
    const key = normName(otherName);
    if (!injuries[key] || injuries[key].tag !== "out" || key === normName(name)) return;
    const otherPos = positions[key];
    if (!eligible.includes(otherPos)) return;
    const otherGames = propPlayerGames(logs, false);
    const vol = propWeightedMean(otherGames, (g) => g[field]);
    if (vol < 1) return;
    const weeks = new Set(otherGames.map((g) => g.week));
    let overlap = 0;
    let wsum = 0;
    selfGames.forEach((g, i) => {
      const wt = Math.pow(PROP_RECENCY, i);
      wsum += wt;
      if (weeks.has(g.week)) overlap += wt;
    });
    const vacated = vol * (wsum ? overlap / wsum : 0);
    if (vacated < 0.5) return;
    // Split among healthy teammates by their own recent volume.
    let pool = 0;
    let mine = 0;
    Object.entries(byTeam).forEach(([n, l]) => {
      const k = normName(n);
      if (injuries[k]?.tag === "out" || !eligible.includes(positions[k])) return;
      const v = propWeightedMean(propPlayerGames(l, false).slice(0, 3), (g) => g[field]) * (positions[k] === otherPos ? 1.5 : 1);
      pool += v;
      if (k === normName(name)) mine = v;
    });
    if (!pool || !mine) return;
    add += vacated * (mine / pool) * PROP_VACATED_RETAIN;
    names.push(otherName);
  });
  return { add, names };
}

// Yards factor from where this receiver is targeted vs where the defense
// gives up yards: short (<10 air yards), intermediate (10-19), deep (20+).
function propDepthFactor(team, name, defTeam) {
  const zones = (((DATA.player_pass_zones || {})[team] || {})[name] || {}).zones;
  if (!zones) return { f: 1, depth: null };
  const n = { short: 0, int: 0, deep: 0 };
  Object.entries(zones).forEach(([k, z]) => {
    const d = k.startsWith("deep") ? "deep" : k.startsWith("intermediate") ? "int" : "short";
    n[d] += z.targets || 0;
  });
  const total = n.short + n.int + n.deep;
  if (total < 3) return { f: 1, depth: null };
  const lg = propModel().league;
  let num = 0;
  let den = 0;
  let best = null;
  ["short", "int", "deep"].forEach((d) => {
    const w = n[d] * (lg[`ypa_${d}`] || 1);
    const f = propDef(defTeam, `yds_${d}`).f;
    num += w * f;
    den += w;
    const pull = w * (f - 1);
    if (n[d] / total >= 0.2 && (!best || Math.abs(pull) > Math.abs(best.pull))) best = { d, pull, f, share: n[d] / total };
  });
  return { f: den ? num / den : 1, depth: best };
}

const PROP_DEPTH_LABEL = { short: "short", int: "10-19 air yd", deep: "20+ air yd" };
// Rank among 32 defenses in plain words: 1 = allows the most.
function propOrdinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}
function propRankWords(rk, rate = false) {
  if (!rk) return "";
  return rk <= 16 ? `${propOrdinal(rk)} ${rate ? "highest" : "most"}` : `${propOrdinal(33 - rk)} ${rate ? "lowest" : "fewest"}`;
}
function propRankText(rk, rate = false) {
  return rk ? `(${propRankWords(rk, rate)})` : "";
}

// ---- projection for one player (every market at once) ----
// neutral = the player's own numbers only (league-average defense, no
// script, no injury bumps) -- the part that 2-3 games can't be trusted on.
function propProjectPlayer(team, name, position, defTeam, week, game, neutral = false) {
  const D = neutral ? () => ({ f: 1, raw: null, rk: null }) : (metric) => propDef(defTeam, metric);
  const found = propGameLogs(team, name);
  if (!found) return null;
  const isQb = position === "QB";
  const games = propBaselineGames(team, name, position, isQb, week);
  if (!games.length) return null;
  const lg = propModel().league;
  const pos = ["WR", "TE", "RB"].includes(position) ? position : "WR";
  const spread = game ? (game.away === team ? game.away_team_spread : game.home_team_spread) : null;
  const fav = neutral || spread === null || spread === undefined ? 0 : -spread; // + = favored
  const total = neutral ? null : game?.total_line || null;
  const reasons = {}; // market group -> [{text, dir}] (dir +1 = pushes over)
  const note = (group, text, dir) => (reasons[group] = reasons[group] || []).push({ text, dir });
  const pw = (f, p) => Math.pow(f, p);
  const back = {};
  games.forEach((g) => (g.missing || []).forEach((n) => (back[n] = (back[n] || []).concat(g.week))));
  Object.entries(back).forEach(([n, wks]) => {
    const txt = `${shortName(n)} back (out wk ${wks.sort((a, b) => a - b).join(", ")})`;
    ["rec", "rush", "passvol"].forEach((gr) => note(gr, txt, -1));
  });

  // Script: favorites run more, underdogs throw more.
  const runScript = isQb ? 1 : propClamp(1 + 0.012 * fav, 0.88, 1.12);
  const passScript = propClamp(1 - 0.01 * fav, 0.9, 1.1);
  if (Math.abs(fav) >= 4) {
    const txt = fav > 0 ? `Fav ${-spread}: run script` : `Dog +${spread}: pass script`;
    note("rush", txt, fav > 0 ? 1 : -1);
    note("rec", txt, fav > 0 ? -1 : 1);
    note("pass", txt, fav > 0 ? -1 : 1);
  }

  const out = { games, name: found.name, position };

  // Receiving
  const tgtBase = propWeightedMean(games, (g) => g.targets);
  if (tgtBase > 0.5 && !isQb) {
    const vac = neutral ? { add: 0, names: [] } : propVacated(team, week, name, position, "targets", ["WR", "TE", "RB"]);
    const dT = D(`tgt_${pos}`);
    const tgt = (tgtBase + vac.add) * pw(dT.f, PROP_VOLUME_MATCHUP_POWER) * passScript;
    const T = propSum(games, (g) => g.targets);
    const catchLg = lg[`catch_${pos}`] || 0.65;
    const yptLg = lg[`ypt_${pos}`] || 8;
    const dC = D(`catch_${pos}`);
    const catchRate = ((propSum(games, (g) => g.receptions) + PROP_RATE_PRIOR.catch * catchLg) / (T + PROP_RATE_PRIOR.catch)) * pw(dC.f, PROP_RATE_MATCHUP_POWER);
    const ypt = (propSum(games, (g) => g.rec_yards) + PROP_RATE_PRIOR.ypt * yptLg) / (T + PROP_RATE_PRIOR.ypt);
    const dY = D(`recyds_${pos}`);
    const depth = neutral ? { f: 1, depth: null } : propDepthFactor(team, name, defTeam);
    const yptEff = ypt * pw(0.5 * dY.f + 0.5 * depth.f, PROP_RATE_MATCHUP_POWER);
    out.targets = tgt;
    out.receptions = tgt * propClamp(catchRate, 0.3, 0.95);
    out.recYds = tgt * yptEff;
    if (vac.add >= 0.8) note("rec", `${vac.names.map(shortName).join(", ")} OUT +${vac.add.toFixed(1)} tgt`, 1);
    if (Math.abs(dT.f - 1) >= 0.1) note("rec", `${defTeam} allows ${fmt(dT.raw, 1)} ${pos} tgt/g ${propRankText(dT.rk)}`, dT.f > 1 ? 1 : -1);
    if (Math.abs(dY.f - 1) >= 0.1) note("rec", `${defTeam} allows ${Math.round(dY.raw)} ${pos} yds/g ${propRankText(dY.rk)}`, dY.f > 1 ? 1 : -1);
    if (depth.depth && Math.abs(depth.depth.f - 1) >= 0.12) {
      const d = depth.depth.d;
      const dd = D(`yds_${d}`);
      note("rec", `${Math.round(depth.depth.share * 100)}% of tgts ${PROP_DEPTH_LABEL[d]}; ${defTeam} allows ${Math.round(dd.raw)} yds/g there ${propRankText(dd.rk)}`, depth.depth.f > 1 ? 1 : -1);
    }
    // Longest catch: chance at least one of ~N catches goes past the line,
    // each catch's yards falling off like the player's yards per catch.
    const dL = D("expl_pass");
    const yprLg = yptLg / catchLg;
    const ypr = (propSum(games, (g) => g.rec_yards) + 20 * yprLg) / (propSum(games, (g) => g.receptions) + 20);
    out.longRec = { lambda: out.receptions, a: 1, b: 0.85 * ypr * pw(dL.f, 0.3) };
    if (Math.abs(dL.f - 1) >= 0.15) note("long", `${defTeam} allows ${fmt(dL.raw, 1)} 20+ yd comp/g ${propRankText(dL.rk)}`, dL.f > 1 ? 1 : -1);
  }

  // Rushing
  const carBase = propWeightedMean(games, (g) => g.carries);
  if (carBase > 0.5) {
    const vac = isQb || neutral ? { add: 0, names: [] } : propVacated(team, week, name, position, "carries", ["RB"]);
    const rp = isQb ? "QB" : "RB";
    const dCar = D(`car_${rp}`);
    // Teams keep running when it works and bail when it doesn't: yards per
    // carry allowed moves carries too, not just the carries-allowed count
    // (which is mostly game script).
    const dYpcVol = D(`ypc_${rp}`);
    const car = (carBase + vac.add) * pw(dCar.f, PROP_VOLUME_MATCHUP_POWER) * pw(dYpcVol.f, 0.35) * runScript;
    const C = propSum(games, (g) => g.carries);
    const ypcLg = lg[`ypc_${rp}`] || 4.2;
    const ypc = (propSum(games, (g) => g.rush_yards) + PROP_RATE_PRIOR.ypc * ypcLg) / (C + PROP_RATE_PRIOR.ypc);
    const dYpc = D(`ypc_${rp}`);
    out.carries = car;
    // QBs: kneel-downs and sneaks make carries x league YPC meaningless --
    // their own rushing yards per game, nudged by what this defense allows
    // QBs, is the honest number.
    out.rushYds = isQb
      ? Math.max(0, propWeightedMean(games, (g) => g.rush_yards)) * pw(D("rushyds_QB").f, 0.5)
      : car * ypc * pw(dYpc.f, PROP_RATE_MATCHUP_POWER);
    if (vac.add >= 0.8) note("rush", `${vac.names.map(shortName).join(", ")} OUT +${vac.add.toFixed(1)} car`, 1);
    if (Math.abs(dCar.f - 1) >= 0.08) note("rush", `${defTeam} allows ${fmt(dCar.raw, 1)} ${rp} car/g ${propRankText(dCar.rk)}`, dCar.f > 1 ? 1 : -1);
    if (Math.abs(dYpc.f - 1) >= 0.08) note("rushyds", `${defTeam} allows ${fmt(dYpc.raw, 1)} ${rp} YPC ${propRankText(dYpc.rk, true)}`, dYpc.f > 1 ? 1 : -1);
    // Longest run: about 1 in 3 carries has a tail that falls off with
    // ~2x the player's YPC (fits the league's 10+ and 20+ yard run rates).
    const dL = D("expl_rush");
    out.longRush = { lambda: car, a: 0.35, b: 2.15 * ypc * pw(dL.f, 0.3) };
    if (Math.abs(dL.f - 1) >= 0.15) note("longrush", `${defTeam} allows ${fmt(dL.raw, 1)} 10+ yd runs/g ${propRankText(dL.rk)}`, dL.f > 1 ? 1 : -1);
  }

  // Passing
  if (isQb) {
    const attBase = propWeightedMean(games, (g) => g.pass_att);
    const A = propSum(games, (g) => g.pass_att);
    const dAtt = D("pass_att");
    const att = attBase * pw(dAtt.f, PROP_VOLUME_MATCHUP_POWER) * passScript;
    const rate = (num, prior, lgKey, fallback) => (num + prior * (lg[lgKey] || fallback)) / (A + prior);
    const dComp = D("comp");
    const dYpa = D("ypa");
    const dTd = D("td_rate");
    const dInt = D("int_rate");
    // Implied team points vs a league-average ~22 moves TD passes.
    const teamPts = total ? total / 2 + fav / 2 : 22;
    const pace = propClamp(Math.pow(teamPts / 22, 0.8), 0.75, 1.3);
    out.passAtt = att;
    out.completions = att * rate(propSum(games, (g) => g.completions), PROP_RATE_PRIOR.comp, "comp", 0.64) * pw(dComp.f, PROP_RATE_MATCHUP_POWER);
    out.passYds = att * rate(propSum(games, (g) => g.pass_yards), PROP_RATE_PRIOR.ypa, "ypa", 7) * pw(dYpa.f, PROP_RATE_MATCHUP_POWER);
    out.passTd = att * rate(propSum(games, (g) => g.pass_td), PROP_RATE_PRIOR.td, "td_rate", 0.045) * pw(dTd.f, PROP_RATE_MATCHUP_POWER) * pace;
    out.ints = att * rate(propSum(games, (g) => g.interceptions), PROP_RATE_PRIOR.int, "int_rate", 0.022) * pw(dInt.f, PROP_RATE_MATCHUP_POWER);
    const dL = D("expl_pass");
    const ypComp = (propSum(games, (g) => g.pass_yards) + 60 * ((lg.ypa || 7) / (lg.comp || 0.64))) / (propSum(games, (g) => g.completions) + 60);
    out.longPass = { lambda: out.completions, a: 1, b: 0.95 * ypComp * pw(dL.f, 0.3) };
    if (Math.abs(dAtt.f - 1) >= 0.06) note("passvol", `${defTeam} faces ${fmt(dAtt.raw, 1)} pass att/g ${propRankText(dAtt.rk)}`, dAtt.f > 1 ? 1 : -1);
    if (Math.abs(dYpa.f - 1) >= 0.06) note("pass", `${defTeam} allows ${fmt(dYpa.raw, 1)} YPA ${propRankText(dYpa.rk, true)}`, dYpa.f > 1 ? 1 : -1);
    if (Math.abs(dComp.f - 1) >= 0.04) note("comp", `${defTeam} allows ${Math.round(dComp.raw * 100)}% comp ${propRankText(dComp.rk, true)}`, dComp.f > 1 ? 1 : -1);
    if (Math.abs(dTd.f - 1) >= 0.15) note("td", `${defTeam} allows ${fmt(D("pass_td").raw, 1)} pass TD/g ${propRankText(D("pass_td").rk)}`, dTd.f > 1 ? 1 : -1);
    if (Math.abs(pace - 1) >= 0.08) note("td", `Team total ${teamPts.toFixed(1)}`, pace > 1 ? 1 : -1);
    if (Math.abs(dInt.f - 1) >= 0.2) note("int", `${defTeam} makes ${fmt(D("ints").raw, 1)} INT/g ${propRankText(D("ints").rk)}`, dInt.f > 1 ? 1 : -1);
    if (Math.abs(dL.f - 1) >= 0.15) note("long", `${defTeam} allows ${fmt(dL.raw, 1)} 20+ yd comp/g ${propRankText(dL.rk)}`, dL.f > 1 ? 1 : -1);
  }
  out.reasons = reasons;
  return out;
}

// Projection (mean), spread of outcomes around a given center, and which
// reason groups apply, for one market. Yards and longest-play markets are right-skewed, so the
// comparison point is a bit under the mean (closer to the median, which
// is what a line is set at).
function propMarketProjection(proj, marketKey) {
  const sdYds = (m, a, b) => a * m + b;
  switch (marketKey) {
    case "receiving_receptions":
      return proj.receptions === undefined ? null : { mean: proj.receptions, center: proj.receptions, sdFor: (c) => Math.max(1, Math.sqrt(c)), groups: ["rec"] };
    case "receiving_yards":
      return proj.recYds === undefined ? null : { mean: proj.recYds, center: proj.recYds * 0.93, sdFor: (c) => sdYds(c, 0.5, 6), groups: ["rec"] };
    case "receiving_longestReception":
      return proj.longRec === undefined ? null : { tail: proj.longRec, groups: ["long", "rec"] };
    case "rushing_attempts":
      return proj.carries === undefined ? null : { mean: proj.carries, center: proj.carries, sdFor: (c) => Math.max(2.2, 0.28 * c), groups: ["rush"] };
    case "rushing_yards":
      return proj.rushYds === undefined ? null : { mean: proj.rushYds, center: proj.rushYds * 0.95, sdFor: (c) => sdYds(c, 0.42, 6), groups: ["rush", "rushyds"] };
    case "rushing_longestRush":
      return proj.longRush === undefined ? null : { tail: proj.longRush, groups: ["longrush", "rush"] };
    case "rushing+receiving_yards": {
      if (proj.rushYds === undefined && proj.recYds === undefined) return null;
      const r = proj.rushYds || 0;
      const c = proj.recYds || 0;
      return { mean: r + c, center: (r + c) * 0.95, sdFor: (x) => sdYds(x, 0.45, 8), groups: ["rush", "rushyds", "rec"] };
    }
    case "passing_attempts":
      return proj.passAtt === undefined ? null : { mean: proj.passAtt, center: proj.passAtt, sdFor: (c) => Math.max(4, 0.16 * c), groups: ["passvol"] };
    case "passing_completions":
      return proj.completions === undefined ? null : { mean: proj.completions, center: proj.completions, sdFor: (c) => Math.max(3, 0.17 * c), groups: ["passvol", "comp"] };
    case "passing_yards":
      return proj.passYds === undefined ? null : { mean: proj.passYds, center: proj.passYds * 0.98, sdFor: (c) => sdYds(c, 0.18, 22), groups: ["passvol", "pass"] };
    case "passing_touchdowns":
      return proj.passTd === undefined ? null : { mean: proj.passTd, poisson: true, groups: ["td"] };
    case "passing_interceptions":
      return proj.ints === undefined ? null : { mean: proj.ints, poisson: true, groups: ["int"] };
    case "passing_longestCompletion":
      return proj.longPass === undefined ? null : { tail: proj.longPass, groups: ["long", "passvol"] };
    case "passing+rushing_yards": {
      if (proj.passYds === undefined) return null;
      const r = proj.rushYds || 0;
      return { mean: proj.passYds + r, center: proj.passYds * 0.98 + r * 0.9, sdFor: (c) => sdYds(c, 0.18, 24), groups: ["passvol", "pass", "rush"] };
    }
    default:
      return null;
  }
}

// Every posted line for one team, each with the model's view of it.
function propTeamLines(team, defTeam, week, game, withModel = false) {
  const markets = DATA.player_prop_markets || {};
  const labels = DATA.player_prop_market_labels || {};
  const injuries = propInjuries(team, week);
  const cache = {};
  const rows = [];
  Object.keys(PROP_MARKETS).forEach((marketKey) => {
    if (!labels[marketKey]) return;
    ((markets[marketKey] || {})[team] || []).forEach((line) => {
      const key = normName(line.name);
      const position = line.position || propPositions(team)[key] || null;
      if (withModel && !(key in cache)) {
        cache[key] = propProjectPlayer(team, line.name, position, defTeam, week, game);
        cache[key + "|n"] = propProjectPlayer(team, line.name, position, defTeam, week, game, true);
      }
      const proj = cache[key];
      const base = cache[key + "|n"];
      const def = PROP_MARKETS[marketKey];
      const section = def.section || (position === "RB" ? "rush" : "rec");
      const row = { team, name: line.name, position, marketKey, market: def.label, section, line: line.line, over: line.over_odds, under: line.under_odds, injury: injuries[key]?.tag || null, proj: null, source: line.source || "sgo", thin: !!line.thin };
      rows.push(row);
      if (!withModel) return;
      if (!proj || row.injury === "out") return;
      const mp = propMarketProjection(proj, marketKey);
      const mn = propMarketProjection(base, marketKey);
      if (!mp || !mn) return;
      const ctx = (full, neutral) => (neutral > 0 ? Math.pow(full / neutral, PROP_CONTEXT_TRUST) : 1);
      const mktOver = propNoVigOver(line.over_odds, line.under_odds);
      // Start from where the odds put this player, move toward the data.
      const w = proj.games.length / (proj.games.length + (PROP_STABILITY[marketKey] || 4));
      let pOver;
      let shown;
      if (mp.tail) {
        // Longest-play markets: P(longest > L) = 1 - exp(-lambda * a * e^(-L/b)).
        const tailP = (t) => 1 - Math.exp(-t.lambda * t.a * Math.exp(-line.line / t.b));
        const tailMedian = (t) => (t.lambda * t.a > Math.LN2 ? t.b * Math.log((t.lambda * t.a) / Math.LN2) : 0);
        const pN = tailP(mn.tail);
        const start = mktOver === null ? pN : mktOver + w * (pN - mktOver);
        pOver = propClamp(start + PROP_CONTEXT_TRUST * (tailP(mp.tail) - pN), 0.01, 0.99);
        shown = line.line + w * (tailMedian(mn.tail) - line.line) + PROP_CONTEXT_TRUST * (tailMedian(mp.tail) - tailMedian(mn.tail));
      } else if (mp.poisson) {
        const mktMean = mktOver === null ? mn.mean : propPoissonMeanFor(line.line, mktOver);
        shown = (mktMean + w * (mn.mean - mktMean)) * ctx(mp.mean, mn.mean);
        pOver = propPoissonOver(shown, line.line);
      } else {
        const sdAtLine = mp.sdFor(Math.max(line.line, 1));
        const mktCenter = mktOver === null ? line.line : line.line + sdAtLine * propNormInv(mktOver);
        const center = (mktCenter + w * (mn.center - mktCenter)) * ctx(mp.center, mn.center);
        pOver = 1 - propNormCdf((line.line - center) / mp.sdFor(center));
        shown = center;
      }
      const side = mktOver === null ? (pOver >= 0.5 ? "over" : "under") : pOver >= mktOver ? "over" : "under";
      // Games list keeps every game, flagged; hits and the average skip
      // games he left early.
      const games = proj.games.map((g) => ({ v: def.stat(g.orig || g), week: g.week, partial: !!g.partial, snap: g.snap, missing: g.missing || null }));
      const values = games.filter((g) => !g.partial).map((g) => g.v);
      const hits = values.filter((v) => (side === "over" ? v > line.line : v < line.line)).length;
      const dir = side === "over" ? 1 : -1;
      const reasons = mp.groups.flatMap((gr) => proj.reasons[gr] || []).filter((r) => r.dir === dir);
      const avg = values.reduce((x, y) => x + y, 0) / (values.length || 1);
      if (values.length && (side === "over" ? avg > line.line : avg < line.line)) {
        reasons.unshift({ text: `Avg ${fmt(avg, avg < 10 ? 1 : 0)} ${def.unit}`, dir });
      }
      Object.assign(row, {
        proj: shown,
        pOver,
        mktOver,
        side,
        edge: mktOver === null ? null : side === "over" ? pOver - mktOver : mktOver - pOver,
        odds: side === "over" ? line.over_odds : line.under_odds,
        values,
        games,
        hits,
        reasons: [...new Map(reasons.map((r) => [r.text, r])).values()],
      });
    });
  });
  return rows;
}

// "B. Robinson" is two different ATL backs -- fall back to the full name
// whenever two players on the same team shorten the same way.
function propDisplayName(rows, r) {
  const short = shortName(r.name);
  const clash = rows.some((o) => o.team === r.team && normName(o.name) !== normName(r.name) && shortName(o.name) === short);
  return clash ? r.name : short;
}

// Share of a receiver's targets at each depth (short <10 air yds, 10-19, 20+).
function propDepthShares(team, name) {
  const byTeam = (DATA.player_pass_zones || {})[team] || {};
  const logName = propGameLogs(team, name)?.name || name;
  const zones = (byTeam[logName] || byTeam[name] || {}).zones;
  if (!zones) return null;
  const n = { short: 0, int: 0, deep: 0 };
  Object.entries(zones).forEach(([k, z]) => {
    const d = k.startsWith("deep") ? "deep" : k.startsWith("intermediate") ? "int" : "short";
    n[d] += z.targets || 0;
  });
  const total = n.short + n.int + n.deep;
  return total >= 3 ? { short: n.short / total, int: n.int / total, deep: n.deep / total } : null;
}

// ---- Card rendering ----
// Clicking a player opens the shared player popup (player-props.js).
function propClickEntry(r) {
  const { away, home } = propsSummaryContext();
  return encodeDataAttr({ team: r.team, name: r.name, oppTeam: r.team === away ? home : away });
}
// ---- Target / Fade: players and packages with a good (or bad) matchup ----
// Each package is a position group and the betting markets it plays in
// (QB: Pass Yds / Completions / Pass Att / Pass TDs / Long Comp; RBs: Rush
// Att / Rush Yds / Long Rush; WRs: Rec Yds / Receptions / Long Rec ...).
// A market's lean averages, for each stat behind it, the offense's rank
// producing it and the other defense's rank allowing it (both opponent-
// adjusted in build_stats.py prop_matchup_model, where games against a
// backup QB or in bad weather already count much less for passing). A
// package shows when its markets lean the same way AND the betting market
// agrees -- Novig's implied team total, which already knows about QB
// changes, injuries and weather. INTs and sacks aren't used at all.
const f1 = (v) => fmt(v, 1);
const f0 = (v) => fmt(v, 0);
const PROP_PACKAGE_MIN = 0.3; // its strongest market's lean needed to list a package
const PROP_MARKET_MIN = 0.25; // a market's own lean needed to name it
const PROP_TT_BLOCK_LOW = 18.5; // no passing/receiving target at or under this implied total
const PROP_TT_BLOCK_HIGH = 25.5; // no passing/receiving fade at or over it
const PROP_DOG_BLOCK = 7; // no RB rushing target as a 7+ point underdog (fade as a 7+ favorite)
const PROP_TARGETS_SHOWN = 6;
const PROP_LONG_MARKETS = new Set(["passing_longestCompletion", "receiving_longestReception"]);
const PROP_FADES_SHOWN = 4;
const PROP_PACKAGES = [
  { pos: "QB", name: "QB", markets: [
    ["passing_yards", ["pass_yards"]], ["passing_completions", ["completions"]], ["passing_attempts", ["pass_att"]],
    ["passing_touchdowns", ["pass_td"]], ["passing_longestCompletion", ["expl_pass"]],
  ] },
  { pos: "QB", name: "QB rushing", markets: [["rushing_yards", ["rushyds_QB"]]] },
  { pos: "RB", name: "RBs", script: "run", markets: [["rushing_attempts", ["car_RB"]], ["rushing_yards", ["rushyds_RB"]], ["rushing_longestRush", ["expl_rush"]]] },
  { pos: "RB", name: "RBs receiving", markets: [["receiving_receptions", ["rec_RB"]], ["receiving_yards", ["recyds_RB"]]] },
  { pos: "WR", name: "WRs", markets: [["receiving_yards", ["recyds_WR"]], ["receiving_receptions", ["rec_WR"]], ["receiving_longestReception", ["expl_pass", "yds_deep"]]] },
  { pos: "TE", name: "TEs", markets: [["receiving_yards", ["recyds_TE"]], ["receiving_receptions", ["rec_TE"]]] },
];
// Short names for the reason tags.
const PROP_STAT_WORDS = {
  pass_yards: "pass yds", completions: "completions", pass_att: "pass att", pass_td: "pass TDs", expl_pass: "20+ yd plays",
  rushyds_QB: "QB rush yds", car_RB: "RB carries", rushyds_RB: "RB rush yds", expl_rush: "10+ yd runs",
  rec_RB: "RB catches", recyds_RB: "RB rec yds", recyds_WR: "WR yds", rec_WR: "WR catches", yds_deep: "deep yds",
  recyds_TE: "TE yds", rec_TE: "TE catches",
};

// Rank 1 (most) -> +1, rank 32 (fewest) -> -1.
function propRankLean(rk) {
  return rk ? (16.5 - rk) / 15.5 : 0;
}
function propSide(team, side, metric) {
  const cell = ((propModel().teams[team] || {})[side] || {})[metric];
  return cell ? { raw: cell.raw, rk: cell.rk, lean: propRankLean(cell.rk), gt: cell.gt } : null;
}
// A Target's reason stat gets a neutral "garbage time" tag when this much
// of it came with the offense under 10% to win (league average ~12%).
// Information only: a team that keeps building big leads may keep facing
// comeback throwing, so the spread decides how much it matters.
const PROP_GARBAGE_TAG = 0.3;
function propGarbageTag(team, side, part) {
  const cell = side === "off" ? part.o : part.d;
  if (!(cell.gt >= PROP_GARBAGE_TAG)) return null;
  const pct = Math.round(cell.gt * 100);
  const med = (propModel().gt_median || {})[part.m];
  const who = side === "off" ? team : `${team} D`;
  const stat = PROP_STAT_WORDS[part.m];
  return {
    text: `${who} ${pct}% garbage time`,
    garbage: true,
    team,
    side,
    m: part.m,
    title: `${pct}% of the ${stat} ${side === "off" ? `${team} produced` : `${team} allowed`} came with the offense under 10% to win${med !== undefined ? ` (league average: ${Math.round(med * 100)}%)` : ""}. Check the spread: a big favorite can force comeback throwing again.`,
  };
}
function propRankTag(rk) {
  return rk <= 16 ? `${propOrdinal(rk)}-most` : `${propOrdinal(33 - rk)}-fewest`;
}
// Novig's implied points for this team (Novig first, best-of-books fallback).
function propTeamTotal(game, team) {
  if (!game) return null;
  const g = { ...game, ...(game.novig || {}) };
  const spread = team === g.away ? g.away_team_spread : g.home_team_spread;
  if (!g.total_line || spread === null || spread === undefined) return null;
  return g.total_line / 2 - spread / 2;
}

function propPackages(offTeam, defTeam, game, lines) {
  const tt = propTeamTotal(game, offTeam);
  const g = game ? { ...game, ...(game.novig || {}) } : {};
  const spread = offTeam === g.away ? g.away_team_spread : g.home_team_spread;
  const fav = spread === null || spread === undefined ? 0 : -spread; // + = favored
  const out = [];
  PROP_PACKAGES.forEach((pkg) => {
    const markets = pkg.markets
      .map(([mk, metrics]) => {
        const parts = metrics.map((m) => ({ m, o: propSide(offTeam, "off", m), d: propSide(defTeam, "def", m) })).filter((x) => x.o && x.d);
        if (!parts.length) return null;
        const lean = parts.reduce((sum, x) => sum + (x.o.lean + x.d.lean) / 2, 0) / parts.length;
        return { mk, lean, parts };
      })
      .filter(Boolean);
    if (!markets.length) return;
    // Both sides of a market have to agree (common.js matchupCall's rule):
    // a market can't lean Target when the defense is among the stingiest
    // at it, or Fade when the offense is among the best -- an average of
    // the two would otherwise let one side hide the other.
    const clean = (m, dir) => m.parts.every((x) => x.o.lean * dir > -MATCHUP_CONTRA && x.d.lean * dir > -MATCHUP_CONTRA);
    // Each direction is judged on its own markets (audit 2026-10-02): the old
    // package-wide average let a strong Target market and a strong Fade market
    // cancel out (MIA vs MIN: Long Rec +0.81, Completions -0.81 -> nothing
    // shown). A package can now list a Target and a Fade on DIFFERENT markets.
    [1, -1].forEach((dir) => {
    // Long-play markets skip the low-implied-total block (user 2026-10-02,
    // MIA vs MIN): a low total means trailing, and trailing teams take more
    // deep shots; a leading defense sitting in a soft shell also gives up
    // catch-and-run long plays. Yards/receptions targets stay blocked.
    const lowBlock = dir > 0 && pkg.script !== "run" && tt !== null && tt <= PROP_TT_BLOCK_LOW;
    const allowed = (m) => !lowBlock || PROP_LONG_MARKETS.has(m.mk);
    const candidates = markets.filter((m) => Math.sign(m.lean) === dir && clean(m, dir) && allowed(m));
    if (!candidates.length) return;
    const top = candidates.slice().sort((a, b) => Math.abs(b.lean) - Math.abs(a.lean))[0];
    const best = Math.abs(top.lean);
    const lean = top.lean;
    if (best < PROP_PACKAGE_MIN) return;
    // The betting market has to agree. RB rushing follows game script (the
    // spread); everything else follows expected scoring (implied total).
    if (pkg.script === "run") {
      if (dir > 0 && fav <= -PROP_DOG_BLOCK) return;
      if (dir < 0 && fav >= PROP_DOG_BLOCK) return;
    } else if (tt !== null) {
      if (dir < 0 && tt >= PROP_TT_BLOCK_HIGH) return;
    }
    const shown = markets.filter((m) => Math.sign(m.lean) === dir && Math.abs(m.lean) >= PROP_MARKET_MIN && clean(m, dir) && allowed(m)).sort((a, b) => Math.abs(b.lean) - Math.abs(a.lean));
    if (!shown.length) return;
    // Reason tags: the defense stat and the offense stat that push hardest.
    const parts = shown.flatMap((m) => m.parts);
    const dPart = parts.slice().sort((a, b) => dir * (b.d.lean - a.d.lean))[0];
    const oPart = parts.slice().sort((a, b) => dir * (b.o.lean - a.o.lean))[0];
    // Offense first. q = how good the rank is for THAT unit (0 worst, 1
    // best): producing a lot is good for an offense, allowing a lot is bad
    // for a defense.
    const tags = [
      { text: `${offTeam} ${propRankTag(oPart.o.rk)} ${PROP_STAT_WORDS[oPart.m]}`, q: (32 - oPart.o.rk) / 31, team: offTeam, side: "off", m: oPart.m },
      { text: `${defTeam} D ${propRankTag(dPart.d.rk)} ${PROP_STAT_WORDS[dPart.m]}`, q: (dPart.d.rk - 1) / 31, team: defTeam, side: "def", m: dPart.m },
    ];
    // Garbage time only inflates big numbers, so only Targets get the tag.
    if (dir > 0) {
      [propGarbageTag(offTeam, "off", oPart), propGarbageTag(defTeam, "def", dPart)].forEach((t) => t && tags.push(t));
    }
    // Players in this package with a posted line: zone-flagged players
    // (Zone Targets says this market fits them) first with a star, then
    // the biggest line.
    const mainMk = shown[0].mk;
    const zoneFlags = {};
    if (["WR", "TE", "RB"].includes(pkg.pos) && pkg.name !== "RBs") {
      zoneTargets(offTeam, defTeam, game ? game.week : DATA.current_week).forEach((z) => {
        if (z.markets.some((mk) => shown.some((m) => m.mk === mk))) zoneFlags[normName(z.name)] = true;
      });
    }
    const players = {};
    lines
      .filter((r) => r.position === pkg.pos && r.injury !== "out" && shown.some((m) => m.mk === r.marketKey))
      .forEach((r) => {
        const k = normName(r.name);
        const cur = players[k];
        const pri = r.marketKey === mainMk ? 1 : 0;
        if (!cur || pri > cur.pri) players[k] = { r, pri };
      });
    // One QB (the starter has the biggest line), up to three others.
    const plist = Object.values(players)
      .map((x) => x.r)
      .map((r) => ({ ...r, zoneFlag: !!zoneFlags[normName(r.name)] }))
      .sort((a, b) => b.zoneFlag - a.zoneFlag || (b.marketKey === mainMk) - (a.marketKey === mainMk) || b.line - a.line)
      .slice(0, pkg.pos === "QB" ? 1 : 3);
    out.push({
      team: offTeam,
      name: pkg.name,
      markets: shown.map((m) => PROP_MARKETS[m.mk].label),
      lineMarket: PROP_MARKETS[mainMk].label,
      players: plist,
      tags,
      lean: 0.6 * best + 0.4 * Math.abs(lean),
      dir,
      tt,
    });
    });
  });
  return out;
}

// Red (worst) -> yellow (middle) -> green (best), stronger toward the ends.
function propRankShade(q) {
  const hue = Math.round(q * 120);
  const strength = Math.abs(q - 0.5) * 2; // 0 middle, 1 extreme
  return `background:hsla(${hue},75%,45%,${(0.14 + 0.26 * strength).toFixed(2)});border:1px solid hsla(${hue},75%,45%,${(0.35 + 0.5 * strength).toFixed(2)});color:hsl(${hue},80%,${Math.round(72 - 10 * strength)}%)`;
}
function propPackageHtml(p, lines) {
  const players = p.players.length
    ? p.players.map((r) => `<span class="ps-pk-player player-click" data-entry="${propClickEntry(r)}">${summaryHeadshot(r.team, r.name, 22)}${r.zoneFlag ? `<span class="ps-zone-star" title="Zone Targets: his looks land where this defense is soft">&#9733;</span>` : ""}${propDisplayName(lines, r)} <b>${fmt(r.line, 1)}</b></span>`).join("")
    : `<span class="ps-pk-noline">No lines posted yet</span>`;
  return `<div class="ps-pk">
    <div class="ps-pk-head">${teamLogoMini(p.team, 22)}<span class="ps-pk-name">${p.team} ${p.name}</span><span class="ps-pk-mkts">${p.markets.map((m) => `<span>${m}</span>`).join("")}</span></div>
    <div class="ps-pk-players">${p.players.length ? `<span class="ps-pk-for">${p.lineMarket}</span>` : ""}${players}</div>
    <div class="ps-pk-tags">${p.tags.map((t) => {
      const tag = `data-tag="${encodeDataAttr({ team: t.team, side: t.side, m: t.m })}"`;
      return t.garbage
        ? `<span class="ps-pk-gt ps-tag-click" ${tag} title="${t.title.replace(/"/g, "&quot;")} Click for every game.">${t.text}</span>`
        : `<span class="ps-tag-click" ${tag} style="${propRankShade(t.q)}" title="Click for every game behind this">${t.text}</span>`;
    }).join("")}</div>
  </div>`;
}

// ---- Right rail: prop lines YOU pick, with O/U checkboxes into
// Possible Plays (same ids as the props odds modal, so checks match). ----
const PROPS_SUMMARY_MAX_PICKS = 10;
const PROPS_SUMMARY_PICKS_KEY = "nfl-tool.props-summary-picks.v1";
function propPickKey(r) {
  return `${r.marketKey}|${normName(r.name)}`;
}
function loadPropsSummaryPicks(gameKey) {
  try {
    return (JSON.parse(localStorage.getItem(PROPS_SUMMARY_PICKS_KEY)) || {})[gameKey] || {};
  } catch (e) {
    return {};
  }
}
function savePropsSummaryPicks(gameKey, picks) {
  try {
    const all = JSON.parse(localStorage.getItem(PROPS_SUMMARY_PICKS_KEY)) || {};
    all[gameKey] = picks;
    localStorage.setItem(PROPS_SUMMARY_PICKS_KEY, JSON.stringify(all));
    window.NFLSync?.push(PROPS_SUMMARY_PICKS_KEY, all);
  } catch (e) {
    // localStorage unavailable -- picks just won't stick across reloads.
  }
}
function propsSummaryContext() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const game = propGame(away, home);
  const week = game ? game.week : DATA.current_week;
  return { away, home, game, week, gameKey: `${week}_${away}_${home}` };
}
function propSideButton(r, side) {
  const { over, under } = propOuEntries(r.marketKey, (DATA.player_prop_market_labels || {})[r.marketKey] || r.market, r.team, r.name, r.line, r.over, r.under, `${propsSummaryContext().away} @ ${propsSummaryContext().home}`);
  const entry = side === "over" ? over : under;
  const odds = side === "over" ? r.over : r.under;
  if (odds === null || odds === undefined) return `<span class="muted">--</span>`;
  const on = isPossiblePlay(entry.id);
  return `<button type="button" class="sc-pp${on ? " sc-pp-on" : ""}" data-entry="${encodeDataAttr(entry)}" title="Add to Possible Plays"><span class="sc-pp-box">${on ? "&#10003;" : ""}</span>${side === "over" ? "O" : "U"} ${fmtOddsSigned(odds)}</button>`;
}
function propsRail(away, home, linesByTeam, gameKey) {
  const picks = loadPropsSummaryPicks(gameKey);
  const block = (team) => {
    const chosen = new Set(picks[team] || []);
    const rows = linesByTeam[team]
      .filter((r) => chosen.has(propPickKey(r)) && r.injury !== "out")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (r) =>
          `<tr><td class="ps-rail-who"><span class="sc-player player-click" data-entry="${propClickEntry(r)}" title="Game log, odds, add to summary">${summaryHeadshot(team, r.name, 32)}<span class="ps-rail-name">${propDisplayName(linesByTeam[team], r)}</span></span></td><td class="ps-rail-mid"><span>${r.market}</span><b>${fmt(r.line, 1)}</b></td><td class="num"><div class="ps-rail-btns">${propSideButton(r, "over")}${propSideButton(r, "under")}</div></td></tr>`
      )
      .join("");
    const rgb = teamAccentRgb(team);
    return `<div class="sc-odds-team" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})">
        <img src="${teamLogoUrl(team)}" crossorigin="anonymous" class="sc-team-logo" alt=""><span class="sc-ftd-team">${team}</span>
      </div>
      ${rows ? `<table class="sc-table sc-odds ps-rail"><tbody>${rows}</tbody></table>` : `<p class="sc-odds-empty">Click Prop Picks to add lines</p>`}`;
  };
  return `<section class="sc-section sc-section-odds">
    <button type="button" class="sc-section-title sc-odds-open ps-open" title="Pick which lines show here">Prop Picks</button>
    ${block(away)}
    ${block(home)}
  </section>`;
}

// ---- Tag popup: every game behind a tag ----
// Click a reason tag ("DAL D 1st-most QB rush yds") to see each game's
// number, the players who produced it, and what that opponent usually does
// in its other games -- so a schedule full of running QBs (or of bad
// offenses) shows up at a glance. Rows come from prop_matchup_model.games,
// the same per-game counts the rank is built from.
const PROP_STAT_LABELS = {
  pass_yards: "Passing yards", completions: "Completions", pass_att: "Pass attempts", pass_td: "Passing TDs",
  expl_pass: "20+ yd completions", rushyds_QB: "QB rushing yards", car_RB: "RB carries", rushyds_RB: "RB rushing yards",
  expl_rush: "10+ yd runs", rec_RB: "RB catches", recyds_RB: "RB receiving yards", recyds_WR: "WR receiving yards",
  rec_WR: "WR catches", yds_deep: "Deep (20+ air yd) passing yards", recyds_TE: "TE receiving yards", rec_TE: "TE catches",
};
// Passing stats are the ones bad weather / a backup QB weight down.
const PROP_TAG_PASSING = new Set(["pass_yards", "completions", "pass_att", "pass_td", "expl_pass", "rec_RB", "recyds_RB", "recyds_WR", "rec_WR", "yds_deep", "recyds_TE", "rec_TE"]);
// The players behind one game's number: [sort value, text] per player.
function propTagPlayers(m, players) {
  const recPos = { rec_RB: "RB", recyds_RB: "RB", rec_WR: "WR", recyds_WR: "WR", rec_TE: "TE", recyds_TE: "TE" }[m];
  const out = [];
  players.forEach((p) => {
    const [att, cmp, pyd, ptd] = p.pass || [];
    const [tgt, rec, ryd, n20, dyd, datt] = p.rec || [];
    const [car, ruyd, n10] = p.rush || [];
    if (["pass_yards", "completions", "pass_att", "pass_td"].includes(m) && p.pass && (p.pos === "QB" || att >= 5)) {
      const key = { pass_yards: pyd, completions: cmp, pass_att: att, pass_td: ptd }[m];
      out.push([key, p, `${cmp}/${att}, ${pyd} yds${ptd ? `, ${ptd} TD` : ""}`]);
    } else if (recPos && p.pos === recPos && p.rec) {
      out.push([m.startsWith("rec_") ? rec : ryd, p, `${rec}-${ryd} (${tgt} tgt)`]);
    } else if (m === "expl_pass" && n20) {
      out.push([n20, p, `${n20} catch${n20 > 1 ? "es" : ""} of 20+`]);
    } else if (m === "yds_deep" && datt) {
      out.push([dyd, p, `${dyd} yds on ${datt} deep tgt`]);
    } else if ((m === "rushyds_QB" && p.pos === "QB") || ((m === "car_RB" || m === "rushyds_RB") && p.pos === "RB")) {
      if (p.rush) out.push([m === "car_RB" ? car : ruyd, p, `${car}-${ruyd}`]);
    } else if (m === "expl_rush" && n10) {
      out.push([n10, p, `${n10} run${n10 > 1 ? "s" : ""} of 10+`]);
    }
  });
  return out.sort((a, b) => b[0] - a[0]).filter((x) => x[0] > 0 || out.length === 1).slice(0, 4);
}
// Whose players the "who" column lists, by stat.
const PROP_TAG_GROUP = {
  pass_yards: "QB", completions: "QB", pass_att: "QB", pass_td: "QB", rushyds_QB: "QBs",
  car_RB: "RBs", rushyds_RB: "RBs", rec_RB: "RBs", recyds_RB: "RBs", expl_rush: "runners",
  rec_WR: "WRs", recyds_WR: "WRs", rec_TE: "TEs", recyds_TE: "TEs", expl_pass: "pass catchers", yds_deep: "pass catchers",
};
function propTagAvg(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}
function renderPropTagModal(team, side, m, next = null) {
  const model = propModel();
  const games = (model.games || []).filter((g) => g[side] === team).sort((a, b) => a.wk - b.wk);
  const cell = ((model.teams[team] || {})[side] || {})[m];
  const label = PROP_STAT_LABELS[m] || PROP_STAT_WORDS[m] || m;
  const unit = side === "def" ? `${team} defense: ${label.toLowerCase()} allowed` : `${team} offense: ${label.toLowerCase()}`;
  const heading = `<h3 class="td-allowed-heading">${teamLogoMini(team, 24)} ${unit}</h3>`;
  if (!games.length || !cell) return `${heading}<p class="no-data-note">The game-by-game breakdown appears after the next data refresh.</p>`;
  const other = side === "def" ? "off" : "def";
  const L = model.league[m];
  const passing = PROP_TAG_PASSING.has(m);
  const dec = L !== undefined && L < 10 ? 1 : 0;
  const f = (v) => (v === null || v === undefined ? "--" : fmt(v, dec));
  // Opponent's usual = its average in its OTHER games (the same side of the ball it played here).
  const usualOf = (opp, gameId) => propTagAvg((model.games || []).filter((x) => x[other] === opp && x.g !== gameId).map((x) => x.v[m] || 0));
  // Up = more of the stat. Good for an offense, bad for a defense.
  const tone = (diff, base) => {
    if (diff === null || Math.abs(diff) < Math.max(0.1 * (base || 1), dec ? 0.3 : 3)) return "";
    return (diff > 0) === (side === "off") ? "ps-tm-good" : "ps-tm-bad";
  };
  const rows = games.map((g) => {
    const opp = g[other];
    const val = g.v[m] || 0;
    const usual = usualOf(opp, g.g);
    const diff = usual === null ? null : val - usual;
    const who = propTagPlayers(m, g.p || [])
      .map(([, p, txt]) => `<span class="ps-tm-player">${playerClick(g.off, p.n, shortName(p.n), g.def)} <b>${txt}</b></span>`)
      .join("");
    const flags = [];
    if (passing && g.wx) flags.push(`<span class="ps-tm-flag" title="Rain, snow or 15+ mph wind: counts 30% in the ranking">Weather</span>`);
    if (g.bq) flags.push(`<span class="ps-tm-flag" title="${g.off} didn't start its usual QB${passing && side === "def" ? ": counts 30% toward this defense's ranking" : ", so its usual number is from a different QB"}">${g.off} backup QB</span>`);
    const gt = (g.gt || {})[m];
    if (gt && val) flags.push(`<span class="ps-tm-flag" title="Part of this game's number that came with the offense under 10% to win">${Math.round((gt / val) * 100)}% garbage</span>`);
    return `<tr>
      <td class="num">${g.wk}</td>
      <td class="ps-tm-vs">vs ${teamLogoMini(opp, 16)} ${opp}${side === "off" ? " D" : ""}</td>
      <td><div class="ps-tm-who">${teamLogoMini(g.off, 16)}${who || `<span class="muted">--</span>`}</div></td>
      <td class="num"><b>${f(val)}</b></td>
      <td class="num">${f(usual)}</td>
      <td class="num"><span class="ps-tm-diff ${tone(diff, L)}">${diff === null ? "--" : `${diff > 0 ? "+" : ""}${f(diff)}`}</span></td>
      <td>${flags.join("")}</td>
    </tr>`;
  });
  // Up next: this card's opponent and what it usually gets / allows (all
  // its games so far, none of them vs this team), to line up against the
  // past opponents. Skipped once that game has been played (it's a row).
  let nextRow = "";
  if (next && next.opp && !games.some((g) => g[other] === next.opp && g.wk === next.week)) {
    const nUsual = propTagAvg((model.games || []).filter((x) => x[other] === next.opp && x[side] !== team).map((x) => x.v[m] || 0));
    nextRow = `<tr class="ps-tm-next">
      <td class="num">${next.week || ""}</td>
      <td class="ps-tm-vs">vs ${teamLogoMini(next.opp, 16)} ${next.opp}${side === "off" ? " D" : ""}</td>
      <td><span class="ps-tm-next-tag">Up next</span></td>
      <td></td>
      <td class="num"><b>${f(nUsual)}</b></td>
      <td></td>
      <td></td>
    </tr>`;
  }
  const vals = games.map((g) => g.v[m] || 0);
  const usuals = games.map((g) => usualOf(g[other], g.g)).filter((u) => u !== null);
  const avgVal = propTagAvg(vals);
  const avgUsual = propTagAvg(usuals);
  const avgDiff = avgUsual === null ? null : avgVal - avgUsual;
  const sign = (v) => `${v > 0 ? "+" : ""}${f(v)}`;
  const verdict = avgDiff === null ? "" : `<span class="ps-tm-diff ${tone(avgDiff, L)}">${side === "off" ? `${team} gets ${sign(avgDiff)}/g more than those Ds usually allow` : `Offenses get ${sign(avgDiff)}/g more vs ${team} than usual`}</span>`;
  // Spell out whose numbers each column is (an offense tag lists ITS
  // players vs each defense; a defense tag lists the opponents' players).
  const grp = PROP_TAG_GROUP[m] || "players";
  const word = PROP_STAT_WORDS[m] || "value";
  const whoHead = side === "off" ? `${team} ${grp}` : `Opponent ${grp}`;
  const valHead = side === "off" ? `${team} ${word}` : `${word} allowed`;
  const usualHead = side === "off" ? `That D allows other teams` : `That offense gets vs other Ds`;
  const usualTip = side === "off" ? `What that defense allowed per game in its other games (vs everyone except ${team})` : `What that offense got per game in its other games (vs everyone except ${team})`;
  return `${heading}
    <div class="ps-tm-summary">
      <span>Season <b>${f(cell.raw)}</b>/g</span>
      <span>${propRankTag(cell.rk)} in the NFL</span>
      <span>League avg <b>${f(L)}</b></span>
      ${verdict}
    </div>
    <table class="data-table ps-tm-table">
      <thead><tr><th class="num">Wk</th><th>Opponent</th><th>${whoHead}</th><th class="num">${valHead}</th><th class="num" title="${usualTip}">${usualHead}</th><th class="num" title="This game minus that usual">+/-</th><th></th></tr></thead>
      <tbody>${rows.join("")}
        <tr class="ps-tm-avg"><td></td><td>Avg</td><td></td><td class="num"><b>${f(avgVal)}</b></td><td class="num">${f(avgUsual)}</td><td class="num"><span class="ps-tm-diff ${tone(avgDiff, L)}">${avgDiff === null ? "--" : `${avgDiff > 0 ? "+" : ""}${f(avgDiff)}`}</span></td><td></td></tr>
        ${nextRow}
      </tbody>
    </table>
    <p class="ps-tm-note">+/- = ${side === "off" ? `what ${team} got minus what that defense allows other teams` : `what that offense got vs ${team} minus what it gets vs other defenses`}. The rank uses an opponent-adjusted version of this, with each game measured against what that opponent usually does${passing ? "; bad-weather games (and backup-QB games, for a defense) count 30%" : ""}.</p>`;
}
function openPropTagModal(team, side, m, next = null) {
  let overlay = document.getElementById("ps-tag-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ps-tag-modal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-box ps-tm-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="ps-tag-modal-content"></div></div>`;
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
  document.getElementById("ps-tag-modal-content").innerHTML = renderPropTagModal(team, side, m, next);
  overlay.hidden = false;
}

function statsNote() {
  return `data through Week ${DATA.through_week}`;
}

function renderPropsSummaryCard(away, home) {
  const card = document.getElementById("summary-card");
  if (!card) return;
  if (!DATA.prop_matchup_model) {
    card.innerHTML = `<p class="no-data-note">The summary appears after the next data refresh.</p>`;
    return;
  }
  const { game, week, gameKey } = propsSummaryContext();
  const linesByTeam = { [away]: propTeamLines(away, home, week, game), [home]: propTeamLines(home, away, week, game) };
  const when = game?.date ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const lines = [
    game && game.home_team_spread !== null && game.home_team_spread !== undefined ? `${home} ${signed(game.home_team_spread)}` : null,
    game && game.total_line ? `O/U ${game.total_line}` : null,
  ].filter(Boolean).join(" &middot; ");
  const all = [...propPackages(away, home, game, linesByTeam[away]), ...propPackages(home, away, game, linesByTeam[home])];
  const allLines = [...linesByTeam[away], ...linesByTeam[home]];
  const targets = all.filter((p) => p.dir > 0).sort((a, b) => b.lean - a.lean).slice(0, PROP_TARGETS_SHOWN);
  const fades = all.filter((p) => p.dir < 0).sort((a, b) => b.lean - a.lean).slice(0, PROP_FADES_SHOWN);
  const list = (items, empty) => (items.length ? items.map((p) => propPackageHtml(p, allLines)).join("") : `<div class="ps-spot-none">${empty}</div>`);
  const tt = (t) => {
    const v = propTeamTotal(game, t);
    return v === null ? "" : `<span class="ps-tt">${teamLogoMini(t, 16)} ${t} implied ${fmt(v, 1)}</span>`;
  };
  const railHidden = summaryRailHidden("props");
  syncSummaryRailButton("props", "Prop Picks");
  card.dataset.kind = "props";
  card.innerHTML = `<div class="sc-inner ps-card${railHidden ? " sc-no-rail" : ""}">
    <div class="sc-header">
      <div class="sc-title-row">
        <img src="${teamLogoUrl(away)}" crossorigin="anonymous" class="sc-logo" alt="">
        <div class="sc-matchup">${TEAM_NAMES[away] || away} <span class="sc-at">@</span> ${TEAM_NAMES[home] || home}</div>
        <img src="${teamLogoUrl(home)}" crossorigin="anonymous" class="sc-logo" alt="">
      </div>
      <div class="sc-meta">Week ${week}${when ? ` &middot; ${when}` : ""}${lines ? ` &middot; ${lines}` : ""}</div>
      <div class="sc-brand"><span class="brand-mark">GMG</span><span class="sc-brand-name">Props Summary</span></div>
    </div>

    <div class="sc-body">
      <div class="sc-main">
        <div class="ps-tts">${tt(away)}${tt(home)}</div>
        <div class="ps-tf">
          <section class="sc-section ps-tf-col ps-tf-target"><div class="sc-section-title">Target</div>${list(targets, "No clear good matchups")}</section>
          <section class="sc-section ps-tf-col ps-tf-fade"><div class="sc-section-title">Fade</div>${list(fades, "No clear bad matchups")}</section>
        </div>
      </div>
      ${railHidden ? "" : propsRail(away, home, linesByTeam, gameKey)}
    </div>

    <div class="sc-footer">
      <span>Matchup = offense's rank producing it + defense's rank allowing it, opponent-adjusted; backup-QB and bad-weather games count less; must agree with the implied team total</span>
      <span>${statsNote()}</span>
    </div>
  </div>`;
  fitWideSummaryCard();
  card.querySelectorAll("img").forEach((img) => img.addEventListener("load", fitWideSummaryCard, { once: true }));
}

// ---- Picker: every line in the game, by section, then by player ----
// Passing / Rushing / Receiving / Other; inside each, one block per player
// with his lines (Novig's line and price when Novig has it, SGO's
// otherwise). No projections -- you draw the conclusions. Each player has
// an Out switch for late news the injury report doesn't have yet.
const PROP_SECTIONS = [
  ["pass", "Passing"],
  ["rush", "Rushing"],
  ["rec", "Receiving"],
  ["other", "Other"],
];
const PROP_POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3 };
function propUsage(team, name) {
  const p = ((DATA.player_props || {})[team] || []).find((x) => normName(x.name) === normName(name));
  return p ? (p.pass_att || 0) + (p.carries || 0) + (p.targets || 0) : 0;
}
function renderPropsPicker() {
  const { away, home, week, game, gameKey } = propsSummaryContext();
  const picks = loadPropsSummaryPicks(gameKey);
  const marketOrder = Object.keys(PROP_MARKETS);
  const col = (team, defTeam) => {
    const chosen = new Set(picks[team] || []);
    const full = chosen.size >= PROPS_SUMMARY_MAX_PICKS;
    const rows = propTeamLines(team, defTeam, week, game);
    const sections = PROP_SECTIONS.map(([key, title]) => {
      const inSection = rows.filter((r) => r.section === key);
      if (!inSection.length) return "";
      const byPlayer = {};
      inSection.forEach((r) => (byPlayer[normName(r.name)] = byPlayer[normName(r.name)] || []).push(r));
      const players = Object.values(byPlayer).sort((a, b) => {
        const pa = PROP_POS_ORDER[a[0].position] ?? 9;
        const pb = PROP_POS_ORDER[b[0].position] ?? 9;
        return pa - pb || propUsage(team, b[0].name) - propUsage(team, a[0].name) || a[0].name.localeCompare(b[0].name);
      });
      const blocks = players
        .map((lines) => {
          const p = lines[0];
          const out = p.injury === "out";
          const outBtn = `<button type="button" class="ps-out-btn${out ? " ps-out-on" : ""}" data-team="${team}" data-name="${encodeDataAttr(p.name)}" title="Mark him out for this week (late news)">${out ? "Out &#10003;" : "Out?"}</button>`;
          const head = `<tr class="ps-pick-player${out ? " ps-pick-out" : ""}"><td colspan="5">${playerClick(team, p.name, `${summaryHeadshot(team, p.name, 22)} <b>${p.name}</b>`)} <span class="muted-label">${p.position || ""}</span>${p.injury === "Q" ? ` <span class="ftd-inj">Q</span>` : ""}${outBtn}</td></tr>`;
          if (out) return head;
          const body = lines
            .sort((a, b) => marketOrder.indexOf(a.marketKey) - marketOrder.indexOf(b.marketKey))
            .map((r) => {
              const on = chosen.has(propPickKey(r));
              return `<tr class="${on ? "sc-picker-on" : ""}"><td class="ps-pick-mkt"><label class="pp-row-label"><input type="checkbox" class="ps-pick-toggle" data-team="${team}" data-key="${encodeDataAttr(propPickKey(r))}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}> ${r.market}</label></td><td class="num">${fmt(r.line, 1)}</td><td class="num">${fmtOddsSigned(r.over)}</td><td class="num">${fmtOddsSigned(r.under)}</td><td class="ps-src">${r.source === "novig" ? `Novig${r.thin ? ` <span class="ps-thin" title="Barely traded on Novig right now -- prices are wide">thin</span>` : ""}` : "Books"}</td></tr>`;
            })
            .join("");
          return head + body;
        })
        .join("");
      return `<tr class="ps-pick-section"><td colspan="5">${title}</td></tr>${blocks}`;
    }).join("");
    return `<div class="sc-picker-col ps-picker-col">
      <h4 class="sc-picker-team">${teamLogoMini(team, 20)} ${TEAM_NAMES[team] || team} <span class="muted">${chosen.size}/${PROPS_SUMMARY_MAX_PICKS}</span></h4>
      <table class="data-table player-odds-table ps-pick-table"><thead><tr><th>Add to summary</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th><th></th></tr></thead><tbody>${sections || `<tr><td colspan="5" class="no-data-note">No lines posted yet.</td></tr>`}</tbody></table>
    </div>`;
  };
  return `<h3>${away} @ ${home} &mdash; Pick lines for the summary</h3>
    <p class="no-data-note">Up to ${PROPS_SUMMARY_MAX_PICKS} per team. Novig's line and price when Novig has one; "Books" = best price from other sportsbooks. "Out?" hides a player for this week (late news).</p>
    <div class="sc-picker-actions"><button type="button" class="view-toggle-btn ps-picker-clear">Clear all</button></div>
    <div class="sc-picker-cols">${col(away, home)}${col(home, away)}</div>`;
}
function ensurePropsPicker() {
  if (document.getElementById("ps-picker-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "ps-picker-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box ps-picker-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="ps-picker-content"></div>
  </div>`;
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
function openPropsPicker() {
  ensurePropsPicker();
  document.getElementById("ps-picker-content").innerHTML = renderPropsPicker();
  document.getElementById("ps-picker-modal").hidden = false;
}
function refreshPropsAfterPick() {
  const { away, home } = propsSummaryContext();
  document.getElementById("ps-picker-content").innerHTML = renderPropsPicker();
  renderPropsSummaryCard(away, home);
}

document.addEventListener("click", (e) => {
  const tagEl = e.target.closest(".ps-tag-click");
  if (tagEl) {
    const { team, side, m } = decodeDataAttr(tagEl.dataset.tag);
    const { away, home, week } = propsSummaryContext();
    openPropTagModal(team, side, m, { opp: team === away ? home : away, week });
    return;
  }
  if (e.target.closest("#summary-rail-btn")) {
    setSummaryRailHidden("props", !summaryRailHidden("props"));
    const { away, home } = propsSummaryContext();
    renderPropsSummaryCard(away, home);
    return;
  }
  if (e.target.closest(".ps-open, #props-pick-btn")) openPropsPicker();
  const outBtn = e.target.closest(".ps-out-btn");
  if (outBtn) {
    toggleManualOut(propsSummaryContext().week, outBtn.dataset.team, decodeDataAttr(outBtn.dataset.name));
    refreshPropsAfterPick();
    return;
  }
  if (e.target.closest(".ps-picker-clear")) {
    savePropsSummaryPicks(propsSummaryContext().gameKey, {});
    refreshPropsAfterPick();
  }
  const btn = e.target.closest("#summary-card .sc-pp");
  if (btn) {
    togglePossiblePlay(decodeDataAttr(btn.dataset.entry));
    const on = btn.classList.toggle("sc-pp-on");
    btn.querySelector(".sc-pp-box").innerHTML = on ? "&#10003;" : "";
    const { away, home } = propsSummaryContext();
    renderTdPossiblePlaysList(away, home);
  }
});
document.addEventListener("change", (e) => {
  const cb = e.target.closest(".ps-pick-toggle");
  if (!cb) return;
  const { gameKey } = propsSummaryContext();
  const picks = loadPropsSummaryPicks(gameKey);
  const list = new Set(picks[cb.dataset.team] || []);
  const key = decodeDataAttr(cb.dataset.key);
  if (cb.checked && list.size < PROPS_SUMMARY_MAX_PICKS) list.add(key);
  else list.delete(key);
  picks[cb.dataset.team] = [...list];
  savePropsSummaryPicks(gameKey, picks);
  refreshPropsAfterPick();
});

// ---- Zone Targets: pass catchers whose looks land where this defense is soft ----
// Building block shared by the pass-zone grids (Player Props page) and the
// Props Summary card.
//
// Defense side, per zone (depth x left/middle/right), a "softness" z:
//   half from the zone itself -- EPA/att and completion % allowed there
//   (both pulled toward that zone's league average with ZT_ZONE_PRIOR
//   attempts, so 2 throws can't make a zone "soft") and how often offenses
//   attack it vs the league;
//   half from the depth band in the opponent-adjusted model (short / 10-19 /
//   deep yards allowed -- where backup-QB and bad-weather games already
//   count less).
// Player side: where his targets go (share per zone, needs ZT_MIN_TARGETS),
// how many he gets (lineup-aware targets/game, league percentile at his
// position) and how much he plays (latest snap share).
// Match = his targets' average zone softness. A player shows when both the
// match and his opportunity clear a bar, with the markets that fit:
//   Receptions -- steady volume into soft SHORT/screen zones;
//   Long Rec   -- real 10+ yard share into soft intermediate/deep zones and a
//                 defense that gives up 20+ yard plays;
//   Rec Yds    -- good overall match + volume (YAC skill as a bonus tag).
const ZT_ZONE_PRIOR = 8;
const ZT_MIN_TARGETS = 5;
const ZT_MATCH_MIN = 0.3;
// Downfield path to Rec Yds: a high-volume receiver (opportunity percentile
// >= ZT_DOWNFIELD_OPP) sending ZT_DOWNFIELD_SHARE+ of his targets into
// intermediate/deep zones that are clearly soft (>= ZT_DOWNFIELD_SOFT).
const ZT_DOWNFIELD_SHARE = 0.4;
const ZT_DOWNFIELD_SOFT = 0.8;
const ZT_DOWNFIELD_OPP = 0.6;
const ZT_OPP_MIN = 0.35;
const ZT_SHOWN = 4;
const ZT_DEPTH_METRIC = { screen: "yds_short", short: "yds_short", intermediate: "yds_int", deep: "yds_deep" };
const ZT_ZONE_WORDS = { screen: "Screen", short: "Short", intermediate: "10-19", deep: "Deep" };
const ZT_LOC_WORDS = { left: "L", middle: "M", right: "R" };

function ztZoneKeys() {
  return PASS_ZONE_ROWS.flatMap((r) => PASS_ZONE_COLS.map((c) => `${r.key}_${c}`));
}
function ztMean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}
function ztZ(v, xs) {
  const m = ztMean(xs);
  const sd = Math.sqrt(ztMean(xs.map((x) => (x - m) ** 2))) || 1;
  return (v - m) / sd;
}

// Softness z per zone for every defense, cached for the page.
function ztDefenseSoftness() {
  if (ztDefenseSoftness.cache) return ztDefenseSoftness.cache;
  const charts = DATA.pass_shot_charts || {};
  const teams = Object.keys(charts).filter((t) => charts[t]?.def?.pass_attempts > 0);
  const keys = ztZoneKeys();
  const out = {};
  teams.forEach((t) => (out[t] = {}));
  keys.forEach((zk) => {
    let la = 0, lc = 0, le = 0;
    teams.forEach((t) => {
      const z = charts[t].def.zones[zk] || {};
      la += z.attempts || 0;
      lc += z.completions || 0;
      le += z.epa_sum || 0;
    });
    const lRate = la ? lc / la : 0.6;
    const lEpa = la ? le / la : 0;
    const rows = teams.map((t) => {
      const c = charts[t].def;
      const z = c.zones[zk] || {};
      const att = z.attempts || 0;
      return {
        t,
        comp: ((z.completions || 0) + ZT_ZONE_PRIOR * lRate) / (att + ZT_ZONE_PRIOR),
        epa: ((z.epa_sum || 0) + ZT_ZONE_PRIOR * lEpa) / (att + ZT_ZONE_PRIOR),
        vol: c.pass_attempts ? att / c.pass_attempts : 0,
      };
    });
    const comps = rows.map((r) => r.comp), epas = rows.map((r) => r.epa), vols = rows.map((r) => r.vol);
    const depth = zk.split("_")[0];
    rows.forEach((r) => {
      const zoneZ = 0.45 * ztZ(r.epa, epas) + 0.35 * ztZ(r.comp, comps) + 0.2 * ztZ(r.vol, vols);
      const band = propSide(r.t, "def", ZT_DEPTH_METRIC[depth]);
      const bandZ = band ? band.lean * 1.7 : 0; // rank lean (-1..1) onto a z-like scale
      out[r.t][zk] = 0.5 * zoneZ + 0.5 * bandZ;
    });
  });
  ztDefenseSoftness.cache = out;
  return out;
}

// League pool of targets/game by position (for the opportunity percentile).
function ztTargetPool(pos) {
  if (!ztTargetPool.cache) ztTargetPool.cache = {};
  if (!ztTargetPool.cache[pos]) {
    ztTargetPool.cache[pos] = Object.values(DATA.player_props || {})
      .flat()
      .filter((p) => p.position === pos && (p.targets || 0) >= 3 && p.targets_per_g)
      .map((p) => p.targets_per_g)
      .sort((a, b) => a - b);
  }
  return ztTargetPool.cache[pos];
}
function ztPercentile(v, pool) {
  if (!pool.length) return 0.5;
  return pool.filter((x) => x <= v).length / pool.length;
}

function zoneTargets(offTeam, defTeam, week) {
  const soft = ztDefenseSoftness()[defTeam];
  if (!soft) return [];
  const zones = (DATA.player_pass_zones || {})[offTeam] || {};
  const injuries = propInjuries(offTeam, week);
  const snaps = propSnapIndex(offTeam);
  const explDef = propSide(defTeam, "def", "expl_pass");
  const out = [];
  Object.entries(zones).forEach(([name, pz]) => {
    const pos = pz.position;
    if (!["WR", "TE", "RB"].includes(pos)) return;
    if (injuries[normName(name)]?.tag === "out") return;
    const total = Object.values(pz.zones).reduce((a, z) => a + (z.targets || 0), 0);
    if (total < ZT_MIN_TARGETS) return;
    // Where his targets go, and how soft those spots are.
    let match = 0, deepShare = 0, deepSoft = 0, shortShare = 0, shortSoft = 0;
    const softZones = [];
    Object.entries(pz.zones).forEach(([zk, z]) => {
      const t = z.targets || 0;
      if (!t) return;
      const share = t / total;
      const v = soft[zk] ?? 0;
      match += share * v;
      if (zk.startsWith("deep") || zk.startsWith("intermediate")) { deepShare += share; deepSoft += share * v; }
      else { shortShare += share; shortSoft += share * v; }
      if (share >= 0.15 && v >= 0.5) softZones.push({ zk, share, v });
    });
    const mDeep = deepShare ? deepSoft / deepShare : 0;
    const mShort = shortShare ? shortSoft / shortShare : 0;
    // Opportunity: lineup-aware targets/game vs his position league-wide,
    // plus how much he's on the field lately.
    const games = propBaselineGames(offTeam, name, pos, false, week);
    const tpg = games.length ? propWeightedMean(games, (g) => g.targets) : 0;
    const snapEntry = snaps[normName(name)];
    const snapVals = snapEntry ? Object.entries(snapEntry.w).sort((a, b) => b[0] - a[0]).map(([, v]) => v) : [];
    const snap = snapVals.length ? (snapVals[0] + (snapVals[1] ?? snapVals[0])) / 2 : 0.5;
    const opp = 0.7 * ztPercentile(tpg, ztTargetPool(pos)) + 0.3 * Math.min(1, snap);
    // Downfield exception (user 2026-10-02, Lamb vs HOU): half his targets
    // short where HOU is tough, half downfield where HOU is very soft -- the
    // blend averaged to 0.19 and dropped him before the deep markets were
    // even looked at.
    if (opp < ZT_OPP_MIN) return;
    const downfield = deepShare >= ZT_DOWNFIELD_SHARE && mDeep >= ZT_DOWNFIELD_SOFT && opp >= ZT_DOWNFIELD_OPP;
    // Mirror case (audit 2026-10-02, Nico Collins vs DAL: 40% short at +1.18
    // soft, 60% deep where DAL is tough -> blend 0.24).
    const shortGame = shortShare >= ZT_DOWNFIELD_SHARE && mShort >= ZT_DOWNFIELD_SOFT && opp >= ZT_DOWNFIELD_OPP;
    // The blended fit still filters lukewarm matches; the exceptions are a
    // strong fit at one depth, which the other depth shouldn't cancel out.
    if (match < ZT_MATCH_MIN && !downfield && !shortGame) return;
    const markets = [];
    if (tpg >= 4 && shortShare >= 0.4 && mShort >= ZT_MATCH_MIN) markets.push("receiving_receptions");
    if (deepShare >= 0.3 && mDeep >= ZT_MATCH_MIN + 0.1 && (explDef?.rk || 32) <= 16) markets.push("receiving_longestReception");
    if ((match >= ZT_MATCH_MIN + 0.05 && opp >= 0.5) || downfield) markets.push("receiving_yards");
    if (!markets.length) return;
    // Rank on the stronger of the overall fit and the downfield fit, so tough
    // short zones can't bury a strong deep matchup.
    const effMatch = Math.max(match, mDeep * Math.min(1, deepShare / 0.5), mShort * Math.min(1, shortShare / 0.5));
    const props = ((DATA.player_props || {})[offTeam] || []).find((p) => normName(p.name) === normName(name));
    out.push({
      team: offTeam,
      name,
      position: pos,
      tpg,
      snap,
      match,
      opp,
      markets,
      yac: props && props.yac_per_rec !== null && props.yac_per_rec >= (pos === "WR" ? 5 : pos === "TE" ? 5.5 : 8),
      softZones: softZones.sort((a, b) => b.share * b.v - a.share * a.v).slice(0, 2),
      score: 0.5 * opp + 0.5 * Math.min(1, effMatch / 1.2),
    });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, ZT_SHOWN);
}

function renderZoneTargets(offTeam, defTeam) {
  const game = (DATA.schedule || []).find((g) => g.week === scheduleWeek && ((g.away === offTeam && g.home === defTeam) || (g.home === offTeam && g.away === defTeam)));
  const week = game ? game.week : DATA.current_week;
  const list = zoneTargets(offTeam, defTeam, week);
  const lines = propTeamLines(offTeam, defTeam, week, game);
  const lineFor = (name, mk) => lines.find((r) => r.marketKey === mk && normName(r.name) === normName(name));
  const rows = list.length
    ? list
        .map((p) => {
          const chips = p.markets
            .map((mk) => {
              const l = lineFor(p.name, mk);
              return `<span class="zt-mkt">${PROP_MARKETS[mk].label}${l ? ` <b>${fmt(l.line, 1)}</b>` : ""}</span>`;
            })
            .join("");
          const zonesHtml = p.softZones.map((z) => { const [d, loc] = z.zk.split("_"); return `<span class="zt-zone">${ZT_ZONE_WORDS[d]} ${ZT_LOC_WORDS[loc]}</span>`; }).join("");
          return `<div class="zt-row">
            <span class="zt-who player-click" data-entry="${encodeDataAttr({ team: offTeam, name: p.name, oppTeam: defTeam })}">${summaryHeadshot(offTeam, p.name, 34)}<span><b>${p.name}</b><small>${p.position} &middot; ${fmt(p.tpg, 1)} tgt/g &middot; ${Math.round(p.snap * 100)}% snaps</small></span></span>
            <span class="zt-tags">${chips}${p.yac ? `<span class="zt-yac">YAC</span>` : ""}${zonesHtml}</span>
          </div>`;
        })
        .join("")
    : `<p class="zt-none">No clear zone mismatches for ${offTeam} pass catchers</p>`;
  return `<div class="zt-panel">
    <div class="zt-title">${teamLogoMini(offTeam, 18)} ${offTeam} Zone Targets</div>
    ${rows}
  </div>`;
}
