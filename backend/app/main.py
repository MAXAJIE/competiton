"""FastAPI backend for the Cash-Flow Monitoring app.

Frontend contract (matches every stub in src/lib/api.ts):
  POST /api/auth/login               ← signIn(email, password)
  GET  /api/transactions             ← ledger load (real users; guest mode never calls)
  POST /api/transactions             ← saveTransaction(t)
  POST /api/documents/ocr            ← runOcr(file) → draft (reviewed=false, never saved)
  POST /api/documents/{id}/confirm   ← confirm form → reviewed=true + transaction
  POST /api/advisor                  ← askAdvisor(q, tx) → AdvisorReply
  POST /api/reports/test             ← sendTestReport(email)
  GET/PUT /api/settings              ← risk vault
  GET  /api/market/snapshot          ← cached qualitative context
  POST /api/market/refresh           ← on-demand snapshot job run

Guest rule (SKILL.md §8): unauthenticated requests can only use the advisor
and read the cached market snapshot — there is no write path without a valid
Supabase token, structurally, not just a hidden button.
"""
from __future__ import annotations

from datetime import date

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from . import advisor, categories, config, db, market, ocr, reports
from .models import AdvisorQuestion, RiskSettings, Transaction

app = FastAPI(title="CashMonitoring backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


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
    return [Transaction(**row) for row in db.list_transactions(user_id)]


# --- categories (single source of truth for the UI) --------------------------

class ClassifyBody(BaseModel):
    vendor: str = ""
    text: str = ""
    type: str = "expense"
    amount: float | None = None


@app.get("/api/categories")
def get_categories() -> dict:
    """The full category schema, grouped by transaction type."""
    return categories.taxonomy()


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
    return {"ok": True}


# --- auth (C1) ---------------------------------------------------------------

class LoginBody(BaseModel):
    email: str
    password: str


class EmailBody(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _looks_like_email(cls, v: str) -> str:
        if "@" not in v or v.count("@") != 1:
            raise ValueError("must be an email address")
        return v.strip()


@app.post("/api/auth/login")
def login(body: LoginBody) -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")
    try:
        return db.sign_in(body.email, body.password)
    except Exception:
        raise HTTPException(401, "Invalid email or password")


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
    return Transaction(**row).model_dump(exclude_none=True)


# --- OCR pipeline (A2) -------------------------------------------------------

@app.post("/api/documents/ocr")
async def run_ocr_upload(user_id: str | None = Depends(current_user_id),
                         files: list[UploadFile] | None = File(None),
                         file: UploadFile | None = File(None),
                         doc_type: str = Form("")) -> dict:
    """Extract fields from 1..N page images. `file` kept for single-file clients."""
    uid = require_user(user_id)
    uploads = [f for f in (files or []) if f is not None]
    if file is not None:
        uploads.insert(0, file)
    if not uploads:
        raise HTTPException(400, "No file supplied")
    payload = []
    for f in uploads[:5]:  # cap pages, like the reference scan dialog
        payload.append((f.filename or "upload", f.content_type or "", await f.read()))
    try:
        return ocr.run_ocr(uid, payload, doc_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(502, f"OCR extraction failed: {e}")


@app.post("/api/documents/{document_id}/confirm")
def confirm_document(document_id: str, fields: dict,
                     user_id: str | None = Depends(current_user_id)) -> dict:
    uid = require_user(user_id)
    try:
        row = ocr.confirm_and_save(uid, document_id, fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return Transaction(**row).model_dump(exclude_none=True)


# --- advisor (B2) ------------------------------------------------------------

@app.post("/api/advisor")
def ask_advisor(q: AdvisorQuestion, user_id: str | None = Depends(current_user_id)) -> dict:
    tx = list(q.transactions or [])
    if not tx and user_id:
        tx = get_tx(user_id)
    # An empty ledger is a valid state for a new account — the advisor answers
    # honestly ("no transactions yet") instead of erroring.
    settings = db.get_risk_settings(user_id) if user_id else None
    return advisor.ask(q.question, tx, settings).model_dump(exclude_none=False)


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
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(502, f"Email send failed: {e}")
    return {"sentTo": email}


# --- market snapshot (B3) ----------------------------------------------------

@app.get("/api/market/snapshot")
def market_snapshot() -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")
    snap = market.latest()
    if not snap:
        raise HTTPException(404, "No market snapshot yet — run POST /api/market/refresh or the scheduled job")
    return {"fetched_at": snap["fetched_at"],
            "indicators": snap.get("indicators_json") or [],
            "headlines": snap.get("headlines_json") or []}


@app.post("/api/market/refresh")
def market_refresh(user_id: str | None = Depends(current_user_id)) -> dict:
    if not config.supabase_configured():
        raise HTTPException(503, "Supabase not configured")
    require_user(user_id)
    return market.refresh()
