"""Pinned configuration. Model IDs are pinned here, never chosen per-call (SKILL.md §1)."""
import os

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
OCR_MODEL = env("OCR_MODEL", "openai/gpt-4o-mini")
OCR_FALLBACKS = env("OCR_FALLBACK_MODELS", "google/gemini-2.5-flash,google/gemini-2.5-flash-lite")
OCR_MODELS = _models_list(OCR_MODEL, OCR_FALLBACKS)

ADVISOR_MODEL = env("ADVISOR_MODEL", "google/gemini-2.5-flash")
ADVISOR_FALLBACKS = env("ADVISOR_FALLBACK_MODELS", "openai/gpt-4o-mini,google/gemini-2.5-flash-lite")
ADVISOR_MODELS = _models_list(ADVISOR_MODEL, ADVISOR_FALLBACKS)

# Reasoning models (nemotron-*\-reasoning, o-series…) spend the completion budget
# on hidden reasoning FIRST, so a small max_tokens returns empty `content`
# (finish_reason=length). Verified: 700 tokens → 0 chars of content, 2500 → valid
# JSON. These budgets leave room for reasoning plus the actual answer.
OCR_MAX_TOKENS = int(env("OCR_MAX_TOKENS", "3000"))
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
