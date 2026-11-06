// GMG NBA Suite: filters for the Prop Research lists (Points / Threes / Rebounds / Assists, All Props).
// The owner, 2026-11-04: "i want to see all shooters who: shoot at least 50% of their shots as 3s, are
// playing a bottom 10 def vs pos in 3s allowed, with a game total over 210", with a min and a max for
// every number in the list AND every panel row with a Read, the right unit on each (some are raw, some
// percents), the defense both as a rank of 30 and as its raw number, and a combo saved to the member's
// account. Every filter must pass (AND); a player missing a number fails that filter.
// research.js calls rfApply(rows) before sorting and rfRender() after drawing the list.

const RF_KEY = "nfl-tool.nba-screens.v1"; // saved screens, synced (sync.js KEYS, the middleware's SYNC_KEYS)
const RF_PAGE = document.body.dataset.market; // the page the screens belong to: points / threes / rebounds / assists / all
const RF = { on: [], stats: [], open: false, naming: false, sig: "" };

const RF_GROUP_HUE = { "His Numbers": 210, "The Line": 45, Defense: 275, Reads: 140, "Tonight's Game": 20 };
const rfPct = (h) => (h ? (h.over / h.of) * 100 : null);
// The list's numbers: [id, group, label, unit, get(row), hint]. Units: "%" (0-100), "#" (raw), "rank".
function rfListFields() {
  const f = [["line", "The Line", "Line", "#", (x) => x.line], ["avg", "His Numbers", "Avg", "#", (x) => x.avg]];
  if (!ALL_PROPS) {
    f.push(["second", "His Numbers", THREES ? "3PA" : "Min", "#", (x) => x.second]);
    f.push(["vol", "His Numbers", "Volume", "%", (x) => (x.vol === null || x.vol === undefined ? null : x.vol * 100)]);
  }
  for (const [k, label] of [["l5", "L5"], ["l10", "L10"], ["all", "Season"], ["home", "Home"], ["away", "Away"]]) f.push([`hit_${k}`, "His Numbers", `${label} Hit Rate`, "%", (x) => rfPct(x.hits[k])]);
  f.push(["allow", "Defense", "Opp Allows", "#", (x) => (x.allow ? x.allow.v : null)]);
  f.push(["allowRank", "Defense", "Opp Allows Rank", "rank", (x) => x.allowRank, "30th = gives up the most"]);
  f.push(["ro", "Reads", "O Reads", "#", (x) => (x.reads.n ? x.reads.o : null), "Reads that say Over"]);
  f.push(["ru", "Reads", "U Reads", "#", (x) => (x.reads.n ? x.reads.u : null), "Reads that say Under"]);
  f.push(["pace", "Tonight's Game", "Pace", "#", (x) => x.game.pace]);
  f.push(["paceRank", "Tonight's Game", "Pace Rank", "rank", (x) => x.game.paceRank, "1st = fastest"]);
  f.push(["spread", "Tonight's Game", "Spread", "#", (x) => x.game.spread, "His team's spread (minus = favored)"]);
  f.push(["total", "Tonight's Game", "Total", "#", (x) => x.game.total]);
  return f;
}
// Every panel row with a Read (stat pages only): his number, his rank at his position, the defense's
// number and its rank of 30, from research.js readsOf (x.reads.nums "<tab>|<row>").
const RF_PARTS = [["him", "His", "hu", "His number"], ["hr", "His Rank", "rank", "1st = the most at his position"], ["def", "Defense", "du", "What tonight's defense gives up"], ["dr", "Defense Rank", "rank", "30th = gives up the most"]];
function rfPanelRows(rows) {
  if (ALL_PROPS) return [];
  const seen = new Map();
  for (const x of rows) {
    for (const [key, num] of Object.entries(x.reads.nums || {})) {
      if (!seen.has(key)) seen.set(key, { key, tab: key.split("|")[0], label: num.label, hu: num.hu, du: num.du });
    }
  }
  return [...seen.values()];
}
function rfFields(rows) {
  const out = rfListFields().map(([id, group, label, unit, get, hint]) => ({ id, group, label, unit, get, hint: hint || "" }));
  for (const r of rfPanelRows(rows)) {
    for (const [k, part, uk, hint] of RF_PARTS) {
      const unit = uk === "rank" ? "rank" : r[uk] || "#";
      out.push({ id: `p|${r.key}|${k}`, group: r.tab, row: r.label, part, label: `${r.label} · ${part}`, unit, hint,
        get: (x) => { const n = (x.reads.nums || {})[r.key]; return n && n[k] !== null && n[k] !== undefined ? n[k] : null; } });
    }
  }
  return out;
}

// ---- applying them (research.js sortedRows) ----
let RF_FIELDS = [];
function rfApply(rows) {
  RF_FIELDS = rfFields(rows);
  const byId = Object.fromEntries(RF_FIELDS.map((f) => [f.id, f]));
  return rows.filter((x) => (!RF.stats.length || RF.stats.includes(x.mk)) && RF.on.every((c) => {
    const f = byId[c.id];
    if (!f) return true; // a number this slate doesn't have (another stat's row): not applied
    const v = f.get(x);
    if (v === null || v === undefined || Number.isNaN(v)) return false;
    return (c.min === null || v >= c.min) && (c.max === null || v <= c.max);
  }));
}

// ---- the words ----
const rfUnit = (u) => (u === "%" ? "%" : u === "rank" ? "" : "");
const rfNum = (v, u) => (u === "rank" ? ordinal(v) : `${Number.isInteger(v) ? v : Number(v).toFixed(1)}${rfUnit(u)}`);
function rfRange(c, u) {
  if (c.min !== null && c.max !== null) return `${rfNum(c.min, u)} to ${rfNum(c.max, u)}`;
  return c.min !== null ? `${rfNum(c.min, u)} or more` : `${rfNum(c.max, u)} or less`;
}
const rfField = (id) => RF_FIELDS.find((f) => f.id === id);
const rfHue = (f) => (f.part ? (f.part.startsWith("Def") ? 275 : 210) : RF_GROUP_HUE[f.group] || 210);

// ---- saved screens (synced) ----
function rfScreens() {
  try { return JSON.parse(localStorage.getItem(RF_KEY) || "[]"); } catch (e) { return []; }
}
function rfSaveScreens(list) {
  try { localStorage.setItem(RF_KEY, JSON.stringify(list)); } catch (e) { /* storage off: not kept */ }
  window.NFLSync?.push(RF_KEY, list);
}
const rfEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- drawing ----
function rfChip(c, i) {
  const f = rfField(c.id);
  if (!f) return "";
  return `<span class="rf-chip" style="--pill-h:${rfHue(f)}" title="${rfEsc(f.hint || f.label)}"><b>${f.part ? `${f.group}: ` : ""}${rfEsc(f.label)}</b> ${rfRange(c, f.unit)}<button type="button" data-rf-del="${i}" aria-label="Remove this filter">&times;</button></span>`;
}
function rfStatPills() {
  if (!ALL_PROPS) return "";
  return `<span class="rf-stats">${ALL_ORDER.map((m) => `<button type="button" class="rf-stat${!RF.stats.length || RF.stats.includes(m) ? " on" : ""}" data-rf-stat="${m}" style="--pill-h:${STAT_HUE[m]}">${RS_MARKETS[m].unit}</button>`).join("")}</span>`;
}
function rfScreenBar() {
  const mine = rfScreens().filter((s) => s.page === RF_PAGE);
  const saved = mine.map((s) => `<span class="rf-screen"><button type="button" data-rf-load="${rfEsc(s.id)}" title="Use this screen">${rfEsc(s.name)}</button><button type="button" class="rf-x" data-rf-forget="${rfEsc(s.id)}" aria-label="Delete this screen">&times;</button></span>`).join("");
  const save = RF.naming
    ? `<span class="rf-name"><input type="text" id="rf-name" maxlength="40" placeholder="Name This Screen"><button type="button" class="view-toggle-btn" data-rf-save>Save</button></span>`
    : (RF.on.length || RF.stats.length ? '<button type="button" class="view-toggle-btn" data-rf-naming>Save This Screen</button>' : "");
  return `${saved ? `<span class="rf-saved"><span class="rf-lbl">My Screens</span>${saved}</span>` : ""}${save}`;
}
// The owner picked the fold-open panel from two mock-ups (2026-11-04: "thats amazing ... just stack things
// a little better ... too much dead space"): a "Filters" button opens every number in color-coded boxes,
// a min and a max box each, stacked into columns of about the same height with no gaps under them.
function rfBox(c, which) {
  const v = c ? c[which] : null;
  return `<input type="number" step="any" class="rf-in" data-rf-which="${which}"${v === null || v === undefined ? "" : ` value="${v}"`} placeholder="${which === "min" ? "Min" : "Max"}">`;
}
const rfUnitTag = (u, rank) => `<span class="rf-unit">${u === "%" ? "%" : u === "rank" && rank ? "rank" : ""}</span>`;
// the list's numbers: two columns, The Line + His Numbers, then Defense + Reads + Tonight's Game
const RF_LIST_COLS = [["The Line", "His Numbers"], ["Defense", "Reads", "Tonight's Game"]];
function rfListBox(g, on) {
  const fs = RF_FIELDS.filter((f) => !f.part && f.group === g);
  if (!fs.length) return "";
  return `<div class="rf-box" style="--pill-h:${RF_GROUP_HUE[g] || 210}"><div class="rf-bhead">${g}</div>${fs.map((f) => `<div class="rf-line${on(f.id) ? " on" : ""}" data-rf-id="${rfEsc(f.id)}" title="${rfEsc(f.hint)}"><span class="rf-l">${rfEsc(f.label)}</span>${rfBox(on(f.id), "min")}${rfBox(on(f.id), "max")}${rfUnitTag(f.unit, true)}</div>`).join("")}</div>`;
}
function rfTabBox(t, on) {
  const panel = RF_FIELDS.filter((f) => f.part && f.group === t);
  const rows = [...new Set(panel.map((f) => f.row))];
  return `<div class="rf-box"><div class="rf-bhead rf-tab">${t}</div><table class="rf-grid"><thead><tr><th></th>${RF_PARTS.map(([, part, , hint]) => `<th class="${part.startsWith("Def") ? "rf-def" : "rf-him"}" title="${hint}">${part}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><td class="rf-l">${rfEsc(r)}</td>${RF_PARTS.map(([k]) => {
    const f = panel.find((x) => x.row === r && x.id.endsWith(`|${k}`));
    return `<td class="rf-pair${on(f.id) ? " on" : ""}" data-rf-id="${rfEsc(f.id)}">${rfBox(on(f.id), "min")}${rfBox(on(f.id), "max")}${rfUnitTag(f.unit, false)}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
}
// The panel tabs go in as many columns as it takes to match the list columns' height (a tab = its rows +
// 2 for its headers), split where the tallest column is shortest; tabs keep their order.
function rfTabColumns(tabs) {
  const size = (t) => new Set(RF_FIELDS.filter((f) => f.part && f.group === t).map((f) => f.row)).size + 2;
  const listH = Math.max(...RF_LIST_COLS.map((col) => col.reduce((n, g) => n + RF_FIELDS.filter((f) => !f.part && f.group === g).length + 1, 0)));
  const total = tabs.reduce((n, t) => n + size(t), 0);
  const k = Math.max(1, Math.min(tabs.length, Math.round(total / listH)));
  let best = null;
  const split = (from, cols, acc) => {
    if (cols === 1) {
      const all = [...acc, tabs.slice(from)];
      const tall = Math.max(...all.map((c) => c.reduce((n, t) => n + size(t), 0)));
      if (!best || tall < best.tall) best = { tall, all };
      return;
    }
    for (let i = from + 1; i <= tabs.length - cols + 1; i += 1) split(i, cols - 1, [...acc, tabs.slice(from, i)]);
  };
  if (tabs.length) split(0, k, []);
  return best ? best.all : [];
}
function rfPanelB() {
  const on = (id) => RF.on.find((c) => c.id === id) || null;
  const col = (html) => (html ? `<div class="rf-col">${html}</div>` : "");
  const lists = RF_LIST_COLS.map((gs) => col(gs.map((g) => rfListBox(g, on)).join(""))).join("");
  const tabs = [...new Set(RF_FIELDS.filter((f) => f.part).map((f) => f.group))];
  const panels = rfTabColumns(tabs).map((ts) => col(ts.map((t) => rfTabBox(t, on)).join(""))).join("");
  return `<div class="rf-panel">${lists}${panels}</div>`;
}
function rfBarB() {
  return `<div class="rf-bar"><button type="button" class="rf-add${RF.open ? " on" : ""}" data-rf-toggle>Filters${RF.on.length ? ` (${RF.on.length})` : ""} ${RF.open ? "&#9652;" : "&#9662;"}</button>${rfStatPills()}${RF.on.map(rfChip).join("")}${RF.on.length ? '<button type="button" class="rf-clear" data-rf-clear>Clear</button>' : ""}<span class="rf-gap"></span>${rfScreenBar()}</div>${RF.open ? rfPanelB() : ""}`;
}
// research.js calls this after every list draw; the bar is redrawn only when something it shows changed,
// so a box being typed in keeps its focus.
function rfRender(force) {
  const box = document.getElementById("rs-filters");
  if (!box) return;
  const sig = JSON.stringify([RF.on, RF.stats, RF.open, RF.naming, RF_FIELDS.length, rfScreens().length]);
  if (!force && sig === RF.sig) return;
  RF.sig = sig;
  box.innerHTML = rfBarB();
}
const rfNumIn = (el) => (el && el.value.trim() !== "" && !Number.isNaN(Number(el.value)) ? Number(el.value) : null);
function rfSet(id, min, max) {
  RF.on = RF.on.filter((c) => c.id !== id);
  if (min !== null || max !== null) RF.on.push({ id, min, max });
}
const rfRedraw = () => { renderList(); rfRender(); };

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-rf-clear-list]")) { RF.on = []; RF.stats = []; return rfRedraw(); } // the empty list's button
  if (!t.closest("#rs-filters")) return;
  const del = t.closest("[data-rf-del]");
  if (del) { RF.on.splice(Number(del.dataset.rfDel), 1); return rfRedraw(); }
  if (t.closest("[data-rf-toggle]")) { RF.open = !RF.open; return rfRender(true); }
  if (t.closest("[data-rf-clear]")) { RF.on = []; RF.stats = []; return rfRedraw(); }
  const stat = t.closest("[data-rf-stat]");
  if (stat) {
    const all = RF.stats.length ? RF.stats : [...ALL_ORDER];
    const m = stat.dataset.rfStat;
    const next = all.includes(m) ? all.filter((x) => x !== m) : [...all, m];
    RF.stats = next.length === ALL_ORDER.length || !next.length ? [] : next;
    return rfRedraw();
  }
  if (t.closest("[data-rf-naming]")) { RF.naming = true; rfRender(true); document.getElementById("rf-name")?.focus(); return; }
  if (t.closest("[data-rf-save]")) {
    const name = (document.getElementById("rf-name")?.value || "").trim();
    if (!name) return;
    const list = rfScreens().filter((s) => !(s.page === RF_PAGE && s.name === name));
    list.push({ id: `${RF_PAGE}:${Date.now()}`, page: RF_PAGE, name, filters: RF.on, stats: RF.stats, saved: new Date().toISOString() });
    rfSaveScreens(list);
    RF.naming = false;
    return rfRender(true);
  }
  const load = t.closest("[data-rf-load]");
  if (load) {
    const s = rfScreens().find((x) => x.id === load.dataset.rfLoad);
    if (s) { RF.on = (s.filters || []).map((c) => ({ ...c })); RF.stats = [...(s.stats || [])]; }
    return rfRedraw();
  }
  const forget = t.closest("[data-rf-forget]");
  if (forget) { rfSaveScreens(rfScreens().filter((x) => x.id !== forget.dataset.rfForget)); return rfRender(true); }
});
document.addEventListener("change", (e) => {
  const box = e.target.closest("#rs-filters .rf-in");
  if (box) {
    const cell = box.closest("[data-rf-id]");
    const ins = cell.querySelectorAll(".rf-in");
    rfSet(cell.dataset.rfId, rfNumIn(ins[0]), rfNumIn(ins[1]));
    renderList();
    rfRender(true);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.closest("#rs-filters")) return;
  if (e.target.id === "rf-name") document.querySelector("#rs-filters [data-rf-save]")?.click();
});
