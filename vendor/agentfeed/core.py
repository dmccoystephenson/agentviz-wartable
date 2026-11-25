"""The pure core: registry records and activity in, the feed document out.
No file, process or network access happens here; see ports/ and adapters/."""
import math
from typing import List, Optional

from .labels import place_of, seed_of, short_label
from .model import Activity, Follower, History, SessionRecord, ToolCall
from .times import age_of, age_of_ms
from .vocabulary import (FOLLOWER_WINDOW_SEC, MAX_FOLLOWERS, RECENT_TOOLS, SCHEMA_VERSION, STALL_SEC,
                         STATES, action_of_tool, current_action, state_of)


# ------------------------------------------------------------ history -> activity

def summarize(history: History, now, include_followers=True) -> Activity:
    """Turn a transcript's history into feed-shaped activity."""
    followers = summarize_followers(history.followers, now) if include_followers else []
    last = history.tools[-1] if history.tools else None
    return Activity(current=_current_call(history.tools, now), recent=_recent_calls(history.tools, now),
                    followers=followers, branch=history.branch, tool_count=len(history.tools),
                    last_tool_at=last.timestamp if last else None)


def summarize_followers(followers: List[Follower], now) -> List[dict]:
    """Feed dicts for subagents, most recently written first, at most MAX_FOLLOWERS."""
    entries = sorted((_follower_entry(f, now) for f in followers), key=lambda entry: entry["quietSec"])
    return entries[:MAX_FOLLOWERS]


def _current_call(tools: List[ToolCall], now) -> Optional[dict]:
    if not tools:
        return None
    last = tools[-1]
    return {"tool": last.tool, "action": action_of_tool(last.tool), "label": last.label,
            "ageSec": age_of(last.timestamp, now)}


def _recent_calls(tools: List[ToolCall], now) -> List[dict]:
    return [{"tool": call.tool, "action": action_of_tool(call.tool), "ageSec": age_of(call.timestamp, now)}
            for call in tools[-RECENT_TOOLS:]]


def _follower_entry(follower: Follower, now) -> dict:
    last = follower.tools[-1] if follower.tools else None
    age = age_of(last.timestamp, now) if last else None
    active = follower.quiet_sec <= FOLLOWER_WINDOW_SEC
    tool = last.tool if last else None
    return {
        "id": follower.agent_id,
        "label": follower.label,
        "state": "active" if active else "resting",
        "tool": tool,
        "toolLabel": last.label if last else None,
        "action": current_action("busy", tool, age) if active else "none",
        "ageSec": age,
        "quietSec": round(follower.quiet_sec, 1),
        "toolCount": len(follower.tools),
        "seed": seed_of(follower.agent_id),
        "finished": follower.finished,
        "stalled": follower_stalled(follower.finished, follower.quiet_sec),
        "branch": follower.branch,
        "startedAt": follower.started_at,
    }


def follower_stalled(finished, quiet_sec) -> bool:
    """A subagent that hasn't said it finished but has written nothing for
    STALL_SEC. Unknown `finished` (None) never counts as stalled."""
    return finished is False and quiet_sec > STALL_SEC


# ------------------------------------------------------------ session entries

def _text_or_none(value) -> Optional[str]:
    return value if isinstance(value, str) else None


def _epoch_ms_or_zero(value):
    """A registry timestamp as a finite number; anything else (a corrupt file,
    NaN, Infinity, which JSON can't carry) as 0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return value if math.isfinite(value) else 0


def _short_text_or_none(value, limit=32):
    text = _text_or_none(value)
    return short_label(text, limit) if text is not None else None


def session_entry(record: SessionRecord, activity: Optional[Activity], now) -> dict:
    """One session's feed entry. Registry fields of the wrong type (a corrupt
    or hand-edited file) are treated as missing rather than failing the feed."""
    raw = record.raw
    activity = activity or Activity()
    session_id = short_label(str(raw.get("sessionId") or raw.get("pid") or "?"), 80)
    place, place_label = place_of(raw.get("cwd") if isinstance(raw.get("cwd"), str) else "")
    status = _short_text_or_none(raw.get("status"))
    state = state_of(status, record.alive)
    current = activity.current
    tool_age = (current or {}).get("ageSec")
    idle = _idle_seconds(raw, tool_age, now)
    active_followers = sum(1 for f in activity.followers if f.get("state") == "active")
    status_age = age_of_ms(raw.get("statusUpdatedAt") or raw.get("updatedAt"), now)
    return {
        "id": session_id,
        "name": short_label(_text_or_none(raw.get("name")) or "%s-%s" % (place_label, session_id[:4]), 60),
        "state": state,
        "status": status,
        "statusAgeSec": status_age,
        "uptimeSec": age_of_ms(raw.get("startedAt"), now),
        "idleSec": idle,
        "stalled": bool(state == "busy" and idle is not None and idle > STALL_SEC),
        "place": place,
        "placeLabel": place_label,
        "branch": activity.branch,
        "kind": _short_text_or_none(raw.get("kind")),
        "fixture": bool(raw.get("_fixture")),
        "activity": current,
        "action": current_action(state, (current or {}).get("tool"), tool_age, active_followers),
        "recent": activity.recent,
        "followers": activity.followers,
        "seed": seed_of(session_id),
        "startedAt": _epoch_ms_or_zero(raw.get("startedAt")),
        "toolCount": activity.tool_count,
        "lastToolAt": activity.last_tool_at,
        "waitingSec": status_age if state == "waiting" else None,
        "waitingReason": waiting_reason(state, current),
    }


def waiting_reason(state, current) -> Optional[str]:
    """Why a waiting session needs the owner: "question" when its last tool
    call asked one (AskUserQuestion), otherwise "permission". None when the
    session isn't waiting."""
    if state != "waiting":
        return None
    return "question" if (current or {}).get("tool") == "AskUserQuestion" else "permission"


def _idle_seconds(raw, tool_age, now):
    """Seconds since the session last did anything: the registry's last update,
    or its last tool call if that is more recent."""
    idle = age_of_ms(raw.get("updatedAt"), now)
    if idle is not None and tool_age is not None:
        return min(idle, tool_age)
    return idle


# ------------------------------------------------------------ the document

def feed_document(entries: List[dict], now, fixture: bool) -> dict:
    """The /api/agents document (docs/FEED.md) from session entries."""
    sessions = sorted(entries, key=lambda s: (s["startedAt"], s["id"]))
    return {"version": SCHEMA_VERSION, "serverTime": now, "fixture": fixture,
            "counts": _counts(sessions), "places": _places(sessions), "sessions": sessions}


def _places(sessions: List[dict]) -> List[dict]:
    places = {}
    for s in sessions:
        place = places.setdefault(s["place"], {"id": s["place"], "label": s["placeLabel"], "seed": seed_of(s["place"]),
                                               "sessions": 0, "busy": 0, "waiting": 0, "followers": 0,
                                               "toolCount": 0})
        place["sessions"] += 1
        place["busy"] += s["state"] == "busy"
        place["waiting"] += s["state"] == "waiting"
        place["followers"] += len(s["followers"])
        place["toolCount"] += s["toolCount"] + sum(f.get("toolCount") or 0 for f in s["followers"])
    return sorted(places.values(), key=lambda p: (-p["sessions"], p["id"]))


def _counts(sessions: List[dict]) -> dict:
    counts = {state: 0 for state in STATES}
    for s in sessions:
        counts[s["state"]] += 1
    counts["followers"] = sum(len(s["followers"]) for s in sessions)
    counts["activeFollowers"] = sum(1 for s in sessions for f in s["followers"] if f.get("state") == "active")
    return counts


def is_shown_offline(record: SessionRecord, now, offline_window_sec) -> bool:
    """A dead session stays in the feed while its last update is recent."""
    age = age_of_ms(record.raw.get("updatedAt"), now)
    return age is not None and age <= offline_window_sec
