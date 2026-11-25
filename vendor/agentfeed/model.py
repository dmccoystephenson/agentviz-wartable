"""The plain records that cross the ports. Adapters fill them in; the core
turns them into the feed document."""
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ToolCall:
    tool: str
    label: Optional[str]
    timestamp: Optional[float]  # epoch seconds


@dataclass
class Follower:
    """One subagent as its transcript shows it."""
    agent_id: str
    label: str
    quiet_sec: float               # seconds since its transcript was written
    tools: List[ToolCall] = field(default_factory=list)
    finished: Optional[bool] = None  # from its .meta.json; None when unknown
    started_at: Optional[float] = None  # epoch seconds of its first transcript line
    branch: Optional[str] = None


@dataclass
class History:
    """What a session's transcript says: its recent tool calls, last git
    branch and live subagents."""
    tools: List[ToolCall] = field(default_factory=list)
    branch: Optional[str] = None
    followers: List[Follower] = field(default_factory=list)


@dataclass
class SessionRecord:
    """One session as the registry describes it. `raw` keeps the registry
    entry's own fields (sessionId, name, status, cwd, timestamps...)."""
    raw: dict
    alive: bool


@dataclass
class Activity:
    """A session's activity in feed shape: the current tool call, the last few
    calls, its subagents (feed dicts) and its git branch."""
    current: Optional[dict] = None
    recent: List[dict] = field(default_factory=list)
    followers: List[dict] = field(default_factory=list)
    branch: Optional[str] = None
    tool_count: int = 0                 # tool calls seen in the transcript tail
    last_tool_at: Optional[float] = None  # epoch seconds of the newest one
