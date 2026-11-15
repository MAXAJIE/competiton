// Compartment B calc layer (SKILL.md §2). UI must call these, never recompute.
// Mirrors backend/app/calc.py — keep the two in sync.
import type { Transaction } from "./types";
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
/**
 * The chart's monthly series: `getMonthly` with the empty months put back.
 *
 * `getMonthly` returns only the months that have rows, so a ledger with gaps
 * drew Mar, Jun and Jul as three touching points — a trend that never happened.
 * This walks the calendar from the first recorded month to the last, fills any
 * gap with zero, and keeps the most recent `months` entries. Nothing is invented
 * outside the recorded range, and the ledger stays the only source.
 */
export function getMonthlySeries(tx: Transaction[], months = 12) {
  const raw = getMonthly(tx);
  if (!raw.length) return [];
  const byMonth = new Map(raw.map((row) => [row.month, row]));
  const [startYear, startMonth] = raw[0]!.month.split("-").map(Number) as [number, number];
  const [endYear, endMonth] = raw[raw.length - 1]!.month.split("-").map(Number) as [number, number];
  const end = Date.UTC(endYear, endMonth - 1, 1);
  const first = Date.UTC(startYear, startMonth - 1, 1);
  const windowStart = Date.UTC(endYear, endMonth - 1 - (Math.max(months, 1) - 1), 1);
  const next = (ts: number) => {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  };
  const series: { month: string; income: number; expense: number }[] = [];
  for (let ts = Math.max(first, windowStart); ts <= end; ts = next(ts)) {
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    series.push(byMonth.get(key) ?? { month: key, income: 0, expense: 0 });
  }
  return series;
}
export function getCashBalance(tx: Transaction[]) {
  // Cash on hand = paid income − paid expense. No opening balance is assumed:
  // the schema has no opening-balance column, so an empty ledger reads 0.
  return sum(tx.filter(t => t.type === "income" && t.status === "paid")) - sum(tx.filter(t => t.type === "expense" && t.status === "paid"));
}
export function getAvgMonthlyBurn(tx: Transaction[]) {
  const m = getMonthly(tx).slice(-3); return m.reduce((a, x) => a + x.expense, 0) / Math.max(m.length, 1);
}
/** Months of runway at current burn; null until there is any recorded burn. */
export function getRunwayMonths(tx: Transaction[]): number | null {
  const burn = getAvgMonthlyBurn(tx);
  return burn > 0 ? getCashBalance(tx) / burn : null;
}
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
  return { value: m.length ? m.reduce((a, x) => a + x.income, 0) / m.length : 0, method: "Trailing 3-month average of recorded income" };
}
export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
