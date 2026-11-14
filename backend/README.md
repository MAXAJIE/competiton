# CashMonitoring — Python backend

FastAPI backend implementing `SKILL.md` + `PLAN.md` for the React frontend in
this repo. Stack locked per `SKILL.md` §1: Python + Supabase (Postgres) +
OpenRouter (one vision model for OCR, one for the advisor) + `yfinance`
indicators + fixed RSS headlines. No frontend files were touched — swap the
stubs in `src/lib/api.ts` to call these endpoints (see contract below).

## Run

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # (Linux/macOS: .venv/bin/pip)
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Tests (pure calc layer, no network):

```bash
.venv/Scripts/python -m pytest -q
```

## Environment variables

| Var | Used for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | login proxy, token validation |
| `SUPABASE_SERVICE_KEY` | server-side reads/writes (always filtered by `user_id`) |
| `OPENROUTER_API_KEY` | OCR + advisor. Without it the advisor still answers via the same four tools deterministically (no LLM) — never guesses |
| `OCR_MODEL` (default `openai/gpt-4o-mini`) | pinned OCR model — **must accept image input** |
| `OCR_FALLBACK_MODELS` | comma-separated chain tried when a model 429s or rejects images |
| `ADVISOR_MODEL` (default `google/gemini-2.5-flash`) | pinned advisor model |
| `ADVISOR_FALLBACK_MODELS` | same fallback idea for the advisor |
| `OCR_MAX_TOKENS` (default `3000`) | completion budget; reasoning models need a generous one |
| `ADVISOR_MAX_TOKENS` (default `2500`) | same for the advisor |
| `RESEND_API_KEY`, `EMAIL_FROM` | "send test report now" (fails loudly with 503 if unset — output is never faked) |
| `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_REPORT_EMAIL` | seed script |

## Database

Apply `backend/schema.sql` once in the Supabase SQL editor (per AGENTS.md this
repo doesn't own `supabase/migrations/` — ask Lovable to apply schema changes).
Also create a storage bucket named `documents` for OCR file retention
(optional; the pipeline works without it).

## Demo seed (PLAN Hour 30–40)

```bash
.venv/Scripts/python -m app.demo_seed
```

Idempotent: resets the fixed demo user and re-inserts 6 months of transactions
(upward income trend), overdue AR/AP rows, risk settings tuned so the runway
sits just under the threshold (warning banner visibly on), one pre-confirmed
OCR document, and a cached market snapshot so nothing on stage depends on live
external calls.

## Google login setup (one-time, in the Supabase dashboard)

1. Google Cloud Console → APIs & Services → Credentials → create an **OAuth client ID** (type: Web application).
2. Authorized redirect URI: `https://your-project.supabase.co/auth/v1/callback`.
3. Supabase dashboard → Authentication → Providers → Google: enable it, paste the client ID + secret.
4. Supabase dashboard → Authentication → URL Configuration: set Site URL to your dev origin (e.g. `http://localhost:8080`) and add it to Redirect URLs too.

> The dev port is whatever Vite prints (`8080` with the Lovable config, sometimes `5199`). Add **every** origin you actually use to Supabase's Redirect URLs, or Google login bounces back to a blank page.

No backend change is needed for Google: the browser completes the OAuth flow
with `@supabase/supabase-js` (PKCE), and the backend validates the resulting
access token with `supabase.auth.get_user` — provider-agnostic.

## Scheduled market snapshot (B3)

The snapshot is a job, never fetched per-request (`SKILL.md` §6):

```bash
.venv/Scripts/python -c "from app import market; market.refresh()"
```

Run it on a timer (cron/Task Scheduler) during the build; `POST /api/market/refresh`
(authenticated) covers on-demand refreshes.

## Category schema

`backend/app/categories.py` is the single source of truth, sized for a normal
person or sole trader rather than company accounting (no Payroll/COGS/AP-department
vocabulary):

- **Expense** (25): Housing, Utilities, Phone & Internet, Groceries, Dining & Cafés,
  Transport, Vehicle, Health, Insurance, Education, Shopping, Entertainment,
  Subscriptions, Travel, Personal Care, Family & Childcare, Pets, Home & Repairs,
  Debt & Loans, Bank Fees, Taxes, Gifts & Donations, Work & Business,
  Savings & Investments, Other
- **Income** (9): **AR** (customer paying back a listed invoice), Salary, Business
  Income, Freelance & Side Work, Interest & Dividends, Refunds & Reimbursements,
  Gifts Received, Benefits & Allowances, Other Income
- **Receivable** (3) and **Payable** (4) equivalents for AR/AP rows

Each category carries keywords, and `classify()` scores vendor + description text
to pick the best fit. It is used in three places:

1. **OCR** — the prompt lists the live taxonomy, then `resolve()` lets the
   classifier overrule a vague model answer when keyword evidence is strong
   (e.g. model says "Work & Business" for `NORTHGATE SUPPLIES` → `Shopping`, with
   a note shown in the review dialog). Labels outside the taxonomy are repaired.
2. **Manual entry** — the category field is a grouped select fed by
   `GET /api/categories`, and typing a vendor auto-suggests the classifier's pick.
3. **Write paths** — `save_manual_transaction` and the OCR confirm gate both coerce
   to the taxonomy, so no out-of-schema category can reach `transactions`.

## OCR troubleshooting

The scan flow is `File[] → POST /api/documents/ocr → detail dialog → POST /api/documents/{id}/confirm`.
If scans fail, the cause is almost always the model, not the pipeline — `notes`
in the response plus the returned `model` name tell you which:

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 429 … rate-limited upstream` | a `:free` model on a shared pool | use a paid model in `OCR_MODEL` (fallbacks cover this) |
| `No endpoints found that support image input` | text-only model (e.g. nemotron) | pick a vision model — check `input_modalities` includes `image` |
| `All OCR models failed: …` | every model in the chain failed | read the joined errors; verify `OPENROUTER_API_KEY` and credits |
| Fields wrong (line item instead of total) | model summed badly | the review dialog shows the notes — edit before confirming; swap `OCR_MODEL` |
| `no answer: hit the N-token budget while reasoning` | **reasoning model** used the whole budget on hidden reasoning, so `content` came back empty | raise `OCR_MAX_TOKENS`, or use a non-reasoning vision model |
| `this model does not support image input` | text-only model | see the table above |

Extracted fields are normalized defensively (`normalize_fields`): dates like
`12 November 2026` → `2026-11-12`, `$410.50` → `410.5`, arrays of line items →
a single total with a review note. Nothing reaches `transactions` until a human
confirms (`reviewed = true`, SKILL.md §4).

`backend/demo_assets/sample_receipt.png` is a ready-made test image.

## Receivables settle themselves (payments close invoices)

Recording money in from a customer who owes you closes that invoice: the AR row
flips to `paid` and drops out of open/overdue totals, so the same money is never
counted as both a receivable and a receipt.

A receivable is unpaid by definition, so an AR/AP row is never created as `paid`:

- The form derives the status instead of offering it: `pending`, or `overdue` once
  the due date has passed (`settlement.initial_status`).
- The same rule is enforced server-side for manual entry and the OCR confirm gate
  (`db._apply_arap_status`), so a client cannot mark an invoice settled by typing
  `status: "paid"` — `paid` is reachable only through settlement.
- Income and expense rows carry no status choice at all: they are money that has
  already moved, so they are saved as `paid`. Money not yet received belongs on the
  AR side of the ledger.
- Customer paybacks are their own income section, **AR**, described as "a customer
  paying back an invoice you already listed". It sits apart from Salary/Business
  Income so a repayment is not counted as new revenue, and the classifier routes
  payback language ("paid back", "repayment", "arrears", "balance owing") to it.

Rules live in `app/settlement.py` (pure, tested in `tests/test_settlement.py`):

- Only a **paid income** row settles anything — a pending income row is a promise.
- Customer names match after normalising case, punctuation, spacing and company
  suffixes (`Oak & Pine` matches `Oak & Pine Co.`); different customers never match.
- Oldest due date first, and only while the payment still covers the invoice. A
  3,200 payment against a 6,400 invoice settles **nothing** — partial payments are
  not modelled, because the schema has no settled-amount column and pretending
  otherwise would corrupt the receivables total.
- One payment can close several invoices when it covers them.

The backend applies this inside the same request that saves the payment and
returns the closed rows as `settled_ar`, for both manual entry and the OCR
confirm gate; the UI reports it ("Saved, and marked 1 invoice from Mesa Retail as
paid"). Guest mode never calls the server, so `src/lib/settlement.ts` mirrors the
same rules on the in-memory ledger.

The schema has no settlement timestamp (it belongs to the Lovable-managed
database), so the income row carries the date of the money and the invoice simply
becomes `paid`.

## Advisor: scope, live search, and a fixed reply shape

Three behaviours are enforced in `app/advisor.py`, not left to prompting alone:

- **Scope.** Answers only cover (1) the owner's own ledger via tools, (2)
  small-business finance and bookkeeping, (3) tax/company-law questions as general
  information, (4) markets and rates that affect planning. Unrelated asks are
  refused *deterministically* by `out_of_scope()` before any model call — no
  search, no cost, no drift into chit-chat.
- **Live search.** Ledger questions run on `ADVISOR_MODELS`; questions about
  rates, markets, tax rules or filing deadlines route to the `:online` chain
  (`ADVISOR_WEB_MODELS`) so OpenRouter runs a web search and returns url
  citations. Those citations are returned in `sources` and rendered under the
  reply. An external answer may quote a searched number with its date and source;
  a ledger number still may not appear without a tool result, and "will rates rise
  tomorrow" is answered as unknowable, with the latest recorded value instead.
- **Reply shape.** Every reply is `Answer` / `Figures` / `Next step` / `Caveat`,
  plain text. `tidy()` strips the asterisks, hashes, backticks and inline
  `[label](url)` links models add anyway, so nothing renders as raw markdown.

`needs_web()`, `out_of_scope()` and `tidy()` are unit-tested in
`tests/test_advisor.py`; the no-API-key fallback answers through the same
template and refuses external questions rather than reciting remembered figures.

## Models: revenue forecast + AR late-payment risk (SKILL.md §11)

Two trained models, both graded against a declared baseline.

| | Model | Baseline | Result |
|---|---|---|---|
| §11.1 Revenue forecast | `LinearRegression` on prior month, 3-month momentum, last month's AR-overdue share, month-of-year | "next month = this month" | MAE **$1,069** vs $1,498 (**28.6%** lower) |
| §11.2 AR late-payment risk | `LogisticRegression` on log amount, days-until-due, the customer's own observed late rate, category | "everyone pays on time" | caught **61/79** late rows vs **0/79**; F1 **0.51**, P 0.38, R 0.77 |

Accuracy is reported but not leaned on: the always-on-time baseline scores 0.72
accuracy while catching nothing, which is exactly why the confusion matrix and
recall are the headline numbers.

### The data is a stored file, not an in-memory generator

```bash
cd backend
python -m ml.generate_training_data   # writes data/*.csv (git-tracked, inspectable)
python -m ml.train_models             # reads those CSVs, writes models/*.joblib + metrics.json
```

`ml/train_models.py` **reads** `data/ar_training.csv`, `data/revenue_training.csv`
(and `fusion_training.csv` for the fusion rows) — it never regenerates them, so the
exact dataset a model saw is a file you can open, diff, or commit. The CSVs and the
fitted artifacts are committed (~145 KB total) so a fresh clone serves real model
output without a training step.

### Ceiling control and honesty (§11.4)

The labels come from a rule we wrote, so the achievable F1 was fixed **before**
training: `EXPECTED_F1_CEILING = 0.85` in `ml/train_models.py`. Observed F1 is far
below it and is reported as-is, with a named failure case for each model in
`models/metrics.json`:

- AR false-safe: `Bluefin Co.`, p(late) 0.09, went late anyway — a reliable customer
  with a one-off cash-flow shock no creation-time feature can see.
- Revenue: 2026-12 actual $14,965 vs predicted $11,930 — a month that moved against
  the trend, which only prior months can't reveal.

Two deliberate anti-cheating measures:

- `customer_reliability_true` (the generative parameter) is **dropped** from the
  stored CSV; the model only gets `customer_historical_late_rate` + `customer_prior_count`
  computed from *prior* rows, so no feature leaks the label.
- The split is chronological (80/20), and the decision threshold is tuned only on
  the last 20% of the **training** window, never on test rows.

### Where they surface

- `GET /api/models/info` — artifacts present + the metrics file.
- `POST /api/forecast` `{transactions}` — next month's revenue, with `baseline_value` beside it.
- `POST /api/ar/risk` `{transactions}` — open AR rows ranked by p(late), with `severity`
  bands (`high` / `medium` / `low`) so the UI separates "chase now" from "watch".
- Dashboard: projection shows the model number *and* the rule-of-thumb baseline; the
  "AR at risk of late payment" panel lists the worst customers with their probability.
- Advisor: the `ar_risk_flags` tool, so "who owes me and might pay late?" is answered
  from the same function the dashboard uses.
- `notebooks/scored_models.ipynb` — the write-up: data inspection, both baselines,
  confusion matrix, coefficient interpretation and the failure cases, all calling
  `ml.train_models` and `app/ml.py` rather than re-implementing anything.

Without artifacts present, `app/ml.py` degrades to a documented rule and says so in
`source`/`method` — it never silently presents a fallback as a model prediction.

## Frontend contract (replaces the stubs in `src/lib/api.ts`)

| Stub | Call |
|---|---|
| `signIn(email, password)` | `POST /api/auth/login` `{email, password}` → `{access_token, refresh_token, user}`; send `Authorization: Bearer <access_token>` on subsequent calls |
| `saveTransaction(t)` | `POST /api/transactions` (transaction JSON; OCR rows are rejected here — use confirm) |
| `runOcr(files[], docType?)` | `POST /api/documents/ocr` (multipart `files`, up to 5 pages) → `{doc_type, fields, notes, model, document_id}`; nothing is saved yet (`reviewed=false`) |
| confirm form save | `POST /api/documents/{document_id}/confirm` `{fields}` → flips `reviewed=true` and writes the transaction in the same server-side call (`SKILL.md` §4 gate) |
| `askAdvisor(q, tx)` | `POST /api/advisor` `{question, transactions}` → `{text, tool, figures:[{label,value}]}`; authenticated users may omit `transactions` (server reads their rows) |
| `sendTestReport(email)` | `POST /api/reports/test` `{email}` → `{sentTo}` |
| categories | `GET /api/categories` → `{expense: [...], income: [...], ar: [...], ap: [...]}`; `POST /api/categories/classify` `{vendor, text, type}` → best-fit category |
| settings | `GET/PUT /api/settings` |
| ledger load | `GET /api/transactions` → `{transactions: [...]}` |
| market color | `GET /api/market/snapshot` → `{fetched_at, indicators, headlines}` |

**Guest mode (`SKILL.md` §8)** stays in the browser session; the backend
enforces it too — every write endpoint returns 401 without a valid Supabase
token. Only the advisor (with client-provided transactions) and the cached
market snapshot are reachable as a guest.

Point the frontend at the backend with a Vite dev proxy (e.g. `/api` →
`http://localhost:8000`) or set a base URL — since the frontend is
Lovable-managed, ask Lovable to wire `src/lib/api.ts` to these endpoints.

## Layout

```
backend/
  app/
    calc.py        # B1 calc layer — pure functions, mirrors src/lib/calc.ts exactly
    advisor.py     # B2 tool-calling advisor; figures only from named tools (§3)
    ocr.py         # A2 OCR pipeline; never writes transactions directly (§4)
    db.py          # data-access layer; confirm gate + guest rule enforced here
    market.py      # B3 snapshot job (yfinance + RSS → market_snapshot)
    reports.py     # C3 report generation + Resend email
    main.py        # FastAPI routes (contract above)
    settlement.py  # payment -> receivable matching rules (pure)
    demo_seed.py   # idempotent demo account (PLAN Hour 30–40)
    config.py      # pinned model IDs + env
    models.py      # pydantic models mirroring src/lib/types.ts
  schema.sql       # apply once in Supabase (not via this repo's migrations)
  ml/
    generate_training_data.py  # §11 synthetic dataset -> data/*.csv (run once)
    train_models.py            # reads data/*.csv, fits, evaluates, writes models/*
  data/            # generated training CSVs (committed so training is reproducible)
  models/          # fitted artifacts + metrics.json (what the app loads)
  tests/test_calc.py    # B1 unit tests vs hand-built fixture with known answers
  tests/test_ml.py      # §11 leakage guard, ranking, fallbacks, ceiling check
  tests/test_settlement.py  # payment/invoice matching rules
  tests/test_advisor.py     # scope guard, reply shape, no markdown in replies

```

`notebooks/scored_models.ipynb` (repo root) is the graded write-up for §11.
