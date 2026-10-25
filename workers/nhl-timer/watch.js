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
// It never stacks runs: nothing is pressed while an NBA refresh or a full
// rebuild is queued or running (the full rebuild reads the injuries itself),
// or within REPRESS_MINUTES of the last refresh starting (a refresh that
// failed or stood aside is pressed again after that, not every minute).

const REPO = "https://api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/workflows";
const VERSION = "https://nfl.gmgsports.org/version.json";
const ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const NBA_LINEUPS = (day) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${day}.json`;
const LISTED = ["Confirmed", "Expected"];
export const REPRESS_MINUTES = 4;

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
  if (!watch || !(watch.teams || []).length) return "no game left tonight";
  // Either source may fail on its own; the other is still compared.
  const [injuries, lineups] = await Promise.all([
    getJson(ESPN_INJURIES).catch(() => null),
    getJson(NBA_LINEUPS(watch.day), { Referer: "https://www.nba.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" }).catch(() => null),
  ]);
  const changed = await changes(watch, injuries, lineups);
  if (!changed) return "nothing changed";
  const [refreshes, deploys] = await Promise.all([github("nba-refresh.yml/runs?per_page=1"), github("deploy.yml/runs?per_page=5")]);
  const busy = (runs) => (runs.workflow_runs || []).some((r) => r.status !== "completed");
  if (busy(deploys)) return "a full rebuild is running";
  if (busy(refreshes)) return "an NBA refresh is running";
  const last = (refreshes.workflow_runs || [])[0];
  if (last && Date.now() - Date.parse(last.created_at) < REPRESS_MINUTES * 60000) return "the last refresh started under 4 minutes ago";
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
