// ---- GMG NHL Suite: Promo Tools (King of the Crease) ----
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
      const named = rows.filter((r) => r.source === "lineup").length;
      const status = !rows.length || final
        ? ""
        : named === 2
          ? `<span class="shots-card-lineup shots-card-lineup-in" title="Both starters are from the NHL's projected lineup for this game">&#10003; Goalies</span>`
          : `<span class="shots-card-lineup" title="The NHL hasn't posted this game's projected lineup yet: the starter shown is the one the book has a line for, or the team's usual one">Goalies expected</span>`;
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
  const sure = r.source === "lineup"
    ? `<span class="crease-sure" title="First goalie in the NHL's projected lineup for this game">&#10003;</span>`
    : "";
  const why = r.source === "lineup" ? "" : r.source === "market" ? "Expected: the goalie Novig has a saves line for. The NHL's projected lineup isn't in yet." : "Expected: the team's usual starter (the other goalie on the second night of a back-to-back). The NHL's projected lineup isn't in yet.";
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
  return `<td class="num"><span class="koe-upside crease-pill" style="background:hsla(${hue},70%,45%,0.22);border-color:hsla(${hue},70%,45%,0.6)" title="His chance to finish with the day's most saves, ties included. ${from}">${chanceText(r.top)}</span></td>`;
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
  const sure = all.filter((r) => r.source === "lineup").length;
  const lined = all.filter((r) => has(r.line)).length;
  el("crease-count").textContent = `${all.length} starters · ${sure} confirmed · lines for ${lined}`;
}
function renderHead() {
  const date = days()[dayIndex];
  const board = dayBoard(date);
  const games = gamesOn(date).length;
  el("crease-capture-sub").textContent = date ? `${longDate(date)} · ${games} game${games === 1 ? "" : "s"}` : "";
  el("crease-key").innerHTML = `<span><b>Upside</b> chance to make the day's most saves</span><span><b>Value</b> that chance against what his line alone says</span><span><b class="crease-sure">&#10003;</b> in the NHL's projected lineup</span><span>${rankScaleKey("more shots", "fewer")}</span><span>Lines: Novig</span>`;
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
// The record: every finished day, kept in the repo by the build (model_history/nhl_crease).
function renderRecord() {
  const record = CREASE.record;
  const box = el("crease-record");
  if (!record || !record.days) {
    box.innerHTML = `<p class="shots-record-note">The record starts with the first day that finishes after this page went live: who led each day, how often the tags had him, and whether the model or the line was closer.</p>`;
    return;
  }
  const tile = (label, big, small, tip) => `<div class="nba-tile" title="${tip}"><div class="gs-tile-label">${label}</div><b>${big}</b><small>${small}</small></div>`;
  const { favorite, upside, value, miss } = record;
  box.innerHTML = `<div class="shots-detail-label">The record so far <span class="muted-label">${shortDate(record.since)} to ${shortDate(record.through)}, ${record.days} day${record.days === 1 ? "" : "s"}, every number as locked before puck drop</span></div>
    <div class="nba-tiles shots-record">
      ${tile("The day's favorite", `${favorite.led} of ${record.days}`, `chances said ${fmt(favorite.said)}`, "Days the goalie with the highest Upside led (or tied for) the day in saves, next to how many his chances added up to")}
      ${tile("Upside tags", `${upside.days_led} of ${record.days} days`, `${upside.led} of ${upside.tagged} goalies`, "Days one of the Upside tags led the day in saves")}
      ${tile("Value tags", value.tagged ? `${value.led} of ${value.tagged}` : "none yet", value.tagged ? `chances said ${fmt(value.said)} · lines ${fmt(value.line_said)}` : "", "Value-tagged goalies who led their day, next to how many the page's chances said would, and how many their lines alone said")}
      ${tile("Average miss", has(miss.blend) ? `${fmt(miss.blend, 2)} saves` : "--", has(miss.model) ? `model ${fmt(miss.model, 2)} · line ${fmt(miss.line, 2)}` : "", `On the ${miss.goalies} goalies with a line: how far the model, the line and the two together landed from his real saves`)}
    </div>`;
}
function render() {
  if (!DATA || !CREASE) return;
  renderSchedule();
  renderHead();
  renderTable();
  renderRecord();
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

document.addEventListener("click", (e) => {
  if (e.target.closest("#crease-save")) return saveCreaseImage();
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
  const sort = e.target.closest(".koe-sort");
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
])
  .then(([, crease]) => {
    CREASE = crease || { days: {}, record: null, rules: null, league: {} };
    // This page is this season only, so the player card opens on this season too.
    view = "season";
    const all = days();
    // Open on today's slate if it has a board, else the first day that does.
    const today = new Date().toLocaleDateString("en-CA");
    const day = all.find((d) => d >= today && dayBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    el("empty-state").hidden = true;
    el("crease-app").hidden = false;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
