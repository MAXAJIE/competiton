// Mirrors SKILL.md §9. Keep in sync with the Supabase schema.
export type TxType = "income" | "expense" | "ar" | "ap";
export type TxStatus = "paid" | "pending" | "overdue";
export interface Transaction {
  id: string; type: TxType; category: string; vendor_or_customer: string;
  amount: number; currency: "USD"; transaction_date: string;
  due_date: string | null; status: TxStatus; source: "manual" | "ocr";
  /** When the row was recorded. A scan of a July invoice is still new today. */
  created_at?: string;
  /** Set on rows that came through the OCR confirm gate. */
  document_id?: string | null;
}
export interface RiskSettings { low_cash_threshold_months: number; warning_email: string; enabled: boolean; ar_overdue_spike_pct: number; }
export interface OcrDraft {
  doc_type: "receipt" | "invoice" | "bank_statement";
  fields: Partial<Transaction>;
  /** Human-readable warnings from normalization (e.g. "date not readable"). */
  notes?: string[];
  /** Which pinned vision model produced this extraction. */
  model?: string;
  document_id?: string;
}
export interface AdvisorReply { text: string; tool?: string; figures?: { label: string; value: string }[]; }
