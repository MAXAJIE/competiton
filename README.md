# CashMonitoring — the one-person finance desk

Runway, next-month revenue, and late-payer risk for a solo owner, in one screen.

A React + FastAPI app where a freelancer or shop owner logs income, expenses,
invoices and bills (or snaps a receipt and confirms the OCR draft) and gets back
the three answers that actually matter each week: **how many months of cash do I
have left**, **what will next month bring in**, and **who should I chase first**.

**Team LXVII** — Ling Jie Chin, Yong Ni Ang, Deebak s/o Ramesh Babu (SMK Taman
Johor Jaya 2) · Track: **AI + Finance**

> **Research and educational project. Not financial, tax or legal advice.** See
> [Disclaimer](#disclaimer).

---

## 🚀 Try it — one click, nothing to install

### **<https://cashflow.max-management.workers.dev/>**

The site is live on Cloudflare Workers and talks to the FastAPI backend on
Railway (`https://cashflow-67-production.up.railway.app`). No account, no keys,
no download.

**60-second tour**

1. Open the link → **Sign in** → **“Explore as guest”** (loads ~6 months of demo
   data, entirely in the browser — nothing is sent anywhere).
2. **Overview** — cash, runway banner, the warning threshold, and the forecast +
   AR-risk cards.
3. **Model insights** — next month's projection *beside* the persistence
   baseline, and the ranked “who to chase first” queue.
4. **AI advisor** — ask `who owes me money`. It names every customer with the
   amount, how late it is, and a high/medium/low risk per party.
5. **Settings → Data & privacy** — the retention numbers and the delete
   buttons (read-only in guest mode; there is no server write path without an
   account).

Receipt scanning needs an account (it uploads, so guest mode refuses by design)
— it is part of **Option C** below, with a sample image at
`backend/demo_assets/sample_receipt.png`.

Want accounts, saved data, OCR and email reports? That needs your own keys —
see **Option C — full local setup** below.

---

## 💻 Local setup (Windows · macOS)

You can run the whole demo with **Node alone** (guest mode). Python is only
needed for the backend — real logins, saved rows, OCR, advisor LLM, emails.

| Tool | Version | Check | Required for |
|---|---|---|---|
| Node.js | **20.19+ or 22.12+** | `node -v` | the site (always) |
| npm | 10+ (ships with Node) | `npm -v` | the site (always) |
| Python | **3.11 – 3.13** (3.13 recommended) | `py -3.13 -V` · `python3.13 -V` | the backend (optional) |
| Git Bash | any (Windows only) | — | `setup.sh` and the `bash` commands below |

Install Node from <https://nodejs.org> (LTS installer, keep “Add to PATH”), then
reopen the terminal. **Windows:** use **Git Bash** for every command on this
page — PowerShell/cmd work too, except `bash setup.sh` and `cp`.

### Option A — one command (installs + configures + runs)

Windows (Git Bash) and macOS/Linux run exactly the same thing:

```bash
git clone https://github.com/MAXAJIE/competiton.git
cd competiton
bash setup.sh
```

It checks Node and Python, installs both dependency sets, asks for Supabase /
OpenRouter / Resend keys (press `Enter` to skip any — with none, the app runs in
guest mode), writes `.env.local` and `backend/.env`, then starts the API on
`:8000` and the site on `:8080`. `Ctrl+C` stops both.

```bash
bash setup.sh --no-run          # install + configure only
bash setup.sh --force-install   # rebuild node_modules and backend/.venv (env files kept)
bash setup.sh --help            # everything it does, in one screen
```

### Option B — frontend only, two commands (guest mode, no keys)

Identical on Windows and macOS:

```bash
git clone https://github.com/MAXAJIE/competiton.git
cd competiton
npm install          # once, 1–3 min
npm run dev          # → http://localhost:8080
```

Open <http://localhost:8080>, click **Sign in**, press **“Explore as guest”**.
Guest mode lives in memory only: it never calls a server, and a refresh resets
it.

```bash
npm run dev -- --host        # reachable from your phone on the same Wi-Fi
npm run dev -- --port 3000   # if 8080 is busy
```

### Option C — full local setup (with accounts, OCR and email)

Same steps, different shell syntax. Run the backend and the site in **two
terminals**, both from the repo root.

| Step | Windows (PowerShell / Git Bash) | macOS / Linux (zsh / bash) |
|---|---|---|
| 1. Frontend env | `copy .env.example .env.local` | `cp .env.example .env.local` |
| 2. Backend env | `cd backend; copy .env.example .env` | `cd backend && cp .env.example .env` |
| 3. Create venv | `cd backend; py -3.13 -m venv .venv` | `cd backend && python3.13 -m venv .venv` |
| 4. Install Python deps | `cd backend; .venv\Scripts\pip install -r requirements.txt` | `cd backend && .venv/bin/pip install -r requirements.txt` |
| 5. Run the API | `cd backend; .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000` | `cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000` |
| 6. Run the site | `npm run dev` (repo root) | `npm run dev` |

Each step starts from the repo root. Check <http://localhost:8000/docs> for the
API, <http://localhost:8080> for the app. The frontend already points at
`http://localhost:8000`.

> **Don't use Python 3.14+.** numpy, pandas, scikit-learn and cffi publish
> wheels *after* a Python release; with no wheel `pip` compiles from source and
> dies (`Microsoft Visual C++ 14.0 or greater is required`,
> `metadata-generation-failed`). Pick 3.13 in the installer and tick **“Add
> python.exe to PATH”** + the **`py` launcher**. Recreate the venv if you got it
> wrong: `rm -rf backend/.venv` (`rmdir /s /q backend\.venv` in cmd).

**Do not pass `--app-dir backend`** while you are inside `backend/` — it is
relative to the current directory, so it resolves to `backend/backend` and
uvicorn reports `Could not import module "app.main"`. It is only correct when
you run from the repo root.

### Environment variables

**`.env.local` (browser)** — only `VITE_`-prefixed values reach the client, so
never put the Supabase *service* key here.

| Var | Needed for |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | login + saved data |
| `VITE_API_URL` | which backend to call (default `http://localhost:8000`) |

**`backend/.env` (server)** — the API still starts without any of these; writes
then return 401, which is the guest rule working.

| Var | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | login + token validation |
| `SUPABASE_SERVICE_KEY` | server-side reads/writes (always filtered by `user_id`) |
| `OPENROUTER_API_KEY` | receipt OCR + LLM advisor (advisor falls back to deterministic answers without it) |
| `RESEND_API_KEY`, `EMAIL_FROM` | “send test report now” (503 until set) |
| `OCR_MODEL` / `ADVISOR_MODEL` (+ `*_FALLBACK_MODELS`) | which OpenRouter models to use |
| `ALLOWED_ORIGINS` | comma-separated CORS allowlist |
| `RATE_LIMIT_ENABLED` | `0` disables the per-route budgets (tests/debugging only) |
| `TERMS_VERSION` / `PRIVACY_VERSION` | must match `src/lib/legal.ts` |
| `RETENTION_DAYS_*`, `RETENTION_MAX_*` | how long/how much data is kept |
| `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_FILES` | upload caps (default 8 MB, 5 files) |

**Supabase, once:** Project Settings → API → copy URL + anon key (and the
service key for the backend); SQL Editor → run `backend/schema.sql` (creates the
tables **and** their Row Level Security policies, idempotent); Authentication →
URL Configuration → Site URL `http://localhost:8080` + redirect
`http://localhost:8080/**`; optional Google login via a Google Cloud OAuth web
client with redirect `https://<project>.supabase.co/auth/v1/callback`. Create a
Storage bucket named `documents` to keep uploaded receipts, with the policy
noted at the bottom of `backend/schema.sql`.

```bash
# optional extras, from backend/
.venv/Scripts/python -m app.demo_seed                                  # reset + reseed demo account
.venv/Scripts/python -c "from app import market; market.refresh()"     # market snapshot job
```

---

## ✨ Key sights

| Route | What you see |
|---|---|
| `/` | **Dashboard** — live cash, runway banner against your own threshold, 6-month chart, AR/AP with aging, next-month forecast, AR-risk ranking |
| `/insights` | **Model outputs** — projected revenue *next to the persistence baseline*, the ranked chase queue with a plain-language reason per flag, and which model artifacts are loaded |
| `/advisor` | **AI advisor** — tool-calling chat. Every figure comes from a named calculation tool; “who owes me money” returns each customer with amount, days late and risk |
| `/entry` | **Add a transaction** — grouped categories, AR/AP invoices, and settlement (a payment closes one or more invoices) |
| `/history` | **Full ledger** — every row with query, type and period filters, plus a text-size control for dense tables |
| *(dialog)* | **Receipt scan** — photo → OCR draft → you confirm the fields; the only path from an image to the ledger (sample image: `backend/demo_assets/sample_receipt.png`) |
| `/settings` | **Risk thresholds, AI access (server key or your own OpenRouter key), and Data & privacy** — retention numbers, “delete my data”, “delete my account” |
| `/login`, `/welcome`, `/terms`, `/privacy` | **Accounts** — 18+ and Terms/Privacy acceptance required before an account exists (enforced server-side too), guest mode, and the legal pages |

Behaviours worth knowing, because they are the design:

- **Overdue is a fact, not a forecast.** An invoice past its due date is shown at
  100% late, never as a “probability”.
- **The UI never invents a number.** It calls `src/lib/calc.ts` (guest) or the
  API (signed in); the advisor cannot state a ledger figure without a tool
  result.
- **OCR never writes the ledger.** The human confirm is the only path.
- **A missing model artifact or key is reported as a fallback**, never disguised
  as a prediction.
- **Guest mode has no write path at all** — not a hidden button, a structural
  rule.

---

## 📊 Models: training data vs baseline

Full write-up, ablations and failure cases:
[`docs/CashMonitoring-Competition-Submission.pdf`](docs/CashMonitoring-Competition-Submission.pdf)
· [`notebooks/scored_models.ipynb`](notebooks/scored_models.ipynb) ·
[`backend/README.md`](backend/README.md)

### The data

| | |
|---|---|
| Source | **synthetic, generated by us** — `backend/ml/generate_training_data.py`, seed 42. No external training data |
| Receivables | **1,400** AR rows, 45 repeat customers, Jan 2023 – Oct 2026, **321 late (22.9%)** |
| Split | **chronological** 80/20 → 1,120 train / 280 test (**79 late in test**) |
| Decision threshold | 0.18, tuned on the last 20% of the *training* window — the test rows were never seen |
| Labels | realistic payment rule with **8% random noise**, so outcomes are not separable by construction |
| Revenue | **47 usable months** (37 train / 10 test), mean $12,316.44 |
| Committed copies | `backend/data/ar_training.csv`, `revenue_training.csv`, `fusion_training.csv` |
| Fitted metrics | `backend/models/metrics.json` — the shipped model, the v1/v2 ablation and the confusion matrix. The benchmark rows below were re-run on these same committed CSVs and the same chronological split (see the report) |

Why synthetic: public invoice datasets strip customer IDs and payment dates —
exactly the field that carries the real signal — so a repeat-customer history
cannot be studied on them. Our generator keeps a customer's prior behaviour and
resolves it chronologically, which is what a live ledger looks like.

### AR late-payment risk — 280 chronological test rows, 79 late, base rate 28.2%

| Method | F1 | Precision | Recall | PR-AUC | Brier | Late caught |
|---|---|---|---|---|---|---|
| Baseline: always on time | 0.000 | — | 0.000 | 0.282 | 0.282 | 0/79 |
| Baseline: flag every invoice | 0.440 | 0.282 | 1.000 | 0.282 | 0.718 | 79/79 |
| Baseline: constant base-rate probability | 0.000 | — | — | 0.282 | 0.207 | 0/79 |
| Rule: customer late rate > training mean | 0.283 | 0.248 | 0.329 | 0.271 | 0.471 | 26/79 |
| Rule: terms ≥ 45 days and rate > mean | 0.151 | 0.189 | 0.127 | 0.270 | 0.400 | 10/79 |
| Logistic, **no** customer history | 0.519 | 0.388 | 0.785 | 0.469 | 0.194 | 62/79 |
| Decision tree, depth 3 | 0.471 | 0.330 | 0.840 | 0.371 | 0.206 | 66/79 |
| Random forest, 300 trees | 0.444 | 0.290 | 0.950 | 0.384 | 0.204 | 75/79 |
| Hist gradient boosting | 0.461 | 0.320 | 0.820 | 0.361 | 0.225 | 65/79 |
| **Ours: logistic v1 — shipped** | **0.502** | **0.375** | **0.759** | **0.462** | **0.199** | **60/79** |
| Ours: logistic v2 — rejected | 0.480 | 0.373 | 0.671 | 0.440 | 0.202 | 53/79 |

Features: log amount, days until due, the customer's resolved late rate, prior
resolved invoice count, and category one-hots.

### Next-month revenue — 10 held-out months (2026-03 → 2026-12), lower MAE is better

| Method | MAE | As % of mean |
|---|---|---|
| Baseline: persistence (next = this month) | $1,498 | 12.2% |
| Baseline: 3-month trailing average | $1,593 | 12.9% |
| Baseline: seasonal naive (same month last year) | $1,167 | 9.5% |
| Baseline: training-window mean | $2,663 | 21.6% |
| Linear trend on month index | $1,318 | 10.7% |
| Ridge(1.0), same features | $1,176 | 9.5% |
| Random forest, same features | $1,107 | 9.0% |
| **Ours: linear regression, 5 features** | **$1,069** | **8.7%** |

Features: prior month, 3-month rolling average, prior month's overdue-AR share,
seasonal sin/cos. **28.6% lower MAE than persistence** — but only **8.4%** better
than seasonal naive (bootstrap 90% CI −$345 … +$579: statistically
indistinguishable). `lag_12` is not in the feature set; that is the cheapest
real win, and we say so rather than quoting the flattering baseline.

### The leak we found and chose not to hide

Our first model counted an invoice in a customer's history as soon as it was
*issued*, even if it was still open at prediction time — the label was partly
computed from itself. Fixed by counting a row only after its due date has
resolved, with a single pooled cold-start prior:

| Model | Accuracy | Precision | Recall | F1 | PR-AUC | Brier | Late caught | False alarms |
|---|---|---|---|---|---|---|---|---|
| Model 1: leaky history (pre-fix) | 0.5750 | 0.3765 | 0.7722 | 0.5062 | 0.4619 | 0.1988 | 61/79 | 101 |
| **Model 2: resolved history (shipped)** | 0.5750 | 0.3750 | 0.7595 | **0.5021** | **0.4623** | **0.1987** | 60/79 | 100 |

The honest model scores *lower*. We shipped it anyway, because it is the number
that survives contact with a live ledger. `backend/tests/test_ml.py` asserts the
leak cannot come back.

### What the comparison actually says

- **Accuracy is the wrong headline.** “Everyone pays on time” is **71.8%
  accurate and catches 0 of 79 late invoices**. Ours is *less* accurate (57.5%)
  and catches **60 of 79 (76.0%)**.
- **“Flag everything” is close.** F1 0.440 versus our 0.502 — only 0.062 apart.
  With 37.5% precision, ~6 in 10 flags are false alarms. This is a
  **prioritisation aid, not an automation**.
- **The classic heuristic is worse than random.** Flagging customers whose late
  rate is above the training mean catches 26/79 with PR-AUC 0.271 — *below* the
  0.282 random floor.
- **Customer history is not carrying the result here.** A no-history logistic
  scores PR-AUC 0.469 vs our 0.462 (F1 0.519 vs 0.502) — inside the ±0.06 F1
  sampling noise of 79 late rows. History stays because it produces the
  per-customer explanation (“8 of 22 late”), not because it wins the table.
- **Where it fails:** 19 of 79 late invoices are missed (an unmodelled shock on a
  small invoice), and the highest-confidence false alarm was a large invoice from
  a customer with a 36% prior late rate that was paid on time. Brier 0.199 barely
  beats the 0.207 constant-probability baseline: the **ranking** is useful, the
  exact percentages are rough. Revenue under-predicted Dec 2026 by $3,034.72
  because it only sees lagged features and not a year-end spike.

### Reproduce

```bash
cd backend
.venv/Scripts/python -m ml.generate_training_data   # rebuild the CSVs (seed 42)  [macOS: .venv/bin/python]
.venv/Scripts/python -m ml.train_models             # refit both models → models/metrics.json
.venv/Scripts/python -m pytest tests -q             # 163 tests, no network, no keys
```

---

## 🔒 Security, privacy and legal

Enforced in code, not just promised in the policy text.

| Concern | Where it lives |
|---|---|
| **Research/education disclaimer** | `src/lib/legal.ts` (landing page, both legal pages, every footer), `/api/legal` |
| **18+ and accepted Terms/Privacy** | signup → `POST /api/auth/signup` (re-checked server-side); OAuth users → `/welcome`; stored with version + timestamp |
| **Deleting data / the account** | Settings → Data & privacy → `DELETE /api/account/data` or `DELETE /api/account` (rows, uploads, auth user) |
| **No hoarding** | `db.enforce_retention`: transactions 1095 days / 5000 rows, scans 180 days / 500 documents; runnable on demand |
| **Row Level Security** | `backend/schema.sql` + `backend/tests/test_schema_rls.py` (fails if a table has no RLS and owner policy) |
| **Rate limits** | `backend/app/security.py`: per-IP *and* per-token sliding windows, tighter for OCR/advisor/key-test/email/signup, `429` + `Retry-After` |
| **Strict input** | `backend/app/models.py`: `extra="forbid"`, length/range caps, real calendar dates, NaN rejection, control characters stripped |
| **Uploads** | type allowlist + magic-byte check + size/page caps, before a paid model is called |
| **Secrets** | an OpenRouter key stays in the browser (BYOK) or in the server env; keys, bearer tokens and JWTs are redacted from every message and log line |
| **XSS** | React escaping, no `dangerouslySetInnerHTML` on user data, plus a CSP with no third-party scripts and `frame-ancestors 'none'` |
| **Caching** | `cache.py` for categories/AI config/model info/market snapshot; user data is always `no-store` |

---

## 🧪 Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload, port 8080 |
| `npm test` | vitest — 70 tests (routing, ledger/history, insights, legal, privacy, AI access, dialogs) |
| `npm run lint` / `npm run format` | eslint / prettier |
| `npm run build` | production bundle in `.output/` (Cloudflare Workers target) |
| `cd backend && .venv/Scripts/python -m pytest -q` | backend suite — **163 tests** (macOS: `.venv/bin/python`) |

Backend tests need no network, no Supabase keys and no OpenRouter credits.
`npm run preview` is not wired up (the build targets Workers, not Node) — use
`npm run dev`, or `npx wrangler dev` inside `.output/` for a real build preview.

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh`: “no Python 3.11-3.13 found” | Install 3.13 from python.org with the `py` launcher ticked, or let the script install it with `uv` when uv is present |
| `setup.sh`: “port 8000/8080 is already in use” | A leftover server is still running — stop it, then re-run |
| `setup.sh` rejected the Supabase URL | It must start with `https://` |
| `node` / `npm` not recognised | Install Node 20.19+/22.12+, reopen the terminal |
| Vite refuses to start, `EBADENGINE` | Node too old — upgrade to Node 22 LTS |
| Page loads with no data | Expected — press **“Explore as guest”** on `/login` |
| Console warns `VITE_SUPABASE_URL … are not set` | Harmless in guest mode |
| `Failed to fetch` when signed in | Backend not running on port 8000 |
| Google login returns a blank page | Add the exact origin to Supabase → URL Configuration → Redirect URLs |
| `Building wheel for scikit-learn … error`, `Microsoft Visual C++ 14.0 … required` | Python too new — delete `backend/.venv`, recreate with `py -3.13 -m venv .venv` |
| Changed the editor interpreter but it still fails | `.venv` is still the old version — check `.venv/Scripts/python -V`, delete, recreate |
| `No module named 'app'` / `Could not import module "app.main"` | Run from `backend/` with `.venv/Scripts/python -m uvicorn app.main:app --port 8000`. `--app-dir backend` is relative to the cwd, so inside `backend/` it points at `backend/backend` — use it only from the repo root |
| Port 8000 busy — `[Errno 10048]` / `[WinError 10013]` | Something is already bound (10013 is the same thing for an exclusive socket): `netstat -ano \| findstr :8000`, then `taskkill /PID <pid> /F` — or use `--port 8001` and set `VITE_API_URL=http://127.0.0.1:8001` |
| Settings → **Data & privacy** buttons do nothing, or a toast says `Not Found` | The deployed backend is older than the site: `GET /api/health` on it has no `features` list, and `DELETE /api/account/data` answers 404 because the route did not exist yet. Deploy the current `backend/` folder (Railway redeploys on push) and rebuild the site. The app now warns about this on the page itself |
| OCR says `rate-limited upstream` / `does not support image input` | Swap `OCR_MODEL` for a paid vision model (see `backend/README.md`) |

---

## 🏗 How the pieces fit

```
                        ┌─ Supabase (Postgres · Auth · Storage)
FastAPI (backend/app) ──┼─ OpenRouter (vision OCR · advisor LLM)
  ▲                     ├─ yfinance + RSS (cached market job)
  │  fetch JSON         └─ Resend (report email)
  │
browser (TanStack Start + React)
  └─ guest mode: nothing leaves the page (lib/store + lib/calc.ts)
```

```
src/            # routes, components, lib (api, calc, store, motion), tests
backend/app/    # FastAPI routes + calc / OCR / advisor / market / reports / settlement
backend/ml/     # training-data generator + model training
backend/data/   # committed training CSVs
backend/models/ # fitted artifacts + metrics.json
notebooks/      # scored_models.ipynb (model write-up)
docs/           # competition submission (PDF)
```

Deeper detail — data model, OCR pipeline, advisor tools, model artifacts, HTTP
surface, deliberate limits: [`backend/README.md`](backend/README.md).

Project rules (`AGENTS.md`): the UI calls `src/lib/api.ts` / `src/lib/calc.ts`
and never recomputes figures; GSAP stays inside `src/lib/motion.ts`; don't
rewrite published history — the repo is connected to Lovable.

---

## Disclaimer

**This project is a prototype built for research and educational purposes. It is
not financial, tax, or legal advice, and it is not a substitute for a qualified
accountant, bookkeeper, or financial adviser.**

- **No real-world accuracy is claimed.** Both models are trained on a **seeded
  synthetic dataset**; they have never been validated against real ledgers.
  Metrics in this README describe the synthetic test slice only.
- **The risk score is a prioritisation aid, not an automation.** ~6 in 10 flags
  are false alarms at the shipped threshold; do not use it to deny credit,
  refuse a customer, or take legal action.
- **Forecasts are projections with error bars.** The revenue model under-predicted
  one test month (Dec 2026, $11,930 predicted vs $14,965 actual) by $3,034.72, and
  the seasonal-naive baseline is within statistical noise of the model.
- **AI features can be wrong.** Receipt OCR is a draft that requires your
  confirmation; the advisor answers only from named tools and refuses rather
  than guessing, but both can still be misled by bad input.
- **Synthetic and demo data are not anyone's real finances.** Demo figures are
  generated for illustration.
- **You are the data controller for anything you enter.** If you deploy this for
  real users, check your own obligations (privacy law, retention, consent) — the
  in-app Terms and Privacy pages are examples written for this prototype, not
  legal instruments reviewed by counsel.

No warranty of any kind. Use at your own risk, and verify any number that
matters against your books.

---

## 👥 Team, code and report

| | |
|---|---|
| Live demo | <https://cashflow.max-management.workers.dev/> |
| Code | <https://github.com/MAXAJIE/competiton> (`main`) |
| Report / write-up | [`docs/CashMonitoring-Competition-Submission.pdf`](docs/CashMonitoring-Competition-Submission.pdf) |
| Team LXVII | Ling Jie Chin · Yong Ni Ang · Deebak s/o Ramesh Babu — SMK Taman Johor Jaya 2 |
| Track | AI + Finance |
| Starting point | Original project (Lovable / TanStack Start scaffold + our SKILL.md build brief); backend, ML pipeline, product rules and tests built by the team |
| AI tools used during development | Claude, Gemini, Cline, DeepAI, Antigravity, Lovable. OpenRouter models power OCR and the advisor **at runtime** and do not produce any reported metric |

Built with TanStack Start · React · TypeScript · Tailwind CSS · Radix UI · GSAP ·
Recharts · FastAPI · Supabase · scikit-learn
