"""The What's New popup (site/sync.js GMG_UPDATES), run in a real browser.

What is pinned (the owner, 2026-10-15): each member sees the site's updates
once, the first page they open after a new one is posted; the unseen ones are
on top and the earlier ones folded underneath; the end invites them to Request
a feature; what they've seen follows their profile (synced key); a browser
driven by a script (the deploy's page check, these tests) never gets the popup
on its own, or it would sit over every page."""
import re
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = PAGE = None
KEY = "nfl-tool.updates-seen.v1"


def setUpModule():
    global SITE, PAGE
    SITE = SiteBrowser()
    try:
        PAGE = SITE.open("nhl/best.html")
    except Exception:
        SITE.close()
        raise


def tearDownModule():
    if SITE:
        SITE.close()


class Updates(unittest.TestCase):
    def test_the_list_is_newest_first_with_dated_ids(self):
        ids = PAGE.evaluate("GMG_UPDATES.map((u) => u.id)")
        self.assertTrue(ids)
        self.assertEqual(ids, sorted(set(ids), reverse=True))
        for i in ids:
            self.assertRegex(i, r"^\d{4}-\d{2}-\d{2}[a-z]?$")

    def test_a_driven_browser_never_gets_it_on_its_own(self):
        self.assertTrue(PAGE.evaluate("GMGUpdates.due()"))  # fresh browser: not seen yet
        self.assertIsNone(PAGE.evaluate("document.getElementById('updates-modal')"))

    def test_shown_once_then_marked_seen_and_synced(self):
        text = PAGE.evaluate(f"""() => {{
            localStorage.removeItem('{KEY}');
            GMGUpdates.open();
            const box = document.getElementById('updates-modal');
            const out = {{ text: box.textContent, hidden: box.hidden, due: GMGUpdates.due(),
                          seen: JSON.parse(localStorage.getItem('{KEY}')), newTags: box.querySelectorAll('.upd-new').length }};
            box.querySelector('.upd-done').click();
            out.closed = box.hidden;
            return out;
        }}""")
        self.assertFalse(text["hidden"])
        self.assertTrue(text["closed"])
        self.assertFalse(text["due"])
        self.assertEqual(text["seen"], PAGE.evaluate("GMG_UPDATES[0].id"))
        self.assertGreaterEqual(text["newTags"], 1)
        self.assertIn("What's new", text["text"])
        self.assertIn("Request a feature", text["text"])
        self.assertIn(KEY, PAGE.evaluate("Object.keys(JSON.parse(localStorage.getItem('nfl-tool.sync-meta.v1') || '{}'))"))

    def test_before_you_go_note_follows_a_new_update_once(self):
        # The owner, 2026-10-20: a "Before you go..." thank-you after the update popup.
        out = PAGE.evaluate(f"""() => {{
            const saved = GMG_UPDATES.slice();
            GMG_UPDATES.unshift({{ id: '2099-01-01', items: [['x', '<b>Test</b> update']], after: {{ title: 'Before you go…', text: 'Thanks for the support.' }} }});
            localStorage.setItem('{KEY}', JSON.stringify(saved[0].id));
            try {{
                const note = () => document.getElementById('after-note-modal');
                GMGUpdates.open();
                const before = !!note() && !note().hidden;
                document.querySelector('#updates-modal .upd-done').click();
                const after = note() && !note().hidden ? note().textContent : null;
                note().querySelector('.upd-done').click();
                GMGUpdates.open();  // opened again by hand: already seen, no note
                document.querySelector('#updates-modal .upd-done').click();
                return {{ before, after, again: !note().hidden }};
            }} finally {{
                GMG_UPDATES.length = 0; GMG_UPDATES.push(...saved);
                localStorage.removeItem('{KEY}');
            }}
        }}""")
        self.assertFalse(out["before"])
        self.assertIn("Before you go", out["after"])
        self.assertIn("Thanks for the support.", out["after"])
        self.assertFalse(out["again"])

    def test_older_updates_fold_under_the_new_ones(self):
        out = PAGE.evaluate(f"""() => {{
            const saved = GMG_UPDATES.slice();
            GMG_UPDATES.push({{ id: '2000-01-01', items: [['x', '<b>Old one</b> from long ago']] }});
            localStorage.setItem('{KEY}', JSON.stringify('2000-01-01'));
            try {{
                GMGUpdates.open();
                const box = document.getElementById('updates-modal');
                return {{ top: box.querySelectorAll('.upd-content > .upd-day').length,
                          folded: [...box.querySelectorAll('.upd-earlier .upd-day')].map((d) => d.textContent) }};
            }} finally {{
                GMG_UPDATES.length = 0; GMG_UPDATES.push(...saved);
                document.querySelector('#updates-modal .modal-close').click();
            }}
        }}""")
        self.assertEqual(out["top"], PAGE.evaluate("GMG_UPDATES.length"))
        self.assertEqual(len(out["folded"]), 1)
        self.assertTrue(re.search("Old one", out["folded"][0]))

    def test_request_a_feature_opens_the_idea_box(self):
        opened = PAGE.evaluate("""() => {
            GMGUpdates.open();
            document.querySelector('#updates-modal .upd-request').click();
            const form = document.getElementById('feature-request-modal');
            const out = { updatesHidden: document.getElementById('updates-modal').hidden, form: !!form && !form.hidden && !!form.querySelector('.fr-text') };
            if (form) form.querySelector('.modal-close').click();
            return out;
        }""")
        self.assertTrue(opened["updatesHidden"])
        self.assertTrue(opened["form"])

    def test_no_page_errors(self):
        self.assertEqual(SITE.errors, [])


if __name__ == "__main__":
    unittest.main()
