import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Page, Headline } from "@/components/Reveal";
import { TxForm } from "@/components/TxForm";
import { DocScanDialog } from "@/components/DocScanDialog";
import { saveTransaction } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Transaction } from "@/lib/types";
import { gsap, useGSAP } from "@/lib/motion";

export const Route = createFileRoute("/entry")({
  head: () => ({ meta: [{ title: "Add entries — CashMonitoring" }, { name: "description", content: "Enter transactions by hand or scan a receipt, invoice or statement." }, { property: "og:title", content: "Add entries — CashMonitoring" }, { property: "og:description", content: "Manual entry and reviewed document scanning." }] }),
  component: Entry,
});
function Entry() {
  const { addTx, mode } = useStore();
  const [tab, setTab] = useState<"manual" | "scan">("manual");
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useGSAP(() => { gsap.fromTo(panel.current, { clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)", duration: 0.9, ease: "expo.inOut" }); }, { dependencies: [tab, scanOpen] });

  const saveManual = async (t: Transaction) => {
    setBusy(true);
    try {
      const saved = await saveTransaction({ ...t, source: "manual" });
      const closed = addTx({ ...t, id: saved.id ?? t.id }, saved.settled_ar?.map(r => r.id));
      if (closed.length > 0) {
        const who = [...new Set(closed.map(r => r.vendor_or_customer))].join(", ");
        toast.success(`Saved, and marked ${closed.length} invoice${closed.length > 1 ? "s" : ""} from ${who} as paid`);
      } else {
        toast.success("Saved to ledger");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Headline eyebrow="Entry" lines={["Every number", "gets a human check."]} />
      <div data-reveal className="mb-8 flex gap-6 font-display text-2xl">
        {(["manual", "scan"] as const).map(t => <button key={t} onClick={() => setTab(t)} className={tab === t ? "italic text-accent" : "text-muted-foreground"}>{t === "manual" ? "Manual entry" : "Scan a document"}</button>)}
      </div>
      <div ref={panel}>
        {tab === "manual" && <TxForm onSubmit={saveManual} submitLabel={busy ? "Saving…" : "Save entry"} />}
        {tab === "scan" && (
          <div className="border border-dashed border-foreground/40 p-10 text-center">
            <p className="font-display text-3xl">Read it, then confirm it</p>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              A receipt, invoice or bank-statement line is read by a vision model and opened in a
              detail panel. Nothing reaches your ledger until you confirm the extracted fields.
            </p>
            <button className="btn btn-solid mt-6" onClick={() => setScanOpen(true)}>Open scanner →</button>
            {mode !== "user" && (
              <p className="mt-4 text-xs text-muted-foreground">Guest mode can't upload documents — sign in to scan.</p>
            )}
          </div>
        )}
      </div>
      <DocScanDialog open={scanOpen} onOpenChange={setScanOpen} onSaved={(t, ids) => addTx(t, ids)} />
    </Page>
  );
}
