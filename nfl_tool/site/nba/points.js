// GMG NBA Suite: Points. Every player with a points line on the night's slate,
// with the line-anchored projection, in testing with its live record until
// mid-November (the banner; nfl_tool/nba/props.py, build side; props.json
// `slate`). The board itself is the shared NBA props board (props-board.js,
// loaded after this, 2026-10-23: the NHL pages' Play / GMG Fair / Odds / Good
// To / Edge, every column sorts, a tag filter). This file is what only Points
// has: PTS / FGA a game, Share, Mix and the zone-fit tags.

const ZONE_FIT = 0.025; // weighted make rate allowed this far from the league's = Zone fit / Tough zones
const ZONES = ["rim", "short", "mid", "corner3", "above3"];

// Zone fit: his shot zones x what tonight's defense allows there, against
// the league's make rate in those same zones. Both sides count: where HE
// shoots and what THIS defense gives up there.
function zoneFit(p, opp) {
  const ib = identityBlock();
  if (!ib || !p.zones || !ib.teams[opp]) return null;
  let allowed = 0;
  let league = 0;
  let total = 0;
  for (const z of ZONES) {
    const s = p.zones[z] || 0;
    const a = ib.teams[opp][`def_${z}_pct`];
    const l = (ib.league[`def_${z}_pct`] || {}).avg;
    if (a === null || a === undefined || !l) continue;
    allowed += s * a;
    league += s * l;
    total += s;
  }
  return total ? (allowed - league) / total : null;
}
function pointsTags(r) {
  const out = [];
  const fit = zoneFit(r.p || {}, r.opp);
  if (fit !== null && fit >= ZONE_FIT) out.push(TAG("zone_fit", "Zone fit", `${r.opp} allows ${(fit * 100).toFixed(1)} points of make rate above the league where he shoots`, "gs-tag-mismatch"));
  if (fit !== null && fit <= -ZONE_FIT) out.push(TAG("tough_zones", "Tough zones", `${r.opp} allows ${(-fit * 100).toFixed(1)} points of make rate below the league where he shoots`, "gs-tag-tough"));
  return out;
}

// Mix: three pills (the owner, 2026-10-23: half the width, each colored by
// his usage on a 1-100 scale): the share of his shots at the rim, from 3 and
// self-created, each ranked as a percentile among this season's players with
// MIX_MIN_FGA+ shots, on the shared 8-step rank colors (common.js RANK_SCALE,
// which the NBA pages don't load: change both together). 100 = uses it most.
const MIX_MIN_FGA = 20;
const MIX_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const MIX_PARTS = [
  ["rim", "Rim", "at the rim", (p) => p.zones.rim || 0],
  ["threes", "3s", "from 3", (p) => (p.zones.corner3 || 0) + (p.zones.above3 || 0)],
  ["self", "Self", "self-created (pull-ups, step-backs, fades)", (p) => (p.kinds || {}).self || 0],
];
const mixPools = {};
function mixPool(key, value) {
  if (!mixPools[season]) {
    const f = F();
    const players = Object.values(block().players).filter((p) => p.zones && (p.log || []).reduce((a, r) => a + r[f.fga], 0) >= MIX_MIN_FGA);
    mixPools[season] = Object.fromEntries(MIX_PARTS.map(([k, , , get]) => [k, players.map(get).sort((a, b) => a - b)]));
  }
  const pool = mixPools[season][key];
  if (!pool.length) return null;
  const below = pool.filter((v) => v < value).length;
  return Math.max(1, Math.min(100, Math.round((100 * below) / pool.length)));
}
function mixCell(p) {
  if (!p || !p.zones) return `<td class="pts-mix">--</td>`;
  const pills = MIX_PARTS.map(([key, label, what, get]) => {
    const v = get(p);
    const rank = mixPool(key, v);
    const [hue, fill] = rank === null ? [60, 0] : MIX_SCALE[Math.min(7, Math.floor(((100 - rank) / 100) * 8))];
    const style = rank === null ? "" : ` style="background:${scaleHsla(hue, 78, 44, fill)};border-color:${scaleHsla(hue, 78, 48)}"`;
    return `<span class="pts-mix-pill"${style} title="${pct(v)} of his shots ${what}${rank === null ? "" : ` (${rank} of 100 among this season's players)`}"><small>${label}</small><b>${Math.round(v * 100)}</b></span>`;
  });
  return `<td class="pts-mix"><div class="pts-mix-pills">${pills.join("")}</div></td>`;
}

// Share colored like Mix (the owner, 2026-10-23): its percentile among this
// season's players with MIX_MIN_FGA+ shots on the 8-step rank colors, green = most.
const sharePools = {};
function shareCell(r) {
  const v = r.p ? r.p.share : null;
  if (v === null || v === undefined) return `<td class="num">--</td>`;
  if (!sharePools[season]) {
    const f = F();
    sharePools[season] = Object.values(block().players)
      .filter((p) => p.share !== null && p.share !== undefined && (p.log || []).reduce((a, x) => a + x[f.fga], 0) >= MIX_MIN_FGA)
      .map((p) => p.share).sort((a, b) => a - b);
  }
  const pool = sharePools[season];
  const rank = pool.length ? Math.max(1, Math.min(100, Math.round((100 * pool.filter((x) => x < v).length) / pool.length))) : null;
  const [hue, fill] = rank === null ? [60, 0] : MIX_SCALE[Math.min(7, Math.floor(((100 - rank) / 100) * 8))];
  const style = rank === null ? "" : ` style="background:${scaleHsla(hue, 78, 44, fill)}"`;
  return `<td class="num pts-share"${style} title="His share of his team's shots while he's on the floor${rank === null ? "" : ` (${rank} of 100 among this season's players)`}">${pct(v)}</td>`;
}

const PB_PAGE = {
  title: "Points",
  stat: "points",
  slateKey: "slate",
  recordKey: "record",
  made: "pts",
  unit: "PTS",
  projDigits: 1,
  noun: "points lines",
  seasonKey: "nba-tool.pts-season.v1",
  zonesPts: null,
  wwFloor: true,
  wwCols: [["pts", "Pts"], ["min", "Min"], ["fga", "FGA"]],
  after: () => [avgCol("ppg", "pts", "Avg", "Points a game this season"), avgCol("fga", "fga", "FGA", "Shots a game this season")],
  end: [
    { key: "share", label: "Share", cls: "th-tight", title: "His share of his team's shots while he's on the floor", value: (r) => (r.p ? r.p.share : null),
      cell: shareCell },
    { key: "mix", label: "Mix", title: "The % of his shots at the rim, from 3 and self-created; sorts by his 3s", value: (r) => (r.p && r.p.zones ? (r.p.zones.corner3 || 0) + (r.p.zones.above3 || 0) : null),
      cell: (r) => mixCell(r.p) },
  ],
  tags: pointsTags,
  viewTop: null,
  ytd: {
    key: "nba-points",
    label: "Points Plays",
    splits: [
      ["over", "Overs"], ["under", "Unders"],
      ["star", "Star Lines (24.5+)", "Lines of 24.5 or more: the public's overs may push these up"],
      ["dip", "Minutes Dip", "His last 5 games' minutes 15%+ under his season: the replay says those bounce back"],
      ["role", "Role Player Usage +", "Teammates taking 10%+ of the shots are Out and he takes under 15%: the replay says the shots go to him"],
      ["opp_out", "Opponent Missing", "The other team's missing players took 15%+ of its shots"],
    ],
  },
};
