"""agentfeed: live Claude Code sessions and their subagents as one JSON document.

Every agent visualization in this family reads the same document, so the
privacy rule and the meaning of each field live here, once. The logic is
lifted from claude-code-dashboard's village.py (the `/3d` session village),
minus its layout: each visualization does its own layout.

Sources (all local, read only):
  ~/.claude/sessions/<pid>.json          live process state (status, cwd, name)
  ~/.claude/projects/<cwd>/<id>.jsonl    the session's transcript (tail only)
  ~/.claude/projects/<cwd>/<id>/subagents/agent-*.jsonl (+ .meta.json)

Privacy: transcripts hold real work. Only tool names and short labels leave
this module (a file's basename, a Bash command's own one-line description, a
web host, a subagent's description), never file contents, commands, prompts
or full paths. A session's cwd is reduced to its basename ("place").

The document's shape is described in docs/FEED.md (schema version 1).
"""
import glob
import json
import math
import os
import re
import threading
import time
from datetime import datetime

SCHEMA_VERSION = 1

ACTIVE_WINDOW_SEC = 120     # a tool call this recent is what the agent is doing now
FOLLOWER_WINDOW_SEC = 120   # a subagent that wrote this recently is "active"
RESTING_WINDOW_SEC = 900    # ... this recently, "resting" (finished or paused)
OFFLINE_WINDOW_SEC = 6 * 3600  # a dead session updated this recently is shown "offline"
MAX_FOLLOWERS = 8
RECENT_TOOLS = 8
TAIL_BYTES = 96 * 1024
LABEL_MAX = 48
STALL_SEC = 300

STATES = ("offline", "dim", "idle", "busy", "waiting")

# Tool -> action. The names are neutral verbs; each visualization draws them
# its own way (typing at a desk, chopping at a station, welding a hull...).
ACTIONS = ("none", "edit", "run", "read", "web", "delegate", "think", "other")
_TOOL_ACTIONS = {
    "Edit": "edit", "Write": "edit", "MultiEdit": "edit", "NotebookEdit": "edit",
    "Bash": "run", "BashOutput": "run", "KillShell": "run", "KillBash": "run", "Monitor": "run",
    "Read": "read", "Grep": "read", "Glob": "read", "LS": "read",
    "WebSearch": "web", "WebFetch": "web",
    "Agent": "delegate", "Task": "delegate", "Workflow": "delegate",
}


def state_of(status, alive=True):
    if not alive:
        return "offline"
    if status in ("busy", "waiting", "idle"):
        return status
    return "dim"


def action_of_tool(tool):
    if not tool:
        return "none"
    return _TOOL_ACTIONS.get(tool, "other")


def current_action(state, last_tool, last_tool_age, followers=0):
    """Only a busy agent works. A busy agent whose last tool call is older than
    the window is delegating if it has active followers, thinking otherwise."""
    if state != "busy":
        return "none"
    if last_tool and last_tool_age is not None and last_tool_age <= ACTIVE_WINDOW_SEC:
        return action_of_tool(last_tool)
    return "delegate" if followers else "think"


def short(s, limit=LABEL_MAX):
    s = " ".join(str(s).split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def tool_label(name, inp):
    """A short, content-free label for one tool call, or None."""
    if not isinstance(inp, dict):
        return None
    if name in ("Edit", "Write", "MultiEdit", "Read", "NotebookEdit"):
        p = inp.get("file_path") or inp.get("notebook_path")
        return short(os.path.basename(p)) if isinstance(p, str) and p else None
    if name == "Bash":
        d = inp.get("description")
        return short(d) if isinstance(d, str) and d else None
    if name == "WebFetch":
        m = re.match(r"https?://([^/:?#]+)", str(inp.get("url") or ""))
        return m.group(1) if m else None
    if name in ("Agent", "Task"):
        d = inp.get("description")
        return short(d) if isinstance(d, str) and d else None
    return None


def place_of(cwd, home=None):
    """(id, label) of the place a cwd belongs to: its basename, or "~"."""
    home = home or os.path.expanduser("~")
    if not cwd or os.path.normpath(os.path.expanduser(cwd)) == os.path.normpath(home):
        return "~", "home"
    base = os.path.basename(os.path.normpath(cwd)) or "?"
    label = base.split("__", 1)[1] if "__" in base and base.split("__", 1)[1] else base
    return base, label


def seed_of(text):
    """Stable 0..1 per string (FNV-1a 32-bit). Same as the village page's."""
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h % 10000) / 10000.0


def iso_epoch(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


# ------------------------------------------------------------- transcripts

_lock = threading.Lock()
_tail_cache = {}
_path_cache = {}


def encode_cwd(cwd):
    return re.sub(r"[^A-Za-z0-9]", "-", cwd if isinstance(cwd, str) else "")


def transcript_path(projects_dir, session_id, cwd):
    if not session_id or not isinstance(session_id, str):
        return None
    direct = os.path.join(projects_dir, encode_cwd(cwd), session_id + ".jsonl")
    if os.path.isfile(direct):
        return direct
    cached = _path_cache.get(session_id)
    if cached and os.path.isfile(cached):
        return cached
    hits = glob.glob(os.path.join(projects_dir, "*", glob.escape(session_id) + ".jsonl"))
    if hits:
        _path_cache[session_id] = hits[0]
        return hits[0]
    return None


def read_tail(path, tail_bytes=TAIL_BYTES):
    """({"tools": [{tool, label, ts}], "branch": str|None}) from the last
    `tail_bytes` of a transcript. Cached by (mtime, size)."""
    empty = {"tools": [], "branch": None}
    try:
        st = os.stat(path)
    except OSError:
        return empty
    key = (path, tail_bytes)
    with _lock:
        hit = _tail_cache.get(key)
        if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
            return hit[2]
    try:
        with open(path, "rb") as f:
            start = max(0, st.st_size - tail_bytes)
            f.seek(start)
            data = f.read()
    except OSError:
        return empty
    lines = data.split(b"\n")
    if start > 0:
        lines = lines[1:]
    tools, branch = [], None
    for raw in lines:
        if b'"gitBranch"' not in raw and b'"tool_use"' not in raw:
            continue
        try:
            d = json.loads(raw.decode("utf-8", "ignore"))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        if isinstance(d.get("gitBranch"), str) and d["gitBranch"]:
            branch = short(d["gitBranch"], 60)
        if d.get("type") != "assistant":
            continue
        ts = iso_epoch(d.get("timestamp"))
        msg = d.get("message")
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name"):
                tools.append({"tool": str(c["name"]), "label": tool_label(c["name"], c.get("input")), "ts": ts})
    result = {"tools": tools, "branch": branch}
    with _lock:
        _tail_cache[key] = (st.st_mtime, st.st_size, result)
        if len(_tail_cache) > 512:
            for k in list(_tail_cache)[:256]:
                del _tail_cache[k]
    return result


def followers_of(transcript, now):
    """Subagents of one session written to within RESTING_WINDOW_SEC, newest
    first. state: "active" (written within FOLLOWER_WINDOW_SEC) or "resting"."""
    sub_dir = os.path.join(transcript[: -len(".jsonl")], "subagents")
    out = []
    for path in glob.glob(os.path.join(sub_dir, "agent-*.jsonl")):
        try:
            mtime = os.stat(path).st_mtime
        except OSError:
            continue
        quiet = now - mtime
        if quiet > RESTING_WINDOW_SEC:
            continue
        agent_id = os.path.basename(path)[len("agent-"): -len(".jsonl")]
        label = None
        try:
            with open(path[: -len(".jsonl")] + ".meta.json", "r") as f:
                meta = json.load(f)
            if isinstance(meta.get("description"), str):
                label = short(meta["description"], 40)
        except Exception:
            pass
        tail = read_tail(path, 32 * 1024)
        tools = tail["tools"]
        last = tools[-1] if tools else None
        age = (now - last["ts"]) if last and last["ts"] else None
        active = quiet <= FOLLOWER_WINDOW_SEC
        out.append({
            "id": agent_id,
            "label": label or "subagent",
            "state": "active" if active else "resting",
            "tool": last["tool"] if last else None,
            "toolLabel": last["label"] if last else None,
            "action": current_action("busy", last["tool"] if last else None, age) if active else "none",
            "ageSec": round(age, 1) if age is not None else None,
            "quietSec": round(quiet, 1),
            "toolCount": len(tools),
            "seed": seed_of(agent_id),
        })
    out.sort(key=lambda f: f["quietSec"])
    return out[:MAX_FOLLOWERS]


# ---------------------------------------------------------------- liveness

def pid_alive(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return is_claude_process(pid)


def is_claude_process(pid):
    try:
        with open("/proc/%d/cmdline" % int(pid), "rb") as f:
            cmd = f.read()
    except (OSError, ValueError, TypeError):
        return True
    return (not cmd) or b"claude" in cmd.lower()


def _ms_age(ms, now):
    if not isinstance(ms, (int, float)) or isinstance(ms, bool) or not ms:
        return None
    try:
        if not math.isfinite(ms):
            return None
        return round(max(0.0, now - ms / 1000.0), 1)
    except OverflowError:
        return None


# ---------------------------------------------------------------- document

def read_registry(sessions_dir):
    out = []
    for path in glob.glob(os.path.join(sessions_dir, "*.json")):
        try:
            with open(path, "r") as f:
                d = json.load(f)
        except Exception:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def session_entry(raw, projects_dir, now, alive, fixture=False):
    sid = str(raw.get("sessionId") or raw.get("pid") or "?")
    cwd = raw.get("cwd") if isinstance(raw.get("cwd"), str) else ""
    place, place_label = place_of(cwd)
    state = state_of(raw.get("status"), alive)
    if fixture:
        activity = raw.get("activity")
        recent = list(raw.get("recent") or [])
        followers = [dict(f) for f in raw.get("followers") or []]
        for f in followers:
            f.setdefault("state", "active")
            f.setdefault("seed", seed_of(str(f.get("id", ""))))
        branch = raw.get("branch")
    else:
        activity, recent, followers, branch = None, [], [], None
        path = transcript_path(projects_dir, raw.get("sessionId"), cwd)
        if path:
            tail = read_tail(path)
            tools, branch = tail["tools"], tail["branch"]
            for t in tools[-RECENT_TOOLS:]:
                age = (now - t["ts"]) if t["ts"] else None
                recent.append({"tool": t["tool"], "action": action_of_tool(t["tool"]),
                               "ageSec": round(age, 1) if age is not None else None})
            if tools:
                last = tools[-1]
                age = (now - last["ts"]) if last["ts"] else None
                activity = {"tool": last["tool"], "action": action_of_tool(last["tool"]), "label": last["label"],
                            "ageSec": round(age, 1) if age is not None else None}
            if alive:
                followers = followers_of(path, now)
    name = raw.get("name") or "%s-%s" % (place_label, sid[:4])
    idle = _ms_age(raw.get("updatedAt"), now)
    tool_age = (activity or {}).get("ageSec")
    if idle is not None and tool_age is not None:
        idle = min(idle, tool_age)
    active_followers = sum(1 for f in followers if f.get("state") == "active")
    return {
        "id": sid,
        "name": short(name, 60),
        "state": state,
        "status": raw.get("status"),
        "statusAgeSec": _ms_age(raw.get("statusUpdatedAt") or raw.get("updatedAt"), now),
        "uptimeSec": _ms_age(raw.get("startedAt"), now),
        "idleSec": idle,
        "stalled": bool(state == "busy" and idle is not None and idle > STALL_SEC),
        "place": place,
        "placeLabel": place_label,
        "branch": branch,
        "kind": raw.get("kind"),
        "fixture": fixture,
        "activity": activity,
        "action": current_action(state, (activity or {}).get("tool"), tool_age, active_followers),
        "recent": recent,
        "followers": followers,
        "seed": seed_of(sid),
        "startedAt": raw.get("startedAt") or 0,
    }


def build_feed(sessions_dir=None, projects_dir=None, now=None, fixture=None, include_offline=True):
    """The feed document. `fixture`: a list of raw session dicts used INSTEAD
    of the live registry (demo / tests / screenshots)."""
    home = os.path.expanduser("~")
    sessions_dir = sessions_dir or os.path.join(home, ".claude", "sessions")
    projects_dir = projects_dir or os.path.join(home, ".claude", "projects")
    now = time.time() if now is None else now
    sessions = []
    if fixture is not None:
        for raw in fixture:
            alive = raw.get("status") != "offline"
            sessions.append(session_entry(raw, projects_dir, now, alive, fixture=True))
    else:
        for raw in read_registry(sessions_dir):
            alive = pid_alive(raw.get("pid"))
            if not alive:
                age = _ms_age(raw.get("updatedAt"), now)
                if not include_offline or age is None or age > OFFLINE_WINDOW_SEC:
                    continue
            sessions.append(session_entry(raw, projects_dir, now, alive))
    # Stable order: by start time, then id, so layouts don't shuffle.
    sessions.sort(key=lambda s: (s["startedAt"], s["id"]))
    places = {}
    for s in sessions:
        p = places.setdefault(s["place"], {"id": s["place"], "label": s["placeLabel"], "seed": seed_of(s["place"]),
                                           "sessions": 0, "busy": 0, "waiting": 0, "followers": 0})
        p["sessions"] += 1
        p["busy"] += s["state"] == "busy"
        p["waiting"] += s["state"] == "waiting"
        p["followers"] += len(s["followers"])
    counts = {k: 0 for k in STATES}
    for s in sessions:
        counts[s["state"]] += 1
    counts["followers"] = sum(len(s["followers"]) for s in sessions)
    counts["activeFollowers"] = sum(1 for s in sessions for f in s["followers"] if f.get("state") == "active")
    return {"version": SCHEMA_VERSION, "serverTime": now, "fixture": fixture is not None,
            "counts": counts, "places": sorted(places.values(), key=lambda p: (-p["sessions"], p["id"])),
            "sessions": sessions}


def load_fixture(path):
    with open(path, "r") as f:
        d = json.load(f)
    return [s for s in d.get("sessions", []) if isinstance(s, dict)]
