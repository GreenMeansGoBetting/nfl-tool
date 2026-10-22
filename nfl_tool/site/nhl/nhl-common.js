// ---- GMG NHL Suite: shared by every NHL page ----
// The data, the helpers, the rink drawing and the ONE player card. Loaded
// before the page's own script (nhl.js for Game Previews). Like the NBA
// page it stands apart from the NFL site's common.js but shares style.css:
// layout classes are the NBA page's (.nba-*), hockey-only ones are .nhl-*.
// Data: nhl/data.json plus one file per team in nhl/players/ (the card's
// game logs and shot areas), all built by nfl_tool/nhl/build_nhl.py.

// This season only: there is no last-season data on any NHL page (the owner,
// 2026-10-13: "Let's scrap all of last year's data on the site").
let DATA = null;

const el = (id) => document.getElementById(id);
const has = (n) => n !== null && n !== undefined;
const fmt = (n, digits = 1) => (has(n) ? Number(n).toFixed(digits) : "--");
const pct = (n, digits = 1) => (has(n) ? `${(n * 100).toFixed(digits)}%` : "--");
const svPct = (n) => (has(n) ? n.toFixed(3).replace(/^0/, "") : "--");
const signed = (n, digits = 1) => (has(n) ? `${n > 0 ? "+" : ""}${Number(n).toFixed(digits)}` : "--");
const odds = (n) => (has(n) ? showOdds(n) : ""); // the member's odds format (sync.js)
const team = (abbr) => DATA.teams[abbr] || { name: abbr, short: abbr, color: "555555", logo: "" };
const isLight = () => document.documentElement.dataset.theme === "light";
const logoUrl = (abbr) => (isLight() ? team(abbr).logo : team(abbr).logo_dark || team(abbr).logo) || "";
const logo = (abbr, size = 18) => `<img src="${logoUrl(abbr)}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
const stats = () => DATA.team_stats || {};
const viewLabel = () => DATA.season_label;
function teamRgb(abbr) {
  const hex = team(abbr).color || "555555";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
}
function banner(abbr, right = "") {
  return `<div class="team-banner" style="background:rgba(${teamRgb(abbr)},0.22);border-left:4px solid rgb(${teamRgb(abbr)})">${logo(abbr, 22)}<span class="team-banner-name">${team(abbr).name}</span>${right ? `<span class="nba-banner-right">${right}</span>` : ""}</div>`;
}
function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
// ---- the Shots / Goals tables ----
// The "advanced stats" columns (minutes and each piece that moved the number) start folded
// away (the owner, 2026-10-15: "too much info right now thrown at users"); the switch is
// remembered on this device, the same for both pages. Called with a value, it saves it.
const ADVANCED_KEY = "nfl-tool.nhl-advanced";
function nhlAdvancedStats(on) {
  try {
    if (has(on)) localStorage.setItem(ADVANCED_KEY, on ? "1" : "0");
    return localStorage.getItem(ADVANCED_KEY) === "1";
  } catch (e) {
    return !!on;
  }
}
const shownColumns = (columns, adv) => columns.filter((c) => adv || !c.adv);
const advancedToggle = (on) =>
  `<span class="shots-filter"><button type="button" id="shots-adv-toggle" class="view-toggle-btn shots-filter-btn shots-adv-toggle${on ? " active" : ""}" data-filter="adv" data-value="${!on}" title="Minutes and what moved the number tonight: the other defense, his position, the power play, home ice and rest">${on ? "Hide advanced stats" : "Expand advanced stats"}</button></span>`;
// The record's bucket on a row: Strong / Lean / Check, the same tags as the YTD record's table.
const ratingTag = (size, label, tip) => `<span class="shots-record-size shots-record-${size}" title="${tip}">${label}</span>`;
// Saves (saves.js, best.js): who should start, and how much stands behind the name (crease_starter in build_nhl.py).
function starterTip(r) {
  return {
    both: "The NHL's projected lineup and the goalie Novig prices agree. A projection, never a confirmation: starters are official at warmups.",
    split: `Novig prices ${r.name}; the NHL's projected lineup has ${r.other}. The book's goalie is shown (it is the later of the two). If the other one starts, the bet is void.`,
    lineup: `Only the NHL's projected lineup names him so far${r.doubt ? ". He started last night, so check before you bet" : ""}.`,
    market: "Only Novig's saves line names him so far: the NHL hasn't posted this game's projected lineup.",
    usual: "Neither the NHL's lineup nor a saves line names a starter yet: the goalie with the most starts, or his partner on the second night of a back-to-back.",
  }[r.source] || "";
}
function starterTag(r) {
  if (r.source === "both") return `<span class="shots-flag saves-agree" title="${starterTip(r)}">&#10003; agree</span>`;
  if (r.source === "split") return `<span class="shots-flag shots-fade" title="${starterTip(r)}">Lineup: ${(r.other || "").split(" ").slice(-1)[0]}</span>`;
  if (r.doubt) return `<span class="shots-flag shots-fade" title="${starterTip(r)}">Started last night</span>`;
  return `<span class="shots-flag saves-plain" title="${starterTip(r)}">${{ lineup: "Lineup only", market: "Book only", usual: "Usual starter" }[r.source] || ""}</span>`;
}
// Saves' other "check": the model and what the line and price say are `apart`+ saves apart.
const savesGapCheck = (r, apart) => ({ label: "Check", tip: `The model has ${fmt(r.mean, 1)} saves; the line and price say ${fmt(r.mkt_mean, 1)}. ${apart}+ saves apart is more often a starter or news the book knows. Check before you bet.` });
// The safety net (UNSURE_EDGE in build_nhl.py, sent as each file's `unsure`): an edge this big
// means the model is missing something (Jake Sanderson, 2026-10-21: one game cut short by injury
// read as his role). The build files it "unsure": listed, never a play.
const unsureEdge = (file) => (file && has(file.unsure) ? file.unsure : 0.25);
const unsureTip = (file) => `The model and the market are ${Math.round(unsureEdge(file) * 100)}+ points apart. That usually means the model is missing something (a game cut short by injury, a role it can't see yet), so this is not a play.`;
const unsureTag = (file) => ratingTag("unsure", "Model Unsure", unsureTip(file));
const unsureHead = (file) => `Model Unsure: ${unsureTip(file).replace("this is not a play", "these are not plays")}`;
// Closing line value (clv_move in build_nhl.py, 2026-10-22): read on Novig's own prices only, both sides
// with the cut taken out, at the first look and at the lock. Wins and units stay at the best price
// across books; comparing best prices at two times read "drifted" by construction (more books by puck drop).
function clvTile(clv) {
  clv = clv || {};
  const tip = "Closing line value on the plays: how far Novig's own price moved toward the play from the first look to the lock before puck drop, both sides with the cut taken out, in points of chance (+ = the market moved toward the model). A line that moved counts by direction (an over whose line went up). Novig only: the best price across books moves with how many books have posted, not with the market. Plays Novig didn't price both times are left out.";
  const value = has(clv.points) ? `${clv.points > 0 ? "+" : ""}${(clv.points * 100).toFixed(1)}` : "--";
  const since = clv.since ? ` &middot; since ${shortDate(clv.since)}` : "";
  return `<div class="ytd-tile" title="${tip}"><div class="ytd-label">Closing Line Value</div><b>${value}</b><small class="ytd-line">${clv.plays ? `${clv.shortened} shortened &middot; ${clv.drifted} drifted &middot; ${clv.plays} plays${since}` : "None Yet"}</small></div>`;
}
// Every NHL prop page's YTD Model Performance popup, one layout (2026-10-22): the shared
// tracker (../ytd.js: time windows, a Min Edge slider, split tiles), then the season-only
// tiles it can't filter (Not Plays, closing line value...), then `after` (Said vs scored),
// then the page's graded plays from `list()`, which keeps them to the tracker's window and
// slider with ytdKeeps and is redrawn whenever they change.
// A record from before the build sent a `ledger` can't be filtered: the same tiles from its
// season buckets (`record[key]`, a market's `only` buckets added up), with no window or slider.
function nhlYtd(box, { intro, record, tracker, season, after, list }) {
  box.innerHTML = `${intro}<div class="ytd-box"></div>
    ${season ? `<div class="shots-detail-label ytd-season">Season To Date <span class="muted-label">not filtered by the window or slider</span></div><div class="ytd-tiles">${season}</div>` : ""}
    ${after || ""}<div class="ytd-list"></div>`;
  const draw = () => {
    box.querySelector(".ytd-list").innerHTML = list();
  };
  if (tracker.markets.some((m) => m.ledger)) ytdTracker(box.querySelector(".ytd-box"), { ...tracker, onChange: draw });
  else {
    const add = (keys) => keys.reduce((t, k) => {
      const b = record[k] || {};
      return { wins: t.wins + (b.wins || 0), losses: t.losses + (b.losses || 0), units: t.units + (b.units || 0) };
    }, { wins: 0, losses: 0, units: 0 });
    box.querySelector(".ytd-box").innerHTML = `<div class="ytd-tiles">${tracker.markets.map((m) => ytdSeasonTile(m.label, add(m.only || [m.key]), m.tip || "")
      + (m.splits || []).map(([tag, label, tip]) => ytdSeasonTile(label, add([tag]), tip || "")).join("")).join("")}</div>`;
  }
  draw();
}
// A season tile in the tracker's look.
function ytdSeasonTile(label, t, tip) {
  t = t || { wins: 0, losses: 0, units: 0 };
  const played = t.wins + t.losses;
  const kind = !played ? "" : t.units > 0.05 ? " ytd-up" : t.units < -0.05 ? " ytd-down" : "";
  return `<div class="ytd-tile" title="${tip}"><div class="ytd-label">${label}</div><b>${t.wins}-${t.losses}</b><small class="ytd-line${kind}">${played ? `${Math.round((100 * t.wins) / played)}% &middot; ${t.units >= 0 ? "+" : ""}${t.units.toFixed(1)}u` : "None Yet"}</small></div>`;
}
// The build's bucket for a Goals or Points row (`size`, the one the record grades), as one tag.
// Every page that shows such a play draws it with this, so a "Check" on the Goals or Points
// page is a "Check" on Best Plays too (a member caught one listed as a plain play, 2026-10-20).
// `otherCheck` = {label, tip} for a page whose "check" below the check edge means something else
// (Saves: the model and the line 4+ saves apart); by default a line move ("New line").
function bucketTag(r, edges, otherCheck) {
  const n = (size) => Math.round(edges[size] * 100);
  if (r.size === "unsure") return unsureTag();
  if (r.size === "strong") return ratingTag("strong", "Strong", `An edge of ${n("strong")} to ${n("check")} points`);
  if (r.size === "lean") return ratingTag("lean", "Lean", `An edge of ${n("lean")} to ${n("strong")} points`);
  if (r.size !== "check") return "";
  return has(r.edge) && r.edge >= edges.check
    ? ratingTag("check", "Check", "A gap this big usually means the market knows something this season's few games don't. Check before you bet.")
    : otherCheck ? ratingTag("check", otherCheck.label, otherCheck.tip)
    : ratingTag("check", "New line", `${r.name} is on a ${r.move === "up" ? "higher" : "lower"} line tonight than his minutes this season say he has been on, and this play goes the other way: his games so far describe a different role.`);
}
const headshot = (p, cls = "nhl-headshot") => (p.headshot ? `<img src="${p.headshot}" alt="" class="${cls}" loading="lazy">` : `<span class="${cls}"></span>`);

// ---- league comparison ----
// z-score of one team's stat against all 32, flipped when lower is better,
// so positive always means "good for the unit this number belongs to".
function zScore(key, abbr, lowerIsBetter) {
  const values = Object.values(stats()).map((s) => s[key]).filter(has);
  const value = (stats()[abbr] || {})[key];
  if (values.length < 3 || !has(value)) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  if (!sd) return 0;
  return ((value - mean) / sd) * (lowerIsBetter ? -1 : 1);
}
const tierClass = (z) => (z === null ? "" : z >= 0.5 ? "tier-good" : z <= -0.5 ? "tier-bad" : "tier-mid");
function leagueRank(key, abbr, lowerIsBetter) {
  const sorted = Object.entries(stats())
    .filter(([, s]) => has(s[key]))
    .sort((a, b) => (lowerIsBetter ? a[1][key] - b[1][key] : b[1][key] - a[1][key]));
  const i = sorted.findIndex(([t]) => t === abbr);
  return i === -1 ? null : i + 1;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
// A rank as it is SAID, from the nearer end, so it can't be read backwards: "3rd most",
// "2nd fewest", "the most". mostRank counts 1st = the most (what the colors run on: the most
// shots = green). The owner read "27th most" and "30th" as soft defenses when both were stingy,
// then "31st fewest" for a leaky one (2026-10-14: "it should flip and read x most when they are
// bad and x fewest when they are good ... split 50/50"). `words` swaps in "highest" / "lowest".
function rankWords(mostRank, total = teamCount(), words = ["most", "fewest"]) {
  if (!mostRank || !total) return "";
  if (mostRank <= total / 2) return mostRank === 1 ? `the ${words[0]}` : `${ordinal(mostRank)} ${words[0]}`;
  const fromEnd = total + 1 - mostRank;
  return fromEnd === 1 ? `the ${words[1]}` : `${ordinal(fromEnd)} ${words[1]}`;
}
// The same rank for a box on the rink: the ordinal over a small "most" / "fewest".
function rankBoxText(mostRank, total = teamCount()) {
  const top = mostRank <= total / 2;
  return { text: ordinal(top ? mostRank : total + 1 - mostRank), sub: top ? "most" : "fewest" };
}

// ---- league rank on the site's eight colors ----
// The NFL Summary cards' scale (RANK_SCALE in common.js, which NHL pages
// don't load: keep the two lists the same): two greens, lime, yellow, amber,
// orange, red-orange, red, four teams to a step, the ends filled hardest.
// On a rink it says how many shots the matchup points to from a spot, so
// 1st = the most = green and last = the fewest = red.
const RANK_SCALE = [[135, 0.62], [122, 0.44], [88, 0.36], [58, 0.34], [42, 0.36], [26, 0.42], [12, 0.5], [0, 0.64]];
const rankStep = (rank, total) => Math.min(RANK_SCALE.length - 1, Math.max(0, Math.floor(((rank - 1) / total) * RANK_SCALE.length)));
const stepFill = (step) => scaleHsla(RANK_SCALE[step][0], 78, 44, RANK_SCALE[step][1]); // the member's color set (sync.js)
const stepEdge = (step) => scaleHsla(RANK_SCALE[step][0], 78, 48);
// A rink zone on a step (what rinkSvg's zoneFn hands back), and a table cell on one.
const zoneOnStep = (step) => ({ cls: `nhl-zone-rank nhl-zone-step-${step + 1}`, style: `--zone-fill:${stepFill(step)};--zone-edge:${stepEdge(step)}` });
const cellOnStep = (step) => ` style="background-color:${stepFill(step)};box-shadow:inset 0 0 0 1px ${stepEdge(step)}"`;
// The key under a rink: the eight colors, from the most shots to the fewest.
const rankScaleKey = (most, fewest) => `<span class="nhl-scale-key">${most}<span class="g5-scale">${RANK_SCALE.map((_, step) => `<i style="background:${stepFill(step)};border-color:${stepEdge(step)}"></i>`).join("")}</span>${fewest}</span>`;

// ---- the rink ----
// The offensive zone, net at the top, as the shooter sees it. Drawn in feet:
// 85 wide, the end boards at y = 0, the goal line at 11, the blue line at 75.
// The shapes match shot_area() in build_nhl.py (change both together).
const RINK_ZONES = [
  { key: "point", label: "Point", shape: `<rect x="0" y="46" width="85" height="29"/>`, at: [42.5, 58] },
  { key: "left", label: "Left side", shape: `<polygon points="20.5,46 0,46 0,0 42.5,0 42.5,11 33.5,11 33.5,16.95 20.5,31"/>`, at: [11, 29] },
  { key: "right", label: "Right side", shape: `<polygon points="64.5,46 85,46 85,0 42.5,0 42.5,11 51.5,11 51.5,16.95 64.5,31"/>`, at: [74, 29] },
  { key: "slot", label: "Slot", shape: `<polygon points="20.5,31 20.5,46 64.5,46 64.5,31 51.5,16.95 51.5,31 33.5,31 33.5,16.95"/>`, at: [42.5, 34.4] },
  { key: "low_slot", label: "Low slot", shape: `<rect x="33.5" y="11" width="18" height="20"/>`, at: [42.5, 18.6] },
  { key: "long", label: "Outside the zone", shape: `<rect x="0" y="75" width="85" height="9"/>`, at: [42.5, 78.2], small: true },
];
// Tables list the areas from the net out (the drawing order above is back to front).
const AREA_ROWS = ["low_slot", "slot", "left", "right", "point", "long"].map((key) => RINK_ZONES.find((z) => z.key === key));
// One rink. zoneFn(zone) -> { cls, style, tip, big, small, boxes, league } says how
// each zone is filled and what it reads; the strip outside the zone gets one
// line ("big · small"). Drawn in layers: the zones' colors, the rink's lines
// over them, the numbers on top.
// `boxes` ([{ text, step, w }], in place of `small`) is a row of small boxes
// under the big number, each on its own rank color (`step`, as rankStep
// gives it): the three things a defense allows from that zone. Sized so three
// fit across the low slot, the narrowest zone (18 ft).
const ZONE_BOX = { w: 5.5, h: 3.7, gap: 0.4 };
function zoneBoxes(x, top, boxes) {
  const widths = boxes.map((b) => b.w || ZONE_BOX.w);
  let left = x - (widths.reduce((a, w) => a + w, 0) + (boxes.length - 1) * ZONE_BOX.gap) / 2;
  return boxes
    .map((b, i) => {
      const at = `x="${left.toFixed(2)}" y="${top.toFixed(2)}" width="${widths[i]}" height="${ZONE_BOX.h}" rx="0.7"`;
      const mid = left + widths[i] / 2;
      left += widths[i] + ZONE_BOX.gap;
      // A solid back first, so a box stands out from a zone filled with the same color.
      // A rank box (`sub`) has two lines: the ordinal over a small "most" / "fewest".
      const words = b.sub
        ? `<text x="${mid.toFixed(2)}" y="${(top + 1.7).toFixed(2)}">${b.text}</text><text class="nhl-zone-box-sub" x="${mid.toFixed(2)}" y="${(top + 3.27).toFixed(2)}">${b.sub}</text>`
        : `<text x="${mid.toFixed(2)}" y="${(top + 2.62).toFixed(2)}">${b.text}</text>`;
      return `<g class="nhl-zone-box${has(b.step) ? ` nhl-zone-box-step-${b.step + 1}` : ""}"><rect class="nhl-zone-box-back" ${at}/><rect class="nhl-zone-box-fill" ${at}${has(b.step) ? ` style="fill:${stepFill(b.step)};stroke:${stepEdge(b.step)}"` : ""}/>${words}</g>`;
    })
    .join("");
}
function rinkSvg(uid, ariaLabel, zoneFn) {
  let shapes = "";
  let labels = "";
  RINK_ZONES.forEach((z) => {
    const d = zoneFn(z) || {};
    const [x, y] = z.at;
    // `league` (leagueAttr) makes the zone open the league-wide list for that spot; `click` says what a click shows.
    shapes += `<g class="nhl-zone${d.cls ? ` ${d.cls}` : ""}${d.league ? " nhl-zone-click" : ""}"${d.style ? ` style="${d.style}"` : ""}${d.league ? ` data-league="${d.league}"` : ""}><title>${(d.tip || z.label).replace(/\.$/, "")}${d.league ? `. ${d.click || "Click for every team."}` : ""}</title>${z.shape}</g>`;
    // The small print over a colored zone is drawn in the full text color so it stays readable.
    labels += `<g${d.cls ? ` class="nhl-zone-on-color"` : ""}>${z.small
      ? `<text class="nhl-zone-label" x="${x}" y="${y + 2.4}">${z.label}: ${d.big ?? "--"}${d.small ? ` &middot; ${d.small}` : ""}</text>`
      : d.boxes
        ? `<text class="nhl-zone-label" x="${x}" y="${y}">${z.label}</text><text class="nhl-zone-big nhl-zone-big-boxed" x="${x}" y="${y + 5.9}">${d.big ?? "--"}</text>${zoneBoxes(x, y + 7, d.boxes)}`
        : `<text class="nhl-zone-label" x="${x}" y="${y}">${z.label}</text><text class="nhl-zone-big" x="${x}" y="${y + 6.6}">${d.big ?? "--"}</text>${d.small ? `<text class="nhl-zone-small" x="${x}" y="${y + 10.4}">${d.small}</text>` : ""}`}</g>`;
  });
  return `<svg class="nhl-rink" viewBox="0 0 85 84" role="img" aria-label="${ariaLabel}">
      <defs><clipPath id="${uid}"><path d="M0,84 L0,28 A28,28 0 0 1 28,0 L57,0 A28,28 0 0 1 85,28 L85,84 Z"/></clipPath></defs>
      <g clip-path="url(#${uid})">
        <rect class="nhl-ice" x="0" y="0" width="85" height="84"/>
        ${shapes}
        <g class="nhl-marks">
          <line class="nhl-goal-line" x1="0" y1="11" x2="85" y2="11"/>
          <line class="nhl-blue-line" x1="0" y1="75" x2="85" y2="75"/>
          <circle cx="20.5" cy="31" r="15"/><circle cx="64.5" cy="31" r="15"/>
          <circle class="nhl-dot" cx="20.5" cy="31" r="1"/><circle class="nhl-dot" cx="64.5" cy="31" r="1"/>
          <path class="nhl-crease" d="M36.5,11 A6,6 0 0 0 48.5,11 Z"/>
          <rect class="nhl-net" x="39.5" y="7.7" width="6" height="3.3"/>
        </g>
        <g class="nhl-zone-text">${labels}</g>
      </g>
      <path class="nhl-boards" d="M0,84 L0,28 A28,28 0 0 1 28,0 L57,0 A28,28 0 0 1 85,28 L85,84"/>
    </svg>`;
}

// ---- every team, for one number (the NFL site's league-rank popup, hockey's own copy) ----
// Click a rink zone (or the boxes on it) or an Offense vs Defense number to see every team's
// number for that exact thing, so "allows 13.5" can be weighed against the league. The page
// puts leagueAttr(p) on the element as data-league; p is one of:
//   { area, def, off? }  a rink spot: what each defense allows from there (shots a game and
//                        that spot's share of everything it allows), and with `off` every
//                        offense's shots from there beside it;
//   { label, kind, offKey, defKey, off, def }  an Offense vs Defense row.
// Each side is sorted from the most to the fewest, said in words down the left ("2nd most",
// "3rd fewest"), and every number is on the eight rank colors by its own league rank. The
// rink's lists keep the rink's colors (the most shots = green, either side); a matchup row's
// defense is colored like its table cell (allowing the least = green).
const leagueAttr = (p) => encodeURIComponent(JSON.stringify(p));
function leagueSpec(p) {
  const zone = p.area && RINK_ZONES.find((z) => z.key === p.area);
  if (zone) {
    const shots = (v) => fmt(v);
    const share = (v) => pct(v, 0);
    return {
      title: `${zone.label}: every team`,
      note: p.off
        ? "Shots a game from this spot (on goal or wide), and its share of all of the team's shots, or of all the shots a defense allows."
        : "Shots a game each defense allows from this spot (on goal or wide), and its share of all the shots it allows.",
      words: ["most", "fewest"],
      sides: [
        p.off ? { head: "Offense", team: p.off, cols: [{ key: `off_${zone.key}_pg`, label: "Shots / g", show: shots }, { key: `off_${zone.key}_share`, label: "Share", show: share }] } : null,
        { head: "Defense", team: p.def, cols: [{ key: `def_${zone.key}_pg`, label: "Allows / g", show: shots }, { key: `def_${zone.key}_share`, label: "Share", show: share }] },
      ].filter(Boolean),
    };
  }
  const show = (v) => (p.kind === "pct" ? pct(v) : fmt(v, p.kind === "num2" ? 2 : 1));
  return {
    title: `${p.label}: every team`,
    note: "Green is good for that unit: a lot for an offense, a little allowed for a defense.",
    words: p.kind === "pct" ? ["highest", "lowest"] : ["most", "fewest"],
    sides: [
      { head: "Offense", team: p.off, cols: [{ key: p.offKey, label: "For", show }] },
      { head: "Defense", team: p.def, cols: [{ key: p.defKey, label: "Allows", show, low: true }] },
    ],
  };
}
// One side's rows, most first: [{ team, cells: [td html] }].
function leagueSideRows(side) {
  const all = Object.keys(stats());
  const count = (key) => all.filter((t) => has(stats()[t][key])).length;
  return all
    .filter((t) => has(stats()[t][side.cols[0].key]))
    .sort((a, b) => stats()[b][side.cols[0].key] - stats()[a][side.cols[0].key])
    .map((t) => ({
      team: t,
      cells: side.cols.map((c) => {
        const v = stats()[t][c.key];
        const rank = leagueRank(c.key, t, false);
        const n = count(c.key);
        const step = rank ? rankStep(c.low ? n + 1 - rank : rank, n) : null;
        return `<td class="num nhl-league-val${t === side.team ? " nhl-league-cur" : ""}"${has(step) ? cellOnStep(step) : ""}>${has(v) ? c.show(v) : "--"}</td>`;
      }),
    }));
}
function ensureLeagueModal() {
  if (el("nhl-league-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "nhl-league-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box nhl-league-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="nhl-league-content"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLeagueModal();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closeLeagueModal);
  // Escape closes this one first when it sits over the player card.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !overlay.hidden) {
        e.stopPropagation();
        closeLeagueModal();
      }
    },
    true
  );
}
function closeLeagueModal() {
  if (el("nhl-league-modal")) el("nhl-league-modal").hidden = true;
}
// Who on one team shoots the most from one spot: a rink zone with `who` (a team, or true for
// the zone's `off`) lists these players above every team's number. Game Previews lists each
// offense's; a player's rink (Shots and Goals rows, the card's Shot Map) lists his own team's
// with `me` (his id) outlined, and adds his row with its place on the team if he isn't in the
// top 8, so an over / under can be read against his teammates. Shots a game from there (on goal
// or wide, like the rink) from the team's players file. Players out injured are left off
// (day-to-day stay), and a player needs a few games so one hot night can't top the list.
const SHOOTER_MIN_GAMES = 3;
const SHOOTER_ROWS = 8;
const whoTeam = (p) => (p.who === true ? p.off : p.who) || null;
function zoneShooters(file, abbr, area) {
  const out = new Set((DATA.injuries[abbr] || []).filter((p) => p.id && p.status !== "Day-To-Day").map((p) => p.id));
  const rows = (DATA.skaters[abbr] || [])
    .filter((p) => !out.has(p.id))
    .map((p) => {
      const season = file && file.skaters && file.skaters[p.id] && file.skaters[p.id].season;
      const games = season ? season.log.length : 0;
      if (!games) return null;
      const areas = season.areas || {};
      const located = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
      const [shots = 0, onGoal = 0, goals = 0] = areas[area] || [];
      return { p, games, shots, onGoal, goals, pg: shots / games, share: located ? shots / located : null };
    })
    .filter(Boolean);
  const min = Math.min(SHOOTER_MIN_GAMES, Math.max(0, ...rows.map((r) => r.games)));
  return rows
    .filter((r) => r.games >= min && r.shots > 0)
    .sort((a, b) => b.pg - a.pg || b.shots - a.shots);
}
function zoneShootersHtml(file, abbr, area, me) {
  if (!file) return `<p class="no-data-note">Couldn't load ${abbr}'s players.</p>`;
  const all = zoneShooters(file, abbr, area);
  if (!all.length) return `<p class="no-data-note">No ${abbr} shots from here yet.</p>`;
  const list = all.slice(0, SHOOTER_ROWS);
  // Shots a game on the eight colors down the list (the most = green), like the rink; ties share a color.
  const rankOf = (r) => 1 + all.filter((o) => fmt(o.pg) !== fmt(r.pg) && o.pg > r.pg).length;
  const row = (r) => `<tr${r.p.id === me ? ' class="nhl-who-me"' : ""}>
        <td class="nba-player">${playerClick(r.p.id, `${headshot(r.p)}<span>${r.p.name}</span>`)}<span class="muted-label">${r.p.pos || ""}</span></td>
        <td class="num nhl-league-val"${list.length > 1 ? cellOnStep(rankStep(Math.min(rankOf(r), list.length), list.length)) : ""}>${fmt(r.pg)}</td>
        <td class="num">${pct(r.share, 0)}</td><td class="num">${r.onGoal}</td><td class="num">${r.goals}</td><td class="num">${r.games}</td>
      </tr>`;
  // The opened player below the top 8: his own row, with his place on the team.
  const mine = me && !list.some((r) => r.p.id === me) ? all.find((r) => r.p.id === me) : null;
  const tail = me && !list.some((r) => r.p.id === me)
    ? `<tr class="nhl-who-gap"><td colspan="6">${mine ? `${ordinal(rankOf(mine))} on ${abbr} from here` : `No shots from here yet${findPlayer(me) ? ` for ${findPlayer(me).row.name}` : ""}`}</td></tr>${mine ? row(mine) : ""}`
    : "";
  return `<div class="nhl-league-scroll"><table class="data-table nhl-league-table nhl-who-table">
      <thead><tr><th>${logo(abbr, 16)} Player</th><th class="num" title="Shots a game from here, on goal or wide">Shots / g</th><th class="num" title="Share of all his shots that come from here">Share</th><th class="num" title="Shots on goal from here">On goal</th><th class="num">Goals</th><th class="num" title="Games played">GP</th></tr></thead>
      <tbody>${list.map(row).join("")}${tail}</tbody>
    </table></div>`;
}
function openLeagueModal(p) {
  if (!DATA) return;
  ensureLeagueModal();
  const spec = leagueSpec(p);
  const shooters = whoTeam(p);
  const zone = shooters && p.area && RINK_ZONES.find((z) => z.key === p.area);
  const sides = spec.sides.map((side) => ({ ...side, rows: leagueSideRows(side) }));
  const n = Math.max(...sides.map((s) => s.rows.length));
  const teamTd = (r, side) => `<td class="nhl-league-team${r.team === side.team ? " nhl-league-cur" : ""}">${logo(r.team, 18)} <span>${team(r.team).name}</span></td>`;
  const blank = (side) => "<td></td>".repeat(side.cols.length + 1);
  const [left, right] = sides;
  const body = [];
  for (let i = 0; i < n; i++) {
    const l = left.rows[i];
    let row = `<td class="nhl-league-rank">${rankWords(i + 1, n, spec.words)}</td>${l ? teamTd(l, left) + l.cells.join("") : blank(left)}`;
    // A second side mirrors the first, so the two sets of numbers meet in the middle.
    if (right) {
      const r = right.rows[i];
      row += `<td class="nhl-league-gap"></td>${r ? r.cells.slice().reverse().join("") + teamTd(r, right) : blank(right)}`;
    }
    body.push(`<tr>${row}</tr>`);
  }
  const heads = (side, mirror) => {
    const cols = side.cols.map((c) => `<th class="num">${c.label}</th>`);
    const name = `<th class="nhl-league-team-h">${logo(side.team, 16)} ${side.head}</th>`;
    return mirror ? cols.reverse().join("") + name : name + cols.join("");
  };
  // A zone with `who`: that team's shooters from here first, then every team.
  const meName = p.me && findPlayer(p.me) ? findPlayer(p.me).row.name : "";
  const who = zone
    ? `<h3>${zone.label}: ${team(shooters).name} shooters</h3>
      <p class="section-note">Who shoots the most from here, a game this season${meName ? `; ${meName} outlined` : ""} (players out injured left off; ${SHOOTER_MIN_GAMES}+ games).</p>
      <div id="nhl-league-who"><p class="no-data-note">Loading&hellip;</p></div>
      <h3 class="nhl-who-next">${spec.title}</h3>`
    : `<h3>${spec.title}</h3>`;
  el("nhl-league-content").innerHTML = `${who}
    <p class="section-note">${spec.note}</p>
    <div class="nhl-league-scroll"><table class="data-table nhl-league-table">
      <thead><tr><th></th>${heads(left)}${right ? `<th></th>${heads(right, true)}` : ""}</tr></thead>
      <tbody>${body.join("")}</tbody>
    </table></div>`;
  const overlay = el("nhl-league-modal");
  document.body.appendChild(overlay); // last in the page, so it opens over the player card
  overlay.hidden = false;
  if (zone) {
    const opened = el("nhl-league-who");
    loadTeamPlayers(shooters).then((file) => {
      if (el("nhl-league-who") === opened) opened.innerHTML = zoneShootersHtml(file, shooters, zone.key, p.me);
    });
  }
}

// ---- the player card ----
// The ONE popup for every skater and goalie on every NHL page. Wrap any name
// or photo with playerClick(id, inner) and it opens the card: Game Log, Shot
// Map and Odds.
const PLAYER_FILES = {}; // team -> promise of its players file (null if it can't be read)
const PLAYER_READY = {}; // team -> its players file once read (null if it can't be)
function loadTeamPlayers(abbr) {
  if (!PLAYER_FILES[abbr]) {
    PLAYER_FILES[abbr] = fetch(`players/${abbr}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((file) => (PLAYER_READY[abbr] = file));
  }
  return PLAYER_FILES[abbr];
}
// A player's REAL numbers this season, counted from his team's file (the same counts as
// the card): never mixed with a league average or anything the model believes (the owner,
// 2026-10-19: "The data is the data - small sample or not"). The models mix in averages
// for their projections; a number shown as HIS comes from here.
//   { shares: { zone: share of his located shots }, located, pp (share of his shots on the
//     power play), att60 (shot attempts per 60 minutes), onGoal (share of attempts on goal) }
// undefined while the file is still loading (`load` reads it and draws the page again once
// it's in), null if he has no season on file.
const SEASON_WAIT = new Set();
function seasonCounts(abbr, id, load = true) {
  if (!(abbr in PLAYER_READY)) {
    if (load && !SEASON_WAIT.has(abbr)) {
      SEASON_WAIT.add(abbr);
      loadTeamPlayers(abbr).then(() => typeof render === "function" && render());
    }
    return undefined;
  }
  const file = PLAYER_READY[abbr];
  const s = file && file.skaters && file.skaters[id] && file.skaters[id].season;
  if (!s) return null;
  const areas = s.areas || {};
  const located = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
  const cols = [...file.log_lead, ...file.skater_cols];
  const sum = (key) => s.log.reduce((a, row) => a + (row[cols.indexOf(key)] || 0), 0);
  const [toi, sog, att] = [sum("toi"), sum("sog"), sum("att")];
  return {
    shares: Object.fromEntries(RINK_ZONES.map((z) => [z.key, located ? ((areas[z.key] || [])[0] || 0) / located : null])),
    located,
    pp: s.unb ? s.pp_unb / s.unb : null,
    att60: toi ? (att / toi) * 3600 : null,
    onGoal: att ? sog / att : null,
  };
}
// { kind: "skater" | "goalie", row } for a player id, from the page's data.
function findPlayer(id) {
  for (const [kind, group] of [["skater", DATA.skaters], ["goalie", DATA.goalies]]) {
    for (const rows of Object.values(group || {})) {
      const row = rows.find((p) => p.id === id);
      if (row) return { kind, row };
    }
  }
  return null;
}
// A link from Best Plays ("shots.html#row=<game id>:<player id>") opens that
// player's row: the Shots and Goals pages pick the game and open the row.
function linkedRow() {
  const m = /^#row=(\d+):(\d+)$/.exec(location.hash);
  const game = m && DATA.schedule.find((g) => g.game_id === m[1]);
  return game ? { game, row: `${m[1]}:${m[2]}` } : null;
}
function scrollToRow(row) {
  const tr = document.querySelector(`.shots-row[data-row="${row}"]`);
  if (tr) tr.scrollIntoView({ block: "center" });
}
function playerClick(id, inner) {
  return id && findPlayer(id) ? `<span class="player-click" data-player="${id}">${inner}</span>` : inner;
}
// The game the card talks about: the one open on the page if this player's
// team is in it, else that team's next game on the schedule.
function playerGame(abbr) {
  const open = typeof currentGame === "function" ? currentGame() : null;
  if (open && [open.away, open.home].includes(abbr)) return open;
  return DATA.schedule.find((g) => g.status !== "final" && [g.away, g.home].includes(abbr)) || null;
}

let playerCardState = null; // { id, tab, file }
const CARD_TABS = [["log", "Game Log"], ["map", "Shot Map"], ["odds", "Odds"]];

// Shade a log cell against the player's own games (same thirds as the NFL card).
function selfTier(v, pool) {
  const vals = pool.filter(has);
  if (!has(v) || vals.length < 2) return ` class="num"`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) return ` class="num"`;
  const q = (v - lo) / (hi - lo);
  if (q >= 0.67) return ` class="num tier-good" style="--tier-a:${(0.1 + 0.22 * ((q - 0.67) / 0.33)).toFixed(2)}"`;
  if (q <= 0.33) return ` class="num tier-bad" style="--tier-a:${(0.1 + 0.22 * ((0.33 - q) / 0.33)).toFixed(2)}"`;
  return ` class="num tier-mid"`;
}
// Goals, assists and points are zero most nights: light up the nights he
// scored instead of painting every zero red.
const scoredTier = (v) => (v > 0 ? ` class="num tier-good" style="--tier-a:${Math.min(0.32, 0.1 + 0.08 * v).toFixed(2)}"` : ` class="num"`);
const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
// A player's season in his team's file, as rows of named fields.
function cardLog(file, kind, id) {
  const group = file && file[kind === "goalie" ? "goalies" : "skaters"];
  const season = group && group[id] && group[id].season;
  if (!season) return { season: null, rows: [] };
  const cols = [...file.log_lead, ...(kind === "goalie" ? file.goalie_cols : file.skater_cols)];
  const rows = season.log.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))).reverse();
  return { season, rows };
}
function resultCell(r) {
  const won = r.gf > r.ga;
  const label = won ? "W" : r.ended === "REG" ? "L" : "OTL";
  return `<td><span class="pick-result pick-result-${won ? "win" : label === "L" ? "loss" : "push"}">${label}</span> ${r.gf}-${r.ga}${r.ended !== "REG" ? ` <span class="muted-label">${r.ended}</span>` : ""}</td>`;
}
function logTable(cols, rows, avgLabel) {
  if (!rows.length) return `<p class="no-data-note">No ${viewLabel()} games on file.</p>`;
  const pools = cols.map((c) => (c.shade ? rows.map((r) => c.get(r)) : null));
  const body = rows
    .map((r) => `<tr><td>${shortDate(r.date)}</td><td>${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}</td>${resultCell(r)}${cols.map((c, i) => `<td${c.scored ? scoredTier(c.get(r)) : c.shade ? selfTier(c.get(r), pools[i]) : ' class="num"'}>${c.show ? c.show(r) : c.get(r)}</td>`).join("")}</tr>`)
    .join("");
  const avg = cols.map((c) => `<td class="num">${c.avg ? c.avg(rows) : ""}</td>`).join("");
  return `<div class="nhl-pc-scroll"><table class="data-table nhl-pc-log">
      <thead><tr><th>Date</th><th>Opp</th><th>Result</th>${cols.map((c) => `<th${c.title ? ` title="${c.title}"` : ""}>${c.label}</th>`).join("")}</tr></thead>
      <tbody><tr class="nhl-pc-avg"><td colspan="3">${avgLabel} (${rows.length} games)</td>${avg}</tr>${body}</tbody>
    </table></div>`;
}
const mean = (rows, get, digits = 1) => fmt(rows.reduce((a, r) => a + get(r), 0) / rows.length, digits);
const total = (rows, get) => rows.reduce((a, r) => a + get(r), 0);
// The line he played on (game_lines in build_nhl.py), as a small tag: the top
// line or pair brightest. -- for a game with no shift chart.
const lineChip = (slot) => (slot ? `<span class="nhl-line-chip nhl-line-${slot.slice(1)}">${slot}</span>` : '<span class="muted-label">--</span>');
function commonLine(rows) {
  const count = {};
  rows.forEach((r) => r.slot && (count[r.slot] = (count[r.slot] || 0) + 1));
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
}
function skaterLogView(rows) {
  const col = (label, key, title) => ({ label, title, get: (r) => r[key], shade: key === "sog" || key === "att", scored: key === "g" || key === "a", avg: (all) => mean(all, (r) => r[key], key === "sog" || key === "att" ? 1 : 2) });
  return logTable(
    [
      {
        label: "Line", title: "The line (L1 to L4) or pair (D1 to D3) he played on that night: who he shared the most ice with, from the league's shift chart. The average row shows his most common one.",
        get: (r) => r.slot, show: (r) => lineChip(r.slot), avg: (all) => lineChip(commonLine(all)),
      },
      { label: "TOI", title: "Ice time", get: (r) => r.toi, show: (r) => minutes(r.toi), shade: true, avg: (all) => minutes(Math.round(total(all, (r) => r.toi) / all.length)) },
      col("G", "g"),
      col("A", "a"),
      { label: "Pts", get: (r) => r.g + r.a, scored: true, avg: (all) => mean(all, (r) => r.g + r.a, 2) },
      col("SOG", "sog", "Shots on goal"),
      col("Att", "att", "Shot attempts: on goal, wide or blocked"),
      { label: "PPP", title: "Power play points", get: (r) => r.ppp, avg: (all) => mean(all, (r) => r.ppp, 2) },
      { label: "Hits", get: (r) => r.hits, avg: (all) => mean(all, (r) => r.hits) },
      { label: "Blk", title: "Blocked shots", get: (r) => r.blk, avg: (all) => mean(all, (r) => r.blk) },
      { label: "+/-", get: (r) => r.pm, show: (r) => (r.pm > 0 ? `+${r.pm}` : r.pm), avg: (all) => signed(total(all, (r) => r.pm), 0) },
      { label: "PIM", title: "Penalty minutes", get: (r) => r.pim, avg: (all) => mean(all, (r) => r.pim) },
    ],
    rows,
    "Per game"
  );
}
function goalieLogView(rows) {
  const sv = (sa, ga) => (sa ? (sa - ga) / sa : null);
  return logTable(
    [
      { label: "Role", get: (r) => r.start, show: (r) => (r.start ? "Start" : "Relief") },
      { label: "Dec", title: "Decision: win, loss or overtime loss", get: (r) => r.dec, show: (r) => (r.dec === "O" ? "OTL" : r.dec || "--") },
      { label: "TOI", get: (r) => r.toi, show: (r) => minutes(r.toi), avg: (all) => minutes(Math.round(total(all, (r) => r.toi) / all.length)) },
      { label: "Shots", title: "Shots on goal against", get: (r) => r.sa, shade: true, avg: (all) => mean(all, (r) => r.sa) },
      { label: "Saves", get: (r) => r.sa - r.ga, shade: true, avg: (all) => mean(all, (r) => r.sa - r.ga) },
      { label: "GA", title: "Goals against", get: (r) => r.ga, avg: (all) => mean(all, (r) => r.ga, 2) },
      { label: "SV%", get: (r) => sv(r.sa, r.ga), show: (r) => svPct(sv(r.sa, r.ga)), shade: true, avg: (all) => svPct(sv(total(all, (r) => r.sa), total(all, (r) => r.ga))) },
      { label: "Low slot", title: "Low-slot shots faced and goals allowed on them", get: (r) => r.hd_sa, show: (r) => `${r.hd_sa - r.hd_ga}/${r.hd_sa}`, avg: (all) => svPct(sv(total(all, (r) => r.hd_sa), total(all, (r) => r.hd_ga))) },
    ],
    rows,
    "Per game"
  );
}

// ---- Shot Map tab ----
// The league's numbers this season: { area: { share, sh_pct } }.
const leagueAreas = () => (DATA.league || {}).season || {};
const SMALL_SAMPLE_GAMES = 10;
const HEAT_MIN_ALPHA = 0.04;
const HEAT_MAX_ALPHA = 0.7;
// What the other team's defense gives up from an area, on the eight rank
// colors from the shooter's side, the same color as that zone on the rink
// beside it: green = allows the most from there, red = the fewest.
const allowsRank = (opp, area) => (opp ? leagueRank(`def_${area}_pg`, opp, false) : null); // 1st = allows the most
const teamCount = () => Object.keys(stats()).length || 32;
function oppAllowsCell(opp, area, me) {
  if (!opp) return "";
  const value = (stats()[opp] || {})[`def_${area}_pg`];
  const rank = allowsRank(opp, area);
  // Like the strip on the rink, the row for shots from outside the zone is never colored: too rare to read.
  // Click it for every team's number from there.
  const words = rank ? rankWords(rank) : "";
  return `<td class="num nhl-rank-cell nhl-league-click"${rank && area !== "long" ? cellOnStep(rankStep(rank, teamCount())) : ""} data-league="${leagueAttr({ area, def: opp, ...(me || {}) })}" title="${opp} allows ${words ? `the ${words.replace(/^the /, "")}` : "?"} shots from here. Click for ${me ? `his team's shooters from here and ` : ""}every team.">${fmt(value)}<small class="nhl-pc-rank">${words ? ` ${words}` : ""}</small></td>`;
}
function skaterMapView(season, games, opp, uid, me) {
  // me ({ who: his team, me: his id }): a zone's list starts with his team's shooters, him outlined.
  const areas = season.areas || {};
  const located = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
  if (!located) return `<p class="no-data-note">No ${viewLabel()} shots on file.</p>`;
  const league = leagueAreas();
  const most = Math.max(...RINK_ZONES.map((z) => (areas[z.key] || [])[0] || 0));
  let expected = 0;
  let scored = 0;
  const rows = AREA_ROWS.map((z) => {
    const [shots = 0, onGoal = 0, goals = 0] = areas[z.key] || [];
    const lg = league[z.key] || {};
    expected += onGoal * (lg.sh_pct || 0);
    scored += goals;
    return `<tr><td>${z.label}</td><td class="num"><b>${fmt(shots / games)}</b></td><td class="num">${pct(shots / located, 0)}</td><td class="num">${onGoal}</td><td class="num">${goals}</td><td class="num">${onGoal ? pct(goals / onGoal) : "--"}</td><td class="num muted-label">${pct(lg.sh_pct)}</td>${oppAllowsCell(opp, z.key, me)}</tr>`;
  }).join("");
  // Every zone is colored by what the other team allows from there (the same
  // chart as the Shots page's "Where he shoots"). With no game to read it
  // against, the zones are shaded by his own shots instead.
  const svg = rinkSvg(uid, "Where he shoots from", (z) => {
    const [shots = 0, , goals = 0] = areas[z.key] || [];
    const rank = z.small ? null : allowsRank(opp, z.key);
    // Squared, so his favorite spot stands out from the places he merely visits.
    const alpha = shots ? HEAT_MIN_ALPHA + (shots / most) ** 2 * (HEAT_MAX_ALPHA - HEAT_MIN_ALPHA) : 0;
    const fill = rank ? zoneOnStep(rankStep(rank, teamCount())) : shots && !z.small && !opp ? { cls: "nhl-zone-heat", style: `--heat:${alpha.toFixed(2)}` } : {};
    return {
      ...fill,
      big: fmt(shots / games),
      small: z.small ? "" : `${pct(shots / located, 0)} &middot; ${goals} G`,
      tip: `${z.label}: ${shots} shots in ${games} games, ${goals} goals${rank ? `. ${opp} allows ${fmt((stats()[opp] || {})[`def_${z.key}_pg`])} a game from here, ${rankWords(rank)}` : ""}`,
      league: opp && !z.small ? leagueAttr({ area: z.key, def: opp, ...(me || {}) }) : "",
      click: me ? "Click for his team's shooters from here and every team." : "",
    };
  });
  const colorNote = opp
    ? `The color is what ${opp} allows from that spot: ${rankScaleKey("the most", "the fewest")}`
    : "Brighter green = more of his shots.";
  const types = Object.entries(season.types || {})
    .sort((a, b) => b[1][0] - a[1][0])
    .map(([name, [shots, goals]]) => `<span class="nhl-pc-chip"><b>${name[0].toUpperCase()}${name.slice(1)}</b> ${pct(shots / located, 0)}<small>${goals} G</small></span>`)
    .join("");
  return `<div class="nhl-pc-map">
      <div class="nhl-pc-rink">${svg}<p class="section-note">Shots per game from each area (on goal or wide). Below each: share of his shots and goals from there. ${colorNote}</p></div>
      <div class="nhl-pc-side">
        <div class="nhl-pc-scroll"><table class="data-table nhl-pc-areas">
          <thead><tr><th>Area</th><th title="Shots per game, on goal or wide">Shots / g</th><th title="Share of his shots">Share</th><th>On goal</th><th>Goals</th><th title="Goals per shot on goal from here">Sh%</th><th title="The league's shooting % from here">Lg Sh%</th>${opp ? `<th title="Shots per game ${opp} allows from here, and where that ranks">${opp} allows</th>` : ""}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="nhl-pc-facts">
          <span class="nhl-pc-chip" title="What a league-average shooter would score on the same shots on goal from the same areas"><b>From these spots</b> ${fmt(expected)} goals expected<small>he scored ${scored}</small></span>
          <span class="nhl-pc-chip"><b>Power play</b> ${pct(season.unb ? season.pp_unb / season.unb : null, 0)} of his shots</span>
        </div>
        <div class="nhl-pc-facts">${types}</div>
      </div>
    </div>`;
}
// A goalie's zones are colored only when the gap from the league's save rate
// there is bigger than luck alone would explain on that many shots: at least
// GOALIE_AREA_MIN_SHOTS faced, and goals allowed GOALIE_AREA_Z standard
// deviations away from what the league gives up on them. Returns
// "tier-good" (fewer goals than expected), "tier-bad" or "".
const GOALIE_AREA_Z = 1.5;
const GOALIE_AREA_MIN_SHOTS = 30;
function goalieAreaTier(shots, goals, leagueShPct) {
  const spread = Math.sqrt(shots * leagueShPct * (1 - leagueShPct));
  if (shots < GOALIE_AREA_MIN_SHOTS || !spread) return "";
  const z = (shots * leagueShPct - goals) / spread;
  return z >= GOALIE_AREA_Z ? "tier-good" : z <= -GOALIE_AREA_Z ? "tier-bad" : "";
}
function goalieMapView(season, games, uid) {
  const areas = season.areas || {};
  const faced = RINK_ZONES.reduce((a, z) => a + ((areas[z.key] || [])[0] || 0), 0);
  if (!faced) return `<p class="no-data-note">No ${viewLabel()} shots on file.</p>`;
  const league = leagueAreas();
  let expectedAll = 0;
  let allowedAll = 0;
  const read = (z) => {
    const [shots = 0, goals = 0] = areas[z.key] || [];
    const p = (league[z.key] || {}).sh_pct || 0;
    return { shots, goals, p, expected: shots * p, tier: goalieAreaTier(shots, goals, p) };
  };
  const rows = AREA_ROWS.map((z) => {
    const a = read(z);
    expectedAll += a.expected;
    allowedAll += a.goals;
    return `<tr><td>${z.label}</td><td class="num"><b>${fmt(a.shots / games)}</b></td><td class="num">${pct(a.shots / faced, 0)}</td><td class="num">${a.goals}</td><td class="num ${a.tier}"><b>${a.shots ? svPct(1 - a.goals / a.shots) : "--"}</b></td><td class="num muted-label">${svPct(1 - a.p)}</td><td class="num">${signed(a.expected - a.goals)}</td></tr>`;
  }).join("");
  const svg = rinkSvg(uid, "Where the shots he faces come from", (z) => {
    const a = read(z);
    return {
      cls: z.small || !a.tier ? "" : a.tier === "tier-good" ? "nhl-zone-more" : "nhl-zone-fewer",
      big: a.shots ? svPct(1 - a.goals / a.shots) : "--",
      small: z.small ? "" : `${a.shots} shots &middot; ${a.goals} GA`,
      tip: `${z.label}: ${a.shots} shots on goal, ${a.goals} goals; the league saves ${svPct(1 - a.p)} from here`,
    };
  });
  return `<div class="nhl-pc-map">
      <div class="nhl-pc-rink">${svg}<p class="section-note">Save % on shots from each area. Green or red only where the gap from the league is more than luck would explain on that many shots.</p></div>
      <div class="nhl-pc-side">
        <div class="nhl-pc-scroll"><table class="data-table nhl-pc-areas">
          <thead><tr><th>Area</th><th title="Shots on goal faced per game">Shots / g</th><th title="Share of the shots he faces">Share</th><th title="Goals against">GA</th><th>SV%</th><th title="The league's save % from here">Lg SV%</th><th title="Goals saved against what a league-average goalie allows on the same shots (+ is good)">Saved vs avg</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="nhl-pc-facts"><span class="nhl-pc-chip" title="What a league-average goalie would allow on the same shots from the same areas"><b>From these spots</b> ${fmt(expectedAll)} goals expected<small>he allowed ${allowedAll}</small></span></div>
      </div>
    </div>`;
}

// ---- Odds tab ----
// Each side: the best price across the member's books (SmartStake; click for
// every book) or Novig's when no book lists it, and a box that saves the play
// to My Plays at that price (the owner, 2026-10-21: checkboxes like the NFL card).
// market: the saved play's market (nhlPlayEntry); stat: book_odds' key.
const ODDS_MARKETS = [
  ["sog", "Shots on goal", "sog", "sog"],
  ["points", "Points", "pts", "points"],
  ["assists", "Assists", "ast", null],
  ["saves", "Saves", "saves", "saves"],
];
function oddsSide(row, game, market, stat, side, line, novig) {
  const spec = stat && typeof bookPricePill === "function"
    ? { kind: "prop", stat, team: row.team, pid: row.id, game: `${game.away}_${game.home}`, side: side === "under" ? "u" : "o", line, title: `${row.name} &middot; ${NHL_PLAY_CATEGORY[market]}`, sub: `${game.away} @ ${game.home}` }
    : null;
  const best = spec ? bookBest(bookQuotes(spec), spec.side, line) : null;
  const pill = best ? bookPricePill(spec) : "";
  const price = best ? best[3] : novig;
  if (!has(price)) return "--";
  const box = market ? nhlPlayBox(nhlPlayEntry({ market, g: game, r: row, side, line, price, book: best ? best[0] : "novig" })) : "";
  return `${pill || `<b>${odds(price)}</b>`}${box}`;
}
function oddsView(id, game) {
  const o = game ? ((DATA.player_odds || {})[game.game_id] || {})[id] : null;
  if (!o) return `<p class="no-data-note">No lines posted for this player${game ? "" : " (no game on the schedule)"}.</p>`;
  const row = findPlayer(id).row;
  const chance = (c) => (has(c) ? `${Math.round(c * 100)}%` : "--");
  const thin = (m) => (m.thin ? ` <span class="nhl-pc-thin" title="Barely traded: treat the price with care">thin</span>` : "");
  const rows = [];
  if (o.goal) rows.push(`<tr><td>Anytime goal${thin(o.goal)}</td><td class="num props-line">--</td><td class="num">${oddsSide(row, game, "goal", "goals", "over", 0.5, o.goal.odds)}</td><td class="num">${odds(o.goal.no_odds) || "--"}</td><td class="num">${chance(o.goal.chance)}</td></tr>`);
  if (o.first_goal) rows.push(`<tr><td>First goal${thin(o.first_goal)}</td><td class="num props-line">--</td><td class="num"><b>${odds(o.first_goal.odds)}</b></td><td class="num">--</td><td class="num">${chance(o.first_goal.chance)}</td></tr>`);
  ODDS_MARKETS.forEach(([key, label, market, stat]) => {
    const m = o[key];
    if (m) rows.push(`<tr><td>${label}${thin(m)}</td><td class="num props-line">${fmt(m.line)}</td><td class="num">${oddsSide(row, game, market, stat, "over", m.line, m.over)}</td><td class="num">${oddsSide(row, game, market, stat, "under", m.line, m.under)}</td><td class="num">${chance(m.chance)}</td></tr>`);
  });
  // The other lines the book prices, as "N or more" (over 2.5 = 3+).
  const ladder = (label, alts) =>
    (alts || []).length ? `<div class="nhl-pc-facts"><span class="nhl-pc-ladder">${label}</span>${alts.map(([strike, price]) => `<span class="nhl-pc-chip"><b>${Math.ceil(strike)}+</b> ${odds(price)}</span>`).join("")}</div>` : "";
  if (!rows.length && !o.sog_alts && !o.goal_alts && !o.saves_alts) return `<p class="no-data-note">No lines posted for this player.</p>`;
  return `<p class="no-data-note">Best price across your books (click it for every book; plain = Novig's). Checkboxes save a side to My Plays.</p>
    <div class="nhl-pc-scroll"><table class="data-table player-odds-table nhl-pc-odds">
      <thead><tr><th>Market</th><th class="num">Line</th><th class="num">Over / Yes</th><th class="num">Under / No</th><th class="num" title="Novig's price with the cut taken out">Chance</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    ${ladder("Shots on goal", o.sog_alts)}${ladder("Goals", o.goal_alts)}${ladder("Saves", o.saves_alts)}
    <p class="section-note">Lines from Novig, ${game.away} @ ${game.home}${game.lines_locked ? ", locked at puck drop" : ""}.</p>`;
}

function ensurePlayerCard() {
  if (el("player-card-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "player-card-modal";
  overlay.className = "modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="modal-box pc-box"><button type="button" class="modal-close" aria-label="Close">&times;</button><div id="player-card-content"></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePlayerCard();
  });
  overlay.querySelector(".modal-close").addEventListener("click", closePlayerCard);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlayerCard();
  });
}
function closePlayerCard() {
  if (el("player-card-modal")) el("player-card-modal").hidden = true;
  playerCardState = null;
}
function renderPlayerCard() {
  const { id, tab, file } = playerCardState;
  const found = findPlayer(id);
  if (!found) return `<p class="no-data-note">Player not found.</p>`;
  const { kind, row } = found;
  const s = row;
  const game = playerGame(row.team);
  const opp = game ? (game.away === row.team ? game.home : game.away) : null;
  const rgb = teamRgb(row.team);
  const facts = [kind === "goalie" ? "G" : row.pos, row.shoots ? `Shoots ${row.shoots}` : "", `${logo(row.team, 16)} ${team(row.team).name}`, opp ? `${game.away === row.team ? "@" : "vs"} ${logo(opp, 16)} ${opp} ${shortDate(game.date)}` : ""].filter(Boolean);
  const head = `<div class="pc-head" style="background:rgba(${rgb},0.22);border-left:4px solid rgb(${rgb})">
      ${headshot(row, "nhl-pc-photo")}
      <div class="pc-id"><div class="pc-name">${row.name}</div><div class="pc-sub">${facts.join(" &middot; ")}</div></div>
    </div>`;
  const tile = (label, value) => `<div class="nba-tile"><div class="gs-tile-label">${label}</div><b>${value}</b></div>`;
  const tiles = !s
    ? `<p class="no-data-note">No ${viewLabel()} games.</p>`
    : kind === "goalie"
      ? `<div class="nba-tiles nhl-pc-tiles">${tile("Games", s.games)}${tile("Starts", s.starts)}${tile("Record", s.record)}${tile("SV%", svPct(s.sv_pct))}${tile("GAA", fmt(s.gaa, 2))}${tile("Shots / start", fmt(s.sa_pg))}${tile("Low slot SV%", svPct(s.hd_sv_pct))}</div>`
      : `<div class="nba-tiles nhl-pc-tiles">${tile("Games", s.games)}${tile("TOI", fmt(s.toi))}${tile("Goals", s.g)}${tile("Assists", s.a)}${tile("Points", s.p)}${tile("SOG / game", fmt(s.sog_pg))}${tile("PP TOI", fmt(s.pp_toi))}</div>`;
  const tabs = CARD_TABS.map(([key, label]) => `<button type="button" class="player-modal-toggle-btn nhl-pc-tab${tab === key ? " active" : ""}" data-tab="${key}">${label}</button>`).join("");
  let body;
  if (tab === "odds") body = oddsView(id, game);
  else if (file === undefined) body = `<p class="no-data-note">Loading&hellip;</p>`;
  else {
    const { season, rows } = cardLog(file, kind, id);
    const small = rows.length && rows.length < SMALL_SAMPLE_GAMES ? `<p class="no-data-note">Small sample: ${rows.length} game${rows.length === 1 ? "" : "s"} this season.</p>` : "";
    if (!season) body = `<p class="no-data-note">No ${viewLabel()} games on file.</p>`;
    else if (tab === "map") body = small + (kind === "goalie" ? goalieMapView(season, rows.length, "nhl-pc-rink-clip") : skaterMapView(season, rows.length, opp, "nhl-pc-rink-clip", { who: row.team, me: id }));
    else body = small + (kind === "goalie" ? goalieLogView(rows) : skaterLogView(rows));
  }
  return `${head}${tiles}
    <div class="player-modal-toggle nhl-pc-tabs">${tabs}</div>
    <div id="player-modal-body">${body}</div>`;
}
function refreshPlayerCard() {
  if (playerCardState) el("player-card-content").innerHTML = renderPlayerCard();
}
function openPlayerCard(id, tab = "log") {
  const found = DATA && findPlayer(id);
  if (!found) return;
  ensurePlayerCard();
  playerCardState = { id, tab, file: undefined };
  refreshPlayerCard();
  el("player-card-modal").hidden = false;
  loadTeamPlayers(found.row.team).then((file) => {
    if (playerCardState && playerCardState.id === id) {
      playerCardState.file = file;
      refreshPlayerCard();
    }
  });
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest("#player-card-modal .nhl-pc-tab");
  if (tab && playerCardState) {
    playerCardState.tab = tab.dataset.tab;
    return refreshPlayerCard();
  }
  const league = e.target.closest("[data-league]");
  if (league) return openLeagueModal(JSON.parse(decodeURIComponent(league.dataset.league)));
  const name = e.target.closest(".player-click[data-player]");
  if (name) {
    if (name.closest("#nhl-league-modal")) closeLeagueModal(); // a shooter's name: the card takes over
    return openPlayerCard(name.dataset.player);
  }
  if (e.target.closest("#theme-toggle")) {
    const light = !isLight();
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
    if (DATA && typeof render === "function") render(); // the logos have a light and a dark version
    refreshPlayerCard();
  }
});

// Every NHL page starts here: read data.json, then draw.
function loadNhlData() {
  return fetch("data.json")
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      return data;
    });
}

// ---- The Edge menu: Shots, Goals, Points and Best Plays filter the same way ----
// "all", or a minimum edge in points; an edge counts as the table rounds it (9.96 = 10.0).
const EDGE_STEPS = [3, 5, 7, 10, 15];
const edgeOptions = () => [["all", "Any edge"], ...EDGE_STEPS.map((v) => [String(v), `${v}+ points`])];
const edgeAtLeast = (edge, min) => min === "all" || (has(edge) && Math.round(edge * 1000) / 10 >= Number(min));

// ---- Every book's price (SmartStake; ../book-odds.js) ----
// The Shots, Goals and Points open rows' right column: every US book's price for this
// player, best first, each tagged against OUR model (never a market "fair"
// price): chanceAt(side, line) is the model's chance, and the tags use the
// page's own edge sizes. "" when no book has him.
function bookPanelFor(x, stat, line, label, chanceAt, edges, labels) {
  if (typeof bookOddsPanel !== "function") return "";
  const r = x.r;
  const g = x.game;
  const spec = {
    // Opens on the side the row's play is on (an Under play shows the unders).
    kind: "prop", stat, team: r.team, pid: r.id, name: r.name, side: (x.play ? x.play.side : r.side) === "under" ? "u" : "o", line,
    game: `${g.away}_${g.home}`, title: `${r.name} &middot; ${label}`, sub: `${g.away} @ ${g.home}`, color: `#${team(r.team).color}`,
    edges, ...(labels ? { labels, labelLine: line } : {}),
  };
  const model = {};
  bookQuotes(spec).forEach((q) => {
    const chance = chanceAt(q[1], q[2]);
    if (has(chance)) model[`${q[1]}|${q[2]}`] = chance;
  });
  [["o", line], ["u", line]].forEach(([side, at]) => {
    const chance = has(at) ? chanceAt(side, at) : null;
    if (has(chance)) model[`${side}|${at}`] = chance;
  });
  const panel = bookOddsPanel({ ...spec, model });
  return panel ? `<div class="shots-detail-odds"><div class="shots-detail-label">Every book <span class="muted-label">best price first, against our model</span></div>${panel}</div>` : "";
}

// ---- Player search (the owner, 2026-10-16: "if i start typing in GEE it will only show names of players with that") ----
// A box in the Player header of every prop table (Shots, Goals, Points, Saves, Best Plays).
// Case and accents don't matter. One search for
// the page; the page's renderTable redraws and the box keeps its cursor.
let NAME_SEARCH = "";
const searchText = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const nameSearching = () => !!searchText(NAME_SEARCH);
const nameMatches = (...names) => !nameSearching() || names.some((n) => searchText(n).includes(searchText(NAME_SEARCH)));
const nameSearchBox = () =>
  `<input type="search" class="nhl-name-search" placeholder="Search players" aria-label="Search players" autocomplete="off" value="${String(NAME_SEARCH).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
const nameSearchMiss = (columns) => `<tr><td colspan="${columns}" class="no-data-note nhl-name-miss">No players match "${String(NAME_SEARCH).replace(/</g, "&lt;")}" with these filters.</td></tr>`;
document.addEventListener("input", (e) => {
  if (!e.target.classList || !e.target.classList.contains("nhl-name-search")) return;
  NAME_SEARCH = e.target.value;
  const at = e.target.selectionStart;
  if (typeof renderTable === "function") renderTable();
  const box = document.querySelector(".nhl-name-search");
  if (box && box !== e.target) {
    box.focus();
    box.setSelectionRange(at, at);
  }
});

// ---- Save to My Plays (../my-plays.html; the owner, 2026-10-20) ----
// A small box beside every priced play (Shots, Goals, Points, Saves, Best
// Plays). Checking it saves the play as shown, at its price, to
// the member's NHL plays (sync.js loadNhlPlays / saveNhlPlays); My Plays
// grades it from the box score. One saved play per player, market and game,
// so the box stays checked when the line moves.
const NHL_PLAY_CATEGORY = { sog: "Shots on goal", goal: "Anytime goal", pts: "Points", ast: "Assists", saves: "Saves", stack: "Line stack" };
const NHL_PLAY_UNIT = { sog: "SOG", pts: "points", ast: "assists", saves: "saves" };
const nhlPlayId = (market, gameId, who) => `nhl:${market}:${gameId}:${who}`;
// g: the schedule game; r: the player row ({id, name, team}); side "over" / "under"
// (Goals: none); legs: a stack's players [{id, name, team}].
function nhlPlayEntry({ market, g, r, side, line, price, legs, book }) {
  const sideWord = side === "under" ? "Under" : "Over";
  const description = market === "goal" ? `${r.name} anytime goal`
    : market === "stack" ? `${legs.map((p) => p.name.split(" ").slice(1).join(" ") || p.name).join(" + ")} (1+ point each)`
    : `${r.name} ${sideWord} ${line} ${NHL_PLAY_UNIT[market]}`;
  return {
    id: nhlPlayId(market, g.game_id, market === "stack" ? legs.map((p) => p.id).sort().join("-") : r.id),
    sport: "nhl", market, category: NHL_PLAY_CATEGORY[market],
    date: g.date, game_id: g.game_id, matchup: `${g.away} @ ${g.home}`,
    team: market === "stack" ? legs[0].team : r.team, player_id: market === "stack" ? null : r.id,
    side: market === "goal" || market === "stack" ? null : side, line: has(line) ? line : null,
    odds: has(price) ? price : null, description, legs: legs || null,
    ...(book ? { book } : {}),
  };
}
function nhlPlayBox(entry) {
  const saved = loadNhlPlays().some((p) => p.id === entry.id);
  return `<label class="nhl-save-box" title="Save to My Plays"><input type="checkbox" class="nhl-play-toggle" data-entry="${encodeURIComponent(JSON.stringify(entry))}"${saved ? " checked" : ""}></label>`;
}
// Capture: the box sits inside rows that open on a click.
document.addEventListener("click", (e) => {
  if (e.target.closest(".nhl-save-box")) e.stopPropagation();
}, true);
document.addEventListener("change", (e) => {
  const box = e.target.closest(".nhl-play-toggle");
  if (!box) return;
  const entry = JSON.parse(decodeURIComponent(box.dataset.entry));
  const rest = loadNhlPlays().filter((p) => p.id !== entry.id);
  saveNhlPlays(box.checked ? [...rest, { ...entry, added_at: new Date().toISOString() }] : rest);
});
