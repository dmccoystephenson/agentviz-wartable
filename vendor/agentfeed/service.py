"""Wiring: pick the adapters, ask the ports, hand the answers to the core."""
import time
from typing import List, Optional

from .adapters.claude_home_activity import ClaudeHomeActivity
from .adapters.claude_home_sessions import ClaudeHomeSessions, pid_alive
from .adapters.fixture import FixtureFeed
from .core import feed_document, is_shown_offline, session_entry
from .ports.activity_source import ActivitySource
from .ports.session_source import SessionSource
from .vocabulary import OFFLINE_WINDOW_SEC

# One activity adapter per projects directory, kept for the life of the
# process so its transcript cache survives between polls.
_activity_adapters = {}


def build_feed_from(sessions: SessionSource, activity: ActivitySource, now, fixture=False,
                    offline_window_sec: Optional[float] = OFFLINE_WINDOW_SEC) -> dict:
    """The feed document from any pair of port implementations. Dead sessions
    are kept while updated within `offline_window_sec`; None keeps them all,
    a negative window drops them all."""
    entries = []
    for record in sessions.sessions(now):
        if not record.alive and offline_window_sec is not None \
                and not is_shown_offline(record, now, offline_window_sec):
            continue
        entries.append(session_entry(record, activity.activity(record, now), now))
    return feed_document(entries, now, fixture)


def build_feed(sessions_dir=None, projects_dir=None, now=None, fixture: Optional[List[dict]] = None,
               include_offline=True, is_alive=pid_alive) -> dict:
    """The feed document for this machine, or for `fixture` (a list of raw
    session dicts) used INSTEAD of the live registry."""
    now = time.time() if now is None else now
    if fixture is not None:
        demo = FixtureFeed(fixture)
        return build_feed_from(demo, demo, now, fixture=True, offline_window_sec=None)
    activity = _activity_adapters.get(projects_dir)
    if activity is None:
        activity = _activity_adapters[projects_dir] = ClaudeHomeActivity(projects_dir)
    return build_feed_from(ClaudeHomeSessions(sessions_dir, is_alive), activity, now,
                           offline_window_sec=OFFLINE_WINDOW_SEC if include_offline else -1)
