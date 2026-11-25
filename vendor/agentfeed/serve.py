"""A tiny local server for one visualization: its static files plus the feed.

    python3 -m agentfeed serve --web ./web --port 8841 [--fixture]

Routes:
  /api/agents            the feed document (live, or the fixture with --fixture)
  /api/agents?fixture=1  the bundled fixture regardless of mode
  /<file>                a file directly inside --web (no subdirectories above it)
Binds to 127.0.0.1 only: the feed describes real work on this machine.
"""
import json
import mimetypes
import os
import posixpath
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .feed import build_feed, load_fixture

FIXTURE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture.json")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")


def make_handler(web_dir, fixture_mode, fixture_path=FIXTURE_FILE):
    web_dir = os.path.realpath(web_dir) if web_dir else None

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, ctype, body):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/api/agents":
                q = parse_qs(url.query)
                use_fixture = fixture_mode or q.get("fixture", ["0"])[0] == "1"
                doc = build_feed(fixture=load_fixture(fixture_path) if use_fixture else None)
                return self._send(200, "application/json", json.dumps(doc).encode())
            if not web_dir:
                return self._send(404, "text/plain", b"not found")
            rel = posixpath.normpath(url.path).lstrip("/") or "index.html"
            path = os.path.realpath(os.path.join(web_dir, rel))
            if not path.startswith(web_dir + os.sep) or not os.path.isfile(path):
                return self._send(404, "text/plain", b"not found")
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            with open(path, "rb") as f:
                return self._send(200, ctype, f.read())

    return Handler


def serve(web_dir, port, fixture_mode=False):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(web_dir, fixture_mode))
    print("serving http://127.0.0.1:%d/ (%s)" % (port, "fixture" if fixture_mode else "live"), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
