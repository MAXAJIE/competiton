// Mirrors SKILL.md §9. Keep in sync with the Supabase schema.
export type TxType = "income" | "expense" | "ar" | "ap";
export type TxStatus = "paid" | "pending" | "overdue";
export interface Transaction {
  id: string; type: TxType; category: string; vendor_or_customer: string;
  amount: number; currency: "USD"; transaction_date: string;
  due_date: string | null; status: TxStatus; source: "manual" | "ocr";
}
export interface RiskSettings { low_cash_threshold_months: number; warning_email: string; enabled: boolean; ar_overdue_spike_pct: number; }
/** One uploaded page and what the vision model read from that page alone. */
export interface OcrPage {
  index: number;
  fields: Partial<Transaction>;
  notes?: string[];
  model?: string;
}

export interface OcrDraft {
  doc_type: "receipt" | "invoice" | "bank_statement";
  fields: Partial<Transaction>;
  /** Per-page readings; the dialog steps through these before the merged form. */
  pages?: OcrPage[];
  /** Human-readable warnings from normalization (e.g. "date not readable"). */
  notes?: string[];
  /** Which pinned vision model produced this extraction. */
  model?: string;
  document_id?: string;
}
export interface AdvisorReply {
  text: string;
  tool?: string;
  figures?: { label: string; value: string }[];
  /** Web citations, present when the answer relied on a live lookup. */
  sources?: { title: string; url: string }[] | null;
}
