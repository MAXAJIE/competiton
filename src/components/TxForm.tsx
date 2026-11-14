import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeDollarSign,
  CreditCard,
  ReceiptText,
} from "lucide-react";
import type { Transaction, TxType } from "@/lib/types";

const types: { value: TxType; label: string; icon: typeof ArrowUpRight }[] = [
  { value: "income", label: "Income", icon: ArrowDownLeft },
  { value: "expense", label: "Expense", icon: ArrowUpRight },
  { value: "ar", label: "Receivable", icon: BadgeDollarSign },
  { value: "ap", label: "Payable", icon: CreditCard },
];

export function TxForm({
  initial,
  onSubmit,
  submitLabel,
  disabled = false,
}: {
  initial?: Partial<Transaction>;
  onSubmit: (transaction: Transaction) => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  const [fields, setFields] = useState<Partial<Transaction>>({
    type: "expense",
    status: "paid",
    transaction_date: new Date().toISOString().slice(0, 10),
    ...initial,
  });
  const set = (key: keyof Transaction, value: string | number) =>
    setFields((current) => ({ ...current, [key]: value }));
  const isOpenItem = fields.type === "ar" || fields.type === "ap";

  return (
    <form
      className="space-y-7"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          id: `n${Date.now()}`,
          currency: "USD",
          source: "manual",
          due_date: isOpenItem ? (fields.due_date ?? null) : null,
          category: "",
          vendor_or_customer: "",
          amount: 0,
          ...fields,
        } as Transaction);
      }}
    >
      <fieldset disabled={disabled} className="space-y-6 disabled:opacity-70">
        <legend className="eyebrow mb-3">What kind of entry is this?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {types.map(({ value, label, icon: Icon }) => {
            const selected = fields.type === value;
            return (
              <button
                type="button"
                key={value}
                aria-pressed={selected}
                onClick={() => set("type", value)}
                className={`type-choice flex min-h-[76px] flex-col items-start justify-between rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" />
                <span className="text-xs font-semibold">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          <FormField label="Transaction date" icon={ReceiptText}>
            <input
              required
              type="date"
              className="field num"
              value={fields.transaction_date ?? ""}
              onChange={(event) => set("transaction_date", event.target.value)}
            />
          </FormField>
          <FormField label="Amount (USD)" icon={BadgeDollarSign}>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
              >
                $
              </span>
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                inputMode="decimal"
                className="field num pl-8"
                placeholder="0.00"
                value={fields.amount ?? ""}
                onChange={(event) => set("amount", +event.target.value)}
              />
            </div>
          </FormField>
          <FormField
            label={fields.type === "income" || fields.type === "ar" ? "Customer" : "Vendor"}
          >
            <input
              required
              className="field"
              placeholder={
                fields.type === "income" || fields.type === "ar"
                  ? "e.g. Northstar Studio"
                  : "e.g. Acme Supplies"
              }
              value={fields.vendor_or_customer ?? ""}
              onChange={(event) => set("vendor_or_customer", event.target.value)}
            />
          </FormField>
          <FormField label="Category">
            <input
              required
              className="field"
              placeholder="e.g. Sales, Rent, Software"
              value={fields.category ?? ""}
              onChange={(event) => set("category", event.target.value)}
            />
          </FormField>
          {isOpenItem && (
            <>
              <FormField label="Due date" className="field-enter">
                <input
                  required
                  type="date"
                  className="field num"
                  value={fields.due_date ?? ""}
                  onChange={(event) => set("due_date", event.target.value)}
                />
              </FormField>
              <FormField label="Payment status" className="field-enter">
                <select
                  className="field"
                  value={fields.status ?? "pending"}
                  onChange={(event) => set("status", event.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                </select>
              </FormField>
            </>
          )}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Your entry is only used to calculate your private cash-flow view.
        </p>
        <button type="submit" disabled={disabled} className="btn btn-solid w-full sm:w-auto">
          {disabled && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden
            />
          )}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function FormField({
  label,
  icon: Icon,
  children,
  className = "",
}: {
  label: string;
  icon?: typeof ReceiptText;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
        {Icon && <Icon aria-hidden className="h-4 w-4 text-slate-400" />}
        {label}
      </span>
      {children}
    </label>
  );
}
