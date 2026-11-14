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
- **Income** (8): Salary, Business Income, Freelance & Side Work, Interest & Dividends,
  Refunds & Reimbursements, Gifts Received, Benefits & Allowances, Other Income
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
    demo_seed.py   # idempotent demo account (PLAN Hour 30–40)
    config.py      # pinned model IDs + env
    models.py      # pydantic models mirroring src/lib/types.ts
  schema.sql       # apply once in Supabase (not via this repo's migrations)
  tests/test_calc.py  # B1 unit tests vs hand-built fixture with known answers
```
