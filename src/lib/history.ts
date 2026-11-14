import { usd } from "@/lib/calc";
import type { Transaction, TxType } from "@/lib/types";

export type HistoryPeriod = "all" | 3 | 6 | 12 | 24;
export type HistorySort = "newest" | "oldest" | "amount-desc" | "amount-asc" | "name-asc";
export type HistoryType = "all" | TxType;

export interface HistoryFilters {
  query: string;
  type: HistoryType;
  period: HistoryPeriod;
  sort: HistorySort;
}

const typeLabels: Record<TxType, string> = {
  income: "income",
  expense: "expense",
  ar: "receivable",
  ap: "payable",
};

export function filterTransactions(
  transactions: Transaction[],
  filters: HistoryFilters,
  now = new Date(),
): Transaction[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const amountQuery = query.replace(/[$,\s]/g, "");
  let periodStart: Date | null = null;
  if (filters.period !== "all") {
    periodStart = new Date(now.getFullYear(), now.getMonth() - filters.period, 1);
    const lastDay = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
    periodStart.setDate(Math.min(now.getDate(), lastDay));
  }

  const visible = transactions.filter((transaction) => {
    if (filters.type !== "all" && transaction.type !== filters.type) return false;

    if (periodStart) {
      const date = new Date(`${transaction.transaction_date}T00:00:00`);
      if (Number.isNaN(date.getTime()) || date < periodStart) return false;
    }

    if (!query) return true;

    const textMatches = [
      transaction.vendor_or_customer,
      transaction.category,
      typeLabels[transaction.type],
      transaction.status,
      transaction.transaction_date,
      transaction.due_date ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(query));
    const amountMatches =
      amountQuery.length > 0 &&
      (String(transaction.amount).includes(amountQuery) ||
        usd(transaction.amount)
          .replace(/[$,\s]/g, "")
          .includes(amountQuery));

    return textMatches || amountMatches;
  });

  return visible.sort((a, b) => {
    switch (filters.sort) {
      case "oldest":
        return a.transaction_date.localeCompare(b.transaction_date);
      case "amount-desc":
        return b.amount - a.amount;
      case "amount-asc":
        return a.amount - b.amount;
      case "name-asc":
        return a.vendor_or_customer.localeCompare(b.vendor_or_customer, undefined, {
          sensitivity: "base",
        });
      case "newest":
      default:
        return b.transaction_date.localeCompare(a.transaction_date);
    }
  });
}
