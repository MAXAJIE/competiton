// Mirrors SKILL.md §9. Keep in sync with the Supabase schema.
export type TxType = "income" | "expense" | "ar" | "ap";
export type TxStatus = "paid" | "pending" | "overdue";
export interface Transaction {
  id: string; type: TxType; category: string; vendor_or_customer: string;
  amount: number; currency: "USD"; transaction_date: string;
  due_date: string | null; status: TxStatus; source: "manual" | "ocr";
}
export interface RiskSettings { low_cash_threshold_months: number; warning_email: string; enabled: boolean; ar_overdue_spike_pct: number; }
export interface OcrDraft { doc_type: "receipt" | "invoice" | "bank_statement"; fields: Partial<Transaction>; }
export interface AdvisorReply { text: string; tool?: string; figures?: { label: string; value: string }[]; }
