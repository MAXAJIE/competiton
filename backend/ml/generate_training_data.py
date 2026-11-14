"""Generate the synthetic training data for the two scored models (SKILL.md §11.3).

Writes CSV files to `backend/data/` so training ALWAYS reads the stored files
(see train_models.py) rather than regenerating in memory — the dataset a model
was trained on is then a real, inspectable artifact.

Three files:
  ar_training.csv      AR rows + features + `paid_late` label (classifier, §11.2)
  revenue_training.csv monthly income series + features (regression, §11.1)
  fusion_training.csv  month-level FUSION of both: revenue joined with the
                       previous month's receivables state, which is what the
                       shipped revenue model actually consumes

Ground truth (SKILL.md §11.3), all in this one file so it is never re-derived:
  late logit = BASE_INTERCEPT + 1.3*(1 - customer_reliability) + 0.5*amount_z + category_risk
  then NOISE_FLIP_PROB of labels are flipped, which is the deliberate ceiling
  control from §11.4 — it exists so the model cannot recover the rule perfectly.

Run:  python -m ml.generate_training_data
"""
from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

SEED = 42
N_CUSTOMERS = 45
N_AR_ROWS = 1400
N_MONTHS = 48          # 4 years = two full seasonal cycles for the trend model
NOISE_FLIP_PROB = 0.08          # §11.4 ceiling control — do not remove
START = date(2023, 1, 1)
END = date(2026, 11, 1)

# Receivable categories come from the app's own taxonomy (categories.py) so a
# model trained here is directly usable on real `transactions` rows.
AR_CATEGORIES = ["Customer Invoice", "Money Lent Out", "Other Receivable"]
CATEGORY_RISK = {               # hand-picked log-odds nudge per category
    "Customer Invoice": 0.1,
    "Money Lent Out": 0.5,
    "Other Receivable": -0.2,
}
TERMS = [15, 30, 45, 60]        # payment terms offered, in days
# Intercept tuned so the late rate lands in SKILL.md §11.3's 15-30% band
# (-1.7 gave 32.5%, which is outside it).
BASE_INTERCEPT = -2.35

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@dataclass
class Customer:
    customer_id: str
    name: str
    reliability: float          # 1.0 = always on time, 0.0 = always late


_NAME_PARTS = ["Harbor", "Linden", "Mesa", "Oak & Pine", "Northgate", "Brightwater",
               "Cedar", "Silverline", "Kestrel", "Maple", "Ironwood", "Bluefin",
               "Riverton", "Sundial", "Copperfield", "Willow", "Granite", "Beacon"]
_NAME_SUFFIX = ["Cafe", "Studio", "Retail", "Trading", "Supplies", "Works", "Group",
                "Partners", "Services", "Co.", "Labs", "Market", "Design", "Logistics"]


def _customers(rng: random.Random) -> list[Customer]:
    """A few dozen distinct recurring customers (SKILL.md §11.3)."""
    seen: set[str] = set()
    out: list[Customer] = []
    for i in range(N_CUSTOMERS):
        while True:
            name = f"{rng.choice(_NAME_PARTS)} {rng.choice(_NAME_SUFFIX)}"
            if name not in seen:
                seen.add(name)
                break
        # Beta(2, 2) → most customers middling, a few very reliable/unreliable
        out.append(Customer(f"cust_{i:03d}", name, round(rng.betavariate(2, 2), 4)))
    return out


def _generate_ar(customers: list[Customer], rng: random.Random) -> list[dict]:
    span = (END - START).days
    rows: list[dict] = []
    for _ in range(N_AR_ROWS):
        cust = rng.choice(customers)
        issued = START + timedelta(days=rng.uniform(0, span))
        terms = rng.choice(TERMS)
        due = issued + timedelta(days=terms)
        amount = round(math.exp(rng.gauss(6.5, 0.8)), 2)
        category = rng.choice(AR_CATEGORIES)

        amount_z = (math.log(amount) - 6.5) / 0.8
        logit = (BASE_INTERCEPT
                 + 1.3 * (1 - cust.reliability)
                 + 0.5 * amount_z
                 + CATEGORY_RISK[category])
        p_late = 1 / (1 + math.exp(-logit))
        late = rng.random() < p_late
        if rng.random() < NOISE_FLIP_PROB:      # ceiling control (§11.4)
            late = not late

        rows.append({
            "customer_id": cust.customer_id,
            "vendor_or_customer": cust.name,
            "transaction_date": issued.isoformat(),
            "due_date": due.isoformat(),
            "days_until_due": terms,
            "amount": amount,
            "category": category,
            "paid_late": int(late),
            # true reliability is recorded for inspection only — training must
            # NOT use it, or it becomes leakage. The model uses the *observed*
            # historical late rate computed from prior rows instead.
            "customer_reliability_true": cust.reliability,
        })
    rows.sort(key=lambda r: r["transaction_date"])
    return rows


def _add_history_feature(rows: list[dict]) -> None:
    """Observed late-rate from PRIOR rows only (no leakage, §11.2)."""
    total = sum(r["paid_late"] for r in rows) / max(len(rows), 1)
    seen: dict[str, list[int]] = {}
    for r in rows:
        past = seen.get(r["customer_id"], [])
        r["customer_historical_late_rate"] = round(sum(past) / len(past), 4) if past else round(total, 4)
        r["customer_prior_count"] = len(past)
        seen.setdefault(r["customer_id"], []).append(r["paid_late"])


def _month_key(d: str) -> str:
    return d[:7]


def _generate_fusion(ar_rows: list[dict], rng: random.Random) -> list[dict]:
    """Monthly revenue fused with the previous month's receivables state.

    Revenue is a mild upward trend + seasonality + noise, minus a collections
    drag: when last month's receivables were largely overdue, this month's
    revenue is dented. That gives the fusion feature real signal instead of a
    column the model can only learn to ignore.
    """
    months: list[str] = []
    y, m = START.year, START.month
    for _ in range(N_MONTHS):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1

    by_month: dict[str, list[dict]] = {k: [] for k in months}
    for r in ar_rows:
        k = _month_key(r["transaction_date"])
        if k in by_month:
            by_month[k].append(r)

    out: list[dict] = []
    prev_revenue: float | None = None
    overdue_ratio_prev = 0.0
    ar_total_prev = 0.0
    for i, k in enumerate(months):
        rows = by_month[k]
        ar_total = round(sum(r["amount"] for r in rows), 2)
        ar_overdue = round(sum(r["amount"] for r in rows if r["paid_late"]), 2)
        overdue_ratio = round(ar_overdue / ar_total, 4) if ar_total else 0.0

        trend = 8000 + (14000 - 8000) * (i / max(N_MONTHS - 1, 1))
        seasonal = 1500 * math.sin(2 * math.pi * i / 12)
        noise = rng.gauss(0, 800)
        drag = 0.30 * trend * overdue_ratio_prev   # keep the fusion feature learnable
        revenue = round(max(0.0, trend + seasonal + noise - drag), 2)

        out.append({
            "month": k,
            "month_index": i,
            "revenue": revenue,
            "prev_month": prev_revenue if prev_revenue is not None else "",
            "trailing_3mo_avg": "",
            "ar_total_prev": round(ar_total_prev, 2),
            "ar_overdue_ratio_prev": overdue_ratio_prev,
        })

        prev_revenue = revenue
        overdue_ratio_prev = overdue_ratio
        ar_total_prev = ar_total

    # trailing_3mo_avg of *previous* months, filled after the series exists
    for i, row in enumerate(out):
        prior = [out[j]["revenue"] for j in range(max(0, i - 3), i)]
        row["trailing_3mo_avg"] = round(sum(prior) / len(prior), 2) if prior else ""
    return out


def _write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {path.relative_to(DATA_DIR.parent)}  ({len(rows)} rows)")


def generate(seed: int = SEED) -> dict[str, Path]:
    rng = random.Random(seed)
    customers = _customers(rng)
    ar_rows = _generate_ar(customers, rng)
    _add_history_feature(ar_rows)
    fusion_rows = _generate_fusion(ar_rows, rng)

    # The classifier trains on the same shape it sees in production, so drop the
    # ground-truth reliability column from the stored file.
    ar_out = [{k: v for k, v in r.items() if k != "customer_reliability_true"}
              for r in ar_rows]

    # Fusion needs warm-up rows (prev_month / trailing avg) before it is usable.
    rev_out = [r for r in fusion_rows if r["prev_month"] != "" and r["trailing_3mo_avg"] != ""]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ar_path = DATA_DIR / "ar_training.csv"
    rev_path = DATA_DIR / "revenue_training.csv"
    fusion_path = DATA_DIR / "fusion_training.csv"

    print("[generate] synthetic training data (SKILL.md §11.3)")
    _write_csv(ar_path, ar_out)
    _write_csv(rev_path, rev_out)
    _write_csv(fusion_path, fusion_rows)

    rate = sum(r["paid_late"] for r in ar_out) / len(ar_out)
    revs = [r["revenue"] for r in rev_out]
    print(f"[generate] AR positive rate: {rate:.1%} (target 15-30%), "
          f"{len({r['customer_id'] for r in ar_out})} distinct customers")
    print(f"[generate] revenue months: {len(rev_out)}, "
          f"range ${min(revs):,.0f} - ${max(revs):,.0f}")
    print(f"[generate] noise flip probability: {NOISE_FLIP_PROB:.0%} (§11.4 ceiling control)")
    return {"ar": ar_path, "revenue": rev_path, "fusion": fusion_path}


if __name__ == "__main__":
    generate()
