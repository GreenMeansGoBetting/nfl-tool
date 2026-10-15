"""Run the permanent tests for the site's math.

    python tools/run_tests.py        # every test: a few seconds, exit 1 if one fails
    python tools/run_tests.py -v     # ...naming each test as it runs
    python tools/run_tests.py --only nhl    # one sport's tests (nfl, nba or nhl); "all" = every test

Working on one sport, a local check runs that sport's tests (--only). A
test file belongs to the sport in its name (test_nhl_*, test_nba_*); the
deploy's own tests (test_ci_*) run only with every test; everything else is
the NFL site's. The deploy always runs every test.

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


def main():
    sys.path.insert(0, str(TESTS))
    args = sys.argv[1:]
    only = args[args.index("--only") + 1] if "--only" in args and args.index("--only") + 1 < len(args) else "all"
    if only not in (*SPORTS, "all"):
        print(f"--only takes one of: {', '.join(SPORTS)}, all")
        return 2
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    for path in sorted(TESTS.glob("test_*.py")):
        if only == "all" or sport_of(path.name) == only:
            suite.addTests(loader.discover(str(TESTS), pattern=path.name, top_level_dir=str(TESTS)))
    if only != "all":
        print(f"Only the {only.upper()} tests.")
    result = unittest.TextTestRunner(verbosity=2 if "-v" in sys.argv[1:] else 1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
