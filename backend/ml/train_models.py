"""Train + evaluate both scored models from the stored CSV files (SKILL.md §11).

Reads `backend/data/*.csv` written by ml/generate_training_data.py — never
regenerates data in memory, so the artifact a model was fitted on is the same
file anyone can inspect.

For each model it reports the baseline first, then the model, on a CHRONOLOGICAL
split (train on earlier rows, test on the latest — never shuffled), plus the
required failure case:
  * revenue  — persistence baseline (next month = this month), MAE
  * AR risk  — "always on time" baseline, accuracy + precision/recall + confusion
               matrix with raw counts (§11.2 asks for counts, not just ratios)

The AR model additionally gets an ABLATION: the v1 feature set and the v2
(customer-history) feature set are trained through the identical code path on
the identical split, and the delta is reported with a bootstrap confidence
interval. 79 late rows in the test slice is ±0.06 F1 of pure noise, so a bare
"v2 is better" claim is not worth making. Either set could win; whichever wins
the pre-declared rule below is what gets shipped, and the artifact says which.

Artifacts are saved to `backend/models/` and loaded by app/ml.py at request time,
so the app, the advisor and the notebook all use ONE implementation.

Run:  python -m ml.train_models
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score,
                             brier_score_loss, confusion_matrix, f1_score,
                             mean_absolute_error, precision_score, recall_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import features

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"

AR_CATEGORIES = features.AR_CATEGORIES
# Persistence + momentum + the fusion feature (last month's receivables state)
# + seasonal position. Chosen by comparing feature sets on the chronological
# split; month_index was dropped because extrapolating an index past the
# training window made MAE worse than the baseline.
REVENUE_FEATURES = ["prev_month", "trailing_3mo_avg", "ar_overdue_ratio_prev", "sin", "cos"]

# Revenue ablation: is the model actually better than "same month last year"?
# The AR bootstrap resamples ROWS; this one resamples the held-out MONTHS, which
# is the only unit available — and the reason the interval is wide.
REVENUE_BOOTSTRAP_RESAMPLES = 20_000
REVENUE_BOOTSTRAP_CI = (5, 95)

TEST_FRACTION = 0.2         # chronological: latest 20% held out
EXPECTED_F1_CEILING = 0.85  # decided BEFORE training (§11.4) — see README
# Severity band above the flag threshold, so the UI can separate "watch" from
# "chase now" instead of showing one blunt binary.
HIGH_RISK_MARGIN = 0.25
BOOTSTRAP_RESAMPLES = 1000
BOOTSTRAP_CI = (5, 95)


def _load(name: str) -> pd.DataFrame:
    path = DATA_DIR / f"{name}.csv"
    if not path.exists():
        raise SystemExit(f"{path} missing — run `python -m ml.generate_training_data` first")
    return pd.read_csv(path)


# --- AR late-payment risk (classification, §11.2) ---------------------------

def _ar_design(df: pd.DataFrame, numeric: list[str]) -> pd.DataFrame:
    """Numeric features (per the requested set) + one-hot categories.

    Only `log_amount` is derived here; every other column already exists in the
    stored CSV, which keeps the CSV the single source of truth for how history
    features were built (ml/features.py does that job, once).
    """
    df = df.copy()
    df["log_amount"] = np.log(df["amount"].astype(float).clip(lower=0.01))
    out = df[numeric].astype(float).copy()
    for cat in AR_CATEGORIES:
        out[f"cat_{cat}"] = (df["category"] == cat).astype(float)
    return out


def _fit_and_score_ar(df: pd.DataFrame, numeric: list[str]) -> dict:
    """One feature set through the full protocol. Returns metrics + raw scores."""
    X = _ar_design(df, numeric)
    y = df["paid_late"].astype(int)

    split = int(len(df) * (1 - TEST_FRACTION))
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]

    # Baseline: always predict "on time" (§11.2 — report it, it looks deceptively good)
    baseline_pred = np.zeros(len(y_test), dtype=int)
    baseline = {
        "name": "always_on_time",
        "accuracy": round(float(accuracy_score(y_test, baseline_pred)), 4),
        "late_caught": 0,
        "late_actual": int(y_test.sum()),
        "note": "high accuracy, zero recall — why ratios alone are misleading here",
    }

    # Threshold is chosen on the LAST 20% OF TRAINING DATA only; the test slice
    # stays unseen until the final score below.
    val_start = int(len(X_train) * 0.8)
    X_fit, X_val = X_train.iloc[:val_start], X_train.iloc[val_start:]
    y_fit, y_val = y_train.iloc[:val_start], y_train.iloc[val_start:]

    # No class_weight="balanced": it inflates probabilities (mean p ≈ 0.47 vs the
    # true 21.6% base rate of the training window; 22.9% is the whole-dataset
    # rate and 28.2% the test slice), which would make the app's "p(late)"
    # misleading. Calibrated scores + a tuned threshold give the same F1 but
    # honest numbers.
    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=2000, random_state=0),
    )
    model.fit(X_fit, y_fit)

    best_threshold, best_f1 = 0.5, -1.0
    if len(X_val):
        val_proba = model.predict_proba(X_val)[:, 1]
        for th in np.arange(0.10, 0.81, 0.02):
            f1_at = f1_score(y_val, (val_proba >= th).astype(int), zero_division=0)
            if f1_at > best_f1:
                best_threshold, best_f1 = float(round(th, 2)), float(f1_at)

    model.fit(X_train, y_train)          # refit on the whole training window
    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= best_threshold).astype(int)

    tn, fp, fn, tp = (int(v) for v in confusion_matrix(y_test, pred, labels=[0, 1]).ravel())
    late_actual = int(y_test.sum())
    result = {
        "task": "ar_late_payment_risk",
        "model": "LogisticRegression + StandardScaler (calibrated probabilities)",
        # `features` is the full design matrix (the UI lists it); the artifact
        # separately records which numeric columns its model consumes.
        "features": list(X.columns),
        "features_used": list(numeric),
        "rows": {"total": int(len(df)), "train": int(len(X_train)), "test": int(len(X_test))},
        "baseline": baseline,
        "model_metrics": {
            "accuracy": round(float(accuracy_score(y_test, pred)), 4),
            "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
            # Ranking quality and probability honesty, so a small F1 move is not
            # mistaken for progress on a 79-positive test slice.
            "pr_auc": round(float(average_precision_score(y_test, proba)), 4),
            "brier": round(float(brier_score_loss(y_test, proba)), 4),
        },
        "confusion_matrix": {
            "labels": ["on_time", "late"],
            "matrix": [[tn, fp], [fn, tp]],
            "true_negative": tn, "false_positive": fp,
            "false_negative": fn, "true_positive": tp,
            "late_actual": late_actual, "late_caught": tp,
        },
        "threshold": best_threshold,
        "threshold_tuned_on": "last 20% of the training window (test rows never seen)",
    }
    return {"result": result, "proba": proba, "pred": pred, "model": model,
            "y_test": y_test, "test_rows": df.iloc[split:]}


def _bootstrap_delta(v1: dict, v2: dict) -> dict:
    """Confidence interval on (v2 - v1) by resampling the test slice.

    Without this, "F1 went from 0.506 to 0.53" is indistinguishable from noise:
    the test slice has 79 late rows, so F1 alone moves ±0.06 on resampling.
    """
    y = v1["y_test"].to_numpy()
    n = len(y)
    if not n:
        return {"resamples": 0, "note": "empty test slice"}
    rng = np.random.default_rng(0)
    d_f1, d_ap = [], []
    for _ in range(BOOTSTRAP_RESAMPLES):
        idx = rng.integers(0, n, n)
        if y[idx].sum() == 0:            # a resample with no positives has no recall
            continue
        d_f1.append(f1_score(y[idx], v2["pred"][idx], zero_division=0)
                    - f1_score(y[idx], v1["pred"][idx], zero_division=0))
        d_ap.append(average_precision_score(y[idx], v2["proba"][idx])
                    - average_precision_score(y[idx], v1["proba"][idx]))

    def band(vals: list[float]) -> dict:
        if not vals:
            return {"p05": None, "p95": None}
        return {"p05": round(float(np.percentile(vals, BOOTSTRAP_CI[0])), 4),
                "p95": round(float(np.percentile(vals, BOOTSTRAP_CI[1])), 4)}

    m1, m2 = v1["result"]["model_metrics"], v2["result"]["model_metrics"]
    return {
        "resamples": len(d_f1),
        "resamples_requested": BOOTSTRAP_RESAMPLES,
        "ci": f"{BOOTSTRAP_CI[0]}-{BOOTSTRAP_CI[1]}%",
        "delta_f1": {"point": round(m2["f1"] - m1["f1"], 4), **band(d_f1)},
        "delta_pr_auc": {"point": round(m2["pr_auc"] - m1["pr_auc"], 4), **band(d_ap)},
        "note": ("a CI straddling 0 means the ablation is inconclusive, not that v2 won"),
    }


def _ablation_summary(scored: dict) -> dict:
    m = scored["result"]["model_metrics"]
    return {k: m[k] for k in ("accuracy", "precision", "recall", "f1", "pr_auc", "brier")} | {
        "features": len(scored["result"]["features_used"]),
        "threshold": scored["result"]["threshold"],
        "late_caught": scored["result"]["confusion_matrix"]["late_caught"],
        "late_actual": scored["result"]["confusion_matrix"]["late_actual"],
    }


def _select_feature_set(v1: dict, v2: dict) -> tuple[str, str]:
    """The ship rule, declared before the ablation was ever run.

    v2 ships only if it ranks better AND does not lose ground on F1/recall —
    recall being the safety metric, because a missed late invoice means an
    unpaid invoice nobody chased. A tie on everything means "keep the simpler
    model", so v1 wins ties.
    """
    m1, m2 = v1["result"]["model_metrics"], v2["result"]["model_metrics"]
    d_f1 = m2["f1"] - m1["f1"]
    d_ap = m2["pr_auc"] - m1["pr_auc"]
    d_recall = m2["recall"] - m1["recall"]
    if d_ap > 0 and d_f1 >= 0 and d_recall >= 0 and (d_ap > 0 or d_f1 > 0):
        return "v2", (f"v2 ships: delta PR-AUC {d_ap:+.4f}, delta F1 {d_f1:+.4f}, "
                      f"delta recall {d_recall:+.4f}")
    return "v1", (f"v1 ships (v2 not clearly better): delta PR-AUC {d_ap:+.4f}, "
                  f"delta F1 {d_f1:+.4f}, delta recall {d_recall:+.4f}")


def train_ar_risk() -> dict:
    df = _load("ar_training").sort_values("transaction_date").reset_index(drop=True)

    v1 = _fit_and_score_ar(df, features.AR_NUMERIC_V1)
    v2 = _fit_and_score_ar(df, features.AR_NUMERIC_V2)
    bootstrap = _bootstrap_delta(v1, v2)
    selected, verdict = _select_feature_set(v1, v2)
    chosen = v2 if selected == "v2" else v1

    result = dict(chosen["result"])
    result["selected"] = selected
    result["selection_rule"] = (
        "v2 ships only if PR-AUC improves, F1 does not drop and recall does not "
        "drop; ties go to the simpler model (declared before training)"
    )
    result["selection_verdict"] = verdict
    result["ablation"] = {"v1": _ablation_summary(v1), "v2": _ablation_summary(v2)}
    result["bootstrap"] = bootstrap

    proba, pred = chosen["proba"], chosen["pred"]
    test_view = chosen["test_rows"].copy()
    test_view["pred"] = pred
    test_view["p_late"] = proba
    wrong = test_view[test_view["pred"].astype(int) != test_view["paid_late"].astype(int)]
    if len(wrong):
        worst = wrong.iloc[int((wrong["p_late"] - 0.5).abs().argmax())]
        was_late = int(worst["paid_late"]) == 1
        result["failure_case"] = {
            "kind": "false_safe" if was_late else "false_alarm",
            "vendor_or_customer": str(worst["vendor_or_customer"]),
            "amount": round(float(worst["amount"]), 2),
            "category": str(worst["category"]),
            "days_until_due": int(worst["days_until_due"]),
            "actual_late": int(worst["paid_late"]),
            "predicted_late": int(worst["pred"]),
            "p_late": round(float(worst["p_late"]), 3),
            "hypothesis": ("a customer with a reliable history went late anyway — a "
                           "one-off cash-flow shock no creation-time feature can see"
                           if was_late else
                           "the customer's short late history flagged them, but they paid "
                           "on time — label noise blurs the true pattern"),
        }

    f1 = result["model_metrics"]["f1"]
    result["ceiling_check"] = {
        "expected_f1_ceiling": EXPECTED_F1_CEILING,
        "observed_f1": f1,
        "status": "ok" if f1 <= EXPECTED_F1_CEILING else "TOO HIGH — add label noise and regenerate",
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": chosen["model"], "categories": AR_CATEGORIES,
                 "numeric": (features.AR_NUMERIC_V2 if selected == "v2"
                             else features.AR_NUMERIC_V1),
                 "threshold": result["threshold"],
                 "high_risk_margin": HIGH_RISK_MARGIN,
                 "feature_version": 2 if selected == "v2" else 1,
                 # Serving compares these against ml/features.py and refuses to
                 # score with an artifact whose constants have drifted.
                 **features.artifact_constants()},
                MODEL_DIR / "ar_risk.joblib")
    return result


# --- Next-month revenue (regression, §11.1) ---------------------------------

def _add_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """Month-of-year position, so the model can learn seasonality."""
    month_no = df["month"].str.slice(5, 7).astype(int)
    df["sin"] = np.sin(2 * np.pi * month_no / 12)
    df["cos"] = np.cos(2 * np.pi * month_no / 12)
    return df


def _seasonal_naive(df: pd.DataFrame, test_view: pd.DataFrame) -> np.ndarray:
    """Same month last year, read from the committed CSV.

    `lag_12` is deliberately NOT a model feature (see the write-up), but it is
    the strongest naive revenue baseline, so every comparison has to include it
    read straight from the data rather than from the design matrix.
    """
    by_index = {int(r.month_index): float(r.revenue) for r in df.itertuples()}
    return np.array([by_index.get(int(mi) - 12, np.nan) for mi in test_view["month_index"]],
                    dtype=float)


def _bootstrap_revenue_delta(model_ae: np.ndarray, naive_ae: np.ndarray) -> dict:
    """90% interval on (seasonal-naive MAE - model MAE), resampling test months.

    "+$98/month better" over ten months is not a result on its own: a couple of
    unlucky months can carry it. Resampling the ten months with replacement and
    reporting the 5th/95th percentile says whether the improvement survives that
    wobble. If the interval straddles zero, the honest statement is "inside
    sampling noise", and the write-up has to say so — which is exactly why this
    number is committed alongside the flattering one.

    Seeded, so the interval in models/metrics.json is stable across runs.
    """
    keep = ~np.isnan(naive_ae)
    model_ae, naive_ae = model_ae[keep], naive_ae[keep]
    n = len(model_ae)
    if n < 2:
        return {"resamples": 0, "note": "too few held-out months to resample"}

    rng = np.random.default_rng(0)
    deltas = np.empty(REVENUE_BOOTSTRAP_RESAMPLES)
    for i in range(REVENUE_BOOTSTRAP_RESAMPLES):
        idx = rng.integers(0, n, n)
        deltas[i] = naive_ae[idx].mean() - model_ae[idx].mean()

    lo, hi = REVENUE_BOOTSTRAP_CI
    p05 = float(np.percentile(deltas, lo))
    p95 = float(np.percentile(deltas, hi))
    return {
        "comparison": "seasonal naive (same month last year) - shipped model",
        "unit": "dollars of MAE per held-out month",
        "point": round(float(naive_ae.mean() - model_ae.mean()), 2),
        "p05": round(p05, 2),
        "p95": round(p95, 2),
        "ci": f"{lo}-{hi}%",
        "resamples": REVENUE_BOOTSTRAP_RESAMPLES,
        "months": n,
        "straddles_zero": bool(p05 <= 0.0 <= p95),
        "note": ("an interval that straddles 0 means the improvement is "
                 "indistinguishable from noise on this test slice"),
    }


def train_revenue() -> dict:
    df = _add_seasonal(_load("revenue_training").sort_values("month_index").reset_index(drop=True))
    X = df[REVENUE_FEATURES].astype(float)
    y = df["revenue"].astype(float)

    split = int(len(df) * (1 - TEST_FRACTION))
    X_train, X_test = X.iloc[:split], X.iloc[split:]
    y_train, y_test = y.iloc[:split], y.iloc[split:]

    # Baseline: persistence — next month = this month (§11.1)
    baseline_mae = float(mean_absolute_error(y_test, X_test["prev_month"]))

    model = LinearRegression()
    model.fit(X_train, y_train)
    pred = model.predict(X_test)
    model_mae = float(mean_absolute_error(y_test, pred))

    # Two baselines, because persistence is the flattering one: the seasonal
    # naive (same month last year) is the strongest naive rule and the model's
    # real competitor.
    naive_pred = _seasonal_naive(df, df.iloc[split:])
    naive_mae = float(np.nanmean(np.abs(y_test.to_numpy(dtype=float) - naive_pred)))

    result = {
        "task": "next_month_revenue",
        "model": "LinearRegression",
        "rows": {"total": int(len(df)), "train": int(len(X_train)), "test": int(len(X_test))},
        "features": REVENUE_FEATURES,
        "baseline": {"name": "persistence (next month = this month)",
                     "mae": round(baseline_mae, 2)},
        "baseline_seasonal_naive": {"name": "seasonal naive (same month last year)",
                                    "mae": round(naive_mae, 2)},
        "model_metrics": {"mae": round(model_mae, 2)},
        "improvement_pct": round((baseline_mae - model_mae) / baseline_mae * 100, 1) if baseline_mae else None,
        "improvement_vs_seasonal_naive_pct": (round((naive_mae - model_mae) / naive_mae * 100, 1)
                                             if naive_mae else None),
        "coefficients": {f: round(float(c), 4) for f, c in zip(REVENUE_FEATURES, model.coef_)},
        "intercept": round(float(model.intercept_), 2),
    }

    # Committed so the write-up's interval is reproducible, not a one-off run.
    result["bootstrap"] = _bootstrap_revenue_delta(
        np.abs(y_test.to_numpy(dtype=float) - pred),
        np.abs(y_test.to_numpy(dtype=float) - naive_pred),
    )

    test_view = df.iloc[split:].copy()
    test_view["prediction"] = pred
    test_view["abs_error"] = (test_view["revenue"] - test_view["prediction"]).abs()
    worst = test_view.loc[test_view["abs_error"].idxmax()]
    result["failure_case"] = {
        "month": str(worst["month"]),
        "actual": round(float(worst["revenue"]), 2),
        "predicted": round(float(worst["prediction"]), 2),
        "error": round(float(worst["abs_error"]), 2),
        "hypothesis": ("the month moved against the trend and the model only sees prior "
                       "months — a one-off collection or expense shift it could not "
                       "anticipate"),
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": REVENUE_FEATURES},
                MODEL_DIR / "revenue_forecast.joblib")
    return result


def train_all() -> dict:
    print("[train] reading stored CSVs from backend/data/")
    ar = train_ar_risk()
    rev = train_revenue()

    metrics = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "data_files": ["data/ar_training.csv", "data/revenue_training.csv",
                       "data/fusion_training.csv"],
        "ar_risk": ar,
        "revenue": rev,
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    cm = ar["confusion_matrix"]
    m = ar["model_metrics"]
    print(f"\n[AR risk] baseline acc {ar['baseline']['accuracy']:.3f} "
          f"(caught 0/{cm['late_actual']} late)")
    print(f"[AR risk] ablation v1 (4 history-poor features): {ar['ablation']['v1']['f1']} F1 "
          f"/ {ar['ablation']['v1']['pr_auc']} PR-AUC")
    print(f"[AR risk] ablation v2 (8 features):              {ar['ablation']['v2']['f1']} F1 "
          f"/ {ar['ablation']['v2']['pr_auc']} PR-AUC")
    b = ar["bootstrap"]
    print(f"[AR risk] delta F1 {b['delta_f1']['point']:+.4f} "
          f"(CI {b['delta_f1']['p05']} .. {b['delta_f1']['p95']}), "
          f"delta PR-AUC {b['delta_pr_auc']['point']:+.4f} "
          f"(CI {b['delta_pr_auc']['p05']} .. {b['delta_pr_auc']['p95']})")
    print(f"[AR risk] selected: {ar['selected']} — {ar['selection_verdict']}")
    print(f"[AR risk] model  acc {m['accuracy']:.3f} P {m['precision']:.3f} "
          f"R {m['recall']:.3f} F1 {m['f1']:.3f} PR-AUC {m['pr_auc']:.3f} "
          f"Brier {m['brier']:.3f} @ threshold {ar['threshold']}")
    print(f"[AR risk] confusion rows=actual [on_time, late]: {cm['matrix']} "
          f"(caught {cm['late_caught']}/{cm['late_actual']} late)")
    print(f"[AR risk] ceiling check: {ar['ceiling_check']['status']} "
          f"(F1 {ar['ceiling_check']['observed_f1']} vs ceiling {EXPECTED_F1_CEILING})")
    print(f"[AR risk] failure: {ar.get('failure_case', {}).get('kind')} "
          f"{ar.get('failure_case', {}).get('vendor_or_customer')} "
          f"p_late={ar.get('failure_case', {}).get('p_late')}")
    print(f"\n[Revenue] baseline MAE ${rev['baseline']['mae']:,.0f} -> "
          f"model MAE ${rev['model_metrics']['mae']:,.0f} "
          f"({rev['improvement_pct']}% better)")
    print(f"[Revenue] failure: {rev['failure_case']['month']} "
          f"actual ${rev['failure_case']['actual']:,.0f} vs "
          f"predicted ${rev['failure_case']['predicted']:,.0f}")
    print("\n[train] saved models + metrics to backend/models/")
    return metrics


if __name__ == "__main__":
    train_all()
