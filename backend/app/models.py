"""Pydantic models mirroring src/lib/types.ts (SKILL.md §9)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

TxType = Literal["income", "expense", "ar", "ap"]
TxStatus = Literal["paid", "pending", "overdue"]
DocType = Literal["receipt", "invoice", "bank_statement"]


class Transaction(BaseModel):
    id: Optional[str] = None
    type: TxType
    category: str = ""
    vendor_or_customer: str = ""
    amount: float = Field(gt=0)
    currency: Literal["USD"] = "USD"
    transaction_date: str
    due_date: Optional[str] = None
    status: TxStatus = "paid"
    source: Literal["manual", "ocr"] = "manual"
    document_id: Optional[str] = None


class RiskSettings(BaseModel):
    low_cash_threshold_months: float = 3
    warning_email: str = ""
    enabled: bool = True
    ar_overdue_spike_pct: float = 25


class OcrDraft(BaseModel):
    doc_type: DocType
    fields: dict = Field(default_factory=dict)


class AdvisorQuestion(BaseModel):
    question: str
    transactions: Optional[list[Transaction]] = None


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
