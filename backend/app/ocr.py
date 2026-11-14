"""Compartment A2 — OCR ingestion (SKILL.md §4).

One vision model (with fallbacks) via OpenRouter, one fixed extraction prompt
per doc_type, target shape identical to manual entry (§5). Result lands in
documents.ocr_raw_json with reviewed=false. It NEVER writes to transactions —
only db.confirm_document_and_save can, after human confirmation.

Extracted fields are normalized defensively because models answer in
inconsistent shapes ("12 November 2026", "$410.50", a list of line items);
the human review gate still has the final say before anything is saved.
"""
from __future__ import annotations

import base64
import json
import re
import uuid as _uuid
from datetime import date, datetime
from typing import Optional

import httpx

from . import config, db

# Valid transaction vocabulary (SKILL.md §9).
_TYPES = {"income", "expense", "ar", "ap"}
_STATUSES = {"paid", "pending", "overdue"}
_DOC_TYPES = {"receipt", "invoice", "bank_statement"}

EXTRACTION_PROMPTS: dict[str, str] = {
    "receipt": (
        "Read this receipt image and return ONE JSON object (never an array) with exactly "
        "these keys: transaction_date (YYYY-MM-DD), vendor_or_customer (the shop name), "
        "amount (the FINAL TOTAL paid as a number, not a line item), category (one of: "
        "Rent, Payroll, Supplies, Software, Utilities, Sales, Invoice, Bill, Other), "
        'type (always "expense"), status (always "paid"). Return only the JSON object.'
    ),
    "invoice": (
        "Read this invoice image and return ONE JSON object (never an array) with exactly "
        "these keys: transaction_date (issue date, YYYY-MM-DD), vendor_or_customer, "
        "amount (the FINAL INVOICE TOTAL as a number, not a line item), category "
        '("Invoice" if this business issued it, "Bill" if received), type ("ar" if the '
        'business is owed money, "ap" if it owes), due_date (YYYY-MM-DD or null), status '
        '("pending" unless the document shows it was already settled, then "paid"). '
        "Return only the JSON object."
    ),
    "bank_statement": (
        "Read this bank statement image and return ONE JSON object (never an array) with "
        "exactly these keys: transaction_date (YYYY-MM-DD), vendor_or_customer "
        "(counterparty), amount (the transaction amount as a positive number), category "
        "(one of: Rent, Payroll, Supplies, Software, Utilities, Sales, Invoice, Bill, "
        'Other), type ("income" for money in, "expense" for money out), status (always '
        '"paid"). If several lines are visible, use the first line only. Return only the '
        "JSON object."
    ),
}

_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y",
    "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y", "%d %B, %Y",
    "%Y-%m-%dT%H:%M:%S", "%B %Y", "%b %Y",
)


def detect_doc_type(filename: str = "", hint: str = "") -> str:
    """Three document types only (SKILL.md §4). Extension/filename hint first."""
    blob = f"{hint} {filename}".lower()
    if re.search(r"statement|bank", blob):
        return "bank_statement"
    if re.search(r"invoice|bill|receipt_invoice", blob):
        return "invoice"
    return "receipt"


def _image_data_url(filename: str, content_type: str, data: bytes) -> str:
    mime = (content_type or "").lower()
    if not mime.startswith(("image/", "application/pdf")):
        mime = "application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _parse_json_reply(text: str) -> object:
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    else:
        m = re.search(r"[\[{].*[\]}]", text, re.S)
        if m:
            text = m.group(0)
    return json.loads(text)


def _num(value) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9.,-]", "", value).replace(",", "")
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _date(value) -> Optional[str]:
    """Normalize '12 November 2026', '2026/11/12', ISO timestamps → YYYY-MM-DD."""
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace("Sept", "Sep").replace("  ", " ")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return iso.group(0) if iso else None


def normalize_fields(raw: object, doc_type: str, today: date | None = None) -> tuple[dict, list[str]]:
    """Coerce a model reply into the manual-entry shape (SKILL.md §5).

    Returns (fields, notes). Notes are shown to the human reviewer so nothing
    is silently invented — the review gate stays the source of truth.
    """
    today = today or date.today()
    notes: list[str] = []
    obj = raw

    if isinstance(obj, list):
        # Some models return line items despite instructions. Prefer an object
        # that names a total; otherwise sum the lines and say so.
        total_like = [o for o in obj if isinstance(o, dict) and any(
            "total" in str(k).lower() for k in o.keys())]
        if total_like:
            obj = total_like[0]
        elif len(obj) == 1 and isinstance(obj[0], dict):
            obj = obj[0]
        else:
            amounts = [a for a in (_num(o.get("amount")) for o in obj if isinstance(o, dict)) if a]
            notes.append(f"Model returned {len(obj)} line items; amounts summed — please verify.")
            obj = {**obj[0], "amount": sum(amounts)} if obj and isinstance(obj[0], dict) else {}
    if not isinstance(obj, dict):
        raise ValueError("OCR reply was not a JSON object")

    fields: dict = {}

    fields["transaction_date"] = _date(obj.get("transaction_date") or obj.get("date")) or today.isoformat()
    if _date(obj.get("transaction_date") or obj.get("date")) is None:
        notes.append(f"Date not readable — defaulted to {fields['transaction_date']}.")

    vendor = obj.get("vendor_or_customer") or obj.get("vendor") or obj.get("merchant") or obj.get("customer")
    fields["vendor_or_customer"] = str(vendor).strip() if vendor else ""
    if not fields["vendor_or_customer"]:
        notes.append("Vendor/customer not detected — please fill it in.")

    amount = _num(obj.get("amount") if obj.get("amount") is not None else obj.get("total"))
    if amount is None or amount <= 0:
        notes.append("Amount not detected — please fill it in.")
        fields["amount"] = 0
    else:
        fields["amount"] = round(abs(amount), 2)

    tx_type = str(obj.get("type") or "").strip().lower()
    if tx_type not in _TYPES:
        tx_type = {"receipt": "expense", "invoice": "ap", "bank_statement": "expense"}[doc_type]
        notes.append(f"Type defaulted to '{tx_type}' for a {doc_type.replace('_', ' ')}.")
    fields["type"] = tx_type

    status = str(obj.get("status") or "").strip().lower()
    fields["status"] = status if status in _STATUSES else ("paid" if doc_type != "invoice" else "pending")

    category = str(obj.get("category") or "").strip()
    fields["category"] = category or ("Invoice" if tx_type == "ar" else "Bill" if tx_type == "ap" else "Other")

    if tx_type in ("ar", "ap"):
        fields["due_date"] = _date(obj.get("due_date")) or fields["transaction_date"]
        if _date(obj.get("due_date")) is None and obj.get("due_date"):
            notes.append("Due date not readable — defaulted to the invoice date.")
    else:
        fields["due_date"] = None

    return fields, notes


def _call_model(model: str, doc_type: str, images: list[tuple[str, str, bytes]]) -> object:
    content: list[dict] = [{"type": "text", "text": EXTRACTION_PROMPTS[doc_type]}]
    for filename, content_type, data in images:
        content.append({"type": "image_url",
                        "image_url": {"url": _image_data_url(filename, content_type, data)}})
    r = httpx.post(
        f"{config.OPENROUTER_BASE}/chat/completions",
        headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                 "HTTP-Referer": "https://cashmonitoring.app",
                 "X-Title": "CashMonitoring OCR"},
        json={"model": model, "max_tokens": 700, "temperature": 0,
              "messages": [{"role": "user", "content": content}]},
        timeout=120,
    )
    if r.status_code != 200:
        detail = ""
        try:
            detail = r.json().get("error", {}).get("message", "")
        except Exception:
            detail = r.text[:200]
        raise RuntimeError(f"{model} → HTTP {r.status_code}: {detail[:180]}")
    return _parse_json_reply(r.json()["choices"][0]["message"]["content"])


def run_ocr(user_id: str, files: list[tuple[str, str, bytes]],
            doc_type_hint: str = "") -> dict:
    """Extract fields → documents row (reviewed=false) → draft for the review form.

    Accepts one or more page images (first page drives the doc_type hint).
    """
    if not files:
        raise ValueError("No file supplied")
    if not config.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not configured; OCR unavailable")

    doc_type = detect_doc_type(files[0][0], doc_type_hint)
    if doc_type not in _DOC_TYPES:
        doc_type = "receipt"

    errors: list[str] = []
    parsed = None
    used_model = None
    for model in config.OCR_MODELS:
        try:
            parsed = _call_model(model, doc_type, files)
            used_model = model
            break
        except Exception as e:  # rate limits, missing vision support, bad JSON
            errors.append(str(e))
    if parsed is None:
        raise RuntimeError("All OCR models failed: " + " | ".join(errors))

    fields, notes = normalize_fields(parsed, doc_type)
    if len(files) > 1:
        notes.insert(0, f"{len(files)} pages read together.")

    # Best-effort file retention in Supabase Storage; review does not depend on it.
    file_url = None
    try:
        filename, content_type, data = files[0]
        path = f"{user_id}/{_uuid.uuid4()}-{filename}"
        res = db.client().storage.from_("documents").upload(
            path, data, {"content-type": content_type or "application/octet-stream"})
        file_url = f"documents/{path}" if res else None
    except Exception:
        file_url = None

    doc = db.insert_document(user_id, doc_type, file_url,
                             {"fields": fields, "notes": notes, "model": used_model})

    return {"doc_type": doc_type, "fields": fields, "notes": notes,
            "document_id": doc["id"], "model": used_model}


def confirm_and_save(user_id: str, document_id: str, fields: dict) -> dict:
    """The only OCR→transactions path; flips reviewed=true in the same call."""
    return db.confirm_document_and_save(user_id, document_id, fields)
