import { describe, expect, it } from "vitest";
import { asPayment, sameParty, settleable } from "@/lib/settlement";
import type { Transaction } from "@/lib/types";

const ar = (
  id: string,
  vendor: string,
  amount: number,
  due: string,
  status: Transaction["status"] = "overdue",
): Transaction => ({
  id,
  type: "ar",
  category: "Invoice",
  vendor_or_customer: vendor,
  amount,
  currency: "USD",
  transaction_date: "2026-09-01",
  due_date: due,
  status,
  source: "manual",
});

const income = (
  vendor: string,
  amount: number,
  status: Transaction["status"] = "paid",
): Transaction => ({
  id: "payment",
  type: "income",
  category: "Sales",
  vendor_or_customer: vendor,
  amount,
  currency: "USD",
  transaction_date: "2026-11-14",
  due_date: null,
  status,
  source: "manual",
});

const expense = (
  vendor: string,
  amount: number,
  status: Transaction["status"] = "paid",
): Transaction => ({
  id: "payment",
  type: "expense",
  category: "Work & Business",
  vendor_or_customer: vendor,
  amount,
  currency: "USD",
  transaction_date: "2026-11-14",
  due_date: null,
  status,
  source: "manual",
});

const ap = (
  id: string,
  vendor: string,
  amount: number,
  due: string,
  status: Transaction["status"] = "overdue",
): Transaction => ({
  id,
  type: "ap",
  category: "Supplier Bill",
  vendor_or_customer: vendor,
  amount,
  currency: "USD",
  transaction_date: "2026-09-01",
  due_date: due,
  status,
  source: "manual",
});

describe("guest-mode settlement mirror", () => {
  it("matches a customer typed with and without a company suffix", () => {
    expect(sameParty("Oak & Pine", "Oak & Pine Co.")).toBe(true);
    expect(sameParty("mesa retail", "Mesa Retail Ltd")).toBe(true);
  });

  it("closes the matching open invoice within a dollar", () => {
    const rows = [ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "pending")];
    expect(settleable(rows, income("Oak & Pine", 5200)).map((r) => r.id)).toEqual(["oak"]);
    expect(settleable(rows, income("Oak & Pine", 5199.5)).map((r) => r.id)).toEqual(["oak"]);
  });

  it("leaves an invoice open when only half is paid", () => {
    const rows = [ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "pending")];
    expect(settleable(rows, income("Oak & Pine", 2600))).toEqual([]);
  });

  it("never settles another customer or an already-paid invoice", () => {
    const rows = [
      ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "pending"),
      ar("mesa", "Mesa Retail", 6400, "2026-09-15"),
      ar("linden", "Linden Studio", 3200, "2026-10-01", "paid"),
    ];
    expect(settleable(rows, income("Harbor Cafe", 5200))).toEqual([]);
    expect(settleable(rows, income("Linden Studio", 3200))).toEqual([]);
  });

  it("settles the oldest matching invoice first", () => {
    const rows = [
      ar("newer", "Oak & Pine", 5200, "2026-11-28", "pending"),
      ar("older", "Oak & Pine", 5200, "2026-09-28", "overdue"),
    ];
    expect(settleable(rows, income("Oak & Pine Co.", 5200)).map((r) => r.id)).toEqual(["older"]);
  });

  it("a pending income row is a promise, not money received", () => {
    const rows = [ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "pending")];
    expect(settleable(rows, income("Oak & Pine", 5200, "pending"))).toEqual([]);
  });

  it("turns a paid receivable/bill into the matching cash movement", () => {
    const paidInvoice: Transaction = {
      ...ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "paid"),
      category: "Customer Invoice",
    };
    expect(asPayment(paidInvoice)).toMatchObject({
      type: "income",
      status: "paid",
      category: "AR",
      due_date: null,
    });

    const paidBill = { ...ap("paper", "Paper Mill Ltd", 2800, "2026-10-30", "paid") };
    expect(asPayment(paidBill)).toMatchObject({
      type: "expense",
      status: "paid",
      category: "Work & Business",
      due_date: null,
    });
  });

  it("a paid bill closes the matching payable, not a receivable", () => {
    const rows = [
      ar("oak", "Oak & Pine Co.", 5200, "2026-11-28", "pending"),
      ap("paper", "Paper Mill Ltd", 2800, "2026-10-30"),
    ];
    expect(settleable(rows, expense("Paper Mill", 2800)).map((r) => r.id)).toEqual(["paper"]);
    expect(settleable(rows, expense("Paper Mill", 1400))).toEqual([]);
  });
});
