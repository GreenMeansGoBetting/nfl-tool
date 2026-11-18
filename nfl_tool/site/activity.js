// ---- Member Activity (owner only, 2026-11-18) ----
// DAU and MAU from /api/activity (functions/_middleware.js), which answers only the owner and only
// ever sends counts. Days are Eastern. Today isn't over, so it is never colored or averaged in; every
// finished day is colored against the other finished days (the most = green).

const actDate = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
const actPct = (x) => (x === null ? "--" : `${Math.round(x * 100)}%`);
const actDaysSince = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
// MAU only means something once its whole window has been counted: until then it just climbs, and
// DAU / MAU reads far too high (day one is 100%), so those stay plain and blank.
const actFull = (data, d) => actDaysSince(data.first, d.day) >= data.window;
const actShare = (data, d) => (d.mau && actFull(data, d) ? d.dau / d.mau : null);

function actShade(value, pool) {
  const nums = pool.filter((x) => x !== null);
  if (value === null || new Set(nums).size < 2) return "";
  return rankScaleStyle(1 + nums.filter((x) => x > value).length, nums.length);
}
const actTile = (text, shade, tip) => `<div class="od-tile act-tile"${shade} title="${tip}"><b>${text}</b></div>`;
const actCell = (group, tile, edge = "od-gl od-gr") => `<td class="${group} od-gt ${edge}">${tile}</td>`;

function actSummary(data) {
  const [today, ...done] = data.days;
  const week = done.slice(0, 7);
  const avg = week.length ? week.reduce((sum, d) => sum + d.dau, 0) / week.length : null;
  const last = done[0] || null;
  const dauPool = done.map((d) => d.dau);
  const sharePool = done.map((d) => actShare(data, d));
  const share = avg !== null && actShare(data, last) !== null ? avg / last.mau : null;
  const mauPool = data.days.filter((d) => actFull(data, d)).map((d) => d.mau);
  return `<div class="act-box"><table class="data-table od-grid od-detail act-grid">
    <thead>
      <tr class="od-ggroups"><th class="od-g1" colspan="3">DAU</th><th class="od-ggap"></th><th class="od-g0 od-gone" rowspan="2">MAU</th><th class="od-ggap"></th><th class="od-g2 od-gone" rowspan="2">DAU &divide; MAU</th></tr>
      <tr class="od-glabels"><th class="od-g1 od-gt od-gl">Today</th><th class="od-g1 od-gt">Yesterday</th><th class="od-g1 od-gt od-gr">7-Day Avg</th><th class="od-ggap"></th><th class="od-ggap"></th></tr>
    </thead>
    <tbody><tr>
      ${actCell("od-g1", actTile(today.dau, "", "Members Active So Far Today"), "od-gl")}
      ${actCell("od-g1", actTile(last ? last.dau : "--", last ? actShade(last.dau, dauPool) : "", "Members Active Yesterday"), "")}
      ${actCell("od-g1", actTile(avg === null ? "--" : avg.toFixed(1), avg === null ? "" : actShade(avg, dauPool), "Average Over The Last 7 Finished Days"), "od-gr")}
      <td class="od-ggap"></td>
      ${actCell("od-g0", actTile(today.mau, actFull(data, today) ? actShade(today.mau, mauPool) : "", `Different Members Active In The Last ${data.window} Days`))}
      <td class="od-ggap"></td>
      ${actCell("od-g2", actTile(actPct(share), share === null ? "" : actShade(share, sharePool), "7-Day Avg DAU Divided By MAU: How Often Monthly Members Come Back"))}
    </tr></tbody></table></div>`;
}

function actLog(data) {
  const done = data.days.slice(1);
  const dauPool = done.map((d) => d.dau);
  const mauPool = done.filter((d) => actFull(data, d)).map((d) => d.mau);
  const sharePool = done.map((d) => actShare(data, d));
  const rows = data.days.map((d, i) => {
    const isToday = i === 0;
    const share = isToday ? null : actShare(data, d);
    return `<tr><td class="od-g3 od-gt od-gl od-gr od-label act-day">${isToday ? "Today" : actDate(d.day)}</td><td class="od-ggap"></td>
      ${actCell("od-g1", actTile(d.dau, isToday ? "" : actShade(d.dau, dauPool), "Members Active This Day"), "od-gl")}
      ${actCell("od-g1", actTile(d.mau, isToday || !actFull(data, d) ? "" : actShade(d.mau, mauPool), `Different Members Active In The ${data.window} Days Ending This Day`), "od-gr")}
      <td class="od-ggap"></td>
      ${actCell("od-g2", actTile(actPct(share), share === null ? "" : actShade(share, sharePool), "That Day's DAU Divided By Its MAU"))}</tr>`;
  }).join("");
  return `<div class="act-box"><table class="data-table od-grid od-detail act-grid">
    <thead>
      <tr class="od-ggroups"><th class="od-g3 od-gone" rowspan="2">Date</th><th class="od-ggap"></th><th class="od-g1" colspan="2">Active Members</th><th class="od-ggap"></th><th class="od-g2 od-gone" rowspan="2">DAU &divide; MAU</th></tr>
      <tr class="od-glabels"><th class="od-ggap"></th><th class="od-g1 od-gt od-gl">DAU</th><th class="od-g1 od-gt od-gr">MAU</th><th class="od-ggap"></th></tr>
    </thead><tbody>${rows}</tbody></table></div>`;
}

function actRender(data) {
  const body = document.getElementById("act-body");
  if (!data.days.length) {
    body.innerHTML = '<p class="act-note">No visits counted yet. Counting starts when the first member opens the site.</p>';
    return;
  }
  const elapsed = actDaysSince(data.first, data.today);
  const filling = elapsed < data.window ? ` Counting started ${actDate(data.first)}, so MAU covers ${elapsed} of ${data.window} days so far. DAU &divide; MAU starts once all ${data.window} are counted.` : "";
  body.innerHTML = `<p class="act-note">Signed-in members, each counted once a day across every sport and device. Days run on Eastern time.${filling}</p>${actSummary(data)}${actLog(data)}`;
}

async function actLoad() {
  const body = document.getElementById("act-body");
  try {
    const res = await fetch("/api/activity", { credentials: "same-origin", cache: "no-store" });
    if (res.ok) return actRender(await res.json());
    body.innerHTML = `<p class="act-note">${res.status === 503 ? "Activity isn't available right now." : "This page isn't open."}</p>`;
  } catch (e) {
    body.innerHTML = '<p class="act-note">Activity isn\'t available right now.</p>';
  }
}
actLoad();
