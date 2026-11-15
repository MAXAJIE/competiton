# CashMonitoring

Cash-flow monitoring for a solo owner / sole trader: ledger, receivables &
payables, runway warnings, scan-a-receipt OCR, an AI advisor, a revenue
forecast, and an AR late-payment risk score.

This page is **everything you need to set up and run it**. For how the backend
actually works (data model, OCR pipeline, advisor, models), read
[`backend/README.md`](backend/README.md).

---

## 0. One command (recommended)

```bash
git clone https://github.com/MAXAJIE/competiton.git
cd competiton
bash setup.sh
```

Run that once in the project folder. It:

1. checks Node and Python (3.11–3.13) and installs both dependency sets;
2. asks for **Supabase** (URL, anon key, service key), **OpenRouter** (key, OCR +
   advisor model) and **Resend** (key, from address) — press `Enter` to skip any
   of them, and with no keys at all the app still runs in guest mode;
3. writes `.env.local` and `backend/.env` (both gitignored, never printed back);
4. starts the backend on `:8000` and the site on `:8080` — `Ctrl+C` stops both.

```bash
bash setup.sh --no-run          # install + configure only, no servers
bash setup.sh --force-install   # rebuild node_modules and backend/.venv (env files kept)
bash setup.sh --help            # everything it does, in one screen
```

Needs Git Bash / macOS / Linux. The manual steps below do exactly the same
thing by hand.

---

## 1. Run the website (2 commands)

You only need Node. No account, no keys, no database.

| Tool | Version | Check |
|---|---|---|
| Node.js | **20.19+ or 22.12+** | `node -v` |
| npm | 10+ (ships with Node) | `npm -v` |

Get Node from <https://nodejs.org> (LTS installer, keep "Add to PATH"), then
reopen your terminal.

```bash
git clone https://github.com/MAXAJIE/competiton.git
cd competiton

npm install     # once, 1–3 min
npm run dev     # starts on http://localhost:8080
```

Open **<http://localhost:8080>**, click the sign-in link (top-right, or
`/login`), and press **“Explore as guest”**. That loads ~6 months of demo data
so every panel has something to show.

Guest mode lives in memory only — it never calls a server, and refreshing the
page resets it (press “Explore as guest” again).

Stop the server with `Ctrl + C`.

```bash
npm run dev -- --host       # also reachable from your phone on the same Wi-Fi
npm run dev -- --port 3000  # if 8080 is busy (Vite also picks the next free port)
```

### What you can click

| Route | Page |
|---|---|
| `/` | Dashboard — balance, runway, warning banner, chart, AR/AP, forecast, AR risk |
| `/entry` | Add a transaction (grouped categories, AR/AP settlement) |
| `/history` | Full ledger with filters, edit, delete |
| `/advisor` | AI advisor chat (answers from your ledger) |
| `/insights` | Model outputs: forecast, AR risk, model info |
| `/settings` | Risk thresholds, test report email, data controls |
| `/login` | Password / Google login, or **Explore as guest** |

---

## 2. Optional — real login and saved data

Guest mode is enough to demo everything. The steps below add real accounts,
persisted rows, receipt OCR, live market headlines and email reports.

### 2a. Frontend env (Supabase)

```bash
cp .env.example .env.local      # Windows cmd: copy .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_API_URL=http://localhost:8000
```

Restart `npm run dev` after editing. Only `VITE_`-prefixed values reach the
browser, so never put the Supabase **service** key here.

In the Supabase dashboard:

1. **Project Settings → API** → copy the URL and anon key.
2. **SQL Editor** → paste and run `backend/schema.sql` (once).
3. **Authentication → URL Configuration** → Site URL `http://localhost:8080`,
   and add `http://localhost:8080/**` to Redirect URLs.
4. **Google login (optional)** → Google Cloud Console → OAuth client (Web) with
   redirect `https://<project>.supabase.co/auth/v1/callback`, then enable Google
   in Supabase → Authentication → Providers and paste the ID + secret.

### 2b. Python backend

| Tool | Version | Check |
|---|---|---|
| Python | **3.11 – 3.13** (3.13 recommended) | `py -3.13 -V` / `python3.13 -V` |

> **Don't use Python 3.14+.** numpy, pandas, scikit-learn and cffi publish
> wheels *after* a Python release; with no wheel, `pip` compiles from source and
> dies (`Microsoft Visual C++ 14.0 or greater is required`,
> `metadata-generation-failed`). Install 3.13 from <https://python.org> and tick
> **"Add python.exe to PATH"** + **`py` launcher**.

Create the venv **with that interpreter** — picking it in VS Code does *not*
change an existing `.venv`:

```bash
cd backend
py -3.13 -m venv .venv        # macOS/Linux: python3.13 -m venv .venv

.venv/Scripts/pip install -r requirements.txt          # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Check <http://localhost:8000/docs> — the frontend already calls
`http://localhost:8000`, so no proxy is needed. Run frontend and backend in
**two terminals**.

If you made `.venv` with the wrong Python, delete and redo it:

```bash
rm -rf backend/.venv          # Windows cmd: rmdir /s /q backend\.venv
```

### 2c. Backend env

```bash
cd backend && cp .env.example .env
```

| Var | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | login + token validation |
| `SUPABASE_SERVICE_KEY` | server-side reads/writes (always filtered by `user_id`) |
| `OPENROUTER_API_KEY` | receipt OCR + LLM advisor (advisor falls back to deterministic answers without it) |
| `RESEND_API_KEY`, `EMAIL_FROM` | "send test report now" (503 until set) |
| `OCR_MODEL` / `ADVISOR_MODEL` (+ `*_FALLBACK_MODELS`) | which OpenRouter models to use |

Without these the API still starts and serves the public endpoints; writes
return 401, which is the guest rule working. Optional: create a storage bucket
named `documents` to keep uploaded receipts.

### 2d. Optional extras

```bash
cd backend
.venv/Scripts/python -m app.demo_seed        # reset + reseed the demo account
.venv/Scripts/python -c "from app import market; market.refresh()"   # market snapshot job
```

---

## 3. Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server, hot reload, port 8080 |
| `npm test` | vitest (routing, history, calc) |
| `npm run lint` / `npm run format` | eslint / prettier |
| `npm run build` | production bundle in `.output/` (Cloudflare Worker target) |
| `cd backend && .venv/Scripts/python -m pytest -q` | backend tests (expect `75 passed`) |

The backend tests need no network, no Supabase keys and no OpenRouter credits.
`npm run preview` is not wired up for this project (the build targets Cloudflare
Workers, not Node) — use `npm run dev` to show the site, or `npx wrangler dev`
inside `.output/` for a real build preview.

---

## 4. Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh`: "no Python 3.11-3.13 found" | Install 3.13 from python.org with the `py` launcher ticked, or let the script install it with `uv` when uv is present |
| `setup.sh`: "port 8000/8080 is already in use" | A leftover server is still running — stop it, then re-run |
| `setup.sh` rejected the Supabase URL | It must start with `https://` (copy it from Supabase → Project Settings → API) |
| `node` / `npm` not recognised | Install Node 20.19+/22.12+, reopen the terminal |
| Vite refuses to start, `EBADENGINE` | Node too old — upgrade to Node 22 LTS |
| Page loads with no data | Expected — press **Explore as guest** on `/login` |
| Console warns `VITE_SUPABASE_URL … are not set` | Harmless in guest mode |
| `Failed to fetch` when signed in | Backend not running on port 8000 |
| Google login returns a blank page | Add the exact origin to Supabase → URL Configuration → Redirect URLs |
| `Building wheel for scikit-learn … error`, `metadata-generation-failed`, `Microsoft Visual C++ 14.0 … required` | Python too new — delete `backend/.venv`, recreate with `py -3.13 -m venv .venv` |
| Changed editor to Python 3.13 but it still fails | `.venv` is still the old version — check `.venv/Scripts/python -V`, delete and recreate |
| `ModuleNotFoundError: fastapi` / `No module named 'app'` | Run from `backend/` with `.venv/Scripts/python` |
| Port 8000 in use | Stop the old uvicorn, or use `--port 8001` and update `VITE_API_URL` |
| OCR says `rate-limited upstream` / `does not support image input` | Swap `OCR_MODEL` for a paid vision model (see `backend/README.md`) |

---

## 5. How the pieces fit

```
                        ┌─ Supabase (Postgres · Auth · Storage)
FastAPI (backend/app) ──┼─ OpenRouter (vision OCR · advisor LLM)
  ▲                     ├─ yfinance + RSS (cached market job)
  │  fetch JSON         └─ Resend (report email)
  │
browser (TanStack Start + React)
  └─ guest mode: nothing leaves the page (lib/store + lib/calc.ts)
```

- The UI never computes money figures itself — it calls `src/lib/calc.ts`
  (guest) or the API (signed in), so both modes agree.
- The backend never writes an OCR row without a human confirm, and never
  produces an advisor figure without a tool result.
- Details, trade-offs and the failure modes that shaped the design:
  [`backend/README.md`](backend/README.md).

### Layout

```
src/            # routes, components, lib (api, calc, store, motion), tests
backend/app/    # FastAPI routes + calc/OCR/advisor/market/reports/settlement
backend/ml/     # training-data generator + model training
backend/data/   # committed training CSVs       backend/models/  # fitted artifacts
notebooks/      # scored_models.ipynb (model write-up)
```

Project rules (from `AGENTS.md`): UI calls `src/lib/api.ts` / `src/lib/calc.ts`
and never recomputes figures; GSAP stays inside `src/lib/motion.ts`; don't
rewrite published history — the repo is connected to Lovable.

## Built with

TanStack Start · React · TypeScript · Tailwind CSS · Radix UI · GSAP · Recharts ·
FastAPI · Supabase · scikit-learn
