// The NBA injury watch (2026-10-25). The owner: "Within 5 minutes of a player
// being ruled out for their team, sims rerun and give new lines with the more
// accurate game."
//
// Every minute (wrangler.toml) this reads what the last NBA build's sims knew
// about who plays tonight (version.json nba.watch: tonight's teams that
// haven't tipped and two fingerprints, ESPN's injury statuses and the NBA's
// posted fives), reads ESPN and the NBA now, and when either fingerprint
// differs presses "Run workflow" on .github/workflows/nba-refresh.yml with
// source "watch". The fingerprints are nfl_tool/nba/watch.py's, to the letter
// (tests/test_nba_watch.py runs both on the same sample).
//
// The NBA's official injury report (a PDF every 15 minutes) can't be read
// here, so a newly posted one presses the refresh with source "report" and
// its first step (nba_report.py --changed) reads it and stops unless tonight's
// statuses changed (version.json nba.watch.rep). Once per report: not again
// after a refresh that started after the report was posted.
//
// Last night's plays are graded the same way (2026-10-26: 10-25's sat ungraded
// all morning). The box scores land about 7:35 am Eastern and nothing rebuilt
// the NBA until the day's injury news, so while version.json nba.watch.ungraded
// is above 0 this presses the refresh with source "grade", at most once every
// GRADE_MINUTES (the box scores may be late), from 8 am Eastern (wrangler.toml).
// 2026-10-30: the box scores landed at 8:03, three minutes after the 8:00 press,
// and the next waited an hour (then behind two deploys): plays sat until 9:50.
// So the box-score file is HEADed too, and a copy newer than the last NBA build
// presses at once (that build is then newer, so once per copy).
//
// Graded overnight, not after breakfast (2026-10-31, the third morning running
// that last night's plays sat ungraded; the owner: "by 6am the following
// morning, all nba plays are graded"). hoopR's files land about 7:30 am, so
// the build now takes a finished game straight from ESPN (espn_late.py) and
// this runs all night. The build lists the games still to finish
// (version.json nba.watch.grade); ESPN's scoreboard is read for their dates
// and a game final there presses the refresh with source "grade" (again after
// FINAL_MINUTES if that refresh didn't publish). And once a night, the first
// minute after midnight Eastern with no build since (watch.day is
// yesterday's), so last night's plays move to Results.
//
// The odds again after a ruling (2026-10-28, the night Luka was ruled out):
// the refresh ran within a minute of the news, before the books moved
// (Reaves 23.5 on our page, 26.5 on FanDuel), and nothing fetched the odds
// again. The build writes version.json nba.watch.recheck (10, 25 and 40
// minutes after a 20+ minute player is first seen Out, watch.py recheck);
// once that time passes this presses the refresh with source "recheck".
//
// It never stacks runs: nothing is pressed while an NBA refresh or a full
// rebuild is queued or running (the full rebuild reads the injuries itself),
// or within REPRESS_MINUTES of the last refresh starting (a refresh that
// failed or stood aside is pressed again after that, not every minute).

const REPO = "https://api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/workflows";
const VERSION = "https://nfl.gmgsports.org/version.json";
const ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const NBA_LINEUPS = (day) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${day}.json`;
const NBA_REPORT = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_";
const LISTED = ["Confirmed", "Expected"];
export const REPRESS_MINUTES = 4;
export const GRADE_MINUTES = 60;
export const FINAL_MINUTES = 10;
const SCOREBOARD = (day) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day}`;

// "YYYYMMDD", Eastern, for a time in ms
export function easternDay(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}`;
}

// The games the live build had unfinished (watch.grade) that ESPN's scoreboard has final now.
export async function newFinals(watch) {
  const waiting = watch.grade || [];
  const done = new Set();
  for (const day of [...new Set(waiting.map((g) => g[1]))]) {
    const board = await getJson(SCOREBOARD(day)).catch(() => null);
    for (const e of (board && board.events) || []) {
      if (e.status && e.status.type && e.status.type.completed) done.add(String(e.id));
    }
  }
  return waiting.filter((g) => done.has(String(g[0]))).map((g) => String(g[0]));
}
// hoopR's box scores (build_nba.py FILES["player_box"]; the season = the year it ends)
const BOX_FILE = (year) => `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_player_boxscores/player_box_${year}.parquet`;

// True when the box-score file was replaced after the NBA build that counted the waiting
// plays and after the last refresh started (a refresh that failed waits out the hour).
export async function newBoxScores(built, lastStarted, now = new Date(Date.now())) {
  const builtAt = Math.max(Date.parse(String(built || "").replace(/Z?$/, "Z")) || 0, Date.parse(lastStarted || "") || 0);
  if (!builtAt) return false;
  const year = now.getUTCFullYear() + (now.getUTCMonth() >= 8 ? 1 : 0);
  const resp = await fetch(BOX_FILE(year), { method: "HEAD", cf: { cacheTtl: 0 } }).catch(() => null);
  const at = resp && resp.ok ? Date.parse(resp.headers.get("Last-Modified") || "") : NaN;
  return at > builtAt;
}

// ---- the fingerprints (watch.py's digest / injury_rows / lineup_rows) ----
export async function digest(rows) {
  const text = [...rows].sort().join("\n");
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function injuryRows(body, teamIds) {
  const want = new Set(teamIds.map(Number));
  const rows = [];
  for (const t of (body && body.injuries) || []) {
    if (!want.has(Number(t.id || 0))) continue;
    for (const i of t.injuries || []) {
      const found = JSON.stringify(i.athlete || {}).match(/\/athletes\/(\d+)/);
      if (found) rows.push(`${found[1]}:${i.status || ""}`);
    }
  }
  return rows;
}

export function lineupRows(day, abbrs) {
  const want = new Set(abbrs);
  const rows = [];
  for (const g of (day && day.games) || []) {
    for (const side of ["homeTeam", "awayTeam"]) {
      const t = g[side] || {};
      if (!want.has(t.teamAbbreviation)) continue;
      const names = (t.players || [])
        .filter((x) => x.rosterStatus !== "Inactive" && LISTED.includes(x.lineupStatus))
        .slice(0, 5)
        .map((x) => String(x.playerName || ""));
      rows.push(`${t.teamAbbreviation}=${names.sort().join("|")}`);
    }
  }
  return rows;
}

// ---- the NBA's report (nba_report.py slot_url / slot_utc) ----
// The address of the 15-minute slot at or before `at`, Eastern time, and that slot as UTC "YYYY-MM-DDTHH:MMZ".
export function reportSlot(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(at).map((p) => [p.type, p.value]));
  const mm = String(Number(parts.minute) - (Number(parts.minute) % 15)).padStart(2, "0");
  const hh = String(Number(parts.hour)).padStart(2, "0");
  const url = `${NBA_REPORT}${parts.year}-${parts.month}-${parts.day}_${hh}_${mm}${parts.dayPeriod.toUpperCase()}.pdf`;
  const slot = new Date(Math.floor(at.getTime() / 900000) * 900000);
  return { url, at: slot.toISOString().slice(0, 16) + "Z" };
}

// A report posted since the one the live build read: { at, posted } or null.
async function newReport(watch) {
  const now = new Date(Date.now());
  for (const back of [0, 1]) {
    const { url, at } = reportSlot(new Date(now.getTime() - back * 900000));
    if (watch.rep_at && at <= watch.rep_at) return null;
    const resp = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 0 } }).catch(() => null);
    if (resp && resp.ok) return { at, posted: Date.parse(resp.headers.get("Last-Modified") || "") || now.getTime() };
  }
  return null;
}

// ---- once a minute ----
async function getJson(url, headers = {}) {
  const resp = await fetch(url, { headers: { "User-Agent": "gmg-nba-watch", ...headers }, cf: { cacheTtl: 0 } });
  if (resp.status === 404) return { missing: true };
  if (!resp.ok) throw new Error(`${url} answered ${resp.status}`);
  return resp.json();
}

// What changed, or null: { inj, lu } per part, true when it differs.
export async function changes(watch, injuryBody, lineupDay) {
  const out = {};
  if (injuryBody && !injuryBody.missing) out.inj = watch.inj !== (await digest(injuryRows(injuryBody, watch.teams)));
  if (lineupDay) out.lu = watch.lu !== (await digest(lineupRows(lineupDay.missing ? {} : lineupDay, watch.nba)));
  return out.inj || out.lu ? out : null;
}

export async function nbaWatch(env, github) {
  const version = await getJson(`${VERSION}?t=${Date.now()}`);
  const watch = version && version.nba && version.nba.watch;
  if (!watch) return "no NBA watch in version.json";
  const finished = await newFinals(watch);
  const newDay = !!watch.day && watch.day < easternDay(Date.now());
  const grade = (watch.ungraded || 0) > 0 || finished.length > 0 || newDay;
  if (!(watch.teams || []).length && !grade) return "no game left tonight";
  // Either source may fail on its own; the other is still compared.
  const [injuries, lineups] = !(watch.teams || []).length ? [null, null] : await Promise.all([
    getJson(ESPN_INJURIES).catch(() => null),
    getJson(NBA_LINEUPS(watch.day), { Referer: "https://www.nba.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" }).catch(() => null),
  ]);
  const changed = await changes(watch, injuries, lineups);
  const report = changed || !(watch.teams || []).length ? null : await newReport(watch);
  const recheck = !changed && !report && watch.recheck && Date.now() >= Date.parse(watch.recheck) ? watch.recheck : null;
  if (!changed && !report && !recheck && !grade) return "nothing changed";
  const [refreshes, deploys] = await Promise.all([github("nba-refresh.yml/runs?per_page=1"), github("deploy.yml/runs?per_page=5")]);
  const busy = (runs) => (runs.workflow_runs || []).some((r) => r.status !== "completed");
  if (busy(deploys)) return "a full rebuild is running";
  if (busy(refreshes)) return "an NBA refresh is running";
  const last = (refreshes.workflow_runs || [])[0];
  if (last && Date.now() - Date.parse(last.created_at) < REPRESS_MINUTES * 60000) return "the last refresh started under 4 minutes ago";
  if (recheck) {
    await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "recheck" } });
    return `refresh started (the odds again after a ruling, due ${recheck})`;
  }
  if (!changed && !report) {
    const since = last ? Date.now() - Date.parse(last.created_at) : Infinity;
    if (finished.length && since >= FINAL_MINUTES * 60000) {
      await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "grade" } });
      return `refresh started (final on ESPN: ${finished.join(", ")})`;
    }
    if (newDay && (!last || easternDay(Date.parse(last.created_at)) < easternDay(Date.now()))) {
      await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "grade" } });
      return "refresh started (a new day: last night's plays to Results)";
    }
    if (!(watch.ungraded > 0)) return "waiting on the last refresh to publish";
    const fresh = await newBoxScores(version.nba.built, last && last.created_at);
    if (!fresh && last && Date.now() - Date.parse(last.created_at) < GRADE_MINUTES * 60000) return `${watch.ungraded} plays wait on a box score; the last refresh was under an hour ago`;
    await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "grade" } });
    return `refresh started (${watch.ungraded} plays to grade)`;
  }
  if (!changed) {
    // the report: once, by the first refresh that starts after it was posted (which reads it)
    if (last && Date.parse(last.created_at) > report.posted) return `the ${report.at} report was already read`;
    await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "report" } });
    return `refresh started (a new NBA report, ${report.at})`;
  }
  await github("nba-refresh.yml/dispatches", { ref: "main", inputs: { source: "watch" } });
  return `refresh started (${Object.keys(changed).filter((k) => changed[k]).join(", ")} changed)`;
}

export function githubClient(token) {
  return async (path, body) => {
    const resp = await fetch(`${REPO}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gmg-nba-watch",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // a press answers 204; a read 200. Anything else (an expired token: 401) fails the run in the Worker's logs.
    if (resp.status !== (body ? 204 : 200)) throw new Error(`GitHub answered ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    return body ? null : resp.json();
  };
}
