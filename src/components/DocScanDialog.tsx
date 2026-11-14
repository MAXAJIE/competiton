// Document scan dialog — drop/preview → extract → page-by-page check → merged preview → confirm.
//
// Two review stages on purpose:
//   1. "pages": with more than one image, each page is shown beside what the
//      model read from THAT page, one page at a time ("Next page →"), so a
//      second page's lines are never silently mixed into the first.
//   2. "confirm": the merged result, images on the left and the filled-in form
//      on the right — the only place a save can happen.
//
// The extracted values are never saved automatically: confirming goes through
// POST /api/documents/{id}/confirm, which flips reviewed=true and writes the
// transaction in one call (SKILL.md §4).
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TxForm } from "@/components/TxForm";
import { confirmOcr, runOcr } from "@/lib/api";
import { usd } from "@/lib/calc";
import type { OcrDraft, OcrPage, Transaction } from "@/lib/types";

const MAX_PAGES = 5;
const MAX_EDGE = 1600;

type Page = { file: File; preview: string | null; name: string };
type Stage = "pick" | "pages" | "confirm";

async function compressImage(file: File): Promise<File> {
  // A 12MP phone photo is ~5MB; downscale so the request stays small.
  if (!file.type.startsWith("image/")) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    if (scale === 1) { URL.revokeObjectURL(url); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/jpeg", 0.85));
    URL.revokeObjectURL(url);
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // fall back to the original bytes
  }
}

const DOC_LABELS = [
  ["", "Auto-detect"],
  ["receipt", "Receipt"],
  ["invoice", "Invoice"],
  ["bank_statement", "Bank statement"],
] as const;

/** The fields worth showing per page — what the model read off that image. */
const PAGE_ROWS: { key: keyof Transaction; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "transaction_date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "vendor_or_customer", label: "Customer / vendor" },
  { key: "category", label: "Category" },
  { key: "due_date", label: "Due date" },
];

function showValue(key: keyof Transaction, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (key === "amount") return usd(Number(v));
  return String(v);
}

export function DocScanDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Returns the receivables this save settled, so the caller can report them. */
  onSaved: (t: Transaction, settledIds?: string[]) => Transaction[];
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [docType, setDocType] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<OcrDraft | null>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPages([]); setDraft(null); setError(null); setDocType(""); setStage("pick"); setStep(0); };
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset(); };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_PAGES - pages.length;
    if (room <= 0) { toast.error(`Maximum ${MAX_PAGES} pages.`); return; }
    const picked = Array.from(list).slice(0, room);
    const next: Page[] = [];
    for (const f of picked) {
      const compressed = await compressImage(f);
      next.push({
        file: compressed,
        name: f.name,
        preview: compressed.type.startsWith("image/") ? URL.createObjectURL(compressed) : null,
      });
    }
    setPages(p => [...p, ...next]);
    setDraft(null);
    setStage("pick");
    setError(null);
  };

  const scan = async () => {
    if (!pages.length) return;
    setBusy(true); setError(null);
    try {
      const d = await runOcr(pages.map(p => p.file), docType);
      setDraft(d);
      // Multiple pages get checked one at a time first; a single page has
      // nothing to step through, so it goes straight to the form.
      const multi = (d.pages?.length ?? 0) > 1;
      setStage(multi ? "pages" : "confirm");
      setStep(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (t: Transaction) => {
    if (!draft?.document_id) return;
    setBusy(true);
    try {
      const saved = await confirmOcr(draft.document_id, t);
      const closed = onSaved({ ...t, id: saved.id ?? t.id }, saved.settled_ar?.map(r => r.id));
      if (closed.length > 0) {
        const who = [...new Set(closed.map(r => r.vendor_or_customer))].join(", ");
        toast.success(`Saved, and marked ${closed.length} invoice${closed.length > 1 ? "s" : ""} from ${who} as paid`);
      } else {
        toast.success("Reviewed and saved to ledger");
      }
      close(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  // Older backends (or a whole-document fallback) may return no per-page array:
  // treat the merged reading as page 1 so the dialog still works.
  const pageList: OcrPage[] = draft
    ? (draft.pages && draft.pages.length
      ? draft.pages
      : [{ index: 1, fields: draft.fields, notes: draft.notes ?? [], model: draft.model ?? "" }])
    : [];
  const currentPage = pageList[Math.min(step, pageList.length - 1)];
  const isLastPage = step >= pageList.length - 1;

  const title = stage === "confirm"
    ? "Check the merged details"
    : stage === "pages"
      ? `Check page ${step + 1} of ${pageList.length}`
      : "Scan a document";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {stage === "confirm"
              ? "Nothing is saved until you confirm. Edit anything the model got wrong."
              : stage === "pages"
                ? "One page at a time: check each image against what was read from it. Nothing is saved yet."
                : "Receipt, invoice or bank-statement line. Nothing is saved until you confirm."}
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" && (
          <>
            <label
              className="mt-2 flex h-40 cursor-pointer flex-col items-center justify-center border border-dashed border-foreground/40 text-center hover:bg-secondary"
              onDragOver={e => e.preventDefault()}
              onDrop={async e => { e.preventDefault(); await addFiles(e.dataTransfer.files); }}
            >
              <p className="font-display text-2xl">{pages.length ? "Add another page" : "Drop an image here"}</p>
              <p className="eyebrow mt-1">or click to choose · images or PDF · up to {MAX_PAGES} pages</p>
              <input ref={inputRef} type="file" multiple accept="image/*,.pdf" className="hidden"
                     onChange={async e => { await addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }} />
            </label>

            {pages.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {pages.map((p, i) => (
                  <div key={i} className="relative border bg-secondary/40 p-1">
                    {p.preview
                      ? <img src={p.preview} alt={p.name} className="h-24 w-24 object-cover" />
                      : <div className="flex h-24 w-24 items-center justify-center px-2 text-center text-[11px] text-muted-foreground">{p.name}</div>}
                    <span className="absolute left-1 top-1 bg-foreground px-1 text-[10px] text-background">{i + 1}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${p.name}`}
                      className="absolute -right-2 -top-2 border bg-background px-1 text-xs"
                      onClick={() => setPages(prev => prev.filter((_, j) => j !== i))}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <label className="mt-4 block max-w-xs">
              <span className="eyebrow">Document type</span>
              <select className="field" value={docType} onChange={e => setDocType(e.target.value)}>
                {DOC_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>

            {error && <p className="mt-4 border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-sm">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button type="button" className="btn btn-solid" disabled={!pages.length || busy} onClick={scan}>
                {busy ? "Reading document…" : pages.length > 1 ? `Read ${pages.length} pages →` : "Scan document →"}
              </button>
              <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              {busy && (
                <span className="eyebrow animate-pulse">
                  {pages.length > 1 ? `vision model working through ${pages.length} pages…` : "vision model working…"}
                </span>
              )}
            </div>
          </>
        )}

        {stage === "pages" && draft && currentPage && (
          <div className="mt-2 grid gap-6 md:grid-cols-2">
            <div>
              {pages[step]?.preview
                ? <img src={pages[step].preview!} alt={pages[step].name} className="w-full border object-contain" />
                : <div className="flex h-56 items-center justify-center border text-xs text-muted-foreground">
                    {pages[step]?.name ?? `Page ${step + 1}`} · preview unavailable
                  </div>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {pageList.map((p, i) => (
                  <button
                    key={p.index}
                    type="button"
                    onClick={() => setStep(i)}
                    aria-current={i === step}
                    className={`border px-2 py-1 text-xs ${i === step ? "border-foreground bg-foreground text-background" : "hover:bg-secondary"}`}
                  >
                    {i + 1}
                  </button>
                ))}
                <span className="eyebrow ml-auto">{pages[step]?.name ?? ""}</span>
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3 text-warning">Page {currentPage.index} · read from this image only</p>
              <dl className="divide-y border-y">
                {PAGE_ROWS.map(({ key, label }) => {
                  const value = showValue(key, currentPage.fields[key]);
                  return (
                    <div key={key} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="eyebrow">{label}</dt>
                      <dd className={`text-right ${value ? "" : "text-muted-foreground"}`}>
                        {value ?? "not on this page"}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              {currentPage.notes && currentPage.notes.length > 0 && (
                <ul className="mt-4 space-y-1 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                  {currentPage.notes.map(n => <li key={n}>• {n}</li>)}
                </ul>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn btn-solid"
                  onClick={() => (isLastPage ? setStage("confirm") : setStep(s => s + 1))}
                >
                  {isLastPage ? "Preview merged entry →" : "Next page →"}
                </button>
                <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {isLastPage
                  ? "All pages checked — the merged entry comes next."
                  : `${pageList.length - 1 - step} page${pageList.length - 1 - step > 1 ? "s" : ""} left to check.`}
              </p>
            </div>
          </div>
        )}

        {stage === "confirm" && draft && (
          <div className="mt-2 grid gap-6 md:grid-cols-[240px_1fr]">
            <div className="space-y-3">
              {pages.map((p, i) => (
                <div key={i} className="border p-1">
                  {p.preview
                    ? <img src={p.preview} alt={p.name} className="w-full object-contain" />
                    : <p className="p-2 text-xs text-muted-foreground">{p.name}</p>}
                  {pages.length > 1 && <p className="eyebrow px-1 pt-1">page {i + 1}</p>}
                </div>
              ))}
              <div className="border-t pt-2">
                <p className="eyebrow">Detected</p>
                <p className="num mt-1 text-sm">{draft.doc_type.replace("_", " ")}</p>
                {pages.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{pages.length} pages · merged</p>}
                {draft.model && <p className="mt-1 text-[11px] break-all text-muted-foreground">{draft.model}</p>}
              </div>
              {pageList.length > 1 && (
                <button type="button" className="btn w-full" onClick={() => { setStage("pages"); setStep(0); }}>
                  ← Re-check pages
                </button>
              )}
            </div>

            <div>
              <p className="eyebrow mb-3 text-warning">Review · {draft.doc_type.replace("_", " ")} · unconfirmed</p>
              {draft.notes && draft.notes.length > 0 && (
                <ul className="mb-4 space-y-1 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                  {draft.notes.map(n => <li key={n}>• {n}</li>)}
                </ul>
              )}
              <TxForm initial={draft.fields} onSubmit={confirm} submitLabel={busy ? "Saving…" : "Confirm & save"} />
              <button type="button" className="btn mt-4" onClick={() => { setDraft(null); setStage("pick"); }}>
                Scan a different document
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
