// The NHL refresh's clock (2026-10-15). GitHub's own timer was late or
// skipped most hours (that day the hourly NHL refresh ran 1 of 6 times), so
// Cloudflare keeps time instead: at every cron in wrangler.toml this presses
// "Run workflow" on .github/workflows/nhl-refresh.yml with source "timer",
// exactly like the owner's "Update Odds" button. Every decision (a game about
// to start, a full rebuild running, code that isn't live) stays in that
// workflow's checks (tools/ci_steps.py refresh-check).
//
// DISPATCH_TOKEN: a GitHub fine-grained token for this repo only, Actions read
// and write, set by .github/workflows/nhl-timer.yml from the GitHub secret
// NHL_TRIGGER_TOKEN. No address answers: the Worker has no route.

const DISPATCH = "https://api.github.com/repos/GreenMeansGoBetting/nfl-tool/actions/workflows/nhl-refresh.yml/dispatches";

export default {
  async scheduled(controller, env) {
    const resp = await fetch(DISPATCH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gmg-nhl-timer",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { source: "timer" } }),
    });
    // 204 = the run is queued. Anything else shows as a failed run in the
    // Worker's logs (an expired token: 401).
    if (resp.status !== 204) {
      throw new Error(`GitHub answered ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
  },
};
