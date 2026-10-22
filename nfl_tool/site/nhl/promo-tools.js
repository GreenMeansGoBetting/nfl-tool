// ---- GMG NHL Suite: Promo Tools (King of the Crease; Icebreaker is icebreaker.js) ----
// DraftKings' promo pays everyone whose goalie makes the MOST SAVES OF THE
// DAY. This page lists every team's starter for the day with what decides
// saves (how much the other team shoots, how many shots his own team gives
// up), the model's projection (nfl_tool/nhl/saves_model.py, written to
// crease.json by the build), Novig's saves line, and two reads on the promo
// itself: Upside (his chance to lead the day) and Value (that chance against
// what his line alone says). The NFL twin is King of the Endzone
// (../promo-tools.js); the table reuses its look (.koe-*).
// No saves math lives here: the build sends every number and both tags, and
// the page only sorts, colors and draws them. This season only, like every
// NHL prop tool. The data, helpers and the player card are in nhl-common.js.

let CREASE = null;
let dayIndex = 0;
// Which promo is open: King of the Crease, or Icebreaker (icebreaker.js).
// The address keeps it (#icebreaker), so the Promo Tools menu can link to either.
let promoView = location.hash === "#icebreaker" ? "icebreaker" : "crease";
const creaseView = { sort: "top", dir: -1 };

// ESPN's logos, not the NHL's own: the saved image can only carry pictures
// from a host that allows it, and ESPN's does (the NFL pages' logos come from
// the same place for the same reason). ESPN's codes are the NHL's in lower
// case but for these.
const ESPN_CODES = { LAK: "la", NJD: "nj", SJS: "sj", TBL: "tb", UTA: "utah" };
function shareLogo(abbr, size = 22) {
  const code = ESPN_CODES[abbr] || abbr.toLowerCase();
  const src = `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/${isLight() ? "500" : "500-dark"}/${code}.png&h=${size * 3}&w=${size * 3}`;
  return `<img src="${src}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px">`;
}

const rule = (key) => ((CREASE || {}).rules || { value: 1.15, check: 4, big_night: 35 })[key];
const whole = (n) => (has(n) ? `${Math.round(n * 100)}%` : "--");
const chanceText = (n) => (has(n) ? `${(n * 100).toFixed(n < 0.0995 ? 1 : 0)}%` : "--");
const times = (n) => (has(n) ? n.toFixed(2) : "--");

// ---- schedule ----
function days() {
  return [...new Set(DATA.schedule.map((g) => g.date))].sort();
}
function gamesOn(date) {
  return DATA.schedule.filter((g) => g.date === date);
}
const dayBoard = (date) => ((CREASE || {}).days || {})[date] || null;
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// ---- the columns ----
// `rank` = a league rank to color by (1 = the most shots = green);
// `slate` = colored against the day's other goalies instead.
const COLS = [
  { key: "line", label: "Line", group: "Novig", slate: true, wide: true, fmt: (r) => (has(r.line) ? fmt(r.line) : ""), title: "His main saves line on Novig, colored against the day's other lines. DraftKings' own line can sit half a save either side, and the promo's bet has to be +100 or longer: when the over is priced below that, bet the next line up." },
  { key: "saves_avg", label: "Sv/GS", group: "His season", slate: true, fmt: (r) => (has(r.saves_avg) ? fmt(r.saves_avg) : ""), title: "Saves a start this season" },
  { key: "sv_pct", label: "SV%", group: "His season", fmt: (r) => (has(r.sv_pct) ? svPct(r.sv_pct) : ""), title: "Save % this season" },
  { key: "high", label: "High", group: "His season", fmt: (r) => r.high || "", title: "His most saves in a start this season" },
  { key: "opp_shots", label: "Opp shots", group: "Matchup", rank: "opp_shots_rank", fmt: (r) => (has(r.opp_shots) ? fmt(r.opp_shots) : ""), title: "Shots on goal a game by the team he faces, colored by its league rank" },
  { key: "allowed", label: "Allowed", group: "Matchup", rank: "allowed_rank", fmt: (r) => (has(r.allowed) ? fmt(r.allowed) : ""), title: "Shots on goal a game his own team gives up, colored by its league rank" },
  { key: "shots", label: "Shots", group: "Tonight", slate: true, fmt: (r) => fmt(r.shots), title: "Shots on goal the model expects him to face" },
  { key: "mean", label: "Saves", group: "Tonight", slate: true, fmt: (r) => fmt(r.mean), title: "Saves the model expects (its own number, before the line is counted)" },
  { key: "big", label: "", group: "Tonight", fmt: (r) => whole(r.big), title: "" },
];
const GROUP_CLASS = { Novig: "td", "His season": "role", Matchup: "def", Tonight: "big" };

// ---- one day's rows ----
function rowsFor(date) {
  const board = dayBoard(date);
  return board ? board.goalies.map((r) => ({ ...r, game: DATA.schedule.find((g) => g.game_id === r.game_id) || null })) : [];
}
function sortedRows(date) {
  const { sort, dir } = creaseView;
  const get = sort === "name" ? (r) => r.name || "" : sort === "result" ? (r) => r.actual : (r) => r[sort];
  const rows = rowsFor(date).sort((a, b) => {
    const [va, vb] = [get(a), get(b)];
    // A goalie with nothing to sort on (no line yet) sinks, whichever way the sort runs.
    if (!has(va) || !has(vb) || va === "" || vb === "") return has(va) && va !== "" ? -1 : has(vb) && vb !== "" ? 1 : (b.top || 0) - (a.top || 0);
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir || (b.top || 0) - (a.top || 0);
  });
  return rows;
}
// Where a value stands among the day's goalies, as a step on the eight colors.
function slateStep(value, pool) {
  const higher = pool.filter((v) => v > value).length;
  return rankStep(higher + 1, pool.length);
}

// ---- drawing ----
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? longDate(date) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  const board = dayBoard(date);
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const rows = board ? board.goalies.filter((r) => r.game_id === g.game_id) : [];
      const agreed = rows.filter((r) => r.source === "both").length;
      const status = !rows.length || final
        ? ""
        : agreed === 2
          ? `<span class="shots-card-lineup shots-card-lineup-in" title="For both teams, the NHL's projected lineup and the betting market name the same starter. Still not official until warmups.">&#10003; Goalies agree</span>`
          : `<span class="shots-card-lineup" title="At least one starter here rests on a single source, or the sources disagree">Goalies expected</span>`;
      return `<div class="matchup-card crease-game${final ? " matchup-card-final" : ""}${rows.length ? "" : " shots-card-empty"}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
        ${status}
      </div>`;
    })
    .join("");
}
function tagChips(r) {
  // Only Value gets a chip: the Upside column already shows who the day's best chances are.
  return ((r.tags || []).includes("value") ? `<span class="crease-tag crease-tag-value" title="His chance to lead the day is at least ${times(rule("value"))} times what his line alone says">Value</span>` : "");
}
function goalieCell(r) {
  const name = r.name ? `<span class="koe-name">${r.name}</span>` : `<span class="koe-name muted-label">Starter TBD</span>`;
  // Nothing here is a confirmation: starters are official at warmups. The check
  // mark means two sources agree; a split is shown, never smoothed over.
  const sure = r.source === "both"
    ? `<span class="crease-sure" title="The NHL's projected lineup and the betting market both have him starting. Not official until warmups.">&#10003;</span>`
    : r.source === "split"
      ? `<span class="crease-split" title="The sources disagree: the NHL's projected lineup has ${r.other}, the book has a saves line for ${r.name}. The book's goalie is shown. Check before you bet.">&#9888; or ${r.other}</span>`
      : r.doubt
        ? `<span class="crease-split" title="Only the NHL's projected lineup names him, and he started last night. When it has named the same goalie on back-to-back nights it has been right about half the time.">&#9888;</span>`
        : "";
  const why = { lineup: "Expected: named by the NHL's projected lineup only (right about 92% of the time last season). No saves line is posted for him yet.", market: "Expected: the goalie Novig has a saves line for. The NHL's projected lineup isn't in yet.", usual: "Expected: the team's usual starter (the other goalie on the second night of a back-to-back). Neither the NHL's projected lineup nor a saves line is in yet." }[r.source] || "";
  return `<td class="koe-player crease-goalie"${why ? ` title="${why}"` : ""}><span class="koe-who">${shareLogo(r.team, 22)}${playerClick(r.id, name)}${sure}${tagChips(r)}<span class="koe-meta">${r.home ? "vs" : "@"} ${shareLogo(r.opp, 18)}</span></span></td>`;
}
function statCell(col, r, pools) {
  const text = col.fmt(r);
  if (text === "" || text === "--") return `<td class="num"></td>`;
  let style = "";
  let tip = "";
  if (col.rank && has(r[col.rank])) {
    style = cellOnStep(rankStep(r[col.rank], Object.keys(DATA.teams).length || 32));
    tip = col.key === "opp_shots" ? `${r.opp} takes the ${ordinal(r[col.rank])} most shots on goal a game` : `${r.team} allows the ${ordinal(r[col.rank])} most shots on goal a game`;
  } else if (col.slate) {
    style = cellOnStep(slateStep(r[col.key], pools[col.key]));
    if (col.key === "saves_avg") tip = `${r.saves_avg} saves a start in ${r.starts} start${r.starts === 1 ? "" : "s"}, colored against the day's other goalies`;
    if (col.key === "mean") tip = projectionTip(r);
  }
  return `<td class="num${style ? " nhl-rank-cell" : ""}"${style}${tip ? ` title="${tip}"` : ""}>${text}</td>`;
}
function projectionTip(r) {
  const piece = (label, lift) => `${label} ${lift >= 1 ? "+" : ""}${Math.round((lift - 1) * 100)}%`;
  const rest = r.lift.b2b * r.lift.opp_b2b;
  return `Against a league-average start (${fmt(CREASE.league.saves)} saves): ${piece(`${r.opp} shooting`, r.lift.off)}, ${piece(`${r.team} shots allowed`, r.lift.def)}, ${piece(r.home ? "home" : "road", r.lift.home)}${rest !== 1 ? `, ${piece(r.b2b ? `${r.team} played yesterday` : `${r.opp} played yesterday`, rest)}` : ""}, ${piece("his save rate", r.lift.sv)}`;
}
function upsideCell(r, pool) {
  if (!has(r.top)) return `<td class="num"></td>`;
  const place = pool.filter((v) => v > r.top).length;
  const hue = pool.length > 1 ? Math.round(120 * (1 - place / (pool.length - 1))) : 120;
  const from = has(r.line) ? `From his line (${fmt(r.mkt_mean)} saves expected) moved ${Math.round(r.weight * 100)}% of the way to the model's ${fmt(r.mean)}.` : `No line posted yet: from the model's ${fmt(r.mean)} saves alone.`;
  return `<td class="num"><span class="koe-upside crease-pill" style="background:${scaleHsla(hue, 70, 45, 0.22)};border-color:${scaleHsla(hue, 70, 45, 0.6)}" title="His chance to finish with the day's most saves, ties included. ${from}">${chanceText(r.top)}</span></td>`;
}
function valueCell(r) {
  if (!has(r.value)) return `<td class="num" title="No saves line posted for him yet"></td>`;
  const tagged = (r.tags || []).includes("value");
  const cls = r.check ? "crease-pill-check" : tagged ? "crease-pill-good" : r.value <= 1 / rule("value") ? "crease-pill-low" : "crease-pill-flat";
  const base = `His chance to lead the day (${chanceText(r.top)}) against what it would be if he were exactly what his line says (${chanceText(r.mkt_top)}).`;
  const note = r.check ? ` The model (${fmt(r.mean)}) and the line (${fmt(r.mkt_mean)}) are ${fmt(Math.abs(r.mean - r.mkt_mean))} saves apart: check for news before reading anything into it.` : "";
  return `<td class="num"><span class="koe-upside crease-pill ${cls}" title="${base}${note}">${times(r.value)}</span></td>`;
}
function resultCell(r) {
  if (!has(r.actual)) return `<td class="num muted-label" title="${r.locked ? "Started: his numbers are the last ones from before puck drop" : ""}">${r.locked ? "Live" : ""}</td>`;
  const other = r.started && r.name && r.started !== r.name ? ` (${r.started} started)` : "";
  return `<td class="num${r.led ? " tier-good" : ""}" title="${r.led ? "Led the day in saves" : "Saves"}${other}"><b>${r.actual}</b>${r.led ? ` <span class="crease-crown">&#9733;</span>` : ""}</td>`;
}

function renderTable() {
  const date = days()[dayIndex];
  const all = rowsFor(date);
  const rows = sortedRows(date);
  const box = el("crease-table");
  el("crease-key").hidden = !rows.length;
  if (!rows.length) {
    box.innerHTML = `<p class="no-data-note">No board for this day${gamesOn(date).length ? " yet. It is made for games in the next two days" : ": no games"}.</p>`;
    el("crease-count").textContent = "";
    return;
  }
  const showResult = all.some((r) => has(r.actual) || r.locked);
  const pools = Object.fromEntries(COLS.filter((c) => c.slate).map((c) => [c.key, all.map((r) => r[c.key]).filter(has)]));
  const tops = all.map((r) => r.top).filter(has);
  const groups = [];
  COLS.forEach((c) => (groups.length && groups[groups.length - 1].name === c.group ? groups[groups.length - 1].cols.push(c) : groups.push({ name: c.group, cols: [c] })));
  const gcls = (name) => `koe-g-${GROUP_CLASS[name]}`;
  const sortCls = (k) => (creaseView.sort === k ? ` koe-sorted${creaseView.dir > 0 ? " koe-asc" : ""}` : "");
  const gap = (tag) => `<${tag} class="koe-gap"></${tag}>`;
  const label = (c) => (c.key === "big" ? `${rule("big_night")}+` : c.label);
  const tip = (c) => (c.key === "big" ? `His chance of ${rule("big_night")} or more saves. The day's best averaged 37 in a replay of the last two seasons.` : c.title);
  const upTitle = "His chance to finish with the day's most saves, ties included: from his line, moved toward the model by as much as the season so far has earned";
  const valTitle = `Upside against what it would be if he were exactly what his line says. ${times(rule("value"))} or more gets the Value tag; amber = the model and the line are ${rule("check")}+ saves apart, so check for news first`;
  const colgroup = `<colgroup><col class="crease-c-goalie">${groups.map((g) => `<col class="koe-c-gap">${g.cols.map((c) => `<col class="${c.wide ? "crease-c-line" : "crease-c-stat"}">`).join("")}`).join("")}<col class="koe-c-gap"><col class="crease-c-pill"><col class="koe-c-gap"><col class="crease-c-pill">${showResult ? `<col class="koe-c-gap"><col class="crease-c-stat">` : ""}</colgroup>`;
  const head = `<tr class="koe-group-row"><th></th>${groups.map((g) => `${gap("th")}<th colspan="${g.cols.length}" class="koe-group ${gcls(g.name)}"><span>${g.name}</span></th>`).join("")}${gap("th")}<th class="koe-group koe-g-up"><span>Upside</span></th>${gap("th")}<th class="koe-group crease-g-value"><span>Value</span></th>${showResult ? `${gap("th")}<th class="koe-group koe-g-dist"><span>Result</span></th>` : ""}</tr>
    <tr class="koe-label-row"><th class="koe-sort${sortCls("name")}" data-sort="name">Goalie</th>${groups.map((g) => `${gap("th")}${g.cols.map((c) => `<th class="num koe-sort ${gcls(g.name)}${sortCls(c.key)}" data-sort="${c.key}" title="${tip(c)}">${label(c)}</th>`).join("")}`).join("")}${gap("th")}<th class="num koe-sort koe-g-up${sortCls("top")}" data-sort="top" title="${upTitle}">Lead the day</th>${gap("th")}<th class="num koe-sort crease-g-value${sortCls("value")}" data-sort="value" title="${valTitle}">vs his line</th>${showResult ? `${gap("th")}<th class="num koe-sort koe-g-dist${sortCls("result")}" data-sort="result" title="His saves, and a star for the day's leader">Saves</th>` : ""}</tr>`;
  const body = rows
    .map((r) => `<tr class="crease-row${r.locked && !has(r.actual) ? " crease-live" : ""}" data-team="${r.team}">
        ${goalieCell(r)}
        ${groups.map((g) => `${gap("td")}${g.cols.map((c) => statCell(c, r, pools)).join("")}`).join("")}
        ${gap("td")}${upsideCell(r, tops)}
        ${gap("td")}${valueCell(r)}
        ${showResult ? `${gap("td")}${resultCell(r)}` : ""}
      </tr>`)
    .join("");
  box.innerHTML = `<section class="koe-section"><table class="data-table koe-table crease-table">${colgroup}<thead>${head}</thead><tbody>${body}</tbody></table></section>`;
  const sure = all.filter((r) => r.source === "both").length;
  const split = all.filter((r) => r.source === "split").length;
  const lined = all.filter((r) => has(r.line)).length;
  el("crease-count").textContent = `${all.length} starters · two sources agree on ${sure}${split ? ` · ${split} in dispute` : ""} · lines for ${lined}`;
}
function renderHead() {
  const date = days()[dayIndex];
  const board = dayBoard(date);
  const games = gamesOn(date).length;
  el("crease-capture-sub").textContent = date ? `${longDate(date)} · ${games} game${games === 1 ? "" : "s"}` : "";
  el("crease-key").innerHTML = `<span><b>Upside</b> chance to make the day's most saves</span><span><b>Value</b> that chance against what his line alone says</span><span><b class="crease-sure">&#10003;</b> NHL.com and the market agree on the starter</span><span>${rankScaleKey("more shots", "fewer")}</span><span>Lines: Novig</span>`;
  const rows = board ? board.goalies : [];
  const locked = new Set(rows.filter((r) => r.locked && !has(r.actual)).map((r) => r.game_id)).size;
  const note = board && board.final
    ? `Final${has(board.best) ? `: the day's best was ${board.best} saves` : ""}. Every number is the last one from before puck drop.`
    : locked
      ? `${locked} of these games ${locked === 1 ? "has" : "have"} started: their numbers are the last ones from before puck drop.`
      : "";
  el("crease-note").hidden = !note;
  el("crease-note").textContent = note;
}
// ---- Winners: who led each finished day, and what DraftKings paid ----
// The days come from the build (`history`: every goalie as locked before puck
// drop, best chance first, so his place is his pregame rank). The payouts are
// typed in by the owner after each contest (/api/crease-payouts, D1): the pool
// is split evenly among everyone on the winner whatever they bet, so pool /
// payout = about how many people were on him. Never in the saved image.
let PAYOUTS = {};
const DEFAULT_POOL = 500000;
const plainName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const lastName = (name) => String(name || "").split(" ").slice(-1)[0];
const shortName = (name) => { const parts = String(name || "").split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name; };
const dayShort = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function historyDays() {
  const h = (CREASE || {}).history;
  if (!h || !h.days) return [];
  return Object.entries(h.days)
    .map(([date, day]) => ({ date, best: day.best, starters: day.starters, goalies: day.goalies.map((v, i) => ({ ...Object.fromEntries(h.cols.map((c, j) => [c, v[j]])), rank: i + 1 })) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
// A pasted name to one of the day's goalies: the whole name with accents
// dropped, else a last name only one of them has.
function matchGoalie(name, goalies) {
  const want = plainName(name);
  const exact = goalies.find((g) => plainName(g.name) === want);
  if (exact) return exact;
  const last = want.split(" ").pop();
  const hits = goalies.filter((g) => plainName(g.name).split(" ").pop() === last);
  return hits.length === 1 ? hits[0] : null;
}
// DraftKings' list, one goalie a line: "🥅 Ukko-Pekka Luukkonen - $2,748 in Bonus Bets".
function parsePayouts(text, goalies) {
  const read = [];
  const missed = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    const name = raw.slice(0, m.index).replace(/^[^\p{L}]+/u, "").replace(/[\s\-–—:|=]+$/, "").trim();
    if (!name) continue;
    const g = matchGoalie(name, goalies);
    if (g) read.push({ id: g.id, name: g.name, paid: Math.round(Number(m[1].replace(/,/g, ""))) });
    else missed.push(name);
  }
  return { read, missed };
}
function paidFor(g, logged) {
  const p = (logged ? logged.payouts : []).find((x) => (x.id && g.id ? String(x.id) === String(g.id) : plainName(x.name) === plainName(g.name)));
  return p ? p.paid : null;
}
function winnerDay(day) {
  const logged = PAYOUTS[day.date] || null;
  const pool = (logged && logged.pool) || DEFAULT_POOL;
  const winners = day.goalies.filter((g) => g.actual === day.best);
  const favorite = day.goalies[0];
  const shown = day.goalies
    .map((g) => ({ ...g, paid: paidFor(g, logged) }))
    .filter((g) => has(g.paid) || g.actual === day.best)
    .map((g) => ({ ...g, worth: has(g.paid) && has(g.top) ? g.top * g.paid : null }))
    .sort((a, b) => b.actual - a.actual || a.rank - b.rank);
  const worths = shown.map((g) => g.worth).filter(has);
  const worthCell = (g) => {
    if (!has(g.worth)) return `<td></td>`;
    const place = worths.filter((v) => v > g.worth).length;
    const hue = worths.length > 1 ? Math.round(120 * (1 - place / (worths.length - 1))) : 120;
    return `<td><span class="crease-worth" style="background:${scaleHsla(hue, 70, 45, 0.22)};border-color:${scaleHsla(hue, 70, 45, 0.6)}" title="His chance to lead the day (${chanceText(g.top)}) times what he paid">${money(g.worth)}</span></td>`;
  };
  const crown = ` <span class="crease-crown">&#9733;</span>`;
  const rows = shown
    .map((g) => `<tr${g.actual === day.best ? ` class="crease-win-row"` : ""}><td class="crease-win-name">${shareLogo(g.team, 16)}${playerClick(g.id, `<span title="${g.name}">${shortName(g.name)}</span>`)}${g.actual === day.best ? crown : ""}</td><td><b>${g.actual}</b></td><td>${g.rank}<span class="muted-label">/${day.goalies.length}</span></td><td>${chanceText(g.top)}</td><td>${has(g.paid) ? money(g.paid) : ""}</td>${worthCell(g)}</tr>`)
    .join("");
  const w = winners[0];
  const wPaid = paidFor(w, logged);
  const names = winners.map((g) => lastName(g.name)).join(" / ");
  const picked = shown.filter((g) => has(g.paid)).sort((a, b) => a.paid - b.paid)[0];
  const cap = [
    favorite && !winners.includes(favorite) ? `Our favorite: ${shareLogo(favorite.team, 14)} <b>${lastName(favorite.name)}</b> (${chanceText(favorite.top)}) made ${favorite.actual}` : "",
    picked ? `Most picked: <b>${lastName(picked.name)}</b> (&asymp;${Math.round(pool / picked.paid).toLocaleString("en-US")})` : "",
  ].filter(Boolean).join(" &middot; ");
  return `<details class="crease-win-day" data-date="${day.date}">
    <summary class="crease-win-sum">
      <span class="crease-win-date" title="${longDate(day.date)}">${dayShort(day.date)}</span>
      <span class="crease-win-who">${winners.map((g) => shareLogo(g.team, 22)).join("")}<span class="crease-win-names">${names}</span> <b class="crease-win-saves">${day.best}</b>${crown}</span>
      <span class="crease-win-rank" title="Where the page had ${winners.length > 1 ? "them" : "him"} before puck drop, by chance to lead the day">${winners.map((g) => ordinal(g.rank)).join(" / ")} of ${day.goalies.length}</span>
      <span class="crease-win-paid">${has(wPaid) ? money(wPaid) : `<span class="muted-label">not logged</span>`}</span>
    </summary>
    <div class="crease-win-body">
      <div class="crease-win-meta">${day.starters} starters &middot; ${money(pool / 1000)}K pool${has(wPaid) ? ` &middot; &asymp;${Math.round(pool / wPaid).toLocaleString("en-US")} on ${winners.length > 1 ? "the winners" : lastName(w.name)}` : ""}</div>
      ${shown.length > winners.length ? `<div class="crease-win-label">If they'd won</div>` : ""}
      <table class="crease-win-table"><thead><tr><th>Goalie</th><th title="His saves">Sv</th><th title="His place before puck drop, by chance to lead the day">Pre</th><th title="His chance to lead the day, as locked before puck drop">Upside</th><th title="What DraftKings paid (or would have paid) each person on him">Paid</th><th title="His chance times what he paid: what a pick on him was worth">Worth</th></tr></thead><tbody>${rows}</tbody></table>
      ${cap ? `<div class="crease-win-cap">${cap}</div>` : ""}
    </div>
  </details>`;
}
function renderWinners() {
  const list = historyDays();
  const box = el("crease-winners-list");
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.date));
  const first = !box.dataset.drawn;
  box.innerHTML = list.length ? list.map(winnerDay).join("") : `<p class="no-data-note">The first finished day shows up here: who made the most saves, where the page had him, and what it paid.</p>`;
  box.dataset.drawn = "1";
  box.querySelectorAll("details").forEach((d, i) => (d.open = first ? i === 0 : open.has(d.dataset.date)));
  renderPayoutForm(list);
}
// The owner's box: pick a day, paste DraftKings' list, save. Shown only to
// the owner (html.is-owner) and on localhost; the server checks again.
function renderPayoutForm(list) {
  const pick = el("crease-log-date");
  const keep = pick.value;
  pick.innerHTML = list.map((d) => `<option value="${d.date}">${longDate(d.date)}</option>`).join("");
  if (keep && list.some((d) => d.date === keep)) pick.value = keep;
  el("crease-log").hidden = !list.length;
  fillPayoutForm();
}
function fillPayoutForm() {
  const date = el("crease-log-date").value;
  const logged = PAYOUTS[date];
  el("crease-log-pool").value = ((logged && logged.pool) || DEFAULT_POOL).toLocaleString("en-US");
  el("crease-log-text").value = logged ? logged.payouts.map((p) => `${p.name} - ${money(p.paid)}`).join("\n") : "";
  checkPayoutForm();
}
function payoutFormRead() {
  const day = historyDays().find((d) => d.date === el("crease-log-date").value);
  return day ? parsePayouts(el("crease-log-text").value, day.goalies) : { read: [], missed: [] };
}
function checkPayoutForm() {
  const { read, missed } = payoutFormRead();
  const status = el("crease-log-status");
  status.className = `crease-log-status${missed.length ? " crease-log-bad" : read.length ? " crease-log-good" : ""}`;
  status.textContent = missed.length ? `Not one of that day's starters: ${missed.join(", ")}` : read.length ? `✓ ${read.length} goalie${read.length === 1 ? "" : "s"} matched` : "Paste DraftKings' list: one goalie and $ amount a line";
  el("crease-log-save").disabled = !!missed.length;
}
async function savePayouts() {
  const btn = el("crease-log-save");
  const date = el("crease-log-date").value;
  const pool = Math.round(Number(el("crease-log-pool").value.replace(/[^\d.]/g, ""))) || DEFAULT_POOL;
  const { read, missed } = payoutFormRead();
  if (missed.length) return;
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    const res = await fetch("/api/crease-payouts", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, pool, payouts: read }) });
    if (!res.ok) throw new Error(String(res.status));
    if (read.length) PAYOUTS[date] = { pool, payouts: read };
    else delete PAYOUTS[date];
    btn.textContent = "Saved";
    renderWinners();
  } catch (e) {
    btn.textContent = "Couldn't save";
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save";
  }, 2000);
}
function loadPayouts() {
  return fetch("/api/crease-payouts", { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.days ? d.days : {}))
    .catch(() => ({}));
}

function showPromo(view) {
  promoView = view;
  document.querySelectorAll(".promo-views [data-promo]").forEach((b) => b.classList.toggle("active", b.dataset.promo === view));
  el("crease-app").hidden = view !== "crease";
  el("ice-app").hidden = view !== "icebreaker";
  if (view !== "crease") el("schedule-scroller").hidden = true;
  history.replaceState(null, "", view === "icebreaker" ? "#icebreaker" : location.pathname + location.search);
  render();
}
function render() {
  if (promoView === "icebreaker") return typeof renderIce === "function" && renderIce();
  if (!DATA || !CREASE) return;
  renderSchedule();
  renderHead();
  renderTable();
  renderWinners();
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  render();
}

// ---- the image ----
// html-to-image can't read Google Fonts' stylesheet from another host, so the
// latin faces are fetched and inlined (the same trick as the NFL pages'
// summaryFontCSS in common.js, which NHL pages don't load).
let fontCSSCache = null;
async function embeddedFontCSS() {
  if (fontCSSCache !== null) return fontCSSCache;
  try {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css"]');
    const css = await fetch(link.href).then((r) => r.text());
    const latin = css.split("/* ").filter((block) => block.startsWith("latin */")).map((block) => block.slice("latin */".length));
    const inlined = await Promise.all(
      latin.map(async (face) => {
        const m = face.match(/url\((https:[^)]+)\)/);
        if (!m) return face;
        const blob = await fetch(m[1]).then((r) => r.blob());
        const dataUrl = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(blob);
        });
        return face.replace(m[1], dataUrl);
      })
    );
    fontCSSCache = inlined.join("\n");
  } catch (e) {
    fontCSSCache = "";
  }
  return fontCSSCache;
}
async function saveCreaseImage() {
  const btn = el("crease-save");
  const card = el("crease-capture");
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    if (!window.htmlToImage) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // The image is the table at its full width with the title bar on, whatever the window's size.
    card.classList.add("crease-capturing");
    const url = await window.htmlToImage.toPng(card, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      fontEmbedCSS: await embeddedFontCSS(),
      includeQueryParams: true, // every logo is the same ESPN address with a different ?img=
      width: card.scrollWidth,
      height: card.scrollHeight,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `king-of-the-crease-${days()[dayIndex] || "today"}.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  card.classList.remove("crease-capturing");
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}

// The Promo Tools menu's Icebreaker link on this same page only changes the address.
window.addEventListener("hashchange", () => DATA && showPromo(location.hash === "#icebreaker" ? "icebreaker" : "crease"));
document.addEventListener("input", (e) => {
  if (e.target.closest("#crease-log-text")) checkPayoutForm();
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#crease-log-date")) fillPayoutForm();
});
document.addEventListener("click", (e) => {
  const promo = e.target.closest(".promo-views [data-promo]");
  if (promo) return showPromo(promo.dataset.promo);
  if (e.target.closest("#crease-save")) return saveCreaseImage();
  if (e.target.closest("#crease-log-save")) return savePayouts();
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const sort = e.target.closest(".koe-sort:not([data-ice-sort])"); // Icebreaker sorts its own (icebreaker.js)
  if (sort) {
    const key = sort.dataset.sort;
    Object.assign(creaseView, creaseView.sort === key ? { dir: -creaseView.dir } : { sort: key, dir: key === "name" ? 1 : -1 });
    renderTable();
  }
});

Promise.all([
  loadNhlData(),
  fetch("crease.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
  loadPayouts(),
])
  .then(async ([, crease, payouts]) => {
    CREASE = crease || { days: {}, record: null, rules: null, league: {} };
    PAYOUTS = payouts;
    // This page is this season only, so the player card opens on this season too.
    const all = days();
    // Open on today's slate if it has a board, else the first day that does.
    const today = new Date().toLocaleDateString("en-CA");
    const day = all.find((d) => d >= today && dayBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    // icebreaker.js loads after this file, so its data is asked for once this is under way.
    if (typeof loadIce === "function") await loadIce();
    el("empty-state").hidden = true;
    showPromo(promoView);
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
