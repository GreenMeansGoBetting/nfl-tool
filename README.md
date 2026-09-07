# NFL TD Cheatsheet

A matchup lookup tool for anytime-TD and first-TD betting props: pick two
teams and see each side's touchdown-scoring tendencies (pass/rush/total TD
per game, first-TD-of-game rate, which positions score/allow TDs) laid out
against the other side's tendencies allowed — plus each team's season TD
leaderboard (anytime TD + first-TD counts per player). Raw numbers only,
color-coded by where a team ranks league-wide — no picks, no scores.

It's a plain static site (HTML/CSS/JS reading one `data.json` file) rebuilt
daily and hosted free on your own domain via GitHub Pages, the same setup as
the [CFB tool](https://github.com/GreenMeansGoBetting/cfb-tool). Unlike the
CFB tool, this one needs **no API key** — the data source
([nflverse-data](https://github.com/nflverse/nflverse-data)) is fully public.

## First-time local setup

**1. Install Python** (3.9+) if you don't already have it: https://www.python.org/downloads/

**2. Open a terminal in this folder and run:**
```bash
pip install -r nfl_tool/requirements.txt
```
```bash
python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json
```
This downloads the season's play-by-play + roster files from nflverse
(public, no signup) into `nfl_tool/data/` the first time, then writes
`nfl_tool/site/data.json`. Safe to re-run any time you want fresher numbers.

**3. Serve the site folder** (must be a real local server, not double-clicking
`index.html`, or the browser will block loading `data.json`):
```bash
python -m http.server --directory nfl_tool/site 8000
```
Then open **http://127.0.0.1:8000**.

## Every time you want fresh data

Re-run the `build_stats.py` command from step 2. If you're using the hosted
site, this already happens automatically every morning (see below) — you
only need to do this manually for local testing or to force an off-schedule
refresh before filming.

## Hosting on your own domain (free)

Same pattern as the CFB tool: `.github/workflows/deploy.yml` runs
`build_stats.py` and deploys `nfl_tool/site/` to GitHub Pages every morning.
No API key/secret to configure this time.

**One-time setup, in this repo's GitHub settings** (after it's pushed to GitHub):
1. **Turn on Pages**: Settings → Pages → under "Build and deployment", set
   Source to **GitHub Actions**.
2. **Custom domain**: `nfl_tool/site/CNAME` is already committed with
   `nfl.gmgsports.org` in it. At your domain registrar (same place you set
   up `cfbtool.gmgsports.org`), add a CNAME DNS record for the `nfl`
   subdomain pointing at `<your-github-username>.github.io`.
3. Run the workflow once manually (Actions tab → "Refresh data and deploy
   site" → Run workflow) rather than waiting for the next cron run.

After that it refreshes and redeploys itself daily on its own, and every
`git push` to `main` also triggers a redeploy.

**Note:** early in the season, `build_stats.py` needs that season's
play-by-play file to exist on nflverse's release yet. If the workflow fails
before Week 1 games are played, that's why — it'll start working once the
season kicks off. Also bump `--season 2026` to the new year in
`.github/workflows/deploy.yml` each September.

## What's in here

- **`nfl_tool/build_stats.py`** — downloads nflverse's play-by-play + weekly
  roster files and computes every stat in `data.json` (team + player)
- **`nfl_tool/site/`** — the whole static site: `index.html`, `app.js`
  (renders the matchup + leaderboards, computes the league-wide percentile
  color tiers client-side), `teams.js` (abbreviation → full name map),
  `style.css`, `CNAME`
- **`.github/workflows/deploy.yml`** — the daily refresh + static deploy job

## Still to come

This is v0: schedule-free matchup lookup + leaderboards only, no tension
flags or weekly schedule integration yet — same phased approach as the CFB
tool.
