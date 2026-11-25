"""SessionSource adapter: Claude Code's live-session registry,
~/.claude/sessions/<pid>.json, plus a check that each pid is still Claude."""
import glob
import json
import os
from typing import Callable, List

from ..model import SessionRecord
from ..ports.session_source import SessionSource


def pid_alive(pid) -> bool:
    """True when `pid` is a running process that is (or may be) Claude Code."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        return True  # os.kill(pid, 0) sends CTRL_C_EVENT on Windows; assume alive
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return is_claude_process(pid)


def is_claude_process(pid) -> bool:
    """False when /proc shows the pid now belongs to something other than
    Claude Code (pids are reused). True when it is, or when /proc can't tell."""
    try:
        with open("/proc/%d/cmdline" % int(pid), "rb") as f:
            command_line = f.read()
    except (OSError, ValueError, TypeError):
        return True
    return (not command_line) or b"claude" in command_line.lower()


class ClaudeHomeSessions(SessionSource):
    def __init__(self, sessions_dir=None, is_alive: Callable[[object], bool] = pid_alive):
        self.sessions_dir = sessions_dir or os.path.join(os.path.expanduser("~"), ".claude", "sessions")
        self.is_alive = is_alive

    def sessions(self, now) -> List[SessionRecord]:
        records = []
        for entry in self._registry_entries():
            records.append(SessionRecord(raw=entry, alive=self.is_alive(entry.get("pid"))))
        return records

    def _registry_entries(self):
        """Every readable registry file. A file that is mid-write or corrupt is
        skipped: one bad session must not take down the whole feed."""
        for path in glob.glob(os.path.join(self.sessions_dir, "*.json")):
            try:
                with open(path, "r") as f:
                    entry = json.load(f)
            except (OSError, ValueError):
                continue
            if isinstance(entry, dict):
                yield entry
