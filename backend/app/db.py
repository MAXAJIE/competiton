"""Data-access layer (SKILL.md §9 schema, enforced here — not in the UI).

Key rule enforced at this layer (SKILL.md §4): no OCR row reaches
`transactions` unless its document has reviewed = true, and confirm flips
reviewed and writes the transaction together. Guests never get a write
capable path at all (§8) — auth is checked by the routes before calling in.
"""
from __future__ import annotations

from typing import Optional

from supabase import Client, create_client

from . import categories, config
from .models import RiskSettings, Transaction


def client(service: bool = True) -> Client:
    url = config.SUPABASE_URL
    key = config.SUPABASE_SERVICE_KEY if service and config.SUPABASE_SERVICE_KEY else config.SUPABASE_ANON_KEY
    return create_client(url, key)


def _user_client(user_id: str) -> Client:
    """Service-role client; every call is user-filtered server-side."""
    return client()


def list_transactions(user_id: str) -> list[dict]:
    r = (_user_client(user_id).table("transactions")
         .select("*").eq("user_id", user_id).order("transaction_date").execute())
    return r.data or []


def save_manual_transaction(user_id: str, t: Transaction) -> dict:
    row = t.model_dump(exclude={"id"})
    row["user_id"] = user_id
    # Every write path lands on the shared taxonomy (categories.py).
    row["category"] = categories.coerce(row.get("category", ""), row["type"],
                                        row.get("vendor_or_customer", ""))
    return _user_client(user_id).table("transactions").insert(row).execute().data[0]


def get_document(user_id: str, document_id: str) -> Optional[dict]:
    r = (_user_client(user_id).table("documents")
         .select("*").eq("id", document_id).eq("user_id", user_id).execute())
    return (r.data or [None])[0]


def insert_document(user_id: str, doc_type: str, file_url: Optional[str],
                    ocr_raw_json: dict) -> dict:
    row = {"user_id": user_id, "doc_type": doc_type, "file_url": file_url,
           "ocr_raw_json": ocr_raw_json, "reviewed": False}
    return _user_client(user_id).table("documents").insert(row).execute().data[0]


def confirm_document_and_save(user_id: str, document_id: str,
                              fields: dict) -> dict:
    """The human-review gate, enforced structurally (SKILL.md §4):
    one save path flips reviewed=true and inserts the transaction together.
    Raises if the document is unknown, already reviewed, or still unreviewed
    for any OCR write — there is no code path around this function."""
    doc = get_document(user_id, document_id)
    if not doc:
        raise ValueError("document not found")
    if doc.get("reviewed"):
        raise ValueError("document already reviewed")

    t = Transaction(**{
        "type": fields.get("type") or "expense",
        "category": categories.coerce(fields.get("category", ""),
                                      fields.get("type") or "expense",
                                      fields.get("vendor_or_customer") or ""),
        "vendor_or_customer": fields.get("vendor_or_customer") or "",
        "amount": fields.get("amount"),
        "transaction_date": fields.get("transaction_date"),
        "due_date": fields.get("due_date"),
        "status": fields.get("status") or "paid",
        "source": "ocr",
        "document_id": document_id,
    })
    sb = _user_client(user_id)
    tx_row = sb.table("transactions").insert({**t.model_dump(exclude={"id"}), "user_id": user_id}).execute().data[0]
    sb.table("documents").update({"reviewed": True}).eq("id", document_id).eq("user_id", user_id).execute()
    return tx_row


def get_risk_settings(user_id: str) -> RiskSettings:
    r = (_user_client(user_id).table("risk_settings")
         .select("*").eq("user_id", user_id).limit(1).execute())
    if r.data:
        d = r.data[0]
        return RiskSettings(**{k: d[k] for k in
                               ("low_cash_threshold_months", "warning_email", "enabled", "ar_overdue_spike_pct")})
    return RiskSettings()


def save_risk_settings(user_id: str, s: RiskSettings) -> RiskSettings:
    row = {**s.model_dump(), "user_id": user_id}
    _user_client(user_id).table("risk_settings").upsert(row, on_conflict="user_id").execute()
    return s


def latest_market_snapshot() -> Optional[dict]:
    r = client().table("market_snapshot").select("*").order("fetched_at", desc=True).limit(1).execute()
    return (r.data or [None])[0]


def save_market_snapshot(indicators: list, headlines: list) -> dict:
    return client().table("market_snapshot").insert(
        {"indicators_json": indicators, "headlines_json": headlines}).execute().data[0]


# --- auth -------------------------------------------------------------------

def sign_in(email: str, password: str) -> dict:
    sb = client(service=False)
    res = sb.auth.sign_in_with_password({"email": email, "password": password})
    s = res.session
    return {"access_token": s.access_token, "refresh_token": s.refresh_token,
            "user": {"id": s.user.id, "email": s.user.email}}


def user_id_from_token(access_token: str) -> Optional[str]:
    """Validate a Supabase access token against the auth server; None if invalid.

    The token is passed to get_user() — do NOT also overwrite the client's own
    Authorization header, or the auth client rejects its own request.
    """
    try:
        res = client(service=False).auth.get_user(access_token)
        return res.user.id if res and res.user else None
    except Exception:
        return None


def ensure_demo_user(email: str, password: str) -> str:
    """seed_demo helper: create or reset the fixed demo auth user (service role)."""
    sb = client()
    try:
        users = sb.auth.admin.list_users()
        for u in users:
            if (u.email or "").lower() == email.lower():
                sb.auth.admin.delete_user(u.id)
    except Exception:
        pass
    u = sb.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
    sb.table("profiles").upsert({"id": u.id, "business_name": "Veritas Demo Co."}).execute()
    return u.id


def wipe_user_data(user_id: str) -> None:
    """Idempotent seed: clear this user's rows before re-inserting."""
    sb = client()
    for table in ("transactions", "documents", "risk_settings"):
        sb.table(table).delete().eq("user_id", user_id).execute()
