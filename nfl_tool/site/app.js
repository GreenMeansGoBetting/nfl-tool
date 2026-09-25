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
  const pair = (metric, label) => modelEntry(label, modelSideZ(offTeam, "off", metric), modelSideZ(defTeam, "def", metric));
  const stat = (key) => (t) => DATA.team_stats[t][key];
  const clean = (list) => list.filter(Boolean).sort((a, b) => b.score - a.score);
  const rz = targetEntry("Red Zone", targetRateZ(offTeam, stat("rz_td_rate")), targetRateZ(defTeam, stat("rz_td_rate_allowed")));
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

function normName(n) {
  return (n || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
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
  const sum = (k) => players.reduce((s, p) => s + (p[k] || 0), 0) || 1;
  const totals = { early: sum("early_xtd_pg"), xtd: sum("xtd_pg"), tds: sum("tds") };
  const defPosZ = {};
  const raw = players.map((p) => {
    if (!(p.position in defPosZ)) defPosZ[p.position] = avgZ(modelSideZ(defTeam, "def", `first_${p.position}`).z, modelSideZ(defTeam, "def", p.position).z) || 0;
    const share = 0.35 * (p.early_xtd_pg / totals.early) + 0.45 * (p.xtd_pg / totals.xtd) + 0.2 * (p.tds / totals.tds);
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

// ---- Season TDs / First TD view toggle (localStorage so it survives a
// reload during a stream; a "?view=first" URL param wins on first load so
// the old first-td.html redirect can still land you on the right tab) ----
const TD_VIEW_KEY = "nfl-tool.td-view.v1";
let currentView = "season";

function loadSavedView() {
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl === "first" || fromUrl === "season") return fromUrl;
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
