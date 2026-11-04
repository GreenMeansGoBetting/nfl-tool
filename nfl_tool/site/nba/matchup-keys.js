// ---- GMG NBA Suite: Matchup Keys ----
// What stands out in one game, on its own page under Matchup Breakdown (the owner, 2026-11-04:
// "too hidden" as a League Stats Chart button; "a solid overview of mismatches in the matchups and
// styles"). The keys are keys.js's (nbaMatchupKeys, every rule in one place), stacked in its three
// groups: Edges (a column a team), Clashes, Same Style, strongest first in each. Every number is
// two tiles in the room of one: the number and its rank of 30, both on the rank colors.
// Beside them, the Matchup Summary card: the 7 categories that matter most (the owner, 2026-11-04,
// "the overwhelming aspect of scheme and stats"), each team's Off and Def rank of 30 on either
// side, the logo of a team with an Edge (keys.js) beside the category. Show All Summaries = every
// game's card on one page, two a row, for the owner's video screenshots.
// Data: nba/data.json `league_chart`, the columns in league-cols.js. No common.js.

let DATA = null;
let dayIndex = 0;
let gameId = null;
const view = { window: "season", all: false };
const NBA_GAME_KEY = "nba-tool.game.v1"; // the open game, shared with Matchup Breakdown (nba.js)
const MK_GROUPS = [
  ["edge", "Edges", "var(--good-rgb)"],
  ["clash", "Clashes", "150, 100, 220"],
  ["style", "Same Style", "70, 130, 220"],
];
// The Matchup Summary's rows: [name, offense key, defense key (null: one number a team), keys.js topic].
const MK_SUMMARY = [
  ["Scoring Efficiency", "o_rtg", "d_rtg", "scoring"],
  ["Pace", "pace", null, "pace"],
  ["Three-Point Shooting", "o_3pm", "d_3pm", "threes"],
  ["Paint Scoring", "o_paint_pct", "d_paint_pct", "paint"],
  ["Turnovers", "o_tov", "d_tov", "turnovers"],
  ["Rebounding", "o_reb", "d_reb", "glass"],
  ["Free Throws", "o_ftr", "d_ftr", "ft"],
];

const el = (id) => document.getElementById(id);
const team = (abbr) => DATA.teams[abbr] || { name: abbr, color: "555555", logo: "" };
const teamRgb = (abbr) => [0, 2, 4].map((i) => parseInt((team(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
const logo = (abbr, size) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);

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
      const side = (abbr, pts, opp) =>
        final ? `<span class="matchup-team-col">${logo(abbr, 28)}<span class="matchup-score${pts > opp ? " matchup-score-win" : " matchup-score-loss"}">${pts}</span></span>` : logo(abbr, 28);
      return `<button type="button" class="matchup-card${final ? " matchup-card-final" : ""}${g.game_id === gameId ? " selected" : ""}" data-game="${g.game_id}">
        <span class="matchup-teams-row">${side(g.away, g.away_score, g.home_score)}<span class="at">@</span>${side(g.home, g.home_score, g.away_score)}</span>
        ${final ? "" : `<span class="matchup-date">${gmgGameTime(g, false)}</span>`}
      </button>`;
    })
    .join("");
}

function colLabel(key) {
  const col = COLS.find((c) => c[0] === key);
  const label = col ? col[1].replace("<br>", " ") : key;
  return key.startsWith("o_") ? `Off ${label}` : key.startsWith("d_") ? `Def ${label}` : label;
}

// The Matchup Summary card: road team left, home right, each side its Off and Def rank of 30 on the
// rank colors (green = good for that team, like the chart); a team with an Edge on that subject
// (keys.js) gets its logo beside the category, the keys in the hover.
function summaryCard(table, ranks, game, keys) {
  const side = [game.away, game.home];
  const tile = (t, key) => {
    const col = COLS.find((c) => c[0] === key);
    const v = table[t][key], rk = ranks[key].r[t];
    const tip = `${team(t).name} · ${col[2]}: ${exact(v, col[3])}${rk ? ` · ${ordinal(rk)} of ${ranks[key].n}` : ""}`;
    return `<div class="od-tile mks-t"${rk ? ` style="${rankStyle(rk, ranks[key].n)}"` : ""} title="${tip}"><b>${rk ? ordinal(rk) : ""}</b></div>`;
  };
  const cells = (t, ok, dk) => (dk ? `<td>${tile(t, ok)}</td><td>${tile(t, dk)}</td>` : `<td colspan="2">${tile(t, ok)}</td>`);
  const rows = MK_SUMMARY.map(([name, ok, dk, topic]) => {
    const mark = (t) => {
      const mine = keys.filter((k) => k.group === "edge" && k.topic === topic && k.team === t);
      return mine.length ? `<span class="mks-edge" title="Edge: ${mine.map((k) => k.title).join(" · ")}">${logo(t, 18)}</span>` : `<span class="mks-edge"></span>`;
    };
    return `<tr>${cells(side[0], ok, dk)}<td><div class="mks-cat">${mark(side[0])}<b>${name}</b>${mark(side[1])}</div></td>${cells(side[1], ok, dk)}</tr>`;
  }).join("");
  // The line when there is one (Novig, locked at tip).
  const hs = game.home_team_spread, total = game.total_line;
  const fav = hs === null || hs === undefined ? null : hs <= 0 ? game.home : game.away;
  const favLine = fav === game.home ? hs : -hs;
  const line = [fav ? `${fav} ${favLine > 0 ? "+" : ""}${favLine}` : "", total ? `O/U ${total}` : ""].filter(Boolean).join(" · ");
  const head = (t) => `<div class="mks-team" style="--team:${teamRgb(t)}">${logo(t, 34)}<b>${t}</b></div>`;
  return `<div class="mks-card" data-game="${game.game_id}">
    <div class="mks-head">${head(side[0])}<div class="mks-mid"><b>Matchup Summary</b><span>${gmgGameTime(game, false)}${line ? ` · ${line}` : ""}</span></div>${head(side[1])}</div>
    <table class="mks-grid"><colgroup><col class="mks-c"><col class="mks-c"><col><col class="mks-c"><col class="mks-c"></colgroup>
      <thead><tr><th>Off</th><th>Def</th><th></th><th>Off</th><th>Def</th></tr></thead>
      <tbody>${rows}</tbody></table>
  </div>`;
}
// Every game of the day's card, two a row (one screenshot = two games).
function renderAll(table) {
  const ranks = ranksOf(table);
  const games = gamesOn(days()[dayIndex]).filter((g) => table[g.away] && table[g.home]);
  el("mk-body").innerHTML = games.length
    ? `<div class="mks-all">${games.map((g) => summaryCard(table, ranks, g, nbaMatchupKeys(table, g.away, g.home))).join("")}</div>`
    : `<p class="no-data-note">No games with numbers on this day.</p>`;
}

function renderKeys() {
  const table = (DATA.league_chart || {})[view.window];
  const game = DATA.schedule.find((g) => g.game_id === gameId);
  el("empty-state").hidden = !!table;
  if (!table) {
    el("empty-state").innerHTML = "<p>The league numbers aren't available right now.</p>";
    el("mk-body").innerHTML = "";
    return;
  }
  if (view.all) return renderAll(table);
  if (!game || !table[game.away] || !table[game.home]) {
    el("mk-body").innerHTML = `<p class="no-data-note">Pick a game above to see its Matchup Keys.</p>`;
    return;
  }
  const ranks = ranksOf(table);
  const keys = nbaMatchupKeys(table, game.away, game.home);
  // A number: its value and its rank side by side, both shaded by the rank.
  const tile = ({ team: t, key }) => {
    const col = COLS.find((c) => c[0] === key);
    const v = table[t][key], rk = ranks[key].r[t];
    const shade = rk ? ` style="${rankStyle(rk, ranks[key].n)}"` : "";
    const tip = `${team(t).name} · ${col[2]}: ${exact(v, col[3])}${rk ? ` · ${ordinal(rk)} of ${ranks[key].n}` : ""}`;
    return `<div class="mk-num"><span class="mk-lab">${logo(t, 16)}${t} ${colLabel(key)}</span>
      <div class="mk-pair" title="${tip}"><div class="od-tile mk-val"${shade}><b>${show(v, col[3])}</b></div><div class="od-tile mk-rank"${shade}><b>${rk ? ordinal(rk) : ""}</b></div></div></div>`;
  };
  const card = (k, rgb, inColumn) => `<div class="mk-key" style="--kc:${rgb}">
      <div class="mk-key-top">${k.team && !inColumn ? logo(k.team, 18) : ""}<b>${inColumn ? k.title.replace(`${k.team} `, "") : k.title}</b></div>
      <div class="mk-nums">${k.tiles.map(tile).join("")}</div>
    </div>`;
  const none = `<p class="mk-none">Nothing here in this matchup.</p>`;
  const sections = MK_GROUPS.map(([group, name, rgb]) => {
    const list = keys.filter((k) => k.group === group).sort((a, b) => b.score - a.score);
    // Edges a column a team (the owner: "columns for each too so its sorted by team"), road team left.
    const body =
      group === "edge"
        ? `<div class="mk-teams">${[game.away, game.home].map((t) => {
            const mine = list.filter((k) => k.team === t);
            return `<div class="mk-team"><div class="mk-team-head" style="--team:${teamRgb(t)}">${logo(t, 22)}<b>${team(t).name}</b><span class="mk-count">${mine.length}</span></div>
              ${mine.length ? `<div class="mk-list">${mine.map((k) => card(k, rgb, true)).join("")}</div>` : none}</div>`;
          }).join("")}</div>`
        : list.length ? `<div class="mk-list mk-wide">${list.map((k) => card(k, rgb, false)).join("")}</div>` : none;
    return `<section class="mk-group" data-group="${group}" style="--kc:${rgb}"><h3 class="mk-group-head">${name}<span class="mk-count">${list.length}</span></h3>${body}</section>`;
  }).join("");
  el("mk-body").innerHTML = `<div class="mk-head">${logo(game.away, 24)}<b>${game.away}</b><span class="at">@</span>${logo(game.home, 24)}<b>${game.home}</b></div>
    <div class="mk-layout"><div class="mk-groups">${sections}</div><aside class="mk-side">${summaryCard(table, ranks, game, keys)}</aside></div>`;
}
function render() {
  renderSchedule();
  document.querySelectorAll("#mk-window .view-toggle-btn").forEach((b) => b.classList.toggle("active", b.dataset.window === view.window));
  el("mk-all").classList.toggle("active", view.all);
  el("mk-all").setAttribute("aria-pressed", String(view.all));
  renderKeys();
}
function selectGame(id) {
  gameId = id;
  try {
    localStorage.setItem(NBA_GAME_KEY, id);
  } catch (e) {
    // localStorage unavailable -- the pick just won't be remembered.
  }
  render();
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".matchup-card");
  if (card) {
    view.all = false; // a game card opens that game's keys
    return selectGame(card.dataset.game);
  }
  if (e.target.closest("#day-prev") || e.target.closest("#day-next")) {
    dayIndex = Math.max(0, Math.min(days().length - 1, dayIndex + (e.target.closest("#day-prev") ? -1 : 1)));
    // A new day opens on its first game.
    return selectGame((gamesOn(days()[dayIndex])[0] || {}).game_id || null);
  }
  if (e.target.closest("#mk-all")) {
    view.all = !view.all;
    return render();
  }
  const win = e.target.closest("#mk-window .view-toggle-btn");
  if (win) {
    view.window = win.dataset.window;
    return render();
  }
  const theme = e.target.closest("#theme-toggle");
  if (theme) {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("nfl-tool.theme", light ? "light" : "dark");
    } catch (err) {
      // localStorage unavailable -- the theme just won't stick.
    }
  }
});

fetch("data.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    const all = days();
    let saved = null;
    try {
      saved = localStorage.getItem(NBA_GAME_KEY);
    } catch (e) {
      // localStorage unavailable.
    }
    // Open on the game Matchup Breakdown has open if it's still in the window, else today's
    // (or the next day's) first game.
    const savedGame = DATA.schedule.find((g) => g.game_id === saved);
    const today = new Date().toLocaleDateString("en-CA");
    const day = savedGame ? savedGame.date : all.find((d) => d >= today) || all[all.length - 1];
    dayIndex = Math.max(0, all.indexOf(day));
    gameId = savedGame ? savedGame.game_id : (gamesOn(all[dayIndex])[0] || {}).game_id || null;
    render();
  })
  .catch((err) => {
    el("empty-state").innerHTML = "<p>Couldn't load the NBA data.</p>";
    console.error(err);
  });
