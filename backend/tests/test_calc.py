"""Unit tests for the B1 calc layer against a hand-built fixture with known
expected answers (PLAN.md Track B1)."""
from datetime import date

from app import calc
from app.models import Transaction

TODAY = date(2026, 11, 14)


def tx(type_, amount, d, status="paid", due=None, category="Sales", vendor="V"):
    return Transaction(type=type_, amount=amount, transaction_date=d, status=status,
                       due_date=due, category=category, vendor_or_customer=vendor)


FIXTURE = [
    # three months of income, upward trend
    tx("income", 5000, "2026-08-05"), tx("income", 6000, "2026-09-05"), tx("income", 7000, "2026-10-05"),
    # expenses: 4000/month paid
    tx("expense", 4000, "2026-08-10"), tx("expense", 4000, "2026-09-10"), tx("expense", 4000, "2026-10-10"),
    # pending income must NOT count toward cash balance
    tx("income", 9000, "2026-10-20", status="pending"),
    # AR/AP open rows
    tx("ar", 2500, "2026-09-01", status="overdue", due="2026-10-01", category="Invoice"),
    tx("ar", 1000, "2026-09-01", status="pending", due="2026-11-05", category="Invoice"),
    tx("ap", 800, "2026-10-01", status="overdue", due="2026-10-20", category="Bill"),
]


def test_cash_balance():
    # (5000+6000+7000) − (4000*3) = 6000; pending income excluded, no opening balance assumed
    assert calc.get_cash_balance(FIXTURE) == 6000


def test_runway():
    # burn = 4000 → 1.5 months
    assert round(calc.get_runway_months(FIXTURE), 6) == 1.5


def test_empty_ledger_reports_zero_not_fabricated():
    """A brand-new account must read as empty, not as demo data."""
    assert calc.get_cash_balance([]) == 0
    assert calc.get_runway_months([]) is None  # no burn recorded yet → no runway
    assert calc.get_ar_ap_summary([], today=TODAY)["ar"] == 0
    assert calc.predict_next_month_revenue([])["value"] == 0
    assert calc.generate_financial_statement([], today=TODAY)["net"] == 0


def test_monthly():
    m = calc.get_monthly(FIXTURE)
    assert [x["month"] for x in m] == ["2026-08", "2026-09", "2026-10"]
    # parity with calc.ts: getMonthly counts pending income rows too (16000 = 7000 + 9000)
    assert m[-1] == {"month": "2026-10", "income": 16000, "expense": 4000}


def test_ar_ap_summary():
    a = calc.get_ar_ap_summary(FIXTURE, today=TODAY)
    assert a["ar"] == 3500
    assert a["ap"] == 800
    assert a["arOverdue"] == 2500
    # overdue AR due 2026-10-01 → 44 days → "31-60"; pending due 2026-11-05 → 9 days → "1-30"
    assert a["arAging"] == {"current": 0, "1-30": 1000, "31-60": 2500, "60+": 0}
    # AP due 2026-10-20 → 25 days → "1-30"
    assert a["apAging"] == {"current": 0, "1-30": 800, "31-60": 0, "60+": 0}


def test_prediction_states_method():
    p = calc.predict_next_month_revenue(FIXTURE)
    # SKILL.md §11.1: the trained regression serves the number, and the old rule
    # of thumb is still reported next to it as the baseline to beat.
    assert p["source"] == "model"
    assert p["value"] > 0
    assert "regression" in p["method"].lower()
    # SKILL.md §11.1 baseline: "next month = this month" persistence. October's
    # income is 7000 paid + 9000 pending, and pending income counts here — the same
    # parity rule calc.ts uses for monthly figures (it is excluded only from cash).
    assert p["baseline_value"] == 16000


def test_prediction_falls_back_when_no_income():
    empty = [t for t in FIXTURE if t.type != "income"]
    p = calc.predict_next_month_revenue(empty)
    assert p["value"] == 0
    assert p["source"] == "none"


def test_statement():
    s = calc.generate_financial_statement(FIXTURE, today=TODAY)
    # accrual view: includes pending income (9000), excludes AR/AP lines
    assert s["total_income"] == 27000
    assert s["total_expense"] == 12000
    assert s["net"] == 15000


def test_usd_format_matches_frontend():
    assert calc.usd(12000) == "$12,000"
    assert calc.usd(486.2) == "$486"
