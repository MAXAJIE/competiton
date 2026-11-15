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

## OCR: why the model returns nothing (reasoning budget)

A "no answer: used all N tokens" error is almost never a too-small limit. The
pinned nemotron model is a **reasoning** model: it emits hidden reasoning tokens
before any visible text, and a receipt transcription needs none of that. Measured
on the bundled sample receipt with the real prompt:

| request | reasoning tokens | completion tokens | result |
|---|---|---|---|
| no `reasoning` field | 796 | — | empty `content`, `finish=error` |
| `reasoning.effort=low` | 530 | 574 | JSON, but most of the budget burned |
| `reasoning.effort=minimal` | 3000 | — | empty `content`, `finish=length` |
| `reasoning.enabled=false` | **0** | **66** | correct JSON |

So raising `OCR_MAX_TOKENS` treats the symptom. Instead:

- `OCR_REASONING=off` (default) sends `reasoning: {enabled: false}` on every
  extraction request, so the model answers directly.
- `OCR_MAX_TOKENS` default dropped **3000 → 800** — still ~12x what a full row
  needs, with the automatic 2x retry for long statements. A big budget only hid
  the burn.
- The advisor gets `ADVISOR_REASONING=low` for the same reason: it picks a tool
  and writes a short answer, and reasoning was competing with the tool call.

Both knobs accept `off | low | medium | high` and are unit-tested in
`tests/test_ocr.py` (`build_payload`, `_reasoning_param`). With the switch on, a
two-image scan completes in ~7s instead of failing.

## Scanning: one image in, one entry out

Images are **independent**, not pages of one document. A photo of two receipts is
two transactions; nothing is merged. Upload up to 5 at a time and the dialog walks
them one by one:

    Entry 1 of 3   image 1 | its form   -> "Confirm & save, next"
    Entry 2 of 3   image 2 | its form   -> "Confirm & save, next"
    Entry 3 of 3   logo.png | "could not read this image: not a document"

- `POST /api/documents/ocr` returns `{entries: [...], saved, skipped}` — one
  entry per uploaded image, each with its own `documents` row and therefore its
  own confirm. The human gate stays per entry (SKILL.md §4): the model still
  never writes a transaction.
- Each entry is classified on its own (`resolve_doc_type` per image), so one
  upload can legitimately contain a receipt, an invoice and a bank statement.
- An image that cannot become an entry comes back `ok: false` with a `reason`
  instead of inventing a row. Two cases:
  - the model says `is_document: false` — a logo, product photo, screenshot;
  - the model reads a document but no amount and no vendor, so there is nothing
    to confirm.
  The dialog shows the image, the reason, and a **Next** button; nothing is
  recorded. Saved and skipped images are listed on the final screen.
- Saving one entry no longer affects the others: the form is keyed on the
  document id, so moving to image 2 cannot carry image 1's fields along.

Verified through the live API: a $957 invoice, a $410.50 receipt and a boba logo
uploaded together came back as `saved=2, skipped=1` with the logo reported as
`not a document`, and the invoice confirmed in the browser landed as one AR row
while the logo left no trace.

## Server-owned columns are never written

`transactions.created_at` is `not null default now()`, and the API model now
carries it (the UI sorts Recent entries by it). A plain `model_dump()` therefore
sent `created_at: null` on insert and every confirm failed with
`23502 null value in column "created_at"`. The fix is one helper, not a special
case at each call site:

```python
SERVER_OWNED = ("created_at",)

def write_row(t: Transaction) -> dict:
    """Fields a client may write — id and server-owned columns stripped."""
    return t.model_dump(exclude={"id", *SERVER_OWNED})
```

Both write paths (`save_manual_transaction`, `confirm_document_and_save`) use it,
so the column is left to the database default and still comes back in the
response. `tests/test_settlement.py::test_writes_never_send_server_owned_columns`
fails if a new response-only field is ever added without joining that tuple.

## Nothing is visible-only-if-animation-finishes

The risk settings page rendered its header and footer but a blank middle. The
cards were there — GSAP had set them to `opacity: 0` for a reveal tween that
never ran to completion, and nothing put them back. Two things made that page
the one to notice it: the cards only mount after `GET /api/settings` resolves,
so the page's `MutationObserver` animates them later, and a tween that stalls
(a background/frozen tab, a route change killing it mid-flight) leaves the
inline `opacity: 0` behind for good.

Content must not depend on an animation finishing, so there are now three
independent guarantees in `src/lib/reveal`-land:

- `Page` skips the entrance timeline entirely when `document.visibilityState`
  is `hidden`, and finishes anything it started when the tab becomes visible.
- The async-mount path (`.widget-surface` cards) does not animate while hidden.
- `src/lib/motion.ts` runs a 2s sweep: any reveal target still at inline
  `opacity: 0` with no active tween gets its opacity cleared, so CSS decides.
  Timers still fire in a hidden tab even though rAF does not, which is why the
  sweep is a timer rather than a ticker.

The sweep only touches elements that are genuinely stuck — it skips anything
with a running tween, so normal entrances are unaffected. Verified by stranding
a settings card (`opacity: 0`, no tween): the sweep restored it within a cycle,
and the page now shows both cards with live values (threshold 1.5 months,
current runway 1.1 mo).

## Risk: late is a fact once it is late

The AR classifier answers one question — *will this invoice be paid after its due
date?* For a row that is already past due, that question has been answered: the
probability is 1, not a guess. The old code fed `days_until_due` straight in, so
an invoice **401 days late scored 52%** (the model extrapolating far outside the
-60..+90 range it was trained on). Reading "52%" for a 401-day-old debt is worse
than useless — it looks like reassurance.

Now (`ml.ar_risk_flags`):

- `already_late` is true when `status == "overdue"` **or** `due_date` has passed,
  so a stale status cannot hide a late invoice.
- Those rows get `p_late = 1.0`, `severity = "high"`, and `days_overdue`.
  The classifier's own output is still reported, in `model_p_late`, so nothing
  is hidden — it simply is not the risk figure.
- Rows not yet due keep the model probability unchanged.

Ranking had to change with it, because "all overdue = 100%" would otherwise make
"who to chase first" meaningless:

| group | ordering key |
|---|---|
| already late | `amount × days overdue` (exposure) |
| not yet due | `p_late × amount` (expected value at risk) |

Overdue rows always precede forecasts: money already late beats money that might
be. Each row carries the computed `priority`, and the API also returns
`overdue_count` / `overdue_amount` alongside `predicted_high_count` /
`predicted_high_amount`, so the UI can say *"3 already overdue — $11,700; the
other flagged row ($5,200) is not yet due — that percentage is the model's
forecast"* instead of lumping certainties in with predictions.

Pinned by five tests: overdue is 1.0 with the model number kept separately, a
pending row keeps its probability, a stale `pending` status past its due date is
still caught, overdue rows outrank a forecast, and the summary separates the two.

## Where a saved scan shows up

A confirmed entry is a normal transaction, so it appears everywhere a manual one
does. Two things made scans look like they were not recorded:

- **"Recent entries" is now ordered by when a row was recorded**, not by the date
  printed on the document. Scanning your July invoice therefore puts it at the
  top of the list instead of below months of activity. `transactions.created_at`
  is returned by the API (the Pydantic model used to drop it) and the list falls
  back to `transaction_date` for rows that predate it.
- Scanned rows carry a small **scanned** tag in that list, so the source is
  visible without opening History.

History keeps its chronological sort — it is a ledger, and a back-dated invoice
belongs in July. The link under Recent entries now goes to History ("View full
history") rather than back to the dashboard.

## One forecast number everywhere

The overview card, `/api/forecast` and the Insights page now agree, because the
card asks the backend. It used to run the client-side trailing average while
Insights showed the trained regression, so two different numbers described the
same month (e.g. $22,060 vs $20,521).

- `POST /api/forecast` is the source of truth when there is a session.
- The trailing average is still computed, but only as a labelled fallback: it is
  what you see offline or as a guest, and it is printed as "Trailing 3-month
  average: $X" beneath the model figure so the difference is explicit rather
  than a contradiction.

## Document type: the page decides, not the file name

An invoice uploaded as `image.png` used to be read as a receipt, because the only
signal was the file name — and photo names ("image.png", `IMG_4821.jpg`) are not
evidence. Type resolution now runs in this order (`ocr.resolve_doc_type`):

1. **What you picked** in the dialog — a deliberate choice, never overridden.
2. **What the model read on the page** — "Invoice", an invoice number, "Billed
   to", line items with a total.
3. **A keyword in the file name** (`resolve_doc_type` falls back here only when
   the page gave nothing usable).
4. `receipt`, only if none of the above.

With no type selected the prompt is an auto-detect one: it asks the model to
classify first and offers all four category lists. When the reading contradicts
the file name the review panel says so ("Read as an invoice from the page itself
(the file name suggested a receipt)"), and an invoice never lands in a generic
category — it becomes **Customer Invoice** (AR) or **Supplier Bill** (AP). The
AR/AP side is genuinely ambiguous from one page, so it is flagged for you to
switch rather than presented as fact.

Verified on a real 4-line invoice ($957, dated 30 July 2025): detected as
`invoice`, correct date and total, category "Customer Invoice" — where the same
file named `image.png` previously came back as a receipt. A receipt uploaded as
`invoice-march.pdf` still reads as a receipt.

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

## Keeping the backend always on (no tunnel)

A tunnel dies with your laptop. For an always-on backend, deploy the FastAPI
process to any container host; `backend/Dockerfile` is ready for Railway,
Render or Fly.io and binds the host-assigned `PORT` automatically. Verified
locally with the same command the container runs: health, login and the ledger
all answer with `PORT` set.

Railway (fastest path):

1. Push the repo (the model artifacts are committed, so scoring works on first
   boot — no training step on the host).
2. New project → Deploy from repo → it detects `backend/Dockerfile` (set the
   service's root directory to `backend/` if asked).
3. Add variables in the dashboard — the same names as `backend/.env`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
   `OPENROUTER_API_KEY`, plus the model pins if you want non-defaults. Generate
   a domain: you get a permanent `https://…up.railway.app` URL.
4. Point the frontend at it: set `VITE_API_URL=https://…up.railway.app` in the
   Cloudflare **build** settings and redeploy (see the section below).

Render works the same (new Web Service → Docker → root dir `backend`). Note the
free tier sleeps after inactivity, so the first request after a pause waits
~30–60s while the container wakes; paid tiers or Railway remove that.

Health checks: `GET /api/health` returns `{"ok": true}` — wire the host's
health check to it.

**Secrets stay in the host's dashboard.** `backend/.env` is git-ignored and
Docker-ignored on purpose; the container reads everything from real env vars
(`app/config.py` uses `load_dotenv` only as a local convenience — absent `.env`,
environment wins).

### Build fails with "lockfile had changes, but lockfile is frozen"

Cloudflare picks its package manager by lockfile. This repo is npm
(`package-lock.json`); a stale `bun.lock` (one that predates a dependency in
`package.json`) makes Cloudflare choose bun, and `bun install --frozen-lockfile`
then refuses to resolve. Fix: keep only the lockfile you actually use — delete
the stale one and push. If you regenerate any lockfile (`npm install` /
`bun install`), commit it in the same change as the `package.json` edit so the
two never drift.

## Deploying the frontend (Cloudflare Workers / Pages)

"Failed to fetch" on a deployed site is one thing, every time: **the browser is
calling a URL that is not reachable from where it runs.** Vite bakes
`VITE_API_URL` into the bundle at *build* time, and the fallback is
`http://localhost:8000`. On the machine running uvicorn that works; on a
deployed `https://` site it cannot — the browser blocks plain `http://`
(mixed content), and even without that, `localhost` would be the *visitor's*
machine, not yours.

So a deployed site needs:

1. **The backend reachable over HTTPS.** It is a normal FastAPI process — it
   does not run inside Workers. Two ways:
   - quick test: `cloudflared tunnel --url http://localhost:8000` gives a
     temporary `https://*.trycloudflare.com` URL while your machine is on;
   - properly: deploy `backend/` (uvicorn) to Railway / Render / Fly.io with
     `OPENROUTER_API_KEY` etc. set in that host's dashboard — from
     `backend/.env`, never from the repo.
2. **`VITE_API_URL` set to that https:// URL at build time**, e.g. in the
   Cloudflare build settings (plus `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` — without them auth is disabled by design), then
   rebuild and redeploy. Changing Cloudflare's runtime env vars does not help;
   only a rebuild bakes them in.
3. CORS is already `allow_origins=["*"]`, so no backend change is needed.

**About the keys.** There are two `.env` files and they follow the site:

- frontend `.env.local` (`VITE_*`) — public by design (Supabase URL + anon
  key, backend URL). Baked into the bundle at build time.
- `backend/.env` (`OPENROUTER_API_KEY`, OCR/advisor model pins, Resend…)
  — server-only. It must live wherever the backend runs; it never ships to the
  browser, and moving the frontend does not move it.

When the backend is unreachable the UI now says so with the URL it tried
("Could not reach the backend at http://localhost:8000. A deployed site needs
VITE_API_URL set to a https:// backend URL at build time…") instead of the
browser's bare "Failed to fetch".

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
