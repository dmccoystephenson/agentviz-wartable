"""agentfeed: the shared live feed for the agentviz family. See docs/FEED.md.

Layout: core.py (pure) <- ports/ (what the core asks) <- adapters/ (Claude's
session registry and transcripts, the demo feed, the HTTP server); service.py
wires them together."""
from .adapters.fixture import FIXTURE_FILE, load_fixture  # noqa: F401
from .labels import seed_of, tool_label  # noqa: F401
from .service import build_feed, build_feed_from  # noqa: F401
from .vocabulary import ACTIONS, SCHEMA_VERSION, STATES, action_of_tool, current_action  # noqa: F401

__version__ = "0.3.2"
