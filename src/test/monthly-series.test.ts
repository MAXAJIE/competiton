import { describe, expect, it } from "vitest";

import { getMonthly, getMonthlySeries } from "@/lib/calc";
import type { Transaction } from "@/lib/types";

const row = (date: string, type: "income" | "expense", amount: number): Transaction => ({
  id: `${type}-${date}-${amount}`,
  type,
  category: type === "income" ? "Sales" : "Rent",
  vendor_or_customer: type === "income" ? "Customer" : "Landlord",
  amount,
  currency: "USD",
  transaction_date: date,
  due_date: null,
  status: "paid",
  source: "manual",
});

describe("monthly series for the dashboard chart", () => {
  it("keeps one month when only one month is recorded", () => {
    // The bug this replaces: one month of data rendered a "come back later"
    // placeholder instead of the month's income and expenses.
    const series = getMonthlySeries([row("2026-11-03", "income", 5000), row("2026-11-09", "expense", 1200)]);

    expect(series).toEqual([{ month: "2026-11", income: 5000, expense: 1200 }]);
  });

  it("fills the months in between with zero instead of touching the gaps", () => {
    const series = getMonthlySeries([
      row("2026-05-04", "income", 1000),
      row("2026-07-04", "expense", 400),
    ]);

    expect(series.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(series[1]).toEqual({ month: "2026-06", income: 0, expense: 0 });
  });

  it("crosses a year boundary without inventing a month 00", () => {
    const series = getMonthlySeries([
      row("2025-11-04", "income", 900),
      row("2026-01-04", "income", 1100),
    ]);

    expect(series.map((m) => m.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("keeps the most recent months when the ledger runs longer than the window", () => {
    const long = Array.from({ length: 30 }, (_, i) => {
      const month = String((i % 12) + 1).padStart(2, "0");
      const year = 2024 + Math.floor(i / 12);
      return row(`${year}-${month}-10`, "income", 100 + i);
    });

    const series = getMonthlySeries(long, 6);

    expect(series).toHaveLength(6);
    expect(series.at(-1)?.month).toBe("2026-06");
    expect(series[0]?.month).toBe("2026-01");
  });

  it("returns nothing for an empty ledger rather than a zero month", () => {
    expect(getMonthlySeries([])).toEqual([]);
  });

  it("counts only income and expense rows, like the underlying aggregation", () => {
    const invoice: Transaction = {
      ...row("2026-11-02", "income", 7000),
      id: "ar-1",
      type: "ar",
      status: "pending",
      due_date: "2026-12-02",
    };

    expect(getMonthly([invoice])).toEqual([]);
    expect(getMonthlySeries([invoice])).toEqual([]);
  });
});
