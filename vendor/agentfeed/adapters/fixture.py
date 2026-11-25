"""Both ports from the demo feed file (agentfeed/fixture.json): synthetic
sessions for --fixture, ?fixture=1, screenshots and tests.

Fixture times are relative: `startedAgoSec` / `updatedAgoSec` become epoch-ms
`startedAt` / `updatedAt` measured back from now, so the demo never drifts.
Absolute `startedAt` / `updatedAt` are still accepted and left alone."""
import json
import os
from typing import List, Optional

from ..core import follower_stalled
from ..labels import seed_of
from ..model import Activity, SessionRecord
from ..ports.activity_source import ActivitySource
from ..ports.session_source import SessionSource

FIXTURE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixture.json")


def load_fixture(path=FIXTURE_FILE) -> List[dict]:
    """The raw session dicts in a fixture file."""
    with open(path, "r") as f:
        document = json.load(f)
    return [session for session in document.get("sessions", []) if isinstance(session, dict)]


def rebase_fixture(sessions: List[dict], now) -> List[dict]:
    """Copies of fixture sessions with relative times turned into epoch ms."""
    rebased = []
    for session in sessions:
        session = dict(session)
        for relative, absolute in (("startedAgoSec", "startedAt"), ("updatedAgoSec", "updatedAt")):
            seconds = session.get(relative)
            if isinstance(seconds, (int, float)) and not isinstance(seconds, bool):
                session[absolute] = (now - seconds) * 1000.0
                session.setdefault("statusUpdatedAt", session.get("updatedAt"))
        rebased.append(session)
    return rebased


class FixtureFeed(SessionSource, ActivitySource):
    """A session is alive unless its status is "offline". Activity is taken
    as written: the fixture already holds feed-shaped activity."""

    def __init__(self, sessions: List[dict]):
        self._sessions = sessions

    @classmethod
    def from_file(cls, path=FIXTURE_FILE):
        return cls(load_fixture(path))

    def sessions(self, now) -> List[SessionRecord]:
        return [SessionRecord(raw=dict(raw, _fixture=True), alive=raw.get("status") != "offline")
                for raw in rebase_fixture(self._sessions, now)]

    def activity(self, record: SessionRecord, now) -> Optional[Activity]:
        raw = record.raw
        followers = [dict(follower) for follower in raw.get("followers") or []]
        for follower in followers:
            _fill_follower_defaults(follower, raw.get("branch"), now)
        current = raw.get("activity")
        age = (current or {}).get("ageSec")
        return Activity(current=current, recent=list(raw.get("recent") or []), followers=followers,
                        branch=raw.get("branch"), tool_count=raw.get("toolCount", len(raw.get("recent") or [])),
                        last_tool_at=(now - age) if isinstance(age, (int, float)) else None)


def _fill_follower_defaults(follower, lead_branch, now):
    """Fields a fixture follower may leave out, computed the way live ones are."""
    follower.setdefault("state", "active")
    follower.setdefault("seed", seed_of(str(follower.get("id", ""))))
    follower.setdefault("finished", follower["state"] == "resting")
    follower.setdefault("stalled", follower_stalled(follower["finished"], follower.get("quietSec") or 0))
    follower.setdefault("branch", lead_branch)
    started_ago = follower.pop("startedAgoSec", None)
    follower.setdefault("startedAt", (now - started_ago) if isinstance(started_ago, (int, float)) else None)
