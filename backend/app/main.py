"""FastAPI backend for the Cash-Flow Monitoring app.

Frontend contract (matches every stub in src/lib/api.ts):
  POST /api/auth/login               ← signIn(email, password)
  POST /api/auth/signup              ← createAccount(...) — legal gate enforced here
  GET  /api/transactions             ← ledger load (real users; guest mode never calls)
  POST /api/transactions             ← saveTransaction(t)
  POST /api/documents/ocr            ← runOcr(file) → draft (reviewed=false, never saved)
  POST /api/documents/{id}/confirm   ← confirm form → reviewed=true + transaction
  POST /api/advisor                  ← askAdvisor(q, tx) → AdvisorReply
  POST /api/reports/test             ← sendTestReport(email)
  GET/PUT /api/settings              ← risk vault
  GET  /api/account/consent          ← which terms this account accepted
  POST /api/account/consent          ← record acceptance (OAuth sign-ins land here)
  DELETE /api/account/data           ← erase rows/uploads, keep the account
  DELETE /api/account                ← erase everything, including the account
  GET  /api/legal                    ← versions + retention numbers the UI quotes
  GET  /api/market/snapshot          ← cached qualitative context
  POST /api/market/refresh           ← on-demand snapshot job run

Guest rule (SKILL.md §8): unauthenticated requests can only use the advisor
and read the cached market snapshot — there is no write path without a valid
Supabase token, structurally, not just a hidden button.

Every response passes through one middleware that (a) applies a per-route rate
budget, (b) stamps security headers, and (c) caches the few GETs that are the
same for everyone. Every error that could echo a provider message is redacted
first, so a pasted OpenRouter key can never come back out of this API.
"""
from __future__ import annotations

import hashlib
import math
import re

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import advisor, calc, cache, categories, config, db, market, ml, ocr, reports, security
from .models import (
    AdvisorQuestion, ClassifyBody, ConfirmFields, ConsentBody, EmailBody, KeyBody,
    LoginBody, RiskSettings, SignupBody, Transaction, TxBody, transaction_from_row,
)

app = FastAPI(title="CashMonitoring backend", version="0.2.0", docs_url="/docs")

# The account-lifecycle routes a frontend may rely on. Advertised by /api/health
# so an old deployment is visible instead of silently 404ing a delete request.
ACCOUNT_FEATURES = {"signup", "legal", "consent", "delete-data", "delete-account", "retention"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-OpenRouter-Key"],
    max_age=600,
)

# Upload signatures: a declared content-type is a claim, these are the proof.
_UPLOAD_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"%PDF-", "application/pdf"),
    (b"RIFF", "image/webp"),        # checked further for the WEBP tag below
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
)


def _client_ip(request: Request) -> str:
    if config.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def guards(request: Request, call_next):
    """Rate limit → handler → security headers.

    Only /api is limited: a static asset request should never spend a budget.
    The limiter is keyed by IP *and* token fingerprint, so a shared office
    address does not merge several users into one bucket.
    """
    path = request.url.path
    method = request.method
    headers = security.security_headers(path, method)

    if config.RATE_LIMIT_ENABLED and method != "OPTIONS" and path.startswith("/api/"):
        limit, window = security.budget_for(path, method)
        key = security.client_key(_client_ip(request), request.headers.get("authorization"))
        scope = security.rule_scope(path, method)
        allowed, retry_after = security.limiter.allow(f"{method}:{scope}:{key}", limit, window)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please wait a moment and try again."},
                headers={**headers, "Retry-After": str(max(1, math.ceil(retry_after)))},
            )

    response = await call_next(request)
    for name, value in headers.items():
        response.headers.setdefault(name, value)
    return response


def current_user_id(authorization: str | None = Header(None)) -> str | None:
    """Bearer token → Supabase user id, or None for guest access."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return db.user_id_from_token(authorization.split(" ", 1)[1].strip())


def require_user(user_id: str | None) -> str:
    if not user_id:
        raise HTTPException(401, "Authentication required (guest mode stores data only in the browser)")
    return user_id


def get_tx(user_id: str) -> list[Transaction]:
    return [transaction_from_row(row) for row in db.list_transactions(user_id)]


def _ip_hash(request: Request) -> str:
    """A stable, non-reversible marker of where a signup came from.

    Stored with the consent record so an abuse report can be checked against
    "which addresses accepted these terms", without keeping the address itself.
    """
    salt = config.SUPABASE_URL or "cashmonitoring"
    return hashlib.sha256(f"{salt}:{_client_ip(request)}".encode()).hexdigest()[:16]


# --- categories (single source of truth for the UI) --------------------------

@app.get("/api/categories")
def get_categories() -> dict:
    """The full category schema, grouped by transaction type.

    Static for the lifetime of a deploy, so it is cached and marked public: the
    browser can keep it, and no request per page load reaches Postgres.
    """
    return cache.cached("categories", 3600, categories.taxonomy)


@app.post("/api/categories/classify")
def classify_category(body: ClassifyBody) -> dict:
    """Best-fit category for a vendor/description — used by the entry form to
    auto-suggest, and by OCR to repair out-of-schema answers."""
    label, confidence, hits = categories.classify(
        body.vendor, body.text, body.type if body.type in categories.BY_TYPE else "expense",
        body.amount)
    return {"category": label, "confidence": confidence, "matched": hits}


@app.get("/api/health")
def health() -> dict:
    """Liveness plus the build's identity.

    `version` and `features` exist so a frontend can tell a *stale deployment*
    apart from an empty account: a Settings page asking a v0.1.0 backend to
    delete data used to get a bare 404, which reads as "nothing happened".
    """
    return {"ok": True, "version": app.version, "features": sorted(ACCOUNT_FEATURES)}


@app.get("/")
def root() -> dict:
    """Hitting the bare domain should explain what this is, not 404.

    A deployed backend URL gets pasted into build settings and checked by hand,
    so it answers like a service, not a broken site.
    """
    return {
        "service": "CashMonitoring backend",
        "health": "/api/health",
        "docs": "/docs",
        "note": "This is the API. The app itself is the deployed frontend, "
                "which must point VITE_API_URL at this origin.",
        "purpose": "Research and educational project. Not financial advice.",
    }


@app.get("/api/legal")
def legal() -> dict:
    """The versions and retention numbers the UI and the policy text quote.

    The signup endpoint compares the accepted versions against these, so a tab
    left open across a policy change cannot accept text it never showed.
    """
    return {
        "terms_version": config.TERMS_VERSION,
        "privacy_version": config.PRIVACY_VERSION,
        "min_age": config.MIN_AGE,
        "retention": {
            "transactions_days": config.RETENTION_DAYS_TRANSACTIONS,
            "documents_days": config.RETENTION_DAYS_DOCUMENTS,
            "max_transactions": config.RETENTION_MAX_TRANSACTIONS,
            "max_documents": config.RETENTION_MAX_DOCUMENTS,
        },
        "purpose": "research_and_education_only",
    }


# --- auth (C1) ---------------------------------------------------------------

@app.post("/api/auth/login")
def login(body: LoginBody) -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")
    try:
        return db.sign_in(body.email, body.password)
    except Exception:
        raise HTTPException(401, "Invalid email or password")


@app.post("/api/auth/signup")
def signup(body: SignupBody, request: Request) -> dict:
    """Create an account — only with the legal gate satisfied.

    Three checks before Supabase is touched: the two acceptances, the age
    affirmation, and the document versions. The frontend disables its button
    until both boxes are ticked; this is the enforcement that does not depend on
    the frontend behaving.
    """
    if not body.terms_accepted:
        raise HTTPException(400, "You must accept the Terms and Privacy Policy to create an account.")
    if not body.age_confirmed:
        raise HTTPException(
            400, f"You must confirm that you are {config.MIN_AGE} or older to create an account.")
    if (body.terms_version != config.TERMS_VERSION
            or body.privacy_version != config.PRIVACY_VERSION):
        raise HTTPException(
            409, "The Terms or Privacy Policy changed — reload the page and accept the current versions.")
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")

    try:
        created = db.sign_up(body.email, body.password)
    except Exception:
        # Supabase's own message can distinguish "already registered" from other
        # failures, which is an account-enumeration oracle. One message for both.
        raise HTTPException(400, "That email cannot be used to create an account right now. "
                                 "Try signing in instead, or use a different address.")

    if not created.get("needs_confirmation"):
        try:
            db.save_consent(created["user_id"], body.terms_version, body.privacy_version,
                            ip_hash=_ip_hash(request))
        except Exception as e:
            # Never pretend consent was stored: an account without a record of
            # what it accepted is exactly what this gate exists to prevent.
            security.redact(e)
            raise HTTPException(503, "Account created, but the consent record could not be saved. "
                                     "Contact the operator before continuing.")
    return {
        "ok": True,
        "email": created.get("email"),
        "needs_confirmation": bool(created.get("needs_confirmation")),
        "access_token": created.get("access_token"),
        "refresh_token": created.get("refresh_token"),
    }


# --- account lifecycle (consent, export of nothing, deletion, retention) ------

@app.get("/api/account/consent")
def get_consent(user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    return {"consent": db.get_consent(uid),
            "terms_version": config.TERMS_VERSION,
            "privacy_version": config.PRIVACY_VERSION,
            "min_age": config.MIN_AGE}


@app.post("/api/account/consent")
def post_consent(body: ConsentBody, request: Request,
                 user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    if not body.terms_accepted or not body.age_confirmed:
        raise HTTPException(400, "Both the age affirmation and the Terms/Privacy acceptance are required.")
    if (body.terms_version != config.TERMS_VERSION
            or body.privacy_version != config.PRIVACY_VERSION):
        raise HTTPException(
            409, "The Terms or Privacy Policy changed — reload the page and accept the current versions.")
    record = db.save_consent(uid, body.terms_version, body.privacy_version,
                             ip_hash=_ip_hash(request))
    return {"ok": True, "consent": {k: record.get(k) for k in
                                    ("terms_version", "privacy_version", "age_confirmed", "accepted_at")}}


@app.delete("/api/account/data")
def delete_my_data(user_id: str | None = Depends(current_user_id)) -> dict:
    """Erase this account's rows and uploaded images; the account stays."""
    uid = require_user(user_id)
    counts = db.purge_user_content(uid)
    return {"ok": True, "deleted": counts}


@app.delete("/api/account")
def delete_my_account(user_id: str | None = Depends(current_user_id)) -> dict:
    """Erase everything, including the Supabase auth user.

    Destructive and irreversible by design. The UI asks the user to type
    DELETE; this endpoint re-checks nothing about intent beyond a valid token,
    because a valid token *is* the authority to delete one's own account.
    """
    uid = require_user(user_id)
    counts = db.delete_account(uid)
    return {"ok": True, "deleted": counts}


@app.post("/api/account/retention")
def apply_retention(user_id: str | None = Depends(current_user_id)) -> dict:
    """Run the retention sweep now, for a user who wants to shrink their data."""
    uid = require_user(user_id)
    return {"ok": True, "removed": db.enforce_retention(uid),
            **{k: v for k, v in legal()["retention"].items()}}


# --- transactions (A1) -------------------------------------------------------

@app.get("/api/transactions")
def list_transactions(user_id: str | None = Depends(current_user_id)) -> dict:
    return {"transactions": [t.model_dump(exclude_none=True) for t in get_tx(require_user(user_id))]}


@app.post("/api/transactions")
def save_transaction(t: Transaction, user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    if t.source == "ocr":
        # OCR writes only through the document-confirm gate (SKILL.md §4).
        raise HTTPException(400, "OCR-sourced rows must be saved via /api/documents/{id}/confirm")
    row = db.save_manual_transaction(uid, t)
    # `settled_ar` rides along so the client can show which invoices this
    # payment closed; the transaction fields themselves stay typed.
    return {**transaction_from_row(row).model_dump(exclude_none=True),
            "settled_ar": row.get("settled_ar", [])}


# --- OCR pipeline (A2) -------------------------------------------------------

def _validate_upload(name: str, content_type: str, data: bytes) -> tuple[str, str]:
    """Reject an upload before a byte of it reaches a paid vision model.

    Size, declared type and actual signature are checked: a .exe renamed to
    .png, a 200 MB "receipt", or a content-type outside the allowlist all stop
    here with a message the user can act on.
    """
    if not data:
        raise ValueError(f"{name}: the file is empty")
    if len(data) > config.MAX_UPLOAD_BYTES:
        mb = config.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"{name}: larger than the {mb} MB limit")
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared and declared not in config.ALLOWED_UPLOAD_TYPES:
        raise ValueError(f"{name}: {declared} is not an accepted file type "
                         f"(use an image or a PDF)")
    sniffed = ""
    for magic, kind in _UPLOAD_MAGIC:
        if data.startswith(magic):
            sniffed = kind
            break
    if sniffed == "image/webp" and data[8:12] != b"WEBP":
        sniffed = ""
    if not sniffed and data[4:8] == b"ftyp":
        sniffed = "image/heic"
    if sniffed and declared in ("image/jpg",):
        declared = "image/jpeg"
    if not sniffed:
        raise ValueError(f"{name}: not a readable image or PDF")
    # A declared/stated mismatch is a red flag, not a preference.
    if declared and sniffed.split("/")[0] != declared.split("/")[0]:
        raise ValueError(f"{name}: the file content does not match its type")
    return security.clean_text(name, max_len=120, strip_markup=False), sniffed


@app.post("/api/documents/ocr")
async def run_ocr_upload(user_id: str | None = Depends(current_user_id),
                         files: list[UploadFile] | None = File(None),
                         file: UploadFile | None = File(None),
                         doc_type: str = Form(""),
                         api_key: str | None = Header(None, alias="X-OpenRouter-Key")) -> dict:
    """Extract one independent entry per image. `file` kept for single-file clients."""
    uid = require_user(user_id)
    uploads = [f for f in (files or []) if f is not None]
    if file is not None:
        uploads.insert(0, file)
    if not uploads:
        raise HTTPException(400, "No file supplied")
    if len(uploads) > config.MAX_UPLOAD_FILES:
        raise HTTPException(400, f"Too many pages: {config.MAX_UPLOAD_FILES} at a time is the maximum")
    if doc_type and doc_type not in ("receipt", "invoice", "bank_statement"):
        raise HTTPException(400, "Unknown document type")
    if api_key and not security.looks_like_openrouter_key(api_key):
        raise HTTPException(400, "That does not look like an OpenRouter key (expected sk-or-v1-…)")

    payload: list[tuple[str, str, bytes]] = []
    for f in uploads:
        data = await f.read(config.MAX_UPLOAD_BYTES + 1)
        try:
            name, kind = _validate_upload(f.filename or "upload", f.content_type or "", data)
        except ValueError as e:
            raise HTTPException(400, str(e))
        payload.append((name, kind, data))
    try:
        return ocr.run_ocr(uid, payload, doc_type, api_key)
    except ValueError as e:
        raise HTTPException(400, security.redact(e, 200))
    except RuntimeError as e:
        raise HTTPException(503, security.redact(e, 300))
    except Exception as e:
        raise HTTPException(502, f"OCR extraction failed: {security.redact(e, 200)}")


_UUID_SHAPE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


@app.post("/api/documents/{document_id}/confirm")
def confirm_document(document_id: str, fields: ConfirmFields,
                     user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    # The id goes straight into a Postgres filter; a non-uuid there is a 500 from
    # the driver, not a useful answer. Refuse it here instead.
    if not _UUID_SHAPE.match(document_id):
        raise HTTPException(400, "Unknown document")
    try:
        row = ocr.confirm_and_save(uid, document_id, fields.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(400, security.redact(e, 200))
    return {**transaction_from_row(row).model_dump(exclude_none=True),
            "settled_ar": row.get("settled_ar", [])}


# --- AI access: server key or BYOK (OpenRouter only) -------------------------

def _ai_config() -> dict:
    return {
        "provider": "openrouter",
        "server_key": config.SERVER_KEY_AVAILABLE,
        "byok_supported": True,
        "models": {"ocr": config.OCR_MODELS[0] if config.OCR_MODELS else None,
                   "advisor": config.ADVISOR_MODELS[0] if config.ADVISOR_MODELS else None},
    }


@app.get("/api/ai/config")
def ai_config() -> dict:
    """What the client may choose from. Never returns a key, only whether one exists."""
    return cache.cached("ai_config", 300, _ai_config)


@app.post("/api/ai/key/test")
def ai_key_test(body: KeyBody) -> dict:
    """Validate a candidate OpenRouter key without using it for anything.

    Calls OpenRouter's own /key endpoint, which reports the key's label, usage
    and limits — a wrong key is caught here instead of failing mid-scan. The key
    itself is never echoed back, and provider errors are redacted.
    """
    key = body.api_key
    if not key:
        raise HTTPException(400, "Paste an OpenRouter key first")
    if not security.looks_like_openrouter_key(key):
        raise HTTPException(400, "That does not look like an OpenRouter key (expected sk-or-v1-…)")
    try:
        r = httpx.get(f"{config.OPENROUTER_BASE}/key",
                      headers={"Authorization": f"Bearer {key}"}, timeout=20)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach OpenRouter to check the key: {security.redact(e)}")
    if r.status_code == 401:
        raise HTTPException(400, "OpenRouter rejected that key (401). Check it was copied in full.")
    if r.status_code != 200:
        raise HTTPException(502, f"OpenRouter answered {r.status_code} while checking the key")
    data = r.json().get("data", {})
    return {
        "ok": True,
        "label": security.redact(data.get("label") or "OpenRouter key", 80),
        "limit": data.get("limit"),
        "usage": data.get("usage"),
        "free_tier": data.get("is_free_tier"),
    }


# --- advisor (B2) ------------------------------------------------------------

@app.get("/api/models/info")
def models_info() -> dict:
    """Which artifacts are loaded + the exact held-out metrics from training."""
    return cache.cached("models_info", 600, ml.models_available)


@app.post("/api/forecast")
def forecast(body: TxBody, user_id: str | None = Depends(current_user_id)) -> dict:
    """Next-month revenue from the trained regression (auth: the user's own rows)."""
    tx = list(body.transactions or []) or (get_tx(user_id) if user_id else [])
    return calc.predict_next_month_revenue(tx)


@app.post("/api/ar/risk")
def ar_risk(body: TxBody, user_id: str | None = Depends(current_user_id)) -> dict:
    """AR rows flagged at risk of late payment by the trained classifier."""
    tx = list(body.transactions or []) or (get_tx(user_id) if user_id else [])
    return ml.ar_risk_summary(tx)


@app.post("/api/advisor")
def ask_advisor(q: AdvisorQuestion, user_id: str | None = Depends(current_user_id),
                api_key: str | None = Header(None, alias="X-OpenRouter-Key")) -> dict:
    if api_key and not security.looks_like_openrouter_key(api_key):
        raise HTTPException(400, "That does not look like an OpenRouter key (expected sk-or-v1-…)")
    tx = list(q.transactions or [])
    if not tx and user_id:
        tx = get_tx(user_id)
    # An empty ledger is a valid state for a new account — the advisor answers
    # honestly ("no transactions yet") instead of erroring.
    settings = db.get_risk_settings(user_id) if user_id else None
    return advisor.ask(q.question, tx, settings, api_key).model_dump(exclude_none=False)


# --- settings / risk vault (C3) ----------------------------------------------

@app.get("/api/settings")
def get_settings(user_id: str | None = Depends(current_user_id)) -> dict:
    return db.get_risk_settings(require_user(user_id)).model_dump()


@app.put("/api/settings")
def put_settings(s: RiskSettings, user_id: str | None = Depends(current_user_id)) -> dict:
    return db.save_risk_settings(require_user(user_id), s).model_dump()


@app.post("/api/reports/test")
def send_test_report(body: EmailBody,
                     user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    settings = db.get_risk_settings(uid)
    tx = get_tx(uid)
    text = reports.generate_report(tx, settings)
    try:
        reports.send_report_email(body.email, "CashMonitoring — cash report", text)
    except RuntimeError as e:
        raise HTTPException(503, security.redact(e))
    except Exception as e:
        raise HTTPException(502, f"Email send failed: {security.redact(e)}")
    return {"sentTo": body.email}


# --- market snapshot (B3) ----------------------------------------------------

@app.get("/api/market/snapshot")
def market_snapshot() -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")

    def load() -> dict:
        snap = market.latest()
        if not snap:
            raise HTTPException(404, "No market snapshot yet — run POST /api/market/refresh "
                                     "or the scheduled job")
        return {"fetched_at": snap["fetched_at"],
                "indicators": snap.get("indicators_json") or [],
                "headlines": snap.get("headlines_json") or []}

    try:
        return cache.cached("market_snapshot", 30, load)
    except HTTPException:
        raise  # a missing snapshot is not worth caching


@app.post("/api/market/refresh")
def market_refresh(user_id: str | None = Depends(current_user_id)) -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")
    require_user(user_id)
    result = market.refresh()
    cache.invalidate("market")
    return result
