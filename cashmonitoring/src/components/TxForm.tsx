// Shared entry form (SKILL.md §5) — used by manual entry AND OCR review.
import { useState } from "react";
import type { Transaction, TxType } from "@/lib/types";
export function TxForm({ initial, onSubmit, submitLabel }: { initial?: Partial<Transaction>; onSubmit: (t: Transaction) => void; submitLabel: string }) {
  const [f, setF] = useState<Partial<Transaction>>({ type: "expense", status: "paid", transaction_date: "2026-11-14", ...initial });
  const set = (k: keyof Transaction, v: string | number) => setF(p => ({ ...p, [k]: v }));
  const arap = f.type === "ar" || f.type === "ap";
  return (
    <form className="grid gap-6 md:grid-cols-2" onSubmit={e => { e.preventDefault(); onSubmit({ id: `n${Date.now()}`, currency: "USD", source: "manual", due_date: arap ? f.due_date ?? null : null, category: "", vendor_or_customer: "", amount: 0, ...f } as Transaction); }}>
      <div className="md:col-span-2 flex flex-wrap gap-2">
        {(["income", "expense", "ar", "ap"] as TxType[]).map(t => <button type="button" key={t} onClick={() => set("type", t)} className={`btn uppercase ${f.type === t ? "btn-solid" : ""}`}>{t}</button>)}
      </div>
      <L t="Date"><input required type="date" className="field num" value={f.transaction_date ?? ""} onChange={e => set("transaction_date", e.target.value)} /></L>
      <L t="Amount (USD)"><input required type="number" step="0.01" className="field num" value={f.amount ?? ""} onChange={e => set("amount", +e.target.value)} /></L>
      <L t={f.type === "income" || f.type === "ar" ? "Customer" : "Vendor"}><input required className="field" value={f.vendor_or_customer ?? ""} onChange={e => set("vendor_or_customer", e.target.value)} /></L>
      <L t="Category"><input required className="field" value={f.category ?? ""} onChange={e => set("category", e.target.value)} /></L>
      {arap && <><L t="Due date"><input required type="date" className="field num" value={f.due_date ?? ""} onChange={e => set("due_date", e.target.value)} /></L>
        <L t="Status"><select className="field" value={f.status} onChange={e => set("status", e.target.value)}><option>pending</option><option>paid</option><option>overdue</option></select></L></>}
      <div className="md:col-span-2"><button className="btn btn-solid">{submitLabel} →</button></div>
    </form>
  );
}
const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block"><span className="eyebrow">{t}</span>{children}</label>;
