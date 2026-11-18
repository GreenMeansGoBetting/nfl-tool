// ---- GMG NBA Suite: Dunk Digest (owner only for now) ----
// The night, game by game, top to bottom, so one scroll walks through everything without hopping pages
// (the owner, 2026-11-18). Each game, in tip order: the Matchup Summary (larger), both teams' Edges side
// by side, Both Teams, Player Types, that game's Standouts, its Tough Spots under them, then Narrative.
// Nothing is worked out here: every box is drawn by Matchup Keys (matchup-keys.js) or Slate Standouts
// (standouts.js), so the numbers and the clicks are theirs. window.NBA_DIGEST stops those two pages booting.
// The right side stays clear for the owner's camera; the game list sits under it.

const DD_STEPS = [["summary", "Summary"], ["edges", "Edges"], ["types", "Player Types"], ["spots", "Standouts"], ["story", "Narrative"]];
// beside the Summary: each team's own numbers (the ones the Summary doesn't show)
const DD_NUMBERS = [["net", "Net Rating"], ["margin", "Avg Margin"], ["total", "Avg Total"], ["o_ppg", "Points Per Game"],
  ["ats", "ATS Record"], ["ou", "O/U Record"], ["o_trans_ppp", "Transition Pts"], ["o_ball_move", "Ball Movement"]];
const DD_STORIES = [["revenge", "Revenge Game"], ["hometown", "Back To Hometown"], ["college", "Back To College"]];
const DD_WIDTH = 1400, DD_RAIL = 380, DD_TYPES_ZOOM = 1.5, DD_TYPES_HEIGHT = 840;
let ddDrawn = "";

const ddEl = (id) => document.getElementById(id);
const ddStepId = (g, step) => `dd-${g.game_id}-${step}`;
const ddDate = () => ssDays()[ssDay];
const ddContext = () => {
  const table = (DATA.league_chart || {})[ssView.window === "10" ? "10" : "season"] || {};
  return { table, ranks: ranksOf(table) };
};

// ---- one game ----
// A Team Numbers box: the stat's name as the box's title, its rank, then the number (the owner, 2026-11-18:
// the small caption didn't say what the box was).
function ddNumber(ctx, t, opp, key, name) {
  const who = key.startsWith("o_") ? whoTile_(key, t, opp, true) : "";
  const s = stat(ctx, t, key);
  return `<div class="dd-num${who ? " mk-who" : ""}" style="${s.shade}" title="${esc(s.tip)}"${who}><span>${name}</span><b>${s.rk ? ordinal(s.rk) : "--"}</b><small>${s.v === null || s.v === undefined ? "" : esc(s.text)}</small></div>`;
}
function ddTeamSide(ctx, t, opp) {
  return `<div class="mk-box dd-side"><div class="mk-bh" style="--team:${teamRgb(t)}">${logo(t, 28)}${esc(team(t).name)}</div>
    <div class="dd-sh">Injuries</div><div class="dd-inj">${injuryPills(t)}</div>
    <div class="dd-sh">Team Numbers</div><div class="dd-nums">${DD_NUMBERS.map(([k, name]) => ddNumber(ctx, t, opp, k, name)).join("")}</div></div>`;
}
// ---- Narrative (narrative.py): talking points, never picks. No saved data = "No Data Yet", nothing guessed ----
const ddPlaying = (r) => !(DATA.injuries?.[r.team] || []).some((x) => x.id === r.id && SS_OUT.has(x.status));
const ddWho = (r) => `${logo(r.team, 26)}<span class="dd-sn" title="${esc(r.name)}">${playerClick(r.id, esc(r.name))}<small>${esc(r.pos)} &middot; ${r.team}</small></span>${nbaTypeBadge(r.id)}`;
const DD_STORY_ROW = {
  revenge: (r) => `<div class="dd-sr dd-sr-rev">${ddWho(r)}<span class="dd-st dd-st-team" style="--team:${teamRgb(r.opp)}">${logo(r.opp, 20)}${r.gp} Games</span>
    <span class="dd-st">${esc(r.span)}</span>${r.tag ? `<span class="dd-st dd-st-tag">${esc(r.tag)}</span>` : "<span></span>"}</div>`,
  hometown: (r) => `<div class="dd-sr"${r.school ? ` title="High School: ${esc(r.school)}"` : ""}>${ddWho(r)}<span class="dd-st">${esc(r.place)}</span></div>`,
  college: (r) => `<div class="dd-sr" title="${esc([r.place, r.years].filter(Boolean).join(", "))}">${ddWho(r)}<span class="dd-st">${esc(r.school)}</span></div>`,
};
function ddTale(g, key, name) {
  const list = DATA.narrative?.games?.[g.game_id]?.[key];
  if (!list) return `<div class="dd-tale"><b>${name}</b><span>No Data Yet</span></div>`;
  const rows = list.filter(ddPlaying);
  if (!rows.length) return `<div class="dd-tale"><b>${name}</b><span>None Tonight</span></div>`;
  return `<div class="dd-tale dd-tale-on" data-story="${key}"><b>${name}</b>${rows.map(DD_STORY_ROW[key]).join("")}</div>`;
}
const ddSpots = (g, b) => ["more", "less"].map((side) => `<div class="ss-gcard">${ssGameBand(g, b, side, side === "more" ? "Standouts" : "Tough Spots")}</div>`).join("");
function ddGame(g, i, n, ctx, b) {
  const [a, h] = [g.away, g.home];
  const ready = ctx.table[a] && ctx.table[h];
  const keys = ready ? nbaMatchupKeys(ctx.table, a, h) : [];
  const numbers = ready
    ? `<div class="dd-s1 dd-mk">${ddTeamSide(ctx, a, h)}${summaryCard(ctx, g, keys)}${ddTeamSide(ctx, h, a)}</div>
       <div class="dd-step dd-mk" id="${ddStepId(g, "edges")}"><div class="dd-edges">${edgeBox(ctx, a, h, keys)}${edgeBox(ctx, h, a, keys)}</div>${bothBox(ctx, g, keys)}</div>`
    : `<p class="no-data-note">No team numbers for this game yet.</p>`;
  return `<section class="dd-game" data-game="${g.game_id}">
    <header class="dd-gh dd-step" id="${ddStepId(g, "summary")}"><span class="dd-gn">Game ${i + 1} Of ${n}</span>${logo(a, 30)}<b>${a}</b><span class="at">@</span>${logo(h, 30)}<b>${h}</b>
      <span class="dd-gt">${gmgGameTime(g, false)}${g.tv ? ` &middot; ${esc(g.tv)}` : ""}</span><div class="mk-line">${lineTiles(g)}</div></header>
    ${numbers}
    <div class="dd-step dd-types" id="${ddStepId(g, "types")}">${typeBox(g)}</div>
    <div class="dd-step dd-ss" id="${ddStepId(g, "spots")}" data-game="${g.game_id}">${ddSpots(g, b)}</div>
    <div class="dd-step mk-box dd-story" id="${ddStepId(g, "story")}"><div class="mk-bh mk-bh-both" title="Career teams and college from ESPN; birthplace and high schools from ESPN and Wikipedia. Talking points, not picks.">Narrative</div>
      <div class="dd-stories">${DD_STORIES.map(([key, name]) => ddTale(g, key, name)).join("")}</div></div>
  </section>`;
}

// ---- the game list under the camera ----
function ddRail(b) {
  ddEl("day-label").textContent = new Date(`${ddDate()}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  ddEl("dd-win").innerHTML = [["season", "Season"], ["10", "Last 10"]].map(([w, name]) => `<button type="button" class="view-toggle-btn${ssView.window === w ? " active" : ""}" data-dd-window="${w}">${name}</button>`).join("");
  ddEl("dd-rgames").innerHTML = b.games.map((g) => `<button type="button" class="dd-rg" data-jump="${ddStepId(g, "summary")}" data-rail="${g.game_id}">${logo(g.away, 20)}<span class="at">@</span>${logo(g.home, 20)}<small>${gmgGameTime(g, false)}</small></button>`).join("");
  ddEl("dd-rail").hidden = false;
}
function ddSpy() {
  const games = [...document.querySelectorAll(".dd-game")];
  const now = games.filter((s) => s.getBoundingClientRect().top <= 140).pop() || games[0];
  if (!now) return;
  const id = now.dataset.game;
  document.querySelectorAll(".dd-rg").forEach((b) => b.classList.toggle("on", b.dataset.rail === id));
  const g = { game_id: id };
  const at = DD_STEPS.filter(([s]) => { const e = ddEl(ddStepId(g, s)); return e && e.getBoundingClientRect().top <= 160; }).pop();
  ddEl("dd-rsteps").innerHTML = DD_STEPS.map(([s, name]) => `<button type="button" class="${at && at[0] === s ? "on" : ""}" data-jump="${ddStepId(g, s)}">${name}</button>`).join("");
}

// ---- sizes: the column fits left of the game list, Player Types grows to fill its row ----
function ddFit() {
  const vw = document.documentElement.clientWidth, wide = vw >= 1500;
  const zoom = Math.min(1, (wide ? vw - DD_RAIL - 64 : vw - 32) / DD_WIDTH);
  document.documentElement.style.setProperty("--dd-z", zoom.toFixed(4));
  document.documentElement.classList.toggle("dd-stack", !wide);
  document.querySelectorAll(".dd-types").forEach((row) => {
    const box = row.querySelector(".mk-types");
    if (!box) return;
    box.style.zoom = 1;
    const r = box.getBoundingClientRect();
    box.style.zoom = Math.min(DD_TYPES_ZOOM, row.getBoundingClientRect().width / r.width, DD_TYPES_HEIGHT / r.height).toFixed(3);
  });
}

// ---- drawing ----
function ddDraw() {
  const date = ddDate();
  const b = ssBuild(date), ctx = ddContext();
  ssLast = b;
  ddDrawn = `${date}|${ssView.window}`;
  ddRail(b);
  ddEl("dd-body").innerHTML = b.games.length ? b.games.map((g, i) => ddGame(g, i, b.games.length, ctx, b)).join("") : '<p class="no-data-note">No games this day.</p>';
  ddFit();
  ddSpy();
}
// Standouts' own clicks call ssRender: a drop-down or a saved play redraws only the Standouts boxes, so
// the page stays where it is; a new day or window redraws the night.
window.ssRender = function ddRefresh() {
  if (ddDrawn !== `${ddDate()}|${ssView.window}`) {
    ddDraw();
    return window.scrollTo(0, 0);
  }
  const b = ssBuild(ddDate());
  ssLast = b;
  document.querySelectorAll(".dd-ss").forEach((box) => {
    const g = b.games.find((x) => String(x.game_id) === box.dataset.game);
    if (g) box.innerHTML = ddSpots(g, b);
  });
};

// Tiles inside the Standouts boxes, the day arrows and the theme button are standouts.js's own clicks.
document.addEventListener("click", (e) => {
  if (e.target.closest(".player-click")) return;
  const jump = e.target.closest("[data-jump]");
  if (jump) return ddEl(jump.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const win = e.target.closest("[data-dd-window]");
  if (win) {
    ssView.window = win.dataset.ddWindow;
    ssView.open = "";
    return window.ssRender();
  }
  const game = e.target.closest(".dd-game");
  if (!game) return;
  const who = e.target.closest(".dd-mk [data-who]");
  if (who) {
    const g = DATA.schedule.find((x) => String(x.game_id) === game.dataset.game);
    return whoOpen(who.dataset.who, g, whoDirs(who, g));
  }
  if (e.target.closest(".dd-ss :is(.ss-logo, .ss-team)")) ssOpenGame(game.dataset.game);
});
let ddTick = false;
const ddLater = (fn) => {
  if (ddTick) return;
  ddTick = true;
  requestAnimationFrame(() => { ddTick = false; fn(); });
};
window.addEventListener("scroll", () => ddLater(ddSpy), { passive: true });
window.addEventListener("resize", () => ddLater(() => { ddFit(); ddSpy(); }));

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    if (!data.shot_types || !data.shot_types.log || !data.league_chart) {
      ddEl("empty-state").innerHTML = "<p>Dunk Digest isn't available right now.</p>";
      return;
    }
    ddEl("empty-state").hidden = true;
    const all = ssDays();
    const today = new Date().toLocaleDateString("en-CA");
    ssDay = Math.max(0, all.indexOf(all.find((d) => d >= today) || all[all.length - 1]));
    ddDraw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ddFit);
  })
  .catch((err) => {
    ddEl("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
