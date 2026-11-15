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


# --- "will it be late?" is undefined once it already is ----------------------

def _ar_row(id_, vendor, amount, due, status, category="Customer Invoice"):
    from app.models import Transaction
    return Transaction(id=id_, type="ar", category=category, vendor_or_customer=vendor,
                       amount=amount, transaction_date="2026-10-01", due_date=due,
                       status=status)


def test_an_overdue_invoice_is_100_percent_late_not_a_prediction():
    from datetime import date
    from app import ml

    today = date(2026, 11, 15)
    rows = ml.ar_risk_flags([_ar_row("1", "Estelle Darcy", 957, "2025-10-10", "overdue")], today=today)
    row = rows[0]

    assert row["p_late"] == 1.0, "an invoice 401 days late cannot be '52% likely to be late'"
    assert row["already_late"] is True
    assert row["days_overdue"] == 401
    assert row["severity"] == "high"
    # The model's own number is still recorded, but never as the risk figure.
    assert row["model_p_late"] is None or 0 <= row["model_p_late"] <= 1


def test_a_pending_invoice_keeps_the_model_probability():
    from datetime import date
    from app import ml

    today = date(2026, 11, 15)
    row = ml.ar_risk_flags([_ar_row("2", "Mesa Retail", 20000, "2026-11-28", "pending")], today=today)[0]

    assert row["already_late"] is False
    assert row["days_overdue"] == 0
    assert row["p_late"] < 1.0
    assert row["p_late"] == row["model_p_late"]


def test_a_late_invoice_is_flagged_overdue_even_if_status_is_stale():
    """A row still marked pending but past its due date is late all the same."""
    from datetime import date
    from app import ml

    row = ml.ar_risk_flags([_ar_row("3", "Bluefin Co.", 5000, "2026-11-01", "pending")],
                           today=date(2026, 11, 15))[0]
    assert row["p_late"] == 1.0 and row["already_late"] is True and row["days_overdue"] == 14


def test_overdue_rows_are_chased_before_predicted_ones():
    from datetime import date
    from app import ml

    today = date(2026, 11, 15)
    rows = ml.ar_risk_flags([
        _ar_row("small", "Estelle Darcy", 957, "2025-10-10", "overdue"),     # 401 days late
        _ar_row("big", "LEBRON", 500000, "2026-11-13", "overdue"),           # 2 days late
        _ar_row("maybe", "Mesa Retail", 50000, "2026-11-28", "pending"),     # forecast only
    ], today=today)

    assert [r["id"] for r in rows][:2] == ["big", "small"], "exposure = amount x days overdue"
    assert rows[-1]["id"] == "maybe", "a forecast never outranks money already late"


def test_summary_separates_certain_from_forecast():
    from datetime import date
    from app import ml

    today = date(2026, 11, 15)
    summary = ml.ar_risk_summary([
        _ar_row("a", "LEBRON", 500000, "2026-11-13", "overdue"),
        _ar_row("b", "Estelle Darcy", 957, "2025-10-10", "overdue"),
        _ar_row("c", "Mesa Retail", 50000, "2026-11-28", "pending"),
    ], today=today)

    assert summary["overdue_count"] == 2 and summary["overdue_amount"] == 500957.0
    assert summary["predicted_high_count"] == 1 and summary["predicted_high_amount"] == 50000.0


# --- history features: one implementation, admitted by resolution date ------

from ml import features as ar_features  # noqa: E402


def _hist(rows, moment):
    acc = ar_features.HistoryAccumulator()
    for (key, amount, late, resolved) in rows:
        if resolved < moment:
            acc.add(key, amount, late, resolved)
    return acc


def test_stored_history_only_counts_invoices_resolved_before_issuance():
    """The leak fix, asserted on the shipped CSV.

    For every invoice, the number of prior invoices its features were built from
    must equal the number of that customer's invoices whose due date fell
    strictly before it. An invoice still open when this one was issued tells you
    nothing yet — including it made training more informed than serving.
    """
    ar = pd.read_csv(ml.MODEL_DIR.parent / "data" / "ar_training.csv")
    due = pd.to_datetime(ar["due_date"]).to_numpy()
    txn = pd.to_datetime(ar["transaction_date"]).to_numpy()

    for _, idx in ar.groupby("customer_id").groups.items():
        pos = list(idx)
        resolved_before = (due[pos][None, :] < txn[pos][:, None]).sum(axis=1)
        assert list(resolved_before) == list(ar.loc[pos, "customer_prior_count"])


def test_a_client_with_unresolved_invoices_has_no_history_yet():
    today = date(2026, 11, 20)
    # Two invoices for the same customer, both still open, issued before `today`.
    tx = [
        Transaction(type="ar", category="Customer Invoice", vendor_or_customer="Slow Co",
                    amount=1000, transaction_date="2026-11-01", due_date="2026-12-15",
                    status="pending"),
        Transaction(type="ar", category="Customer Invoice", vendor_or_customer="Slow Co",
                    amount=1200, transaction_date="2026-11-10", due_date="2026-12-20",
                    status="pending"),
    ]
    acc = ml._history_accumulator(tx, exclude=None, scoring_moment=today)
    assert acc.stats("Slow Co") is None, "an invoice that has not resolved is not history"


def test_a_past_due_pending_row_is_late_evidence_but_a_future_one_is_not():
    today = date(2026, 11, 20)
    tx = [
        # overdue by the calendar even though the status was never swept
        Transaction(type="ar", category="Customer Invoice", vendor_or_customer="Lag Co",
                    amount=500, transaction_date="2026-10-01", due_date="2026-10-31",
                    status="pending"),
        # not due yet: no outcome to learn from
        Transaction(type="ar", category="Customer Invoice", vendor_or_customer="Lag Co",
                    amount=500, transaction_date="2026-11-15", due_date="2026-12-30",
                    status="pending"),
    ]
    stats = ml._history_accumulator(tx, exclude=None, scoring_moment=today).stats("Lag Co")
    assert stats.count == 1 and stats.late_count == 1


def test_cold_start_row_gets_declared_prior_and_finite_features():
    today = date(2026, 11, 20)
    acc = _hist([], today)
    fv = ar_features.feature_values(acc.stats("New Co"), acc.pooled_rate(), today)
    assert fv["has_history"] == 0.0
    assert fv["customer_prior_count"] == 0
    assert fv["customer_historical_late_rate"] == ar_features.COLD_START_PRIOR
    assert fv["customer_late_rate_shrunk"] == ar_features.COLD_START_PRIOR
    assert fv["customer_late_amount_share"] == 0.0
    assert fv["days_since_last_late_capped"] == float(ar_features.RECENCY_CAP_DAYS)
    for value in fv.values():
        assert isinstance(value, (int, float)) and value == value  # no NaN


def test_shrunk_rate_moves_toward_the_population_rate_as_history_shrinks():
    today = date(2026, 11, 20)
    pooled = (0.20, 500)
    thin = ar_features.CustomerStats(count=1, late_count=1)
    thick = ar_features.CustomerStats(count=40, late_count=40)
    thin_rate = ar_features.feature_values(thin, pooled, today)["customer_late_rate_shrunk"]
    thick_rate = ar_features.feature_values(thick, pooled, today)["customer_late_rate_shrunk"]
    assert 0.20 < thin_rate < thick_rate < 1.0, "one bad invoice must not read as 'always late'"


def test_recency_sentinel_only_when_there_has_never_been_a_late_payment():
    today = date(2026, 11, 20)
    clean = ar_features.CustomerStats(count=5, late_count=0, total_amount=500.0)
    assert ar_features.feature_values(clean, (0.2, 500), today)["days_since_last_late_capped"] \
        == float(ar_features.RECENCY_CAP_DAYS)
    assert ar_features.feature_values(clean, (0.2, 500), today)["has_prior_late"] == 0.0

    lapsed = ar_features.CustomerStats(count=5, late_count=2, total_amount=500.0,
                                       late_amount=100.0, last_late_on=date(2026, 11, 1))
    fv = ar_features.feature_values(lapsed, (0.2, 500), today)
    assert fv["has_prior_late"] == 1.0 and fv["days_since_last_late_capped"] == 19.0


def test_amount_share_is_zero_not_nan_when_nothing_settled_has_value():
    fv = ar_features.feature_values(
        ar_features.CustomerStats(count=2, late_count=1, total_amount=0.0, late_amount=0.0),
        (0.2, 500), date(2026, 11, 20),
    )
    assert fv["customer_late_amount_share"] == 0.0


def test_pooled_rate_is_row_level_not_the_mean_of_customer_rates():
    acc = ar_features.HistoryAccumulator()
    day = date(2026, 1, 1)
    for _ in range(9):          # customer A: 9 on-time invoices
        acc.add("A", 100.0, False, day)
    acc.add("B", 100.0, True, day)   # customer B: 1 late invoice
    rate, n = acc.pooled_rate()
    assert n == 10 and rate == 0.1, "one invoice must not weigh as much as nine"


# --- artifact guards --------------------------------------------------------

def _scoring_tx():
    return [Transaction(type="ar", category="Customer Invoice", vendor_or_customer="Mesa Retail",
                        amount=2000, transaction_date="2026-11-01", due_date="2026-11-28",
                        status="pending")]


def _with_payload(monkeypatch, payload):
    monkeypatch.setattr(ml, "_ar_model", lambda: ml._Model(payload, ml.MODEL_DIR / "x.joblib"))
    return ml.ar_risk_flags(_scoring_tx(), today=date(2026, 11, 20))[0]


def test_a_v1_artifact_still_scores(monkeypatch):
    import joblib
    payload = joblib.load(ml.MODEL_DIR / "ar_risk.joblib")
    row = _with_payload(monkeypatch, payload)
    assert row["source"] == "model" and row["model_p_late"] is not None


def test_a_v2_artifact_scores_with_the_same_feature_builder(monkeypatch):
    import joblib
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    payload = joblib.load(ml.MODEL_DIR / "ar_risk.joblib")
    columns = list(ar_features.AR_NUMERIC_V2) + [f"cat_{c}" for c in ar_features.AR_CATEGORIES]
    frame = pd.DataFrame(np.zeros((4, len(columns))), columns=columns)
    model = LogisticRegression(max_iter=200).fit(frame, [0, 1, 0, 1])
    payload.update({"model": model, "numeric": list(ar_features.AR_NUMERIC_V2),
                    "feature_version": 2, **ar_features.artifact_constants()})
    row = _with_payload(monkeypatch, payload)
    assert row["source"] == "model", "every v2 column must exist in the serving frame"


def test_an_artifact_trained_with_other_constants_degrades_instead_of_scoring(monkeypatch):
    import joblib
    payload = joblib.load(ml.MODEL_DIR / "ar_risk.joblib")
    payload["shrink_k"] = 99          # someone retrained with different features
    row = _with_payload(monkeypatch, payload)
    assert row["source"] == "fallback_rule"
    assert row["model_p_late"] is not None   # still a number, just not the model's


def test_a_corrupt_artifact_does_not_raise(monkeypatch):
    import joblib
    payload = joblib.load(ml.MODEL_DIR / "ar_risk.joblib")
    payload["numeric"] = ["log_amount", "a_column_that_does_not_exist"]
    row = _with_payload(monkeypatch, payload)
    assert row["source"] == "fallback_rule"
