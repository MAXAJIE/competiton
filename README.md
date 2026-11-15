# CashMonitoring

A cash-flow monitoring dashboard for a solo owner/sole trader: ledger entry,
receivables & payables, runway warnings, a scan-a-receipt OCR flow, an AI
advisor, a revenue forecast and an AR late-payment risk score.

- **Frontend** — TanStack Start + React 19 + TypeScript + Tailwind 4 (this folder)
- **Backend** — FastAPI + Supabase + OpenRouter (`backend/`, optional to run)
- **Models** — scikit-learn artifacts already committed in `backend/models/`

You can run the frontend **alone in guest mode** (demo data, nothing leaves the
browser) and see the whole app. Supabase + the Python backend only add real
login, persistence, OCR, advisor and email reports.

### What you need, at a glance

| Goal | Need |
|---|---|
| Website in guest mode (fastest) | **Node 20.19+ / 22.12+** + npm |
| + real backend (login, saved data, OCR, advisor) | also **Python 3.11 – 3.13** (3.13 recommended) |

> **Python version matters.** The backend pulls numpy / pandas / scikit-learn
> from PyPI, and those publish wheels *after* a new Python release. On a brand
> new Python, `pip` finds no wheel, tries to compile from source, and fails
> without a C++ toolchain. Use **3.13** (the team's version — verified here on
> 3.11 too) instead of whatever "latest" your machine offers. Details and fixes
> in [§3](#3-optional--run-the-python-backend).

---

## 1. Quick start — run the website (2 commands)

### Requirements

| Tool | Version | Check |
|---|---|---|
| Node.js | **20.19+ or 22.12+** (tested on 22.23) | `node -v` |
| npm | 10+ (ships with Node) | `npm -v` |

Node download: <https://nodejs.org> (pick the LTS installer, keep "Add to PATH").
Close and reopen the terminal afterwards so `node` is on PATH.

### Steps

**1. Open a terminal in the project folder**

Clone the repo, then `cd` into it — the app is at the repo root, so
`package.json` sits right there (no nested sub-folder):

```bash
# first time only
git clone https://github.com/MAXAJIE/competiton.git
cd competiton

# already cloned: just cd into the folder that contains package.json
```

**2. Install dependencies (once — takes 1–3 min)**

```bash
npm install
```

**3. Start the dev server**

```bash
npm run dev
```

**4. Open the app**

Vite prints the URL. Go to **<http://localhost:8080>** in your browser.

```
  VITE v8.1.5  ready in 28 s
  ➜  Local:   http://localhost:8080/
```

**5. Get into the app (no accounts needed)**

The dashboard opens in an empty "no workspace" state. Click the sign-in link
(top-right, or go to <http://localhost:8080/login>) and press
**“Explore as guest”**. That loads ~6 months of demo transactions so every
panel (runway warning, AR/AP, forecast, risk score, advisor) has data.

Guest mode lives in memory: it never contacts a server, and a full page refresh
resets it — press **Explore as guest** again and the demo data is regenerated.

**6. Stop it** — `Ctrl + C` in the terminal.

### Optional one-liners

```bash
npm run dev -- --host      # also serve on your LAN so a phone can open it
npm run dev -- --port 3000 # if 8080 is taken (Vite also auto-picks the next free port)
```

Any other package manager works if you prefer it:

```bash
bun install && bun run dev
```

(macOS/Linux: the same commands — no `.venv/Scripts` path juggling for the
frontend.) On this checkout `npm` is the safer bet: both `package-lock.json`
and `bun.lock` exist, and `bunfig.toml` sets a 24h package-release guard.

### What you should see

| Route | Page |
|---|---|
| `/` | Dashboard: cash balance, runway, warning banner, chart, AR/AP, forecast + AR risk panels |
| `/entry` | Add a transaction (grouped category select, AR/AP settlement) |
| `/history` | Full ledger, filters, edit/delete |
| `/advisor` | AI advisor chat (answers from your ledger via tools) |
| `/settings` | Risk thresholds, test report email, data controls |
| `/login` | Password / Google login, or **Explore as guest** |

---

## 2. Optional — configuration file

Guest mode needs **zero** configuration. Without env vars the console shows a
harmless warning that Supabase is not configured (`src/lib/supabase.ts`).

To enable login + server data, copy the example file and fill it in:

```bash
cp .env.example .env.local      # Windows cmd: copy .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_API_URL=http://localhost:8000
```

Only `VITE_`-prefixed vars reach the browser, so the anon key (public by
design) is the only Supabase key that belongs here — **never** the service key.
Restart `npm run dev` after editing `.env.local`.

Supabase project setup:

1. Create a project at <https://supabase.com> → **Project Settings → API** for the
   URL + anon key.
2. Run `backend/schema.sql` once in the Supabase **SQL editor**.
3. **Authentication → URL Configuration**: Site URL `http://localhost:8080`, and
   add `http://localhost:8080/**` + `http://localhost:8080/login` to Redirect URLs.
4. Google login (optional): Google Cloud Console → OAuth client ID (Web app) with
   redirect URI `https://<project>.supabase.co/auth/v1/callback`, then paste the
   ID/secret into Supabase → Authentication → Providers → Google.

Full backend and auth notes: [`backend/README.md`](backend/README.md).

---

## 3. Optional — run the Python backend

Needed for real accounts, saved ledgers, receipt OCR, live market headlines and
email reports. The models are pre-trained, so no training step is required.

**Requirements:** Python **3.11 – 3.13**. Anything newer (3.14+) is untested and
breaks often — pin the version deliberately instead of using the newest one.

| Python | Backend install | Why |
|---|---|---|
| 3.11 / 3.12 / 3.13 | ✅ supported | installed + 75 tests green on 3.11 here; 3.13 is the team's version |
| 3.14+ | ⚠️ not supported | numpy / pandas / scikit-learn / cffi wheels land weeks-to-months after a Python release; until they do, pip builds from source and fails without a C/C++ toolchain |

`backend/requirements.txt` uses `>=` pins, so pip always installs the newest
numpy/pandas/scikit-learn. When those have no wheel for your interpreter, the
install stops with something like:

```
Building wheel for scikit-learn (pyproject.toml) ... error
  error: Microsoft Visual C++ 14.0 or greater is required.   # Windows
ERROR: metadata-generation-failed
```

That is a **Python version** error, not a broken repo. Install 3.13 from
<https://python.org> (Windows installer: tick **"Add python.exe to PATH"** and
the **`py` launcher**), then create the venv **with that interpreter**:

```bash
cd backend                    # from the repo root (the folder with package.json)

py -3.13 -m venv .venv        # Windows (PowerShell / cmd / Git Bash)
python3.13 -m venv .venv      # macOS / Linux

.venv/Scripts/python -V       # Windows — must print Python 3.13.x
.venv/bin/python -V           # macOS / Linux
```

> **Changing the interpreter in VS Code is not enough.** "Python: Select
> Interpreter" only changes what the editor runs — it does **not** rebuild
> `backend/.venv`, which keeps the Python it was created with. If the venv was
> made with the wrong version, delete it and recreate it:
>
> ```bash
> rm -rf backend/.venv                      # Windows cmd: rmdir /s /q backend\.venv
> cd backend && py -3.13 -m venv .venv
> ```
>
> Then select `backend/.venv/Scripts/python` (macOS/Linux:
> `backend/.venv/bin/python`) as the interpreter.

Install the dependencies and start the API (both lines use the venv's Python,
never a bare `python`):

```bash
# Windows (PowerShell / cmd / Git Bash)
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# macOS / Linux
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

The first install takes a few minutes (it downloads ~60 packages). A healthy
run ends with `Application startup complete.` and `Uvicorn running on
http://127.0.0.1:8000`.

Then check <http://localhost:8000/docs> (interactive API docs) and
<http://localhost:8000/api/models/info>. The frontend already talks to
`http://localhost:8000` by default (`src/lib/api.ts`), so no proxy is needed.

Run the frontend and backend in **two separate terminals** — both stay running.

Backend env (`cd backend && cp .env.example .env`):

| Var | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | login, token validation, server-side reads/writes |
| `OPENROUTER_API_KEY` | receipt OCR + LLM advisor (advisor falls back to deterministic tool answers without it) |
| `RESEND_API_KEY`, `EMAIL_FROM` | "send test report now" (returns 503 until set) |

Without these the backend still starts and serves the public endpoints
(`/api/categories`, `/api/market/snapshot`, `/api/models/*`, guest advisor);
authenticated writes return 401, which is the guest-mode rule working.

### Backend tests

```bash
cd backend
.venv/Scripts/python -m pytest -q      # macOS/Linux: .venv/bin/python
```

Expected: `75 passed`. They are pure calculation/OCR-parsing tests — no
network, no Supabase keys, no OpenRouter credits needed. If collection fails
with `ModuleNotFoundError: fastapi`, you are running the system Python instead
of the venv (see the fix above).

The two committed models (`backend/models/*.joblib`) load on 3.11 – 3.13 as-is,
so no training step is required. An `InconsistentVersionWarning` on load is
harmless; re-run the training commands below to silence it.

### Retrain the models (optional — artifacts are committed)

```bash
cd backend
.venv/Scripts/python -m ml.generate_training_data   # writes data/*.csv
.venv/Scripts/python -m ml.train_models             # writes models/*.joblib + metrics.json
```

The graded write-up is `notebooks/scored_models.ipynb`.

---

## 4. Frontend tests, lint, format

```bash
npm test           # vitest run (routing, history, calc)
npm run test:watch # watch mode
npm run lint       # eslint
npm run format     # prettier
```

---

## 5. Production build

```bash
npm run build      # → .output/  (Cloudflare Worker bundle, nitro preset cloudflare-module)
```

`npm run preview` isn't wired up for this project (`Cannot find module
'dist/server/server.js'`) because the build targets Cloudflare Workers rather
than a Node server. To preview/serve the real build, install wrangler and run it
inside the output directory:

```bash
npx wrangler dev      # run from .output/ — local Worker preview
npx wrangler deploy   # publish to Cloudflare (needs `wrangler login`)
```

For a plain "just show me the site" demo, use `npm run dev` — it is the same
code with hot reload and needs no build step.

Because the project is connected to Lovable, avoid force-pushing or rewriting
already-published history (see `AGENTS.md`).

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `node: command not found` / `npm` not recognised | Install Node 20.19+/22.12+, then reopen the terminal |
| `EBADENGINE` or Vite refuses to start | Node too old — upgrade to 22 LTS (`node -v`) |
| Port 8080 already in use | Vite auto-picks 8081+; or `npm run dev -- --port 3000` |
| Page loads with no data | Expected before choosing a workspace — click **Explore as guest** on `/login` |
| Console warns "VITE_SUPABASE_URL … are not set" | Harmless in guest mode; add `.env.local` for real login |
| Google login bounces to a blank page | Add the exact origin you use (e.g. `http://localhost:8080`) to Supabase → Authentication → URL Configuration → Redirect URLs |
| Signed in but the ledger is empty | Correct: signed-in users start empty (only guest mode seeds demo rows) |
| `Failed to fetch` when adding rows while signed in | Backend is not running — start it on port 8000, or stay in guest mode |
| OCR says `rate-limited upstream` / `does not support image input` | Swap `OCR_MODEL` in `backend/.env` for a paid vision model — see the OCR table in `backend/README.md` |
| `Building wheel for scikit-learn … error`, `metadata-generation-failed`, `Microsoft Visual C++ 14.0 or greater is required`, `Failed building wheel for numpy/pandas/cffi` | Python too new for the published wheels. Delete `backend/.venv`, recreate it with `py -3.13 -m venv .venv`, reinstall requirements |
| Changed VS Code to Python 3.13 but install still fails | The `.venv` is still the old version — check `.venv/Scripts/python -V`, then remove and recreate `.venv` |
| `py -3.13` says "Requested Python version (3.13) not installed" | Run `py -0` to list registered versions; install 3.13 from <https://python.org> with the **`py` launcher** option ticked, or create the venv from the full path: `"C:\Users\you\AppData\Local\Programs\Python\Python313\python.exe" -m venv .venv` |
| Backend import errors on Windows | Use the venv paths (`.venv/Scripts/python`, not bare `python`) |
| `No module named 'app'` / `ModuleNotFoundError: fastapi` | You are outside `backend/` or not using the venv: `cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000` |
| `address already in use` for port 8000 | An old uvicorn is still running — stop it, or use `--port 8001` and set `VITE_API_URL` to match |

---

## 7. Layout

```
competiton/
  src/
    routes/            # pages: index, entry, history, advisor, settings, login
    components/        # UI + GSAP motion components
    lib/               # api client, calc rules, store, demo data, supabase, motion
    test/              # vitest suites
  backend/
    app/               # FastAPI routes + calc/OCR/advisor/market/reports/settlement
    ml/                # training data generator + model training
    data/  models/     # committed training CSVs and fitted artifacts
    schema.sql         # apply once in Supabase
  notebooks/scored_models.ipynb
  .env.example
```

Rules of thumb from `AGENTS.md`: UI must call `src/lib/api.ts` / `src/lib/calc.ts`
and never recompute figures itself; keep GSAP usage inside `src/lib/motion.ts`.

## Built with

TanStack Start · React · TypeScript · Tailwind CSS · Radix UI · GSAP · Recharts ·
FastAPI · Supabase · scikit-learn
