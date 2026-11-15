// Real backend client. Every function maps 1:1 to the FastAPI endpoints in
// backend/ (see backend/README.md). Guest mode (SKILL.md §8): no session →
// no server calls for writes; data stays in the browser session store.
import { supabase, sessionOrNull, AUTH_CONFIGURED } from "./supabase";
import type { OcrScanResult } from "./ocr-types";
import type { AdvisorReply, RiskSettings, Transaction } from "./types";

const API_URL = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000";

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
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Sign in with email + password (Supabase auth). */
export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { ok: true };
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
export async function saveTransaction(t: Transaction): Promise<Transaction> {
  if (!(await sessionOrNull())) return t; // guest — never touches the server
  return api<Transaction>("/api/transactions", { method: "POST", body: JSON.stringify(t) });
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
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  }).catch(() => {
    throw new Error(
      `Could not reach the backend at ${API_URL}. A deployed site needs VITE_API_URL set to a https:// backend URL at build time.`,
    );
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(typeof body.detail === "string" ? body.detail : "OCR failed");
  }
  return res.json() as Promise<OcrScanResult>;
}

/** POST /api/documents/{id}/confirm — the human-review gate: flips reviewed=true
 * and writes the transaction in one server-side call. */
/** A saved row, plus the receivables this payment settled (backend contract). */
export type SavedTransaction = Transaction & { settled_ar?: { id: string; vendor_or_customer: string; amount: number }[] };

export async function confirmOcr(documentId: string, fields: Partial<Transaction>): Promise<SavedTransaction> {
  return api<SavedTransaction>(`/api/documents/${documentId}/confirm`, {
    method: "POST",
    body: JSON.stringify(fields),
  });
}

/** POST /api/reports/test — send the generated report now (auth required). */
export async function sendTestReport(email: string): Promise<{ sentTo: string }> {
  return api<{ sentTo: string }>("/api/reports/test", { method: "POST", body: JSON.stringify({ email }) });
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
  });
}

/** GET /api/market/snapshot — cached qualitative color; null if unavailable. */
export async function fetchMarketSnapshot(): Promise<{ fetched_at: string; indicators: { k: string; v: string; d: string }[]; headlines: string[] } | null> {
  try {
    return await api("/api/market/snapshot");
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
    return await api<ModelInfo>("/api/models/info");
  } catch {
    return null;
  }
}
