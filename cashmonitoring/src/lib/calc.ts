// Compartment B calc layer (SKILL.md §2). UI must call these, never recompute.
// CONNECTION POINT: replace bodies with calls to the real Python/B functions or a Supabase view.
import type { Transaction } from "./types";
import { OPENING_BALANCE } from "./demo-data";
const TODAY = "2026-11-14";
const sum = (r: Transaction[]) => r.reduce((a, t) => a + t.amount, 0);

export function getMonthly(tx: Transaction[]) {
  const map = new Map<string, { month: string; income: number; expense: number }>();
  tx.filter(t => t.type === "income" || t.type === "expense").forEach(t => {
    const m = t.transaction_date.slice(0, 7);
    const e = map.get(m) ?? { month: m, income: 0, expense: 0 };
    e[t.type as "income" | "expense"] += t.amount; map.set(m, e);
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}
export function getCashBalance(tx: Transaction[]) {
  return OPENING_BALANCE + sum(tx.filter(t => t.type === "income" && t.status === "paid")) - sum(tx.filter(t => t.type === "expense" && t.status === "paid"));
}
export function getAvgMonthlyBurn(tx: Transaction[]) {
  const m = getMonthly(tx).slice(-3); return m.reduce((a, x) => a + x.expense, 0) / Math.max(m.length, 1);
}
export function getRunwayMonths(tx: Transaction[]) { return getCashBalance(tx) / getAvgMonthlyBurn(tx); }
export function getArApSummary(tx: Transaction[]) {
  const open = (k: "ar" | "ap") => tx.filter(t => t.type === k && t.status !== "paid");
  const aging = (k: "ar" | "ap") => {
    const b = { current: 0, "1-30": 0, "31-60": 0, "60+": 0 };
    open(k).forEach(t => {
      const d = (Date.parse(TODAY) - Date.parse(t.due_date!)) / 864e5;
      if (d <= 0) b.current += t.amount; else if (d <= 30) b["1-30"] += t.amount; else if (d <= 60) b["31-60"] += t.amount; else b["60+"] += t.amount;
    }); return b;
  };
  return { ar: sum(open("ar")), ap: sum(open("ap")), arOverdue: sum(open("ar").filter(t => t.status === "overdue")), arAging: aging("ar"), apAging: aging("ap") };
}
/** Method: trailing 3-month average of income. Stated in output per SKILL.md §3. */
export function predictNextMonthRevenue(tx: Transaction[]) {
  const m = getMonthly(tx).slice(-3);
  return { value: m.reduce((a, x) => a + x.income, 0) / m.length, method: "Trailing 3-month average of recorded income" };
}
export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
