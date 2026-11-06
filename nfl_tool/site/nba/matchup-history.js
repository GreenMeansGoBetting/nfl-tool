// ---- GMG NBA Suite: Matchup Keys, the Rotations & History tab ----
// The owner, 2026-11-06: Matchup Keys and Matchup Data are one page ("thats what this is right? so
// rotations and history needs to actually pull up the roster and the games on this page"). The
// Matchup Data page's Rotations, Head To Head, How They Win / Lose and Recent Games, drawn in this
// page's research-box look (tiles on the 8-step rank colors, tabs like Player Props):
//   Rotations (a box a team, sortable, shaded by rank on his own team)
//   Head To Head (Season | Quarters | Blowouts & Spots) beside How They Win / Lose (a tab a team)
//   Recent Games (a box a team; spread green = covered, total green = over).
// Uses matchup-keys.js (DATA, team, logo, teamRgb, esc, rsT, hd, renderKeys), league-cols.js
// (rankStyle, ordinal), extremes.js (exCell, SPOT_OUTCOMES, EX_MIN_GP), nba-card.js (playerClick).

const MH_ROT = [["games", "GP", 0], ["min", "Min", 1], ["pts", "Pts", 1], ["reb", "Reb", 1], ["ast", "Ast", 1], ["threes", "3PM", 1], ["l5_pts", "L5 Pts", 1]];
// How They Win / Lose rows: [label, side, identity key, how it prints, way (+1 more is good, -1 less, 0 how often)].
const MH_WL = [
  ["Points Scored / Poss", "off", "ppp", "ppp", 1],
  ["Points Allowed / Poss", "def", "ppp", "ppp", 1],
  ["Pace", "off", "pace", "num", 0],
  ["3-Point Share", "off", "three_rate", "pct", 0],
  ["3-Point Share Allowed", "def", "three_rate", "pct", 0],
  ["Turnovers Committed", "off", "tov_rate", "pct", -1],
  ["Turnovers Forced", "def", "tov_rate", "pct", -1],
  ["Off Rebound %", "off", "oreb_rate", "pct", 1],
  ["Def Rebound %", "def", "oreb_rate", "pct", 1],
  ["Free Throws / Shot", "off", "fta_rate", "pct", 1],
  ["Paint FG%", "off", "paint_pct", "pct", 1],
  ["Paint FG% Allowed", "def", "paint_pct", "pct", 1],
];
const MH_SWINGS = 3; // the biggest win / loss gaps get marked
const MH = { rotSort: {}, h2h: "season", wl: null };

const mhFmt = (n, d = 1) => (n === null || n === undefined ? "--" : Number(n).toFixed(d));
const mhSigned = (n, d = 1) => (n === null || n === undefined ? "--" : `${n > 0 ? "+" : ""}${Number(n).toFixed(d)}`);
const mhPrint = { ppp: (v) => v.toFixed(2), num: (v) => v.toFixed(1), pct: (v) => `${(v * 100).toFixed(1)}%` };
const mhId = () => {
  const id = DATA.identity;
  return (id && id.seasons && id.seasons[id.default]) || null;
};
const mhIdTeams = () => (mhId() || {}).teams || {};
// Where v sits among a table's numbers on `key` (1 = best); null when nothing to rank.
function mhRank(table, key, v, hi) {
  if (v === null || v === undefined || !table) return null;
  const vals = Object.values(table).map((s) => s && s[key]).filter((x) => x !== null && x !== undefined);
  if (!vals.length) return null;
  return { r: Math.min(vals.length, 1 + vals.filter((x) => (hi ? x > v : x < v)).length), n: vals.length };
}
const mhShade = (rk) => (rk ? rankStyle(rk.r, rk.n) : "");
// A two-line tile: big on top, small under, shaded by rank.
const mhTile = (big, small, rk, tip = "") =>
  `<div class="mk-k"${rk ? ` style="${mhShade(rk)}"` : ""} title="${esc(tip)}"><b>${big}</b>${small ? `<small>${small}</small>` : ""}</div>`;
const mhBanner = (t, text) => `<div class="mk-bh" style="--team:${teamRgb(t)}">${logo(t, 26)}${text}</div>`;
const mhTeamHeads = (g) => rsT("", "rs-blank") + hd(`${logo(g.away, 22)}${g.away}`, "rs-him mk-big") + hd(`${logo(g.home, 22)}${g.home}`, "rs-def mk-big");
const mhTabs = (attr, list, on) => `<div class="rs-tabs mh-tabs">${list.map(([id, name]) => `<button type="button" class="${id === on ? "on" : ""}" ${attr}="${id}">${name}</button>`).join("")}</div>`;

// ---- Rotations: each number shaded by its rank on his own team; a head sorts the team's box ----
function mhRotation(t) {
  const out = new Set((((DATA.injuries || {})[t]) || []).filter((p) => p.status === "Out").map((p) => String(p.id)));
  const players = (((DATA.players || {})[t]) || []).slice();
  const [sk, dir] = MH.rotSort[t] || [null, -1];
  if (sk) players.sort((x, y) => -dir * ((y[sk] ?? -1) - (x[sk] ?? -1)));
  const rank = (p, key) => {
    const vals = players.map((x) => x[key]).filter((v) => v !== null && v !== undefined);
    const v = p[key];
    return v === null || v === undefined || vals.length < 2 ? null : { r: 1 + vals.filter((x) => x > v).length, n: vals.length };
  };
  const heads = rsT("Player", "rs-h mh-ph") + MH_ROT.map(([key, label]) =>
    `<button type="button" class="rs-t rs-h mh-sort${sk === key ? " on" : ""}" data-mh-team="${t}" data-mh-sort="${key}"${key === "l5_pts" ? ' title="Points a game, last five games"' : ""}>${label}${sk === key ? (dir < 0 ? " &#9660;" : " &#9650;") : ""}</button>`).join("");
  const rows = players.map((p) => {
    const isOut = out.has(String(p.id));
    const who = `${p.headshot ? `<img src="${p.headshot}" alt="" class="mh-face" loading="lazy">` : `<span class="mh-face"></span>`}<span class="mh-name">${playerClick(p.id, esc(p.name))}</span><small>${esc(p.position || "")}</small>${isOut ? `<i class="mh-out">Out</i>` : ""}`;
    const cells = MH_ROT.map(([key, , digits]) => rsT(p[key] === null || p[key] === undefined ? "--" : digits ? mhFmt(p[key]) : p[key], "", mhShade(rank(p, key))));
    return `<div class="mh-prow${isOut ? " mh-isout" : ""}">${rsT(who, "rs-l mh-player")}${cells.join("")}</div>`;
  }).join("");
  return `<div class="mk-box mh-rotbox" data-team="${t}">${mhBanner(t, `${team(t).name} Rotation`)}
    <div class="mh-rot">${heads}${rows || `<div class="mk-none">No Players On File</div>`}</div></div>`;
}

// ---- Head To Head ----
function mhSeasonRows(g) {
  const ts = DATA.team_stats || {};
  const recRank = (key, s) => {
    const share = (x) => {
      const [w, l] = String(x || "").split("-").map(Number);
      return w + l ? w / (w + l) : null;
    };
    const vals = Object.values(ts).map((x) => share(x && (key === "record" ? `${x.wins}-${x.losses}` : x[key]))).filter((x) => x !== null);
    const v = share(s);
    return v === null || !vals.length ? null : { r: 1 + vals.filter((x) => x > v).length, n: vals.length };
  };
  const rec = (key, label) => [label, ...[g.away, g.home].map((t) => {
    const s = ts[t];
    const text = s ? (key === "record" ? `${s.wins}-${s.losses}` : s[key]) : null;
    if (!text) return null;
    const rk = recRank(key, text);
    return mhTile(text, rk ? ordinal(rk.r) : "", rk, `${team(t).name} ${label}: ${text}`);
  })];
  const num = (key, label, hi, show) => [label, ...[g.away, g.home].map((t) => {
    const v = (ts[t] || {})[key];
    if (v === null || v === undefined) return null;
    const rk = mhRank(ts, key, v, hi);
    return mhTile(rk ? ordinal(rk.r) : "--", show(v), rk, `${team(t).name} ${label}: ${show(v)}${rk ? ` (${ordinal(rk.r)} of ${rk.n})` : ""}`);
  })];
  return [rec("record", "Record"), num("net_rating", "Net Rating", true, (v) => mhSigned(v)), num("off_rating", "Offense", true, (v) => mhFmt(v)),
    num("def_rating", "Defense", false, (v) => mhFmt(v)), num("pace", "Pace", true, (v) => mhFmt(v)), rec("home_record", "Home"), rec("away_record", "Away"), rec("last10", "Last 10")];
}
// identity numbers: lead = the number big, its rank small (points per quarter)
function mhIdRow(g, key, label, hi, show, lead) {
  return [label, ...[g.away, g.home].map((t) => {
    const v = (mhIdTeams()[t] || {})[key];
    if (v === null || v === undefined) return null;
    const rk = mhRank(mhIdTeams(), key, v, hi);
    const tip = `${team(t).name} ${label}: ${show(v)}${rk ? ` (${ordinal(rk.r)} of ${rk.n})` : ""}`;
    return lead ? mhTile(show(v), rk ? ordinal(rk.r) : "", rk, tip) : mhTile(rk ? ordinal(rk.r) : "--", show(v), rk, tip);
  })];
}
// Tonight's Schedule Spots: net points a game vs normal in that spot minus the league's, ranked among
// every team that has been in it, shown at EX_MIN_GP+ games (Matchup Data's rule).
function mhSpotRows(g) {
  const spots = (mhId() || {}).spots;
  if (!spots || typeof exCell !== "function") return [];
  const now = (spots.tonight || {})[g.game_id] || {};
  const keys = [...new Set([...(now[g.away] || []), ...(now[g.home] || [])])];
  const net = (abbr, t) => {
    const p = exCell(spots, abbr, t, SPOT_OUTCOMES[0]);
    const o = exCell(spots, abbr, t, SPOT_OUTCOMES[1]);
    return p && o ? { v: p.gap - o.gap, title: `${p.title} ${o.title}` } : null;
  };
  const cell = (abbr, t) => {
    if (!(now[abbr] || []).includes(t.key)) return null;
    const n = ((spots.teams[abbr] || {})[t.key] || {}).n || 0;
    const mine = net(abbr, t);
    if (!mine || n < EX_MIN_GP) return null;
    const all = Object.keys(spots.teams).map((x) => net(x, t)).filter(Boolean).map((x) => x.v);
    const rk = { r: 1 + all.filter((v) => v > mine.v).length, n: all.length };
    return mhTile(ordinal(rk.r), `${mhSigned(mine.v)} Net`, rk, mine.title);
  };
  return spots.types.filter((t) => keys.includes(t.key)).map((t) => [t.label, cell(g.away, t), cell(g.home, t)]).filter(([, a, h]) => a || h);
}
function mhHeadToHead(g) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const of5 = (v) => `${v.toFixed(1)} Of 5`;
  const tabs = [["season", "Season"], ["quarters", "Quarters"], ["blowouts", "Blowouts & Spots"]];
  let rows;
  if (MH.h2h === "quarters") rows = [1, 2, 3, 4].map((q) => mhIdRow(g, `q${q}_ppq`, `Q${q} Margin`, true, (v) => mhSigned(v), true));
  else if (MH.h2h === "blowouts") {
    rows = [mhIdRow(g, "blowout_up_share", "Games Up 15+", true, pct), mhIdRow(g, "blowout_down_share", "Games Down 15+", false, pct),
      mhIdRow(g, "blowout_up_starters", "Starters In: Up 15+", true, of5), mhIdRow(g, "blowout_down_starters", "Starters In: Down 15+", true, of5),
      mhIdRow(g, "close_starters", "Starters In: Within 5", true, of5)];
    const spots = mhSpotRows(g);
    if (spots.length) rows = rows.concat([["Tonight's Spots", "group"]], spots);
  } else rows = mhSeasonRows(g);
  const body = rows.map(([label, a, h]) => (a === "group" ? `<div class="mh-group">${label}</div>` : rsT(label, "rs-l") + (a || rsT("--", "rs-small")) + (h || rsT("--", "rs-small")))).join("");
  return `<div class="mk-box mh-h2h"><div class="mk-bh mk-bh-both">Head To Head</div>${mhTabs("data-mh-h2h", tabs, MH.h2h)}
    <div class="mh-grid">${mhTeamHeads(g)}${body}</div></div>`;
}

// ---- How They Win / Lose: a tab a team, in wins vs in losses, the biggest swings marked ----
function mhWinLoss(g) {
  const t = [g.away, g.home].includes(MH.wl) ? MH.wl : g.away;
  const wl = ((mhId() || {}).wl || {})[t];
  const tabs = mhTabs("data-mh-wl", [[g.away, `${logo(g.away, 18)} ${g.away}`], [g.home, `${logo(g.home, 18)} ${g.home}`]], t);
  if (!wl) return `<div class="mk-box mh-wl"><div class="mk-bh mk-bh-both">How They Win / Lose</div>${tabs}<div class="mk-none">No Games On File</div></div>`;
  const lg = (mhId() || {}).league || {};
  const has = (v) => v !== null && v !== undefined;
  const rows = MH_WL.map(([label, side, key, kind, way]) => {
    const k = `${side}_${key}`;
    const hi = side === "off" ? way >= 0 : way < 0;
    const show = (v) => mhPrint[kind](side === "def" && key === "oreb_rate" ? 1 - v : v);
    const cell = (v, when) => {
      if (!has(v)) return rsT("--", "rs-small");
      const rk = mhRank(mhIdTeams(), k, v, hi);
      return mhTile(rk ? ordinal(rk.r) : "--", show(v), rk, `${team(t).name} ${when}: ${label} ${show(v)}${rk ? ` (${ordinal(rk.r)} of ${rk.n})` : ""}`);
    };
    const w = (wl.w || {})[k], l = (wl.l || {})[k];
    const gap = has(w) && has(l) && lg[k] ? Math.abs(w - l) / (lg[k].sd || 1) : -1;
    return { label, gap, html: [cell(w, "in wins"), cell(l, "in losses")] };
  });
  const swings = new Set(rows.filter((x) => x.gap >= 0).sort((x, y) => y.gap - x.gap).slice(0, MH_SWINGS).map((x) => x.label));
  const heads = rsT("", "rs-blank") + hd(wl.nw ? `In Wins (${wl.nw})` : "No Wins Yet", "rs-him") + hd(wl.nl ? `In Losses (${wl.nl})` : "No Losses Yet", "rs-def");
  const body = rows.map((x) => rsT(x.label, `rs-l${swings.has(x.label) ? " mh-swing" : ""}`, "", swings.has(x.label) ? "One of the three biggest win / loss swings" : "") + x.html.join("")).join("");
  return `<div class="mk-box mh-wl"><div class="mk-bh mk-bh-both">How They Win / Lose</div>${tabs}<div class="mh-grid mh-wlgrid">${heads}${body}</div></div>`;
}

// ---- Recent Games: the line at tip, spread green = covered, total green = over ----
function mhRecent(t) {
  const hit = (s) => (s === null ? "" : s === 0 ? "background:var(--rs-label)" : `background:${scaleHsla(s > 0 ? 120 : 0, 70, 45, 0.32)}`);
  const rows = (((DATA.recent_games || {})[t]) || []).slice().reverse().map((r) => {
    const margin = r.pf - r.pa;
    const cover = r.spread === null || r.spread === undefined ? null : Math.sign(margin + r.spread);
    const ou = r.total === null || r.total === undefined ? null : Math.sign(r.pf + r.pa - r.total);
    const date = new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    return rsT(date, "rs-l mh-date") + rsT(`${r.home ? "vs" : "@"} ${logo(r.opp, 16)} ${r.opp}`, "rs-l mh-opp")
      + rsT(r.win ? "W" : "L", "", `background:${scaleHsla(r.win ? 120 : 0, 70, 45, 0.32)}`) + rsT(`${r.pf}-${r.pa}`)
      + (cover === null ? rsT("--", "rs-small") : rsT(mhSigned(r.spread).replace(/\.0$/, ""), "", hit(cover), cover > 0 ? "Covered" : cover < 0 ? "Didn't cover" : "Push"))
      + (ou === null ? rsT("--", "rs-small") : rsT(`${ou > 0 ? "O" : ou < 0 ? "U" : "P"} ${mhFmt(r.total).replace(/\.0$/, "")}`, "", hit(ou), ou > 0 ? "Over" : ou < 0 ? "Under" : "Push"))
      + rsT(mhFmt(r.pace, 0));
  }).join("");
  const heads = ["Date", "Opp", "", "Score", "Spread", "Total", "Pace"].map((h) => hd(h, "")).join("");
  return `<div class="mk-box mh-recbox" data-team="${t}">${mhBanner(t, `${team(t).name} Recent Games`)}
    <div class="mh-recent">${heads}${rows || `<div class="mk-none">No Games On File</div>`}</div></div>`;
}

function mhView(g) {
  return `<div class="mh-wrap">
    <div class="mh-two">${mhRotation(g.away)}${mhRotation(g.home)}</div>
    <div class="mh-two">${mhHeadToHead(g)}${mhWinLoss(g)}</div>
    <div class="mh-two">${mhRecent(g.away)}${mhRecent(g.home)}</div>
  </div>`;
}

document.addEventListener("click", (e) => {
  const sort = e.target.closest("[data-mh-sort]");
  if (sort) {
    const [key, dir] = MH.rotSort[sort.dataset.mhTeam] || [];
    MH.rotSort[sort.dataset.mhTeam] = [sort.dataset.mhSort, key === sort.dataset.mhSort ? -dir : -1];
    return renderKeys();
  }
  const h2h = e.target.closest("[data-mh-h2h]");
  if (h2h) {
    MH.h2h = h2h.dataset.mhH2h;
    return renderKeys();
  }
  const wl = e.target.closest("[data-mh-wl]");
  if (wl) {
    MH.wl = wl.dataset.mhWl;
    return renderKeys();
  }
});
