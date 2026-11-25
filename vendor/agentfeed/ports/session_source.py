from typing import List

from ..model import SessionRecord


class SessionSource:
    """Port: which sessions exist right now, and is each one alive?"""

    def sessions(self, now) -> List[SessionRecord]:
        raise NotImplementedError
