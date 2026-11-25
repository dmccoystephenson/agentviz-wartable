"""ActivitySource adapter: the tail of each session's transcript,
~/.claude/projects/<encoded cwd>/<sessionId>.jsonl, and its subagents'
transcripts in <sessionId>/subagents/agent-*.jsonl (+ .meta.json).

Only the last TAIL_BYTES of a transcript are read, and results are cached by
(mtime, size), so polling every 2 s stays cheap."""
import glob
import json
import os
import re
import threading
from typing import List, Optional

from ..core import summarize
from ..labels import short_label, tool_label
from ..model import Activity, Follower, History, SessionRecord, ToolCall
from ..ports.activity_source import ActivitySource
from ..times import iso_epoch
from ..vocabulary import RESTING_WINDOW_SEC

TAIL_BYTES = 96 * 1024
SUBAGENT_TAIL_BYTES = 32 * 1024
_CACHE_LIMIT = 512


def encode_cwd(cwd) -> str:
    """How Claude Code names a project directory: every character of the cwd
    that isn't a letter or digit becomes '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", cwd if isinstance(cwd, str) else "")


class TranscriptTailCache:
    """Parsed transcript tails, keyed by path and tail size, valid while the
    file's mtime and size are unchanged."""

    def __init__(self):
        self._lock = threading.Lock()
        self._entries = {}

    def read(self, path, tail_bytes) -> History:
        try:
            stat = os.stat(path)
        except OSError:
            return History()
        key = (path, tail_bytes)
        with self._lock:
            hit = self._entries.get(key)
            if hit and hit[0] == stat.st_mtime and hit[1] == stat.st_size:
                return hit[2]
        history = parse_tail(_read_tail_bytes(path, stat.st_size, tail_bytes))
        with self._lock:
            self._entries[key] = (stat.st_mtime, stat.st_size, history)
            if len(self._entries) > _CACHE_LIMIT:
                for stale in list(self._entries)[: _CACHE_LIMIT // 2]:
                    del self._entries[stale]
        return history


def _read_tail_bytes(path, size, tail_bytes) -> List[bytes]:
    """The complete lines in the last `tail_bytes` of a file."""
    start = max(0, size - tail_bytes)
    try:
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read()
    except OSError:
        return []
    lines = data.split(b"\n")
    return lines[1:] if start > 0 else lines  # the first line is cut mid-way


def parse_tail(lines: List[bytes]) -> History:
    """Tool calls (oldest first) and the last git branch in transcript lines.
    Lines that aren't JSON are skipped."""
    history = History()
    for raw in lines:
        if b'"gitBranch"' not in raw and b'"tool_use"' not in raw:
            continue
        try:
            line = json.loads(raw.decode("utf-8", "ignore"))
        except ValueError:
            continue
        if not isinstance(line, dict):
            continue
        if isinstance(line.get("gitBranch"), str) and line["gitBranch"]:
            history.branch = short_label(line["gitBranch"], 60)
        if line.get("type") == "assistant":
            history.tools.extend(_tool_calls(line))
    return history


def _tool_calls(line) -> List[ToolCall]:
    message = line.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, list):
        return []
    timestamp = iso_epoch(line.get("timestamp"))
    return [ToolCall(tool=str(part["name"]), label=tool_label(part["name"], part.get("input")), timestamp=timestamp)
            for part in content
            if isinstance(part, dict) and part.get("type") == "tool_use" and part.get("name")]


class ClaudeHomeActivity(ActivitySource):
    def __init__(self, projects_dir=None, cache: Optional[TranscriptTailCache] = None):
        self.projects_dir = projects_dir or os.path.join(os.path.expanduser("~"), ".claude", "projects")
        self.cache = cache or TranscriptTailCache()
        self._paths = {}
        self._starts = {}

    def activity(self, record: SessionRecord, now) -> Optional[Activity]:
        path = self.transcript_path(record.raw.get("sessionId"), record.raw.get("cwd"))
        if not path:
            return None
        history = self.cache.read(path, TAIL_BYTES)
        if record.alive:
            history = History(tools=history.tools, branch=history.branch, followers=self._followers(path, now))
        return summarize(history, now, include_followers=record.alive)

    def transcript_path(self, session_id, cwd) -> Optional[str]:
        """The session's transcript: under its cwd's project directory, or
        wherever a search of all projects last found it."""
        if not session_id or not isinstance(session_id, str):
            return None
        direct = os.path.join(self.projects_dir, encode_cwd(cwd), session_id + ".jsonl")
        if os.path.isfile(direct):
            return direct
        cached = self._paths.get(session_id)
        if cached and os.path.isfile(cached):
            return cached
        hits = glob.glob(os.path.join(self.projects_dir, "*", glob.escape(session_id) + ".jsonl"))
        if hits:
            self._paths[session_id] = hits[0]
            return hits[0]
        return None

    def _followers(self, transcript, now) -> List[Follower]:
        """Subagents written to within RESTING_WINDOW_SEC."""
        subagent_dir = os.path.join(transcript[: -len(".jsonl")], "subagents")
        followers = []
        for path in glob.glob(os.path.join(subagent_dir, "agent-*.jsonl")):
            try:
                quiet = now - os.stat(path).st_mtime
            except OSError:
                continue
            if quiet > RESTING_WINDOW_SEC:
                continue
            agent_id = os.path.basename(path)[len("agent-"): -len(".jsonl")]
            tail = self.cache.read(path, SUBAGENT_TAIL_BYTES)
            label, finished = _subagent_meta(path)
            followers.append(Follower(agent_id=agent_id, label=label, quiet_sec=quiet, tools=tail.tools,
                                      finished=finished, started_at=self._started_at(path), branch=tail.branch))
        return followers

    def _started_at(self, path) -> Optional[float]:
        """Epoch seconds of a transcript's first line (cached: it never changes)."""
        if path not in self._starts:
            self._starts[path] = _first_timestamp(path)
        return self._starts[path]


def _first_timestamp(path) -> Optional[float]:
    try:
        with open(path, "rb") as f:
            first = f.readline(64 * 1024)
        return iso_epoch(json.loads(first.decode("utf-8", "ignore")).get("timestamp"))
    except (OSError, ValueError, AttributeError):
        return None


def _subagent_meta(transcript_path):
    """(label, finished) from a subagent's .meta.json: the description its
    parent gave it, and whether it has finished (None when unknown)."""
    try:
        with open(transcript_path[: -len(".jsonl")] + ".meta.json", "r") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return "subagent", None
    if not isinstance(meta, dict):
        return "subagent", None
    description = meta.get("description")
    label = short_label(description, 40) if isinstance(description, str) else ""
    finished = meta.get("finished") if isinstance(meta.get("finished"), bool) else None
    return label or "subagent", finished
