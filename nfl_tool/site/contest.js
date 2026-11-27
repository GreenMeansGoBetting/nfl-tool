// $100 CONTEST (the owner, 2026-11-20). TD picks, $10 of fake money on each, every player at the
// same price for everyone, frozen when the owner presses "Lock Prices" (the games, prices and lock
// times are saved by /api/contest in the login code).
// Two formats, picked by the owner before the lock:
//  - One Pick A Game (2026-11-20): any player in the game to score an anytime TD.
//  - Three Picks A Game (2026-11-24, Thanksgiving week): the game's First TD scorer (either team)
//    plus one anytime TD scorer from each team. A "slot" is one $10 pick (slotsOf).
// Each game locks at its own time (g.lock_at, 2026-11-24): in the Three format the first day's
// games lock at that day's first kickoff and everything after at the next kickoff (Wednesday
// stands alone, Thursday and Friday lock together), and members can enter until the last lock.
// A pick missing from a locked game is a $10 loss. Picks of a locked game show to everyone.
// Grading, first that applies (gradeInfo): the owner's hand result (Tracking tab); ESPN's final box
// score (through /api/contest): a TD counts the moment it shows, a miss only once ESPN calls the
// game final, a player missing from a final box score gets the $10 back; data.json the morning
// after only for a game ESPN never finished. First TD: ESPN's first scoring play that is a TD
// (live), data.json's first_td (morning). Where data.json disagrees with ESPN's final, the owner
// gets a list (diffBox) and settles each by hand. The page re-asks every 2 minutes once a game locks.
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
  let picks = {}; // slot id -> player key (this device, until submitted)
  let openSlot = null;
  let tab = "picks";
  let openEntry = null;
  let note = "";
  let dataDone = false;
  const draftOpts = { off: null, three: null, name: null }; // the owner's preview: games left out, format, name
  // The contest's name, saved with it (the owner, 2026-11-24: "Name it $100 Thanksgiving Contest").
  // "$100" shows in green. Thanksgiving week (a Thursday game Nov 22-28) is named for it by default.
  const DEFAULT_NAME = "$100 CONTEST";
  const nameOf = (c) => (c && c.title) || DEFAULT_NAME;
  function titleHtml(c) {
    const m = /^\$100\s+(.+)$/.exec(nameOf(c));
    return m ? `<span>$100</span> ${esc(m[1])}` : esc(nameOf(c));
  }
  function defaultName(games) {
    const tday = games.some((g) => { const d = new Date(g.kickoff); return g.day === "Thursday" && d.getUTCMonth() === 10 && d.getUTCDate() >= 22 && d.getUTCDate() <= 29; });
    return tday ? "$100 Thanksgiving Contest" : DEFAULT_NAME;
  }

  // ---------- Slots: one $10 pick each ----------
  const SLOT_CACHE = new WeakMap();
  function slotsOf(c) {
    if (SLOT_CACHE.has(c)) return SLOT_CACHE.get(c);
    const out = [];
    for (const g of c.games) {
      if (Array.isArray(g.first)) {
        out.push({ id: `${g.id}:F`, g, kind: "first", team: null, list: g.first, label: "First TD", short: "1st TD" });
        for (const [side, team] of [["A", g.away], ["H", g.home]]) {
          out.push({ id: `${g.id}:${side}`, g, kind: "any", team, list: g.players.filter((p) => p.team === team), label: `${team} Anytime TD`, short: `${team} TD` });
        }
      } else {
        out.push({ id: g.id, g, kind: "any", team: null, list: g.players, label: "Anytime TD", short: "TD" });
      }
    }
    SLOT_CACHE.set(c, out);
    return out;
  }
  const three = (c) => c.games.some((g) => Array.isArray(g.first));
  const gameSlots = (c, g) => slotsOf(c).filter((s) => s.g === g);
  const playerOf = (s, k) => s.list.find((p) => p.k === k);
  const lockOf = (c, g) => (Number.isFinite(g.lock_at) ? g.lock_at : c.lock_at);
  // The owner's next contest (2026-11-24: the owner saw only last week's, the page had no way to
  // start another). Once the saved contest has fully locked and this week's games make a different
  // one, the owner gets this week's preview; "Last Contest's Results" flips back. Members keep
  // seeing the saved contest until the owner locks the new one.
  let newDraft = null; // null = automatic, true / false = the owner's button
  function wantNew() {
    if (!API || !API.owner || !API.contest) return false;
    if (newDraft !== null) return newDraft;
    if (Date.now() < API.contest.lock_at) return false;
    const d = draftContest();
    return !!d && d.id !== API.contest.id;
  }
  const isPreview = () => !!(API && API.owner && (!API.contest || wantNew()));
  const saved = () => (isPreview() ? null : API && API.contest); // the contest members are in, unless previewing
  const contest = () => (isPreview() ? draftContest() : (API && API.contest) || null);
  const gameLocked = (c, g) => !!(saved() && Date.now() >= lockOf(c, g));
  const isLocked = () => !!(saved() && Date.now() >= saved().lock_at);
  const anyLocked = () => !!(saved() && saved().games.some((g) => gameLocked(saved(), g)));
  // Lock times in order, each with its games ("Wed", "Thu / Fri").
  function lockGroups(c) {
    const by = new Map();
    for (const g of c.games) {
      const at = lockOf(c, g);
      if (!by.has(at)) by.set(at, []);
      by.get(at).push(g);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([at, games]) => {
      const days = [...new Set(games.map((g) => (Number.isFinite(Date.parse(g.kickoff)) ? etLabel(Date.parse(g.kickoff), { weekday: "short" }) : String(g.day || "").slice(0, 3))))];
      return { at, games, days: days.join(" / ") };
    });
  }

  // ---------- The contest the owner would open now (from data.json) ----------
  function weekGames() {
    if (typeof DATA === "undefined" || !DATA || !Array.isArray(DATA.schedule)) return [];
    const week = DATA.current_week;
    const now = Date.now();
    return DATA.schedule
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
      .sort((a, b) => a.ms - b.ms);
  }
  // Thanksgiving week (2026-11-24, the owner: the Wednesday, Thursday and Friday games only): when
  // three or more games come before Saturday, only those are in by default. The owner's chips change it.
  const EARLY_DAYS = ["Tuesday", "Wednesday", "Thursday", "Friday"];
  function defaultOff(all) {
    const early = all.filter((g) => EARLY_DAYS.includes(g.weekday));
    return new Set(early.length >= 3 ? all.filter((g) => !EARLY_DAYS.includes(g.weekday)).map((g) => g.game_id) : []);
  }
  // First TD prices: FanDuel's only (the owner, 2026-11-24: "Keep FD"), from SmartStake's First TD
  // market (book_odds[game].props.first_td, Yes kept as "o"). A player's team and position come from
  // the anytime list (player_td_odds), which every First TD player is on; nobody else is listed.
  function fanduelFirst(g) {
    const rows = (((DATA.book_odds || {})[`${g.away}_${g.home}`] || {}).props || {}).first_td || {};
    const any = {};
    for (const team of [g.away, g.home]) for (const p of (DATA.player_td_odds || {})[team] || []) any[normName(p.name)] = { ...p, team };
    const out = [];
    for (const row of Object.values(rows)) {
      const fd = (row.q || []).find((q) => q[0] === "fanduel" && q[1] === "o");
      const p = any[normName(row.name)];
      if (!fd || !Number.isInteger(fd[3]) || !p || p.position === "DST") continue;
      out.push({ k: `${p.team}|${p.name}`, name: p.name, pos: p.position || "", team: p.team, odds: fd[3] });
    }
    return out;
  }
  function draftContest() {
    const all = weekGames();
    if (!all.length) return null;
    if (!draftOpts.off) draftOpts.off = defaultOff(all);
    const chosen = all.filter((g) => !draftOpts.off.has(g.game_id));
    if (!chosen.length) return null;
    const isThree = draftOpts.three == null ? chosen.length <= 6 : draftOpts.three;
    const games = chosen.map((g) => {
      const players = [];
      for (const team of [g.away, g.home]) {
        for (const p of (DATA.player_td_odds || {})[team] || []) {
          if (!Number.isInteger(p.fd) || p.position === "DST") continue;
          players.push({ k: `${team}|${p.name}`, name: p.name, pos: p.position || "", team, odds: p.fd });
        }
      }
      return { id: g.game_id, away: g.away, home: g.home, day: g.weekday, time: g.time, kickoff: new Date(g.ms).toISOString(), ms: g.ms, players, ...(isThree ? { first: fanduelFirst(g) } : {}) };
    });
    if (isThree) {
      // The first day's games lock at that day's first kickoff; every later game at the next kickoff.
      const firstDay = games[0].day;
      const early = games.filter((g) => g.day === firstDay);
      const rest = games.filter((g) => g.day !== firstDay);
      for (const g of early) g.lock_at = early[0].ms;
      for (const g of rest) g.lock_at = rest[0].ms;
    } else {
      // One Pick A Game: everything locks Sunday 1:00 PM ET (the first kickoff if there's no Sunday game).
      const sunday = games.find((g) => g.day === "Sunday");
      const lockDate = sunday ? DATA.schedule.find((s) => s.game_id === sunday.id).date : null;
      const at = lockDate ? easternToUtc(lockDate, "13:00") : games[0].ms;
      for (const g of games) g.lock_at = at;
    }
    for (const g of games) delete g.ms;
    const lock_at = Math.max(...games.map((g) => g.lock_at));
    const week = DATA.current_week;
    const title = (draftOpts.name == null ? defaultName(games) : draftOpts.name).trim() || DEFAULT_NAME;
    return { id: `${DATA.season}_${String(week).padStart(2, "0")}`, season: DATA.season, week, lock_at, book: BOOK, title, ...(isThree ? { first_book: BOOK } : {}), games };
  }

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
  const playedIn = (lg, p) => sameName(((lg.teams || {})[p.team] || {}).played || [], p.name);
  function liveAny(g, p) {
    const lg = liveGame(g);
    if (!lg || lg.state === "pre" || !lg.teams) return "pending";
    const box = lg.teams[p.team] || { tds: {}, played: [] };
    if (sameName(Object.keys(box.tds || {}), p.name)) return "hit";
    if (!lg.final) return "live";
    return playedIn(lg, p) ? "miss" : "void";
  }
  // ESPN's first TD of the game ({team, name}): him = hit; anyone else = miss (money back if he never played).
  function liveFirst(g, p) {
    const lg = liveGame(g);
    if (!lg || lg.state === "pre" || !lg.teams) return "pending";
    const f = lg.first;
    if (f) {
      if (f.team === p.team && sameName([f.name], p.name)) return "hit";
      return lg.final && !playedIn(lg, p) ? "void" : "miss";
    }
    if (!lg.final) return "live";
    return playedIn(lg, p) ? "miss" : "void"; // no TD in the game
  }
  function officialIn(c, team) {
    if (typeof DATA === "undefined" || !DATA) return false;
    const wk = String(c.week);
    const snaps = (DATA.player_snaps || {})[team] || {};
    const scored = ((((DATA.player_td_results || {})[wk] || (DATA.player_td_results || {})[c.week] || {})[team]) || {}).any_td || [];
    return Object.values(snaps).some((s) => s && s.w && s.w[wk] != null) || scored.length > 0;
  }
  // A miss / didn't-play waits for the team's snap counts that week; a TD counts from the TD list
  // alone. nflverse posts TDs hours before snap counts (Thanksgiving 2026: TDs in the 3:37 AM ET
  // build, snaps at 7:01 AM), and judging on TDs alone called every non-scorer "didn't play".
  function officialSnapsIn(c, team) {
    const wk = String(c.week);
    return Object.values((DATA.player_snaps || {})[team] || {}).some((s) => s && s.w && s.w[wk] != null);
  }
  function officialPlayed(c, p) {
    const wk = String(c.week);
    const me = normName(p.name);
    return Object.entries((DATA.player_snaps || {})[p.team] || {}).some(([n, s]) => normName(n) === me && s && s.w && s.w[wk] > 0);
  }
  function officialRes(c, team) {
    const wk = String(c.week);
    return (((DATA.player_td_results || {})[wk] || (DATA.player_td_results || {})[c.week] || {})[team]) || {};
  }
  function officialAny(c, g, p) {
    if (typeof DATA === "undefined" || !DATA || !officialIn(c, p.team)) return "pending";
    if ((officialRes(c, p.team).any_td || []).some((n) => normName(n) === normName(p.name))) return "hit";
    if (!officialSnapsIn(c, p.team)) return "pending";
    return officialPlayed(c, p) ? "miss" : "void";
  }
  // data.json keeps a game's first TD under the scorer's team (offense only).
  function officialFirst(c, g, p) {
    if (typeof DATA === "undefined" || !DATA || !(officialIn(c, g.away) || officialIn(c, g.home))) return "pending";
    if ((officialRes(c, p.team).first_td || []).some((n) => normName(n) === normName(p.name))) return "hit";
    if (!officialSnapsIn(c, p.team)) return "pending";
    return officialPlayed(c, p) ? "miss" : "void";
  }
  const liveGrade = (s, p) => (s.kind === "first" ? liveFirst : liveAny)(s.g, p);
  const officialGrade = (c, s, p) => (s.kind === "first" ? officialFirst : officialAny)(c, s.g, p);
  // { res: hit | miss | void | live (playing, not yet) | pending, src: mark | official | live }
  // ESPN's final stands; nflverse (the morning's data.json) never replaces it, only fills a game
  // ESPN never finished, and any disagreement goes to the owner (diffs), who settles it by hand
  // (the owner, 2026-11-22: "instead of an auto replace ... an alert that says if there's differences").
  function gradeInfo(c, s, p) {
    const mark = ((API && API.marks) || {})[s.id];
    if (mark && mark[p.k]) return { res: mark[p.k], src: "mark" };
    const lg = liveGame(s.g);
    if (lg && lg.final) return { res: liveGrade(s, p), src: "live" };
    const res = officialGrade(c, s, p);
    if (res !== "pending") return { res, src: "official" };
    return { res: liveGrade(s, p), src: "live" };
  }
  const gradePick = (c, s, p) => gradeInfo(c, s, p).res;
  // Picked players whose ESPN final and nflverse result differ, with no hand result yet.
  function diffs(c) {
    const out = [];
    for (const s of slotsOf(c)) {
      const lg = liveGame(s.g);
      if (!lg || !lg.final) continue;
      const keys = new Set((API.entries || []).map((e) => (e.picks || {})[s.id]).filter(Boolean));
      for (const k of keys) {
        const p = playerOf(s, k);
        if (!p || (((API.marks || {})[s.id]) || {})[k]) continue;
        const espn = liveGrade(s, p);
        const nflverse = officialGrade(c, s, p);
        if (nflverse !== "pending" && nflverse !== espn) out.push({ s, p, espn, nflverse });
      }
    }
    return out;
  }
  // "final" once the morning's data has the game or ESPN calls it final; "live" while it's on.
  function gameState(c, g) {
    const lg = liveGame(g);
    if (officialIn(c, g.away) || officialIn(c, g.home) || (lg && lg.final)) return "final";
    return lg && lg.state !== "pre" ? "live" : "pre";
  }
  // An entry's picks are only known for games the viewer can see (the server hides open games'
  // picks from other members). A locked game with no pick = a $10 loss (the owner, 2026-11-24).
  function scoreEntry(c, e) {
    const slots = slotsOf(c);
    const start = STAKE * slots.length;
    let bank = start, hits = 0, graded = 0, longest = null;
    const rows = slots.map((s) => {
      const k = (e.picks || {})[s.id];
      const p = k ? playerOf(s, k) : null;
      if (!p) {
        if (e.picks && gameLocked(c, s.g)) {
          bank -= STAKE;
          graded += 1;
          return { s, p: null, res: "nopick" };
        }
        return { s, p: null, res: "pending" };
      }
      const res = gradePick(c, s, p);
      if (res === "hit") {
        bank += profit(p.odds);
        hits += 1;
        if (!longest || p.odds > longest.odds) longest = p;
      } else if (res === "miss") bank -= STAKE;
      if (res !== "pending" && res !== "live") graded += 1;
      return { s, p, res };
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
  // Price tiles colored against the same market's prices (First TD runs much longer than anytime).
  function oddsTileFor(c) {
    const by = { first: [], any: [] };
    for (const s of slotsOf(c)) for (const p of s.list) by[s.kind].push(p.odds);
    by.first.sort((a, b) => a - b);
    by.any.sort((a, b) => a - b);
    return (o, kind = "any", sub = "") => {
      const all = by[kind];
      const rank = all.findIndex((x) => x >= o) + 1;
      return `<div class="od-tile"${rankScaleStyle(rank, all.length)}><b>${fmtOdds(o)}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    };
  }
  const posTag = (pos) => `<span class="ct-pos" style="--ph:${POS_HUE[pos] ?? 210}">${esc(pos || "–")}</span>`;
  const priceNote = (c) => (three(c) ? `${esc(c.book || BOOK)} Anytime TD &middot; ${esc(c.first_book || BOOK)} First TD` : `${esc(c.book || BOOK)} Anytime TD`);

  function strip(c) {
    const slots = slotsOf(c);
    const n = slots.filter((s) => picks[s.id]).length;
    const start = STAKE * slots.length;
    const best = slots.reduce((sum, s) => { const p = playerOf(s, picks[s.id]); return sum + (p ? profit(p.odds) : 0); }, 0);
    const priced = saved() ? `Locked ${etLabel(saved().priced_at, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Not Locked Yet";
    const groups = lockGroups(c);
    const locks = groups.map((grp) => {
      const done = saved() && Date.now() >= grp.at;
      return `<div class="od-tile ct-lock"><small>${groups.length > 1 ? `${esc(grp.days)} Picks Lock` : "Picks Lock"}</small><b>${done ? "Locked" : lockLabel(grp.at)}</b></div>`;
    }).join("");
    return `<div class="ct-strip">
      <div class="od-tile"><small>Bankroll</small><b>${money(start)}</b></div>
      <div class="od-tile"${rankScaleStyle(n === slots.length ? 1 : 6, 8)}><small>Picked</small><b>${n} of ${slots.length}</b></div>
      <div class="od-tile"><small>On The Line</small><b>${money(n * STAKE)}</b></div>
      <div class="od-tile"${rankScaleStyle(1, 8)}><small>If Every Pick Hits</small><b>${money(start + best)}</b></div>
      <div class="od-tile ct-price"><small>Prices: ${priceNote(c)}</small><b>${priced}</b></div>
      ${locks}
    </div>`;
  }

  function ownerBar(c) {
    if (!API.owner) return "";
    if (isPreview()) {
      const thin = c.games.filter((g) => gameSlots(c, g).some((s) => s.list.length < (s.kind === "first" ? 6 : 2))).map((g) => `${g.away} @ ${g.home}`);
      const all = weekGames();
      const chips = all.map((g) => `<button type="button" class="ct-chip${draftOpts.off && draftOpts.off.has(g.game_id) ? "" : " on"}" data-act="game" data-id="${esc(g.game_id)}">${g.away} @ ${g.home} <small>${esc(g.weekday.slice(0, 3))}</small></button>`).join("");
      const isThree = three(c);
      return `<div class="ct-ownerbar"><b>Only You See This.</b> Members can't enter until you lock prices. Every price below is FanDuel's right now (this build).
        <div class="ct-ownerrow"><span class="ct-olabel">Name</span><input id="ct-cname" maxlength="40" value="${esc(nameOf(c))}"></div>
        <div class="ct-ownerrow"><span class="ct-olabel">Games</span>${chips}</div>
        <div class="ct-ownerrow"><span class="ct-olabel">Format</span>
          <button type="button" class="ct-chip${isThree ? "" : " on"}" data-act="format" data-three="0">One Pick A Game</button>
          <button type="button" class="ct-chip${isThree ? " on" : ""}" data-act="format" data-three="1">Three A Game: First TD + One Per Team</button></div>
        ${thin.length ? `<span class="ct-warn">Few Prices Yet: ${esc(thin.join(", "))}</span>` : ""}
        <button type="button" class="ct-go" data-act="open">Lock FanDuel Prices &amp; Open Contest</button>
        ${API.contest ? `<button type="button" class="ct-sm" data-act="old">Show Last Contest's Results (Members Still See It)</button>` : ""}</div>`;
    }
    return `<div class="ct-ownerbar"><b>Only You See This.</b> Prices locked ${esc(etLabel(c.priced_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} ET, ${API.entries.length} ${API.entries.length === 1 ? "entry" : "entries"}.
      ${isLocked() ? `<button type="button" class="ct-sm" data-act="new">Start This Week's Contest</button>` : ""}
      ${anyLocked() && Object.keys(API.marks || {}).length ? `<button type="button" class="ct-sm ct-danger" data-act="unmark">Reset Every Hand Result To Auto</button>` : ""}
      ${anyLocked() ? "" : `<button type="button" class="ct-sm" data-act="relock">Re-Lock Prices Now (Keeps Entries)</button><button type="button" class="ct-sm ct-danger" data-act="clear">Re-Lock And Clear All Entries</button>`}</div>`;
  }

  function teamBox(s, team, tile, chosen, editable) {
    const list = s.list.filter((p) => p.team === team).sort((a, b) => a.odds - b.odds);
    return `<div class="ct-team" style="--tc:${TEAM_COLORS[team] || "#888"}">
      <div class="ct-team-head">${logo(team, 20)} ${esc(TEAM_NAMES[team] || team)}${s.kind === "first" ? " <span class=\"ct-kind\">First TD</span>" : ""}</div>
      <div class="ct-plist">${list.length ? list.map((p) => `
        <button type="button" class="ct-p${chosen === p.k ? " sel" : ""}" data-s="${esc(s.id)}" data-k="${esc(p.k)}"${editable ? "" : " disabled"}>
          ${posTag(p.pos)}<span class="nm">${esc(p.name)}</span>${tile(p.odds, s.kind)}
          <span class="ct-win">+${money(profit(p.odds))}<small>If He Scores</small></span>
        </button>`).join("") : `<div class="ct-none">No Prices</div>`}</div>
    </div>`;
  }

  function pickCell(c, s, tile, editable, missed) {
    const p = playerOf(s, picks[s.id]);
    const res = p && gameLocked(c, s.g) && !isPreview() ? gradePick(c, s, p) : missed ? "miss" : "";
    const btn = p
      ? `<div class="ct-pickbtn set ${res}${openSlot === s.id ? " open" : ""}" data-s="${esc(s.id)}">${s.team ? "" : `${logo(p.team, 16)} `}${posTag(p.pos)}<span class="nm">${esc(p.name)}</span>${editable ? `<span class="car">&#9662;</span>` : ""}</div>`
      : `<div class="ct-pickbtn ${missed ? "set miss" : "empty"}${openSlot === s.id ? " open" : ""}" data-s="${esc(s.id)}"><span>${editable ? "Pick A Player" : missed ? "Missed: &minus;$10" : "No Pick"}</span>${editable ? `<span class="car">&#9662;</span>` : ""}</div>`;
    const price = p ? tile(p.odds, s.kind, `Wins ${money(profit(p.odds))}`) : `<div class="od-tile"><b>&ndash;</b></div>`;
    return `<td>${btn}</td><td>${price}</td>`;
  }

  function renderPicks(c) {
    const tile = oddsTileFor(c);
    const isThree = three(c);
    const groups = lockGroups(c);
    let slot = "";
    const rows = [];
    const cols = isThree ? 8 : 4;
    for (const g of c.games) {
      const s0 = slotOf(g);
      if (s0 !== slot) {
        slot = s0;
        rows.push(`<tr><td colspan="${cols}" class="ct-slot">${esc(s0)}</td></tr>`);
      }
      const editable = !gameLocked(c, g);
      const missed = !editable && !!API.me;
      const at = lockOf(c, g);
      const lockTile = editable
        ? `<div class="od-tile ct-locktile"><b>${lockLabel(at)}</b></div>`
        : `<div class="od-tile ct-locktile done"><b>Locked</b></div>`;
      rows.push(`<tr class="ct-row" data-g="${esc(g.id)}">
        <td><div class="ct-game">${logo(g.away)} ${g.away} <span class="at">@</span> ${logo(g.home)} ${g.home}</div></td>
        ${gameSlots(c, g).map((s) => pickCell(c, s, tile, editable, missed && !picks[s.id])).join("")}
        ${isThree ? `<td>${lockTile}</td>` : ""}
      </tr>`);
      const open = gameSlots(c, g).find((s) => s.id === openSlot);
      if (open) {
        const teams = open.team ? [open.team] : [g.away, g.home];
        rows.push(`<tr class="ct-drop"><td colspan="${cols}"><div class="ct-drop-inner">${teams.map((t) => teamBox(open, t, tile, picks[open.id], editable)).join("")}</div></td></tr>`);
      }
    }
    const slots = slotsOf(c);
    const me = API.me;
    const d = API.defaults || {};
    const changed = !me || slots.some((s) => !gameLocked(c, s.g) && (me.picks || {})[s.id] !== picks[s.id]);
    const open = slots.filter((s) => !gameLocked(c, s.g));
    const nextLock = groups.find((grp) => !saved() || Date.now() < grp.at);
    let submit = "";
    if (isPreview()) submit = `<div class="ct-submit"><span class="ct-saved ct-info">Preview: entries open once you lock prices.</span></div>`;
    else if (isLocked()) submit = me ? `<div class="ct-submit"><span class="ct-saved">&#128274; Your Entry Is Locked In As &ldquo;${esc(me.name)}&rdquo;.</span></div>` : `<div class="ct-submit"><span class="ct-saved ct-info">&#128274; Picks Locked At ${lockLabel(c.lock_at)}. You Did Not Enter This Week.</span></div>`;
    else {
      const need = open.filter((s) => !picks[s.id]).length;
      const late = !me && slots.length - open.length;
      submit = `<div class="ct-submit">
        <label>Name On The Leaderboard<input id="ct-name" maxlength="30" value="${esc(me ? me.name : d.name)}" placeholder="Your name"></label>
        <label>Discord Username Or Email (Only GMG Sees This)<input id="ct-contact" maxlength="100" value="${esc(me ? me.contact : d.contact)}" placeholder="So we can pay you if you win"></label>
        <button type="button" class="ct-go" data-act="enter"${need ? " disabled" : ""}>${need ? `Pick ${need} More To Submit` : me ? "Update Entry" : "Submit Entry"}</button>
        ${late ? `<span class="ct-saved ct-warnmsg">The Locked ${late === 1 ? "Pick Counts" : `${late} Picks Count`} As ${late === 1 ? "A Loss" : "Losses"} (&minus;${money(late * STAKE)}).</span>` : ""}
        ${me && !changed ? `<span class="ct-saved">&#10003; Entry Saved. Change It Any Time Before ${lockLabel(nextLock ? nextLock.at : c.lock_at)}.</span>` : ""}
        ${me && changed ? `<span class="ct-saved ct-warnmsg">Changes Not Saved Yet: Press Update Entry.</span>` : ""}
        ${note ? `<span class="ct-saved ct-warnmsg">${esc(note)}</span>` : ""}
      </div>`;
    }
    const anyEditable = c.games.some((g) => !gameLocked(c, g));
    const head = isThree
      ? `<tr class="od-ggroups"><th rowspan="2" class="od-g3 od-gone">Game</th><th colspan="2" class="od-g2">First TD &middot; Either Team</th><th colspan="4" class="od-g0">Anytime TD &middot; One Per Team</th><th rowspan="2" class="od-g1 od-gone">Locks</th></tr>
         <tr class="od-glabels"><th class="od-gt od-g2">Player ${anyEditable ? "(Click To Pick)" : ""}</th><th class="od-gt od-g2">Price</th><th class="od-gt od-g0">Away Team</th><th class="od-gt od-g0">Price</th><th class="od-gt od-g0">Home Team</th><th class="od-gt od-g0">Price</th></tr>`
      : `<tr class="od-ggroups"><th rowspan="2" class="od-g3 od-gone">Game</th><th colspan="2" class="od-g0">Your Pick &middot; $10 Each</th></tr>
         <tr class="od-glabels"><th class="od-gt od-g0">Player ${anyEditable ? "(Click To Pick)" : ""}</th><th class="od-gt od-g0">Price</th></tr>`;
    return `<table class="data-table od-grid ct-games${isThree ? " ct-three" : ""}"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>${submit}`;
  }

  // An entry's own key, so an opened row stays open when the live ranking reshuffles.
  const ekey = (e) => `${e.name}|${e.updated}`;
  function hiddenNote(c) {
    const next = lockGroups(c).find((grp) => Date.now() < grp.at);
    return next ? `${esc(next.days)} Picks Show At ${lockLabel(next.at)}` : "";
  }
  function renderBoard(c) {
    const entries = API.entries || [];
    if (isPreview()) return `<p class="ct-graded">The Leaderboard fills in once you lock prices and members enter.</p>`;
    if (!entries.length) return `<p class="ct-graded">No entries yet.</p>`;
    const owner = API.owner;
    if (!anyLocked()) {
      return `<p class="ct-graded">${entries.length} ${entries.length === 1 ? "Entry" : "Entries"} &middot; Picks Show At ${lockLabel(lockGroups(c)[0].at)}</p>
        <table class="data-table od-grid ct-lb">
          <thead><tr class="od-ggroups"><th class="od-g0 od-gone">#</th><th class="od-g0 od-gone">Entry</th><th class="od-g0 od-gone">Entered</th><th class="od-g0 od-gone">Picks</th>${owner ? `<th class="od-g2 od-gone">Contact (Only You)</th><th class="od-g2 od-gone"></th>` : ""}</tr></thead>
          <tbody>${entries.map((e, i) => `<tr class="${owner ? "ct-lbrow" : ""}${openEntry === ekey(e) ? " open" : ""}" data-e="${esc(ekey(e))}">
            <td><div class="od-tile ct-rank">${i + 1}</div></td>
            <td><div class="od-tile ct-name">${esc(e.name)}${e.mine ? " (You)" : ""}</div></td>
            <td><div class="od-tile"><b>${esc(etLabel(e.updated, { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b></div></td>
            <td><div class="ct-hidden">&#128274; Hidden Until ${lockLabel(lockGroups(c)[0].at)}</div></td>
            ${owner ? `<td><div class="ct-owner">${esc(e.contact)}</div></td><td><button type="button" class="ct-sm ct-danger" data-act="remove" data-uid="${esc(e.uid)}">Remove</button></td>` : ""}
          </tr>${owner && openEntry === ekey(e) ? picksRow(c, scoreEntry(c, e), 6) : ""}`).join("")}</tbody>
        </table>`;
    }
    const ranked = rankEntries(c, entries);
    const done = c.games.filter((g) => gameState(c, g) === "final").length;
    const graded = c.games.some((g) => gameState(c, g) !== "pre");
    const n = slotsOf(c).length;
    const body = ranked.map((r) => `<tr class="ct-lbrow${openEntry === ekey(r) ? " open" : ""}" data-e="${esc(ekey(r))}">
        <td><div class="od-tile ct-rank${r.rank === 1 && graded ? " gold" : ""}">${r.rank}</div></td>
        <td><div class="od-tile ct-name">${esc(r.name)}${r.mine ? " (You)" : ""}</div></td>
        <td><div class="od-tile"${graded ? rankScaleStyle(ranked.filter((x) => x.bank > r.bank).length + 1, ranked.length) : ""}><b>${money(r.bank)}</b><small>${r.bank >= r.start ? "+" : "&minus;"}${money(Math.abs(r.bank - r.start))}</small></div></td>
        <td><div class="od-tile"><b>${r.hits} of ${r.graded}</b>${r.graded < n ? `<small>${n - r.graded} To Go</small>` : ""}</div></td>
        <td><div class="od-tile">${r.longest ? `<b>${fmtOdds(r.longest.odds)}</b><small>${esc(r.longest.name)}</small>` : "<b>&ndash;</b>"}</div></td>
        ${owner ? `<td><div class="ct-owner">${esc(r.contact)}</div></td>` : ""}
      </tr>${openEntry === ekey(r) ? picksRow(c, r, owner ? 6 : 5) : ""}`).join("");
    const most = slotsOf(c).filter((s) => gameLocked(c, s.g)).map((s) => {
      const count = {};
      entries.forEach((e) => { const k = (e.picks || {})[s.id]; if (k) count[k] = (count[k] || 0) + 1; });
      const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      return top ? { s, p: playerOf(s, top[0]), pct: Math.round((100 * top[1]) / entries.length) } : null;
    }).filter((m) => m && m.p);
    const hidden = hiddenNote(c);
    return `<p class="ct-graded">${done} Of ${c.games.length} Games Final &middot; ${hidden ? `${hidden} &middot; ` : ""}${liveNote()}</p>
      <div class="ct-board">
        <table class="data-table od-grid ct-lb">
          <thead>
            <tr class="od-ggroups"><th rowspan="2" class="od-g0 od-gone">#</th><th rowspan="2" class="od-g0 od-gone">Entry (Click For Picks)</th><th colspan="3" class="od-g1">Results</th>${owner ? `<th rowspan="2" class="od-g2 od-gone">Contact<br>(Only You)</th>` : ""}</tr>
            <tr class="od-glabels"><th class="od-gt od-g1">Bankroll</th><th class="od-gt od-g1">Hits</th><th class="od-gt od-g1">Longest Hit</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        ${most.length ? `<div class="ct-box">
          <div class="ct-box-title">Most Picked</div>
          <div class="ct-box-body">${most.map((m) => `<div class="ct-mp"><span class="g">${logo(m.p.team, 15)}${m.s.g.away} @ ${m.s.g.home}${three(c) ? ` <i>${esc(m.s.short)}</i>` : ""}</span><span class="nm">${esc(m.p.name)}</span><div class="od-tile"${rankScaleStyle(Math.max(1, 9 - Math.round(m.pct / 12.5)), 8)}><b>${m.pct}%</b></div></div>`).join("")}</div>
        </div>` : ""}
      </div>`;
  }

  // ---------- Tracking (after a lock): every picked player, game by game, live ----------
  function liveNote() {
    const f = API && API.live && API.live.fetched;
    if (!f) return "Live TDs Start At Kickoff &middot; Double-Checked The Morning After";
    const err = API.live.error ? " (ESPN Didn't Answer, Trying Again)" : "";
    return `Live TDs From ESPN, Updated ${esc(etLabel(f, { hour: "numeric", minute: "2-digit" }))} ET${err} &middot; Double-Checked The Morning After`;
  }
  const RESULT_LOOK = { hit: ["Scored", 1], miss: ["No TD", 8], void: ["Didn't Play", 0], live: ["No TD Yet", 0], pending: ["Not Started", 0] };
  const FIRST_LOOK = { hit: ["Scored First", 1], miss: ["Not First", 8], live: ["No TD Yet", 0] };
  const SOURCE = { mark: "Set By GMG", official: "Official", live: "Live" };
  function resultTile(info, note, kind) {
    const [label, rank] = (kind === "first" && FIRST_LOOK[info.res]) || RESULT_LOOK[info.res] || RESULT_LOOK.pending;
    const src = note || (info.res === "pending" ? "" : SOURCE[info.src]);
    return `<div class="od-tile ct-res ${info.res}"${rank ? rankScaleStyle(rank, 8) : ""}><b>${label}</b>${src ? `<small>${src}</small>` : ""}</div>`;
  }
  const slotTag = (c, s) => (three(c) ? `<span class="ct-slottag${s.kind === "first" ? " first" : ""}">${esc(s.short)}</span>` : "");
  // The owner's alert: every pick where the morning's nflverse data disagrees with ESPN's final.
  function diffBox(c) {
    if (!API.owner || !anyLocked()) return "";
    const list = diffs(c);
    if (!list.length) return "";
    const btn = (s, p, r, label) => `<button type="button" class="ct-sm" data-act="mark" data-s="${esc(s.id)}" data-k="${esc(p.k)}" data-r="${r}">${label}</button>`;
    return `<div class="ct-diff">
      <div class="ct-diff-title">nflverse Disagrees With ESPN On ${list.length} ${list.length === 1 ? "Pick" : "Picks"} &middot; Only You See This</div>
      <div class="ct-diff-body">${list.map(({ s, p, espn, nflverse }) => `<div class="ct-diff-row">
        <span class="g">${logo(s.g.away, 15)}${s.g.away} @ ${logo(s.g.home, 15)}${s.g.home}</span>
        <span class="nm">${slotTag(c, s)}${posTag(p.pos)} ${esc(p.name)}</span>
        ${resultTile({ res: espn }, "ESPN (Counting Now)", s.kind)}
        ${resultTile({ res: nflverse }, "nflverse", s.kind)}
        ${btn(s, p, nflverse, "Use nflverse")}${btn(s, p, espn, "Keep ESPN")}
      </div>`).join("")}</div>
    </div>`;
  }
  const MARK_BTNS = [["hit", "TD"], ["miss", "No TD"], ["void", "Out"], ["", "Auto"]];
  function markButtons(s, p) {
    const mark = (((API.marks || {})[s.id]) || {})[p.k] || "";
    return `<div class="ct-marks">${MARK_BTNS.map(([r, label]) => `<button type="button" class="ct-sm${mark === r ? " on" : ""}" data-act="mark" data-s="${esc(s.id)}" data-k="${esc(p.k)}" data-r="${r}">${s.kind === "first" && r === "hit" ? "1st TD" : label}</button>`).join("")}</div>`;
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
    const isThree = three(c);
    const rows = [];
    for (const g of c.games) {
      if (!gameLocked(c, g)) continue;
      const list = [];
      for (const s of gameSlots(c, g)) {
        const count = {};
        entries.forEach((e) => { const k = (e.picks || {})[s.id]; if (k) count[k] = (count[k] || 0) + 1; });
        Object.keys(count).map((k) => playerOf(s, k)).filter(Boolean)
          .sort((a, b) => count[b.k] - count[a.k] || a.odds - b.odds)
          .forEach((p) => list.push({ s, p, n: count[p.k] }));
      }
      if (!list.length) continue;
      const [clock, st] = clockOf(c, g);
      const lg = liveGame(g);
      const firstNote = isThree && lg && lg.first ? `<div class="ct-first">1st TD: ${esc(lg.first.name)}</div>` : "";
      list.forEach(({ s, p, n }, i) => {
        const pct = Math.round((100 * n) / entries.length);
        rows.push(`<tr class="ct-trow${i === 0 ? " first" : ""}">
          ${i === 0 ? `<td rowspan="${list.length}" class="ct-tgame"><div class="ct-game">${logo(g.away)} ${g.away} <span class="at">@</span> ${logo(g.home)} ${g.home}</div><div class="od-tile ct-clock ${st}"><b>${esc(clock)}</b></div>${firstNote}</td>` : ""}
          <td><div class="ct-tplayer">${slotTag(c, s)}${logo(p.team, 16)} ${posTag(p.pos)}<span class="nm">${esc(p.name)}</span></div></td>
          <td>${tile(p.odds, s.kind)}</td>
          <td><div class="od-tile"${rankScaleStyle(Math.max(1, 9 - Math.round(pct / 12.5)), 8)}><b>${n}</b><small>${pct}%</small></div></td>
          <td>${resultTile(gradeInfo(c, s, p), "", s.kind)}</td>
          ${owner ? `<td>${markButtons(s, p)}</td>` : ""}
        </tr>`);
      });
    }
    if (!rows.length) return `<p class="ct-graded">No entries this week.</p>`;
    return `<p class="ct-graded">${liveNote()} &middot; Refreshes Every 2 Minutes</p>
      <table class="data-table od-grid ct-track">
        <thead>
          <tr class="od-ggroups"><th rowspan="2" class="od-g3 od-gone">Game</th><th colspan="3" class="od-g0">Picked Players</th><th colspan="${owner ? 2 : 1}" class="od-g1">${isThree ? "Results" : "Anytime TD"}</th></tr>
          <tr class="od-glabels"><th class="od-gt od-g0">Player</th><th class="od-gt od-g0">Price</th><th class="od-gt od-g0">Picked By</th><th class="od-gt od-g1">Result</th>${owner ? `<th class="od-gt od-g1" title="Your result beats the feed and the morning's data. Auto goes back to them.">Set It (Only You)</th>` : ""}</tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>`;
  }

  function picksRow(c, r, cols) {
    const hidden = hiddenNote(c);
    const tiles = r.rows.map(({ s, p, res }) => {
      const head = `<div class="g">${logo(s.g.away, 13)}${s.g.away} @ ${logo(s.g.home, 13)}${s.g.home}${three(c) ? ` <i>${esc(s.short)}</i>` : ""}</div>`;
      if (res === "nopick") return `<div class="ct-pk miss">${head}<b>No Pick</b><div class="r"><span></span><span>&minus;$10</span></div></div>`;
      if (!p) return `<div class="ct-pk">${head}<b>${r.picks && !gameLocked(c, s.g) && !r.mine && !API.owner ? "Hidden" : "No Pick"}</b>${!gameLocked(c, s.g) && hidden && !r.mine && !API.owner ? `<div class="r"><span>&#128274;</span><span>Until ${lockLabel(lockOf(c, s.g))}</span></div>` : ""}</div>`;
      const tag = res === "hit" ? `+${money(profit(p.odds))}` : res === "miss" ? "&minus;$10" : res === "void" ? "Didn't Play: $10 Back" : res === "live" ? "Playing: No TD Yet" : "Not Started";
      return `<div class="ct-pk ${res}">${head}<b>${esc(p.name)}</b><div class="r"><span>${fmtOdds(p.odds)}</span><span>${tag}</span></div></div>`;
    }).join("");
    return `<tr class="ct-picks"><td colspan="${cols}"><div class="ct-picks-grid${three(c) ? " three" : ""}">${tiles}</div></td></tr>`;
  }

  // ---------- Page ----------
  function rulesText(c) {
    const start = STAKE * slotsOf(c).length;
    const groups = lockGroups(c);
    const locks = groups.length > 1 ? groups.map((grp) => `${esc(grp.days)} games lock at <b>${lockLabel(grp.at)}</b>`).join("; ") : `every pick locks at <b>${lockLabel(c.lock_at)}</b>`;
    const common = `A hit pays $10 at that price; a miss loses the $10. A player who doesn't play: your $10 comes back. Highest bankroll after the last game wins $100. Ties: fewer correct picks wins, then the longest price that hit, then the $100 is split. TDs count live as they happen (ESPN), a miss counts once the game is final, and every result is double-checked against the official stats the morning after.`;
    if (three(c)) {
      return `<b>Rules.</b> Free for every member, one entry per account. In every game make THREE picks: the game's <b>First TD</b> scorer (either team), plus one player from <b>each team</b> to score an anytime TD (the same player can be your First TD and anytime pick). Each pick is a $10 fake bet (${money(start)} in all) at the price shown, the same price for everyone, frozen when prices locked, even if the line moves. Anytime prices are ${esc(c.book || BOOK)}'s, First TD prices ${esc(c.first_book || BOOK)}'s. A First TD pick wins only if he scores the game's very first TD; a defensive or special teams TD first means every First TD pick in that game loses. Change your picks until each game locks: ${locks}. You can enter until the last lock, but any game that already locked counts as a $10 loss for each pick you missed. Picks for a game show on the Leaderboard once it locks. ${common}`;
    }
    return `<b>Rules.</b> Free for every member, one entry per account. Pick ONE player in every game to score an anytime TD. Each pick is a $10 fake bet (${money(start)} in all) at the price shown, the same price for everyone: ${esc(c.book || BOOK)}'s, frozen when prices locked, even if the line moves. Change your picks as often as you like until <b>${lockLabel(c.lock_at)}</b>; then every entry locks and everyone's picks show on the Leaderboard. ${common}`;
  }
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
      if (isPreview() && weekGames().length) root.innerHTML += ownerBar({ games: [] });
      return;
    }
    if (tab === "track" && !anyLocked()) tab = "picks";
    document.title = `GMG's NFL Suite — ${nameOf(c)}`;
    const tabs = `<div class="view-toggle ct-tabs">
      <button type="button" class="view-toggle-btn${tab === "picks" ? " active" : ""}" data-tab="picks">${isLocked() ? "My Picks" : "Make Picks"}</button>
      <button type="button" class="view-toggle-btn${tab === "board" ? " active" : ""}" data-tab="board">Leaderboard</button>
      ${anyLocked() ? `<button type="button" class="view-toggle-btn${tab === "track" ? " active" : ""}" data-tab="track">Tracking</button>` : ""}</div>`;
    root.innerHTML = `<div class="ct-head">
        <h2 class="ct-title">${titleHtml(c)}</h2>
        <span class="ct-week">Week ${c.week} &middot; ${c.games.length} Games${three(c) ? ` &middot; ${slotsOf(c).length} Picks` : ""}</span>
        <button type="button" class="info-i" aria-expanded="false" aria-controls="ct-rules" title="Rules">i</button>
      </div>
      <p class="section-note info-note" id="ct-rules" hidden>${rulesText(c)}</p>
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
  const nextOpen = (c) => slotsOf(c).find((s) => !gameLocked(c, s.g) && !picks[s.id]);
  function loadPicks() {
    const c = contest();
    picks = {};
    if (!c) return;
    if (API.me) picks = { ...API.me.picks };
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && d.id === c.id && d.picks) {
        for (const s of slotsOf(c)) if (!gameLocked(c, s.g) && d.picks[s.id]) picks[s.id] = d.picks[s.id];
      }
    } catch (e) {
      // no draft
    }
    for (const s of slotsOf(c)) if (picks[s.id] && !playerOf(s, picks[s.id])) delete picks[s.id];
    for (const k of Object.keys(picks)) if (!slotsOf(c).some((s) => s.id === k)) delete picks[k];
    const next = nextOpen(c);
    openSlot = next ? next.id : null;
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

  // Once a game locks, re-ask every 2 minutes while the page is on screen (the server asks ESPN at
  // most that often). Draws again only while nobody is mid-pick (a member entering Thursday picks
  // on Wednesday night keeps what he typed).
  async function refresh() {
    if (!anyLocked() || document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/contest", { cache: "no-store" });
      if (!res.ok) return;
      const got = await res.json();
      const mine = picks;
      API = got;
      picks = mine;
    } catch (e) {
      return; // the next try is in 2 minutes
    }
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    render();
  }
  setInterval(refresh, 120e3);

  const ERRORS = { locked: "Picks are locked.", name: "Add a leaderboard name (2+ letters).", contact: "Add your Discord username or email so we can pay you.", picks: "Make every pick in the games still open.", "not open": "The contest isn't open yet." };

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
      picks[pl.dataset.s] = pl.dataset.k;
      note = "";
      saveDraft();
      const next = nextOpen(c);
      openSlot = next ? next.id : null;
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
      if (what === "new" || what === "old") {
        newDraft = what === "new";
        tab = "picks";
        openEntry = null;
        loadPicks();
        return render();
      }
      if (what === "game") {
        const id = act.dataset.id;
        if (draftOpts.off.has(id)) draftOpts.off.delete(id);
        else draftOpts.off.add(id);
        loadPicks();
        return render();
      }
      if (what === "format") {
        draftOpts.three = act.dataset.three === "1";
        loadPicks();
        return render();
      }
      if (what === "open" || what === "relock" || what === "clear") {
        if (what !== "open") {
          // Re-lock keeps the locked contest's games and format.
          const old = API.contest;
          draftOpts.off = new Set(weekGames().map((g) => g.game_id).filter((id) => !old.games.some((g) => g.id === id)));
          draftOpts.three = three(old);
          draftOpts.name = nameOf(old);
        }
        const fresh = draftContest();
        if (!fresh) return alert("No games left this week to lock.");
        // Every pick needs prices or nobody could finish an entry (2026-11-21: the build had no
        // FanDuel prices and the lock came back "bad contest").
        const empty = [];
        for (const s of slotsOf(fresh)) if (!s.list.length) empty.push(`${s.g.away} @ ${s.g.home} (${s.label})`);
        if (empty.length) return alert(`No FanDuel prices yet for: ${empty.join(", ")}. Nothing was locked. Try again after the next data update.`);
        const locks = lockGroups(fresh).map((grp) => `${grp.days} picks lock ${lockLabel(grp.at)}`).join(", ");
        if (what === "open" && !confirm(`Lock prices now and open the contest to members? ${fresh.games.length} games, ${slotsOf(fresh).length} picks; ${locks}.`)) return;
        if (what === "relock" && !confirm("Replace every price with FanDuel's price right now? Entries stay, but their prices change.")) return;
        if (what === "clear" && !confirm("Re-lock prices AND delete every entry? This can't be undone.")) return;
        // A new contest saved over a finished one with the same id starts with no entries.
        const reused = what === "open" && API.contest && API.contest.id === fresh.id;
        const r = await post({ action: "open", contest: fresh, clear: what === "clear" || !!reused });
        if (!r.ok) alert(`Couldn't lock prices (${r.error || "error"}).`);
        else newDraft = null; // the new contest is the saved one now
        return load();
      }
      if (what === "unmark") {
        if (!confirm("Clear every hand result (TD / No TD / Out / Use nflverse / Keep ESPN) and go back to automatic grading?")) return;
        const r = await post({ action: "unmark" });
        if (!r.ok) alert(`Couldn't reset (${r.error || "error"}).`);
        else API.marks = {};
        return render();
      }
      if (what === "mark") {
        act.disabled = true;
        const r = await post({ action: "mark", g: act.dataset.s, k: act.dataset.k, result: act.dataset.r || null });
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
    const cell = t.closest(".ct-pickbtn");
    if (cell && cell.dataset.s) {
      openSlot = openSlot === cell.dataset.s ? null : cell.dataset.s;
      render();
    }
  });

  // The owner's Name box: kept as typed, no redraw (the box keeps its cursor); the header follows.
  $("ct-app").addEventListener("input", (e) => {
    if (e.target.id !== "ct-cname") return;
    draftOpts.name = e.target.value;
    const h = document.querySelector("#ct-app .ct-head .ct-title");
    if (h) h.innerHTML = titleHtml({ title: e.target.value.trim() });
  });

  // data.json is only needed for the owner's preview and for grading; the contest itself comes from /api/contest.
  const dataReady = fetch("data.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d) DATA = d; })
    .catch(() => null)
    .finally(() => { dataDone = true; });
  Promise.all([dataReady, load()]).then(([, ok]) => { if (ok) { loadPicks(); render(); } });
  window.GMGContest = { compareEntries, rankEntries, scoreEntry, gradePick, slotsOf, easternToUtc, draftContest };
})();
