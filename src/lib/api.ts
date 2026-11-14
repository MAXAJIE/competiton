// Real backend client. Every function maps 1:1 to the FastAPI endpoints in
// backend/ (see backend/README.md). Guest mode (SKILL.md §8): no session →
// no server calls for writes; data stays in the browser session store.
import { supabase, sessionOrNull } from "./supabase";
import type { ArRiskFlag } from "./calc";
import type { AdvisorReply, OcrDraft, RiskSettings, Transaction } from "./types";

const API_URL = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await sessionOrNull();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init.headers,
    },
  });
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
/** A receivable the backend closed because this payment settled it. */
export interface SettledAr { id: string; vendor_or_customer: string; amount: number }

export type SavedTransaction = Transaction & { settled_ar?: SettledAr[] };

export async function saveTransaction(t: Transaction): Promise<SavedTransaction> {
  if (!(await sessionOrNull())) return t; // guest — never touches the server
  return api<SavedTransaction>("/api/transactions", { method: "POST", body: JSON.stringify(t) });
}

/** POST /api/documents/ocr — extraction only, reviewed=false, nothing saved.
 *  Accepts multiple page images for one document. */
export async function runOcr(files: File[], docType = ""): Promise<OcrDraft> {
  const session = await sessionOrNull();
  if (!session) throw new Error("Sign in to scan documents — guest mode never uploads anything.");
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (docType) form.append("doc_type", docType);
  const res = await fetch(`${API_URL}/api/documents/ocr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(typeof body.detail === "string" ? body.detail : "OCR failed");
  }
  return res.json() as Promise<OcrDraft>;
}

/** POST /api/documents/{id}/confirm — the human-review gate: flips reviewed=true
 * and writes the transaction in one server-side call. */
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

/** POST /api/forecast — next-month revenue from the trained regression (§11.1). */
export async function fetchForecast(tx: Transaction[]): Promise<{
  value: number; method: string; source: string; baseline_value: number | null; target_month?: string;
} | null> {
  try {
    return await api("/api/forecast", { method: "POST", body: JSON.stringify({ transactions: tx }) });
  } catch {
    return null; // offline/guest → caller falls back to the local trailing-average display
  }
}

/** POST /api/ar/risk — AR rows scored by the trained classifier (§11.2). */
export async function fetchArRisk(tx: Transaction[]): Promise<{
  scored: number;
  at_risk: number;
  at_risk_amount: number;
  high_risk: number;
  high_risk_amount: number;
  open_amount: number;
  source: string;
  method: string;
  top: ArRiskFlag[];
} | null> {
  try {
    return await api("/api/ar/risk", { method: "POST", body: JSON.stringify({ transactions: tx }) });
  } catch {
    return null;
  }
}

/** GET /api/market/snapshot — cached qualitative color; null if unavailable. */
export async function fetchMarketSnapshot(): Promise<{ fetched_at: string; indicators: { k: string; v: string; d: string }[]; headlines: string[] } | null> {
  try {
    return await api("/api/market/snapshot");
  } catch {
    return null; // guest/offline → fall back to bundled demo color
  }
}
