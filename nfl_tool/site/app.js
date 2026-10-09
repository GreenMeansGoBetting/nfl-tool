const LENGTH_BUCKETS = [
  { key: "10_or_less", label: "≤10 yd" },
  { key: "11_20", label: "11-20 yd" },
  { key: "21_40", label: "21-40 yd" },
  { key: "41_plus", label: "41+ yd" },
];

// For the Matchup Snapshot only (the detailed Touchdown Distance table
// below keeps all 4 buckets) -- rolling up into short/big-play tells the
// same "explosive or not" story on a more solid count.
const MACRO_LENGTH_BUCKETS = [
  { key: "short", keys: ["10_or_less", "11_20"], label: "short TDs" },
  { key: "bigplay", keys: ["21_40", "41_plus"], label: "big plays" },
];
function sumBucketKeys(dict, keys) {
  return keys.reduce((sum, k) => sum + (dict[k] || 0), 0);
}

// Every row in the combined offense/defense stat table -- each side shows
// BOTH the season total and the per-game rate, so nothing needs a second
// row. offKey/rateOffKey read off the offense-side team, the Def variants
// off the defense-side (opponent) team.
const STAT_ROWS = [
  { label: "Pass TD", totalOffKey: "pass_td", rateOffKey: "pass_td_per_g", totalDefKey: "pass_td_allowed", rateDefKey: "pass_td_allowed_per_g" },
  { label: "Rush TD", totalOffKey: "rush_td", rateOffKey: "rush_td_per_g", totalDefKey: "rush_td_allowed", rateDefKey: "rush_td_allowed_per_g" },
  { label: "Total TD", totalOffKey: "total_td", rateOffKey: "total_td_per_g", totalDefKey: "total_td_allowed", rateDefKey: "total_td_allowed_per_g" },
  { label: "DST TD", totalOffKey: "dst_td", rateOffKey: "dst_td_per_g", totalDefKey: "dst_td_allowed", rateDefKey: "dst_td_allowed_per_g" },
  { label: "First TD", special: "first" },
];

function topOpportunity(candidates) {
  const valid = candidates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((best, c) => (c.magnitude > best.magnitude ? c : best));
}

// One direction (offTeam's offense against defTeam's defense) worth of
// targetable opportunities across every category on this page. Called
// twice (away-vs-home and home-vs-away) and combined for the full
// snapshot. Each entry is tagged with a category/subject so
// renderMatchupSnapshot can merge same-subject opportunities that show up
// in both directions (e.g. both teams leaning on TEs) into one line.
function directionInsights(offTeam, defTeam) {
  const insights = [];

  const firstTd = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].first_td_rate, (t) => firstTdAllowedRate(t), false, true);
  if (firstTd) insights.push({ ...firstTd, category: "first_td", subject: null, team: offTeam, label: "for the first TD" });

  const posOpp = topOpportunity(
    POSITIONS.map((pos) => {
      const r = checkOpportunity(
        offTeam,
        defTeam,
        (t) => (DATA.team_stats[t].total_td ? DATA.team_stats[t].off_position_td[pos] / DATA.team_stats[t].total_td : null),
        (t) => (DATA.team_stats[t].total_td_allowed ? DATA.team_stats[t].def_position_td_allowed[pos] / DATA.team_stats[t].total_td_allowed : null),
        false,
        true
      );
      return r && { ...r, category: "position", subject: pos, team: offTeam, label: `${pos}s` };
    })
  );
  if (posOpp) insights.push(posOpp);

  const distOpp = topOpportunity(
    MACRO_LENGTH_BUCKETS.map(({ key, keys, label }) => {
      const r = checkOpportunity(
        offTeam,
        defTeam,
        (t) => {
          const s = DATA.team_stats[t];
          const count = sumBucketKeys(s.td_by_length, keys);
          return s.total_td && count >= 3 ? count / s.total_td : null;
        },
        (t) => {
          const s = DATA.team_stats[t];
          const count = sumBucketKeys(s.td_by_length_allowed, keys);
          return s.total_td_allowed && count >= 3 ? count / s.total_td_allowed : null;
        },
        false,
        true
      );
      return r && { ...r, category: "distance", subject: key, team: offTeam, label: label };
    })
  );
  if (distOpp) insights.push(distOpp);

  const rzOpp = checkOpportunity(offTeam, defTeam, (t) => DATA.team_stats[t].rz_td_per_g, (t) => DATA.team_stats[t].rz_td_allowed_per_g, false, true);
  if (rzOpp) insights.push({ ...rzOpp, category: "redzone", subject: "td", team: offTeam, label: "red zone TDs" });

  return insights;
}

function computeMatchupInsights(awayTeam, homeTeam) {
  return [...directionInsights(awayTeam, homeTeam), ...directionInsights(homeTeam, awayTeam)];
}

function renderStatTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = STAT_ROWS.map((r) => {
    if (r.special === "first") {
      const offTotal = off.first_td_games;
      const offRate = off.first_td_rate * 100;
      const defTotal = firstTdAllowedGames(defTeam);
      const defRate = firstTdAllowedRate(defTeam) * 100;
      const offTotalCls = percentileTier(offTotal, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
      const offRateCls = tierFor("first_td_rate", offTeam, false);
      const defTotalCls = percentileTier(defTotal, teamsWithGames().map(firstTdAllowedGames), true);
      const defRateCls = tierForFirstTdAllowed(defTeam);
      const offRateExtreme = tierFor("first_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
      const defRateExtreme = tierForFirstTdAllowed(defTeam, TIER_Z_EXTREME_THRESHOLD);
      const offTotalA = tierAlphaAttr(offTotal, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
      const offRateA = tierForAlphaAttr("first_td_rate", offTeam, false);
      const defTotalA = tierAlphaAttr(defTotal, teamsWithGames().map(firstTdAllowedGames), true);
      const defRateA = tierForFirstTdAllowedAlphaAttr(defTeam);
      const offTotalCell = numCell(offTotal, offTotalCls, offTotalA, { team: offTeam, statKey: "first_td_games", label: "First TD Games", invert: false });
      const offRateCell = numCell(`${fmt(offRate, 0)}%`, offRateCls, offRateA, { team: offTeam, statKey: "first_td_rate", label: "First TD Rate", invert: false, percent: true });
      const defTotalCell = numCell(defTotal, defTotalCls, defTotalA, { team: defTeam, computed: "firstTdAllowedGames", label: "First TD Games Allowed", invert: true });
      const defRateCell = numCell(`${fmt(defRate, 0)}%`, defRateCls, defRateA, { team: defTeam, computed: "firstTdAllowedRate", label: "First TD Rate Allowed", invert: true, percent: true });
      return `<tr><td>${r.label}</td>${offTotalCell}${offRateCell}${defTotalCell}${defRateCell}${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;
    }
    const offTotalCls = tierFor(r.totalOffKey, offTeam, false);
    const offRateCls = tierFor(r.rateOffKey, offTeam, false);
    const defTotalCls = tierFor(r.totalDefKey, defTeam, true);
    const defRateCls = tierFor(r.rateDefKey, defTeam, true);
    const offRateExtreme = tierFor(r.rateOffKey, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defRateExtreme = tierFor(r.rateDefKey, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offTotalA = tierForAlphaAttr(r.totalOffKey, offTeam, false);
    const offRateA = tierForAlphaAttr(r.rateOffKey, offTeam, false);
    const defTotalA = tierForAlphaAttr(r.totalDefKey, defTeam, true);
    const defRateA = tierForAlphaAttr(r.rateDefKey, defTeam, true);
    const offTotalCell = numCell(off[r.totalOffKey], offTotalCls, offTotalA, { team: offTeam, statKey: r.totalOffKey, label: `${r.label} (Total)`, invert: false });
    const offRateCell = numCell(fmt(off[r.rateOffKey], 2), offRateCls, offRateA, { team: offTeam, statKey: r.rateOffKey, label: `${r.label} Per Game`, invert: false, digits: 2 });
    const defTotalCell = numCell(def[r.totalDefKey], defTotalCls, defTotalA, { team: defTeam, statKey: r.totalDefKey, label: `${r.label} Allowed (Total)`, invert: true });
    const defRateCell = numCell(fmt(def[r.rateDefKey], 2), defRateCls, defRateA, { team: defTeam, statKey: r.rateDefKey, label: `${r.label} Allowed Per Game`, invert: true, digits: 2 });
    return `<tr><td>${r.label}</td>${offTotalCell}${offRateCell}${defTotalCell}${defRateCell}${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "Per Game"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Targets: a filtered read of the Type/Position/Distance tables ----
// For one offense vs. the defense it faces, every row where the DEFENSE
// is a real soft spot league-wide AND the offense is at least close to
// average there. Defense leads (60%) -- an average offense vs. a bad
// defense is still an opportunity -- but a bottom-tier offense in that
// spot can't cash it, so it's dropped. Each side's z blends per-game
// volume (60%) with share of its own TDs (40%), matching the Total/%
// pair the tables show; Type rows and RZ/First TD are rates, used as-is.
const TARGET_DEF_MIN_Z = TIER_Z_THRESHOLD; // defense must be a soft spot
const TARGET_OFF_MIN_Z = -0.3; // offense can't be clearly below average
const TARGET_STRONG_SCORE = 1.3;

function targetBucketZ(team, dictKey, totalKey, bucketKey) {
  const pool = teamsWithGames();
  const perG = (t) => (DATA.team_stats[t][dictKey][bucketKey] || 0) / (DATA.team_stats[t].games_played || 1);
  const share = (t) => {
    const s = DATA.team_stats[t];
    return s[totalKey] ? (s[dictKey][bucketKey] || 0) / s[totalKey] : 0;
  };
  const cz = zScore(perG(team), pool.map(perG), false);
  const sz = zScore(share(team), pool.map(share), false);
  if (cz === null || sz === null) return null;
  return 0.6 * cz + 0.4 * sz;
}
function targetRateZ(team, getter) {
  return zScore(getter(team), teamsWithGames().map(getter), false);
}

function targetEntry(label, offZ, defZ) {
  if (offZ === null || defZ === null) return null;
  if (defZ < TARGET_DEF_MIN_Z || offZ < TARGET_OFF_MIN_Z) return null;
  return { label, score: 0.6 * defZ + 0.4 * offZ };
}

// ---- Model-based Targets (build_stats.py compute_td_matchup_model) ----
// Each side's strength in a spot = opponent-adjusted TDs per game (so a
// soft or brutal schedule doesn't inflate/bury anyone) blended 50/50 with
// opponent-adjusted expected TDs from usage (targets/carries weighted by
// where on the field they happened) -- the "due" half: an offense feeding
// WRs near the goal line rates well there even before the TDs land.
// Offense and defense weigh equally (an elite offense manufactures its
// own chances). Qualifies when the combined score clears the bar AND
// neither side is a clear mismatch the wrong way: a good offense vs. a
// slightly-better-than-average defense can make it (the "Lions are still
// the Lions" case), a below-average offense can't.
const MODEL_TARGET_MIN_SCORE = 0.6;
const MODEL_TARGET_DEF_FLOOR = -0.5;
const MODEL_TARGET_OFF_FLOOR = -0.3;
const MODEL_DUE_GAP = 0.75; // usage z this far above TD z = "due"
// One clearly extreme side carries a target on its own when the other side
// isn't clearly against it (user 2026-10-02: IND allowing 70% of its TDs,
// 2.3/game, from <=10 yds averaged out below the bar against a near-average
// WAS offense and never showed). Same floors as above still apply.
const MODEL_TARGET_SOLO_Z = 1.0;
// Distance CONCENTRATION (user 2026-10-02, TEN @ BAL): BAL allows 75% of its
// TDs from <=10 yds and TEN scores 75% of its own there, but per-game volume
// was ordinary on both sides so nothing showed. Share-of-TDs z's catch the
// "how TDs happen in this matchup" signal: one side concentrated (z >= 0.75)
// and the other leaning the same way (z >= 0), each with 4+ TDs of sample.
const SHARE_TARGET_LEAD_Z = 0.75;
const SHARE_TARGET_MIN_TDS = 4;
function bucketShareZ(team, side, key) {
  const dict = side === "off" ? "td_by_length" : "td_by_length_allowed";
  const total = side === "off" ? "total_td" : "total_td_allowed";
  const share = (t) => {
    const s = DATA.team_stats[t];
    return s[total] >= SHARE_TARGET_MIN_TDS ? (s[dict][key] || 0) / s[total] : null;
  };
  const v = share(team);
  if (v === null) return null;
  return zScore(v, teamsWithGames().map(share).filter((x) => x !== null), false);
}
function shareTargetEntry(offTeam, defTeam, key, label) {
  const off = bucketShareZ(offTeam, "off", key);
  const def = bucketShareZ(defTeam, "def", key);
  if (off === null || def === null) return null;
  const lead = (def >= SHARE_TARGET_LEAD_Z && off >= 0) || (off >= SHARE_TARGET_LEAD_Z && def >= 0);
  return lead ? { label, score: 0.5 * off + 0.5 * def, metric: key, share: true } : null;
}
// This offense's chance to score the game's first TD, from the same model
// the First TD section shows -- the "First TD" target must agree with it.
function firstTdChanceFor(offTeam, defTeam) {
  const game = (DATA.schedule || []).find((g) => g.status !== "final" && ((g.away === offTeam && g.home === defTeam) || (g.away === defTeam && g.home === offTeam)));
  if (!game) return null;
  return game.away === offTeam ? firstTdTeamChance(offTeam, defTeam) : 1 - firstTdTeamChance(defTeam, offTeam);
}

function modelZ(team, side, metric, field) {
  const model = DATA.td_matchup_model;
  const get = (t) => model[t]?.[side]?.[metric]?.[field];
  const pool = teamsWithGames().map(get).filter((v) => v !== null && v !== undefined);
  const v = get(team);
  return v === null || v === undefined ? null : zScore(v, pool, false);
}
function modelSideZ(team, side, metric) {
  const adj = modelZ(team, side, metric, "adj");
  const xtd = modelZ(team, side, metric, "xtd");
  if (adj === null) return { z: null };
  return { z: xtd === null ? adj : 0.5 * adj + 0.5 * xtd, adj, xtd };
}
// "Soft D" (user 2026-10-02, NE @ BUF): a clearly soft defense (z >= 1.0)
// flags even when this offense hasn't produced there -- BUF had allowed 5
// RB TDs (3rd most) while NE's backs had 1 after facing SEA/PIT/JAX. Offense
// floor drops to MODEL_SOFT_OFF_FLOOR so a truly absent unit still won't
// flag; the chip is marked defense-led (dashed) so it never reads as a
// confirmed two-sided edge, and the row still shows both numbers.
const MODEL_SOFT_OFF_FLOOR = -1.5;
// Soft D only where defensive TD counts carry real volume (positions,
// rush/pass, <=10 yds) -- 11-20 / 21-40 / 41+ and First TD swing on 2-3 plays.
// At most MODEL_SOFT_MAX per team side, softest defenses first.
const MODEL_SOFT_METRICS = new Set(["QB", "RB", "WR", "TE", "rush", "pass", "10_or_less"]);
const MODEL_SOFT_MAX = 2;
function modelEntry(label, off, def, allowSoft = false) {
  if (off.z === null || def.z === null) return null;
  if (def.z < MODEL_TARGET_DEF_FLOOR) return null;
  const softSpot = allowSoft && def.z >= MODEL_TARGET_SOLO_Z && off.z >= MODEL_SOFT_OFF_FLOOR;
  if (off.z < MODEL_TARGET_OFF_FLOOR && !softSpot) return null;
  const score = 0.5 * def.z + 0.5 * off.z;
  const solo = def.z >= MODEL_TARGET_SOLO_Z || off.z >= MODEL_TARGET_SOLO_Z;
  if (score < MODEL_TARGET_MIN_SCORE && !solo) return null;
  const due = off.xtd !== undefined && off.xtd !== null && off.xtd - off.adj >= MODEL_DUE_GAP && off.xtd >= 0.3;
  return { label, score, due, defLed: off.z < MODEL_TARGET_OFF_FLOOR, defZ: def.z };
}
function modelTargetGroups(offTeam, defTeam) {
  const pair = (metric, label) => {
    const e = modelEntry(label, modelSideZ(offTeam, "off", metric), modelSideZ(defTeam, "def", metric), MODEL_SOFT_METRICS.has(metric));
    return e && { ...e, metric };
  };
  const stat = (key) => (t) => DATA.team_stats[t][key];
  const clean = (list) => list.filter(Boolean).sort((a, b) => b.score - a.score);
  const rzEntry = targetEntry("Red Zone", targetRateZ(offTeam, stat("rz_td_rate")), targetRateZ(defTeam, stat("rz_td_rate_allowed")));
  const rz = rzEntry && { ...rzEntry, metric: "rz" };
  // First TD only for the side the First TD model also favors -- the card
  // must not call TEN a First TD target while its First TD bar says BAL 60%.
  const firstChance = firstTdChanceFor(offTeam, defTeam);
  const first = firstChance === null || firstChance >= 0.5 ? pair("first", "First TD") : null;
  // Volume target first; if a bucket didn't qualify on volume, a strong
  // shared concentration can still carry it.
  const distance = LENGTH_BUCKETS.map(({ key, label }) => pair(key, label) || shareTargetEntry(offTeam, defTeam, key, label));
  const groups = [
    { title: "Type", items: clean([pair("pass", "Pass TD"), pair("rush", "Rush TD"), first]) },
    { title: "Position", items: clean(POSITIONS.map((pos) => pair(pos, pos))) },
    { title: "Distance", items: clean([...distance, rz]) },
  ];
  const keepSoft = new Set(
    groups.flatMap((g) => g.items).filter((i) => i.defLed && i.label !== "DST")
      .sort((a, b) => b.defZ - a.defZ).slice(0, MODEL_SOFT_MAX)
  );
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.defLed || keepSoft.has(i)) }));
}

// No DST targets anywhere (user 2026-10-02, extended to the TD Targets panel
// 2026-10-05): defensive/return TDs are random and nobody's betting them.
// The DST stat rows in the tables stay -- they're data, not a target.
function targetGroups(offTeam, defTeam) {
  return targetGroupsAll(offTeam, defTeam).map((g) => ({ ...g, items: g.items.filter((i) => i.metric !== "DST" && i.label !== "DST") }));
}
function targetGroupsAll(offTeam, defTeam) {
  if (DATA.td_matchup_model?.[offTeam] && DATA.td_matchup_model?.[defTeam]) return modelTargetGroups(offTeam, defTeam);
  const stat = (key) => (t) => DATA.team_stats[t][key];
  const type = [
    targetEntry("Pass TD", targetRateZ(offTeam, stat("pass_td_per_g")), targetRateZ(defTeam, stat("pass_td_allowed_per_g"))),
    targetEntry("Rush TD", targetRateZ(offTeam, stat("rush_td_per_g")), targetRateZ(defTeam, stat("rush_td_allowed_per_g"))),
    targetEntry("First TD", targetRateZ(offTeam, stat("first_td_rate")), targetRateZ(defTeam, firstTdAllowedRate)),
  ];
  const position = POSITIONS.map((pos) =>
    targetEntry(pos, targetBucketZ(offTeam, "off_position_td", "total_td", pos), targetBucketZ(defTeam, "def_position_td_allowed", "total_td_allowed", pos))
  );
  const distance = [
    ...LENGTH_BUCKETS.map(({ key, label }) =>
      targetEntry(label, targetBucketZ(offTeam, "td_by_length", "total_td", key), targetBucketZ(defTeam, "td_by_length_allowed", "total_td_allowed", key))
    ),
    targetEntry("Red Zone", targetRateZ(offTeam, stat("rz_td_rate")), targetRateZ(defTeam, stat("rz_td_rate_allowed"))),
  ];
  const clean = (list) => list.filter(Boolean).sort((a, b) => b.score - a.score);
  return [
    { title: "Type", items: clean(type) },
    { title: "Position", items: clean(position) },
    { title: "Distance", items: clean(distance) },
  ];
}

// ---- Matchup tags: situational flags worth a look, no verdict ----
// Each compares this offense with this defense against the league (z of
// per-game or rate stats); "good" = an opening for the offense, "warn" =
// something working against it. Tooltips carry the raw numbers so the
// reader can judge. Thresholds are deliberately tight so tags stay rare.
const TAG_Z = 0.75;
const TAG_MIN_RZ_TRIPS = 3;
const TAG_MIN_SPLIT_PLAYS = 10;
const TAG_MIN_LANE_CARRIES = 4;
const RUSH_LANE_LABELS = {
  left_end: "L End", left_tackle: "L Tackle", left_guard: "L Guard", middle: "Middle",
  right_guard: "R Guard", right_tackle: "R Tackle", right_end: "R End",
};

function tagLeague(key) {
  const vals = teamsWithGames().map((t) => DATA.team_stats[t][key]).filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function tagPct(v) {
  return v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`;
}
function tagNum(v, d = 1) {
  return v === null || v === undefined ? "--" : String(Number(Number(v).toFixed(d)));
}

// League-average share of TDs (scored or allowed) that go to one position,
// among teams with enough TDs for a share to mean anything.
const WEAK_SPOT_MIN_TDS = 4;
function positionShareLeague(side, pos) {
  const dict = side === "off" ? "off_position_td" : "def_position_td_allowed";
  const total = side === "off" ? "total_td" : "total_td_allowed";
  const vals = teamsWithGames()
    .map((t) => DATA.team_stats[t])
    .filter((s) => s[total] >= WEAK_SPOT_MIN_TDS)
    .map((s) => (s[dict][pos] || 0) / s[total]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
// A strong TD defense's relative weak spot: overall TD/g allowed clearly
// better than average (z >= 0.4), and one skill position's share of the
// TDs it allows clearly above that position's league share (z >= 0.75,
// 2+ TDs). Null otherwise -- a bad defense's holes are already targets.
function defenseWeakSpot(defTeam) {
  const d = DATA.team_stats[defTeam];
  if (!d || d.total_td_allowed < WEAK_SPOT_MIN_TDS) return null;
  const overall = statZ("total_td_allowed_per_g", true)(defTeam);
  if (overall === null || overall < 0.4) return null;
  let best = null;
  ["QB", "RB", "WR", "TE"].forEach((pos) => {
    const count = d.def_position_td_allowed[pos] || 0;
    if (count < 2) return;
    const shareOf = (t) => {
      const s = DATA.team_stats[t];
      return s.total_td_allowed >= WEAK_SPOT_MIN_TDS ? (s.def_position_td_allowed[pos] || 0) / s.total_td_allowed : null;
    };
    const pool = teamsWithGames().map(shareOf).filter((v) => v !== null);
    const share = count / d.total_td_allowed;
    const z = zScore(share, pool, false);
    if (z !== null && z >= 0.75 && (!best || z > best.z)) best = { pos, share, z, league: positionShareLeague("def", pos) };
  });
  return best;
}

function matchupTags(offTeam, defTeam) {
  const o = DATA.team_stats[offTeam];
  const d = DATA.team_stats[defTeam];
  const z = (key, team, invert = false) => statZ(key, invert)(team);
  const ok = (...vals) => vals.every((v) => v !== null && v !== undefined);
  const tags = [];
  const add = (kind, label, title) => tags.push({ kind, label, title });

  // Red zone leak / wall
  if (d.rz_trips_allowed >= TAG_MIN_RZ_TRIPS) {
    const dz = z("rz_td_rate_allowed", defTeam);
    const oz = z("rz_td_rate", offTeam);
    const t = `${defTeam} allows RZ TD ${tagPct(d.rz_td_rate_allowed)} (lg ${tagPct(tagLeague("rz_td_rate_allowed"))}) · ${offTeam} scores ${tagPct(o.rz_td_rate)}`;
    if (ok(dz, oz) && dz >= TAG_Z && oz >= -0.3) add("good", "RZ leak", t);
    // A wall only when the offense isn't an elite finisher itself.
    else if (matchupCall(oz, dz, TAG_Z).dir < 0) add("warn", "RZ wall", t);
  }

  // Goal-line run vs pass: offense's red zone lean meets the defense's weak side
  const passLean = z("rz_pass_rate", offTeam);
  const rushLean = z("rz_rush_rate", offTeam);
  const passLeak = z("rz_pass_td_rate_allowed", defTeam);
  const rushLeak = z("rz_rush_td_rate_allowed", defTeam);
  if (ok(passLean, passLeak) && passLean >= 0.5 && passLeak >= 0.6) {
    add("good", "RZ pass edge", `${offTeam} passes ${tagPct(o.rz_pass_rate)} in RZ · ${defTeam} allows TD on ${tagPct(d.rz_pass_td_rate_allowed)} of RZ tgts (lg ${tagPct(tagLeague("rz_pass_td_rate_allowed"))})`);
  }
  if (ok(rushLean, rushLeak) && rushLean >= 0.5 && rushLeak >= 0.6) {
    add("good", "Goal-line run edge", `${offTeam} runs ${tagPct(o.rz_rush_rate)} in RZ · ${defTeam} allows TD on ${tagPct(d.rz_rush_td_rate_allowed)} of RZ car (lg ${tagPct(tagLeague("rz_rush_td_rate_allowed"))})`);
  }

  // Red zone trip volume
  const volZ = avgZ(z("rz_trips_per_g", offTeam), z("rz_trips_allowed_per_g", defTeam));
  if (volZ !== null) {
    const t = `${offTeam} ${tagNum(o.rz_trips_per_g)} RZ trips/g · ${defTeam} allows ${tagNum(d.rz_trips_allowed_per_g)}/g (lg ${tagNum(tagLeague("rz_trips_per_g"))})`;
    if (volZ >= TAG_Z) add("good", "RZ volume", t);
    else if (volZ <= -TAG_Z) add("warn", "Few RZ trips", t);
  }

  // Short fields / turnover risk
  const shortZ = avgZ(z("turnovers_per_g", defTeam), z("takeaways_per_g", offTeam));
  if (shortZ !== null && shortZ >= TAG_Z) {
    add("good", "Short fields", `${defTeam} avg ${tagNum(d.turnovers_per_g)} TO/g · ${offTeam} DEF forces ${tagNum(o.takeaways_per_g)}/g (lg ${tagNum(tagLeague("takeaways_per_g"))})`);
  }
  const riskZ = avgZ(z("turnovers_per_g", offTeam), z("takeaways_per_g", defTeam));
  if (riskZ !== null && riskZ >= TAG_Z) {
    add("warn", "Turnover risk", `${offTeam} avg ${tagNum(o.turnovers_per_g)} TO/g · ${defTeam} DEF forces ${tagNum(d.takeaways_per_g)}/g (lg ${tagNum(tagLeague("takeaways_per_g"))})`);
  }

  // Big-play vulnerability (pass and run)
  for (const [kind, label, offKey, defKey, desc] of [
    ["pass", "Big-play pass", "explosive_pass_rate", "explosive_pass_rate_allowed", "15+ yd passes"],
    ["rush", "Big-play run", "explosive_rush_rate", "explosive_rush_rate_allowed", "10+ yd runs"],
  ]) {
    const oz = z(offKey, offTeam);
    const dz = z(defKey, defTeam);
    if (!ok(oz, dz)) continue;
    const t = `${desc}: ${offTeam} ${tagPct(o[offKey])} · ${defTeam} allows ${tagPct(d[defKey])} (lg ${tagPct(tagLeague(defKey))})`;
    if (dz >= 0.6 && oz >= 0) add("good", label, t);
    else if (dz <= -TAG_Z && oz >= 0.6) add("warn", kind === "pass" ? "Limits big passes" : "Limits big runs", t);
  }

  // Deep-ball / end-zone exposure (opponent-adjusted targets per game)
  if (DATA.td_matchup_model) {
    const dz = avgZ(modelZ(defTeam, "def", "ez", "adj"), modelZ(defTeam, "def", "deep", "adj"));
    const oz = avgZ(modelZ(offTeam, "off", "ez", "adj"), modelZ(offTeam, "off", "deep", "adj"));
    const m = DATA.td_matchup_model;
    if (ok(dz, oz) && dz >= 0.6 && oz >= 0) {
      add("good", "Deep / EZ exposed", `${defTeam} allows ${tagNum(m[defTeam].def.deep?.adj)} deep tgts/g · ${tagNum(m[defTeam].def.ez?.adj)} EZ tgts/g · ${offTeam} throws ${tagNum(m[offTeam].off.deep?.adj)} deep · ${tagNum(m[offTeam].off.ez?.adj)} EZ`);
    }
  }

  // Pressure / blitz looks: the defense has to lean on the look (relevance),
  // then the call reads BOTH sides of it (matchupCall) -- the offense's
  // result against the look AND the defense's own result when it shows it.
  const lookCall = (offKey, defKey) => matchupCall(z(offKey, offTeam), z(defKey, defTeam), 0.5);
  const allowedTxt = (key) => `${defTeam} allows ${tagPct(d[key])} (lg ${tagPct(tagLeague(key))})`;
  if (o.success_vs_clean_pocket_plays >= TAG_MIN_SPLIT_PLAYS) {
    const pz = z("pressure_rate", defTeam);
    if (ok(pz) && pz <= -0.6 && lookCall("success_vs_clean_pocket", "def_success_allowed_clean_pocket").dir > 0) {
      add("good", "Clean pocket", `${defTeam} pressure ${tagPct(d.pressure_rate)} (lg ${tagPct(tagLeague("pressure_rate"))}) · ${offTeam} clean-pocket success ${tagPct(o.success_vs_clean_pocket)} · ${allowedTxt("def_success_allowed_clean_pocket")}`);
    }
  }
  if (o.success_vs_pressure_plays >= TAG_MIN_SPLIT_PLAYS) {
    const pz = z("pressure_rate", defTeam);
    if (ok(pz) && pz >= 0.6 && lookCall("success_vs_pressure", "def_success_allowed_pressure").dir < 0) {
      add("warn", "Pressure trouble", `${defTeam} pressure ${tagPct(d.pressure_rate)} (lg ${tagPct(tagLeague("pressure_rate"))}) · ${offTeam} success when pressured ${tagPct(o.success_vs_pressure)} · ${allowedTxt("def_success_allowed_pressure")}`);
    }
  }
  if (o.success_vs_blitz_plays >= TAG_MIN_SPLIT_PLAYS) {
    const bz = z("blitz_rate", defTeam);
    if (ok(bz) && bz >= 0.6 && lookCall("success_vs_blitz", "def_success_allowed_blitz").dir > 0) {
      add("good", "Beats the blitz", `${defTeam} blitz ${tagPct(d.blitz_rate)} (lg ${tagPct(tagLeague("blitz_rate"))}) · ${offTeam} success vs blitz ${tagPct(o.success_vs_blitz)} · ${allowedTxt("def_success_allowed_blitz")}`);
    }
  }

  // Pace / play volume (game-level: both teams)
  const paceZ = avgZ(z("off_plays_per_g", offTeam), z("off_plays_per_g", defTeam));
  if (paceZ !== null) {
    const t = `${offTeam} ${tagNum(o.off_plays_per_g, 0)} plays/g · ${defTeam} ${tagNum(d.off_plays_per_g, 0)} (lg ${tagNum(tagLeague("off_plays_per_g"), 0)})`;
    if (paceZ >= TAG_Z) add("good", "High pace", t);
    else if (paceZ <= -TAG_Z) add("warn", "Slow pace", t);
  }

  // Run lane edge: this offense runs well to a lane the defense can't hold
  let bestLane = null;
  for (const lane of Object.keys(RUSH_LANE_LABELS)) {
    if ((o[`rush_carries_${lane}`] || 0) < TAG_MIN_LANE_CARRIES || (d[`rush_carries_allowed_${lane}`] || 0) < TAG_MIN_LANE_CARRIES) continue;
    const oz = z(`rush_ypc_${lane}`, offTeam);
    const dz = z(`rush_ypc_allowed_${lane}`, defTeam);
    if (!ok(oz, dz) || oz < 0.5 || dz < 0.6) continue;
    if (!bestLane || oz + dz > bestLane.score) bestLane = { lane, score: oz + dz };
  }
  if (bestLane) {
    const l = bestLane.lane;
    add("good", `Run lane: ${RUSH_LANE_LABELS[l]}`, `${offTeam} ${tagNum(o[`rush_ypc_${l}`])} YPC (${o[`rush_carries_${l}`]} car) · ${defTeam} allows ${tagNum(d[`rush_ypc_allowed_${l}`])} (${d[`rush_carries_allowed_${l}`]} car)`);
  }

  // Box-count edge: same two-sided read -- the offense's YPC against the
  // box AND what this defense allows when it shows that box.
  if (o.ypc_vs_light_box_plays >= TAG_MIN_SPLIT_PLAYS) {
    const lz = z("box_light_rate", defTeam);
    if (ok(lz) && lz >= 0.6 && lookCall("ypc_vs_light_box", "def_ypc_allowed_light_box").dir > 0) {
      add("good", "Light-box runs", `${defTeam} light box ${tagPct(d.box_light_rate)} (lg ${tagPct(tagLeague("box_light_rate"))}) · ${offTeam} ${tagNum(o.ypc_vs_light_box)} YPC vs light · ${defTeam} allows ${tagNum(d.def_ypc_allowed_light_box)}`);
    }
  }
  if (o.ypc_vs_heavy_box_plays >= TAG_MIN_SPLIT_PLAYS) {
    const hz = z("box_heavy_rate", defTeam);
    if (ok(hz) && hz >= 0.6 && lookCall("ypc_vs_heavy_box", "def_ypc_allowed_heavy_box").dir > 0) {
      add("good", "Beats stacked box", `${defTeam} 7+ box ${tagPct(d.box_heavy_rate)} (lg ${tagPct(tagLeague("box_heavy_rate"))}) · ${offTeam} ${tagNum(o.ypc_vs_heavy_box)} YPC vs 7+ · ${defTeam} allows ${tagNum(d.def_ypc_allowed_heavy_box)}`);
    }
  }

  // Weak spot (user 2026-10-02, NE D): a defense that's solid at stopping
  // TDs overall, but one position scores an outsized share of what it does
  // allow -- "if NE has a weakness, it's WRs". Reads both sides: the text
  // also shows how much this offense scores through that position.
  // Shown regardless of how much this offense uses that position (the user
  // wants the defense's tendency visible); the offense's own share is printed
  // right in the line so the reader sees both sides.
  const weak = defenseWeakSpot(defTeam);
  if (weak) {
    const offShare = o.total_td ? (o.off_position_td[weak.pos] || 0) / o.total_td : null;
    add(
      "good",
      `Weak spot: ${weak.pos}`,
      `${defTeam} allows ${tagNum(d.total_td_allowed_per_g)} TD/g (lg ${tagNum(tagLeague("total_td_allowed_per_g"))}) · ${weak.pos}s score ${tagPct(weak.share)} of them (lg ${tagPct(weak.league)}) · ${offTeam} ${weak.pos}s: ${tagPct(offShare)} of its TDs (lg ${tagPct(positionShareLeague("off", weak.pos))})`
    );
  }

  return tags.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "good" ? -1 : 1));
}

function renderMatchupTags(offTeam, defTeam) {
  const tags = matchupTags(offTeam, defTeam);
  const chips = tags.length
    ? tags.map((t) => `<span class="tag-chip tag-chip-${t.kind}" title="${t.title.replace(/"/g, "&quot;")}">${t.label}</span>`).join("")
    : `<span class="target-none">&mdash;</span>`;
  return `<div class="target-group"><div class="target-group-title">Tags</div><div class="target-chips">${chips}</div></div>`;
}

function renderTargets(awayTeam, homeTeam) {
  const block = (offTeam, defTeam) => {
    const rgb = teamAccentRgb(offTeam);
    const groups = targetGroups(offTeam, defTeam)
      .map((g) => {
        const chips = g.items.length
          ? g.items
              .map((i) => {
                const due = i.due ? `<span class="target-due" title="Usage running ahead of TDs so far">&#9650;</span>` : "";
                return `<span class="target-chip${i.score >= TARGET_STRONG_SCORE ? " target-chip-strong" : ""}">${i.label}${due}</span>`;
              })
              .join("")
          : `<span class="target-none">&mdash;</span>`;
        return `<div class="target-group"><div class="target-group-title">${g.title}</div><div class="target-chips">${chips}</div></div>`;
      })
      .join("");
    return `<div class="target-block">
      <div class="target-team" style="background:rgba(${rgb.join(",")},0.18);border-left:3px solid rgb(${rgb.join(",")})">${teamLogoMini(offTeam, 18)} ${offTeam} <span class="target-vs">vs ${teamLogoMini(defTeam, 14)} ${defTeam} D</span></div>
      ${groups}
      ${renderMatchupTags(offTeam, defTeam)}
    </div>`;
  };
  return `${block(awayTeam, homeTeam)}${block(homeTeam, awayTeam)}
    <div class="target-legend"><span class="target-chip target-chip-strong">Strong</span><span class="target-chip">Lean</span>${
      DATA.td_matchup_model ? `<span class="target-legend-due"><span class="target-due">&#9650;</span> due</span>` : ""
    }</div>
    ${DATA.td_matchup_model ? `<p class="target-note">Schedule-adjusted &middot; includes usage</p>` : ""}`;
}

function renderLengthTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const rows = LENGTH_BUCKETS.map(({ key, label }) => {
    const offCount = off.td_by_length[key] || 0;
    const defCount = def.td_by_length_allowed[key] || 0;
    const offCountCls = bucketCountTier("td_by_length", key, offTeam);
    const offShareCls = bucketShareTier("td_by_length", "total_td", key, offTeam);
    const defCountCls = bucketCountTier("td_by_length_allowed", key, defTeam, true);
    const defShareCls = bucketShareTier("td_by_length_allowed", "total_td_allowed", key, defTeam, true);
    const offShareExtreme = bucketShareTier("td_by_length", "total_td", key, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("td_by_length_allowed", "total_td_allowed", key, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offCountA = bucketCountAlphaAttr("td_by_length", key, offTeam);
    const offShareA = bucketShareAlphaAttr("td_by_length", "total_td", key, offTeam);
    const defCountA = bucketCountAlphaAttr("td_by_length_allowed", key, defTeam, true);
    const defShareA = bucketShareAlphaAttr("td_by_length_allowed", "total_td_allowed", key, defTeam, true);
    const offShare = off.total_td ? Math.round((offCount / off.total_td) * 100) : 0;
    const defShare = def.total_td_allowed ? Math.round((defCount / def.total_td_allowed) * 100) : 0;
    const offCountCell = numCell(offCount, offCountCls, offCountA, { team: offTeam, dictKey: "td_by_length", bucketKey: key, label: `${label} TDs`, invert: false });
    const offShareCell = numCell(`${offShare}%`, offShareCls, offShareA, { team: offTeam, shareOf: { dictKey: "td_by_length", totalKey: "total_td", bucketKey: key }, label: `${label} TD Share`, invert: false, percent: true });
    const defCountCell = numCell(defCount, defCountCls, defCountA, { team: defTeam, dictKey: "td_by_length_allowed", bucketKey: key, label: `${label} TDs Allowed`, invert: true });
    const defShareCell = numCell(`${defShare}%`, defShareCls, defShareA, { team: defTeam, shareOf: { dictKey: "td_by_length_allowed", totalKey: "total_td_allowed", bucketKey: key }, label: `${label} TD Allowed Share`, invert: true, percent: true });
    return `<tr><td><span class="dist-row-click" data-bucket="${key}">${label}</span></td>${offCountCell}${offShareCell}${defCountCell}${defShareCell}${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  // A 5th row, same Total/% shape as the length buckets above -- Total here
  // is red zone trips (not a TD-length bucket), % is the conversion rate
  // once there: how often a trip inside the 20 actually ends in a score,
  // offense's own rate vs. what this defense allows. Rounds Distance out to
  // the same row count as TD Type/Position instead of running one short.
  const rzOffTripsCls = tierFor("rz_trips", offTeam, false);
  const rzDefTripsCls = tierFor("rz_trips_allowed", defTeam, true);
  const rzOffTripsA = tierForAlphaAttr("rz_trips", offTeam, false);
  const rzDefTripsA = tierForAlphaAttr("rz_trips_allowed", defTeam, true);
  const rzOffCls = tierFor("rz_td_rate", offTeam, false);
  const rzDefCls = tierFor("rz_td_rate_allowed", defTeam, true);
  const rzOffExtreme = tierFor("rz_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
  const rzDefExtreme = tierFor("rz_td_rate_allowed", defTeam, true, TIER_Z_EXTREME_THRESHOLD);
  const rzOffA = tierForAlphaAttr("rz_td_rate", offTeam, false);
  const rzDefA = tierForAlphaAttr("rz_td_rate_allowed", defTeam, true);
  const rzOffTripsCell = numCell(off.rz_trips, rzOffTripsCls, rzOffTripsA, { team: offTeam, statKey: "rz_trips", label: "RZ Trips", invert: false });
  const rzOffCell = numCell(`${Math.round(off.rz_td_rate * 100)}%`, rzOffCls, rzOffA, { team: offTeam, statKey: "rz_td_rate", label: "RZ TD Rate", invert: false, percent: true });
  const rzDefTripsCell = numCell(def.rz_trips_allowed, rzDefTripsCls, rzDefTripsA, { team: defTeam, statKey: "rz_trips_allowed", label: "RZ Trips Allowed", invert: true });
  const rzDefCell = numCell(`${Math.round(def.rz_td_rate_allowed * 100)}%`, rzDefCls, rzDefA, { team: defTeam, statKey: "rz_td_rate_allowed", label: "RZ TD Rate Allowed", invert: true, percent: true });
  const rzRow = `<tr><td>RZ %</td>${rzOffTripsCell}${rzOffCell}${rzDefTripsCell}${rzDefCell}${edgeCell(rzOffCls, rzDefCls, offTeam, defTeam, rzOffExtreme, rzDefExtreme)}</tr>`;

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}${rzRow}</tbody>
  </table>`;
}

function renderPositionTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];
  const rows = POSITIONS.map((pos) => {
    const offCount = off.off_position_td[pos];
    const defCount = def.def_position_td_allowed[pos];
    const offShare = off.total_td ? offCount / off.total_td : 0;
    const defShare = def.total_td_allowed ? defCount / def.total_td_allowed : 0;
    const offCountCls = bucketCountTier("off_position_td", pos, offTeam);
    const offShareCls = bucketShareTier("off_position_td", "total_td", pos, offTeam);
    const defCountCls = bucketCountTier("def_position_td_allowed", pos, defTeam, true);
    const defShareCls = bucketShareTier("def_position_td_allowed", "total_td_allowed", pos, defTeam, true);
    const offShareExtreme = bucketShareTier("off_position_td", "total_td", pos, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("def_position_td_allowed", "total_td_allowed", pos, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offCountCell = numCell(offCount, offCountCls, "", { team: offTeam, dictKey: "off_position_td", bucketKey: pos, label: `${pos} TDs`, invert: false });
    const offShareCell = numCell(`${Math.round(offShare * 100)}%`, offShareCls, "", { team: offTeam, shareOf: { dictKey: "off_position_td", totalKey: "total_td", bucketKey: pos }, label: `${pos} TD Share`, invert: false, percent: true });
    const defCountCell = numCell(defCount, defCountCls, "", { team: defTeam, dictKey: "def_position_td_allowed", bucketKey: pos, label: `${pos} TDs Allowed`, invert: true });
    const defShareCell = numCell(`${Math.round(defShare * 100)}%`, defShareCls, "", { team: defTeam, shareOf: { dictKey: "def_position_td_allowed", totalKey: "total_td_allowed", bucketKey: pos }, label: `${pos} TD Allowed Share`, invert: true, percent: true });
    return `<tr><td><span class="pos-row-click" data-pos="${pos}">${pos}</span></td>${offCountCell}${offShareCell}${defCountCell}${defShareCell}${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table pos-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "%"])}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- TD breakdown modal: clicking a Position or Distance row shows the
// actual players behind that team-level number, both teams at once, grouped
// by every position (or every distance bucket) so the clicked row is a
// starting point to scroll to -- not a filter that hides the rest. Reuses
// the .modal-overlay/.modal-box shell pattern (own instance, matching how
// every other modal on this site is its own self-contained overlay rather
// than a shared one) but is otherwise independent of the player-odds modal.
function tdBreakdownGroups(kind, awayTeam, homeTeam) {
  const allPlayers = [awayTeam, homeTeam].flatMap((t) => (DATA.player_stats[t] || []).map((p) => ({ ...p, team: t })));
  if (kind === "position") {
    return POSITIONS.map((pos) => ({
      key: pos,
      label: pos,
      players: allPlayers
        .filter((p) => p.position === pos)
        .map((p) => ({ ...p, count: p.tds }))
        .sort((a, b) => b.count - a.count),
    }));
  }
  return LENGTH_BUCKETS.map(({ key, label }) => ({
    key,
    label,
    players: allPlayers
      .filter((p) => (p.tds_by_length[key] || 0) > 0)
      .map((p) => ({ ...p, count: p.tds_by_length[key] }))
      .sort((a, b) => b.count - a.count),
  }));
}

function tdBreakdownPlayerRow(p, kind) {
  const rgb = teamAccentRgb(p.team);
  const rowStyle = `border-left:4px solid rgb(${rgb.join(",")}); background:rgba(${rgb.join(",")},0.07);`;
  let countLabel = `${p.count} TD${p.count === 1 ? "" : "s"}`;
  // Only worth calling out when it's actually a mix -- a pure rusher or
  // pure receiver doesn't need "(N rush)" restating what the position
  // column already implies.
  if (kind === "position" && p.rush_tds > 0 && p.rec_tds > 0) {
    countLabel += ` <span class="muted-label">(${p.rush_tds} rush / ${p.rec_tds} rec)</span>`;
  }
  const dstTag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
  // Season-long target rank within the player's own team (1 = most
  // targeted WR) -- tells you whether a defense gave up a TD to a team's
  // clear #1 option or someone further down the depth chart.
  const wrRankTag = p.position === "WR" && p.wr_rank ? ` <span class="muted-label">(WR${p.wr_rank})</span>` : "";
  return `<tr style="${rowStyle}"><td>${teamLogoMini(p.team)} ${p.position === "DST" ? p.name : playerClick(p.team, p.name)}${wrRankTag}${dstTag}</td><td class="num">${countLabel}</td></tr>`;
}

function renderTdBreakdownModalContent(kind, awayTeam, homeTeam, highlightKey) {
  const title = kind === "position" ? "Touchdowns by Position" : "Touchdowns by Distance";
  const groups = tdBreakdownGroups(kind, awayTeam, homeTeam);
  const sections = groups
    .map((g) => {
      const rows = g.players.length
        ? g.players.map((p) => tdBreakdownPlayerRow(p, kind)).join("")
        : `<tr><td colspan="2" class="no-data-note">No one yet</td></tr>`;
      const highlightCls = g.key === highlightKey ? " td-breakdown-group-highlight" : "";
      return `<div class="td-breakdown-group${highlightCls}" id="td-breakdown-group-${g.key}">
        <h3>${g.label}</h3>
        <table class="data-table td-breakdown-table">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
  return `<h3>${awayTeam} @ ${homeTeam} &mdash; ${title}</h3>${sections}`;
}

function ensureTdBreakdownModal() {
  if (document.getElementById("td-breakdown-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "td-breakdown-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="td-breakdown-modal-content"></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTdBreakdownModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeTdBreakdownModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTdBreakdownModal();
  });
}

function closeTdBreakdownModal() {
  const el = document.getElementById("td-breakdown-modal");
  if (el) el.hidden = true;
}

function openTdBreakdownModal(kind, awayTeam, homeTeam, highlightKey) {
  ensureTdBreakdownModal();
  document.getElementById("td-breakdown-modal-content").innerHTML = renderTdBreakdownModalContent(kind, awayTeam, homeTeam, highlightKey);
  document.getElementById("td-breakdown-modal").hidden = false;
  const target = document.getElementById(`td-breakdown-group-${highlightKey}`);
  if (target) target.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (e) => {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  if (!away || !home) return;
  const posBtn = e.target.closest(".pos-row-click");
  if (posBtn) {
    openTdBreakdownModal("position", away, home, posBtn.dataset.pos);
    return;
  }
  const distBtn = e.target.closest(".dist-row-click");
  if (distBtn) openTdBreakdownModal("distance", away, home, distBtn.dataset.bucket);
});

// Shared full-width header for every per-team player table (Season TDs'
// leaderboard, First TD's Red Zone Usage) so both read as the same
// component -- these boxes run tall with rows of player data, so there's
// plenty of width to spare for a real logo and the full team name instead
// of a bare "<h3>NE</h3>".
function renderLeaderboard(team) {
  const players = DATA.player_stats[team] || [];
  if (players.length === 0) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No TDs scored yet this season.</p>`;
  }
  const maxTds = Math.max(...players.map((p) => p.tds));
  const maxFirstTds = Math.max(...players.map((p) => p.first_tds));
  const rows = players
    .map((p) => {
      const tag = p.position !== "DST" && p.dst_tds > 0 ? ` <span class="dst-tag">(DST)</span>` : "";
      const tdBg = teamFade(team, maxTds ? p.tds / maxTds : 0);
      const firstTdBg = teamFade(team, maxFirstTds ? p.first_tds / maxFirstTds : 0);
      return `<tr><td>${p.position === "DST" ? p.name : playerClick(team, p.name)}${tag}</td><td>${p.position}</td><td class="num" style="background:${tdBg}">${p.tds}</td><td class="num" style="background:${firstTdBg}">${p.first_tds}</td></tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table lb-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">TDs</th><th class="num">1st TDs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- First TD view: everything that happens in a game before the very
// first touchdown is scored, condensed from the same team_stats already
// loaded above. Ported in from the old standalone first-td.html/first-td.js
// so both views can share one page, one data.json fetch, and one toggle. ----

function renderBasicsTable(offTeam, defTeam) {
  const off = DATA.team_stats[offTeam];
  const def = DATA.team_stats[defTeam];

  const offRateCls = tierFor("first_td_rate", offTeam, false);
  const defRateCls = tierForFirstTdAllowed(defTeam);
  const offRateExtreme = tierFor("first_td_rate", offTeam, false, TIER_Z_EXTREME_THRESHOLD);
  const defRateExtreme = tierForFirstTdAllowed(defTeam, TIER_Z_EXTREME_THRESHOLD);
  const offGamesCls = percentileTier(off.first_td_games, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
  const defGamesCls = percentileTier(firstTdAllowedGames(defTeam), teamsWithGames().map(firstTdAllowedGames), true);
  const offGamesA = tierAlphaAttr(off.first_td_games, teamsWithGames().map((t) => DATA.team_stats[t].first_td_games), false);
  const offRateA = tierForAlphaAttr("first_td_rate", offTeam, false);
  const defGamesA = tierAlphaAttr(firstTdAllowedGames(defTeam), teamsWithGames().map(firstTdAllowedGames), true);
  const defRateA = tierForFirstTdAllowedAlphaAttr(defTeam);

  const basicsOffGamesCell = numCell(off.first_td_games, offGamesCls, offGamesA, { team: offTeam, statKey: "first_td_games", label: "First TD Games", invert: false });
  const basicsOffRateCell = numCell(`${fmt(off.first_td_rate * 100, 0)}%`, offRateCls, offRateA, { team: offTeam, statKey: "first_td_rate", label: "First TD Rate", invert: false, percent: true });
  const basicsDefGamesCell = numCell(firstTdAllowedGames(defTeam), defGamesCls, defGamesA, { team: defTeam, computed: "firstTdAllowedGames", label: "First TD Games Allowed", invert: true });
  const basicsDefRateCell = numCell(`${fmt(firstTdAllowedRate(defTeam) * 100, 0)}%`, defRateCls, defRateA, { team: defTeam, computed: "firstTdAllowedRate", label: "First TD Rate Allowed", invert: true, percent: true });
  let rows = `<tr><td>First TD</td>${basicsOffGamesCell}${basicsOffRateCell}${basicsDefGamesCell}${basicsDefRateCell}${edgeCell(offRateCls, defRateCls, offTeam, defTeam, offRateExtreme, defRateExtreme)}</tr>`;

  rows += POSITIONS.map((pos) => {
    const offCount = off.first_td_position[pos];
    const defCount = def.first_td_position_allowed[pos];
    const offSharePct = off.first_td_games ? Math.round((offCount / off.first_td_games) * 100) : 0;
    const defSharePct = def.trailing_games ? Math.round((defCount / def.trailing_games) * 100) : 0;
    const offCountCls = bucketCountTier("first_td_position", pos, offTeam);
    const defCountCls = bucketCountTier("first_td_position_allowed", pos, defTeam, true);
    const offShareCls = bucketShareTier("first_td_position", "first_td_games", pos, offTeam);
    const defShareCls = bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true);
    const offShareExtreme = bucketShareTier("first_td_position", "first_td_games", pos, offTeam, false, TIER_Z_EXTREME_THRESHOLD);
    const defShareExtreme = bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true, TIER_Z_EXTREME_THRESHOLD);
    const offCountCell = numCell(offCount, offCountCls, "", { team: offTeam, dictKey: "first_td_position", bucketKey: pos, label: `${pos} First TDs`, invert: false });
    const offShareCell = numCell(`${offSharePct}%`, offShareCls, "", { team: offTeam, shareOf: { dictKey: "first_td_position", totalKey: "first_td_games", bucketKey: pos }, label: `${pos} First TD Share`, invert: false, percent: true });
    const defCountCell = numCell(defCount, defCountCls, "", { team: defTeam, dictKey: "first_td_position_allowed", bucketKey: pos, label: `${pos} First TDs Allowed`, invert: true });
    const defShareCell = numCell(`${defSharePct}%`, defShareCls, "", { team: defTeam, shareOf: { dictKey: "first_td_position_allowed", totalKey: "trailing_games", bucketKey: pos }, label: `${pos} First TD Allowed Share`, invert: true, percent: true });
    return `<tr><td>${pos}</td>${offCountCell}${offShareCell}${defCountCell}${defShareCell}${edgeCell(offShareCls, defShareCls, offTeam, defTeam, offShareExtreme, defShareExtreme)}</tr>`;
  }).join("");

  return `<table class="data-table stat-table">
    ${STAT_TABLE_COLGROUP}
    <thead>${headerRow(offTeam, defTeam, ["Total", "Rate"], "first_td")}</thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const percentileClsFor = (statKey, team, invert) => {
  const val = tierValue(team, statKey);
  if (val === null) return "";
  const pool = teamsWithGames().map((t) => tierValue(t, statKey)).filter((v) => v !== null);
  return percentileTier(val, pool, invert);
};
const rzConvDisplay = (statKey, team) => {
  const val = DATA.team_stats[team][statKey];
  return val === null ? "&mdash;" : `${Math.round(val * 100)}%`;
};

// Condensed to answer exactly three things at a glance: who's more likely
// to score first, does a team finish the red-zone trips it gets on its own
// (offense), and does its own defense bail it out by stopping the other
// side's (defense) -- deliberately drops games-played (implied by the X-of-Y
// in Scored First) and the trailing-possession detail that doesn't serve
// those three questions.
// ---- First TD Targets ----
// Three layers, all built from data already on the site:
//   1. Who scores the first TD -- the betting market's view of the two
//      teams (moneyline), blended 50/50 with a blend of first-TD history + first-TD-
//      window usage (schedule-adjusted), overall TD ability (schedule-
//      adjusted), 1st-quarter scoring, possessions needed to find the end
//      zone, red-zone trips before the first TD, and full-field play (EPA
//      per play, explosive rate) -- each offense measured against what the
//      opposing defense allows in the same thing, 50/50.
//   2. Which positions -- first-TD-window usage and full-game TD/usage at
//      that position vs. what the defense allows there.
//   3. Which players -- each player's share of the team's TD opportunity
//      (early-window usage, full-game usage, actual TDs), tilted by how the
//      defense handles his position, times the team's first-TD chance.
const FIRST_TD_TEAM_FACTORS = [
  { w: 0.25, off: (t) => modelSideZ(t, "off", "first").z, def: (t) => modelSideZ(t, "def", "first").z },
  { w: 0.2, off: (t) => avgZ(modelSideZ(t, "off", "pass").z, modelSideZ(t, "off", "rush").z), def: (t) => avgZ(modelSideZ(t, "def", "pass").z, modelSideZ(t, "def", "rush").z) },
  { w: 0.15, off: statZ("q1_scored_per_g"), def: statZ("q1_allowed_per_g") },
  { w: 0.1, off: statZ("avg_possessions_to_first_td", true), def: statZ("avg_possessions_allowed_before_first_td", true) },
  { w: 0.1, off: statZ("pre_first_td_rz_trips_per_g"), def: statZ("pre_first_td_rz_trips_allowed_per_g") },
  { w: 0.1, off: statZ("epa_per_play"), def: statZ("epa_per_play_allowed") },
  { w: 0.1, off: statZ("explosive_rate"), def: statZ("explosive_rate_allowed") },
];
const FIRST_TD_LOGIT_SCALE = 0.7; // edge gap -> probability steepness
const FIRST_TD_HOME_EDGE = 0.08;
// The moneyline already prices team quality over a far bigger sample than
// 2-3 games of stats; a favorite scores the first TD more often, but less
// lopsidedly than it wins. Blended 50/50 with the stat model.
const FIRST_TD_MARKET_WEIGHT = 0.5;
const FIRST_TD_MARKET_SLOPE = 0.4; // first-TD % moves 0.4 per 1.0 of win %
// Mild flattening only (was 0.65 until 2026-10-02): the strong version
// inflated fringe players -- Stafford's ~6% raw share became 16% of LA's
// first-TD chance (6.6% absolute) while RB1 Kyren Williams got squeezed.
const FIRST_TD_SHARE_FLATTEN = 0.9;
// Opponent position factor exp(FIRST_TD_DEF_K * z), z capped at +/-1 and only
// when the defense has allowed FIRST_TD_DEF_MIN_TDS+ TDs to that position
// (PHI's "QB TDs allowed" z of +2.8 on one or two plays was a x1.77 boost).
const FIRST_TD_DEF_K = 0.2;
const FIRST_TD_DEF_MIN_TDS = 3;
// QBs only score first when they actually run: weight x mobility^1.5, where
// mobility = the higher of carries/g ÷ FIRST_TD_QB_RUNNER and rush yds/g ÷
// FIRST_TD_QB_RUN_YDS (capped at 1). Yards count too (user 2026-10-02): Purdy
// runs only 3.3x/g but for 31 yds/g (7th among QBs) -- a real threat that
// carries alone missed. A pocket passer's scrambles plus one goal-line sneak
// still can't read like a running QB (Stafford was 4-7%).
const FIRST_TD_QB_RUNNER = 6;
const FIRST_TD_QB_RUN_YDS = 30;
// Expected-TD units of early-window usage a team needs before its own
// early split outweighs the full-game split.
const FIRST_TD_EARLY_PRIOR = 0.3;
const FIRST_TD_NON_OFFENSE = 0.05; // share of first TDs that are DST/return
const FIRST_TD_PLAYERS_SHOWN = 5;

function avgZ(...zs) {
  const v = zs.filter((z) => z !== null && z !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
// z of a team_stats field across the league (invert: lower is better).
function statZ(key, invert = false) {
  return (t) => {
    const get = (x) => DATA.team_stats[x][key];
    const pool = teamsWithGames().map(get).filter((v) => v !== null && v !== undefined);
    const v = get(t);
    return v === null || v === undefined ? null : zScore(v, pool, invert);
  };
}
function firstTdEdge(offTeam, defTeam) {
  let sum = 0;
  let weight = 0;
  for (const f of FIRST_TD_TEAM_FACTORS) {
    const oz = f.off(offTeam);
    const dz = f.def(defTeam);
    if (oz === null || dz === null) continue;
    sum += f.w * (0.5 * oz + 0.5 * dz);
    weight += f.w;
  }
  return weight ? sum / weight : 0;
}
function firstTdTeamChance(awayTeam, homeTeam) {
  const gap = firstTdEdge(awayTeam, homeTeam) - (firstTdEdge(homeTeam, awayTeam) + FIRST_TD_HOME_EDGE);
  const model = 1 / (1 + Math.exp(-FIRST_TD_LOGIT_SCALE * gap));
  const game = (DATA.schedule || []).find((g) => g.away === awayTeam && g.home === homeTeam && g.status !== "final")
    || (DATA.schedule || []).find((g) => g.away === awayTeam && g.home === homeTeam);
  const win = game?.away_ml_implied_prob;
  const p = win === null || win === undefined
    ? model
    : (1 - FIRST_TD_MARKET_WEIGHT) * model + FIRST_TD_MARKET_WEIGHT * (0.5 + FIRST_TD_MARKET_SLOPE * (win - 0.5));
  return Math.min(0.7, Math.max(0.3, p));
}

function firstTdPositionTargets(offTeam, defTeam) {
  return POSITIONS.filter((p) => p !== "DST")
    .map((pos) => {
      const off = avgZ(modelSideZ(offTeam, "off", `first_${pos}`).z, modelSideZ(offTeam, "off", pos).z);
      const def = avgZ(modelSideZ(defTeam, "def", `first_${pos}`).z, modelSideZ(defTeam, "def", pos).z);
      if (off === null || def === null || off < MODEL_TARGET_OFF_FLOOR || def < MODEL_TARGET_DEF_FLOOR) return null;
      const score = 0.5 * off + 0.5 * def;
      return score >= MODEL_TARGET_MIN_SCORE ? { label: pos, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// This week's injury status by normalized name: Out/Doubtful/IR players
// are dropped from the player list; Questionable and did-not-practice get
// a tag instead, since they may still play.
function firstTdInjuryStatus(team, week) {
  const byWeek = (DATA.injuries || {})[team] || {};
  const list = byWeek[week] || byWeek[String(week)] || byWeek[DATA.injuries_max_week] || [];
  const out = {};
  list.forEach((i) => {
    const r = (i.report_status || "").toLowerCase();
    const tag = /out|doubtful|reserve|injured/.test(r) ? "out" : r === "questionable" ? "Q" : /did not/i.test(i.practice_status || "") ? "DNP" : null;
    if (tag) out[normName(i.full_name)] = tag;
  });
  // On IR / released per the roster (IR players never appear on the report).
  ((DATA.roster_out || {})[team] || []).forEach((p) => (out[normName(p.name)] = "out"));
  return out;
}

// Player share of the team's first-TD chance: full-field usage (targets +
// carries), red zone opportunities (RZ targets + carries), expected TDs
// from where the touches happen, and the same before the first TD.
// Expected TDs and red zone looks lead: they already price WHERE a touch
// happens, so a midfield QB scramble can't count like a red zone target.
const FIRST_TD_W = { touches: 0.15, rz: 0.3, xtd: 0.4, early: 0.15 };
// Small-sample pull toward the player's overall usage share: red zone
// opportunities and expected TDs are a handful of plays early in a season,
// so each starts at the touch share and earns its own number as the team's
// RZ looks (FIRST_TD_RZ_PRIOR plays) and xTD (FIRST_TD_XTD_PRIOR) pile up.
const FIRST_TD_RZ_PRIOR = 12;
const FIRST_TD_MARKET_PRIOR_GAMES = 2; // see firstTdPlayerTargets
const FIRST_TD_XTD_PRIOR = 1.0;
function firstTdPlayerTargets(offTeam, defTeam, teamChance, week) {
  const injured = firstTdInjuryStatus(offTeam, week);
  // Lineup-weighted (see common.js lineupAdjustedXtd): a starter's game
  // cut short and a backup's fill-in game don't set anyone's role.
  const players = lineupAdjustedXtd(offTeam, week, { qbStarter: currentStarterQb(offTeam, week) }).filter((p) => injured[normName(p.name)] !== "out");
  if (!players.length) return [];
  // Overall involvement: share of the team's targets + carries -- a starter
  // who hasn't drawn goal-line looks yet still plays every snap and can
  // score first on any drive. (touches comes from lineupAdjustedXtd.)
  const sum = (k) => players.reduce((s, p) => s + (p[k] || 0), 0) || 1;
  const rzOpp = (p) => (p.rz_targets || 0) + (p.rz_carries || 0);
  const totals = { early: sum("early_xtd_pg"), xtd: sum("xtd_pg"), touches: sum("touches"), rz: players.reduce((s, p) => s + rzOpp(p), 0) || 1 };
  const defPosZ = {};
  const games = DATA.team_stats[offTeam]?.games_played || 1;
  // Market prior: each player's share of the team's anytime-TD odds, blended
  // in while the sample is tiny (weight FIRST_TD_MARKET_PRIOR_GAMES /
  // (that + games): ~40% after 3 games, under 20% by midseason). The anytime
  // market knows London is a WR1 when three games of usage don't; it's a
  // different market from the First TD odds this model is compared to.
  const anyOdds = {};
  ((DATA.player_td_odds || {})[offTeam] || []).forEach((o) => (anyOdds[normName(o.name)] = o.implied_prob || 0));
  const mkTotal = players.reduce((s, p) => s + (anyOdds[normName(p.name)] || 0), 0);
  const mkW = mkTotal > 0 ? FIRST_TD_MARKET_PRIOR_GAMES / (FIRST_TD_MARKET_PRIOR_GAMES + games) : 0;
  const raw = players.map((p) => {
    if (!(p.position in defPosZ)) {
      const allowed = (DATA.team_stats[defTeam]?.def_position_td_allowed || {})[p.position] || 0;
      const z = avgZ(modelSideZ(defTeam, "def", `first_${p.position}`).z, modelSideZ(defTeam, "def", p.position).z) || 0;
      defPosZ[p.position] = allowed >= FIRST_TD_DEF_MIN_TDS ? Math.max(-1, Math.min(1, z)) : 0;
    }
    const touchShare = p.touches / totals.touches;
    const fullShare = (p.xtd_pg + FIRST_TD_XTD_PRIOR * touchShare) / (totals.xtd + FIRST_TD_XTD_PRIOR);
    const rzShare = (rzOpp(p) + FIRST_TD_RZ_PRIOR * touchShare) / (totals.rz + FIRST_TD_RZ_PRIOR);
    // A thin first-TD window (a team that's barely had the ball before the
    // first TD) leans on the full-game share instead of one lucky snap.
    const earlyShare = (p.early_xtd_pg + FIRST_TD_EARLY_PRIOR * fullShare) / (totals.early + FIRST_TD_EARLY_PRIOR);
    // Whole-offense usage, not who has already scored (user 2026-10-02:
    // Ayomanor at 9 targets and Ward off one goal-line game were topping TEN
    // on a few end-zone looks). TDs scored carry no weight at all.
    const usageShare =
      FIRST_TD_W.touches * touchShare +
      FIRST_TD_W.rz * rzShare +
      FIRST_TD_W.xtd * fullShare +
      FIRST_TD_W.early * earlyShare;
    const share = (1 - mkW) * usageShare + mkW * ((anyOdds[normName(p.name)] || 0) / (mkTotal || 1));
    let qbRun = 1;
    if (p.position === "QB") {
      const prop = ((DATA.player_props || {})[offTeam] || []).find((x) => normName(x.name) === normName(p.name));
      const ydsPg = prop && prop.rush_yards_per_g != null ? prop.rush_yards_per_g : 0;
      const mobility = Math.min(1, Math.max((p.carries || 0) / games / FIRST_TD_QB_RUNNER, ydsPg / FIRST_TD_QB_RUN_YDS));
      qbRun = Math.pow(mobility, 1.5);
    }
    return { p, w: Math.pow(share, FIRST_TD_SHARE_FLATTEN) * Math.exp(FIRST_TD_DEF_K * defPosZ[p.position]) * qbRun };
  });
  const wSum = raw.reduce((s, r) => s + r.w, 0) || 1;
  const odds = {};
  ((DATA.player_first_td_odds || {})[offTeam] || []).forEach((o) => (odds[normName(o.name)] = o));
  return raw
    .map(({ p, w }) => {
      const est = teamChance * (1 - FIRST_TD_NON_OFFENSE) * (w / wSum);
      const o = odds[normName(p.name)];
      const implied = o ? americanToProb(o.best_odds) : null;
      return { ...p, est, odds: o ? o.best_odds : null, implied, edge: implied ? est / implied : null, injury: injured[normName(p.name)] || null };
    })
    .sort((a, b) => b.est - a.est)
    .slice(0, FIRST_TD_PLAYERS_SHOWN);
}
function americanToProb(odds) {
  if (odds === null || odds === undefined) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function renderFirstTdTargets(awayTeam, homeTeam) {
  const game = (DATA.schedule || []).find((g) => g.away === awayTeam && g.home === homeTeam && g.status !== "final")
    || (DATA.schedule || []).find((g) => g.away === awayTeam && g.home === homeTeam);
  const week = game ? game.week : DATA.current_week;
  if (!DATA.td_matchup_model || !DATA.player_xtd) {
    return `<p class="no-data-note">First TD targets appear after the next data refresh.</p>`;
  }
  const pAway = firstTdTeamChance(awayTeam, homeTeam);
  const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  const rgbA = teamAccentRgb(awayTeam);
  const rgbH = teamAccentRgb(homeTeam);
  const bar = `<div class="ftd-split">
    <div class="ftd-split-label">${teamLogoMini(awayTeam, 18)} ${awayTeam} <b>${pct(pAway)}</b></div>
    <div class="ftd-split-bar"><span style="width:${pAway * 100}%;background:rgb(${rgbA.join(",")})"></span><span style="width:${(1 - pAway) * 100}%;background:rgb(${rgbH.join(",")})"></span></div>
    <div class="ftd-split-label ftd-split-right"><b>${pct(1 - pAway)}</b> ${homeTeam} ${teamLogoMini(homeTeam, 18)}</div>
  </div>`;

  const block = (offTeam, defTeam, chance) => {
    const rgb = teamAccentRgb(offTeam);
    const posChips = firstTdPositionTargets(offTeam, defTeam)
      .map((i) => `<span class="target-chip${i.score >= TARGET_STRONG_SCORE ? " target-chip-strong" : ""}">${i.label}</span>`)
      .join("") || `<span class="target-none">&mdash;</span>`;
    const rows = firstTdPlayerTargets(offTeam, defTeam, chance, week)
      .map((p) => {
        const edgeCls = p.edge === null ? "" : p.edge >= 1.25 ? " ftd-edge-strong" : p.edge >= 1 ? " ftd-edge-lean" : "";
        const oddsCell = p.odds === null ? `<span class="muted">--</span>` : `${p.odds > 0 ? "+" : ""}${p.odds} <span class="muted">${pct(p.implied)}</span>`;
        const inj = p.injury ? ` <span class="ftd-inj">${p.injury}</span>` : "";
        return `<tr class="${edgeCls.trim()}"><td>${playerClick(offTeam, p.name, p.name, defTeam)} <span class="muted">${p.position}</span>${inj}</td><td class="num ftd-est">${pct(p.est)}</td><td class="num">${oddsCell}</td></tr>`;
      })
      .join("");
    return `<div class="target-block ftd-block">
      <div class="target-team" style="background:rgba(${rgb.join(",")},0.18);border-left:3px solid rgb(${rgb.join(",")})">${teamLogoMini(offTeam, 18)} ${offTeam} <span class="target-vs">vs ${teamLogoMini(defTeam, 14)} ${defTeam} D</span></div>
      <div class="target-group"><div class="target-group-title">Position</div><div class="target-chips">${posChips}</div></div>
      <div class="target-group"><div class="target-group-title">Players</div>
        <table class="data-table ftd-player-table"><thead><tr><th>Player</th><th class="num">Model</th><th class="num">Best odds</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  };
  return `${bar}
    <div class="ftd-blocks">${block(awayTeam, homeTeam, pAway)}${block(homeTeam, awayTeam, 1 - pAway)}</div>
    <p class="target-note ftd-note">Model % = chance to score the game's first TD. Highlighted rows: model above the odds' implied % (bright = 25%+ above).</p>`;
}

function renderOpportunitiesSummary(awayTeam, homeTeam) {
  const headerCell = (team) => `<th style="background:rgba(${teamAccentRgb(team).join(",")},0.4)">${teamLogoMini(team)}${team}</th>`;

  const scoredFirstCell = (team) => {
    const s = DATA.team_stats[team];
    const display = `${fmt(s.first_td_rate * 100, 0)}% <span class="muted">(${s.first_td_games}/${s.games_played})</span>`;
    return numCell(display, tierFor("first_td_rate", team, false), "", { team, statKey: "first_td_rate", label: "Scored First Rate", invert: false, percent: true });
  };

  const rzCell = (team, statKey, tripsKey, invert, label) => {
    const val = DATA.team_stats[team][statKey];
    const cls = val === null ? "" : percentileClsFor(statKey, team, invert);
    const suffix = val === null ? "" : ` <span class="muted">(n=${DATA.team_stats[team][tripsKey]})</span>`;
    return numCell(`${rzConvDisplay(statKey, team)}${suffix}`, cls, "", { team, statKey, label, invert, percent: true });
  };

  const rzRow = (label, statKey, tripsKey, invert) =>
    `<tr><td>${label}</td>${rzCell(awayTeam, statKey, tripsKey, invert, label)}${rzCell(homeTeam, statKey, tripsKey, invert, label)}</tr>`;

  return `<table class="data-table opp-table">
    <thead><tr><th></th>${headerCell(awayTeam)}${headerCell(homeTeam)}</tr></thead>
    <tbody>
      <tr><td>Scored First</td>${scoredFirstCell(awayTeam)}${scoredFirstCell(homeTeam)}</tr>
      ${rzRow("RZ Finish %", "pre_first_td_rz_conversion_rate", "pre_first_td_rz_trips", false)}
      ${rzRow("RZ Allowed %", "pre_first_td_rz_conversion_rate_allowed", "pre_first_td_rz_trips_allowed", true)}
    </tbody>
  </table>`;
}

function renderRzUsageTable(team) {
  const usage = (DATA.pre_first_td_usage[team] || []).filter((p) => p.carries + p.targets > 0);
  if (usage.length === 0) {
    return `${teamBannerHeader(team)}<p class="no-data-note">No red zone touches yet before a first TD this season.</p>`;
  }
  const firstTdsById = {};
  (DATA.player_stats[team] || []).forEach((p) => {
    firstTdsById[p.player_id] = p.first_tds;
  });

  const maxFirstTds = Math.max(...usage.map((p) => firstTdsById[p.player_id] || 0));
  const maxCarries = Math.max(...usage.map((p) => p.carries));
  const maxTargets = Math.max(...usage.map((p) => p.targets));
  const maxReceptions = Math.max(...usage.map((p) => p.receptions));
  const rows = usage
    .map((p) => {
      const firstTds = firstTdsById[p.player_id] || 0;
      const firstTdBg = teamFade(team, maxFirstTds ? firstTds / maxFirstTds : 0);
      const carriesBg = teamFade(team, maxCarries ? p.carries / maxCarries : 0);
      const targetsBg = teamFade(team, maxTargets ? p.targets / maxTargets : 0);
      const receptionsBg = teamFade(team, maxReceptions ? p.receptions / maxReceptions : 0);
      return `<tr><td>${playerClick(team, p.name)}</td><td>${p.position}</td><td class="num" style="background:${firstTdBg}">${firstTds}</td><td class="num" style="background:${carriesBg}">${p.carries}</td><td class="num" style="background:${targetsBg}">${p.targets}</td><td class="num" style="background:${receptionsBg}">${p.receptions}</td></tr>`;
    })
    .join("");
  return `${teamBannerHeader(team)}
    <table class="data-table rzusage-table">
      <thead><tr><th class="lb-player">Player</th><th class="lb-pos">Pos</th><th class="num">1st TDs</th><th class="num">Carries</th><th class="num">Targets</th><th class="num">Rec</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---- Summary tab: one screenshot-ready card with everything ----
// Fixed 1160x980 (1.18:1 -- the video template's full left area), so a
// screenshot or the Save image PNG drops straight in.
// Content that runs long is scaled down to fit instead of being cut off.
const SUMMARY_FIRST_TD_PLAYERS = 5; // user 2026-10-05 (was 3)

// The chart numbers behind one target: [offense, defense allows].
// The chart numbers behind one target -- [offense cell, defense cell] as
// <td>s, colored exactly like the TD Data charts color the same stat
// (offense: more = green; defense allowed: more = red), per game.
function summaryTargetCells(metric, offTeam, defTeam) {
  const o = DATA.team_stats[offTeam];
  const d = DATA.team_stats[defTeam];
  const cell = (text, cls, alpha) => `<td class="num ${cls}"${alpha || ""}>${text}</td>`;
  const pg = (n, g) => (g ? (n / g).toFixed(2) : "--");
  const pct = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
  const stat = (offKey, defKey, fmtFn) => [
    cell(fmtFn(o[offKey]), tierFor(offKey, offTeam, false), tierForAlphaAttr(offKey, offTeam, false)),
    cell(fmtFn(d[defKey]), tierFor(defKey, defTeam, true), tierForAlphaAttr(defKey, defTeam, true)),
  ];
  const bucket = (offDict, defDict, key) => [
    cell(pg(o[offDict][key] || 0, o.games_played), bucketCountTier(offDict, key, offTeam), bucketCountAlphaAttr(offDict, key, offTeam)),
    cell(pg(d[defDict][key] || 0, d.games_played), bucketCountTier(defDict, key, defTeam, true), bucketCountAlphaAttr(defDict, key, defTeam, true)),
  ];
  if (metric === "pass") return stat("pass_td_per_g", "pass_td_allowed_per_g", (v) => v.toFixed(2));
  if (metric === "rush") return stat("rush_td_per_g", "rush_td_allowed_per_g", (v) => v.toFixed(2));
  if (metric === "rz") return stat("rz_td_rate", "rz_td_rate_allowed", pct);
  if (metric === "first") {
    return [
      cell(pct(o.first_td_rate), tierFor("first_td_rate", offTeam, false), tierForAlphaAttr("first_td_rate", offTeam, false)),
      cell(pct(firstTdAllowedRate(defTeam)), tierForFirstTdAllowed(defTeam), tierForFirstTdAllowedAlphaAttr(defTeam)),
    ];
  }
  if (POSITIONS.includes(metric)) return bucket("off_position_td", "def_position_td_allowed", metric);
  if (LENGTH_BUCKETS.some((b) => b.key === metric)) {
    // Per game plus share of all TDs (scored / allowed) -- the share is the
    // "how" a defense gives up TDs, which the per-game number alone hides.
    const share = (dict, total, team) => (team[total] ? ` <small class="sc-share">${Math.round(((team[dict][metric] || 0) / team[total]) * 100)}%</small>` : "");
    const [oc, dc] = bucket("td_by_length", "td_by_length_allowed", metric);
    return [oc.replace("</td>", `${share("td_by_length", "total_td", o)}</td>`), dc.replace("</td>", `${share("td_by_length_allowed", "total_td_allowed", d)}</td>`)];
  }
  return [cell("--", ""), cell("--", "")];
}
function summaryTargetUnit(metric) {
  if (metric === "first") return "scored 1st";
  if (metric === "rz") return "RZ TD rate";
  if (LENGTH_BUCKETS.some((b) => b.key === metric)) return "TDs/g · % of TDs";
  return "TDs / game";
}

// ---- Key players: who on this offense fits each numbered target/tag ----
// Each target row and tag gets a number; players who are the main
// options for that item are listed under the tags with those numbers
// (e.g. "O. Hampton 3 5"). Matching uses usage, not outcomes: red zone /
// end zone / deep targets, red zone carries, carries by rush lane,
// explosive runs, and each position's leading options.
const KEY_PLAYERS_MAX = 6;

function keyPlayerPool(team, week) {
  const injured = firstTdInjuryStatus(team, week);
  const props = {};
  ((DATA.player_props || {})[team] || []).forEach((p) => (props[normName(p.name)] = p));
  return lineupAdjustedXtd(team, week)
    .filter((p) => injured[normName(p.name)] !== "out")
    .map((p) => {
      const pp = props[normName(p.name)] || {};
      return { ...p, explosive_rushes: pp.explosive_rushes || 0, pass_att: pp.pass_att || 0 };
    });
}

// Top n players by score(p), only those with score >= min.
function keyTop(pool, score, n = 2, min = 1) {
  return pool
    .map((p) => ({ p, v: score(p) }))
    .filter((x) => x.v >= min)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.p.name);
}

// The current starter (common.js currentStarterQb) when he's in the pool.
function keyStarterQb(pool, team, week) {
  const starter = currentStarterQb(team, week);
  const hit = starter && pool.find((p) => p.position === "QB" && normName(p.name) === normName(starter));
  return hit ? [hit.name] : null;
}

function keyPlayersForTarget(metric, pool, team, defTeam, week) {
  const rzUse = (p) => p.rz_targets + p.rz_carries;
  const deep = (p) => p.deep_targets + p.ez_targets + p.explosive_rushes;
  if (metric === "QB") {
    const starter = keyStarterQb(pool, team, week);
    if (starter) return starter;
  }
  if (["QB", "RB", "WR", "TE"].includes(metric)) {
    return keyTop(pool.filter((p) => p.position === metric), (p) => p.xtd_pg * 10 + p.targets * 0.05 + p.carries * 0.02, metric === "QB" ? 1 : 2, 0.5);
  }
  if (metric === "pass") return keyTop(pool.filter((p) => p.position !== "QB"), (p) => p.rz_targets + p.ez_targets + p.targets * 0.1, 2, 1);
  if (metric === "rush") return keyTop(pool, (p) => p.rz_carries + p.carries * 0.05, 2, 1);
  if (metric === "rz" || metric === "10_or_less" || metric === "11_20") return keyTop(pool, rzUse, 2, 2);
  if (metric === "21_40" || metric === "41_plus") return keyTop(pool, deep, 2, 2);
  if (metric === "first") {
    const top = firstTdPlayerTargets(team, defTeam, 0.5, week)[0];
    return top ? [top.name] : [];
  }
  return [];
}

function keyPlayersForTag(label, pool, team, week) {
  const rzUse = (p) => p.rz_targets + p.rz_carries;
  const qb = () => keyStarterQb(pool, team, week) || keyTop(pool.filter((p) => p.position === "QB"), (p) => p.pass_att, 1, 10);
  if (["RZ leak", "RZ wall", "RZ volume", "Few RZ trips"].includes(label)) return keyTop(pool, rzUse, 2, 2);
  if (label === "RZ pass edge") return keyTop(pool, (p) => p.rz_targets, 2, 1);
  if (label.startsWith("Weak spot: ")) {
    const pos = label.slice("Weak spot: ".length);
    return keyTop(pool.filter((p) => p.position === pos), (p) => p.touches + 3 * (p.rz_targets + p.rz_carries), 2, 3);
  }
  if (label === "Goal-line run edge") return keyTop(pool, (p) => p.rz_carries, 2, 2);
  if (label === "Big-play pass" || label === "Limits big passes") return keyTop(pool, (p) => p.deep_targets, 2, 2);
  if (label === "Big-play run" || label === "Limits big runs") return keyTop(pool, (p) => p.explosive_rushes, 2, 1);
  if (label === "Deep / EZ exposed") return keyTop(pool, (p) => p.deep_targets + 2 * p.ez_targets, 2, 2);
  if (["Clean pocket", "Pressure trouble", "Beats the blitz", "Turnover risk"].includes(label)) return qb();
  if (label === "Light-box runs" || label === "Beats stacked box") return keyTop(pool, (p) => p.carries, 1, 10);
  if (label.startsWith("Run lane: ")) {
    const laneLabel = label.slice("Run lane: ".length);
    const lane = Object.keys(RUSH_LANE_LABELS).find((k) => RUSH_LANE_LABELS[k] === laneLabel);
    const zones = (DATA.player_rush_zones || {})[team] || {};
    return keyTop(pool, (p) => {
      const z = zones[p.name]?.[lane];
      return z && z.share >= 0.25 ? z.carries : 0;
    }, 2, 3);
  }
  return []; // game-level tags (pace, short fields) have no single player
}

// shortName for each name, except two that would collide ("B. Robinson"
// for Bijan and Brian) keep their full names.
function uniqueShortNames(names) {
  const counts = {};
  names.forEach((n) => (counts[shortName(n)] = (counts[shortName(n)] || 0) + 1));
  return Object.fromEntries(names.map((n) => [n, counts[shortName(n)] > 1 ? n : shortName(n)]));
}

function numBadge(n) {
  return `<span class="sc-num">${n}</span>`;
}

// Season half of a team's column: numbered targets (with chart numbers),
// numbered tags, then the key players tied to those numbers.
function summarySeasonColumn(offTeam, defTeam, week, chance, game) {
  const pool = keyPlayerPool(offTeam, week);
  const byPlayer = {};
  const link = (names, n, kind) =>
    names.forEach((name) => {
      const e = (byPlayer[name] = byPlayer[name] || { name, nums: [], good: false });
      e.nums.push(n);
      if (kind !== "warn") e.good = true;
    });
  let n = 0;
  // DST already dropped; the First TD target lives in the First TD section's "Scored 1st" tile.
  const items = targetGroups(offTeam, defTeam).flatMap((g) => g.items).filter((i) => i.metric !== "first");
  const targetRows = items.length
    ? items
        .map((i) => {
          n += 1;
          if (i.metric) link(keyPlayersForTarget(i.metric, pool, offTeam, defTeam, week), n, "good");
          const [oc, dc] = i.metric ? summaryTargetCells(i.metric, offTeam, defTeam) : ["<td></td>", "<td></td>"];
          const strong = i.score >= TARGET_STRONG_SCORE && !i.defLed;
          const due = i.due ? `<span class="target-due">&#9650;</span>` : "";
          const soft = i.defLed
            ? ` title="${defTeam} is a soft spot here; ${offTeam} hasn't produced it yet (schedule-adjusted)"`
            : "";
          const softTag = i.defLed ? `<span class="target-soft-tag">soft D</span>` : "";
          // Summary-card tile (2026-10-09, the user wanted the Props card's punch): the
          // table cells become two big shaded boxes under the chip.
          const box = (td) => td.replace(/^<td class="num ?([^"]*)"/, '<span class="tdt-v $1"').replace(/<\/td>$/, "</span>");
          return `<div class="tdt">
            <div class="tdt-head"><span class="target-chip${strong ? " target-chip-strong" : ""}${i.defLed ? " target-chip-soft" : ""}"${soft}>${i.label}${due}${softTag}</span></div>
            <div class="tdt-vals"><div class="tdt-cell"><span class="tdt-who">${offTeam}</span>${box(oc)}</div><div class="tdt-cell"><span class="tdt-who">${defTeam} allows</span>${box(dc)}</div></div>
          </div>`;
        })
        .join("")
    : `<div class="target-none">No targets this week</div>`;
  const tags = matchupTags(offTeam, defTeam);
  const tagRows = tags.length
    ? tags
        .map((t) => {
          n += 1;
          link(keyPlayersForTag(t.label, pool, offTeam, week), n, t.kind);
          return summaryTagTile(n, t);
        })
        .join("")
    : `<div class="target-none">No tags</div>`;
  const keyList = Object.values(byPlayer)
    .sort((a, b) => b.nums.length - a.nums.length || a.nums[0] - b.nums[0])
    .slice(0, KEY_PLAYERS_MAX);
  const keyNames = uniqueShortNames(keyList.map((e) => e.name));
  const keyPlayers = keyList
    .map((e) => `<span class="sc-key${e.good ? "" : " sc-key-warn"}" title="Fits ${e.nums.length} of this team's targets / tags">${playerClick(offTeam, e.name, `${summaryHeadshot(offTeam, e.name, 18)}${keyNames[e.name]}`, defTeam)}<span class="sc-stars">${"★".repeat(Math.min(5, e.nums.length))}</span></span>`)
    .join("");
  // Four fixed blocks (banner / targets / tags / key players) -- the two
  // team columns share row lines (CSS subgrid), so each block starts at
  // the same height on both sides even when one team has less in it.
  // One full-height column per team (2026-10-09 facelift, like the Props card):
  // targets, matchup tags in the same tile style, that team's First TD, key players.
  return `<div class="sc-col td-team">
    ${summaryTdTeamBanner(offTeam, game, topTdScorers(offTeam, week), defTeam)}
    <div class="sc-block"><div class="sc-label">TD Targets</div><div class="tdt-grid">${targetRows}</div></div>
    <div class="sc-block"><div class="sc-label">Matchup Tags</div><div class="tdt-grid tdt-tags">${tagRows}</div></div>
    ${summaryFirstTdBlock(offTeam, defTeam, chance)}
    <div class="sc-block td-keys"><div class="sc-label">Key Players</div>${keyPlayers ? `<div class="sc-keys">${keyPlayers}</div>` : `<span class="target-none">&mdash;</span>`}</div>
  </div>`;
}

// The team's top 3 TD scorers this season (rushing + receiving, so a QB
// counts only for his own runs), for the banner photos. Real season counts
// from player_xtd, not the lineup-weighted ones; anyone ruled out this week
// is skipped (keyPlayerPool). Ties broken by expected TDs per game.
// Replaced "top two key players" 2026-10-09: the user saw Burrow (QB tags)
// in the TD banner with one TD.
function topTdScorers(team, week, n = 3) {
  const active = new Set(keyPlayerPool(team, week).map((p) => normName(p.name)));
  return ((DATA.player_xtd || {})[team] || [])
    .filter((p) => p.tds > 0 && p.position !== "DST" && active.has(normName(p.name)))
    .sort((a, b) => b.tds - a.tds || b.xtd_pg - a.xtd_pg)
    .slice(0, n);
}

// Team header with a one-line fact strip in the same color block (user
// 2026-10-09): implied TDs from the spread + total (Novig first; ~7 points
// per TD), the position that scores the biggest share of the team's TDs,
// and photos of its top TD scorers with their TD count in a bubble.
function summaryTdTeamBanner(team, game, topPlayers, oppTeam) {
  const rgb = teamAccentRgb(team);
  const g = game ? { ...game, ...(game.novig || {}) } : {};
  const spread = team === g.away ? g.away_team_spread : g.home_team_spread;
  const implied = g.total_line && spread !== null && spread !== undefined ? g.total_line / 2 - spread / 2 : null;
  const st = DATA.team_stats[team] || {};
  const counts = st.off_position_td || {};
  const top = POSITIONS.filter((p) => p !== "DST").sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
  const share = st.total_td && top ? Math.round(((counts[top] || 0) / st.total_td) * 100) : null;
  const photos = topPlayers
    .map((p) => `<span class="td-scorer" title="${p.name}: ${p.tds} TD${p.tds === 1 ? "" : "s"} this season">${playerClick(team, p.name, summaryHeadshot(team, p.name, 36), oppTeam)}<span class="td-scorer-n">${p.tds}</span></span>`)
    .join("");
  return `<div class="sc-team td-banner" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})">
    <div class="td-banner-name"><img src="${teamLogoUrl(team)}" crossorigin="anonymous" class="sc-team-logo" alt=""><span class="sc-team-name">${TEAM_NAMES[team] || team}</span></div>
    <div class="td-facts">
      <div class="td-fact"><span class="td-fact-label">Implied</span><span class="td-fact-val">${implied === null ? `<b>--</b>` : `<b>${(implied / 7).toFixed(1)} TDs</b><small>${fmt(implied, 1)} pts</small>`}</span></div>
      <div class="td-fact"><span class="td-fact-label">Top TD position</span><span class="td-fact-val">${share === null || !counts[top] ? `<b>--</b>` : `<b>${top} ${share}%</b><small>of TDs</small>`}</span></div>
      <div class="td-fact td-fact-players">${photos || `<b>--</b>`}</div>
    </div>
  </div>`;
}

// A matchup tag as a tile like the targets: chip on top, then one box per
// " · " part of its line, the first number in each part pulled out big
// ("TB 3.4 RZ trips/g" -> label TB, 3.4, RZ trips/g), "(lg x)" under it.
// Boxes are tinted by the tag's direction: green helps the offense, yellow
// is working against it.
function summaryTagTile(n, t) {
  const tone = t.kind === "good" ? "tier-good" : "tier-mid";
  const parts = String(t.title)
    .split(/\s+·\s+/)
    .map((part) => {
      const lg = (part.match(/\((lg [^)]*)\)/) || [])[1] || "";
      const clean = part.replace(/\s*\((lg [^)]*)\)/g, "").trim();
      // First number that isn't part of a label like "7+ box".
      const m = clean.match(/^(.*?)(-?\d+(?:\.\d+)?%?)(?![\d.+])(.*)$/);
      if (!m) return `<div class="tgt-box"><span class="tgt-v">${clean}</span></div>`;
      const label = m[1].trim().replace(/:$/, "");
      return `<div class="tgt-box"><span class="tgt-label">${label || "&nbsp;"}</span><span class="tgt-v ${tone}">${m[2]}${m[3].trim() ? `<small>${m[3].trim()}</small>` : ""}</span></div>`;
    });
  return `<div class="tdt tdt-tag${parts.length > 2 ? " tdt-wide" : ""}">
    <div class="tdt-head"><span class="tag-chip tag-chip-${t.kind}">${t.label}</span></div>
    <div class="tgt-boxes" style="grid-template-columns:repeat(${parts.length}, minmax(0, 1fr))">${parts.join("")}</div>
  </div>`;
}

// This team's First TD, inside its column, from the First TD tab's numbers
// in the same tile style as the targets (team vs what the defense allows):
// how often it scores first, its first-TD position matchups (shares, only
// the positions the First TD tab flags), and red-zone finishing before the
// first TD -- next to the big chance-to-score-first box. No model players
// (user 2026-10-09).
function summaryFirstTdBlock(offTeam, defTeam, chance) {
  const o = DATA.team_stats[offTeam];
  const d = DATA.team_stats[defTeam];
  const pctTxt = (v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
  const box = (text, cls, alpha) => `<span class="tdt-v ${cls || ""}"${alpha || ""}>${text}</span>`;
  const tile = (label, offBox, defBox, chipCls = "target-chip") => `<div class="tdt">
      <div class="tdt-head"><span class="${chipCls}">${label}</span></div>
      <div class="tdt-vals"><div class="tdt-cell"><span class="tdt-who">${offTeam}</span>${offBox}</div><div class="tdt-cell"><span class="tdt-who">${defTeam} allows</span>${defBox}</div></div>
    </div>`;
  const tiles = [];
  tiles.push(tile("Scored 1st",
    box(pctTxt(o.first_td_rate), tierFor("first_td_rate", offTeam, false), tierForAlphaAttr("first_td_rate", offTeam, false)),
    box(pctTxt(firstTdAllowedRate(defTeam)), tierForFirstTdAllowed(defTeam), tierForFirstTdAllowedAlphaAttr(defTeam))));
  firstTdPositionTargets(offTeam, defTeam).forEach((i) => {
    const pos = i.label;
    const offShare = o.first_td_games ? (o.first_td_position[pos] || 0) / o.first_td_games : null;
    const defShare = d.trailing_games ? (d.first_td_position_allowed[pos] || 0) / d.trailing_games : null;
    tiles.push(tile(`${pos} 1st TD`,
      box(pctTxt(offShare), bucketShareTier("first_td_position", "first_td_games", pos, offTeam)),
      box(pctTxt(defShare), bucketShareTier("first_td_position_allowed", "trailing_games", pos, defTeam, true)),
      `target-chip${i.score >= TARGET_STRONG_SCORE ? " target-chip-strong" : ""}`));
  });
  const rz = (key, team, invert) => box(pctTxt(DATA.team_stats[team][key]), DATA.team_stats[team][key] === null ? "" : percentileClsFor(key, team, invert));
  tiles.push(tile("RZ finish", rz("pre_first_td_rz_conversion_rate", offTeam, false), rz("pre_first_td_rz_conversion_rate_allowed", defTeam, true)));
  const tone = chance >= 0.55 ? "tier-good" : chance <= 0.45 ? "tier-bad" : "tier-mid";
  return `<div class="sc-block tdf">
    <div class="sc-label">First TD</div>
    <div class="tdt-grid">
      <div class="tdt tdf-big"><div class="tdt-head"><span class="tdf-title">1st TD chance</span></div><span class="tdt-v tdf-chance ${tone}">${Math.round(chance * 100)}%</span></div>
      ${tiles.join("")}
    </div>
  </div>`;
}

// ---- Right rail: player odds YOU choose (blank until picked) -- each
// team's picks with photo, Anytime TD and First TD odds, each a checkbox
// into Possible Plays. Custom (not native) checkboxes so the checkmark
// shows up in the saved PNG. Picks are remembered per game.
const SUMMARY_MAX_PICKS = 10;
const SUMMARY_PICKS_KEY = "nfl-tool.summary-picks.v1";

function summaryPlayEntry(week, matchup, market, team, name, odds) {
  return {
    id: `${week}_${market}_${team}_${name}`,
    week,
    matchup,
    category: PLAY_MARKET_LABELS[market],
    description: name,
    team,
    odds: fmtOddsSigned(odds.best_odds),
    book: odds.best_book,
  };
}
function summaryPlayCheck(entry, label) {
  const on = isPossiblePlay(entry.id);
  return `<button type="button" class="sc-pp${on ? " sc-pp-on" : ""}" data-entry="${encodeDataAttr(entry)}" title="Add to Possible Plays"><span class="sc-pp-box">${on ? "&#10003;" : ""}</span>${label}</button>`;
}

function summaryGameKey(week, away, home) {
  return `${week}_${away}_${home}`;
}
function loadSummaryPicks(gameKey) {
  try {
    return (JSON.parse(localStorage.getItem(SUMMARY_PICKS_KEY)) || {})[gameKey] || {};
  } catch (e) {
    return {};
  }
}
function saveSummaryPicks(gameKey, picks) {
  try {
    const all = JSON.parse(localStorage.getItem(SUMMARY_PICKS_KEY)) || {};
    all[gameKey] = picks;
    localStorage.setItem(SUMMARY_PICKS_KEY, JSON.stringify(all));
    window.NFLSync?.push(SUMMARY_PICKS_KEY, all);
  } catch (e) {
    // localStorage unavailable -- picks just won't stick across reloads.
  }
}

// Every player with Anytime or First TD odds for one team, merged by
// name and sorted most likely first.
function summaryTeamOdds(team) {
  const any = {};
  const first = {};
  const names = {};
  ((DATA.player_td_odds || {})[team] || []).forEach((o) => {
    any[normName(o.name)] = o;
    names[normName(o.name)] = names[normName(o.name)] || o;
  });
  ((DATA.player_first_td_odds || {})[team] || []).forEach((o) => {
    first[normName(o.name)] = o;
    names[normName(o.name)] = names[normName(o.name)] || o;
  });
  return Object.entries(names)
    .map(([k, o]) => ({ key: k, name: o.name, position: o.position, any: any[k] || null, first: first[k] || null, prob: (any[k] || first[k] || {}).implied_prob || 0 }))
    .sort((a, b) => b.prob - a.prob);
}

function summaryOddsRail(away, home, week) {
  const matchup = `${away} @ ${home}`;
  const picks = loadSummaryPicks(summaryGameKey(week, away, home));
  const block = (team) => {
    const chosen = new Set(picks[team] || []);
    const rows = summaryTeamOdds(team)
      .filter((p) => chosen.has(p.key))
      .map((p) => {
        const cell = (odds, market) => (odds ? summaryPlayCheck(summaryPlayEntry(week, matchup, market, team, p.name, odds), fmtOddsSigned(odds.best_odds)) : `<span class="muted">--</span>`);
        return `<tr><td><span class="sc-player player-click" data-entry="${encodeDataAttr({ team, name: p.name })}">${summaryHeadshot(team, p.name, 26)}<span class="sc-odds-name">${p.name} <span class="muted">${p.position || ""}</span></span></span></td><td class="num">${cell(p.any, "anytime_td")}</td><td class="num">${cell(p.first, "first_td")}</td></tr>`;
      })
      .join("");
    const rgb = teamAccentRgb(team);
    return `<div class="sc-odds-block"><div class="sc-odds-team" style="background:rgba(${rgb.join(",")},0.22);border-left:4px solid rgb(${rgb.join(",")})">
        <img src="${teamLogoUrl(team)}" crossorigin="anonymous" class="sc-team-logo" alt=""><span class="sc-ftd-team">${team}</span>
      </div>
      ${rows
        ? `<table class="sc-table sc-odds"><thead><tr><th>Player</th><th class="num">Anytime</th><th class="num">1st TD</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="sc-odds-empty">Click TD Odds to pick players</p>`}</div>`;
  };
  return `<section class="sc-section sc-section-odds">
    <button type="button" class="sc-section-title sc-odds-open" title="Pick which players show here">TD Odds</button>
    ${block(away)}
    ${block(home)}
  </section>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".sc-pp");
  if (!btn) return;
  togglePossiblePlay(decodeDataAttr(btn.dataset.entry));
  const on = btn.classList.toggle("sc-pp-on");
  btn.querySelector(".sc-pp-box").innerHTML = on ? "&#10003;" : "";
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  if (away && home) renderTdPossiblePlaysList(away, home);
});

// ---- Player picker: every player with odds in the game, "Add to
// summary" per player, max SUMMARY_MAX_PICKS per team. ----
function summaryPickerContext() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const game = (DATA.schedule || []).find((g) => g.away === away && g.home === home && g.status !== "final")
    || (DATA.schedule || []).find((g) => g.away === away && g.home === home);
  const week = game ? game.week : DATA.current_week;
  return { away, home, week, gameKey: summaryGameKey(week, away, home) };
}

function renderSummaryPicker() {
  const { away, home, gameKey } = summaryPickerContext();
  const picks = loadSummaryPicks(gameKey);
  const col = (team) => {
    const chosen = new Set(picks[team] || []);
    const full = chosen.size >= SUMMARY_MAX_PICKS;
    const players = summaryTeamOdds(team);
    const rows = players.length
      ? players
          .map((p) => {
            const on = chosen.has(p.key);
            return `<tr class="${on ? "sc-picker-on" : ""}"><td><label class="pp-row-label"><input type="checkbox" class="sc-pick-toggle" data-team="${team}" data-key="${p.key}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}> ${summaryHeadshot(team, p.name, 24)} ${p.name} <span class="muted-label">${p.position || ""}</span></label></td><td class="num">${p.any ? fmtOddsSigned(p.any.best_odds) : "--"}</td><td class="num">${p.first ? fmtOddsSigned(p.first.best_odds) : "--"}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="no-data-note">No odds posted yet.</td></tr>`;
    return `<div class="sc-picker-col">
      <h4 class="sc-picker-team">${teamLogoMini(team, 20)} ${TEAM_NAMES[team] || team} <span class="muted">${chosen.size}/${SUMMARY_MAX_PICKS}</span></h4>
      <table class="data-table player-odds-table"><thead><tr><th>Add to summary</th><th class="num">Anytime</th><th class="num">1st TD</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };
  return `<h3>${away} @ ${home} &mdash; Pick players for the summary</h3>
    <p class="no-data-note">Up to ${SUMMARY_MAX_PICKS} per team. The card updates as you check.</p>
    <div class="sc-picker-actions"><button type="button" class="view-toggle-btn sc-picker-clear">Clear all</button></div>
    <div class="sc-picker-cols">${col(away)}${col(home)}</div>`;
}

function ensureSummaryPicker() {
  if (document.getElementById("summary-picker-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "summary-picker-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <div id="summary-picker-content"></div>
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
function openSummaryPicker() {
  ensureSummaryPicker();
  document.getElementById("summary-picker-content").innerHTML = renderSummaryPicker();
  document.getElementById("summary-picker-modal").hidden = false;
}
function refreshSummaryAfterPick() {
  const { away, home } = summaryPickerContext();
  document.getElementById("summary-picker-content").innerHTML = renderSummaryPicker();
  renderSummaryCard(away, home);
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#summary-rail-btn")) {
    setSummaryRailHidden("td", !summaryRailHidden("td"));
    const { away, home } = summaryPickerContext();
    renderSummaryCard(away, home);
    return;
  }
  if (e.target.closest(".sc-odds-open, #summary-pick-btn")) openSummaryPicker();
  if (e.target.closest(".sc-picker-clear")) {
    const { gameKey } = summaryPickerContext();
    saveSummaryPicks(gameKey, {});
    refreshSummaryAfterPick();
  }
});
document.addEventListener("change", (e) => {
  const cb = e.target.closest(".sc-pick-toggle");
  if (!cb) return;
  const { gameKey } = summaryPickerContext();
  const picks = loadSummaryPicks(gameKey);
  const list = new Set(picks[cb.dataset.team] || []);
  if (cb.checked && list.size < SUMMARY_MAX_PICKS) list.add(cb.dataset.key);
  else list.delete(cb.dataset.key);
  picks[cb.dataset.team] = [...list];
  saveSummaryPicks(gameKey, picks);
  refreshSummaryAfterPick();
});

function renderSummaryCard(away, home) {
  const card = document.getElementById("summary-card");
  if (!card) return;
  if (!DATA.td_matchup_model || !DATA.player_xtd) {
    card.innerHTML = `<p class="no-data-note">The summary appears after the next data refresh.</p>`;
    return;
  }
  const game = (DATA.schedule || []).find((g) => g.away === away && g.home === home && g.status !== "final")
    || (DATA.schedule || []).find((g) => g.away === away && g.home === home);
  const week = game ? game.week : DATA.current_week;
  const pAway = firstTdTeamChance(away, home);
  const when = game?.date ? new Date(game.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  const line = (n) => (n > 0 ? `+${n}` : `${n}`);
  const lines = [
    game && game.home_team_spread !== null && game.home_team_spread !== undefined ? `${home} ${line(game.home_team_spread)}` : null,
    game && game.total_line ? `O/U ${game.total_line}` : null,
  ].filter(Boolean).join(" &middot; ");
  const rgbA = teamAccentRgb(away);
  const rgbH = teamAccentRgb(home);
  const railHidden = summaryRailHidden("td");
  syncSummaryRailButton("td", "TD Odds");
  card.innerHTML = `<div class="sc-inner td-card sc-grow${railHidden ? " sc-no-rail" : ""}">
    <div class="sc-header">
      <div class="sc-title-row">
        <img src="${teamLogoUrl(away)}" crossorigin="anonymous" class="sc-logo" alt="">
        <div class="sc-matchup">${TEAM_NAMES[away] || away} <span class="sc-at">@</span> ${TEAM_NAMES[home] || home}</div>
        <img src="${teamLogoUrl(home)}" crossorigin="anonymous" class="sc-logo" alt="">
      </div>
      <div class="sc-meta">Week ${week}${when ? ` &middot; ${when}` : ""}${lines ? ` &middot; ${lines}` : ""}</div>
      <div class="sc-brand"><span class="brand-mark">GMG</span><span class="sc-brand-name">TD Summary</span></div>
    </div>

    <div class="sc-body">
      <div class="sc-main sc-zoom-target">
        <div class="td-cols">
          ${summarySeasonColumn(away, home, week, pAway, game)}
          ${summarySeasonColumn(home, away, week, 1 - pAway, game)}
        </div>
      </div>
      ${railHidden ? "" : summaryOddsRail(away, home, week)}
    </div>

    <div class="sc-footer">
      <span><span class="target-chip target-chip-strong">Strong</span> <span class="target-chip">Lean</span> <span class="target-due">&#9650;</span> usage ahead of TDs &middot; numbers colored like the charts (vs. league)</span>
      <span>1st TD chance = this game &middot; Scored 1st = season rate &middot; &#9733; = how many of the team's targets and tags a player fits</span>
    </div>
  </div>`;
  fitWideSummaryCard();
  // Logos/photos load after the first measurement; re-fit once they have.
  card.querySelectorAll("img").forEach((img) => img.addEventListener("load", fitWideSummaryCard, { once: true }));
}

// ---- Season TDs / First TD view toggle (localStorage so it survives a
// reload during a stream; a "?view=first" URL param wins on first load so
// the old first-td.html redirect can still land you on the right tab) ----
const TD_VIEW_KEY = "nfl-tool.td-view.v1";
let currentView = "season";

function loadSavedView() {
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl === "first" || fromUrl === "season" || fromUrl === "summary") return fromUrl;
  try {
    return localStorage.getItem(TD_VIEW_KEY) || "season";
  } catch (e) {
    return "season";
  }
}

function setActiveView(view) {
  currentView = view;
  document.getElementById("view-season").hidden = view !== "season";
  document.getElementById("view-first").hidden = view !== "first";
  document.getElementById("view-summary").hidden = view !== "summary";
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  try {
    localStorage.setItem(TD_VIEW_KEY, view);
  } catch (e) {
    // localStorage unavailable -- toggle just won't stick across reloads.
  }
  render();
}

document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

const ALL_SECTIONS = ["type", "player", "basics", "first-targets", "rzusage"];

function render() {
  const away = document.getElementById("away-select").value;
  const home = document.getElementById("home-select").value;
  const emptyEl = document.getElementById("empty-state");
  const sectionEls = ALL_SECTIONS.map((s) => document.getElementById(`section-${s}`));

  if (!away || !home) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    emptyEl.innerHTML =
      currentView === "first"
        ? "<p>Choose both teams above to see the mini-game -- everything that happens before the game's very first touchdown.</p>"
        : "<p>Choose both teams above to see the matchup.</p>";
    return;
  }

  const awayStats = DATA.team_stats[away];
  const homeStats = DATA.team_stats[home];
  const awayReady = awayStats && awayStats.games_played > 0;
  const homeReady = homeStats && homeStats.games_played > 0;

  if (!awayReady || !homeReady) {
    sectionEls.forEach((el) => (el.hidden = true));
    emptyEl.hidden = false;
    const missing = [!awayReady && away, !homeReady && home].filter(Boolean).join(" and ");
    emptyEl.innerHTML = `<p>${missing} ${missing.includes(" and ") ? "have" : "has"} no games played yet this season.</p>`;
    return;
  }
  emptyEl.hidden = true;
  sectionEls.forEach((el) => (el.hidden = false));
  if (currentView === "summary") renderSummaryCard(away, home);

  // Season TDs view
  document.getElementById("col-away-type").innerHTML = renderStatTable(away, home);
  document.getElementById("col-home-type").innerHTML = renderStatTable(home, away);
  document.getElementById("col-away-position").innerHTML = renderPositionTable(away, home);
  document.getElementById("col-home-position").innerHTML = renderPositionTable(home, away);
  document.getElementById("col-away-distance").innerHTML = renderLengthTable(away, home);
  document.getElementById("col-home-distance").innerHTML = renderLengthTable(home, away);
  document.getElementById("td-targets").innerHTML = renderTargets(away, home);
  document.getElementById("lb-away").innerHTML = renderLeaderboard(away);
  document.getElementById("lb-home").innerHTML = renderLeaderboard(home);

  const notesKey = `${away}_${home}`;
  const savedNote = loadTdNotes()[notesKey] || "";
  document.querySelectorAll(".td-notes-input").forEach((el) => {
    el.value = savedNote;
    el.dataset.key = notesKey;
  });
  renderTdPossiblePlaysList(away, home);

  // First TD view
  document.getElementById("col-away-basics").innerHTML = renderBasicsTable(away, home);
  document.getElementById("col-home-basics").innerHTML = renderBasicsTable(home, away);
  document.getElementById("opportunities-summary").innerHTML = renderOpportunitiesSummary(away, home);
  document.getElementById("first-td-targets").innerHTML = renderFirstTdTargets(away, home);
  document.getElementById("rzusage-away").innerHTML = renderRzUsageTable(away);
  document.getElementById("rzusage-home").innerHTML = renderRzUsageTable(home);
}

// Delegated (not one listener per textarea) since Season TDs and First TD
// each have their own notes box for the same matchup -- typing in either
// saves to the shared key and mirrors the text into the other immediately,
// so neither ever shows stale text even without a re-render in between.
// (The listeners that save this input and re-render renderTdPossiblePlaysList
// on any pp-toggle change now live in common.js -- both are shared with the
// Player Props page's own notes box/possible-plays list.)

function populateSelects() {
  const awaySel = document.getElementById("away-select");
  const homeSel = document.getElementById("home-select");
  const opts = DATA.teams
    .slice()
    .sort((a, b) => (TEAM_NAMES[a] || a).localeCompare(TEAM_NAMES[b] || b))
    .map((t) => `<option value="${t}">${TEAM_NAMES[t] || t}</option>`)
    .join("");
  awaySel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  homeSel.innerHTML = `<option value="">Select team&hellip;</option>${opts}`;
  awaySel.addEventListener("change", render);
  homeSel.addEventListener("change", render);
}

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    populateSelects();
    initScheduleScroller(render);
    setActiveView(loadSavedView());
  })
  .catch((err) => {
    document.getElementById("empty-state").innerHTML =
      "<p>Couldn't load data.json. If you're running this locally, make sure you started a local server " +
      "(e.g. <code>python -m http.server</code>) rather than opening index.html directly, and that " +
      "<code>build_stats.py</code> has been run at least once.</p>";
    console.error(err);
  });
