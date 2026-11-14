"""Compartment B calc layer (SKILL.md §2).

Pure functions only — no Supabase, no HTTP, no LLM. This is the single source
of truth for every cash-flow number the dashboard and the advisor display.
It deliberately mirrors the frontend's `src/lib/calc.ts` so both sides can
never disagree; keep them in sync if one changes.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, Optional

# Single currency, hardcoded per SKILL.md §9 (multi-currency is out of scope).
CURRENCY = "USD"


def _parse(d: str | date) -> date:
    return d if isinstance(d, date) else datetime.strptime(d, "%Y-%m-%d").date()


def usd(n: float) -> str:
    """Same formatting as calc.ts `usd` (en-US currency, 0 decimals)."""
    return f"${n:,.0f}"


def get_monthly(tx: Iterable) -> list[dict]:
    """Per-month {month, income, expense} for income/expense rows, sorted."""
    out: dict[str, dict] = {}
    for t in tx:
        if t.type not in ("income", "expense"):
            continue
        m = _parse(t.transaction_date).strftime("%Y-%m")
        row = out.setdefault(m, {"month": m, "income": 0.0, "expense": 0.0})
        row[t.type] += float(t.amount)
    return [out[m] for m in sorted(out)]


def get_cash_balance(tx: Iterable) -> float:
    """Cash on hand = paid income − paid expense.

    The schema (SKILL.md §9) has no opening-balance column, so nothing is
    assumed on top of the ledger: an account with no rows reports 0, never a
    fabricated starting figure.
    """
    income = sum(float(t.amount) for t in tx if t.type == "income" and t.status == "paid")
    expense = sum(float(t.amount) for t in tx if t.type == "expense" and t.status == "paid")
    return income - expense


def get_avg_monthly_burn(tx: Iterable) -> float:
    """Trailing 3-month average of expenses."""
    m = get_monthly(tx)[-3:]
    return sum(x["expense"] for x in m) / max(len(m), 1)


def get_runway_months(tx: Iterable) -> Optional[float]:
    """Months of runway at current burn. None when there is no burn yet."""
    burn = get_avg_monthly_burn(tx)
    if burn <= 0:
        return None
    return get_cash_balance(tx) / burn


def _aging(rows: list, today: date) -> dict:
    b = {"current": 0.0, "1-30": 0.0, "31-60": 0.0, "60+": 0.0}
    for t in rows:
        if not t.due_date:
            continue
        days = (today - _parse(t.due_date)).days
        if days <= 0:
            b["current"] += float(t.amount)
        elif days <= 30:
            b["1-30"] += float(t.amount)
        elif days <= 60:
            b["31-60"] += float(t.amount)
        else:
            b["60+"] += float(t.amount)
    return b


def get_ar_ap_summary(tx: Iterable, today: date | None = None) -> dict:
    """Open AR/AP totals, overdue AR, and aging buckets (SKILL.md §9 shape)."""
    today = today or date.today()
    open_ar = [t for t in tx if t.type == "ar" and t.status != "paid"]
    open_ap = [t for t in tx if t.type == "ap" and t.status != "paid"]
    return {
        "ar": sum(float(t.amount) for t in open_ar),
        "ap": sum(float(t.amount) for t in open_ap),
        "arOverdue": sum(float(t.amount) for t in open_ar if t.status == "overdue"),
        "arAging": _aging(open_ar, today),
        "apAging": _aging(open_ap, today),
    }


def predict_next_month_revenue(tx: Iterable) -> dict:
    """Next-month revenue, from the scored model (SKILL.md §11.1).

    Delegates to app/ml.py so the advisor, the dashboard and the notebook all
    report the same number — there is exactly one implementation. When the
    trained artifact is missing, ml falls back to the documented trailing-average
    rule and names it in `method`.
    """
    from . import ml  # local import: ml imports nothing from calc at module load
    result = ml.predict_next_month_revenue(tx)
    return {
        "value": result["value"],
        "method": result["method"],
        "source": result.get("source", "model"),
        "baseline_value": result.get("baseline_value"),
        "target_month": result.get("target_month"),
    }


def get_ar_risk_flags(tx: Iterable, limit: int = 6) -> list[dict]:
    """Open AR rows scored for late-payment risk (SKILL.md §11.2)."""
    from . import ml
    return ml.ar_risk_flags(tx, limit=limit)


def generate_financial_statement(tx: Iterable, today: date | None = None,
                                 months: int = 12) -> dict:
    """Income statement over a date range (default: trailing 12 months)."""
    today = today or date.today()
    start = date(today.year, today.month, 1)
    for _ in range(months - 1):
        start = date(start.year - (start.month == 1), 12 if start.month == 1 else start.month - 1, 1)

    def in_range(t) -> bool:
        d = _parse(t.transaction_date)
        return start <= d <= today and t.type in ("income", "expense")

    rows = [t for t in tx if in_range(t)]
    income = sum(float(t.amount) for t in rows if t.type == "income")
    expense = sum(float(t.amount) for t in rows if t.type == "expense")
    by_category: dict[str, float] = {}
    for t in rows:
        if t.type == "expense":
            by_category[t.category or "Uncategorized"] = by_category.get(t.category or "Uncategorized", 0.0) + float(t.amount)
    return {
        "period_start": start.isoformat(),
        "period_end": today.isoformat(),
        "total_income": income,
        "total_expense": expense,
        "net": income - expense,
        "expenses_by_category": dict(sorted(by_category.items(), key=lambda kv: -kv[1])),
    }
