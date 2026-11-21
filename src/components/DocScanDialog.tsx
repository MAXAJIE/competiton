// Document scan dialog — drop images → read → review ONE ENTRY PER IMAGE → confirm.
//
// Images are independent (a photo of two receipts is two transactions), so each
// one is reviewed on its own screen: image on the left, its entry on the right,
// "Next" for the following one. An image that cannot be read is reported with a
// reason and skipped instead of being turned into an invented entry.
//
// Every save goes through POST /api/documents/{id}/confirm, which flips
// reviewed=true and writes the transaction in one call (SKILL.md §4).
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TxForm } from "@/components/TxForm";
import { confirmOcr, runOcr, type SavedTransaction } from "@/lib/api";
import { usd } from "@/lib/calc";
import type { OcrEntry } from "@/lib/ocr-types";
import type { Transaction } from "@/lib/types";

const MAX_IMAGES = 5;
const MAX_EDGE = 1600;
// Matches the backend's MAX_UPLOAD_BYTES: a PDF is not re-compressed here, so a
// huge one is refused with a sentence instead of after a slow upload.
const MAX_UPLOAD_MB = 8;

type Image = { file: File; preview: string | null; name: string };
type Stage = "pick" | "review" | "done";

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
  const [images, setImages] = useState<Image[]>([]);
  const [docType, setDocType] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<OcrEntry[]>([]);
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<Stage>("pick");
  const [savedCount, setSavedCount] = useState(0);
  const [skippedNames, setSkippedNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setImages([]); setEntries([]); setStep(0); setStage("pick");
    setSavedCount(0); setSkippedNames([]); setError(null); setDocType("");
  };
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset(); };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) { toast.error(`Maximum ${MAX_IMAGES} images at a time.`); return; }
    const picked = Array.from(list).slice(0, room);
    const tooBig = picked.filter(f => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`${tooBig[0]?.name ?? "That file"} is larger than ${MAX_UPLOAD_MB} MB. Compress it or split it up.`);
      return;
    }
    const next: Image[] = [];
    for (const f of picked) {
      const compressed = await compressImage(f);
      next.push({
        file: compressed,
        name: f.name,
        preview: compressed.type.startsWith("image/") ? URL.createObjectURL(compressed) : null,
      });
    }
    setImages(p => [...p, ...next]);
    setEntries([]);
    setStage("pick");
    setError(null);
  };

  const scan = async () => {
    if (!images.length) return;
    setBusy(true); setError(null);
    try {
      const result = await runOcr(images.map(p => p.file), docType);
      setEntries(result.entries);
      setStep(0);
      setStage("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const current = entries[step];
  const total = entries.length;
  const isLast = step >= total - 1;

  /** Move to the next image, or finish when this was the last one. */
  const advance = (opts: { saved?: boolean; skippedName?: string } = {}) => {
    const savedNow = savedCount + (opts.saved ? 1 : 0);
    const skippedNow = opts.skippedName ? [...skippedNames, opts.skippedName] : skippedNames;
    setSavedCount(savedNow);
    setSkippedNames(skippedNow);
    if (isLast) {
      setStage("done");
      setEntries(prev => prev);
      const parts = [`${savedNow} ${savedNow === 1 ? "entry" : "entries"} saved`];
      if (skippedNow.length) parts.push(`${skippedNow.length} skipped`);
      toast.success(parts.join(" · "));
    } else {
      setStep(s => s + 1);
    }
  };

  const confirmCurrent = async (t: Transaction) => {
    if (!current?.document_id) return;
    setBusy(true);
    try {
      const saved: SavedTransaction = await confirmOcr(current.document_id, t);
      const { settled_ar, ...savedRow } = saved;
      const closed = onSaved({ ...t, ...savedRow, id: saved.id ?? t.id }, settled_ar?.map(r => r.id));
      if (closed.length > 0) {
        const who = [...new Set(closed.map(r => r.vendor_or_customer))].join(", ");
        toast.success(`Saved, and marked ${closed.length} invoice${closed.length > 1 ? "s" : ""} from ${who} as paid`);
      }
      advance({ saved: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const title = stage === "done"
    ? "Scan finished"
    : stage === "review"
      ? `Entry ${step + 1} of ${total}`
      : "Scan documents";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">{title}</DialogTitle>
          <DialogDescription className="lede">
            {stage === "done"
              ? "Everything you confirmed is in the ledger."
              : stage === "review"
                ? "Each image is its own entry. Nothing is saved until you confirm it."
                : "One entry per image — up to 5 at a time. Nothing is saved until you confirm."}
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" && (
          <>
            <label
              className="mt-2 flex h-40 cursor-pointer flex-col items-center justify-center border border-dashed border-foreground/40 text-center hover:bg-secondary"
              onDragOver={e => e.preventDefault()}
              onDrop={async e => { e.preventDefault(); await addFiles(e.dataTransfer.files); }}
            >
              <p className="font-display text-2xl">{images.length ? "Add more images" : "Drop images here"}</p>
              <p className="eyebrow mt-1">or click to choose · images or PDF · up to {MAX_IMAGES} at a time</p>
              <input ref={inputRef} type="file" multiple accept="image/*,.pdf" className="hidden"
                     onChange={async e => { await addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ""; }} />
            </label>

            {images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {images.map((p, i) => (
                  <div key={i} className="relative border bg-secondary/40 p-1">
                    {p.preview
                      ? <img src={p.preview} alt={p.name} className="h-24 w-24 object-cover" />
                      : <div className="flex h-24 w-24 items-center justify-center px-2 text-center text-[11px] text-muted-foreground">{p.name}</div>}
                    <span className="absolute left-1 top-1 bg-foreground px-1 text-[10px] text-background">{i + 1}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${p.name}`}
                      className="absolute -right-2 -top-2 border bg-background px-1 text-xs"
                      onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
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
              {images.length > 1 && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Each image becomes its own entry. Leave on auto-detect unless they are all the same kind.
                </span>
              )}
            </label>

            {error && <p className="mt-4 border-l-4 border-destructive bg-destructive/10 px-4 py-3 text-sm">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button type="button" className="btn btn-solid" disabled={!images.length || busy} onClick={scan}>
                {busy
                  ? "Reading images…"
                  : images.length > 1 ? `Read ${images.length} images →` : "Scan image →"}
              </button>
              <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              {busy && (
                <span className="eyebrow animate-pulse">
                  {images.length > 1 ? `vision model working through ${images.length} images…` : "vision model working…"}
                </span>
              )}
            </div>
          </>
        )}

        {stage === "review" && current && (
          <div className="mt-2 grid gap-6 md:grid-cols-[1fr_1fr]">
            <div>
              {images[step]?.preview
                ? <img src={images[step].preview!} alt={images[step].name} className="w-full border object-contain" />
                : <div className="flex h-56 items-center justify-center border text-xs text-muted-foreground">
                    {images[step]?.name ?? current.name} · preview unavailable
                  </div>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {entries.map((e, i) => (
                  <span
                    key={e.index}
                    className={`border px-2 py-1 text-xs ${i === step ? "border-foreground bg-foreground text-background" : ""} ${i < step ? "opacity-50" : ""}`}
                  >
                    {e.ok ? i + 1 : `✕ ${i + 1}`}
                  </span>
                ))}
                <span className="eyebrow ml-auto">{images[step]?.name ?? current.name}</span>
              </div>
            </div>

            <div>
              {current.ok ? (
                <>
                  <p className="eyebrow mb-3 text-warning">
                    Review · {(current.doc_type ?? "receipt").replace("_", " ")} · unconfirmed
                  </p>
                  {current.notes && current.notes.length > 0 && (
                    <ul className="mb-4 space-y-1 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                      {current.notes.map(n => <li key={n}>• {n}</li>)}
                    </ul>
                  )}
                  <TxForm
                    key={current.document_id}
                    initial={current.fields ?? {}}
                    onSubmit={confirmCurrent}
                    submitLabel={busy ? "Saving…" : isLast ? "Confirm & save entry" : "Confirm & save, next →"}
                  />
                </>
              ) : (
                <div className="border-l-4 border-destructive bg-destructive/10 px-4 py-3">
                  <p className="eyebrow text-destructive">could not read this image</p>
                  <p className="mt-2 text-sm">{current.reason ?? "This image is not a document."}</p>
                  {current.detail && (
                    <p className="mt-2 break-words text-xs text-muted-foreground">{current.detail}</p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Nothing was recorded for it. Skip it, or add the entry by hand.
                  </p>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                {current.ok ? (
                  <button type="button" className="btn" disabled={busy}
                          onClick={() => advance({ skippedName: current.name })}>
                    Skip this image
                  </button>
                ) : (
                  <button type="button" className="btn btn-solid" onClick={() => advance({ skippedName: current.name })}>
                    {isLast ? "Finish" : "Next image →"}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {isLast ? "Last image." : `${total - 1 - step} more image${total - 1 - step > 1 ? "s" : ""} after this.`}
                {savedCount > 0 && ` ${savedCount} saved so far.`}
              </p>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="mt-2">
            <p className="text-sm">
              <span className="num text-2xl">{savedCount}</span> of {total} image
              {total === 1 ? "" : "s"} saved to your ledger.
            </p>
            {skippedNames.length > 0 && (
              <div className="mt-4 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
                <p className="eyebrow">skipped</p>
                <ul className="mt-1 space-y-1">
                  {skippedNames.map(n => <li key={n}>• {n}</li>)}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Unreadable or unwanted — nothing was recorded for these.
                </p>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-solid" onClick={() => close(false)}>Done</button>
              <button type="button" className="btn" onClick={() => { setImages([]); setEntries([]); setStage("pick"); setSavedCount(0); setSkippedNames([]); }}>
                Scan more images
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
