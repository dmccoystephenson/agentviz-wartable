from typing import Optional

from ..model import Activity, SessionRecord


class ActivitySource:
    """Port: what has a session been doing? Returns None when nothing is
    known (no transcript). Subagents are listed only for live sessions."""

    def activity(self, record: SessionRecord, now) -> Optional[Activity]:
        raise NotImplementedError
