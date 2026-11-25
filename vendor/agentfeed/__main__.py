import argparse
import json
import sys

from .adapters.fixture import FIXTURE_FILE, load_fixture
from .adapters.http_server import serve
from .service import build_feed


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="agentfeed")
    commands = parser.add_subparsers(dest="cmd", required=True)
    serve_command = commands.add_parser("serve", help="serve a visualization's web dir plus /api/agents")
    serve_command.add_argument("--web", default="web")
    serve_command.add_argument("--port", type=int, default=8840)
    serve_command.add_argument("--fixture", action="store_true",
                               help="serve the bundled demo feed instead of live sessions")
    dump_command = commands.add_parser("dump", help="print the feed document")
    dump_command.add_argument("--fixture", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.cmd == "serve":
        return serve(args.web, args.port, args.fixture)
    json.dump(build_feed(fixture=load_fixture(FIXTURE_FILE) if args.fixture else None), sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
