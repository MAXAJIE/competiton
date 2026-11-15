"""A tiny TTL cache for data that rarely changes.

Only server-side reads that are (a) expensive or (b) identical for every caller
belong here: the category taxonomy, the model inventory, the AI capability
flags and the latest market snapshot. Anything belonging to one user does not —
a process-wide cache of a ledger would hand one account's rows to another.

The cache is a dict with an expiry per key, guarded by a lock. Values are
returned by reference, so callers must not mutate them.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, TypeVar

T = TypeVar("T")

_lock = threading.Lock()
_entries: dict[str, tuple[float, object]] = {}


def get(key: str) -> object | None:
    """The cached value, or None when missing/expired."""
    with _lock:
        hit = _entries.get(key)
        if not hit:
            return None
        expires_at, value = hit
        if expires_at <= time.monotonic():
            _entries.pop(key, None)
            return None
        return value


def put(key: str, value: object, ttl: float) -> object:
    with _lock:
        _entries[key] = (time.monotonic() + ttl, value)
    return value


def cached(key: str, ttl: float, produce: Callable[[], T]) -> T:
    """Return the cached value, computing and storing it on a miss.

    The producer runs outside the lock: a slow KB or network read must not block
    unrelated cache hits, and two concurrent misses simply compute twice.
    """
    hit = get(key)
    if hit is not None:
        return hit  # type: ignore[return-value]
    return put(key, produce(), ttl)  # type: ignore[return-value]


def invalidate(prefix: str = "") -> int:
    """Drop keys (all of them when prefix is empty). Returns how many went."""
    with _lock:
        keys = [k for k in _entries if k.startswith(prefix)]
        for k in keys:
            _entries.pop(k, None)
        return len(keys)


def clear() -> None:
    invalidate("")
