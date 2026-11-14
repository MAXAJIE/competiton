// Shared entry form (SKILL.md §5) — used by manual entry AND OCR review.
import { useEffect, useState } from "react";
import type { Transaction, TxType } from "@/lib/types";
import { categoriesFor, suggestCategory, useCategories } from "@/lib/categories";

export function TxForm({ initial, onSubmit, submitLabel }: { initial?: Partial<Transaction>; onSubmit: (t: Transaction) => void; submitLabel: string }) {
  const tax = useCategories();
  const [f, setF] = useState<Partial<Transaction>>({ type: "expense", status: "paid", transaction_date: new Date().toISOString().slice(0, 10), ...initial });
  const [suggested, setSuggested] = useState<string | null>(null);
  const [touchedCategory, setTouchedCategory] = useState(Boolean(initial?.category));
  const set = (k: keyof Transaction, v: string | number) => setF(p => ({ ...p, [k]: v }));
  const arap = f.type === "ar" || f.type === "ap";
  const today = new Date().toISOString().slice(0, 10);
  // A receivable/payable is money still outstanding by definition, so the status
  // is derived, never chosen: recording the payment is what closes it.
  const derivedStatus: "pending" | "overdue" = f.due_date && f.due_date < today ? "overdue" : "pending";
  // The taxonomy's own description explains the pick — especially for "AR",
  // which is the only income category that settles an invoice instead of
  // adding revenue.
  const categoryDescription = categoriesFor(tax, (f.type ?? "expense") as TxType)
    .flatMap(g => g.items)
    .find(c => c.label === f.category)?.description;

  // Switching type replaces the category with that type's default, so a
  // "Groceries" expense can never linger on an income row.
  const changeType = (t: TxType) => {
    const first = tax[t][0]?.label ?? "Other";
    const isArap = t === "ar" || t === "ap";
    setF(p => ({
      ...p,
      type: t,
      // AR/AP derive their status. Income and expense are things that already
      // happened, so they are always 'paid' — there is no pending to carry over.
      status: isArap
        ? (p.due_date && p.due_date < today ? "overdue" : "pending")
        : "paid",
      category: touchedCategory && tax[t].some(c => c.label === p.category) ? (p.category as string) : first,
    }));
  };

  // Classifier suggests the best-fit category once a vendor is known.
  useEffect(() => {
    if (touchedCategory || !f.vendor_or_customer) return;
    let alive = true;
    const id = setTimeout(async () => {
      const s = await suggestCategory(f.vendor_or_customer ?? "", (f.type ?? "expense") as TxType);
      if (alive && s) { setSuggested(s.category); set("category", s.category); }
    }, 500);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.vendor_or_customer, f.type, touchedCategory]);

  return (
    <form className="grid gap-6 md:grid-cols-2" onSubmit={e => { e.preventDefault(); onSubmit({ id: `n${Date.now()}`, currency: "USD", source: "manual", due_date: arap ? f.due_date ?? null : null, category: f.category ?? tax[(f.type ?? "expense") as TxType][0]?.label ?? "Other", vendor_or_customer: "", amount: 0, ...f, status: arap ? derivedStatus : "paid" } as Transaction); }}>
      <div className="md:col-span-2 flex flex-wrap gap-2">
        {(["income", "expense", "ar", "ap"] as TxType[]).map(t => <button type="button" key={t} onClick={() => changeType(t)} className={`btn uppercase ${f.type === t ? "btn-solid" : ""}`}>{t}</button>)}
      </div>
      <L t="Date"><input required type="date" className="field num" value={f.transaction_date ?? ""} onChange={e => set("transaction_date", e.target.value)} /></L>
      <L t="Amount (USD)"><input required type="number" step="0.01" className="field num" value={f.amount ?? ""} onChange={e => set("amount", +e.target.value)} /></L>
      <L t={f.type === "income" || f.type === "ar" ? "Customer" : "Vendor"}><input required className="field" value={f.vendor_or_customer ?? ""} onChange={e => set("vendor_or_customer", e.target.value)} /></L>
      <label className="block">
        <span className="eyebrow">Category</span>
        <select
          required
          className="field"
          value={f.category ?? ""}
          onChange={e => { setTouchedCategory(true); setSuggested(null); set("category", e.target.value); }}
        >
          <option value="" disabled>Choose a category…</option>
          {categoriesFor(tax, (f.type ?? "expense") as TxType).map(({ group, items }) => (
            <optgroup key={group} label={group}>
              {items.map(c => <option key={c.key} value={c.label}>{c.label}</option>)}
            </optgroup>
          ))}
        </select>
        {suggested && suggested === f.category && (
          <span className="mt-1 block text-xs text-muted-foreground">Auto-picked for “{f.vendor_or_customer}” — change it if that's wrong.</span>
        )}
        {categoryDescription && (
          <span className="mt-1 block text-xs text-muted-foreground">{categoryDescription}</span>
        )}
      </label>
      {arap && (
        <>
          <L t="Due date">
            <input required type="date" className="field num" value={f.due_date ?? ""} onChange={e => set("due_date", e.target.value)} />
            <span className="mt-1 block text-xs text-muted-foreground">
              Recorded as {derivedStatus} — unpaid until you record the customer's payment.
            </span>
          </L>
        </>
      )}
      <div className="md:col-span-2"><button className="btn btn-solid">{submitLabel} →</button></div>
    </form>
  );
}
const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block"><span className="eyebrow">{t}</span>{children}</label>;
