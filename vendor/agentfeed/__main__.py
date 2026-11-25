import argparse
import json
import sys

from .feed import build_feed, load_fixture
from .serve import FIXTURE_FILE, serve


def main(argv=None):
    ap = argparse.ArgumentParser(prog="agentfeed")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="serve a visualization's web dir plus /api/agents")
    s.add_argument("--web", default="web")
    s.add_argument("--port", type=int, default=8840)
    s.add_argument("--fixture", action="store_true", help="serve the bundled demo feed instead of live sessions")
    d = sub.add_parser("dump", help="print the feed document")
    d.add_argument("--fixture", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "serve":
        return serve(a.web, a.port, a.fixture)
    doc = build_feed(fixture=load_fixture(FIXTURE_FILE) if a.fixture else None)
    json.dump(doc, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
