import { describe, expect, it } from "vitest";
import { filterTransactions, type HistoryFilters } from "@/lib/history";
import type { Transaction } from "@/lib/types";

const filters: HistoryFilters = {
  query: "",
  type: "all",
  period: "all",
  sort: "newest",
};

const rows: Transaction[] = [
  {
    id: "income",
    type: "income",
    category: "Sales",
    vendor_or_customer: "Linden Studio",
    amount: 2400,
    currency: "USD",
    transaction_date: "2026-10-12",
    due_date: null,
    status: "paid",
    source: "manual",
  },
  {
    id: "expense",
    type: "expense",
    category: "Supplies",
    vendor_or_customer: "Paper Mill",
    amount: 1200,
    currency: "USD",
    transaction_date: "2026-09-10",
    due_date: null,
    status: "paid",
    source: "manual",
  },
  {
    id: "receivable",
    type: "ar",
    category: "Invoice",
    vendor_or_customer: "Harbor Cafe",
    amount: 1800,
    currency: "USD",
    transaction_date: "2026-07-14",
    due_date: "2026-08-14",
    status: "overdue",
    source: "manual",
  },
  {
    id: "payable",
    type: "ap",
    category: "Bill",
    vendor_or_customer: "Northgate Props",
    amount: 3200,
    currency: "USD",
    transaction_date: "2026-11-02",
    due_date: "2026-11-30",
    status: "pending",
    source: "manual",
  },
];

describe("transaction history filters", () => {
  it("searches vendor names and formatted amounts", () => {
    expect(filterTransactions(rows, { ...filters, query: "linden" }).map((row) => row.id)).toEqual([
      "income",
    ]);
    expect(filterTransactions(rows, { ...filters, query: "$1,200" }).map((row) => row.id)).toEqual([
      "expense",
    ]);
  });

  it("filters by type and a trailing period without dropping matching entries", () => {
    const result = filterTransactions(
      rows,
      { ...filters, type: "expense", period: 3 },
      new Date("2026-11-15T12:00:00"),
    );

    expect(result.map((row) => row.id)).toEqual(["expense"]);
  });

  it("sorts by amount without mutating the source ledger", () => {
    const originalOrder = rows.map((row) => row.id);
    const sorted = filterTransactions(rows, { ...filters, sort: "amount-desc" });

    expect(sorted.map((row) => row.id)).toEqual(["payable", "income", "receivable", "expense"]);
    expect(rows.map((row) => row.id)).toEqual(originalOrder);
  });
});
