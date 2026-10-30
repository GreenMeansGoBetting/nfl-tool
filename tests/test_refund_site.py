"""The "Refund?" button beside the theme button (site/sync.js addRefund), run
in a real browser.

What is pinned (the owner, 2026-10-30): every page has it; it opens a popup
with the owner's words, an Email box and an Additional Comments box, and sends
them to the feature request list (POST /api/requests, kind "refund") so the
owner's list tags it as a Refund Request, not a site idea."""
import json
import unittest

from helpers import nhl_data  # first: puts tools/ on the import path  # noqa: F401

from site_browser import SiteBrowser

SITE = None


def setUpModule():
    global SITE
    SITE = SiteBrowser()


def tearDownModule():
    if SITE:
        SITE.close()


class Refund(unittest.TestCase):
    def test_every_sport_has_it_beside_the_theme_button(self):
        for path in ("index.html", "nhl/best.html"):
            page = SITE.open(path)
            nxt = page.evaluate("() => { const b = document.getElementById('gmg-refund-btn'); return b && b.previousElementSibling.id + '|' + b.textContent; }")
            self.assertEqual(nxt, "theme-toggle|Refund?", path)

    def test_the_popup_sends_a_refund_request(self):
        page = SITE.open("nhl/best.html")
        got = page.evaluate("""async () => {
            const sent = [];
            window.fetch = async (url, opts) => { sent.push([url, opts && opts.body]); return new Response('{"ok":true}', { status: 200 }); };
            document.getElementById('gmg-refund-btn').click();
            const box = document.querySelector('#feature-request-modal .fr-content');
            const text = box.innerText;
            box.querySelector('.fr-send').click();  // no email yet: nothing sent
            const blocked = sent.length;
            box.querySelector('.fr-email').value = 'fan@example.com';
            box.querySelector('.fr-text').value = 'Not for me';
            box.querySelector('.fr-send').click();
            await new Promise((r) => setTimeout(r, 50));
            return { text, blocked, sent, after: box.innerText };
        }""")
        self.assertIn("I never want anyone to feel as if this was a waste of money", got["text"])
        self.assertIn("ADDITIONAL COMMENTS", got["text"].upper())
        self.assertEqual(got["blocked"], 0)
        self.assertEqual(len(got["sent"]), 1)
        url, body = got["sent"][0]
        self.assertEqual(url, "/api/requests")
        self.assertEqual(json.loads(body), {"kind": "refund", "email": "fan@example.com", "text": "Not for me"})
        self.assertIn("sent", got["after"])

    def test_the_owners_list_tags_refunds(self):
        page = SITE.open("nhl/best.html")
        metas = page.evaluate("""async () => {
            window.fetch = async () => new Response(JSON.stringify({ requests: [
              { id: 1, name: 'A', text: '[refund]\\nEmail: a@b.co', created: Date.now(), status: 'new' },
              { id: 2, name: 'B', text: 'More NHL', created: Date.now(), status: 'new' } ] }), { status: 200 });
            await GMGRequests.list();
            return [...document.querySelectorAll('.fr-item')].map((d) => [d.querySelector('.fr-meta').innerText, d.querySelector('.fr-body').innerText]);
        }""")
        self.assertIn("REFUND REQUEST", metas[0][0].upper())
        self.assertEqual(metas[0][1], "Email: a@b.co")
        self.assertNotIn("REFUND", metas[1][0].upper())


if __name__ == "__main__":
    unittest.main()
