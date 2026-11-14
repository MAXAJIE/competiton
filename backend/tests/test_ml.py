"""§11 model tests: stored data, artifacts, inference and the leakage guard."""
from datetime import date, timedelta

import pandas as pd

from app import ml
from app.models import Transaction


def _ar(vendor, amount, due_offset, status, transaction_date=None, category="Customer Invoice"):
    today = date(2026, 11, 20)
    return Transaction(
        type="ar",
        category=category,
        vendor_or_customer=vendor,
        amount=amount,
        transaction_date=(transaction_date or today - timedelta(days=60)).isoformat(),
        due_date=(today + timedelta(days=due_offset)).isoformat(),
        status=status,
    )


def test_training_data_is_stored_as_csv():
    """The trainer must read stored CSVs, so they have to exist on disk."""
    data_dir = ml.MODEL_DIR.parent / "data"
    for name in ("ar_training.csv", "revenue_training.csv", "fusion_training.csv"):
        path = data_dir / name
        assert path.exists(), f"{name} missing — run python -m ml.generate_training_data"
        assert len(pd.read_csv(path)) > 0


def test_ar_training_csv_has_no_leaked_ground_truth():
    """customer_reliability_true is the generative parameter; it must not be stored."""
    ar = pd.read_csv(ml.MODEL_DIR.parent / "data" / "ar_training.csv")
    assert "customer_reliability_true" not in ar.columns
    assert "paid_late" in ar.columns
    # Late rate must sit in the 15–30% band agreed in SKILL.md §11.3.
    assert 0.15 <= ar["paid_late"].mean() <= 0.30


def test_artifacts_load_and_report_metrics():
    assert ml.models_available()["ar_risk"] is True
    assert ml.models_available()["revenue_forecast"] is True
    metrics = ml.model_metrics()
    assert metrics["ar_risk"]["model_metrics"]["f1"] > 0
    assert metrics["revenue"]["improvement_pct"] > 0


def test_revenue_forecast_returns_model_value_and_baseline():
    tx = [
        Transaction(type="income", amount=a, transaction_date=f"2026-{m:02d}-05", status="paid")
        for m, a in [(8, 5000), (9, 6000), (10, 7000), (11, 8000)]
    ]
    out = ml.predict_next_month_revenue(tx)
    assert out["source"] == "model"
    assert out["value"] > 0
    assert out["baseline_value"] is not None
    assert out["target_month"].endswith("-12") or out["target_month"][:4] == "2026"


def test_revenue_forecast_degrades_without_history():
    out = ml.predict_next_month_revenue([])
    assert out["source"] == "none"
    assert out["value"] == 0


def test_ar_risk_excludes_the_row_being_scored_from_its_own_history():
    """A single overdue invoice must not learn from itself."""
    tx = [_ar("Solo Customer", 5000, -30, "overdue")]
    flags = ml.ar_risk_flags(tx, today=date(2026, 11, 20))
    assert len(flags) == 1
    assert flags[0]["customer_prior_count"] == 0
    assert flags[0]["at_risk"] is True  # overdue + no history is a real risk signal


def test_ar_risk_ranks_worst_customer_first_and_flags_overdue():
    today = date(2026, 11, 20)
    tx = [_ar("Bad Pay", 6400, -60, "overdue"), _ar("Good Pay", 900, 20, "pending")]
    # Give "Bad Pay" a late track record and "Good Pay" a clean one.
    for k in range(3):
        due = today - timedelta(days=200 - k * 40)
        tx.append(Transaction(
            type="ar", category="Customer Invoice", vendor_or_customer="Bad Pay", amount=1500,
            transaction_date=(due + timedelta(days=25)).isoformat(),
            due_date=due.isoformat(), status="paid",
        ))
        tx.append(Transaction(
            type="ar", category="Customer Invoice", vendor_or_customer="Good Pay", amount=1500,
            transaction_date=due.isoformat(), due_date=due.isoformat(), status="paid",
        ))

    summary = ml.ar_risk_summary(tx, today=today)
    top = summary["top"]
    assert len(top) == 2
    assert top[0]["vendor_or_customer"] == "Bad Pay"
    assert top[0]["p_late"] > top[1]["p_late"]
    assert top[0]["at_risk"] is True
    assert top[0]["severity"] == "high"
    assert summary["at_risk_amount"] >= top[0]["amount"]
    assert [f["p_late"] for f in top] == sorted((f["p_late"] for f in top), reverse=True)


def test_ar_risk_ignores_paid_and_expense_rows():
    tx = [
        _ar("Closed Co", 3000, -10, "paid"),
        Transaction(type="expense", amount=500, transaction_date="2026-11-01", status="paid"),
        Transaction(type="income", amount=500, transaction_date="2026-11-01", status="paid"),
    ]
    assert ml.ar_risk_flags(tx, today=date(2026, 11, 20)) == []
    summary = ml.ar_risk_summary(tx, today=date(2026, 11, 20))
    assert summary["scored"] == 0
    assert summary["at_risk_amount"] == 0
