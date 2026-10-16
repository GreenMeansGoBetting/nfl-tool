"""The SGP price log: /api/sgp-prices in the login middleware
(nfl_tool/functions/_middleware.js), added 2026-10-16 for NHL Line Stacks.

The owner logs what each book charges for a stack (its same-game parlay
price and the legs' own prices) so the page can measure each book's
correlation markup. Pinned: any signed-in member can read, only the owner
can save, one row per stack (the same legs in any order replace it), an
entry with no books removes it, bad input is refused, and it answers on the
hockey address. Loaded like test_ci_crease_payouts (whose page setup and D1
stand-in it reuses). Named test_ci_* so it runs with every test."""
import json
import unittest

import test_ci_crease_payouts as base  # first: its helpers put tools/ on the import path

URL = "https://nhl.gmgsports.org/api/sgp-prices"
OWNER = base.OWNER
STACK = {
    "game": "2026020119", "date": "2026-10-16", "legs": ["8477492", "8480039", "8480069"], "names": ["Nathan MacKinnon", "Martin Necas", "Cale Makar"],
    "kind": "line_pair_d", "chance": 0.305, "indep": 0.255, "fair": 228,
    "books": [{"book": "FanDuel", "price": -111, "legs": [-560, -290, -250]}, {"book": "DraftKings", "price": -140, "legs": [None, None, None]}],
}
KEY = "2026020119:8477492,8480039,8480069"


def setUpModule():
    # The payouts test's browser page, with a D1 stand-in that keeps this table's rows.
    base.EXTRA = base.EXTRA.replace("{ k: args[0], pool: args[1], payouts: args[2] }", "{ k: args[0], entry: args[1], pool: args[1], payouts: args[2] }")
    base.setUpModule()


def tearDownModule():
    base.tearDownModule()


def api(**opts):
    return base.PAGE.evaluate(f"() => api({json.dumps(URL)}, {json.dumps(opts)})")


class SgpPrices(unittest.TestCase):
    def setUp(self):
        base.PAGE.evaluate("() => { window.DB = fakeDB(); }")

    def test_signed_out_gets_nothing(self):
        self.assertEqual(api()["status"], 401)

    def test_a_member_reads_but_cannot_save(self):
        self.assertEqual(api(uid=OWNER, method="PUT", body=STACK)["status"], 200)
        self.assertEqual(api(uid="123", method="PUT", body=STACK)["status"], 403)
        got = api(uid="123")
        self.assertEqual(got["status"], 200)
        entry = got["body"]["stacks"][KEY]
        self.assertEqual(entry["books"], STACK["books"])
        self.assertEqual((entry["kind"], entry["fair"], entry["names"]), ("line_pair_d", 228, STACK["names"]))
        self.assertIn("DraftKings", got["body"]["books"])

    def test_one_row_a_stack_and_no_books_removes_it(self):
        api(uid=OWNER, method="PUT", body=STACK)
        flipped = {**STACK, "legs": STACK["legs"][::-1], "names": STACK["names"][::-1], "books": STACK["books"][:1]}
        self.assertEqual(api(uid=OWNER, method="PUT", body=flipped)["status"], 200)
        stacks = api(uid=OWNER)["body"]["stacks"]
        self.assertEqual(list(stacks), [KEY])
        self.assertEqual(len(stacks[KEY]["books"]), 1)
        api(uid=OWNER, method="PUT", body={**STACK, "books": []})
        self.assertEqual(api(uid=OWNER)["body"]["stacks"], {})

    def test_bad_input_is_refused(self):
        book = STACK["books"][0]
        for bad in ({**STACK, "game": "19"}, {**STACK, "legs": STACK["legs"][:1], "names": STACK["names"][:1]},
                    {**STACK, "kind": "cross_line"}, {**STACK, "chance": 1.2},
                    {**STACK, "books": [{**book, "book": "Shady Book"}]}, {**STACK, "books": [{**book, "price": 50}]},
                    {**STACK, "books": [{**book, "legs": [-560]}]}, {**STACK, "books": [book, book]}):
            self.assertEqual(api(uid=OWNER, method="PUT", body=bad)["status"], 400, bad)
        self.assertEqual(api(uid=OWNER)["body"]["stacks"], {})


if __name__ == "__main__":
    unittest.main()
