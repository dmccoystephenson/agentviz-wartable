"""Serves the fixture feed next to web/ and checks the page, its assets and the feed."""
import json
import os
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from vendor.agentfeed.serve import make_handler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
ASSETS = ["index.html", "wartable.js", "wartable-engine.js", "wartable-engine.wasm",
          "strata-kit.js", "strata-loader.js"]


class ServeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(WEB, True))
        cls.base = "http://127.0.0.1:%d" % cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()

    def test_page_and_assets(self):
        for name in ASSETS:
            status, ctype, body = self.get("/" + name)
            self.assertEqual(status, 200, name)
            self.assertGreater(len(body), 100, name)
        self.assertIn("application/wasm", self.get("/wartable-engine.wasm")[1])
        status, _, body = self.get("/")
        self.assertIn(b"wartable.js", body)
        self.assertIn(b"strata-kit.js", body)

    def test_feed_parses(self):
        status, ctype, body = self.get("/api/agents?fixture=1")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertEqual(doc["version"], 1)
        self.assertTrue(doc["fixture"])
        states = {s["state"] for s in doc["sessions"]}
        for want in ("busy", "idle", "waiting", "offline"):
            self.assertIn(want, states)
        places = {p["id"] for p in doc["places"]}
        for s in doc["sessions"]:
            self.assertIn(s["place"], places)
            for f in s.get("followers", []):
                self.assertIn(f["state"], ("active", "resting"))

    def test_page_uses_every_action_and_state(self):
        js = open(os.path.join(WEB, "wartable.js")).read()
        for word in ("edit", "run", "read", "web", "delegate", "think", "other",
                     "busy", "idle", "waiting", "offline", "stalled"):
            self.assertIn(word, js)

    def test_no_path_escape(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/../README.md")


if __name__ == "__main__":
    unittest.main()
