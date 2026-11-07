// ---- GMG NBA Suite: Matchup Keys ----
// One game's strengths and weaknesses, sorted the way Player Props is (the owner, 2026-11-06: the old
// Edges / Clashes / Same Style stacks were "a mess of info"; "it needs to be segmented ... this is where
// BOS have an edge vs this is where CHA is weak vs this is where they are both x"; "look at the player
// prop drop down styles and make them like that"). Two tabs:
//   Overview: the road team's Edges | the Matchup Summary | the home team's Edges (each box its own team's
//     column first), then Both Teams (same-style keys). Labels are stat names with an OFF / DEF tag,
//     never phrases (the owner: "default to the stat category rather than this arbitrary blabber").
//   Categories: one line a category (offense vs the other team's defense, both ways, a Read tile naming
//     who has it), click to open two Points Research style boxes (research.js .rs-sb / .rs-g in sim.css).
// Rotations & History (matchup-history.js): rotations, head to head, how they win / lose, recent games
// (the owner, 2026-11-06: Matchup Keys and Matchup Data become this one page). Every key and Read comes from keys.js
// (nbaMatchupKeys, every rule in one place); a Clash shows as a Not Tested Read, never a headline.
// Show All Summaries = every game's Matchup Summary, two a row, for the owner's video screenshots.
// Data: nba/data.json `league_chart` (columns in league-cols.js), `injuries`, `schedule`. No common.js.

let DATA = null;
let dayIndex = 0;
let gameId = null;
const view = { window: "season", all: false, tab: "overview", open: new Set(["scoring"]) };
const NBA_GAME_KEY = "nba-tool.game.v1"; // the open game, shared with Matchup Data (nba.js)
const MK_TAB_KEY = "nba-tool.mk-tab.v1"; // a display pref: stays on this device
const MK_WINDOWS = [["season", "Season"], ["10", "Last 10"], ["5", "Last 5"], ["3", "Last 3"]];
const MK_TABS = [["overview", "Overview"], ["categories", "Categories"], ["rotations", "Rotations & History"]];
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
// Categories: [id, name, keys.js topics, the line's offense key, rows [label, offense key, defense key]].
// Pace & Total is the two teams side by side (game numbers, no offense / defense).
const MK_CATS = [
  ["scoring", "Scoring Efficiency", ["scoring"], "o_rtg", [["Rating", "o_rtg", "d_rtg"], ["Points", "o_ppg", "d_ppg"], ["Ball Movement", "o_ball_move", "d_ball_move"]]],
  ["pace", "Pace & Total", ["pace", "total", "ou"], null, null],
  ["transition", "Transition", ["transition"], "o_trans_ppp", [["Transition Share", "o_trans_freq", "d_trans_freq"], ["Transition Pts", "o_trans_ppp", "d_trans_ppp"]]],
  ["threes", "Three-Point Shooting", ["threes"], "o_3pm", [["3PA Rate", "o_3par", "d_3par"], ["3PM", "o_3pm", "d_3pm"]]],
  ["paint", "Paint & Mid-Range", ["paint", "mid"], "o_paint_pct",
    [["Paint Share", "o_paint_share", "d_paint_share"], ["Paint FG%", "o_paint_pct", "d_paint_pct"], ["Mid-Range Share", "o_mid_share", "d_mid_share"], ["Mid-Range FG%", "o_mid_pct", "d_mid_pct"]]],
  ["turnovers", "Turnovers", ["turnovers"], "o_tov", [["Turnover %", "o_tov", "d_tov"]]],
  ["glass", "Rebounding", ["glass"], "o_reb", [["Off Rebound %", "o_reb", "d_reb"]]],
  ["ft", "Free Throws", ["ft"], "o_ftr", [["FT Rate", "o_ftr", "d_ftr"]]],
];
// Pace & Total's two boxes: [title, rows [label, key, keys.js style key or null]].
const MK_PACE = [
  ["Pace & Scoring", [["Pace", "pace"], ["Avg Total", "total"], ["Net Rating", "net"]]],
  ["Betting Record", [["O/U Record", "ou"], ["ATS Record", "ats"], ["Avg Margin", "margin"]]],
];
// A key's stat name (its offense number's; the OFF / DEF tag says whose side of the ball).
const MK_LABEL = {
  o_rtg: "Rating", d_rtg: "Rating", o_3pm: "3PM", o_3par: "3PA Rate", o_ftr: "FT Rate", o_tov: "Turnovers", o_reb: "Rebounding",
  o_paint_share: "Paint Share", o_paint_pct: "Paint FG%", o_mid_share: "Mid-Range Share", o_mid_pct: "Mid-Range FG%",
  o_trans_freq: "Transition", o_trans_ppp: "Transition Pts", pace: "Pace", total: "Avg Total", ou: "O/U Record",
};
const MK_PLAIN_DEF = new Set(["d_rtg", "d_tov", "d_reb"]); // defense names that already say "allowed"
// A defense number kept as the defense's own (DREB% = boards it grabs) shown in a category box's
// Allows column as what it gives up, so it reads straight against the offense's number (the owner,
// 2026-11-07: "IND Allows 71.8%" beside DEN's 26.8% OREB% read wrong). The rank is unchanged.
const MK_AS_ALLOWED = { d_reb: ["Offensive Rebound % Allowed", (v) => 1 - v] };

const el = (id) => document.getElementById(id);
const team = (abbr) => DATA.teams[abbr] || { name: abbr, color: "555555", logo: "" };
const teamRgb = (abbr) => [0, 2, 4].map((i) => parseInt((team(abbr).color || "555555").slice(i, i + 2), 16)).join(",");
const logo = (abbr, size) => `<img src="${team(abbr).logo}" alt="${abbr}" class="team-logo" style="width:${size}px;height:${size}px" loading="lazy">`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const days = () => [...new Set(DATA.schedule.map((g) => g.date))].sort();
const gamesOn = (date) => DATA.schedule.filter((g) => g.date === date);
const col = (key) => COLS.find((c) => c[0] === key);
const short = (key) => {
  const name = col(key)[1].replace("<br>", " ").replace(" %", "%");
  return key.startsWith("d_") && !MK_PLAIN_DEF.has(key) ? `${name} Allowed` : name;
};
const sideTag = (key) => (key.startsWith("o_") ? `<span class="mk-side mk-o">OFF</span>` : key.startsWith("d_") ? `<span class="mk-side mk-d">DEF</span>` : "");

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

// ---- Tiles ----
// A plain Points Research tile; `rank` shades it on the 8-step scale (green = good for that team).
const rsT = (inner, cls = "", style = "", tip = "") => `<div class="rs-t ${cls}"${style ? ` style="${style}"` : ""}${tip ? ` title="${esc(tip)}"` : ""}>${inner}</div>`;
const hd = (inner, cls) => rsT(inner, `rs-h ${cls}`);
function stat(ctx, t, key) {
  const c = col(key), v = (ctx.table[t] || {})[key], rk = ctx.ranks[key] ? ctx.ranks[key].r[t] : null;
  return { v, rk, n: ctx.ranks[key] ? ctx.ranks[key].n : 30, shade: rk ? rankStyle(rk, ctx.ranks[key].n) : "", text: exact(v, c[3]), tip: `${team(t).name} · ${c[2]}: ${exact(v, c[3])}${rk ? ` · ${ordinal(rk)} of ${ctx.ranks[key].n}` : ""}` };
}
const rankTile = (ctx, t, key, withLogo) => {
  const s = stat(ctx, t, key);
  return rsT(s.rk ? `${withLogo ? logo(t, 16) : ""}${ordinal(s.rk)}` : "--", s.rk ? "mk-r" : "rs-small", s.shade, s.tip);
};
// The Overview's tile: the rank big, the number and its name small under it.
const bigTile = (ctx, t, key) => {
  const s = stat(ctx, t, key);
  return `<div class="mk-k" style="${s.shade}" title="${esc(s.tip)}"><b>${s.rk ? ordinal(s.rk) : "--"}</b><small>${esc(s.v === null || s.v === undefined ? "" : s.text)} ${esc(short(key))}</small></div>`;
};
function readTile(r) {
  if (!r || r.kind === "blank") return rsT("", "rs-blank");
  if (r.kind === "team") return rsT(`${logo(r.team, 18)}${r.team} Edge`, "rs-read", `--team:${teamRgb(r.team)}`, r.tip);
  if (r.kind === "untested") return rsT("Not Tested", "rs-read mk-untested", "", r.tip);
  if (r.kind === "clash") return rsT("Clash", "rs-read mk-clash", "", r.tip);
  if (r.kind === "style") return rsT(r.text, "rs-read mk-style", "", r.tip);
  return rsT("Even", "rs-read mk-even");
}

// ---- Reads (keys.js decides every one) ----
const hasTile = (k, t, key) => k.tiles.some((x) => x.team === t && x.key === key);
// Offense o's number `ok` against defense d's `dk`: an Edge (either side's), Not Tested, or Even.
function pairRead(keys, o, d, ok, dk) {
  const edge = keys.find((k) => k.group === "edge" && hasTile(k, o, ok) && hasTile(k, d, dk));
  if (edge) return { kind: "team", team: edge.team, tip: edge.title };
  const weak = keys.find((k) => k.type === "untested" && hasTile(k, o, ok) && hasTile(k, d, dk));
  if (weak) return { kind: "untested", tip: weak.title };
  const both = keys.find((k) => k.type === "strength" && hasTile(k, o, ok) && hasTile(k, d, dk));
  if (both) return { kind: "clash", tip: both.title };
  return { kind: "even" };
}
// A category's line, offense o vs defense d: the strongest Edge in its topics that way, else Not Tested, else Even.
function lineRead(keys, o, d, topics) {
  const mine = keys.filter((k) => topics.includes(k.topic) && k.tiles[0].team === o && k.tiles.some((x) => x.team === d));
  const edge = mine.find((k) => k.group === "edge");
  if (edge) return { kind: "team", team: edge.team, tip: edge.title };
  const weak = keys.find((k) => k.type === "untested" && topics.includes(k.topic) && k.team === d);
  if (weak) return { kind: "untested", tip: weak.title };
  const both = mine.find((k) => k.type === "strength");
  if (both) return { kind: "clash", tip: both.title };
  return { kind: "even" };
}
// Both teams on one game number: Same Style (both at one end) or the combined O/U Trend.
function styleRead(keys, game, key) {
  const k = keys.find((x) => (x.group === "style") && x.tiles.every((tl) => tl.key === key) && hasTile(x, game.away, key) && hasTile(x, game.home, key));
  if (!k) return key === "pace" || key === "total" || key === "ou" ? { kind: "even" } : { kind: "blank" };
  const words = { pace: ["Both Fast", "Both Slow"], total: ["Both High", "Both Low"] }[key];
  const text = words ? (/Fast|High/.test(k.title) ? words[0] : words[1]) : k.title.replace(" Combined", "");
  return { kind: "style", text, tip: k.title };
}

// ---- The Matchup Summary card ----
// Each side reads one matchup: the road team's Off against the home team's Def | category | the home
// team's Off against the road team's Def (the owner, 2026-11-06). A logo beside the category = the
// team with an Edge in that matchup (keys.js); Pace = one number a team.
function summaryCard(ctx, game, keys) {
  const [a, h] = [game.away, game.home];
  const mark = (o, topic) => {
    const k = keys.find((x) => x.group === "edge" && x.topic === topic && x.tiles[0].team === o);
    return `<span class="mks-edge"${k ? ` title="${esc(k.title)}"` : ""}>${k ? logo(k.team, 18) : ""}</span>`;
  };
  const rows = MK_SUMMARY.map(([name, ok, dk, topic]) =>
    dk
      ? rankTile(ctx, a, ok) + rankTile(ctx, h, dk) + rsT(`${mark(a, topic)}<b>${name}</b>${mark(h, topic)}`, "rs-l mks-cat") + rankTile(ctx, h, ok) + rankTile(ctx, a, dk)
      : rankTile(ctx, a, ok, true).replace('class="rs-t', 'class="rs-t mks-span') + rsT(`<span class="mks-edge"></span><b>${name}</b><span class="mks-edge"></span>`, "rs-l mks-cat") + rankTile(ctx, h, ok, true).replace('class="rs-t', 'class="rs-t mks-span')
  ).join("");
  const hs = game.home_team_spread, total = game.total_line;
  const fav = hs === null || hs === undefined ? null : hs <= 0 ? h : a;
  const favLine = fav === h ? hs : -hs;
  const line = [fav ? `${fav} ${favLine > 0 ? "+" : ""}${favLine}` : "", total ? `O/U ${total}` : ""].filter(Boolean).join(" · ");
  const head = (t) => `<div class="mks-team" style="--team:${teamRgb(t)}">${logo(t, 34)}<b>${t}</b></div>`;
  return `<div class="mks-card mk-box" data-game="${game.game_id}">
    <div class="mks-head">${head(a)}<div class="mks-mid"><b>Matchup Summary</b><span>${gmgGameTime(game, false)}${line ? ` · ${line}` : ""}</span></div>${head(h)}</div>
    <div class="mks-grid">${hd(`${logo(a, 18)}Off`, "rs-him")}${hd(`${logo(h, 18)}Def`, "rs-def")}${rsT("Logo = Who Has It", "rs-h mks-note")}${hd(`${logo(h, 18)}Off`, "rs-him")}${hd(`${logo(a, 18)}Def`, "rs-def")}${rows}</div>
  </div>`;
}

// ---- Overview ----
// A team's Edges: every Edge key it owns, strongest first, its own column first.
function edgeBox(ctx, t, opp, keys) {
  const mine = keys.filter((k) => k.group === "edge" && k.team === t).sort((x, y) => y.score - x.score);
  const rows = mine.map((k) => {
    const [off] = k.tiles;
    const ownKey = (k.tiles.find((x) => x.team === t) || {}).key, oppKey = (k.tiles.find((x) => x.team === opp) || {}).key;
    const side = k.tiles[0].team === t ? "o_" : "d_";
    return rsT(`<span>${MK_LABEL[off.key] || short(off.key)}</span>${sideTag(side)}`, "rs-l mk-lab", "", k.title) + bigTile(ctx, t, ownKey) + bigTile(ctx, opp, oppKey);
  }).join("");
  return `<div class="mk-box mk-edges" data-team="${t}"><div class="mk-bh" style="--team:${teamRgb(t)}">${logo(t, 28)}${team(t).name} Edges</div>
    <div class="mk-eg${mine.length < 4 ? " mk-few" : ""}">${rsT("", "rs-blank")}${hd(`${logo(t, 24)}${t}`, "rs-him mk-big")}${hd(`${logo(opp, 24)}${opp}`, "rs-def mk-big")}
    ${rows || `<div class="mk-none">No Edges In This Matchup</div>`}</div></div>`;
}
// Both Teams: Same Style keys (both at one end of a number) and the combined O/U Trend, three columns.
function bothBox(ctx, game, keys) {
  const list = keys.filter((k) => k.group === "style").sort((x, y) => y.score - x.score);
  if (!list.length) return `<div class="mk-box mk-both"><div class="mk-bh mk-bh-both">${logo(game.away, 28)}Both Teams${logo(game.home, 28)}</div><div class="mk-none">Nothing Both Teams Share</div></div>`;
  const per = Math.ceil(list.length / 3);
  const cols = [0, 1, 2].map((i) => list.slice(i * per, i * per + per)).filter((c) => c.length);
  const row = (k) => {
    const key = k.tiles[0].key;
    return rsT(`<span>${MK_LABEL[key] || short(key)}</span>${sideTag(key)}`, "rs-l mk-lab", "", k.title) + bigTile(ctx, game.away, key) + bigTile(ctx, game.home, key);
  };
  return `<div class="mk-box mk-both"><div class="mk-bh mk-bh-both">${logo(game.away, 28)}Both Teams${logo(game.home, 28)}</div>
    <div class="mk-cols">${cols.map((c) => `<div class="mk-eg">${rsT("", "rs-blank")}${hd(`${logo(game.away, 24)}${game.away}`, "rs-him mk-big")}${hd(`${logo(game.home, 24)}${game.home}`, "rs-def mk-big")}${c.map(row).join("")}</div>`).join("")}</div></div>`;
}

// ---- Categories ----
const winTabs = () => `<div class="rs-tabs">${MK_WINDOWS.map(([w, name]) => `<button type="button" class="${w === view.window ? "on" : ""}" data-window="${w}">${name}</button>`).join("")}</div>`;
// One Points Research box: [label | first value, rank | second value, rank | Read], bands behind the columns.
function rsBox(corner, heads, rows) {
  const n = rows.length + 1;
  const bands = `<div class="rs-g rs-five rs-wide rs-bands"><span></span><div class="rs-band rs-him" style="grid-column:2/span 2;grid-row:1/span ${n}"></div>
    <div class="rs-band rs-def" style="grid-column:4/span 2;grid-row:1/span ${n}"></div><div class="rs-band rs-rd" style="grid-column:6;grid-row:1/span ${n}"></div></div>`;
  return `<div class="rs-sb mk-sb">${winTabs()}<div class="rs-sbody"><div class="rs-gw">${bands}<div class="rs-g rs-five rs-wide">
    ${rsT(corner, "rs-corner")}${hd(heads[0], "rs-him")}${hd("Rank", "rs-him")}${hd(heads[1], "rs-def")}${hd("Rank", "rs-def")}${hd("Read", "rs-rd")}${rows.join("")}</div></div></div></div>`;
}
const valRank = (ctx, t, key, allows) => {
  const s = stat(ctx, t, key);
  if (s.v === null || s.v === undefined) return rsT("--", "rs-small") + rsT("--", "rs-small");
  const as = allows && MK_AS_ALLOWED[key];
  const text = as ? exact(as[1](s.v), col(key)[3]) : s.text;
  const tip = as ? `${team(t).name} · ${as[0]}: ${text}${s.rk ? ` · ${ordinal(s.rk)} of ${s.n}` : ""}` : s.tip;
  return rsT(esc(text), "", s.shade, tip) + rsT(s.rk ? ordinal(s.rk) : "--", "mk-r", s.shade, tip);
};
function directionBox(ctx, keys, o, d, rows) {
  return rsBox(`${logo(o, 22)}vs${logo(d, 22)}`, [`${logo(o, 15)}Off`, `${logo(d, 15)}Allows`],
    rows.map(([label, ok, dk]) => rsT(label, "rs-l") + valRank(ctx, o, ok) + valRank(ctx, d, dk, true) + readTile(pairRead(keys, o, d, ok, dk))));
}
function paceBoxes(ctx, keys, game) {
  const [a, h] = [game.away, game.home];
  return MK_PACE.map(([title, rows]) => rsBox(`<b class="mk-bt">${title}</b>`, [`${logo(a, 16)}${a}`, `${logo(h, 16)}${h}`],
    rows.map(([label, key]) => rsT(label, "rs-l") + valRank(ctx, a, key) + valRank(ctx, h, key) + readTile(styleRead(keys, game, key))))).join("");
}
function categories(ctx, keys, game) {
  const [a, h] = [game.away, game.home];
  const head = `<div class="mk-chead"><div class="mk-cline">${rsT("Click A Category To Open It", "rs-h mks-note")}${hd(`${logo(a, 18)}${a} Off`, "rs-him")}${hd(`${logo(h, 18)}${h} Def`, "rs-def")}${hd("Read", "rs-rd")}<span></span>
    ${hd(`${logo(h, 18)}${h} Off`, "rs-him")}${hd(`${logo(a, 18)}${a} Def`, "rs-def")}${hd("Read", "rs-rd")}</div></div>`;
  const rows = MK_CATS.map(([id, name, topics, ok, list]) => {
    const open = view.open.has(id);
    const label = rsT(`<span class="mk-car">${open ? "&#9660;" : "&#9654;"}</span>${name}`, "rs-l mk-cname");
    const line = list
      ? `${rankTile(ctx, a, ok)}${rankTile(ctx, h, list.find((r) => r[1] === ok)[2])}${readTile(lineRead(keys, a, h, topics))}<span></span>
         ${rankTile(ctx, h, ok)}${rankTile(ctx, a, list.find((r) => r[1] === ok)[2])}${readTile(lineRead(keys, h, a, topics))}`
      : `${rankTile(ctx, a, "pace", true)}${rankTile(ctx, h, "pace", true)}${readTile(styleRead(keys, game, "pace"))}<span></span>
         ${rankTile(ctx, a, "total", true)}${rankTile(ctx, h, "total", true)}${readTile(styleRead(keys, game, "total"))}`;
    const body = !open ? "" : `<div class="mk-open">${list ? directionBox(ctx, keys, a, h, list) + directionBox(ctx, keys, h, a, list) : paceBoxes(ctx, keys, game)}</div>`;
    return `<div class="mk-crow${open ? " open" : ""}" data-cat="${id}"><div class="mk-cline" data-cat="${id}" role="button" tabindex="0" aria-expanded="${open}">${label}${line}</div>${body}</div>`;
  }).join("");
  return `<div class="mk-cats">${head}${rows}</div>`;
}

// ---- The game's top: tabs, the line, injuries ----
function lineTiles(game) {
  const odds = (v) => (v === null || v === undefined ? null : typeof showOdds === "function" ? showOdds(v) : (v > 0 ? `+${v}` : String(v)));
  const hs = game.home_team_spread;
  const fav = hs === null || hs === undefined ? null : hs <= 0 ? game.home : game.away;
  const favLine = fav === game.home ? hs : -hs;
  const tiles = [];
  if (fav) tiles.push(rsT(`<small>Spread</small>${fav} ${favLine > 0 ? "+" : ""}${favLine}`));
  if (game.total_line) tiles.push(rsT(`<small>Total</small>${game.total_line}`));
  const am = odds(game.away_moneyline), hm = odds(game.home_moneyline);
  if (am && hm) tiles.push(rsT(`<small>ML</small>${game.away} ${am} / ${game.home} ${hm}`));
  return tiles.join("");
}
function injuries(game) {
  return `<div class="mk-inj">${[game.away, game.home].map((t) => {
    const list = (DATA.injuries || {})[t] || [];
    const shown = list.filter((p) => p.status !== "Probable");
    const pills = shown.map((p) => `<span class="mk-ip" title="${esc([p.injury, p.note].filter(Boolean).join(": "))}"><i class="${p.status === "Out" ? "" : "q"}">${p.status === "Out" ? "Out" : "DTD"}</i>${playerClick(p.id, esc(p.name))}<small>${esc(p.position || "")}</small></span>`).join("");
    return `<div class="mk-injt" style="--team:${teamRgb(t)}"><b>${logo(t, 22)}${t} Injuries</b>${pills || `<span class="mk-ip mk-healthy">None Listed</span>`}</div>`;
  }).join("")}</div>`;
}

function renderAll(ctx) {
  const games = gamesOn(days()[dayIndex]).filter((g) => ctx.table[g.away] && ctx.table[g.home]);
  el("mk-body").innerHTML = games.length
    ? `<div class="mks-all">${games.map((g) => summaryCard(ctx, g, nbaMatchupKeys(ctx.table, g.away, g.home))).join("")}</div>`
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
  const ctx = { table, ranks: ranksOf(table) };
  if (view.all) return renderAll(ctx);
  if (!game || !table[game.away] || !table[game.home]) {
    el("mk-body").innerHTML = `<p class="no-data-note">Pick a game above to see its Matchup Keys.</p>`;
    return;
  }
  const keys = nbaMatchupKeys(table, game.away, game.home);
  // The three views as big buttons under the injuries, a third of the width each (the owner, 2026-11-06).
  const tabs = MK_TABS.map(([id, name]) => `<button type="button" class="${view.tab === id ? "on" : ""}" data-mk-tab="${id}">${name}</button>`).join("");
  const body = view.tab === "categories"
    ? categories(ctx, keys, game)
    : view.tab === "rotations"
      ? mhView(game) // matchup-history.js
      : `<div class="mk-ov">${edgeBox(ctx, game.away, game.home, keys)}${summaryCard(ctx, game, keys)}${edgeBox(ctx, game.home, game.away, keys)}</div>${bothBox(ctx, game, keys)}`;
  el("mk-body").innerHTML = `<div class="mk-top"><div class="mk-head">${logo(game.away, 28)}<b>${game.away}</b><span class="at">@</span>${logo(game.home, 28)}<b>${game.home}</b></div>
    <div class="mk-line">${lineTiles(game)}</div></div>${injuries(game)}<div class="rs-tabs mk-tabs">${tabs}</div>${body}`;
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
function toggleCat(id) {
  if (view.open.has(id)) view.open.delete(id);
  else view.open.add(id);
  renderKeys();
}

document.addEventListener("keydown", (e) => {
  const line = e.target.closest && e.target.closest(".mk-cline[data-cat]");
  if (line && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    toggleCat(line.dataset.cat);
  }
});
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
  const tab = e.target.closest("[data-mk-tab]");
  if (tab) {
    view.tab = tab.dataset.mkTab;
    try {
      localStorage.setItem(MK_TAB_KEY, view.tab);
    } catch (err) {
      // localStorage unavailable.
    }
    return renderKeys();
  }
  if (e.target.closest(".player-click")) return; // the player card (nba-card.js) handles it
  const line = e.target.closest(".mk-cline[data-cat]");
  if (line) return toggleCat(line.dataset.cat);
  const win = e.target.closest("#mk-window .view-toggle-btn") || e.target.closest(".mk-sb .rs-tabs [data-window]");
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
      const tab = localStorage.getItem(MK_TAB_KEY);
      if (MK_TABS.some(([id]) => id === tab)) view.tab = tab;
    } catch (e) {
      // localStorage unavailable.
    }
    // Open on the game Matchup Data has open if it's still in the window, else today's
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
