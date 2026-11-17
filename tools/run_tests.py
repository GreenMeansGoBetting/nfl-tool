"""Run the permanent tests for the site's math.

    python tools/run_tests.py        # every test: a few seconds, exit 1 if one fails
    python tools/run_tests.py -v     # ...naming each test as it runs
    python tools/run_tests.py --only nhl    # one sport's tests (nfl, nba or nhl); "all" = every test
    python tools/run_tests.py --deploy "nba"  # the deploy's choice (ci_steps.py test_plan): those
                                              # sports' tests + every other test that mentions them

Working on one sport, a local check runs that sport's tests (--only). A
test file belongs to the sport in its name (test_nhl_*, test_nba_*); the
deploy's own tests (test_ci_*) run only with every test; everything else is
the NFL site's. The deploy runs every test unless a push changed only one
sport's own files (ci_steps.py test_plan, 2026-11-17): then --deploy runs that
sport's tests plus every other test file that names it (the top menu, My
Plays, settings ... open NBA / NHL pages), found by reading the files.

The tests live in tests/ and read saved samples (tests/fixtures/), never this
week's data, so they give the same answer every day. Each one pins a rule or
a bug that already happened: the GMG model's score (and that the build and
the browser agree on it), the 4-point pick rule, the odds lock at kickoff,
Novig's TD odds, two-sided matchup calls, the Game Summary edge rule, pocket
QBs, the TD Summary's top-8 defense guard, and the NHL build and page (rink
areas, one saved game's totals, the same odds lock). The deploy runs this
before it builds anything.

The browser half needs Playwright with its Chromium browser:
    pip install -r tools/requirements-dev.txt
    python -m playwright install chromium
"""
import re
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent.parent / "tests"


SPORTS = ("nfl", "nba", "nhl")


def sport_of(name: str) -> str:
    """Which sport a test file belongs to ("ci" = the deploy's own tools)."""
    if name.startswith("test_ci_"):
        return "ci"
    return next((sport for sport in ("nba", "nhl") if name.startswith(f"test_{sport}")), "nfl")


def mentions(path: Path, sport: str) -> bool:
    """Whether a shared test's CODE reaches the sport: a path ("nba/..."),
    a "nba" string or a .nba property / class (SITE.nba, .nba-trigger).
    A comment saying "NBA" doesn't count (lower case only)."""
    return re.search(rf"""{sport}/|["']{sport}["']|\.{sport}\b""", path.read_text(encoding="utf-8", errors="replace")) is not None


def wanted(path: Path, only: str, deploy) -> bool:
    if deploy is not None:
        if "all" in deploy:
            return True
        own = sport_of(path.name)
        if own in deploy:
            return True
        # Another sport's own tests never run (the owner, 2026-11-17: "JUST
        # LEAVE NHL AND NFL ALONE"); a shared test runs if it reaches the sport.
        return own not in SPORTS[1:] and any(mentions(path, s) for s in deploy)
    return only == "all" or sport_of(path.name) == only


def main():
    sys.path.insert(0, str(TESTS))
    args = sys.argv[1:]
    only = args[args.index("--only") + 1] if "--only" in args and args.index("--only") + 1 < len(args) else "all"
    if only not in (*SPORTS, "all"):
        print(f"--only takes one of: {', '.join(SPORTS)}, all")
        return 2
    deploy = args[args.index("--deploy") + 1].split() if "--deploy" in args and args.index("--deploy") + 1 < len(args) else None
    if deploy is not None and not deploy or deploy and any(s not in (*SPORTS, "all") for s in deploy):
        print(f"--deploy takes sports from: {', '.join(SPORTS)}, all")
        return 2
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    for path in sorted(TESTS.glob("test_*.py")):
        if wanted(path, only, deploy):
            suite.addTests(loader.discover(str(TESTS), pattern=path.name, top_level_dir=str(TESTS)))
    if deploy and "all" not in deploy:
        print(f"Deploy: the {' / '.join(s.upper() for s in deploy)} tests and every test that names them ({suite.countTestCases()} tests).")
    elif only != "all" and deploy is None:
        print(f"Only the {only.upper()} tests.")
    result = unittest.TextTestRunner(verbosity=2 if "-v" in sys.argv[1:] else 1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
