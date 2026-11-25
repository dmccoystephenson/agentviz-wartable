"""Compatibility module: the server moved to adapters/http_server.py. Kept so
existing imports (`from agentfeed.serve import make_handler`) keep working."""
from .adapters.fixture import FIXTURE_FILE  # noqa: F401
from .adapters.http_server import make_handler, serve  # noqa: F401
