"""Data-access layer (SKILL.md §9 schema, enforced here — not in the UI).

Key rule enforced at this layer (SKILL.md §4): no OCR row reaches
`transactions` unless its document has reviewed = true, and confirm flips
reviewed and writes the transaction together. Guests never get a write
capable path at all (§8) — auth is checked by the routes before calling in.

Account lifecycle lives here too, because "delete my data" has to mean the
rows *and* the uploaded images: erasure that leaves a receipt PDF in Storage
is not erasure. The same file holds the retention sweep, which is what keeps
this app from hoarding data it no longer needs.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from supabase import Client, create_client

from . import cache, categories, config, settlement
from .models import RiskSettings, Transaction, transaction_from_row

log = logging.getLogger(__name__)
BUCKET = "documents"


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


def _settle_receivables(user_id: str, payment: Transaction) -> list[dict]:
    """Close the open invoices/bills a recorded payment clears (app/settlement.py).

    The schema has no settlement-timestamp column, so this flips status to
    'paid' on the matching rows and leaves their original date intact; the
    income/expense row the user just recorded is the record of when money
    arrived or left.
    """
    rows = [transaction_from_row(r) for r in list_transactions(user_id)]
    to_close = settlement.settleable(rows, payment)
    sb = _user_client(user_id)
    closed: list[dict] = []
    for row in to_close:
        if not row.id:
            continue
        sb.table("transactions").update({"status": "paid"}) \
            .eq("id", row.id).eq("user_id", user_id).execute()
        closed.append({"id": row.id,
                       "vendor_or_customer": row.vendor_or_customer,
                       "amount": float(row.amount)})
    return closed


def _apply_arap_status(row: dict) -> dict:
    """Status is structural, not a choice the user makes.

    * AR/AP cannot be born 'paid': a receivable means money is still owed, and
      paid is only reachable through settlement.settleable() when the customer's
      payment is recorded.
    * Income/expense are things that already happened, so they are always 'paid'.
      Money that has not arrived yet belongs on the AR/AP side of the ledger.

    Both are enforced here so no client (form, OCR confirm, or a hand-rolled
    request) can produce a row whose status contradicts what it represents.
    """
    if row.get("type") in ("ar", "ap"):
        row["status"] = settlement.initial_status(row["type"], row.get("due_date"))
    else:
        row["status"] = "paid"
    return row


# Columns the database owns. `created_at` has a NOT NULL default, and the
# response model carries the field, so a plain model_dump() sends an explicit
# null and the insert dies with 23502. Every write path goes through write_row.
SERVER_OWNED = ("created_at",)


def write_row(t: Transaction) -> dict:
    """Fields a client may write — id and server-owned columns stripped."""
    return t.model_dump(exclude={"id", *SERVER_OWNED})


def save_manual_transaction(user_id: str, t: Transaction) -> dict:
    row = write_row(t)
    row["user_id"] = user_id
    # Every write path lands on the shared taxonomy (categories.py).
    row["category"] = categories.coerce(row.get("category", ""), row["type"],
                                        row.get("vendor_or_customer", ""))
    _apply_arap_status(row)
    saved = _user_client(user_id).table("transactions").insert(row).execute().data[0]
    # A payment from a customer who owes you closes that invoice automatically,
    # instead of leaving a receivable that is already paid.
    settled = _settle_receivables(user_id, transaction_from_row(saved))
    enforce_retention_soon(user_id)
    return {**saved, "settled_ar": settled}


def get_document(user_id: str, document_id: str) -> Optional[dict]:
    r = (_user_client(user_id).table("documents")
         .select("*").eq("id", document_id).eq("user_id", user_id).execute())
    return (r.data or [None])[0]


def insert_document(user_id: str, doc_type: str, file_url: Optional[str],
                    ocr_raw_json: dict) -> dict:
    row = {"user_id": user_id, "doc_type": doc_type, "file_url": file_url,
           "ocr_raw_json": ocr_raw_json, "reviewed": False}
    saved = _user_client(user_id).table("documents").insert(row).execute().data[0]
    enforce_retention_soon(user_id)
    return saved


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
    row = _apply_arap_status({**write_row(t), "user_id": user_id})
    sb = _user_client(user_id)
    tx_row = sb.table("transactions").insert(row).execute().data[0]
    sb.table("documents").update({"reviewed": True}).eq("id", document_id).eq("user_id", user_id).execute()
    # Same settlement rule as manual entry — a scanned "paid" receipt for a
    # customer who owes you closes that receivable too.
    settled = _settle_receivables(user_id, transaction_from_row(tx_row))
    return {**tx_row, "settled_ar": settled}


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


# --- account lifecycle: signup consent, deletion, retention ------------------

def sign_up(email: str, password: str) -> dict:
    """Create an account through Supabase's own signup (anon key, no service role).

    Supabase decides whether a confirmation email is required; when it does,
    there is no session yet and the caller must say "check your email" rather
    than pretending the user is signed in.
    """
    res = client(service=False).auth.sign_up({"email": email, "password": password})
    user = getattr(res, "user", None)
    session = getattr(res, "session", None)
    if not user:
        raise ValueError("Supabase did not create the account")
    return {
        "user_id": user.id,
        "email": user.email,
        "needs_confirmation": session is None,
        "access_token": getattr(session, "access_token", None) if session else None,
        "refresh_token": getattr(session, "refresh_token", None) if session else None,
    }


def save_consent(user_id: str, terms_version: str, privacy_version: str,
                 ip_hash: str = "") -> dict:
    """Record the legal acceptance on the auth user's metadata.

    Stored on the user record itself (admin metadata) rather than in a new table:
    it is private, it is erased when the account is deleted, and it needs no
    schema migration — the Supabase schema is managed elsewhere.
    """
    record = {
        "terms_version": terms_version,
        "privacy_version": privacy_version,
        "age_confirmed": True,
        "accepted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ip_hash": ip_hash,
    }
    client().auth.admin.update_user_by_id(user_id, {"user_metadata": record})
    return record


def get_consent(user_id: str) -> dict | None:
    """The acceptance this account recorded, for the Settings screen."""
    try:
        user = client().auth.admin.get_user_by_id(user_id).user
    except Exception:
        return None
    meta = getattr(user, "user_metadata", None) or {}
    if not meta.get("accepted_at"):
        return None
    return {k: meta.get(k) for k in
            ("terms_version", "privacy_version", "age_confirmed", "accepted_at")}


def _remove_uploads(user_id: str, names: list[str] | None = None) -> int:
    """Delete this user's uploaded images/PDFs from Storage. Best effort.

    Uploads are a cache of what OCR already read, never the source of truth, so
    a Storage hiccup must not abort the row deletion the user asked for.
    """
    sb = client()
    try:
        entries = sb.storage.from_(BUCKET).list(user_id) or []
    except Exception:
        return 0
    paths = [f"{user_id}/{e.get('name')}" for e in entries if e.get("name")]
    if names is not None:
        wanted = set(names)
        paths = [p for p in paths if p.split("/", 1)[-1] in wanted]
    removed = 0
    for chunk_start in range(0, len(paths), 50):
        chunk = paths[chunk_start:chunk_start + 50]
        try:
            sb.storage.from_(BUCKET).remove(chunk)
            removed += len(chunk)
        except Exception:
            continue
    return removed


def purge_user_content(user_id: str) -> dict:
    """Erase everything this user stored, keeping the account itself.

    Order matters for the audit trail in the response: count first, delete
    second, and report exactly what went — "deleted" with no numbers is a claim
    nobody can check.
    """
    sb = client()
    counts = {"transactions": 0, "documents": 0, "risk_settings": 0, "uploads": 0}

    def counted(table: str) -> int:
        r = sb.table(table).select("id", count="exact").eq("user_id", user_id).execute()
        return int(getattr(r, "count", None) or len(r.data or []))

    counts["transactions"] = counted("transactions")
    counts["documents"] = counted("documents")
    counts["risk_settings"] = counted("risk_settings")
    counts["uploads"] = _remove_uploads(user_id)
    for table in ("transactions", "documents", "risk_settings"):
        sb.table(table).delete().eq("user_id", user_id).execute()
    cache.invalidate(f"prune:{user_id}")
    return counts


def delete_account(user_id: str) -> dict:
    """Full erasure: content, uploads, and the auth user (cascades profiles)."""
    counts = purge_user_content(user_id)
    client().auth.admin.delete_user(user_id)
    cache.invalidate(f"prune:{user_id}")
    return {**counts, "account": "deleted"}


def enforce_retention(user_id: str) -> dict:
    """Delete rows older than the retention window and above the row caps.

    Two independent guards, because they catch different hoarding: age (a
    three-year-old ledger is not needed to monitor cash) and volume (a script
    that imports a million rows stops at the cap).
    """
    sb = _user_client(user_id)
    removed = {"transactions": 0, "documents": 0, "uploads": 0}
    today = date.today()

    tx_cutoff = (today - timedelta(days=config.RETENTION_DAYS_TRANSACTIONS)).isoformat()
    r = sb.table("transactions").delete().eq("user_id", user_id) \
        .lt("transaction_date", tx_cutoff).execute()
    removed["transactions"] += len(r.data or [])

    doc_cutoff = (datetime.now(timezone.utc)
                  - timedelta(days=config.RETENTION_DAYS_DOCUMENTS)).isoformat()
    old_docs = sb.table("documents").select("id,file_url").eq("user_id", user_id) \
        .lt("created_at", doc_cutoff).execute().data or []
    if old_docs:
        names = [str(d.get("file_url") or "").rsplit("/", 1)[-1] for d in old_docs]
        removed["uploads"] += _remove_uploads(user_id, [n for n in names if n])
        ids = [d["id"] for d in old_docs]
        for start in range(0, len(ids), 100):
            sb.table("documents").delete().eq("user_id", user_id) \
                .in_("id", ids[start:start + 100]).execute()
        removed["documents"] += len(ids)

    # Volume caps: newest rows are kept, the tail beyond the cap goes.
    removed["transactions"] += _trim_table(
        sb, "transactions", user_id, config.RETENTION_MAX_TRANSACTIONS)
    removed["documents"] += _trim_table(
        sb, "documents", user_id, config.RETENTION_MAX_DOCUMENTS)
    return removed


def _trim_table(sb: Client, table: str, user_id: str, keep: int) -> int:
    """Delete rows beyond `keep`, oldest first. Returns how many went."""
    if keep <= 0:
        return 0
    try:
        rows = (sb.table(table).select("id").eq("user_id", user_id)
                .order("created_at", desc=True).range(keep, keep + 499).execute().data or [])
    except Exception:
        return 0
    ids = [r["id"] for r in rows]
    if not ids:
        return 0
    for start in range(0, len(ids), 100):
        sb.table(table).delete().eq("user_id", user_id).in_("id", ids[start:start + 100]).execute()
    return len(ids)


def enforce_retention_soon(user_id: str, ttl: int = 3600) -> None:
    """Run the sweep at most once an hour per user, and never break a write.

    Retention is housekeeping: if Postgres is briefly unhappy, the row the user
    just saved still has to succeed.
    """
    key = f"prune:{user_id}"
    if cache.get(key) is not None:
        return
    cache.put(key, True, ttl)
    try:
        enforce_retention(user_id)
    except Exception as e:  # pragma: no cover - logged, not fatal
        log.warning("retention sweep failed for a user: %s", type(e).__name__)
