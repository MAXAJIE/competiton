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

from . import categories, config, db

# Valid transaction vocabulary (SKILL.md §9).
_TYPES = {"income", "expense", "ar", "ap"}
_STATUSES = {"paid", "pending", "overdue"}
_DOC_TYPES = {"receipt", "invoice", "bank_statement"}

def _prompt(doc_type: str) -> str:
    """Fixed extraction prompt per doc_type, with the live category taxonomy.

    The category list is injected from categories.py so the model picks from the
    same schema the UI and classifier use, and normalize_fields still coerces
    whatever it answers back into that schema.
    """
    if doc_type not in _DOC_TYPES:
        # No type was supplied: the page itself says what it is ("Invoice",
        # "Billed to", an invoice number…), which the filename usually does not.
        every = "\n".join(f"- {k}: {categories.prompt_list(k)}"
                          for k in ("expense", "income", "ar", "ap"))
        return (
            "Read this document image, decide what kind of document it is, then "
            "extract ONE transaction. Return ONE JSON object (never an array) and "
            "nothing else. Keys: is_document, doc_type, transaction_date (YYYY-MM-DD), "
            "vendor_or_customer, amount (a number), category, type, status, "
            'due_date (YYYY-MM-DD or null).\n'
            "is_document: false ONLY when the image is not a receipt, invoice or bank "
            "statement at all (a logo, a product photo, an app screenshot). Then also "
            "set reason to what it looks like. Otherwise true.\n"
            'doc_type: "invoice" when the page is an invoice — it says Invoice, has '
            "an invoice number, 'Billed to', line items with a total, or payment "
            'terms; "receipt" for a till slip or proof of an already-paid purchase; '
            '"bank_statement" when it lists many dated transactions for an account.\n'
            'type: receipt -> "expense" (status "paid"); invoice -> "ar" if the '
            'money is owed TO the business that issued it, "ap" if the reader owes '
            'it (status "pending" unless the page shows it was settled); bank '
            'statement -> "income" for money in, "expense" for money out.\n'
            "amount: the FINAL TOTAL only, never a line item and never a tax "
            "subtotal. vendor_or_customer: copy the other party exactly as printed.\n"
            "due_date: only a date the page actually prints (\"Pay by\", \"Due date\", "
            "\"Payment due\"); otherwise null — never infer net-30 terms.\n"
            "For an invoice, category must be Customer Invoice (type ar) or "
            "Supplier Bill (type ap) — never an expense category, even when the "
            "line items are consumer goods.\n"
            "Choose category from this list ONLY:\n" + every
        )

    kinds = {"receipt": ["expense"],
             "invoice": ["ar", "ap"],
             "bank_statement": ["income", "expense"]}[doc_type]
    cat_lines = "\n".join(f"- {k}: {categories.prompt_list(k)}" for k in kinds)
    common = (
        "Return ONE JSON object (never an array) and nothing else. Keys: "
        "transaction_date (YYYY-MM-DD), vendor_or_customer, amount (a number), "
        "category, type, status."
    )
    if doc_type == "receipt":
        return (
            f"Read this receipt/shop bill image. {common} amount must be the FINAL "
            'TOTAL paid (not a line item). type is always "expense", status is '
            'always "paid".\nChoose category from this list ONLY:\n' + cat_lines
        )
    if doc_type == "invoice":
        return (
            f"Read this invoice image. {common} amount must be the INVOICE TOTAL. "
            'Use type "ar" if this business is owed the money, "ap" if the business '
            'owes it; include due_date (YYYY-MM-DD or null); status "pending" unless '
            'the document shows it was settled.\n'
            "Choose category from this list ONLY:\n" + cat_lines
        )
    return (
        f"Read this bank statement image. {common} Use type \"income\" for money in "
        'and "expense" for money out, status "paid", vendor_or_customer = the '
        "counterparty, amount = a positive number.\n"
        "Choose category from this list ONLY:\n" + cat_lines
    )


_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y",
    "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y", "%d %B, %Y",
    "%Y-%m-%dT%H:%M:%S", "%B %Y", "%b %Y",
)


def valid_doc_type(value: object) -> str | None:
    """Normalise a type the model reported, or None when it is not one of ours."""
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {"receipts": "receipt", "sales_receipt": "receipt", "till_slip": "receipt",
               "invoices": "invoice", "bill": "invoice", "billing": "invoice",
               "bank_statements": "bank_statement", "statement": "bank_statement",
               "bank": "bank_statement"}
    text = aliases.get(text, text)
    return text if text in _DOC_TYPES else None


def filename_guess(filename: str = "") -> str | None:
    """A type implied by the file name, or None when the name says nothing.

    "image.png" and "IMG_4821.jpg" are photo names, not evidence, so they must not
    decide the document type — that is exactly what made an invoice get read as a
    receipt.
    """
    blob = (filename or "").lower()
    if re.search(r"statement|bank", blob):
        return "bank_statement"
    if re.search(r"invoice|billed|billing", blob):
        return "invoice"
    if re.search(r"receipt|rcpt|till", blob):
        return "receipt"
    return None


def resolve_doc_type(hint: str = "", filename: str = "", model_type: object = None) -> str:
    """Final document type. A deliberate choice beats a reading, a reading beats a name.

    1. The type the user picked in the dialog (they are telling us, not guessing).
    2. What the vision model read on the page ("Invoice" in the heading).
    3. A keyword in the file name.
    4. "receipt" as the last resort.
    """
    if hint in _DOC_TYPES:
        return hint
    return valid_doc_type(model_type) or filename_guess(filename) or "receipt"


def detect_doc_type(filename: str = "", hint: str = "") -> str:
    """Back-compat wrapper: filename/hint only, when no page was read."""
    return resolve_doc_type(hint, filename, None)


def _image_data_url(filename: str, content_type: str, data: bytes) -> str:
    mime = (content_type or "").lower()
    if not mime.startswith(("image/", "application/pdf")):
        mime = "application/pdf" if filename.lower().endswith(".pdf") else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.S)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def _json_from_text(text: str) -> object | None:
    """Best-effort JSON recovery from a model reply.

    Returns None when there is no JSON at all - callers turn that into a clear
    error instead of json.loads()'s opaque "Expecting value: line 1 column 1".
    """
    if not text or not text.strip():
        return None
    raw = text.strip()
    candidates: list[str] = []
    fence = _FENCE.search(raw)
    if fence:
        candidates.append(fence.group(1).strip())
    candidates.append(raw)
    span = re.search(r"[\[{].*[\]}]", raw, re.S)
    if span:
        candidates.append(span.group(0))
    for candidate in candidates:
        for attempt in (candidate, _TRAILING_COMMA.sub(r"", candidate)):
            try:
                return json.loads(attempt)
            except Exception:
                continue
    return None


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
    # The keyword classifier arbitrates: when the vendor strongly matches a
    # category, it overrules a vague model answer (and repairs labels that are
    # not in the taxonomy at all).
    resolved, changed, hits = categories.resolve(
        category, tx_type, fields["vendor_or_customer"],
        str(obj.get("description") or ""))
    category_note: int | None = None
    if changed:
        matched = f" (matched: {', '.join(hits[:3])})" if hits else ""
        notes.append(f"Category '{category or 'none'}' set to '{resolved}'{matched}.")
        category_note = len(notes) - 1
    if doc_type == "invoice" and resolved in ("Other Payable", "Other Receivable"):
        # The page IS an invoice, so the generic "Other" bucket is never the most
        # informative answer — "Supplier Bill" / "Customer Invoice" is. One note
        # replaces the earlier one instead of stacking two corrections.
        invoice_default = "Supplier Bill" if tx_type == "ap" else "Customer Invoice"
        combined = f"Category '{category or 'none'}' set to '{invoice_default}' — it is an invoice."
        if category_note is not None:
            notes[category_note] = combined
        else:
            notes.append(combined)
        resolved = invoice_default
    fields["category"] = resolved

    if doc_type == "invoice":
        # Which side the money is on cannot be read off the page reliably (an
        # invoice looks the same to the issuer and the payer), so say so instead
        # of pretending the model's guess is a fact.
        side = "owed to you (AR)" if tx_type == "ar" else "a bill you owe (AP)"
        notes.append(f"Invoice read as {side} — switch the type above if that is backwards.")

    if tx_type in ("ar", "ap"):
        fields["due_date"] = _date(obj.get("due_date")) or fields["transaction_date"]
        if _date(obj.get("due_date")) is None and obj.get("due_date"):
            notes.append("Due date not readable — defaulted to the invoice date.")
    else:
        fields["due_date"] = None

    return fields, notes


def build_payload(model: str, doc_type: str, images: list[tuple[str, str, bytes]],
                  max_tokens: int) -> dict:
    """The request body for one extraction (kept separate so it can be asserted)."""
    content: list[dict] = [{"type": "text", "text": _prompt(doc_type)}]
    for filename, content_type, data in images:
        content.append({"type": "image_url",
                        "image_url": {"url": _image_data_url(filename, content_type, data)}})
    payload: dict = {"model": model, "max_tokens": max_tokens, "temperature": 0,
                     "messages": [{"role": "user", "content": content}]}
    # Reading a receipt is classification plus form filling: hidden reasoning is
    # wasted budget (and the usual cause of an empty reply), so it is switched off.
    if config.OCR_REASONING_PARAM is not None:
        payload["reasoning"] = config.OCR_REASONING_PARAM
    return payload


def _call_model(model: str, doc_type: str, images: list[tuple[str, str, bytes]],
                max_tokens: int) -> object:
    """One extraction request. Returns parsed JSON or raises with a clear reason."""
    r = httpx.post(
        f"{config.OPENROUTER_BASE}/chat/completions",
        headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                 "HTTP-Referer": "https://cashmonitoring.app",
                 "X-Title": "CashMonitoring OCR"},
        json=build_payload(model, doc_type, images, max_tokens),
        timeout=180,
    )
    if r.status_code != 200:
        try:
            detail = r.json().get("error", {}).get("message", "")
        except Exception:
            detail = r.text[:200]
        raise RuntimeError(f"{model} -> HTTP {r.status_code}: {detail[:180]}")

    choice = r.json()["choices"][0]
    msg = choice.get("message") or {}
    text = msg.get("content") or ""
    finish = choice.get("finish_reason")

    parsed = _json_from_text(text)
    if parsed is None and msg.get("reasoning"):
        # Reasoning models sometimes leave `content` empty and put everything in
        # the reasoning trace; salvage any JSON object found there.
        parsed = _json_from_text(msg["reasoning"])
    if parsed is None:
        if finish == "length":
            raise RuntimeError(
                f"{model} -> no answer: used all {max_tokens} tokens without writing JSON. "
                f"This model reasons first and the reasoning can eat the whole budget — set "
                f"OCR_REASONING=off (the default), raise OCR_MAX_TOKENS, or pick a "
                f"non-reasoning vision model.")
        if not text.strip():
            raise RuntimeError(f"{model} -> empty response (finish_reason={finish})")
        raise RuntimeError(f"{model} -> reply contained no JSON object: {text[:120]!r}")
    return parsed


def _extract(doc_type: str, images: list[tuple[str, str, bytes]]) -> tuple[object, str]:
    """Run the model chain over one page set. Returns (parsed, model)."""
    errors: list[str] = []
    for model in config.OCR_MODELS:
        # First try the configured budget; a reasoning model that spent it all on
        # hidden reasoning (finish_reason=length) gets one retry with double room.
        for budget in (config.OCR_MAX_TOKENS, config.OCR_MAX_TOKENS * 2):
            try:
                return _call_model(model, doc_type, images, budget), model
            except Exception as e:  # rate limits, missing vision support, bad JSON
                errors.append(str(e))
                if "hit the" not in str(e):  # only the budget error is worth a retry
                    break
    raise RuntimeError("All OCR models failed: " + " | ".join(errors))


def _unreadable(raw: object, fields: dict) -> str | None:
    """Why this image cannot become an entry, or None when it can.

    Two ways an image is unusable: the model says it is not a document at all
    (a logo, a photo, a screenshot), or it is a document whose amount and vendor
    both failed to read — in which case there is no entry to confirm.
    """
    if isinstance(raw, dict) and raw.get("is_document") is False:
        looks_like = str(raw.get("reason") or "").strip() or "not a receipt, invoice or statement"
        return f"not a document ({looks_like})"
    if float(fields.get("amount") or 0) <= 0 and not fields.get("vendor_or_customer"):
        return "no amount or vendor could be read from this image"
    return None


def run_ocr(user_id: str, files: list[tuple[str, str, bytes]],
            doc_type_hint: str = "") -> dict:
    """Read each uploaded image as its OWN entry.

    Images are independent: two receipts photographed together are two
    transactions, not one document with two pages, so nothing is merged and each
    entry gets its own `documents` row (and therefore its own confirm — the human
    gate in SKILL.md §4 stays per entry).

    Returns {"entries": [...], "saved": 0, "skipped": n}. An image that cannot be
    read comes back with ok=false and a reason, so the UI can say so instead of
    inventing a transaction.
    """
    if not files:
        raise ValueError("No file supplied")
    if not config.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not configured; OCR unavailable")

    hint = doc_type_hint if doc_type_hint in _DOC_TYPES else ""
    entries: list[dict] = []

    for index, (filename, content_type, data) in enumerate(files, start=1):
        item: dict = {"index": index, "name": filename}
        try:
            parsed, used_model = _extract(hint, [(filename, content_type, data)])
        except Exception as e:  # every model refused this image
            entries.append({**item, "ok": False,
                            "reason": "the vision model could not read this image",
                            "detail": str(e)[:200]})
            continue

        model_type = parsed.get("doc_type") if isinstance(parsed, dict) else None
        doc_type = resolve_doc_type(hint, filename, model_type)
        fields, notes = normalize_fields(parsed, doc_type)
        reason = _unreadable(parsed, fields)
        if reason:
            entries.append({**item, "ok": False, "reason": reason,
                            "doc_type": doc_type, "model": used_model})
            continue

        # Keep the image when we can; review never depends on it.
        file_url = None
        try:
            path = f"{user_id}/{_uuid.uuid4()}-{filename}"
            res = db.client().storage.from_("documents").upload(
                path, data, {"content-type": content_type or "application/octet-stream"})
            file_url = f"documents/{path}" if res else None
        except Exception:
            file_url = None

        doc = db.insert_document(user_id, doc_type, file_url,
                                 {"fields": fields, "notes": notes, "model": used_model})
        entries.append({**item, "ok": True, "doc_type": doc_type, "fields": fields,
                        "notes": notes, "model": used_model,
                        "document_id": doc["id"]})

    saved = sum(1 for e in entries if e["ok"])
    return {"entries": entries, "saved": saved, "skipped": len(entries) - saved}


def confirm_and_save(user_id: str, document_id: str, fields: dict) -> dict:
    """The only OCR→transactions path; flips reviewed=true in the same call."""
    return db.confirm_document_and_save(user_id, document_id, fields)
