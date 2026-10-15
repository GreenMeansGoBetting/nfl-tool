// ---- GMG NHL Suite: Promo Tools, Icebreaker ----
// DraftKings' promo: everyone with a qualifying first goal scorer bet on the
// player who scores the QUICKEST goal of the 7:00 PM ET slate (game clock,
// not wall clock) splits $250K. The build (icebreaker_board in build_nhl.py)
// sends each skater's `rate`: the Goals model's expected goals tonight, moved
// toward his anytime price. With a steady scoring rate, his chance to score
// the slate's first goal is his rate over everyone's in the games picked, so
// that one division is all the math here: it has to follow the games the
// member switches on and off. A team's chance is the sum of its players'.
// The fast-start numbers (fast_starts) are shown, never counted: a replay of
// two seasons found they predict nothing beyond who scores.
// Loaded after promo-tools.js, whose shareLogo, embeddedFontCSS, lastName
// and longDate it shares.

let ICE = null;
const iceView = { day: 0, slot: null, games: null, team: null, all: false };
const ICE_SHOWN = 15;
const ICE_SLOT = "19:00";

const iceDays = () => Object.keys((ICE || {}).days || {}).sort();
const iceDay = () => ((ICE || {}).days || {})[iceDays()[iceView.day]] || null;
const icePct = (n) => `${(n * 100).toFixed(1)}%`;
const american = (n) => (has(n) ? (n > 0 ? `+${n}` : `${n}`) : "--");
// Game clock: "1st 0:15", "2nd 4:30" (seconds from the opening faceoff).
function gameClock(t) {
  if (!has(t)) return "--";
  const period = Math.min(4, Math.floor(t / 1200) + 1);
  const left = t - (period - 1) * 1200;
  return `${["1st", "2nd", "3rd", "OT"][period - 1]} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
const timeLabel = (hhmm) => fmtTime(hhmm).replace(" ET", "");

// ---- the slate ----
// Start times of the day, earliest first, with their games.
function iceSlots(day) {
  const slots = {};
  for (const g of day.games) (slots[g.time] = slots[g.time] || []).push(g);
  return Object.entries(slots).sort(([a], [b]) => a.localeCompare(b));
}
// Opens on the 7:00 PM ET games (the promo's slate), else the day's first start time.
function defaultSlot(day) {
  const slots = iceSlots(day);
  return (slots.find(([t]) => t === ICE_SLOT) || slots[0] || [null])[0];
}
function pickSlot(time) {
  const day = iceDay();
  iceView.slot = time;
  iceView.games = new Set(day.games.filter((g) => g.time === time).map((g) => g.game_id));
  iceView.team = null;
}
function chosenRows() {
  const day = iceDay();
  if (!day) return [];
  const rows = day.players.filter((r) => iceView.games.has(r.game_id));
  const total = rows.reduce((s, r) => s + r.rate, 0) || 1;
  const teamSum = {};
  for (const r of rows) teamSum[r.team] = (teamSum[r.team] || 0) + r.rate;
  return rows.map((r) => ({ ...r, chance: r.rate / total, ofTeam: r.rate / teamSum[r.team] })).sort((a, b) => b.chance - a.chance);
}
function chosenTeams(rows) {
  const teams = {};
  for (const r of rows) {
    const t = (teams[r.team] = teams[r.team] || { team: r.team, opp: r.opp, home: r.home, chance: 0, players: [] });
    t.chance += r.chance;
    t.players.push(r);
  }
  return Object.values(teams).sort((a, b) => b.chance - a.chance);
}

// ---- drawing ----
// A chance on red-to-green against the slate's range (the Crease pill).
function chancePill(value, lo, hi, title) {
  const f = hi > lo ? (value - lo) / (hi - lo) : 1;
  const hue = Math.round(120 * Math.max(0, Math.min(1, f)));
  return `<span class="koe-upside crease-pill ice-pill" style="background:hsla(${hue},70%,45%,0.22);border-color:hsla(${hue},70%,45%,0.6)" title="${title}">${icePct(value)}</span>`;
}
// Where a team stands among the picked teams, on the eight colors (1 = green).
function slateCell(value, pool, higherIsBetter, text, tip) {
  if (!has(value)) return `<td class="num muted-label" title="${tip}">--</td>`;
  const better = pool.filter((v) => has(v) && (higherIsBetter ? v > value : v < value)).length;
  return `<td class="num nhl-rank-cell"${cellOnStep(rankStep(better + 1, pool.length))} title="${tip}">${text}</td>`;
}

function renderSlate() {
  const day = iceDay();
  const all = iceDays();
  el("ice-day-label").textContent = all[iceView.day] ? longDate(all[iceView.day]) : "";
  el("ice-day-prev").disabled = iceView.day <= 0;
  el("ice-day-next").disabled = iceView.day >= all.length - 1;
  if (!day) {
    el("ice-slots").innerHTML = el("ice-games").innerHTML = el("ice-summary").innerHTML = "";
    return;
  }
  el("ice-slots").innerHTML = iceSlots(day)
    .map(([t, gs]) => `<button type="button" class="ice-chip${t === iceView.slot ? " ice-on" : ""}" data-slot="${t}" title="Pick every game starting at ${timeLabel(t)} ET">${timeLabel(t)} ET <b>${gs.length}</b></button>`)
    .join("");
  el("ice-games").innerHTML = day.games
    .map((g) => {
      const on = iceView.games.has(g.game_id);
      return `<button type="button" class="ice-game${on ? " ice-on" : ""}" data-game="${g.game_id}" title="${on ? "In the contest: click to take it out" : "Not in the contest: click to add it"}"><span class="ice-check">${on ? "&#10003;" : "+"}</span>${shareLogo(g.away, 18)}<span class="at">@</span>${shareLogo(g.home, 18)}<span class="ice-gt">${g.final ? "Final" : g.locked ? "Live" : timeLabel(g.time)}</span></button>`;
    })
    .join("");
  const rows = chosenRows();
  const n = iceView.games.size;
  el("ice-summary").innerHTML = n
    ? `<b>${n} game${n === 1 ? "" : "s"}</b> in the contest &middot; <b>${rows.length}</b> skaters &middot; ${n >= 4 ? "on slates this size the quickest goal usually came in the first <b>2 minutes</b>" : n >= 2 ? "on slates this size the quickest goal usually came in the first <b>3 to 5 minutes</b>" : "one game: whoever scores first wins"}`
    : "Pick at least one game.";
}

function renderTeams(rows) {
  const teams = chosenTeams(rows);
  const fast = (ICE || {}).fast || {};
  if (!teams.length) return (el("ice-teams").innerHTML = "");
  const lo = Math.min(...teams.map((t) => t.chance));
  const hi = Math.max(...teams.map((t) => t.chance));
  const f = (team) => fast[team] || {};
  const firstRate = (t) => (f(t).gp ? f(t).first / f(t).gp : null);
  const pools = {
    first: teams.map((t) => firstRate(t.team)),
    time: teams.map((t) => f(t.team).first_time),
    sog: teams.map((t) => f(t.team).sog5),
    opp: teams.map((t) => f(t.opp).sog5_against),
  };
  const body = teams
    .map((t, i) => {
      const s = f(t.team);
      const o = f(t.opp);
      const best = t.players.slice(0, 3).map((p) => lastName(p.name)).join(", ");
      return `<tr class="ice-team-row${iceView.team === t.team ? " ice-sel" : ""}" data-team="${t.team}" title="Click to see only ${t.team}'s players">
        <td class="num ice-rk">${i + 1}</td>
        <td class="koe-player"><span class="koe-who">${shareLogo(t.team, 22)}<span class="koe-name">${t.team}</span><span class="koe-meta">${t.home ? "vs" : "@"} ${shareLogo(t.opp, 18)}</span></span></td>
        <td class="num">${chancePill(t.chance, lo, hi, `The chance one of ${t.team}'s players breaks the ice: the sum of theirs`)}</td>
        <td class="ice-who">${best}</td>
        <td class="koe-gap"></td>
        ${slateCell(firstRate(t.team), pools.first, true, s.gp ? `${s.first}/${s.gp}` : "--", `${t.team} scored the game's first goal in ${s.first} of ${s.gp} games`)}
        ${slateCell(s.first_time, pools.time, false, has(s.first_time) ? gameClock(s.first_time) : "none", has(s.first_time) ? `${t.team}'s first goal came by ${gameClock(s.first_time)} in half its games` : `${t.team} went scoreless in more than half its games`)}
        ${slateCell(s.sog5, pools.sog, true, fmt(s.sog5), `${t.team}'s shots on goal a game in the first 5 minutes`)}
        ${slateCell(o.sog5_against, pools.opp, true, fmt(o.sog5_against), `${t.opp} allows ${fmt(o.sog5_against)} shots on goal a game in the first 5 minutes`)}
      </tr>`;
    })
    .join("");
  el("ice-teams").innerHTML = `<table class="data-table koe-table ice-table ice-teams-table">
    <colgroup><col class="ice-c-rk"><col class="ice-c-team"><col class="ice-c-pill"><col class="ice-c-who"><col class="koe-c-gap"><col class="ice-c-stat"><col class="ice-c-time"><col class="ice-c-stat"><col class="ice-c-stat"></colgroup>
    <thead><tr class="koe-group-row"><th></th><th></th><th class="koe-group koe-g-up"><span>Icebreaker</span></th><th></th><th class="koe-gap"></th><th colspan="4" class="koe-group koe-g-def"><span>Fast starts &middot; this season</span></th></tr>
    <tr class="koe-label-row"><th></th><th>Team</th><th class="num">Chance</th><th>Best bets</th><th class="koe-gap"></th><th class="num" title="Games it scored the game's first goal">1st goal</th><th class="num" title="When its first goal came, in half its games">Time</th><th class="num" title="Shots on goal a game in the first 5 minutes">SOG 0-5</th><th class="num" title="What tonight's opponent allows in the first 5 minutes">Opp allows</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

const SLOT_LABEL = { F1: "L1", F2: "L2", F3: "L3", F4: "L4", D1: "D1", D2: "D2", D3: "D3" };
function lineCell(r) {
  const slot = r.slot || r.usual_slot;
  if (!slot) return `<td class="num muted-label">--</td>`;
  const arrow = r.move === "up" ? ` <span class="shots-move-up">&#9650;</span>` : r.move === "down" ? ` <span class="shots-move-down">&#9660;</span>` : "";
  const tip = r.slot ? "Tonight's line in the NHL's projected lineup" : "The line his ice time says he has been on (tonight's lineup isn't posted yet)";
  return `<td class="num" title="${tip}"><span class="ice-line${r.slot ? "" : " ice-line-usual"}">${SLOT_LABEL[slot] || slot}</span>${arrow}</td>`;
}
function priceCell(r) {
  if (!has(r.fg)) {
    const other = r.fg_best ? ` title="No DraftKings price yet. Best first goal price: ${american(r.fg_best[1])} at ${r.fg_best[0]}"` : ` title="No first goal scorer price posted yet"`;
    return `<td class="num muted-label"${other}>${r.fg_best ? `<span class="ice-odds ice-odds-other">${american(r.fg_best[1])}</span>` : "--"}</td>`;
  }
  const best = r.fg_best && r.fg_best[1] > r.fg ? ` Best: ${american(r.fg_best[1])} at ${r.fg_best[0]}.` : "";
  return `<td class="num" title="DraftKings' first goal scorer price (the promo's qualifying bet).${best}"><span class="ice-odds">${american(r.fg)}</span></td>`;
}

function renderPlayers(rows) {
  const box = el("ice-players");
  if (!rows.length) return (box.innerHTML = `<p class="no-data-note">No players for these games yet.</p>`);
  const lo = rows[rows.length - 1].chance;
  const hi = rows[0].chance;
  const rank = new Map(rows.map((r, i) => [r.id, i + 1]));
  const picked = iceView.team ? rows.filter((r) => r.team === iceView.team) : rows;
  const shown = iceView.all || iceView.team ? picked : picked.slice(0, ICE_SHOWN);
  const body = shown
    .map((r) => {
      const from = has(r.mkt_mean) ? `His anytime price (${fmt(r.mkt_mean, 2)} goals expected) moved toward the model's ${fmt(r.mean, 2)}.` : `No anytime price yet: the model's ${fmt(r.mean, 2)} goals expected alone.`;
      return `<tr class="${r.locked ? "ice-live" : ""}">
        <td class="num ice-rk">${rank.get(r.id)}</td>
        <td class="koe-player"><span class="koe-who">${shareLogo(r.team, 22)}${playerClick(r.id, `<span class="koe-name">${r.name}</span>`)}<span class="koe-meta">${r.home ? "vs" : "@"} ${shareLogo(r.opp, 18)}</span></span></td>
        ${lineCell(r)}
        <td class="num">${chancePill(r.chance, lo, hi, `His chance to score the quickest goal of the games picked. ${from}`)}</td>
        <td class="num muted-label" title="About 1 slate in ${Math.round(1 / r.chance)}">${Math.round(1 / r.chance)}</td>
        <td class="koe-gap"></td>
        <td class="num" title="His share of ${r.team}'s chance">${Math.round(r.ofTeam * 100)}%</td>
        <td class="num" title="Goals / games this season">${r.goals}<span class="muted-label">/${r.games}</span></td>
        <td class="num" title="Expected goals this season">${fmt(r.xg)}</td>
        <td class="num" title="Minutes a game">${fmt(r.minutes)}</td>
        ${priceCell(r)}
      </tr>`;
    })
    .join("");
  const more = iceView.team
    ? `${iceView.team}'s ${picked.length} skaters &middot; <button type="button" class="ice-link" data-ice-team="">Show every team</button>`
    : picked.length > ICE_SHOWN
      ? `${iceView.all ? `All ${picked.length}` : `The top ${ICE_SHOWN} of ${picked.length}`} &middot; <button type="button" class="ice-link" data-ice-all="${iceView.all ? "" : "1"}">${iceView.all ? "Show the top 15" : "Show all"}</button>`
      : "";
  box.innerHTML = `<table class="data-table koe-table ice-table ice-players-table">
    <colgroup><col class="ice-c-rk"><col class="ice-c-player"><col class="ice-c-line"><col class="ice-c-pill"><col class="ice-c-stat"><col class="koe-c-gap"><col class="ice-c-stat"><col class="ice-c-stat"><col class="ice-c-small"><col class="ice-c-small"><col class="ice-c-odds"></colgroup>
    <thead><tr class="koe-group-row"><th></th><th></th><th></th><th colspan="2" class="koe-group koe-g-up"><span>Icebreaker</span></th><th class="koe-gap"></th><th colspan="4" class="koe-group koe-g-role"><span>His season</span></th><th class="koe-group koe-g-td"><span>DraftKings</span></th></tr>
    <tr class="koe-label-row"><th></th><th>Player</th><th class="num">Line</th><th class="num">Chance</th><th class="num" title="About 1 slate in this many">1 in</th><th class="koe-gap"></th><th class="num" title="His share of his team's chance">Of team</th><th class="num">G/GP</th><th class="num">xG</th><th class="num">Min</th><th class="num" title="First goal scorer price">1st goal</th></tr></thead>
    <tbody>${body}</tbody></table>
    ${more ? `<div class="ice-more">${more}</div>` : ""}`;
}

function renderIceWinners() {
  const list = (ICE || {}).history || [];
  el("ice-winners-list").innerHTML = list.length
    ? `<table class="crease-win-table ice-win-table"><thead><tr><th>Day</th><th>Broke the ice</th><th title="Game clock">When</th><th title="His place before puck drop, by chance">Pre</th><th title="His chance before puck drop">Chance</th><th title="DraftKings first goal scorer price">DK</th></tr></thead><tbody>${list
        .map((d) =>
          d.winners
            .map(
              (w) => `<tr><td class="ice-win-date" title="${longDate(d.date)} &middot; ${d.games} games at 7:00 PM ET">${new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</td>
                <td class="crease-win-name" title="Our top pick that night: ${d.top.name} (${icePct(d.top.chance)})">${shareLogo(w.team, 16)}${w.id ? playerClick(w.id, `<span>${w.name}</span>`) : `<span>${w.name}</span>`}</td>
                <td>${gameClock(d.time)}</td><td>${has(w.rank) ? `${ordinal(w.rank)}<span class="muted-label">/${d.players}</span>` : "--"}</td><td>${has(w.chance) ? icePct(w.chance) : "--"}</td><td>${american(w.fg)}</td></tr>`
            )
            .join("")
        )
        .join("")}</tbody></table>`
    : `<p class="no-data-note">The first finished 7:00 PM slate shows up here the next morning.</p>`;
}

function renderIce() {
  if (!DATA || !ICE) return;
  const day = iceDay();
  if (day && !iceView.games) pickSlot(defaultSlot(day));
  renderSlate();
  const rows = day ? chosenRows().map((r) => ({ ...r, locked: (day.games.find((g) => g.game_id === r.game_id) || {}).locked })) : [];
  el("ice-note").hidden = !!rows.length;
  el("ice-note").textContent = day ? (iceView.games.size ? "No players for these games yet." : "") : "No NHL games with players on the board yet.";
  renderTeams(rows);
  renderPlayers(rows);
  renderIceWinners();
  const n = iceView.games ? iceView.games.size : 0;
  el("ice-capture-sub").textContent = day ? `${longDate(iceDays()[iceView.day])} · ${n} game${n === 1 ? "" : "s"}` : "";
}

// ---- the image ----
async function saveIceImage() {
  const btn = el("ice-save");
  const card = el("ice-capture");
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
    card.classList.add("ice-capturing");
    const url = await window.htmlToImage.toPng(card, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      fontEmbedCSS: await embeddedFontCSS(),
      includeQueryParams: true,
      width: card.scrollWidth,
      height: card.scrollHeight,
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `icebreaker-${iceDays()[iceView.day] || "today"}.png`;
    a.click();
    btn.textContent = "Saved";
  } catch (e) {
    btn.textContent = "Couldn't save -- screenshot instead";
  }
  card.classList.remove("ice-capturing");
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = "Save image";
  }, 2500);
}

function showHistory(open) {
  el("ice-history-modal").hidden = !open;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#ice-app, #ice-history-modal")) return;
  if (e.target.id === "ice-history-modal" || e.target.closest("#ice-history-modal .modal-close")) return showHistory(false);
  if (e.target.closest("#ice-history-btn")) return showHistory(true);
  if (e.target.closest("#ice-save")) return saveIceImage();
  const day = e.target.closest("#ice-day-prev, #ice-day-next");
  if (day) {
    iceView.day = Math.max(0, Math.min(iceDays().length - 1, iceView.day + (day.id === "ice-day-next" ? 1 : -1)));
    iceView.games = null;
    return renderIce();
  }
  const slot = e.target.closest("[data-slot]");
  if (slot) {
    pickSlot(slot.dataset.slot);
    return renderIce();
  }
  const game = e.target.closest("[data-game]");
  if (game && game.closest("#ice-games")) {
    const id = game.dataset.game;
    iceView.games.has(id) ? iceView.games.delete(id) : iceView.games.add(id);
    iceView.slot = null;
    iceView.team = null;
    return renderIce();
  }
  const reset = e.target.closest("[data-ice-team]");
  if (reset) {
    iceView.team = null;
    return renderIce();
  }
  const all = e.target.closest("[data-ice-all]");
  if (all) {
    iceView.all = !!all.dataset.iceAll;
    return renderIce();
  }
  const team = e.target.closest(".ice-team-row");
  if (team && !e.target.closest(".player-click")) {
    iceView.team = iceView.team === team.dataset.team ? null : team.dataset.team;
    return renderIce();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("ice-history-modal").hidden) showHistory(false);
});

function loadIce() {
  return fetch("icebreaker.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((ice) => {
      ICE = ice || { days: {}, fast: {}, history: [] };
      const all = iceDays();
      const today = new Date().toLocaleDateString("en-CA");
      const day = all.find((d) => d >= today) || all[all.length - 1];
      iceView.day = Math.max(0, all.indexOf(day));
    });
}
