"""Compatibility module: the feed is now a pure core (core.py) behind two
ports (ports/) with adapters (adapters/), wired in service.py. These names
are kept so existing imports keep working; new code should import from the
package (`import agentfeed`)."""
from .adapters.claude_home_activity import encode_cwd  # noqa: F401
from .adapters.claude_home_sessions import is_claude_process, pid_alive  # noqa: F401
from .adapters.fixture import load_fixture, rebase_fixture  # noqa: F401
from .labels import place_of, seed_of, short_label as short, tool_label  # noqa: F401
from .service import build_feed  # noqa: F401
from .times import iso_epoch  # noqa: F401
from .vocabulary import (ACTIONS, ACTIVE_WINDOW_SEC, FOLLOWER_WINDOW_SEC, MAX_FOLLOWERS,  # noqa: F401
                         OFFLINE_WINDOW_SEC, RECENT_TOOLS, RESTING_WINDOW_SEC, SCHEMA_VERSION, STALL_SEC,
                         STATES, action_of_tool, current_action, state_of)
