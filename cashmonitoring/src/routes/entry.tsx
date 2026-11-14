import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Page, Headline } from "@/components/Reveal";
import { TxForm } from "@/components/TxForm";
import { runOcr, saveTransaction } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { OcrDraft, Transaction } from "@/lib/types";
import { gsap, useGSAP } from "@/lib/motion";

export const Route = createFileRoute("/entry")({
  head: () => ({ meta: [{ title: "Add entries — CashMonitoring" }, { name: "description", content: "Enter transactions by hand or scan a receipt, invoice or statement." }, { property: "og:title", content: "Add entries — CashMonitoring" }, { property: "og:description", content: "Manual entry and reviewed document scanning." }] }),
  component: Entry,
});
function Entry() {
  const { addTx } = useStore();
  const [tab, setTab] = useState<"manual" | "scan">("manual");
  const [draft, setDraft] = useState<OcrDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useGSAP(() => { gsap.fromTo(panel.current, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: 0.9, ease: "expo.inOut" }); }, { dependencies: [tab, draft] });
  const save = async (t: Transaction, ocr = false) => { await saveTransaction({ ...t, source: ocr ? "ocr" : "manual" }); addTx(t); toast.success("Saved to ledger"); setDraft(null); };
  return (
    <Page>
      <Headline eyebrow="Entry" lines={["Every number", "gets a human check."]} />
      <div data-reveal className="mb-8 flex gap-6 font-display text-2xl">
        {(["manual", "scan"] as const).map(t => <button key={t} onClick={() => { setTab(t); setDraft(null); }} className={tab === t ? "italic text-accent" : "text-muted-foreground"}>{t === "manual" ? "Manual entry" : "Scan a document"}</button>)}
      </div>
      <div ref={panel}>
        {tab === "manual" && <TxForm onSubmit={t => save(t)} submitLabel="Save entry" />}
        {tab === "scan" && !draft && (
          <label className="flex h-64 cursor-pointer flex-col items-center justify-center border border-dashed border-foreground/40 hover:bg-secondary">
            <p className="font-display text-3xl">{busy ? "Reading document…" : "Drop a receipt, invoice or statement"}</p>
            <p className="eyebrow mt-2">Nothing is saved until you confirm</p>
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); setDraft(await runOcr(f)); setBusy(false); }} />
          </label>)}
        {tab === "scan" && draft && <div>
          <p className="eyebrow mb-6 text-warning">Review · {draft.doc_type} · unconfirmed</p>
          <TxForm initial={draft.fields} onSubmit={t => save(t, true)} submitLabel="Confirm & save" />
        </div>}
      </div>
    </Page>
  );
}
