// ---- GMG NHL Suite: Line Matchups ----
// A preview, not a pick sheet (the owner, 2026-10-21, replacing Line Stacks):
// one game at a time, each team's forward lines and defense pairs with how
// they have played together at 5-on-5 this season, the home coach's habit
// against the other team's lines (he has the last change) and earlier
// meetings. All the counting is in the build (nfl_tool/nhl/lines_model.py ->
// lines.json); the page only decides the tags, from lines.json's `rules`.

let LINES = null;
let dayIndex = 0;
let gameId = null;

const RULES = () => ({ min_toi: 1200, strong: 0.56, weak: 0.44, form_toi: 600, form_gap: 0.05, form_goals: 2, ...((LINES || {}).rules || {}) });
const share = (f, a) => (f + a ? f / (f + a) : null);
const pctText = (s) => (has(s) ? `${Math.round(s * 100)}%` : "--");
// Shot share on the eight colors, 50% in the middle (green = had the puck more).
const SHARE_STEPS = [0.6, 0.565, 0.535, 0.51, 0.49, 0.465, 0.435];
const shareStep = (s) => {
  const i = SHARE_STEPS.findIndex((lo) => s >= lo);
  return i < 0 ? SHARE_STEPS.length : i;
};

// ---- schedule ----
function days() {
  return [...new Set(DATA.schedule.map((g) => g.date))].sort();
}
function gamesOn(date) {
  return DATA.schedule.filter((g) => g.date === date);
}
const boardFor = (g) => ((LINES || {}).games || {})[g.game_id] || null;
function currentGame() {
  return DATA.schedule.find((g) => g.game_id === gameId) || null;
}
function renderSchedule() {
  const all = days();
  const date = all[dayIndex];
  el("schedule-scroller").hidden = !all.length;
  el("day-label").textContent = date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  el("day-prev").disabled = dayIndex <= 0;
  el("day-next").disabled = dayIndex >= all.length - 1;
  el("matchup-row").innerHTML = gamesOn(date)
    .map((g) => {
      const final = g.status === "final";
      const board = boardFor(g);
      const lineup = !board ? "" : board.posted ? `<span class="shots-card-lineup shots-card-lineup-in" title="The NHL's projected lineup is in">&#10003; Lineup</span>` : `<span class="shots-card-lineup" title="Showing each team's usual lines until the NHL posts its projected lineup">Usual Lines</span>`;
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}${board ? "" : " shots-card-empty"}" data-game="${g.game_id}" title="${board ? "Show this game's lines" : "No lines for this game yet"}">
        <span class="matchup-teams-row">${logo(g.away, 28)}<span class="at">@</span>${logo(g.home, 28)}</span>
        <span class="matchup-date">${final ? "Final" : fmtTime(g.time).replace(" ET", "")}</span>
        ${lineup}
      </button>`;
    })
    .join("");
}

// ---- one unit's tags ----
function strengthTag(u) {
  const r = RULES();
  if (!u.gp) return `<span class="ln-tag ln-new" title="This group hasn't played a minute together at 5-on-5 this season">New Together</span>`;
  if (u.toi < r.min_toi) return `<span class="ln-tag ln-small" title="Under ${r.min_toi / 60} minutes together at 5-on-5: too few to call">Small Sample</span>`;
  const s = share(u.cf, u.ca);
  if (s >= r.strong) return `<span class="ln-tag ln-strong" title="${pctText(s)} of the shot attempts with them on the ice">Strong</span>`;
  if (s <= r.weak) return `<span class="ln-tag ln-weak" title="${pctText(s)} of the shot attempts with them on the ice">Weak</span>`;
  return "";
}
// Hot / Cold: the last three games together against their season, or the goals over them.
// When the two point opposite ways it is Steady, so a tile never says Cold over a rising share.
function formWord(u) {
  const r = RULES();
  const l3 = u.l3;
  if (!l3 || !l3.gp || l3.toi < r.form_toi) return null;
  const gap = share(l3.cf, l3.ca) - share(u.cf, u.ca);
  const goals = l3.gf - l3.ga;
  const hot = gap >= r.form_gap || goals >= r.form_goals;
  const cold = gap <= -r.form_gap || goals <= -r.form_goals;
  return hot && !cold ? "hot" : cold && !hot ? "cold" : "steady";
}
function formCell(u) {
  const word = formWord(u);
  if (!word) return `<div class="ln-stat ln-form"><b class="muted-label">--</b><i>Form</i></div>`;
  const l3 = u.l3;
  const tip = `Last ${l3.gp} games together: ${pctText(share(l3.cf, l3.ca))} shot share, goals ${l3.gf}-${l3.ga}, ${Math.round(l3.toi / 60)} minutes`;
  const text = { hot: "&#9650; Hot", cold: "&#9660; Cold", steady: "Steady" }[word];
  return `<div class="ln-stat ln-form ln-${word}" title="${tip}"><b>${text}</b><i>Form</i></div>`;
}
function shareCell(f, a, toi, label, tip) {
  const s = share(f, a);
  const shaded = has(s) && toi >= RULES().min_toi / 2;
  return `<div class="ln-stat"${shaded ? cellOnStep(shareStep(s)) : ""} title="${tip}"><b>${pctText(s)}</b><i>${label}</i></div>`;
}

// ---- the team columns ----
const nameOf = (board, id) => ((board.players || {})[id] || [])[0] || id;
const lastName = (board, id) => String(nameOf(board, id)).split(" ").slice(1).join(" ") || nameOf(board, id);
const slotWords = (slot) => `${slot[0] === "F" ? "Line" : "Pair"} ${slot.slice(1)}`;
function unitTile(board, u) {
  const names = u.ids.map((id) => `<div class="ln-name">${playerClick(id, `<span>${nameOf(board, id)}</span>`)}</div>`).join("");
  const l3 = u.l3 || { cf: 0, ca: 0, toi: 0, gp: 0 };
  return `<div class="ln-tile" data-slot="${u.slot}">
    <div class="ln-label">${slotWords(u.slot)}${strengthTag(u)}</div>
    <div class="ln-names">${names}</div>
    <div class="ln-stats">
      <div class="ln-stat"><b>${Math.round(u.toi / 60)}</b><i>Min &middot; ${u.gp} GP</i></div>
      ${shareCell(u.cf, u.ca, u.toi, "Shot Share", `Shot attempts ${u.cf}-${u.ca} with them on the ice at 5-on-5`)}
      <div class="ln-stat"><b>${u.gf}-${u.ga}</b><i>Goals</i></div>
      ${shareCell(l3.cf, l3.ca, l3.toi, "Last 3 GP", `Their last ${l3.gp} games together: attempts ${l3.cf}-${l3.ca}, goals ${l3.gf || 0}-${l3.ga || 0}`)}
      ${formCell(u)}
    </div>
  </div>`;
}
function teamColumn(board, abbr) {
  const t = board.teams[abbr];
  const source = t.source === "posted" ? "Projected Lineup" : "Usual Lines";
  return `<div class="ln-side">
    ${banner(abbr, source)}
    <h3 class="ln-head">Forward Lines</h3>
    ${t.lines.map((u) => unitTile(board, u)).join("") || `<p class="no-data-note">No lines yet.</p>`}
    <h3 class="ln-head">Defense Pairs</h3>
    ${t.pairs.map((u) => unitTile(board, u)).join("") || `<p class="no-data-note">No pairs yet.</p>`}
  </div>`;
}

// ---- the middle column ----
function muSide(board, abbr, slot) {
  const u = (board.teams[abbr].lines || []).find((x) => x.slot === slot);
  const s = u ? share(u.cf, u.ca) : null;
  const shaded = u && has(s) && u.toi >= RULES().min_toi;
  return `<div class="ln-mu-side"><b>${abbr} ${slotWords(slot)}</b>
    <small>${u ? u.ids.map((id) => lastName(board, id)).join(" &middot; ") : "--"}</small>
    <span class="ln-mu-share"${shaded ? cellOnStep(shareStep(s)) : ""} title="Shot share together this season">${u ? pctText(s) : "--"}</span></div>`;
}
function matchupsBox(board, g) {
  const m = board.matchups || { games: 0, rows: [] };
  const rows = m.rows
    .map((r) => {
      const tip = `In ${g.home}'s home games, against the other team's line ${r.their} (by ice time that night), ${g.home}'s line ${r.ours} was out ${Math.round(r.share * 100)}% of the time; mixed groups ${Math.round(r.mixed * 100)}%. ${Math.round(r.secs / 60)} minutes in all.`;
      return `<div class="ln-mu" title="${tip}">${muSide(board, g.away, `F${r.their}`)}<span class="ln-vs">vs</span>${muSide(board, g.home, `F${r.ours}`)}
        <div class="ln-mu-note">${Math.round(r.share * 100)}% of the time &middot; Mixed ${Math.round(r.mixed * 100)}%</div></div>`;
    })
    .join("");
  return `<div class="ln-box">
    <div class="ln-box-title">Likely Matchups</div>
    <div class="ln-box-sub">${g.home} Has Last Change &middot; ${m.games ? `From ${m.games} ${g.home} Home Game${m.games === 1 ? "" : "s"}` : `No ${g.home} Home Games Yet`}</div>
    ${rows || `<p class="no-data-note">Not enough home games with a shift chart yet.</p>`}
  </div>`;
}
function meetingsBox(board, g) {
  const m = board.meetings || { games: 0, rows: [] };
  const trio = (ids) => ids.map((id) => lastName(board, id)).join(" &middot; ");
  const rows = m.rows
    .map(([home, away, secs]) => `<div class="ln-meet"><span>${g.away}: ${trio(away)}</span><span class="ln-vs">vs</span><span>${g.home}: ${trio(home)}</span><b>${Math.round(secs / 60)} Min</b></div>`)
    .join("");
  return `<div class="ln-box">
    <div class="ln-box-title">Past Meetings</div>
    <div class="ln-box-sub">${m.games ? `${m.games} Game${m.games === 1 ? "" : "s"} This Season &middot; Trio vs Trio at 5-on-5` : "First Meeting This Season"}</div>
    ${rows}
  </div>`;
}
function teamBox(board, g) {
  const side = (abbr) => {
    const t = board.teams[abbr].team || {};
    const s = share(t.cf || 0, t.ca || 0);
    return `<div class="ln-team-side"><span>${logo(abbr, 22)} ${abbr}</span><b${has(s) ? cellOnStep(shareStep(s)) : ""}>${pctText(s)}</b><i>Goals ${t.gf || 0}-${t.ga || 0}</i></div>`;
  };
  return `<div class="ln-box">
    <div class="ln-box-title">Team 5-on-5</div>
    <div class="ln-box-sub">Shot Share &middot; ${board.teams[g.away].games} / ${board.teams[g.home].games} Games With A Shift Chart</div>
    <div class="ln-team">${side(g.away)}${side(g.home)}</div>
  </div>`;
}

function renderGame() {
  const g = currentGame();
  const board = g && boardFor(g);
  el("lines-title").innerHTML = `Line Matchups${g ? ` <span class="shots-title-game">${logo(g.away, 22)} ${g.away} <span class="at">@</span> ${logo(g.home, 22)} ${g.home}</span>` : ""}`;
  const note = el("lines-source");
  if (!board) {
    note.hidden = true;
    el("lines-content").innerHTML = `<p class="no-data-note">No lines for ${g ? "this game" : "this day"} yet.</p>`;
    return;
  }
  const posted = Object.values(board.teams).filter((t) => t.source === "posted").length;
  note.hidden = false;
  note.textContent = board.locked
    ? "This game has started: these are the lines the page showed before puck drop."
    : posted === 2
      ? "The NHL's projected lineup is in: these are tonight's lines (a projection, not the official sheet)."
      : "Usual lines over each team's last five games until the NHL posts its projected lineup (usually around midday ET).";
  el("lines-content").innerHTML = `<div class="ln-game">${teamColumn(board, g.away)}<div class="ln-mid">${matchupsBox(board, g)}${meetingsBox(board, g)}${teamBox(board, g)}</div>${teamColumn(board, g.home)}</div>`;
}
function render() {
  if (!DATA) return;
  renderSchedule();
  renderGame();
  const g = currentGame();
  if (g) [g.away, g.home].forEach(loadTeamPlayers);
}
function selectDay(i) {
  const all = days();
  dayIndex = Math.max(0, Math.min(all.length - 1, i));
  const first = gamesOn(all[dayIndex]).find(boardFor) || gamesOn(all[dayIndex])[0];
  gameId = first ? first.game_id : null;
  render();
}
document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) {
    gameId = card.dataset.game;
    return render();
  }
  if (e.target.closest("#day-prev")) return selectDay(dayIndex - 1);
  if (e.target.closest("#day-next")) return selectDay(dayIndex + 1);
});

fetch("lines.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((lines) => Promise.all([loadNhlData(), lines]))
  .then(([, lines]) => {
    LINES = lines || { games: {} };
    const all = days();
    const today = new Date().toLocaleDateString("en-CA");
    const withBoard = (d) => gamesOn(d).some((g) => boardFor(g));
    const day = all.find((d) => d >= today && withBoard(d)) || all.find((d) => d >= today) || all[all.length - 1];
    el("empty-state").hidden = true;
    el("lines-app").hidden = false;
    selectDay(Math.max(0, all.indexOf(day)));
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NHL data.</p>";
    console.error(err);
  });
