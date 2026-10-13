"""Run the permanent tests for the site's math.

    python tools/run_tests.py        # every test: a few seconds, exit 1 if one fails
    python tools/run_tests.py -v     # ...naming each test as it runs

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


def main():
    sys.path.insert(0, str(TESTS))
    suite = unittest.defaultTestLoader.discover(str(TESTS), pattern="test_*.py", top_level_dir=str(TESTS))
    result = unittest.TextTestRunner(verbosity=2 if "-v" in sys.argv[1:] else 1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
