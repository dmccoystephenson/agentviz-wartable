"""The words every visualization shares: session states, actions, and the
time windows that decide them."""

SCHEMA_VERSION = 1

STATES = ("offline", "dim", "idle", "busy", "waiting")
ACTIONS = ("none", "edit", "run", "read", "web", "delegate", "think", "other")

# A tool call this recent is what the agent is doing now.
ACTIVE_WINDOW_SEC = 120
# A subagent that wrote its transcript this recently is "active" ...
FOLLOWER_WINDOW_SEC = 120
# ... and this recently, "resting" (finished or paused). Older ones are gone.
RESTING_WINDOW_SEC = 900
# A dead session updated this recently is still shown, as "offline".
OFFLINE_WINDOW_SEC = 6 * 3600
# A busy session that has written nothing for this long is "stalled".
STALL_SEC = 300

MAX_FOLLOWERS = 8
RECENT_TOOLS = 8

_TOOL_ACTIONS = {
    "Edit": "edit", "Write": "edit", "MultiEdit": "edit", "NotebookEdit": "edit",
    "Bash": "run", "BashOutput": "run", "KillShell": "run", "KillBash": "run", "Monitor": "run",
    "Read": "read", "Grep": "read", "Glob": "read", "LS": "read",
    "WebSearch": "web", "WebFetch": "web",
    "Agent": "delegate", "Task": "delegate", "Workflow": "delegate",
}


def state_of(status, alive=True):
    """The feed state for a registry status; unknown statuses read as "dim"."""
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
