// The YTD Model Performance tracker: ONE look for every model's record on
// every sport (the owner, 2026-10-22: "streamline all the YTD model
// performance functions to be identical with filters and sliders. Make this
// standard ... so when we add new NBA or NFL tools, this happens
// automatically"). It was NHL Best Plays' popup; every page now draws it here.
//
// What a page hands it: a `ledger` per market, every graded play of the
// season as short rows `[date "YYYY-MM-DD", value, won 1/0, units or null,
// tags]` (NHL: `record_ledger` in build_nhl.py). `value` is what the slider
// cuts on (an edge, or a pick's chance), compared as the tables round it
// (0.0996 counts as 10.0). `units` null = a pick with no price: the tile
// shows the win % alone. `tags` (optional) = the split tiles a row counts in
// ("over", "under", "fade", ...).
//
//   ytdTracker(box, {
//     key: "nhl-shots",                       // the per-device memory
//     all: "All Plays",                       // optional: a tile adding up every market
//     markets: [{ key, label, tip, ledger, min, max, step, slider: "Min Edge", unit: "" ,
//                 only: ["strong", "lean"],   // optional: just the rows with one of these tags
//                 splits: [["over", "Overs"], ...] }],
//     onChange: () => {},                     // the page redraws its own list (ytdKeeps)
//   });
//
// A new model's YTD popup is this call plus its ledger; tests/test_ytd_site.py
// fails for a page with a YTD button that doesn't load ytd.js.

const YTD_WINDOWS = [["yesterday", "Yesterday"], [3, "Last 3 Days"], [7, "Last 7 Days"], [15, "Last 15 Days"], [30, "Last 30 Days"], [0, "Season"]];
const YTD_TRACKERS = {};

function ytdDay(back) {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString("en-CA");
}
// The window's first and last day ("" = no limit). "Last N days" counts today.
function ytdRange(days) {
  if (days === "yesterday") return { from: ytdDay(1), to: ytdDay(1) };
  if (!days) return { from: "", to: "" };
  return { from: ytdDay(days - 1), to: "" };
}
const ytdShown = (value, scale) => Math.round(value * scale * 10) / 10;

function ytdLoad(cfg) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(`nfl-tool.ytd.${cfg.key}.v1`)) || {};
  } catch (e) {
    saved = {};
  }
  const min = {};
  cfg.markets.forEach((m) => {
    const v = (saved.min || {})[m.key];
    min[m.key] = Number.isFinite(v) ? Math.max(m.min, Math.min(m.max, v)) : m.min;
  });
  return { days: YTD_WINDOWS.some(([d]) => d === saved.days) ? saved.days : 0, min };
}
function ytdSave(t) {
  try {
    localStorage.setItem(`nfl-tool.ytd.${t.cfg.key}.v1`, JSON.stringify(t.state));
  } catch (e) {
    /* private window: the choice just isn't remembered */
  }
}

// Does a play pass the tracker's window and its market's slider? For the
// page's own list under the tiles, so the list and the tiles always agree.
function ytdKeeps(key, market, date, value) {
  const t = YTD_TRACKERS[key];
  if (!t) return true;
  const { from, to } = ytdRange(t.state.days);
  const m = t.cfg.markets.find((x) => x.key === market) || t.cfg.markets[0];
  return (!from || date >= from) && (!to || date <= to) && (value === null || value === undefined || ytdShown(value, m.scale || 100) >= t.state.min[m.key]);
}

function ytdTally(t, m, tag) {
  const { from, to } = ytdRange(t.state.days);
  const min = t.state.min[m.key];
  return (m.ledger || []).reduce((s, [date, value, won, units, tags]) => {
    if ((from && date < from) || (to && date > to) || ytdShown(value, m.scale || 100) < min) return s;
    if (tag && !(tags || []).includes(tag)) return s;
    if (m.only && !(tags || []).some((x) => m.only.includes(x))) return s;
    return { wins: s.wins + (won ? 1 : 0), losses: s.losses + (won ? 0 : 1), units: units === null || units === undefined ? s.units : s.units + units, priced: s.priced || (units !== null && units !== undefined) };
  }, { wins: 0, losses: 0, units: 0, priced: false });
}
function ytdBody(s) {
  const played = s.wins + s.losses;
  const rate = played ? s.wins / played : 0;
  const kind = !played ? "" : s.priced ? (s.units > 0.05 ? " ytd-up" : s.units < -0.05 ? " ytd-down" : "") : rate > 0.5 ? " ytd-up" : rate < 0.5 ? " ytd-down" : "";
  const units = s.priced ? ` &middot; ${s.units >= 0 ? "+" : ""}${s.units.toFixed(1)}u` : "";
  return `<b>${s.wins}-${s.losses}</b><small class="ytd-line${kind}">${played ? `${Math.round(100 * rate)}%${units}` : "No Graded Plays"}</small>`;
}
const ytdMinText = (m, v) => `${v}${m.unit === undefined ? "+" : m.unit}`;

function ytdTracker(box, cfg) {
  if (!box) return;
  // A redraw keeps the member's choices (they may not be saved: a private window).
  const t = { cfg, state: (YTD_TRACKERS[cfg.key] || {}).state || ytdLoad(cfg), box };
  YTD_TRACKERS[cfg.key] = t;
  box.dataset.ytd = cfg.key;
  // One dropdown for the time frame (the owner, 2026-10-23: not a row of buttons).
  const windows = `<label class="ytd-window-pick"><span>Time Frame</span><select class="ytd-window" data-ytd-window aria-label="Time Frame">${YTD_WINDOWS.map(([d, label]) => `<option value="${d}" data-ytd-days="${d}"${t.state.days === d ? " selected" : ""}>${label}</option>`).join("")}</select></label>`;
  const slider = (m) => `<label class="ytd-slider"><span>${m.slider || "Min Edge"}</span><input type="range" min="${m.min}" max="${m.max}" step="${m.step || 1}" value="${t.state.min[m.key]}" data-ytd-min="${m.key}" aria-label="${m.slider || "Min Edge"}, ${m.label}"><output data-ytd-out="${m.key}"></output></label>`;
  const tiles = [];
  if (cfg.all && cfg.markets.length > 1) tiles.push(`<div class="ytd-tile ytd-all" title="Every market, each at its own minimum"><div class="ytd-label">${cfg.all}</div><div data-ytd-body="__all"></div><small class="ytd-sub" data-ytd-sub="__all"></small></div>`);
  cfg.markets.forEach((m) => {
    tiles.push(`<div class="ytd-tile" title="${m.tip || ""}"><div class="ytd-label">${m.label}</div><div data-ytd-body="${m.key}"></div>${slider(m)}</div>`);
    (m.splits || []).forEach(([tag, label, tip]) => tiles.push(`<div class="ytd-tile ytd-split" title="${tip || ""}"><div class="ytd-label">${label}</div><div data-ytd-body="${m.key}:${tag}"></div><small class="ytd-sub" data-ytd-sub="${m.key}:${tag}"></small></div>`));
  });
  box.innerHTML = `<div class="ytd-windows">${windows}</div><div class="ytd-tiles">${tiles.join("")}</div>`;
  ytdUpdate(t);
}
// Only the numbers: a slider being dragged keeps its place.
function ytdUpdate(t) {
  const put = (sel, html) => {
    const node = t.box.querySelector(sel);
    if (node) node.innerHTML = html;
  };
  const total = { wins: 0, losses: 0, units: 0, priced: false };
  t.cfg.markets.forEach((m) => {
    const s = ytdTally(t, m);
    total.wins += s.wins;
    total.losses += s.losses;
    total.units += s.units;
    total.priced = total.priced || s.priced;
    put(`[data-ytd-body="${m.key}"]`, ytdBody(s));
    put(`[data-ytd-out="${m.key}"]`, ytdMinText(m, t.state.min[m.key]));
    (m.splits || []).forEach(([tag]) => {
      put(`[data-ytd-body="${m.key}:${tag}"]`, ytdBody(ytdTally(t, m, tag)));
      put(`[data-ytd-sub="${m.key}:${tag}"]`, `${m.slider || "Min Edge"} ${ytdMinText(m, t.state.min[m.key])}`);
    });
  });
  put('[data-ytd-body="__all"]', ytdBody(total));
  put('[data-ytd-sub="__all"]', t.cfg.markets.map((m) => `${m.short || m.label} ${ytdMinText(m, t.state.min[m.key])}`).join(" &middot; "));
}

document.addEventListener("input", (e) => {
  const market = e.target.dataset && e.target.dataset.ytdMin;
  const box = market && e.target.closest("[data-ytd]");
  const t = box && YTD_TRACKERS[box.dataset.ytd];
  if (!t) return;
  t.state.min[market] = Number(e.target.value);
  ytdSave(t);
  ytdUpdate(t);
  if (t.cfg.onChange) t.cfg.onChange();
});
document.addEventListener("change", (e) => {
  const pick = e.target.closest && e.target.closest("[data-ytd-window]");
  const box = pick && pick.closest("[data-ytd]");
  const t = box && YTD_TRACKERS[box.dataset.ytd];
  if (!t) return;
  const v = pick.value;
  t.state.days = v === "yesterday" ? v : Number(v);
  ytdSave(t);
  ytdUpdate(t);
  if (t.cfg.onChange) t.cfg.onChange();
});
