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

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"

# Must match ml/train_models.py
AR_CATEGORIES = ["Customer Invoice", "Money Lent Out", "Other Receivable"]


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


def _customer_history(tx: list, exclude=None) -> dict[str, tuple[float, int]]:
    """vendor → (observed late rate, prior AR count).

    `exclude` is the row being scored, kept out of its own feature (that would be
    leakage: the model would be told the answer it is predicting). It is matched
    by identity first, because rows arriving from the API have no database id yet
    and an id-based check would silently match nothing.
    """
    counts: dict[str, list[int]] = {}
    for t in tx:
        if t.type != "ar":
            continue
        if exclude is not None and (t is exclude or (exclude.id is not None and t.id == exclude.id)):
            continue
        if t.status == "pending":
            continue  # no outcome evidence yet
        counts.setdefault(t.vendor_or_customer, []).append(1 if _is_late_evidence(t) else 0)
    return {k: (sum(v) / len(v), len(v)) for k, v in counts.items() if v}


def ar_risk_flags(tx: Iterable, today: date | None = None, limit: int = 6) -> list[dict]:
    """AR rows scored for late-payment risk, highest risk first.

    Only open rows are scored (settled ones have nothing left to chase).
    """
    tx = list(tx)
    today = today or date.today()
    model = _ar_model()
    open_rows = [t for t in tx if t.type == "ar" and t.status in ("pending", "overdue")]
    if not open_rows:
        return []

    out: list[dict] = []
    for t in open_rows:
        history = _customer_history(tx, exclude=t)
        global_rate = (sum(r for r, _ in history.values()) / len(history)) if history else 0.2
        rate, prior = history.get(t.vendor_or_customer, (global_rate, 0.0))
        prior = int(prior)
        days_until_due = ((date.fromisoformat(str(t.due_date)) - today).days
                          if t.due_date else 30)
        if model is not None:
            row = {
                "log_amount": math.log(max(float(t.amount), 0.01)),
                "days_until_due": float(days_until_due),
                "customer_historical_late_rate": rate,
                "customer_prior_count": float(prior),
            }
            for cat in AR_CATEGORIES:
                row[f"cat_{cat}"] = 1.0 if t.category == cat else 0.0
            # Same column order the trainer used: numerics, then one-hot categories.
            features = list(model.payload["numeric"]) + \
                [f"cat_{c}" for c in model.payload["categories"]]
            import pandas as pd
            frame = pd.DataFrame([[row[f] for f in features]], columns=features)
            p_late = float(model.model.predict_proba(frame)[0][1])
            threshold = float(model.payload.get("threshold", 0.3))
            high_margin = float(model.payload.get("high_risk_margin", 0.12))
            source = "model"
        else:
            # Documented rule of its own when no artifact exists — never pretend.
            p_late = min(0.95, 0.15 + (0.35 if t.status == "overdue" else 0) + 0.4 * rate)
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
            "customer_historical_late_rate": round(rate, 3),
            "customer_prior_count": prior,
            "p_late": round(p_late, 3),
            "at_risk": p_late >= threshold,
            "severity": ("high" if p_late >= threshold + high_margin
                         else "medium" if p_late >= threshold else "low"),
            "threshold": threshold,
            "source": source,
        })

    out.sort(key=lambda r: (-r["p_late"], -r["amount"]))
    return out[:limit]


def ar_risk_summary(tx: Iterable, today: date | None = None) -> dict:
    flags = ar_risk_flags(tx, today=today, limit=100)
    risky = [f for f in flags if f["at_risk"]]
    high = [f for f in flags if f.get("severity") == "high"]
    return {
        "scored": len(flags),
        "at_risk": len(risky),
        "at_risk_amount": round(sum(f["amount"] for f in risky), 2),
        "high_risk": len(high),
        "high_risk_amount": round(sum(f["amount"] for f in high), 2),
        "open_amount": round(sum(f["amount"] for f in flags), 2),
        "top": flags[:6],
        "method": ("Logistic regression on amount, payment terms, customer's observed "
                   "late history and receivable category — trained on synthetic data, "
                   "evaluated chronologically (see models/metrics.json)."),
        "source": flags[0]["source"] if flags else "none",
    }
