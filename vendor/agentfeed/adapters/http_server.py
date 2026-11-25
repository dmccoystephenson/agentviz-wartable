"""Driving adapter: a tiny local HTTP server for one visualization, serving
its static files and the feed.

  /api/agents            the feed document (live, or the demo feed with --fixture)
  /api/agents?fixture=1  the demo feed regardless of mode
  /<file>                a file inside the web directory, never above it

Binds to 127.0.0.1 only, and answers only requests addressed to 127.0.0.1 or
localhost, so a web page can't reach the feed through DNS rebinding: the feed
describes real work on this machine."""
import json
import mimetypes
import os
import posixpath
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .fixture import FIXTURE_FILE, load_fixture

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

FEED_PATH = "/api/agents"
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def is_local_host(host_header) -> bool:
    """True when a Host header names this machine (any port)."""
    if not host_header:
        return False
    host = host_header.strip().lower()
    if host.startswith("["):
        host = host.split("]", 1)[0] + "]"
    else:
        host = host.split(":", 1)[0]
    return host in LOCAL_HOSTS


def _build_feed(fixture_sessions):
    from ..service import build_feed  # imported late: the service imports this package's adapters
    return build_feed(fixture=fixture_sessions)


def resolve_static(web_dir, url_path):
    """The real path of a file inside `web_dir` for a URL path, or None when
    it is missing or would fall outside `web_dir`."""
    relative = posixpath.normpath(url_path).lstrip("/") or "index.html"
    path = os.path.realpath(os.path.join(web_dir, relative))
    if not path.startswith(web_dir + os.sep) or not os.path.isfile(path):
        return None
    return path


def make_handler(web_dir, fixture_mode, fixture_path=FIXTURE_FILE):
    """A request handler class serving `web_dir` (None: the feed only)."""
    web_dir = os.path.realpath(web_dir) if web_dir else None

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # quiet: the server prints its URL once and nothing per request

        def do_GET(self):
            if not is_local_host(self.headers.get("Host")):
                return self._send(403, "text/plain", b"forbidden: open this page at 127.0.0.1 or localhost")
            url = urlparse(self.path)
            if url.path == FEED_PATH:
                return self._send_feed(url.query)
            path = resolve_static(web_dir, url.path) if web_dir else None
            if path is None:
                return self._send(404, "text/plain", b"not found")
            with open(path, "rb") as f:
                return self._send(200, mimetypes.guess_type(path)[0] or "application/octet-stream", f.read())

        def _send_feed(self, query):
            use_fixture = fixture_mode or parse_qs(query).get("fixture", ["0"])[0] == "1"
            document = _build_feed(load_fixture(fixture_path) if use_fixture else None)
            self._send(200, "application/json", json.dumps(document).encode())

        def _send(self, code, content_type, body):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def serve(web_dir, port, fixture_mode=False):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(web_dir, fixture_mode))
    print("serving http://127.0.0.1:%d/ (%s)" % (port, "fixture" if fixture_mode else "live"), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0
