"""Pinned configuration. Model IDs are pinned here, never chosen per-call (SKILL.md §1)."""
import os

from . import security

try:
    from dotenv import load_dotenv
    # Loads backend/.env if present (uvicorn doesn't do this automatically).
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
except ImportError:
    pass


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


SUPABASE_URL = env("SUPABASE_URL")
# anon key: login proxying; service key: server-side reads/writes filtered by user_id.
SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = env("SUPABASE_SERVICE_KEY")

# One vision-capable model for OCR, one for the advisor — both via OpenRouter.
OPENROUTER_API_KEY = env("OPENROUTER_API_KEY")

# BYOK: users may send their own key per request (X-OpenRouter-Key). It is used
# for that request only and never written anywhere — the schema is
# Lovable-managed, and a customer's key does not belong in our database.
SERVER_KEY_AVAILABLE = bool(OPENROUTER_API_KEY)


def request_key(supplied: str | None) -> str:
    """The key to use for one request: the caller's own, else the server's."""
    supplied = (supplied or "").strip()
    return supplied or OPENROUTER_API_KEY


def _models_list(primary: str, fallbacks: str) -> list[str]:
    """Primary model first, then comma-separated fallbacks (deduped, non-empty)."""
    out: list[str] = []
    for m in [primary, *fallbacks.split(",")]:
        m = (m or "").strip()
        if m and m not in out:
            out.append(m)
    return out


# OCR must be vision-capable. Free/vision-limited models rate-limit or reject
# images (verified: nemotron free = "no endpoints found that support image
# input"), so a chain keeps scanning working when one provider misbehaves.

def _reasoning_param(mode: str) -> dict | None:
    """Map a readable mode onto OpenRouter's `reasoning` request field.

    Measured on nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free with a receipt
    image and the real OCR prompt:

        no parameter      → 796 reasoning tokens, empty content (finish=error)
        effort=low        → 530 reasoning tokens, then the JSON
        effort=minimal    → 3000 reasoning tokens, still no content
        enabled=false     →   0 reasoning tokens, 66 completion tokens, JSON

    So extraction should not be paying for hidden thinking at all; it is a
    classifier plus a form filler. "off" is the default.
    """
    mode = (mode or "").strip().lower()
    if mode in ("off", "none", "false", "0"):
        return {"enabled": False}
    if mode in ("low", "medium", "high"):
        return {"effort": mode}
    return None


OCR_MODEL = env("OCR_MODEL", "openai/gpt-4o-mini")
OCR_FALLBACKS = env("OCR_FALLBACK_MODELS", "google/gemini-2.5-flash,google/gemini-2.5-flash-lite")
OCR_MODELS = _models_list(OCR_MODEL, OCR_FALLBACKS)
OCR_REASONING = env("OCR_REASONING", "off")
OCR_REASONING_PARAM = _reasoning_param(OCR_REASONING)

ADVISOR_MODEL = env("ADVISOR_MODEL", "google/gemini-2.5-flash")
ADVISOR_FALLBACKS = env("ADVISOR_FALLBACK_MODELS", "openai/gpt-4o-mini,google/gemini-2.5-flash-lite")
ADVISOR_MODELS = _models_list(ADVISOR_MODEL, ADVISOR_FALLBACKS)
# The advisor picks a tool and phrase one short answer: low effort is enough, and
# it stops a reasoning model from spending the whole budget before the tool call.
ADVISOR_REASONING = env("ADVISOR_REASONING", "low")
ADVISOR_REASONING_PARAM = _reasoning_param(ADVISOR_REASONING)

# Questions about rates, markets, tax rules or law are answered from live search
# results, not from the model's memory. OpenRouter exposes this as the ":online"
# model suffix (web plugin, billed per result). Verified working with this key on
# gemini-2.5-flash and gpt-4o-mini; ":free" variants cannot be combined with it,
# so the web chain is built from paid models only.
ADVISOR_WEB_MODEL = env("ADVISOR_WEB_MODEL", "google/gemini-2.5-flash")
ADVISOR_WEB_FALLBACKS = env("ADVISOR_WEB_FALLBACK_MODELS", "openai/gpt-4o-mini")
ADVISOR_WEB_MODELS = [m if m.endswith(":online") else f"{m}:online"
                      for m in _models_list(ADVISOR_WEB_MODEL, ADVISOR_WEB_FALLBACKS)
                      if ":free" not in m]

# Completion budgets. With OCR_REASONING=off the extraction reply is tiny —
# measured at 66 tokens for a full receipt row — so 800 is generous, and the
# automatic 2x retry covers an unusually long bank statement. This is deliberately
# NOT the old 3000: a budget that large only hid the fact that reasoning was
# consuming it, and it made every "no answer" failure look like a limit problem.
OCR_MAX_TOKENS = int(env("OCR_MAX_TOKENS", "800"))
ADVISOR_MAX_TOKENS = int(env("ADVISOR_MAX_TOKENS", "2500"))

OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_ANON_KEY)

# Free email API for the risk-vault test report (C3).
RESEND_API_KEY = env("RESEND_API_KEY")
EMAIL_FROM = env("EMAIL_FROM", "CashMonitoring <reports@resend.dev>")

# Fixed small set of RSS sources for cached headlines (SKILL.md §6).
NEWS_FEEDS = [
    "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
]

# --- legal gate --------------------------------------------------------------
# Bump either version when the text changes. The backend rejects a signup that
# accepted an older version, so a stale tab cannot accept terms it never showed.
TERMS_VERSION = env("TERMS_VERSION", "1.0")
PRIVACY_VERSION = env("PRIVACY_VERSION", "1.0")
MIN_AGE = int(env("MIN_AGE", "18") or 18)

# --- retention (the "no hoarding" rule) --------------------------------------
# These are enforced by db.enforce_retention: old rows and images are deleted
# automatically and a per-user cap keeps a runaway import from growing forever.
RETENTION_DAYS_TRANSACTIONS = int(env("RETENTION_DAYS_TRANSACTIONS", "1095") or 1095)
RETENTION_DAYS_DOCUMENTS = int(env("RETENTION_DAYS_DOCUMENTS", "180") or 180)
RETENTION_MAX_TRANSACTIONS = int(env("RETENTION_MAX_TRANSACTIONS", "5000") or 5000)
RETENTION_MAX_DOCUMENTS = int(env("RETENTION_MAX_DOCUMENTS", "500") or 500)

# --- transport / abuse limits ------------------------------------------------
# CORS is an allowlist; "*" stays the fallback so a fresh local clone works.
ALLOWED_ORIGINS = security.allowed_origins(env("ALLOWED_ORIGINS", ""))
# Per-route budgets live in security.RULES; this switch exists so the test suite
# (and a debugging session) can run without tripping them.
RATE_LIMIT_ENABLED = env("RATE_LIMIT_ENABLED", "1") not in ("0", "false", "no")
# Behind Railway/Render the real client IP is in X-Forwarded-For. Only trust it
# when the deploy actually sits behind a proxy — otherwise it is spoofable.
TRUST_PROXY_HEADERS = env("TRUST_PROXY_HEADERS", "1") not in ("0", "false", "no")
# Uploads: bounded before a byte reaches the model.
MAX_UPLOAD_BYTES = int(env("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)) or 8 * 1024 * 1024)
MAX_UPLOAD_FILES = int(env("MAX_UPLOAD_FILES", "5") or 5)
ALLOWED_UPLOAD_TYPES = tuple(x.strip() for x in env(
    "ALLOWED_UPLOAD_TYPES",
    "image/png,image/jpeg,image/jpg,image/webp,image/heic,application/pdf",
).split(",") if x.strip())
