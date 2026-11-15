// Documents are scanned one image at a time. Each image is an INDEPENDENT entry:
// two receipts photographed together are two transactions, never one document
// with two pages, so nothing is merged and each entry confirms on its own.
import type { Transaction } from "./types";

/** One scanned image: either a reviewable entry, or a reported failure. */
export interface OcrEntry {
  index: number;
  name: string;
  ok: boolean;
  /** Present when ok: the document to confirm and the fields read from it. */
  doc_type?: "receipt" | "invoice" | "bank_statement";
  fields?: Partial<Transaction>;
  notes?: string[];
  model?: string;
  document_id?: string;
  /** Present when !ok: why this image could not become an entry. */
  reason?: string;
  detail?: string;
}

export interface OcrScanResult {
  entries: OcrEntry[];
  saved: number;
  skipped: number;
}
