"""Shared AR-history features — ONE definition used by training and by serving.

This module exists because the trainer (`ml/generate_training_data.py`) and the
live scorer (`app/ml.py`) must agree on three things exactly, or the metrics
reported in `models/metrics.json` describe a model that is not the one being
served:

  1. WHICH prior invoices count as history.
  2. HOW the population rate that shrink the per-customer rate is computed.
  3. HOW the resulting features are numbered.

Constants live here rather than duplicated with a "# must match" comment. The
training artifact records them, and `app/ml.py` refuses to score with an
artifact whose constants differ from these (it reports the documented fallback
rule instead of silently using mismatched numbers).

Why history is admitted by RESOLUTION date, not invoice date
------------------------------------------------------------
An invoice issued on Jan 1 with 60-day terms is not resolved until March. If a
second invoice is issued on Jan 10, then on Jan 10 nobody knows the first one
was late. Admitting it anyway (`resolved_on` ignored) leaks a future outcome
into the features and, worse, makes training more informed than serving, which
deliberately ignores `pending` rows. So a row contributes to history only when

    resolved_on(row) < scoring_moment

`outcome_known_on()` defines that date: the due date, because the label
"paid_late" stops being in doubt the moment payment is overdue. It exists on
both training rows and live rows, so the rule is identical on both sides with
no fabricated settlement date.

The scoring moment differs by design: the trainer grades what was knowable at
ISSUANCE (the harder, point-in-time task), while serving answers "as of today"
and therefore knows more. Serving is the easier task, so the reported held-out
metrics are conservative rather than flattering.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

# --- constants (recorded in the artifact; app/ml.py checks them) ------------

SHRINK_K = 3                 # pseudo-count; declared BEFORE training, not tuned
COLD_START_PRIOR = 0.25      # mid-point of the documented 15-30% late-rate band
COLD_START_MIN_ROWS = 20     # below this many resolved rows, use the prior above
RECENCY_CAP_DAYS = 365       # "no late payment ever" sentinel for the recency feature

AR_CATEGORIES = ["Customer Invoice", "Money Lent Out", "Other Receivable"]

# Feature names, in the order the design matrix uses them. V1 is kept so the
# ablation can train the old feature set through the identical code path.
AR_NUMERIC_V1 = [
    "log_amount",
    "days_until_due",
    "customer_historical_late_rate",
    "customer_prior_count",
]
AR_NUMERIC_V2 = [
    "log_amount",
    "days_until_due",
    "customer_prior_count",
    "customer_late_rate_shrunk",
    "customer_late_amount_share",
    "days_since_last_late_capped",
    "has_prior_late",
    "has_history",
]


def artifact_constants() -> dict:
    """Exactly what the artifact records so serving can detect drift."""
    return {
        "shrink_k": SHRINK_K,
        "cold_start_prior": COLD_START_PRIOR,
        "cold_start_min_rows": COLD_START_MIN_ROWS,
        "recency_cap_days": RECENCY_CAP_DAYS,
    }


# --- dates ------------------------------------------------------------------

def parse_date(value) -> Optional[date]:
    """date | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM:SS...' -> date, else None."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def outcome_known_on(transaction_date, due_date) -> Optional[date]:
    """When this row's on-time/late outcome stopped being in doubt.

    The due date: the moment payment is overdue, `paid_late` is determined.
    Falls back to the invoice date when a row carries no due date.
    """
    return parse_date(due_date) or parse_date(transaction_date)


# --- accumulators -----------------------------------------------------------

@dataclass
class CustomerStats:
    count: int = 0
    late_count: int = 0
    total_amount: float = 0.0
    late_amount: float = 0.0
    last_late_on: Optional[date] = None


@dataclass
class HistoryAccumulator:
    """Running per-customer + pooled tallies over RESOLVED observations only.

    Callers decide what is resolved (`resolved_on < scoring_moment`); this class
    only accumulates, so there is a single place where "late" is counted.
    """

    _by_key: dict = field(default_factory=dict)
    count: int = 0
    late_count: int = 0

    def add(self, key: str, amount: float, late: bool, resolved_on: Optional[date]) -> None:
        stats = self._by_key.setdefault(key, CustomerStats())
        amount = float(amount or 0.0)
        stats.count += 1
        stats.total_amount += amount
        self.count += 1
        if late:
            stats.late_count += 1
            stats.late_amount += amount
            self.late_count += 1
            if resolved_on is not None and (
                stats.last_late_on is None or resolved_on > stats.last_late_on
            ):
                stats.last_late_on = resolved_on

    def stats(self, key: str) -> Optional[CustomerStats]:
        return self._by_key.get(key)

    def pooled_rate(self) -> tuple[float, int]:
        """Row-level pooled late rate + how many rows it was computed over.

        Row-level, not the mean of per-customer rates: a customer with one late
        invoice must not weigh as much as one with thirty. `app/ml.py` used to
        use the per-customer mean, so serving and training disagreed on "the
        population rate" even before the leakage fix.
        """
        if self.count == 0:
            return COLD_START_PRIOR, 0
        return self.late_count / self.count, self.count


# --- the features themselves ------------------------------------------------

def feature_values(
    stats: Optional[CustomerStats],
    pooled: tuple[float, int],
    scoring_moment: date,
) -> dict:
    """The history block of the design matrix, from one shared implementation.

    Returns every history column the CSVs carry, so the generator, the trainer
    and the server cannot drift apart:

      customer_historical_late_rate   raw observed rate (display + v1 feature)
      customer_prior_count            resolved prior invoices
      customer_late_rate_shrunk       empirical-Bayes rate (v2 input)
      customer_late_amount_share      late $ / settled $ (v2 input)
      days_since_last_late_capped     recency, capped (v2 input)
      has_prior_late                  0/1 (v2 input)
      has_history                     0/1 (v2 input)
    """
    count = stats.count if stats else 0
    late = stats.late_count if stats else 0
    total_amount = stats.total_amount if stats else 0.0
    late_amount = stats.late_amount if stats else 0.0
    last_late_on = stats.last_late_on if stats else None

    pooled_rate, pooled_n = pooled
    # Only a warm accumulator may claim to know the population rate; before
    # that, a declared constant — never a rate computed from future rows, which
    # is what this used to do (the cold-start leak).
    prior = pooled_rate if pooled_n >= COLD_START_MIN_ROWS else COLD_START_PRIOR

    if count:
        raw_rate = late / count
        shrunk = (late + SHRINK_K * prior) / (count + SHRINK_K)
    else:
        raw_rate = prior
        shrunk = prior

    # Guard the denominator: a customer with settled rows but zero settled
    # volume must read 0.0, not NaN/inf (which would poison the frame).
    amount_share = (late_amount / total_amount) if total_amount > 0 else 0.0

    if last_late_on is None:
        recency = float(RECENCY_CAP_DAYS)
    else:
        recency = float(min(max((scoring_moment - last_late_on).days, 0), RECENCY_CAP_DAYS))

    return {
        "customer_historical_late_rate": round(raw_rate, 4),
        "customer_prior_count": count,
        "customer_late_rate_shrunk": round(shrunk, 4),
        "customer_late_amount_share": round(amount_share, 4),
        "days_since_last_late_capped": recency,
        "has_prior_late": 1.0 if late > 0 else 0.0,
        "has_history": 1.0 if count > 0 else 0.0,
    }
