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
function modelEntry(label, off, def) {
  if (off.z === null || def.z === null) return null;
  if (def.z < MODEL_TARGET_DEF_FLOOR || off.z < MODEL_TARGET_OFF_FLOOR) return null;
  const score = 0.5 * def.z + 0.5 * off.z;
  if (score < MODEL_TARGET_MIN_SCORE) return null;
  const due = off.xtd !== undefined && off.xtd !== null && off.xtd - off.adj >= MODEL_DUE_GAP && off.xtd >= 0.3;
  return { label, score, due };
}
function modelTargetGroups(offTeam, defTeam) {
  const pair = (metric, label) => {
    const e = modelEntry(label, modelSideZ(offTeam, "off", metric), modelSideZ(defTeam, "def", metric));
    return e && { ...e, metric };
  };
  const stat = (key) => (t) => DATA.team_stats[t][key];
  const clean = (list) => list.filter(Boolean).sort((a, b) => b.score - a.score);
  const rzEntry = targetEntry("Red Zone", targetRateZ(offTeam, stat("rz_td_rate")), targetRateZ(defTeam, stat("rz_td_rate_allowed")));
  const rz = rzEntry && { ...rzEntry, metric: "rz" };
  return [
    { title: "Type", items: clean([pair("pass", "Pass TD"), pair("rush", "Rush TD"), pair("first", "First TD")]) },
    { title: "Position", items: clean(POSITIONS.map((pos) => pair(pos, pos))) },
    { title: "Distance", items: clean([...LENGTH_BUCKETS.map(({ key, label }) => pair(key, label)), rz]) },
  ];
}

function targetGroups(offTeam, defTeam) {
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
    else if (ok(dz) && dz <= -TAG_Z) add("warn", "RZ wall", t);
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
      add("good", "Deep / EZ exposed", `${defTeam} allows ${tagNum(m[defTeam].def.deep?.adj)} deep · ${tagNum(m[defTeam].def.ez?.adj)} EZ tgts/g · ${offTeam} throws ${tagNum(m[offTeam].off.deep?.adj)} · ${tagNum(m[offTeam].off.ez?.adj)}`);
    }
  }

  // Pressure / blitz mismatch
  if (o.success_vs_clean_pocket_plays >= TAG_MIN_SPLIT_PLAYS) {
    const pz = z("pressure_rate", defTeam);
    const cz = z("success_vs_clean_pocket", offTeam);
    if (ok(pz, cz) && pz <= -0.6 && cz >= 0.3) {
      add("good", "Clean pocket", `${defTeam} pressure ${tagPct(d.pressure_rate)} (lg ${tagPct(tagLeague("pressure_rate"))}) · ${offTeam} clean-pocket success ${tagPct(o.success_vs_clean_pocket)}`);
    }
  }
  if (o.success_vs_pressure_plays >= TAG_MIN_SPLIT_PLAYS) {
    const pz = z("pressure_rate", defTeam);
    const sz = z("success_vs_pressure", offTeam);
    if (ok(pz, sz) && pz >= 0.6 && sz <= -0.3) {
      add("warn", "Pressure trouble", `${defTeam} pressure ${tagPct(d.pressure_rate)} (lg ${tagPct(tagLeague("pressure_rate"))}) · ${offTeam} success when pressured ${tagPct(o.success_vs_pressure)}`);
    }
  }
  if (o.success_vs_blitz_plays >= TAG_MIN_SPLIT_PLAYS) {
    const bz = z("blitz_rate", defTeam);
    const sz = z("success_vs_blitz", offTeam);
    if (ok(bz, sz) && bz >= 0.6 && sz >= 0.3) {
      add("good", "Beats the blitz", `${defTeam} blitz ${tagPct(d.blitz_rate)} (lg ${tagPct(tagLeague("blitz_rate"))}) · ${offTeam} success vs blitz ${tagPct(o.success_vs_blitz)}`);
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

  // Box-count edge
  if (o.ypc_vs_light_box_plays >= TAG_MIN_SPLIT_PLAYS) {
    const lz = z("box_light_rate", defTeam);
    const yz = z("ypc_vs_light_box", offTeam);
    if (ok(lz, yz) && lz >= 0.6 && yz >= 0.5) {
      add("good", "Light-box runs", `${defTeam} light box ${tagPct(d.box_light_rate)} (lg ${tagPct(tagLeague("box_light_rate"))}) · ${offTeam} ${tagNum(o.ypc_vs_light_box)} YPC vs light`);
    }
  }
  if (o.ypc_vs_heavy_box_plays >= TAG_MIN_SPLIT_PLAYS) {
    const hz = z("box_heavy_rate", defTeam);
    const yz = z("ypc_vs_heavy_box", offTeam);
    if (ok(hz, yz) && hz >= 0.6 && yz >= 0.5) {
      add("good", "Beats stacked box", `${defTeam} 7+ box ${tagPct(d.box_heavy_rate)} (lg ${tagPct(tagLeague("box_heavy_rate"))}) · ${offTeam} ${tagNum(o.ypc_vs_heavy_box)} YPC vs 7+`);
    }
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
  return `<tr style="${rowStyle}"><td>${teamLogoMini(p.team)} ${p.name}${wrRankTag}${dstTag}</td><td class="num">${countLabel}</td></tr>`;
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
      return `<tr><td>${p.name}${tag}</td><td>${p.position}</td><td class="num" style="background:${tdBg}">${p.tds}</td><td class="num" style="background:${firstTdBg}">${p.first_tds}</td></tr>`;
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
// Raw usage shares pile onto one goal-line back; real first-TD shares are
// flatter (anyone can score on the opening drive), so shares are raised to
// this power and renormalized.
const FIRST_TD_SHARE_FLATTEN = 0.65;
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
  return out;
}

function firstTdPlayerTargets(offTeam, defTeam, teamChance, week) {
  const injured = firstTdInjuryStatus(offTeam, week);
  const players = ((DATA.player_xtd || {})[offTeam] || []).filter((p) => injured[normName(p.name)] !== "out");
  if (!players.length) return [];
  // Overall involvement: share of the team's targets + carries (Player
  // Props data) -- a starter who hasn't drawn goal-line looks yet still
  // plays every snap and can score first on any drive.
  const props = {};
  ((DATA.player_props || {})[offTeam] || []).forEach((pp) => (props[normName(pp.name)] = (pp.targets || 0) + (pp.carries || 0)));
  players.forEach((p) => (p.touches = props[normName(p.name)] || 0));
  const sum = (k) => players.reduce((s, p) => s + (p[k] || 0), 0) || 1;
  const totals = { early: sum("early_xtd_pg"), xtd: sum("xtd_pg"), tds: sum("tds"), touches: sum("touches") };
  const defPosZ = {};
  const raw = players.map((p) => {
    if (!(p.position in defPosZ)) defPosZ[p.position] = avgZ(modelSideZ(defTeam, "def", `first_${p.position}`).z, modelSideZ(defTeam, "def", p.position).z) || 0;
    const fullShare = p.xtd_pg / totals.xtd;
    // A thin first-TD window (a team that's barely had the ball before the
    // first TD) leans on the full-game share instead of one lucky snap.
    const earlyShare = (p.early_xtd_pg + FIRST_TD_EARLY_PRIOR * fullShare) / (totals.early + FIRST_TD_EARLY_PRIOR);
    const share = 0.3 * earlyShare + 0.35 * fullShare + 0.15 * (p.tds / totals.tds) + 0.2 * (p.touches / totals.touches);
    return { p, w: Math.pow(share, FIRST_TD_SHARE_FLATTEN) * Math.exp(0.2 * defPosZ[p.position]) };
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
        return `<tr class="${edgeCls.trim()}"><td>${p.name} <span class="muted">${p.position}</span>${inj}</td><td class="num ftd-est">${pct(p.est)}</td><td class="num">${oddsCell}</td></tr>`;
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
      return `<tr><td>${p.name}</td><td>${p.position}</td><td class="num" style="background:${firstTdBg}">${firstTds}</td><td class="num" style="background:${carriesBg}">${p.carries}</td><td class="num" style="background:${targetsBg}">${p.targets}</td><td class="num" style="background:${receptionsBg}">${p.receptions}</td></tr>`;
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
const SUMMARY_FIRST_TD_PLAYERS = 3;

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
  if (LENGTH_BUCKETS.some((b) => b.key === metric)) return bucket("td_by_length", "td_by_length_allowed", metric);
  return [cell("--", ""), cell("--", "")];
}
function summaryTargetUnit(metric) {
  if (metric === "first") return "scored 1st";
  if (metric === "rz") return "RZ TD rate";
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
  return ((DATA.player_xtd || {})[team] || [])
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

function keyPlayersForTarget(metric, pool, team, defTeam, week) {
  const rzUse = (p) => p.rz_targets + p.rz_carries;
  const deep = (p) => p.deep_targets + p.ez_targets + p.explosive_rushes;
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

function keyPlayersForTag(label, pool, team) {
  const rzUse = (p) => p.rz_targets + p.rz_carries;
  const qb = () => keyTop(pool.filter((p) => p.position === "QB"), (p) => p.pass_att, 1, 10);
  if (["RZ leak", "RZ wall", "RZ volume", "Few RZ trips"].includes(label)) return keyTop(pool, rzUse, 2, 2);
  if (label === "RZ pass edge") return keyTop(pool, (p) => p.rz_targets, 2, 1);
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

function numBadge(n) {
  return `<span class="sc-num">${n}</span>`;
}

// Season half of a team's column: numbered targets (with chart numbers),
// numbered tags, then the key players tied to those numbers.
function summarySeasonColumn(offTeam, defTeam, week) {
  const pool = keyPlayerPool(offTeam, week);
  const byPlayer = {};
  const link = (names, n, kind) =>
    names.forEach((name) => {
      const e = (byPlayer[name] = byPlayer[name] || { name, nums: [], good: false });
      e.nums.push(n);
      if (kind !== "warn") e.good = true;
    });
  let n = 0;
  const items = targetGroups(offTeam, defTeam).flatMap((g) => g.items);
  const targetRows = items.length
    ? items
        .map((i) => {
          n += 1;
          if (i.metric) link(keyPlayersForTarget(i.metric, pool, offTeam, defTeam, week), n, "good");
          const [oc, dc] = i.metric ? summaryTargetCells(i.metric, offTeam, defTeam) : ["<td></td>", "<td></td>"];
          const strong = i.score >= TARGET_STRONG_SCORE;
          const due = i.due ? `<span class="target-due">&#9650;</span>` : "";
          return `<tr><td>${numBadge(n)}<span class="target-chip${strong ? " target-chip-strong" : ""}">${i.label}${due}</span></td>${oc}${dc}<td class="sc-unit">${i.metric ? summaryTargetUnit(i.metric) : ""}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="target-none">No targets this week</td></tr>`;
  const tags = matchupTags(offTeam, defTeam);
  const tagRows = tags.length
    ? tags
        .map((t) => {
          n += 1;
          link(keyPlayersForTag(t.label, pool, offTeam), n, t.kind);
          return `<li><span class="sc-tag-head">${numBadge(n)}<span class="tag-chip tag-chip-${t.kind}">${t.label}</span></span><span class="sc-tag-text">${t.title}</span></li>`;
        })
        .join("")
    : `<li class="target-none">No tags</li>`;
  const keyPlayers = Object.values(byPlayer)
    .sort((a, b) => b.nums.length - a.nums.length || a.nums[0] - b.nums[0])
    .slice(0, KEY_PLAYERS_MAX)
    .map((e) => `<span class="sc-key${e.good ? "" : " sc-key-warn"}">${summaryHeadshot(offTeam, e.name, 18)}${shortName(e.name)}${e.nums.map(numBadge).join("")}</span>`)
    .join("");
  // Four fixed blocks (banner / targets / tags / key players) -- the two
  // team columns share row lines (CSS subgrid), so each block starts at
  // the same height on both sides even when one team has less in it.
  return `<div class="sc-col">
    ${summaryTeamBanner(offTeam)}
    <div class="sc-block"><table class="sc-table sc-targets"><thead><tr><th>Target</th><th class="num">${offTeam}</th><th class="num">${defTeam} allows</th><th></th></tr></thead><tbody>${targetRows}</tbody></table></div>
    <div class="sc-block"><div class="sc-label">Matchup Tags</div><ul class="sc-tags">${tagRows}</ul></div>
    <div class="sc-block"><div class="sc-label">Key Players</div>${keyPlayers ? `<div class="sc-keys">${keyPlayers}</div>` : `<span class="target-none">&mdash;</span>`}</div>
  </div>`;
}

// First TD half of a team's column: position chips + top players.
function summaryFirstTdColumn(offTeam, defTeam, chance, week) {
  const rgb = teamAccentRgb(offTeam);
  const pct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  const posChips = firstTdPositionTargets(offTeam, defTeam)
    .map((i) => `<span class="target-chip${i.score >= TARGET_STRONG_SCORE ? " target-chip-strong" : ""}">${i.label}</span>`)
    .join("");
  const players = firstTdPlayerTargets(offTeam, defTeam, chance, week)
    .slice(0, SUMMARY_FIRST_TD_PLAYERS)
    .map((p) => {
      const edgeCls = p.edge === null ? "" : p.edge >= 1.25 ? "ftd-edge-strong" : p.edge >= 1 ? "ftd-edge-lean" : "";
      const odds = p.odds === null ? "--" : `${p.odds > 0 ? "+" : ""}${p.odds} <span class="muted">${pct(p.implied)}</span>`;
      const inj = p.injury ? ` <span class="ftd-inj">${p.injury}</span>` : "";
      return `<tr class="${edgeCls}"><td><span class="sc-player">${summaryHeadshot(offTeam, p.name, 24)}<span>${p.name} <span class="muted">${p.position}</span>${inj}</span></span></td><td class="num ftd-est">${pct(p.est)}</td><td class="num">${odds}</td></tr>`;
    })
    .join("");
  return `<div class="sc-col">
    <div class="sc-ftd-head" style="border-left:4px solid rgb(${rgb.join(",")})">
      <img src="${teamLogoUrl(offTeam)}" crossorigin="anonymous" class="sc-team-logo" alt="">
      <span class="sc-ftd-team">${offTeam}</span>
      ${posChips ? `<span class="sc-pos-chips">${posChips}</span>` : ""}
    </div>
    <table class="sc-table sc-ftd"><thead><tr><th>Player</th><th class="num">Model</th><th class="num">Best odds</th></tr></thead><tbody>${players}</tbody></table>
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
        return `<tr><td><span class="sc-player">${summaryHeadshot(team, p.name, 26)}<span class="sc-odds-name">${p.name} <span class="muted">${p.position || ""}</span></span></span></td><td class="num">${cell(p.any, "anytime_td")}</td><td class="num">${cell(p.first, "first_td")}</td></tr>`;
      })
      .join("");
    const rgb = teamAccentRgb(team);
    return `<div class="sc-odds-team" style="border-left:4px solid rgb(${rgb.join(",")})">
        <img src="${teamLogoUrl(team)}" crossorigin="anonymous" class="sc-team-logo" alt=""><span class="sc-ftd-team">${team}</span>
      </div>
      ${rows
        ? `<table class="sc-table sc-odds"><thead><tr><th>Player</th><th class="num">Anytime</th><th class="num">1st TD</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="sc-odds-empty">Click TD Odds to pick players</p>`}`;
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
  card.innerHTML = `<div class="sc-inner">
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
      <div class="sc-main">
        <section class="sc-section">
          <div class="sc-section-title">Season TD Targets</div>
          <div class="sc-cols sc-grid4">
            ${summarySeasonColumn(away, home, week)}
            ${summarySeasonColumn(home, away, week)}
          </div>
        </section>

        <section class="sc-section sc-section-ftd">
          <div class="sc-section-title">First TD</div>
          <div class="sc-split">
            <span class="sc-split-team">${away} <b>${Math.round(pAway * 100)}%</b></span>
            <div class="ftd-split-bar"><span style="width:${pAway * 100}%;background:rgb(${rgbA.join(",")})"></span><span style="width:${(1 - pAway) * 100}%;background:rgb(${rgbH.join(",")})"></span></div>
            <span class="sc-split-team"><b>${Math.round((1 - pAway) * 100)}%</b> ${home}</span>
          </div>
          <div class="sc-split-label">chance to score the game's first TD</div>
          <div class="sc-cols sc-grid2">
            ${summaryFirstTdColumn(away, home, pAway, week)}
            ${summaryFirstTdColumn(home, away, 1 - pAway, week)}
          </div>
        </section>
      </div>
      ${summaryOddsRail(away, home, week)}
    </div>

    <div class="sc-footer">
      <span><span class="target-chip target-chip-strong">Strong</span> <span class="target-chip">Lean</span> <span class="target-due">&#9650;</span> usage ahead of TDs &middot; numbers colored like the charts (vs. league)</span>
      <span>Model % = chance to score the game's first TD &middot; highlighted rows: model above the odds' implied %</span>
    </div>
  </div>`;
  fitSummaryCard();
  // Logos/photos load after the first measurement; re-fit once they have.
  card.querySelectorAll("img").forEach((img) => img.addEventListener("load", fitSummaryCard, { once: true }));
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
