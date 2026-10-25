"""One-command check of the local site.

    python tools/check_site.py                      # the check: short report, exit 1 on problems
    python tools/check_site.py --screenshots DIR    # also save every page and card (before/after)
    python tools/check_site.py --screenshots DIR --games 3   # ...only the first 3 games' cards (faster)
    python tools/check_site.py --compare DIR_A DIR_B   # which screenshots changed, and by how much
    python tools/check_site.py --gate               # what the deploy runs: exit 1 only if the site is BROKEN

What the check does (nothing in the repo is ever written):
  * serves nfl_tool/site on a free local port for the length of the run;
  * loads every page and reports JavaScript errors and failed local requests
    (the login / profile addresses don't exist locally and are ignored, as are
    outside images and fonts);
  * for every game this week, opens the Summary card on Game Previews, TD Data
    and Player Props and reports the fit scale plus any text that is cut off
    or box that pokes out of the card; a card scaled below 0.85 is a problem;
  * at phone width, reports any page that is wider than the screen.

The check takes about a minute. The full screenshot set (every page and all
15 games' cards, desktop and phone, dark and light: about 200 images) takes
about 13 minutes, because those load every logo and photo for real.

Needs data.json built first, and Playwright with its Chromium browser:
    pip install -r tools/requirements-dev.txt
    python -m playwright install chromium
"""
import argparse
import functools
import json
import re
import http.server
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "nfl_tool" / "site"
BUILD_COMMAND = "python nfl_tool/build_stats.py --season 2026 --out nfl_tool/site/data.json"
INSTALL_HELP = "Playwright isn't set up on this computer. Run:\n  pip install -r tools/requirements-dev.txt\n  python -m playwright install chromium"

# (label, path, selector of the button that switches to the Summary card or None)
PAGES = [
    ("Game Previews", "game-overview.html", '.preview-view-btn[data-view="summary"]'),
    ("TD Data", "index.html", '.view-toggle-btn[data-view="summary"]'),
    ("Player Props", "player-props.html", '.props-view-toggle-btn[data-view="summary"]'),
    ("Best Plays", "best-plays.html", None),
    ("My Plays", "my-plays.html", None),
    ("Promo Tools", "promo-tools.html", None),
    ("Support", "support.html", None),
    ("NBA Game Previews", "nba/index.html", None),
    ("NBA Promo Tools", "nba/promo-tools.html", None),
    ("NBA First Basket", "nba/first-basket.html", None),
    ("NBA Team Identity", "nba/identity.html", None),
    ("NBA Shot Charts", "nba/shot-charts.html", None),
    ("NBA Best Plays", "nba/best.html", None),
    ("NBA Points", "nba/points.html", None),
    ("NBA Threes", "nba/threes.html", None),
    ("NHL Game Previews", "nhl/index.html", None),
    ("NHL Best Plays", "nhl/best.html", None),
    ("NHL Shots", "nhl/shots.html", None),
    ("NHL Goals", "nhl/goals.html", None),
    ("NHL Points", "nhl/points.html", None),
    ("NHL Saves", "nhl/saves.html", None),
    ("NHL Line Matchups", "nhl/lines.html", None),
    ("NHL Promo Tools", "nhl/promo-tools.html", None),
    ("NHL Icebreaker", "nhl/promo-tools.html#icebreaker", None),
]
# The other suites' pages: they have a schedule strip to wait for, and their
# data builds are allowed to fail without holding up the NFL site.
SUITE_FOLDERS = ("nba/", "nhl/")
SUITE_LABELS = ("NBA", "NHL")
GAME_CARDS = "#matchup-row .matchup-card"  # this week's games in the schedule strip
DESKTOP = {"width": 1440, "height": 1000}
PHONE = {"width": 390, "height": 844}
MIN_SCALE = 0.85
MAX_PROBLEM_LINES = 30
# Local addresses that only exist on the live site (member login, profiles).
IGNORED_LOCAL = ("/api/", "/auth/", "/account", "/favicon.ico")

# Runs in the page: how the open Summary card was fitted, and what doesn't fit.
CARD_REPORT_JS = r"""
() => {
  const card = document.querySelector('#summary-card');
  if (!card || !card.firstElementChild) return null;
  const inner = card.querySelector('.sc-inner');
  const m = /scale\(([\d.]+)\)/.exec((inner && inner.style.transform) || '');
  const zoomed = [...card.querySelectorAll('[style*="zoom"]')][0];
  const range = document.createRange();
  const cut = [];
  for (const el of card.querySelectorAll('*')) {
    if (el.children.length > 3 || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.display === 'inline' || cs.visibility === 'hidden') continue;
    // Text is cut where its box clips it, or spills out where a plain-text
    // box won't wrap. (Boxes with children that are allowed to stick out,
    // like a photo with a count bubble, don't count.)
    const clips = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
    if (!clips && !(cs.whiteSpace === 'nowrap' && !el.children.length)) continue;
    range.selectNodeContents(el);
    if (range.getBoundingClientRect().width > el.getBoundingClientRect().width + 1.5) cut.push(el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
  }
  const box = card.getBoundingClientRect();
  const out = [];
  for (const el of card.querySelectorAll('.sc-section, .sc-col, .sc-footer, [class*="tile"], [class*="-row"], .gs-pick')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > box.right + 2 || r.bottom > box.bottom + 2)) out.push(String(el.className).split(' ')[0]);
  }
  return { scale: m ? parseFloat(m[1]) : 1, zoom: zoomed ? parseFloat(zoomed.style.zoom) || 1 : 1, cut: [...new Set(cut)].slice(0, 5), out: [...new Set(out)].slice(0, 5) };
}
"""


def start_server():
    """nfl_tool/site on a free port, quiet, in a background thread."""
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(SITE))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class Watcher:
    """Collects a page's JavaScript errors and failed local requests."""

    def __init__(self, page, origin, problems):
        self.label = ""
        self.origin = origin
        self.problems = problems
        page.on("pageerror", lambda err: self.add(f"JavaScript error: {str(err).splitlines()[0][:160]}"))
        page.on("response", self.on_response)
        page.on("requestfailed", self.on_failed)

    def local(self, url):
        return url.startswith(self.origin) and not any(part in url for part in IGNORED_LOCAL)

    def add(self, text):
        line = f"{self.label}: {text}"
        if line not in self.problems:
            self.problems.append(line)

    def on_response(self, response):
        if response.status >= 400 and self.local(response.url):
            self.add(f"{response.status} for {response.url[len(self.origin):]}")

    def on_failed(self, request):
        if self.local(request.url):
            self.add(f"request failed: {request.url[len(self.origin):]}")


def skip_outside_images(context, origin):
    """The check doesn't wait on (or need) logos and photos from other sites:
    every image box has a fixed size, so the layout is the same without them.
    Screenshots load them for real."""
    context.route(lambda url: not url.startswith(origin), lambda route: route.abort() if route.request.resource_type in ("image", "media") else route.continue_())


def settle(page, selector=None):
    """Wait for the page's own data and rendering (never for outside images)."""
    page.wait_for_load_state("domcontentloaded")
    if selector:
        try:
            page.wait_for_selector(selector, timeout=15000)
        except Exception:
            pass
    page.wait_for_timeout(350)


def ready_for(path, summary_btn):
    """What says a page has drawn: the schedule strip, or for a promo with no
    strip of its own (Icebreaker, King of the Court), its table."""
    if path.endswith("#icebreaker"):
        return "#ice-players table"
    if path == "nba/promo-tools.html":
        return "#kotc-players table"
    return GAME_CARDS if summary_btn or path.startswith(SUITE_FOLDERS) else None


def game_count(page, max_games):
    count = page.locator(GAME_CARDS).count()
    return min(count, max_games) if max_games else count


def click_in_page(page, selector):
    """Click the first match from inside the page. False if there is none."""
    return page.evaluate("(sel) => { const e = document.querySelector(sel); if (e) e.click(); return !!e; }", selector)


def open_card(page, index):
    """Click one game in the schedule strip (by position: the strip is
    re-drawn after every click) and let its Summary card fit. Returns the
    game's name, e.g. "CIN-MIA"."""
    # Clicked from inside the page: Playwright's own click waits for the
    # strip to stop moving, which costs seconds per game.
    name = page.evaluate("([sel, i]) => { const e = document.querySelectorAll(sel)[i]; e.click(); return `${e.dataset.away}-${e.dataset.home}`; }", [GAME_CARDS, index])
    # The card re-fits itself as its logos and photos arrive. Give them a
    # moment, but never hang on a slow outside image (or a lazy one that is
    # off screen and will never load).
    try:
        page.wait_for_function("() => { const c = document.querySelector('#summary-card'); return c && c.firstElementChild && [...c.querySelectorAll('img')].every((i) => i.complete || i.loading === 'lazy'); }", timeout=1500)
    except Exception:
        pass
    page.wait_for_timeout(150)
    return name


# --gate: the problems that mean a page or card is broken for members (a
# script error, a missing file, a card that doesn't draw). A card that is a
# bit too full is worth a report but must never stop an odds refresh. The NBA
# and NHL pages are left out: their data builds are allowed to fail without
# holding up NFL.
BROKEN_MARKERS = ("JavaScript error", "request failed", "no Summary button found", "Summary card is empty", "no games in the schedule strip")


def page_sport(path):
    """Which sport a page belongs to, by its folder."""
    return next((folder.rstrip("/") for folder in SUITE_FOLDERS if path.startswith(folder)), "nfl")


def is_broken(problem):
    if problem.startswith(SUITE_LABELS):
        return False
    return any(marker in problem for marker in BROKEN_MARKERS) or bool(re.search(r": [45]\d\d for /", problem))


def unlisted_players():
    """The build's tripwire: a player with a shots-on-goal line who is on no
    NHL prop page's list (Charlie McAvoy, 2026-10-16). Never blocks a deploy."""
    try:
        data = json.loads((SITE / "nhl" / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [f"NHL: {p['name']} ({p['team']}) has a shots line but is on no prop page's list"
            for p in (data.get("feed_debug") or {}).get("unlisted") or []]


def run_check(browser, origin, shots_dir, max_games=None, gate=False):
    problems, notes = [], []
    cards_checked = 0

    # ---- desktop: every page, then every game's Summary card ----
    context = browser.new_context(viewport=DESKTOP)
    skip_outside_images(context, origin)
    page = context.new_page()
    watcher = Watcher(page, origin, problems)
    for label, path, summary_btn in PAGES:
        if not (SITE / path.split("#")[0]).exists():
            continue
        watcher.label = label
        page.goto(f"{origin}/{path}")
        settle(page, ready_for(path, summary_btn))
        if not summary_btn:
            continue
        if not click_in_page(page, summary_btn):
            problems.append(f"{label}: no Summary button found ({summary_btn})")
            continue
        scales = []
        for index in range(game_count(page, max_games)):
            name = open_card(page, index)
            report = page.evaluate(CARD_REPORT_JS)
            if not report:
                problems.append(f"{label} {name}: Summary card is empty")
                continue
            cards_checked += 1
            scales.append(report["scale"])
            if report["scale"] < MIN_SCALE:
                problems.append(f"{label} {name}: card shrunk to {report['scale']:.3f} (below {MIN_SCALE})")
            if report["cut"]:
                problems.append(f"{label} {name}: text cut off: {' | '.join(report['cut'])}")
            if report["out"]:
                problems.append(f"{label} {name}: pokes out of the card: {', '.join(report['out'])}")
        if scales:
            notes.append(f"{label} cards: {len(scales)} games, fit scale {min(scales):.2f}-{max(scales):.2f}")
        else:
            problems.append(f"{label}: no games in the schedule strip")
    context.close()
    if gate:  # layout width on phones can't break the site; skip it to keep deploys quick
        return problems, notes, cards_checked, 0

    # ---- phone: nothing wider than the screen ----
    context = browser.new_context(viewport=PHONE, device_scale_factor=2, is_mobile=True, has_touch=True)
    skip_outside_images(context, origin)
    page = context.new_page()
    watcher = Watcher(page, origin, problems)
    for label, path, summary_btn in PAGES:
        if not (SITE / path.split("#")[0]).exists():
            continue
        watcher.label = f"{label} (phone)"
        page.goto(f"{origin}/{path}")
        settle(page, ready_for(path, summary_btn))
        views = [("", None)] + ([(" Summary", summary_btn)] if summary_btn else [])
        for suffix, button in views:
            if button and click_in_page(page, button):
                page.wait_for_timeout(400)
            extra = page.evaluate("() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth")
            if extra > 1:
                problems.append(f"{label}{suffix} (phone): page is {int(extra)}px wider than the screen")
    context.close()

    shots = take_screenshots(browser, origin, shots_dir, max_games) if shots_dir else 0
    return problems, notes, cards_checked, shots


def take_screenshots(browser, origin, shots_dir, max_games=None):
    """Every page and every Summary card: desktop and phone, dark and light."""
    shots_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for theme in ("dark", "light"):
        for size_name, viewport in (("1440", DESKTOP), ("390", PHONE)):
            phone = size_name == "390"
            context = browser.new_context(viewport=viewport, device_scale_factor=1, is_mobile=phone, has_touch=phone)
            context.add_init_script(f"try {{ localStorage.setItem('nfl-tool.theme', '{theme}') }} catch (e) {{}}")
            page = context.new_page()
            for label, path, summary_btn in PAGES:
                if not (SITE / path.split("#")[0]).exists():
                    continue
                slug = label.lower().replace(" ", "-")
                page.goto(f"{origin}/{path}")
                settle(page, ready_for(path, summary_btn))
                page.wait_for_timeout(600)
                page.screenshot(path=str(shots_dir / f"{theme}-{size_name}-{slug}.png"), full_page=True)
                count += 1
                if not summary_btn or not click_in_page(page, summary_btn):
                    continue
                for index in range(game_count(page, max_games)):
                    name = open_card(page, index)
                    target = page.query_selector("#summary-card")
                    if target:
                        target.screenshot(path=str(shots_dir / f"{theme}-{size_name}-{slug}-summary-{name}.png"))
                        count += 1
            context.close()
    return count


def compare(dir_a, dir_b):
    """Which screenshots differ between two folders, and by how many pixels."""
    try:
        from PIL import Image, ImageChops
    except ImportError:
        print("The comparison needs Pillow: pip install -r tools/requirements-dev.txt")
        return 2
    a = {p.name: p for p in Path(dir_a).glob("*.png")}
    b = {p.name: p for p in Path(dir_b).glob("*.png")}
    lines = [f"only in {dir_a}: {n}" for n in sorted(set(a) - set(b))] + [f"only in {dir_b}: {n}" for n in sorted(set(b) - set(a))]
    same = 0
    for name in sorted(set(a) & set(b)):
        with Image.open(a[name]) as ia, Image.open(b[name]) as ib:
            if ia.size != ib.size:
                lines.append(f"{name}: size changed {ia.size[0]}x{ia.size[1]} -> {ib.size[0]}x{ib.size[1]}")
                continue
            diff = ImageChops.difference(ia.convert("RGB"), ib.convert("RGB")).convert("L")
            changed = sum(diff.histogram()[1:])
            if changed:
                lines.append(f"{name}: {changed:,} pixels differ ({100 * changed / (ia.size[0] * ia.size[1]):.2f}%)")
            else:
                same += 1
    print(f"compare: {len(set(a) & set(b))} screenshots in both folders, {same} identical, {len(lines)} differences")
    for line in lines[:MAX_PROBLEM_LINES]:
        print("  " + line)
    if len(lines) > MAX_PROBLEM_LINES:
        print(f"  ... and {len(lines) - MAX_PROBLEM_LINES} more")
    return 1 if lines else 0


def main():
    parser = argparse.ArgumentParser(description="Check the local site: pages, Summary cards, phone layout.")
    parser.add_argument("--screenshots", nargs="?", const="", metavar="DIR", help="also save screenshots (default: a temp folder)")
    parser.add_argument("--site", metavar="DIR", help="check a copy of the site folder instead of nfl_tool/site")
    parser.add_argument("--games", type=int, metavar="N", help="only the first N games' Summary cards (default: every game this week)")
    parser.add_argument("--compare", nargs=2, metavar=("DIR_A", "DIR_B"), help="list which screenshots differ between two folders")
    parser.add_argument("--only", choices=("nfl", "nba", "nhl", "all"), default="all", help="one sport's pages, for a local check while working on one sport (the deploy checks them all)")
    parser.add_argument("--gate", action="store_true", help="for the deploy: exit 1 only when a page or card is broken (script error, missing file, empty card)")
    args = parser.parse_args()
    if args.compare:
        return compare(*args.compare)
    if args.site:
        global SITE
        SITE = Path(args.site).resolve()

    if args.only != "all":
        # Working on one sport opens that sport's pages and no others.
        global PAGES
        PAGES = [entry for entry in PAGES if page_sport(entry[1]) == args.only]
        print(f"Only the {args.only.upper()} pages.")
    if args.only in ("nfl", "all") and not (SITE / "data.json").exists():
        print(f"nfl_tool/site/data.json isn't built yet. Build it first:\n  {BUILD_COMMAND}")
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(INSTALL_HELP)
        return 2

    shots_dir = None
    if args.screenshots is not None:
        shots_dir = Path(args.screenshots) if args.screenshots else Path(tempfile.mkdtemp(prefix="gmg-site-shots-"))
        if ROOT in shots_dir.resolve().parents or shots_dir.resolve() == ROOT:
            print("Screenshots can't go inside the repo; pick a folder outside it.")
            return 2

    server = start_server()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch()
            except Exception as e:
                print(f"{INSTALL_HELP}\n({str(e).splitlines()[0][:120]})")
                return 2
            problems, notes, cards, shots = run_check(browser, origin, shots_dir, args.games, args.gate)
            if args.only in ("nhl", "all"):
                problems += unlisted_players()
            browser.close()
    finally:
        server.shutdown()

    pages = sum(1 for _, path, _ in PAGES if (SITE / path.split("#")[0]).exists())
    print(f"check_site: {pages} pages, {cards} summary cards, {len(problems)} problem{'' if len(problems) == 1 else 's'}" + (f", {shots} screenshots in {shots_dir}" if shots_dir else ""))
    for note in notes:
        print("  " + note)
    for label, folder in zip(SUITE_LABELS, SUITE_FOLDERS):
        if args.only in (folder.rstrip("/"), "all") and not (SITE / folder / "data.json").exists():
            print(f"  {label} page skipped its data: nfl_tool/site/{folder}data.json isn't built")
    for line in problems[:MAX_PROBLEM_LINES]:
        print("  PROBLEM " + line)
    if len(problems) > MAX_PROBLEM_LINES:
        print(f"  ... and {len(problems) - MAX_PROBLEM_LINES} more")
    if args.gate:
        broken = [p for p in problems if is_broken(p)]
        print(f"gate: {len(broken)} blocking problem{'' if len(broken) == 1 else 's'}" + ("" if broken else " -- OK to deploy"))
        for line in broken[:MAX_PROBLEM_LINES]:
            print("  BLOCKING " + line)
        return 1 if broken else 0
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
