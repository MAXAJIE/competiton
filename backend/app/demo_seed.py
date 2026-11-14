"""seed_demo — idempotent demo account (PLAN.md Hour 30–40).

Creates/resets one fixed Supabase auth user and inserts:
- 6 months of transactions (mild upward income trend, realistic expense mix)
- 3-4 AR/AP rows overdue (past due_date) so aging + risk warnings show
- risk_settings positioned so the warning banner is visibly ON
- one pre-confirmed OCR document (reviewed=true) as demo backup
- one cached market_snapshot row (no live yfinance/news dependency on stage)

Run:  python -m app.demo_seed
Env:  SUPABASE_URL, SUPABASE_SERVICE_KEY required; email/password configurable.
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta

from . import calc, db, market

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@veritas.hackathon")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo-password-48h")

# Everyday personal/small-business categories (backend/app/categories.py).
CATEGORIES: list[tuple[str, str, float]] = [
    ("Housing", "Northgate Props", 4200),
    ("Family & Childcare", "Little Owls Nursery", 9800),
    ("Groceries", "Tesco Extra", 1400),
    ("Subscriptions", "Netflix", 380),
    ("Utilities", "City Power", 520),
]
CUSTOMERS = ["Harbor Cafe", "Linden Studio", "Mesa Retail", "Oak & Pine Co."]


def build_transactions(user_id: str, today: date | None = None) -> list[dict]:
    today = today or date.today()

    def month_start(offset_back: int) -> date:
        m = today.month - offset_back
        y = today.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        return date(y, m, 1)

    rows: list[dict] = []
    for mi in range(6):  # six full months back, mild upward income trend
        base = month_start(6 - mi)
        for ci, cust in enumerate(CUSTOMERS):
            rows.append({
                "user_id": user_id, "type": "income", "category": "Business Income",
                "vendor_or_customer": cust, "amount": 3600 + mi * 260 + ci * 410,
                "currency": "USD", "transaction_date": (base + timedelta(days=4 + ci * 6)).isoformat(),
                "due_date": None, "status": "paid", "source": "manual", "document_id": None,
            })
        for ei, (cat, vendor, amount) in enumerate(CATEGORIES):
            rows.append({
                "user_id": user_id, "type": "expense", "category": cat,
                "vendor_or_customer": vendor, "amount": amount + mi * (60 if ei == 2 else 0),
                "currency": "USD", "transaction_date": (base + timedelta(days=2 + ei * 5)).isoformat(),
                "due_date": None, "status": "paid", "source": "manual", "document_id": None,
            })

    # Settled AR history per customer, so the §11.2 model's "observed late rate"
    # feature is informative instead of every customer looking identical.
    # A settled row counts as late when it settled after its due date.
    for vendor, amount, late_count in [
        ("Mesa Retail", 1800, 2),
        ("Linden Studio", 1400, 2),
        ("Harbor Cafe", 900, 0),
        ("Oak & Pine Co.", 1600, 1),
    ]:
        for k in range(3):
            due = today - timedelta(days=150 - k * 40)
            settled = due + (timedelta(days=22) if k < late_count else timedelta(days=0))
            rows.append({
                "user_id": user_id, "type": "ar", "category": "Customer Invoice",
                "vendor_or_customer": vendor, "amount": amount,
                "currency": "USD", "transaction_date": settled.isoformat(),
                "due_date": due.isoformat(), "status": "paid",
                "source": "manual", "document_id": None,
            })

    # AR: three overdue, one pending (prediction + risk vault need this history)
    for vendor, amount, due_offset_days, status in [
        ("Mesa Retail", 6400, -60, "overdue"),
        ("Linden Studio", 3200, -45, "overdue"),
        ("Harbor Cafe", 2100, -25, "overdue"),
        ("Oak & Pine Co.", 5200, 14, "pending"),
    ]:
        rows.append({
            "user_id": user_id, "type": "ar", "category": "Customer Invoice",
            "vendor_or_customer": vendor, "amount": amount, "currency": "USD",
            "transaction_date": (today - timedelta(days=75)).isoformat(),
            "due_date": (today + timedelta(days=due_offset_days)).isoformat(),
            "status": status, "source": "manual", "document_id": None,
        })
    # AP: one overdue bill so payables aren't all rosy
    for vendor, amount, due_offset_days, status in [
        ("Paper Mill Ltd", 2800, -15, "overdue"),
        ("Northgate Props", 4200, 16, "pending"),
        ("Cloudware", 1140, 21, "pending"),
    ]:
        rows.append({
            "user_id": user_id, "type": "ap", "category": "Supplier Bill",
            "vendor_or_customer": vendor, "amount": amount, "currency": "USD",
            "transaction_date": (today - timedelta(days=45)).isoformat(),
            "due_date": (today + timedelta(days=due_offset_days)).isoformat(),
            "status": status, "source": "manual", "document_id": None,
        })
    return rows


def run() -> dict:
    from .models import RiskSettings, Transaction
    user_id = db.ensure_demo_user(DEMO_EMAIL, DEMO_PASSWORD)
    db.wipe_user_data(user_id)
    sb = db.client()

    tx_rows = build_transactions(user_id)
    sb.table("transactions").insert(tx_rows).execute()
    tx = [Transaction(**r) for r in tx_rows]

    # Threshold tuned so runway sits JUST UNDER it — banner visibly on.
    runway = calc.get_runway_months(tx) or 0
    threshold = max(1, round(runway + 0.4, 1))
    settings = RiskSettings(low_cash_threshold_months=threshold,
                            warning_email=os.environ.get("DEMO_REPORT_EMAIL", "owner@example.com"),
                            enabled=True, ar_overdue_spike_pct=25)
    db.save_risk_settings(user_id, settings)

    # Pre-confirmed OCR example (backup if live OCR is slow on venue wifi).
    sb.table("documents").insert({
        "user_id": user_id, "doc_type": "invoice", "file_url": None,
        "ocr_raw_json": {"transaction_date": (date.today() - timedelta(days=3)).isoformat(),
                         "vendor_or_customer": "Paper Mill Ltd", "amount": 486.2,
                         "category": "Shopping", "type": "expense", "status": "paid"},
        "reviewed": True,
    }).execute()

    # Cached market snapshot so the advisor's color never depends on live calls.
    try:
        market.refresh()
    except Exception as e:  # pragma: no cover
        print(f"market snapshot refresh failed (inserting placeholder): {e}", file=sys.stderr)
        sb.table("market_snapshot").insert({"indicators_json": [], "headlines_json": []}).execute()

    return {"user_id": user_id, "email": DEMO_EMAIL, "password": DEMO_PASSWORD,
            "transactions": len(tx_rows), "runway_months": round(runway, 2),
            "low_cash_threshold_months": threshold}


if __name__ == "__main__":
    print(run())
