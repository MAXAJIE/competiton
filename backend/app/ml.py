"""Live inference for the two scored models (SKILL.md §11).

One implementation only: this module loads the artifacts trained by
`ml/train_models.py` from `backend/models/`, and the advisor's tools, the
dashboard and the notebook all go through it. Nothing here retrains at request
time, and nothing here re-implements the model.

If the artifacts are missing (fresh clone before training), every function
degrades to a documented rule of its own and says so in `method` — it never
silently reports a model number it does not have.
"""
from __future__ import annotations

import json
import math
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

# The AR feature rules live in ml/features.py so training and serving cannot
# drift apart. The artifact records those constants; if the loaded artifact was
# trained with different ones, scoring degrades to the documented rule rather
# than quietly using mismatched numbers.
from ml.features import (AR_CATEGORIES, HistoryAccumulator, artifact_constants,
                         feature_values, outcome_known_on)

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"


class _Model:
    def __init__(self, payload: dict, path: Path):
        self.payload = payload
        self.path = path
        self.model = payload["model"]


@lru_cache(maxsize=1)
def _ar_model() -> Optional[_Model]:
    path = MODEL_DIR / "ar_risk.joblib"
    if not path.exists():
        return None
    import joblib
    return _Model(joblib.load(path), path)


@lru_cache(maxsize=1)
def _revenue_model() -> Optional[_Model]:
    path = MODEL_DIR / "revenue_forecast.joblib"
    if not path.exists():
        return None
    import joblib
    return _Model(joblib.load(path), path)


@lru_cache(maxsize=1)
def model_metrics() -> dict:
    """The exact numbers reported in the write-up (models/metrics.json)."""
    path = MODEL_DIR / "metrics.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def models_available() -> dict:
    return {"ar_risk": _ar_model() is not None,
            "revenue_forecast": _revenue_model() is not None,
            "metrics": model_metrics()}


# --- shared feature helpers -------------------------------------------------

def _monthly_income(tx: Iterable) -> list[tuple[str, float]]:
    """[(YYYY-MM, income)] sorted, income rows only — mirrors calc.get_monthly."""
    buckets: dict[str, float] = {}
    for t in tx:
        if t.type != "income":
            continue
        key = str(t.transaction_date)[:7]
        buckets[key] = buckets.get(key, 0.0) + float(t.amount)
    return sorted(buckets.items())


def _ar_overdue_ratio(tx: Iterable, month: str) -> float:
    """Share of that month's AR amount that is overdue — the fusion feature."""
    total = overdue = 0.0
    for t in tx:
        if t.type != "ar" or str(t.transaction_date)[:7] != month:
            continue
        total += float(t.amount)
        if t.status == "overdue":
            overdue += float(t.amount)
    return overdue / total if total else 0.0


def _next_month(month: str) -> tuple[str, int]:
    y, m = int(month[:4]), int(month[5:7])
    m += 1
    if m > 12:
        y, m = y + 1, 1
    return f"{y:04d}-{m:02d}", m


# --- revenue forecast (§11.1) ----------------------------------------------

def predict_next_month_revenue(tx: Iterable) -> dict:
    """Next month's total income.

    Model: LinearRegression over [prev_month, trailing_3mo_avg,
    ar_overdue_ratio_prev, sin, cos] — persistence plus momentum plus the fused
    receivables state plus seasonal position. Falls back to the 3-month trailing
    average when no trained artifact is present, and says which it used.
    """
    tx = list(tx)
    series = _monthly_income(tx)
    if not series:
        return {"value": 0.0, "method": "No recorded income yet — nothing to forecast from.",
                "source": "none", "baseline_value": 0.0, "previous_month": None}

    prev_month_label, prev_value = series[-1]
    trailing = [v for _, v in series[-3:]]
    trailing_avg = sum(trailing) / len(trailing)
    next_label, next_month_no = _next_month(prev_month_label)
    ar_ratio = _ar_overdue_ratio(tx, prev_month_label)

    baseline_value = prev_value          # persistence: next month = this month
    model = _revenue_model()
    if model is None:
        return {
            "value": round(trailing_avg, 2),
            "method": ("Trailing 3-month average of recorded income — trained model "
                       "artifact not found, run `python -m ml.train_models`."),
            "source": "fallback_trailing_average",
            "baseline_value": round(baseline_value, 2),
            "previous_month": {"month": prev_month_label, "income": round(prev_value, 2)},
            "ar_overdue_ratio_prev": round(ar_ratio, 4),
        }

    features = model.payload["features"]
    row = {
        "prev_month": prev_value,
        "trailing_3mo_avg": trailing_avg,
        "ar_overdue_ratio_prev": ar_ratio,
        "sin": math.sin(2 * math.pi * next_month_no / 12),
        "cos": math.cos(2 * math.pi * next_month_no / 12),
    }
    # pandas frame with the training column names → no sklearn feature-name warning
    import pandas as pd
    frame = pd.DataFrame([[row[f] for f in features]], columns=features)
    pred = float(model.model.predict(frame)[0])
    metrics = (model_metrics().get("revenue") or {})
    return {
        "value": round(max(pred, 0.0), 2),
        "method": ("Trained LinearRegression on prior-month income, 3-month momentum, "
                   "last month's AR-overdue share and month-of-year seasonality "
                   f"(held-out MAE ${(metrics.get('model_metrics') or {}).get('mae', 0):,.0f} "
                   "vs persistence). A projection, not a guarantee."),
        "source": "model",
        "target_month": next_label,
        "baseline_value": round(baseline_value, 2),
        "previous_month": {"month": prev_month_label, "income": round(prev_value, 2)},
        "ar_overdue_ratio_prev": round(ar_ratio, 4),
        "features": {k: round(v, 4) for k, v in row.items()},
    }


# --- AR late-payment risk (§11.2) ------------------------------------------

def _is_late_evidence(t) -> bool:
    """Observed lateness for a customer from a row we are not scoring.

    `overdue` is direct evidence. A settled row counts as late when it settled
    after its due date; otherwise it is on-time evidence.
    """
    if t.status == "overdue":
        return True
    if t.status == "paid" and t.due_date:
        return str(t.transaction_date) > str(t.due_date)
    return False


def _is_same_row(t, exclude) -> bool:
    """Identity first: API rows have no database id yet, so an id-only check
    would silently match nothing and leak the scored row into its own feature."""
    if exclude is None:
        return False
    return t is exclude or (exclude.id is not None and t.id == exclude.id)


def _history_accumulator(tx: list, exclude, scoring_moment: date) -> HistoryAccumulator:
    """Customer history as it stood *before* `scoring_moment`.

    A prior invoice counts only once its outcome was known — `due_date` earlier
    than the scoring moment — which is the same rule the trainer uses. Admitting
    invoices that were still open would tell training the answer before it
    happened, and would make training more informed than serving, which has to
    skip rows that have not resolved.

    A past-due row still marked `pending` counts as late evidence: overdue is a
    fact in this app, not a forecast. A `pending` row that is not yet due has no
    outcome and contributes nothing.
    """
    acc = HistoryAccumulator()
    for t in tx:
        if t.type != "ar" or _is_same_row(t, exclude):
            continue
        resolved_on = outcome_known_on(t.transaction_date, t.due_date)
        if resolved_on is None or resolved_on >= scoring_moment:
            continue
        if t.status == "pending":
            # No status sweep yet, but the due date has passed: overdue is a fact.
            if not _is_past_due(t, scoring_moment):
                continue
            late = True
        else:
            late = _is_late_evidence(t)
        acc.add(t.vendor_or_customer, float(t.amount), late, resolved_on)
    return acc


def _is_past_due(t, today: date) -> bool:
    due = outcome_known_on(t.transaction_date, t.due_date)
    return due is not None and due < today


def _artifact_mismatch(model: "_Model") -> Optional[str]:
    """Why this artifact cannot be trusted, or None when it can."""
    for key, expected in artifact_constants().items():
        if model.payload.get(key) != expected:
            return (f"artifact was trained with {key}={model.payload.get(key)!r}, "
                    f"this build uses {expected!r} — retrain with "
                    "`python -m ml.train_models`")
    return None


def ar_risk_flags(tx: Iterable, today: date | None = None, limit: int = 6) -> list[dict]:
    """AR rows scored for late-payment risk, highest risk first.

    Only open rows are scored (settled ones have nothing left to chase).
    """
    tx = list(tx)
    today = today or date.today()
    model = _ar_model()
    mismatch = _artifact_mismatch(model) if model is not None else None
    if mismatch:
        model = None  # never score with constants that do not match the features
    open_rows = [t for t in tx if t.type == "ar" and t.status in ("pending", "overdue")]
    if not open_rows:
        return []

    out: list[dict] = []
    for t in open_rows:
        acc = _history_accumulator(tx, exclude=t, scoring_moment=today)
        # One shared builder: every history column is produced here, then the
        # artifact decides which of them its model actually consumes. That is
        # why a v1 artifact keeps working without a version branch.
        stats = acc.stats(t.vendor_or_customer)
        fv = feature_values(stats, acc.pooled_rate(), today)
        days_until_due = ((date.fromisoformat(str(t.due_date)) - today).days
                          if t.due_date else 30)
        # The classifier answers "will this be paid late?". Once due_date has
        # passed unpaid, that has already happened: P = 1, not a guess. Feeding
        # days_until_due = -401 to a model trained on -60..+90 produced 52% for
        # an invoice 401 days late, which reads as "probably fine" — wrong and
        # dangerous. The model's own number is kept only as `model_p_late`.
        already_late = t.status == "overdue" or days_until_due < 0
        row = dict(fv)
        row["log_amount"] = math.log(max(float(t.amount), 0.01))
        row["days_until_due"] = float(days_until_due)
        for cat in AR_CATEGORIES:
            row[f"cat_{cat}"] = 1.0 if t.category == cat else 0.0

        model_p_late: float | None = None
        if model is not None:
            try:
                columns = list(model.payload["numeric"]) + \
                    [f"cat_{c}" for c in model.payload["categories"]]
                import pandas as pd
                frame = pd.DataFrame([[row[c] for c in columns]], columns=columns)
                model_p_late = float(model.model.predict_proba(frame)[0][1])
            except Exception:
                # A stale or hand-edited artifact must not 500 a dashboard.
                model_p_late = None

        if model_p_late is not None:
            p_late = 1.0 if already_late else model_p_late
            threshold = float(model.payload.get("threshold", 0.3))
            high_margin = float(model.payload.get("high_risk_margin", 0.12))
            source = "model"
        else:
            # Documented rule of its own when no usable artifact exists — never pretend.
            model_p_late = round(min(0.95, 0.15 + 0.4 * fv["customer_historical_late_rate"]), 4)
            p_late = 1.0 if already_late else model_p_late
            threshold = 0.5
            high_margin = 0.15
            source = "fallback_rule"

        out.append({
            "id": t.id,
            "vendor_or_customer": t.vendor_or_customer,
            "amount": round(float(t.amount), 2),
            "category": t.category,
            "due_date": t.due_date,
            "status": t.status,
            "days_until_due": days_until_due,
            "customer_historical_late_rate": fv["customer_historical_late_rate"],
            "customer_prior_count": fv["customer_prior_count"],
            "p_late": round(p_late, 3),
            "already_late": already_late,
            "days_overdue": max(0, -days_until_due),
            "model_p_late": None if model_p_late is None else round(model_p_late, 3),
            "at_risk": p_late >= threshold,
            "severity": ("high" if already_late or p_late >= threshold + high_margin
                         else "medium" if p_late >= threshold else "low"),
            "threshold": threshold,
            "source": source,
        })

    # "Who to chase first" needs a priority that stays informative once every
    # overdue row is 100%. Overdue rows lead and are ordered by exposure
    # (amount x days overdue); the rest by expected value (p_late x amount).
    def priority(row: dict) -> float:
        if row["already_late"]:
            return float(row["amount"]) * max(row["days_overdue"], 1)
        return float(row["amount"]) * float(row["p_late"])

    out.sort(key=lambda r: priority(r), reverse=True)
    out.sort(key=lambda r: not r["already_late"])  # stable: overdue group first
    for row in out:
        row["priority"] = round(priority(row), 2)
    return out[:limit]


def ar_risk_summary(tx: Iterable, today: date | None = None) -> dict:
    flags = ar_risk_flags(tx, today=today, limit=100)
    risky = [f for f in flags if f["at_risk"]]
    high = [f for f in flags if f.get("severity") == "high"]
    overdue = [f for f in flags if f.get("already_late")]
    predicted = [f for f in flags if not f.get("already_late") and f["at_risk"]]
    return {
        "scored": len(flags),
        "at_risk": len(risky),
        "at_risk_amount": round(sum(f["amount"] for f in risky), 2),
        "high_risk": len(high),
        "high_risk_amount": round(sum(f["amount"] for f in high), 2),
        # Money that is late is a fact; money that might be late is a forecast.
        "overdue_count": len(overdue),
        "overdue_amount": round(sum(f["amount"] for f in overdue), 2),
        "predicted_high_count": len(predicted),
        "predicted_high_amount": round(sum(f["amount"] for f in predicted), 2),
        "open_amount": round(sum(f["amount"] for f in flags), 2),
        "top": flags[:6],
        "method": ("Overdue invoices are 100% late by definition and are ranked by "
                   "exposure (amount x days overdue). Not-yet-due invoices get the "
                   "logistic-regression probability of being paid late — amount, payment "
                   "terms, the customer's resolved late history and category — trained on "
                   "synthetic data and evaluated chronologically (see models/metrics.json). "
                   "Only invoices resolved before the scoring moment count as history."),
        "source": flags[0]["source"] if flags else "none",
    }


SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}


def party_balances(tx: Iterable, side: str = "ar", today: date | None = None,
                   limit: int = 40) -> dict:
    """One row per party: who owes you (`ar`) or who you owe (`ap`).

    "Who owes me money" is a naming question, and a total cannot answer it. This
    groups the open rows by counterparty so the advisor can name each party with
    the money and the risk attached to it.

    Receivables reuse the AR risk model through `ar_risk_flags`, so a party's
    rating is the worst rating among their open invoices. Payables have no model
    (nothing was trained for them), so their risk is the due date as a fact:
    already late, due within a week, or later — labelled `risk_basis: "due_date"`
    rather than dressed up as a prediction.
    """
    tx = list(tx)
    today = today or date.today()
    if side not in ("ar", "ap"):
        raise ValueError("side must be 'ar' or 'ap'")

    rows: list[dict] = []
    if side == "ar":
        for f in ar_risk_flags(tx, today=today, limit=1000):
            rows.append({
                "party": f["vendor_or_customer"], "invoice_id": f["id"],
                "amount": f["amount"], "due_date": f["due_date"], "status": f["status"],
                "days_overdue": f["days_overdue"], "already_late": f["already_late"],
                "days_until_due": None if f["already_late"] else f["days_until_due"],
                "p_late": f["p_late"], "severity": f["severity"],
                "risk_basis": "model" if f["source"] == "model" else "rule",
            })
    else:
        for t in tx:
            if t.type != "ap" or t.status not in ("pending", "overdue"):
                continue
            days_until = ((date.fromisoformat(str(t.due_date)) - today).days
                          if t.due_date else 30)
            already_late = t.status == "overdue" or days_until < 0
            rows.append({
                "party": t.vendor_or_customer, "invoice_id": t.id,
                "amount": round(float(t.amount), 2), "due_date": t.due_date,
                "status": t.status, "days_overdue": max(0, -days_until),
                "days_until_due": days_until, "already_late": already_late,
                "p_late": None, "severity": ("high" if already_late
                                             else "medium" if days_until <= 7 else "low"),
                "risk_basis": "due_date",
            })

    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["party"], []).append(row)

    parties: list[dict] = []
    for party, items in groups.items():
        worst = max(items, key=lambda i: SEVERITY_RANK.get(i["severity"], 0))
        late = [i for i in items if i["already_late"]]
        dues = [i["due_date"] for i in items if i["due_date"]]
        upcoming = [i["days_until_due"] for i in items if not i["already_late"] and "days_until_due" in i]
        p_lates = [i["p_late"] for i in items if i["p_late"] is not None]
        parties.append({
            "party": party,
            "open_amount": round(sum(i["amount"] for i in items), 2),
            "invoice_count": len(items),
            "late_invoice_count": len(late),
            "max_days_overdue": max((i["days_overdue"] for i in items), default=0),
            "oldest_due_date": min(dues) if dues else None,
            "days_until_due": min(upcoming) if upcoming else None,
            "severity": worst["severity"],
            "p_late": round(max(p_lates), 3) if p_lates else None,
            "risk_basis": "model" if any(i["risk_basis"] == "model" for i in items)
                          else items[0]["risk_basis"],
            "invoices": [{k: i[k] for k in
                          ("invoice_id", "amount", "due_date", "status",
                           "days_overdue", "severity")} for i in items],
        })

    # Whoever is already late leads (a fact before a forecast), then exposure.
    parties.sort(key=lambda p: (not p["late_invoice_count"], -p["open_amount"]))
    shown = parties[:limit]
    return {
        "side": "receivable" if side == "ar" else "payable",
        "party_count": len(parties),
        "shown": len(shown),
        "truncated": len(parties) > len(shown),
        "total_open": round(sum(p["open_amount"] for p in parties), 2),
        "parties": shown,
        "method": ("Receivables come from the AR risk model (an existing late invoice is "
                   "100% late by fact, a not-yet-due one gets the model's probability). "
                   "Payables carry no model: their rating is the due date itself, so "
                   "'already late' and 'due within 7 days' are stated as facts, not "
                   "predictions."),
    }
