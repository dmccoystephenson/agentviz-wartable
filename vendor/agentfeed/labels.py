"""Short, content-free labels. This module is the privacy boundary: nothing
from a transcript leaves the feed except what these functions return."""
import os
import re

LABEL_MAX = 48
REDACTED = "[redacted]"
# Token-shaped strings a free-text label might carry (a Bash description is
# the model's own words and can quote a command). Replaced before any label
# leaves the feed.
_SECRET_PATTERNS = [re.compile(pattern, re.IGNORECASE) for pattern in (
    r"\bsk-[a-z0-9_-]{8,}",                       # Anthropic / OpenAI style keys
    r"\bgh[pousr]_[a-z0-9]{16,}",                 # GitHub tokens
    r"\bgithub_pat_[a-z0-9_]{16,}",
    r"\bxox[abprs]-[a-z0-9-]{8,}",                # Slack tokens
    r"\bAKIA[0-9A-Z]{16}\b",                       # AWS access key ids
    r"\b(bearer|basic)\s+[a-z0-9._~+/=-]{8,}",      # Authorization header values
    r"\b(token|secret|password|passwd|api[_-]?key)\s*[=:]\s*\S+",
    r"\b[a-f0-9]{32,}\b",                          # long hex secrets
)]
_FILE_TOOLS = ("Edit", "Write", "MultiEdit", "Read", "NotebookEdit")


def redact(text):
    """`text` with token-shaped substrings replaced by REDACTED."""
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


def short_label(text, limit=LABEL_MAX):
    """`text` on one line, secrets redacted, cut to `limit` characters with an
    ellipsis."""
    text = redact(" ".join(str(text).split()))
    return text if len(text) <= limit else text[: limit - 1] + "…"


def tool_label(name, tool_input):
    """A file's basename, a Bash command's own description, a web host or a
    subagent's description; None for everything else."""
    if not isinstance(tool_input, dict):
        return None
    if name in _FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        return short_label(os.path.basename(path)) if isinstance(path, str) and path else None
    if name in ("Bash", "Agent", "Task"):
        description = tool_input.get("description")
        return short_label(description) if isinstance(description, str) and description else None
    if name == "WebFetch":
        match = re.match(r"https?://([^/:?#]+)", str(tool_input.get("url") or ""))
        return match.group(1) if match else None
    return None


def place_of(cwd, home=None):
    """(id, label) of the place a working directory belongs to: its basename,
    or "~" for the home directory. Gardener cache clones are named
    Owner__Repo; the label keeps only the repo."""
    home = home or os.path.expanduser("~")
    if not cwd or os.path.normpath(os.path.expanduser(cwd)) == os.path.normpath(home):
        return "~", "home"
    base = os.path.basename(os.path.normpath(cwd)) or "?"
    repo = base.split("__", 1)[1] if "__" in base else ""
    return base, repo or base


def seed_of(text):
    """A stable 0..1 number per string (FNV-1a 32-bit), for colours and jitter.
    Pages and scenes that hash ids themselves must use the same function."""
    value = 2166136261
    for character in text:
        value = ((value ^ ord(character)) * 16777619) & 0xFFFFFFFF
    return (value % 10000) / 10000.0
