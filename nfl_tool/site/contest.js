// $100 CONTEST (the owner, 2026-11-20). One player per game to score an anytime TD, $10 of fake
// money on each, every player at the same price for everyone: FanDuel's, frozen when the owner
// presses "Lock Prices" (the games, prices and lock time are saved by /api/contest in the login
// code). Members save one entry each until the lock (Sunday 1:00 PM ET); before it the
// Leaderboard shows who entered with picks hidden, after it everyone's picks and the grades.
// Grading, first that applies (gradeInfo): the owner's hand result (Tracking tab); ESPN's final box
// score (2026-11-22, through /api/contest): a TD counts the moment it shows, a miss only once ESPN
// calls the game final, a player missing from a final box score gets the $10 back; data.json the
// morning after (a TD = he's in player_td_results; no snaps that week = $10 back; else lost) only for
// a game ESPN never finished. Where data.json disagrees with ESPN's final, the owner gets a list
// (diffBox) and settles each by hand. The page re-asks every 2 minutes once locked.
(() => {
  const STAKE = 10;
  const BOOK = "FanDuel";
  const DRAFT_KEY = "nfl-tool.contest-draft.v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtOdds = (o) => (o > 0 ? `+${o}` : `${o}`);
  const profit = (o) => (o > 0 ? (STAKE * o) / 100 : (STAKE * 100) / -o);
  const money = (v) => {
    const r = Math.round(v * 100) / 100;
    const abs = Math.abs(r);
    const s = Number.isInteger(abs) ? abs.toLocaleString() : abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${r < 0 ? "-" : ""}$${s}`;
  };
  const logo = (t, s = 22) => `<img src="${teamLogoUrl(t)}" alt="${t}" width="${s}" height="${s}" loading="lazy">`;
  const POS_HUE = { RB: 140, WR: 215, TE: 275, QB: 25 };
  const normName = (n) => String(n || "").toLowerCase().replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

  // Eastern clock time on a date -> a real moment (handles EST / EDT).
  function easternToUtc(date, time) {
    const guess = new Date(`${date}T${time}:00Z`);
    const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName");
    const m = /GMT([+-]\d+)/.exec(part ? part.value : "") || [0, -5];
    return guess.getTime() - Number(m[1]) * 3600e3;
  }
  const etLabel = (ms, opts) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", ...opts });
  const lockLabel = (ms) => `${etLabel(ms, { weekday: "short" })} ${etLabel(ms, { hour: "numeric", minute: "2-digit" })} ET`;
  const slotOf = (g) => {
    if (g.day === "Monday") return "Monday Night";
    if (!g.time) return g.day || "";
    const [h, m] = g.time.split(":").map(Number);
    if (g.day === "Sunday" && h >= 20) return "Sunday Night";
    return `${g.day} ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
  };

  let API = null; // /api/contest
  let picks = {}; // game id -> player key (this device, until submitted)
  let openGame = null;
  let tab = "picks";
  let openEntry = null;
  let note = "";
  let dataDone = false;

  // ---------- The contest the owner would open now (from data.json) ----------
  function draftContest() {
    if (typeof DATA === "undefined" || !DATA || !Array.isArray(DATA.schedule)) return null;
    const week = DATA.current_week;
    const now = Date.now();
    const games = DATA.schedule
      .filter((g) => g.week === week && g.status !== "final")
      .map((g) => {
        // Flexed games (2026-11-21: JAX @ NYG to 4:25, PIT @ PHI to 1:00): the books' kickoff is
        // current, the schedule's can be days behind. Day and time are read back in Eastern.
        const book = ((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).kickoff;
        const ms = book && Number.isFinite(Date.parse(book)) ? Date.parse(book) : easternToUtc(g.date, g.time || "13:00");
        const day = etLabel(ms, { weekday: "long" });
        const time = new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        return { ...g, ms, weekday: day, time };
      })
      .filter((g) => g.ms > now)
      .sort((a, b) => a.ms - b.ms)
      .map((g) => {
        const players = [];
        for (const team of [g.away, g.home]) {
          for (const p of (DATA.player_td_odds || {})[team] || []) {
            if (!Number.isInteger(p.fd) || p.position === "DST") continue;
            players.push({ k: `${team}|${p.name}`, name: p.name, pos: p.position || "", team, odds: p.fd });
          }
        }
        return { id: g.game_id, away: g.away, home: g.home, day: g.weekday, time: g.time, kickoff: new Date(g.ms).toISOString(), players };
      });
    if (!games.length) return null;
    const sunday = games.find((g) => g.day === "Sunday");
    const lockDate = sunday ? DATA.schedule.find((s) => s.game_id === sunday.id).date : null;
    const lock_at = lockDate ? easternToUtc(lockDate, "13:00") : Date.parse(games[0].kickoff);
    return { id: `${DATA.season}_${String(week).padStart(2, "0")}`, season: DATA.season, week, lock_at, book: BOOK, games };
  }

  const contest = () => (API && API.contest) || (API && API.owner && !API.contest ? draftContest() : null);
  const isPreview = () => API && API.owner && !API.contest;
  const isLocked = () => !!(API && API.contest && Date.now() >= API.contest.lock_at);
  const playerOf = (g, k) => g.players.find((p) => p.k === k);

  // ---------- Grading ----------
  // A box-score name for this player: the same name, else one scorer on his team with his last name and first initial.
  function sameName(list, name) {
    const me = normName(name);
    if (list.some((n) => normName(n) === me)) return true;
    const parts = me.split(" ");
    const last = parts[parts.length - 1];
    const close = list.filter((n) => { const q = normName(n).split(" "); return q[q.length - 1] === last && q[0][0] === me[0]; });
    return close.length === 1;
  }
  const liveGame = (g) => (API && API.live && API.live.games && API.live.games[g.id]) || null;
  function liveGrade(g, p) {
    const lg = liveGame(g);
    if (!lg || lg.state === "pre" || !lg.teams) return "pending";
    const box = lg.teams[p.team] || { tds: {}, played: [] };
    if (sameName(Object.keys(box.tds || {}), p.name)) return "hit";
    if (!lg.final) return "live";
    return sameName(box.played || [], p.name) ? "miss" : "void";
  }
  // { res: hit | miss | void | live (playing, no TD yet) | pending, src: mark | official | live }
  // ESPN's final stands; nflverse (the morning's data.json) never replaces it, only fills a game
  // ESPN never finished, and any disagreement goes to the owner (diffs), who settles it by hand
  // (the owner, 2026-11-22: "instead of an auto replace ... an alert that says if there's differences").
  function gradeInfo(c, g, p) {
    const mark = ((API && API.marks) || {})[g.id];
    if (mark && mark[p.k]) return { res: mark[p.k], src: "mark" };
    const lg = liveGame(g);
    if (lg && lg.final) return { res: liveGrade(g, p), src: "live" };
    const res = officialGrade(c, g, p);
    if (res !== "pending") return { res, src: "official" };
    return { res: liveGrade(g, p), src: "live" };
  }
  // Picked players whose ESPN final and nflverse result differ, with no hand result yet.
  function diffs(c) {
    const out = [];
    for (const g of c.games) {
      const lg = liveGame(g);
      if (!lg || !lg.final) continue;
      const keys = new Set((API.entries || []).map((e) => (e.picks || {})[g.id]).filter(Boolean));
      for (const k of keys) {
        const p = playerOf(g, k);
        if (!p || (((API.marks || {})[g.id]) || {})[k]) continue;
        const espn = liveGrade(g, p);
        const nflverse = officialGrade(c, g, p);
        if (nflverse !== "pending" && nflverse !== espn) out.push({ g, p, espn, nflverse });
      }
    }
    return out;
  }
  const gradePick = (c, g, p) => gradeInfo(c, g, p).res;
  // "final" once the morning's data has the game or ESPN calls it final; "live" while it's on.
  function gameState(c, g) {
    const lg = liveGame(g);
    if (officialIn(c, g.away) || officialIn(c, g.home) || (lg && lg.final)) return "final";
    return lg && lg.state !== "pre" ? "live" : "pre";
  }
  function officialIn(c, team) {
    if (typeof DATA === "undefined" || !DATA) return false;
    const wk = String(c.week);
    const snaps = (DATA.player_snaps || {})[team] || {};
    const scored = ((((DATA.player_td_results || {})[wk] || (DATA.player_td_results || {})[c.week] || {})[team]) || {}).any_td || [];
    return Object.values(snaps).some((s) => s && s.w && s.w[wk] != null) || scored.length > 0;
  }
  function officialGrade(c, g, p) {
    if (typeof DATA === "undefined" || !DATA) return "pending";
    const wk = String(c.week);
    const snaps = (DATA.player_snaps || {})[p.team] || {};
    const scored = ((((DATA.player_td_results || {})[wk] || (DATA.player_td_results || {})[c.week] || {})[p.team]) || {}).any_td || [];
    const teamIn = Object.values(snaps).some((s) => s && s.w && s.w[wk] != null) || scored.length > 0;
    if (!teamIn) return "pending";
    const me = normName(p.name);
    if (scored.some((n) => normName(n) === me)) return "hit";
    const played = Object.entries(snaps).some(([n, s]) => normName(n) === me && s && s.w && s.w[wk] > 0);
    return played ? "miss" : "void";
  }
  function scoreEntry(c, e) {
    const start = STAKE * c.games.length;
    let bank = start, hits = 0, graded = 0, longest = null;
    const rows = c.games.map((g) => {
      const p = playerOf(g, (e.picks || {})[g.id]);
      if (!p) return { g, p: null, res: "pending" };
      const res = gradePick(c, g, p);
      if (res === "hit") {
        bank += profit(p.odds);
        hits += 1;
        if (!longest || p.odds > longest.odds) longest = p;
      } else if (res === "miss") bank -= STAKE;
      if (res !== "pending" && res !== "live") graded += 1;
      return { g, p, res };
    });
    return { ...e, bank, hits, graded, longest, rows, start };
  }
  // Highest bankroll; ties: fewer correct picks, then the longest price that hit (the owner, 2026-11-20).
  const compareEntries = (a, b) => b.bank - a.bank || a.hits - b.hits || ((b.longest && b.longest.odds) || 0) - ((a.longest && a.longest.odds) || 0);
  function rankEntries(c, entries) {
    const list = entries.map((e) => scoreEntry(c, e));
    const cmp = compareEntries;
    list.sort(cmp);
    list.forEach((e, i) => { e.rank = i && !cmp(list[i - 1], e) ? list[i - 1].rank : i + 1; });
    return list;
  }

  // ---------- Pieces ----------
  function oddsTileFor(c) {
    const all = c.games.flatMap((g) => g.players.map((p) => p.odds)).sort((a, b) => a - b);
    return (o) => {
      const rank = all.findIndex((x) => x >= o) + 1;
      return `<div class="od-tile"${rankScaleStyle(rank, all.length)}><b>${fmtOdds(o)}</b></div>`;
    };
  }
  const posTag = (pos) => `<span class="ct-pos" style="--ph:${POS_HUE[pos] ?? 210}">${esc(pos || "–")}</span>`;

  function strip(c) {
    const n = c.games.filter((g) => picks[g.id]).length;
    const start = STAKE * c.games.length;
    const best = c.games.reduce((s, g) => { const p = playerOf(g, picks[g.id]); return s + (p ? profit(p.odds) : 0); }, 0);
    const priced = API.contest ? `Locked ${etLabel(API.contest.priced_at, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Not Locked Yet";
    return `<div class="ct-strip">
      <div class="od-tile"><small>Bankroll</small><b>${money(start)}</b></div>
      <div class="od-tile"${rankScaleStyle(n === c.games.length ? 1 : 6, 8)}><small>Picked</small><b>${n} of ${c.games.length}</b></div>
      <div class="od-tile"><small>On The Line</small><b>${money(n * STAKE)}</b></div>
      <div class="od-tile"${rankScaleStyle(1, 8)}><small>If Every Pick Hits</small><b>${money(start + best)}</b></div>
      <div class="od-tile ct-price"><small>Prices: ${esc(c.book || BOOK)} Anytime TD</small><b>${priced}</b></div>
      <div class="od-tile ct-lock"><small>Picks Lock</small><b>${isLocked() ? "Locked" : lockLabel(c.lock_at)}</b></div>
    </div>`;
  }

  function ownerBar(c) {
    if (!API.owner) return "";
    if (isPreview()) {
      const thin = c.games.filter((g) => g.players.length < 4).map((g) => `${g.away} @ ${g.home}`);
      return `<div class="ct-ownerbar"><b>Only You See This.</b> Members can't enter until you lock prices. Every price below is FanDuel's right now (this build).
        ${thin.length ? `<span class="ct-warn">Few FanDuel Prices Yet: ${esc(thin.join(", "))}</span>` : ""}
        <button type="button" class="ct-go" data-act="open">Lock FanDuel Prices &amp; Open Contest</button></div>`;
    }
    return `<div class="ct-ownerbar"><b>Only You See This.</b> Prices locked ${esc(etLabel(c.priced_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} ET, ${API.entries.length} ${API.entries.length === 1 ? "entry" : "entries"}.
      ${isLocked() ? "" : `<button type="button" class="ct-sm" data-act="relock">Re-Lock Prices Now (Keeps Entries)</button><button type="button" class="ct-sm ct-danger" data-act="clear">Re-Lock And Clear All Entries</button>`}</div>`;
  }

  function teamBox(c, g, team, tile, chosen, editable) {
    const list = g.players.filter((p) => p.team === team).sort((a, b) => a.odds - b.odds);
    return `<div class="ct-team" style="--tc:${TEAM_COLORS[team] || "#888"}">
      <div class="ct-team-head">${logo(team, 20)} ${esc(TEAM_NAMES[team] || team)}</div>
      <div class="ct-plist">${list.length ? list.map((p) => `
        <button type="button" class="ct-p${chosen === p.k ? " sel" : ""}" data-g="${esc(g.id)}" data-k="${esc(p.k)}"${editable ? "" : " disabled"}>
          ${posTag(p.pos)}<span class="nm">${esc(p.name)}</span>${tile(p.odds)}
          <span class="ct-win">+${money(profit(p.odds))}<small>If He Scores</small></span>
        </button>`).join("") : `<div class="ct-none">No ${BOOK} Prices</div>`}</div>
    </div>`;
  }

  function renderPicks(c) {
    const tile = oddsTileFor(c);
    const editable = !isLocked();
    let slot = "";
    const rows = [];
    for (const g of c.games) {
      const s = slotOf(g);
      if (s !== slot) {
        slot = s;
        rows.push(`<tr><td colspan="4" class="ct-slot">${esc(s)}</td></tr>`);
      }
      const p = playerOf(g, picks[g.id]);
      const res = isLocked() && p ? gradePick(c, g, p) : "";
      const btn = p
        ? `<div class="ct-pickbtn set ${res}">${logo(p.team, 16)} ${posTag(p.pos)}<span class="nm">${esc(p.name)}</span>${editable ? `<span class="car">&#9662;</span>` : ""}</div>`
        : `<div class="ct-pickbtn empty"><span>${editable ? "Pick A Player" : "No Pick"}</span>${editable ? `<span class="car">&#9662;</span>` : ""}</div>`;
      rows.push(`<tr class="ct-row${openGame === g.id ? " open" : ""}" data-g="${esc(g.id)}">
        <td><div class="ct-game">${logo(g.away)} ${g.away} <span class="at">@</span> ${logo(g.home)} ${g.home}</div></td>
        <td>${btn}</td>
        <td>${p ? tile(p.odds) : `<div class="od-tile"><b>&ndash;</b></div>`}</td>
        <td>${p ? `<div class="od-tile"><b>+${money(profit(p.odds))}</b></div>` : `<div class="od-tile"><b>&ndash;</b></div>`}</td>
      </tr>`);
      if (openGame === g.id) {
        rows.push(`<tr class="ct-drop"><td colspan="4"><div class="ct-drop-inner">${teamBox(c, g, g.away, tile, picks[g.id], editable)}${teamBox(c, g, g.home, tile, picks[g.id], editable)}</div></td></tr>`);
      }
    }
    const n = c.games.filter((g) => picks[g.id]).length;
    const me = API.me;
    const d = API.defaults || {};
    const changed = !me || c.games.some((g) => (me.picks || {})[g.id] !== picks[g.id]);
    let submit = "";
    if (isPreview()) submit = `<div class="ct-submit"><span class="ct-saved ct-info">Preview: entries open once you lock prices.</span></div>`;
    else if (isLocked()) submit = me ? `<div class="ct-submit"><span class="ct-saved">&#128274; Your Entry Is Locked In As &ldquo;${esc(me.name)}&rdquo;.</span></div>` : `<div class="ct-submit"><span class="ct-saved ct-info">&#128274; Picks Locked At ${lockLabel(c.lock_at)}. You Did Not Enter This Week.</span></div>`;
    else {
      const need = c.games.length - n;
      submit = `<div class="ct-submit">
        <label>Name On The Leaderboard<input id="ct-name" maxlength="30" value="${esc(me ? me.name : d.name)}" placeholder="Your name"></label>
        <label>Discord Username Or Email (Only GMG Sees This)<input id="ct-contact" maxlength="100" value="${esc(me ? me.contact : d.contact)}" placeholder="So we can pay you if you win"></label>
        <button type="button" class="ct-go" data-act="enter"${need ? " disabled" : ""}>${need ? `Pick ${need} More To Submit` : me ? "Update Entry" : "Submit Entry"}</button>
        ${me && !changed ? `<span class="ct-saved">&#10003; Entry Saved. Change It Any Time Before ${lockLabel(c.lock_at)}.</span>` : ""}
        ${me && changed ? `<span class="ct-saved ct-warnmsg">Changes Not Saved Yet: Press Update Entry.</span>` : ""}
        ${note ? `<span class="ct-saved ct-warnmsg">${esc(note)}</span>` : ""}
      </div>`;
    }
    return `<table class="data-table od-grid ct-games">
        <thead>
          <tr class="od-ggroups"><th rowspan="2" class="od-g3 od-gone">Game</th><th colspan="3" class="od-g0">Your Pick &middot; $10 Each</th></tr>
          <tr class="od-glabels"><th class="od-gt od-g0">Player ${editable ? "(Click A Game)" : ""}</th><th class="od-gt od-g0">Price</th><th class="od-gt od-g0">Wins</th></tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>${submit}`;
  }

  // An entry's own key, so an opened row stays open when the live ranking reshuffles.
  const ekey = (e) => `${e.name}|${e.updated}`;
  function renderBoard(c) {
    const entries = API.entries || [];
    if (isPreview()) return `<p class="ct-graded">The Leaderboard fills in once you lock prices and members enter.</p>`;
    if (!entries.length) return `<p class="ct-graded">No entries yet.</p>`;
    const owner = API.owner;
    if (!isLocked()) {
      return `<p class="ct-graded">${entries.length} ${entries.length === 1 ? "Entry" : "Entries"} &middot; Picks Show At ${lockLabel(c.lock_at)}</p>
        <table class="data-table od-grid ct-lb">
          <thead><tr class="od-ggroups"><th class="od-g0 od-gone">#</th><th class="od-g0 od-gone">Entry</th><th class="od-g0 od-gone">Entered</th><th class="od-g0 od-gone">Picks</th>${owner ? `<th class="od-g2 od-gone">Contact (Only You)</th><th class="od-g2 od-gone"></th>` : ""}</tr></thead>
          <tbody>${entries.map((e, i) => `<tr class="${owner ? "ct-lbrow" : ""}${openEntry === ekey(e) ? " open" : ""}" data-e="${esc(ekey(e))}">
            <td><div class="od-tile ct-rank">${i + 1}</div></td>
            <td><div class="od-tile ct-name">${esc(e.name)}${e.mine ? " (You)" : ""}</div></td>
            <td><div class="od-tile"><b>${esc(etLabel(e.updated, { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b></div></td>
            <td><div class="ct-hidden">&#128274; Hidden Until ${lockLabel(c.lock_at)}</div></td>
            ${owner ? `<td><div class="ct-owner">${esc(e.contact)}</div></td><td><button type="button" class="ct-sm ct-danger" data-act="remove" data-uid="${esc(e.uid)}">Remove</button></td>` : ""}
          </tr>${owner && openEntry === ekey(e) ? picksRow(c, scoreEntry(c, e), 6) : ""}`).join("")}</tbody>
        </table>`;
    }
    const ranked = rankEntries(c, entries);
    const done = c.games.filter((g) => gameState(c, g) === "final").length;
    const graded = c.games.some((g) => gameState(c, g) !== "pre");
    const body = ranked.map((r) => `<tr class="ct-lbrow${openEntry === ekey(r) ? " open" : ""}" data-e="${esc(ekey(r))}">
        <td><div class="od-tile ct-rank${r.rank === 1 && graded ? " gold" : ""}">${r.rank}</div></td>
        <td><div class="od-tile ct-name">${esc(r.name)}${r.mine ? " (You)" : ""}</div></td>
        <td><div class="od-tile"${graded ? rankScaleStyle(ranked.filter((x) => x.bank > r.bank).length + 1, ranked.length) : ""}><b>${money(r.bank)}</b><small>${r.bank >= r.start ? "+" : "&minus;"}${money(Math.abs(r.bank - r.start))}</small></div></td>
        <td><div class="od-tile"><b>${r.hits} of ${r.graded}</b>${r.graded < c.games.length ? `<small>${c.games.length - r.graded} To Go</small>` : ""}</div></td>
        <td><div class="od-tile">${r.longest ? `<b>${fmtOdds(r.longest.odds)}</b><small>${esc(r.longest.name)}</small>` : "<b>&ndash;</b>"}</div></td>
        ${owner ? `<td><div class="ct-owner">${esc(r.contact)}</div></td>` : ""}
      </tr>${openEntry === ekey(r) ? picksRow(c, r, owner ? 6 : 5) : ""}`).join("");
    const most = c.games.map((g) => {
      const count = {};
      entries.forEach((e) => { const k = (e.picks || {})[g.id]; if (k) count[k] = (count[k] || 0) + 1; });
      const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      return top ? { g, p: playerOf(g, top[0]), pct: Math.round((100 * top[1]) / entries.length) } : null;
    }).filter((m) => m && m.p);
    return `<p class="ct-graded">${done} Of ${c.games.length} Games Final &middot; ${liveNote()}</p>
      <div class="ct-board">
        <table class="data-table od-grid ct-lb">
          <thead>
            <tr class="od-ggroups"><th rowspan="2" class="od-g0 od-gone">#</th><th rowspan="2" class="od-g0 od-gone">Entry (Click For Picks)</th><th colspan="3" class="od-g1">Results</th>${owner ? `<th rowspan="2" class="od-g2 od-gone">Contact<br>(Only You)</th>` : ""}</tr>
            <tr class="od-glabels"><th class="od-gt od-g1">Bankroll</th><th class="od-gt od-g1">Hits</th><th class="od-gt od-g1">Longest Hit</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <div class="ct-box">
          <div class="ct-box-title">Most Picked</div>
          <div class="ct-box-body">${most.map((m) => `<div class="ct-mp"><span class="g">${logo(m.p.team, 15)}${m.g.away} @ ${m.g.home}</span><span class="nm">${esc(m.p.name)}</span><div class="od-tile"${rankScaleStyle(Math.max(1, 9 - Math.round(m.pct / 12.5)), 8)}><b>${m.pct}%</b></div></div>`).join("")}</div>
        </div>
      </div>`;
  }

  // ---------- Tracking (after the lock): every picked player, game by game, live ----------
  function liveNote() {
    const f = API && API.live && API.live.fetched;
    if (!f) return "Live TDs Start At Kickoff &middot; Double-Checked The Morning After";
    const err = API.live.error ? " (ESPN Didn't Answer, Trying Again)" : "";
    return `Live TDs From ESPN, Updated ${esc(etLabel(f, { hour: "numeric", minute: "2-digit" }))} ET${err} &middot; Double-Checked The Morning After`;
  }
  const RESULT_LOOK = { hit: ["Scored", 1], miss: ["No TD", 8], void: ["Didn't Play", 0], live: ["No TD Yet", 0], pending: ["Not Started", 0] };
  const SOURCE = { mark: "Set By GMG", official: "Official", live: "Live" };
  function resultTile(info, note) {
    const [label, rank] = RESULT_LOOK[info.res] || RESULT_LOOK.pending;
    const src = note || (info.res === "pending" ? "" : SOURCE[info.src]);
    return `<div class="od-tile ct-res ${info.res}"${rank ? rankScaleStyle(rank, 8) : ""}><b>${label}</b>${src ? `<small>${src}</small>` : ""}</div>`;
  }
  // The owner's alert: every pick where the morning's nflverse data disagrees with ESPN's final.
  function diffBox(c) {
    if (!API.owner || !isLocked()) return "";
    const list = diffs(c);
    if (!list.length) return "";
    const btn = (g, p, r, label) => `<button type="button" class="ct-sm" data-act="mark" data-g="${esc(g.id)}" data-k="${esc(p.k)}" data-r="${r}">${label}</button>`;
    return `<div class="ct-diff">
      <div class="ct-diff-title">nflverse Disagrees With ESPN On ${list.length} ${list.length === 1 ? "Pick" : "Picks"} &middot; Only You See This</div>
      <div class="ct-diff-body">${list.map(({ g, p, espn, nflverse }) => `<div class="ct-diff-row">
        <span class="g">${logo(g.away, 15)}${g.away} @ ${logo(g.home, 15)}${g.home}</span>
        <span class="nm">${posTag(p.pos)} ${esc(p.name)}</span>
        ${resultTile({ res: espn }, "ESPN (Counting Now)")}
        ${resultTile({ res: nflverse }, "nflverse")}
        ${btn(g, p, nflverse, "Use nflverse")}${btn(g, p, espn, "Keep ESPN")}
      </div>`).join("")}</div>
    </div>`;
  }
  const MARK_BTNS = [["hit", "TD"], ["miss", "No TD"], ["void", "Out"], ["", "Auto"]];
  function markButtons(g, p) {
    const mark = (((API.marks || {})[g.id]) || {})[p.k] || "";
    return `<div class="ct-marks">${MARK_BTNS.map(([r, label]) => `<button type="button" class="ct-sm${mark === r ? " on" : ""}" data-act="mark" data-g="${esc(g.id)}" data-k="${esc(p.k)}" data-r="${r}">${label}</button>`).join("")}</div>`;
  }
  function clockOf(c, g) {
    const st = gameState(c, g);
    if (st === "final") return ["Final", st];
    if (st === "live") return [(liveGame(g) || {}).detail || "Live", st];
    const ms = Date.parse(g.kickoff);
    return [Number.isFinite(ms) ? `${etLabel(ms, { weekday: "short" })} ${etLabel(ms, { hour: "numeric", minute: "2-digit" })}` : slotOf(g), st];
  }
  function renderTrack(c) {
    const entries = API.entries || [];
    const tile = oddsTileFor(c);
    const owner = API.owner;
    const rows = [];
    for (const g of c.games) {
      const count = {};
      entries.forEach((e) => { const k = (e.picks || {})[g.id]; if (k) count[k] = (count[k] || 0) + 1; });
      const list = Object.keys(count).map((k) => playerOf(g, k)).filter(Boolean).sort((a, b) => count[b.k] - count[a.k] || a.odds - b.odds);
      if (!list.length) continue;
      const [clock, st] = clockOf(c, g);
      list.forEach((p, i) => {
        const pct = Math.round((100 * count[p.k]) / entries.length);
        rows.push(`<tr class="ct-trow${i === 0 ? " first" : ""}">
          ${i === 0 ? `<td rowspan="${list.length}" class="ct-tgame"><div class="ct-game">${logo(g.away)} ${g.away} <span class="at">@</span> ${logo(g.home)} ${g.home}</div><div class="od-tile ct-clock ${st}"><b>${esc(clock)}</b></div></td>` : ""}
          <td><div class="ct-tplayer">${logo(p.team, 16)} ${posTag(p.pos)}<span class="nm">${esc(p.name)}</span></div></td>
          <td>${tile(p.odds)}</td>
          <td><div class="od-tile"${rankScaleStyle(Math.max(1, 9 - Math.round(pct / 12.5)), 8)}><b>${count[p.k]}</b><small>${pct}%</small></div></td>
          <td>${resultTile(gradeInfo(c, g, p))}</td>
          ${owner ? `<td>${markButtons(g, p)}</td>` : ""}
        </tr>`);
      });
    }
    if (!rows.length) return `<p class="ct-graded">No entries this week.</p>`;
    return `<p class="ct-graded">${liveNote()} &middot; Refreshes Every 2 Minutes</p>
      <table class="data-table od-grid ct-track">
        <thead>
          <tr class="od-ggroups"><th rowspan="2" class="od-g3 od-gone">Game</th><th colspan="3" class="od-g0">Picked Players</th><th colspan="${owner ? 2 : 1}" class="od-g1">Anytime TD</th></tr>
          <tr class="od-glabels"><th class="od-gt od-g0">Player</th><th class="od-gt od-g0">Price</th><th class="od-gt od-g0">Picked By</th><th class="od-gt od-g1">Result</th>${owner ? `<th class="od-gt od-g1" title="Your result beats the feed and the morning's data. Auto goes back to them.">Set It (Only You)</th>` : ""}</tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
  }

  function picksRow(c, r, cols) {
    const tiles = r.rows.map(({ g, p, res }) => {
      if (!p) return `<div class="ct-pk"><div class="g">${g.away} @ ${g.home}</div><b>No Pick</b></div>`;
      const tag = res === "hit" ? `+${money(profit(p.odds))}` : res === "miss" ? "&minus;$10" : res === "void" ? "Didn't Play: $10 Back" : res === "live" ? "Playing: No TD Yet" : "Not Started";
      return `<div class="ct-pk ${res}"><div class="g">${logo(g.away, 13)}${g.away} @ ${logo(g.home, 13)}${g.home}</div><b>${esc(p.name)}</b><div class="r"><span>${fmtOdds(p.odds)}</span><span>${tag}</span></div></div>`;
    }).join("");
    return `<tr class="ct-picks"><td colspan="${cols}"><div class="ct-picks-grid">${tiles}</div></td></tr>`;
  }

  // ---------- Page ----------
  function render() {
    const root = $("ct-app");
    if (!API) return;
    const c = contest();
    if (!c && isPreview() && !dataDone) {
      root.innerHTML = `<p class="ct-graded">Loading this week's FanDuel prices&hellip;</p>`;
      return;
    }
    if (!c) {
      root.innerHTML = `<div class="ct-closed"><h2 class="ct-title"><span>$100</span> CONTEST</h2><p>${API.owner ? "No games left this week to build a contest from." : "The next $100 CONTEST opens soon. Check back after the video drops!"}</p></div>`;
      return;
    }
    if (tab === "track" && !isLocked()) tab = "picks";
    const tabs = `<div class="view-toggle ct-tabs">
      <button type="button" class="view-toggle-btn${tab === "picks" ? " active" : ""}" data-tab="picks">${isLocked() ? "My Picks" : "Make Picks"}</button>
      <button type="button" class="view-toggle-btn${tab === "board" ? " active" : ""}" data-tab="board">Leaderboard</button>
      ${isLocked() ? `<button type="button" class="view-toggle-btn${tab === "track" ? " active" : ""}" data-tab="track">Tracking</button>` : ""}</div>`;
    const start = STAKE * c.games.length;
    root.innerHTML = `<div class="ct-head">
        <h2 class="ct-title"><span>$100</span> CONTEST</h2>
        <span class="ct-week">Week ${c.week} &middot; ${c.games.length} Games</span>
        <button type="button" class="info-i" aria-expanded="false" aria-controls="ct-rules" title="Rules">i</button>
      </div>
      <p class="section-note info-note" id="ct-rules" hidden><b>Rules.</b> Free for every member, one entry per account. Pick ONE player in every game to score an anytime TD. Each pick is a $10 fake bet (${money(start)} in all) at the price shown, the same price for everyone: ${esc(c.book || BOOK)}'s, frozen when prices locked, even if the line moves. A hit pays $10 at that price; a miss loses the $10. A player who doesn't play: your $10 comes back. Change your picks as often as you like until <b>${lockLabel(c.lock_at)}</b>; then every entry locks and everyone's picks show on the Leaderboard. Highest bankroll after the last game wins $100. Ties: fewer correct picks wins, then the longest price that hit, then the $100 is split. TDs count live as they happen (ESPN), a miss counts once the game is final, and every result is double-checked against the official stats the morning after.</p>
      ${ownerBar(c)}
      ${diffBox(c)}
      ${strip(c)}
      ${tabs}
      <section id="ct-view">${tab === "picks" ? renderPicks(c) : tab === "track" ? renderTrack(c) : renderBoard(c)}</section>`;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: contest() && contest().id, picks }));
    } catch (e) {
      // private window: the picks just aren't remembered on this device
    }
  }
  function loadPicks() {
    const c = contest();
    picks = {};
    if (!c) return;
    if (API.me) picks = { ...API.me.picks };
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!isLocked() && d && d.id === c.id && d.picks) picks = { ...picks, ...d.picks };
    } catch (e) {
      // no draft
    }
    for (const g of c.games) if (picks[g.id] && !playerOf(g, picks[g.id])) delete picks[g.id];
    const next = isLocked() ? null : c.games.find((g) => !picks[g.id]);
    openGame = next ? next.id : null;
  }

  async function load() {
    try {
      const res = await fetch("/api/contest", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      API = await res.json();
    } catch (e) {
      $("ct-app").innerHTML = `<div class="ct-closed"><h2 class="ct-title"><span>$100</span> CONTEST</h2><p>Couldn't load the contest. Refresh the page to try again.</p></div>`;
      return false;
    }
    loadPicks();
    render();
    return true;
  }

  async function post(body) {
    const res = await fetch("/api/contest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let out = {};
    try {
      out = await res.json();
    } catch (e) {
      out = {};
    }
    return { ok: res.ok, error: out.error, body: out };
  }

  // Once locked, re-ask every 2 minutes while the page is on screen (the server asks ESPN at most that often).
  async function refresh() {
    if (!isLocked() || document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/contest", { cache: "no-store" });
      if (!res.ok) return;
      API = await res.json();
    } catch (e) {
      return; // the next try is in 2 minutes
    }
    render();
  }
  setInterval(refresh, 120e3);

  const ERRORS = { locked: "Picks are locked.", name: "Add a leaderboard name (2+ letters).", contact: "Add your Discord username or email so we can pay you.", picks: "Pick a player in every game.", "not open": "The contest isn't open yet." };

  $("ct-app").addEventListener("click", async (e) => {
    const c = contest();
    const t = e.target;
    const tabBtn = t.closest(".ct-tabs .view-toggle-btn");
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      openEntry = null;
      return render();
    }
    if (t.closest(".info-i")) {
      const n = $("ct-rules");
      n.hidden = !n.hidden;
      t.closest(".info-i").setAttribute("aria-expanded", String(!n.hidden));
      return;
    }
    const pl = t.closest(".ct-p");
    if (pl && !pl.disabled) {
      picks[pl.dataset.g] = pl.dataset.k;
      note = "";
      saveDraft();
      const next = c.games.find((g) => !picks[g.id]);
      openGame = next ? next.id : null;
      return render();
    }
    const act = t.closest("[data-act]");
    if (act) {
      const what = act.dataset.act;
      if (what === "enter") {
        act.disabled = true;
        const r = await post({ action: "enter", name: $("ct-name").value, contact: $("ct-contact").value, picks });
        note = r.ok ? "" : ERRORS[r.error] || "Couldn't save. Try again.";
        if (r.ok) {
          try { localStorage.removeItem(DRAFT_KEY); } catch (err) { /* nothing saved */ }
        }
        return r.ok ? load() : render();
      }
      if (what === "open" || what === "relock" || what === "clear") {
        const fresh = draftContest();
        if (!fresh) return alert("No games left this week to lock.");
        // Every game needs FanDuel prices or nobody could finish an entry (2026-11-21: the build
        // had none and the lock came back "bad contest").
        const empty = fresh.games.filter((g) => !g.players.length).map((g) => `${g.away} @ ${g.home}`);
        if (empty.length) return alert(`No FanDuel TD prices yet for: ${empty.join(", ")}. Nothing was locked. Try again after the next data update.`);
        if (what === "open" && !confirm(`Lock FanDuel's prices now and open the contest to members? ${fresh.games.length} games, picks lock ${lockLabel(fresh.lock_at)}.`)) return;
        if (what === "relock" && !confirm("Replace every price with FanDuel's price right now? Entries stay, but their prices change.")) return;
        if (what === "clear" && !confirm("Re-lock prices AND delete every entry? This can't be undone.")) return;
        const r = await post({ action: "open", contest: fresh, clear: what === "clear" });
        if (!r.ok) alert(`Couldn't lock prices (${r.error || "error"}).`);
        return load();
      }
      if (what === "mark") {
        act.disabled = true;
        const r = await post({ action: "mark", g: act.dataset.g, k: act.dataset.k, result: act.dataset.r || null });
        if (!r.ok) alert(`Couldn't save that result (${r.error || "error"}).`);
        else if (r.body && r.body.marks) API.marks = r.body.marks;
        return render();
      }
      if (what === "remove") {
        if (!confirm("Remove this entry? It can't be undone.")) return;
        await post({ action: "remove", uid: act.dataset.uid });
        return load();
      }
    }
    const lb = t.closest(".ct-lbrow");
    if (lb) {
      const k = lb.dataset.e;
      openEntry = openEntry === k ? null : k;
      return render();
    }
    const row = t.closest(".ct-row");
    if (row) {
      openGame = openGame === row.dataset.g ? null : row.dataset.g;
      render();
    }
  });

  // data.json is only needed for the owner's preview and for grading; the contest itself comes from /api/contest.
  const dataReady = fetch("data.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) DATA = d; })
    .catch(() => null)
    .finally(() => { dataDone = true; });
  Promise.all([dataReady, load()]).then(([, ok]) => { if (ok) { loadPicks(); render(); } });
  window.GMGContest = { compareEntries, rankEntries, scoreEntry, gradePick, easternToUtc, draftContest };
})();
