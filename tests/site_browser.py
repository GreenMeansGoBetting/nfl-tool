"""The real site pages in a headless browser, fed the saved data sample.

There is no Node on the owner's PC, so the site's JavaScript is tested where
it actually runs: Playwright opens the page (the same way tools/check_site.py
does), answers the page's request for data.json with the sample, and the tests
call the page's own functions.
"""
import json

from helpers import SAMPLE_BUILT_UTC, nhl_crease_bytes, nhl_data_bytes, nhl_goals_bytes, nhl_icebreaker_bytes, nhl_points_bytes, nhl_players, nhl_shots_bytes, nhl_stacks_bytes, site_data_bytes  # first: puts tools/ on the import path

from check_site import INSTALL_HELP, start_server


class SiteBrowser:
    def __init__(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError(INSTALL_HELP) from None
        self.errors = []
        self.missing = set()  # paths a test wants answered "not built" (404), e.g. "/nhl/shots.json"
        self.user = None  # a signed-in member for /api/state, e.g. {"name": "Pat Lee", "owner": False}
        self.server = start_server()
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._playwright = sync_playwright().start()
        try:
            self.browser = self._playwright.chromium.launch()
        except Exception as e:
            self.close()
            raise RuntimeError(f"{INSTALL_HELP}\n({str(e).splitlines()[0][:120]})") from None
        # Same clock and time zone on the owner's PC and on GitHub's servers:
        # the moment the sample was built, Eastern time.
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000}, timezone_id="America/New_York", locale="en-US")
        self.context.clock.set_fixed_time(SAMPLE_BUILT_UTC)
        self.context.route("**/*", self._route)

    def _route(self, route):
        url = route.request.url.split("?")[0]
        if url[len(self.origin):] in self.missing:
            route.fulfill(status=404, body="")
        elif url == f"{self.origin}/api/state" and self.user:
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"user": self.user, "state": {}}))
        elif url == f"{self.origin}/data.json":
            route.fulfill(status=200, content_type="application/json", body=site_data_bytes())
        elif url == f"{self.origin}/nhl/data.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_data_bytes())
        elif url == f"{self.origin}/nhl/shots.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_shots_bytes())
        elif url == f"{self.origin}/nhl/goals.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_goals_bytes())
        elif url == f"{self.origin}/nhl/points.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_points_bytes())
        elif url == f"{self.origin}/nhl/stacks.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_stacks_bytes())
        elif url == f"{self.origin}/nhl/crease.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_crease_bytes())
        elif url == f"{self.origin}/nhl/icebreaker.json":
            route.fulfill(status=200, content_type="application/json", body=nhl_icebreaker_bytes())
        elif url.startswith(f"{self.origin}/nhl/players/"):
            # Only the saved teams exist; any other team's file is "not built".
            team = nhl_players().get(url.rsplit("/", 1)[-1].removesuffix(".json"))
            if team:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(team))
            else:
                route.fulfill(status=404, body="")
        elif url.startswith(self.origin):
            route.continue_()
        else:
            route.abort()  # logos, photos, fonts: not needed for the math

    def open(self, path):
        """Load a page and wait until it has read the data sample."""
        page = self.context.new_page()
        page.on("pageerror", lambda err: self.errors.append(f"{path}: {str(err).splitlines()[0][:200]}"))
        page.goto(f"{self.origin}/{path}")
        page.wait_for_function("() => typeof DATA !== 'undefined' && DATA !== null", timeout=20000)
        return page

    def close(self):
        for closer in (lambda: self.browser.close(), lambda: self._playwright.stop(), lambda: self.server.shutdown()):
            try:
                closer()
            except Exception:
                pass
