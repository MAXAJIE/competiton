"""Settling receivables from recorded payments (pure matching rules).

A person does not think in double entry: they record "Mesa Retail paid me 6,400"
as money in, and the invoice they had listed should stop being "awaiting
payment". This module turns that intent into a deterministic rule set, so the
same answer comes out whether the payment arrived by manual entry, by scanned
receipt, or in the guest demo.

Rules (all deliberate, all regression-tested in tests/test_settlement.py):

* Only a paid 'income' row can settle anything. A pending income row is a
  promise, not money received.
* A candidate is an 'ar' row still open ('pending' or 'overdue') whose
  customer name matches after normalisation: case, punctuation, spacing and
  company suffixes are ignored, and a shorter name is accepted as a prefix of a
  longer one once it is distinctive (>= PREFIX_MIN chars).
* Invoices are settled oldest-due first, and only while the payment still covers
  them. A customer who pays 3,200 against a 6,400 invoice settles nothing —
  partial payments are not modelled, because the schema has no settled-amount
  column and pretending otherwise would corrupt the receivables total.
* A payment that covers several invoices closes several. That is what actually
  happened, so it is what the ledger should say.

The schema has no settlement timestamp or settled-by column (it belongs to the
Lovable-managed database), so the income row carries the date of the money and
the receivable simply flips to 'paid'.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

from .models import Transaction

# "Co.", "Ltd", "Inc" and friends carry no identity — dropping them is what lets
# "Oak & Pine Co." match an entry typed as "Oak & Pine".
COMPANY_SUFFIXES = ("co", "company", "corp", "corporation", "inc", "incorporated",
                    "llc", "ltd", "limited", "llp", "plc", "pte", "gmbh", "sa",
                    "bv", "ag", "srl", "pty", "enterprise", "enterprises", "trading")

# Shortest name that may match as a prefix of a longer one ("Oak & Pine" vs
# "Oak & Pine Co."). Below this, "A" would match everything.
PREFIX_MIN = 6

# Money is cents-level, but a hand-typed amount can be a dollar off. Anything
# larger than this is a different invoice, not a rounding slip.
AMOUNT_TOLERANCE = 1.00


def _tokens(name: str) -> list[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in (name or ""))
    return cleaned.split()


def normalise_party(name: str) -> str:
    """Comparable form of a customer name: lowercase words, no suffixes/punctuation."""
    words = _tokens(name)
    while words and words[-1] in COMPANY_SUFFIXES:
        words.pop()
    return " ".join(words)


def same_party(a: str, b: str) -> bool:
    """Do two customer names refer to the same party?"""
    na, nb = normalise_party(a), normalise_party(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    short, long = (na, nb) if len(na) <= len(nb) else (nb, na)
    return len(short) >= PREFIX_MIN and long.startswith(short + " ")


def open_receivables(tx: Iterable[Transaction]) -> list[Transaction]:
    return [t for t in tx if t.type == "ar" and t.status != "paid"]


def settleable(tx: Iterable[Transaction], payment: Transaction) -> list[Transaction]:
    """The receivable rows a single recorded payment should close.

    Empty list when the row is not money received, when no invoice matches, or
    when the payment is too small to cover the oldest matching invoice.
    """
    if payment.type != "income" or payment.status != "paid":
        return []
    try:
        remaining = float(payment.amount)
    except (TypeError, ValueError):
        return []
    if remaining <= 0:
        return []

    candidates = [r for r in open_receivables(tx)
                  if same_party(r.vendor_or_customer, payment.vendor_or_customer)]
    # Oldest due first: the invoice that has been outstanding longest is the one
    # a payment is understood to clear. Rows without a due date sort last.
    candidates.sort(key=lambda r: (r.due_date is None, str(r.due_date or ""),
                                   str(r.transaction_date)))

    settled: list[Transaction] = []
    for row in candidates:
        amount = float(row.amount)
        if amount > remaining + AMOUNT_TOLERANCE:
            continue  # this one is bigger than what is left; try a smaller later one
        settled.append(row)
        remaining -= amount
    return settled


def initial_status(tx_type: str, due_date: str | None,
                   today: date | None = None) -> str:
    """The status an AR/AP row gets when it is recorded: never 'paid'.

    "Receivable" means the money has not arrived yet, so a new AR row is pending,
    or overdue the moment its due date is already behind us. Paid is reachable
    only through settlement.settleable() — a recorded payment — which is the
    single place where a receivable can close.
    """
    if tx_type not in ("ar", "ap"):
        return "paid"
    if not due_date:
        return "pending"
    try:
        due = date.fromisoformat(str(due_date)[:10])
    except ValueError:
        return "pending"
    return "overdue" if due < (today or date.today()) else "pending"
