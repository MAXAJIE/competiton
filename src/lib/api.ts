// Real backend client. Every function maps 1:1 to the FastAPI endpoints in
// backend/ (see backend/README.md). Guest mode (SKILL.md §8): no session →
// no server calls for writes; data stays in the browser session store.
import { supabase, sessionOrNull, AUTH_CONFIGURED } from "./supabase";
import { aiKeyHeader } from "./ai";
import type { OcrScanResult } from "./ocr-types";
import type { AdvisorReply, RiskSettings, Transaction } from "./types";

/** Absolute base URL for the API.
 *
 * A value pasted without a scheme ("my-api.up.railway.app") makes fetch() treat
 * it as a *relative* path, so every call silently hits the frontend origin
 * instead of the backend — a 404 that looks like a broken API. Normalise here
 * so a missing "https://" in a build variable cannot do that.
 */
export function normaliseApiBase(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/i.test(value);
  return `${isLocal ? "http" : "https"}://${value}`;
}

const API_URL = normaliseApiBase(
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000",
);

/** An API failure with its HTTP status kept, so callers can tell 404 from 500. */
export type ApiError = Error & { status?: number };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await sessionOrNull();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch() rejects here for: backend down, wrong VITE_API_URL, mixed
    // content (an https site calling http://localhost), or CORS. Say which URL
    // failed so a deployed site diagnoses itself.
    throw new Error(
      `Could not reach the backend at ${API_URL}. A deployed site needs VITE_API_URL set to a https:// backend URL at build time — localhost only works when the site runs on the same machine.`,
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(readError(body, res.status)) as ApiError;
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

/**
 * Turn any error body into one line a person can act on.
 *
 * FastAPI answers a rejected field with a 422 whose `detail` is an array of
 * {loc, msg} objects. Rendering that array directly gave "Request failed (422)" —
 * the single least useful message in the app. This picks the first problem and
 * names the field, so "amount: Input should be greater than 0" reaches the user.
 */
export function readError(body: unknown, status: number): string {
  const record = (body ?? {}) as { detail?: unknown; error?: unknown };
  const detail = record.detail ?? record.error;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: unknown; loc?: unknown };
    const message = typeof first?.msg === "string" ? first.msg.replace(/^Value error, /, "") : "";
    const path = Array.isArray(first?.loc)
      ? first.loc.filter((part) => typeof part === "string").slice(-1)[0]
      : undefined;
    if (message) return path ? `${path}: ${message}` : message;
  }
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 401) return "Please sign in again — that session is no longer valid.";
  if (status === 413) return "That file is too large.";
  return `Request failed (${status})`;
}

/**
 * A tiny TTL cache for reads that rarely change.
 *
 * The market snapshot, the model inventory and the AI capability flags are the
 * same for everyone and change on the order of minutes to days. Without this,
 * every page mount asked the backend again — and every visitor paid for it.
 * Only successful results are kept, so a backend hiccup is retried next time.
 * User data (ledger, settings, consent) is never cached here.
 */
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => {
    // A failed load must not be remembered as an answer.
    if (memo.get(key)?.value === value) memo.delete(key);
  });
  return value;
}

/** Drop every cached read (tests, and after a destructive account change). */
export function clearApiCache(): void {
  memo.clear();
}

/** Drop one cached read, e.g. consent right after it is recorded. */
export function dropCached(key: string): void {
  memo.delete(key);
}

/** Sign in with email + password (Supabase auth). */
export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Create an account through the backend, which is where the legal gate lives.
 *
 * The form's checkboxes are a convenience; the server re-checks the age
 * affirmation, the acceptance and the document versions, records the consent on
 * the account, and only then exists as a user. When Supabase requires email
 * confirmation there is no session yet — the caller must say "check your email"
 * instead of pretending a sign-in happened.
 */
export type CreateAccountInput = {
  email: string;
  password: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  termsVersion: string;
  privacyVersion: string;
};

export async function createAccount(
  input: CreateAccountInput,
): Promise<{ needsConfirmation: boolean }> {
  const result = await api<{
    ok: boolean;
    needs_confirmation: boolean;
    access_token: string | null;
    refresh_token: string | null;
  }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      age_confirmed: input.ageConfirmed,
      terms_accepted: input.termsAccepted,
      terms_version: input.termsVersion,
      privacy_version: input.privacyVersion,
    }),
  });
  if (!result.needs_confirmation && result.access_token && result.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (error) throw new Error(error.message);
  }
  return { needsConfirmation: Boolean(result.needs_confirmation) };
}

/** GET /api/account/consent — what this account accepted, and what is current. */
export type ConsentRecord = {
  terms_version: string;
  privacy_version: string;
  age_confirmed: boolean;
  accepted_at: string;
};

export type ConsentState = {
  consent: ConsentRecord | null;
  terms_version: string;
  privacy_version: string;
  min_age: number;
};

export async function fetchConsent(): Promise<ConsentState | null> {
  try {
    // Short-lived: the answer decides whether the app is usable, so the entry is
    // dropped the moment an acceptance is recorded (see acceptConsent).
    return await cached("consent", 5 * 60_000, () => api<ConsentState>("/api/account/consent"));
  } catch {
    return null;
  }
}

/** POST /api/account/consent — for sign-ins that skipped the signup form (OAuth). */
export async function acceptConsent(input: {
  ageConfirmed: boolean;
  termsVersion: string;
  privacyVersion: string;
}): Promise<void> {
  await api("/api/account/consent", {
    method: "POST",
    body: JSON.stringify({
      age_confirmed: input.ageConfirmed,
      terms_accepted: true,
      terms_version: input.termsVersion,
      privacy_version: input.privacyVersion,
    }),
  });
  // The guard caches "no consent yet"; without this the next navigation would
  // still think the account had not accepted and bounce straight back here.
  dropCached("consent");
}

/** GET /api/legal — versions and retention numbers, so the UI quotes the truth. */
export type LegalConfig = {
  terms_version: string;
  privacy_version: string;
  min_age: number;
  retention: {
    transactions_days: number;
    documents_days: number;
    max_transactions: number;
    max_documents: number;
  };
  purpose: string;
};

export async function fetchLegalConfig(): Promise<LegalConfig | null> {
  try {
    return await cached("legal", 10 * 60_000, () => api<LegalConfig>("/api/legal"));
  } catch {
    return null;
  }
}

export type ApiCapabilities = { version: string; features: string[] };

/**
 * What the backend in front of this build can do (`GET /api/health`).
 *
 * The account-lifecycle routes are new, and a deployment that predates them
 * answers a delete request with a bare 404. Reading the advertised features
 * lets the UI say "this backend is old" *before* a user clicks a destructive
 * button that cannot work. A backend that does not advertise features is
 * treated as unknown, never as capable.
 */
export async function fetchApiCapabilities(): Promise<ApiCapabilities | null> {
  try {
    const body = await api<{ version?: unknown; features?: unknown }>("/api/health");
    return {
      version: typeof body.version === "string" ? body.version : "unknown",
      features: Array.isArray(body.features)
        ? body.features.filter((f): f is string => typeof f === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export type DeletedCounts = {
  transactions: number;
  documents: number;
  risk_settings: number;
  uploads: number;
  account?: string;
};

/** DELETE /api/account/data — erase rows and uploads, keep the account. */
/**
 * A destructive account call, with the one failure worth translating.
 *
 * On these routes a 404/405 does not mean "no data" — it means the backend in
 * front of this build predates the route, so nothing was deleted. Reported
 * verbatim, that failure looked like a dead button.
 */
async function accountCall<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    const status = (error as ApiError).status;
    if (status === 404 || status === 405) {
      throw new Error(
        `This backend has no ${path} route (HTTP ${status}), so nothing was deleted. ` +
          "It is running an older build than this site — deploy the current backend/ code and try again.",
      );
    }
    throw error;
  }
}

export async function deleteMyData(): Promise<DeletedCounts> {
  const result = await accountCall<{ ok: boolean; deleted: DeletedCounts }>("/api/account/data", {
    method: "DELETE",
  });
  return result.deleted;
}

/** DELETE /api/account — erase the account itself. Irreversible. */
export async function deleteMyAccount(): Promise<DeletedCounts> {
  const result = await accountCall<{ ok: boolean; deleted: DeletedCounts }>("/api/account", {
    method: "DELETE",
  });
  await supabase.auth.signOut().catch(() => undefined);
  clearApiCache();
  return result.deleted;
}

/** POST /api/account/retention — run the retention sweep now. */
export async function applyRetention(): Promise<DeletedCounts> {
  const result = await accountCall<{ ok: boolean; removed: DeletedCounts }>(
    "/api/account/retention",
    { method: "POST" },
  );
  return result.removed;
}

/** Google OAuth via Supabase (redirects away and back; PKCE flow). */
export async function signInWithGoogle() {
  if (!AUTH_CONFIGURED) {
    throw new Error(
      "Google sign-in is not configured in this build: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. Set them in the deploy platform's build settings and redeploy.",
    );
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/login` },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await supabase.auth.signOut();
  // Nothing user-specific is cached, but a shared device should not keep even
  // the capability flags from the account that just left.
  clearApiCache();
}

export async function isSignedIn() {
  return (await sessionOrNull()) != null;
}

/** GET /api/transactions — full ledger for the signed-in user. */
export async function fetchTransactions(): Promise<Transaction[]> {
  const r = await api<{ transactions: Transaction[] }>("/api/transactions");
  return r.transactions;
}

/** POST /api/transactions (manual rows only). Guest mode: local only. */
export async function saveTransaction(t: Transaction): Promise<SavedTransaction> {
  if (!(await sessionOrNull())) return t; // guest — never touches the server
  return api<SavedTransaction>("/api/transactions", { method: "POST", body: JSON.stringify(t) });
}

/** POST /api/documents/ocr — extraction only, reviewed=false, nothing saved.
 *  Each image is read as its own entry; unreadable images come back with a reason. */
export async function runOcr(files: File[], docType = ""): Promise<OcrScanResult> {
  const session = await sessionOrNull();
  if (!session) throw new Error("Sign in to scan documents — guest mode never uploads anything.");
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (docType) form.append("doc_type", docType);
  const res = await fetch(`${API_URL}/api/documents/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, ...aiKeyHeader() },
    body: form,
  }).catch(() => {
    throw new Error(
      `Could not reach the backend at ${API_URL}. A deployed site needs VITE_API_URL set to a https:// backend URL at build time.`,
    );
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(readError(body, res.status));
  }
  return res.json() as Promise<OcrScanResult>;
}

/** POST /api/documents/{id}/confirm — the human-review gate: flips reviewed=true
 * and writes the transaction in one server-side call. */
/** A saved row, plus the receivables this payment settled (backend contract). */
export type SavedTransaction = Transaction & {
  settled_ar?: { id: string; vendor_or_customer: string; amount: number }[];
};

export async function confirmOcr(
  documentId: string,
  fields: Partial<Transaction>,
): Promise<SavedTransaction> {
  return api<SavedTransaction>(`/api/documents/${documentId}/confirm`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

/** POST /api/reports/test — send the generated report now (auth required). */
export async function sendTestReport(email: string): Promise<{ sentTo: string }> {
  return api<{ sentTo: string }>("/api/reports/test", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** GET /api/ai/config — server key available? which provider? (never a key). */
export type AiConfig = {
  provider: "openrouter";
  server_key: boolean;
  byok_supported: boolean;
  models: { ocr: string | null; advisor: string | null };
};

export async function fetchAiConfig(): Promise<AiConfig | null> {
  try {
    return await cached("ai-config", 5 * 60_000, () => api<AiConfig>("/api/ai/config"));
  } catch {
    return null; // backend down — the page says so rather than guessing
  }
}

export type KeyCheck = {
  ok: boolean;
  label: string;
  limit: number | null;
  usage: number | null;
  free_tier: boolean | null;
};

/** POST /api/ai/key/test — validate a pasted OpenRouter key before saving it. */
export async function testAiKey(key: string): Promise<KeyCheck> {
  return api<KeyCheck>("/api/ai/key/test", {
    method: "POST",
    body: JSON.stringify({ api_key: key }),
  });
}

/** GET /api/settings — the user's risk vault. */
export async function getRiskSettings(): Promise<RiskSettings | null> {
  if (!(await sessionOrNull())) return null;
  return api<RiskSettings>("/api/settings");
}

/** PUT /api/settings — persist the risk vault (auth required). */
export async function saveRiskSettings(r: RiskSettings): Promise<RiskSettings> {
  return api<RiskSettings>("/api/settings", { method: "PUT", body: JSON.stringify(r) });
}

/** POST /api/advisor — tool-calling only; figures come from server-side calc. */
export async function askAdvisor(q: string, tx: Transaction[]): Promise<AdvisorReply> {
  return api<AdvisorReply>("/api/advisor", {
    method: "POST",
    body: JSON.stringify({ question: q, transactions: tx }),
    headers: aiKeyHeader(),
  });
}

/** GET /api/market/snapshot — cached qualitative color; null if unavailable. */
export async function fetchMarketSnapshot(): Promise<{
  fetched_at: string;
  indicators: { k: string; v: string; d: string }[];
  headlines: string[];
} | null> {
  try {
    // Five minutes: this is a scheduled snapshot, not a live quote.
    return await cached("market", 5 * 60_000, () => api("/api/market/snapshot"));
  } catch {
    return null; // guest/offline → fall back to bundled demo color
  }
}

// --- scored models (SKILL.md §11) -------------------------------------------
// The ledger travels in the request body, so these work in guest mode too:
// the backend only falls back to the stored ledger when the body is empty.

export type ForecastSource = "model" | "fallback_trailing_average" | "none";

export type ForecastResult = {
  value: number;
  method: string;
  source: ForecastSource;
  baseline_value: number | null;
  target_month: string | null;
};

export type ArRiskSeverity = "high" | "medium" | "low";

/** One open receivable scored for late-payment risk by the backend. */
export type ArRiskFlag = {
  id: string | null;
  vendor_or_customer: string;
  amount: number;
  category: string;
  due_date: string | null;
  status: "pending" | "overdue";
  days_until_due: number;
  customer_historical_late_rate: number;
  customer_prior_count: number;
  p_late: number;
  /** True when due_date has passed unpaid: late is a fact, not a prediction. */
  already_late?: boolean;
  days_overdue?: number;
  /** What the classifier alone said — kept for transparency, never displayed as risk. */
  model_p_late?: number | null;
  /** Ordering key: overdue rows by amount x days overdue, others by p_late x amount. */
  priority?: number;
  at_risk: boolean;
  severity: ArRiskSeverity;
  threshold: number;
  source: string;
};

export type ArRiskSummary = {
  scored: number;
  at_risk: number;
  at_risk_amount: number;
  high_risk: number;
  high_risk_amount: number;
  /** Already past due: certain, not forecast. */
  overdue_count?: number;
  overdue_amount?: number;
  /** Not yet due, but the model expects a late payment. */
  predicted_high_count?: number;
  predicted_high_amount?: number;
  open_amount: number;
  top: ArRiskFlag[];
  method: string;
  source: string;
};

export type RevenueModelMetrics = {
  model?: string;
  rows?: { total: number; train: number; test: number };
  features?: string[];
  baseline?: { name: string; mae: number };
  model_metrics?: { mae: number };
  improvement_pct?: number;
  coefficients?: Record<string, number>;
  failure_case?: {
    month: string;
    actual: number;
    predicted: number;
    error: number;
    hypothesis: string;
  };
};

export type ArModelMetrics = {
  model?: string;
  rows?: { total: number; train: number; test: number };
  baseline?: {
    name: string;
    accuracy: number;
    late_caught: number;
    late_actual: number;
    note?: string;
  };
  model_metrics?: { accuracy: number; precision: number; recall: number; f1: number };
  confusion_matrix?: {
    labels: string[];
    matrix: number[][];
    true_negative: number;
    false_positive: number;
    false_negative: number;
    true_positive: number;
    late_actual: number;
    late_caught: number;
  };
  threshold?: number;
  threshold_tuned_on?: string;
  features?: string[];
  failure_case?: {
    kind: string;
    vendor_or_customer: string;
    amount: number;
    category: string;
    days_until_due: number;
    p_late: number;
    hypothesis: string;
  };
};

export type ModelInfo = {
  ar_risk: boolean;
  revenue_forecast: boolean;
  metrics: {
    generated_at?: string;
    revenue?: RevenueModelMetrics;
    ar_risk?: ArModelMetrics;
  };
};

/** POST /api/forecast — next-month revenue from the trained regression. */
export async function fetchForecast(tx: Transaction[]): Promise<ForecastResult | null> {
  try {
    return await api<ForecastResult>("/api/forecast", {
      method: "POST",
      body: JSON.stringify({ transactions: tx }),
    });
  } catch {
    return null; // offline → the page shows the degraded state instead of guessing
  }
}

/** POST /api/ar/risk — open AR rows scored by the trained classifier. */
export async function fetchArRisk(tx: Transaction[]): Promise<ArRiskSummary | null> {
  try {
    return await api<ArRiskSummary>("/api/ar/risk", {
      method: "POST",
      body: JSON.stringify({ transactions: tx }),
    });
  } catch {
    return null;
  }
}

/** GET /api/models/info — which artifacts loaded + the held-out metrics. */
export async function fetchModelsInfo(): Promise<ModelInfo | null> {
  try {
    // Training metrics change when a model is rebuilt, i.e. rarely.
    return await cached("models", 10 * 60_000, () => api<ModelInfo>("/api/models/info"));
  } catch {
    return null;
  }
}
