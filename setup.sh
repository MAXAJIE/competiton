#!/usr/bin/env bash
#
# CashMonitoring — one-command setup.
#
#   bash setup.sh                 # install, configure (interactive), then run both servers
#   bash setup.sh --no-run        # install + configure only
#   bash setup.sh --force-install # wipe node_modules and backend/.venv, reinstall (env files are kept)
#   bash setup.sh --help
#
# Runs in Git Bash / WSL / macOS / Linux. Windows cmd/PowerShell users: open Git Bash.
#
# What it asks for (Enter skips a value, "keep" keeps an existing env file):
#   Supabase URL, anon key, service key            -> real login + saved data
#   OpenRouter key, OCR model, advisor model       -> receipt OCR + LLM advisor
#   Resend key, from address, report email         -> email reports
# Everything else has a working default: with no keys at all the app runs in guest mode.
#
# Writes: ./.env.local (browser) and ./backend/.env (server). Never committed,
# never printed back. It does NOT change backend/schema.sql — apply that in the
# Supabase SQL editor once (the script prints the reminder).

set -uo pipefail

# ---------- locations --------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || { echo "cannot cd to $REPO_ROOT"; exit 1; }

FRONT_FILE="$REPO_ROOT/.env.local"
BACK_FILE="$REPO_ROOT/backend/.env"
VENV_DIR="$REPO_ROOT/backend/.venv"
REQ_FILE="$REPO_ROOT/backend/requirements.txt"
BACKEND_LOG="${TMPDIR:-/tmp}/cashmonitoring-backend.log"

PY_CMD=()      # how to invoke the chosen system python, e.g. (py -3.13)
VENV_PY=""     # absolute path to the venv interpreter (Scripts/ on Windows, bin/ elsewhere)
BACKEND_PID=""
FRONTEND_PID=""

NO_RUN=0
FORCE_INSTALL=0
NON_INTERACTIVE=0
[ -t 0 ] || NON_INTERACTIVE=1

# ---------- output helpers ---------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_OFF=""
fi
step() { printf '\n%s==>%s %s\n' "$C_OK" "$C_OFF" "$1"; }
ok()   { printf '    %s✓%s %s\n' "$C_OK" "$C_OFF" "$1"; }
note() { printf '    %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }
warn() { printf '    %s!%s %s\n' "$C_WARN" "$C_OFF" "$1" >&2; }
die()  { printf '\n%serror:%s %s\n\n' "$C_ERR" "$C_OFF" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
CashMonitoring setup

Usage: bash setup.sh [--no-run] [--force-install] [--interactive] [--help]

  (no flag)         install deps, ask for keys, write env files, run both servers
  --no-run          do everything except starting the servers
  --force-install   delete node_modules and backend/.venv and reinstall them.
                    Env files (.env.local, backend/.env) are never deleted;
                    you are asked whether to keep or edit them.
  --interactive     ask the questions even when stdin is not a terminal
                    (by default a piped run uses env vars + defaults, no prompts)
  --help            this text

The script asks for these, one per line (Enter = skip / keep the shown default):

  Supabase project URL       e.g. https://abcd.supabase.co
  Supabase anon key          public key, safe for the browser (VITE_*)
  Supabase service key       server-only, never sent to the browser
  OpenRouter API key         receipt OCR + LLM advisor
  Resend API key / from      "send test report now" emails

Environment variables with the same names (SUPABASE_URL, OPENROUTER_API_KEY, ...)
are used as defaults when the script runs non-interactively (e.g. in CI).

Python 3.11-3.13 is required for the backend; 3.14+ breaks the dependency
install because numpy/pandas/scikit-learn wheels lag behind new releases.
EOF
}

# ---------- generic input helpers -------------------------------------------
trim() {
  local s="${1-}"
  s="${s//$'\r'/}"                       # CRLF pipes / Windows paste
  s="${s#"${s%%[![:space:]]*}"}"         # leading whitespace
  s="${s%"${s##*[![:space:]]}"}"         # trailing whitespace
  printf '%s' "$s"
}

confirm() { # label, default (y|n)
  local label="$1" def="${2:-y}" ans=""
  if [ "$NON_INTERACTIVE" = 1 ]; then [ "$def" = "y" ]; return; fi
  local shown="y/N"; [ "$def" = "y" ] && shown="Y/n"
  printf '    %s [%s]: ' "$label" "$shown"
  IFS= read -r ans || ans=""
  ans="$(trim "$ans")"
  [ -z "$ans" ] && ans="$def"
  case "$ans" in y|Y|yes|YES) return 0;; *) return 1;; esac
}

env_get() { # file, KEY -> value (quotes stripped)
  local file="$1" key="$2" line=""
  [ -f "$file" ] || return 0
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  line="$(trim "${line#*=}")"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

env_escape() { # value -> value safe inside double quotes
  local v="${1-}"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '%s' "$v"
}

env_set() { # file, KEY, value -> upsert as KEY="value" (all loaders understand this)
  local file="$1" key="$2" val tmp
  val="$(env_escape "${3-}")"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$file"; then
    tmp="$file.setup.tmp"
    awk -v k="$key" -v v="$val" '
      $0 ~ "^[[:space:]]*" k "[[:space:]]*=" { print k "=\"" v "\""; next }
      { print }
    ' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    printf '%s="%s"\n' "$key" "$val" >> "$file"
  fi
}

env_apply() { # file, KEY, value -> set when non-empty, remove the line when empty
  if [ -n "${3-}" ]; then env_set "$1" "$2" "$3"; else env_unset "$1" "$2"; fi
}

env_unset() { # file, KEY -> drop the line (an empty string is NOT the same as unset)
  local file="$1" key="$2" tmp="$1.setup.tmp"
  [ -f "$file" ] || return 0
  grep -vE "^[[:space:]]*${key}[[:space:]]*=" "$file" > "$tmp" && mv "$tmp" "$file"
}

is_url() { case "${1-}" in https://?*) return 0;; *) return 1;; esac; }
is_key() { [ -n "${1-}" ] && case "$1" in *[[:space:]]*) return 1;; *) return 0;; esac; }

# A value already stored for a key shared by both env files (backend wins, then the VITE_ copy).
shared_default() { # KEY
  local key="$1" v
  v="$(env_get "$BACK_FILE" "$key")"
  [ -n "$v" ] || v="$(env_get "$FRONT_FILE" "VITE_$key")"
  [ -n "$v" ] || v="$(trim "$(printenv "VITE_$key" 2>/dev/null || true)")"
  printf '%s' "$v"
}

# ask_var KEY FILE LABEL DEFAULT [secret]
# Precedence: exported env var > value in FILE > DEFAULT. Enter keeps the default.
ask_var() {
  local key="$1" file="$2" label="$3" def="${4-}" secret="${5-}"
  local from_env="" file_val="" input="" shown="" prompt=""

  from_env="$(trim "$(printenv "$key" 2>/dev/null || true)")"
  file_val="$(env_get "$file" "$key")"

  if [ -n "$from_env" ]; then REPLY_VALUE="$from_env"
  elif [ -n "$file_val" ]; then REPLY_VALUE="$file_val"
  else REPLY_VALUE="$def"; fi

  [ "$NON_INTERACTIVE" = 1 ] && return 0

  shown="$REPLY_VALUE"
  if [ "$secret" = "secret" ] && [ -n "$REPLY_VALUE" ]; then shown="set - Enter keeps it"; fi
  prompt="$label"
  [ -n "$shown" ] && prompt="$prompt [$shown]"
  prompt="$prompt: "

  printf '    %s' "$prompt"
  if [ "$secret" = "secret" ]; then
    IFS= read -rs input || input=""
    printf '\n'
  else
    IFS= read -r input || input=""
    [ -t 0 ] || printf '\n'   # piped input is not echoed, keep the log readable
  fi
  input="$(trim "$input")"
  [ -n "$input" ] && REPLY_VALUE="$input"
  return 0
}

# ask_url / ask_key: same as ask_var, but re-ask up to 3 times on an invalid value.
ask_url() {
  local tries=0
  while :; do
    ask_var "$@"
    [ -z "$REPLY_VALUE" ] && return 0
    is_url "$REPLY_VALUE" && return 0
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && die "$1 must look like https://your-project.supabase.co"
    warn "that does not look like a URL - try again"
    [ "$NON_INTERACTIVE" = 1 ] && die "$1 is set but is not a URL"
  done
}

ask_key() {
  local tries=0
  while :; do
    ask_var "$@"
    [ -z "$REPLY_VALUE" ] && return 0
    is_key "$REPLY_VALUE" && return 0
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && die "$1 contains spaces - paste the key again without wrapping quotes"
    warn "keys cannot contain spaces - try again"
    [ "$NON_INTERACTIVE" = 1 ] && die "$1 contains whitespace"
  done
}

# ---------- preflight --------------------------------------------------------
check_node() {
  step "Checking Node.js"
  command -v node >/dev/null 2>&1 || die "node not found. Install Node 22 LTS from https://nodejs.org, reopen the terminal, re-run."
  command -v npm  >/dev/null 2>&1 || die "npm not found. Reinstall Node from https://nodejs.org (npm ships with it)."

  local mm major minor
  mm="$(node -p "process.versions.node.split('.').slice(0,2).join(' ')" 2>/dev/null || true)"
  [ -n "$mm" ] || die "could not read the Node version."
  major="${mm%% *}"; minor="${mm##* }"

  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then :
  elif [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; then :
  elif [ "$major" -ge 24 ]; then :
  elif [ "$major" -eq 21 ] || [ "$major" -eq 23 ]; then
    warn "Node $major is not an LTS line - Vite may refuse to start. Node 22 LTS is the safe choice."
  else
    die "Node $(node -v) is too old for Vite 8. Install Node 22 LTS from https://nodejs.org."
  fi
  ok "node $(node -v), npm $(npm -v)"
}

python_ok() { # command... -> exit 0 when it really is CPython 3.11-3.13
  # Rejects the Windows Store python3.exe stub, which "exists" but cannot import sys.
  "$@" -c 'import sys; assert (3, 11) <= sys.version_info[:2] <= (3, 13)' >/dev/null 2>&1
}

find_python() {
  local cand p
  if command -v py >/dev/null 2>&1; then
    for cand in 3.13 3.12 3.11; do
      if python_ok py "-$cand"; then PY_CMD=(py "-$cand"); return 0; fi
    done
  fi
  for cand in python3.13 python3.12 python3.11; do
    if command -v "$cand" >/dev/null 2>&1 && python_ok "$cand"; then PY_CMD=("$cand"); return 0; fi
  done
  for p in "$HOME"/AppData/Local/Programs/Python/Python31[123]/python.exe \
           "$HOME"/AppData/Roaming/uv/python/*/python.exe \
           /c/Python31[123]/python.exe \
           "$HOME"/.local/share/uv/python/*/bin/python3.1[123] \
           /usr/local/bin/python3.1[123] /opt/homebrew/bin/python3.1[123] /usr/bin/python3.1[123]; do
    [ -x "$p" ] || continue
    if python_ok "$p"; then PY_CMD=("$p"); return 0; fi
  done
  return 1
}

check_python() {
  step "Checking Python (3.11-3.13 needed for the backend)"
  if find_python; then
    ok "${PY_CMD[*]} -> $("${PY_CMD[@]}" -V 2>&1)"
    return 0
  fi
  # Nothing usable: offer to install 3.13 with uv when it is on this machine.
  if command -v uv >/dev/null 2>&1 && [ "$NON_INTERACTIVE" = 0 ]; then
    warn "no Python 3.11-3.13 found (Windows Store stubs do not count)"
    if confirm "Install Python 3.13 with uv now?" y; then
      uv python install 3.13 || die "uv could not install Python 3.13."
      find_python && ok "${PY_CMD[*]} -> $("${PY_CMD[@]}" -V 2>&1)" && return 0
    fi
  fi
  die "no Python 3.11-3.13 found. Install 3.13 from https://python.org (tick 'Add python.exe to PATH'), then re-run.
Python 3.14+ is not usable here: numpy/pandas/scikit-learn have no wheels yet, so pip fails while compiling them."
}

port_listening() { # port -> exit 0 when something is LISTENING on that local port
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    # -l already restricts to listening sockets; match the local address column only.
    ss -ltn 2>/dev/null | awk -v p=":$port" 'NR>1 && $4 ~ (p "$") { found=1 } END { exit !found }' && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  elif command -v netstat >/dev/null 2>&1; then
    # Local Address is column 2 and State column 4: a browser talking to a
    # remote :8080 lands in Foreign Address and must not match.
    netstat -ano 2>/dev/null | awk -v p=":$port" '
      $1 == "TCP" && $4 == "LISTENING" && $2 ~ (p "$") { found=1 } END { exit !found }' && return 0
  fi
  return 1
}

check_ports() {
  port_listening 8000 && die "port 8000 is already in use (a leftover backend?). Stop it, then re-run."
  port_listening 8080 && die "port 8080 is already in use (a leftover dev server?). Stop it, then re-run."
  return 0
}

# ---------- install ----------------------------------------------------------
install_frontend() {
  step "Frontend dependencies"
  if [ "$FORCE_INSTALL" = 1 ] && [ -d node_modules ]; then
    note "removing node_modules (--force-install)"
    rm -rf node_modules
  fi
  if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
    ok "node_modules present - skipping npm install (use --force-install to redo)"
    return 0
  fi
  note "npm install (1-3 minutes)"
  npm install --no-fund || die "npm install failed (scroll up for the reason)."
  ok "frontend dependencies installed"
}

venv_python() { # -> absolute interpreter path inside the venv, if it exists
  if [ -x "$VENV_DIR/Scripts/python.exe" ]; then printf '%s' "$VENV_DIR/Scripts/python.exe"
  elif [ -x "$VENV_DIR/bin/python" ]; then printf '%s' "$VENV_DIR/bin/python"
  fi
}

install_backend() {
  step "Backend virtual environment"
  local existing
  existing="$(venv_python)"

  if [ "$FORCE_INSTALL" = 1 ] && [ -d "$VENV_DIR" ]; then
    note "removing backend/.venv (--force-install)"
    rm -rf "$VENV_DIR"
    existing=""
  fi

  if [ -n "$existing" ]; then
    if python_ok "$existing"; then
      ok "backend/.venv already on $("$existing" -V 2>&1)"
    else
      warn "backend/.venv was created with $("$existing" -V 2>&1), which is outside 3.11-3.13"
      note "switching interpreter in your editor does NOT rebuild a venv"
      if [ "$NON_INTERACTIVE" = 1 ] || confirm "Delete it and recreate with $("${PY_CMD[@]}" -V 2>&1)?" y; then
        rm -rf "$VENV_DIR"
        existing=""
      else
        die "backend/.venv must be rebuilt: rm -rf backend/.venv && bash setup.sh"
      fi
    fi
  fi

  if [ -z "$existing" ]; then
    note "creating backend/.venv with ${PY_CMD[*]}"
    "${PY_CMD[@]}" -m venv "$VENV_DIR" || die "could not create the venv with ${PY_CMD[*]}"
    ok "venv created"
  fi

  VENV_PY="$(venv_python)"
  [ -x "$VENV_PY" ] || die "venv interpreter not found in $VENV_DIR (expected Scripts/python.exe or bin/python)"

  if [ "$FORCE_INSTALL" = 1 ] || [ ! -f "$VENV_DIR/.deps-installed" ]; then
    note "installing backend requirements (a few minutes)"
    "$VENV_PY" -m pip install --upgrade pip >/dev/null 2>&1 || warn "pip self-upgrade failed - continuing"
    "$VENV_PY" -m pip install -r "$REQ_FILE" || die "pip install failed. If you see 'Building wheel for scikit-learn', your Python is too new (need 3.11-3.13)."
    : > "$VENV_DIR/.deps-installed"
    ok "backend requirements installed"
  else
    ok "backend requirements already installed (use --force-install to redo)"
  fi
}

# ---------- configuration wizard --------------------------------------------
write_frontend_env() {
  local tmp="$FRONT_FILE.setup.tmp"
  {
    echo "# CashMonitoring frontend env - written by setup.sh. Not committed."
    echo "# Only VITE_* values are exposed to the browser; never put the service key here."
  } > "$tmp"
  [ -f "$FRONT_FILE" ] && grep -vE '^(#|$)' "$FRONT_FILE" >> "$tmp"
  mv "$tmp" "$FRONT_FILE"
  env_apply "$FRONT_FILE" VITE_SUPABASE_URL "$SUPABASE_URL"
  env_apply "$FRONT_FILE" VITE_SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
  env_set "$FRONT_FILE" VITE_API_URL "http://localhost:8000"
  chmod 600 "$FRONT_FILE" 2>/dev/null || true
}

write_backend_env() {
  local tmp="$BACK_FILE.setup.tmp"
  {
    echo "# CashMonitoring backend env - written by setup.sh. Not committed."
    echo "# SUPABASE_SERVICE_KEY is server-only: never copy it to .env.local."
  } > "$tmp"
  [ -f "$BACK_FILE" ] && grep -vE '^(#|$)' "$BACK_FILE" >> "$tmp"
  mv "$tmp" "$BACK_FILE"
  env_apply "$BACK_FILE" SUPABASE_URL "$SUPABASE_URL"
  env_apply "$BACK_FILE" SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
  env_apply "$BACK_FILE" SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
  env_apply "$BACK_FILE" OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
  env_set "$BACK_FILE" OCR_MODEL "$OCR_MODEL"
  env_set "$BACK_FILE" ADVISOR_MODEL "$ADVISOR_MODEL"
  env_apply "$BACK_FILE" RESEND_API_KEY "$RESEND_API_KEY"
  env_apply "$BACK_FILE" EMAIL_FROM "$EMAIL_FROM"
  env_apply "$BACK_FILE" DEMO_REPORT_EMAIL "$DEMO_REPORT_EMAIL"
  chmod 600 "$BACK_FILE" 2>/dev/null || true
}

configure() {
  local keep_front=0 keep_back=0 need_front=1 need_back=1
  SUPABASE_URL="" SUPABASE_ANON_KEY="" SUPABASE_SERVICE_KEY=""
  OPENROUTER_API_KEY="" OCR_MODEL="" ADVISOR_MODEL=""
  RESEND_API_KEY="" EMAIL_FROM="" DEMO_REPORT_EMAIL=""

  step "Environment files"

  # Decide what to keep BEFORE asking anything, so "keep" costs zero questions.
  if [ -f "$FRONT_FILE" ]; then
    if [ "$NON_INTERACTIVE" = 1 ] || confirm "Keep existing .env.local (frontend)?" y; then
      keep_front=1; need_front=0
    fi
  fi
  if [ -f "$BACK_FILE" ]; then
    if [ "$NON_INTERACTIVE" = 1 ] || confirm "Keep existing backend/.env?" y; then
      keep_back=1; need_back=0
    fi
  fi

  if [ "$need_front" = 0 ] && [ "$need_back" = 0 ]; then
    ok "using the existing env files - nothing to ask"
    return 0
  fi

  printf '\n    Press Enter to keep a value, or to skip it and run without that feature.\n'

  # Supabase is shared by both files, so it is asked once.
  ask_url  SUPABASE_URL       "$FRONT_FILE" "Supabase project URL" "$(shared_default SUPABASE_URL)"
  SUPABASE_URL="$REPLY_VALUE"
  ask_key  SUPABASE_ANON_KEY  "$FRONT_FILE" "Supabase anon key (public)" "$(shared_default SUPABASE_ANON_KEY)" secret
  SUPABASE_ANON_KEY="$REPLY_VALUE"

  if [ "$need_back" = 1 ]; then
    ask_key SUPABASE_SERVICE_KEY "$BACK_FILE" "Supabase service key (server only)" "" secret
    SUPABASE_SERVICE_KEY="$REPLY_VALUE"

    ask_key OPENROUTER_API_KEY "$BACK_FILE" "OpenRouter API key (OCR + advisor)" "" secret
    OPENROUTER_API_KEY="$REPLY_VALUE"

    ask_var OCR_MODEL    "$BACK_FILE" "OCR model (must accept images)" "openai/gpt-4o-mini"
    OCR_MODEL="$REPLY_VALUE"
    ask_var ADVISOR_MODEL "$BACK_FILE" "Advisor model" "google/gemini-2.5-flash"
    ADVISOR_MODEL="$REPLY_VALUE"

    ask_key RESEND_API_KEY "$BACK_FILE" "Resend API key (report emails)" "" secret
    RESEND_API_KEY="$REPLY_VALUE"
    [ -z "$RESEND_API_KEY" ] || {
      ask_var EMAIL_FROM "$BACK_FILE" "Email 'from' address" "CashMonitoring <reports@resend.dev>"
      EMAIL_FROM="$REPLY_VALUE"
    }
    ask_var DEMO_REPORT_EMAIL "$BACK_FILE" "Report destination email (for the seed)" ""
    DEMO_REPORT_EMAIL="$REPLY_VALUE"
  fi

  # Write, then prove the split held.
  [ "$need_front" = 1 ] && write_frontend_env
  [ "$need_back" = 1 ] && write_backend_env

  if [ "$need_front" = 1 ] && [ -n "$SUPABASE_SERVICE_KEY" ] \
     && grep -qF "$SUPABASE_SERVICE_KEY" "$FRONT_FILE" 2>/dev/null; then
    rm -f "$FRONT_FILE"
    die "the service key ended up in .env.local - file removed. Re-run and paste it only at the service-key prompt."
  fi

  [ "$need_front" = 1 ] && ok ".env.local written (browser: URL + anon key only)"
  [ "$need_back" = 1 ] && ok "backend/.env written (service key stays server-side)"
  [ "$keep_front" = 1 ] && note ".env.local kept as-is"
  [ "$keep_back" = 1 ] && note "backend/.env kept as-is"
  return 0
}

# ---------- post-configuration steps ----------------------------------------
schema_reminder() {
  [ -n "${SUPABASE_URL-}" ] || SUPABASE_URL="$(env_get "$FRONT_FILE" VITE_SUPABASE_URL)"
  [ -n "${SUPABASE_URL-}" ] || return 0
  step "One manual step in Supabase"
  cat <<EOF
    1. Open your project -> SQL Editor
    2. Paste the contents of: $REPO_ROOT/backend/schema.sql
    3. Run it once (creates the tables + row-level security)
    4. Optional: Storage -> create a bucket named "documents" to keep receipt images
EOF
}

maybe_seed() {
  [ -n "$(env_get "$BACK_FILE" SUPABASE_SERVICE_KEY)" ] || return 0
  step "Demo data (optional)"
  if confirm "Seed/reset the demo account now?" n; then
    ( cd "$REPO_ROOT/backend" && "$VENV_PY" -m app.demo_seed ) || warn "seed failed (Supabase keys may be wrong) - the app still runs"
  else
    note "skipped - you can run it later: cd backend && .venv/Scripts/python -m app.demo_seed"
  fi
}

print_summary() {
  local mode="guest mode (no keys - demo data in the browser only)"
  [ -n "$(env_get "$BACK_FILE" SUPABASE_SERVICE_KEY)" ] && mode="signed-in mode (Supabase configured)"
  step "Done - $mode"
  note "frontend env: .env.local        backend env: backend/.env        (both gitignored)"
}

# ---------- run --------------------------------------------------------------
http_ok() { # url
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$1" >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=2 "$1" >/dev/null 2>&1 && return 0
    return 1
  fi
  "$VENV_PY" - "$1" >/dev/null 2>&1 <<'PY'
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
}

kill_tree() { # pid - stop a process and anything it spawned (Git Bash leftovers)
  local pid="$1" i
  kill "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  kill -9 "$pid" 2>/dev/null || true
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) command -v taskkill >/dev/null 2>&1 && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true ;;
  esac
}

pid_on_port() { # port -> listening pid(s), one per line (best effort)
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$port" '$1 == "TCP" && $4 == "LISTENING" && $2 ~ (p "$") { print $5 }'
  fi
  return 0
}

cleanup() {
  trap - EXIT INT TERM
  local port pid
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    printf '\n%s==>%s stopping frontend (pid %s)\n' "$C_OK" "$C_OFF" "$FRONTEND_PID"
    kill_tree "$FRONTEND_PID"
  fi
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    printf '%s==>%s stopping backend (pid %s)\n' "$C_OK" "$C_OFF" "$BACKEND_PID"
    kill_tree "$BACKEND_PID"
  fi
  # Safety net: npm/uvicorn children can outlive a killed parent (Git Bash).
  for port in 8080 8000; do
    for pid in $(pid_on_port "$port"); do
      [ "$pid" = "$$" ] && continue
      case "$(uname -s 2>/dev/null)" in
        MINGW*|MSYS*|CYGWIN*) command -v taskkill >/dev/null 2>&1 && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true ;;
        *) kill -9 "$pid" 2>/dev/null || true ;;
      esac
    done
  done
  BACKEND_PID=""
  FRONTEND_PID=""
}

on_signal() {
  cleanup
  printf '    stopped.\n\n'
  exit 130
}

start_backend() {
  step "Starting backend on http://localhost:8000"
  # No --reload: on Windows it spawns a worker that survives a plain kill.
  ( cd "$REPO_ROOT/backend" && exec "$VENV_PY" -m uvicorn app.main:app --port 8000 ) >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!

  local i
  for i in $(seq 1 30); do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      printf '\n'; tail -n 20 "$BACKEND_LOG" >&2
      die "backend exited during startup (see above). Full log: $BACKEND_LOG"
    fi
    if http_ok "http://127.0.0.1:8000/api/health"; then
      ok "backend healthy - API docs: http://localhost:8000/docs"
      return 0
    fi
    sleep 1
  done
  tail -n 20 "$BACKEND_LOG" >&2
  die "backend did not answer /api/health within 30s. Log: $BACKEND_LOG"
}

start_frontend() {
  step "Starting frontend on http://localhost:8080"
  note "press Ctrl+C to stop both servers"
  note "Open http://localhost:8080, sign in, press \"Explore as guest\""
  ( cd "$REPO_ROOT" && exec npm run dev ) &
  FRONTEND_PID=$!
  wait "$FRONTEND_PID"
}

# ---------- main -------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --no-run) NO_RUN=1 ;;
    --force-install) FORCE_INSTALL=1 ;;
    --interactive) NON_INTERACTIVE=0 ;;
    --help|-h) usage; exit 0 ;;
    *) usage; die "unknown option: $arg" ;;
  esac
done

printf '\n%sCashMonitoring setup%s  (%s)\n' "$C_OK" "$C_OFF" "$REPO_ROOT"

check_node
check_python
[ "$NO_RUN" = 0 ] && check_ports

install_frontend
install_backend
configure
schema_reminder
[ "$NO_RUN" = 0 ] && maybe_seed

if [ "$NO_RUN" = 1 ]; then
  print_summary
  step "Setup complete - start it with:"
  printf '    %s\n' "cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000   # terminal 1"
  printf '    %s\n\n' "npm run dev                                                              # terminal 2"
  exit 0
fi

# Ports again, right before binding - something may have taken them during install.
port_listening 8000 && die "port 8000 was taken while installing. Stop that process and re-run."
port_listening 8080 && die "port 8080 was taken while installing. Stop that process and re-run."

trap cleanup EXIT
# A signal must stop the servers and leave, not fall through to the next command.
trap on_signal INT TERM

print_summary
start_backend
start_frontend
