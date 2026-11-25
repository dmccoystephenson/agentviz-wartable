"""Timestamp helpers. Every function returns None for a value it can't read,
so one corrupt field skips a number instead of failing the feed."""
import math
from datetime import datetime


def iso_epoch(text):
    """Epoch seconds for an ISO-8601 timestamp, or None."""
    if not text:
        return None
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def age_of_ms(epoch_ms, now):
    """Seconds since an epoch-milliseconds timestamp, rounded to 0.1, or None
    when it is missing, zero, not a number, infinite or too large."""
    if not isinstance(epoch_ms, (int, float)) or isinstance(epoch_ms, bool) or not epoch_ms:
        return None
    try:
        if not math.isfinite(epoch_ms):
            return None
        return round(max(0.0, now - epoch_ms / 1000.0), 1)
    except OverflowError:
        return None


def age_of(epoch_seconds, now):
    """Seconds since an epoch-seconds timestamp, rounded to 0.1, or None."""
    return round(now - epoch_seconds, 1) if epoch_seconds else None
