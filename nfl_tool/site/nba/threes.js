// GMG NBA Suite: Threes (threes made). Built 2026-10-23 from the 2025-26 replay
// (tools/backtest/nba_threes.py): tries are predictable, makes mostly aren't,
// so the projection is tries x make rate (nfl_tool/nba/props.py our_threes /
// project_threes; props.json `threes_slate`). The board itself is the shared
// NBA props board (props-board.js, loaded after this); this file is what only
// Threes has: Proj Att, 3PA / 3PM a game, its tags and the ladder.

const TAG_Z = 1; // a defense this many league spreads from average = 3s Allowed / Tough 3s D / Help D
const SHOOTER_SHARE = 0.3; // his share of shots from 3 at which a defense's threes matter to him
const CATCH_SHARE = 0.35; // his share of shots that are catch-and-shoot, for Help D
const DOG = 6; // his team getting this many points = Underdog (the replay: trailing teams shoot more)
const STREAK = 0.6; // makes a game off his own rate over the last 5 = Cold Run / Hot Run
const LADDER_EDGE = 0.03; // our chance this far over / under a rung's price = shaded

// A defense's number in league spreads from average (Team Identity, this season).
function defZ(opp, key) {
  const ib = identityBlock();
  const v = ib && ib.teams[opp] ? ib.teams[opp][key] : null;
  const lg = ib ? ib.league[key] : null;
  return v === null || v === undefined || !lg || !lg.sd ? null : (v - lg.avg) / lg.sd;
}

// Tags read both sides: his and this defense's.
function threesTags(r) {
  const p = r.p || {};
  const row = r.row;
  const out = [];
  const threes = p.zones ? (p.zones.corner3 || 0) + (p.zones.above3 || 0) : null;
  const z3 = defZ(r.opp, "def_three_pp");
  if (z3 !== null && z3 >= TAG_Z && threes !== null && threes >= SHOOTER_SHARE) out.push(TAG("allowed", "3s Allowed", `${r.opp} allows ${fmt(z3)} league spreads more threes a possession than average, and ${pct(threes)} of his shots are threes`, "gs-tag-mismatch"));
  if (z3 !== null && z3 <= -TAG_Z) out.push(TAG("tough", "Tough 3s D", `${r.opp} allows ${fmt(-z3)} league spreads fewer threes a possession than average`, "gs-tag-tough"));
  const zc = defZ(r.opp, "def_catch3");
  const catchShare = (p.kinds || {}).catch;
  if (zc !== null && zc >= TAG_Z && catchShare !== undefined && catchShare >= CATCH_SHARE) out.push(TAG("help", "Help D", `Threes against ${r.opp} are catch-and-shoot ${fmt(zc)} league spreads more than average (help defense leaving shooters), and ${pct(catchShare)} of his shots are catch-and-shoot`, "gs-tag-mismatch"));
  if (row.spread !== null && row.spread !== undefined && row.spread >= DOG) out.push(TAG("dog", `Underdog +${fmt(row.spread)}`, `His team is getting ${fmt(row.spread)}: trailing teams shoot more threes (last season's replay)`));
  if (row.luck !== null && row.luck !== undefined && row.luck <= -STREAK) out.push(TAG("cold", "Cold Run", `His last 5 games: ${fmt(-row.luck)} fewer makes a game than his own make rate says. Last season's replay: he tries a few % fewer next game; his make rate doesn't change`));
  if (row.luck !== null && row.luck !== undefined && row.luck >= STREAK) out.push(TAG("hot", "Hot Run", `His last 5 games: ${fmt(row.luck)} more makes a game than his own make rate says. Last season's replay: he tries a few % more next game; his make rate doesn't change`));
  return out;
}

// The ladder: only rungs a book really prices (the owner: an alt ladder
// "without odds its just filler"), from the main line and the alternates.
function ladderView(r) {
  const chances = r.row.ladder || [];
  const quotes = [...((bookRow(r.g, r.pid) || {}).q || []), ...((bookRow(r.g, r.pid, "threes_alt") || {}).q || [])];
  const rows = chances.map((c, i) => {
    const k = i + 1;
    const best = bookBest(quotes, "o", k - 0.5);
    if (!best || c === null || c === undefined) return "";
    const edge = c - oddsProb(best[3]);
    const cls = edge >= LADDER_EDGE ? "tier-good" : edge <= -LADDER_EDGE ? "tier-bad" : "";
    return `<tr><td><b>${k}+ Threes</b></td><td class="num">${showOdds(probToAmerican(c))}<small>${pct(c)}</small></td>
      <td class="num">${showOdds(best[3])}<small>${BOOK_NAMES[best[0]] || best[0]}</small></td>
      <td class="num ${cls}">${edge >= 0 ? "+" : ""}${Math.round(edge * 100)}%</td></tr>`;
  }).join("");
  const body = rows ? `<table class="data-table th-ladder"><thead><tr><th>Rung</th><th>Our Fair</th><th>Best Price</th><th>Edge</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="no-data-note">No book prices these rungs right now.</p>`;
  return `<h4>The Ladder <button type="button" class="info-i" aria-expanded="false" aria-controls="th-ladder-note-${r.pid}" title="How to read this">i</button></h4>
    <p class="info-note" id="th-ladder-note-${r.pid}" hidden>Each rung: our chance of that many threes or more (as a fair price, % under it), the best price across your books, and how far our chance is over (green) or under (red) the chance that price needs. A night's threes swing wider than a plain average says, so big nights hit more often than most expect. Only rungs a book prices are shown. In testing like the projection.</p>
    ${body}`;
}

const PB_PAGE = {
  title: "Threes",
  stat: "threes",
  slateKey: "threes_slate",
  recordKey: "threes_record",
  made: "fg3m",
  unit: "3PM",
  projDigits: 2,
  noun: "threes lines",
  seasonKey: "nba-tool.threes-season.v1",
  zonesPts: "3",
  wwFloor: false,
  wwCols: [["fg3m", "3PM"], ["fg3a", "3PA"], ["min", "Min"]],
  // Proj Att: the threes we expect him to try (the predictable part), between Play and Proj
  before: [{ key: "att", label: "Proj Att", title: "Threes we expect him to try tonight: the part last season's replay could predict", cls: "th-narrow",
             value: (r) => r.row.tries,
             cell: (r) => `<td class="num th-proj" title="His make rate: ${pct(r.row.pct)} (his season, pulled 200 tries toward the league's)"><b>${fmt(r.row.tries)}</b></td>` }],
  after: () => [avgCol("a3", "fg3a", "3PA", "Threes tried a game this season"), avgCol("m3", "fg3m", "3PM", "Threes made a game this season")],
  tags: threesTags,
  viewTop: ladderView,
  ytd: {
    key: "nba-threes",
    label: "Threes Plays",
    splits: [
      ["over", "Overs"], ["under", "Unders"],
      ["half", "0.5 Lines", "Lines of 0.5: one make is an Over"],
      ["dip", "Minutes Dip", "His last 5 games' minutes 15%+ under his season: the replay says those bounce back"],
      ["role", "Role Player Usage +", "Teammates taking 10%+ of the shots are Out and he takes under 15%: the replay says the shots go to him"],
      ["dog", "Underdogs (+6)", "His team getting 6+: trailing teams shoot more threes"],
      ["cold", "Cold Run", "His last 5 made 0.6+ a game under his own rate"],
      ["hot", "Hot Run", "His last 5 made 0.6+ a game over his own rate"],
    ],
  },
};
