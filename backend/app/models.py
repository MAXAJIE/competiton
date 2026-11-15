"""Pydantic models mirroring src/lib/types.ts (SKILL.md §9).

These models are the input gate, not a formality. Every request body:
  * rejects unknown keys (`extra="forbid"`), so a client cannot smuggle a
    `user_id` or `reviewed` field into a write;
  * caps lengths and ranges, so no field can park a megabyte or a NaN in
    Postgres;
  * validates dates as real calendar dates in a sane window;
  * cleans text of control characters and whitespace runs (security.clean_text).

Rows coming *out* of the database are mapped through `transaction_from_row`,
which copies only known columns — the same allowlist idea in the other
direction, so `user_id` or a future admin column never rides along in a
response.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .security import clean_text

TxType = Literal["income", "expense", "ar", "ap"]
TxStatus = Literal["paid", "pending", "overdue"]
DocType = Literal["receipt", "invoice", "bank_statement"]

# A deliberately loose, non-RFC email shape: enough to reject "not-an-email"
# without rejecting addresses that are legal but unusual.
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s.]{1,190}(\.[^@\s.]{1,63})+$")

EARLIEST_DATE = date(1900, 1, 1)
LATEST_DATE = date(2100, 12, 31)


def _iso_date(value: object, *, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} is required")
    try:
        parsed = date.fromisoformat(text[:10])
    except ValueError:
        raise ValueError(f"{field} must be a date in YYYY-MM-DD form")
    if not EARLIEST_DATE <= parsed <= LATEST_DATE:
        raise ValueError(f"{field} is out of range")
    return parsed.isoformat()


def _email(value: object) -> str:
    text = clean_text(value, max_len=254).lower()
    if text and not _EMAIL.match(text):
        raise ValueError("must be an email address")
    return text


class Transaction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Never written to the database (db.write_row strips it); accepted so the
    # same model can describe a saved row.
    id: Optional[str] = Field(default=None, max_length=64)
    type: TxType
    category: str = Field(default="", max_length=80)
    vendor_or_customer: str = Field(default="", max_length=200)
    amount: float = Field(gt=0, le=1_000_000_000_000, allow_inf_nan=False)
    currency: Literal["USD"] = "USD"
    transaction_date: str
    due_date: Optional[str] = None
    status: TxStatus = "paid"
    source: Literal["manual", "ocr"] = "manual"
    document_id: Optional[str] = Field(default=None, max_length=64)
    # When the row was recorded (schema default). The UI sorts "recent" by this,
    # not by transaction_date, so a scan of an old invoice still shows as new.
    created_at: Optional[str] = Field(default=None, max_length=40)

    @field_validator("category", "vendor_or_customer")
    @classmethod
    def _clean_text_fields(cls, v: str) -> str:
        return clean_text(v, max_len=200)

    @field_validator("transaction_date")
    @classmethod
    def _valid_transaction_date(cls, v: str) -> str:
        return _iso_date(v, field="transaction_date")

    @field_validator("due_date")
    @classmethod
    def _valid_due_date(cls, v: Optional[str]) -> Optional[str]:
        if v is None or str(v).strip() == "":
            return None
        return _iso_date(v, field="due_date")

    @field_validator("id", "document_id", "created_at")
    @classmethod
    def _clean_identifier(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return clean_text(v, max_len=64, strip_markup=False) or None


class RiskSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    low_cash_threshold_months: float = Field(default=3, ge=0, le=24, allow_inf_nan=False)
    warning_email: str = Field(default="", max_length=254)
    enabled: bool = True
    ar_overdue_spike_pct: float = Field(default=25, ge=0, le=100, allow_inf_nan=False)

    @field_validator("warning_email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return _email(v)


class OcrDraft(BaseModel):
    doc_type: DocType
    fields: dict = Field(default_factory=dict)


class AdvisorQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    transactions: Optional[list[Transaction]] = Field(default=None, max_length=3000)

    @field_validator("question")
    @classmethod
    def _clean_question(cls, v: str) -> str:
        cleaned = clean_text(v, max_len=2000, allow_newlines=True)
        if not cleaned:
            raise ValueError("question must contain some text")
        return cleaned


class Figure(BaseModel):
    label: str
    value: str


class Source(BaseModel):
    """A web citation, so an external figure can be traced to where it came from."""
    title: str
    url: str


class AdvisorReply(BaseModel):
    text: str
    tool: Optional[str] = None
    figures: Optional[list[Figure]] = None
    sources: Optional[list[Source]] = None


# --- other request bodies ----------------------------------------------------

class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return _email(v)


class SignupBody(BaseModel):
    """Registration is gated on the legal acceptances, server-side as well.

    The frontend disables the button until both boxes are ticked, but a request
    can be hand-rolled — so the two booleans are required here, the age must be
    affirmed, and the accepted document versions must be the current ones.
    """
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    age_confirmed: bool
    terms_accepted: bool
    terms_version: str = Field(min_length=1, max_length=20)
    privacy_version: str = Field(min_length=1, max_length=20)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return _email(v)

    @field_validator("password")
    @classmethod
    def _password_shape(cls, v: str) -> str:
        if v.strip() != v:
            raise ValueError("password must not start or end with a space")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("password must contain at least one letter and one digit")
        return v


class ConsentBody(BaseModel):
    """Acceptance for a sign-in that did not come through the signup form.

    OAuth users are created by Supabase, not by us, so their acceptance is
    collected on the first screen after the redirect — and enforced here.
    """
    model_config = ConfigDict(extra="forbid")

    age_confirmed: bool
    terms_accepted: bool
    terms_version: str = Field(min_length=1, max_length=20)
    privacy_version: str = Field(min_length=1, max_length=20)


class EmailBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return _email(v)


class KeyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(default="", max_length=200)

    @field_validator("api_key")
    @classmethod
    def _clean_key(cls, v: str) -> str:
        # Shape is checked in the endpoint so the client gets a readable 400
        # rather than pydantic's nested 422 envelope.
        return clean_text(v, max_len=200, strip_markup=False)


class ClassifyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor: str = Field(default="", max_length=200)
    text: str = Field(default="", max_length=500)
    type: TxType = "expense"
    amount: Optional[float] = Field(default=None, ge=0, le=1_000_000_000_000,
                                    allow_inf_nan=False)

    @field_validator("vendor", "text")
    @classmethod
    def _clean(cls, v: str) -> str:
        return clean_text(v, max_len=500)


class ConfirmFields(BaseModel):
    """The human-review payload for an OCR draft.

    Was an untyped dict, which let any JSON reach the database layer. Only the
    fields the review screen can edit are accepted; the rest of the draft is
    ignored (the model echoes extra hints like `notes` and `model`).
    """
    model_config = ConfigDict(extra="ignore")

    type: Optional[TxType] = None
    category: Optional[str] = Field(default=None, max_length=80)
    vendor_or_customer: Optional[str] = Field(default=None, max_length=200)
    amount: Optional[float] = Field(default=None, gt=0, le=1_000_000_000_000,
                                    allow_inf_nan=False)
    transaction_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[TxStatus] = None

    @field_validator("category", "vendor_or_customer")
    @classmethod
    def _clean(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else clean_text(v, max_len=200)

    @field_validator("transaction_date")
    @classmethod
    def _date(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _iso_date(v, field="transaction_date")

    @field_validator("due_date")
    @classmethod
    def _due(cls, v: Optional[str]) -> Optional[str]:
        if v is None or str(v).strip() == "":
            return None
        return _iso_date(v, field="due_date")


class TxBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transactions: Optional[list[Transaction]] = Field(default=None, max_length=3000)


# --- database → model --------------------------------------------------------

TX_DB_FIELDS = (
    "id", "type", "category", "vendor_or_customer", "amount", "currency",
    "transaction_date", "due_date", "status", "source", "document_id",
    "created_at",
)


def transaction_from_row(row: dict) -> Transaction:
    """Map a database row to a model, copying only known columns.

    `user_id` (and anything else the table grows later) is intentionally not in
    the allowlist: a response should describe the transaction, not who owns it.
    """
    return Transaction(**{k: row[k] for k in TX_DB_FIELDS if k in row})
