import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  FileScan,
  LockKeyhole,
  Plus,
  ReceiptText,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Page, Headline } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { TxForm } from "@/components/TxForm";
import { DocScanDialog } from "@/components/DocScanDialog";
import { saveTransaction } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Transaction } from "@/lib/types";
import { usd } from "@/lib/calc";

export const Route = createFileRoute("/entry")({
  head: () => ({
    meta: [
      { title: "Transactions — Cashflow" },
      {
        name: "description",
        content: "Record transactions manually or scan a document for review.",
      },
    ],
  }),
  component: Entry,
});

function Entry() {
  const { addTx, mode, tx } = useStore();
  const [tab, setTab] = useState<"manual" | "scan">("manual");
  const [scanOpen, setScanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const recent = [...tx]
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, 5);

  const saveManual = async (transaction: Transaction) => {
    setBusy(true);
    try {
      const saved = await saveTransaction({ ...transaction, source: "manual" });
      addTx({ ...transaction, id: saved.id ?? transaction.id });
      toast.success("Entry added to your ledger");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this entry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Headline eyebrow="Your ledger" lines={["Every number,", "with context."]} />

      {mode === null && (
        <div
          data-reveal
          className="mb-6 flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-slate-700">
            Choose a workspace to keep this ledger in context. Entries here remain in this page
            until you sign in or start a guest session.
          </p>
          <Link
            to="/login"
            className="motion-link inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-indigo-700 hover:underline"
          >
            Choose workspace <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div
        data-reveal
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h2 className="text-3xl">Add a transaction</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep your financial picture clear and up to date.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Entry method"
          data-reveal
          className="inline-flex w-full rounded-xl border border-slate-200 bg-white p-1 sm:w-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "manual"}
            onClick={() => setTab("manual")}
            className={`entry-tab flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${tab === "manual" ? "bg-[#172641] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <Plus className="h-4 w-4" /> Manual
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "scan"}
            onClick={() => setTab("scan")}
            className={`entry-tab flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${tab === "scan" ? "bg-[#172641] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <ScanLine className="h-4 w-4" /> Scan document
          </button>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-12">
        <InteractiveCard
          ribbon={false}
          role="tabpanel"
          className="surface min-w-0 p-5 sm:p-7 xl:col-span-8"
        >
          {tab === "manual" ? (
            <TxForm
              onSubmit={saveManual}
              submitLabel={busy ? "Saving entry…" : "Save transaction"}
              disabled={busy}
            />
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-5 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm">
                <FileScan aria-hidden className="h-7 w-7" />
              </span>
              <p className="eyebrow mt-5 text-indigo-700">AI-assisted capture</p>
              <h3 className="mt-2 text-3xl">Read it. Review it. Save it.</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Scan a receipt, invoice or bank-statement page. Extracted details stay a draft until
                you review and confirm them.
              </p>
              <button
                type="button"
                className="btn btn-solid mt-6"
                disabled={mode !== "user"}
                onClick={() => setScanOpen(true)}
              >
                <ScanLine className="h-4 w-4" /> Open document scanner
              </button>
              {mode !== "user" ? (
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <LockKeyhole className="h-3.5 w-3.5" /> Sign in to upload documents; guest mode
                  stays local.
                </p>
              ) : (
                <p className="mt-4 text-xs text-slate-500">
                  Images or PDF · Up to 5 pages · Nothing saves without your confirmation
                </p>
              )}
            </div>
          )}
        </InteractiveCard>

        <aside className="space-y-5 xl:col-span-4">
          <InteractiveCard ribbon={false} className="surface p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Private by design</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mode === "user"
                    ? "Saved to your secure ledger."
                    : mode === "guest"
                      ? "Guest entries stay in this browser session."
                      : "Entries stay in this page until you choose a workspace."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-3 rounded-xl bg-slate-50 p-3.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
              <p className="text-xs leading-relaxed text-slate-600">
                Scanned entries are reviewed by you before they reach your ledger. The model never
                saves a transaction on its own.
              </p>
            </div>
          </InteractiveCard>

          <InteractiveCard ribbon={false} className="surface p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Ledger activity</p>
                <h3 className="mt-1 text-2xl">Recent entries</h3>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <ReceiptText className="h-4 w-4" />
              </span>
            </div>
            {recent.length === 0 ? (
              <div className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-center">
                <p className="text-sm font-medium text-slate-700">No entries yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your newest transactions will appear here.
                </p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {recent.map((item, index) => (
                  <li
                    key={item.id}
                    className="list-item-enter flex items-center justify-between gap-3 py-3 first:pt-1"
                    style={{ animationDelay: `${index * 55}ms` }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.type === "income" || item.type === "ar" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {item.type === "income" || item.type === "ar" ? (
                          <ArrowRight className="h-4 w-4 -rotate-45" />
                        ) : (
                          <ArrowRight className="h-4 w-4 rotate-45" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {item.vendor_or_customer || item.category}
                        </p>
                        <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                          {item.type} · {item.transaction_date}
                        </p>
                      </div>
                    </div>
                    <span className="num shrink-0 text-xs font-semibold text-slate-800">
                      {usd(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/"
              className="motion-link mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
            >
              Back to overview <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </InteractiveCard>
        </aside>
      </div>

      <DocScanDialog open={scanOpen} onOpenChange={setScanOpen} onSaved={addTx} />
    </Page>
  );
}
