// ---- Player Props Summary: one screenshot-ready card ----
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
const PROP_ROWS = { pass: 2, rush: 3, rec: 3 };
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
  return out;
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
function propTeamLines(team, defTeam, week, game) {
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
      if (!(key in cache)) {
        cache[key] = propProjectPlayer(team, line.name, position, defTeam, week, game);
        cache[key + "|n"] = propProjectPlayer(team, line.name, position, defTeam, week, game, true);
      }
      const proj = cache[key];
      const base = cache[key + "|n"];
      const def = PROP_MARKETS[marketKey];
      const section = def.section || (position === "RB" ? "rush" : "rec");
      const row = { team, name: line.name, position, marketKey, market: def.label, section, line: line.line, over: line.over_odds, under: line.under_odds, injury: injuries[key]?.tag || null, proj: null };
      rows.push(row);
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

// Plays under a column are the lines that BACK one of its market calls:
// right market, right position (and, for depth calls, a receiver who's
// actually targeted at that depth), same side as the call, and the
// player's own projection agrees by at least PROP_CALL_EDGE_MIN. One row
// per player, his best-backed line; each row names the call it backs.
const PROP_CALL_EDGE_MIN = 0.04;
function propFitsCall(r, a) {
  if (!a.markets.includes(r.marketKey) || !a.pos.includes(r.position) || r.side !== a.side) return false;
  if (!a.depth) return true;
  const sh = propDepthShares(r.team, r.name);
  return !!sh && sh[a.depth] >= a.share;
}
function propSectionPlays(rows, section, angles) {
  const byPlayer = {};
  rows
    .filter((r) => r.section === section && r.edge !== null && r.edge >= PROP_CALL_EDGE_MIN)
    .forEach((r) => {
      const call = (angles || []).find((a) => propFitsCall(r, a));
      if (!call) return;
      const k = normName(r.name);
      if (!byPlayer[k] || r.edge > byPlayer[k].edge) byPlayer[k] = { ...r, display: propDisplayName(rows, r), call };
    });
  return Object.values(byPlayer).sort((a, b) => b.edge - a.edge);
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

// ---- Market calls: this offense vs this defense ----
// Each angle pairs what the defense allows with what the offense actually
// does, and ends in a market: "Target Receptions" when a defense gives up
// underneath catches to an offense that lives underneath, "Fade Deep
// catches" when a defense takes away the deep ball from an offense that
// doesn't throw it much. Defense counts 60%, offense 40%; both have to
// lean the same way (or the offense be neutral) for a call. Ranks are
// opponent-adjusted (build_stats.py prop_matchup_model).
const PROP_ANGLE_MIN = 0.45; // combined lean (-1..1) needed for a call
const PROP_ANGLES_SHOWN = 3;
const f1 = (v) => fmt(v, 1);
const f0 = (v) => fmt(v, 0);
const PROP_ANGLES = {
  pass: [
    { name: "Pass attempts", def: ["pass_att"], off: "pass_att", d: (v) => `faces ${f1(v)} att/g`, o: (v) => `throws ${f1(v)}/g`, markets: ["passing_attempts", "passing_completions"], pos: ["QB"] },
    { name: "Pass yards", def: ["pass_yards", "ypa"], off: "pass_yards", d: (v) => `allows ${f0(v)} pass yds/g`, o: (v) => `${f0(v)}/g`, markets: ["passing_yards", "passing+rushing_yards"], pos: ["QB"] },
    { name: "Pass TDs", def: ["pass_td"], off: "pass_td", d: (v) => `allows ${f1(v)} pass TD/g`, o: (v) => `${f1(v)}/g`, markets: ["passing_touchdowns"], pos: ["QB"] },
    { name: "Long completions", def: ["expl_pass"], off: "expl_pass", d: (v) => `allows ${f1(v)} 20+ yd comp/g`, o: (v) => `${f1(v)}/g`, markets: ["passing_longestCompletion"], pos: ["QB"] },
    { name: "INTs", def: ["ints"], off: "ints", d: (v) => `picks off ${f1(v)}/g`, o: (v) => `throws ${f1(v)}/g`, markets: ["passing_interceptions"], pos: ["QB"] },
  ],
  rush: [
    { name: "RB carries", def: ["car_RB", "ypc_RB"], off: "car_RB", d: (v) => `allows ${f1(v)} RB car/g`, o: (v) => `${f1(v)}/g`, markets: ["rushing_attempts"], pos: ["RB"] },
    { name: "RB rush yards", def: ["rushyds_RB", "ypc_RB"], off: "rushyds_RB", d: (v) => `allows ${f0(v)} RB rush yds/g`, o: (v) => `${f0(v)}/g`, markets: ["rushing_yards", "rushing+receiving_yards"], pos: ["RB"] },
    { name: "Long runs", def: ["expl_rush"], off: "expl_rush", d: (v) => `allows ${f1(v)} 10+ yd runs/g`, o: (v) => `${f1(v)}/g`, markets: ["rushing_longestRush"], pos: ["RB", "QB"] },
    { name: "QB rushing", def: ["rushyds_QB"], off: "rushyds_QB", d: (v) => `allows ${f0(v)} QB rush yds/g`, o: (v) => `${f0(v)}/g`, markets: ["rushing_yards", "rushing_attempts"], pos: ["QB"] },
  ],
  rec: [
    { name: "Receptions", def: ["yds_short"], off: "att_short", d: (v) => `allows ${f0(v)} yds/g on short throws`, o: (v) => `throws ${f1(v)} short/g`, markets: ["receiving_receptions"], pos: ["WR", "TE", "RB"], depth: "short", share: 0.5 },
    { name: "10-19 yd yards", def: ["yds_int"], off: "att_int", d: (v) => `allows ${f0(v)} yds/g on 10-19 yd throws`, o: (v) => `throws ${f1(v)} there/g`, markets: ["receiving_yards"], pos: ["WR", "TE"], depth: "int", share: 0.25 },
    { name: "Deep yards", def: ["yds_deep"], off: "att_deep", d: (v) => `allows ${f0(v)} yds/g on 20+ yd throws`, o: (v) => `throws ${f1(v)} deep/g`, markets: ["receiving_yards", "receiving_longestReception"], pos: ["WR", "TE"], depth: "deep", share: 0.2 },
    { name: "Long catches", def: ["expl_pass"], off: "expl_pass", d: (v) => `allows ${f1(v)} 20+ yd catches/g`, o: (v) => `makes ${f1(v)}/g`, markets: ["receiving_longestReception"], pos: ["WR", "TE", "RB"] },
    { name: "WR yards", def: ["recyds_WR"], off: "recyds_WR", d: (v) => `allows ${f0(v)} WR yds/g`, o: (v) => `WRs ${f0(v)}/g`, markets: ["receiving_yards", "receiving_receptions"], pos: ["WR"] },
    { name: "TE yards", def: ["recyds_TE"], off: "recyds_TE", d: (v) => `allows ${f0(v)} TE yds/g`, o: (v) => `TEs ${f0(v)}/g`, markets: ["receiving_yards", "receiving_receptions"], pos: ["TE"] },
    { name: "RB catches", def: ["recyds_RB"], off: "recyds_RB", d: (v) => `allows ${f0(v)} RB rec yds/g`, o: (v) => `RBs ${f0(v)}/g`, markets: ["receiving_yards", "receiving_receptions"], pos: ["RB"] },
  ],
};

// Rank 1 (most) -> +1, rank 32 (fewest) -> -1.
function propRankLean(rk) {
  return rk ? (16.5 - rk) / 15.5 : 0;
}
function propSide(team, side, metric) {
  const cell = ((propModel().teams[team] || {})[side] || {})[metric];
  return cell ? { raw: cell.raw, rk: cell.rk, lean: propRankLean(cell.rk) } : null;
}

function propMarketAngles(section, offTeam, defTeam) {
  const out = [];
  PROP_ANGLES[section].forEach((a) => {
    const defs = a.def.map((m) => propSide(defTeam, "def", m)).filter(Boolean);
    const off = propSide(offTeam, "off", a.off);
    if (!defs.length || !off) return;
    const dLean = defs.reduce((x, d) => x + d.lean, 0) / defs.length;
    const score = 0.6 * dLean + 0.4 * off.lean;
    const dir = Math.sign(score);
    if (Math.abs(score) < PROP_ANGLE_MIN || dLean * dir < 0.3 || off.lean * dir < -0.2) return;
    const d = defs[0];
    out.push({
      ...a,
      side: dir > 0 ? "over" : "under",
      score,
      detail: `${defTeam} ${a.d(d.raw)} &middot; ${offTeam} ${a.o(off.raw)}`,
      tip: `${defTeam}: ${propRankWords(d.rk)} of 32 defenses; ${offTeam}: ${propRankWords(off.rk)} of 32 offenses (opponent-adjusted)`,
    });
  });
  // Strongest first; one call per market group so two angles never say
  // the same thing twice (or the opposite thing) about the same market.
  const taken = new Set();
  return out
    .sort((x, y) => Math.abs(y.score) - Math.abs(x.score))
    .filter((a) => {
      const key = a.markets[0] + "|" + a.pos.join("");
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    })
    .slice(0, PROP_ANGLES_SHOWN);
}
function propAnglesHtml(angles) {
  if (!angles.length) return `<span class="target-none">No clear market edge from this matchup</span>`;
  return angles
    .map((a) => `<div class="ps-angle" title="${a.tip}"><span class="ps-angle-call ps-angle-${a.side}">${a.side === "over" ? "&#9650; Target" : "&#9660; Fade"} ${a.name}</span><span class="ps-angle-why">${a.detail}</span></div>`)
    .join("");
}

// ---- Card rendering ----
// Clicking a player opens the shared player popup (player-props.js).
function propClickEntry(r) {
  const { away, home } = propsSummaryContext();
  return encodeDataAttr({ team: r.team, name: r.name, oppTeam: r.team === away ? home : away });
}
function propLineText(r, side = r.side) {
  return `${side === "over" ? "o" : "u"}${fmt(r.line, 1)}`;
}
function propValuesCell(r) {
  return r.games
    .slice(0, 4)
    .map((g) => {
      if (g.partial) return `<span class="ps-val ps-val-partial" title="Wk ${g.week}: ${Math.round((g.snap || 0) * 100)}% of snaps -- left early / limited, not counted">${Math.round(g.v)}*</span>`;
      const cls = (r.side === "over" ? g.v > r.line : g.v < r.line) ? "ps-val-hit" : "ps-val-miss";
      const tip = g.missing ? ` title="Wk ${g.week}: ${g.missing.join(", ")} out -- scaled back in the projection"` : "";
      return `<span class="ps-val ${cls}${g.missing ? " ps-val-lineup" : ""}"${tip}>${Math.round(g.v)}</span>`;
    })
    .join("");
}
// Reads like a pick: "Over 57.5 Rec Yds -114". The defense story is in the
// summary line above; the only note kept here is a lineup change (a
// teammate Out, or back), since nothing else on the card says that.
function propPlayRow(r) {
  const strong = r.edge >= PROP_EDGE_STRONG;
  const inj = r.injury === "Q" ? ` <span class="ftd-inj">Q</span>` : "";
  const lineup = r.reasons.filter((x) => / OUT \+| back \(/.test(x.text)).map((x) => x.text).join(" &middot; ");
  return `<tr class="ps-play${strong ? " ps-play-strong" : ""}">
      <td><span class="sc-player player-click" data-entry="${propClickEntry(r)}" title="Game log, odds, add to summary">${summaryHeadshot(r.team, r.name, 26)}<span class="ps-name">${r.display} <span class="muted ps-pos">${r.position || ""}</span>${inj}${lineup ? `<span class="ps-lineup">${lineup}</span>` : ""}</span></span></td>
      <td><span class="ps-bet"><b class="ps-side-${r.side}">${r.side === "over" ? "Over" : "Under"} ${fmt(r.line, 1)}</b> ${r.market}</span> <span class="muted">${fmtOddsSigned(r.odds)}</span><span class="ps-backs ps-side-${r.side}">${r.side === "over" ? "&#9650;" : "&#9660;"} ${r.call.name}</span></td>
      <td class="num">${fmt(r.proj, r.proj < 10 ? 1 : 0)}</td>
      <td class="ps-vals">${propValuesCell(r)}</td>
      <td class="num">${r.hits}/${r.values.length}</td>
    </tr>`;
}
function propSectionColumn(section, offTeam, defTeam, rows) {
  const angles = propMarketAngles(section, offTeam, defTeam);
  const tagHtml = propAnglesHtml(angles);
  const plays = propSectionPlays(rows, section, angles).slice(0, PROP_ROWS[section]);
  const body = plays.length
    ? `<table class="sc-table ps-plays"><thead><tr><th>Player</th><th>Play</th><th class="num">Proj</th><th>Games</th><th class="num">Hit</th></tr></thead><tbody>${plays.map(propPlayRow).join("")}</tbody></table>`
    : `<p class="target-none ps-none">${angles.length ? "No posted lines the model agrees with for these calls" : ""}</p>`;
  return `<div class="sc-col">
    <div class="sc-block"><div class="sc-label">${teamLogoMini(offTeam, 14)} ${offTeam} offense vs ${defTeam} defense</div><div class="ps-angles">${tagHtml}</div></div>
    <div class="sc-block">${body}</div>
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
      .filter((r) => chosen.has(propPickKey(r)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => {
        // Arrow where the model sides with this line strongly enough to list it.
        const lean = r.edge !== null && r.edge !== undefined && r.edge >= PROP_EDGE_MIN ? ` <span class="ps-lean" title="Model leans ${r.side}">${r.side === "over" ? "&#9650;" : "&#9660;"}</span>` : "";
        return `<tr><td><span class="sc-player player-click" data-entry="${propClickEntry(r)}" title="Game log, odds, add to summary">${summaryHeadshot(team, r.name, 26)}<span class="ps-rail-name">${propDisplayName(linesByTeam[team], r)}<span class="ps-rail-mkt">${r.market} ${fmt(r.line, 1)}${r.proj !== null ? ` <span class="muted">proj ${fmt(r.proj, r.proj < 10 ? 1 : 0)}</span>` : ""}${lean}</span></span></span></td><td class="num"><div class="ps-rail-btns">${propSideButton(r, "over")}${propSideButton(r, "under")}</div></td></tr>`;
      })
      .join("");
    const rgb = teamAccentRgb(team);
    return `<div class="sc-odds-team" style="border-left:4px solid rgb(${rgb.join(",")})">
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
  const noLines = !linesByTeam[away].length && !linesByTeam[home].length;
  const section = (key, title) => `<section class="sc-section ps-section">
      <div class="sc-section-title">${title}</div>
      <div class="sc-cols sc-grid2">
        ${propSectionColumn(key, away, home, linesByTeam[away])}
        ${propSectionColumn(key, home, away, linesByTeam[home])}
      </div>
    </section>`;
  card.dataset.kind = "props";
  card.innerHTML = `<div class="sc-inner ps-card">
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
        <div class="sc-cols">${summaryTeamBanner(away)}${summaryTeamBanner(home)}</div>
        ${noLines ? `<p class="no-data-note">No player prop lines posted for this game yet -- defense tags still show below.</p>` : ""}
        ${section("pass", "Passing")}
        ${section("rush", "Rushing")}
        ${section("rec", "Receiving")}
      </div>
      ${propsRail(away, home, linesByTeam, gameKey)}
    </div>

    <div class="sc-footer">
      <span><span class="ps-angle-call ps-angle-over">&#9650; Target</span> / <span class="ps-angle-call ps-angle-under">&#9660; Fade</span> = defense and offense both lean that way (opponent-adjusted, hover for ranks)</span>
      <span>Games newest first, green = hit &middot; <span class="ps-val ps-val-partial">7*</span> left early, skipped &middot; <span class="ps-val ps-val-hit ps-val-lineup">9</span> teammate out, scaled</span>
    </div>
  </div>`;
  fitSummaryCard();
  card.querySelectorAll("img").forEach((img) => img.addEventListener("load", fitSummaryCard, { once: true }));
}

// ---- Picker: every line in the game, "add to summary" per line ----
function renderPropsPicker() {
  const { away, home, week, game, gameKey } = propsSummaryContext();
  const picks = loadPropsSummaryPicks(gameKey);
  const filter = propsPickerFilter;
  const markets = [...new Set([away, home].flatMap((t) => propTeamLines(t, t === away ? home : away, week, game).map((r) => r.marketKey)))];
  const options = [`<option value="">All markets</option>`]
    .concat(markets.map((m) => `<option value="${m}"${m === filter ? " selected" : ""}>${PROP_MARKETS[m].label}</option>`))
    .join("");
  const col = (team, defTeam) => {
    const chosen = new Set(picks[team] || []);
    const full = chosen.size >= PROPS_SUMMARY_MAX_PICKS;
    const rows = propTeamLines(team, defTeam, week, game)
      .filter((r) => !filter || r.marketKey === filter)
      .sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
    const body = rows.length
      ? rows
          .map((r) => {
            const on = chosen.has(propPickKey(r));
            const edge = r.edge === null || r.edge === undefined ? "--" : `${r.edge >= PROP_EDGE_MIN ? `<b>${propLineText(r)}</b>` : propLineText(r)} ${r.edge >= 0 ? "+" : ""}${Math.round(r.edge * 100)}%`;
            return `<tr class="${on ? "sc-picker-on" : ""}${r.edge >= PROP_EDGE_MIN ? " ps-picker-lean" : ""}"><td><label class="pp-row-label"><input type="checkbox" class="ps-pick-toggle" data-team="${team}" data-key="${encodeDataAttr(propPickKey(r))}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}> ${summaryHeadshot(team, r.name, 22)} ${r.name}</label></td><td>${r.market}</td><td class="num">${fmt(r.line, 1)}</td><td class="num">${r.proj === null ? "--" : fmt(r.proj, 1)}</td><td class="num">${edge}</td><td class="num">${fmtOddsSigned(r.over)}</td><td class="num">${fmtOddsSigned(r.under)}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="no-data-note">No lines posted yet.</td></tr>`;
    return `<div class="sc-picker-col ps-picker-col">
      <h4 class="sc-picker-team">${teamLogoMini(team, 20)} ${TEAM_NAMES[team] || team} <span class="muted">${chosen.size}/${PROPS_SUMMARY_MAX_PICKS}</span></h4>
      <table class="data-table player-odds-table"><thead><tr><th>Add to summary</th><th>Market</th><th class="num">Line</th><th class="num">Proj</th><th class="num">Model</th><th class="num">Over</th><th class="num">Under</th></tr></thead><tbody>${body}</tbody></table>
    </div>`;
  };
  return `<h3>${away} @ ${home} &mdash; Pick lines for the summary</h3>
    <p class="no-data-note">Up to ${PROPS_SUMMARY_MAX_PICKS} per team. Model = the side the projection favors and how far it is from the odds' no-vig chance (bold = strong lean, 10%+).</p>
    <div class="sc-picker-actions"><select id="ps-picker-market" class="props-market-select">${options}</select> <button type="button" class="view-toggle-btn ps-picker-clear">Clear all</button></div>
    <div class="sc-picker-cols">${col(away, home)}${col(home, away)}</div>`;
}
let propsPickerFilter = "";
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
  if (e.target.closest(".ps-open, #props-pick-btn")) openPropsPicker();
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
  if (e.target.id === "ps-picker-market") {
    propsPickerFilter = e.target.value;
    document.getElementById("ps-picker-content").innerHTML = renderPropsPicker();
    return;
  }
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
