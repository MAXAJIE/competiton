// Document scan dialog — drop/preview → extract → REVIEW DETAIL → confirm.
// The extracted values are never saved automatically: confirming goes through
// POST /api/documents/{id}/confirm, which flips reviewed=true and writes the
// transaction in one call (SKILL.md §4). Mirrors the reference UX in
// MAXAJIE/acc's DocumentScanDialog (client-side downscale, page thumbnails,
// spinner while scanning, detail panel before saving).
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TxForm } from "@/components/TxForm";
import { confirmOcr, runOcr } from "@/lib/api";
import type { OcrDraft, Transaction } from "@/lib/types";

const MAX_PAGES = 5;
const MAX_EDGE = 1600;

type Page = { file: File; preview: string | null; name: string };

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
    if (scale === 1) {
      URL.revokeObjectURL(url);
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
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

export function DocScanDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (t: Transaction) => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [docType, setDocType] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<OcrDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPages([]);
    setDraft(null);
    setError(null);
    setDocType("");
  };
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_PAGES - pages.length;
    if (room <= 0) {
      toast.error(`Maximum ${MAX_PAGES} pages.`);
      return;
    }
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
    setPages((p) => [...p, ...next]);
    setDraft(null);
    setError(null);
  };

  const scan = async () => {
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const d = await runOcr(
        pages.map((p) => p.file),
        docType,
      );
      setDraft(d);
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
      onSaved({ ...t, id: saved.id ?? t.id });
      toast.success("Reviewed and saved to ledger");
      close(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] max-w-4xl overflow-y-auto rounded-3xl border-slate-200 bg-white p-5 shadow-2xl sm:p-7">
        <DialogHeader className="mb-2">
          <DialogTitle className="font-display text-3xl sm:text-4xl">
            {draft ? "Check the extracted details" : "Scan a document"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {draft
              ? "Nothing is saved until you confirm. Edit anything the model got wrong."
              : "Receipt, invoice or bank-statement line. Nothing is saved until you confirm."}
          </DialogDescription>
        </DialogHeader>

        {!draft && (
          <>
            <label
              className="drop-target mt-2 flex h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                await addFiles(e.dataTransfer.files);
              }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                <FileScanIcon />
              </span>
              <p className="mt-3 font-display text-2xl">
                {pages.length ? "Add another page" : "Drop a document here"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                or click to choose · images or PDF · up to {MAX_PAGES} pages
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,.pdf"
                className="hidden"
                onChange={async (e) => {
                  await addFiles(e.target.files);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
            </label>

            {pages.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {pages.map((p, i) => (
                  <div
                    key={i}
                    className="list-item-enter relative rounded-xl border border-slate-200 bg-slate-50 p-1"
                    style={{ animationDelay: `${i * 55}ms` }}
                  >
                    {p.preview ? (
                      <img
                        src={p.preview}
                        alt={p.name}
                        className="h-24 w-24 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
                        {p.name}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${p.name}`}
                      className="absolute -right-2 -top-2 border bg-background px-1 text-xs"
                      onClick={() => setPages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="mt-4 block max-w-xs">
              <span className="eyebrow">Document type</span>
              <select
                className="field"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {DOC_LABELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>

            {error && (
              <p className="message-enter mt-4 border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-sm">
                {error}
              </p>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-solid"
                disabled={!pages.length || busy}
                onClick={scan}
              >
                {busy ? "Reading document…" : "Scan document →"}
              </button>
              <button type="button" className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              {busy && <span className="eyebrow animate-pulse">vision model working…</span>}
            </div>
          </>
        )}

        {draft && (
          <div className="message-enter mt-2 grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              {pages.map((p, i) => (
                <div key={i} className="border p-1">
                  {p.preview ? (
                    <img src={p.preview} alt={p.name} className="w-full object-contain" />
                  ) : (
                    <p className="p-2 text-xs text-muted-foreground">{p.name}</p>
                  )}
                </div>
              ))}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="eyebrow">Detected</p>
                <p className="num mt-1 text-sm">{draft.doc_type.replace("_", " ")}</p>
                {draft.model && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{draft.model}</p>
                )}
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3 text-amber-700">
                Review · {draft.doc_type.replace("_", " ")} · unconfirmed
              </p>
              {draft.notes && draft.notes.length > 0 && (
                <ul className="mb-4 space-y-1 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                  {draft.notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              )}
              <TxForm
                initial={draft.fields}
                onSubmit={confirm}
                submitLabel={busy ? "Saving…" : "Confirm & save"}
                disabled={busy}
              />
              <button type="button" className="btn mt-4" onClick={() => setDraft(null)}>
                Scan a different document
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileScanIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}
