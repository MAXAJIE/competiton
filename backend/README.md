# How CashMonitoring works

This is the design/architecture document for the app: where data lives, which
layer owns which rule, and why the tricky parts are built the way they are.
**Setup and run instructions are in [`../README.md`](../README.md)** — this file
assumes the app is already running.

---

## 1. The system in one picture

```
┌───────────────────────── browser ─────────────────────────┐
│  TanStack Start + React 19 + Tailwind 4                   │
│                                                           │
│  routes/           screens (dashboard, entry, history,    │
│                    advisor, insights, settings, login)    │
│  lib/calc.ts       money math (guest mode)                │
│  lib/store.tsx     in-memory ledger + auth state          │
│  lib/api.ts        the only network door                  │
│  lib/settlement.ts payment → invoice matching (guest)     │
└───────────────┬───────────────────────────────────────────┘
                │  fetch JSON  (Bearer <Supabase access token> when signed in)
┌───────────────▼───────────────────────────────────────────┐
│  FastAPI  (backend/app)                                   │
│    main.py       routes + auth dependency                  │
│    calc.py       money math (authoritative)                │
│    settlement.py payment → invoice matching                │
│    db.py         every read/write + the two hard gates     │
│    ocr.py        image → draft entry (never saves)         │
│    advisor.py    question → tool call → answer             │
│    ml.py         trained models + honest fallbacks         │
│    market.py     scheduled snapshot job                    │
│    reports.py    cash report text + Resend email           │
└──────┬───────────────┬───────────────┬────────────────────┘
       │               │               │
  Supabase         OpenRouter      yfinance + RSS   Resend
  (Postgres,       (vision model   (market job)     (email)
   Auth, Storage)   + LLM)
```

Two rules explain most of the code:

1. **The server is the source of truth for money.** The browser may compute for
   guest mode, but a signed-in figure always comes from the API.
2. **Nothing the model produces is trusted.** OCR needs a human confirm; the
   advisor may only quote numbers that came out of a named function.

## 2. Two runtime modes

| | Guest (**Explore as guest**) | Signed in |
|---|---|---|
| Where data lives | Browser memory (`lib/store.tsx` + `lib/demo-data.ts`) | Supabase Postgres rows |
| Who computes figures | `src/lib/calc.ts` | `backend/app/calc.py` (via API) |
| Network calls | None | FastAPI on `:8000` → Supabase |
| OCR / advisor | Unavailable (needs a server) | Available |
| Survives refresh | No — reseeded on demand | Yes |

The backend enforces the same boundary structurally, not with a hidden button:
every write endpoint calls `require_user()` and returns **401** without a valid
Supabase token. Only the advisor (with client-supplied transactions), the
cached market snapshot and the model/registry endpoints are reachable by a
guest.

The two implementations are deliberately mirrored — `calc.ts` ↔ `calc.py`,
`settlement.ts` ↔ `settlement.py` — so the demo and the real account never
disagree about what "runway" or "overdue" means. If you change one, change the
other.

### Google sign-in setup (Supabase dashboard)

Google login needs no backend code: the browser completes the PKCE flow with
`@supabase/supabase-js` and the backend only validates the resulting access
token (`supabase.auth.get_user`), so it stays provider-agnostic.

1. Google Cloud Console → APIs & Services → Credentials → create an **OAuth
   client ID** (type: *Web application*).
2. Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → Google: enable it, paste the client
   ID + secret.
4. Supabase → Authentication → URL Configuration: set Site URL to your dev
   origin (`http://localhost:8080`) and add every origin you actually use to
   Redirect URLs — the dev port is whatever Vite prints (`8080`, sometimes
   `5199`).

Two failures land on `ERR_CONNECTION_REFUSED` at `localhost:54321` (the Supabase
CLI port), and neither is a Google problem:

- **The build had no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.** Both are
  baked in at build time. A build without them used to create a client pointing
  at the CLI port; it now refuses instead — the button reports "Google sign-in is
  not configured in this build…" and the console names the missing variable. On
  Cloudflare, set them in the **build** settings (with `VITE_API_URL`) and
  redeploy; runtime variables are not enough.
- The origin you sign in from is missing from Supabase → URL Configuration.

## 3. Three walkthroughs

### 3a. Manual entry (`POST /api/transactions`)

1. Route resolves the user from the `Authorization` header
   (`db.user_id_from_token` → Supabase `auth.get_user`). No token → 401.
2. `write_row()` strips `id` and every **server-owned** column, then the user id
   is attached.
3. `categories.coerce()` forces the category into the shared taxonomy, so no
   out-of-schema label can reach the database.
4. `_apply_arap_status()` decides the status instead of trusting the client:
   income/expense are `paid`, AR/AP are `pending` or `overdue`
   (`settlement.initial_status`). `paid` on a receivable is not writable.
5. The row is inserted with the service client, always filtered by `user_id`.
6. `_settle_receivables()` looks for invoices this payment closes and flips them
   to `paid`.
7. The response is the saved row plus `settled_ar: [{id, vendor_or_customer,
   amount}]` so the UI can say *"Saved, and marked 1 invoice from Mesa Retail as
   paid"*.

`source: "ocr"` is rejected here on purpose — scanned rows must go through the
confirm gate below.

### 3b. Receipt scan (`POST /api/documents/ocr` → `…/{id}/confirm`)

```
files[] ─► per image: vision model ─► resolve type ─► normalize fields
        ─► documents row (reviewed = false)  ── nothing in transactions yet
        ─► human edits the form ─► confirm ─► transactions row + reviewed = true
```

* **Images are independent, not pages.** Two receipts in one photo are two
  entries; up to 5 per upload, each with its own `documents` row, its own form
  and its own confirm. Nothing is merged.
* An image that cannot become an entry returns `ok: false` with a `reason`
  (a logo → `is_document: false`; a blurry page → no amount and no vendor) and
  leaves no trace, instead of inventing a row.
* `confirm_and_save()` is the **only** OCR → `transactions` path: it refuses an
  unknown document, refuses one already reviewed, inserts the transaction and
  sets `reviewed = true` in the same call. Then the same settlement rule runs.

### 3c. Advisor question (`POST /api/advisor`)

1. `out_of_scope()` refuses unrelated asks **before** any model call — no cost,
   no drift into chit-chat.
2. `needs_web()` decides the model chain: ledger questions use
   `ADVISOR_MODELS`; rates, tax rules, deadlines and market questions use
   `ADVISOR_WEB_MODELS` (`:online`), which returns URL citations.
3. The model may call one of five tools (below). Up to three rounds.
4. **No tool call → no figures.** The reply is the standard refusal, so a
   plausible number can never be hallucinated onto the screen.
5. `tidy()` strips markdown the model adds anyway; replies always read
   `Answer` / `Figures` / `Next step` / `Caveat`.

## 4. Data model

`backend/schema.sql`, applied once in Supabase (Lovable owns schema changes —
see `AGENTS.md`).

| Table | Holds | Notes |
|---|---|---|
| `transactions` | the ledger | `type` ∈ income/expense/ar/ap, `status` ∈ paid/pending/overdue, `source` ∈ manual/ocr, optional `document_id`, `created_at` (server default) |
| `documents` | one row per scanned image | `doc_type`, `ocr_raw_json`, `reviewed` — the human gate lives here |
| `risk_settings` | runway threshold, AR-spike %, warning email, enabled | one row per user |
| `market_snapshot` | `indicators_json` + `headlines_json` | written by the job, read by everyone |
| `profiles` | business name | created with the user |

All user tables have **row-level security** scoped to `auth.uid()`, and every
server-side query is additionally filtered by `user_id`. The API uses the
service key server-side (never shipped to the browser); the anon key is only
used to validate tokens and to sign in (`client(service=False)`).

**Server-owned columns are never written.** `created_at` is `NOT NULL DEFAULT
now()` but also present in the response model, so a plain `model_dump()` sent
`created_at: null` and every insert died with `23502 null value in column
"created_at"`. One helper fixes every write path:

```python
SERVER_OWNED = ("created_at",)

def write_row(t: Transaction) -> dict:
    """Fields a client may write — id and server-owned columns stripped."""
    return t.model_dump(exclude={"id", *SERVER_OWNED})
```

`tests/test_settlement.py::test_writes_never_send_server_owned_columns` fails if
a future response-only field is added without joining that tuple.

## 5. Module map

| File | Responsibility | Rule it owns |
|---|---|---|
| `main.py` | FastAPI routes, CORS, auth dependency | guest rule at the edge |
| `models.py` | Pydantic shapes mirroring `src/lib/types.ts` | one wire format |
| `calc.py` | pure money functions, no I/O | the definition of balance/runway/aging |
| `settlement.py` | payment → invoice matching, pure | when a receivable becomes `paid` |
| `db.py` | Supabase access | status derivation, confirm gate, settlement trigger |
| `ocr.py` | image → draft, prompt, normalization | type resolution, "never writes" |
| `advisor.py` | tool-calling advisor | scope guard, no figures without tools |
| `ml.py` | loads `models/*.joblib`, scores rows | model-or-named-fallback, overdue = fact |
| `categories.py` | category taxonomy + keyword classifier | the only allowed labels |
| `market.py` | snapshot job (yfinance + RSS) | data cached, never fetched per request |
| `reports.py` | cash report text + Resend send | never fake a send |
| `config.py` | env + pinned model IDs + reasoning knobs | one place for model selection |
| `demo_seed.py` | idempotent demo account | resets before inserting |

## 6. Money rules (`calc.py`)

All of it is pure: takes transactions, returns numbers. Same shape as
`src/lib/calc.ts`.

| Figure | Definition | Deliberate choice |
|---|---|---|
| Cash balance | paid income − paid expense | the schema has no opening balance, so a fresh account reports **0**, never a fabricated starting figure |
| Monthly series | income/expense per `YYYY-MM`, sorted | AR/AP excluded — money that hasn't moved yet isn't flow |
| Average burn | mean expense of the last 3 months with data | trailing, so a one-off month can't set the baseline alone |
| Runway (months) | cash ÷ average burn | `None` when there is no burn yet, so the dashboard shows “—” instead of dividing by zero |
| AR / AP totals | open rows only (`status != paid`) | settled invoices drop out of the totals immediately |
| AR overdue | open rows with `status = overdue` | what the warning banner is about |
| Aging | `current`, `1-30`, `31-60`, `60+` by `due_date` | buckets, not an average age |
| Statement | trailing 12 months of income/expense | plus expenses grouped by category, sorted |

`calc.predict_next_month_revenue()` and `calc.get_ar_risk_flags()` delegate to
`ml.py`, so the dashboard, the API, the advisor tool and the notebook print the
same number — there is exactly one implementation.

## 7. Settlement: a payment closes the invoice

A sole trader records *"Mesa Retail paid me 6,400"* as income. The listed
invoice for 6,400 should stop being "awaiting payment", or the same money is
counted twice: once as a receivable and once as cash.

`settlement.settleable(tx, payment)` returns the rows to close:

* Only a **paid `income`** row settles anything — a pending income row is a
  promise, not money.
* Customer names match after normalising case, punctuation, spacing and company
  suffixes (`Oak & Pine` matches `Oak & Pine Co.`); a shorter name may match as
  a prefix once it is at least 6 characters (`PREFIX_MIN`), so `A` matches
  nothing.
* Amounts must cover the invoice, within `AMOUNT_TOLERANCE = $1`.
* Oldest due date first: it walks the matching invoices and **skips any that
  are bigger than what is left** of the payment, so a smaller newer invoice can
  still be closed. One payment can close several invoices.
* **Partial payments are not modelled.** A 3,200 payment against a 6,400 invoice
  settles nothing: the schema has no settled-amount column, and pretending
  otherwise would corrupt the receivables total.

Enforced server-side in `db._settle_receivables`, called by both the manual and
the OCR write paths. The schema has no settlement timestamp, so the income row
carries the date the money arrived and the receivable simply becomes `paid`.

## 8. OCR pipeline (`ocr.py`)

`run_ocr()` loops over the uploaded images and, for each one:

1. **Send it to a vision model** (`OCR_MODELS` = primary + fallbacks) with a
   prompt that contains the live category taxonomy.
2. **Decide the document type** — `resolve_doc_type`, in this order:
   1. what the user picked in the dialog (never overridden),
   2. what the model read on the page ("Invoice", an invoice number, "Billed
      to"),
   3. a keyword in the file name,
   4. `receipt`.
   File names are weak evidence: `image.png` and `IMG_4821.jpg` say nothing, and
   trusting them made invoices land as receipts.
3. **Normalize the fields** (`normalize_fields`): `12 November 2026` →
   `2026-11-12`, `$410.50` → `410.5`, a list of line items → one total plus a
   review note, missing/extra keys dropped. Every correction becomes a `note`
   the reviewer sees — nothing is silently invented.
4. **Repair the category** through the same classifier the entry form uses, so
   a vague model answer can be corrected by keyword evidence (`NORTHGATE
   SUPPLIES` → `Shopping`, with a note explaining the override).
5. **Store the draft** as a `documents` row with `reviewed = false`. The image
   is uploaded to the `documents` bucket when possible; review never depends on
   it.

Nothing reaches `transactions` until a human confirms. An invoice-type read
becomes **Customer Invoice** (AR) or **Supplier Bill** (AP); the AR/AP side is
genuinely ambiguous from one page, so the dialog flags it for the user to switch
rather than presenting a guess as fact.

### Why the vision model sometimes returned nothing

The pinned model was a **reasoning** model: it emits hidden reasoning tokens
before any visible text, and a receipt transcription needs none of that.
Measured on the bundled sample receipt with the real prompt:

| Request | Reasoning tokens | Completion tokens | Result |
|---|---|---|---|
| no `reasoning` field | 796 | — | empty `content`, `finish=error` |
| `reasoning.effort=low` | 530 | 574 | JSON, but most of the budget burned |
| `reasoning.effort=minimal` | 3000 | — | empty `content`, `finish=length` |
| `reasoning.enabled=false` | **0** | **66** | correct JSON |

So raising `OCR_MAX_TOKENS` treats the symptom. Instead `OCR_REASONING=off`
(default) sends `reasoning: {enabled: false}`, and the budget dropped
3000 → **800** tokens (still ~12× a full row, with a 2× automatic retry for long
statements). The advisor got `ADVISOR_REASONING=low` for the same reason:
reasoning was competing with the tool call. Both knobs take
`off | low | medium | high` and are unit-tested via `build_payload` and
`_reasoning_param`.

### Reading a failure

`notes` + the returned `model` name say which layer failed:

| Message | Meaning |
|---|---|
| `HTTP 429 … rate-limited upstream` | a `:free` model on a shared pool — fallbacks cover it, or use a paid model |
| `No endpoints found that support image input` | text-only model chosen — `OCR_MODEL` must accept images |
| `All OCR models failed: …` | every model in the chain failed; check the key and credits |
| `this model does not support image input` | same as above, reported by one model |
| wrong fields (line item instead of total) | the model misread — edit before confirming, or change `OCR_MODEL` |

`backend/demo_assets/sample_receipt.png` is a ready-made test image.

## 9. Advisor (`advisor.py`)

Five tools, all backed by the calc layer — the model picks, it never computes:

| Tool | Answers | Backed by |
|---|---|---|
| `analyze_cash_flow` | balance, burn, runway | `calc.get_*` |
| `ar_risk_flags` | who pays late, who to chase | `ml.ar_risk_flags` |
| `ar_ap_summary` | open receivables/payables, aging | `calc.get_ar_ap_summary` |
| `generate_financial_statement` | income statement for a period | `calc.generate_financial_statement` |
| `predict_next_month_revenue` | next month's revenue | `ml.predict_next_month_revenue` |

* **Scope** is limited to: your own ledger, small-business finance/bookkeeping,
  tax and company law as general information, and market context that affects
  planning. Everything else is refused deterministically (`out_of_scope`) with
  no model call.
* **Live search** — external questions go to the `:online` chain and citations
  come back in `sources`, rendered under the reply. A searched figure may be
  quoted with its date and source; a *ledger* figure still may not appear
  without a tool result. "Will rates rise tomorrow?" is answered as unknowable,
  with the latest recorded value instead.
* **Reply shape** — `Answer` / `Figures` / `Next step` / `Caveat`, plain text.
* **No API key** → `_deterministic_answer` answers through the same templates
  and refuses external questions rather than reciting remembered numbers.
* Empty ledger → says there is nothing to calculate (`NO_DATA`), rather than
  erroring or inventing rows.

## 10. Trained models (`ml.py`, `ml/`, `models/`)

Two models, each graded against a declared baseline.

| | Model | Features | Baseline | Held-out result |
|---|---|---|---|---|
| Revenue forecast | `LinearRegression` | prior month, 3-month momentum, last month's AR-overdue share, month-of-year (sin/cos) | "next month = this month" | MAE **$1,069** vs $1,498 (**28.6%** better) |
| AR late-payment risk | `LogisticRegression` | log amount, days-until-due, customer's own observed late rate + prior count, category one-hots | "everyone pays on time" | caught **61/79** late rows vs **0/79**; F1 0.51, P 0.38, R 0.77 |

Accuracy is reported but not leaned on: the always-on-time baseline scores 0.72
accuracy while catching nothing, which is why recall and the confusion matrix
are the headline numbers.

**Data is a committed file, not an in-memory generator.**
`ml/generate_training_data.py` writes `data/*.csv`; `ml/train_models.py` only
*reads* those CSVs. The exact dataset a model saw is a file you can open, diff
or commit, and a fresh clone serves real model output with no training step.

**Leakage guards.** The generative parameter `customer_reliability_true` is
dropped from the CSV; the model only gets statistics computed from *prior* rows.
The split is chronological (80/20) and the decision threshold is tuned on the
last 20% of the **training** window, never on test rows. `EXPECTED_F1_CEILING =
0.85` is declared in `train_models.py` before training, and the observed F1 is
reported far below it, with a named failure case per model in
`models/metrics.json` (e.g. a reliable customer who went late after a one-off
shock no creation-time feature could see).

**Overdue is a fact, not a forecast.** Asking "will this invoice be paid late?"
about something already 401 days past due has an answer: 1. Feeding
`days_until_due = -401` to a model trained on −60…+90 produced "52%" — which
reads as reassurance. So `already_late = status == "overdue" or due_date has
passed` forces `p_late = 1.0`, `severity = "high"`, and exposes the model's own
number separately as `model_p_late`. Ranking follows: overdue rows by exposure
(`amount × days overdue`), everything else by expected value
(`p_late × amount`), overdue group always first — otherwise "who to chase first"
would be meaningless once every overdue row is 100%.

**Degradation is named, never silent.** Missing artifacts → documented rules
(`fallback_trailing_average`, `fallback_rule`) and `source`/`method` say so.

## 11. Category taxonomy (`categories.py`)

One taxonomy, 25 expense + 9 income + 3 receivable + 4 payable labels, sized for
a person rather than a finance department. Each label carries keywords, and
`classify(vendor, text, type, amount)` scores them to pick a best fit. It is used
in three places:

1. **OCR** — the prompt lists the live taxonomy, and `resolve()` lets keyword
   evidence overrule a vague model answer (with a note shown in the dialog).
2. **Manual entry** — the form's grouped select is fed by `GET /api/categories`,
   and typing a vendor auto-suggests the classifier's pick.
3. **Every write path** — `save_manual_transaction` and the OCR confirm gate
   both coerce to the taxonomy, so no out-of-schema label can reach the table.

Customer paybacks get their own income section, **AR** ("a customer paying back
an invoice you already listed"), so a repayment is never counted as new revenue.

## 12. Market snapshot job (`market.py`)

Indicators (US 10Y, VIX, DXY, WTI) via `yfinance` plus a handful of headlines
from a fixed RSS set, written to `market_snapshot` by a **job** — never fetched
per request, so a page load can't depend on a third party being up. One bad
ticker or feed is skipped, never fatal.

The advisor receives it as **labelled qualitative context only**: a headline can
be mentioned, but no figure from the snapshot is ever attached to a calculated
answer.

## 13. Reports and email (`reports.py`)

`generate_report()` formats the same calc figures (balance, runway, AR/AP,
aging) into plain text and adds the risk-vault warnings:

* runway below `low_cash_threshold_months`;
* overdue AR above `ar_overdue_spike_pct` of open AR.

Sending uses Resend's HTTP API. With no `RESEND_API_KEY` the endpoint returns
**503** — the button never pretends an email went out.

## 14. HTTP surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | liveness |
| `GET /api/categories` | — | the taxonomy for the form |
| `POST /api/categories/classify` | — | best-fit label for vendor/text |
| `POST /api/auth/login` | — | Supabase email/password → tokens |
| `GET /api/transactions` | user | the ledger |
| `POST /api/transactions` | user | manual entry (returns `settled_ar`) |
| `POST /api/documents/ocr` | user | up to 5 images → draft entries, nothing saved |
| `POST /api/documents/{id}/confirm` | user | the only OCR→ledger path |
| `POST /api/advisor` | guest ok | question → answer (server reads the ledger when signed in) |
| `GET /api/settings` / `PUT /api/settings` | user | risk vault |
| `POST /api/reports/test` | user | generate + send the cash report |
| `GET /api/models/info` | — | which artifacts are loaded + metrics |
| `POST /api/forecast` | guest ok | next-month revenue (+ baseline) |
| `POST /api/ar/risk` | guest ok | scored open invoices |
| `GET /api/market/snapshot` | — | cached indicators + headlines |
| `POST /api/market/refresh` | user | run the snapshot job now |

Without a token the write endpoints return 401; the read-only ones above work
for everyone, which is what makes guest mode possible.

## 15. Tests

`pytest` runs the pure layers — no network, no keys, 75 tests.

| File | Locks down |
|---|---|
| `test_calc.py` | balance, burn, runway, aging against a fixture with hand-checked answers |
| `test_settlement.py` | matching rules, partial payments settling nothing, settlement in both write paths, server-owned columns |
| `test_ocr.py` | type resolution order, normalization, reasoning knobs, unreadable images |
| `test_ml.py` | ranking, overdue = 1.0, leakage guards, fallbacks, F1 ceiling |
| `test_advisor.py` | scope guard, reply shape, markdown stripping |
| `test_categories.py` | taxonomy integrity + classifier behaviour |

## 16. Deliberate limits

These are decisions, not gaps — each keeps a number honest:

* **No partial payments** — the schema has no settled-amount column.
* **No opening balance** — cash is derived from the ledger only, so a fresh
  account reports 0.
* **Single currency (USD)** — no FX conversion.
* **A receivable can't be born `paid`** — `paid` is reachable only through
  settlement.
* **The client never recomputes money for signed-in users** — one implementation
  (`calc.py`), mirrored in `calc.ts` only for guest mode.
* **OCR never writes the ledger** — the human confirm is the only path.
* **The advisor never states a figure without a tool result.**
* **A missing model artifact is reported as a fallback**, never disguised as a
  prediction.
* **A missing email key is a 503**, never a fake success.

## 17. Deploying it

### Backend container

A tunnel dies with your laptop, so an always-on backend is a container:
`backend/Dockerfile` binds the host-assigned `PORT` and runs uvicorn, and
`.dockerignore` keeps `.env`, `.venv`, caches and tests out of the image.

Railway is the fastest path:

1. Push the repo — the model artifacts are committed, so scoring works on first
   boot with no training step on the host.
2. New project → Deploy from repository; it detects `backend/Dockerfile` (set the
   service root directory to `backend/` if asked).
3. Add the variables from `backend/.env` in the dashboard: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `OPENROUTER_API_KEY`, plus the
   model pins for non-defaults. Generate a domain → a permanent
   `https://…up.railway.app` URL.
4. Point the frontend at it (next subsection).

Render (new Web Service → Docker → root directory `backend`) works the same; its
free tier sleeps, so the first request after a pause waits ~30–60 s. Wire the
host's health check to `GET /api/health`, which answers `{"ok": true}`.

Secrets stay in the host dashboard. `backend/.env` is git- and docker-ignored on
purpose: `app/config.py` calls `load_dotenv()` only as a local convenience, and
real environment variables win when no file is present.

### Frontend build variables (Cloudflare Workers / Pages)

"Failed to fetch" and the app's own "Could not reach the backend at
http://localhost:8000" have one cause: the browser is calling a URL it cannot
reach. Vite bakes `VITE_API_URL` into the bundle at **build** time and falls back
to `localhost:8000`, which on a deployed `https://` site is both mixed content
and the visitor's own machine.

1. The backend must be reachable over HTTPS — deploy it as above (a
   `cloudflared tunnel --url http://localhost:8000` URL is fine for a quick
   test while your machine is on).
2. Set `VITE_API_URL` to that `https://` URL in Cloudflare's **build** settings,
   together with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — without the
   last two, auth is disabled by design — then rebuild and redeploy. Runtime
   variables do not apply; only a rebuild bakes them in.
3. CORS needs nothing: the API answers with `allow_origins=["*"]`.

Both `.env` files follow the site they belong to: the frontend's `.env.local`
(`VITE_*`, public by design, baked into the bundle) and `backend/.env`
(server-only keys that never ship to the browser).

### Build fails with "lockfile had changes, but lockfile is frozen"

Cloudflare picks a package manager by lockfile. This repo is npm
(`package-lock.json`); a stale `bun.lock` makes Cloudflare choose bun, and
`bun install --frozen-lockfile` then refuses to resolve. Keep only the lockfile
you actually use, and commit any regeneration together with the `package.json`
change that caused it.

## 18. Layout

```
backend/
  app/
    main.py         routes, CORS, auth dependency
    config.py       env vars, pinned models, reasoning knobs
    models.py       pydantic models mirroring src/lib/types.ts
    calc.py         pure money math (mirrors src/lib/calc.ts)
    settlement.py   payment → invoice matching (pure)
    categories.py   taxonomy + keyword classifier
    db.py           Supabase access, status rules, confirm gate
    ocr.py          image → draft entry
    advisor.py      tool-calling advisor
    ml.py           model loading, forecast, AR risk
    market.py       snapshot job
    reports.py      report text + Resend
    demo_seed.py    idempotent demo account
  ml/
    generate_training_data.py   synthetic dataset → data/*.csv
    train_models.py             reads CSVs, fits, evaluates → models/*
  data/             committed training CSVs
  models/           ar_risk.joblib, revenue_forecast.joblib, metrics.json
  tests/            pure-layer test suite (75 tests)
  schema.sql        Supabase schema + RLS policies
  demo_assets/      sample_receipt.png for manual testing

src/
  routes/           dashboard, entry, history, advisor, insights, settings, login
  components/       UI + GSAP motion components
  lib/              api client, calc rules, store, demo data, settlement, motion
  test/             vitest suites

notebooks/scored_models.ipynb   graded model write-up (calls ml/, doesn't re-implement)
```
