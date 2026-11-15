"""Cross-cutting safety: rate limits, secret redaction and input cleaning.

Three rules live here, because every route needs them and none of them belongs
to a single feature:

1. **Rate limits** — one in-process limiter, keyed by client IP plus a hash of
   the bearer token, with a smaller budget for the routes that cost money
   (OCR, the advisor, key checks, email) than for ordinary reads.
2. **Redaction** — nothing that leaves this server may contain an OpenRouter
   key or a Supabase token, including provider error strings that get echoed
   back to the client and into logs.
3. **Input cleaning** — text from a client is trimmed, stripped of control
   characters and capped, so a 2 MB "vendor name" cannot be stored and a form
   field cannot smuggle terminal escapes or NUL bytes into Postgres.

The app is deliberately research-grade: these are guardrails against abuse and
accidents, not a substitute for a WAF.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import deque
from typing import Iterable

# --- redaction ---------------------------------------------------------------

# Ordered most specific first: an OpenRouter key, then a bearer header, then a
# bare JWT (Supabase access tokens are JWTs and appear in error text).
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-or-v1-[A-Za-z0-9._\-]{6,}"),
    re.compile(r"sk-or-[A-Za-z0-9._\-]{6,}"),
    re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-]{8,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
)

REDACTED = "[redacted]"


def redact(text: object, limit: int = 400) -> str:
    """A safe, bounded string: secrets removed, length capped.

    Used for every message that is derived from a provider response (HTTP
    errors, exception text) before it is returned to a client or logged.
    """
    out = str(text or "")
    for pattern in _SECRET_PATTERNS:
        out = pattern.sub(REDACTED, out)
    out = out.strip()
    return out[:limit]


def looks_like_openrouter_key(value: str) -> bool:
    """A cheap shape check before a pasted key is sent anywhere."""
    return bool(re.fullmatch(r"sk-or-v1-[A-Za-z0-9._\-]{16,200}", (value or "").strip()))


# --- input cleaning ----------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WHITESPACE = re.compile(r"[ \t\u00a0]{2,}")
# Characters that only make sense in markup. Stored data is rendered as text by
# React, so angle brackets are harmless there — they are stripped anyway so a
# value cannot look like markup if some future view forgets to escape it.
_MARKUP = re.compile(r"[<>]")


def clean_text(value: object, *, max_len: int, allow_newlines: bool = False,
               strip_markup: bool = True) -> str:
    """Trim, de-control, collapse runs of spaces and cap the length.

    Raises ValueError when the value is not a string — pydantic turns that into
    a 422 with the field name, which is the message a client should see.
    """
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("must be text")
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    if strip_markup:
        text = _MARKUP.sub("", text)
    text = _CONTROL.sub("", text)
    if allow_newlines:
        lines = [line.strip() for line in text.split("\n")]
        text = "\n".join(line for line in lines[:40] if line)
    else:
        text = " ".join(text.split())
    text = _WHITESPACE.sub(" ", text).strip()
    if len(text) > max_len:
        raise ValueError(f"must be at most {max_len} characters")
    return text


# --- rate limiting -----------------------------------------------------------

class RateLimiter:
    """Sliding-window limiter. Thread-safe, in-process, no dependencies.

    In-process means each worker has its own budget; that is honest for this
    deployment (one small container) and documented in the README. A multi-
    worker deploy should move the buckets to Redis — the interface stays the
    same.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    def allow(self, key: str, limit: int, window: float) -> tuple[bool, float]:
        """True when this hit fits the budget, plus seconds to wait if not."""
        now = time.monotonic()
        with self._lock:
            bucket = self._hits.get(key)
            if bucket is None:
                bucket = self._hits[key] = deque()
            while bucket and now - bucket[0] >= window:
                bucket.popleft()
            if len(bucket) >= limit:
                return False, max(window - (now - bucket[0]), 0.0)
            bucket.append(now)
            self._maybe_sweep(now)
            return True, 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._last_sweep = 0.0

    def _maybe_sweep(self, now: float) -> None:
        # A public IP spraying random paths would otherwise add a key per retry
        # forever. Once a minute, drop buckets that are empty or older than an
        # hour — cheap, and bounded by the number of live clients.
        if now - self._last_sweep < 60:
            return
        self._last_sweep = now
        stale = [key for key, hits in self._hits.items()
                 if not hits or now - hits[-1] > 3600]
        for key in stale:
            self._hits.pop(key, None)


# (path prefix, methods, requests, window seconds)
RULES: tuple[tuple[str, tuple[str, ...], int, float], ...] = (
    ("/api/auth/login", ("POST",), 10, 300),
    ("/api/auth/signup", ("POST",), 5, 900),
    ("/api/account", ("DELETE",), 5, 900),
    ("/api/ai/key/test", ("POST",), 10, 600),
    ("/api/documents/ocr", ("POST",), 12, 300),
    ("/api/advisor", ("POST",), 20, 60),
    ("/api/reports/test", ("POST",), 5, 600),
    ("/api/market/refresh", ("POST",), 2, 600),
)
DEFAULT_BUDGET = (240, 60.0)

limiter = RateLimiter()


def budget_for(path: str, method: str) -> tuple[int, float]:
    """The (requests, window) a path is allowed. Longest prefix wins."""
    method = method.upper()
    best: tuple[int, float] | None = None
    best_len = -1
    for prefix, methods, limit, window in RULES:
        if path.startswith(prefix) and method in methods and len(prefix) > best_len:
            best, best_len = (limit, window), len(prefix)
    return best or DEFAULT_BUDGET


def rule_scope(path: str, method: str) -> str:
    """The rule a path falls under — used as the bucket name.

    Bucketing by the literal path would let a client reset its budget by varying
    the variable part (`/api/documents/<any-uuid>/confirm`). The scope is the
    matched prefix, so every id shares one budget.
    """
    method = method.upper()
    best, best_len = "/api", -1
    for prefix, methods, _limit, _window in RULES:
        if path.startswith(prefix) and method in methods and len(prefix) > best_len:
            best, best_len = prefix, len(prefix)
    return best


def token_fingerprint(authorization: str | None) -> str:
    """A short, non-reversible id for a bearer token.

    Rate limits are per credential, not only per IP: a shared office NAT should
    not spend one user's OCR budget, and one noisy account should not be able to
    hide behind a shared address.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return "-"
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return "-"
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]


def client_key(host: str | None, authorization: str | None) -> str:
    return f"{host or 'unknown'}|{token_fingerprint(authorization)}"


# --- response headers --------------------------------------------------------

# Paths whose body changes slowly and may therefore be cached by the browser or
# a CDN. Anything user-specific is deliberately absent: a cached ledger would be
# a data leak on a shared device.
CACHEABLE_GETS: tuple[tuple[str, int], ...] = (
    ("/api/categories", 3600),
    ("/api/ai/config", 300),
    ("/api/legal", 600),
    ("/api/models/info", 600),
    ("/api/market/snapshot", 60),
    ("/api/health", 60),
)


def cache_control_for(path: str, method: str) -> str:
    if method.upper() != "GET":
        return "no-store"
    for prefix, max_age in CACHEABLE_GETS:
        if path == prefix or path.startswith(prefix + "/"):
            return f"public, max-age={max_age}, stale-while-revalidate=30"
    return "no-store"


def security_headers(path: str, method: str) -> dict[str, str]:
    """Headers on every response. JSON APIs get the parts that still apply."""
    return {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
        "Cross-Origin-Resource-Policy": "same-site",
        "Cache-Control": cache_control_for(path, method),
    }


def allowed_origins(configured: str, extra: Iterable[str] = ()) -> list[str]:
    """Parse ALLOWED_ORIGINS. "*" is the permissive fallback for local dev."""
    items = [o.strip() for o in (configured or "").split(",") if o.strip()]
    items.extend(o.strip() for o in extra if o and o.strip())
    return list(dict.fromkeys(items)) or ["*"]
