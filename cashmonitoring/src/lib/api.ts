// CONNECTION POINTS for the backend team. Every function here is a stub.
// Guest mode: keep data in memory only (SKILL.md §8) — never call Supabase.
import type { AdvisorReply, OcrDraft, Transaction } from "./types";
import { getArApSummary, getCashBalance, getRunwayMonths, predictNextMonthRevenue, usd } from "./calc";

/** TODO(C1): supabase.auth.signInWithPassword */
export async function signIn(_email: string, _password: string) { await wait(500); return { ok: true }; }

/** TODO(A1): insert into transactions (only reviewed rows). */
export async function saveTransaction(t: Transaction) { await wait(300); return t; }

/** TODO(A2): upload file → OpenRouter vision model → documents.ocr_raw_json (reviewed=false). */
export async function runOcr(file: File): Promise<OcrDraft> {
  await wait(1600);
  return { doc_type: /invoice/i.test(file.name) ? "invoice" : "receipt", fields: { vendor_or_customer: "Paper Mill Ltd", amount: 486.2, category: "Supplies", transaction_date: "2026-11-12", type: "expense", status: "paid" } };
}

/** TODO(C3): call email API with generated report. */
export async function sendTestReport(email: string) { await wait(900); return { sentTo: email }; }

/** TODO(B2): tool-calling advisor. Only answers via named calc tools; refuses otherwise. */
export async function askAdvisor(q: string, tx: Transaction[]): Promise<AdvisorReply> {
  await wait(900); const s = q.toLowerCase();
  if (/predict|forecast|next month/.test(s)) { const p = predictNextMonthRevenue(tx); return { tool: "predict_next_month_revenue", text: `Projected revenue for December is shown below. Method: ${p.method}. It is a simple projection, not a guarantee.`, figures: [{ label: "Projected revenue", value: usd(p.value) }] }; }
  if (/ar|ap|receivable|payable|owe/.test(s)) { const a = getArApSummary(tx); return { tool: "ar_ap_summary", text: "Open receivables and payables, from your recorded invoices and bills.", figures: [{ label: "Open AR", value: usd(a.ar) }, { label: "Overdue AR", value: usd(a.arOverdue) }, { label: "Open AP", value: usd(a.ap) }] }; }
  if (/cash|runway|flow|analy/.test(s)) return { tool: "analyze_cash_flow", text: "Your runway is below your own warning threshold. Collecting overdue receivables is the fastest lever. Market context (qualitative only): credit conditions are easing.", figures: [{ label: "Cash balance", value: usd(getCashBalance(tx)) }, { label: "Runway", value: `${getRunwayMonths(tx).toFixed(1)} months` }] };
  if (/statement|p&l|profit/.test(s)) return { tool: "generate_financial_statement", text: "Statement for the trailing 12 months is ready (backend will render it)." };
  return { text: "I don't have a tool that can answer that, so I won't guess. I can analyze cash flow, summarize AR/AP, generate a statement, or predict next month's revenue." };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
